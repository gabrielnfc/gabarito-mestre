#!/usr/bin/env node
/**
 * bench-guarda.mjs — latência wall-clock do hook da guarda (REQ-GRD-3, E1:60).
 *
 * USO
 *   node scripts/bench-guarda.mjs [--n 20] [--limite <ms> | --limite-excesso <ms>] [--json]
 *
 * Cria um repositório temporário com `origin` e `harness.config.json` em origin/HEAD (o caminho real do hook:
 * `git show` da config), roda `dist/guarda.js` N vezes em processo novo com um comando benigno (`ls`) e imprime
 * p50/p95/máx. Imprime também o piso do Node (`node -e ""`, N vezes) para separar o custo do runtime do custo da guarda.
 * Com `--limite`, sai 1 se o p95 bruto da guarda passar dele (local: 60 ms absoluto, sem repetição).
 * Com `--limite-excesso` (CI), sai 1 se `p95(guarda) − p95(piso)` passar dele; estourou ⇒ repete a medição 1 vez
 * e só reprova se a 2ª também estourar (REQ-CI-1: o ruído do runner macOS não reprova). Sem dependência.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, ehEntrypoint } from '../lib/cli.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GUARDA = join(AQUI, '..', 'dist', 'guarda.js');

const ENV_GIT = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Bench',
  GIT_AUTHOR_EMAIL: 'bench@exemplo.com',
  GIT_COMMITTER_NAME: 'Bench',
  GIT_COMMITTER_EMAIL: 'bench@exemplo.com',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV_GIT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

export function percentil(amostras, p) {
  const o = [...amostras].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
}

export function resumo(amostras) {
  return { n: amostras.length, p50: percentil(amostras, 50), p95: percentil(amostras, 95), max: Math.max(...amostras) };
}

function repoDeMedicao() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'gm-bench-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  const config = {
    guarda: { ambientes: { teste: { hosts: ['127.0.0.1'] }, prod: { hosts: ['api.exemplo.com'] } }, producao: { permitidos: [] } },
    versionamento: { branchPadrao: 'main' },
  };
  writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(config));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  const bare = mkdtempSync(join(tmpdir(), 'gm-bench-origin-'));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return repo;
}

function medir(n, comando, args, opcoes) {
  const amostras = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = spawnSync(comando, args, { ...opcoes, encoding: 'utf8' });
    amostras.push(performance.now() - t0);
    if (r.status !== 0) throw new Error(`${comando} saiu ${r.status}: ${r.stderr}`);
  }
  return amostras;
}

/**
 * Decide a partir de medições (injetáveis: sem relógio aqui). `medir()` devolve { piso, guarda } (resumos).
 * Modo excesso: aprova se excesso <= limiteExcesso; estourou ⇒ 1 repetição, no máximo; vale a que decidiu.
 * Modo absoluto (`limite`): p95 bruto, 1 medição. Sem limite: só informa.
 */
export function decidir(medir, { limite = null, limiteExcesso = null } = {}) {
  const tentativas = [];
  const uma = () => {
    const m = medir();
    const t = { piso: m.piso, guarda: m.guarda, excesso: m.guarda.p95 - m.piso.p95 };
    tentativas.push(t);
    return t;
  };
  let t = uma();
  let ok = true;
  if (limiteExcesso !== null) {
    ok = t.excesso <= limiteExcesso;
    if (!ok) {
      t = uma();
      ok = t.excesso <= limiteExcesso;
    }
  } else if (limite !== null) {
    ok = t.guarda.p95 <= limite;
  }
  return { ok, piso: t.piso, guarda: t.guarda, excesso: t.excesso, tentativas };
}

function principal() {
  const argv = process.argv.slice(2);
  const n = Number(arg(argv, 'n', '20'));
  const limiteBruto = arg(argv, 'limite', null);
  const limite = limiteBruto === null ? null : Number(limiteBruto);
  const limiteExcessoBruto = arg(argv, 'limite-excesso', null);
  const limiteExcesso = limiteExcessoBruto === null ? null : Number(limiteExcessoBruto);
  if (!Number.isInteger(n) || n < 1 || (limite !== null && !(limite > 0)) || (limiteExcesso !== null && !(limiteExcesso > 0))) {
    console.error('uso: bench-guarda.mjs [--n 20] [--limite <ms> | --limite-excesso <ms>] [--json]');
    process.exit(2);
  }
  const repo = repoDeMedicao();
  const payload = JSON.stringify({
    session_id: 'bench',
    cwd: repo,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, TMPDIR: mkdtempSync(join(tmpdir(), 'gm-bench-tmp-')) };

  // aquecimento: o primeiro spawn paga cache de disco do Node e do git; não conta
  medir(2, process.execPath, [GUARDA], { cwd: repo, input: payload, env });
  const v = decidir(
    () => ({
      piso: resumo(medir(n, process.execPath, ['-e', ''], { cwd: repo, env })),
      guarda: resumo(medir(n, process.execPath, [GUARDA], { cwd: repo, input: payload, env })),
    }),
    { limite, limiteExcesso },
  );
  const { piso, guarda, excesso } = v;

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ node: process.version, plataforma: process.platform, piso, guarda, excesso, tentativas: v.tentativas.length, limite, limiteExcesso }));
  } else {
    const f = (x) => x.toFixed(1).padStart(6);
    console.log(`node ${process.version} · ${process.platform} · n=${n} · comando benigno \`ls\`, config em origin/HEAD`);
    console.log(`piso (node -e "")   p50 ${f(piso.p50)} ms · p95 ${f(piso.p95)} ms · máx ${f(piso.max)} ms`);
    console.log(`guarda (guarda.js)  p50 ${f(guarda.p50)} ms · p95 ${f(guarda.p95)} ms · máx ${f(guarda.max)} ms`);
    console.log(`excesso (guarda − piso) p95 ${f(excesso)} ms${v.tentativas.length > 1 ? ` · ${v.tentativas.length} medições (repetiu 1×)` : ''}`);
    if (limiteExcesso !== null) console.log(`limite excesso ${limiteExcesso} ms: ${v.ok ? 'ok' : 'ESTOUROU'}`);
    else if (limite !== null) console.log(`limite p95 ${limite} ms: ${v.ok ? 'ok' : 'ESTOUROU'}`);
  }
  if (!v.ok) process.exit(1);
}

if (ehEntrypoint(import.meta.url)) principal();

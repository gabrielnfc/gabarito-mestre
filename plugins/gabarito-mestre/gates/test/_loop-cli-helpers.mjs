// GM-19 T1: ambiente, ferramentas falsas e funcoes de apoio de loop-cli.test.mjs, movidos sem mudar o corpo.
// `export` so na linha da declaracao; o `after` de limpeza vale em cada processo que importa este arquivo.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { raizSegura } from './_raiz-segura.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, chmodSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { marcaPronto } from '../scripts/db-template.mjs';
import * as diario from '../dist/diario.js';
import { fecharPendenciasNoDiario } from './_adaptador-helpers.mjs';
// --- corpo movido ---

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const SCRIPT = join(AQUI, '..', 'scripts', 'loop.mjs');
export const GITIGNORE_RAIZ = join(AQUI, '..', '..', '..', '..', '.gitignore');
export const GIT_REAL = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
export const VERSAO_PLUGIN = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const FAKE_PSQL = String.raw`
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const argv = process.argv.slice(2);
const sql = argv[argv.indexOf('-c') + 1];
appendFileSync(process.env.FAKE_LOG, sql + '\n');
const ESTADO = process.env.FAKE_STATE;
const st = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { dbs: {} };
const salvar = () => writeFileSync(ESTADO, JSON.stringify(st));
const erro = (m, c = 1) => { process.stderr.write(m + '\n'); process.exit(c); };
if (process.env.FAKE_FAIL && new RegExp(process.env.FAKE_FAIL).test(sql)) erro('ERROR: falha injetada');
const un = (s) => s.replaceAll('""', '"').replaceAll("''", "'");
let m;
if ((m = /^SELECT 'E:' \|\| coalesce\(shobj_description\(oid, 'pg_database'\), ''\) FROM pg_database WHERE datname = '((?:[^']|'')*)'$/.exec(sql))) {
  const d = st.dbs[un(m[1])];
  process.stdout.write(d ? 'E:' + (d.comment ?? '') + '\n' : '');
} else if ((m = /^CREATE DATABASE "((?:[^"]|"")*)"(?: TEMPLATE "((?:[^"]|"")*)")?$/.exec(sql))) {
  const nome = un(m[1]);
  if (st.dbs[nome]) erro('ERROR: already exists');
  st.dbs[nome] = {}; salvar();
} else if ((m = /^COMMENT ON DATABASE "((?:[^"]|"")*)" IS '((?:[^']|'')*)'$/.exec(sql))) {
  const d = st.dbs[un(m[1])]; if (!d) erro('ERROR: does not exist');
  d.comment = un(m[2]); salvar();
} else if ((m = /^DROP DATABASE IF EXISTS "((?:[^"]|"")*)" WITH \(FORCE\)$/.exec(sql))) {
  delete st.dbs[un(m[1])]; salvar();
} else erro('fake: SQL desconhecido: ' + sql, 3);
`;

export const GIT_ENVOLTORIO = `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [ -n "$GIT_FALHAR" ] && [[ "$*" == *"$GIT_FALHAR"* ]]; then echo "falha injetada" >&2; exit 1; fi
exec "${GIT_REAL}" "$@"
`;

export const raizes = [];
export const novoTmp = (prefixo) => {
  const d = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), prefixo))));
  raizes.push(d);
  return d;
};
after(() => {
  for (const d of raizes) {
    try { chmodSync(join(d, '.harness', 'entregas', 'GM-10'), 0o755); } catch { /* nada */ }
  }
});

export const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const gOk = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

export const CONFIG_PADRAO = { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } };
export const planoDe = (tasks, entrega = 'GM-10') => ({ entrega, tasks });
export const PLANO_PADRAO = planoDe([
  { id: 'T1', deps: [], arquivos: ['src/t1.txt'] },
  { id: 'T2', deps: ['T1'], arquivos: ['src/t2.txt'] },
  { id: 'T3', deps: [], arquivos: ['src/t3.txt'] },
]);

// Capacidade FALSA e medidas da máquina por variável: o teste nunca depende da máquina que o roda (REQ-SLOT-1).
export const HOST_TESTE = 'host-teste';
export const CAPACIDADE_PADRAO = { hostname: HOST_TESTE, slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 };
export const MEDIDAS_PADRAO = { GABARITO_CAP_HOSTNAME: HOST_TESTE, GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };

export function ambiente({ branch = 'enabler/GM-10-loop', config = CONFIG_PADRAO, plano = PLANO_PADRAO, gitignore = true, capacidade = CAPACIDADE_PADRAO } = {}) {
  const dir = novoTmp('loop-cli-');
  g(dir, 'init', '-q', '-b', branch);
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.txt'), 'ORIG\n');
  writeFileSync(join(dir, 'harness.config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  if (gitignore) writeFileSync(join(dir, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  if (plano !== null) writeFileSync(join(entregas, 'plano.json'), typeof plano === 'string' ? plano : JSON.stringify(plano));
  const ferramentas = novoTmp('loop-ferr-');
  const bin = join(ferramentas, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), GIT_ENVOLTORIO, { mode: 0o755 });
  const psqlDir = join(ferramentas, 'pg');
  mkdirSync(psqlDir);
  writeFileSync(join(psqlDir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(psqlDir, 'psql'), FAKE_PSQL);
  const gitLog = join(ferramentas, 'git.log');
  const psqlLog = join(ferramentas, 'psql.log');
  const estado = join(ferramentas, 'estado.json');
  writeFileSync(gitLog, '');
  writeFileSync(psqlLog, '');
  const tmpSistema = novoTmp('loop-sys-'); // o TMPDIR da task nasce aqui (D2): nada vaza para o do usuário
  const env = { ...process.env, TMPDIR: tmpSistema, PATH: `${bin}:${process.env.PATH}`, GIT_LOG: gitLog, FAKE_LOG: psqlLog, FAKE_STATE: estado, ...MEDIDAS_PADRAO };
  for (const k of Object.keys(env)) if (/^(PG|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR))/i.test(k) || k === 'GABARITO_POUSO_X') delete env[k];
  // estado local, fora do git (como o .gitignore do repo faz com .harness/capacidade.json): não suja a árvore dos gates
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '.harness/capacidade.json\n');
  if (capacidade !== null) writeFileSync(join(dir, '.harness', 'capacidade.json'), typeof capacidade === 'string' ? capacidade : JSON.stringify(capacidade));
  delete env.GIT_FALHAR;
  let seq = 0;
  const amb = {
    dir, entregas, env, tmpSistema, gitLog, psqlLog, estado, psql: join(psqlDir, 'psql'),
    wt: (t) => join(dir, '.harness', 'worktrees', t),
    cli(args, { cwd = dir, extra = {} } = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
      return { rc: r.status, j, out: r.stdout, err: r.stderr };
    },
    eventos: () => diario.ler(entregas),
    tipos: () => diario.ler(entregas).map((e) => e.tipo),
    /** REQ-APR-2 muda a ordem: fecha o que `pendenciasAprendizado` do `dist/` devolve (MAJOR, fechamento, parar) para o teste seguir ao que ele prova. Plano ilegível: nada a fechar. */
    fechar() {
      let plano;
      try { plano = JSON.parse(readFileSync(join(entregas, 'plano.json'), 'utf8')); } catch { return 0; }
      return fecharPendenciasNoDiario(entregas, plano);
    },
    semear(lista) {
      for (const [tipo, dados] of lista) {
        seq += 1;
        const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
        const r = diario.append(entregas, 'loop', { ts, autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
      amb.fechar();
    },
    commitNaWt(t, arquivo, conteudo = 'x\n', msg = 'feat(GM-10): trabalho') {
      const w = join(dir, '.harness', 'worktrees', t);
      mkdirSync(dirname(join(w, arquivo)), { recursive: true });
      writeFileSync(join(w, arquivo), conteudo);
      g(w, 'add', arquivo);
      g(w, 'commit', '-q', '-m', msg);
    },
    /** abrir → iniciar → commit → concluir → revisor → APROVADO. Devolve a worktree. */
    aprovar(t, arquivo = `src/${t.toLowerCase()}.txt`, extras = []) {
      for (const a of [['abrir', t], ['iniciar', t, 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
      amb.commitNaWt(t, arquivo);
      for (const [f, conteudo] of extras) amb.commitNaWt(t, f, conteudo);
      for (const a of [['concluir', t], ['iniciar', t, 'revisor'], ['veredito', t, 'APROVADO', '1', '0', '0']]) {
        const r = amb.cli(a);
        assert.equal(r.rc, 0, `${a.join(' ')} ${r.out}`);
      }
      return amb.wt(t);
    },
    comBanco(extra = {}) {
      writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({
        ...CONFIG_PADRAO, db: { psql: [process.execPath, join(psqlDir, 'psql')], template: 'gm_tpl', ...extra },
      }));
      g(dir, 'add', 'harness.config.json');
      g(dir, 'commit', '-q', '-m', 'chore: db');
      writeFileSync(estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment: marcaPronto('S1'), template: true } } }));
    },
    bancos: () => (existsSync(estado) ? Object.keys(JSON.parse(readFileSync(estado, 'utf8')).dbs) : []),
    sqls: () => readFileSync(psqlLog, 'utf8').split('\n').filter(Boolean),
    gitChamadas: () => readFileSync(gitLog, 'utf8').split('\n').filter(Boolean),
    branches: () => g(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n'),
    topo: (ref = 'HEAD') => g(dir, 'rev-parse', ref).trim(),
  };
  return amb;
}

/** Nome da pasta do TMPDIR da task: sha256 do caminho da worktree, 16 hex, no tmpdir do sistema (o contrato de D2). */
export const tmpDaTask = (amb, t) => join(amb.tmpSistema, `gabarito-${createHash('sha256').update(amb.wt(t)).digest('hex').slice(0, 16)}`);

export const semEfeito = (amb) => ({ branches: amb.branches().join(','), topo: amb.topo(), eventos: amb.eventos().length, wts: existsSync(join(amb.dir, '.harness', 'worktrees')) ? readdirSync(join(amb.dir, '.harness', 'worktrees')).join(',') : '' });

export const H = (c) => c.repeat(64);
export const PLANO_REQ = {
  entrega: 'GM-10',
  spec: 'docs/spec.md',
  tasks: [
    { id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] },
    { id: 'T2', deps: [], arquivos: ['src/t2.txt'], reqs: ['REQ-B-1'] },
    { id: 'T3', deps: ['T1'], arquivos: ['src/t3.txt'], reqs: ['REQ-C-1'] },
  ],
};
export const PLANO_AJUSTE = {
  entrega: 'GM-10',
  tasks: [
    { id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] },
    { id: 'T5', deps: ['T1'], arquivos: ['src/t5.txt'], reqs: ['REQ-A-1'] },
  ],
};
export const IMPL_E = (t) => [['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: 'a'.repeat(40) }]];
export const APROVA_E = (t) => ['review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }];
export const INTEGRA_E = (t) => ['task.integrada', { task: t, sha: 'a'.repeat(40) }];
export const REPROVA_E = (t) => ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }];
export const PROPOSTA = (extra = {}) => ({ req: 'REQ-A-1', diff: '+ regra nova', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio', ...extra });

/** Relógio que só cresce, em segundos a partir de 2026-02-01: o que vai de uma sessão para outra respeita a ordem de escrita. */
export const relogioDe = () => { let n = 0; return () => new Date(Date.UTC(2026, 1, 1, 0, 0, ++n)).toISOString(); };
export function escreve(amb, sessao, tipo, dados, ts) {
  const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
  assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
}
/** `lista` = [[sessao?, tipo, dados]] ; sem sessão ⇒ `loop`. */
export function grava(amb, rel, lista) {
  for (const it of lista) {
    const [sessao, tipo, dados] = it.length === 3 ? it : ['loop', ...it];
    escreve(amb, sessao, tipo, dados, rel());
  }
  amb.fechar(); // REQ-APR-2 muda a ordem
}
export const bytesDoDiario = (amb) => Object.fromEntries(readdirSync(amb.entregas).filter((n) => n.startsWith('events.')).sort().map((n) => [n, readFileSync(join(amb.entregas, n), 'utf8')]));
export const ambReq = (opts = {}) => {
  const amb = ambiente({ plano: PLANO_REQ, ...opts });
  mkdirSync(join(amb.dir, 'docs'), { recursive: true });
  writeFileSync(join(amb.dir, 'docs', 'spec.md'), '# Spec\n\n**REQ-A-1** regra A.\n\n**REQ-B-1** regra B.\n\n**REQ-C-1** regra C.\n');
  return amb;
};

/** `refs/remotes/origin/HEAD` com `harness.config.json` = `cfg` (texto ou objeto), por plumbing: a árvore local não muda. */
export function comOrigin(amb, cfg) {
  const texto = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
  const feito = (args, input) => {
    const r = spawnSync('git', ['-C', amb.dir, ...args], { encoding: 'utf8', input });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const blob = feito(['hash-object', '-w', '--stdin'], texto);
  const arvore = feito(['mktree'], `100644 blob ${blob}\tharness.config.json\n`);
  const commit = feito(['commit-tree', arvore, '-m', 'origin'], undefined);
  feito(['update-ref', 'refs/remotes/origin/main', commit]);
  feito(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
}
export const diffEm = (amb, texto = '--- a\n+++ b\n+ regra\n', nome = 'd.diff') => {
  const f = join(amb.tmpSistema, nome);
  writeFileSync(f, texto);
  return f;
};
export const proporArgs = (amb, extra = {}, { diff } = {}) => {
  const f = { req: 'REQ-A-1', diff: diff ?? diffEm(amb), fato: 'fato', alternativa: 'alt', evidencia: 'evid', causa: 'regra_negocio', ...extra };
  return ['emenda', 'propor', ...Object.entries(f).flatMap(([k, v]) => (v === undefined ? [] : [`--${k}`, v]))];
};
export const emendasDoDiario = (amb) => diario.ler(amb.entregas).filter((e) => e.sessao === 'emendas');

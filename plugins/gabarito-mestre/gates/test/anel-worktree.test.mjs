/**
 * Anel por raiz mais profunda (GM-10, REQ-POU-2 r6, REQ-LOOP-3): a worktree de task em `.harness/worktrees/<task>` recebe
 * a escrita do implementador; `.harness`, config, `.git`, workflows e `.env` seguem barrados, na worktree e no principal,
 * com qualquer cwd. Teste de COSTURA (P9): `loop.mjs abrir` real → `guarda.js` por stdin → escrita e commit reais → `integrar`.
 *
 * MUTAÇÕES PRESCRITAS (JSON em .superpowers/sdd/2026-11-03-e2-loop/task-17-mut.json, roda sobre dist/):
 *  G1  primeira raiz que contém, em vez da mais longa ⇒ `anel-e2e-abrir-hook` falha
 *  G2  `raizesDeAnel` devolve só `raizes` ⇒ `anel-e2e-abrir-hook` falha
 *  G3  lista sem o principal ⇒ `anel-cwd-nao-muda-veredito` falha
 *  G4  qualquer filho de `.harness/worktrees`, sem registro ⇒ `anel-worktree-falsa` falha
 *  G5  sem a checagem de filho direto ⇒ `anel-registrada-fora-de-worktrees` falha
 *  G6  erro de leitura entra na lista ⇒ `anel-gitdir-ilegivel-nega` falha
 *  G7  comparação sem caixa exata ⇒ `anel-caixa-nega` falha
 *  G8  `rel` da worktree medido contra o principal ⇒ `anel-e2e-abrir-hook` falha
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rodarBruto, sessaoNova } from './_adaptador-helpers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
const PLUGIN = realpathSync(join(AQUI, '..', '..'));

const HOST = 'host-teste';
const MEDIDAS = { GABARITO_CAP_HOSTNAME: HOST, GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };
const CAPACIDADE = { hostname: HOST, slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 };
const CONFIG = { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } };
const PLANO = { entrega: 'GM-99', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }] };

const limpar = [];
after(() => { for (const d of limpar) { try { chmodSync(d, 0o644); } catch { /* nada */ } } });

const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const envCli = () => {
  const env = { ...process.env, ...MEDIDAS };
  for (const k of Object.keys(env)) if (/^(PG|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR))/i.test(k)) delete env[k];
  return env;
};
const cli = (R, args, cwd = R) => {
  const r = spawnSync(process.execPath, [LOOP, ...args], { cwd, encoding: 'utf8', env: envCli() });
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};

/** Repo principal com plano, `abrir T1` real (H = `.harness/worktrees/T1`), worktrees I (dentro do repo) e F (fora), T9 sem registro. */
function cenario() {
  const R = tmp('anel-wt-');
  g(R, 'init', '-q', '-b', 'enabler/GM-99-x');
  g(R, 'config', 'user.email', 't@t'); g(R, 'config', 'user.name', 't'); g(R, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(R, 'src'));
  writeFileSync(join(R, 'src/a.txt'), 'ORIG\n');
  writeFileSync(join(R, 'a.txt'), 'ORIG\n');
  writeFileSync(join(R, 'harness.config.json'), JSON.stringify(CONFIG));
  writeFileSync(join(R, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n.wt/\n');
  g(R, 'add', '-A'); g(R, 'commit', '-q', '-m', 'chore: base');
  appendFileSync(join(R, '.git', 'info', 'exclude'), '.harness/capacidade.json\n');
  mkdirSync(join(R, '.harness', 'entregas', 'GM-99'), { recursive: true });
  writeFileSync(join(R, '.harness', 'entregas', 'GM-99', 'plano.json'), JSON.stringify(PLANO));
  writeFileSync(join(R, '.harness', 'capacidade.json'), JSON.stringify(CAPACIDADE));
  const ab = cli(R, ['abrir', 'T1']);
  assert.equal(ab.rc, 0, ab.out + ab.err);
  const H = join(R, '.harness', 'worktrees', 'T1');
  const I = join(R, '.wt', 'T3');
  mkdirSync(join(R, '.wt'));
  g(R, 'worktree', 'add', '-q', '-b', 'wt/GM-99-T3', I);
  const F = join(tmp('anel-fora-'), 'T4');
  g(R, 'worktree', 'add', '-q', '-b', 'wt/GM-99-T4', F);
  mkdirSync(join(R, '.harness', 'worktrees', 'T9'));
  return { R, H, I, F };
}

const SUB = { agent_id: 'a1', agent_type: 'gabarito-mestre:gabarito-implementador' };

/** A guarda real, por stdin, com a raiz da sessão no principal. `sub = false`: o orquestrador. */
function hook(R, cwd, tool_name, tool_input, sub = true) {
  const entrada = { tool_name, tool_input, permission_mode: 'default', session_id: sessaoNova(), cwd, hook_event_name: 'PreToolUse', ...(sub ? SUB : {}) };
  const r = rodarBruto(JSON.stringify(entrada), { repo: R, cwd });
  assert.equal(r.status, 0, r.stderr);
  return r.decisao;
}

const W = (p) => ['Write', { file_path: p, content: 'x' }, p];
const E = (p) => ['Edit', { file_path: p, old_string: 'a', new_string: 'b' }, p];
const B = (c, alvo = null) => ['Bash', { command: c }, alvo];

/** Escritas legítimas do implementador na worktree `wt`. */
const legitimos = (wt) => [
  ['Write wt/test/a', ...W(`${wt}/test/a.mjs`)], ['Edit wt/a.txt', ...E(`${wt}/a.txt`)],
  ['Bash > abs', ...B(`echo x > ${wt}/test/a.mjs`)], ['Bash cd wt && >', ...B(`cd ${wt} && echo x > test/a.mjs`)],
  ['mkdir abs', ...B(`mkdir -p ${wt}/src`)], ['tee abs', ...B(`echo x | tee ${wt}/src/a`)], ['sed -i abs', ...B(`sed -i '' s/a/b/ ${wt}/a.txt`)],
  ['cp na wt', ...B(`cp ${wt}/a.txt ${wt}/b.txt`)], ['rm arquivo da wt', ...B(`rm ${wt}/b.txt`)],
  ['git -C add', ...B(`git -C ${wt} add -A`)], ['git -C commit', ...B(`git -C ${wt} commit -m x`)], ['cd; git commit', ...B(`cd ${wt} && git add -A && git commit -m x`)],
  ['cd TMPDIR npm', ...B(`cd ${wt} && TMPDIR=${wt}/.tmp-gabarito npm test`)], ['tmp >', ...B(`echo x > ${wt}/.tmp-gabarito/f`)],
];

/** Ataques ao anel: `wt` é a worktree, `R` o principal. `profundo`: os 3 `wt/../../…`, que só apontam para `.harness` quando a wt é filha de `.harness/worktrees`. */
const ataques = (wt, R, { profundo }) => [
  ['wt/.harness/x', ...W(`${wt}/.harness/x`)], ['wt/.harness/PAUSAR', ...W(`${wt}/.harness/PAUSAR`)], ['wt/harness.config', ...W(`${wt}/harness.config.json`)],
  ['wt/.git', ...W(`${wt}/.git`)], ['wt/.github/workflows', ...W(`${wt}/.github/workflows/c.yml`)], ['wt/.claude/settings', ...W(`${wt}/.claude/settings.json`)],
  ['wt/.env', ...W(`${wt}/.env`)], ['wt/tools/gabarito-gates', ...W(`${wt}/tools/gabarito-gates/g.js`)],
  ['Bash > wt/.harness/x', ...B(`echo x > ${wt}/.harness/x`, `${wt}/.harness/x`)], ['cd wt; > .harness/x', ...B(`cd ${wt} && echo x > .harness/x`, `${wt}/.harness/x`)],
  ['rm -rf wt', ...B(`rm -rf ${wt}`)], ['mv wt', ...B(`mv ${wt} /tmp/zz-anel`, '/tmp/zz-anel')], ['rm -rf wt/.github', ...B(`rm -rf ${wt}/.github`)],
  ['R/.harness/x', ...W(`${R}/.harness/x`)], ['R/.harness/PAUSAR', ...W(`${R}/.harness/PAUSAR`)], ['R/.harness/entregas', ...W(`${R}/.harness/entregas/GM-99/events.z.jsonl`)],
  ['R/harness.config', ...W(`${R}/harness.config.json`)], ['R/.git/config', ...W(`${R}/.git/config`)], ['R/.env', ...W(`${R}/.env`)],
  ['R/.github/workflows', ...W(`${R}/.github/workflows/c.yml`)], ['Bash > R/.harness/x', ...B(`echo x > ${R}/.harness/x`, `${R}/.harness/x`)],
  ...(profundo
    ? [['wt/../../PAUSAR', ...W(`${wt}/../../PAUSAR`)], ['cd wt; > ../../entregas', ...B(`cd ${wt} && echo x > ../../entregas/GM-99/plano.json`)], ['cd wt; rm ../../PAUSAR', ...B(`cd ${wt} && rm ../../PAUSAR`)]]
    : []),
  ['plugin/hooks', ...W(`${PLUGIN}/hooks/hooks.json`)], ['plugin/gates', ...W(`${PLUGIN}/gates/dist/guarda.js`)], ['Bash > plugin', ...B(`echo x > ${PLUGIN}/gates/scripts/loop.mjs`)],
  ['T9 sem registro', ...W(`${R}/.harness/worktrees/T9/x`)], ['worktrees/x', ...W(`${R}/.harness/worktrees/x`)], ['WORKTREES em outra caixa', ...W(`${R}/.HARNESS/WORKTREES/T1/x`)],
  ['rm -rf worktrees', ...B(`rm -rf ${R}/.harness/worktrees`)], ['Bash > wt/.git', ...B(`echo x > ${wt}/.git`)],
];

describe('anel pela raiz mais profunda', () => {
  test('anel-e2e-abrir-hook: abrir real, guarda por stdin nos 2 cwd, escrita e commit reais, integrar encontra o commit; 32 ataques, todos deny', () => {
    const { R, H } = cenario();
    // 1. Cada escrita legítima passa em silêncio, com o cwd no principal e com o cwd na worktree.
    for (const cwd of [R, H]) {
      for (const [nome, tool, input] of legitimos(H)) {
        assert.equal(hook(R, cwd, tool, input), undefined, `legítimo barrado (cwd ${cwd === R ? 'principal' : 'worktree'}): ${nome}`);
      }
    }
    // 2. A escrita e o commit acontecem de verdade; `integrar` encontra o commit na branch do principal.
    mkdirSync(join(H, 'src'), { recursive: true });
    writeFileSync(join(H, 'src', 't1.txt'), 'x\n');
    g(H, 'add', 'src/t1.txt');
    g(H, 'commit', '-q', '-m', 'feat(GM-99): trabalho');
    const sha = g(H, 'rev-parse', 'HEAD').trim();
    for (const a of [['iniciar', 'T1', 'implementador'], ['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) {
      const r = cli(R, a);
      assert.equal(r.rc, 0, `${a.join(' ')}: ${r.out}${r.err}`);
    }
    const it = cli(R, ['integrar', 'T1']);
    assert.equal(it.rc, 0, it.out + it.err);
    assert.equal(g(R, 'merge-base', '--is-ancestor', sha, 'HEAD') === '', true);
    assert.equal(readFileSync(join(R, 'src', 't1.txt'), 'utf8'), 'x\n');
    // 3. Os ataques, numa segunda worktree aberta de verdade (a primeira foi integrada e removida): todos deny, com os 2 cwd;
    //    o alvo não muda de estado (a guarda não executa nada).
    const ab2 = cli(R, ['abrir', 'T2']);
    assert.equal(ab2.rc, 0, ab2.out + ab2.err);
    const H2 = join(R, '.harness', 'worktrees', 'T2');
    const lista = ataques(H2, R, { profundo: true });
    assert.equal(lista.length, 32);
    for (const cwd of [R, H2]) {
      for (const [nome, tool, input, alvo] of lista) {
        const antes = alvo === null ? null : existsSync(alvo);
        assert.equal(hook(R, cwd, tool, input), 'deny', `ataque passou (cwd ${cwd === R ? 'principal' : 'worktree'}): ${nome}`);
        if (alvo !== null) assert.equal(existsSync(alvo), antes, `alvo mudou: ${nome}`);
      }
    }
  });

  test('anel-cwd-nao-muda-veredito: o mesmo alvo tem a mesma decisão com o cwd no principal e na worktree', () => {
    const { R, H } = cenario();
    const casos = [...legitimos(H), ...ataques(H, R, { profundo: true })];
    for (const [nome, tool, input] of casos) {
      assert.equal(hook(R, R, tool, input), hook(R, H, tool, input), nome);
    }
  });

  test('anel-worktree-falsa: pasta em .harness/worktrees sem registro no git fica no anel do principal', () => {
    const { R } = cenario();
    for (const cwd of [R, join(R, '.harness', 'worktrees', 'T9')]) {
      assert.equal(hook(R, cwd, 'Write', { file_path: `${R}/.harness/worktrees/T9/test/a.mjs`, content: 'x' }), 'deny');
      assert.equal(hook(R, cwd, 'Bash', { command: `echo x > ${R}/.harness/worktrees/T9/test/a.mjs` }), 'deny');
    }
  });

  test('anel-registrada-fora-de-worktrees: worktree registrada em .harness/x (não é filha direta de worktrees/) não entra', () => {
    const { R } = cenario();
    const X = join(R, '.harness', 'x');
    g(R, 'worktree', 'add', '-q', '-b', 'wt/GM-99-X', X);
    for (const cwd of [R, X]) {
      assert.equal(hook(R, cwd, 'Write', { file_path: `${X}/test/a.mjs`, content: 'x' }), 'deny', `cwd ${cwd}`);
      assert.equal(hook(R, cwd, 'Bash', { command: `echo x > ${X}/test/a.mjs` }), 'deny', `cwd ${cwd}`);
    }
  });

  test('anel-gitdir-ilegivel-nega: gitdir sem leitura, ou .git que não é arquivo, tira a worktree da lista e nega; nada lança', () => {
    const { R, H } = cenario();
    const gitdir = join(R, '.git', 'worktrees', 'T1', 'gitdir');
    limpar.push(gitdir);
    chmodSync(gitdir, 0o000);
    try {
      for (const tool of [['Write', { file_path: `${H}/test/a.mjs`, content: 'x' }], ['Bash', { command: `echo x > ${H}/test/a.mjs` }]]) {
        assert.equal(hook(R, R, ...tool), 'deny', 'gitdir ilegível não vira sucesso');
      }
    } finally { chmodSync(gitdir, 0o644); }
    // o ponteiro lido, mas o `.git` da worktree não é arquivo: tampouco entra
    const gitFile = join(H, '.git');
    const conteudo = readFileSync(gitFile, 'utf8');
    rmSync(gitFile);
    mkdirSync(gitFile);
    try {
      assert.equal(hook(R, R, 'Write', { file_path: `${H}/test/a.mjs`, content: 'x' }), 'deny');
    } finally { rmSync(gitFile, { recursive: true }); writeFileSync(gitFile, conteudo); }
    assert.equal(hook(R, R, 'Write', { file_path: `${H}/test/a.mjs`, content: 'x' }), undefined, 'restaurado, volta a passar');
  });

  test('anel-gitdir-ausente-nega: sem o arquivo gitdir a worktree não entra', () => {
    const { R, H } = cenario();
    const gitdir = join(R, '.git', 'worktrees', 'T1', 'gitdir');
    const conteudo = readFileSync(gitdir, 'utf8');
    rmSync(gitdir);
    try {
      assert.equal(hook(R, R, 'Write', { file_path: `${H}/test/a.mjs`, content: 'x' }), 'deny');
    } finally { writeFileSync(gitdir, conteudo); }
  });

  test('anel-caixa-nega: grafia de outra caixa não é a worktree; fica no anel do principal', () => {
    const { R, H } = cenario();
    for (const cwd of [R, H]) {
      for (const p of [`${R}/.HARNESS/WORKTREES/T1/test/a.mjs`, `${R}/.harness/WORKTREES/T1/test/a.mjs`, `${R}/.harness/worktrees/t1/test/a.mjs`]) {
        assert.equal(hook(R, cwd, 'Write', { file_path: p, content: 'x' }), 'deny', p);
      }
    }
  });

  for (const [rotulo, chave] of [['dentro', 'I'], ['fora', 'F']]) {
    test(`anel-worktree-${rotulo}: worktree ${rotulo} do repo (${chave}) recebe escrita legítima; as áreas do anel e do principal seguem barradas`, () => {
      const cen = cenario();
      const wt = cen[chave];
      for (const cwd of [cen.R, wt]) {
        for (const [nome, tool, input] of legitimos(wt)) assert.equal(hook(cen.R, cwd, tool, input), undefined, `legítimo barrado: ${nome}`);
        for (const [nome, tool, input] of ataques(wt, cen.R, { profundo: false })) assert.equal(hook(cen.R, cwd, tool, input), 'deny', `ataque passou: ${nome}`);
      }
    });
  }

  test('orquestrador-ask: os mesmos ataques, sem agent_id, pedem confirmação; escrita legítima na worktree segue silenciosa', () => {
    const { R, H } = cenario();
    for (const cwd of [R, H]) {
      for (const [nome, tool, input] of ataques(H, R, { profundo: true })) assert.equal(hook(R, cwd, tool, input, false), 'ask', nome);
      for (const [nome, tool, input] of legitimos(H)) assert.equal(hook(R, cwd, tool, input, false), undefined, nome);
    }
  });
});

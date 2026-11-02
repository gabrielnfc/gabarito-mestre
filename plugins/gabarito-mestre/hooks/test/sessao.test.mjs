/**
 * Testes de session-card.sh (ORQ-3) e remind-orchestrator.sh (ORQ-4) — separados de guards.test.mjs (GM-9 T1a).
 * Helpers em ./_comum.mjs; corpora em ./corpus. Mutações prescritas: ver o cabeçalho histórico em git (guards.test.mjs, antes do GM-9 T1a).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOKS, PLUGIN, PATH_SEM_NODE, cleanEnv, runAt, fixtureRepo } from './_comum.mjs';

// Plugin falso: só o que os hooks chamam. ${root}/${plugin} no cartão viram os argumentos recebidos;
// ${pid} (RULING F3-R1) vira process.env.GABARITO_PID_RAIZ visto pelo script Node.
function fakePluginRoot({
  cartao = ['GABARITO · cartão FAKE', 'root=${root}', 'plugin=${plugin}', 'linha com "aspas", \\ barra\te tab'],
  cartaoExit = 0,
  semCartao = false,
  capacidade = '{"slots":3,"motivo":"load ok"}',
  capacidadeExit = 0,
  semCapacidade = false,
} = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-plugin-')));
  mkdirSync(join(dir, 'gates', 'scripts'), { recursive: true });
  if (!semCartao) {
    writeFileSync(join(dir, 'gates', 'scripts', 'cartao-sessao.mjs'), `
const a = process.argv.slice(2);
const root = a[a.indexOf('--root') + 1]; const plugin = a[a.indexOf('--plugin-root') + 1];
const pid = process.env.GABARITO_PID_RAIZ || '';
const linhas = ${JSON.stringify(cartao)}.map((l) => l.replace('\${root}', root).replace('\${plugin}', plugin).replace('\${pid}', pid));
process.stdout.write(linhas.join('\\n') + '\\n');
process.exit(${cartaoExit});
`);
  }
  if (!semCapacidade) {
    // ${pid} (RULING F3-R2) vira process.env.GABARITO_PID_RAIZ, lido em runtime pelo script Node —
    // mesmo padrão do ${pid} de cartao-sessao.mjs acima. Sem ${pid} na string, o .replace() é no-op.
    writeFileSync(join(dir, 'gates', 'scripts', 'capacidade.mjs'), `
const pid = process.env.GABARITO_PID_RAIZ || '';
process.stdout.write(${JSON.stringify(capacidade)}.replace('\${pid}', pid));
process.exit(${capacidadeExit});
`);
  }
  return dir;
}
const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput;

describe('session-card.sh — ORQ-3 (T14)', () => {
  test('injeta additionalContext em SessionStart; --root é o toplevel do git mesmo em apps/api; --plugin-root é CLAUDE_PLUGIN_ROOT', () => {
    const plugin = fakePluginRoot();
    const repo = fixtureRepo();
    const r = runAt('session-card.sh', '', { cwd: join(repo, 'apps', 'api'), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const h = ctx(r);
    assert.equal(h.hookEventName, 'SessionStart');
    assert.match(h.additionalContext, /^GABARITO · cartão FAKE\n/);
    assert.ok(h.additionalContext.includes(`root=${repo}\n`), h.additionalContext);
    assert.ok(h.additionalContext.includes(`plugin=${plugin}\n`), h.additionalContext);
  });
  test('sem .git: --root é o cwd (Review Focus 2)', () => {
    const plugin = fakePluginRoot();
    const solto = fixtureRepo({ git: false });
    const r = runAt('session-card.sh', '', { cwd: join(solto, 'apps', 'api'), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.ok(ctx(r).additionalContext.includes(`root=${join(solto, 'apps', 'api')}\n`));
  });
  test('JSON válido com aspas, barra invertida e tab no cartão', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot() }, event: 'SessionStart' });
    assert.ok(ctx(r).additionalContext.includes('linha com "aspas", \\ barra\te tab'));
  });
  test('≤ 40 linhas mesmo se o script devolver 60', () => {
    const plugin = fakePluginRoot({ cartao: Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`) });
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    const linhas = ctx(r).additionalContext.split('\n');
    assert.equal(linhas.length, 40);
    assert.equal(linhas[39], 'linha 40');
  });
  test('script sai com 1 → exit 0, stdout vazio, fail-open declarado em stderr', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ cartaoExit: 1 }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cartao-sessao\.mjs saiu com 1.*fail-open declarado/);
  });
  test('CLAUDE_PLUGIN_ROOT sem gates/scripts/cartao-sessao.mjs → exit 0, fail-open declarado', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ semCartao: true }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cartao-sessao\.mjs ausente.*fail-open declarado/);
  });
  // B10 (T25b, handoff §B.10): ramo "node ausente" — PATH real sem `node`, sem stub de fakePluginRoot
  // (a checagem `command -v node` roda antes de qualquer coisa tocar em gates/scripts/cartao-sessao.mjs).
  test('node ausente do PATH → exit 0, stdout vazio, fail-open declarado em stderr (M14)', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot(), PATH: PATH_SEM_NODE }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /node ausente.*fail-open declarado/);
  });
  test('cartão vazio (só espaço) → exit 0 sem saída', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ cartao: ['', '  '] }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('stdin vazio (sem JSON) não quebra', () => {
    const r = spawnSync('bash', [join(HOOKS, 'session-card.sh')], { input: '', encoding: 'utf8', cwd: fixtureRepo(), env: cleanEnv({ CLAUDE_PLUGIN_ROOT: fakePluginRoot() }) });
    assert.equal(r.status, 0);
    assert.equal(ctx({ stdout: r.stdout }).hookEventName, 'SessionStart');
  });
  test('GABARITO_PID_RAIZ (RULING F3-R1): exportado antes de chamar o node, com o PID de quem abriu o bash do hook', () => {
    // spawnSync executa bash diretamente (sem shell intermediário): o pai do bash é este processo de teste.
    const plugin = fakePluginRoot({ cartao: ['${pid}'] });
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const texto = ctx(r).additionalContext;
    assert.notEqual(texto.trim(), '');
    assert.equal(texto.trim(), String(process.pid));
  });
  const REAL = join(PLUGIN, 'gates', 'scripts', 'cartao-sessao.mjs');
  test('smoke com o cartao-sessao.mjs real: repo sem onboarding → uma linha "sem onboarding"', { skip: !existsSync(REAL) && 'T9 ainda não integrada' }, () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo({ config: {} }), env: { CLAUDE_PLUGIN_ROOT: PLUGIN }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const texto = ctx(r).additionalContext;
    assert.match(texto, /sem onboarding/);
    assert.equal(texto.split('\n').length, 1);
  });
});

describe('remind-orchestrator.sh — ORQ-4 (T15)', () => {
  const ligado = { orquestracao: { lembretePorPrompt: true, paralelismo: { simultaneos: 2, teto: 4 } } };
  const remind = (cwd, plugin) => runAt('remind-orchestrator.sh', '', { cwd, env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'UserPromptSubmit' });

  test('lembretePorPrompt true: uma linha R21 com slots vindos de capacidade.mjs', () => {
    const r = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":3,"motivo":"load ok"}' }));
    assert.equal(r.code, 0, r.stderr);
    const h = ctx(r);
    assert.equal(h.hookEventName, 'UserPromptSubmit');
    assert.equal(h.additionalContext, 'R21: despache, não implemente · slots: 3');
  });
  test('lembretePorPrompt false: exit 0, stdout vazio', () => {
    const r = remind(fixtureRepo({ config: { orquestracao: { lembretePorPrompt: false } } }), fakePluginRoot());
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('config sem a chave: desligado, fail-open declarado em stderr; sem harness.config.json: silêncio total', () => {
    const r1 = remind(fixtureRepo({ config: { fluxo: {} } }), fakePluginRoot());
    assert.equal(r1.code, 0); assert.equal(r1.stdout, ''); assert.match(r1.stderr, /lembretePorPrompt.*fail-open declarado/);
    const r2 = remind(fixtureRepo(), fakePluginRoot());
    assert.equal(r2.code, 0); assert.equal(r2.stdout, ''); assert.equal(r2.stderr, '');
  });
  test('capacidade.mjs falha ou falta: slots vêm de paralelismo.simultaneos marcados "(config)"', () => {
    const r1 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '', capacidadeExit: 1 }));
    assert.equal(ctx(r1).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r2 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ semCapacidade: true }));
    assert.equal(ctx(r2).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r3 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: 'não é json' }));
    assert.equal(ctx(r3).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  // B10 (T25b, handoff §B.10): capacidade.mjs devolve JSON válido, mas `slots` não é inteiro
  // (float ou string) — `Number.isInteger(s)` tem de rejeitar e cair no fallback "(config)" (M15).
  test('slots não inteiro vindo de capacidade.mjs (float ou string): cai no fallback "(config)"', () => {
    const r1 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":3.5,"motivo":"load parcial"}' }));
    assert.equal(ctx(r1).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r2 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":"3","motivo":"string"}' }));
    assert.equal(ctx(r2).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  test('sem simultaneos no config e sem capacidade: default 2 (config)', () => {
    const r = remind(fixtureRepo({ config: { orquestracao: { lembretePorPrompt: true } } }), fakePluginRoot({ semCapacidade: true }));
    assert.equal(ctx(r).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  test('nunca exit 2: JSON inválido, stdin vazio, plugin root inexistente', () => {
    const casos = [
      remind(fixtureRepo({ config: '{"orquestracao": {' }), fakePluginRoot()),
      remind(fixtureRepo({ config: ligado }), '/caminho/que/nao/existe'),
      { code: spawnSync('bash', [join(HOOKS, 'remind-orchestrator.sh')], { input: '', encoding: 'utf8', cwd: fixtureRepo({ config: ligado }), env: cleanEnv({ CLAUDE_PLUGIN_ROOT: fakePluginRoot() }) }).status },
    ];
    for (const r of casos) assert.equal(r.code, 0);
  });
  test('monorepo: lembrete ligado na raiz vale em apps/api', () => {
    const repo = fixtureRepo({ config: ligado });
    const r = remind(join(repo, 'apps', 'api'), fakePluginRoot());
    assert.match(ctx(r).additionalContext, /^R21: despache/);
  });
  // RULING F3-R2 (emenda fase 2 → fase 3, vence o brief): antes de chamar capacidade.mjs, o hook exporta
  // GABARITO_PID_RAIZ=$PPID (senão process.ppid dentro do node seria o bash do hook, não o Claude Code —
  // mesmo raciocínio de F3-R1 em session-card.sh). O fake de capacidade.mjs eco o pid recebido no campo
  // `slots` (valor numérico válido); spawnSync roda bash sem shell intermediário, então o pai do bash
  // é este processo de teste — String(process.pid) tem de aparecer no slots devolvido.
  test('RULING F3-R2: GABARITO_PID_RAIZ exportado antes de chamar capacidade.mjs, com o pid de quem abriu o bash do hook', () => {
    const r = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":${pid},"motivo":"eco pid"}' }));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(ctx(r).additionalContext, `R21: despache, não implemente · slots: ${process.pid}`);
  });
});

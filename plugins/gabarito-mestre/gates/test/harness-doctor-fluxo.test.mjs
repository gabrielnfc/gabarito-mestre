/**
 * GM-16 T5 (REQ-DCT-1): o doctor avisa quando o quadro FL1 e o git discordam.
 *
 *   `fluxo-status-fl1`     cards cujo status não é coluna do quadro (predicado `ehColunaFl1` do dist/, nunca cópia)
 *   `pbi-mergeado-aberto`  card em aberto (`ehFeito` falso) cujo ID é o ESCOPO de um commit de PBI no 1º pai da BASE DA ENTREGA
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem de morrer por asserção; o roteiro está em `.tmp-gabarito/mutacoes.json`)
 *  M5a casar sem fronteira · M5b aviso no nível · M5c git ilegível dizendo "ok" · M5d predicado copiado em vez de importado
 *  M5e casar o ID fora do escopo (no assunto) · M5f aceitar `docs` como tipo · M5g dist/projeto.js de volta ao Promise.all
 *  M5h `versionamento.branchPadrao` como nome da branch · M5i base inexistente caindo em `main` ou em "ok"
 *  M5j regra da base copiada em vez de `resolverBaseEntrega` importada · M5k config da worktree em vez do objeto do HEAD
 *
 * Fixtures são sintéticas e geradas por código; git real com `user.name`/`user.email` locais, HOME vazio e `user.useConfigOnly=true`.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { lerConfigHead, lerConfigOrigin } from '../lib/config.mjs';
import { resolverBaseEntrega, lerConfigEntrega } from '../dist/entrega.js';
import { repoComGit, fixtureNivel2_110, git as gitH, hoje } from './_doctor-helpers.mjs';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(GATES, 'scripts', 'harness-doctor.mjs');
const FL1 = 'docs/fluxo/pbis';
const TIPOS_PBI = ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'];

const HOME_VAZIO = mkdtempSync(join(tmpdir(), 'doctor-fluxo-home-'));
const ENV_LIMPO = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const ENV_GIT = { ...ENV_LIMPO, HOME: HOME_VAZIO, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false' };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV_GIT, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const dirs = [HOME_VAZIO];
const novoDir = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const STATUS_PADRAO = { preparado: 'Preparado', em_execucao: 'Em execução', revisao: 'Revisão e teste', pronto: 'Pronto para liberar', concluido: 'Concluído' };
const cfgFluxo = (extra = {}, fluxo = {}) => ({ fluxo: { ferramenta: 'arquivos', mapeamento: { FL1: `${FL1}/` }, status: { FL1: STATUS_PADRAO }, ...fluxo }, ...extra });
const cardTexto = (id, status) => `---\nid: ${id}\n${status === null ? '' : `status: ${status}\n`}---\n# Card ${id}\n`;

/**
 * Repo git sintético. `cards`: { ID: status|null }; `subjects`: commits vazios na `trunk`, depois do inicial; `branches`: { nome: [assuntos] }
 * saindo do commit inicial (o config commitado está nele). `semGit`: só arquivos. Devolve `{ dir, git }`.
 */
function fixture({ config = cfgFluxo(), configTexto, cards = {}, subjects = [], trunk = 'trunk', branches = {}, semGit = false, semPasta = false, extra = {} } = {}) {
  const dir = novoDir('doctor-fluxo-');
  writeFileSync(join(dir, 'harness.config.json'), configTexto ?? JSON.stringify(config));
  if (!semPasta) {
    mkdirSync(join(dir, FL1), { recursive: true });
    for (const [id, status] of Object.entries(cards)) writeFileSync(join(dir, FL1, `${id}.md`), cardTexto(id, status));
  }
  for (const [rel, texto] of Object.entries(extra)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), texto); }
  if (semGit) return { dir, git: (...a) => git(dir, ...a) };
  git(dir, 'init', '-q', '-b', trunk);
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'user.email', 'fixture@exemplo.dev');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: inicial');
  const inicial = git(dir, 'rev-parse', 'HEAD');
  for (const s of subjects) git(dir, 'commit', '-q', '--allow-empty', '-m', s);
  for (const [nome, assuntos] of Object.entries(branches)) {
    git(dir, 'checkout', '-q', '-b', nome, inicial);
    for (const s of assuntos) git(dir, 'commit', '-q', '--allow-empty', '-m', s);
    git(dir, 'checkout', '-q', trunk);
  }
  return { dir, git: (...a) => git(dir, ...a) };
}

function doctor(dir, { script = SCRIPT, args = ['--json'] } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: ENV_GIT, timeout: 60_000 });
  let json = null;
  if (args.includes('--json')) {
    try { json = JSON.parse(r.stdout); } catch { assert.fail(`saída --json ilegível (rc ${r.status}): ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 300)}`); }
  }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}
const achar = (out, id) => {
  const r = out.json.resultados.find((x) => x.id === id);
  assert.ok(r, `check ${id} ausente do doctor`);
  return r;
};
const aviso = (dir, id) => achar(doctor(dir), id);

describe('fluxo-status-fl1 (REQ-DCT-1 a)', () => {
  test('doctor-status-invalido-avisa: lista N cards, os 3 primeiros com o status, e a dica da chave', () => {
    const { dir } = fixture({ cards: { 'PBI-1': 'Backlog', 'PBI-2': 'Doing', 'PBI-3': 'Preparado', 'PBI-4': 'Triagem', 'PBI-5': 'Parado' } });
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.level, 'warn');
    assert.equal(r.found, false);
    assert.match(r.evidence, /^4 cards; 3 primeiros: PBI-1 \(Backlog\), PBI-2 \(Doing\), PBI-4 \(Triagem\)/);
    assert.ok(!r.evidence.includes('PBI-5'), 'só os 3 primeiros entram na lista');
    assert.ok(!r.evidence.includes('PBI-3'), 'card com status do quadro não entra');
    assert.match(r.evidence, /painel\.projeto\.opcoesComoContagem: true/);
    assert.match(r.evidence, /N opções/);
  });

  test('doctor-status-invalido-avisa: com a chave ligada a dica não aparece (cláusula negativa)', () => {
    const { dir } = fixture({ config: cfgFluxo({ painel: { projeto: { opcoesComoContagem: true } } }), cards: { 'PBI-1': 'Backlog' } });
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.found, false);
    assert.match(r.evidence, /^1 cards; 3 primeiros: PBI-1 \(Backlog\)/);
    assert.ok(!/opcoesComoContagem/.test(r.evidence), r.evidence);
  });

  test('doctor-status-valido-calado: todos no quadro (nome, chave, sem acento e caixa) ⇒ found true', () => {
    const { dir } = fixture({ cards: { 'PBI-1': 'Preparado', 'PBI-2': 'em execucao', 'PBI-3': 'concluido', 'PBI-4': 'PRONTO PARA LIBERAR', 'PBI-5': '"Revisão e teste"' } });
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.found, true, r.evidence);
    assert.match(r.evidence, /5 cards/);
  });

  test('doctor-status-valido-calado: o `concluido` configurado (Done) também é do quadro; Backlog não', () => {
    const { dir } = fixture({ config: cfgFluxo({}, { status: { FL1: { concluido: 'Done' } } }), cards: { 'PBI-1': 'Done', 'PBI-2': 'Concluído', 'PBI-3': 'Backlog' } });
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.found, false);
    assert.match(r.evidence, /^1 cards; 3 primeiros: PBI-3 \(Backlog\)/);
  });

  test('doctor-sem-status-calado: card sem status não entra na lista', () => {
    const { dir } = fixture({ cards: { 'PBI-1': null, 'PBI-2': 'Triagem' } });
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.found, false);
    assert.match(r.evidence, /^1 cards; 3 primeiros: PBI-2 \(Triagem\)/);
    assert.ok(!r.evidence.includes('PBI-1'));
    const so = fixture({ cards: { 'PBI-1': null } });
    const r2 = aviso(so.dir, 'fluxo-status-fl1');
    assert.equal(r2.found, true, r2.evidence);
  });

  test('doctor-evidencia-sem-controle: status com escape e texto longo vira linha curta e limpa', () => {
    const { dir } = fixture({ cards: { 'PBI-1': `Ruim\u001b[31m${'x'.repeat(500)}` } });
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.found, false);
    assert.ok(!r.evidence.includes('\u001b'), 'sem caractere de controle');
    assert.ok(r.evidence.length < 400, `evidência com ${r.evidence.length} caracteres`);
  });

  test('doctor-sem-pasta-nao-se-aplica: pasta ausente ou ferramenta ≠ arquivos ⇒ found true, "não se aplica", nos 2 checks', () => {
    const ausente = fixture({ semPasta: true, cards: {} });
    const clickup = fixture({ config: cfgFluxo({}, { ferramenta: 'clickup' }), cards: { 'PBI-1': 'Backlog' }, subjects: ['feat(PBI-1): x'] });
    const semFluxo = fixture({ config: {}, subjects: ['feat(PBI-1): x'] });
    for (const { dir } of [ausente, clickup, semFluxo]) {
      const out = doctor(dir);
      for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
        const r = achar(out, id);
        assert.equal(r.level, 'warn');
        assert.equal(r.found, true, `${id}: ${r.evidence}`);
        assert.match(r.evidence, /não se aplica/, id);
      }
    }
  });

  test('doctor-pasta-ilegivel: pasta FL1 que não é pasta ⇒ "não conferido", nunca "ok" nem "não se aplica"', () => {
    const { dir } = fixture({ semPasta: true, extra: { [FL1]: 'isto é um arquivo, não uma pasta' } });
    const out = doctor(dir);
    for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
      const r = achar(out, id);
      assert.equal(r.found, false, `${id}: ${r.evidence}`);
      assert.match(r.evidence, /não conferido/, id);
      assert.ok(!/não se aplica/.test(r.evidence), id);
    }
  });

  test('doctor-config-ilegivel: harness.config.json quebrado ou que não é objeto ⇒ "não conferido" nos DOIS checks, nunca "não se aplica"', () => {
    for (const configTexto of ['{', '[]', '"texto"']) {
      const { dir } = fixture({ configTexto, cards: { 'PBI-1': 'Preparado' }, subjects: ['feat(PBI-1): x'] });
      const out = doctor(dir);
      for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
        const r = achar(out, id);
        assert.equal(r.found, false, `${configTexto} ${id}: ${r.evidence}`);
        assert.match(r.evidence, /não conferido/, `${configTexto} ${id}`);
        assert.match(r.evidence, /harness\.config\.json inválido/, `${configTexto} ${id}`);
        assert.ok(!/não se aplica/.test(r.evidence), `${configTexto} ${id}`);
      }
    }
  });

  test('doctor-fl1-invalido: fluxo.mapeamento.FL1 com `..`, absoluto, vazio ou não texto ⇒ "não conferido", nunca "não se aplica"', () => {
    for (const FL1Cfg of ['../x', 'a/../b', '/etc', '/', '', 5]) {
      const { dir } = fixture({ config: cfgFluxo({}, { mapeamento: { FL1: FL1Cfg } }), cards: { 'PBI-1': 'Preparado' }, subjects: ['feat(PBI-1): x'] });
      const out = doctor(dir);
      for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
        const r = achar(out, id);
        assert.equal(r.found, false, `FL1=${JSON.stringify(FL1Cfg)} ${id}: ${r.evidence}`);
        assert.match(r.evidence, /não conferido/, `FL1=${JSON.stringify(FL1Cfg)} ${id}`);
        assert.match(r.evidence, /fluxo\.mapeamento\.FL1 inválido/, `FL1=${JSON.stringify(FL1Cfg)} ${id}`);
      }
    }
  });

  test('doctor-config-ausente: sem harness.config.json (no HEAD e na worktree) ⇒ "não se aplica" nos 2 checks, por desenho', () => {
    const { dir, git: g } = fixture({ cards: { 'PBI-1': 'Preparado' }, subjects: ['feat(PBI-1): x'] });
    g('rm', '-q', 'harness.config.json');
    g('commit', '-q', '-m', 'chore: sem config');
    const out = doctor(dir);
    for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
      const r = achar(out, id);
      assert.equal(r.found, true, `${id}: ${r.evidence}`);
      assert.match(r.evidence, /não se aplica/, id);
    }
  });

  test('doctor-config-ignorada-pelo-git: config ignorada pelo git vale como ausente (como no clone) ⇒ "não se aplica"', () => {
    const { dir } = fixture({ cards: { 'PBI-1': 'Preparado' }, subjects: ['feat(PBI-1): x'], extra: { '.gitignore': 'harness.config.json\n' } });
    const out = doctor(dir);
    for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
      const r = achar(out, id);
      assert.equal(r.found, true, `${id}: ${r.evidence}`);
      assert.match(r.evidence, /não se aplica/, id);
    }
  });

  test('doctor-fl1-ausente: fluxo por arquivos sem fluxo.mapeamento.FL1 ⇒ "não se aplica", nunca "inválido"', () => {
    const { dir } = fixture({ config: cfgFluxo({}, { mapeamento: {} }), cards: { 'PBI-1': 'Preparado' }, subjects: ['feat(PBI-1): x'] });
    const out = doctor(dir);
    for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
      const r = achar(out, id);
      assert.equal(r.found, true, `${id}: ${r.evidence}`);
      assert.match(r.evidence, /não se aplica/, id);
    }
  });

  test('doctor-card-gigante: card acima do teto não passa por regex; vira "não conferido"', () => {
    const { dir } = fixture({ cards: { 'PBI-1': 'Preparado' } });
    writeFileSync(join(dir, FL1, 'PBI-2.md'), `${cardTexto('PBI-2', 'Backlog')}${'a'.repeat(2 * 1024 * 1024)}`);
    const r = aviso(dir, 'fluxo-status-fl1');
    assert.equal(r.found, false);
    assert.match(r.evidence, /não conferido/);
    assert.match(r.evidence, /PBI-2\.md/);
  });

  // Um teste por ramo de falha da leitura do card (teto, não-arquivo, erro de I/O): leitura ilegível nunca vira ok nem 0.
  test('doctor-card-sem-permissao: card com EACCES ao lado de um Concluído vira "não conferido" nos DOIS checks', (t) => {
    if (process.getuid?.() === 0) return t.skip('root lê card chmod 000');
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-1': 'Concluído', 'PBI-2': 'Preparado' }, subjects: ['feat(PBI-2): x'] });
    const card = join(dir, FL1, 'PBI-2.md');
    chmodSync(card, 0);
    t.after(() => chmodSync(card, 0o644));
    const out = doctor(dir);
    for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
      const r = achar(out, id);
      assert.equal(r.found, false, `${id}: ${r.evidence}`);
      assert.match(r.evidence, /não conferido/, id);
      assert.match(r.evidence, /PBI-2\.md/, id);
    }
  });

  test('doctor-card-symlink: card que é symlink para fora da pasta não é seguido; vira "não conferido"', () => {
    const { dir } = fixture({ cards: { 'PBI-1': 'Concluído' } });
    const fora = join(novoDir('doctor-fluxo-fora-'), 'alvo.md');
    writeFileSync(fora, cardTexto('PBI-2', 'Backlog'));
    symlinkSync(fora, join(dir, FL1, 'PBI-2.md'));
    const out = doctor(dir);
    const r = achar(out, 'fluxo-status-fl1');
    assert.equal(r.found, false, r.evidence);
    assert.match(r.evidence, /não conferido/);
    assert.match(r.evidence, /PBI-2\.md/);
    assert.ok(!/Backlog/.test(r.evidence), 'o alvo do symlink não foi lido');
  });
});

describe('pbi-mergeado-aberto (REQ-DCT-1 b, e)', () => {
  test('doctor-mergeado-nao-concluido-avisa: aberto + commit de PBI na base ⇒ aviso com a base; concluído cala', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Em execução', 'PBI-8': 'Concluído', 'PBI-9': 'Preparado' }, subjects: ['feat(PBI-7): x', 'fix(PBI-8): y'] });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.level, 'warn');
    assert.equal(r.found, false);
    assert.match(r.evidence, /1 PBI\(s\)/);
    assert.match(r.evidence, /PBI-7 \(Em execução\)/);
    assert.ok(!r.evidence.includes('PBI-8'), 'concluído não avisa');
    assert.ok(!r.evidence.includes('PBI-9'), 'sem commit não avisa');
    assert.match(r.evidence, /base `trunk`/);
  });

  test('doctor-mergeado-card-ilegivel: card ilegível nunca vira "0 em aberto" calado, com ou sem outros abertos', () => {
    const gigante = (dir) => writeFileSync(join(dir, FL1, 'PBI-2.md'), `${cardTexto('PBI-2', 'Backlog')}${'a'.repeat(2 * 1024 * 1024)}`);
    // (1) nenhum card aberto legível: só o ilegível pode estar aberto
    const a = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-1': 'Concluído' }, subjects: ['feat(PBI-1): x'] });
    gigante(a.dir);
    const ra = aviso(a.dir, 'pbi-mergeado-aberto');
    assert.equal(ra.found, false, ra.evidence);
    assert.match(ra.evidence, /não conferido/);
    assert.match(ra.evidence, /PBI-2\.md/);
    assert.ok(!/0 PBI\(s\) em aberto/.test(ra.evidence), ra.evidence);
    // (2) há aberto legível, sem commit de PBI na base: o ilegível ainda tem de aparecer
    const b = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-1': 'Preparado' }, subjects: [] });
    gigante(b.dir);
    const rb = aviso(b.dir, 'pbi-mergeado-aberto');
    assert.equal(rb.found, false, rb.evidence);
    assert.match(rb.evidence, /PBI-2\.md/);
    // (3) há aberto mergeado: aviso do mergeado e o ilegível, juntos
    const c = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, subjects: ['feat(PBI-7): x'] });
    gigante(c.dir);
    const rc = aviso(c.dir, 'pbi-mergeado-aberto');
    assert.equal(rc.found, false);
    assert.match(rc.evidence, /PBI-7 \(Preparado\)/);
    assert.match(rc.evidence, /PBI-2\.md/);
  });

  test('doctor-mergeado-nao-concluido-avisa: "feito" é o `concluido` configurado (Done) e o fixo', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }, { status: { FL1: { concluido: 'Done' } } }), cards: { 'PBI-7': 'Done', 'PBI-8': 'Concluído', 'PBI-9': 'Backlog' }, subjects: ['feat(PBI-7): x', 'feat(PBI-8): x', 'feat(PBI-9): x'] });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false);
    assert.match(r.evidence, /1 PBI\(s\)/);
    assert.match(r.evidence, /PBI-9 \(Backlog\)/);
  });

  test('doctor-mergeado-nao-concluido-avisa: card sem status é aberto', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': null }, subjects: ['feat(PBI-7): x'] });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false);
    assert.match(r.evidence, /PBI-7/);
  });

  test('doctor-escopo-exato: só o escopo inteiro de um tipo de PBI avisa', () => {
    const casos = [
      ['feat(PBI-7): x', true], ['fix(PBI-7)!: x', true], ['refactor(PBI-7): x', true], ['spike(PBI-7): x', true],
      ['docs(fluxo): cria card PBI-7', false], ['docs(PBI-7): x', false], ['chore(PBI-7): x', false], ['test(PBI-7): x', false],
      ['feat(PBI-70): x', false], ['fix: PBI-7 x', false], ['feat(x): PBI-7 x', false], ['feat(PBI-7 PBI-8): x', false], ['feat(PBI-7)x', false],
    ];
    for (const [assunto, avisa] of casos) {
      const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Em execução' }, subjects: [assunto] });
      const r = aviso(dir, 'pbi-mergeado-aberto');
      assert.equal(r.found, !avisa, `${assunto}: ${r.evidence}`);
    }
    // o ID curto não casa o longo (fronteira): PBI-5 aberto, commit de PBI-50
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-5': 'Preparado', 'PBI-50': 'Preparado' }, subjects: ['feat(PBI-50): x'] });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false);
    assert.match(r.evidence, /PBI-50 \(Preparado\)/);
    assert.ok(!/PBI-5 \(/.test(r.evidence), r.evidence);
  });

  test('doctor-escopo-exato: os tipos prescritos são exatamente os de versionamento-check', () => {
    for (const t of TIPOS_PBI) {
      const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, subjects: [`${t}(PBI-7): x`] });
      assert.equal(aviso(dir, 'pbi-mergeado-aberto').found, false, t);
    }
  });

  test('doctor-mergeado-so-1o-pai: commit de PBI que só entra pelo 2º pai de um merge não avisa', () => {
    const { dir, git: g } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' } });
    g('checkout', '-q', '-b', 'feat/PBI-7');
    g('commit', '-q', '--allow-empty', '-m', 'feat(PBI-7): x');
    g('checkout', '-q', 'trunk');
    g('merge', '-q', '--no-ff', '-m', 'chore: junta a feature', 'feat/PBI-7');
    assert.equal(aviso(dir, 'pbi-mergeado-aberto').found, true);
  });

  test('doctor-sem-git-nao-conferido: sem git, ou git corrompido, com card aberto ⇒ "não conferido", nunca "ok"', () => {
    const sem = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, semGit: true });
    const corrompido = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, semGit: true });
    mkdirSync(join(corrompido.dir, '.git'));
    writeFileSync(join(corrompido.dir, '.git', 'HEAD'), 'lixo');
    for (const { dir } of [sem, corrompido]) {
      const r = aviso(dir, 'pbi-mergeado-aberto');
      assert.equal(r.found, false, r.evidence);
      assert.match(r.evidence, /não conferido/);
      assert.ok(!/nenhum/i.test(r.evidence), r.evidence);
    }
  });

  test('doctor-log-ilegivel: a base existe mas o histórico tem objeto faltando ⇒ "não conferido", nunca "ok"', () => {
    const { dir, git: g } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, subjects: ['feat(PBI-7): x', 'chore: topo'] });
    const meio = g('rev-parse', 'HEAD~1');
    rmSync(join(dir, '.git', 'objects', meio.slice(0, 2), meio.slice(2)), { force: true });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false, r.evidence);
    assert.match(r.evidence, /não conferido \(git ilegível ao ler o log de refs\/heads\/trunk\)/);
  });

  test('doctor-sem-aberto:sem card em aberto não precisa de git e fica calado', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Concluído' }, semGit: true });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, true, r.evidence);
  });

  const REGEX_PADRAO = '^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$';

  test('doctor-mergeado-config-default: trunk `trunk` sem `main` e `entrega.base: trunk` ⇒ avisa, com a regex padrão ausente e escrita na chave', () => {
    for (const versionamento of [undefined, { branchPadrao: REGEX_PADRAO }]) {
      const config = cfgFluxo({ entrega: { base: 'trunk' }, ...(versionamento ? { versionamento } : {}) });
      const { dir, git: g } = fixture({ config, cards: { 'PBI-7': 'Em execução' }, subjects: ['feat(PBI-7): x'] });
      assert.equal(g('branch', '--list', 'main'), '', 'premissa: o repositório não tem `main`');
      const r = aviso(dir, 'pbi-mergeado-aberto');
      assert.equal(r.found, false, `versionamento=${JSON.stringify(versionamento)}: ${r.evidence}`);
      assert.match(r.evidence, /PBI-7/);
      assert.match(r.evidence, /base `trunk`/);
    }
  });

  test('doctor-mergeado-base-inexistente: sem `entrega.base` num repositório de trunk `trunk` ⇒ "não conferido", nunca "ok" nem a branch atual', () => {
    const { dir } = fixture({ config: cfgFluxo(), cards: { 'PBI-7': 'Em execução' }, subjects: ['feat(PBI-7): x'] });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false);
    assert.match(r.evidence, /não conferido \(base `main` não existe; declare `entrega\.base`\)/);
    assert.ok(!/PBI-7/.test(r.evidence), `não leu outra branch: ${r.evidence}`);
    assert.match(r.evidence, /nenhuma base declarada/, 'diz de onde veio a base (o `aviso` do resolvedor)');
    const declarada = fixture({ config: cfgFluxo({ entrega: { base: 'fantasma' } }), cards: { 'PBI-7': 'Em execução' }, subjects: ['feat(PBI-7): x'] });
    const r2 = aviso(declarada.dir, 'pbi-mergeado-aberto');
    assert.equal(r2.found, false);
    assert.match(r2.evidence, /não conferido \(base `fantasma` não existe/);
    assert.ok(!/PBI-7/.test(r2.evidence), r2.evidence);
  });

  test('doctor-mergeado-base-da-entrega: a branch lida é a `base` de resolverBaseEntrega, para 3 configs', () => {
    const casos = [
      { nome: 'nada declarado ⇒ main', entrega: undefined, esperada: 'main', id: 'PBI-1' },
      { nome: 'base do HEAD', entrega: { base: 'trunk' }, esperada: 'trunk', id: 'PBI-2' },
      { nome: 'outra base', entrega: { base: 'release' }, esperada: 'release', id: 'PBI-3' },
    ];
    for (const c of casos) {
      const config = cfgFluxo(c.entrega === undefined ? {} : { entrega: c.entrega });
      const { dir } = fixture({
        config, cards: { 'PBI-1': 'Preparado', 'PBI-2': 'Preparado', 'PBI-3': 'Preparado' }, trunk: 'raiz',
        branches: { main: ['feat(PBI-1): x'], trunk: ['feat(PBI-2): x'], release: ['feat(PBI-3): x'] },
      });
      // a regra da entrega, calculada pela MESMA função, com as mesmas entradas
      const origin = lerConfigOrigin(dir);
      const base = resolverBaseEntrega(lerConfigEntrega(origin.cfg), origin.cfg?.entrega?.base !== undefined, lerConfigHead(dir)).base;
      assert.equal(base, c.esperada, `${c.nome}: premissa da entrega`);
      const r = aviso(dir, 'pbi-mergeado-aberto');
      assert.equal(r.found, false, `${c.nome}: ${r.evidence}`);
      assert.match(r.evidence, new RegExp(`base \`${base}\``), c.nome);
      assert.match(r.evidence, new RegExp(`${c.id} \\(`), `${c.nome}: lê a branch ${base}: ${r.evidence}`);
      for (const outro of ['PBI-1', 'PBI-2', 'PBI-3'].filter((x) => x !== c.id)) assert.ok(!r.evidence.includes(outro), `${c.nome}: não lê outra branch (${outro}): ${r.evidence}`);
    }
  });

  test('doctor-mergeado-ref-remota: `refs/remotes/origin/<base>` vale antes de `refs/heads/<base>`', () => {
    const { dir, git: g } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' } });
    assert.equal(aviso(dir, 'pbi-mergeado-aberto').found, true, 'premissa: a trunk local ainda não tem o commit');
    const local = g('rev-parse', 'HEAD');
    g('commit', '-q', '--allow-empty', '-m', 'feat(PBI-7): x');
    g('update-ref', 'refs/remotes/origin/trunk', g('rev-parse', 'HEAD'));
    g('reset', '-q', '--hard', local);
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false, r.evidence);
    assert.match(r.evidence, /PBI-7/);
  });

  test('doctor-mergeado-config-do-head: lê o config COMMITADO no HEAD, nunca a edição não commitada da worktree (M5k)', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, subjects: ['feat(PBI-7): x'] });
    writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfgFluxo({ entrega: { base: 'outra' } })));
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false, r.evidence);
    assert.match(r.evidence, /base `trunk`/);
    assert.match(r.evidence, /PBI-7/);
  });

  // Config de origin/HEAD: commit à parte com o texto dado, a ref de nome completo aponta para ele e o HEAD volta ao estado de antes.
  const comOrigin = (dir, texto) => {
    const antes = git(dir, 'rev-parse', 'HEAD');
    writeFileSync(join(dir, 'harness.config.json'), texto);
    git(dir, 'commit', '-q', '-am', 'chore: config de origin');
    git(dir, 'update-ref', 'refs/remotes/origin/HEAD', git(dir, 'rev-parse', 'HEAD'));
    git(dir, 'reset', '-q', '--hard', antes);
  };
  const cenarioOrigin = (entregaHead) => fixture({
    config: cfgFluxo(entregaHead === undefined ? {} : { entrega: entregaHead }), cards: { 'PBI-2': 'Preparado', 'PBI-3': 'Preparado' },
    subjects: ['feat(PBI-2): x'], branches: { release: ['feat(PBI-3): x'] },
  });

  test('doctor-origin-vence-o-head: `entrega.base` de origin/HEAD vale mais que a do HEAD, e a evidência diz de onde veio (R2-A)', () => {
    const { dir } = cenarioOrigin({ base: 'trunk' });
    comOrigin(dir, JSON.stringify(cfgFluxo({ entrega: { base: 'release' } })));
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false, r.evidence);
    assert.match(r.evidence, /base `release`/);
    assert.match(r.evidence, /PBI-3 \(/, 'lê a branch da base de origin');
    assert.ok(!r.evidence.includes('PBI-2'), `não lê a base do HEAD: ${r.evidence}`);
    assert.match(r.evidence, /origin\/HEAD/, 'diz de onde veio a base');
  });

  test('doctor-origem-da-base-no-ok: sem PBI mergeado a evidência (ok) ainda diz a base usada e de onde veio', () => {
    const { dir } = fixture({ config: cfgFluxo(), cards: { 'PBI-9': 'Preparado' }, branches: { release: ['chore: x'] } });
    comOrigin(dir, JSON.stringify(cfgFluxo({ entrega: { base: 'release' } })));
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, true, r.evidence);
    assert.match(r.evidence, /na base `release` \(entrega\.base de origin\/HEAD\)/);
  });

  test('doctor-origin-ilegivel: config de origin/HEAD ilegível ⇒ "não conferido" com o motivo, nunca "nenhuma base declarada" nem ok', () => {
    for (const [nome, texto, motivo] of [['JSON quebrado', '{ nao json', /JSON ilegível/], ['array', '[]', /array|não é objeto/], ['escalar', '42', /não é objeto/]]) {
      const { dir } = cenarioOrigin({ base: 'trunk' });
      comOrigin(dir, texto);
      const r = aviso(dir, 'pbi-mergeado-aberto');
      assert.equal(r.found, false, `${nome}: ${r.evidence}`);
      assert.match(r.evidence, /não conferido \(config de origin inválida: /, nome);
      assert.match(r.evidence, motivo, nome);
      assert.ok(!/nenhuma base declarada/.test(r.evidence), `${nome}: ${r.evidence}`);
      assert.ok(!/PBI-2|PBI-3/.test(r.evidence), `${nome}: não leu base nenhuma: ${r.evidence}`);
    }
  });

  test('doctor-origin-base-invalida: `entrega.base` inválida em origin/HEAD ⇒ "não conferido" com o erro, nunca a `main` por baixo', () => {
    for (const base of ['..x', 'a b', 7]) {
      const { dir } = cenarioOrigin({ base: 'trunk' });
      comOrigin(dir, JSON.stringify(cfgFluxo({ entrega: { base } })));
      const r = aviso(dir, 'pbi-mergeado-aberto');
      assert.equal(r.found, false, `base ${JSON.stringify(base)}: ${r.evidence}`);
      assert.match(r.evidence, /não conferido \(config de origin inválida: entrega\.base/, JSON.stringify(base));
      assert.ok(!/PBI-2|PBI-3/.test(r.evidence), r.evidence);
    }
  });

  test('doctor-origin-ausente-nao-e-invalida: sem origin/HEAD ou sem arquivo nela, vale o HEAD (ausente não vira "inválida")', () => {
    const sem = cenarioOrigin({ base: 'trunk' });
    const rs = aviso(sem.dir, 'pbi-mergeado-aberto');
    assert.match(rs.evidence, /base `trunk`/);
    assert.ok(!/inválida/.test(rs.evidence), rs.evidence);
  });

  test('doctor-avisos-nao-mudam-nivel: os 2 avisos ativos (nível 2 mantido, exit 0) e o texto sai na tabela do CLI real', () => {
    const arquivos = {
      ...fixtureNivel2_110(2, cfgFluxo({ entrega: { base: 'main' } }, { resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' })),
      [`${FL1}/PBI-1.md`]: cardTexto('PBI-1', 'Triagem'),
      [`${FL1}/PBI-7.md`]: cardTexto('PBI-7', 'Em execução'),
    };
    const limpo = repoComGit({ ...arquivos, [`${FL1}/PBI-1.md`]: cardTexto('PBI-1', 'Preparado'), [`${FL1}/PBI-7.md`]: cardTexto('PBI-7', 'Preparado') });
    const dir = repoComGit(arquivos);
    gitH(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-7): x');
    dirs.push(dir, limpo);
    const a = doctor(dir);
    const b = doctor(limpo);
    assert.equal(achar(a, 'fluxo-status-fl1').found, false);
    assert.equal(achar(a, 'pbi-mergeado-aberto').found, false);
    assert.equal(achar(b, 'fluxo-status-fl1').found, true);
    assert.equal(achar(b, 'pbi-mergeado-aberto').found, true);
    for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) { assert.equal(achar(a, id).level, 'warn'); assert.equal(achar(b, id).level, 'warn'); }
    assert.equal(b.json.alcancado, 2, 'premissa: a fixture limpa chega ao nível 2');
    assert.equal(a.json.alcancado, b.json.alcancado, 'os avisos não mexem no nível');
    assert.equal(a.status, b.status, 'nem no exit code');
    assert.equal(a.status, 0);
    const humano = doctor(dir, { args: [] });
    assert.equal(humano.status, 0, humano.stdout);
    assert.match(humano.stdout, /── Avisos/);
    assert.match(humano.stdout, /warn REQ-DCT-1 .*status que não é coluna do quadro\n\s+↳ 1 cards; 3 primeiros: PBI-1 \(Triagem\)/);
    assert.match(humano.stdout, /warn REQ-DCT-1 .*commit de PBI na base da entrega\n\s+↳ .*PBI-7 \(Em execução\)/);
  });
});

describe('lerConfigHead (movida para lib/config.mjs, REQ-DCT-1 e)', () => {
  test('objeto do git, nunca a worktree; ausente, array e ilegível viram null', () => {
    const { dir, git: g } = fixture({ config: { entrega: { base: 'trunk' } } });
    writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ entrega: { base: 'outra' } }));
    assert.deepEqual(lerConfigHead(dir), { entrega: { base: 'trunk' } });
    for (const texto of ['[1,2]', '{ torto', '"texto"', 'null']) {
      writeFileSync(join(dir, 'harness.config.json'), texto);
      g('commit', '-q', '-a', '-m', 'chore: config torto');
      assert.equal(lerConfigHead(dir), null, texto);
    }
    g('rm', '-q', 'harness.config.json');
    g('commit', '-q', '-m', 'chore: sem config');
    assert.equal(lerConfigHead(dir), null, 'ausente');
    assert.equal(lerConfigHead(novoDir('sem-repo-')), null, 'fora de repositório');
  });
});

describe('dist/ do doctor: import próprio, nunca cópia da regra (REQ-DCT-1 d)', () => {
  let copia;
  before(() => {
    copia = novoDir('doctor-fluxo-gates-');
    cpSync(GATES, copia, { recursive: true, filter: (s) => { const r = relative(GATES, s); return !/^(node_modules|test|\.tmp-gabarito)(\/|$)/.test(r); } });
  });
  const reescreve = (rel, f) => { const a = join(copia, rel); const original = readFileSync(a, 'utf8'); writeFileSync(a, f(original)); return () => writeFileSync(a, original); };

  test('doctor-projeto-dist-quebrado: dist/projeto.js ilegível ⇒ os 2 checks "não conferido" e o aprendizado segue conferido', () => {
    const desfaz = reescreve('dist/projeto.js', () => 'export const = ;\n');
    try {
      const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Backlog' }, subjects: ['feat(PBI-7): x'] });
      const out = doctor(dir, { script: join(copia, 'scripts', 'harness-doctor.mjs') });
      for (const id of ['fluxo-status-fl1', 'pbi-mergeado-aberto']) {
        const r = achar(out, id);
        assert.equal(r.found, false, id);
        assert.match(r.evidence, /não conferido \(dist\/projeto\.js não carregou/, id);
      }
      const ap = achar(out, 'aprendizado-sem-destino');
      assert.equal(ap.found, true, ap.evidence);
      assert.ok(!/não carregou/.test(ap.evidence), ap.evidence);
    } finally { desfaz(); }
  });

  test('doctor-projeto-dist-quebrado: dist/entrega.js ilegível ⇒ só o pbi-mergeado-aberto fica "não conferido"', () => {
    const desfaz = reescreve('dist/entrega.js', () => 'export const = ;\n');
    try {
      const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Backlog' }, subjects: ['feat(PBI-7): x'] });
      const out = doctor(dir, { script: join(copia, 'scripts', 'harness-doctor.mjs') });
      const m = achar(out, 'pbi-mergeado-aberto');
      assert.equal(m.found, false);
      assert.match(m.evidence, /não conferido \(dist\/entrega\.js não carregou/);
      const s = achar(out, 'fluxo-status-fl1');
      assert.equal(s.found, false);
      assert.match(s.evidence, /PBI-7 \(Backlog\)/, 'o aviso de status segue lendo o dist/projeto.js');
      assert.equal(achar(out, 'aprendizado-sem-destino').found, true);
    } finally { desfaz(); }
  });

  test('doctor-predicados-importados: trocar `ehColunaFl1` e `ehFeito` no dist/ muda o veredito do doctor (M5d)', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-1': 'Backlog', 'PBI-7': 'Preparado' }, subjects: ['feat(PBI-7): x'] });
    const script = join(copia, 'scripts', 'harness-doctor.mjs');
    const antes = doctor(dir, { script });
    assert.equal(achar(antes, 'fluxo-status-fl1').found, false);
    assert.equal(achar(antes, 'pbi-mergeado-aberto').found, false);
    const desfaz = reescreve('dist/projeto.js', (t) => `${t.replace('export function ehColunaFl1(', 'function ehColunaFl1_original(').replace('export function ehFeito(', 'function ehFeito_original(')}\nexport function ehColunaFl1() { return true; }\nexport function ehFeito() { return true; }\n`);
    try {
      const depois = doctor(dir, { script });
      assert.equal(achar(depois, 'fluxo-status-fl1').found, true, 'com ehColunaFl1 trocado o doctor muda: ele importa o predicado');
      assert.equal(achar(depois, 'pbi-mergeado-aberto').found, true, 'com ehFeito trocado o doctor muda: ele importa a regra');
    } finally { desfaz(); }
  });

  test('doctor-base-importada: trocar `resolverBaseEntrega` no dist/ muda a branch que o doctor lê (M5j)', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'trunk' } }), cards: { 'PBI-7': 'Preparado' }, branches: { outra: ['feat(PBI-7): x'] } });
    const script = join(copia, 'scripts', 'harness-doctor.mjs');
    assert.equal(achar(doctor(dir, { script }), 'pbi-mergeado-aberto').found, true, 'premissa: a trunk não tem o commit');
    const desfaz = reescreve('dist/entrega.js', (t) => `${t.replace('export function resolverBaseEntrega(', 'function resolverBaseEntrega_original(')}\nexport function resolverBaseEntrega() { return { base: 'outra', aviso: 'trocada pelo teste' }; }\n`);
    try {
      const r = achar(doctor(dir, { script }), 'pbi-mergeado-aberto');
      assert.equal(r.found, false, r.evidence);
      assert.match(r.evidence, /base `outra`/);
      assert.match(r.evidence, /trocada pelo teste/, 'o `aviso` do resolvedor entra na evidência');
    } finally { desfaz(); }
  });
});

// REQ-DCT-1 (f): card com nome de ID válido e frontmatter sem id não some em silêncio (emenda 7, opção (iii) do dono).
describe('card FL1 ilegível listado (REQ-DCT-1 f)', () => {
  const SEM_ID = '---\ntitulo: sem id\nstatus: Preparado\n---\n# quebrado\n';
  const quebrado = (...nomes) => Object.fromEntries(nomes.map((n) => [`${FL1}/${n}.md`, SEM_ID]));
  const cfgBase = () => cfgFluxo({ entrega: { base: 'trunk' } });
  const AVISOS = ['fluxo-status-fl1', 'pbi-mergeado-aberto'];

  test('doctor-card-frontmatter-quebrado-listado: 1 quebrado + 1 com status inválido ⇒ o inválido segue listado E o quebrado aparece, nos 2 avisos', () => {
    const { dir } = fixture({ config: cfgBase(), cards: { 'PBI-1': 'Backlog', 'PBI-2': 'Preparado' }, subjects: ['feat(PBI-2): x'], extra: quebrado('PBI-9') });
    const f = aviso(dir, 'fluxo-status-fl1');
    assert.equal(f.found, false, f.evidence);
    assert.match(f.evidence, /^1 cards; 3 primeiros: PBI-1 \(Backlog\)/m, 'o status inválido segue listado');
    assert.match(f.evidence, /^1 cards ilegíveis; 3 primeiros: PBI-9\.md$/m, f.evidence);
    assert.ok(!f.evidence.includes('PBI-2'), 'o card legível com status do quadro segue calado');
    const p = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(p.found, false, p.evidence);
    assert.match(p.evidence, /PBI-2 \(Preparado\)/, 'o resto do aviso segue conferido (mergeado listado)');
    assert.match(p.evidence, /^1 cards ilegíveis; 3 primeiros: PBI-9\.md$/m, p.evidence);
    assert.ok(!/^não conferido/m.test(p.evidence), `o quebrado não derruba o aviso em "não conferido": ${p.evidence}`);
  });

  test('doctor-card-frontmatter-quebrado-listado: só os 3 primeiros, em ordem, com a contagem total', () => {
    const { dir } = fixture({ config: cfgBase(), cards: { 'PBI-1': 'Preparado' }, extra: quebrado('PBI-5', 'PBI-6', 'PBI-7', 'PBI-8') });
    for (const id of AVISOS) {
      const r = aviso(dir, id);
      assert.match(r.evidence, /^4 cards ilegíveis; 3 primeiros: PBI-5\.md, PBI-6\.md, PBI-7\.md$/m, `${id}: ${r.evidence}`);
      assert.ok(!r.evidence.includes('PBI-8'), id);
    }
  });

  test('doctor-card-frontmatter-quebrado-listado: id no frontmatter que não é ID válido também é ilegível; sem frontmatter também', () => {
    const { dir } = fixture({ config: cfgBase(), cards: { 'PBI-1': 'Preparado' }, extra: { [`${FL1}/PBI-4.md`]: '---\nid: qualquer coisa\n---\n# x\n', [`${FL1}/PBI-3.md`]: '# sem frontmatter\n' } });
    for (const id of AVISOS) assert.match(aviso(dir, id).evidence, /^2 cards ilegíveis; 3 primeiros: PBI-3\.md, PBI-4\.md$/m, id);
  });

  test('doctor-card-frontmatter-quebrado-listado: arquivo cujo nome NÃO é ID válido (README.md) não entra na lista (cláusula negativa)', () => {
    const { dir } = fixture({ config: cfgBase(), cards: { 'PBI-1': 'Preparado' }, extra: { [`${FL1}/README.md`]: '# índice\n', [`${FL1}/notas.md`]: SEM_ID } });
    for (const id of AVISOS) {
      const r = aviso(dir, id);
      assert.equal(r.found, true, `${id}: ${r.evidence}`);
      assert.ok(!/ilegíveis/.test(r.evidence), `${id}: ${r.evidence}`);
    }
  });

  test('doctor-card-frontmatter-quebrado-listado: o idPadrao de origin/HEAD decide o que é nome de ID (idPadraoDe)', () => {
    const { dir } = fixture({ config: cfgBase(), cards: {}, extra: { ...quebrado('ENT-1', 'PBI-9') } });
    const antes = git(dir, 'rev-parse', 'HEAD');
    writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfgFluxo({ entrega: { base: 'trunk' } }, { idPadrao: '^ENT-\\d+$' })));
    git(dir, 'commit', '-q', '-am', 'chore: idPadrao de origin');
    git(dir, 'update-ref', 'refs/remotes/origin/HEAD', git(dir, 'rev-parse', 'HEAD'));
    git(dir, 'reset', '-q', '--hard', antes);
    for (const id of AVISOS) {
      const r = aviso(dir, id);
      assert.match(r.evidence, /^1 cards ilegíveis; 3 primeiros: ENT-1\.md$/m, `${id}: ${r.evidence}`);
      assert.ok(!r.evidence.includes('PBI-9'), `PBI-9 não casa o idPadrao de origin: ${id}`);
    }
    // sem idPadrao em origin, vale o padrão: PBI-9 é nome de ID e ENT-1 também
    const { dir: d2 } = fixture({ config: cfgBase(), cards: {}, extra: { ...quebrado('ENT-1', 'PBI-9') } });
    assert.match(aviso(d2, 'fluxo-status-fl1').evidence, /^2 cards ilegíveis; 3 primeiros: ENT-1\.md, PBI-9\.md$/m);
  });

  test('doctor-so-card-quebrado-nao-ok: só ilegíveis e nenhum achado ⇒ found false com a lista, nos 2 avisos, nunca "ok"', () => {
    const { dir } = fixture({ config: cfgBase(), cards: {}, extra: quebrado('PBI-9') });
    for (const id of AVISOS) {
      const r = aviso(dir, id);
      assert.equal(r.level, 'warn');
      assert.equal(r.found, false, `${id}: ${r.evidence}`);
      assert.equal(r.evidence, '1 cards ilegíveis; 3 primeiros: PBI-9.md', id);
    }
    // com card legível em aberto e nada mergeado (caminho de git), o quebrado também impede o "ok"
    const b = fixture({ config: cfgBase(), cards: { 'PBI-1': 'Preparado' }, extra: quebrado('PBI-9') });
    const rb = aviso(b.dir, 'pbi-mergeado-aberto');
    assert.equal(rb.found, false, rb.evidence);
    assert.match(rb.evidence, /^1 cards ilegíveis; 3 primeiros: PBI-9\.md$/m);
  });

  test('doctor-card-quebrado-com-base-ruim: base inexistente ⇒ "não conferido" da base E o quebrado listado, nunca um só dos dois', () => {
    const { dir } = fixture({ config: cfgFluxo({ entrega: { base: 'naoexiste' } }), cards: { 'PBI-1': 'Preparado' }, extra: quebrado('PBI-9') });
    const r = aviso(dir, 'pbi-mergeado-aberto');
    assert.equal(r.found, false, r.evidence);
    assert.match(r.evidence, /^não conferido \(base `naoexiste` não existe/m);
    assert.match(r.evidence, /^1 cards ilegíveis; 3 primeiros: PBI-9\.md$/m);
  });

  test('doctor-card-quebrado-com-base-ruim: origin inválida e log ilegível também listam o quebrado', () => {
    // origin/HEAD com config inválida (:962)
    const o = fixture({ config: cfgBase(), cards: { 'PBI-1': 'Preparado' }, extra: quebrado('PBI-9') });
    const antes = git(o.dir, 'rev-parse', 'HEAD');
    writeFileSync(join(o.dir, 'harness.config.json'), '{ nao json');
    git(o.dir, 'commit', '-q', '-am', 'chore: config de origin');
    git(o.dir, 'update-ref', 'refs/remotes/origin/HEAD', git(o.dir, 'rev-parse', 'HEAD'));
    git(o.dir, 'reset', '-q', '--hard', antes);
    const ro = aviso(o.dir, 'pbi-mergeado-aberto');
    assert.match(ro.evidence, /^não conferido \(config de origin inválida/m, ro.evidence);
    assert.match(ro.evidence, /^1 cards ilegíveis; 3 primeiros: PBI-9\.md$/m, `origin inválida: ${ro.evidence}`);
    // log ilegível (:984): objeto faltando no histórico
    const l = fixture({ config: cfgBase(), cards: { 'PBI-7': 'Preparado' }, subjects: ['feat(PBI-7): x', 'chore: topo'], extra: quebrado('PBI-9') });
    const meio = l.git('rev-parse', 'HEAD~1');
    rmSync(join(l.dir, '.git', 'objects', meio.slice(0, 2), meio.slice(2)), { force: true });
    const rl = aviso(l.dir, 'pbi-mergeado-aberto');
    assert.match(rl.evidence, /^não conferido \(git ilegível ao ler o log/m, rl.evidence);
    assert.match(rl.evidence, /^1 cards ilegíveis; 3 primeiros: PBI-9\.md$/m, `log ilegível: ${rl.evidence}`);
  });

  test('doctor-card-quebrado-nao-muda-nivel: card ilegível não muda nível nem exit code (c)', () => {
    const arquivos = fixtureNivel2_110(2, cfgFluxo({ entrega: { base: 'main' } }, { resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' }));
    const limpo = repoComGit({ ...arquivos, [`${FL1}/PBI-1.md`]: cardTexto('PBI-1', 'Preparado') });
    const comQuebrado = repoComGit({ ...arquivos, [`${FL1}/PBI-1.md`]: cardTexto('PBI-1', 'Preparado'), [`${FL1}/PBI-9.md`]: SEM_ID });
    dirs.push(limpo, comQuebrado);
    const a = doctor(limpo);
    const b = doctor(comQuebrado);
    assert.equal(achar(a, 'fluxo-status-fl1').found, true);
    for (const id of AVISOS) { assert.equal(achar(b, id).found, false, id); assert.equal(achar(b, id).level, 'warn', id); }
    assert.equal(a.json.alcancado, 2, 'premissa: a fixture limpa chega ao nível 2');
    assert.equal(b.json.alcancado, a.json.alcancado);
    assert.equal(b.status, a.status);
    assert.equal(b.status, 0);
  });
});

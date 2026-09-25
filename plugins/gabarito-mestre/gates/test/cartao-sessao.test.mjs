/**
 * Testes do ORQ-3 — cartão de sessão.
 *
 * O cartão é a camada 1 de contexto: ≤ 40 linhas que o orquestrador lê antes de despachar.
 * Ele NUNCA inventa — PBI só quando a branch casa idPadrao, Epic só do cache/arquivo, o resto
 * marcado (b). Sem onboarding é UMA linha e exit 0. Cache do doctor vale 24 h.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  omitir a linha `PBI:`
 *  M2  uma linha por envelhecido (cartão passa de 40 linhas)
 *  M3  ignorar o TTL de 24 h do cache do doctor
 *  M4  inferirPbi case-insensitive (`feat/pbi-12-x` vira PBI)
 *  M5  ignorar envelhecimentoDias
 *  M6  fail-closed sem config (exit ≠ 0 ou mais de uma linha)
 *  M7a ler o estado do Epic sem a linha MOVIMENTO (fixture sem MOVIMENTO deixaria de mostrar `estado`)
 *  M7b regex de MOVIMENTO estrito `(\S+)→(\S+)` ou sem normalizarEstado (`Preparado→Em execução` deixa de virar em_execucao)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  montarCartao, inferirPbi, coletar, lerLedger, lerFrontmatter, normalizarEstado, MAX_LINHAS, LINHA_SEM_ONBOARDING, DEFAULTS,
} from '../scripts/cartao-sessao.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'cartao-sessao.mjs');

/**
 * "Plugin real" montado em tmpdir: `.claude-plugin/plugin.json` + `gates/scripts/` com cópias do doctor e do
 * versionamento-check de `here/../scripts`. NÃO usar `resolve(here, '..', '..')`: na cópia instalada em
 * `tools/gabarito-gates/` essa raiz não é o plugin (não tem `.claude-plugin/`) e `npm test` quebraria lá.
 */
let PLUGIN_REAL;
function montarPluginReal() {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-real-'));
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gabarito-mestre', version: '1.1.0' }));
  mkdirSync(join(dir, 'gates', 'scripts'), { recursive: true });
  for (const f of ['harness-doctor.mjs', 'versionamento-check.mjs']) copyFileSync(join(here, '..', 'scripts', f), join(dir, 'gates', 'scripts', f));
  return dir;
}

// Medidas injetadas: o cartão não deve depender de `ps`/`vm_stat` da máquina de teste.
before(() => {
  Object.assign(process.env, { GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '1', GABARITO_CAP_MEM_MB: '8192', GABARITO_CAP_DISCO_GB: '50', GABARITO_CAP_PESADOS: '0' });
  delete process.env.GABARITO_PARALELISMO;
  PLUGIN_REAL = montarPluginReal();
});

const AGORA = '2026-09-24T12:00:00Z';
/** F2-R10: o cabeçalho usa hora LOCAL da máquina, não UTC — a asserção reproduz a mesma
 * conta (getFullYear/getMonth/getDate/getHours/getMinutes) para não depender do fuso de
 * quem roda o teste. */
const cabecalhoLocal = (iso) => {
  const d = new Date(iso);
  const p2 = (n) => String(n).padStart(2, '0');
  return `GABARITO · cartão de sessão · ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cartao-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const CONFIG = (extra = {}) =>
  JSON.stringify({
    fluxo: { ferramenta: 'arquivos', resolvidoEm: '2026-09-20', idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3, iniciativa: { id: 'INI-1' }, ...(extra.fluxo ?? {}) },
    versionamento: { resolvidoEm: '2026-09-20' },
    orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: '2026-09-01', validadeDias: 90 }, paralelismo: { simultaneos: 2, teto: 4 }, ...(extra.orquestracao ?? {}) },
  });
/** Repo git real em `branch`, com config onboarded. */
function repoGit(arquivos = {}, branch = 'feat/PBI-123-x') {
  const dir = repo({ 'harness.config.json': CONFIG(), ...arquivos });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
  if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
  return dir;
}
/** Plugin falso: só o plugin.json — sem doctor, o cartão marca "indisponível" e o teste fica rápido. */
const pluginFalso = (versao = '1.1.0') => repo({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'gabarito-mestre', version: versao }) });
/** Plugin cujo harness-doctor.mjs QUEBRA (process.exit(1) sem gravar cache) — para testar I1. */
const pluginQuebrado = () => repo({
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'gabarito-mestre', version: '1.1.0' }),
  'gates/scripts/harness-doctor.mjs': '#!/usr/bin/env node\nprocess.exit(1);\n',
});
const cache = (obj) => ({ '.harness/fluxo-cache.json': JSON.stringify(obj) });
const CACHE_123 = cache({ 'PBI-123': { epic: 'EPIC-7', iniciativa: 'INI-1', titulo: 'x', em: '2026-09-20' } });
const LEDGER_123 = ['# Ledger PBI-123', '', '## LER PRIMEIRO', 'contexto', '', 'MOVIMENTO FL2 EPIC-7 preparado→em_execucao 2026-09-21', 'DISPATCH Task 1 slots=2 worktree wt/PBI-123-1'].join('\n');
const opts = (o = {}) => ({ agora: AGORA, installedPlugins: '/nao/existe.json', ...o });
const linha = (linhas, prefixo) => linhas.find((l) => l.startsWith(prefixo));

describe('inferirPbi (Review Focus 5)', () => {
  const cfg = { fluxo: { idPadrao: '^[A-Z]+-\\d+$' }, versionamento: { tiposComEscopoDePbi: ['feat', 'fix', 'enabler'] } };
  test('feat/PBI-123-x → PBI-123; enabler/GM-2-gates → GM-2; feat/PBI-12 → PBI-12', () => {
    assert.deepEqual(inferirPbi('feat/PBI-123-x', cfg), { pbi: 'PBI-123', n: null });
    assert.deepEqual(inferirPbi('enabler/GM-2-gates', cfg), { pbi: 'GM-2', n: null });
    assert.deepEqual(inferirPbi('feat/PBI-12', cfg), { pbi: 'PBI-12', n: null });
  });
  test('wt/PBI-7-2 → PBI-7 com índice 2', () => {
    assert.deepEqual(inferirPbi('wt/PBI-7-2', cfg), { pbi: 'PBI-7', n: 2 });
    assert.deepEqual(inferirPbi('wt/PBI-12-1', cfg), { pbi: 'PBI-12', n: 1 });
  });
  test('sem PBI: main, chore/GM-3-x (tipo livre), feat/pbi-12-x (minúsculas), wt/pbi-7-2, hotfix/PBI-1, vazio', () => {
    for (const b of ['main', 'master', 'chore/GM-3-x', 'feat/pbi-12-x', 'wt/pbi-7-2', 'hotfix/PBI-1', 'feat/x', '', null]) assert.equal(inferirPbi(b, cfg), null, String(b));
  });
  test('idPadrao da config manda: com ^GM-\\d+$, feat/PBI-1-x não infere', () => {
    assert.equal(inferirPbi('feat/PBI-1-x', { ...cfg, fluxo: { idPadrao: '^GM-\\d+$' } }), null);
  });
  test('sem cfg usa DEFAULTS', () => {
    assert.deepEqual(inferirPbi('fix/PBI-9-y'), { pbi: 'PBI-9', n: null });
    assert.ok(DEFAULTS.versionamento.tiposComEscopoDePbi.includes('fix'));
  });
});

describe('lerLedger e lerFrontmatter', () => {
  test('MOVIMENTO, BLOQUEADA, DISPATCH e LER PRIMEIRO', () => {
    const l = lerLedger(['## LER PRIMEIRO', 'x', 'MOVIMENTO FL2 EPIC-7 preparado→em_execucao 2026-09-21', 'BLOQUEADA 2026-09-23 API fora — dono: gabriel', 'DISPATCH Task 1 slots=2 worktree wt/PBI-1-1', 'DISPATCH Task 2 worktree wt/PBI-1-2'].join('\n'));
    assert.equal(l.linhaLerPrimeiro, 1);
    assert.equal(l.ultimaData, '2026-09-23');
    assert.deepEqual(l.epicEstado, { epic: 'EPIC-7', para: 'em_execucao' });
    assert.equal(l.dispatches, 2);
    assert.deepEqual(l.avisos, ['1 dispatch sem medição (slots=)']);
  });
  test('MOVIMENTO aceita as duas grafias e normaliza para a chave (M7): "Em execução" → em_execucao; "Em validação " → em_validacao', () => {
    const coluna = lerLedger('MOVIMENTO FL2 EPIC-7 Preparado→Em execução 2026-09-21\n');
    assert.deepEqual(coluna.epicEstado, { epic: 'EPIC-7', para: 'em_execucao' });
    assert.equal(coluna.ultimaData, '2026-09-21');
    const chave = lerLedger('MOVIMENTO FL2 EPIC-7 em_execucao→em_validacao 2026-09-22\n');
    assert.deepEqual(chave.epicEstado, { epic: 'EPIC-7', para: 'em_validacao' });
    assert.deepEqual(lerLedger('MOVIMENTO FL2 EPIC-7 Em execução→Em validação  2026-09-23  \n').epicEstado, { epic: 'EPIC-7', para: 'em_validacao' });
    assert.equal(lerLedger('MOVIMENTO FL2 EPIC-7 preparado→em_execucao\n').epicEstado, null, 'sem data não é MOVIMENTO válido');
    assert.equal(normalizarEstado(' Em execução '), 'em_execucao');
    assert.equal(normalizarEstado('Concluído'), 'concluido', 'diacríticos caem: nome de coluna vira chave de fluxo.status.FL2');
    assert.deepEqual(lerLedger('MOVIMENTO FL2 EPIC-7 Em validação→Concluído 2026-09-24\n').epicEstado, { epic: 'EPIC-7', para: 'concluido' });
  });
  test('BLOQUEADA sem dono gera aviso (PAR-5); sem linhas datadas ultimaData é null', () => {
    const l = lerLedger('BLOQUEADA 2026-09-23 esperando review\n');
    assert.match(l.avisos[0], /BLOQUEADA sem dono \(l\.1\)/);
    assert.equal(lerLedger('# nada\n').ultimaData, null);
  });
  test('frontmatter YAML simples: epic e iniciativa', () => {
    assert.deepEqual(lerFrontmatter('---\nid: PBI-5\nepic: EPIC-2\niniciativa: "INI-1"\n---\n# corpo'), { id: 'PBI-5', epic: 'EPIC-2', iniciativa: 'INI-1' });
    assert.deepEqual(lerFrontmatter('# sem frontmatter'), {});
  });
});

describe('montarCartao — formato fixo e ≤ 40 linhas', () => {
  const ctxBase = () => ({
    agora: Date.parse(AGORA),
    semOnboarding: false,
    config: JSON.parse(CONFIG()),
    branch: 'feat/PBI-123-x', sha: 'abc1234',
    pbi: 'PBI-123', n: null, epic: 'EPIC-7', iniciativa: 'INI-1', fonteVinculo: 'cache 2026-09-20',
    epicEstado: { epic: 'EPIC-7', para: 'em_execucao' }, avisosLedger: [],
    emVoo: 2, worktrees: 1, capacidade: { slots: 2, motivo: 'simultaneos', medidas: {} },
    doctor: { nivel: 1, declarado: 1, em: '2026-09-24T10:00:00Z', fonte: 'cache 2 h' },
    envelhecidos: [{ pbi: 'PBI-9', dias: 4 }],
    ledger: { caminho: 'docs/ledgers/PBI-123.md', linhaLerPrimeiro: 3 },
    versoes: { instalada: '1.1.0', plugin: '1.1.0' },
    superpowers: 'presente (c)',
  });
  test('as 11 linhas do contrato, na ordem', () => {
    const L = montarCartao(ctxBase());
    assert.ok(L.length <= MAX_LINHAS);
    assert.equal(L[0], cabecalhoLocal(AGORA));
    assert.equal(L[1], 'Modelo: mais-potente · alias fable · resolvido 2026-09-01 (66 d restantes)');
    assert.equal(L[2], 'Branch: feat/PBI-123-x @ abc1234');
    assert.equal(L[3], 'PBI: PBI-123 · Epic: EPIC-7 · estado em_execucao · Iniciativa: INI-1 (fonte: cache 2026-09-20)');
    assert.equal(L[4], 'Em voo: 2 PBI · worktrees vivos: 1 · slots: 2 (simultaneos)');
    assert.equal(L[5], 'Doctor: nível 1 medido · declarado 1 (cache 2 h)');
    assert.equal(L[6], 'Envelhecidos: PBI-9 4d');
    assert.equal(L[7], 'Ledger: docs/ledgers/PBI-123.md — LER PRIMEIRO l.3');
    assert.equal(L[8], 'Harness: instalado 1.1.0 · plugin 1.1.0');
    assert.equal(L[9], 'Plugins: superpowers presente (c)');
    assert.equal(L.at(-1), 'R21: despache, não implemente. Velocidade nunca compra concorrência.');
  });
  test('F2-R10: cabeçalho usa data/hora LOCAL, não UTC — instante que cruza o dia', () => {
    const tzAntigo = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    try {
      // 2026-09-24T23:30:00-03:00 == 2026-09-25T02:30:00Z: em UTC já seria "amanhã".
      const ctx = { ...ctxBase(), agora: Date.parse('2026-09-24T23:30:00-03:00') };
      const L = montarCartao(ctx);
      assert.equal(L[0], 'GABARITO · cartão de sessão · 2026-09-24 23:30');
    } finally {
      if (tzAntigo === undefined) delete process.env.TZ; else process.env.TZ = tzAntigo;
    }
  });
  test('modelo vencido → "VENCIDO — revalide com gabarito-instalar"; sem resolvidoEm → (b)', () => {
    const c = ctxBase();
    c.config.orquestracao.modelo.resolvidoEm = '2026-06-01';
    assert.match(linha(montarCartao(c), 'Modelo:'), /VENCIDO — revalide com gabarito-instalar/);
    c.config.orquestracao.modelo.resolvidoEm = '';
    assert.match(linha(montarCartao(c), 'Modelo:'), /\(b\) não resolvido/);
  });
  test('sem PBI → "PBI: (b) não inferido"; PBI sem Epic → "--vincular"; worktree mostra o índice', () => {
    const semPbi = { ...ctxBase(), pbi: null, epic: null, ledger: null };
    assert.equal(linha(montarCartao(semPbi), 'PBI:'), 'PBI: (b) não inferido — branch fora de branchPadrao/branchWorktree');
    assert.equal(linha(montarCartao(semPbi), 'Ledger:'), 'Ledger: sem ledger');
    const semEpic = { ...ctxBase(), epic: null, iniciativa: null, fonteVinculo: '(b) não resolvido — gabarito-instalar --vincular PBI-123', epicEstado: null };
    assert.equal(linha(montarCartao(semEpic), 'PBI:'), 'PBI: PBI-123 · Epic: (b) não resolvido — gabarito-instalar --vincular PBI-123');
    assert.match(linha(montarCartao({ ...ctxBase(), n: 2 }), 'PBI:'), /^PBI: PBI-123 \(worktree 2\) · Epic: EPIC-7/);
  });
  test('sem estado de Epic (ledger sem MOVIMENTO) a linha não traz "estado"', () => {
    assert.doesNotMatch(linha(montarCartao({ ...ctxBase(), epicEstado: null }), 'PBI:'), /estado/);
  });
  test('versões diferentes → "rode instalar.sh --atualizar"; doctor indisponível; envelhecidos vazio → "—"', () => {
    const c = { ...ctxBase(), versoes: { instalada: '1.0.0', plugin: '1.1.0' }, doctor: { nivel: null, declarado: null, em: null, fonte: 'indisponível' }, envelhecidos: [] };
    const L = montarCartao(c);
    assert.equal(linha(L, 'Harness:'), 'Harness: instalado 1.0.0 · plugin 1.1.0 · rode instalar.sh --atualizar');
    assert.equal(linha(L, 'Doctor:'), 'Doctor: indisponível');
    assert.equal(linha(L, 'Envelhecidos:'), 'Envelhecidos: —');
  });
  test('60 envelhecidos e 10 avisos continuam em ≤ 40 linhas (uma linha cada, com "+n")', () => {
    const c = { ...ctxBase(), envelhecidos: Array.from({ length: 60 }, (_, i) => ({ pbi: `PBI-${i}`, dias: i + 4 })), avisosLedger: Array.from({ length: 10 }, (_, i) => `aviso ${i}`) };
    const L = montarCartao(c);
    assert.ok(L.length <= MAX_LINHAS, `${L.length} linhas`);
    assert.match(linha(L, 'Envelhecidos:'), / \+52$/);
    assert.match(linha(L, 'Avisos:'), /aviso 0 · aviso 1 · aviso 2/);
  });
  test('sem onboarding → exatamente a linha de fail-open', () => {
    assert.deepEqual(montarCartao({ semOnboarding: true }), [LINHA_SEM_ONBOARDING]);
    assert.match(LINHA_SEM_ONBOARDING, /fail-open declarado, G9/);
  });
});

describe('coletar — repo git real', () => {
  test('branch feat/PBI-123-x + cache → PBI, Epic, Iniciativa, ledger, estado do Epic (ORQ-3 G/W/T)', () => {
    const dir = repoGit({ ...CACHE_123, 'docs/ledgers/PBI-123.md': LEDGER_123 });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.semOnboarding, false);
    assert.equal(ctx.branch, 'feat/PBI-123-x');
    assert.match(ctx.sha, /^[0-9a-f]{7}$/);
    assert.equal(ctx.pbi, 'PBI-123');
    assert.equal(ctx.epic, 'EPIC-7');
    assert.equal(ctx.iniciativa, 'INI-1');
    assert.equal(ctx.fonteVinculo, 'cache 2026-09-20');
    assert.deepEqual(ctx.ledger, { caminho: 'docs/ledgers/PBI-123.md', linhaLerPrimeiro: 3 });
    assert.deepEqual(ctx.epicEstado, { epic: 'EPIC-7', para: 'em_execucao' });
    assert.equal(ctx.emVoo, 1);
    assert.equal(ctx.worktrees, 0);
    assert.equal(ctx.capacidade.slots, 2);
    const L = montarCartao(ctx);
    assert.ok(L.length <= 40);
    assert.match(linha(L, 'PBI:'), /^PBI: PBI-123 · Epic: EPIC-7 · estado em_execucao/);
  });
  test('sessão aberta em subpasta de monorepo resolve a raiz pelo git (Review Focus 2)', () => {
    const dir = repoGit(CACHE_123);
    mkdirSync(join(dir, 'apps', 'api'), { recursive: true });
    const ctx = coletar(join(dir, 'apps', 'api'), pluginFalso(), opts());
    assert.equal(realpathSync(ctx.root), realpathSync(dir));
    assert.equal(ctx.pbi, 'PBI-123');
    assert.equal(ctx.epic, 'EPIC-7');
  });
  test('fixture solta sem .git usa o cwd e não quebra', () => {
    const dir = repo({ 'harness.config.json': CONFIG() });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(realpathSync(ctx.root), realpathSync(dir));
    assert.equal(ctx.branch, '(sem git)');
    assert.equal(ctx.pbi, null);
    assert.equal(ctx.worktrees, null);
    assert.equal(linha(montarCartao(ctx), 'PBI:'), 'PBI: (b) não inferido — branch fora de branchPadrao/branchWorktree');
  });
  test('branches sem PBI: main, chore/GM-3-x, feat/pbi-12-x → "(b) não inferido"; wt/PBI-7-2 → PBI-7 (worktree 2)', () => {
    for (const b of ['main', 'chore/GM-3-x', 'feat/pbi-12-x']) {
      const ctx = coletar(repoGit({}, b), pluginFalso(), opts());
      assert.equal(ctx.pbi, null, b);
      assert.match(linha(montarCartao(ctx), 'PBI:'), /^PBI: \(b\) não inferido/, b);
    }
    const wt = coletar(repoGit(cache({ 'PBI-7': { epic: 'EPIC-1', iniciativa: 'INI-1', titulo: 't', em: '2026-09-23' } }), 'wt/PBI-7-2'), pluginFalso(), opts());
    assert.deepEqual([wt.pbi, wt.n], ['PBI-7', 2]);
    assert.match(linha(montarCartao(wt), 'PBI:'), /^PBI: PBI-7 \(worktree 2\) · Epic: EPIC-1/);
  });
  test('sem cache, ferramenta arquivos: Epic vem do frontmatter de docs/fluxo/pbis/<PBI>.md (fonte: arquivo)', () => {
    const dir = repoGit({ 'docs/fluxo/pbis/PBI-123.md': '---\nid: PBI-123\nepic: EPIC-2\n---\n# PBI' });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.epic, 'EPIC-2');
    assert.equal(ctx.iniciativa, 'INI-1', 'iniciativa padrão da config quando nem o PBI nem o Epic trazem');
    assert.equal(ctx.fonteVinculo, 'arquivo');
  });
  test('ferramenta arquivos: Iniciativa vem de docs/fluxo/epics/<epic>.md antes do fallback da config; frontmatter do PBI ainda sobrepõe (D4)', () => {
    const epicCard = '---\nid: EPIC-2\niniciativa: INI-9\nstatus: Em execução\n---\n# Epic';
    const dir = repoGit({ 'docs/fluxo/pbis/PBI-123.md': '---\nid: PBI-123\nepic: EPIC-2\n---\n# PBI', 'docs/fluxo/epics/EPIC-2.md': epicCard });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.epic, 'EPIC-2');
    assert.equal(ctx.iniciativa, 'INI-9', 'lida do Epic, não do fluxo.iniciativa.id (INI-1)');
    const dirOverride = repoGit({ 'docs/fluxo/pbis/PBI-123.md': '---\nid: PBI-123\nepic: EPIC-2\niniciativa: INI-5\n---\n# PBI', 'docs/fluxo/epics/EPIC-2.md': epicCard });
    assert.equal(coletar(dirOverride, pluginFalso(), opts()).iniciativa, 'INI-5', 'override no PBI vence o Epic');
  });
  test('sem cache e sem arquivo: "(b) não resolvido — gabarito-instalar --vincular PBI-123"', () => {
    const ctx = coletar(repoGit(), pluginFalso(), opts());
    assert.equal(ctx.epic, null);
    assert.equal(linha(montarCartao(ctx), 'PBI:'), 'PBI: PBI-123 · Epic: (b) não resolvido — gabarito-instalar --vincular PBI-123');
  });
  test('envelhecidos (FLX-8): BLOQUEADA há 4 dias lista "PBI-1 4d"; envelhecimentoDias 10 não lista', () => {
    const arquivos = {
      ...cache({ 'PBI-1': { epic: 'E', iniciativa: 'I', titulo: 'a', em: '2026-09-10' }, 'PBI-2': { epic: 'E', iniciativa: 'I', titulo: 'b', em: '2026-09-23' } }),
      'docs/ledgers/PBI-1.md': 'BLOQUEADA 2026-09-20 aguardando API — dono: gabriel\n',
    };
    const ctx = coletar(repoGit(arquivos, 'main'), pluginFalso(), opts());
    assert.deepEqual(ctx.envelhecidos, [{ pbi: 'PBI-1', dias: 4 }]);
    assert.equal(ctx.emVoo, 2);
    assert.equal(linha(montarCartao(ctx), 'Envelhecidos:'), 'Envelhecidos: PBI-1 4d');
    const dir10 = repoGit({ ...arquivos, 'harness.config.json': CONFIG({ fluxo: { envelhecimentoDias: 10 } }) }, 'main');
    assert.deepEqual(coletar(dir10, pluginFalso(), opts()).envelhecidos, []);
  });
  test('PBI em voo sem ledger envelhece pelo `em` do cache', () => {
    const ctx = coletar(repoGit(cache({ 'PBI-3': { epic: 'E', iniciativa: 'I', titulo: 'c', em: '2026-09-01' } }), 'main'), pluginFalso(), opts());
    assert.deepEqual(ctx.envelhecidos, [{ pbi: 'PBI-3', dias: 23 }]);
  });
  test('avisos de ledger do PBI da branch: BLOQUEADA sem dono (PAR-5) e DISPATCH sem slots= (PAR-2)', () => {
    const dir = repoGit({ ...CACHE_123, 'docs/ledgers/PBI-123.md': 'BLOQUEADA 2026-09-23 review reprovado 2x\nDISPATCH Task 1 worktree wt/PBI-123-1\nDISPATCH Task 2 slots=2 worktree wt/PBI-123-2\n' });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.avisosLedger.length, 2);
    const av = linha(montarCartao(ctx), 'Avisos:');
    assert.match(av, /BLOQUEADA sem dono/);
    assert.match(av, /1 dispatch sem medição/);
  });
  test('versões: tools/gabarito-gates 1.0.0 × plugin 1.1.0 → "rode instalar.sh --atualizar"', () => {
    const dir = repoGit({ 'tools/gabarito-gates/package.json': '{"version":"1.0.0"}' });
    const ctx = coletar(dir, pluginFalso('1.1.0'), opts());
    assert.deepEqual(ctx.versoes, { instalada: '1.0.0', plugin: '1.1.0' });
    assert.match(linha(montarCartao(ctx), 'Harness:'), /rode instalar\.sh --atualizar/);
  });
  test('config sem `orquestracao`: cartão diz "Config: defaults (orquestracao ausente)"; com a seção, a linha não existe', () => {
    const semOrq = JSON.stringify({ fluxo: JSON.parse(CONFIG()).fluxo, versionamento: { resolvidoEm: '2026-09-20' } });
    const ctx = coletar(repoGit({ 'harness.config.json': semOrq }), pluginFalso(), opts());
    assert.equal(ctx.orquestracaoAusente, true);
    assert.equal(ctx.capacidade.slots >= 1, true, 'defaults de capacidade continuam valendo');
    assert.equal(linha(montarCartao(ctx), 'Config:'), 'Config: defaults (orquestracao ausente) — gabarito-instalar (fase 4)');
    const com = coletar(repoGit(), pluginFalso(), opts());
    assert.equal(com.orquestracaoAusente, false);
    assert.equal(linha(montarCartao(com), 'Config:'), undefined);
  });
  test('superpowers: presente (c) / ausente (c) / desconhecido, marcado (c) porque vem de arquivo local', () => {
    const com = repo({ 'ip.json': JSON.stringify({ version: 2, plugins: { 'superpowers@claude-plugins-official': [{ scope: 'user' }] } }) });
    const sem = repo({ 'ip.json': JSON.stringify({ version: 2, plugins: { 'outro@x': [] } }) });
    assert.equal(coletar(repoGit(), pluginFalso(), opts({ installedPlugins: join(com, 'ip.json') })).superpowers, 'presente (c)');
    assert.equal(coletar(repoGit(), pluginFalso(), opts({ installedPlugins: join(sem, 'ip.json') })).superpowers, 'ausente (c)');
    assert.equal(coletar(repoGit(), pluginFalso(), opts({ installedPlugins: '/nao/existe.json' })).superpowers, 'desconhecido');
  });
});

describe('coletar — cache do doctor (DOC-2, TTL 24 h)', () => {
  // PLUGIN_REAL é o tmpdir montado no `before` (plugin.json + cópias do doctor e do versionamento-check):
  // o teste passa igual em plugins/gabarito-mestre/gates/ e na cópia instalada em tools/gabarito-gates/.
  const cacheDoctor = (horas) => ({ '.harness/doctor-cache.json': JSON.stringify({ nivel: 1, declarado: 1, em: new Date(Date.now() - horas * 3_600_000).toISOString() }) });
  const optsReais = () => ({ agora: new Date().toISOString(), installedPlugins: '/nao/existe.json' });
  test('o plugin de teste tem doctor e versionamento-check copiados de here/../scripts', () => {
    assert.ok(existsSync(join(PLUGIN_REAL, '.claude-plugin', 'plugin.json')));
    assert.ok(existsSync(join(PLUGIN_REAL, 'gates', 'scripts', 'harness-doctor.mjs')));
    assert.ok(existsSync(join(PLUGIN_REAL, 'gates', 'scripts', 'versionamento-check.mjs')));
  });
  test('cache de 1 h: usado, arquivo intocado, fonte "cache 1 h"', () => {
    const dir = repoGit(cacheDoctor(1));
    const antes = readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8');
    const ctx = coletar(dir, PLUGIN_REAL, optsReais());
    assert.equal(ctx.doctor.nivel, 1);
    assert.equal(ctx.doctor.fonte, 'cache 1 h');
    assert.equal(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'), antes);
  });
  test('cache de 25 h: o doctor do plugin roda com --cache e o arquivo é reescrito (fonte "recalculado agora")', () => {
    const dir = repoGit(cacheDoctor(25));
    const antes = JSON.parse(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'));
    const ctx = coletar(dir, PLUGIN_REAL, optsReais());
    const depois = JSON.parse(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'));
    assert.ok(Date.parse(depois.em) > Date.parse(antes.em), 'em foi renovado');
    assert.equal(ctx.doctor.fonte, 'recalculado agora');
    assert.equal(typeof ctx.doctor.nivel, 'number');
  });
  test('cache ausente: roda o doctor (a cópia em PLUGIN_REAL/gates/scripts) e cria o arquivo', () => {
    const dir = repoGit();
    const ctx = coletar(dir, PLUGIN_REAL, optsReais());
    assert.ok(existsSync(join(dir, '.harness/doctor-cache.json')));
    assert.equal(ctx.doctor.fonte, 'recalculado agora');
  });
  test('cache ausente e plugin sem doctor: "indisponível", sem lançar', () => {
    const ctx = coletar(repoGit(), pluginFalso(), opts());
    assert.deepEqual(ctx.doctor, { nivel: null, declarado: null, em: null, fonte: 'indisponível' });
  });
  test('I1: cache vencido (25 h) + doctor do plugin QUEBRA sem regravar → "cache vencido (doctor falhou)", nível velho preservado (nunca "recalculado agora")', () => {
    const dir = repoGit(cacheDoctor(25));
    const antes = JSON.parse(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'));
    const ctx = coletar(dir, pluginQuebrado(), optsReais());
    const depois = JSON.parse(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'));
    assert.equal(depois.em, antes.em, 'o doctor quebrado não regravou o cache');
    assert.equal(ctx.doctor.fonte, 'cache vencido (doctor falhou)');
    assert.equal(ctx.doctor.nivel, antes.nivel, 'nível velho é mantido, não vira null');
  });
  test('I1: cache ausente + doctor do plugin QUEBRA sem gravar nada → "indisponível" (nunca "recalculado agora")', () => {
    const dir = repoGit();
    const ctx = coletar(dir, pluginQuebrado(), optsReais());
    assert.equal(existsSync(join(dir, '.harness', 'doctor-cache.json')), false);
    assert.deepEqual(ctx.doctor, { nivel: null, declarado: null, em: null, fonte: 'indisponível' });
  });
});

describe('coletar/CLI — config ausente/vazia/inválida/sem fluxo (Review Focus 3)', () => {
  const cli = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GABARITO_INSTALLED_PLUGINS: '/nao/existe.json' } });
  test('config ausente → semOnboarding; CLI imprime UMA linha e sai 0', () => {
    const dir = repo();
    assert.equal(coletar(dir, pluginFalso(), opts()).semOnboarding, true);
    const r = cli(['--root', dir, '--plugin-root', pluginFalso()], dir);
    assert.equal(r.status, 0);
    assert.deepEqual(r.stdout.trimEnd().split('\n'), [LINHA_SEM_ONBOARDING]);
  });
  test('config vazia, sem fluxo, ou fluxo sem resolvidoEm → uma linha', () => {
    for (const c of ['', '{}', '{"fluxo":{"ferramenta":"arquivos"}}', '{"versionamento":{"resolvidoEm":"2026-09-20"}}']) {
      const dir = repo({ 'harness.config.json': c });
      const r = cli(['--root', dir, '--plugin-root', pluginFalso()], dir);
      assert.equal(r.status, 0, c);
      assert.equal(r.stdout.trimEnd(), LINHA_SEM_ONBOARDING, c);
    }
  });
  test('config inválida → uma linha, stderr com fail-open, exit 0, sem stack trace', () => {
    const dir = repo({ 'harness.config.json': '{"fluxo": ' });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.semOnboarding, true);
    assert.equal(ctx.configInvalido, true);
    const r = cli(['--root', dir, '--plugin-root', pluginFalso()], dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trimEnd(), LINHA_SEM_ONBOARDING);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('--json devolve { linhas, ctx } e --agora fixa o relógio', () => {
    const dir = repoGit({ ...CACHE_123 });
    const r = cli(['--root', dir, '--plugin-root', pluginFalso(), '--json', '--agora', AGORA], dir);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.linhas[0], cabecalhoLocal(AGORA));
    assert.equal(j.ctx.pbi, 'PBI-123');
    assert.ok(j.linhas.length <= 40);
  });
  test('sem --root, a partir de subpasta: raiz pelo git; texto do cartão com PBI', () => {
    const dir = repoGit({ ...CACHE_123 });
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    const r = cli(['--plugin-root', pluginFalso(), '--agora', AGORA], join(dir, 'apps', 'web'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^PBI: PBI-123 · Epic: EPIC-7/m);
  });
});

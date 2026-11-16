/**
 * Fumaça do pouso (GM-15 T20, REQ-POU-3): pousar ⇒ /clear ⇒ sessão nova ⇒ retomada, pelos adaptadores reais.
 *
 * PLANO B DECLARADO (spike S8 REFUTADA, t0b-relatorio): o CI não tem segredo do Claude Code nem login ("Not logged in"), então
 * o `/clear` REAL não roda aqui. Este teste SIMULA o par `sessao.pouso` ⇒ `sessao.inicio {origem: 'clear'}` no diário e grava o
 * contexto da sessão nova com o `gravarContexto` REAL do mod (mod/painel.mjs), e confere a retomada pelo `loop.mjs proxima` real
 * (e o painel). LIMITE: "o `/clear` real não é provado no CI"; ele é provado 1 vez por release numa sessão local, com a evidência anexada
 * (o limite vai também ao CHANGELOG, T28).
 *
 * O pouso só vale com o contexto medido ABAIXO do teto na sessão nova (aprendizado 1054): `/clear` que não limpou (contexto ainda em X ou
 * acima) mantém o pouso pendente.
 *
 * MUTAÇÕES (plano T20): M20b a retomada aceita contexto acima do teto (`propria.percent >= medicao.x` vira `<` em `dist/pouso-pendente.js`) e
 * M20b2 (a leitura da sessão nova é ignorada e só o `/clear` fecha o pouso) ⇒ `fumaca-pouso-pendente-mede-sessao-nova` morre.
 * Nota: `proxima` devolve `pousar` com contexto ≥ X por conta própria (`noTeto`), então só o núcleo (`pousoPendente`) isola a decisão do pouso.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { raizSegura } from './_raiz-segura.mjs';
import * as diario from '../dist/diario.js';
import { lerLeitura, pousoPendente } from '../dist/pouso-pendente.js';
import { gravarContexto } from '../../mod/painel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
const raizes = [];
after(() => { for (const d of raizes) rmSync(d, { recursive: true, force: true }); });

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Repo descartável com onboarding (o pouso por evento só vale com ele), plano de 1 task e capacidade falsa (nada da máquina decide). */
function ambiente() {
  const dir = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'fumaca-pouso-'))));
  raizes.push(dir);
  g(dir, 'init', '-q', '-b', 'enabler/GM-10-loop');
  g(dir, 'config', 'user.email', 't@t'); g(dir, 'config', 'user.name', 't'); g(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.txt'), 'ORIG\n');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 }, fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } }));
  writeFileSync(join(dir, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n');
  g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  writeFileSync(join(entregas, 'plano.json'), JSON.stringify({ entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: ['T1'], arquivos: ['src/t2.txt'] }] }));
  const hostTeste = 'host-teste';
  writeFileSync(join(dir, '.harness', 'capacidade.json'), JSON.stringify({ hostname: hostTeste, slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 }));
  const tmpSistema = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'fumaca-pouso-sys-'))));
  raizes.push(tmpSistema);
  const env = { ...process.env, TMPDIR: tmpSistema, GABARITO_CAP_HOSTNAME: hostTeste, GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };
  delete env.GABARITO_POUSO_X;
  const cli = (args) => {
    const r = spawnSync(process.execPath, [LOOP, ...args], { cwd: dir, encoding: 'utf8', env });
    let j = null; try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout + r.stderr };
  };
  /** O `/clear` simulado: `sessao.inicio {origem: 'clear'}` de OUTRA sessão, depois do pouso (o que o SessionStart real grava). */
  const clearDe = (sessao) => {
    const ultimo = Math.max(...diario.ler(entregas).map((e) => Date.parse(e.ts)));
    const r = diario.append(entregas, sessao, { ts: new Date(ultimo + 5000).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo: 'sessao.inicio', dados: { origem: 'clear' } });
    assert.ok(r.ok, JSON.stringify(r));
  };
  /** O mod mede o contexto da sessão nova: `gravarContexto` REAL do mod, executado como o host o executaria. */
  const medir = (sessao, percent) => {
    const gr = gravarContexto({ sessao, percent, fonte: 'mod', emMs: Date.now() });
    assert.ok(gr);
    const r = spawnSync(gr.argv[0], gr.argv.slice(1), { cwd: dir, input: gr.stdin, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
  };
  /** A fronteira do pouso: T1 implementada, aprovada e integrada (um `review.veredito` antes do pouso; `pousoDaFronteira` é o que o mod mede). */
  const veredito = () => {
    const evs = [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1' }], ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }], ['task.integrada', { task: 'T1' }]];
    evs.forEach(([tipo, dados], i) => {
      const r = diario.append(entregas, 'loop', { ts: new Date(Date.now() - (10 - i) * 1000).toISOString(), autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados });
      assert.ok(r.ok, JSON.stringify(r));
    });
  };
  /** GM-15 T35 (r.12): o pedido de /clear é medido pela leitura da sessão que pergunta (`--sessao`). */
  const painel = (sessao) => {
    const r = spawnSync(process.execPath, [PAINEL, 'estado', ...(sessao === undefined ? [] : ['--sessao', sessao])], { cwd: dir, encoding: 'utf8', env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    return JSON.stringify(j.estado.depende ?? []);
  };
  /** O que o núcleo decide com o diário real e o contexto que o mod gravou sob o id da sessão nova (a mesma Medicao do `proxima`). */
  const pendente = (sessao, x = 50) => {
    const leitura = lerLeitura(sessao, readFileSync(join(dir, '.harness', 'contexto', `${sessao}.json`), 'utf8'));
    assert.ok(leitura, 'o mod gravou a leitura da sessão nova');
    return pousoPendente(diario.ler(entregas), true, { x, agoraMs: Date.now(), sessaoAtual: sessao, leituras: [leitura] }).pendente;
  };
  return { cli, clearDe, medir, painel, pendente, veredito, tipos: () => diario.ler(entregas).map((e) => e.tipo) };
}

test('fumaca-pouso-retomada: pousar ⇒ /clear (simulado) ⇒ sessão nova medida abaixo do teto ⇒ proxima despacha e o painel não pede mais limpar', () => {
  const a = ambiente();
  a.veredito(); // GM-15 T35 (r.12, D-P13): o pedido de /clear exige a fronteira e a leitura própria medida
  a.medir('S1', 60);
  assert.equal(a.cli(['pousar', '--sessao', 'S1']).rc, 0);
  assert.deepEqual(a.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' }, 'controle: antes do /clear o pouso está pendente');
  assert.match(a.painel('S1'), /limpar a conversa/);
  a.clearDe('S2');
  a.medir('S2', 19);
  const r = a.cli(['proxima', '--sessao', 'S2', '--vivos', '0']);
  assert.equal(r.rc, 0, r.out);
  assert.equal(r.j.acao.tipo, 'despachar', r.out);
  assert.equal(r.j.sinais.percent, 19);
  assert.doesNotMatch(a.painel('S2'), /limpar a conversa/);
  assert.deepEqual(a.tipos().filter((t) => t === 'sessao.pouso' || t === 'sessao.inicio'), ['sessao.pouso', 'sessao.inicio']);
});

test('fumaca-pouso-acima-do-teto-nao-retoma: o /clear não limpou (sessão nova ainda em 80 %) ⇒ o pouso segue pendente e nada despacha', () => {
  const a = ambiente();
  assert.equal(a.cli(['pousar', '--sessao', 'S1']).rc, 0);
  a.clearDe('S2');
  a.medir('S2', 80);
  const r = a.cli(['proxima', '--sessao', 'S2', '--vivos', '0']);
  assert.equal(r.rc, 0, r.out);
  assert.equal(r.j.acao.tipo, 'pousar', `contexto acima do teto não retoma: ${r.out}`);
  assert.equal(r.j.sinais.percent, 80);
});

test('fumaca-pouso-pendente-mede-sessao-nova: com o /clear no diário, o pouso só some se a sessão nova foi medida abaixo do teto (núcleo, com o contexto gravado pelo mod)', () => {
  const a = ambiente();
  a.veredito();
  const pz = a.cli(['pousar', '--sessao', 'S1']);
  assert.equal(pz.rc, 0, pz.out);
  a.clearDe('S2');
  a.medir('S2', 80);
  assert.equal(a.pendente('S2'), true, '80 % ≥ X: o /clear não limpou, o pouso segue pendente');
  a.medir('S2', 19);
  assert.equal(a.pendente('S2'), false, '19 % < X: retomada vale');
});

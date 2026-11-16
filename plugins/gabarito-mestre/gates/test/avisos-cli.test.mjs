/**
 * GM-15 T19 (REQ-AUT-2 c, REQ-POU-3, REQ-POU-4): os avisos de trava, pouso e loop atravessam as bordas reais, do gravador do mod ao desenho do mod.
 *   mod (gravarSinalLoop: o argv REAL, `node -e` com o script do mod) ⇒ `.harness/contexto/loop-dinamico.<sessao>.json` ⇒ `painel.mjs estado` (CLI real) ⇒
 *   `estadoParaDesenho` + `linhasDaPane` + `botoesPorLinha` do mod (o que o dono vê e os botões que ele aperta).
 * Obrigações herdadas: review T17 r1 MINOR (mutação O3: o argv de `gravarSinalLoop` executado de fato) e review T17 r3 MINOR (mutação R3c: o corpo do
 * `SCRIPT_SINAL_LOOP` cria `.harness/contexto/`). Cada repositório é um `mkdtemp` (raizSegura: nunca o checkout).
 *
 * Mutações: M19-o o script do sinal sem `mkdirSync` (R3c) ⇒ avisos-atravessam-mod-e-painel · M19-p `gravarSinalLoop` com argv que não grava (O3) ⇒
 * avisos-atravessam-mod-e-painel · M19-j o pedido de /clear com o loop desligado ⇒ clear-so-com-wakeup-atravessa-o-mod
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { raizSegura } from './_raiz-segura.mjs';
import * as diario from '../dist/diario.js';
import { CMD_LIGAR_LOOP, MOTIVO_LIGAR_ANTES_DO_CLEAR, MOTIVO_LIGAR_LOOP, motivoContextoAlto } from '../dist/depende.js';
import { estadoDoPainel } from '../scripts/painel.mjs';
import { gravarSinalLoop, sinalDoLoop } from '../../mod/gabarito.mjs';
import { botoesPorLinha, estadoParaDesenho, linhasDaPane } from '../../mod/painel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(AQUI, '..', '..');
const SCRIPT = join(AQUI, '..', 'scripts', 'painel.mjs');
const ENTREGA = 'GM-12';
const ROOT = '/plugin-raiz';

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Repo descartável na branch da entrega, plano T1 → T2 (T2 depende de T1). `onboarding` ⇒ `harness.config.json` versionado (o mod só grava com ele). */
function repo({ onboarding = true } = {}) {
  const base = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'avisos cli '))));
  const r = join(base, 'repo');
  mkdirSync(r);
  g(r, 'init', '-q', '-b', `feat/${ENTREGA}-avisos`);
  g(r, 'config', 'user.email', 't@t.test');
  g(r, 'config', 'user.name', 't');
  g(r, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(r, 'README.md'), 'x\n');
  if (onboarding) writeFileSync(join(r, 'harness.config.json'), '{}\n');
  g(r, 'add', '.');
  g(r, 'commit', '-q', '-m', 'inicio');
  const dir = join(r, '.harness', 'entregas', ENTREGA);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plano.json'), JSON.stringify({
    entrega: ENTREGA, tasks: [{ id: 'T1', titulo: 'Um', deps: [], arquivos: ['a.txt'] }, { id: 'T2', titulo: 'Dois', deps: ['T1'], arquivos: ['b.txt'] }],
  }));
  return { repo: r, dir };
}
function ev(m, tipo, dados, ms, sessao = 'loop') {
  const r = diario.append(m.dir, sessao, { ts: new Date(ms).toISOString(), autor: 't@t.test', sessao, agente: 'orquestrador', tipo, dados });
  assert.ok(r.ok && r.gravado === 'evento', `preparo: ${tipo} ${JSON.stringify(r)}`);
  return r;
}

/** O gravador do mod, pelo argv REAL (`node -e <SCRIPT_SINAL_LOOP>`) na raiz da sessão, como `$.process.run` o roda. */
function gravarSinal(m, sessao, crons, emMs = Date.now()) {
  const q = gravarSinalLoop({ pluginRoot: PLUGIN, ...sinalDoLoop({ session_crons: crons }), sessao, emMs });
  assert.ok(q !== null);
  assert.equal(q.argv[0], 'node');
  const r = spawnSync(process.execPath, q.argv.slice(1), { cwd: m.repo, input: q.stdin, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
}

/** O painel real pelo CLI (`painel.mjs estado --sessao`). */
function estadoCli(m, sessao) {
  const r = spawnSync(process.execPath, [SCRIPT, 'estado', '--sessao', sessao], { cwd: m.repo, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout.trim());
  assert.equal(j.ok, true, r.stdout);
  return j.estado;
}

/** O que o mod desenha (texto das linhas) e os comandos dos botões da linha que casa `re`. */
function doMod(estado, re) {
  const linhas = linhasDaPane(estadoParaDesenho(estado), {}, 120);
  const textos = linhas.map((l) => l.map((s) => String(s?.texto ?? '')).join(''));
  const i = textos.findIndex((t) => re.test(t));
  const mapa = botoesPorLinha(estado, ROOT, linhas);
  return { texto: textos.join('\n'), linha: i >= 0 ? textos[i] : null, botoes: i >= 0 ? (mapa.get(i) ?? []).map((b) => b.comando) : [], todos: [...mapa.values()].flat().map((b) => b.comando) };
}

test('avisos-atravessam-mod-e-painel (REQ-POU-4): o argv real do mod cria `.harness/contexto/` e grava o sinal; o painel real o lê e o mod desenha "ligar o loop automático" com o botão; armado, some', () => {
  const m = repo();
  const contexto = join(m.repo, '.harness', 'contexto');
  assert.equal(existsSync(contexto), false, 'preparo: sem a pasta de contexto');
  gravarSinal(m, 'S1', []);
  assert.ok(existsSync(join(contexto, 'loop-dinamico.S1.json')), 'o script do mod cria a pasta e grava o sinal da sessão');
  assert.equal(JSON.parse(readFileSync(join(contexto, 'loop-dinamico.S1.json'), 'utf8')).estado, 'ausente');

  const e1 = estadoCli(m, 'S1');
  const item = e1.depende.find((i) => i.motivo === MOTIVO_LIGAR_LOOP);
  assert.ok(item !== undefined, JSON.stringify(e1.depende));
  assert.deepEqual(item.acoes, [{ rotulo: 'ligar o loop', comando: CMD_LIGAR_LOOP }]);
  const d1 = doMod(e1, /ligar o loop automático/);
  assert.ok(d1.linha !== null, d1.texto);
  assert.doesNotMatch(d1.linha, /\/loop/, 'o comando só no botão');
  assert.deepEqual(d1.botoes, [CMD_LIGAR_LOOP], 'o mod põe o botão na linha do item');

  // outra sessão não vê o sinal de S1 (estado por sessão, aprendizado 116)
  assert.ok(!estadoCli(m, 'S2').depende.some((i) => i.motivo === MOTIVO_LIGAR_LOOP));

  gravarSinal(m, 'S1', [{ recurring: false }]);
  const e2 = estadoCli(m, 'S1');
  assert.ok(!e2.depende.some((i) => i.motivo === MOTIVO_LIGAR_LOOP), JSON.stringify(e2.depende));
  assert.doesNotMatch(doMod(e2, /x^/).texto, /ligar o loop automático/);
});

test('avisos-atravessam-mod-e-painel: sem onboarding o script do mod não grava nada e o painel não avisa o loop', () => {
  const m = repo({ onboarding: false });
  gravarSinal(m, 'S1', []);
  assert.equal(existsSync(join(m.repo, '.harness', 'contexto')), false);
  assert.ok(!estadoCli(m, 'S1').depende.some((i) => i.motivo === MOTIVO_LIGAR_LOOP));
});

test('clear-so-com-wakeup-atravessa-o-mod (REQ-POU-4, aprendizado 185): pouso pendente medido + loop desligado ⇒ o mod não oferece /clear; armado ⇒ oferece', () => {
  const m = repo();
  const t = Date.now() - 10 * 60_000;
  ev(m, 'task.iniciada', { task: 'T1', papel: 'implementador' }, t);
  ev(m, 'task.concluida', { task: 'T1', sha: 'a'.repeat(40) }, t + 1000);
  ev(m, 'task.iniciada', { task: 'T1', papel: 'revisor' }, t + 2000);
  ev(m, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }, t + 3000);
  ev(m, 'sessao.pouso', { percent: 60, x: 50 }, t + 4000, 'S1');
  mkdirSync(join(m.repo, '.harness', 'contexto'), { recursive: true });
  writeFileSync(join(m.repo, '.harness', 'contexto', 'S1.json'), JSON.stringify({ percent: 62, fonte: 'mod', em: new Date().toISOString() }));

  gravarSinal(m, 'S1', []);
  const off = estadoCli(m, 'S1');
  const dOff = doMod(off, /ligar o loop automático antes de limpar a conversa/);
  assert.ok(dOff.linha !== null, dOff.texto);
  assert.ok(!dOff.todos.includes('/clear'), `nenhum botão de /clear: ${JSON.stringify(dOff.todos)}`);
  assert.ok(dOff.botoes.includes(CMD_LIGAR_LOOP));
  assert.ok(off.depende.some((i) => i.motivo === MOTIVO_LIGAR_ANTES_DO_CLEAR));

  gravarSinal(m, 'S1', [{ recurring: false }]);
  const on = doMod(estadoCli(m, 'S1'), /limpar a conversa/);
  assert.ok(on.linha !== null, on.texto);
  assert.ok(on.todos.includes('/clear'), JSON.stringify(on.todos));
});

test('contexto-alto-sem-pouso-atravessa-o-mod (REQ-POU-3): leitura própria >= X, loop armado e sem pouso ⇒ o mod desenha "limpar a conversa" dizendo que quem limpa é o mod, sem botão', () => {
  const m = repo();
  mkdirSync(join(m.repo, '.harness', 'contexto'), { recursive: true });
  writeFileSync(join(m.repo, '.harness', 'contexto', 'S1.json'), JSON.stringify({ percent: 62, fonte: 'mod', em: new Date().toISOString() }));
  gravarSinal(m, 'S1', [{ recurring: false }]);
  const e = estadoCli(m, 'S1');
  const d = doMod(e, /quem limpa é o mod/);
  assert.equal(d.linha?.trim().replace(/^◆ /, ''), motivoContextoAlto(62, 50), d.texto);
  assert.deepEqual(d.botoes, []);
  assert.ok(!d.todos.includes('/clear'));
});

test('trava-30min-atravessa-o-mod (REQ-AUT-2 c): T1 no teto há 45 min ⇒ o mod desenha "parado há 45 min: …" e o botão de liberar fica só no botão', () => {
  const m = repo();
  const agora = Date.UTC(2026, 10, 16, 15, 0, 0);
  const t = agora - 50 * 60_000;
  const evs = [
    ['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
    ['task.iniciada', { task: 'T1', papel: 'revisor' }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }],
    ['task.iniciada', { task: 'T1', papel: 'correcao' }], ['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }],
    ['task.iniciada', { task: 'T1', papel: 'revisor' }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
  ];
  evs.forEach(([tipo, dados], i) => ev(m, tipo, dados, t + i * 1000));
  // as pendências de aprendizado das 2 reprovações (seq 4 e 8 da sessão `loop`) fechadas; o último evento de progresso cai em t + 5 min ⇒ 45 min de trava
  for (const s of [4, 8]) ev(m, 'aprendizado.nada', { gatilho: { sessao: 'loop', seq: s }, motivo: 'teste' }, t + 5 * 60_000, 'ap');
  const r = estadoDoPainel(m.repo, { agoraMs: agora, sessao: 'S1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = doMod(r.estado, /parado há 45 min/);
  assert.ok(d.linha !== null, d.texto);
  assert.match(d.linha, /parado há 45 min: teto de rodadas de review em T1/);
  assert.doesNotMatch(d.linha, /gabarito-mestre|\//, 'o comando não está no texto');
  assert.deepEqual(d.botoes, ['/gabarito-mestre:liberar T1']);
});

/**
 * `avaliar.mjs estado` (GM-10 T13 r8, sombra-t13g item 4): `parou` é o ÚLTIMO `loop.parar` sem evento de task depois.
 * Antes era `ev.some(loop.parar)`: depois de `liberar` (grava `task.reaberta{dono}`) o `.exp` sairia como PAROU.
 * MUTAÇÕES: M1 voltar a `some` ⇒ `parou-cai-depois-de-liberar` falha; M2 olhar o PRIMEIRO `loop.parar` (indexOf) ⇒ `parou-volta-no-2o-parar` falha;
 * M3 contar qualquer evento depois (não só `task.`) ⇒ `parou-fica-com-evento-que-nao-e-de-task` falha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(AQUI, '..', '..');
const AVALIAR = join(AQUI, 'e2e', 'avaliar.mjs');
const S = '44444444-0000-4000-8000-000000000004';

async function parou(eventos, modLinhas = []) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'avalest-'));
  const repo = join(base, 'repo');
  const run = join(base, 'run');
  const dir = join(repo, '.harness', 'entregas', 'GM-99');
  mkdirSync(dir, { recursive: true });
  mkdirSync(run, { recursive: true });
  const d = await import(pathToFileURL(join(PLUGIN, 'gates', 'dist', 'diario.js')).href);
  for (const [tipo, dados] of eventos) d.append(dir, S, { ts: new Date().toISOString(), autor: 'a@b.c', sessao: S, agente: 'orquestrador', tipo, dados });
  if (modLinhas.length) writeFileSync(join(run, 'mod.jsonl'), modLinhas.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const r = spawnSync('node', [AVALIAR, 'estado', repo, run, PLUGIN], { encoding: 'utf8' });
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

const PARAR = ['loop.parar', { motivo: 'teto_rodadas', task: 'T1' }];
const LIBERAR = ['task.reaberta', { task: 'T1', origem: 'dono' }];

test('parou-com-parar-sem-nada-depois', async () => {
  assert.equal((await parou([PARAR])).parou, true);
});

test('parou-cai-depois-de-liberar', async () => {
  assert.equal((await parou([PARAR, LIBERAR])).parou, false);
});

test('parou-volta-no-2o-parar', async () => {
  assert.equal((await parou([PARAR, LIBERAR, PARAR])).parou, true);
});

test('parou-fica-com-evento-que-nao-e-de-task', async () => {
  assert.equal((await parou([PARAR, ['sessao.pouso', { percent: 5, x: 1 }]])).parou, true);
});

test('sem-parar-nao-parou', async () => {
  assert.equal((await parou([LIBERAR])).parou, false);
});

// r8b: o gatilho do `.exp` no modo `liberar` é `acao=parar` estável + turno do orquestrador encerrado + running 0 (não `parou=true`).
test('turnos-conta-so-turn-complete-do-orquestrador', async () => {
  const mod = [
    { ev: 'turn.complete', agente: null },
    { ev: 'turn.complete', agente: 'abc12345' }, // subagent não conta
    { ev: 'PreToolUse', agente: null },          // outro evento não conta
    { ev: 'turn.complete', agente: null },
  ];
  assert.equal((await parou([PARAR], mod)).turnos, 2);
});

test('turnos-zero-sem-observador', async () => {
  assert.equal((await parou([PARAR])).turnos, 0);
});

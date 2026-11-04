/**
 * `avaliar.mjs relatorio liberar` (GM-10 T13 r8, sombra-t13g item 6). Plugin de mentira: `dist/` real (symlink) e `loop.mjs` que responde `concluir`.
 * Cada caso monta diário, `sends.log`, `classic.jsonl`, `debug.log`, listagens de `.tmp-gabarito` e um transcript, e lê o veredito.
 * MUTAÇÕES: M1 não exigir `task.reaberta{dono}` ⇒ `controle-sem-liberacao-reprova`; M2 não olhar o intervalo T9..T1 ⇒ `evento-entre-t9-e-t1-reprova`;
 * M3 não contar `Exit code 127` ⇒ `exit-127-reprova`; M4 aceitar sem o systemMessage do Stop ⇒ `sem-systemmessage-do-stop-nao-prova`;
 * M5 digitação livre ⇒ `digitacao-extra-reprova`; M6 não exigir `ciclo-1` ⇒ `sem-ciclo-1-reprova`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN_REAL = join(AQUI, '..', '..');
const AVALIAR = join(AQUI, 'e2e', 'avaliar.mjs');
const S = '55555555-0000-4000-8000-000000000005';

async function corrida(o = {}) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'avallib-'));
  const repo = join(base, 'repo'); const run = join(base, 'run'); const home = join(base, 'home'); const plugin = join(base, 'plugin');
  const dir = join(repo, '.harness', 'entregas', 'GM-99');
  mkdirSync(dir, { recursive: true }); mkdirSync(run, { recursive: true }); mkdirSync(join(plugin, 'gates', 'scripts'), { recursive: true });
  symlinkSync(join(PLUGIN_REAL, 'gates', 'dist'), join(plugin, 'gates', 'dist'));
  writeFileSync(join(plugin, 'gates', 'scripts', 'loop.mjs'), `console.log(JSON.stringify({ ok: true, acao: { tipo: ${JSON.stringify(o.acao ?? 'concluir')} }, sinais: [] }));`);
  const d = await import(pathToFileURL(join(PLUGIN_REAL, 'gates', 'dist', 'diario.js')).href);
  const t0 = Math.floor(Date.now() / 1000) - 1000;
  const ts = (seg) => new Date((t0 + seg) * 1000).toISOString();
  const ev = (seg, tipo, dados, sessao = S) => d.append(dir, S, { ts: ts(seg), autor: 'a@b.c', sessao, agente: 'orquestrador', tipo, dados });
  ev(10, 'loop.parar', { motivo: 'teto_rodadas', task: 'T1' });
  if (o.entre) ev(110, 'task.iniciada', { task: 'T1', papel: 'implementador' });
  if (o.liberacao !== false) ev(o.tLiberar ?? 140, 'task.reaberta', { task: 'T1', origem: 'dono' }, 'dono');
  if (o.integrada !== false) ev(300, 'task.integrada', { task: 'T1', sha: 'a'.repeat(40) });
  writeFileSync(join(run, 'sends.log'), (o.sends ?? [`${t0 + 50} trust`, `${t0 + 51} prompt`, `${t0 + 100} liberar-t9`, `${t0 + 120} liberar-t1`, `${t0 + 400} exit`]).join('\n') + '\n');
  writeFileSync(join(run, 'classic.jsonl'), [{ ev: 'UserPromptExpansion', command_name: 'gabarito-mestre:liberar', command_args: 'T9' }, { ev: 'UserPromptExpansion', command_name: 'gabarito-mestre:liberar', command_args: 'T1' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  writeFileSync(join(run, 'debug.log'), o.semStop ? 'nada\n' : '[DEBUG] "Hook Stop (Stop) success:\\n{\\"systemMessage\\":\\"Loop da entrega GM-99 concluído. Liberações do teto: T1 (x, y).\\"}"\n');
  writeFileSync(join(run, 'tmp-T1-antes.txt'), '.tmp-gabarito:\nreview-r1.md\nreview-r2.md\n');
  if (o.ciclo !== false) writeFileSync(join(run, 'tmp-T1-depois.txt'), '.tmp-gabarito:\nciclo-1\n\n.tmp-gabarito/ciclo-1:\nreview-r1.md\n'); else writeFileSync(join(run, 'tmp-T1-depois.txt'), '.tmp-gabarito:\nreview-r1.md\n');
  const pasta = join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9-]/g, '-'));
  mkdirSync(pasta, { recursive: true });
  const linha = (texto) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: texto }] } });
  writeFileSync(join(pasta, `${S}.jsonl`), [linha('ok'), ...(o.exit127 ? [linha('Exit code 127\n(eval):1: no such file')] : [])].join('\n') + '\n');
  const r = spawnSync('node', [AVALIAR, 'relatorio', 'liberar', repo, run, plugin], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  return JSON.parse(r.stdout);
}

test('bom-caso-e-verde', async () => {
  const o = await corrida();
  assert.deepEqual(o.falhas, []);
  assert.deepEqual(o.nao_provado, []);
  assert.equal(o.veredito_final, 'VERDE');
});

test('controle-sem-liberacao-reprova', async () => {
  const o = await corrida({ liberacao: false, integrada: false, acao: 'parar' });
  assert.equal(o.veredito_final, 'REPROVADO');
  assert.ok(o.falhas.some((f) => /task\.reaberta\{dono\}/.test(f)));
});

test('evento-entre-t9-e-t1-reprova', async () => {
  const o = await corrida({ entre: true });
  assert.equal(o.veredito_final, 'REPROVADO');
  assert.ok(o.falhas.some((f) => /entre o T9 e o T1/.test(f)));
});

test('exit-127-reprova', async () => {
  const o = await corrida({ exit127: true });
  assert.equal(o.exit_127, 1);
  assert.equal(o.veredito_final, 'REPROVADO');
});

test('sem-systemmessage-do-stop-nao-prova', async () => {
  const o = await corrida({ semStop: true });
  assert.equal(o.veredito_final, 'NAO_PROVADO');
});

test('digitacao-extra-reprova', async () => {
  const t = Math.floor(Date.now() / 1000) - 1000;
  const o = await corrida({ sends: [`${t + 50} trust`, `${t + 51} prompt`, `${t + 100} liberar-t9`, `${t + 120} liberar-t1`, `${t + 130} retomar`] });
  assert.equal(o.veredito_final, 'REPROVADO');
  assert.ok(o.falhas.some((f) => /digitação/.test(f)));
});

test('sem-ciclo-1-reprova', async () => {
  const o = await corrida({ ciclo: false });
  assert.equal(o.veredito_final, 'REPROVADO');
  assert.ok(o.falhas.some((f) => /ciclo-1/.test(f)));
});

/**
 * `avaliar.mjs relatorio 1` (GM-10 T13 r2, review r1 MAJOR 1): aceites 1 (a-d), 4a, 4b e `veredito_final` com dados sintéticos mínimos.
 * Repo git de verdade (1a usa `merge-base`), diário escrito por `append` real, plugin de mentira só com `loop.mjs proxima`.
 * Costura P9: `relatorio 1` lê o diário, o observador (classic/mod/sends/exp) e os transcripts pelo CLI real do instrumento.
 * MUTAÇÕES (review MR1-MR6): 1a sem ação final ⇒ `1a-acao-final-parar-reprova`; 1a sem loop.parar ⇒ `1a-loop-parar-reprova`; 1d sem veredito novo ⇒ `1d-pouso-sem-veredito-novo-reprova`;
 * 1d sem pouso = retomada ⇒ `1d-pouso-diferente-de-retomada-reprova`; 4a sem `n === 3` ⇒ `4a-n-diferente-de-3-reprova`; `veredito_final` constante VERDE ⇒ todos os casos de reprovação.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN_REAL = join(AQUI, '..', '..');
const AVALIAR = join(AQUI, 'e2e', 'avaliar.mjs');
const S1 = '11111111-0000-4000-8000-000000000001';
const S2 = '22222222-0000-4000-8000-000000000002';
const AG = 'agentaaaaaaaaaaaa';
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });

/** Corrida VERDE por padrão; `o` troca um detalhe por vez. */
async function corrida(o = {}) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'aval1-'));
  const repo = join(base, 'repo'); const run = join(base, 'run'); const home = join(base, 'home'); const plugin = join(base, 'plugin');
  const dir = join(repo, '.harness', 'entregas', 'GM-99');
  mkdirSync(dir, { recursive: true }); mkdirSync(run, { recursive: true }); mkdirSync(join(plugin, 'gates', 'scripts'), { recursive: true });
  git(repo, 'init', '-q'); writeFileSync(join(repo, 'x.txt'), 'x'); git(repo, 'add', 'x.txt'); git(repo, 'commit', '-q', '-m', 'x');
  const head = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  const sha = o.shaFora ? 'b'.repeat(40) : head;
  const tasks = o.quatro || o.planoQuatro ? ['T1', 'T2', 'T3', 'T4'] : ['T1', 'T2', 'T3'];
  writeFileSync(join(dir, 'plano.json'), JSON.stringify({ entrega: 'GM-99', tasks: tasks.map((id) => ({ id, deps: id === 'T3' ? ['T1'] : [], arquivos: [] })) }));
  // o instrumento carrega `gates/dist/{diario,loop}.js` do plugin que recebe: copia o `dist/` real
  spawnSync('cp', ['-R', join(PLUGIN_REAL, 'gates', 'dist'), join(plugin, 'gates', 'dist')]);
  writeFileSync(join(plugin, 'gates', 'scripts', 'loop.mjs'), `console.log(JSON.stringify({ ok: true, acao: { tipo: ${JSON.stringify(o.acao ?? 'concluir')} }, sinais: {} }));`);
  const d = await import(pathToFileURL(join(PLUGIN_REAL, 'gates', 'dist', 'diario.js')).href);
  const t0 = Math.floor(Date.now() / 1000) - 5000;
  const ts = (seg) => new Date((t0 + seg) * 1000).toISOString();
  // eventos acumulados e gravados em ordem de `ts` (ordem estável): `append` dá o `seq` na ordem das chamadas
  const fila = [];
  const ev = (sid, seg, tipo, dados, agente = 'orquestrador') => fila.push({ sid, seg, e: { ts: ts(seg), autor: 'a@b.c', sessao: sid, agente, tipo, dados } });
  const ini = (sid, seg, t) => ev(sid, seg, 'task.iniciada', { task: t, papel: 'implementador' });
  const conc = (sid, seg, t) => ev(sid, seg, 'task.concluida', { task: t, sha });
  const ver = (sid, seg, t) => ev(sid, seg, 'review.veredito', { task: t, veredito: o.reprovaT3 && t === 'T3' ? 'REPROVADO' : 'APROVADO', rodada: 1, blocker: 0, major: 0 });
  const integ = (sid, seg, t) => ev(sid, seg, 'task.integrada', { task: t, sha });
  // sessão 1: T1 e T2 em paralelo; vereditos; pouso. Sessão 2: retomada; T3 depois da integrada de T1.
  if (!o.semIniciada) ini(S1, 10, 'T1');
  ini(S1, o.t2Ini ?? 11, 'T2');
  conc(S1, 60, 'T1'); conc(S1, 61, 'T2');
  ver(S1, 70, 'T1'); ver(S1, 71, 'T2'); integ(S1, 80, 'T1'); integ(S1, 81, 'T2');
  if (o.parar) ev(S1, 82, 'loop.parar', { motivo: 'teto_rodadas', task: 'T3' });
  if (!o.semPouso) {
    ev(S1, o.pousoCedo ? 55 : 90, 'sessao.pouso', { percent: 50 });
    if (!o.semRetomada) ev(S2, o.retomadaAntes ? 85 : 100, 'sessao.retomada', { chars: 100 });
  }
  ini(S2, 110, 'T3'); conc(S2, 150, 'T3'); ver(S2, 160, 'T3'); integ(S2, 170, 'T3');
  if (o.quatro) { ini(S2, 171, 'T4'); conc(S2, 180, 'T4'); ver(S2, 190, 'T4'); integ(S2, 200, 'T4'); }
  // medições: orquestrador por sessão, 1 subagent
  const tok = { input_tokens: 100, output_tokens: 50, cache_read: 0, cache_creation: 0 };
  ev(S1, 95, 'custo.medicao', tok); ev(S2, 195, 'custo.medicao', tok);
  if (!o.semMedicaoAgente) ev(S1, 96, 'custo.medicao', tok, `subagent:${AG}`);
  fila.sort((x, y) => x.seg - y.seg);
  for (const x of fila) d.append(dir, x.sid, x.e);
  // observador
  const sends = o.sends ?? ['1 trust', '2 prompt', '9 exit'];
  if (!o.semSends) writeFileSync(join(run, 'sends.log'), sends.join('\n') + '\n');
  if (!o.semExpLog) writeFileSync(join(run, 'exp.log'), o.pergunta ? 'x PERGUNTA-DE-PERMISSAO y\n' : 'ok\n');
  writeFileSync(join(run, 'exp.status'), 'CONCLUIDO\n');
  const clears = o.clears ?? 1;
  const trSub = join(base, 'sub.jsonl');
  writeFileSync(trSub, JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 50 } } }) + '\n');
  const cls = [{ ev: 'SubagentStop', agent: AG, agent_type: 'gabarito-mestre:gabarito-implementador', transcript: trSub }];
  for (let i = 0; i < clears; i++) cls.push({ ev: 'SessionStart', source: 'clear' });
  writeFileSync(join(run, 'classic.jsonl'), cls.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const mod = [{ ev: 'prompt.submit', origem: 'composer', t: 1 }, ...(o.composer2 ? [{ ev: 'prompt.submit', origem: 'composer', t: 2 }] : []), { ev: 'x', lista: [{ st: 'running', tipo: 'gabarito-implementador' }, { st: 'running', tipo: 'gabarito-implementador' }] }];
  for (let i = 0; i < clears; i++) mod.push({ ev: 'command.run', comando: 'clear' });
  writeFileSync(join(run, 'mod.jsonl'), mod.map((x) => JSON.stringify(x)).join('\n') + '\n');
  // transcripts do orquestrador (em ~/.claude/projects/<repo>/<sid>.jsonl)
  const pasta = join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9-]/g, '-'));
  mkdirSync(pasta, { recursive: true });
  const asst = (id) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: 100, output_tokens: 50 } } });
  const proxima = [
    JSON.stringify({ type: 'assistant', message: { id: 'p', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'node loop.mjs proxima --vivos 0' } }], usage: { input_tokens: 0, output_tokens: 0 } } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: JSON.stringify({ ok: true, acao: { tipo: 'despachar' }, sinais: { slots: o.slots ?? 2 } }) }] } }),
  ];
  // o transcript soma por `message.id` o maior valor: a 1ª sessão tem 'p' (0) + 'a1' (150); a 2ª, 'a2' (150)
  writeFileSync(join(pasta, `${S1}.jsonl`), [...proxima, asst('a1'), ...(o.exit127 ? [JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Exit code 127\nx' }] } })] : [])].join('\n') + '\n');
  writeFileSync(join(pasta, `${S2}.jsonl`), asst('a2') + '\n');
  const r = spawnSync('node', [AVALIAR, 'relatorio', '1', repo, run, plugin], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  return JSON.parse(r.stdout);
}

test('bom-caso-e-verde', async () => {
  const o = await corrida();
  for (const k of ['1a', '1b', '1c', '1d', '4a', '4b']) assert.equal(o[k].veredito, 'VERDE', `${k}: ${JSON.stringify(o[k])}`);
  assert.equal(o.veredito_final, 'VERDE');
});

// 1a
test('1a-acao-final-parar-reprova', async () => {
  const o = await corrida({ acao: 'parar' });
  assert.equal(o['1a'].veredito, 'REPROVADO');
  assert.ok(o['1a'].falhas.some((f) => /acao final/.test(f)));
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('1a-loop-parar-reprova', async () => {
  const o = await corrida({ parar: true });
  assert.equal(o['1a'].veredito, 'REPROVADO');
  assert.ok(o['1a'].falhas.some((f) => /loop\.parar/.test(f)));
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('1a-sha-fora-da-branch-reprova', async () => {
  const o = await corrida({ shaFora: true });
  assert.equal(o['1a'].veredito, 'REPROVADO');
  assert.ok(o['1a'].falhas.some((f) => /sha fora da branch/.test(f)));
});
test('1a-integradas-a-menos-que-o-plano-reprova', async () => {
  const o = await corrida({ planoQuatro: true });
  assert.equal(o['1a'].veredito, 'REPROVADO');
  assert.ok(o['1a'].falhas.some((f) => /integradas 3 != 4/.test(f)));
});

// 1b
test('1b-digitacao-extra-reprova', async () => {
  const o = await corrida({ sends: ['1 trust', '2 prompt', '3 retomar', '9 exit'] });
  assert.equal(o['1b'].veredito, 'REPROVADO');
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('1b-pergunta-de-permissao-reprova', async () => {
  const o = await corrida({ pergunta: true });
  assert.equal(o['1b'].veredito, 'REPROVADO');
});
test('1b-dois-prompts-do-composer-reprova', async () => {
  const o = await corrida({ composer2: true });
  assert.equal(o['1b'].veredito, 'REPROVADO');
});
test('1b-sem-sends-log-nao-prova', async () => {
  const o = await corrida({ semSends: true });
  assert.equal(o['1b'].veredito, 'NAO_PROVADO');
  assert.notEqual(o.veredito_final, 'VERDE');
});
test('1b-sem-exp-log-nao-prova', async () => {
  const o = await corrida({ semExpLog: true });
  assert.equal(o['1b'].veredito, 'NAO_PROVADO');
  assert.notEqual(o.veredito_final, 'VERDE');
});

// 1c
test('1c-sem-sobreposicao-reprova', async () => {
  const o = await corrida({ t2Ini: 65 });
  assert.equal(o['1c'].sobreposicao_T1_T2, false);
  assert.equal(o['1c'].veredito, 'REPROVADO');
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('1c-um-slot-nao-prova', async () => {
  const o = await corrida({ slots: 1 });
  assert.equal(o['1c'].veredito, 'NAO_PROVADO');
  assert.equal(o.veredito_final, 'PARCIAL');
});

// 1d
test('1d-sem-pouso-reprova', async () => {
  const o = await corrida({ semPouso: true });
  assert.equal(o['1d'].veredito, 'REPROVADO');
  assert.ok(o['1d'].falhas.some((f) => /0 pouso/.test(f)));
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('1d-pouso-diferente-de-retomada-reprova', async () => {
  const o = await corrida({ semRetomada: true });
  assert.equal(o['1d'].veredito, 'REPROVADO');
  assert.ok(o['1d'].falhas.some((f) => /pouso != retomada/.test(f)));
});
test('1d-pouso-sem-veredito-novo-reprova', async () => {
  const o = await corrida({ pousoCedo: true });
  assert.equal(o['1d'].veredito, 'REPROVADO');
  assert.ok(o['1d'].falhas.some((f) => /sem veredito novo/.test(f)));
});
test('1d-clear-diferente-de-pousos-reprova', async () => {
  const o = await corrida({ clears: 2 });
  assert.equal(o['1d'].veredito, 'REPROVADO');
  assert.ok(o['1d'].falhas.some((f) => /\/clear != pousos/.test(f)));
});
test('1d-retomada-antes-do-pouso-reprova', async () => {
  const o = await corrida({ retomadaAntes: true });
  assert.equal(o['1d'].veredito, 'REPROVADO');
  assert.ok(o['1d'].falhas.some((f) => /retomada antes do pouso/.test(f)));
});

// 4a
test('4a-sem-task-iniciada-reprova', async () => {
  const o = await corrida({ semIniciada: true });
  assert.equal(o['4a'].veredito, 'REPROVADO');
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('4a-n-diferente-de-3-reprova', async () => {
  const o = await corrida({ quatro: true });
  assert.equal(o['4a'].eta.n, 4);
  assert.equal(o['4a'].veredito, 'REPROVADO');
});
test('4a-menos-de-3-aprovacoes-nao-prova', async () => {
  const o = await corrida({ reprovaT3: true });
  assert.equal(o['4a'].veredito, 'NAO_PROVADO');
  assert.notEqual(o.veredito_final, 'VERDE');
});

// 4b e final
test('4b-agente-sem-medicao-reprova', async () => {
  const o = await corrida({ semMedicaoAgente: true });
  assert.equal(o['4b'].veredito, 'REPROVADO');
  assert.equal(o.veredito_final, 'REPROVADO');
});
test('exit-127-reprova', async () => {
  const o = await corrida({ exit127: true });
  assert.equal(o.exit_127, 1);
  assert.equal(o.veredito_final, 'REPROVADO');
});

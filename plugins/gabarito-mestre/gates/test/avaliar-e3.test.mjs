/**
 * `e2e/avaliar-e3.mjs relatorio` (GM-11 T15 r2): o avaliador dos aceites da E3 não devolve VERDE por falta de dado.
 *  M1: transcript ausente ⇒ NAO_PROVADO com causa; linha ilegível de transcript ⇒ REPROVADO com causa (ausente ≠ corrompido).
 *  m2: aceite negado pelo classificador (`Auto mode classifier blocked action` no debug.log) ⇒ NAO_PROVADO com causa, não REPROVADO; não mascara falha real.
 *  m1: `mod_ativo_nesta_sessao` também vem do `debug.log` ("hooks module gabarito-mestre ... loaded").
 * Costura (P9): o CLI real do avaliador, o `dist/` real do diário e transcripts em HOME falso (`~/.claude/projects/<repo>/<sessão>.jsonl`).
 * Fora do `npm test` com LLM: nenhuma sessão real aqui.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(AQUI, '..', '..');
const AVALIAR = join(AQUI, 'e2e', 'avaliar-e3.mjs');
const SID = '11111111-0000-4000-8000-000000000001';
const CLASSIFICADOR = '2026-11-09T20:01:56.300Z [WARN] Auto mode classifier blocked action: [Production Deploy]';

const uso = (id, name, input) => ({ type: 'assistant', timestamp: '2026-11-09T19:00:00.000Z', message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const resultado = (id, texto) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: texto }] } });
const AGENT = (id) => uso(id, 'Agent', { subagent_type: 'gabarito-mestre:gabarito-sombra', model: 'opus' });
const PERGUNTAR = (id) => uso(id, 'Bash', { command: 'node gates/scripts/sombra.mjs perguntar --q x' });

/** Diário real (append do núcleo), transcripts em HOME falso. `o.transcript`: linhas do transcript (objeto ⇒ JSON, string ⇒ literal); `o.semTranscript` não o cria. */
async function corrida(o = {}) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'aval-e3-'));
  const repo = join(base, 'repo'); const run = join(base, 'run'); const home = join(base, 'home');
  const dir = join(repo, '.harness', 'entregas', 'GM-99');
  mkdirSync(dir, { recursive: true }); mkdirSync(run, { recursive: true });
  const d = await import(pathToFileURL(join(PLUGIN, 'gates', 'dist', 'diario.js')).href);
  let seg = 0;
  const ev = (tipo, dados, agente = 'orquestrador') => {
    const r = d.append(dir, SID, { ts: new Date(Date.UTC(2026, 10, 9, 19, 0, seg++)).toISOString(), autor: 'a@b.c', sessao: SID, agente, tipo, dados });
    assert.equal(r.ok, true, `fixture: ${JSON.stringify(r)}`);
  };
  for (const e of o.eventos ?? []) ev(e.tipo, e.dados, e.agente);
  writeFileSync(join(run, 'exp.status'), `${o.status ?? 'CONCLUIDO'}\n`);
  if (o.debug) writeFileSync(join(run, 'debug.log'), `${o.debug.join('\n')}\n`);
  const pasta = join(home, '.claude', 'projects', realpathSync(repo).replace(/[^A-Za-z0-9-]/g, '-'));
  mkdirSync(pasta, { recursive: true });
  const tr = join(pasta, `${SID}.jsonl`);
  if (!o.semTranscript) writeFileSync(tr, (o.transcript ?? []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');
  if (o.marcas) { mkdirSync(join(base, 'marcas')); for (const m of o.marcas) writeFileSync(join(base, 'marcas', m), ''); }
  return { base, repo, run, home, tr };
}

function relatorio(qual, c) {
  const r = spawnSync(process.execPath, [AVALIAR, 'relatorio', qual, c.repo, c.run, PLUGIN], { encoding: 'utf8', env: { ...process.env, HOME: c.home } });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* fica null */ }
  return { rc: r.status, j, stdout: r.stdout, stderr: r.stderr };
}

const H = 'a'.repeat(64);
const EV1 = [{ tipo: 'sombra.consulta', dados: { pergunta_hash: H, req: 'REQ-A-1' } }, { tipo: 'decisao.sombra', dados: { pergunta_hash: H, req: 'REQ-A-1', resposta: 'sim', arquivo: 'sombra.md', pergunta_enviesada: false, medicao: 'teste' } }];
const T1_OK = [AGENT('a1'), PERGUNTAR('p1'), resultado('p1', '{"ok":true,"cache":false}'), PERGUNTAR('p2'), resultado('p2', '{"ok":true,"cache":true}')];

test('aceite 1: transcript íntegro com 1 Agent Sombra e cache só na 2ª ⇒ VERDE (controle)', async () => {
  const r = relatorio('1', await corrida({ eventos: EV1, transcript: T1_OK }));
  assert.equal(r.j?.veredito, 'VERDE', r.stdout + r.stderr);
  assert.equal(r.j.agentes_sombra, 1);
  assert.equal(r.rc, 0);
});

test('M1: 2ª chamada Agent Sombra truncada no transcript não dá VERDE: ilegível ⇒ REPROVADO com causa', async () => {
  const truncada = JSON.stringify(AGENT('a2')).slice(0, 90); // o JSON da 2ª chamada, cortado
  const r = relatorio('1', await corrida({ eventos: EV1, transcript: [...T1_OK, truncada] }));
  assert.equal(r.j?.veredito, 'REPROVADO', r.stdout + r.stderr);
  assert.ok(r.j.falhas.some((f) => /ilegív/.test(f) && f.includes(`${SID}.jsonl`) && /1 linha/.test(f)), JSON.stringify(r.j.falhas));
  assert.notEqual(r.rc, 0);
});

test('M1: 3 linhas ilegíveis são contadas (não só a presença)', async () => {
  const r = relatorio('1', await corrida({ eventos: EV1, transcript: [...T1_OK, '{', 'não-json', '{"type":'] }));
  assert.equal(r.j?.veredito, 'REPROVADO');
  assert.ok(r.j.falhas.some((f) => /3 linhas/.test(f)), JSON.stringify(r.j.falhas));
});

test('M1: transcript ausente (sessão do diário sem arquivo) ⇒ NAO_PROVADO com causa, nunca VERDE com agentes_sombra 0', async () => {
  const r = relatorio('1', await corrida({ eventos: EV1, semTranscript: true }));
  assert.equal(r.j?.veredito, 'NAO_PROVADO', r.stdout + r.stderr);
  assert.ok(r.j.nao_provado.some((f) => /ausente/.test(f) && f.includes(`${SID}.jsonl`)), JSON.stringify(r.j.nao_provado));
  assert.ok(!r.j.falhas.some((f) => /ilegív/.test(f)), 'ausente não é corrompido');
  assert.notEqual(r.rc, 0);
});

test('M1: ausente e corrompido são casos distintos no mesmo aceite (corrompido vence: REPROVADO)', async () => {
  const c = await corrida({ eventos: [...EV1], semTranscript: true });
  const outra = '22222222-0000-4000-8000-000000000002';
  const d = await import(pathToFileURL(join(PLUGIN, 'gates', 'dist', 'diario.js')).href);
  assert.equal(d.append(join(c.repo, '.harness', 'entregas', 'GM-99'), outra, { ts: '2026-11-09T19:30:00.000Z', autor: 'a@b.c', sessao: outra, agente: 'orquestrador', tipo: 'sombra.consulta', dados: { pergunta_hash: H, req: 'REQ-A-1' } }).ok, true);
  mkdirSync(dirname(c.tr), { recursive: true });
  writeFileSync(join(dirname(c.tr), `${outra}.jsonl`), '{truncado\n');
  const r = relatorio('1', c);
  assert.equal(r.j?.veredito, 'REPROVADO');
  assert.ok(r.j.nao_provado.some((f) => /ausente/.test(f)) && r.j.falhas.some((f) => /ilegív/.test(f)));
});

test('m2 (aceite 3): classificador negou o deploy, nada rodou ⇒ NAO_PROVADO com a causa, não REPROVADO', async () => {
  const r = relatorio('3', await corrida({ status: 'TRAVADO', debug: ['x', CLASSIFICADOR, 'y'], marcas: [] }));
  assert.equal(r.j?.veredito, 'NAO_PROVADO', r.stdout + r.stderr);
  assert.ok(r.j.nao_provado.some((f) => /classificador/i.test(f) && /Production Deploy/.test(f)), JSON.stringify(r.j.nao_provado));
  assert.deepEqual(r.j.falhas, []);
});

test('m2: o classificador não mascara falha real: deploy rodou sem rollback ⇒ REPROVADO', async () => {
  const r = relatorio('3', await corrida({ status: 'CONCLUIDO', debug: [CLASSIFICADOR], marcas: ['deploy'] }));
  assert.equal(r.j?.veredito, 'REPROVADO', r.stdout + r.stderr);
});

test('m2: o classificador não mascara evento de entrega nem âncora já gravados (algo rodou ⇒ REPROVADO)', async () => {
  const parar = relatorio('3', await corrida({ status: 'CONCLUIDO', debug: [CLASSIFICADOR], eventos: [{ tipo: 'loop.parar', dados: { motivo: 'smoke', task: 'T1' } }] }));
  assert.equal(parar.j?.veredito, 'REPROVADO', parar.stdout + parar.stderr);
  const c = await corrida({ status: 'CONCLUIDO', debug: [CLASSIFICADOR] });
  writeFileSync(join(c.repo, '.harness', 'entregas', 'GM-99', 'entrega.ancora'), '{}\n');
  const anc = relatorio('3', c);
  assert.equal(anc.j?.veredito, 'REPROVADO', anc.stdout + anc.stderr);
});

test('m2: sem negação do classificador, aceite 3 sem nada rodado continua REPROVADO', async () => {
  const r = relatorio('3', await corrida({ status: 'CONCLUIDO', debug: ['nada'], marcas: [] }));
  assert.equal(r.j?.veredito, 'REPROVADO', r.stdout + r.stderr);
});

test('m2: exp.status TRAVADO com a evidência do aceite 4 completa ⇒ NAO_PROVADO (a sessão não terminou)', async () => {
  const medicao = { tipo: 'custo.medicao', agente: 'subagent:a9e49f33', dados: { papel: 'sombra', modelo: 'claude-opus-5-5', mensagens: 3 } };
  const ok = relatorio('4', await corrida({ eventos: [medicao], status: 'CONCLUIDO' }));
  assert.equal(ok.j?.veredito, 'VERDE', ok.stdout + ok.stderr);
  const r = relatorio('4', await corrida({ eventos: [medicao], status: 'TRAVADO' }));
  assert.equal(r.j?.veredito, 'NAO_PROVADO', r.stdout + r.stderr);
  assert.ok(r.j.nao_provado.some((f) => /TRAVADO/.test(f)));
});

test('m1: mod_ativo_nesta_sessao lê o módulo carregado no debug.log (sem mod.jsonl)', async () => {
  const medicao = { tipo: 'custo.medicao', agente: 'subagent:a9e49f33', dados: { papel: 'sombra', modelo: 'claude-opus-5-5' } };
  const com = relatorio('4', await corrida({ eventos: [medicao], debug: ['2026-11-09T19:59:35.706Z [DEBUG] hooks module gabarito-mestre@inline loaded (worker, environment 1, tier user); events: turn.complete'] }));
  assert.equal(com.j?.mod_ativo_nesta_sessao, true);
  const sem = relatorio('4', await corrida({ eventos: [medicao], debug: ['nada'] }));
  assert.equal(sem.j?.mod_ativo_nesta_sessao, false);
});

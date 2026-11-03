/** Testes do núcleo do pouso (REQ-POU-1, GM-10 T9): decidirPouso, X, vivos, fronteira, revisor, medição e a ponte para o diário. Mutações: task-9-mut.json. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codigoPonte, dadosMedicao, decidirPouso, ehRevisor, fronteira, INSTANTANEO_MAX, lerX, textoRetomada, vivosDe,
} from '../src/pouso.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const GATES = join(aqui, '..');
const PLUGIN = join(GATES, '..');

const base = { percent: 60, x: 50, vivos: 0, fronteira: true, jaPousando: false, orquestrador: true };
const dec = (o: Partial<typeof base & { percent: number | null }> = {}) => decidirPouso({ ...base, ...o });

// ---- decidirPouso: uma linha por linha da tabela, na ordem em que casam ----
test('subagent-nada: orquestrador falso nunca decide, nem com tudo a favor', () => {
  assert.equal(dec({ orquestrador: false }), 'nada');
  assert.equal(dec({ orquestrador: false, percent: null, jaPousando: true }), 'nada');
});
test('percent-nulo-nada: percent nulo nunca pousa nem bloqueia', () => {
  assert.equal(dec({ percent: null }), 'nada');
  assert.equal(dec({ percent: null, vivos: 3, fronteira: false }), 'nada');
});
test('percent-invalido-nada: NaN e infinito contam como dado ausente', () => {
  assert.equal(dec({ percent: Number.NaN }), 'nada');
  assert.equal(dec({ percent: Number.POSITIVE_INFINITY }), 'nada');
  assert.equal(dec({ percent: undefined as unknown as number }), 'nada');
});
test('pouso-nao-repete: jaPousando decide nada, mesmo acima de X com fronteira', () => {
  assert.equal(dec({ jaPousando: true }), 'nada');
  assert.equal(dec({ jaPousando: true, vivos: 2, fronteira: false }), 'nada');
});
test('abaixo-x-nada: percent menor que X não decide, mesmo com vivos', () => {
  assert.equal(dec({ percent: 49.9 }), 'nada');
  assert.equal(dec({ percent: 0, vivos: 5, fronteira: false }), 'nada');
});
test('x-exato-pousa: percent igual a X já conta como X', () => {
  assert.equal(dec({ percent: 50 }), 'pousar');
  assert.equal(dec({ percent: 1, x: 1 }), 'pousar');
});
test('x-com-vivos-bloqueia: vivos > 0 bloqueia despacho, com ou sem fronteira', () => {
  assert.equal(dec({ vivos: 1 }), 'bloquear_despacho');
  assert.equal(dec({ vivos: 1, fronteira: false }), 'bloquear_despacho');
});
test('x-sem-fronteira-bloqueia: sem fronteira bloqueia mesmo sem vivos', () => {
  assert.equal(dec({ fronteira: false }), 'bloquear_despacho');
});
test('x-fronteira-pousa: X, sem vivos e com fronteira pousa', () => {
  assert.equal(dec(), 'pousar');
  assert.equal(dec({ percent: 100 }), 'pousar');
});
test('vivos-nao-numerico-bloqueia: vivos negativo, NaN ou fracionário nunca vira pouso', () => {
  assert.equal(dec({ vivos: Number.NaN }), 'bloquear_despacho');
  assert.equal(dec({ vivos: -1 }), 'bloquear_despacho');
});
test('fronteira-so-true-pousa: fronteira truthy mas não booleana não pousa', () => {
  assert.equal(dec({ fronteira: 1 as unknown as boolean }), 'bloquear_despacho');
});

// ---- X ----
test('x-env-valido: número em (0, 100] vale', () => {
  for (const [bruto, esperado] of [['1', 1], ['50', 50], ['75', 75], ['100', 100], ['0.5', 0.5], [' 30 ', 30]] as const) {
    assert.deepEqual(lerX(bruto), { x: esperado, aviso: null }, bruto);
  }
});
test('x-env-ausente: default 50 sem aviso', () => {
  assert.deepEqual(lerX(undefined), { x: 50, aviso: null });
});
test('x-env-invalido: 50 com aviso, sem exceção', () => {
  for (const bruto of ['0', '-5', '100.1', '101', 'abc', '', ' ', 'NaN', 'Infinity', '1e1', '0x10', '50%', '5,5']) {
    const r = lerX(bruto);
    assert.equal(r.x, 50, bruto);
    assert.match(String(r.aviso), /GABARITO_POUSO_X/, bruto);
  }
});

// ---- vivos ----
test('vivos-so-pending-running-waiting: idle, completed, failed e killed não contam', () => {
  const l = (...s: string[]) => s.map((status, i) => ({ id: `a${i}`, status }));
  assert.equal(vivosDe(l()), 0);
  assert.equal(vivosDe(l('idle', 'completed', 'failed', 'killed')), 0);
  assert.equal(vivosDe(l('pending')), 1);
  assert.equal(vivosDe(l('running', 'waiting', 'completed')), 2);
  assert.equal(vivosDe(l('pending', 'running', 'waiting')), 3);
});
test('vivos-dado-ruim-conta-vivo: lista ausente, corrompida ou status desconhecido nunca vira zero', () => {
  assert.ok(vivosDe(null) > 0);
  assert.ok(vivosDe(undefined) > 0);
  assert.ok(vivosDe({}) > 0);
  assert.ok(vivosDe('running') > 0);
  assert.ok(vivosDe([{ id: 'a' }]) > 0);
  assert.ok(vivosDe([{ id: 'a', status: 'dormindo' }]) > 0);
  assert.ok(vivosDe([null]) > 0);
  assert.ok(vivosDe([{ id: 'a', status: 'completed' }, 7]) > 0);
});

// ---- fronteira ----
let relogio = 0;
const ev = (tipo: TipoEvento, dados: Record<string, unknown>, sessao = 's1', seq?: number): Evento => {
  relogio += 1;
  return { seq: seq ?? relogio, ts: new Date(Date.UTC(2026, 10, 3, 0, 0, relogio)).toISOString(), autor: 'a', sessao, agente: 'o', tipo, dados, hash_anterior: null };
};
const diario = (...itens: [TipoEvento, Record<string, unknown>][]): Evento[] => {
  relogio = 0;
  return itens.map(([t, d]) => ev(t, d));
};
const ini = (task: string): [TipoEvento, Record<string, unknown>] => ['task.iniciada', { task, papel: 'implementador' }];
const con = (task: string): [TipoEvento, Record<string, unknown>] => ['task.concluida', { task, sha: 'abc' }];
const ver = (task: string, veredito = 'APROVADO', rodada = 1): [TipoEvento, Record<string, unknown>] =>
  ['review.veredito', { task, veredito, rodada, major: veredito === 'APROVADO' ? 0 : 1, blocker: 0 }];

test('fronteira-ultimo-e-veredito: a última transição de task ser review.veredito basta', () => {
  assert.equal(fronteira(diario(ini('a'), con('a'), ver('a'))), true);
});
test('fronteira-veredito-reprovado: veredito de rodada 1 reprovado também é fronteira', () => {
  assert.equal(fronteira(diario(ini('a'), con('a'), ver('a', 'REPROVADO'))), true);
});
test('fronteira-falsa-sem-veredito: última transição é outra', () => {
  assert.equal(fronteira(diario(ini('a'), con('a'))), false);
  assert.equal(fronteira(diario(ini('a'))), false);
});
test('fronteira-falsa-task-nova-depois: nova task iniciada depois do veredito tira a fronteira', () => {
  assert.equal(fronteira(diario(ini('a'), con('a'), ver('a'), ini('b'))), false);
});
test('fronteira-falsa-integrada-depois: task.integrada depois do veredito não é fronteira', () => {
  assert.equal(fronteira(diario(ini('a'), con('a'), ver('a'), ['task.integrada', { task: 'a', sha: 'd' }])), false);
});
test('fronteira-ignora-evento-que-nao-e-de-task: ci e custo depois do veredito não mudam a resposta', () => {
  assert.equal(fronteira(diario(ini('a'), con('a'), ver('a'), ['ci.resultado', { verde: true }], ['custo.medicao', { agente: 'x', input_tokens: 1 }])), true);
});
test('fronteira-vazia-ou-ruim-falsa: sem evento, não-lista ou lixo é falso', () => {
  assert.equal(fronteira([]), false);
  assert.equal(fronteira(null), false);
  assert.equal(fronteira(undefined), false);
  assert.equal(fronteira('x'), false);
  assert.equal(fronteira({}), false);
  assert.equal(fronteira([null, 3]), false);
});
test('fronteira-diario-fora-de-ordem-falsa: seq decrescente na sessão não é adivinhado', () => {
  relogio = 0;
  const evs = [ev('task.iniciada', { task: 'a', papel: 'implementador' }, 's1', 2), ev('review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, 's1', 1)];
  assert.equal(fronteira(evs), false);
});
test('fronteira-sequencia-invalida-falsa: veredito sem task concluída é inválido para a T2', () => {
  assert.equal(fronteira(diario(ini('a'), ver('a'))), false);
});
test('fronteira-sem-task-falsa: veredito cujo dados.task não é string não casa', () => {
  assert.equal(fronteira(diario(['review.veredito', { veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }])), false);
});
test('fronteira-entre-sessoes: ordena por (ts, sessao) e usa o último evento de task', () => {
  relogio = 0;
  const a = ev('task.iniciada', { task: 'a', papel: 'implementador' }, 's1', 1);
  const b = ev('task.concluida', { task: 'a', sha: 'x' }, 's1', 2);
  const c = ev('review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, 's2', 1);
  assert.equal(fronteira([c, a, b]), true);
});

// ---- revisor ----
test('revisor-nome-real: o nome da constante é o do frontmatter em agents/', () => {
  const md = readFileSync(join(PLUGIN, 'agents', 'gabarito-revisor.md'), 'utf8');
  const nome = /^name:\s*(\S+)\s*$/m.exec(md)?.[1];
  assert.equal(nome, 'gabarito-revisor');
  assert.equal(ehRevisor(nome), true);
  assert.equal(ehRevisor(`gabarito-mestre:${nome}`), true);
});
test('revisor-igualdade-exata: parecido, caixa, espaço e outros agentes não passam', () => {
  for (const s of ['gabarito-revisor-2', 'Gabarito-Revisor', ' gabarito-revisor', 'gabarito-revisor ', 'gabarito-implementador', 'revisor', 'outro:gabarito-revisor', '', undefined, null, 7, {}]) {
    assert.equal(ehRevisor(s as unknown as string), false, String(s));
  }
});

// ---- medição ----
test('medicao-so-numeros: copia as quatro contagens e descarta o resto', () => {
  const d = dadosMedicao({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2, model: 'm', texto: 'rm -rf SENTINELA' });
  assert.deepEqual(d, { input_tokens: 10, output_tokens: 5, cache_read: 3, cache_creation: 2 });
  assert.ok(!JSON.stringify(d).includes('SENTINELA'));
});
test('medicao-dado-ruim-nulo: ausente, negativo, NaN ou texto não vira zero nem número inventado', () => {
  assert.equal(dadosMedicao(undefined), null);
  assert.equal(dadosMedicao(null), null);
  assert.equal(dadosMedicao({}), null);
  assert.equal(dadosMedicao({ input_tokens: -1, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), null);
  assert.equal(dadosMedicao({ input_tokens: Number.NaN, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), null);
  assert.equal(dadosMedicao({ input_tokens: '10', output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), null);
});

// ---- texto da retomada ----
test('retomada-traz-instantaneo-inteiro: nunca trunca calado', () => {
  const inst = 'Diário: 3 evento(s)\nETA: sem dados\nx';
  const t = textoRetomada(inst);
  assert.ok(typeof t === 'string' && t.includes(inst));
});
test('retomada-acima-do-teto-recusa: 3.201 caracteres não viram prompt nem são cortados', () => {
  assert.equal(INSTANTANEO_MAX, 3200);
  assert.ok(textoRetomada('x'.repeat(3200)) !== null);
  assert.equal(textoRetomada('x'.repeat(3201)), null);
});
test('retomada-vazia-recusa: instantâneo vazio ou não-texto não vira prompt', () => {
  assert.equal(textoRetomada(''), null);
  assert.equal(textoRetomada('   \n'), null);
  assert.equal(textoRetomada(undefined as unknown as string), null);
  assert.equal(textoRetomada(7 as unknown as string), null);
});

// ---- ponte para o diário (node real, dist/diario.js real) ----
function ponte(entrada: Record<string, unknown>, cwd: string) {
  const url = 'file://' + encodeURI(join(GATES, 'dist', 'diario.js'));
  const r = spawnSync('node', ['--input-type=module', '-e', codigoPonte(url)], { input: JSON.stringify(entrada), encoding: 'utf8', cwd });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
function repoTemp(branch = 'feat/PBI-7-x') {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'gm-ponte-')));
  spawnSync('git', ['init', '-q'], { cwd: d });
  spawnSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: d });
  return d;
}
test('ponte-dir: acha a raiz, a pasta da entrega pelo PBI da branch e se há plano.json', () => {
  const d = repoTemp();
  let r = ponte({ op: 'dir', cwd: d }, d);
  assert.deepEqual(r, { ok: true, raiz: d, dir: join(d, '.harness', 'entregas', 'PBI-7'), plano: false });
  mkdirSync(r.dir, { recursive: true });
  writeFileSync(join(r.dir, 'plano.json'), '{}');
  r = ponte({ op: 'dir', cwd: d }, d);
  assert.equal(r.plano, true);
  const sem = repoTemp('main');
  assert.equal(ponte({ op: 'dir', cwd: sem }, sem).dir, join(sem, '.harness', 'entregas', '_sem-id'));
});
test('ponte-append-ler-instantaneo: grava com cadeia, relê e projeta o instantâneo', () => {
  const d = repoTemp();
  const dir = join(d, '.harness', 'entregas', 'PBI-7');
  const g = ponte({ op: 'append', dir, cwd: d, sessao: 's9', ev: { agente: 'orquestrador', tipo: 'sessao.pouso', dados: { percent: 61, x: 50 } } }, d);
  assert.deepEqual(g, { ok: true, gravado: 'evento' });
  const l = ponte({ op: 'ler', dir }, d);
  assert.equal(l.ok, true);
  assert.equal(l.eventos.length, 1);
  assert.equal(l.eventos[0].tipo, 'sessao.pouso');
  assert.equal(l.eventos[0].sessao, 's9');
  assert.deepEqual(l.eventos[0].dados, { percent: 61, x: 50 });
  const i = ponte({ op: 'instantaneo', dir }, d);
  assert.equal(i.ok, true);
  assert.match(i.texto, /sessao\.pouso/);
  assert.ok(i.texto.length <= INSTANTANEO_MAX);
});
test('ponte-unico-por-agente: segunda medição do mesmo agente não duplica', () => {
  const d = repoTemp();
  const dir = join(d, '.harness', 'entregas', 'PBI-7');
  const ev1 = { agente: 'subagent:ag1', tipo: 'custo.medicao', dados: { input_tokens: 1 } };
  assert.deepEqual(ponte({ op: 'append', dir, cwd: d, sessao: 's9', unicoPorAgente: true, ev: ev1 }, d), { ok: true, gravado: 'evento' });
  assert.deepEqual(ponte({ op: 'append', dir, cwd: d, sessao: 's9', unicoPorAgente: true, ev: ev1 }, d), { ok: true, gravado: 'ja_existia' });
  assert.equal(ponte({ op: 'ler', dir }, d).eventos.length, 1);
});
test('ponte-erro-vira-ok-falso: sessão inválida, op desconhecida e entrada ruim nunca viram sucesso', () => {
  const d = repoTemp();
  const dir = join(d, '.harness', 'entregas', 'PBI-7');
  assert.equal(ponte({ op: 'append', dir, cwd: d, sessao: '../x', ev: { agente: 'o', tipo: 'sessao.pouso', dados: {} } }, d).ok, false);
  assert.equal(ponte({ op: 'nada' }, d).ok, false);
  const r = spawnSync('node', ['--input-type=module', '-e', codigoPonte('file://' + encodeURI(join(GATES, 'dist', 'diario.js')))], { input: 'não é json', encoding: 'utf8', cwd: d });
  assert.equal(JSON.parse(r.stdout).ok, false);
});
test('ponte-canario-recusa-nao-e-sucesso: dado com segredo vira diario.recusa e a ponte diz que não gravou o evento', () => {
  const d = repoTemp();
  const dir = join(d, '.harness', 'entregas', 'PBI-7');
  const g = ponte({ op: 'append', dir, cwd: d, sessao: 's9', ev: { agente: 'o', tipo: 'sessao.pouso', dados: { alvo: 'ghp_' + 'a'.repeat(30) } } }, d);
  assert.equal(g.ok, false);
  assert.equal(existsSync(join(dir, 'events.s9.jsonl')), true);
});

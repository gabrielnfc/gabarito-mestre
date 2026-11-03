/** Testes do núcleo do pouso (REQ-POU-1, GM-10 T9): decidirPouso, X, vivos, fronteira, revisor, medição e a ponte para o diário. Mutações: task-9-mut.json. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analisarFronteira, codigoPonte, marcaDeProgresso, dadosMedicao, decidirEstado, ehRevisor, fronteira, INSTANTANEO_MAX, lerX, textoRetomada, vivosDe,
} from '../src/pouso.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const GATES = join(aqui, '..');
const PLUGIN = join(GATES, '..');

const base = { orquestrador: true, percent: 60 as number | null, x: 50, pousando: false, desistiu: false, interativo: true, consumida: false, vivos: 0, novaFronteira: true };
const dec = (o: Partial<typeof base> = {}) => decidirEstado({ ...base, ...o });
const linha = (estado: string, despacho: string, acao: string) => ({ estado, despacho, acao });

// ---- decidirEstado: tabela de 7 estados (Sombra T9), uma linha por teste, primeira que casa ----
test('tabela-ociosa-subagent: orquestrador falso nunca decide, nem com tudo a favor', () => {
  assert.deepEqual(dec({ orquestrador: false }), linha('OCIOSO', 'permitir', 'nada'));
  assert.deepEqual(dec({ orquestrador: false, percent: null, pousando: true }), linha('OCIOSO', 'permitir', 'nada'));
});
test('tabela-ociosa-percent-nulo: percent nulo, NaN, infinito ou ausente permite e nada faz, antes de qualquer outra linha', () => {
  for (const percent of [null, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
    assert.deepEqual(dec({ percent, pousando: true, desistiu: true, vivos: 3 }), linha('OCIOSO', 'permitir', 'nada'));
  }
});
test('tabela-ociosa-abaixo-x: percent menor que X permite, mesmo com vivos ou sem fronteira', () => {
  assert.deepEqual(dec({ percent: 49.9 }), linha('OCIOSO', 'permitir', 'nada'));
  assert.deepEqual(dec({ percent: 0, vivos: 5, novaFronteira: false, pousando: true }), linha('OCIOSO', 'permitir', 'nada'));
});
test('tabela-pousando: store com estado nega e nada faz (jaPousando)', () => {
  assert.deepEqual(dec({ pousando: true }), linha('POUSANDO', 'negar', 'nada'));
  assert.deepEqual(dec({ pousando: true, desistiu: true, interativo: false, consumida: true }), linha('POUSANDO', 'negar', 'nada'));
});
test('tabela-sem-pouso-desistiu: pouso que falhou nega sem parar de novo', () => {
  assert.deepEqual(dec({ desistiu: true }), linha('SEM_POUSO', 'negar', 'nada'));
});
test('tabela-sem-pouso-nao-interativo: -p nega e manda parar', () => {
  assert.deepEqual(dec({ interativo: false }), linha('SEM_POUSO', 'negar', 'parar_nao_interativo'));
  assert.deepEqual(dec({ interativo: false, consumida: true, vivos: 2 }), linha('SEM_POUSO', 'negar', 'parar_nao_interativo'));
});
test('tabela-pousado: fronteira consumida libera o despacho e não pousa (E1)', () => {
  assert.deepEqual(dec({ consumida: true, novaFronteira: false }), linha('POUSADO', 'permitir', 'nada'));
  assert.deepEqual(dec({ consumida: true, vivos: 4 }), linha('POUSADO', 'permitir', 'nada'));
});
test('tabela-travado: vivos > 0 nega e espera', () => {
  assert.deepEqual(dec({ vivos: 1 }), linha('TRAVADO', 'negar', 'esperar'));
  assert.deepEqual(dec({ vivos: 1, novaFronteira: false }), linha('TRAVADO', 'negar', 'esperar'));
});
test('tabela-travado-vivos-ruim: vivos negativo, NaN ou fracionário nunca vira pouso', () => {
  for (const vivos of [Number.NaN, -1, 0.5, undefined as unknown as number]) assert.deepEqual(dec({ vivos }), linha('TRAVADO', 'negar', 'esperar'));
});
test('tabela-encalhado: sem vivos e sem fronteira nova nega e conta o encalhe (E3)', () => {
  assert.deepEqual(dec({ novaFronteira: false }), linha('ENCALHADO', 'negar', 'encalhe'));
  assert.deepEqual(dec({ novaFronteira: 1 as unknown as boolean }), linha('ENCALHADO', 'negar', 'encalhe'));
});
test('tabela-pousavel: X, sem vivos, fronteira nova, interativo e livre pousa', () => {
  assert.deepEqual(dec(), linha('POUSAVEL', 'negar', 'pousar'));
  assert.deepEqual(dec({ percent: 50 }), linha('POUSAVEL', 'negar', 'pousar'));
  assert.deepEqual(dec({ percent: 1, x: 1 }), linha('POUSAVEL', 'negar', 'pousar'));
  assert.deepEqual(dec({ percent: 100 }), linha('POUSAVEL', 'negar', 'pousar'));
});
test('tabela-so-pousavel-pousa: nenhuma outra combinação produz a ação pousar', () => {
  const vals: Partial<typeof base>[] = [{ orquestrador: false }, { percent: null }, { percent: 10 }, { pousando: true }, { desistiu: true }, { interativo: false }, { consumida: true }, { vivos: 1 }, { novaFronteira: false }];
  for (const v of vals) assert.notEqual(dec(v).acao, 'pousar');
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

const pou = (): [TipoEvento, Record<string, unknown>] => ['sessao.pouso', { percent: 60, x: 50 }];
const ret = (): [TipoEvento, Record<string, unknown>] => ['sessao.retomada', { chars: 100 }];
const an = (...itens: [TipoEvento, Record<string, unknown>][]) => analisarFronteira(diario(...itens));

// ---- fronteira nova: um pouso por veredito (E1) ----
test('fronteira-nova-sem-pouso: veredito sem sessao.pouso antes é fronteira nova e não consumida', () => {
  assert.deepEqual(an(ini('a'), con('a'), ver('a')), { nova: true, consumida: false, motivo: null });
});
test('x-baixo-um-pouso-por-veredito: pouso consome a fronteira, retomada não a devolve, veredito novo abre outra', () => {
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou()), { nova: false, consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret()), { nova: false, consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret(), ini('b')), { nova: false, consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret(), ini('b'), con('b'), ver('b')), { nova: true, consumida: false, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret(), ini('b'), con('b'), ver('b'), pou()), { nova: false, consumida: true, motivo: null });
});
test('sem-veredito-novo-nao-pousa: depois do pouso, task em curso ou concluída sem veredito não é fronteira nova', () => {
  assert.equal(an(ini('a'), con('a'), ver('a'), pou(), ini('b')).nova, false);
  assert.equal(an(ini('a'), con('a'), ver('a'), pou(), ini('b'), con('b')).nova, false);
  assert.equal(fronteira(diario(ini('a'), con('a'), ver('a'), pou())), false);
});
test('fronteira-consumida-sem-veredito: pouso sem nenhum veredito também consome', () => {
  assert.equal(an(ini('a'), pou()).consumida, true);
  assert.equal(an(ini('a')).consumida, false);
});
test('fronteira-pouso-entre-sessoes: a ordem é a de ordenar, não a de chegada', () => {
  relogio = 0;
  const a = ev('task.iniciada', { task: 'a', papel: 'implementador' }, 's1', 1);
  const b = ev('task.concluida', { task: 'a', sha: 'x' }, 's1', 2);
  const c = ev('review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, 's1', 3);
  const p = ev('sessao.pouso', { percent: 60, x: 50 }, 's2', 1);
  assert.deepEqual(analisarFronteira([p, a, b, c]), { nova: false, consumida: true, motivo: null });
});
test('evento-sem-task-nao-pousa: evento de task sem dados.task invalida a fronteira com motivo (C3)', () => {
  const r = an(ini('a'), con('a'), ver('a'), ['task.iniciada', { papel: 'implementador' }]);
  assert.equal(r.nova, false);
  assert.equal(r.consumida, false);
  assert.match(String(r.motivo), /task/);
  const r2 = an(ini('a'), con('a'), ver('a'), ['task.iniciada', { task: 7 }]);
  assert.equal(r2.nova, false);
  assert.notEqual(r2.motivo, null);
});
test('analise-ruim-tem-motivo: não-lista e fora de ordem dizem por quê', () => {
  assert.notEqual(analisarFronteira(null).motivo, null);
  assert.notEqual(analisarFronteira([null]).motivo, null);
  assert.equal(analisarFronteira([]).motivo, null);
});

test('marca-de-progresso: custo.medicao e loop.parar não contam; qualquer outro evento conta; ilegível é -1', () => {
  const base = diario(ini('a'), con('a'));
  assert.equal(marcaDeProgresso(base), 2);
  const com = diario(ini('a'), con('a'), ['custo.medicao', { agente: 'orquestrador', input_tokens: 1 }], ['loop.parar', { motivo: 'sem_pouso' }]);
  assert.equal(marcaDeProgresso(com), 2);
  assert.equal(marcaDeProgresso(diario(ini('a'), con('a'), ver('a'))), 3);
  assert.equal(marcaDeProgresso(null), -1);
  assert.equal(marcaDeProgresso('x'), -1);
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

// ---- leitura estrita pela ponte real: dado ruim nunca vira fronteira (MAJOR 2) ----
function diarioDe(itens: [TipoEvento, Record<string, unknown>][], sessao = 's9') {
  const d = repoTemp();
  const dir = join(d, '.harness', 'entregas', 'PBI-7');
  for (const [tipo, dados] of itens) {
    assert.equal(ponte({ op: 'append', dir, cwd: d, sessao, ev: { agente: 'o', tipo, dados } }, d).ok, true);
  }
  return { d, dir, arq: join(dir, `events.${sessao}.jsonl`) };
}
const completo = (): [TipoEvento, Record<string, unknown>][] => [ini('a'), con('a'), ver('a')];
const lerPonte = (d: string, dir: string) => {
  const l = ponte({ op: 'ler', dir }, d);
  return { l, nova: l.ok === true && analisarFronteira(l.eventos).nova };
};
test('diario-integro-pela-ponte: o controle dá fronteira nova', () => {
  const { d, dir } = diarioDe(completo());
  const r = lerPonte(d, dir);
  assert.equal(r.l.ok, true);
  assert.equal(r.nova, true);
});
test('diario-truncado-nao-pousa: linha truncada no disco depois do veredito (C1)', () => {
  const { d, dir, arq } = diarioDe(completo());
  writeFileSync(arq, readFileSync(arq, 'utf8') + '{"seq":4,"ts":"2026-11-03T00:00:09.000Z","sessao":"s9","tipo":"task.inic');
  const r = lerPonte(d, dir);
  assert.equal(r.l.ok, false);
  assert.match(r.l.erro, /ilegível|linha/);
  assert.equal(r.nova, false);
});
test('lacuna-seq-nao-pousa: seq pula de 2 para 5 com a cadeia de hash intacta (C2)', () => {
  const { d, dir, arq } = diarioDe(completo());
  const ls = readFileSync(arq, 'utf8').split('\n');
  const o = JSON.parse(ls[2]);
  o.seq = 5; // só o seq muda: hash_anterior da linha segue valendo
  ls[2] = JSON.stringify(o);
  writeFileSync(arq, ls.join('\n'));
  const r = lerPonte(d, dir);
  assert.equal(r.l.ok, false);
  assert.equal(r.nova, false);
});
test('hash-anterior-quebrado-nao-pousa: cadeia que não confere', () => {
  const { d, dir, arq } = diarioDe(completo());
  const ls = readFileSync(arq, 'utf8').split('\n');
  const o = JSON.parse(ls[2]);
  o.hash_anterior = '0'.repeat(64);
  ls[2] = JSON.stringify(o);
  writeFileSync(arq, ls.join('\n'));
  const r = lerPonte(d, dir);
  assert.equal(r.l.ok, false);
  assert.equal(r.nova, false);
});
test('arquivo-ilegivel-nao-pousa: chmod 000 no arquivo da sessão, com ler real (C4)', { skip: process.getuid?.() === 0 }, () => {
  const { d, dir } = diarioDe(completo());
  const outro = join(dir, 'events.s8.jsonl');
  writeFileSync(outro, '');
  chmodSync(outro, 0o000);
  try {
    const r = lerPonte(d, dir);
    assert.equal(r.l.ok, false);
    assert.equal(r.nova, false);
  } finally {
    chmodSync(outro, 0o644);
  }
});
test('pasta-inexistente-nao-pousa: nada para ler não é fronteira', () => {
  const d = repoTemp();
  const r = lerPonte(d, join(d, 'nao-existe'));
  assert.equal(r.l.ok, false);
  assert.equal(r.nova, false);
});
test('ponte-ler-usa-estrito: linha de lixo no meio não é descartada em silêncio', () => {
  const { d, dir, arq } = diarioDe(completo());
  writeFileSync(arq, 'lixo\n' + readFileSync(arq, 'utf8'));
  assert.equal(ponte({ op: 'ler', dir }, d).ok, false);
});

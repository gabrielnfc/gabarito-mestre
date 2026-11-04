/** Testes do núcleo do pouso (REQ-POU-1, GM-10 T9): pré-condições do mod, X, vivos, fronteira consumida, revisor, medição e a ponte. Mutações: task-9-mut.json, task-9-r3-mut.json. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analisarFronteira, codigoPonte, marcaDeProgresso, dadosMedicao, ehRevisor, INSTANTANEO_MAX, jaParou, lerX, negaDespacho, portaDoPouso, tasksDoNegado, tasksEmVoo, textoRetomada, tokensDe, vivosDe,
} from '../src/pouso.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const GATES = join(aqui, '..');
const PLUGIN = join(GATES, '..');

const base = { orquestrador: true, percent: 60 as number | null, x: 50, pousando: false, desistiu: false, interativo: true };
const dec = (o: Partial<typeof base> = {}) => portaDoPouso({ ...base, ...o });
const linha = (estado: string, despacho: string, acao: string) => ({ estado, despacho, acao });

// ---- portaDoPouso: pré-condições A a E da Sombra T9b, uma linha por teste, primeira que casa ----
test('porta-A-B-ociosa-subagent: orquestrador falso nunca decide, nem com tudo a favor', () => {
  assert.deepEqual(dec({ orquestrador: false }), linha('OCIOSO', 'permitir', 'nada'));
  assert.deepEqual(dec({ orquestrador: false, percent: null, pousando: true }), linha('OCIOSO', 'permitir', 'nada'));
});
test('porta-B-ociosa-percent-nulo: percent nulo, NaN, infinito ou ausente permite e nada faz, antes de qualquer outra linha', () => {
  for (const percent of [null, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
    assert.deepEqual(dec({ percent, pousando: true, desistiu: true }), linha('OCIOSO', 'permitir', 'nada'));
  }
});
test('porta-B-ociosa-abaixo-x: percent menor que X permite', () => {
  assert.deepEqual(dec({ percent: 49.9 }), linha('OCIOSO', 'permitir', 'nada'));
  assert.deepEqual(dec({ percent: 0, pousando: true }), linha('OCIOSO', 'permitir', 'nada'));
});
test('porta-C-pousando: store com estado nega e nada faz', () => {
  assert.deepEqual(dec({ pousando: true }), linha('POUSANDO', 'negar', 'nada'));
  assert.deepEqual(dec({ pousando: true, desistiu: true, interativo: false }), linha('POUSANDO', 'negar', 'nada'));
});
test('porta-D-sem-pouso-desistiu: pouso que falhou nega sem parar de novo', () => {
  assert.deepEqual(dec({ desistiu: true }), linha('SEM_POUSO', 'negar', 'nada'));
  assert.deepEqual(dec({ desistiu: true, interativo: false }), linha('SEM_POUSO', 'negar', 'nada'));
});
test('porta-E-sem-pouso-nao-interativo: -p nega e manda parar', () => {
  assert.deepEqual(dec({ interativo: false }), linha('SEM_POUSO', 'negar', 'parar_nao_interativo'));
});
test('porta-X-igual-passa-a-palavra-ao-nucleo: percent igual a X e tudo livre', () => {
  assert.deepEqual(dec({ percent: 50 }), linha('NUCLEO', 'nucleo', 'nucleo'));
  assert.deepEqual(dec({ percent: 1, x: 1 }), linha('NUCLEO', 'nucleo', 'nucleo'));
  assert.deepEqual(dec({ percent: 100 }), linha('NUCLEO', 'nucleo', 'nucleo'));
});
test('porta-nao-decide-nada-do-loop: nenhuma combinação tem outra ação além de nada, parar_nao_interativo e nucleo', () => {
  const vals: Partial<typeof base>[] = [{ orquestrador: false }, { percent: null }, { percent: 10 }, { pousando: true }, { desistiu: true }, { interativo: false }, {}];
  for (const v of vals) assert.ok(['nada', 'parar_nao_interativo', 'nucleo'].includes(dec(v).acao));
});

// ---- Agent: nega ⇔ a (5) dispararia (E8) ----
test('nega-despacho-so-se-5-dispara: integrar e concluir passam; todo o resto nega; consumida passa sempre', () => {
  const acoes = [
    { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] }, { tipo: 'esperar', motivo: 'x' }, { tipo: 'pousar' },
    { tipo: 'parar', motivo: 'sem_pouso' }, { tipo: 'parar', motivo: 'teto_rodadas', task: 'a' }, { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' },
  ] as const;
  for (const a of acoes) {
    assert.equal(negaDespacho(a, false), true, a.tipo);
    assert.equal(negaDespacho(a, true), false, `${a.tipo} consumida`);
  }
  assert.equal(negaDespacho({ tipo: 'integrar', tasks: ['a'] }, false), false);
  assert.equal(negaDespacho({ tipo: 'concluir' }, false), false);
});
test('nega-despacho-diario-invalido-nunca-passa: sem veredito a fronteira é consumida, mas diário fora da tabela nega mesmo assim', () => {
  assert.equal(negaDespacho({ tipo: 'parar', motivo: 'diario_invalido' }, true), true);
  assert.equal(negaDespacho({ tipo: 'parar', motivo: 'diario_invalido' }, false), true);
});

// ---- já parou / tokens (sinais do núcleo) ----
test('ja-parou: termina em loop.parar sem trabalho depois (medição não conta); trabalho depois reabre', () => {
  assert.equal(jaParou(diario(ini('a'), ['loop.parar', { motivo: 'teto_rodadas', task: 'a' }])), true);
  assert.equal(jaParou(diario(ini('a'), ['loop.parar', { motivo: 'teto_rodadas' }], ['custo.medicao', { agente: 'orquestrador', input_tokens: 1 }])), true);
  assert.equal(jaParou(diario(ini('a'), ['loop.parar', { motivo: 'teto_rodadas' }], con('a'))), false);
  assert.equal(jaParou(diario(ini('a'))), false);
  assert.equal(jaParou(null), false);
  assert.equal(jaParou('x'), false);
  assert.equal(jaParou([null]), false);
});
test('tokens-de: soma entrada, saída e criação; leitura de cache não conta; sem medição é null; dado ruim é ok falso', () => {
  const med = (d: Record<string, unknown>): [TipoEvento, Record<string, unknown>] => ['custo.medicao', { agente: 'orquestrador', ...d }];
  assert.deepEqual(tokensDe(diario(ini('a'))), { ok: true, tokens: null });
  assert.deepEqual(tokensDe(diario(med({ input_tokens: 10, output_tokens: 5, cache_creation: 3, cache_read: 1000 }), med({ input_tokens: 1, output_tokens: 1, cache_creation: 1, cache_read: 9 }))), { ok: true, tokens: 21 });
  assert.deepEqual(tokensDe(diario(med({ input_tokens: -1 }))), { ok: false });
  assert.deepEqual(tokensDe(diario(med({ output_tokens: 'x' }))), { ok: false });
  assert.deepEqual(tokensDe(null), { ok: false });
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

const pou = (): [TipoEvento, Record<string, unknown>] => ['sessao.pouso', { percent: 60, x: 50 }];
const ret = (): [TipoEvento, Record<string, unknown>] => ['sessao.retomada', { chars: 100 }];
const an = (...itens: [TipoEvento, Record<string, unknown>][]) => analisarFronteira(diario(...itens));

// ---- fronteira consumida: um pouso por veredito (E1/E7) ----
test('fronteira-nao-consumida-sem-pouso: veredito sem sessao.pouso depois não é consumida', () => {
  assert.deepEqual(an(ini('a'), con('a'), ver('a')), { consumida: false, motivo: null });
});
test('x-baixo-um-pouso-por-veredito: pouso consome a fronteira, retomada não a devolve, veredito novo abre outra', () => {
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou()), { consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret()), { consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret(), ini('b')), { consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret(), ini('b'), con('b'), ver('b')), { consumida: false, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a'), pou(), ret(), ini('b'), con('b'), ver('b'), pou()), { consumida: true, motivo: null });
});
test('task-integrada-nao-desfaz-nem-consome: integrada depois do veredito deixa a fronteira como estava', () => {
  const int = (): [TipoEvento, Record<string, unknown>] => ['task.integrada', { task: 'a', sha: 'd' }];
  assert.equal(an(ini('a'), con('a'), ver('a'), int()).consumida, false);
  assert.equal(an(ini('a'), con('a'), ver('a'), pou(), int()).consumida, true);
});
test('fronteira-consumida-sem-veredito: pouso sem nenhum veredito também consome', () => {
  assert.equal(an(ini('a'), pou()).consumida, true);
});
test('k-sem-veredito-nao-pousa: sem review.veredito a fronteira não existe (consumida), com ou sem task em curso, diário vazio incluso', () => {
  assert.deepEqual(analisarFronteira([]), { consumida: true, motivo: null });
  assert.deepEqual(an(ini('a')), { consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a')), { consumida: true, motivo: null });
  assert.deepEqual(an(ini('a'), con('a'), ver('a')), { consumida: false, motivo: null });
});
test('k-sem-veredito-ilegivel-nao-vira-liberado: diário ilegível segue com motivo e consumida falso', () => {
  assert.deepEqual(analisarFronteira(null), { consumida: false, motivo: 'diário ilegível' });
  assert.equal(an(ini('a'), ['task.iniciada', { papel: 'implementador' }]).consumida, false);
});
test('fronteira-pouso-entre-sessoes: a ordem é a de ordenar, não a de chegada', () => {
  relogio = 0;
  const a = ev('task.iniciada', { task: 'a', papel: 'implementador' }, 's1', 1);
  const b = ev('task.concluida', { task: 'a', sha: 'x' }, 's1', 2);
  const c = ev('review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, 's1', 3);
  const p = ev('sessao.pouso', { percent: 60, x: 50 }, 's2', 1);
  assert.deepEqual(analisarFronteira([p, a, b, c]), { consumida: true, motivo: null });
});
test('evento-sem-task-nao-pousa: evento de task sem dados.task dá motivo e nada é consumido (C3)', () => {
  const r = an(ini('a'), con('a'), ver('a'), pou(), ['task.iniciada', { papel: 'implementador' }]);
  assert.equal(r.consumida, false);
  assert.match(String(r.motivo), /task/);
  const r2 = an(ini('a'), con('a'), ver('a'), ['task.iniciada', { task: 7 }]);
  assert.notEqual(r2.motivo, null);
});
test('analise-ruim-tem-motivo: não-lista e fora de ordem dizem por quê', () => {
  assert.notEqual(analisarFronteira(null).motivo, null);
  assert.notEqual(analisarFronteira([null]).motivo, null);
  assert.equal(analisarFronteira([]).motivo, null);
});

// ---- tasks em voo: o que `/gabarito retomar` reabre (fato F) ----
const PL = { entrega: 'GM-10', tasks: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, deps: [], arquivos: [`${id}.ts`] })) };
const emVoo = (...itens: [TipoEvento, Record<string, unknown>][]) => tasksEmVoo(PL, diario(...itens));
const iniP = (task: string, papel: string): [TipoEvento, Record<string, unknown>] => ['task.iniciada', { task, papel }];
test('tasks-em-voo-por-estado: implementando, corrigindo e em_revisao contam; os outros estados não', () => {
  const r = emVoo(
    iniP('a', 'implementador'),
    iniP('b', 'implementador'), con('b'), iniP('b', 'revisor'),
    iniP('c', 'implementador'), con('c'), ver('c', 'REPROVADO'), iniP('c', 'correcao'),
    iniP('d', 'implementador'), con('d'),
  );
  assert.deepEqual(r, { ok: true, tasks: ['a', 'b', 'c'] });
});
test('tasks-em-voo-nenhuma: aprovada, integrada, reprovada, pendente e diário vazio dão lista vazia', () => {
  assert.deepEqual(emVoo(), { ok: true, tasks: [] });
  assert.deepEqual(emVoo(ini('a'), con('a'), ver('a')), { ok: true, tasks: [] });
  assert.deepEqual(emVoo(ini('a'), con('a'), ver('a'), ['task.integrada', { task: 'a', sha: 'x' }]), { ok: true, tasks: [] });
  assert.deepEqual(emVoo(ini('a'), con('a'), ver('a', 'REPROVADO')), { ok: true, tasks: [] });
});
test('tasks-em-voo-ilegivel: não-lista, fora de ordem, task fora do plano e transição inválida nunca viram lista vazia', () => {
  for (const r of [
    tasksEmVoo(PL, null),
    tasksEmVoo(PL, [null]),
    tasksEmVoo(null, []),
    tasksEmVoo({ entrega: 'x', tasks: 'ruim' }, []),
    emVoo(ini('zzz')),
    emVoo(con('a')),
    emVoo(ini('a'), ['task.iniciada', { papel: 'implementador' }]),
  ]) {
    assert.equal(r.ok, false);
    assert.equal(typeof (r as { motivo: string }).motivo, 'string');
  }
});

// ---- tasks do negado: o que o mod reabre quando um Agent foi negado (T19, D1) ----
const doNegado = (negados: number, vivos: number, ...itens: [TipoEvento, Record<string, unknown>][]) => tasksDoNegado(PL, diario(...itens), negados, vivos);
test('negado-puro-vazio: sem negação, ou sem task em voo, nada a reabrir', () => {
  assert.deepEqual(doNegado(0, 0, iniP('a', 'implementador')), { ok: true, tasks: [] });
  assert.deepEqual(doNegado(2, 0), { ok: true, tasks: [] });
  assert.deepEqual(doNegado(1, 0, iniP('a', 'implementador'), con('a'), ver('a')), { ok: true, tasks: [] });
});
test('negado-puro-ordem: a iniciada por último primeiro, e só tantas quantas as negações', () => {
  const d: [TipoEvento, Record<string, unknown>][] = [iniP('b', 'implementador'), iniP('a', 'implementador'), iniP('c', 'implementador')];
  assert.deepEqual(doNegado(1, 0, ...d), { ok: true, tasks: ['c'] });
  assert.deepEqual(doNegado(2, 0, ...d), { ok: true, tasks: ['c', 'a'] });
  assert.deepEqual(doNegado(3, 0, ...d), { ok: true, tasks: ['c', 'a', 'b'] });
});
test('negado-puro-limites: com vivo nada se reabre; sem vivo, nunca mais que as em voo', () => {
  const d: [TipoEvento, Record<string, unknown>][] = [iniP('a', 'implementador'), iniP('b', 'implementador')];
  assert.deepEqual(doNegado(5, 0, ...d), { ok: true, tasks: ['b', 'a'] });
  assert.deepEqual(doNegado(5, 1, ...d), { ok: true, tasks: [] });
  assert.deepEqual(doNegado(5, 2, ...d), { ok: true, tasks: [] });
  assert.deepEqual(doNegado(1, 9, ...d), { ok: true, tasks: [] });
});
test('negado-puro-corrigindo-e-revisao: quem não é revisor primeiro; dentro disso, a iniciada mais recente', () => {
  const r = doNegado(1, 0, iniP('a', 'implementador'), con('a'), ver('a', 'REPROVADO'), iniP('a', 'correcao'), iniP('b', 'implementador'), con('b'), iniP('b', 'revisor'));
  assert.deepEqual(r, { ok: true, tasks: ['a'] });
  assert.deepEqual(doNegado(2, 0, iniP('a', 'implementador'), con('a'), ver('a', 'REPROVADO'), iniP('a', 'correcao'), iniP('b', 'implementador')), { ok: true, tasks: ['b', 'a'] });
  const lote: [TipoEvento, Record<string, unknown>][] = [iniP('a', 'implementador'), con('a'), ver('a', 'REPROVADO'), iniP('a', 'correcao'), iniP('b', 'implementador'), con('b'), iniP('b', 'revisor')];
  assert.deepEqual(doNegado(2, 0, ...lote), { ok: true, tasks: ['a', 'b'] });
});
test('negado-puro-ate: `ate` ordena as iniciadas depois dele para o fim e nunca as exclui', () => {
  const d: [TipoEvento, Record<string, unknown>][] = [iniP('a', 'implementador'), iniP('b', 'implementador'), iniP('c', 'implementador')];
  const ate = diario(...d)[1].ts;
  assert.deepEqual(tasksDoNegado(PL, diario(...d), 1, 0, ate), { ok: true, tasks: ['b'] });
  assert.deepEqual(tasksDoNegado(PL, diario(...d), 3, 0, ate), { ok: true, tasks: ['b', 'a', 'c'] });
  assert.deepEqual(tasksDoNegado(PL, diario(...d), 3, 0, null), { ok: true, tasks: ['c', 'b', 'a'] });
  assert.deepEqual(tasksDoNegado(PL, diario(...d), 3, 0, '0000-01-01T00:00:00.000Z'), { ok: true, tasks: ['c', 'b', 'a'] });
  const so: [TipoEvento, Record<string, unknown>][] = [iniP('a', 'implementador')];
  assert.deepEqual(tasksDoNegado(PL, diario(...so), 1, 0, '0000-01-01T00:00:00.000Z'), { ok: true, tasks: ['a'] });
});
test('negado-puro-ate-e-revisor: o revisor vai por último ANTES de `ate`: a iniciada depois de `ate` ainda precede o revisor', () => {
  const d: [TipoEvento, Record<string, unknown>][] = [iniP('a', 'implementador'), iniP('b', 'implementador'), con('b'), iniP('b', 'revisor'), iniP('c', 'implementador')];
  const ate = diario(...d)[3].ts;
  assert.deepEqual(tasksDoNegado(PL, diario(...d), 2, 0, ate), { ok: true, tasks: ['a', 'c'] });
  assert.deepEqual(tasksDoNegado(PL, diario(...d), 3, 0, ate), { ok: true, tasks: ['a', 'c', 'b'] });
});
test('negado-puro-ilegivel: plano, diário ou contagens ruins nunca viram lista vazia', () => {
  for (const r of [
    tasksDoNegado(PL, null, 1, 0),
    tasksDoNegado(null, [], 1, 0),
    tasksDoNegado(PL, diario(iniP('zzz', 'implementador')), 1, 0),
    tasksDoNegado(PL, diario(iniP('a', 'implementador')), -1, 0),
    tasksDoNegado(PL, diario(iniP('a', 'implementador')), 1.5, 0),
    tasksDoNegado(PL, diario(iniP('a', 'implementador')), Number.NaN, 0),
    tasksDoNegado(PL, diario(iniP('a', 'implementador')), 1, -1),
    tasksDoNegado(PL, diario(iniP('a', 'implementador')), 1, Number.NaN),
    tasksDoNegado(PL, diario(iniP('a', 'implementador')), '1' as unknown as number, 0),
  ]) {
    assert.equal(r.ok, false);
    assert.equal(typeof (r as { motivo: string }).motivo, 'string');
  }
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
const lerPonte = (d: string, dir: string) => ({ l: ponte({ op: 'ler', dir }, d) });
test('diario-integro-pela-ponte: o controle lê os três eventos e a análise não acha motivo', () => {
  const { d, dir } = diarioDe(completo());
  const r = lerPonte(d, dir);
  assert.equal(r.l.ok, true);
  assert.equal(r.l.eventos.length, 3);
  assert.equal(analisarFronteira(r.l.eventos).motivo, null);
});
test('diario-truncado-nao-pousa: linha truncada no disco depois do veredito (C1)', () => {
  const { d, dir, arq } = diarioDe(completo());
  writeFileSync(arq, readFileSync(arq, 'utf8') + '{"seq":4,"ts":"2026-11-03T00:00:09.000Z","sessao":"s9","tipo":"task.inic');
  const r = lerPonte(d, dir);
  assert.equal(r.l.ok, false);
  assert.match(r.l.erro, /ilegível|linha/);
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
});
test('arquivo-ilegivel-nao-pousa: chmod 000 no arquivo da sessão, com ler real (C4)', { skip: process.getuid?.() === 0 }, () => {
  const { d, dir } = diarioDe(completo());
  const outro = join(dir, 'events.s8.jsonl');
  writeFileSync(outro, '');
  chmodSync(outro, 0o000);
  try {
    const r = lerPonte(d, dir);
    assert.equal(r.l.ok, false);
    } finally {
    chmodSync(outro, 0o644);
  }
});
test('pasta-inexistente-nao-pousa: nada para ler não é fronteira', () => {
  const d = repoTemp();
  const r = lerPonte(d, join(d, 'nao-existe'));
  assert.equal(r.l.ok, false);
});
test('ponte-ler-usa-estrito: linha de lixo no meio não é descartada em silêncio', () => {
  const { d, dir, arq } = diarioDe(completo());
  writeFileSync(arq, 'lixo\n' + readFileSync(arq, 'utf8'));
  assert.equal(ponte({ op: 'ler', dir }, d).ok, false);
});

// ---- ponte `plano`: plano.json validado e config do loop; dado ruim nunca vira plano (contrato de falha) ----
const PLANO = { entrega: 'PBI-7', tasks: [{ id: 'a', deps: [], arquivos: ['a.ts'] }] };
function repoComPlano(plano: unknown, config?: string) {
  const d = repoTemp();
  const dir = join(d, '.harness', 'entregas', 'PBI-7');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plano.json'), typeof plano === 'string' ? plano : JSON.stringify(plano));
  if (config !== undefined) writeFileSync(join(d, 'harness.config.json'), config);
  return { d, dir };
}
test('ponte-plano: devolve o plano validado, slots e teto da config; sem config, 1 slot e sem teto', () => {
  const sem = repoComPlano(PLANO);
  assert.deepEqual(ponte({ op: 'plano', dir: sem.dir, raiz: sem.d }, sem.d), { ok: true, plano: PLANO, slots: 1, tetoTokens: null });
  const com = repoComPlano(PLANO, JSON.stringify({ loop: { slots: 3, tetoTokens: 900 } }));
  assert.deepEqual(ponte({ op: 'plano', dir: com.dir, raiz: com.d }, com.d), { ok: true, plano: PLANO, slots: 3, tetoTokens: 900 });
  const ruim = repoComPlano(PLANO, JSON.stringify({ loop: { slots: 0 } }));
  assert.equal(ponte({ op: 'plano', dir: ruim.dir, raiz: ruim.d }, ruim.d).slots, 1);
});
test('ponte-plano-dado-ruim-nao-e-plano: plano inválido, JSON ilegível, config ilegível e teto inválido dão ok falso', () => {
  for (const [nome, plano, config] of [
    ['plano inválido', { entrega: 'x', tasks: 'não' }, undefined],
    ['plano ilegível', '{nao json', undefined],
    ['config ilegível', PLANO, '{nao json'],
    ['teto zero', PLANO, JSON.stringify({ loop: { tetoTokens: 0 } })],
    ['teto texto', PLANO, JSON.stringify({ loop: { tetoTokens: '900' } })],
    ['teto nulo', PLANO, JSON.stringify({ loop: { tetoTokens: null } })],
  ] as const) {
    const r = repoComPlano(plano, config);
    assert.equal(ponte({ op: 'plano', dir: r.dir, raiz: r.d }, r.d).ok, false, nome);
  }
  const sem = repoTemp();
  assert.equal(ponte({ op: 'plano', dir: join(sem, 'nao-existe'), raiz: sem }, sem).ok, false);
  assert.equal(ponte({ op: 'plano', dir: join(sem, 'x') }, sem).ok, false);
});

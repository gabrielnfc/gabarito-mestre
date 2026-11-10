/**
 * Testes das pendências de aprendizado (GM-13 T3, REQ-APR-2). Mutações (task-3-mut.json):
 *  M-APR2b âncora no 1º task.integrada · M-APR2c 1 pendência por mensagem · M-APR2d compara só seq · M-APR2e âncora por maior seq
 *  M-APR2h sem guarda de eventos não array · M-APR2i soma de contagens sem validar inteiro · M-APR2j fechador sem forma válida
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendenciasAprendizado } from '../src/pendencias.ts';
import type { Evento, Pendencia, Plano } from '../src/tipos.ts';

const ts = (n: number) => new Date(Date.UTC(2026, 10, 10, 10, 0, 0) + n * 60_000).toISOString();
const ev = (sessao: string, seq: number, tipo: string, dados: unknown, n: number): Evento =>
  ({ seq, ts: ts(n), autor: 'x', sessao, agente: 'a', tipo, dados, hash_anterior: null }) as unknown as Evento;

const T = (id: string, deps: string[] = []) => ({ id, deps, arquivos: [`${id}.ts`], reqs: ['REQ-APR-2'] });
const plano = (...ids: string[]): Plano => ({ entrega: 'GM-13', tasks: ids.map((i) => T(i)) });

const apr = (g: unknown, extra: Record<string, unknown> = {}) => ({ tipo: 'E', status: 'M', gatilho: g, evidencia: {}, regra: 'r', entra_em: ['instantaneo'], ...extra });
const nada = (g: unknown, extra: Record<string, unknown> = {}) => ({ gatilho: g, motivo: 'nada a registrar', ...extra });
const ref = (sessao: string, seq: number) => ({ sessao, seq });
const HASH = 'a'.repeat(64);
const dono = (seq: number, n: number, dados: unknown = { sha256: HASH, chars: 5 }) => ev('dono', seq, 'dono.mensagem', dados, n);
const rev = (seq: number, n: number, major: unknown, blocker: unknown, extra: Record<string, unknown> = {}, sessao = 'loop') =>
  ev(sessao, seq, 'review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, major, blocker, ...extra }, n);
const parar = (seq: number, n: number, dados: unknown) => ev('loop', seq, 'loop.parar', dados, n);
const P = (sessao: string, seq: number, tipo: Pendencia['tipo']): Pendencia => ({ sessao, seq, tipo });

/** Ciclo mínimo de uma task até integrada (rodada 1 aprovada), a partir do seq/n dados. */
const integrar = (id: string, sessao: string, seq: number, n: number): Evento[] => [
  ev(sessao, seq, 'task.iniciada', { task: id, papel: 'implementador' }, n),
  ev(sessao, seq + 1, 'task.concluida', { task: id }, n + 1),
  ev(sessao, seq + 2, 'task.iniciada', { task: id, papel: 'revisor' }, n + 2),
  ev(sessao, seq + 3, 'review.veredito', { task: id, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, n + 3),
  ev(sessao, seq + 4, 'task.integrada', { task: id }, n + 4),
];

// ── gatilho review ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('major-abre', () => {
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [rev(1, 0, 1, 0)]), [P('loop', 1, 'review')]);
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [rev(1, 0, 0, 2)]), [P('loop', 1, 'review')]);
});

test('aprovado-com-achado-abre', () => {
  const e = ev('loop', 4, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, major: 1, blocker: 0 }, 0);
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [e]), [P('loop', 4, 'review')]);
});

test('aprovado-limpo-nao-abre', () => {
  const e = ev('loop', 4, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, 0);
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [e]), []);
});

test('contagem-texto-ou-negativa-nao-abre', () => {
  for (const [major, blocker] of [['1', '0'], [-1, 2], [1.5, 0], [undefined, 1], [1, undefined], [null, 2]]) {
    assert.deepEqual(pendenciasAprendizado(plano('T1'), [rev(1, 0, major, blocker)]), [], JSON.stringify([major, blocker]));
  }
});

// ── gatilho parar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('parar-abre', () => {
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [parar(1, 0, { motivo: 'ci_vermelho' })]), [P('loop', 1, 'parar')]);
});

test('parar-sem-progresso-do-stop-nao-abre', () => {
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [parar(1, 0, { motivo: 'sem_progresso', stops: 3 })]), []);
});

test('parar-sem-progresso-manual-abre', () => {
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [parar(1, 0, { motivo: 'sem_progresso' })]), [P('loop', 1, 'parar')]);
});

test('parar-stops-nao-inteiro-abre', () => {
  for (const stops of ['3', 2.5, null, undefined]) {
    assert.deepEqual(pendenciasAprendizado(plano('T1'), [parar(1, 0, { motivo: 'sem_progresso', stops })]), [P('loop', 1, 'parar')], String(stops));
  }
});

// ── fechamento ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('fechamento-ancora-no-ultimo-integrada', () => {
  const eventos = [...integrar('T1', 'loop', 1, 0), ...integrar('T2', 'loop', 6, 10), ...integrar('T3', 'loop', 11, 20)];
  assert.deepEqual(pendenciasAprendizado(plano('T1', 'T2', 'T3'), eventos), [P('loop', 15, 'fechamento')]);
});

test('fechamento-so-com-todas-integradas', () => {
  const eventos = [...integrar('T1', 'loop', 1, 0), ...integrar('T2', 'loop', 6, 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1', 'T2', 'T3'), eventos), []);
});

test('fechamento-fechado-some', () => {
  const eventos = [...integrar('T1', 'loop', 1, 0), ev('loop', 6, 'aprendizado', apr(ref('loop', 5)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), []);
  const nadas = [...integrar('T1', 'loop', 1, 0), ev('loop', 6, 'aprendizado.nada', nada(ref('loop', 5)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), nadas), []);
});

test('plano-vazio-sem-fechamento', () => {
  const eventos = integrar('T1', 'loop', 1, 0);
  assert.deepEqual(pendenciasAprendizado({ entrega: 'GM-13', tasks: [] }, eventos), []);
  assert.deepEqual(pendenciasAprendizado({ entrega: 'GM-13' } as unknown as Plano, eventos), []);
  // gatilhos 1, 2 e 4 seguem com plano sem tasks
  assert.deepEqual(pendenciasAprendizado({ entrega: 'GM-13', tasks: [] }, [parar(1, 0, { motivo: 'ci_vermelho' })]), [P('loop', 1, 'parar')]);
});

test('fechamento-ultimo-por-ordenar-entre-sessoes', () => {
  // T1 integra em `a` com seq 5 (ts 10:04); T2 integra depois, em `b`, com seq 1 (ts 10:50): a âncora é a última na ordem de
  // `ordenar` (b:1), não a de maior seq (a:5)
  const a = [...integrar('T1', 'a', 1, 0), ...integrar('T2', 'a', 6, 5).slice(0, 4)];
  const eventos = [...a, ev('b', 1, 'task.integrada', { task: 'T2' }, 50)];
  assert.equal(a[4].seq, 5);
  assert.deepEqual(pendenciasAprendizado(plano('T1', 'T2'), eventos), [P('b', 1, 'fechamento')]);
});

test('reintegracao-nova-ancora', () => {
  const t1 = integrar('T1', 'loop', 1, 0);
  const fechado = [...t1, ev('loop', 6, 'aprendizado', apr(ref('loop', 5)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), fechado), []);
  // o plano cresce: T2 entra e integra; a âncora antiga fechada não fecha a nova
  const cresceu = [...fechado, ...integrar('T2', 'loop', 7, 20)];
  assert.deepEqual(pendenciasAprendizado(plano('T1', 'T2'), cresceu), [P('loop', 11, 'fechamento')]);
  // e com o plano maior sem T2 integrada, a âncora antiga não reaparece
  assert.deepEqual(pendenciasAprendizado(plano('T1', 'T2'), fechado), []);
});

test('fechamento-task-com-estado-invalido-nao-ancora', () => {
  const eventos = [...integrar('T1', 'loop', 1, 0), ev('loop', 6, 'task.concluida', { task: 'T1' }, 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), []);
});

test('fechamento-fechador-de-outra-ancora-nao-fecha', () => {
  const eventos = [...integrar('T1', 'loop', 1, 0), ev('loop', 6, 'aprendizado', apr(ref('loop', 4)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('loop', 5, 'fechamento')]);
});

// ── dono ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('cinco-mensagens-uma-pendencia', () => {
  const eventos = [1, 2, 3, 4, 5].map((s) => dono(s, s));
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('dono', 5, 'dono')]);
});

test('nada-fecha-todas-anteriores', () => {
  const eventos = [...[1, 2, 3].map((s) => dono(s, s)), ev('loop', 1, 'aprendizado.nada', nada(ref('dono', 3)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), []);
  const meio = [...[1, 2, 3].map((s) => dono(s, s)), ev('loop', 1, 'aprendizado.nada', nada(ref('dono', 2)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), meio), [P('dono', 3, 'dono')]);
});

test('mensagem-depois-do-nada-reabre', () => {
  const eventos = [dono(1, 1), dono(2, 2), ev('loop', 1, 'aprendizado.nada', nada(ref('dono', 2)), 10), dono(3, 20)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('dono', 3, 'dono')]);
});

test('nada-dono-seq-forjado-nao-fecha-futura', () => {
  const eventos = [dono(1, 1), dono(2, 2), dono(3, 3), ev('loop', 1, 'aprendizado.nada', nada(ref('dono', 999)), 10), dono(4, 20)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('dono', 4, 'dono')]);
  // gatilho que aponta para evento que existe mas não é dono.mensagem também não fecha mensagem
  const outro = [dono(1, 1), ev('loop', 1, 'aprendizado.nada', nada(ref('loop', 1)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), outro), [P('dono', 1, 'dono')]);
});

test('dono-mensagem-forma-invalida-nao-conta', () => {
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [dono(1, 1, { sha256: HASH, chars: 5, texto: 'oi' })]), []);
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [dono(1, 1, { sha256: 'x', chars: 5 })]), []);
  // a inválida mais recente não esconde a válida anterior
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [dono(1, 1), dono(2, 2, { sha256: HASH, chars: 5, texto: 'oi' })]), [P('dono', 1, 'dono')]);
});

test('dono-mensagem-fechada-por-aprendizado-e-nao-por-gatilho-nulo', () => {
  const fecha = [dono(1, 1), ev('loop', 1, 'aprendizado', apr(ref('dono', 1)), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), fecha), []);
  const nulo = [dono(1, 1), ev('loop', 1, 'aprendizado', apr(null), 10)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), nulo), [P('dono', 1, 'dono')]);
});

// ── identidade, forma do fechador, ordem ─────────────────────────────────────────────────────────────────────────────────────

test('gatilho-sessao-diferente-nao-fecha', () => {
  const eventos = [rev(1, 0, 1, 0), ev('outra', 1, 'aprendizado', apr(ref('outra', 1)), 5)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('loop', 1, 'review')]);
  // gatilho com seq igual e sessão diferente do evento aberto
  const g = [rev(1, 0, 1, 0), ev('outra', 1, 'aprendizado.nada', nada(ref('terceira', 1)), 5)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), g), [P('loop', 1, 'review')]);
});

test('fechador-forma-invalida-nao-fecha', () => {
  const g = ref('loop', 1);
  const base = rev(1, 0, 1, 0);
  const invalidos = [
    ev('loop', 2, 'aprendizado', apr(g, { status: 'D' }), 5), // D sem evidência
    ev('loop', 2, 'aprendizado.nada', nada(g, { motivo: '' }), 5),
    ev('loop', 2, 'aprendizado', apr(g, { regra: '' }), 5),
    ev('loop', 2, 'aprendizado.nada', null, 5),
  ];
  for (const f of invalidos) assert.deepEqual(pendenciasAprendizado(plano('T1'), [base, f]), [P('loop', 1, 'review')], JSON.stringify(f.dados));
});

test('fechador-antes-do-gatilho-na-ordem-fecha', () => {
  // sessões diferentes: o fechador tem ts anterior ao gatilho; a identidade é (sessao, seq), não a posição
  const eventos = [ev('z', 1, 'aprendizado', apr(ref('loop', 1)), 0), rev(1, 5, 1, 0)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), []);
});

test('ordem-da-saida-e-a-de-ordenar', () => {
  const eventos = [rev(1, 0, 1, 0), dono(1, 5), parar(2, 10, { motivo: 'ci_vermelho' })];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('loop', 1, 'review'), P('dono', 1, 'dono'), P('loop', 2, 'parar')]);
  const trocado = [rev(1, 10, 1, 0, {}, 'loop'), dono(1, 0)];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), trocado), [P('dono', 1, 'dono'), P('loop', 1, 'review')]);
});

// ── ausente × corrompido ────────────────────────────────────────────────────────────────────────────────────────────────────

test('pendencias-ausente-x-corrompido', () => {
  assert.deepEqual(pendenciasAprendizado(plano('T1'), []), []);
  // fora de ordem (seq regride na sessão), ts torto e item nulo: `[]`, nunca lança
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [rev(2, 0, 1, 0), rev(1, 1, 1, 0)]), []);
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [{ ...rev(1, 0, 1, 0), ts: 'ontem' } as Evento]), []);
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [null as unknown as Evento, rev(1, 0, 1, 0)]), []);
  // corrompido ≠ ausente: o mesmo diário válido com 1 evento torto no fim perde a pendência (o chamador trata como `diario_invalido`)
  assert.deepEqual(pendenciasAprendizado(plano('T1'), [rev(1, 0, 1, 0)]), [P('loop', 1, 'review')]);
});

test('eventos-nao-array-e-dados-null-nao-lancam', () => {
  for (const v of [null, undefined, {}, 'texto', 7]) {
    assert.deepEqual(pendenciasAprendizado(plano('T1'), v as unknown as Evento[]), []);
  }
  for (const dados of [null, 'x', [], 3]) {
    const eventos = [ev('loop', 1, 'review.veredito', dados, 0), ev('loop', 2, 'loop.parar', dados, 1), ev('loop', 3, 'task.integrada', dados, 2), ev('dono', 1, 'dono.mensagem', dados, 3), ev('loop', 4, 'aprendizado', dados, 4)];
    // loop.parar com `dados` que não é objeto abre `parar`; o resto não abre nem lança
    assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('loop', 2, 'parar')], JSON.stringify(dados));
  }
});

test('costura-integrada-com-pendencia-de-review-e-fechamento-juntas', () => {
  // P9: diário de task com todas as transições reais (r1 reprovada com major, correção, r2 aprovada limpa, integrada)
  const eventos = [
    ev('loop', 1, 'task.iniciada', { task: 'T1', papel: 'implementador' }, 0),
    ev('loop', 2, 'task.concluida', { task: 'T1' }, 1),
    ev('loop', 3, 'task.iniciada', { task: 'T1', papel: 'revisor' }, 2),
    ev('loop', 4, 'review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }, 3),
    ev('loop', 5, 'task.iniciada', { task: 'T1', papel: 'correcao' }, 4),
    ev('loop', 6, 'task.concluida', { task: 'T1' }, 5),
    ev('loop', 7, 'task.iniciada', { task: 'T1', papel: 'revisor' }, 6),
    ev('loop', 8, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 2, major: 0, blocker: 0 }, 7),
    ev('loop', 9, 'task.integrada', { task: 'T1' }, 8),
  ];
  assert.deepEqual(pendenciasAprendizado(plano('T1'), eventos), [P('loop', 4, 'review'), P('loop', 9, 'fechamento')]);
});

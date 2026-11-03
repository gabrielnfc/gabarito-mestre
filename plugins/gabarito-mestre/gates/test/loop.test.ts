/** Testes de proximaAcao, podeIntegrar e ordenar (REQ-LOOP-2). Mutações: task-2-r3-mut.json. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAVES_DE_EVENTO, estadoDe, ordenar, podeIntegrar, proximaAcao, TRANSICOES } from '../src/loop.ts';
import type { ChaveEvento, EstadoTask } from '../src/loop.ts';
import { analisarFronteira, negaDespacho } from '../src/pouso.ts';
import type { Evento, Plano, Sinais, TipoEvento } from '../src/tipos.ts';

const plano = (...tasks: [string, string[]?][]): Plano => ({
  entrega: 'GM-10',
  tasks: tasks.map(([id, deps]) => ({ id, deps: deps ?? [], arquivos: [`${id}.ts`] })),
});
const sinais = (s: Partial<Sinais> = {}): Sinais => ({
  slots: 3, percent: 10, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: true, ...s,
});
/** Diário de uma sessão, com seq e ts crescentes pela posição. */
const diario = (...evs: [TipoEvento, Record<string, unknown>][]): Evento[] =>
  evs.map(([tipo, dados], i) => ev(i + 1, new Date(Date.UTC(2026, 10, 3, 0, 0, i)).toISOString(), 's1', tipo, dados));
function ev(seq: number, ts: string, sessao: string, tipo: TipoEvento, dados: Record<string, unknown>): Evento {
  return { seq, ts, autor: 'a', sessao, agente: 'o', tipo, dados, hash_anterior: null };
}
const ini = (task: string, papel = 'implementador'): [TipoEvento, Record<string, unknown>] => ['task.iniciada', { task, papel }];
const con = (task: string): [TipoEvento, Record<string, unknown>] => ['task.concluida', { task, sha: 'abc' }];
const ver = (task: string, veredito: string, rodada: number, major = 0, blocker = 0): [TipoEvento, Record<string, unknown>] =>
  ['review.veredito', { task, veredito, rodada, major, blocker }];
const int = (task: string): [TipoEvento, Record<string, unknown>] => ['task.integrada', { task, sha: 'def' }];
const ci = (verde: boolean): [TipoEvento, Record<string, unknown>] => ['ci.resultado', { verde }];
const aprovada = (t: string) => [ini(t), con(t), ver(t, 'APROVADO', 1)];
const pronta = (t: string) => [...aprovada(t), int(t)];
const noTeto = (t: string, major = 1, blocker = 0) => [
  ini(t), con(t), ver(t, 'REPROVADO', 1, 1), ini(t, 'correcao'), con(t), ver(t, 'REPROVADO', 2, major, blocker),
];

const invalido = { tipo: 'parar', motivo: 'diario_invalido' };
// (1)
test('seq-fora-de-ordem-para', () => {
  const evs = [ev(2, '2026-11-03T00:00:01.000Z', 's1', ...ini('a')), ev(1, '2026-11-03T00:00:02.000Z', 's1', ...con('a'))];
  assert.deepEqual(ordenar(evs), { ok: false });
  assert.deepEqual(proximaAcao(plano(['a']), evs, sinais()), { tipo: 'parar', motivo: 'diario_invalido' });
});
test('seq-repetido-para', () => {
  const evs = [ev(1, '2026-11-03T00:00:01.000Z', 's1', ...ini('a')), ev(1, '2026-11-03T00:00:02.000Z', 's1', ...con('a'))];
  assert.deepEqual(ordenar(evs), { ok: false });
});
test('ts-regride-na-sessao-nao-invalida-e-seq-manda', () => {
  const x = ev(1, '2026-11-03T00:00:05.000Z', 's1', ...ini('a'));
  const y = ev(2, '2026-11-03T00:00:01.000Z', 's1', ...con('a'));
  assert.deepEqual(ordenar([x, y]), { ok: true, eventos: [x, y] });
  assert.equal(proximaAcao(plano(['a']), [x, y], sinais()).tipo, 'despachar');
});
test('ts-contraditorio-nao-quebra-seq-ao-intercalar-sessoes', () => {
  const x = ev(1, '2026-11-03T00:00:05.000Z', 's1', ...ci(true));
  const y = ev(2, '2026-11-03T00:00:01.000Z', 's1', ...ci(false));
  const z = ev(1, '2026-11-03T00:00:03.000Z', 's2', ...ci(false));
  assert.deepEqual(ordenar([x, y, z]), { ok: true, eventos: [z, x, y] });
});
test('duas-sessoes-mesmo-ts-desempata-por-sessao', () => {
  const b1 = ev(1, '2026-11-03T00:00:05.000Z', 'b', ...ci(true));
  const a1 = ev(1, '2026-11-03T00:00:05.000Z', 'a', ...ci(true));
  const a2 = ev(2, '2026-11-03T00:00:05.000Z', 'a', ...ci(true));
  assert.deepEqual(ordenar([b1, a1, a2]), { ok: true, eventos: [a1, a2, b1] });
});
test('ts-invalido-para', () => {
  assert.deepEqual(ordenar([ev(1, 'ontem', 's1', ...ini('a'))]), { ok: false });
  assert.deepEqual(ordenar([ev(1, '2026-11-03T00:00:01', 's1', ...ini('a'))]), { ok: false }, 'sem fuso depende da máquina');
});
test('duas-sessoes-ordem-ts-sessao', () => {
  const a = ev(1, '2026-11-03T00:00:05.000Z', 'b', ...ci(true));
  const b = ev(1, '2026-11-03T00:00:05.000Z', 'a', ...ci(false));
  const c = ev(2, '2026-11-03T00:00:06.000Z', 'a', ...ci(true));
  const d = ev(2, '2026-11-03T00:00:04.000+00:00', 'z', ...ci(true));
  const d0 = ev(1, '2026-11-03T00:00:03.000Z', 'z', ...ci(true));
  const r = ordenar([a, b, c, d0, d]);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.eventos, [d0, d, b, a, c]);
});
test('ordem-entre-sessoes-muda-a-decisao', () => {
  const v = ev(1, '2026-11-03T00:00:05.000Z', 'b', 'ci.resultado', { verde: false });
  const f = ev(1, '2026-11-03T00:00:01.000Z', 'a', 'ci.resultado', { verde: false });
  const g = ev(1, '2026-11-03T00:00:03.000Z', 'c', 'ci.resultado', { verde: true });
  assert.equal(proximaAcao(plano(['a']), [v, f, g], sinais()).tipo, 'despachar', 'verde entre os vermelhos');
});
test('ordenar-nao-muta-a-entrada', () => {
  const evs = [ev(1, '2026-11-03T00:00:05.000Z', 'b', ...ci(true)), ev(1, '2026-11-03T00:00:01.000Z', 'a', ...ci(true))];
  const copia = [...evs];
  ordenar(evs);
  assert.deepEqual(evs, copia);
});
test('evento-fora-do-plano-para', () => {
  for (const e of [ini('x'), con('x'), ver('x', 'APROVADO', 1), int('x')]) {
    assert.deepEqual(proximaAcao(plano(['a']), diario(e), sinais()), { tipo: 'parar', motivo: 'diario_invalido' });
  }
});
test('dados-invalidos-para', () => {
  const invalidos: [TipoEvento, Record<string, unknown>][] = [
    ['task.iniciada', { task: 'a' }],
    ['task.concluida', {}],
    ['review.veredito', { task: 'a', veredito: 'TALVEZ', rodada: 1, major: 0, blocker: 0 }],
    ['review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 0, major: 0, blocker: 0 }],
    ['review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 2, blocker: 0 }],
    ['ci.resultado', { verde: 'não' }],
  ];
  for (const e of invalidos) {
    assert.deepEqual(proximaAcao(plano(['a']), diario(e), sinais()), { tipo: 'parar', motivo: 'diario_invalido' }, JSON.stringify(e));
  }
});
// (2)
test('pausado-espera-e-vence-o-teto-de-tokens', () => {
  assert.equal(proximaAcao(plano(['a']), [], sinais({ pausado: true, tokens: 9, tetoTokens: 1 })).tipo, 'esperar');
});
test('diario-invalido-vence-pausado', () => {
  const evs = diario(ini('x'));
  assert.equal(proximaAcao(plano(['a']), evs, sinais({ pausado: true })).tipo, 'parar');
});
// (3)
test('teto-tokens-limite-exato-para', () => {
  assert.deepEqual(proximaAcao(plano(['a']), [], sinais({ tokens: 100, tetoTokens: 100 })), { tipo: 'parar', motivo: 'teto_tokens' });
  assert.equal(proximaAcao(plano(['a']), [], sinais({ tokens: 99, tetoTokens: 100 })).tipo, 'despachar');
  assert.equal(proximaAcao(plano(['a']), [], sinais({ tokens: null, tetoTokens: 0 })).tipo, 'despachar');
  assert.equal(proximaAcao(plano(['a']), [], sinais({ tokens: 5, tetoTokens: null })).tipo, 'despachar');
});
// (4)
test('ci-vermelho-2x-seguidos-para', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(ci(false), ci(false)), sinais()), { tipo: 'parar', motivo: 'ci_vermelho' });
  assert.equal(proximaAcao(plano(['a']), diario(ci(false)), sinais()).tipo, 'despachar');
  assert.equal(proximaAcao(plano(['a']), diario(ci(false), ci(true), ci(false)), sinais()).tipo, 'despachar');
  assert.equal(proximaAcao(plano(['a']), diario(ci(false), ci(false), ci(true)), sinais()).tipo, 'despachar');
});
test('ci-vermelho-seguido-ignora-outros-eventos-entre', () => {
  assert.equal(proximaAcao(plano(['a']), diario(ci(false), ini('a'), ci(false)), sinais()).tipo, 'parar');
});
test('teto-tokens-vence-ci', () => {
  const a = proximaAcao(plano(['a']), diario(ci(false), ci(false)), sinais({ tokens: 1, tetoTokens: 1 }));
  assert.deepEqual(a, { tipo: 'parar', motivo: 'teto_tokens' });
});
// plano vazio
test('plano-vazio-para', () => {
  assert.deepEqual(proximaAcao(plano(), [], sinais()), { tipo: 'parar', motivo: 'nao_conseguiu' });
  assert.deepEqual(proximaAcao(plano(), [], sinais({ percent: 90 })), { tipo: 'parar', motivo: 'nao_conseguiu' });
});
// (5)
test('x-so-revisor', () => {
  const evs = diario(ini('a'), con('a'), ...aprovada('c'));
  const a = proximaAcao(plano(['a'], ['b'], ['c']), evs, sinais({ percent: 50 }));
  assert.deepEqual(a, { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
});
test('x-percent-igual-conta-como-acima-e-abaixo-nao', () => {
  assert.deepEqual(proximaAcao(plano(['a']), [], sinais({ percent: 50 })), { tipo: 'pousar' });
  assert.equal(proximaAcao(plano(['a']), [], sinais({ percent: 49 })).tipo, 'despachar');
});
test('x-revisor-respeita-slots', () => {
  const evs = diario(ini('a'), con('a'), ini('b'), con('b'));
  const a = proximaAcao(plano(['a'], ['b']), evs, sinais({ percent: 60, slots: 2, vivos: 1 }));
  assert.deepEqual(a, { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
});
test('x-vivos-espera', () => {
  assert.equal(proximaAcao(plano(['a']), diario(ini('a')), sinais({ percent: 60, vivos: 1 })).tipo, 'esperar');
});
test('x-sem-pouso-para', () => {
  assert.deepEqual(proximaAcao(plano(['a']), [], sinais({ percent: 60, podePousar: false })), { tipo: 'parar', motivo: 'sem_pouso' });
});
test('x-sem-slot-nunca-despacha', () => {
  const evs = diario(ini('a'), con('a'));
  assert.equal(proximaAcao(plano(['a']), evs, sinais({ percent: 60, slots: 1, vivos: 2 })).tipo, 'esperar');
});
// Tabela A-M da Sombra T9b, linhas do núcleo (percent >= X): uma linha, um teste.
const NX = (s: Partial<Sinais> = {}) => sinais({ percent: 60, ...s });
test('tabela-H-concluida-despacha-revisor: com ou sem agente vivo, o revisor vem antes de qualquer pouso', () => {
  const evs = diario(ini('a'), con('a'));
  assert.deepEqual(proximaAcao(plano(['a']), evs, NX()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
  assert.deepEqual(proximaAcao(plano(['a'], ['b']), diario(ini('a'), con('a'), ini('b')), NX({ vivos: 1 })), { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
});
test('tabela-I-vivos-sem-concluida-espera', () => {
  assert.equal(proximaAcao(plano(['a'], ['b']), diario(...aprovada('a')), NX({ vivos: 2 })).tipo, 'esperar');
});
test('tabela-J-em-voo-sem-agente-nao-pousa: implementando, corrigindo e em_revisao sem vivo caem em nao_conseguiu (5b)', () => {
  const impl = diario(ini('a'));
  assert.deepEqual(proximaAcao(plano(['a']), impl, NX()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
  const corr = diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'));
  assert.deepEqual(proximaAcao(plano(['a']), corr, NX()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
  const rev = diario(ini('a'), con('a'), ini('a', 'revisor'));
  assert.deepEqual(proximaAcao(plano(['a']), rev, NX()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
});
test('tabela-J-motivo-e-da-task-em-voo: outra task no teto não troca o motivo para teto_rodadas', () => {
  const evs = diario(...noTeto('a'), ini('b'));
  assert.deepEqual(proximaAcao(plano(['a'], ['b']), evs, NX()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'b' });
});
test('tabela-K-aprovada-nao-integrada-pousa', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...aprovada('a')), NX()), { tipo: 'pousar' });
});
test('tabela-K-integrada-com-pendentes-pousa: task.integrada depois do veredito não desfaz a fronteira (MAJOR 1)', () => {
  assert.deepEqual(proximaAcao(plano(['a'], ['b']), diario(...pronta('a')), NX()), { tipo: 'pousar' });
});
test('tabela-K-reprovada-r1-pousa', () => {
  const evs = diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1));
  assert.deepEqual(proximaAcao(plano(['a']), evs, NX()), { tipo: 'pousar' });
});
test('tabela-K-no-teto-com-dependente-pousa', () => {
  assert.deepEqual(proximaAcao(plano(['a'], ['b', ['a']]), diario(...noTeto('a')), NX()), { tipo: 'pousar' });
});
/** O que o mod faz: fronteira consumida (inclui "sem veredito") ⇒ `percent: null` ao núcleo (REQ-POU-1, aceite 1). */
const comFronteira = (p: Plano, evs: Evento[], s: Partial<Sinais> = {}) => {
  const f = analisarFronteira(evs);
  return proximaAcao(p, evs, sinais({ percent: f.consumida ? null : 60, x: 50, ...s }));
};
test('k-sem-veredito-nao-pousa: sem review.veredito a fronteira não existe; percent nulo ao núcleo e o despacho segue (aceite 1)', () => {
  assert.deepEqual(comFronteira(plano(['a']), []), { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] });
  const so = diario(ini('a'), con('a'));
  assert.equal(comFronteira(plano(['a']), so, { vivos: 0 }).tipo, 'despachar');
  assert.equal(negaDespacho(comFronteira(plano(['a']), []), analisarFronteira([]).consumida), false);
});
test('k-fim-em-concluir: plano de 3 tasks, X baixo, sequência ideal: 2 pousos, 0 sem veredito, termina em concluir (Sombra T13, fato B)', () => {
  const pl = plano(['T1'], ['T2'], ['T3', ['T1']]);
  let seq = 0;
  const E: Evento[] = [];
  const grava = (tipo: TipoEvento, dados: Record<string, unknown>) => {
    seq += 1;
    E.push(ev(seq, new Date(Date.UTC(2026, 10, 3, 12, 0, seq)).toISOString(), 's', tipo, dados));
  };
  let vivos: { task: string; papel: string }[] = [];
  const log: string[] = [];
  for (let guard = 0; guard < 80; guard++) {
    const f = analisarFronteira(E);
    const a = proximaAcao(pl, E, { slots: 2, percent: f.consumida ? null : 3, x: 1, pausado: false, vivos: vivos.length, tokens: null, tetoTokens: null, podePousar: true });
    log.push(a.tipo);
    if (a.tipo === 'concluir' || a.tipo === 'parar') break;
    if (a.tipo === 'pousar') { grava('sessao.pouso', { percent: 3, x: 1 }); grava('sessao.retomada', { chars: 10 }); continue; }
    if (a.tipo === 'despachar') { for (const i of a.itens) { grava('task.iniciada', { task: i.task, papel: i.papel }); vivos.push(i); } continue; }
    if (a.tipo === 'integrar') { for (const t of a.tasks) grava('task.integrada', { task: t, sha: 'x' }); continue; }
    const i = vivos.shift();
    if (i === undefined) break;
    if (i.papel === 'implementador') grava('task.concluida', { task: i.task, sha: 'x' });
    else grava('review.veredito', { task: i.task, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
  }
  assert.equal(log.at(-1), 'concluir', log.join(','));
  let veredictos = 0;
  let semVeredito = 0;
  let pousos = 0;
  for (const e of E) {
    if (e.tipo === 'review.veredito') veredictos += 1;
    if (e.tipo === 'sessao.pouso') { pousos += 1; if (veredictos === 0) semVeredito += 1; veredictos = 0; }
  }
  assert.equal(pousos, 2);
  assert.equal(semVeredito, 0);
});
test('tabela-K-sem-pouso-quando-nao-pode: podePousar falso para com sem_pouso', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...aprovada('a')), NX({ podePousar: false })), { tipo: 'parar', motivo: 'sem_pouso' });
});
test('tabela-L-tudo-integrado-conclui-sem-pousar (5d)', () => {
  assert.deepEqual(proximaAcao(plano(['a'], ['b']), diario(...pronta('a'), ...pronta('b')), NX()), { tipo: 'concluir' });
});
test('tabela-M-so-no-teto-para-sem-pousar (5d)', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...noTeto('a')), NX()), tetoDe('a'));
  assert.deepEqual(proximaAcao(plano(['a'], ['b']), diario(...pronta('b'), ...noTeto('a')), NX()), tetoDe('a'));
});
test('tabela-percent-nulo-igual-a-consumida: sem percent a (5) nao dispara e o loop segue (F)', () => {
  const evs = diario(...pronta('a'));
  assert.deepEqual(proximaAcao(plano(['a'], ['b']), evs, NX({ percent: null })), { tipo: 'despachar', itens: [{ task: 'b', papel: 'implementador' }] });
});
test('percent-nulo-nao-pousa', () => {
  assert.equal(proximaAcao(plano(['a']), [], sinais({ percent: null, x: 0 })).tipo, 'despachar');
  assert.equal(proximaAcao(plano(['a']), [], sinais({ percent: null, x: 0, podePousar: false })).tipo, 'despachar');
});
// (6)
test('integra-aprovadas-antes-de-despachar', () => {
  const a = proximaAcao(plano(['a'], ['b'], ['c']), diario(...aprovada('a'), ...aprovada('c')), sinais());
  assert.deepEqual(a, { tipo: 'integrar', tasks: ['a', 'c'] });
});
test('podeIntegrar-exige-dep-integrada', () => {
  const p = plano(['a'], ['b', ['a']]);
  const evs = diario(...aprovada('a'), ...aprovada('b'));
  assert.equal(podeIntegrar(p, evs, 'a'), true);
  assert.equal(podeIntegrar(p, evs, 'b'), false);
  assert.deepEqual(proximaAcao(p, evs, sinais()), { tipo: 'integrar', tasks: ['a'] });
  assert.equal(podeIntegrar(p, diario(...pronta('a'), ...aprovada('b')), 'b'), true);
});
test('podeIntegrar-casos-falsos', () => {
  const p = plano(['a']);
  assert.equal(podeIntegrar(p, [], 'a'), false, 'sem veredito');
  assert.equal(podeIntegrar(p, diario(...aprovada('a')), 'zz'), false, 'fora do plano');
  assert.equal(podeIntegrar(p, diario(...pronta('a')), 'a'), false, 'já integrada');
  assert.equal(podeIntegrar(p, diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1)), 'a'), false, 'reprovada');
  assert.equal(podeIntegrar(p, diario(...aprovada('a'), ini('a', 'correcao'), con('a')), 'a'), false, 'commit novo sem review');
  assert.equal(podeIntegrar(p, diario(ini('zz')), 'a'), false, 'diário inválido');
  const fora = [ev(2, '2026-11-03T00:00:01.000Z', 's1', ...ver('a', 'APROVADO', 1)), ev(1, '2026-11-03T00:00:02.000Z', 's1', ...ini('a'))];
  assert.equal(podeIntegrar(p, fora, 'a'), false, 'fora de ordem');
});
// vereditos múltiplos
test('rodada-fora-de-sequencia-invalida', () => {
  const p = plano(['a']);
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'APROVADO', 2), ver('a', 'REPROVADO', 1, 1)), sinais()), invalido);
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'APROVADO', 2)), sinais()), invalido, 'primeiro veredito é rodada 1');
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'), con('a'), ver('a', 'APROVADO', 1)), sinais()), invalido, 'repetir a rodada 1');
});
// (7)
test('reprovada-rodada-1-correcao', () => {
  const a = proximaAcao(plano(['a']), diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1)), sinais());
  assert.deepEqual(a, { tipo: 'despachar', itens: [{ task: 'a', papel: 'correcao' }] });
});
test('correcao-em-curso-nao-repete', () => {
  const a = proximaAcao(plano(['a']), diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao')), sinais({ vivos: 1 }));
  assert.equal(a.tipo, 'esperar');
});
test('correcao-concluida-volta-ao-revisor', () => {
  const a = proximaAcao(plano(['a']), diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'), con('a')), sinais());
  assert.deepEqual(a, { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
});
test('concluida-sem-veredito-revisor', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(ini('a'), con('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
});
test('revisor-em-curso-nao-repete', () => {
  assert.equal(proximaAcao(plano(['a']), diario(ini('a'), con('a'), ini('a', 'revisor')), sinais({ vivos: 1 })).tipo, 'esperar');
});
test('implementador-so-com-deps-integradas', () => {
  const p = plano(['a'], ['b', ['a']]);
  assert.deepEqual(proximaAcao(p, [], sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] });
  assert.equal(proximaAcao(p, diario(ini('a')), sinais({ vivos: 1 })).tipo, 'esperar');
  assert.deepEqual(proximaAcao(p, diario(...pronta('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'b', papel: 'implementador' }] });
});
test('iniciada-nao-repete-implementador', () => {
  assert.equal(proximaAcao(plano(['a']), diario(ini('a')), sinais({ vivos: 1 })).tipo, 'esperar');
});
test('ordem-de-papeis-correcao-revisor-implementador', () => {
  const evs = diario(ini('r'), con('r'), ini('c'), con('c'), ver('c', 'REPROVADO', 1, 1));
  const a = proximaAcao(plano(['n'], ['r'], ['c']), evs, sinais());
  assert.deepEqual(a, { tipo: 'despachar', itens: [
    { task: 'c', papel: 'correcao' }, { task: 'r', papel: 'revisor' }, { task: 'n', papel: 'implementador' },
  ] });
});
test('paralelas-respeitam-slots', () => {
  const a = proximaAcao(plano(['a'], ['b'], ['c'], ['d']), [], sinais({ slots: 3, vivos: 1 }));
  assert.deepEqual(a, { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }, { task: 'b', papel: 'implementador' }] });
});
test('slots-negativo-nunca-despacha', () => {
  for (const s of [{ slots: 1, vivos: 3 }, { slots: 1, vivos: 1 }, { slots: 0, vivos: 0 }]) {
    assert.equal(proximaAcao(plano(['a']), [], sinais(s)).tipo, 'esperar', JSON.stringify(s));
  }
});
// teto
test('teto-independente-segue', () => {
  const a = proximaAcao(plano(['a'], ['b']), diario(...noTeto('a')), sinais());
  assert.deepEqual(a, { tipo: 'despachar', itens: [{ task: 'b', papel: 'implementador' }] });
});
test('teto-dependente-nao-integra', () => {
  const p = plano(['a'], ['b', ['a']], ['c', ['b']]);
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'b', papel: 'implementador' }] });
  const evs = diario(...noTeto('a'), ...aprovada('b'));
  assert.equal(podeIntegrar(p, evs, 'b'), false);
  assert.deepEqual(proximaAcao(p, evs, sinais()), { tipo: 'despachar', itens: [{ task: 'c', papel: 'implementador' }] });
  const evs2 = diario(...noTeto('a'), ...aprovada('b'), ...aprovada('c'));
  assert.equal(podeIntegrar(p, evs2, 'c'), false, 'transitivo');
  assert.deepEqual(proximaAcao(p, evs2, sinais()), { tipo: 'parar', motivo: 'teto_rodadas', task: 'a' });
});
test('teto-transitivo-mesmo-com-elo-do-meio-integrado', () => {
  const p = plano(['a'], ['b', ['a']], ['c', ['b']]);
  assert.equal(podeIntegrar(p, diario(...noTeto('a'), ...pronta('b'), ...aprovada('c')), 'c'), false);
});
test('dependente-de-bloqueada-nao-aprovada-espera', () => {
  const p = plano(['a'], ['b', ['a']], ['c', ['b']]);
  const a = proximaAcao(p, diario(...noTeto('a'), ini('b')), sinais({ vivos: 1 }));
  assert.equal(a.tipo, 'esperar');
});
// teto como estado
const tetoDe = (t: string) => ({ tipo: 'parar', motivo: 'teto_rodadas', task: t });
const dono = (task: string): [TipoEvento, Record<string, unknown>] => ['task.reaberta', { task, origem: 'dono' }];
const retomada = (task: string): [TipoEvento, Record<string, unknown>] => ['task.reaberta', { task, origem: 'retomada' }];
const EVENTOS_AVULSOS: [string, [TipoEvento, Record<string, unknown>]][] = [
  ['iniciada.implementador', ini('a')], ['iniciada.revisor', ini('a', 'revisor')], ['iniciada.correcao', ini('a', 'correcao')],
  ['concluida', con('a')], ['aprovado r3', ver('a', 'APROVADO', 3)], ['aprovado r2 com achado', ver('a', 'APROVADO', 2, 1)],
  ['aprovado r1', ver('a', 'APROVADO', 1)], ['reprovado r1', ver('a', 'REPROVADO', 1, 1)], ['reprovado r3', ver('a', 'REPROVADO', 3, 1)],
  ['reprovado r2 duplicado', ver('a', 'REPROVADO', 2, 1)], ['retomada', retomada('a')],
];
test('teto-evento-avulso-mantem', () => {
  const p = plano(['a']);
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a')), sinais()), tetoDe('a'));
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a')), sinais({ percent: 60 })), tetoDe('a'), '(5d): só resta o teto, para sem pousar');
  for (const [nome, mais] of EVENTOS_AVULSOS) {
    const evs = diario(...noTeto('a'), mais);
    assert.deepEqual(proximaAcao(p, evs, sinais()), tetoDe('a'), nome);
    assert.deepEqual(estadoDe(evs), { estado: 'no_teto', rodada: 2 }, `${nome}: não conta rodada`);
    assert.equal(podeIntegrar(p, evs, 'a'), false, nome);
  }
});
test('teto-duplicata-veredito-mantem', () => {
  const p = plano(['a']);
  const evs = diario(...noTeto('a'), ver('a', 'REPROVADO', 2, 1), ver('a', 'REPROVADO', 2, 1));
  assert.deepEqual(proximaAcao(p, evs, sinais()), tetoDe('a'));
  assert.deepEqual(estadoDe(evs), { estado: 'no_teto', rodada: 2 });
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), con('a'), con('a')), sinais()), tetoDe('a'));
  const malformado = diario(...noTeto('a'), ['review.veredito', { task: 'a', veredito: 'TALVEZ', rodada: 3, major: 0, blocker: 0 }]);
  assert.deepEqual(proximaAcao(p, malformado, sinais()), invalido, 'malformado segue inválido antes da tabela');
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), ver('a', 'REPROVADO', -1, 0)), sinais()), invalido);
});
test('teto-depois-dono-libera', () => {
  const p = plano(['a']);
  const impl = { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] };
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), con('a'), dono('a')), sinais()), impl, 'teto, concluida, dono');
  for (const [nome, mais] of EVENTOS_AVULSOS) {
    assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), mais, dono('a')), sinais()), impl, nome);
  }
  assert.deepEqual(estadoDe(diario(...noTeto('a'), con('a'), dono('a'))), { estado: 'pendente', rodada: 0 });
});
test('teto-integrada-invalida', () => {
  const p = plano(['a']);
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), int('a')), sinais()), invalido);
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), con('a'), int('a')), sinais()), invalido);
});
test('teto-aprovado-nao-integra', () => {
  const p = plano(['a']);
  for (const v of [ver('a', 'APROVADO', 3), ver('a', 'APROVADO', 2), ver('a', 'APROVADO', 1)]) {
    const evs = diario(...noTeto('a'), v);
    assert.equal(podeIntegrar(p, evs, 'a'), false);
    const a = proximaAcao(p, evs, sinais());
    assert.notEqual(a.tipo, 'integrar');
    assert.deepEqual(a, tetoDe('a'));
  }
});
test('teto-por-blocker-e-rodada-3-entra-no-teto', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...noTeto('a', 0, 1)), sinais()), tetoDe('a'));
  const r3 = diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'), con('a'), ver('a', 'REPROVADO', 2),
    ini('a', 'correcao'), con('a'), ver('a', 'REPROVADO', 3, 1));
  assert.deepEqual(proximaAcao(plano(['a']), r3, sinais()), tetoDe('a'));
});
test('dono-libera-teto', () => {
  const p = plano(['a']);
  const lib = diario(...noTeto('a'), dono('a'));
  assert.deepEqual(proximaAcao(p, lib, sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] });
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), dono('a'), ...aprovada('a')), sinais()), { tipo: 'integrar', tasks: ['a'] }, 'mesma rodada 1 de antes não colide');
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), dono('a'), ...pronta('a')), sinais()), { tipo: 'concluir' });
});
test('dono-zera-as-rodadas', () => {
  const p = plano(['a']);
  const r1 = diario(...noTeto('a'), dono('a'), ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1));
  assert.deepEqual(proximaAcao(p, r1, sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'correcao' }] });
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), dono('a'), ...noTeto('a')), sinais()), tetoDe('a'), 'teto de novo');
});
test('teto-em-dep-transitiva-apos-dono-libera', () => {
  const p = plano(['a'], ['b', ['a']], ['c', ['b']]);
  const base = [...noTeto('a'), ...aprovada('b'), ...aprovada('c')];
  const lib = diario(...base, dono('a'));
  assert.deepEqual(proximaAcao(p, lib, sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] });
  assert.equal(podeIntegrar(p, lib, 'b'), false);
  assert.equal(podeIntegrar(p, lib, 'c'), false);
  const prontaA = diario(...base, dono('a'), ...pronta('a'));
  assert.equal(podeIntegrar(p, prontaA, 'b'), true);
  assert.equal(podeIntegrar(p, prontaA, 'c'), false);
  const depsSoltas = diario(...noTeto('a'), ...aprovada('b'), dono('a'), ini('a'));
  assert.equal(proximaAcao(p, depsSoltas, sinais({ vivos: 1 })).tipo, 'esperar', 'c não nasce com o teto liberado');
});
test('dono-sem-rodada-anterior-nao-muda-nada', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(dono('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] });
  assert.deepEqual(proximaAcao(plano(['a']), diario(ini('a'), dono('a')), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
  assert.deepEqual(proximaAcao(plano(['a']), diario(...aprovada('a'), dono('a')), sinais()), { tipo: 'integrar', tasks: ['a'] });
  assert.deepEqual(proximaAcao(plano(['a']), diario(...pronta('a'), dono('a')), sinais()), { tipo: 'concluir' });
});
// aprovado com achado e vereditos opostos
test('aprovado-com-achado-invalida', () => {
  for (const [m, b] of [[1, 0], [0, 1]]) {
    const evs = diario(ini('a'), con('a'), ver('a', 'APROVADO', 1, m, b));
    assert.deepEqual(proximaAcao(plano(['a']), evs, sinais()), invalido);
    assert.equal(podeIntegrar(plano(['a']), evs, 'a'), false);
  }
});
test('vereditos-opostos-mesma-rodada-invalida', () => {
  const p = plano(['a']);
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 2), ver('a', 'APROVADO', 1)), sinais()), invalido);
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'APROVADO', 1), ver('a', 'REPROVADO', 1, 1)), sinais()), invalido);
  assert.deepEqual(proximaAcao(p, diario(...noTeto('a'), ver('a', 'APROVADO', 2)), sinais()), tetoDe('a'), 'no teto o veredito é avulso e mantém');
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ver('a', 'APROVADO', 2), ver('a', 'APROVADO', 1)), sinais()), invalido, 'oposto com rodada maior no meio');
});
test('vereditos-opostos-com-correcao-entre-valem', () => {
  const p = plano(['a']);
  const corrigida = [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'), con('a'), ver('a', 'APROVADO', 2)];
  assert.deepEqual(proximaAcao(p, diario(...corrigida), sinais()), { tipo: 'integrar', tasks: ['a'] });
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'APROVADO', 1), ver('a', 'APROVADO', 1)), sinais()), invalido, 'aprovada não tem aresta de veredito');
  const outra = diario(ini('a'), ini('b'), con('a'), con('b'), ver('a', 'REPROVADO', 1, 1), ver('b', 'APROVADO', 1));
  assert.notDeepEqual(proximaAcao(plano(['a'], ['b']), outra, sinais()), invalido, 'por task');
});
// retomada
test('retomada-recomeca-iniciada-sem-concluida', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(ini('a'), retomada('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'implementador' }] });
  assert.equal(proximaAcao(plano(['a']), diario(ini('a'), retomada('a'), ini('a')), sinais({ vivos: 1 })).tipo, 'esperar');
});
test('retomada-nao-libera-teto', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...noTeto('a'), retomada('a')), sinais()), tetoDe('a'));
  assert.equal(podeIntegrar(plano(['a']), diario(...noTeto('a'), retomada('a'), ver('a', 'APROVADO', 3)), 'a'), false);
});
test('retomada-nao-apaga-concluida-nem-veredito', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(ini('a'), con('a'), retomada('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
  const r2 = [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'), con('a'), ver('a', 'REPROVADO', 2)];
  assert.deepEqual(proximaAcao(plano(['a']), diario(...r2, retomada('a')), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
  assert.deepEqual(proximaAcao(plano(['a']), diario(...pronta('a'), retomada('a')), sinais()), { tipo: 'concluir' });
});
test('reaberta-invalida', () => {
  for (const d of [{ task: 'a' }, { task: 'a', origem: 'orquestrador' }, { task: 'zz', origem: 'dono' }, { task: 'zz', origem: 'retomada' }, { origem: 'dono' }]) {
    assert.deepEqual(proximaAcao(plano(['a']), diario(['task.reaberta', d]), sinais()), invalido, JSON.stringify(d));
  }
});
// integrada sem aprovação
test('integrada-sem-aprovacao-invalida', () => {
  const p = plano(['a']);
  const casos = [
    [int('a')],
    [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), int('a')],
    [ini('a'), con('a'), int('a')],
    noTeto('a').concat([int('a')]),
    noTeto('a').concat([con('a'), ver('a', 'APROVADO', 3), int('a')]),
    [...aprovada('a'), con('a'), int('a')],
  ];
  for (const c of casos) {
    assert.deepEqual(proximaAcao(p, diario(...c), sinais()), invalido, JSON.stringify(c));
  }
});
// (8)
test('concluir-exige-todas-integradas', () => {
  const p = plano(['a'], ['b']);
  assert.deepEqual(proximaAcao(p, diario(...pronta('a'), ...pronta('b')), sinais()), { tipo: 'concluir' });
  assert.notEqual(proximaAcao(p, diario(...pronta('a'), ...aprovada('b')), sinais()).tipo, 'concluir');
  assert.notEqual(proximaAcao(p, diario(...pronta('a')), sinais()).tipo, 'concluir');
  assert.deepEqual(proximaAcao(p, diario(...pronta('a'), ...noTeto('b')), sinais()), { tipo: 'parar', motivo: 'teto_rodadas', task: 'b' });
  assert.deepEqual(proximaAcao(p, diario(...pronta('a'), ini('b')), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'b' });
});
// (9)
test('nada-a-fazer-vivos-espera', () => {
  assert.equal(proximaAcao(plano(['a']), diario(...noTeto('a')), sinais({ vivos: 1 })).tipo, 'esperar');
});
test('nada-a-fazer-no-teto-para-com-a-task', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...noTeto('a')), sinais()), { tipo: 'parar', motivo: 'teto_rodadas', task: 'a' });
  assert.deepEqual(proximaAcao(plano(['a']), diario(...noTeto('a', 0, 1)), sinais()), { tipo: 'parar', motivo: 'teto_rodadas', task: 'a' });
});
test('rodada-2-reprovada-sem-major-nao-e-teto', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(...noTeto('a', 0, 0)), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
});
test('orfa-sem-vivos-para-sem-silencio', () => {
  assert.deepEqual(proximaAcao(plano(['a']), diario(ini('a')), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
});
// tabela de estados e transições (rodada 3)
type Par = [TipoEvento, Record<string, unknown>];
const corrigida = (rodada: number, major = 1): Par[] => [ini('a', 'correcao'), con('a'), ver('a', 'REPROVADO', rodada, major)];
/** Eventos que levam uma task 'a' ao estado, dado quantos vereditos já houve (só concluida e em_revisao variam). */
const PREFIXO: Record<EstadoTask, (anterior: number) => { evs: Par[]; rodada: number }> = {
  pendente: () => ({ evs: [], rodada: 0 }),
  implementando: () => ({ evs: [ini('a')], rodada: 0 }),
  concluida: (n) => ({ evs: n === 0 ? [ini('a'), con('a')] : [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao'), con('a')], rodada: n }),
  em_revisao: (n) => ({ evs: [...PREFIXO.concluida(n).evs, ini('a', 'revisor')], rodada: n }),
  reprovada: () => ({ evs: [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1)], rodada: 1 }),
  corrigindo: () => ({ evs: [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao')], rodada: 1 }),
  aprovada: () => ({ evs: aprovada('a'), rodada: 1 }),
  no_teto: () => ({ evs: noTeto('a'), rodada: 2 }),
  integrada: () => ({ evs: pronta('a'), rodada: 1 }),
};
/** Um evento por chave; o veredito declara a rodada que o redutor espera, para só a aresta decidir. */
function eventoDaChave(chave: ChaveEvento, rodadaAtual: number): Par {
  const proxima = rodadaAtual + 1;
  switch (chave) {
    case 'iniciada.implementador': return ini('a');
    case 'iniciada.revisor': return ini('a', 'revisor');
    case 'iniciada.correcao': return ini('a', 'correcao');
    case 'task.concluida': return con('a');
    case 'task.integrada': return int('a');
    case 'veredito.aprovado': return ver('a', 'APROVADO', proxima);
    case 'veredito.aprovado.com_achado': return ver('a', 'APROVADO', proxima, 1);
    case 'veredito.reprovado.r1': return ver('a', 'REPROVADO', 1, 1);
    case 'veredito.reprovado.teto': return ver('a', 'REPROVADO', proxima, 1);
    case 'veredito.reprovado.sem_achado': return ver('a', 'REPROVADO', proxima);
    case 'reaberta.retomada': return retomada('a');
    case 'reaberta.dono': return dono('a');
  }
}
/** Oráculo independente: a tabela escrita por extenso, uma aresta por linha. Alterar `TRANSICOES` exige alterar isto. */
const ARESTAS = `
pendente iniciada.implementador implementando
pendente reaberta.retomada pendente
pendente reaberta.dono pendente
implementando task.concluida concluida
implementando reaberta.retomada pendente
implementando reaberta.dono implementando
concluida iniciada.revisor em_revisao
concluida veredito.aprovado aprovada
concluida veredito.reprovado.r1 reprovada
concluida veredito.reprovado.teto no_teto
concluida veredito.reprovado.sem_achado reprovada
concluida reaberta.retomada concluida
concluida reaberta.dono concluida
em_revisao veredito.aprovado aprovada
em_revisao veredito.reprovado.r1 reprovada
em_revisao veredito.reprovado.teto no_teto
em_revisao veredito.reprovado.sem_achado reprovada
em_revisao reaberta.retomada concluida
em_revisao reaberta.dono em_revisao
reprovada iniciada.correcao corrigindo
reprovada reaberta.retomada reprovada
reprovada reaberta.dono reprovada
corrigindo task.concluida concluida
corrigindo reaberta.retomada reprovada
corrigindo reaberta.dono corrigindo
aprovada task.integrada integrada
aprovada reaberta.retomada aprovada
aprovada reaberta.dono aprovada
no_teto iniciada.implementador no_teto
no_teto iniciada.revisor no_teto
no_teto iniciada.correcao no_teto
no_teto task.concluida no_teto
no_teto veredito.aprovado no_teto
no_teto veredito.aprovado.com_achado no_teto
no_teto veredito.reprovado.r1 no_teto
no_teto veredito.reprovado.teto no_teto
no_teto veredito.reprovado.sem_achado no_teto
no_teto reaberta.retomada no_teto
no_teto reaberta.dono pendente
integrada reaberta.retomada integrada
integrada reaberta.dono integrada
`.trim().split('\n').map((l) => l.split(' ') as [EstadoTask, ChaveEvento, EstadoTask]);
const alvoEsperado = (estado: EstadoTask, chave: ChaveEvento): EstadoTask | undefined => ARESTAS.find(([e, c]) => e === estado && c === chave)?.[2];
test('tabela-igual-ao-oraculo-escrito-por-extenso', () => {
  const real = Object.entries(TRANSICOES).flatMap(([e, arestas]) => Object.entries(arestas).map(([c, a]) => `${e} ${c} ${a}`));
  assert.deepEqual(real.sort(), ARESTAS.map((a) => a.join(' ')).sort());
});
test('tabela-cobre-todos-os-estados-e-aponta-so-para-eles', () => {
  const estados = Object.keys(TRANSICOES);
  assert.deepEqual(Object.keys(PREFIXO).sort(), [...estados].sort());
  for (const [estado, arestas] of Object.entries(TRANSICOES)) {
    for (const [chave, alvo] of Object.entries(arestas)) {
      assert.ok(estados.includes(alvo), `${estado} --${chave}--> ${alvo}`);
      assert.ok((CHAVES_DE_EVENTO as readonly string[]).includes(chave), chave);
    }
  }
});
for (const estado of Object.keys(TRANSICOES) as EstadoTask[]) {
  for (const chave of CHAVES_DE_EVENTO) {
    const esperado = alvoEsperado(estado, chave);
    test(`tabela ${estado} x ${chave} => ${esperado ?? 'invalido'}`, () => {
      const anterior = chave === 'veredito.reprovado.teto' || chave === 'veredito.reprovado.sem_achado' ? 1 : 0;
      const { evs, rodada } = PREFIXO[estado](anterior);
      const chegou = estadoDe(diario(...evs));
      assert.equal('invalido' in chegou ? chegou.invalido : chegou.estado, estado, 'o prefixo leva ao estado');
      const r = estadoDe(diario(...evs, eventoDaChave(chave, rodada)));
      if (esperado === undefined) assert.ok('invalido' in r, JSON.stringify(r));
      else assert.deepEqual(r, { estado: esperado, rodada: esperado === 'pendente' ? 0 : chave.startsWith('veredito.') && estado !== 'no_teto' ? rodada + 1 : rodada });
    });
  }
}
test('estadoDe-rejeita-evento-que-nao-e-de-task', () => {
  assert.ok('invalido' in estadoDe(diario(ci(true))));
  assert.deepEqual(estadoDe([]), { estado: 'pendente', rodada: 0 });
});
test('estadoDe-dono-zera-rodada-e-so-ele', () => {
  assert.deepEqual(estadoDe(diario(...noTeto('a'))), { estado: 'no_teto', rodada: 2 });
  assert.deepEqual(estadoDe(diario(...noTeto('a'), dono('a'))), { estado: 'pendente', rodada: 0 });
  assert.deepEqual(estadoDe(diario(...noTeto('a'), retomada('a'))), { estado: 'no_teto', rodada: 2 });
  assert.deepEqual(estadoDe(diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), dono('a'))), { estado: 'reprovada', rodada: 1 });
});
test('pausa-revisor-retoma', () => {
  const p = plano(['a']);
  const morto = [ini('a'), con('a'), ini('a', 'revisor')];
  const pausa: Par = ['loop.pausa', {}];
  assert.deepEqual(proximaAcao(p, diario(...morto, pausa), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' }, 'sem reabertura não adivinha');
  assert.deepEqual(proximaAcao(p, diario(...morto, pausa, retomada('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] });
  const r2 = [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ...corrigida(2, 0).slice(0, 2), ini('a', 'revisor'), pausa, retomada('a')];
  assert.deepEqual(proximaAcao(p, diario(...r2), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'revisor' }] }, 'rodada 2');
  assert.deepEqual(proximaAcao(p, diario(...morto, pausa, dono('a')), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' }, 'dono não é retomada');
});
test('pausa-correcao-retoma', () => {
  const p = plano(['a']);
  const morta = [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1), ini('a', 'correcao')];
  assert.deepEqual(proximaAcao(p, diario(...morta), sinais()), { tipo: 'parar', motivo: 'nao_conseguiu', task: 'a' });
  assert.deepEqual(proximaAcao(p, diario(...morta, retomada('a')), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'correcao' }] });
  assert.equal(proximaAcao(p, diario(...morta, retomada('a')), sinais({ vivos: 1 })).tipo, 'despachar', 'a tabela não olha vivos: quem grava a reabertura decide');
});
test('aprovado-sem-commit-invalido', () => {
  const p = plano(['a']);
  const semCommit = [
    [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 2), ver('a', 'APROVADO', 2)],
    [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 2), ini('a', 'correcao'), retomada('a'), ver('a', 'APROVADO', 2)],
    [ini('a'), con('a'), ver('a', 'REPROVADO', 1, 2), ini('a', 'correcao'), ver('a', 'APROVADO', 2)],
  ];
  for (const evs of semCommit) {
    assert.deepEqual(proximaAcao(p, diario(...evs), sinais()), invalido, JSON.stringify(evs));
    assert.equal(podeIntegrar(p, diario(...evs), 'a'), false);
  }
  assert.deepEqual(proximaAcao(p, diario(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 2), ...corrigida(2, 0).slice(0, 2), ver('a', 'APROVADO', 2)), sinais()), { tipo: 'integrar', tasks: ['a'] }, 'com commit novo vale');
});
test('vizinho-duas-sessoes-na-mesma-task', () => {
  const p = plano(['a']);
  const i = ev(1, '2026-11-03T00:00:01.000Z', 's1', ...ini('a'));
  const c = ev(2, '2026-11-03T00:00:03.000Z', 's1', ...con('a'));
  const v = ev(1, '2026-11-03T00:00:02.000Z', 's2', ...ver('a', 'APROVADO', 1));
  assert.deepEqual(proximaAcao(p, [i, c, v], sinais()), invalido, 'veredito de s2 intercala antes do commit de s1');
  const v2 = ev(1, '2026-11-03T00:00:04.000Z', 's2', ...ver('a', 'APROVADO', 1));
  assert.deepEqual(proximaAcao(p, [v2, i, c], sinais()), { tipo: 'integrar', tasks: ['a'] }, 'ordem de entrada entre sessões não importa');
});
test('vizinho-rodada-3-apos-dono', () => {
  const p = plano(['a']);
  const apos = (...mais: Par[]) => diario(...noTeto('a'), dono('a'), ...mais);
  assert.deepEqual(proximaAcao(p, apos(ini('a'), con('a'), ver('a', 'REPROVADO', 3, 1)), sinais()), invalido);
  assert.deepEqual(proximaAcao(p, apos(ini('a'), con('a'), ver('a', 'REPROVADO', 1, 1)), sinais()), { tipo: 'despachar', itens: [{ task: 'a', papel: 'correcao' }] });
});
test('vizinho-invalido-em-uma-task-nao-vira-concluir-em-outra', () => {
  const p = plano(['a'], ['b']);
  const evs = diario(...pronta('b'), int('a'));
  assert.deepEqual(proximaAcao(p, evs, sinais()), invalido);
  assert.equal(podeIntegrar(p, diario(...aprovada('b'), int('a')), 'b'), false);
});
test('vizinho-plano-vazio-segue-parar', () => {
  assert.deepEqual(proximaAcao(plano(), [], sinais()), { tipo: 'parar', motivo: 'nao_conseguiu' });
  assert.deepEqual(proximaAcao(plano(), [], sinais({ vivos: 2 })), { tipo: 'parar', motivo: 'nao_conseguiu' });
});
// pureza
test('pura-mesma-entrada-mesma-saida-sem-mutar', () => {
  const p = plano(['a'], ['b']);
  const evs = diario(...aprovada('a'));
  const s = sinais();
  const antes = JSON.stringify([p, evs, s]);
  assert.deepEqual(proximaAcao(p, evs, s), proximaAcao(p, evs, s));
  assert.equal(JSON.stringify([p, evs, s]), antes);
});
test('fonte-sem-node-nem-relogio', () => {
  const fonte = readFileSync(new URL('../src/loop.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /node:|Date\.now|new Date|Math\.random|process\./);
});

/** Testes de proximaAcao, podeIntegrar e ordenar (REQ-LOOP-2). Mutações: task-2o-mut.json. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ordenar, podeIntegrar, proximaAcao } from '../src/loop.ts';
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
test('ts-regride-na-sessao-para', () => {
  const evs = [ev(1, '2026-11-03T00:00:02.000Z', 's1', ...ini('a')), ev(2, '2026-11-03T00:00:01.000Z', 's1', ...con('a'))];
  assert.deepEqual(ordenar(evs), { ok: false });
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
test('maior-rodada-vale-mesmo-chegando-antes', () => {
  const evs = diario(ini('a'), con('a'), ver('a', 'APROVADO', 2), ver('a', 'REPROVADO', 1, 1));
  assert.equal(podeIntegrar(plano(['a']), evs, 'a'), true);
  const evs2 = diario(ini('a'), con('a'), ver('a', 'REPROVADO', 2, 1), ver('a', 'APROVADO', 1));
  assert.equal(podeIntegrar(plano(['a']), evs2, 'a'), false);
  assert.deepEqual(proximaAcao(plano(['a']), evs2, sinais()), { tipo: 'parar', motivo: 'teto_rodadas', task: 'a' });
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
test('integrada-por-decisao-do-dono-libera-a-cadeia', () => {
  const p = plano(['a'], ['b', ['a']]);
  const evs = diario(...noTeto('a'), int('a'), ...aprovada('b'));
  assert.equal(podeIntegrar(p, evs, 'b'), true);
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

/**
 * Testes do núcleo de emendas (GM-11 T3, REQ-EME-1, EME-2). Mutações prescritas (task-3-mut.json):
 *  M3a último julgamento vence · M3b proposta de qualquer sessão · M3c ordenar falha ⇒ estado vazio sem `invalido`
 *  M3d passada única · M3e versaoDoReq conta rejeitada · M3f reqsCongelados inclui aprovadas · M3g escopo soma abertas
 *  M3h colisão só contra task.arquivos · M3i dependência só direta · M3j sem normalizar caminho · M3k J3 removido (M-EME1)
 *  M3l escopo sem aprovadas (escopo-soma-arquivos-aprovados) · M3m V4 removido · M3n J5 removido
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projetarEmendas, versaoDoReq, reqsCongelados, escopoDaTask, validarProposta, validarJulgamento, SESSAO_EMENDAS } from '../src/emenda.ts';
import type { EstadoEmendas } from '../src/emenda.ts';
import { normalizarCaminho } from '../src/plano.ts';
import type { Evento, Plano } from '../src/tipos.ts';

let relogio = 0;
const ts = (n: number) => new Date(Date.UTC(2026, 10, 9, 12, 0, 0) + n * 1000).toISOString();
const ev = (sessao: string, seq: number, tipo: string, dados: unknown, n = relogio++): Evento =>
  ({ seq, ts: ts(n), autor: 'x', sessao, agente: 'a', tipo, dados, hash_anterior: null }) as unknown as Evento;

const prop = (seq: number, extra: Record<string, unknown> = {}, sessao = SESSAO_EMENDAS, n?: number) =>
  ev(sessao, seq, 'emenda.proposta', { req: 'REQ-EME-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', ...extra }, n);
const aprova = (sessao: string, seq: number, proposta_seq: unknown, origem: unknown = 'dono', n?: number) => ev(sessao, seq, 'spec.emendada', { proposta_seq, origem }, n);
const rejeita = (sessao: string, seq: number, proposta_seq: unknown, origem: unknown = 'dono', n?: number) => ev(sessao, seq, 'emenda.rejeitada', { proposta_seq, origem }, n);

const T = (id: string, deps: string[], arquivos: string[], reqs: string[] = ['REQ-EME-1']) => ({ id, deps, arquivos, reqs });
const plano = (...tasks: ReturnType<typeof T>[]): Plano => ({ entrega: 'GM-11', tasks });
const vazio: EstadoEmendas = { abertas: [], aprovadas: [], rejeitadas: [] };
const dadosProp = (extra: Record<string, unknown> = {}) => ({ req: 'REQ-EME-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', ...extra });
const seqs = (ps: { seq: number }[]) => ps.map((p) => p.seq);

test('aberta-aprovada-rejeitada', () => {
  const est = projetarEmendas([prop(1), prop(2), prop(3), aprova('s', 1, 2, 'dono'), rejeita('s', 2, 3, 'sombra')]);
  assert.deepEqual(seqs(est.abertas), [1]);
  assert.deepEqual(est.aprovadas.map((p) => [p.seq, p.origem]), [[2, 'dono']]);
  assert.deepEqual(seqs(est.rejeitadas), [3]);
  assert.equal(est.invalido, undefined);
});

test('segundo-julgamento-ignorado', () => {
  const est = projetarEmendas([prop(1), aprova('s', 1, 1), rejeita('s', 2, 1), aprova('s', 3, 1, 'sombra')]);
  assert.deepEqual(est.aprovadas.map((p) => [p.seq, p.origem]), [[1, 'dono']]);
  assert.deepEqual(est.rejeitadas, []);
});

test('julgamento-misto-rejeitada-depois-emendada', () => {
  const est = projetarEmendas([prop(1), rejeita('s', 1, 1), aprova('s', 2, 1)]);
  assert.deepEqual(seqs(est.rejeitadas), [1]);
  assert.deepEqual(est.aprovadas, []);
  assert.equal(versaoDoReq(est, 'REQ-EME-1'), 0);
});

test('proposta-de-outra-sessao-ignorada', () => {
  const est = projetarEmendas([prop(1, {}, 'loop'), aprova('s', 1, 1)]);
  assert.deepEqual(est, vazio);
  assert.equal(validarJulgamento(est, 1, 'dono', false), 'proposta inexistente');
});

test('diario-ausente-x-corrompido', () => {
  assert.deepEqual(projetarEmendas([]), vazio); // ausente: vazio, sem `invalido`
  // evento de proposta sem `dados`: corrompido, ignorado; o diário em si está em ordem
  const semDados = ev(SESSAO_EMENDAS, 1, 'emenda.proposta', undefined);
  assert.deepEqual(projetarEmendas([semDados]), vazio);
  // diário fora de ordem: corrompido de outro tipo, distinto do vazio
  const est = projetarEmendas([prop(2), prop(2)]);
  assert.equal(est.invalido, 'diário fora de ordem');
  assert.notDeepEqual(est, projetarEmendas([]));
});

test('diario-fora-de-ordem-invalido', () => {
  const est = projetarEmendas([prop(1), { ...prop(2), ts: 'ontem' }]);
  assert.equal(est.invalido, 'diário fora de ordem');
  assert.deepEqual([est.abertas, est.aprovadas, est.rejeitadas], [[], [], []]);
  assert.equal(validarProposta(plano(T('t', [], [])), est, dadosProp()), 'diário fora de ordem');
  assert.equal(validarJulgamento(est, 1, 'dono', true), 'diário fora de ordem');
  assert.equal(reqsCongelados(est).size, 0);
  assert.equal(projetarEmendas([prop(3), prop(2)]).invalido, 'diário fora de ordem'); // seq decrescente na sessão
  assert.equal(projetarEmendas([{ ...prop(1), sessao: 7 } as unknown as Evento]).invalido, 'diário fora de ordem');
});

test('julgamento-forma-invalida-nao-fecha', () => {
  const est = projetarEmendas([prop(1), aprova('s', 1, 1, 'x'), aprova('s', 2, '1'), aprova('s', 3, 1.5), aprova('s', 4, 0), aprova('s', 5, 1, 'sombra')]);
  assert.deepEqual(est.aprovadas.map((p) => [p.seq, p.origem]), [[1, 'sombra']]);
  assert.equal(projetarEmendas([prop(1), aprova('s', 1, 1, 'x')]).abertas.length, 1);
});

test('julgamento-de-proposta-invalida-ignorado', () => {
  const invalida = prop(1, { causa: 'qualquer' });
  const est = projetarEmendas([invalida, prop(2, {}, 'loop'), aprova('s', 1, 1), aprova('s', 2, 2), aprova('s', 3, 99)]);
  assert.deepEqual(est, vazio);
});

test('julgamento-empate-ts-sessao-menor-fecha', () => {
  // mesmo ts: a sessão `0abc` vem antes de `emendas` em `ordenar`, e o julgamento antecede a proposta
  const est = projetarEmendas([ev('0abc', 1, 'spec.emendada', { proposta_seq: 1, origem: 'dono' }, 5), prop(1, {}, SESSAO_EMENDAS, 5)]);
  assert.deepEqual(seqs(est.aprovadas), [1]);
  assert.deepEqual(est.abertas, []);
});

test('proposta-sessao-falsa-seq-repetido-invalido', () => {
  // evento de proposta forjado em outro arquivo, no corpo `sessao:'emendas'` com seq que já existe
  const est = projetarEmendas([prop(1), prop(1)]);
  assert.equal(est.invalido, 'diário fora de ordem');
});

test('versao-do-req', () => {
  const est = projetarEmendas([prop(1), prop(2), aprova('s', 1, 1), aprova('s', 2, 2)]);
  assert.equal(versaoDoReq(est, 'REQ-EME-1'), 2);
  assert.equal(versaoDoReq(est, 'REQ-OUTRO-1'), 0);
  assert.equal(versaoDoReq(vazio, 'REQ-EME-1'), 0);
});

test('versao-segue-ordem-do-julgamento', () => {
  const est = projetarEmendas([prop(1), prop(2), prop(3), prop(4), prop(5), aprova('s', 1, 5), aprova('s', 2, 3)]);
  assert.equal(versaoDoReq(est, 'REQ-EME-1'), 3);
});

test('versao-ignora-rejeitada-e-outro-req', () => {
  const est = projetarEmendas([
    prop(1), prop(2), prop(3, { req: 'REQ-X-1' }), prop(4),
    aprova('s', 1, 1), rejeita('s', 2, 2), aprova('s', 3, 3),
  ]);
  assert.equal(versaoDoReq(est, 'REQ-EME-1'), 1); // 2 rejeitada, 3 é de outro REQ, 4 aberta
  assert.equal(versaoDoReq(est, 'REQ-X-1'), 3);
});

test('congelados-so-abertas', () => {
  const est = projetarEmendas([prop(1), prop(2, { req: 'REQ-B-1' }), prop(3, { req: 'REQ-C-1' }), aprova('s', 1, 1), rejeita('s', 2, 2)]);
  assert.deepEqual([...reqsCongelados(est)], ['REQ-C-1']);
});

test('escopo-soma-arquivos-aprovados', () => {
  const p = plano(T('t1', [], ['a.ts']));
  const est = projetarEmendas([prop(1, { task: 't1', arquivos: ['x.ts'] }), aprova('s', 1, 1)]);
  assert.deepEqual(escopoDaTask(p, est, 't1'), ['a.ts', 'x.ts']);
});

test('escopo-ignora-aprovada-de-outra-task', () => {
  const p = plano(T('t1', [], ['a.ts']), T('t2', [], ['b.ts']));
  const est = projetarEmendas([prop(1, { task: 't2', arquivos: ['x.ts'] }), aprova('s', 1, 1)]);
  assert.deepEqual(escopoDaTask(p, est, 't1'), ['a.ts']);
  assert.deepEqual(escopoDaTask(p, est, 't2'), ['b.ts', 'x.ts']);
});

test('escopo-ignora-aberta-e-rejeitada', () => {
  const p = plano(T('t1', [], ['a.ts']));
  const est = projetarEmendas([prop(1, { task: 't1', arquivos: ['x.ts'] }), prop(2, { task: 't1', arquivos: ['y.ts'] }), rejeita('s', 1, 2)]);
  assert.deepEqual(escopoDaTask(p, est, 't1'), ['a.ts']);
});

test('escopo-normaliza-e-deduplica', () => {
  const p = plano(T('t1', [], ['a.ts']));
  const est = projetarEmendas([prop(1, { task: 't1', arquivos: ['./a.ts', 'src//x.ts', 'src/x.ts', '../fora.ts'] }), aprova('s', 1, 1)]);
  assert.deepEqual(escopoDaTask(p, est, 't1'), ['a.ts', 'src/x.ts']);
  // a proposta ficou (o caminho inválido é descartado, a proposta não)
  assert.deepEqual(seqs(est.aprovadas), [1]);
});

test('escopo-task-fora-do-plano-vazio', () => {
  const est = projetarEmendas([prop(1, { task: 'fantasma', arquivos: ['x.ts'] }), aprova('s', 1, 1)]);
  assert.deepEqual(escopoDaTask(plano(T('t1', [], ['a.ts'])), est, 'fantasma'), []);
});

test('normalizacao-igual-a-do-plano', () => {
  for (const c of ['./a.ts', 'a//b.ts', 'a/../b.ts', 'dir/', '../x', '/abs', '', 'C:\\x']) {
    const p = plano(T('t1', [], []));
    const est = projetarEmendas([prop(1, { task: 't1', arquivos: [c] }), aprova('s', 1, 1)]);
    const esperado = normalizarCaminho(c);
    assert.deepEqual(escopoDaTask(p, est, 't1'), esperado === null ? [] : [esperado], c);
  }
});

const PL = plano(T('t1', [], ['a.ts']), T('t2', [], ['b.ts']));

test('proposta-arquivo-colide-sem-dep-recusa', () => {
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 't1', arquivos: ['b.ts'] })), 'arquivo b.ts colide com t2 sem dependência');
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 't1', arquivos: ['./b.ts'] })), 'arquivo b.ts colide com t2 sem dependência');
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 't1', arquivos: ['livre.ts'] })), null);
});

test('proposta-arquivo-com-dep-ok', () => {
  const p = plano(T('t1', [], ['a.ts']), T('t2', ['t1'], ['b.ts']));
  assert.equal(validarProposta(p, vazio, dadosProp({ task: 't2', arquivos: ['a.ts'] })), null);
});

test('proposta-arquivo-dep-transitiva-ok', () => {
  const p = plano(T('t1', [], ['a.ts']), T('t2', ['t1'], ['b.ts']), T('t3', ['t2'], ['c.ts']));
  assert.equal(validarProposta(p, vazio, dadosProp({ task: 't3', arquivos: ['a.ts'] })), null);
});

test('proposta-colide-com-escopo-emendado', () => {
  const est = projetarEmendas([prop(1, { task: 't1', arquivos: ['x.ts'] }), aprova('s', 1, 1)]);
  assert.equal(validarProposta(PL, est, dadosProp({ task: 't2', arquivos: ['x.ts'] })), 'arquivo x.ts colide com t1 sem dependência');
});

test('proposta-colide-com-aberta-de-outra-task', () => {
  const est = projetarEmendas([prop(1, { task: 't1', arquivos: ['x.ts'] })]);
  assert.equal(validarProposta(PL, est, dadosProp({ task: 't2', arquivos: ['x.ts'] })), 'arquivo x.ts colide com t1 sem dependência');
  // rejeitada não segura o arquivo
  const rej = projetarEmendas([prop(1, { task: 't1', arquivos: ['x.ts'] }), rejeita('s', 1, 1)]);
  assert.equal(validarProposta(PL, rej, dadosProp({ task: 't2', arquivos: ['x.ts'] })), null);
});

test('proposta-arquivos-sem-task-recusa', () => {
  assert.equal(validarProposta(PL, vazio, dadosProp({ arquivos: ['x.ts'] })), 'arquivos exigem task');
  assert.equal(validarProposta(PL, vazio, dadosProp({ arquivos: [] })), null);
  assert.equal(validarProposta(PL, vazio, dadosProp()), null);
});

test('proposta-caminho-invalido-recusa', () => {
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 't1', arquivos: ['../x'] })), 'caminho inválido: ../x');
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 't1', arquivos: ['/x'] })), 'caminho inválido: /x');
});

test('proposta-req-fora-da-task-recusa', () => {
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 't1', req: 'REQ-OUTRO-1' })), 'req fora da task');
  assert.equal(validarProposta(PL, vazio, dadosProp({ task: 'nao-existe' })), 'task fora do plano');
});

test('proposta-task-sem-reqs-recusa', () => {
  const p: Plano = { entrega: 'GM-11', tasks: [{ id: 't1', deps: [], arquivos: ['a.ts'] }] };
  assert.equal(validarProposta(p, vazio, dadosProp({ task: 't1' })), 'req fora da task');
});

test('proposta-forma-invalida-recusa', () => {
  assert.match(validarProposta(PL, vazio, dadosProp({ causa: 'x' })) ?? '', /causa/);
  assert.match(validarProposta(PL, vazio, { req: 'REQ-EME-1' }) ?? '', /ausente/);
  assert.match(validarProposta(PL, vazio, 'texto' as unknown as Record<string, unknown>) ?? '', /corrompido/);
  assert.match(validarProposta(PL, vazio, undefined as unknown as Record<string, unknown>) ?? '', /ausente/);
});

test('julgar-inexistente-recusa', () => {
  assert.equal(validarJulgamento(vazio, 7, 'dono', false), 'proposta inexistente');
});

test('julgar-ja-julgada-recusa', () => {
  const est = projetarEmendas([prop(1), prop(2), aprova('s', 1, 1), rejeita('s', 2, 2)]);
  assert.equal(validarJulgamento(est, 1, 'dono', false), 'proposta já julgada');
  assert.equal(validarJulgamento(est, 2, 'dono', false), 'proposta já julgada');
});

test('julgar-sombra-sem-flag-recusa', () => {
  const est = projetarEmendas([prop(1)]);
  assert.match(validarJulgamento(est, 1, 'sombra', false) ?? '', /julga_emendas/);
});

test('julgar-sombra-com-flag-ok', () => {
  assert.equal(validarJulgamento(projetarEmendas([prop(1)]), 1, 'sombra', true), null);
});

test('julgar-dono-sem-flag-ok', () => {
  assert.equal(validarJulgamento(projetarEmendas([prop(1)]), 1, 'dono', false), null);
});

test('julgar-seq-nao-inteiro-recusa', () => {
  const est = projetarEmendas([prop(1)]);
  for (const s of [0, -1, 1.5, '1', NaN, null]) assert.match(validarJulgamento(est, s as number, 'dono', true) ?? '', /proposta_seq/, String(s));
});

test('julgar-origem-fora-do-enum-recusa', () => {
  assert.match(validarJulgamento(projetarEmendas([prop(1)]), 1, 'x' as never, true) ?? '', /origem/);
});

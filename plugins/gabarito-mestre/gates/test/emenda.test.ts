/**
 * Testes do núcleo de emendas (GM-11 T3, REQ-EME-1, EME-2). Mutações prescritas (task-3-mut.json):
 *  M3a último julgamento vence · M3b proposta de qualquer sessão · M3c ordenar falha ⇒ estado vazio sem `invalido`
 *  M3d passada única (R1 do review) · M3e versaoDoReq conta rejeitada · M3f reqsCongelados inclui aprovadas · M3g escopo soma abertas
 *  M3h colisão só contra task.arquivos · M3i dependência só direta · M3j sem normalizar caminho · M3k J3 removido (M-EME1)
 *  M3l escopo sem aprovadas (escopo-soma-arquivos-aprovados) · M3m V4 removido · M3n J5 removido
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quemRedigeNaAncora, projetarEmendas, fecharJulgamentos, versaoDoReq, reqsCongelados, escopoDaTask, validarProposta, validarJulgamento, pontaDaSpec, shaAceito, validarAplicacao, SESSAO_EMENDAS } from '../src/emenda.ts';
import type { EstadoEmendas } from '../src/emenda.ts';
import { normalizarCaminho, validarPlano } from '../src/plano.ts';
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

test('d-g15-sombra-nao-reverte-a-propria-rejeicao: 2º julgamento da SOMBRA depois da rejeição dela não reverte (só o dono), aprovando ou rejeitando', () => {
  for (const segundo of [aprova('s', 2, 1, 'sombra'), rejeita('s', 2, 1, 'sombra')]) {
    const est = projetarEmendas([prop(1), rejeita('s', 1, 1, 'sombra'), segundo]);
    assert.deepEqual(est.rejeitadas.map((p) => [p.seq, p.rejeitadaPor]), [[1, 'sombra']]);
    assert.deepEqual(est.aprovadas, []);
  }
  // controle: o dono reverte
  const rev = projetarEmendas([prop(1), rejeita('s', 1, 1, 'sombra'), aprova('s', 2, 1, 'dono')]);
  assert.deepEqual(rev.aprovadas.map((p) => [p.seq, p.origem]), [[1, 'dono']]);
  assert.deepEqual(rev.rejeitadas, []);
});

test('fecharJulgamentos (regra única): cada condição da exceção tem mutação morta (rejeição, origem sombra, julgador dono)', () => {
  const f = (...e: Evento[]) => [...fecharJulgamentos(e)].map(([k, v]) => [k, v.aprova, v.origem]);
  assert.deepEqual(f(rejeita('s', 1, 1, 'sombra'), aprova('s', 2, 1, 'dono')), [[1, true, 'dono']], 'dono reverte rejeição da sombra');
  assert.deepEqual(f(rejeita('s', 1, 1, 'dono'), aprova('s', 2, 1, 'dono')), [[1, false, 'dono']], 'rejeição do dono é final');
  // GM-15 T36 (D-G18, emenda 24 m.3): o dono reverte também a APROVAÇÃO da Sombra; a aprovação do dono segue final
  assert.deepEqual(f(aprova('s', 1, 1, 'sombra'), rejeita('s', 2, 1, 'dono')), [[1, false, 'dono']], 'dono reverte a aprovação da sombra');
  assert.deepEqual(f(aprova('s', 1, 1, 'sombra'), aprova('s', 2, 1, 'sombra')), [[1, true, 'sombra']], 'sombra não reverte a própria aprovação');
  assert.deepEqual(f(aprova('s', 1, 1, 'dono'), rejeita('s', 2, 1, 'dono')), [[1, true, 'dono']], 'aprovação do dono é final');
  assert.deepEqual(f(rejeita('s', 1, 1, 'sombra'), aprova('s', 2, 1, 'sombra'), aprova('s', 3, 1, 'dono')), [[1, true, 'dono']], 'corrida: Sombra rejeita, 2ª Sombra aprova, dono aprova ⇒ fecha o dono');
  assert.deepEqual(f(rejeita('s', 1, 1, 'sombra'), rejeita('s', 2, 1, 'sombra')), [[1, false, 'sombra']], 'sombra não reverte');
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

test('colisao-com-nome-de-unidade-nao-escapa (r2 MAJOR 1, repro .claude-tmp/review-t6/colisao.mjs)', () => {
  for (const bruto of ['./a:b', './C:\\x']) {
    // o plano não guarda caminho cuja forma normalizada seria descartada na re-normalização de `escopoDaTask`
    const r = validarPlano(plano(T('T1', [], [bruto]), T('T2', [], ['z'])));
    assert.equal(r.ok, false, `plano com ${bruto} deve ser recusado`);
    // e a proposta que toca o mesmo caminho não passa em silêncio
    const p2 = plano(T('T1', [], ['q']), T('T2', [], ['z']));
    assert.notEqual(validarProposta(p2, vazio, dadosProp({ task: 'T2', arquivos: [bruto] })), null, bruto);
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

test('t36-dono-reverte-emenda-aprovada-pela-sombra (D-G18): validarJulgamento aceita o dono sobre a aprovação da Sombra, e só ele', () => {
  const est = projetarEmendas([prop(1), aprova('s', 1, 1, 'sombra')]);
  assert.equal(validarJulgamento(est, 1, 'dono', false), null);
  assert.equal(validarJulgamento(est, 1, 'sombra', true), 'proposta já julgada', 'a Sombra não revê a própria aprovação');
  const feita = projetarEmendas([prop(1), aprova('s', 1, 1, 'sombra'), rejeita('s', 2, 1, 'dono')]);
  assert.equal(validarJulgamento(feita, 1, 'dono', false), 'proposta já julgada', 'depois do dono, final');
  const doDono = projetarEmendas([prop(1), aprova('s', 1, 1, 'dono')]);
  assert.equal(validarJulgamento(doDono, 1, 'dono', false), 'proposta já julgada', 'aprovação do dono é final');
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

test('proposta-projetada-com-todos-os-campos', () => {
  // P15: cada campo da proposta projetada é lido, aberta e aprovada; diff, fato e causa distintos para trocar um pelo outro cair.
  const p1 = prop(1, { diff: 'DIFF-1', fato: 'FATO-1', causa: 'regra_negocio', task: 't1', arquivos: ['./src//a.ts'] }, SESSAO_EMENDAS, 10);
  const p2 = prop(2, { diff: 'DIFF-2', fato: 'FATO-2', causa: 'tecnica', req: 'REQ-B-1' }, SESSAO_EMENDAS, 20);
  const est = projetarEmendas([p1, p2, aprova('s', 1, 1, 'sombra', 30)]);
  assert.deepEqual(est.aprovadas, [{ seq: 1, req: 'REQ-EME-1', task: 't1', diff: 'DIFF-1', fato: 'FATO-1', alternativa: 'a', arquivos: ['src/a.ts'], causa: 'regra_negocio', ts: ts(10), origem: 'sombra' }]);
  assert.deepEqual(est.abertas, [{ seq: 2, req: 'REQ-B-1', diff: 'DIFF-2', fato: 'FATO-2', alternativa: 'a', arquivos: [], causa: 'tecnica', ts: ts(20) }]);
  const rej = projetarEmendas([p1, rejeita('s', 1, 1, 'dono', 30)]);
  assert.deepEqual(rej.rejeitadas, [{ seq: 1, req: 'REQ-EME-1', task: 't1', diff: 'DIFF-1', fato: 'FATO-1', alternativa: 'a', arquivos: ['src/a.ts'], causa: 'regra_negocio', ts: ts(10), rejeitadaPor: 'dono' }]);
  assert.equal(rej.invalido, undefined);
  assert.equal(est.invalido, undefined);
});

// ───────────────────────────────────────────────────────────── GM-15 T11 (REQ-EME-3 B): fato, alternativa e a 3ª proposta

test('t11-proposta-carrega-fato-e-alternativa-e-origem', () => {
  const est = projetarEmendas([prop(1, { fato: 'FATO-X', alternativa: 'ALT-Y' }), prop(2, { origem: 'sombra' })]);
  assert.deepEqual(est.abertas.map((p) => [p.fato, p.alternativa, p.origem]), [['FATO-X', 'ALT-Y', undefined], ['f', 'a', 'sombra']]);
});

const rejeitadas2 = (extra: Record<string, unknown> = {}) =>
  projetarEmendas([prop(1, extra), prop(2, extra), rejeita('s', 1, 1, 'dono'), rejeita('s', 2, 2, 'dono')]);

test('t11-terceira-proposta-do-orquestrador-recusa-na-mesma-ancora', () => {
  const um = projetarEmendas([prop(1), rejeita('s', 1, 1)]);
  assert.equal(validarProposta(plano(T('t', [], [])), um, dadosProp()), null, 'a 2ª proposta passa');
  const dois = rejeitadas2();
  assert.equal(validarProposta(plano(T('t', [], [])), dois, dadosProp()), 'terceira proposta do orquestrador na mesma âncora: a Sombra redige o texto (origem sombra)');
  // outra âncora (outro REQ) não é afetada
  assert.equal(validarProposta(plano(T('t', [], []), T('u', [], [], ['REQ-EME-2'])), dois, dadosProp({ req: 'REQ-EME-2' })), null);
});

test('ancora-por-req-ignora-task', () => {
  // Emenda 13 (REQ-EME-3): a âncora é só o REQ; trocar ou omitir --task não zera a contagem de rejeições do orquestrador.
  const dois = rejeitadas2({ task: 't1' });
  const pl = plano(T('t1', [], ['a.ts']), T('t2', [], ['b.ts']));
  const terceira = 'terceira proposta do orquestrador na mesma âncora: a Sombra redige o texto (origem sombra)';
  assert.equal(validarProposta(pl, dois, dadosProp({ task: 't1' })), terceira, 'mesma task e REQ');
  assert.equal(validarProposta(pl, dois, dadosProp({ task: 't2' })), terceira, 'outra task, mesmo REQ');
  assert.equal(validarProposta(pl, dois, dadosProp()), terceira, 'sem task, mesmo REQ');
  // 1 rejeição com task e 1 sem task somam 2 na mesma âncora (o REQ)
  const misto = projetarEmendas([prop(1, { task: 't1' }), prop(2), rejeita('s', 1, 1), rejeita('s', 2, 2)]);
  assert.equal(validarProposta(pl, misto, dadosProp({ task: 't2' })), terceira, 'rejeições com e sem task somam');
  assert.equal(validarProposta(pl, misto, dadosProp({ origem: 'sombra' })), null, 'a Sombra redige na âncora do REQ, com ou sem task');
});

test('t11-sombra-so-redige-depois-da-segunda-rejeicao', () => {
  const um = projetarEmendas([prop(1), rejeita('s', 1, 1)]);
  assert.equal(validarProposta(plano(T('t', [], [])), um, dadosProp({ origem: 'sombra' })), 'origem sombra só depois da 2ª rejeição da mesma âncora');
  assert.equal(validarProposta(plano(T('t', [], [])), vazio, dadosProp({ origem: 'sombra' })), 'origem sombra só depois da 2ª rejeição da mesma âncora');
  assert.equal(validarProposta(plano(T('t', [], [])), rejeitadas2(), dadosProp({ origem: 'sombra' })), null);
});

test('t11-rejeicao-de-proposta-da-sombra-nao-conta-para-o-orquestrador', () => {
  const est = projetarEmendas([prop(1), prop(2, { origem: 'sombra' }), rejeita('s', 1, 1), rejeita('s', 2, 2)]);
  assert.equal(validarProposta(plano(T('t', [], [])), est, dadosProp()), null, 'só 1 rejeição do orquestrador');
});

test('rejeicao-da-redacao-da-sombra-vai-ao-dono', () => {
  // Emenda 13 (REQ-EME-3): proposta `origem: sombra` rejeitada vai ao dono; a Sombra não repropõe no mesmo REQ (o orquestrador já está na 3ª).
  const pl = plano(T('t1', [], ['a.ts']), T('u', [], [], ['REQ-EME-2']));
  const est = projetarEmendas([prop(1), prop(2), rejeita('s', 1, 1), rejeita('s', 2, 2), prop(3, { origem: 'sombra' }), rejeita('s', 3, 3)]);
  const aoDono = 'redação da Sombra rejeitada nesta âncora: vai ao dono (a Sombra não repropõe)';
  assert.equal(validarProposta(pl, est, dadosProp({ origem: 'sombra' })), aoDono, 'a Sombra não repropõe');
  assert.equal(validarProposta(pl, est, dadosProp({ origem: 'sombra', task: 't1' })), aoDono, 'nem trocando a task');
  assert.match(validarProposta(pl, est, dadosProp()) ?? '', /^terceira proposta do orquestrador/, 'nem o orquestrador');
  // aberta (ainda não julgada) não é rejeição: a Sombra ainda não foi recusada
  const aberta = projetarEmendas([prop(1), prop(2), rejeita('s', 1, 1), rejeita('s', 2, 2), prop(3, { origem: 'sombra' })]);
  assert.equal(validarProposta(pl, aberta, dadosProp({ origem: 'sombra' })), null, 'só a rejeitada trava');
  // outra âncora segue livre
  assert.equal(validarProposta(pl, est, dadosProp({ req: 'REQ-EME-2' })), null);
});

test('t26-quem-redige-na-ancora: só por REQ; orquestrador até 2 rejeições, Sombra redige, rejeitada a Sombra vai ao dono', () => {
  const q = (...e: Evento[]) => quemRedigeNaAncora(projetarEmendas(e), 'REQ-EME-1');
  assert.deepEqual(q(), { quem: 'orquestrador', rejeicoes: 0 });
  assert.equal(q(prop(1), rejeita('s', 1, 1)).quem, 'orquestrador');
  assert.deepEqual(q(prop(1), prop(2, { task: 't' }), rejeita('s', 1, 1), rejeita('s', 2, 2)), { quem: 'sombra', rejeicoes: 2 });
  assert.equal(q(prop(1), prop(2), prop(3, { origem: 'sombra' }), rejeita('s', 1, 1), rejeita('s', 2, 2), rejeita('s', 3, 3)).quem, 'dono');
  const outro = projetarEmendas([prop(1, { req: 'REQ-EME-2' }), prop(2, { req: 'REQ-EME-2' }), rejeita('s', 1, 1), rejeita('s', 2, 2)]);
  assert.equal(quemRedigeNaAncora(outro, 'REQ-EME-1').quem, 'orquestrador', 'outro REQ não conta');
});

test('t26-sombra-rejeitada-em-outro-req-nao-prende-esta-ancora', () => {
  const est = projetarEmendas([
    prop(1, { req: 'REQ-EME-2' }), prop(2, { req: 'REQ-EME-2', origem: 'sombra' }), rejeita('s', 2, 2), // Sombra rejeitada no REQ-EME-2
    prop(3), prop(4), rejeita('s', 3, 3), rejeita('s', 4, 4), // 2 rejeições do orquestrador no REQ-EME-1
  ]);
  assert.deepEqual(quemRedigeNaAncora(est, 'REQ-EME-1'), { quem: 'sombra', rejeicoes: 2 });
  assert.equal(validarProposta(plano(T('t', [], [])), est, dadosProp({ origem: 'sombra' })), null, 'a Sombra ainda redige no REQ-EME-1');
});

test('t26-mensagem-dono-nao-manda-a-sombra-redigir', () => {
  const est = projetarEmendas([prop(1), prop(2), prop(3, { origem: 'sombra' }), rejeita('s', 1, 1), rejeita('s', 2, 2), rejeita('s', 3, 3)]);
  const m = validarProposta(plano(T('t', [], [])), est, dadosProp()) ?? '';
  assert.match(m, /vai ao dono/);
  assert.ok(!m.includes('Sombra redige'), m);
  const so2 = projetarEmendas([prop(1), prop(2), rejeita('s', 1, 1), rejeita('s', 2, 2)]);
  assert.match(validarProposta(plano(T('t', [], [])), so2, dadosProp()) ?? '', /a Sombra redige o texto/, 'quem=sombra mantém a mensagem');
});

// ── GM-15 T36 r1 MAJOR-3 (emenda 25 m.4, D-G19): o dono reverte emenda JÁ aplicada ⇒ vale e a spec fica divergente ────────────────────────────────────────────────
const SA = 'a'.repeat(64);
const SB = 'b'.repeat(64);
const SC = 'c'.repeat(64);
const SD = 'd'.repeat(64);
const aprovadaSpec = (seq: number, sha = SA) => ev('dono', seq, 'spec.aprovada', { spec: 'docs/s.md', sha256: sha });
const aplicada = (seq: number, emenda: number, antes: string, depois: string, extra: Record<string, unknown> = {}) =>
  ev('loop', seq, 'spec.aplicada', { seq: emenda, spec: 'docs/s.md', sha256_antes: antes, sha256_depois: depois, ...extra });
/** spec A aprovada, emenda 1 aprovada pela SOMBRA e aplicada (A ⇒ B). */
const aplicadaB = () => [aprovadaSpec(1), prop(1), aprova('sombra', 1, 1, 'sombra'), aplicada(1, 1, SA, SB)];
const revertida = () => [...aplicadaB(), rejeita('dono', 2, 1, 'dono')];

test('reverter-apos-aplicada-vale-e-diverge: o dono rejeita a aprovação da Sombra depois do spec.aplicada ⇒ a reversão vale, a cadeia segue o arquivo (B) e a projeção marca divergente {seq, sha_aplicado}', () => {
  const est = projetarEmendas(aplicadaB());
  assert.equal(validarJulgamento(est, 1, 'dono', true), null, 'o dono reverte mesmo depois de aplicada');
  assert.match(validarJulgamento(est, 1, 'sombra', true) ?? '', /já julgada/, 'a Sombra não');
  const antes = pontaDaSpec(aplicadaB());
  assert.equal(antes.divergente, null, 'enquanto a aprovação vale não há divergência');
  const r = pontaDaSpec(revertida());
  assert.deepEqual(r.divergente, { seq: 1, sha_aplicado: SB });
  assert.equal(r.ponta?.sha256, SB, 'a cadeia não quebra: o texto segue no arquivo');
  assert.equal(shaAceito(revertida(), SB), true);
  assert.equal(projetarEmendas(revertida()).rejeitadas[0].rejeitadaPor, 'dono');
});

test('desfazer-fecha-divergencia: spec.aplicada com reverte (antes = ponta, depois ≠ sha_aplicado) encerra a divergência; sem ela, ou torta, ela segue', () => {
  const desfaz = aplicada(2, 1, SB, SC, { reverte: true });
  const ok = pontaDaSpec([...revertida(), desfaz]);
  assert.equal(ok.divergente, null);
  assert.equal(ok.ponta?.sha256, SC);
  assert.deepEqual(ok.aplicacoes.map((a) => [a.seq, a.reverte === true]), [[1, false], [1, true]]);
  const segue = (...extra: Evento[]) => pontaDaSpec([...revertida(), ...extra]).divergente;
  assert.deepEqual(segue(), { seq: 1, sha_aplicado: SB }, 'sem novo spec.aplicada a divergência não some');
  assert.deepEqual(segue(aplicada(2, 1, SB, SC)), { seq: 1, sha_aplicado: SB }, 'aplicada sem reverte da mesma seq (já aplicada) não desfaz');
  assert.deepEqual(segue(aplicada(2, 1, SB, SB, { reverte: true })), { seq: 1, sha_aplicado: SB }, 'depois = sha_aplicado: nada foi desfeito');
  assert.deepEqual(segue(aplicada(2, 1, SA, SC, { reverte: true })), { seq: 1, sha_aplicado: SB }, 'antes fora da ponta');
  assert.deepEqual(segue(aplicada(2, 9, SB, SC, { reverte: true })), { seq: 1, sha_aplicado: SB }, 'reverte de seq que não foi aplicada');
  assert.deepEqual(segue(aplicada(2, 1, SB, SC, { reverte: false })), { seq: 1, sha_aplicado: SB }, 'reverte só vale true (e a forma recusa)');
  // aprovação nova do dono (ele aprovou o texto de agora) também encerra
  assert.equal(pontaDaSpec([...revertida(), aprovadaSpec(3, SD)]).divergente, null);
  // a reversão que NÃO foi depois de aplicada não gera divergência (o dono rejeita a aprovação da Sombra antes de aplicar)
  assert.equal(pontaDaSpec([aprovadaSpec(1), prop(1), aprova('sombra', 1, 1, 'sombra'), rejeita('dono', 2, 1, 'dono')]).divergente, null);
});

test('validarAplicacao-desfazer: a emenda aplicada e revertida pelo dono aceita o desfazer 1 vez (reverte:true, com o sha_aplicado); rejeição que nunca foi aplicada segue recusada', () => {
  const v = validarAplicacao(revertida(), 1);
  assert.deepEqual(v.ok && [v.ponta.sha256, v.reverte, v.sha_aplicado], [SB, true, SB]);
  const feito = validarAplicacao([...revertida(), aplicada(2, 1, SB, SC, { reverte: true })], 1);
  assert.deepEqual(feito, { ok: false, motivo: 'ja_aplicada' });
  assert.deepEqual(validarAplicacao([aprovadaSpec(1), prop(1), rejeita('dono', 2, 1, 'dono')], 1), { ok: false, motivo: 'emenda_nao_aprovada' });
  assert.deepEqual(validarAplicacao([aprovadaSpec(1), prop(1), prop(2), aprova('sombra', 1, 1, 'sombra'), rejeita('dono', 2, 1, 'dono')], 1), { ok: false, motivo: 'emenda_nao_aprovada' }, 'revertida mas nunca aplicada');
  // a emenda aprovada e aplicada segue recusada na 2ª aplicação (ja_aplicada), como antes
  assert.deepEqual(validarAplicacao(aplicadaB(), 1), { ok: false, motivo: 'ja_aplicada' });
});

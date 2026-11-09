/**
 * Testes do núcleo da Sombra (GM-11 T2). Mutações prescritas (.superpowers/sdd/2026-11-09-e3-sombra/task-2-mut.json):
 *  M-SOM1   hash sem `versao` ⇒ `hash-muda-com-versao` falha
 *  M-SOM4a  contar `decisao.sombra` como consulta ⇒ `cache-nao-conta-no-teto` falha
 *  M-S1     normalizar sem NFC ⇒ `normaliza-caixa-espaco-quebra-nfc` falha
 *  M-S2     separador do hash trocado por espaço ⇒ `hash-separador-sem-colisao` falha
 *  M-S3     vigente pela ordem de chegada, não por `(ts, sessao)` ⇒ `vigente-mais-recente-ts-sessao` falha
 *  M-S4     projeção sem `formaInvalida` ⇒ `decisao-forma-invalida-ignorada` falha
 *  M-S5     `trechoDoReq` por prefixo ⇒ `trecho-req-exato-nao-pega-prefixo` falha
 *  M-S6     diário fora de ordem aceito ⇒ `diario-fora-de-ordem-nao-adivinha` falha
 *  M-S7     brief com `mutacoes` da task ⇒ `brief-sem-campo-livre` falha
 *  M-S8     pergunta vazia vira hash ⇒ `pergunta-vazia-recusa` falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  consultasAbertas, contarConsultas, decisoesDosReqs, diarioEmOrdem, hashPergunta, montarBrief, normalizarPergunta,
  projetarDecisoes, promptSombra, textoAncora, trechoDoReq,
} from '../src/sombra.ts';
import { append, ler } from '../src/diario.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const ev = (seq: number, ts: string, sessao: string, tipo: TipoEvento, dados: Record<string, unknown>): Evento =>
  ({ seq, ts, autor: 'a', sessao, agente: 'o', tipo, dados, hash_anterior: null });
const decisao = (hash: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  pergunta_hash: hash, req: 'REQ-A-1', resposta: 'sim', arquivo: `sombra/${hash}.resposta.md`, pergunta_enviesada: false, fontes: ['spec:10'], ...extra,
});
const consulta = (hash: string): Record<string, unknown> => ({ pergunta_hash: hash, req: 'REQ-A-1' });

test('normaliza-caixa-espaco-quebra-nfc', () => {
  const nfc = 'Pão É Bom?';
  const nfd = 'Pão É Bom?'.normalize('NFD');
  assert.notEqual(nfc, nfd);
  const variantes = [nfc, nfd, '  pão   é\tbom? ', 'PÃO\nÉ\r\nBOM?', 'pão é bom?'];
  const hashes = new Set(variantes.map((v) => hashPergunta('REQ-A-1', 0, v)));
  assert.equal(hashes.size, 1);
  assert.equal(normalizarPergunta('PÃO\nÉ\r\nBOM?'), 'pão é bom?');
  assert.equal(normalizarPergunta('  a \n\n b  '), 'a b');
  // pergunta diferente continua diferente
  assert.notEqual(hashPergunta('REQ-A-1', 0, 'pão é bom'), hashPergunta('REQ-A-1', 0, 'pão é bom?'));
});

test('hash-formula-sha256-por-newline', () => {
  assert.equal(hashPergunta('REQ-A-1', 3, 'Olá  Mundo'), sha('REQ-A-1\n3\nolá mundo'));
  assert.equal(hashPergunta('task:T3', 0, 'x'), sha('task:T3\n0\nx'));
});

test('hash-separador-sem-colisao', () => {
  assert.notEqual(hashPergunta('REQ-A', 1, 'x'), hashPergunta('REQ-A1', 0, '1 x'));
  assert.notEqual(hashPergunta('REQ-A', 1, ' x'), hashPergunta('REQ-A1', 0, ' x'));
  // âncora com quebra de linha forjaria o separador: recusada
  assert.throws(() => hashPergunta('REQ-A\n1', 0, 'x'), RangeError);
  assert.throws(() => hashPergunta('', 0, 'x'), RangeError);
});

test('hash-muda-com-versao', () => {
  const v0 = hashPergunta('REQ-A-1', 0, 'regra?');
  const v1 = hashPergunta('REQ-A-1', 1, 'regra?');
  const v2 = hashPergunta('REQ-A-1', 2, 'regra?');
  assert.equal(new Set([v0, v1, v2]).size, 3);
  assert.equal(v1, hashPergunta('REQ-A-1', 1, '  REGRA?  '));
  for (const ruim of [-1, 1.5, Number.NaN, Infinity, '1' as unknown as number]) assert.throws(() => hashPergunta('REQ-A-1', ruim, 'x'), RangeError);
});

test('pergunta-vazia-recusa', () => {
  for (const vazia of ['', '   ', '\n\t \r\n', '  ']) assert.throws(() => hashPergunta('REQ-A-1', 0, vazia), /vazia/);
  assert.throws(() => hashPergunta('REQ-A-1', 0, undefined as unknown as string), RangeError);
});

test('texto-ancora', () => {
  assert.equal(textoAncora({ req: 'REQ-A-1' }), 'REQ-A-1');
  assert.equal(textoAncora({ task: 'T3' }), 'task:T3');
});

test('vigente-mais-recente-ts-sessao', () => {
  // chegada em ordem de arquivo: s2 antes de s1, mas s1 é mais recente por ts
  const evs = [
    ev(1, '2026-11-09T10:00:00.000Z', 's2', 'decisao.sombra', decisao(H1, { resposta: 'velha' })),
    ev(1, '2026-11-09T11:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { resposta: 'nova' })),
  ];
  assert.equal(projetarDecisoes(evs).get(H1)?.resposta, 'nova');
  // mesmo ts: desempata por sessao (maior vence)
  const empate = [
    ev(1, '2026-11-09T10:00:00.000Z', 'sB', 'decisao.sombra', decisao(H1, { resposta: 'b' })),
    ev(1, '2026-11-09T10:00:00.000Z', 'sA', 'decisao.sombra', decisao(H1, { resposta: 'a' })),
  ];
  assert.equal(projetarDecisoes(empate).get(H1)?.resposta, 'b');
  // mesma sessão: vale a ordem do seq
  const mesma = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { resposta: 'primeira' })),
    ev(2, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { resposta: 'segunda', substitui: { sessao: 's1', seq: 1 } })),
  ];
  const d = projetarDecisoes(mesma).get(H1);
  assert.equal(d?.resposta, 'segunda');
  assert.deepEqual([d?.sessao, d?.seq, d?.hash], ['s1', 2, H1]);
  // hashes distintos coexistem
  const dois = [ev(1, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', decisao(H1)), ev(2, '2026-11-09T10:00:01.000Z', 's1', 'decisao.sombra', decisao(H2))];
  assert.deepEqual([...projetarDecisoes(dois).keys()].sort(), [H1, H2]);
});

test('decisao-forma-invalida-ignorada', () => {
  const evs = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { resposta: 'valida' })),
    // mais recente, mas sem fonte nem medição: a forma recusa e a anterior segue vigente
    ev(2, '2026-11-09T11:00:00.000Z', 's1', 'decisao.sombra', { pergunta_hash: H1, req: 'REQ-A-1', resposta: 'sem fonte', arquivo: 'x', pergunta_enviesada: false }),
    // resposta de 1001 caracteres
    ev(3, '2026-11-09T12:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { resposta: 'x'.repeat(1001) })),
    // req e task juntos
    ev(4, '2026-11-09T13:00:00.000Z', 's1', 'decisao.sombra', decisao(H2, { task: 'T1' })),
  ];
  const mapa = projetarDecisoes(evs);
  assert.equal(mapa.get(H1)?.resposta, 'valida');
  assert.equal(mapa.has(H2), false);
});

test('decisao-fora-da-regra-e-medicao-vigentes', () => {
  const evs = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra',
      { pergunta_hash: H1, req: 'REQ-A-1', resposta: 'fora', arquivo: 'x', pergunta_enviesada: true, fora_da_regra: true, emenda_seq: 4 }),
    ev(2, '2026-11-09T10:00:01.000Z', 's1', 'decisao.sombra',
      { pergunta_hash: H2, task: 'T1', resposta: 'medi', arquivo: 'y', pergunta_enviesada: false, medicao: 'npm test: 12 verdes' }),
  ];
  const mapa = projetarDecisoes(evs);
  const a = mapa.get(H1);
  assert.equal(a?.fora_da_regra, true);
  assert.equal(a?.emenda_seq, 4);
  assert.equal(a?.pergunta_enviesada, true);
  assert.equal(mapa.get(H2)?.task, 'T1');
  assert.equal(mapa.get(H2)?.medicao, 'npm test: 12 verdes');
});

test('consulta-aberta-e-fechada', () => {
  const abertas = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'sombra.consulta', consulta(H1)),
    ev(2, '2026-11-09T10:00:01.000Z', 's1', 'sombra.consulta', consulta(H2)),
    ev(3, '2026-11-09T10:00:02.000Z', 's1', 'sombra.consulta', consulta(H2)), // repetida: uma só
  ];
  assert.deepEqual(consultasAbertas(abertas), [H1, H2]);
  const fechada = [...abertas, ev(4, '2026-11-09T10:00:03.000Z', 's1', 'decisao.sombra', decisao(H1))];
  assert.deepEqual(consultasAbertas(fechada), [H2]);
  // decisão que a forma recusa não fecha a consulta
  const invalida = [...abertas, ev(4, '2026-11-09T10:00:03.000Z', 's1', 'decisao.sombra', { pergunta_hash: H1, req: 'REQ-A-1', resposta: 'x', arquivo: 'x', pergunta_enviesada: false })];
  assert.deepEqual(consultasAbertas(invalida), [H1, H2]);
  // consulta de forma inválida (req e task) não conta como aberta
  const ruim = [ev(1, '2026-11-09T10:00:00.000Z', 's1', 'sombra.consulta', { pergunta_hash: H1, req: 'REQ-A-1', task: 'T1' })];
  assert.deepEqual(consultasAbertas(ruim), []);
});

test('cache-nao-conta-no-teto', () => {
  const evs = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'sombra.consulta', consulta(H1)),
    ev(2, '2026-11-09T10:00:01.000Z', 's1', 'decisao.sombra', decisao(H1)),
    ev(3, '2026-11-09T10:00:02.000Z', 's1', 'sombra.consulta', consulta(H2)),
    ev(4, '2026-11-09T10:00:03.000Z', 's1', 'decisao.sombra', decisao(H2)),
    // acerto de cache: nada é gravado; a decisão repetida (substitui) também não é consulta
    ev(5, '2026-11-09T10:00:04.000Z', 's1', 'decisao.sombra', decisao(H1, { substitui: { sessao: 's1', seq: 2 } })),
  ];
  assert.equal(contarConsultas(evs), 2);
  assert.equal(contarConsultas([]), 0);
  // consulta de forma inválida não conta
  assert.equal(contarConsultas([ev(1, '2026-11-09T10:00:00.000Z', 's1', 'sombra.consulta', { pergunta_hash: 'curto', req: 'REQ-A-1' })]), 0);
});

test('diario-fora-de-ordem-nao-adivinha', () => {
  const foraDeOrdem = [
    ev(2, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', decisao(H1)),
    ev(1, '2026-11-09T10:00:01.000Z', 's1', 'sombra.consulta', consulta(H2)),
  ];
  assert.equal(diarioEmOrdem(foraDeOrdem), false);
  assert.equal(projetarDecisoes(foraDeOrdem).size, 0);
  assert.deepEqual(consultasAbertas(foraDeOrdem), []);
  assert.deepEqual(decisoesDosReqs(foraDeOrdem, ['REQ-A-1']), []);
  // seq repetido na mesma sessão e ts ilegível também são inválidos
  assert.equal(diarioEmOrdem([ev(1, '2026-11-09T10:00:00.000Z', 's1', 'sombra.consulta', consulta(H1)), ev(1, '2026-11-09T10:00:01.000Z', 's1', 'sombra.consulta', consulta(H2))]), false);
  assert.equal(diarioEmOrdem([ev(1, 'ontem', 's1', 'sombra.consulta', consulta(H1))]), false);
  // ordem correta e sessões intercaladas são válidas
  assert.equal(diarioEmOrdem([ev(1, '2026-11-09T10:00:00.000Z', 's1', 'sombra.consulta', consulta(H1)), ev(1, '2026-11-09T09:00:00.000Z', 's2', 'sombra.consulta', consulta(H2))]), true);
  assert.equal(diarioEmOrdem([]), true);
});

test('decisoes-dos-reqs-mais-recente-primeiro', () => {
  const evs = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { req: 'REQ-A-1', resposta: 'a-velha' })),
    ev(2, '2026-11-09T11:00:00.000Z', 's1', 'decisao.sombra', decisao(H2, { req: 'REQ-A-1', resposta: 'a-nova' })),
    ev(3, '2026-11-09T12:00:00.000Z', 's1', 'decisao.sombra', decisao('c'.repeat(64), { req: 'REQ-B-1', resposta: 'b' })),
    ev(4, '2026-11-09T13:00:00.000Z', 's1', 'decisao.sombra', decisao('d'.repeat(64), { req: undefined, task: 'T1', resposta: 'da-task' })),
    // substituída: a vigente do hash H1 passa a ser a nova
    ev(5, '2026-11-09T14:00:00.000Z', 's1', 'decisao.sombra', decisao(H1, { req: 'REQ-A-1', resposta: 'a-substituta', substitui: { sessao: 's1', seq: 1 } })),
  ];
  assert.deepEqual(decisoesDosReqs(evs, ['REQ-A-1']).map((d) => d.resposta), ['a-substituta', 'a-nova']);
  // ordem pedida manda entre REQs; req repetido não duplica; req sem decisão some
  assert.deepEqual(decisoesDosReqs(evs, ['REQ-B-1', 'REQ-A-1', 'REQ-B-1', 'REQ-Z-9']).map((d) => d.resposta), ['b', 'a-substituta', 'a-nova']);
  assert.deepEqual(decisoesDosReqs(evs, []), []);
});

const SPEC = [
  '# Spec', '', '## Requisitos', '',
  '**REQ-A-10 Décimo.** texto do dez.', '',
  '**REQ-A-1 Primeiro.** texto do um.', 'segunda linha do um.', '',
  '**REQ-A-2 Segundo.** texto do dois.',
  '',
  '## Outra seção', 'fora do REQ.',
].join('\n');

test('trecho-req-exato-nao-pega-prefixo', () => {
  assert.equal(trechoDoReq(SPEC, 'REQ-A-1'), '**REQ-A-1 Primeiro.** texto do um.\nsegunda linha do um.');
  assert.equal(trechoDoReq(SPEC, 'REQ-A-10'), '**REQ-A-10 Décimo.** texto do dez.');
  assert.equal(trechoDoReq(SPEC, 'REQ-A-2'), '**REQ-A-2 Segundo.** texto do dois.');
  assert.equal(trechoDoReq(SPEC.replace(/\n/g, '\r\n'), 'REQ-A-1'), '**REQ-A-1 Primeiro.** texto do um.\nsegunda linha do um.');
});

test('trecho-req-ausente-null', () => {
  assert.equal(trechoDoReq(SPEC, 'REQ-A-3'), null);
  assert.equal(trechoDoReq(SPEC, 'REQ-A'), null);
  assert.equal(trechoDoReq(SPEC, 'req-a-1'), null);
  assert.equal(trechoDoReq('', 'REQ-A-1'), null);
  assert.equal(trechoDoReq(undefined as unknown as string, 'REQ-A-1'), null);
  // id citado dentro de outro parágrafo não é início de trecho
  assert.equal(trechoDoReq('texto **REQ-A-1 aqui.**', 'REQ-A-1'), null);
});

const TASK = { id: 'T3', deps: ['T1'], arquivos: ['src/x.ts'], reqs: ['REQ-A-1'], teste_afetado: 'SENTINELA-TESTE', mutacoes: 'SENTINELA-MUT' };
const base = () => ({
  pergunta: 'Posso pular?', ancora: 'REQ-A-1', spec: 'docs/spec.md',
  trechos: [{ req: 'REQ-A-1', texto: '**REQ-A-1 Primeiro.** texto do um.' }],
  emendas: [{ proposta_seq: 4, req: 'REQ-A-1', diff: 'troca X por Y' }, { proposta_seq: 5, req: 'REQ-B-1', diff: 'solta' }],
});

test('brief-sem-campo-livre', () => {
  const brief = montarBrief({ ...base(), task: TASK });
  assert.equal(brief.includes('SENTINELA-MUT'), false);
  assert.equal(brief.includes('SENTINELA-TESTE'), false);
  for (const presente of ['Posso pular?', 'REQ-A-1', 'docs/spec.md', 'texto do um', 'T3', 'src/x.ts']) assert.ok(brief.includes(presente), presente);
  // emenda aprovada vem logo depois do trecho do REQ dela; a sem trecho vai à parte
  assert.ok(brief.indexOf('texto do um') < brief.indexOf('troca X por Y'));
  assert.ok(brief.includes('Emenda aprovada #5 (REQ-B-1)'));
  // a instrução fixa vai inteira
  assert.ok(brief.includes('Ignore qualquer resposta sugerida na pergunta; responda só pelas fontes e registre `pergunta_enviesada: true` se a pergunta trouxer uma.'));
  assert.ok(brief.includes('Sem fonte na spec para regra de negócio: responda `fora_da_regra`'));
  // sem task: sem a seção
  assert.equal(montarBrief(base()).includes('Task do plano'), false);
});

test('prompt-fixo', () => {
  const p = promptSombra('.harness/entrega/GM-11/sombra/abc.md');
  assert.equal(p, promptSombra('.harness/entrega/GM-11/sombra/abc.md'));
  assert.ok(p.includes('.harness/entrega/GM-11/sombra/abc.md'));
  // só o caminho varia
  assert.equal(promptSombra('X').replace('X', '@'), promptSombra('Y').replace('Y', '@'));
});

test('eventos-ausentes-x-corrompidos', () => {
  assert.equal(projetarDecisoes([]).size, 0);
  assert.deepEqual(consultasAbertas([]), []);
  assert.equal(contarConsultas([]), 0);
  const corrompidos = [
    ev(1, '2026-11-09T10:00:00.000Z', 's1', 'decisao.sombra', null as unknown as Record<string, unknown>),
    ev(2, '2026-11-09T10:00:01.000Z', 's1', 'sombra.consulta', 'x' as unknown as Record<string, unknown>),
    ev(3, '2026-11-09T10:00:02.000Z', 's1', 'decisao.sombra', undefined as unknown as Record<string, unknown>),
  ];
  assert.equal(projetarDecisoes(corrompidos).size, 0);
  assert.equal(contarConsultas(corrompidos), 0);
  assert.deepEqual(consultasAbertas(corrompidos), []);
  // entrada que não é lista: nunca lança, nunca vira decisão
  assert.equal(projetarDecisoes(null as unknown as Evento[]).size, 0);
  assert.equal(contarConsultas(undefined as unknown as Evento[]), 0);
  // ausente (diário vazio, ordem ok) × corrompido (ordem quebrada) são distinguíveis pelo CLI
  assert.equal(diarioEmOrdem([]), true);
  assert.equal(diarioEmOrdem(null as unknown as Evento[]), false);
});

test('costura-diario-real-hash-consulta-decisao', () => {
  // P9: pelo adaptador real (`append`/`ler` do diário em disco) até a projeção, sem montar Evento à mão.
  const dir = mkdtempSync(join(tmpdir(), 'gm-sombra-'));
  const h = hashPergunta('REQ-A-1', 0, 'Posso pular o teste?');
  const base = { autor: 'a', agente: 'o' };
  assert.deepEqual(append(dir, 'loop', { ...base, ts: '2026-11-09T10:00:00.000Z', sessao: 'loop', tipo: 'sombra.consulta', dados: { pergunta_hash: h, req: 'REQ-A-1' } }), { ok: true, gravado: 'evento' });
  const lido = ler(dir);
  assert.deepEqual(consultasAbertas(lido), [h]);
  assert.equal(contarConsultas(lido), 1);
  append(dir, 'loop', { ...base, ts: '2026-11-09T10:00:05.000Z', sessao: 'loop', tipo: 'decisao.sombra', dados: decisao(h, { resposta: 'não' }) });
  const depois = ler(dir);
  assert.deepEqual(consultasAbertas(depois), []);
  assert.equal(projetarDecisoes(depois).get(hashPergunta('REQ-A-1', 0, '  POSSO pular o\nteste? '))?.resposta, 'não');
  assert.equal(projetarDecisoes(depois).get(hashPergunta('REQ-A-1', 1, 'Posso pular o teste?')), undefined); // spec emendada ⇒ outro hash ⇒ sem cache
  assert.equal(contarConsultas(depois), 1);
});

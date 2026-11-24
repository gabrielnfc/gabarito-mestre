/**
 * GM-15 T3 (REQ-ENT-1 a, b, c, d): núcleo do encerramento. `encerramentoDe` e `podeEncerrar` (puros, `trilha.ts`) e `entregaPublicada` (`guarda.ts`)
 * lendo diários reais em disco.
 * Mutações (M3a..M3f do plano):
 *  M3a PR com base `next` encerrando                 ⇒ base-next-nao-encerra
 *  M3b descartar `via: titulo` na releitura          ⇒ titulo-sem-id-no-head-encerra (trilha)
 *  M3c fato sem `base` encerrando                    ⇒ mergeado-legado-sem-base-nao-encerra
 *  M3d ligação por sessão vencendo `entrega.encerrada` ⇒ resposta-pos-merge-nao-reabre
 *  M3e re-encerrar pelo PR antigo                    ⇒ reaberta-nao-reencerra-pelo-mesmo-pr
 *  M3f comparar com o `ts` de medição, não `mergeado_em` ⇒ reaberta-pr-antigo-medido-depois-nao-reencerra
 * GM-18 T1 (REQ-ENC-1 iv, v): M1e ⇒ dono-reencerra-apos-reabrir · M1f ⇒ automatico-segue-exigindo-pr-novo · M1g ⇒ medir-nao-encerra-sobre-dono
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encerramentoDe, podeEncerrar, trilhaDe } from '../src/trilha.ts';
import type { FatosTrilha } from '../src/trilha.ts';
import { entregaPublicada, SESSAO_QUALQUER } from '../src/guarda.ts';
import { entregueDe } from '../src/painel.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

type Ev = { tipo: TipoEvento; dados: Record<string, unknown>; ts: string; sessao?: string };
const T = (min: number): string => new Date(Date.UTC(2026, 10, 1, 0, min)).toISOString();
const ID = 'GM-10';

function evs(lista: Ev[]): Evento[] {
  const seqs = new Map<string, number>();
  return lista.map((x) => {
    const sessao = x.sessao ?? 'A';
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    return { seq, ts: x.ts, autor: 'teste', sessao, agente: 'orquestrador', tipo: x.tipo, dados: x.dados, hash_anterior: null };
  });
}

/** Grava o diário real: um arquivo por sessão, com a cadeia de hash que `lerEstrito` confere; `plano.json` presente (2º fato da regra antiga). */
function diario(lista: Ev[]): string {
  const raiz = mkdtempSync(join(tmpdir(), 'enc-'));
  const dir = join(raiz, '.harness', 'entregas', ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plano.json'), '{}');
  const porSessao = new Map<string, Evento[]>();
  for (const e of evs(lista)) porSessao.set(e.sessao, [...(porSessao.get(e.sessao) ?? []), e]);
  for (const [sessao, es] of porSessao) {
    const linhas: string[] = [];
    for (const e of es) {
      const linha = JSON.stringify({ ...e, hash_anterior: linhas.length === 0 ? null : createHash('sha256').update(linhas[linhas.length - 1]).digest('hex') });
      linhas.push(linha);
    }
    writeFileSync(join(dir, `events.${sessao}.jsonl`), `${linhas.join('\n')}\n`);
  }
  return raiz;
}

const prFato = (numero: number, estado: string, extra: Record<string, unknown>, ts = T(1)): Ev => ({
  tipo: 'fato.medido', ts, dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: `feat/${ID}-x`, ...extra } },
});
const encerrada = (pr: number, mergeado_em: string, ts: string): Ev => ({ tipo: 'entrega.encerrada', ts, dados: { entrega: ID, pr, via: 'head', mergeado_em } });
const reaberta = (em: string): Ev => ({ tipo: 'entrega.reaberta', ts: em, dados: { entrega: ID, em } });
const mergeado = (numero: number, mergeado_em: string, extra: Record<string, unknown> = {}) =>
  ({ numero, estado: 'mergeado', base: 'main', via: 'head', branch: `feat/${ID}-x`, mergeado_em, ...extra });

const fatos = (): FatosTrilha => ({ branch: `feat/${ID}-x`, idPadrao: 'GM-10', specs: [], plano: { tasks: [] }, ledger: false, gh: 'ok', ultimas: [], sessao: 'S1' });
/** Trilha com o PR mergeado: o dono ligou a sessão `S1` à entrega (pergunta (b)), senão o PR mergeado tira a entrega da trilha (FIEL-1 b). */
const trilhaComPr = (pr: Ev) => trilhaDe(fatos(), evs([
  { tipo: 'fato.medido', ts: T(0), sessao: 'S1', dados: { chave: 'branch', fonte: 'git', valor: { nome: 'x' } } },
  { tipo: 'dono.resposta', ts: T(1), sessao: 'S1', dados: { pergunta: 'S1:1', rotulo: ID } }, pr,
]));

test('titulo-sem-id-no-head-encerra: PR achado por título (head next) pode encerrar e vale na releitura da trilha', () => {
  assert.equal(podeEncerrar([], ID, mergeado(16, T(5), { via: 'titulo', branch: 'next' })), true);
  // releitura: o fato via titulo com head sem o ID conta para a fase PR; sem `via` o mesmo head é descartado (descarte só por head)
  const comVia = trilhaComPr(prFato(16, 'mergeado', { branch: 'next', base: 'main', via: 'titulo' }));
  assert.equal(comVia.marcas[5], '✓');
  const semVia = trilhaComPr(prFato(16, 'mergeado', { branch: 'next' }));
  assert.notEqual(semVia.marcas[5], '✓');
  const viaHead = trilhaComPr(prFato(16, 'mergeado', { branch: 'next', base: 'main', via: 'head' }));
  assert.notEqual(viaHead.marcas[5], '✓');
  // PR de head com o ID continua valendo
  assert.equal(trilhaComPr(prFato(7, 'mergeado', {})).marcas[5], '✓');
});

test('head-de-outra-entrega-nao-encerra: via head com head que não casa o ID', () => {
  assert.equal(podeEncerrar([], ID, mergeado(8, T(5), { branch: 'feat/GM-9-x' })), false);
  assert.equal(podeEncerrar([], ID, mergeado(8, T(5), { branch: 'feat/GM-10-x' })), true);
});

test('mergeado-legado-sem-base-nao-encerra (M3c): o #7 do F3 só vale para a fase PR', () => {
  const legado = { numero: 7, estado: 'mergeado', via: 'head', branch: `feat/${ID}-x`, mergeado_em: T(5) };
  assert.equal(podeEncerrar([], ID, legado), false);
  assert.equal(podeEncerrar([], ID, { ...legado, base: null }), false);
  assert.equal(podeEncerrar([], ID, { ...legado, base: 'main', via: undefined }), false, 'sem via não se sabe como achou');
  assert.equal(trilhaComPr(prFato(7, 'mergeado', {})).marcas[5], '✓', 'a fase PR da trilha segue como hoje');
});

test('base-da-entrega-decide (M3a, GM-20 REQ-CRD-2): a base é parâmetro; sem ela, main', () => {
  assert.equal(podeEncerrar([], ID, mergeado(9, T(5), { base: 'next' })), false, 'sem a base da entrega, é main');
  assert.equal(podeEncerrar([], ID, mergeado(9, T(5), { base: 'next' }), 'next'), true, 'base next ⇒ encerra com base next');
  assert.equal(podeEncerrar([], ID, mergeado(9, T(5), { base: 'main' }), 'next'), false, 'base next ⇒ não encerra com base main');
  assert.equal(podeEncerrar([], ID, mergeado(9, T(5), { base: 'main' }), 'main'), true);
  assert.equal(podeEncerrar([], ID, mergeado(9, T(5), { estado: 'aberto' })), false);
  assert.equal(podeEncerrar([], ID, mergeado(9, T(5))), true);
});

test('encerrada-duplicada-usa-a-primeira: duas sessões gravam, vale a 1ª', () => {
  const es = evs([encerrada(22, T(5), T(10)), { ...encerrada(23, T(6), T(11)), sessao: 'B' }]);
  const r = encerramentoDe(es, ID);
  assert.equal(r.encerrada, true);
  assert.equal(r.primeira?.pr, 22);
  assert.equal(r.primeira?.mergeado_em, T(5));
  assert.equal(encerramentoDe(es, 'GM-11').encerrada, false, 'outra entrega não conta');
});

test('reaberta-nao-reencerra-pelo-mesmo-pr (M3e)', () => {
  const es = evs([encerrada(22, T(5), T(10)), reaberta(T(20))]);
  const r = encerramentoDe(es, ID);
  assert.equal(r.encerrada, false);
  assert.equal(r.reabertaEm, T(20));
  assert.deepEqual(r.prsQueEncerraram, [22]);
  assert.equal(podeEncerrar(es, ID, mergeado(22, T(30))), false, 'o PR que já encerrou não encerra de novo, nem com mergeado_em posterior');
  // gravação indevida do PR antigo depois da reabertura não encerra na projeção
  assert.equal(encerramentoDe(evs([encerrada(22, T(5), T(10)), reaberta(T(20)), encerrada(22, T(30), T(31))]), ID).encerrada, false);
});

test('reaberta-reencerra-com-pr-novo', () => {
  const es = evs([encerrada(22, T(5), T(10)), reaberta(T(20))]);
  assert.equal(podeEncerrar(es, ID, mergeado(23, T(25))), true);
  assert.equal(podeEncerrar(es, ID, mergeado(23, T(15))), false, 'mergeado antes da reabertura');
  assert.equal(podeEncerrar(es, ID, mergeado(23, null as unknown as string)), false, 'mergeado_em ilegível não é posterior');
  const depois = evs([encerrada(22, T(5), T(10)), reaberta(T(20)), encerrada(23, T(25), T(26))]);
  assert.deepEqual([encerramentoDe(depois, ID).encerrada, encerramentoDe(depois, ID).primeira?.pr], [true, 23]);
  assert.equal(podeEncerrar(depois, ID, mergeado(24, T(40))), false, 'já encerrou de novo');
});

test('reaberta-pr-antigo-medido-depois-nao-reencerra (M3f, condição 2): o ts da medição não é o mergedAt', () => {
  // PR 19 mergeou antes da reabertura (T3) e só foi medido depois dela (T30): mergeado_em manda, não o ts
  const es = evs([encerrada(22, T(5), T(10)), reaberta(T(20)), prFato(19, 'mergeado', { base: 'main', via: 'head' }, T(30))]);
  assert.equal(podeEncerrar(es, ID, mergeado(19, T(3))), false);
  assert.equal(podeEncerrar(es, ID, mergeado(19, T(21))), true, 'o mesmo PR com mergeado_em posterior encerra (o relógio da medição não decide)');
});

test('resposta-pos-merge-nao-reabre (M3d): dono.resposta e "feito" de pendência não reabrem a entrega encerrada', () => {
  const base: Ev[] = [
    { tipo: 'fato.medido', ts: T(1), sessao: 'S1', dados: { chave: 'branch', fonte: 'git', valor: { nome: 'x' } } },
    prFato(7, 'mergeado', { base: 'main', via: 'head' }, T(2)),
  ];
  const respostas: Ev[] = [
    { tipo: 'dono.resposta', ts: T(40), sessao: 'S1', dados: { pergunta: 'S1:1', rotulo: ID } },
    { tipo: 'dono.resposta', ts: T(41), sessao: 'S1', dados: { pergunta: 'pendencia-x', rotulo: 'feito' } },
  ];
  // controle: sem `entrega.encerrada`, a regra antiga destrava (a resposta liga a sessão)
  const antiga = diario([...base, ...respostas]);
  assert.equal(entregaPublicada(antiga, ID, 'S1'), false);
  assert.equal(entregaPublicada(antiga, ID, SESSAO_QUALQUER), false);
  // com `entrega.encerrada` a ligação não vence
  const enc = diario([...base, encerrada(7, T(3), T(4)), ...respostas]);
  assert.equal(entregaPublicada(enc, ID, 'S1'), true);
  assert.equal(entregaPublicada(enc, ID, SESSAO_QUALQUER), true);
  assert.equal(entregaPublicada(enc, ID, null), true);
  // só a reabertura (comando do dono) volta
  const reab = diario([...base, encerrada(7, T(3), T(4)), ...respostas, reaberta(T(50))]);
  assert.equal(entregaPublicada(reab, ID, 'S1'), false);
});

test('sem-encerrada-regra-antiga: PR mergeado + plano, sem resposta, segue publicada; reaberta sem novo encerramento não volta à regra antiga', () => {
  const merge = prFato(7, 'mergeado', { base: 'main', via: 'head' }, T(2));
  assert.equal(entregaPublicada(diario([merge]), ID, null), true);
  assert.equal(entregaPublicada(diario([merge, encerrada(7, T(3), T(4)), reaberta(T(50))]), ID, null), false, 'reaberta: só um PR novo encerra');
  assert.equal(entregaPublicada(diario([merge, encerrada(7, T(3), T(4)), reaberta(T(50)), encerrada(8, T(60), T(61))]), ID, null), true);
});

test('encerrada-de-outra-entrega-nao-vale: o evento de GM-11 no diário de GM-10 não encerra', () => {
  const outra: Ev = { tipo: 'entrega.encerrada', ts: T(4), dados: { entrega: 'GM-11', pr: 7, via: 'head', mergeado_em: T(3) } };
  assert.equal(entregaPublicada(diario([outra]), ID, null), false);
  // com PR mergeado + plano a regra antiga dá true; só o filtro de entrega faz a encerrada alheia não valer (a reaberta cobre a ausência de atalho)
  assert.equal(entregaPublicada(diario([prFato(7, 'mergeado', { base: 'main', via: 'head' }, T(2)), outra, reaberta(T(5))]), ID, null), true, 'a de outra entrega não é atalho de encerrada nem reabre');
});

test('reaberta-pr-mergeado-antes-nao-reencerra-em-encerramentoDe: encerrada pós-reabertura com mergeado_em anterior a ela não encerra', () => {
  const es = evs([reaberta(T(20)), encerrada(23, T(15), T(25))]);
  assert.equal(encerramentoDe(es, ID).encerrada, false);
  assert.equal(encerramentoDe(evs([reaberta(T(20)), encerrada(23, T(22), T(25))]), ID).encerrada, true, 'controle: mergeado_em posterior encerra');
});

// ── GM-18 T1 (REQ-ENC-1 iv, v): encerramento do dono ──────────────────────────────────────────────────────────────────────────

const doDono = (pr: number, mergeado_em: string, ts: string, extra: Record<string, unknown> = {}, id = ID): Ev =>
  ({ tipo: 'entrega.encerrada', ts, dados: { entrega: id, pr, via: 'dono', mergeado_em, ...extra } });

test('dono-reencerra-apos-reabrir: o dono encerra de novo pelo mesmo PR, com mergeado_em anterior à reabertura', () => {
  const r = encerramentoDe(evs([doDono(26, T(5), T(6)), reaberta(T(20)), doDono(26, T(5), T(25))]), ID);
  assert.equal(r.encerrada, true);
  assert.equal(r.primeira?.via, 'dono');
  assert.equal(r.primeira?.pr, 26);
});

test('automatico-segue-exigindo-pr-novo: a 2ª encerrada via titulo, mesmo cenário, não vale', () => {
  const dois: Ev = { tipo: 'entrega.encerrada', ts: T(25), dados: { entrega: ID, pr: 26, via: 'titulo', mergeado_em: T(5) } };
  assert.equal(encerramentoDe(evs([doDono(26, T(5), T(6)), reaberta(T(20)), dois]), ID).encerrada, false);
  const head: Ev = { tipo: 'entrega.encerrada', ts: T(25), dados: { entrega: ID, pr: 26, via: 'head', mergeado_em: T(5) } };
  assert.equal(encerramentoDe(evs([doDono(26, T(5), T(6)), reaberta(T(20)), head]), ID).encerrada, false);
});

test('dono-antes-da-reabertura-nao-vale: encerrada do dono anterior à reabertura não encerra', () => {
  const r = encerramentoDe(evs([doDono(26, T(5), T(6)), reaberta(T(20))]), ID);
  assert.equal(r.encerrada, false);
  assert.equal(r.reabertaEm, T(20));
});

test('medir-nao-encerra-sobre-dono: podeEncerrar nunca por cima de encerrada do dono nem com via dono', () => {
  assert.equal(podeEncerrar(evs([doDono(26, T(5), T(6))]), ID, mergeado(27, T(10))), false);
  assert.equal(podeEncerrar([], ID, mergeado(27, T(10), { via: 'dono' })), false);
  assert.equal(podeEncerrar([], ID, mergeado(27, T(10))), true, 'controle: head sem encerrada encerra');
});

test('entregue-mostra-versao-do-dono: o painel lê a versão da encerrada do dono', () => {
  const es = evs([doDono(16, T(5), T(6), { versao: '2.0.0' }, 'GM-13')]);
  assert.deepEqual(entregueDe(es, 'GM-13'), { id: 'GM-13', versao: '2.0.0' });
});

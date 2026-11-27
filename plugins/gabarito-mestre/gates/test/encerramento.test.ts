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
function diario(lista: Ev[], plano: unknown = {}): string {
  const raiz = mkdtempSync(join(tmpdir(), 'enc-'));
  const dir = join(raiz, '.harness', 'entregas', ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plano.json'), JSON.stringify(plano));
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

// ── GM-21 T1 (REQ-ENC-1, REQ-ENC-2; DT1 e DT2) ──────────────────────────────────────────────────────────────────────────────────────────────
// MUTAÇÕES: ME1-a podeEncerrar ignora o plano ⇒ encerra-nao-com-plano-aberto-titulo/head · ME1-b `fora` conta como aberta ⇒ encerra-com-task-fora ·
// ME1-c plano só na via titulo ⇒ encerra-nao-com-plano-aberto-head · ME1-d/g (trilhaDe ignora o plano; entregaPublicada com tasks []) ⇒ publicada-nao-com-plano-aberto ·
// ME2-a 1ª integração ⇒ encerra-so-pr-posterior · ME2-b sem margem ⇒ encerra-margem-de-relogio · ME2-c margem de 1 h ⇒ encerra-margem-de-relogio
const CICLO = (task: string, ts: string[]): Ev[] => [
  { tipo: 'task.iniciada', ts: ts[0], dados: { task, papel: 'implementador' } },
  { tipo: 'task.concluida', ts: ts[1], dados: { task } },
  { tipo: 'task.iniciada', ts: ts[2], dados: { task, papel: 'revisor' } },
  { tipo: 'review.veredito', ts: ts[3], dados: { task, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 } },
  { tipo: 'task.integrada', ts: ts[4], dados: { task } },
];
const integrada = (task: string, min: number): Ev[] => CICLO(task, [0, 1, 2, 3, 4].map((i) => T(min + i)));
const PLANO_T1_T2 = { tasks: ['T1', 'T2'] };
const PLANO_JSON = { entrega: ID, tasks: ['T1', 'T2'].map((id) => ({ id, deps: [], arquivos: [`src/${id}.txt`], reqs: ['REQ-A-1'], titulo: id })) };

test('encerra-nao-com-plano-aberto-titulo (ME1-a): plano com T2 aberta ⇒ PR por título não encerra; sem o 5º argumento, a regra de hoje', () => {
  const es = evs(integrada('T1', 0));
  const pr = mergeado(10, T(30), { via: 'titulo', branch: 'docs/GM-10-plano' });
  assert.equal(podeEncerrar(es, ID, pr, 'main', PLANO_T1_T2), false);
  assert.equal(podeEncerrar(es, ID, pr, 'main'), true, 'sem plano: regra de hoje');
  assert.equal(podeEncerrar(es, ID, pr, 'main', null), true, 'plano null: regra de hoje');
});

test('encerra-nao-com-plano-aberto-head (ME1-c): o mesmo por head, e com a base next', () => {
  const es = evs(integrada('T1', 0));
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(30), { branch: `docs/${ID}-plano` }), 'main', PLANO_T1_T2), false);
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(30), { base: 'next', branch: `docs/${ID}-plano` }), 'next', PLANO_T1_T2), false);
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(30), { base: 'next', branch: `docs/${ID}-plano` }), 'next'), true);
});

test('encerra-com-task-fora (ME1-b): T2 cortada (ou adiada) e T1 integrada ⇒ o PR posterior encerra', () => {
  const pr = mergeado(10, T(30));
  for (const como of ['cortada', 'adiada']) {
    const es = evs([...integrada('T1', 0), { tipo: 'task.fora', ts: T(10), dados: { task: 'T2', como } }]);
    assert.equal(podeEncerrar(es, ID, pr, 'main', PLANO_T1_T2), true, como);
  }
});

test('encerra-sem-plano-igual: plano sem task e sem evento de task ⇒ a regra de hoje', () => {
  assert.equal(podeEncerrar([], ID, mergeado(10, T(30)), 'main', { tasks: [] }), true);
  assert.equal(podeEncerrar([], ID, mergeado(10, T(30)), 'main', PLANO_T1_T2), false, 'controle: com tasks pendentes não encerra');
});

test('encerra-so-pr-posterior (ME2-a, DT2): com integração, o PR anterior à última não encerra; o posterior sim', () => {
  const es = evs([...integrada('T1', 0), ...integrada('T2', 60 * 24 * 19)]);
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(60 * 24 * 2)), 'main', PLANO_T1_T2), false, 'PR do plano antigo, anterior à T2');
  assert.equal(podeEncerrar(es, ID, mergeado(38, T(60 * 24 * 20)), 'main', PLANO_T1_T2), true);
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(60 * 24 * 2))), false, 'a DT2 não depende do plano');
});

test('encerra-margem-de-relogio (ME2-b, ME2-c): 4 min antes da última integração encerra; 6 min antes não', () => {
  const es = evs(integrada('T1', 100)); // última integração em T(104)
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(100)), 'main'), true, '4 min antes');
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(98)), 'main'), false, '6 min antes');
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(104)), 'main'), true, 'no instante');
  assert.equal(podeEncerrar(es, ID, mergeado(10, T(99)), 'main'), true, 'exatamente 5 min antes: a margem é fechada');
});

test('encerra-sem-integracao-igual (DT2 não se aplica): entrega sem task.integrada encerra por PR antigo como hoje', () => {
  assert.equal(podeEncerrar(evs([prFato(7, 'mergeado', {})]), ID, mergeado(10, T(0))), true);
});

test('publicada-nao-com-plano-aberto (ME1-d, ME1-g): PR mergeado, plano.json com T2 aberta, sem entrega.encerrada ⇒ não publicada em nenhuma sessão', () => {
  const merge = prFato(10, 'mergeado', { base: 'main', via: 'titulo', branch: 'docs/GM-10-plano' }, T(40));
  const raiz = diario([...integrada('T1', 0), merge], PLANO_JSON);
  assert.equal(entregaPublicada(raiz, ID, SESSAO_QUALQUER), false);
  assert.equal(entregaPublicada(raiz, ID, 's2'), false);
  // regressão: T2 cortada ⇒ plano fechado ⇒ publicada (a regra de hoje)
  const fechado = diario([...integrada('T1', 0), { tipo: 'task.fora', ts: T(10), dados: { task: 'T2', como: 'cortada' } }, merge], PLANO_JSON);
  assert.equal(entregaPublicada(fechado, ID, SESSAO_QUALQUER), true);
  // plano.json ilegível ou inválido ⇒ tasks [] ⇒ a regra de hoje (publicada)
  assert.equal(entregaPublicada(diario([merge], {}), ID, SESSAO_QUALQUER), true, 'plano inválido');
  assert.equal(entregaPublicada(diario([...integrada('T1', 0), merge], { entrega: ID, tasks: [] }), ID, SESSAO_QUALQUER), true, 'plano sem task: não aberto');
  // vizinho: com PR #11 aberto depois, continua não publicada
  assert.equal(entregaPublicada(diario([...integrada('T1', 0), merge, prFato(11, 'aberto', { base: 'main', via: 'head' }, T(50))], PLANO_JSON), ID, SESSAO_QUALQUER), false);
});

test('publicada-encerrada-dono-igual (ME1-e): entrega.encerrada do dono com T2 aberta ⇒ publicada (o encerramento manda)', () => {
  const dono: Ev = { tipo: 'entrega.encerrada', ts: T(45), dados: { entrega: ID, pr: 10, via: 'dono', mergeado_em: T(40) } };
  const merge = prFato(10, 'mergeado', { base: 'main', via: 'titulo', branch: 'docs/GM-10-plano' }, T(40));
  const raiz = diario([...integrada('T1', 0), merge, dono], PLANO_JSON);
  assert.equal(entregaPublicada(raiz, ID, SESSAO_QUALQUER), true);
  assert.equal(entregaPublicada(raiz, ID, 's2'), true);
});

test('publicada-diario-que-nao-projeta (backlog m2): ciclo de task impossível + PR mergeado ⇒ a regra de hoje (publicada)', () => {
  const merge = prFato(10, 'mergeado', { base: 'main', via: 'titulo', branch: 'docs/GM-10-plano' }, T(40));
  const raiz = diario([{ tipo: 'task.integrada', ts: T(1), dados: { task: 'T1' } }, merge], PLANO_JSON);
  assert.equal(entregaPublicada(raiz, ID, SESSAO_QUALQUER), true);
});

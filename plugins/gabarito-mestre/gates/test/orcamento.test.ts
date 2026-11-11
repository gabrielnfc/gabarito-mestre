/**
 * Testes do orçamento de linhas do painel (GM-14 T2, REQ-GLB-1). Núcleo puro: nunca lança, sem relógio, sem I/O.
 * Pares tela cheia medidos (S1b): H = e.viewport.rows; 24 linhas ⇒ maxRows 6, 50 linhas ⇒ maxRows 19.
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-2-mut.json):
 *  M13     orçamento = maxRows (sem o teto por H)        ⇒ `orcamento-tela-cheia`, `orcamento-sem-tela-cheia` falham
 *  M17     H desconhecido ⇒ maxRows                      ⇒ `orcamento-h-ausente`, `orcamento-h-invalido-x-ausente` falham
 *  M-T2a   corte por `ordem` em vez de prioridade        ⇒ `corte-por-prioridade-nao-por-ordem` falha
 *  M-T2b   topo cortado pelo orçamento                   ⇒ `topo-2-linhas-orcamento-1-ficam-as-duas` falha
 *  M-T2c   piso 1 trocado por piso 0                     ⇒ `orcamento-piso-1` falha
 *  M-T2d   H infinito tratado como conhecido             ⇒ `orcamento-h-invalido-x-ausente` falha
 *  M-T2e   maxRows fracionário aceito                    ⇒ `orcamento-max-rows-invalido` falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orcamentoDe, porPrioridade, type LinhaPrioridade } from '../src/orcamento.ts';
import type { Linha } from '../src/tipos.ts';

const linha = (texto: string): Linha => [{ texto }];
const lp = (prioridade: number, ordem: number, texto: string): LinhaPrioridade => ({ prioridade, ordem, l: linha(texto) });
const textos = (ls: Linha[]) => ls.map((l) => l.map((s) => s.texto).join(''));

test('orcamento-tela-cheia', () => {
  // tela cheia: maxRows ≈ H/2 − 5; vale o menor entre maxRows e ⌊H/2⌋ − 5
  assert.equal(orcamentoDe(50, 20), 20);
  assert.equal(orcamentoDe(40, 15), 15);
  assert.equal(orcamentoDe(24, 7), 7);
  assert.equal(orcamentoDe(20, 5), 5);
  // S1b: tela cheia medida em 24 e 50 linhas
  assert.equal(orcamentoDe(24, 6), 6);
  assert.equal(orcamentoDe(50, 19), 19);
  // H manda quando é o menor (troca de valor: maxRows folgado não amplia)
  assert.equal(orcamentoDe(24, 19), 7);
  assert.equal(orcamentoDe(50, 30), 20);
});

test('orcamento-sem-tela-cheia', () => {
  assert.equal(orcamentoDe(50, 50), 20);
  assert.equal(orcamentoDe(24, 24), 7);
  assert.equal(orcamentoDe(20, 20), 5);
});

test('orcamento-h-ausente', () => {
  assert.equal(orcamentoDe(undefined, 5), 5);
  assert.equal(orcamentoDe(undefined, 7), 7);
  assert.equal(orcamentoDe(undefined, 13), 7); // min(13 − 6, 7)
  assert.equal(orcamentoDe(undefined, 24), 7);
  assert.equal(orcamentoDe(undefined, 8), 2); // min(8 − 6, 7): vale o menor
  assert.equal(orcamentoDe(undefined, 9), 3);
  assert.equal(orcamentoDe(undefined, 100), 7);
});

test('orcamento-piso-1', () => {
  assert.equal(orcamentoDe(10, 20), 1); // ⌊10/2⌋ − 5 = 0
  assert.equal(orcamentoDe(2, 20), 1); // negativo
  assert.equal(orcamentoDe(11, 20), 1);
  assert.equal(orcamentoDe(12, 20), 1);
  assert.equal(orcamentoDe(14, 20), 2);
  assert.equal(orcamentoDe(undefined, 6), 6);
});

test('orcamento-h-invalido-x-ausente', () => {
  for (const mr of [5, 7, 13, 24]) {
    const ausente = orcamentoDe(undefined, mr);
    for (const ruim of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '50' as unknown as number, null as unknown as number, {} as unknown as number]) {
      assert.equal(orcamentoDe(ruim, mr), ausente, `H ${String(ruim)} maxRows ${mr}`);
    }
  }
  // H = Infinity é desconhecido, não "tela infinita": não vira maxRows
  assert.equal(orcamentoDe(Number.POSITIVE_INFINITY, 20), 7);
  // H fracionário válido: o piso do ⌊H/2⌋ vale
  assert.equal(orcamentoDe(50.9, 30), 20);
});

test('orcamento-max-rows-invalido', () => {
  // 0, negativo, não inteiro, NaN, Infinity, não número ⇒ piso 1, sem lançar, com H conhecido e desconhecido
  for (const mr of [0, -1, -20, 6.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '6' as unknown as number, null as unknown as number, undefined as unknown as number]) {
    assert.equal(orcamentoDe(50, mr), 1, `H 50 maxRows ${String(mr)}`);
    assert.equal(orcamentoDe(undefined, mr), 1, `H ausente maxRows ${String(mr)}`);
  }
  assert.doesNotThrow(() => orcamentoDe(50, Number.NaN));
});

test('prioridade-1-a-k-na-ordem-de-exibicao', () => {
  // `ordem` é a posição na tela; a saída sai em `ordem`, mesmo com a entrada embaralhada
  const ls = [lp(3, 3, 'progresso'), lp(1, 1, 'topo'), lp(2, 2, 'trilha'), lp(4, 4, 'historico')];
  assert.deepEqual(textos(porPrioridade(ls, 4)), ['topo', 'trilha', 'progresso', 'historico']);
  assert.deepEqual(textos(porPrioridade([...ls].reverse(), 4)), ['topo', 'trilha', 'progresso', 'historico']);
  // a linha devolvida é a mesma `l` (campo lido, não só a contagem)
  const out = porPrioridade(ls, 4);
  assert.equal(out[0], ls[1].l);
  assert.equal(out[3], ls[3].l);
});

test('corte-por-prioridade-nao-por-ordem', () => {
  // exibição: histórico (prio 4) vem ANTES da trilha (prio 2) na tela; orçamento 2 fica com topo e trilha
  const ls = [lp(1, 1, 'topo'), lp(4, 2, 'historico'), lp(2, 3, 'trilha'), lp(3, 4, 'progresso')];
  assert.deepEqual(textos(porPrioridade(ls, 2)), ['topo', 'trilha']);
  assert.deepEqual(textos(porPrioridade(ls, 3)), ['topo', 'trilha', 'progresso']);
});

test('orcamento-4-tem-historico', () => {
  // H 18 ⇒ ⌊18/2⌋ − 5 = 4: topo, trilha, progresso, histórico; equipe e desenho fora
  const orc = orcamentoDe(18, 20);
  assert.equal(orc, 4);
  const ls = [lp(1, 1, 'topo'), lp(2, 2, 'trilha'), lp(3, 3, 'progresso'), lp(4, 4, 'historico'), lp(5, 5, 'equipe'), lp(6, 6, 'desenho')];
  assert.deepEqual(textos(porPrioridade(ls, orc)), ['topo', 'trilha', 'progresso', 'historico']);
  assert.deepEqual(textos(porPrioridade(ls, 5)), ['topo', 'trilha', 'progresso', 'historico', 'equipe']);
});

test('nunca-mais-que-orcamento', () => {
  const ls = Array.from({ length: 12 }, (_, i) => lp(i + 1, i + 1, `l${i + 1}`));
  for (let orc = 1; orc <= 12; orc++) assert.equal(porPrioridade(ls, orc).length, orc, `orçamento ${orc}`);
  assert.equal(porPrioridade(ls, 50).length, 12); // folga: tudo cabe, nada inventado
  assert.deepEqual(porPrioridade([], 5), []);
  // várias linhas de mesma prioridade (histórico até 5): empate por `ordem`, corta as últimas
  const hist = [lp(1, 1, 'topo'), lp(6, 2, 'h1'), lp(6, 3, 'h2'), lp(6, 4, 'h3')];
  assert.deepEqual(textos(porPrioridade(hist, 3)), ['topo', 'h1', 'h2']);
});

test('topo-nunca-sai-orcamento-1', () => {
  // orçamento 1: a linha de prioridade 1 fica e o resto sai
  const ls = [lp(2, 2, 'trilha'), lp(1, 1, 'PAROU'), lp(3, 3, 'progresso')];
  assert.deepEqual(textos(porPrioridade(ls, 1)), ['PAROU']);
  // orçamento inválido (0, negativo, NaN, Infinity) ⇒ trata como 1, sem lançar
  for (const o of [0, -3, Number.NaN, Number.NEGATIVE_INFINITY]) assert.deepEqual(textos(porPrioridade(ls, o)), ['PAROU'], `orçamento ${o}`);
  assert.equal(porPrioridade(ls, Number.POSITIVE_INFINITY).length, 3);
  assert.equal(porPrioridade(ls, 2.9).length, 2); // fração: piso
});

test('topo-2-linhas-orcamento-1-ficam-as-duas', () => {
  // P1 da Sombra: prioridade 1 com 2+ linhas (PAROU + "(+1)" da pergunta) e orçamento 1.
  // Decisão: o topo é uma unidade, nada some em silêncio. Todas as de prioridade 1 ficam, mesmo acima do orçamento;
  // as de prioridade maior só entram no que sobra (aqui, nada).
  const ls = [lp(1, 1, 'PAROU'), lp(1, 2, '(+1)'), lp(2, 3, 'trilha'), lp(3, 4, 'progresso')];
  assert.deepEqual(textos(porPrioridade(ls, 1)), ['PAROU', '(+1)']);
  assert.deepEqual(textos(porPrioridade(ls, 2)), ['PAROU', '(+1)']);
  // orçamento 3: topo (2) + 1 do que sobra, a de menor prioridade numérica
  assert.deepEqual(textos(porPrioridade(ls, 3)), ['PAROU', '(+1)', 'trilha']);
  assert.deepEqual(textos(porPrioridade(ls, 4)), ['PAROU', '(+1)', 'trilha', 'progresso']);
});

test('porPrioridade-total-e-pura', () => {
  const ls = [lp(2, 2, 'b'), lp(1, 1, 'a')];
  const copia = JSON.stringify(ls);
  porPrioridade(ls, 1);
  assert.equal(JSON.stringify(ls), copia, 'entrada não é alterada (nem reordenada)');
  assert.equal(ls[0].l[0].texto, 'b');
  // prioridade inválida (NaN, não número) é a última a entrar; prioridade ≤ 1 (0, −1) conta como topo
  const mista = [lp(Number.NaN, 1, 'nan'), lp(0, 2, 'zero'), lp(2, 3, 'dois')];
  assert.deepEqual(textos(porPrioridade(mista, 2)), ['zero', 'dois']);
  assert.deepEqual(textos(porPrioridade(mista, 3)), ['nan', 'zero', 'dois']);
  // empate total (mesma prioridade e mesma ordem): estável pela entrada
  const emp = [lp(5, 1, 'x'), lp(5, 1, 'y'), lp(5, 1, 'z')];
  assert.deepEqual(textos(porPrioridade(emp, 2)), ['x', 'y']);
});

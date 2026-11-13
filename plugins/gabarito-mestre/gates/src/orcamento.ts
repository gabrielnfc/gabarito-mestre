/**
 * Orçamento de linhas do painel e corte por prioridade (GM-14, REQ-GLB-1). Núcleo puro: sem I/O, sem relógio, nunca lança.
 */
import type { Linha } from './tipos.ts';

export type LinhaPrioridade = { prioridade: number; ordem: number; l: Linha };

/** Sem H, `maxRows` até este valor vale inteiro; acima, desconta a moldura (`REQ-GLB-1`). */
const MAX_ROWS_SEM_H = 7;
const MOLDURA_SEM_H = 6;
/** Linhas que o painel não ocupa quando H é conhecido: `⌊H/2⌋ − 5`. */
const MOLDURA_COM_H = 5;

/**
 * Linhas que cabem: `min(maxRows, ⌊H/2⌋ − 5)`, piso 1. H desconhecido (ausente, `NaN`, ≤ 0, infinito, não número) ⇒
 * `maxRows ≤ 7 ? maxRows : min(maxRows − 6, 7)`. `maxRows` que não é inteiro ≥ 1 ⇒ 1.
 */
export function orcamentoDe(h: number | undefined, maxRows: number): number {
  if (typeof maxRows !== 'number' || !Number.isInteger(maxRows) || maxRows < 1) return 1;
  const hConhecido = typeof h === 'number' && Number.isFinite(h) && h > 0;
  const n = hConhecido
    ? Math.min(maxRows, Math.floor((h as number) / 2) - MOLDURA_COM_H)
    : maxRows <= MAX_ROWS_SEM_H ? maxRows : Math.min(maxRows - MOLDURA_SEM_H, MAX_ROWS_SEM_H);
  return Math.max(1, n);
}

/** Prioridade usada no corte: `NaN`/não número entra por último; ≤ 1 é topo. */
const pesoDe = (p: unknown): number => (typeof p === 'number' && !Number.isNaN(p) ? Math.max(p, 1) : Number.POSITIVE_INFINITY);
const ordemDe = (o: unknown): number => (typeof o === 'number' && !Number.isNaN(o) ? o : Number.POSITIVE_INFINITY);

export type Cortadas = { linhas: Linha[]; cortadas: number; cortadasTopo: number };

/**
 * Linhas de prioridade 1..k, na ordem de exibição (`ordem`), SEMPRE no máximo `orcamento` (spec D15: nunca passa dele).
 * O corte é por prioridade e, entre iguais, por `ordem` (as de maior `ordem` saem); empate total, pela posição na entrada.
 * Com várias linhas de prioridade 1 e orçamento menor, ficam as de menor `ordem` (PAROU vence a pergunta) e as demais saem,
 * contadas em `cortadasTopo` para o `(+N)` do chamador (T17). `cortadas` conta toda linha que saiu. Não altera a entrada.
 * Orçamento inválido (`NaN`, ≤ 0) conta como 1; fração, piso. Prioridade `NaN`/não número é a última a entrar; < 1 é topo.
 */
export function cortarPorPrioridade(ls: LinhaPrioridade[], orcamento: number): Cortadas {
  const limite = typeof orcamento === 'number' && !Number.isNaN(orcamento) ? Math.max(1, Math.floor(orcamento)) : 1;
  const indexadas = ls.map((x, i) => ({ x, i, p: pesoDe(x.prioridade), o: ordemDe(x.ordem) }));
  const porCorte = [...indexadas].sort((a, b) => a.p - b.p || a.o - b.o || a.i - b.i);
  const ficam = new Set(porCorte.slice(0, limite));
  const linhas = indexadas
    .filter((e) => ficam.has(e))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((e) => e.x.l);
  const fora = porCorte.slice(limite);
  return { linhas, cortadas: fora.length, cortadasTopo: fora.filter((e) => e.p <= 1).length };
}

/** Só as linhas de `cortarPorPrioridade`: no máximo `orcamento`. */
export function porPrioridade(ls: LinhaPrioridade[], orcamento: number): Linha[] {
  return cortarPorPrioridade(ls, orcamento).linhas;
}

/** Prioridade da linha reservada (GM-14 T42, emenda 32): depois dos blocos 1–3, antes do ATENÇÃO (4) e do resto do RECENTE (5). */
export const PRIORIDADE_RESERVA = 3.5;
/** Prioridade do RECENTE (bloco 5, D-P8): é ele que, cortado inteiro, aciona a reserva. */
const PRIORIDADE_RECENTE = 5;

/**
 * `cortarPorPrioridade` com 1 linha reservada para a decisão da Sombra (REQ-GLB-1, emenda 32). Regra única das duas camadas (lateral e acima).
 * O corte normal por ORÇAMENTO tirou linhas do RECENTE (prioridade 5; inteiro OU em parte; sem corte por orçamento não há reserva) sem deixar a linha da decisão (`daDecisao`, as linhas de RECENTE que
 * são a decisão mais recente): `reserva` entra com `PRIORIDADE_RESERVA`. Cortado inteiro, ela cede só às de prioridade ≤ 3 e vence o ATENÇÃO; cortado em parte,
 * ela toma o lugar da ÚLTIMA linha de RECENTE que sobrou (o total de linhas não cresce). A decisão já entre as que sobraram, `reserva` nula ou sem RECENTE ⇒ corte de hoje.
 * `reserva.ordem` é ignorada: a linha vai depois de tudo na exibição.
 */
export function cortarComReserva(ls: LinhaPrioridade[], orcamento: number, reserva: Linha | null, daDecisao: Linha[] = []): Cortadas {
  const base = cortarPorPrioridade(ls, orcamento);
  if (reserva === null) return base;
  const recente = ls.filter((x) => pesoDe(x.prioridade) === PRIORIDADE_RECENTE);
  const sobras = recente.filter((x) => base.linhas.includes(x.l));
  // sem corte por ORÇAMENTO no RECENTE (nada dele saiu) não há reserva: vale o RECENTE normal com o seu teto (emenda 32)
  if (sobras.length === recente.length || sobras.some((x) => daDecisao.includes(x.l))) return base;
  // cortado em parte: a reserva (prioridade 3,5) entra e o corte seguinte tira a ÚLTIMA linha de RECENTE que sobrava (a de maior `ordem`), o total não cresce
  const fim = ls.reduce((m, x) => Math.max(m, ordemDe(x.ordem)), 0) + 1;
  return cortarPorPrioridade([...ls, { prioridade: PRIORIDADE_RESERVA, ordem: fim, l: reserva }], orcamento);
}

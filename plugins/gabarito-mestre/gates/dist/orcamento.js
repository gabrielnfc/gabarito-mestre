/**
 * Orçamento de linhas do painel e corte por prioridade (GM-14, REQ-GLB-1). Núcleo puro: sem I/O, sem relógio, nunca lança.
 */
                                        

                                                                              

/** Sem H, `maxRows` até este valor vale inteiro; acima, desconta a moldura (`REQ-GLB-1`). */
const MAX_ROWS_SEM_H = 7;
const MOLDURA_SEM_H = 6;
/** Linhas que o painel não ocupa quando H é conhecido: `⌊H/2⌋ − 5`. */
const MOLDURA_COM_H = 5;

/**
 * Linhas que cabem: `min(maxRows, ⌊H/2⌋ − 5)`, piso 1. H desconhecido (ausente, `NaN`, ≤ 0, infinito, não número) ⇒
 * `maxRows ≤ 7 ? maxRows : min(maxRows − 6, 7)`. `maxRows` que não é inteiro ≥ 1 ⇒ 1.
 */
export function orcamentoDe(h                    , maxRows        )         {
  if (typeof maxRows !== 'number' || !Number.isInteger(maxRows) || maxRows < 1) return 1;
  const hConhecido = typeof h === 'number' && Number.isFinite(h) && h > 0;
  const n = hConhecido
    ? Math.min(maxRows, Math.floor((h          ) / 2) - MOLDURA_COM_H)
    : maxRows <= MAX_ROWS_SEM_H ? maxRows : Math.min(maxRows - MOLDURA_SEM_H, MAX_ROWS_SEM_H);
  return Math.max(1, n);
}

/** Prioridade usada no corte: `NaN`/não número entra por último; ≤ 1 é topo. */
const pesoDe = (p         )         => (typeof p === 'number' && !Number.isNaN(p) ? Math.max(p, 1) : Number.POSITIVE_INFINITY);
const ordemDe = (o         )         => (typeof o === 'number' && !Number.isNaN(o) ? o : Number.POSITIVE_INFINITY);

/**
 * Linhas de prioridade 1..k, na ordem de exibição (`ordem`), até `orcamento`. Prioridade 1 (o topo) nunca sai: se há mais
 * linhas de topo que o orçamento (PAROU + `(+N)` com orçamento 1), todas ficam e nada de prioridade maior entra. Entre
 * prioridades iguais corta as de maior `ordem`; empate total, pela posição na entrada. Não altera a entrada.
 * Orçamento inválido (`NaN`, ≤ 0) conta como 1; fração, piso.
 */
export function porPrioridade(ls                   , orcamento        )          {
  const limite = typeof orcamento === 'number' && !Number.isNaN(orcamento) ? Math.max(1, Math.floor(orcamento)) : 1;
  const indexadas = ls.map((x, i) => ({ x, i, p: pesoDe(x.prioridade), o: ordemDe(x.ordem) }));
  const porCorte = [...indexadas].sort((a, b) => a.p - b.p || a.o - b.o || a.i - b.i);
  const topo = porCorte.filter((e) => e.p <= 1).length;
  const ficam = new Set(porCorte.slice(0, Math.max(topo, limite)));
  return indexadas
    .filter((e) => ficam.has(e))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((e) => e.x.l);
}

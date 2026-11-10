/**
 * Formatos compartilhados dos presets do painel (E4, GM-12 T4c, D-R3): números, tempo, previsão, estado da task, faixa de ids e alinhamento.
 * Esquadrão e Executivo importam daqui, então `412k`, `±25m` e "loop parado" têm uma única escrita.
 * Núcleo puro: sem `node:*`, sem relógio, sem `Intl` (o mod carrega o `dist/`).
 *
 * Contrato de falha: número ausente é `null` (`—` ou omissão); número corrompido (`NaN`, `Infinity`, negativo onde o valor não pode ser negativo)
 * também vira ausente e NUNCA texto. `0` é `0`, nunca omitido (ausente ≠ zero).
 */

import { colunas } from './painel-largura.ts';
import { cortarLinha } from './painel-texto.ts';
import type { CorTema, EstadoPainel, Linha, Papel } from './tipos.ts';
import type { EstadoTask } from './loop.ts';

/** Número finito, senão `null` (nunca `NaN`/`Infinity` no texto). */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Valor que não pode ser negativo (tokens, segundos, %): negativo é dado corrompido, igual a ausente. */
const naoNegativo = (v: unknown): number | null => {
  const n = num(v);
  return n === null || n < 0 ? null : n;
};

const MDASH = '—';

/** `< 1000` ⇒ `N`; `< 1e6` ⇒ `round(n/1000)k`; senão `N.NM` (1 casa, ponto); ausente ⇒ `—`. 999 500 já arredonda para 1000k, então vira `1.0M`. */
export function fmtTok(n: unknown): string {
  const v = naoNegativo(n);
  if (v === null) return MDASH;
  if (v < 1000) return String(Math.round(v));
  if (v < 1e6 && Math.round(v / 1000) < 1000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1e6).toFixed(1)}M`;
}

/** Ausente ⇒ `''`; `< 3600` ⇒ `floor(s/60)m`; senão `<h>h<mm>`. */
export function fmtTempo(s: unknown): string {
  const v = naoNegativo(s);
  if (v === null) return '';
  if (v < 3600) return `${Math.floor(v / 60)}m`;
  return `${Math.floor(v / 3600)}h${String(Math.floor((v % 3600) / 60)).padStart(2, '0')}`;
}

/** `round(p)%`, sem teto (ctx pode passar de 100; a barra satura); ausente ⇒ `—`. */
export function fmtPct(p: unknown): string {
  const v = naoNegativo(p);
  return v === null ? MDASH : `${Math.round(v)}%`;
}

export type Previsao =
  | { tipo: 'parado' | 'pausado' | 'todas' | 'sem_dados' }
  | { tipo: 'eta'; hora: string; outroDia: boolean; maisMenosMin: number; n: number };

/** Previsão do plano; a 1ª que casar: parar, pausa, todas integradas, sem ETA, ETA. */
export function previsao(e: EstadoPainel): Previsao {
  if (e.parar !== null) return { tipo: 'parado' };
  if (e.parado) return { tipo: 'pausado' };
  const { total, feitas, eta } = e.plano;
  if (total > 0 && feitas === total) return { tipo: 'todas' };
  if (eta === null) return { tipo: 'sem_dados' };
  const mm = naoNegativo(eta.maisMenosS);
  return { tipo: 'eta', hora: eta.hora, outroDia: eta.hora.includes('/'), maisMenosMin: mm === null ? 0 : Math.round(mm / 60), n: eta.n };
}

const TEXTO_ESTADO: Readonly<Record<EstadoTask, string>> = {
  pendente: 'fila', implementando: 'implementando', em_revisao: 'em revisão', corrigindo: 'corrigindo', reprovada: 'reprovada',
  concluida: 'aguarda revisão', aprovada: 'aprovada', no_teto: 'no teto', integrada: '',
};
const COR_ESTADO: Readonly<Record<EstadoTask, CorTema>> = {
  pendente: 'inactive', implementando: 'success', em_revisao: 'success', corrigindo: 'warning', reprovada: 'warning',
  concluida: 'warning', aprovada: 'warning', no_teto: 'warning', integrada: 'success',
};

/** Texto do estado da task (tabela T-E). `integrada` não tem texto (a faixa leva `✓`); estado desconhecido ⇒ `''`. */
export function textoEstadoTask(estado: EstadoTask | null | undefined): string {
  return estado != null && Object.hasOwn(TEXTO_ESTADO, estado) ? TEXTO_ESTADO[estado] : '';
}

/** Cor do glifo e do texto do estado (tabela T-E); `no_teto` é `warning`, nunca `error`; estado desconhecido ⇒ `inactive`. */
export function corEstadoTask(estado: EstadoTask | null | undefined): CorTema {
  return estado != null && Object.hasOwn(COR_ESTADO, estado) ? COR_ESTADO[estado] : 'inactive';
}

const TEXTO_PAPEL: Readonly<Record<Papel, string>> = { implementador: 'implementando', correcao: 'corrigindo', revisor: 'em revisão' };

/** Verbo do papel do agente; papel `null` ou desconhecido ⇒ `''`. */
export function textoDoPapel(papel: Papel | null | undefined): string {
  return papel != null && Object.hasOwn(TEXTO_PAPEL, papel) ? TEXTO_PAPEL[papel] : '';
}

/** 1 id ⇒ ele; contíguos na ordem do plano ⇒ `<a>–<b>`; senão `<n> tasks`. Sem id ⇒ `''`; id fora do plano nunca é contíguo. */
export function faixaIds(ids: readonly string[], ordemDoPlano: readonly string[]): string {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return '';
  if (unicos.length === 1) return unicos[0];
  const idx = unicos.map((id) => ordemDoPlano.indexOf(id)).sort((a, b) => a - b);
  const contiguo = idx[0] >= 0 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return contiguo ? `${ordemDoPlano[idx[0]]}–${ordemDoPlano[idx[idx.length - 1]]}` : `${unicos.length} tasks`;
}

const largura = (l: Linha): number => l.reduce((n, s) => n + colunas(s.texto), 0);
const larguraOk = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && Math.floor(v) >= 1 ? Math.floor(v) : null);

/**
 * `dir` encostada à direita, com 1 espaço no mínimo entre as pontas. Sem espaço, `esq` é cortada primeiro, até o mínimo (o 1º segmento de `esq`,
 * onde o chamador põe `GABARITO · <id>`); se nem assim cabe, `dir` cai inteira e `esq` ocupa a linha. Largura inválida ⇒ `[]`.
 */
export function alinhar(esq: Linha, dir: Linha, larg: number): Linha {
  const w = larguraOk(larg);
  if (w === null) return [];
  const ce = largura(esq);
  const cd = largura(dir);
  if (cd === 0) return cortarLinha(esq, w);
  if (ce + 1 + cd <= w) return [...esq, { texto: ' '.repeat(w - ce - cd) }, ...dir];
  const disponivel = w - cd - 1;
  const minimo = esq.length > 0 ? colunas(esq[0].texto) : 0;
  if (disponivel >= Math.min(minimo, ce) && disponivel >= 1) {
    // no mínimo exato sobra só o 1º segmento (`GABARITO · <id>`), inteiro: cortá-lo por causa do que veio depois esconderia o id
    const cortada = disponivel === minimo ? [esq[0]] : cortarLinha(esq, disponivel);
    return [...cortada, { texto: ' '.repeat(w - largura(cortada) - cd) }, ...dir];
  }
  return cortarLinha(esq, w);
}

/** `─` × largura, sem cor. Largura inválida ⇒ `[]`. */
export function separador(larg: number): Linha {
  const w = larguraOk(larg);
  return w === null ? [] : [{ texto: '─'.repeat(w) }];
}

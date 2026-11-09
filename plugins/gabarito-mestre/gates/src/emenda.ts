/**
 * Núcleo puro de emendas (GM-11 T3, REQ-EME-1, EME-2). Sem E/S e sem relógio: o instante entra pelo evento, nunca por `Date.now()`.
 * A proposta é `emenda.proposta` de forma válida gravada na sessão fixa `emendas`; o julgamento (`spec.emendada` / `emenda.rejeitada`)
 * vem de qualquer sessão (o hook do dono grava na sessão dele) e o 1º julgamento válido, na ordem de `ordenar`, fecha a proposta.
 *
 * Contrato de falha: diário ausente (`[]`) é estado vazio; diário corrompido (fora de ordem) é estado vazio COM `invalido`, e
 * os dois validadores recusam. Estado vazio sem `invalido` descongelaria todo REQ e levaria `versaoDoReq` a 0 (hash da Sombra errado).
 */

import { ordenar } from './loop.ts';
import { formaInvalida } from './formas.ts';
import { normalizarCaminho, temDependencia } from './plano.ts';
import type { Causa, Evento, OrigemJulgamento, Plano } from './tipos.ts';

export const SESSAO_EMENDAS = 'emendas';

export type Proposta = { seq: number; req: string; task?: string; diff: string; arquivos: string[]; causa: Causa; ts: string };
export type EstadoEmendas = {
  abertas: Proposta[];
  aprovadas: (Proposta & { origem: OrigemJulgamento })[];
  rejeitadas: Proposta[];
  /** Só presente quando o diário não pôde ser ordenado: nunca é estado vazio "limpo". */
  invalido?: string;
};

const INVALIDO = 'diário fora de ordem';
const vazio = (): EstadoEmendas => ({ abertas: [], aprovadas: [], rejeitadas: [] });
const ehObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const campo = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Caminhos normalizados (mesma regra de `plano.ts`), sem repetição; o inválido é descartado. */
function normalizados(brutos: readonly unknown[]): string[] {
  const saida: string[] = [];
  for (const b of brutos) {
    const n = typeof b === 'string' ? normalizarCaminho(b) : null;
    if (n !== null && !saida.includes(n)) saida.push(n);
  }
  return saida;
}

/** Proposta de um evento, ou `null` se não é `emenda.proposta` válida da sessão `emendas`. */
function comoProposta(e: Evento): Proposta | null {
  if (e.tipo !== 'emenda.proposta' || e.sessao !== SESSAO_EMENDAS) return null;
  if (formaInvalida('emenda.proposta', e.dados) !== null) return null;
  const d = e.dados;
  const arquivos = campo(d, 'arquivos');
  const task = campo(d, 'task');
  return {
    seq: e.seq,
    req: campo(d, 'req') as string,
    ...(typeof task === 'string' ? { task } : {}),
    diff: campo(d, 'diff') as string,
    arquivos: Array.isArray(arquivos) ? normalizados(arquivos) : [],
    causa: campo(d, 'causa') as Causa,
    ts: e.ts,
  };
}

/** `[proposta_seq, origem]` de um julgamento de forma válida, ou `null`. */
function comoJulgamento(e: Evento): { seq: number; origem: OrigemJulgamento; aprova: boolean } | null {
  if (e.tipo !== 'spec.emendada' && e.tipo !== 'emenda.rejeitada') return null;
  if (formaInvalida(e.tipo, e.dados) !== null) return null;
  return { seq: campo(e.dados, 'proposta_seq') as number, origem: campo(e.dados, 'origem') as OrigemJulgamento, aprova: e.tipo === 'spec.emendada' };
}

export function projetarEmendas(eventos: Evento[]): EstadoEmendas {
  if (!Array.isArray(eventos)) return { ...vazio(), invalido: INVALIDO };
  if (eventos.length === 0) return vazio();
  let ordem: ReturnType<typeof ordenar>;
  try {
    ordem = ordenar(eventos);
  } catch {
    return { ...vazio(), invalido: INVALIDO };
  }
  if (!ordem.ok) return { ...vazio(), invalido: INVALIDO };

  // 1ª passada: as propostas. Um julgamento pode vir antes da proposta em `ordenar` (empate de ts), então não dá para fechar de passagem.
  const propostas = new Map<number, Proposta>();
  for (const e of ordem.eventos) {
    if (!ehObjeto(e)) continue;
    const p = comoProposta(e);
    if (p !== null) propostas.set(p.seq, p);
  }

  // 2ª passada: o 1º julgamento válido na ordem do diário fecha a proposta; os seguintes são ignorados.
  const est = vazio();
  const julgadas = new Set<number>();
  for (const e of ordem.eventos) {
    if (!ehObjeto(e)) continue;
    const j = comoJulgamento(e);
    if (j === null) continue;
    const p = propostas.get(j.seq);
    if (p === undefined || julgadas.has(j.seq)) continue;
    julgadas.add(j.seq);
    if (j.aprova) est.aprovadas.push({ ...p, origem: j.origem });
    else est.rejeitadas.push(p);
  }
  est.abertas = [...propostas.values()].filter((p) => !julgadas.has(p.seq)).sort((a, b) => a.seq - b.seq);
  return est;
}

/** `seq` da última aprovada do REQ, na ordem do julgamento; nenhuma ⇒ 0. */
export function versaoDoReq(est: EstadoEmendas, req: string): number {
  for (let i = est.aprovadas.length - 1; i >= 0; i--) if (est.aprovadas[i].req === req) return est.aprovadas[i].seq;
  return 0;
}

/** REQs com proposta aberta. Diário inválido ⇒ vazio: quem chama já parou antes (`diario_invalido`). */
export function reqsCongelados(est: EstadoEmendas): Set<string> {
  if (est.invalido !== undefined) return new Set();
  return new Set(est.abertas.map((p) => p.req));
}

/** Arquivos da task somados aos das aprovadas da própria task, normalizados e sem repetição. Task fora do plano ⇒ `[]` (fecha o gate). */
export function escopoDaTask(plano: Plano, est: EstadoEmendas, task: string): string[] {
  const t = plano.tasks.find((x) => x.id === task);
  if (t === undefined) return [];
  return normalizados([...t.arquivos, ...est.aprovadas.filter((p) => p.task === task).flatMap((p) => p.arquivos)]);
}

/** Motivo pelo qual a proposta não pode ser gravada, ou `null`. Ordem V0..V6: o 1º que casa vence. */
export function validarProposta(plano: Plano, est: EstadoEmendas, dados: Record<string, unknown>): string | null {
  if (est.invalido !== undefined) return est.invalido;
  const forma = formaInvalida('emenda.proposta', dados);
  if (forma !== null) return forma;
  const taskBruta = campo(dados, 'task');
  const task = typeof taskBruta === 'string' ? taskBruta : undefined;
  const brutos = (campo(dados, 'arquivos') ?? []) as string[];
  const t = task === undefined ? undefined : plano.tasks.find((x) => x.id === task);
  if (task !== undefined && t === undefined) return 'task fora do plano';
  if (t !== undefined && (t.reqs === undefined || !t.reqs.includes(campo(dados, 'req') as string))) return 'req fora da task';
  if (task === undefined && brutos.length > 0) return 'arquivos exigem task';
  const arquivos: string[] = [];
  for (const c of brutos) {
    const n = normalizarCaminho(c);
    if (n === null) return `caminho inválido: ${c}`;
    arquivos.push(n);
  }
  if (task !== undefined) {
    for (const outra of plano.tasks) {
      if (outra.id === task || temDependencia(plano, task, outra.id)) continue;
      const dela = new Set([...escopoDaTask(plano, est, outra.id), ...est.abertas.filter((p) => p.task === outra.id).flatMap((p) => p.arquivos)]);
      const f = arquivos.find((a) => dela.has(a));
      if (f !== undefined) return `arquivo ${f} colide com ${outra.id} sem dependência`;
    }
  }
  return null;
}

/** Motivo pelo qual o julgamento não pode ser gravado, ou `null`. Ordem J0..J5. `origem:'dono'` não depende de `julgaEmendas`. */
export function validarJulgamento(est: EstadoEmendas, proposta_seq: number, origem: OrigemJulgamento, julgaEmendas: boolean): string | null {
  if (est.invalido !== undefined) return est.invalido;
  if (typeof proposta_seq !== 'number' || !Number.isInteger(proposta_seq) || proposta_seq < 1) return 'proposta_seq inválido: esperado inteiro ≥ 1';
  if (origem !== 'dono' && origem !== 'sombra') return 'origem inválida: esperado dono ou sombra';
  if (origem === 'sombra' && julgaEmendas !== true) return 'origem sombra sem sombra.julga_emendas';
  if (est.aprovadas.some((p) => p.seq === proposta_seq) || est.rejeitadas.some((p) => p.seq === proposta_seq)) return 'proposta já julgada';
  if (!est.abertas.some((p) => p.seq === proposta_seq)) return 'proposta inexistente';
  return null;
}

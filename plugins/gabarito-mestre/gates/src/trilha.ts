/**
 * Trilha da entrega: 7 fases, marcas e progresso (GM-14, REQ-TRI-1). Núcleo puro.
 * STUB da T1: a T3 implementa. Até lá toda função lança `nao_implementado`.
 */
import type { Evento } from './tipos.ts';

export const FASES = Object.freeze(['ideia', 'spec', 'aprovacao', 'plano', 'execucao', 'pr', 'uso'] as const);
export type Marca = '✓' | '●' | '○' | '?';
export type SpecFato = { caminho: string; pbi: string | null; sha256: string; secoes: number; titulo: string };
export type FatosTrilha = {
  branch: string | null; idPadrao: string; specs: SpecFato[]; plano: { tasks: string[] } | null;
  ledger: boolean; gh: 'ok' | 'falhou' | 'nunca'; ultimas: { id: string; data: string }[];
};
export type Trilha = {
  entrega: string | null; identificada: boolean; candidato: string | null; marcas: Marca[]; motivos: (string | null)[];
  fase: number | null; progresso: string; mudouDepois: boolean; ultimaConhecida: string | null; ambigua: SpecFato[];
};

const naoImplementado = (nome: string): never => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** ID da entrega pelo último segmento da branch (prefixo de 1 ou 2 tokens que casa `idPadrao` ancorado); `null` sem casamento. */
export function idDaBranch(_branch: string | null, _idPadrao: string): string | null {
  return naoImplementado('idDaBranch');
}

export function trilhaDe(_fatos: FatosTrilha, _eventos: Evento[]): Trilha {
  return naoImplementado('trilhaDe');
}

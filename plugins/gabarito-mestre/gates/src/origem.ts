/**
 * Origem de cada fato, normalização de nomes e regex técnica (GM-14, REQ-LNG-1). Núcleo puro.
 * STUB da T1: a T4 implementa. `REGEX_TECNICA` já é o literal das Global Constraints do plano; as funções lançam `nao_implementado`.
 */
import type { Evento } from './tipos.ts';

export const REGEX_TECNICA: RegExp = /[`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b/;

const naoImplementado = (nome: string): never => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** Tabela fechada de origem; tipo fora dela ⇒ `null`. */
export function origemDe(_ev: Evento): string | null {
  return naoImplementado('origemDe');
}

export function linhaTecnica(_texto: string): boolean {
  return naoImplementado('linhaTecnica');
}

export function nomeNatural(_nome: string): string {
  return naoImplementado('nomeNatural');
}

export function tagNatural(_tag: string): string | null {
  return naoImplementado('tagNatural');
}

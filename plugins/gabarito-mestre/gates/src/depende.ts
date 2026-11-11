/**
 * "Depende de você" fora do loop (GM-14, REQ-DEP-1). Núcleo puro.
 * STUB da T1: a T13 implementa. Até lá toda função lança `nao_implementado`.
 */
import type { Evento, ItemDepende } from './tipos.ts';
import type { Trilha } from './trilha.ts';

const naoImplementado = (nome: string): never => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** `base` (E4 REQ-PNL-2) primeiro, depois os itens (1)–(4) de REQ-DEP-1. */
export function dependeDe(_trilha: Trilha, _eventos: Evento[], _base: ItemDepende[]): ItemDepende[] {
  return naoImplementado('dependeDe');
}

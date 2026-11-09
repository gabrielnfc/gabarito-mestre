/** Preset Esquadrão (E4, T5). Stub da T1: uma linha fixa, para o despacho de `renderPainel` ser testável antes do render existir. */

import type { EstadoPainel, Linha, OpcoesRender } from './tipos.ts';

export function renderEsquadrao(_e: EstadoPainel, _o: OpcoesRender): Linha[] {
  return [[{ texto: 'esquadrão (T5 não implementada)' }]];
}

/** Preset Executivo (E4, T6). Stub da T1: uma linha fixa, para o despacho de `renderPainel` ser testável antes do render existir. */

import type { EstadoPainel, Linha, OpcoesRender } from './tipos.ts';

export function renderExecutivo(_e: EstadoPainel, _o: OpcoesRender): Linha[] {
  return [[{ texto: 'executivo (T6 não implementada)' }]];
}

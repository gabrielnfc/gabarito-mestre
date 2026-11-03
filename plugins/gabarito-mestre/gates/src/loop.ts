/** Núcleo puro do loop (REQ-LOOP-2). Task 1: só contratos reexportados; `proximaAcao` chega na Task 2. */

import type { AcaoLoop, Evento, Plano, Sinais } from './tipos.ts';

export type { AcaoLoop, MotivoParar, Papel, Plano, Sinais, TaskPlano } from './tipos.ts';

export function proximaAcao(_plano: Plano, _eventos: Evento[], _sinais: Sinais): AcaoLoop {
  throw new Error('não implementado');
}

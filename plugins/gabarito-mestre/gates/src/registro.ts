/**
 * Registro de decisões determinístico (GM-13, REQ-REG-1). T1: só o contrato; a implementação é da T11.
 * Lança até lá: registro nunca é gerado vazio por stub.
 */
import type { Evento } from './tipos.ts';

export function montarRegistro(_entrega: string, _eventos: Evento[], _specSha: string | null): string {
  throw new Error('nao_implementado: montarRegistro (T11 da E5a)');
}

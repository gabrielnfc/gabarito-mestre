/**
 * Núcleo do aprendizado (GM-13, REQ-APR-1/3). T1: só o contrato; a implementação é da T2.
 * Cada export lança até lá, para ninguém tomar o stub por sucesso (contrato de falha: dado ausente não vira "0 aprendizados").
 */
import type { DadosAprendizado, Evento } from './tipos.ts';

export type AprendizadoVigente = DadosAprendizado & { entrega: string; sessao: string; seq: number; ts: string };

const naoImplementado = (nome: string): never => { throw new Error(`nao_implementado: ${nome} (T2 da E5a)`); };

export function validarAprendizado(_eventosDaEntrega: Evento[], _dados: DadosAprendizado, _entrega: string, _porEntrega: Map<string, Evento[]>): string | null {
  return naoImplementado('validarAprendizado');
}
export function aprendizadosVigentes(_porEntrega: Map<string, Evento[]>): AprendizadoVigente[] {
  return naoImplementado('aprendizadosVigentes');
}
/** Só D, com `entra_em` incluindo o destino. */
export function paraDestino(_v: AprendizadoVigente[], _destino: string): AprendizadoVigente[] {
  return naoImplementado('paraDestino');
}

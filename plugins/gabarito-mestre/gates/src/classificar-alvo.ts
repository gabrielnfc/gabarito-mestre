import type { Classificacao, ConfigGuarda, Contexto, EntradaHook } from './tipos.ts';

// STUB (RED T1b): a implementação vem na T2.
export function classificar(entrada: EntradaHook, ambientes: ConfigGuarda | null, contexto: Contexto): Classificacao {
  void entrada; void ambientes; void contexto;
  throw new Error('não implementado (RED T1b)');
}

export function precisaContexto(entrada: EntradaHook): boolean {
  void entrada;
  throw new Error('não implementado (RED T1b)');
}

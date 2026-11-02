import type { ConfigGuarda, Contexto, Decisao, EntradaHook } from './tipos.ts';

// STUB (RED T1b): a implementação vem na T3.
export function decidir(entrada: EntradaHook, config: ConfigGuarda | null, contexto: Contexto): Decisao {
  void entrada; void config; void contexto;
  throw new Error('não implementado (RED T1b)');
}

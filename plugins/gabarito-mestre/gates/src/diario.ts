import type { Evento } from './tipos.ts';

// STUB (RED T1b): a implementação vem na T6.
export function recusaCanario(linha: string): string | null {
  void linha;
  throw new Error('não implementado (RED T1b)');
}

export function append(
  dir: string,
  sessao: string,
  ev: Omit<Evento, 'seq' | 'hash_anterior'>,
  opts?: { agora?: () => number },
): { ok: true; gravado: 'evento' | 'recusa' } | { ok: false; erro: string } {
  void dir; void sessao; void ev; void opts;
  throw new Error('não implementado (RED T1b)');
}

export function ler(dir: string): Evento[] {
  void dir;
  throw new Error('não implementado (RED T1b)');
}

export function projetar(eventos: Evento[]): { instantaneo: string; resumo: Record<string, number> } {
  void eventos;
  throw new Error('não implementado (RED T1b)');
}

export function dirEntrega(raiz: string, pbi: string | null): string {
  void raiz; void pbi;
  throw new Error('não implementado (RED T1b)');
}

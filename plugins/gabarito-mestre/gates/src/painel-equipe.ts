/**
 * Equipe do painel (E4, T3). T1 entrega `casarAgente` completo (T2 precisa dele para `●`/`◐`) e `projetarEquipe` como stub
 * (equipe vazia, sem lançar). Puro: sem `fs`, `process` nem `Date.now()`.
 */

import type { EntradaPainel, EstadoPainel, Papel, Plano } from './tipos.ts';

const DESCRICAO_RE = /^(\S+) (implementador|revisor|correcao)$/;

/**
 * Liga o agente vivo à task pela `description` do `Agent` (D3), que é `"<task> <papel>"` do item de `loop.mjs proxima`.
 * Nunca por aproximação: depois de `trim`, só o padrão exato, com task do plano e papel conhecido; qualquer outra coisa é `null`
 * (o render escreve `sem task`). `description` que não é texto também é `null`, sem lançar.
 */
export function casarAgente(description: string, plano: Plano): { task: string; papel: Papel } | null {
  if (typeof description !== 'string') return null;
  const m = DESCRICAO_RE.exec(description.trim());
  if (m === null) return null;
  const tasks = plano !== null && typeof plano === 'object' && Array.isArray(plano.tasks) ? plano.tasks : [];
  if (!tasks.some((t) => t.id === m[1])) return null;
  return { task: m[1], papel: m[2] as Papel };
}

/** Stub da T1: equipe vazia (sem agentes, sem revisor aguardando, Sombra sem decisões). A T3 projeta de verdade. */
export function projetarEquipe(_plano: Plano, _eventos: unknown[], entrada: EntradaPainel): EstadoPainel['equipe'] {
  return {
    lider: { nome: entrada.pacote.lider, modelo: null, ctx: null, x: entrada.x, tok: null, h5: entrada.limites.h5, d7: entrada.limites.d7, narrativa: '' },
    agentes: [],
    revisoresAguardando: [],
    sombra: { nome: entrada.pacote.sabio, modelo: null, decisoes: 0, ultima: null },
  };
}

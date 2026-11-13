import type { Evento } from './tipos.ts';

/**
 * Pouso pendente (GM-14 FIEL-14 e): a ÚNICA definição. `loop.mjs proxima` (via `proximaAcao`) e o painel (via `dependeDe`) a importam; nenhuma
 * outra regra decide se a conversa ainda precisa ser limpa. Pura e sem `node:` (o mod a importa).
 *
 * Só vale com onboarding (FIEL-14 h): 2º argumento `onboarding === true`, senão `{pendente:false}`.
 * Pendente = existe `sessao.pouso` e nenhum `sessao.inicio {origem: 'clear'}` posterior (por `ts`, estrito) de OUTRA sessão que a do pouso
 * (nenhuma outra definição). `sessao.retomada` não tira o pendente; `startup` e `resume` (sessão paralela, retomada) também não. `ts` ilegível no início ⇒ ele não conta (falha para o lado de manter o pedido).
 */
export type PousoPendente = { pendente: boolean; sessao: string | null; seq: number | null };

const msDe = (e: Evento): number => (typeof e?.ts === 'string' ? Date.parse(e.ts) : Number.NaN);

export function pousoPendente(eventos: Evento[] | null | undefined, onboarding?: boolean): PousoPendente {
  const nenhum: PousoPendente = { pendente: false, sessao: null, seq: null };
  // FIEL-14 h: sem onboarding o diário não registra `sessao.inicio` (Q20), então um pendente nunca teria saída. O fato vem de quem chama
  // (`temOnboarding` de `cartao-sessao.mjs`, a mesma leitura do cartão); ausente ou não verdadeiro ⇒ nunca pendente.
  if (onboarding !== true) return nenhum;
  if (!Array.isArray(eventos)) return nenhum;
  let ultimo: Evento | null = null;
  let ms = Number.NEGATIVE_INFINITY;
  for (const e of eventos) {
    if (e?.tipo !== 'sessao.pouso') continue;
    const t = msDe(e);
    const m = Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    if (ultimo === null || m >= ms) { ultimo = e; ms = m; }
  }
  if (ultimo === null) return nenhum;
  const limpou = eventos.some((e) => {
    const t = msDe(e);
    if (!Number.isFinite(t) || !Number.isFinite(ms) || t <= ms) return false;
    const d = e?.dados as Record<string, unknown> | null | undefined;
    if (d === null || typeof d !== 'object') return false;
    return e.tipo === 'sessao.inicio' && e.sessao !== ultimo.sessao && d.origem === 'clear';
  });
  return limpou ? nenhum : { pendente: true, sessao: ultimo.sessao, seq: ultimo.seq };
}

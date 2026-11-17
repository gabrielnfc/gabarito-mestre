import type { Evento } from './tipos.ts';
import { pousoDaFronteira } from './pouso.ts';

/**
 * Pouso pendente (GM-14 FIEL-14 e): a ÚNICA definição. `loop.mjs proxima` (via `proximaAcao`), o hook Stop, o mod (a contagem de tentativas) e o painel
 * (via `dependeDe`) a importam; nenhuma outra regra decide se a conversa ainda precisa ser limpa. Pura e sem `node:` (o mod a importa). A fronteira é a de `pousoDaFronteira` (pouso.ts), a única.
 *
 * Só vale com onboarding (FIEL-14 h) no modo por evento: 2º argumento `onboarding === true`, senão `{pendente:false}`.
 *
 * GM-14 T53 (emendas 52 e 53), invariante POR SESSÃO. Quem decide é sempre a sessão que pergunta, pela PRÓPRIA leitura de contexto
 * (`.harness/contexto/<sessao>.json`, fonte `mod`, até 120 s); nenhuma sessão libera ou prende outra (nem sucessora, nem cache, nem janela):
 *  - leitura própria fresca ⇒ pendente = há `sessao.pouso` e a própria leitura segue em X ou acima (o /clear não a limpou); abaixo de X não há pendência;
 *  - sem leitura própria fresca (mod desligado, sessão sem mod) ⇒ a regra sem mod: `sessao.pouso` sem `sessao.inicio {origem: 'clear'}` posterior, de OUTRA
 *    sessão que a do pouso (sessão paralela, `startup` e `resume` não tiram; `ts` ilegível no início ⇒ ele não conta).
 *  - GM-15 T33 (emenda 12, g.18): ACRESCENTA um caminho de fechamento, sem tirar nenhum. Sem leitura própria, o pouso também fecha quando há `sessao.retomada`
 *    (ou `sessao.inicio` de origem diferente de `clear`) de sessão DIFERENTE da que pousou, posterior ao pouso, E a leitura medida DESSA sessão nova (a mesma
 *    fonte, validade e X de `leituraPropria`, em `medicao.leituras`) está abaixo de X; sem medição dela, esse caminho não fecha. `sessao.inicio {clear}` segue
 *    fechando como antes, sem leitura.
 * `sessao.pouso.tentativa {n}` (a repetição do pouso pelo mod) NÃO é `sessao.pouso`: não entra na procura do último pouso, portanto não muda `seq`
 * (a chave do push `chavePouso`, mod/painel.mjs). Só conta tentativas (`tentativasDoPouso`).
 */
export type PousoPendente = { pendente: boolean; sessao: string | null; seq: number | null };

export const VALIDADE_LEITURA_MS = 120_000;
/** Tentativas do pouso por fronteira (por veredito): o 1º `sessao.pouso` mais as repetições. A 4ª não existe: `loop.parar {sem_pouso}`. */
export const MAX_TENTATIVAS = 3;
export const ESPERA_ENTRE_TENTATIVAS_MS = 60_000;

/** `.harness/contexto/<sessao>.json` `{percent, fonte, em}`; `emMs` já em número. */
export type Leitura = { sessao: string; percent: number; fonte: string; emMs: number };
export type Medicao = {
  x: number;
  agoraMs: number;
  /** A sessão de quem pergunta (o mod: `$.session.id()`; o Stop e `proxima`: `session_id`/`--sessao`). Nulo quando não se sabe. */
  sessaoAtual: string | null;
  /** As leituras que o chamador tem; só a de `sessaoAtual` é usada. */
  leituras: Leitura[];
};

const msDe = (e: Evento): number => (typeof e?.ts === 'string' ? Date.parse(e.ts) : Number.NaN);

/** Parse de um `contexto/<sessao>.json` (texto). Fora da forma, `percent` fora de [0,100] ou `em` ilegível ⇒ `null`. Nunca lança. */
export function lerLeitura(sessao: string, texto: string): Leitura | null {
  let j: unknown;
  try { j = JSON.parse(texto); } catch { return null; }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (typeof o.percent !== 'number' || !Number.isFinite(o.percent) || o.percent < 0 || o.percent > 100) return null;
  if (typeof o.fonte !== 'string' || typeof o.em !== 'string') return null;
  const em = Date.parse(o.em);
  return Number.isFinite(em) ? { sessao, percent: o.percent, fonte: o.fonte, emMs: em } : null;
}

/** A leitura PRÓPRIA da sessão que pergunta, se fresca (`mod`, até 120 s, no máximo 5 s no futuro); senão `null`. */
export function leituraPropria(med: Medicao | undefined): Leitura | null {
  if (med === undefined || med.sessaoAtual === null) return null;
  const l = med.leituras.find((x) => x.sessao === med.sessaoAtual);
  if (l === undefined || l.fonte !== 'mod' || !Number.isFinite(l.emMs) || !Number.isFinite(l.percent) || l.percent < 0 || l.percent > 100) return null;
  return med.agoraMs - l.emMs <= VALIDADE_LEITURA_MS && l.emMs - med.agoraMs <= 5_000 ? l : null;
}

/** `true` quando a leitura própria fresca está em X ou acima: a sessão não pode despachar. Desconhecido não é teto. */
export function noTeto(med: Medicao): boolean {
  const l = leituraPropria(med);
  return l !== null && l.percent >= med.x;
}

function ultimoPouso(eventos: Evento[]): { e: Evento; ms: number } | null {
  let ultimo: Evento | null = null;
  let ms = Number.NEGATIVE_INFINITY;
  for (const e of eventos) {
    if (e?.tipo !== 'sessao.pouso') continue; // a tentativa (`sessao.pouso.tentativa`) NÃO é pouso: tipo diferente, igualdade estrita
    const t = msDe(e);
    const m = Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    if (ultimo === null || m >= ms) { ultimo = e; ms = m; }
  }
  return ultimo === null ? null : { e: ultimo, ms };
}

/**
 * Tentativas do pouso desta fronteira (a do último `review.veredito`): `sessao.pouso` mais `sessao.pouso.tentativa` com `ts` depois dele, de QUALQUER sessão
 * (um laço de /clear não se desfaz por seq novo, por sessão nova nem por submit falho). `n` = quantas, `ultimoMs` = a mais recente (ou `null`).
 */
export function tentativasDoPouso(eventos: Evento[] | null | undefined): { n: number; ultimoMs: number | null } {
  if (!Array.isArray(eventos)) return { n: 0, ultimoMs: null };
  let veredito = Number.NEGATIVE_INFINITY;
  for (const e of eventos) {
    if (e?.tipo !== 'review.veredito') continue;
    const t = msDe(e);
    if (Number.isFinite(t) && t > veredito) veredito = t;
  }
  let n = 0;
  let ultimo: number | null = null;
  for (const e of eventos) {
    if (e?.tipo !== 'sessao.pouso' && e?.tipo !== 'sessao.pouso.tentativa') continue;
    const t = msDe(e);
    if (!Number.isFinite(t) || t <= veredito) continue;
    n += 1;
    if (ultimo === null || t > ultimo) ultimo = t;
  }
  return { n, ultimoMs: ultimo };
}

const origemDe = (e: Evento): unknown => (e?.dados !== null && typeof e?.dados === 'object' ? (e.dados as Record<string, unknown>).origem : undefined);

/**
 * As sessões que podem ter retomado o trabalho depois do último pouso (g.18): `sessao.retomada` ou `sessao.inicio` de origem diferente de `clear`, de sessão
 * DIFERENTE da que pousou, com `ts` legível e posterior ao pouso. Sem repetir, na ordem do diário. Quem lê o disco usa a lista para medir cada uma (`medicaoDoPouso`).
 */
export function sessoesDeRetomada(eventos: Evento[] | null | undefined): string[] {
  if (!Array.isArray(eventos)) return [];
  const p = ultimoPouso(eventos);
  if (p === null || !Number.isFinite(p.ms)) return [];
  const ids: string[] = [];
  for (const e of eventos) {
    const t = msDe(e);
    if (!Number.isFinite(t) || t <= p.ms || e.sessao === p.e.sessao || typeof e.sessao !== 'string' || ids.includes(e.sessao)) continue;
    if (e.tipo === 'sessao.retomada' || (e.tipo === 'sessao.inicio' && origemDe(e) !== 'clear')) ids.push(e.sessao);
  }
  return ids;
}

export function pousoPendente(eventos: Evento[] | null | undefined, onboarding?: boolean, medicao?: Medicao): PousoPendente {
  const nenhum: PousoPendente = { pendente: false, sessao: null, seq: null };
  if (!Array.isArray(eventos)) return nenhum;
  const p = ultimoPouso(eventos);
  if (p === null) return nenhum;
  const propria = leituraPropria(medicao);
  if (propria !== null && medicao !== undefined) {
    // com o mod: a própria leitura decide, sem onboarding (não depende do diário de sessão). O pouso conta só se for o da fronteira ATUAL
    // (`pousoDaFronteira`, pouso.ts: a MESMA definição do mod): um pouso de fronteira anterior não manda o dono limpar nada.
    return propria.percent >= medicao.x && pousoDaFronteira(eventos) ? { pendente: true, sessao: p.e.sessao, seq: p.e.seq } : nenhum;
  }
  // sem leitura própria fresca: a regra sem mod. FIEL-14 h: sem onboarding o diário não registra `sessao.inicio` (Q20), então o pendente POR EVENTO nunca teria
  // saída; o fato vem de quem chama (`temOnboarding` de `cartao-sessao.mjs`).
  if (onboarding !== true) return nenhum;
  const limpou = eventos.some((e) => {
    const t = msDe(e);
    if (!Number.isFinite(t) || !Number.isFinite(p.ms) || t <= p.ms) return false;
    const d = e?.dados as Record<string, unknown> | null | undefined;
    if (d === null || typeof d !== 'object') return false;
    return e.tipo === 'sessao.inicio' && e.sessao !== p.e.sessao && d.origem === 'clear';
  });
  if (limpou) return nenhum;
  // g.18: retomada de outra sessão com o contexto MEDIDO dela abaixo de X (sem medição, não fecha)
  const retomou = medicao !== undefined && sessoesDeRetomada(eventos).some((id) => {
    const l = leituraPropria({ ...medicao, sessaoAtual: id });
    return l !== null && l.percent < medicao.x;
  });
  return retomou ? nenhum : { pendente: true, sessao: p.e.sessao, seq: p.e.seq };
}

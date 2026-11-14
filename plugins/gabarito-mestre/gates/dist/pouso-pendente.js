                                         

/**
 * Pouso pendente (GM-14 FIEL-14 e): a ÚNICA definição. `loop.mjs proxima` (via `proximaAcao`), o hook Stop, o mod (a contagem de tentativas) e o painel
 * (via `dependeDe`) a importam; nenhuma outra regra decide se a conversa ainda precisa ser limpa. Pura e sem `node:` (o mod a importa).
 *
 * Só vale com onboarding (FIEL-14 h) no modo por evento: 2º argumento `onboarding === true`, senão `{pendente:false}`.
 *
 * GM-14 T53 (emendas 52 e 53), invariante POR SESSÃO. Quem decide é sempre a sessão que pergunta, pela PRÓPRIA leitura de contexto
 * (`.harness/contexto/<sessao>.json`, fonte `mod`, até 120 s); nenhuma sessão libera ou prende outra (nem sucessora, nem cache, nem janela):
 *  - leitura própria fresca ⇒ pendente = há `sessao.pouso` e a própria leitura segue em X ou acima (o /clear não a limpou); abaixo de X não há pendência;
 *  - sem leitura própria fresca (mod desligado, sessão sem mod) ⇒ a regra sem mod: `sessao.pouso` sem `sessao.inicio {origem: 'clear'}` posterior, de OUTRA
 *    sessão que a do pouso (sessão paralela, `startup` e `resume` não tiram; `ts` ilegível no início ⇒ ele não conta).
 * `sessao.pouso.tentativa {n}` (a repetição do pouso pelo mod) NÃO é `sessao.pouso`: não entra na procura do último pouso, portanto não muda `seq`
 * (a chave do push `chavePouso`, mod/painel.mjs). Só conta tentativas (`tentativasDoPouso`).
 */
                                                                                             

export const VALIDADE_LEITURA_MS = 120_000;
/** Tentativas do pouso por fronteira (por veredito): o 1º `sessao.pouso` mais as repetições. A 4ª não existe: `loop.parar {sem_pouso}`. */
export const MAX_TENTATIVAS = 3;
export const ESPERA_ENTRE_TENTATIVAS_MS = 60_000;

/** `.harness/contexto/<sessao>.json` `{percent, fonte, em}`; `emMs` já em número. */
                                                                                       
                       
            
                  
                                                                                                                                   
                             
                                                                       
                      
  

const msDe = (e        )         => (typeof e?.ts === 'string' ? Date.parse(e.ts) : Number.NaN);

/** Parse de um `contexto/<sessao>.json` (texto). Fora da forma, `percent` fora de [0,100] ou `em` ilegível ⇒ `null`. Nunca lança. */
export function lerLeitura(sessao        , texto        )                 {
  let j         ;
  try { j = JSON.parse(texto); } catch { return null; }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j                           ;
  if (typeof o.percent !== 'number' || !Number.isFinite(o.percent) || o.percent < 0 || o.percent > 100) return null;
  if (typeof o.fonte !== 'string' || typeof o.em !== 'string') return null;
  const em = Date.parse(o.em);
  return Number.isFinite(em) ? { sessao, percent: o.percent, fonte: o.fonte, emMs: em } : null;
}

/** A leitura PRÓPRIA da sessão que pergunta, se fresca (`mod`, até 120 s, no máximo 5 s no futuro); senão `null`. */
export function leituraPropria(med                     )                 {
  if (med === undefined || med.sessaoAtual === null) return null;
  const l = med.leituras.find((x) => x.sessao === med.sessaoAtual);
  if (l === undefined || l.fonte !== 'mod' || !Number.isFinite(l.emMs) || !Number.isFinite(l.percent) || l.percent < 0 || l.percent > 100) return null;
  return med.agoraMs - l.emMs <= VALIDADE_LEITURA_MS && l.emMs - med.agoraMs <= 5_000 ? l : null;
}

/** `true` quando a leitura própria fresca está em X ou acima: a sessão não pode despachar. Desconhecido não é teto. */
export function noTeto(med         )          {
  const l = leituraPropria(med);
  return l !== null && l.percent >= med.x;
}

function ultimoPouso(eventos          )                                   {
  let ultimo                = null;
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
export function tentativasDoPouso(eventos                             )                                         {
  if (!Array.isArray(eventos)) return { n: 0, ultimoMs: null };
  let veredito = Number.NEGATIVE_INFINITY;
  for (const e of eventos) {
    if (e?.tipo !== 'review.veredito') continue;
    const t = msDe(e);
    if (Number.isFinite(t) && t > veredito) veredito = t;
  }
  let n = 0;
  let ultimo                = null;
  for (const e of eventos) {
    if (e?.tipo !== 'sessao.pouso' && e?.tipo !== 'sessao.pouso.tentativa') continue;
    const t = msDe(e);
    if (!Number.isFinite(t) || t <= veredito) continue;
    n += 1;
    if (ultimo === null || t > ultimo) ultimo = t;
  }
  return { n, ultimoMs: ultimo };
}

export function pousoPendente(eventos                             , onboarding          , medicao          )                {
  const nenhum                = { pendente: false, sessao: null, seq: null };
  if (!Array.isArray(eventos)) return nenhum;
  const p = ultimoPouso(eventos);
  if (p === null) return nenhum;
  const propria = leituraPropria(medicao);
  if (propria !== null && medicao !== undefined) {
    // com o mod: a própria leitura decide, sem onboarding (não depende do diário de sessão)
    return propria.percent >= medicao.x ? { pendente: true, sessao: p.e.sessao, seq: p.e.seq } : nenhum;
  }
  // sem leitura própria fresca: a regra sem mod. FIEL-14 h: sem onboarding o diário não registra `sessao.inicio` (Q20), então o pendente POR EVENTO nunca teria
  // saída; o fato vem de quem chama (`temOnboarding` de `cartao-sessao.mjs`).
  if (onboarding !== true) return nenhum;
  const limpou = eventos.some((e) => {
    const t = msDe(e);
    if (!Number.isFinite(t) || !Number.isFinite(p.ms) || t <= p.ms) return false;
    const d = e?.dados                                              ;
    if (d === null || typeof d !== 'object') return false;
    return e.tipo === 'sessao.inicio' && e.sessao !== p.e.sessao && d.origem === 'clear';
  });
  return limpou ? nenhum : { pendente: true, sessao: p.e.sessao, seq: p.e.seq };
}

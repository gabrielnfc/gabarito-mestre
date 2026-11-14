                                         

/**
 * Pouso pendente (GM-14 FIEL-14 e): a ÚNICA definição. `loop.mjs proxima` (via `proximaAcao`) e o painel (via `dependeDe`) a importam; nenhuma
 * outra regra decide se a conversa ainda precisa ser limpa. Pura e sem `node:` (o mod a importa).
 *
 * Só vale com onboarding (FIEL-14 h): 2º argumento `onboarding === true`, senão `{pendente:false}`.
 * Pendente = existe `sessao.pouso` e nenhum `sessao.inicio {origem: 'clear'}` posterior (por `ts`, estrito) de OUTRA sessão que a do pouso
 * (nenhuma outra definição). `sessao.retomada` não tira o pendente; `startup` e `resume` (sessão paralela, retomada) também não. `ts` ilegível no início ⇒ ele não conta (falha para o lado de manter o pedido).
 */
                                                                                             

/**
 * GM-14 T53 (emendas 52 e 53, REQ-POU-1): com o mod ativo o pouso é validado por MEDIÇÃO, não por evento. Esta é a ÚNICA definição da
 * confirmação; mod, Stop e `proxima` a importam (nenhuma 2ª regra).
 *
 * `sessao.pouso.tentativa {n}` (a repetição do pouso pelo mod, n = 2 ou 3) NÃO é `sessao.pouso`: não entra na procura do último pouso,
 * portanto não muda `seq` (a chave do push `chavePouso`, mod/painel.mjs) nem a fronteira (`analisarFronteira`, pouso.ts). Só marca o instante da
 * tentativa e a conta delas.
 */
export const VALIDADE_LEITURA_MS = 120_000;
export const ESPERA_ENTRE_TENTATIVAS_MS = 60_000;
/** Leitura desconhecida por mais que isto, desde a última tentativa, conta como tentativa falha (sem trava eterna). */
export const LIMITE_DESCONHECIDA_MS = 120_000;
export const MAX_TENTATIVAS = 3;

/** `.harness/contexto/<sessao>.json` `{percent, fonte, em}`; `emMs` já em número. */
                                                                                       
                       
            
                  
                                                                                                            
                             
                      
                                                                                                         
                     
                                                                                   
                           
  

                             
                                                                                                     
                             
                                                            
                    
                      
                                                                                                                                          
                                                                  
                     
                                                                                                                
                  
                       
                    
                                                                                                                          
                      
  

const msDe = (e        )         => (typeof e?.ts === 'string' ? Date.parse(e.ts) : Number.NaN);
const SEM_POUSO                = { modo: 'evento', pouso: null, pendente: false, confirmado: false, leitura: 'sem_medicao', tentativas: 0, falhou: false, podeRepetir: false, esgotada: false, nova: null };

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

const ehClear = (e        )          => {
  const d = e?.dados                                              ;
  return e?.tipo === 'sessao.inicio' && d !== null && typeof d === 'object' && d.origem === 'clear';
};

/** `sessao.retomada {via: 'mod'}`: o mod a grava na sessão NOVA, logo depois do /clear dele (`$.session.id()` já é o da sucessora). */
const ehRetomadaDoMod = (e        )          => {
  const d = e?.dados                                              ;
  return e?.tipo === 'sessao.retomada' && d !== null && typeof d === 'object' && d.via === 'mod';
};

/** Quais sessões o chamador deve medir para `situacaoDoPouso` (a atual, a do último pouso/tentativa e a do `/clear` posterior). */
export function sessoesParaMedir(eventos                             , sessaoAtual               )           {
  const lista = new Set        ();
  if (sessaoAtual !== null) lista.add(sessaoAtual);
  if (Array.isArray(eventos)) {
    for (const e of eventos) {
      if ((e?.tipo === 'sessao.pouso' || e?.tipo === 'sessao.pouso.tentativa' || ehClear(e) || ehRetomadaDoMod(e)) && typeof e.sessao === 'string') lista.add(e.sessao);
    }
  }
  return [...lista];
}

export function situacaoDoPouso(eventos                             , med          )                {
  if (!Array.isArray(eventos)) return SEM_POUSO;
  const p = ultimoPouso(eventos);
  if (p === null) return SEM_POUSO;
  const pouso = { sessao: p.e.sessao, seq: p.e.seq, ms: p.ms };
  // referência da tentativa em curso: o último entre o pouso e as tentativas posteriores a ele
  let ref = { ms: p.ms, sessao: p.e.sessao };
  let tentativas = 1;
  for (const e of eventos) {
    if (e?.tipo !== 'sessao.pouso.tentativa') continue;
    const t = msDe(e);
    if (!Number.isFinite(t) || !Number.isFinite(p.ms) || t < p.ms) continue;
    tentativas += 1;
    if (t >= ref.ms) ref = { ms: t, sessao: e.sessao };
  }
  const limpou = (porRef         )                => {
    let c                = null;
    let cm = Number.NEGATIVE_INFINITY;
    const base = porRef ? ref : { ms: p.ms, sessao: p.e.sessao };
    for (const e of eventos) {
      const t = msDe(e);
      if (!ehClear(e) || !Number.isFinite(t) || !Number.isFinite(base.ms) || t <= base.ms || e.sessao === base.sessao) continue;
      if (c === null || t >= cm) { c = e; cm = t; }
    }
    return c;
  };
  // "Mod ativo" é sinal FRESCO: alguma leitura `mod` de até 120 s. O mod desligado depois do pouso volta à regra sem mod (o /clear do dono libera).
  const fresca = (l         )          => l.fonte === 'mod' && Number.isFinite(l.emMs) && med !== undefined && med.agoraMs - l.emMs <= VALIDADE_LEITURA_MS && l.emMs - med.agoraMs <= 5_000;
  const modAtivo = med === undefined ? false : (med.modAtivo ?? med.leituras.some(fresca));
  if (med === undefined || !modAtivo) {
    // sem mod: o fato é o `/clear` do dono (FIEL-14 e), como antes
    const pendente = limpou(false) === null;
    return { ...SEM_POUSO, modo: 'evento', pouso, pendente, confirmado: !pendente, leitura: 'sem_medicao', tentativas };
  }
  // A confirmação só vem da sessão SUCESSORA (emenda 53 a): a do primeiro `sessao.inicio {clear}` ou `sessao.retomada {via: mod}` de OUTRA sessão que a da tentativa,
  // depois dela. Sessão paralela sem /clear não é sucessora; um /clear alheio com a sessão que pousou ainda medindo depois dele também não (ela não foi limpa).
  let suc                = null;
  let sucMs = Number.POSITIVE_INFINITY;
  for (const e of eventos) {
    const t = msDe(e);
    if (!(ehClear(e) || ehRetomadaDoMod(e)) || !Number.isFinite(t) || !Number.isFinite(ref.ms) || t <= ref.ms || e.sessao === ref.sessao) continue;
    if (t < sucMs) { suc = e; sucMs = t; }
  }
  const refViva = suc !== null && med.leituras.some((l) => l.sessao === ref.sessao && l.fonte === 'mod' && Number.isFinite(l.emMs) && l.emMs > sucMs && fresca(l));
  const nova = suc !== null && !refViva ? suc.sessao : null;
  const tClear = suc !== null ? sucMs : ref.ms;
  const l = nova === null ? undefined : med.leituras.find((x) => x.sessao === nova);
  const valida = l !== undefined && l.fonte === 'mod' && Number.isFinite(l.emMs) && Number.isFinite(l.percent) && l.percent >= 0 && l.percent <= 100
    && l.emMs > tClear && med.agoraMs - l.emMs <= VALIDADE_LEITURA_MS && l.emMs - med.agoraMs <= 5_000;
  let leitura                           = 'desconhecida';
  if (valida && l !== undefined) leitura = l.percent < med.x ? 'confirma' : 'falhou';
  const confirmado = med.confirmouAntes === true || leitura === 'confirma';
  const desconhecidaLonga = leitura === 'desconhecida' && med.agoraMs - ref.ms >= LIMITE_DESCONHECIDA_MS;
  const falhou = !confirmado && (leitura === 'falhou' || desconhecidaLonga);
  const podeRepetir = falhou && tentativas < MAX_TENTATIVAS && med.agoraMs - ref.ms >= ESPERA_ENTRE_TENTATIVAS_MS;
  return {
    modo: 'medicao', pouso, pendente: !confirmado, confirmado, leitura: confirmado && leitura !== 'confirma' ? 'confirma' : leitura,
    tentativas, falhou, podeRepetir, esgotada: falhou && tentativas >= MAX_TENTATIVAS, nova,
  };
}

/**
 * `true` quando a leitura FRESCA (fonte `mod`, até 120 s) da sessão atual está em X ou acima: o teto. O Stop a usa para não pedir despacho
 * enquanto o mod não pousar (emenda 52 b). Sem sessão, sem leitura válida ou de outra fonte ⇒ `false` (desconhecido não é teto).
 */
export function noTeto(med         )          {
  if (med.sessaoAtual === null) return false;
  const l = med.leituras.find((x) => x.sessao === med.sessaoAtual);
  return l !== undefined && l.fonte === 'mod' && Number.isFinite(l.emMs) && Number.isFinite(l.percent) && med.agoraMs - l.emMs <= VALIDADE_LEITURA_MS && l.emMs - med.agoraMs <= 5_000 && l.percent >= med.x;
}

export function pousoPendente(eventos                             , onboarding          , medicao          )                {
  const nenhum                = { pendente: false, sessao: null, seq: null };
  if (!Array.isArray(eventos)) return nenhum;
  const s = situacaoDoPouso(eventos, medicao);
  // FIEL-14 h: sem onboarding o diário não registra `sessao.inicio` (Q20), então o pendente POR EVENTO nunca teria saída. O fato vem de quem chama
  // (`temOnboarding` de `cartao-sessao.mjs`, a mesma leitura do cartão); ausente ou não verdadeiro ⇒ nunca pendente. Com o mod ativo a saída é a
  // medição (T53), que não depende do diário de sessão: o portão vale só no modo `evento`.
  if (s.modo === 'evento' && onboarding !== true) return nenhum;
  if (s.pouso === null || !s.pendente) return nenhum;
  return { pendente: true, sessao: s.pouso.sessao, seq: s.pouso.seq };
}

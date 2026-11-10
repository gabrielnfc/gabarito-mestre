/**
 * Núcleo do aprendizado (GM-13, REQ-APR-1/3): existência das referências, projeção dos vigentes e filtro por destino.
 * Puro: sem I/O (a leitura da árvore é `lerAprendizados` em `diario.ts`). Contrato de falha: forma inválida ou ref sem alvo
 * nunca vira aprendizado válido; o que não é válido fica fora dos vigentes, nunca entra "mudo".
 */
import { formaInvalida } from './formas.js';
import { cmp, ehObjeto } from './diario-puro.js';
                                                                      

                                                                                                                 

const FONTE_EVENTO_RE = /^evento:([^:]+):(\d+)$/;

const existe = (eventos          , r           )          =>
  Array.isArray(eventos) && eventos.some((e) => ehObjeto(e) && e.sessao === r.sessao && e.seq === r.seq);

/** `aprendizado` de forma válida? (o mesmo predicado que a gravação usa). */
function aprendizadoValido(e         )              {
  return ehObjeto(e) && e.tipo === 'aprendizado' && typeof e.sessao === 'string' && typeof e.seq === 'number'
    && Number.isInteger(e.seq) && typeof e.ts === 'string' && formaInvalida('aprendizado', e.dados) === null;
}

/**
 * Motivo de recusa ou `null`. Erros: `gatilho_inexistente`, `evento_inexistente` (cada `evidencia.eventos[]` e `fonte`
 * `evento:<sessao>:<seq>`, na entrega corrente), `substitui_inexistente` (procura em `substitui.entrega ?? entrega`; o alvo
 * tem de ser um `aprendizado` de forma válida). Forma inválida de `dados` também recusa (ausente ≠ corrompido vem de `formaInvalida`).
 */
export function validarAprendizado(eventosDaEntrega          , dados                  , entrega        , porEntrega                       )                {
  try {
    const forma = formaInvalida('aprendizado', dados);
    if (forma !== null) return forma;
    if (dados.gatilho !== null && !existe(eventosDaEntrega, dados.gatilho)) {
      return `gatilho_inexistente: evento ${dados.gatilho.sessao}:${dados.gatilho.seq} não existe na entrega ${entrega}`;
    }
    for (const r of dados.evidencia.eventos ?? []) {
      if (!existe(eventosDaEntrega, r)) return `evento_inexistente: evento ${r.sessao}:${r.seq} não existe na entrega ${entrega}`;
    }
    const fonte = dados.evidencia.medicao?.fonte;
    if (typeof fonte === 'string' && fonte.startsWith('evento:')) {
      const m = FONTE_EVENTO_RE.exec(fonte);
      if (m === null || !existe(eventosDaEntrega, { sessao: m[1], seq: Number(m[2]) })) {
        return `evento_inexistente: fonte ${fonte} não aponta para evento da entrega ${entrega}`;
      }
    }
    const s = dados.substitui;
    if (s !== undefined) {
      const alvoEntrega = s.entrega ?? entrega;
      const daEntrega = s.entrega === undefined || s.entrega === entrega ? eventosDaEntrega : (porEntrega.get(alvoEntrega) ?? []);
      const alvo = Array.isArray(daEntrega) ? daEntrega.find((e) => ehObjeto(e) && e.sessao === s.sessao && e.seq === s.seq) : undefined;
      if (alvo === undefined || !aprendizadoValido(alvo)) {
        return `substitui_inexistente: aprendizado ${alvoEntrega}:${s.sessao}:${s.seq} não existe`;
      }
    }
    return null;
  } catch (e) {
    return `aprendizado: dados corrompido (ilegível: ${e instanceof Error ? e.message : 'erro desconhecido'})`;
  }
}

const chave = (entrega        , sessao        , seq        )         => JSON.stringify([entrega, sessao, seq]);
const ts = (v                )         => { const n = Date.parse(v.ts); return Number.isNaN(n) ? 0 : n; };
/** Mais recente primeiro por `(ts, entrega, sessao, seq)`. */
const maisRecenteAntes = (a                    , b                    )         =>
  ts(b) - ts(a) || cmp(b.entrega, a.entrega) || cmp(b.sessao, a.sessao) || b.seq - a.seq;

/**
 * Aprendizados vigentes da árvore: só eventos de forma válida; o alvo de um `substitui` sai; ciclo não trava
 * (o mais recente do ciclo vale, nada some). Ordem: mais recente primeiro.
 */
export function aprendizadosVigentes(porEntrega                       )                       {
  const todos = new Map                            ();
  const alvoDe = new Map                ();
  for (const [entrega, eventos] of porEntrega) {
    if (!Array.isArray(eventos)) continue;
    for (const e of eventos) {
      if (!aprendizadoValido(e)) continue;
      const d = e.dados                               ;
      const k = chave(entrega, e.sessao, e.seq);
      todos.set(k, { ...d, entrega, sessao: e.sessao, seq: e.seq, ts: e.ts });
      if (d.substitui !== undefined) alvoDe.set(k, chave(d.substitui.entrega ?? entrega, d.substitui.sessao, d.substitui.seq));
    }
  }
  // alvo ausente fica na aresta e nunca entra em `todos`: não remove nada e não fecha ciclo.
  // cada nó tem ≤ 1 aresta: um ciclo perde a aresta que aponta para o seu membro mais recente.
  const visto = new Set        ();
  for (const inicio of alvoDe.keys()) {
    if (visto.has(inicio)) continue;
    const caminho           = [];
    let k                     = inicio;
    while (k !== undefined && !visto.has(k) && !caminho.includes(k)) { caminho.push(k); k = alvoDe.get(k); }
    if (k !== undefined && caminho.includes(k)) {
      const ciclo = caminho.slice(caminho.indexOf(k));
      const novo = ciclo.map((c) => todos.get(c)                      ).sort(maisRecenteAntes)[0];
      const kNovo = chave(novo.entrega, novo.sessao, novo.seq);
      for (const c of ciclo) if (alvoDe.get(c) === kNovo) alvoDe.delete(c);
    }
    for (const c of caminho) visto.add(c);
  }
  const removidos = new Set(alvoDe.values());
  return [...todos.entries()].filter(([k]) => !removidos.has(k)).map(([, v]) => v).sort(maisRecenteAntes);
}

/** Só D, com `entra_em` incluindo o destino (comparação exata: `brief:revisor` não traz `brief:implementador`). */
export function paraDestino(v                      , destino        )                       {
  return v.filter((a) => a.status === 'D' && a.entra_em.includes(destino));
}

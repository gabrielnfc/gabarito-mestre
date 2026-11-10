/**
 * Núcleo do aprendizado (GM-13, REQ-APR-1/3): existência das referências, projeção dos vigentes e filtro por destino.
 * Puro: sem I/O (a leitura da árvore é `lerAprendizados` em `diario.ts`). Contrato de falha: forma inválida ou ref sem alvo
 * nunca vira aprendizado válido; o que não é válido fica fora dos vigentes, nunca entra "mudo".
 */
import { formaInvalida, PAPEIS } from './formas.js';
import { cmp, ehObjeto } from './diario-puro.js';
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.js';
import { pendenciasAprendizado } from './pendencias.js';
                                                                             

                                                                                                                 

const FONTE_EVENTO_RE = /^evento:([^:]+):(\d+)$/;

const existe = (eventos          , r           )          =>
  Array.isArray(eventos) && eventos.some((e) => ehObjeto(e) && e.sessao === r.sessao && e.seq === r.seq);

/** `aprendizado` de forma válida? (o mesmo predicado que a gravação usa). */
function aprendizadoValido(e         )              {
  return ehObjeto(e) && e.tipo === 'aprendizado' && typeof e.sessao === 'string' && typeof e.seq === 'number'
    && Number.isInteger(e.seq) && typeof e.ts === 'string' && formaInvalida('aprendizado', e.dados) === null;
}

/**
 * Forma válida, ou válida SÓ porque `entra_em` cita `brief:<papel>` de um papel que saiu de `PAPEIS` (o diário foi gravado
 * quando o papel existia). A gravação continua estrita (`validarAprendizado`); isto serve só ao doctor, para o D com papel
 * removido chegar a `avisosAprendizado` em vez de sumir calado dos vigentes. Sem hardcode dos destinos fixos: cada entrada
 * é validada sozinha pela própria `formaInvalida`, e o resto da forma com um papel que existe no lugar de `entra_em`.
 */
function formaValidaModuloPapel(d         )          {
  if (formaInvalida('aprendizado', d) === null) return true;
  if (!ehObjeto(d) || !Array.isArray(d.entra_em)) return false;
  const lista            = d.entra_em;
  if (lista.length === 0 || new Set(lista).size !== lista.length) return false;
  const entradaOk = (x         )          =>
    typeof x === 'string' && ((x.startsWith('brief:') && x.length > 6) || formaInvalida('aprendizado', { ...d, entra_em: [x] }) === null);
  return lista.every(entradaOk) && formaInvalida('aprendizado', { ...d, entra_em: [`brief:${PAPEIS[0]}`] }) === null;
}

function aprendizadoValidoModuloPapel(e         )              {
  return ehObjeto(e) && e.tipo === 'aprendizado' && typeof e.sessao === 'string' && typeof e.seq === 'number'
    && Number.isInteger(e.seq) && typeof e.ts === 'string' && formaValidaModuloPapel(e.dados);
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
  return projetarVigentes(porEntrega, aprendizadoValido);
}

function projetarVigentes(porEntrega                       , valido                             )                       {
  const todos = new Map                            ();
  const alvoDe = new Map                ();
  for (const [entrega, eventos] of porEntrega) {
    if (!Array.isArray(eventos)) continue;
    for (const e of eventos) {
      if (!valido(e)) continue;
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

/** Entregas posteriores (menor `ts` > `ts` do M) a partir das quais um M sem substituto vira aviso: `> 2` (REQ-APR-4). */
const ENTREGAS_PARA_ENVELHECER = 2;
const UMA_LINHA = /[\u0000-\u001f\u007f\u2028\u2029]+/g;
const linha = (t        )         => t.replace(UMA_LINHA, ' ');

/** Menor `ts` válido da entrega, em ms, ou `null` (sem evento com `ts` legível). */
function menorTs(eventos          )                {
  let menor                = null;
  for (const e of eventos) {
    const n = ehObjeto(e) && typeof e.ts === 'string' ? Date.parse(e.ts) : NaN;
    if (!Number.isNaN(n) && (menor === null || n < menor)) menor = n;
  }
  return menor;
}

/** Todas as tasks do plano integradas (plano sem task não tem âncora, como em `pendenciasAprendizado`). */
function todasIntegradas(plano       , eventos          )          {
  const tasks = Array.isArray(plano?.tasks) ? plano.tasks : [];
  if (tasks.length === 0) return false;
  return tasks.every((t) => {
    const id = ehObjeto(t) ? t.id : undefined;
    if (typeof id !== 'string') return false;
    const fila = eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && ehObjeto(e.dados) && e.dados.task === id);
    const r = estadoDe(fila);
    return !('invalido' in r) && r.estado === 'integrada';
  });
}

const refTexto = (a                                                  )         => `${a.entrega}/${a.sessao}:${a.seq}`;
const comandoSubstitui = (a                    )         =>
  `loop.mjs aprendizado ${a.tipo} D --regra <texto> --entra-em <destinos válidos> --substitui ${refTexto(a)}`;

/**
 * Avisos do doctor sobre aprendizado sem destino (GM-13, REQ-APR-4). Cada aviso traz o comando que fecha.
 *  (1) pendência aberta numa entrega com todas as tasks integradas (`planos` sem a entrega ⇒ sem âncora, silêncio; entrega
 *      com plano e diário que não lê ou não ordena ⇒ aviso de leitura: a pendência não pôde ser conferida);
 *  (2) `brief:<papel>` de D vigente com papel fora de `papeis` (comparação exata). Os vigentes aqui toleram SÓ o papel removido
 *      (`formaValidaModuloPapel`): com a validação estrita o D sumiria antes de chegar a esta cláusula, e o doctor diria "nada sem destino";
 *  (3) M vigente com MAIS DE 2 entregas cujo menor `ts` é posterior ao dele (lido de `aprendizadosVigentes`: o M substituído,
 *      aqui ou em outra entrega, não está lá e não avisa).
 * Pura e determinística; nunca lança (o que não lê vira aviso, nunca silêncio).
 */
export function avisosAprendizado(porEntrega                       , planos                    , papeis                   )           {
  const avisos           = [];
  const entregas = [...porEntrega.keys()].sort(cmp);
  for (const entrega of entregas) {
    const eventos = porEntrega.get(entrega);
    const ilegivel = (motivo        )       => { avisos.push(linha(`aprendizados: ${entrega} ilegível (${motivo}); pendências não conferidas`)); };
    if (!Array.isArray(eventos)) { ilegivel('diário não é uma lista de eventos'); continue; }
    const plano = planos.get(entrega);
    if (plano === undefined) continue;
    try {
      if (!ordenar(eventos).ok) { ilegivel('diário fora de ordem'); continue; }
      if (!todasIntegradas(plano, eventos)) continue;
      for (const p of pendenciasAprendizado(plano, eventos)) {
        avisos.push(linha(`aprendizados: entrega ${entrega} com todas as tasks integradas e pendência de aprendizado aberta (${p.tipo} ${p.sessao}:${p.seq}); feche com: loop.mjs aprendizado nada --gatilho ${p.sessao}:${p.seq} --motivo <texto> --entrega ${entrega}`));
      }
    } catch (e) {
      ilegivel(e instanceof Error ? e.message : 'erro desconhecido');
    }
  }

  const vigentes = projetarVigentes(porEntrega, aprendizadoValidoModuloPapel);
  for (const a of vigentes) {
    if (a.status !== 'D') continue;
    for (const d of a.entra_em) {
      if (d.startsWith('brief:') && !papeis.includes(d.slice(6))) {
        avisos.push(linha(`aprendizados: ${refTexto(a)} entra em ${d}, papel que não existe mais (papéis: ${papeis.join(', ')}); substitua: ${comandoSubstitui(a)}`));
      }
    }
  }

  const inicios = entregas.map((e) => ({ e, ms: Array.isArray(porEntrega.get(e)) ? menorTs(porEntrega.get(e)            ) : null }));
  for (const a of vigentes) {
    if (a.status !== 'M') continue;
    const depois = inicios.filter((i) => i.ms !== null && i.ms > ts(a)).length;
    if (depois > ENTREGAS_PARA_ENVELHECER) {
      avisos.push(linha(`aprendizados: M ${refTexto(a)} sem substituto há ${depois} entregas; promova ou substitua: ${comandoSubstitui(a)}`));
    }
  }
  return avisos;
}

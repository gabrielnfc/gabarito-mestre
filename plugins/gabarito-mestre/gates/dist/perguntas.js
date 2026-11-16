/**
 * Perguntas abertas do painel por gatilho fechado (GM-14, REQ-PRG-1). Núcleo puro: sem E/S, sem relógio, nunca lança.
 *
 * Gatilhos e âncoras (a âncora é o evento cujo `<sessao>:<seq>` vira o id da pergunta):
 * - (a) `nota assunto` com a trilha sem entrega identificada ⇒ âncora = a nota.
 * - (b) sessão atual com trabalho e trilha sem entrega identificada ⇒ âncora = `ancoraDaPerguntaB` de `trilha.ts` (regra única,
 *   importada: 1º `fato.medido` que não é `spec` ou `nota` sem pergunta própria DA SESSÃO; por isso (b) nunca divide id com
 *   (a)/(c)/(d)/pendência)
 *   (DP-2 ajuste 1: por sessão, não por repositório; sessão nova volta a perguntar; retomada não reabre).
 * - (c) trilha com 2+ specs ambíguas ⇒ âncora = o `fato.medido spec` que completou o conjunto (entrada da última delas, a mesma
 *   referência de `trilha.ts`); edição de spec não reabre, conjunto novo reabre (DP-2 ajuste 2).
 * - (d) `nota duvida` ⇒ âncora = a nota, opções da nota. Pendência ⇒ opção única "feito", aberta pela `pendenciaAberta` de
 *   `depende.ts` (regra única, importada: forma válida e sem `dono.resposta` com rótulo depois da nota).
 * - Ideias: `nota ideia` ⇒ opção única "visto", aberta pela `ideiasAbertas` de `depende.ts` (regra única, importada; só as ideias depois da última
 *   resposta "visto" contam).
 * Fechada só por `dono.resposta` na forma `{pergunta, opcao, rotulo}`; `{sha256, chars}` não fecha (DP-2).
 * Opções de (a) e (b) congeladas pela âncora: só pontos de atividade com data ≤ ts da âncora (DP-2 ajuste 3), para painel e hook
 * verem a mesma lista. Rótulo de entrega = ID cru, nunca `nomeNatural` (DP-4): é o rótulo que `trilha.ts` usa para ligar a sessão.
 * Rótulo de (c) = o 1º entre título, caminho, nome do arquivo e `…`+final do caminho que cabe em 60 e que `trilha.ts` casa com 1 só spec
 * (`rotuloCasaSpec`): (c) sempre abre com 2+ specs; só deixa de abrir se nenhum rótulo resolver (caminhos com o mesmo final de 59 caracteres).
 * Id que não casa `ID_PERGUNTA_RE` (sessão com `.` ou `_`) seria irrespondível pelo hook: não vira pergunta.
 */
import { adiadas, ideiasAbertas, pendenciaAberta, textoIdeias } from './depende.js';
import { AGORA_NAO } from './pouso.js';
import { ehRespostaDeAdiamento, ID_PERGUNTA_RE } from './formas.js';
import { ordenar } from './loop.js';
                                                     
import { ancoraDaPerguntaB, ancoraDaPerguntaC, rotuloCasaSpec } from './trilha.js';
                                          

                                                                                                                                   
/**
 * `sessao`: a sessão atual (o `session_id` do mod ou do hook); ausente ⇒ a do último `sessao.inicio`; nenhum ⇒ (b) não abre.
 * `ultimas`: pontos de atividade `{id, data}` das entregas (o mesmo id pode repetir); ausente ⇒ `trilha.ultimaConhecida`.
 */
                                                                                                     

const OPCAO_MAX = 60;
const NOVA = 'uma nova';
const AVULSA = 'conversa avulsa';
const IDEIA = 'ideia para a próxima';
const FEITO = 'feito';
const VISTO = 'visto';

const obj = (v         )                          => (v !== null && typeof v === 'object' ? (v                           ) : {});
const lista =    (v         )      => (Array.isArray(v) ? (v       ) : []);
const semPonto = (c         )         => (typeof c === 'string' ? c.replace(/^\.\//, '') : '');
const idDe = (e        )         => `${e.sessao}:${e.seq}`;
const umaLinha = (s         )              => typeof s === 'string' && s.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(s);
const cabe = (s         )              => umaLinha(s) && [...s].length <= OPCAO_MAX;

/** Eventos em ordem de tempo; diário que não ordena (corrompido) ⇒ a ordem do arquivo, só com os objetos que têm sessão e seq. */
function emOrdem(eventos         )           {
  const validos = lista        (eventos).filter((e) => e !== null && typeof e === 'object' && typeof e.sessao === 'string' && Number.isInteger(e.seq));
  const ord = ordenar(validos);
  return ord.ok ? ord.eventos : validos;
}

/** Ids fechados por resposta com rótulo. */
function respondidas(evs          )              {
  const ids = new Set        ();
  for (const e of evs) {
    const d = obj(e.dados);
    // GM-15 T35 (r.14): "agora não" adia, não fecha (a regra de adiada é `adiadas`, de depende.ts)
    if (e.tipo === 'dono.resposta' && typeof d.pergunta === 'string' && typeof d.rotulo === 'string' && Number.isInteger(d.opcao) && !ehRespostaDeAdiamento(d)) ids.add(d.pergunta);
  }
  return ids;
}

/** Até `n` entregas pela atividade mais recente com data ≤ `ate` (congelado pela âncora); ID cru; pastas `_*` fora. */
function entregasAte(ctx                   , trilha        , ate        , n        )           {
  const pontos = Array.isArray(ctx.ultimas)
    ? ctx.ultimas
    : typeof trilha.ultimaConhecida === 'string' ? [{ id: trilha.ultimaConhecida, data: '' }] : [];
  const recente = new Map                ();
  for (const p of pontos) {
    if (!cabe(p?.id) || p.id.startsWith('_') || typeof p.data !== 'string' || p.data > ate) continue;
    if (!recente.has(p.id) || p.data > (recente.get(p.id)          )) recente.set(p.id, p.data);
  }
  return [...recente].sort((x, y) => (x[1] === y[1] ? (x[0] < y[0] ? -1 : 1) : x[1] > y[1] ? -1 : 1)).slice(0, n).map(([id]) => id);
}

function sessaoAtual(evs          , ctx                   )                {
  if (typeof ctx.sessao === 'string' && ctx.sessao !== '') return ctx.sessao;
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].tipo === 'sessao.inicio') return evs[i].sessao;
  return null;
}

/** GM-15 T35 (r.15): `Emenda <n>` no começo do texto da dúvida ⇒ a proposta `n`; senão `null` (a dúvida não é de emenda). */
const emendaDaDuvida = (texto        )                => {
  const m = /^\s*emenda\s+#?(\d{1,6})\b/i.exec(texto);
  return m === null ? null : Number(m[1]);
};
/** Proposta ⇒ posição do último julgamento (`spec.emendada`/`emenda.rejeitada` com `proposta_seq` inteiro) em `evs`. */
function emendasJulgadas(evs          )                      {
  const m = new Map                ();
  evs.forEach((e, i) => {
    const n = obj(e.dados).proposta_seq;
    if ((e.tipo === 'spec.emendada' || e.tipo === 'emenda.rejeitada') && Number.isInteger(n)) m.set(n          , i);
  });
  return m;
}

/** Perguntas abertas, a mais antiga (pela âncora) primeiro. */
export function perguntasAbertas(eventos          , trilha        , ctx                    = {})             {
  const t = obj(trilha)          ;
  const c = obj(ctx)                     ;
  const evs = emOrdem(eventos);
  const fechadas = respondidas(evs);
  const adiados = adiadas(evs);
  const julgadas = emendasJulgadas(evs);
  const semEntrega = t.identificada !== true;
  const achadas                                 = [];
  const pos = new Map(evs.map((e, i) => [e, i]));
  const abrir = (ancora        , gatilho                     , texto        , opcoes          , jaFiltrada = false) => {
    const id = idDe(ancora);
    if (!ID_PERGUNTA_RE.test(id) || (!jaFiltrada && fechadas.has(id)) || opcoes.length === 0 || adiados.has(id)) return;
    achadas.push({ pos: pos.get(ancora)          , p: { id, gatilho, texto, opcoes } });
  };

  for (const e of evs) {
    if (e.tipo !== 'nota') continue;
    const d = obj(e.dados);
    if (d.tipo === 'assunto' && semEntrega) {
      const [ultima] = entregasAte(c, t, e.ts, 1);
      const texto = ultima !== undefined
        ? `A conversa mudou de assunto. Isto é parte da ${ultima}, ${IDEIA} ou ${AVULSA}?`
        : `A conversa mudou de assunto. Isto é ${IDEIA} ou ${AVULSA}?`;
      abrir(e, 'a', texto, ultima !== undefined ? [ultima, IDEIA, AVULSA] : [IDEIA, AVULSA]);
    } else if (d.tipo === 'duvida' && umaLinha(d.texto)) {
      // GM-15 T35 (r.15): dúvida de emenda julgada DEPOIS dela é obsoleta (prova no diário); sem prova, fica
      const n = emendaDaDuvida(d.texto);
      if (n !== null && (julgadas.get(n) ?? -1) > (pos.get(e)          )) continue;
      abrir(e, 'd', d.texto, lista         (d.opcoes).filter(cabe));
    } else {
      const pendencia = pendenciaAberta(evs, e);
      if (pendencia !== null) abrir(e, 'pendencia', pendencia.texto, [FEITO], true);
    }
  }

  // Ideias: opção única "visto", aberta pela `ideiasAbertas` de depende.ts (regra única, importada); âncora = a última ideia respondível.
  const ideias = ideiasAbertas(evs);
  if (ideias !== null) {
    const ancora = evs.find((e) => idDe(e) === ideias.id);
    if (ancora !== undefined) abrir(ancora, 'ideia', textoIdeias(ideias.n), [VISTO], true);
  }

  const sessao = sessaoAtual(evs, c);
  if (semEntrega && sessao !== null) {
    const idB = ancoraDaPerguntaB(evs, sessao);
    const ancora = idB === null ? undefined : evs.find((e) => idDe(e) === idB);
    if (ancora !== undefined) {
      const candidato = cabe(t.candidato) ? t.candidato : null;
      if (candidato !== null) abrir(ancora, 'b', `Esta conversa é da entrega ${candidato}?`, [candidato, NOVA, AVULSA]);
      else abrir(ancora, 'b', 'De que entrega é esta conversa?', [...entregasAte(c, t, ancora.ts, 2), NOVA, AVULSA]);
    }
  }

  const ambigua = lista                                       (t.ambigua).filter((s) => s !== null && typeof s === 'object');
  if (t.identificada === true && ambigua.length >= 2 && typeof t.entrega === 'string') {
    const caminhos = ambigua.map((s) => semPonto(s.caminho));
    const idC = ancoraDaPerguntaC(evs, caminhos);
    const ancora = idC === null ? undefined : evs.find((e) => idDe(e) === idC);
    if (ancora !== undefined) {
      const opcoes           = [];
      for (const [i, s] of ambigua.slice(0, 4).entries()) {
        const titulo = typeof s.titulo === 'string' ? s.titulo.trim() : '';
        const caminho = caminhos[i];
        // 1º rótulo gravável (≤ 60) que `trilha.ts` casa com exatamente 1 das specs: título, caminho, nome do arquivo, final do caminho.
        const candidatos = [titulo, caminho, caminho.split('/').pop() ?? '', `…${[...caminho].slice(-(OPCAO_MAX - 1)).join('')}`];
        const rotulo = candidatos.find((r) => cabe(r) && ambigua.filter((o) => rotuloCasaSpec(o, r.trim().toLowerCase())).length === 1);
        if (rotulo !== undefined) opcoes.push(rotulo);
      }
      if (opcoes.length >= 2) abrir(ancora, 'c', `Qual destas é a spec da ${t.entrega}?`, opcoes);
    }
  }

  return achadas.sort((x, y) => x.pos - y.pos).map((a) => a.p);
}

/**
 * Valida a resposta do dono contra as perguntas abertas. `eventos` (opcional) distingue "respondida" de "inexistente":
 * id fora de `p` com `dono.resposta` por rótulo no diário ⇒ `respondida`; sem eventos ⇒ `inexistente`.
 */
export function respostaValida(p            , id            , opcao        , eventos           ) 
                                                                                                  {
  const pergunta = lista          (p).find((q) => q?.id === id);
  if (pergunta === undefined) {
    return { ok: false, erro: typeof id === 'string' && respondidas(emOrdem(eventos)).has(id) ? 'respondida' : 'inexistente' };
  }
  if (!Number.isInteger(opcao) || opcao < 1 || opcao > pergunta.opcoes.length) return { ok: false, erro: 'opcao_fora' };
  return { ok: true, rotulo: pergunta.opcoes[opcao - 1] };
}

/**
 * GM-15 T35 (r.14, D-G12 2): toda pergunta aberta aceita "agora não" (o hook `responder` grava `{pergunta, rotulo: "agora não"}`, a forma própria do
 * adiamento em formas.ts, sem `opcao`). Só pergunta ABERTA (a adiada já não está em `p`). Nunca lança.
 */
export function adiamentoValido(p            , id            )                                                                    {
  return lista          (p).some((q) => q?.id === id) ? { ok: true, rotulo: AGORA_NAO } : { ok: false, erro: 'inexistente' };
}

                                                                                        
const RECOMENDADO = /\(recomendado\)/i;
/**
 * GM-15 T35 (r.16, D-G12 4): "aprovar todas as recomendadas" = as perguntas abertas com EXATAMENTE 1 opção marcada "(recomendado)" (sem caixa);
 * pergunta sem recomendação (ou com 2+) fica fora. Cada item leva o número e o rótulo da opção recomendada. Na ordem de `p`. Nunca lança.
 */
export function loteRecomendadas(p            )             {
  return lista          (p).flatMap((q) => {
    const marcadas = lista        (q?.opcoes).map((o, i) => ({ o, i })).filter((x) => typeof x.o === 'string' && RECOMENDADO.test(x.o));
    return marcadas.length === 1 ? [{ id: q.id, opcao: marcadas[0].i + 1, rotulo: marcadas[0].o, texto: q.texto }] : [];
  });
}

/** Impressão do lote (12 hex, FNV-1a de 64 bits sobre `id=opcao` em ordem): a confirmação só grava o MESMO lote que o dono viu. Pura, sem `node:`. */
export function impressaoDoLote(itens            )         {
  let h = 0xcbf29ce484222325n;
  for (const ch of lista          (itens).map((i) => `${i.id}=${i.opcao}`).join('\n')) {
    h ^= BigInt(ch.codePointAt(0)          );
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}

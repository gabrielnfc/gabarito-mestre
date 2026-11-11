/**
 * Perguntas abertas do painel por gatilho fechado (GM-14, REQ-PRG-1). Núcleo puro: sem E/S, sem relógio, nunca lança.
 *
 * Gatilhos e âncoras (a âncora é o evento cujo `<sessao>:<seq>` vira o id da pergunta):
 * - (a) `nota assunto` com a trilha sem entrega identificada ⇒ âncora = a nota.
 * - (b) sessão atual com trabalho e trilha sem entrega identificada ⇒ âncora = `ancoraDaPerguntaB` de `trilha.ts` (regra única,
 *   importada: 1º `fato.medido` ou `nota` sem pergunta própria DA SESSÃO; por isso (b) nunca divide id com (a)/(d)/pendência)
 *   (DP-2 ajuste 1: por sessão, não por repositório; sessão nova volta a perguntar; retomada não reabre).
 * - (c) trilha com 2+ specs ambíguas ⇒ âncora = o `fato.medido spec` que completou o conjunto (entrada da última delas, a mesma
 *   referência de `trilha.ts`); edição de spec não reabre, conjunto novo reabre (DP-2 ajuste 2).
 * - (d) `nota duvida` ⇒ âncora = a nota, opções da nota. Pendência ⇒ opção única "feito", aberta pela `pendenciaAberta` de
 *   `depende.ts` (regra única, importada: forma válida e sem `dono.resposta` com rótulo depois da nota).
 * Fechada só por `dono.resposta` na forma `{pergunta, opcao, rotulo}`; `{sha256, chars}` não fecha (DP-2).
 * Opções de (a) e (b) congeladas pela âncora: só pontos de atividade com data ≤ ts da âncora (DP-2 ajuste 3), para painel e hook
 * verem a mesma lista. Rótulo de entrega = ID cru, nunca `nomeNatural` (DP-4): é o rótulo que `trilha.ts` usa para ligar a sessão.
 * Rótulo de (c) = o 1º entre título, caminho, nome do arquivo e `…`+final do caminho que cabe em 60 e que `trilha.ts` casa com 1 só spec
 * (`rotuloCasaSpec`): (c) sempre abre com 2+ specs; só deixa de abrir se nenhum rótulo resolver (caminhos com o mesmo final de 59 caracteres).
 * Id que não casa `ID_PERGUNTA_RE` (sessão com `.` ou `_`) seria irrespondível pelo hook: não vira pergunta.
 */
import { pendenciaAberta } from './depende.ts';
import { ID_PERGUNTA_RE } from './formas.ts';
import { ordenar } from './loop.ts';
import type { Evento, IdPergunta } from './tipos.ts';
import { ancoraDaPerguntaB, rotuloCasaSpec } from './trilha.ts';
import type { Trilha } from './trilha.ts';

export type Pergunta = { id: IdPergunta; gatilho: 'a' | 'b' | 'c' | 'd' | 'pendencia'; texto: string; opcoes: string[] };
/**
 * `sessao`: a sessão atual (o `session_id` do mod ou do hook); ausente ⇒ a do último `sessao.inicio`; nenhum ⇒ (b) não abre.
 * `ultimas`: pontos de atividade `{id, data}` das entregas (o mesmo id pode repetir); ausente ⇒ `trilha.ultimaConhecida`.
 */
export type ContextoPerguntas = { sessao?: string | null; ultimas?: { id: string; data: string }[] };

const OPCAO_MAX = 60;
const NOVA = 'uma nova';
const AVULSA = 'conversa avulsa';
const IDEIA = 'ideia para a próxima';
const FEITO = 'feito';

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const semPonto = (c: unknown): string => (typeof c === 'string' ? c.replace(/^\.\//, '') : '');
const idDe = (e: Evento): string => `${e.sessao}:${e.seq}`;
const umaLinha = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(s);
const cabe = (s: unknown): s is string => umaLinha(s) && [...s].length <= OPCAO_MAX;

/** Eventos em ordem de tempo; diário que não ordena (corrompido) ⇒ a ordem do arquivo, só com os objetos que têm sessão e seq. */
function emOrdem(eventos: unknown): Evento[] {
  const validos = lista<Evento>(eventos).filter((e) => e !== null && typeof e === 'object' && typeof e.sessao === 'string' && Number.isInteger(e.seq));
  const ord = ordenar(validos);
  return ord.ok ? ord.eventos : validos;
}

/** Ids fechados por resposta com rótulo. */
function respondidas(evs: Evento[]): Set<string> {
  const ids = new Set<string>();
  for (const e of evs) {
    const d = obj(e.dados);
    if (e.tipo === 'dono.resposta' && typeof d.pergunta === 'string' && typeof d.rotulo === 'string' && Number.isInteger(d.opcao)) ids.add(d.pergunta);
  }
  return ids;
}

/** Até `n` entregas pela atividade mais recente com data ≤ `ate` (congelado pela âncora); ID cru; pastas `_*` fora. */
function entregasAte(ctx: ContextoPerguntas, trilha: Trilha, ate: string, n: number): string[] {
  const pontos = Array.isArray(ctx.ultimas)
    ? ctx.ultimas
    : typeof trilha.ultimaConhecida === 'string' ? [{ id: trilha.ultimaConhecida, data: '' }] : [];
  const recente = new Map<string, string>();
  for (const p of pontos) {
    if (!cabe(p?.id) || p.id.startsWith('_') || typeof p.data !== 'string' || p.data > ate) continue;
    if (!recente.has(p.id) || p.data > (recente.get(p.id) as string)) recente.set(p.id, p.data);
  }
  return [...recente].sort((x, y) => (x[1] === y[1] ? (x[0] < y[0] ? -1 : 1) : x[1] > y[1] ? -1 : 1)).slice(0, n).map(([id]) => id);
}

function sessaoAtual(evs: Evento[], ctx: ContextoPerguntas): string | null {
  if (typeof ctx.sessao === 'string' && ctx.sessao !== '') return ctx.sessao;
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].tipo === 'sessao.inicio') return evs[i].sessao;
  return null;
}

/** Âncora de (c): 1ª entrada do caminho que completou o conjunto ambíguo; sem entrada medida de todos ⇒ `null`. */
function ancoraC(evs: Evento[], caminhos: Set<string>): Evento | null {
  const vistos = new Set<string>();
  let ancora: Evento | null = null;
  for (const e of evs) {
    const d = obj(e.dados);
    const c = e.tipo === 'fato.medido' && d.chave === 'spec' ? semPonto(obj(d.valor).caminho) : '';
    if (caminhos.has(c) && !vistos.has(c)) {
      vistos.add(c);
      ancora = e;
    }
  }
  return vistos.size === caminhos.size ? ancora : null;
}

/** Perguntas abertas, a mais antiga (pela âncora) primeiro. */
export function perguntasAbertas(eventos: Evento[], trilha: Trilha, ctx: ContextoPerguntas = {}): Pergunta[] {
  const t = obj(trilha) as Trilha;
  const c = obj(ctx) as ContextoPerguntas;
  const evs = emOrdem(eventos);
  const fechadas = respondidas(evs);
  const semEntrega = t.identificada !== true;
  const achadas: { pos: number; p: Pergunta }[] = [];
  const pos = new Map(evs.map((e, i) => [e, i]));
  const abrir = (ancora: Evento, gatilho: Pergunta['gatilho'], texto: string, opcoes: string[], jaFiltrada = false) => {
    const id = idDe(ancora);
    if (!ID_PERGUNTA_RE.test(id) || (!jaFiltrada && fechadas.has(id)) || opcoes.length === 0) return;
    achadas.push({ pos: pos.get(ancora) as number, p: { id, gatilho, texto, opcoes } });
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
      abrir(e, 'd', d.texto, lista<unknown>(d.opcoes).filter(cabe));
    } else {
      const pendencia = pendenciaAberta(evs, e);
      if (pendencia !== null) abrir(e, 'pendencia', pendencia.texto, [FEITO], true);
    }
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

  const ambigua = lista<{ caminho: unknown; titulo: unknown }>(t.ambigua).filter((s) => s !== null && typeof s === 'object');
  if (t.identificada === true && ambigua.length >= 2 && typeof t.entrega === 'string') {
    const caminhos = ambigua.map((s) => semPonto(s.caminho));
    const ancora = ancoraC(evs, new Set(caminhos));
    if (ancora !== null) {
      const opcoes: string[] = [];
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
export function respostaValida(p: Pergunta[], id: IdPergunta, opcao: number, eventos?: Evento[]):
  { ok: true; rotulo: string } | { ok: false; erro: 'inexistente' | 'respondida' | 'opcao_fora' } {
  const pergunta = lista<Pergunta>(p).find((q) => q?.id === id);
  if (pergunta === undefined) {
    return { ok: false, erro: typeof id === 'string' && respondidas(emOrdem(eventos)).has(id) ? 'respondida' : 'inexistente' };
  }
  if (!Number.isInteger(opcao) || opcao < 1 || opcao > pergunta.opcoes.length) return { ok: false, erro: 'opcao_fora' };
  return { ok: true, rotulo: pergunta.opcoes[opcao - 1] };
}

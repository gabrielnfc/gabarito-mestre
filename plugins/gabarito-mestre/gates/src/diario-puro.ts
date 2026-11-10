/**
 * Núcleo puro do diário (GM-12 T2 r3): o que o painel, o diário e a Sombra compartilham e que NÃO pode puxar `node:*` (o mod carrega o
 * `dist/`, que não tem Node). Reúne, sem mudar regra, o cronômetro das durações (`EM_TRABALHO`, `duracoes`, `mediana`; antes em `diario.ts`)
 * e a projeção das decisões da Sombra (`ordenado`, `diarioEmOrdem`, `valido`, `vigentes`, `projetarDecisoes`, `contarConsultas`; antes em
 * `sombra.ts`). `diario.ts` e `sombra.ts` reexportam os nomes públicos de sempre; o painel importa daqui. Uma só implementação: mutação
 * aqui cai nas suítes do diário e do painel.
 */
import { formaInvalida } from './formas.ts';
import { estadoDe, ordenar } from './loop.ts';
import type { EstadoTask } from './loop.ts';
import type { Evento } from './tipos.ts';

export type Ancora = { req: string } | { task: string };
export type DecisaoSombra = {
  hash: string; req?: string; task?: string; resposta: string; arquivo: string;
  fontes?: string[]; medicao?: string; fora_da_regra?: true; emenda_seq?: number; pergunta_enviesada: boolean;
  sessao: string; seq: number; ts: string;
};

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const ehObjeto = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Task com trabalho em curso: o cronômetro anda enquanto o estado da T2 está aqui. */
export const EM_TRABALHO: ReadonlySet<EstadoTask> = new Set<EstadoTask>(['implementando', 'concluida', 'em_revisao', 'corrigindo']);
const TIPOS_DE_TASK: ReadonlySet<string> = new Set(['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta']);

/**
 * Duração de UMA task aprovada (REQ-OBS-1), seguindo a transição da T2 (`estadoDe`) e nunca lendo
 * `tipo`/`papel`/`origem` por conta própria. Soma dos intervalos em trabalho que terminaram em veredito;
 * tentativa abandonada por retomada não entra; voltar a `pendente` recomeça do zero. `null`: task não
 * aprovada, ou sequência que a T2 rejeita (a projeção não inventa número).
 */
function duracaoDaTask(fila: Evento[]): number | null {
  // `ordenar` da T2 só aceita cada sessão em ordem de `seq`; a ordem de entrada daqui não é garantida.
  const porSeq = [...fila].sort((a, b) => cmp(String(a.sessao), String(b.sessao)) || Number(a.seq) - Number(b.seq));
  const ord = ordenar(porSeq);
  if (!ord.ok) return null;
  let aberta: number | undefined;
  let acumulado: number | undefined;
  let feita: number | null = null;
  let antes: EstadoTask = 'pendente';
  for (let i = 0; i < ord.eventos.length; i++) {
    const r = estadoDe(ord.eventos.slice(0, i + 1));
    if ('invalido' in r) return null;
    const e = ord.eventos[i];
    const t = Date.parse(e.ts); // `ordenar` já barrou ts inválido
    const depois = r.estado;
    if (depois === 'pendente' && antes !== 'pendente') {
      aberta = undefined;
      acumulado = undefined;
    } else if (!EM_TRABALHO.has(antes) && EM_TRABALHO.has(depois)) {
      aberta = t;
    } else if (EM_TRABALHO.has(antes) && !EM_TRABALHO.has(depois)) {
      const ini = aberta;
      aberta = undefined;
      // saída por reabertura = tentativa abandonada, não soma; saída por veredito soma o intervalo (se for coerente)
      if (e.tipo === 'review.veredito') {
        if (ini !== undefined && t >= ini) acumulado = (acumulado ?? 0) + (t - ini);
        if (depois === 'aprovada' && acumulado !== undefined) feita = acumulado / 1000;
      }
    }
    antes = depois;
  }
  return feita;
}

/** Duração por task aprovada: agrupa por task e delega a cada uma o `duracaoDaTask`. */
export function duracoes(eventos: Evento[]): number[] {
  const porTask = new Map<string, Evento[]>();
  for (const e of eventos) {
    if (!TIPOS_DE_TASK.has(e.tipo) || !ehObjeto(e.dados) || typeof e.dados.task !== 'string') continue;
    const fila = porTask.get(e.dados.task) ?? [];
    fila.push(e);
    porTask.set(e.dados.task, fila);
  }
  const feitas: number[] = [];
  for (const fila of porTask.values()) {
    const d = duracaoDaTask(fila);
    if (d !== null) feitas.push(d);
  }
  return feitas;
}

export function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Ordem do diário = a de `ordenar` do loop (única fonte): `seq` dentro da sessão, `(ts, sessao)` entre sessões, `ts` no formato do
 * diário. `null` se o diário não se sustenta (`seq` que não cresce na sessão, `ts`/`sessao`/`seq` ilegíveis, não é lista).
 */
export function ordenado(eventos: Evento[]): Evento[] | null {
  if (!Array.isArray(eventos)) return null;
  const o = ordenar(eventos);
  return o.ok ? o.eventos : null;
}

/** `false` quando o diário está fora de ordem ou ilegível: o CLI recusa com motivo em vez de decidir sobre ele. */
export function diarioEmOrdem(eventos: Evento[]): boolean {
  return ordenado(eventos) !== null;
}

export const valido = (e: Evento, tipo: string): boolean => e.tipo === tipo && formaInvalida(e.tipo, e.dados) === null;

function paraDecisao(e: Evento): DecisaoSombra {
  const d = e.dados as Record<string, unknown>;
  const dec: DecisaoSombra = {
    hash: d.pergunta_hash as string, resposta: d.resposta as string, arquivo: d.arquivo as string,
    pergunta_enviesada: d.pergunta_enviesada as boolean, sessao: e.sessao, seq: e.seq, ts: e.ts,
  };
  if (d.req !== undefined) dec.req = d.req as string;
  if (d.task !== undefined) dec.task = d.task as string;
  if (d.fontes !== undefined) dec.fontes = d.fontes as string[];
  if (d.medicao !== undefined) dec.medicao = d.medicao as string;
  if (d.fora_da_regra === true) dec.fora_da_regra = true;
  if (d.emenda_seq !== undefined) dec.emenda_seq = d.emenda_seq as number;
  return dec;
}

export type Vigente = { dec: DecisaoSombra; pos: number };

/**
 * Vigentes por hash, com a posição na ordem do diário. Entre as `decisao.sombra` de forma válida do mesmo hash:
 * 1. `substitui {sessao, seq}` que aponta uma decisão válida do MESMO hash tira o alvo da disputa, independente de `ts`
 *    (relógio defasado não desfaz a substituição); vale em cadeia (A←B←C: vence C). Alvo inexistente, de outro tipo, de forma
 *    inválida, de outro hash ou a própria decisão: o `substitui` é ignorado.
 * 2. Entre as que sobraram, vence a mais recente pela ordem do diário. Se todas foram substituídas (ciclo forjado, que o CLI
 *    nunca grava), vale a mais recente de todas: decisão gravada nunca some.
 * Diário fora de ordem ⇒ mapa vazio (ver cabeçalho).
 */
export function vigentes(eventos: Evento[]): Map<string, Vigente> {
  const ord = ordenado(eventos);
  const saida = new Map<string, Vigente>();
  if (ord === null) return saida;
  const porHash = new Map<string, { e: Evento; pos: number }[]>();
  ord.forEach((e, pos) => {
    if (!valido(e, 'decisao.sombra')) return;
    const h = (e.dados as { pergunta_hash: string }).pergunta_hash;
    const lista = porHash.get(h) ?? [];
    lista.push({ e, pos });
    porHash.set(h, lista);
  });
  for (const [h, lista] of porHash) {
    const substituidas = new Set<Evento>();
    for (const { e } of lista) {
      const s = (e.dados as { substitui?: { sessao: string; seq: number } }).substitui;
      if (s === undefined) continue;
      const alvo = lista.find((c) => c.e.sessao === s.sessao && c.e.seq === s.seq);
      if (alvo !== undefined && alvo.e !== e) substituidas.add(alvo.e);
    }
    const livres = lista.filter((c) => !substituidas.has(c.e));
    const disputa = livres.length > 0 ? livres : lista;
    const escolhida = disputa[disputa.length - 1];
    saida.set(h, { dec: paraDecisao(escolhida.e), pos: escolhida.pos });
  }
  return saida;
}

/** Decisão vigente por hash (regra em `vigentes`). */
export function projetarDecisoes(eventos: Evento[]): Map<string, DecisaoSombra> {
  return new Map([...vigentes(eventos)].map(([h, v]) => [h, v.dec]));
}

/** Consultas ao agente = `sombra.consulta` de forma válida. Decisão e acerto de cache não contam (REQ-SOM-4). */
export function contarConsultas(eventos: Evento[]): number {
  if (!Array.isArray(eventos)) return 0;
  let n = 0;
  for (const e of eventos) if (e !== null && typeof e === 'object' && valido(e, 'sombra.consulta')) n += 1;
  return n;
}

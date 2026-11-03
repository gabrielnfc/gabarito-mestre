import { estadoDe, ordenar } from './loop.ts';
import type { Evento } from './tipos.ts';

/**
 * Núcleo do pouso (REQ-POU-1, GM-10 T9). Puro e sem `node:`: o mod o importa dentro do ambiente dele, que não tem Node.
 * A única E/S descrita aqui é o texto da ponte (`codigoPonte`), que o mod entrega a `node` por `$.process.run`.
 */

export const X_PADRAO = 50;
/** F3 ≈ 1,5k tokens (S12: ~2,16 caracteres por token). Acima disso o pouso não acontece: nunca se trunca calado. */
export const INSTANTANEO_MAX = 3200;
/** Nome real em `agents/gabarito-revisor.md` e o mesmo com o namespace do plugin; comparação por igualdade, nunca por prefixo. */
export const REVISORES: readonly string[] = ['gabarito-revisor', 'gabarito-mestre:gabarito-revisor'];

export type DecisaoPouso = 'nada' | 'bloquear_despacho' | 'pousar';
export type EntradaPouso = {
  percent: number | null;
  x: number;
  vivos: number;
  fronteira: boolean;
  jaPousando: boolean;
  orquestrador: boolean;
};

/** Primeira linha que casa. Dado ausente ou fora do tipo nunca vira pouso: `percent` indefinido é `nada`, `vivos` e `fronteira` ruins bloqueiam. */
export function decidirPouso(a: EntradaPouso): DecisaoPouso {
  if (a.orquestrador !== true) return 'nada';
  if (typeof a.percent !== 'number' || !Number.isFinite(a.percent)) return 'nada';
  if (a.jaPousando) return 'nada';
  if (a.percent < a.x) return 'nada';
  if (a.vivos !== 0 || a.fronteira !== true) return 'bloquear_despacho';
  return 'pousar';
}

const X_RE = /^\d+(\.\d+)?$/;

/** `GABARITO_POUSO_X`: número decimal em (0, 100]; ausente ⇒ 50; presente e inválido ⇒ 50 com aviso. */
export function lerX(bruto: string | undefined): { x: number; aviso: string | null } {
  if (bruto === undefined) return { x: X_PADRAO, aviso: null };
  const t = typeof bruto === 'string' ? bruto.trim() : '';
  const n = X_RE.test(t) ? Number(t) : Number.NaN;
  if (Number.isFinite(n) && n > 0 && n <= 100) return { x: n, aviso: null };
  return { x: X_PADRAO, aviso: `GABARITO_POUSO_X inválido (${JSON.stringify(String(bruto).slice(0, 20))}): usando ${X_PADRAO}` };
}

/** Só estes não contam. `pending|running|waiting` contam, e qualquer outro valor também (dado desconhecido não vira zero). */
const ENCERRADO: ReadonlySet<string> = new Set(['idle', 'completed', 'failed', 'killed']);

/** `$.agent.list` sem `pending|running|waiting`. Lista ausente, corrompida ou com status desconhecido conta como vivo. */
export function vivosDe(lista: unknown): number {
  if (!Array.isArray(lista)) return 1;
  let n = 0;
  for (const a of lista) {
    const s = a !== null && typeof a === 'object' ? (a as { status?: unknown }).status : undefined;
    if (typeof s === 'string' && ENCERRADO.has(s)) continue;
    n += 1;
  }
  return n;
}

const TIPOS_DE_TASK: readonly string[] = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'];

/**
 * Fronteira (visão §6.7): a última transição de task do diário é `review.veredito` e a sequência dessa task é válida para a T2
 * (`ordenar` + `estadoDe`). Diário ilegível, fora de ordem ou com sequência inválida ⇒ falso.
 */
export function fronteira(eventos: unknown): boolean {
  if (!Array.isArray(eventos) || eventos.length === 0) return false;
  let ord: ReturnType<typeof ordenar>;
  try {
    ord = ordenar(eventos as Evento[]);
  } catch {
    return false;
  }
  if (!ord.ok) return false;
  const task = (e: Evento): unknown => (e.dados !== null && typeof e.dados === 'object' ? e.dados.task : undefined);
  const deTask = ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && typeof task(e) === 'string');
  const ultimo = deTask[deTask.length - 1];
  if (ultimo === undefined || ultimo.tipo !== 'review.veredito') return false;
  const dela = deTask.filter((e) => task(e) === task(ultimo));
  return !('invalido' in estadoDe(dela));
}

export function ehRevisor(subagentType: unknown): boolean {
  return typeof subagentType === 'string' && REVISORES.includes(subagentType);
}

const CONTAGENS = [
  ['input_tokens', 'input_tokens'],
  ['output_tokens', 'output_tokens'],
  ['cache_read_input_tokens', 'cache_read'],
  ['cache_creation_input_tokens', 'cache_creation'],
] as const;

/** `turn.complete.usage` ⇒ `dados` de `custo.medicao`: só as quatro contagens, como T10. Qualquer uma ausente ou inválida ⇒ `null` (nada inventado). */
export function dadosMedicao(usage: unknown): Record<string, number> | null {
  if (usage === null || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const dados: Record<string, number> = {};
  for (const [de, para] of CONTAGENS) {
    const v = u[de];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    dados[para] = v;
  }
  return dados;
}

const CABECALHO = 'Pouso automático: o contexto foi limpo. Retome o loop do plano pelo diário; estado abaixo.';

/** Prompt de retomada = cabeçalho curto + instantâneo inteiro. Vazio ou acima do teto ⇒ `null`: o pouso não acontece. */
export function textoRetomada(instantaneo: string): string | null {
  if (typeof instantaneo !== 'string' || instantaneo.trim() === '') return null;
  if (instantaneo.length > INSTANTANEO_MAX) return null;
  return `${CABECALHO}\n\n${instantaneo}`;
}

/**
 * Programa que o mod passa a `node --input-type=module -e` (o ambiente do mod não tem `node:`). Lê UM objeto JSON no stdin
 * (`{op, …}`), escreve UM JSON no stdout e sempre sai 0. Dados nunca entram no programa: só o caminho do `diario.js`.
 * Ops: `dir` (raiz, pasta da entrega, `plano.json`), `ler`, `instantaneo`, `append` (`unicoPorAgente` não repete o par tipo+agente).
 */
export function codigoPonte(diarioUrl: string): string {
  return [
    `import * as d from ${JSON.stringify(diarioUrl)};`,
    `import { readFileSync, existsSync } from 'node:fs';`,
    `import { execFileSync } from 'node:child_process';`,
    `import { join } from 'node:path';`,
    `const out = (o) => process.stdout.write(JSON.stringify(o));`,
    `const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();`,
    `try {`,
    `  const e = JSON.parse(readFileSync(0, 'utf8'));`,
    `  if (e.op === 'dir') {`,
    `    const raiz = git(['rev-parse', '--show-toplevel'], e.cwd);`,
    `    let pbi = null;`,
    `    try { pbi = /[A-Z]+-\\d+/.exec(git(['symbolic-ref', '--short', 'HEAD'], raiz))?.[0] ?? null; } catch {}`,
    `    const dir = d.dirEntrega(raiz, pbi);`,
    `    out({ ok: true, raiz, dir, plano: existsSync(join(dir, 'plano.json')) });`,
    `  } else if (e.op === 'ler') {`,
    `    out({ ok: true, eventos: d.ler(e.dir) });`,
    `  } else if (e.op === 'instantaneo') {`,
    `    out({ ok: true, texto: d.projetar(d.ler(e.dir)).instantaneo });`,
    `  } else if (e.op === 'append') {`,
    `    if (e.unicoPorAgente === true && d.ler(e.dir).some((x) => x?.tipo === e.ev.tipo && x.agente === e.ev.agente)) {`,
    `      out({ ok: true, gravado: 'ja_existia' });`,
    `    } else {`,
    `      let autor = 'desconhecido';`,
    `      try { autor = git(['config', 'user.email'], e.cwd) || autor; } catch {}`,
    `      const r = d.append(e.dir, e.sessao, { ts: new Date().toISOString(), autor, sessao: e.sessao, ...e.ev });`,
    `      out(r.ok && r.gravado !== 'evento' ? { ok: false, erro: 'diário recusou o evento' } : r);`,
    `    }`,
    `  } else {`,
    `    out({ ok: false, erro: 'op desconhecida' });`,
    `  }`,
    `} catch (x) {`,
    `  out({ ok: false, erro: String(x?.message ?? x).slice(0, 200) });`,
    `}`,
  ].join('\n');
}

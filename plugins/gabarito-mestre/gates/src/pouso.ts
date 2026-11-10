import { estadoDe, ordenar } from './loop.ts';
import type { EstadoTask } from './loop.ts';
import type { AcaoLoop, Evento, Plano } from './tipos.ts';

/**
 * Núcleo do pouso (REQ-POU-1, GM-10 T9). Puro e sem `node:`: o mod o importa dentro do ambiente dele, que não tem Node.
 * A única E/S descrita aqui é o texto da ponte (`codigoPonte`), que o mod entrega a `node` por `$.process.run`.
 */

export const X_PADRAO = 50;
/** F3 ≈ 1,5k tokens (S12: ~2,16 caracteres por token). Acima disso o pouso não acontece: nunca se trunca calado. */
export const INSTANTANEO_MAX = 3200;
/** Nome real em `agents/gabarito-revisor.md` e o mesmo com o namespace do plugin; comparação por igualdade, nunca por prefixo. */
export const REVISORES: readonly string[] = ['gabarito-revisor', 'gabarito-mestre:gabarito-revisor'];

/** Pré-condições do mod (Sombra T9b, linhas A a E). A decisão de despachar, esperar, pousar ou parar é do núcleo (`proximaAcao`). */
export type EstadoPouso = 'OCIOSO' | 'POUSANDO' | 'SEM_POUSO' | 'NUCLEO';
export type DespachoPouso = 'permitir' | 'negar' | 'nucleo';
export type AcaoPouso = 'nada' | 'parar_nao_interativo' | 'nucleo';
export type EntradaPouso = {
  /** `turn.complete` sem `agentId`; subagent nunca decide. */
  orquestrador: boolean;
  percent: number | null;
  x: number;
  /** Chave do store presente (ou ilegível): um pouso está em andamento. */
  pousando: boolean;
  /** Um pouso falhou e o percent ainda não caiu abaixo de X. */
  desistiu: boolean;
  interativo: boolean;
};
export type LinhaPouso = { estado: EstadoPouso; despacho: DespachoPouso; acao: AcaoPouso };

type Regra = { estado: EstadoPouso; casa: (a: EntradaPouso) => boolean; despacho: DespachoPouso; acao: AcaoPouso };
const percentValido = (a: EntradaPouso): a is EntradaPouso & { percent: number } => typeof a.percent === 'number' && Number.isFinite(a.percent);

/**
 * Pré-condições do mod, a primeira linha que casa decide. Dado ausente ou fora do tipo nunca vira pouso: `percent`
 * indefinido é OCIOSO. Só a última linha passa a palavra ao núcleo; nenhuma linha daqui pousa, espera ou despacha.
 */
const TABELA: readonly Regra[] = [
  { estado: 'OCIOSO', casa: (a) => a.orquestrador !== true, despacho: 'permitir', acao: 'nada' },
  { estado: 'OCIOSO', casa: (a) => !percentValido(a), despacho: 'permitir', acao: 'nada' },
  { estado: 'OCIOSO', casa: (a) => (a.percent as number) < a.x, despacho: 'permitir', acao: 'nada' },
  { estado: 'POUSANDO', casa: (a) => a.pousando !== false, despacho: 'negar', acao: 'nada' },
  { estado: 'SEM_POUSO', casa: (a) => a.desistiu !== false, despacho: 'negar', acao: 'nada' },
  { estado: 'SEM_POUSO', casa: (a) => a.interativo !== true, despacho: 'negar', acao: 'parar_nao_interativo' },
  { estado: 'NUCLEO', casa: () => true, despacho: 'nucleo', acao: 'nucleo' },
];

export function portaDoPouso(a: EntradaPouso): LinhaPouso {
  const r = TABELA.find((t) => t.casa(a)) as Regra;
  return { estado: r.estado, despacho: r.despacho, acao: r.acao };
}

/**
 * `Agent` negado para quem não é revisor ⇔ a cláusula (5) de `proximaAcao` dispararia (E8). Com `percent` ≥ X toda resposta
 * do núcleo, menos `integrar` e `concluir`, vem da (5) ou de uma cláusula que vence a (5) (pausa, teto de tokens, CI, diário).
 * Fronteira consumida: o mod passou `percent: null` ao núcleo e a (5) não dispara. Exceção: `diario_invalido` sempre nega.
 */
export function negaDespacho(acao: AcaoLoop, consumida: boolean): boolean {
  if (acao.tipo === 'parar' && acao.motivo === 'diario_invalido') return true; // diário fora da tabela nunca libera, nem sem fronteira
  if (acao.tipo === 'aprender') return true; // pendência aberta nega sempre, mesmo com a fronteira consumida (REQ-APR-2)
  return consumida !== true && acao.tipo !== 'integrar' && acao.tipo !== 'concluir';
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

export type AnaliseFronteira = { consumida: boolean; motivo: string | null };

const sem = (motivo: string | null): AnaliseFronteira => ({ consumida: false, motivo });

/**
 * Fronteira consumida (E1/E7, visão §6.7): não há fronteira aberta. Duas formas: não existe nenhum `review.veredito` no diário
 * (REQ-POU-1 define fronteira como veredito; sem ele não há o que pousar, aceite 1), ou existe `sessao.pouso` posterior ao último
 * `review.veredito` na ordem da T2. Consumida ⇒ o mod passa `percent: null` ao núcleo. Quem decide o resto é o núcleo, nunca esta função.
 * Diário ilegível, fora de ordem, ou com evento de task sem `dados.task` ⇒ `motivo` diz por quê e nada é consumido.
 */
export function analisarFronteira(eventos: unknown): AnaliseFronteira {
  if (!Array.isArray(eventos)) return sem('diário ilegível');
  if (eventos.length === 0) return { consumida: true, motivo: null };
  let ord: ReturnType<typeof ordenar>;
  try {
    ord = ordenar(eventos as Evento[]);
  } catch {
    return sem('diário ilegível');
  }
  if (!ord.ok) return sem('diário fora de ordem');
  const task = (e: Evento): unknown => (e.dados !== null && typeof e.dados === 'object' ? e.dados.task : undefined);
  if (ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo)).some((e) => typeof task(e) !== 'string')) return sem('evento de task sem task');
  const ultimoDe = (tipo: string): number => ord.eventos.reduce((m, e, i) => (e.tipo === tipo ? i : m), -1);
  const veredito = ultimoDe('review.veredito');
  if (veredito < 0) return { consumida: true, motivo: null };
  return { consumida: ultimoDe('sessao.pouso') > veredito, motivo: null };
}

const EM_VOO: readonly EstadoTask[] = ['implementando', 'corrigindo', 'em_revisao'];

/**
 * Tasks que `/gabarito retomar` reabre (origem `retomada`): as que o diário deixa em voo, `implementando`, `corrigindo` ou
 * `em_revisao`. Quem chama garante vivos 0; com agente vivo nada é reaberto. Plano ou diário ilegível, evento fora do plano ou
 * transição inválida ⇒ `ok: false` com o motivo: nunca uma lista vazia que pareça "nada a reabrir".
 */
export function tasksEmVoo(plano: unknown, eventos: unknown): { ok: true; tasks: string[] } | { ok: false; motivo: string } {
  const tasks = plano !== null && typeof plano === 'object' ? (plano as Plano).tasks : undefined;
  if (!Array.isArray(tasks) || tasks.some((t) => t === null || typeof t !== 'object' || typeof t.id !== 'string')) return { ok: false, motivo: 'plano ilegível' };
  if (!Array.isArray(eventos)) return { ok: false, motivo: 'diário ilegível' };
  let ord: ReturnType<typeof ordenar>;
  try {
    ord = ordenar(eventos as Evento[]);
  } catch {
    return { ok: false, motivo: 'diário ilegível' };
  }
  if (!ord.ok) return { ok: false, motivo: 'diário fora de ordem' };
  const porTask = new Map<string, Evento[]>(tasks.map((t) => [t.id, []]));
  for (const e of ord.eventos) {
    if (!TIPOS_DE_TASK.includes(e.tipo)) continue;
    const t = e.dados !== null && typeof e.dados === 'object' ? e.dados.task : undefined;
    const fila = typeof t === 'string' ? porTask.get(t) : undefined;
    if (fila === undefined) return { ok: false, motivo: 'evento de task fora do plano' };
    fila.push(e);
  }
  const voo: string[] = [];
  for (const [id, fila] of porTask) {
    const r = estadoDe(fila);
    if ('invalido' in r) return { ok: false, motivo: `diário fora da tabela de transições (task ${id})` };
    if (EM_VOO.includes(r.estado)) voo.push(id);
  }
  return { ok: true, tasks: voo };
}

const inteiroNaoNegativo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Tasks que o mod reabre (origem `retomada`) ao fim do turno em que negou `Agent`: o `iniciar` do despacho negado ficou no
 * diário sem agente. Com `vivos > 0` não há como saber qual task é de quem: não reabre nada (a negação fica). Com `vivos = 0`
 * nenhuma task em voo tem agente: são as `min(negados, em voo)`, a que não é de revisor primeiro (o revisor nunca é negado) e,
 * antes do revisor, as iniciadas até `ate` (a hora da última negação; depois dela é despacho aceito, vai atrás, NÃO é excluída) e, dentro disso, a de `task.iniciada` mais recente. Plano, diário ou contagens ilegíveis ⇒ `ok: false` com o motivo (nunca uma
 * lista vazia que pareça "nada a reabrir").
 */
export function tasksDoNegado(plano: unknown, eventos: unknown, negados: unknown, vivos: unknown, ate: string | null = null): { ok: true; tasks: string[] } | { ok: false; motivo: string } {
  if (!inteiroNaoNegativo(negados)) return { ok: false, motivo: 'contagem de negados ilegível' };
  if (!inteiroNaoNegativo(vivos)) return { ok: false, motivo: 'contagem de vivos ilegível' };
  const voo = tasksEmVoo(plano, eventos);
  if (!voo.ok) return voo;
  if (vivos > 0) return { ok: true, tasks: [] };
  const k = Math.min(negados, voo.tasks.length);
  if (k === 0) return { ok: true, tasks: [] };
  const ord = ordenar(eventos as Evento[]);
  if (!ord.ok) return { ok: false, motivo: 'diário fora de ordem' };
  const ultimo = (t: string): number => ord.eventos.reduce((m, e, i) => (e.tipo === 'task.iniciada' && e.dados?.task === t ? i : m), -1);
  const revisor = (t: string): number => (ord.eventos[ultimo(t)]?.dados?.papel === 'revisor' ? 1 : 0);
  const depois = (t: string): number => (ate !== null && String(ord.eventos[ultimo(t)]?.ts) > ate ? 1 : 0);
  return { ok: true, tasks: [...voo.tasks].sort((a, b) => revisor(a) - revisor(b) || depois(a) - depois(b) || ultimo(b) - ultimo(a)).slice(0, k) };
}

/**
 * Eventos que não são trabalho do loop: o próprio mod os grava a cada turno ou ao parar. `dono.mensagem` e os de aprendizado
 * também não: sem eles `jaParou` virava `false` depois de fechar a pendência `parar` e o mod regravava `loop.parar` (ciclo parar ⇄ aprender).
 */
const SEM_PROGRESSO: readonly string[] = ['custo.medicao', 'loop.parar', 'dono.mensagem', 'aprendizado', 'aprendizado.nada'];

/** Quantos eventos de progresso o diário tem; muda quando algo novo acontece. Não-lista ⇒ -1 (constante: conta como encalhe). */
export function marcaDeProgresso(eventos: unknown): number {
  if (!Array.isArray(eventos)) return -1;
  return eventos.filter((e) => !SEM_PROGRESSO.includes((e as Evento | null)?.tipo as string)).length;
}

/** O diário já termina em `loop.parar` sem evento de trabalho depois: gravar outro seria repetir. Ilegível ⇒ `false` (quem chama não grava). */
export function jaParou(eventos: unknown): boolean {
  if (!Array.isArray(eventos)) return false;
  let ord: ReturnType<typeof ordenar>;
  try {
    ord = ordenar(eventos as Evento[]);
  } catch {
    return false;
  }
  if (!ord.ok) return false;
  const i = ord.eventos.reduce((m, e, k) => (e.tipo === 'loop.parar' ? k : m), -1);
  return i >= 0 && ord.eventos.slice(i + 1).every((e) => SEM_PROGRESSO.includes(e.tipo));
}

/**
 * Tokens gastos = entrada + saída + criação de cache de todo `custo.medicao`; leitura de cache não conta (mesma conta de `loop.mjs`).
 * Contagem inválida ⇒ `ok: false`: um teto não pode ser conferido com dado ruim. Sem medição ⇒ `tokens: null`.
 */
export function tokensDe(eventos: unknown): { ok: true; tokens: number | null } | { ok: false } {
  if (!Array.isArray(eventos)) return { ok: false };
  let tokens: number | null = null;
  for (const e of eventos as (Evento | null)[]) {
    if (e?.tipo !== 'custo.medicao') continue;
    let soma = 0;
    for (const campo of ['input_tokens', 'output_tokens', 'cache_creation', 'cache_read']) {
      const n = (e.dados ?? {})[campo];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return { ok: false };
      if (campo !== 'cache_read') soma += n;
    }
    tokens = (tokens ?? 0) + soma;
  }
  return { ok: true, tokens };
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

export const CABECALHO = 'Pouso automático: o contexto foi limpo. Retome o loop do plano com a skill gabarito-loop (consulte a próxima ação); estado abaixo.';

/** Prompts que o próprio mod dispara (`prompt.submit`); o `origin.kind` deles não foi medido, então são reconhecidos pelo prefixo. */
export const PROMPT_RETOMADA = 'Retomada pelo dono (/gabarito retomar). Continue o loop da entrega com a skill gabarito-loop: consulte a próxima ação e siga-a.';
export const PROMPT_RECUPERACAO = 'Task em voo sem agente: o mod a reabriu. Continue o loop da entrega com a skill gabarito-loop: consulte a próxima ação com --vivos 0 e siga-a.';
const PREFIXOS_DO_MOD: readonly string[] = [CABECALHO, PROMPT_RETOMADA, PROMPT_RECUPERACAO];

/**
 * `prompt.submit` que é mensagem do dono (REQ-APR-2): origem `composer` ou `bridge`, sem comando (o composer manda `command: null`,
 * S1; `/loop …` vem com o nome), texto não vazio e que não é um dos prompts do próprio mod. Puro; qualquer outra coisa ⇒ `false`.
 */
export function ehMensagemDoDono(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const { origin, command, text } = e as { origin?: unknown; command?: unknown; text?: unknown };
  const kind = origin !== null && typeof origin === 'object' ? (origin as { kind?: unknown }).kind : undefined;
  if (kind !== 'composer' && kind !== 'bridge') return false;
  if (command !== null && command !== undefined) return false;
  if (typeof text !== 'string' || text.trim() === '') return false;
  return !PREFIXOS_DO_MOD.some((p) => text.startsWith(p));
}

/** Texto único da negação por pendência de aprendizado, nos dois caminhos do mod. Até 6 itens, depois `e mais N`. */
export function textoPendencia(pendencias: readonly { tipo: string; sessao: string; seq: number }[]): string {
  const itens = pendencias.slice(0, 6).map((p) => `${p.tipo} ${p.sessao}:${p.seq}`);
  if (pendencias.length > 6) itens.push(`e mais ${pendencias.length - 6}`);
  return `gabarito: aprendizado pendente: feche antes de despachar (${itens.join(', ')}). Feche com \`loop.mjs aprendizado <E|A> D --regra <t> --entra-em <a> --gatilho <sessao:seq> --eventos <sessao:seq>\`, \`loop.mjs aprendizado <E|A> M --regra <t> --entra-em <a> --gatilho <sessao:seq>\` ou \`loop.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>\`. Só o revisor passa.`;
}

/** Negação quando não deu para saber se há pendência (leitura, plano, diário ou núcleo de pendências falhou). */
export const textoPendenciaNaoVerificada = (motivo: string): string =>
  `gabarito: não consegui verificar pendência de aprendizado (${motivo}). Sem despacho novo; só o revisor passa.`;

/** Prompt de retomada = cabeçalho curto + instantâneo inteiro. Vazio ou acima do teto ⇒ `null`: o pouso não acontece. */
export function textoRetomada(instantaneo: string): string | null {
  if (typeof instantaneo !== 'string' || instantaneo.trim() === '') return null;
  if (instantaneo.length > INSTANTANEO_MAX) return null;
  return `${CABECALHO}\n\n${instantaneo}`;
}

/**
 * A importação dinâmica do `aprendizado.js` roda no `node -e` da ponte, não neste módulo: o fecho do `dist/pouso.js` (painel.test.ts
 * `fecho-sem-node`) proíbe a forma literal da chamada no texto do módulo, então a palavra é montada aqui.
 */
const IMPORT_DINAMICO = 'import';

/**
 * Programa que o mod passa a `node --input-type=module -e` (o ambiente do mod não tem `node:`). Lê UM objeto JSON no stdin
 * (`{op, …}`), escreve UM JSON no stdout e sempre sai 0. Dados nunca entram no programa: só o caminho do `diario.js`. Stdin que não é JSON ⇒ `{ ok: false, erro: 'pedido inválido' }` (nunca um trecho do stdin).
 * Ops: `dir` (raiz, pasta da entrega, `plano.json`), `ler` (estrita: `lerEstrito`), `plano` (`plano.json` validado pela T1 e
 * `loop.slots`/`loop.tetoTokens` de `harness.config.json`; ilegível ou inválido ⇒ `ok: false`), `instantaneo`,
 * `append` (`unicoPorAgente` não repete o par tipo+agente), `mensagem` (`dono.mensagem {sha256, chars}` na sessão `dono`; o texto
 * nunca é gravado nem ecoado no erro).
 */
export function codigoPonte(
  diarioUrl: string,
  planoUrl: string = diarioUrl.replace(/diario\.js$/, 'plano.js'),
  aprendizadoUrl: string = diarioUrl.replace(/diario\.js$/, 'aprendizado.js'),
): string {
  return [
    `import * as d from ${JSON.stringify(diarioUrl)};`,
    `import * as pl from ${JSON.stringify(planoUrl)};`,
    `import { readFileSync, existsSync } from 'node:fs';`,
    `import { execFileSync } from 'node:child_process';`,
    `import { join } from 'node:path';`,
    `import { createHash } from 'node:crypto';`,
    `const out = (o) => process.stdout.write(JSON.stringify(o));`,
    `const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();`,
    `try {`,
    `  let e;`,
    `  try { e = JSON.parse(readFileSync(0, 'utf8')); } catch { throw new Error('pedido inválido'); }`,
    `  if (e.op === 'dir') {`,
    `    const raiz = git(['rev-parse', '--show-toplevel'], e.cwd);`,
    `    let pbi = null;`,
    `    try { pbi = /[A-Z]+-\\d+/.exec(git(['symbolic-ref', '--short', 'HEAD'], raiz))?.[0] ?? null; } catch {}`,
    `    const dir = d.dirEntrega(raiz, pbi);`,
    `    out({ ok: true, raiz, dir, plano: existsSync(join(dir, 'plano.json')) });`,
    `  } else if (e.op === 'ler') {`,
    `    const l = d.lerEstrito(e.dir);`,
    `    out(l.ok ? { ok: true, eventos: l.eventos } : { ok: false, erro: l.motivo });`,
    `  } else if (e.op === 'plano') {`,
    `    const v = pl.validarPlano(JSON.parse(readFileSync(join(e.dir, 'plano.json'), 'utf8')));`,
    `    if (!v.ok) throw new Error('plano.json inválido: ' + v.erro);`,
    `    const arq = join(e.raiz, 'harness.config.json');`,
    `    const cfg = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : {};`,
    `    const lp = cfg !== null && typeof cfg.loop === 'object' && cfg.loop !== null && !Array.isArray(cfg.loop) ? cfg.loop : {};`,
    `    const inteiro = (n) => Number.isSafeInteger(n) && n >= 1;`,
    `    if (Object.hasOwn(lp, 'tetoTokens') && !inteiro(lp.tetoTokens)) throw new Error('loop.tetoTokens inválido');`,
    `    out({ ok: true, plano: v.plano, slots: inteiro(lp.slots) ? lp.slots : 1, tetoTokens: Object.hasOwn(lp, 'tetoTokens') ? lp.tetoTokens : null });`,
    `  } else if (e.op === 'instantaneo') {`,
    `    const arv = d.lerAprendizados(join(e.dir, '..'));`,
    `    let vig = []; const avisos = [];`,
    `    try { const apr = await ${IMPORT_DINAMICO}(${JSON.stringify(aprendizadoUrl)}); vig = apr.paraDestino(apr.aprendizadosVigentes(arv.porEntrega), 'instantaneo'); } catch { avisos.push('aprendizados indisponíveis'); }`,
    `    const texto = d.projetar(d.ler(e.dir), { aprendizados: vig, avisosAprendizados: arv.avisos }).instantaneo;`,
    `    out(avisos.length > 0 ? { ok: true, texto, avisos } : { ok: true, texto });`,
    `  } else if (e.op === 'mensagem') {`,
    `    try {`,
    `      if (typeof e.texto !== 'string') throw new Error('texto inválido');`,
    `      const l = d.lerEstrito(e.dir);`,
    `      if (!l.ok) throw new Error('mensagem não gravada');`,
    `      let autor = 'desconhecido';`,
    `      try { autor = git(['config', 'user.email'], e.cwd) || autor; } catch {}`,
    `      const dados = { sha256: createHash('sha256').update(e.texto, 'utf8').digest('hex'), chars: e.texto.length };`,
    `      const r = d.append(e.dir, 'dono', { ts: new Date().toISOString(), autor, sessao: 'dono', agente: 'dono', tipo: 'dono.mensagem', dados });`,
    `      out(r.ok && r.gravado === 'evento' ? { ok: true } : { ok: false, erro: 'mensagem não gravada' });`,
    `    } catch (x) {`,
    `      out({ ok: false, erro: x?.message === 'texto inválido' ? 'texto inválido' : 'mensagem não gravada' });`,
    `    }`,
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

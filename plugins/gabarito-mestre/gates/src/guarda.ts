/**
 * Hook único da guarda (REQ-GRD-3): `PreToolUse` → stdin JSON → decisão por faixa → stdout. Sempre exit 0.
 *
 * Fluxo: stdin → JSON → raiz por fs → config de origin/HEAD (só com raiz) → contexto (só se `precisaContexto`)
 * → `decidir` → stdout → diário. A decisão sai ANTES do `append` (que pode esperar até 3 s por lock): o
 * `timeout: 5` do hook nunca derruba um `ask`/`deny` já decidido.
 *
 * Nunca devolve `allow` (D1). Envelope ilegível não é decidível: aviso em stderr e exit 0 (fail-open declarado,
 * G9). Envelope lido + QUALQUER exceção depois (Q21): o que a guarda não conseguiu classificar, ela pede, em toda
 * chamada (`ask` ao orquestrador, `deny` ao subagent), com saída constante que não depende do caminho que falhou.
 * Nenhuma variável de ambiente muda o veredito: não existe escape hatch.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precisaContexto } from './classificar-alvo.ts';
import { decidir } from './decidir.ts';
import { append, dirEntrega } from './diario.ts';
import type { AmbienteDecl, ConfigGuarda, Contexto, Decisao, EntradaHook, TipoEvento } from './tipos.ts';

const GIT_TIMEOUT_MS = 2000;
const CONFIG_MAX = 1 << 20;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ID_PADRAO = '[A-Z]+-\\d+';
const CHAVES_AMBIENTE: Array<keyof AmbienteDecl> = ['hosts', 'projetos', 'bancos', 'mcps', 'variaveis', 'branches'];

type Fonte = 'origin' | 'local' | 'nenhuma';
type Guarda = { config: ConfigGuarda | null; fonte: Fonte; divergente: boolean; localIgnorada: boolean; onboarding: boolean; idPadrao: string };

// ---------------------------------------------------------------------------------------------------------------
// fs e git

/** Raiz do repo por fs (sem spawn): sobe até achar `.git` (diretório, ou arquivo de worktree). */
export function raizPorFs(inicio: unknown): string | null {
  if (typeof inicio !== 'string' || inicio === '') return null;
  let d = resolve(inicio);
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(d, '.git'))) return d;
    const pai = dirname(d);
    if (pai === d) return null;
    d = pai;
  }
  return null;
}

function git(cwd: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: CONFIG_MAX, stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

const lista = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
const objeto = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseJson(texto: string | null): Record<string, unknown> | null {
  if (texto === null) return null;
  try {
    return objeto(JSON.parse(texto));
  } catch {
    return null;
  }
}

function lerLocal(raiz: string): string | null {
  try {
    const arq = join(raiz, 'harness.config.json');
    return statSync(arq).size <= CONFIG_MAX ? readFileSync(arq, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Recorte que vale para a guarda: `guarda.*`, `versionamento.branchPadrao`, `fluxo.idPadrao`. */
function normalizar(raw: Record<string, unknown>, fonte: 'origin' | 'local'): { config: ConfigGuarda | null; idPadrao: string; assinatura: string } {
  const guarda = objeto(raw.guarda);
  const branchPadrao = objeto(raw.versionamento)?.branchPadrao;
  const idPadrao = objeto(raw.fluxo)?.idPadrao;
  const assinatura = JSON.stringify({ g: guarda, b: branchPadrao ?? null });
  const idOk = typeof idPadrao === 'string' && idPadrao.length <= 200 ? idPadrao : ID_PADRAO;
  const amb = objeto(guarda?.ambientes);
  if (amb === null) return { config: null, idPadrao: idOk, assinatura };

  const ambientes: ConfigGuarda['ambientes'] = {};
  for (const nome of ['teste', 'homolog', 'prod'] as const) {
    const decl = objeto(amb[nome]);
    if (decl === null) continue;
    const e: AmbienteDecl = {};
    for (const k of CHAVES_AMBIENTE) {
      const l = lista(decl[k]);
      if (l !== undefined) e[k] = l;
    }
    // prod default = branch padrão (REQ-GRD-1), lida da mesma fonte da config.
    if (nome === 'prod' && e.branches === undefined && typeof branchPadrao === 'string' && branchPadrao !== '') e.branches = [branchPadrao];
    ambientes[nome] = e;
  }
  // Fonte local: `permitidos` é tratado como vazio (D2) — a árvore é forjável pelo subagent.
  const permitidos = fonte === 'origin' ? (lista(objeto(guarda?.producao)?.permitidos) ?? []) : [];
  return { config: { ambientes, permitidos }, idPadrao: idOk, assinatura };
}

/** D2: config de `refs/remotes/origin/HEAD` (nome completo, Q4); sem ela, árvore local com `permitidos` vazio. */
function lerGuarda(raiz: string): Guarda {
  const local = parseJson(lerLocal(raiz));
  const origem = parseJson(git(raiz, ['show', 'refs/remotes/origin/HEAD:harness.config.json']));
  if (origem !== null) {
    const o = normalizar(origem, 'origin');
    const l = local === null ? null : normalizar(local, 'local');
    const divergente = l !== null && l.assinatura !== o.assinatura;
    // D2: origin sem seção `guarda` vence mesmo que a árvore local a tenha; a árvore local é ignorada, e isso se avisa.
    const localIgnorada = o.config === null && l !== null && l.config !== null;
    return { config: o.config, fonte: 'origin', divergente, localIgnorada, onboarding: true, idPadrao: o.idPadrao };
  }
  if (local !== null) {
    const l = normalizar(local, 'local');
    return { config: l.config, fonte: 'local', divergente: false, localIgnorada: false, onboarding: true, idPadrao: l.idPadrao };
  }
  return { config: null, fonte: 'nenhuma', divergente: false, localIgnorada: false, onboarding: false, idPadrao: ID_PADRAO };
}

function linhaDe(texto: string | null): string | null {
  const t = texto?.trim() ?? '';
  return t === '' ? null : t.split('\n')[0];
}

function montarContexto(entrada: EntradaHook, raiz: string | null, cwd: string, pluginRoot: string | null, raizes: string[]): Contexto {
  // `raizes`: as raízes da pausa, para o anel (`aneis.ts`); `raiz` segue sendo a do cwd (Q14).
  const nulos: Contexto & { raizes: string[] } = { branchAtual: null, refLinkado: null, remoteUrl: null, raiz, pluginRoot, raizes };
  if (!precisaContexto(entrada)) return nulos;
  const base = raiz ?? cwd;
  let refLinkado: string | null = null;
  for (const dir of [cwd, base]) {
    try {
      refLinkado = linhaDe(readFileSync(join(dir, 'supabase', '.temp', 'project-ref'), 'utf8'));
      if (refLinkado) break;
    } catch { /* sem projeto linkado */ }
  }
  return {
    ...nulos,
    branchAtual: linhaDe(git(base, ['symbolic-ref', '--short', 'HEAD'])),
    refLinkado,
    remoteUrl: linhaDe(git(base, ['remote', 'get-url', 'origin'])),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// mensagens, marcador e diário

/** Q7: uma vez por sessão. O marcador é só `wx` em `os.tmpdir()`; não altera o veredito. */
function primeiraVez(sessao: string | null): boolean {
  if (sessao === null) return true;
  try {
    closeSync(openSync(join(tmpdir(), `gm-guarda-${sessao}`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600));
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'EEXIST';
  }
}

function idDaEntrega(branch: string | null, idPadrao: string): string | null {
  if (branch === null) return null;
  try {
    const m = new RegExp(idPadrao).exec(branch);
    return m ? (m[1] ?? m[0]) : null;
  } catch {
    return /[A-Z]+-\d+/.exec(branch)?.[0] ?? null;
  }
}

/** Diretório do diário gravável? Checado ANTES de escrever a decisão, para o aviso entrar na mesma saída. */
function diarioGravavel(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function aviso(msg: string): void {
  process.stderr.write(`gabarito-mestre: ${msg} (guarda sem decisão, fail-open declarado)\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// saída e último recurso (Q21)

// Constantes: o pedido de último recurso não passa por JSON.stringify, por montagem de texto nem por dado da entrada.
const PEDIDO_ORQ = Buffer.from(
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"a guarda falhou ao classificar esta chamada e não sabe se ela toca segredo, integridade ou produção: confirme ou reduza o comando"}}\n',
);
const PEDIDO_SUB = Buffer.from(
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"a guarda falhou ao classificar esta chamada e não sabe se ela toca segredo, integridade ou produção: só o orquestrador pode pedir"}}\n',
);

const TENTATIVAS_ESCRITA = 100;

// Estado do último recurso: só a entrada lida e quanto da saída já foi para o stdout.
let atual: EntradaHook | null = null;
let pendente: Buffer | null = null;
let escritos = 0;
let jaEscreveu = false;

const ehSubagent = (entrada: EntradaHook | null): boolean => typeof entrada?.agent_id === 'string' && entrada.agent_id !== '';

/** Escreve o buffer inteiro (writeSync pode escrever menos). `jaEscreveu` só vira `true` depois de o último byte sair. */
function emitir(buf: Buffer): void {
  pendente = buf;
  for (let tentativas = 0; escritos < buf.length; ) {
    try {
      escritos += writeSync(1, buf, escritos);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EAGAIN' || ++tentativas >= TENTATIVAS_ESCRITA) throw e;
    }
  }
  jaEscreveu = true;
}

function saidaDe(r: Decisao, extras: string[]): Buffer | null {
  const saida: Record<string, unknown> = {};
  if (r.permissionDecision === 'ask' || r.permissionDecision === 'deny') {
    saida.hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: r.permissionDecision, permissionDecisionReason: r.motivo ?? 'a guarda pede confirmação' };
  }
  const msgs = r.systemMessage ? [r.systemMessage, ...extras] : extras;
  if (msgs.length > 0) saida.systemMessage = msgs.join(' · ');
  return Object.keys(saida).length > 0 ? Buffer.from(`${JSON.stringify(saida)}\n`) : null;
}

/** Mensagem do erro sem o que veio da entrada (comando, caminho, URL com credencial): vai ao stderr e ao diário. */
function limparErro(e: unknown, entrada: EntradaHook | null): string {
  let t = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const folhas: string[] = [];
  const colher = (v: unknown, nivel: number): void => {
    if (typeof v === 'string') { if (v.length >= 3) folhas.push(v); } else if (nivel < 4 && v !== null && typeof v === 'object') for (const x of Object.values(v)) colher(x, nivel + 1);
  };
  colher(entrada?.tool_input, 0);
  for (const f of folhas.sort((a, b) => b.length - a.length)) t = t.split(f).join('[entrada]');
  return t.replace(/\s+/g, ' ').slice(0, 160);
}

/** Q21: evento `guarda.ask|deny` com `motivo: "excecao"`, só se o diário estiver são; qualquer falha aqui é silenciosa. */
function registrarExcecao(entrada: EntradaHook, erro: string): void {
  try {
    const cwd = typeof entrada.cwd === 'string' && entrada.cwd !== '' ? entrada.cwd : process.cwd();
    const raiz = raizPorFs(process.env.CLAUDE_PROJECT_DIR) ?? raizPorFs(cwd);
    const sessao = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null;
    if (raiz === null || sessao === null) return;
    const guarda = lerGuarda(raiz);
    if (!guarda.onboarding) return;
    const dir = dirEntrega(raiz, idDaEntrega(linhaDe(git(raiz, ['symbolic-ref', '--short', 'HEAD'])), guarda.idPadrao));
    if (!diarioGravavel(dir)) return;
    const sub = ehSubagent(entrada);
    const autor = linhaDe(git(raiz, ['config', 'user.email'])) ?? 'desconhecido';
    append(dir, sessao, {
      ts: new Date().toISOString(),
      autor,
      sessao,
      agente: sub ? `subagent:${entrada.agent_id}` : 'orquestrador',
      tipo: sub ? 'guarda.deny' : 'guarda.ask',
      dados: { motivo: 'excecao', erro },
    });
  } catch { /* diário doente: a decisão já saiu */ }
}

/**
 * Último recurso: a guarda lançou depois de o envelope ser lido. Se a decisão já saiu inteira, nada a fazer; se saiu
 * pela metade, termina a MESMA saída (não mistura com outra); senão, pede com a saída constante.
 */
function pedirPorExcecao(e: unknown): void {
  const entrada = atual;
  if (entrada === null || jaEscreveu) return;
  const erro = limparErro(e, entrada);
  process.stderr.write(`gabarito-mestre: guarda falhou depois de ler a chamada (${erro}); pedindo\n`);
  try {
    emitir(escritos > 0 && pendente !== null ? pendente : ehSubagent(entrada) ? PEDIDO_SUB : PEDIDO_ORQ);
  } catch (e2) {
    process.stderr.write(`gabarito-mestre: não consegui escrever a decisão (${limparErro(e2, entrada)})\n`);
    return;
  }
  registrarExcecao(entrada, erro);
}


// ---------------------------------------------------------------------------------------------------------------
// kill switch (GM-10, REQ-POU-2)

const MSG_PAUSA = 'pausado: /gabarito retomar';

/** Erro de leitura ao descobrir o checkout principal: não é "sem principal", é "não sei" (a pausa vale). */
const ILEGIVEL = Symbol('ponteiro-ilegivel');

/** Raiz do checkout principal quando `raiz` é worktree (`.git` é arquivo): `commondir` por fs, sem spawn. `null` = não é worktree. */
export function raizPrincipal(raiz: string): string | null | typeof ILEGIVEL {
  try {
    const ponteiro = join(raiz, '.git');
    if (!lstatSync(ponteiro).isFile()) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(ponteiro, 'utf8'));
    if (m === null) return null;
    const gitdir = isAbsolute(m[1]) ? m[1] : resolve(raiz, m[1]);
    const comum = resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim());
    return basename(comum) === '.git' ? dirname(comum) : null;
  } catch (e) {
    // Só ENOENT é "não é worktree" (sem `.git`, submódulo sem `commondir`); qualquer outro erro de leitura não libera.
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : ILEGIVEL;
  }
}

/** Existência vale (arquivo, diretório, symlink quebrado). Só `ENOENT` é "ausente": outro erro de stat conta como pausa. */
export function existePausar(raiz: string): boolean {
  try {
    lstatSync(join(raiz, '.harness', 'PAUSAR'));
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/**
 * As raízes onde a pausa vale: a da sessão, a do cwd e o checkout principal de cada uma (worktree de task obedece o principal).
 * A mesma lista decide a leitura (`pausado`) e a proteção (anel de `.harness/PAUSAR`, `.harness` e a própria raiz).
 * `ilegivel`: o ponteiro de uma worktree não pôde ser lido; o principal é desconhecido e a pausa vale.
 */
export function raizesDePausa(raizSessao: string | null, raizCwd: string | null): { raizes: string[]; ilegivel: boolean } {
  const raizes: string[] = [];
  let ilegivel = false;
  for (const r of [raizSessao, raizCwd]) {
    if (r === null) continue;
    const p = raizPrincipal(r);
    if (p === ILEGIVEL) ilegivel = true;
    for (const c of [r, p]) if (typeof c === 'string' && !raizes.includes(c)) raizes.push(c);
  }
  return { raizes, ilegivel };
}

const pausado = (p: { raizes: string[]; ilegivel: boolean }): boolean => p.ilegivel || p.raizes.some(existePausar);

/** A única ferramenta que o subagent ainda usa sob pausa: devolver o relatório (nome exato). */
const HANDBACK = 'SubagentHandback';

/** Sob pausa: `Agent`/`Task` a todos; qualquer ferramenta a subagent, salvo a de devolver o relatório. O orquestrador segue a guarda normal nas outras. */
const negaPorPausa = (entrada: EntradaHook): boolean =>
  entrada.tool_name === 'Agent' || entrada.tool_name === 'Task' || (ehSubagent(entrada) && entrada.tool_name !== HANDBACK);

/** Sem pausa, o matcher `.*` entrega toda ferramenta; só estas têm classificação. O resto sai em silêncio, sem classificar. */
const CLASSIFICAVEIS = new Set(['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Agent', 'Task']);
const classificavel = (nome: string): boolean => CLASSIFICAVEIS.has(nome) || nome.startsWith('mcp__');

/** `loop.pausa {negado}`: só se o diário estiver são; qualquer falha é silenciosa (a decisão já saiu). */
function registrarPausa(entrada: EntradaHook, raiz: string | null): void {
  try {
    const sessao = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null;
    if (raiz === null || sessao === null) return;
    const guarda = lerGuarda(raiz);
    if (!guarda.onboarding) return;
    const dir = dirEntrega(raiz, idDaEntrega(linhaDe(git(raiz, ['symbolic-ref', '--short', 'HEAD'])), guarda.idPadrao));
    if (!diarioGravavel(dir)) return;
    const autor = linhaDe(git(raiz, ['config', 'user.email'])) ?? 'desconhecido';
    append(dir, sessao, {
      ts: new Date().toISOString(),
      autor,
      sessao,
      agente: ehSubagent(entrada) ? `subagent:${entrada.agent_id}` : 'orquestrador',
      tipo: 'loop.pausa',
      dados: { negado: entrada.tool_name.slice(0, 128) },
    });
  } catch { /* diário doente: a decisão já saiu */ }
}

function principal(): void {
  let bruto = '';
  try {
    bruto = readFileSync(0, 'utf8');
  } catch (e) {
    return aviso(`stdin ilegível (${e instanceof Error ? e.message : String(e)})`);
  }
  if (bruto.trim() === '') return aviso('stdin vazio');

  let payload: unknown;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return aviso('payload não é JSON');
  }
  const entrada = objeto(payload) as EntradaHook | null;
  if (entrada === null) return aviso('payload não é um objeto');
  if (typeof entrada.tool_name !== 'string' || objeto(entrada.tool_input) === null) return aviso('payload sem tool_name ou tool_input');
  if (entrada.tool_name === 'Bash' && typeof entrada.tool_input.command !== 'string') return aviso('Bash sem command em texto');
  atual = entrada;

  const cwd = typeof entrada.cwd === 'string' && entrada.cwd !== '' ? entrada.cwd : process.cwd();
  const raizCwd = raizPorFs(cwd);
  // Q14: a config e o diário vêm da raiz da sessão (CLAUDE_PROJECT_DIR), nunca de um cwd que o agente mudou.
  const raizSessao = raizPorFs(process.env.CLAUDE_PROJECT_DIR) ?? raizCwd;
  if (raizSessao === null) process.stderr.write('gabarito-mestre: cwd fora de um repositório git; só os anéis de segredo e integridade valem\n');

  // Kill switch: antes de classificar; só `lstat`, sem config, remoto nem diário (o deny não depende deles).
  const pausa = raizesDePausa(raizSessao, raizCwd);
  if (negaPorPausa(entrada) && pausado(pausa)) {
    emitir(Buffer.from(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: MSG_PAUSA } })}\n`));
    registrarPausa(entrada, raizSessao);
    return;
  }
  if (!classificavel(entrada.tool_name)) {
    jaEscreveu = true; // decisão final: silêncio
    return;
  }

  const guarda = raizSessao === null ? null : lerGuarda(raizSessao);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const contexto = montarContexto(entrada, raizCwd ?? raizSessao, cwd, pluginRoot, pausa.raizes);
  const r = decidir(entrada, guarda?.config ?? null, contexto);

  const sessao = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null;
  const mensagens: string[] = [];
  if (r.systemMessage) mensagens.push(r.systemMessage);

  if (guarda !== null && (guarda.localIgnorada || (guarda.config !== null && (guarda.fonte === 'local' || guarda.divergente))) && primeiraVez(sessao)) {
    mensagens.push(
      guarda.localIgnorada
        ? 'GABARITO: a árvore local declara `guarda`, mas origin/HEAD não tem essa seção; vale origin/HEAD: só os anéis de segredo e integridade até o merge'
        : guarda.divergente
          ? 'GABARITO: a config da guarda na árvore local diverge de origin/HEAD; vale a de origin/HEAD'
          : 'GABARITO: sem origin/HEAD com harness.config.json; config da guarda lida da árvore local e `permitidos` ignorado',
    );
  }

  // Diário: só em repo com onboarding (Q20), só com evento, nunca com o comando.
  const evento = r.evento;
  let gravar: (() => void) | null = null;
  if (evento !== null && raizSessao !== null && guarda?.onboarding) {
    if (sessao === null) {
      mensagens.push('GABARITO: session_id ausente ou fora do padrão; a guarda segue sem registrar no diário');
    } else {
      const branch = contexto.branchAtual ?? linhaDe(git(raizSessao, ['symbolic-ref', '--short', 'HEAD']));
      const dir = dirEntrega(raizSessao, idDaEntrega(branch, guarda.idPadrao));
      if (!diarioGravavel(dir)) {
        mensagens.push('GABARITO: diário indisponível; a guarda segue sem registrar este evento');
      } else {
        const sub = typeof entrada.agent_id === 'string' && entrada.agent_id !== '';
        const agente = sub ? `subagent:${entrada.agent_id}` : 'orquestrador';
        gravar = () => {
          const autor = linhaDe(git(raizSessao, ['config', 'user.email'])) ?? 'desconhecido';
          const res = append(dir, sessao, { ts: new Date().toISOString(), autor, sessao, agente, tipo: evento.tipo as TipoEvento, dados: evento.dados });
          if (!res.ok) process.stderr.write(`gabarito-mestre: diário não gravou o evento (${res.erro})\n`);
        };
      }
    }
  }

  const saida = saidaDe({ ...r, systemMessage: null }, mensagens);
  if (saida !== null) emitir(saida);
  else jaEscreveu = true; // decisão final: silêncio

  if (gravar) {
    try {
      gravar();
    } catch (e) {
      process.stderr.write(`gabarito-mestre: diário falhou (${e instanceof Error ? e.message : String(e)})\n`);
    }
  }
}

function ehEntrypoint(): boolean {
  try {
    return typeof process.argv[1] === 'string' && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (ehEntrypoint()) {
  try {
    principal();
  } catch (e) {
    if (atual === null) aviso(`erro inesperado antes de ler o envelope (${e instanceof Error ? e.message : String(e)})`);
    else pedirPorExcecao(e);
  }
  process.exitCode = 0;
}

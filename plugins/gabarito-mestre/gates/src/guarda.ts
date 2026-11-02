/**
 * Hook único da guarda (REQ-GRD-3): `PreToolUse` → stdin JSON → decisão por faixa → stdout. Sempre exit 0.
 *
 * Fluxo: stdin → JSON → raiz por fs → config de origin/HEAD (só com raiz) → contexto (só se `precisaContexto`)
 * → `decidir` → stdout → diário. A decisão sai ANTES do `append` (que pode esperar até 3 s por lock): o
 * `timeout: 5` do hook nunca derruba um `ask`/`deny` já decidido.
 *
 * Nunca devolve `allow` (D1). Payload ilegível não é decidível: aviso em stderr e exit 0 (fail-open declarado,
 * G9). Exceção em `decidir` NÃO é fail-open total: segredo e integridade seguem pedindo (visão §6.1).
 * Nenhuma variável de ambiente muda o veredito: não existe escape hatch.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
type Guarda = { config: ConfigGuarda | null; fonte: Fonte; divergente: boolean; onboarding: boolean; idPadrao: string };

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
    const divergente = local !== null && normalizar(local, 'local').assinatura !== o.assinatura;
    return { config: o.config, fonte: 'origin', divergente, onboarding: true, idPadrao: o.idPadrao };
  }
  if (local !== null) {
    const l = normalizar(local, 'local');
    return { config: l.config, fonte: 'local', divergente: false, onboarding: true, idPadrao: l.idPadrao };
  }
  return { config: null, fonte: 'nenhuma', divergente: false, onboarding: false, idPadrao: ID_PADRAO };
}

function linhaDe(texto: string | null): string | null {
  const t = texto?.trim() ?? '';
  return t === '' ? null : t.split('\n')[0];
}

function montarContexto(entrada: EntradaHook, raiz: string | null, cwd: string, pluginRoot: string | null): Contexto {
  const nulos: Contexto = { branchAtual: null, refLinkado: null, remoteUrl: null, raiz, pluginRoot };
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
// exceção da decisão

const SENSIVEL = /(^|[/\s'"=<>:])\.env(?![.\w-]*example)|\.pem\b|\.key\b|\.aws\/|\.config\/gh\b|\.harness\b|harness\.config\.json|\.claude\/settings|\.github\/workflows|\.git(\/|\b)|gabarito-gates|CLAUDE_PLUGIN_ROOT|\bgit\b[^;&|]*\b(remote|fetch|pull|update-ref|symbolic-ref|config)\b/i;

type Saida = { permissionDecision?: 'ask' | 'deny'; motivo: string | null; systemMessage: string | null; decisao: Decisao | null };

/**
 * `decidir` não deve lançar (robustez-guarda.test.ts), mas se lançar a visão §6.1 manda fail-closed em segredo e
 * integridade: sem classificação confiável, qualquer chamada que MENCIONE um desses caminhos ou comandos pede
 * (`deny` para subagent). O resto segue sem decisão, com aviso.
 */
export function decidirSeguro(entrada: EntradaHook, config: ConfigGuarda | null, contexto: Contexto, decidirFn: typeof decidir = decidir): Saida {
  try {
    const d = decidirFn(entrada, config, contexto);
    return { permissionDecision: d.permissionDecision, motivo: d.motivo, systemMessage: d.systemMessage, decisao: d };
  } catch (e) {
    return falhaSegura(entrada, e);
  }
}

/** Resultado quando a classificação não pôde ser feita: pede se a chamada menciona segredo ou integridade. */
export function falhaSegura(entrada: EntradaHook, e: unknown): Saida {
  process.stderr.write(`gabarito-mestre: guarda falhou ao classificar (${e instanceof Error ? e.message : String(e)})\n`);
  let texto = '';
  try { texto = JSON.stringify(entrada?.tool_input ?? null) ?? ''; } catch { /* nada */ }
  if (SENSIVEL.test(texto)) {
    const sub = typeof entrada?.agent_id === 'string' && entrada.agent_id !== '';
    return sub
      ? { permissionDecision: 'deny', motivo: 'a guarda não conseguiu classificar esta chamada e ela menciona segredo ou integridade do harness: só o orquestrador pode pedir', systemMessage: null, decisao: null }
      : { permissionDecision: 'ask', motivo: 'a guarda não conseguiu classificar esta chamada e ela menciona segredo ou integridade do harness: confirme com o humano', systemMessage: null, decisao: null };
  }
  return { motivo: null, systemMessage: 'GABARITO: a guarda falhou ao classificar esta chamada; segredo e integridade não foram verificados', decisao: null };
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

function escrever(saida: Record<string, unknown> | null): void {
  if (saida === null) return;
  try {
    writeSync(1, `${JSON.stringify(saida)}\n`);
  } catch (e) {
    process.stderr.write(`gabarito-mestre: não consegui escrever a decisão (${e instanceof Error ? e.message : String(e)})\n`);
  }
}

function aviso(msg: string): void {
  process.stderr.write(`gabarito-mestre: ${msg} (guarda sem decisão, fail-open declarado)\n`);
}

// ---------------------------------------------------------------------------------------------------------------

// Estado para o último recurso: se algo lançar depois de a entrada ser lida, a decisão ainda sai.
let atual: EntradaHook | null = null;
let decisaoCalculada: Saida | null = null;
let jaEscreveu = false;

function saidaDe(r: Saida, extras: string[]): Record<string, unknown> | null {
  const saida: Record<string, unknown> = {};
  if (r.permissionDecision === 'ask' || r.permissionDecision === 'deny') {
    saida.hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: r.permissionDecision, permissionDecisionReason: r.motivo ?? 'a guarda pede confirmação' };
  }
  const msgs = r.systemMessage ? [r.systemMessage, ...extras] : extras;
  if (msgs.length > 0) saida.systemMessage = msgs.join(' · ');
  return Object.keys(saida).length > 0 ? saida : null;
}

/**
 * Último recurso (algo lançou depois de a entrada ser lida): o que já estava decidido sai; se nem a decisão existia,
 * vale o fallback de segredo e integridade. `null` = nada a escrever (já escreveu, ou nem havia entrada).
 */
export function saidaDeFalha(e: unknown, entrada: EntradaHook | null, calculada: Saida | null, jaEscreveu: boolean): Record<string, unknown> | null {
  if (jaEscreveu || entrada === null) return null;
  return saidaDe(calculada ?? falhaSegura(entrada, e), []);
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

  const guarda = raizSessao === null ? null : lerGuarda(raizSessao);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const contexto = montarContexto(entrada, raizCwd ?? raizSessao, cwd, pluginRoot);
  const r = decidirSeguro(entrada, guarda?.config ?? null, contexto);
  decisaoCalculada = r;

  const sessao = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null;
  const mensagens: string[] = [];
  if (r.systemMessage) mensagens.push(r.systemMessage);

  if (guarda !== null && guarda.config !== null && (guarda.fonte === 'local' || guarda.divergente) && primeiraVez(sessao)) {
    mensagens.push(
      guarda.divergente
        ? 'GABARITO: a config da guarda na árvore local diverge de origin/HEAD; vale a de origin/HEAD'
        : 'GABARITO: sem origin/HEAD com harness.config.json; config da guarda lida da árvore local e `permitidos` ignorado',
    );
  }

  // Diário: só em repo com onboarding (Q20), só com evento, nunca com o comando.
  const evento = r.decisao?.evento ?? null;
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

  jaEscreveu = true;
  escrever(saidaDe({ ...r, systemMessage: null }, mensagens));

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
    aviso(`erro inesperado (${e instanceof Error ? e.message : String(e)})`);
    // O que já estava decidido sai; se nem a decisão existia, vale o fallback de segredo e integridade.
    escrever(saidaDeFalha(e, atual, decisaoCalculada, jaEscreveu));
  }
  process.exitCode = 0;
}

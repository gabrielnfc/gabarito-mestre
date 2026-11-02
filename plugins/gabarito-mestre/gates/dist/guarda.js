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
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precisaContexto } from './classificar-alvo.js';
import { decidir } from './decidir.js';
import { append, dirEntrega } from './diario.js';
                                                                                                         

const GIT_TIMEOUT_MS = 2000;
const CONFIG_MAX = 1 << 20;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ID_PADRAO = '[A-Z]+-\\d+';
const CHAVES_AMBIENTE                            = ['hosts', 'projetos', 'bancos', 'mcps', 'variaveis', 'branches'];

                                            
                                                                                                                        

// ---------------------------------------------------------------------------------------------------------------
// fs e git

/** Raiz do repo por fs (sem spawn): sobe até achar `.git` (diretório, ou arquivo de worktree). */
export function raizPorFs(inicio         )                {
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

function git(cwd        , args          )                {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: CONFIG_MAX, stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

const lista = (v         )                       => (Array.isArray(v) ? v.filter((x)              => typeof x === 'string') : undefined);
const objeto = (v         )                                 => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v                           ) : null);

function parseJson(texto               )                                 {
  if (texto === null) return null;
  try {
    return objeto(JSON.parse(texto));
  } catch {
    return null;
  }
}

function lerLocal(raiz        )                {
  try {
    const arq = join(raiz, 'harness.config.json');
    return statSync(arq).size <= CONFIG_MAX ? readFileSync(arq, 'utf8') : null;
  } catch {
    return null;
  }
}

/** Recorte que vale para a guarda: `guarda.*`, `versionamento.branchPadrao`, `fluxo.idPadrao`. */
function normalizar(raw                         , fonte                    )                                                                        {
  const guarda = objeto(raw.guarda);
  const branchPadrao = objeto(raw.versionamento)?.branchPadrao;
  const idPadrao = objeto(raw.fluxo)?.idPadrao;
  const assinatura = JSON.stringify({ g: guarda, b: branchPadrao ?? null });
  const idOk = typeof idPadrao === 'string' && idPadrao.length <= 200 ? idPadrao : ID_PADRAO;
  const amb = objeto(guarda?.ambientes);
  if (amb === null) return { config: null, idPadrao: idOk, assinatura };

  const ambientes                            = {};
  for (const nome of ['teste', 'homolog', 'prod']         ) {
    const decl = objeto(amb[nome]);
    if (decl === null) continue;
    const e               = {};
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
function lerGuarda(raiz        )         {
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

function linhaDe(texto               )                {
  const t = texto?.trim() ?? '';
  return t === '' ? null : t.split('\n')[0];
}

function montarContexto(entrada             , raiz               , cwd        , pluginRoot               )           {
  const nulos           = { branchAtual: null, refLinkado: null, remoteUrl: null, raiz, pluginRoot };
  if (!precisaContexto(entrada)) return nulos;
  const base = raiz ?? cwd;
  let refLinkado                = null;
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
function primeiraVez(sessao               )          {
  if (sessao === null) return true;
  try {
    closeSync(openSync(join(tmpdir(), `gm-guarda-${sessao}`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600));
    return true;
  } catch (e) {
    return (e                         ).code !== 'EEXIST';
  }
}

function idDaEntrega(branch               , idPadrao        )                {
  if (branch === null) return null;
  try {
    const m = new RegExp(idPadrao).exec(branch);
    return m ? (m[1] ?? m[0]) : null;
  } catch {
    return /[A-Z]+-\d+/.exec(branch)?.[0] ?? null;
  }
}

/** Diretório do diário gravável? Checado ANTES de escrever a decisão, para o aviso entrar na mesma saída. */
function diarioGravavel(dir        )          {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function aviso(msg        )       {
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
let atual                     = null;
let pendente                = null;
let escritos = 0;
let jaEscreveu = false;

const ehSubagent = (entrada                    )          => typeof entrada?.agent_id === 'string' && entrada.agent_id !== '';

/** Escreve o buffer inteiro (writeSync pode escrever menos). `jaEscreveu` só vira `true` depois de o último byte sair. */
function emitir(buf        )       {
  pendente = buf;
  for (let tentativas = 0; escritos < buf.length; ) {
    try {
      escritos += writeSync(1, buf, escritos);
    } catch (e) {
      if ((e                         ).code !== 'EAGAIN' || ++tentativas >= TENTATIVAS_ESCRITA) throw e;
    }
  }
  jaEscreveu = true;
}

function saidaDe(r         , extras          )                {
  const saida                          = {};
  if (r.permissionDecision === 'ask' || r.permissionDecision === 'deny') {
    saida.hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: r.permissionDecision, permissionDecisionReason: r.motivo ?? 'a guarda pede confirmação' };
  }
  const msgs = r.systemMessage ? [r.systemMessage, ...extras] : extras;
  if (msgs.length > 0) saida.systemMessage = msgs.join(' · ');
  return Object.keys(saida).length > 0 ? Buffer.from(`${JSON.stringify(saida)}\n`) : null;
}

/** Mensagem do erro sem o que veio da entrada (comando, caminho, URL com credencial): vai ao stderr e ao diário. */
function limparErro(e         , entrada                    )         {
  let t = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const folhas           = [];
  const colher = (v         , nivel        )       => {
    if (typeof v === 'string') { if (v.length >= 3) folhas.push(v); } else if (nivel < 4 && v !== null && typeof v === 'object') for (const x of Object.values(v)) colher(x, nivel + 1);
  };
  colher(entrada?.tool_input, 0);
  for (const f of folhas.sort((a, b) => b.length - a.length)) t = t.split(f).join('[entrada]');
  return t.replace(/\s+/g, ' ').slice(0, 160);
}

/** Q21: evento `guarda.ask|deny` com `motivo: "excecao"`, só se o diário estiver são; qualquer falha aqui é silenciosa. */
function registrarExcecao(entrada             , erro        )       {
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
function pedirPorExcecao(e         )       {
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

function principal()       {
  let bruto = '';
  try {
    bruto = readFileSync(0, 'utf8');
  } catch (e) {
    return aviso(`stdin ilegível (${e instanceof Error ? e.message : String(e)})`);
  }
  if (bruto.trim() === '') return aviso('stdin vazio');

  let payload         ;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return aviso('payload não é JSON');
  }
  const entrada = objeto(payload)                      ;
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
  const r = decidir(entrada, guarda?.config ?? null, contexto);

  const sessao = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null;
  const mensagens           = [];
  if (r.systemMessage) mensagens.push(r.systemMessage);

  if (guarda !== null && guarda.config !== null && (guarda.fonte === 'local' || guarda.divergente) && primeiraVez(sessao)) {
    mensagens.push(
      guarda.divergente
        ? 'GABARITO: a config da guarda na árvore local diverge de origin/HEAD; vale a de origin/HEAD'
        : 'GABARITO: sem origin/HEAD com harness.config.json; config da guarda lida da árvore local e `permitidos` ignorado',
    );
  }

  // Diário: só em repo com onboarding (Q20), só com evento, nunca com o comando.
  const evento = r.evento;
  let gravar                      = null;
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
          const res = append(dir, sessao, { ts: new Date().toISOString(), autor, sessao, agente, tipo: evento.tipo              , dados: evento.dados });
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

function ehEntrypoint()          {
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

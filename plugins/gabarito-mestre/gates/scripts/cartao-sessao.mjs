#!/usr/bin/env node
/**
 * ORQ-3 — cartão de sessão.
 *
 * Camada 1 de contexto: o que o orquestrador precisa saber ao abrir a sessão, em ≤ 40 linhas —
 * modelo resolvido e validade, branch/PBI/Epic/Iniciativa (cache offline ORQ-6 ou arquivo),
 * PBIs em voo, worktrees vivos, slots medidos (PAR-1), nível do doctor em cache (DOC-2, 24 h),
 * PBIs envelhecidos (FLX-8), ponteiro LER PRIMEIRO do ledger, versão instalada × plugin e
 * presença do superpowers (c). NUNCA inventa: PBI só quando a branch casa idPadrao; o resto
 * vem marcado (b). Sem `fluxo.resolvidoEm`: uma linha, fail-open declarado (G9). Sempre sai 0 —
 * cartão que derruba a sessão é pior que cartão ausente.
 *
 * USO
 *   node cartao-sessao.mjs                                                       # texto do cartão
 *   node cartao-sessao.mjs --root <dir> --plugin-root <dir> --json --agora <ISO> # teste
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { medir, calcularSlots } from './capacidade.mjs';

export const MAX_LINHAS = 40;
export const CACHE_DOCTOR_H = 24;
export const DOCTOR_TIMEOUT_MS = 20_000; // o hook tem 30 s
export const LINHA_SEM_ONBOARDING = 'GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)';
export const LINHA_INDISPONIVEL = 'GABARITO: cartão indisponível — fail-open declarado (G9)';
export const DEFAULTS = {
  fluxo: { ferramenta: 'arquivos', idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3 },
  versionamento: { tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'] },
  orquestracao: { modelo: { politica: 'mais-potente', alias: '', resolvidoEm: '', validadeDias: 90 } },
};

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** null = ausente · undefined = JSON inválido (quem chama decide o que fazer com cada um). */
const lerJson = (f) => {
  if (!existsSync(f)) return null;
  try {
    const t = readFileSync(f, 'utf8');
    return t.trim() === '' ? {} : JSON.parse(t);
  } catch {
    return undefined;
  }
};
const dias = (agora, iso) => {
  const d = (agora - Date.parse(iso)) / 86_400_000;
  return Number.isNaN(d) ? null : d;
};
/** "AAAA-MM-DD HH:MM" no fuso LOCAL da máquina (F2-R10) — nunca `toISOString()` (UTC), que
 * cruza o dia perto da meia-noite local. */
const dataHoraLocal = (ms) => {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export function resolverRaiz(cwd = process.cwd()) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd) || cwd;
  } catch {
    return cwd;
  }
}

// ────────────────────────────────────────────────────────────── puras

export function inferirPbi(branch, cfg = DEFAULTS) {
  const idRe = new RegExp(cfg?.fluxo?.idPadrao ?? DEFAULTS.fluxo.idPadrao);
  const tipos = cfg?.versionamento?.tiposComEscopoDePbi ?? DEFAULTS.versionamento.tiposComEscopoDePbi;
  const b = String(branch ?? '');
  const wt = /^wt\/(.+)-(\d+)$/.exec(b);
  if (wt && idRe.test(wt[1])) return { pbi: wt[1], n: Number(wt[2]) };
  const m = /^([a-z]+)\/([A-Za-z]+-\d+)(?:-|$)/.exec(b);
  if (m && tipos.includes(m[1]) && idRe.test(m[2])) return { pbi: m[2], n: null };
  return null;
}

/** Frontmatter YAML de uma chave por linha (`chave: valor`), sem aninhamento — é o que os templates de card usam. */
export function lerFrontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(texto ?? ''));
  const out = {};
  if (!m) return out;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(l);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Estado de MOVIMENTO → chave de `fluxo.status.FL2`. A grafia canônica (plano-mestre, "Ledger") é a chave
 * (`em_execucao`); um ledger escrito à mão com o nome de coluna (`Em execução`, `Concluído`) é normalizado, não rejeitado:
 * trim + minúsculas + diacríticos removidos (NFD, faixa U+0300–U+036F) + espaço→`_`. `Concluído` → `concluido`.
 */
export function normalizarEstado(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

/** Linhas que os scripts leem no ledger (contrato): MOVIMENTO · BLOQUEADA · DISPATCH · ## LER PRIMEIRO. */
export function lerLedger(texto) {
  const datas = [];
  const avisos = [];
  let epicEstado = null;
  let dispatches = 0;
  let semSlots = 0;
  let linhaLerPrimeiro = null;
  String(texto ?? '').split(/\r?\n/).forEach((l, i) => {
    let m;
    // Tolerante: `<de>`/`<para>` podem ter espaço (`Em execução`); normalizarEstado devolve a chave.
    if ((m = /^MOVIMENTO FL2 (\S+) (.+?)→(.+?) (\d{4}-\d{2}-\d{2})\s*$/.exec(l))) {
      datas.push(m[4]);
      epicEstado = { epic: m[1], para: normalizarEstado(m[3]) };
    } else if ((m = /^BLOQUEADA (\d{4}-\d{2}-\d{2})(.*)$/.exec(l))) {
      datas.push(m[1]);
      if (!/dono:\s*\S/.test(m[2])) avisos.push(`BLOQUEADA sem dono (l.${i + 1})`);
    } else if ((m = /^DISPATCH Task \S+(.*)$/.exec(l))) {
      dispatches += 1;
      if (!/\bslots=\d+/.test(m[1])) semSlots += 1;
    } else if (/^## LER PRIMEIRO/.test(l) && linhaLerPrimeiro === null) {
      linhaLerPrimeiro = i + 1;
    }
  });
  if (semSlots) avisos.push(`${semSlots} dispatch sem medição (slots=)`);
  return { ultimaData: datas.sort().at(-1) ?? null, epicEstado, avisos, dispatches, linhaLerPrimeiro };
}

// ────────────────────────────────────────────────────────────── coleta

function contarWorktrees(root) {
  try {
    return Math.max(0, git(['worktree', 'list', '--porcelain'], root).split('\n').filter((l) => l.startsWith('worktree ')).length - 1);
  } catch {
    return null;
  }
}

function estadoSuperpowers(arquivo) {
  const j = lerJson(arquivo);
  if (!j || typeof j !== 'object' || !j.plugins || typeof j.plugins !== 'object') return 'desconhecido';
  return Object.keys(j.plugins).some((k) => k.startsWith('superpowers@')) ? 'presente (c)' : 'ausente (c)';
}

/** Cache do doctor (DOC-2). Ausente ou > 24 h → roda o doctor DO PLUGIN com --cache, dentro do timeout do hook. */
function doctorEmCache(root, pluginRoot, agora) {
  const f = join(root, '.harness', 'doctor-cache.json');
  const ler = () => {
    const c = lerJson(f);
    return c && typeof c === 'object' && c.em ? c : null;
  };
  let c = ler();
  const idadeH = c ? (agora - Date.parse(c.em)) / 3_600_000 : null;
  if (c && idadeH !== null && idadeH >= 0 && idadeH <= CACHE_DOCTOR_H) {
    return { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: `cache ${Math.round(idadeH)} h` };
  }
  const script = join(pluginRoot, 'gates', 'scripts', 'harness-doctor.mjs');
  const indisponivel = { nivel: null, declarado: null, em: null, fonte: 'indisponível' };
  if (!existsSync(script)) return c ? { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: 'cache vencido (doctor do plugin não encontrado)' } : indisponivel;
  const emAntes = c?.em ?? null; // I1: só chamamos de "recalculado agora" se o `em` do cache realmente mudou.
  try {
    // realpath: o guarda de entrypoint do doctor agora já compara com realpath (T9b) — este realpathSync
    // aqui é redundante para o doctor, mas inofensivo, e continua útil caso `script` chegue por um symlink
    // que o próprio doctor não veria (ex.: pluginRoot resolvido a partir de um caminho symlinkado).
    execFileSync(process.execPath, [realpathSync(script), '--json', '--cache'], { cwd: root, stdio: 'ignore', timeout: DOCTOR_TIMEOUT_MS });
  } catch {
    /* exit 1 = repo mente; o cache foi gravado antes do exit. Timeout ou crash: cai no `ler()` abaixo —
       e como o doctor quebrado (crash/timeout) NUNCA chega a gravar, `em` continua o de antes (ver abaixo). */
  }
  c = ler();
  if (!c) return indisponivel; // não havia cache e o doctor não gravou nada: nada a mostrar.
  if (c.em === emAntes) {
    // I1: o `em` não mudou — o doctor falhou (crash/timeout) sem regravar. G9: validação
    // indisponível nunca vale como "recalculado agora"; mantém o nível velho, rotulado como vencido.
    return { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: 'cache vencido (doctor falhou)' };
  }
  return { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: 'recalculado agora' };
}

export function coletar(cwd, pluginRoot, opts = {}) {
  const agora = opts.agora ? Date.parse(opts.agora) : Date.now();
  const root = resolverRaiz(cwd);
  const raw = lerJson(join(root, 'harness.config.json'));
  const base = { agora, root, semOnboarding: false, configInvalido: raw === undefined };
  const fluxoOk = raw && typeof raw === 'object' && raw.fluxo && typeof raw.fluxo === 'object' && typeof raw.fluxo.resolvidoEm === 'string' && raw.fluxo.resolvidoEm;
  if (!fluxoOk) return { ...base, semOnboarding: true };

  const config = {
    fluxo: { ...DEFAULTS.fluxo, ...raw.fluxo },
    versionamento: { ...DEFAULTS.versionamento, ...(raw.versionamento ?? {}) },
    orquestracao: { ...DEFAULTS.orquestracao, ...(raw.orquestracao ?? {}), modelo: { ...DEFAULTS.orquestracao.modelo, ...(raw.orquestracao?.modelo ?? {}) } },
  };
  // O cartão diz quando está operando com defaults (mesma frase que capacidade.mjs põe no stderr).
  const orquestracaoAusente = !(raw.orquestracao && typeof raw.orquestracao === 'object');
  const idRe = new RegExp(config.fluxo.idPadrao);

  let branch;
  let sha;
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    sha = git(['rev-parse', '--short=7', 'HEAD'], root);
  } catch {
    branch = '(sem git)';
    sha = '-------';
  }
  const inf = inferirPbi(branch, config);

  const cacheLido = lerJson(join(root, '.harness', 'fluxo-cache.json'));
  const cache = cacheLido && typeof cacheLido === 'object' ? cacheLido : {};
  let epic = null;
  let iniciativa = null;
  let fonteVinculo = null;
  if (inf) {
    const c = cache[inf.pbi];
    if (c && c.epic) {
      epic = c.epic;
      iniciativa = c.iniciativa ?? config.fluxo.iniciativa?.id ?? null;
      fonteVinculo = `cache ${c.em ?? '?'}`;
    } else if (config.fluxo.ferramenta === 'arquivos') {
      const card = join(root, 'docs', 'fluxo', 'pbis', `${inf.pbi}.md`);
      if (existsSync(card)) {
        const fm = lerFrontmatter(readFileSync(card, 'utf8'));
        if (fm.epic) {
          epic = fm.epic;
          // Iniciativa: frontmatter do PBI (override, D4) → `iniciativa:` do Epic em docs/fluxo/epics/<epic>.md → config.
          let doEpic = null;
          const cardEpic = join(root, 'docs', 'fluxo', 'epics', `${fm.epic}.md`);
          if (existsSync(cardEpic)) doEpic = lerFrontmatter(readFileSync(cardEpic, 'utf8')).iniciativa || null;
          iniciativa = fm.iniciativa ?? doEpic ?? config.fluxo.iniciativa?.id ?? null;
          fonteVinculo = 'arquivo';
        }
      }
    }
    if (!epic) fonteVinculo = `(b) não resolvido — gabarito-instalar --vincular ${inf.pbi}`;
  }

  const lerLedgerDe = (pbi) => {
    const rel = join(config.fluxo.ledgerDir, `${pbi}.md`);
    const f = join(root, rel);
    return existsSync(f) ? { caminho: rel, ...lerLedger(readFileSync(f, 'utf8')) } : null;
  };
  const ledger = inf ? lerLedgerDe(inf.pbi) : null;

  const emVoo = Object.keys(cache).filter((k) => idRe.test(k));
  const envelhecidos = [];
  for (const pbi of emVoo) {
    const l = lerLedgerDe(pbi);
    const ref = l?.ultimaData ?? cache[pbi]?.em;
    const d = ref ? dias(agora, ref) : null;
    if (d !== null && d > Number(config.fluxo.envelhecimentoDias)) envelhecidos.push({ pbi, dias: Math.floor(d) });
  }

  const medidas = medir(process.env, root);
  const capacidade = calcularSlots(raw.orquestracao?.paralelismo, medidas, process.env);
  const doctor = doctorEmCache(root, pluginRoot, agora);
  const instalada = lerJson(join(root, 'tools', 'gabarito-gates', 'package.json'))?.version ?? null;
  const plugin = lerJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))?.version ?? null;
  const installed = opts.installedPlugins ?? process.env.GABARITO_INSTALLED_PLUGINS ?? join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

  return {
    ...base,
    config,
    orquestracaoAusente,
    branch,
    sha,
    pbi: inf?.pbi ?? null,
    n: inf?.n ?? null,
    epic,
    iniciativa,
    fonteVinculo,
    epicEstado: ledger?.epicEstado ?? null,
    avisosLedger: ledger?.avisos ?? [],
    emVoo: emVoo.length,
    worktrees: contarWorktrees(root),
    capacidade,
    doctor,
    envelhecidos,
    ledger: ledger ? { caminho: ledger.caminho, linhaLerPrimeiro: ledger.linhaLerPrimeiro } : null,
    versoes: { instalada, plugin },
    superpowers: estadoSuperpowers(installed),
  };
}

// ────────────────────────────────────────────────────────────── cartão

export function montarCartao(ctx) {
  if (!ctx || ctx.semOnboarding) return [LINHA_SEM_ONBOARDING];
  const L = [];
  L.push(`GABARITO · cartão de sessão · ${dataHoraLocal(ctx.agora)}`);

  const m = ctx.config.orquestracao.modelo;
  if (m.resolvidoEm) {
    const d = dias(ctx.agora, m.resolvidoEm);
    const restantes = d === null ? null : Math.floor(Number(m.validadeDias ?? 90) - d);
    const estado = restantes !== null && restantes >= 0 ? `${restantes} d restantes` : 'VENCIDO — revalide com gabarito-instalar';
    L.push(`Modelo: ${m.politica} · alias ${m.alias || '?'} · resolvido ${m.resolvidoEm} (${estado})`);
  } else {
    L.push('Modelo: (b) não resolvido — gabarito-instalar (fase 4)');
  }

  L.push(`Branch: ${ctx.branch} @ ${ctx.sha}`);

  if (ctx.pbi) {
    const idx = ctx.n !== null && ctx.n !== undefined ? ` (worktree ${ctx.n})` : '';
    if (ctx.epic) {
      const estado = ctx.epicEstado ? ` · estado ${ctx.epicEstado.para}` : '';
      L.push(`PBI: ${ctx.pbi}${idx} · Epic: ${ctx.epic}${estado} · Iniciativa: ${ctx.iniciativa ?? '(b) não resolvida'} (fonte: ${ctx.fonteVinculo})`);
    } else {
      L.push(`PBI: ${ctx.pbi}${idx} · Epic: ${ctx.fonteVinculo}`);
    }
  } else {
    L.push('PBI: (b) não inferido — branch fora de branchPadrao/branchWorktree');
  }

  L.push(`Em voo: ${ctx.emVoo} PBI · worktrees vivos: ${ctx.worktrees ?? '?'} · slots: ${ctx.capacidade.slots} (${ctx.capacidade.motivo})`);

  const dr = ctx.doctor;
  L.push(dr.nivel === null || dr.nivel === undefined ? `Doctor: ${dr.fonte}` : `Doctor: nível ${dr.nivel} medido · declarado ${dr.declarado ?? '(não declarado)'} (${dr.fonte})`);

  const env = ctx.envelhecidos ?? [];
  L.push(env.length ? `Envelhecidos: ${env.slice(0, 8).map((e) => `${e.pbi} ${e.dias}d`).join(', ')}${env.length > 8 ? ` +${env.length - 8}` : ''}` : 'Envelhecidos: —');

  L.push(ctx.ledger ? `Ledger: ${ctx.ledger.caminho}${ctx.ledger.linhaLerPrimeiro ? ` — LER PRIMEIRO l.${ctx.ledger.linhaLerPrimeiro}` : ''}` : 'Ledger: sem ledger');

  const { instalada, plugin } = ctx.versoes;
  L.push(`Harness: instalado ${instalada ?? '?'} · plugin ${plugin ?? '?'}${instalada && plugin && instalada !== plugin ? ' · rode instalar.sh --atualizar' : ''}`);
  L.push(`Plugins: superpowers ${ctx.superpowers}`);

  // Sem `orquestracao` na config o cartão não fica mudo: diz que está em defaults (mesma frase de capacidade.mjs).
  if (ctx.orquestracaoAusente) L.push('Config: defaults (orquestracao ausente) — gabarito-instalar (fase 4)');

  if (ctx.avisosLedger?.length) L.push(`Avisos: ${ctx.avisosLedger.slice(0, 3).join(' · ')}${ctx.avisosLedger.length > 3 ? ` +${ctx.avisosLedger.length - 3}` : ''}`);

  L.push('R21: despache, não implemente. Velocidade nunca compra concorrência.');
  return L.slice(0, MAX_LINHAS);
}

function main(argv) {
  const arg = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const pluginRoot = arg('plugin-root') ? resolve(arg('plugin-root')) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let ctx;
  let linhas;
  try {
    ctx = coletar(arg('root') ? resolve(arg('root')) : process.cwd(), pluginRoot, { agora: arg('agora') });
    if (ctx.configInvalido) console.error('[ORQ-3] harness.config.json inválido — cartão mínimo (fail-open declarado (G9))');
    linhas = montarCartao(ctx);
  } catch (e) {
    console.error(`[ORQ-3] cartão indisponível: ${String(e?.message ?? e).split('\n')[0]} (fail-open declarado (G9))`);
    ctx = { erro: true };
    linhas = [LINHA_INDISPONIVEL];
  }
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ linhas, ctx }, null, 2)}\n`);
  else process.stdout.write(`${linhas.join('\n')}\n`);
  process.exit(0);
}

// Entrypoint robusto a espaço/acento e a symlink: `file://` cru falha com %20, e comparar
// contra `resolve(argv[1])` sem realpath falha atrás de qualquer symlink (macOS /var,
// cache de plugin, bin do npm/homebrew) — o script sairia 0 em silêncio nos dois casos.
function ehEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}
if (ehEntrypoint()) main(process.argv.slice(2));

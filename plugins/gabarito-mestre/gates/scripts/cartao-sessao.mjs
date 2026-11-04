#!/usr/bin/env node
/**
 * ORQ-3 — cartão de sessão.
 *
 * Camada 1 de contexto: o que o orquestrador precisa saber ao abrir a sessão, em ≤ 40 linhas de cartão (no hook, mais o instantâneo do diário, ≤ LIMITE_CONTEXTO caracteres = 2k tokens) —
 * modelo resolvido e validade, branch/PBI/Epic/Iniciativa (cache offline ORQ-6 ou arquivo),
 * PBIs em voo, worktrees vivos, slots medidos (PAR-1), nível do doctor em cache (DOC-2, 24 h),
 * PBIs envelhecidos (FLX-8), ponteiro LER PRIMEIRO do ledger, versão instalada × plugin e
 * presença do superpowers (c). NUNCA inventa: PBI só quando a branch casa idPadrao; o resto
 * vem marcado (b). Sem `fluxo.resolvidoEm`: uma linha, fail-open declarado (G9). Sempre sai 0 —
 * cartão que derruba a sessão é pior que cartão ausente.
 *
 * USO
 *   node cartao-sessao.mjs                                                       # texto do cartão
 *   node cartao-sessao.mjs --hook                                                # SessionStart: stdin JSON → duas vias; grava diário e marcador
 *   node cartao-sessao.mjs --root <dir> --plugin-root <dir> --json --agora <ISO> # teste
 */

import { readFileSync, readdirSync, existsSync, realpathSync, lstatSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { lerJson, lerGuarda } from '../lib/config.mjs';
import { git, raizDoRepo, inferirPbi, PADROES } from '../lib/git.mjs';
import { diasEntre } from '../lib/datas.mjs';
import { medir, calcularSlots } from './capacidade.mjs';

export const MAX_LINHAS = 40;
/**
 * Teto do que o hook injeta: cartão + instantâneo SOMADOS. Meta da visão (R28, item 12): contexto fixo ≤ 2.000 tokens
 * por sessão, com instantâneo de 3.200 caracteres (~1,5k tokens). Razão medida no S7: 6.000 caracteres = 2.772 tokens.
 * 4329 = floor(2000 × 6000 / 2772); antes era 6.000 (≈ 2.772 tokens, 39 % acima da meta). Sobram 1.129 para o cartão.
 * O teste `T11 · teto de contexto` recalcula a conta a partir dos números do S7.
 */
export const LIMITE_CONTEXTO = 4329;
export const LIMITE_MENSAGEM_LINHAS = 3;
export const LIMITE_MENSAGEM_LINHA = 160;
export const LINHA_REDIGIDA = '[linha redigida: possível segredo]';
export const CACHE_DOCTOR_H = 24;
export const DOCTOR_TIMEOUT_MS = 20_000; // o hook tem 30 s
export const LINHA_SEM_ONBOARDING = 'GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)';
export const LINHA_INDISPONIVEL = 'GABARITO: cartão indisponível — fail-open declarado (G9)';
export const DEFAULTS = {
  fluxo: { ferramenta: 'arquivos', idPadrao: PADROES.idPadrao, ledgerDir: 'docs/ledgers', envelhecimentoDias: 3 },
  versionamento: { tiposComEscopoDePbi: PADROES.tiposComEscopoDePbi },
  orquestracao: { modelo: { politica: 'mais-potente', alias: '', resolvidoEm: '', validadeDias: 90 } },
};

const dias = (agora, iso) => {
  // `diasEntre` aceita número (ms); aqui só vale data ISO em texto — número vira "inválido" e o modelo, VENCIDO.
  if (typeof iso !== 'string') return null;
  const d = diasEntre(iso, agora);
  return Number.isNaN(d) ? null : d;
};
/** "AAAA-MM-DD HH:MM" no fuso LOCAL da máquina (F2-R10) — nunca `toISOString()` (UTC), que
 * cruza o dia perto da meia-noite local. */
const dataHoraLocal = (ms) => {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export const resolverRaiz = raizDoRepo;

/** Caracteres de controle (inclui \n, \r, ESC) e separadores de linha Unicode viram espaço: um campo nunca vira outra linha. */
export const limparLinha = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');

// ────────────────────────────────────────────────────────────── puras

export { inferirPbi }; // movido para lib/git (mesma assinatura)

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
    // data futura (> 1 d, folga de fuso) é validade forjada: vale como inválida, igual a texto e número
    const restantes = d === null || d < -1 ? null : Math.floor(Number(m.validadeDias ?? 90) - d);
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
  return L.slice(0, MAX_LINHAS).map(limparLinha);
}

// ────────────────────────────────────────────────────────────── hook SessionStart (T7)

const ORIGENS = new Set(['startup', 'resume', 'clear', 'compact']);

/** Lê o JSON de SessionStart; qualquer defeito (vazio, inválido, não-objeto) devolve entrada vazia. */
export function interpretarEntrada(texto) {
  try {
    const j = JSON.parse(texto);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { sessionId: null, origem: 'desconhecida' };
    return {
      sessionId: typeof j.session_id === 'string' ? j.session_id : null,
      origem: ORIGENS.has(j.source) ? j.source : 'desconhecida',
    };
  } catch {
    return { sessionId: null, origem: 'desconhecida' };
  }
}

/** Corta em `max` unidades UTF-16 sem deixar substituto alto solto no fim. */
export const cortar = (texto, max) => {
  const t = texto.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
};

const MARCA_OMITIDAS = (n) => `... ${n} linha(s) do cartão omitida(s)`;
/** Bloqueio ou ação pendente: o corte só chega nestas depois de esgotar as informativas. */
const PENDENTE = /VENCIDO|\(b\) não|inválido|indisponível|sem onboarding|gabarito-instalar|\brode\b|^Avisos:|LER PRIMEIRO|BLOQUEAD|^Envelhecidos: (?!—)/;

/**
 * Cabe o cartão em `max` caracteres perdendo LINHAS INTEIRAS, nunca um pedaço de linha. Ordem de sacrifício:
 * linha que sozinha nunca caberia; depois as informativas, do fim para o início; depois as de bloqueio ou ação pendente
 * (mesma ordem); a 1ª linha é a última a sair. Quando algo sai, uma linha final diz quantas. Só se nem isso couber
 * (`max` minúsculo) corta caracteres — o limite vale mais que a linha.
 */
export function cortarCartao(linhas, max) {
  const junta = (ls, omitidas) => (omitidas ? [...ls, MARCA_OMITIDAS(omitidas)] : ls).join('\n');
  if (junta(linhas, 0).length <= max) return junta(linhas, 0);
  const manter = linhas.map(() => true);
  let omitidas = 0;
  const atual = () => junta(linhas.filter((_, i) => manter[i]), omitidas);
  const solta = (i) => {
    manter[i] = false;
    omitidas++;
  };
  const folga = MARCA_OMITIDAS(linhas.length).length + 1;
  linhas.forEach((l, i) => {
    if (l.length + folga > max) solta(i);
  });
  const idx = linhas.map((_, i) => i).filter((i) => manter[i]);
  const ordem = [
    ...idx.filter((i) => i > 0 && !PENDENTE.test(linhas[i])).reverse(),
    ...idx.filter((i) => i > 0 && PENDENTE.test(linhas[i])).reverse(),
    ...idx.filter((i) => i === 0),
  ];
  for (const i of ordem) {
    if (atual().length <= max) break;
    solta(i);
  }
  return cortar(atual(), max);
}

/** Último recurso sem `dist/diario.js` (canário indisponível): padrões de segredo comuns, para a redação nunca desligar (F5). */
const SEGREDO_FALLBACK = /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{12,}|\bASIA[A-Z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE|\bsk-[A-Za-z0-9]{16,}|xox[bp]-[A-Za-z0-9-]{10,}|:\/\/[^/\s:]+:[^@\s]+@|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[\w-]{20,}\.eyJ[\w-]{20,}/;
const recusaFallback = (linha) => (SEGREDO_FALLBACK.test(linha) ? 'segredo' : null);

/** Linha com algo que o canário do diário recusaria: nunca sai em nenhuma das duas vias. */
const semSegredo = (linha, recusa) => (recusa(linha) === null ? linha : LINHA_REDIGIDA);

/** Corta linhas inteiras do fim até caber em `max` caracteres; marca o corte. Cabeçalho maior que `max` ⇒ ''. */
export function ajustarAoLimite(texto, max) {
  if (texto.length <= max) return texto;
  const marca = '... instantâneo truncado';
  const linhas = texto.split('\n');
  while (linhas.length > 1 && [...linhas, marca].join('\n').length > max) linhas.pop();
  const saida = [...linhas, marca].join('\n');
  return saida.length <= max ? saida : '';
}

/**
 * `.harness/heartbeat.json` (gitignored): evidência LOCAL de que o hook rodou aqui (Q20). Escrita atômica
 * (tmp + rename; rename substitui um symlink sem segui-lo). Devolve '' se gravou, ou a mensagem do erro.
 */
function gravarMarcador(raiz, dados) {
  const alvo = join(raiz, '.harness', 'heartbeat.json');
  const tmp = join(raiz, '.harness', `heartbeat.${process.pid}.${Date.now()}.tmp`);
  try {
    mkdirSync(join(raiz, '.harness'), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(dados)}\n`, { flag: 'wx', mode: 0o644 });
    renameSync(tmp, alvo);
    return '';
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* tmp nem chegou a existir */
    }
    return String(e?.message ?? e).split('\n')[0];
  }
}

/** `events.*.jsonl` que não é arquivo regular (symlink, FIFO…): ler seguiria o link ou travaria (F3). */
function arquivosNaoRegulares(dir) {
  let nomes;
  try {
    nomes = readdirSync(dir);
  } catch {
    return [];
  }
  return nomes.filter((n) => /^events\..+\.jsonl$/.test(n)).filter((n) => {
    try {
      return !lstatSync(join(dir, n)).isFile();
    } catch {
      return false;
    }
  });
}

/** Os três caminhos do diário não podem ser symlink: o hook não escreve fora da árvore da entrega. */
function caminhosSemSymlink(raiz, dir) {
  for (const p of [join(raiz, '.harness'), join(raiz, '.harness', 'entregas'), dir]) {
    try {
      if (lstatSync(p).isSymbolicLink()) return false;
    } catch {
      /* ausente é normal: append cria */
    }
  }
  return true;
}

/**
 * Monta as duas vias do SessionStart e grava `sessao.inicio` + `guarda.heartbeat {fonte}`.
 * Pura em relação ao processo: devolve `{ saida, falhas }`; quem chama imprime e decide o exit (sempre 0).
 */
export async function montarSaidaHook({ cwd, pluginRoot, agora, entradaTexto }) {
  const falhas = [];
  const entrada = interpretarEntrada(entradaTexto);
  let ctx;
  let linhas;
  try {
    ctx = coletar(cwd, pluginRoot, { agora });
    if (ctx.configInvalido) falhas.push('harness.config.json inválido — cartão mínimo');
    linhas = montarCartao(ctx);
  } catch (e) {
    falhas.push(`cartão indisponível: ${String(e?.message ?? e).split('\n')[0]}`);
    ctx = { erro: true, root: resolverRaiz(cwd), agora: agora ? Date.parse(agora) : Date.now() };
    linhas = [LINHA_INDISPONIVEL];
  }
  const raiz = ctx.root;

  let diario = null;
  try {
    diario = await import('../dist/diario.js');
  } catch (e) {
    falhas.push(`diário indisponível: ${String(e?.message ?? e).split('\n')[0]}`);
  }
  const recusa = diario?.recusaCanario ?? recusaFallback;

  let branch = ctx.branch ?? null;
  if (branch === null) {
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], raiz);
    } catch {
      branch = '(sem git)';
    }
  }
  const pbi = ctx.pbi ?? inferirPbi(branch, ctx.config)?.pbi ?? null;

  let fonte = 'local';
  let divergente = false;
  try {
    const g = lerGuarda(process.env.CLAUDE_PROJECT_DIR || raiz);
    fonte = g.fonte === 'origin' ? 'origin' : 'local';
    divergente = g.divergente === true;
  } catch (e) {
    falhas.push(`config da guarda ilegível: ${String(e?.message ?? e).split('\n')[0]}`);
  }

  let instantaneo = '';
  let diarioOk = false;
  if (diario && !ctx.semOnboarding && !ctx.erro) {
    // Sem onboarding (ou cartão indisponível) o hook não escreve nada: o instalador ainda não ignorou `.harness/` (F1, Q20).
    const dir = diario.dirEntrega(raiz, pbi);
    if (!caminhosSemSymlink(raiz, dir)) {
      falhas.push('diário em caminho com symlink — nada lido nem gravado');
    } else {
      try {
        const naoRegular = arquivosNaoRegulares(dir);
        if (naoRegular.length > 0) throw new Error(`${naoRegular[0]} não é arquivo regular — diário não lido`);
        const eventos = diario.ler(dir);
        if (eventos.length > 0) {
          instantaneo = diario.projetar(eventos).instantaneo.split('\n').map((l) => semSegredo(limparLinha(l), recusa)).join('\n');
        }
      } catch (e) {
        falhas.push(`leitura do diário falhou: ${String(e?.message ?? e).split('\n')[0]}`);
      }
      if (entrada.sessionId === null) {
        falhas.push('stdin sem session_id — sessao.inicio e heartbeat não gravados');
      } else {
        let autor = 'desconhecido';
        try {
          autor = git(['config', 'user.email'], raiz) || autor;
        } catch {
          /* sem user.email: o diário aceita "desconhecido" */
        }
        const ts = new Date(ctx.agora).toISOString();
        const base = { ts, autor, sessao: entrada.sessionId, agente: 'orquestrador' };
        const eventosNovos = [
          { ...base, tipo: 'sessao.inicio', dados: { origem: entrada.origem } },
          { ...base, tipo: 'guarda.heartbeat', dados: { fonte, divergente } },
        ];
        diarioOk = true;
        for (const ev of eventosNovos) {
          const r = diario.append(dir, entrada.sessionId, ev);
          if (!r.ok || r.gravado === 'recusa') {
            diarioOk = false;
            falhas.push(`diário recusou ${ev.tipo}: ${r.erro ?? 'canário'}`);
            break;
          }
        }
        if (diarioOk) {
          const arquivo = relative(raiz, join(dir, `events.${entrada.sessionId}.jsonl`)).split('\\').join('/');
          const erro = gravarMarcador(raiz, { ts, sessao: entrada.sessionId, arquivo, autor, fonte, divergente });
          if (erro) {
            diarioOk = false;
            falhas.push(`marcador do heartbeat não gravado: ${erro}`);
          }
        }
      }
    }
  }

  let texto = cortarCartao(linhas.map((l) => semSegredo(limparLinha(l), recusa)), LIMITE_CONTEXTO);
  if (instantaneo) {
    const sobra = LIMITE_CONTEXTO - texto.length - 1;
    const cabe = sobra > 0 ? ajustarAoLimite(instantaneo, sobra) : '';
    if (cabe) texto += `\n${cabe}`;
  }
  texto = cortar(texto, LIMITE_CONTEXTO);

  const mensagem = [
    ctx.semOnboarding ? 'GABARITO · harness sem onboarding' : `GABARITO · ${branch}${pbi ? ` · ${pbi}` : ''}`,
    `Guarda: fonte ${fonte}${divergente ? ' · config local diverge da origin' : ''}${diarioOk || ctx.semOnboarding ? '' : ' · heartbeat não gravado'}`,
    ctx.capacidade ? `Modelo ${ctx.config.orquestracao.modelo.alias || '?'} · slots ${ctx.capacidade.slots}` : 'Cartão completo no contexto da sessão',
  ]
    .slice(0, LIMITE_MENSAGEM_LINHAS)
    .map((l) => cortar(semSegredo(limparLinha(l), recusa), LIMITE_MENSAGEM_LINHA))
    .join('\n');

  const saida = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texto }, systemMessage: mensagem };
  return { saida, falhas };
}

async function mainHook(argv) {
  const pluginRoot = arg(argv, 'plugin-root') ? resolve(arg(argv, 'plugin-root')) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let entradaTexto = '';
  try {
    entradaTexto = readFileSync(0, 'utf8');
  } catch {
    /* sem stdin: entrada vazia, fail-open declarado abaixo */
  }
  const cwd = arg(argv, 'root') ? resolve(arg(argv, 'root')) : process.cwd();
  let resultado;
  try {
    resultado = await montarSaidaHook({ cwd, pluginRoot, agora: arg(argv, 'agora'), entradaTexto });
  } catch (e) {
    resultado = { saida: null, falhas: [`cartão indisponível: ${String(e?.message ?? e).split('\n')[0]}`] };
  }
  for (const f of resultado.falhas) console.error(`[ORQ-3] ${f} (fail-open declarado (G9))`);
  if (resultado.saida) process.stdout.write(`${JSON.stringify(resultado.saida)}\n`);
  process.exit(0); // sempre 0: falha no cartão nunca derruba a sessão
}

function main(argv) {
  const pluginRoot = arg(argv, 'plugin-root') ? resolve(arg(argv, 'plugin-root')) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let ctx;
  let linhas;
  try {
    ctx = coletar(arg(argv, 'root') ? resolve(arg(argv, 'root')) : process.cwd(), pluginRoot, { agora: arg(argv, 'agora') });
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

if (ehEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--hook')) await mainHook(argv);
  else main(argv);
}

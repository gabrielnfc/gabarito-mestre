#!/usr/bin/env node
/**
 * PAR-1 — capacidade.
 *
 * Paralelismo não é número de agentes: é o que a máquina aguenta de processos pesados ao
 * mesmo tempo (ADR-PAR-1). Este script mede cores, load 1 min, memória DISPONÍVEL
 * (macOS: vm_stat free+inactive+speculative · Linux: /proc/meminfo MemAvailable), disco
 * livre na raiz e processos pesados vivos (CPU > 20 % ou RSS > 500 MB) — excluindo a
 * árvore do próprio Claude Code (GABARITO_PID_RAIZ, default: pai deste processo) — e
 * devolve `{ slots, motivo, medidas }`: slots = min(simultaneos, teto, permitido), nunca < 1.
 * Toda medida é injetável por env (GABARITO_CAP_*); GABARITO_PARALELISMO substitui
 * `simultaneos` na sessão, ainda ≤ teto. Sem `orquestracao` na config: defaults + aviso.
 * Sempre sai 0 — quem decide é o orquestrador, e um erro aqui vira `slots: 1`.
 *
 * USO
 *   node capacidade.mjs                 # "slots: 2 (simultaneos)"
 *   node capacidade.mjs --json          # { slots, motivo, medidas }
 *   node capacidade.mjs --calibrar      # valores sugeridos para orquestracao.paralelismo
 */

import { readFileSync, existsSync, statfsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, loadavg, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  modo: 'auto',
  simultaneos: 2,
  teto: 4,
  limites: { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 },
  arquivosDeContenda: ['package-lock.json', 'prisma/', 'src/index.ts', 'docs/fluxo/'],
  isolamentoWorktree: { porta: '3000+n', dbSchema: 'wt_{n}', namespace: 'wt-{n}' },
  rodadasAntesDeEscalar: 2,
  calibradoEm: '',
};
export const CPU_PESADO_PCT = 20;
export const RSS_PESADO_MB = 500;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Número finito ou null. Aceita vírgula decimal (ps em locale pt-BR imprime `0,5`). */
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ────────────────────────────────────────────────────────────── parsers (puros)

export function parseVmStat(texto) {
  const tam = Number(/page size of (\d+) bytes/.exec(texto)?.[1] ?? 4096);
  const pg = (nome) => Number(new RegExp(`${nome}:\\s+(\\d+)`).exec(texto)?.[1] ?? 0);
  const paginas = pg('Pages free') + pg('Pages inactive') + pg('Pages speculative');
  return Math.round((paginas * tam) / 1_048_576);
}

export function parseMeminfo(texto) {
  const kb = Number(/MemAvailable:\s+(\d+)\s*kB/.exec(texto)?.[1] ?? 0);
  return Math.round(kb / 1024);
}

/** Saída de `ps -axo pid,ppid,%cpu,rss` (RSS em KB). Exclui `pidRaiz` e todos os descendentes. */
export function contarPesados(psSaida, pidRaiz) {
  const procs = [];
  for (const linha of String(psSaida ?? '').split('\n')) {
    const c = linha.trim().split(/\s+/);
    if (c.length < 4) continue;
    const pid = num(c[0]);
    const ppid = num(c[1]);
    const cpu = num(c[2]);
    const rssKB = num(c[3]);
    if (pid === null || ppid === null || cpu === null || rssKB === null) continue;
    procs.push({ pid, ppid, cpu, rssMB: rssKB / 1024 });
  }
  const filhos = new Map();
  for (const p of procs) {
    if (!filhos.has(p.ppid)) filhos.set(p.ppid, []);
    filhos.get(p.ppid).push(p.pid);
  }
  const excluidos = new Set();
  const fila = [Number(pidRaiz)];
  while (fila.length) {
    const p = fila.pop();
    if (excluidos.has(p)) continue;
    excluidos.add(p);
    for (const f of filhos.get(p) ?? []) fila.push(f);
  }
  return procs.filter((p) => !excluidos.has(p.pid) && (p.cpu > CPU_PESADO_PCT || p.rssMB > RSS_PESADO_MB)).length;
}

// ────────────────────────────────────────────────────────────── medição real

function memDisponivelMB() {
  try {
    if (platform() === 'darwin') return parseVmStat(execFileSync('vm_stat', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    if (platform() === 'linux') return parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
  } catch {
    /* cai no null: plataforma sem leitura não restringe */
  }
  return null;
}

function discoLivreGB(dir) {
  try {
    const s = statfsSync(dir);
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1e9);
  } catch {
    return null;
  }
}

function pesadosVivos(pidRaiz) {
  try {
    const saida = execFileSync('ps', ['-axo', 'pid,ppid,%cpu,rss'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    });
    return contarPesados(saida, pidRaiz);
  } catch {
    return null;
  }
}

export function medir(env = process.env, dir = process.cwd()) {
  return {
    cores: num(env.GABARITO_CAP_CORES) ?? availableParallelism(),
    load1: num(env.GABARITO_CAP_LOAD1) ?? Number(loadavg()[0].toFixed(2)),
    memDisponivelMB: num(env.GABARITO_CAP_MEM_MB) ?? memDisponivelMB(),
    discoLivreGB: num(env.GABARITO_CAP_DISCO_GB) ?? discoLivreGB(dir),
    pesados: num(env.GABARITO_CAP_PESADOS) ?? pesadosVivos(num(env.GABARITO_PID_RAIZ) ?? process.ppid),
    plataforma: platform(),
  };
}

// ────────────────────────────────────────────────────────────── regra

export function calcularSlots(paralelismo, medidas, env = process.env) {
  const p = paralelismo && typeof paralelismo === 'object' ? paralelismo : {};
  const limites = { ...DEFAULTS.limites, ...(p.limites ?? {}) };
  const teto = Math.floor(num(p.teto) ?? DEFAULTS.teto);
  let simultaneos = Math.floor(num(p.simultaneos) ?? DEFAULTS.simultaneos);
  let motivo = 'simultaneos';

  const override = num(env.GABARITO_PARALELISMO);
  if (override !== null) {
    simultaneos = Math.floor(override);
    motivo = `GABARITO_PARALELISMO=${override}`;
  }
  if (simultaneos > teto) {
    simultaneos = teto;
    motivo = `${motivo} acima do teto ${teto}`;
  }

  const m = medidas ?? {};
  const limitantes = [];
  if (m.cores && m.load1 !== null && m.load1 !== undefined && m.load1 / m.cores > limites.loadPorCoreMax) {
    limitantes.push({ permitido: 1, motivo: `load ${(m.load1 / m.cores).toFixed(2)}/core > ${limites.loadPorCoreMax}` });
  }
  if (m.memDisponivelMB !== null && m.memDisponivelMB !== undefined && m.memDisponivelMB < limites.memDisponivelMinMB) {
    limitantes.push({ permitido: 1, motivo: `mem ${m.memDisponivelMB} MB < ${limites.memDisponivelMinMB}` });
  }
  if (m.discoLivreGB !== null && m.discoLivreGB !== undefined && m.discoLivreGB < limites.discoLivreMinGB) {
    limitantes.push({ permitido: 1, motivo: `disco ${m.discoLivreGB} GB < ${limites.discoLivreMinGB}` });
  }
  if (m.pesados) {
    limitantes.push({ permitido: Math.max(1, teto - m.pesados), motivo: `${m.pesados} processo(s) pesado(s)` });
  }

  let slots = simultaneos;
  for (const l of limitantes) {
    if (l.permitido < slots) {
      slots = l.permitido;
      motivo = l.motivo;
    }
  }
  if (slots < 1) {
    slots = 1;
    motivo = `${motivo} — mínimo 1`;
  }
  return { slots, motivo, medidas: m };
}

export function calibrar(medidas, hoje = new Date()) {
  const cores = Math.max(1, Math.floor(num(medidas?.cores) ?? 1));
  return {
    simultaneos: clamp(Math.floor(cores / 4), 1, 3),
    teto: clamp(Math.floor(cores / 2), 2, 8),
    limites: { ...DEFAULTS.limites },
    calibradoEm: hoje.toISOString().slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────── config

export function lerParalelismo(root) {
  const f = join(root, 'harness.config.json');
  if (!existsSync(f)) return { paralelismo: null, aviso: 'defaults (orquestracao ausente: harness.config.json não existe)' };
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(f, 'utf8') || '{}');
  } catch (e) {
    return { paralelismo: null, aviso: `harness.config.json inválido (${String(e.message).split('\n')[0]}) — defaults; fail-open declarado (G9)` };
  }
  const p = cfg?.orquestracao?.paralelismo;
  return p && typeof p === 'object' ? { paralelismo: p, aviso: null } : { paralelismo: null, aviso: 'defaults (orquestracao ausente)' };
}

export function raizDoRepo(cwd = process.cwd()) {
  try {
    const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return r || cwd;
  } catch {
    return cwd;
  }
}

function main(argv) {
  const arg = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  try {
    const root = arg('root') ? resolve(arg('root')) : raizDoRepo();
    const medidas = medir(process.env, root);
    if (argv.includes('--calibrar')) {
      process.stdout.write(`${JSON.stringify(calibrar(medidas), null, 2)}\n`);
      process.exit(0);
    }
    const { paralelismo, aviso } = lerParalelismo(root);
    if (aviso) console.error(`[PAR-1] ${aviso}`);
    const r = calcularSlots(paralelismo, medidas, process.env);
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    else process.stdout.write(`slots: ${r.slots} (${r.motivo})\n`);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    console.error(`[PAR-1] erro ao medir: ${msg} (fail-open declarado (G9))`);
    process.stdout.write(argv.includes('--json') ? `${JSON.stringify({ slots: 1, motivo: `erro: ${msg}`, medidas: null })}\n` : `slots: 1 (erro: ${msg} — fail-open declarado (G9))\n`);
  }
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

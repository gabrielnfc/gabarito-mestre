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
 *   node capacidade.mjs --sugerir       # valores sugeridos para orquestracao.paralelismo (PAR-1, por núcleos)
 *
 * CAPACIDADE MEDIDA (GM-10, REQ-SLOT-1, F9/D3) — a escada medida no repositório, não custo estimado:
 *   node capacidade.mjs --calibrar [--suite <cmd>] [--cwd <dir>]
 *       roda a suíte em N=1,2,3,… slots simultâneos (cada um com TMPDIR próprio, removido ao fim) e para na
 *       1ª falha ou na 1ª queda de vazão. Grava `.harness/capacidade.json` (gitignored) por arquivo temporário
 *       + rename: `{hostname, slots_max, rss_pico_mb, tmpdir_mb, cpu_total}`. Suíte falhando em N=1 ⇒ rc 1 e
 *       o arquivo anterior fica intacto. Teto da escada: núcleos da máquina (nunca um número fixo).
 *   node capacidade.mjs --medido [--json]
 *       slots = min(slots_max, floor((mem − reserva)/rss), floor((disco − reserva)/tmpdir),
 *                   slots_max × cpu_livre/cpu_total se cpu_livre = cores − load1 < cpu_total), nunca < 1.
 *       Sem arquivo, hostname diferente, JSON corrompido, campo inválido ou medição falhando: 1 slot + aviso.
 *       Reservas: `orquestracao.paralelismo.limites` (defaults memDisponivelMinMB e discoLivreMinGB, acima).
 *       `--calibrar` sai de qualquer aviso.
 * `loop.mjs proxima` ainda lê `loop.slots`; ligar a esta saída é do orquestrador.
 */

import { readFileSync, existsSync, statfsSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { availableParallelism, loadavg, platform, hostname as osHostname, cpus, tmpdir } from 'node:os';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { raizDoRepo } from '../lib/git.mjs';
import { hojeISO } from '../lib/datas.mjs';

export { raizDoRepo }; // API pública: antes definida aqui, agora vem de lib/git

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
    calibradoEm: hojeISO(hoje),
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

// ────────────────────────────────────────────────────────────── capacidade medida (GM-10 · REQ-SLOT-1)

export const ARQUIVO_CAPACIDADE = join('.harness', 'capacidade.json');
/**
 * Queda de vazão = vazão(N) abaixo de vazão(N−1) × (1 − MARGEM_QUEDA). Derivada do S10 (suíte do próprio repo):
 * a mediana do slot em N estável varia 1,3 % (N=1) a 2,2 % (N=3) entre máximo e mediana; a queda real medida foi
 * 7,9 → 6,8 slots/min (−13,9 %, N=3→4, com 10/12 slots falhando). 5 % fica acima do ruído e abaixo da queda.
 * Vazão igual ou subindo nunca é queda.
 */
export const MARGEM_QUEDA = 0.05;
const INTERVALO_AMOSTRA_MS = 200;
const MB = 1_048_576;
const positivo = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const CAMPOS_MEDIDOS = ['rss_pico_mb', 'tmpdir_mb', 'cpu_total'];
const SUFIXO_CALIBRAR = '— rode capacidade.mjs --calibrar';

/** Valida o conteúdo do arquivo. Zero, negativo, ausente, texto ou infinito num campo medido é inválido, nunca "ilimitado". */
function validarCapacidade(obj, host) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { causa: 'conteúdo não é um objeto' };
  if (typeof obj.hostname !== 'string' || obj.hostname === '') return { causa: `campo hostname ausente ou inválido (${JSON.stringify(obj.hostname)})` };
  if (!Number.isInteger(obj.slots_max) || obj.slots_max < 1) return { causa: `campo slots_max inválido (${JSON.stringify(obj.slots_max)}): precisa ser inteiro ≥ 1` };
  for (const c of CAMPOS_MEDIDOS) {
    if (!positivo(obj[c])) return { causa: `campo ${c} inválido (${JSON.stringify(obj[c])}): precisa ser número finito > 0` };
  }
  if (obj.hostname !== host) return { causa: `calibrado em ${obj.hostname}, esta máquina é ${host}` };
  return { dados: { hostname: obj.hostname, slots_max: obj.slots_max, rss_pico_mb: obj.rss_pico_mb, tmpdir_mb: obj.tmpdir_mb, cpu_total: obj.cpu_total } };
}

/** Lê `.harness/capacidade.json`. Qualquer defeito devolve `{ dados: null, aviso }` — nunca lança, nunca inventa número. */
export function lerCapacidade(root, host = osHostname()) {
  const f = join(root, ARQUIVO_CAPACIDADE);
  if (!existsSync(f)) return { dados: null, aviso: `sem calibração: ${ARQUIVO_CAPACIDADE} não existe ${SUFIXO_CALIBRAR}` };
  let obj;
  try {
    obj = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    return { dados: null, aviso: `${ARQUIVO_CAPACIDADE} ilegível ou JSON corrompido (${String(e.message).split('\n')[0]}) ${SUFIXO_CALIBRAR}` };
  }
  const v = validarCapacidade(obj, host);
  return v.dados ? { dados: v.dados, aviso: null } : { dados: null, aviso: `${ARQUIVO_CAPACIDADE}: ${v.causa} ${SUFIXO_CALIBRAR}` };
}

/**
 * slots = min(slots_max, floor((mem − reserva)/rss), floor((disco − reserva)/tmpdir), redução por CPU), nunca < 1.
 * `limites` traz as reservas (`memDisponivelMinMB`, `discoLivreMinGB`) completadas por DEFAULTS.limites.
 * Sem dado válido ou com medição falhando: 1 slot e aviso — nunca `slots_max` por omissão.
 */
export function slotsMedidos(lido, medidas, limites = {}) {
  const m = medidas ?? {};
  if (!lido?.dados) return { slots: 1, motivo: '1 slot: sem capacidade válida', aviso: lido?.aviso ?? `capacidade indisponível ${SUFIXO_CALIBRAR}`, medidas: m };
  const d = lido.dados;
  for (const k of ['cores', 'load1', 'memDisponivelMB', 'discoLivreGB']) {
    if (!Number.isFinite(m[k]) || m[k] < 0 || (k === 'cores' && m[k] === 0)) {
      return { slots: 1, motivo: `1 slot: medição de ${k} indisponível`, aviso: `medição de ${k} falhou (${String(m[k])}) — 1 slot, não ${d.slots_max}`, medidas: m };
    }
  }
  const lim = { ...DEFAULTS.limites, ...(limites && typeof limites === 'object' ? limites : {}) };
  const reservaMem = num(lim.memDisponivelMinMB) ?? DEFAULTS.limites.memDisponivelMinMB;
  const reservaDiscoMB = (num(lim.discoLivreMinGB) ?? DEFAULTS.limites.discoLivreMinGB) * 1024;
  const livreCpu = m.cores - m.load1;
  const candidatos = [
    { n: d.slots_max, motivo: `slots_max ${d.slots_max}` },
    { n: Math.floor((m.memDisponivelMB - reservaMem) / d.rss_pico_mb), motivo: `mem: (${m.memDisponivelMB} − ${reservaMem} MB)/${d.rss_pico_mb} MB por slot` },
    { n: Math.floor((m.discoLivreGB * 1024 - reservaDiscoMB) / d.tmpdir_mb), motivo: `disco: (${m.discoLivreGB} GB − ${reservaDiscoMB / 1024} GB)/${d.tmpdir_mb} MB por slot` },
  ];
  if (livreCpu < d.cpu_total) {
    candidatos.push({ n: Math.floor((d.slots_max * livreCpu) / d.cpu_total), motivo: `cpu: ${livreCpu.toFixed(2)} núcleos livres < ${d.cpu_total} medidos com ${d.slots_max} slot(s)` });
  }
  let melhor = candidatos[0];
  for (const c of candidatos) if (c.n < melhor.n) melhor = c;
  if (melhor.n < 1) return { slots: 1, motivo: `${melhor.motivo} — mínimo 1`, aviso: null, medidas: m };
  return { slots: melhor.n, motivo: melhor.motivo, aviso: null, medidas: m };
}

/**
 * A escada: `medirN(n)` roda a suíte com n slots e devolve `{ ok, causa?, vazao, rss_pico_mb, tmpdir_mb, cpu_total }`.
 * Para na 1ª falha, na 1ª queda de vazão (> margem) ou em `maxN`. `slots_max` = último N sem falha e sem queda, com as
 * medidas DELE. Medição inválida (0, ausente, NaN) ou exceção nunca vira sucesso: para antes desse N. N=1 sem sucesso ⇒ slots_max 0 e `erro`.
 */
export async function escada(medirN, { maxN, margem = MARGEM_QUEDA } = {}) {
  let bom = null;
  let ant = null;
  let erro = null;
  let parou = `teto ${maxN}`;
  for (let n = 1; n <= maxN; n++) {
    let p;
    try {
      p = await medirN(n);
    } catch (e) {
      erro = `N=${n}: medição lançou: ${String(e?.message ?? e).split('\n')[0]}`;
      parou = erro;
      break;
    }
    if (!p || p.ok === false) {
      erro = `N=${n}: ${p?.causa ?? 'suíte falhou'}`;
      parou = `falha — ${erro}`;
      break;
    }
    const ruim = ['vazao', ...CAMPOS_MEDIDOS].find((c) => !positivo(p[c]));
    if (ruim) {
      erro = `N=${n}: medição inválida (${ruim} = ${String(p[ruim])})`;
      parou = erro;
      break;
    }
    if (ant && p.vazao < ant.vazao * (1 - margem)) {
      parou = `queda de vazão em N=${n}: ${p.vazao.toFixed(2)} < ${ant.vazao.toFixed(2)} × ${1 - margem}`;
      break;
    }
    bom = { n, ...p };
    ant = p;
  }
  if (!bom) return { slots_max: 0, rss_pico_mb: 0, tmpdir_mb: 0, cpu_total: 0, erro: erro ?? 'nenhuma medição', parou };
  return { slots_max: bom.n, rss_pico_mb: bom.rss_pico_mb, tmpdir_mb: bom.tmpdir_mb, cpu_total: bom.cpu_total, vazao: bom.vazao, erro: null, parou };
}

/** Temporário + rename: o arquivo anterior só é trocado por um novo inteiro. Falhou: lança, remove o temporário, o anterior fica. */
export function gravarAtomico(alvo, objeto) {
  const tmp = `${alvo}.${process.pid}.${Date.now()}.tmp`;
  try {
    const texto = `${JSON.stringify(objeto, null, 2)}\n`;
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(tmp, texto, { flag: 'wx', mode: 0o644 });
    renameSync(tmp, alvo);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* o temporário nem chegou a existir */
    }
    throw e;
  }
}

// Estado da calibração em curso: o que uma interrupção precisa matar e remover.
const ativos = { grupos: new Set(), dirs: new Set() };
function limparAtivos() {
  for (const g of ativos.grupos) {
    try {
      process.kill(-g, 'SIGKILL');
    } catch {
      /* grupo já terminou */
    }
  }
  ativos.grupos.clear();
  for (const d of ativos.dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* melhor esforço na interrupção */
    }
  }
  ativos.dirs.clear();
}

/** Uso em disco (blocos alocados, ou tamanho se maior) de uma árvore; não segue symlink. */
function usoEmDisco(caminho) {
  let total = 0;
  const visita = (c) => {
    let st;
    try {
      st = lstatSync(c);
    } catch {
      return;
    }
    total += Math.max(st.size, (st.blocks ?? 0) * 512);
    if (st.isDirectory()) {
      let nomes = [];
      try {
        nomes = readdirSync(c);
      } catch {
        /* ilegível: conta o que deu */
      }
      for (const n of nomes) visita(join(c, n));
    }
  };
  visita(caminho);
  return total;
}

const msCpuOcupada = () => cpus().reduce((a, c) => a + c.times.user + c.times.nice + c.times.sys + c.times.irq, 0);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  const i = o.length >> 1;
  return o.length % 2 ? o[i] : (o[i - 1] + o[i]) / 2;
};

/** RSS somado (MB) por grupo de processos, de `ps -axo pgid=,rss=`. `null` se o ps falhar. */
function rssPorGrupo() {
  return new Promise((ok) => {
    execFile('ps', ['-axo', 'pgid=,rss='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, saida) => {
      if (err) return ok(null);
      const por = new Map();
      for (const l of String(saida).split('\n')) {
        const c = l.trim().split(/\s+/);
        const g = num(c[0]);
        const kb = num(c[1]);
        if (g !== null && kb !== null) por.set(g, (por.get(g) ?? 0) + kb / 1024);
      }
      ok(por);
    });
  });
}

/**
 * Roda `n` cópias da suíte ao mesmo tempo, cada uma com TMPDIR próprio (em `base`), e mede: falhas, vazão (slots/min =
 * n / mediana da parede do slot), RSS pico do grupo do slot (amostrado), uso do TMPDIR antes de removê-lo e CPU
 * ocupada da máquina durante a rodada, em núcleos. Os TMPDIR são removidos ao fim; a suíte é `sh -c` num grupo próprio.
 */
export async function rodarSlots(n, { suite, cwd, base, intervaloMs = INTERVALO_AMOSTRA_MS }) {
  const slots = [];
  try {
    for (let i = 0; i < n; i++) {
      const dir = mkdtempSync(join(base, 'slot-'));
      ativos.dirs.add(dir);
      slots.push({ dir, pid: 0, rc: null, ms: 0, rss: 0 });
    }
    const t0 = Date.now();
    const cpu0 = msCpuOcupada();
    for (const s of slots) {
      const t = Date.now();
      const c = spawn(suite, { shell: true, cwd, detached: true, stdio: 'ignore', env: { ...process.env, TMPDIR: s.dir, TMP: s.dir, TEMP: s.dir } });
      s.pid = c.pid;
      if (c.pid) ativos.grupos.add(c.pid);
      s.fim = new Promise((res) => {
        c.on('error', () => {
          s.rc = -1;
          s.ms = Date.now() - t;
          res();
        });
        c.on('close', (code, sinal) => {
          s.rc = code ?? (sinal ? -1 : 0);
          s.ms = Date.now() - t;
          if (c.pid) ativos.grupos.delete(c.pid);
          res();
        });
      });
    }
    let psFalhou = false;
    const aberto = () => slots.some((s) => s.rc === null);
    while (aberto()) {
      await dormir(50);
      const por = await rssPorGrupo();
      if (por === null) psFalhou = true;
      else for (const s of slots) if (s.rc === null) s.rss = Math.max(s.rss, por.get(s.pid) ?? 0);
      if (aberto()) await dormir(intervaloMs);
    }
    await Promise.all(slots.map((s) => s.fim));
    const parede = Math.max(1, Date.now() - t0);
    const cpuTotal = (msCpuOcupada() - cpu0) / parede;
    const bytes = slots.map((s) => usoEmDisco(s.dir));
    const medianaMs = mediana(slots.map((s) => Math.max(1, s.ms)));
    return {
      falhas: slots.filter((s) => s.rc !== 0).length,
      mediana_ms: medianaMs,
      vazao: (n * 60_000) / medianaMs,
      rss_pico_mb: psFalhou ? 0 : Math.round(Math.max(...slots.map((s) => s.rss)) * 10) / 10,
      tmpdir_mb: Math.round((Math.max(...bytes) / MB) * 1000) / 1000,
      cpu_total: Math.round(cpuTotal * 100) / 100,
    };
  } finally {
    for (const s of slots) {
      try {
        rmSync(s.dir, { recursive: true, force: true });
      } catch {
        /* a verificação abaixo denuncia */
      }
      if (!existsSync(s.dir)) ativos.dirs.delete(s.dir);
      if (s.pid) ativos.grupos.delete(s.pid);
    }
  }
}

/**
 * `--calibrar`: sobe a escada com a suíte do repo e grava `.harness/capacidade.json`. Sem N=1 limpo: rc 1 e nada é gravado
 * (o arquivo anterior fica como estava). Teto da escada = `maxN` ou os núcleos da máquina.
 */
export async function calibrarCapacidade(root, { suite = 'npm test', cwd = root, hostname = osHostname(), maxN = availableParallelism(), base = tmpdir() } = {}) {
  mkdirSync(base, { recursive: true });
  const meu = mkdtempSync(join(base, 'cal-'));
  ativos.dirs.add(meu);
  try {
    const r = await escada(async (n) => {
      const m = await rodarSlots(n, { suite, cwd, base: meu });
      return m.falhas > 0 ? { ok: false, causa: `suíte falhou em ${m.falhas}/${n} slot(s)` } : { ok: true, ...m };
    }, { maxN });
    if (r.slots_max < 1) return { rc: 1, causa: r.erro ?? 'sem medição', parou: r.parou };
    const dados = { hostname, slots_max: r.slots_max, rss_pico_mb: r.rss_pico_mb, tmpdir_mb: r.tmpdir_mb, cpu_total: r.cpu_total };
    gravarAtomico(join(root, ARQUIVO_CAPACIDADE), dados);
    return { rc: 0, dados, parou: r.parou };
  } catch (e) {
    return { rc: 1, causa: String(e?.message ?? e).split('\n')[0] };
  } finally {
    rmSync(meu, { recursive: true, force: true });
    ativos.dirs.delete(meu);
  }
}


async function main(argv) {
  try {
    const root = arg(argv, 'root') ? resolve(arg(argv, 'root')) : raizDoRepo();
    const host = process.env.GABARITO_CAP_HOSTNAME || osHostname();
    if (argv.includes('--calibrar')) {
      const parar = () => {
        limparAtivos();
        process.exit(130);
      };
      process.once('SIGINT', parar);
      process.once('SIGTERM', parar);
      const r = await calibrarCapacidade(root, {
        suite: arg(argv, 'suite', 'npm test'),
        cwd: arg(argv, 'cwd') ? resolve(arg(argv, 'cwd')) : root,
        hostname: host,
        maxN: num(process.env.GABARITO_CAP_CORES) ?? availableParallelism(),
        base: process.env.GABARITO_CAL_TMP || tmpdir(),
      });
      if (r.rc !== 0) {
        console.error(`[PAR-1] calibração falhou: ${r.causa} — ${ARQUIVO_CAPACIDADE} não foi alterado`);
        process.exit(1);
      }
      process.stdout.write(`${JSON.stringify({ ...r.dados, parou: r.parou }, null, 2)}\n`);
      process.exit(0);
    }
    if (argv.includes('--medido')) {
      const medidas = medir(process.env, root);
      const { paralelismo } = lerParalelismo(root);
      const r = slotsMedidos(lerCapacidade(root, host), medidas, paralelismo?.limites);
      if (r.aviso) console.error(`[PAR-1] ${r.aviso}`);
      if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      else process.stdout.write(`slots: ${r.slots} (${r.motivo})\n`);
      process.exit(0);
    }
    const medidas = medir(process.env, root);
    if (argv.includes('--sugerir')) {
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
    if (argv.includes('--calibrar')) {
      console.error(`[PAR-1] calibração falhou: ${msg} — ${ARQUIVO_CAPACIDADE} não foi alterado`);
      process.exit(1);
    }
    console.error(`[PAR-1] erro ao medir: ${msg} (fail-open declarado (G9))`);
    process.stdout.write(argv.includes('--json') ? `${JSON.stringify({ slots: 1, motivo: `erro: ${msg}`, medidas: null })}\n` : `slots: 1 (erro: ${msg} — fail-open declarado (G9))\n`);
  }
  process.exit(0);
}

if (ehEntrypoint(import.meta.url)) await main(process.argv.slice(2));

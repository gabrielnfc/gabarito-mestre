#!/usr/bin/env node
/**
 * VER-3 — versionamento-check.
 *
 * Versionamento é gate, não convenção (R20): este script confere o histórico (`base..HEAD`
 * no CI; últimos N commits de primeiro pai no doctor) contra Conventional Commits com
 * escopo do PBI, e o nome da branch contra `branchPadrao` ou `branchWorktree`.
 * Commits com 2+ pais (merge do orquestrador) são IGNORADOS — o título do squash é
 * atestado (`squash-titulo-pr`), não varrido. Sem `versionamento.resolvidoEm` na config:
 * fail-open declarado (G9), sai 0 — repo sem onboarding não é travado.
 *
 * USO
 *   node versionamento-check.mjs --base origin/main --branch "$GITHUB_HEAD_REF"   # CI (fetch-depth: 0)
 *   node versionamento-check.mjs --max 20 --json                                  # doctor / local
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  modelo: 'trunk',
  branchPadrao: '^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$',
  branchWorktree: '^wt/[A-Z]+-\\d+-\\d+$',
  commit: 'conventional',
  tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'],
  tiposLivres: ['chore', 'docs', 'ci', 'build', 'test', 'release', 'revert'],
  tag: '^v\\d+\\.\\d+\\.\\d+$',
  changelog: 'CHANGELOG.md',
  idPadrao: '^[A-Z]+-\\d+$',
};
export const BRANCHES_PADRAO = new Set(['main', 'master']);

// ────────────────────────────────────────────────────────────── puras

export function parseCabecalho(msg) {
  const linha = String(msg ?? '').split(/\r?\n/)[0].trim();
  const m = /^([a-z]+)(?:\(([^()\s]+)\))?(!)?: (\S.*)$/.exec(linha);
  return m ? { tipo: m[1], escopo: m[2] ?? null, assunto: m[4] } : null;
}

export function validarCommit(msg, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const h = parseCabecalho(msg);
  if (!h) return { ok: false, motivo: 'cabeçalho não é `tipo(escopo): assunto`' };
  if (c.tiposComEscopoDePbi.includes(h.tipo)) {
    if (!h.escopo) return { ok: false, motivo: `tipo \`${h.tipo}\` exige escopo com o ID do PBI (ex.: ${h.tipo}(PBI-12): …)` };
    if (!new RegExp(c.idPadrao).test(h.escopo)) return { ok: false, motivo: `escopo \`${h.escopo}\` não casa idPadrao ${c.idPadrao}` };
    return { ok: true, motivo: null };
  }
  if (c.tiposLivres.includes(h.tipo)) return { ok: true, motivo: null };
  return { ok: false, motivo: `tipo \`${h.tipo}\` desconhecido (use ${[...c.tiposComEscopoDePbi, ...c.tiposLivres].join('|')})` };
}

export function validarBranch(nome, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const n = String(nome ?? '').trim();
  if (BRANCHES_PADRAO.has(n)) return { ok: true, motivo: 'branch padrão' };
  if (new RegExp(c.branchPadrao).test(n)) return { ok: true, motivo: null };
  if (new RegExp(c.branchWorktree).test(n)) return { ok: true, motivo: 'worktree' };
  return { ok: false, motivo: `branch \`${n}\` não casa branchPadrao nem branchWorktree` };
}

// ────────────────────────────────────────────────────────────── config e git

export function lerConfig(root) {
  const f = join(root, 'harness.config.json');
  if (!existsSync(f)) return { cfg: null, failOpen: 'harness.config.json ausente' };
  let raw;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8') || '{}');
  } catch (e) {
    return { cfg: null, failOpen: `harness.config.json inválido (${String(e.message).split('\n')[0]})` };
  }
  const v = raw?.versionamento;
  if (!v || typeof v !== 'object' || !v.resolvidoEm) return { cfg: null, failOpen: 'versionamento.resolvidoEm ausente (repo sem onboarding)' };
  return { cfg: { ...DEFAULTS, ...v, idPadrao: raw?.fluxo?.idPadrao ?? DEFAULTS.idPadrao }, failOpen: null };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
}

/** `%H%x00%P%x00%s`: sha, pais separados por espaço, assunto. NUL evita colisão com `|` ou `;` em assuntos. */
export function listarCommits(root, { base, max = 20 } = {}) {
  const args = ['log', '--format=%H%x00%P%x00%s'];
  if (base) args.push(`${base}..HEAD`);
  else args.push('--first-parent', `-n${max}`, 'HEAD');
  return git(args, root)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, pais, assunto] = l.split('\0');
      return { sha, pais: pais ? pais.split(' ').filter(Boolean) : [], assunto: assunto ?? '' };
    });
}

export function checar(root, opts = {}) {
  const { cfg, failOpen } = opts.cfg ? { cfg: { ...DEFAULTS, ...opts.cfg }, failOpen: null } : lerConfig(root);
  if (failOpen) return { ok: true, achados: [], failOpen };
  let commits;
  try {
    commits = listarCommits(root, opts);
  } catch (e) {
    return { ok: true, achados: [], aviso: `sem git legível em ${root} (${String(e?.message ?? e).split('\n')[0]})` };
  }
  const achados = [];
  for (const c of commits) {
    if (c.pais.length >= 2) continue; // merge do orquestrador: o squash é atestado, não varrido
    const r = validarCommit(c.assunto, cfg);
    if (!r.ok) achados.push({ sha: c.sha.slice(0, 7), motivo: `${r.motivo} — "${c.assunto}"` });
  }
  let branch = opts.branch;
  if (!branch) {
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    } catch {
      branch = null;
    }
  }
  if (branch && branch !== 'HEAD') {
    const r = validarBranch(branch, cfg);
    if (!r.ok) achados.push({ sha: 'branch', motivo: r.motivo });
  }
  return { ok: achados.length === 0, achados, commits: commits.length, branch: branch ?? null };
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
  const arg = (nome, fallback) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const root = arg('root') ? resolve(arg('root')) : raizDoRepo();
  const max = Number(arg('max', 20)) || 20;
  const r = checar(root, { base: arg('base'), branch: arg('branch'), max });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    process.exit(r.failOpen ? 0 : r.ok ? 0 : 1);
  }
  if (r.failOpen) {
    console.error(`[R20] ${r.failOpen} — fail-open declarado (G9)`);
    process.exit(0);
  }
  if (r.aviso) console.error(`[R20] ${r.aviso} — nada conferido`);
  for (const a of r.achados) console.error(`::error::[R20] ${a.sha} ${a.motivo}`);
  if (r.ok) console.log(`[R20] ok — ${r.commits} commit(s) conferido(s)${r.branch ? `, branch ${r.branch}` : ''}`);
  else console.error(`[R20] ${r.achados.length} achado(s). Formato: tipo(PBI-n): assunto · branch tipo/PBI-n-slug ou wt/PBI-n-i. Ver docs/harness/referencia.md §10.`);
  process.exit(r.ok ? 0 : 1);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));

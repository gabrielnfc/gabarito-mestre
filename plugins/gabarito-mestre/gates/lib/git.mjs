/** Git e raiz do repositório. Zero dependência. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Padrões de id de PBI e tipos de commit com escopo de PBI — fonte única (cartao-sessao.DEFAULTS reutiliza). */
export const PADROES = {
  idPadrao: '^[A-Z]+-\\d+$',
  tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'],
};

/** `git <args>` em `cwd`, saída com trim; lança em erro. stderr descartado. */
export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** toplevel do git → `cwd` quando não é repo (ou git ausente). */
export function raizDoRepo(cwd = process.cwd()) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd) || cwd;
  } catch {
    return cwd;
  }
}

/** Sobe a partir de `cwd` procurando `.git` (diretório OU arquivo de worktree), sem spawn. Não achou → null. */
export function raizPorFs(cwd) {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const pai = dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}

/** Branch atual, ou null (fora de repo, HEAD sem commit). */
export function branchAtual(cwd) {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || null;
  } catch {
    return null;
  }
}

/** PBI de um nome de branch: `wt/<PBI>-<n>` → {pbi, n}; `<tipo>/<PBI>-slug` → {pbi, n: null}; senão null. */
export function inferirPbi(branch, cfg) {
  const idRe = new RegExp(cfg?.fluxo?.idPadrao ?? PADROES.idPadrao);
  const tipos = cfg?.versionamento?.tiposComEscopoDePbi ?? PADROES.tiposComEscopoDePbi;
  const b = String(branch ?? '');
  const wt = /^wt\/(.+)-(\d+)$/.exec(b);
  if (wt && idRe.test(wt[1])) return { pbi: wt[1], n: Number(wt[2]) };
  const m = /^([a-z]+)\/([A-Za-z]+-\d+)(?:-|$)/.exec(b);
  if (m && tipos.includes(m[1]) && idRe.test(m[2])) return { pbi: m[2], n: null };
  return null;
}

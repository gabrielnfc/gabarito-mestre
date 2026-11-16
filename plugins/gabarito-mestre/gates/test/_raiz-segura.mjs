// Guarda de raiz de teste (GM-15 T24, REQ-HIG-1): teste que chama `medir`/CLI do harness grava em `<raiz>/.harness/`.
// A raiz tem de ser um diretório temporário; a do checkout (ou um ancestral dela) é recusada.
import { realpathSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** Raízes de checkout a proteger: a do worktree que contém este arquivo e a do checkout principal (git-common-dir). */
export function raizesDeCheckout(aqui = dirname(fileURLToPath(import.meta.url))) {
  const g = (...a) => execFileSync('git', ['-C', aqui, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const r = new Set();
  try { r.add(real(g('rev-parse', '--show-toplevel'))); } catch { /* fora de git: sem raiz a proteger */ }
  try { r.add(real(dirname(resolve(aqui, g('rev-parse', '--git-common-dir'))))); } catch { /* idem */ }
  return [...r];
}

/** Devolve `raiz` se segura; lança se for um checkout, ou contiver um (ancestral). `checkouts` é injetável nos testes. */
export function raizSegura(raiz, { checkouts = raizesDeCheckout() } = {}) {
  if (typeof raiz !== 'string' || !raiz) throw new Error('raiz de teste ausente');
  const r = real(raiz);
  for (const c of checkouts) {
    if (r === c || c.startsWith(r.endsWith(sep) ? r : r + sep)) throw new Error(`raiz de teste é a do checkout (${c}): use mkdtemp; o diário real não é de teste`);
  }
  return raiz;
}

/** Atalho: mkdtemp já validado (nunca a raiz do checkout). */
export function raizDeTeste(criar) {
  const d = criar();
  if (!existsSync(join(d, '.'))) throw new Error('raiz de teste não existe');
  return raizSegura(d);
}

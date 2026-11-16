// Guarda de raiz de teste (GM-15 T24, REQ-HIG-1): teste que chama `medir`/CLI do harness grava em `<raiz>/.harness/`.
// A raiz tem de ser um diretório temporário; a do checkout (ou um ancestral dela) é recusada.
import { realpathSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** realpath que também resolve caminho inexistente: sobe até o ancestral existente, resolve o symlink dele e recompõe o resto. */
const real = (p) => {
  let atual = resolve(p); const resto = [];
  for (;;) {
    try { return join(realpathSync(atual), ...resto.reverse()); } catch { /* inexistente: sobe */ }
    const pai = dirname(atual);
    if (pai === atual) return resolve(p);
    resto.push(atual.slice(pai.length + 1)); atual = pai;
  }
};
const dentro = (filho, pai) => filho === pai || filho.startsWith(pai.endsWith(sep) ? pai : pai + sep);

/** Raízes de checkout a proteger: a do worktree que contém este arquivo e a do checkout principal (git-common-dir). */
export function raizesDeCheckout(aqui = dirname(fileURLToPath(import.meta.url))) {
  const g = (...a) => execFileSync('git', ['-C', aqui, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const r = new Set();
  try { r.add(real(g('rev-parse', '--show-toplevel'))); } catch { /* fora de git: sem raiz a proteger */ }
  try { r.add(real(dirname(resolve(aqui, g('rev-parse', '--git-common-dir'))))); } catch { /* idem */ }
  return [...r];
}

/** Devolve `raiz` se segura; lança se for um checkout, contiver um (ancestral) ou estiver dentro de um (subdiretório). `checkouts` é injetável nos testes. */
let cache = null; // as raízes do checkout não mudam durante o processo: 2 `git` por chamada custavam ~20 ms × cada raiz do loop-cli
const checkoutsDoProcesso = () => (cache ??= raizesDeCheckout());

export function raizSegura(raiz, { checkouts = checkoutsDoProcesso() } = {}) {
  if (typeof raiz !== 'string' || !raiz) throw new Error('raiz de teste ausente');
  const r = real(raiz);
  for (const c0 of checkouts) {
    const c = real(c0);
    // a própria raiz, um ancestral (contém o checkout) ou um subdiretório (medir/loop acham a raiz pelo git-common-dir do cwd)
    if (dentro(r, c) || dentro(c, r)) throw new Error(`raiz de teste é a do checkout (${c}): use mkdtemp; o diário real não é de teste`);
  }
  return raiz;
}

/** Atalho: mkdtemp já validado (nunca a raiz do checkout). */
export function raizDeTeste(criar) {
  const d = criar();
  if (!existsSync(join(d, '.'))) throw new Error('raiz de teste não existe');
  return raizSegura(d);
}

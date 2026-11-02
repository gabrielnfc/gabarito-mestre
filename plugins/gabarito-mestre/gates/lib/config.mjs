/** Leitura de JSON e de harness.config.json. Zero dependência. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { git } from './git.mjs';

/** null = ausente · undefined = JSON inválido/ilegível · {} = arquivo vazio (quem chama decide o que fazer com cada um). */
export function lerJson(caminho) {
  if (!existsSync(caminho)) return null;
  try {
    const t = readFileSync(caminho, 'utf8');
    return t.trim() === '' ? {} : JSON.parse(t);
  } catch {
    return undefined;
  }
}

/**
 * `harness.config.json` da raiz, sobre `defaults` (merge raso). Ausente/inválido → `cfg: null` + `failOpen`
 * com o motivo (fail-open declarado, G9); nunca lança.
 */
export function lerConfig(raiz, defaults = {}) {
  const f = join(raiz, 'harness.config.json');
  if (!existsSync(f)) return { cfg: null, failOpen: 'harness.config.json ausente' };
  let raw;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8') || '{}');
  } catch (e) {
    return { cfg: null, failOpen: `harness.config.json inválido (${String(e.message).split('\n')[0]})` };
  }
  return { cfg: { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) }, failOpen: null };
}

/** Ref remota fixa, SEMPRE pelo nome completo: `origin/HEAD` (curto) resolve `refs/heads/origin/HEAD` antes — forjável por `git branch origin/HEAD`. */
const REF_ORIGIN = 'refs/remotes/origin/HEAD';

/** `guarda` + `versionamento.branchPadrao` de um `harness.config.json` já parseado → { config: ConfigGuarda, branchPadrao } (ou null). */
function paraGuarda(raw, { zerarPermitidos }) {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw.guarda && typeof raw.guarda === 'object' ? raw.guarda : {};
  const branchPadrao = typeof raw.versionamento?.branchPadrao === 'string' ? raw.versionamento.branchPadrao : null;
  const ambientes = { ...(g.ambientes ?? {}) };
  if (branchPadrao || g.ambientes?.prod) {
    // default de `branches` do ambiente de produção = branchPadrao da MESMA fonte
    const atual = g.ambientes?.prod ?? {};
    ambientes.prod = { ...atual, branches: atual.branches ?? (branchPadrao ? [branchPadrao] : []) };
  }
  const producao = { ...(g.producao ?? {}), permitidos: zerarPermitidos ? [] : (g.producao?.permitidos ?? []) };
  return { config: { ...g, ambientes, producao }, branchPadrao };
}

/**
 * Config da guarda lida de `refs/remotes/origin/HEAD:harness.config.json` (D2) — um spawn de git.
 * Sem remoto / ref ausente / arquivo ausente na ref ⇒ `fonte: 'local'`, `permitidos` zerado.
 * `divergente`: `guarda` da árvore local ≠ a da ref (deep equal).
 */
export function lerGuarda(raiz) {
  const local = lerJson(join(raiz, 'harness.config.json'));
  const localRaw = local && typeof local === 'object' ? local : null;
  let origin = null;
  try {
    const raw = JSON.parse(git(['show', `${REF_ORIGIN}:harness.config.json`], raiz));
    if (raw && typeof raw === 'object') origin = raw;
  } catch {
    origin = null;
  }
  if (origin) {
    const { config, branchPadrao } = paraGuarda(origin, { zerarPermitidos: false });
    const divergente = !isDeepStrictEqual(localRaw?.guarda ?? null, origin.guarda ?? null);
    return { config, fonte: 'origin', divergente, branchPadrao };
  }
  const l = paraGuarda(localRaw, { zerarPermitidos: true });
  return { config: l?.config ?? null, fonte: 'local', divergente: false, branchPadrao: l?.branchPadrao ?? null };
}

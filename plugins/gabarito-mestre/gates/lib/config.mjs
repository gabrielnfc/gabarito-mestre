/** Leitura de JSON e de harness.config.json. Zero dependência. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

/** Utilidades de CLI compartilhadas pelos scripts de gates (antes: 8 cópias). Zero dependência. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Valor de `--nome valor`. Flag ausente ou sem valor (fim do argv) → `fallback`. */
export function arg(argv, nome, fallback) {
  const i = argv.indexOf(`--${nome}`);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

/**
 * Entrypoint robusto a espaço/acento e a symlink: `file://` cru falha com %20, e comparar
 * contra `resolve(argv[1])` sem realpath falha atrás de qualquer symlink (macOS /var,
 * cache de plugin, bin do npm/homebrew) — o script sairia 0 em silêncio nos dois casos.
 * Uso: `if (ehEntrypoint(import.meta.url)) main(...)`.
 */
export function ehEntrypoint(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(metaUrl) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

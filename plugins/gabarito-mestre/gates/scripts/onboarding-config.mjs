#!/usr/bin/env node
/**
 * ONB-7 — onboarding-config.
 *
 * O template de `harness.config.json` NÃO traz `fluxo`, `versionamento`, `orquestracao`
 * nem `contexto`: quem grava é este script, chamado pela skill `gabarito-instalar`.
 * Merge chave a chave (objetos recursivos, arrays substituídos), nunca remove, preserva
 * `_comment` e chaves desconhecidas, escreve atomicamente (tmp + rename) e imprime o diff.
 * O mesmo mecanismo emenda `.claude/settings.json` (`--settings`), que é arquivo do
 * usuário: `permissions` e o resto ficam como estavam (R2). Arquivo-alvo com JSON
 * inválido NUNCA é sobrescrito: fail-open declarado (G9), exit 0.
 *
 * USO
 *   node onboarding-config.mjs --set fluxo '{"ferramenta":"clickup"}'
 *   node onboarding-config.mjs --root /repo --set orquestracao '{…}' --dry-run
 *   node onboarding-config.mjs --settings '{"model":"fable"}'
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SECOES = ['fluxo', 'versionamento', 'orquestracao', 'contexto'];
export const CONFIG_FILE = 'harness.config.json';
export const SETTINGS_FILE = '.claude/settings.json';

export class ArquivoInvalido extends Error {}

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Objetos: recursivo. Arrays: substitui. `undefined`: ignora. Nunca remove. Não muta a base. */
export function mergeDeep(base, patch) {
  const out = ehObjeto(base) ? { ...base } : {};
  if (!ehObjeto(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (ehObjeto(v)) out[k] = mergeDeep(ehObjeto(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

/** Ausente ou vazio → {}. JSON inválido → ArquivoInvalido (quem chama decide não escrever). */
export function lerJson(caminho) {
  if (!existsSync(caminho)) return {};
  const texto = readFileSync(caminho, 'utf8');
  if (texto.trim() === '') return {};
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw new ArquivoInvalido(`${caminho}: JSON inválido (${String(e.message).split('\n')[0]})`);
  }
}

/** tmp no mesmo diretório + rename: ou o arquivo inteiro novo, ou o antigo intacto. */
export function escreverAtomico(caminho, obj) {
  mkdirSync(dirname(caminho), { recursive: true });
  const tmp = `${caminho}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, caminho);
}

/** `+ a.b = <json>` para chave nova · `~ a.b: <antes> → <depois>` para mudança. Nada de `-`: o merge não remove. */
export function diffChaves(antes, depois, prefixo = '') {
  const linhas = [];
  for (const k of Object.keys(depois ?? {})) {
    const a = ehObjeto(antes) ? antes[k] : undefined;
    const d = depois[k];
    const cam = prefixo ? `${prefixo}.${k}` : k;
    if (ehObjeto(d) && ehObjeto(a)) linhas.push(...diffChaves(a, d, cam));
    else if (a === undefined) linhas.push(`+ ${cam} = ${JSON.stringify(d)}`);
    else if (JSON.stringify(a) !== JSON.stringify(d)) linhas.push(`~ ${cam}: ${JSON.stringify(a)} → ${JSON.stringify(d)}`);
  }
  return linhas;
}

function aplicarEm(arquivo, patch, { dryRun = false } = {}) {
  const antes = lerJson(arquivo);
  const depois = mergeDeep(antes, patch);
  const diff = diffChaves(antes, depois);
  if (!dryRun && (diff.length || !existsSync(arquivo))) escreverAtomico(arquivo, depois);
  return { antes, depois, diff };
}

export function aplicar(root, secao, patch, opts = {}) {
  if (!SECOES.includes(secao)) throw new RangeError(`seção desconhecida: ${secao} (use ${SECOES.join('|')})`);
  return aplicarEm(join(root, CONFIG_FILE), { [secao]: patch }, opts);
}

export function aplicarSettings(root, patch, opts = {}) {
  return aplicarEm(join(root, SETTINGS_FILE), patch, opts);
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
  const root = arg('root') ? resolve(arg('root')) : raizDoRepo();
  const dryRun = argv.includes('--dry-run');
  const iSet = argv.indexOf('--set');
  const settings = arg('settings');
  if (iSet === -1 && settings === undefined) {
    console.error("uso: onboarding-config.mjs [--root <dir>] --set <fluxo|versionamento|orquestracao|contexto> '<json>' | --settings '<json>' [--dry-run]");
    process.exit(1);
  }
  const bruto = iSet !== -1 ? argv[iSet + 2] : settings;
  let patch;
  try {
    patch = JSON.parse(bruto ?? '');
  } catch (e) {
    console.error(`[ONB-7] JSON inválido no argumento: ${String(e.message).split('\n')[0]}`);
    process.exit(1);
  }
  if (!ehObjeto(patch)) {
    console.error('[ONB-7] o patch precisa ser um objeto JSON');
    process.exit(1);
  }
  const alvo = iSet !== -1 ? CONFIG_FILE : SETTINGS_FILE;
  let r;
  try {
    r = iSet !== -1 ? aplicar(root, argv[iSet + 1], patch, { dryRun }) : aplicarSettings(root, patch, { dryRun });
  } catch (e) {
    if (e instanceof ArquivoInvalido) {
      console.error(`[ONB-7] ${e.message} — não escrevo por cima de arquivo que não consigo ler (fail-open declarado (G9))`);
      process.exit(0);
    }
    if (e instanceof RangeError) {
      console.error(`[ONB-7] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(dryRun ? `[ONB-7] dry-run — ${alvo} não foi escrito` : r.diff.length ? `[ONB-7] ${alvo} atualizado` : `[ONB-7] ${alvo} sem mudanças`);
  for (const l of r.diff) console.log(`  ${l}`);
  process.exit(0);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));

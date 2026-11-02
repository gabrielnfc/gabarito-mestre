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
 *   node onboarding-config.mjs --root /repo --deny-guarda      # 2ª camada da guarda: permissions.deny em .claude/settings.json
 *
 * `--deny-guarda` UNE as 7 entradas da guarda ao `permissions.deny` que o usuário já tem (nunca substitui, nunca
 * duplica, mantém ordem, indentação e o resto do arquivo). Em dúvida — JSON inválido ou com comentário, symlink,
 * sem permissão de escrita, formato inesperado — NÃO escreve: diz o motivo e imprime a linha para o usuário colar.
 *
 * 2.0: chaves removidas (`CHAVES_MORTAS`) são descartadas do patch de `--set`, com aviso: a skill de onboarding
 * ainda as envia; o arquivo do usuário que já as tem não é tocado (R2).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, lstatSync, accessSync, unlinkSync, constants as fsConstants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { raizDoRepo } from '../lib/git.mjs';
import { DENY_GUARDA, CHAVES_MORTAS } from '../lib/config.mjs';

export { raizDoRepo }; // API pública: antes definida aqui, agora vem de lib/git

export const SECOES = ['fluxo', 'versionamento', 'orquestracao', 'contexto'];
export const CONFIG_FILE = 'harness.config.json';
export const SETTINGS_FILE = '.claude/settings.json';

export class ArquivoInvalido extends Error {}

// As duas listas vivem em lib/config.mjs (o doctor também as lê, sem importar este CLI); re-exportadas aqui.
export { DENY_GUARDA, CHAVES_MORTAS };

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

/** Cópia de `patch` (seção `secao`) sem as chaves mortas daquela seção + os caminhos removidos. Não muta o original. */
export function removerMortas(secao, patch) {
  const limpo = structuredClone(patch);
  const removidas = [];
  for (const caminho of CHAVES_MORTAS) {
    const partes = caminho.split('.');
    if (partes[0] !== secao) continue;
    const resto = partes.slice(1);
    let no = limpo;
    for (const p of resto.slice(0, -1)) no = ehObjeto(no) ? no[p] : undefined;
    const folha = resto[resto.length - 1];
    if (ehObjeto(no) && folha in no) {
      delete no[folha];
      removidas.push(caminho);
    }
  }
  return { patch: limpo, removidas };
}

export function aplicar(root, secao, patch, opts = {}) {
  if (!SECOES.includes(secao)) throw new RangeError(`seção desconhecida: ${secao} (use ${SECOES.join('|')})`);
  const { patch: limpo, removidas } = removerMortas(secao, patch);
  return { ...aplicarEm(join(root, CONFIG_FILE), { [secao]: limpo }, opts), removidas };
}

export function aplicarSettings(root, patch, opts = {}) {
  return aplicarEm(join(root, SETTINGS_FILE), patch, opts);
}

/** A linha que o usuário cola à mão quando recusamos mexer no arquivo dele. */
export const linhaDenyGuarda = () => `"permissions": { "deny": ${JSON.stringify(DENY_GUARDA)} }`;

const lstatOuNull = (caminho) => {
  try {
    return lstatSync(caminho);
  } catch {
    return null;
  }
};

/**
 * 2ª camada da guarda: une `DENY_GUARDA` ao `permissions.deny` de `.claude/settings.json`.
 * → { acao: 'criado' | 'emendado' | 'igual' | 'recusado', motivo?, novas?: string[], linha?: string }.
 * Nunca lança. Em dúvida recusa e não toca (R2); a escrita é tmp + rename na mesma pasta.
 */
export function aplicarDenyGuarda(root, { dryRun = false } = {}) {
  const dir = join(root, '.claude');
  const arquivo = join(root, SETTINGS_FILE);
  const recusa = (motivo) => ({ acao: 'recusado', motivo, linha: linhaDenyGuarda() });
  const stDir = lstatOuNull(dir);
  if (stDir && !stDir.isDirectory()) return recusa(stDir.isSymbolicLink() ? '.claude é um symlink' : '.claude não é um diretório');
  const st = lstatOuNull(arquivo);
  const tmp = `${arquivo}.tmp-${process.pid}`;
  let alvo;
  let indent = 2;
  let fim = '\n';
  let acao = 'criado';
  let novas = [...DENY_GUARDA];
  if (!st) {
    alvo = { permissions: { deny: [...DENY_GUARDA] } };
  } else {
    if (st.isSymbolicLink()) return recusa('settings.json é um symlink');
    if (!st.isFile()) return recusa('settings.json não é um arquivo comum');
    try {
      accessSync(arquivo, fsConstants.W_OK);
    } catch {
      return recusa('settings.json sem permissão de escrita');
    }
    let texto;
    let atual;
    try {
      texto = readFileSync(arquivo, 'utf8');
      atual = texto.trim() === '' ? {} : JSON.parse(texto);
    } catch (e) {
      return recusa(`settings.json não é JSON puro (inválido ou com comentário: ${String(e.message).split('\n')[0]})`);
    }
    if (!ehObjeto(atual)) return recusa('a raiz de settings.json não é um objeto');
    if (atual.permissions !== undefined && !ehObjeto(atual.permissions)) return recusa('`permissions` em settings.json não é um objeto');
    const deny = atual.permissions?.deny;
    if (deny !== undefined && !Array.isArray(deny)) return recusa('`permissions.deny` em settings.json não é uma lista');
    novas = DENY_GUARDA.filter((e) => !(deny ?? []).includes(e));
    if (novas.length === 0) return { acao: 'igual', novas: [] };
    const m = /^([ \t]+)"/m.exec(texto);
    if (m) indent = m[1];
    if (texto.length > 0 && !texto.endsWith('\n')) fim = '';
    alvo = { ...atual, permissions: { ...(atual.permissions ?? {}), deny: [...(deny ?? []), ...novas] } };
    acao = 'emendado';
  }
  if (dryRun) return { acao, novas, dryRun: true };
  let criouTmp = false;
  try {
    if (!stDir) mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(alvo, null, indent)}${fim}`, { flag: 'wx', mode: st ? st.mode & 0o777 : 0o644 });
    criouTmp = true;
    renameSync(tmp, arquivo);
  } catch (e) {
    if (criouTmp) {
      try {
        unlinkSync(tmp); // só o .tmp que ESTA chamada criou
      } catch {
        /* já foi embora */
      }
    }
    return recusa(`não consegui escrever (${e.code ?? e.message})`);
  }
  return { acao, novas };
}


function mainDenyGuarda(root, dryRun) {
  const r = aplicarDenyGuarda(root, { dryRun });
  const alvo = SETTINGS_FILE;
  if (r.acao === 'recusado') {
    console.log(`[ONB-7] ${alvo} NÃO escrito — ${r.motivo}`);
    console.log(`  Não toquei no arquivo. Cole você mesmo na raiz de ${alvo} (a linha já traz a chave "permissions"; se o arquivo já tem uma, acrescente estas entradas ao seu "deny" em vez de repetir a chave):`);
    console.log(`    ${r.linha}`);
    process.exit(0);
  }
  if (dryRun) console.log(`[ONB-7] dry-run — ${alvo} não foi escrito (${r.acao})`);
  else if (r.acao === 'igual') console.log(`[ONB-7] ${alvo} sem mudanças (a lista da guarda já estava lá)`);
  else console.log(`[ONB-7] ${alvo} ${r.acao === 'criado' ? 'criado' : 'atualizado'}`);
  for (const e of r.novas ?? []) console.log(`  + permissions.deny += ${JSON.stringify(e)}`);
  process.exit(0);
}

function main(argv) {
  const root = arg(argv, 'root') ? resolve(arg(argv, 'root')) : raizDoRepo();
  const dryRun = argv.includes('--dry-run');
  if (argv.includes('--deny-guarda')) mainDenyGuarda(root, dryRun);
  const iSet = argv.indexOf('--set');
  const settings = arg(argv, 'settings');
  if (iSet === -1 && settings === undefined) {
    console.error("uso: onboarding-config.mjs [--root <dir>] --set <fluxo|versionamento|orquestracao|contexto> '<json>' | --settings '<json>' | --deny-guarda [--dry-run]");
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
      // F2-R8: exit 0 continua (contrato), mas o stdout também ganha a linha — quem decide
      // pelo resultado (a skill da fase 5) lê stdout, não stderr.
      console.log(`[ONB-7] ${alvo} NÃO escrito — JSON inválido (fail-open declarado, G9)`);
      process.exit(0);
    }
    if (e instanceof RangeError) {
      console.error(`[ONB-7] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(dryRun ? `[ONB-7] dry-run — ${alvo} não foi escrito` : r.diff.length ? `[ONB-7] ${alvo} atualizado` : `[ONB-7] ${alvo} sem mudanças`);
  for (const c of r.removidas ?? []) console.log(`[ONB-7] chave removida na 2.0, ignorada: ${c}`);
  for (const l of r.diff) console.log(`  ${l}`);
  process.exit(0);
}

if (ehEntrypoint(import.meta.url)) main(process.argv.slice(2));

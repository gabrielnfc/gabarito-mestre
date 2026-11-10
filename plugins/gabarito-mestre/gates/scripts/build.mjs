#!/usr/bin/env node
/**
 * build.mjs — gera gates/dist/*.js a partir de gates/src/*.ts (sem dependência).
 *
 * USO
 *   node scripts/build.mjs                grava dist/<MODULOS>.js
 *   node scripts/build.mjs --check        compara em memória; sai 1 listando divergências
 *   node scripts/build.mjs --raiz <dir>   usa <dir>/src e <dir>/dist (testes)
 *
 * Remove os tipos com `stripTypeScriptTypes(fonte, { mode: 'strip' })` e reescreve
 * `./x.ts` para `./x.js` nos imports. Determinístico: o CI roda `--check` em Node 22.
 * Suprime `ExperimentalWarning`.
 */

import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const emitOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const tipo = typeof resto[0] === 'string' ? resto[0] : resto[0]?.type;
  if (tipo === 'ExperimentalWarning') return;
  return emitOriginal.call(process, aviso, ...resto);
};

export const MODULOS = ['aneis', 'classificar-alvo', 'decidir', 'diario-puro', 'diario', 'guarda', 'plano', 'loop', 'pouso', 'formas', 'sombra', 'emenda', 'entrega', 'painel', 'painel-equipe', 'painel-largura', 'painel-formato', 'painel-texto', 'painel-esquadrao', 'painel-executivo', 'painel-hora', 'aprendizado', 'pendencias', 'registro'];

export function reescreverImports(js) {
  return js
    .replace(/(\bfrom\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2')
    .replace(/(\bimport\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2');
}

export function gerar(raiz) {
  const saidas = new Map();
  for (const nome of MODULOS) {
    const fonte = readFileSync(join(raiz, 'src', `${nome}.ts`), 'utf8');
    const js = stripTypeScriptTypes(fonte, { mode: 'strip' });
    saidas.set(join(raiz, 'dist', `${nome}.js`), reescreverImports(js));
  }
  return saidas;
}

function principal() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const i = args.indexOf('--raiz');
  const raiz = i >= 0 ? resolve(args[i + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..');
  const saidas = gerar(raiz);
  if (check) {
    const divergentes = [];
    for (const [caminho, js] of saidas) {
      if (!existsSync(caminho) || readFileSync(caminho, 'utf8') !== js) divergentes.push(caminho);
    }
    if (divergentes.length) {
      console.error(`dist fora de dia (${divergentes.length}):\n${divergentes.map((c) => `  ${c}`).join('\n')}\nrode: node gates/scripts/build.mjs`);
      process.exit(1);
    }
    console.log(`dist em dia (${saidas.size} arquivos)`);
    return;
  }
  mkdirSync(join(raiz, 'dist'), { recursive: true });
  for (const [caminho, js] of saidas) writeFileSync(caminho, js);
  console.log(`dist gerado (${saidas.size} arquivos)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();

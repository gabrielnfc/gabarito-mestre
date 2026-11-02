/**
 * Testes do build de dist (gates/scripts/build.mjs).
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  alterar 1 byte de dist/*.js ⇒ `dist-em-dia` falha
 *  M2  não reescrever `./x.ts` ⇒ `build-reescreve-import` falha
 *  M3  `--check` sempre sair 0 ⇒ `build-check-detecta-divergencia` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(GATES, 'scripts', 'build.mjs');

function rodar(args) {
  return spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8' });
}

function projetoTemporario() {
  const raiz = mkdtempSync(join(tmpdir(), 'gm-build-'));
  mkdirSync(join(raiz, 'src'));
  writeFileSync(
    join(raiz, 'src', 'classificar-alvo.ts'),
    "import type { Tipo } from './tipos.ts';\nexport function f(x: Tipo): string { return String(x); }\n",
  );
  writeFileSync(
    join(raiz, 'src', 'decidir.ts'),
    "import { f } from './classificar-alvo.ts';\nexport const g = (n: number): string => f(n as never);\n",
  );
  writeFileSync(join(raiz, 'src', 'diario.ts'), 'export const h = (n: number): number => n + 1;\n');
  writeFileSync(join(raiz, 'src', 'guarda.ts'), "import './diario.ts';\nexport const i: number = 1;\n");
  return raiz;
}

describe('build de dist', () => {
  test('build-reescreve-import: ./x.ts vira ./x.js e os tipos somem', () => {
    const raiz = projetoTemporario();
    const r = rodar(['--raiz', raiz]);
    assert.equal(r.status, 0, r.stderr);
    const decidir = readFileSync(join(raiz, 'dist', 'decidir.js'), 'utf8');
    assert.match(decidir, /from ['"]\.\/classificar-alvo\.js['"]/);
    assert.doesNotMatch(decidir, /\.ts['"]/);
    assert.doesNotMatch(decidir, /: number|: string/);
    const guarda = readFileSync(join(raiz, 'dist', 'guarda.js'), 'utf8');
    assert.match(guarda, /import ['"]\.\/diario\.js['"]/);
    assert.equal(r.stderr.includes('ExperimentalWarning'), false);
  });

  test('build-check-detecta-divergencia: --check sai 1 e lista o arquivo alterado', () => {
    const raiz = projetoTemporario();
    assert.equal(rodar(['--raiz', raiz]).status, 0);
    assert.equal(rodar(['--raiz', raiz, '--check']).status, 0);
    const alvo = join(raiz, 'dist', 'diario.js');
    writeFileSync(alvo, readFileSync(alvo, 'utf8') + '// adulterado\n');
    const r = rodar(['--raiz', raiz, '--check']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /diario\.js/);
  });

  test('build-check-detecta-divergencia: dist ausente também diverge', () => {
    const raiz = projetoTemporario();
    const r = rodar(['--raiz', raiz, '--check']);
    assert.equal(r.status, 1);
  });

  test('dist-em-dia: o dist commitado confere com src (node scripts/build.mjs --check)', () => {
    const r = rodar(['--check']);
    assert.equal(r.status, 0, r.stderr);
  });
});

/**
 * Testes do pacote dos gates — o que o instalador copia e o que o `bin` promete.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  voltar `version` a 1.0.0
 *  M2  apontar um `bin` para arquivo inexistente
 *  M3  acrescentar uma dependência (zero dependência é contrato)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(GATES, 'package.json'), 'utf8'));

describe('gates/package.json 1.1.0', () => {
  test('version é 1.1.0 (PKG-1: alinhado ao plugin na fase 6)', () => {
    assert.equal(pkg.version, '1.1.0');
  });
  test('todo bin aponta para um script existente e os quatro novos estão lá', () => {
    for (const [nome, rel] of Object.entries(pkg.bin)) assert.ok(existsSync(join(GATES, rel)), `${nome} → ${rel}`);
    for (const nome of ['harness-onboarding-config', 'harness-capacidade', 'harness-versionamento-check', 'harness-cartao-sessao', 'harness-doctor']) {
      assert.ok(pkg.bin[nome], nome);
    }
  });
  test('zero dependências e Node ≥ 22.18', () => {
    assert.deepEqual(pkg.dependencies, {});
    assert.deepEqual(pkg.devDependencies, {});
    assert.equal(pkg.engines.node, '>=22.18');
  });
  test('npm test cobre todos os .test.mjs (glob) e existe o script versionamento', () => {
    assert.match(pkg.scripts['test:mjs'], /test\/\*\.test\.mjs/);
    assert.match(pkg.scripts.versionamento, /versionamento-check\.mjs/);
  });
  test('todo script novo tem o cabeçalho JSDoc com USO (mesmo estilo do doctor)', () => {
    for (const f of ['onboarding-config.mjs', 'capacidade.mjs', 'versionamento-check.mjs', 'cartao-sessao.mjs']) {
      const t = readFileSync(join(GATES, 'scripts', f), 'utf8');
      assert.ok(t.startsWith('#!/usr/bin/env node\n/**'), `${f} sem shebang + JSDoc`);
      assert.match(t, /\n \* USO\n/, `${f} sem bloco USO`);
      assert.match(t, /fail-open declarado \(G9\)/, `${f} sem fail-open declarado`);
    }
  });
});

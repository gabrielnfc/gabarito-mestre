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

const RAIZ = join(GATES, '..', '..', '..');
// Na cópia instalada em tools/gabarito-gates não existe plugin.json nem marketplace.json: esses testes só valem no repo do plugin.
const PLUGIN_JSON = join(GATES, '..', '.claude-plugin', 'plugin.json');
const MKT_JSON = join(RAIZ, '.claude-plugin', 'marketplace.json');
const noPlugin = existsSync(PLUGIN_JSON) ? false : 'fora do repo do plugin';
const noMkt = existsSync(MKT_JSON) ? false : 'fora do repo do plugin';
const ler = (p) => JSON.parse(readFileSync(p, 'utf8'));

describe('gates/package.json 1.1.0', () => {
  test('version é 2.0.0-alpha.1 (canal next)', () => {
    assert.equal(pkg.version, '2.0.0-alpha.1');
  });
  test('version do plugin.json igual à dos gates', { skip: noPlugin }, () => {
    assert.equal(ler(PLUGIN_JSON).version, pkg.version);
  });
  test('marketplace-name-next: catálogo do canal next não conflita com o gabarito-mestre estável', { skip: noMkt }, () => {
    assert.equal(ler(MKT_JSON).name, 'gabarito-mestre-next');
  });
  test('versão só no plugin.json (doc oficial); entrada do marketplace não duplica', { skip: noMkt }, () => {
    assert.equal(ler(MKT_JSON).plugins[0].version, undefined);
  });
  test('medido-em.json registra a versão do Claude Code do spike (Q12)', () => {
    const m = JSON.parse(readFileSync(join(GATES, 'medido-em.json'), 'utf8'));
    assert.match(m.claudeCode, /^\d+\.\d+\.\d+$/);
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

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
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(GATES, 'package.json'), 'utf8'));

// Só é "repo do plugin" se a raiz tiver plugins/gabarito-mestre/.claude-plugin/plugin.json. Na cópia instalada
// (tools/gabarito-gates) o pai pode ter um marketplace.json alheio: não basta existir o arquivo.
const ehRepoDoPlugin = (raiz) => existsSync(join(raiz, 'plugins', 'gabarito-mestre', '.claude-plugin', 'plugin.json'));
const RAIZ = join(GATES, '..', '..', '..');
const PLUGIN_JSON = join(RAIZ, 'plugins', 'gabarito-mestre', '.claude-plugin', 'plugin.json');
const MKT_JSON = join(RAIZ, '.claude-plugin', 'marketplace.json');
const MEDIDO = join(RAIZ, 'plugins', 'gabarito-mestre', 'medido-em.json');
const fora = ehRepoDoPlugin(RAIZ) ? false : 'fora do repo do plugin';
const noPlugin = fora, noMkt = fora;
const ler = (p) => JSON.parse(readFileSync(p, 'utf8'));

describe('ehRepoDoPlugin — cópia instalada sob um pai com marketplace.json alheio', () => {
  test('pai/.claude-plugin/marketplace.json sem plugins/gabarito-mestre não é repo do plugin', () => {
    const pai = mkdtempSync(join(tmpdir(), 'gm-pkg-'));
    mkdirSync(join(pai, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pai, '.claude-plugin', 'marketplace.json'), '{"name":"alheio"}');
    assert.equal(ehRepoDoPlugin(pai), false);
    mkdirSync(join(pai, 'plugins', 'gabarito-mestre', '.claude-plugin'), { recursive: true });
    writeFileSync(join(pai, 'plugins', 'gabarito-mestre', '.claude-plugin', 'plugin.json'), '{}');
    assert.equal(ehRepoDoPlugin(pai), true);
  });
});

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
  test('medido-em.json (raiz do plugin, fora de gates/) registra a versão do Claude Code do spike (Q12)', { skip: fora }, () => {
    const m = ler(MEDIDO);
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

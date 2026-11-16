import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { raizSegura, raizesDeCheckout, raizDeTeste } from './_raiz-segura.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

test('raiz-segura-recusa-checkout: a raiz do checkout e um ancestral dela são recusados', () => {
  const [co] = raizesDeCheckout();
  assert.ok(co, 'o teste roda dentro de um checkout git');
  assert.throws(() => raizSegura(co), /raiz de teste é a do checkout/);
  assert.throws(() => raizSegura(join(co, 'gates', '..')), /do checkout/);
  assert.throws(() => raizSegura(dirname(co)), /do checkout/, 'ancestral contém o checkout');
  assert.throws(() => raizSegura(AQUI, { checkouts: [AQUI] }), /do checkout/);
});

test('raiz-segura-recusa-o-checkout-principal-e-o-worktree', () => {
  assert.throws(() => raizSegura('/a/b', { checkouts: ['/a/b'] }), /do checkout/);
  const tmp = mkdtempSync(join(tmpdir(), 'raiz-seg-'));
  assert.throws(() => raizSegura(tmp, { checkouts: ['/x', tmp] }), /do checkout/, 'qualquer das raízes');
});

test('raiz-segura-aceita-mkdtemp', () => {
  const d = mkdtempSync(join(tmpdir(), 'raiz-seg-'));
  assert.equal(raizSegura(d), d);
  assert.equal(raizDeTeste(() => d), d);
});

test('raiz-segura-recusa-vazio', () => {
  assert.throws(() => raizSegura(''), /ausente/);
  assert.throws(() => raizSegura(undefined), /ausente/);
});

test('raiz-segura-recusa-subdiretorio-do-checkout: gates/, ".", ".." e .claude-tmp (medir/loop acham a raiz pelo git-common-dir a partir do cwd)', () => {
  const [co] = raizesDeCheckout();
  assert.throws(() => raizSegura(AQUI), /do checkout/, 'subdiretório gates/test');
  assert.throws(() => raizSegura(join(co, 'plugins', 'gabarito-mestre', 'gates')), /do checkout/);
  assert.throws(() => raizSegura(join(co, '.claude-tmp')), /do checkout/, 'inexistente: ainda dentro do checkout');
  assert.throws(() => raizSegura(process.cwd()), /do checkout/, 'cwd do npm test');
  assert.throws(() => raizSegura('.'), /do checkout/);
  assert.throws(() => raizSegura('..'), /do checkout/);
  assert.throws(() => raizSegura('/a/b/c/d', { checkouts: ['/a/b'] }), /do checkout/);
  assert.equal(raizSegura('/a/bc', { checkouts: ['/a/b'] }), '/a/bc', 'prefixo de texto não é subdiretório');
});

test('raiz-segura-resolve-symlink-dos-dois-lados: checkout injetado via symlink e raiz via symlink', () => {
  const real = realpathSync(mkdtempSync(join(tmpdir(), 'raiz-seg-')));
  const ln = join(real, '..', `ln-${process.pid}-${Date.now()}`);
  symlinkSync(real, ln);
  assert.throws(() => raizSegura(real, { checkouts: [ln] }), /do checkout/, 'checkout dado pelo symlink, raiz pelo real');
  assert.throws(() => raizSegura(ln, { checkouts: [real] }), /do checkout/, 'raiz dada pelo symlink, checkout pelo real');
  assert.throws(() => raizSegura(join(ln, 'sub'), { checkouts: [real] }), /do checkout/, 'subdiretório via symlink de um ancestral existente');
  const outro = mkdtempSync(join(tmpdir(), 'raiz-seg-'));
  assert.equal(raizSegura(outro, { checkouts: [ln] }), outro, 'controle: raiz sem relação é aceita');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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

/**
 * T14b (review final, MINOR 4): `mod-test.sh` tem teto de tempo. Comando que trava (e deixa um filho segurando a saída) vira FALHA com `mod-test: timeout`,
 * dentro do teto, não um job pendurado. Mutação: sem o `alarm`/o `kill` do grupo, este teste não termina em tempo ou vê exit 0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'test', 'mod-test.sh');
const roda = (env) => {
  const t0 = Date.now();
  const r = spawnSync('bash', [SCRIPT], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000 });
  return { ...r, ms: Date.now() - t0 };
};

test('mod-test-timeout: comando que trava (com filho segurando o pipe) ⇒ exit 1 e `mod-test: timeout` dentro do teto, não pendurado', () => {
  const r = roda({ MOD_TEST_TIMEOUT: '2', MOD_TEST_CMD: 'sleep 20 & wait' });
  assert.equal(r.error, undefined, `o runner não terminou: ${String(r.error)}`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /mod-test: timeout \(> 2s\)/);
  assert.ok(r.ms < 15_000, `levou ${r.ms} ms`);
});

test('mod-test-timeout-nao-mata-quem-termina: comando que passa dentro do teto segue o fluxo normal', () => {
  const ok = roda({ MOD_TEST_TIMEOUT: '20', MOD_TEST_CMD: 'echo "(pass) x"' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const falha = roda({ MOD_TEST_TIMEOUT: '20', MOD_TEST_CMD: 'echo "(pass) x"; echo "(fail) y [1ms]"' });
  assert.equal(falha.status, 1);
  const semPass = roda({ MOD_TEST_TIMEOUT: '20', MOD_TEST_CMD: 'echo nada' });
  assert.equal(semPass.status, 1);
});

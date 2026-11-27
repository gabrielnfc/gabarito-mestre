// GM-21 T4 (REQ-CNT-1, P9): o `loop.mjs integrar` real (sem `opcoes.avaliar` injetado) le o resumo do vitest/jest.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_PADRAO, ambiente } from './_loop-cli-helpers.mjs';

const comSuite = (cmd) => ambiente({ config: { ...CONFIG_PADRAO, gates: { suites: [cmd] } } });

describe('integrar real com a saida do vitest', () => {
  test('vitest-verde-integra', () => {
    const amb = comSuite("printf ' Test Files  1 passed (1)\\n      Tests  3 passed (3)\\n'");
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.ok(amb.tipos().includes('task.integrada'));
  });

  test('vitest-1-failed-com-rc-0-reprova-pela-saida', () => {
    const amb = comSuite("printf '      Tests  1 failed | 2 passed (3)\\n'");
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.ok(r.j.relato.some((l) => /rc=0 mas a saída declara fail 1/.test(l)), JSON.stringify(r.j.relato));
  });

  test('vitest-1-failed-com-rc-1-reprova', () => {
    const amb = comSuite("printf ' Test Files  1 failed (1)\\n      Tests  1 failed | 2 passed (3)\\n'; exit 1");
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.merge, false);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('suite-node-com-linha-Tests-failed-de-fixture-segue-verde', () => {
    const amb = comSuite("printf '      Tests  1 failed (fixture)\\n# tests 2\\n# pass 2\\n# fail 0\\n'");
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
  });
});

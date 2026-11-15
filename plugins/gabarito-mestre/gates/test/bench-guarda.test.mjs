// bench-guarda: decisão pura sobre medições injetadas (REQ-CI-1). Nenhum teste lê relógio nem roda a guarda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidir, resumo } from '../scripts/bench-guarda.mjs';

const r = (p95) => ({ n: 20, p50: p95 / 2, p95, max: p95 });
// fila de medições injetadas; cada chamada consome uma e conta
function fonte(...medicoes) {
  let chamadas = 0;
  const medir = () => {
    const m = medicoes[Math.min(chamadas, medicoes.length - 1)];
    chamadas++;
    return { piso: r(m[0]), guarda: r(m[1]) };
  };
  return { medir, chamadas: () => chamadas };
}

test('bench-desconta-piso: CI reprova pelo excesso, não pelo p95 bruto', () => {
  // guarda 300 passa de qualquer teto bruto, mas o piso do runner é 200: excesso 100 <= 240
  const f = fonte([200, 300]);
  const v = decidir(f.medir, { limiteExcesso: 240 });
  assert.equal(v.ok, true);
  assert.equal(v.excesso, 100);
  assert.equal(v.piso.p95, 200);
  assert.equal(f.chamadas(), 1, 'dentro do limite não repete');
  // e o contrário: p95 bruto baixo, mas excesso acima do limite reprova
  const g = fonte([10, 300]);
  assert.equal(decidir(g.medir, { limiteExcesso: 240 }).ok, false);
});

test('bench-repete-1x: estourou na 1ª, passou na 2ª ⇒ aprova com 2 medições', () => {
  const f = fonte([50, 400], [50, 120]);
  const v = decidir(f.medir, { limiteExcesso: 240 });
  assert.equal(v.ok, true);
  assert.equal(v.tentativas.length, 2);
  assert.equal(v.excesso, 70, 'vale a medição que decidiu');
  assert.equal(f.chamadas(), 2);
});

test('bench-reprova-2-estouros: nunca mede uma 3ª vez', () => {
  const f = fonte([50, 400], [50, 390], [50, 100]);
  const v = decidir(f.medir, { limiteExcesso: 240 });
  assert.equal(v.ok, false);
  assert.equal(v.tentativas.length, 2);
  assert.equal(f.chamadas(), 2, 'repete exatamente 1 vez');
});

test('bench-local-absoluto-60: sem limite de excesso o p95 bruto vale e não repete', () => {
  const f = fonte([40, 61], [40, 10]);
  const v = decidir(f.medir, { limite: 60 });
  assert.equal(v.ok, false);
  assert.equal(f.chamadas(), 1, 'local não repete');
  assert.equal(decidir(fonte([40, 60]).medir, { limite: 60 }).ok, true);
  // piso alto não desconta no modo absoluto
  assert.equal(decidir(fonte([100, 120]).medir, { limite: 60 }).ok, false);
});

test('sem limite nenhum só informa', () => {
  assert.equal(decidir(fonte([1, 999]).medir, {}).ok, true);
});

test('resumo: p95 de 20 amostras é a 19ª ordenada', () => {
  const a = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(resumo(a).p95, 19);
});

// CLI real: o script roda com a flag de verdade e o exit code é o contrato da CI (ci.yml).
const SCRIPT = fileURLToPath(new URL('../scripts/bench-guarda.mjs', import.meta.url));
const roda = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000 });

test('cli: --limite-excesso estourado sai 1 e repete (guarda é sempre mais lenta que o piso, limite 0,001 não depende de carga)', () => {
  const r = roda('--n', '2', '--limite-excesso', '0.001');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /limite excesso 0.001 ms: ESTOUROU/);
  assert.match(r.stdout, /2 medições/);
});

test('cli: --limite-excesso folgado sai 0', () => {
  const r = roda('--n', '2', '--limite-excesso', '1000000');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /limite excesso 1000000 ms: ok/);
});

test('cli: roda por symlink (entrypoint) — --n 0 sai 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-bench-link-'));
  const link = join(dir, 'bench.mjs');
  symlinkSync(SCRIPT, link);
  const r = spawnSync(process.execPath, [link, '--n', '0'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /uso:/);
});

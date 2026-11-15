// bench-guarda: decisão pura sobre medições injetadas (REQ-CI-1). Nenhum teste lê relógio nem roda a guarda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

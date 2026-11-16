/**
 * Doctor: autonomia (GM-15 T15, REQ-AUT-2 b; condição 4). Mostra as 4 chaves, "autonomia mista" e o descompasso nos dois sentidos
 * entre o que o projeto pede (`guarda.autonomia` de origin/HEAD) e o que esta máquina liga (`~/.claude/gabarito-autonomia.json`).
 *
 * MUTAÇÕES PRESCRITAS:
 *  D1  mostrar só 3 das 4 chaves ⇒ `doctor-mostra-as-quatro` falha
 *  D2  não acusar o descompasso "config pede e a máquina não liga" ⇒ `doctor-descompasso-autonomia` falha
 *  D3  não acusar o descompasso "a máquina liga e a config não pede" ⇒ `doctor-descompasso-autonomia` falha
 *  D4  chamar de mista uma config que bate com uma das 3 respostas ⇒ `doctor-autonomia-mista` falha
 *  D5  ler `guarda.autonomia` da árvore local em vez de origin/HEAD ⇒ `doctor-autonomia-arvore-local-nao-conta` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as doctor from '../scripts/harness-doctor.mjs';
import { SCRIPT, repoComOrigin } from './_doctor-helpers.mjs';

const home = (ligado) => {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'doctor-home-')));
  if (ligado !== undefined) {
    mkdirSync(join(h, '.claude'));
    writeFileSync(join(h, '.claude', 'gabarito-autonomia.json'), ligado ? '{"orquestrador":true}' : '{"orquestrador":false}');
  }
  return h;
};
const cfg = (e, g, j, l) => ({ entrega: { autonomia: e }, guarda: { autonomia: g }, sombra: { julga_emendas: j, libera_teto: l } });
const R1 = cfg(false, 'nenhuma', false, false);
const R2 = cfg(false, 'orquestrador', true, true);
const R3 = cfg(true, 'orquestrador', true, true);
const texto = (dir, h) => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: h } }).stdout;
const autonomia = (dir, ligado) => doctor.autonomiaDoProjeto(dir, { interruptor: ligado });

describe('doctor — autonomia (REQ-AUT-2 b)', () => {
  test('doctor-mostra-as-quatro: as 4 chaves e o interruptor aparecem no texto', () => {
    const dir = repoComOrigin({ origem: R3 });
    const t = texto(dir, home(true));
    for (const k of ['entrega.autonomia', 'guarda.autonomia', 'sombra.julga_emendas', 'sombra.libera_teto']) assert.match(t, new RegExp(k.replace('.', '\\.')), k);
    assert.match(t, /interruptor desta máquina: ligado/);
    const j = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home(true) } }).stdout);
    assert.deepEqual(j.autonomia.chaves, { 'entrega.autonomia': true, 'guarda.autonomia': 'orquestrador', 'sombra.julga_emendas': true, 'sombra.libera_teto': true });
  });

  test('doctor-descompasso-autonomia: config pede e a máquina não liga', () => {
    const dir = repoComOrigin({ origem: R2 });
    const a = autonomia(dir, false);
    assert.equal(a.descompasso, 'config-sem-maquina');
    const t = texto(dir, home(false));
    assert.match(t, /DESCOMPASSO/);
    assert.match(t, /o projeto pede autonomia, mas esta máquina não a liga/);
    assert.match(t, /interruptor desta máquina: desligado/);
  });

  test('doctor-descompasso-autonomia: a máquina liga e a config não pede', () => {
    for (const origem of [R1, { entrega: { autonomia: false } }]) {
      const dir = repoComOrigin({ origem });
      assert.equal(autonomia(dir, true).descompasso, 'maquina-sem-config', JSON.stringify(origem));
      const t = texto(dir, home(true));
      assert.match(t, /DESCOMPASSO/);
      assert.match(t, /esta máquina liga a autonomia, mas o projeto não a pede/);
    }
  });

  test('doctor-sem-descompasso: os dois ligados ou os dois desligados', () => {
    assert.equal(autonomia(repoComOrigin({ origem: R2 }), true).descompasso, null);
    assert.equal(autonomia(repoComOrigin({ origem: R1 }), false).descompasso, null);
    assert.doesNotMatch(texto(repoComOrigin({ origem: R2 }), home(true)), /DESCOMPASSO/);
    assert.doesNotMatch(texto(repoComOrigin({ origem: R1 }), home()), /DESCOMPASSO/);
  });

  test('doctor-autonomia-respostas: as 3 respostas da T14 não são mistas', () => {
    assert.deepEqual([R1, R2, R3].map((c) => autonomia(repoComOrigin({ origem: c }), false)).map((a) => [a.resposta, a.mista]), [[1, false], [2, false], [3, false]]);
    assert.match(texto(repoComOrigin({ origem: R2 }), home(true)), /Autonomia: trabalha sozinha, espera o seu ok para publicar/);
  });

  test('doctor-autonomia-mista: chaves que não batem com nenhuma resposta', () => {
    for (const c of [cfg(true, 'nenhuma', false, false), cfg(false, 'orquestrador', true, false), cfg(false, 'nenhuma', true, false), cfg(false, 'orquestrador', false, false)]) {
      const dir = repoComOrigin({ origem: c });
      const a = autonomia(dir, false);
      assert.equal(a.mista, true, JSON.stringify(c));
      assert.equal(a.resposta, null);
      assert.match(texto(dir, home(false)), /autonomia mista/);
    }
  });

  test('doctor-autonomia-sem-chaves: config sem as chaves é o padrão (resposta 1), nunca mista', () => {
    const a = autonomia(repoComOrigin({ origem: { versionamento: { branchPadrao: 'main' } } }), false);
    assert.deepEqual([a.resposta, a.mista, a.descompasso], [1, false, null]);
  });

  test('doctor-autonomia-arvore-local-nao-conta: guarda.autonomia só na árvore local não é o que a guarda lê', () => {
    const dir = repoComOrigin({ origem: R1, local: R2 });
    const a = autonomia(dir, true);
    assert.equal(a.chaves['guarda.autonomia'], 'nenhuma');
    assert.equal(a.descompasso, 'maquina-sem-config');
  });

  test('doctor-autonomia-valor-invalido: guarda.autonomia inválida vale "nenhuma"', () => {
    for (const v of ['sim', true, 1, 'ORQUESTRADOR']) {
      const a = autonomia(repoComOrigin({ origem: cfg(false, v, false, false) }), true);
      assert.equal(a.chaves['guarda.autonomia'], 'nenhuma', JSON.stringify(v));
      assert.equal(a.descompasso, 'maquina-sem-config');
    }
  });
});

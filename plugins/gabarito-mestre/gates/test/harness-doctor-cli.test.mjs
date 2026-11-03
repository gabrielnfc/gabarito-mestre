/** Testes do harness-doctor — T6 CLI. Cabeçalho (mutações prescritas) e helpers em _doctor-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as doctor from '../scripts/harness-doctor.mjs';
import { repo, agents, SCRIPT, ok, git, repoComGit, hb, CFG_GUARDA, camada, arq, ARQ_DIARIO } from './_doctor-helpers.mjs';

describe('T6 doctor — CLI', () => {
  test('doctor-json-expoe-camada-e-perfil: --json traz camada {estado,heartbeatHa,fonte,divergente,ambientes} e perfil', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app', ...CFG_GUARDA }) });
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(j.camada).sort(), ['ambientes', 'diario', 'divergente', 'estado', 'fonte', 'heartbeatHa']);
    assert.equal(j.camada.estado, 'configurada');
    assert.deepEqual(j.camada.ambientes, ['teste', 'prod']);
    assert.equal(j.perfil, 'repo-sem-app');
  });

  test('doctor-render-camada-diario: diário de outro autor aparece como anotação em configurada, nunca como ativa', () => {
    const ts = new Date(Date.now() - 20 * 3_600_000).toISOString();
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify(CFG_GUARDA), [ARQ_DIARIO]: `${hb(ts, { autor: 'colega@x' })}\n` });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /Camada de guarda: configurada .*diário com heartbeat há 20 h \(colega@x/);
    assert.doesNotMatch(r.stdout, /Camada de guarda: ativa/);
    assert.doesNotMatch(r.stdout, /veio pelo git/, 'M2: o doctor não sabe a origem; afirmar "veio pelo git" pode ser falso');
  });

  test('doctor-render-camada: texto mostra camada, fonte, ambientes e perfil; n/a aparece como n/a, não como ok', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app', ...CFG_GUARDA }) });
    const ts = new Date(Date.now() - 2 * 3_600_000).toISOString();
    arq(dir, ARQ_DIARIO, `${hb(ts)}\n`);
    arq(dir, '.harness/heartbeat.json', JSON.stringify({ ts, sessao: 's1', arquivo: ARQ_DIARIO }));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /Camada de guarda: ativa \(heartbeat há 2 h\) · fonte local/);
    assert.match(r.stdout, /Ambientes declarados: teste, prod/);
    assert.match(r.stdout, /Perfil: repo-sem-app/);
    assert.match(r.stdout, / n\/a .*guarda de mutação em massa/);
  });
});

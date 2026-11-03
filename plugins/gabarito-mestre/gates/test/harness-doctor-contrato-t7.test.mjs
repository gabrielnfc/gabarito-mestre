/** Testes do harness-doctor — contrato T6 x T7. Cabeçalho (mutações prescritas) e helpers em _doctor-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../scripts/harness-doctor.mjs';
import * as doctor from '../scripts/harness-doctor.mjs';
import * as onboarding from '../scripts/onboarding-config.mjs';
const DENY_GUARDA = onboarding.DENY_GUARDA ?? [];
import { repo, hoje, SCRIPT, ok, git, CFG_GUARDA, camada } from './_doctor-helpers.mjs';

describe('contrato T6 × T7 — SessionStart real (cartao-sessao.mjs --hook) e o doctor concordam no marcador', () => {
  const HOOK = join(dirname(SCRIPT), 'cartao-sessao.mjs');
  const camadaGuardaReal = (dir) => doctor.camadaGuarda(dir, Date.now());
  const pluginFalso = () => repo({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'gabarito-mestre', version: '2.0.0' }) });
  const CONFIG_ONB = { fluxo: { ferramenta: 'arquivos', resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' }, versionamento: { resolvidoEm: hoje }, ...CFG_GUARDA };
  /** Repo onboarded como o instalador deixa: config versionada, marcador ignorado, na branch de um PBI. */
  function repoOnboarded() {
    const dir = repo({ 'harness.config.json': JSON.stringify(CONFIG_ONB), '.gitignore': '.harness/doctor-cache.json\n.harness/fluxo-cache.json\n.harness/entregas/_sem-id/\n.harness/heartbeat.json\n' });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: onboarding');
    git(dir, 'checkout', '-q', '-b', 'feat/GM-1-contrato');
    return dir;
  }
  const dispara = (dir, entrada = { session_id: 's-contrato' }) => {
    const env = { ...process.env, GABARITO_INSTALLED_PLUGINS: '/nao/existe.json' };
    delete env.CLAUDE_PROJECT_DIR;
    return spawnSync(process.execPath, [HOOK, '--hook', '--root', dir, '--plugin-root', pluginFalso()], { cwd: dir, input: JSON.stringify(entrada), encoding: 'utf8', env, timeout: 15000 });
  };

  test('contrato-hook-ativa-clone-configurada: o hook real faz o doctor ler ativa; o clone do MESMO commit lê configurada (sem marcador)', () => {
    const dir = repoOnboarded();
    const h = dispara(dir);
    assert.equal(h.status, 0, h.stderr);
    assert.equal(existsSync(join(dir, '.harness', 'heartbeat.json')), true, 'o hook gravou o marcador');
    const viva = camadaGuardaReal(dir);
    assert.equal(viva.estado, 'ativa', JSON.stringify(viva));
    assert.ok(viva.heartbeatHa !== null && viva.heartbeatHa < 0.1, String(viva.heartbeatHa));
    assert.equal(run(dir).camada.estado, 'ativa');

    git(dir, 'add', '.harness/entregas');
    git(dir, 'commit', '-q', '-m', 'chore: diario');
    assert.equal(camadaGuardaReal(dir).estado, 'ativa', 'commitar o diário não tira a ativa: o marcador segue ignorado');

    const clone = join(mkdtempSync(join(tmpdir(), 'doctor-clone-')), 'c');
    git(dir, 'clone', '-q', dir, clone);
    assert.equal(existsSync(join(clone, '.harness', 'heartbeat.json')), false, 'marcador gitignored não viaja');
    const c = camadaGuardaReal(clone);
    assert.equal(c.estado, 'configurada', JSON.stringify(c));
    assert.equal(c.heartbeatHa, null);
    assert.ok(c.diario, 'o diário clonado vira anotação, nunca ativa');
  });

  test('contrato-hook-ativa-clone-configurada: marcador gravado pelo hook em outra sessão/ts não cruza com o diário alterado (campo renomeado derruba)', () => {
    const dir = repoOnboarded();
    assert.equal(dispara(dir).status, 0);
    const m = JSON.parse(readFileSync(join(dir, '.harness', 'heartbeat.json'), 'utf8'));
    for (const campo of ['ts', 'sessao', 'arquivo']) assert.equal(typeof m[campo], 'string', `o marcador do hook tem "${campo}"`);
    writeFileSync(join(dir, '.harness', 'heartbeat.json'), JSON.stringify({ ...m, sessao: 'outra' }));
    assert.notEqual(camadaGuardaReal(dir).estado, 'ativa');
  });
});

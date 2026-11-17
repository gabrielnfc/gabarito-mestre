/**
 * Critério ÚNICO de onboarding (GM-15 T23, REQ-HIG-1): o cartão (`cartao-sessao.mjs`), a guarda (`dist/guarda.js`) e a ponte do mod
 * (`pedidoOnboarding` de `mod/painel.mjs`) respondem igual para a mesma fixture: config só em origin/HEAD, só local, nenhuma, corrompida.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M23a cartão com o critério antigo (`fluxo.resolvidoEm` local) ⇒ `onboarding-criterio-unico` morre
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { raizSegura } from './_raiz-segura.mjs';
import { coletar, temOnboarding as cartao } from '../scripts/cartao-sessao.mjs';
import { temOnboarding as guarda } from '../dist/guarda.js';
import { pedidoOnboarding } from '../../mod/painel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_PLUGIN = join(AQUI, '..', '..');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' };
const git = (d, ...a) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8', env: ENV });
const base = realpathSync(mkdtempSync(join(tmpdir(), 'onb criterio ')));

let n = 0;
/** `origin`: conteúdo do config em refs/remotes/origin/HEAD (null = sem ref); `local`: conteúdo na árvore (null = sem arquivo). */
function fixture({ origin = null, local = null }) {
  const d = join(raizSegura(base), `r${n++}`);
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  if (origin !== null) writeFileSync(join(d, 'harness.config.json'), origin);
  git(d, 'add', '-A'); git(d, 'commit', '-q', '--allow-empty', '-m', 'ini');
  if (origin !== null) git(d, 'update-ref', 'refs/remotes/origin/HEAD', 'HEAD');
  if (local !== null) writeFileSync(join(d, 'harness.config.json'), local);
  else if (origin !== null) git(d, 'rm', '-q', '-f', 'harness.config.json');
  return d;
}
const ponte = (d) => {
  const p = pedidoOnboarding(d, RAIZ_PLUGIN);
  const r = spawnSync(p.argv[0], p.argv.slice(1), { input: p.stdin, encoding: 'utf8', cwd: d });
  return r.status === 0 ? JSON.parse(r.stdout).onboarding : null;
};
const opts = { agora: '2026-11-16T12:00:00Z' };
const leitores = (d) => ({ guarda: guarda(d), cartao: cartao(d), coletar: coletar(d, RAIZ_PLUGIN, opts).semOnboarding === false, ponte: ponte(d) });
const LOCAL_ANTIGO = '{"fluxo":{"resolvidoEm":"2026-11-01"}}';

describe('onboarding-criterio-unico', () => {
  const casos = [
    ['só origin/HEAD', { origin: '{}\n' }, true],
    ['só local (sem fluxo.resolvidoEm)', { local: '{}\n' }, true],
    ['só local (com fluxo.resolvidoEm)', { local: LOCAL_ANTIGO }, true],
    ['nenhum', {}, false],
    ['corrompido (local)', { local: '{"fluxo": ' }, false],
  ];
  for (const [nome, fx, esperado] of casos) {
    test(`os 4 leitores respondem ${esperado} para: ${nome}`, () => {
      const r = leitores(fixture(fx));
      assert.deepEqual(r, { guarda: esperado, cartao: esperado, coletar: esperado, ponte: esperado });
    });
  }
  test('local corrompido mas origin/HEAD válido ⇒ true nos 4 (a guarda manda)', () => {
    const r = leitores(fixture({ origin: '{}\n', local: '{"fluxo": ' }));
    assert.deepEqual(r, { guarda: true, cartao: true, coletar: true, ponte: true });
  });
  test('só origin/HEAD: o cartão sai completo, sem lançar e sem acusar config inválido', () => {
    const ctx = coletar(fixture({ origin: '{}\n' }), RAIZ_PLUGIN, opts);
    assert.equal(ctx.semOnboarding, false);
    assert.equal(ctx.configInvalido, false);
  });
});

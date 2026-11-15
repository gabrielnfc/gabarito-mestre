/**
 * GM-15 hotfix: o cartão (SessionStart) infere a entrega da branch pela MESMA regra do `loop.mjs` (`idDaBranch` + `idPadraoDe`).
 * Antes: `inferirPbi` exigia tipo na lista (hotfix fora) e o `sessao.inicio {clear}` ia a `_sem-id`; o pouso nunca fechava.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { append, ler, dirEntrega } from '../dist/diario.js';
import { pousoPendente } from '../dist/pouso-pendente.js';
import { idPadraoDe } from '../lib/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'cartao-sessao.mjs');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const CONFIG = JSON.stringify({
  fluxo: { ferramenta: 'arquivos', resolvidoEm: '2026-09-20', idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3, iniciativa: { id: 'INI-1' } },
  versionamento: { resolvidoEm: '2026-09-20' },
  orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: '2026-09-01', validadeDias: 90 }, paralelismo: { simultaneos: 2, teto: 4 } },
});
const repoNaBranch = (branch, config = CONFIG) => {
  const dir = mkdtempSync(join(tmpdir(), 'cartao-ent-'));
  writeFileSync(join(dir, 'harness.config.json'), config);
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
  git(dir, 'checkout', '-q', '-b', branch);
  return dir;
};
const plugin = () => {
  const p = mkdtempSync(join(tmpdir(), 'plug-'));
  mkdirSync(join(p, '.claude-plugin'), { recursive: true });
  writeFileSync(join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gabarito-mestre', version: '1.1.0' }));
  return p;
};
const hook = (dir, entrada) => {
  const env = { ...process.env, GABARITO_INSTALLED_PLUGINS: '/nao/existe.json' };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [SCRIPT, '--hook', '--root', dir, '--plugin-root', plugin(), '--agora', '2026-11-15T20:00:00Z'], { cwd: dir, input: JSON.stringify(entrada), encoding: 'utf8', env, timeout: 8000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* o teste assere */ }
  return { code: r.status, stderr: r.stderr, ctx: j?.hookSpecificOutput?.additionalContext ?? '', msg: j?.systemMessage ?? '' };
};
const ev = (sessao, tipo, dados, ts) => ({ ts, autor: 'a@b.dev', sessao, agente: 'orquestrador', tipo, dados });

describe('cartão infere a entrega pela regra do loop.mjs (GM-15 hotfix)', () => {
  test('branch hotfix/GM-15-alpha2: sessao.inicio vai ao diário GM-15, não a _sem-id; o cartão diz o PBI', () => {
    const dir = repoNaBranch('hotfix/GM-15-alpha2');
    const r = hook(dir, { session_id: 'sess-b', source: 'clear' });
    assert.equal(r.code, 0, r.stderr);
    const es = ler(dirEntrega(dir, 'GM-15'));
    assert.deepEqual(es.map((e) => e.tipo), ['sessao.inicio', 'guarda.heartbeat']);
    assert.equal(es[0].dados.origem, 'clear');
    const semId = dirEntrega(dir, null);
    assert.ok(!existsSync(semId) || readdirSync(semId).every((f) => !f.includes('sess-b')), 'nada da sessão nova em _sem-id');
    assert.match(r.ctx, /PBI: GM-15/);
    assert.doesNotMatch(r.ctx, /não inferido/);
  });

  test('de ponta: pouso da sessão A em GM-15 + SessionStart clear da sessão B na branch hotfix ⇒ pousoPendente false', () => {
    const dir = repoNaBranch('hotfix/GM-15-alpha2');
    const d = dirEntrega(dir, 'GM-15');
    append(d, 'sess-a', ev('sess-a', 'sessao.pouso', { percent: 50 }, '2026-11-15T19:00:00.000Z'));
    assert.equal(pousoPendente(ler(d), true).pendente, true, 'antes do clear o pouso está pendente');
    const r = hook(dir, { session_id: 'sess-b', source: 'clear' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(pousoPendente(ler(d), true).pendente, false);
  });

  test('fonte única: origin/HEAD com fluxo.idPadrao próprio (só PBI-n) decide: GM-15 deixa de ser entrega e vai a _sem-id, como no loop', () => {
    const custom = JSON.stringify({ ...JSON.parse(CONFIG), fluxo: { ...JSON.parse(CONFIG).fluxo, idPadrao: '^PBI-\\d+$' } });
    const dir = repoNaBranch('hotfix/GM-15-alpha2', custom);
    git(dir, 'add', 'harness.config.json');
    git(dir, 'commit', '-q', '-m', 'chore: config');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    assert.equal(idPadraoDe(dir), '^PBI-\\d+$');
    const r = hook(dir, { session_id: 'sess-b', source: 'clear' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(dirEntrega(dir, 'GM-15')), false, 'o padrão do padrão (GM-15) não vale com idPadrao próprio');
    assert.deepEqual(ler(dirEntrega(dir, null)).map((e) => e.tipo), ['sessao.inicio', 'guarda.heartbeat']);
    assert.match(r.ctx, /não inferido/);
  });

  test('fallback do SessionStart (coletar lança): a entrega ainda vem da regra do loop, não de inferirPbi', () => {
    // ledgerDir não texto ⇒ `join` lança dentro de coletar ⇒ ctx.erro ⇒ o caminho de contingência (a entrega só aparece no cabeçalho; nada é gravado).
    const quebrada = JSON.stringify({ ...JSON.parse(CONFIG), fluxo: { ...JSON.parse(CONFIG).fluxo, ledgerDir: 123 } });
    const dir = repoNaBranch('hotfix/GM-15-alpha2', quebrada);
    const r = hook(dir, { session_id: 'sess-b', source: 'clear' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /cartão indisponível/);
    assert.match(r.msg, /^GABARITO · hotfix\/GM-15-alpha2 · GM-15/);
  });
});

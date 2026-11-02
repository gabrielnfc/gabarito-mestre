/**
 * Fonte da config da guarda (D2) — spawn de dist/guarda.js em repo temporário com `origin` fake.
 *
 * A config da guarda vem de `refs/remotes/origin/HEAD:harness.config.json` (nome completo, Q4),
 * nunca da árvore local. Todos os cenários são do orquestrador (sem `agent_id`).
 * "Sem decisão" = processo sai 0 e não há `permissionDecision` na saída.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  ler a config da árvore local ⇒ `permitidos-forjado` falha
 *  M2  ler `branchPadrao` da árvore local ⇒ `branchpadrao-local-ignorado` falha
 *  M3  devolver `allow` em qualquer cenário ⇒ `saida-nunca-allow` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARDA = join(GATES, 'dist', 'guarda.js');

const AMBIENTES = {
  teste: { hosts: ['127.0.0.1', 'localhost'], bancos: ['127.0.0.1'] },
  homolog: { hosts: ['staging.exemplo.com'], projetos: ['ref-homolog'] },
  prod: { hosts: ['api.exemplo.com'], projetos: ['ref-prod'], bancos: ['db.prod.exemplo.com'] },
};

const config = ({ permitidos = [], branchPadrao = 'main' } = {}) => ({
  guarda: { ambientes: AMBIENTES, producao: { permitidos } },
  versionamento: { branchPadrao },
});

const ENV_GIT = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@exemplo.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@exemplo.com',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV_GIT, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/**
 * origem: config em origin/HEAD (null = arquivo ausente na ref); local: config na árvore (null = ausente);
 * remoto: existe `origin`; setHead: `refs/remotes/origin/HEAD` resolvível.
 */
function montar({ origem = null, local = null, remoto = true, setHead = true }) {
  const repo = mkdtempSync(join(tmpdir(), 'gm-fonte-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  if (origem) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(origem));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  if (remoto) {
    const bare = mkdtempSync(join(tmpdir(), 'gm-fonte-origin-'));
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', 'origin', 'main');
    if (setHead) git(repo, 'remote', 'set-head', 'origin', 'main');
  }
  if (local) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(local));
  return repo;
}

function rodarGuarda(repo, command) {
  const entrada = {
    tool_name: 'Bash',
    tool_input: { command },
    permission_mode: 'default',
    session_id: `fonte-${Math.random().toString(36).slice(2)}`,
    cwd: repo,
  };
  const r = spawnSync(process.execPath, [GUARDA], {
    cwd: repo,
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: join(GATES, '..') },
  });
  assert.equal(r.status, 0, `guarda saiu ${r.status}: ${r.stderr}`);
  const saida = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
  return { decisao: saida.hookSpecificOutput?.permissionDecision, systemMessage: saida.systemMessage ?? '', saida };
}

const CENARIOS = {
  'permitidos-forjado': () =>
    rodarGuarda(montar({ origem: config(), local: config({ permitidos: ['*'] }) }), 'vercel --prod'),
  'permitidos-origin-vale': () =>
    rodarGuarda(montar({ origem: config({ permitidos: ['vercel --prod'] }) }), 'vercel --prod'),
  'branchpadrao-local-ignorado': () =>
    rodarGuarda(montar({ origem: config({ branchPadrao: 'main' }), local: config({ branchPadrao: 'x' }) }), 'git push'),
  'origin-head-ausente': () =>
    rodarGuarda(montar({ local: config({ permitidos: ['*'] }), setHead: false }), 'vercel --prod'),
  'sem-remoto-sem-config': () => rodarGuarda(montar({ remoto: false }), 'vercel --prod'),
};

describe('fonte da config (D2)', () => {
  test('permitidos-forjado: origin sem permitidos, árvore local com ["*"] ⇒ ask', () => {
    assert.equal(CENARIOS['permitidos-forjado']().decisao, 'ask');
  });

  test('permitidos-origin-vale: permitidos em origin/HEAD casa ⇒ sem decisão', () => {
    assert.equal(CENARIOS['permitidos-origin-vale']().decisao, undefined);
  });

  test('branchpadrao-local-ignorado: branchPadrao local "x", origin "main"; git push em main ⇒ ask', () => {
    assert.equal(CENARIOS['branchpadrao-local-ignorado']().decisao, 'ask');
  });

  test('origin-head-ausente: sem origin/HEAD, local com permitidos ["*"] ⇒ ask e systemMessage cita "local"', () => {
    const r = CENARIOS['origin-head-ausente']();
    assert.equal(r.decisao, 'ask');
    assert.match(r.systemMessage, /local/);
  });

  test('sem-remoto-sem-config: sem remoto nem config ⇒ sem decisão', () => {
    assert.equal(CENARIOS['sem-remoto-sem-config']().decisao, undefined);
  });

  test('saida-nunca-allow: nenhum dos cinco cenários devolve allow', () => {
    for (const [nome, rodar] of Object.entries(CENARIOS)) {
      assert.notEqual(rodar().decisao, 'allow', nome);
    }
  });
});

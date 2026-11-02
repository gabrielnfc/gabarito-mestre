/**
 * Testes do instalador de hooks git (GM-9 T5, REQ-INF-1) — versionamento (R20) deixa de ser PreToolUse
 * e passa a ser `commit-msg` + `pre-push` do próprio git, em três destinos: .git/hooks, core.hooksPath e .husky.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  não gravar o hook                      ⇒ commit-am-recusa-*
 *  M2  sobrescrever em vez de anexar           ⇒ preserva-hook-existente
 *  M3  anexar sem marcador (não idempotente)   ⇒ idempotente
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { instalarHooksGit } from '../scripts/instalar-hooks-git.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GATES = join(here, '..');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd, ...args) => spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: GIT_ENV });
const gitOk = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const CONFIG = {
  fluxo: { idPadrao: '^[A-Z]+-\\d+$' },
  versionamento: { resolvidoEm: '2026-11-02' },
};

/** Repo temporário na branch `feat/GM-9-x`, com config de versionamento e tools/gabarito-gates → gates reais. */
function repo({ hooksPath, husky } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gm-hg-'));
  gitOk(dir, 'init', '-q');
  gitOk(dir, 'symbolic-ref', 'HEAD', 'refs/heads/feat/GM-9-x');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(CONFIG));
  writeFileSync(join(dir, 'a.txt'), 'um\n');
  mkdirSync(join(dir, 'tools'));
  symlinkSync(GATES, join(dir, 'tools', 'gabarito-gates'));
  if (hooksPath) gitOk(dir, 'config', 'core.hooksPath', hooksPath);
  if (husky) montarHusky(dir);
  gitOk(dir, 'add', '-A');
  gitOk(dir, 'commit', '-q', '-m', 'chore: init');
  return dir;
}

/** Imita o husky 9: `.husky/_/<hook>` despacha para `.husky/<hook>`; core.hooksPath aponta para `.husky/_`. */
function montarHusky(dir) {
  mkdirSync(join(dir, '.husky', '_'), { recursive: true });
  writeFileSync(join(dir, '.husky', '_', 'h'), '#!/usr/bin/env sh\nn=$(basename "$0")\ns=$(dirname "$(dirname "$0")")/$n\n[ -f "$s" ] || exit 0\nsh -e "$s" "$@"\n');
  for (const nome of ['commit-msg', 'pre-push', 'pre-commit']) {
    const p = join(dir, '.husky', '_', nome);
    writeFileSync(p, '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n');
    chmodSync(p, 0o755);
  }
  gitOk(dir, 'config', 'core.hooksPath', '.husky/_');
}

const cenarios = [
  { nome: 'plain', opts: {}, destino: '.git/hooks' },
  { nome: 'husky', opts: { husky: true }, destino: '.husky' },
  { nome: 'hookspath', opts: { hooksPath: '.githooks' }, destino: 'hooksPath' },
];

function commitAm(dir, msg) {
  writeFileSync(join(dir, 'a.txt'), `${Math.random()}\n`);
  return git(dir, 'commit', `-am${msg}`);
}

describe('instalarHooksGit — commit-msg recusa mensagem fora do padrão e aceita a válida', () => {
  for (const { nome, opts, destino } of cenarios) {
    test(`commit-am-recusa-${nome}`, () => {
      const dir = repo(opts);
      const r = instalarHooksGit(dir);
      assert.equal(r.destino, destino);
      assert.equal(r.acao, 'criado');
      const c = commitAm(dir, 'foo');
      assert.notEqual(c.status, 0, `deveria recusar: ${c.stdout}${c.stderr}`);
      assert.match(c.stderr, /R20/);
      assert.doesNotMatch(c.stderr, /ALLOW_[A-Z]+|escape hatch/i);
      assert.equal(gitOk(dir, 'log', '--format=%s', '-1'), 'chore: init');
    });

    test(`commit-valido-aceita-${nome}`, () => {
      const dir = repo(opts);
      instalarHooksGit(dir);
      writeFileSync(join(dir, 'a.txt'), 'dois\n');
      const c = git(dir, 'commit', '-am', 'feat(GM-9): x');
      assert.equal(c.status, 0, c.stderr);
      assert.equal(gitOk(dir, 'log', '--format=%s', '-1'), 'feat(GM-9): x');
    });
  }
});

describe('instalarHooksGit — idempotência e preservação', () => {
  test('idempotente: 2ª execução não duplica nem altera o arquivo', () => {
    const dir = repo();
    assert.equal(instalarHooksGit(dir).acao, 'criado');
    const antes = readFileSync(join(dir, '.git', 'hooks', 'commit-msg'), 'utf8');
    const r2 = instalarHooksGit(dir);
    assert.equal(r2.acao, 'mantido');
    const depois = readFileSync(join(dir, '.git', 'hooks', 'commit-msg'), 'utf8');
    assert.equal(depois, antes);
    assert.equal(depois.split('# >>> gabarito-mestre').length - 1, 1);
    assert.equal(depois.split('# <<< gabarito-mestre').length - 1, 1);
  });

  test('preserva-hook-existente: o hook que já estava lá segue rodando, e o nosso também', () => {
    const dir = repo();
    const sentinela = join(dir, 'sentinela');
    const alvo = join(dir, '.git', 'hooks', 'commit-msg');
    const original = `#!/bin/sh\necho rodou >> "${sentinela}"\n`;
    writeFileSync(alvo, original);
    chmodSync(alvo, 0o755);
    const r = instalarHooksGit(dir);
    assert.equal(r.acao, 'anexado');
    const conteudo = readFileSync(alvo, 'utf8');
    assert.ok(conteudo.includes(`echo rodou >> "${sentinela}"`), 'conteúdo original preservado');
    assert.match(conteudo, /# >>> gabarito-mestre[\s\S]*# <<< gabarito-mestre/);
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    assert.equal(git(dir, 'commit', '-am', 'feat(GM-9): ok').status, 0);
    assert.equal(readFileSync(sentinela, 'utf8'), 'rodou\n', 'hook pré-existente rodou');
    writeFileSync(join(dir, 'a.txt'), 'y\n');
    assert.notEqual(git(dir, 'commit', '-am', 'foo').status, 0, 'e o nosso ainda recusa');
  });

  test('hook pré-existente do husky também é preservado e continua rodando', () => {
    const dir = repo({ husky: true });
    const sentinela = join(dir, 'sentinela');
    writeFileSync(join(dir, '.husky', 'commit-msg'), `echo rodou >> "${sentinela}"\n`);
    assert.equal(instalarHooksGit(dir).acao, 'anexado');
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    assert.equal(git(dir, 'commit', '-am', 'feat(GM-9): ok').status, 0);
    assert.equal(readFileSync(sentinela, 'utf8'), 'rodou\n');
  });

  test('sem tools/gabarito-gates ou sem node o hook avisa e NÃO trava (fail-open declarado, G9)', () => {
    const dir = repo();
    instalarHooksGit(dir);
    unlinkSync(join(dir, 'tools', 'gabarito-gates')); // só o symlink do fixture, nunca o alvo
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    const c = git(dir, 'commit', '-am', 'foo');
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stderr, /R20 não conferida/);
  });
});

describe('instalarHooksGit — pre-push', () => {
  function comRemoto(branch) {
    const dir = repo();
    const bare = mkdtempSync(join(tmpdir(), 'gm-hg-bare-'));
    gitOk(bare, 'init', '-q', '--bare');
    gitOk(dir, 'remote', 'add', 'origin', bare);
    instalarHooksGit(dir);
    gitOk(dir, 'checkout', '-q', '-b', branch);
    return dir;
  }
  test('pre-push-branch-invalida-recusa', () => {
    const dir = comRemoto('hotfix/x');
    const p = git(dir, 'push', 'origin', 'HEAD');
    assert.notEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stderr, /branch `hotfix\/x`/);
  });
  test('pre-push com branch válida passa', () => {
    const dir = comRemoto('feat/GM-9-y');
    const p = git(dir, 'push', 'origin', 'HEAD');
    assert.equal(p.status, 0, p.stderr);
  });
});

describe('instalarHooksGit — arquivos criados', () => {
  test('hook criado é executável e começa com shebang', () => {
    const dir = repo();
    instalarHooksGit(dir);
    for (const nome of ['commit-msg', 'pre-push']) {
      const p = join(dir, '.git', 'hooks', nome);
      assert.ok(existsSync(p));
      assert.match(readFileSync(p, 'utf8').split('\n')[0], /^#!/);
      assert.ok((spawnSync('test', ['-x', p]).status) === 0, `${nome} executável`);
    }
  });
});

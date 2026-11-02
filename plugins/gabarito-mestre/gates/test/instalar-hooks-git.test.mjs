/**
 * Testes do instalador de hooks git (GM-9 T5, REQ-INF-1) — versionamento (R20) deixa de ser PreToolUse
 * e passa a ser `commit-msg` + `pre-push` do próprio git, em três destinos: .git/hooks, core.hooksPath e .husky.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  não gravar o hook                      ⇒ commit-am-recusa-*
 *  M2  sobrescrever em vez de anexar           ⇒ preserva-hook-existente
 *  M3  anexar sem marcador (não idempotente)   ⇒ idempotente
 *  R1  bloco no FIM (hook antigo com `exit 0` cala o nosso)      ⇒ bloco-no-inicio
 *  R2  sem trava de toplevel                                      ⇒ guarda-toplevel
 *  R3  sem recusar shebang não-shell / binário / symlink / sem exec / marcador incompleto ⇒ recusa-*
 *  R4  hooksPath global ou fora do repo aceito                    ⇒ hookspath-*-recusa
 *  R5  pre-push olhando o HEAD em vez do ref de destino           ⇒ pre-push-*
 *  R6  bloquear em qualquer código ≠ 0 (não só no 2)              ⇒ lib-ausente-nao-trava
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, chmodSync, unlinkSync, readdirSync, copyFileSync, realpathSync } from 'node:fs';
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

// ────────────────────────────────────────────────────────────── rodada de correção 1: o hook é de TERCEIRO
const hookDe = (dir, nome = 'commit-msg') => join(dir, '.git', 'hooks', nome);
function criarHook(dir, conteudo, { modo = 0o755, nome = 'commit-msg' } = {}) {
  const p = hookDe(dir, nome);
  writeFileSync(p, conteudo);
  chmodSync(p, modo);
  return p;
}
const bytes = (p) => readFileSync(p);

describe('recusado: em dúvida, não toca (hook existente)', () => {
  test('recusa-shebang-python: hook python/node não recebe bloco sh; bytes intactos', () => {
    for (const sheb of ['#!/usr/bin/env python3', '#!/usr/bin/python', '#!/usr/bin/env node', '#!/usr/bin/perl -w']) {
      const dir = repo();
      const p = criarHook(dir, `${sheb}\nprint("x")\n`);
      const antes = bytes(p);
      const r = instalarHooksGit(dir);
      assert.equal(r.acao, 'recusado', sheb);
      assert.match(r.motivo, /não é shell/);
      assert.match(r.linha, /--msg "\$1"/);
      assert.deepEqual(bytes(p), antes, sheb);
    }
  });
  test('shell aceito: sh, bash, zsh, dash, env bash, sem shebang', () => {
    for (const sheb of ['#!/bin/sh', '#!/bin/bash', '#!/usr/bin/env bash', '#!/bin/zsh', '#!/bin/dash', '#!/bin/sh -e', '']) {
      const dir = repo();
      criarHook(dir, `${sheb ? `${sheb}\n` : ''}echo oi >/dev/null\n`);
      assert.equal(instalarHooksGit(dir).acao, 'anexado', sheb || '(sem shebang)');
    }
  });
  test('recusa-binario: NUL ⇒ recusado, bytes idênticos', () => {
    const dir = repo();
    const p = criarHook(dir, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0xff, 0xfe]));
    const antes = bytes(p);
    const r = instalarHooksGit(dir);
    assert.equal(r.acao, 'recusado');
    assert.match(r.motivo, /binário|UTF-8/);
    assert.deepEqual(bytes(p), antes);
  });
  test('recusa-latin1: script com byte inválido em UTF-8 ⇒ recusado, bytes idênticos', () => {
    const dir = repo();
    const p = criarHook(dir, Buffer.from('#!/bin/sh\n# coment\xe1rio\nexit 0\n', 'latin1'));
    const antes = bytes(p);
    assert.equal(instalarHooksGit(dir).acao, 'recusado');
    assert.deepEqual(bytes(p), antes);
  });
  test('anexo preserva os bytes exatos: cabeça + bloco + resto, UTF-8 multibyte intacto', () => {
    const dir = repo();
    const original = Buffer.from('#!/bin/sh\n# ação — é\nexit 0\n', 'utf8');
    const p = criarHook(dir, original);
    assert.equal(instalarHooksGit(dir).acao, 'anexado');
    const depois = bytes(p);
    const cab = Buffer.from('#!/bin/sh\n');
    assert.deepEqual(depois.subarray(0, cab.length), cab);
    assert.deepEqual(depois.subarray(depois.length - (original.length - cab.length)), original.subarray(cab.length));
  });
  test('recusa-symlink: hook symlink (até dangling) não é escrito; o alvo fica intacto', () => {
    const dir = repo();
    const alvo = join(mkdtempSync(join(tmpdir(), 'gm-hg-alvo-')), 'compartilhado');
    writeFileSync(alvo, '#!/bin/sh\nexit 0\n');
    chmodSync(alvo, 0o755);
    const antes = bytes(alvo);
    symlinkSync(alvo, hookDe(dir));
    assert.equal(instalarHooksGit(dir).acao, 'recusado');
    assert.deepEqual(bytes(alvo), antes);
    const dir2 = repo();
    symlinkSync('/nao/existe/hook', hookDe(dir2));
    const r2 = instalarHooksGit(dir2);
    assert.equal(r2.acao, 'recusado');
    assert.equal(existsSync('/nao/existe'), false);
  });
  test('recusa-sem-exec: hook sem permissão de execução ⇒ recusado (o git o ignoraria), intocado', () => {
    const dir = repo();
    const p = criarHook(dir, '#!/bin/sh\nexit 0\n', { modo: 0o644 });
    const antes = bytes(p);
    const r = instalarHooksGit(dir);
    assert.equal(r.acao, 'recusado');
    assert.match(r.motivo, /permissão de execução/);
    assert.deepEqual(bytes(p), antes);
  });
  test('recusa-marcador-incompleto: início sem fim ⇒ recusado, intocado', () => {
    const dir = repo();
    const p = criarHook(dir, '#!/bin/sh\n# >>> gabarito-mestre\nexit 0\n');
    const antes = bytes(p);
    const r = instalarHooksGit(dir);
    assert.equal(r.acao, 'recusado');
    assert.match(r.motivo, /incompleto/);
    assert.deepEqual(bytes(p), antes);
  });
  test('recusa-crlf: shebang com CR ⇒ recusado', () => {
    const dir = repo();
    criarHook(dir, '#!/bin/sh\r\nexit 0\r\n');
    assert.equal(instalarHooksGit(dir).acao, 'recusado');
  });
  test('um hook recusado não impede o outro: pre-push python recusa, commit-msg é instalado', () => {
    const dir = repo();
    criarHook(dir, '#!/usr/bin/env python3\nprint(1)\n', { nome: 'pre-push' });
    const r = instalarHooksGit(dir);
    assert.equal(r.acao, 'recusado');
    assert.equal(r.hooks['commit-msg'].acao, 'criado');
    assert.equal(r.hooks['pre-push'].acao, 'recusado');
    writeFileSync(join(dir, 'a.txt'), 'z\n');
    assert.notEqual(git(dir, 'commit', '-am', 'foo').status, 0);
  });
  test('bloco-no-inicio: hook antigo com `exit 0` não cala o nosso', () => {
    const dir = repo();
    criarHook(dir, '#!/bin/sh\nexit 0\n');
    assert.equal(instalarHooksGit(dir).acao, 'anexado');
    assert.match(readFileSync(hookDe(dir), 'utf8'), /^#!\/bin\/sh\n# >>> gabarito-mestre[\s\S]*# <<< gabarito-mestre\nexit 0\n$/);
    writeFileSync(join(dir, 'a.txt'), 'z\n');
    assert.notEqual(git(dir, 'commit', '-am', 'foo').status, 0);
  });
});

describe('recusado: destino fora do repo, ou config compartilhada', () => {
  function comGlobal(conteudo, fn) {
    const home = mkdtempSync(join(tmpdir(), 'gm-hg-home-'));
    const cfg = join(home, '.gitconfig');
    writeFileSync(cfg, conteudo(home));
    const antes = { g: process.env.GIT_CONFIG_GLOBAL, h: process.env.HOME };
    process.env.GIT_CONFIG_GLOBAL = cfg;
    process.env.HOME = home;
    try { return fn(home); } finally {
      if (antes.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = antes.g;
      process.env.HOME = antes.h;
    }
  }
  test('hookspath-global-recusa: core.hooksPath só no escopo global ⇒ recusado e nada gravado', () => {
    comGlobal((home) => `[core]\n\thooksPath = ${home}/ghooks\n`, (home) => {
      mkdirSync(join(home, 'ghooks'));
      const dir = repo();
      const r = instalarHooksGit(dir);
      assert.equal(r.acao, 'recusado');
      assert.match(r.motivo, /global/);
      assert.deepEqual(readdirSync(join(home, 'ghooks')), []);
    });
  });
  test('hookspath-global-til-recusa: `~/.githooks` global também (e não cria "~" dentro do repo)', () => {
    comGlobal(() => '[core]\n\thooksPath = ~/.githooks\n', (home) => {
      mkdirSync(join(home, '.githooks'));
      const dir = repo();
      assert.equal(instalarHooksGit(dir).acao, 'recusado');
      assert.deepEqual(readdirSync(join(home, '.githooks')), []);
      assert.equal(existsSync(join(dir, '~')), false);
    });
  });
  test('hookspath-fora-recusa: core.hooksPath local apontando para fora do repo (abs e ../) ⇒ recusado', () => {
    const fora = mkdtempSync(join(tmpdir(), 'gm-hg-fora-'));
    const dir = repo({ hooksPath: fora });
    assert.equal(instalarHooksGit(dir).acao, 'recusado');
    assert.deepEqual(readdirSync(fora), []);
    const dir2 = repo({ hooksPath: `../${fora.split('/').pop()}` });
    assert.equal(instalarHooksGit(dir2).acao, 'recusado');
    assert.deepEqual(readdirSync(fora), []);
  });
  test('hookspath-relativo-dentro: relativo ao repo é aceito e resolve pela raiz', () => {
    const dir = repo({ hooksPath: 'meus-hooks' });
    const r = instalarHooksGit(dir);
    assert.equal(r.destino, 'hooksPath');
    assert.ok(existsSync(join(dir, 'meus-hooks', 'commit-msg')));
  });
  test('worktree: hooks vão para o git-common-dir (dentro do repo) e valem no worktree', () => {
    const dir = repo();
    gitOk(dir, 'branch', 'feat/GM-9-w');
    const wt = `${dir}-w`;
    gitOk(dir, 'worktree', 'add', '-q', wt, 'feat/GM-9-w');
    const r = instalarHooksGit(wt);
    assert.equal(r.acao, 'criado');
    assert.ok(existsSync(join(dir, '.git', 'hooks', 'commit-msg')));
    writeFileSync(join(wt, 'a.txt'), 'w\n');
    assert.notEqual(git(wt, 'commit', '-am', 'foo').status, 0);
    assert.equal(git(wt, 'commit', '-am', 'feat(GM-9): w').status, 0);
  });
  test('guarda-toplevel: subpasta de um repo não grava hook no repo de fora', () => {
    const dir = repo();
    mkdirSync(join(dir, 'sub'));
    assert.throws(() => instalarHooksGit(join(dir, 'sub')), /não é a raiz/);
    assert.equal(existsSync(hookDe(dir)), false);
  });
});

describe('husky: destino só quando é o caminho efetivo', () => {
  test('.husky existente sem core.hooksPath apontando para ele ⇒ .git/hooks (e .husky intocado)', () => {
    const dir = repo();
    mkdirSync(join(dir, '.husky'));
    const r = instalarHooksGit(dir);
    assert.equal(r.destino, '.git/hooks');
    assert.deepEqual(readdirSync(join(dir, '.husky')), []);
    writeFileSync(join(dir, 'a.txt'), 'z\n');
    assert.notEqual(git(dir, 'commit', '-am', 'foo').status, 0);
  });
  test('.husky + core.hooksPath em outro lugar ⇒ vai para o hooksPath, não para .husky', () => {
    const dir = repo({ hooksPath: '.githooks' });
    mkdirSync(join(dir, '.husky'));
    assert.equal(instalarHooksGit(dir).destino, 'hooksPath');
    assert.deepEqual(readdirSync(join(dir, '.husky')), []);
  });
  test('husky: hook do usuário sem bit de execução (normal no husky 9) é aceito', () => {
    const dir = repo({ husky: true });
    writeFileSync(join(dir, '.husky', 'commit-msg'), 'echo oi >/dev/null\n');
    chmodSync(join(dir, '.husky', 'commit-msg'), 0o644);
    assert.equal(instalarHooksGit(dir).acao, 'anexado');
  });
});

describe('pre-push confere o ref de destino, não o HEAD', () => {
  function remoto() {
    const dir = repo();
    const bare = mkdtempSync(join(tmpdir(), 'gm-hg-bare-'));
    gitOk(bare, 'init', '-q', '--bare');
    gitOk(dir, 'remote', 'add', 'origin', bare);
    instalarHooksGit(dir);
    return { dir, bare };
  }
  test('pre-push-ref-ruim-nao-atual-recusa: `push origin hotfix-ruim` com a branch atual válida', () => {
    const { dir } = remoto();
    gitOk(dir, 'branch', 'hotfix-ruim');
    const p = git(dir, 'push', 'origin', 'hotfix-ruim');
    assert.notEqual(p.status, 0, p.stderr);
    assert.match(p.stderr, /hotfix-ruim/);
  });
  test('pre-push-refspec-recusa: `HEAD:refs/heads/outra-ruim`', () => {
    const { dir } = remoto();
    assert.notEqual(git(dir, 'push', 'origin', 'HEAD:refs/heads/outra-ruim').status, 0);
  });
  test('pre-push-detached-recusa: HEAD destacado empurrado para `refs/heads/ruim2`', () => {
    const { dir } = remoto();
    gitOk(dir, 'checkout', '-q', '--detach');
    assert.notEqual(git(dir, 'push', 'origin', 'HEAD:refs/heads/ruim2').status, 0);
  });
  test('pre-push-passa: branch atual ruim + push de branch válida · tag · --delete', () => {
    const { dir } = remoto();
    gitOk(dir, 'push', '-q', '--no-verify', 'origin', 'HEAD:refs/heads/hotfix-velha');
    gitOk(dir, 'checkout', '-q', '-b', 'ruim-atual');
    assert.equal(git(dir, 'push', 'origin', 'feat/GM-9-x').status, 0, 'branch válida, atual ruim');
    gitOk(dir, 'tag', 'v1');
    assert.equal(git(dir, 'push', 'origin', 'v1').status, 0, 'tag');
    const d = git(dir, 'push', 'origin', '--delete', 'hotfix-velha');
    assert.equal(d.status, 0, d.stderr);
  });
});

describe('só o exit 2 bloqueia; crash vira aviso (fail-open declarado, G9)', () => {
  test('lib-ausente-nao-trava: gates sem lib/ ⇒ commit válido passa, com aviso', () => {
    const dir = repo();
    instalarHooksGit(dir);
    unlinkSync(join(dir, 'tools', 'gabarito-gates'));
    mkdirSync(join(dir, 'tools', 'gabarito-gates', 'scripts'), { recursive: true });
    copyFileSync(join(GATES, 'scripts', 'versionamento-check.mjs'), join(dir, 'tools', 'gabarito-gates', 'scripts', 'versionamento-check.mjs'));
    writeFileSync(join(dir, 'a.txt'), 'z\n');
    const c = git(dir, 'commit', '-am', 'feat(GM-9): ok');
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stderr, /R20 não conferida/);
  });
});

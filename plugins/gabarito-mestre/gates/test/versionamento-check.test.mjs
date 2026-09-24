/**
 * Testes do VER-3 — versionamento-check.
 *
 * R20 vira gate aqui: o histórico de primeiro pai e o nome da branch são conferidos contra
 * a config gravada pelo onboarding. Merge commit do orquestrador (2 pais) é IGNORADO;
 * sem `versionamento.resolvidoEm` é fail-open declarado, nunca bloqueio.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  contar commits de merge (não pular `pais.length >= 2`)
 *  M2  aceitar `fix:` sem escopo
 *  M3  validarBranch case-insensitive (`feat/pbi-12` passa)
 *  M4  fail-closed sem config (exit 1)
 *  M5  validar só o primeiro commit do intervalo
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCabecalho, validarCommit, validarBranch, checar, listarCommits, lerConfig, DEFAULTS } from '../scripts/versionamento-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'versionamento-check.mjs');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (dir, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ver-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const CONFIG = JSON.stringify({ fluxo: { idPadrao: '^[A-Z]+-\\d+$' }, versionamento: { resolvidoEm: '2026-09-24' } });

/** Repo real: main com `feat(PBI-1): a`, merge --no-ff de `feat/PBI-2-x` (que tem `docs: b`). HEAD em main. */
function repoGit(config = CONFIG) {
  const dir = repo(config === null ? {} : { 'harness.config.json': config });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-1): a');
  git(dir, 'checkout', '-q', '-b', 'feat/PBI-2-x');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'docs: b');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', "Merge branch 'feat/PBI-2-x'", 'feat/PBI-2-x');
  return dir;
}
const cli = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: GIT_ENV });

describe('parseCabecalho', () => {
  test('tipo(escopo): assunto · tipo: assunto · tipo!: assunto · só a primeira linha', () => {
    assert.deepEqual(parseCabecalho('feat(PBI-12): adiciona x'), { tipo: 'feat', escopo: 'PBI-12', assunto: 'adiciona x' });
    assert.deepEqual(parseCabecalho('docs: b'), { tipo: 'docs', escopo: null, assunto: 'b' });
    assert.deepEqual(parseCabecalho('feat(PBI-1)!: quebra\n\ncorpo'), { tipo: 'feat', escopo: 'PBI-1', assunto: 'quebra' });
  });
  test('inválidos → null', () => {
    for (const m of ['arrumei', 'Feat(PBI-1): x', 'feat(PBI-1):x', 'feat (PBI-1): x', 'feat(): x', '', null]) assert.equal(parseCabecalho(m), null, String(m));
  });
});

describe('validarCommit', () => {
  const cfg = { ...DEFAULTS, idPadrao: '^[A-Z]+-\\d+$' };
  test('tipos com escopo de PBI exigem escopo que casa idPadrao', () => {
    assert.equal(validarCommit('feat(PBI-1): a', cfg).ok, true);
    assert.equal(validarCommit('fix(GM-2): a', cfg).ok, true);
    const semEscopo = validarCommit('fix: c', cfg);
    assert.equal(semEscopo.ok, false);
    assert.match(semEscopo.motivo, /exige escopo/);
    assert.match(validarCommit('feat(pbi-1): a', cfg).motivo, /não casa idPadrao/);
    assert.match(validarCommit('feat(api): a', cfg).motivo, /não casa idPadrao/);
  });
  test('tipos livres aceitam escopo livre ou ausente', () => {
    assert.equal(validarCommit('docs: b', cfg).ok, true);
    assert.equal(validarCommit('chore(deps): bump', cfg).ok, true);
    assert.equal(validarCommit('chore(fluxo): EPIC-7 → em_execucao', cfg).ok, true);
  });
  test('tipo desconhecido e cabeçalho fora do formato reprovam com motivo', () => {
    assert.match(validarCommit('hotfix(PBI-1): x', cfg).motivo, /desconhecido/);
    assert.match(validarCommit('arrumei', cfg).motivo, /tipo\(escopo\): assunto/);
  });
  test('idPadrao vem da config: com `^GM-\\d+$`, PBI-1 reprova', () => {
    assert.equal(validarCommit('feat(PBI-1): a', { ...cfg, idPadrao: '^GM-\\d+$' }).ok, false);
  });
});

describe('validarBranch — os exemplos do contrato', () => {
  test('passam: feat/PBI-12-x, chore/bump-deps, wt/PBI-12-1, main, master, enabler/GM-2-gates', () => {
    for (const b of ['feat/PBI-12-x', 'chore/bump-deps', 'wt/PBI-12-1', 'main', 'master', 'enabler/GM-2-gates', 'feat/PBI-12']) {
      assert.equal(validarBranch(b, DEFAULTS).ok, true, b);
    }
  });
  test('reprovam: hotfix/PBI-1, chore/PBI-1, feat/pbi-12, wt/PBI-12, FEAT/PBI-1-x', () => {
    for (const b of ['hotfix/PBI-1', 'chore/PBI-1', 'feat/pbi-12', 'wt/PBI-12', 'FEAT/PBI-1-x', '']) {
      const r = validarBranch(b, DEFAULTS);
      assert.equal(r.ok, false, b);
      assert.match(r.motivo, /branchPadrao nem branchWorktree/);
    }
  });
});

describe('checar — histórico real com merge commit', () => {
  test('feat(PBI-1), merge --no-ff, docs: b → passa (merge ignorado)', () => {
    const dir = repoGit();
    const r = checar(dir, { max: 20 });
    assert.equal(r.ok, true, JSON.stringify(r.achados));
    assert.deepEqual(r.achados, []);
    assert.equal(r.commits, 2, 'first-parent de main: merge + feat(PBI-1)');
  });
  test('listarCommits marca o merge com 2 pais', () => {
    const dir = repoGit();
    const cs = listarCommits(dir, { max: 20 });
    assert.equal(cs[0].pais.length, 2);
    assert.equal(cs[1].assunto, 'feat(PBI-1): a');
  });
  test('commit `fix: c` (escopo obrigatório ausente) reprova com sha e motivo', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: c');
    const r = checar(dir, { max: 20 });
    assert.equal(r.ok, false);
    assert.equal(r.achados.length, 1);
    assert.match(r.achados[0].sha, /^[0-9a-f]{7}$/);
    assert.match(r.achados[0].motivo, /exige escopo/);
    assert.match(r.achados[0].motivo, /"fix: c"/);
  });
  test('vários commits ruins → vários achados (não só o primeiro)', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: c');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'arrumei');
    assert.equal(checar(dir, { max: 20 }).achados.length, 2);
  });
  test('--base main em branch feat/PBI-3-y: só os commits da branch entram; branch válida', () => {
    const dir = repoGit();
    git(dir, 'checkout', '-q', '-b', 'feat/PBI-3-y');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-3): y');
    const ok = checar(dir, { base: 'main' });
    assert.equal(ok.ok, true, JSON.stringify(ok.achados));
    assert.equal(ok.commits, 1);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: sem escopo');
    assert.equal(checar(dir, { base: 'main' }).achados.length, 1);
  });
  test('branch fora do padrão gera achado `branch` mesmo com commits ok', () => {
    const dir = repoGit();
    git(dir, 'checkout', '-q', '-b', 'feat/pbi-4-z');
    const r = checar(dir, { max: 20 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.achados.map((a) => a.sha), ['branch']);
    assert.equal(checar(dir, { max: 20, branch: 'feat/PBI-4-z' }).ok, true, '--branch explícito substitui a branch do git');
  });
  test('max limita o intervalo de primeiro pai', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'arrumei');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-9): novo');
    assert.equal(checar(dir, { max: 1 }).ok, true, 'só o último commit entra');
    assert.equal(checar(dir, { max: 2 }).ok, false);
  });
  test('cfg injetado substitui a leitura do arquivo', () => {
    const dir = repoGit(null);
    const r = checar(dir, { max: 20, cfg: { resolvidoEm: '2026-09-24', idPadrao: '^PBI-\\d+$' } });
    assert.equal(r.ok, true);
    assert.equal(r.failOpen, undefined);
  });
});

describe('checar — fail-open declarado (Review Focus 3)', () => {
  test('config ausente → ok:true com failOpen', () => {
    const r = checar(repoGit(null), { max: 20 });
    assert.equal(r.ok, true);
    assert.match(r.failOpen, /ausente/);
  });
  test('config vazia ou sem versionamento.resolvidoEm → failOpen', () => {
    assert.match(checar(repoGit(''), { max: 20 }).failOpen, /resolvidoEm ausente/);
    assert.match(checar(repoGit('{"versionamento":{"modelo":"trunk"}}'), { max: 20 }).failOpen, /resolvidoEm ausente/);
  });
  test('config inválida → failOpen citando JSON inválido, sem lançar', () => {
    const r = checar(repoGit('{"versionamento": '), { max: 20 });
    assert.equal(r.ok, true);
    assert.match(r.failOpen, /inválido/);
  });
  test('fixture solta sem .git → ok:true com aviso "sem git"', () => {
    const r = checar(repo({ 'harness.config.json': CONFIG }), { max: 20 });
    assert.equal(r.ok, true);
    assert.match(r.aviso, /sem git/);
  });
  test('lerConfig funde DEFAULTS + versionamento + fluxo.idPadrao', () => {
    const { cfg } = lerConfig(repo({ 'harness.config.json': JSON.stringify({ fluxo: { idPadrao: '^GM-\\d+$' }, versionamento: { resolvidoEm: '2026-09-24', changelog: 'HISTORY.md' } }) }));
    assert.equal(cfg.idPadrao, '^GM-\\d+$');
    assert.equal(cfg.changelog, 'HISTORY.md');
    assert.equal(cfg.branchPadrao, DEFAULTS.branchPadrao);
  });
});

describe('CLI', () => {
  test('histórico ok → exit 0 e resumo', () => {
    const dir = repoGit();
    const r = cli(['--root', dir, '--max', '20'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[R20\] ok — 2 commit\(s\)/);
  });
  test('achado → exit 1 com ::error:: por achado; --json devolve o objeto', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: c');
    const r = cli(['--root', dir], dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::\[R20\] [0-9a-f]{7} /);
    const j = JSON.parse(cli(['--root', dir, '--json'], dir).stdout);
    assert.equal(j.ok, false);
    assert.equal(j.achados.length, 1);
  });
  test('--base e --branch como no CI', () => {
    const dir = repoGit();
    git(dir, 'checkout', '-q', '-b', 'feat/PBI-3-y');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-3): y');
    assert.equal(cli(['--root', dir, '--base', 'main', '--branch', 'feat/PBI-3-y'], dir).status, 0);
    assert.equal(cli(['--root', dir, '--base', 'main', '--branch', 'hotfix/PBI-3'], dir).status, 1);
  });
  test('sem config: exit 0, stderr "fail-open declarado (G9)", sem stack trace', () => {
    const dir = repoGit(null);
    const r = cli(['--root', dir], dir);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('config inválida: exit 0 e fail-open', () => {
    const r = cli(['--root', repoGit('{'), ], tmpdir());
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
  });
  test('sem --root: raiz via git toplevel a partir de subpasta', () => {
    const dir = repoGit();
    mkdirSync(join(dir, 'apps', 'api'), { recursive: true });
    const r = cli([], join(dir, 'apps', 'api'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[R20\] ok/);
  });
});

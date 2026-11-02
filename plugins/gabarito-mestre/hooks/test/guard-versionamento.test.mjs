/**
 * Testes do guard-versioning.sh (R20) — separados de guards.test.mjs (GM-9 T1a).
 * Helpers em ./_comum.mjs; corpora em ./corpus. Mutações prescritas: ver o cabeçalho histórico em git (guards.test.mjs, antes do GM-9 T1a).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, HOOKS, cleanEnv, runAt, fixtureRepo, corpus } from './_comum.mjs';

const CONFIG_VERSIONAMENTO = {
  fluxo: { idPadrao: '^[A-Z]+-\\d+$', resolvidoEm: '2026-09-24' },
  versionamento: {
    modelo: 'trunk',
    branchPadrao: '^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$',
    branchWorktree: '^wt/[A-Z]+-\\d+-\\d+$',
    commit: 'conventional',
    tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'],
    tiposLivres: ['chore', 'docs', 'ci', 'build', 'test', 'release', 'revert'],
    tag: '^v\\d+\\.\\d+\\.\\d+$',
    changelog: 'CHANGELOG.md',
    resolvidoEm: '2026-09-24',
  },
};
const corpusVersionamento = () =>
  readFileSync(join(here, 'corpus', 'versionamento.txt'), 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^(PASSA|BLOQUEIA|HATCH)[ \t]+(.+)$/);
      assert.ok(m, `versionamento.txt: linha sem veredito: ${l}`);
      return { veredito: m[1], cmd: m[2].replace(/\\n/g, '\n') };
    });

describe('guard-versioning.sh — R20 (T13)', () => {
  const root = fixtureRepo({
    branch: 'feat/PBI-1-x',
    config: CONFIG_VERSIONAMENTO,
    files: { 'msg-ok.txt': 'feat(PBI-9): via arquivo\n\ncorpo\n', 'msg-ruim.txt': 'mudei coisas\n' },
  });
  const entradas = corpusVersionamento();

  test('corpus: contagens do gate da Fase 3 (≥ 30 · ≥ 12 PASSA · ≥ 12 BLOQUEIA · ≥ 4 worktree · ≥ 2 HATCH)', () => {
    const n = (v) => entradas.filter((e) => e.veredito === v).length;
    assert.ok(entradas.length >= 30, `entradas=${entradas.length}`);
    assert.ok(n('PASSA') >= 12, `PASSA=${n('PASSA')}`);
    assert.ok(n('BLOQUEIA') >= 12, `BLOQUEIA=${n('BLOQUEIA')}`);
    assert.ok(entradas.filter((e) => /worktree/.test(e.cmd)).length >= 4, 'worktree');
    assert.ok(n('HATCH') >= 2, `HATCH=${n('HATCH')}`);
  });

  for (const { veredito, cmd } of entradas) {
    test(`${veredito}: ${cmd.replace(/\n/g, '⏎').slice(0, 90)}`, () => {
      const r = runAt('guard-versioning.sh', cmd, { cwd: root });
      if (veredito === 'BLOQUEIA') {
        assert.equal(r.code, 2, r.stderr);
        const j = JSON.parse(r.stdout);
        assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
        assert.match(j.hookSpecificOutput.permissionDecisionReason, /regra R20/);
      } else if (veredito === 'HATCH') {
        assert.equal(r.code, 0, r.stderr);
        assert.match(JSON.parse(r.stdout).systemMessage, /R20/);
        assert.match(r.stderr, /ESCAPE HATCH/);
      } else {
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stdout, '');
      }
    });
  }

  test('bloqueio em três camadas: frase · o que fazer · regra citada, com a forma correta e o nome do hatch', () => {
    const r = runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root });
    const motivo = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(motivo, /^Versionamento bloqueado pela regra R20 \(cabeçalho 'arrumei' não é Conventional Commits\)\./);
    assert.match(motivo, /Reescreva a primeira linha da mensagem \(fonte: -m\)/);
    assert.match(motivo, /ex\.: feat\(PBI-123\): assunto/);
    assert.match(motivo, /Ver AGENTS\.md §3 \(R20\) e referencia\.md §10/);
    assert.match(motivo, /GABARITO_ALLOW_VERSIONING="autorizado por <quem> em <data> — <motivo>"/);
    assert.match(r.stderr, /regra R20/);
  });

  test('motivos específicos: sem escopo · escopo fora do idPadrao · tipo desconhecido · branch fora do padrão', () => {
    const motivo = (cmd) => JSON.parse(runAt('guard-versioning.sh', cmd, { cwd: root }).stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(motivo('git commit -m "fix: x"'), /tipo 'fix' exige o ID do PBI como escopo/);
    assert.match(motivo('git commit -m "fix(pbi-1): x"'), /escopo 'pbi-1' não casa o padrão de ID \^\[A-Z\]\+-\\d\+\$/);
    assert.match(motivo('git commit -m "hotfix(PBI-1): x"'), /tipo 'hotfix' não existe na convenção/);
    assert.match(motivo('git checkout -b hotfix/PBI-1'), /nome de branch 'hotfix\/PBI-1' fora do padrão/);
  });

  test('sem harness.config.json: fail-open declarado — corpus legítimo e corpus de versionamento passam inteiros', () => {
    const solto = fixtureRepo({ git: false });
    for (const cmd of corpus('legitimos.txt')) assert.equal(runAt('guard-versioning.sh', cmd, { cwd: solto }).code, 0, cmd);
    for (const { cmd } of entradas) assert.equal(runAt('guard-versioning.sh', cmd, { cwd: solto }).code, 0, cmd);
    assert.match(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: solto }).stderr, /fail-open declarado/);
  });

  test('config sem versionamento.resolvidoEm (onboarding incompleto) também é fail-open', () => {
    const semResolvido = fixtureRepo({ config: { versionamento: { branchPadrao: '^x$' } } });
    const r = runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: semResolvido });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /versionamento\.resolvidoEm/);
  });

  // Achado 7 (review final F3-R6, MINOR): branchPadrao inválido para ERE (parêntese sem fechar) fazia
  // `grep -E` sair com status 2 (erro de sintaxe), que `! grep` tratava igual a "não casou" — deny com razão
  // enganosa ("fora do padrão") e `parentheses not balanced` no stderr. Tem de ser fail-open declarado (G9).
  test('regex de config inválido para ERE: fail-open declarado (G9), não deny (achado 7)', () => {
    const invalido = fixtureRepo({
      branch: 'feat/PBI-1-x',
      config: { fluxo: { idPadrao: '^[A-Z]+-\\d+$', resolvidoEm: '2026-09-24' }, versionamento: { branchPadrao: '^(feat', resolvidoEm: '2026-09-24' } },
    });
    const r = runAt('guard-versioning.sh', 'git checkout -b feat/PBI-1-x', { cwd: invalido });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /branchPadrao/);
    assert.match(r.stderr, /fail-open declarado, G9/);
  });

  test('comando sem git commit/checkout/switch/branch/worktree: exit 0, sem stdout, sem stderr (não lê config)', () => {
    for (const cmd of ['npm test', 'git status', 'git log --oneline', 'git push origin HEAD', 'echo "git commit -m x"']) {
      const r = runAt('guard-versioning.sh', cmd, { cwd: root });
      assert.equal(r.code, 0, cmd);
      assert.equal(r.stdout, '', cmd);
    }
  });

  test('branch main e master: commit não é validado; criação de branch continua validada', () => {
    for (const b of ['main', 'master']) {
      const d = fixtureRepo({ branch: b, config: CONFIG_VERSIONAMENTO });
      assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: d }).code, 0, b);
      assert.equal(runAt('guard-versioning.sh', 'git checkout -b hotfix/PBI-1', { cwd: d }).code, 2, b);
    }
  });

  test('monorepo (Review Focus 2): sessão em apps/api lê o config da raiz; -F relativo resolve pelo cwd e depois pela raiz', () => {
    const sub = join(root, 'apps', 'api');
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: sub }).code, 2);
    writeFileSync(join(sub, 'local.txt'), 'wip\n');
    assert.equal(runAt('guard-versioning.sh', 'git commit -F local.txt', { cwd: sub }).code, 2);
    assert.equal(runAt('guard-versioning.sh', 'git commit -F msg-ok.txt', { cwd: sub }).code, 0);
    assert.equal(runAt('guard-versioning.sh', `git commit --file="${join(root, 'msg-ruim.txt')}"`, { cwd: sub }).code, 2);
    const r = runAt('guard-versioning.sh', 'git commit -F nao-existe.txt', { cwd: sub });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /fail-open declarado/);
  });

  test('heredoc (Review Focus 1): valida a 1ª linha do corpo, não a linha `git commit`', () => {
    const ok = 'git commit -m "$(cat <<\'EOF\'\nfeat(PBI-5): assunto\n\ncorpo\nEOF\n)"';
    assert.equal(runAt('guard-versioning.sh', ok, { cwd: root }).code, 0);
    const r = runAt('guard-versioning.sh', ok.replace('feat(PBI-5): assunto', 'arrumei'), { cwd: root });
    assert.equal(r.code, 2);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /cabeçalho 'arrumei'.*\(fonte: heredoc\)/);
  });

  test('a convenção vem do config, não do script: hotfix passa a valer quando está em tiposComEscopoDePbi', () => {
    // tiposLivres: ['docs'] e não [] — lista vazia no JSON conta como ausente e cai nos defaults (nota do script)
    const custom = fixtureRepo({ config: { ...CONFIG_VERSIONAMENTO, versionamento: { ...CONFIG_VERSIONAMENTO.versionamento, tiposComEscopoDePbi: ['hotfix'], tiposLivres: ['docs'] } } });
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "hotfix(PBI-1): x"', { cwd: custom }).code, 0);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "feat(PBI-1): x"', { cwd: custom }).code, 2);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "chore: x"', { cwd: custom }).code, 2);
  });

  test('hatch por env libera e avisa; DESTRUCTIVE/PRODUCTION por env não liberam o R20', () => {
    const ok = 'autorizado por gabriel em 2026-09-24 — commit de importação';
    const r = runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root, env: { GABARITO_ALLOW_VERSIONING: ok } });
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.stdout).systemMessage, /R20 · cabeçalho 'arrumei'.*via env/);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root, env: { GABARITO_ALLOW_DESTRUCTIVE: ok } }).code, 2);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root, env: { GABARITO_ALLOW_PRODUCTION: ok } }).code, 2);
  });

  test('stdin vazio ou malformado: fail-open declarado', () => {
    for (const input of ['', '{"x":']) {
      const r = spawnSync('bash', [join(HOOKS, 'guard-versioning.sh')], { input, encoding: 'utf8', cwd: root, env: cleanEnv() });
      assert.equal(r.status, 0);
      assert.match(r.stderr, /fail-open/);
    }
  });

  // Achado 1 (review final F3-R6, MAJOR): $rotulo do hatch carrega texto livre do usuário (cabeçalho de
  // commit, nome de branch) e tinha de passar por gabarito_json_escape antes de entrar no systemMessage.
  test('rótulo do hatch com aspas duplas não quebra o JSON do systemMessage (achado 1)', () => {
    const ok = 'autorizado por gabriel em 2026-09-24 — importação de histórico legado';
    const r1 = runAt('guard-versioning.sh', `GABARITO_ALLOW_VERSIONING="${ok}" git commit -m 'diz "oi" e tal'`, { cwd: root });
    assert.equal(r1.code, 0, r1.stderr);
    const j1 = JSON.parse(r1.stdout); // lança se o JSON estiver malformado
    assert.match(j1.systemMessage, /diz .oi. e tal/);

    const ok2 = 'autorizado por gabriel em 2026-09-24 — branch de experimento';
    const r2 = runAt('guard-versioning.sh', `GABARITO_ALLOW_VERSIONING="${ok2}" git checkout -b 'x"y'`, { cwd: root });
    assert.equal(r2.code, 0, r2.stderr);
    const j2 = JSON.parse(r2.stdout);
    assert.match(j2.systemMessage, /x.y/);
  });
});

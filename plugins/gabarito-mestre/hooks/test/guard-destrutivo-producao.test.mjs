/**
 * Testes dos guards destrutivo (R2) e produção (R3) — separados de guards.test.mjs (GM-9 T1a).
 * Helpers em ./_comum.mjs; corpora em ./corpus. Mutações prescritas: ver o cabeçalho histórico em git (guards.test.mjs, antes do GM-9 T1a).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOKS, run, runCommon, fixtureRepo, corpus, blocked } from './_comum.mjs';

describe('formato do bloqueio', () => {
  test('deny sai com 2 e imprime JSON válido com permissionDecision=deny', () => {
    const r = run('guard-destructive.sh', 'rm -rf build');
    assert.equal(r.code, 2);
    const j = JSON.parse(r.stdout);
    assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(j.hookSpecificOutput.permissionDecisionReason, /regra R2/);
    assert.match(r.stderr, /R2/);
  });
  test('permitir: exit 0 sem saída', () => {
    const r = run('guard-destructive.sh', 'npm test');
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('stdin vazio ou malformado: fail-open declarado, com aviso em stderr', () => {
    for (const input of ['', '{"x":']) {
      const r = spawnSync('bash', [join(HOOKS, 'guard-destructive.sh')], { input, encoding: 'utf8' });
      assert.equal(r.status, 0);
      assert.match(r.stderr, /fail-open/);
    }
  });
});

describe('falso positivo — corpus legítimo', () => {
  for (const cmd of corpus('legitimos.txt')) {
    test(`ALLOW: ${cmd.slice(0, 90)}`, () => {
      assert.equal(blocked(run('guard-destructive.sh', cmd)), false, 'destructive bloqueou');
      assert.equal(blocked(run('guard-production.sh', cmd)), false, 'production bloqueou');
    });
  }
});

describe('falso negativo — corpus destrutivo (R2)', () => {
  for (const cmd of corpus('destrutivos.txt')) {
    test(`BLOCK: ${cmd.slice(0, 90)}`, () => assert.equal(blocked(run('guard-destructive.sh', cmd)), true));
  }
});

describe('falso negativo — corpus de produção (R3)', () => {
  for (const cmd of corpus('producao.txt')) {
    test(`BLOCK: ${cmd.slice(0, 90)}`, () => assert.equal(blocked(run('guard-production.sh', cmd)), true));
  }
});

describe('heredoc: menção ≠ execução', () => {
  test("cat >> notas.md <<'EOF' com rm -rf no corpo NÃO bloqueia", () => {
    assert.equal(blocked(run('guard-destructive.sh', "cat >> p.md <<'EOF'\n- lembrar: rm -rf .next\nEOF\ngit status")), false);
  });
  test('heredoc sem aspas com $(rm -rf) bloqueia (bash expande na escrita)', () => {
    assert.equal(blocked(run('guard-destructive.sh', 'cat > notes.md <<EOF\n$(rm -rf dist)\nEOF')), true);
    assert.equal(blocked(run('guard-destructive.sh', 'cat > notes.md <<EOF\n`rm -rf dist`\nEOF')), true);
  });
  test('psql <<SQL com TRUNCATE bloqueia; rm -rf depois do terminador bloqueia', () => {
    assert.equal(blocked(run('guard-destructive.sh', 'psql "$DB" <<SQL\nTRUNCATE TABLE logs;\nSQL')), true);
    assert.equal(blocked(run('guard-destructive.sh', "cat >> x.md <<'EOF'\nnota\nEOF\nrm -rf build")), true);
  });
});

describe('escape hatch', () => {
  const ok = 'autorizado por gabriel em 2026-09-05 — expurgo do build';
  test('motivo preenchido (env) libera e avisa com o motivo', () => {
    const r = run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_DESTRUCTIVE: ok });
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.stdout).systemMessage, /expurgo do build/);
    assert.match(r.stderr, /ESCAPE HATCH/);
  });
  test('motivo vazio NÃO libera', () => {
    assert.equal(blocked(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_DESTRUCTIVE: '' })), true);
    assert.equal(blocked(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_DESTRUCTIVE: '   ' })), true);
  });
  test('variável ausente NÃO libera', () => assert.equal(blocked(run('guard-destructive.sh', 'rm -rf build')), true));
  test('prefixo inline no início libera; comentário no fim ou echo no meio NÃO', () => {
    assert.equal(run('guard-destructive.sh', `GABARITO_ALLOW_DESTRUCTIVE="${ok}" rm -rf build`).code, 0);
    assert.equal(blocked(run('guard-destructive.sh', `rm -rf build # GABARITO_ALLOW_DESTRUCTIVE="${ok}"`)), true);
    assert.equal(blocked(run('guard-destructive.sh', `echo GABARITO_ALLOW_DESTRUCTIVE="${ok}"; rm -rf build`)), true);
  });
  test('motivo curto ("lol") NÃO libera', () => {
    assert.equal(blocked(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_DESTRUCTIVE: 'lol' })), true);
  });
  test('GABARITO_ALLOW_PRODUCTION libera o R3; aviso é JSON válido mesmo com TAB no motivo', () => {
    const r = run('guard-production.sh', 'curl "$API_PROD_URL/x"', { GABARITO_ALLOW_PRODUCTION: 'consulta\tautorizada por gabriel' });
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.stdout).systemMessage, /R3/);
  });
});

describe('configuração do R3', () => {
  test('GABARITO_PROD_PATTERNS_EXTRA soma ao default', () => {
    assert.equal(blocked(run('guard-production.sh', 'curl https://erp.sankhyacloud.com.br/x', { GABARITO_PROD_PATTERNS_EXTRA: 'sankhyacloud\\.com\\.br' })), true);
  });
  test('GABARITO_PROD_PATTERNS substitui o default', () => {
    assert.equal(blocked(run('guard-production.sh', 'curl https://prod.example.com/x', { GABARITO_PROD_PATTERNS: 'foo' })), false);
  });
});

describe('_common.sh — escape hatch por nome (T12)', () => {
  const ok = 'autorizado por gabriel em 2026-09-24 — teste do par medido';
  test('GABARITO_ALLOW_PRODUCTION libera o R2 e GABARITO_ALLOW_DESTRUCTIVE libera o R3 (par medido, README "Escape hatch")', () => {
    assert.equal(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_PRODUCTION: ok }).code, 0);
    assert.equal(run('guard-production.sh', 'curl "$API_PROD_URL/x"', { GABARITO_ALLOW_DESTRUCTIVE: ok }).code, 0);
  });
  test('chamada direta: nome de VAR inválido não entra no eval', () => {
    const injecao = 'GABARITO_CMD="x"; gabarito_escape_hatch "R2" "X; echo INJETADO"; echo "rc=$?"';
    const r = runCommon(injecao, { env: { GABARITO_ALLOW_DESTRUCTIVE: ok } });
    assert.match(r.stdout, /rc=1/);
    assert.doesNotMatch(r.stdout, /INJETADO/);
  });
  test('nome de VAR SEM espaço (não sofre word-splitting em "for v in $vars") não injeta comando no eval: sentinela não criado, hatch não libera', () => {
    // Payload de achado 1 (review T12): sem espaço literal, usa ${IFS} para recompor o
    // separador só DEPOIS, dentro do próprio eval. Single-quoted no snippet para que ${IFS}
    // chegue intacto (não expandido) em `vars`, provando a validação do `case` isoladamente
    // do acidente de word-splitting que protegia o teste anterior.
    const sentinelDir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-hooks-sentinel-')));
    const sentinel = join(sentinelDir, 'PWNED');
    const payload = `x};touch\${IFS}${sentinelDir}/PWNED;x`;
    const snippet = `GABARITO_CMD="x"; gabarito_escape_hatch "R20" '${payload}'; echo "rc=$?"`;
    const r = runCommon(snippet);
    assert.match(r.stdout, /rc=1/);
    assert.equal(existsSync(sentinel), false);
  });
  test('assinatura 1.0.1 (um argumento) continua valendo para o par', () => {
    assert.match(runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R2"; echo "rc=$?"', { env: { GABARITO_ALLOW_PRODUCTION: ok } }).stdout, /rc=0/);
  });
  test('rótulo e origem aparecem no systemMessage', () => {
    const r = runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R2 · rm recursivo" GABARITO_ALLOW_DESTRUCTIVE', { env: { GABARITO_ALLOW_DESTRUCTIVE: ok } });
    const j = JSON.parse(r.stdout);
    assert.match(j.systemMessage, /R2 · rm recursivo, via env/);
    assert.match(j.systemMessage, /teste do par medido/);
  });
});

describe('_common.sh — gabarito_repo_root, gabarito_config_get (T12)', () => {
  test('raiz: subpasta de repo git → toplevel; sem .git → cwd (Review Focus 2)', () => {
    const d = fixtureRepo();
    assert.equal(runCommon('gabarito_repo_root', { cwd: join(d, 'apps', 'api') }).stdout, d);
    const s = fixtureRepo({ git: false });
    assert.equal(runCommon('gabarito_repo_root', { cwd: join(s, 'apps', 'api') }).stdout, join(s, 'apps', 'api'));
  });
  test('config_get: escalar, booleano, número, array (um por linha), objeto (JSON), ausente, sem arquivo, JSON inválido', () => {
    const d = fixtureRepo({ config: {
      versionamento: { resolvidoEm: '2026-09-24', tiposLivres: ['chore', 'docs'] },
      orquestracao: { lembretePorPrompt: true, paralelismo: { simultaneos: 2, limites: { loadPorCoreMax: 1.5 } } },
    } });
    const get = (p, cwd = d) => runCommon(`gabarito_config_get ${p}`, { cwd }).stdout;
    assert.equal(get('versionamento.resolvidoEm').trim(), '2026-09-24');
    assert.equal(get('orquestracao.lembretePorPrompt').trim(), 'true');
    assert.equal(get('orquestracao.paralelismo.simultaneos').trim(), '2');
    assert.deepEqual(get('versionamento.tiposLivres').trim().split('\n'), ['chore', 'docs']);
    assert.deepEqual(JSON.parse(get('orquestracao.paralelismo.limites')), { loadPorCoreMax: 1.5 });
    assert.equal(get('nao.existe'), '');
    assert.equal(get('versionamento.resolvidoEm.x'), '');
    assert.equal(get('versionamento.resolvidoEm', fixtureRepo({ git: false })), '');
    const inv = fixtureRepo({ config: '{"versionamento": {' });
    const r = runCommon('gabarito_config_get versionamento.resolvidoEm; echo "rc=$?"', { cwd: inv });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'rc=0\n');
  });
  test('config_get lê da raiz do git mesmo chamado em apps/api; raiz explícita como 2º argumento', () => {
    const d = fixtureRepo({ config: { fluxo: { idPadrao: '^[A-Z]+-\\d+$' } } });
    assert.equal(runCommon('gabarito_config_get fluxo.idPadrao', { cwd: join(d, 'apps', 'api') }).stdout.trim(), '^[A-Z]+-\\d+$');
    assert.equal(runCommon(`gabarito_config_get fluxo.idPadrao "${d}"`, { cwd: '/' }).stdout.trim(), '^[A-Z]+-\\d+$');
  });
});

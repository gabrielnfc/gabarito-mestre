/**
 * Testes dos hooks do gabarito-mestre — rodam os scripts REAIS (bash) com o JSON que o Claude Code envia.
 *
 * Corpora em ./corpus: legitimos.txt (0 bloqueios esperados), destrutivos.txt e producao.txt (100 % bloqueados).
 * Uma linha = um comando; linhas vazias e `#` são ignoradas. Comandos multi-linha ficam nos casos inline abaixo.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  trocar `exit 2` por `exit 1` em gabarito_deny            → "deny sai com 2"
 *  M2  aceitar motivo vazio no escape hatch — redundante com a checagem de tamanho abaixo
 *      (motivo vazio tem ${#motivo}=0 < 8, já barrado ali); não derruba mais a suíte sozinha,
 *      mas o comportamento externo (motivo vazio não libera) segue coberto por "motivo curto"
 *  M3  remover a checagem de terminador citado no stripper       → "heredoc sem aspas com $(rm -rf) bloqueia"
 *  M4  remover `bash -c`/eval de SHELLEXEC                        → destrutivos.txt (bash -c "rm -rf")
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..');
const PLUGIN = join(HOOKS, '..');

const HATCH_VARS = ['GABARITO_ALLOW_DESTRUCTIVE', 'GABARITO_ALLOW_PRODUCTION', 'GABARITO_ALLOW_VERSIONING'];
function cleanEnv(env = {}) {
  const e = { ...process.env };
  for (const k of [...HATCH_VARS, 'GABARITO_PROD_PATTERNS', 'GABARITO_PROD_PATTERNS_EXTRA', 'CLAUDE_PLUGIN_ROOT']) delete e[k];
  return { ...e, ...env };
}
function run(script, command, env = {}) {
  const r = spawnSync('bash', [join(HOOKS, script)], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Como run(), mas com cwd (o hook resolve a raiz a partir dele) e evento configurável.
function runAt(script, command, { cwd, env = {}, event = 'PreToolUse' } = {}) {
  const payload = event === 'PreToolUse'
    ? { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }
    : { hook_event_name: event, session_id: 'teste', cwd };
  const r = spawnSync('bash', [join(HOOKS, script)], { input: JSON.stringify(payload), encoding: 'utf8', cwd, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Executa um trecho bash com _common.sh carregado (testa as funções sem passar por um hook).
function runCommon(snippet, { cwd = HOOKS, env = {} } = {}) {
  const r = spawnSync('bash', ['-c', `. "${join(HOOKS, '_common.sh')}"; ${snippet}`], { encoding: 'utf8', cwd, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Repo de fixture: tmpdir físico (macOS: /var → /private/var), apps/api/ para o caso monorepo,
// git init + branch órfã nomeada (symbolic-ref funciona sem commit), harness.config.json opcional.
function fixtureRepo({ git = true, branch = 'feat/PBI-1-x', config = null, files = {} } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-hooks-')));
  mkdirSync(join(dir, 'apps', 'api'), { recursive: true });
  if (git) {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir });
  }
  if (config !== null) writeFileSync(join(dir, 'harness.config.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  for (const [rel, txt] of Object.entries(files)) writeFileSync(join(dir, rel), txt);
  return dir;
}
const corpus = (f) =>
  readFileSync(join(here, 'corpus', f), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const blocked = (r) => r.code === 2;

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
  test('GABARITO_ALLOW_VERSIONING NÃO libera R2 nem R3 (hatches não cruzam fora do par)', () => {
    assert.equal(blocked(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_VERSIONING: ok })), true);
    assert.equal(blocked(run('guard-production.sh', 'curl "$API_PROD_URL/x"', { GABARITO_ALLOW_VERSIONING: ok })), true);
  });
  test('chamada direta: VAR nomeada libera só ela (env e inline); nome inválido não entra no eval', () => {
    const snippet = 'GABARITO_CMD="git commit -m x"; gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING; echo "rc=$?"';
    assert.match(runCommon(snippet, { env: { GABARITO_ALLOW_VERSIONING: ok } }).stdout, /rc=0/);
    assert.match(runCommon(snippet, { env: { GABARITO_ALLOW_DESTRUCTIVE: ok } }).stdout, /rc=1/);
    const inline = `GABARITO_CMD='GABARITO_ALLOW_VERSIONING="${ok}" git commit -m x'; gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING; echo "rc=$?"`;
    assert.match(runCommon(inline).stdout, /rc=0/);
    const cruzado = `GABARITO_CMD='GABARITO_ALLOW_DESTRUCTIVE="${ok}" git commit -m x'; gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING; echo "rc=$?"`;
    assert.match(runCommon(cruzado).stdout, /rc=1/);
    const injecao = 'GABARITO_CMD="x"; gabarito_escape_hatch "R20" "X; echo INJETADO"; echo "rc=$?"';
    const r = runCommon(injecao, { env: { GABARITO_ALLOW_VERSIONING: ok } });
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
    assert.match(runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R2"; echo "rc=$?"', { env: { GABARITO_ALLOW_VERSIONING: ok } }).stdout, /rc=1/);
  });
  test('rótulo e origem aparecem no systemMessage', () => {
    const r = runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R20 · cabeçalho" GABARITO_ALLOW_VERSIONING', { env: { GABARITO_ALLOW_VERSIONING: ok } });
    const j = JSON.parse(r.stdout);
    assert.match(j.systemMessage, /R20 · cabeçalho, via env/);
    assert.match(j.systemMessage, /teste do par medido/);
  });
});

describe('_common.sh — gabarito_repo_root, gabarito_config_get, gabarito_ere (T12)', () => {
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
  test('ere: \\d e \\w viram classes POSIX; o resto fica', () => {
    assert.equal(runCommon("gabarito_ere '^[A-Z]+-\\d+$'").stdout, '^[A-Z]+-[0-9]+$');
    assert.equal(runCommon("gabarito_ere '^wt/\\w+-\\d+-\\d+$'").stdout, '^wt/[A-Za-z0-9_]+-[0-9]+-[0-9]+$');
  });
});

/**
 * Testes dos hooks do gabarito-mestre — rodam os scripts REAIS (bash) com o JSON que o Claude Code envia.
 *
 * Corpora em ./corpus: legitimos.txt (0 bloqueios esperados), destrutivos.txt e producao.txt (100 % bloqueados).
 * Uma linha = um comando; linhas vazias e `#` são ignoradas. Comandos multi-linha ficam nos casos inline abaixo.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  trocar `exit 2` por `exit 1` em gabarito_deny            → "deny sai com 2"
 *  M2  aceitar motivo vazio no escape hatch                       → "motivo vazio NÃO libera"
 *  M3  remover a checagem de terminador citado no stripper       → "heredoc sem aspas com $(rm -rf) bloqueia"
 *  M4  remover `bash -c`/eval de SHELLEXEC                        → destrutivos.txt (bash -c "rm -rf")
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..');

function run(script, command, env = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.GABARITO_ALLOW_DESTRUCTIVE;
  delete cleanEnv.GABARITO_ALLOW_PRODUCTION;
  delete cleanEnv.GABARITO_PROD_PATTERNS;
  delete cleanEnv.GABARITO_PROD_PATTERNS_EXTRA;
  const r = spawnSync('bash', [join(HOOKS, script)], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...cleanEnv, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
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

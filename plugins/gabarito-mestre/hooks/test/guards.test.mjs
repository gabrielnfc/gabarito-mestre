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
 *  M5  aceitar GABARITO_ALLOW_VERSIONING no par DESTRUCTIVE/PRODUCTION (_common.sh)   → "VERSIONING NÃO libera R2 nem R3"
 *  M6  guard-versioning: imprimir a linha `git commit` em vez da 1ª linha do heredoc   → corpus PASSA/BLOQUEIA com <<'EOF'
 *  M7  guard-versioning: remover o `case main|master`                                  → "branch main e master"
 *  M8  guard-versioning: remover o exit 0 do fail-open sem resolvidoEm                 → "sem harness.config.json: fail-open"
 *  M12 guard-versioning: trocar gabarito_strip_write_heredocs por cat no SCAN          → corpus PASSA cat >> notas.md <<'EOF' …
 *  M13 guard-versioning: esvaziar POS_LINHA/POS_TEXTO (git em qualquer posição)        → corpus PASSA echo 'git commit -m "wip"'
 *  M14 session-card.sh: remover o `if ! command -v node` (deixar cair no `node "$SCRIPT"` sem node no PATH) → "node ausente"
 *  M15 remind-orchestrator.sh: trocar `Number.isInteger(s)` por checagem que aceita float/string          → "slots não inteiro cai no fallback"
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

// PATH mínimo (bash, git, dirname, cat, head, sed, mktemp — todos em /bin ou /usr/bin nos runners
// suportados) que não inclui o diretório onde `node` normalmente vive (/usr/local/bin, homebrew, nvm…).
// B10 (T25b, handoff §B.10): prova o ramo "node ausente" sem stub — comando de verdade some do PATH.
const PATH_SEM_NODE = '/bin:/usr/bin:/usr/sbin:/sbin';
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

// Plugin falso: só o que os hooks chamam. ${root}/${plugin} no cartão viram os argumentos recebidos;
// ${pid} (RULING F3-R1) vira process.env.GABARITO_PID_RAIZ visto pelo script Node.
function fakePluginRoot({
  cartao = ['GABARITO · cartão FAKE', 'root=${root}', 'plugin=${plugin}', 'linha com "aspas", \\ barra\te tab'],
  cartaoExit = 0,
  semCartao = false,
  capacidade = '{"slots":3,"motivo":"load ok"}',
  capacidadeExit = 0,
  semCapacidade = false,
} = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-plugin-')));
  mkdirSync(join(dir, 'gates', 'scripts'), { recursive: true });
  if (!semCartao) {
    writeFileSync(join(dir, 'gates', 'scripts', 'cartao-sessao.mjs'), `
const a = process.argv.slice(2);
const root = a[a.indexOf('--root') + 1]; const plugin = a[a.indexOf('--plugin-root') + 1];
const pid = process.env.GABARITO_PID_RAIZ || '';
const linhas = ${JSON.stringify(cartao)}.map((l) => l.replace('\${root}', root).replace('\${plugin}', plugin).replace('\${pid}', pid));
process.stdout.write(linhas.join('\\n') + '\\n');
process.exit(${cartaoExit});
`);
  }
  if (!semCapacidade) {
    // ${pid} (RULING F3-R2) vira process.env.GABARITO_PID_RAIZ, lido em runtime pelo script Node —
    // mesmo padrão do ${pid} de cartao-sessao.mjs acima. Sem ${pid} na string, o .replace() é no-op.
    writeFileSync(join(dir, 'gates', 'scripts', 'capacidade.mjs'), `
const pid = process.env.GABARITO_PID_RAIZ || '';
process.stdout.write(${JSON.stringify(capacidade)}.replace('\${pid}', pid));
process.exit(${capacidadeExit});
`);
  }
  return dir;
}
const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput;

describe('session-card.sh — ORQ-3 (T14)', () => {
  test('injeta additionalContext em SessionStart; --root é o toplevel do git mesmo em apps/api; --plugin-root é CLAUDE_PLUGIN_ROOT', () => {
    const plugin = fakePluginRoot();
    const repo = fixtureRepo();
    const r = runAt('session-card.sh', '', { cwd: join(repo, 'apps', 'api'), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const h = ctx(r);
    assert.equal(h.hookEventName, 'SessionStart');
    assert.match(h.additionalContext, /^GABARITO · cartão FAKE\n/);
    assert.ok(h.additionalContext.includes(`root=${repo}\n`), h.additionalContext);
    assert.ok(h.additionalContext.includes(`plugin=${plugin}\n`), h.additionalContext);
  });
  test('sem .git: --root é o cwd (Review Focus 2)', () => {
    const plugin = fakePluginRoot();
    const solto = fixtureRepo({ git: false });
    const r = runAt('session-card.sh', '', { cwd: join(solto, 'apps', 'api'), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.ok(ctx(r).additionalContext.includes(`root=${join(solto, 'apps', 'api')}\n`));
  });
  test('JSON válido com aspas, barra invertida e tab no cartão', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot() }, event: 'SessionStart' });
    assert.ok(ctx(r).additionalContext.includes('linha com "aspas", \\ barra\te tab'));
  });
  test('≤ 40 linhas mesmo se o script devolver 60', () => {
    const plugin = fakePluginRoot({ cartao: Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`) });
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    const linhas = ctx(r).additionalContext.split('\n');
    assert.equal(linhas.length, 40);
    assert.equal(linhas[39], 'linha 40');
  });
  test('script sai com 1 → exit 0, stdout vazio, fail-open declarado em stderr', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ cartaoExit: 1 }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cartao-sessao\.mjs saiu com 1.*fail-open declarado/);
  });
  test('CLAUDE_PLUGIN_ROOT sem gates/scripts/cartao-sessao.mjs → exit 0, fail-open declarado', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ semCartao: true }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cartao-sessao\.mjs ausente.*fail-open declarado/);
  });
  // B10 (T25b, handoff §B.10): ramo "node ausente" — PATH real sem `node`, sem stub de fakePluginRoot
  // (a checagem `command -v node` roda antes de qualquer coisa tocar em gates/scripts/cartao-sessao.mjs).
  test('node ausente do PATH → exit 0, stdout vazio, fail-open declarado em stderr (M14)', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot(), PATH: PATH_SEM_NODE }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /node ausente.*fail-open declarado/);
  });
  test('cartão vazio (só espaço) → exit 0 sem saída', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ cartao: ['', '  '] }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('stdin vazio (sem JSON) não quebra', () => {
    const r = spawnSync('bash', [join(HOOKS, 'session-card.sh')], { input: '', encoding: 'utf8', cwd: fixtureRepo(), env: cleanEnv({ CLAUDE_PLUGIN_ROOT: fakePluginRoot() }) });
    assert.equal(r.status, 0);
    assert.equal(ctx({ stdout: r.stdout }).hookEventName, 'SessionStart');
  });
  test('GABARITO_PID_RAIZ (RULING F3-R1): exportado antes de chamar o node, com o PID de quem abriu o bash do hook', () => {
    // spawnSync executa bash diretamente (sem shell intermediário): o pai do bash é este processo de teste.
    const plugin = fakePluginRoot({ cartao: ['${pid}'] });
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const texto = ctx(r).additionalContext;
    assert.notEqual(texto.trim(), '');
    assert.equal(texto.trim(), String(process.pid));
  });
  const REAL = join(PLUGIN, 'gates', 'scripts', 'cartao-sessao.mjs');
  test('smoke com o cartao-sessao.mjs real: repo sem onboarding → uma linha "sem onboarding"', { skip: !existsSync(REAL) && 'T9 ainda não integrada' }, () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo({ config: {} }), env: { CLAUDE_PLUGIN_ROOT: PLUGIN }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const texto = ctx(r).additionalContext;
    assert.match(texto, /sem onboarding/);
    assert.equal(texto.split('\n').length, 1);
  });
});

describe('remind-orchestrator.sh — ORQ-4 (T15)', () => {
  const ligado = { orquestracao: { lembretePorPrompt: true, paralelismo: { simultaneos: 2, teto: 4 } } };
  const remind = (cwd, plugin) => runAt('remind-orchestrator.sh', '', { cwd, env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'UserPromptSubmit' });

  test('lembretePorPrompt true: uma linha R21 com slots vindos de capacidade.mjs', () => {
    const r = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":3,"motivo":"load ok"}' }));
    assert.equal(r.code, 0, r.stderr);
    const h = ctx(r);
    assert.equal(h.hookEventName, 'UserPromptSubmit');
    assert.equal(h.additionalContext, 'R21: despache, não implemente · slots: 3');
  });
  test('lembretePorPrompt false: exit 0, stdout vazio', () => {
    const r = remind(fixtureRepo({ config: { orquestracao: { lembretePorPrompt: false } } }), fakePluginRoot());
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('config sem a chave: desligado, fail-open declarado em stderr; sem harness.config.json: silêncio total', () => {
    const r1 = remind(fixtureRepo({ config: { fluxo: {} } }), fakePluginRoot());
    assert.equal(r1.code, 0); assert.equal(r1.stdout, ''); assert.match(r1.stderr, /lembretePorPrompt.*fail-open declarado/);
    const r2 = remind(fixtureRepo(), fakePluginRoot());
    assert.equal(r2.code, 0); assert.equal(r2.stdout, ''); assert.equal(r2.stderr, '');
  });
  test('capacidade.mjs falha ou falta: slots vêm de paralelismo.simultaneos marcados "(config)"', () => {
    const r1 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '', capacidadeExit: 1 }));
    assert.equal(ctx(r1).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r2 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ semCapacidade: true }));
    assert.equal(ctx(r2).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r3 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: 'não é json' }));
    assert.equal(ctx(r3).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  // B10 (T25b, handoff §B.10): capacidade.mjs devolve JSON válido, mas `slots` não é inteiro
  // (float ou string) — `Number.isInteger(s)` tem de rejeitar e cair no fallback "(config)" (M15).
  test('slots não inteiro vindo de capacidade.mjs (float ou string): cai no fallback "(config)"', () => {
    const r1 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":3.5,"motivo":"load parcial"}' }));
    assert.equal(ctx(r1).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r2 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":"3","motivo":"string"}' }));
    assert.equal(ctx(r2).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  test('sem simultaneos no config e sem capacidade: default 2 (config)', () => {
    const r = remind(fixtureRepo({ config: { orquestracao: { lembretePorPrompt: true } } }), fakePluginRoot({ semCapacidade: true }));
    assert.equal(ctx(r).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  test('nunca exit 2: JSON inválido, stdin vazio, plugin root inexistente', () => {
    const casos = [
      remind(fixtureRepo({ config: '{"orquestracao": {' }), fakePluginRoot()),
      remind(fixtureRepo({ config: ligado }), '/caminho/que/nao/existe'),
      { code: spawnSync('bash', [join(HOOKS, 'remind-orchestrator.sh')], { input: '', encoding: 'utf8', cwd: fixtureRepo({ config: ligado }), env: cleanEnv({ CLAUDE_PLUGIN_ROOT: fakePluginRoot() }) }).status },
    ];
    for (const r of casos) assert.equal(r.code, 0);
  });
  test('monorepo: lembrete ligado na raiz vale em apps/api', () => {
    const repo = fixtureRepo({ config: ligado });
    const r = remind(join(repo, 'apps', 'api'), fakePluginRoot());
    assert.match(ctx(r).additionalContext, /^R21: despache/);
  });
  // RULING F3-R2 (emenda fase 2 → fase 3, vence o brief): antes de chamar capacidade.mjs, o hook exporta
  // GABARITO_PID_RAIZ=$PPID (senão process.ppid dentro do node seria o bash do hook, não o Claude Code —
  // mesmo raciocínio de F3-R1 em session-card.sh). O fake de capacidade.mjs eco o pid recebido no campo
  // `slots` (valor numérico válido); spawnSync roda bash sem shell intermediário, então o pai do bash
  // é este processo de teste — String(process.pid) tem de aparecer no slots devolvido.
  test('RULING F3-R2: GABARITO_PID_RAIZ exportado antes de chamar capacidade.mjs, com o pid de quem abriu o bash do hook', () => {
    const r = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":${pid},"motivo":"eco pid"}' }));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(ctx(r).additionalContext, `R21: despache, não implemente · slots: ${process.pid}`);
  });
});

describe('hooks.json — registro dos hooks (T16)', () => {
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const cmds = (grupo) => grupo.hooks.map((h) => h.command);

  test('PreToolUse/Bash: os três guards, nesta ordem, timeout 10, shell bash', () => {
    assert.equal(cfg.PreToolUse.length, 1);
    const g = cfg.PreToolUse[0];
    assert.equal(g.matcher, 'Bash');
    assert.deepEqual(cmds(g), [
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-destructive.sh"',
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-production.sh"',
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-versioning.sh"',
    ]);
    for (const h of g.hooks) { assert.equal(h.type, 'command'); assert.equal(h.shell, 'bash'); assert.equal(h.timeout, 10); }
  });
  test('SessionStart tem session-card com matcher startup|resume|clear|compact e timeout 30', () => {
    assert.equal(cfg.SessionStart.length, 1);
    const g = cfg.SessionStart[0];
    assert.equal(g.matcher, 'startup|resume|clear|compact');
    assert.deepEqual(cmds(g), ['bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-card.sh"']);
    assert.equal(g.hooks[0].timeout, 30);
  });
  test('UserPromptSubmit tem remind-orchestrator sem matcher e timeout 5', () => {
    assert.equal(cfg.UserPromptSubmit.length, 1);
    const g = cfg.UserPromptSubmit[0];
    assert.equal(g.matcher, undefined);
    assert.deepEqual(cmds(g), ['bash "${CLAUDE_PLUGIN_ROOT}/hooks/remind-orchestrator.sh"']);
    assert.equal(g.hooks[0].timeout, 5);
  });
  test('todo comando aponta para um script existente em hooks/ com shebang bash', () => {
    for (const grupos of Object.values(cfg)) for (const g of grupos) for (const h of g.hooks) {
      const m = h.command.match(/^bash "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([a-z-]+\.sh)"$/);
      assert.ok(m, h.command);
      const p = join(HOOKS, m[1]);
      assert.ok(existsSync(p), p);
      assert.match(readFileSync(p, 'utf8').split('\n')[0], /^#!\/usr\/bin\/env bash$/);
    }
  });
  test('plugin.json não declara "hooks" (chave duplicada quebra o load)', () => {
    const pj = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(pj.hooks, undefined);
  });
});

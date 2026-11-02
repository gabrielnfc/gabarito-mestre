/**
 * Helpers compartilhados dos testes de hook (GM-9 T1a: separados de guards.test.mjs para que T4, T5 e T7
 * editem arquivos diferentes). Não é um teste: o glob `*.test.mjs` não o pega.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const HOOKS = join(here, '..');
export const PLUGIN = join(HOOKS, '..');

// PATH mínimo (bash, git, dirname, cat, head, sed, mktemp — todos em /bin ou /usr/bin nos runners
// suportados) que não inclui o diretório onde `node` normalmente vive (/usr/local/bin, homebrew, nvm…).
// B10 (T25b, handoff §B.10): prova o ramo "node ausente" sem stub — comando de verdade some do PATH.
export const PATH_SEM_NODE = '/bin:/usr/bin:/usr/sbin:/sbin';
export const HATCH_VARS = ['GABARITO_ALLOW_DESTRUCTIVE', 'GABARITO_ALLOW_PRODUCTION', 'GABARITO_ALLOW_VERSIONING'];
export function cleanEnv(env = {}) {
  const e = { ...process.env };
  for (const k of [...HATCH_VARS, 'GABARITO_PROD_PATTERNS', 'GABARITO_PROD_PATTERNS_EXTRA', 'CLAUDE_PLUGIN_ROOT']) delete e[k];
  return { ...e, ...env };
}
export function run(script, command, env = {}) {
  const r = spawnSync('bash', [join(HOOKS, script)], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Como run(), mas com cwd (o hook resolve a raiz a partir dele) e evento configurável.
export function runAt(script, command, { cwd, env = {}, event = 'PreToolUse' } = {}) {
  const payload = event === 'PreToolUse'
    ? { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }
    : { hook_event_name: event, session_id: 'teste', cwd };
  const r = spawnSync('bash', [join(HOOKS, script)], { input: JSON.stringify(payload), encoding: 'utf8', cwd, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Executa um trecho bash com _common.sh carregado (testa as funções sem passar por um hook).
export function runCommon(snippet, { cwd = HOOKS, env = {} } = {}) {
  const r = spawnSync('bash', ['-c', `. "${join(HOOKS, '_common.sh')}"; ${snippet}`], { encoding: 'utf8', cwd, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Repo de fixture: tmpdir físico (macOS: /var → /private/var), apps/api/ para o caso monorepo,
// git init + branch órfã nomeada (symbolic-ref funciona sem commit), harness.config.json opcional.
export function fixtureRepo({ git = true, branch = 'feat/PBI-1-x', config = null, files = {} } = {}) {
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
export const corpus = (f) =>
  readFileSync(join(here, 'corpus', f), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
export const blocked = (r) => r.code === 2;

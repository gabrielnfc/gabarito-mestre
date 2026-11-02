/**
 * Testes do registro de hooks em hooks.json (T16) — separados de guards.test.mjs (GM-9 T1a).
 * Helpers em ./_comum.mjs; corpora em ./corpus. Mutações prescritas: ver o cabeçalho histórico em git (guards.test.mjs, antes do GM-9 T1a).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOOKS, PLUGIN } from './_comum.mjs';

describe('hooks.json — registro dos hooks (T16)', () => {
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const cmds = (grupo) => grupo.hooks.map((h) => h.command);

  test('PreToolUse/Bash: os dois guards (R2, R3), nesta ordem — versionamento é hook git, não PreToolUse, timeout 10, shell bash', () => {
    assert.equal(cfg.PreToolUse.length, 1);
    const g = cfg.PreToolUse[0];
    assert.equal(g.matcher, 'Bash');
    assert.deepEqual(cmds(g), [
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-destructive.sh"',
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-production.sh"',
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

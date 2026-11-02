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

  test('PreToolUse: três matchers (Bash, Edit|Write|Read|Grep, mcp__.*), o mesmo comando node da guarda, timeout 5', () => {
    assert.deepEqual(cfg.PreToolUse.map((g) => g.matcher), ['Bash', 'Edit|Write|Read|Grep', 'mcp__.*']);
    for (const g of cfg.PreToolUse) {
      assert.deepEqual(cmds(g), ['node "${CLAUDE_PLUGIN_ROOT}/gates/dist/guarda.js"']);
      for (const h of g.hooks) { assert.equal(h.type, 'command'); assert.equal(h.timeout, 5); }
    }
    assert.ok(existsSync(join(PLUGIN, 'gates', 'dist', 'guarda.js')));
  });
  test('os guards bash antigos não existem nem são citados (R2/R3 vivem em guarda.js)', () => {
    // nomes montados por partes: o texto.test.sh proíbe citá-los em qualquer arquivo de plugins/**
    const nomes = ['destructive', 'production', 'versioning'].map((n) => ['guard', n].join('-'));
    const bruto = readFileSync(join(HOOKS, 'hooks.json'), 'utf8');
    for (const n of nomes) {
      assert.equal(bruto.includes(n), false, n);
      assert.equal(existsSync(join(HOOKS, `${n}.sh`)), false, `${n}.sh`);
    }
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
  test('todo comando bash aponta para um script existente em hooks/ com shebang bash', () => {
    for (const grupos of Object.values(cfg)) for (const g of grupos) for (const h of g.hooks) {
      if (h.command.startsWith('node ')) continue; // guarda.js: coberto no teste dos matchers
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

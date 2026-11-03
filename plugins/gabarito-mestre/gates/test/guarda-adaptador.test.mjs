/** Adaptador do hook (T4) — payload, raiz, spawn, saída. Cabeçalho (mutações prescritas) e helpers em _adaptador-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, git, montar, sessaoNova, rodarBruto, rodar, eventosDe } from './_adaptador-helpers.mjs';

describe('payload malformado: exit 0, sem decisão, aviso em stderr', () => {
  test('guarda-payload-json-invalido', () => {
    const r = rodarBruto('{isto nao e json');
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
  });

  test('guarda-payload-stdin-vazio', () => {
    const r = rodarBruto('');
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
  });

  test('guarda-payload-sem-input: sem tool_input', () => {
    const r = rodarBruto(JSON.stringify({ tool_name: 'Bash', session_id: 'x' }));
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
  });

  test('guarda-payload-command-nao-string', () => {
    for (const command of [42, null, ['ls'], { a: 1 }]) {
      const r = rodarBruto(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'x' }));
      assert.equal(r.status, 0, JSON.stringify(command));
      assert.equal(r.decisao, undefined, JSON.stringify(command));
      assert.match(r.stderr, /\S/, JSON.stringify(command));
    }
  });

  test('guarda-payload-nao-objeto: array, número, null', () => {
    for (const bruto of ['[]', '7', 'null', '"x"']) {
      const r = rodarBruto(bruto);
      assert.equal(r.status, 0, bruto);
      assert.equal(r.decisao, undefined, bruto);
    }
  });

  test('guarda-payload-gigante: 10 MB de comando pede em vez de ignorar (Q17) e termina rápido', () => {
    const repo = montar();
    const t0 = performance.now();
    const r = rodar(repo, 'Bash', { command: `echo ${'x'.repeat(10 * 1024 * 1024)}` });
    const ms = performance.now() - t0;
    assert.equal(r.status, 0);
    assert.equal(r.decisao, 'ask');
    assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
  });

  test('guarda-agent-id-vazio: vale como orquestrador (ask, não deny)', () => {
    const repo = montar();
    const r = rodar(repo, 'Read', { file_path: join(repo, '.env') }, { agent_id: '' });
    assert.equal(r.decisao, 'ask');
  });
});

describe('raiz do repo', () => {
  test('guarda-cwd-fora-repo: sem git ⇒ exit 0, sem decisão, aviso em stderr, nada gravado', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-fora-')));
    const r = rodarBruto(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: sessaoNova(), cwd: fora }), { cwd: fora });
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
    assert.equal(existsSync(join(fora, '.harness')), false);
  });

  test('guarda-cwd-fora-repo-segredo: o anel de segredo vale mesmo sem repo', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-fora-')));
    const r = rodarBruto(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: join(fora, '.env') }, session_id: sessaoNova(), cwd: fora }), { cwd: fora });
    assert.equal(r.status, 0);
    assert.equal(r.decisao, 'ask');
  });
});

describe('Q14: a config vem da raiz da sessão', () => {
  test('config-da-raiz-da-sessao-nao-do-cwd: cwd noutro repo (com permitidos ["*"]) não troca config nem diário', () => {
    const sessao = montar();
    const outro = montar({ origem: { ...CONFIG, guarda: { ...CONFIG.guarda, producao: { permitidos: ['*'] } } } });
    const entrada = { tool_name: 'Bash', tool_input: { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" }, session_id: sessaoNova(), cwd: outro };
    const r = rodarBruto(JSON.stringify(entrada), { cwd: outro, env: { CLAUDE_PROJECT_DIR: sessao } });
    assert.equal(r.decisao, 'ask', 'vale a config do repo da sessão (sem permitidos), não a do cwd');
    assert.equal(eventosDe(sessao).length, 1, 'o diário é da raiz da sessão');
    assert.equal(eventosDe(outro).length, 0, 'nada gravado no repo do cwd');
  });
});


describe('spawn só quando precisa', () => {
  const traceDe = (repo, command) => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-adapt-trace-'));
    const trace = join(tmp, 'trace.txt');
    writeFileSync(trace, '');
    const entrada = { tool_name: 'Bash', tool_input: { command }, session_id: sessaoNova(), cwd: repo };
    rodarBruto(JSON.stringify(entrada), { repo, env: { GIT_TRACE: trace } });
    return readFileSync(trace, 'utf8');
  };

  test('sem-contexto-sem-spawn: `ls` não chama `git symbolic-ref`; `git status` chama (controle)', () => {
    const repo = montar();
    assert.doesNotMatch(traceDe(repo, 'ls'), /symbolic-ref/);
    assert.match(traceDe(repo, 'git status'), /symbolic-ref/);
  });
});

/**
 * Cópia de `dist/` com uma falha injetada em um ponto do hook (o `dist` real não tem gancho de teste).
 * Cada ponto insere `throw` na entrada da função; `writeSync` e `JSON.stringify` têm modos próprios.
 */

describe('saída', () => {
  test('saida-nunca-allow: nenhuma entrada devolve allow, e hookEventName é PreToolUse', () => {
    const repo = montar();
    const casos = [
      ['Bash', { command: 'ls' }],
      ['Bash', { command: 'rm -rf .next' }],
      ['Bash', { command: 'vercel --prod' }],
      ['Bash', { command: 'curl https://api.exemplo.com/x' }],
      ['Read', { file_path: join(repo, '.env') }],
      ['Edit', { file_path: join(repo, 'harness.config.json'), old_string: 'a', new_string: 'b' }],
      ['mcp__x__y', { q: 1 }],
    ];
    for (const [tool, input] of casos) {
      for (const extra of [{}, { agent_id: 'a1' }]) {
        const r = rodar(repo, tool, input, extra);
        assert.equal(r.status, 0);
        assert.notEqual(r.decisao, 'allow', `${tool} ${JSON.stringify(input)}`);
        if (r.stdout.trim() !== '') {
          const saida = JSON.parse(r.stdout);
          if (saida.hookSpecificOutput) {
            assert.equal(saida.hookSpecificOutput.hookEventName, 'PreToolUse');
            assert.ok(['ask', 'deny'].includes(saida.hookSpecificOutput.permissionDecision));
            assert.match(saida.hookSpecificOutput.permissionDecisionReason, /\S/);
          }
        }
      }
    }
  });

  test('sem-decisao-sem-saida: comando benigno não imprime nada', () => {
    const repo = montar();
    const r = rodar(repo, 'Bash', { command: 'ls' });
    assert.equal(r.stdout, '');
    assert.equal(r.status, 0);
  });
});

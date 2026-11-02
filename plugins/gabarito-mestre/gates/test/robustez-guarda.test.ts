/**
 * Robustez do classificador e da decisão (T2 rodada 1, item 16): exceção vira fail-open no hook, então
 * entrada malformada e comando gigante não podem lançar nem demorar.
 *
 * MUTAÇÕES PRESCRITAS:
 *  R1  aceitar `tool_input` nulo sem checar ⇒ `entrada-malformada-nao-lanca` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidir } from '../src/decidir.ts';
import { precisaContexto } from '../src/classificar-alvo.ts';
import type { ConfigGuarda, Contexto, EntradaHook } from '../src/tipos.ts';

const CONFIG: ConfigGuarda = {
  ambientes: { prod: { hosts: ['api.exemplo.com'], mcps: ['mcp__supabase_prod__'], branches: ['main'] } },
  permitidos: [],
};
const CTX: Contexto = { branchAtual: 'feat/x', refLinkado: null, remoteUrl: null, raiz: '/repo', pluginRoot: '/plugin' };

function bash(command: string): EntradaHook {
  return { tool_name: 'Bash', tool_input: { command }, cwd: '/repo' };
}

describe('robustez da guarda', () => {
  test('entrada-malformada-nao-lanca: tool_input nulo, tool_name ausente, tipos trocados', () => {
    const entradas = [
      { tool_name: 'Bash', tool_input: null },
      { tool_name: 'Read', tool_input: null },
      { tool_name: 'mcp__supabase_prod__execute_sql', tool_input: null },
      { tool_name: 'Bash', tool_input: undefined },
      { tool_input: { command: 'ls' } },
      { tool_name: 'Bash', tool_input: { command: 42 } },
      { tool_name: 'Read', tool_input: { file_path: 7 } },
      { tool_name: 'Bash', tool_input: [] },
      {},
    ] as unknown as EntradaHook[];
    for (const e of entradas) {
      assert.doesNotThrow(() => decidir(e, CONFIG, CTX), JSON.stringify(e));
      assert.doesNotThrow(() => precisaContexto(e), JSON.stringify(e));
    }
  });

  test('argumentos-em-massa-nao-estouram-a-pilha: 200 mil tokens em cat, rm e cp', () => {
    const muitos = 'a '.repeat(100000);
    for (const cmd of ['cat', 'rm', 'cp', 'tee', 'git add']) {
      assert.doesNotThrow(() => decidir(bash(`${cmd} ${muitos}`), CONFIG, CTX), cmd);
    }
  });

  test('comando-de-1mb-e-rapido: 1 MB de `env -a` em menos de 100 ms', () => {
    for (const comando of [`env ${'-a '.repeat(350000)}ls`, `${'ls; '.repeat(260000)}`, `echo ${'x'.repeat(1 << 20)}`]) {
      const t0 = performance.now();
      decidir(bash(comando), CONFIG, CTX);
      const ms = performance.now() - t0;
      assert.ok(ms < 100, `${comando.length} bytes levaram ${ms.toFixed(1)} ms`);
    }
  });

  test('so-o-prefixo-vale-acima-do-teto: o que passa de 64 KB é ignorado, o início vale', () => {
    const d = decidir(bash(`vercel --prod ${'x'.repeat(100000)}`), CONFIG, CTX);
    assert.equal(d.faixa, 'ask');
  });
});

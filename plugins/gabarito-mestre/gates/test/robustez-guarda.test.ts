/**
 * Robustez do classificador e da decisão (T2 rodada 1, item 16): exceção vira fail-open no hook, então
 * entrada malformada e comando gigante não podem lançar nem demorar.
 *
 * MUTAÇÕES PRESCRITAS:
 *  R1  aceitar `tool_input` nulo sem checar ⇒ `entrada-malformada-nao-lanca` falha
 *  R3  remover o limite de comprimento do `cd` em `anelDeBash` ⇒ `cd-em-cadeia-nao-e-quadratico` falha
 *  R2  remover a checagem de tamanho em `decidir` ⇒ `teto-pede-em-vez-de-ignorar` e `teto-fronteira` falham
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

  test('cd-em-cadeia-nao-e-quadratico: 13 mil `cd a;` (65 KB) em menos de 100 ms', () => {
    const t0 = performance.now();
    decidir(bash('cd a;'.repeat(13000)), CONFIG, CTX);
    const ms = performance.now() - t0;
    assert.ok(ms < 100, `65 KB de cd levaram ${ms.toFixed(1)} ms`);
  });

  test('cd-perdido-pede: acima de LIMITE_CD a guarda perdeu o diretório e pede (orq) ou nega (sub), com motivo teto e sem o comando', () => {
    const casos = [
      bash(`${'cd a;'.repeat(2100)} cd /repo/.git; echo x > config`),
      bash(`cd ${'a'.repeat(4091)}; cd /repo/.git; echo x > config`),
      bash(`${'cd a;'.repeat(2100)} echo ok`),
    ];
    for (const e of casos) {
      const o = decidir(e, CONFIG, CTX);
      assert.equal(o.faixa, 'ask');
      assert.equal(o.evento?.tipo, 'guarda.ask');
      assert.equal(o.evento?.dados.motivo, 'teto');
      assert.equal(o.evento?.dados.chars, e.tool_input.command.length);
      const s = decidir({ ...e, agent_id: 'a1' }, CONFIG, CTX);
      assert.equal(s.faixa, 'deny');
      assert.equal(s.evento?.tipo, 'guarda.deny');
      assert.equal(s.evento?.dados.motivo, 'teto');
      const saida = JSON.stringify([o.evento, o.systemMessage, o.motivo, s.evento, s.motivo]);
      assert.equal(saida.includes('echo x'), false);
      assert.equal(saida.includes('cd a;cd a'), false);
    }
  });

  test('cd-limite-fronteira: caminho de 4096 caracteres segue sem decisão, 4097 pede; cd benigno abaixo do limite segue sem decisão', () => {
    assert.equal(decidir(bash(`cd ${'a'.repeat(4090)}; echo ok`), CONFIG, CTX).faixa, 'silencio'); // /repo/ + 4090 = 4096
    assert.equal(decidir(bash(`cd ${'a'.repeat(4091)}; echo ok`), CONFIG, CTX).faixa, 'ask'); // 4097
    assert.equal(decidir(bash(`${'cd a;'.repeat(900)} echo ok`), CONFIG, CTX).faixa, 'silencio');
    assert.equal(decidir({ ...bash(`${'cd a;'.repeat(900)} echo ok`), agent_id: 'a1' }, CONFIG, CTX).faixa, 'silencio');
  });

  test('cd-perdido-nao-sobrepoe: ask/deny já obtido prevalece sobre o motivo teto', () => {
    const e = bash(`${'cd a;'.repeat(2100)} cat .env`);
    const s = decidir({ ...e, agent_id: 'a1' }, CONFIG, CTX);
    assert.equal(s.faixa, 'deny');
    assert.equal(s.evento?.dados.motivo, undefined);
    assert.equal(s.evento?.dados.anel, 'segredo');
    assert.equal(decidir(e, CONFIG, CTX).evento?.dados.motivo, undefined);
  });

  test('teto-pede-em-vez-de-ignorar: acima de 64 KB a cauda perigosa vira ask (orq) ou deny (sub), com motivo e sem o comando', () => {
    const cauda = bash(`echo ${'x'.repeat(70000)} && rm .env`);
    const o = decidir(cauda, CONFIG, CTX);
    assert.equal(o.faixa, 'ask');
    assert.equal(o.evento?.tipo, 'guarda.ask');
    assert.equal(o.evento?.dados.motivo, 'teto');
    assert.equal(o.evento?.dados.chars, cauda.tool_input.command.length);
    assert.equal(decidir({ ...cauda, agent_id: 'a1' }, CONFIG, CTX).faixa, 'deny');
    // O evento e as mensagens não carregam o comando.
    const saida = JSON.stringify([o.evento, o.systemMessage, o.motivo, o.classificacao.alvo]);
    assert.equal(saida.includes('xxxxxxxx'), false);
    assert.equal(saida.includes('rm .env'), false);
  });

  test('teto-fronteira: 65 536 caracteres passam, 65 537 pedem; conta unidades UTF-16', () => {
    assert.equal(decidir(bash('x'.repeat(65536)), CONFIG, CTX).faixa, 'silencio');
    assert.equal(decidir(bash('x'.repeat(65537)), CONFIG, CTX).faixa, 'ask');
    assert.equal(decidir(bash('\u{1F600}'.repeat(32768)), CONFIG, CTX).faixa, 'silencio'); // 65 536 unidades, 131 072 bytes
    assert.equal(decidir(bash('\u{1F600}'.repeat(32768) + 'x'), CONFIG, CTX).faixa, 'ask');
    assert.equal(decidir(bash('é'.repeat(40000)), CONFIG, CTX).faixa, 'silencio'); // 80 KB em UTF-8, abaixo do teto em caracteres
  });

  test('teto-prefixo-prevalece: ask/deny do início vale e não ganha dados de teto', () => {
    const o = decidir(bash(`rm .env ${'x'.repeat(70000)}`), CONFIG, CTX);
    assert.equal(o.faixa, 'ask');
    assert.equal(o.evento?.dados.motivo, undefined);
    const d = decidir({ ...bash(`rm .env ${'x'.repeat(70000)}`), agent_id: 'a1' }, CONFIG, CTX);
    assert.equal(d.faixa, 'deny');
    assert.equal(d.evento?.dados.motivo, undefined);
  });

  test('teto-so-bash: Edit, Read e MCP gigantes não são afetados', () => {
    const grande = 'x'.repeat(200000);
    assert.equal(decidir({ tool_name: 'Edit', tool_input: { file_path: 'a.txt', old_string: grande, new_string: grande }, cwd: '/repo' }, CONFIG, CTX).faixa, 'silencio');
    assert.equal(decidir({ tool_name: 'Read', tool_input: { file_path: `${grande}.txt` }, cwd: '/repo' }, CONFIG, CTX).faixa, 'silencio');
    assert.equal(decidir({ tool_name: 'mcp__outro__tool', tool_input: { query: grande } }, CONFIG, CTX).faixa, 'silencio');
    assert.equal(decidir({ tool_name: 'Bash', tool_input: { command: grande }, agent_id: 'a1' }, CONFIG, CTX).faixa, 'deny');
  });
});

/**
 * Leitura em produção pede (Q26). Ataques à regra "todo segmento `prod`, de qualquer ação, precisa casar `permitidos[]`".
 * O corpus (hooks/test/corpus) cobre os vereditos simples; aqui ficam as composições e as configurações próprias.
 *
 * MUTAÇÕES PRESCRITAS:
 *  P1  `permitido()` olhar só `prod/escrita` ⇒ `permitidos-leitura` (corpus) e `permitidos-um-de-dois-segmentos` falham
 *  P2  `permitidos` valer para subagent ⇒ `permitidos-leitura-nao-vale-sub` (corpus) e `mcp-permitido-nao-vale-sub` falham
 *  P3  voltar leitura em prod para `mostrar` ⇒ `prod-leitura` e `mcp-prod-list` (corpus) falham
 *  P4  `permitido()` aceitar o conjunto vazio de padrões ⇒ `sem-remoto-permitidos-vazio-pede` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidir } from '../src/decidir.ts';
import type { ConfigGuarda, Contexto, EntradaHook } from '../src/tipos.ts';

const BASE: ConfigGuarda = {
  ambientes: {
    teste: { hosts: ['127.0.0.1', 'localhost'], bancos: ['127.0.0.1'], mcps: ['mcp__supabase_local__'] },
    homolog: { hosts: ['staging.exemplo.com'], bancos: ['db.homolog.exemplo.com'] },
    prod: { hosts: ['api.exemplo.com'], bancos: ['db.prod.exemplo.com'], mcps: ['mcp__supabase_prod__'] },
  },
  permitidos: [],
} as unknown as ConfigGuarda;

const CTX: Contexto = { branchAtual: 'feat/GM-1-x', refLinkado: null, remoteUrl: 'git@github.com:org/app.git', raiz: '/repo', pluginRoot: '/plugin' };

function cfg(permitidos: string[]): ConfigGuarda {
  return { ...BASE, permitidos } as ConfigGuarda;
}
function bash(comando: string, c: ConfigGuarda, sub = false) {
  const e: EntradaHook = { tool_name: 'Bash', tool_input: { command: comando }, permission_mode: 'default', session_id: 's', cwd: '/repo', ...(sub ? { agent_id: 'a1' } : {}) };
  return decidir(e, c, CTX);
}
function mcp(tool: string, input: Record<string, unknown>, c: ConfigGuarda, sub = false) {
  const e: EntradaHook = { tool_name: tool, tool_input: input, permission_mode: 'default', session_id: 's', ...(sub ? { agent_id: 'a1' } : {}) };
  return decidir(e, c, CTX);
}

const LEITURA = "psql -h db.prod.exemplo.com -c 'SELECT 1'";
const ESCRITA = "psql -h db.prod.exemplo.com -c 'DROP TABLE t'";

describe('permitidos casa todo segmento prod (Q6, Q26)', () => {
  test('permitidos-um-de-dois-segmentos: a && b, ambos prod, só um casa ⇒ ask', () => {
    const d = bash(`curl -sS https://api.exemplo.com/health && ${LEITURA}`, cfg(['curl -sS https://api.exemplo.com/health']));
    assert.equal(d.faixa, 'ask');
  });
  test('permitidos-dois-de-dois-segmentos: ambos casam ⇒ mostrar + producao.acesso', () => {
    const d = bash(`curl -sS https://api.exemplo.com/health && ${LEITURA}`, cfg(['curl -sS https://api.exemplo.com/health', LEITURA]));
    assert.equal(d.faixa, 'mostrar');
    assert.equal(d.evento?.tipo, 'producao.acesso');
  });
  test('permitidos-leitura-nao-libera-escrita: padrão de leitura de mysql não libera DROP em -e', () => {
    const c = cfg(['mysql -h db.prod.exemplo.com -e "SELECT*']);
    const ok = bash('mysql -h db.prod.exemplo.com -e "SELECT 1"', c);
    assert.equal(ok.faixa, 'mostrar');
    const d = bash('mysql -h db.prod.exemplo.com -e "DROP TABLE t"', c);
    assert.equal(d.faixa, 'ask');
    assert.equal(d.classificacao.acao, 'escrita');
  });
  test('permitidos-leitura-e-escrita-juntas: leitura casa, escrita não ⇒ ask com acao escrita e motivo de escrita', () => {
    for (const cmd of [`${LEITURA} && ${ESCRITA}`, `${ESCRITA} && ${LEITURA}`]) {
      const d = bash(cmd, cfg([LEITURA]));
      assert.equal(d.faixa, 'ask', cmd);
      assert.equal(d.classificacao.acao, 'escrita', cmd);
      assert.equal(d.evento?.tipo, 'guarda.ask', cmd);
      assert.match(d.motivo ?? '', /escrita/, cmd);
    }
  });
  test('sem-remoto-permitidos-vazio-pede: permitidos vazio (D2) ⇒ ask na leitura', () => {
    const d = bash(LEITURA, cfg([]));
    assert.equal(d.faixa, 'ask');
  });
});

describe('evento e mensagem da leitura em prod', () => {
  test('leitura-aprovada-no-ask-e-guarda-ask: não grava producao.acesso', () => {
    const d = bash(LEITURA, cfg([]));
    assert.equal(d.evento?.tipo, 'guarda.ask');
    assert.equal(d.evento?.dados.acao, 'leitura');
  });
  test('leitura-via-permitidos-grava-producao-acesso', () => {
    const d = bash(LEITURA, cfg([LEITURA]));
    assert.equal(d.faixa, 'mostrar');
    assert.equal(d.evento?.tipo, 'producao.acesso');
  });
  test('motivo-de-leitura-diz-leitura-e-nao-ensina-bypass', () => {
    const d = bash(LEITURA, cfg([]));
    assert.match(d.motivo ?? '', /leitura/);
    assert.doesNotMatch(d.motivo ?? '', /GABARITO|permitidos|bypass|ALLOW/i);
  });
  test('motivo-de-leitura-no-subagent', () => {
    const d = bash(LEITURA, cfg([LEITURA]), true);
    assert.equal(d.faixa, 'deny');
    assert.match(d.motivo ?? '', /só o orquestrador/);
  });
});

describe('MCP de produção', () => {
  test('mcp-permitido-casa-nome-da-tool: orq ⇒ mostrar + producao.acesso; outra tool do servidor ⇒ ask', () => {
    const c = cfg(['mcp__supabase_prod__list_tables']);
    const ok = mcp('mcp__supabase_prod__list_tables', {}, c);
    assert.equal(ok.faixa, 'mostrar');
    assert.equal(ok.evento?.tipo, 'producao.acesso');
    const outra = mcp('mcp__supabase_prod__get_project_url', {}, c);
    assert.equal(outra.faixa, 'ask');
  });
  test('mcp-permitido-nao-vale-sub', () => {
    const d = mcp('mcp__supabase_prod__list_tables', {}, cfg(['mcp__supabase_prod__list_tables']), true);
    assert.equal(d.faixa, 'deny');
  });
  test('mcp-escrita-nao-casa-padrao-de-leitura: execute_sql com DROP ⇒ ask', () => {
    const d = mcp('mcp__supabase_prod__execute_sql', { query: 'DROP TABLE t' }, cfg(['mcp__supabase_prod__list_tables']));
    assert.equal(d.faixa, 'ask');
    assert.equal(d.classificacao.acao, 'escrita');
  });
});

describe('inalterados', () => {
  test('homolog e hostname suspeito sem alvo declarado seguem sem pergunta', () => {
    assert.equal(bash("psql -h db.homolog.exemplo.com -c 'SELECT 1'", cfg([])).faixa, 'mostrar');
    assert.notEqual(bash('curl https://api-prod.desconhecido.com/x', cfg([])).faixa, 'ask');
  });
});

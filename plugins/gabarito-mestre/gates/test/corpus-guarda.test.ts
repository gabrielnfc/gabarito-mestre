/**
 * Corpus da guarda 2.0 — hooks/test/corpus/guarda-{bash,mcp,caminho,integridade}.jsonl.
 * Um `test` por linha chama `decidir`; mudar um veredito = mudar o caso.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  remover a checagem de `agent_id` ⇒ `subagent-prod-escrita` falha
 *  M2  trocar `ask` por `allow` ⇒ `orq-prod-escrita` falha
 *  M3  devolver decisão em `teste` ⇒ `teste-sem-decisao` falha
 *  M4  remover um caso nominado do JSONL ⇒ `corpus-meta` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidir } from '../src/decidir.ts';
import type { ConfigGuarda, Contexto, EntradaHook } from '../src/tipos.ts';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'test', 'corpus');
const ARQUIVOS = ['guarda-bash', 'guarda-mcp', 'guarda-caminho', 'guarda-integridade'];
const REQS = new Set(['GRD-2', 'GRD-4', 'GRD-5', 'GRD-6']);
const TOTAL_CORPUS = 94;
// Nominados pelo dono + casos que as mutações prescritas da spec citam.
const NOMINADOS = [
  'teste-sem-decisao',
  'integridade-remote-set-head-sub',
  'integridade-fetch-refspec-sub',
  'integridade-git-c-remote-sub',
  'subagent-prod-escrita',
  'orq-prod-escrita',
  'segredo-env-sub',
  'integridade-config-sub-bash',
  'url-credencial-reduzida',
];

type Caso = {
  nome: string;
  req: string;
  tool: string;
  input: Record<string, unknown>;
  agente: 'orq' | 'sub';
  modo?: string;
  contexto?: Partial<Contexto>;
  config?: 'ausente';
  esperado: { faixa: string; evento?: string; ambiente?: string; acao?: string; alvo?: string; motivoContem?: string };
};

const CONTEXTO_PADRAO: Contexto = {
  branchAtual: 'feat/GM-1-x',
  refLinkado: null,
  remoteUrl: 'git@github.com:org/app.git',
  raiz: '/repo',
  pluginRoot: '/plugin',
};

const CONFIG: ConfigGuarda = JSON.parse(readFileSync(join(CORPUS, '_ambientes.json'), 'utf8'));

function carregar(arquivo: string): Caso[] {
  return readFileSync(join(CORPUS, `${arquivo}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Caso);
}

const todos: Array<Caso & { arquivo: string }> = ARQUIVOS.flatMap((a) => carregar(a).map((c) => ({ ...c, arquivo: a })));

describe('corpus-meta', () => {
  test('corpus-meta: contagem exata, nomes únicos, req válido, nominados presentes', () => {
    assert.equal(todos.length, TOTAL_CORPUS, `corpus com ${todos.length} casos, esperado ${TOTAL_CORPUS}`);
    const nomes = todos.map((c) => c.nome);
    assert.equal(new Set(nomes).size, nomes.length, 'nome duplicado no corpus');
    for (const c of todos) assert.ok(REQS.has(c.req), `${c.nome}: req inválido ${c.req}`);
    for (const n of NOMINADOS) assert.ok(nomes.includes(n), `falta o caso nominado ${n}`);
  });
});

describe('corpus da guarda', () => {
  for (const c of todos) {
    test(`${c.arquivo}: ${c.nome}`, () => {
      const entrada: EntradaHook = {
        tool_name: c.tool,
        tool_input: c.input,
        permission_mode: c.modo ?? 'default',
        session_id: 'sessao-corpus',
        cwd: '/repo',
        ...(c.agente === 'sub' ? { agent_id: 'agent-sub-1', agent_type: 'general-purpose' } : {}),
      };
      const contexto: Contexto = { ...CONTEXTO_PADRAO, ...(c.contexto ?? {}) };
      const config = c.config === 'ausente' ? null : CONFIG;

      const d = decidir(entrada, config, contexto);

      const esperadoDecisao = c.esperado.faixa === 'ask' ? 'ask' : c.esperado.faixa === 'deny' ? 'deny' : undefined;
      assert.equal(d.faixa, c.esperado.faixa, `faixa de ${c.nome}`);
      assert.equal(d.permissionDecision, esperadoDecisao, `permissionDecision de ${c.nome}`);
      assert.notEqual(d.permissionDecision as string | undefined, 'allow', 'a guarda nunca devolve allow');
      if (c.esperado.evento !== undefined) assert.equal(d.evento?.tipo, c.esperado.evento, `evento de ${c.nome}`);
      if (c.esperado.ambiente !== undefined) assert.equal(d.classificacao.ambiente, c.esperado.ambiente);
      if (c.esperado.acao !== undefined) assert.equal(d.classificacao.acao, c.esperado.acao);
      if (c.esperado.alvo !== undefined) assert.equal(d.classificacao.alvo, c.esperado.alvo);
      if (c.esperado.motivoContem !== undefined) {
        assert.ok(d.motivo?.includes(c.esperado.motivoContem), `motivo de ${c.nome} deveria conter "${c.esperado.motivoContem}": ${d.motivo}`);
      }

      // Oráculo derivado da faixa (REQ-GRD-4, Q3), válido para todo caso.
      switch (c.esperado.faixa) {
        case 'silencio':
          assert.equal(d.evento, null, 'silêncio não grava evento');
          assert.equal(d.systemMessage, null, 'silêncio não emite systemMessage');
          break;
        case 'log':
          assert.ok(d.evento, 'log grava evento');
          assert.equal(d.systemMessage, null, 'log não emite systemMessage');
          break;
        case 'mostrar':
          assert.ok(d.evento, 'mostrar grava evento');
          assert.ok(d.systemMessage && d.systemMessage.trim() !== '', 'mostrar exige systemMessage');
          assert.equal(d.systemMessage.includes('\n'), false, 'systemMessage é de 1 linha');
          break;
        case 'ask':
          assert.equal(d.evento?.tipo, 'guarda.ask');
          assert.ok(d.motivo && d.motivo.length > 0, 'ask exige motivo');
          break;
        case 'deny':
          assert.equal(d.evento?.tipo, 'guarda.deny');
          assert.ok(d.motivo && d.motivo.length > 0, 'deny exige motivo');
          break;
        default:
          assert.fail(`faixa desconhecida no corpus: ${c.esperado.faixa}`);
      }

      // Nunca comando cru nem credencial em `dados`/`alvo` (E1:58, E1:72).
      const comando = typeof c.input.command === 'string' ? c.input.command : null;
      const superficies = [JSON.stringify(d.evento?.dados ?? null), d.classificacao.alvo, d.systemMessage ?? '', d.motivo ?? ''];
      for (const s of superficies) {
        if (comando !== null && comando.includes(' ')) assert.equal(s.includes(comando), false, `comando cru vazou: ${s}`);
        assert.equal(s.includes('s3nh4'), false, `credencial vazou: ${s}`);
      }
    });
  }
});

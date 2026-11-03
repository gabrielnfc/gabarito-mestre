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
const REQS = new Set(['GRD-2', 'GRD-3', 'GRD-4', 'GRD-5', 'GRD-6']);
const TOTAL_CORPUS = 261 + 36;
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
  'modo-dontask-ask',
  'modo-bypass-ask',
  'modo-bypass-benigno',
];

type Caso = {
  nome: string;
  req: string;
  tool: string;
  input: Record<string, unknown>;
  agente: 'orq' | 'sub';
  modo?: string;
  cwd?: string;
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

// Comando gigante não cabe em JSONL legível: `input.gerar` = {antes, char, n, depois} vira `command` ao carregar.
function materializar(c: Caso): Caso {
  const g = c.input.gerar as { antes: string; char: string; n: number; depois: string } | undefined;
  if (g === undefined) return c;
  return { ...c, input: { command: `${g.antes}${g.char.repeat(g.n)}${g.depois}` } };
}

function carregar(arquivo: string): Caso[] {
  return readFileSync(join(CORPUS, `${arquivo}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => materializar(JSON.parse(l) as Caso));
}

const todos: Array<Caso & { arquivo: string }> = ARQUIVOS.flatMap((a) => carregar(a).map((c) => ({ ...c, arquivo: a })));

const EVENTOS_MOSTRAR = ['producao.acesso', 'operacao.destrutiva'];

function rodar(c: Caso, modo?: string) {
  const entrada: EntradaHook = {
    tool_name: c.tool,
    tool_input: c.input,
    permission_mode: modo ?? c.modo ?? 'default',
    session_id: 'sessao-corpus',
    cwd: c.cwd ?? '/repo',
    ...(c.agente === 'sub' ? { agent_id: 'agent-sub-1', agent_type: 'general-purpose' } : {}),
  };
  const contexto: Contexto = { ...CONTEXTO_PADRAO, ...(c.contexto ?? {}) };
  return decidir(entrada, c.config === 'ausente' ? null : CONFIG, contexto);
}

// Textos crus que nunca podem aparecer na saída: comando inteiro, cada segmento Bash, `query` e `sql`
// (só os que têm espaço; um token sozinho pode ser alvo legítimo). Comparação sem diferenciar maiúsculas.
function textosCrus(input: Record<string, unknown>): string[] {
  const crus: string[] = [];
  if (typeof input.command === 'string') {
    crus.push(input.command);
    crus.push(...input.command.split(/&&|\|\||;|\||\n/));
  }
  for (const k of ['query', 'sql']) if (typeof input[k] === 'string') crus.push(input[k] as string);
  return [...new Set(crus.map((s) => s.trim().toLowerCase()).filter((s) => s.includes(' ')))];
}

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
      const d = rodar(c);

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
        case 'mostrar': {
          // Evento só `producao.acesso` ou `operacao.destrutiva`; sem declaração, o default é `producao.acesso`.
          assert.ok(d.evento, 'mostrar grava evento');
          assert.ok(EVENTOS_MOSTRAR.includes(d.evento.tipo), `mostrar com evento ${d.evento.tipo}`);
          assert.equal(d.evento.tipo, c.esperado.evento ?? 'producao.acesso', `evento de mostrar em ${c.nome}`);
          assert.ok(d.systemMessage && d.systemMessage.trim() !== '', 'mostrar exige systemMessage');
          assert.equal(d.systemMessage.includes('\n'), false, 'systemMessage é de 1 linha');
          assert.ok(d.classificacao.alvo !== '', 'mostrar exige alvo');
          assert.ok(d.systemMessage.includes(d.classificacao.alvo), `systemMessage deveria conter o alvo "${d.classificacao.alvo}": ${d.systemMessage}`);
          break;
        }
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

      // `producao.acesso` carrega ambiente, acao e alvo (REQ-GRD-4).
      if (d.evento?.tipo === 'producao.acesso') {
        for (const k of ['ambiente', 'acao', 'alvo']) {
          assert.ok(typeof d.evento.dados[k] === 'string' && d.evento.dados[k] !== '', `producao.acesso sem dados.${k}`);
        }
      }

      // Nunca comando cru, segmento cru nem credencial em `dados`/`alvo`/`systemMessage`/`motivo` (E1:58, E1:72).
      const crus = textosCrus(c.input);
      const superficies = [JSON.stringify(d.evento?.dados ?? null), d.classificacao.alvo, d.systemMessage ?? '', d.motivo ?? ''];
      for (const s of superficies) {
        const sl = s.toLowerCase();
        for (const cru of crus) assert.equal(sl.includes(cru), false, `texto cru "${cru}" vazou: ${s}`);
        assert.equal(sl.includes('s3nh4'), false, `credencial vazou: ${s}`);
      }
    });
  }
});

describe('permission_mode não muda o veredito (Q13)', () => {
  test('modo-nao-muda-veredito: decidir ignora o modo (bypassPermissions, dontAsk, auto) em todos os casos', () => {
    for (const c of todos) {
      for (const modo of ['bypassPermissions', 'dontAsk', 'auto']) {
        const d = rodar(c, modo);
        const esperado = c.esperado.faixa === 'ask' ? 'ask' : c.esperado.faixa === 'deny' ? 'deny' : undefined;
        assert.equal(d.faixa, c.esperado.faixa, `${c.nome} em ${modo}`);
        assert.equal(d.permissionDecision, esperado, `${c.nome} em ${modo}`);
        // A decisão inteira (faixa, evento, mensagem, motivo, classificação) é a mesma em qualquer modo.
        assert.deepEqual(d, rodar(c, 'default'), `${c.nome} em ${modo}: decisão difere da de default`);
      }
    }
  });
});

/** Adaptador do hook (T4) — exceção (Q21). Cabeçalho (mutações prescritas) e helpers em _adaptador-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATES, git, montar, rodarBruto, rodar, eventosDe } from './_adaptador-helpers.mjs';

const PONTOS = {
  raiz: ['guarda.js', /function raizPorFs\([^{]*\{/],
  lerGuarda: ['guarda.js', /function lerGuarda\([^{]*\{/],
  contexto: ['guarda.js', /function montarContexto\([^{]*\{/],
  decidir: ['decidir.js', /export function decidir\([^{]*\{/],
  saidaDe: ['guarda.js', /function saidaDe\([^{]*\{/],
  append: ['diario.js', /export function append\([^{]*\{/],
};
const LANCA = "throw new Error('injetada ' + (arguments[0]?.tool_input?.command ?? ''));";

function guardaComFalha(ponto) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-falha-')));
  for (const f of readdirSync(join(GATES, 'dist'))) copyFileSync(join(GATES, 'dist', f), join(dir, f));
  const editar = (arq, fn) => {
    const alvo = join(dir, arq);
    const antes = readFileSync(alvo, 'utf8');
    const depois = fn(antes);
    assert.notEqual(depois, antes, `injeção "${ponto}" não casou em ${arq}: o teste não exercita nada`);
    writeFileSync(alvo, depois);
  };
  if (PONTOS[ponto]) {
    const [arq, re] = PONTOS[ponto];
    editar(arq, (t) => t.replace(re, (m) => `${m} ${LANCA}`));
  } else if (ponto === 'stringify') {
    // só a serialização da SAÍDA lança; o resto do hook usa JSON.stringify normalmente
    editar('guarda.js', (t) => `const __s = JSON.stringify; JSON.stringify = (v, ...r) => { if (v && (v.hookSpecificOutput || v.systemMessage)) throw new Error('stringify injetado'); return __s(v, ...r); };\n${t}`);
  } else if (ponto === 'write-falha-uma-vez' || ponto === 'write-parcial' || ponto === 'write-sempre-falha') {
    const corpo = {
      'write-falha-uma-vez': "if (!globalThis.__ja) { globalThis.__ja = true; throw new Error('EPIPE injetado'); } return writeSync(fd, b, off);",
      'write-parcial': 'return writeSync(fd, b, off, Math.min(7, b.length - off));',
      'write-sempre-falha': "throw new Error('EPIPE injetado');",
    }[ponto];
    editar('guarda.js', (t) => `${t.replace(/\bwriteSync\(1,/g, '__ws(1,')}\nfunction __ws(fd, b, off) { ${corpo} }\n`);
  } else {
    throw new Error(`ponto desconhecido: ${ponto}`);
  }
  return join(dir, 'guarda.js');
}

const PONTOS_ANTES = ['raiz', 'lerGuarda', 'contexto', 'decidir'];
const PEDIDO_EXC = /falhou ao classificar/;

describe('exceção da guarda depois de o envelope ser lido (Q21): o que não classificou, pede', () => {
  const chamadas = (repo) => [
    ['Read', { file_path: join(repo, '.env') }],
    ['Read', { file_path: join(repo, 'README.md') }],
    ['Write', { file_path: `${join(GATES, '..')}/hooks/hooks.json`, content: 'x' }],
    ['Bash', { command: 'git -c core.hooksPath=/x commit -m a' }],
    ['Bash', { command: 'git push origin HEAD:refs/remotes/origin/main' }],
    ['Bash', { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" }],
    ['Bash', { command: 'vercel --prod' }],
    ['Bash', { command: 'ls' }],
    ['Bash', { command: 'rm -rf dist' }],
    ['Grep', {}],
  ];

  test('excecao-antes-da-decisao-orq: raiz, config, contexto e decisão ⇒ ask em toda chamada, saída é 1 JSON', () => {
    const repo = montar();
    for (const ponto of PONTOS_ANTES) {
      const bin = guardaComFalha(ponto);
      for (const [tool, input] of chamadas(repo)) {
        const rotulo = `${ponto} · ${tool} ${JSON.stringify(input)}`;
        const r = rodar(repo, tool, input, {}, { bin });
        assert.equal(r.status, 0, rotulo);
        assert.equal(r.decisao, 'ask', rotulo);
        assert.match(r.motivo, PEDIDO_EXC, rotulo);
        assert.equal(r.stdout.trim().split('\n').length, 1, rotulo);
      }
    }
  });

  test('excecao-antes-da-decisao-sub: o mesmo, com agent_id ⇒ deny', () => {
    const repo = montar();
    for (const ponto of PONTOS_ANTES) {
      const bin = guardaComFalha(ponto);
      for (const [tool, input] of chamadas(repo)) {
        const rotulo = `${ponto} · ${tool} ${JSON.stringify(input)}`;
        const r = rodar(repo, tool, input, { agent_id: 'a1' }, { bin });
        assert.equal(r.status, 0, rotulo);
        assert.equal(r.decisao, 'deny', rotulo);
        assert.match(r.motivo, /só o orquestrador pode pedir/, rotulo);
      }
    }
  });

  test('excecao-agent-id-estranho: null, número e vazio valem como orquestrador (ask)', () => {
    const repo = montar();
    const bin = guardaComFalha('decidir');
    for (const agent_id of [null, 7, '']) {
      const r = rodar(repo, 'Bash', { command: 'ls' }, { agent_id }, { bin });
      assert.equal(r.decisao, 'ask', JSON.stringify(agent_id));
    }
  });

  test('excecao-na-serializacao-ainda-pede: saidaDe, stringify da saída e writeSync que falha ⇒ a decisão ainda sai', () => {
    const repo = montar();
    const casos = [
      ['Read', { file_path: join(repo, '.env') }],
      ['Write', { file_path: join(repo, 'harness.config.json'), content: 'x' }],
      ['Bash', { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" }],
    ];
    for (const ponto of ['saidaDe', 'stringify', 'write-falha-uma-vez']) {
      const bin = guardaComFalha(ponto);
      for (const [tool, input] of casos) {
        for (const [extra, esperado] of [[{}, 'ask'], [{ agent_id: 'a1' }, 'deny']]) {
          const rotulo = `${ponto} · ${tool} · ${esperado}`;
          const r = rodar(repo, tool, input, extra, { bin });
          assert.equal(r.status, 0, rotulo);
          assert.equal(r.decisao, esperado, rotulo);
          assert.equal(r.stdout.trim().split('\n').length, 1, rotulo);
        }
      }
    }
  });

  test('excecao-escrita-parcial: writeSync que escreve aos pedaços completa a MESMA saída; EPIPE permanente não derruba', () => {
    const repo = montar();
    const normal = rodar(repo, 'Read', { file_path: join(repo, '.env') });
    const parcial = rodar(repo, 'Read', { file_path: join(repo, '.env') }, {}, { bin: guardaComFalha('write-parcial') });
    assert.equal(parcial.decisao, 'ask');
    assert.equal(parcial.motivo, normal.motivo);
    assert.equal(parcial.stdout.trim().split('\n').length, 1);
    const epipe = rodar(repo, 'Read', { file_path: join(repo, '.env') }, {}, { bin: guardaComFalha('write-sempre-falha') });
    assert.equal(epipe.status, 0);
    assert.equal(epipe.stdout, '');
  });

  test('excecao-no-append-nao-duplica-nem-muda: a decisão sai uma vez, igual à de sempre', () => {
    const repo = montar();
    const entrada = [repo, 'Bash', { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" }];
    const normal = rodar(...entrada);
    const r = rodar(...entrada, {}, { bin: guardaComFalha('append') });
    assert.equal(r.decisao, 'ask');
    assert.equal(r.stdout, normal.stdout);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.equal(r.status, 0);
  });

  test('excecao-nao-vaza-comando: nem motivo, nem stderr, nem diário carregam o comando; evento guarda.ask/deny com motivo excecao', () => {
    const repo = montar();
    const command = "psql postgres://u:s3nh4@db.prod.exemplo.com/x -c 'select 1'";
    const bin = guardaComFalha('decidir');
    for (const [extra, tipo, agente] of [[{}, 'guarda.ask', 'orquestrador'], [{ agent_id: 'a1' }, 'guarda.deny', 'subagent:a1']]) {
      const r = rodar(repo, 'Bash', { command }, extra, { bin });
      assert.ok(r.decisao === 'ask' || r.decisao === 'deny');
      for (const [onde, texto] of [['stdout', r.stdout], ['stderr', r.stderr]]) {
        assert.doesNotMatch(texto, /s3nh4/, onde);
        assert.doesNotMatch(texto, /select 1/, onde);
      }
      const linhas = eventosDe(repo).flatMap((e) => e.texto.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
      const ev = linhas.find((l) => l.tipo === tipo && l.agente === agente);
      assert.ok(ev, `evento ${tipo} de ${agente}`);
      assert.equal(ev.dados.motivo, 'excecao');
      assert.match(String(ev.dados.erro), /\S/);
      assert.ok(String(ev.dados.erro).length <= 200);
    }
    for (const e of eventosDe(repo)) {
      assert.doesNotMatch(e.texto, /s3nh4/);
      assert.doesNotMatch(e.texto, /select 1/);
    }
  });

  test('payload-invalido-segue-fail-open: envelope ilegível não vira ask nem com a falha injetada (plano L128)', () => {
    const bin = guardaComFalha('decidir');
    const ruins = [
      '{isto nao e json',
      '',
      '[]',
      JSON.stringify({ tool_input: { command: 'ls' } }),
      JSON.stringify({ tool_name: 'Bash' }),
      JSON.stringify({ tool_name: 'Bash', tool_input: 'ls' }),
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 42 } }),
    ];
    for (const bruto of ruins) {
      const r = rodarBruto(bruto, { bin });
      assert.equal(r.status, 0, bruto);
      assert.equal(r.decisao, undefined, bruto);
      assert.equal(r.stdout, '', bruto);
    }
  });
});

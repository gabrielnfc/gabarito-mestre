/**
 * Interruptor de autonomia do orquestrador (decisão do dono, 2026-11-12): `~/.claude/gabarito-autonomia.json` = `{"orquestrador": true}`.
 * GM-22 T3 (D-G52, DT6): com o nível `publica` a autonomia cala SÓ publicar (a tabela está em `autonomia-tabela.test.ts`); integridade,
 * escrita no interruptor, teto e `cd` perdido seguem `ask` com qualquer nível; `segredo` e subagent não mudam. Os casos que esperavam
 * `silencio` em integridade e no interruptor viraram `ask` aqui; o caso equivalente de cada um também está na tabela.
 *
 * MUTAÇÕES PRESCRITAS:
 *  A1  converter também o anel `segredo` ⇒ `autonomia-segredo-continua-ask` falha
 *  A2  converter também o `deny` do subagent ⇒ `autonomia-subagent-continua-deny` falha
 *  A4  converter também o teto (Q17) ⇒ `autonomia-ligada-teto-continua-ask` falha
 *  A5  calar a escrita no interruptor com qualquer nível ⇒ `autonomia-escrita-no-interruptor-pede-sempre` falha
 *  A6  `MARCA_INTERRUPTOR` sem `/i` ⇒ `autonomia-escapes-do-interruptor` falha
 *  A7  `decidir` casar `'gabarito-autonomia'` em vez de `'gabarito-auto'` ⇒ idem
 *  A8  `cp` na lista de leitores simples ⇒ idem
 *  A3  `lerAutonomia` aceitar qualquer valor truthy ⇒ `autonomia-arquivo-invalido-vale-ask` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decidir } from '../src/decidir.ts';
import { lerAutonomia } from '../src/guarda.ts';
import { TETO_COMANDO } from '../src/aneis.ts';
import type { Contexto, EntradaHook } from '../src/tipos.ts';

const CTX: Contexto = { branchAtual: 'feat/GM-1-x', refLinkado: null, remoteUrl: 'git@github.com:org/app.git', raiz: '/repo', pluginRoot: '/plugin' };
const bash = (command: string, sub = false): EntradaHook => ({ tool_name: 'Bash', tool_input: { command }, permission_mode: 'default', session_id: 's', cwd: '/repo', ...(sub ? { agent_id: 'a1' } : {}) });
const NIVEIS = ['nenhuma', 'trabalha', 'publica'] as const;

describe('autonomia do orquestrador', () => {
  test('autonomia-desligada-vale-ask', () => {
    const d = decidir(bash('git remote add x y'), null, CTX);
    assert.equal(d.faixa, 'ask');
    assert.equal(d.permissionDecision, 'ask');
  });

  test('autonomia-ligada-integridade-continua-ask (era silencio com evento até a 2.3.0)', () => {
    for (const nivel of ['trabalha', 'publica'] as const) {
      const d = decidir(bash('git remote add x y'), null, CTX, nivel);
      assert.equal(d.faixa, 'ask', nivel);
      assert.equal(d.permissionDecision, 'ask', nivel);
      assert.equal(d.evento?.tipo, 'guarda.ask', nivel);
      assert.equal(d.evento?.dados.anel, 'integridade', nivel);
      assert.equal(JSON.stringify(d.evento).includes('remote add'), false, 'nunca o comando');
    }
  });

  test('autonomia-ligada-teto-continua-ask', () => {
    const d = decidir(bash(`echo ${'a'.repeat(TETO_COMANDO + 1)}`), null, CTX, 'publica');
    assert.equal(d.faixa, 'ask');
    assert.equal(d.evento?.tipo, 'guarda.ask');
    assert.equal(d.evento?.dados.motivo, 'teto');
  });

  test('autonomia-ligada-teto-com-anel-no-prefixo-continua-ask', () => {
    const d = decidir(bash(`git remote add x y; echo ${'a'.repeat(TETO_COMANDO + 1)}`), null, CTX, 'publica');
    assert.equal(d.faixa, 'ask', 'o resto do comando não foi lido: pode haver segredo');
  });

  test('autonomia-cd-perdido-continua-ask', () => {
    const e = bash(`${'cd a;'.repeat(2100)} cd /repo/.git; echo x > config`);
    assert.equal(decidir(e, null, CTX).faixa, 'ask');
    const d = decidir(e, null, CTX, 'publica');
    assert.equal(d.classificacao.cdPerdido, true);
    assert.equal(d.faixa, 'ask', 'a guarda perdeu o diretório: não leu tudo');
  });

  // GM-22 DT6 (D-G53) revoga a emenda de 2026-11-12: a escrita no interruptor é integridade e pede SEMPRE ao orquestrador, em qualquer
  // nível (é o que impede o agente de ligar a autonomia sozinho). O subagent é `deny` sempre.
  test('autonomia-interruptor-ignora-caixa-do-diretorio', () => {
    const escrita = (file_path: string): EntradaHook => ({ tool_name: 'Write', tool_input: { file_path, content: '{}' }, permission_mode: 'default', session_id: 's', cwd: '/repo' });
    for (const p of ['/home/u/.CLAUDE/gabarito-autonomia.json', '/home/u/.claude/GABARITO-AUTONOMIA.JSON']) {
      for (const nivel of NIVEIS) {
        const d = decidir(escrita(p), null, CTX, nivel);
        assert.equal(d.faixa, 'ask', `${p} ${nivel}`);
        assert.equal(d.evento?.tipo, 'guarda.ask', `${p} ${nivel}`);
        assert.equal(decidir({ ...escrita(p), agent_id: 'a1' }, null, CTX, nivel).faixa, 'deny', `${p} ${nivel}`);
      }
    }
  });

  test('autonomia-escapes-do-interruptor', () => {
    const casos = [
      `python3 -c "open('/home/u/.CLAUDE/GABARITO-AUTONOMIA.json','w').write('x')"`, // caixa trocada (A6, regex sem /i)
      'echo x > ~/.claude/gabarito-auto*.json', // glob (A7)
      'cd ~/.claude && cp a gabarito-autonomia.json', // cp não é leitor (A8)
    ];
    for (const c of casos) {
      for (const nivel of NIVEIS) {
        const o = decidir(bash(c), null, CTX, nivel);
        assert.equal(o.faixa, 'ask', `${c} ${nivel}`);
        assert.equal(o.evento?.tipo, 'guarda.ask', `${c} ${nivel}`);
        assert.equal(decidir(bash(c, true), null, CTX, nivel).faixa, 'deny', `${c} ${nivel}`);
      }
    }
  });

  test('autonomia-escrita-no-interruptor-pede-sempre', () => {
    const alvo = '~/.claude/gabarito-autonomia.json';
    const escrita: EntradaHook = { tool_name: 'Write', tool_input: { file_path: '/home/u/.claude/gabarito-autonomia.json', content: '{}' }, permission_mode: 'default', session_id: 's', cwd: '/repo' };
    for (const e of [bash(`echo x > ${alvo}`), bash(`git remote add x y; echo x > ${alvo}`), escrita]) {
      for (const nivel of NIVEIS) {
        const d = decidir(e, null, CTX, nivel);
        assert.equal(d.faixa, 'ask', nivel);
        assert.equal(d.evento?.tipo, 'guarda.ask', nivel);
        assert.equal(JSON.stringify(d.evento).includes('echo x'), false, 'nunca o comando');
      }
    }
  });

  test('citar-o-nome-do-interruptor: Edit segue silencio; PR com a marca pede em todo nível (falso positivo medido)', () => {
    const edicao: EntradaHook = { tool_name: 'Edit', tool_input: { file_path: '/repo/CHANGELOG.md', old_string: 'a', new_string: 'o interruptor gabarito-autonomia.json' }, permission_mode: 'default', session_id: 's', cwd: '/repo' };
    const pr = bash('gh pr create --body "muda gabarito-autonomia.json"');
    for (const nivel of NIVEIS) {
      assert.equal(decidir(edicao, null, CTX, nivel).faixa, 'silencio', `texto citado em Edit nunca foi alvo: segue em silêncio (${nivel})`);
      assert.equal(decidir(pr, null, CTX, nivel).faixa, 'ask', nivel);
      assert.equal(decidir(bash('gh pr create --body "muda gabarito-autonomia.json"', true), null, CTX, nivel).faixa, 'deny', nivel);
    }
  });

  test('autonomia-segredo-continua-ask', () => {
    const d = decidir(bash('cat .env'), null, CTX, 'publica');
    assert.equal(d.faixa, 'ask');
    assert.equal(d.evento?.tipo, 'guarda.ask');
  });

  test('autonomia-subagent-continua-deny', () => {
    const d = decidir(bash('git remote add x y', true), null, CTX, 'publica');
    assert.equal(d.faixa, 'deny');
    assert.equal(d.permissionDecision, 'deny');
  });

  test('autonomia-arquivo-invalido-vale-ask', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autonomia-'));
    const f = (nome: string, conteudo: string) => {
      writeFileSync(join(dir, nome), conteudo);
      return join(dir, nome);
    };
    assert.equal(lerAutonomia(f('ok.json', '{"orquestrador":true}')), true);
    assert.equal(lerAutonomia(join(dir, 'ausente.json')), false);
    assert.equal(lerAutonomia(f('ruim.json', '{nao json')), false);
    assert.equal(lerAutonomia(f('texto.json', '{"orquestrador":"true"}')), false);
    assert.equal(lerAutonomia(f('um.json', '{"orquestrador":1}')), false);
    assert.equal(lerAutonomia(f('lista.json', '[true]')), false);
  });
});

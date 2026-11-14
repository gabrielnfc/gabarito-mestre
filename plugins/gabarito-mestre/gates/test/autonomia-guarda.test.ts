/**
 * Interruptor de autonomia do orquestrador (decisão do dono, 2026-11-12): `~/.claude/gabarito-autonomia.json` = `{"orquestrador": true}`
 * troca todo `ask` do orquestrador por passagem silenciosa com evento `guarda.autonomia`. `segredo` e subagent não mudam.
 *
 * MUTAÇÕES PRESCRITAS:
 *  A1  converter também o anel `segredo` ⇒ `autonomia-segredo-continua-ask` falha
 *  A2  converter também o `deny` do subagent ⇒ `autonomia-subagent-continua-deny` falha
 *  A4  converter também o teto (Q17) ⇒ `autonomia-ligada-teto-continua-ask` falha
 *  A5  converter a escrita no interruptor com a autonomia DESLIGADA ⇒ `autonomia-escrita-no-interruptor-pede-desligada-e-passa-ligada` falha
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

describe('autonomia do orquestrador', () => {
  test('autonomia-desligada-vale-ask', () => {
    const d = decidir(bash('git remote add x y'), null, CTX);
    assert.equal(d.faixa, 'ask');
    assert.equal(d.permissionDecision, 'ask');
  });

  test('autonomia-ligada-integridade-passa-com-evento', () => {
    const d = decidir(bash('git remote add x y'), null, CTX, true);
    assert.equal(d.faixa, 'silencio');
    assert.equal(d.permissionDecision, undefined);
    assert.equal(d.evento?.tipo, 'guarda.autonomia');
    assert.equal(d.evento?.dados.anel, 'integridade');
    assert.equal(JSON.stringify(d.evento).includes('remote add'), false, 'nunca o comando');
  });

  test('autonomia-ligada-teto-continua-ask', () => {
    const d = decidir(bash(`echo ${'a'.repeat(TETO_COMANDO + 1)}`), null, CTX, true);
    assert.equal(d.faixa, 'ask');
    assert.equal(d.evento?.tipo, 'guarda.ask');
    assert.equal(d.evento?.dados.motivo, 'teto');
  });

  test('autonomia-ligada-teto-com-anel-no-prefixo-continua-ask', () => {
    const d = decidir(bash(`git remote add x y; echo ${'a'.repeat(TETO_COMANDO + 1)}`), null, CTX, true);
    assert.equal(d.faixa, 'ask', 'o resto do comando não foi lido: pode haver segredo');
  });

  test('autonomia-cd-perdido-continua-ask', () => {
    const e = bash(`${'cd a;'.repeat(2100)} cd /repo/.git; echo x > config`);
    assert.equal(decidir(e, null, CTX).faixa, 'ask');
    const d = decidir(e, null, CTX, true);
    assert.equal(d.classificacao.cdPerdido, true);
    assert.equal(d.faixa, 'ask', 'a guarda perdeu o diretório: não leu tudo');
  });

  // Emenda da spec pelo dono (2026-11-12): com a autonomia LIGADA o orquestrador passa também nos casos do interruptor e da marca
  // (com evento). Desligada, escrita no interruptor continua `ask`: é o que impede o agente de ligar a autonomia sozinho.
  // O subagent é `deny` sempre.
  test('autonomia-interruptor-ignora-caixa-do-diretorio', () => {
    const escrita = (file_path: string): EntradaHook => ({ tool_name: 'Write', tool_input: { file_path, content: '{}' }, permission_mode: 'default', session_id: 's', cwd: '/repo' });
    for (const p of ['/home/u/.CLAUDE/gabarito-autonomia.json', '/home/u/.claude/GABARITO-AUTONOMIA.JSON']) {
      assert.equal(decidir(escrita(p), null, CTX, false).faixa, 'ask', p);
      assert.equal(decidir({ ...escrita(p), agent_id: 'a1' }, null, CTX, true).faixa, 'deny', p);
      const d = decidir(escrita(p), null, CTX, true);
      assert.equal(d.faixa, 'silencio', p);
      assert.equal(d.evento?.tipo, 'guarda.autonomia', p);
    }
  });

  test('autonomia-escapes-do-interruptor', () => {
    const casos = [
      `python3 -c "open('/home/u/.CLAUDE/GABARITO-AUTONOMIA.json','w').write('x')"`, // caixa trocada (A6, regex sem /i)
      'echo x > ~/.claude/gabarito-auto*.json', // glob (A7)
      'cd ~/.claude && cp a gabarito-autonomia.json', // cp não é leitor (A8)
    ];
    for (const c of casos) {
      const off = decidir(bash(c), null, CTX, false);
      assert.equal(off.faixa, 'ask', c);
      assert.equal(off.evento?.tipo, 'guarda.ask', c);
      assert.equal(decidir(bash(c, true), null, CTX, false).faixa, 'deny', c);
      assert.equal(decidir(bash(c, true), null, CTX, true).faixa, 'deny', c);
      const on = decidir(bash(c), null, CTX, true);
      assert.equal(on.faixa, 'silencio', c);
      assert.equal(on.evento?.tipo, 'guarda.autonomia', c);
    }
  });

  test('autonomia-escrita-no-interruptor-pede-desligada-e-passa-ligada', () => {
    const alvo = '~/.claude/gabarito-autonomia.json';
    const escrita: EntradaHook = { tool_name: 'Write', tool_input: { file_path: '/home/u/.claude/gabarito-autonomia.json', content: '{}' }, permission_mode: 'default', session_id: 's', cwd: '/repo' };
    for (const e of [bash(`echo x > ${alvo}`), bash(`git remote add x y; echo x > ${alvo}`), escrita]) {
      const off = decidir(e, null, CTX, false);
      assert.equal(off.faixa, 'ask');
      assert.equal(off.evento?.tipo, 'guarda.ask');
      const on = decidir(e, null, CTX, true);
      assert.equal(on.faixa, 'silencio');
      assert.equal(on.evento?.tipo, 'guarda.autonomia');
      assert.equal(JSON.stringify(on.evento).includes('echo x'), false, 'nunca o comando');
    }
  });

  test('citar-o-nome-do-interruptor-passa-ligada-e-pede-desligada (falso positivo medido)', () => {
    const edicao: EntradaHook = { tool_name: 'Edit', tool_input: { file_path: '/repo/CHANGELOG.md', old_string: 'a', new_string: 'o interruptor gabarito-autonomia.json' }, permission_mode: 'default', session_id: 's', cwd: '/repo' };
    assert.equal(decidir(edicao, null, CTX, true).faixa, 'silencio');
    assert.equal(decidir(edicao, null, CTX, false).faixa, 'silencio', 'texto citado em Edit nunca foi alvo: segue em silêncio');
    const pr = bash('gh pr create --body "muda gabarito-autonomia.json"');
    assert.equal(decidir(pr, null, CTX, true).faixa, 'silencio');
    assert.equal(decidir(pr, null, CTX, false).faixa, 'ask');
    assert.equal(decidir(bash('gh pr create --body "muda gabarito-autonomia.json"', true), null, CTX, true).faixa, 'deny');
  });

  test('autonomia-segredo-continua-ask', () => {
    const d = decidir(bash('cat .env'), null, CTX, true);
    assert.equal(d.faixa, 'ask');
    assert.equal(d.evento?.tipo, 'guarda.ask');
  });

  test('autonomia-subagent-continua-deny', () => {
    const d = decidir(bash('git remote add x y', true), null, CTX, true);
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

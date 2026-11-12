/**
 * Interruptor de autonomia do orquestrador (decisão do dono, 2026-11-12): `~/.claude/gabarito-autonomia.json` = `{"orquestrador": true}`
 * troca todo `ask` do orquestrador por passagem silenciosa com evento `guarda.autonomia`. `segredo` e subagent não mudam.
 *
 * MUTAÇÕES PRESCRITAS:
 *  A1  converter também o anel `segredo` ⇒ `autonomia-segredo-continua-ask` falha
 *  A2  converter também o `deny` do subagent ⇒ `autonomia-subagent-continua-deny` falha
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

  test('autonomia-ligada-teto-passa-com-evento', () => {
    const d = decidir(bash(`echo ${'a'.repeat(TETO_COMANDO + 1)}`), null, CTX, true);
    assert.equal(d.faixa, 'silencio');
    assert.equal(d.evento?.tipo, 'guarda.autonomia');
    assert.equal(d.evento?.dados.motivo, 'teto');
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

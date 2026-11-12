/**
 * Escrita em `refs/remotes` ou `packed-refs` por interpretador (python3, node, perl): segmento Bash que cita a ref e não é leitor
 * simples nem `git` (os `git` seguem pela classificação própria) é integridade com escrita. Com a autonomia ligada o orquestrador
 * passa como no resto da integridade; o subagent segue `deny`. Leitores seguem em silêncio.
 *
 * MUTAÇÕES PRESCRITAS:
 *  R1  tirar `packed-refs` da marca ⇒ `refs-interpretador-packed-pede` falha
 *  R2  marca sem `/i` ⇒ `refs-interpretador-caixa-pede` falha
 *  R3  tratar `python3` como leitor ⇒ `refs-interpretador-pede` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidir } from '../src/decidir.ts';
import type { Contexto, EntradaHook } from '../src/tipos.ts';

const CTX: Contexto = { branchAtual: 'feat/GM-1-x', refLinkado: null, remoteUrl: 'git@github.com:org/app.git', raiz: '/repo', pluginRoot: '/plugin' };
const bash = (command: string, sub = false): EntradaHook => ({ tool_name: 'Bash', tool_input: { command }, permission_mode: 'default', session_id: 's', cwd: '/repo', ...(sub ? { agent_id: 'a1' } : {}) });
const REF = 'refs/' + 'remotes';

describe('escrita em refs por interpretador', () => {
  test('refs-interpretador-pede', () => {
    const c = `python3 -c "open('.git/${REF}/origin/main','w').write('abc')"`;
    assert.equal(decidir(bash(c), null, CTX).faixa, 'ask');
    assert.equal(decidir(bash(c, true), null, CTX).faixa, 'deny');
  });

  test('refs-interpretador-packed-pede', () => {
    const c = `node -e "require('fs').appendFileSync('.git/packed-refs','x')"`;
    assert.equal(decidir(bash(c), null, CTX).faixa, 'ask');
    assert.equal(decidir(bash(c, true), null, CTX).faixa, 'deny');
  });

  test('refs-interpretador-caixa-pede', () => {
    const c = `perl -e 'open(F,">.git/PACKED-REFS")'`;
    assert.equal(decidir(bash(c), null, CTX).faixa, 'ask');
  });

  test('refs-interpretador-autonomia-passa-orquestrador-e-barra-subagent', () => {
    const c = `python3 -c "open('.git/${REF}/origin/main','w')"`;
    const d = decidir(bash(c), null, CTX, true);
    assert.equal(d.faixa, 'silencio');
    assert.equal(d.evento?.tipo, 'guarda.autonomia');
    assert.equal(decidir(bash(c, true), null, CTX, true).faixa, 'deny');
  });

  test('refs-leitores-continuam-em-silencio', () => {
    for (const c of ['cat .git/packed-refs', 'git show-ref', 'git for-each-ref', `grep -r abc .git/${REF}`]) {
      assert.equal(decidir(bash(c), null, CTX).faixa, 'silencio', c);
    }
    for (const c of ['git show-ref', 'git for-each-ref']) assert.equal(decidir(bash(c, true), null, CTX).faixa, 'silencio', c);
  });
});

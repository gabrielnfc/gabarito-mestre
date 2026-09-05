/**
 * Testes do GATE R3/G7.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  comparar a URL inteira em vez do host (query string diferente escaparia)
 *  M2  deixar passar quando a URL de destino é inválida (fail-open)
 *  M3  incluir o host na mensagem de erro — a trava passaria a vazar o que protege
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostOf,
  assertNotProduction,
  assertBootEnvironment,
  ProductionAccessBlocked,
  BootEnvironmentMismatch,
} from '../src/production-host-guard.ts';

const PROD = 'https://api.empresa.com/v1';
const SANDBOX = 'https://api.sandbox.empresa.com/v1';

describe('R3 — trava de produção', () => {
  test('recusa quando o destino é o mesmo host de produção', () => {
    assert.throws(() => assertNotProduction(PROD, PROD), ProductionAccessBlocked);
  });

  test('compara HOST, não URL — path e query diferentes não disfarçam produção', () => {
    assert.throws(
      () => assertNotProduction('https://api.empresa.com/outro?x=1', PROD),
      ProductionAccessBlocked,
    );
  });

  test('deixa passar o ambiente de teste', () => {
    assert.doesNotThrow(() => assertNotProduction(SANDBOX, PROD));
  });

  test('URL de destino inválida REPROVA — sem host resolvível não há prova de que não é produção', () => {
    assert.throws(() => assertNotProduction('nao-e-url', PROD), ProductionAccessBlocked);
    assert.throws(() => assertNotProduction(undefined, PROD), ProductionAccessBlocked);
  });

  test('produção não configurada: nada a comparar, não trava', () => {
    assert.doesNotThrow(() => assertNotProduction(SANDBOX, undefined));
  });

  test('a mensagem NUNCA contém o host — a trava não vaza o que protege', () => {
    try {
      assertNotProduction(PROD, PROD);
      assert.fail('deveria ter lançado');
    } catch (e) {
      const msg = (e as Error).message;
      assert.doesNotMatch(msg, /empresa\.com/);
      assert.doesNotMatch(msg, /https?:\/\//);
      assert.match(msg, /não são impressos/);
    }
  });

  test('hostOf normaliza e nunca lança', () => {
    assert.equal(hostOf('https://API.Empresa.COM/x'), 'api.empresa.com');
    assert.equal(hostOf('lixo'), null);
    assert.equal(hostOf(undefined), null);
  });
});

describe('G7 — trava de boot por host efetivo', () => {
  const marcadores = ['sandbox', 'localhost', '127.0.0.1'];
  const PRODUCAO = 'TF-';

  test('host de teste não é julgado — lá qualquer marcador serve', () => {
    assert.doesNotThrow(() =>
      assertBootEnvironment('api.sandbox.empresa.com', marcadores, PRODUCAO, 'TFS-'),
    );
  });

  test('host de PRODUÇÃO com marcador de outro ambiente NÃO SOBE', () => {
    // É o copy-paste do comando de deploy da staging para produção: o APP_ENV vem
    // junto, errado, e o processo escreveria no namespace do outro ambiente.
    assert.throws(
      () => assertBootEnvironment('api.empresa.com', marcadores, PRODUCAO, 'TFS-'),
      BootEnvironmentMismatch,
    );
  });

  test('host de produção com o marcador de produção sobe', () => {
    assert.doesNotThrow(() => assertBootEnvironment('api.empresa.com', marcadores, PRODUCAO, 'TF-'));
  });

  test('o host manda, não o APP_ENV — mesmo com APP_ENV mentindo, a trava age', () => {
    process.env.APP_ENV = 'production';
    assert.throws(
      () => assertBootEnvironment('api.empresa.com', marcadores, PRODUCAO, 'TFD-'),
      BootEnvironmentMismatch,
    );
  });

  test('sem host efetivo o processo não fala com ninguém: não trava', () => {
    assert.doesNotThrow(() => assertBootEnvironment(null, marcadores, PRODUCAO, 'X'));
  });

  test('a mensagem explica o que aconteceria — não só que falhou', () => {
    try {
      assertBootEnvironment('api.empresa.com', marcadores, PRODUCAO, 'TFS-');
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.match((e as Error).message, /namespace de outro/);
    }
  });
});

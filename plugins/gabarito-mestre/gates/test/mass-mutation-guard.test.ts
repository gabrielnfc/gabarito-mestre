/**
 * Testes do GATE G3.
 *
 * O primeiro teste REPRODUZ o incidente que motivou a guarda. Ele é o teste que
 * precisa existir: se alguém remover a guarda, é ele que fica vermelho.
 *
 * MUTAÇÕES PRESCRITAS (o revisor executa; toda uma delas TEM que derrubar a suíte):
 *  M1  trocar a ordem — checar `hasEffectiveFilter` ANTES de `findUndefinedPath`
 *  M2  fazer `findUndefinedPath` parar no primeiro nível (não recursar)
 *  M3  aceitar `allowFullScan` com motivo vazio
 *  M4  tratar `OR` como `AND` (bastar um ramo efetivo)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  massMutationGuard,
  allowFullScan,
  hasEffectiveFilter,
  findUndefinedPath,
  MassMutationBlocked,
} from '../src/mass-mutation-guard.ts';

/** Simula o `$allOperations` do ORM: devolve o que a guarda deixou passar. */
function aplicar(args: unknown, operation = 'deleteMany', model = 'customers') {
  const ext = massMutationGuard({ warn: () => {} });
  let passou: unknown = Symbol('não-executou');
  ext.query.$allOperations({
    model,
    operation,
    args,
    query: (a: unknown) => {
      passou = a;
      return a;
    },
  });
  return passou;
}

describe('G3 — o incidente', () => {
  test('o filtro do teardown com tenantId undefined é RECUSADO', () => {
    // Era exatamente isto: o ORM descarta a chave e `{}` alcança a tabela inteira.
    const tenantId = undefined;
    assert.throws(
      () => aplicar({ where: { tenantId } }),
      (e: unknown) => e instanceof MassMutationBlocked && /undefined/.test((e as Error).message),
    );
  });

  test('undefined ao lado de condição válida também é recusado — o caso que uma guarda ingênua deixa passar', () => {
    assert.throws(
      () => aplicar({ where: { tenantId: undefined, ativo: true } }),
      MassMutationBlocked,
    );
  });

  test('undefined em profundidade é recusado', () => {
    assert.throws(
      () => aplicar({ where: { AND: [{ ativo: true }, { conta: { id: undefined } }] } }),
      (e: unknown) => e instanceof MassMutationBlocked && /conta\.id/.test((e as Error).message),
    );
  });
});

describe('G3 — filtro efetivo', () => {
  test('recusa sem argumento, objeto vazio e where vazio', () => {
    assert.throws(() => aplicar(undefined), MassMutationBlocked);
    assert.throws(() => aplicar({}), MassMutationBlocked);
    assert.throws(() => aplicar({ where: {} }), MassMutationBlocked);
  });

  test('deixa passar filtro que restringe', () => {
    const args = { where: { tenantId: 'abc' } };
    assert.deepEqual(aplicar(args), args);
  });

  test('operação de linha única não é guardada — o ORM já exige chave', () => {
    const args = { where: { id: undefined } };
    assert.deepEqual(aplicar(args, 'delete'), args);
  });
});

describe('G3 — semântica booleana', () => {
  test('AND basta um ramo efetivo', () => {
    assert.equal(hasEffectiveFilter({ AND: [{ a: undefined }, { b: 1 }] }), true);
  });

  test('OR exige TODOS os ramos efetivos — um ramo frouxo alarga a disjunção inteira', () => {
    assert.equal(hasEffectiveFilter({ OR: [{ a: 1 }, { b: undefined }] }), false);
    assert.equal(hasEffectiveFilter({ OR: [{ a: 1 }, { b: 2 }] }), true);
  });

  test('OR vazio não casa nada, logo restringe', () => {
    assert.equal(hasEffectiveFilter({ OR: [] }), true);
  });

  test('instância de classe é valor, não filtro a recursar', () => {
    assert.equal(hasEffectiveFilter({ criadoEm: { gte: new Date(0) } }), true);
  });
});

describe('G3 — escape hatch', () => {
  test('exige motivo não-vazio', () => {
    assert.throws(() => allowFullScan('', {}), /motivo não-vazio/);
    assert.throws(() => allowFullScan('   ', {}), /motivo não-vazio/);
  });

  test('autoriza o full scan e remove a marca antes do ORM ver', () => {
    const saida = aplicar(allowFullScan('expurgo mensal (RFC-42)', { where: {} })) as Record<
      string,
      unknown
    >;
    assert.deepEqual(saida, { where: {} });
    assert.equal(
      Object.getOwnPropertySymbols(saida).length,
      0,
      'a marca não pode vazar para o ORM',
    );
  });

  test('avisa a cada uso — escape hatch silencioso vira caminho padrão', () => {
    const avisos: string[] = [];
    const ext = massMutationGuard({ warn: (m) => avisos.push(m) });
    ext.query.$allOperations({
      model: 'logs',
      operation: 'deleteMany',
      args: allowFullScan('expurgo', {}),
      query: (a: unknown) => a,
    });
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /AUTORIZADO/);
    assert.match(avisos[0], /expurgo/);
  });
});

describe('G3 — findUndefinedPath', () => {
  test('aponta o caminho, não só a existência', () => {
    assert.equal(findUndefinedPath({ a: { b: { c: undefined } } }), 'a.b.c');
    assert.equal(findUndefinedPath({ OR: [{ x: 1 }, { y: undefined }] }), 'OR.1.y');
    assert.equal(findUndefinedPath({ a: 1 }), null);
  });
});

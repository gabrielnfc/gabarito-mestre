/**
 * Testes do GATE G8.
 *
 * O teste de CORTE TEMPORAL é o que pina a constante: mudar `MIGRATION_GUARD_CUTOFF`
 * quebra este arquivo, o que torna a mudança visível na PR em vez de silenciosa.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  remover o lookbehind de `ON DELETE` → falsos positivos em toda FK
 *  M2  não remover comentários antes de casar → `-- TRUNCATE` vira destrutivo
 *  M3  aceitar rollback.sql vazio como plano
 *  M4  tratar carimbo malformado como fora do corte (fail-open)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  changedMigrations,
  GitRefIndisponivel,
  isDestructive,
  stripSqlComments,
  withinCutoff,
  timestampOf,
  MIGRATION_GUARD_CUTOFF,
  DESTRUCTIVE_PATTERN,
} from '../scripts/migrations-guard.mjs';

describe('G8 — o que é destrutivo', () => {
  test('pega DROP de tabela, coluna, tipo, schema, sequence e database', () => {
    for (const sql of [
      'DROP TABLE clientes;',
      'ALTER TABLE t DROP COLUMN c;',
      'DROP TYPE status;',
      'DROP SCHEMA public CASCADE;',
      'DROP SEQUENCE orders_numero_seq;',
      'DROP DATABASE app;',
      'TRUNCATE clientes;',
      "UPDATE clientes SET tipo = 'x';",
      'DELETE FROM clientes;',
    ]) {
      assert.equal(isDestructive(sql).destructive, true, sql);
    }
  });

  test('NÃO pega ação referencial de FK — sem esta isenção a guarda grita em toda migration', () => {
    const sql = `ALTER TABLE "pedidos" ADD CONSTRAINT "fk" FOREIGN KEY ("cliente_id")
      REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;`;
    assert.equal(isDestructive(sql).destructive, false);
  });

  test('NÃO pega DROP CONSTRAINT / INDEX / DEFAULT — não destroem dado', () => {
    assert.equal(isDestructive('ALTER TABLE t DROP CONSTRAINT c;').destructive, false);
    assert.equal(isDestructive('DROP INDEX idx_t;').destructive, false);
    assert.equal(isDestructive('ALTER TABLE t ALTER COLUMN c DROP DEFAULT;').destructive, false);
  });

  test('PEGA o aditivo-na-forma-destrutivo-no-efeito: flip para ON DELETE CASCADE', () => {
    const sql = `ALTER TABLE "itens" ADD CONSTRAINT "fk" FOREIGN KEY ("pedido_id")
      REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    const r = isDestructive(sql);
    assert.equal(r.destructive, true);
    assert.match(r.reason, /destrutivo no efeito/);
  });

  test('comentário não conta — `-- TRUNCATE` é prosa, não comando', () => {
    assert.equal(isDestructive('-- TRUNCATE clientes;\nCREATE TABLE t (id int);').destructive, false);
    assert.equal(stripSqlComments('SELECT 1; -- DROP TABLE x'), 'SELECT 1; ');
  });
});

describe('G8 — corte temporal (constante PINADA)', () => {
  test('a constante é a que está documentada — mudá-la quebra este teste de propósito', () => {
    assert.equal(MIGRATION_GUARD_CUTOFF, '00000000000000');
    assert.equal(MIGRATION_GUARD_CUTOFF.length, 14);
  });

  test('extrai o carimbo do nome do diretório', () => {
    assert.equal(timestampOf('prisma/migrations/20260817195715_nome'), '20260817195715');
    assert.equal(timestampOf('prisma/migrations/sem_carimbo'), null);
  });

  test('carimbo malformado conta como DENTRO do corte — fail-closed', () => {
    // Diretório criado à mão não pode escapar da guarda por não parecer migration.
    assert.equal(withinCutoff('prisma/migrations/mig_feita_na_mao', '20260817000000'), true);
  });

  test('carimbo anterior ao corte fica isento; posterior é avaliado', () => {
    assert.equal(withinCutoff('m/20260101000000_antiga', '20260817000000'), false);
    assert.equal(withinCutoff('m/20260901000000_nova', '20260817000000'), true);
  });
});

describe('G8 — o padrão em si', () => {
  test('é regex, não parser — e isso é decisão, não limitação escondida', () => {
    assert.ok(DESTRUCTIVE_PATTERN instanceof RegExp);
    assert.ok(DESTRUCTIVE_PATTERN.flags.includes('i'));
  });
});

describe('G8 — falha de ambiente é MENSAGEM, não stack trace', () => {
  test('ref base inexistente vira erro explicado, com o conserto', () => {
    // Gate que roda no CI nunca despeja frame interno do Node: quem lê o log
    // precisa da causa e do conserto.
    const dir = mkdtempSync(join(tmpdir(), 'g8-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    try {
      changedMigrations('origin/inexistente', 'prisma/migrations', dir);
      assert.fail('deveria ter lançado');
    } catch (e) {
      assert.ok(e instanceof GitRefIndisponivel);
      assert.match(e.message, /histórico/);
      assert.match(e.message, /fetch-depth/);
      assert.doesNotMatch(e.message, /node:internal/);
    }
  });
});

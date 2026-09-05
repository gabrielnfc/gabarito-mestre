/**
 * Testes do GATE de ordem de subida.
 *
 * O teste que importa é o ÚLTIMO: ele prova que este gate não é teatro documentado —
 * que ele reprova o pipeline invertido mesmo quando o comentário certo está lá.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  comparar última ocorrência em vez da primeira
 *  M2  ignorar a seção de rollback
 *  M3  aceitar token ausente como ordem válida
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSequence, scopeFrom, evaluate } from '../scripts/deploy-order-check.mjs';

const CERTO = `
name: deploy
jobs:
  deploy:
    steps:
      # consumidor ANTES do produtor: o worker lê o campo que a API escreve
      - run: for S in "\${SVC_WORKER}" "\${SVC_API}"; do deploy "$S"; done
      - name: rollback
        if: failure()
        run: |
          traffic "\${SVC_API}" --to-revisions=$PREV
          traffic "\${SVC_WORKER}" --to-revisions=$PREV
`;

const INVERTIDO = CERTO.replace(
  'for S in "${SVC_WORKER}" "${SVC_API}"',
  'for S in "${SVC_API}" "${SVC_WORKER}"',
);

function repoCom(conteudo) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/deploy.yml'), conteudo);
  return dir;
}

const CFG = {
  deployOrder: [
    {
      label: 'staging',
      file: '.github/workflows/deploy.yml',
      deploy: ['SVC_WORKER', 'SVC_API'],
      rollback: ['SVC_API', 'SVC_WORKER'],
      rollbackSection: 'rollback',
    },
  ],
};

describe('ordem de subida — primitivas', () => {
  test('checkSequence aprova a ordem certa e reprova a invertida', () => {
    assert.equal(checkSequence('a...b', ['a', 'b']).ok, true);
    const r = checkSequence('b...a', ['a', 'b']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /ordem invertida/);
  });

  test('token ausente reprova — não se aprova o que não se conseguiu ler', () => {
    const r = checkSequence('só a', ['a', 'b']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /não encontrado/);
  });

  test('scopeFrom recorta a partir da seção', () => {
    assert.match(scopeFrom('x\nrollback:\ny', 'rollback'), /^rollback/);
    assert.equal(scopeFrom('sem secao', 'rollback'), '');
  });
});

describe('ordem de subida — pipeline real', () => {
  test('aprova o pipeline correto', () => {
    const out = evaluate(CFG, repoCom(CERTO));
    assert.equal(out.ok, true, JSON.stringify(out.falhas));
  });

  test('REPROVA o pipeline invertido — mesmo com o comentário certo logo acima', () => {
    // Este é o ponto do gate. O comentário "consumidor ANTES do produtor" continua
    // no arquivo; um teste que só confere o comentário passaria verde aqui.
    assert.ok(INVERTIDO.includes('consumidor ANTES do produtor'));
    const out = evaluate(CFG, repoCom(INVERTIDO));
    assert.equal(out.ok, false);
    assert.match(out.falhas[0].reason, /ordem invertida/);
  });

  test('reprova rollback na ordem errada', () => {
    const rollbackErrado = CERTO.replace(
      /traffic "\$\{SVC_API\}"[^\n]*\n\s*traffic "\$\{SVC_WORKER\}"[^\n]*/,
      'traffic "${SVC_WORKER}" --to-revisions=$PREV\n          traffic "${SVC_API}" --to-revisions=$PREV',
    );
    const out = evaluate(CFG, repoCom(rollbackErrado));
    assert.equal(out.ok, false);
    assert.match(out.falhas[0].label, /rollback/);
  });

  test('config sem deployOrder reprova — gate não declarado é gate ausente', () => {
    assert.equal(evaluate({}, repoCom(CERTO)).ok, false);
  });
});

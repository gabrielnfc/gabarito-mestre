/**
 * Interruptor de autonomia, ponta a ponta: `dist/guarda.js` em processo novo, com `HOME` tmp (o `$HOME` real nunca entra).
 *
 * MUTAÇÕES PRESCRITAS:
 *  P1  `autonomiaLigada = false` em `principal` ⇒ `ligado-orq-ask-passa-e-grava-evento` falha
 *  P2  `decidir(..., false)` em `principal` ⇒ `ligado-orq-ask-passa-e-grava-evento` falha
 *  P3  exceção convertida em silêncio com o interruptor ligado ⇒ `ligado-excecao-continua-ask` falha
 *  P4  tipo do evento sem `guarda.autonomia` ⇒ `ligado-orq-ask-passa-e-grava-evento` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATES, montar, rodar, eventosDe } from './_adaptador-helpers.mjs';

function home(conteudo) {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'gm-home-')));
  if (conteudo !== undefined) {
    mkdirSync(join(h, '.claude'));
    writeFileSync(join(h, '.claude', 'gabarito-autonomia.json'), conteudo);
  }
  return h;
}
const LIGADO = '{"orquestrador":true}';
const com = (repo, h, extra = {}) => ({ repo, env: { HOME: h }, ...extra });
const SUB = { agent_id: 'sub-1' };
const ASK = { command: 'git remote add x y' };

describe('autonomia: processo real', () => {
  test('ligado-orq-ask-passa-e-grava-evento', () => {
    const repo = montar();
    const r = rodar(repo, 'Bash', ASK, {}, com(repo, home(LIGADO)));
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    const textos = eventosDe(repo).map((e) => e.texto).join('');
    assert.match(textos, /"tipo":"guarda\.autonomia"/);
    assert.match(textos, /"anel":"integridade"/);
    assert.doesNotMatch(textos, /remote add/);
  });

  test('ligado-subagent-continua-deny', () => {
    const repo = montar();
    assert.equal(rodar(repo, 'Bash', ASK, SUB, com(repo, home(LIGADO))).decisao, 'deny');
  });

  test('ligado-segredo-continua-ask', () => {
    const repo = montar();
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, '.env') }, {}, com(repo, home(LIGADO))).decisao, 'ask');
  });

  test('ligado-escrita-no-interruptor-passa-com-evento', () => {
    const repo = montar();
    const h = home(LIGADO);
    const alvo = join(h, '.claude', 'gabarito-autonomia.json');
    const r = rodar(repo, 'Write', { file_path: alvo, content: '{}' }, {}, com(repo, h));
    assert.equal(r.decisao, undefined);
    assert.match(eventosDe(repo).map((e) => e.texto).join(''), /"tipo":"guarda\.autonomia"/);
  });

  test('desligado-escrita-no-interruptor-pede (o agente não liga a autonomia sozinho)', () => {
    const repo = montar();
    const h = home();
    const alvo = join(h, '.claude', 'gabarito-autonomia.json');
    assert.equal(rodar(repo, 'Write', { file_path: alvo, content: '{"orquestrador":true}' }, {}, com(repo, h)).decisao, 'ask');
    assert.equal(rodar(repo, 'Bash', { command: `echo '{"orquestrador":true}' > ${alvo}` }, {}, com(repo, h)).decisao, 'ask');
  });

  test('ligado-escrita-no-interruptor-subagent-deny', () => {
    const repo = montar();
    const h = home(LIGADO);
    const alvo = join(h, '.claude', 'gabarito-autonomia.json');
    assert.equal(rodar(repo, 'Write', { file_path: alvo, content: '{}' }, SUB, com(repo, h)).decisao, 'deny');
  });

  test('sem-arquivo-ask-continua-ask', () => {
    const repo = montar();
    assert.equal(rodar(repo, 'Bash', ASK, {}, com(repo, home())).decisao, 'ask');
  });

  test('arquivo-invalido-ask-continua-ask', () => {
    const repo = montar();
    assert.equal(rodar(repo, 'Bash', ASK, {}, com(repo, home('{"orquestrador":"true"}'))).decisao, 'ask');
  });

  test('ligado-excecao-continua-ask', () => {
    const repo = montar();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-aut-falha-')));
    for (const f of readdirSync(join(GATES, 'dist'))) copyFileSync(join(GATES, 'dist', f), join(dir, f));
    const alvo = join(dir, 'decidir.js');
    const antes = readFileSync(alvo, 'utf8');
    const depois = antes.replace(/export function decidir\([^{]*\{/, (m) => `${m} throw new Error('injetada');`);
    assert.notEqual(depois, antes, 'a injeção não casou');
    writeFileSync(alvo, depois);
    const r = rodar(repo, 'Bash', { command: 'ls' }, {}, com(repo, home(LIGADO), { bin: join(dir, 'guarda.js') }));
    assert.equal(r.decisao, 'ask');
    assert.match(r.motivo, /falhou ao classificar/);
  });
});

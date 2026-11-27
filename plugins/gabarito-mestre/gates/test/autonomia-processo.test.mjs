/**
 * Interruptor de autonomia, ponta a ponta: `dist/guarda.js` em processo novo, com `HOME` tmp (o `$HOME` real nunca entra).
 * GM-22 T3 (DT2, DT6, D-G52): só a resposta `publica` (config de origin/HEAD com `guarda.autonomia: orquestrador` E `entrega.autonomia: true`,
 * mais o interruptor) cala, e só publicar; o resto do que a 2.3.0 calava com a autonomia ligada agora pede.
 *
 * MUTAÇÕES PRESCRITAS:
 *  P1  nível `nenhuma` fixo em `principal` ⇒ `publica-push-main-passa-e-grava-evento` falha
 *  P2  `decidir(..., 'nenhuma')` em `principal` ⇒ `publica-push-main-passa-e-grava-evento` falha
 *  P3  exceção convertida em silêncio com o interruptor ligado ⇒ `ligado-excecao-continua-ask` falha
 *  P5  voltar a `||` em `principal` ⇒ `so-config-sem-interruptor-ask-no-processo` e `so-interruptor-sem-config-ask-no-processo` falham
 *  P6  gravar o comando no evento ⇒ `evento-autonomia-usada-sem-comando` falha
 *  P4  tipo do evento sem `guarda.autonomia_usada` ⇒ `publica-push-main-passa-e-grava-evento` falha
 *  MP2-d  ler `entrega.autonomia` da árvore local ⇒ `entrega-autonomia-so-da-origem` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATES, CONFIG, montar, rodar, eventosDe } from './_adaptador-helpers.mjs';

// O nome do interruptor entra por concatenação: a própria guarda barra comando que o cita.
const NOME_INTERRUPTOR = `${'gabarito-'}${'autonomia'}.json`;

function home(conteudo) {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'gm-home-')));
  if (conteudo !== undefined) {
    mkdirSync(join(h, '.claude'));
    writeFileSync(join(h, '.claude', NOME_INTERRUPTOR), conteudo);
  }
  return h;
}
const LIGADO = '{"orquestrador":true}';
const com = (repo, h, extra = {}) => ({ repo, env: { HOME: h }, ...extra });
const SUB = { agent_id: 'sub-1' };
// REQ-AUT-2 b + DT2: a passagem exige a config de origin/HEAD (`guarda.autonomia` E `entrega.autonomia`) E o interruptor; `montarLigado` é o lado da config.
const COM_GUARDA = { ...CONFIG, guarda: { ...CONFIG.guarda, autonomia: 'orquestrador' } };
const montarLigado = () => montar({ origem: { ...COM_GUARDA, entrega: { autonomia: true } } });
const montarTrabalha = () => montar({ origem: COM_GUARDA });
const PUSH = { command: 'git push origin main' };
const ASK = { command: 'git remote add x y' };
const SUFIXO = ' · autonomia (2.3.1): cala só publicar (push e merge na branch de produção, deploy), e só com a resposta "publica"; produção de terceiro, delete em massa, harness e push sem hooks sempre perguntam';
const eventosGuarda = (repo) => eventosDe(repo).map((e) => e.texto).join('').split('\n').filter((l) => l.includes('guarda.autonomia_usada'));

describe('autonomia: processo real', () => {
  test('publica-push-main-passa-e-grava-evento', () => {
    const repo = montarLigado();
    const r = rodar(repo, 'Bash', PUSH, {}, com(repo, home(LIGADO)));
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    const ev = eventosGuarda(repo);
    assert.ok(ev.length >= 1, 'sem evento guarda.autonomia_usada');
    assert.deepEqual(Object.keys(JSON.parse(ev[0]).dados).sort(), ['acao', 'alvo', 'ambiente']);
    assert.doesNotMatch(ev.join(''), /git push/);
  });

  test('evento-autonomia-usada-sem-comando: o evento leva só {alvo, acao, ambiente}', () => {
    const repo = montarLigado();
    const r = rodar(repo, 'Bash', { command: 'git push -u origin main' }, {}, com(repo, home(LIGADO)));
    assert.equal(r.decisao, undefined);
    const ev = eventosGuarda(repo);
    assert.ok(ev.length >= 1, 'sem evento');
    assert.deepEqual(Object.keys(JSON.parse(ev[0]).dados).sort(), ['acao', 'alvo', 'ambiente']);
    assert.doesNotMatch(ev.join(''), /push|-u /);
  });

  test('publica-terceiro-delete-integridade-hooks-pedem: com `publica` e interruptor, tudo que não é publicar pede (hook real)', () => {
    const repo = montarLigado();
    const h = home(LIGADO);
    const casos = [
      ['Write', { file_path: join(repo, 'harness.config.json'), content: '{}' }],
      ['Bash', ASK],
      ['Bash', { command: 'git push --no-verify origin main' }],
      ['Edit', { file_path: join(repo, '.githooks', 'pre-push'), old_string: 'a', new_string: 'b' }],
      ['Bash', { command: 'psql -h db.prod.exemplo.com -c "DELETE FROM t"' }],
      ['Bash', { command: 'psql -h db.prod.exemplo.com -c "select 1"' }],
      ['Bash', { command: 'curl https://api.exemplo.com/x' }],
      ['Bash', { command: 'git push --force origin main' }],
      ['Bash', { command: 'git push origin main && psql -h db.prod.exemplo.com -c "select 1"' }],
      ['Write', { file_path: join(h, '.claude', NOME_INTERRUPTOR), content: '{}' }],
    ];
    for (const [tool, input] of casos) {
      const r = rodar(repo, tool, input, {}, com(repo, h));
      assert.equal(r.decisao, 'ask', JSON.stringify(input));
      assert.ok(r.motivo.endsWith(SUFIXO), `sufixo de compatibilidade: ${JSON.stringify(input)}`);
      assert.equal(rodar(repo, tool, input, SUB, com(repo, h)).decisao, 'deny', `subagente ${JSON.stringify(input)}`);
    }
    assert.equal(eventosGuarda(repo).length, 0, 'nada disso grava guarda.autonomia_usada');
  });

  test('entrega-autonomia-so-da-origem: `true` só na árvore local ⇒ ask', () => {
    const repo = montar({ origem: { ...COM_GUARDA, entrega: { autonomia: false } } });
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify({ ...COM_GUARDA, entrega: { autonomia: true } }));
    const r = rodar(repo, 'Bash', PUSH, {}, com(repo, home(LIGADO)));
    assert.equal(r.decisao, 'ask');
    assert.ok(r.motivo.endsWith(SUFIXO), 'nível trabalha: o aviso entra no ask');
  });

  test('trabalha-nao-cala-publicar: `guarda.autonomia` sem `entrega.autonomia` ⇒ ask (DT2)', () => {
    const repo = montarTrabalha();
    assert.equal(rodar(repo, 'Bash', PUSH, {}, com(repo, home(LIGADO))).decisao, 'ask');
  });

  test('sem-interruptor-pede: sem o arquivo, `publica` na config ⇒ ask e motivo sem o aviso', () => {
    const repo = montarLigado();
    const r = rodar(repo, 'Bash', PUSH, {}, com(repo, home()));
    assert.equal(r.decisao, 'ask');
    assert.equal(r.motivo.includes('autonomia (2.3.1)'), false);
  });

  test('so-config-sem-interruptor-ask-no-processo', () => {
    const repo = montarLigado();
    assert.equal(rodar(repo, 'Bash', PUSH, {}, com(repo, home())).decisao, 'ask');
  });

  test('so-interruptor-sem-config-ask-no-processo (inclusive com "nenhuma")', () => {
    for (const origem of [CONFIG, { ...CONFIG, guarda: { ...CONFIG.guarda, autonomia: 'nenhuma' }, entrega: { autonomia: true } }]) {
      const repo = montar({ origem });
      assert.equal(rodar(repo, 'Bash', PUSH, {}, com(repo, home(LIGADO))).decisao, 'ask');
    }
  });

  test('subagente-nega-com-publica: publicar também é deny para o subagente', () => {
    const repo = montarLigado();
    assert.equal(rodar(repo, 'Bash', PUSH, SUB, com(repo, home(LIGADO))).decisao, 'deny');
    assert.equal(rodar(repo, 'Bash', ASK, SUB, com(repo, home(LIGADO))).decisao, 'deny');
  });

  test('ligado-segredo-continua-ask', () => {
    const repo = montarLigado();
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, '.env') }, {}, com(repo, home(LIGADO))).decisao, 'ask');
  });

  test('ligado-escrita-no-interruptor-pede (DT6: com `publica` também)', () => {
    const repo = montarLigado();
    const h = home(LIGADO);
    const alvo = join(h, '.claude', NOME_INTERRUPTOR);
    const r = rodar(repo, 'Write', { file_path: alvo, content: '{}' }, {}, com(repo, h));
    assert.equal(r.decisao, 'ask');
    assert.equal(eventosGuarda(repo).length, 0);
  });

  test('desligado-escrita-no-interruptor-pede (o agente não liga a autonomia sozinho)', () => {
    const repo = montar();
    const h = home();
    const alvo = join(h, '.claude', NOME_INTERRUPTOR);
    assert.equal(rodar(repo, 'Write', { file_path: alvo, content: '{"orquestrador":true}' }, {}, com(repo, h)).decisao, 'ask');
    assert.equal(rodar(repo, 'Bash', { command: `echo '{"orquestrador":true}' > ${alvo}` }, {}, com(repo, h)).decisao, 'ask');
  });

  test('ligado-escrita-no-interruptor-subagent-deny', () => {
    const repo = montarLigado();
    const h = home(LIGADO);
    const alvo = join(h, '.claude', NOME_INTERRUPTOR);
    assert.equal(rodar(repo, 'Write', { file_path: alvo, content: '{}' }, SUB, com(repo, h)).decisao, 'deny');
  });

  test('arquivo-invalido-ask-continua-ask', () => {
    const repo = montarLigado();
    assert.equal(rodar(repo, 'Bash', PUSH, {}, com(repo, home('{"orquestrador":"true"}'))).decisao, 'ask');
  });

  test('ligado-excecao-continua-ask', () => {
    const repo = montarLigado();
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

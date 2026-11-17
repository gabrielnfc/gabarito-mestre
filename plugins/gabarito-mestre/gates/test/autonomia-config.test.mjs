/**
 * Autonomia por projeto (GM-15 T15, REQ-AUT-2 b): a passagem do orquestrador exige os DOIS: `guarda.autonomia` = "orquestrador" em
 * `refs/remotes/origin/HEAD:harness.config.json` (a árvore local nunca vale: o agente a edita sem merge) E o interruptor
 * `~/.claude/gabarito-autonomia.json`. Só um deles ⇒ `ask`. `HOME` é sempre um tmp.
 *
 * MUTAÇÕES PRESCRITAS:
 *  C1  ler a autonomia da árvore local ⇒ `config-so-na-arvore-local-nao-liga` e `arvore-local-nao-liga` falham
 *  C2  aceitar qualquer valor truthy ⇒ `config-invalida-nao-liga` falha
 *  C3  ignorar a config (só o interruptor) ⇒ `so-interruptor-ask` falha
 *  M15a voltar a `||` ⇒ `so-config-ask` e `so-interruptor-ask` falham
 *  so-config-ask / so-interruptor-ask / os-dois-passa / arvore-local-nao-liga: ver os testes de mesmo nome
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, montar, rodar, eventosDe } from './_adaptador-helpers.mjs';

const comAutonomia = (valor) => ({ ...CONFIG, guarda: { ...CONFIG.guarda, ...(valor === undefined ? {} : { autonomia: valor }) } });
const ASK = { command: 'git remote add x y' };
const homeVazio = () => realpathSync(mkdtempSync(join(tmpdir(), 'gm-home-')));
const homeLigado = () => {
  const h = homeVazio();
  mkdirSync(join(h, '.claude'));
  writeFileSync(join(h, '.claude', 'gabarito-autonomia.json'), '{"orquestrador":true}');
  return h;
};
const opc = (repo, h = homeVazio()) => ({ repo, env: { HOME: h } });

describe('autonomia = config de origin/HEAD E interruptor', () => {
  test('os-dois-passa', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    const r = rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado()));
    assert.equal(r.decisao, undefined);
    assert.match(eventosDe(repo).map((e) => e.texto).join(''), /"tipo":"guarda\.autonomia_usada"/);
  });

  test('so-config-ask: a config sozinha (sem o interruptor) pede', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo)).decisao, 'ask');
  });

  test('so-interruptor-ask: o interruptor sozinho pede, com "nenhuma", sem a chave e sem onboarding (sem config)', () => {
    for (const origem of [comAutonomia('nenhuma'), comAutonomia(undefined), null]) {
      const repo = montar({ origem });
      assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado())).decisao, 'ask', JSON.stringify(origem));
    }
  });

  test('arvore-local-nao-liga: config só na árvore local + interruptor ⇒ ask', () => {
    const repo = montar({ origem: comAutonomia(undefined) });
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(comAutonomia('orquestrador')));
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado())).decisao, 'ask');
  });

  test('config-mista-chave-a-chave: a guarda lê só a chave da guarda; as outras 3 não ligam nem desligam', () => {
    const outras = { entrega: { autonomia: true }, sombra: { julga_emendas: true, libera_teto: true } };
    // outras 3 ligadas e guarda "nenhuma" + interruptor ⇒ ask
    let repo = montar({ origem: { ...comAutonomia('nenhuma'), ...outras } });
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado())).decisao, 'ask');
    // guarda "orquestrador" com as outras 3 desligadas + interruptor ⇒ passa
    repo = montar({ origem: { ...comAutonomia('orquestrador'), entrega: { autonomia: false }, sombra: { julga_emendas: false, libera_teto: false } } });
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado())).decisao, undefined);
  });

  test('os-dois-subagent-deny', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    assert.equal(rodar(repo, 'Bash', ASK, { agent_id: 'sub-1' }, opc(repo, homeLigado())).decisao, 'deny');
  });

  test('os-dois-segredo-continua-ask', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, '.env') }, {}, opc(repo, homeLigado())).decisao, 'ask');
  });

  test('config-invalida-nao-liga', () => {
    for (const v of ['sim', true, 1, 'ORQUESTRADOR', ['orquestrador'], { orquestrador: true }]) {
      const repo = montar({ origem: comAutonomia(v) });
      assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado())).decisao, 'ask', JSON.stringify(v));
    }
  });

  test('config-so-na-arvore-local-nao-liga (sem origin)', () => {
    const repo = montar({ origem: comAutonomia('orquestrador'), remoto: false });
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, homeLigado())).decisao, 'ask');
  });
});

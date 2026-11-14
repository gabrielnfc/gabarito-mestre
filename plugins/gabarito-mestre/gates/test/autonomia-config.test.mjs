/**
 * Autonomia por projeto: `guarda.autonomia` = "orquestrador" em `refs/remotes/origin/HEAD:harness.config.json` liga a mesma passagem
 * do interruptor de `~/.claude`. A árvore local nunca liga (o agente a edita sem merge). `HOME` é sempre um tmp vazio.
 *
 * MUTAÇÕES PRESCRITAS:
 *  C1  ler a autonomia da árvore local ⇒ `config-so-na-arvore-local-nao-liga` falha
 *  C2  aceitar qualquer valor truthy ⇒ `config-invalida-nao-liga` falha
 *  C3  ignorar a config (só o arquivo de `~/.claude`) ⇒ `config-orquestrador-liga` falha
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
const opc = (repo, h = homeVazio()) => ({ repo, env: { HOME: h } });

describe('autonomia por config de origin/HEAD', () => {
  test('config-orquestrador-liga', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    const r = rodar(repo, 'Bash', ASK, {}, opc(repo));
    assert.equal(r.decisao, undefined);
    assert.match(eventosDe(repo).map((e) => e.texto).join(''), /"tipo":"guarda\.autonomia"/);
  });

  test('config-orquestrador-nao-vale-para-subagent', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    assert.equal(rodar(repo, 'Bash', ASK, { agent_id: 'sub-1' }, opc(repo)).decisao, 'deny');
  });

  test('config-orquestrador-segredo-continua-ask', () => {
    const repo = montar({ origem: comAutonomia('orquestrador') });
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, '.env') }, {}, opc(repo)).decisao, 'ask');
  });

  test('config-nenhuma-ausente-ou-invalida-nao-liga', () => {
    for (const v of ['nenhuma', undefined]) {
      const repo = montar({ origem: comAutonomia(v) });
      assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo)).decisao, 'ask', String(v));
    }
  });

  test('config-invalida-nao-liga', () => {
    for (const v of ['sim', true, 1, 'ORQUESTRADOR', ['orquestrador'], { orquestrador: true }]) {
      const repo = montar({ origem: comAutonomia(v) });
      assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo)).decisao, 'ask', JSON.stringify(v));
    }
  });

  test('config-so-na-arvore-local-nao-liga', () => {
    const repo = montar({ origem: comAutonomia(undefined) });
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(comAutonomia('orquestrador')));
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo)).decisao, 'ask');
  });

  test('sem-origin-so-arvore-local-nao-liga', () => {
    const repo = montar({ origem: comAutonomia('orquestrador'), remoto: false });
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo)).decisao, 'ask');
  });

  test('arquivo-ou-config: o arquivo de ~/.claude também liga com config nenhuma', () => {
    const repo = montar({ origem: comAutonomia('nenhuma') });
    const h = homeVazio();
    mkdirSync(join(h, '.claude'));
    writeFileSync(join(h, '.claude', 'gabarito-autonomia.json'), '{"orquestrador":true}');
    assert.equal(rodar(repo, 'Bash', ASK, {}, opc(repo, h)).decisao, undefined);
  });
});

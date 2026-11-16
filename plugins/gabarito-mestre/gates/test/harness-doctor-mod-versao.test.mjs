/**
 * Testes do harness-doctor — GM-15 T20 (REQ-POU-3): o mod está carregado NESTA sessão e a versão do painel carregado.
 *
 * S4 (i) REFUTADA (t0b-relatorio): o Claude Code não expõe ao mod a versão que tem em memória; em sessão interativa o módulo
 * do mod recarrega do disco na hora, então "memória = disco" daria "ok" por construção. Plano B da spec: o doctor diz
 * "versão do painel carregado: não conferível" e manda reabrir o CLI depois de atualizar. NUNCA "ok".
 *
 * MUTAÇÕES PRESCRITAS (plano, T20):
 *  M20a o doctor diz "ok" para a versão sem lê-la (estado 'ok' quando há versão no disco) ⇒ doctor-versao-nao-conferivel morre
 *  M20c o doctor ignora a prova do mod e diz "carregado" sempre ⇒ doctor-mod-nao-carregado morre
 *  M20d a janela "de hoje" some (qualquer medição velha vale) ⇒ doctor-mod-so-de-hoje morre
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as doctor from '../scripts/harness-doctor.mjs';
import { agents, SCRIPT, repoComGit, AGORA, horasAtras, heartbeatLocal, hb, arq, ARQ_DIARIO } from './_doctor-helpers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VERSAO_DISCO = JSON.parse(readFileSync(join(AQUI, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
const medicao = (ts) => JSON.stringify({ seq: 2, ts, autor: 'a@b.c', sessao: 's1', agente: 'orquestrador', tipo: 'custo.medicao', dados: { input_tokens: 10, output_tokens: 5, cache_read: 0 }, hash_anterior: null });
const comMod = (horas) => {
  const dir = repoComGit({ 'AGENTS.md': agents(1) });
  heartbeatLocal(dir, horas, { linhas: [medicao(horasAtras(horas))] });
  return dir;
};
/** Mod ativo pelo relógio REAL (o CLI usa `Date.now()`): marcador local mais custo.medicao do orquestrador de 1 h atrás. */
const comModAgora = () => {
  const dir = repoComGit({ 'AGENTS.md': agents(1) });
  const ts = new Date(Date.now() - 3_600_000).toISOString();
  const ts2 = new Date(Date.now() - 1_800_000).toISOString();
  arq(dir, ARQ_DIARIO, `${hb(ts)}\n${medicao(ts2)}\n`);
  arq(dir, '.harness/heartbeat.json', JSON.stringify({ ts, sessao: 's1', arquivo: ARQ_DIARIO, autor: 'a@b.c', fonte: 'local', divergente: false }));
  return dir;
};
const semMod = () => repoComGit({ 'AGENTS.md': agents(1) });
const rodar = (dir, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
const linhaPainel = (out) => out.split('\n').find((l) => l.startsWith('painel: ')) ?? '';

describe('T20 doctor — mod carregado e versão do painel (REQ-POU-3)', () => {
  test('doctor-versao-nao-conferivel: com o mod ativo diz "não conferível" + reabrir o CLI, mostra a versão do disco e nunca "ok"', () => {
    const dir = comModAgora();
    const r = rodar(dir);
    const l = linhaPainel(r.stdout);
    assert.match(l, /mod carregado nesta sessão/, r.stdout);
    assert.ok(l.includes(`versão no disco: ${VERSAO_DISCO}`), l);
    assert.match(l, /versão do painel carregado: não conferível/, l);
    assert.match(l, /reabra o CLI depois de atualizar/, l);
    assert.doesNotMatch(l, /\bok\b/i, 'jamais "ok" para a versão carregada');
    const j = JSON.parse(rodar(dir, ['--json']).stdout).painel;
    assert.deepEqual(j, { mod: true, versaoDisco: VERSAO_DISCO, versaoCarregada: null, estado: 'nao-conferivel' });
  });

  test('doctor-mod-nao-carregado: sem prova do mod nesta sessão diz que não carregou e manda reabrir o CLI; a versão segue não conferível', () => {
    const dir = semMod();
    const r = rodar(dir);
    const l = linhaPainel(r.stdout);
    assert.match(l, /mod não carregado nesta sessão/, r.stdout);
    assert.match(l, /reabra o CLI depois de atualizar/, l);
    assert.match(l, /versão do painel carregado: não conferível/, l);
    assert.doesNotMatch(l, /mod carregado nesta/);
    const j = JSON.parse(rodar(dir, ['--json']).stdout).painel;
    assert.equal(j.mod, false);
    assert.equal(j.versaoCarregada, null);
    assert.equal(j.estado, 'nao-conferivel');
  });

  test('doctor-mod-so-de-hoje: medição do orquestrador de 30 h atrás não prova o mod carregado', () => {
    const dir = comMod(30);
    assert.equal(doctor.painelCarregado(dir, { agora: AGORA }).mod, false);
    assert.equal(doctor.painelCarregado(comMod(2), { agora: AGORA }).mod, true, 'controle: 2 h atrás vale');
  });

  test('doctor-versao-disco-ilegivel: sem o plugin.json lê "não lida" e segue não conferível (nunca inventa versão)', () => {
    const p = doctor.painelCarregado(semMod(), { agora: AGORA, pluginJson: join(AQUI, 'nao-existe', 'plugin.json') });
    assert.deepEqual(p, { mod: false, versaoDisco: null, versaoCarregada: null, estado: 'nao-conferivel' });
    assert.match(doctor.linhaPainel(p), /versão no disco: não lida/);
  });

  test('doctor-painel-ligado-ao-cli: a saída real traz a linha painel: depois da linha loop:', () => {
    const linhas = rodar(semMod()).stdout.split('\n');
    const iLoop = linhas.findIndex((l) => l.startsWith('loop: '));
    assert.ok(iLoop >= 0 && linhas[iLoop + 1].startsWith('painel: '), linhas.join('\n'));
  });
});

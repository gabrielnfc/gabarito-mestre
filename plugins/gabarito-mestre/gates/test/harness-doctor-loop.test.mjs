/**
 * Testes do harness-doctor — T12: linhas `loop:` e `db:` (REQ-LOOP-2, REQ-SLOT-1).
 *
 * `loop: mod ativo` só com PROVA de que o mod carregou nesta árvore e nesta sessão: o marcador local do heartbeat (gitignored,
 * cruzado com o diário) mais um `custo.medicao` do `orquestrador` na mesma `sessao`, de ≤ 24 h. Só o mod grava esse evento.
 * "Existe" (mod/gabarito.mjs no repo) ≠ "está ativo" (I10): sem prova, `sem mod`. Ausente, velho, forjado ou clonado ⇒ `sem mod`.
 *
 * MUTAÇÕES PRESCRITAS: task-12-mut.json da entrega.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as doctor from '../scripts/harness-doctor.mjs';
import { repo, agents, SCRIPT, git, repoComGit, AGORA, horasAtras, arq, heartbeatLocal, ARQ_DIARIO } from './_doctor-helpers.mjs';

const medicao = (ts, extra = {}) => JSON.stringify({ seq: 2, ts, autor: 'a@b.c', sessao: 's1', agente: 'orquestrador', tipo: 'custo.medicao', dados: { input_tokens: 10, output_tokens: 5, cache_read: 0 }, hash_anterior: null, ...extra });
const modDe = (dir) => doctor.modDoLoop(dir, AGORA);
/** Repo com o heartbeat local e, no mesmo diário, as linhas dadas. */
function comMod(linhas, { horas = 1, arquivos = {}, heartbeat = {} } = {}) {
  const dir = repoComGit({ 'AGENTS.md': agents(1), ...arquivos });
  heartbeatLocal(dir, horas, { linhas, ...heartbeat });
  return dir;
}

describe('T12 doctor — loop: mod ativo | sem mod', () => {
  test('doctor-loop-sem-mod: repo sem nenhum sinal ⇒ sem mod (sem pouso automático)', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1) });
    assert.deepEqual(modDe(dir), { mod: false });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /^loop: sem mod \(sem pouso automático\)$/m, r.stdout);
    assert.doesNotMatch(r.stdout, /mod ativo/);
    assert.equal(JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' }).stdout).loop.mod, false);
  });

  test('doctor-loop-mod-ativo: marcador local + custo.medicao do orquestrador da mesma sessão há ≤ 24 h', () => {
    const dir = comMod([medicao(horasAtras(2))]);
    const m = modDe(dir);
    assert.equal(m.mod, true);
    assert.equal(m.ha, 2);
    assert.equal(modDe(comMod([medicao(horasAtras(24))])).mod, true, '24 h exatas ainda vale');
  });

  test('doctor-loop-mod-ativo: a linha impressa diz mod ativo (pela borda)', () => {
    const agora = Date.now();
    const dir = repoComGit({ 'AGENTS.md': agents(1) });
    const ts = new Date(agora - 3_600_000).toISOString();
    const ts2 = new Date(agora - 1_800_000).toISOString();
    arq(dir, ARQ_DIARIO, `${JSON.stringify({ seq: 1, ts, autor: 'a@b.c', sessao: 's1', agente: 'orquestrador', tipo: 'guarda.heartbeat', dados: { fonte: 'local' }, hash_anterior: null })}\n${medicao(ts2)}\n`);
    arq(dir, '.harness/heartbeat.json', JSON.stringify({ ts, sessao: 's1', arquivo: ARQ_DIARIO, autor: 'a@b.c', fonte: 'local', divergente: false }));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /^loop: mod ativo/m, r.stdout);
    assert.doesNotMatch(r.stdout, /sem mod/);
  });

  test('doctor-loop-mod-existe-nao-e-ativo: mod/gabarito.mjs no repo e plano.json do loop, sem medição do orquestrador ⇒ sem mod', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1), 'plugins/gabarito-mestre/mod/gabarito.mjs': '// mod', '.harness/entregas/GM-10/plano.json': '{}' });
    assert.equal(modDe(dir).mod, false);
    heartbeatLocal(dir, 1); // heartbeat da guarda não é prova do mod
    assert.equal(modDe(dir).mod, false);
  });

  test('doctor-loop-sem-prova: medição velha (> 24 h), no futuro, de subagent, de outro tipo, de outra sessão ou truncada ⇒ sem mod', () => {
    const casos = {
      'velha 24,1 h': medicao(horasAtras(24.1)),
      'no futuro': medicao(horasAtras(-1)),
      'de subagent': medicao(horasAtras(1), { agente: 'subagent:abc' }),
      'outro tipo': medicao(horasAtras(1), { tipo: 'guarda.heartbeat' }),
      'outra sessão': medicao(horasAtras(1), { sessao: 'alheia' }),
      'ts inválido': medicao('ontem'),
      'ts ausente': medicao(undefined),
      truncada: medicao(horasAtras(1)).slice(0, 40),
      'não objeto': '[1,2]',
    };
    for (const [nome, linha] of Object.entries(casos)) assert.equal(modDe(comMod([linha])).mod, false, nome);
  });

  test('doctor-loop-clonado: diário de outra sessão (clone com custo.medicao de outro autor) não prova o mod desta árvore', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1) });
    heartbeatLocal(dir, 1);
    arq(dir, '.harness/entregas/GM-10/events.alheia.jsonl', `${medicao(horasAtras(1), { sessao: 'alheia' })}\n`);
    assert.equal(modDe(dir).mod, false);
  });

  test('doctor-loop-sem-marcador: custo.medicao sem o marcador local do heartbeat ⇒ sem mod (nada local prova a árvore)', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1) });
    arq(dir, ARQ_DIARIO, `${medicao(horasAtras(1))}\n`);
    assert.equal(modDe(dir).mod, false);
  });

  test('doctor-loop-marcador-versionado: marcador commitado viaja pelo git e não prova a árvore', () => {
    const dir = comMod([medicao(horasAtras(1))]);
    assert.equal(modDe(dir).mod, true);
    git(dir, 'add', '-f', '.harness/heartbeat.json');
    git(dir, 'commit', '-q', '-m', 'chore: marcador por engano');
    assert.equal(modDe(dir).mod, false);
  });

  test('doctor-loop-symlink: diário que é symlink não é lido', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1) });
    heartbeatLocal(dir, 1);
    const alvo = join(dir, 'fora.jsonl');
    writeFileSync(alvo, `${medicao(horasAtras(1))}\n`);
    arq(dir, '.harness/entregas/GM-10/x', '');
    symlinkSync(alvo, join(dir, '.harness/entregas/GM-10/events.s1.jsonl'));
    assert.equal(modDe(dir).mod, false);
  });

  test('doctor-loop-sessao-do-marcador-malformada: sessao com barra ou ponto ⇒ sem mod, sem sair da pasta', () => {
    for (const sessao of ['../x', 'a/b', '..', '.', '']) {
      const dir = comMod([medicao(horasAtras(1), { sessao })], { heartbeat: { sessao } });
      assert.equal(modDe(dir).mod, false, JSON.stringify(sessao));
    }
  });

  test('doctor-loop-pureza: modDoLoop não grava nada e não lança com .harness ausente', () => {
    const dir = repo({ 'AGENTS.md': agents(1) });
    assert.deepEqual(modDe(dir), { mod: false });
  });
});

describe('T12 doctor — db: declarado | n/a', () => {
  const cfgDb = (db) => ({ 'AGENTS.md': agents(1), 'harness.config.json': JSON.stringify({ db }) });
  const DB_OK = { psql: ['docker', 'exec', '-u', 'postgres', 'pg', 'psql'], template: 'gm_template' };
  const linha = (dir) => /^db: .*$/m.exec(spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' }).stdout)?.[0];

  test('doctor-db-na: config sem `db`, config ausente ⇒ db: n/a', () => {
    assert.equal(linha(repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': '{}' })), 'db: n/a');
    assert.equal(linha(repoComGit({ 'AGENTS.md': agents(1) })), 'db: n/a');
    assert.deepEqual(doctor.run(repoComGit({ 'AGENTS.md': agents(1) })).db, { estado: 'n/a' });
  });

  test('doctor-db-declarado: bloco db válido ⇒ db: declarado', () => {
    const dir = repoComGit(cfgDb(DB_OK));
    assert.equal(linha(dir), 'db: declarado');
    assert.deepEqual(doctor.run(dir).db, { estado: 'declarado' });
  });

  test('doctor-db-invalido: bloco presente mas inválido nunca vira "declarado"', () => {
    for (const db of [{}, { psql: ['psql', '-h', 'x'], template: 't' }, { ...DB_OK, template: 'postgres' }, { ...DB_OK, host: 'db.remoto.example' }, 'x', null, []]) {
      const dir = repoComGit(cfgDb(db));
      const l = linha(dir);
      assert.match(l, /^db: inválido \(/, `${JSON.stringify(db)}: ${l}`);
      assert.equal(doctor.run(dir).db.estado, 'inválido');
    }
  });

  test('doctor-db-config-ilegivel: config corrompida ⇒ db: indisponível, nunca n/a', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': '{nao json' });
    assert.match(linha(dir), /^db: indisponível \(/);
  });
});

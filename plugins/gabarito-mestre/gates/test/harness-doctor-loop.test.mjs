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
import { symlinkSync, writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync, copyFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import * as doctor from '../scripts/harness-doctor.mjs';
import { MOTIVO_BRANCHPADRAO, ORDEM_ITENS, coletarFatos, detectar, perguntas, gravar, rodarReal } from '../scripts/onboarding.mjs';
import * as diario from '../dist/diario.js';
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
    assert.match(r.stdout, /^loop: sem mod \(sem pouso automático\) · sem gatilho de mensagem do dono$/m, r.stdout);
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

describe('T14 doctor — modelos-por-papel (REQ-MOD-1): só aviso', () => {
  const comModelos = (modelos, extra = {}) => repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': JSON.stringify({ orquestracao: { modelos }, ...extra }) });
  const check = (dir) => doctor.run(dir).resultados.find((r) => r.id === 'modelos-por-papel');
  const avisosDe = (dir) => doctor.run(dir).avisos.filter((a) => a.startsWith('modelos-por-papel'));

  test('doctor-avisa-abaixo: revisor sonnet (recomendado opus) ⇒ aviso com papel, declarado e recomendado', () => {
    const dir = comModelos({ revisor: 'sonnet' });
    const [a, ...resto] = avisosDe(dir);
    assert.deepEqual(resto, []);
    assert.match(a, /^modelos-por-papel: revisor: declarado sonnet < recomendado opus$/, a);
    assert.equal(check(dir).found, false);
  });

  test('doctor-avisa-abaixo: forma {modelo, esforco} também vale; esforço não entra na comparação', () => {
    assert.match(avisosDe(comModelos({ revisor: { modelo: 'sonnet', esforco: 'high' } }))[0], /revisor: declarado sonnet < recomendado opus/);
    assert.deepEqual(avisosDe(comModelos({ implementador: { modelo: 'sonnet', esforco: 'low' } })), [], 'esforço baixo no recomendado não é aviso');
  });

  test('doctor-nao-compara-entre-papeis: implementador e revisor opus ⇒ nenhum aviso; implementador acima do revisor não avisa o revisor', () => {
    assert.deepEqual(avisosDe(comModelos({ implementador: 'opus', revisor: 'opus' })), []);
    assert.equal(check(comModelos({ implementador: 'opus', revisor: 'opus' })).found, true);
    // revisor no recomendado (opus), implementador acima (fable): nada a dizer
    assert.deepEqual(avisosDe(comModelos({ implementador: 'fable', revisor: 'opus' })), []);
    // implementador abaixo do revisor, mas no recomendado de si (sonnet): nada a dizer
    assert.deepEqual(avisosDe(comModelos({ implementador: 'sonnet', revisor: 'opus' })), []);
  });

  test('doctor-normaliza-id-completo: `claude-haiku-5-5` em implementador ⇒ aviso; `claude-opus-5-5` no revisor ⇒ nenhum', () => {
    assert.match(avisosDe(comModelos({ implementador: 'claude-haiku-5-5' }))[0], /implementador: declarado haiku < recomendado sonnet/);
    assert.deepEqual(avisosDe(comModelos({ revisor: 'Claude-OPUS-5-5' })), []);
  });

  test('doctor-modelo-desconhecido: nome fora de haiku|sonnet|opus|fable ⇒ aviso `desconhecido`, nunca comparado', () => {
    const [a, ...resto] = avisosDe(comModelos({ revisor: 'gpt-9' }));
    assert.deepEqual(resto, []);
    assert.match(a, /revisor: desconhecido \("gpt-9"\)/, a);
    assert.match(avisosDe(comModelos({ revisor: { modelo: 7 } }))[0], /revisor: desconhecido/, 'forma inválida também é desconhecido');
    assert.match(avisosDe(comModelos({ revisor: null }))[0], /revisor: desconhecido/);
  });

  test('doctor-modelo-desconhecido: papel que o config declara e a visão não tem ⇒ aviso (erro de digitação não passa calado)', () => {
    assert.match(avisosDe(comModelos({ revisro: 'opus' }))[0], /revisro: papel desconhecido/);
  });

  test('doctor-avisa-todos: dois papéis abaixo ⇒ os dois no mesmo aviso, na ordem declarada', () => {
    const [a] = avisosDe(comModelos({ implementador: 'haiku', revisor: 'sonnet' }));
    assert.equal(a, 'modelos-por-papel: implementador: declarado haiku < recomendado sonnet; revisor: declarado sonnet < recomendado opus');
  });

  test('doctor-papel-herdado-do-prototipo: papel `constructor`/`toString` no config ⇒ aviso de papel desconhecido (guarda por Object.hasOwn)', () => {
    for (const papel of ['constructor', 'toString', 'hasOwnProperty']) {
      const [a, ...resto] = avisosDe(comModelos({ [papel]: 'haiku' }));
      assert.deepEqual(resto, [], papel);
      assert.match(a, new RegExp(`^modelos-por-papel: ${papel}: papel desconhecido \\(sem modelo recomendado\\)$`), a);
    }
  });

  test('doctor-sem-modelos-silencio: sem orquestracao.modelos (ou vazio) ⇒ nenhum aviso, check verde', () => {
    for (const cfg of [{}, { orquestracao: {} }, { orquestracao: { modelos: {} } }]) {
      const dir = repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': JSON.stringify(cfg) });
      assert.deepEqual(avisosDe(dir), [], JSON.stringify(cfg));
      assert.equal(check(dir).found, true);
    }
  });

  test('doctor-config-ausente-x-corrompida: ausente ⇒ silêncio; corrompida ou modelos que não é objeto ⇒ aviso (distintos)', () => {
    const ausente = repoComGit({ 'AGENTS.md': agents(1) });
    assert.deepEqual(avisosDe(ausente), []);
    const corrompida = repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': '{nao json' });
    assert.match(avisosDe(corrompida)[0], /harness\.config\.json inválido/);
    for (const m of ['sonnet', ['opus'], null, 3]) {
      assert.match(avisosDe(comModelos(m))[0], /orquestracao\.modelos inválido/, JSON.stringify(m));
    }
    assert.match(avisosDe(repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': JSON.stringify({ orquestracao: 'x' }) }))[0], /orquestracao inválido/);
  });

  test('doctor-modelos-so-aviso: o check é level warn; o nível e o rc do CLI são os mesmos com e sem aviso (não quebra CI)', () => {
    const com = comModelos({ revisor: 'haiku', implementador: 'gpt-9' });
    const sem = repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': '{}' });
    assert.equal(doctor.CHECKS.find((c) => c.id === 'modelos-por-papel').level, 'warn');
    const a = doctor.run(com);
    const b = doctor.run(sem);
    assert.ok(a.avisos.some((x) => x.startsWith('modelos-por-papel')));
    assert.equal(a.alcancado, b.alcancado);
    assert.equal(a.novasFaltando.includes('modelos-por-papel'), false);
    const rc = (d) => spawnSync(process.execPath, [SCRIPT], { cwd: d, encoding: 'utf8' }).status;
    assert.equal(rc(com), rc(sem));
  });

  const comPerfil = (orq) => repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': JSON.stringify({ orquestracao: orq }) });

  test('doctor-economia-nao-avisa-abaixo-do-padrao: com economia o recomendado é a tabela do perfil, não MODELOS_PADRAO', () => {
    const dir = comPerfil({ perfil: 'economia', modelos: { revisor: 'sonnet', spike: 'sonnet', revisor_final: 'opus', implementador: { modelo: 'sonnet', esforco: 'medium' } } });
    assert.deepEqual(avisosDe(dir), []);
    assert.equal(check(dir).found, true);
    // o mesmo declarado, sem perfil, é abaixo do padrão
    assert.match(avisosDe(comModelos({ revisor: 'sonnet' }))[0], /revisor: declarado sonnet < recomendado opus/);
  });

  test('doctor-economia-abaixo-do-perfil-avisa: haiku onde a economia recomenda sonnet; qualidade recomenda opus', () => {
    assert.equal(avisosDe(comPerfil({ perfil: 'economia', modelos: { revisor: 'haiku' } })).join('|'), 'modelos-por-papel: revisor: declarado haiku < recomendado sonnet');
    assert.equal(avisosDe(comPerfil({ perfil: 'qualidade', modelos: { basico: 'haiku', revisor_final: 'opus' } })).join('|'), 'modelos-por-papel: basico: declarado haiku < recomendado sonnet; revisor_final: declarado opus < recomendado fable');
  });

  test('doctor-economia-linha-informar: economia ⇒ 1 linha informativa na evidência (found, sem aviso); outros perfis não a trazem', () => {
    const LINHA = 'perfil economia: review de task e spike em sonnet, review final em opus';
    for (const orq of [{ perfil: 'economia' }, { perfil: 'economia', modelos: {} }]) {
      const dir = comPerfil(orq);
      assert.equal(check(dir).evidence, LINHA);
      assert.equal(check(dir).found, true);
      assert.deepEqual(avisosDe(dir), []);
    }
    for (const orq of [{ perfil: 'padrao' }, { perfil: 'qualidade' }, {}]) assert.doesNotMatch(check(comPerfil(orq)).evidence ?? '', /perfil economia/, JSON.stringify(orq));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: comPerfil({ perfil: 'economia' }), encoding: 'utf8' });
    assert.ok(r.stdout.includes(`↳ ${LINHA}`), r.stdout);
  });

  test('doctor-perfil-invalido-aviso: perfil inválido ⇒ aviso e compara com o padrão; ausente não avisa (distintos)', () => {
    const dir = comPerfil({ perfil: 'luxo', modelos: { revisor: 'sonnet' } });
    const a = avisosDe(dir).join('|');
    assert.match(a, /orquestracao\.perfil inválido \("luxo"\)/);
    assert.match(a, /revisor: declarado sonnet < recomendado opus/);
    assert.equal(check(dir).found, false);
    assert.deepEqual(avisosDe(comPerfil({ modelos: { revisor: 'opus' } })), []);
  });

  test('doctor-perfil-invalido-sem-modelos: perfil inválido SEM orquestracao.modelos ⇒ aviso, found:false, nível não muda, compara com padrao', () => {
    const dir = comPerfil({ perfil: 'luxo' });
    const c = check(dir);
    assert.equal(c.found, false);
    assert.equal(c.evidence, 'orquestracao.perfil inválido ("luxo"): esperado economia, padrao ou qualidade; comparo com o padrão');
    assert.deepEqual(avisosDe(dir), ['modelos-por-papel: ' + c.evidence]);
    const j = (d) => JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: d, encoding: 'utf8' }).stdout);
    assert.notEqual(j(dir).alcancado, undefined);
    assert.equal(j(dir).alcancado, j(comPerfil({})).alcancado);
    assert.deepEqual(avisosDe(comPerfil({ perfil: 'padrao' })), []);
  });

  test('doctor-qualidade-sem-modelos-cita-tabela: evidência cita o perfil efetivo, não os padrões da visão', () => {
    for (const orq of [{ perfil: 'qualidade' }, { perfil: 'qualidade', modelos: {} }]) {
      const c = check(comPerfil(orq));
      assert.equal(c.found, true);
      assert.match(c.evidence, /vale a tabela do perfil qualidade/, JSON.stringify(orq));
      assert.doesNotMatch(c.evidence, /padrões da visão/);
    }
    assert.match(check(comPerfil({})).evidence, /valem os padrões da visão/);
  });

  test('doctor-modelos-pela-borda: CLI real imprime o aviso na seção de avisos e no --json', () => {
    const dir = comModelos({ revisor: 'sonnet' });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /warn .*\n\s+↳ revisor: declarado sonnet < recomendado opus/, r.stdout);
    const j = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' }).stdout);
    assert.ok(j.avisos.includes('modelos-por-papel: revisor: declarado sonnet < recomendado opus'), JSON.stringify(j.avisos));
  });
});

describe('T14 skill gabarito-loop — ponteiros aos CLIs da E3', () => {
  const RAIZ_PLUGIN = join(dirname(SCRIPT), '..', '..');
  const skill = readFileSync(join(RAIZ_PLUGIN, 'skills', 'gabarito-loop', 'SKILL.md'), 'utf8');

  test('skill-loop-cita-sombra-emenda-entrega: os três CLIs e as interfaces reais', () => {
    for (const re of [/sombra\.mjs" perguntar/, /sombra\.mjs" registrar/, /gabarito-sombra/, /`prompt`/, /`aviso`/, /`pendente`/, /loop\.mjs" desvio/, /descoberta/, /emenda propor/, /proposta_seq/, /esperar\{emenda\}/, /entrega\.mjs" decidir/, /entrega\.mjs" executar/, /checkout_sujo/, /entrega_em_curso/, /ancora_nao_gravada/, /release_pr/, /nunca merge/, /agendar/, /`quando`/, /esperar\{homolog\}/]) {
      assert.match(skill, re);
    }
  });

  test('skill-loop-integrar-verde-relata: relato não vazio ⇒ repassa desvio:/aviso: ao dono e ao revisor; [] não prova zero desvio', () => {
    assert.match(skill, /relato/);
    assert.match(skill, /`desvio:`\/`aviso:`/);
    assert.match(skill, /`\[\]` não prova/);
  });

  // Instrução, não token: o texto é normalizado (quebra de linha + recuo ⇒ 1 espaço) e a frase inteira de cada ramo é presa,
  // com verbo e destinatário. Inverter o verbo (ignore, siga despachando, rode executar, despache de novo) derruba o teste.
  const plano = skill.replace(/\s*\n\s*/g, ' ');

  test('skill-loop-instrucao-relato: integrar verde com relato ⇒ REPASSE ao dono e ao revisor; nunca ignorar', () => {
    assert.match(plano, /`integrar` \(`tasks\[\]`\): `integrar <task>` .*? Verde com `relato` não vazio: repasse as linhas `desvio:`\/`aviso:` ao dono e ao revisor da entrega; `\[\]` não prova zero desvios sem ler o `aviso:`\./);
    assert.doesNotMatch(plano, /ignore as linhas/i);
  });

  test('skill-loop-instrucao-esperar-emenda: avisa o dono do comando e PARA o turno', () => {
    assert.match(plano, /`esperar\{emenda\}`: há proposta de emenda aberta; avise o dono \(`\/gabarito-mestre:emenda aprovar\|rejeitar <seq>`\) e pare o turno\./);
    assert.doesNotMatch(plano, /esperar\{emenda\}[^-]*siga despachando/);
  });

  test('skill-loop-instrucao-esperar-homolog: informa o dono (com o aviso) e PARA o turno; não executa', () => {
    assert.match(plano, /`esperar\{homolog\}`: informe o dono \(com o `aviso`, se houver\) e pare o turno\./);
    assert.doesNotMatch(plano, /esperar\{homolog\}[^.]*rode executar/);
  });

  test('skill-loop-instrucao-pendente: consulta aberta ⇒ segue outra task e NÃO repergunta nem redespacha a Sombra', () => {
    assert.match(plano, /`pendente`: a consulta está aberta; siga outra task, não repergunte\./);
    assert.doesNotMatch(plano, /despache a Sombra de novo/i);
  });

  test('skill-loop-instrucao-subir-negado: deploy negado pelo modo ⇒ NÃO contorna, devolve ao dono com o comando exato e PARA o turno', () => {
    assert.match(plano, /- `subir`: `entrega\.mjs" executar`\. Falhas esperadas: `checkout_sujo`, `entrega_em_curso`, `ancora_nao_gravada`: pare e diga a causa\. Negado pelo modo de permissão \(o `auto` classifica como deploy de produção\): não contorne nem tente outro caminho; diga ao dono que o deploy é dele, com o comando exato `node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/entrega\.mjs" executar`, e pare o turno\./);
    assert.doesNotMatch(plano, /tente outro caminho(?!;)|contorne o bloqueio|rode (?:o )?deploy (?:você|por outro)/i);
  });

  test('skill-loop-instrucao-ci-homolog: CI de homolog após a última integração grava `ci --alvo homolog`; sem ele fica em esperar{homolog}', () => {
    assert.match(plano, /2\. CI da entrega: `ci verde\|vermelho`\. CI de homolog após a última integração: `ci verde\|vermelho --alvo homolog` \(sem ele `continua` e `janela` ficam em `esperar\{homolog\}`\)\. Falha que você não consegue resolver: `parar nao_conseguiu`\./);
  });

  test('skill-loop-instrucao-item-modelo-emendas: o item traz modelo, decisoes e emendas e a skill manda usá-los', () => {
    assert.match(plano, /`despachar` \(`itens\[\{task,papel,spec\?,achados\?,modelo,decisoes,emendas\}\]`\)/);
    assert.match(plano, /`Agent` recebe o `modelo` do item; `decisoes` e `emendas` \(diff aprovado da spec\) vão ao agente como ponteiro\./);
  });

  test('skill-loop-limite: ≤ 80 linhas e sem cópia de requisito', () => {
    assert.ok(skill.split('\n').length - 1 <= 80, `${skill.split('\n').length - 1} linhas`);
    assert.doesNotMatch(skill, /^\*\*REQ-/m);
  });
});

// ── T13 (GM-13, REQ-APR-4 e ONB-1): avisos de aprendizado sem destino, itens não detectados e texto sem "fase N" ──────────────────
describe('T13 doctor — aprendizado sem destino, onboarding não detectado, sem fase', () => {
  const t = (min) => new Date(Date.UTC(2026, 10, 10, 10, min, 0)).toISOString();
  const grava = (dir, entrega, sessao, tipo, dados, min) => {
    const r = diario.append(join(dir, '.harness', 'entregas', entrega), sessao, { ts: t(min), autor: 'a@x', sessao, agente: 'orquestrador', tipo, dados });
    assert.equal(r.ok, true, JSON.stringify(r));
  };
  const planoDe = (dir, entrega, ids) => arq(dir, `.harness/entregas/${entrega}/plano.json`, JSON.stringify({ entrega, tasks: ids.map((id) => ({ id, deps: [], arquivos: [`${id}.ts`], reqs: ['REQ-APR-4'] })) }));
  const integrar = (dir, entrega, id, min) => {
    grava(dir, entrega, 'loop', 'task.iniciada', { task: id, papel: 'implementador' }, min);
    grava(dir, entrega, 'loop', 'task.concluida', { task: id }, min + 1);
    grava(dir, entrega, 'loop', 'task.iniciada', { task: id, papel: 'revisor' }, min + 2);
    grava(dir, entrega, 'loop', 'review.veredito', { task: id, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, min + 3);
    grava(dir, entrega, 'loop', 'task.integrada', { task: id }, min + 4);
  };
  const cfgComOnboarding = (extra = {}) => ({ 'harness.config.json': JSON.stringify({ fluxo: { resolvidoEm: '2026-11-10' }, ...extra }) });
  const achado = (out, id) => out.resultados.find((r) => r.id === id);
  const avisosDe = (out, id) => out.avisos.filter((a) => a.startsWith(`${id}: `));
  const base = () => repoComGit({ 'AGENTS.md': agents(1) });

  test('doctor-sem-mod-cita-mensagem: só o `sem mod` ganha o trecho; `mod ativo` não', () => {
    const dir = base();
    const sem = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' }).stdout;
    assert.match(sem, /^loop: sem mod \(sem pouso automático\) · sem gatilho de mensagem do dono$/m, sem);
    const agora = Date.now();
    const com = repoComGit({ 'AGENTS.md': agents(1) });
    const ts = new Date(agora - 3_600_000).toISOString();
    arq(com, ARQ_DIARIO, `${JSON.stringify({ seq: 1, ts, autor: 'a@b.c', sessao: 's1', agente: 'orquestrador', tipo: 'guarda.heartbeat', dados: { fonte: 'local' }, hash_anterior: null })}\n${medicao(new Date(agora - 1_800_000).toISOString())}\n`);
    arq(com, '.harness/heartbeat.json', JSON.stringify({ ts, sessao: 's1', arquivo: ARQ_DIARIO, autor: 'a@b.c', fonte: 'local', divergente: false }));
    const ativo = spawnSync(process.execPath, [SCRIPT], { cwd: com, encoding: 'utf8' }).stdout;
    assert.match(ativo, /^loop: mod ativo/m, ativo);
    assert.doesNotMatch(ativo, /sem gatilho de mensagem do dono/);
  });

  test('doctor-nao-detectado-avisa-sem-bloquear: 1 aviso por item com `trocar <item>`, nível e checagens obrigatórias iguais', () => {
    const sem = doctor.run(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding({ onboarding: { resolvidoEm: '2026-11-10', naoDetectado: [] } }) }));
    const com = doctor.run(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding({ onboarding: { resolvidoEm: '2026-11-10', naoDetectado: ['tipo_repo', 'orquestracao'] } }) }));
    assert.deepEqual(avisosDe(com, 'onboarding-nao-detectado').length, 2);
    assert.match(avisosDe(com, 'onboarding-nao-detectado')[0], /^onboarding-nao-detectado: tipo_repo: gabarito-instalar \(trocar tipo_repo\)$/);
    assert.match(avisosDe(com, 'onboarding-nao-detectado')[1], /^onboarding-nao-detectado: orquestracao: gabarito-instalar \(trocar orquestracao\)$/);
    assert.equal(achado(com, 'onboarding-nao-detectado').level, 'warn');
    assert.equal(achado(com, 'onboarding-nao-detectado').found, false);
    assert.deepEqual(avisosDe(sem, 'onboarding-nao-detectado'), []);
    assert.equal(com.alcancado, sem.alcancado);
    assert.deepEqual(com.novasFaltando, sem.novasFaltando);
    const rc = (d) => spawnSync(process.execPath, [SCRIPT], { cwd: d, encoding: 'utf8' }).status;
    assert.equal(rc(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding({ onboarding: { naoDetectado: ['tipo_repo'] } }) })), rc(repoComGit({ 'AGENTS.md': agents(1) })));
  });

  test('onboarding-nao-detectado-motivo-branchpadrao: só o item `versionamento` com branchPadrao que reprova `feat/<ID>-1-x` traz o motivo (D-1)', () => {
    const run = (cfg, itens) => doctor.run(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding({ ...cfg, onboarding: { naoDetectado: itens } }) }));
    const nome = avisosDe(run({ versionamento: { branchPadrao: 'main' } }, ['versionamento', 'tipo_repo']), 'onboarding-nao-detectado');
    assert.equal(nome[0], `onboarding-nao-detectado: versionamento: gabarito-instalar (trocar versionamento) — ${MOTIVO_BRANCHPADRAO}`);
    assert.equal(nome[1], 'onboarding-nao-detectado: tipo_repo: gabarito-instalar (trocar tipo_repo)', 'outro item não herda o motivo');
    // regex que aceita a branch de PBI ⇒ sem motivo; sem branchPadrao ⇒ sem motivo
    assert.doesNotMatch(avisosDe(run({ versionamento: { branchPadrao: '^feat/[A-Z]+-\\d+-[a-z]$' } }, ['versionamento']), 'onboarding-nao-detectado')[0], /branchPadrao/);
    assert.doesNotMatch(avisosDe(run({}, ['versionamento']), 'onboarding-nao-detectado')[0], /branchPadrao/);
    // regex ilegível também não casa nada: motivo (e nunca exceção)
    assert.match(avisosDe(run({ versionamento: { branchPadrao: '(' } }, ['versionamento']), 'onboarding-nao-detectado')[0], /branchPadrao é nome de branch/);
  });

  test('motivo-branchpadrao-igual-ao-do-onboarding: a cópia do doctor não deriva do texto do onboarding', () => {
    assert.equal(doctor.MOTIVO_BRANCHPADRAO, MOTIVO_BRANCHPADRAO);
  });

  test('aprendizado-sem-destino-sem-dist: cópia do doctor sem dist/ não cai e avisa que não conferiu', () => {
    const plug = mkdtempSync(join(tmpdir(), 'doctor-sem-dist-'));
    mkdirSync(join(plug, 'scripts'), { recursive: true });
    mkdirSync(join(plug, 'lib'), { recursive: true });
    for (const f of ['harness-doctor.mjs', 'versionamento-check.mjs', 'db-template.mjs']) copyFileSync(join(dirname(SCRIPT), f), join(plug, 'scripts', f));
    for (const f of ['cli', 'config', 'git', 'datas']) copyFileSync(join(dirname(SCRIPT), '..', 'lib', `${f}.mjs`), join(plug, 'lib', `${f}.mjs`));
    const r = spawnSync(process.execPath, [join(plug, 'scripts', 'harness-doctor.mjs'), '--json'], { cwd: base(), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status === 0 || r.status === 1, true, r.stderr);
    const av = JSON.parse(r.stdout).avisos.filter((a) => a.startsWith('aprendizado-sem-destino: '));
    assert.equal(av.length, 1);
    assert.match(av[0], /dist\/ do núcleo não carregou/);
    assert.doesNotMatch(av[0].split('aprendizado não conferido;')[1], /node |\.mjs/, 'a orientação da evidência também não manda colar comando (FX3)');
  });

  test('onboarding-ausente-x-corrompido: ausente calado; corrompido e config inválida avisam a leitura', () => {
    const calado = [{}, { onboarding: {} }, { onboarding: { naoDetectado: [] } }];
    for (const extra of calado) {
      const r = achado(doctor.run(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding(extra) })), 'onboarding-nao-detectado');
      assert.equal(r.found, true, JSON.stringify(extra));
    }
    const tortos = [{ onboarding: null }, { onboarding: 'x' }, { onboarding: [] }, { onboarding: { naoDetectado: 'tipo_repo' } }, { onboarding: { naoDetectado: {} } }, { onboarding: { naoDetectado: [1] } }, { onboarding: { naoDetectado: [''] } }, { onboarding: { naoDetectado: ['tipo_repo', null] } }];
    for (const extra of tortos) {
      const out = doctor.run(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding(extra) }));
      assert.equal(achado(out, 'onboarding-nao-detectado').found, false, JSON.stringify(extra));
      assert.match(avisosDe(out, 'onboarding-nao-detectado')[0], /ilegível/, JSON.stringify(extra));
    }
    const invalida = doctor.run(repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': '{ torto' }));
    assert.equal(achado(invalida, 'onboarding-nao-detectado').found, false);
    assert.match(avisosDe(invalida, 'onboarding-nao-detectado')[0], /harness\.config\.json inválido/);
  });

  test('aprendizado-sem-destino-ausente-calado: sem .harness/entregas nada a avisar', () => {
    const out = doctor.run(base());
    assert.equal(achado(out, 'aprendizado-sem-destino').found, true);
    assert.equal(achado(out, 'aprendizado-sem-destino').level, 'warn');
    assert.deepEqual(avisosDe(out, 'aprendizado-sem-destino'), []);
  });

  test('aprendizado-sem-destino-costura-real: diário gravado pelo adaptador real ⇒ aviso com o comando; fechar some; nível não muda', () => {
    const dir = base();
    const antes = doctor.run(dir);
    planoDe(dir, 'GM-9', ['T1']);
    integrar(dir, 'GM-9', 'T1', 0);
    const out = doctor.run(dir);
    const av = avisosDe(out, 'aprendizado-sem-destino');
    assert.equal(av.length, 1, av.join('\n'));
    assert.match(av[0], /entrega GM-9 .*fechamento loop:5/);
    assert.match(av[0], /loop\.mjs aprendizado nada --gatilho loop:5 --motivo <texto> --entrega GM-9/);
    assert.equal(achado(out, 'aprendizado-sem-destino').level, 'warn');
    assert.equal(out.alcancado, antes.alcancado);
    assert.deepEqual(out.novasFaltando, antes.novasFaltando);
    grava(dir, 'GM-9', 'loop', 'aprendizado.nada', { gatilho: { sessao: 'loop', seq: 5 }, motivo: 'nada a registrar' }, 10);
    const depois = doctor.run(dir);
    assert.deepEqual(avisosDe(depois, 'aprendizado-sem-destino'), []);
    assert.equal(achado(depois, 'aprendizado-sem-destino').found, true);
  });

  test('aprendizado-sem-destino-m-envelhecido-pela-arvore: M com 3 entregas depois avisa; 2 não', () => {
    const dir = base();
    grava(dir, 'GM-1', 'loop', 'loop.iniciar', {}, 0);
    grava(dir, 'GM-1', 'loop', 'aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra: 'confira o build', entra_em: ['instantaneo'] }, 1);
    grava(dir, 'GM-2', 'loop', 'loop.iniciar', {}, 10);
    grava(dir, 'GM-3', 'loop', 'loop.iniciar', {}, 20);
    assert.deepEqual(avisosDe(doctor.run(dir), 'aprendizado-sem-destino'), [], 'exatamente 2 entregas depois: silêncio');
    grava(dir, 'GM-4', 'loop', 'loop.iniciar', {}, 30);
    const av = avisosDe(doctor.run(dir), 'aprendizado-sem-destino');
    assert.equal(av.length, 1);
    assert.match(av[0], /M GM-1\/loop:2 sem substituto há 3 entregas/);
  });

  test('aprendizado-sem-destino-corrompido: diário ilegível e plano ilegível avisam, nunca calam', () => {
    const dir = base();
    arq(dir, '.harness/entregas/GM-8/events.s1.jsonl', '{ isto não é json\n');
    const out = doctor.run(dir);
    assert.equal(achado(out, 'aprendizado-sem-destino').found, false);
    assert.match(avisosDe(out, 'aprendizado-sem-destino')[0], /GM-8 ilegível/);
    const dir2 = base();
    grava(dir2, 'GM-7', 'loop', 'loop.iniciar', {}, 0);
    arq(dir2, '.harness/entregas/GM-7/plano.json', '{ torto');
    const out2 = doctor.run(dir2);
    assert.equal(achado(out2, 'aprendizado-sem-destino').found, false);
    assert.match(avisosDe(out2, 'aprendizado-sem-destino')[0], /GM-7\/plano\.json inválido/);
  });

  test('aprendizado-sem-destino-fifo: FIFO no lugar do plano ou do diário não trava o doctor e vira aviso', () => {
    for (const nome of ['plano.json', 'events.s1.jsonl']) {
      const dir = base();
      grava(dir, 'GM-6', 'loop', 'loop.iniciar', {}, 0);
      const alvo = join(dir, '.harness/entregas/GM-6', nome);
      if (nome !== 'plano.json') rmSync(alvo, { force: true });
      execFileSync('mkfifo', [alvo]);
      const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', timeout: 4000 });
      assert.equal(r.status === null, false, `${nome}: doctor travou (${r.error?.code})`);
      const av = JSON.parse(r.stdout).avisos.filter((a) => a.startsWith('aprendizado-sem-destino: '));
      assert.equal(av.length, 1, `${nome}: ${av}`);
      assert.match(av[0], /GM-6.*não é arquivo regular/);
    }
  });

  test('doctor-sem-fase-no-texto: label e fix dos checks apontam um item real do onboarding, nunca "fase N"', () => {
    const out = doctor.run(base());
    const esperado = { versionamento: 'versionamento', 'modelo-resolvido': 'orquestracao', 'iniciativa-resolvida': 'iniciativa' };
    for (const [id, item] of Object.entries(esperado)) {
      const r = achado(out, id);
      assert.match(r.fix, new RegExp(`gabarito-instalar \\(trocar ${item}\\)`), `${id}: ${r.fix}`);
      assert.doesNotMatch(`${r.label} ${r.fix}`, /fase/i, id);
    }
    // `fluxo-configurado` falha quando o onboarding nunca rodou: o remédio é a skill inteira, não um `trocar <item>` que não existe
    const fluxo = achado(out, 'fluxo-configurado');
    assert.match(fluxo.fix, /^peça ao Claude gabarito-instalar \(o onboarding nunca rodou aqui\)/);
    assert.doesNotMatch(`${fluxo.label} ${fluxo.fix}`, /fase|trocar/i);
    assert.doesNotMatch(readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'), /\bfase [234]\b|\(fase /);
  });

  test('doctor-item-citado-existe: todo `trocar <item>` de label, fix e evidência é um item de ORDEM_ITENS (onboarding.mjs)', () => {
    const itens = new Set();
    for (const c of doctor.CHECKS) for (const m of `${c.label} ${c.fix}`.matchAll(/trocar ([a-z_]+)/g)) itens.add(m[1]);
    assert.deepEqual([...itens].sort(), ['iniciativa', 'orquestracao', 'versionamento'], 'o teste enxerga os itens citados (não é vacuamente verde)');
    // FX4 D3: `iniciativa` não é pergunta (D-3): é o `trocar iniciativa` da skill, fora de ORDEM_ITENS
    const FORA_DAS_PERGUNTAS = ['settings', 'codeowners', 'apendice', 'iniciativa', 'contenda'];
    for (const item of itens) assert.ok(ORDEM_ITENS.includes(item) || FORA_DAS_PERGUNTAS.includes(item), `"trocar ${item}" não é item do onboarding (${ORDEM_ITENS.join(', ')})`);
    // a evidência cita o item que o onboarding gravou, um por linha, para todos os itens reais
    const out = doctor.run(repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding({ onboarding: { naoDetectado: [...ORDEM_ITENS] } }) }));
    const citados = avisosDe(out, 'onboarding-nao-detectado').map((a) => /\(trocar ([a-z_]+)\)/.exec(a)?.[1]);
    assert.deepEqual(citados, ORDEM_ITENS);
  });

  test('doctor-saida-humana-uma-seta-por-linha: 2+ itens não detectados saem cada um em `↳` próprio', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(1), ...cfgComOnboarding({ onboarding: { naoDetectado: ['tipo_repo', 'orquestracao'] } }) });
    const out = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' }).stdout;
    const linhas = out.split('\n');
    const i = linhas.findIndex((l) => l.includes('↳ tipo_repo: gabarito-instalar (trocar tipo_repo)'));
    assert.notEqual(i, -1, out);
    assert.equal(linhas[i + 1].trim(), '↳ orquestracao: gabarito-instalar (trocar orquestracao)', 'a 2ª linha da evidência tem o próprio `↳`');
    assert.match(linhas[i + 1], /^ {8}↳ /, 'e o mesmo recuo');
  });

  test('aprendizado-sem-destino-symlink: diário ou plano.json que é symlink não é lido e vira aviso', () => {
    const dir = base();
    grava(dir, 'GM-5', 'loop', 'loop.iniciar', {}, 0);
    const alvo = join(dir, '.harness/entregas/GM-5/events.loop.jsonl');
    const fora = join(dir, 'fora.jsonl');
    writeFileSync(fora, readFileSync(alvo, 'utf8'));
    rmSync(alvo, { force: true });
    symlinkSync(fora, alvo);
    const av = avisosDe(doctor.run(dir), 'aprendizado-sem-destino');
    assert.equal(av.length, 1, av.join('\n'));
    assert.match(av[0], /GM-5 ilegível \(events\.loop\.jsonl não é arquivo regular/);
    const dir2 = base();
    grava(dir2, 'GM-4', 'loop', 'loop.iniciar', {}, 0);
    planoDe(dir2, 'GM-3', ['T1']); // plano real fora da entrega, para o symlink apontar a um arquivo válido
    symlinkSync(join(dir2, '.harness/entregas/GM-3/plano.json'), join(dir2, '.harness/entregas/GM-4/plano.json'));
    const av2 = avisosDe(doctor.run(dir2), 'aprendizado-sem-destino').filter((a) => a.includes('GM-4'));
    assert.equal(av2.length, 1, av2.join('\n'));
    assert.match(av2[0], /GM-4\/plano\.json inválido \(não é arquivo regular\)/);
  });

  // Cópia do núcleo + doctor com `loop.PAPEIS` sem `correcao`: o mesmo que acontece quando um papel sai de PAPEIS num release.
  const doctorSemPapel = () => {
    const gates = join(dirname(SCRIPT), '..');
    const plug = mkdtempSync(join(tmpdir(), 'doctor-sem-papel-'));
    for (const d of ['scripts', 'lib', 'dist']) cpSync(join(gates, d), join(plug, d), { recursive: true });
    copyFileSync(join(gates, 'package.json'), join(plug, 'package.json'));
    const formas = join(plug, 'dist', 'formas.js');
    const src = readFileSync(formas, 'utf8');
    const novo = src.replace("['implementador', 'revisor', 'correcao']", "['implementador', 'revisor']");
    assert.notEqual(novo, src, 'a cópia tem de perder o papel `correcao` (a lista de PAPEIS mudou de forma?)');
    writeFileSync(formas, novo);
    return join(plug, 'scripts', 'harness-doctor.mjs');
  };
  const rodaCopia = (script, dir) => {
    const r = spawnSync(process.execPath, [script, '--json'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status === 0 || r.status === 1, true, r.stderr);
    return JSON.parse(r.stdout);
  };

  test('aprendizado-sem-destino-papel-removido-costura-real: D gravado por diario.append com papel que existia; doctor real sem esse papel em PAPEIS ⇒ aviso com o comando', () => {
    const dir = base();
    grava(dir, 'GM-1', 'loop', 'loop.iniciar', {}, 0);
    grava(dir, 'GM-1', 'loop', 'aprendizado', { tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra: 'confira o build', entra_em: ['brief:correcao'] }, 1);
    // controle: com os PAPEIS de hoje o papel existe e nada avisa
    assert.deepEqual(avisosDe(doctor.run(dir), 'aprendizado-sem-destino'), []);
    const out = rodaCopia(doctorSemPapel(), dir);
    const c = out.resultados.find((r) => r.id === 'aprendizado-sem-destino');
    const av = out.avisos.filter((a) => a.startsWith('aprendizado-sem-destino: '));
    assert.equal(c.found, false, 'o D com papel removido não some calado: "nada sem destino" seria mentira');
    assert.equal(c.level, 'warn');
    assert.equal(av.length, 1, av.join('\n'));
    assert.match(av[0], /GM-1\/loop:2 entra em brief:correcao, papel que não existe mais \(papéis: implementador, revisor\)/);
    assert.match(av[0], /loop\.mjs aprendizado E D --regra <texto> --entra-em <destinos válidos> --substitui GM-1\/loop:2/);
    // o doctor não muda o nível por causa do aviso
    assert.equal(out.alcancado, doctor.run(dir).alcancado);
  });

  test('aprendizado-sem-destino-papel-removido-comando-do-aviso-fecha: o `--substitui` do texto do aviso, rodado pelo loop.mjs real, é aceito e o doctor fica calado', () => {
    for (const semPrefixo of [false, true]) {
      const dir = base();
      planoDe(dir, 'GM-1', ['T1']);
      grava(dir, 'GM-1', 'loop', 'loop.iniciar', {}, 0);
      const loopReal = join(dirname(SCRIPT), 'loop.mjs');
      const roda = (loopMjs, args) => spawnSync(process.execPath, [loopMjs, 'aprendizado', 'E', 'D', '--entrega', 'GM-1', '--regra', 'confira o build', '--eventos', 'loop:1', ...args], { cwd: dir, encoding: 'utf8', timeout: 30000 });
      const grav = roda(loopReal, ['--entra-em', 'brief:correcao']);
      assert.equal(grav.status, 0, grav.stdout + grav.stderr);
      const copia = doctorSemPapel();
      const antes = rodaCopia(copia, dir);
      assert.equal(antes.resultados.find((r) => r.id === 'aprendizado-sem-destino').found, false);
      const aviso = antes.avisos.find((a) => a.startsWith('aprendizado-sem-destino: '));
      const ref = /--substitui (\S+)/.exec(aviso)?.[1];
      assert.equal(ref, 'GM-1/loop:2', aviso);
      const fecha = roda(join(dirname(copia), 'loop.mjs'), ['--entra-em', 'brief:revisor', '--substitui', semPrefixo ? ref.replace(/^GM-1\//, '') : ref]);
      assert.equal(fecha.status, 0, `o comando do aviso foi recusado: ${fecha.stdout}${fecha.stderr}`);
      const depois = rodaCopia(copia, dir);
      const c = depois.resultados.find((r) => r.id === 'aprendizado-sem-destino');
      assert.equal(c.found, true, `${c.evidence}`);
      assert.match(c.evidence, /nada sem destino/);
      assert.deepEqual(depois.avisos.filter((a) => a.startsWith('aprendizado-sem-destino: ')), []);
    }
  });

  test('aprendizado-sem-destino-fifo-nao-trava-loop-nem-cartao: FIFO em outra entrega não pendura loop.mjs aprendizados nem o hook do cartão', () => {
    const aqui = join(dirname(SCRIPT));
    const dir = repoComGit({ 'AGENTS.md': agents(1), 'harness.config.json': JSON.stringify({ fluxo: { resolvidoEm: '2026-11-10' } }) });
    grava(dir, 'GM-6', 'loop', 'loop.iniciar', {}, 0);
    mkdirSync(join(dir, '.harness/entregas/GM-7'), { recursive: true });
    execFileSync('mkfifo', [join(dir, '.harness/entregas/GM-7/events.s1.jsonl')]);
    const env = { ...process.env, GABARITO_INSTALLED_PLUGINS: '/nao/existe.json' };
    const loop = spawnSync(process.execPath, [join(aqui, 'loop.mjs'), 'aprendizados'], { cwd: dir, encoding: 'utf8', timeout: 4000, env });
    assert.equal(loop.error, undefined, `loop.mjs travou na FIFO: ${loop.error?.message}`);
    assert.match(JSON.parse(loop.stdout).avisos.join('\n'), /GM-7 ilegível \(events\.s1\.jsonl não é arquivo regular/);
    execFileSync('git', ['checkout', '-q', '-b', 'feat/GM-6-x'], { cwd: dir });
    const plug = mkdtempSync(join(tmpdir(), 'plug-cartao-'));
    mkdirSync(join(plug, '.claude-plugin'));
    writeFileSync(join(plug, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'gabarito-mestre', version: '1.1.0' }));
    const cartao = spawnSync(process.execPath, [join(aqui, 'cartao-sessao.mjs'), '--hook', '--root', dir, '--plugin-root', plug, '--agora', '2026-11-10T12:00:00Z'], { cwd: dir, input: JSON.stringify({ session_id: 's1' }), encoding: 'utf8', timeout: 8000, env });
    assert.equal(cartao.error, undefined, `cartão travou na FIFO: ${cartao.error?.message}`);
    assert.equal(cartao.status, 0, cartao.stderr);
    assert.match(cartao.stdout, /Aprendizados: 1 entrega\(s\) ilegível\(is\)/, 'a entrega com FIFO vira aviso no cartão, nunca "0" calado');
  });
});

// ────────────────────────────────────────────────────────────── FX3 (GM-13): o doctor não manda colar comando

/** Comando para o usuário colar: script do gate, flag de config ou `node `. Nenhum fix/label/evidência de item que não passou pode ter. */
const COMANDO_PARA_COLAR = /capacidade\.mjs|onboarding-config\.mjs|--set|node |\.mjs/;
const semClaude = (cmd, args, opts) => (cmd === 'claude' ? { rc: 0, stdout: 'No MCP servers configured.\n', stderr: '', motivo: null } : rodarReal(cmd, args, opts));

/** Onboarding REAL (detectar → perguntas no default → gravar, sem `claude` de verdade) num repo de teste e doctor --json pela borda.
 *  `recalibrar` = o item `trocar orquestracao` depois do ok do dono (`_recalibrar: true`). */
function onboardingNoRepo(dir, { recalibrar = false, hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const fatos = coletarFatos(dir, { rodar: semClaude, hoje });
  const itens = detectar(fatos);
  const resp = { _previa: JSON.parse(JSON.stringify(itens)), ...(recalibrar ? { _recalibrar: true } : {}) };
  for (const p of perguntas(itens, fatos.configExistente)) resp[p.id] = p.default;
  const arqResp = join(mkdtempSync(join(tmpdir(), 'fx3-resp-')), 'respostas.json');
  writeFileSync(arqResp, JSON.stringify(resp));
  const g = gravar(dir, arqResp, { rodar: semClaude, hoje, fuso: 'UTC' });
  assert.equal(g.ok, true, JSON.stringify(g));
  return doctorDe(dir);
}
const doctorDe = (dir) => {
  const out = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' }).stdout);
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(join(dir, 'harness.config.json'), 'utf8')); } catch { /* config ausente ou torta: o doctor é que avisa */ }
  return { dir, out, cfg };
};
const onboardingEDoctor = (arquivos = {}, opts) => onboardingNoRepo(repoComGit({ 'AGENTS.md': agents(0), 'package.json': '{"name":"x"}', ...arquivos }), opts);
const textos = (r) => [r.label, r.fix, r.evidence].filter((t) => typeof t === 'string');

describe('FX3 doctor — nenhum comando para colar depois do onboarding', () => {
  test('doctor-fix-sem-comando: varredura estática de TODOS os checks (fix e label)', () => {
    const sujos = doctor.CHECKS.filter((c) => textos(c).some((t) => COMANDO_PARA_COLAR.test(t))).map((c) => c.id);
    assert.deepEqual(sujos, [], 'fix/label cita script ou flag para colar');
    // a regex pega o padrão antigo (caso plantado)
    assert.ok(COMANDO_PARA_COLAR.test('rode capacidade.mjs --sugerir e grave orquestracao.paralelismo via onboarding-config.mjs'));
    assert.ok(COMANDO_PARA_COLAR.test('rode node scripts/build.mjs'));
  });

  test('doctor-par1-cita-trocar-orquestracao: o fix do PAR-1 manda para gabarito-instalar (trocar orquestracao)', () => {
    const c = doctor.CHECKS.find((x) => x.id === 'paralelismo-calibrado');
    assert.match(c.fix, /gabarito-instalar \(trocar orquestracao\)/);
    assert.match(c.label, /paralelismo calibrado nesta máquina/);
  });

  test('doctor-pos-onboarding-sem-comando (P9): onboarding real ⇒ doctor --json sem comando em item que falta/avisa, e o PAR-1 passa', () => {
    const { out, cfg } = onboardingEDoctor();
    const pendentes = out.resultados.filter((r) => !r.found);
    assert.ok(pendentes.length > 0, 'premissa: ainda há itens que faltam');
    for (const r of pendentes) for (const t of textos(r)) assert.doesNotMatch(t, COMANDO_PARA_COLAR, `${r.id}: ${t}`);
    const par = out.resultados.find((r) => r.id === 'paralelismo-calibrado');
    assert.equal(par.found, true, JSON.stringify(par));
    assert.match(par.evidence, new RegExp(`calibrado ${new Date().toISOString().slice(0, 10)}`));
    assert.equal(cfg.orquestracao.paralelismo.calibradoEm, new Date().toISOString().slice(0, 10));
    assert.ok(cfg.orquestracao.paralelismo.simultaneos >= 1 && cfg.orquestracao.paralelismo.teto >= cfg.orquestracao.paralelismo.simultaneos);
  });

  test('doctor-trocar-orquestracao-renova (P9): gravar comum NUNCA recalibra (o doctor segue avisando); `trocar orquestracao` (com `_recalibrar`) recalibra e o PAR-1 passa', () => {
    const limites = { loadPorCoreMax: 0.8, memDisponivelMinMB: 8192, discoLivreMinGB: 20 };
    const velho = { orquestracao: { paralelismo: { simultaneos: 1, teto: 2, limites, calibradoEm: '2020-01-01' } } };
    const comum = onboardingEDoctor({ 'harness.config.json': JSON.stringify(velho) });
    assert.deepEqual(comum.cfg.orquestracao.paralelismo, velho.orquestracao.paralelismo, 'onboarding repetido não toca nos valores nem nos limites do dono');
    assert.equal(comum.out.resultados.find((r) => r.id === 'paralelismo-calibrado').found, false, 'o doctor segue avisando');
    const troca = onboardingNoRepo(comum.dir, { recalibrar: true });
    assert.equal(troca.out.resultados.find((r) => r.id === 'paralelismo-calibrado').found, true);
    assert.notEqual(troca.cfg.orquestracao.paralelismo.calibradoEm, '2020-01-01');
    assert.notDeepEqual(troca.cfg.orquestracao.paralelismo.limites, limites, 'o item explícito recalibra também os limites (a prévia mostrou)');
    const aMao = { orquestracao: { paralelismo: { simultaneos: 7, teto: 9 } } };
    const m = onboardingEDoctor({ 'harness.config.json': JSON.stringify(aMao) });
    assert.deepEqual([m.cfg.orquestracao.paralelismo.simultaneos, m.cfg.orquestracao.paralelismo.teto], [7, 9], 'valor do dono nunca é sobrescrito por gravar comum');
    assert.equal(m.cfg.orquestracao.paralelismo.calibradoEm, undefined, 'sem medição não há data');
  });

  test('doctor-par1-laco-fecha (P9): em TODO estado que o PAR-1 reprova, seguir o fix do doctor (`trocar orquestracao` real) faz o PAR-1 passar', () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const estados = {
      ausente: {},
      vencido: { simultaneos: 1, teto: 2, calibradoEm: '2020-01-01' },
      invalido: { simultaneos: 1, teto: 2, calibradoEm: 'ontem' },
      futuro: { simultaneos: 1, teto: 2, calibradoEm: '2099-01-01' },
      'teto<simultaneos (em dia)': { simultaneos: 5, teto: 4, calibradoEm: hoje },
      'a mão sem data': { simultaneos: 7, teto: 9 },
      'sem simultaneos': { teto: 4, calibradoEm: hoje },
    };
    const fixDoDoctor = doctor.CHECKS.find((c) => c.id === 'paralelismo-calibrado').fix;
    assert.match(fixDoDoctor, /gabarito-instalar \(trocar orquestracao\)/);
    for (const [nome, par] of Object.entries(estados)) {
      const dir = repoComGit({ 'AGENTS.md': agents(0), 'package.json': '{"name":"x"}', ...(nome === 'ausente' ? {} : { 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: par } }) }) });
      const antes = doctorDe(dir).out.resultados.find((r) => r.id === 'paralelismo-calibrado');
      // data no futuro: o PAR-1 do doctor a aceita hoje (só mede `> 180 d`); o onboarding é que não a trata como calibração. Segue passando depois.
      assert.equal(antes.found, nome === 'futuro', `${nome}: premissa do estado`);
      const trocou = onboardingNoRepo(dir, { recalibrar: true });
      const par1 = trocou.out.resultados.find((r) => r.id === 'paralelismo-calibrado');
      assert.equal(par1.found, true, `${nome}: o fix do doctor não fecha o PAR-1: ${par1.evidence}`);
      assert.equal(trocou.cfg.orquestracao.paralelismo.calibradoEm, hoje, nome);
    }
  });

  test('doctor-avisos-dinamicos-sem-comando: o texto que o doctor REAL imprime (evidência/aviso de cada check de aviso, em estados que os produzem) não manda colar comando', () => {
    // única exceção declarada: o comando de fechamento do aprendizado é do orquestrador (loop.mjs), exigido pelo REQ-APR-4 e fixado pelos testes do T13.
    const EXCECAO_APRENDIZADO = /^aprendizado-sem-destino: .*\bloop\.mjs aprendizado\b/;
    const velho = '2020-01-01';
    const estados = [
      { 'harness.config.json': JSON.stringify({ orquestracao: { modelo: { alias: 'opus', resolvidoEm: velho, validadeDias: 90 }, modelos: { implementador: 'haiku', revisor: 'desconhecido', fantasma: 'opus' }, perfil: 'nao-existe' } }) },
      { 'harness.config.json': JSON.stringify({ orquestracao: { modelo: { resolvidoEm: 'x' }, modelos: 'torto' } }) },
      { 'harness.config.json': JSON.stringify({ orquestracao: 'torto', onboarding: { naoDetectado: ['versionamento', 'orquestracao', 'tipo_repo'] }, versionamento: { branchPadrao: 'main' } }) },
      { 'harness.config.json': JSON.stringify({ onboarding: { naoDetectado: 'x' }, versionamento: { resolvidoEm: velho } }) },
      { 'harness.config.json': JSON.stringify({ orquestracao: { modelo: {} }, onboarding: null }) },
      { 'harness.config.json': '{ torto' },
      { 'harness.config.json': JSON.stringify({ guarda: { ambientes: {} } }) },
    ];
    let vistos = 0;
    const varre = (out, rotulo) => {
      for (const r of out.resultados.filter((x) => x.level === 'warn' && !x.found)) {
        for (const t of [r.evidence, r.fix, r.label].filter((x) => typeof x === 'string')) {
          if (COMANDO_PARA_COLAR.test(t)) assert.match(`${r.id}: ${t}`, EXCECAO_APRENDIZADO, `${rotulo}: ${r.id}: ${t}`);
          vistos += 1;
        }
      }
      for (const a of out.avisos) {
        if (COMANDO_PARA_COLAR.test(a)) assert.match(a, EXCECAO_APRENDIZADO, `${rotulo}: aviso: ${a}`);
        vistos += 1;
      }
    };
    estados.forEach((arquivos, i) => varre(doctorDe(repoComGit({ 'AGENTS.md': agents(1), ...arquivos })).out, `estado ${i}`));
    // aprendizado: pendência real (a exceção), diário ilegível e plano ilegível (sem comando); sem dist/ do núcleo (sem comando)
    const dir = repoComGit({ 'AGENTS.md': agents(1) });
    arq(dir, '.harness/entregas/GM-9/plano.json', '{ torto');
    arq(dir, '.harness/entregas/GM-8/events.s1.jsonl', '{ torto\n');
    const o = doctorDe(dir).out;
    assert.ok(o.avisos.some((a) => a.startsWith('aprendizado-sem-destino: ')), 'premissa: o estado produz aviso de aprendizado');
    varre(o, 'aprendizado ilegível');
    assert.ok(vistos > 10, `a varredura viu poucos textos (${vistos})`);
    // o planejamento da exceção: o comando do aprendizado EXISTE no aviso de pendência real (senão a exceção seria letra morta)
    assert.match('aprendizado-sem-destino: feche com: loop.mjs aprendizado nada', EXCECAO_APRENDIZADO);
    assert.doesNotMatch('modelo-resolvido: rode node x.mjs', EXCECAO_APRENDIZADO);
  });
});

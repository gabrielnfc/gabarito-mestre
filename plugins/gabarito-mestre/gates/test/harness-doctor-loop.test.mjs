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
import { symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

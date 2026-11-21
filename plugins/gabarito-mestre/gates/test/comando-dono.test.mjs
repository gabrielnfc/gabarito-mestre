/**
 * GM-15 T7 (REQ-ENT-1 c, REQ-ENT-2; regra transversal "comando humano"; condição 1): `reabrir-entrega`, `adiar`, `cortar` e `reabrir` só pelo comando do dono.
 * Skill com `disable-model-invocation: true` + hook `UserPromptExpansion` (`comando-dono.mjs`) que grava ANTES do texto; as funções de gravação ficam FORA de `ESPEC`.
 * Cada caso sobe um repositório git descartável e roda o adaptador real com o stdin do TUI (forma medida no spike A1, 2.1.318).
 *
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append` ou entrada falsa neste script gravam um evento válido; o núcleo não distingue.
 * MUTAÇÕES: M7a o CLI gravando `entrega.reaberta`; M7b skill sem `disable-model-invocation`; M7c função de gravação do dono dentro de `ESPEC`; M7d hook sem `onFailure: block`.
 *
 * GM-18 T2 (REQ-ENC-2, REQ-ENC-3): `encerrar` e o `<entrega>` opcional de `cortar`/`adiar`/`reabrir`. O `gh` nunca é o real: um `gh` falso em `mkdtemp`, no PATH do subprocesso.
 * MUTAÇÕES M2*: M2a gravação dentro de ESPEC ⇒ cli-nao-grava-encerrada-dono · M2b skill sem disable-model-invocation ⇒ skills-do-dono-sem-invocacao-do-modelo ·
 * M2c hook sem onFailure block ⇒ comandos-do-dono-onfailure-block (hooks-json.test.mjs) · M2d sem a recusa já-encerrada ⇒ encerrar-ja-encerrada-automatica ·
 * M2e criar a pasta da entrega inexistente ⇒ encerrar-recusas · M2f gh falho gravando com o relógio ⇒ encerrar-gh-falha-nao-grava · M2g aceitar PR aberto ⇒ encerrar-recusas ·
 * M2h via head em vez de dono ⇒ encerrar-so-pelo-hook · M2i gravar sem simular ⇒ encerrar-recusas (caso simulação sem efeito).
 * MUTAÇÕES M3*: M3a ignorar a entrega do argumento ⇒ cortar-com-entrega-de-outra-branch · M3b exigir a entrega ⇒ sem-entrega-usa-a-branch · M3c validar a task contra o plano da branch ⇒
 * entrega-argumento-recusas · M3d criar a pasta pedida ⇒ entrega-argumento-recusas · M3e aceitar entrega em minúsculas ⇒ entrega-argumento-forma · M3f `cortar GM-11 T8` lido como task GM-11 ⇒ entrega-argumento-forma.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, chmodSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { entregaPublicada, SESSAO_QUALQUER } from '../dist/guarda.js';
import { ESPEC_DO_CLI } from '../scripts/loop.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GATES = join(AQUI, '..');
const PLUGIN = join(GATES, '..');
const HOOK = join(GATES, 'scripts', 'comando-dono.mjs');
const LOOP = join(GATES, 'scripts', 'loop.mjs');
const PAINEL = join(GATES, 'scripts', 'painel.mjs');
const PREFIXO = 'gabarito-mestre:';
const COMANDOS = ['reabrir-entrega', 'adiar', 'cortar', 'reabrir', 'encerrar'];

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const PLANO = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }, { id: 'T2', deps: ['T1'], arquivos: ['b.ts'] }, { id: 'T3', deps: [], arquivos: ['c.ts'] }] };
const MERGE = '2030-01-01T00:00:00.000Z'; // fixa: o `ts` da reabertura (agora real) é posterior

// Relógio real, estritamente crescente: o hook grava com `new Date()` (subprocesso, depois do último semeado).
let relogio = 0;
const agora = () => (relogio = Math.max(Date.now(), relogio + 1));

function repo({ plano = PLANO, semear = [] } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cmd-dono-')));
  git(dir, 'init', '-q', '-b', 'enabler/GM-10-teste');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  writeFileSync(join(entregas, 'plano.json'), JSON.stringify(plano));
  const amb = {
    dir,
    entregas,
    semear(lista, sessao = 'loop') {
      for (const [tipo, dados] of lista) {
        const r = diario.append(entregas, sessao, { ts: new Date(agora()).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    eventos: () => diario.ler(entregas),
    bytes: () => Object.fromEntries(readdirSync(entregas).sort().map((n) => [n, readFileSync(join(entregas, n), 'utf8')])),
    publicada: () => entregaPublicada(dir, 'GM-10', SESSAO_QUALQUER),
  };
  amb.semear(semear);
  return amb;
}
const ENCERRADA = [['entrega.encerrada', { entrega: 'GM-10', pr: 5, via: 'head', mergeado_em: MERGE }]];

const stdinTui = (dir, comando, args, extra = {}) => ({
  session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: `${PREFIXO}${comando}`, command_args: args, command_source: 'plugin', ...extra,
});
function hook(entrada, { cwd, env } = {}) {
  const input = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', cwd, ...(env === undefined ? {} : { env: { ...process.env, ...env } }) });
  let j = null;
  try { j = r.stdout.trim() === '' ? null : JSON.parse(r.stdout); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
}
const loop = (dir, ...args) => {
  const r = spawnSync(process.execPath, [LOOP, ...args], { cwd: dir, encoding: 'utf8' });
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};
function bloqueou(r, causa) {
  assert.equal(r.rc, 0, `hook sai 0: ${r.err}`);
  assert.equal(r.j?.decision, 'block', `block esperado: ${r.out}`);
  assert.match(String(r.j.reason), causa);
}
const doTipo = (amb, tipo) => amb.eventos().filter((e) => e.tipo === tipo);

test('reabrir-entrega-so-pelo-hook: o comando grava entrega.reaberta, entregaPublicada volta a false e o painel não diz "entregue"', () => {
  const amb = repo({ semear: ENCERRADA });
  assert.equal(amb.publicada(), true, 'encerrada antes do comando');
  assert.equal(loop(amb.dir, 'iniciar', 'T1', 'implementador').j?.erro, 'entrega_publicada', 'o loop recusa na entrega encerrada');
  const r = hook(stdinTui(amb.dir, 'reabrir-entrega', 'GM-10'));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.match(String(r.j?.systemMessage), /GM-10/);
  const ev = doTipo(amb, 'entrega.reaberta');
  assert.equal(ev.length, 1);
  assert.deepEqual(Object.keys(ev[0].dados).sort(), ['em', 'entrega']);
  assert.equal(ev[0].dados.entrega, 'GM-10');
  assert.equal(ev[0].dados.em, ev[0].ts, '`em` é o instante da gravação');
  assert.equal(ev[0].sessao, 'S-dono');
  assert.equal(amb.publicada(), false, 'a leitura de entregaPublicada, depois do comando, volta a false');
  assert.notEqual(loop(amb.dir, 'iniciar', 'T1', 'implementador').j?.erro, 'entrega_publicada', 'o loop volta a aceitar a entrega');
  const p = spawnSync(process.execPath, [PAINEL, 'texto', '--entrega', 'GM-10'], { cwd: amb.dir, encoding: 'utf8' });
  assert.doesNotMatch(p.stdout, /entregue/i, `painel: ${p.stdout}`);
});

test('reabrir-entrega recusa o que não está encerrado, ID ruim e diário ilegível: block com a causa e 0 bytes novos', () => {
  const sem = repo();
  const antes = sem.bytes();
  bloqueou(hook(stdinTui(sem.dir, 'reabrir-entrega', 'GM-10')), /entrega_nao_encerrada/);
  assert.deepEqual(sem.bytes(), antes);
  const enc = repo({ semear: ENCERRADA });
  const b = enc.bytes();
  for (const ruim of ['', ' GM-10', 'GM-10 ', '../GM-10', 'GM-10; rm', 'GM 10', 'x'.repeat(200)]) bloqueou(hook(stdinTui(enc.dir, 'reabrir-entrega', ruim)), /inválido|invalido/);
  bloqueou(hook(stdinTui(enc.dir, 'reabrir-entrega', 'GM-99')), /./); // entrega sem diário
  assert.deepEqual(enc.bytes(), b);
  assert.equal(enc.publicada(), true);
  // reabrir duas vezes: a 2ª não está mais encerrada
  assert.notEqual(hook(stdinTui(enc.dir, 'reabrir-entrega', 'GM-10')).j?.decision, 'block');
  bloqueou(hook(stdinTui(enc.dir, 'reabrir-entrega', 'GM-10')), /entrega_nao_encerrada/);
  assert.equal(doTipo(enc, 'entrega.reaberta').length, 1);
});

test('cli-nao-grava-entrega-reaberta: nenhum subcomando do loop.mjs, com nenhuma flag, grava entrega.reaberta (nem reabrir-entrega existe)', () => {
  const amb = repo({ semear: [...ENCERRADA, ['task.fora', { task: 'T3', como: 'adiada', motivo: 'm', origem: 'dono' }]] });
  // a entrega encerrada recusa a maioria; o que importa é que, em nenhum caso, o evento aparece. Roda cada subcomando com cada flag do ESPEC.
  for (const [nome, spec] of Object.entries(ESPEC_DO_CLI)) {
    const flags = spec.flags.flatMap((f) => [`--${f}`, f === 'entrega' ? 'GM-10' : f === 'origem' ? 'sombra' : 'T1']);
    const pos = spec.pos > 0 ? ['T1', 'T2'].slice(0, spec.pos) : [];
    loop(amb.dir, nome, ...pos, ...flags);
    loop(amb.dir, nome, ...pos, '--entrega', 'GM-10');
  }
  for (const nome of ['reabrir-entrega', 'reabrir_entrega', 'reaberta']) {
    const r = loop(amb.dir, nome, 'GM-10');
    assert.notEqual(r.rc, 0, nome);
  }
  assert.equal(doTipo(amb, 'entrega.reaberta').length, 0, 'nenhum caminho do CLI gravou entrega.reaberta');
  assert.equal(amb.publicada(), true);
  // o mesmo, numa entrega aberta (onde `reabrir` etc. gravam de fato)
  const aberta = repo({ semear: [['task.fora', { task: 'T3', como: 'adiada', motivo: 'm', origem: 'dono' }]] });
  for (const [nome, spec] of Object.entries(ESPEC_DO_CLI)) {
    const pos = spec.pos > 0 ? ['T3', 'T2'].slice(0, spec.pos) : [];
    loop(aberta.dir, nome, ...pos, '--motivo', 'm', '--sessao', 'x');
  }
  assert.equal(doTipo(aberta, 'entrega.reaberta').length, 0);
  // e pelos caminhos que de fato gravam `task.reaberta` (retomada e liberar): task reprovada reaberta, sem entrega.reaberta junto
  const IMPL = [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }]];
  const retomada = repo({ semear: IMPL });
  const r = loop(retomada.dir, 'reabrir', 'T1');
  assert.equal(r.rc, 0, r.out);
  assert.equal(doTipo(retomada, 'task.reaberta').length, 1, 'o reabrir de retomada gravou a task.reaberta');
  assert.equal(doTipo(retomada, 'entrega.reaberta').length, 0, 'e só ela');
});

test('skills-do-dono-sem-invocacao-do-modelo: toda skill de comando do dono (derivada do hooks.json) tem disable-model-invocation: true', () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const nomes = cfg.UserPromptExpansion.map((g) => /^\^gabarito-mestre:([a-z-]+)\$$/.exec(g.matcher)?.[1]);
  assert.ok(nomes.every((n) => typeof n === 'string'), `matcher fora do molde: ${JSON.stringify(cfg.UserPromptExpansion.map((g) => g.matcher))}`);
  for (const n of COMANDOS) assert.ok(nomes.includes(n), `${n} sem hook`);
  for (const n of nomes) {
    const texto = readFileSync(join(PLUGIN, 'skills', n, 'SKILL.md'), 'utf8');
    const cab = /^---\n([\s\S]*?)\n---/.exec(texto)?.[1] ?? '';
    assert.match(cab, new RegExp(`^name: ${n}$`, 'm'), `${n}: name`);
    assert.match(cab, /^disable-model-invocation: true$/m, `${n}: sem disable-model-invocation: true`);
  }
});

test('gravacao-do-dono-fora-de-espec: nenhum subcomando do ESPEC é comando do dono, e o CLI não alcança a função de gravação', () => {
  for (const n of [...COMANDOS.filter((c) => c !== 'adiar' && c !== 'cortar' && c !== 'reabrir'), 'reabrirEntrega', 'encerrarEntrega', 'foraDono', 'reabrirDono', 'liberarTeto', 'reabrir-dono', 'fora-dono']) {
    assert.equal(Object.hasOwn(ESPEC_DO_CLI, n), false, `${n} no ESPEC`);
  }
  // adiar/cortar/reabrir existem no ESPEC (caminho da Sombra/retomada) mas `--origem dono` é uso, rc 2, nada gravado (T6): o CLI não grava dono
  const amb = repo();
  const antes = amb.bytes();
  for (const sub of ['adiar', 'cortar']) assert.equal(loop(amb.dir, sub, 'T3', '--motivo', 'm', '--origem', 'dono', '--fonte', 'x').rc, 2, sub);
  assert.equal(loop(amb.dir, 'reabrir', 'T3', '--origem', 'dono', '--fonte', 'x').rc, 2);
  assert.deepEqual(amb.bytes(), antes);
  // nenhum flag do ESPEC aceita um valor que faça o CLI gravar entrega.reaberta: a função vive só no módulo do hook
  assert.equal(Object.values(ESPEC_DO_CLI).some((e) => e.flags.includes('em')), false);
});

test('adiar-dono-pelo-hook: o comando grava task.fora {adiada, origem dono, motivo}, relida, e a task sai do despacho', () => {
  const amb = repo();
  const r = hook(stdinTui(amb.dir, 'adiar', 'T3 fica para a próxima: depende de decisão'));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.match(String(r.j?.systemMessage), /T3/);
  const ev = doTipo(amb, 'task.fora');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].dados, { task: 'T3', como: 'adiada', motivo: 'fica para a próxima: depende de decisão', origem: 'dono' });
  assert.equal(ev[0].sessao, 'S-dono');
  const itens = loop(amb.dir, 'proxima', '--vivos', '0').j?.acao?.itens ?? [];
  assert.equal(itens.some((i) => i.task === 'T3'), false, 'a adiada não é despachada');
  assert.equal(itens.some((i) => i.task === 'T1'), true);
});

test('cortar-dono-com-dependente-recusa: T1 tem T2 pendente; o hook recusa com a lista e 0 bytes; sem dependente ativo, corta', () => {
  const amb = repo();
  const antes = amb.bytes();
  const r = hook(stdinTui(amb.dir, 'cortar', 'T1 não vale mais'));
  bloqueou(r, /T2/);
  assert.deepEqual(amb.bytes(), antes, 'nada gravado');
  assert.equal(doTipo(amb, 'task.fora').length, 0);
  // com o dependente fora, corta
  assert.notEqual(hook(stdinTui(amb.dir, 'cortar', 'T2 sai junto')).j?.decision, 'block');
  const ok = hook(stdinTui(amb.dir, 'cortar', 'T1 não vale mais'));
  assert.notEqual(ok.j?.decision, 'block', ok.out);
  assert.deepEqual(doTipo(amb, 'task.fora').map((e) => [e.dados.task, e.dados.como, e.dados.origem]), [['T2', 'cortada', 'dono'], ['T1', 'cortada', 'dono']]);
});

test('reabrir-dono-pelo-hook: devolve a task de adiada a pendente com fonte "comando do dono"; task que não está fora recusa', () => {
  const amb = repo({ plano: { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }] }, semear: [['task.fora', { task: 'T1', como: 'adiada', motivo: 'm', origem: 'dono' }]] });
  assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j?.acao?.tipo === 'despachar', false, 'adiada: nada a despachar');
  const r = hook(stdinTui(amb.dir, 'reabrir', 'T1'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  const ev = doTipo(amb, 'task.reaberta');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].dados, { task: 'T1', origem: 'dono', fonte: 'comando do dono', de: 'fora' });
  assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j?.acao?.itens?.some((i) => i.task === 'T1'), true, 'volta ao despacho');
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir, 'reabrir', 'T1')), /./); // já está pendente
  assert.deepEqual(amb.bytes(), antes);
});

test('hook-sem-argumento-bloqueia: cada comando, sem argumento ou com argumento fora da forma, sai block e 0 bytes; subagent e stdin ruim também', () => {
  const amb = repo({ semear: ENCERRADA });
  const antes = amb.bytes();
  for (const c of COMANDOS) {
    for (const args of ['', ' ', undefined, null, 42, 'T1 T2 T3\n', '../x', 'T1;rm', 'x'.repeat(3000)]) {
      const e = stdinTui(amb.dir, c, args);
      if (args === undefined) delete e.command_args;
      bloqueou(hook(e), /./);
    }
  }
  for (const c of ['adiar', 'cortar']) bloqueou(hook(stdinTui(amb.dir, c, 'T1')), /uso/); // sem motivo
  assert.deepEqual(amb.bytes(), antes);
  // agent_id (subagent): block, mesmo com argumento válido
  for (const [c, a] of [['reabrir-entrega', 'GM-10'], ['adiar', 'T1 m'], ['cortar', 'T3 m'], ['reabrir', 'T1'], ['encerrar', 'GM-10 5'], ['cortar', 'GM-10 T3 m']]) {
    bloqueou(hook(stdinTui(amb.dir, c, a, { agent_id: 'ag-1' })), /subagent/);
  }
  assert.deepEqual(amb.bytes(), antes);
  // stdin ausente, não JSON, não objeto: block; outro comando: silêncio total
  for (const ruim of ['', 'não é json', '[]', 'null']) bloqueou(hook(ruim), /./);
  for (const outro of ['gabarito-mestre:liberar', 'gabarito-mestre:emenda', 'outro:reabrir', 'reabrir', 'gabarito-mestre:reabrirX']) {
    const r = hook(stdinTui(amb.dir, 'x', 'T1', { command_name: outro }));
    assert.equal(r.rc, 0);
    assert.equal(r.out, '', outro);
    assert.equal(r.err, '');
  }
  assert.deepEqual(amb.bytes(), antes);
});

test('hook fora de repositório: block com a causa; nada criado', () => {
  const fora = realpathSync(mkdtempSync(join(tmpdir(), 'cmd-dono-fora-')));
  for (const [c, a] of [['reabrir-entrega', 'GM-10'], ['adiar', 'T1 m'], ['cortar', 'T1 m'], ['reabrir', 'T1'], ['encerrar', 'GM-10 5']]) bloqueou(hook(stdinTui(fora, c, a)), /./);
  assert.deepEqual(readdirSync(fora), []);
});

test('reabrir-entrega com relógio do diário à frente: a reabertura cairia ANTES do encerramento; o hook relê, não afirma e diz a causa', () => {
  const amb = repo();
  const futuro = new Date(Date.now() + 3 * 86400000).toISOString();
  const r0 = diario.append(amb.entregas, 'loop', { ts: futuro, autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo: 'entrega.encerrada', dados: { entrega: 'GM-10', pr: 5, via: 'head', mergeado_em: MERGE } });
  assert.ok(r0.ok, JSON.stringify(r0));
  const r = hook(stdinTui(amb.dir, 'reabrir-entrega', 'GM-10'));
  bloqueou(r, /reabertura_sem_efeito/);
  assert.equal(amb.publicada(), true);
});

// ───────────────────────────── GM-18 T2: `encerrar` (REQ-ENC-2) e `<entrega>` opcional (REQ-ENC-3)

const MERGED_AT = '2026-11-11T16:27:14Z';
const HASH = 'a'.repeat(64);
const SEMENTE = [['sombra.consulta', { pergunta_hash: HASH, req: 'REQ-X-1' }]];
const limpar = [];

/** `gh` falso (nunca o real): grava o argv em `args.log` e responde pelo `modo`. Devolve `{env, log, chamadas()}`. */
function ghFalso(modo = 'merged', { mergedAt = MERGED_AT } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gh-falso-')));
  const log = join(dir, 'args.log');
  const corpo = {
    merged: `printf '{"mergedAt":"${mergedAt}","number":%s,"state":"MERGED"}\\n' "$3"`,
    open: `printf '{"mergedAt":null,"number":%s,"state":"OPEN"}\\n' "$3"`,
    openComData: `printf '{"mergedAt":"${mergedAt}","number":%s,"state":"OPEN"}\\n' "$3"`,
    closed: `printf '{"mergedAt":null,"number":%s,"state":"CLOSED"}\\n' "$3"`,
    mergedSemData: `printf '{"mergedAt":null,"number":%s,"state":"MERGED"}\\n' "$3"`,
    outroNumero: `printf '{"mergedAt":"${mergedAt}","number":999,"state":"MERGED"}\\n'`,
    rc1: 'echo "sem login" >&2; exit 1',
    json: 'echo "isto nao e json"',
    lista: 'echo "[]"',
    dorme: 'exec sleep 30',
  }[modo];
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n${corpo}\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  limpar.push(dir);
  return { env: { PATH: `${dir}:${process.env.PATH}` }, log, chamadas: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) };
}
/** PATH só com o `git` (symlink): o `gh` não existe. */
function semGh() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sem-gh-')));
  const gitReal = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  symlinkSync(gitReal, join(dir, 'git'));
  limpar.push(dir);
  return { env: { PATH: dir }, chamadas: () => [] };
}

/** Pasta de outra entrega no mesmo repositório (plano + diário semeado). */
function pasta(amb, id, plano, semear = SEMENTE) {
  const entregas = join(amb.dir, '.harness', 'entregas', id);
  mkdirSync(entregas, { recursive: true });
  if (plano !== null) writeFileSync(join(entregas, 'plano.json'), JSON.stringify(plano));
  const p = {
    entregas,
    semear(lista, sessao = 'loop', ts) {
      for (const [tipo, dados] of lista) {
        const r = diario.append(entregas, sessao, { ts: ts ?? new Date(agora()).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    eventos: () => diario.ler(entregas),
    publicada: () => entregaPublicada(amb.dir, id, SESSAO_QUALQUER),
  };
  p.semear(semear);
  return p;
}
const planoDe = (id, ...tasks) => ({ entrega: id, tasks: tasks.map((t) => ({ id: t, deps: [], arquivos: [`${t}.ts`] })) });
/** Repositório com a branch da GM-10 (T1, T2, T3), `user.email` definido e as demais entregas pedidas. */
function amb18() {
  const amb = repo();
  git(amb.dir, 'config', 'user.email', 'dono@teste.local');
  git(amb.dir, 'config', 'user.name', 'dono');
  return amb;
}
/** Todos os arquivos e pastas do diário do repositório (conteúdo dos arquivos): 0 bytes novos e nenhuma pasta nascida. */
function todos(dir) {
  const raiz = join(dir, '.harness', 'entregas');
  if (!existsSync(raiz)) return {};
  const o = {};
  for (const rel of readdirSync(raiz, { recursive: true }).map(String).sort()) {
    const abs = join(raiz, rel);
    o[rel] = statSync(abs).isDirectory() ? '<pasta>' : readFileSync(abs, 'utf8');
  }
  return o;
}
const encerrar = (amb, args, gh = ghFalso(), extra = {}) => hook(stdinTui(amb.dir, 'encerrar', args, extra), { env: gh.env });
const encerradas = (p) => p.eventos().filter((e) => e.tipo === 'entrega.encerrada');
import { encerramentoDe } from '../dist/trilha.js';

test('encerrar-so-pelo-hook: grava entrega.encerrada via dono com o mergedAt do gh, lida campo a campo; entregaPublicada e o painel passam a "entregue" com a versão', () => {
  const amb = amb18();
  const g13 = pasta(amb, 'GM-13', planoDe('GM-13', 'T1', 'T2'));
  assert.equal(g13.publicada(), false);
  const gh = ghFalso();
  const r = encerrar(amb, 'GM-13 16 2.0.0', gh);
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.match(String(r.j?.systemMessage), /GM-13.*PR #16.*2\.0\.0/);
  assert.deepEqual(gh.chamadas(), ['pr view 16 --json number,state,mergedAt'], 'o gh é chamado 1 vez, só leitura, com a forma combinada');
  const ev = encerradas(g13);
  assert.equal(ev.length, 1);
  assert.deepEqual(Object.keys(ev[0].dados).sort(), ['entrega', 'mergeado_em', 'pr', 'versao', 'via']);
  assert.equal(ev[0].dados.entrega, 'GM-13');
  assert.equal(ev[0].dados.pr, 16);
  assert.equal(ev[0].dados.via, 'dono');
  assert.equal(ev[0].dados.mergeado_em, MERGED_AT, 'mergeado_em é o do gh, não o relógio');
  assert.equal(ev[0].dados.versao, '2.0.0');
  assert.equal(ev[0].agente, 'orquestrador');
  assert.equal(ev[0].autor, 'dono@teste.local');
  assert.equal(ev[0].sessao, 'S-dono');
  assert.notEqual(ev[0].ts, MERGED_AT);
  assert.equal(g13.publicada(), true);
  const enc = encerramentoDe(g13.eventos(), 'GM-13');
  assert.equal(enc.encerrada, true);
  assert.equal(enc.primeira.via, 'dono');
  const p = spawnSync(process.execPath, [PAINEL, 'estado', '--entrega', 'GM-13'], { cwd: amb.dir, encoding: 'utf8' });
  assert.equal(JSON.parse(p.stdout).estado.entregue.versao, '2.0.0', p.stdout.slice(0, 300));
  // sem versão e com "#": o campo `versao` não existe; autor padrão e sessão padrão
  const g14 = pasta(amb, 'GM-14', planoDe('GM-14', 'T1'));
  const r2 = hook({ cwd: amb.dir, hook_event_name: 'UserPromptExpansion', command_name: `${PREFIXO}encerrar`, command_args: 'GM-14 #26', command_source: 'plugin' }, { env: ghFalso().env });
  assert.notEqual(r2.j?.decision, 'block', r2.out);
  const e2 = encerradas(g14)[0];
  assert.deepEqual(Object.keys(e2.dados).sort(), ['entrega', 'mergeado_em', 'pr', 'via']);
  assert.equal(e2.dados.pr, 26);
  assert.equal(e2.sessao, 'dono');
  assert.equal(g14.eventos().filter((e) => e.tipo === 'entrega.encerrada').length, 1);
});

test('encerrar-recusas: cada causa dá block com o erro certo, 0 bytes novos em todos os diários e a pasta inexistente não nasce; o gh só é chamado depois das recusas de forma, pasta, diário e já-encerrada', () => {
  const amb = amb18();
  pasta(amb, 'GM-13', planoDe('GM-13', 'T1'));
  mkdirSync(join(amb.dir, '.harness', 'entregas', 'GM-20'), { recursive: true }); // pasta sem diário
  writeFileSync(join(amb.dir, '.harness', 'entregas', 'GM-20', 'plano.json'), JSON.stringify(planoDe('GM-20', 'T1')));
  mkdirSync(join(amb.dir, '.harness', 'entregas', 'GM-21'), { recursive: true }); // diário corrompido
  writeFileSync(join(amb.dir, '.harness', 'entregas', 'GM-21', 'events.x.jsonl'), '{isto não é json\n');
  const velho = pasta(amb, 'GM-22', null, [['entrega.encerrada', { entrega: 'GM-22', pr: 7, via: 'dono', mergeado_em: MERGED_AT }]]);
  void velho;
  const semGhChamado = (args, erro, msg) => {
    const gh = ghFalso();
    const antes = todos(amb.dir);
    const r = encerrar(amb, args, gh);
    bloqueou(r, erro);
    if (msg !== undefined) assert.match(r.j.reason, msg);
    assert.deepEqual(todos(amb.dir), antes, `${args}: 0 bytes novos`);
    assert.deepEqual(gh.chamadas(), [], `${args}: o gh não foi chamado`);
    return r.j.reason;
  };
  semGhChamado('GM-99 16', /entrega_inexistente/);
  assert.equal(existsSync(join(amb.dir, '.harness', 'entregas', 'GM-99')), false, 'a pasta da entrega inexistente não nasce');
  const semDiario = semGhChamado('GM-20 16', /diario_invalido/, /pasta sem diário/);
  const corrompido = semGhChamado('GM-21 16', /diario_invalido/, /diário corrompido/);
  assert.notEqual(semDiario, corrompido);
  semGhChamado('GM-22 16', /entrega_ja_encerrada/);
  // com o gh: PR aberto, fechado sem merge e "MERGED" sem data ⇒ pr_nao_mergeado; 0 bytes
  for (const modo of ['open', 'openComData', 'closed', 'mergedSemData']) {
    const gh = ghFalso(modo);
    const antes = todos(amb.dir);
    bloqueou(encerrar(amb, 'GM-13 16', gh), /pr_nao_mergeado/);
    assert.deepEqual(todos(amb.dir), antes, modo);
    assert.equal(gh.chamadas().length, 1, modo);
  }
  // simulação sem efeito: só uma entrega.reaberta de outra sessão com ts à frente do relógio; o candidato cai antes dela e não vale
  const fut = pasta(amb, 'GM-23', planoDe('GM-23', 'T1'), []);
  fut.semear([['entrega.reaberta', { entrega: 'GM-23', em: '2030-01-01T00:00:00.000Z' }]], 'loop', '2030-01-01T00:00:00.000Z');
  const antes = todos(amb.dir);
  const gh = ghFalso();
  bloqueou(encerrar(amb, 'GM-23 16', gh), /encerramento_sem_efeito/);
  assert.deepEqual(todos(amb.dir), antes, 'a simulação recusa antes de gravar: 0 bytes');
  assert.equal(gh.chamadas().length, 1);
  assert.equal(encerradas(fut).length, 0);
});

test('encerrar-forma-do-argumento: vazio, espaço a mais, só a entrega, PR 0, versão com v, entrega em minúsculas, argumento a mais, caminho e metacaractere dão block com o uso e 0 bytes', () => {
  const amb = amb18();
  pasta(amb, 'GM-13', planoDe('GM-13', 'T1'));
  const antes = todos(amb.dir);
  const gh = ghFalso();
  for (const ruim of ['', ' ', ' GM-13 16', 'GM-13  16', 'GM-13 16 ', 'GM-13', 'GM-13 0', 'GM-13 #0', 'GM-13 16 v2.0.0', 'gm-13 16', 'GM-13 16 2.0.0 x', '../GM-13 16', 'GM-13 16;rm', 'GM-13 1234567890', 'GM-13 ##16', 'GM-13 16 2.0', 'GM-13 -1']) {
    bloqueou(encerrar(amb, ruim, gh), /inválido \(uso: \/gabarito-mestre:encerrar <entrega> <PR> \[<versão>\]\)/);
  }
  assert.deepEqual(todos(amb.dir), antes);
  assert.deepEqual(gh.chamadas(), []);
  // formas válidas passam da forma (pré-versão semver inclusa)
  assert.notEqual(encerrar(amb, 'GM-13 #16 2.0.0-rc.1').j?.decision, 'block');
});

test('encerrar-gh-falha-nao-grava: gh ausente, rc 1, timeout, JSON ruim, forma errada e número trocado dão block pr_nao_conferido, mensagens distintas e 0 bytes', () => {
  const amb = amb18();
  pasta(amb, 'GM-13', planoDe('GM-13', 'T1'));
  const casos = [
    ['ausente', semGh(), /não encontrado/],
    ['rc1', ghFalso('rc1'), /rc 1.*sem login/],
    ['json', ghFalso('json'), /não é JSON/],
    ['lista', ghFalso('lista'), /fora da forma/],
    ['outroNumero', ghFalso('outroNumero'), /fora da forma/],
    ['dorme', ghFalso('dorme'), /expirou/],
  ];
  const msgs = new Set();
  for (const [nome, gh, re] of casos) {
    const antes = todos(amb.dir);
    const t0 = Date.now();
    const r = encerrar(amb, 'GM-13 16', gh);
    bloqueou(r, /pr_nao_conferido/);
    assert.match(r.j.reason, re, nome);
    assert.deepEqual(todos(amb.dir), antes, `${nome}: 0 bytes`);
    if (nome === 'dorme') assert.ok(Date.now() - t0 < 9500, 'o timeout do gh (5 s) vem antes do do hook (10 s)');
    msgs.add(r.j.reason.replace(/\s+/g, ' '));
  }
  assert.equal(msgs.size, 5, 'ausente, rc, timeout, JSON e forma têm mensagens distintas (lista e outro número dividem a da forma)');
});

test('encerrar-reabrir-encerrar: encerrar, reabrir-entrega e encerrar de novo com o mesmo PR valem (via dono); o diário fica com 2 encerradas e 1 reaberta', () => {
  const amb = amb18();
  const g13 = pasta(amb, 'GM-13', planoDe('GM-13', 'T1'));
  assert.notEqual(encerrar(amb, 'GM-13 16').j?.decision, 'block');
  assert.equal(g13.publicada(), true);
  const r = hook(stdinTui(amb.dir, 'reabrir-entrega', 'GM-13'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.equal(g13.publicada(), false);
  const de = encerrar(amb, 'GM-13 16');
  assert.notEqual(de.j?.decision, 'block', de.out);
  const enc = encerramentoDe(g13.eventos(), 'GM-13');
  assert.equal(enc.encerrada, true);
  assert.equal(enc.primeira.via, 'dono');
  assert.equal(enc.primeira.pr, 16);
  assert.equal(g13.eventos().filter((e) => e.tipo === 'entrega.encerrada').length, 2);
  assert.equal(g13.eventos().filter((e) => e.tipo === 'entrega.reaberta').length, 1);
  assert.equal(g13.publicada(), true);
});

test('encerrar-ja-encerrada-automatica: encerrada via head vigente recusa entrega_ja_encerrada citando o PR e o via, manda reabrir, 0 bytes e sem gh', () => {
  const amb = amb18();
  pasta(amb, 'GM-15', planoDe('GM-15', 'T1'), [['entrega.encerrada', { entrega: 'GM-15', pr: 26, via: 'head', mergeado_em: MERGED_AT }]]);
  const antes = todos(amb.dir);
  const gh = ghFalso();
  const r = encerrar(amb, 'GM-15 30 2.1.0', gh);
  bloqueou(r, /entrega_ja_encerrada/);
  assert.match(r.j.reason, /PR #26/);
  assert.match(r.j.reason, /head/);
  assert.match(r.j.reason, /\/gabarito-mestre:reabrir-entrega/);
  assert.deepEqual(todos(amb.dir), antes);
  assert.deepEqual(gh.chamadas(), []);
});

test('cli-nao-grava-encerrada-dono: nenhum subcomando do ESPEC, com nenhuma flag, grava entrega.encerrada via dono (nem encerrar existe no CLI)', () => {
  const amb = amb18();
  pasta(amb, 'GM-15', planoDe('GM-15', 'T1'), [['entrega.encerrada', { entrega: 'GM-15', pr: 26, via: 'head', mergeado_em: MERGED_AT }]]);
  const todosEventos = () => ['GM-10', 'GM-15'].flatMap((id) => diario.ler(join(amb.dir, '.harness', 'entregas', id)));
  const doDono = () => todosEventos().filter((e) => e.tipo === 'entrega.encerrada' && e.dados?.via === 'dono');
  assert.equal(Object.hasOwn(ESPEC_DO_CLI, 'encerrar'), false);
  for (const entrega of ['GM-10', 'GM-15']) {
    for (const [nome, spec] of Object.entries(ESPEC_DO_CLI)) {
      const flags = spec.flags.flatMap((f) => [`--${f}`, f === 'entrega' ? entrega : f === 'origem' ? 'dono' : f === 'via' ? 'dono' : f === 'pr' ? '5' : 'T1']);
      const pos = spec.pos > 0 ? ['T1', 'T2'].slice(0, spec.pos) : [];
      loop(amb.dir, nome, ...pos, ...flags);
      loop(amb.dir, nome, ...pos, '--entrega', entrega);
    }
  }
  for (const nome of ['encerrar', 'encerrar-entrega', 'encerrar_entrega', 'encerrada']) {
    for (const extra of [['GM-10', '5'], ['GM-10', '--pr', '5', '--via', 'dono']]) assert.notEqual(loop(amb.dir, nome, ...extra).rc, 0, nome);
  }
  assert.deepEqual(doDono(), [], 'nenhum caminho do CLI gravou entrega.encerrada via dono');
});

// ── REQ-ENC-3: `<entrega>` opcional

/** Repositório na branch da GM-10 (T1, T2, T3) com a GM-11 (T8, T9) ao lado. */
function amb18Duas() {
  const amb = amb18();
  const g11 = pasta(amb, 'GM-11', planoDe('GM-11', 'T8', 'T9'));
  return { amb, g11 };
}
const doTipoDe = (p, tipo) => p.eventos().filter((e) => e.tipo === tipo);

test('cortar-com-entrega-de-outra-branch: `cortar GM-11 T8 motivo` grava task.fora cortada origem dono no diário da GM-11 e 0 bytes no da GM-10', () => {
  const { amb, g11 } = amb18Duas();
  const antes10 = amb.bytes();
  const r = hook(stdinTui(amb.dir, 'cortar', 'GM-11 T8 saiu do recorte'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.match(String(r.j?.systemMessage), /T8.*cortada.*GM-11/);
  const ev = doTipoDe(g11, 'task.fora');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].dados, { task: 'T8', como: 'cortada', motivo: 'saiu do recorte', origem: 'dono' });
  assert.deepEqual(amb.bytes(), antes10, '0 bytes no diário da GM-10');
});

test('adiar-com-entrega: `adiar GM-11 T8 motivo` grava task.fora adiada no diário da GM-11 e 0 bytes no da GM-10', () => {
  const { amb, g11 } = amb18Duas();
  const antes10 = amb.bytes();
  const r = hook(stdinTui(amb.dir, 'adiar', 'GM-11 T9 fica para depois'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.match(String(r.j?.systemMessage), /T9.*adiada.*GM-11/);
  assert.deepEqual(doTipoDe(g11, 'task.fora').map((e) => e.dados), [{ task: 'T9', como: 'adiada', motivo: 'fica para depois', origem: 'dono' }]);
  assert.deepEqual(amb.bytes(), antes10);
});

test('reabrir-com-entrega: `reabrir GM-11 T8`, da branch da GM-10, grava task.reaberta origem dono na GM-11 e a T8 volta a pendente; 0 bytes na GM-10', () => {
  const { amb, g11 } = amb18Duas();
  g11.semear([['task.fora', { task: 'T8', como: 'cortada', motivo: 'm', origem: 'dono' }]]);
  const antes10 = amb.bytes();
  const r = hook(stdinTui(amb.dir, 'reabrir', 'GM-11 T8'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.match(String(r.j?.systemMessage), /T8.*GM-11/);
  const ev = doTipoDe(g11, 'task.reaberta');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].dados, { task: 'T8', origem: 'dono', fonte: 'comando do dono', de: 'fora' });
  const itens = loop(amb.dir, 'proxima', '--vivos', '0', '--entrega', 'GM-11').j?.acao?.itens ?? [];
  assert.equal(itens.some((i) => i.task === 'T8'), true, 'T8 em pendente: volta ao despacho');
  assert.deepEqual(amb.bytes(), antes10);
});

test('sem-entrega-usa-a-branch: os 3 comandos sem o token gravam na entrega da branch (GM-10), nada na GM-11', () => {
  const { amb, g11 } = amb18Duas();
  const antes11 = todos(amb.dir);
  delete antes11['GM-10']; // só interessa a GM-11
  const so11 = () => Object.fromEntries(Object.entries(todos(amb.dir)).filter(([k]) => k.startsWith('GM-11')));
  const base11 = so11();
  assert.notEqual(hook(stdinTui(amb.dir, 'adiar', 'T3 depois')).j?.decision, 'block');
  assert.notEqual(hook(stdinTui(amb.dir, 'reabrir', 'T3')).j?.decision, 'block');
  assert.notEqual(hook(stdinTui(amb.dir, 'cortar', 'T3 de vez')).j?.decision, 'block');
  assert.deepEqual(amb.eventos().filter((e) => e.tipo.startsWith('task.')).map((e) => [e.tipo, e.dados.task, e.dados.como ?? null]), [['task.fora', 'T3', 'adiada'], ['task.reaberta', 'T3', null], ['task.fora', 'T3', 'cortada']]);
  assert.deepEqual(so11(), base11, 'a GM-11 não mudou');
  assert.equal(doTipoDe(g11, 'task.fora').length, 0);
});

test('entrega-argumento-recusas: entrega inexistente (pasta não nasce), publicada, sem plano e task só do plano da branch dão a recusa certa e 0 bytes', () => {
  const { amb } = amb18Duas();
  pasta(amb, 'GM-12', planoDe('GM-12', 'T8'), [['entrega.encerrada', { entrega: 'GM-12', pr: 3, via: 'head', mergeado_em: MERGED_AT }]]);
  pasta(amb, 'GM-14', null); // pasta com diário e sem plano
  const casos = [
    ['cortar', 'GM-99 T8 m', /entrega_inexistente/],
    ['cortar', 'GM-12 T8 m', /entrega_publicada/],
    ['adiar', 'GM-12 T8 m', /entrega_publicada/],
    ['reabrir', 'GM-12 T8', /entrega_publicada/],
    ['cortar', 'GM-14 T8 m', /plano_ausente/],
    ['cortar', 'GM-11 T1 m', /task_fora_do_plano/], // T1 só existe no plano da branch (GM-10)
    ['adiar', 'GM-11 T1 m', /task_fora_do_plano/],
    ['reabrir', 'GM-11 T1', /task_fora_do_plano/],
  ];
  for (const [c, a, re] of casos) {
    const antes = todos(amb.dir);
    bloqueou(hook(stdinTui(amb.dir, c, a)), re);
    assert.deepEqual(todos(amb.dir), antes, `${c} ${a}: 0 bytes e nenhuma pasta nova`);
  }
  assert.equal(existsSync(join(amb.dir, '.harness', 'entregas', 'GM-99')), false);
});

test('entrega-argumento-forma: os casos fixados da spec (entrega no 1º token só se casa ENTREGA_RE; o resto como hoje ou block de uso, 0 bytes)', () => {
  const { amb, g11 } = amb18Duas();
  const uso = /inválido \(uso: /;
  const bytes0 = (fn) => { const a = todos(amb.dir); fn(); assert.deepEqual(todos(amb.dir), a, '0 bytes'); };
  // com entrega e sem motivo; só a entrega: block de uso
  bytes0(() => bloqueou(hook(stdinTui(amb.dir, 'cortar', 'GM-11 T8')), uso));
  bytes0(() => bloqueou(hook(stdinTui(amb.dir, 'adiar', 'GM-11 T8')), uso));
  bytes0(() => bloqueou(hook(stdinTui(amb.dir, 'cortar', 'GM-11')), uso));
  bytes0(() => bloqueou(hook(stdinTui(amb.dir, 'reabrir', 'GM-11')), uso));
  bytes0(() => bloqueou(hook(stdinTui(amb.dir, 'reabrir', 'T1 x')), uso));
  // minúsculas não casam ENTREGA_RE: vale a forma de hoje (task `gm-11`, motivo "T8 m"), que recusa pela task
  bytes0(() => bloqueou(hook(stdinTui(amb.dir, 'cortar', 'gm-11 T8 m')), /task_fora_do_plano.*gm-11/));
  // com entrega, motivo com espaços: a entrega certa, a task T8, o motivo inteiro
  assert.notEqual(hook(stdinTui(amb.dir, 'cortar', 'GM-11 T8 caiu de vez')).j?.decision, 'block');
  assert.deepEqual(doTipoDe(g11, 'task.fora').map((e) => [e.dados.task, e.dados.motivo]), [['T8', 'caiu de vez']]);
  // `cortar T3 caiu de vez`: como hoje, entrega da branch
  assert.notEqual(hook(stdinTui(amb.dir, 'cortar', 'T3 caiu de vez')).j?.decision, 'block');
  assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.fora').map((e) => [e.dados.task, e.dados.motivo]), [['T3', 'caiu de vez']]);
  assert.equal(doTipoDe(g11, 'task.fora').length, 1, 'e nada a mais na GM-11');
  // `reabrir GM-11 T8` (cortada acima): reabre na GM-11; `reabrir T3` como hoje
  assert.notEqual(hook(stdinTui(amb.dir, 'reabrir', 'GM-11 T8')).j?.decision, 'block');
  assert.equal(doTipoDe(g11, 'task.reaberta').length, 1);
  assert.notEqual(hook(stdinTui(amb.dir, 'reabrir', 'T3')).j?.decision, 'block');
  assert.equal(amb.eventos().filter((e) => e.tipo === 'task.reaberta').length, 1);
});

test('aceite-gm18-encerrar: GM-13 (plano, diário sem task) e GM-14 (tasks e PR de pré-versão) abertas no projeto; encerrar as dá como feitas com a versão; cortar recusa; reabrir-entrega reabre; encerrar de novo com o mesmo PR vale', () => {
  const amb = amb18();
  const g13 = pasta(amb, 'GM-13', planoDe('GM-13', 'T1', 'T2'));
  const g14 = pasta(amb, 'GM-14', planoDe('GM-14', 'T1', 'T2'), [
    ['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
    ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }], ['task.integrada', { task: 'T1' }],
    ['fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero: 22, estado: 'mergeado', branch: 'next', base: 'main', via: 'titulo', pre_versao: '2.1.0-alpha.1' } }],
  ]);
  const estado = (extra = []) => {
    const r = spawnSync(process.execPath, [PAINEL, 'estado', ...extra], { cwd: amb.dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout.slice(0, 300) + r.stderr.slice(0, 300));
    return JSON.parse(r.stdout).estado;
  };
  const linha = (id) => estado().projeto.linhas.find((l) => l.id === id);
  assert.equal(linha('GM-13').feito, false, 'antes: GM-13 aberta no projeto');
  assert.equal(linha('GM-14').feito, false, 'antes: GM-14 aberta no projeto');
  assert.equal(g14.publicada(), false);
  const gh = ghFalso();
  assert.notEqual(encerrar(amb, 'GM-13 16 2.0.0', gh).j?.decision, 'block');
  assert.notEqual(encerrar(amb, 'GM-14 #26 2.1.0', gh).j?.decision, 'block');
  assert.equal(linha('GM-13').feito, true);
  assert.equal(linha('GM-14').feito, true);
  assert.equal(estado(['--entrega', 'GM-13']).entregue.versao, '2.0.0');
  assert.equal(estado(['--entrega', 'GM-14']).entregue.versao, '2.1.0');
  for (const c of ['cortar', 'adiar']) bloqueou(hook(stdinTui(amb.dir, c, 'GM-13 T1 m')), /entrega_publicada/);
  bloqueou(hook(stdinTui(amb.dir, 'reabrir', 'GM-13 T1')), /entrega_publicada/);
  // reabrir a GM-14: volta a aberta; o 2º encerrar com o mesmo PR (sem versão) a deixa feita de novo
  assert.notEqual(hook(stdinTui(amb.dir, 'reabrir-entrega', 'GM-14')).j?.decision, 'block');
  assert.equal(linha('GM-14').feito, false, 'a reaberta volta a aberta');
  assert.equal(linha('GM-13').feito, true, 'a outra segue feita');
  assert.notEqual(encerrar(amb, 'GM-14 26', gh).j?.decision, 'block');
  assert.equal(linha('GM-14').feito, true, 'o 2º encerrar a deixa feita de novo');
  assert.equal(estado(['--entrega', 'GM-14']).entregue.versao, null);
  assert.equal(encerradas(g13).length, 1);
  assert.equal(encerradas(g14).length, 2);
});

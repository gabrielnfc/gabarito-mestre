/**
 * GM-15 T7 (REQ-ENT-1 c, REQ-ENT-2; regra transversal "comando humano"; condição 1): `reabrir-entrega`, `adiar`, `cortar` e `reabrir` só pelo comando do dono.
 * Skill com `disable-model-invocation: true` + hook `UserPromptExpansion` (`comando-dono.mjs`) que grava ANTES do texto; as funções de gravação ficam FORA de `ESPEC`.
 * Cada caso sobe um repositório git descartável e roda o adaptador real com o stdin do TUI (forma medida no spike A1, 2.1.318).
 *
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append` ou entrada falsa neste script gravam um evento válido; o núcleo não distingue.
 * MUTAÇÕES: M7a o CLI gravando `entrega.reaberta`; M7b skill sem `disable-model-invocation`; M7c função de gravação do dono dentro de `ESPEC`; M7d hook sem `onFailure: block`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
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
const COMANDOS = ['reabrir-entrega', 'adiar', 'cortar', 'reabrir'];

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
function hook(entrada, { cwd } = {}) {
  const input = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', cwd });
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
  for (const n of [...COMANDOS.filter((c) => c !== 'adiar' && c !== 'cortar' && c !== 'reabrir'), 'reabrirEntrega', 'foraDono', 'reabrirDono', 'liberarTeto', 'reabrir-dono', 'fora-dono']) {
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
  for (const [c, a] of [['reabrir-entrega', 'GM-10'], ['adiar', 'T1 m'], ['cortar', 'T3 m'], ['reabrir', 'T1']]) {
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
  for (const [c, a] of [['reabrir-entrega', 'GM-10'], ['adiar', 'T1 m'], ['cortar', 'T1 m'], ['reabrir', 'T1']]) bloqueou(hook(stdinTui(fora, c, a)), /./);
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

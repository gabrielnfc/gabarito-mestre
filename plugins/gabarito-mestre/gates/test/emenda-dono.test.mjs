/**
 * REQ-EME-1 (spec r2, GM-11 T10): o julgamento do dono é só do humano, por `/gabarito-mestre:emenda aprovar|rejeitar <seq>`.
 * Skill com `disable-model-invocation: true` + hook `UserPromptExpansion` (`emenda-dono.mjs`) que grava `spec.emendada` ou `emenda.rejeitada`
 * com `origem:"dono"`. Mesmo desenho de `liberar-teto.mjs` (liberar-teto.test.mjs): cada caso sobe um repositório git descartável e roda o
 * adaptador real com o stdin do TUI.
 *
 * Limite declarado (Q14, como `liberar`): sob o mesmo usuário de SO, `node -e` com `diario.append`, `claude -p` aninhado ou JSON falso
 * gravam um evento válido; o núcleo não distingue. O que se testa: nenhum caminho comum grava com `origem:"dono"`.
 *
 * MUTAÇÕES PRESCRITAS: task-10-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GATES = join(AQUI, '..');
const PLUGIN = join(GATES, '..');
const HOOK = join(GATES, 'scripts', 'emenda-dono.mjs');
const LOOP = join(GATES, 'scripts', 'loop.mjs');
const COMANDO = 'gabarito-mestre:emenda';

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const PLANO = {
  entrega: 'GM-10',
  tasks: [
    { id: 'T1', deps: [], arquivos: ['a.ts'], reqs: ['REQ-A-1'] },
    { id: 'T2', deps: [], arquivos: ['b.ts'], reqs: ['REQ-B-1'] },
  ],
};
const PROPOSTA = (req = 'REQ-A-1') => ({ req, diff: '+ regra nova', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio' });

let relogio = Date.UTC(2026, 0, 1);
const agora = () => (relogio += 1000);

/** Repo descartável na branch da entrega, com plano e diário semeado pelo núcleo (nunca à mão). */
function repo({ plano = PLANO, semear = [], branch = 'enabler/GM-10-teste', init = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'emenda-dono-')));
  if (init) {
    git(dir, 'init', '-q', '-b', branch);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: base');
  }
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  if (plano !== null) writeFileSync(join(entregas, 'plano.json'), typeof plano === 'string' ? plano : JSON.stringify(plano));
  const amb = {
    dir,
    entregas,
    semear(lista) {
      for (const it of lista) {
        const [sessao, tipo, dados] = it.length === 3 ? it : ['loop', ...it];
        const r = diario.append(entregas, sessao, { ts: new Date(agora()).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    eventos: () => diario.ler(entregas),
    bytes: () => Object.fromEntries(readdirSync(entregas).sort().map((n) => [n, readFileSync(join(entregas, n), 'utf8')])),
  };
  amb.semear(semear);
  return amb;
}

const COM_PROPOSTA = [['emendas', 'emenda.proposta', PROPOSTA()]];

/** stdin do TUI (spike A1): command_name, command_args e command_source; `agent_id` só quando vem de subagent. */
const stdinTui = (dir, extra = {}) => ({
  session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: COMANDO, command_args: 'aprovar 1', command_source: 'plugin', ...extra,
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
const julgamentos = (amb) => amb.eventos().filter((e) => e.tipo === 'spec.emendada' || e.tipo === 'emenda.rejeitada');
function bloqueou(r, causa) {
  assert.equal(r.rc, 0, `hook sai 0: ${r.err}`);
  assert.equal(r.j?.decision, 'block', `block esperado: ${r.out}`);
  assert.match(String(r.j.reason), causa);
}

test('emenda-dono-grava-origem-dono: aprovar grava spec.emendada, relida; a task descongela e o item traz a emenda (costura pelo loop real)', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const antes = loop(amb.dir, 'proxima', '--vivos', '0').j.acao;
  assert.deepEqual(antes.itens.map((i) => i.task), ['T2'], 'antes: T1 congelada pela proposta aberta, só T2 despacha');
  const r = hook(stdinTui(amb.dir));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  const j = julgamentos(amb);
  assert.equal(j.length, 1);
  assert.equal(j[0].tipo, 'spec.emendada');
  assert.deepEqual(j[0].dados, { proposta_seq: 1, origem: 'dono' });
  assert.equal(j[0].sessao, 'S-dono');
  assert.equal(r.j.systemMessage, 'Emenda #1 (REQ-A-1) aprovada pelo dono; entrega GM-10');
  const p = loop(amb.dir, 'proxima', '--vivos', '0').j.acao;
  assert.equal(p.tipo, 'despachar');
  assert.deepEqual(p.itens.find((i) => i.task === 'T1').emendas, [{ proposta_seq: 1, req: 'REQ-A-1', diff: '+ regra nova' }]);
});

test('emenda-dono-rejeitar: grava emenda.rejeitada origem dono; a emenda não chega ao item; sessão padrão `dono` sem session_id válido', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const r = hook(stdinTui(amb.dir, { command_args: 'rejeitar 1', session_id: 'com espaço/ruim' }));
  assert.equal(r.j?.systemMessage, 'Emenda #1 (REQ-A-1) rejeitada pelo dono; entrega GM-10');
  const j = julgamentos(amb);
  assert.deepEqual(j.map((e) => [e.tipo, e.sessao, e.dados]), [['emenda.rejeitada', 'dono', { proposta_seq: 1, origem: 'dono' }]]);
  const item = loop(amb.dir, 'proxima', '--vivos', '0').j.acao.itens.find((i) => i.task === 'T1');
  assert.deepEqual(item.emendas, []);
});

test('emenda-dono-so-a-proposta-pedida: o seq escolhe a proposta', () => {
  const amb = repo({ semear: [['emendas', 'emenda.proposta', PROPOSTA()], ['emendas', 'emenda.proposta', PROPOSTA('REQ-B-1')]] });
  assert.equal(hook(stdinTui(amb.dir, { command_args: 'aprovar 2' })).j?.systemMessage, 'Emenda #2 (REQ-B-1) aprovada pelo dono; entrega GM-10');
  assert.deepEqual(julgamentos(amb).map((e) => e.dados.proposta_seq), [2]);
});

test('emenda-dono-subagent-bloqueia: agent_id presente ⇒ block e 0 bytes novos, mesmo com argumentos válidos', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir, { agent_id: 'agente-1' })), /agent_id/);
  bloqueou(hook(stdinTui(amb.dir, { agent_id: '' })), /agent_id/);
  assert.deepEqual(amb.bytes(), antes);
});

test('emenda-dono-args-invalidos: só `^(aprovar|rejeitar) [1-9][0-9]{0,8}$` passa; sem trim, caixa nem sufixo', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const antes = amb.bytes();
  const ruins = ['', ' ', 'aprovar', 'aprovar 1 ', ' aprovar 1', 'Aprovar 1', 'APROVAR 1', 'aprovar 01', 'aprovar 0', 'aprovar -1', 'aprovar 1.0', 'aprovar 1;x', 'aprovar 1\n', 'aprovar  1',
    'aprovar 1234567890', 'liberar 1', 'aprovar 1 rejeitar 1', 'aprovar\t1', 42, null, ['aprovar 1']];
  for (const args of ruins) {
    const entrada = args === null ? stdinTui(amb.dir, { command_args: null }) : stdinTui(amb.dir, { command_args: args });
    bloqueou(hook(entrada), /Emenda recusada/);
    assert.deepEqual(amb.bytes(), antes, `command_args=${JSON.stringify(args)}`);
  }
  const semArgs = stdinTui(amb.dir);
  delete semArgs.command_args;
  bloqueou(hook(semArgs), /Emenda recusada/);
  // o limite de 9 dígitos é válido na forma: recusa por outra causa (proposta inexistente), nunca pela forma
  bloqueou(hook(stdinTui(amb.dir, { command_args: 'aprovar 123456789' })), /proposta_inexistente/);
  assert.deepEqual(amb.bytes(), antes);
});

test('emenda-dono-stdin-ausente-x-corrompido: ausente, vazio, não JSON e não objeto bloqueiam com causas distintas', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const antes = amb.bytes();
  bloqueou(hook(''), /ausente/);
  bloqueou(hook('   \n'), /ausente/);
  bloqueou(hook('{nao json'), /não é JSON/);
  for (const nao of ['[]', 'null', '42', '"texto"']) bloqueou(hook(nao), /não é um objeto/);
  assert.deepEqual(amb.bytes(), antes);
});

test('emenda-dono-outro-comando-silencio: command_name diferente ⇒ rc 0, sem saída e sem efeito, mesmo com argumentos que seriam inválidos', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const antes = amb.bytes();
  for (const nome of ['gsd-help', 'gabarito-mestre:liberar', 'gabarito-mestre:emenda-tudo', 'emenda', 'x-gabarito-mestre:emenda', '', null]) {
    const r = hook(stdinTui(amb.dir, { command_name: nome, command_args: 'lixo ;' }));
    assert.equal(r.rc, 0);
    assert.equal(r.out, '', `command_name=${JSON.stringify(nome)}: sem saída`);
  }
  assert.deepEqual(amb.bytes(), antes);
});

test('emenda-dono-ja-julgada-bloqueia: proposta julgada pela Sombra ⇒ ja_julgada e nada gravado; proposta inexistente ⇒ proposta_inexistente', () => {
  const amb = repo({ semear: [...COM_PROPOSTA, ['sombra-j', 'spec.emendada', { proposta_seq: 1, origem: 'sombra' }]] });
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir)), /ja_julgada/);
  bloqueou(hook(stdinTui(amb.dir, { command_args: 'rejeitar 1' })), /ja_julgada/);
  bloqueou(hook(stdinTui(amb.dir, { command_args: 'aprovar 2' })), /proposta_inexistente/);
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(julgamentos(amb).filter((e) => e.dados.origem === 'dono').length, 0);
});

test('emenda-dono-sem-plano-bloqueia: plano ausente e plano inválido são causas distintas (C10: comando explícito não vira silêncio)', () => {
  const sem = repo({ plano: null, semear: [] });
  bloqueou(hook(stdinTui(sem.dir)), /plano_ausente/);
  const torto = repo({ plano: '{nao json' });
  bloqueou(hook(stdinTui(torto.dir)), /plano_invalido/);
  const outra = repo({ plano: { ...PLANO, entrega: 'GM-99' } });
  bloqueou(hook(stdinTui(outra.dir)), /plano_invalido/);
  assert.equal(julgamentos(sem).length + julgamentos(torto).length, 0);
});

test('emenda-dono-entrega-nao-inferida e fora de repo: block com a causa', () => {
  const semId = repo({ branch: 'main' });
  bloqueou(hook(stdinTui(semId.dir)), /entrega_nao_inferida/);
  const fora = realpathSync(mkdtempSync(join(tmpdir(), 'emenda-fora-')));
  bloqueou(hook(stdinTui(fora)), /fora_de_repo/);
});

test('emenda-dono-diario-ilegivel-x-fora-de-ordem: causas distintas, nada gravado', () => {
  const ilegivel = repo({ semear: COM_PROPOSTA });
  writeFileSync(join(ilegivel.entregas, 'events.loop.jsonl'), 'lixo\n');
  const antesI = ilegivel.bytes();
  bloqueou(hook(stdinTui(ilegivel.dir)), /diario_ilegivel/);
  assert.deepEqual(ilegivel.bytes(), antesI);
  const torto = repo({ semear: [...COM_PROPOSTA, ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }]] });
  const antesT = torto.bytes();
  bloqueou(hook(stdinTui(torto.dir)), /diario_invalido/);
  assert.deepEqual(torto.bytes(), antesT);
});

test('emenda-dono-corrida-sombra-sem-efeito: julgamento da Sombra que entra entre a conferência e a gravação ⇒ ok:false julgamento_sem_efeito, com o evento gravado dito na mensagem', async () => {
  const { julgarEmendaDono } = await import('../scripts/loop.mjs');
  // a Sombra fecha antes de nós, com o julgamento OPOSTO e com o MESMO: nos dois o evento do dono existe e a proposta não é do dono
  for (const tipoDaSombra of ['emenda.rejeitada', 'spec.emendada']) {
    const amb = repo({ semear: COM_PROPOSTA });
    const sombra = () => amb.semear([['sombra-j', tipoDaSombra, { proposta_seq: 1, origem: 'sombra' }]]);
    const r = julgarEmendaDono(amb.dir, 1, 'aprovar', 'S-dono', { antes: sombra });
    assert.equal(r.ok, false, tipoDaSombra);
    assert.equal(r.erro, 'julgamento_sem_efeito');
    assert.match(r.mensagem, /gravado/);
    assert.match(r.mensagem, new RegExp(`${tipoDaSombra.replace('.', '\\.')}, origem sombra`));
    assert.equal(julgamentos(amb).length, 2, 'os dois eventos existem; só um fecha a proposta');
  }
  const ok = repo({ semear: COM_PROPOSTA });
  const bom = julgarEmendaDono(ok.dir, 1, 'rejeitar', 'S-dono');
  assert.deepEqual(bom, { ok: true, seq: 1, req: 'REQ-A-1', tipo: 'emenda.rejeitada', entrega: 'GM-10' });
});

test('emenda-dono-excecao-vira-block: núcleo que lança não vira sucesso nem silêncio', () => {
  const amb = repo({ semear: COM_PROPOSTA });
  const r = hook(stdinTui(amb.dir, { cwd: join(amb.dir, 'nao', 'existe') }));
  bloqueou(r, /Emenda recusada/);
  assert.equal(julgamentos(amb).length, 0);
});

test('hooks-json-matcher-real: UserPromptExpansion roda emenda-dono.mjs com onFailure block, só para o próprio comando', () => {
  const todos = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.UserPromptExpansion;
  const casa = (matcher, nome) => (matcher === undefined || matcher === '' || matcher === '*' ? true : /^[A-Za-z0-9_|]+$/.test(matcher) ? matcher.split('|').includes(nome) : new RegExp(matcher).test(nome));
  const h = todos.filter((g) => /emenda-dono\.mjs/.test(JSON.stringify(g)));
  assert.equal(h.length, 1);
  assert.equal(todos.filter((g) => casa(g.matcher, COMANDO)).length, 1, 'só um grupo casa a emenda');
  const cmd = h[0].hooks[0];
  assert.equal(cmd.type, 'command');
  assert.match(cmd.command, /gates\/scripts\/emenda-dono\.mjs/);
  assert.equal(cmd.onFailure, 'block');
  assert.ok(Number.isInteger(cmd.timeout) && cmd.timeout > 0);
  assert.equal(typeof h[0].matcher, 'string');
  assert.ok(casa(h[0].matcher, COMANDO));
  for (const alheio of ['gsd-help', 'gabarito-mestre:liberar', 'emenda', 'x-gabarito-mestre:emenda', 'gabarito-mestre:emenda-tudo', '']) {
    assert.ok(!casa(h[0].matcher, alheio), `o matcher ${h[0].matcher} não pode casar ${JSON.stringify(alheio)}`);
  }
  assert.ok(existsSync(join(GATES, 'scripts', 'emenda-dono.mjs')));
});

test('skill-emenda-so-do-dono: disable-model-invocation, argument-hint e texto que manda o CLI dizer o estado', () => {
  const t = readFileSync(join(PLUGIN, 'skills', 'emenda', 'SKILL.md'), 'utf8');
  const cab = /^---\n([\s\S]*?)\n---/.exec(t)?.[1] ?? '';
  assert.match(cab, /^name: emenda$/m);
  assert.match(cab, /^disable-model-invocation: true$/m);
  assert.match(cab, /^argument-hint: aprovar\|rejeitar <seq>$/m);
  assert.match(t, /\/gabarito-mestre:emenda aprovar\|rejeitar <seq>/);
  assert.match(t, /Não afirme que (aprovou|rejeitou|julgou)/);
  assert.match(t, /loop\.mjs" proxima --vivos <n>/);
});

/**
 * REQ-LOOP-2 (spec r12, emenda do dono): a saída do teto de rodadas é só do humano, por `/gabarito-mestre:liberar <task>`.
 * Skill com `disable-model-invocation: true` + hook `UserPromptExpansion` (`liberar-teto.mjs`) que grava `task.reaberta {origem:"dono"}`.
 * Cada caso sobe um repositório git descartável e roda o adaptador real com o stdin do TUI (medido no spike A1, 2.1.318).
 *
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append`, `claude -p` aninhado ou entrada falsa neste script
 * gravam um evento válido. O que se testa: nenhum caminho comum grava, e a liberação aparece ao dono (Stop em `concluir`).
 *
 * MUTAÇÕES PRESCRITAS: task-27-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { jaParou } from '../dist/pouso.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GATES = join(AQUI, '..');
const PLUGIN = join(GATES, '..');
const HOOK = join(GATES, 'scripts', 'liberar-teto.mjs');
const LOOP = join(GATES, 'scripts', 'loop.mjs');
const STOP = join(GATES, 'scripts', 'stop-loop.mjs');
const SEM_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const COMANDO = 'gabarito-mestre:liberar';

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const PLANO = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }] };
const PLANO2 = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }, { id: 'T2', deps: [], arquivos: ['b.ts'] }] };

// Relógio real, estritamente crescente: o hook grava com `new Date()` (subprocesso, bem mais de 1 ms depois do último semeado).
let relogio = 0;
const agora = () => (relogio = Math.max(Date.now(), relogio + 1));

/** Repo descartável na branch da entrega, com plano e diário semeado pelo núcleo (nunca à mão). */
function repo({ plano = PLANO, semear = [], branch = 'enabler/GM-10-teste', init = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'liberar-')));
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
    semear(lista, sessao = 'loop', relogioDe = agora) {
      for (const [tipo, dados] of lista) {
        const r = diario.append(entregas, sessao, { ts: new Date(relogioDe()).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    eventos: () => diario.ler(entregas),
    bytes: () => Object.fromEntries(readdirSync(entregas).sort().map((n) => [n, readFileSync(join(entregas, n), 'utf8')])),
  };
  amb.semear(semear);
  return amb;
}

const IMPL = (t) => [['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: 'a'.repeat(40) }]];
const REPROVA = (t, r) => ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: r, blocker: 0, major: 1 }];
/** pendente → … → no_teto (2 reprovações com achado). */
const ATE_O_TETO = (t) => [...IMPL(t), REPROVA(t, 1), ['task.iniciada', { task: t, papel: 'correcao' }], ['task.concluida', { task: t, sha: 'b'.repeat(40) }], REPROVA(t, 2)];
const APROVA = (t, r) => ['review.veredito', { task: t, veredito: 'APROVADO', rodada: r, blocker: 0, major: 0 }];

/** stdin do TUI (spike A1): command_name, command_args e command_source; `agent_id` só quando vem de subagent. */
const stdinTui = (dir, extra = {}) => ({
  session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: COMANDO, command_args: 'T1', command_source: 'plugin', ...extra,
});

function hook(entrada, { cwd, env = {} } = {}) {
  const input = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', cwd, env: { ...process.env, ...env } });
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
const donos = (amb) => amb.eventos().filter((e) => e.tipo === 'task.reaberta' && e.dados?.origem === 'dono');
function bloqueou(r, causa) {
  assert.equal(r.rc, 0, `hook sai 0: ${r.err}`);
  assert.equal(r.j?.decision, 'block', `block esperado: ${r.out}`);
  assert.match(String(r.j.reason), causa);
}

test('no-teto: o comando digitado grava 1 evento dono, relido, e proxima despacha a task de novo', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  assert.equal(loop(amb.dir, 'proxima').j.acao.tipo, 'parar');
  const r = hook(stdinTui(amb.dir));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  const d = donos(amb);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].dados, { task: 'T1', origem: 'dono' });
  assert.equal(d[0].sessao, 'S-dono');
  const p = loop(amb.dir, 'proxima', '--vivos', '0').j.acao;
  assert.equal(p.tipo, 'despachar');
  assert.deepEqual(p.itens.map((i) => [i.task, i.papel]), [['T1', 'implementador']]);
  assert.match(String(r.j?.systemMessage), /T1/);
});

test('fora-do-teto: pendente, em voo, aprovada e integrada recusam com a causa e 0 bytes novos no diário', () => {
  const casos = {
    pendente: [],
    implementando: [['task.iniciada', { task: 'T1', papel: 'implementador' }]],
    concluida: IMPL('T1'),
    reprovada: [...IMPL('T1'), REPROVA('T1', 1)],
    aprovada: [...IMPL('T1'), APROVA('T1', 1)],
    integrada: [...IMPL('T1'), APROVA('T1', 1), ['task.integrada', { task: 'T1', sha: 'a'.repeat(40) }]],
  };
  for (const [estado, eventos] of Object.entries(casos)) {
    const amb = repo({ semear: eventos });
    const antes = amb.bytes();
    bloqueou(hook(stdinTui(amb.dir)), /nao_esta_no_teto/);
    assert.deepEqual(amb.bytes(), antes, `${estado}: diário intacto`);
  }
});

test('so-a-task-pedida: outra task no teto não libera T1', () => {
  const amb = repo({ plano: PLANO2, semear: ATE_O_TETO('T2') });
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir)), /nao_esta_no_teto/);
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(hook(stdinTui(amb.dir, { command_args: 'T2' })).rc, 0);
  assert.equal(donos(amb).length, 1);
  assert.equal(donos(amb)[0].dados.task, 'T2');
});

test('dado-ruim: task fora do plano, diário corrompido, plano ausente ou inválido, fora de repo ⇒ block com a causa e nada gravado', () => {
  const fora = repo({ semear: ATE_O_TETO('T1') });
  let antes = fora.bytes();
  bloqueou(hook(stdinTui(fora.dir, { command_args: 'T9' })), /task_fora_do_plano/);
  assert.deepEqual(fora.bytes(), antes);

  const torto = repo({ semear: ATE_O_TETO('T1') });
  const arq = join(torto.entregas, readdirSync(torto.entregas).find((n) => n.startsWith('events.')));
  writeFileSync(arq, `${readFileSync(arq, 'utf8')}isto não é json\n`);
  antes = torto.bytes();
  bloqueou(hook(stdinTui(torto.dir)), /diario_ilegivel/);
  assert.deepEqual(torto.bytes(), antes);

  const quebrado = repo({ semear: ATE_O_TETO('T1') });
  quebrado.semear([['task.integrada', { task: 'T1', sha: 'c'.repeat(40) }]]); // fraude: integrar no teto
  antes = quebrado.bytes();
  bloqueou(hook(stdinTui(quebrado.dir)), /diario_invalido|transicao_invalida|diario_ilegivel/);
  assert.deepEqual(quebrado.bytes(), antes);

  const semPlano = repo({ plano: null, semear: [] });
  bloqueou(hook(stdinTui(semPlano.dir)), /plano_ausente/);
  assert.deepEqual(semPlano.bytes(), {});

  const planoRuim = repo({ plano: '{ não é json' });
  bloqueou(hook(stdinTui(planoRuim.dir)), /plano_invalido/);

  const foraDeRepo = realpathSync(mkdtempSync(join(tmpdir(), 'liberar-sem-git-')));
  bloqueou(hook(stdinTui(foraDeRepo), { cwd: foraDeRepo }), /./);
  assert.deepEqual(readdirSync(foraDeRepo), []);
});

test('branch-sem-entrega: não adivinha a entrega, block e nada gravado', () => {
  const amb = repo({ semear: ATE_O_TETO('T1'), branch: 'main' });
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir)), /entrega_nao_inferida/);
  assert.deepEqual(amb.bytes(), antes);
});

test('agent_id: pedido vindo de subagent é recusado, nada gravado', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir, { agent_id: 'a1', agent_type: 'gabarito-mestre:gabarito-implementador' })), /agent|subagent/i);
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(donos(amb).length, 0);
  bloqueou(hook(stdinTui(amb.dir, { agent_id: '' })), /agent|subagent/i); // presença, não valor
  assert.deepEqual(amb.bytes(), antes);
});

test('comando-alheio vindo de subagent: sai 0, calado, sem block (command_name antes de agent_id)', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  const r = hook(stdinTui(amb.dir, { command_name: 'gsd-help', agent_id: 'a1' }));
  assert.equal(r.rc, 0, r.err);
  assert.equal(r.out.trim(), '');
  assert.deepEqual(amb.bytes(), antes);
});

test('comando-alheio: outro command_name sai 0, calado, sem efeito (mesmo no teto)', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  for (const nome of ['gabarito-mestre:gabarito', 'outro:liberar', 'liberar', 'gabarito-mestre:liberar-tudo', '']) {
    const r = hook(stdinTui(amb.dir, { command_name: nome, command_args: '../x' }));
    assert.equal(r.rc, 0, nome);
    assert.equal(r.out, '', `${nome}: sem saída`);
  }
  assert.deepEqual(amb.bytes(), antes);
});

test('args-invalidos: vazio, com espaço, caminho e metacaractere ⇒ block, nada gravado', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  for (const args of ['', ' ', 'T1 T2', ' T1', 'T1 ', '../x', '..', 'T1/../T2', 'T1;ls', '$(id)', 'T1\nT2', 'x'.repeat(40)]) {
    bloqueou(hook(stdinTui(amb.dir, { command_args: args })), /./);
    assert.deepEqual(amb.bytes(), antes, JSON.stringify(args));
  }
  bloqueou(hook(stdinTui(amb.dir, { command_args: undefined })), /./);
  bloqueou(hook(stdinTui(amb.dir, { command_args: 7 })), /./);
  assert.deepEqual(amb.bytes(), antes);
});

test('stdin-ruim: ausente, não JSON ou não objeto ⇒ block (fail-closed), nada gravado', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  for (const entrada of ['', 'não é json', '[]', 'null', '"T1"']) bloqueou(hook(entrada, { cwd: amb.dir }), /stdin|entrada/i);
  assert.deepEqual(amb.bytes(), antes);
});

test('CLI: liberar e liberarTeto não são comandos do loop.mjs (uso, rc 2) e nada é gravado', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  for (const args of [['liberar', 'T1'], ['liberarTeto', 'T1'], ['liberar', 'T1', '--sessao', 'dono'], ['reabrir', 'T1', '--origem', 'dono']]) {
    const r = loop(amb.dir, ...args);
    assert.equal(r.rc, 2, args.join(' '));
    assert.equal(r.j?.erro, 'uso');
    assert.match(r.j.mensagem, /desconhecido/);
  }
  assert.match(loop(amb.dir, 'liberar', 'T1').j.mensagem, /desconhecido ou ausente/, 'recusado pela tabela de argumentos, não por um default alcançável');
  assert.deepEqual(amb.bytes(), antes);
});

test('reabrir-no-teto-continua-no-teto: o modelo não sai do teto pelo CLI', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const r = loop(amb.dir, 'reabrir', 'T1');
  assert.equal(r.rc, 0, r.out);
  assert.equal(amb.eventos().at(-1).dados.origem, 'retomada');
  const p = loop(amb.dir, 'proxima', '--vivos', '0').j.acao;
  assert.equal(p.tipo, 'parar');
  assert.equal(p.motivo, 'teto_rodadas');
  assert.equal(donos(amb).length, 0);
});

test('depois-da-liberacao: veredito atrasado recebe transicao_invalida e nada é gravado (fato 3)', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  assert.equal(hook(stdinTui(amb.dir)).rc, 0);
  const antes = amb.bytes();
  const r = loop(amb.dir, 'veredito', 'T1', 'APROVADO', '3', '0', '0');
  assert.equal(r.j?.erro, 'transicao_invalida');
  assert.deepEqual(amb.bytes(), antes);
});

test('liberar-reprovar-duas-vezes: novo teto, nova liberação vale, e o loop.parar do segundo teto é regravável (jaParou)', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  amb.semear([['loop.parar', { motivo: 'teto_rodadas' }]]);
  assert.equal(jaParou(amb.eventos()), true, 'sem liberação, parar não se repete');
  assert.equal(hook(stdinTui(amb.dir)).rc, 0);
  assert.equal(jaParou(amb.eventos()), false, 'a liberação conta como progresso: o próximo teto regrava loop.parar');
  amb.semear(ATE_O_TETO('T1'));
  assert.equal(jaParou(amb.eventos()), false);
  const p = loop(amb.dir, 'proxima', '--vivos', '0').j.acao;
  assert.deepEqual([p.tipo, p.motivo, p.task], ['parar', 'teto_rodadas', 'T1']);
  amb.semear([['loop.parar', { motivo: 'teto_rodadas' }]]);
  assert.equal(jaParou(amb.eventos()), true);
  assert.equal(hook(stdinTui(amb.dir)).rc, 0, 'segunda liberação');
  assert.equal(donos(amb).length, 2);
  assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'despachar');
});

/** ATE_O_TETO com a última linha `ms` à frente do agora, em outra sessão (`loop`) que a do dono. */
const semearComRelogioAdiante = (amb, aFrente) => {
  const lista = ATE_O_TETO('T1');
  let i = 0;
  amb.semear(lista, 'loop', () => (++i === lista.length ? aFrente : Date.now() - 60000 + i));
};

for (const [nome, aFrente] of [['3 s no futuro', () => Date.now() + 3000], ['em 2099', () => Date.parse('2099-01-01T00:00:00Z')]]) {
  test(`relogio-adiante (${nome}): outra sessão ⇒ block com a causa verdadeira, diário igual byte a byte, 3 tentativas = 0 eventos; a mesma sessão libera`, () => {
    const amb = repo();
    semearComRelogioAdiante(amb, aFrente());
    const antes = amb.bytes();
    for (let i = 0; i < 3; i += 1) {
      const r = hook(stdinTui(amb.dir));
      bloqueou(r, /relogio_do_diario/);
      assert.doesNotMatch(String(r.j.reason), /evento_nao_gravado/, 'o evento NÃO foi gravado: o código não pode dizer o contrário');
      assert.equal(r.j.systemMessage, undefined);
      assert.deepEqual(amb.bytes(), antes);
    }
    assert.equal(donos(amb).length, 0);
    assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'parar', 'a task segue no teto');
    // Mesma sessão do diário: a ordem é por seq, o evento cai depois do teto e a liberação vale.
    const ok = hook(stdinTui(amb.dir, { session_id: 'loop' }));
    assert.notEqual(ok.j?.decision, 'block', ok.out);
    assert.equal(donos(amb).length, 1);
    assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'despachar');
  });
}

test('relido: evento que o disco mostra sem efeito não vira sucesso, e o código não diz "não gravado"', () => {
  // O que só o disco revela: o projetado passou, mas o relido não bate. Provoca trocando o plano de lugar entre as duas leituras é
  // impossível sem corrida; então o teste fixa o contrato de nomes: o código da releitura não é o de "nada gravado".
  const fonte = readFileSync(LOOP, 'utf8');
  const trecho = fonte.slice(fonte.indexOf('export function liberarTeto'));
  assert.match(trecho, /'liberacao_sem_efeito'/);
  assert.doesNotMatch(trecho, /Falha\('evento_nao_gravado', `a liberação/);
});

test('gravacao-falha: diário sem permissão de escrita ⇒ block com a causa, nunca sucesso (contrato)', { skip: SEM_ROOT && 'root ignora permissão' }, () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const antes = amb.bytes();
  chmodSync(amb.entregas, 0o555);
  try {
    const r = hook(stdinTui(amb.dir));
    bloqueou(r, /evento_nao_gravado|nao gravado|não gravado/i);
    assert.equal(r.j.systemMessage, undefined);
  } finally {
    chmodSync(amb.entregas, 0o755);
  }
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(donos(amb).length, 0);
});

// ── T28: liberar não herda os achados do ciclo anterior (review-final-delta D1) ─────────────────────────────────────
const wtDe = (amb, t = 'T1') => join(amb.dir, '.harness', 'worktrees', t);
const tmpDe = (amb, t = 'T1') => join(wtDe(amb, t), '.tmp-gabarito');
const achadosDe = (amb, r, t = 'T1') => join(tmpDe(amb, t), `review-r${r}.md`);
/** Worktree real (pelo CLI) com os achados do ciclo que bateu no teto. */
function comAchadosVelhos(amb, t = 'T1') {
  const ab = loop(amb.dir, 'abrir', t);
  assert.equal(ab.rc, 0, ab.out + ab.err);
  writeFileSync(achadosDe(amb, 1, t), `ACHADOS VELHOS r1 ${t}\n`);
  writeFileSync(achadosDe(amb, 2, t), `ACHADOS VELHOS r2 ${t}\n`);
}
const lsTmp = (amb, t = 'T1') => readdirSync(tmpDe(amb, t)).sort();

test('D1-costura: hook real libera; o REPROVADO do ciclo novo exige arquivo do revisor novo e proxima nunca aponta achado velho', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  comAchadosVelhos(amb);
  const r = hook(stdinTui(amb.dir));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(lsTmp(amb).filter((n) => n.startsWith('review-')), [], 'nenhum achado velho no caminho');
  assert.equal(readFileSync(join(tmpDe(amb), 'ciclo-1', 'review-r1.md'), 'utf8'), 'ACHADOS VELHOS r1 T1\n', 'movido, conteúdo intacto');
  assert.ok(readFileSync(join(tmpDe(amb), 'ciclo-1', 'review-r2.md'), 'utf8').includes('r2'));
  const ab = loop(amb.dir, 'abrir', 'T1');
  assert.equal(ab.j?.ja_aberta, true);
  const g = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'feat(GM-10): trabalho'], { cwd: wtDe(amb), encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  for (const a of [['iniciar', 'T1', 'implementador'], ['concluir', 'T1'], ['iniciar', 'T1', 'revisor']]) {
    const x = loop(amb.dir, ...a);
    assert.equal(x.rc, 0, `${a.join(' ')}: ${x.out}${x.err}`);
  }
  const antes = amb.bytes();
  const sem = loop(amb.dir, 'veredito', 'T1', 'REPROVADO', '1', '0', '1');
  assert.equal(sem.j?.erro, 'achados_ausentes', sem.out);
  assert.deepEqual(amb.bytes(), antes, 'nada gravado');
  writeFileSync(achadosDe(amb, 1), '- MAJOR 1: achado NOVO (a.ts:1)\n');
  const ok = loop(amb.dir, 'veredito', 'T1', 'REPROVADO', '1', '0', '1');
  assert.equal(ok.rc, 0, ok.out + ok.err);
  const p = loop(amb.dir, 'proxima', '--vivos', '0').j.acao;
  assert.equal(p.tipo, 'despachar');
  assert.equal(p.itens[0].papel, 'correcao');
  assert.equal(realpathSync(p.itens[0].achados), realpathSync(achadosDe(amb, 1)));
  assert.match(readFileSync(p.itens[0].achados, 'utf8'), /NOVO/);
});

test('D1-sem-worktree: worktree ausente ⇒ nada a mover, libera e não cria nada', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  assert.equal(hook(stdinTui(amb.dir)).rc, 0);
  assert.equal(donos(amb).length, 1);
  assert.deepEqual(readdirSync(amb.dir).filter((n) => n === '.harness' || n.startsWith('.tmp')), ['.harness']);
  assert.deepEqual(readdirSync(join(amb.dir, '.harness')).sort(), ['entregas']);
});

test('D1-sem-tmp: worktree sem .tmp-gabarito, ou com .tmp-gabarito sem achados ⇒ libera sem criar ciclo', () => {
  const a = repo({ semear: ATE_O_TETO('T1') });
  mkdirSync(wtDe(a), { recursive: true });
  assert.equal(hook(stdinTui(a.dir)).rc, 0);
  assert.equal(donos(a).length, 1);
  assert.deepEqual(readdirSync(wtDe(a)), []);
  const b = repo({ semear: ATE_O_TETO('T1') });
  mkdirSync(tmpDe(b), { recursive: true });
  writeFileSync(join(tmpDe(b), 'outro.txt'), 'x');
  assert.equal(hook(stdinTui(b.dir)).rc, 0);
  assert.deepEqual(lsTmp(b), ['outro.txt']);
});

test('D1-symlink: .tmp-gabarito symlink ⇒ block, 0 eventos, nada movido fora', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  const fora = realpathSync(mkdtempSync(join(tmpdir(), 'liberar-fora-')));
  writeFileSync(join(fora, 'review-r1.md'), 'x\n');
  mkdirSync(wtDe(amb), { recursive: true });
  symlinkSync(fora, tmpDe(amb));
  const antes = amb.bytes();
  bloqueou(hook(stdinTui(amb.dir)), /tmpdir_invalido|symlink/);
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(donos(amb).length, 0);
  assert.deepEqual(readdirSync(fora), ['review-r1.md'], 'nada saiu nem entrou no alvo do symlink');
});

test('D1-rename-falha: diretório sem escrita ⇒ block com causa, 0 eventos, achados no lugar', { skip: SEM_ROOT && 'root ignora permissão' }, () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  comAchadosVelhos(amb);
  const antes = amb.bytes();
  chmodSync(tmpDe(amb), 0o555);
  try {
    const r = hook(stdinTui(amb.dir));
    bloqueou(r, /achados_nao_movidos|mover os achados/);
    assert.equal(r.j.systemMessage, undefined);
  } finally {
    chmodSync(tmpDe(amb), 0o755);
  }
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(donos(amb).length, 0);
  assert.deepEqual(lsTmp(amb).filter((n) => n.startsWith('review-')), ['review-r1.md', 'review-r2.md']);
  assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'parar', 'segue no teto');
});

test('D1-gravacao-falha-depois-de-mover: block; achados seguem em ciclo-1, task segue no teto e liberar de novo funciona', { skip: SEM_ROOT && 'root ignora permissão' }, () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  comAchadosVelhos(amb);
  chmodSync(amb.entregas, 0o555);
  try {
    bloqueou(hook(stdinTui(amb.dir)), /evento_nao_gravado|nao gravado|não gravado/i);
  } finally {
    chmodSync(amb.entregas, 0o755);
  }
  assert.equal(donos(amb).length, 0);
  assert.deepEqual(lsTmp(amb).filter((n) => !n.startsWith('.')), ['ciclo-1']);
  assert.deepEqual(readdirSync(join(tmpDe(amb), 'ciclo-1')).sort(), ['review-r1.md', 'review-r2.md']);
  assert.equal(loop(amb.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'parar', 'segue no teto');
  const r = hook(stdinTui(amb.dir));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.equal(donos(amb).length, 1);
  assert.deepEqual(lsTmp(amb).filter((n) => !n.startsWith('.')), ['ciclo-1'], 'nada a mover na segunda: não cria ciclo-2 vazio');
});

test('D1-n-proximo-livre: segundo teto move para ciclo-2 sem sobrescrever ciclo-1', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  comAchadosVelhos(amb);
  assert.equal(hook(stdinTui(amb.dir)).rc, 0);
  amb.semear(ATE_O_TETO('T1'));
  writeFileSync(achadosDe(amb, 1), 'SEGUNDO CICLO\n');
  assert.equal(hook(stdinTui(amb.dir)).rc, 0);
  assert.equal(donos(amb).length, 2);
  assert.equal(readFileSync(join(tmpDe(amb), 'ciclo-1', 'review-r1.md'), 'utf8'), 'ACHADOS VELHOS r1 T1\n');
  assert.equal(readFileSync(join(tmpDe(amb), 'ciclo-2', 'review-r1.md'), 'utf8'), 'SEGUNDO CICLO\n');
});

test('D1-recusas: estado fora do teto, args, relógio e diário ruim ⇒ nada movido', () => {
  const fora = repo({ semear: IMPL('T1') });
  comAchadosVelhos(fora);
  bloqueou(hook(stdinTui(fora.dir)), /nao_esta_no_teto/);
  assert.deepEqual(lsTmp(fora).filter((n) => !n.startsWith('.')), ['review-r1.md', 'review-r2.md']);

  const args = repo({ semear: ATE_O_TETO('T1') });
  comAchadosVelhos(args);
  for (const a of ['', 'T1 T2', '../x', 'T9']) bloqueou(hook(stdinTui(args.dir, { command_args: a })), /./);
  bloqueou(hook(stdinTui(args.dir, { agent_id: 'a1' })), /agent|subagent/i);
  assert.deepEqual(lsTmp(args).filter((n) => !n.startsWith('.')), ['review-r1.md', 'review-r2.md']);

  const rel = repo();
  semearComRelogioAdiante(rel, Date.now() + 3000);
  comAchadosVelhos(rel);
  bloqueou(hook(stdinTui(rel.dir)), /relogio_do_diario/);
  assert.deepEqual(lsTmp(rel).filter((n) => !n.startsWith('.')), ['review-r1.md', 'review-r2.md']);
  assert.equal(donos(rel).length, 0);
});

test('D1-so-a-task-pedida: liberar T2 não mexe nos achados de T1', () => {
  const amb = repo({ plano: PLANO2, semear: [...ATE_O_TETO('T1'), ...ATE_O_TETO('T2')] });
  comAchadosVelhos(amb, 'T1');
  comAchadosVelhos(amb, 'T2');
  assert.equal(hook(stdinTui(amb.dir, { command_args: 'T2' })).rc, 0);
  assert.deepEqual(lsTmp(amb, 'T1').filter((n) => !n.startsWith('.')), ['review-r1.md', 'review-r2.md']);
  assert.deepEqual(lsTmp(amb, 'T2').filter((n) => !n.startsWith('.')), ['ciclo-1']);
});

test('D1-fechar: fechar continua removendo .tmp-gabarito com ciclo-1 dentro', () => {
  const amb = repo({ semear: ATE_O_TETO('T1') });
  comAchadosVelhos(amb);
  assert.equal(hook(stdinTui(amb.dir)).rc, 0);
  assert.ok(lsTmp(amb).includes('ciclo-1'));
  const f = loop(amb.dir, 'fechar', 'T1');
  assert.equal(f.rc, 0, f.out + f.err);
  assert.equal(existsSync(wtDe(amb)), false);
});

// ── Stop em `concluir` ────────────────────────────────────────────────────────────────────────────────────────────
function stop(dir) {
  const r = spawnSync(process.execPath, [STOP], { input: JSON.stringify({ session_id: 'S1', cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() === '' ? null : JSON.parse(r.stdout);
}
const FIM = (t) => [...IMPL(t), APROVA(t, 1), ['task.integrada', { task: t, sha: 'a'.repeat(40) }]];

test('stop-concluir: com liberação o aviso lista task, hora e sessão; sem liberação segue calado', () => {
  const plano = PLANO;
  const sem = repo({ plano, semear: [...IMPL('T1'), ['task.reaberta', { task: 'T1', origem: 'retomada' }], APROVA('T1', 1), ['task.integrada', { task: 'T1', sha: 'a'.repeat(40) }]] }); // reabertura da retomada não é liberação
  assert.equal(loop(sem.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'concluir');
  assert.equal(stop(sem.dir), null, 'sem liberação do dono (só retomada), concluir é silêncio');

  const com = repo({ plano, semear: ATE_O_TETO('T1') });
  assert.equal(hook(stdinTui(com.dir)).rc, 0);
  com.semear([...IMPL('T1'), APROVA('T1', 1), ['task.integrada', { task: 'T1', sha: 'a'.repeat(40) }]]);
  assert.equal(loop(com.dir, 'proxima', '--vivos', '0').j.acao.tipo, 'concluir');
  const s = stop(com.dir);
  assert.notEqual(s?.decision, 'block');
  assert.match(s?.systemMessage ?? '', /Liberações do teto: T1 \(\d{4}-\d{2}-\d{2}T[\d:.]+Z, S-dono\)/);
  assert.match(s.systemMessage, /Se não foi você, confira o diário/);
});

test('stop-concluir: diário ilegível cai no aviso que já existe, nunca vira concluir', () => {
  const plano = PLANO;
  const amb = repo({ plano, semear: FIM('T1') });
  const arq = join(amb.entregas, readdirSync(amb.entregas).find((n) => n.startsWith('events.')));
  writeFileSync(arq, `${readFileSync(arq, 'utf8')}lixo\n`);
  const s = stop(amb.dir);
  assert.match(s?.systemMessage ?? '', /ilegível/);
  assert.doesNotMatch(s.systemMessage, /Liberações do teto/);
});

// ── Estáticos: skill, hook, texto ao dono ─────────────────────────────────────────────────────────────────────────
const lerPlugin = (...p) => readFileSync(join(PLUGIN, ...p), 'utf8');

test('skill-liberar: disable-model-invocation: true no frontmatter; o corpo manda consultar proxima e não afirma que liberou', () => {
  const t = lerPlugin('skills', 'liberar', 'SKILL.md');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(t)?.[1] ?? '';
  assert.match(fm, /^name: liberar$/m);
  assert.match(fm, /^disable-model-invocation: true$/m);
  assert.match(fm, /^description: .+/m);
  const corpo = t.slice(t.indexOf('\n---\n', 4));
  assert.match(corpo, /proxima --vivos/);
  assert.match(corpo, /hand-back|agente vivo/i);
  assert.doesNotMatch(corpo, /\bliberei\b|\bfoi liberada\b|\bliberada com sucesso\b/i);
  assert.doesNotMatch(fm, /allowed-tools:.*Write|allowed-tools:.*Edit/);
});

/** Semântica de matcher da doc de hooks: só letras, dígitos, `_` e `|` ⇒ lista exata; qualquer outro caractere ⇒ regex JS. Vazio/`*` casa tudo. */
const casa = (matcher, nome) => {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  if (/^[A-Za-z0-9_|]+$/.test(matcher)) return matcher.split('|').includes(nome);
  return new RegExp(matcher).test(nome);
};

test('hooks.json: UserPromptExpansion roda liberar-teto.mjs com onFailure block, e só para o próprio comando (matcher real)', () => {
  // GM-11 T1: o evento ganhou o grupo da emenda (matcher próprio); o do liberar continua sozinho no seu matcher.
  const todos = JSON.parse(lerPlugin('hooks', 'hooks.json')).hooks.UserPromptExpansion;
  assert.ok(Array.isArray(todos) && todos.length === 2);
  const h = todos.filter((g) => /liberar-teto\.mjs/.test(JSON.stringify(g)));
  assert.equal(h.length, 1);
  assert.equal(todos.filter((g) => casa(g.matcher, COMANDO)).length, 1, 'só um grupo casa o liberar');
  const cmd = h[0].hooks[0];
  assert.equal(cmd.type, 'command');
  assert.match(cmd.command, /gates\/scripts\/liberar-teto\.mjs/);
  assert.equal(cmd.onFailure, 'block');
  assert.ok(Number.isInteger(cmd.timeout) && cmd.timeout > 0);
  // onFailure: block sem matcher bloquearia todo comando digitado de qualquer plugin quando o script falha.
  assert.equal(typeof h[0].matcher, 'string');
  assert.ok(casa(h[0].matcher, COMANDO), `o matcher ${h[0].matcher} tem de casar ${COMANDO}`);
  for (const alheio of ['gsd-help', 'gabarito-mestre:gabarito-instalar', 'liberar', 'x-gabarito-mestre:liberar', 'gabarito-mestre:liberar-tudo', '']) {
    assert.ok(!casa(h[0].matcher, alheio), `o matcher ${h[0].matcher} não pode casar ${JSON.stringify(alheio)}`);
  }
});

test('gabarito-loop: o teto manda o dono digitar o comando exato', () => {
  const t = lerPlugin('skills', 'gabarito-loop', 'SKILL.md');
  assert.match(t, /\/gabarito-mestre:liberar <task>/);
  assert.match(t, /só o dono libera/i);
});

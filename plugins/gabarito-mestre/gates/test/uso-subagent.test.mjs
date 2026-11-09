/**
 * Testes do hook SubagentStop `uso-subagent.mjs` (GM-10 T10, REQ-OBS-1, F7): tokens por subagent sem mod.
 *
 * O hook lê `agent_transcript_path`, soma `message.usage` com dedupe por `message.id`, relê a cada 40 ms até estabilizar (teto 200 ms)
 * (a última mensagem ainda não está no arquivo quando o SubagentStop dispara: S8 P4) e grava
 * `custo.medicao {agente: 'subagent:<id>', …}` por `append` do diário. Só números; nunca conteúdo.
 *
 * MUTAÇÕES PRESCRITAS (arquivo: gates/scripts/uso-subagent.mjs; cada uma tem que derrubar a suíte):
 *  M1  somar sem dedupe por `message.id`            ⇒ `soma-dedupe-por-id`
 *  M2  não reler após a espera                      ⇒ `ultima-mensagem-tardia`
 *  M3  não filtrar `agent_type` vazio               ⇒ `agent-type-vazio-ignora`
 *  M4  gravar o texto da mensagem em `dados`        ⇒ `nao-grava-conteudo`
 *  M5  não checar custo.medicao já existente        ⇒ `nao-duplica-com-mod` e `idempotente-por-agent-id`
 *  M6  aceitar caminho fora de ~/.claude/projects   ⇒ `caminho-fora-de-projetos-ignora`
 *  M7  ler o arquivo inteiro acima do teto          ⇒ `arquivo-acima-do-teto-parcial`
 *  M8  criar o diretório sem `.harness`             ⇒ `sem-harness-nao-cria-nada`
 *  M9  dormir por espera ativa                      ⇒ `espera-sem-cpu`
 *  M10 valor por último em vez do maior por campo   ⇒ `soma-dedupe-por-id`
 *  M11 aceitar campo não numérico em `usage`        ⇒ `linha-corrompida-ignora`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'uso-subagent.mjs');
const SENTINELA = 'SENTINELA-CONTEUDO-NAO-PODE-VAZAR-7f3a';

const bruto = (p) => mkdtempSync(join(realpathSync(tmpdir()), `${p}-`));

/** Casa de teste: HOME com ~/.claude/projects e um repo git na branch de um PBI, com `.harness/entregas/GM-10/`. */
function cenario({ harness = true, entrega = true } = {}) {
  const home = bruto('home');
  const projetos = join(home, '.claude', 'projects', 'proj');
  mkdirSync(projetos, { recursive: true });
  const repo = bruto('repo');
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'enabler/GM-10-teste');
  g('config', 'user.email', 'teste@exemplo.com');
  g('config', 'user.name', 'Teste');
  if (harness) mkdirSync(join(repo, '.harness'), { recursive: true });
  const dir = join(repo, '.harness', 'entregas', 'GM-10');
  if (harness && entrega) mkdirSync(dir, { recursive: true });
  return { home, projetos, repo, dir };
}

const msg = (id, uso, extra = {}) =>
  JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: SENTINELA }], usage: uso, ...extra } });
const U = (i, o, cr = 0, cc = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc });

function transcript(c, linhas, nome = 'agent-a1.jsonl') {
  const p = join(c.projetos, nome);
  writeFileSync(p, `${linhas.join('\n')}\n`);
  return p;
}

function rodar(c, entrada, { stdin, env = {} } = {}) {
  const corpo = stdin !== undefined ? stdin : JSON.stringify({
    session_id: 'sess-1', cwd: c.repo, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'gabarito-implementador', ...entrada,
  });
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: corpo, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, HOME: c.home, USERPROFILE: c.home, CLAUDE_PROJECT_DIR: '', ...env },
  });
  return { ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function eventos(c) {
  if (!existsSync(c.dir)) return [];
  const out = [];
  for (const n of readdirSync(c.dir).filter((x) => /^events\..+\.jsonl$/.test(x))) {
    for (const l of readFileSync(join(c.dir, n), 'utf8').split('\n')) if (l) out.push(JSON.parse(l));
  }
  return out;
}
const medicoes = (c) => eventos(c).filter((e) => e.tipo === 'custo.medicao');

test('soma-dedupe-por-id: linhas repetidas por message.id contam uma vez; sai 0 e sem saída', () => {
  const c = cenario();
  const p = transcript(c, [
    msg('m1', U(10, 5, 100, 20)),
    msg('m1', U(10, 5, 100, 20)), // repetida
    msg('m2', U(1, 7, 200, 0)),
    msg('m2', U(1, 7, 200, 0)),
    msg('m2', U(1, 7, 200, 0)),
    msg('m2', U(1, 2, 200, 0)), // repetição parcial por último (stream): vale o maior por campo
  ]);
  const r = rodar(c, { agent_transcript_path: p });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  const m = medicoes(c);
  assert.equal(m.length, 1);
  assert.equal(m[0].agente, 'subagent:a1');
  assert.equal(m[0].sessao, 'sess-1');
  assert.deepEqual(
    { i: m[0].dados.input_tokens, o: m[0].dados.output_tokens, cr: m[0].dados.cache_read, cc: m[0].dados.cache_creation, n: m[0].dados.mensagens },
    { i: 11, o: 12, cr: 300, cc: 20, n: 2 },
  );
  assert.equal(m[0].dados.parcial, undefined);
});

test('ultima-mensagem-tardia: a releitura após a espera pega a mensagem que chegou depois do disparo', async () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const { somarUso, PASSO_MS, TETO_ESPERA_MS } = await import(pathToFileURL(SCRIPT).href);
  assert.equal(PASSO_MS, 40);
  assert.equal(TETO_ESPERA_MS, 200);
  const esperas = [];
  const r = comHome(c, () => somarUso(p, {
    dormir: (ms) => {
      esperas.push(ms);
      if (esperas.length === 1) {
        appendFileSync(p, `${msg('m2', U(3, 9, 40))}\n`); // chega durante a espera
        appendFileSync(p, `${msg('m1', U(10, 5))}\n`); // e a 1ª repete: dedupe entre as leituras
      }
    },
  }));
  assert.equal(esperas[0], 40);
  assert.deepEqual(
    { i: r.input_tokens, o: r.output_tokens, cr: r.cache_read, n: r.mensagens },
    { i: 13, o: 14, cr: 40, n: 2 },
  );
});

/** Roda `f` com HOME no cenário (os.homedir() lê HOME no POSIX). */
function comHome(c, f) {
  const antes = process.env.HOME;
  process.env.HOME = c.home;
  try { return f(); } finally { process.env.HOME = antes; }
}

// Pré-carga do hook (só do teste): depois que o hook fecha a 1ª leitura do transcript, avisa por arquivo e fica parado até
// o escritor, em outro processo, avisar por arquivo que anexou. Ordem garantida por troca de arquivos, não por relógio.
const PRECARGA = `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const [alvo, lido, anexado] = process.env.BARREIRA.split('|');
const abrir = fs.openSync, fechar = fs.closeSync;
let fdAlvo = -1, feito = false;
fs.openSync = (p, ...r) => { const fd = abrir(p, ...r); if (!feito && fdAlvo < 0 && p === alvo) fdAlvo = fd; return fd; };
fs.closeSync = (fd) => {
  const r = fechar(fd);
  if (!feito && fd === fdAlvo) {
    feito = true;
    fs.writeFileSync(lido, '1');
    const cabo = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; i < 3000 && !fs.existsSync(anexado); i++) Atomics.wait(cabo, 0, 0, 5);
  }
  return r;
};
syncBuiltinESMExports();
`;

test('ultima-mensagem-tardia-em-processo-separado-conta: escrita tardia real, em processo separado, depois da 1ª leitura do hook, entra na soma (ordem por arquivo, sem relógio)', async () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const pasta = bruto('barreira');
  const precarga = join(pasta, 'precarga.cjs');
  const lido = join(pasta, 'lido');
  const anexado = join(pasta, 'anexado');
  writeFileSync(precarga, PRECARGA);
  const corpo = JSON.stringify({ session_id: 'sess-1', cwd: c.repo, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'gabarito-implementador', agent_transcript_path: p });
  // o hook pega o caminho real do transcript (realpath) ao abrir; a pré-carga compara com ele
  const alvo = realpathSync(p);
  const hook = spawn(process.execPath, ['--require', precarga, SCRIPT], { env: { ...process.env, HOME: c.home, USERPROFILE: c.home, CLAUDE_PROJECT_DIR: '', BARREIRA: [alvo, lido, anexado].join('|') }, stdio: ['pipe', 'ignore', 'ignore'] });
  const fim = new Promise((res) => hook.on('close', res));
  hook.stdin.end(corpo);
  // escritor em outro processo: só anexa a 2ª mensagem depois que o hook avisou que terminou a 1ª leitura
  const escritor = spawn(process.execPath, ['-e',
    `const fs=require('node:fs');const t=Date.now();while(!fs.existsSync(process.argv[1])){if(Date.now()-t>20000)process.exit(2);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);}
fs.appendFileSync(process.argv[2], process.argv[3]+'\\n');fs.writeFileSync(process.argv[4],'1');`, lido, p, msg('m2', U(3, 9, 40)), anexado], { stdio: 'ignore' });
  const fimEscritor = new Promise((res) => escritor.on('close', res));
  assert.equal(await fim, 0);
  assert.equal(await fimEscritor, 0, 'o escritor viu o aviso do hook e anexou');
  const [m] = medicoes(c);
  assert.ok(m, 'registrou');
  assert.equal(m.dados.mensagens, 2);
  assert.equal(m.dados.input_tokens, 13);
});

test('espera-real-tem-limite-inferior: somarUso com a espera real dorme ao menos 2 passos (relógio monotônico; só limite inferior)', async () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const { somarUso, PASSO_MS } = await import(pathToFileURL(SCRIPT).href);
  const t0 = process.hrtime.bigint();
  const r = comHome(c, () => somarUso(p));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.leituras, 3); // arquivo parado: r0, r1, r2 (igual a r1) ⇒ 2 esperas
  assert.ok(ms >= 2 * PASSO_MS - 2, `esperou ${ms} ms; o mínimo é 2 esperas de ${PASSO_MS} ms (tolerância 2 ms de granularidade)`);
});

test('releitura-ate-estabilizar: cresceu na espera, relê; estável em 2 leituras seguidas, para (conta leituras, não relógio)', async () => {
  const c = cenario();
  const { somarUso } = await import(pathToFileURL(SCRIPT).href);
  // mensagem chega só na 2ª espera (≈80 ms): a regra "2 leituras seguidas iguais" não pode parar antes
  const p = transcript(c, [msg('m1', U(10, 5))]);
  let n = 0;
  const r = comHome(c, () => somarUso(p, { dormir: () => { n += 1; if (n === 2) appendFileSync(p, `${msg('m2', U(1, 1))}\n`); } }));
  assert.equal(r.mensagens, 2);
  assert.equal(r.leituras, 4); // r0, r1 (igual a r0), r2 (cresceu), r3 (igual a r2: para)
  assert.equal(n, 3);
});

test('arquivo-parado-nao-espera-teto: arquivo que não muda para cedo; o que sempre cresce para no teto de espera', async () => {
  const c = cenario();
  const { somarUso, PASSO_MS, TETO_ESPERA_MS } = await import(pathToFileURL(SCRIPT).href);
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const esperas = [];
  const parado = comHome(c, () => somarUso(p, { dormir: (ms) => esperas.push(ms) }));
  assert.equal(parado.leituras, 3); // r0 + 2 leituras seguidas iguais
  assert.ok(esperas.length * PASSO_MS < TETO_ESPERA_MS, `esperou ${esperas.length} passos`);
  assert.equal(esperas.length, 2);
  // crescendo a cada espera: nunca estabiliza; para quando a soma das esperas chega ao teto
  const q = transcript(c, [msg('g0', U(1, 1))], 'agent-cresce.jsonl');
  const esp2 = [];
  const cresce = comHome(c, () => somarUso(q, { dormir: (ms) => { esp2.push(ms); appendFileSync(q, `${msg(`g${esp2.length}`, U(1, 1))}\n`); } }));
  assert.equal(esp2.reduce((a, b) => a + b, 0), TETO_ESPERA_MS);
  assert.equal(cresce.leituras, TETO_ESPERA_MS / PASSO_MS + 1);
  assert.equal(cresce.mensagens, TETO_ESPERA_MS / PASSO_MS + 1);
});

function worktree(c, nome = 'wt-GM-10-3') {
  const g = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  writeFileSync(join(c.repo, 'a.txt'), 'x');
  g(c.repo, 'add', 'a.txt');
  g(c.repo, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  const wt = join(bruto('wts'), nome);
  assert.equal(g(c.repo, 'worktree', 'add', '-q', '-b', 'wt/GM-10-3', wt).status, 0);
  return wt;
}

test('worktree-sem-harness-grava-no-projeto: cwd no worktree (sem .harness) e CLAUDE_PROJECT_DIR no projeto grava no projeto', () => {
  const c = cenario();
  const wt = worktree(c);
  assert.equal(existsSync(join(wt, '.harness')), false);
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const r = rodar(c, { agent_transcript_path: p, cwd: wt }, { env: { CLAUDE_PROJECT_DIR: c.repo } });
  assert.equal(r.status, 0);
  assert.equal(medicoes(c).length, 1);
  assert.equal(existsSync(join(wt, '.harness')), false, 'nada no worktree');
});

test('projeto-dir-ausente-sai-0: variável vazia ou ausente cai no cwd; só o cwd do worktree (sem .harness) não grava e sai 0', () => {
  const c = cenario();
  const wt = worktree(c);
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const r = rodar(c, { agent_transcript_path: p, cwd: wt }, { env: { CLAUDE_PROJECT_DIR: '' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
  assert.equal(medicoes(c).length, 0);
  assert.equal(existsSync(join(wt, '.harness')), false);
  // variável removida do ambiente (não só vazia), cwd na raiz do projeto: mede
  const env = { ...process.env, HOME: c.home, USERPROFILE: c.home };
  delete env.CLAUDE_PROJECT_DIR;
  const r2 = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8', input: JSON.stringify({ session_id: 'sess-1', cwd: c.repo, agent_id: 'a1', agent_type: 'x', agent_transcript_path: p }) });
  assert.equal(r2.status, 0);
  assert.equal(medicoes(c).length, 1);
});

test('projeto-dir-invalido-sai-0: variável apontando para inexistente, arquivo ou fora de repo não derruba nem grava em lugar errado', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const fora = bruto('fora'); // existe, mas não é repo nem tem .harness
  for (const v of [join(c.home, 'nao-existe'), p, fora]) {
    const r = rodar(c, { agent_transcript_path: p, cwd: c.repo }, { env: { CLAUDE_PROJECT_DIR: v } });
    assert.equal(r.status, 0, v);
    assert.equal(r.stdout + r.stderr, '', v);
    assert.equal(existsSync(join(fora, '.harness')), false, v);
  }
  // variável inválida cai no cwd: uma medição só (idempotente), nenhum número inventado
  assert.equal(medicoes(c).length, 1);
});

test('agent-type-vazio-ignora: disparo de agente interno (agent_type "" ou ausente) não grava', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  assert.equal(rodar(c, { agent_transcript_path: p, agent_type: '' }).status, 0);
  assert.equal(rodar(c, { agent_transcript_path: p, agent_type: undefined }).status, 0);
  assert.equal(medicoes(c).length, 0);
  assert.equal(rodar(c, { agent_transcript_path: p }).status, 0);
  assert.equal(medicoes(c).length, 1);
});

test('transcript-ausente-sai-0: caminho inexistente, diretório, ausente no JSON, stdin vazio e JSON quebrado', () => {
  const c = cenario();
  for (const e of [
    { agent_transcript_path: join(c.projetos, 'nao-existe.jsonl') },
    { agent_transcript_path: c.projetos },
    {},
    { agent_transcript_path: 42 },
    { agent_transcript_path: join(c.projetos, 'x\0y.jsonl') },
  ]) {
    const r = rodar(c, e);
    assert.equal(r.status, 0, JSON.stringify(e));
    assert.equal(r.stdout, '');
  }
  for (const stdin of ['', '   ', '{quebrado', 'null', '[]', '"texto"']) {
    const r = rodar(c, {}, { stdin });
    assert.equal(r.status, 0, stdin);
    assert.equal(r.stdout, '');
  }
  assert.equal(medicoes(c).length, 0);
});

test('linha-corrompida-ignora: linha ilegível, sem usage ou com campo não numérico não derruba a soma', () => {
  const c = cenario();
  const p = transcript(c, [
    msg('m1', U(10, 5)),
    '{isto nao e json',
    '',
    JSON.stringify({ type: 'user', message: { role: 'user', content: SENTINELA } }),
    msg('m2', { input_tokens: 'DEZ', output_tokens: -4, cache_read_input_tokens: null }),
    msg('m3', U(2, 3)),
    '{"message":{"id":"m4","usage":',
  ]);
  const r = rodar(c, { agent_transcript_path: p });
  assert.equal(r.status, 0);
  const [m] = medicoes(c);
  assert.deepEqual({ i: m.dados.input_tokens, o: m.dados.output_tokens, n: m.dados.mensagens }, { i: 12, o: 8, n: 3 });
});

test('nao-grava-conteudo: sentinela da mensagem fica fora do diário, do stdout e do stderr; dados só numéricos', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5, 1, 2), { stop_reason: SENTINELA }), msg('m2', U(1, 1))]);
  const r = rodar(c, { agent_transcript_path: p, last_assistant_message: SENTINELA });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
  for (const n of readdirSync(c.dir)) assert.ok(!readFileSync(join(c.dir, n), 'utf8').includes(SENTINELA), n);
  const [m] = medicoes(c);
  // GM-11 T9: `modelo` (texto ou null) e `papel` (texto) são os únicos campos não numéricos; o conteúdo da mensagem segue fora
  for (const [k, v] of Object.entries(m.dados)) if (k !== 'modelo' && k !== 'papel') assert.equal(typeof v, 'number', k);
  assert.equal(m.dados.modelo, null);
  assert.deepEqual(Object.keys(m.dados).sort(), ['cache_creation', 'cache_read', 'input_tokens', 'mensagens', 'modelo', 'output_tokens', 'papel']);
});

test('nao-duplica-com-mod: evento do mod para o mesmo agente impede a gravação', async () => {
  const c = cenario();
  const { append } = await import(pathToFileURL(join(AQUI, '..', 'dist', 'diario.js')).href);
  const ok = append(c.dir, 'outra-sessao', {
    ts: new Date().toISOString(), autor: 'mod', sessao: 'outra-sessao', agente: 'subagent:a1', tipo: 'custo.medicao',
    dados: { input_tokens: 1, output_tokens: 1, cache_read: 0 },
  });
  assert.equal(ok.ok, true);
  const p = transcript(c, [msg('m1', U(10, 5))]);
  assert.equal(rodar(c, { agent_transcript_path: p }).status, 0);
  assert.equal(medicoes(c).length, 1);
  assert.equal(medicoes(c)[0].autor, 'mod');
  // outro agente na mesma sessão continua sendo medido
  const q = transcript(c, [msg('z1', U(4, 4))], 'agent-b2.jsonl');
  assert.equal(rodar(c, { agent_transcript_path: q, agent_id: 'b2' }).status, 0);
  assert.deepEqual(medicoes(c).map((e) => e.agente).sort(), ['subagent:a1', 'subagent:b2']);
});

test('idempotente-por-agent-id: vários SubagentStop do mesmo agente não dobram a soma', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5, 100, 0)), msg('m2', U(1, 2, 3, 4))]);
  for (let i = 0; i < 5; i++) assert.equal(rodar(c, { agent_transcript_path: p }).status, 0);
  const m = medicoes(c);
  assert.equal(m.length, 1);
  assert.equal(m[0].dados.input_tokens, 11);
  assert.equal(m[0].dados.output_tokens, 7);
});

test('caminho-fora-de-projetos-ignora: fora de ~/.claude/projects, symlink para fora e prefixo parecido não valem', () => {
  const c = cenario();
  const fora = join(c.repo, 'fora.jsonl');
  writeFileSync(fora, `${msg('m1', U(10, 5))}\n`);
  const irmao = join(c.home, '.claude', 'projects-outro');
  mkdirSync(irmao, { recursive: true });
  writeFileSync(join(irmao, 'a.jsonl'), `${msg('m1', U(10, 5))}\n`);
  symlinkSync(fora, join(c.projetos, 'ln.jsonl'));
  for (const alvo of [fora, join(irmao, 'a.jsonl'), join(c.projetos, 'ln.jsonl'), join(c.projetos, '..', '..', '..', 'repo.jsonl'), '/etc/hosts']) {
    const r = rodar(c, { agent_transcript_path: alvo });
    assert.equal(r.status, 0, alvo);
  }
  assert.equal(medicoes(c).length, 0);
});

test('fifo-nao-trava: arquivo que não é regular (fifo) é ignorado sem bloquear', () => {
  const c = cenario();
  const f = join(c.projetos, 'fifo.jsonl');
  assert.equal(spawnSync('mkfifo', [f]).status, 0);
  const r = rodar(c, { agent_transcript_path: f });
  assert.equal(r.status, 0);
  assert.ok(r.ms < 5000, `levou ${r.ms} ms`);
  assert.equal(medicoes(c).length, 0);
});

test('arquivo-acima-do-teto-parcial: acima do teto lê só o teto, marca parcial e não estoura memória', async () => {
  const c = cenario();
  const { TETO_BYTES } = await import(pathToFileURL(SCRIPT).href);
  const p = join(c.projetos, 'grande.jsonl');
  const um = `${msg('m0', U(1, 1))}\n`;
  writeFileSync(p, um);
  // enche até passar o teto com mensagens de ids distintos, cada uma valendo 1 input
  const bloco = Array.from({ length: 2000 }, (_, i) => msg(`g${i}`, U(1, 0))).join('\n') + '\n';
  let tam = statSync(p).size;
  while (tam <= TETO_BYTES + 1024) {
    appendFileSync(p, bloco);
    tam = statSync(p).size;
  }
  appendFileSync(p, `${msg('ultima-depois-do-teto', U(1000000, 0))}\n`);
  const r = rodar(c, { agent_transcript_path: p });
  assert.equal(r.status, 0);
  const [m] = medicoes(c);
  assert.ok(m, 'registrou');
  assert.equal(m.dados.parcial, true);
  assert.ok(m.dados.input_tokens < 1000000, 'não leu a mensagem depois do teto');
  assert.ok(m.dados.mensagens > 1000);
});

test('sem-harness-nao-cria-nada: sem .harness (ou sem a pasta da entrega) sai 0 sem criar diretório', () => {
  for (const opc of [{ harness: false }, { harness: true, entrega: false }]) {
    const c = cenario(opc);
    const p = transcript(c, [msg('m1', U(10, 5))]);
    const antes = readdirSync(c.repo).sort();
    const r = rodar(c, { agent_transcript_path: p });
    assert.equal(r.status, 0);
    assert.deepEqual(readdirSync(c.repo).sort(), antes);
    assert.equal(existsSync(join(c.repo, '.harness', 'entregas')), false);
    assert.equal(existsSync(c.dir), false);
  }
});

test('sessao-invalida-ou-agent-id-estranho-sai-0: ids fora do padrão não viram nome de arquivo', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  assert.equal(rodar(c, { agent_transcript_path: p, session_id: '../x' }).status, 0);
  assert.equal(rodar(c, { agent_transcript_path: p, session_id: undefined }).status, 0);
  assert.equal(rodar(c, { agent_transcript_path: p, agent_id: 'a/../b' }).status, 0);
  assert.equal(rodar(c, { agent_transcript_path: p, agent_id: '' }).status, 0);
  assert.equal(medicoes(c).length, 0);
});

test('espera-sem-cpu: a espera de 60 ms é bloqueio, não laço; tempo total do hook fica dentro do timeout', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const r = rodar(c, { agent_transcript_path: p });
  assert.equal(r.status, 0);
  assert.equal(medicoes(c).length, 1);
  assert.ok(r.ms < 4000, `levou ${r.ms} ms`);
  const fonte = readFileSync(SCRIPT, 'utf8');
  assert.match(fonte, /Atomics\.wait/);
  assert.doesNotMatch(fonte, /while\s*\(\s*(Date\.now|performance\.now)/);
});

// ---- GM-11 T9: papel e modelo no custo ----

test('custo-sombra-papel: agent_type gabarito-mestre:gabarito-sombra grava papel sombra; a chave do agente não muda', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'claude-sonnet-5-5' })]);
  const r = rodar(c, { agent_transcript_path: p, agent_type: 'gabarito-mestre:gabarito-sombra' });
  assert.equal(r.status, 0);
  const m = medicoes(c);
  assert.equal(m.length, 1);
  assert.equal(m[0].agente, 'subagent:a1');
  assert.equal(m[0].dados.papel, 'sombra');
});

test('custo-traz-modelo-e-papel: dados ganha modelo e papel, mais os números de sempre', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5, 1, 2), { model: 'claude-sonnet-5-5' })]);
  rodar(c, { agent_transcript_path: p, agent_type: 'gabarito-mestre:gabarito-implementador' });
  const [m] = medicoes(c);
  assert.equal(m.dados.modelo, 'claude-sonnet-5-5');
  assert.equal(m.dados.papel, 'implementador');
  assert.equal(m.dados.input_tokens, 10);
  assert.equal(m.dados.cache_creation, 2);
});

test('papel-desconhecido-omitido: tipo fora dos quatro papéis não grava papel; sufixo colado ou com prefixo estranho também não', async () => {
  const { papelDoAgente } = await import(pathToFileURL(SCRIPT).href);
  const casos = {
    'gabarito-sombra': 'sombra',
    'gabarito-mestre:gabarito-sombra': 'sombra',
    'gabarito-revisor': 'revisor',
    'gabarito-mestre:gabarito-revisor': 'revisor',
    'gabarito-implementador': 'implementador',
    'x:gabarito-spike': 'spike',
    Explore: null,
    'general-purpose': null,
    '': null,
    'gabarito-sombra-extra': null,
    'meu-gabarito-sombra': null,
    'a:b:gabarito-sombra': null,
    'gabarito-outro': null,
    'gabarito-mestre:gabarito-planejador': null,
    'GABARITO-SOMBRA': null,
    'gabarito-mestre:': null,
  };
  for (const [tipo, esperado] of Object.entries(casos)) assert.equal(papelDoAgente(tipo), esperado, `tipo ${JSON.stringify(tipo)}`);
  assert.equal(papelDoAgente(undefined), null);
  assert.equal(papelDoAgente(42), null);
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'm-real' })]);
  rodar(c, { agent_transcript_path: p, agent_type: 'Explore' });
  const [m] = medicoes(c);
  assert.equal('papel' in m.dados, false);
  assert.equal(m.dados.modelo, 'm-real');
});

test('modelo-ignora-synthetic: <synthetic> depois do real não vira modelo', async () => {
  const { modeloDoTranscript } = await import(pathToFileURL(SCRIPT).href);
  assert.equal(modeloDoTranscript([msg('m1', U(1, 1), { model: 'claude-opus-4-7' }), msg('m2', U(1, 1), { model: '<synthetic>' })]), 'claude-opus-4-7');
  assert.equal(modeloDoTranscript([msg('m1', U(1, 1), { model: '<synthetic>' })]), null);
  assert.equal(modeloDoTranscript([msg('m1', U(1, 1), { model: '' }), msg('m2', U(1, 1), { model: 7 })]), null);
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'claude-opus-4-7' }), msg('m2', U(1, 1), { model: '<synthetic>' })]);
  rodar(c, { agent_transcript_path: p });
  assert.equal(medicoes(c)[0].dados.modelo, 'claude-opus-4-7');
});

test('modelo-ultimo-real: com mais de um modelo vale o último real, na ordem do arquivo', async () => {
  const { modeloDoTranscript } = await import(pathToFileURL(SCRIPT).href);
  assert.equal(modeloDoTranscript([msg('m1', U(1, 1), { model: 'a-model' }), msg('m2', U(1, 1), { model: 'b-model' }), msg('m3', U(1, 1), { model: '<synthetic>' })]), 'b-model');
  assert.equal(modeloDoTranscript([msg('m1', U(1, 1), { model: 'b-model' }), msg('m2', U(1, 1), { model: 'a-model' })]), 'a-model');
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'a-model' }), msg('m2', U(1, 1), { model: 'b-model' })]);
  rodar(c, { agent_transcript_path: p });
  assert.equal(medicoes(c)[0].dados.modelo, 'b-model');
});

test('modelo-ausente-null: sem message.model a medição grava modelo null (chave presente), e os números continuam', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  rodar(c, { agent_transcript_path: p });
  const [m] = medicoes(c);
  assert.equal('modelo' in m.dados, true);
  assert.equal(m.dados.modelo, null);
  assert.equal(m.dados.input_tokens, 10);
});

test('dedupe-intacto-com-papel: segundo disparo, com outro agent_type ou depois do mod, não duplica; agente segue subagent:<id>', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'm-a' })]);
  rodar(c, { agent_transcript_path: p, agent_type: 'gabarito-mestre:gabarito-sombra' });
  rodar(c, { agent_transcript_path: p, agent_type: 'gabarito-mestre:gabarito-revisor' });
  rodar(c, { agent_transcript_path: p, agent_type: 'gabarito-mestre:gabarito-sombra' });
  const m = medicoes(c);
  assert.equal(m.length, 1);
  assert.equal(m[0].agente, 'subagent:a1');
  assert.equal(m[0].dados.papel, 'sombra');
  const outro = rodar(c, { agent_transcript_path: p, agent_id: 'a2', agent_type: 'gabarito-mestre:gabarito-sombra' });
  assert.equal(outro.status, 0);
  assert.deepEqual(medicoes(c).map((x) => x.agente).sort(), ['subagent:a1', 'subagent:a2']);
});

test('transcript-ausente-x-corrompido: sem arquivo nada é gravado; lixo inteiro nada; linha torta é ignorada e o resto soma', () => {
  const c = cenario();
  // ausente: caminho que não existe
  assert.equal(rodar(c, { agent_transcript_path: join(c.projetos, 'nao-existe.jsonl') }).status, 0);
  assert.equal(medicoes(c).length, 0);
  // corrompido por inteiro: nada para somar, e custo não vira 0 inventado
  const lixo = transcript(c, ['{nao json "usage" "model"', '{"message":', 'xxxx'], 'lixo.jsonl');
  assert.equal(rodar(c, { agent_transcript_path: lixo }).status, 0);
  assert.equal(medicoes(c).length, 0);
  // linha torta no meio e linha final truncada (com model): ignoradas; soma e modelo vêm do resto
  const torta = transcript(c, [
    msg('m1', U(10, 5), { model: 'm-bom' }),
    '{"type":"assistant","message":{"id":"mX","model":"m-torto","usage":{"input_tokens":999',
    msg('m2', U(1, 2), { model: 'm-bom2' }),
    '{"type":"assistant","message":{"id":"mY","model":"m-truncado","usage":{"input_tokens":50,"output_tok',
  ], 'torta.jsonl');
  rodar(c, { agent_transcript_path: torta });
  const [m] = medicoes(c);
  assert.equal(m.dados.input_tokens, 11);
  assert.equal(m.dados.output_tokens, 7);
  assert.equal(m.dados.mensagens, 2);
  assert.equal(m.dados.modelo, 'm-bom2');
});

test('papel-e-modelo-nao-gravam-conteudo: o texto da mensagem segue fora do diário mesmo com papel e modelo', () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'm-real' })]);
  rodar(c, { agent_transcript_path: p, agent_type: 'gabarito-mestre:gabarito-sombra' });
  for (const n of readdirSync(c.dir)) assert.ok(!readFileSync(join(c.dir, n), 'utf8').includes(SENTINELA));
});

test('modelo-da-mensagem-tardia: o modelo da mensagem que chega durante a espera vale (a releitura é a mais completa)', async () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5), { model: 'm-cedo' })]);
  const { somarUso } = await import(pathToFileURL(SCRIPT).href);
  let n = 0;
  const r = comHome(c, () => somarUso(p, {
    dormir: () => { n += 1; if (n === 1) appendFileSync(p, `${msg('m2', U(3, 9), { model: 'm-tarde' })}\n`); },
  }));
  assert.equal(r.modelo, 'm-tarde');
  assert.equal(r.mensagens, 2);
});

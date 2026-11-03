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

test('ultima-mensagem-a-100ms-conta: escrita tardia real, em processo separado, entra na soma (sem limite de tempo)', async () => {
  const c = cenario();
  const p = transcript(c, [msg('m1', U(10, 5))]);
  const corpo = JSON.stringify({ session_id: 'sess-1', cwd: c.repo, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'gabarito-implementador', agent_transcript_path: p });
  const hook = spawn(process.execPath, [SCRIPT], { env: { ...process.env, HOME: c.home, USERPROFILE: c.home, CLAUDE_PROJECT_DIR: '' }, stdio: ['pipe', 'ignore', 'ignore'] });
  const fim = new Promise((res) => hook.on('close', res));
  hook.stdin.end(corpo);
  // escritor em processo separado: anexa a 2ª mensagem 100 ms depois do disparo do hook
  const escritor = spawn(process.execPath, ['-e',
    `setTimeout(()=>require('node:fs').appendFileSync(process.argv[1], process.argv[2]+'\\n'), 100)`, p, msg('m2', U(3, 9, 40))], { stdio: 'ignore' });
  const fimEscritor = new Promise((res) => escritor.on('close', res));
  assert.equal(await fim, 0);
  await fimEscritor;
  const [m] = medicoes(c);
  assert.ok(m, 'registrou');
  assert.equal(m.dados.mensagens, 2);
  assert.equal(m.dados.input_tokens, 13);
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
  for (const [k, v] of Object.entries(m.dados)) assert.equal(typeof v, 'number', k);
  assert.deepEqual(Object.keys(m.dados).sort(), ['cache_creation', 'cache_read', 'input_tokens', 'mensagens', 'output_tokens']);
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

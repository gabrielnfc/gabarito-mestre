/**
 * Caminhada sem LLM do loop (GM-10 T22, P9). Porta de `walk.mjs` da Sombra Q-T13D.
 *
 * REAL: `loop.mjs`, `guarda.js`, `stop-loop.mjs`, `session-card.sh`, `mod/gabarito.mjs`, ponte do diário, git, `npm test` e o
 * gate de `integrar`, tudo em repositório git descartável. SIMULADO: o host do mod (`$`, mínimo) e o modelo, um script que segue
 * a skill `gabarito-loop` ao pé da letra e que o `/clear` deixa sem memória (`abertas`, rodada): só restam `proxima`, a retomada e o cartão.
 *
 * NÃO COBRE (só a sessão real mede): o modelo obedecer, `block` × `turn.complete` no host, `$` real.
 *
 * Roda como módulo (`caminhar(opcoes)`) ou como processo (`node caminhada.mjs '<json>'`, devolve o resultado em JSON): o teste usa
 * o processo para que cada cenário tenha o estado de módulo do mod só dele, e para rodar cenários em paralelo.
 * Nada de relógio nem carga decide resultado: cada espera é por evento (processo que terminou).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, symlinkSync, realpathSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fecharPendenciasNoDiario } from '../_adaptador-helpers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PLUGIN = join(AQUI, '..', '..', '..'); // plugins/gabarito-mestre
const NODE = process.execPath;

/** Ambiente dos filhos: sem a mecânica do `node --test` pai nem redirecionamento de git; TMPDIR é o do cenário. */
function ambiente(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') || k.startsWith('NODE_TEST') || k === 'NODE_OPTIONS') continue;
    e[k] = v;
  }
  // capacidade fixada pelo fixture: a máquina (carga, memória, disco) não muda o resultado da fumaça
  return { ...e, GABARITO_CAP_LOAD1: '0', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', ...extra };
}

const TEMPLATE = {
  T1: { src: 'src/a.mjs', codigo: 'export function soma(a, b) { return a + b; }\n', teste: 'test/a.test.mjs', mutar: ['a + b', 'a - b'],
    casos: "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { soma } from '../src/a.mjs';\ntest('s', () => assert.equal(soma(1, 2), 3));\n" },
  T2: { src: 'src/b.mjs', codigo: 'export function dobro(n) { return n * 2; }\n', teste: 'test/b.test.mjs', mutar: ['n * 2', 'n * 3'],
    casos: "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { dobro } from '../src/b.mjs';\ntest('d', () => assert.equal(dobro(2), 4));\n" },
  T3: { src: 'src/c.mjs', codigo: "import { soma } from './a.mjs';\nexport function triplo(n) { return soma(soma(n, n), n); }\n", teste: 'test/c.test.mjs', mutar: ['soma(soma(n, n), n)', 'soma(n, n)'],
    casos: "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { triplo } from '../src/c.mjs';\ntest('t', () => assert.equal(triplo(2), 6));\n" },
};

/** Leituras de git que a guarda deixa passar ao revisor: as 7 da base, os 9 leitores da T21 e o `hash-object` sem `-w` da T24. */
export const LEITURAS_REVISOR = [
  'git diff HEAD~1', 'git log --oneline -5', 'git status --short', 'git show --stat HEAD', 'git branch --show-current', 'git merge-base HEAD HEAD', 'git blame src/a.mjs',
  // os 9 leitores da T21 (D4)
  'git ls-tree HEAD', 'git cat-file -p HEAD', 'git rev-list HEAD', 'git show-ref', 'git for-each-ref', 'git describe --always',
  'git diff-tree --no-commit-id --name-only -r HEAD', 'git shortlog -s HEAD', 'git name-rev HEAD',
  // T24: leitura por forma
  'git hash-object package.json',
];

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ambiente(), stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Repositório descartável da entrega GM-99. Recusa destino existente (nunca apaga nada). */
export function montarRepo(dest, planoArquivo, { suiteSemGit = false } = {}) {
  if (existsSync(dest)) throw new Error(`destino já existe: ${dest}`);
  mkdirSync(join(dest, 'test'), { recursive: true });
  mkdirSync(join(dest, 'docs'), { recursive: true });
  writeFileSync(join(dest, '.gitignore'), '.harness/\nnode_modules/\n.tmp-gabarito/\n');
  writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: 'gm99-fumaca', version: '0.0.0', private: true, type: 'module', scripts: { test: 'node --test test/*.test.mjs' } }) + '\n');
  writeFileSync(join(dest, 'harness.config.json'), JSON.stringify({ gates: { suites: ['npm test'] }, loop: { slots: 2, tetoTokens: 1500000 } }) + '\n');
  writeFileSync(join(dest, 'test/base.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('base', () => assert.ok(true));\n");
  // D2: suíte sensível ao repositório pai. O temporário tem de nascer sem `.git` acima dele (CI roda com TMPDIR comum; uma worktree não).
  if (suiteSemGit) {
    writeFileSync(join(dest, 'test/sem-git.test.mjs'), [
      "import { test } from 'node:test';", "import assert from 'node:assert/strict';",
      "import { existsSync, mkdtempSync, rmSync } from 'node:fs';", "import { tmpdir } from 'node:os';", "import { dirname, join } from 'node:path';",
      "test('temporário sem .git acima', () => {",
      "  const d = mkdtempSync(join(tmpdir(), 'sem-git-'));",
      "  try {",
      "    let p = d; let achou = null;",
      "    for (;;) { if (existsSync(join(p, '.git'))) { achou = p; break; } const pai = dirname(p); if (pai === p) break; p = pai; }",
      "    assert.equal(achou, null, `.git acima do temporário: ${achou}`);",
      "  } finally { rmSync(d, { recursive: true, force: true }); }",
      "});", '',
    ].join('\n'));
  }
  writeFileSync(join(dest, 'docs/spec-gm99.md'), '# GM-99 (fumaça)\n\nREQ-A: src/a.mjs exporta soma. REQ-B: src/b.mjs exporta dobro. REQ-C: src/c.mjs exporta triplo (usa soma).\n');
  git(dest, 'init', '-q', '-b', 'enabler/GM-99-aceite');
  git(dest, 'config', 'user.email', 'fumaca@example.invalid');
  git(dest, 'config', 'user.name', 'Fumaca GM-99');
  git(dest, 'add', '-A');
  git(dest, 'commit', '-q', '-m', 'chore(GM-99): repositorio descartavel da fumaca');
  mkdirSync(join(dest, '.harness/entregas/GM-99'), { recursive: true });
  copyFileSync(planoArquivo, join(dest, '.harness/entregas/GM-99/plano.json'));
  // capacidade DECLARADA fixture: 2 slots sem calibrar a máquina (as "paralelas" podem ser 2)
  writeFileSync(join(dest, '.harness/capacidade.json'), JSON.stringify({ hostname: hostname(), slots_max: 2, rss_pico_mb: 100, tmpdir_mb: 10, cpu_total: 1, load_medido: 200, fixture: true }) + '\n');
}

/**
 * Cópia do mod em que `tasksDoNegado` devolve lista vazia (controle positivo do item 6): `gabarito.mjs` copiado (o Node segue
 * symlink, então o mod não pode ser link) e `gates/dist` de links, menos `pouso.js`, copiado e adulterado.
 */
function modSemReabrir(dir) {
  mkdirSync(join(dir, 'mod'), { recursive: true });
  mkdirSync(join(dir, 'gates/dist'), { recursive: true });
  copyFileSync(join(PLUGIN, 'mod/gabarito.mjs'), join(dir, 'mod/gabarito.mjs'));
  copyFileSync(join(PLUGIN, 'mod/painel.mjs'), join(dir, 'mod/painel.mjs')); // E4 T10: o gabarito.mjs importa o painel por caminho relativo
  for (const n of readdirSync(join(PLUGIN, 'gates/dist'))) {
    if (n === 'pouso.js') continue;
    symlinkSync(realpathSync(join(PLUGIN, 'gates/dist', n)), join(dir, 'gates/dist', n));
  }
  const fonte = readFileSync(join(PLUGIN, 'gates/dist/pouso.js'), 'utf8');
  if (!/export function tasksDoNegado\(/.test(fonte)) throw new Error('pouso.js sem tasksDoNegado: controle positivo não monta');
  writeFileSync(join(dir, 'gates/dist/pouso.js'), fonte.replace('export function tasksDoNegado(', 'function tasksDoNegadoReal(') + '\nexport function tasksDoNegado() { return { ok: true, tasks: [] }; }\n');
  return join(dir, 'mod/gabarito.mjs');
}

export async function caminhar(opcoes) {
  const o = { ordem: 'skill', vereditos: {}, x: '1', percent: 6, maxTurnos: 60, ...opcoes };
  const REPO = join(o.tmp, 'repo');
  montarRepo(REPO, o.plano, { suiteSemGit: o.suiteSemGit === true });
  const REAL = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8', env: ambiente() }).trim();
  const DIR = join(REAL, '.harness/entregas/GM-99');
  const LOOP = join(PLUGIN, 'gates/scripts/loop.mjs');
  const TMPDIR_CENARIO = join(o.tmp, 'tmpdir');
  mkdirSync(TMPDIR_CENARIO, { recursive: true });
  const envBase = { TMPDIR: TMPDIR_CENARIO, CLAUDE_PLUGIN_ROOT: PLUGIN };

  const trilha = [];
  const defeitos = []; // tudo que não era previsto: o teste exige lista vazia
  const previstos = []; // ok:false que a skill manda tratar (rodada esperada após /clear, achados a regravar)
  const def = (t) => { if (!defeitos.includes(t)) defeitos.push(t); trilha.push(`  !! ${t}`); };
  const contagem = { guarda: 0, ask: 0, deny: 0 };

  // ── guarda real (stdin) ────────────────────────────────────────
  function guarda(tool_name, tool_input, agente) {
    contagem.guarda++;
    const entrada = { hook_event_name: 'PreToolUse', session_id: 'S1', cwd: REAL, tool_name, tool_input, ...(agente ? { agent_id: agente.id, agent_type: agente.tipo } : {}) };
    const r = spawnSync(NODE, [join(PLUGIN, 'gates/dist/guarda.js')], { cwd: REAL, input: JSON.stringify(entrada), encoding: 'utf8', env: ambiente({ ...envBase, CLAUDE_PROJECT_DIR: REAL }) });
    if (r.status !== 0) def(`guarda rc ${r.status}`);
    let d = null;
    try { d = r.stdout.trim() === '' ? null : JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision ?? null; } catch { def('guarda saída não JSON'); }
    if (d === 'ask') contagem.ask++;
    if (d === 'deny') contagem.deny++;
    if (d) def(`guarda ${d}: ${agente?.tipo ?? 'orquestrador'} ${tool_name} ${JSON.stringify(tool_input).slice(0, 110)} :: ${r.stdout.slice(0, 160)}`);
    return d;
  }
  function bash(cmd, agente) {
    if (guarda('Bash', { command: cmd }, agente)) return { rc: 126, out: '', err: '' };
    const r = spawnSync('bash', ['-c', cmd], { cwd: REAL, encoding: 'utf8', env: ambiente(envBase) });
    return { rc: r.status, out: r.stdout, err: r.stderr };
  }
  /** REQ-APR-2: fecha só o que `pendenciasAprendizado` do `dist/` devolve (review, parar, fechamento). */
  const fechar = () => fecharPendenciasNoDiario(DIR, JSON.parse(readFileSync(join(DIR, 'plano.json'), 'utf8')));
  /** CLI do loop pela guarda. `previsto(j)` diz se um ok:false é parte do caminho (então não é defeito). */
  function cli(args, previsto = () => false) {
    fechar(); // REQ-APR-2 muda a ordem: o modelo que a skill descreve fecha o aprendizado pedido (T8 dá o CLI) antes de seguir
    const r = bash(`node "${LOOP}" ${args.join(' ')}`);
    let j = null;
    try { j = JSON.parse(r.out); } catch { /* sem JSON */ }
    if (j === null) { def(`loop ${args.join(' ')}: sem JSON (rc ${r.rc}) ${String(r.err).slice(0, 120)}`); return { ok: false, erro: 'sem_json', mensagem: String(r.err) }; }
    trilha.push(`  loop ${args.join(' ')} -> ${j.ok ? (j.acao ? JSON.stringify(j.acao).slice(0, 200) : 'ok') : `FALHA ${j.erro}: ${String(j.mensagem).slice(0, 140)}`}`);
    if (!j.ok) {
      if (previsto(j)) previstos.push(`${args.join(' ')} -> ${j.erro}`);
      else def(`loop ${args.join(' ')}: ${j.erro}: ${String(j.mensagem).slice(0, 200)}`);
    }
    return j;
  }

  // ── host do mod ($ mínimo) ─────────────────────────────────────
  const mundo = { percent: null, agentes: [], store: new Map(), clears: 0, submits: [], avisos: [], agendado: null, clearAgora: false, denies: [] };
  const modArquivo = o.semReabrir ? modSemReabrir(join(o.tmp, 'mod-sem-reabrir')) : (o.mod ?? join(PLUGIN, 'mod/gabarito.mjs')); // `mod`: outro gabarito.mjs (validar a regra da T19 r2 antes de ela chegar)
  const { register } = await import(pathToFileURL(modArquivo).href);
  const H = {};
  register((ev, a, b) => { H[ev] = b ?? a; });
  const $ = {
    plugin: { root: PLUGIN },
    session: { root: async () => REAL, repo: async () => ({ root: REAL }), id: async () => 'S1', usage: async () => ({ context: mundo.percent === null ? {} : { percent: mundo.percent } }) },
    env: { get: async (k) => (k === 'GABARITO_POUSO_X' ? o.x : undefined) },
    store: { get: async (k) => mundo.store.get(k), set: async (k, v) => { mundo.store.set(k, v); }, delete: async (k) => { mundo.store.delete(k); } },
    ui: { toast: async (t) => { mundo.avisos.push(t); trilha.push(`  mod aviso: ${t.slice(0, 150)}`); }, log: () => {} },
    process: { run: async (argv, op = {}) => { const r = spawnSync(argv[0], argv.slice(1), { cwd: op.cwd, input: op.stdin, encoding: 'utf8', env: ambiente() }); return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr }; } },
    fs: { exists: async (p) => existsSync(p), write: async (p, t) => { writeFileSync(p, t); } },
    clock: { now: async () => Date.now(), after: (_ms, fn) => { mundo.agendado = fn; }, every: () => {} },
    command: { register: async () => {}, run: async ({ command }) => { if (command === 'clear') { mundo.clears++; mundo.percent = null; mundo.clearAgora = true; } } },
    prompt: { submit: async ({ text }) => { mundo.submits.push(text); return {}; } },
    agent: { list: async () => mundo.agentes.map((a) => ({ id: a.id, status: a.status, type: a.tipo })) },
  };
  await H['session.start']($, { isInteractive: true }, async (e) => e);

  const uso = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 10 };
  async function fimTurnoMod() {
    trilha.push('  turn.complete');
    await H['turn.complete']($, { reason: 'answer', isAborted: false, usage: uso }, async (e) => e);
    if (mundo.agendado) { const f = mundo.agendado; mundo.agendado = null; await f(); await new Promise((r) => setImmediate(r)); }
  }
  /** Stop real (`stop-loop.mjs`). */
  function stop() {
    const vivos = mundo.agentes.filter((a) => a.status === 'running');
    const entrada = { session_id: 'S1', cwd: REAL, hook_event_name: 'Stop', background_tasks: vivos.map((a) => ({ type: 'subagent', id: a.id })) };
    const r = spawnSync(NODE, [join(PLUGIN, 'gates/scripts/stop-loop.mjs')], { cwd: REAL, input: JSON.stringify(entrada), encoding: 'utf8', env: ambiente({ CLAUDE_PROJECT_DIR: REAL }) });
    if (r.status !== 0) def(`stop-loop rc ${r.status}: ${String(r.stderr).slice(0, 120)}`);
    let j = null;
    try { j = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { def('stop-loop saída não JSON'); }
    trilha.push(`  Stop -> ${j ? `${j.decision ?? ''} ${(j.reason ?? j.systemMessage ?? '').slice(0, 120)}` : 'silêncio'}`);
    return j;
  }
  async function toolAgent(tipo) {
    if (guarda('Agent', { subagent_type: tipo, prompt: 'ponteiros' })) return { negado: 'guarda' };
    const r = await H['tool.call']($, { tool: 'Agent', subagent_type: tipo }, async () => ({ ok: true }));
    if (r?.deny) { mundo.denies.push(r.deny); trilha.push(`  Agent ${tipo} NEGADO: ${r.deny.slice(0, 120)}`); return { negado: r.deny }; }
    trilha.push(`  Agent ${tipo} aceito`);
    return {};
  }

  // ── o que cada subagent faz, pelos adaptadores reais ───────────
  let nAg = 0;
  const memoria = { rodada: {} }; // o /clear zera
  const achadosVistos = new Set();
  const vistos = { vazioFeito: false, specs: 0, achados: 0, mutacoesVermelhas: 0, retomadas: [] };
  const wtDe = (task) => join(REAL, '.harness/worktrees', task);
  // TMPDIR da task: o que o `abrir` devolveu em `env`, nunca um caminho escrito à mão (D2). `tmpdirAntigo` é o controle: o caminho da r6.
  const tmpDaTask = {};
  const tmpDe = (task) => (o.tmpdirAntigo === true ? join(wtDe(task), '.tmp-gabarito') : tmpDaTask[task]);

  function trabalhoImplementador(ag) {
    const wt = wtDe(ag.task);
    const t = TEMPLATE[ag.task];
    const correcao = ag.papel === 'correcao';
    for (const [f, c] of [[t.teste, t.casos], [t.src, t.codigo + (correcao ? '// corrigido\n' : '')]]) {
      const alvo = join(wt, f);
      if (guarda('Write', { file_path: alvo, content: c }, ag)) { ag.falhou = true; return; }
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, c);
    }
    const tst = bash(`cd "${wt}" && TMPDIR="${tmpDe(ag.task)}" npm test`, ag);
    if (tst.rc !== 0) def(`implementador npm test rc ${tst.rc}: ${(tst.out + tst.err).slice(-200)}`);
    const r = bash(`cd "${wt}" && git add -A && git commit -q -m "feat(GM-99): ${ag.task} ${ag.papel}" && git status --short && git log --oneline -2`, ag);
    if (r.rc !== 0) { def(`implementador commit rc ${r.rc}: ${r.err}`); ag.falhou = true; }
    // T24: o implementador confere as worktrees; `git worktree list` passa pela guarda real, sem deny.
    const lista = bash(`git worktree list`, ag);
    if (lista.rc !== 0 || !lista.out.includes(wt)) def(`implementador git worktree list rc ${lista.rc}, sem ${wt}: ${lista.err}`);
  }

  /** O revisor grava os achados da rodada; com `achadosVazios` a 1ª gravação vem vazia (a CLI tem que recusar o REPROVADO). */
  function gravarAchados(ag, caminho, vazio = false) {
    const texto = vazio ? '' : `achados ${ag.task}: mutação sobreviveu\n`;
    if (guarda('Write', { file_path: caminho, content: texto }, ag)) { def('revisor não grava achados em .tmp-gabarito'); return; }
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(caminho, texto);
  }

  const leituras = {};
  /** O revisor lê, muta, roda a suíte, reverte e (REPROVADO) grava os achados da rodada que o orquestrador acha que é. */
  function trabalhoRevisor(ag, veredito, rodada) {
    const wt = wtDe(ag.task);
    for (const l of LEITURAS_REVISOR) {
      const r = spawnSync(NODE, [join(PLUGIN, 'gates/dist/guarda.js')], {
        cwd: REAL,
        input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'S1', cwd: REAL, tool_name: 'Bash', tool_input: { command: `cd "${wt}" && ${l}` }, agent_id: ag.id, agent_type: ag.tipo }),
        encoding: 'utf8', env: ambiente({ ...envBase, CLAUDE_PROJECT_DIR: REAL }),
      });
      leituras[l] = r.stdout.includes('"deny"') ? 'deny' : r.stdout.includes('"ask"') ? 'ask' : 'passa';
    }
    const t = TEMPLATE[ag.task];
    const alvo = join(wt, t.src);
    const orig = readFileSync(alvo, 'utf8');
    if (!orig.includes(t.mutar[0])) def(`revisor: ${t.src} sem o trecho a mutar`);
    if (guarda('Edit', { file_path: alvo, old_string: t.mutar[0], new_string: t.mutar[1] }, ag)) def('revisor não muta');
    writeFileSync(alvo, orig.replace(t.mutar[0], t.mutar[1]));
    const vermelho = bash(`cd "${wt}" && TMPDIR="${tmpDe(ag.task)}" npm test`, ag);
    if (vermelho.rc === 0) def(`revisor: mutação de ${t.src} não derrubou a suíte (o trabalho da task não é real)`); else vistos.mutacoesVermelhas++;
    const rv = bash(`cd "${wt}" && git checkout -- "${t.src}" && git diff --stat`, ag);
    if (rv.rc !== 0) def(`revisor checkout rc ${rv.rc}`);
    if (veredito === 'REPROVADO') gravarAchados(ag, join(wt, '.tmp-gabarito', `review-r${rodada}.md`), o.achadosVazios === true && !vistos.vazioFeito && (vistos.vazioFeito = true));
  }

  function despachado(tipo, task, papel) {
    const ag = { id: `a${++nAg}`, tipo, task, papel, status: 'running' };
    mundo.agentes.push(ag);
    return ag;
  }

  // ── o modelo seguindo a skill ──────────────────────────────────
  const TIPO = { implementador: 'gabarito-mestre:gabarito-implementador', correcao: 'gabarito-mestre:gabarito-implementador', revisor: 'gabarito-mestre:gabarito-revisor' };
  const vivos = () => mundo.agentes.filter((a) => a.status === 'running').length;

  let esqueceu = false; let orfa = null;
  async function despachar(item) {
    const { task, papel } = item;
    // spec vem de `proxima` (ponteiro do topo do plano), em todo item: o /clear apaga o que o modelo sabia
    if (item.spec === 'docs/spec-gm99.md') vistos.specs++;
    else def(`item ${task} ${papel} sem o spec do topo do plano: ${JSON.stringify(item.spec)}`);
    if (papel === 'correcao') {
      // D2: o /clear apaga o que o revisor disse; o item carrega o caminho e o arquivo tem que existir e ter texto (conta por rodada, não por despacho)
      if (typeof item.achados === 'string' && !new RegExp(`/\\.harness/worktrees/${task}/\\.tmp-gabarito/review-r\\d+\\.md$`).test(item.achados)) def(`correcao ${task}: achados fora de .tmp-gabarito/review-r<rodada>.md da worktree: ${item.achados}`);
      if (typeof item.achados === 'string' && existsSync(item.achados) && readFileSync(item.achados, 'utf8').trim() !== '') { achadosVistos.add(item.achados); vistos.achados = achadosVistos.size; }
      else def(`correcao ${task} sem achados legíveis no item (${JSON.stringify(item.achados)})`);
    }
    if (papel !== 'revisor') {
      const a = cli(['abrir', task]); // SKILL: `abrir` SEMPRE, antes de implementador e correcao (idempotente)
      if (!a.ok) return 'parar';
      if (typeof a.env?.TMPDIR === 'string') tmpDaTask[task] = a.env.TMPDIR;
      else def(`abrir ${task} sem env.TMPDIR`);
    }
    if (o.ordem === 'corrida') {
      // lote: Agent e iniciar na mesma mensagem; o iniciar entra mesmo com o Agent negado
      const r = await toolAgent(TIPO[papel]);
      const i = cli(['iniciar', task, papel]);
      if (!i.ok) return 'parar';
      if (r.negado) return 'negado';
    } else {
      const i = cli(['iniciar', task, papel]);
      if (!i.ok) return 'parar';
      if (o.esquece === task && !esqueceu) {
        // T13 r6: um hand-back entra entre `iniciar` e `Agent`; o modelo trata o hand-back e nunca lança o Agent
        esqueceu = !o.esqueceSempre; orfa = task; trilha.push(`  ${task}: iniciar sem Agent (hand-back no meio)`);
        if (o.pausa) writeFileSync(join(REAL, '.harness/PAUSAR'), 'pausado pelo dono\n'); // `esquece-com-pausa`: o dono pausa antes do fim do turno
        return 'esqueceu';
      }
      let r = await toolAgent(TIPO[papel]);
      if (r.negado && o.repete) r = await toolAgent(TIPO[papel]); // insiste depois do deny
      if (r.negado) return 'negado';
    }
    despachado(TIPO[papel], task, papel);
    return 'ok';
  }

  /** Trata os hand-backs de quem está vivo, um a um, sem voltar a pensar na task esquecida (run-1). */
  async function drenar() {
    for (const ag of mundo.agentes.filter((a) => a.status === 'running')) {
      await terminar(ag);
      const e = await processar(ag);
      if (e) return e;
      for (let i = 0; i < 4; i++) {
        const p = cli(['proxima', '--vivos', String(vivos() + 1)]);
        if (p.acao?.tipo === 'integrar') { for (const t of p.acao.tasks) cli(['integrar', t]); continue; }
        break;
      }
    }
    return null;
  }
  async function ciclo() {
    for (let i = 0; i < 25; i++) {
      const p = cli(['proxima', '--vivos', String(vivos())]);
      if (!p.ok) return { fim: `ok:false ${p.erro}` };
      const a = p.acao;
      if (a.tipo === 'despachar') {
        let parou = null; let negou = false;
        for (const it of a.itens) {
          const r = await despachar(it);
          if (r === 'negado' && o.lote) { negou = true; continue; } // lote: o modelo despacha o resto da mensagem mesmo com um Agent negado
          if (r !== 'ok') { parou = r; break; }
        }
        if (parou === 'esqueceu') { const e2 = await drenar(); if (e2) return { fim: e2 }; const pp = cli(['proxima', '--vivos', String(vivos() + 1)]); return { encerra: `crê que ${orfa} roda: ${pp.acao?.tipo}` }; }
        if (parou === 'negado' || (negou && parou === null)) return { encerra: 'Agent negado', negou: true };
        if (parou) return { fim: 'parar' };
        if (a.itens.length === 0) return { encerra: 'sem itens' };
        if (vivos() >= (p.sinais?.slots ?? 1)) return { encerra: 'slots cheios' };
        continue;
      }
      if (a.tipo === 'integrar') {
        for (const t of a.tasks) {
          const r = cli(['integrar', t]);
          if (!r.ok) return { fim: 'integrar falhou' };
        }
        continue;
      }
      if (a.tipo === 'esperar') return { encerra: `esperar ${a.motivo}` };
      if (a.tipo === 'concluir') return { fim: 'concluir' };
      if (a.tipo === 'parar') return { fim: `parar ${a.motivo}${a.task ? ` ${a.task}` : ''}` };
      if (a.tipo === 'pousar') return { encerra: 'pousar' };
    }
    return { fim: 'ciclo sem fim' };
  }

  /** O agente avisa que acabou: `turn.complete` do subagent, depois o que o orquestrador faz com o resultado. */
  async function terminar(ag) {
    // implementador trabalha antes de avisar; o revisor precisa do veredito e da rodada para gravar os achados
    if (ag.papel === 'revisor') {
      ag.veredito = (o.vereditos[ag.task] ?? []).shift() ?? 'APROVADO';
      ag.rodada = memoria.rodada[ag.task] ?? 1;
      trabalhoRevisor(ag, ag.veredito, ag.rodada);
    } else {
      trabalhoImplementador(ag);
    }
    ag.status = 'completed';
    await H['turn.complete']($, { agentId: ag.id, reason: 'answer', isAborted: false, usage: uso }, async (e) => e);
    mundo.percent = o.percent;
    trilha.push(`  agente ${ag.id} ${ag.task} ${ag.papel} terminou`);
  }
  async function peer() { if (H['prompt.submit']) await H['prompt.submit']($, { origin: { kind: 'peer' }, text: 'hand-back' }, async (e) => e); }
  async function handback(ag) {
    await terminar(ag);
    return processar(ag);
  }
  /** O que o orquestrador faz com o resultado de um agente que já terminou (`concluir` ou `veredito`). */
  async function processar(ag) {
    const veredito = ag.veredito; let rodada = ag.rodada;
    await peer();
    trilha.push(`  hand-back ${ag.id} ${ag.task} ${ag.papel}`);
    if (ag.falhou) return `${ag.papel} falhou`;
    if (ag.papel !== 'revisor') {
      const r = cli(['concluir', ag.task]);
      return r.ok ? null : `concluir falhou ${r.erro}`;
    }
    const args = (n) => ['veredito', ag.task, veredito, String(n), '0', veredito === 'APROVADO' ? '0' : '1'];
    const rodadaEsperada = (j) => j.erro === 'transicao_invalida' && /rodada esperada: \d+/.test(j.mensagem ?? '');
    const achadosAusentes = (j) => j.erro === 'achados_ausentes';
    const previsto = (j) => rodadaEsperada(j) || achadosAusentes(j);
    // a skill manda: rodada errada ⇒ a esperada que a mensagem diz (D6); achados ausentes ⇒ gravar no caminho nomeado e repetir
    let r = cli(args(rodada), previsto);
    for (let tentativa = 0; tentativa < 3 && !r.ok; tentativa++) {
      if (rodadaEsperada(r)) rodada = Number(/rodada esperada: (\d+)/.exec(r.mensagem)[1]);
      else if (achadosAusentes(r)) gravarAchados(ag, r.achados);
      else break;
      r = cli(args(rodada), previsto);
    }
    if (!r.ok) return `veredito falhou ${r.erro}`;
    memoria.rodada[ag.task] = rodada + 1;
    return null;
  }

  /** Depois do /clear: a memória do modelo vai embora e o cartão de sessão é o que resta. */
  function aposClear(percent) {
    memoria.rodada = {};
    const c = spawnSync('bash', [join(PLUGIN, 'hooks/session-card.sh')], { cwd: REAL, input: JSON.stringify({ source: 'clear', session_id: 'S1', cwd: REAL }), encoding: 'utf8', env: ambiente({ CLAUDE_PROJECT_DIR: REAL, CLAUDE_PLUGIN_ROOT: PLUGIN }) });
    if (c.status !== 0) def(`cartão de sessão rc ${c.status}`);
    trilha.push(`  /clear, cartão ${(c.stdout ?? '').length} chars`);
    mundo.percent = percent; // depois do /clear o contexto é pequeno
  }

  // ── o dono (REQ-LOOP-2): `/gabarito-mestre:liberar T1` pelo hook real, com o stdin do TUI (spike A1) ──
  const liberacao = { reabrirSegueNoTeto: null, subagentBloqueado: null, diarioIgual: null, liberou: null, proximaDepois: null };
  const bytesDiario = () => readdirSync(DIR).filter((n) => /^events\./.test(n)).sort().map((n) => readFileSync(join(DIR, n), 'utf8')).join('\u0000');
  function donoLibera(task) {
    const tui = { session_id: 'S-dono', cwd: REAL, hook_event_name: 'UserPromptExpansion', command_name: 'gabarito-mestre:liberar', command_args: task, command_source: 'plugin' };
    const hook = (extra) => {
      const r = spawnSync(NODE, [join(PLUGIN, 'gates/scripts/liberar-teto.mjs')], { input: JSON.stringify({ ...tui, ...extra }), cwd: REAL, encoding: 'utf8', env: ambiente(envBase) });
      let j = null;
      try { j = r.stdout.trim() === '' ? null : JSON.parse(r.stdout); } catch { def('liberar-teto saída não JSON'); }
      trilha.push(`  dono /gabarito-mestre:liberar ${task}${extra?.agent_id ? ' (com agent_id)' : ''} -> rc ${r.status} ${j?.decision ?? 'sem block'} ${(j?.reason ?? j?.systemMessage ?? '').slice(0, 110)}`);
      return { rc: r.status, j };
    };
    const reabriu = cli(['reabrir', task]); // o modelo tenta sair do teto por conta própria: continua no teto
    liberacao.reabrirSegueNoTeto = reabriu.ok && cli(['proxima', '--vivos', '0']).acao?.motivo === 'teto_rodadas';
    const antes = bytesDiario();
    const vindoDeSubagent = hook({ agent_id: 'a-fantasma', agent_type: 'gabarito-mestre:gabarito-implementador' });
    liberacao.subagentBloqueado = vindoDeSubagent.rc === 0 && vindoDeSubagent.j?.decision === 'block';
    liberacao.diarioIgual = bytesDiario() === antes;
    const dono = hook({});
    liberacao.liberou = dono.rc === 0 && dono.j?.decision !== 'block';
    const p = cli(['proxima', '--vivos', '0']).acao;
    liberacao.proximaDepois = p ? `${p.tipo} ${(p.itens ?? []).map((i) => `${i.task} ${i.papel}`).join(',')}` : null;
    if (!(liberacao.reabrirSegueNoTeto && liberacao.subagentBloqueado && liberacao.diarioIgual && liberacao.liberou)) def(`liberação do dono fora do previsto: ${JSON.stringify(liberacao)}`);
  }

  let turno = 0; let fim = null; let blocks = 0; let escFeito = false; let pendenteFeito = false; let liberou = false;
  const pendentes = []; let submitsVistos = 0;
  mundo.percent = o.percent; // 1ª resposta define o percent
  trilha.push(`T${turno} prompt do dono`);
  let r = await ciclo();
  while (turno < o.maxTurnos) {
    if (r.fim) fim = r.fim;
    if (o.esc && !escFeito && r.negou) {
      // Esc do dono logo depois da negação: sem Stop, turn.complete abortado (o mod não decide e a contagem fica); o dono dá /clear com contexto baixo
      escFeito = true;
      trilha.push('  Esc do dono (turn.complete abortado)');
      await H['turn.complete']($, { reason: 'answer', isAborted: true, usage: uso }, async (e) => e);
      turno++;
      aposClear(0.5);
      r = await ciclo();
      if (o.escTermina) {
        // escT3Terminou: o despacho aceito depois do /clear termina ANTES do fim do turno; o hand-back só chega no turno seguinte (a negação não pode cair nele)
        for (const ag of mundo.agentes.filter((a) => a.status === 'running')) { await terminar(ag); pendentes.push(ag); }
        mundo.percent = 0.5;
      }
      continue;
    }
    const s = stop();
    if (s?.decision === 'block') {
      // `block` = o modelo continua no mesmo turno: NÃO há turn.complete (é o que a sessão real ainda tem que medir)
      blocks++;
      trilha.push(`  (block: modelo continua, mesmo turno) ${r.encerra ?? r.fim}`);
      fim = null;
      if (blocks > 12) { fim = 'block sem fim'; break; }
      // F1: aqui NÃO há turn.complete (o block segura o fim de turno)
      r = await ciclo();
      continue;
    }
    if (o.pendente && !pendenteFeito && r.negou) {
      // hand-back a caminho: o agente aceito já terminou (vivos 0) mas o orquestrador ainda não processou o resultado
      pendenteFeito = true;
      for (const ag of mundo.agentes.filter((a) => a.status === 'running')) { await terminar(ag); pendentes.push(ag); }
    }
    await fimTurnoMod();
    if (fim && !mundo.clearAgora && o.liberar && !liberou && /^parar teto_rodadas/.test(fim)) {
      // o dono digita o comando; o corpo da skill manda o modelo consultar `proxima`, e o ciclo segue
      liberou = true;
      const liberada = fim.split(' ')[2];
      donoLibera(liberada);
      fim = null;
      turno++;
      trilha.push(`T${turno} o dono liberou ${liberada}; o modelo consulta proxima`);
      r = await ciclo();
      continue;
    }
    // T31: `parar` do modelo com turno aberto pelo mod (recuperação da órfã que esperou o `liberar`) não encerra: o turno novo continua o ciclo
    const modAbriu = /^parar /.test(fim ?? '') && mundo.submits.length > submitsVistos;
    if (fim && !mundo.clearAgora && !modAbriu) break; // um pouso agendado muda o fim: o /clear reabre o turno
    fim = null;
    turno++;
    if (mundo.clearAgora) {
      mundo.clearAgora = false;
      submitsVistos = mundo.submits.length;
      vistos.retomadas.push(mundo.submits.at(-1) ?? '');
      trilha.push(`T${turno} /clear + retomada (${mundo.submits.at(-1)?.length} chars)`);
      aposClear(3);
      r = await ciclo();
      continue;
    }
    if (mundo.submits.length > submitsVistos) {
      submitsVistos = mundo.submits.length;
      trilha.push(`T${turno} turno aberto pelo mod: ${mundo.submits.at(-1).slice(0, 80)}`);
      r = await ciclo();
      continue;
    }
    const pend = pendentes.shift();
    if (pend !== undefined) {
      trilha.push(`T${turno} processa o hand-back pendente de ${pend.id}`);
      const e = await processar(pend);
      if (e) { fim = e; break; }
      r = await ciclo();
      continue;
    }
    if (o.juntos !== undefined && turno >= o.juntos && mundo.agentes.filter((a) => a.status === 'running').length > 1) {
      // vários agentes terminaram antes do orquestrador agir: todos os resultados entram no mesmo turno
      trilha.push(`T${turno} notificações juntas`);
      let falha = null;
      for (const ag of mundo.agentes.filter((a) => a.status === 'running')) falha = falha ?? (await handback(ag));
      if (falha) { fim = falha; break; }
      r = await ciclo();
      continue;
    }
    const prox = mundo.agentes.find((a) => a.status === 'running');
    if (prox === undefined) { fim = `parou: ${r.encerra ?? '?'} sem agente vivo, sem retomada`; break; }
    trilha.push(`T${turno} notificação de ${prox.id}`);
    const e = await handback(prox);
    if (e) { fim = e; break; }
    if (o.paraAposHandback) { r = { encerra: 'modelo parou sem agir' }; continue; }
    r = await ciclo();
  }

  const stopFinal = o.liberar ? stop() : undefined; // Stop em `concluir`: lista as liberações ao dono
  // ── leitura depois da corrida ──────────────────────────────────
  const eventos = readdirSync(DIR).filter((n) => /^events\./.test(n)).flatMap((n) => readFileSync(join(DIR, n), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const ord = eventos.slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq));
  const contar = {};
  for (const e of eventos) contar[e.tipo] = (contar[e.tipo] ?? 0) + 1;
  // cada pouso precisa de veredito novo desde o pouso anterior
  const pousosSemVeredito = [];
  let desde = 0;
  ord.forEach((e) => {
    if (e.tipo === 'review.veredito') desde++;
    if (e.tipo === 'sessao.pouso') { if (desde === 0) pousosSemVeredito.push(e.ts); desde = 0; }
  });
  fechar();
  const final = spawnSync(NODE, [LOOP, 'proxima', '--vivos', '0'], { cwd: REAL, encoding: 'utf8', env: ambiente(envBase) });
  let acaoFinal = null;
  try { acaoFinal = JSON.parse(final.stdout).acao; } catch { def('proxima final sem JSON'); }
  return {
    fim, turnos: turno, blocks, clears: mundo.clears, pouso: contar['sessao.pouso'] ?? 0, retomada: contar['sessao.retomada'] ?? 0,
    parar: eventos.filter((e) => e.tipo === 'loop.parar').map((e) => e.dados.motivo),
    reabertasDe: eventos.filter((e) => e.tipo === 'task.reaberta').map((e) => e.dados.task), integradas: contar['task.integrada'] ?? 0, vereditos: contar['review.veredito'] ?? 0, reabertas: contar['task.reaberta'] ?? 0,
    denies: mundo.denies.length, submits: mundo.submits.length, guarda: contagem, defeitos, previstos, pousosSemVeredito, leituras, vistos: { ...vistos, retomadas: vistos.retomadas.length },
    retomadaTexto: vistos.retomadas[0] ?? null, proximaFinal: acaoFinal, avisos: mundo.avisos,
    liberacao, stopFinal,
    tipos: ord.map((e) => e.tipo).filter((t) => !/^(custo\.|guarda\.|sessao\.inicio)/.test(t)), trilha,
  };
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const saida = await caminhar(JSON.parse(process.argv[2]));
  process.stdout.write(JSON.stringify(saida));
}

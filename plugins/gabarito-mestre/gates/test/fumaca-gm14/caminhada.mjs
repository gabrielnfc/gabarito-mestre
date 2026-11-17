/**
 * Caminhadas sem LLM da 2.1.0 (GM-14 T23, P9): o produto inteiro da clareza, pelos CLIs REAIS e por `dist/`, em repositórios git descartáveis.
 *
 * REAL: `painel.mjs` (estado, texto, medir), `loop.mjs` (anotar, abrir, iniciar, concluir, veredito, integrar, descoberta, aprendizado, proxima),
 * `aprovar-spec.mjs` e `responder.mjs` (hooks, com o stdin do TUI), e a ponte do mod (`codigoPonte` de `dist/pouso.js`, a mesma que o mod passa ao `node -e`)
 * para o `dono.mensagem`. O `gh` é um EXECUTÁVEL de fixture no PATH (estado num arquivo que a caminhada troca): nenhuma rede.
 * SIMULADO: o modelo (o script faz o que a skill mandaria), a suíte do gate (`echo '# pass 1'`), o mod desenhando (não entra: só o node prova a costura).
 *
 * Quatro caminhadas, cada uma em seu repositório: `setefases` (REQ-TRI-1, REQ-DEP-1, REQ-DIA-1/2, REQ-PRG-1, REQ-GLB-1, FIEL-10), `pergunta`
 * (REQ-DIA-2, REQ-PRG-1, REQ-LNG-1), `sentinela` (REQ-DIA-1: texto do dono nunca em `.harness/`) e `aprendizado` (REQ-APR-5: extrato, cópia por `git ls-files`).
 *
 * RELÓGIO: cada filho roda com `--import` de um módulo `data:` que fixa `Date` em `FUMACA_AGORA`; o script avança 60 s por chamada. `TZ=UTC`.
 * NÃO COBRE: o mod desenhando o texto, o dono digitando no TUI, a sessão real com LLM.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, mkdtempSync, realpathSync, rmSync, readFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as diario from '../../dist/diario.js';
import { codigoPonte } from '../../dist/pouso.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GATES = join(AQUI, '..', '..');
const SCRIPTS = join(GATES, 'scripts');
const DIST_DIARIO = join(GATES, 'dist', 'diario.js');
const FIXTURE_TRANSCRIPT = join(AQUI, '..', 'fixtures', 'transcript-agente.jsonl');
const NODE = process.execPath;
export const PREFIXO = 'fumaca-gm14-';

/** 2026-11-12 12:00:00 UTC. */
export const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const PASSO_MS = 60_000;
/** Texto que o dono "digitou": não pode aparecer em nenhum byte de `.harness/` (REQ-DIA-1). */
export const SENTINELA = 'SENTINELA-do-dono-8f3a1c';

const RELOGIO = `data:text/javascript,${encodeURIComponent(
  'const B=Number(process.env.FUMACA_AGORA);if(Number.isFinite(B)){const R=Date;globalThis.Date=class extends R{constructor(...a){if(a.length===0)super(B);else super(...a)}static now(){return B}}}',
)}`;

/**
 * `gh` de fixture: lê o estado de `GH_FIXTURE` (`{branch, pr:[{number,state}], release:[{tagName}]}`); `GH_FIXTURE_FALHA=1` ⇒ rc 1. Só `pr list` e `release list`.
 * Recusa argumento inesperado (REQ-DIA-1: `gh pr list --head <branch>`): com `branch` no estado, `pr list` sem `--head=<branch>` ⇒ rc 2, e o PR de outra branch nunca entra.
 */
const GH_FALSO = `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const a = process.argv.slice(2);
if (process.env.GH_FIXTURE_FALHA === '1') { process.stderr.write('gh de fixture: falha pedida\\n'); process.exit(1); }
let est;
try { est = JSON.parse(readFileSync(process.env.GH_FIXTURE, 'utf8')); } catch { process.stderr.write('gh de fixture sem estado\\n'); process.exit(1); }
// GM-15 T4: a busca por título (--search) não tem PR na fixture => []; pr view <n> devolve o PR do estado.
if (a[0] === 'pr' && a[1] === 'list' && a.includes('--search')) { process.stdout.write('[]'); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'view') {
  const p = (est.pr ?? []).find((x) => String(x.number) === a[2]);
  if (!p) { process.stderr.write('no pull requests found\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(p)); process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'list') {
  if (est.branch !== undefined && !a.includes('--head=' + est.branch)) { process.stderr.write('gh de fixture: pr list sem --head=' + est.branch + ': ' + a.join(' ') + '\\n'); process.exit(2); }
  process.stdout.write(JSON.stringify(est.pr ?? [])); process.exit(0);
}
if (a[0] === 'release' && a[1] === 'list') { process.stdout.write(JSON.stringify(est.release ?? [])); process.exit(0); }
process.stderr.write('gh de fixture: comando não previsto: ' + a.join(' ') + '\\n');
process.exit(2);
`;

function ambiente(agora, extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') || k.startsWith('NODE_TEST') || k === 'NODE_OPTIONS') continue;
    e[k] = v;
  }
  return {
    ...e, TZ: 'UTC', LANG: 'C.UTF-8', FUMACA_AGORA: String(agora),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GABARITO_CAP_HOSTNAME: 'host-fumaca', GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0',
    ...extra,
  };
}

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', env: ambiente(T0), stdio: ['ignore', 'pipe', 'pipe'] });

/** Repositório descartável em `<tmp>/fumaca-gm14-XXXX/<nome com espaço>`, na branch `main`, com `origin` bare e o `gh` de fixture no PATH. */
function montar(base, nome, { config = {} } = {}) {
  const dir = join(base, nome);
  const bare = join(base, `${nome}-origin.git`);
  const bin = join(base, 'bin');
  mkdirSync(dir, { recursive: true });
  mkdirSync(bare);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), GH_FALSO);
  chmodSync(join(bin, 'gh'), 0o755);
  const ghEstado = join(base, `${nome}-gh.json`);
  writeFileSync(ghEstado, JSON.stringify({ pr: [], release: [] }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'projeto de fumaça\n');
  writeFileSync(join(dir, '.gitignore'), '.harness/*\n!.harness/entregas/\n.harness/entregas/*/*\n!.harness/entregas/*/registro.md\n!.harness/aprendizados.jsonl\n');
  writeFileSync(join(dir, 'harness.config.json'), `${JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 3 }, entrega: { politica: 'continua', autonomia: true, base: 'main', ...config } })}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: base');
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  mkdirSync(join(dir, '.harness'), { recursive: true });
  writeFileSync(join(dir, '.harness', 'capacidade.json'), JSON.stringify({ hostname: 'host-fumaca', slots_max: 3, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 }));

  let agora = T0;
  const rodar = (script, args, input, extraEnv = {}) => {
    agora += PASSO_MS;
    const env = ambiente(agora, { PATH: `${bin}:${process.env.PATH}`, GH_FIXTURE: ghEstado, ...extraEnv });
    const r = spawnSync(NODE, ['--import', RELOGIO, join(SCRIPTS, script), ...(script === 'painel.mjs' ? armarLoop(dir, args, input, agora) : args)], { cwd: dir, encoding: 'utf8', env, input, timeout: 120_000 });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* texto do painel ou vazio */ }
    return { rc: r.status, j, out: r.stdout, err: r.stderr };
  };
  const gh = (estado) => writeFileSync(ghEstado, JSON.stringify(estado));
  return { dir, bare, bin, rodar, gh, agoraMs: () => agora };
}


/**
 * GM-15 T19: a fumaça não é sobre o loop, então arma o sinal do loop da sessão do painel (forma do mod: gabarito.mjs `interpretarSinalLoop`, `em` no relógio congelado do passo)
 * antes de `estado`/`texto`; sem ele a régua do Stop trata o loop como desligado e o painel avisa "ligar o loop". Sem `session_id` no stdin, passa `--sessao S-loop`.
 */
function armarLoop(dir, args, input, agora) {
  if (args[0] !== 'estado' && args[0] !== 'texto') return args;
  let sessao = null;
  try { const j = JSON.parse(input ?? ''); sessao = j?.session_id ?? j?.sessao?.session_id ?? null; } catch { /* sem stdin JSON */ }
  const flag = args.indexOf('--sessao');
  if (flag >= 0) sessao = args[flag + 1];
  const comFlag = sessao === null ? 'S-loop' : null;
  const id = sessao ?? 'S-loop';
  mkdirSync(join(dir, '.harness', 'contexto'), { recursive: true });
  writeFileSync(join(dir, '.harness', 'contexto', `loop-dinamico.${id}.json`), `${JSON.stringify({ estado: 'armado', intervalo: 0, dinamico: 1, sessao: id, em: new Date(agora).toISOString() })}\n`);
  return comFlag === null ? args : [...args, '--sessao', comFlag];
}

function ok(res, rotulo) {
  if (res.rc !== 0 || res.j?.ok !== true) throw new Error(`${rotulo}: rc ${res.rc} ${res.out} ${res.err}`);
  return res;
}

/** stdin que o TUI manda ao hook `UserPromptExpansion` (medido no spike A1, 2.1.318). */
const stdinTui = (dir, comando, args = '', sessao = 'S-dono') => JSON.stringify({ session_id: sessao, cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: comando, command_args: args, command_source: 'plugin' });

/** Todo byte de `.harness/` (arquivos regulares, recursivo; worktrees fora) concatenado por caminho relativo. */
export function bytesDoHarness(dir) {
  const saida = {};
  const raiz = join(dir, '.harness');
  const ir = (d) => {
    for (const nome of readdirSync(d)) {
      if (d === raiz && nome === 'worktrees') continue;
      const p = join(d, nome);
      if (statSync(p).isDirectory()) ir(p);
      else saida[p.slice(raiz.length + 1)] = readFileSync(p, 'utf8');
    }
  };
  ir(raiz);
  return saida;
}

const ENTRADA_MOD = (sessao, extra = {}) => JSON.stringify({ session_id: sessao, sessao: { session_id: sessao, percent: 30, tokens: 60_000, window: 200_000, x: 50 }, agentes: [], ...extra });

/** Um passo da trilha: o que `estado` e `texto` (80 colunas, esquadrão e mono) dizem, tirados no mesmo instante. */
function passo(a, nome, sessao = 'S1') {
  const mod = ENTRADA_MOD(sessao);
  const estado = ok(a.rodar('painel.mjs', ['estado', '--agentes'], mod), `estado ${nome}`).j.estado;
  const t = a.rodar('painel.mjs', ['texto', '--preset', 'esquadrao', '--largura', '80', '--tema', 'mono', '--agentes'], mod);
  if (t.rc !== 0) throw new Error(`texto ${nome}: rc ${t.rc} ${t.out} ${t.err}`);
  return { nome, estado, texto: t.out, linhas: t.out.split('\n').filter((l) => l !== '') };
}


// ─── 1. as sete fases ───

function setefases(base) {
  const a = montar(base, 'sete fases');
  const loop = (...args) => a.rodar('loop.mjs', args);
  const medir = (sessao = 'S1') => ok(a.rodar('painel.mjs', ['medir', '--agentes'], ENTRADA_MOD(sessao)), 'medir');
  const o = { dir: a.dir, passos: {}, eventos: null };

  // 0. repo sem nenhuma entrega no diário
  o.passos.semEntrega = passo(a, 'sem entrega');

  // 1. ideia: a nota entra sem plano; a entrega só existe com branch com ID e um 2º fato (REQ-TRI-1)
  ok(loop('anotar', '--tipo', 'ideia', '--texto', 'mostrar o progresso ao dono'), 'anotar ideia');
  ok(loop('anotar', '--tipo', 'ideia', '--texto', 'avisar quando a versão sair'), 'anotar 2ª ideia');
  o.passos.ideiaAnotada = passo(a, 'ideia anotada');
  git(a.dir, 'checkout', '-q', '-b', 'feat/GM-50-fumaca');
  const BRANCH = 'feat/GM-50-fumaca';
  a.gh({ branch: BRANCH, pr: [], release: [] });
  medir();
  o.passos.soBranch = passo(a, 'só a branch');
  mkdirSync(join(a.dir, 'docs', 'superpowers', 'specs'), { recursive: true });
  const specRel = join('docs', 'superpowers', 'specs', '2026-11-12-fumaca-design.md');
  copyFileSync(join(AQUI, 'spec.md'), join(a.dir, specRel));
  medir();
  o.passos.spec = passo(a, 'spec');

  // 2. aprovação: sem plano ainda (REQ-TRI-1: a aprovação vem antes do plano)
  o.aprovar = a.rodar('aprovar-spec.mjs', [], stdinTui(a.dir, 'gabarito-mestre:aprovar'));
  o.passos.aprovada = passo(a, 'aprovada');

  // 3. plano
  const entregas = join(a.dir, '.harness', 'entregas', 'GM-50');
  writeFileSync(join(entregas, 'plano.json'), `${JSON.stringify({ entrega: 'GM-50', tasks: [{ id: 'T1', titulo: 'Primeira', deps: [], arquivos: ['src/a.mjs'] }, { id: 'T2', titulo: 'Segunda', deps: [], arquivos: ['src/b.mjs'] }] })}\n`);
  git(a.dir, 'add', '-f', '.harness/entregas/GM-50/plano.json');
  git(a.dir, 'add', '-A');
  git(a.dir, 'commit', '-q', '-m', 'feat: spec e plano');
  medir();
  o.passos.plano = passo(a, 'plano');

  // 4. execução: cada task pelo ciclo da skill
  const tarefa = (task, arquivo) => {
    for (const p of [['abrir', task], ['iniciar', task, 'implementador']]) ok(loop(...p), p.join(' '));
    const wt = join(a.dir, '.harness', 'worktrees', task);
    mkdirSync(join(wt, 'src'), { recursive: true });
    writeFileSync(join(wt, arquivo), `export const ${task.toLowerCase()} = 1;\n`);
    git(wt, 'add', arquivo);
    git(wt, 'commit', '-q', '-m', `feat(GM-50): ${task}`);
    for (const p of [['concluir', task], ['iniciar', task, 'revisor'], ['veredito', task, 'APROVADO', '1', '0', '0'], ['integrar', task]]) ok(loop(...p), `${task} ${p[0]}`);
  };
  tarefa('T1', 'src/a.mjs');
  medir();
  o.passos.umaIntegrada = passo(a, 'T1 integrada');
  tarefa('T2', 'src/b.mjs');
  medir();
  o.passos.todasIntegradas = passo(a, 'T1 e T2 integradas');

  // 5. pedido de revisão aberto, depois mergeado (o `gh` de fixture troca de estado)
  a.gh({ branch: BRANCH, pr: [{ number: 7, state: 'OPEN' }], release: [] });
  medir();
  o.passos.prAberto = passo(a, 'PR aberto');
  a.gh({ branch: BRANCH, pr: [{ number: 7, state: 'MERGED' }], release: [] });
  medir();
  o.passos.prMergeado = passo(a, 'PR mergeado');

  // o dono responde a pergunta (b) pelo botão: a entrega volta a ser identificada e o PR mergeado conta
  o.idPerguntaB = o.passos.prMergeado.estado.pergunta?.id ?? null;
  o.responderB = a.rodar('responder.mjs', [], stdinTui(a.dir, 'gabarito-mestre:responder', `${o.idPerguntaB} 1`, 'S1'));
  o.passos.aceito = passo(a, 'aceito');

  // a versão sai: o `gh` de fixture lista a release (a tag chega crua)
  a.gh({ branch: BRANCH, pr: [{ number: 7, state: 'MERGED' }], release: [{ tagName: 'gabarito-mestre--v2.1.0' }] });
  medir();
  o.passos.publicada = passo(a, 'publicada');

  // o GitHub falha: nada novo é gravado e o painel não diz "nada" nem "aceito" sem conferir
  const antesFalha = diario.ler(entregas).length;
  o.medirComGhFalho = a.rodar('painel.mjs', ['medir', '--agentes'], ENTRADA_MOD('S2'), { GH_FIXTURE_FALHA: '1' });
  o.gravadosNaFalha = diario.ler(entregas).slice(antesFalha).filter((e) => e.tipo === 'fato.medido' && (e.dados.chave === 'pr' || e.dados.chave === 'release')).length;
  o.passos.ghFalhou = passo(a, 'gh falhou', 'S2');

  // fora de um repositório git (FIEL-10 e): o painel diz isso em 1 linha
  const semGit = join(base, 'fora do git');
  mkdirSync(semGit);
  const fora = spawnSync(NODE, [join(SCRIPTS, 'painel.mjs'), 'texto', '--preset', 'esquadrao', '--largura', '80', '--tema', 'mono'], { cwd: semGit, encoding: 'utf8', env: { ...ambiente(T0), GIT_CEILING_DIRECTORIES: base } });
  o.foraDeRepo = { rc: fora.status, out: fora.stdout, err: fora.stderr };

  o.eventos = diario.ler(entregas);
  o.eventosSemId = diario.ler(join(a.dir, '.harness', 'entregas', '_sem-id'));
  o.estadoMedirGh = JSON.parse(readFileSync(join(a.dir, '.harness', 'painel-medir.json'), 'utf8'));
  return o;
}

// ─── 2. pergunta e resposta ───

function pergunta(base) {
  const a = montar(base, 'pergunta');
  const loop = (...args) => a.rodar('loop.mjs', args);
  const o = { dir: a.dir };
  o.antes = passo(a, 'antes');
  ok(loop('anotar', '--tipo', 'assunto', '--texto', 'agora falamos de outra coisa', '--sessao', 'S-pergunta'), 'anotar assunto');
  o.comPergunta = passo(a, 'com pergunta');
  const p = o.comPergunta.estado.pergunta;
  o.id = p?.id ?? null;
  o.hook = a.rodar('responder.mjs', [], stdinTui(a.dir, 'gabarito-mestre:responder', `${o.id} 1`, 'S-pergunta'));
  o.depois = passo(a, 'depois da resposta');
  o.eventos = diario.ler(join(a.dir, '.harness', 'entregas', '_sem-id'));
  return o;
}

// ─── 3. sentinela ───

function sentinela(base) {
  const a = montar(base, 'sentinela');
  const loop = (...args) => a.rodar('loop.mjs', args);
  const o = { dir: a.dir };
  // o diário da entrega existe (uma nota sem texto da sentinela); a mensagem do dono vai pela ponte do mod
  git(a.dir, 'checkout', '-q', '-b', 'feat/GM-70-sentinela');
  ok(loop('anotar', '--tipo', 'duvida', '--texto', 'qual caminho seguir', '--opcao', 'caminho alfa', '--opcao', 'caminho beta', '--entrega', 'GM-70', '--sessao', 'S-sent'), 'anotar duvida');
  const dirEntrega = join(a.dir, '.harness', 'entregas', 'GM-70');
  // (a) sentinela no transcript do agente, que o painel lê pelo stdin do mod
  const transcript = join(dirname(a.dir), 'sent-sessao', 'subagents', 'agent-aSENT1.jsonl');
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${readFileSync(FIXTURE_TRANSCRIPT, 'utf8').trimEnd()}\n${JSON.stringify({ type: 'user', isSidechain: true, agentId: 'aSENT1', message: { role: 'user', content: `${SENTINELA}-transcript` }, timestamp: '2026-01-01T00:00:09.000Z' })}\n`);
  const mod = JSON.stringify({ session_id: 'S-sent', sessao: { session_id: 'S-sent', percent: 30, tokens: 60_000, window: 200_000, x: 50 }, agentes: [{ id: 'aSENT1', type: 'implementador', description: 'T1 implementador', status: 'running', transcript }] });
  o.medir = a.rodar('painel.mjs', ['medir', '--agentes'], mod);
  o.estado = a.rodar('painel.mjs', ['estado', '--agentes'], mod);
  // (b) `dono.mensagem` pela ponte real do mod
  const ponte = spawnSync(NODE, ['--input-type=module', '-e', codigoPonte(`file://${DIST_DIARIO}`)], { cwd: a.dir, encoding: 'utf8', input: JSON.stringify({ op: 'mensagem', dir: dirEntrega, cwd: a.dir, texto: `${SENTINELA}-mensagem` }), env: ambiente(T0 + 10 * PASSO_MS) });
  try { o.mensagem = JSON.parse(ponte.stdout); } catch { o.mensagem = { ok: false, erro: ponte.stdout + ponte.stderr }; }
  // (c) resposta digitada e (d) argumento extra do `responder`
  const id = o.estado.j?.estado?.pergunta?.id ?? null;
  o.id = id;
  o.digitada = a.rodar('responder.mjs', [], stdinTui(a.dir, 'gabarito-mestre:responder', `${id} sim ${SENTINELA}-digitada`, 'S-sent'));
  o.extra = a.rodar('responder.mjs', [], stdinTui(a.dir, 'gabarito-mestre:responder', `${id} 2 ${SENTINELA}-extra`, 'S-sent'));
  o.bytes = bytesDoHarness(a.dir);
  o.eventos = diario.ler(dirEntrega);
  return o;
}
// ─── 4. aprendizado: extrato, cópia por `git ls-files`, `proxima` ───

const REGRA = 'rode o build antes de rodar o teste';

/** O instalador REAL num repositório vazio: o `.gitignore` que ele deixa não esconde o extrato (REQ-APR-5 (a)). Sem `add -f`: é o que um `git add` comum faria. */
function instaladoNaoEscondeOExtrato(base) {
  const dir = join(base, 'repo instalado');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  const inst = spawnSync('bash', [join(GATES, '..', 'scripts', 'instalar.sh'), dir], { encoding: 'utf8', env: ambiente(T0), timeout: 120_000 });
  mkdirSync(join(dir, '.harness'), { recursive: true });
  writeFileSync(join(dir, '.harness', 'aprendizados.jsonl'), '{}\n');
  const ign = spawnSync('git', ['check-ignore', '-q', '.harness/aprendizados.jsonl'], { cwd: dir, env: ambiente(T0) });
  git(dir, 'add', '.harness/aprendizados.jsonl');
  return { instaladorRc: inst.status, gitignore: readFileSync(join(dir, '.gitignore'), 'utf8'), checkIgnoreRc: ign.status, versionados: git(dir, 'ls-files', '-z').split('\0').filter(Boolean) };
}

function aprendizado(base) {
  const a = montar(base, 'aprendizado');
  const loop = (...args) => a.rodar('loop.mjs', args);
  const o = { dir: a.dir };
  git(a.dir, 'checkout', '-q', '-b', 'feat/GM-60-aprendizado');
  const entregas = join(a.dir, '.harness', 'entregas', 'GM-60');
  mkdirSync(entregas, { recursive: true });
  writeFileSync(join(entregas, 'plano.json'), `${JSON.stringify({ entrega: 'GM-60', tasks: [{ id: 'T1', titulo: 'Primeira', deps: [], arquivos: ['src/a.mjs'] }] })}\n`);
  ok(loop('descoberta', '--evidencia', 'fato medido', '--causa', 'tecnica'), 'descoberta');
  const apr = ok(loop('aprendizado', 'E', 'D', '--regra', REGRA, '--entra-em', 'brief:implementador', '--eventos', 'loop:1'), 'aprendizado');
  o.aprendizado = apr.j;
  o.extratoBruto = readFileSync(join(a.dir, '.harness', 'aprendizados.jsonl'), 'utf8');
  // o extrato entra por `git add` comum (a regra da fumaça o libera); só o plano da entrega, ignorado pelo padrão `entregas/*/*`, precisa de `-f`
  git(a.dir, 'add', '.harness/aprendizados.jsonl');
  git(a.dir, 'add', '-f', '.harness/entregas/GM-60/plano.json');
  git(a.dir, 'commit', '-q', '-m', 'docs: extrato e plano');
  o.instalador = instaladoNaoEscondeOExtrato(base);
  o.versionados = git(a.dir, 'ls-files', '-z').split('\0').filter(Boolean);
  // clone: só o que o git versiona (nenhum diário), na mesma branch
  const clone = join(base, 'clone por ls-files');
  mkdirSync(clone);
  for (const f of o.versionados) {
    mkdirSync(dirname(join(clone, f)), { recursive: true });
    writeFileSync(join(clone, f), readFileSync(join(a.dir, f)));
  }
  git(clone, 'init', '-q', '-b', 'feat/GM-60-aprendizado');
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'chore: clone');
  const filhoClone = (script, args) => {
    const r = spawnSync(NODE, [join(SCRIPTS, script), ...args], { cwd: clone, encoding: 'utf8', env: ambiente(T0 + 20 * PASSO_MS) });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* vazio */ }
    return { rc: r.status, j, out: r.stdout, err: r.stderr };
  };
  o.cloneTemDiario = readdirSync(join(clone, '.harness', 'entregas', 'GM-60'));
  o.cloneAprendizados = filhoClone('loop.mjs', ['aprendizados', '--para', 'brief:implementador']);
  o.cloneProxima = filhoClone('loop.mjs', ['proxima', '--vivos', '0']);
  o.clone = clone;
  return o;
}

/** As quatro caminhadas, cada uma em seu repositório sob um único `<tmp>/fumaca-gm14-XXXX`. Falhou no meio ⇒ o temporário sai e a falha original sobe. */
export function caminhar(opcoes = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), PREFIXO)));
  try {
    opcoes.aposMontar?.({ base });
    return { base, setefases: setefases(base), pergunta: pergunta(base), sentinela: sentinela(base), aprendizado: aprendizado(base) };
  } catch (erro) {
    limparSemLancar({ base });
    throw erro;
  }
}

/** Apaga o diretório temporário que `caminhar` criou. Recusa qualquer outro caminho. */
export function limpar(obs) {
  if (typeof obs?.base !== 'string' || !basename(obs.base).startsWith(PREFIXO) || realpathSync(dirname(obs.base)) !== realpathSync(tmpdir())) throw new Error(`recuso apagar fora do temporário da fumaça: ${String(obs?.base)}`);
  rmSync(obs.base, { recursive: true, force: true });
}

/** `limpar` para o `after` da suíte: nunca lança. */
export function limparSemLancar(obs) {
  try { limpar(obs); } catch { /* o que a suíte reporta é a asserção que falhou, não a limpeza */ }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = caminhar();
  try {
    const { base: _b, ...resto } = o;
    process.stdout.write(`${JSON.stringify(resto, null, 1)}\n`);
  } finally {
    limpar(o);
  }
}

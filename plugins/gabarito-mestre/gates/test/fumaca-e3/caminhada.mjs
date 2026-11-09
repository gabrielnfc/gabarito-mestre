/**
 * Caminhada sem LLM da E3 (GM-11 T10, P9): Sombra, emenda, congelamento, julgamento do dono e conclusão, pelos CLIs REAIS e por `dist/`.
 *
 * REAL: `sombra.mjs` (perguntar, registrar, cache), `loop.mjs` (proxima, abrir, iniciar, concluir, veredito, integrar, emenda propor), o hook
 * `emenda-dono.mjs` com o JSON de `UserPromptExpansion`, o gate de `integrar`, git e o instantâneo do diário (`diario.projetar`).
 * SIMULADO: o modelo (o script faz o que a skill mandaria) e a suíte do gate (`echo '# pass 1'`; a suíte do produto roda em outro teste).
 *
 * NÃO COBRE: o agente Sombra responder pelo brief, o dono digitar o comando no TUI (o JSON é o do spike A1) e o modelo obedecer.
 * Nada de relógio nem carga decide resultado: cada passo espera o processo que terminou.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as diario from '../../dist/diario.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(AQUI, '..', '..', 'scripts');
const NODE = process.execPath;

/** Ambiente dos filhos: sem a mecânica do `node --test` pai nem redirecionamento de git; capacidade fixada pelo fixture. */
function ambiente() {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') || k.startsWith('NODE_TEST') || k === 'NODE_OPTIONS') continue;
    e[k] = v;
  }
  return { ...e, GABARITO_CAP_HOSTNAME: 'host-fumaca', GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };
}

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', env: ambiente(), stdio: ['ignore', 'pipe', 'pipe'] });

function cli(script, cwd, args) {
  const r = spawnSync(NODE, [join(SCRIPTS, script), ...args], { cwd, encoding: 'utf8', env: ambiente() });
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
}

/** Repo descartável da entrega GM-99: plano de 3 tasks com `reqs`, spec, capacidade e config. Recusa destino existente via `mkdtemp`. */
export function montarRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'fumaca-e3-')));
  git(dir, 'init', '-q', '-b', 'enabler/GM-99-fumaca');
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'src'));
  copyFileSync(join(AQUI, 'spec.md'), join(dir, 'docs', 'spec.md'));
  writeFileSync(join(dir, 'src', '.gitkeep'), '');
  writeFileSync(join(dir, '.gitignore'), '.harness/\n');
  writeFileSync(join(dir, 'harness.config.json'), `${JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } })}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-99');
  mkdirSync(entregas, { recursive: true });
  copyFileSync(join(AQUI, 'plano.json'), join(entregas, 'plano.json'));
  writeFileSync(join(dir, '.harness', 'capacidade.json'), JSON.stringify({ hostname: 'host-fumaca', slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 }));
  return { dir, entregas };
}

const loop = (r, ...args) => cli('loop.mjs', r.dir, args);
const sombra = (r, ...args) => cli('sombra.mjs', r.dir, args);

/** abrir → iniciar → commit → concluir → revisor → APROVADO: a skill `gabarito-loop` ao pé da letra. */
function aprovar(r, task, arquivo) {
  const passos = [['abrir', task], ['iniciar', task, 'implementador']];
  for (const p of passos) ok(loop(r, ...p), p.join(' '));
  const wt = join(r.dir, '.harness', 'worktrees', task);
  writeFileSync(join(wt, arquivo), `export const ${task.toLowerCase()} = 1;\n`);
  git(wt, 'add', arquivo);
  git(wt, 'commit', '-q', '-m', `feat(GM-99): ${task}`);
  for (const p of [['concluir', task], ['iniciar', task, 'revisor'], ['veredito', task, 'APROVADO', '1', '0', '0']]) ok(loop(r, ...p), p.join(' '));
}
function ok(res, rotulo) {
  if (res.j?.ok !== true || res.rc !== 0) throw new Error(`${rotulo}: rc ${res.rc} ${res.out} ${res.err}`);
  return res;
}

/** stdin que o TUI manda ao hook `UserPromptExpansion` (medido no spike A1, 2.1.318). */
const stdinTui = (dir, args) => JSON.stringify({ session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: 'gabarito-mestre:emenda', command_args: args, command_source: 'plugin' });

/** Roda a caminhada inteira e devolve cada observação com o nome do que ela mostra; o teste afirma. */
export function caminhar() {
  const r = montarRepo();
  const obs = { dir: r.dir };

  // 1. Sombra: consulta, pendente, registrar, cache
  obs.pergunta1 = ok(sombra(r, 'perguntar', '--task', 'T1', '--pergunta', 'A soma aceita negativos?'), 'perguntar');
  obs.pergunta2 = sombra(r, 'perguntar', '--task', 'T1', '--pergunta', 'a soma aceita NEGATIVOS?');
  const resposta = join(r.dir, 'resposta.json');
  writeFileSync(resposta, JSON.stringify({ resposta: 'Aceita, pela spec.', texto: 'Aceita negativos; REQ-A-1 não os exclui.', pergunta_enviesada: false, fontes: ['docs/spec.md REQ-A-1'] }));
  obs.registro = ok(sombra(r, 'registrar', obs.pergunta1.j.hash, resposta), 'registrar');
  obs.cache = sombra(r, 'perguntar', '--task', 'T1', '--pergunta', 'A soma aceita negativos?');
  obs.instantaneo = diario.projetar(diario.ler(r.entregas));

  // 2. proxima despacha T1 e T2 com a decisão na mão do implementador
  obs.proxima1 = ok(loop(r, 'proxima', '--vivos', '0'), 'proxima 1');

  // 3. T1 aprovada; proposta no REQ-A-1 congela T1 (e T3, que depende dela); T2, independente, chega a integrada
  aprovar(r, 'T1', 'src/a.mjs');
  const diff = join(r.dir, 'emenda.diff');
  writeFileSync(diff, '+ **REQ-A-1** O sistema soma dois números inteiros.\n');
  obs.proposta = ok(loop(r, 'emenda', 'propor', '--req', 'REQ-A-1', '--task', 'T1', '--diff', diff, '--fato', 'só inteiros', '--alternativa', 'aceitar decimais', '--evidencia', 'spec', '--causa', 'regra_negocio'), 'propor');
  obs.integrarCongelada = loop(r, 'integrar', 'T1');
  aprovar(r, 'T2', 'src/b.mjs');
  obs.integrarT2 = ok(loop(r, 'integrar', 'T2'), 'integrar T2');
  obs.esperando = ok(loop(r, 'proxima', '--vivos', '0'), 'proxima esperando');

  // 4. o dono aprova pelo hook real; T1 integra; T3 segue; fim em `concluir`
  obs.hook = spawnSync(NODE, [join(SCRIPTS, 'emenda-dono.mjs')], { input: stdinTui(r.dir, 'aprovar 1'), encoding: 'utf8', cwd: r.dir, env: ambiente() });
  obs.proxima3 = ok(loop(r, 'proxima', '--vivos', '0'), 'proxima 3');
  obs.integrarT1 = ok(loop(r, 'integrar', 'T1'), 'integrar T1');
  obs.proxima4 = ok(loop(r, 'proxima', '--vivos', '0'), 'proxima 4');
  aprovar(r, 'T3', 'src/c.mjs');
  obs.integrarT3 = ok(loop(r, 'integrar', 'T3'), 'integrar T3');
  obs.final = ok(loop(r, 'proxima', '--vivos', '0'), 'proxima final');
  obs.eventos = diario.ler(r.entregas);
  obs.temaPlano = JSON.parse(readFileSync(join(r.entregas, 'plano.json'), 'utf8')).tasks.length;
  return obs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(`${JSON.stringify(caminhar())}\n`);

/**
 * Caminhada sem LLM da E4 (GM-12 T12, P9): do `/gabarito-mestre:aprovar` ao painel em texto, pelos CLIs REAIS e por `dist/`, em repositório git descartável.
 *
 * REAL: `aprovar-spec.mjs` (hook com o stdin do TUI), `loop.mjs` (abrir, iniciar, concluir, veredito, integrar, ci, emenda propor, parar),
 * `emenda-dono.mjs`, `entrega.mjs` (decidir, devolver) e `painel.mjs` (estado e texto, nos dois presets) com o JSON do mod em stdin
 * (`--agentes`), cujo agente vivo traz o transcript de FIXTURE (a mesma de T9, `test/fixtures/transcript-agente.jsonl`, ctx 92.762).
 * SIMULADO: o modelo (o script faz o que a skill mandaria), a suíte do gate (`echo '# pass 1'`), deploy/smoke/rollback (nunca rodam: `devolver` não roda comando).
 *
 * RELÓGIO. Cada processo filho roda com `--import` de um módulo `data:` que fixa `Date`/`Date.now()` em `FUMACA_AGORA`, e o script avança 60 s por chamada
 * (tabela de relógio da caminhada). Sem isso a hora do ETA, os tempos `9m` e o histórico mudariam a cada execução e o texto não seria golden.
 * `TZ=UTC`: a hora do painel é a do fuso do processo.
 *
 * NÃO COBRE: o mod desenhando o texto (T10/T11 têm teste próprio), o dono digitando no TUI, a sessão real com LLM.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, mkdtempSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as diario from '../../dist/diario.js';
import { fecharPendenciasNoDiario } from '../_adaptador-helpers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(AQUI, '..', '..', 'scripts');
const FIXTURE_TRANSCRIPT = join(AQUI, '..', 'fixtures', 'transcript-agente.jsonl');
const NODE = process.execPath;
const ENTREGA = 'GM-99';
const BRANCH = 'enabler/GM-99-fumaca';

/** 2026-11-09 12:00:00 UTC, uma segunda-feira. */
export const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
const PASSO_MS = 60_000;

/** Módulo `data:` que congela `Date` no instante de `FUMACA_AGORA` (inteiro em ms), dentro do filho. */
const RELOGIO = `data:text/javascript,${encodeURIComponent(
  'const B=Number(process.env.FUMACA_AGORA);if(Number.isFinite(B)){const R=Date;globalThis.Date=class extends R{constructor(...a){if(a.length===0)super(B);else super(...a)}static now(){return B}}}',
)}`;

/** Ambiente dos filhos: sem a mecânica do `node --test` pai nem redirecionamento de git; capacidade e identidade fixadas pelo fixture. */
function ambiente(agora) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') || k.startsWith('NODE_TEST') || k === 'NODE_OPTIONS') continue;
    e[k] = v;
  }
  return {
    ...e, TZ: 'UTC', LANG: 'C.UTF-8', FUMACA_AGORA: String(agora),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GABARITO_CAP_HOSTNAME: 'host-fumaca', GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0',
  };
}

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', env: ambiente(T0), stdio: ['ignore', 'pipe', 'pipe'] });

/** Ambiente da caminhada: o diretório do repo, o relógio que só avança e os atalhos de chamada. */
function montar() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fumaca-e4-')));
  const dir = join(base, 'repo com espaço');
  const bare = join(base, 'origin.git');
  mkdirSync(dir);
  mkdirSync(bare);
  git(dir, 'init', '-q', '-b', BRANCH);
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'fake'));
  copyFileSync(join(AQUI, 'spec.md'), join(dir, 'docs', 'spec.md'));
  writeFileSync(join(dir, 'src', '.gitkeep'), '');
  writeFileSync(join(dir, '.gitignore'), '.harness/*\n!.harness/entregas/\n.harness/entregas/*/*\n!.harness/entregas/*/registro.md\n');
  // deploy, smoke e rollback existem só para o config ser válido: `devolver` NUNCA roda comando (um marcador no disco provaria o contrário)
  const comandos = {};
  for (const nome of ['deploy', 'smoke', 'rollback']) {
    writeFileSync(join(dir, 'fake', `${nome}.sh`), `touch '${join(base, `RODOU-${nome}`)}'\n`);
    comandos[nome] = { argv: ['bash', join(dir, 'fake', `${nome}.sh`)], timeout_s: 20 };
  }
  writeFileSync(join(dir, 'harness.config.json'), `${JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 3 }, entrega: { politica: 'continua', autonomia: true, base: BRANCH, comandos } })}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: base');
  git(bare, 'init', '-q', '--bare', '-b', BRANCH);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', BRANCH);
  git(dir, 'remote', 'set-head', 'origin', BRANCH);
  const entregas = join(dir, '.harness', 'entregas', ENTREGA);
  mkdirSync(entregas, { recursive: true });
  copyFileSync(join(AQUI, 'plano.json'), join(entregas, 'plano.json'));
  writeFileSync(join(dir, '.harness', 'capacidade.json'), JSON.stringify({ hostname: 'host-fumaca', slots_max: 3, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 }));

  let agora = T0;
  /** Roda `node --import <relógio> script args` com o relógio no próximo passo. `input` ausente ⇒ stdin fechado. */
  const rodar = (script, args, input) => {
    agora += PASSO_MS;
    const r = spawnSync(NODE, ['--import', RELOGIO, join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8', env: ambiente(agora), input, timeout: 120_000 });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* texto do painel ou vazio */ }
    return { rc: r.status, j, out: r.stdout, err: r.stderr };
  };
  return { base, dir, bare, entregas, rodar, agoraMs: () => agora };
}

function ok(res, rotulo) {
  if (res.rc !== 0 || res.j?.ok !== true) throw new Error(`${rotulo}: rc ${res.rc} ${res.out} ${res.err}`);
  return res;
}

/** stdin que o TUI manda ao hook `UserPromptExpansion` (medido no spike A1, 2.1.318). */
const stdinTui = (dir, comando, args = '') => JSON.stringify({ session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: comando, command_args: args, command_source: 'plugin' });

/** abrir → iniciar → commit → concluir → revisor → APROVADO: a skill `gabarito-loop` ao pé da letra (a task já aberta e iniciada não repete). */
function aprovar(a, task, arquivo, { jaIniciada = false } = {}) {
  const loop = (...args) => a.rodar('loop.mjs', args);
  if (!jaIniciada) for (const p of [['abrir', task], ['iniciar', task, 'implementador']]) ok(loop(...p), p.join(' '));
  const wt = join(a.dir, '.harness', 'worktrees', task);
  writeFileSync(join(wt, arquivo), `export const ${task.toLowerCase()} = 1;\n`);
  git(wt, 'add', arquivo);
  git(wt, 'commit', '-q', '-m', `feat(GM-99): ${task}`);
  for (const p of [['concluir', task], ['iniciar', task, 'revisor'], ['veredito', task, 'APROVADO', '1', '0', '0']]) ok(loop(...p), p.join(' '));
}

/** O JSON do mod em stdin de `painel.mjs --agentes`: sessão com contexto e limites, um subagente vivo com o transcript da fixture na forma exigida. */
function entradaDoMod(transcript, vivo = true, notificacaoPasso = 26) {
  // a notificação é a do Parar (12:25, passo 25): o mod a envia logo depois, então o ts do passo 26 é dela; um ts ANTERIOR ao Parar é de um Parar antigo
  return JSON.stringify({
    sessao: { percent: 46, tokens: 92_000, window: 200_000, h5: 12, d7: 5, x: 50, notificacao: { ts: new Date(T0 + notificacaoPasso * PASSO_MS).toISOString() }, pacote: 'terra-media' },
    agentes: vivo ? [{ id: 'aFUM1', type: 'implementador', description: 'T3 implementador', status: 'running', transcript }] : [],
  });
}

/** Commit na worktree da task e `concluir`; o papel que a skill despacha em seguida é do chamador. */
function entregar(a, task, arquivo) {
  const wt = join(a.dir, '.harness', 'worktrees', task);
  writeFileSync(join(wt, arquivo), `export const ${task.toLowerCase()}_${a.agoraMs()} = 1;\n`);
  git(wt, 'add', arquivo);
  git(wt, 'commit', '-q', '-m', `feat(GM-99): ${task}`);
  ok(a.rodar('loop.mjs', ['concluir', task]), `concluir ${task}`);
}

/** REPROVADO exige os achados em `<worktree>/.tmp-gabarito/review-r<rodada>.md` (o CLI recusa sem eles). */
function reprovar(a, task, rodada) {
  const wt = join(a.dir, '.harness', 'worktrees', task);
  mkdirSync(join(wt, '.tmp-gabarito'), { recursive: true });
  writeFileSync(join(wt, '.tmp-gabarito', `review-r${rodada}.md`), `- MAJOR: achado da rodada ${rodada}\n`);
  ok(a.rodar('loop.mjs', ['veredito', task, 'REPROVADO', String(rodada), '0', '1']), `veredito REPROVADO r${rodada} ${task}`);
}

/**
 * Caminhada inteira. Cada observação leva o nome do que mostra; o teste afirma. Fases: (1) spec aprovada pelo hook; (2) T1 integrada, T2 reprovada 2× (teto
 * de rodadas), T3 em voo com o agente vivo, proposta de emenda aberta na REQ de T3; (3) `loop.parar teto_rodadas` ⇒ o painel nos dois presets (os `.txt` da
 * pasta); (4) o dono aprova a emenda e libera T2, o loop conclui, o CI homolog fica verde e `entrega.mjs devolver` grava o pedido do dono ⇒ o painel mostra o comando.
 */
export function caminhar(opcoes = {}) {
  const a = montar();
  try {
    return caminhada(a, opcoes);
  } catch (erro) {
    // a caminhada falhou no meio: o temporário não fica para trás (e a falha original é a que sobe)
    limparSemLancar({ base: a.base });
    throw erro;
  }
}

function caminhada(a, opcoes) {
  opcoes.aposMontar?.(a);
  const loop = (...args) => a.rodar('loop.mjs', args);
  const painel = (args, input) => a.rodar('painel.mjs', args, input);
  /** REQ-APR-2 muda a ordem: fecha o que `pendenciasAprendizado` do `dist/` devolve (review, parar, fechamento), como o modelo faria antes de `proxima`/`decidir`. */
  const fechar = () => fecharPendenciasNoDiario(a.entregas, JSON.parse(readFileSync(join(a.entregas, 'plano.json'), 'utf8')));
  const obs = { dir: a.dir, base: a.base, entregas: a.entregas };

  // transcript do agente vivo na forma `<abs>/subagents/agent-<id>.jsonl`
  const subagents = join(a.base, 'sessao', 'subagents');
  mkdirSync(subagents, { recursive: true });
  const transcript = join(subagents, 'agent-aFUM1.jsonl');
  copyFileSync(FIXTURE_TRANSCRIPT, transcript);
  obs.transcript = transcript;

  // 0. antes de tudo: a spec aguarda aprovação
  obs.estadoAntes = ok(painel(['estado']), 'estado antes');

  // 1. spec aprovada pelo hook real, com o stdin do TUI
  obs.aprovar = a.rodar('aprovar-spec.mjs', [], stdinTui(a.dir, 'gabarito-mestre:aprovar'));
  obs.aprovarDeNovo = a.rodar('aprovar-spec.mjs', [], stdinTui(a.dir, 'gabarito-mestre:aprovar'));
  obs.estadoAprovada = ok(painel(['estado']), 'estado aprovada');

  // 2. T1 integrada; T2 reprovada na 1ª e na 2ª rodada (corrige no meio) ⇒ `no_teto`; T3 em voo (o agente do mod); emenda proposta na REQ de T3
  aprovar(a, 'T1', 'src/a.mjs');
  obs.integrarT1 = ok(loop('integrar', 'T1'), 'integrar T1');
  for (const p of [['abrir', 'T2'], ['iniciar', 'T2', 'implementador']]) ok(loop(...p), p.join(' '));
  entregar(a, 'T2', 'src/b.mjs');
  ok(loop('iniciar', 'T2', 'revisor'), 'iniciar revisor T2');
  reprovar(a, 'T2', 1);
  ok(loop('iniciar', 'T2', 'correcao'), 'iniciar correcao T2');
  entregar(a, 'T2', 'src/b.mjs');
  ok(loop('iniciar', 'T2', 'revisor'), 'iniciar revisor T2 r2');
  reprovar(a, 'T2', 2);
  for (const p of [['abrir', 'T3'], ['iniciar', 'T3', 'implementador']]) ok(loop(...p), p.join(' '));
  writeFileSync(join(a.base, 'emenda.diff'), '+ **REQ-C-1** O painel mostra ao dono o que depende dele, com o comando.\n');
  obs.proposta = ok(loop('emenda', 'propor', '--req', 'REQ-C-1', '--task', 'T3', '--diff', join(a.base, 'emenda.diff'), '--fato', 'falta o comando', '--alternativa', 'só o texto', '--evidencia', 'spec', '--causa', 'regra_negocio'), 'propor');
  obs.estadoEmenda = ok(painel(['estado', '--agentes'], entradaDoMod(transcript)), 'estado emenda');

  // 3. o loop decide parar por teto de rodadas em T2 e grava; o painel, nos dois presets, com o agente vivo (transcript de fixture)
  fechar();
  obs.proximaTeto = ok(loop('proxima', '--vivos', '0'), 'proxima teto');
  obs.parar = ok(loop('parar', 'teto_rodadas'), 'parar');
  fechar();
  obs.estadoParou = ok(painel(['estado', '--agentes'], entradaDoMod(transcript)), 'estado parou');
  obs.textoEsquadrao = painel(['texto', '--preset', 'esquadrao', '--largura', '80', '--tema', 'mono', '--agentes'], entradaDoMod(transcript));
  obs.textoExecutivo = painel(['texto', '--preset', 'executivo', '--largura', '80', '--tema', 'mono', '--agentes'], entradaDoMod(transcript));
  // notificação de um Parar ANTERIOR (12:12 < 12:25): o estado a omite sob o PAROU vigente
  obs.estadoNotificacaoAntiga = ok(painel(['estado', '--agentes'], entradaDoMod(transcript, true, 12)), 'estado com notificação antiga');

  // 4. o dono aprova a emenda e libera T2 pelos hooks reais; T2 e T3 integram; CI homolog verde; o dono devolve o deploy
  obs.hookEmenda = a.rodar('emenda-dono.mjs', [], stdinTui(a.dir, 'gabarito-mestre:emenda', 'aprovar 1'));
  obs.hookLiberar = a.rodar('liberar-teto.mjs', [], stdinTui(a.dir, 'gabarito-mestre:liberar', 'T2'));
  ok(loop('iniciar', 'T2', 'implementador'), 'iniciar T2 depois de liberar');
  entregar(a, 'T2', 'src/b.mjs');
  for (const p of [['iniciar', 'T2', 'revisor'], ['veredito', 'T2', 'APROVADO', '1', '0', '0']]) ok(loop(...p), p.join(' '));
  obs.integrarT2 = ok(loop('integrar', 'T2'), 'integrar T2');
  entregar(a, 'T3', 'src/c.mjs');
  for (const p of [['iniciar', 'T3', 'revisor'], ['veredito', 'T3', 'APROVADO', '1', '0', '0']]) ok(loop(...p), p.join(' '));
  obs.integrarT3 = ok(loop('integrar', 'T3'), 'integrar T3');
  fechar();
  obs.proximaFim = ok(loop('proxima', '--vivos', '0'), 'proxima fim');
  ok(loop('ci', 'verde', '--alvo', 'homolog'), 'ci verde homolog');
  fechar();
  ok(loop('registro'), 'registro'); // REQ-REG-1: o CLI gera e commita; `decidir` o exige no HEAD
  obs.decidir = ok(a.rodar('entrega.mjs', ['decidir', '--entrega', ENTREGA]), 'decidir');
  obs.devolver = a.rodar('entrega.mjs', ['devolver', '--motivo', 'quero revisar antes de subir', '--entrega', ENTREGA]);
  obs.estadoDevolvido = ok(painel(['estado', '--agentes'], entradaDoMod(transcript, false)), 'estado devolvido');
  obs.textoDevolvido = painel(['texto', '--preset', 'executivo', '--largura', '80', '--tema', 'mono', '--agentes'], entradaDoMod(transcript, false));

  obs.eventos = diario.ler(a.entregas);
  obs.rodou = ['deploy', 'smoke', 'rollback'].filter((n) => existsSync(join(a.base, `RODOU-${n}`)));
  return obs;
}

/** Apaga o diretório temporário que `montar` criou (`<tmp>/fumaca-e4-*`: o repo descartável e o bare). Recusa qualquer outro caminho. */
export function limpar(obs) {
  if (typeof obs?.base !== 'string' || !basename(obs.base).startsWith('fumaca-e4-') || realpathSync(dirname(obs.base)) !== realpathSync(tmpdir())) throw new Error(`recuso apagar fora do temporário da fumaça: ${String(obs?.base)}`);
  rmSync(obs.base, { recursive: true, force: true });
}

/** `limpar` para o `after` da suíte: nunca lança (um `after` que lança vira falha que esconde a causa). */
export function limparSemLancar(obs) {
  try { limpar(obs); } catch { /* o que a suíte reporta é a asserção que falhou, não a limpeza */ }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = caminhar();
  try {
    process.stdout.write(`${JSON.stringify({ esquadrao: o.textoEsquadrao.out, executivo: o.textoExecutivo.out })}\n`);
  } finally {
    limpar(o);
  }
}

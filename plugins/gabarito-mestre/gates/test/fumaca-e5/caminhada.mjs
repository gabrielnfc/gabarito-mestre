/**
 * Caminhada sem LLM da E5a (GM-13 T16, P9): do veredito que reprova ao registro, e o onboarding, SÓ pelos CLIs REAIS e por `dist/`, em repositório git descartável.
 *
 * REAL: `aprovar-spec.mjs` (hook com o stdin do TUI), `loop.mjs` (abrir, iniciar, concluir, veredito, integrar, proxima, aprendizado, aprendizados,
 * pousar, descoberta, registro), `cartao-sessao.mjs --hook` (SessionStart `source: clear`), `harness-doctor.mjs --json` e `onboarding.mjs` (detectar, gravar).
 * Nenhuma função interna é chamada para "pular" etapa: cada passo confere o anterior pelo ARQUIVO (`events.*.jsonl`, `registro.md`, `harness.config.json`),
 * lido aqui com `readFileSync` + `JSON.parse`, nunca pelo `diario.ler` do produto.
 * SIMULADO: o modelo (o script faz o que a skill mandaria), a suíte do gate (`echo '# pass 1'`) e o `claude mcp list` (um `claude` falso no PATH, só para o onboarding).
 *
 * RELÓGIO. Cada processo filho do loop roda com `--import` de um módulo `data:` que fixa `Date` em `FUMACA_AGORA`; o script avança 60 s por chamada. Sem isso
 * o `ts` dos eventos dependeria da máquina e a ordem entre sessões (o registro) não seria reprodutível. `TZ=UTC`.
 * IDENTIDADE GIT. `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, `user.useConfigOnly=true` e `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`: o runner Linux não tem identidade (E3).
 *
 * NÃO COBRE: o mod desenhando o texto, o dono digitando no TUI, a sessão real com LLM.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, mkdtempSync, realpathSync, rmSync, readFileSync, readdirSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(AQUI, '..', '..', 'scripts');
const FIXTURES_ONB = join(AQUI, '..', 'fixtures', 'onboarding');
const NODE = process.execPath;
export const ENTREGA = 'GM-99';
const BRANCH = 'enabler/GM-99-fumaca';
export const HOJE = '2026-11-09';
export const FUSO = 'UTC';
const PREFIXO = 'fumaca-e5-';

/** 2026-11-09 12:00:00 UTC. */
export const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
const PASSO_MS = 60_000;

const RELOGIO = `data:text/javascript,${encodeURIComponent(
  'const B=Number(process.env.FUMACA_AGORA);if(Number.isFinite(B)){const R=Date;globalThis.Date=class extends R{constructor(...a){if(a.length===0)super(B);else super(...a)}static now(){return B}}}',
)}`;

/** Ambiente dos filhos: sem a mecânica do `node --test` pai, sem redirecionamento de git; identidade e config global de git fixadas. */
function ambiente(agora, extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') || k.startsWith('NODE_TEST') || k === 'NODE_OPTIONS' || k.startsWith('GABARITO_POUSO')) continue;
    e[k] = v;
  }
  return {
    ...e, TZ: 'UTC', LANG: 'C.UTF-8', FUMACA_AGORA: String(agora),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GABARITO_INSTALLED_PLUGINS: '/nao/existe.json',
    GABARITO_CAP_HOSTNAME: 'host-fumaca', GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0',
    ...extra,
  };
}

const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.useConfigOnly=true', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8', env: ambiente(T0), stdio: ['ignore', 'pipe', 'pipe'] });

/** Todas as linhas dos `events.*.jsonl` da pasta, como objetos, na ordem do arquivo. Linha que não é JSON lança (nada de "0 eventos" calado). */
export function lerEventos(dirEntrega) {
  const arquivos = readdirSync(dirEntrega).filter((f) => /^events\..+\.jsonl$/.test(f)).sort();
  return arquivos.flatMap((f) => readFileSync(join(dirEntrega, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

function montar() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), PREFIXO)));
  const dir = join(base, 'repo com espaço');
  const bare = join(base, 'origin.git');
  mkdirSync(dir);
  mkdirSync(bare);
  git(dir, 'init', '-q', '-b', BRANCH);
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'src'));
  copyFileSync(join(AQUI, 'spec.md'), join(dir, 'docs', 'spec.md'));
  writeFileSync(join(dir, 'src', '.gitkeep'), '');
  writeFileSync(join(dir, '.gitignore'), '.harness/*\n!.harness/entregas/\n.harness/entregas/*/*\n!.harness/entregas/*/registro.md\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n\n**Nível de adoção declarado: `1`**\n');
  // `fluxo.resolvidoEm` é o que o cartão exige para ler o diário (sem onboarding o hook não escreve nada)
  writeFileSync(join(dir, 'harness.config.json'), `${JSON.stringify({
    gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 3 }, entrega: { politica: 'sob_demanda', autonomia: false, base: BRANCH },
    fluxo: { ferramenta: 'arquivos', resolvidoEm: '2026-11-01', ledgerDir: 'docs/ledgers' },
    versionamento: { resolvidoEm: '2026-11-01' },
    orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: '2026-11-01', validadeDias: 90 } },
  })}\n`);
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
  // plugin falso só para o cartão (`--plugin-root`): versão e nada mais; o doctor do cartão não roda
  const plugin = join(base, 'plugin-falso');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gabarito-mestre', version: '2.0.0' }));

  let agora = T0;
  const rodarCom = (script, args, { input, env = {}, congelar = true } = {}) => {
    agora += PASSO_MS;
    const r = spawnSync(NODE, [...(congelar ? ['--import', RELOGIO] : []), join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8', env: ambiente(agora, env), input, timeout: 120_000 });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* texto ou vazio */ }
    return { rc: r.status, j, out: r.stdout, err: r.stderr };
  };
  return { base, dir, entregas, plugin, rodar: (s, a, i) => rodarCom(s, a, { input: i }), rodarCom, agoraMs: () => agora };
}

function ok(res, rotulo) {
  if (res.rc !== 0 || res.j?.ok !== true) throw new Error(`${rotulo}: rc ${res.rc} ${res.out} ${res.err}`);
  return res;
}

const stdinTui = (dir, comando, args = '') => JSON.stringify({ session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: comando, command_args: args, command_source: 'plugin' });

function commitar(a, task, arquivo) {
  const wt = join(a.dir, '.harness', 'worktrees', task);
  writeFileSync(join(wt, arquivo), `export const ${task.toLowerCase()}_${a.agoraMs()} = 1;\n`);
  git(wt, 'add', arquivo);
  git(wt, 'commit', '-q', '-m', `feat(GM-99): ${task}`);
}

/** abrir → iniciar implementador → commit → concluir. O papel que a skill despacha em seguida é do chamador. */
function implementar(a, task, arquivo) {
  const loop = (...args) => ok(a.rodar('loop.mjs', args), args.join(' '));
  loop('abrir', task);
  loop('iniciar', task, 'implementador');
  commitar(a, task, arquivo);
  loop('concluir', task);
}

const regraDoAprendizado = 'Sempre rode o teste do contrato antes de concluir a task';

/**
 * A skill do loop ao pé da letra. `proxima` com pendência diz `aprender`; o aprendizado fecha a pendência; o pouso e o cartão carregam a regra;
 * o próximo `proxima` despacha o implementador JÁ com a regra no item. Depois T1, T2 e T3 integram, o fechamento pede o aprendizado (e o doctor o avisa),
 * `nada` fecha, `proxima` conclui e o registro sai 2× com o mesmo byte.
 */
function loopAprendeEVolta(a) {
  const loop = (...args) => a.rodar('loop.mjs', args);
  const obs = {};
  obs.aprovar = a.rodar('aprovar-spec.mjs', [], stdinTui(a.dir, 'gabarito-mestre:aprovar'));

  // 1. T1 reprovada com 1 MAJOR
  implementar(a, 'T1', 'src/a.mjs');
  ok(loop('iniciar', 'T1', 'revisor'), 'iniciar revisor T1');
  const wt1 = join(a.dir, '.harness', 'worktrees', 'T1');
  mkdirSync(join(wt1, '.tmp-gabarito'), { recursive: true });
  writeFileSync(join(wt1, '.tmp-gabarito', 'review-r1.md'), '- MAJOR: o contrato não tem teste\n');
  obs.veredito1 = ok(loop('veredito', 'T1', 'REPROVADO', '1', '0', '1'), 'veredito REPROVADO T1');

  // 2. a pendência de aprendizado vence tudo: `proxima` diz `aprender`, com o par (sessao, seq) do veredito
  obs.proximaAprender = ok(loop('proxima', '--vivos', '0'), 'proxima aprender');
  const pend = obs.proximaAprender.j.acao?.pendencias?.[0];
  if (pend === undefined) throw new Error(`proxima não devolveu pendência: ${obs.proximaAprender.out}`);
  const ref = `${pend.sessao}:${pend.seq}`;
  obs.diarioAntesDoAprendizado = lerEventos(a.entregas);

  // 3. o aprendizado entra no instantâneo e no brief do implementador
  obs.aprendizado = ok(loop('aprendizado', 'E', 'D', '--regra', regraDoAprendizado, '--entra-em', 'instantaneo,brief:implementador', '--gatilho', ref, '--eventos', ref), 'aprendizado');
  obs.aprendizadosInstantaneo = ok(loop('aprendizados', '--para', 'instantaneo'), 'aprendizados instantaneo');
  obs.aprendizadosImplementador = ok(loop('aprendizados', '--para', 'brief:implementador'), 'aprendizados brief:implementador');
  obs.aprendizadosRevisor = ok(loop('aprendizados', '--para', 'brief:revisor'), 'aprendizados brief:revisor');

  // 4. pouso pelo dono (T1 reprovada não está em voo), o cartão `clear` e a retomada sem mod
  obs.pousar = ok(loop('pousar'), 'pousar');
  obs.cartao = a.rodarCom('cartao-sessao.mjs', ['--hook', '--root', a.dir, '--plugin-root', a.plugin, '--agora', new Date(a.agoraMs() + PASSO_MS).toISOString()], { input: JSON.stringify({ session_id: 'S-novo', source: 'clear', hook_event_name: 'SessionStart', cwd: a.dir }) });
  obs.diarioDepoisDoCartao = lerEventos(a.entregas);

  // 5. o `proxima` da sessão nova: o item `implementador` traz a regra (e o de `correcao`, que não está em `entra_em`, não)
  obs.proximaDespacha = ok(loop('proxima', '--vivos', '0'), 'proxima despacha');

  // 6. T1 corrigida e aprovada; T2 implementada (2 descobertas de sessões fora da ordem alfabética: o registro ordena por `ts`)
  ok(loop('iniciar', 'T1', 'correcao'), 'iniciar correcao T1');
  commitar(a, 'T1', 'src/a.mjs');
  for (const p of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '2', '0', '0'], ['integrar', 'T1']]) ok(loop(...p), p.join(' '));
  implementar(a, 'T2', 'src/b.mjs');
  ok(a.rodar('loop.mjs', ['descoberta', '--sessao', 'zeta', '--evidencia', 'primeira descoberta, da sessão zeta', '--causa', 'tecnica']), 'descoberta zeta');
  ok(a.rodar('loop.mjs', ['descoberta', '--sessao', 'alfa', '--evidencia', 'segunda descoberta, da sessão alfa', '--causa', 'regra_negocio']), 'descoberta alfa');
  for (const p of [['iniciar', 'T2', 'revisor'], ['veredito', 'T2', 'APROVADO', '1', '0', '0'], ['integrar', 'T2']]) ok(loop(...p), p.join(' '));
  implementar(a, 'T3', 'src/c.mjs');
  for (const p of [['iniciar', 'T3', 'revisor'], ['veredito', 'T3', 'APROVADO', '1', '0', '0'], ['integrar', 'T3']]) ok(loop(...p), p.join(' '));

  // 7. fechamento: a pendência aparece em `proxima` e no doctor, que cita o comando que a fecha
  obs.proximaFechamento = ok(loop('proxima', '--vivos', '0'), 'proxima fechamento');
  obs.doctorAberto = a.rodarCom('harness-doctor.mjs', ['--json']);
  const fecha = obs.proximaFechamento.j.acao?.pendencias?.[0];
  if (fecha === undefined) throw new Error(`proxima não devolveu o fechamento: ${obs.proximaFechamento.out}`);
  // o aviso manda `--motivo <texto>`: o script faz o que ele manda, com o texto no lugar do marcador
  const aviso = (obs.doctorAberto.j?.avisos ?? []).find((x) => x.startsWith('aprendizado-sem-destino: '));
  const comando = aviso === undefined ? null : /feche com: loop\.mjs (aprendizado nada --gatilho \S+) --motivo <texto> --entrega (\S+)/.exec(aviso);
  if (comando === null) throw new Error(`o doctor não citou o comando que fecha o fechamento: ${aviso}`);
  obs.comandoDoDoctor = comando[0];
  obs.nada = ok(loop(...comando[1].split(' '), '--motivo', 'nada novo no fechamento', '--entrega', comando[2]), 'aprendizado nada');
  obs.doctorFechado = a.rodarCom('harness-doctor.mjs', ['--json']);
  obs.proximaConcluir = ok(loop('proxima', '--vivos', '0'), 'proxima concluir');

  // 8. registro determinístico, 2×
  obs.registro1 = ok(loop('registro'), 'registro 1');
  obs.registroTexto1 = readFileSync(join(a.entregas, 'registro.md'));
  obs.registro2 = ok(loop('registro'), 'registro 2');
  obs.registroTexto2 = readFileSync(join(a.entregas, 'registro.md'));

  obs.eventos = lerEventos(a.entregas);
  obs.eventosDoCartao = obs.eventos.filter((e) => e.sessao === 'S-novo');
  return obs;
}

// ────────────────────────────────────────────────────────────── onboarding

const G = (dir, args) => execFileSync('git', ['-c', 'user.useConfigOnly=true', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8', env: ambiente(T0), stdio: ['ignore', 'pipe', 'pipe'] });
const quando = { GIT_AUTHOR_DATE: '2025-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T12:00:00Z' };

/** Cópia da fixture de `test/fixtures/onboarding/<nome>` num repo git com `origin/HEAD` ⇒ `trunk` (commit inicial fora da janela de 60 dias). */
function repoDeOnboarding(base, nome, trunk, configAntes, rotulo) {
  const dir = join(base, `onb-${rotulo}`);
  mkdirSync(dir);
  cpSync(join(FIXTURES_ONB, nome), dir, { recursive: true });
  if (configAntes !== undefined) writeFileSync(join(dir, 'harness.config.json'), `${JSON.stringify(configAntes, null, 2)}\n`);
  G(dir, ['init', '-q', '-b', trunk]);
  G(dir, ['add', '-A']);
  execFileSync('git', ['-c', 'user.useConfigOnly=true', '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init'], { cwd: dir, env: { ...ambiente(T0), ...quando }, stdio: 'pipe' });
  const bare = join(base, `onb-${rotulo}.git`);
  mkdirSync(bare);
  G(bare, ['init', '-q', '--bare', '-b', trunk]);
  G(dir, ['remote', 'add', 'origin', bare]);
  G(dir, ['push', '-q', 'origin', trunk]);
  G(dir, ['remote', 'set-head', 'origin', trunk]);
  return dir;
}

const CLICKUP = "echo 'claude.ai ClickUp: https://x.test/mcp?t=SEGREDO-NAO-VAZAR - ✔ Connected'";
const SEM_MCP = "echo 'No MCP servers configured.'";

function claudeFalso(base, nome, corpo) {
  const bin = join(base, `bin-${nome}`);
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\n${corpo}\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return bin;
}

/** Escolha da resposta sobre a pergunta REAL de `detectar`: `ultima` = última opção; `outra` = 1ª opção diferente do default; `{ valor }` = esse valor, que TEM de estar nas opções; `default`. */
export function escolher(pergunta, modo) {
  const valores = pergunta.opcoes.map((o) => o.valor);
  if (ehObj(modo)) {
    if (!valores.some((v) => v === modo.valor)) throw new Error(`${pergunta.id}: ${JSON.stringify(modo.valor)} não está nas opções que detectar devolveu (${JSON.stringify(valores)})`);
    return modo.valor;
  }
  if (modo === 'ultima') return valores[valores.length - 1];
  if (modo === 'outra') return valores.find((v) => JSON.stringify(v) !== JSON.stringify(pergunta.default)) ?? pergunta.default;
  return pergunta.default;
}

function mesclar(base, patch) {
  const out = ehObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = ehObj(v) ? mesclar(ehObj(out[k]) ? out[k] : {}, v) : v;
  return out;
}

/**
 * A config que o onboarding tem de gravar, calculada SÓ das respostas e da saída real de `detectar` (itens e perguntas), pelas regras da spec
 * (ONB-1, D-1, D-2): 1 função independente do produto, que o teste compara byte a byte com o `harness.config.json` que o CLI escreveu.
 */
export function configEsperada(antes, itens, perguntas, respostas) {
  const por = Object.fromEntries(itens.map((i) => [i.item, i]));
  const ps = Object.fromEntries(perguntas.map((p) => [p.id, p]));
  const resolvido = {};
  for (const i of itens) {
    if (i.estado === 'detectado') resolvido[i.item] = i.valor;
    else if (ps[i.item] && respostas[i.item] !== null && respostas[i.item] !== undefined) resolvido[i.item] = respostas[i.item];
  }
  const { politica, autonomia, perfil } = respostas;
  const entrega = { politica, autonomia };
  if (politica === 'janela' && !ehObj(antes.entrega?.janela)) entrega.janela = { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '17:00', fuso: FUSO };
  const patch = { entrega };
  const fluxo = { resolvidoEm: HOJE };
  const pl = resolvido.planejamento;
  if (pl !== undefined) {
    if (ehObj(pl)) {
      fluxo.ferramenta = pl.ferramenta;
      if (typeof pl.mcp === 'string' && pl.mcp !== '') fluxo.mcp = pl.mcp;
    } else fluxo.ferramenta = pl;
  }
  patch.fluxo = fluxo;
  if (resolvido.versionamento !== undefined) {
    entrega.base = resolvido.versionamento;
    patch.versionamento = { resolvidoEm: HOJE };
  }
  const rotulo = ps.perfil.opcoes.find((o) => o.valor === perfil).rotulo;
  const alias = /revisão final (.+)$/.exec(rotulo)[1];
  const modeloAntes = antes.orquestracao?.modelo ?? {};
  // FX3 r2: 1º onboarding (paralelismo sem nenhum campo de calibração) grava a calibração por núcleos; com valor do dono, não mexe.
  // Conta escrita aqui, sem o código do onboarding: simultaneos = clamp(⌊n/4⌋, 1, 3), teto = clamp(⌊n/2⌋, 2, 8), limites = padrão, data de hoje.
  const parAntes = antes.orquestracao?.paralelismo;
  const calibrado = ehObj(parAntes) && ['simultaneos', 'teto', 'limites', 'calibradoEm'].some((k) => parAntes[k] !== undefined);
  const nuc = 8; // os núcleos que o ambiente congelado da caminhada declara (GABARITO_CAP_CORES: '8', `ambiente` acima)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  patch.orquestracao = { ...(calibrado ? {} : { paralelismo: { simultaneos: clamp(Math.floor(nuc / 4), 1, 3), teto: clamp(Math.floor(nuc / 2), 2, 8), limites: { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 }, calibradoEm: HOJE } }), perfil, modelo: { alias, politica: modeloAntes.politica ?? 'mais-potente', validadeDias: modeloAntes.validadeDias ?? 90, resolvidoEm: HOJE } };
  const naoDetectado = itens.map((i) => i.item).filter((item) => resolvido[item] === undefined);
  patch.onboarding = { resolvidoEm: HOJE, naoDetectado };
  const amb = resolvido.ambientes;
  if (amb !== undefined) {
    const outros = ehObj(amb) ? amb.outros : (por.ambientes.candidatos ?? []).filter((c) => c !== amb);
    patch.onboarding.fatos = { ambientes: { producao: ehObj(amb) ? amb.producao : amb, outros } };
  }
  if (resolvido.tipo_repo === 'repo-sem-app') patch.perfil = 'repo-sem-app';
  return `${JSON.stringify(mesclar(antes, patch), null, 2)}\n`;
}

/**
 * `detectar` pelo CLI ⇒ respostas montadas das perguntas que ELE devolveu (ids, ordem e opções) ⇒ `gravar --dry-run` ⇒ `gravar` ⇒ o arquivo.
 * `modos` = modo de `escolher` por id (`default` onde falta).
 */
function onboardar(a, { rotulo, nome, trunk, configAntes, claude, modos = {} }) {
  const dir = repoDeOnboarding(a.base, nome, trunk, configAntes, rotulo);
  const bin = claudeFalso(a.base, rotulo, claude);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const onb = (...args) => a.rodarCom('onboarding.mjs', [...args, '--root', dir, '--hoje', HOJE, '--fuso', FUSO], { env, congelar: false });
  const antesTexto = (() => { try { return readFileSync(join(dir, 'harness.config.json'), 'utf8'); } catch { return null; } })();
  const detectar = onb('detectar');
  if (detectar.rc !== 0 || detectar.j?.ok !== true) throw new Error(`detectar ${nome}: ${detectar.out} ${detectar.err}`);
  const respostas = {};
  for (const p of detectar.j.perguntas) respostas[p.id] = escolher(p, modos[p.id] ?? 'default');
  const arquivo = join(a.base, `respostas-${rotulo}.json`);
  writeFileSync(arquivo, JSON.stringify({ ...respostas, _previa: detectar.j.itens }));
  const seco = onb('gravar', '--respostas', arquivo, '--dry-run');
  const aposSeco = (() => { try { return readFileSync(join(dir, 'harness.config.json'), 'utf8'); } catch { return null; } })();
  const gravar = onb('gravar', '--respostas', arquivo);
  const depois = readFileSync(join(dir, 'harness.config.json'), 'utf8');
  return { dir, detectar, respostas, seco, aposSeco, antesTexto, gravar, depois, config: antesTexto === null ? {} : JSON.parse(antesTexto), tmp: readdirSync(dir).filter((f) => f.includes('.tmp')) };
}

/** 1.1.x: sem `autonomia`, política `continua`, `branchPadrao` em regex, `fluxo` com a ferramenta e o modelo resolvido na 1.1. */
const CONFIG_1_1 = {
  _comment: 'config da 1.1.x',
  gates: { suites: ['npm test'] },
  entrega: { politica: 'continua' },
  fluxo: { ferramenta: 'arquivos', idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3 },
  versionamento: { branchPadrao: '^(feat|fix|enabler)/[A-Z]+-\\d+-.+$', tiposComEscopoDePbi: ['feat', 'fix', 'enabler'] },
  orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: '2026-09-01', validadeDias: 60 }, paralelismo: { simultaneos: 3, teto: 4 } },
};

function caminharOnboarding(a) {
  return {
    completa: onboardar(a, { rotulo: 'completa', nome: 'completa', trunk: 'trunk', claude: CLICKUP, modos: { politica: { valor: 'janela' }, autonomia: 'outra', perfil: 'ultima' } }),
    monorepo: onboardar(a, { rotulo: 'monorepo', nome: 'monorepo', trunk: 'main', claude: SEM_MCP, modos: { politica: 'outra', autonomia: 'default', perfil: 'outra', tipo_repo: 'outra' } }),
    configAntiga: onboardar(a, { rotulo: 'antiga', nome: 'completa', trunk: 'trunk', claude: CLICKUP, configAntes: CONFIG_1_1 }),
    configAntigaAntes: CONFIG_1_1,
  };
}

/** Caminhada inteira; o temporário não fica para trás se ela falhar no meio. */
export function caminhar(opcoes = {}) {
  const a = montar();
  try {
    opcoes.aposMontar?.(a);
    const obs = { dir: a.dir, base: a.base, entregas: a.entregas };
    Object.assign(obs, loopAprendeEVolta(a));
    obs.onboarding = caminharOnboarding(a);
    return obs;
  } catch (erro) {
    limparSemLancar({ base: a.base });
    throw erro;
  }
}

/** Apaga o diretório temporário que `montar` criou (`<tmp>/fumaca-e5-*`). Recusa qualquer outro caminho. */
export function limpar(obs) {
  if (typeof obs?.base !== 'string' || !basename(obs.base).startsWith(PREFIXO) || realpathSync(dirname(obs.base)) !== realpathSync(tmpdir())) throw new Error(`recuso apagar fora do temporário da fumaça: ${String(obs?.base)}`);
  rmSync(obs.base, { recursive: true, force: true });
}

export function limparSemLancar(obs) {
  try { limpar(obs); } catch { /* o que a suíte reporta é a asserção que falhou, não a limpeza */ }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = caminhar();
  try {
    process.stdout.write(`${JSON.stringify({ proximaAprender: o.proximaAprender.j, proximaDespacha: o.proximaDespacha.j, pousar: o.pousar.j, cartao: o.cartao.j, doctorAberto: o.doctorAberto.j?.avisos, registro: o.registro1.j, config: o.onboarding.completa.depois }, null, 1)}\n`);
  } finally {
    limpar(o);
  }
}

#!/usr/bin/env node
/**
 * Aceites da E5a (GM-13 T17): monta o repo descartável, informa o estado ao `aceite-e5.exp` e mede. FORA de `npm test`. Sem LLM aqui: lê só o que o
 * aceite produziu (diário, `mod.jsonl` do observador, transcripts do Claude Code). Diário ilegível ou ferramenta falhando reprova, nunca vira "0".
 *
 *   avaliar-e5.mjs montar <1|2> <destino> <plugin-root>   repo descartável: T1 integrada (fronteira aberta); no aceite 1, 1 aprendizado D plantado
 *   avaliar-e5.mjs falha <destino>                        mod de teste que recusa `prompt.submit` de origem `plugin` (aceite 2)
 *   avaliar-e5.mjs estado <repo> <rundir> <plugin-root>   uma linha JSON (contagens) para o .exp decidir quando digitar e parar
 *   avaliar-e5.mjs relatorio <1|2> <repo> <rundir> <plugin-root>   número por critério e PASSA | FALHA | NAO_PROVADO (rc 0 só se PASSA)
 *   avaliar-e5.mjs s4 <repo-copia> <plugin-root>          S4: caracteres do contexto do SessionStart (cartão + instantâneo) sobre o diário de uma CÓPIA do repo; linha de retomada e decisões
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ENTREGA = 'GM-99';
const MARCA = 'MARCA-T17-CONFIRA-O-BUILD-ANTES-DE-INTEGRAR';
const SPEC = `# GM-99: entrega de aceite da E5a\n\n${Array.from({ length: 3 }, (_, i) => `**REQ-A-${i + 1}** Requisito ${i + 1} do aceite.\n`).join('\n')}`;

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=aceite@example.invalid', '-c', 'user.name=Aceite GM-99', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const cli = (repo, plugin, script, args, input) => {
  const r = spawnSync(process.execPath, [join(plugin, 'gates', 'scripts', script), ...args], { cwd: repo, encoding: 'utf8', input });
  let j = null;
  try { j = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* texto */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};
const ok = (r, rotulo) => { if (r.rc !== 0 || r.j?.ok !== true) throw new Error(`${rotulo}: rc ${r.rc} ${r.out} ${r.err}`); return r; };
const jsonl = (arq) => (existsSync(arq) ? readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _ilegivel: true }; } }) : []);

function montar(aceite, destino, plugin) {
  if (!['1', '2'].includes(aceite)) throw new Error('aceite 1 ou 2');
  const dest = resolve(destino);
  if (existsSync(dest)) throw new Error(`destino já existe: ${dest}`);
  for (const d of ['docs', 'src', '.claude/commands']) mkdirSync(join(dest, d), { recursive: true });
  writeFileSync(join(dest, 'src', '.gitkeep'), '');
  writeFileSync(join(dest, 'README.md'), 'Repositório descartável de aceite da E5a.\n');
  writeFileSync(join(dest, 'docs', 'spec.md'), SPEC);
  writeFileSync(join(dest, '.gitignore'), '.harness/\n');
  // comando do repo: um turno de modelo que NÃO é mensagem do dono (`command` não nulo), para o pouso não depender de uma mensagem digitada
  writeFileSync(join(dest, '.claude', 'commands', 'ok.md'), 'Responda apenas: ok\n');
  writeFileSync(join(dest, '.claude', 'settings.json'), `${JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } })}\n`);
  writeFileSync(join(dest, 'harness.config.json'), `${JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } })}\n`);
  git(dest, 'init', '-q', '-b', `enabler/${ENTREGA}-aceite-e5`);
  git(dest, 'add', '-A');
  git(dest, 'commit', '-q', '-m', 'chore(GM-99): repositorio descartavel de aceite da E5a');
  const entregas = join(dest, '.harness', 'entregas', ENTREGA);
  mkdirSync(entregas, { recursive: true });
  copyFileSync(join(AQUI, 'plano-e5.json'), join(entregas, 'plano.json'));
  writeFileSync(join(dest, '.harness', 'capacidade.json'), `${JSON.stringify({ hostname: hostname(), slots_max: 2, rss_pico_mb: 100, tmpdir_mb: 10, cpu_total: 1, load_medido: 200, fixture: true })}\n`);
  const stdin = JSON.stringify({ session_id: 'S-dono', cwd: dest, hook_event_name: 'UserPromptExpansion', command_name: 'gabarito-mestre:aprovar', command_args: '', command_source: 'plugin' });
  const ap = cli(dest, plugin, 'aprovar-spec.mjs', [], stdin);
  if (ap.rc !== 0) throw new Error(`aprovar-spec: ${ap.out} ${ap.err}`);
  const loop = (...a) => ok(cli(dest, plugin, 'loop.mjs', a), a.join(' '));
  loop('abrir', 'T1'); loop('iniciar', 'T1', 'implementador');
  const wt = join(dest, '.harness', 'worktrees', 'T1');
  writeFileSync(join(wt, 'src', 't1.mjs'), 'export const t1 = 1;\n');
  git(wt, 'add', 'src/t1.mjs'); git(wt, 'commit', '-q', '-m', 'feat(GM-99): T1');
  loop('concluir', 'T1'); loop('iniciar', 'T1', 'revisor'); loop('veredito', 'T1', 'APROVADO', '1', '0', '0'); loop('integrar', 'T1');
  let plantado = null;
  if (aceite === '1') {
    // o aprendizado do "gatilho anterior": E/D com evidência (o `task.integrada` de T1), destino instantâneo
    const r = loop('aprendizado', 'E', 'D', '--regra', MARCA, '--entra-em', 'instantaneo', '--eventos', 'loop:1');
    plantado = r.j;
  }
  console.log(JSON.stringify({ repo: dest, aceite, marca: aceite === '1' ? MARCA : null, plantado: plantado?.ok === true }));
}

function falha(destino) {
  const d = resolve(destino);
  if (existsSync(d)) throw new Error(`destino já existe: ${d}`);
  mkdirSync(join(d, '.claude-plugin'), { recursive: true });
  writeFileSync(join(d, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'falha-submit-t17', version: '0.0.1', description: 'Mod de teste (GM-13 T17): recusa prompt.submit de origem plugin.' })}\n`);
  mkdirSync(join(d, 'hooks'), { recursive: true });
  writeFileSync(join(d, 'hooks', 'hooks.json'), `${JSON.stringify({ modules: ['../register.mjs'] })}\n`);
  writeFileSync(join(d, 'register.mjs'), `// só teste: recusa o submit do pouso (origem plugin) e registra em $OBS_DIR/falha.jsonl
let dir = null;
let buf = [];
export const register = (on) => {
  on('session.start', async ($, e, next) => { try { dir = (await $.env.get('OBS_DIR')) ?? null; } catch { dir = null; } return next(e); });
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'plugin') return next(e);
    buf.push(JSON.stringify({ ev: 'submit-recusado', chars: typeof e.text === 'string' ? e.text.length : null }));
    if (dir !== null) { try { await $.fs.write(dir + '/falha.jsonl', buf.join('\\n') + '\\n'); } catch { /* sem escrita: o diário continua a prova */ } }
    return { drop: 'forcado pelo aceite 2' };
  });
};
`);
  console.log(JSON.stringify({ falha: d }));
}

function pastaTranscripts(repo) {
  const cfg = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(cfg, 'projects', realpathSync(repo).replace(/[^A-Za-z0-9-]/g, '-'));
}

/** Eventos de todas as sessões do diário da entrega, em ordem de gravação (ts, depois sessão/seq). `{ok:false}` se ilegível. */
function lerDiario(repo) {
  const dir = join(repo, '.harness', 'entregas', ENTREGA);
  if (!existsSync(dir)) return { ok: false, motivo: 'pasta da entrega ausente' };
  const evs = [];
  for (const n of readdirSync(dir).filter((x) => /^events\..+\.jsonl$/.test(x))) {
    for (const e of jsonl(join(dir, n))) {
      if (e._ilegivel === true) return { ok: false, motivo: `linha ilegível em ${n}` };
      evs.push(e);
    }
  }
  evs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.sessao < b.sessao ? -1 : a.sessao > b.sessao ? 1 : a.seq - b.seq));
  return { ok: true, eventos: evs };
}

const PROGRESSO = new Set(['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta', 'ci.resultado', 'spec.emendada', 'emenda.rejeitada', 'aprendizado', 'aprendizado.nada']);
const conta = (evs, tipo) => evs.filter((e) => e.tipo === tipo).length;

function estado(repo, rundir) {
  const d = lerDiario(repo);
  const mod = jsonl(join(rundir, 'obs', 'mod.jsonl'));
  if (!d.ok) { console.log(JSON.stringify({ ok: false, motivo: d.motivo })); return; }
  const ev = d.eventos;
  const ip = ev.map((e) => e.tipo).lastIndexOf('sessao.pouso');
  console.log(JSON.stringify({
    ok: true, pouso: conta(ev, 'sessao.pouso'), retomada: conta(ev, 'sessao.retomada'), dono: conta(ev, 'dono.mensagem'), parar: conta(ev, 'loop.parar'),
    progresso_depois: ip < 0 ? 0 : ev.slice(ip + 1).filter((e) => PROGRESSO.has(e.tipo)).length,
    submits: mod.filter((e) => e.ev === 'prompt.submit').length, session_end_clear: mod.filter((e) => e.ev === 'session.end' && e.reason === 'clear').length,
  }));
}

const linha = (rotulo, valor, esperado, passa) => ({ rotulo, valor, esperado, passa });

/** Texto das mensagens de usuário dos transcripts do repo (string ou blocos de texto). */
function usuarios(repo) {
  const pasta = pastaTranscripts(repo);
  const out = [];
  if (!existsSync(pasta)) return { ok: false, motivo: `sem pasta de transcripts: ${pasta}`, msgs: out };
  for (const n of readdirSync(pasta).filter((x) => x.endsWith('.jsonl'))) {
    for (const o of jsonl(join(pasta, n))) {
      if (o.type !== 'user') continue;
      const c = o.message?.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
      if (t !== '') out.push({ arq: n, ts: o.timestamp, texto: t });
    }
  }
  return { ok: true, msgs: out };
}

function relatorio(aceite, repo, rundir) {
  const d = lerDiario(repo);
  const mod = jsonl(join(rundir, 'obs', 'mod.jsonl'));
  const criterios = [];
  if (!d.ok) { console.log(JSON.stringify({ aceite, veredito: 'FALHA', motivo: `diário ilegível: ${d.motivo}`, criterios })); process.exit(1); }
  const ev = d.eventos;
  const pouso = conta(ev, 'sessao.pouso'); const retomada = conta(ev, 'sessao.retomada'); const parar = conta(ev, 'loop.parar'); const dono = conta(ev, 'dono.mensagem');
  const ip = ev.map((e) => e.tipo).lastIndexOf('sessao.pouso');
  const depois = ip < 0 ? [] : ev.slice(ip + 1).filter((e) => PROGRESSO.has(e.tipo));
  const clears = mod.filter((e) => e.ev === 'session.end' && e.reason === 'clear').length;
  const submits = mod.filter((e) => e.ev === 'prompt.submit');
  const doPlugin = submits.filter((s) => s.origem === 'plugin').length;
  const doComposer = submits.filter((s) => s.origem === 'composer');
  // `/ok` e `/exit` são comandos do compositor (command.run): só o submit SEM comando é mensagem do dono (S2: o compositor manda `command: null`)
  const comandosComposer = mod.filter((e) => e.ev === 'command.run' && e.origem === 'composer' && e.comando !== 'exit').length;
  const digitadas = doComposer.length - comandosComposer;
  const naoDono = submits.filter((s) => s.origem !== 'composer').map((s) => s.origem);
  const sends = existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n') : [];
  const texto = sends.map((l) => /^\d+ digitar (.*)$/.exec(l)?.[1]).filter((t) => typeof t === 'string' && !t.startsWith('/')).at(-1) ?? null;
  const dm = ev.find((e) => e.tipo === 'dono.mensagem');
  const status = existsSync(join(rundir, 'exp.status')) ? readFileSync(join(rundir, 'exp.status'), 'utf8').trim() : 'SEM_STATUS';
  let naoProvado = status.startsWith('NAO_PROVADO') || status === 'SEM_STATUS' ? status : null;
  if (aceite === '1') {
    const u = usuarios(repo);
    const retomadas = u.msgs.filter((m) => m.texto.includes('Aprendizados (')); // a mensagem do pouso traz o instantâneo (CABECALHO + instantâneo)
    const comMarca = u.msgs.filter((m) => m.texto.includes(MARCA)).length;
    const ret = ev.find((e) => e.tipo === 'sessao.retomada');
    criterios.push(
      linha('sessao.pouso', pouso, 1, pouso === 1),
      linha('sessao.retomada (via mod)', retomada, 1, retomada === 1 && ret?.dados?.via === 'mod'),
      linha('session.end reason=clear', clears, 1, clears === 1),
      linha('submit de origem plugin (a retomada)', doPlugin, 1, doPlugin === 1),
      linha('mensagens do transcript com o bloco Aprendizados', retomadas.length, '>= 1', u.ok && retomadas.length >= 1),
      linha('mensagens do transcript com a regra plantada', comMarca, '>= 1', u.ok && comMarca >= 1),
      linha('submit de origem composer sem comando (mensagem digitada)', digitadas, 1, digitadas === 1),
      linha(`dono.mensagem no diário (1 digitada; ${naoDono.length} submits de origem ${[...new Set(naoDono)].join('/')} não gravam)`, dono, 1, dono === 1),
      linha('dono.mensagem: chars e sha256 são os da mensagem digitada', dm === undefined || texto === null ? null : `${dm.dados?.chars}/${String(dm.dados?.sha256).slice(0, 8)}`,
        texto === null ? '?' : `${texto.length}/${createHash('sha256').update(texto).digest('hex').slice(0, 8)}`,
        dm !== undefined && texto !== null && dm.dados?.chars === texto.length && dm.dados?.sha256 === createHash('sha256').update(texto).digest('hex')),
      linha('loop.parar', parar, 0, parar === 0),
    );
    if (!u.ok) naoProvado ??= u.motivo;
  } else {
    const rec = jsonl(join(rundir, 'obs', 'falha.jsonl'));
    criterios.push(
      linha('sessao.pouso', pouso, 1, pouso === 1),
      linha('sessao.retomada', retomada, 0, retomada === 0),
      linha('loop.parar', parar, 0, parar === 0),
      linha('eventos de progresso depois do pouso (wakeup, S3)', depois.length, '>= 1', depois.length >= 1),
      linha('session.end reason=clear (1 só /clear)', clears, 1, clears === 1),
      linha('submit do pouso recusado pelo mod de teste', rec.length, '>= 1', rec.length >= 1),
      linha('submit de origem scheduled-trigger (wakeup)', submits.filter((s) => s.origem === 'scheduled-trigger').length, '>= 1', submits.some((s) => s.origem === 'scheduled-trigger')),
    );
  }
  const falhou = criterios.filter((c) => !c.passa);
  const veredito = falhou.length > 0 ? 'FALHA' : naoProvado !== null ? 'NAO_PROVADO' : 'PASSA';
  console.log(JSON.stringify({ aceite, veredito, exp_status: status, naoProvado, criterios }, null, 1));
  process.exit(veredito === 'PASSA' ? 0 : 1);
}

/** S4 sobre um diário real (CÓPIA do repo: o hook grava `sessao.inicio` e heartbeat nela): tamanho do contexto do SessionStart e presença das partes. */
function s4(repoCopia, plugin) {
  const repo = resolve(repoCopia);
  const entrada = JSON.stringify({ session_id: 'S4', source: 'clear', cwd: repo });
  const r = spawnSync(process.execPath, [join(plugin, 'gates', 'scripts', 'cartao-sessao.mjs'), '--hook', '--root', repo, '--plugin-root', plugin], { cwd: repo, encoding: 'utf8', input: entrada });
  let ctx = null;
  try { const j = JSON.parse(r.stdout); ctx = (j.hookSpecificOutput ?? j).additionalContext; } catch { /* abaixo */ }
  if (r.status !== 0 || typeof ctx !== 'string') { console.log(JSON.stringify({ ok: false, rc: r.status, erro: r.stderr.slice(0, 200) })); process.exit(1); }
  const linhas = ctx.split('\n');
  const iDiario = linhas.findIndex((l) => l.startsWith('Diário:'));
  const eventos = linhas.filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l));
  console.log(JSON.stringify({
    ok: true, total_chars: ctx.length, limite: 4329, dentro_do_limite: ctx.length <= 4329,
    cartao_chars: iDiario < 0 ? null : linhas.slice(0, iDiario).join('\n').length, instantaneo_chars: iDiario < 0 ? null : linhas.slice(iDiario).join('\n').length,
    linha_de_retomada: /^Loop da entrega \S+ em pouso: rode loop\.mjs proxima e siga\.$/m.test(ctx),
    decisoes: linhas.filter((l) => /^Decis/.test(l)).length, bloco_aprendizados: linhas.find((l) => /^Aprendizados \(\d+\):/.test(l)) ?? null, eventos_no_instantaneo: eventos.length,
  }));
}

const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === 'montar') montar(a[0], a[1], a[2]);
  else if (cmd === 'falha') falha(a[0]);
  else if (cmd === 'estado') estado(a[0], a[1]);
  else if (cmd === 'relatorio') relatorio(a[0], a[1], a[2]);
  else if (cmd === 's4') s4(a[0], a[1]);
  else { console.error('uso: avaliar-e5.mjs montar|falha|estado|relatorio|s4 ...'); process.exit(2); }
} catch (e) { console.error(String(e.message ?? e)); process.exit(1); }

#!/usr/bin/env node
/**
 * Aceites da E4 (GM-12 T14): monta o repo descartável com a entrega 7/12, e lê as evidências que o `aceite-e4.exp` deixa em <rundir>
 * (bytes do pty em tty.raw, logs do observador, transcripts). FORA de `npm test`. LIMITE: o pty prova bytes e cores (SGR), não layout visto.
 *
 *   avaliar-e4.mjs montar <destino> <plugin-root>     repo descartável (recusa destino existente; nunca apaga): 12 tasks, 7 integradas, T8 em voo, emenda #1 aberta
 *   avaliar-e4.mjs parar <repo> <plugin-root>         grava `loop.parar` por fora, pelo CLI real (aceite 3)
 *   avaliar-e4.mjs tela <rundir> <cols> <rows>        reproduz tty.raw num emulador (pyte) e imprime JSON {linhas, botoes:[{rotulo,x,y}]} (x,y de 1 a N)
 *   avaliar-e4.mjs sgr <rundir> <texto>               imprime o SGR que antecede cada ocorrência do texto em tty.raw
 *   avaliar-e4.mjs osc9 <rundir> <texto>              conta notificações OSC 9 (iTerm2) com o texto
 *   avaliar-e4.mjs contar <rundir> <texto>            conta ocorrências do texto em tty.raw
 *   avaliar-e4.mjs agente <rundir>                    ctx pelo transcript (última linha com usage) e ids do observador × SubagentStart
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PY = process.env.T14_PY ?? 'python3'; // venv com `pyte` (instalado fora do repo)
const BRANCH = 'enabler/GM-99-aceite-e4';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=aceite@example.invalid', '-c', 'user.name=Aceite GM-99', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SPEC = `# GM-99: entrega de aceite da E4\n\n${Array.from({ length: 12 }, (_, i) => `**REQ-A-${i + 1}** Requisito ${i + 1} do aceite.\n`).join('\n')}`;

function cli(repo, plugin, script, args, input) {
  const r = spawnSync(process.execPath, [join(plugin, 'gates', 'scripts', script), ...args], { cwd: repo, encoding: 'utf8', input });
  let j = null;
  try { j = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* texto */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
}
function ok(r, rotulo) {
  if (r.rc !== 0 || r.j?.ok !== true) throw new Error(`${rotulo}: rc ${r.rc} ${r.out} ${r.err}`);
  return r;
}

function montar(destino, plugin) {
  const dest = resolve(destino);
  if (existsSync(dest)) throw new Error(`destino já existe: ${dest}`);
  mkdirSync(join(dest, 'docs'), { recursive: true });
  mkdirSync(join(dest, 'src'));
  mkdirSync(join(dest, '.claude'));
  writeFileSync(join(dest, 'src', '.gitkeep'), '');
  writeFileSync(join(dest, 'README.md'), 'Repositório descartável de aceite da E4.\nSegunda linha.\n');
  writeFileSync(join(dest, 'docs', 'spec.md'), SPEC);
  writeFileSync(join(dest, '.gitignore'), '.harness/\n');
  writeFileSync(join(dest, '.claude', 'settings.json'), `${JSON.stringify({ enabledPlugins: { "superpowers@claude-plugins-official": true } })}\n`);
  writeFileSync(join(dest, 'harness.config.json'), `${JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 3 } })}\n`);
  git(dest, 'init', '-q', '-b', BRANCH);
  git(dest, 'add', '-A');
  git(dest, 'commit', '-q', '-m', 'chore(GM-99): repositorio descartavel de aceite da E4');
  const entregas = join(dest, '.harness', 'entregas', 'GM-99');
  mkdirSync(entregas, { recursive: true });
  copyFileSync(join(AQUI, 'plano-e4.json'), join(entregas, 'plano.json'));
  writeFileSync(join(dest, '.harness', 'capacidade.json'), `${JSON.stringify({ hostname: hostname(), slots_max: 3, rss_pico_mb: 100, tmpdir_mb: 10, cpu_total: 1, load_medido: 200, fixture: true })}\n`);
  // spec aprovada pelo hook real (stdin do TUI)
  const stdin = JSON.stringify({ session_id: 'S-dono', cwd: dest, hook_event_name: 'UserPromptExpansion', command_name: 'gabarito-mestre:aprovar', command_args: '', command_source: 'plugin' });
  const ap = cli(dest, plugin, 'aprovar-spec.mjs', [], stdin);
  if (ap.rc !== 0) throw new Error(`aprovar-spec: ${ap.out} ${ap.err}`);
  const loop = (...a) => ok(cli(dest, plugin, 'loop.mjs', a), a.join(' '));
  for (let n = 1; n <= 7; n++) {
    const t = `T${n}`;
    loop('abrir', t); loop('iniciar', t, 'implementador');
    const wt = join(dest, '.harness', 'worktrees', t);
    writeFileSync(join(wt, 'src', `t${n}.mjs`), `export const t${n} = ${n};\n`);
    git(wt, 'add', `src/t${n}.mjs`); git(wt, 'commit', '-q', '-m', `feat(GM-99): ${t}`);
    loop('concluir', t); loop('iniciar', t, 'revisor'); loop('veredito', t, 'APROVADO', '1', '0', '0'); loop('integrar', t);
  }
  loop('abrir', 'T8'); loop('iniciar', 'T8', 'implementador');
  const diff = join(entregas, 'emenda.diff');
  writeFileSync(diff, '+ **REQ-A-8** O painel mostra ao dono o que depende dele, com o comando.\n');
  loop('emenda', 'propor', '--req', 'REQ-A-8', '--task', 'T8', '--diff', diff, '--fato', 'falta o comando', '--alternativa', 'só o texto', '--evidencia', 'spec', '--causa', 'regra_negocio');
  const est = ok(cli(dest, plugin, 'painel.mjs', ['estado']), 'painel estado').j.estado;
  console.log(JSON.stringify({ repo: dest, feitas: est.plano.feitas, total: est.plano.total, depende: est.depende.map((d) => d.motivo), parar: est.parar }));
}

const PY_TELA = `
import sys, json, re, pyte
raw, cols, rows = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
s = pyte.Screen(cols, rows); st = pyte.Stream(s)
st.feed(open(raw, 'rb').read().decode('utf-8', 'replace'))
linhas = [l.rstrip() for l in s.display]
botoes = []
for y, l in enumerate(linhas):
    for m in re.finditer(r'\\[ ([^\\]\\[]+?) \\]', l):
        botoes.append({'rotulo': m.group(1), 'x': m.start() + 2, 'y': y + 1})
print(json.dumps({'linhas': linhas, 'botoes': botoes}, ensure_ascii=False))
`;

function tela(rundir, cols, rows) {
  const py = join(rundir, 'tela.py');
  writeFileSync(py, PY_TELA);
  const r = spawnSync(PY, ['-I', py, join(rundir, 'tty.raw'), cols, rows], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`pyte: ${r.stderr}`);
  process.stdout.write(r.stdout);
}

const bruto = (rundir) => readFileSync(join(rundir, 'tty.raw'), 'latin1');
const bytesDe = (txt) => Buffer.from(txt, 'utf8').toString('latin1');
const esc = (s) => s.replace(/\x1b/g, '\\e');

function sgr(rundir, texto) {
  const b = bruto(rundir); const alvo = bytesDe(texto); const out = [];
  let i = -1;
  while ((i = b.indexOf(alvo, i + 1)) !== -1) {
    const ant = b.slice(Math.max(0, i - 120), i);
    const m = /((?:\x1b\[[0-9;]*m)+)$/.exec(ant);
    out.push(m ? esc(m[1]) : '(sem SGR)');
  }
  console.log(JSON.stringify({ texto, n: out.length, sgr: [...new Set(out)] }));
}
function contar(rundir, texto) { const b = bruto(rundir); const alvo = bytesDe(texto); let n = 0; let i = -1; while ((i = b.indexOf(alvo, i + 1)) !== -1) n++; console.log(JSON.stringify({ texto, n })); }
function osc9(rundir, texto) {
  const b = bruto(rundir); const re = /\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)/g; const achados = [];
  for (let m; (m = re.exec(b)) !== null;) achados.push(Buffer.from(m[1], 'latin1').toString('utf8'));
  console.log(JSON.stringify({ total: achados.length, com_texto: achados.filter((a) => a.includes(texto)).length, amostra: achados.slice(0, 3) }));
}

function jsonl(arq) { return existsSync(arq) ? readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []; }

/** Última linha com `usage` do transcript do agente (contexto = input + cache_read + cache_creation) e ids: observador × SubagentStart. */
function agente(rundir) {
  const classico = jsonl(join(rundir, 'obs', 'classic.jsonl')).filter((e) => e.ev === 'SubagentStart');
  const mod = jsonl(join(rundir, 'obs', 'mod.jsonl'));
  const listas = mod.filter((e) => e.ev === 'agentes').flatMap((e) => e.lista ?? []);
  const res = { subagent_start: classico.map((e) => ({ agent: e.agent, sid: e.sid })), ids_lista_8: [...new Set(listas.map((a) => a.id))], transcripts: [] };
  // o SubagentStart clássico só traz `agent_id` e `session_id` nos campos que o observador grava: o transcript é <config>/projects/<pasta do repo>/<sessão>/subagents/agent-<id>.jsonl
  const proj = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  const achar = (sid, id) => {
    for (const d of existsSync(proj) ? readdirSync(proj) : []) { const f = join(proj, d, sid, 'subagents', `agent-${id}.jsonl`); if (existsSync(f)) return f; }
    return null;
  };
  for (const c of classico) {
    const arq = c.sid && c.agent ? achar(c.sid, c.agent) : null;
    if (arq === null) { res.transcripts.push({ agent: c.agent, arquivo: null }); continue; }
    const ls = readFileSync(arq, 'utf8').split('\n').filter((l) => l.includes('"usage"'));
    let ultima = null;
    for (const l of ls) { try { const u = JSON.parse(l)?.message?.usage; if (u && typeof u.input_tokens === 'number') ultima = u; } catch { /* linha partida */ } }
    res.transcripts.push({ agent: c.agent, arquivo: arq, ultima, ctx: ultima ? ultima.input_tokens + (ultima.cache_read_input_tokens ?? 0) + (ultima.cache_creation_input_tokens ?? 0) : null });
  }
  console.log(JSON.stringify(res));
}

const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === 'montar') montar(a[0], a[1]);
  else if (cmd === 'parar') console.log(JSON.stringify(ok(cli(a[0], a[1], 'loop.mjs', ['parar', 'nao_conseguiu']), 'parar').j));
  else if (cmd === 'tela') tela(a[0], a[1], a[2]);
  else if (cmd === 'sgr') sgr(a[0], a[1]);
  else if (cmd === 'osc9') osc9(a[0], a[1]);
  else if (cmd === 'contar') contar(a[0], a[1]);
  else if (cmd === 'agente') agente(a[0]);
  else { console.error('uso: avaliar-e4.mjs montar|parar|tela|sgr|osc9|contar|agente ...'); process.exit(2); }
} catch (e) { console.error(String(e.message ?? e)); process.exit(1); }

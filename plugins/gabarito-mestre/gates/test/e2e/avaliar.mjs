#!/usr/bin/env node
/**
 * Leitura das evidências dos aceites (GM-10 T13). Só lê: diário (lerEstrito + ordenar, do núcleo), logs do observador e `loop.mjs proxima`.
 *   avaliar.mjs estado <repo> <rundir> <plugin-root>     uma linha JSON, para o aceite-loop.exp decidir quando parar
 *   avaliar.mjs medidas <repo> <rundir> <plugin-root>          medições da r5 (transcripts, mod.jsonl, debug.log, diário): só números e nomes
 *   avaliar.mjs relatorio 0 <repo> <rundir> <plugin-root>     aceite 0 (fumaça): números e veredito. Os demais aceites só têm relatório
 *                                                            depois de um aceite 0 VERDE (ordem do brief); até lá não existem aqui.
 * Saída de ferramenta falhando ou diário ilegível reprova: nada aqui devolve verde por falta de dado.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENTREGA = 'GM-99';

export const linhas = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _ilegivel: true }; } }) : []);

export async function carregar(plugin) {
  const d = await import(pathToFileURL(join(plugin, 'gates/dist/diario.js')).href);
  const l = await import(pathToFileURL(join(plugin, 'gates/dist/loop.js')).href);
  return { d, l };
}

/** Diário ordenado; `{ ok:false, motivo }` se ilegível (reprova, nunca vazio). */
export async function diario(repo, plugin) {
  const { d, l } = await carregar(plugin);
  const dir = join(repo, '.harness', 'entregas', ENTREGA);
  const r = d.lerEstrito(dir);
  if (!r.ok) return { ok: false, motivo: r.motivo, dir };
  const o = l.ordenar(r.eventos);
  if (!o.ok) return { ok: false, motivo: 'ordenar: diário fora de ordem', dir };
  return { ok: true, eventos: o.eventos, dir, d, l };
}

export const agentesRunning = (mod) => {
  for (let i = mod.length - 1; i >= 0; i--) {
    const lista = mod[i].lista ?? mod[i].agentes;
    if (Array.isArray(lista)) return lista.filter((a) => a.st === 'running' || a.st === 'pending').length;
  }
  return 0;
};

export function proxima(repo, plugin, vivos) {
  try {
    const out = execFileSync('node', [join(plugin, 'gates/scripts/loop.mjs'), 'proxima', '--vivos', String(vivos)], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const o = JSON.parse(out.trim().split('\n').at(-1));
    return o.ok === true ? { ok: true, tipo: o.acao?.tipo, acao: o.acao, sinais: o.sinais } : { ok: false, o };
  } catch (e) {
    return { ok: false, erro: String(e.message).slice(0, 200) };
  }
}

async function estado(repo, rundir, plugin) {
  const dia = await diario(repo, plugin);
  const mod = linhas(join(rundir, 'mod.jsonl'));
  const cls = linhas(join(rundir, 'classic.jsonl'));
  const running = agentesRunning(mod);
  const ev = dia.ok ? dia.eventos : [];
  const p = dia.ok ? proxima(repo, plugin, running) : { ok: false };
  const out = {
    eventos: dia.ok ? ev.length : -1, obs: mod.length + cls.length, running,
    integradas: ev.filter((e) => e.tipo === 'task.integrada').length,
    acao: p.ok ? p.tipo : 'erro', parou: ev.some((e) => e.tipo === 'loop.parar'),
    pausa: existsSync(join(repo, '.harness', 'PAUSAR')),
  };
  console.log(JSON.stringify(out));
}

const pastaRel = (p, repo) => (typeof p === 'string' ? p.replace(repo, '<repo>') : p);

/** Aceite 0: critérios da sombra-t13 + sombra-t13c. Diário ilegível ou ferramenta falhando ⇒ REPROVADO, nunca verde. */
async function relatorio0(repo, rundir, plugin) {
  const dia = await diario(repo, plugin);
  if (!dia.ok) { console.log(JSON.stringify({ aceite: 0, veredito: 'REPROVADO', motivo: dia.motivo })); process.exitCode = 1; return; }
  const ev = dia.eventos;
  const n = (t) => ev.filter((e) => e.tipo === t).length;
  const cls = linhas(join(rundir, 'classic.jsonl'));
  const mod = linhas(join(rundir, 'mod.jsonl'));
  const sub = (o) => typeof o.agent === 'string' && o.agent !== '';
  const pre = cls.filter((o) => o.ev === 'PreToolUse');
  const porTipo = (tipo) => pre.filter((o) => o.agent_type === tipo);
  const impl = porTipo('gabarito-mestre:gabarito-implementador');
  // r6: todo implementador conta (não só o 1º). `alvo .git` é leitura de lista negada pela guarda (sombra-t13e, "(c) T13 r6"): relatada em
  // `deny_leitura_de_lista`, não reprova. Limite: `--output` também grava `alvo .git`, e a separação não o distingue.
  const idsImpl = [...new Set(impl.map((o) => String(o.agent).slice(0, 12)).filter((i) => i !== '' && i !== 'undefined'))];
  const denyImplTodos = ev.filter((e) => e.tipo === 'guarda.deny' && /subagent/.test(String(e.agente)) && idsImpl.some((i) => String(e.agente).includes(i)));
  const denyImpl = denyImplTodos.filter((e) => e.dados?.alvo !== '.git');
  const denyLista = denyImplTodos.filter((e) => e.dados?.alvo === '.git');
  const concluidas = ev.filter((e) => e.tipo === 'task.concluida');
  const debug = existsSync(join(rundir, 'debug.log')) ? readFileSync(join(rundir, 'debug.log'), 'utf8').split('\n') : [];
  const stops = debug.filter((l) => /Hooks: Stop \[node .*stop-loop\.mjs.*finished with status/.test(l)).length;
  const bloqueios = debug.filter((l) => /"Hook Stop \(Stop\) success/.test(l) && /"decision\\":\\"block/.test(l)).length;
  const avisosStop = debug.filter((l) => /"Hook Stop \(Stop\) success/.test(l)).map((l) => (l.match(/\[([a-z_]+)\]/) ?? [])[1]).filter(Boolean);
  const turnos = mod.filter((o) => o.ev === 'turn.complete' && o.agente === null).length;
  const divergentes = pre.filter((o) => sub(o) && o.cwd !== o.project_dir).length;
  const out = {
    aceite: 0,
    pouso: n('sessao.pouso'), retomada: n('sessao.retomada'), loop_parar: n('loop.parar'), veredito: n('review.veredito'),
    deny_total: n('guarda.deny'), deny_implementador: denyImpl.length, deny_leitura_de_lista: denyLista.length, implementadores_distintos: idsImpl.length,
    deny_outros: ev.filter((e) => e.tipo === 'guarda.deny').map((e) => ({ agente: String(e.agente).slice(0, 14), ...e.dados })),
    concluidas: concluidas.map((e) => ({ task: e.dados.task, sha: e.dados.sha })),
    pre_implementador: impl.length,
    project_dir_implementador: [...new Set(impl.map((o) => pastaRel(o.project_dir, repo)))],
    cwd_implementador: [...new Set(impl.map((o) => pastaRel(o.cwd, repo)))],
    cwd_diferente_de_project_dir_em_subagent: divergentes,
    stops_loop: stops, stops_com_block: bloqueios, avisos_stop: avisosStop, turn_complete_orquestrador: turnos,
    pendente_existe: existsSync(join(repo, '.harness', 'pouso-pendente.json')),
  };
  const sends = existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[1]) : [];
  out.digitacao_apos_prompt = sends.filter((t) => !['trust', 'prompt', 'exit'].includes(t)).length;
  const falhas = [];
  if (out.pouso < 1) falhas.push('sessao.pouso < 1');
  if (out.loop_parar !== 0) falhas.push('loop.parar > 0');
  if (out.deny_implementador !== 0) falhas.push('guarda.deny do implementador em caminho de trabalho > 0');
  if (out.concluidas.length < 1) falhas.push('sem task.concluida');
  if (out.veredito < 1) falhas.push('review.veredito < 1');
  if (out.pouso >= 1 && out.pendente_existe) falhas.push('marcador nao consumido');
  out.falhas = falhas;
  out.veredito_final = falhas.length === 0 ? 'VERDE' : 'REPROVADO';
  console.log(JSON.stringify(out, null, 1));
}

/** Medições da r5 (brief item 5): lê transcripts, mod.jsonl, debug.log e diário. Só números e nomes; comando com valor secreto não sai. */
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const segredo = (s) => String(s).replace(/(token|secret|key|senha|password|authorization)(["'=:\s]+)\S+/gi, '$1$2<omitido>').replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<longo>');

/** Pasta de transcripts do Claude Code para um repo: todo caractere fora de [A-Za-z0-9-] vira "-". */
export const pastaTranscripts = (repo, home) => join(home, '.claude', 'projects', realpathSync(repo).replace(/[^A-Za-z0-9-]/g, '-'));

/** Mensagens do assistente agrupadas por message.id (cada bloco é uma linha do transcript). */
export function mensagens(arquivo) {
  const porId = new Map();
  for (const o of linhas(arquivo)) {
    if (o.type !== 'assistant' || !o.message?.id) continue;
    const m = porId.get(o.message.id) ?? { id: o.message.id, ts: o.timestamp, blocos: [] };
    for (const b of o.message.content ?? []) if (b.type === 'tool_use') m.blocos.push({ nome: b.name, input: b.input ?? {} });
    porId.set(o.message.id, m);
  }
  return [...porId.values()];
}

export async function medidas(repo, rundir, plugin, home) {
  const dia = await diario(repo, plugin);
  if (!dia.ok) { console.log(JSON.stringify({ medidas: 'REPROVADO', motivo: dia.motivo })); process.exitCode = 1; return; }
  const ev = dia.eventos;
  const pasta = pastaTranscripts(repo, home);
  const sessoes = [...new Set(ev.map((e) => e.sessao))].filter((sid) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(sid))); // `loop` é o id do CLI, não uma sessão
  const ausentes = sessoes.filter((sid) => !existsSync(join(pasta, `${sid}.jsonl`)));
  const out = { pasta_existe: existsSync(pasta), sessoes: sessoes.length, transcripts_ausentes: ausentes.length };
  if (ausentes.length > 0) process.exitCode = 1; // transcript que falta é medição que falta, nunca zero
  // (i) iniciar e Agent na mesma mensagem
  let msgs = 0, comIniciar = 0, comAgent = 0, juntos = 0, agentsTotal = 0, bashIniciarCmds = 0;
  const despachos = [];
  for (const sid of sessoes) {
    for (const m of mensagens(join(pasta, `${sid}.jsonl`))) {
      msgs += 1;
      const ini = m.blocos.filter((b) => b.nome === 'Bash' && /\biniciar\s+[A-Za-z0-9_-]+\s+(implementador|revisor|correcao)\b/.test(String(b.input.command ?? '')));
      const ag = m.blocos.filter((b) => b.nome === 'Agent' || b.nome === 'Task');
      if (ini.length) comIniciar += 1;
      bashIniciarCmds += ini.length;
      if (ag.length) comAgent += 1;
      agentsTotal += ag.length;
      if (ini.length && ag.length) juntos += 1;
      for (const a of ag) despachos.push({ sid: sid.slice(0, 8), ts: m.ts, tipo: String(a.input.subagent_type ?? ''), prompt: String(a.input.prompt ?? ''), com_iniciar: ini.length > 0 });
    }
  }
  out.i_iniciar_e_agent = { mensagens: msgs, com_iniciar: comIniciar, com_agent: comAgent, juntas: juntos, agents: agentsTotal, bash_iniciar: bashIniciarCmds };
  // (iv) brief traz o caminho de achados e o arquivo existe
  out.iv_briefs = despachos.map((d, i) => {
    const caminho = (d.prompt.match(/[\w./~-]*review-r\d+\.md/) ?? [null])[0];
    const abs = caminho === null ? null : (caminho.startsWith('/') ? caminho : join(repo, caminho));
    return { n: i + 1, sessao: d.sid, tipo: d.tipo.split(':').pop(), traz_achados: caminho !== null, caminho: caminho === null ? null : pastaRel(caminho, repo), existe: abs === null ? null : existsSync(abs), chars: d.prompt.length };
  });
  const reabertas = ev.filter((e) => e.tipo === 'task.reaberta').length;
  out.iv_reabertas = reabertas;
  out.iv_reprovados = ev.filter((e) => e.tipo === 'review.veredito' && e.dados?.veredito === 'REPROVADO').length; // 0 ⇒ o caminho de correção com achados não ocorreu
  // (ii) marcador em .harness
  const mod = linhas(join(rundir, 'mod.jsonl'));
  const debug = existsSync(join(rundir, 'debug.log')) ? readFileSync(join(rundir, 'debug.log'), 'utf8').split('\n') : [];
  const exp = existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8') : '';
  const marc = mod.filter((o) => o.ev === 'pendente');
  out.ii_marcador = {
    deny_pouso_no_debug: debug.filter((l) => /tool\.call Agent .*resolved by a hooks module \(deny: pouso: contexto em/.test(l)).length,
    deny_pouso_com_acao_pousar: debug.filter((l) => /resolved by a hooks module \(deny: pouso: contexto em .*(pouse|pousar)/.test(l)).length,
    apareceu_no_observador: marc.filter((o) => o.existe === true).length, consumido_depois: marc.filter((o) => o.existe === false).length,
    mencoes_debug: debug.filter((l) => /pouso-pendente/.test(l)).length, perguntas_de_permissao: (exp.match(/PERGUNTA-DE-PERMISSAO/g) ?? []).length,
    instrumento: marc.length > 0 ? 'observador' : 'ausente',
  };
  // (iii) new Date() em host real. `negadoAte` é variável do mod, ilegível de fora; o observador roda depois do mod na cadeia e NÃO vê
  // tool.call negado (o deny do mod não chama next). Proxy: `iso` = `new Date().toISOString()` do observador, mesmo host, em cada linha.
  const comIso = mod.filter((o) => typeof o.iso === 'string');
  out.iii_new_date = {
    tool_call_negado_visto_pelo_observador: mod.filter((o) => o.ev === 'tool.call' && o.negado === true).length,
    linhas_com_iso: comIso.length, linhas: mod.length, iso_formato_igual_ao_ts_do_diario: comIso.filter((o) => ISO.test(o.iso)).length,
    ts_diario_formato_ok: ev.every((e) => ISO.test(String(e.ts))), ts_diario_n: ev.length,
    deriva_ms_iso_vs_clock_max: comIso.length ? Math.max(...comIso.filter((o) => typeof o.t === 'number').map((o) => Math.abs(Date.parse(o.iso) - o.t))) : null,
    deny_do_agent_no_debug: debug.filter((l) => /tool\.call Agent .*resolved by a hooks module \(deny/.test(l)).length,
  };
  // (v) block x turn.complete
  const epoch = (l) => Date.parse(l.slice(0, 24));
  const blocks = debug.filter((l) => /"Hook Stop \(Stop\) success/.test(l) && /"decision\\":\\"block/.test(l)).map(epoch);
  const stops = debug.filter((l) => /Hooks: Stop \[node .*stop-loop\.mjs.*finished with status/.test(l)).map(epoch);
  const turnos = mod.filter((o) => o.ev === 'turn.complete' && o.agente === null).map((o) => o.t);
  out.v_block_x_turn = {
    stops: stops.length, blocks: blocks.length, turn_complete_orquestrador: turnos.length,
    turn_complete_em_5s_do_block: blocks.map((b) => turnos.filter((t) => Math.abs(t - b) <= 5000).length),
    turn_complete_apos_stop_ms: stops.map((s) => { const d = turnos.filter((t) => t >= s - 200).map((t) => t - s); return d.length ? Math.min(...d) : null; }),
  };
  // (vi) origem dos operacao.destrutiva
  out.vi_destrutiva = [];
  for (const e of ev.filter((x) => x.tipo === 'operacao.destrutiva')) {
    const aid = String(e.agente).replace(/^subagent:/, '');
    const arq = join(pasta, e.sessao, 'subagents', `agent-${aid}.jsonl`);
    const alvo = Date.parse(e.ts);
    const cands = existsSync(arq) ? mensagens(arq).flatMap((m) => m.blocos.filter((b) => b.nome === 'Bash').map((b) => ({ dt: Math.abs(Date.parse(m.ts) - alvo), cmd: String(b.input.command ?? '') }))).sort((a, b) => a.dt - b.dt) : [];
    let tipo = null;
    try { tipo = JSON.parse(readFileSync(join(pasta, e.sessao, 'subagents', `agent-${aid}.meta.json`), 'utf8')).agentType ?? null; } catch { /* sem meta */ }
    out.vi_destrutiva.push({ seq: e.seq, sessao: e.sessao.slice(0, 8), agente: String(e.agente).slice(0, 24), tipo_agente: tipo, dados: e.dados, transcript_existe: existsSync(arq), comando_mais_proximo: cands[0] ? { dt_ms: cands[0].dt, cmd: segredo(cands[0].cmd).slice(0, 200) } : null });
  }
  console.log(JSON.stringify(out, null, 1));
}

// ───────────────────────── r6: relatórios dos demais aceites ─────────────────────────
// Todo número sai de leitura depois da corrida (diário, logs do observador, transcripts); a tela nunca é evidência.
// Ferramenta falhando, dado ausente ou ilegível ⇒ REPROVADO ou NÃO PROVADO, nunca verde por vácuo.

const nodeCli = (script, args, { cwd, env, entrada } = {}) => {
  const r = spawnSync('node', [script, ...args], { cwd, env: { ...process.env, ...(env ?? {}) }, input: entrada, encoding: 'utf8' });
  const ultima = String(r.stdout ?? '').trim().split('\n').at(-1) ?? '';
  let json = null;
  try { json = JSON.parse(ultima); } catch { /* saída não é JSON */ }
  return { rc: r.status, json, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
};
const duKb = (p) => { try { return Number(execFileSync('du', ['-sk', p], { encoding: 'utf8' }).split(/\s/)[0]); } catch { return null; } };
const gitRc = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).status;
const epoch = (ts) => Date.parse(ts);

/** Aceite 5 (TMPDIR): `abrir`, comando com o `env` devolvido, `fechar`. `cwdRel`/`cmd` escolhem a suíte (fixture ou `gates`). */
function relatorio5(repo, rundir, plugin, cwdRel, cmd) {
  const loop = join(plugin, 'gates/scripts/loop.mjs');
  const ext = join(rundir, 'tmp-externo');
  mkdirSync(ext, { recursive: true });
  const base = { aceite: 5, comando: cmd, cwd_rel: cwdRel };
  const envShell = { TMPDIR: ext };
  const ab = nodeCli(loop, ['abrir', 'T1'], { cwd: repo, env: envShell });
  if (ab.rc !== 0 || ab.json?.ok !== true) { console.log(JSON.stringify({ ...base, veredito_final: 'REPROVADO', motivo: 'abrir falhou', saida: ab.json ?? ab.stderr.slice(0, 200) })); process.exitCode = 1; return; }
  const wt = ab.json.worktree;
  const tmp = ab.json.env?.TMPDIR ?? ab.json.tmpdir;
  const extAntes = duKb(ext);
  const t = spawnSync(cmd[0], cmd.slice(1), { cwd: join(wt, cwdRel), env: { ...process.env, TMPDIR: tmp }, encoding: 'utf8' });
  const antesKb = duKb(tmp);
  const extDepoisTeste = duKb(ext);
  const fe = nodeCli(loop, ['fechar', 'T1'], { cwd: repo, env: envShell });
  const depoisExiste = existsSync(tmp);
  const extDepois = duKb(ext);
  const out = {
    ...base, rc_comando: t.status, tmpdir_vigente_kb_antes_do_fechar: antesKb, tmpdir_existe_depois: depoisExiste,
    externa_kb_antes: extAntes, externa_kb_depois_do_teste: extDepoisTeste, externa_kb_depois: extDepois,
    fechar_ok: fe.json?.ok === true, fechar_erro: fe.json?.erro ?? null, fechar_mensagem: fe.json?.ok === true ? null : String(fe.json?.mensagem ?? fe.stderr).slice(0, 300),
    worktree_existe_depois: existsSync(wt),
  };
  let v = 'VERDE';
  const falhas = [];
  if (t.status !== 0) falhas.push('comando de teste falhou');
  if (!(antesKb > 0)) { v = 'NAO_PROVADO'; falhas.push('TMPDIR vigente com 0 KB antes do fechar (vácuo: a suíte não grava ali)'); }
  if (!out.fechar_ok) falhas.push('fechar falhou');
  if (depoisExiste) falhas.push('.tmp-gabarito existe depois do fechar');
  if (extAntes !== extDepois) falhas.push('pasta externa mudou');
  if (falhas.some((f) => !f.startsWith('TMPDIR vigente'))) v = 'REPROVADO';
  out.falhas = falhas;
  out.veredito_final = v;
  console.log(JSON.stringify(out, null, 1));
  if (v !== 'VERDE') process.exitCode = 1;
}

/** Aceite 4c (R24): `SubagentStop` com `cwd` na worktree e `CLAUDE_PROJECT_DIR` na principal. Controle negativo: sem a variável a medição se perde. */
async function relatorio4c(repo, rundir, plugin, rundirReal) {
  const { d: nucleo } = await carregar(plugin);
  const loop = join(plugin, 'gates/scripts/loop.mjs');
  const hook = join(plugin, 'gates/scripts/uso-subagent.mjs');
  const ab = nodeCli(loop, ['abrir', 'T1'], { cwd: repo });
  if (ab.rc !== 0 || ab.json?.ok !== true) { console.log(JSON.stringify({ aceite: '4c', veredito_final: 'REPROVADO', motivo: 'abrir falhou', saida: ab.json ?? ab.stderr.slice(0, 200) })); process.exitCode = 1; return; }
  const wt = ab.json.worktree;
  const home = join(rundir, 'home-4c');
  const projetos = join(home, '.claude', 'projects', 'p');
  mkdirSync(projetos, { recursive: true });
  const msg = (id, i, o, cr, cc) => JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc } } });
  const esperado = { input_tokens: 30, output_tokens: 300, cache_read: 3000, cache_creation: 30000 };
  const transcricao = join(projetos, 'agent-a4c0000000000001.jsonl');
  writeFileSync(transcricao, `${[msg('m1', 10, 100, 1000, 10000), msg('m2', 20, 200, 2000, 20000)].join('\n')}\n`);
  const stdin = (id) => JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'gabarito-mestre:gabarito-implementador', agent_id: id, session_id: '4c4c4c4c-0000-4000-8000-000000000001', cwd: wt, agent_transcript_path: transcricao });
  const lerMed = (raiz, id) => { try { return nucleo.ler(join(raiz, '.harness', 'entregas', ENTREGA)).filter((e) => e.tipo === 'custo.medicao' && e.agente === `subagent:${id}`); } catch { return []; } };
  // positivo: CLAUDE_PROJECT_DIR = principal, cwd = worktree
  const pos = nodeCli(hook, [], { cwd: wt, env: { HOME: home, CLAUDE_PROJECT_DIR: repo }, entrada: stdin('a4c0000000000001') });
  // controle negativo: sem CLAUDE_PROJECT_DIR (cwd na worktree, sem .harness lá) a medição se perde: prova que o positivo não é vácuo
  const neg = nodeCli(hook, [], { cwd: wt, env: { HOME: home, CLAUDE_PROJECT_DIR: '' }, entrada: stdin('a4c0000000000002') });
  const medPos = lerMed(repo, 'a4c0000000000001');
  const medNeg = lerMed(repo, 'a4c0000000000002');
  const emWt = existsSync(join(wt, '.harness'));
  const out = {
    aceite: '4c', rc_positivo: pos.rc, rc_controle: neg.rc, medicoes_na_principal: medPos.length, dados_da_medicao: medPos[0]?.dados ?? null, esperado,
    soma_confere: medPos.length === 1 && Object.entries(esperado).every(([k, v]) => medPos[0].dados?.[k] === v),
    controle_sem_variavel_medicoes: medNeg.length, harness_criado_na_worktree: emWt,
  };
  // real: quantos SubagentStop reais tiveram cwd ≠ CLAUDE_PROJECT_DIR (relatado; 0 ⇒ só o controle prova)
  if (rundirReal) {
    const reais = linhas(join(rundirReal, 'classic.jsonl')).filter((o) => o.ev === 'SubagentStop');
    out.real = { subagent_stop: reais.length, cwd_diferente_de_project_dir: reais.filter((o) => o.cwd !== o.project_dir).length };
  }
  const falhas = [];
  if (pos.rc !== 0) falhas.push('hook saiu != 0');
  if (medPos.length !== 1) falhas.push(`medição na principal = ${medPos.length} (esperado 1)`);
  if (!out.soma_confere) falhas.push('soma de tokens não confere');
  if (emWt) falhas.push('.harness criado na worktree');
  out.falhas = falhas;
  out.veredito_final = falhas.length === 0 ? 'VERDE' : 'REPROVADO';
  out.observacao = 'controle: sem CLAUDE_PROJECT_DIR a medição se perde (0 na principal) — o positivo depende da variável';
  console.log(JSON.stringify(out, null, 1));
  if (falhas.length) process.exitCode = 1;
}

/** Soma `message.usage` de um transcript por `message.id` (maior valor por campo), como o hook: só números. */
export function usoTranscript(arquivo) {
  const porId = new Map();
  for (const o of linhas(arquivo)) {
    const m = o?.message; const u = m?.usage;
    if (o?.type !== 'assistant' || typeof m?.id !== 'string' || u === null || typeof u !== 'object') continue;
    const at = porId.get(m.id) ?? { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0 };
    at.input_tokens = Math.max(at.input_tokens, u.input_tokens ?? 0); at.output_tokens = Math.max(at.output_tokens, u.output_tokens ?? 0);
    at.cache_read = Math.max(at.cache_read, u.cache_read_input_tokens ?? 0); at.cache_creation = Math.max(at.cache_creation, u.cache_creation_input_tokens ?? 0);
    porId.set(m.id, at);
  }
  const soma = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0 };
  for (const v of porId.values()) for (const k of Object.keys(soma)) soma[k] += v[k];
  return { ...soma, total: soma.input_tokens + soma.output_tokens + soma.cache_read + soma.cache_creation, mensagens: porId.size };
}
const totalDe = (d) => (d?.input_tokens ?? 0) + (d?.output_tokens ?? 0) + (d?.cache_read ?? 0) + (d?.cache_creation ?? 0);
const iso = (e) => epoch(e.ts);

/** Texto de um tool_result (string ou lista de blocos). */
const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('') : '');

/** 1ª saída de `loop.mjs proxima` no transcript: `sinais.slots` (a que o orquestrador viu). `null` se não houve. */
export function primeiraProxima(arquivo) {
  const pedidos = new Set();
  for (const o of linhas(arquivo)) {
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (o.type === 'assistant' && b.type === 'tool_use' && b.name === 'Bash' && /loop\.mjs['"]?\s+proxima\b/.test(String(b.input?.command ?? ''))) pedidos.add(b.id);
      if (o.type === 'user' && b.type === 'tool_result' && pedidos.has(b.tool_use_id)) {
        const t = textoDe(b.content).trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
        try { const j = JSON.parse(t); return { slots: j.sinais?.slots ?? null, tipo: j.acao?.tipo ?? null, aviso: j.aviso ?? null }; } catch { return { slots: null, tipo: null, aviso: null }; }
      }
    }
  }
  return null;
}

const LINHA_INSTANTANEO = /^(\d{4}-\d\d-\d\dT[\d:.]+Z\s|Diário:|ETA:)/;

/** Aceites 1 (a-f) e 4 (a, b): leitura do diário, observador e transcripts da corrida única de 3 tasks. */
async function relatorio1(repo, rundir, plugin, home) {
  const dia = await diario(repo, plugin);
  if (!dia.ok) { console.log(JSON.stringify({ aceite: '1+4', veredito_final: 'REPROVADO', motivo: dia.motivo })); process.exitCode = 1; return; }
  const ev = dia.eventos;
  const n = (t) => ev.filter((e) => e.tipo === t).length;
  const mod = linhas(join(rundir, 'mod.jsonl'));
  const cls = linhas(join(rundir, 'classic.jsonl'));
  const sends = existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')) : [];
  const exp = existsSync(join(rundir, 'exp.status')) ? readFileSync(join(rundir, 'exp.status'), 'utf8').trim() : null;
  const plano = JSON.parse(readFileSync(join(repo, '.harness', 'entregas', ENTREGA, 'plano.json'), 'utf8'));
  const idx = (pred) => ev.findIndex(pred);
  const R = { aceite: '1+4', exp_status: exp, eventos: ev.length };
  const pasta = pastaTranscripts(repo, home);
  const sessoes = [...new Set(ev.map((e) => e.sessao))].filter((sid) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(sid)));
  const semTranscript = sessoes.filter((sid) => !existsSync(join(pasta, `${sid}.jsonl`)));
  R.sessoes = sessoes.length; R.transcripts_ausentes = semTranscript.length;

  // 1a Concluir
  const p = proxima(repo, plugin, 0);
  const integ = ev.filter((e) => e.tipo === 'task.integrada');
  const ancestrais = integ.map((e) => gitRc(repo, 'merge-base', '--is-ancestor', String(e.dados?.sha), 'HEAD') === 0);
  R['1a'] = { acao_final: p.ok ? p.tipo : 'erro', integradas: integ.length, tasks_no_plano: plano.tasks.length, shas_na_branch: ancestrais.filter(Boolean).length, loop_parar: n('loop.parar') };
  const f1a = [];
  if (!p.ok || p.tipo !== 'concluir') f1a.push(`acao final != concluir (${p.ok ? p.tipo : 'erro'})`);
  if (integ.length !== plano.tasks.length) f1a.push(`integradas ${integ.length} != ${plano.tasks.length}`);
  if (!ancestrais.every(Boolean) || ancestrais.length === 0) f1a.push('sha fora da branch');
  if (R['1a'].loop_parar !== 0) f1a.push('loop.parar > 0');
  R['1a'].falhas = f1a;
  const parou = ev.filter((e) => e.tipo === 'loop.parar').map((e) => e.dados?.motivo);
  if (parou.length) R['1a'].motivos_parar = parou;
  R['1a'].veredito = f1a.length === 0 ? 'VERDE' : (parou.includes('teto_tokens') ? 'NAO_PROVADO' : 'REPROVADO');

  // 1b Sem digitação
  const composer = mod.filter((o) => o.ev === 'prompt.submit' && o.origem === 'composer').length;
  const digit = sends.filter((s) => !['trust', 'prompt', 'exit'].includes(s[1])).length;
  const exp1 = existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8') : '';
  const perguntas = (exp1.match(/PERGUNTA-DE-PERMISSAO/g) ?? []).length;
  R['1b'] = { composer, digitacao_apos_prompt: digit, perguntas_de_permissao: perguntas, veredito: composer === 1 && digit === 0 && perguntas === 0 ? 'VERDE' : 'REPROVADO' };

  // 1c Paralelismo
  const primeira = sessoes.length ? primeiraProxima(join(pasta, `${sessoes[0]}.jsonl`)) : null;
  const ini = (t) => idx((e) => e.tipo === 'task.iniciada' && e.dados?.task === t);
  const conc = (t) => idx((e) => e.tipo === 'task.concluida' && e.dados?.task === t);
  const intg = (t) => idx((e) => e.tipo === 'task.integrada' && e.dados?.task === t);
  const listas = mod.flatMap((o) => (Array.isArray(o.lista) ? [o.lista] : Array.isArray(o.agentes) ? [o.agentes] : []));
  const maxRun = Math.max(0, ...listas.map((l) => l.filter((a) => a.st === 'running').length));
  const maxImpl = Math.max(0, ...listas.map((l) => l.filter((a) => a.st === 'running' && /implementador/.test(String(a.tipo))).length));
  const sobrep = ini('T1') >= 0 && ini('T2') >= 0 && conc('T1') >= 0 && conc('T2') >= 0 && ini('T1') < conc('T2') && ini('T2') < conc('T1');
  const t3Depois = ini('T3') > intg('T1') && intg('T1') >= 0;
  R['1c'] = { slots_na_1a_proxima: primeira?.slots ?? null, primeira_proxima_tipo: primeira?.tipo ?? null, aviso: primeira?.aviso ?? null, sobreposicao_T1_T2: sobrep, max_agentes_running: maxRun, max_implementadores_running: maxImpl, T3_inicia_depois_de_integrada_T1: t3Depois };
  const lento = primeira === null || primeira.slots === null ? 'sem_dado' : primeira.slots < 2 ? 'slots1' : 'ok';
  R['1c'].veredito = lento === 'sem_dado' || lento === 'slots1' ? 'NAO_PROVADO' : (sobrep && maxRun >= 2 && t3Depois ? 'VERDE' : 'REPROVADO');
  R['1c'].motivo = lento === 'ok' ? null : lento;

  // 1d Fronteira
  const pousos = ev.map((e, i) => ({ e, i })).filter((x) => x.e.tipo === 'sessao.pouso');
  const vereds = ev.map((e, i) => ({ e, i })).filter((x) => x.e.tipo === 'review.veredito');
  let anterior = -1; const porPouso = [];
  for (const x of pousos) { porPouso.push(vereds.filter((v) => v.i > anterior && v.i < x.i).length); anterior = x.i; }
  const clears = cls.filter((o) => o.ev === 'SessionStart' && o.source === 'clear').length;
  const cmdClear = mod.filter((o) => o.ev === 'command.run' && o.comando === 'clear').length;
  R['1d'] = { pousos: pousos.length, retomadas: n('sessao.retomada'), veredito_novo_antes_de_cada_pouso: porPouso, clear_session_start: clears, clear_comando: cmdClear };
  const f1d = [];
  if (pousos.length < 1) f1d.push('0 pouso');
  if (pousos.length !== n('sessao.retomada')) f1d.push('pouso != retomada');
  if (porPouso.some((c) => c < 1)) f1d.push('pouso sem veredito novo');
  if (clears !== pousos.length || cmdClear !== pousos.length) f1d.push('/clear != pousos');
  R['1d'].falhas = f1d;
  // corrida que parou ANTES de qualquer pouso (1a reprovado) não exerceu a fronteira: não provado, não reprovado
  R['1d'].veredito = f1d.length === 0 ? 'VERDE' : (pousos.length === 0 && f1a.length > 0 ? 'NAO_PROVADO' : 'REPROVADO');

  // 1e Tokens do prompt de retomada (PROXY: contexto na 1ª chamada de ferramenta do orquestrador depois do prompt; o método S7 P6 não foi executado) e 1f Duplicação
  const subs = (r) => r.filter((o) => o.ev === 'prompt.submit');
  const submits = subs(mod);
  const tokPrimeiraFerramenta = (tIni) => { const o = mod.find((x) => x.ev === 'tool.call' && x.agente === null && x.t >= tIni && typeof x.tokens === 'number'); return o ? o.tokens : null; };
  const inicial = submits.find((o) => o.origem === 'composer');
  const base = inicial ? tokPrimeiraFerramenta(inicial.t) : null;
  // só o prompt do pouso (chars = `sessao.retomada.chars`); o prompt de `/gabarito retomar` (origem plugin, mesma sessão) não é retomada após /clear
  const charsRetomada = new Set(ev.filter((e) => e.tipo === 'sessao.retomada').map((e) => e.dados?.chars));
  const retomadas = submits.filter((o) => o.origem === 'plugin' && charsRetomada.has(o.chars)).map((o) => ({ chars: o.chars, tokens_1a_ferramenta: tokPrimeiraFerramenta(o.t), delta_vs_inicial: base === null || tokPrimeiraFerramenta(o.t) === null ? null : tokPrimeiraFerramenta(o.t) - base }));
  R['1e_proxy'] = { contexto_apos_prompt_inicial: base, retomadas, limite: 1500, metodo: 'proxy (contexto na 1ª ferramenta do orquestrador); S7 P6 (4 ciclos /clear) NÃO executado' };
  const ds = retomadas.map((r) => r.delta_vs_inicial);
  R['1e_proxy'].veredito = ds.length === 0 ? 'NAO_PROVADO' : ds.some((d) => d === null) ? 'NAO_PROVADO' : ds.every((d) => d <= 1500) ? 'VERDE_PROXY' : 'REPROVADO_PROXY';
  // 1f: linhas do instantâneo no prompt de retomada × no additionalContext do cartão (transcript da sessão pós-clear)
  const dup = [];
  for (const sid of sessoes) {
    const arq = join(pasta, `${sid}.jsonl`); if (!existsSync(arq)) continue;
    const lin = linhas(arq);
    const ctx = lin.filter((o) => o.type === 'attachment' && o.attachment?.type === 'hook_additional_context').flatMap((o) => [].concat(o.attachment.content ?? []).map(String));
    const prompts = lin.filter((o) => o.type === 'user' && typeof o.message?.content === 'string' && /Pouso automático/.test(o.message.content)).map((o) => o.message.content);
    if (!prompts.length) continue;
    const doPrompt = new Set(prompts.flatMap((t) => t.split('\n')).filter((l) => LINHA_INSTANTANEO.test(l)));
    const doCartao = new Set(ctx.flatMap((t) => t.split('\n')).filter((l) => LINHA_INSTANTANEO.test(l)));
    dup.push({ sessao: sid.slice(0, 8), prompt_chars: prompts[0].length, cartao_chars: ctx.join('').length, linhas_instantaneo_no_prompt: doPrompt.size, linhas_instantaneo_no_cartao: doCartao.size, linhas_em_comum: [...doPrompt].filter((l) => doCartao.has(l)).length, soma_tokens_aprox: Math.round((prompts[0].length + ctx.join('').length) / 4) });
  }
  R['1f'] = { sessoes_com_retomada: dup.length, medidas: dup, veredito: dup.length === 0 ? 'NAO_PROVADO' : (dup.some((d) => d.linhas_em_comum > 0) ? 'SUSPEITA_CONFIRMADA' : 'SUSPEITA_REFUTADA') };

  // 4a ETA
  const proj = dia.d.projetar(ev);
  const aprovacoes = ev.map((e, i) => ({ e, i })).filter((x) => x.e.tipo === 'review.veredito' && x.e.dados?.veredito === 'APROVADO');
  const antes3 = aprovacoes.length >= 3 ? dia.d.projetar(ev.slice(0, aprovacoes[2].i)).instantaneo : null;
  R['4a'] = { eta: proj.eta, aprovacoes: aprovacoes.length, sem_dados_antes_da_3a_aprovacao: antes3 === null ? null : /ETA: sem dados/.test(antes3) };
  R['4a'].veredito = aprovacoes.length < 3 ? 'NAO_PROVADO' : proj.eta !== null && proj.eta.n === 3 && proj.eta.medianaS > 0 && R['4a'].sem_dados_antes_da_3a_aprovacao === true ? 'VERDE' : 'REPROVADO';

  // 4b Tokens por agente
  const medicoes = ev.filter((e) => e.tipo === 'custo.medicao');
  const subIds = [...new Set(cls.filter((o) => o.ev === 'SubagentStop' && typeof o.agent_type === 'string' && o.agent_type !== '').map((o) => o.agent))];
  const porAgente = subIds.map((id) => {
    const m = medicoes.filter((e) => e.agente === `subagent:${id}`);
    const tr = cls.find((o) => o.ev === 'SubagentStop' && o.agent === id)?.transcript;
    const real = tr && existsSync(tr) ? usoTranscript(tr) : null;
    const med = m.reduce((s, e) => s + totalDe(e.dados), 0);
    return { agente: id.slice(0, 8), tipo: String(cls.find((o) => o.agent === id)?.agent_type ?? '').split(':').pop(), medicoes: m.length, tokens_diario: med, tokens_transcript: real?.total ?? null, desvio_pct: real && real.total > 0 ? Math.round(Math.abs(med - real.total) / real.total * 1000) / 10 : null };
  });
  const porSessao = sessoes.map((sid) => {
    const m = medicoes.filter((e) => e.sessao === sid && e.agente === 'orquestrador');
    const arq = join(pasta, `${sid}.jsonl`);
    const real = existsSync(arq) ? usoTranscript(arq) : null;
    const med = m.reduce((s, e) => s + totalDe(e.dados), 0);
    return { sessao: sid.slice(0, 8), medicoes_orquestrador: m.length, tokens_diario: med, tokens_transcript: real?.total ?? null, desvio_pct: real && real.total > 0 ? Math.round(Math.abs(med - real.total) / real.total * 1000) / 10 : null };
  });
  R['4b'] = { agentes_despachados: subIds.length, por_agente: porAgente, por_sessao: porSessao, subagent_stop_sem_agent_type: cls.filter((o) => o.ev === 'SubagentStop' && !o.agent_type).length };
  const f4b = [];
  if (subIds.length === 0) f4b.push('nenhum agente despachado');
  if (porAgente.some((a) => a.medicoes < 1 || a.tokens_diario <= 0)) f4b.push('agente sem medição ou com 0 token');
  if (porSessao.some((s) => s.medicoes_orquestrador < 1)) f4b.push('sessão sem medição do orquestrador');
  const majors = [...porAgente, ...porSessao].filter((x) => x.desvio_pct === null || x.desvio_pct > 5).map((x) => x.agente ?? x.sessao);
  R['4b'].desvio_acima_de_5pct_ou_sem_transcript = majors;
  R['4b'].falhas = f4b;
  R['4b'].veredito = f4b.length ? 'REPROVADO' : majors.length ? 'MAJOR_DESVIO' : 'VERDE';
  // tokens do aceite (custo.medicao): orquestrador × subagents
  const soma = (l) => l.reduce((s, e) => s + totalDe(e.dados), 0);
  R.tokens = { orquestrador: soma(medicoes.filter((e) => e.agente === 'orquestrador')), subagents: soma(medicoes.filter((e) => String(e.agente).startsWith('subagent:'))), medicoes: medicoes.length };
  R.guarda_deny = { total: n('guarda.deny'), alvos: ev.filter((e) => e.tipo === 'guarda.deny').map((e) => ({ agente: String(e.agente).slice(0, 14), alvo: e.dados?.alvo, anel: e.dados?.anel })) };
  R.dur_s = ev.length ? Math.round((epoch(ev.at(-1).ts) - epoch(ev[0].ts)) / 1000) : null;
  const vs = ['1a', '1b', '1c', '1d', '4a', '4b'].map((k) => R[k].veredito);
  R.veredito_final = vs.every((v) => v === 'VERDE') ? 'VERDE' : vs.includes('REPROVADO') ? 'REPROVADO' : 'PARCIAL';
  console.log(JSON.stringify(R, null, 1));
}

/** Aceite 2 (pausa): leitura da corrida em modo `pausa` + controle positivo direto na guarda, sem LLM. */
async function relatorio2(repo, rundir, plugin) {
  const dia = await diario(repo, plugin);
  if (!dia.ok) { console.log(JSON.stringify({ aceite: 2, veredito_final: 'REPROVADO', motivo: dia.motivo })); process.exitCode = 1; return; }
  const ev = dia.eventos;
  const mod = linhas(join(rundir, 'mod.jsonl'));
  const sends = existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')) : [];
  const exp = existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8').split('\n').filter(Boolean) : [];
  const status = existsSync(join(rundir, 'exp.status')) ? readFileSync(join(rundir, 'exp.status'), 'utf8').trim() : null;
  const R = { aceite: 2, exp_status: status };
  const lin = (re) => exp.map((l) => ({ t: Number(l.split(' ')[0]) * 1000, l })).filter((x) => re.test(x.l));
  const tocou = lin(/PAUSAR tocado/)[0] ?? null;
  const pedirRetomar = sends.filter((s) => s[1] === 'retomar').map((s) => Number(s[0]) * 1000)[0] ?? null;
  const pedirPausar = sends.filter((s) => s[1] === 'pausar').map((s) => Number(s[0]) * 1000)[0] ?? null;
  if (tocou === null) { R.veredito_final = 'NAO_PROVADO'; R.motivo = 'o .exp não viu Agent running para tocar PAUSAR'; console.log(JSON.stringify(R, null, 1)); process.exitCode = 1; return; }
  const T = tocou.t;
  const fim = pedirRetomar ?? Infinity;
  const emJanela = (ms, folga = 1000) => ms > T + folga && ms < fim;
  // 2a: depois do touch (folga de 1 s: o .exp mede em segundos) e antes de /gabarito retomar
  const iniNovas = ev.filter((e) => e.tipo === 'task.iniciada' && emJanela(iso(e)));
  const iniNaFolga = ev.filter((e) => e.tipo === 'task.iniciada' && iso(e) > T && iso(e) <= T + 1000).length;
  const agentsPermitidos = mod.filter((o) => o.ev === 'tool.call' && o.tool === 'Agent' && o.negado === false && emJanela(o.t));
  const agentsNegados = mod.filter((o) => o.ev === 'tool.call' && o.tool === 'Agent' && o.negado === true && o.t > T && o.t < fim);
  const listas = mod.filter((o) => o.t > T && o.t < fim).flatMap((o) => (Array.isArray(o.lista) ? [o.lista] : Array.isArray(o.agentes) ? [o.agentes] : []));
  const runAntes = Math.max(0, ...mod.filter((o) => o.t <= T + 1000).flatMap((o) => (Array.isArray(o.lista) ? [o.lista] : Array.isArray(o.agentes) ? [o.agentes] : [])).slice(-1).map((l) => l.filter((a) => a.st === 'running').length));
  const runMax = Math.max(0, ...listas.map((l) => l.filter((a) => a.st === 'running').length));
  const pausaNegados = ev.filter((e) => e.tipo === 'loop.pausa' && e.dados?.negado !== undefined && iso(e) > T && iso(e) < fim);
  R['2a'] = { touch_ms: T, task_iniciada_apos_touch: iniNovas.length, task_iniciada_na_folga_de_1s: iniNaFolga, agent_permitido_apos_touch: agentsPermitidos.length, running_no_touch: runAntes, running_max_depois: runMax, running_cresceu: runMax > runAntes };
  R['2a'].veredito = iniNovas.length === 0 && agentsPermitidos.length === 0 && runMax <= runAntes ? 'VERDE' : 'REPROVADO';
  // 2b: modelo tentou? + controle direto na guarda (sem LLM)
  const tentativas = agentsNegados.filter((o) => /pausado/.test(String(o.motivo ?? ''))).length;
  const guardaDeny = pausaNegados.length;
  const ctl = join(rundir, 'ctl-repo');
  let hook = { montou: false };
  try {
    if (!existsSync(ctl)) execFileSync('bash', [join(plugin, 'gates/test/e2e/montar-repo.sh'), ctl, join(plugin, 'gates/test/e2e/plano-exemplo.json')], { stdio: 'ignore' });
    mkdirSync(join(ctl, '.harness'), { recursive: true });
    const pausar = join(ctl, '.harness', 'PAUSAR');
    writeFileSync(pausar, 'pausado\n');
    const guarda = join(plugin, 'gates/dist/guarda.js');
    const rodar = (payload) => { const r = nodeCli(guarda, [], { cwd: ctl, env: { CLAUDE_PROJECT_DIR: ctl }, entrada: JSON.stringify(payload) }); let o = null; try { o = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* sem JSON */ } return { rc: r.rc, decisao: o?.hookSpecificOutput?.permissionDecision ?? null, motivo: o?.hookSpecificOutput?.permissionDecisionReason ?? null }; };
    const base = { hook_event_name: 'PreToolUse', session_id: '22222222-0000-4000-8000-000000000002', cwd: ctl };
    const agent = rodar({ ...base, tool_name: 'Agent', tool_input: { subagent_type: 'gabarito-mestre:gabarito-implementador', prompt: 'p' } });
    const sub = rodar({ ...base, agent_id: 'a2200000000000001', agent_type: 'gabarito-mestre:gabarito-implementador', tool_name: 'Bash', tool_input: { command: 'echo oi' } });
    hook = { montou: true, agent_do_orquestrador: agent, bash_de_subagent: sub };
    // controle negativo: sem PAUSAR o mesmo Agent passa (a pausa é a causa do deny)
    writeFileSync(pausar, 'pausado\n');
    hook.negativo_sem_pausar = 'não executado: nada é apagado (R2); o deny acima só ocorre com o arquivo, e os testes pausa.test.mjs cobrem a ausência';
  } catch (e) { hook = { montou: false, erro: String(e.message).slice(0, 200) }; }
  const nega = pausaNegados.map((e) => `${String(e.agente).startsWith('subagent:') ? 'subagent' : 'orquestrador'}:${e.dados.negado}`);
  R['2b'] = { modelo_tentou_agent_com_deny_de_pausa: tentativas, deny_de_pausa_no_diario: guardaDeny, deny_de_pausa_por_agente_e_ferramenta: nega, hook_direto: hook };
  const dois = hook.montou && hook.agent_do_orquestrador?.decisao === 'deny' && hook.bash_de_subagent?.decisao === 'deny' && /pausado: \/gabarito retomar/.test(String(hook.agent_do_orquestrador?.motivo));
  R['2b'].veredito = !dois ? 'REPROVADO' : (tentativas + guardaDeny >= 1 ? 'VERDE' : 'VERDE_SO_PELO_HOOK');
  R['2b'].modelo_nao_tentou = tentativas + guardaDeny === 0;
  // 2c: /gabarito pausar com turno em voo
  const arquivoPausar = existsSync(join(repo, '.harness', 'PAUSAR'));
  const pausadoEv = ev.filter((e) => e.tipo === 'loop.pausa' && e.dados?.estado === 'pausado').map(iso);
  const depoisPausar = pedirPausar === null ? [] : pausadoEv.filter((t) => t >= pedirPausar - 1000);
  R['2c'] = { pausar_digitado: pedirPausar !== null, arquivo_existe_no_fim: arquivoPausar, loop_pausa_pausado_apos_comando: depoisPausar.length, atraso_s: depoisPausar.length && pedirPausar !== null ? Math.round((depoisPausar[0] - pedirPausar) / 100) / 10 : null, nota: lin(/pausar em voo/).map((x) => x.l.replace(/^\d+ /, ''))[0] ?? null };
  R['2c'].veredito = pedirPausar === null ? 'NAO_PROVADO' : (arquivoPausar && depoisPausar.length >= 1 && R['2c'].atraso_s !== null && R['2c'].atraso_s <= 30 ? 'VERDE' : (arquivoPausar && depoisPausar.length ? 'MAJOR_ATRASO' : 'REPROVADO'));
  // 2d: /gabarito retomar recomeça
  const retomados = ev.map((e, i) => ({ e, i })).filter((x) => x.e.tipo === 'loop.pausa' && x.e.dados?.estado === 'retomado' && (pedirRetomar === null || iso(x.e) >= pedirRetomar - 1000));
  const iR = retomados[0]?.i ?? -1;
  // a retomada do comando reabre as tasks em voo logo ANTES do `loop.pausa retomado` (T15); a reaberta de um pouso é outra coisa e fica de fora
  const tRet = iR < 0 ? null : iso(ev[iR]);
  const reabertas = iR < 0 ? [] : ev.filter((e) => e.tipo === 'task.reaberta' && e.dados?.origem === 'retomada' && iso(e) >= tRet - 5000 && iso(e) <= tRet + 1000);
  const iReab = reabertas.length ? Math.max(...reabertas.map((r) => ev.indexOf(r))) : -1;
  const novasIni = iReab < 0 ? [] : ev.filter((e, i) => i > iReab && e.tipo === 'task.iniciada' && iso(e) < tRet + 60000);
  const agentsDepois = mod.filter((o) => o.ev === 'tool.call' && o.tool === 'Agent' && o.negado === false && o.t >= (pedirRetomar ?? Infinity)).length;
  const mesma = reabertas.length > 0 && novasIni.some((e) => reabertas.some((r) => r.dados?.task === e.dados?.task));
  const digit = sends.filter((s) => !['trust', 'prompt', 'exit', 'retomar', 'pausar'].includes(s[1])).length;
  R['2d'] = { retomar_digitado: pedirRetomar !== null, loop_pausa_retomado: retomados.length, task_reaberta_retomada: reabertas.map((e) => e.dados?.task), task_iniciada_depois: novasIni.map((e) => e.dados?.task), mesma_task_recomecou: mesma, agent_permitido_apos_retomar: agentsDepois, digitacao_extra: digit, pausar_existe_no_fim: arquivoPausar };
  const f2d = [];
  if (pedirRetomar === null) f2d.push('retomar não digitado');
  if (retomados.length === 0) f2d.push('sem loop.pausa retomado');
  if (!mesma) f2d.push('a task não recomeçou (reaberta + iniciada)');
  if (agentsDepois < 1) f2d.push('nenhum Agent permitido depois de retomar (arquivo ainda barra?)');
  if (digit !== 0) f2d.push('digitação extra');
  R['2d'].falhas = f2d;
  R['2d'].veredito = pedirRetomar === null ? 'NAO_PROVADO' : f2d.length ? 'REPROVADO' : 'VERDE';
  R.guarda_deny = { total: ev.filter((e) => e.tipo === 'guarda.deny').length, alvos: ev.filter((e) => e.tipo === 'guarda.deny').map((e) => ({ agente: String(e.agente).slice(0, 14), alvo: e.dados?.alvo })) };
  const vs = ['2a', '2b', '2c', '2d'].map((k) => R[k].veredito);
  R.veredito_final = vs.every((v) => v.startsWith('VERDE')) ? 'VERDE' : vs.includes('REPROVADO') ? 'REPROVADO' : 'PARCIAL';
  console.log(JSON.stringify(R, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'estado') await estado(a[0], a[1], a[2]);
  else if (cmd === 'relatorio' && a[0] === '0') await relatorio0(a[1], a[2], a[3]);
  else if (cmd === 'relatorio' && a[0] === '1') await relatorio1(a[1], a[2], a[3], homedir());
  else if (cmd === 'relatorio' && a[0] === '2') await relatorio2(a[1], a[2], a[3]);
  else if (cmd === 'relatorio' && a[0] === '5') relatorio5(a[1], a[2], a[3], a[4], a.slice(5));
  else if (cmd === 'relatorio' && a[0] === '4c') await relatorio4c(a[1], a[2], a[3], a[4]);
  else if (cmd === 'medidas') await medidas(a[0], a[1], a[2], homedir());
  else { console.error('uso: avaliar.mjs estado|medidas <repo> <rundir> <plugin-root> | relatorio 0|1|2 <repo> <rundir> <plugin-root> | relatorio 4c <repo> <rundir> <plugin-root> [<rundir-real>] | relatorio 5 <repo> <rundir> <plugin-root> <cwd-rel> <cmd...>'); process.exitCode = 2; }
}

#!/usr/bin/env node
/**
 * Leitura das evidências dos aceites (GM-10 T13). Só lê: diário (lerEstrito + ordenar, do núcleo), logs do observador e `loop.mjs proxima`.
 *   avaliar.mjs estado <repo> <rundir> <plugin-root>     uma linha JSON, para o aceite-loop.exp decidir quando parar
 *   avaliar.mjs medidas <repo> <rundir> <plugin-root>          medições da r5 (transcripts, mod.jsonl, debug.log, diário): só números e nomes
 *   avaliar.mjs relatorio 0 <repo> <rundir> <plugin-root>     aceite 0 (fumaça): números e veredito. Os demais aceites só têm relatório
 *                                                            depois de um aceite 0 VERDE (ordem do brief); até lá não existem aqui.
 * Saída de ferramenta falhando ou diário ilegível reprova: nada aqui devolve verde por falta de dado.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
  const denyImpl = ev.filter((e) => e.tipo === 'guarda.deny' && /subagent/.test(String(e.agente)) && impl.length > 0 && e.agente.includes(String(impl[0].agent).slice(0, 12)));
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
    deny_total: n('guarda.deny'), deny_implementador: denyImpl.length,
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
  if (out.deny_implementador !== 0) falhas.push('guarda.deny do implementador > 0');
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
      const ini = m.blocos.filter((b) => b.nome === 'Bash' && /loop\.mjs['"]?\s+iniciar\b/.test(String(b.input.command ?? '')));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'estado') await estado(a[0], a[1], a[2]);
  else if (cmd === 'relatorio' && a[0] === '0') await relatorio0(a[1], a[2], a[3]);
  else if (cmd === 'medidas') await medidas(a[0], a[1], a[2], homedir());
  else { console.error('uso: avaliar.mjs estado <repo> <rundir> <plugin-root> | relatorio 0 <repo> <rundir> <plugin-root> | medidas <repo> <rundir> <plugin-root>'); process.exitCode = 2; }
}

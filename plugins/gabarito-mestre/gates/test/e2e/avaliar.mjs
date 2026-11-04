#!/usr/bin/env node
/**
 * Leitura das evidências dos aceites (GM-10 T13). Só lê: diário (lerEstrito + ordenar, do núcleo), logs do observador e `loop.mjs proxima`.
 *   avaliar.mjs estado <repo> <rundir> <plugin-root>     uma linha JSON, para o aceite-loop.exp decidir quando parar
 *   avaliar.mjs relatorio 0 <repo> <rundir> <plugin-root>     aceite 0 (fumaça): números e veredito. Os demais aceites só têm relatório
 *                                                            depois de um aceite 0 VERDE (ordem do brief); até lá não existem aqui.
 * Saída de ferramenta falhando ou diário ilegível reprova: nada aqui devolve verde por falta de dado.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'estado') await estado(a[0], a[1], a[2]);
  else if (cmd === 'relatorio' && a[0] === '0') await relatorio0(a[1], a[2], a[3]);
  else { console.error('uso: avaliar.mjs estado <repo> <rundir> <plugin-root> | relatorio 0 <repo> <rundir> <plugin-root>'); process.exitCode = 2; }
}

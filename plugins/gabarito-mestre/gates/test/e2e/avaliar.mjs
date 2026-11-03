#!/usr/bin/env node
/**
 * Leitura das evidências dos aceites (GM-10 T13). Só lê: diário (lerEstrito + ordenar, do núcleo), logs do observador e `loop.mjs proxima`.
 *   avaliar.mjs estado <repo> <rundir> <plugin-root>     uma linha JSON, para o aceite-loop.exp decidir quando parar
 *   avaliar.mjs relatorio <aceite> <repo> <rundir> <plugin-root>
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'estado') await estado(a[0], a[1], a[2]);
  else { console.error('uso: avaliar.mjs estado <repo> <rundir> <plugin-root>'); process.exitCode = 2; }
}

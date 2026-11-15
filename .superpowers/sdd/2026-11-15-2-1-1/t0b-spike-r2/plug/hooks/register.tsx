import type { Register } from 'claude-code'
// Sonda descartavel GM-15 T0b r2. So observa; nunca planta sinal.
// LOADED = versao do manifesto lida UMA vez, no 1o evento depois da carga do modulo (nunca relida).
// CARGA muda se o modulo for recarregado (novo processo ou hot-reload).
const CARGA = Math.random().toString(36).slice(2, 8)
let seq = 0
let LOADED: string | null | undefined
async function disco($: any): Promise<string | null> {
  try { const t = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`); return JSON.parse(typeof t === 'string' ? t : t.text ?? t.content ?? String(t)).version ?? null } catch (x) { return 'erro:' + String(x).slice(0, 80) }
}
async function log($: any, ev: string, dado: unknown) {
  seq += 1
  const d = await disco($)
  if (LOADED === undefined) LOADED = d
  try { await $.fs.write(`${$.plugin.root}/../out/mod/${Date.now()}-${CARGA}-${String(seq).padStart(4, '0')}-${ev}.json`, JSON.stringify({ t: Date.now(), carga: CARGA, seq, ev, loaded: LOADED, disco: d, dado })) } catch { /* sonda */ }
}
export const register: Register = on => {
  on('session.start', async ($, e, next) => { await log($, 'session.start', JSON.parse(JSON.stringify(e))); return next(e) })
  on('prompt.submit', async ($, e, next) => { const x: any = e; await log($, 'prompt.submit', { source: x.source ?? null, origin: x.origin ?? null, text: typeof x.text === 'string' ? x.text.slice(0, 160) : null }); return next(e) })
  on('classic.Stop', async ($, e, next) => { const x: any = e; await log($, 'Stop', { background_tasks: x.background_tasks ?? null, session_crons: x.session_crons ?? null }); return next(e) })
  on('tool.call', async ($, e, next) => { const x: any = e; const r: any = await next(e); let t = ''; try { t = JSON.stringify(r) } catch { t = '?' } await log($, 'tool.call', { tool: x.tool, input: JSON.stringify(x).slice(0, 400), trecho: t.slice(0, 300) }); return r })
}

/** Testes do mod de pouso (GM-10 T9, REQ-POU-1/2, REQ-OBS-1) por `claude plugin test`. Mutações: task-9-mut.json. */
import { expect, mock, test } from 'claude-code/testing'

const RAIZ = '/repo'
const DIR = '/repo/.harness/entregas/PBI-7'
const PRINCIPAL = '/main'

type Ev = { agente: string; tipo: string; dados: Record<string, unknown> }
type Opc = {
  percent?: number | null
  x?: string
  interativo?: boolean
  plano?: boolean
  agentes?: { id: string; status: string }[] | 'falha'
  eventos?: any[]
  lerFalha?: boolean
  lerErro?: string
  instantaneo?: string | 'falha'
  appendFalha?: string[]
  clearFalha?: boolean
  submitFalha?: boolean
  submitPendente?: boolean
  storeInicial?: Record<string, unknown>
  storeSetFalha?: boolean
  storeNaoGrava?: boolean
  writeFalha?: boolean
  unlinkFalha?: boolean
  arquivos?: string[]
  usageFalha?: boolean
  escritaNaoAparece?: boolean
  unlinkSilencioso?: boolean
  ponteSai1?: boolean
  unlinkSai1ArquivoSome?: boolean
  storeGravaOutro?: boolean
  aoClear?: () => void
  /** resposta da ponte `plano`: o plano, ou 'falha' */
  plano_json?: unknown
  config?: { slots?: number; tetoTokens?: number | null }
  existsFalha?: boolean
  existsPlanoFalha?: boolean
}

const FRONT = [
  { seq: 1, ts: '2026-11-03T00:00:01.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.iniciada', dados: { task: 'a', papel: 'implementador' }, hash_anterior: null },
  { seq: 2, ts: '2026-11-03T00:00:02.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.concluida', dados: { task: 'a', sha: 'x' }, hash_anterior: null },
  { seq: 3, ts: '2026-11-03T00:00:03.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'review.veredito', dados: { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, hash_anterior: null },
]
const SEM_FRONT = FRONT.slice(0, 2)
// uma task `b` inteira antes: sem `review.veredito` no diário não há fronteira (T15, REQ-POU-1), então os casos de "a" precisam de uma
const B_FEITA = [
  { seq: 1, ts: '2026-11-03T00:00:01.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.iniciada', dados: { task: 'b', papel: 'implementador' }, hash_anterior: null },
  { seq: 2, ts: '2026-11-03T00:00:02.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.concluida', dados: { task: 'b', sha: 'x' }, hash_anterior: null },
  { seq: 3, ts: '2026-11-03T00:00:03.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'review.veredito', dados: { task: 'b', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, hash_anterior: null },
  { seq: 4, ts: '2026-11-03T00:00:04.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.integrada', dados: { task: 'b', sha: 'd' }, hash_anterior: null },
]
const aposB = (...itens: [string, Record<string, unknown>][]) => [...B_FEITA, ...itens.map(([t, d], i) => ({ ...B_FEITA[0], seq: 5 + i, ts: `2026-11-03T00:00:${String(5 + i).padStart(2, '0')}.000Z`, tipo: t, dados: d }))]
const A_INI = ['task.iniciada', { task: 'a', papel: 'implementador' }] as [string, Record<string, unknown>]
const A_CON = ['task.concluida', { task: 'a', sha: 'x' }] as [string, Record<string, unknown>]
const A_REVISAR = aposB(A_INI, A_CON)
const CHAVE = `pouso:${DIR}`
const PLANO = { entrega: 'PBI-7', tasks: [{ id: 'a', deps: [], arquivos: ['a.ts'] }, { id: 'b', deps: [], arquivos: ['b.ts'] }] }
const EV = (seq: number, tipo: string, dados: Record<string, unknown>) =>
  ({ seq, ts: `2026-11-03T00:00:${String(seq).padStart(2, '0')}.000Z`, autor: 'a', sessao: 's0', agente: 'o', tipo, dados, hash_anterior: null })
const INT_A = EV(4, 'task.integrada', { task: 'a', sha: 'd' })
const NO_TETO = [
  EV(1, 'task.iniciada', { task: 'a', papel: 'implementador' }), EV(2, 'task.concluida', { task: 'a', sha: 'x' }),
  EV(3, 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }),
  EV(4, 'task.iniciada', { task: 'a', papel: 'correcao' }), EV(5, 'task.concluida', { task: 'a', sha: 'y' }),
  EV(6, 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 2, major: 1, blocker: 0 }),
]


// O mundo debaixo do mod: tudo em memória, com um log único de chamadas na ordem em que acontecem.
function mundo($: any, on: any, o: Opc = {}) {
  const log: string[] = []
  const grav: Ev[] = []
  const toasts: string[] = []
  const pedidos: any[] = []
  const evs: any[] = [...(o.eventos ?? FRONT)]
  let relogio = 0
  const store = new Map<string, unknown>(Object.entries(o.storeInicial ?? {}))
  const arquivos = new Set<string>(o.arquivos ?? [])
  const est = { dir: DIR, plano: o.plano !== false, percent: o.percent === undefined ? 60 : o.percent, clears: 0, submits: [] as string[], liberar: null as null | (() => void) }

  // o diário em memória: tudo que o mod grava volta na próxima leitura, com seq e ts válidos para a T2
  const seqs = new Map<string, number>()
  for (const e of evs) seqs.set(e.sessao, Math.max(seqs.get(e.sessao) ?? 0, e.seq))
  const add = (agente: string, tipo: string, dados: Record<string, unknown>, sessao = 's0') => {
    const seq = (seqs.get(sessao) ?? 0) + 1
    seqs.set(sessao, seq)
    relogio += 1
    evs.push({ seq, ts: new Date(Date.UTC(2026, 10, 3, 1, 0, relogio)).toISOString(), autor: 'a', sessao, agente, tipo, dados, hash_anterior: null })
  }

  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: RAIZ }))
  on('session.repo', () => ({ value: { root: PRINCIPAL, remote: null, internal: false } }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'GABARITO_POUSO_X' ? o.x : undefined }))
  on('session.usage', () => {
    if (o.usageFalha) return { deny: 'usage fora do ar' }
    return { value: { startedAt: 0, context: { window: 1_000_000, percent: est.percent ?? undefined, tokens: 1 }, rateLimits: [] } }
  })
  on('agent.list', () => (o.agentes === 'falha' ? { deny: 'sem sessão' } : { value: o.agentes ?? [] }))
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); log.push('toast'); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', (_: any, e: any) => { log.push(`register:${e.name}`); return { value: { command: e.name } } })
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => {
    log.push(`store.set:${e.key}:${(e.value as any)?.estado ?? ''}`)
    if (o.storeSetFalha) return { deny: 'store fora do ar' }
    if (o.storeGravaOutro) store.set(e.key, { estado: 'ocioso' })
    else if (!o.storeNaoGrava) store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_: any, e: any) => { log.push(`store.delete:${e.key}`); store.delete(e.key); return { value: undefined } })
  on('state.set', () => { log.push('state.set'); return { value: { isSet: true, version: 1 } } })
  on('fs.exists', (_: any, e: any) => (o.existsPlanoFalha && e.path.endsWith('plano.json') ? { deny: 'fs fora do ar' } : o.existsFalha && e.path.endsWith('PAUSAR') ? { deny: 'fs fora do ar' } : { value: arquivos.has(e.path) || (e.path === `${est.dir}/plano.json` && est.plano) }))
  on('fs.write', (_: any, e: any) => {
    if (o.writeFalha) return { deny: 'disco cheio' }
    if (!o.escritaNaoAparece) arquivos.add(e.path)
    log.push(`fs.write:${e.path}`)
    return { value: undefined }
  })
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'node' && argv.includes('--input-type=module')) {
      const q = JSON.parse(e.init?.stdin ?? '{}')
      pedidos.push(q)
      if (o.ponteSai1) return { value: { exitCode: 1, stdout: JSON.stringify({ ok: true, raiz: RAIZ, dir: DIR, plano: true, eventos: FRONT, texto: 'x' }), stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
      if (q.op === 'dir') return ok(JSON.stringify({ ok: true, raiz: RAIZ, dir: est.dir, plano: est.plano }))
      if (q.op === 'plano') {
        if (o.plano_json === 'falha') return ok(JSON.stringify({ ok: false, erro: 'plano.json inválido: x' }))
        const cfg = o.config ?? {}
        return ok(JSON.stringify({ ok: true, plano: o.plano_json ?? PLANO, slots: cfg.slots ?? 3, tetoTokens: cfg.tetoTokens ?? null }))
      }
      if (q.op === 'ler') return ok(JSON.stringify(o.lerFalha ? { ok: false, erro: o.lerErro ?? 'x' } : { ok: true, eventos: evs }))
      if (q.op === 'instantaneo') {
        log.push('instantaneo')
        const t = o.instantaneo ?? 'Diário: 3 evento(s)\nETA: sem dados'
        return ok(JSON.stringify(t === 'falha' ? { ok: false, erro: 'x' } : { ok: true, texto: t }))
      }
      if (q.op === 'append') {
        log.push(`append:${q.ev.tipo}`)
        if (o.appendFalha?.includes(q.ev.tipo)) return ok(JSON.stringify({ ok: false, erro: 'x' }))
        grav.push({ agente: q.ev.agente, tipo: q.ev.tipo, dados: q.ev.dados })
        add(q.ev.agente, q.ev.tipo, q.ev.dados, 'sess-1')
        return ok(JSON.stringify({ ok: true, gravado: 'evento' }))
      }
    }
    if (argv[0] === 'node' && argv.includes('-e') && argv.at(-1)?.endsWith('PAUSAR')) {
      log.push(`unlink:${argv.at(-1)}`)
      if (o.unlinkSai1ArquivoSome) { arquivos.delete(argv.at(-1) as string); return { value: { exitCode: 1, stdout: '', stderr: 'ENOENT', isStdoutTruncated: false, isStderrTruncated: false } } }
      if (o.unlinkFalha) return { value: { exitCode: 1, stdout: '', stderr: 'EACCES', isStdoutTruncated: false, isStderrTruncated: false } }
      if (!o.unlinkSilencioso) arquivos.delete(argv.at(-1) as string)
      return ok('')
    }
    return { deny: `process.run inesperado: ${argv.join(' ')}` }
  })
  on('command.run', (_: any, e: any) => {
    if (e.command !== 'clear') return { text: '' }
    log.push('clear'); est.clears += 1
    o.aoClear?.()
    if (o.clearFalha) throw new Error('is not available in this mode: no session is bound in this process')
    est.percent = null
    return { text: '' }
  })
  on('prompt.submit', async (_: any, e: any) => {
    log.push('submit'); est.submits.push(e.text)
    if (o.submitFalha) return { drop: 'recusado' }
    if (o.submitPendente) await new Promise<void>((r) => { est.liberar = r })
    return { text: e.text }
  })
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))

  const clock = mock.clock(on)
  const turno = (extra: Record<string, unknown> = {}) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra })
  const agent = (subagent_type?: string) => $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type })
  const inicio = (interativo = o.interativo ?? true) => $.session.start({ cwd: RAIZ, surface: interativo ? 'terminal' : null, isInteractive: interativo })
  const cmd = (args: string) => $.command.run({ command: 'gabarito', args })
  const tipos = () => grav.map((g) => g.tipo)
  return { log, grav, toasts, pedidos, store, arquivos, est, clock, turno, agent, inicio, cmd, tipos, evs, add }
}

const pousar = async (m: ReturnType<typeof mundo>) => { await m.inicio(); await m.turno(); await m.clock.settle() }

// ---- pouso: ordem dos passos (E23) ----
test('pousa-na-ordem: store antes do clear, evento e instantâneo antes, retomada por último', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  const ordem = m.log.filter((l) => /^(store\.set|append|instantaneo|clear|submit|store\.delete)/.test(l))
  expect(ordem).toEqual([
    `store.set:${CHAVE}:pousando`,
    'append:sessao.pouso',
    'instantaneo',
    'clear',
    `store.set:${CHAVE}:retomando`,
    'submit',
    'append:sessao.retomada',
    `store.delete:${CHAVE}`,
  ])
  expect(m.est.clears).toBe(1)
  expect(m.est.submits).toHaveLength(1)
  expect(m.est.submits[0]).toContain('Diário: 3 evento(s)')
})
test('store-antes-do-clear: o estado pousando já está gravado quando o clear roda', async ($, on) => {
  let noClear: unknown
  const m = mundo($, on, { aoClear: () => { noClear = m.store.get(CHAVE) } })
  await pousar(m)
  expect((noClear as any)?.estado).toBe('pousando')
})
test('sessao-pouso-so-numeros: dados do pouso levam percent e x, nada mais', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.grav.find((g) => g.tipo === 'sessao.pouso')).toEqual({ agente: 'orquestrador', tipo: 'sessao.pouso', dados: { percent: 60, x: 50 } })
  expect(m.grav.find((g) => g.tipo === 'sessao.retomada')?.agente).toBe('orquestrador')
})
test('state-nao-e-usado: o estado do pouso vive em store (state zera no clear, M2)', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.log.includes('state.set')).toBe(false)
})

// ---- pouso: quando não ----
test('abaixo-x-nao-pousa', async ($, on) => {
  const m = mundo($, on, { percent: 49 })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
})
test('x-exato-pousa: percent igual a X', async ($, on) => {
  const m = mundo($, on, { percent: 50 })
  await pousar(m)
  expect(m.est.clears).toBe(1)
})
test('percent-indefinido-nao-pousa', async ($, on) => {
  const m = mundo($, on, { percent: null })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
test('sem-loop-nao-pousa: sem plano.json o mod não muda nada', async ($, on) => {
  const m = mundo($, on, { plano: false })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
  expect((await m.agent()).deny).toBeUndefined()
})
test('x-env-sobrepoe: GABARITO_POUSO_X troca o limite', async ($, on) => {
  const alto = mundo($, on, { x: '70', percent: 60 })
  await pousar(alto)
  expect(alto.est.clears).toBe(0)
})
test('x-env-baixo-pousa', async ($, on) => {
  const m = mundo($, on, { x: '10', percent: 20 })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  expect(m.grav.find((g) => g.tipo === 'sessao.pouso')?.dados).toEqual({ percent: 20, x: 10 })
})
test('x-env-invalido: usa 50 e avisa uma vez só', async ($, on) => {
  const m = mundo($, on, { x: 'abc', percent: 40 })
  await m.inicio()
  await m.turno(); await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.toasts.filter((t) => t.includes('GABARITO_POUSO_X'))).toHaveLength(1)
})
for (const status of ['pending', 'running', 'waiting']) {
  test(`vivos-bloqueiam-${status}: agente ${status} impede o pouso`, async ($, on) => {
    const m = mundo($, on, { agentes: [{ id: 'a1', status }] })
    await pousar(m)
    expect(m.est.clears).toBe(0)
  })
}
test('encerrados-nao-bloqueiam: idle, completed, failed e killed', async ($, on) => {
  const m = mundo($, on, { agentes: ['idle', 'completed', 'failed', 'killed'].map((status, i) => ({ id: `a${i}`, status })) })
  await pousar(m)
  expect(m.est.clears).toBe(1)
})
test('agent-list-falha-conta-vivo: nunca pousa', async ($, on) => {
  const m = mundo($, on, { agentes: 'falha' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
test('sem-fronteira-nao-pousa', async ($, on) => {
  const m = mundo($, on, { eventos: SEM_FRONT })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
for (const [nome, eventos] of [['task-concluida', SEM_FRONT], ['diario-vazio', []]] as [string, any[]][]) {
  test(`k-sem-veredito-nao-pousa-${nome}: sem review.veredito o mod não limpa e o Agent passa, mesmo com percent ≥ X (aceite 1)`, async ($, on) => {
    const m = mundo($, on, { eventos })
    await pousar(m)
    expect(m.est.clears).toBe(0)
    expect(m.tipos()).toEqual([])
    expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  })
}
test('diario-ilegivel-nao-pousa: fronteira falsa', async ($, on) => {
  const m = mundo($, on, { lerFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
test('ponte-sai-1-nunca-vira-pouso: a ferramenta falhando não é sucesso, mesmo com stdout de aparência boa', async ($, on) => {
  const m = mundo($, on, { ponteSai1: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.est.submits).toHaveLength(0)
  expect(m.tipos()).toEqual([])
})
test('subagent-nunca-decide: turn.complete com agentId não pousa', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ agentId: 'ag1' }); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.log.includes('submit')).toBe(false)
})
test('dois-turn-complete-no-mesmo-tick: um clear só', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await Promise.all([m.turno(), m.turno()])
  await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(m.est.submits).toHaveLength(1)
})
test('pouso-nao-repete: hand-back com percent indefinido depois do clear não faz segundo clear', async ($, on) => {
  const m = mundo($, on, { submitPendente: true })
  await m.inicio()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(m.store.get(CHAVE)).toEqual(expect.objectContaining({ estado: 'retomando' }))
  await m.turno() // hand-back: percent indefinido
  await m.clock.settle()
  expect(m.est.clears).toBe(1)
  m.est.percent = 60 // medição velha reaparece no mesmo instante
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  m.est.liberar?.(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('retomado-volta-a-ocioso: depois do submit o store some, mas a fronteira gasta não pousa de novo', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.store.has(CHAVE)).toBe(false)
  m.est.percent = 55
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('x-baixo-um-pouso-por-veredito: X=1, percent definido em todo turno, um veredito ⇒ um pouso (S1)', async ($, on) => {
  const m = mundo($, on, { x: '1', percent: 5 })
  await m.inicio()
  for (let i = 0; i < 5; i++) { m.est.percent = 5; await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(1)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(m.tipos().filter((t) => t === 'sessao.retomada')).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
})
test('x-baixo-um-pouso-por-veredito: veredito novo abre uma segunda fronteira, e só uma', async ($, on) => {
  const m = mundo($, on, { x: '1', percent: 5 })
  await m.inicio()
  await m.turno(); await m.clock.settle()
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  m.add('o', 'task.concluida', { task: 'b', sha: 'y' })
  m.add('o', 'review.veredito', { task: 'b', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 })
  for (let i = 0; i < 4; i++) { m.est.percent = 5; await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(2)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(2)
})
test('sem-veredito-novo-nao-pousa: task nova em curso ou concluída depois do pouso não é fronteira', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  m.est.percent = 60; await m.turno(); await m.clock.settle()
  m.add('o', 'task.concluida', { task: 'b', sha: 'y' })
  m.est.percent = 60; await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('despacho-liberado-apos-pouso: com a fronteira consumida o Agent passa mesmo com percent ≥ X (E1)', async ($, on) => {
  const m = mundo($, on)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/) // antes: fronteira nova, POUSAVEL
  await pousar(m)
  m.est.percent = 60
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  expect((await m.agent(undefined)).deny).toBeUndefined()
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
test('veredito-novo-volta-a-travar: depois de gasto o pouso, outro veredito com percent ≥ X nega o despacho de novo', async ($, on) => {
  const m = mundo($, on, { agentes: [{ id: 'a1', status: 'running' }] })
  m.add('o', 'sessao.pouso', { percent: 60, x: 50 })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  m.add('o', 'task.concluida', { task: 'b', sha: 'y' })
  m.add('o', 'review.veredito', { task: 'b', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/esperar/)
})

// ---- tabela de estados: o que cada linha faz com o Agent e com o turno ----
test('estado-ocioso-abaixo-x: permite e nada grava', async ($, on) => {
  const m = mundo($, on, { percent: 20 })
  await pousar(m)
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  expect(m.tipos()).toEqual([])
})
test('estado-travado-vivos: nega o despacho, não pousa, não para', async ($, on) => {
  const m = mundo($, on, { agentes: [{ id: 'a1', status: 'running' }] })
  await pousar(m)
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(/esperar/)
  expect(m.est.clears).toBe(0)
  expect(parou(m)).toHaveLength(0)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
})
test('estado-pousando-nega: store com estado nega o despacho', async ($, on) => {
  const m = mundo($, on, { storeInicial: { [CHAVE]: { estado: 'retomando', desde: 1 } } })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/POUSANDO/)
})
test('estado-sem-pouso-nega: depois de falhar o pouso o despacho segue negado', async ($, on) => {
  const m = mundo($, on, { clearFalha: true })
  await pousar(m)
  m.est.percent = 60
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/SEM_POUSO/)
})
test('estado-sem-pouso-nao-interativo: -p nega o despacho acima de X', async ($, on) => {
  const m = mundo($, on, { interativo: false })
  await m.inicio(false)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/SEM_POUSO/)
})
test('estado-pousavel-nega: o núcleo manda pousar e o despacho fica negado enquanto o pouso não roda', async ($, on) => {
  const m = mundo($, on)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso pendente/)
})

// ---- J: task em voo sem agente vivo não é fronteira; o núcleo diz nao_conseguiu (5b), o mod espera 3 turnos (REQ-LOOP-5) ----
const EM_VOO = aposB(A_INI)
test('em-voo-sem-agente-para-nao-conseguiu: três turnos sem evento novo viram loop.parar nao_conseguiu com aviso visível, sem pouso', async ($, on) => {
  const m = mundo($, on, { eventos: EM_VOO })
  await m.inicio()
  await m.turno(); await m.turno()
  expect(parou(m)).toHaveLength(0)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/nao_conseguiu/)
  await m.turno(); await m.clock.settle()
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'nao_conseguiu', task: 'a' })
  expect(m.toasts.some((t) => t.includes('nao_conseguiu'))).toBe(true)
  expect(m.toasts.some((t) => t.includes('pouso automático falhou'))).toBe(false)
  expect(m.est.clears).toBe(0)
  await m.turno(); await m.turno(); await m.turno()
  expect(parou(m)).toHaveLength(1)
})
test('em-voo-zera-com-evento-novo: progresso no diário recomeça a contagem', async ($, on) => {
  const m = mundo($, on, { eventos: EM_VOO })
  await m.inicio()
  await m.turno(); await m.turno()
  m.add('o', 'ci.resultado', { verde: true })
  await m.turno(); await m.turno()
  expect(parou(m)).toHaveLength(0)
  await m.turno()
  expect(parou(m)).toHaveLength(1)
})
test('em-voo-ignora-a-propria-medicao: custo.medicao por turno não conta como progresso', async ($, on) => {
  const m = mundo($, on, { eventos: EM_VOO })
  await m.inicio()
  for (let i = 0; i < 3; i++) await m.turno({ usage: USO })
  expect(m.tipos().filter((t) => t === 'custo.medicao')).toHaveLength(3)
  expect(parou(m)).toHaveLength(1)
})
test('em-voo-contagem-recomeca-se-o-agente-reaparece: turno com agente vivo zera os turnos sem agente', async ($, on) => {
  const o: Opc = { eventos: EM_VOO }
  const m = mundo($, on, o)
  await m.inicio()
  await m.turno(); await m.turno()
  o.agentes = [{ id: 'a1', status: 'running' }]
  await m.turno()
  o.agentes = []
  await m.turno(); await m.turno()
  expect(parou(m)).toHaveLength(0)
  await m.turno()
  expect(parou(m)).toHaveLength(1)
})
test('em-voo-com-agente-vivo-espera: agente rodando nunca vira nao_conseguiu', async ($, on) => {
  const m = mundo($, on, { eventos: EM_VOO, agentes: [{ id: 'a1', status: 'running' }] })
  await m.inicio()
  for (let i = 0; i < 5; i++) await m.turno()
  expect(parou(m)).toHaveLength(0)
  expect(m.est.clears).toBe(0)
})

// ---- o núcleo decide (Sombra T9b, E7/E8): o mod só executa ----
test('x-cruzado-apos-integrada-pousa (MAJOR 1): veredito, task.integrada e só depois X cruzado ⇒ o despacho da próxima fica negado e o pouso acontece', async ($, on) => {
  const m = mundo($, on, { eventos: [...FRONT, INT_A] })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(m.tipos()).toContain('sessao.pouso')
  expect(parou(m)).toHaveLength(0)
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined() // pouso gasto, a fronteira foi consumida
})
test('x-cruzado-no-mesmo-turno-do-veredito (MAJOR 1, variante): integrada e percent alto no fim do turno', async ($, on) => {
  const m = mundo($, on, { percent: 5, x: '1', eventos: [...FRONT, INT_A] })
  await m.inicio()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('revisor-despachavel-nao-para (MAJOR 2): task concluída, percent alto, três turnos de conversa ⇒ sem loop.parar; o revisor passa; o implementador não', async ($, on) => {
  const m = mundo($, on, { eventos: A_REVISAR })
  await m.inicio()
  for (let i = 0; i < 6; i++) { await m.turno(); await m.clock.settle() }
  expect(parou(m)).toHaveLength(0)
  expect(m.est.clears).toBe(0)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/revisão pendente/)
  // o veredito chega: agora há o que pousar e o pouso acontece (o loop não ficou preso em SEM_POUSO)
  m.add('o', 'review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 })
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('consumida-nao-repousa: depois do pouso, com percent de novo ≥ X, nenhum turno limpa de novo e o Agent passa (E1)', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.est.clears).toBe(1)
  for (let i = 0; i < 4; i++) { m.est.percent = 70; await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(1)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
  m.est.percent = 70
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
const UM = { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }
const CASOS_AGENT: [string, Opc, 'nega' | 'passa'][] = [
  ['X cruzado com trabalho a fazer (K)', {}, 'nega'],
  ['abaixo de X', { percent: 49 }, 'passa'],
  ['tudo integrado (L: concluir, a (5) não dispara)', { plano_json: UM, eventos: [...FRONT, INT_A] }, 'passa'],
  ['fronteira consumida (F)', { eventos: [...FRONT, EV(4, 'sessao.pouso', { percent: 60, x: 50 })] }, 'passa'],
  ['só resta o teto (M: parar)', { plano_json: UM, eventos: NO_TETO }, 'nega'],
  ['task concluída à espera do revisor (H)', { eventos: A_REVISAR }, 'nega'],
  ['agente vivo (I)', { agentes: [{ id: 'a1', status: 'running' }] }, 'nega'],
  ['task em voo sem agente (J)', { eventos: EM_VOO }, 'nega'],
]
for (const [nome, opc, esperado] of CASOS_AGENT) {
  test(`agent-nega-so-se-5-dispara: ${nome} ⇒ ${esperado}`, async ($, on) => {
    const m = mundo($, on, opc)
    const r = await m.agent('gabarito-implementador')
    if (esperado === 'nega') expect(r.deny).toMatch(/pouso/)
    else expect(r.deny).toBeUndefined()
    expect((await m.agent('gabarito-revisor')).deny).toBeUndefined() // o revisor nunca é negado
  })
}
test('tudo-integrado-conclui-sem-pousar (L, 5d): nenhum pouso e nenhuma parada', async ($, on) => {
  const m = mundo($, on, { plano_json: { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }, eventos: [...FRONT, INT_A] })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
})
test('so-no-teto-para-teto-rodadas-uma-vez (M, 5d): sem pouso; loop.parar com o motivo do núcleo, uma vez só', async ($, on) => {
  const m = mundo($, on, { plano_json: { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }, eventos: NO_TETO })
  await m.inicio()
  for (let i = 0; i < 4; i++) { await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(0)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'teto_rodadas', task: 'a' })
  expect(m.toasts.some((t) => t.includes('teto_rodadas'))).toBe(true)
})
test('pausado-nao-pousa: PAUSAR presente ⇒ esperar do núcleo, Agent negado', async ($, on) => {
  const m = mundo($, on, { arquivos: [`${PRINCIPAL}/.harness/PAUSAR`] })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pausado/)
})
test('pausa-nao-confirmada-nao-pousa: fs.exists lançando conta como pausado', async ($, on) => {
  const m = mundo($, on, { existsFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
test('teto-de-tokens-para-sem-pousar: tokens medidos ≥ teto da config ⇒ loop.parar teto_tokens e nenhum clear', async ($, on) => {
  const m = mundo($, on, { config: { tetoTokens: 100 }, eventos: [...FRONT, EV(4, 'custo.medicao', { agente: 'orquestrador', input_tokens: 90, output_tokens: 20, cache_read: 99999, cache_creation: 0 })] })
  await m.inicio()
  for (let i = 0; i < 2; i++) { await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(0)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'teto_tokens' })
})
test('teto-de-tokens-leitura-de-cache-nao-conta: abaixo do teto o pouso segue', async ($, on) => {
  const m = mundo($, on, { config: { tetoTokens: 100 }, eventos: [...FRONT, EV(4, 'custo.medicao', { agente: 'orquestrador', input_tokens: 10, output_tokens: 20, cache_read: 99999, cache_creation: 0 })] })
  await pousar(m)
  expect(m.est.clears).toBe(1)
})
test('ci-vermelho-2x-para-sem-pousar', async ($, on) => {
  const m = mundo($, on, { eventos: [...FRONT, EV(4, 'ci.resultado', { verde: false }), EV(5, 'ci.resultado', { verde: false })] })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'ci_vermelho' })
})
test('diario-invalido-do-nucleo-nao-pousa-nem-grava: transição fora da tabela só avisa', async ($, on) => {
  const m = mundo($, on, { eventos: [EV(1, 'task.concluida', { task: 'a', sha: 'x' })] })
  await m.inicio()
  await m.turno(); await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(parou(m)).toHaveLength(0)
  expect(m.toasts.filter((t) => t.includes('transições'))).toHaveLength(1)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
})
test('plano-ilegivel-nao-pousa: a ponte não devolve plano ⇒ aviso, Agent negado, nenhum clear', async ($, on) => {
  const m = mundo($, on, { plano_json: 'falha' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.some((t) => t.includes('plano.json'))).toBe(true)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/ilegíveis/)
})
test('teto-de-config-invalido-nao-pousa: teto que não é inteiro positivo vindo da ponte nunca vira "sem teto"', async ($, on) => {
  const m = mundo($, on, { config: { tetoTokens: 0 } })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
test('nucleo-lancando-nao-pousa: plano que quebra proximaAcao ⇒ sem pouso, sem sucesso, turno devolvido', async ($, on) => {
  const m = mundo($, on, { plano_json: { entrega: 'x', tasks: 5 } })
  await m.inicio()
  const r = await m.turno({ answer: 'ok' }); await m.clock.settle()
  expect(r.text).toBe('ok')
  expect(m.est.clears).toBe(0)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
})
test('diario-ilegivel-nega-agent: leitura que falha (ok falso) nega o despacho acima de X', async ($, on) => {
  const m = mundo($, on, { lerFalha: true })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/ilegíveis/)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
})
test('agent-list-falha-conta-vivo-no-nucleo: lista de agentes que lança ⇒ esperar, nunca pouso', async ($, on) => {
  const m = mundo($, on, { agentes: 'falha' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/esperar/)
})
test('parar-ja-gravado-nao-repete-no-reload: diário já termina em loop.parar ⇒ nenhum segundo', async ($, on) => {
  const m = mundo($, on, { plano_json: { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }, eventos: [...NO_TETO, EV(7, 'loop.parar', { motivo: 'teto_rodadas', task: 'a' })] })
  await m.inicio()
  await m.turno(); await m.turno()
  expect(parou(m)).toHaveLength(0)
})

// ---- leitura estrita do diário: dado ruim nunca vira fronteira (MAJOR 2) ----
test('diario-truncado-nao-pousa (C1): a ponte estrita recusa e o mod avisa', async ($, on) => {
  const m = mundo($, on, { lerFalha: true, lerErro: 'linha 4 ilegível em events.s0.jsonl' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.some((t) => t.includes('diário') && t.includes('linha 4'))).toBe(true)
})
test('lacuna-seq-nao-pousa (C2): lacuna de seq recusada pela ponte', async ($, on) => {
  const m = mundo($, on, { lerFalha: true, lerErro: 'lacuna de seq na linha 3 de events.s0.jsonl' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.some((t) => t.includes('lacuna de seq'))).toBe(true)
})
test('evento-sem-task-nao-pousa (C3): evento de task sem task depois do veredito', async ($, on) => {
  const m = mundo($, on, { eventos: [...FRONT, { seq: 4, ts: '2026-11-03T00:00:04.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.iniciada', dados: { papel: 'implementador' }, hash_anterior: null }] })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.some((t) => t.includes('diário') && t.includes('task'))).toBe(true)
})
test('arquivo-ilegivel-nao-pousa (C4): ponte que devolve erro de leitura nunca vira pouso, e o aviso não se repete', async ($, on) => {
  const m = mundo($, on, { lerFalha: true, lerErro: 'arquivo ilegível: events.s1.jsonl' })
  await m.inicio()
  await m.turno(); await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.toasts.filter((t) => t.includes('arquivo ilegível'))).toHaveLength(1)
})
test('diario-volta-a-ser-integro: depois de um aviso, a leitura boa pousa', async ($, on) => {
  const o: Opc = { lerFalha: true }
  const m = mundo($, on, o)
  await m.inicio()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  o.lerFalha = false
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})

// ---- entrega resolvida a cada disparo (MAJOR 3) ----
test('entrega-muda-com-branch: sessão aberta sem plano, depois a branch do PBI: o mod passa a agir na pasta nova (S2)', async ($, on) => {
  const m = mundo($, on, { plano: false })
  await m.inicio()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.pedidos.filter((p) => p.op === 'append')).toHaveLength(0)
  m.est.dir = '/repo/.harness/entregas/PBI-8'
  m.est.plano = true
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  await m.turno({ usage: USO }); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(m.store.has('pouso:/repo/.harness/entregas/PBI-8')).toBe(false)
  const dirs = new Set(m.pedidos.filter((p) => p.op === 'append').map((p) => p.dir))
  expect([...dirs]).toEqual(['/repo/.harness/entregas/PBI-8'])
  expect(m.tipos()).toContain('custo.medicao')
})
test('entrega-muda-com-branch: de volta a main sem plano, o mod volta a não mudar nada', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  m.est.plano = false
  m.est.dir = '/repo/.harness/entregas/_sem-id'
  await m.turno({ usage: USO }); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})

// ---- interrupção, erro e reason desconhecido nunca pousam (MAJOR 4) ----
test('abortado-nao-pousa: Esc do dono (isAborted) com tudo a favor não limpa nem submete (S3)', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ isAborted: true, reason: 'aborted' }); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.est.submits).toHaveLength(0)
  await m.turno({ isAborted: true }); await m.clock.settle() // reason 'answer' com isAborted ainda não pousa
  expect(m.est.clears).toBe(0)
  await m.turno(); await m.clock.settle() // o fim normal seguinte pousa
  expect(m.est.clears).toBe(1)
})
test('erro-api-nao-pousa: reason error não limpa o contexto no meio da falha (S3b)', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ reason: 'error' }); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.est.submits).toHaveLength(0)
})
for (const reason of ['refusal', 'xyz', '', 'ANSWER', undefined, null]) {
  test(`reason-desconhecido-nao-pousa-${String(reason)}: só 'answer' decide (lista permitida)`, async ($, on) => {
    const m = mundo($, on)
    await m.inicio()
    await m.turno({ reason }); await m.clock.settle()
    expect(m.est.clears).toBe(0)
  })
}
test('isaborted-nao-booleano-nao-pousa: ausente ou texto não vira fim normal', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ isAborted: undefined }); await m.turno({ isAborted: 'false' }); await m.turno({ isAborted: null }); await m.clock.settle()
  expect(m.est.clears).toBe(0)
})
test('abortado-ainda-mede: o custo do turno interrompido existe e vai ao diário', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ isAborted: true, reason: 'aborted', usage: USO })
  expect(m.grav.filter((g) => g.tipo === 'custo.medicao')).toHaveLength(1)
  expect(m.est.clears).toBe(0)
})
test('erro-api-nao-pousa: API que lança em todo lugar nunca vira pouso nem sucesso', async ($, on) => {
  const m = mundo($, on, { usageFalha: true, agentes: 'falha', lerFalha: true })
  await m.inicio()
  const r = await m.turno({ answer: 'ok' }); await m.clock.settle()
  expect(r.text).toBe('ok')
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
})

// ---- pouso: falhas ----
const parou = (m: ReturnType<typeof mundo>) => m.grav.filter((g) => g.tipo === 'loop.parar')
test('clear-falha: sem_pouso, aviso, ocioso, sem submit, sem segundo clear', async ($, on) => {
  const m = mundo($, on, { clearFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'clear' })
  expect(m.toasts.some((t) => t.includes('sem_pouso'))).toBe(true)
  expect(m.log.includes('submit')).toBe(false)
  expect(m.store.has(CHAVE)).toBe(false)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(parou(m)).toHaveLength(1)
})
test('desistiu-ate-descer: falha antes de gastar a fronteira só volta a tentar quando o percent cair abaixo de X', async ($, on) => {
  const o: Opc = { storeSetFalha: true }
  const m = mundo($, on, o)
  await pousar(m)
  expect(m.est.clears).toBe(0)
  o.storeSetFalha = false
  m.est.percent = 70
  await m.turno(); await m.clock.settle() // ainda desistiu: percent não caiu
  expect(m.est.clears).toBe(0)
  m.est.percent = 10
  await m.turno(); await m.clock.settle()
  m.est.percent = 70
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('falha-depois-do-pouso-gasta-a-fronteira: clear que falha grava sessao.pouso e não tenta de novo sem veredito novo', async ($, on) => {
  const m = mundo($, on, { clearFalha: true })
  await pousar(m)
  m.est.percent = 10
  await m.turno(); await m.clock.settle()
  m.est.percent = 70
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('submit-falha: sem_pouso, aviso, ocioso', async ($, on) => {
  const m = mundo($, on, { submitFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'submit' })
  expect(m.grav.some((g) => g.tipo === 'sessao.retomada')).toBe(false)
  expect(m.toasts.some((t) => t.includes('sem_pouso'))).toBe(true)
  expect(m.store.has(CHAVE)).toBe(false)
})
test('instantaneo-falha: sem clear', async ($, on) => {
  const m = mundo($, on, { instantaneo: 'falha' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'instantaneo' })
  expect(m.store.has(CHAVE)).toBe(false)
})
test('instantaneo-acima-do-teto: não trunca e não faz clear', async ($, on) => {
  const m = mundo($, on, { instantaneo: 'x'.repeat(3201) })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.est.submits).toHaveLength(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'instantaneo' })
})
test('instantaneo-vazio: não vira prompt', async ($, on) => {
  const m = mundo($, on, { instantaneo: '' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
})
test('evento-pouso-nao-gravou: sem clear', async ($, on) => {
  const m = mundo($, on, { appendFalha: ['sessao.pouso'] })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'diario' })
})
test('store-fora-do-ar-nao-faz-clear', async ($, on) => {
  const m = mundo($, on, { storeSetFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.some((t) => t.includes('sem_pouso'))).toBe(true)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'store' })
})
test('store-que-nao-grava-nao-faz-clear: set responde e get não devolve', async ($, on) => {
  const m = mundo($, on, { storeNaoGrava: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'store' })
})
test('store-grava-outro-valor-nao-faz-clear: o get volta com estado diferente de pousando', async ($, on) => {
  const m = mundo($, on, { storeGravaOutro: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'store' })
})
test('store-diz-pousando-bloqueia: estado gravado por outro processo ou antes de um reload impede novo pouso', async ($, on) => {
  const m = mundo($, on, { storeInicial: { [CHAVE]: { estado: 'retomando', desde: 1 } } })
  await m.turno(); await m.clock.settle() // sem session.start: o estado ainda vale
  expect(m.est.clears).toBe(0)
  expect(m.log.includes('instantaneo')).toBe(false)
})
test('store-corrompido-bloqueia: valor que não é um estado conhecido nunca vira pouso', async ($, on) => {
  const m = mundo($, on, { storeInicial: { [CHAVE]: 'lixo' } })
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
})
test('falha-do-mod-nao-derruba-o-turno: usage fora do ar devolve o resultado do turno e não pousa', async ($, on) => {
  const m = mundo($, on, { usageFalha: true })
  await m.inicio()
  const r = await m.turno({ answer: 'resposta' })
  await m.clock.settle()
  expect(r.text).toBe('resposta')
  expect(m.est.clears).toBe(0)
})
test('sem-sessao-no-p: não interativo grava sem_pouso uma vez e nunca faz clear', async ($, on) => {
  const m = mundo($, on, { interativo: false })
  await m.inicio(false)
  await m.turno(); await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'nao_interativo' })
})
for (const estado of ['pousando', 'retomando']) {
  test(`processo-morreu-no-meio-${estado}: ao iniciar vira ocioso, com aviso e sem clear`, async ($, on) => {
    const m = mundo($, on, { percent: 10, storeInicial: { [CHAVE]: { estado, desde: 1 } } })
    await m.inicio()
    expect(m.toasts.some((t) => t.includes(estado))).toBe(true)
    expect(m.store.has(CHAVE)).toBe(false)
    expect(m.est.clears).toBe(0)
  })
}

// ---- Agent acima de X ----
test('agent-negado-acima-de-x', async ($, on) => {
  const m = mundo($, on)
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(/pouso/)
  expect((await m.agent(undefined)).deny).toMatch(/pouso/)
})
test('agent-negado-em-x-exato', async ($, on) => {
  const m = mundo($, on, { percent: 50 })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
})
test('revisor-passa-acima-x: igualdade com o nome real, só ele', async ($, on) => {
  const m = mundo($, on)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  expect((await m.agent('gabarito-mestre:gabarito-revisor')).deny).toBeUndefined()
  expect((await m.agent('gabarito-revisor-2')).deny).toMatch(/pouso/)
  expect((await m.agent('Gabarito-Revisor')).deny).toMatch(/pouso/)
})
test('agent-abaixo-de-x-passa', async ($, on) => {
  const m = mundo($, on, { percent: 49 })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
test('agent-percent-indefinido-passa: depois do clear o despacho volta', async ($, on) => {
  const m = mundo($, on, { percent: null })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
test('agent-usage-fora-do-ar-passa: o mod não prende a sessão', async ($, on) => {
  const m = mundo($, on, { usageFalha: true })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
test('agent-x-do-env: respeita GABARITO_POUSO_X', async ($, on) => {
  const m = mundo($, on, { x: '70' })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})

// ---- /gabarito pausar|retomar ----
const ARQ = `${PRINCIPAL}/.harness/PAUSAR`
test('gabarito-registra-o-comando', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  expect(m.log).toContain('register:gabarito')
})
test('gabarito-pausar-escreve: PAUSAR na raiz principal e loop.pausa', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  const r = await m.cmd('pausar')
  expect(m.arquivos.has(ARQ)).toBe(true)
  expect(r.text).toMatch(/^Pausado/)
  expect(m.grav.filter((g) => g.tipo === 'loop.pausa')).toEqual([{ agente: 'orquestrador', tipo: 'loop.pausa', dados: { estado: 'pausado' } }])
})
test('gabarito-retomar-remove: apaga PAUSAR e grava loop.pausa, nunca task.reaberta', async ($, on) => {
  const m = mundo($, on, { arquivos: [ARQ] })
  await m.inicio()
  const r = await m.cmd('retomar')
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(r.text).toMatch(/^Retomado/)
  expect(m.grav.filter((g) => g.tipo === 'loop.pausa')).toEqual([{ agente: 'orquestrador', tipo: 'loop.pausa', dados: { estado: 'retomado' } }])
  expect(m.tipos().includes('task.reaberta')).toBe(false)
})
// ---- /gabarito retomar recomeça o loop (T15, fatos E e F) ----
const PLANO5 = { entrega: 'PBI-7', tasks: ['a', 'b', 'c', 'd'].map((id) => ({ id, deps: [], arquivos: [`${id}.ts`] })) }
const VOO = [
  EV(1, 'task.iniciada', { task: 'a', papel: 'implementador' }),
  EV(2, 'task.iniciada', { task: 'b', papel: 'implementador' }), EV(3, 'task.concluida', { task: 'b', sha: 'x' }), EV(4, 'task.iniciada', { task: 'b', papel: 'revisor' }),
  EV(5, 'task.iniciada', { task: 'c', papel: 'implementador' }), EV(6, 'task.concluida', { task: 'c', sha: 'y' }),
  EV(7, 'review.veredito', { task: 'c', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }), EV(8, 'task.iniciada', { task: 'c', papel: 'correcao' }),
  EV(9, 'task.iniciada', { task: 'd', papel: 'implementador' }), EV(10, 'task.concluida', { task: 'd', sha: 'z' }),
]
const retomarCom = async ($: any, on: any, o: Opc = {}) => {
  const m = mundo($, on, { arquivos: [ARQ], ...o })
  await m.inicio()
  const r = await m.cmd('retomar')
  await m.clock.settle()
  return { m, r }
}
const pausaRetomado = (m: ReturnType<typeof mundo>) => m.grav.filter((g) => g.tipo === 'loop.pausa')
const ESPERADO = [{ agente: 'orquestrador', tipo: 'loop.pausa', dados: { estado: 'retomado' } }]
test('retomar-vivos-0-com-task-em-voo: remove, task.reaberta {retomada} em cada task em voo, loop.pausa, depois prompt.submit', async ($, on) => {
  const { m, r } = await retomarCom($, on, { eventos: VOO, plano_json: PLANO5, agentes: [] })
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(m.grav.filter((g) => g.tipo === 'task.reaberta').map((g) => g.dados)).toEqual([
    { task: 'a', origem: 'retomada' }, { task: 'b', origem: 'retomada' }, { task: 'c', origem: 'retomada' },
  ])
  expect(pausaRetomado(m)).toEqual(ESPERADO)
  expect(m.log.filter((l) => /^(unlink|append|submit)/.test(l)).map((l) => l.replace(/:.*PAUSAR$/, ''))).toEqual([
    'unlink', 'append:task.reaberta', 'append:task.reaberta', 'append:task.reaberta', 'append:loop.pausa', 'submit',
  ])
  expect(m.est.submits).toHaveLength(1)
  expect(r.text).toMatch(/^Retomado/)
})
test('retomar-vivos-0-sem-task-em-voo: remove, loop.pausa e prompt.submit, sem task.reaberta', async ($, on) => {
  const { m } = await retomarCom($, on, { agentes: [] })
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(m.tipos()).toEqual(['loop.pausa'])
  expect(pausaRetomado(m)).toEqual(ESPERADO)
  expect(m.est.submits).toHaveLength(1)
})
test('retomar-vivos-maior-que-0: remove e grava loop.pausa, não reabre, não abre turno, diz que os vivos terminam', async ($, on) => {
  const { m, r } = await retomarCom($, on, { eventos: VOO, plano_json: PLANO5, agentes: [{ id: 'ag1', status: 'running' }] })
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(m.tipos()).toEqual(['loop.pausa'])
  expect(m.est.submits).toHaveLength(0)
  expect(r.text).toMatch(/vivos terminam/)
})
for (const [nome, o, causa] of [
  ['agentes-nao-medidos', { agentes: 'falha' }, /vivos.*não medido/],
  ['diario-ilegivel', { lerFalha: true, lerErro: 'linha truncada' }, /diário.*linha truncada/],
  ['plano-ilegivel', { plano_json: 'falha' }, /plano/],
] as [string, Opc, RegExp][]) {
  test(`retomar-${nome}: remove e grava loop.pausa, não reabre, não abre turno, texto com a causa`, async ($, on) => {
    const { m, r } = await retomarCom($, on, { eventos: VOO, ...o, agentes: o.agentes ?? [] })
    expect(m.arquivos.has(ARQ)).toBe(false)
    expect(m.tipos()).toEqual(['loop.pausa'])
    expect(m.est.submits).toHaveLength(0)
    expect(r.text).toMatch(causa)
    expect(r.text).not.toMatch(/o loop volta/)
  })
}
test('retomar-reabrir-falha: task que não reabriu não vira loop de volta; sem turno, texto com a causa, loop.pausa gravado', async ($, on) => {
  const { m, r } = await retomarCom($, on, { eventos: VOO, plano_json: PLANO5, agentes: [], appendFalha: ['task.reaberta'] })
  expect(m.tipos()).toEqual(['loop.pausa'])
  expect(m.est.submits).toHaveLength(0)
  expect(r.text).toMatch(/task\.reaberta|reabrir/)
})
test('retomar-submit-falha: não diz que o loop volta; avisa na tela', async ($, on) => {
  const { m, r } = await retomarCom($, on, { agentes: [], submitFalha: true })
  expect(pausaRetomado(m)).toEqual(ESPERADO)
  expect(m.toasts.join(' ')).toMatch(/não voltou sozinho/)
  expect(r.text).not.toMatch(/o loop volta sozinho\.$/)
})
test('retomar-sem-entrega-com-plano: remove o arquivo e diz retomado, mas não há loop a recomeçar (nada reaberto, nenhum turno)', async ($, on) => {
  const { m, r } = await retomarCom($, on, { plano: false, agentes: [], eventos: VOO, plano_json: PLANO5 })
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(r.text).toMatch(/^Retomado/)
  expect(m.tipos().includes('task.reaberta')).toBe(false)
  expect(m.est.submits).toHaveLength(0)
})
test('retomar-exists-lanca-nao-diz-retomado: fs.exists do plano lançando não vira "sem loop": tasks em voo seguem, sem turno, texto com a causa', async ($, on) => {
  const { m, r } = await retomarCom($, on, { eventos: VOO, plano_json: PLANO5, agentes: [], existsPlanoFalha: true })
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(m.tipos()).toEqual(['loop.pausa'])
  expect(m.est.submits).toHaveLength(0)
  expect(r.text).toMatch(/não consegui confirmar se há plano\.json/)
  expect(r.text).toMatch(/não recomeça sozinho/)
})
test('retomar-ponte-falha-nao-diz-retomado: ponte falhando não vira "sem loop": sem reabrir, sem turno, texto com a causa', async ($, on) => {
  const { m, r } = await retomarCom($, on, { eventos: VOO, plano_json: PLANO5, agentes: [], ponteSai1: true })
  expect(m.arquivos.has(ARQ)).toBe(false)
  expect(m.tipos()).toEqual([])
  expect(m.est.submits).toHaveLength(0)
  expect(r.text).toMatch(/ponte do diário falhou/)
  expect(r.text).toMatch(/não recomeça sozinho/)
})
// ---- não consegui ler o plano nos outros chamadores de loopAtivo: avisa (uma vez), nunca pousa, nunca vira "sem loop" calado ----
test('turno-exists-lanca-avisa-e-nao-pousa: aoCompletarTurno com fs.exists do plano lançando', async ($, on) => {
  const m = mundo($, on, { existsPlanoFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop.*plano\.json/)
  await m.turno(); await m.clock.settle()
  expect(m.toasts.filter((t) => /não consegui ler se há loop/.test(t))).toHaveLength(1)
})
test('turno-ponte-falha-avisa-e-nao-pousa: aoCompletarTurno com a ponte falhando', async ($, on) => {
  const m = mundo($, on, { ponteSai1: true })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop.*ponte do diário falhou/)
})
test('agent-exists-lanca-avisa-e-nao-pousa: tool.call Agent com fs.exists do plano lançando avisa, sem pouso', async ($, on) => {
  const m = mundo($, on, { existsPlanoFalha: true })
  await m.inicio()
  await m.agent('gabarito-implementador')
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop/)
  expect(m.est.clears).toBe(0)
})
test('medicao-orquestrador-exists-lanca-avisa: sem custo.medicao gravada e aviso visível', async ($, on) => {
  const m = mundo($, on, { existsPlanoFalha: true, percent: 10 })
  await m.inicio()
  await m.turno({ isAborted: true, reason: 'aborted', usage: USO }) // só a medição roda: o aviso não pode vir da decisão do turno
  await m.clock.settle()
  expect(m.tipos()).toEqual([])
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop/)
})
test('medicao-subagent-exists-lanca-avisa: sem custo.medicao do subagent e aviso visível', async ($, on) => {
  const m = mundo($, on, { existsPlanoFalha: true })
  await m.inicio()
  await m.turno({ agentId: 'ag1', usage: USO }); await m.clock.settle()
  expect(m.tipos()).toEqual([])
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop/)
})
test('sem-plano-de-verdade-nao-avisa: plano.json ausente (exists devolve false) segue calado', async ($, on) => {
  const m = mundo($, on, { plano: false })
  await pousar(m)
  await m.agent('gabarito-implementador')
  expect(m.toasts).toEqual([])
  expect(m.est.clears).toBe(0)
})
test('retomar-sem-pausar-nao-abre-turno: sem PAUSAR nada grava e nada é enviado', async ($, on) => {
  const m = mundo($, on, { agentes: [], eventos: VOO, plano_json: PLANO5 })
  await m.inicio()
  const r = await m.cmd('retomar')
  await m.clock.settle()
  expect(r.text).toMatch(/não estava pausado/i)
  expect(m.tipos()).toEqual([])
  expect(m.est.submits).toHaveLength(0)
})
test('retomar-remocao-falha-nao-abre-turno: arquivo continua, nada reaberto, nada enviado', async ($, on) => {
  const { m, r } = await retomarCom($, on, { agentes: [], eventos: VOO, plano_json: PLANO5, unlinkFalha: true })
  expect(r.text).toMatch(/^Falhou/)
  expect(m.arquivos.has(ARQ)).toBe(true)
  expect(m.tipos()).toEqual([])
  expect(m.est.submits).toHaveLength(0)
})

test('pausar-falha-de-escrita: diz que falhou, não diz pausado, não grava evento', async ($, on) => {
  const m = mundo($, on, { writeFalha: true })
  await m.inicio()
  const r = await m.cmd('pausar')
  expect(r.text).toMatch(/^Falhou/)
  expect(r.text).not.toMatch(/^Pausado/)
  expect(m.tipos()).toEqual([])
})
test('pausar-escrita-nao-confirmada: o arquivo não aparece depois do write', async ($, on) => {
  const m = mundo($, on, { escritaNaoAparece: true })
  await m.inicio()
  const r = await m.cmd('pausar')
  expect(r.text).toMatch(/^Falhou/)
  expect(m.tipos()).toEqual([])
})
test('retomar-falha-de-remocao: arquivo continua, diz que falhou, não grava evento', async ($, on) => {
  const m = mundo($, on, { arquivos: [ARQ], unlinkFalha: true })
  await m.inicio()
  const r = await m.cmd('retomar')
  expect(r.text).toMatch(/^Falhou/)
  expect(r.text).not.toMatch(/^Retomado/)
  expect(m.arquivos.has(ARQ)).toBe(true)
  expect(m.tipos()).toEqual([])
})
test('retomar-unlink-sai-1: o arquivo sumiu mas o comando falhou, então não afirma retomado', async ($, on) => {
  const m = mundo($, on, { arquivos: [ARQ], unlinkSai1ArquivoSome: true })
  await m.inicio()
  const r = await m.cmd('retomar')
  expect(r.text).toMatch(/^Falhou/)
  expect(m.tipos()).toEqual([])
})
test('retomar-remocao-silenciosa: unlink sai 0 e o arquivo continua, então não diz retomado', async ($, on) => {
  const m = mundo($, on, { arquivos: [ARQ], unlinkSilencioso: true })
  await m.inicio()
  const r = await m.cmd('retomar')
  expect(r.text).toMatch(/^Falhou/)
  expect(m.tipos()).toEqual([])
})
test('retomar-sem-arquivo: diz que não estava pausado e não grava', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  const r = await m.cmd('retomar')
  expect(r.text).toMatch(/não estava pausado/i)
  expect(m.tipos()).toEqual([])
})
for (const args of ['', 'foo', 'pausar x', 'PAUSAR', 'retomar tudo', ' ']) {
  test(`gabarito-args-invalidos-mostra-uso-${JSON.stringify(args)}: nada escrito, nada gravado`, async ($, on) => {
    const m = mundo($, on)
    await m.inicio()
    const r = await m.cmd(args)
    expect(r.text).toMatch(/^Uso:/)
    expect(m.arquivos.size).toBe(0)
    expect(m.tipos()).toEqual([])
  })
}
test('gabarito-args-com-espaco-nas-pontas: " pausar " vale', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  expect((await m.cmd(' pausar ')).text).toMatch(/^Pausado/)
})
test('pausar-diario-fora-do-ar: o arquivo vale e a resposta avisa que o diário não gravou', async ($, on) => {
  const m = mundo($, on, { appendFalha: ['loop.pausa'] })
  await m.inicio()
  const r = await m.cmd('pausar')
  expect(m.arquivos.has(ARQ)).toBe(true)
  expect(r.text).toMatch(/^Pausado/)
  expect(r.text).toMatch(/diário/)
})

// ---- medição (REQ-OBS-1, F4) ----
const USO = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, model: 'm' }
test('medicao-por-agente: turn.complete de subagent grava custo.medicao só com números, uma vez por agente', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ agentId: 'ag1', usage: USO, answer: 'rm -rf SENTINELA-CRUA' })
  const g = m.grav.filter((x) => x.tipo === 'custo.medicao')
  expect(g).toEqual([{ agente: 'subagent:ag1', tipo: 'custo.medicao', dados: { input_tokens: 100, output_tokens: 20, cache_read: 5, cache_creation: 7 } }])
  expect(JSON.stringify(m.pedidos)).not.toContain('SENTINELA-CRUA')
  expect(m.pedidos.find((p) => p.op === 'append')?.unicoPorAgente).toBe(true)
})
test('medicao-sem-usage-ou-invalido: nada gravado', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ agentId: 'ag1' })
  await m.turno({ agentId: 'ag1', usage: { ...USO, input_tokens: -3 } })
  expect(m.tipos()).toEqual([])
})
test('medicao-sem-loop: sem plano.json não grava', async ($, on) => {
  const m = mundo($, on, { plano: false })
  await m.inicio()
  await m.turno({ agentId: 'ag1', usage: USO })
  expect(m.tipos()).toEqual([])
})
test('medicao-agentid-estranho: id fora do padrão não vira nome de agente', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ agentId: '../x', usage: USO })
  expect(m.tipos()).toEqual([])
})
test('mede-orquestrador: turno principal grava custo.medicao {agente: orquestrador}, um por turno, só números (S4)', async ($, on) => {
  const m = mundo($, on, { percent: 5 })
  await m.inicio()
  await m.turno({ usage: USO, answer: 'rm -rf SENTINELA-CRUA' })
  await m.turno({ usage: { ...USO, input_tokens: 40 } })
  const g = m.grav.filter((x) => x.tipo === 'custo.medicao')
  expect(g).toEqual([
    { agente: 'orquestrador', tipo: 'custo.medicao', dados: { input_tokens: 100, output_tokens: 20, cache_read: 5, cache_creation: 7 } },
    { agente: 'orquestrador', tipo: 'custo.medicao', dados: { input_tokens: 40, output_tokens: 20, cache_read: 5, cache_creation: 7 } },
  ])
  expect(JSON.stringify(m.pedidos)).not.toContain('SENTINELA-CRUA')
  expect(m.pedidos.filter((p) => p.op === 'append').every((p) => p.unicoPorAgente !== true)).toBe(true)
})
test('mede-orquestrador-sem-usage-ou-invalido: nada inventado', async ($, on) => {
  const m = mundo($, on, { percent: 5 })
  await m.inicio()
  await m.turno()
  await m.turno({ usage: { ...USO, output_tokens: -1 } })
  await m.turno({ usage: { input_tokens: 1 } })
  expect(m.tipos()).toEqual([])
})
test('mede-orquestrador-sem-loop: sem plano.json não grava', async ($, on) => {
  const m = mundo($, on, { plano: false })
  await m.inicio()
  await m.turno({ usage: USO })
  expect(m.tipos()).toEqual([])
})
test('mede-orquestrador-nao-do-subagent: turno de subagent grava só o dele', async ($, on) => {
  const m = mundo($, on, { percent: 5 })
  await m.inicio()
  await m.turno({ agentId: 'ag1', usage: USO })
  expect(m.grav.map((g) => g.agente)).toEqual(['subagent:ag1'])
})
test('mede-orquestrador-com-pouso: o turno que pousa também é medido, antes do evento de pouso', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.turno({ usage: USO }); await m.clock.settle()
  expect(m.tipos()).toEqual(['custo.medicao', 'sessao.pouso', 'sessao.retomada'])
})
test('mede-orquestrador-diario-fora-do-ar: falha ao gravar a medição não derruba o turno nem o pouso', async ($, on) => {
  const m = mundo($, on, { appendFalha: ['custo.medicao'] })
  await m.inicio()
  const r = await m.turno({ usage: USO, answer: 'ok' }); await m.clock.settle()
  expect(r.text).toBe('ok')
  expect(m.est.clears).toBe(1)
})

// ---- instantâneo reinjetado (F3) ----
test('instantaneo-tokens: o prompt de retomada cabe em 1,5k tokens (≈2,16 caracteres por token, S12) e sem comando cru', async ($, on) => {
  const inst = ('2026-11-03T00:00:00.000Z task.iniciada src/a.ts\n').repeat(60).slice(0, 3200)
  const m = mundo($, on, { instantaneo: inst })
  await pousar(m)
  const texto = m.est.submits[0]
  expect(texto).toContain(inst)
  expect(inst.length / 2.16).toBeLessThanOrEqual(1500)
  expect(texto.length - inst.length).toBeLessThan(160)
  for (const g of m.grav) expect(JSON.stringify(g.dados)).not.toMatch(/rm -rf|git push|curl /)
})

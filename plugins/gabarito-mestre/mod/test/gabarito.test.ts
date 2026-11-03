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
}

const FRONT = [
  { seq: 1, ts: '2026-11-03T00:00:01.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.iniciada', dados: { task: 'a', papel: 'implementador' }, hash_anterior: null },
  { seq: 2, ts: '2026-11-03T00:00:02.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'task.concluida', dados: { task: 'a', sha: 'x' }, hash_anterior: null },
  { seq: 3, ts: '2026-11-03T00:00:03.000Z', autor: 'a', sessao: 's0', agente: 'o', tipo: 'review.veredito', dados: { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, hash_anterior: null },
]
const SEM_FRONT = FRONT.slice(0, 2)
const CHAVE = `pouso:${DIR}`

// O mundo debaixo do mod: tudo em memória, com um log único de chamadas na ordem em que acontecem.
function mundo($: any, on: any, o: Opc = {}) {
  const log: string[] = []
  const grav: Ev[] = []
  const toasts: string[] = []
  const pedidos: any[] = []
  const store = new Map<string, unknown>(Object.entries(o.storeInicial ?? {}))
  const arquivos = new Set<string>(o.arquivos ?? [])
  const est = { percent: o.percent === undefined ? 60 : o.percent, clears: 0, submits: [] as string[], liberar: null as null | (() => void) }

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
  on('fs.exists', (_: any, e: any) => ({ value: arquivos.has(e.path) || (e.path === `${DIR}/plano.json` && o.plano !== false) }))
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
      if (q.op === 'dir') return ok(JSON.stringify({ ok: true, raiz: RAIZ, dir: DIR, plano: o.plano !== false }))
      if (q.op === 'ler') return ok(JSON.stringify(o.lerFalha ? { ok: false, erro: 'x' } : { ok: true, eventos: o.eventos ?? FRONT }))
      if (q.op === 'instantaneo') {
        log.push('instantaneo')
        const t = o.instantaneo ?? 'Diário: 3 evento(s)\nETA: sem dados'
        return ok(JSON.stringify(t === 'falha' ? { ok: false, erro: 'x' } : { ok: true, texto: t }))
      }
      if (q.op === 'append') {
        log.push(`append:${q.ev.tipo}`)
        if (o.appendFalha?.includes(q.ev.tipo)) return ok(JSON.stringify({ ok: false, erro: 'x' }))
        grav.push({ agente: q.ev.agente, tipo: q.ev.tipo, dados: q.ev.dados })
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
  return { log, grav, toasts, pedidos, store, arquivos, est, clock, turno, agent, inicio, cmd, tipos }
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
test('retomado-volta-a-ocioso: depois do submit um novo ciclo pode pousar', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.store.has(CHAVE)).toBe(false)
  m.est.percent = 55
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(2)
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
test('desistiu-ate-descer: depois de falhar, volta a tentar só quando o percent cair abaixo de X', async ($, on) => {
  const m = mundo($, on, { clearFalha: true })
  await pousar(m)
  m.est.percent = 10
  await m.turno(); await m.clock.settle()
  m.est.percent = 70
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(2)
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
test('medicao-nao-do-orquestrador: turno principal não grava custo.medicao', async ($, on) => {
  const m = mundo($, on, { percent: 5 })
  await m.inicio()
  await m.turno({ usage: USO })
  expect(m.tipos()).toEqual([])
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

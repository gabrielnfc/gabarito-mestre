/**
 * Testes do chat em linguagem natural (GM-14 T5, REQ-CHT-1) por `claude plugin test`. Mutações: task-5-mut.json (M-T5a: desenha mesmo com `isExpanded`).
 * Limite declarado (S2b, t0a.md): a chamada solo chega como `ToolGroup` de 1 (o site `ToolUse` disparou 0 vezes), por isso nada registra `ToolUse`.
 * Só `Read` solo foi medido; Bash, Edit e Agent solo são presumidos.
 */
import { expect, test } from 'claude-code/testing'

const CHAVE = 'chat:prefs'
const RAIZ = '/repo'

type Opc = { prefs?: unknown; storeSetFalha?: boolean; storeGetFalha?: boolean }

/** O mundo debaixo do mod: store em memória e o motor desenhando `motor` quando o mod chama `next(e)`. */
function mundo($: any, on: any, o: Opc = {}) {
  const store = new Map<string, unknown>(o.prefs === undefined ? [] : [[CHAVE, o.prefs]])
  const logs: string[] = []
  const sets: unknown[] = []
  on('session.root', () => ({ value: RAIZ }))
  on('store.get', (_: any, e: any) => (o.storeGetFalha ? { deny: 'store fora do ar' } : { value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => {
    if (o.storeSetFalha) return { deny: 'store fora do ar' }
    if (e.key === CHAVE) sets.push(e.value)
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', (_: any, e: any) => { logs.push(e.text); return { value: undefined } })
  on('ui.render', { component: 'ToolGroup' }, ($: any, e: any) => { const { Text } = $.ui.resolve(e); return h(Text, null, 'motor') })
  return { store, logs, sets, cmd: (args: string) => $.command.run({ command: 'gabarito', args }) }
}
const chamada = (tool: string, extra: Record<string, unknown> = {}) =>
  ({ tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...extra }) as any
const montar = ($: any, calls: any[], extra: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'gabarito-mestre', surface: 'terminal', component: 'ToolGroup', requestId: 'g', props: { calls, isActive: false, isExpanded: false, ...extra } })
const textos = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
const desenha = async ($: any, calls: any[], extra: Record<string, unknown> = {}) => {
  const ui = await montar($, calls, extra)
  const t = await textos(ui)
  await ui.unmount()
  return t
}

test('dois-bash-executou-2-comandos: o grupo vira 1 linha, sem o motor', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Bash'), chamada('Bash')])).toEqual(['executou 2 comandos'])
})
test('tres-read-um-bash-por-virgula: ordem leitura, shell, com plural e singular', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Bash'), chamada('Read'), chamada('Grep'), chamada('Glob')])).toEqual(['consultou 3 arquivos, executou 1 comando'])
})
test('solo-read-singular: grupo de 1 (S2b) também vira linha', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Read')])).toEqual(['consultou 1 arquivo'])
})
test('edicao-e-agent-chamou-papel: papel vem de subagent_type da entrada', async ($, on) => {
  mundo($, on)
  const ag = chamada('Agent', { input: { subagent_type: 'gabarito-revisor', prompt: 'segredo do prompt' } })
  const t = await desenha($, [chamada('Edit'), chamada('Write'), ag])
  expect(t).toEqual(['alterou 2 arquivos, chamou gabarito-revisor'])
  expect(t.join('|')).not.toContain('segredo')
})
test('agent-sem-subagent-type: chamou um agente', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Agent', { input: { subagent_type: 7 } })])).toEqual(['chamou um agente'])
  expect(await desenha($, [chamada('Agent', { input: null })])).toEqual(['chamou um agente'])
})
test('outra-ferramenta-next: WebFetch, MCP e nome fora da tabela passam ao motor', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('WebFetch')])).toEqual(['motor'])
  expect(await desenha($, [chamada('Read'), chamada('mcp__x__y')])).toEqual(['motor'])
  expect(await desenha($, [chamada('read')])).toEqual(['motor'])
  expect(await desenha($, [{ ...chamada('Read'), tool: 7 }])).toEqual(['motor'])
})
test('erro-next: chamada com erro ou interrompida passa ao motor, com o grupo todo', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Read'), chamada('Bash', { isErrored: true })])).toEqual(['motor'])
  expect(await desenha($, [chamada('Read', { isInterrupted: true })])).toEqual(['motor'])
})
test('expandido-next: ctrl+o / verbose mostra o motor mesmo com a linha possível', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Read'), chamada('Bash')], { isExpanded: true })).toEqual(['motor'])
  expect(await desenha($, [chamada('Read'), chamada('Bash')], { isExpanded: false })).toEqual(['consultou 1 arquivo, executou 1 comando'])
})
test('grupo-com-outras-linhas-next: isCallsOnly false (memória, tempo de hook) passa ao motor; ausente não bloqueia', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [chamada('Read')], { isCallsOnly: false })).toEqual(['motor'])
  expect(await desenha($, [chamada('Read')], { isCallsOnly: true })).toEqual(['consultou 1 arquivo'])
  expect(await desenha($, [chamada('Read')])).toEqual(['consultou 1 arquivo'])
})
test('calls-vazio-next: grupo sem chamadas ⇒ motor, sem lançar', async ($, on) => {
  mundo($, on)
  expect(await desenha($, [])).toEqual(['motor'])
})
test('linha-sem-esc-no-text: papel com ESC não chega ao Text com o ESC', async ($, on) => {
  mundo($, on)
  const ui = await montar($, [chamada('Agent', { input: { subagent_type: 'a\x1b[2Jb' } })])
  expect(JSON.stringify(await ui.drawn())).not.toContain('\\u001b')
  await ui.unmount()
})

test('chat-cru-next: com a preferência cru nada é trocado', async ($, on) => {
  mundo($, on, { prefs: { modo: 'cru' } })
  expect(await desenha($, [chamada('Read'), chamada('Bash')])).toEqual(['motor'])
})
test('chat-prefs-natural-explicita: modo natural troca a linha', async ($, on) => {
  mundo($, on, { prefs: { modo: 'natural' } })
  expect(await desenha($, [chamada('Bash')])).toEqual(['executou 1 comando'])
})
test('chat-prefs-ausente-x-corrompida: ausente ⇒ natural sem aviso; corrompida ⇒ cru com 1 aviso e não repete', async ($, on) => {
  const ausente = mundo($, on)
  expect(await desenha($, [chamada('Bash')])).toEqual(['executou 1 comando'])
  expect(ausente.logs).toEqual([])
  ausente.store.set(CHAVE, 'lixo-chat-prefs-1')
  expect(await desenha($, [chamada('Bash')])).toEqual(['motor'])
  expect(await desenha($, [chamada('Bash')])).toEqual(['motor'])
  expect(ausente.logs).toHaveLength(1)
  expect(ausente.logs[0]).toContain('chat')
  for (const torta of [{ modo: 'talvez' }, { natural: true }, { modo: 'natural', extra: 1 }, 42, ['cru']]) {
    ausente.store.set(CHAVE, torta)
    expect(await desenha($, [chamada('Bash')])).toEqual(['motor'])
  }
})
test('chat-store-falha-nao-vira-natural: store que nega ≠ ausente ⇒ cru', async ($, on) => {
  mundo($, on, { storeGetFalha: true })
  expect(await desenha($, [chamada('Bash')])).toEqual(['motor'])
})

test('comando-chat-cru-e-natural: grava a preferência, 1 linha, e o desenho muda no mesmo teste', async ($, on) => {
  const m = mundo($, on)
  const cru = await m.cmd('chat cru')
  expect(m.store.get(CHAVE)).toEqual({ modo: 'cru' })
  expect(cru.text).toBe('chat: linhas cruas, como o Claude Code desenha.')
  expect(await desenha($, [chamada('Read')])).toEqual(['motor'])
  const nat = await m.cmd('chat natural')
  expect(m.store.get(CHAVE)).toEqual({ modo: 'natural' })
  expect(nat.text).toBe('chat: linhas em linguagem natural.')
  expect(await desenha($, [chamada('Read')])).toEqual(['consultou 1 arquivo'])
  expect(m.sets).toEqual([{ modo: 'cru' }, { modo: 'natural' }])
  expect(cru.text).not.toContain('\n')
  expect(nat.text).not.toContain('\n')
})
test('comando-chat-caixa-e-espaco: CRU, " Natural " e múltiplos espaços valem', async ($, on) => {
  const m = mundo($, on)
  await m.cmd('chat   CRU ')
  expect(m.store.get(CHAVE)).toEqual({ modo: 'cru' })
  await m.cmd('  chat Natural')
  expect(m.store.get(CHAVE)).toEqual({ modo: 'natural' })
})
test('comando-chat-uso: sem argumento, desconhecido ou sobra ⇒ 1 linha de uso e nada gravado', async ($, on) => {
  const m = mundo($, on)
  for (const a of ['chat', 'chat x', 'chat cru natural', 'chat cru extra', 'chat ligado']) {
    const r = await m.cmd(a)
    expect(r.text).toBe('uso: /gabarito chat cru|natural')
  }
  expect(m.sets).toEqual([])
  expect(m.store.has(CHAVE)).toBe(false)
})
test('comando-chat-store-falha: não diz que mudou; nada gravado', async ($, on) => {
  const m = mundo($, on, { storeSetFalha: true })
  const r = await m.cmd('chat cru')
  expect(r.text).toBe('chat: não consegui gravar a preferência; nada mudou.')
  expect(m.store.has(CHAVE)).toBe(false)
})
test('comando-pausar-segue-intacto: o ramo chat não captura outras ações', async ($, on) => {
  const m = mundo($, on)
  const r = await m.cmd('chatx')
  expect(r.text).not.toContain('chat:')
  expect(m.sets).toEqual([])
})

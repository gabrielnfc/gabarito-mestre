/** Testes do mod de pouso (GM-10 T9, REQ-POU-1/2, REQ-OBS-1) por `claude plugin test`. Mutações: task-9-mut.json. */
import { expect, mock, test } from 'claude-code/testing'
import { pendenciasAprendizado } from '../../gates/dist/pendencias.js'
import { CABECALHO, codigoPonte, PROMPT_RECUPERACAO, PROMPT_RETOMADA } from '../../gates/dist/pouso.js'
import { validarStdinAgentes } from '../../gates/dist/painel-equipe.js'
import { arquivoSinalLoop, gravarSinalLoop, interpretarSinalLoop, sinalDoLoop } from '../gabarito.mjs'
import { botoesComNomes, chavePouso, colunasDosBotoes, faixaDe, faixaUmaLinha, avisoPaneEspera, botoesDoTopo, gravarContexto, indiceDoTopo, LIMITE_DESATUALIZADO_S } from '../painel.mjs'
import { lerLeitura, pousoPendente, tentativasDoPouso } from '../../gates/dist/pouso-pendente.js'
import { proximaAcao } from '../../gates/dist/loop.js'
import { pousoDaFronteira } from '../../gates/dist/pouso.js'

const RAIZ = '/repo'
const DIR = '/repo/.harness/entregas/PBI-7'
const PRINCIPAL = '/main'

type Ev = { agente: string; tipo: string; dados: Record<string, unknown> }
type Opc = {
  /** GM-15 T39: o que a ponte de `origin/HEAD` devolve (`{fonte, cfg:{sombra}}`); `'falha'` = ponte que não responde; ausente = sem origin */
  origin?: Record<string, unknown> | 'falha'
  /** GM-14 T35: o que o motor devolve ao `tool.call` (objeto ou função do evento); padrão `{}` */
  resultadoTool?: Record<string, unknown> | ((e: any) => Record<string, unknown>)
  percent?: number | null
  x?: string
  interativo?: boolean
  surfaces?: string[]
  plano?: boolean
  agentes?: { id: string; status: string }[] | 'falha' | 'lixo'
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
  /** painel (T10): resposta do `painel.mjs estado --agentes`; ausente ⇒ o mock nega o argv (todo teste de pouso fica inerte) */
  painel?: PainelOpc
  panes?: { id: string; isPlaced: boolean; isShown: boolean }[] | 'falha'
  openResult?: { isPlaced: boolean; reason?: string }
  notify?: 'ok' | 'nao-enviou' | 'rejeita'
  fillIsFilled?: boolean
  rateLimits?: unknown
  agentesPainel?: unknown
  sessaoId?: string
  sessaoIdFalha?: boolean
  existsPacoteFalha?: boolean
  /** GM-14 T30: ponte `dir` sem entrega identificada (branch sem 2º fato ou com PR aceito), lida sem falha */
  identificada?: boolean
  /** GM-14 T30: ponte `dir` responde `ok:false` (não deu para ler) */
  dirFalha?: boolean
  /** GM-14 T30: ponte `dir` de antes da T30 (responde `ok` sem o flag `identificada`) */
  dirSemFlag?: boolean
  /** ponte `mensagem` (T10): resposta `ok:false` */
  mensagemFalha?: boolean
  /** ponte `mensagem` (T10): fica presa até `est.mensagemLibera` */
  mensagemPendente?: boolean
  /** ponte `instantaneo` (T10): devolve `avisos` */
  instantaneoAvisos?: string[]
  /** gravação de `sessao.retomada` (T10) falha */
  retomadaFalha?: boolean
  /** GM-14 T60: a ponte de onboarding (predicado único da guarda) responde que o repo NÃO tem onboarding */
  semOnboarding?: boolean
  /** GM-14 T60: a ponte de onboarding falha (nega, ou sai ≠ 0) */
  onboardingFalha?: boolean
  /** GM-14 T20: `painel.local` que `onboarding.mjs painel` devolve; 'falha' ⇒ a ponte nega; 'corrompido' ⇒ `ok:true` sem `atual` */
  local?: 'lateral' | 'acima' | 'falha' | 'corrompido' | 'ausente'
  /** GM-14 T20: `onboarding.mjs painel --local` responde `ok:false` */
  gravarLocalFalha?: boolean
  /** GM-14 T20: tokens do último `message.usage` do transcript da sessão (plano B do contexto); 'falha' ⇒ a ponte nega */
  planoB?: number | 'falha'
  /** GM-14 T20 (review r1): `usage.context.window`; ausente ⇒ 1.000.000; null ⇒ o motor não deu a janela */
  janela?: number | null
  /** GM-14 T20: pacote lido pela ponte de nomes (`lider`, `sabio`, `nomes`); ausente ⇒ terra-media reduzido */
  pacoteNomes?: { lider: string; sabio: string; nomes: string[] } | 'falha'
  /** GM-15 T22: pacotes de `.harness/temas/nomes/*.json` do repo que a ponte de listagem devolve; 'falha' ⇒ a ponte nega */
  pacotesRepo?: string[] | 'falha'
  /** GM-14 T53: o /clear roda mas não limpa nada (o incidente de 2026-11-14): mesma sessão, mesmo percent */
  clearNaoLimpa?: boolean
  /** GM-14 T53 (r1): instante inicial do relógio do mock (ms). O mod mede com `$.clock.now()`; o relógio avança 1 s por evento gravado e por leitura de uso. Painel: relógio intocado (0) salvo se dado. */
  agora?: number
  /** GM-14 T53: percent da sessão nova depois do /clear (padrão 5) */
  percentPosClear?: number | null
}
type PainelOpc = {
  modo?: 'ok' | 'sem_loop' | 'erro' | 'torto' | 'trunca' | 'rejeita' | 'timeout' | 'pendente'
  estado?: any
  avisos?: string[]
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


/**
 * REQ-APR-2 muda a ordem: pendência de aprendizado aberta (MAJOR, `loop.parar`, tudo integrado) vence pouso e despacho no núcleo.
 * Os testes de antes da E5a, que provam as outras cláusulas, fecham o que a máquina abriu: só os pares que `pendenciasAprendizado`
 * do `dist/` devolve, em `aprendizado.nada` na sessão `aprendiz`. (Cópia do `fecharPendencias` de gates/test/_adaptador-helpers.mjs:
 * o runner do mod só importa arquivos relativos sem `node:*`.)
 */
const fecharPendencias = (plano: any, eventos: any[]) => {
  const abertas = pendenciasAprendizado(plano, eventos)
  const ts = new Date(eventos.reduce((m, e) => Math.max(m, Date.parse(e.ts) || 0), 0)).toISOString()
  let seq = eventos.filter((e) => e.sessao === 'aprendiz').reduce((m, e) => Math.max(m, e.seq), 0)
  return abertas.map((p) => ({ seq: ++seq, ts, autor: 'teste', sessao: 'aprendiz', agente: 'orquestrador', tipo: 'aprendizado.nada', dados: { gatilho: { sessao: p.sessao, seq: p.seq }, motivo: `teste: fecha ${p.tipo}` }, hash_anterior: null }))
}

/** Fecha, no diário em memória do `mundo`, o que está aberto no plano dado (o do teste, ou o padrão). */
const fecharEm = (m: { evs: any[] }, plano: any = PLANO) => { m.evs.push(...fecharPendencias(plano, m.evs)) }

// O mundo debaixo do mod: tudo em memória, com um log único de chamadas na ordem em que acontecem.
function mundo($: any, on: any, o: Opc = {}) {
  const log: string[] = []
  const grav: Ev[] = []
  const toasts: string[] = []
  const escritas = new Map<string, string>()
  const pedidos: any[] = []
  const evs: any[] = [...(o.eventos ?? FRONT)]
  let relogio = 0
  const store = new Map<string, unknown>(Object.entries(o.storeInicial ?? {}))
  const arquivos = new Set<string>(o.arquivos ?? [])
  const est = {
    dir: DIR, plano: o.plano !== false, percent: o.percent === undefined ? 60 : o.percent, clears: 0, submits: [] as string[], liberar: null as null | (() => void),
    // painel (T10)
    painel: { ...(o.painel ?? {}) } as PainelOpc, painelStdins: [] as any[], painelArgv: [] as string[][], painelInit: [] as any[], painelFlight: 0, painelLibera: [] as (() => void)[],
    surfaces: (o.surfaces ?? []) as string[], opens: [] as any[], panes: (o.panes ?? []) as any, openResult: (o.openResult ?? { isPlaced: true }) as any, notifies: [] as string[], fills: [] as any[], statuses: [] as (string | undefined)[],
    origens: [] as any[], subStarts: [] as any[], logs: [] as string[], closes: [] as any[], registros: [] as any[], sessaoId: o.sessaoId ?? 'sess-1', ordem: [] as string[], notifyModo: (o.notify ?? 'ok') as string, rateLimits: (o.rateLimits === undefined ? [] : o.rateLimits) as any, fillIsFilled: o.fillIsFilled !== false,
    agoraMs: null as number | null,
    semOnboarding: o.semOnboarding === true, // GM-15 T23: mutável, o config pode sumir com a sessão aberta
    msgs: [] as { sha256: string; chars: number }[], mensagemLibera: [] as (() => void)[],
    // GM-14 T20: local, medir, contexto, plano B e pacote (cada ponte guarda o que recebeu)
    local: (o.local ?? 'lateral') as string, locaisGravados: [] as string[], medirStdins: [] as any[], contextos: [] as any[], contextoInit: [] as any[], planosB: [] as any[], pacotesLidos: [] as any[], listagens: [] as any[], onboardings: [] as any[], sinaisLoop: [] as any[],
  }

  // o diário em memória: tudo que o mod grava volta na próxima leitura, com seq e ts válidos para a T2
  /** anda o relógio do mock (e o conta em `est.agoraMs`); só com relógio controlado */
  const bump = (ms: number) => { est.agoraMs = (est.agoraMs ?? 0) + ms }
  const seqs = new Map<string, number>()
  for (const e of evs) seqs.set(e.sessao, Math.max(seqs.get(e.sessao) ?? 0, e.seq))
  const add = (agente: string, tipo: string, dados: Record<string, unknown>, sessao = 's0') => {
    const seq = (seqs.get(sessao) ?? 0) + 1
    seqs.set(sessao, seq)
    relogio += 1
    const ultimoTs = evs.reduce((m, e) => Math.max(m, Date.parse(e.ts)), 0) // monotônico: depois de um evento com ts adiantado, o seguinte não volta no tempo
    // com relógio controlado (T53) o evento nasce na hora do mock, 1 s depois da anterior: o tempo anda sozinho a cada gravação
    let ts = Math.max(Date.UTC(2026, 10, 3, 1, 0, relogio), ultimoTs + 1000)
    if (est.agoraMs !== null) { bump(Math.max(est.agoraMs + 1000, ultimoTs + 1000) - est.agoraMs); ts = est.agoraMs }
    evs.push({ seq, ts: new Date(ts).toISOString(), autor: 'a', sessao, agente, tipo, dados, hash_anterior: null })
  }

  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.attach', (_: any, e: any) => ({ clientId: e.clientId }))
  on('session.id', () => (o.sessaoIdFalha ? { deny: 'sem id' } : { value: est.sessaoId }))
  on('session.root', () => ({ value: RAIZ }))
  on('session.repo', () => ({ value: { root: PRINCIPAL, remote: null, internal: false } }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'GABARITO_POUSO_X' ? o.x : undefined }))
  on('session.usage', () => {
    if (o.usageFalha) return { deny: 'usage fora do ar' }
    if (est.agoraMs !== null) bump(1000) // uma leitura de uso é um instante depois do anterior
    return { value: { startedAt: 0, context: { window: o.janela === undefined ? 1_000_000 : o.janela, percent: est.percent ?? undefined, tokens: 1 }, rateLimits: est.rateLimits } }
  })
  on('agent.list', () => (o.agentesPainel !== undefined ? { value: o.agentesPainel } : o.agentes === 'falha' ? { deny: 'sem sessão' } : o.agentes === 'lixo' ? { value: 'não é lista' } : { value: o.agentes ?? [] }))
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); log.push('toast'); est.ordem.push('toast'); return { value: undefined } })
  on('ui.status', (_: any, e: any) => { est.statuses.push(e.text); return { value: undefined } })
  on('ui.open', (_: any, e: any) => {
    est.opens.push(e); est.ordem.push('open')
    // GM-14 T50 (spike): a plataforma lista a Pane que não colocou (`isPlaced:false`) até o dono pedir ou alargar o terminal
    if (est.openResult?.isPlaced === false && Array.isArray(est.panes) && !est.panes.some((x: any) => x.id === e.id)) est.panes = [...est.panes, { id: e.id, isPlaced: false, isShown: false }]
    return { value: est.openResult }
  })
  on('session.surfaces', () => ({ value: est.surfaces }))
  on('ui.panes', () => (est.panesLidas = (est.panesLidas ?? 0) + 1, est.panes === 'falha' ? { deny: 'sem panes' } : { value: est.panes }))
  on('ui.notify', (_: any, e: any) => {
    est.ordem.push('notify'); est.notifies.push(e.text)
    if (est.notifyModo === 'rejeita') return { deny: 'canal fora do ar' }
    return { value: est.notifyModo === 'nao-enviou' ? { isSent: false, reason: 'no-channel' } : { isSent: true, channel: 'iterm2' } }
  })
  on('prompt.fill', (_: any, e: any) => { est.fills.push(e); return { isFilled: est.fillIsFilled, text: est.fillIsFilled ? e.text : '' } })
  on('ui.log', (_: any, e: any) => { est.logs.push(e.text); return { value: undefined } })
  on('ui.close', (_: any, e: any) => { est.closes.push(e.id); return { value: undefined } })
  on('classic.SubagentStart', (_: any, e: any) => { est.subStarts.push(e); return {} })
  on('classic.SubagentStop', () => ({}))
  on('classic.Stop', () => ({}))
  on('command.register', (_: any, e: any) => { log.push(`register:${e.name}`); est.registros.push(e); return { value: { command: e.name } } })
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => {
    log.push(`store.set:${e.key}:${(e.value as any)?.estado ?? ''}`)
    if (e.key.startsWith('painel:')) est.ordem.push(`store.set:${e.key}`)
    if (o.storeSetFalha) return { deny: 'store fora do ar' }
    if (o.storeGravaOutro) store.set(e.key, { estado: 'ocioso' })
    else if (!o.storeNaoGrava) store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_: any, e: any) => { log.push(`store.delete:${e.key}`); store.delete(e.key); return { value: undefined } })
  on('state.set', () => { log.push('state.set'); return { value: { isSet: true, version: 1 } } })
  on('fs.exists', (_: any, e: any) => (o.existsPlanoFalha && e.path.endsWith('plano.json') ? { deny: 'fs fora do ar' } : o.existsPacoteFalha && e.path.includes('/temas/nomes/') ? { deny: 'fs fora do ar' } : o.existsFalha && e.path.endsWith('PAUSAR') ? { deny: 'fs fora do ar' } : { value: arquivos.has(e.path) || (e.path === `${est.dir}/plano.json` && est.plano) }))
  on('fs.write', (_: any, e: any) => {
    if (o.writeFalha) return { deny: 'disco cheio' }
    if (!o.escritaNaoAparece) arquivos.add(e.path)
    escritas.set(e.path, e.text)
    log.push(`fs.write:${e.path}`)
    return { value: undefined }
  })
  on('process.run', async (_: any, e: any) => {
    const argv: string[] = e.argv
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const cru0 = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    // GM-14 T20: `onboarding.mjs painel [--local x]` (lê e grava `painel.local`)
    if (argv[0] === 'node' && String(argv[1]).endsWith('/gates/scripts/onboarding.mjs') && argv[2] === 'painel') {
      const i = argv.indexOf('--local')
      if (i >= 0) {
        if (o.gravarLocalFalha) return cru0(`${JSON.stringify({ ok: false, erro: 'config_corrompido', motivo: 'harness.config.json não é um JSON de objeto válido' })}\n`, 1)
        est.locaisGravados.push(argv[i + 1]); est.local = argv[i + 1]
        return cru0(`${JSON.stringify({ ok: true, local: argv[i + 1], mudou: true })}\n`)
      }
      if (est.local === 'falha') return { deny: 'node não iniciou' }
      if (est.local === 'ausente') return cru0(`${JSON.stringify({ ok: true, oferecer: true, default: 'lateral' })}\n`)
      if (est.local === 'corrompido') return cru0(`${JSON.stringify({ ok: true, oferecer: false, motivo: 'config_corrompido', default: 'lateral' })}\n`)
      return cru0(`${JSON.stringify({ ok: true, oferecer: false, motivo: 'ja_gravado', atual: est.local, default: 'lateral' })}\n`)
    }
    // GM-14 T20: `painel.mjs medir --agentes` (só registra o stdin; o diário não muda aqui)
    if (o.painel !== undefined && argv[0] === 'node' && String(argv[1]).endsWith('/gates/scripts/painel.mjs') && argv[2] === 'medir') {
      est.medirStdins.push({ argv, stdin: JSON.parse(e.init?.stdin ?? 'null'), cwd: e.init?.cwd })
      return cru0(`${JSON.stringify({ ok: true, gravados: [], falhas: [] })}\n`)
    }
    // GM-14 T20: pontes `node -e` do painel (contexto, plano B e pacote), reconhecidas pela marca no início do script
    if (argv[0] === 'node' && argv[1] === '-e' && String(argv[2]).startsWith('/*gabarito:')) {
      const q = JSON.parse(e.init?.stdin ?? 'null')
      if (String(argv[2]).startsWith('/*gabarito:onboarding*/')) {
        est.onboardings.push({ q, init: e.init })
        if (o.onboardingFalha) return { deny: 'node não iniciou' }
        return cru0(`${JSON.stringify({ ok: true, onboarding: !est.semOnboarding })}\n`)
      }
      if (String(argv[2]).startsWith('/*gabarito:origem*/')) {
        est.origens.push(q)
        if (o.origin === 'falha') return { deny: 'node não iniciou' }
        return cru0(`${JSON.stringify({ ok: true, origin: o.origin ?? { fonte: 'nenhuma', cfg: null } })}\n`)
      }
      if (String(argv[2]).startsWith('/*gabarito:loop*/')) { est.sinaisLoop.push({ q, init: e.init }); return cru0('') }
      if (String(argv[2]).startsWith('/*gabarito:contexto*/')) { est.contextos.push(q); est.contextoInit.push(e.init); return cru0('') }
      if (String(argv[2]).startsWith('/*gabarito:planob*/')) {
        est.planosB.push(q)
        if (o.planoB === undefined || o.planoB === 'falha') return { deny: 'sem transcript' }
        return cru0(`${JSON.stringify({ ok: true, tokens: o.planoB })}\n`)
      }
      if (String(argv[2]).startsWith('/*gabarito:listar*/')) {
        est.listagens.push(q)
        if (o.pacotesRepo === 'falha') return { deny: 'node não iniciou' }
        return cru0(`${JSON.stringify({ ok: true, nomes: o.pacotesRepo ?? [] })}\n`)
      }
      if (String(argv[2]).startsWith('/*gabarito:pacote*/')) {
        est.pacotesLidos.push(q)
        if (o.pacoteNomes === 'falha') return cru0(`${JSON.stringify({ ok: false })}\n`, 1)
        return cru0(`${JSON.stringify({ ok: true, pacote: o.pacoteNomes ?? { lider: 'GANDALF', sabio: 'ELROND', nomes: ['GIMLI', 'LEGOLAS', 'ARAGORN'] } })}\n`)
      }
    }
    if (o.painel !== undefined && argv[0] === 'node' && String(argv[1]).endsWith('/gates/scripts/painel.mjs')) {
      est.painelArgv.push(argv); est.painelInit.push(e.init); est.painelStdins.push(JSON.parse(e.init?.stdin ?? 'null')); est.painelFlight += 1
      try {
        const p = est.painel
        if (p.modo === 'pendente') await new Promise<void>((r) => { est.painelLibera.push(r) })
        const linha = (v: unknown) => `${JSON.stringify(v)}\n`
        const cru = (stdout: string, exitCode = 0, trunc = false) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: trunc, isStderrTruncated: false } })
        if (p.modo === 'rejeita') return { deny: 'node não iniciou' }
        if (p.modo === 'timeout') { await clock.sleep(5000); return { deny: 'timeout' } }
        if (p.modo === 'torto') return cru('isto não é json')
        if (p.modo === 'trunca') return cru(linha({ ok: true, estado: p.estado, avisos: [] }).slice(0, -3), 0, true)
        if (p.modo === 'sem_loop') return cru(linha({ ok: false, erro: 'plano_ausente', mensagem: 'sem plano' }), 1)
        if (p.modo === 'erro') return cru(linha({ ok: false, erro: 'diario_em_escrita', mensagem: 'o diário mudou' }), 1)
        return cru(linha({ ok: true, estado: p.estado ?? estadoPainel(), avisos: p.avisos ?? [] }))
      } finally { est.painelFlight -= 1 }
    }
    if (argv[0] === 'node' && argv.includes('--input-type=module')) {
      const q = JSON.parse(e.init?.stdin ?? '{}')
      pedidos.push(q)
      if (o.ponteSai1) return { value: { exitCode: 1, stdout: JSON.stringify({ ok: true, raiz: RAIZ, dir: DIR, plano: true, eventos: FRONT, texto: 'x' }), stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
      if (q.op === 'dir') {
        if (o.dirFalha) return ok(JSON.stringify({ ok: false, erro: 'git falhou' }))
        if (o.dirSemFlag) return ok(JSON.stringify({ ok: true, raiz: RAIZ, dir: est.dir, plano: est.plano }))
        // a ponte real não devolve `dir` sem entrega; se devolvesse, o mod não o usa (a identificação é do flag)
        if (o.identificada === false) return ok(JSON.stringify({ ok: true, raiz: RAIZ, identificada: false, entrega: null, dir: est.dir, plano: true }))
        return ok(JSON.stringify({ ok: true, raiz: RAIZ, identificada: true, entrega: 'PBI-7', dir: est.dir, plano: est.plano }))
      }
      if (q.op === 'plano') {
        if (o.plano_json === 'falha') return ok(JSON.stringify({ ok: false, erro: 'plano.json inválido: x' }))
        const cfg = o.config ?? {}
        return ok(JSON.stringify({ ok: true, plano: o.plano_json ?? PLANO, slots: cfg.slots ?? 3, tetoTokens: cfg.tetoTokens ?? null }))
      }
      if (q.op === 'ler') return ok(JSON.stringify(o.lerFalha ? { ok: false, erro: o.lerErro ?? 'x' } : { ok: true, eventos: evs, ...(est.agoraMs !== null ? { agora: est.agoraMs } : {}) }))
      if (q.op === 'instantaneo') {
        log.push('instantaneo')
        const t = o.instantaneo ?? 'Diário: 3 evento(s)\nETA: sem dados'
        return ok(JSON.stringify(t === 'falha' ? { ok: false, erro: 'x' } : { ok: true, texto: t, ...(o.instantaneoAvisos ? { avisos: o.instantaneoAvisos } : {}) }))
      }
      if (q.op === 'mensagem') {
        log.push('mensagem')
        if (o.mensagemPendente) await new Promise<void>((r) => { est.mensagemLibera.push(r) })
        if (o.mensagemFalha) return ok(JSON.stringify({ ok: false, erro: 'mensagem não gravada' }))
        // o hash real é da ponte (testada em gates/test/pouso.test.ts); o mock guarda só o que o diário guardaria: hash e tamanho
        const dados = { sha256: 'f'.repeat(64), chars: q.texto.length }
        est.msgs.push(dados)
        add('dono', 'dono.mensagem', dados, 'dono')
        return ok(JSON.stringify({ ok: true }))
      }
      if (q.op === 'append') {
        log.push(`append:${q.ev.tipo}`)
        if (o.appendFalha?.includes(q.ev.tipo) || (o.retomadaFalha && q.ev.tipo === 'sessao.retomada')) return ok(JSON.stringify({ ok: false, erro: 'x' }))
        grav.push({ agente: q.ev.agente, tipo: q.ev.tipo, dados: q.ev.dados })
        add(q.ev.agente, q.ev.tipo, q.ev.dados, typeof q.sessao === 'string' ? q.sessao : 'sess-1')
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
    if (o.clearNaoLimpa) return { text: '' } // T53: o comando volta ok e nada muda
    est.percent = o.percentPosClear === undefined ? 5 : o.percentPosClear
    est.sessaoId = `${est.sessaoId}-n` // /clear gera session_id novo (FIEL-14 e)
    return { text: '' }
  })
  on('prompt.submit', async (_: any, e: any) => {
    if (e.origin?.kind === 'peer') { log.push('peer'); return { text: e.text } } // hand-back de subagent: não é um turno aberto pelo mod
    log.push('submit'); est.submits.push(e.text)
    if (o.submitFalha) return { drop: 'recusado' }
    if (o.submitPendente) await new Promise<void>((r) => { est.liberar = r })
    return { text: e.text }
  })
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('tool.call', (_: any, e: any) => ({ result: typeof o.resultadoTool === 'function' ? o.resultadoTool(e) : (o.resultadoTool ?? {}) }))

  const clockReal = mock.clock(on)
  // o relógio exposto aos testes conta o que avança (o `ts` dos eventos gravados segue o mesmo relógio)
  const clock = {
    advance: async (ms: number) => { if (est.agoraMs !== null) est.agoraMs += ms; return clockReal.advance(ms) },
    set: (ms: number) => { if (est.agoraMs !== null) est.agoraMs = ms; else return clockReal.set(ms) },
    settle: () => clockReal.settle(), sleep: (ms: number) => clockReal.sleep(ms), now: () => clockReal.now(),
  } as typeof clockReal
  est.agoraMs = o.painel !== undefined && o.agora === undefined ? null : (o.agora ?? Date.UTC(2026, 10, 3, 2, 0, 0))
  // a ponte `ler` devolve `agora: est.agoraMs` (que anda com `advance`/`set` e a cada gravação); os timers seguem o relógio do mock
  const peer = () => $.prompt.submit({ text: '<agent-message>[Subagent hand-back]', origin: { kind: 'peer' } })
  const turno = (extra: Record<string, unknown> = {}) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra })
  const agent = (subagent_type?: string) => $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type })
  const inicio = (interativo = o.interativo ?? true) => $.session.start({ cwd: RAIZ, surface: interativo ? 'terminal' : null, isInteractive: interativo })
  const cmd = (args: string) => $.command.run({ command: 'gabarito', args })
  const tipos = () => grav.map((g) => g.tipo)
  /** mensagem digitada pelo dono: o composer real manda `command: null` (S1) */
  const dono = (extra: Record<string, unknown> = {}) => $.prompt.submit({ text: 'mensagem do dono', origin: { kind: 'composer' }, command: null, isMeta: false, ...extra })
  /** relógio do mock em ms absolutos / avança e dispara os timers (vigia de 30 s) */
  const relogio_ = (ms: number) => { clock.set(ms) }
  const avancar = async (ms: number) => { await clock.advance(ms); await clock.settle() }
  return { relogio: relogio_, avancar, log, grav, toasts, escritas, pedidos, store, arquivos, est, clock, turno, peer, agent, inicio, cmd, tipos, evs, add, dono }
}

const pousar = async (m: ReturnType<typeof mundo>) => { await m.inicio(); await m.turno(); await m.clock.settle() }
/** GM-14 T53: um turno na sessão nova (o /clear do mock deixa o percent em 5): a medição confirma o pouso e o despacho se libera */
const confirmar = async (m: ReturnType<typeof mundo>) => { await m.turno(); await m.clock.settle() }

// ---- pouso: ordem dos passos (E23) ----
test('pousa-na-ordem: store antes do clear, evento e instantâneo antes, retomada por último', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  const ordem = m.log.filter((l) => /^(store\.set:pouso|append|instantaneo|clear|submit|store\.delete)/.test(l))
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
  await confirmar(m)
  expect(m.store.has(CHAVE)).toBe(false)
  m.est.percent = 55
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('x-baixo-um-pouso-por-veredito: X=1, percent definido em todo turno, um veredito ⇒ um pouso (S1)', async ($, on) => {
  const m = mundo($, on, { x: '1', percent: 5 })
  await m.inicio()
  for (let i = 0; i < 5; i++) { m.est.percent = i === 0 ? 5 : 0; await m.turno(); await m.clock.settle() } // T53: a sessão nova mede 0 < X e confirma
  expect(m.est.clears).toBe(1)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(m.tipos().filter((t) => t === 'sessao.retomada')).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
})
test('x-baixo-um-pouso-por-veredito: veredito novo abre uma segunda fronteira, e só uma', async ($, on) => {
  const m = mundo($, on, { x: '1', percent: 5 })
  await m.inicio()
  await m.turno(); await m.clock.settle()
  m.est.percent = 0; await confirmar(m) // T53: confirma o 1º pouso (X=1)
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  m.add('o', 'task.concluida', { task: 'b', sha: 'y' })
  m.add('o', 'review.veredito', { task: 'b', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 })
  for (let i = 0; i < 4; i++) { m.est.percent = i === 0 ? 5 : 0; await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(2)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(2)
})
test('sem-veredito-novo-nao-pousa: task nova em curso ou concluída depois do pouso não é fronteira', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  await confirmar(m)
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  m.est.percent = 60; await m.turno(); await m.clock.settle()
  m.add('o', 'task.concluida', { task: 'b', sha: 'y' })
  m.est.percent = 60; await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('despacho-so-abaixo-de-x-apos-pouso: depois do pouso a sessão despacha com a PRÓPRIA leitura abaixo de X e nega em X ou acima (I1, ciclo 3: nada de consumir a fronteira)', async ($, on) => {
  const m = mundo($, on)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/) // antes: fronteira nova, POUSAVEL
  await pousar(m)
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined() // a sessão nova mede 5 %
  m.est.percent = 60
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  expect((await m.agent(undefined)).deny).toMatch(/pouso/)
  m.add('o', 'task.iniciada', { task: 'b', papel: 'implementador' })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  m.est.percent = 5
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
test('veredito-novo-volta-a-travar: com agente vivo, em X ou acima e fronteira nova (outro veredito) a negação é a do núcleo (esperar)', async ($, on) => {
  const m = mundo($, on, { agentes: [{ id: 'a1', status: 'running' }] })
  m.add('o', 'sessao.pouso', { percent: 60, x: 50 })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/) // o pouso desta fronteira já foi feito e a sessão segue em 60 %
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
// T25 (spec r12): task em voo sem agente agora é recuperada pelo mod; o (5b) segue valendo quando um hand-back está a caminho e nunca chega
// (`turn.complete` de subagent sem o `prompt.submit` peer): é esse o estado que os testes abaixo fixam.
const aCaminho = (m: { turno: (x?: Record<string, unknown>) => Promise<unknown> }) => m.turno({ agentId: 'ag-a-caminho' })
test('em-voo-sem-agente-para-nao-conseguiu: três turnos sem evento novo viram loop.parar nao_conseguiu com aviso visível, sem pouso', async ($, on) => {
  const m = mundo($, on, { eventos: EM_VOO })
  await m.inicio()
  await aCaminho(m)
  await m.turno(); await m.turno()
  expect(parou(m)).toHaveLength(0)
  await m.turno(); await m.clock.settle()
  expect(parou(m)).toHaveLength(1)
  fecharEm(m) // REQ-APR-2 muda a ordem: o `loop.parar` do mod abre pendência `parar`
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/nao_conseguiu/) // r8: Agent negado conta como negação; só depois do parar, para não reabrir a task em voo
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
  await aCaminho(m)
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
  await aCaminho(m)
  for (let i = 0; i < 3; i++) await m.turno({ usage: USO })
  expect(m.tipos().filter((t) => t === 'custo.medicao')).toHaveLength(3)
  expect(parou(m)).toHaveLength(1)
})
test('em-voo-contagem-recomeca-se-o-agente-reaparece: turno com agente vivo zera os turnos sem agente', async ($, on) => {
  const o: Opc = { eventos: EM_VOO }
  const m = mundo($, on, o)
  await m.inicio()
  await aCaminho(m)
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
test('em-x-nao-repousa-dentro-de-60s: depois do pouso, com a sessão de novo em X, nenhum turno repete antes dos 60 s e o Agent segue negado (I1, I3)', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.est.clears).toBe(1)
  for (let i = 0; i < 4; i++) { m.est.percent = 70; await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(1)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
  m.est.percent = 70
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
})
const UM = { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }
const CASOS_AGENT: [string, Opc, 'nega' | 'passa'][] = [
  ['X cruzado com trabalho a fazer (K)', {}, 'nega'],
  ['abaixo de X', { percent: 49 }, 'passa'],
  ['tudo integrado (L: concluir, a (5) não dispara)', { plano_json: UM, eventos: [...FRONT, INT_A] }, 'passa'],
  ['pouso sem confirmação (T53): sessao.pouso sozinho não consome', { eventos: [...FRONT, { ...EV(4, 'sessao.pouso', { percent: 60, x: 50 }), sessao: 'sess-1' }] }, 'nega'],
  ['só resta o teto (M: parar)', { plano_json: UM, eventos: NO_TETO }, 'nega'],
  ['task concluída à espera do revisor (H)', { eventos: A_REVISAR }, 'nega'],
  ['agente vivo (I)', { agentes: [{ id: 'a1', status: 'running' }] }, 'nega'],
  ['task em voo sem agente (J)', { eventos: EM_VOO }, 'nega'],
]
for (const [nome, opc, esperado] of CASOS_AGENT) {
  test(`agent-nega-so-se-5-dispara: ${nome} ⇒ ${esperado}`, async ($, on) => {
    const m = mundo($, on, opc)
    fecharEm(m, opc.plano_json) // REQ-APR-2 muda a ordem: tudo integrado e MAJOR abrem pendência antes da (5)
    const r = await m.agent('gabarito-implementador')
    if (esperado === 'nega') expect(r.deny).toMatch(/pouso/)
    else expect(r.deny).toBeUndefined()
    // o revisor nunca é negado, salvo com o pouso desta fronteira sem confirmação (T53: aí todo Agent é negado)
    if (nome.includes('T53')) expect((await m.agent('gabarito-revisor')).deny).toMatch(/aguardando/)
    else expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
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
  fecharEm(m, { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }) // REQ-APR-2 muda a ordem: o MAJOR do teto abre pendência antes do `parar`
  await m.inicio()
  for (let i = 0; i < 4; i++) { await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(0)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'teto_rodadas', task: 'a' })
  expect(m.toasts.some((t) => t.includes('teto_rodadas'))).toBe(true)
})
// GM-15 T39 (MAJOR-1 do review final, REQ-AUT-1, emendas 22 e 24): o teto que a Sombra decide não vira `loop.parar` do mod
const SO_A = { entrega: 'PBI-7', tasks: [PLANO.tasks[0]] }
const LIBERA = { fonte: 'origin', cfg: { sombra: { libera_teto: true } } }
const cicloSombra = (n: number, hash: string, abordagem: string) => [
  EV(n, 'task.reaberta', { task: 'a', origem: 'sombra', hash, abordagem_nova: abordagem }),
  EV(n + 1, 'task.iniciada', { task: 'a', papel: 'implementador' }), EV(n + 2, 'task.concluida', { task: 'a', sha: 'x' }),
  EV(n + 3, 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }),
  EV(n + 4, 'task.iniciada', { task: 'a', papel: 'correcao' }), EV(n + 5, 'task.concluida', { task: 'a', sha: 'y' }),
  EV(n + 6, 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 2, major: 1, blocker: 0 }),
]
const turnosNoTeto = async (m: ReturnType<typeof mundo>) => {
  fecharEm(m, SO_A)
  await m.inicio()
  for (let i = 0; i < 4; i++) { await m.turno(); await m.clock.settle() }
}
test('t39-mod-sombra-decide-teto-nao-grava-parar: libera_teto em origin e sem freio ⇒ nenhum loop.parar, nenhum aviso de parada', async ($, on) => {
  const m = mundo($, on, { plano_json: SO_A, eventos: NO_TETO, origin: LIBERA })
  await turnosNoTeto(m)
  expect(parou(m)).toHaveLength(0)
  expect(m.toasts.some((t) => t.includes('loop parado'))).toBe(false)
  expect(m.est.origens.length).toBeGreaterThan(0)
})
test('t39-mod-freio-grava-parar: libera_teto ligado mas com 2 abordagens novas sem convergir ⇒ loop.parar do dono como antes', async ($, on) => {
  const m = mundo($, on, { plano_json: SO_A, eventos: [...NO_TETO, ...cicloSombra(7, 'a'.repeat(64), 'x'), ...cicloSombra(14, 'b'.repeat(64), 'y')], origin: LIBERA })
  await turnosNoTeto(m)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'teto_rodadas', task: 'a' })
})
const paraSemDecidir = (nome: string, origin: Record<string, unknown> | 'falha' | undefined) =>
  test(`t39-mod-grava-parar-${nome}: o dono decide (nunca por palpite) ⇒ loop.parar`, async ($, on) => {
    const m = mundo($, on, { plano_json: SO_A, eventos: NO_TETO, ...(origin === undefined ? {} : { origin }) })
    await turnosNoTeto(m)
    expect(parou(m)).toHaveLength(1)
  })
paraSemDecidir('sem-origin', undefined)
paraSemDecidir('flag-desligada', { fonte: 'origin', cfg: { sombra: { libera_teto: false } } })
paraSemDecidir('config-so-local', { fonte: 'local', cfg: { sombra: { libera_teto: true } } })
paraSemDecidir('ponte-falha', 'falha')
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
  fecharEm(m) // REQ-APR-2 muda a ordem: a falha do pouso gravou `loop.parar`, que abre pendência `parar`
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
test('submit-pos-clear-falha-sem-parar: submit que falha depois do /clear não é sem_pouso (REQ-POU-3): 0 loop.parar, 1 sessao.pouso, aviso exato, store limpo', async ($, on) => {
  const m = mundo($, on, { submitFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  expect(parou(m)).toHaveLength(0)
  expect(m.grav.filter((g) => g.tipo === 'sessao.pouso')).toHaveLength(1)
  expect(m.grav.some((g) => g.tipo === 'sessao.retomada')).toBe(false)
  expect(m.toasts).toContain('gabarito: retomada pelo contexto; o wakeup do /loop ou sua próxima mensagem reabre o turno')
  expect(m.toasts.some((t) => t.includes('sem_pouso'))).toBe(false)
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
    expect(r.text).toMatch(/^Uso: o painel abre sozinho ao lado, em terminal largo/)
    expect(r.text).toContain('/gabarito painel desligar   fecha e não abre sozinho; só o aviso de PAROU')
    expect(r.text.split('\n').length).toBeLessThanOrEqual(20)
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
  expect(g).toEqual([{ agente: 'subagent:ag1', tipo: 'custo.medicao', dados: { input_tokens: 100, output_tokens: 20, cache_read: 5, cache_creation: 7, modelo: 'm' } }])
  expect(JSON.stringify(m.pedidos)).not.toContain('SENTINELA-CRUA')
  expect(m.pedidos.find((p) => p.op === 'append')?.unicoPorAgente).toBe(true)
})
test('mod-custo-tem-modelo: custo.medicao traz modelo (valor ou null, a chave nunca falta), de subagent e de orquestrador', async ($, on) => {
  const m = mundo($, on, { percent: 5 })
  await m.inicio()
  await m.turno({ agentId: 'ag1', usage: { ...USO, model: 'claude-sonnet-5-5' } })
  await m.turno({ agentId: 'ag2', usage: { ...USO, model: undefined } })
  await m.turno({ agentId: 'ag3', usage: { ...USO, model: '<synthetic>' } })
  await m.turno({ agentId: 'ag4', usage: { ...USO, model: '' } })
  await m.turno({ usage: { ...USO, model: 'claude-opus-4-7' } })
  // o orquestrador tem o mesmo filtro: <synthetic>, vazio e ausente viram null
  await m.turno({ usage: { ...USO, model: '<synthetic>' } })
  await m.turno({ usage: { ...USO, model: '' } })
  await m.turno({ usage: { ...USO, model: undefined } })
  const g = m.grav.filter((x) => x.tipo === 'custo.medicao')
  expect(g.map((x) => [x.agente, x.dados.modelo])).toEqual([
    ['subagent:ag1', 'claude-sonnet-5-5'],
    ['subagent:ag2', null],
    ['subagent:ag3', null],
    ['subagent:ag4', null],
    ['orquestrador', 'claude-opus-4-7'],
    ['orquestrador', null],
    ['orquestrador', null],
    ['orquestrador', null],
  ])
  for (const x of g) expect('modelo' in x.dados).toBe(true)
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
    { agente: 'orquestrador', tipo: 'custo.medicao', dados: { input_tokens: 100, output_tokens: 20, cache_read: 5, cache_creation: 7, modelo: 'm' } },
    { agente: 'orquestrador', tipo: 'custo.medicao', dados: { input_tokens: 40, output_tokens: 20, cache_read: 5, cache_creation: 7, modelo: 'm' } },
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


// ---- T18: pouso pendente (REQ-LOOP-5): o mod nega Agent porque a ação é `pousar` e deixa o marcador para o hook Stop.
// A costura com o Stop real (arquivo gravado pelo mod, lido pelo hook) está em gates/test/stop-loop.test.mjs: este runner não importa node:*. ----
const MARCADOR = `${RAIZ}/.harness/pouso-pendente.json`
const ruido = (seq: number, tipo: string, dados: Record<string, unknown> = {}) => EV(seq, tipo, dados)
test('mod-grava-marcador-so-em-pousar: nega por pouso pendente e grava {entrega, linhas} antes do deny', async ($, on) => {
  // guarda.ask e custo.medicao não são progresso para o Stop: a contagem é a do contador (TIPOS_DE_PROGRESSO), não "todo evento"
  const m = mundo($, on, { eventos: [...FRONT, ruido(4, 'guarda.ask', { alvo: 'x' }), ruido(5, 'custo.medicao', { tokens: 1 })] })
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(/pouso pendente/)
  expect(JSON.parse(m.escritas.get(MARCADOR) ?? 'null')).toEqual({ entrega: 'PBI-7', linhas: 3 })
})
test('mod-grava-marcador-conta-task-integrada-e-reaberta: os 6 tipos de progresso contam, como no Stop', async ($, on) => {
  const m = mundo($, on, { eventos: [...FRONT, INT_A, ruido(5, 'task.reaberta', { task: 'b', origem: 'retomada' })] })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso pendente/)
  expect(JSON.parse(m.escritas.get(MARCADOR) ?? 'null').linhas).toBe(5)
})
test('mod-grava-marcador-conta-ci-resultado: ci.resultado é progresso, como no contador do Stop', async ($, on) => {
  const m = mundo($, on, { eventos: [...FRONT, ruido(4, 'ci.resultado', { verde: true })] })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso pendente/)
  expect(JSON.parse(m.escritas.get(MARCADOR) ?? 'null').linhas).toBe(4)
})
const outroDeny: [string, any, RegExp][] = [
  ['pausado', { arquivos: [`${PRINCIPAL}/.harness/PAUSAR`] }, /pausado/],
  ['revisao-pendente', { eventos: A_REVISAR }, /revisão pendente/],
  ['pousando', { storeInicial: { [CHAVE]: { estado: 'pousando' } } }, /POUSANDO/],
  ['sem-pouso', { interativo: false }, /SEM_POUSO/],
]
for (const [nome, opc, re] of outroDeny) {
  test(`mod-nao-grava-em-outro-deny-${nome}: nega sem deixar marcador`, async ($, on) => {
    const m = mundo($, on, opc)
    if (nome === 'sem-pouso') await m.inicio(false)
    expect((await m.agent('gabarito-implementador')).deny).toMatch(re)
    expect(m.escritas.has(MARCADOR)).toBe(false)
  })
}
test('mod-nao-grava-para-revisor: o revisor passa e não há marcador', async ($, on) => {
  const m = mundo($, on)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  expect(m.escritas.has(MARCADOR)).toBe(false)
})
test('mod-nao-grava-sem-deny: abaixo de X o Agent passa e não há marcador', async ($, on) => {
  const m = mundo($, on, { percent: 10 })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  expect(m.escritas.has(MARCADOR)).toBe(false)
})
test('mod-falha-ao-gravar-ainda-nega: disco cheio não libera o Agent', async ($, on) => {
  const m = mundo($, on, { writeFalha: true })
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(/pouso pendente/)
  expect(m.escritas.has(MARCADOR)).toBe(false)
})

// ---- T19 (D1, D7): Agent negado não deixa task.iniciada para trás; no fim do turno o mod reabre antes de decidir ----
const A_VER_REP = ['review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }] as [string, Record<string, unknown>]
const A_COR = ['task.iniciada', { task: 'a', papel: 'correcao' }] as [string, Record<string, unknown>]
const C_INI = ['task.iniciada', { task: 'c', papel: 'implementador' }] as [string, Record<string, unknown>]
const A_REV = ['task.iniciada', { task: 'a', papel: 'revisor' }] as [string, Record<string, unknown>]
const reabertas = (m: ReturnType<typeof mundo>) => m.grav.filter((g) => g.tipo === 'task.reaberta')
const ORQ_RETOMADA = { agente: 'orquestrador', tipo: 'task.reaberta', dados: { task: 'a', origem: 'retomada' } }

test('negado-reabre-e-pousa: Agent negado com a task iniciada ⇒ no fim do turno task.reaberta {retomada} ANTES do pouso, e o pouso acontece no mesmo turno', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI) })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  const ordem = m.log.filter((l) => /^(append:task\.reaberta|append:sessao\.pouso|clear|submit)$/.test(l))
  expect(ordem).toEqual(['append:task.reaberta', 'append:sessao.pouso', 'clear', 'submit'])
  expect(m.est.clears).toBe(1)
})
test('negado-corrigindo-volta-a-reprovada: a correção negada reabre a task reprovada e o pouso acontece', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI, A_CON, A_VER_REP, A_COR) })
  fecharEm(m) // REQ-APR-2 muda a ordem: o MAJOR do REPROVADO abre pendência antes do pouso
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.clears).toBe(1)
})
test('negado-em-revisao-nao-conta: o revisor passa, não é negação, e a task em revisão não é reaberta', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI, A_CON, A_REV) })
  await m.inicio()
  await aCaminho(m)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.clears).toBe(0)
})
const C_CON = ['task.concluida', { task: 'c', sha: 'x' }] as [string, Record<string, unknown>]
const C_REV = ['task.iniciada', { task: 'c', papel: 'revisor' }] as [string, Record<string, unknown>]
const VIVO = [{ id: 'ag1', status: 'running' }]
test('negado-com-vivo-nao-reabre-e-fica: 2 em voo, 1 vivo, 1 negação ⇒ nada reaberto, nenhum pouso; o vivo termina e o turno seguinte reabre a negada', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI, C_INI), plano_json: PLANO5, agentes: VIVO }
  const m = mundo($, on, o)
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.clears).toBe(0)
  o.agentes = []
  m.add('o', 'task.concluida', { task: 'a', sha: 'x' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'c', origem: 'retomada' }])
})
test('negados-maior-que-em-voo-limita: 3 negações, 1 em voo ⇒ uma só reaberta', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI) })
  await m.inicio()
  for (let i = 0; i < 3; i++) await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
})
test('sem-negado-nao-reabre: task em voo sem negação ⇒ (5b) como hoje, só loop.parar nao_conseguiu após 3 turnos', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI) })
  await m.inicio()
  await aCaminho(m)
  await m.turno(); await m.turno(); await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  expect(m.tipos()).toContain('loop.parar')
  expect(m.est.clears).toBe(0)
})
test('iniciar-depois-da-leitura: o deny leu o diário SEM a task em voo; o iniciar do lote entra depois; turn.complete resolve', async ($, on) => {
  const m = mundo($, on, { eventos: aposB() })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  expect(reabertas(m)).toHaveLength(0)
  m.add('o', 'task.iniciada', { task: 'a', papel: 'implementador' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.clears).toBe(1)
})
test('reaberta-nao-grava-avisa: task.reaberta que falha ⇒ aviso, sem pouso, e não insiste no turno seguinte (com um hand-back a caminho a recuperação do mod também fica quieta)', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI), appendFalha: ['task.reaberta'] })
  await m.inicio()
  await aCaminho(m)
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(m.toasts.some((t) => t.includes('task.reaberta'))).toBe(true)
  expect(m.est.clears).toBe(0)
  await m.turno(); await m.clock.settle()
  expect(m.log.filter((l) => l === 'append:task.reaberta')).toHaveLength(1)
})
const leituraFalha = (nome: string, quebra: (o: Opc) => void, conserta: (o: Opc) => void) =>
  test(`leitura-falha-mantem-${nome}: ilegível ⇒ nada reaberto, nunca pouso, e a negação FICA: o turno seguinte reabre`, async ($, on) => {
    const o: Opc = { eventos: aposB(A_INI) }
    const m = mundo($, on, o)
    await m.inicio()
    await m.agent('gabarito-implementador')
    quebra(o)
    await m.turno(); await m.clock.settle()
    expect(reabertas(m)).toHaveLength(0)
    expect(m.est.clears).toBe(0)
    conserta(o)
    await m.turno(); await m.clock.settle()
    expect(reabertas(m)).toEqual([ORQ_RETOMADA])
    expect(m.est.clears).toBe(1)
  })
leituraFalha('lista', (o) => { o.agentes = 'falha' }, (o) => { o.agentes = [] })
leituraFalha('diario', (o) => { o.lerFalha = true }, (o) => { o.lerFalha = false })
leituraFalha('plano', (o) => { o.plano_json = 'falha' }, (o) => { o.plano_json = undefined })
const naoDecide = (nome: string, extra: Record<string, unknown>) =>
  test(`${nome}-mantem: não decide e a negação fica para o próximo fim normal (E4)`, async ($, on) => {
    const m = mundo($, on, { eventos: aposB(A_INI) })
    await m.inicio()
    await m.agent('gabarito-implementador')
    await m.turno(extra); await m.clock.settle()
    expect(reabertas(m)).toHaveLength(0)
    expect(m.est.clears).toBe(0)
    await m.turno(); await m.clock.settle()
    expect(reabertas(m)).toEqual([ORQ_RETOMADA])
    expect(m.est.clears).toBe(1)
  })
naoDecide('abortado', { isAborted: true })
naoDecide('erro-api', { reason: 'error' })
test('lote-correcao-revisor (achado 1): correção negada + revisor aceito, revisor vivo ⇒ nada reaberto; com vivos 0 só a correção, antes do pouso', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI, A_CON, A_VER_REP, A_COR, C_INI, C_CON, C_REV), plano_json: PLANO5, agentes: VIVO }
  const m = mundo($, on, o)
  fecharEm(m, PLANO5) // REQ-APR-2 muda a ordem: o MAJOR do REPROVADO abre pendência antes do pouso
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.clears).toBe(0)
  o.agentes = []
  m.add('o', 'review.veredito', { task: 'c', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
  const ordem = m.log.filter((l) => /^(append:task\.reaberta|append:sessao\.pouso|clear)$/.test(l))
  expect(ordem).toEqual(['append:task.reaberta', 'append:sessao.pouso', 'clear'])
})
test('lote-revisor-ja-terminou (achado 1): o revisor acabou, o veredito ainda não entrou ⇒ a correção negada, nunca a task do revisor', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI, A_CON, A_VER_REP, A_COR, C_INI, C_CON, C_REV), plano_json: PLANO5, agentes: [{ id: 'ag1', status: 'completed' }] })
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.agent('gabarito-revisor')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
})
test('esc-clear-nao-reabre-a-viva (achado 4): negação, Esc, /clear, despacho aceito e hand-back ⇒ a task viva nunca é reaberta, a negada sim', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI), plano_json: PLANO5 }
  const m = mundo($, on, o)
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno({ isAborted: true }); await m.clock.settle()
  m.est.percent = 0.5
  await m.inicio()
  m.add('o', 'task.iniciada', { task: 'c', papel: 'implementador' })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  o.agentes = VIVO
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  o.agentes = []
  m.add('o', 'task.concluida', { task: 'c', sha: 'x' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
})
test('handback-pendente-reabre-so-a-negada: vivos 0, a concluída ainda sem evento e outra negada ⇒ só a negada, a mais recente', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI, C_INI), plano_json: PLANO5, agentes: [{ id: 'ag1', status: 'completed' }] })
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'c', origem: 'retomada' }])
})
// r3: o mod guarda a hora da negação (relógio de parede, como o diário). `iniciar` com ts depois dela é despacho aceito: vai atrás na ordem.
const DEPOIS = (m: ReturnType<typeof mundo>, tipo: string, dados: Record<string, unknown>) => {
  m.add('o', tipo, dados)
  m.evs.at(-1).ts = new Date(Date.now() + 3_600_000 + m.evs.length * 1000).toISOString()
}
test('plano-sem-task-mantem-negacao (r3, achado 2): plano ilegível para a regra ⇒ nada reaberto, a negação FICA; plano restaurado reabre a negada', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI), plano_json: { entrega: 'PBI-7', tasks: [{ id: 'c', deps: [], arquivos: ['c.ts'] }] } }
  const m = mundo($, on, o)
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  o.plano_json = PLANO5
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
  expect(m.est.clears).toBe(1)
})
test('diario-fora-de-ordem-mantem-negacao (r3, achado 2): diário fora de ordem ⇒ nada reaberto, a negação FICA; diário restaurado reabre a negada', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI), plano_json: PLANO5 })
  await m.inicio()
  await m.agent('gabarito-implementador')
  m.evs.push({ ...m.evs[0], seq: 1, ts: '2026-11-03T00:00:00.000Z', tipo: 'task.iniciada', dados: { task: 'c', papel: 'implementador' } })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  m.evs.pop()
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
})
test('esc-t3-terminou-reabre-a-negada (r3, achado 1): negação, Esc, /clear, T3 aceito e terminado antes do fim do turno ⇒ reabre a negada, nunca a T3', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI), plano_json: PLANO5 }
  const m = mundo($, on, o)
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno({ isAborted: true }); await m.clock.settle()
  m.est.percent = 0.5
  await m.inicio()
  DEPOIS(m, 'task.iniciada', { task: 'c', papel: 'implementador' })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
})
test('vivo-clear-t3-terminou-reabre-a-negada (r3, achado 1): negada com outro agente vivo, /clear, T3 aceito, tudo acaba antes do fim do turno ⇒ reabre a negada, nunca a T3', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI), plano_json: PLANO5, agentes: VIVO }
  const m = mundo($, on, o)
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  m.est.percent = 0.5
  await m.inicio()
  DEPOIS(m, 'task.iniciada', { task: 'c', papel: 'implementador' })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  o.agentes = []
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
})
test('deny-antes-do-iniciar-reabre (r3): o deny leu o diário SEM a task; o iniciar entra depois do deny, com ts real depois dele ⇒ ainda reabre (ordena, não filtra)', async ($, on) => {
  const m = mundo($, on, { eventos: aposB() })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  DEPOIS(m, 'task.iniciada', { task: 'a', papel: 'implementador' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.clears).toBe(1)
})
test('duas-negacoes-a-hora-e-a-ultima (r3, R4): a 1ª negação, c iniciada e negada, d aceita depois ⇒ negadoAte é o da 2ª negação: reabre c e a (não a d)', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI), plano_json: PLANO5 })
  const passar = () => { const t = Date.now(); while (Date.now() < t + 2) { /* o diário tem ms: separa as horas */ } }
  await m.inicio()
  await m.agent('gabarito-implementador')
  passar()
  m.add('o', 'task.iniciada', { task: 'c', papel: 'implementador' })
  m.evs.at(-1).ts = new Date().toISOString()
  passar()
  await m.agent('gabarito-implementador')
  DEPOIS(m, 'task.iniciada', { task: 'd', papel: 'implementador' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'c', origem: 'retomada' }, { task: 'a', origem: 'retomada' }])
})
test('revisor-antes-da-negada-que-veio-depois (r3, R5): o revisor já acabou, o veredito não entrou, e o iniciar da negada tem ts depois do deny ⇒ reabre a negada, nunca a task do revisor', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(C_INI, C_CON, C_REV), plano_json: PLANO5, agentes: [{ id: 'ag1', status: 'completed' }] })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  DEPOIS(m, 'task.iniciada', { task: 'a', papel: 'implementador' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'a', origem: 'retomada' }])
})
test('agent-outro-tipo-com-vivo-fica-e-zera: Explore negado com implementador vivo ⇒ nada reaberto; acabado o hand-back, a negação some e a task em voo sem agente cai no (5b)', async ($, on) => {
  const o: Opc = { eventos: aposB(A_INI), plano_json: PLANO5, agentes: VIVO }
  const m = mundo($, on, o)
  await m.inicio()
  await aCaminho(m)
  await m.agent('Explore')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  o.agentes = []
  m.add('o', 'task.concluida', { task: 'a', sha: 'x' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  m.add('o', 'task.iniciada', { task: 'c', papel: 'implementador' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
})
test('negacao-sobrando-sem-voo-zera: negação sem task em voo ⇒ nada reaberto e a contagem zera, nada reabre depois', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(), plano_json: PLANO5 })
  await m.inicio()
  await aCaminho(m)
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  m.est.percent = 0.5
  m.add('o', 'task.iniciada', { task: 'c', papel: 'implementador' })
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
})
test('reaberta-falha-para-em-3-turnos: task.reaberta que não grava ⇒ aviso, não insiste, e em 3 turnos o núcleo grava loop.parar nao_conseguiu (hand-back a caminho)', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI), appendFalha: ['task.reaberta'] })
  await m.inicio()
  await aCaminho(m)
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(m.toasts.some((t) => t.includes('task.reaberta'))).toBe(true)
  expect(parou(m)).toHaveLength(0)
  await m.turno(); await m.clock.settle()
  await m.turno(); await m.clock.settle()
  expect(m.log.filter((l) => l === 'append:task.reaberta')).toHaveLength(1)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toMatchObject({ motivo: 'nao_conseguiu' })
  expect(m.est.clears).toBe(0)
})
test('subagent-nao-reabre: turn.complete de subagent não desfaz a negação do orquestrador', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI) })
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno({ agentId: 'ag-1' }); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
})
test('retomada-nomeia-skill: o prompt do pouso diz qual skill continua o loop', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.est.submits[0]).toContain('gabarito-loop')
})
test('deny-manda-encerrar: o deny diz para encerrar o turno em vez de tentar de novo', async ($, on) => {
  const m = mundo($, on)
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/encerre o turno/)
})
test('deny-manda-encerrar-em-voo: também quando o deny é o nao_conseguiu do núcleo', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI) })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/encerre o turno/)
})

// ---- T25 (Q-T13F D1, REQ-LOOP-5): `iniciar` sem `Agent` deixa task em voo sem agente; no fim normal do turno o mod recupera ----
// Hand-back a caminho = `turn.complete` de subagent (terminados) acima de `prompt.submit` de origem `peer` (recebidos).
const ORFA = aposB(A_INI)
const A_INI_DE_NOVO = ['task.iniciada', { task: 'a', papel: 'implementador' }] as [string, Record<string, unknown>]
const recuperar = async (m: ReturnType<typeof mundo>) => { await m.turno(); await m.clock.settle() }

test('orfa-reabre-e-abre-turno: 0 vivos, 0 a caminho, sem pausa, sem parar ⇒ task.reaberta {retomada} e um turno com a skill', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.submits).toHaveLength(1)
  expect(m.est.submits[0]).toContain('gabarito-loop')
  expect(parou(m)).toHaveLength(0)
})
// GM-15 T25 (review r1 MAJOR-2): reabertura de origem inválida numa task (aqui `b`) não derruba o diário para o mod: a órfã `a` é reaberta e o despacho não é negado.
const B_RUIM = ['task.reaberta', { task: 'b', origem: 'xpto' }] as [string, Record<string, unknown>]
test('orfa-com-outra-task-invalida-reabre (GM-15 T25): a reabertura de origem inválida de b afeta só b; a órfã a é reaberta e abre turno', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(B_RUIM, A_INI) })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.submits).toHaveLength(1)
})
test('agent-permitido-com-outra-task-invalida (GM-15 T25): a leitura de pendência não nega por causa da task inválida', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: aposB(B_RUIM) })
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
test('orfa-nao-pousa-no-mesmo-turno: com contexto acima de X o turno aberto vem antes de qualquer pouso', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, percent: 60 })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(1)
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).not.toContain('sessao.pouso')
  expect(m.est.submits).toHaveLength(1)
  expect(m.est.submits[0]).not.toContain('Diário')
})
test('orfa-handback-a-caminho-nao-reabre: subagent terminou e o hand-back ainda não chegou ⇒ nada; chegou ⇒ reabre', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await m.turno({ agentId: 'ag-1' })
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
  await m.peer()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.submits).toHaveLength(1)
})
test('orfa-peer-de-outra-origem-nao-conta: só origin.kind peer compensa o turn.complete do subagent', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await m.turno({ agentId: 'ag-1' })
  await $.prompt.submit({ text: 'digitado pelo dono', origin: { kind: 'user' } })
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
})
test('orfa-com-vivo-nao-reabre: agente rodando ⇒ o hand-back acorda o modelo, o mod não faz nada', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, agentes: VIVO })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-pausado-nao-reabre: PAUSAR presente ⇒ nada reaberto, nenhum turno', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, arquivos: [`${PRINCIPAL}/.harness/PAUSAR`] })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-pausa-nao-confirmada-nao-reabre: fs.exists lançando conta como pausado', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, existsFalha: true })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-apos-parar-nao-reabre: o diário termina em loop.parar ⇒ parado, nada reaberto', async ($, on) => {
  const m = mundo($, on, { eventos: [...ORFA, EV(6, 'loop.parar', { motivo: 'nao_conseguiu', task: 'a' })] })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-negado-nao-duplica: Agent negado desfaz a negada e o núcleo decide; o mod não reabre também a outra em voo nem abre turno', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI, C_INI), plano_json: PLANO5 })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(1)
  expect(m.est.submits.filter((s) => s.includes('gabarito-loop') && !s.includes('Diário'))).toHaveLength(0)
})
test('orfa-reabre-1x-na-2a-grava-parar (GM-15 T12, REQ-AUT-1; mata "reabrir 2 vezes"): a 2ª órfã da mesma task ⇒ loop.parar nao_conseguiu com aviso, sem reabertura nem turno', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(parou(m)).toHaveLength(0)
  m.add('o', ...A_INI_DE_NOVO)
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(1)
  expect(m.est.submits).toHaveLength(1)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'nao_conseguiu', task: 'a' })
  expect(m.toasts.some((t) => t.includes('nao_conseguiu') && t.includes('a'))).toBe(true)
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
  expect(reabertas(m)).toHaveLength(1)
})
test('orfa-parar-nao-grava-avisa: loop.parar que não grava não vira "parado"; o aviso diz que não gravou', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, appendFalha: ['loop.parar'] })
  await m.inicio()
  await recuperar(m)
  m.add('o', ...A_INI_DE_NOVO)
  await recuperar(m)
  expect(parou(m)).toHaveLength(0)
  expect(reabertas(m)).toHaveLength(1)
  expect(m.toasts.some((t) => t.includes('loop.parar') && t.includes('não'))).toBe(true)
})
test('orfa-reaberta-nao-grava-avisa: task.reaberta que falha ⇒ aviso com reabrir <task>, nenhum turno, nenhum pouso', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, appendFalha: ['task.reaberta'] })
  await m.inicio()
  await recuperar(m)
  expect(m.toasts.some((t) => t.includes('reabrir a'))).toBe(true)
  expect(m.est.submits).toHaveLength(0)
  expect(m.est.clears).toBe(0)
})
test('orfa-submit-recusado-avisa: prompt.submit recusado ⇒ a task está reaberta, o aviso diz que o dono digita', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, submitFalha: true })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(1)
  expect(m.toasts.some((t) => t.includes('Digite'))).toBe(true)
})
test('orfa-agent-list-falha-nao-reabre: não saber os vivos não é vivos 0', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, agentes: 'falha' })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-agent-list-falha-cai-no-nucleo: em -p, agent.list ilegível deixa o núcleo decidir (sem_pouso e aviso), sem turno aberto', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, agentes: 'falha', interativo: false })
  await m.inicio(false)
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'nao_interativo' })
  expect(m.toasts.some((t) => t.includes('sem_pouso'))).toBe(true)
})
test('orfa-reaberta-nao-grava-cai-no-nucleo: em -p, task.reaberta que falha deixa o núcleo decidir (sem_pouso e aviso), sem turno aberto', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, appendFalha: ['task.reaberta'], interativo: false })
  await m.inicio(false)
  await recuperar(m)
  expect(m.toasts.some((t) => t.includes('reabrir a'))).toBe(true)
  expect(m.est.submits).toHaveLength(0)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'nao_interativo' })
  expect(m.toasts.some((t) => t.includes('sem_pouso'))).toBe(true)
})
test('orfa-agent-list-lixo-nao-reabre: lista que não é lista não é vivos 0', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, agentes: 'lixo' })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-diario-ilegivel-nao-reabre: diário que não se lê ⇒ nada reaberto, nenhum turno', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, lerFalha: true })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-plano-ilegivel-nao-reabre: plano que não se lê ⇒ nada reaberto, nenhum turno', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, plano_json: 'falha' })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-sem-loop-nao-reabre: sem plano.json o mod não muda nada', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA, plano: false })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-abortado-nao-reabre: Esc, erro e reason desconhecido não decidem', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await m.turno({ isAborted: true }); await m.clock.settle()
  await m.turno({ reason: 'error' }); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
})
test('orfa-subagent-nao-reabre: turn.complete de subagent nunca recupera', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await m.turno({ agentId: 'ag-1' }); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
})
test('orfa-corrigindo-volta-a-reprovada: correção sem agente reabre a task reprovada', async ($, on) => {
  const m = mundo($, on, { eventos: aposB(A_INI, A_CON, A_VER_REP, A_COR) })
  fecharEm(m) // GM-15 T12: o núcleo decide a retomada; a pendência de aprendizado do REPROVADO (REQ-APR-2) vem antes dela
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.submits).toHaveLength(1)
})
test('orfa-sem-task-em-voo-nao-abre-turno: nada em voo ⇒ nada a recuperar', async ($, on) => {
  const m = mundo($, on, { eventos: aposB() })
  await m.inicio()
  await m.turno({ percent: 1 }); await m.clock.settle()
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits.filter((s) => s.includes('em voo'))).toHaveLength(0)
})

// ---- T31 (Q-T13G, REQ-LOOP-5): a recuperação respeita o `parar` do núcleo; a conta é por ciclo (`liberar` recomeça) ----
const DONO_A = ['task.reaberta', { task: 'a', origem: 'dono' }] as [string, Record<string, unknown>]
const PLANO_AB = { entrega: 'PBI-7', tasks: [{ id: 'a', deps: [], arquivos: ['a.ts'] }, { id: 'b', deps: [], arquivos: ['b.ts'] }] }
const EM_TETO_A_E_B_ORFA = [...NO_TETO, EV(7, 'task.iniciada', { task: 'b', papel: 'implementador' })]
// GM-15 T12 (REQ-AUT-1): a órfã é reaberta 1 vez antes do `parar` do teto de outra task; com a retomada já gasta, o teto para como antes.
const EM_TETO_A_E_B_ORFA_RETOMADA = [...EM_TETO_A_E_B_ORFA, EV(8, 'task.reaberta', { task: 'b', origem: 'retomada' }), EV(9, 'task.iniciada', { task: 'b', papel: 'implementador' })]
const MEDIDO = EV(8, 'custo.medicao', { agente: 'orquestrador', input_tokens: 90, output_tokens: 20, cache_read: 0, cache_creation: 0 })
const naoReabre = (m: ReturnType<typeof mundo>) => {
  expect(reabertas(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(0)
  expect(m.tipos()).not.toContain('sessao.pouso')
}

test('orfa-teto-rodadas-nao-reabre: T1 no teto e outra órfã ⇒ grava parar teto_rodadas com aviso, 0 reabertas, 0 turnos', async ($, on) => {
  const m = mundo($, on, { eventos: EM_TETO_A_E_B_ORFA_RETOMADA, plano_json: PLANO_AB })
  fecharEm(m, PLANO_AB) // REQ-APR-2 muda a ordem: o MAJOR do teto abre pendência antes do `parar`
  await m.inicio()
  await recuperar(m)
  naoReabre(m)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'teto_rodadas', task: 'a' })
  expect(m.toasts.some((t) => t.includes('teto_rodadas'))).toBe(true)
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
})
test('orfa-teto-rodadas-reabre-1x (GM-15 T12, REQ-AUT-1): T1 no teto e outra órfã sem retomada ⇒ a órfã é reaberta (retomada) e abre turno, sem loop.parar', async ($, on) => {
  const m = mundo($, on, { eventos: EM_TETO_A_E_B_ORFA, plano_json: PLANO_AB })
  fecharEm(m, PLANO_AB)
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m).map((g) => g.dados)).toEqual([{ task: 'b', origem: 'retomada' }])
  expect(parou(m)).toHaveLength(0)
})
test('orfa-teto-tokens-nao-reabre: tokens no teto ⇒ grava parar teto_tokens, 0 reabertas, 0 turnos', async ($, on) => {
  const m = mundo($, on, { eventos: [...ORFA, MEDIDO], config: { tetoTokens: 100 } })
  await m.inicio()
  await recuperar(m)
  naoReabre(m)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'teto_tokens' })
  expect(m.toasts.some((t) => t.includes('teto_tokens'))).toBe(true)
})
test('orfa-ci-vermelho-nao-reabre: 2 CI vermelhos ⇒ grava parar ci_vermelho, 0 reabertas, 0 turnos', async ($, on) => {
  const m = mundo($, on, { eventos: [...ORFA, EV(8, 'ci.resultado', { verde: false }), EV(9, 'ci.resultado', { verde: false })] })
  await m.inicio()
  await recuperar(m)
  naoReabre(m)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'ci_vermelho' })
  expect(m.toasts.some((t) => t.includes('ci_vermelho'))).toBe(true)
})
test('orfa-retomar-do-nucleo-reabre: núcleo com `retomar` (órfã sem retomada) ⇒ a órfã é reaberta e o turno abre', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA }) // sem teto, sem CI vermelho: o núcleo diz `retomar` (task em voo sem agente, 0 retomadas)
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(m.est.submits).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
})
test('orfa-liberar-nao-zera-a-conta (GM-15 T12, REQ-AUT-1): a conta é a do núcleo, no diário inteiro; depois de liberar, a 2ª órfã para', async ($, on) => {
  const m = mundo($, on, { eventos: ORFA })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(1)
  // a chega ao teto e o dono a libera: a retomada já gasta continua gasta
  m.add('o', ...A_INI_DE_NOVO)
  m.add('o', ...A_CON)
  m.add('o', 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 })
  m.add('o', 'task.iniciada', { task: 'a', papel: 'correcao' })
  m.add('o', ...A_CON)
  m.add('o', 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 2, major: 1, blocker: 0 })
  m.add('o', ...DONO_A)
  m.add('o', ...A_INI_DE_NOVO)
  fecharEm(m) // a pendência de aprendizado dos REPROVADOS (REQ-APR-2) vem antes da decisão sobre a órfã
  await recuperar(m)
  expect(reabertas(m)).toHaveLength(1)
  expect(m.est.submits).toHaveLength(1)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'nao_conseguiu', task: 'a' })
})
test('orfa-nucleo-lanca-nao-reabre: proximaAcao que lança ⇒ não reabre, não abre turno, não grava parar; aviso de que o núcleo falhou', async ($, on) => {
  // `c` pendente sem `deps`: `t.deps.every` lança dentro de `proximaAcao`
  const m = mundo($, on, { eventos: ORFA, plano_json: { entrega: 'PBI-7', tasks: [...PLANO.tasks, { id: 'c', arquivos: ['c.ts'] }] } })
  await m.inicio()
  await recuperar(m)
  naoReabre(m)
  expect(parou(m)).toHaveLength(0)
  expect(m.toasts.some((t) => t.includes('núcleo'))).toBe(true)
})

// ---- T31 r2: diário inválido na recuperação só avisa; a conta é só da task liberada ----
test('orfa-diario-invalido-do-nucleo-so-avisa: ci.resultado {verde:"x"} com a órfã ⇒ 0 reabertas, 0 turnos, 0 parar, aviso', async ($, on) => {
  // `tasksEmVoo` aceita o diário; o núcleo devolve `parar diario_invalido`. Mesmo com a suíte verde não reabre nem para.
  const m = mundo($, on, { eventos: [...ORFA, EV(8, 'ci.resultado', { verde: 'x' })] })
  await m.inicio()
  await recuperar(m)
  naoReabre(m)
  expect(parou(m)).toHaveLength(0)
  expect(m.toasts.length).toBeGreaterThan(0)
})
test('orfa-conta-por-task (GM-15 T12, REQ-AUT-1): c com a retomada gasta não impede a 1ª de a; só a task que o núcleo manda retomar é reaberta', async ($, on) => {
  const plano = { entrega: 'PBI-7', tasks: [...PLANO.tasks, { id: 'c', deps: [], arquivos: ['c.ts'] }] }
  const m = mundo($, on, {
    eventos: [...ORFA, EV(8, 'task.iniciada', { task: 'c', papel: 'implementador' }), EV(9, 'task.reaberta', { task: 'c', origem: 'retomada' }), EV(10, 'task.iniciada', { task: 'c', papel: 'implementador' })],
    plano_json: plano,
  })
  await m.inicio()
  await recuperar(m)
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
  expect(parou(m)).toHaveLength(0)
  expect(m.est.submits).toHaveLength(1)
})

// ======================================================================================================================================
// ---- painel (E4, T10): Pane, faixa, atualização e Parar. Mutações: task-10-mut.json ----
// ======================================================================================================================================
const ID_PAINEL = 'gabarito-painel'
const acaoP = (rotulo: string, comando: string | null) => ({ rotulo, comando })
function estadoPainel(o: Record<string, any> = {}) {
  return {
    id: 'GM-12', titulo: 'E4 Painel', pacote: 'Terra Média',
    plano: { tasks: [{ id: 'T1', titulo: 'a', estado: 'integrada', glifo: '✓', deps: [] }, { id: 'T2', titulo: 'b', estado: 'pendente', glifo: '○', deps: ['T1'] }], feitas: 1, total: 2, pct: 50, eta: { hora: '17:42', restanteS: 3600, maisMenosS: 600, n: 3 }, rodadaMedia: null, medianaS: null },
    equipe: { lider: { nome: 'GANDALF', modelo: 'opus', ctx: 36, x: 50, tok: 412000, h5: null, d7: 18, narrativa: 'esperando o loop' }, agentes: [], vivos: 0, revisoresAguardando: [], sombra: { nome: 'ELROND', modelo: 'opus', decisoes: 0, ultima: null } },
    parado: false, parar: null, depende: [], atencao: [], historico: [], ocultos: 0,
    rodape: { ci: { verde: null, execucoesHoje: 0 }, prod: { leituras: 0, alteracoes: 0 }, politica: 'continua' },
    notificacao: null, qualidade: { rodadaMedia: null, mortas: null },
    ...o,
  }
}
const pararP = (chave = 'parar:s1:7', texto = 'teto de rodadas de review em T2', acoes = [acaoP('aprovar', '/gabarito-mestre:liberar T2'), acaoP('recusar', null)]) =>
  estadoPainel({ parado: true, parar: { motivo: 'teto_rodadas', texto, acoes, hora: '14:05', chave, emVoo: [], alteracoes: 0 } })
const PAROU_PREFIXO = 'gabarito: PAROU'
const TOAST_PAROU = 'gabarito: PAROU GM-12 · teto de rodadas de review em T2'

const propsPane = (cols = 80) => ({ title: 'gabarito', isFocused: false, bodyColumns: cols, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} }) as any
const propsFaixa = (extra: Record<string, unknown> = {}) => ({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {}, ...extra }) as any
const montarPane = ($: any, cols = 80) => $.ui.mount({ plugin: 'gabarito-mestre', surface: 'terminal', component: 'Pane', requestId: ID_PAINEL, props: propsPane(cols) })
const montarFaixa = ($: any, extra: Record<string, unknown> = {}) => $.ui.mount({ plugin: 'gabarito-mestre', surface: 'terminal', component: 'AbovePrompt', requestId: 'faixa', props: propsFaixa(extra) })
/** GM-14 T20: AbovePrompt com H (`viewport.rows`, S1b) e `maxRows`; `h` null ⇒ sem viewport (H desconhecido) */
const montarFaixaH = ($: any, h: number | null, maxRows: number, extra: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'gabarito-mestre', surface: 'terminal', component: 'AbovePrompt', requestId: 'faixa', props: propsFaixa({ maxRows, ...extra }), ...(h === null ? {} : { viewport: { rows: h, columns: 100 } }) })
/** GM-14 T20: o estado novo (T17/T18: `modo`, blocos), sobre o da E4 para manter `plano` e `equipe` */
function estadoNovo(o: Record<string, any> = {}) {
  return estadoPainel({
    id: 'GM-14', titulo: 'Clareza', modo: 'entrega', trilha: null, pergunta: null, perguntasMais: 0, umaLinha: null,
    pronto: { integradas: 2, total: 5, previsao: null }, fase: null,
    agora: { orquestrador: { nome: 'GANDALF', contexto: 40, estimado: false, pousar: false }, agentes: [], segundoPlano: [] },
    recente: [], desatualizadoS: null, fontesFalhas: [], atencao: [],
    depende: [{ nivel: 'dono', motivo: 'nada depende de você', acoes: [] }],
    ...o,
  })
}
const PERGUNTA = { id: 'sess-1:7', gatilho: 'd', texto: 'Qual caminho seguir agora', opcoes: ['manter', 'trocar'] }
/** Muitas linhas de ATENÇÃO: o desenho passa de qualquer orçamento testado */
const ATENCAO_LONGA = Array.from({ length: 30 }, (_, i) => `aviso numero ${i + 1}`)
const linhasDesenhadas = async (ui: any) => { const a = await ui.drawn(); return Array.isArray(a?.children) ? a.children.length : 0 }
const drena = async (m: ReturnType<typeof mundo>) => { for (let i = 0; i < 8; i++) await m.clock.settle() }
const PERIODO = 60000 // GM-14 T20: relógio de 60 s (S15)
const comPainel = ($: any, on: any, painel: PainelOpc = {}, o: Opc = {}) => mundo($, on, { painel: { modo: 'ok', ...painel }, ...o })
const arrancar = async (m: ReturnType<typeof mundo>) => { await m.inicio(); await drena(m) }
const todosTextos = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
const sobreOMotor = (on: any) => on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e); return h(Text, null, 'motor') })

// ---- abertura da Pane ----
test('pane-abre-com-plano: resposta ok ⇒ ui.open do painel sem focus, com título', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  expect(m.est.opens).toHaveLength(1)
  expect(m.est.opens[0].id).toBe(ID_PAINEL)
  expect(m.est.opens[0].title).toBe('gabarito')
  expect(m.est.opens[0].focus).toBeUndefined()
})
test('pane-argv-cwd-timeout: node <raiz>/gates/scripts/painel.mjs estado --agentes, cwd da sessão, 5 s', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const argv = m.est.painelArgv[0]
  expect(argv[0]).toBe('node')
  expect(argv[1].endsWith('/gates/scripts/painel.mjs')).toBe(true)
  expect(argv.slice(2)).toEqual(['estado', '--agentes'])
  expect(m.est.painelInit[0].cwd).toBe(RAIZ)
  expect(m.est.painelInit[0].timeoutMs).toBe(5000)
})
test('sem-loop-nao-esconde-nem-cancela-relogio (GM-14 T20, M-T20a): resposta "sem loop" é falha de leitura, não esconde o painel nem para o relógio', async ($, on) => {
  const m = comPainel($, on, { modo: 'sem_loop' })
  await arrancar(m)
  expect(m.est.painelStdins).toHaveLength(1)
  await m.clock.advance(PERIODO * 3)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(4)
  const ui = await montarPane($, 80)
  const t = (await todosTextos(ui)).join('|')
  expect(t).toContain('painel: leitura falhou')
  expect(t).not.toContain('sem loop nesta branch')
  await ui.unmount()
})
test('nao-interativo-sem-painel: -p ⇒ 0 ponte do painel, 0 ui.open, 0 faixa', async ($, on) => {
  const m = comPainel($, on, {}, { interativo: false })
  await m.inicio()
  await m.turno()
  await m.clock.advance(PERIODO * 2)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  expect(m.est.opens).toHaveLength(0)
  expect(m.est.notifies).toHaveLength(0)
})
const semTela = async ($: any, on: any, interativo: boolean, surface: string | null) => {
  const m = comPainel($, on)
  await $.session.start({ cwd: RAIZ, surface, isInteractive: interativo })
  await m.turno()
  await m.clock.advance(PERIODO * 2)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  expect(m.est.opens).toHaveLength(0)
}
test('sem-tela-sem-painel: isInteractive true com surface null ⇒ nada do painel', async ($, on) => { await semTela($, on, true, null) })
test('sem-interativo-sem-painel: isInteractive false com tela ⇒ nada do painel', async ($, on) => { await semTela($, on, false, 'terminal') })

// ---- app desktop (SDK): session.start chega com isInteractive false e surface null; a tela aparece depois, em session.attach ----
const startSdk = ($: any) => $.session.start({ cwd: RAIZ, surface: null, isInteractive: false })
test('desktop-attach-le: start SDK sem tela, depois session.attach desktop ⇒ painel.mjs estado roda e abre a Pane', async ($, on) => {
  const m = comPainel($, on)
  await startSdk($)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await drena(m)
  expect(m.est.painelArgv.length).toBeGreaterThan(0)
  expect(m.est.painelArgv[0].slice(2)).toEqual(['estado', '--agentes'])
  expect(m.est.opens).toHaveLength(1)
  const antes = m.est.painelStdins.length
  await m.clock.advance(PERIODO)
  await drena(m)
  expect(m.est.painelStdins.length).toBeGreaterThan(antes)
})
test('desktop-comando-painel-le: /gabarito painel em sessão SDK sem tela ⇒ lê e abre', async ($, on) => {
  const m = comPainel($, on)
  await startSdk($)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  await m.cmd('painel')
  await drena(m)
  expect(m.est.painelStdins.length).toBeGreaterThan(0)
  expect(m.est.opens).toHaveLength(1)
})
test('sdk-sem-tela-sem-attach-nao-le: -p sem superfície e sem attach ⇒ 0 ponte, 0 ui.open', async ($, on) => {
  const m = comPainel($, on)
  await startSdk($)
  await m.turno()
  await m.clock.advance(PERIODO * 3)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  expect(m.est.opens).toHaveLength(0)
})
test('desktop-render-com-superficie-le: start SDK sem attach, Pane renderiza com surfaces() [desktop] ⇒ painel.mjs estado roda', async ($, on) => {
  const m = comPainel($, on)
  await startSdk($)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  m.est.surfaces = ['desktop'] // a tela aparece depois do start, sem attach
  const ui = await montarPane($, 80)
  await drena(m)
  expect(m.est.painelArgv.length).toBeGreaterThan(0)
  expect(m.est.painelArgv[0].slice(2)).toEqual(['estado', '--agentes'])
  await ui.unmount()
})
test('render-sem-superficie-nao-le: start SDK sem attach, Pane renderiza com surfaces() vazio ⇒ 0 ponte', async ($, on) => {
  const m = comPainel($, on, {}, { surfaces: [] })
  await startSdk($)
  const ui = await montarPane($, 80)
  await m.clock.advance(PERIODO * 2)
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(0)
  await ui.unmount()
})
test('start-depois-de-attach-nao-rebaixa: start SDK, attach, start de novo (reload do módulo) ⇒ continua lendo', async ($, on) => {
  const m = comPainel($, on, {}, { surfaces: ['desktop'] })
  await startSdk($)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await drena(m)
  await startSdk($)
  await drena(m)
  const antes = m.est.painelStdins.length
  expect(antes).toBeGreaterThan(0)
  await m.clock.advance(PERIODO)
  await drena(m)
  expect(m.est.painelStdins.length).toBeGreaterThan(antes)
})
test('loop-aparece-no-turno-abre: sem loop no início; o plano aparece e o turno abre a Pane e recria o relógio', async ($, on) => {
  const m = comPainel($, on, { modo: 'sem_loop' })
  await arrancar(m)
  expect(m.est.opens).toHaveLength(0)
  m.est.painel.modo = 'ok'
  await m.turno()
  await drena(m)
  expect(m.est.opens).toHaveLength(1)
  const antes = m.est.painelStdins.length
  await m.clock.advance(PERIODO)
  await drena(m)
  expect(m.est.painelStdins.length).toBe(antes + 1)
})
test('fechada-pelo-dono-nao-reabre: a Pane que sumiu de `$.ui.panes()` depois de aberta nunca é reaberta por refresh; o relógio segue', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  expect(m.est.opens).toHaveLength(1)
  m.est.panes = [] // o dono fechou (o motor não deixa o teste levantar `ui.close` de pessoa: este é o sinal que o kit alcança)
  await m.turno()
  await m.clock.advance(PERIODO * 2)
  await drena(m)
  expect(m.est.opens).toHaveLength(1)
  expect(m.est.painelStdins.length).toBeGreaterThan(2)
})
test('pane-ja-listada-nao-reabre: Pane de pé em `$.ui.panes()` (módulo recarregado) ⇒ nenhum ui.open', async ($, on) => {
  const m = comPainel($, on, {}, { panes: [{ id: ID_PAINEL, isPlaced: true, isShown: true }] })
  await arrancar(m)
  expect(m.est.opens).toHaveLength(0)
})

// ---- a Pane desenhada ----
test('pane-desenha-o-renderPainel: o líder e o PAROU aparecem em Text aninhado com color (S-E4 iii); largura = bodyColumns', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const ui = await montarPane($, 80)
  const arvore = JSON.stringify(await ui.drawn())
  expect(arvore).toContain('GANDALF')
  expect(arvore).toContain('PAROU')
  expect(arvore).toContain('"color":"error"')
  await ui.unmount()
})
// T14b (D2 da Sombra): a Pane passa `scroll.bodyRows` como altura; o agente do aceite 4 (180x50) fica nas primeiras linhas
const estadoAceite4 = () => {
  const t = (id: string, estado: string, glifo: string, extra: Record<string, any> = {}) => ({ id, titulo: `Task ${id}`, estado, glifo, deps: [], ...extra })
  const integradas = Array.from({ length: 7 }, (_, i) => t(`T${i + 1}`, 'integrada', '✓'))
  const tasks = [...integradas, t('T8', 'implementando', '●', { nome: 'RONY', papel: 'implementador', modelo: 'sonnet', desdeS: 540 }), t('T9', 'pendente', '○'), t('T10', 'pendente', '○')]
  return estadoPainel({
    plano: { tasks, feitas: 7, total: 10, pct: 70, eta: { hora: '17:42', restanteS: 3600, maisMenosS: 600, n: 3 }, rodadaMedia: 1.4, medianaS: 1080 },
    equipe: {
      lider: { nome: 'GANDALF', modelo: 'opus', ctx: 36, x: 50, tok: 412000, h5: 42, d7: 18, narrativa: 'esperando o loop' },
      agentes: [{ nome: 'RONY', papel: 'implementador', task: 'T8', estadoTask: 'implementando', modelo: 'sonnet', ctxPct: 31, ctxTok: 62000, tok: 118000, desdeS: 540, cor: 'claude', vivo: true }],
      vivos: 1, revisoresAguardando: [], sombra: { nome: 'ELROND', modelo: 'opus', decisoes: 0, ultima: null },
    },
  })
}
const linhasDaPane = async (m: ReturnType<typeof mundo>, $: any, scroll: Record<string, unknown>) => {
  const ui = await $.ui.mount({ plugin: 'gabarito-mestre', surface: 'terminal', component: 'Pane', requestId: ID_PAINEL, props: { ...propsPane(178), scroll } })
  const arvore = await ui.drawn()
  const linhas = (arvore.children ?? []).map((l: any) => JSON.stringify(l))
  await ui.unmount()
  return linhas as string[]
}
test('pane-passa-bodyRows-como-altura: com bodyRows 14 o agente vivo está nas 14 primeiras linhas; sem bodyRows o desenho é o de sempre (agente depois da 14ª)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoAceite4() })
  await arrancar(m)
  const com = await linhasDaPane(m, $, { offset: 0, bodyRows: 14 })
  const iCom = com.findIndex((l) => l.includes('RONY') && l.includes('ctx'))
  expect(iCom).toBeGreaterThanOrEqual(0)
  expect(iCom).toBeLessThan(14)
  const sem = await linhasDaPane(m, $, { offset: 0 })
  const iSem = sem.findIndex((l) => l.includes('RONY') && l.includes('ctx'))
  expect(iSem).toBeGreaterThanOrEqual(14)
  expect(com.length).toBeLessThan(sem.length)
})
test('pane-bodyRows-desconta-as-linhas-de-aviso: o aviso do alto ocupa 1 das bodyRows; para toda janela que comporta o agente, ele fica dentro dela', async ($, on) => {
  const m = comPainel($, on, { estado: estadoAceite4(), avisos: ['spec: ausente'] })
  await arrancar(m)
  const posicao = async (bodyRows: number) => {
    const linhas = await linhasDaPane(m, $, { offset: 0, bodyRows })
    expect(linhas[0]).toContain('painel: aviso: spec: ausente')
    return linhas.findIndex((l) => l.includes('RONY') && l.includes('ctx'))
  }
  const minimo = await posicao(1) // todos os cortes: a menor posição possível do agente
  expect(minimo).toBeGreaterThan(0)
  let vistos = 0
  for (let b = minimo + 1; b <= minimo + 12; b++) {
    const i = await posicao(b)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(b)
    vistos++
  }
  expect(vistos).toBe(12)
})
test('pane-sem-loop-e-falha: sem estado e resposta "sem loop" ⇒ a Pane diz que a leitura falhou, em warning, nunca "sem loop"', async ($, on) => {
  const m = comPainel($, on, { modo: 'sem_loop' })
  await arrancar(m)
  const ui = await montarPane($, 80)
  expect((await todosTextos(ui)).join('|')).toContain('painel: leitura falhou')
  expect((await todosTextos(ui)).join('|')).not.toContain('sem loop')
  expect(JSON.stringify(await ui.drawn())).toContain('"color":"warning"')
  await ui.unmount()
})
test('sem-esc-no-text: ESC no título e no motivo nunca chega a um filho de Text, na Pane nem na faixa', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP('parar:s1:7', 'x\x1b[2Jy') })
  await arrancar(m)
  const pane = await montarPane($, 80)
  expect(JSON.stringify(await pane.drawn())).not.toContain('\\u001b')
  const faixa = await montarFaixa($)
  expect(JSON.stringify(await faixa.drawn())).not.toContain('\\u001b')
  expect(JSON.stringify(await faixa.drawn())).toContain('PAROU')
  await pane.unmount(); await faixa.unmount()
})
test('pane-avisos-uma-linha-warning: avisos do CLI viram 1 linha warning no alto (+N)', async ($, on) => {
  const m = comPainel($, on, { avisos: ['spec: ausente', 'fuso inválido'] })
  await arrancar(m)
  const ui = await montarPane($, 80)
  const textos = await todosTextos(ui)
  expect(textos.some((t) => t.includes('painel: aviso: spec: ausente (+1)'))).toBe(true)
  await ui.unmount()
})

test('pane-redesenha-ao-atualizar: o refresh invalida o desenho; a Pane montada mostra o estado novo', async ($, on) => {
  const m = comPainel($, on, { estado: estadoPainel({ id: 'VELHO-1' }) })
  await arrancar(m)
  const ui = await montarPane($, 80)
  expect(JSON.stringify(await ui.drawn())).toContain('VELHO-1')
  m.est.painel.estado = estadoPainel({ id: 'NOVO-1' })
  await m.turno(); await drena(m)
  const depois = JSON.stringify(await ui.drawn())
  expect(depois).toContain('NOVO-1')
  expect(depois).not.toContain('VELHO-1')
  await ui.unmount()
})
test('loop-some-pane-mantem-o-ultimo: depois de um estado, a resposta "sem loop" vira falha; o último estado e o PAROU ficam', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() }, { panes: [] })
  await arrancar(m)
  m.est.painel.modo = 'sem_loop'
  await m.turno(); await drena(m)
  const rodadas = m.est.painelStdins.length
  await m.clock.advance(PERIODO * 3); await drena(m)
  expect(m.est.painelStdins.length, 'o relógio segue').toBe(rodadas + 3)
  const ui = await montarPane($, 80)
  const t = (await todosTextos(ui)).join('|')
  expect(t).toContain('painel: leitura falhou')
  expect(t).toContain('GANDALF')
  await ui.unmount()
  const faixa = await montarFaixa($)
  expect((await todosTextos(faixa)).join('|')).toContain('PAROU')
  await faixa.unmount()
})

// ---- falhas da ponte ----
test('ponte-falha-x-json-torto: timeout × não iniciou × saída não JSON ⇒ linhas distintas; números anteriores em inactive; PAROU segue error', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const rodar = async (modo: PainelOpc['modo']) => { m.est.painel.modo = modo; await m.turno(); await drena(m); if (modo === 'timeout') { await m.clock.advance(5000); await drena(m) }; const ui = await montarPane($, 80); const t = (await todosTextos(ui)).join('|'); const arv = JSON.stringify(await ui.drawn()); await ui.unmount(); return { t, arv } }
  const timeout = await rodar('timeout')
  expect(timeout.t).toContain('painel: leitura passou de 5 s')
  const naoIniciou = await rodar('rejeita')
  expect(naoIniciou.t).toContain('painel: node não iniciou')
  expect(naoIniciou.t).not.toContain('passou de 5 s')
  const torto = await rodar('torto')
  expect(torto.t).toContain('painel: resposta ilegível')
  expect(torto.t).toContain('GANDALF')
  expect(torto.arv).toContain('"color":"inactive"')
  expect(torto.arv).toContain('"color":"error"')
  const bom = await rodar('ok')
  expect(bom.t).not.toContain('painel: ')
})
test('linha-de-erro-warning + falha-mantem-parou-em-error: a linha de erro nunca é `error`; o PAROU anterior mantém a cor', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  m.est.painel.modo = 'erro'
  await m.turno(); await drena(m)
  const ui = await montarPane($, 80)
  const nos = await ui.findAll({ type: 'Text', text: /painel: diario_em_escrita: o diário mudou/ })
  expect(nos.length).toBeGreaterThan(0)
  const arv = JSON.stringify(await ui.drawn())
  const linha = arv.slice(Math.max(0, arv.indexOf('painel: diario_em_escrita') - 80), arv.indexOf('painel: diario_em_escrita'))
  expect(linha).toContain('"color":"warning"')
  expect(linha).not.toContain('"color":"error"')
  expect(arv).toContain('PAROU')
  await ui.unmount()
})
test('stdout-truncado-ilegivel: JSON válido truncado ⇒ `resposta ilegível`, nunca estado', async ($, on) => {
  const m = comPainel($, on, { modo: 'trunca', estado: estadoPainel({ id: 'NOVO-1' }) })
  await arrancar(m)
  const ui = await montarPane($, 80)
  const t = (await todosTextos(ui)).join('|')
  expect(t).toContain('painel: resposta ilegível')
  expect(t).not.toContain('NOVO-1')
  await ui.unmount()
})
test('falha-nunca-vira-toast: falha da ponte não faz toast, status nem log', async ($, on) => {
  const m = comPainel($, on, { modo: 'rejeita' })
  await arrancar(m)
  await m.turno(); await drena(m)
  expect(m.toasts).toEqual([])
  expect(m.est.notifies).toEqual([])
})

// ---- uma ponte por vez, o turno não espera ----
test('turno-nao-espera-a-ponte: o hook de turn.complete resolve com a ponte pendente', async ($, on) => {
  const m = comPainel($, on, { modo: 'pendente' })
  await m.inicio()
  await m.turno()
  await drena(m)
  expect(m.est.painelFlight).toBe(1)
  m.est.painelLibera.splice(0).forEach((r) => r())
  await drena(m)
})
test('uma-ponte-por-vez + coalesce-um-pendente: 3 turnos e 30 s com a ponte pendente ⇒ 1 em voo; ao liberar, mais 1; total 2', async ($, on) => {
  const m = comPainel($, on, { modo: 'pendente' })
  await m.inicio()
  await drena(m)
  expect(m.est.painelFlight).toBe(1)
  await m.turno(); await m.turno(); await m.turno()
  await m.clock.advance(PERIODO)
  await drena(m)
  expect(m.est.painelFlight).toBe(1)
  expect(m.est.painelStdins).toHaveLength(1)
  m.est.painel.modo = 'ok'
  m.est.painelLibera.splice(0).forEach((r) => r())
  await drena(m)
  expect(m.est.painelStdins).toHaveLength(2)
  expect(m.est.painelFlight).toBe(0)
})
test('relogio-unico-em-dois-starts: 2 session.start ⇒ um relógio só (advance 30 s ⇒ 1 execução)', async ($, on) => {
  const m = comPainel($, on)
  await m.inicio()
  await drena(m)
  await m.inicio()
  await drena(m)
  const antes = m.est.painelStdins.length
  await m.clock.advance(PERIODO)
  await drena(m)
  expect(m.est.painelStdins.length - antes).toBe(1)
})
test('refresh-30s-depois-de-parar: o relógio segue depois do PAROU (B6)', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const n0 = m.est.painelStdins.length
  await m.clock.advance(PERIODO); await drena(m)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.painelStdins.length - n0).toBe(2)
})

// ---- Pane visível × faixa ----
test('isplaced-false-so-faixa: open ⇒ não posta ⇒ a faixa mostra só o PAROU (lateral sem Pane visível), sobre o motor', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() }, { openResult: { isPlaced: false, reason: 'estreito' }, panes: [{ id: ID_PAINEL, isPlaced: false, isShown: false }] })
  await arrancar(m)
  const ui = await montarFaixa($)
  const t = (await todosTextos(ui)).join('|')
  expect(t).toContain('PAROU')
  expect(t).not.toContain('GM-12 1/2')
  await ui.unmount()
})
test('pane-visivel-por-panes: a faixa lê `$.ui.panes()`, nunca o retorno de open', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() }, { openResult: { isPlaced: false, reason: 'estreito' }, panes: [{ id: ID_PAINEL, isPlaced: false, isShown: false }] })
  await arrancar(m)
  let ui = await montarFaixa($)
  expect((await todosTextos(ui)).join('|')).toContain('PAROU')
  await ui.unmount()
  m.est.panes = [{ id: ID_PAINEL, isPlaced: true, isShown: true }] // o dono alargou o terminal; o open (já respondido) continua dizendo false
  await m.turno(); await drena(m)
  ui = await montarFaixa($)
  const t = (await todosTextos(ui)).join('|')
  expect(t).not.toContain('PAROU')
  expect(t).toContain('motor')
  await ui.unmount()
})
const paneInvisivel = async ($: any, on: any, par: { isPlaced: boolean; isShown: boolean }) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() }, { panes: [{ id: ID_PAINEL, ...par }] })
  await arrancar(m)
  const ui = await montarFaixa($)
  expect((await todosTextos(ui)).join('|')).toContain('PAROU')
  await ui.unmount()
}
test('pane-visivel-exige-posta: isShown sem isPlaced é Pane invisível', async ($, on) => { await paneInvisivel($, on, { isPlaced: false, isShown: true }) })
test('pane-visivel-exige-mostrada: isPlaced sem isShown (aba atrás de outra) é Pane invisível', async ($, on) => { await paneInvisivel($, on, { isPlaced: true, isShown: false }) })
test('faixa-some-com-pane-e-nada: Pane posta e nada pendente ⇒ a faixa cede ao motor', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, {}, { panes: [{ id: ID_PAINEL, isPlaced: true, isShown: true }] })
  await arrancar(m)
  const ui = await montarFaixa($)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
})
test('faixa-pane-fechada-sem-parou-cede: Pane fechada e nada no topo (sem PAROU nem pergunta) ⇒ a faixa cede ao motor (GM-14: nada de `<id> N/M`)', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoPainel({ depende: [{ nivel: 'dono', motivo: 'loop pausado', acoes: [] }] }) }, { panes: [] })
  await arrancar(m)
  const ui = await montarFaixa($)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
})
test('has-survey-cede: com survey a faixa passa, mesmo com PAROU', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const ui = await montarFaixa($, { hasSurvey: true })
  expect(await todosTextos(ui)).toEqual(['motor'])
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})
test('faixa-parou: ■ PAROU com hora e motivo, botão com o rótulo da ação', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const ui = await montarFaixa($)
  expect((await todosTextos(ui)).join('|')).toContain('■ PAROU 14:05 teto de rodadas de review em T2')
  expect(JSON.stringify(await ui.drawn())).toContain('"color":"error"')
  expect(JSON.stringify(await ui.drawn())).toContain('aprovar')
  await ui.unmount()
})
test('faixa-depende-acima: no local acima o "depende de você" sai no topo, em warning, com o botão do item', async ($, on) => {
  sobreOMotor(on)
  const dep = estadoNovo({ depende: [{ nivel: 'dono', motivo: 'emenda 7 aguardando', acoes: [acaoP('aprovar', '/gabarito-mestre:emenda aprovar 7')] }, { nivel: 'dono', motivo: 'loop pausado', acoes: [] }] })
  const m = comPainel($, on, { estado: dep }, { local: 'acima' })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19)
  // GM-15 T29 (D-G1c): o topo tem a cara do E4: `◆ DEPENDE DE VOCÊ  N itens` (warning) e o item recuado, com o botão
  const tx = (await todosTextos(ui)).join('|')
  expect(tx).toContain('◆ DEPENDE DE VOCÊ  2 itens')
  expect(tx).toContain('  emenda 7 aguardando')
  expect(JSON.stringify(await ui.drawn())).toContain('"color":"warning"')
  await ui.press({ key: 'painel-acao' })
  expect(m.est.fills.map((f) => f.text)).toEqual(['/gabarito-mestre:emenda aprovar 7'])
  await ui.unmount()
})

// ---- botão ----
test('botao-fill-nunca-submit: o botão põe o comando no prompt (replace) e nunca envia', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const ui = await montarFaixa($)
  await ui.press({ key: 'painel-acao' })
  expect(m.est.fills).toHaveLength(1)
  expect(m.est.fills[0].text).toBe('/gabarito-mestre:liberar T2')
  expect(m.est.fills[0].mode).toBe('replace')
  expect(m.est.submits).toEqual([])
  expect(m.est.statuses.filter((s) => s !== undefined)).toEqual([])
  await ui.unmount()
})
test('botao-comando-node-com-raiz: `node <plugin>/…` vira `! node "<raiz>/…"`', async ($, on) => {
  sobreOMotor(on)
  const dev = estadoNovo({ depende: [{ nivel: 'dono', motivo: 'deploy devolvido ao dono', acoes: [acaoP('executar', 'node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-12')] }] })
  const m = comPainel($, on, { estado: dev }, { local: 'acima' })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19)
  await ui.press({ key: 'painel-acao' })
  expect(m.est.fills[0].text.startsWith('! node "')).toBe(true)
  expect(m.est.fills[0].text.endsWith('/gates/scripts/entrega.mjs" executar --entrega GM-12')).toBe(true)
  expect(m.est.submits).toEqual([])
  await ui.unmount()
})
test('fill-isfilled-false-status: prompt.fill recusado (diálogo) ⇒ status, sem toast e sem envio', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() }, { fillIsFilled: false })
  await arrancar(m)
  const toastsAntes = m.toasts.length
  const ui = await montarFaixa($)
  await ui.press({ key: 'painel-acao' })
  expect(m.est.statuses).toContain('gabarito: não consegui pôr o comando no prompt')
  expect(m.toasts.length).toBe(toastsAntes)
  expect(m.est.submits).toEqual([])
  await ui.unmount()
})

// ---- aviso do PAROU ----
const toastsParou = (m: ReturnType<typeof mundo>) => m.toasts.filter((t) => t.startsWith(PAROU_PREFIXO))
test('toast-notify-1x-em-3-refresh: o mesmo PAROU em 3 refresh ⇒ 1 toast e 1 notify, com o texto da tabela', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  for (let i = 0; i < 3; i++) { await m.clock.advance(PERIODO); await drena(m) }
  expect(toastsParou(m)).toEqual([TOAST_PAROU])
  expect(m.est.notifies).toEqual([TOAST_PAROU])
})
test('notify-isSent-false-sem-repetir: sem canal ⇒ 1 notify e 1 toast; o stdin seguinte leva `notificacao: {motivo}`', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() }, { notify: 'nao-enviou' })
  await arrancar(m)
  for (let i = 0; i < 3; i++) { await m.clock.advance(PERIODO); await drena(m) }
  expect(m.est.notifies).toHaveLength(1)
  expect(toastsParou(m)).toHaveLength(1)
  expect(m.est.painelStdins.at(-1).sessao.notificacao).toEqual({ motivo: 'no-channel' })
})
test('notify-rejeita: rejeição ⇒ {motivo:"falhou"}, 1 só vez', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() }, { notify: 'rejeita' })
  await arrancar(m)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.notifies).toHaveLength(1)
  expect(m.est.painelStdins.at(-1).sessao.notificacao).toEqual({ motivo: 'falhou' })
})
test('notificacao-vai-no-stdin: notify enviado ⇒ o refresh imediato leva `{ts}` ISO do relógio; antes dele, null', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  expect(m.est.painelStdins[0].sessao.notificacao).toBeNull()
  const ultimo = m.est.painelStdins.at(-1).sessao.notificacao
  expect(m.est.painelStdins.length).toBeGreaterThan(1)
  expect(typeof ultimo?.ts).toBe('string')
  expect(new Date(ultimo.ts).toISOString()).toBe(ultimo.ts)
  expect(m.store.get('painel:notificado')).toEqual({ chave: 'GM-12|parar:s1:7', resultado: { ts: ultimo.ts } })
})
test('store-falha-notify-1x: store.set negado + 3 refresh ⇒ 1 toast e 1 notify (a memória segura)', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() }, { storeSetFalha: true })
  await arrancar(m)
  for (let i = 0; i < 3; i++) { await m.clock.advance(PERIODO); await drena(m) }
  expect(toastsParou(m)).toHaveLength(1)
  expect(m.est.notifies).toHaveLength(1)
})
test('store-antes-do-notify: `store.set` do painel precede o notify', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() })
  await arrancar(m)
  const ordem = m.est.ordem.filter((x) => x.startsWith('store.set:painel:notificado') || x === 'notify' || x === 'toast')
  expect(ordem.indexOf('store.set:painel:notificado')).toBeGreaterThanOrEqual(0)
  expect(ordem.indexOf('store.set:painel:notificado')).toBeLessThan(ordem.indexOf('notify'))
})
test('chave-com-id-da-entrega: o store tem a mesma chave do núcleo de OUTRA entrega ⇒ esta notifica; gravado `<id>|<chave>`', async ($, on) => {
  const m = comPainel($, on, { estado: pararP('computado:diario_invalido') }, { storeInicial: { 'painel:notificado': { chave: 'GM-99|computado:diario_invalido', resultado: null } } })
  await arrancar(m)
  expect(m.est.notifies).toHaveLength(1)
  expect((m.store.get('painel:notificado') as any).chave).toBe('GM-12|computado:diario_invalido')
})
test('mesma-chave-no-store: outra janela já avisou ⇒ nada (1 janela, 1 aviso por chave)', async ($, on) => {
  const m = comPainel($, on, { estado: pararP() }, { storeInicial: { 'painel:notificado': { chave: 'GM-12|parar:s1:7', resultado: { ts: '2026-11-09T17:00:00.000Z' } } } })
  await arrancar(m)
  expect(m.est.notifies).toHaveLength(0)
  expect(toastsParou(m)).toHaveLength(0)
  expect(m.est.painelStdins.at(-1).sessao.notificacao).toEqual({ ts: '2026-11-09T17:00:00.000Z' })
})
test('parar-volta-com-outra-chave: liberado apaga a marca; novo PAROU com outra chave avisa de novo', async ($, on) => {
  const m = comPainel($, on, { estado: pararP('parar:s1:7') })
  await arrancar(m)
  expect(m.est.notifies).toHaveLength(1)
  m.est.painel.estado = estadoPainel()
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.store.has('painel:notificado')).toBe(false)
  m.est.painel.estado = pararP('parar:s1:9')
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.notifies).toHaveLength(2)
  expect(toastsParou(m)).toHaveLength(2)
  expect((m.store.get('painel:notificado') as any).chave).toBe('GM-12|parar:s1:9')
})
test('sem-parar-sem-aviso: sem PAROU ⇒ 0 toast, 0 notify, store limpo', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { 'painel:notificado': { chave: 'GM-12|velha', resultado: null } } })
  await arrancar(m)
  expect(m.est.notifies).toHaveLength(0)
  expect(m.store.has('painel:notificado')).toBe(false)
})

// ---- o stdin ----
test('x-e-limites-no-stdin (P15): percent, window, tokens, h5, d7 e x chegam ao CLI; rateLimits sem five_hour ⇒ h5 null', async ($, on) => {
  const m = comPainel($, on, {}, { x: '35', rateLimits: [{ kind: 'seven_day', percentUsed: 9 }], percent: 37 })
  await arrancar(m)
  const s = m.est.painelStdins[0].sessao
  expect(s.percent).toBe(37)
  expect(s.window).toBe(1_000_000)
  expect(s.tokens).toBe(1)
  expect(s.d7).toBe(9)
  expect(s.h5).toBeNull()
  expect(s.x).toBe(35)
  expect(Object.keys(s).sort()).toEqual(['d7', 'h5', 'notificacao', 'pacote', 'percent', 'tokens', 'window', 'x'])
  m.est.rateLimits = [{ kind: 'five_hour', percentUsed: 11 }, { kind: 'seven_day', percentUsed: 64 }]
  await m.turno(); await drena(m)
  expect(m.est.painelStdins.at(-1).sessao.h5).toBe(11)
  expect(m.est.painelStdins.at(-1).sessao.d7).toBe(64)
})
test('x-padrao-50: sem GABARITO_POUSO_X o stdin leva 50', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  expect(m.est.painelStdins[0].sessao.x).toBe(50)
})
test('agent-list-falha-agentes-null: lista que falha ou não é lista ⇒ `agentes: null`; lista vazia ⇒ []; vivos com campos', async ($, on) => {
  const falha = comPainel($, on, {}, { agentes: 'falha' })
  await arrancar(falha)
  expect(falha.est.painelStdins[0].agentes).toBeNull()
})
test('agent-list-lixo-agentes-null: valor que não é lista ⇒ null', async ($, on) => {
  const m = comPainel($, on, {}, { agentes: 'lixo' })
  await arrancar(m)
  expect(m.est.painelStdins[0].agentes).toBeNull()
})
test('agent-list-vivos-no-stdin: cada agente com id, type, description, status e transcript null (T11 preenche)', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [{ id: 'a1', type: 'implementador', description: 'T2 implementador', status: 'running' }] })
  await arrancar(m)
  expect(m.est.painelStdins[0].agentes).toEqual([{ id: 'a1', type: 'implementador', description: 'T2 implementador', status: 'running', transcript: null }])
})
test('usage-falha-nao-derruba: usage lançando ⇒ percent/tokens/window null e a ponte roda', async ($, on) => {
  const m = comPainel($, on, {}, { usageFalha: true })
  await arrancar(m)
  expect(m.est.painelStdins[0].sessao.percent).toBeNull()
  expect(m.est.painelStdins[0].sessao.window).toBeNull()
})

// ======================================================================================================================================
// ---- painel (E4, T11): comando, sorteio de nomes e transcripts. Mutações: task-11-mut.json ----
// ======================================================================================================================================
const USO_ESPERADO = [
  'Uso: o painel abre sozinho ao lado, em terminal largo, quando uma entrega',
  'começa.',
  '/gabarito painel            abre ou traz de volta; volta a abrir sozinho',
  '/gabarito painel esquadrao  detalhado: plano, equipe (contexto e tokens',
  '                            de cada agente) e histórico',
  '/gabarito painel executivo  resumido: só o essencial da entrega',
  '/gabarito painel color      com cores  (ou: mono, sem cores)',
  '/gabarito painel narracao on|off   liga ou desliga a narração',
  '/gabarito painel nomes      lista os pacotes de nomes; <pacote> troca',
  '/gabarito painel nomes sortear     volta a sortear os nomes da equipe',
  '/gabarito painel lateral    painel ao lado  (ou: acima, acima da conversa)',
  '/gabarito painel ocultar    esconde o painel; PAROU e perguntas ficam',
  '/gabarito painel mostrar    traz o painel de volta',
  '/gabarito painel depende    mostra todos os itens que dependem de você (ou só 5)', // GM-15 T35 (r.8)
  '/gabarito painel ligar      volta a abrir sozinho',
  '/gabarito painel desligar   fecha e não abre sozinho; só o aviso de PAROU',
  '                            continua',
  '/gabarito chat cru|natural  linhas de ferramenta cruas ou em linguagem natural',
  '/gabarito pausar            para o trabalho automático da entrega',
  '/gabarito retomar           continua de onde parou',
].join('\n')
const FABRICA = ['galaxia', 'herois', 'hogwarts', 'terra-media']
const PREFS_STORE = 'painel:prefs'
const PACOTE_STORE = 'painel:pacote'
const TRANSCRIPTS_STORE = 'painel:transcripts'
const stdinsPainel = (m: ReturnType<typeof mundo>) => m.est.painelStdins
const ultimoStdin = (m: ReturnType<typeof mundo>) => m.est.painelStdins[m.est.painelStdins.length - 1]
const setsDe = (m: ReturnType<typeof mundo>, chave: string) => m.est.ordem.filter((o) => o === `store.set:${chave}`).length
const novaSessao = async (m: ReturnType<typeof mundo>, id: string) => { m.est.sessaoId = id; await m.inicio(); await drena(m) }
const subStart = ($: any, extra: Record<string, unknown> = {}) =>
  $.classic.SubagentStart({ agent_id: 'ag-1', agent_type: 'general-purpose', session_id: 'abc-123', transcript_path: '/h/proj/abc-123.jsonl', ...extra })
const textoDaPane = async ($: any, cols = 80) => { const ui = await montarPane($, cols); const t = JSON.stringify(await ui.drawn()); await ui.unmount(); return t }

// ---- /gabarito: respostas e efeitos ----
test('comando-registro: description e argumentHint novos', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  const r = m.est.registros.find((x: any) => x.name === 'gabarito')
  expect(r.description).toBe('Painel, pausa e retomada do loop')
  expect(r.argumentHint).toBe('painel …|pausar|retomar')
})
test('comando-uso: vazio, desconhecido e painel malformado devolvem a ajuda exata', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  for (const a of ['', 'x', 'painel foo', 'painel nomes a b', 'painel narracao talvez', 'painel esquadrao extra', 'painel narracao on off', '   ']) {
    expect((await m.cmd(a)).text).toBe(USO_ESPERADO)
  }
})
test('painel-abre-com-focus: `/gabarito painel` abre com focus e responde `painel aberto`', async ($, on) => {
  const m = comPainel($, on, {}, { interativo: true })
  await arrancar(m)
  m.est.opens.length = 0
  const r = await m.cmd('painel')
  expect(r.text).toBe('painel aberto')
  expect(m.est.opens).toHaveLength(1)
  expect(m.est.opens[0].id).toBe(ID_PAINEL)
  expect(m.est.opens[0].focus).toBe(true)
})
test('painel-nao-coube: isPlaced false ⇒ o motivo na resposta', async ($, on) => {
  const m = comPainel($, on, {}, { openResult: { isPlaced: false, reason: 'terminal estreito' } })
  await arrancar(m)
  expect((await m.cmd('painel')).text).toBe('painel não coube: terminal estreito')
})
test('comando-troca-a-quente-sem-reabrir: preset, tema e narração redesenham a Pane montada, sem ui.open e sem ponte; prefs gravadas', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const ui = await montarPane($, 80)
  const base = JSON.stringify(await ui.drawn())
  expect(base).toContain('esperando o loop')
  expect(base).toContain('"color"')
  const opens = m.est.opens.length, pontes = stdinsPainel(m).length
  expect((await m.cmd('painel executivo')).text).toBe('painel: executivo')
  const exec = JSON.stringify(await ui.drawn())
  expect(exec).not.toBe(base)
  expect(await m.store.get(PREFS_STORE)).toEqual({ preset: 'executivo', tema: 'color', narracao: true, ligado: true, pacote: null })
  expect((await m.cmd('painel esquadrao')).text).toBe('painel: esquadrao')
  expect((await m.cmd('painel mono')).text).toBe('painel: mono')
  const mono = JSON.stringify(await ui.drawn())
  expect(mono).not.toContain('"color"')
  expect((await m.cmd('painel color')).text).toBe('painel: color')
  expect(JSON.stringify(await ui.drawn())).toContain('"color"')
  expect((await m.cmd('painel narracao off')).text).toBe('painel: narração desligada')
  expect(JSON.stringify(await ui.drawn())).not.toContain('esperando o loop')
  expect((await m.cmd('painel narracao on')).text).toBe('painel: narração ligada')
  expect(JSON.stringify(await ui.drawn())).toContain('esperando o loop')
  expect(m.est.opens.length).toBe(opens)
  expect(stdinsPainel(m).length).toBe(pontes)
  await ui.unmount()
})
test('comando-preset-sem-ponte: com a Pane aberta, `painel executivo` = 0 ui.open e 0 process.run do painel', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const opens = m.est.opens.length, pontes = stdinsPainel(m).length
  await m.cmd('painel executivo'); await drena(m)
  expect(m.est.opens.length).toBe(opens)
  expect(stdinsPainel(m).length).toBe(pontes)
})
test('comando-pacote-invalido-uma-linha-de-erro: fora do padrão ⇒ erro, prefs intactas, sem ponte', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const pontes = stdinsPainel(m).length
  for (const p of ['../../etc', 'MAIUSCULA', 'a'.repeat(33), 'x_y']) {
    const t = (await m.cmd(`painel nomes ${p}`)).text
    expect(t.startsWith('pacote inválido: ')).toBe(true)
    expect(t.endsWith('(fábrica: galaxia herois hogwarts terra-media)')).toBe(true)
    expect(t.includes('\n')).toBe(false)
  }
  await drena(m)
  expect(m.store.has(PREFS_STORE)).toBe(false)
  expect(stdinsPainel(m).length).toBe(pontes)
})
test('comando-nomes-dispara-ponte: pacote de fábrica ⇒ 1 process.run com sessao.pacote, prefs gravadas', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const antes = stdinsPainel(m).length
  expect((await m.cmd('painel nomes herois')).text).toBe('painel: nomes herois')
  await drena(m)
  expect(stdinsPainel(m).length).toBe(antes + 1)
  expect(ultimoStdin(m).sessao.pacote).toBe('herois')
  expect((await m.store.get(PREFS_STORE) as any).pacote).toBe('herois')
})
test('comando-nomes-proprio: existe em .harness/temas/nomes ⇒ aceito; inexistente ⇒ não encontrado e nada muda', async ($, on) => {
  const m = comPainel($, on, {}, { arquivos: ['/main/.harness/temas/nomes/meu-time.json'] })
  await arrancar(m)
  const antes = stdinsPainel(m).length
  expect((await m.cmd('painel nomes meu-time')).text).toBe('painel: nomes meu-time')
  await drena(m)
  expect(ultimoStdin(m).sessao.pacote).toBe('meu-time')
  const depois = stdinsPainel(m).length
  expect(depois).toBe(antes + 1)
  expect((await m.cmd('painel nomes fantasma')).text).toBe('pacote não encontrado: fantasma')
  await drena(m)
  expect(stdinsPainel(m).length).toBe(depois)
  expect((await m.store.get(PREFS_STORE) as any).pacote).toBe('meu-time')
})
test('comando-nomes-fs-falha-nao-vira-existe: fs.exists falhando ⇒ não consegui verificar, prefs intactas', async ($, on) => {
  const m = comPainel($, on, {}, { existsPacoteFalha: true })
  await arrancar(m)
  expect((await m.cmd('painel nomes meu')).text).toBe('não consegui verificar o pacote: meu')
  expect(m.store.has(PREFS_STORE)).toBe(false)
})
// ---- GM-15 T22 (REQ-HIG-1): `nomes` sem pacote lista; `nomes sortear` volta ao sorteio; `sortear` é reservado ----
const comRepo = ($: any, on: any, pacotesRepo: string[] | 'falha', extra: Opc = {}) => comPainel($, on, {}, { pacotesRepo, arquivos: ['/main/.harness/temas/nomes/meu-time.json'], ...extra })
test('nomes-sem-pacote-lista: fábrica + 1 do repo numa linha, o atual (fixo) marcado, sem a ajuda e sem gravar nada', async ($, on) => {
  const m = comRepo($, on, ['meu-time'])
  await arrancar(m)
  await m.cmd('painel nomes herois')
  const gravadas = setsDe(m, PREFS_STORE)
  const t = (await m.cmd('painel nomes')).text
  expect(t).not.toBe(USO_ESPERADO)
  expect(t).toBe('painel nomes: galaxia, herois (atual), hogwarts, terra-media, meu-time · botão ou /gabarito painel nomes <pacote> | sortear')
  expect(setsDe(m, PREFS_STORE)).toBe(gravadas)
})
test('nomes-lista-marca-sorteado: sem pacote escolhido, o da sessão sai como "sorteado nesta sessão"', async ($, on) => {
  const m = comRepo($, on, [])
  await arrancar(m)
  const sorteado = ((await m.store.get(PACOTE_STORE)) as any).nome as string
  expect(FABRICA).toContain(sorteado)
  const t = (await m.cmd('painel nomes')).text
  expect(t.match(/\(atual\)|\(sorteado nesta sessão\)/g)).toEqual(['(sorteado nesta sessão)'])
  expect(t).toContain(`${sorteado} (sorteado nesta sessão)`)
})
test('nomes-lista-repo-ilegivel: a ponte falha ⇒ só os de fábrica, dizendo que não leu os do repo', async ($, on) => {
  const m = comRepo($, on, 'falha')
  await arrancar(m)
  const t = (await m.cmd('painel nomes')).text
  expect(t).toContain('galaxia')
  expect(t).not.toContain('meu-time')
  expect(t).toContain('não li os do repo')
})
test('nomes-lista-botoes: 1 botão por pacote põe `/gabarito painel nomes <p>` no input (replace); o botão some depois do comando', async ($, on) => {
  sobreOMotor(on)
  const m = comRepo($, on, ['meu-time'], { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel nomes')
  const ui = await montarFaixaH($, 50, 19)
  for (const k of ['painel-acao', 'painel-acao-2', 'painel-acao-3', 'painel-acao-4', 'painel-acao-5']) await ui.press({ key: k })
  expect(m.est.fills.map((f) => [f.text, f.mode])).toEqual(['galaxia', 'herois', 'hogwarts', 'terra-media', 'meu-time'].map((p) => [`/gabarito painel nomes ${p}`, 'replace']))
  await m.cmd('painel nomes herois')
  await ui.unmount()
  const ui2 = await montarFaixaH($, 50, 19)
  expect(await ui2.findAll({ type: 'Button' })).toHaveLength(0)
  await ui2.unmount()
})
const comRepoE = ($: any, on: any, estado: any, pacotesRepo: string[], extra: Opc = {}) => comPainel($, on, { estado }, { pacotesRepo, arquivos: ['/main/.harness/temas/nomes/meu-time.json'], ...extra })
const rotulosDe = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)
test('nomes-nao-esconde-parou: painel desligado + PAROU + `painel nomes` ⇒ a faixa traz PAROU, o botão aprovar e os de pacote (MAJOR-1)', async ($, on) => {
  sobreOMotor(on)
  const m = comRepoE($, on, pararP(), [], { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel desligar')
  await m.cmd('painel nomes')
  const ui = await montarFaixaH($, 50, 19)
  expect(JSON.stringify(await ui.drawn())).toContain('PAROU')
  const r = await rotulosDe(ui)
  expect(r).toContain('aprovar')
  expect(r).toContain('galaxia')
  await ui.unmount()
})
test('nomes-nao-esconde-parou-faixa-ligada: faixa ligada + PAROU + `painel nomes` ⇒ aprovar e pacotes juntos (MAJOR-1)', async ($, on) => {
  sobreOMotor(on)
  const m = comRepoE($, on, pararP(), [], { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel nomes')
  const ui = await montarFaixaH($, 50, 19)
  const r = await rotulosDe(ui)
  expect(r).toContain('aprovar')
  expect(r).toContain('galaxia')
  await ui.unmount()
})
test('nomes-some-em-qualquer-comando: `painel nomes` + `pausar` ⇒ sem botão de pacote (MAJOR-2)', async ($, on) => {
  sobreOMotor(on)
  const m = comRepoE($, on, pararP(), [], { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel nomes')
  await m.cmd('pausar')
  const ui = await montarFaixaH($, 50, 19)
  expect(await rotulosDe(ui)).not.toContain('galaxia')
  await ui.unmount()
})
const comNomesNaTela = async ($: any, on: any) => {
  sobreOMotor(on)
  const m = comRepoE($, on, pararP(), [], { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel nomes')
  return m
}
const aindaTemBotao = async ($: any) => { const ui = await montarFaixaH($, 50, 19); const r = await rotulosDe(ui); await ui.unmount(); return r.includes('galaxia') }
test('prompt-do-dono-limpa-botoes-de-nomes: mensagem do dono no composer, sem command ⇒ os botões somem', async ($, on) => {
  await comNomesNaTela($, on)
  expect(await aindaTemBotao($)).toBe(true)
  await $.prompt.submit({ text: 'oi', origin: { kind: 'composer' }, command: null, isMeta: false })
  expect(await aindaTemBotao($)).toBe(false)
})
test('prompt-de-peer-ou-bridge-nao-limpa: peer e bridge não apagam os botões', async ($, on) => {
  await comNomesNaTela($, on)
  await $.prompt.submit({ text: '<agent-message>x', origin: { kind: 'peer' } })
  await $.prompt.submit({ text: 'via bridge', origin: { kind: 'bridge' }, command: null })
  expect(await aindaTemBotao($)).toBe(true)
})
test('nomes-digitado-mantem-botoes: command.run de `painel nomes` + prompt.submit do mesmo slash (command preenchido, composer) ⇒ os botões ficam', async ($, on) => {
  await comNomesNaTela($, on)
  await $.prompt.submit({ text: '/gabarito painel nomes', origin: { kind: 'composer' }, command: { name: 'gabarito', args: 'painel nomes' } })
  expect(await aindaTemBotao($)).toBe(true)
  await $.prompt.submit({ text: 'meta', origin: { kind: 'composer' }, command: null, isMeta: true })
  expect(await aindaTemBotao($)).toBe(true)
})
test('botoes-com-nomes-orcamento-desconta-o-topo: topo + nomes que só cabem se o topo não contasse ⇒ vira +N e a linha respeita o mínimo de texto', () => {
  const topo = [{ rotulo: 'aprovar', comando: '/x' }]
  const nomes = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'].map((n) => ({ rotulo: n, comando: n }))
  const r = botoesComNomes(topo, nomes, 80)
  expect(r.some((b: any) => /^\+\d/.test(b.rotulo))).toBe(true)
  expect(colunasDosBotoes(r) + 24 + 3).toBeLessThanOrEqual(80)
})
test('nomes-botoes-cabem-na-largura: 4 de fábrica + 5 do repo de 17 col ⇒ a linha única ≤ 80 col, com o resto indicado (MAJOR-3)', async ($, on) => {
  sobreOMotor(on)
  const longos = ['aaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaa2', 'aaaaaaaaaaaaaaaa3', 'aaaaaaaaaaaaaaaa4', 'aaaaaaaaaaaaaaaa5']
  const m = comRepoE($, on, pararP(), longos, { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel desligar')
  await m.cmd('painel nomes')
  const ui = await montarFaixaH($, 50, 19, { bodyColumns: 80 })
  const arv = JSON.stringify(await ui.drawn())
  const rot = await rotulosDe(ui)
  const texto = (arv.match(/"children":"([^"]*)"/g) ?? []).map((s) => s.slice(12, -1))
  const cols = rot.reduce((n: number, l: string) => n + 1 + [...l].length + 4, 0) + [...(texto[0] ?? '')].length
  expect(cols).toBeLessThanOrEqual(80)
  expect(rot.some((l: string) => /^\+\d/.test(l))).toBe(true)
  await ui.unmount()
})
test('nomes-botoes-na-pane-lateral-e-sem-topo: Pane lateral e estado sem linha de topo também mostram os botões (MINOR-2)', async ($, on) => {
  sobreOMotor(on)
  const m = comRepoE($, on, pararP(), [], { local: 'lateral', panes: PANE_VISIVEL })
  await arrancar(m)
  await m.cmd('painel nomes')
  const ui = await montarPane($, 100)
  expect(await rotulosDe(ui)).toContain('galaxia')
  await ui.unmount()
})
test('nomes-botoes-sem-topo: estado sem linha de topo ⇒ a faixa ainda mostra os botões de pacote (MINOR-2)', async ($, on) => {
  sobreOMotor(on)
  const m = comRepoE($, on, null, [], { local: 'acima' })
  await arrancar(m)
  await m.cmd('painel nomes')
  const ui = await montarFaixaH($, 50, 19)
  expect(await rotulosDe(ui)).toContain('galaxia')
  await ui.unmount()
})
test('nomes-sortear-volta-ao-sorteio: grava pacote null, sorteia outro na hora, guarda no store e manda à ponte', async ($, on) => {
  const m = comRepo($, on, [])
  await arrancar(m)
  await m.cmd('painel nomes herois')
  await drena(m)
  expect(((await m.store.get(PREFS_STORE)) as any).pacote).toBe('herois')
  const antes = ((await m.store.get(PACOTE_STORE)) as any).nome as string
  const t = (await m.cmd('painel nomes sortear')).text
  await drena(m)
  expect((await m.store.get(PREFS_STORE) as any).pacote).toBeNull()
  const depois = ((await m.store.get(PACOTE_STORE)) as any).nome as string
  expect(FABRICA).toContain(depois)
  expect(depois).not.toBe(antes)
  expect(t).toBe(`painel: nomes sorteados: ${depois}`)
  expect(ultimoStdin(m).sessao.pacote).toBe(depois)
})
test('sortear-recusado-como-pacote: `sortear` nunca vira pacote, nem com arquivo no repo, e fica fora da lista', async ($, on) => {
  const m = comRepo($, on, ['sortear', 'meu-time'], { arquivos: ['/main/.harness/temas/nomes/sortear.json', '/main/.harness/temas/nomes/meu-time.json'] })
  await arrancar(m)
  await m.cmd('painel nomes sortear')
  expect(((await m.store.get(PREFS_STORE)) as any).pacote).toBeNull()
  const t = (await m.cmd('painel nomes')).text
  expect(t).toMatch(/terra-media[^,]*, meu-time ·/)
  expect(t).not.toContain('sortear,')
})
test('sortear-nas-prefs-vira-padrao: `pacote: "sortear"` gravado à mão não vale como pacote (o sorteio da sessão manda)', async ($, on) => {
  const m = comRepo($, on, [])
  m.store.set(PREFS_STORE, { preset: 'esquadrao', tema: 'color', narracao: true, ligado: true, pacote: 'sortear' })
  await arrancar(m)
  expect((await m.cmd('painel nomes')).text).not.toContain('(atual)')
  expect(m.est.contextos.length === 0 || m.est.contextos.every((c: any) => c.pacote !== 'sortear')).toBe(true)
})
test('comando-desligar-ligar: desligar fecha, grava ligado:false e não cancela o relógio; ligar reabre com focus', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  expect((await m.cmd('painel desligar')).text).toBe('painel desligado (PAROU ainda avisa)')
  expect(m.est.closes).toEqual([ID_PAINEL])
  expect((await m.store.get(PREFS_STORE) as any).ligado).toBe(false)
  const n = stdinsPainel(m).length
  await m.clock.advance(PERIODO); await drena(m)
  expect(stdinsPainel(m).length).toBe(n + 1)
  m.est.opens.length = 0
  expect((await m.cmd('painel ligar')).text).toBe('painel ligado')
  expect(m.est.opens).toHaveLength(1)
  expect(m.est.opens[0].focus).toBe(true)
  expect((await m.store.get(PREFS_STORE) as any).ligado).toBe(true)
})
test('desligar-parou-ainda-avisa: painel desligado + PAROU ⇒ Pane não reabre, toast e notify 1×, faixa PAROU', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on)
  await arrancar(m)
  await m.cmd('painel desligar')
  m.est.opens.length = 0
  m.est.painel.estado = pararP()
  await m.clock.advance(PERIODO); await drena(m)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.opens).toHaveLength(0)
  expect(m.toasts.filter((t) => t.startsWith(PAROU_PREFIXO))).toEqual([TOAST_PAROU])
  expect(m.est.notifies).toEqual([TOAST_PAROU])
  const faixa = await montarFaixa($)
  expect(JSON.stringify(await faixa.drawn())).toContain('PAROU')
  await faixa.unmount()
})
test('desligar-sem-parou-faixa-some: desligado e sem PAROU, a faixa cede ao motor', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on)
  await arrancar(m)
  m.est.panes = []
  await m.cmd('painel desligar')
  const faixa = await montarFaixa($)
  expect((await todosTextos(faixa)).join('|')).toBe('motor')
  await faixa.unmount()
})
test('comando-store-nega-vale-na-sessao: store.set rejeita ⇒ a troca vale e a resposta avisa que não gravou', async ($, on) => {
  const m = comPainel($, on, {}, { storeSetFalha: true })
  await arrancar(m)
  const ui = await montarPane($, 80)
  const t = (await m.cmd('painel narracao off')).text
  expect(t).toBe('painel: narração desligada (só nesta sessão: não gravei a preferência)')
  expect(JSON.stringify(await ui.drawn())).not.toContain('esperando o loop')
  expect((await m.cmd('painel mono')).text).toBe('painel: mono (só nesta sessão: não gravei a preferência)')
  await ui.unmount()
})
test('comando-resposta-uma-linha: todas as variantes (menos a ajuda), inclusive erro e store negando, sem \\n e ≤ 200 colunas', async ($, on) => {
  const m = comPainel($, on, {}, { openResult: { isPlaced: false, reason: 'linha 1\nlinha 2\r\n' + 'z'.repeat(400) }, storeSetFalha: true, arquivos: [] })
  await arrancar(m)
  const args = ['', 'x', 'pausar', 'retomar', 'painel', 'painel esquadrao', 'painel executivo', 'painel color', 'painel mono', 'painel narracao on', 'painel narracao off', 'painel nomes herois', 'painel depende', 'painel nomes ../x', 'painel nomes zzz', 'painel ligar', 'painel desligar', 'painel \x1b[2J', 'painel nomes \x1b[2Jabc', 'painel\nnomes\nherois']
  for (const a of args) {
    const t = (await m.cmd(a)).text
    expect(typeof t).toBe('string')
    if (t === USO_ESPERADO) { // a ajuda é a única resposta de várias linhas: cada linha ≤ 80 colunas
      for (const l of t.split('\n')) expect([...l].length).toBeLessThanOrEqual(80)
      continue
    }
    expect(/[\n\r\x1b\u2028\u2029]/.test(t)).toBe(false)
    expect([...t].length).toBeLessThanOrEqual(200)
  }
})
test('pausar-retomar-inalterado: o texto de pausar/retomar não passou pelo painel', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  const p = await m.cmd('pausar')
  expect(p.text).not.toBe(USO_ESPERADO)
  expect(p.text.startsWith('painel')).toBe(false)
  const r = await m.cmd('  retomar  ')
  expect(r.text).not.toBe(USO_ESPERADO)
})

// ---- prefs ----
test('store-ausente-x-corrompido: prefs ausentes ⇒ padrão sem aviso; prefs não objeto ⇒ padrão e 1 aviso por processo', async ($, on) => {
  const a = comPainel($, on)
  await arrancar(a)
  expect(a.est.logs.filter((l) => l.includes('preferências'))).toHaveLength(0)
  expect(await textoDaPane($)).toContain('esperando o loop')
})
test('prefs-corrompidas-aviso-1x: prefs = 7 ⇒ padrão e 1 ui.log mesmo com 2 starts', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: 7 } })
  await arrancar(m)
  await arrancar(m)
  expect(m.est.logs.filter((l) => l.includes('preferências do painel estavam corrompidas'))).toHaveLength(1)
  expect(await textoDaPane($)).toContain('"color"')
})
test('prefs-campo-invalido-so-ele: preset inválido volta ao padrão e tema mono vale', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { preset: 'xx', tema: 'mono' } } })
  await arrancar(m)
  const t = await textoDaPane($)
  expect(t).not.toContain('"color"')
  expect(t).toContain('esperando o loop')
})
test('prefs-campo-invalido-igual-ao-so-tema: {preset inválido, tema mono} desenha igual a {tema mono}', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { tema: 'mono' } } })
  await arrancar(m)
  const ref = await textoDaPane($)
  expect(ref).toContain('esperando o loop')
  expect(ref).not.toContain('"color"')
})
test('prefs-preset: executivo vindo do store muda o desenho (sem narrativa do Esquadrão)', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { preset: 'executivo' } } })
  await arrancar(m)
  expect(await textoDaPane($)).not.toContain('esperando o loop')
})
test('prefs-narracao: narracao false vinda do store tira a narrativa', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { narracao: false } } })
  await arrancar(m)
  expect(await textoDaPane($)).not.toContain('esperando o loop')
})
test('prefs-ligado: ligado false vindo do store ⇒ nenhuma abertura', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { ligado: false } } })
  await arrancar(m)
  expect(m.est.opens).toHaveLength(0)
})
test('prefs-pacote: pacote vindo do store vai no stdin', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { pacote: 'hogwarts' } } })
  await arrancar(m)
  expect(ultimoStdin(m).sessao.pacote).toBe('hogwarts')
})

// ---- sorteio ----
test('sorteio-grava-nome-e-sessao: 1ª sessão sorteia um de fábrica e grava {nome, sessao}', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const v = (await m.store.get(PACOTE_STORE)) as any
  expect(FABRICA).toContain(v.nome)
  expect(v.sessao).toBe('sess-1')
  expect(ultimoStdin(m).sessao.pacote).toBe(v.nome)
})
test('sorteio-sem-repetir-entre-sessoes: cada sessão nova sorteia um pacote diferente do anterior', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  let anterior = ((await m.store.get(PACOTE_STORE)) as any).nome
  for (const id of ['s-b', 's-c', 's-d', 's-e', 's-f', 's-g']) {
    await novaSessao(m, id)
    const v = (await m.store.get(PACOTE_STORE)) as any
    expect(v.sessao).toBe(id)
    expect(FABRICA).toContain(v.nome)
    expect(v.nome).not.toBe(anterior)
    expect(ultimoStdin(m).sessao.pacote).toBe(v.nome)
    anterior = v.nome
  }
})
test('sorteio-mesma-sessao-mantem: session.start repetido na mesma sessão mantém o pacote e não regrava', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PACOTE_STORE]: { nome: 'galaxia', sessao: 'sess-1' } } })
  await arrancar(m)
  await arrancar(m)
  expect(((await m.store.get(PACOTE_STORE)) as any)).toEqual({ nome: 'galaxia', sessao: 'sess-1' })
  expect(setsDe(m, PACOTE_STORE)).toBe(0)
  expect(ultimoStdin(m).sessao.pacote).toBe('galaxia')
})
test('sorteio-mesma-sessao-mantem-sorteado: 2 starts da mesma sessão ⇒ o mesmo nome e 1 gravação', async ($, on) => {
  const n = comPainel($, on)
  await arrancar(n)
  const nome = ((await n.store.get(PACOTE_STORE)) as any).nome
  await arrancar(n)
  expect(((await n.store.get(PACOTE_STORE)) as any).nome).toBe(nome)
  expect(setsDe(n, PACOTE_STORE)).toBe(1)
})
test('pacote-legado-string-vira-anterior: string no store é o anterior; o novo difere e vai em {nome, sessao}', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PACOTE_STORE]: 'herois' } })
  await arrancar(m)
  const v = (await m.store.get(PACOTE_STORE)) as any
  expect(v.nome).not.toBe('herois')
  expect(FABRICA).toContain(v.nome)
  expect(v.sessao).toBe('sess-1')
  expect(m.est.logs.filter((l) => l.includes('corrompido'))).toHaveLength(0)
})
test('pacote-corrompido-sorteia-e-avisa-1x: valor que não é objeto nem string ⇒ sorteia, grava, 1 ui.log', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PACOTE_STORE]: 42 } })
  await arrancar(m)
  const v = (await m.store.get(PACOTE_STORE)) as any
  expect(FABRICA).toContain(v.nome)
  expect(v.sessao).toBe('sess-1')
  expect(m.est.logs.filter((l) => l.includes('pacote de nomes do painel estava corrompido'))).toHaveLength(1)
})
test('prefs-pacote-vence-sorteio: com prefs.pacote, nada é sorteado nem gravado', async ($, on) => {
  const m = comPainel($, on, {}, { storeInicial: { [PREFS_STORE]: { pacote: 'herois' } } })
  await arrancar(m)
  expect(ultimoStdin(m).sessao.pacote).toBe('herois')
  expect(setsDe(m, PACOTE_STORE)).toBe(0)
  expect(m.store.has(PACOTE_STORE)).toBe(false)
})
test('sorteio-id-lanca: session.id falhando ⇒ terra-media, sem gravar', async ($, on) => {
  const m = comPainel($, on, {}, { sessaoIdFalha: true })
  await arrancar(m)
  expect(ultimoStdin(m).sessao.pacote).toBe('terra-media')
  expect(m.store.has(PACOTE_STORE)).toBe(false)
})

// ---- transcripts dos agentes ----
test('subagent-start-grava-caminho: transcript do agente = <dirname>/<session_id>/subagents/agent-<id>.jsonl', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await subStart($)
  expect(await m.store.get(TRANSCRIPTS_STORE)).toEqual({ 'ag-1': '/h/proj/abc-123/subagents/agent-ag-1.jsonl' })
})
test('vivos-vao-com-caminho: o vivo de agent.list leva o caminho no stdin; sem registro, null', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [{ id: 'ag-1', type: 't', description: 'T2 implementador', status: 'running' }, { id: 'ag-2', type: 't', description: 'T3', status: 'running' }] })
  await m.inicio()
  await subStart($)
  await drena(m)
  await m.turno(); await drena(m)
  const ag = ultimoStdin(m).agentes
  expect(ag.find((a: any) => a.id === 'ag-1').transcript).toBe('/h/proj/abc-123/subagents/agent-ag-1.jsonl')
  expect(ag.find((a: any) => a.id === 'ag-2').transcript).toBeNull()
})
test('subagent-start-id-invalido: agent_id ou session_id fora da forma ⇒ nenhuma entrada', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  for (const extra of [{ agent_id: '../../x' }, { agent_id: 'a/b' }, { agent_id: '' }, { agent_id: 'x'.repeat(129) }, { agent_id: 7 }, { session_id: '../s' }, { session_id: 'a.b' }, { session_id: '' }, { session_id: 's'.repeat(129) }, { session_id: undefined }]) {
    await subStart($, extra as any)
  }
  expect(m.store.has(TRANSCRIPTS_STORE)).toBe(false)
})
test('subagent-start-path-relativo: transcript_path ausente, não string ou relativo ⇒ nenhuma entrada', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  for (const tp of ['rel/x.jsonl', '', 'x.jsonl', undefined, 5, null]) await subStart($, { transcript_path: tp } as any)
  expect(m.store.has(TRANSCRIPTS_STORE)).toBe(false)
})
test('transcripts-teto-64: 70 inícios ⇒ 64 entradas; saem as 6 mais antigas', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  for (let i = 0; i < 70; i++) await subStart($, { agent_id: `ag-${i}` })
  const v = (await m.store.get(TRANSCRIPTS_STORE)) as Record<string, string>
  const chaves = Object.keys(v)
  expect(chaves).toHaveLength(64)
  for (let i = 0; i < 6; i++) expect(chaves).not.toContain(`ag-${i}`)
  expect(chaves[0]).toBe('ag-6')
  expect(chaves[63]).toBe('ag-69')
})
test('transcripts-preserva-o-que-ja-estava-no-store: entradas anteriores entram no mapa e no teto', async ($, on) => {
  const m = mundo($, on, { storeInicial: { [TRANSCRIPTS_STORE]: { velho: '/v/s/subagents/agent-velho.jsonl', '': 'x', ok: 5 } } })
  await m.inicio()
  await subStart($)
  expect(await m.store.get(TRANSCRIPTS_STORE)).toEqual({ velho: '/v/s/subagents/agent-velho.jsonl', 'ag-1': '/h/proj/abc-123/subagents/agent-ag-1.jsonl' })
})
test('subagent-start-store-falha-segue: store.set rejeitando ⇒ o hook não lança, repassa, e o vivo ainda leva o caminho', async ($, on) => {
  const m = comPainel($, on, {}, { storeSetFalha: true, agentesPainel: [{ id: 'ag-1', type: 't', description: 'd', status: 'running' }] })
  await m.inicio()
  const r = await subStart($)
  expect(r).toBeDefined()
  await drena(m)
  await m.turno(); await drena(m)
  expect(ultimoStdin(m).agentes[0].transcript).toBe('/h/proj/abc-123/subagents/agent-ag-1.jsonl')
})
test('subagent-start-repassa-next: o hook de baixo recebe o evento, válido ou não', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await subStart($)
  await subStart($, { agent_id: '../x' })
  expect(m.est.subStarts.map((x: any) => x.agent_id)).toEqual(['ag-1', '../x'])
  expect(Object.keys((await m.store.get(TRANSCRIPTS_STORE)) as object)).toEqual(['ag-1'])
})
test('comando-espacos-colapsados: espaços múltiplos e bordas valem como um só', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  expect((await m.cmd('  painel   nomes    herois  ')).text).toBe('painel: nomes herois')
  expect((await m.cmd('painel\tmono')).text).toBe('painel: mono')
})
test('comando-nao-painel-nao-toca-prefs: pausar e Uso não gravam prefs nem abrem Pane', async ($, on) => {
  const m = comPainel($, on)
  await arrancar(m)
  const opens = m.est.opens.length
  await m.cmd('x'); await m.cmd('')
  expect(m.store.has(PREFS_STORE)).toBe(false)
  expect(m.est.opens.length).toBe(opens)
})


// ---- T10 (GM-13): mensagem do dono, retomada e negação por pendência ----
const msgsDo = (m: ReturnType<typeof mundo>) => m.evs.filter((e) => e.tipo === 'dono.mensagem')
const PEDIDOS_DE = (m: ReturnType<typeof mundo>, op: string) => m.pedidos.filter((q) => q.op === op)
const TEXTO_PENDENCIA = /gabarito: aprendizado pendente: feche antes de despachar \(.*\)\. Feche com `loop\.mjs aprendizado <E\|A> D --regra <t> --entra-em <a> --gatilho <sessao:seq> --eventos <sessao:seq>`, `loop\.mjs aprendizado <E\|A> M --regra <t> --entra-em <a> --gatilho <sessao:seq>` ou `loop\.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>`\. Só o revisor passa\./
const PARAR_ABERTO = [...B_FEITA, EV(5, 'loop.parar', { motivo: 'teto_rodadas', task: 'b' })]

test('so-composer-grava: composer sem comando grava; peer, plugin, scheduled-trigger e composer com comando não', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  for (const origin of [{ kind: 'peer' }, { kind: 'plugin' }, { kind: 'scheduled-trigger' }, { kind: 'composer' }]) {
    await m.dono({ origin, command: origin.kind === 'composer' ? { name: 'loop' } : null })
  }
  await m.dono({ origin: { kind: 'composer' }, command: 'loop' })
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
  await m.dono()
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
  expect(msgsDo(m)[0]).toMatchObject({ sessao: 'dono', agente: 'dono', dados: { sha256: 'f'.repeat(64), chars: 'mensagem do dono'.length } })
})
test('peer-segue-contando: o hand-back de subagent continua somando em recebidos, e não grava', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.peer(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(0)
})
test('bridge-grava: origem bridge e command ausente (não só null) também são mensagem do dono', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await $.prompt.submit({ text: 'via bridge', origin: { kind: 'bridge' } })
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
  expect(msgsDo(m)[0].dados.chars).toBe('via bridge'.length)
})
test('origem-ausente-nao-grava', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await $.prompt.submit({ text: 'sem origem' })
  await $.prompt.submit({ text: 'origem sem kind', origin: {} })
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
})
test('texto-vazio-nao-grava: vazio, só espaço ou quebra e não-string', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  for (const text of ['', '   ', ' \n\t ']) await m.dono({ text }) // não-string: o runner nem deixa o `next` passar; coberto em pouso.test.ts
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(0)
})
test('mensagem-nunca-o-texto: o texto não aparece em nenhum evento do diário nem em aviso', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  const sentinela = 'SENTINELA-T10-4711'
  await m.dono({ text: `${sentinela} ghp_${'a'.repeat(30)}` })
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
  expect(JSON.stringify(m.evs)).not.toContain(sentinela)
  expect(JSON.stringify(m.grav)).not.toContain(sentinela)
  expect(m.toasts.join(' ')).not.toContain(sentinela)
})
test('sem-loop-nao-grava: sem plano.json nenhuma mensagem, nenhum aviso', async ($, on) => {
  const m = mundo($, on, { plano: false })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(0)
  expect(m.toasts).toHaveLength(0)
})
test('leitura-falha-nao-grava-e-avisa: loop sem confirmação ⇒ sem gravar, avisarLeitura', async ($, on) => {
  const m = mundo($, on, { existsPlanoFalha: true })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(0)
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop/)
})
test('mensagem-falha-avisa-uma-vez-e-o-prompt-segue: a ponte recusa; mesmo aviso não repete; o prompt nunca é bloqueado', async ($, on) => {
  const m = mundo($, on, { mensagemFalha: true })
  await m.inicio()
  const r1 = await m.dono(); await m.clock.settle()
  const r2 = await m.dono(); await m.clock.settle()
  expect(r1).toEqual({ text: 'mensagem do dono' })
  expect(r2).toEqual({ text: 'mensagem do dono' })
  const avisos = m.toasts.filter((t) => t.startsWith('gabarito: mensagem do dono não registrada'))
  expect(avisos).toEqual(['gabarito: mensagem do dono não registrada (mensagem não gravada); o gatilho de aprendizado desta mensagem não abre.'])
  expect(msgsDo(m)).toHaveLength(0)
})
test('mensagem-nao-espera-ponte: com a ponte presa o prompt volta; liberada, grava', async ($, on) => {
  const m = mundo($, on, { mensagemPendente: true })
  await m.inicio()
  const r = await m.dono() // se o handler esperasse a ponte, isto nunca resolveria
  expect(r).toEqual({ text: 'mensagem do dono' })
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
  m.est.mensagemLibera.forEach((f) => f()); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
})
test('submit-proprio-prefixo-nao-grava: os 3 prompts do próprio mod, mesmo com origem composer, não são mensagem do dono', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  for (const text of [PROMPT_RETOMADA, PROMPT_RECUPERACAO, `${CABECALHO}\n\nDiário: 1 evento(s)`]) await m.dono({ text })
  await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
  await m.dono({ text: `${PROMPT_RETOMADA} e mais algo do dono` }); await m.clock.settle() // o prefixo vale; o que não começa por ele é do dono
  expect(msgsDo(m)).toHaveLength(0)
  await m.dono({ text: `por favor ${PROMPT_RETOMADA}` }); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
})
test('retomada-via-mod: sessao.retomada leva via mod e o tamanho do prompt enviado', async ($, on) => {
  const m = mundo($, on)
  await pousar(m)
  expect(m.grav.find((g) => g.tipo === 'sessao.retomada')).toEqual({ agente: 'orquestrador', tipo: 'sessao.retomada', dados: { via: 'mod', chars: m.est.submits[0].length } })
})
test('retomada-gravacao-falha-avisa-sem-parar: sessao.retomada que não grava avisa, não para e limpa o store', async ($, on) => {
  const m = mundo($, on, { retomadaFalha: true })
  await pousar(m)
  expect(parou(m)).toHaveLength(0)
  expect(m.toasts).toContain('gabarito: retomada aconteceu mas sessao.retomada não gravou; o próximo cartão pode repetir a linha de pouso.')
  expect(m.store.has(CHAVE)).toBe(false)
})
test('falha-antes-do-clear-sem-pouso: instantâneo que falha continua sendo sem_pouso, sem /clear', async ($, on) => {
  const m = mundo($, on, { instantaneo: 'falha' })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'instantaneo' })
})
test('falha-antes-do-clear-sem-pouso-diario: sessao.pouso que não grava continua sendo sem_pouso, sem /clear', async ($, on) => {
  const m = mundo($, on, { appendFalha: ['sessao.pouso'] })
  await pousar(m)
  expect(m.est.clears).toBe(0)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'diario' })
})
test('submit-falho-repete-pela-contagem: submit que falhou depois do /clear não deixa sessao.retomada; a sessão nova no teto repete pela contagem da fronteira, 60 s depois (T53, emenda 53 substitui "nunca 2º /clear")', async ($, on) => {
  const m = mundo($, on, { submitFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  m.est.percent = 70
  await m.turno(); await m.clock.settle()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1) // dentro dos 60 s da tentativa 1: espera
  await m.avancar(61_000)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(2) // a sessão nova, a 70 %, pousa a si mesma: tentativa 2 da contagem da fronteira
  expect(tentativas(m)).toEqual([2])
  expect(parou(m)).toHaveLength(0)
})
test('pouso-auto-respeita-agora-nao (GM-15 T35 r.9): "agora não" ao pedido de /clear segura a repetição do pouso do mod até +10 p.p.; o Agent segue negado (loop parado)', async ($, on) => {
  const m = mundo($, on, { submitFalha: true })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  const pouso = m.evs.filter((e) => e.tipo === 'sessao.pouso').at(-1)
  m.add('orquestrador', 'dono.resposta', { pergunta: `${pouso.sessao}:${pouso.seq}`, rotulo: 'agora não (loop parado, contexto em 70 %)' }, 'dono')
  m.est.percent = 70
  await m.avancar(61_000)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1) // adiado: sem 2ª tentativa
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/) // o loop segue parado no teto
  m.est.percent = 80 // +10 p.p.: o pedido volta e o pouso repete
  await m.avancar(61_000)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(2)
})
test('aprendizados-indisponiveis-avisa-e-pousa: a ponte devolve avisos, o pouso segue e o aviso vem uma vez', async ($, on) => {
  const m = mundo($, on, { instantaneoAvisos: ['aprendizados indisponíveis'] })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  expect(m.toasts.filter((t) => t.includes('aprendizados indisponíveis'))).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
})

// Agent, porta `permitir` (abaixo de X ou percent ausente): a pendência de aprendizado nega sem o núcleo
test('agent-negado-com-pendencia-abaixo-de-x: loop.parar aberto nega o despacho com o texto único; o revisor passa', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: PARAR_ABERTO })
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(TEXTO_PENDENCIA)
  expect(r.deny).toContain('(parar s0:5)')
  expect(r.deny).not.toMatch(/\baprender\b/)
  expect(r.deny).not.toMatch(/encerre o turno/)
})
test('revisor-passa-com-pendencia: o revisor passa e a ponte não grava nada', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: PARAR_ABERTO })
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  expect((await m.agent('gabarito-mestre:gabarito-revisor')).deny).toBeUndefined()
  expect(m.pedidos.filter((p: any) => p.op === 'append')).toHaveLength(0) // T53: lê o diário para o pouso sem confirmação, nunca grava
})
test('agent-negado-com-pendencia-percent-null: percent ausente (usage fora do ar) também nega', async ($, on) => {
  const m = mundo($, on, { percent: null, eventos: PARAR_ABERTO })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(TEXTO_PENDENCIA)
})
test('agent-negado-com-pendencia-usage-fora-do-ar', async ($, on) => {
  const m = mundo($, on, { usageFalha: true, eventos: PARAR_ABERTO })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(TEXTO_PENDENCIA)
})
test('agent-passa-diario-ausente: 0 eventos não é corrompido', async ($, on) => {
  expect((await mundo($, on, { percent: 49, eventos: [] }).agent('gabarito-implementador')).deny).toBeUndefined()
})
test('agent-passa-sem-pendencia: diário íntegro sem pendência passa (percent ausente também)', async ($, on) => {
  expect((await mundo($, on, { percent: null }).agent('gabarito-implementador')).deny).toBeUndefined()
})
test('agent-passa-apos-nada-fechar: a pendência fechada por aprendizado.nada libera o despacho', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: PARAR_ABERTO })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(TEXTO_PENDENCIA)
  fecharEm(m)
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
for (const percent of [null, 49]) {
  test(`pendencia-dono-nao-nega-agent-${percent}: dono.mensagem aberta não nega o despacho abaixo de X (null e 49 = negaPorPendencia) (FIEL-2 b)`, async ($, on) => {
    const m = mundo($, on, { percent, eventos: B_FEITA })
    await m.inicio()
    await m.dono(); await m.clock.settle()
    expect(pendenciasAprendizado(PLANO, m.evs).map((x: any) => x.tipo)).toEqual(['dono'])
    expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  })
}
test('teto-com-dono-aberto-pousa-e-herda: dono aberta + contexto 60 % (X=50), 0 vivos ⇒ Agent negado pela regra de contexto, o mod POUSA mesmo assim e a pendência dono segue aberta para a sessão nova (T53, emenda 52 c)', async ($, on) => {
  const m = mundo($, on, { percent: 60, eventos: B_FEITA })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  expect(pendenciasAprendizado(PLANO, m.evs).map((x: any) => x.tipo)).toEqual(['dono'])
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(/pouso: contexto em 60% \(X=50%\)/)
  expect(r.deny).not.toMatch(TEXTO_PENDENCIA)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(m.tipos()).toContain('sessao.pouso')
  // herdada, nunca fechada: nenhum aprendizado.nada gravado pelo mod, a pendência `dono` continua no diário da sessão nova
  expect(m.tipos()).not.toContain('aprendizado.nada')
  expect(pendenciasAprendizado(PLANO, m.evs).map((x: any) => x.tipo)).toEqual(['dono'])
  expect(parou(m)).toHaveLength(0)
})
test('pendencia-dono-sem-mensagem-pousa-igual: a mesma entrega sem a mensagem pousa do mesmo jeito (controle)', async ($, on) => {
  const m = mundo($, on, { percent: 60, eventos: B_FEITA })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso: contexto em 60%/)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
})
test('pendencia-dono-sem-resto-nao-nega-agent-60: tudo integrado e fechado + dono aberta, contexto 60 %: o Agent não é negado por aprendizado (o `concluir` espera a conversa, o despacho não) (FIEL-2 b)', async ($, on) => {
  const todas = aposB(A_INI, A_CON, ['review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }], ['task.integrada', { task: 'a', sha: 'd' }])
  const m = mundo($, on, { percent: 60, eventos: todas })
  await m.inicio()
  fecharEm(m)
  await m.dono(); await m.clock.settle()
  expect(pendenciasAprendizado(PLANO, m.evs).map((x: any) => x.tipo)).toEqual(['dono'])
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
})
const REVIEW_7 = [...aposB(A_INI, A_CON), EV(7, 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 })]
for (const percent of [60, null, 49]) {
  test(`pendencia-review-ainda-nega-${percent}: review aberta nega com percent ${percent}; a lista não traz a pendência dono`, async ($, on) => {
    const m = mundo($, on, { percent, eventos: REVIEW_7 })
    await m.inicio()
    await m.dono(); await m.clock.settle()
    const r = await m.agent('gabarito-implementador')
    expect(r.deny).toMatch(TEXTO_PENDENCIA)
    expect(r.deny).toContain('review s0:7')
    expect(r.deny).not.toContain('dono dono')
    expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
  })
}
test('pendencia-parar-ainda-nega-com-dono: parar aberta + dono aberta nega pela parar', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: PARAR_ABERTO })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toContain('(parar s0:5)')
  expect(r.deny).not.toContain('dono dono')
})

// ---- T30 (GM-14, FIEL-1 a, c; FIEL-2 a): a entrega certa vem da ponte; sem entrega identificada o mod não age; uma mensagem, um evento ----
const PEDIDO_DIR = (m: ReturnType<typeof mundo>) => m.pedidos.filter((q) => q.op === 'dir')
const OPS_QUE_AGEM = ['ler', 'plano', 'append', 'mensagem', 'instantaneo']
const REVIEW_ABERTA = [...aposB(A_INI, A_CON), EV(7, 'review.veredito', { task: 'a', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 })]

test('ponte-dir-texto-raiz-principal: o programa da ponte usa --git-common-dir, não --show-toplevel, e aplica a trilha sem rodar o gh (FIEL-1 a, c)', () => {
  const t = codigoPonte('file:///x/gates/dist/diario.js')
  expect(t).toContain("'--git-common-dir'")
  expect(t).not.toContain('--show-toplevel')
  expect(t).toContain('trilhaDe')
  expect(t).toContain('idDaBranch')
  expect(t).not.toMatch(/'gh'/)
})
test('ponte-dir-pede-com-sessao-e-cwd-da-sessao: o pedido leva o cwd da sessão e o session_id (a trilha lê a resposta da sessão, T3)', async ($, on) => {
  const m = mundo($, on, { percent: 49 })
  await m.inicio()
  await m.agent('gabarito-implementador')
  const q = PEDIDO_DIR(m)
  expect(q.length).toBeGreaterThan(0)
  for (const x of q) expect(x).toMatchObject({ op: 'dir', cwd: RAIZ, sessao: 'sess-1' })
})
test('ponte-branch-publicada-sem-loop-ativo: entrega não identificada ⇒ 0 negação, 0 pouso, 0 gravação, nenhum pedido de leitura', async ($, on) => {
  const m = mundo($, on, { identificada: false, percent: 60, eventos: REVIEW_ABERTA })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toBeUndefined()
  await m.turno(); await m.clock.settle()
  await m.dono(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
  expect(m.toasts).toEqual([])
  expect(m.pedidos.filter((q) => OPS_QUE_AGEM.includes(q.op))).toEqual([])
  expect([...m.store.keys()].filter((k) => k.startsWith('pouso:'))).toEqual([])
})
test('mod-nao-grava-mensagem-sem-identificacao: sem entrega identificada o dono.mensagem não vai a lugar nenhum (nem _sem-id)', async ($, on) => {
  const m = mundo($, on, { identificada: false })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(0)
  expect(msgsDo(m)).toHaveLength(0)
  expect(m.toasts).toEqual([])
})
test('mensagem-sem-entrega-nao-reserva-o-texto: o texto visto sem entrega identificada não fica reservado; identificada a entrega dentro de 120 s, o mesmo texto grava (N7)', async ($, on) => {
  const o: any = { identificada: false }
  const m = mundo($, on, o)
  await m.inicio()
  await m.dono(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(0)
  o.identificada = true
  await m.clock.advance(30_000)
  await m.dono(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
})
for (const modo of ['sem_loop', 'erro', 'torto'] as const) {
  test(`sem-estado-do-painel-pendencia-review-nega-${modo}: o painel ${modo} não muda a identificação; a pendência de review segue negando`, async ($, on) => {
    const m = mundo($, on, { percent: 49, eventos: REVIEW_ABERTA, painel: { modo } })
    await m.inicio()
    expect((await m.agent('gabarito-implementador')).deny).toMatch(TEXTO_PENDENCIA)
    expect(PEDIDO_DIR(m).length).toBeGreaterThan(0)
  })
}
test('ponte-falha-com-pendencia-review-avisa-e-nao-pousa: a ponte que não lê é falha (nunca "sem entrega"): avisa, não pousa, não grava', async ($, on) => {
  const m = mundo($, on, { dirFalha: true, percent: 60, eventos: REVIEW_ABERTA })
  await m.inicio()
  await m.agent('gabarito-implementador')
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop nesta entrega \(git falhou\)/)
  expect(m.pedidos.filter((q) => OPS_QUE_AGEM.includes(q.op))).toEqual([])
})
test('ponte-dir-sem-flag-de-identificacao-e-falha: resposta ok sem `identificada` não vira entrega nem "sem entrega": avisa e não pousa', async ($, on) => {
  const m = mundo($, on, { dirSemFlag: true, percent: 60 })
  await m.inicio()
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
  expect(m.tipos()).toEqual([])
  expect(m.toasts.join(' ')).toMatch(/não consegui ler se há loop/)
})
test('mensagem-repetida-no-mesmo-turno-um-evento: o mesmo texto 2× antes do turn.complete grava 1 dono.mensagem; texto diferente grava (FIEL-2 a)', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.dono(); await m.dono(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(1)
  await m.dono({ text: 'outra mensagem' }); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(2)
})
test('mensagem-repetida-com-turno-no-meio-dentro-de-120s-um-evento: prompt.submit, turn.complete, prompt.submit do mesmo texto em < 120 s grava 1 (plano B do S8)', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.dono(); await m.clock.settle()
  await m.turno(); await m.clock.settle()
  await m.clock.advance(60_000)
  await m.dono(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(1)
})
test('mensagem-repetida-apos-120s-dois-eventos: o mesmo texto depois de 120 s é outra mensagem', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.dono(); await m.clock.settle()
  await m.turno(); await m.clock.settle()
  await m.clock.advance(121_000)
  await m.dono(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(2)
})
test('mensagem-falha-nao-marca-o-texto: se a gravação falhou, o mesmo texto digitado de novo é tentado de novo', async ($, on) => {
  const m = mundo($, on, { mensagemFalha: true })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  await m.dono(); await m.clock.settle()
  expect(PEDIDOS_DE(m, 'mensagem')).toHaveLength(2)
})
test('mensagem-do-subagent-nao-zera-a-janela: o turn.complete de subagent não reabre o mesmo texto', async ($, on) => {
  const m = mundo($, on)
  await m.inicio()
  await m.dono(); await m.clock.settle()
  await m.turno({ agentId: 'ag1' }); await m.clock.settle()
  await m.dono(); await m.clock.settle()
  expect(msgsDo(m)).toHaveLength(1)
})
test('agent-negado-diario-corrompido-abaixo-de-x: leitura que falha nega, com o motivo', async ($, on) => {
  const a = mundo($, on, { percent: 49, lerFalha: true, lerErro: 'cadeia quebrada na linha 3' })
  expect((await a.agent('gabarito-implementador')).deny).toBe('gabarito: não consegui verificar pendência de aprendizado (cadeia quebrada na linha 3). Sem despacho novo; só o revisor passa.')
})
test('agent-negado-diario-fora-de-ordem-abaixo-de-x: eventos fora de ordem negam em vez de virar pendências []', async ($, on) => {
  const fora = [EV(2, 'task.iniciada', { task: 'a', papel: 'implementador' }), EV(1, 'task.concluida', { task: 'a', sha: 'x' })]
  const b = mundo($, on, { percent: 49, eventos: fora })
  expect((await b.agent('gabarito-implementador')).deny).toMatch(/não consegui verificar pendência de aprendizado \(diário fora (de ordem|da tabela de transições)/)
})
test('agent-negado-plano-ilegivel-abaixo-de-x: plano que não lê nega', async ($, on) => {
  const m = mundo($, on, { percent: 49, plano_json: 'falha' })
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/não consegui verificar pendência de aprendizado \(plano\.json inválido: x\)/)
})
test('agent-negado-task-fora-do-plano-abaixo-de-x: evento de task que o plano não tem nega, não vira pendências []', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: [...B_FEITA, EV(5, 'task.iniciada', { task: 'zzz', papel: 'implementador' })] })
  expect((await m.agent('gabarito-implementador')).deny).toBe('gabarito: não consegui verificar pendência de aprendizado (evento de task fora do plano). Sem despacho novo; só o revisor passa.')
})
test('agent-negado-por-pendencia-conta-negado: o iniciar do despacho negado é reaberto no fim do turno (D1)', async ($, on) => {
  const m = mundo($, on, { percent: 49, eventos: [...aposB(A_INI), EV(6, 'loop.parar', { motivo: 'teto_rodadas', task: 'b' })] })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(TEXTO_PENDENCIA)
  await m.turno(); await m.clock.settle()
  expect(reabertas(m)).toEqual([ORQ_RETOMADA])
})
test('deny-pendencia-acima-de-x-sem-aprender-cru: com o núcleo (percent ≥ X) o texto é o mesmo, sem `aprender` nem "encerre o turno"', async ($, on) => {
  const m = mundo($, on, { percent: 60, eventos: PARAR_ABERTO })
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toMatch(TEXTO_PENDENCIA)
  expect(r.deny).toContain('(parar s0:5)')
  expect(r.deny).not.toMatch(/\baprender\b/)
  expect(r.deny).not.toMatch(/encerre o turno/)
  expect((await m.agent('gabarito-revisor')).deny).toBeUndefined()
})
test('deny-pendencia-lista-ate-6: 8 pendências ⇒ 6 itens e `e mais 2`', async ($, on) => {
  const parares = Array.from({ length: 8 }, (_, i) => EV(5 + i, 'loop.parar', { motivo: 'teto_rodadas', task: 'b' }))
  const m = mundo($, on, { percent: 49, eventos: [...B_FEITA, ...parares] })
  const r = await m.agent('gabarito-implementador')
  expect(r.deny).toContain('(parar s0:5, parar s0:6, parar s0:7, parar s0:8, parar s0:9, parar s0:10, e mais 2)')
})
test('parar-nao-repete-apos-aprendizado: loop.parar, aprendizado que o fecha e o turno seguinte NÃO regravam loop.parar', async ($, on) => {
  const m = mundo($, on, { eventos: EM_TETO_A_E_B_ORFA_RETOMADA, plano_json: PLANO_AB })
  fecharEm(m, PLANO_AB)
  await m.inicio()
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
  fecharEm(m, PLANO_AB) // o `loop.parar` abriu pendência `parar`; o aprendiz a fecha
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
  await m.dono(); await m.clock.settle() // e a mensagem do dono também não zera o "já parou"
  fecharEm(m, PLANO_AB)
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
})
test('parar-nao-repete-apos-aprendizado-evento: fechar a pendência `parar` com `aprendizado` (não só `aprendizado.nada`) também não regrava loop.parar', async ($, on) => {
  const m = mundo($, on, { eventos: EM_TETO_A_E_B_ORFA_RETOMADA, plano_json: PLANO_AB })
  fecharEm(m, PLANO_AB)
  await m.inicio()
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
  const abertas = pendenciasAprendizado(PLANO_AB, m.evs)
  expect(abertas.length).toBeGreaterThan(0)
  const ult = m.evs.reduce((n, e) => Math.max(n, e.sessao === 'aprendiz' ? e.seq : 0), 0)
  abertas.forEach((p, i) => m.evs.push({
    seq: ult + 1 + i, ts: '2026-11-04T00:00:00.000Z', autor: 'teste', sessao: 'aprendiz', agente: 'orquestrador', tipo: 'aprendizado',
    dados: { tipo: 'E', status: 'M', gatilho: { sessao: p.sessao, seq: p.seq }, evidencia: { eventos: [{ sessao: p.sessao, seq: p.seq }] }, regra: 'regra do teste', entra_em: ['instantaneo'] }, hash_anterior: null,
  }))
  expect(pendenciasAprendizado(PLANO_AB, m.evs)).toHaveLength(0)
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
})

// ======================================================================================================================================
// ---- painel (GM-14 T20): um painel no local escolhido (REQ-GLB-1, PRG-1, FIEL-10..14). Mutações: t20 (M-T20a/b, M13, M-P1, M-P2, M-P7, M-W4..6, M-F3f) ----
// ======================================================================================================================================
const PANE_VISIVEL = [{ id: ID_PAINEL, isPlaced: true, isShown: true }]
const NOMES_STORE = 'painel:nomes'
const POUSO_STORE = 'painel:notificado:pouso'
const LIMPAR = { nivel: 'dono', motivo: 'limpar a conversa', acoes: [acaoP('limpar', '/clear')] }
const comPouso = (seq: number) => estadoNovo({ depende: [LIMPAR], pousoPendente: { pendente: true, sessao: 's0', seq } })
const TOAST_POUSO = 'gabarito: hora de limpar a conversa da GM-14'

// ---- local: lateral (padrão) × acima, nunca os dois ----
test('local-padrao-lateral: sem `painel.local` gravado ⇒ lateral: a Pane abre e a faixa cede ao motor com a Pane visível', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'ausente', panes: PANE_VISIVEL })
  await arrancar(m)
  await m.cmd('painel'); await drena(m)
  expect(m.est.opens.length).toBeGreaterThanOrEqual(1)
  const ui = await montarFaixaH($, 50, 19)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
})
test('nunca-os-dois: acima ⇒ 0 ui.open e a faixa desenha o painel inteiro; lateral com a Pane visível ⇒ a faixa devolve next(e)', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'acima' })
  await arrancar(m)
  await m.turno(); await drena(m)
  expect(m.est.opens).toHaveLength(0)
  const ui = await montarFaixaH($, 50, 19)
  const t = (await todosTextos(ui)).join('|')
  expect(t).toContain('GABARITO')
  expect(t).toContain('PLANO')
  await ui.unmount()
})
test('nunca-os-dois-pane-aberta-de-antes: acima com a Pane listada de antes ⇒ o reload a fecha 1×, a Pane não desenha o painel e a faixa desenha', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'acima', panes: PANE_VISIVEL })
  await arrancar(m)
  await m.turno(); await drena(m)
  expect(m.est.closes.filter((id: any) => id === ID_PAINEL)).toHaveLength(1)
  expect(m.est.opens).toHaveLength(0)
  const pane = await montarPane($)
  const tp = (await todosTextos(pane)).join('|')
  expect(tp).not.toContain('GABARITO')
  expect(tp).not.toContain('PLANO')
  await pane.unmount()
  const ui = await montarFaixaH($, 50, 19)
  const t = (await todosTextos(ui)).join('|')
  expect(t).toContain('GABARITO')
  expect(t).toContain('PLANO')
  await ui.unmount()
})
test('nunca-os-dois-pane-aberta-de-antes-com-falha: acima com a Pane listada e a leitura do estado falhando ⇒ a Pane fecha mesmo assim', async ($, on) => {
  const m = comPainel($, on, { modo: 'erro' }, { local: 'acima', panes: PANE_VISIVEL })
  await arrancar(m)
  expect(m.est.closes.filter((id: any) => id === ID_PAINEL)).toHaveLength(1)
  expect(m.est.opens).toHaveLength(0)
})
test('nunca-os-dois-clear-local-trocado: lateral com a Pane de pé, o config passa a acima (onboarding) e vem o /clear ⇒ a Pane fecha 1× e não desenha', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', panes: PANE_VISIVEL })
  await arrancar(m)
  expect(m.est.closes).toHaveLength(0)
  m.est.local = 'acima' // gravado por fora (onboarding da T21) com a sessão aberta
  await arrancar(m) // /clear ⇒ novo session.start
  expect(m.est.closes.filter((id: any) => id === ID_PAINEL)).toHaveLength(1)
  const pane = await montarPane($)
  expect((await todosTextos(pane)).join('|')).not.toContain('GABARITO')
  await pane.unmount()
})
test('nunca-os-dois-faixa-de-antes: lateral sem Pane (a faixa era o painel antes) ⇒ o reload abre a Pane e a faixa não desenha o painel multi-linha', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', panes: [] })
  await arrancar(m)
  expect(m.est.opens).toHaveLength(1)
  expect(m.est.closes).toHaveLength(0)
  let ui = await montarFaixaH($, 50, 19)
  const t = (await todosTextos(ui)).join('|')
  expect(t).not.toContain('GABARITO')
  expect(t).not.toContain('PLANO')
  await ui.unmount()
  m.est.panes = PANE_VISIVEL
  ui = await montarFaixaH($, 50, 19)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
  const pane = await montarPane($)
  expect((await todosTextos(pane)).join('|')).toContain('GABARITO')
  await pane.unmount()
})
test('nunca-os-dois-lateral: lateral com a Pane posta ⇒ a faixa é a do motor mesmo com pergunta aberta', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo({ pergunta: PERGUNTA }) }, { local: 'lateral', panes: PANE_VISIVEL })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
})
test('sem-pane-nem-ui-open: com local acima, nem início, nem turno, nem relógio, nem `/gabarito painel`/`mostrar` abrem a Pane', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'acima' })
  await arrancar(m)
  await m.turno(); await m.clock.advance(PERIODO * 2); await drena(m)
  expect((await m.cmd('painel')).text).toBe('painel acima da linha de digitar')
  await m.cmd('painel mostrar'); await drena(m)
  expect(m.est.opens).toHaveLength(0)
})
test('lateral-pane-fechada-so-parou-e-pergunta: Pane fechada ⇒ 1 linha só com a pergunta (ou o PAROU); o resto do painel não aparece', async ($, on) => {
  sobreOMotor(on)
  const dep = { nivel: 'dono', motivo: 'aprovar a spec da GM-14', acoes: [acaoP('aprovar', '/gabarito-mestre:aprovar')] }
  const m = comPainel($, on, { estado: estadoNovo({ pergunta: PERGUNTA, depende: [dep] }) }, { local: 'lateral', panes: [] })
  await arrancar(m)
  let ui = await montarFaixaH($, 50, 19)
  let t = (await todosTextos(ui)).join('|')
  expect(t).not.toContain('GABARITO')
  expect(t).toContain('Qual caminho seguir agora')
  expect(t).not.toContain('PLANO')
  expect(t).not.toContain('aprovar a spec')
  expect((await ui.findAll({ type: 'Button' })).length).toBe(3) // as 2 opções + "agora não" (GM-15 T35 r.14)
  await ui.unmount()
  m.est.painel.estado = estadoNovo({ depende: [dep] })
  await m.turno(); await drena(m)
  ui = await montarFaixaH($, 50, 19)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
})
// ---- T50 (emenda 44, REQ-GLB-1): Pane lateral que a plataforma não colocou ⇒ aviso na linha única; o dono abre com /gabarito painel ----
const RAZAO_144 = 'unasked below 144 columns (80 now): placed when the person opens it, or when the terminal is widened to 144 columns'
const semColocar = (reason: string) => ({ openResult: { isPlaced: false, reason } })
const aviso = async ($: any, largura = 100) => {
  const ui = await montarFaixaH($, 50, 19, { bodyColumns: largura })
  const t = (await todosTextos(ui)).join('|')
  await ui.unmount()
  return t
}
test('aviso-com-limiar-da-plataforma: lateral, Pane não colocada ⇒ 1 linha "precisa de <N> colunas: /gabarito painel para abrir", N tirado do reason (nunca fixo)', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  const t = await aviso($)
  expect(t).toContain('painel lateral precisa de 144 colunas: /gabarito painel para abrir')
  m.est.openResult = { isPlaced: false, reason: 'unasked below 170 columns (90 now): placed when the person opens it' }
  await m.cmd('painel'); await drena(m)
  expect(await aviso($)).toContain('painel lateral precisa de 170 colunas: /gabarito painel para abrir')
})
test('aviso-sem-numero-quando-reason-sem-numero: reason sem limiar ⇒ "mais colunas", sem número nenhum', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar('estreito') })
  await arrancar(m)
  for (const reason of ['estreito', '', 'unasked (80 now)']) {
    m.est.openResult = { isPlaced: false, reason }
    await m.cmd('painel'); await drena(m)
    const t = await aviso($)
    expect(t).toContain('painel lateral precisa de mais colunas: /gabarito painel para abrir')
    expect(t).not.toMatch(/\d/)
  }
})
test('aviso-sem-pane-colocada-nao-aparece: Pane colocada ⇒ o motor desenha, sem aviso', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', openResult: { isPlaced: false, reason: RAZAO_144 }, panes: PANE_VISIVEL })
  await arrancar(m)
  expect(await aviso($)).toBe('motor')
})
test('aviso-local-acima-nao-aparece: local acima ⇒ o painel é a faixa, sem aviso de Pane', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'acima', ...semColocar(RAZAO_144) })
  await arrancar(m)
  expect(await aviso($)).not.toContain('precisa de')
  expect(m.est.opens).toHaveLength(0)
})
test('aviso-painel-oculto-nao-aparece: painel desligado pelo dono ⇒ sem aviso', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  expect(await aviso($)).toContain('precisa de 144 colunas')
  await m.cmd('painel ocultar'); await drena(m)
  expect(await aviso($)).not.toContain('precisa de')
})
test('parou-e-pergunta-antes-do-aviso: PAROU vem primeiro na linha única; o corte de largura tira o aviso antes', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: pararP() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  const tp = await aviso($, 200)
  expect(tp).toContain('PAROU')
  expect(tp).toContain('precisa de 144 colunas')
  expect(tp.indexOf('PAROU')).toBeLessThan(tp.indexOf('precisa de'))
  const estreita = await aviso($, 48) // o corte come o fim: o PAROU fica, o aviso sai
  expect(estreita).toContain('PAROU')
  expect(estreita).not.toContain('precisa de')
})
// Larguras reais medidas em sessão real (T50 r2): o Button da plataforma é "[ " + rótulo + " ]" (rótulo+4), o espaço entre eles é 1, e a plataforma põe "[-]" (3) na borda direita.
const MOLDURA_BOTAO = 4
const RESERVA_BORDA = 3
test('linha-unica-cabe-com-a-moldura-real: texto longo + botões (rótulo+4) + "[-]" da borda nunca passam da largura, em 80 e 120', async ($, on) => {
  sobreOMotor(on)
  const longa = { ...PERGUNTA, texto: 'De que entrega é esta conversa? '.repeat(8), opcoes: ['uma nova', 'conversa avulsa'] }
  const m = comPainel($, on, { estado: estadoNovo({ pergunta: longa }) }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  for (const larg of [80, 120]) {
    const ui = await montarFaixaH($, 50, 19, { bodyColumns: larg })
    const textos = await todosTextos(ui)
    const rotulos = (await ui.findAll({ type: 'Button' })).map((b: any) => (b.props?.label ?? b.label) as string)
    await ui.unmount()
    expect(rotulos).toEqual(['1 uma nova', '2 conversa avulsa', 'agora não']) // GM-15 T35 (r.14)
    const principal = textos.find((t) => t.trim() !== '') as string
    const total = [...principal].length + rotulos.reduce((n, r) => n + 1 + [...r].length + MOLDURA_BOTAO, 0) + RESERVA_BORDA
    expect(total).toBeLessThanOrEqual(larg)
    expect(total).toBeGreaterThan(larg - 12) // o corte não encolhe à toa: usa a linha
  }
})
// GM-14 T56 (emenda 62, spec:47 e :154): na linha única o botão é só do topo (PAROU ou pergunta); com só o aviso a linha não leva botão e o aviso cabe inteiro
const RAZAO_110 = 'unasked below 110 columns (80 now, an id the person opened before): placed when the person opens it, or when the terminal is widened to 110 columns'
const dependeSpec = () => estadoNovo({ depende: [{ nivel: 'dono', motivo: 'aprovar a spec', acoes: [acaoP('aprovar a spec', '/gabarito-mestre:emenda aprovar 7')] }] })
test('aviso-inteiro-com-depende-sem-pergunta-80x24: DESENHADO a 80 colunas, só o aviso na linha única ⇒ aviso inteiro e nenhum botão', async ($, on) => {
  sobreOMotor(on)
  expect(botoesDoTopo(dependeSpec(), '/repo').length).toBe(1) // o item existe: sem a regra o botão entraria
  const m = comPainel($, on, { estado: dependeSpec() }, { local: 'lateral', ...semColocar(RAZAO_110) })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19, { bodyColumns: 80 })
  const t = (await todosTextos(ui)).join('|')
  const botoes = await ui.findAll({ type: 'Button' })
  await ui.unmount()
  expect(t).toContain(avisoPaneEspera(RAZAO_110)) // inteiro, sem corte
  expect(t).toContain('painel lateral precisa de 110 colunas: /gabarito painel para abrir')
  expect(t).not.toContain('aprovar a spec')
  expect(botoes.length).toBe(0)
})
test('aviso-sem-botao-na-conta-pura: faixaUmaLinha só com aviso devolve botoes vazios', () => {
  const aviso = avisoPaneEspera(RAZAO_110)
  const f = faixaUmaLinha(dependeSpec(), { root: '/repo', aviso }) as any
  expect(f.texto).toBe(aviso)
  expect(f.botoes).toEqual([])
})
test('aviso-nao-regride-botoes: PAROU + aviso e pergunta aberta + aviso mantêm os botões do topo', () => {
  const aviso = avisoPaneEspera(RAZAO_110)
  const parar = estadoNovo({ parou: true, parar: { hora: '10:00', texto: 'falhou', acoes: [acaoP('retomar', '/gabarito-mestre:retomar')] } })
  const fp = faixaUmaLinha(parar, { root: '/repo', aviso }) as any
  expect(fp.botoes.length).toBe(1)
  expect(fp.botoes).toEqual(botoesDoTopo(parar, '/repo'))
  const perg = estadoNovo({ pergunta: PERGUNTA })
  const fq = faixaUmaLinha(perg, { root: '/repo', aviso }) as any
  expect(fq.botoes.length).toBe(3) // GM-15 T35 (r.14): + "agora não"
  expect(fq.botoes).toEqual(botoesDoTopo(perg, '/repo'))
  expect(fq.texto).toContain(aviso)
})
test('colunas-dos-botoes: cada botão é espaço + "[ " + rótulo + " ]"', () => {
  expect(colunasDosBotoes([{ rotulo: '1 uma nova' }])).toBe(15)
  expect(colunasDosBotoes([{ rotulo: '1 uma nova' }, { rotulo: '2 conversa avulsa' }])).toBe(15 + 22)
  expect(colunasDosBotoes([])).toBe(0)
})
test('pergunta-antes-do-aviso: a pergunta aberta vem primeiro na linha única', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo({ pergunta: PERGUNTA }) }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  const tq = await aviso($, 200)
  expect(tq.indexOf('Qual caminho seguir agora')).toBeGreaterThanOrEqual(0)
  expect(tq.indexOf('precisa de')).toBeGreaterThan(tq.indexOf('Qual caminho seguir agora'))
})
test('pedido-do-dono-abre: /gabarito painel abre com focus, a Pane passa a existir e o aviso some; o local segue lateral', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  expect(m.est.opens.length).toBe(1)
  expect(m.est.opens[0].focus).toBeUndefined() // a abertura do mod não pede o teclado
  expect(await aviso($)).toContain('precisa de 144 colunas')
  m.est.openResult = { isPlaced: true } // pedido do dono: a plataforma coloca em qualquer largura
  m.est.panes = PANE_VISIVEL
  const r = await m.cmd('painel'); await drena(m)
  expect(r.text).toBe('painel aberto')
  expect(m.est.opens.length).toBe(2)
  expect(m.est.opens[1].focus).toBe(true)
  expect(m.est.opens[1].id).toBe(ID_PAINEL)
  expect(await aviso($)).toBe('motor')
  expect(m.est.locaisGravados).toEqual([])
})
test('pedido-do-dono-nao-coube: o pedido que a plataforma ainda não colocou responde com o motivo e o aviso continua', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  expect((await m.cmd('painel')).text).toBe(`painel não coube: ${RAZAO_144}`)
  expect(await aviso($)).toContain('precisa de 144 colunas')
})
test('sem-troca-de-local: Pane sem colocar, em qualquer largura ⇒ o local segue lateral: nada gravado, nada fechado, a faixa nunca vira o painel inteiro', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  for (const larg of [40, 80, 120, 143, 200]) {
    const t = await aviso($, larg)
    expect(t).not.toContain('GABARITO')
    expect(t).not.toContain('PLANO')
  }
  await m.turno(); await m.clock.advance(PERIODO * 2); await drena(m)
  expect(m.est.locaisGravados).toEqual([])
  expect(m.est.closes).toHaveLength(0)
  expect(m.est.opens).toHaveLength(1) // nem reabre sozinho
})
test('aba-atras-sem-aviso: Pane colocada mas não mostrada (aba atrás de outra) ⇒ sem aviso, antes e depois do pedido do dono (a promessa "mais colunas" seria falsa)', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', openResult: { isPlaced: true }, panes: [{ id: ID_PAINEL, isPlaced: true, isShown: false }] })
  await arrancar(m)
  expect(await aviso($, 200)).not.toContain('precisa de')
  m.est.openResult = { isPlaced: true }
  await m.cmd('painel'); await drena(m) // depois do pedido: a plataforma colocou, a aba segue atrás
  expect(await aviso($, 200)).not.toContain('precisa de')
  await m.turno(); await m.clock.advance(PERIODO * 2); await drena(m)
  expect(await aviso($, 200)).not.toContain('precisa de')
})
test('pedido-do-dono-le-panes-na-hora: o comando relê `$.ui.panes()` ao abrir, sem esperar o render', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  const antes = m.est.panesLidas
  m.est.openResult = { isPlaced: true }
  await m.cmd('painel')
  expect(m.est.panesLidas).toBeGreaterThan(antes)
})
test('abertura-colocada-limpa-a-razao: depois de colocada, o motivo antigo não volta ao aviso (Pane listada como não colocada ⇒ "mais colunas")', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  expect(await aviso($)).toContain('precisa de 144 colunas')
  m.est.openResult = { isPlaced: true }
  m.est.panes = PANE_VISIVEL
  await m.cmd('painel'); await drena(m)
  m.est.panes = [{ id: ID_PAINEL, isPlaced: false, isShown: false }] // o terminal encolheu: a plataforma tirou a Pane
  const t = await aviso($)
  expect(t).toContain('painel lateral precisa de mais colunas: /gabarito painel para abrir')
  expect(t).not.toContain('144')
})
test('fechada-nao-reabre-com-aviso: a Pane que o dono fechou (sumiu de `$.ui.panes()`) não reabre e o aviso some', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', ...semColocar(RAZAO_144) })
  await arrancar(m)
  expect(await aviso($)).toContain('precisa de 144 colunas')
  m.est.panes = []
  await m.turno(); await m.clock.advance(PERIODO * 2); await drena(m)
  expect(m.est.opens).toHaveLength(1)
  expect(await aviso($)).not.toContain('precisa de')
})
test('comando-painel-troca-local-sem-reiniciar: `painel acima` grava pelo onboarding, fecha a Pane e a faixa vira o painel; `painel lateral` reabre a Pane', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'lateral', panes: PANE_VISIVEL })
  await arrancar(m)
  const inicios = m.est.opens.length
  expect((await m.cmd('painel acima')).text).toBe('painel acima da linha de digitar')
  expect(m.est.locaisGravados).toEqual(['acima'])
  expect(m.est.closes).toContain(ID_PAINEL)
  m.est.panes = []
  let ui = await montarFaixaH($, 50, 19)
  expect((await todosTextos(ui)).join('|')).toContain('GABARITO')
  await ui.unmount()
  expect(m.est.opens.length).toBe(inicios)
  expect((await m.cmd('painel lateral')).text).toBe('painel ao lado da conversa')
  expect(m.est.locaisGravados).toEqual(['acima', 'lateral'])
  expect(m.est.opens.length).toBe(inicios + 1)
  m.est.panes = PANE_VISIVEL
  ui = await montarFaixaH($, 50, 19)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
})
test('comando-painel-local-falha-vale-na-sessao: onboarding recusa ⇒ o local muda só nesta sessão e a resposta diz', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { gravarLocalFalha: true })
  await arrancar(m)
  expect((await m.cmd('painel acima')).text).toBe('painel acima da linha de digitar (só nesta sessão: não gravei a preferência)')
  m.est.opens.length = 0
  await m.turno(); await drena(m)
  expect(m.est.opens).toHaveLength(0)
})
test('prefs-ausente-x-corrompida: local ausente ⇒ lateral sem aviso; config corrompido ⇒ lateral e 1 aviso; ponte que falha ⇒ lateral e outro aviso', async ($, on) => {
  const ausente = comPainel($, on, { estado: estadoNovo() }, { local: 'ausente' })
  await arrancar(ausente)
  expect(ausente.est.opens.length).toBeGreaterThanOrEqual(1)
  expect(ausente.est.logs.filter((l) => l.includes('local do painel'))).toEqual([])
})
test('prefs-corrompida-local: config corrompido ⇒ lateral e 1 aviso por processo', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'corrompido' })
  await arrancar(m); await m.inicio(); await drena(m)
  expect(m.est.opens.length).toBeGreaterThanOrEqual(1)
  expect(m.est.logs.filter((l) => l.includes('local do painel'))).toEqual(['gabarito: a configuração do local do painel está corrompida; uso ao lado da conversa.'])
})
test('prefs-ponte-falha-local: onboarding não roda ⇒ lateral e o aviso de leitura (distinto do corrompido)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'falha' })
  await arrancar(m)
  expect(m.est.opens.length).toBeGreaterThanOrEqual(1)
  expect(m.est.logs.filter((l) => l.includes('local do painel'))).toEqual(['gabarito: não consegui ler o local do painel; uso ao lado da conversa.'])
})

// ---- orçamento: acima (H e maxRows) e lateral (bodyRows) ----
test('faixa-respeita-orcamento: acima, pares do S1b (24/6, 50/19) e vizinhos (24/7, 50/20) ⇒ exatamente o orçamento, nunca mais', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo({ atencao: ATENCAO_LONGA }) }, { local: 'acima' })
  await arrancar(m)
  for (const [h, maxRows, esperado] of [[24, 6, 6], [50, 19, 19], [24, 7, 7], [50, 20, 20]]) {
    const ui = await montarFaixaH($, h, maxRows)
    expect(await linhasDesenhadas(ui), `H ${h} maxRows ${maxRows}`).toBe(esperado)
    await ui.unmount()
  }
})
test('viewport-rows-e-h: o H é `viewport.rows` (S1b): maxRows 19 com H 24 ⇒ 7 linhas; com H 50 ⇒ 19', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo({ atencao: ATENCAO_LONGA }) }, { local: 'acima' })
  await arrancar(m)
  let ui = await montarFaixaH($, 24, 19)
  expect(await linhasDesenhadas(ui)).toBe(7)
  await ui.unmount()
  ui = await montarFaixaH($, 50, 19)
  expect(await linhasDesenhadas(ui)).toBe(19)
  await ui.unmount()
})
test('h-ausente-formula: sem viewport ⇒ maxRows ≤ 7 vale inteiro; acima, min(maxRows − 6, 7)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo({ atencao: ATENCAO_LONGA }) }, { local: 'acima' })
  await arrancar(m)
  for (const [maxRows, esperado] of [[5, 5], [7, 7], [10, 4], [19, 7]]) {
    const ui = await montarFaixaH($, null, maxRows)
    expect(await linhasDesenhadas(ui), `maxRows ${maxRows}`).toBe(esperado)
    await ui.unmount()
  }
})
test('pane-respeita-body-rows: lateral, bodyRows 10 ⇒ 10 linhas; sem bodyRows ⇒ 7 (nunca rola)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo({ atencao: ATENCAO_LONGA }) })
  await arrancar(m)
  expect((await linhasDaPane(m, $, { offset: 0, bodyRows: 10 })).length).toBe(10)
  expect((await linhasDaPane(m, $, { offset: 0 })).length).toBe(7)
})

// ---- botões: só no topo; opção da pergunta põe o `responder` no input, nunca envia ----
test('botao-pergunta-fill-responder: acima, cada opção é um botão `<n> <rótulo>` que põe `/gabarito-mestre:responder <id> <n>` (replace), sem enviar', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo({ pergunta: PERGUNTA }) }, { local: 'acima' })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19)
  const rotulos = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props?.label ?? b.label)
  expect(rotulos).toEqual(['1 manter', '2 trocar', 'agora não']) // GM-15 T35 (r.14): toda pergunta tem "agora não"
  await ui.press({ key: 'painel-acao' })
  await ui.press({ key: 'painel-acao-2' })
  await ui.press({ key: 'painel-acao-3' })
  expect(m.est.fills.map((f) => [f.text, f.mode])).toEqual([['/gabarito-mestre:responder sess-1:7 1', 'replace'], ['/gabarito-mestre:responder sess-1:7 2', 'replace'], ['/gabarito-mestre:responder sess-1:7 agora', 'replace']])
  expect(m.est.submits).toEqual([])
  await ui.unmount()
})
// GM-15 T35 (r.8, D-G11 a) revoga "botão só no topo": cada item do DEPENDE leva os próprios botões na sua linha
test('botao-por-item-no-depende (r.8): com pergunta no topo, o item seguinte do "depende de você" ganha o próprio botão na linha dele', async ($, on) => {
  const dep = { nivel: 'dono', motivo: 'aprovar a spec da GM-14', acoes: [acaoP('aprovar', '/gabarito-mestre:aprovar')] }
  const m = comPainel($, on, { estado: estadoNovo({ pergunta: PERGUNTA, depende: [dep] }) }, { local: 'acima' })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19)
  const botoes = await ui.findAll({ type: 'Button' })
  expect(botoes.length).toBe(4) // 2 opções + "agora não" + o "aprovar" do item
  const linhas = ((await ui.drawn()).children ?? []).map((l: any) => JSON.stringify(l))
  const iTopo = linhas.findIndex((l: string) => l.includes('Qual caminho seguir agora'))
  const iItem = linhas.findIndex((l: string) => l.includes('aprovar a spec'))
  const comBotao = linhas.map((l: string, i: number) => [i, l.includes('"Button"') || l.includes('painel-acao')] as const).filter(([, b]) => b).map(([i]) => i)
  expect(comBotao).toEqual([iTopo, iItem])
  expect(linhas.some((l: string) => l.includes('aprovar a spec'))).toBe(true)
  await ui.unmount()
})
test('botao-no-item-do-depende-e4 (GM-15 T29, D-G1c): o botão vai no 1º item depois de `◆ DEPENDE DE VOCÊ`, nunca no rótulo nem no `◆ ATENÇÃO`', async ($, on) => {
  const dep = { nivel: 'dono', motivo: 'aprovar a spec da GM-14', acoes: [acaoP('aprovar', '/gabarito-mestre:aprovar')] }
  const m = comPainel($, on, { estado: estadoNovo({ depende: [dep], atencao: ['CI vermelho na última execução'] }) }, { local: 'acima' })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19)
  const linhas = ((await ui.drawn()).children ?? []).map((l: any) => JSON.stringify(l))
  const iRotulo = linhas.findIndex((l: string) => l.includes('◆ DEPENDE DE VOCÊ'))
  const iItem = linhas.findIndex((l: string) => l.includes('aprovar a spec da GM-14'))
  const iAtencao = linhas.findIndex((l: string) => l.includes('ATENÇÃO'))
  expect(iRotulo).toBeGreaterThanOrEqual(0)
  expect(iItem).toBe(iRotulo + 1)
  expect(iAtencao).toBeGreaterThan(iItem)
  const comBotao = linhas.map((l: string, i: number) => [i, l.includes('"Button"') || l.includes('painel-acao')] as const).filter(([, b]) => b).map(([i]) => i)
  expect(comBotao).toEqual([iItem])
  await ui.press({ key: 'painel-acao' })
  expect(m.est.fills.map((f: any) => f.text)).toEqual(['/gabarito-mestre:aprovar'])
  await ui.unmount()
})
test('indice-do-topo-e4 (GM-15 T29): PAROU; item depois do rótulo; `◆ item` sem o rótulo; nunca rótulo nem ATENÇÃO', () => {
  const L = (...xs: string[]) => xs.map((t) => [{ texto: t }])
  expect(indiceDoTopo(L('GABARITO · GM-14', '■ PAROU 12:00 · x', '◆ DEPENDE DE VOCÊ  1 item', '  y'))).toBe(1)
  expect(indiceDoTopo(L('GABARITO · GM-14', '◆ DEPENDE DE VOCÊ  2 itens', '  y [ok]', '  z'))).toBe(2)
  expect(indiceDoTopo(L('GABARITO · GM-14', '◆ y [ok] (+1)', '────'))).toBe(1)
  expect(indiceDoTopo(L('GABARITO · GM-14', 'nada depende de você', '◆ ATENÇÃO  CI vermelho'))).toBe(1)
  expect(indiceDoTopo(L('GABARITO · GM-14', 'PLANO   ▰▱  50%', '◆ ATENÇÃO  CI vermelho'))).toBe(-1)
  expect(indiceDoTopo(L('GABARITO · GM-14', '◆ DEPENDE DE VOCÊ  1 item'))).toBe(-1)
  expect(indiceDoTopo(L('GABARITO · GM-14', '◆ DEPENDE DE VOCÊ  1 item', 'PLANO'))).toBe(-1)
  // review T29 r1: a ATENÇÃO estreita (< 60 col) também começa por `◆ `; o `◆ item` só é topo logo depois do cabeçalho
  expect(indiceDoTopo(L('GABARITO · GM-14', '────', '◆ y [ok]'))).toBe(2)
  expect(indiceDoTopo(L('◆ y [ok]', 'PLANO'))).toBe(0)
  expect(indiceDoTopo(L('GABARITO · GM-14', 'PLANO ▰▱ 50%', '◆ T2 sem agente trabalhando'))).toBe(-1)
  expect(indiceDoTopo(L('GM-14 ▰▱ 50% ETA 17:42', '● T8 GIMLI    implementando', '────', '◆ T2 sem agente trabalhando'))).toBe(-1)
})
test('has-survey-next: acima, com survey a faixa devolve next(e), mesmo com PAROU', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo({ parar: pararP().parar, pergunta: PERGUNTA }) }, { local: 'acima' })
  await arrancar(m)
  const ui = await montarFaixaH($, 50, 19, { hasSurvey: true })
  expect(await todosTextos(ui)).toEqual(['motor'])
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

// ---- ocultar | mostrar ----
test('ocultar-mantem-parou-e-pergunta: oculto ⇒ só PAROU ou pergunta aberta, em 1 linha; sem os dois, a faixa cede; mostrar volta o painel', async ($, on) => {
  sobreOMotor(on)
  const m = comPainel($, on, { estado: estadoNovo() }, { local: 'acima' })
  await arrancar(m)
  expect((await m.cmd('painel ocultar')).text).toBe('painel oculto (PAROU e perguntas continuam)')
  let ui = await montarFaixaH($, 50, 19)
  expect(await todosTextos(ui)).toEqual(['motor'])
  await ui.unmount()
  m.est.painel.estado = estadoNovo({ pergunta: PERGUNTA })
  await m.turno(); await drena(m)
  ui = await montarFaixaH($, 50, 19)
  expect((await todosTextos(ui)).join('|')).not.toContain('GABARITO')
  expect((await todosTextos(ui)).join('|')).toContain('Qual caminho seguir agora')
  await ui.unmount()
  m.est.painel.estado = pararP()
  await m.turno(); await drena(m)
  ui = await montarFaixaH($, 50, 19)
  expect((await todosTextos(ui)).join('|')).toContain('PAROU')
  await ui.unmount()
  expect((await m.cmd('painel mostrar')).text).toBe('painel visível')
  m.est.painel.estado = estadoNovo()
  await m.turno(); await drena(m)
  ui = await montarFaixaH($, 50, 19)
  expect((await todosTextos(ui)).join('|')).toContain('GABARITO')
  await ui.unmount()
})
test('ocultar-lateral-fecha-a-pane: lateral oculto fecha a Pane e não reabre no relógio', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() })
  await arrancar(m)
  await m.cmd('painel ocultar')
  expect(m.est.closes).toContain(ID_PAINEL)
  m.est.opens.length = 0
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.opens).toHaveLength(0)
})

// ---- medir: no turno e no relógio de 60 s ----
test('medir-no-turno-e-relogio: `painel.mjs medir --agentes` com o session_id no início, a cada turno e a cada 60 s (nada aos 30 s)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() })
  await arrancar(m)
  expect(m.est.medirStdins).toHaveLength(1)
  expect(m.est.medirStdins[0].argv.slice(2)).toEqual(['medir', '--agentes'])
  expect(m.est.medirStdins[0].stdin.session_id).toBe('sess-1')
  expect(m.est.medirStdins[0].cwd).toBe(RAIZ)
  await m.turno(); await drena(m)
  expect(m.est.medirStdins).toHaveLength(2)
  await m.clock.advance(PERIODO / 2); await drena(m)
  expect(m.est.medirStdins).toHaveLength(2)
  await m.clock.advance(PERIODO / 2); await drena(m)
  expect(m.est.medirStdins).toHaveLength(3)
})

// ---- contexto do orquestrador (FIEL-11 a, FIEL-14 b) ----
test('contexto-json-gravado: a leitura do mod vai a `.harness/contexto/<sessao>.json` pela ponte (tmp + rename), com fonte mod', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37 })
  await arrancar(m)
  expect(m.est.contextos.length).toBeGreaterThanOrEqual(1)
  const c = m.est.contextos[0]
  expect(c.sessao).toBe('sess-1')
  expect(c.percent).toBe(37)
  expect(c.fonte).toBe('mod')
  expect(new Date(c.em).toISOString()).toBe(c.em)
  expect(m.est.contextoInit[0].cwd).toBe(RAIZ)
})
test('mod-contexto-id-apos-clear (GM-15 T34, emenda 7 r.1): a sessão muda sem novo session.start ⇒ a gravação sai sob o id vigente, e a antiga não recebe mais nada', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37, sessaoId: 'sess-A' })
  await arrancar(m)
  expect(m.est.contextos.at(-1).sessao).toBe('sess-A')
  m.est.sessaoId = 'sess-B' // /clear: o id do hook muda; o mod não refaz o session.start
  const antes = m.est.contextos.length
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.contextos.length).toBeGreaterThan(antes)
  expect(m.est.contextos.slice(antes).every((c: any) => c.sessao === 'sess-B')).toBe(true)
  // 2 sessões: a leitura posterior ao /clear nunca cai sob a anterior
  expect(m.est.contextos.slice(antes).some((c: any) => c.sessao === 'sess-A')).toBe(false)
})
test('contexto-grava-o-pacote-vigente (g.17): o pacote do mod vai no contexto da sessão para a CLI; fora da forma ⇒ a gravação segue sem ele', async ($, on) => {
  const g = gravarContexto({ sessao: 'abc-1', percent: 55, fonte: 'mod', emMs: Date.UTC(2026, 10, 12), pacote: 'hogwarts' })
  expect(JSON.parse(g!.stdin)).toEqual({ sessao: 'abc-1', percent: 55, fonte: 'mod', em: '2026-11-12T00:00:00.000Z', pacote: 'hogwarts' })
  expect(String(g?.argv[2])).toContain('pacote')
  for (const ruim of ['../x', 'Hogwarts', '', 'a'.repeat(40), 7, null]) expect(JSON.parse(gravarContexto({ sessao: 'abc-1', percent: 1, fonte: 'mod', emMs: 0, pacote: ruim as any })!.stdin).pacote).toBeUndefined()
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37 })
  await m.store.set(PREFS_STORE, { preset: 'esquadrao', tema: 'color', narracao: true, ligado: true, pacote: 'herois' })
  await arrancar(m)
  expect(m.est.contextos.at(-1).pacote).toBe('herois')
})
test('contexto-gravar-pura: gravarContexto devolve argv de node -e com o script e o stdin; sessão fora da forma ou percent não número ⇒ null', () => {
  const g = gravarContexto({ sessao: 'abc-1', percent: 55, fonte: 'mod', emMs: Date.UTC(2026, 10, 12) })
  expect(g?.argv.slice(0, 2)).toEqual(['node', '-e'])
  expect(String(g?.argv[2]).startsWith('/*gabarito:contexto*/')).toBe(true)
  expect(String(g?.argv[2])).toContain('renameSync')
  expect(JSON.parse(g!.stdin)).toEqual({ sessao: 'abc-1', percent: 55, fonte: 'mod', em: '2026-11-12T00:00:00.000Z' })
  expect(gravarContexto({ sessao: '../x', percent: 55, fonte: 'mod', emMs: 0 })).toBeNull()
  expect(gravarContexto({ sessao: 'abc-1', percent: null, fonte: 'mod', emMs: 0 })).toBeNull()
  expect(gravarContexto({ sessao: 'abc-1', percent: 5, fonte: 'outra', emMs: 0 })).toBeNull()
})
test('contexto-plano-b-estimado: percent nulo ⇒ o transcript da sessão dá a estimativa (tokens ÷ janela), gravada com fonte transcript; o stdin não a finge medida', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: null, planoB: 250000 })
  await m.inicio()
  await subStart($)
  await drena(m)
  await m.turno(); await drena(m)
  expect(m.est.planosB.at(-1)?.caminho).toBe('/h/proj/abc-123.jsonl')
  const c = m.est.contextos.at(-1)
  expect([c?.percent, c?.fonte]).toEqual([25, 'transcript'])
  const s = ultimoStdin(m)
  expect(s.sessao.percent).toBeNull()
  expect(s.contexto).toEqual({ percent: 25, fonte: 'transcript', estimado: true })
})
test('contexto-plano-b-sem-janela: percent e window nulos com transcript ⇒ contexto nulo ("?"), nada gravado, nunca NaN', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: null, janela: null, planoB: 250000 })
  await m.inicio()
  await subStart($)
  await drena(m)
  await m.turno(); await drena(m)
  expect(m.est.planosB.length).toBeGreaterThan(0) // o plano B rodou: é a janela nula que o barra
  expect(m.est.contextos).toHaveLength(0)
  const s = ultimoStdin(m)
  expect(s.contexto).toBeNull()
  expect(JSON.stringify(s)).not.toContain('NaN')
  expect(JSON.stringify(s)).not.toContain('null,"fonte"')
})
test('contexto-sem-fonte-nada-gravado: percent nulo e sem transcript ⇒ nenhuma gravação e contexto nulo no stdin', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: null })
  await arrancar(m)
  expect(m.est.contextos).toHaveLength(0)
  expect(ultimoStdin(m).contexto).toBeNull()
})

// ---- desatualizado (FIEL-13 b) ----
test('desatualizado-no-stdin: segundos desde a última leitura boa no stdin; leitura falhando além do limite ⇒ linha de ATENÇÃO na Pane', async ($, on) => {
  expect(LIMITE_DESATUALIZADO_S).toBe(120)
  const m = comPainel($, on, { estado: estadoNovo() })
  await arrancar(m)
  expect(m.est.painelStdins[0].desatualizadoS).toBeNull()
  await m.clock.advance(PERIODO); await drena(m)
  expect(ultimoStdin(m).desatualizadoS).toBe(60)
  m.est.painel.modo = 'erro'
  for (let i = 0; i < 2; i++) { await m.clock.advance(PERIODO); await drena(m) }
  expect(ultimoStdin(m).desatualizadoS).toBe(120)
  let ui = await montarPane($, 80)
  expect((await todosTextos(ui)).join('|')).not.toContain('sem ler o diário')
  await ui.unmount()
  await m.clock.advance(PERIODO); await drena(m)
  ui = await montarPane($, 80)
  expect((await todosTextos(ui)).join('|')).toContain('painel sem ler o diário há 3 min')
  await ui.unmount()
})

// ---- nomes (FIEL-3 d): store, estáveis, únicos entre ativos ----
test('nomes-unicos-entre-ativos: dois ativos com o mesmo nome no store ⇒ o 1º visto fica, o outro pega o 1º livre; encerrado não ocupa nome', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, {
    agentesPainel: [{ id: 'a2', type: 'revisor', description: 'T2 revisor', status: 'running' }, { id: 'a1', type: 'implementador', description: 'T1 impl', status: 'waiting' }, { id: 'a3', type: 'implementador', description: 'T3', status: 'completed' }],
    storeInicial: { [NOMES_STORE]: { a1: { nome: 'LEGOLAS', vistoEm: 1 }, a2: { nome: 'LEGOLAS', vistoEm: 2 }, a3: { nome: 'GIMLI', vistoEm: 0 } } },
  })
  await arrancar(m)
  const n = ultimoStdin(m).nomes
  expect(n.a1.nome).toBe('LEGOLAS')
  expect(n.a2.nome).toBe('GIMLI')
  expect((m.store.get(NOMES_STORE) as any).a2.nome).toBe('GIMLI')
})
test('nomes-forma-do-contrato: cada ativo vai como {nome, vistoEm} (o validarNomesAgentes real do CLI aceita)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { agentesPainel: [{ id: 'a1', type: 'implementador', description: 'T1', status: 'running' }] })
  await arrancar(m)
  const n = ultimoStdin(m).nomes
  expect(Object.keys(n.a1).sort()).toEqual(['nome', 'vistoEm'])
  expect(Number.isSafeInteger(n.a1.vistoEm)).toBe(true)
  expect((validarStdinAgentes(ultimoStdin(m)) as any).ok).toBe(true)
})
test('nome-estavel-apos-reload: o nome guardado vale depois do reload, mesmo não sendo o 1º livre; agente novo pega o 1º livre (M-F3f)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, {
    agentesPainel: [{ id: 'novo', type: 'revisor', description: 'T2', status: 'running' }, { id: 'a1', type: 'implementador', description: 'T1', status: 'running' }],
    storeInicial: { [NOMES_STORE]: { a1: { nome: 'ARAGORN', vistoEm: 5 } } },
  })
  await arrancar(m)
  const n = ultimoStdin(m).nomes
  expect(n.a1.nome).toBe('ARAGORN')
  expect(n.novo.nome).toBe('GIMLI')
})
test('nomes-esgotados-sufixo: pacote sem nome livre ⇒ sufixo 2 a 9, depois "agente"', async ($, on) => {
  const vivos = Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, type: 'implementador', description: 'x', status: 'running' }))
  const m = comPainel($, on, { estado: estadoNovo() }, { agentesPainel: vivos, pacoteNomes: { lider: 'GANDALF', sabio: 'ELROND', nomes: ['GIMLI'] } })
  await arrancar(m)
  const n = ultimoStdin(m).nomes
  expect(vivos.map((v) => n[v.id].nome)).toEqual(['GIMLI', 'GIMLI2', 'GIMLI3', 'GIMLI4'])
})
test('store-nomes-ausente-x-corrompido: ausente ⇒ nomes do zero, sem aviso; corrompido ⇒ do zero e 1 aviso', async ($, on) => {
  const vivo = [{ id: 'a1', type: 'implementador', description: 'T1', status: 'running' }]
  const m = comPainel($, on, { estado: estadoNovo() }, { agentesPainel: vivo, storeInicial: { [NOMES_STORE]: 7 } })
  await arrancar(m)
  expect(ultimoStdin(m).nomes.a1.nome).toBe('GIMLI')
  expect(m.est.logs.filter((l) => l.includes('nomes da equipe'))).toEqual(['gabarito: os nomes da equipe do painel estavam corrompidos; recomecei.'])
})
test('store-nomes-ausente: sem store ⇒ nomes do zero e nenhum aviso', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { agentesPainel: [{ id: 'a1', type: 'implementador', description: 'T1', status: 'running' }] })
  await arrancar(m)
  expect(ultimoStdin(m).nomes.a1.nome).toBe('GIMLI')
  expect(m.est.logs.filter((l) => l.includes('nomes da equipe'))).toEqual([])
})

// ---- push do pouso (FIEL-14 d) ----
test('push-no-pouso: pouso pendente ⇒ toast e notify "hora de limpar a conversa", chave `<ID>|pouso|<seq>` no store', async ($, on) => {
  const m = comPainel($, on, { estado: comPouso(4) })
  await arrancar(m)
  expect(m.toasts.filter((t) => t === TOAST_POUSO)).toHaveLength(1)
  expect(m.est.notifies).toEqual([TOAST_POUSO])
  expect((m.store.get(POUSO_STORE) as any).chave).toBe('GM-14|pouso|4')
})
test('push-mesma-chave-nao-repete: o mesmo pouso em 3 refresh ⇒ 1 push; chave já no store (outra janela) ⇒ 0', async ($, on) => {
  const m = comPainel($, on, { estado: comPouso(4) })
  await arrancar(m)
  for (let i = 0; i < 3; i++) { await m.clock.advance(PERIODO); await drena(m) }
  expect(m.est.notifies).toHaveLength(1)
})
test('push-mesma-chave-no-store: a chave do pouso já gravada ⇒ nenhum push', async ($, on) => {
  const m = comPainel($, on, { estado: comPouso(4) }, { storeInicial: { [POUSO_STORE]: { chave: 'GM-14|pouso|4', resultado: null } } })
  await arrancar(m)
  expect(m.est.notifies).toHaveLength(0)
  expect(m.toasts.filter((t) => t === TOAST_POUSO)).toHaveLength(0)
})
test('push-repetido-com-novo-pouso: novo `sessao.pouso` (seq nova) ⇒ novo push', async ($, on) => {
  const m = comPainel($, on, { estado: comPouso(4) })
  await arrancar(m)
  m.est.painel.estado = comPouso(9)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.notifies).toEqual([TOAST_POUSO, TOAST_POUSO])
  expect((m.store.get(POUSO_STORE) as any).chave).toBe('GM-14|pouso|9')
})
test('notify-falha-mantem-toast-e-depende: notify que lança ⇒ o toast saiu, a linha "limpar a conversa" segue na Pane e o push não repete', async ($, on) => {
  const m = comPainel($, on, { estado: comPouso(4) }, { notify: 'rejeita' })
  await arrancar(m)
  for (let i = 0; i < 2; i++) { await m.clock.advance(PERIODO); await drena(m) }
  expect(m.toasts.filter((t) => t === TOAST_POUSO)).toHaveLength(1)
  expect(m.est.notifies).toHaveLength(1)
  const ui = await montarPane($, 80)
  expect((await todosTextos(ui)).join('|')).toContain('limpar a conversa')
  await ui.unmount()
})
test('sem-pouso-sem-push: sem o item de limpar ⇒ nenhum push do pouso, e o PAROU segue com a sua chave', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() })
  await arrancar(m)
  expect(m.est.notifies).toHaveLength(0)
  expect(m.store.has(POUSO_STORE)).toBe(false)
})

// ---- pendências herdadas: "depende de você" sem duplicar; medição não é progresso ----
test('faixa-sem-depende-duplicado: o item "nada depende de você" do estado novo nunca vira "depende de você: nada depende de você"', () => {
  const e = estadoNovo()
  expect(faixaDe(e, true, null, {})).toBeNull()
  const f = faixaDe(e, false, null, {})
  expect(f === null || !f.texto.includes('depende de você: depende de você')).toBe(true)
  const q = faixaDe(estadoNovo({ depende: [{ nivel: 'dono', motivo: 'depende de você: ? (não consegui ler as specs)', acoes: [] }] }), true, null, {})
  expect(q === null || !q.texto.includes('depende de você: depende de você')).toBe(true)
})
test('parar-nao-repete-apos-fato-medido (pouso.ts SEM_PROGRESSO): fato.medido, nota e dono.resposta depois do loop.parar não fazem o mod regravá-lo', async ($, on) => {
  const m = mundo($, on, { eventos: EM_TETO_A_E_B_ORFA_RETOMADA, plano_json: PLANO_AB })
  fecharEm(m, PLANO_AB)
  await m.inicio()
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
  fecharEm(m, PLANO_AB)
  m.add('painel', 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'feat/PBI-7-x' } }, 'sess-1')
  m.add('orquestrador', 'nota', { tipo: 'ideia', texto: 'uma ideia' }, 'sess-1')
  m.add('dono', 'dono.resposta', { pergunta: 'sess-1:9', opcao: 1, rotulo: 'sim' }, 'dono')
  await recuperar(m)
  await recuperar(m)
  expect(parou(m)).toHaveLength(1)
})

// ======================================================================================================================================
// ---- GM-14 T35: AGORA ao vivo (FIEL-11 b/c, FIEL-6 a). Fonte: S12 (`tool.call` com agentId), S13 (SubagentStop não é fim), S14 (backgroundTaskId). ----
// Mutações: M-P10 (frase fixa), M-T35a (SubagentStop ignorado), M-T35b (segundo plano nunca sai). ----
// ======================================================================================================================================
const AG = (id: string, status = 'running') => ({ id, type: 'implementador', description: 'T2 implementador', status })
const bash = ($: any, extra: Record<string, unknown> = {}) => $.tool.call({ tool: 'Bash', command: 'ls', description: 'listar arquivos', ...extra })
const ferr = ($: any, tool: string, extra: Record<string, unknown> = {}) => $.tool.call({ tool, ...extra })

test('acao-ao-vivo-bash-description: Bash de subagente ⇒ acoes[agentId] = a description, fonte bash', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await bash($, { agentId: 'a1' }); await drena(m)
  const a = ultimoStdin(m).acoes.a1
  expect(a.texto).toBe('listar arquivos')
  expect(a.fonte).toBe('bash')
  expect(Number.isSafeInteger(a.em) && a.em >= 0).toBe(true)
})
test('acao-de-outra-ferramenta-no-presente: Read×3 ⇒ "lendo 3 arquivos"; outra ferramenta zera a contagem; Bash sem description ⇒ "rodando 1 comando"', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await ferr($, 'Read', { agentId: 'a1', file_path: '/x' }); await ferr($, 'Grep', { agentId: 'a1' }); await ferr($, 'Read', { agentId: 'a1' }); await drena(m)
  expect(ultimoStdin(m).acoes.a1).toMatchObject({ texto: 'lendo 3 arquivos', fonte: 'tool' })
  await ferr($, 'Edit', { agentId: 'a1' }); await m.clock.advance(2000); await drena(m)
  expect(ultimoStdin(m).acoes.a1.texto).toBe('editando 1 arquivo')
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' }); await m.clock.advance(2000); await drena(m)
  expect(ultimoStdin(m).acoes.a1).toMatchObject({ texto: 'rodando 1 comando', fonte: 'tool' })
  await ferr($, 'Agent', { agentId: 'a1', subagent_type: 'revisor', description: 'd', prompt: 'p' }); await m.clock.advance(2000); await drena(m)
  expect(ultimoStdin(m).acoes.a1.texto).toBe('chamando revisor')
})
test('acao-sem-fonte-fica-de-fora: ferramenta fora da tabela não inventa ação (nunca frase fixa)', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await ferr($, 'Monitor', { agentId: 'a1' }); await ferr($, 'SubagentHandback', { agentId: 'a1' }); await drena(m)
  expect(ultimoStdin(m).acoes).toEqual({})
  await bash($, { agentId: 'a1', description: 'compilar' }); await drena(m)
  await ferr($, 'Monitor', { agentId: 'a1' }); await drena(m)
  expect(ultimoStdin(m).acoes.a1.texto).toBe('compilar') // a última ação conhecida fica; a que não se sabe dizer não a apaga
})
test('acao-higieniza-a-description: controles saem e passa de 120 caracteres corta', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await bash($, { agentId: 'a1', description: `ver\u0000 tudo\u202E ${'x'.repeat(300)}` }); await drena(m)
  const t = ultimoStdin(m).acoes.a1.texto as string
  expect(t.startsWith('ver tudo xxx')).toBe(true)
  expect([...t].length).toBeLessThanOrEqual(120)
  expect(/[\u0000-\u001f\u202e]/.test(t)).toBe(false)
})
test('tool-call-sem-agentid-e-do-orquestrador: nada em acoes; o resultado do motor passa intacto', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')], resultadoTool: { stdout: 'ok', marca: 7 } })
  await arrancar(m)
  const r = await bash($); await drena(m)
  expect(r).toEqual({ result: { stdout: 'ok', marca: 7 } })
  expect(ultimoStdin(m).acoes).toEqual({})
})
test('tool-call-agentid-fora-do-padrao: id com barra não entra', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await bash($, { agentId: '../x' }); await bash($, { agentId: 42 }); await drena(m)
  expect(ultimoStdin(m).acoes).toEqual({})
})
test('acoes-teto-64: o 65º agente tira o mais antigo', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  for (let i = 0; i < 66; i++) await bash($, { agentId: `ag-${i}` })
  await drena(m)
  const k = Object.keys(ultimoStdin(m).acoes)
  expect(k).toHaveLength(64)
  expect(k).not.toContain('ag-0'); expect(k).not.toContain('ag-1'); expect(k).toContain('ag-65')
})
test('acao-nao-interativo: -p não guarda nada nem chama a ponte', async ($, on) => {
  const m = comPainel($, on, {}, { interativo: false, agentesPainel: [AG('a1')] })
  await arrancar(m)
  await bash($, { agentId: 'a1' }); await drena(m)
  expect(stdinsPainel(m)).toHaveLength(0)
})
test('acao-no-fim-da-rajada-chega: 2 ações em menos de 2 s ⇒ a última aparece 2 s depois, sem esperar os 60 s', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await bash($, { agentId: 'a1', description: 'primeira' }); await drena(m)
  await bash($, { agentId: 'a1', description: 'segunda' })
  await m.clock.advance(1000); await drena(m)
  expect(ultimoStdin(m).acoes.a1.texto).toBe('primeira')
  await m.clock.advance(1000); await drena(m)
  expect(ultimoStdin(m).acoes.a1.texto).toBe('segunda')
})
test('acao-redesenha-sem-esperar-o-relogio: a ação nova chega ao stdin antes do 60 s', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  const antes = stdinsPainel(m).length
  await bash($, { agentId: 'a1' }); await drena(m)
  expect(stdinsPainel(m).length).toBeGreaterThan(antes)
})
test('subagentstop-sai-na-hora: a lista já diz completed ⇒ o stop reconsulta e o id entra em encerrados, sem esperar o relógio', async ($, on) => {
  const lista = [AG('a1')]
  const m = comPainel($, on, {}, { agentesPainel: lista })
  await arrancar(m)
  expect(ultimoStdin(m).encerrados).toEqual([])
  const antes = stdinsPainel(m).length
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', background_tasks: [] }) // S13: no instante do stop a lista ainda diz running
  await drena(m)
  expect(ultimoStdin(m).encerrados).toEqual([])
  await m.clock.advance(210); lista[0].status = 'completed'; await drena(m) // S13: completed ~210 ms depois do stop
  await m.clock.advance(190); await drena(m) // 400 ms no total: ESPERA_STOP_MS, nunca o relógio de 60 s
  expect(stdinsPainel(m).length).toBeGreaterThan(antes)
  expect(ultimoStdin(m).encerrados).toEqual(['a1'])
})
test('subagentstop-sozinho-nao-encerra: a lista ainda diz running (S13: o stop chega antes) ⇒ não vai a encerrados', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', background_tasks: [] }); await drena(m)
  expect(ultimoStdin(m).encerrados).toEqual([])
})
test('encerrado-que-volta-a-running-sai-de-encerrados: SendMessage retoma o agente (S13, 1/6)', async ($, on) => {
  const lista = [AG('a1', 'completed')]
  const m = comPainel($, on, {}, { agentesPainel: lista })
  await arrancar(m)
  expect(ultimoStdin(m).encerrados).toEqual(['a1'])
  lista[0].status = 'running'
  await turnoVia(m, $)
  expect(ultimoStdin(m).encerrados).toEqual([])
})
test('subagentstart-tira-de-encerrados: o agente que recomeça não fica escondido', async ($, on) => {
  const lista = [AG('a1', 'completed')]
  const m = comPainel($, on, {}, { agentesPainel: lista })
  await arrancar(m)
  expect(ultimoStdin(m).encerrados).toEqual(['a1'])
  await subStart($, { agent_id: 'a1' })
  lista[0].status = 'completed' // a lista ainda não mudou, mas o start vale até a próxima leitura dela dizer o contrário
  await $.classic.SubagentStop({ agent_id: 'zz', agent_type: '', background_tasks: [] }); await drena(m)
  expect(ultimoStdin(m).encerrados).toEqual(['a1']) // a lista manda: completed de novo
})
test('encerrado-perde-a-acao: a ação de quem terminou sai do stdin', async ($, on) => {
  const lista = [AG('a1')]
  const m = comPainel($, on, {}, { agentesPainel: lista })
  await arrancar(m)
  await bash($, { agentId: 'a1' }); await drena(m)
  expect(Object.keys(ultimoStdin(m).acoes)).toEqual(['a1'])
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', background_tasks: [] }); await drena(m) // S13: ainda running no stop
  await m.clock.advance(210); lista[0].status = 'completed'; await drena(m)
  await m.clock.advance(190); await drena(m)
  expect(ultimoStdin(m).acoes).toEqual({})
})
test('releitura-ao-vivo-nao-mede: rajada de tool.call refaz o estado mas não chama `painel.mjs medir` (gh) a cada chamada', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  const medirAntes = m.est.medirStdins.length
  const estadosAntes = stdinsPainel(m).length
  for (let i = 0; i < 30; i++) { await bash($, { agentId: 'a1', description: `passo ${i}` }); await m.clock.advance(500); await drena(m) } // 15 s de rajada
  expect(stdinsPainel(m).length).toBeGreaterThan(estadosAntes + 3) // a releitura ao vivo continua refazendo o estado
  expect(m.est.medirStdins.length - medirAntes).toBe(0)
})
test('medir-segue-no-ritmo-proprio: o relógio de 60 s ainda mede, mesmo com ações ao vivo no meio', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  const medirAntes = m.est.medirStdins.length
  await bash($, { agentId: 'a1' }); await m.clock.advance(2000); await drena(m)
  expect(m.est.medirStdins.length - medirAntes).toBe(0)
  await m.clock.advance(60000); await drena(m)
  expect(m.est.medirStdins.length - medirAntes).toBeGreaterThanOrEqual(1)
})
test('acao-e-segundo-plano-levam-a-hora-de-agora: em/desde = o relógio no momento do evento, não 0', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')], resultadoTool: (e: any) => (e.run_in_background === true ? { backgroundTaskId: 'bg9' } : {}) })
  await arrancar(m)
  await m.clock.advance(12345); await drena(m)
  const t1 = (m.clock as any).now()
  expect(t1).toBeGreaterThan(10000)
  await bash($, { agentId: 'a1', description: 'agora' }); await drena(m)
  expect(ultimoStdin(m).acoes.a1.em).toBe(Math.round(t1))
  await m.clock.advance(7000)
  const t2 = (m.clock as any).now()
  await bash($, { run_in_background: true, description: 'fundo' }); await drena(m)
  expect(ultimoStdin(m).segundoPlano[0].desde).toBe(Math.round(t2))
})
const turnoVia = async (m: ReturnType<typeof mundo>, $: any) => { await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't9', reason: 'answer' }); await drena(m) }

test('segundo-plano-aparece-e-sai: Bash em segundo plano do orquestrador entra com o id do resultado e sai quando o Stop não o lista mais', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')], resultadoTool: (e: any) => (e.run_in_background === true ? { backgroundTaskId: 'bg1' } : {}) })
  await arrancar(m)
  await bash($, { run_in_background: true, description: 'esperar s14' }); await drena(m)
  const sp = ultimoStdin(m).segundoPlano
  expect(sp).toHaveLength(1)
  expect(sp[0]).toMatchObject({ id: 'bg1', dono: 'orquestrador', texto: 'esperar s14' })
  expect(Number.isSafeInteger(sp[0].desde)).toBe(true)
  await $.classic.Stop({ background_tasks: [{ id: 'bg1', type: 'shell', status: 'running', description: 'esperar s14' }] }); await drena(m)
  expect(ultimoStdin(m).segundoPlano).toHaveLength(1) // ainda lá: o item segue no Stop
  await $.classic.Stop({ background_tasks: [] }); await drena(m)
  expect(ultimoStdin(m).segundoPlano).toEqual([])
})
test('segundo-plano-de-subagente: dono = o agentId; sai pelo background_tasks do SubagentStop', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')], resultadoTool: (e: any) => (e.run_in_background === true ? { backgroundTaskId: 'bg2' } : {}) })
  await arrancar(m)
  await bash($, { agentId: 'a1', run_in_background: true, description: 'esperar sub' }); await drena(m)
  expect(ultimoStdin(m).segundoPlano).toEqual([expect.objectContaining({ id: 'bg2', dono: 'a1', texto: 'esperar sub' })])
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }] }); await m.clock.advance(400); await drena(m)
  expect(ultimoStdin(m).segundoPlano).toEqual([])
})
test('segundo-plano-sem-description-usa-o-comando: texto = o comando cortado, nunca inventado', async ($, on) => {
  const m = comPainel($, on, {}, { resultadoTool: { backgroundTaskId: 'bg3' } })
  await arrancar(m)
  await $.tool.call({ tool: 'Bash', command: `sleep 25; ${'y'.repeat(300)}`, run_in_background: true }); await drena(m)
  const t = ultimoStdin(m).segundoPlano[0].texto as string
  expect(t.startsWith('sleep 25; yyy')).toBe(true)
  expect([...t].length).toBeLessThanOrEqual(120)
})
test('segundo-plano-leva-o-comando (g.11): o comando cortado em 400 e sem controle vai no item, para o painel rotular o shell; sem comando o item não leva o campo', async ($, on) => {
  const m = comPainel($, on, {}, { resultadoTool: (e: any) => ({ backgroundTaskId: e.description === 'sem cmd' ? 'bg8' : 'bg7' }) })
  await arrancar(m)
  await $.tool.call({ tool: 'Bash', command: `node loop.mjs integrar T16\u0007 ${'z'.repeat(600)}`, description: 'integrar T16', run_in_background: true }); await drena(m)
  const it = ultimoStdin(m).segundoPlano[0]
  expect(it.texto).toBe('integrar T16')
  expect(it.comando.startsWith('node loop.mjs integrar T16  zzz')).toBe(true)
  expect([...it.comando].length).toBeLessThanOrEqual(400)
  expect(it.comando).not.toMatch(/\u0007/)
  await $.tool.call({ tool: 'Bash', description: 'sem cmd', run_in_background: true }); await drena(m)
  expect(ultimoStdin(m).segundoPlano.find((x: any) => x.id === 'bg8')).not.toHaveProperty('comando')
})
test('segundo-plano-so-com-backgroundTaskId: Bash em primeiro plano, id fora do padrão e outra ferramenta não entram', async ($, on) => {
  const m = comPainel($, on, {}, { resultadoTool: (e: any) => (e.tool === 'Bash' && e.command === 'ruim' ? { backgroundTaskId: '../x' } : e.tool === 'Monitor' ? { backgroundTaskId: 'm1' } : {}) })
  await arrancar(m)
  await bash($); await $.tool.call({ tool: 'Bash', command: 'ruim' }); await ferr($, 'Monitor'); await drena(m)
  expect(ultimoStdin(m).segundoPlano).toEqual([])
})
test('segundo-plano-teto-64: o 65º tira o mais antigo', async ($, on) => {
  let n = 0
  const m = comPainel($, on, {}, { resultadoTool: () => ({ backgroundTaskId: `bg-${n++}` }) })
  await arrancar(m)
  for (let i = 0; i < 66; i++) await bash($, { run_in_background: true })
  await drena(m)
  const ids = ultimoStdin(m).segundoPlano.map((x: any) => x.id)
  expect(ids).toHaveLength(64)
  expect(ids).not.toContain('bg-0'); expect(ids).toContain('bg-65')
})
test('stop-sem-lista-nao-apaga: Stop sem background_tasks (ou não lista) não tira o segundo plano', async ($, on) => {
  const m = comPainel($, on, {}, { resultadoTool: { backgroundTaskId: 'bg1' } })
  await arrancar(m)
  await bash($, { run_in_background: true }); await drena(m)
  await $.classic.Stop({}); await $.classic.Stop({ background_tasks: 'x' }); await drena(m)
  expect(ultimoStdin(m).segundoPlano).toHaveLength(1)
})
test('stdin-com-acoes-encerrados-segundo-plano: a forma que o CLI de T29 aceita (validarStdinAgentes real)', async ($, on) => {
  const lista = [AG('a1'), AG('a2', 'completed')]
  const m = comPainel($, on, {}, { agentesPainel: lista, resultadoTool: (e: any) => (e.run_in_background === true ? { backgroundTaskId: 'bg1' } : {}) })
  await arrancar(m)
  await bash($, { agentId: 'a1' }); await bash($, { run_in_background: true }); await ferr($, 'Read', { agentId: 'a2' }); await drena(m)
  const s = ultimoStdin(m)
  expect(Object.keys(s)).toEqual(expect.arrayContaining(['acoes', 'encerrados', 'segundoPlano', 'nomes']))
  const v = validarStdinAgentes(s) as any
  expect(v.erro).toBeUndefined()
  expect(v.ok).toBe(true)
  expect(v.valor.acoes.a1.texto).toBe('listar arquivos')
  expect(v.valor.encerrados).toEqual(['a2'])
  expect(v.valor.segundoPlano).toHaveLength(1)
  expect(v.valor.acoes.a2).toBeUndefined() // a2 terminou: sua ação não entra
})
test('medir-recebe-o-mesmo-stdin: `medir --agentes` leva acoes, encerrados e segundoPlano (um pedido só)', async ($, on) => {
  const m = comPainel($, on, {}, { agentesPainel: [AG('a1')] })
  await arrancar(m)
  await bash($, { agentId: 'a1' }); await drena(m)
  await turnoVia(m, $) // a medição segue o ritmo próprio (turno), não a releitura ao vivo
  const med = m.est.medirStdins[m.est.medirStdins.length - 1].stdin
  expect(med.acoes.a1.texto).toBe('listar arquivos')
  expect(med.encerrados).toEqual([])
  expect(med.segundoPlano).toEqual([])
})


// ======================================================================================================================================
// GM-14 T53 (emendas 52 e 53, REQ-POU-1, FIEL-14): o mod pousa no teto sem depender do dono. Invariante POR SESSÃO (ciclo 3):
//   I1 uma sessão só despacha com a PRÓPRIA leitura abaixo de X (depois do pouso, em X ou acima nega tudo, revisor incluído); nada de outra sessão a libera;
//   I2 cada sessão em X ou acima com 0 vivos pousa A SI MESMA; I3 até 3 tentativas por fronteira, no diário, de qualquer sessão, depois `sem_pouso` uma vez;
//   I4 sem janela de tempo: ≥ X é sempre "não despacha".
// Tempo: o mod mede com a hora que a ponte devolve (`agora`); o mock a dá (`est.agoraMs`), que anda com `avancar`/`clock.advance` e 1 s a cada gravação.
// Nenhum teste de espera depende do dia em que roda: os eventos nascem RELATIVOS à base do mock.
// ======================================================================================================================================
const BASE = Date.UTC(2026, 10, 14, 12, 0, 0)
const EVT = (seq: number, tipo: string, dados: Record<string, unknown>, atrasoMs: number, sessao = 's0') =>
  ({ seq, ts: new Date(BASE - atrasoMs).toISOString(), autor: 'a', sessao, agente: 'o', tipo, dados, hash_anterior: null })
/** a sequência real do incidente de 2026-11-14 ~10:05: veredito, `loop.mjs pousar` (via dono, sem --sessao) SEM /clear, contexto ainda acima de X */
const INCIDENTE = (atrasoMs = 600_000) => [
  EVT(1, 'task.iniciada', { task: 'a', papel: 'implementador' }, atrasoMs + 3000), EVT(2, 'task.concluida', { task: 'a', sha: 'x' }, atrasoMs + 2000),
  EVT(3, 'review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, atrasoMs + 1000),
  EVT(4, 'sessao.pouso', { percent: null, x: 50, via: 'dono' }, atrasoMs, 'loop'),
]
/** o pouso foi da sessão real `sess-A` (10 min atrás) e o /clear dela não limpou */
const POUSOU_A = (...mais: any[]) => [
  EVT(1, 'task.iniciada', { task: 'a', papel: 'implementador' }, 603_000), EVT(2, 'task.concluida', { task: 'a', sha: 'x' }, 602_000),
  EVT(3, 'review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, 601_000),
  EVT(4, 'sessao.pouso', { percent: 61, x: 50 }, 600_000, 'sess-A'), ...mais,
]
const tentativas = (m: ReturnType<typeof mundo>) => m.grav.filter((g) => g.tipo === 'sessao.pouso.tentativa').map((g) => (g.dados as any).n)
const nega = async (m: ReturnType<typeof mundo>) => {
  for (const tipo of ['gabarito-implementador', 'gabarito-mestre:gabarito-implementador', 'gabarito-revisor', 'gabarito-mestre:gabarito-revisor', undefined]) {
    expect((await m.agent(tipo)).deny).toMatch(/pouso/)
  }
}
const libera = async (m: ReturnType<typeof mundo>) => {
  for (const tipo of ['gabarito-implementador', 'gabarito-revisor']) expect((await m.agent(tipo)).deny).toBeUndefined()
}
/** a vigia de 30 s e a espera de 60 s correm pelo relógio do mock: `n` passos de `ms` sem nenhum turno */
const passos = async (m: ReturnType<typeof mundo>, n: number, ms = 61_000) => { for (let i = 0; i < n; i++) await m.avancar(ms) }

test('pousar-manual-nao-consome-com-mod: sessao.pouso do dono sem /clear não libera a sessão que segue em X ou acima: todo Agent negado, revisor incluído', async ($, on) => {
  const m = mundo($, on, { eventos: INCIDENTE(), percent: 61, agora: BASE })
  await nega(m)
  expect(m.est.clears).toBe(0) // o Agent não roda /clear
})

test('teto-zero-vivos-nega-agent: contexto ≥ X, fronteira aberta, 0 vivos ⇒ Agent negado', async ($, on) => {
  const zero = mundo($, on, { percent: 60, agentes: [] })
  expect((await zero.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  expect((await zero.agent(undefined)).deny).toMatch(/pouso/)
})
test('teto-com-vivos-nega-agent: contexto ≥ X, fronteira aberta, 2 vivos ⇒ Agent negado', async ($, on) => {
  const dois = mundo($, on, { percent: 60, agentes: [{ id: 'a1', status: 'running' }, { id: 'a2', status: 'waiting' }] })
  expect((await dois.agent('gabarito-implementador')).deny).toMatch(/pouso/)
})

test('reproduz-incidente: pousar manual, sem /clear, contexto 61 % ⇒ nada despacha; o mod pousa sozinho (tentativa 2) e a sessão nova, abaixo de X, despacha', async ($, on) => {
  const m = mundo($, on, { eventos: INCIDENTE(), percent: 61, agora: BASE })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/) // antes da T53 o Agent passava aqui: 8 agentes acima do teto
  await m.turno(); await m.clock.settle() // 0 vivos, o pouso manual é de 10 min atrás: o mod não espera o dono
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(0) // a repetição não é um pouso novo
  expect(m.est.submits).toHaveLength(1)
  await libera(m) // a sessão nova mede 5 < X
})

test('abaixo-de-x-libera-e-em-x-nunca: a sessão nova abaixo de X despacha; voltando a X ou acima, nega de novo, sem janela de tempo (I1, I4)', async ($, on) => {
  const m = mundo($, on)
  await pousar(m) // pouso do mod (percent 60) + /clear: sessão nova a 5 %
  await libera(m)
  for (const depois of [0, 10_000, 200_000, 3_600_000]) {
    await m.avancar(depois)
    m.est.percent = 80
    await nega(m)
  }
  m.est.percent = 5
  await libera(m)
})

test('clear-falho-repete: /clear que deixa 60 % = a sessão nova pousa a si mesma; só depois de 60 s, SEM turno nenhum (n=2)', async ($, on) => {
  const m = mundo($, on, { percentPosClear: 60, agora: BASE })
  await pousar(m)
  expect(m.est.clears).toBe(1)
  await nega(m)
  await m.turno(); await m.clock.settle() // espera ainda não vencida (poucos segundos do pouso): nada de repetir
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([])
  await m.avancar(30_000) // vigia: ainda < 60 s do pouso
  expect(m.est.clears).toBe(1)
  await m.avancar(31_000) // vencida: a vigia repete sozinha, sem nenhum turn.complete
  expect(m.est.clears).toBe(2)
  expect(tentativas(m)).toEqual([2])
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(parou(m)).toHaveLength(0)
})

test('sem-turno-a-vigia-repete: o pouso manual é recente, nenhum turno vem; a vigia espera os 60 s e repete', async ($, on) => {
  const m = mundo($, on, { eventos: INCIDENTE(20_000), percent: 61, agora: BASE })
  await m.inicio()
  await m.turno(); await m.clock.settle() // pouso de 20 s atrás: espera
  expect(m.est.clears).toBe(0)
  await m.avancar(30_000) // 50 s do pouso
  expect(m.est.clears).toBe(0)
  expect(tentativas(m)).toEqual([])
  await nega(m) // nenhum despacho entre as tentativas
  await m.avancar(35_000) // 85 s, sem nenhum turno
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
})

test('teto-3-tentativas-para-sem-pouso: 3 tentativas e a conversa segue em X ⇒ loop.parar sem_pouso UMA vez, aviso, nenhuma 4ª (tudo pela vigia, sem turno)', async ($, on) => {
  const m = mundo($, on, { percentPosClear: 60, agora: BASE })
  await pousar(m)
  await passos(m, 3) // 1ª repetição, 2ª, e a decisão que desiste
  expect(m.est.clears).toBe(3) // pouso + 2 repetições = 3 tentativas
  expect(tentativas(m)).toEqual([2, 3])
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(parou(m)).toHaveLength(1)
  expect(parou(m)[0].dados).toEqual({ motivo: 'sem_pouso', causa: 'sem_confirmacao' })
  expect(m.toasts.some((t) => /depois de 3 tentativas/.test(t))).toBe(true)
  for (let i = 0; i < 4; i++) { await m.avancar(61_000); await m.turno(); await m.clock.settle() }
  expect(m.est.clears).toBe(3) // nenhuma 4ª
  expect(parou(m)).toHaveLength(1) // o push do PAROU é um só
  // a conversa cai abaixo de X e volta: a mesma fronteira, a mesma contagem; o loop já parou e `sem_pouso` não se grava de novo
  m.est.percent = 10; await m.turno(); await m.clock.settle()
  m.est.percent = 60; await m.turno(); await m.clock.settle()
  expect(parou(m)).toHaveLength(1)
  expect(m.est.clears).toBe(3)
})

test('R3-D laço-com-submit-falho (I3, MAJOR-4): o submit da retomada falha e o /clear deixa 70 % ⇒ no máximo 3 /clears, 1 sessao.pouso, sem_pouso uma vez', async ($, on) => {
  const m = mundo($, on, { submitFalha: true, percentPosClear: 70, agora: BASE })
  await pousar(m)
  for (let i = 0; i < 12; i++) { await m.turno(); await m.clock.settle(); await m.avancar(61_000) }
  expect(m.est.clears).toBe(3)
  expect(m.tipos().filter((t) => t === 'sessao.pouso')).toHaveLength(1)
  expect(tentativas(m)).toEqual([2, 3])
  expect(parou(m)).toHaveLength(1)
})
test('R3-D2 laço-com-sessao.inicio-clear: com o evento de /clear do onboarding o limite é o mesmo', async ($, on) => {
  let mm: any
  const m = mundo($, on, { submitFalha: true, percentPosClear: 70, agora: BASE, aoClear: () => { mm.add('sistema', 'sessao.inicio', { origem: 'clear' }, `${mm.est.sessaoId}-n`) } })
  mm = m
  await pousar(m)
  for (let i = 0; i < 12; i++) { await m.turno(); await m.clock.settle(); await m.avancar(61_000) }
  expect(m.est.clears).toBe(3)
  expect(tentativas(m)).toEqual([2, 3])
  expect(parou(m)).toHaveLength(1)
})
test('R3-D3 laço-submit-ok: /clear que não baixa (70 %), submit ok, com e sem turnos ⇒ 3 /clears e sem_pouso', async ($, on) => {
  const m = mundo($, on, { percentPosClear: 70, agora: BASE })
  await pousar(m)
  await passos(m, 12)
  for (let i = 0; i < 6; i++) { await m.turno(); await m.clock.settle(); await m.avancar(61_000) }
  expect(m.est.clears).toBe(3)
  expect(tentativas(m)).toEqual([2, 3])
  expect(parou(m)).toHaveLength(1)
})
test('R3-D4 misto: o 1º /clear troca a sessão e deixa 70 %, os seguintes não trocam ⇒ ainda no máximo 3 /clears', async ($, on) => {
  const m = mundo($, on, { agora: BASE, percentPosClear: 70 })
  await pousar(m)
  let n = 0
  for (let i = 0; i < 14; i++) {
    await m.avancar(61_000)
    if (m.est.clears > 1 && n === 0) n = 1
    if (n) { m.est.sessaoId = 'sess-1-n'; m.est.percent = 70 }
    await m.turno(); await m.clock.settle()
  }
  expect(m.est.clears).toBeLessThanOrEqual(3)
  expect(parou(m)).toHaveLength(1)
})

test('R3-A pouso-de-B-nao-libera-A: A (que pousou, o /clear dela não limpou, 61 %) segue negada mesmo com o pouso de B e B-n a 5 %', async ($, on) => {
  const evs = POUSOU_A(EVT(5, 'sessao.pouso', { percent: 61, x: 50 }, 30_000, 'sess-B'), EVT(6, 'sessao.retomada', { via: 'mod', chars: 5 }, 25_000, 'sess-B-n'))
  const m = mundo($, on, { eventos: evs, percent: 61, agora: BASE, sessaoId: 'sess-A' })
  await nega(m)
})
test('R3-A0 controle: A a 61 % sem o pouso de B também é negada', async ($, on) => {
  const m = mundo($, on, { eventos: POUSOU_A(), percent: 61, agora: BASE, sessaoId: 'sess-A' })
  await nega(m)
})
test('R3-B pouso-sem-sessao-nao-prende-ninguem: pouso `loop` e a paralela B a 10 % não é negada, não se limpa e não repete', async ($, on) => {
  const m = mundo($, on, { eventos: INCIDENTE(), percent: 10, agora: BASE, sessaoId: 'sess-B' })
  await m.inicio()
  await libera(m)
  await m.turno(); await m.clock.settle(); await m.avancar(30_000); await m.avancar(61_000)
  expect(m.est.clears).toBe(0)
  expect(tentativas(m)).toEqual([])
})
test('R3-B2 B se limpou e B-n mede 5 %: A (61 %, onde o dono rodou pousar) continua negada', async ($, on) => {
  const evs = [...INCIDENTE(), { ...EVT(5, 'sessao.pouso.tentativa', { n: 2 }, 20_000), sessao: 'sess-B' }, { ...EVT(6, 'sessao.retomada', { via: 'mod', chars: 5 }, 15_000), sessao: 'sess-B-n' }]
  const m = mundo($, on, { eventos: evs, percent: 61, agora: BASE, sessaoId: 'sess-A' })
  await nega(m)
})
test('R3-C sucessora-em-X-com-vivo: sessão nova a 61 % com agente vivo é negada em +0, +100 s e +200 s (sem janela, I4), sem tentativa', async ($, on) => {
  const vivos: any[] = []
  const m = mundo($, on, { percentPosClear: 61, agora: BASE, agentes: vivos })
  await pousar(m)
  vivos.push({ id: 'v1', status: 'running' })
  await nega(m)
  await m.avancar(100_000); await nega(m)
  await m.avancar(100_000); await nega(m)
  expect(tentativas(m)).toEqual([])
  expect(m.est.clears).toBe(1)
})
test('R3-C2 sucessora-em-X-com-pausa: o arquivo de pausa por 200 s não a libera; depois da pausa ela pousa de novo e nunca despacha em X', async ($, on) => {
  const PAUSA = `${PRINCIPAL}/.harness/PAU` + 'SAR'
  const m = mundo($, on, { percentPosClear: 61, agora: BASE })
  await pousar(m)
  m.arquivos.add(PAUSA)
  await m.avancar(200_000)
  m.arquivos.delete(PAUSA)
  await nega(m)
  await m.turno(); await m.clock.settle(); await m.avancar(61_000)
  expect(tentativas(m)).toEqual([2, 3])
})
test('alheia-com-clear-nao-libera-a-que-pousou: C alheia dá /clear; A (61 %) segue negada; C baixa segue livre', async ($, on) => {
  const clearC = EVT(5, 'sessao.inicio', { origem: 'clear' }, 597_000, 'sess-C')
  await nega(mundo($, on, { eventos: POUSOU_A(clearC), percent: 61, agora: BASE, sessaoId: 'sess-A' }))
})
test('alheia-baixa-livre: a sessão C alheia, abaixo de X, despacha e não repete o pouso de A', async ($, on) => {
  const clearC = EVT(5, 'sessao.inicio', { origem: 'clear' }, 597_000, 'sess-C')
  const m = mundo($, on, { eventos: POUSOU_A(clearC), percent: 5, agora: BASE, sessaoId: 'sess-C' })
  await m.inicio()
  await libera(m)
  await m.turno(); await m.clock.settle()
  expect(tentativas(m)).toEqual([])
  expect(m.est.clears).toBe(0)
})
test('paralela-no-teto-pousa-a-si-mesma (I2): B paralela em 61 % nega o despacho e pousa a PRÓPRIA conversa (tentativa 2 da contagem da fronteira); nunca por A', async ($, on) => {
  const m = mundo($, on, { eventos: POUSOU_A(), percent: 61, agora: BASE, sessaoId: 'sess-B' })
  await m.inicio()
  expect((await m.agent('gabarito-implementador')).deny).toMatch(/pouso/)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
})
test('paralela-baixa-livre: B abaixo de X sem relação com o pouso despacha', async ($, on) => {
  const m = mundo($, on, { eventos: POUSOU_A(), percent: 10, agora: BASE, sessaoId: 'sess-B' })
  await libera(m)
})

// GM-14 T59 (emenda 67, MAJOR-1 do review final): pouso da fronteira já feito, contexto de volta a X ou acima e task `concluida` à espera do revisor.
// Antes da T59 o mod nega todo Agent (revisor incluído) e o núcleo devolvia `despachar revisor`, nunca `pousar`: só o /clear manual saía do impasse.
/** pouso de A feito, `a` integrada e `b` concluída (revisor pendente): o diário do impasse */
const IMPASSE = () => POUSOU_A(
  EVT(5, 'task.integrada', { task: 'a', sha: 'd' }, 500_000),
  EVT(6, 'task.iniciada', { task: 'b', papel: 'implementador' }, 400_000), EVT(7, 'task.concluida', { task: 'b', sha: 'y' }, 390_000),
)
test('T59-impasse-0-vivos-pousa: POUSOU_A + a integrada + b concluída, 61 %, 0 vivos ⇒ o mod pousa (/clear, tentativa 2); nunca despacha o revisor', async ($, on) => {
  const m = mundo($, on, { eventos: IMPASSE(), percent: 61, agora: BASE, sessaoId: 'sess-A', agentes: [] })
  await m.inicio()
  await nega(m) // revisor incluído
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
  expect(m.est.submits).toHaveLength(1)
  await libera(m) // a sessão nova mede 5 < X
})
test('T59-impasse-com-dono-aberto-pousa: o mesmo impasse com a conversa do dono aberta (dono.mensagem), 61 %, 0 vivos ⇒ 1 /clear (emenda 52 c); o revisor segue negado (pousoPendente na 2ª chamada do núcleo, pousariaSemDono)', async ($, on) => {
  const m = mundo($, on, { eventos: IMPASSE(), percent: 61, agora: BASE, sessaoId: 'sess-A', agentes: [] })
  await m.inicio()
  await m.dono(); await m.clock.settle()
  await nega(m) // revisor incluído
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
})
test('T59-impasse-pela-vigia-sem-turno: o mesmo impasse sai pela vigia de 30 s, sem nenhum fim de turno depois', async ($, on) => {
  const m = mundo($, on, { eventos: IMPASSE(), percent: 61, agora: BASE, sessaoId: 'sess-A', agentes: [] })
  await m.inicio()
  await nega(m) // o 1º Agent já arma a vigia
  await passos(m, 2)
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
})
test('T59-impasse-com-vivos-espera: o mesmo impasse com agente vivo ⇒ espera, sem /clear e sem despachar o revisor; ao terminar o vivo, pousa', async ($, on) => {
  const vivos: any[] = [{ id: 'v1', status: 'running' }]
  const m = mundo($, on, { eventos: IMPASSE(), percent: 61, agora: BASE, sessaoId: 'sess-A', agentes: vivos })
  await m.inicio()
  await nega(m)
  await m.turno(); await m.clock.settle(); await m.avancar(61_000)
  expect(m.est.clears).toBe(0)
  expect(tentativas(m)).toEqual([])
  await nega(m) // nunca o revisor
  vivos.length = 0
  await passos(m, 2)
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([2])
})
test('T59-controle-fronteira-aberta-abaixo-de-x: o impasse com a sessão a 10 % não pousa e o revisor passa', async ($, on) => {
  const m = mundo($, on, { eventos: IMPASSE(), percent: 10, agora: BASE, sessaoId: 'sess-A', agentes: [] })
  await m.inicio()
  await libera(m)
  await m.turno(); await m.clock.settle()
  expect(m.est.clears).toBe(0)
})

test('vivo-por-mais-de-1h: agente vivo por 70 min não derruba a vigia; ao terminar o mod repete e chega a sem_pouso, sem turno', async ($, on) => {
  const vivos: any[] = []
  const m = mundo($, on, { clearNaoLimpa: true, agora: BASE, agentes: vivos })
  await pousar(m) // pouso (tentativa 1) e o /clear não faz nada (o incidente): mesma sessão, ainda em 60 %
  expect(m.est.clears).toBe(1)
  vivos.push({ id: 'a2', status: 'running' })
  await m.avancar(4_200_000)
  expect(m.est.clears).toBe(1)
  expect(tentativas(m)).toEqual([])
  vivos.length = 0
  await passos(m, 4)
  expect(tentativas(m)).toEqual([2, 3])
  expect(parou(m).map((g) => g.dados.motivo)).toEqual(['sem_pouso'])
})
test('pausa-por-mais-de-1h: o arquivo de pausa por 70 min também não derruba a vigia', async ($, on) => {
  const PAUSA = `${PRINCIPAL}/.harness/PAU` + 'SAR'
  const m = mundo($, on, { clearNaoLimpa: true, agora: BASE })
  await pousar(m)
  m.arquivos.add(PAUSA)
  await m.avancar(4_200_000)
  expect(m.est.clears).toBe(1)
  m.arquivos.delete(PAUSA)
  await passos(m, 4)
  expect(tentativas(m)).toEqual([2, 3])
  expect(parou(m).map((g) => g.dados.motivo)).toEqual(['sem_pouso'])
})
test('entre-tentativas-tudo-negado: depois da tentativa 2 e antes da 3, implementador, correção e revisor são negados (com e sem namespace)', async ($, on) => {
  const m = mundo($, on, { percentPosClear: 60, agora: BASE })
  await pousar(m)
  await m.avancar(61_000) // tentativa 2
  expect(tentativas(m)).toEqual([2])
  await nega(m)
})

test('tentativa-nao-e-pouso: tentativa não muda seq, fronteira nem a chave do push', async ($, on) => {
  const base = INCIDENTE()
  const com = [...base, EVT(5, 'sessao.pouso.tentativa', { n: 2 }, 300_000, 'sess-1'), EVT(6, 'sessao.pouso.tentativa', { n: 3 }, 100_000, 'sess-1')]
  expect(pousoPendente(com, true)).toEqual(pousoPendente(base, true)) // mesmo seq ⇒ mesma chave do push
  expect(pousoPendente(com, true).seq).toBe(4)
  const estado = (pp: any) => ({ id: 'PBI-7', depende: [{ acoes: [{ comando: '/clear' }] }], pousoPendente: pp })
  expect(chavePouso(estado(pousoPendente(com, true)))).toBe(chavePouso(estado(pousoPendente(base, true))))
  const soTentativa = [...base.slice(0, 3), EVT(5, 'sessao.pouso.tentativa', { n: 2 }, 100_000, 'sess-1')]
  expect(pousoDaFronteira(soTentativa)).toBe(false)
  expect(pousoPendente(soTentativa, true).pendente).toBe(false)
})

// ---- a definição única (pouso-pendente.ts): por sessão ----
const PEV = (seq: number, tipo: string, dados: Record<string, unknown>, tsMs: number, sessao: string) =>
  ({ seq, ts: new Date(tsMs).toISOString(), autor: 'a', sessao, agente: 'o', tipo, dados, hash_anterior: null })
const T0 = Date.UTC(2026, 10, 14, 10, 0, 0)
const VER = PEV(3, 'review.veredito', { task: 'a', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, T0 - 1000, 's0')
const POUSO = PEV(4, 'sessao.pouso', { percent: 61, x: 50 }, T0, 'A')
const L = (sessao: string, percent: number, emMs: number, fonte = 'mod') => ({ sessao, percent, fonte, emMs })
const med = (sessaoAtual: string, leituras: any[], agoraMs: number) => ({ x: 50, agoraMs, sessaoAtual, leituras })
const pend = (evs: any[], sessao: string, leituras: any[], agoraMs: number) => pousoPendente(evs, true, med(sessao, leituras, agoraMs)).pendente

test('pura-por-sessao (I1): só a leitura PRÓPRIA decide; a de outra sessão nunca libera nem prende', async ($, on) => {
  const agora = T0 + 60_000
  expect(pend([VER, POUSO], 'A', [L('A', 61, agora - 1000)], agora)).toBe(true) // ainda em X depois do pouso
  expect(pend([VER, POUSO], 'A', [L('A', 20, agora - 1000)], agora)).toBe(false)
  expect(pend([VER, POUSO], 'A', [L('A', 50, agora - 1000)], agora)).toBe(true) // X exato: não é < X
  expect(pend([VER, POUSO], 'A', [L('A', 61, agora - 1000), L('B', 5, agora - 1000)], agora)).toBe(true) // B baixa não libera A
  expect(pend([VER, POUSO], 'B', [L('A', 61, agora - 1000), L('B', 5, agora - 1000)], agora)).toBe(false) // A alta não prende B
  // leitura própria que não vale: velha (> 120 s), do futuro (> 5 s), de fonte transcript, de outra sessão ⇒ sem leitura própria: a regra sem mod (/clear do dono)
  for (const l of [L('A', 20, agora - 130_000), L('A', 20, agora + 60_000), L('A', 20, agora - 1000, 'transcript')]) {
    expect(pend([VER, POUSO], 'A', [l], agora)).toBe(true) // sem /clear de outra sessão no diário: pendente por evento
    expect(pend([VER, POUSO, PEV(5, 'sessao.inicio', { origem: 'clear' }, T0 + 5_000, 'S9')], 'A', [l], agora)).toBe(false) // o /clear do dono libera
  }
})
test('pura-sonda-r2 (P-a, P-a2, P-b, P-c, Q1, Q2, Q3, Q4): as sondas do revisor das rodadas anteriores, com a resposta por sessão', async ($, on) => {
  const retomada = PEV(5, 'sessao.retomada', { via: 'mod', chars: 10 }, T0 + 5_000, 'A2')
  const H = 3_600_000
  // P-a: depois de um 2º /clear (S3), a leitura fresca de S3 baixa libera em +180 s e +600 s
  for (const d of [180_000, 600_000]) {
    const evs = [VER, POUSO, retomada, PEV(6, 'sessao.inicio', { origem: 'clear' }, T0 + d - 30_000, 'S3')]
    expect(pend(evs, 'S3', [L('A2', 4, T0 + 20_000), L('S3', 3, T0 + d - 1000)], T0 + d)).toBe(false)
  }
  // P-a2: A2 viva a 30 % libera; a 55 % (≥ X) não despacha: o Stop diz aguardando e o mod pousa a conversa
  expect(pend([VER, POUSO, retomada], 'A2', [L('A2', 30, T0 + 599_000)], T0 + 600_000)).toBe(false)
  expect(pend([VER, POUSO, retomada], 'A2', [L('A2', 55, T0 + 599_000)], T0 + 600_000)).toBe(true)
  // P-b: A viva a 61 % depois da tentativa de B, B2 a 5 %: A segue pendente
  const evsB = [VER, POUSO, PEV(5, 'sessao.pouso.tentativa', { n: 2 }, T0 + 130_000, 'B'), PEV(6, 'sessao.retomada', { via: 'mod', chars: 10 }, T0 + 135_000, 'B2')]
  expect(pend(evsB, 'A', [L('A', 61, T0 + 139_000), L('B2', 5, T0 + 138_000)], T0 + 140_000)).toBe(true)
  // P-c: C alheia deu /clear, A viva a 61 %: C (5 %) livre, A pendente
  const evsC = [VER, POUSO, PEV(5, 'sessao.inicio', { origem: 'clear' }, T0 + 3_000, 'C')]
  expect(pend(evsC, 'C', [L('A', 61, T0 + 59_000), L('C', 5, T0 + 58_000)], T0 + 60_000)).toBe(false)
  expect(pend(evsC, 'A', [L('A', 61, T0 + 59_000), L('C', 5, T0 + 58_000)], T0 + 60_000)).toBe(true)
  // Q1 (MAJOR-5): a sucessora fechou, o dia seguinte abre S4 por startup; S4 mede 4 %: livre
  const evsQ1 = [VER, POUSO, PEV(5, 'sessao.retomada', { via: 'mod', chars: 10 }, T0 + 5_000, 'A2'), PEV(6, 'sessao.inicio', { origem: 'startup' }, T0 + 20 * H, 'S4')]
  expect(pend(evsQ1, 'S4', [L('A2', 30, T0 + 2 * H), L('S4', 4, T0 + 20 * H + 59_000)], T0 + 20 * H + 60_000)).toBe(false)
  // Q2: A2 a 61 % em +100 s e em +190 s: nos dois casos pendente (sem janela, I4)
  for (const d of [100_000, 190_000]) expect(pend([VER, POUSO, retomada], 'A2', [L('A2', 61, T0 + d - 1000)], T0 + d)).toBe(true)
  // Q3 e Q4: o pouso de B (ou o `loop`) confirmado por B-n não libera A a 61 %
  const evsQ3 = [VER, POUSO, PEV(5, 'sessao.pouso', { percent: 61, x: 50 }, T0 + 30_000, 'B'), PEV(6, 'sessao.retomada', { via: 'mod', chars: 10 }, T0 + 35_000, 'B-n')]
  expect(pend(evsQ3, 'A', [L('A', 61, T0 + 59_000), L('B-n', 5, T0 + 58_000)], T0 + 60_000)).toBe(true)
  const evsQ4 = [VER, PEV(4, 'sessao.pouso', { percent: null, x: 50, via: 'dono' }, T0, 'loop'), PEV(5, 'sessao.pouso.tentativa', { n: 2 }, T0 + 180_000, 'B'), PEV(6, 'sessao.retomada', { via: 'mod', chars: 10 }, T0 + 185_000, 'B-n')]
  expect(pend(evsQ4, 'A', [L('A', 61, T0 + 199_000), L('B-n', 5, T0 + 198_000)], T0 + 200_000)).toBe(true)
})
test('pura-tentativas (I3): conta por fronteira, de qualquer sessão; veredito novo zera; tentativa não é pouso', async ($, on) => {
  const t = (evs: any[]) => tentativasDoPouso(evs)
  expect(t([VER])).toEqual({ n: 0, ultimoMs: null })
  expect(t([VER, POUSO]).n).toBe(1)
  expect(t([VER, POUSO, PEV(5, 'sessao.pouso.tentativa', { n: 2 }, T0 + 70_000, 'B'), PEV(6, 'sessao.pouso', { percent: 61, x: 50 }, T0 + 140_000, 'C')])).toEqual({ n: 3, ultimoMs: T0 + 140_000 }) // seq novo e sessão nova NÃO zeram
  expect(t([VER, POUSO, PEV(7, 'review.veredito', { task: 'b', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, T0 + 500_000, 's0')]).n).toBe(0) // fronteira nova
  expect(t(null)).toEqual({ n: 0, ultimoMs: null })
})
test('pura-sem-mod-o-evento-vale (FIEL-14 e, h): sem leitura própria o /clear do dono libera, mas só com onboarding; startup/resume e sessão paralela não tiram', async ($, on) => {
  expect(pousoPendente([VER, POUSO], false).pendente).toBe(false) // FIEL-14 h
  expect(pousoPendente([VER, POUSO], true).pendente).toBe(true)
  expect(pousoPendente([VER, POUSO, PEV(5, 'sessao.inicio', { origem: 'startup' }, T0 + 5_000, 'S9')], true).pendente).toBe(true)
  expect(pousoPendente([VER, POUSO, PEV(5, 'sessao.inicio', { origem: 'clear' }, T0 + 5_000, 'S9')], true).pendente).toBe(false)
  expect(pousoPendente([VER, POUSO, PEV(5, 'sessao.inicio', { origem: 'clear' }, T0 + 5_000, 'A')], true).pendente).toBe(true) // o clear da própria sessão que pousou não conta
})

test('pura-fronteira-atual (c3, MAJOR-1): o pouso de uma fronteira ANTERIOR não é pendente; a regra é a mesma `pousoDaFronteira` do mod; o `proxima` (proximaAcao com o mesmo flag) despacha o revisor em vez de pousar', async ($, on) => {
  const iniT = (seq: number, t: string, ms: number) => PEV(seq, 'task.iniciada', { task: t, papel: 'implementador' }, ms, 's0')
  const conT = (seq: number, t: string, ms: number) => PEV(seq, 'task.concluida', { task: t, sha: 'x' }, ms, 's0')
  const verT = (seq: number, t: string, ms: number) => PEV(seq, 'review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, ms, 's0')
  const intT = (seq: number, t: string, ms: number) => PEV(seq, 'task.integrada', { task: t, sha: 'd' }, ms, 's0')
  const antes = [iniT(1, 'a', T0 - 9000), conT(2, 'a', T0 - 8000), verT(3, 'a', T0 - 7000), intT(4, 'a', T0 - 6000)]
  const velho = PEV(5, 'sessao.pouso', { percent: 61, x: 50 }, T0 - 5000, 'S0')
  const nova = [iniT(6, 'b', T0 - 4000), conT(7, 'b', T0 - 3000), verT(8, 'b', T0 - 2000), intT(9, 'b', T0 - 1000)]
  const agora = T0 + 60_000
  const m = med('S1', [L('S1', 61, agora - 1000)], agora)
  // pouso da fronteira atual (depois do último veredito): pendente; fronteira nova (veredito depois do pouso): não
  expect(pousoPendente([...antes, velho], true, m).pendente).toBe(true)
  expect(pousoPendente([...antes, velho, ...nova], true, m).pendente).toBe(false)
  expect(pousoPendente([...antes, velho, ...nova], false, m).pendente).toBe(false)
  // `proxima`: com o flag da regra única, T c concluída a revisar em 61 % ⇒ despachar o revisor, nunca pousar
  const plano = { entrega: 'PBI-7', tasks: [{ id: 'a', deps: [], arquivos: ['a.ts'] }, { id: 'b', deps: [], arquivos: ['b.ts'] }, { id: 'c', deps: [], arquivos: ['c.ts'] }] } as any
  const evs = [...antes, velho, ...nova, iniT(10, 'c', T0 - 500), conT(11, 'c', T0 - 400)]
  const flag = pousoPendente(evs, true, m).pendente
  const acao: any = proximaAcao(plano, evs, { slots: 3, percent: 61, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: true, pousoPendente: flag })
  expect(flag).toBe(false)
  expect(acao.tipo).toBe('despachar')
  expect(acao.itens.map((i: any) => i.papel)).toEqual(['revisor'])
})
test('pura-x-exato-e-faixa (c3, MINOR-3): percent == X depois do pouso é pendente (>=); percent fora de [0,100] não é leitura', async ($, on) => {
  const agora = T0 + 60_000
  expect(pend([VER, POUSO], 'A', [L('A', 50, agora - 1000)], agora)).toBe(true)
  expect(pend([VER, POUSO], 'A', [L('A', 49.99, agora - 1000)], agora)).toBe(false)
  const j = (percent: number) => JSON.stringify({ percent, fonte: 'mod', em: new Date(agora - 1000).toISOString() })
  expect(lerLeitura('A', j(-5))).toBeNull()
  expect(lerLeitura('A', j(101))).toBeNull()
  expect(lerLeitura('A', j(0))).not.toBeNull()
  expect(lerLeitura('A', j(100))).not.toBeNull()
})
test('em-x-exato-nega (c3, MINOR-3): o mod nega com a leitura exatamente em X depois do pouso', async ($, on) => {
  const m = mundo($, on, { eventos: INCIDENTE(), percent: 50, agora: BASE })
  await nega(m)
})

// ---- GM-14 T60 (REQ-DIA-1, emenda 68, MAJOR-2 do review final): o mod só GRAVA em .harness/ e só CHAMA gh com onboarding ----
// Mutações: tirar o predicado de `lerContexto` (gravação do contexto) OU de `uma` (medir) derruba o teste do seu caminho.
test('t60-sem-onboarding-nao-grava-contexto: percent do mod existe, mas a ponte de gravação do contexto nunca roda (turnos e 60 s)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37, semOnboarding: true })
  await arrancar(m)
  await m.turno(); await drena(m)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.onboardings.length).toBeGreaterThanOrEqual(1)
  expect(m.est.onboardings[0].init.cwd).toBe(RAIZ)
  expect(m.est.contextos).toHaveLength(0)
  expect(m.est.painelStdins.length).toBeGreaterThanOrEqual(2) // o restante do painel segue lendo
})
test('t60-sem-onboarding-nao-mede: `painel.mjs medir` (que chama gh) nunca roda no início, no turno nem aos 60 s; o estado segue sendo lido', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { semOnboarding: true })
  await arrancar(m)
  await m.turno(); await drena(m)
  await m.clock.advance(PERIODO); await drena(m)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.medirStdins).toHaveLength(0)
  expect(m.est.painelArgv.filter((a) => a[2] === 'estado').length).toBeGreaterThanOrEqual(3)
})
test('t60-onboarding-ponte-falha-nao-grava-nem-mede: sem resposta da ponte o mod não presume onboarding (falha fechada)', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37, onboardingFalha: true })
  await arrancar(m)
  await m.turno(); await drena(m)
  expect(m.est.contextos).toHaveLength(0)
  expect(m.est.medirStdins).toHaveLength(0)
})
test('t60-com-onboarding-comportamento-atual: grava o contexto e mede, e a ponte recebe a raiz da sessão e o dist da guarda', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37 })
  await arrancar(m)
  expect(m.est.contextos.length).toBeGreaterThanOrEqual(1)
  expect(m.est.medirStdins.length).toBeGreaterThanOrEqual(1)
  expect(m.est.onboardings[0].q.raiz).toBe(RAIZ)
  expect(m.est.onboardings[0].q.url).toMatch(/^file:\/\/.*\/gates\/dist\/guarda\.js$/)
})

// GM-15 T23 (REQ-HIG-1, O1): o cache positivo de onboarding vence em 30 s; o config some ⇒ a próxima leitura periódica pergunta de novo e pára de gravar/medir.
// Mutação M23b: cache que nunca invalida (sem o teste de validade) ⇒ derruba os dois.
test('cache-onboarding-invalida-sem-config: com onboarding grava; o config some; depois do TTL o mod pergunta de novo e não grava mais', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37 })
  await arrancar(m)
  expect(m.est.contextos.length).toBeGreaterThanOrEqual(1)
  m.est.semOnboarding = true // o config sumiu
  await m.clock.advance(PERIODO); await drena(m)
  const gravados = m.est.contextos.length
  const perguntas = m.est.onboardings.length
  await m.turno(); await drena(m)
  await m.clock.advance(PERIODO); await drena(m)
  expect(m.est.onboardings.length).toBeGreaterThan(perguntas)
  expect(m.est.contextos).toHaveLength(gravados)
})
test('cache-onboarding-vale-dentro-do-ttl: com onboarding confirmado, leituras dentro do TTL não repetem a ponte', async ($, on) => {
  const m = comPainel($, on, { estado: estadoNovo() }, { percent: 37 })
  await arrancar(m)
  const perguntas = m.est.onboardings.length
  await m.turno(); await drena(m)
  expect(m.est.onboardings).toHaveLength(perguntas)
})

// ---- GM-15 T17 (REQ-POU-4): o sinal do loop automático, lido de `Stop.session_crons` (medido na T0b, S4 ii) ----
const SINAL_ARMADO_INTERVALO = { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: '/loop 5m x' }
const SINAL_ARMADO_WAKEUP = { id: 'c2', schedule: '2026-11-15T12:00:00', recurring: false, prompt: '/loop verifique pronto.txt' }
const ultimoSinal = (m: ReturnType<typeof mundo>) => JSON.parse(m.est.sinaisLoop.at(-1).q.sinal ? JSON.stringify(m.est.sinaisLoop.at(-1).q.sinal) : 'null')

test('mod-sinal-wakeup-armado: Stop com item de wakeup (recurring:false) e de intervalo ⇒ sinal armado com as contagens, gravado na raiz da sessão com a sessão do hook', async ($, on) => {
  const m = mundo($, on, {})
  await arrancar(m)
  await $.classic.Stop({ session_id: 'hook-novo-1', session_crons: [SINAL_ARMADO_WAKEUP] }); await drena(m)
  expect(m.est.sinaisLoop).toHaveLength(1)
  expect(ultimoSinal(m)).toMatchObject({ estado: 'armado', dinamico: 1, intervalo: 0, sessao: 'hook-novo-1' })
  expect(m.est.sinaisLoop[0].init.cwd).toBe(RAIZ)
  await $.classic.Stop({ session_id: 'hook-novo-1', session_crons: [SINAL_ARMADO_INTERVALO, SINAL_ARMADO_WAKEUP] }); await drena(m)
  expect(ultimoSinal(m)).toMatchObject({ estado: 'armado', dinamico: 1, intervalo: 1 })
  expect(new Date(ultimoSinal(m).em).toISOString()).toBe(ultimoSinal(m).em)
})
test('mod-sinal-wakeup-ausente: Stop com session_crons vazio ⇒ sinal ausente (gravado: o leitor distingue de "nunca medido")', async ($, on) => {
  const m = mundo($, on, {})
  await arrancar(m)
  await $.classic.Stop({ session_id: 's-1', session_crons: [] }); await drena(m)
  expect(ultimoSinal(m)).toMatchObject({ estado: 'ausente', dinamico: 0, intervalo: 0 })
})
test('mod-sinal-nao-conferivel: campo ausente, não array ou item fora da forma ⇒ nao_conferivel, nunca ausente nem armado', async ($, on) => {
  const m = mundo($, on, {})
  await arrancar(m)
  for (const e of [{}, { session_crons: 'x' }, { session_crons: null }, { session_crons: [{ id: 'c', schedule: 'x' }] }, { session_crons: [SINAL_ARMADO_WAKEUP, 7] }]) {
    await $.classic.Stop({ session_id: 's-1', ...e }); await drena(m)
    expect(ultimoSinal(m).estado).toBe('nao_conferivel')
  }
  expect(m.est.sinaisLoop).toHaveLength(5)
})
test('mod-sinal-sentinela-nao-conta: o prompt da sentinela sozinho não arma nem desarma; só o item conta (S4: a sentinela nunca aparece em 23 sessões)', () => {
  expect(sinalDoLoop({ session_crons: [] }).estado).toBe('ausente')
  expect(sinalDoLoop({ session_crons: [{ recurring: false, prompt: 'qualquer coisa' }] }).estado).toBe('armado')
  expect(sinalDoLoop({ session_crons: [{ recurring: false, prompt: '<<autonomous-loop-dynamic>>' }] }).estado).toBe('armado')
  expect(sinalDoLoop(undefined).estado).toBe('nao_conferivel')
})
test('mod-sinal-sessao-nao-interativa-nao-grava: sem sessão interativa o Stop não escreve o sinal', async ($, on) => {
  const m = mundo($, on, { interativo: false })
  await arrancar(m)
  await $.classic.Stop({ session_id: 's-1', session_crons: [SINAL_ARMADO_WAKEUP] }); await drena(m)
  expect(m.est.sinaisLoop).toHaveLength(0)
})
test('mod-sinal-gravar-pura: gravarSinalLoop fora da forma ⇒ null; sessão fora do padrão não grava (sem chave)', () => {
  const ok = { pluginRoot: '/p', estado: 'armado', intervalo: 0, dinamico: 1, sessao: 's-1', emMs: 0 }
  expect(gravarSinalLoop(ok)?.argv.slice(0, 2)).toEqual(['node', '-e'])
  for (const ruim of ['../x', 'a/b', '', undefined, 'x'.repeat(129)]) expect(gravarSinalLoop({ ...ok, sessao: ruim })).toBeNull()
  expect(JSON.parse(gravarSinalLoop(ok)!.stdin).arquivo).toBe('contexto/loop-dinamico.s-1.json')
  // o sinal cai sob .harness/contexto/ (ignorado pelo git), nunca solto em .harness/
  expect(arquivoSinalLoop('s-1')!.startsWith('contexto/')).toBe(true)
  expect(arquivoSinalLoop('s-1')!.split('/')).toHaveLength(2)
  expect(gravarSinalLoop({ ...ok, estado: 'talvez' })).toBeNull()
  expect(gravarSinalLoop({ ...ok, pluginRoot: '' })).toBeNull()
  expect(gravarSinalLoop({ ...ok, intervalo: 1.5 })).toBeNull()
})

// Aprendizado D: o sinal é por sessão do hook. Cada Stop grava no arquivo da SUA sessão; o leitor só aceita o da sessão pedida.
test('mod-sinal-2-sessoes: B arma, A continua não vendo armado (um arquivo por sessão, não por repo)', async ($, on) => {
  const m = mundo($, on, {})
  await arrancar(m)
  const disco = new Map<string, string>() // simula `.harness/` compartilhado entre checkout e worktrees
  const grava = () => { const { arquivo, sinal } = m.est.sinaisLoop.at(-1).q; disco.set(arquivo, JSON.stringify(sinal)) }
  await $.classic.Stop({ session_id: 'sessao-A', session_crons: [] }); await drena(m); grava()
  await $.classic.Stop({ session_id: 'sessao-B', session_crons: [SINAL_ARMADO_WAKEUP] }); await drena(m); grava()
  expect(disco.size).toBe(2)
  const le = (id: string) => interpretarSinalLoop(disco.get(arquivoSinalLoop(id)!), id)
  expect(le('sessao-B').estado).toBe('armado')
  expect(le('sessao-A').estado).toBe('ausente')
  // A não vê o arquivo de B, nem se o leitor for apontado para ele
  expect(interpretarSinalLoop(disco.get('contexto/loop-dinamico.sessao-B.json'), 'sessao-A').estado).toBe('nao_conferivel')
})
test('mod-sinal-leitor: arquivo ausente, corrompido e de outra sessão são todos nao_conferivel; só o conteúdo válido da sessão vale', () => {
  const bom = JSON.stringify({ estado: 'armado', intervalo: 0, dinamico: 1, sessao: 's-1', em: '2026-11-15T12:00:00.000Z' })
  expect(interpretarSinalLoop(bom, 's-1')).toMatchObject({ estado: 'armado', dinamico: 1, sessao: 's-1' })
  expect(interpretarSinalLoop(undefined, 's-1').estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop(null, 's-1').estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop('{nao json', 's-1').estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop('[]', 's-1').estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop(bom, 's-2').estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop(bom, '../s-1').estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop(bom, undefined).estado).toBe('nao_conferivel')
  expect(interpretarSinalLoop(JSON.stringify({ estado: 'talvez', intervalo: 0, dinamico: 0, sessao: 's-1', em: 'x' }), 's-1').estado).toBe('nao_conferivel')
  // `ausente` gravado é um fato (loop desligado), diferente de arquivo ausente (nunca medido)
  expect(interpretarSinalLoop(JSON.stringify({ estado: 'ausente', intervalo: 0, dinamico: 0, sessao: 's-1', em: 'x' }), 's-1').estado).toBe('ausente')
  expect(arquivoSinalLoop('../x')).toBeNull()
})

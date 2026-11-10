/**
 * Painel no mod (E4, GM-12, T10): Pane, faixa acima do prompt, atualização por turno e por relógio, e o aviso do PAROU. Decisões: sombra-p1d D-M1..D-M5.
 *
 * QUEM FAZ O QUÊ. O CLI `gates/scripts/painel.mjs estado --agentes` (T9) lê o mundo e devolve o `EstadoPainel`; o mod guarda o último e DESENHA com
 * `renderPainel` do `dist/` (a largura só existe dentro do `ui.render`, D-M1). Nada aqui projeta: D2 da spec continua valendo.
 *
 * PUREZA. O topo do módulo não toca `$`: as funções puras (`faixaDe`, `linhasDaPane`, `interpretarSaida`, `montarPedido`, `comandoParaPrompt`,
 * `chaveMod`, `classeDaFalha`, ...) são importadas pelo node na costura P9 (`gates/test/painel-costura.test.mjs`). Sem `node:*`, sem `import()`
 * (o mod carrega o `dist/` por import estático, como `gabarito.mjs`). O estado do módulo (`S`) recomeça num reload do mod.
 *
 * CONTRATO DE FALHA. Falha de leitura (ponte, JSON, timeout) vira linha `painel: ...` em `warning` e NUNCA toast, `ui.log` ou `append`; o último estado bom
 * fica com cada segmento em `inactive`, menos os segmentos `error` do PAROU (um Parar já visto não some por falha de leitura). `error` é só do Parar (D6).
 *
 * LIMITES DECLARADOS. (1) `fechadaPeloDono` é variável do módulo: um reload depois do dono fechar a Pane a reabre uma vez (o motor ainda a lista em
 * `$.ui.panes()` quando o reload não a fechou, e então nada se abre). (2) O `store` é compartilhado entre janelas do mesmo repositório e a escrita
 * simultânea não é atômica: duas janelas no mesmo instante podem avisar o mesmo PAROU duas vezes (a chave `<id>|<chave>` cala a segunda quando a
 * primeira já gravou).
 */
import { renderPainel } from '../gates/dist/painel.js';
import { colunas, cortar, limpar } from '../gates/dist/painel-largura.js';
import { lerX } from '../gates/dist/pouso.js';

export const ID_PANE = 'gabarito-painel';
/** Medido pela T9 (task-9-relatorio.md): p95 de `painel.mjs estado` 109 ms ⇒ 30 s; ≥ 1 s pediria 60 s. */
export const INTERVALO_MS = 30000;
export const TIMEOUT_MS = 5000;
export const CHAVE_NOTIFICADO = 'painel:notificado';
export const PREFS_PADRAO = Object.freeze({ preset: 'esquadrao', tema: 'color', narracao: true, ligado: true, pacote: null });

const SEM_LOOP = new Set(['plano_ausente', 'entrega_nao_inferida', 'fora_de_repo']);
const PRESETS = ['esquadrao', 'executivo'];
const TEMAS = ['color', 'mono'];
const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const larguraDe = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1);

// ─────────────────────────────────────────────────────────────── puras: pedido, saída, chave, comando

/**
 * stdin do `painel.mjs estado --agentes` (D-M3), de saídas CRUAS da API: `usage` = `$.session.usage()`, `agentes` = `$.agent.list()`, `transcripts` =
 * `{agent_id: caminho}`. Campo não finito ⇒ `null`; `h5`/`d7` ausentes ⇒ `null`, nunca 0; lista inválida ⇒ `agentes: null`, nunca `[]`. Sem `modelo`.
 */
export function montarPedido({ usage, agentes, x, notificacao, pacote, transcripts }) {
  const ctx = ehObj(usage) && ehObj(usage.context) ? usage.context : {};
  const limites = ehObj(usage) && Array.isArray(usage.rateLimits) ? usage.rateLimits : [];
  const limite = (kind) => {
    const item = limites.find((l) => ehObj(l) && l.kind === kind);
    return item === undefined ? null : numero(item.percentUsed);
  };
  const mapa = ehObj(transcripts) ? transcripts : {};
  const lista = Array.isArray(agentes)
    ? agentes.filter((a) => ehObj(a) && typeof a.id === 'string').map((a) => ({
      id: a.id,
      type: typeof a.type === 'string' ? a.type : '',
      description: typeof a.description === 'string' ? a.description : '',
      status: typeof a.status === 'string' ? a.status : '',
      transcript: typeof mapa[a.id] === 'string' ? mapa[a.id] : null,
    }))
    : null;
  return {
    sessao: {
      percent: numero(ctx.percent), tokens: numero(ctx.tokens), window: numero(ctx.window),
      h5: limite('five_hour'), d7: limite('seven_day'),
      x, notificacao: ehObj(notificacao) ? notificacao : null, pacote: typeof pacote === 'string' ? pacote : null,
    },
    agentes: lista,
  };
}

const ILEGIVEL = Object.freeze({ classe: 'ilegivel' });

/**
 * Saída de `$.process.run` ⇒ `{classe:'ok', estado, avisos}` | `{classe:'sem_loop'}` | `{classe:'erro', erro, mensagem}` | `{classe:'ilegivel'}`.
 * `ok` só com `exitCode` 0, `ok:true` e um estado com a forma mínima; stdout truncado é ilegível mesmo com JSON válido.
 */
export function interpretarSaida(r) {
  if (!ehObj(r) || typeof r.stdout !== 'string' || r.isStdoutTruncated === true) return ILEGIVEL;
  let o;
  try { o = JSON.parse(r.stdout); } catch { return ILEGIVEL; }
  if (!ehObj(o) || typeof o.ok !== 'boolean') return ILEGIVEL;
  if (o.ok === true) {
    if (r.exitCode !== 0 || !ehObj(o.estado) || typeof o.estado.id !== 'string' || !ehObj(o.estado.plano)) return ILEGIVEL;
    return { classe: 'ok', estado: o.estado, avisos: Array.isArray(o.avisos) ? o.avisos.filter((a) => typeof a === 'string') : [] };
  }
  if (typeof o.erro !== 'string' || o.erro === '') return ILEGIVEL;
  if (SEM_LOOP.has(o.erro)) return { classe: 'sem_loop' };
  return { classe: 'erro', erro: o.erro, mensagem: typeof o.mensagem === 'string' ? o.mensagem : '' };
}

/** A ponte rejeitou: com ≥ 5 s decorridos foi o timeout; antes, o `node` nem iniciou. */
export function classeDaFalha(decorridoMs) {
  return typeof decorridoMs === 'number' && decorridoMs >= TIMEOUT_MS ? 'timeout' : 'nao_iniciou';
}

/** Uma linha por classe de falha; a mensagem do CLI vai cortada e sem controle. */
export function textoDaFalha(falha) {
  switch (falha?.classe) {
    case 'timeout': return 'painel: leitura passou de 5 s';
    case 'nao_iniciou': return 'painel: node não iniciou';
    case 'ilegivel': return 'painel: resposta ilegível';
    case 'erro': return `painel: ${limpar(String(falha.erro ?? ''))}: ${cortar(limpar(String(falha.mensagem ?? '')), 120)}`;
    default: return 'painel: leitura falhou';
  }
}

/** Chave do aviso: o id da entrega na frente da chave do núcleo (o store é global ao plugin, D-M5). Sem Parar ⇒ `null`. */
export function chaveMod(estado) {
  if (!ehObj(estado) || !ehObj(estado.parar) || typeof estado.id !== 'string' || typeof estado.parar.chave !== 'string') return null;
  return `${estado.id}|${estado.parar.chave}`;
}

/** Texto do toast e do notify do PAROU. */
export function textoDoAviso(estado) {
  return `gabarito: PAROU ${limpar(String(estado?.id ?? ''))} · ${limpar(String(estado?.parar?.texto ?? ''))}`;
}

const RAIZ_PROIBIDA = /["$`\\\p{Cc}]/u;
const CAUDA_COMANDO = /^( [A-Za-z0-9._:-]+)*$/;
const NODE_PLUGIN = /^node <plugin>\/([A-Za-z0-9._/-]+)(.*)$/s;

/**
 * Comando da ação ⇒ texto para `$.prompt.fill` (D-M4). `/…` fica; `node <plugin>/x args` ⇒ `! node "<raiz>/x" args` (quem executa é o dono, no modo
 * Bash dele). Raiz com `"`, `$`, crase, `\` ou controle, comando fora das duas formas ou com metacaractere ⇒ `null` (sem botão).
 */
export function comandoParaPrompt(comando, root) {
  if (typeof comando !== 'string' || comando === '') return null;
  if (comando.startsWith('/')) return /^\/[^\p{Cc}]*$/u.test(comando) ? comando : null;
  const m = NODE_PLUGIN.exec(comando);
  if (m === null || !CAUDA_COMANDO.test(m[2])) return null;
  if (typeof root !== 'string' || root === '' || RAIZ_PROIBIDA.test(root)) return null;
  return `! node "${root}/${m[1]}"${m[2]}`;
}

// ─────────────────────────────────────────────────────────────── puras: faixa e Pane

const botaoDe = (acoes, root) => {
  for (const a of Array.isArray(acoes) ? acoes : []) {
    const c = comandoParaPrompt(a?.comando, root);
    if (c !== null) return { comando: c, rotulo: limpar(String(a.rotulo ?? '')) };
  }
  return { comando: null, rotulo: null };
};

/**
 * Faixa de 1 linha acima do prompt (sombra-p1d T10 (1)): `{texto, cor, comando, rotulo}` ou `null` (a faixa cede ao motor).
 * `paneVisivel` vem de `$.ui.panes()`, nunca do retorno de `$.ui.open`. `opc`: `root` (`$.plugin.root`, para o botão) e `ligado` (`prefs.ligado`;
 * `false` ⇒ só o PAROU, que nunca fica em silêncio). `hasSurvey` é do chamador.
 */
export function faixaDe(estado, paneVisivel, falha, opc = {}) {
  const root = opc.root ?? null;
  const ligado = opc.ligado !== false;
  if (!ehObj(estado)) {
    if (!ligado || paneVisivel === true || falha === null || falha === undefined) return null;
    return { texto: limpar(textoDaFalha(falha)), cor: 'warning', comando: null, rotulo: null };
  }
  if (ehObj(estado.parar)) {
    return { texto: limpar(`■ PAROU ${estado.parar.hora} ${estado.parar.texto}`), cor: 'error', ...botaoDe(estado.parar.acoes, root) };
  }
  if (!ligado) return null;
  const donos = (Array.isArray(estado.depende) ? estado.depende : []).filter((d) => ehObj(d) && d.nivel === 'dono');
  if (donos.length > 0) {
    const mais = donos.length > 1 ? ` (+${donos.length - 1})` : '';
    return { texto: limpar(`depende de você: ${donos[0].motivo}${mais}`), cor: 'warning', ...botaoDe(donos[0].acoes, root) };
  }
  if (paneVisivel === true) return null;
  const p = estado.plano;
  const eta = ehObj(p?.eta) ? ` · ETA ${p.eta.hora}` : '';
  return { texto: limpar(`${estado.id} ${p?.feitas}/${p?.total}${eta}`), cor: 'inactive', comando: null, rotulo: null };
}

/** Texto cortado a `bodyColumns − colunas(botão) − 1`; o botão nunca é cortado. */
export function faixaCortada(faixa, bodyColumns) {
  const cols = larguraDe(bodyColumns);
  const reserva = faixa.comando === null ? 0 : colunas(faixa.rotulo ?? '') + 2 + 1;
  return { ...faixa, texto: cortar(faixa.texto, Math.max(1, cols - reserva)) };
}

const seg = (texto, cor, tema) => (tema === 'mono' || cor === undefined ? { texto } : { texto, cor });
const comSufixo = (base, sufixo, larg) => (sufixo === '' ? cortar(limpar(base), larg) : cortar(limpar(base), Math.max(1, larg - colunas(sufixo))) + sufixo);

/**
 * Linhas da Pane: `renderPainel` do `dist/` na largura pedida (`max(1, bodyColumns)`), cada segmento por `limpar`. `extra`: `falha` (linha de erro em `warning`
 * no topo e o resto em `inactive`, menos os `error` do PAROU), `avisos` (1 linha `warning`, `(+N)`), `semLoop`. `render` que lança ⇒ 1 linha `warning`.
 */
export function linhasDaPane(estado, prefs, largura, extra = {}) {
  const larg = larguraDe(largura);
  const p = { ...PREFS_PADRAO, ...(ehObj(prefs) ? prefs : {}) };
  const preset = PRESETS.includes(p.preset) ? p.preset : PREFS_PADRAO.preset;
  const tema = TEMAS.includes(p.tema) ? p.tema : PREFS_PADRAO.tema;
  const falha = extra.falha ?? null;
  const avisos = Array.isArray(extra.avisos) ? extra.avisos.filter((a) => typeof a === 'string') : [];
  const linhas = [];
  if (falha !== null) linhas.push([seg(cortar(textoDaFalha(falha), larg), 'warning', tema)]);
  if (avisos.length > 0) linhas.push([seg(comSufixo(`painel: aviso: ${avisos[0]}`, avisos.length > 1 ? ` (+${avisos.length - 1})` : '', larg), 'warning', tema)]);
  if (!ehObj(estado)) {
    if (extra.semLoop === true) linhas.push([seg('sem loop nesta branch', 'inactive', tema)]);
    else if (falha === null) linhas.push([seg('painel: lendo…', 'inactive', tema)]);
    return linhas;
  }
  let corpo;
  try {
    corpo = renderPainel(estado, { preset, tema, narracao: p.narracao !== false, largura: larg });
    if (!Array.isArray(corpo)) throw new Error('render sem linhas');
  } catch {
    return [...linhas, [seg('painel: não consegui desenhar', 'warning', tema)]];
  }
  for (const l of corpo) {
    linhas.push(l.map((s) => {
      const texto = limpar(s.texto);
      const cor = falha === null ? s.cor : s.cor === 'error' ? 'error' : 'inactive';
      return seg(texto, cor, tema);
    }).filter((s) => s.texto !== ''));
  }
  return linhas;
}

// ─────────────────────────────────────────────────────────────── estado do módulo e ciclo de vida

const S = {
  interativo: true,
  relogio: null,
  emVoo: false,
  pendente: false,
  estado: null,
  avisos: [],
  falha: null,
  semLoop: false,
  paneVisivel: false,
  aberta: false,
  fechadaPeloDono: false,
  notificado: null, // {chave, resultado}: o que se sabe do aviso, lido do store uma vez e mantido em memória (segura a repetição com o store falhando)
  notificadoLido: false,
  limpoNoStore: false,
  prefs: PREFS_PADRAO,
};

async function agora($) {
  try { const t = await $.clock.now(); return typeof t === 'number' ? t : 0; } catch { return 0; }
}

function redesenhar($) {
  try { $.ui.invalidate('ui.render'); } catch { /* sem tela */ }
}

async function lerPanes($) {
  try {
    const lista = await $.ui.panes();
    if (!Array.isArray(lista)) return null;
    S.paneVisivel = lista.some((x) => x?.id === ID_PANE && x.isPlaced === true && x.isShown === true);
    return lista;
  } catch {
    return null; // não consegui ler: a leitura anterior fica
  }
}

/** Relógio único e idempotente: nunca cria um segundo. */
export function garantirRelogio($) {
  if (S.relogio !== null) return;
  try { S.relogio = $.clock.every(INTERVALO_MS, () => { void atualizar($, 'relogio'); }); } catch { S.relogio = null; }
}

function cancelarRelogio() {
  const r = S.relogio;
  S.relogio = null;
  try { r?.cancel(); } catch { /* já cancelado */ }
}

/** Abre a Pane sem `focus`. Fechada pelo dono nunca reabre por refresh. Devolve o `UiOpenResult` ou `null`. */
export async function abrirPainel($) {
  if (S.fechadaPeloDono || S.prefs.ligado === false) return null;
  S.aberta = true;
  try { return await $.ui.open({ id: ID_PANE, title: 'gabarito' }); } catch { return null; }
}

async function carregarNotificado($) {
  if (S.notificadoLido) return;
  S.notificadoLido = true;
  try {
    const v = await $.store.get(CHAVE_NOTIFICADO);
    if (ehObj(v) && typeof v.chave === 'string') S.notificado = { chave: v.chave, resultado: ehObj(v.resultado) ? v.resultado : null };
  } catch { /* store fora do ar: a memória faz o papel */ }
}

async function pedidoDoMod($) {
  let usage = null;
  try { usage = await $.session.usage(); } catch { usage = null; }
  let agentes = null;
  try { agentes = await $.agent.list(); } catch { agentes = null; }
  let bruto;
  try { bruto = await $.env.get('GABARITO_POUSO_X'); } catch { bruto = undefined; }
  await carregarNotificado($);
  return montarPedido({
    usage, agentes, x: lerX(bruto).x, notificacao: S.notificado?.resultado ?? null, pacote: S.prefs.pacote ?? null, transcripts: {},
  });
}

/**
 * Parar ⇒ aviso 1× por chave (sombra-p1d T10 (1)): `store.set` ANTES do `notify`, a memória segura a repetição se o store falhar, o resultado volta no
 * próximo stdin e `atualizar('notificacao')` roda logo depois. Sem Parar ⇒ apaga a marca. Sem som.
 */
export async function avisarParar($, estado) {
  const chave = chaveMod(estado);
  if (chave === null) {
    S.notificado = null;
    if (!S.limpoNoStore) {
      S.limpoNoStore = true;
      try { await $.store.delete(CHAVE_NOTIFICADO); } catch { /* sem store */ }
    }
    return;
  }
  if (S.notificado?.chave === chave) return;
  S.notificado = { chave, resultado: null };
  S.limpoNoStore = false;
  try { await $.store.set(CHAVE_NOTIFICADO, { chave, resultado: null }); } catch { /* a memória segura */ }
  const texto = textoDoAviso(estado);
  try { await $.ui.toast(texto, { timeoutMs: 20000 }); } catch { /* sem tela */ }
  let resultado;
  try {
    const r = await $.ui.notify(texto);
    resultado = r?.isSent === true ? { ts: new Date(await agora($)).toISOString() } : { motivo: typeof r?.reason === 'string' && r.reason !== '' ? r.reason : 'falhou' };
  } catch {
    resultado = { motivo: 'falhou' };
  }
  S.notificado = { chave, resultado };
  try { await $.store.set(CHAVE_NOTIFICADO, { chave, resultado }); } catch { /* a memória segura */ }
  void atualizar($, 'notificacao');
}

async function uma($, motivo) {
  let cwd;
  try { cwd = await $.session.root(); } catch { cwd = null; }
  let s;
  if (cwd === null || typeof cwd !== 'string') {
    s = { classe: 'erro', erro: 'sessao_sem_raiz', mensagem: 'a sessão não tem raiz' };
  } else {
    const pedido = await pedidoDoMod($);
    const t0 = await agora($);
    try {
      const r = await $.process.run(['node', `${$.plugin.root}/gates/scripts/painel.mjs`, 'estado', '--agentes'], { cwd, stdin: JSON.stringify(pedido), timeoutMs: TIMEOUT_MS });
      s = interpretarSaida(r);
    } catch {
      s = { classe: classeDaFalha((await agora($)) - t0) };
    }
  }
  if (s.classe === 'sem_loop') {
    S.semLoop = true; S.estado = null; S.falha = null; S.avisos = [];
    cancelarRelogio();
    await lerPanes($);
    redesenhar($);
    return;
  }
  garantirRelogio($);
  if (s.classe !== 'ok') {
    S.falha = s; S.semLoop = false;
    await lerPanes($);
    redesenhar($);
    return;
  }
  S.estado = s.estado; S.avisos = s.avisos; S.falha = null; S.semLoop = false;
  const lista = await lerPanes($);
  const jaListada = Array.isArray(lista) && lista.some((x) => x?.id === ID_PANE);
  if (!S.aberta && !S.fechadaPeloDono && !jaListada) { await abrirPainel($); await lerPanes($); } else if (jaListada) S.aberta = true;
  redesenhar($);
  await avisarParar($, s.estado);
}

/** Uma ponte por vez, com coalescência: o que chega com a ponte em voo vira 1 pendente (no máximo), rodado quando ela termina. Nunca lança. */
export async function atualizar($, motivo) {
  if (!S.interativo) return;
  if (S.emVoo) { S.pendente = true; return; }
  S.emVoo = true;
  try {
    do {
      S.pendente = false;
      try { await uma($, motivo); } catch { /* o painel não derruba o mod */ }
    } while (S.pendente);
  } finally {
    S.emVoo = false;
  }
}

// ─────────────────────────────────────────────────────────────── desenho (hooks)

const colunasDe = (props) => larguraDe(props?.bodyColumns);

function arvoreDeLinhas($, e, linhas) {
  const { Box, Text } = $.ui.resolve(e);
  return h(Box, { flexDirection: 'column' }, ...linhas.map((l) => {
    const filhos = l.filter((s) => s.texto !== '').map((s) => h(Text, s.cor === undefined ? null : { color: s.cor }, s.texto));
    return h(Text, null, ...(filhos.length === 0 ? [' '] : filhos));
  }));
}

/**
 * `session.start` do painel: chamado de dentro do hook que `gabarito.mjs` já tem (o motor recusa dois `on('session.start')` sem matcher). Não bloqueia:
 * `atualizar('inicio')` roda num timer. `-p` (`isInteractive: false` ou `surface: null`) ⇒ nada do painel.
 */
export function iniciarPainel($, e) {
  S.interativo = e?.isInteractive === true && e?.surface !== null && e?.surface !== undefined;
  if (!S.interativo) return;
  try { $.clock.after(0, () => { void atualizar($, 'inicio'); }); } catch { /* sem relógio */ }
}

/** `turn.complete` do painel (qualquer `agentId`): o turno não espera a ponte (até 5 s), `atualizar` roda num timer. */
export async function turnoDoPainel($) {
  if (!S.interativo) return;
  try { $.clock.after(0, () => { void atualizar($, 'turno'); }); } catch { /* sem relógio */ }
}

/** Registra os hooks de desenho do painel (`ui.close`, `ui.render`). Chamado no começo de `register` de `gabarito.mjs`. */
export function registrarPainel(on) {
  on('ui.close', async ($, e, next) => {
    if (e?.id === ID_PANE && e?.origin?.kind === 'person') S.fechadaPeloDono = true;
    return next(e);
  });

  on('ui.render', { component: 'Pane', requestId: ID_PANE }, async ($, e) => {
    if (S.interativo && S.relogio === null && !S.semLoop) { // módulo recarregado com a Pane de pé: recomeça o ciclo (uma vez: o relógio passa a existir)
      try { $.clock.after(0, () => { void atualizar($, 'render'); }); } catch { /* sem relógio */ }
    }
    let linhas;
    try {
      linhas = linhasDaPane(S.estado, S.prefs, colunasDe(e.props), { falha: S.falha, avisos: S.avisos, semLoop: S.semLoop });
    } catch {
      linhas = [[{ texto: 'painel: não consegui desenhar', cor: 'warning' }]];
    }
    return arvoreDeLinhas($, e, linhas);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!S.interativo || e.props?.hasSurvey === true) return next(e);
    await lerPanes($);
    let f;
    try {
      f = faixaDe(S.estado, S.paneVisivel, S.falha, { root: $.plugin.root, ligado: S.prefs.ligado !== false });
    } catch {
      f = null;
    }
    if (f === null) return next(e);
    f = faixaCortada(f, colunasDe(e.props));
    const { Box, Button, Text } = $.ui.resolve(e);
    const cor = S.prefs.tema === 'mono' ? null : { color: f.cor };
    const comando = f.comando;
    const botao = comando === null ? [] : [h(Text, null, ' '), h(Button, {
      key: 'painel-acao',
      label: f.rotulo,
      onPress: async () => {
        try {
          const r = await $.prompt.fill({ text: comando, mode: 'replace' });
          if (r?.isFilled !== true) $.ui.status('gabarito: não consegui pôr o comando no prompt');
        } catch {
          try { $.ui.status('gabarito: não consegui pôr o comando no prompt'); } catch { /* sem tela */ }
        }
      },
    })];
    return h(Box, null, h(Text, cor, f.texto), ...botao);
  });
}

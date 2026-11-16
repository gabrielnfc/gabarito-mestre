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
 *
 * GM-14 T20 (REQ-GLB-1, PRG-1, FIEL-10..14): UM painel, no local de `harness.config.json` `painel.local` (lido e gravado por
 * `onboarding.mjs painel`, T21): `lateral` (padrão) = a Pane da E4, com orçamento `scroll.bodyRows` (ausente ⇒ 7), e a faixa devolve `next(e)`
 * salvo com a Pane invisível (aí só PAROU ou pergunta aberta, 1 linha); `acima` = nenhuma Pane, a faixa desenha o painel inteiro com
 * `orcamentoDe(viewport.rows, maxRows)`. Nunca os dois. Botões só na linha do topo. A resposta "sem loop" deixou de esconder o painel: é
 * falha de leitura (FIEL-10 e). A cada ciclo (início, turno, relógio de 60 s): `painel.mjs medir`, o estado, o contexto da sessão em
 * `.harness/contexto/<sessao>.json` e o push do pouso. LIMITES (relatório da T20): a Pane é registrada por `registrarPainel` no load do mod
 * (o hook não some em `acima`; nada a abre); `nomes`, `contexto` e `desatualizadoS` vão no stdin, mas o CLI só os desenha depois da T29/T35.
 */
import { renderPainel } from '../gates/dist/painel.js';
import { colunas, cortar, limpar } from '../gates/dist/painel-largura.js';
import { sortearPacote } from '../gates/dist/painel-equipe.js';
import { lerX } from '../gates/dist/pouso.js';
import { acaoDe, descricaoLimpa } from '../gates/dist/ferramentas.js';
import { orcamentoDe } from '../gates/dist/orcamento.js';

export const ID_PANE = 'gabarito-painel';
/** GM-14 T20: relógio de 60 s (FIEL-13 b, S15: p95 60,009 s entre leituras com `clock.every` 60 s + `turn.complete`). */
export const INTERVALO_MS = 60000;
export const TIMEOUT_MS = 5000;
/** `painel.mjs medir` chama `gh` com timeout próprio de 5 s, depois do `git`: a ponte espera mais que a do estado. */
export const TIMEOUT_MEDIR_MS = 12000;
/** FIEL-13 b: sem leitura boa do diário além disto ⇒ ATENÇÃO "painel sem ler o diário há N min" (2 × p95 do S15, no lugar dos 180 s provisórios). */
export const LIMITE_DESATUALIZADO_S = 120;
export const LOCAIS = Object.freeze(['lateral', 'acima']);
export const LOCAL_PADRAO = 'lateral';
/** `lateral` sem `scroll.bodyRows` válido: o mesmo piso da fórmula de H desconhecido (REQ-GLB-1), para nunca rolar. */
export const ORCAMENTO_LATERAL = 7;
export const CHAVE_NOMES = 'painel:nomes';
export const TETO_NOMES = 64;
/** Dedupe do push do pouso (FIEL-14 d): a mesma forma do `painel:notificado` do PAROU, numa chave própria para os dois não se apagarem. */
export const CHAVE_NOTIFICADO_POUSO = 'painel:notificado:pouso';
const ATIVOS = new Set(['pending', 'running', 'waiting']);
/** O mesmo `NOME_VIVO_RE` de `gates/src/painel-equipe.ts` (o CLI recusa o stdin inteiro com 1 nome fora dele). */
const NOME_VIVO_RE = /^(?:[A-Z0-9ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ'-]{1,10}[2-9]?|agente)$/u;
export const CHAVE_NOTIFICADO = 'painel:notificado';
export const CHAVE_PREFS = 'painel:prefs';
export const CHAVE_PACOTE = 'painel:pacote';
export const CHAVE_TRANSCRIPTS = 'painel:transcripts';
/** Teto de transcripts no `$.store` (D-M5: o store tem 4 MiB e `pouso:<dir>` divide o arquivo). Ao passar, sai o mais antigo (ordem de inserção). */
export const TETO_TRANSCRIPTS = 64;
/** Os pacotes de fábrica (`mod/temas/nomes/`). O mod não lê diretório sem `node:fs`: um teste em `gates/` compara esta lista com o diretório. */
export const PACOTES_FABRICA = Object.freeze(['galaxia', 'herois', 'hogwarts', 'terra-media']);
/** Ajuda do `/gabarito` (sem argumento ou desconhecido): linguagem do adotante, ≤ 14 linhas, ≤ 80 colunas. Multilinha de propósito (não passa por `umaLinha`). */
export const USO_GABARITO = [
  'Uso: o painel abre sozinho ao lado, em terminal largo, quando uma entrega',
  'começa.',
  '/gabarito painel            abre ou traz de volta; volta a abrir sozinho',
  '/gabarito painel esquadrao  detalhado: plano, equipe (contexto e tokens',
  '                            de cada agente) e histórico',
  '/gabarito painel executivo  resumido: só o essencial da entrega',
  '/gabarito painel color      com cores  (ou: mono, sem cores)',
  '/gabarito painel narracao on|off   liga ou desliga a narração',
  '/gabarito painel nomes <pacote>    troca os nomes da equipe',
  '/gabarito painel ligar      volta a abrir sozinho',
  '/gabarito painel desligar   fecha e não abre sozinho; só o aviso de PAROU',
  '                            continua',
  '/gabarito pausar            para o trabalho automático da entrega',
  '/gabarito retomar           continua de onde parou',
].join('\n');
const PACOTE_RE = /^[a-z0-9-]{1,32}$/;
const AGENTE_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_RE = /^[A-Za-z0-9-]{1,128}$/;
export const PREFS_PADRAO = Object.freeze({ preset: 'esquadrao', tema: 'color', narracao: true, ligado: true, pacote: null });

/** Só classifica (a costura de `gates/test/painel-costura.test.mjs` ainda a exige); desde a T20 a classe `sem_loop` não esconde nada: é falha de leitura. */
const SEM_LOOP = new Set(['plano_ausente', 'entrega_nao_inferida', 'fora_de_repo']);
const SITUACAO_RE = /^depende de você:/;
const ID_PERGUNTA_RE = /^[A-Za-z0-9._-]{1,128}:[0-9]{1,9}$/;
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
  // GM-14 T20: "depende de você: nada" e "depende de você: ? (...)" do estado novo são a linha de situação do bloco, não pendência (sem prefixar 2×)
  const donos = (Array.isArray(estado.depende) ? estado.depende : []).filter((d) => ehObj(d) && d.nivel === 'dono' && !SITUACAO_RE.test(String(d.motivo ?? '')));
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
 * Linhas da Pane: `renderPainel` do `dist/` na largura pedida (`max(1, bodyColumns)`), cada segmento por `limpar`. `extra`: `altura` (`scroll.bodyRows` da Pane; ausente ⇒ sem corte por altura), `falha` (linha de erro em `warning`
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
  // GM-14 T20 (FIEL-13 b): leitura falhando além do limite ⇒ ATENÇÃO com os minutos sem ler
  const semLerS = numero(extra.semLerS);
  if (falha !== null && semLerS !== null && semLerS > LIMITE_DESATUALIZADO_S) {
    linhas.push([seg(cortar(`ATENÇÃO · painel sem ler o diário há ${Math.ceil(semLerS / 60)} min`, larg), 'warning', tema)]);
  }
  if (avisos.length > 0) linhas.push([seg(comSufixo(`painel: aviso: ${avisos[0]}`, avisos.length > 1 ? ` (+${avisos.length - 1})` : '', larg), 'warning', tema)]);
  if (!ehObj(estado)) {
    if (extra.semLoop === true) linhas.push([seg('sem loop nesta branch', 'inactive', tema)]);
    else if (falha === null) linhas.push([seg('painel: lendo…', 'inactive', tema)]);
    return linhas;
  }
  let corpo;
  try {
    // T14b: `altura` = linhas da superfície menos as que `falha`/`avisos` já ocuparam; inteiro ≥ 1, senão ausente (o núcleo não corta nada)
    const desconto = (bruta) => (Number.isInteger(bruta) && bruta >= 1 ? Math.max(1, bruta - linhas.length) : undefined);
    const altura = desconto(extra.altura);
    // GM-14 T20: `orcamento` (REQ-GLB-1) e `local` vão ao render novo; o da E4 os ignora
    const orcamento = desconto(extra.orcamento);
    const local = LOCAIS.includes(extra.local) ? extra.local : undefined;
    corpo = renderPainel(estado, {
      preset, tema, narracao: p.narracao !== false, largura: larg,
      ...(altura === undefined ? {} : { altura }), ...(orcamento === undefined ? {} : { orcamento }), ...(local === undefined ? {} : { local }),
    });
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

// ─────────────────────────────────────────────────────────────── puras (GM-14 T20): local, orçamento, topo e botões

/** Saída de `onboarding.mjs painel` ⇒ `{local, estado}`: `atual` válido ⇒ ele; `oferecer` (ainda não gravado) ⇒ padrão, `ausente`; resto ⇒ padrão, `corrompido` | `ilegivel`. */
export function localDaSaida(r) {
  if (!ehObj(r) || typeof r.stdout !== 'string' || r.exitCode !== 0) return { local: LOCAL_PADRAO, estado: 'ilegivel' };
  let o;
  try { o = JSON.parse(r.stdout); } catch { return { local: LOCAL_PADRAO, estado: 'ilegivel' }; }
  if (!ehObj(o) || o.ok !== true) return { local: LOCAL_PADRAO, estado: 'ilegivel' };
  if (LOCAIS.includes(o.atual)) return { local: o.atual, estado: 'ok' };
  if (o.oferecer === true) return { local: LOCAL_PADRAO, estado: 'ausente' };
  return { local: LOCAL_PADRAO, estado: o.motivo === 'config_corrompido' ? 'corrompido' : 'ilegivel' };
}

/** H do terminal = `e.viewport.rows` (S1b(i), 12/12). Ausente, não finito ou ≤ 0 ⇒ `undefined` (a fórmula de H desconhecido). */
export function hDoViewport(e) {
  const h = e?.viewport?.rows;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : undefined;
}

/** Orçamento da Pane: `scroll.bodyRows` inteiro ≥ 1, senão 7. */
export function orcamentoLateral(bodyRows) {
  return Number.isInteger(bodyRows) && bodyRows >= 1 ? bodyRows : ORCAMENTO_LATERAL;
}

const estadoNovo = (estado) => ehObj(estado) && typeof estado.modo === 'string';
const perguntaDe = (estado) => {
  const q = ehObj(estado) ? estado.pergunta : null;
  return ehObj(q) && typeof q.texto === 'string' && Array.isArray(q.opcoes) ? q : null;
};
/** O 1º item do topo que é pendência (o PAROU e a pergunta vêm antes; a linha de situação "depende de você: …" não conta). */
const primeiroItem = (estado) => (Array.isArray(estado?.depende) ? estado.depende : [])
  .find((d) => ehObj(d) && d.nivel === 'dono' && !SITUACAO_RE.test(String(d.motivo ?? ''))) ?? null;

/**
 * Botões da linha do topo (REQ-PRG-1, F7): PAROU ⇒ as ações com comando; senão pergunta aberta ⇒ uma por opção, `<n> <rótulo>` com
 * `/gabarito-mestre:responder <id> <n>`; senão o 1º item do "depende de você" com as suas ações. Comando que `comandoParaPrompt` recusa ou
 * id de pergunta fora da forma ⇒ sem botão. `[{rotulo, comando}]`.
 */
export function botoesDoTopo(estado, root) {
  if (!ehObj(estado)) return [];
  const dasAcoes = (acoes) => (Array.isArray(acoes) ? acoes : []).map((a) => ({ rotulo: limpar(String(a?.rotulo ?? '')), comando: comandoParaPrompt(a?.comando, root) }))
    .filter((b) => b.comando !== null && b.rotulo !== '');
  if (ehObj(estado.parar)) return dasAcoes(estado.parar.acoes);
  const q = perguntaDe(estado);
  if (q !== null) {
    if (typeof q.id !== 'string' || !ID_PERGUNTA_RE.test(q.id)) return [];
    return q.opcoes.slice(0, 9).map((op, i) => ({ rotulo: `${i + 1} ${cortar(limpar(String(op)), 60)}`, comando: `/gabarito-mestre:responder ${q.id} ${i + 1}` }));
  }
  const item = primeiroItem(estado);
  return item === null ? [] : dasAcoes(item.acoes);
}

/** O estado que vai ao render quando o topo ganha botões: tira do texto o que virou botão (as opções da pergunta, as ações com comando do topo). */
export function estadoParaDesenho(estado) {
  if (!estadoNovo(estado)) return estado;
  const semComando = (acoes) => (Array.isArray(acoes) ? acoes : []).filter((a) => !(typeof a?.comando === 'string' && a.comando !== ''));
  if (ehObj(estado.parar)) return { ...estado, parar: { ...estado.parar, acoes: semComando(estado.parar.acoes) } };
  const q = perguntaDe(estado);
  if (q !== null) return { ...estado, pergunta: { ...q, opcoes: [] } };
  const item = primeiroItem(estado);
  if (item === null) return estado;
  return { ...estado, depende: estado.depende.map((d) => (d === item ? { ...d, acoes: semComando(d.acoes) } : d)) };
}

const textoDaLinha = (l) => (Array.isArray(l) ? l.map((s) => String(s?.texto ?? '')).join('') : '');
/**
 * GM-15 T29 (D-G1c): o topo tem a cara do E4. Linha dos botões: o PAROU; senão o 1º item depois do rótulo `◆ DEPENDE DE VOCÊ  N itens`
 * (o rótulo nunca leva botão); com pouca altura o rótulo sai e o item começa por `◆ `. `◆ ATENÇÃO` nunca é topo. `depende de você: …` (linha de situação) segue valendo.
 */
const TOPO_RE = /^(■ )?PAROU |^depende de você: /;
/** `◆ item` (rótulo fora): só é topo como 1ª ou 2ª linha de conteúdo (logo depois do cabeçalho); a ATENÇÃO estreita (`◆ T2 …`, < 60 col) vem depois. */
const ITEM_SEM_ROTULO_RE = /^◆ (?!ATENÇÃO|DEPENDE DE VOCÊ)/;
const ROTULO_DEPENDE_RE = /^◆ DEPENDE DE VOCÊ/;
/** Índice da linha do topo nas linhas desenhadas; nenhuma ⇒ -1. */
export function indiceDoTopo(linhas) {
  const ts = (Array.isArray(linhas) ? linhas : []).map(textoDaLinha);
  let conteudo = 0;
  for (let i = 0; i < ts.length; i++) {
    if (TOPO_RE.test(ts[i])) return i;
    if (conteudo <= 1 && ITEM_SEM_ROTULO_RE.test(ts[i])) return i;
    if (!/^─+$/.test(ts[i])) conteudo++;
    if (ROTULO_DEPENDE_RE.test(ts[i])) return i + 1 < ts.length && /^ {2}\S/.test(ts[i + 1]) ? i + 1 : -1;
  }
  return -1;
}

/**
 * Painel inteiro acima do input (local `acima`): `linhasDaPane` com `orcamento: orcamentoDe(h, maxRows)` e `local: 'acima'` (RECENTE até 2).
 * `opc`: `largura`, `h` (de `hDoViewport`), `maxRows` e o resto do `extra` de `linhasDaPane` (`falha`, `avisos`, `semLerS`). Nunca passa do orçamento.
 */
export function linhasDaFaixa(estado, prefs, opc = {}) {
  const orcamento = orcamentoDe(opc.h, Number.isInteger(opc.maxRows) ? opc.maxRows : 1);
  const linhas = linhasDaPane(estadoParaDesenho(estado), prefs, opc.largura, { falha: opc.falha ?? null, avisos: opc.avisos, semLerS: opc.semLerS, orcamento, altura: orcamento, local: 'acima' });
  return linhas.slice(0, orcamento);
}

/** Limiar de colunas que a plataforma informa no `reason` de uma Pane não colocada ("unasked below 144 columns (80 now): ..."); sem número ⇒ `null` (nunca fixo no código). */
export function limiarDaRazao(reason) {
  const m = typeof reason === 'string' ? /\bbelow\s+(\d{1,4})\s+columns\b/.exec(reason) : null;
  return m === null ? null : Number(m[1]);
}

/** Aviso da Pane lateral que a plataforma não colocou (GM-14 T50, emenda 44): o número é o do `reason`; sem ele, "mais colunas". */
export function avisoPaneEspera(reason) {
  const n = limiarDaRazao(reason);
  return `painel lateral precisa de ${n === null ? 'mais' : n} colunas: /gabarito painel para abrir`;
}

/**
 * Uma linha só (lateral com a Pane invisível, ou painel oculto): o PAROU, senão a pergunta aberta, e por último, só na lateral com a Pane que a
 * plataforma não colocou, o aviso `opc.aviso` (REQ-GLB-1, emenda 44); o aviso vai no fim para o corte de largura tirá-lo primeiro. `{texto, cor, botoes}` | `null`.
 */
export function faixaUmaLinha(estado, opc = {}) {
  const aviso = typeof opc.aviso === 'string' && opc.aviso !== '' ? limpar(opc.aviso) : null;
  if (!ehObj(estado)) return aviso === null ? null : { texto: aviso, cor: 'warning', botoes: [] };
  const botoes = botoesDoTopo(estado, opc.root ?? null);
  const com = (texto) => (aviso === null ? texto : `${texto} · ${aviso}`);
  if (ehObj(estado.parar)) return { texto: com(limpar(`■ PAROU ${estado.parar.hora} ${estado.parar.texto}`)), cor: 'error', botoes };
  const q = perguntaDe(estado);
  if (q !== null) return { texto: com(limpar(q.texto)), cor: 'warning', botoes };
  // GM-14 T56 (emenda 62, spec:47): só o aviso ⇒ sem botão do topo; o botão é de PAROU ou da pergunta, e o aviso sai inteiro
  return aviso === null ? null : { texto: aviso, cor: 'warning', botoes: [] };
}

/** Corta uma linha de segmentos a `max` colunas (o último segmento que passa é cortado; os seguintes saem). */
function cortarLinha(l, max) {
  const fora = [];
  let resto = Math.max(1, max);
  for (const s of l) {
    if (resto <= 0) break;
    const c = colunas(s.texto);
    if (c <= resto) { fora.push(s); resto -= c; } else { fora.push({ ...s, texto: cortar(s.texto, resto) }); resto = 0; }
  }
  return fora;
}

/** Colunas que os botões ocupam: o espaço entre eles + `[ rótulo ]` (a moldura do Button da plataforma é de 4, medida em sessão real). */
export function colunasDosBotoes(botoes) {
  return (Array.isArray(botoes) ? botoes : []).reduce((n, b) => n + 1 + colunas(b.rotulo ?? '') + 4, 0);
}

/** A plataforma põe `[-]` na borda direita da linha do AbovePrompt (3 colunas, medido em sessão real): a linha única as reserva. */
const RESERVA_BORDA_DIREITA = 3;

// ─────────────────────────────────────────────────────────────── puras (GM-14 T20): contexto, plano B, pouso e nomes

const SCRIPT_CONTEXTO = `/*gabarito:contexto*/
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const d = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!/^[A-Za-z0-9-]{1,128}$/.test(String(d.sessao))) process.exit(2);
const comum = cp.execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const dir = path.join(path.dirname(comum), '.harness', 'contexto');
fs.mkdirSync(dir, { recursive: true });
const fim = path.join(dir, d.sessao + '.json'), tmp = fim + '.' + process.pid + '.tmp';
try { fs.writeFileSync(tmp, JSON.stringify({ percent: d.percent, fonte: d.fonte, em: d.em, ...(/^[a-z0-9-]{1,32}$/.test(String(d.pacote)) ? { pacote: d.pacote } : {}) }) + '\\n'); fs.renameSync(tmp, fim); }
catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }`;

/**
 * Gravação do contexto da sessão (FIEL-14 b): `{argv, stdin}` para `$.process.run` com `cwd` = a raiz da sessão. O script acha a worktree
 * PRINCIPAL (`--git-common-dir`, a mesma raiz de `loop.mjs`) e grava `.harness/contexto/<sessao>.json` `{percent, fonte, em}` por tmp + rename.
 * Pura (a T34 a usa no P9 com `spawnSync`). Sessão fora da forma, percent não número ou fonte fora de `mod|transcript` ⇒ `null`.
 */
export function gravarContexto({ sessao, percent, fonte, emMs, pacote } = {}) {
  if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) return null;
  if (numero(percent) === null || (fonte !== 'mod' && fonte !== 'transcript') || numero(emMs) === null) return null;
  // GM-15 T33 (g.17): o pacote de nomes vigente vai junto, para a CLI (`painel.mjs`) desenhar os mesmos nomes da sessão; fora da forma ⇒ não vai
  return { argv: ['node', '-e', SCRIPT_CONTEXTO], stdin: JSON.stringify({ sessao, percent, fonte, em: new Date(emMs).toISOString(), ...(typeof pacote === 'string' && PACOTE_RE.test(pacote) ? { pacote } : {}) }) };
}

const SCRIPT_ONBOARDING = `/*gabarito:onboarding*/
const { url, raiz } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
import(url).then((m) => { process.stdout.write(JSON.stringify({ ok: true, onboarding: m.temOnboarding(raiz) === true }) + '\\n'); }).catch(() => process.exit(1));`;

/**
 * Pergunta ao predicado ÚNICO da guarda (`temOnboarding`, gates/dist/guarda.js) se o repo tem onboarding (GM-14 T60, emenda 68): sem ele o mod
 * não grava em `.harness/` (contexto, medição) nem chama `gh`. `{argv, stdin}` para `$.process.run`; raiz ou plugin fora da forma ⇒ `null`.
 */
export function pedidoOnboarding(raiz, pluginRoot) {
  if (typeof raiz !== 'string' || raiz === '' || typeof pluginRoot !== 'string' || pluginRoot === '') return null;
  const url = ('file://' + encodeURI(`${pluginRoot}/gates/dist/guarda.js`)).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return { argv: ['node', '-e', SCRIPT_ONBOARDING], stdin: JSON.stringify({ url, raiz }) };
}

const SCRIPT_PLANO_B = `/*gabarito:planob*/
const fs = require('node:fs');
const { caminho } = JSON.parse(fs.readFileSync(0, 'utf8'));
const fd = fs.openSync(caminho, 'r'); const tam = fs.fstatSync(fd).size; const n = Math.min(tam, 512 * 1024);
const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, tam - n); fs.closeSync(fd);
const linhas = buf.toString('utf8').split('\\n');
for (let i = linhas.length - 1; i >= 0; i--) {
  let o; try { o = JSON.parse(linhas[i]); } catch { continue; }
  const u = o && o.message && o.message.usage;
  if (!u || typeof u !== 'object') continue;
  const t = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((s, k) => s + (Number.isFinite(u[k]) ? u[k] : 0), 0);
  process.stdout.write(JSON.stringify({ ok: true, tokens: t }) + '\\n'); process.exit(0);
}
process.stdout.write(JSON.stringify({ ok: false }) + '\\n'); process.exit(1);`;

/** Plano B do contexto (FIEL-11 a): `{argv, stdin}` que lê o último `message.usage` do transcript da sessão. Caminho não absoluto ⇒ `null`. */
export function pedidoPlanoB(caminho) {
  if (typeof caminho !== 'string' || !caminho.startsWith('/') || /[\p{Cc}]/u.test(caminho)) return null;
  return { argv: ['node', '-e', SCRIPT_PLANO_B], stdin: JSON.stringify({ caminho }) };
}

/** Saída do plano B ⇒ percent inteiro sobre a janela do modelo; sem tokens ou sem janela (`window` do `usage`) ⇒ `null` ("contexto ?"). */
export function percentDoPlanoB(r, janela) {
  const w = numero(janela);
  if (w === null || w <= 0 || !ehObj(r) || r.exitCode !== 0 || typeof r.stdout !== 'string') return null;
  let o;
  try { o = JSON.parse(r.stdout); } catch { return null; }
  const t = ehObj(o) && o.ok === true ? numero(o.tokens) : null;
  return t === null || t < 0 ? null : Math.round((t / w) * 100);
}

/**
 * Chave do push do pouso (FIEL-14 d): com o item "limpar" (`/clear`) no "depende de você" ⇒ `<ID>|pouso|<seq do último sessao.pouso>`; sem
 * `pousoPendente.seq` no estado (a T34 o projeta) ⇒ `<ID>|pouso|?` (1 push até o item sumir). Sem o item ⇒ `null`.
 */
export function chavePouso(estado) {
  if (!ehObj(estado)) return null;
  const limpar = (Array.isArray(estado.depende) ? estado.depende : [])
    .some((d) => ehObj(d) && Array.isArray(d.acoes) && d.acoes.some((a) => a?.comando === '/clear'));
  if (!limpar) return null;
  const seq = estado.pousoPendente?.seq;
  return `${typeof estado.id === 'string' ? estado.id : ''}|pouso|${Number.isInteger(seq) && seq >= 0 ? seq : '?'}`;
}

/** Texto do push do pouso. */
export function textoDoPouso(estado) {
  const id = limpar(String(estado?.id ?? ''));
  return id === '' ? 'gabarito: hora de limpar a conversa' : `gabarito: hora de limpar a conversa da ${id}`;
}

/** `painel:nomes` do store ⇒ `{mapa, estado}`: ausente ⇒ vazio, `ausente`; não objeto ⇒ vazio, `corrompido`; entrada fora da forma sai sozinha. */
export function nomesValidos(v) {
  const mapa = new Map();
  if (v === undefined) return { mapa, estado: 'ausente' };
  if (!ehObj(v)) return { mapa, estado: 'corrompido' };
  const itens = Object.entries(v).filter(([k, x]) => AGENTE_RE.test(k) && ehObj(x) && numero(x.vistoEm) !== null && (x.nome === null || typeof x.nome === 'string'));
  itens.sort((a, b) => a[1].vistoEm - b[1].vistoEm);
  for (const [k, x] of itens.slice(-TETO_NOMES)) mapa.set(k, { nome: x.nome, vistoEm: x.vistoEm });
  return { mapa, estado: 'ok' };
}

/**
 * Nomes dos agentes ATIVOS (FIEL-3 d), estáveis e únicos entre ativos. `registro` (Map id → `{nome, vistoEm}`, na ordem em que o mod viu) ganha os
 * ativos novos com `vistoEm = agoraMs`; teto 64 (sai o 1º visto). Na ordem de `vistoEm`: o nome guardado fica se nenhum ativo anterior o tem;
 * os demais pegam o 1º do pacote fora do líder, do sábio, dos `ocupados` (pares) e dos outros ativos; esgotado ⇒ sufixo 2 a 9, depois "agente".
 * Sem pacote ⇒ o ativo sem nome fica `null`. Devolve `{mapa, mudou}` (mapa novo; a entrada não muda).
 */
export function atribuirNomes(registro, ativos, pacote, ocupados = [], agoraMs = 0) {
  const mapa = new Map(registro instanceof Map ? registro : []);
  let mudou = false;
  for (const id of ativos) if (!mapa.has(id)) { mapa.set(id, { nome: null, vistoEm: agoraMs }); mudou = true; }
  while (mapa.size > TETO_NOMES) { mapa.delete(mapa.keys().next().value); mudou = true; }
  const vivos = [...mapa.entries()].filter(([id]) => ativos.includes(id)).sort((a, b) => a[1].vistoEm - b[1].vistoEm);
  const pac = ehObj(pacote) && Array.isArray(pacote.nomes) ? pacote : null;
  const usados = new Set([...(Array.isArray(ocupados) ? ocupados : []), ...(pac === null ? [] : [pac.lider, pac.sabio])].filter((x) => typeof x === 'string'));
  const semNome = [];
  for (const [id, v] of vivos) {
    if (typeof v.nome === 'string' && v.nome !== 'agente' && !usados.has(v.nome)) usados.add(v.nome);
    else semNome.push(id);
  }
  for (const id of semNome) {
    if (pac === null) continue;
    const base = pac.nomes.filter((n) => typeof n === 'string');
    let nome = base.find((n) => !usados.has(n));
    for (let k = 2; nome === undefined && k <= 9; k++) nome = base.map((n) => `${n}${k}`).find((n) => !usados.has(n));
    nome ??= 'agente';
    if (nome !== 'agente') usados.add(nome);
    if (mapa.get(id).nome !== nome) { mapa.set(id, { ...mapa.get(id), nome }); mudou = true; }
  }
  return { mapa, mudou };
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
  onboardingDe: null, // raiz em que a ponte já confirmou onboarding (T60); `false` nunca fica: a próxima leitura pergunta de novo
  paneVisivel: false,
  paneEspera: false, // a plataforma lista a Pane sem colocá-la (T50): espera o pedido do dono ou um terminal mais largo
  razaoPane: null, // `reason` do último `ui.open` que não colocou (string; '' sem texto) | null
  aberta: false,
  fechadaPeloDono: false,
  notificado: null, // {chave, resultado}: o que se sabe do aviso, lido do store uma vez e mantido em memória (segura a repetição com o store falhando)
  notificadoLido: false,
  limpoNoStore: false,
  prefs: PREFS_PADRAO,
  preparando: null, // promessa de `preparar` (prefs + sorteio): uma por `session.start`
  pacoteSorteado: null,
  transcripts: new Map(), // agent_id → caminho, em ordem de inserção (espelho do store, com teto)
  transcriptsLido: false,
  logados: new Set(), // avisos de `ui.log` já dados neste processo (1× por tipo)
  // GM-14 T20
  local: LOCAL_PADRAO, // lido de `harness.config.json` por `onboarding.mjs painel` (1× por `session.start`); o comando troca sem reiniciar
  sessaoId: null,
  localAplicado: false, // o local resolvido já foi aplicado à Pane listada de antes (acima ⇒ fecha 1× por `session.start`/reload)
  ultimaOkMs: null, // hora da última leitura boa do estado (FIEL-13 b)
  semLerS: null, // segundos sem leitura boa, só enquanto a leitura falha
  transcriptSessao: null, // transcript da sessão (plano B do contexto), do `SubagentStart` ou do `session.start`
  contexto: null, // {percent, fonte, estimado} da última leitura
  nomes: new Map(), // agent_id → {nome, vistoEm} (espelho do store, teto 64)
  nomesLido: false,
  pacoteNomes: null, // {lider, sabio, nomes} do pacote em uso, lido 1× por pacote
  pacoteNomesDe: null,
  notificadoPouso: null, // {chave, resultado} do push do pouso
  notificadoPousoLido: false,
  // GM-14 T35 (AGORA ao vivo): tudo em memória, recomeça num reload (o diário e a lista de agentes refazem o que importa)
  acoes: new Map(), // agent_id → {texto, fonte, em}: a última ação ao vivo (`tool.call` com `agentId`, S12), teto 64, o mais antigo sai
  acoesBase: new Map(), // agent_id → {base, n}: contagem de chamadas seguidas do mesmo tipo ("lendo 3 arquivos")
  encerrados: new Set(), // ids que a lista de agentes mostrou `completed`/`failed`/`killed`; sai se o id volta a ativo (S13: `completed` não é terminal)
  segundoPlano: new Map(), // backgroundTaskId → {id, dono, texto, desde}: entra pelo resultado do Bash, sai quando o Stop não o lista (S14)
  medirPedida: false, // alguma leitura pedida desde a última medição não era `ao-vivo`
  acaoAgendada: false, // há uma releitura marcada para o fim da janela
  ultimaAcaoMs: null, // última vez que uma ação pediu releitura (o `tool.call` não dispara uma ponte por chamada)
};

export const TETO_ACOES = 64;
export const TETO_ENCERRADOS = 256;
export const TETO_SEGUNDO_PLANO = 64;
/** Releitura pedida por ação ao vivo: no máximo 1 a cada 2 s (a ponte do estado leva até 5 s; ela coalesce o resto). */
export const JANELA_ACAO_MS = 2000;
/** O `SubagentStop` chega ~210 ms antes de a lista dizer `completed` (S13: 204–218 ms): a releitura espera um pouco mais que isso. */
export const ESPERA_STOP_MS = 400;
const TERMINAIS = new Set(['completed', 'failed', 'killed']);
const MAX_TEXTO_SEGUNDO_PLANO = 120;

/** Uma linha só: sem controle nem quebra, no máximo 200 colunas (REQ-PNL-13: a resposta do comando nunca vira bloco). */
export function umaLinha(texto) {
  return cortar(limpar(String(texto)).replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim(), 200);
}

/**
 * `painel:prefs` do store ⇒ `{prefs, estado}`. Ausente ⇒ padrão, `estado: 'ausente'` (sem aviso). Não objeto ⇒ padrão, `'corrompido'`. Objeto com campo
 * inválido ⇒ só ESSE campo volta ao padrão; `'ok'`.
 */
export function prefsValidas(v) {
  if (v === undefined) return { prefs: PREFS_PADRAO, estado: 'ausente' };
  if (!ehObj(v)) return { prefs: PREFS_PADRAO, estado: 'corrompido' };
  const d = PREFS_PADRAO;
  return {
    estado: 'ok',
    prefs: {
      preset: PRESETS.includes(v.preset) ? v.preset : d.preset,
      tema: TEMAS.includes(v.tema) ? v.tema : d.tema,
      narracao: typeof v.narracao === 'boolean' ? v.narracao : d.narracao,
      ligado: typeof v.ligado === 'boolean' ? v.ligado : d.ligado,
      pacote: typeof v.pacote === 'string' && PACOTE_RE.test(v.pacote) ? v.pacote : d.pacote,
    },
  };
}

/**
 * Caminho do transcript de um subagente a partir do `SubagentStart` (sem `node:path`): `<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl`.
 * `agent_id` e `session_id` entram no caminho, então são validados (path traversal). Qualquer dado fora da forma ⇒ `null` (`ctx —`).
 */
export function caminhoDoTranscript(e) {
  if (!ehObj(e)) return null;
  const { agent_id: id, session_id: sessao, transcript_path: tp } = e;
  if (typeof id !== 'string' || !AGENTE_RE.test(id)) return null;
  if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) return null;
  if (typeof tp !== 'string' || !tp.startsWith('/')) return null;
  return `${tp.slice(0, tp.lastIndexOf('/'))}/${sessao}/subagents/agent-${id}.jsonl`;
}

/** Insere com teto: passou de `TETO_TRANSCRIPTS`, saem as mais antigas. Reinserir o mesmo id atualiza o caminho e mantém a posição. */
export function inserirComTeto(mapa, id, caminho, teto = TETO_TRANSCRIPTS) {
  mapa.set(id, caminho);
  while (mapa.size > teto) mapa.delete(mapa.keys().next().value);
  return mapa;
}

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
    S.paneEspera = lista.some((x) => x?.id === ID_PANE && x.isPlaced === false); // só a que a plataforma NÃO colocou espera; colocada atrás de outra aba não promete colunas
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

/** Abre a Pane sem `focus`. Fechada pelo dono nunca reabre por refresh; local `acima` nunca abre (nunca os dois). Devolve o `UiOpenResult` ou `null`. */
export async function abrirPainel($) {
  if (S.fechadaPeloDono || S.prefs.ligado === false || S.local !== 'lateral') return null;
  S.aberta = true;
  let r = null;
  try { r = await $.ui.open({ id: ID_PANE, title: 'gabarito' }); } catch { return null; }
  guardarRazao(r);
  return r;
}

/** Guarda o motivo de uma abertura que a plataforma não colocou (alimenta o aviso); abertura colocada limpa. */
function guardarRazao(r) {
  if (!ehObj(r)) return;
  S.razaoPane = r.isPlaced === true ? null : (typeof r.reason === 'string' ? r.reason : '');
}

async function carregarNotificado($) {
  if (S.notificadoLido) return;
  S.notificadoLido = true;
  try {
    const v = await $.store.get(CHAVE_NOTIFICADO);
    if (ehObj(v) && typeof v.chave === 'string') S.notificado = { chave: v.chave, resultado: ehObj(v.resultado) ? v.resultado : null };
  } catch { /* store fora do ar: a memória faz o papel */ }
}

/**
 * stdin do `estado --agentes` e do `medir --agentes`: `montarPedido` (forma da E4) mais, no topo (GM-14 T20), `session_id` (FIEL-14 a, âncora da
 * pergunta (b)), `desatualizadoS` (FIEL-13 b), `nomes` (FIEL-3 d) e `contexto` (FIEL-11 a: `{percent, fonte, estimado}` | `null`). O plano B do
 * contexto NÃO entra em `sessao.percent`: o CLI ainda o desenharia como medido.
 */
async function pedidoDoMod($, cwd, agoraMs) {
  let usage = null;
  try { usage = await $.session.usage(); } catch { usage = null; }
  let agentes = null;
  try { agentes = await $.agent.list(); } catch { agentes = null; }
  let bruto;
  try { bruto = await $.env.get('GABARITO_POUSO_X'); } catch { bruto = undefined; }
  await carregarNotificado($);
  const pedido = montarPedido({
    usage, agentes, x: lerX(bruto).x, notificacao: S.notificado?.resultado ?? null, pacote: S.prefs.pacote ?? S.pacoteSorteado ?? null,
    transcripts: Object.fromEntries(await mapaTranscripts($)),
  });
  const contexto = await lerContexto($, cwd, pedido, agoraMs);
  const nomes = await nomesDosAtivos($, cwd, pedido.agentes, agoraMs);
  atualizarEncerrados(pedido.agentes);
  return {
    ...pedido,
    encerrados: [...S.encerrados],
    acoes: Object.fromEntries(S.acoes),
    segundoPlano: [...S.segundoPlano.values()],
    session_id: S.sessaoId,
    desatualizadoS: S.ultimaOkMs === null ? null : Math.max(0, Math.round((agoraMs - S.ultimaOkMs) / 1000)),
    nomes,
    contexto,
  };
}

/**
 * Encerrados (FIEL-6 a, T35): a lista de agentes é a fonte. `completed`/`failed`/`killed` ⇒ entra (e a ação dele sai); de volta a `pending`/`running`/`waiting`
 * ⇒ sai (S13: `SendMessage` retoma um agente `completed`). Lista inválida (`null`) ⇒ nada muda. Teto 256: o mais antigo sai. O `SubagentStop` sozinho NÃO
 * encerra (S13: chega com o agente ainda `running`, e há stops intermediários de agente que só espera trabalho em segundo plano).
 */
export function atualizarEncerrados(agentes) {
  if (!Array.isArray(agentes)) return;
  for (const a of agentes) {
    if (!ehObj(a) || typeof a.id !== 'string' || !AGENTE_RE.test(a.id)) continue;
    if (TERMINAIS.has(a.status)) {
      S.encerrados.delete(a.id); S.encerrados.add(a.id);
      S.acoes.delete(a.id); S.acoesBase.delete(a.id);
    } else if (ATIVOS.has(a.status)) S.encerrados.delete(a.id);
  }
  while (S.encerrados.size > TETO_ENCERRADOS) S.encerrados.delete(S.encerrados.values().next().value);
}

/** Repo com onboarding? Resposta da ponte; qualquer falha ⇒ `false` (falha fechada: sem onboarding confirmado, nada grava). `true` fica na memória por raiz. */
async function comOnboarding($, cwd) {
  if (S.onboardingDe === cwd) return true;
  const q = pedidoOnboarding(cwd, $.plugin.root);
  if (q === null) return false;
  try {
    const r = await $.process.run(q.argv, { cwd, stdin: q.stdin, timeoutMs: TIMEOUT_MS });
    const o = r?.exitCode === 0 && typeof r.stdout === 'string' ? JSON.parse(r.stdout) : null;
    if (ehObj(o) && o.ok === true && o.onboarding === true) { S.onboardingDe = cwd; return true; }
  } catch { /* ponte negada ou resposta torta */ }
  return false;
}

/** Contexto do orquestrador: `usage.context.percent` (fonte `mod`); nulo ⇒ plano B pelo transcript da sessão (`transcript`, estimado); grava `.harness/contexto/<sessao>.json`. */
async function lerContexto($, cwd, pedido, agoraMs) {
  let contexto = null;
  if (pedido.sessao.percent !== null) contexto = { percent: pedido.sessao.percent, fonte: 'mod', estimado: false };
  else {
    const q = pedidoPlanoB(S.transcriptSessao);
    if (q !== null) {
      let r = null;
      try { r = await $.process.run(q.argv, { cwd, stdin: q.stdin, timeoutMs: TIMEOUT_MS }); } catch { r = null; }
      const p = percentDoPlanoB(r, pedido.sessao.window);
      if (p !== null) contexto = { percent: p, fonte: 'transcript', estimado: true };
    }
  }
  S.contexto = contexto;
  const g = contexto === null || !(await comOnboarding($, cwd)) ? null : gravarContexto({ sessao: S.sessaoId, percent: contexto.percent, fonte: contexto.fonte, emMs: agoraMs, pacote: S.prefs.pacote ?? S.pacoteSorteado ?? undefined });
  if (g !== null) {
    try { await $.process.run(g.argv, { cwd, stdin: g.stdin, timeoutMs: TIMEOUT_MS }); } catch { /* o arquivo fica velho e `proxima` o descarta após 120 s */ }
  }
  return contexto;
}

/** `painel:nomes` do store, 1× por processo. Corrompido ⇒ recomeça e avisa 1×. */
async function carregarNomes($) {
  if (S.nomesLido) return;
  S.nomesLido = true;
  let v;
  try { v = await $.store.get(CHAVE_NOMES); } catch { return; }
  const r = nomesValidos(v);
  for (const [k, x] of r.mapa) if (!S.nomes.has(k)) S.nomes.set(k, x);
  if (r.estado === 'corrompido') logUma($, 'nomes-corrompidos', 'gabarito: os nomes da equipe do painel estavam corrompidos; recomecei.');
}

const SCRIPT_PACOTE = `/*gabarito:pacote*/
const fs = require('node:fs'), path = require('node:path');
const { nome, fabrica, raiz } = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const arq of [path.join(fabrica, nome + '.json'), ...(raiz ? [path.join(raiz, '.harness', 'temas', 'nomes', nome + '.json')] : [])]) {
  let o; try { o = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { continue; }
  process.stdout.write(JSON.stringify({ ok: true, pacote: { lider: o.lider, sabio: o.sabio, nomes: o.nomes } }) + '\\n'); process.exit(0);
}
process.stdout.write(JSON.stringify({ ok: false }) + '\\n'); process.exit(1);`;

/** Pacote em uso (`lider`, `sabio`, `nomes`), lido 1× por nome de pacote pela ponte. Falha ⇒ `null` (o ativo sem nome fica sem nome). */
async function pacoteDosNomes($, cwd) {
  const nome = S.prefs.pacote ?? S.pacoteSorteado ?? 'terra-media';
  if (S.pacoteNomesDe === nome) return S.pacoteNomes;
  S.pacoteNomesDe = nome;
  S.pacoteNomes = null;
  let raiz = null;
  try { raiz = (await $.session.repo())?.root ?? null; } catch { raiz = null; }
  try {
    const r = await $.process.run(['node', '-e', SCRIPT_PACOTE], { cwd, stdin: JSON.stringify({ nome, fabrica: `${$.plugin.root}/mod/temas/nomes`, raiz: typeof raiz === 'string' ? raiz : null }), timeoutMs: TIMEOUT_MS });
    const o = r?.exitCode === 0 && typeof r.stdout === 'string' ? JSON.parse(r.stdout) : null;
    const p = ehObj(o) && o.ok === true && ehObj(o.pacote) ? o.pacote : null;
    if (p !== null && Array.isArray(p.nomes) && p.nomes.every((n) => typeof n === 'string') && typeof p.lider === 'string' && typeof p.sabio === 'string') S.pacoteNomes = p;
  } catch { S.pacoteNomes = null; }
  return S.pacoteNomes;
}

/** Nomes dos ativos (FIEL-3 d): `{agent_id: nome}` dos ativos com nome; grava `painel:nomes` quando muda. Nunca lança. */
async function nomesDosAtivos($, cwd, agentes, agoraMs) {
  try {
    await carregarNomes($);
    const ativos = (Array.isArray(agentes) ? agentes : []).filter((a) => ATIVOS.has(a.status) && AGENTE_RE.test(a.id)).map((a) => a.id);
    if (ativos.length === 0) return {};
    const pacote = await pacoteDosNomes($, cwd); // 1 leitura por pacote: um nome guardado pode precisar mudar (repetido entre ativos)
    const pares = (Array.isArray(S.estado?.plano?.tasks) ? S.estado.plano.tasks : []).map((t) => t?.nome).filter((n) => typeof n === 'string');
    const { mapa, mudou } = atribuirNomes(S.nomes, ativos, pacote, pares, agoraMs);
    S.nomes = mapa;
    if (mudou) { try { await $.store.set(CHAVE_NOMES, Object.fromEntries(mapa)); } catch { /* vale nesta sessão */ } }
    // a forma do CLI (`validarNomesAgentes`): `{agent_id: {nome, vistoEm}}`; nome fora do padrão do CLI não vai (um só derrubaria o stdin inteiro)
    return Object.fromEntries(ativos.map((id) => [id, mapa.get(id)]).filter(([, v]) => typeof v?.nome === 'string' && NOME_VIVO_RE.test(v.nome)).map(([id, v]) => [id, { nome: v.nome, vistoEm: v.vistoEm }]));
  } catch {
    return {};
  }
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

/**
 * Pouso pendente ⇒ push 1× por chave `<ID>|pouso|<seq>` (FIEL-14 d), como o PAROU: `store.set` antes do `notify`, a memória segura a repetição,
 * `notify` que falha não apaga o toast nem a linha do "depende de você" e não se repete na mesma chave. Sem o item ⇒ nada (a marca fica: o
 * próximo pouso tem seq nova).
 */
export async function avisarPouso($, estado) {
  const chave = chavePouso(estado);
  if (chave === null) return;
  if (!S.notificadoPousoLido) {
    S.notificadoPousoLido = true;
    try {
      const v = await $.store.get(CHAVE_NOTIFICADO_POUSO);
      if (ehObj(v) && typeof v.chave === 'string') S.notificadoPouso = { chave: v.chave, resultado: ehObj(v.resultado) ? v.resultado : null };
    } catch { /* a memória faz o papel */ }
  }
  if (S.notificadoPouso?.chave === chave) return;
  S.notificadoPouso = { chave, resultado: null };
  try { await $.store.set(CHAVE_NOTIFICADO_POUSO, { chave, resultado: null }); } catch { /* a memória segura */ }
  const texto = textoDoPouso(estado);
  try { await $.ui.toast(texto, { timeoutMs: 20000 }); } catch { /* sem tela */ }
  let resultado;
  try {
    const r = await $.ui.notify(texto);
    resultado = r?.isSent === true ? { ts: new Date(await agora($)).toISOString() } : { motivo: typeof r?.reason === 'string' && r.reason !== '' ? r.reason : 'falhou' };
  } catch {
    resultado = { motivo: 'falhou' };
  }
  S.notificadoPouso = { chave, resultado };
  try { await $.store.set(CHAVE_NOTIFICADO_POUSO, { chave, resultado }); } catch { /* a memória segura */ }
}

/** `painel.mjs medir --agentes` (REQ-DIA-1): grava `fato.medido` quando o valor muda. Falha não vira aviso: a próxima medição tenta de novo. */
async function medirAgora($, cwd, pedido) {
  try {
    await $.process.run(['node', `${$.plugin.root}/gates/scripts/painel.mjs`, 'medir', '--agentes'], { cwd, stdin: JSON.stringify(pedido), timeoutMs: TIMEOUT_MEDIR_MS });
  } catch { /* medir é melhor esforço */ }
}

/**
 * Nunca os dois (REQ-GLB-1, review r1 T20): resolvido o local, `acima` FECHA a Pane que o motor ainda lista de antes (troca pelo onboarding ou
 * no config, depois /clear ou reload). 1× por `session.start`/reload: o motor pode seguir listando a Pane fechada.
 */
async function aplicarLocal($, lista) {
  if (S.localAplicado || !Array.isArray(lista)) return; // não li as Panes: tenta na próxima leitura
  S.localAplicado = true;
  if (S.local !== 'acima' || !lista.some((x) => x?.id === ID_PANE)) return;
  S.aberta = false;
  try { await $.ui.close({ id: ID_PANE }); } catch { /* já fechada */ }
  await lerPanes($);
}

async function uma($, motivo) {
  await preparar($);
  await aplicarLocal($, await lerPanes($));
  let cwd;
  try { cwd = await $.session.root(); } catch { cwd = null; }
  let s;
  if (cwd === null || typeof cwd !== 'string') {
    s = { classe: 'erro', erro: 'sessao_sem_raiz', mensagem: 'a sessão não tem raiz' };
  } else {
    const pedido = await pedidoDoMod($, cwd, await agora($));
    if (S.medirPedida) { S.medirPedida = false; if (await comOnboarding($, cwd)) await medirAgora($, cwd, pedido); } // antes do estado: o estado já lê o fato que acabou de mudar; releitura ao vivo NÃO mede (gh a cada tool.call)
    const t0 = await agora($);
    try {
      const r = await $.process.run(['node', `${$.plugin.root}/gates/scripts/painel.mjs`, 'estado', '--agentes'], { cwd, stdin: JSON.stringify(pedido), timeoutMs: TIMEOUT_MS });
      s = interpretarSaida(r);
    } catch {
      s = { classe: classeDaFalha((await agora($)) - t0) };
    }
  }
  garantirRelogio($);
  const t1 = await agora($);
  if (s.classe !== 'ok') { // GM-14 T20 (FIEL-10 e): "sem loop" também é falha de leitura; nada se esconde nem o relógio para
    S.falha = s; S.semLoop = false;
    S.semLerS = S.ultimaOkMs === null ? null : Math.max(0, Math.round((t1 - S.ultimaOkMs) / 1000));
    await lerPanes($);
    redesenhar($);
    return;
  }
  S.estado = s.estado; S.avisos = s.avisos; S.falha = null; S.semLoop = false; S.ultimaOkMs = t1; S.semLerS = null;
  const lista = await lerPanes($);
  const jaListada = Array.isArray(lista) && lista.some((x) => x?.id === ID_PANE);
  if (S.local === 'lateral' && !S.aberta && !S.fechadaPeloDono && !jaListada) { await abrirPainel($); await lerPanes($); } else if (jaListada && S.local === 'lateral') S.aberta = true;
  redesenhar($);
  await avisarParar($, s.estado);
  await avisarPouso($, s.estado);
}

/** Uma ponte por vez, com coalescência: o que chega com a ponte em voo vira 1 pendente (no máximo), rodado quando ela termina. Nunca lança. */
export async function atualizar($, motivo) {
  if (!S.interativo) return;
  if (motivo !== 'ao-vivo') S.medirPedida = true; // só a releitura ao vivo dispensa a medição externa (ritmo próprio: relógio, turno, painel)
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

// ─────────────────────────────────────────────────────────────── prefs, sorteio, transcripts e comando (E4 T11)

function logUma($, tipo, texto) {
  if (S.logados.has(tipo)) return;
  S.logados.add(tipo);
  try { $.ui.log(texto, { to: 'transcript' }); } catch { /* sem transcript */ }
}

async function carregarPrefs($) {
  let v;
  try { v = await $.store.get(CHAVE_PREFS); } catch { logUma($, 'prefs-store', 'gabarito: não consegui ler as preferências do painel; uso o padrão.'); return; }
  const r = prefsValidas(v);
  S.prefs = r.prefs;
  if (r.estado === 'corrompido') logUma($, 'prefs-corrompidas', 'gabarito: as preferências do painel estavam corrompidas; uso o padrão.');
}

/** Pacote da sessão (sombra-p1d T11): `prefs.pacote` vence; senão `{nome, sessao}` do store; mesma sessão ⇒ mantém; outra ⇒ sorteia sem repetir o anterior. */
async function escolherPacote($) {
  if (S.prefs.pacote !== null) return;
  let id;
  try { id = await $.session.id(); } catch { id = null; }
  if (typeof id !== 'string' || id === '') { S.pacoteSorteado = 'terra-media'; return; }
  let v;
  try { v = await $.store.get(CHAVE_PACOTE); } catch { v = undefined; }
  let anterior = null;
  if (ehObj(v) && typeof v.nome === 'string' && PACOTE_RE.test(v.nome)) {
    if (v.sessao === id) { S.pacoteSorteado = v.nome; return; }
    anterior = v.nome;
  } else if (typeof v === 'string' && PACOTE_RE.test(v)) {
    anterior = v; // formato legado: string
  } else if (v !== undefined) {
    logUma($, 'pacote-corrompido', 'gabarito: o pacote de nomes do painel estava corrompido; sorteei outro.');
  }
  const nome = sortearPacote(id, [...PACOTES_FABRICA], anterior);
  S.pacoteSorteado = nome;
  try { await $.store.set(CHAVE_PACOTE, { nome, sessao: id }); } catch { /* vale nesta sessão */ }
}

/** `painel.local` por `onboarding.mjs painel` (T21): ausente ⇒ lateral calado; corrompido ou ponte que falha ⇒ lateral e 1 aviso (distintos). */
async function carregarLocal($) {
  let cwd;
  try { cwd = await $.session.root(); } catch { cwd = null; }
  let r = null;
  if (typeof cwd === 'string') {
    try { r = await $.process.run(['node', `${$.plugin.root}/gates/scripts/onboarding.mjs`, 'painel'], { cwd, timeoutMs: TIMEOUT_MS }); } catch { r = null; }
  }
  const l = localDaSaida(r);
  S.local = l.local;
  if (l.estado === 'corrompido') logUma($, 'local-corrompido', 'gabarito: a configuração do local do painel está corrompida; uso ao lado da conversa.');
  else if (l.estado === 'ilegivel') logUma($, 'local-ilegivel', 'gabarito: não consegui ler o local do painel; uso ao lado da conversa.');
}

/** Prefs, sorteio, local do painel e id da sessão, 1× por `session.start`. Nunca lança. */
export function preparar($) {
  if (S.preparando === null) {
    S.preparando = (async () => {
      try { await carregarPrefs($); } catch { /* padrão */ }
      try { await escolherPacote($); } catch { /* sem pacote sorteado: o CLI usa a fábrica */ }
      try { await carregarLocal($); } catch { S.local = LOCAL_PADRAO; }
      try { const id = await $.session.id(); S.sessaoId = typeof id === 'string' && SESSAO_RE.test(id) ? id : null; } catch { S.sessaoId = null; }
    })();
  }
  return S.preparando;
}

async function mapaTranscripts($) {
  if (!S.transcriptsLido) {
    S.transcriptsLido = true;
    try {
      const v = await $.store.get(CHAVE_TRANSCRIPTS);
      if (ehObj(v)) {
        for (const [k, c] of Object.entries(v)) if (AGENTE_RE.test(k) && typeof c === 'string' && !S.transcripts.has(k)) inserirComTeto(S.transcripts, k, c);
      }
    } catch { /* store fora do ar: só a memória */ }
  }
  return S.transcripts;
}

/** `classic.SubagentStart`: guarda o caminho do transcript do agente (teto de 64). Dado fora da forma ⇒ nada. Nunca lança. */
export async function registrarSubagente($, e) {
  // GM-14 T20: o `transcript_path` do evento é o da SESSÃO (o pai): fonte do plano B do contexto do orquestrador
  if (typeof e?.transcript_path === 'string' && e.transcript_path.startsWith('/')) S.transcriptSessao = e.transcript_path;
  if (typeof e?.agent_id === 'string') S.encerrados.delete(e.agent_id); // GM-14 T35: o agente que recomeça não fica escondido
  const caminho = caminhoDoTranscript(e);
  if (caminho === null) return;
  try {
    const mapa = await mapaTranscripts($);
    inserirComTeto(mapa, e.agent_id, caminho);
    await $.store.set(CHAVE_TRANSCRIPTS, Object.fromEntries(mapa));
  } catch { /* a memória do módulo basta nesta sessão */ }
}

// ─────────────────────────────────────────────────────────────── AGORA ao vivo (GM-14 T35): ações, encerrados e segundo plano

/** Insere no fim com teto: reinserir o mesmo id o move para o fim; passou do teto, sai o mais antigo. */
function inserirNoFim(mapa, id, valor, teto) {
  mapa.delete(id);
  mapa.set(id, valor);
  while (mapa.size > teto) mapa.delete(mapa.keys().next().value);
}

/** Pede uma releitura do estado agora, sem esperar o relógio. `limitar` ⇒ no máximo 1 a cada `JANELA_ACAO_MS`; `espera` adia (o `SubagentStop`). */
async function pedirReleitura($, { limitar = false, espera = 0 } = {}) {
  if (!S.interativo) return;
  if (limitar) {
    const t = await agora($);
    if (S.ultimaAcaoMs !== null && t - S.ultimaAcaoMs < JANELA_ACAO_MS) { // dentro da janela: 1 leitura no FIM dela, para a última ação da rajada não ficar 60 s sem aparecer
      if (!S.acaoAgendada) {
        S.acaoAgendada = true;
        try {
          $.clock.after(JANELA_ACAO_MS - (t - S.ultimaAcaoMs), async () => { S.acaoAgendada = false; S.ultimaAcaoMs = await agora($); void atualizar($, 'ao-vivo'); });
        } catch { S.acaoAgendada = false; }
      }
      return;
    }
    S.ultimaAcaoMs = t;
  }
  try { $.clock.after(espera, () => { void atualizar($, 'ao-vivo'); }); } catch { /* sem relógio */ }
}

/**
 * `tool.call` com `agentId` (S12: 9/9 chamadas de subagente): guarda a última ação do agente. `Bash` com `description` ⇒ a descrição (fonte `bash`);
 * outra ferramenta da tabela ⇒ a frase da T5 no presente, com a contagem de chamadas seguidas do mesmo tipo (fonte `tool`). Sem `agentId` válido
 * (orquestrador) ou fora da tabela ⇒ nada. Devolve se houve ação nova.
 */
async function anotarAcao($, e) {
  const id = e?.agentId;
  if (typeof id !== 'string' || !AGENTE_RE.test(id)) return false;
  const chamada = { nome: e.tool, erro: false, papel: e.subagent_type, descricao: e.tool === 'Bash' ? e.description : undefined };
  const base = acaoDe(chamada, 1);
  if (base === null) return false;
  const bash = e.tool === 'Bash' && descricaoLimpa(e.description) !== null;
  let n = 1;
  if (!bash) {
    const ant = S.acoesBase.get(id);
    n = ant !== undefined && ant.base === base ? ant.n + 1 : 1;
  }
  S.acoesBase.set(id, { base: bash ? null : base, n });
  const texto = acaoDe({ ...chamada }, n);
  if (texto === null) return false;
  inserirNoFim(S.acoes, id, { texto, fonte: bash ? 'bash' : 'tool', em: Math.max(0, Math.round(await agora($))) }, TETO_ACOES);
  while (S.acoesBase.size > TETO_ACOES * 2) S.acoesBase.delete(S.acoesBase.keys().next().value);
  return true;
}

/** Resultado do `Bash` com `backgroundTaskId` (S14: 3/3 no orquestrador, 3/3 no subagente) ⇒ entra no segundo plano. Devolve se entrou. */
async function anotarSegundoPlano($, e, r) {
  if (e?.tool !== 'Bash') return false;
  const id = r?.result?.backgroundTaskId;
  if (typeof id !== 'string' || !AGENTE_RE.test(id)) return false;
  const texto = descricaoLimpa(e.description)
    ?? ([...String(typeof e.command === 'string' ? e.command : '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim()].slice(0, MAX_TEXTO_SEGUNDO_PLANO).join('').trim() || 'comando em segundo plano');
  const dono = typeof e.agentId === 'string' && AGENTE_RE.test(e.agentId) ? e.agentId : 'orquestrador';
  inserirNoFim(S.segundoPlano, id, { id, dono, texto, desde: Math.max(0, Math.round(await agora($))) }, TETO_SEGUNDO_PLANO);
  return true;
}

/**
 * `Stop`/`SubagentStop` com `background_tasks` (S14): o que o segundo plano guardava e a lista não traz mais terminou. Sem lista (ausente ou não lista)
 * ⇒ nada sai (ausente ≠ vazio). Devolve se algo saiu.
 */
export function podarSegundoPlano(e) {
  const l = e?.background_tasks;
  if (!Array.isArray(l)) return false;
  const vivos = new Set(l.filter(ehObj).map((t) => t.id).filter((id) => typeof id === 'string'));
  let saiu = false;
  for (const id of [...S.segundoPlano.keys()]) if (!vivos.has(id)) { S.segundoPlano.delete(id); saiu = true; }
  return saiu;
}

async function gravarPrefs($, mudanca) {
  S.prefs = { ...S.prefs, ...mudanca };
  try { await $.store.set(CHAVE_PREFS, { ...S.prefs }); return true; } catch { return false; }
}

const SO_NA_SESSAO = ' (só nesta sessão: não gravei a preferência)';

const NOME_LOCAL = { lateral: 'ao lado da conversa', acima: 'acima da linha de digitar' };

async function abrirPeloDono($, rotulo = 'painel aberto') {
  S.fechadaPeloDono = false;
  const gravou = S.prefs.ligado === true ? true : await gravarPrefs($, { ligado: true });
  if (S.local === 'acima') { // nunca os dois: o painel já é a faixa
    redesenhar($);
    void atualizar($, 'painel');
    return `painel ${NOME_LOCAL.acima}` + (gravou ? '' : SO_NA_SESSAO);
  }
  let r;
  try { r = await $.ui.open({ id: ID_PANE, title: 'gabarito', focus: true }); } catch { r = { isPlaced: false, reason: 'falhou' }; }
  S.aberta = true;
  guardarRazao(r);
  await lerPanes($);
  S.interativo = true; // quem digitou `/gabarito painel` está à frente, inclusive no app desktop (o SDK chega com `isInteractive: false`)
  void atualizar($, 'painel');
  const base = r?.isPlaced === true ? rotulo : `painel não coube: ${typeof r?.reason === 'string' && r.reason !== '' ? r.reason : 'sem motivo'}`;
  return base + (gravou ? '' : SO_NA_SESSAO);
}

async function comandoPainelBruto($, partes) {
  await preparar($);
  const [a, b] = partes;
  if (partes.length === 0) return abrirPeloDono($);
  const troca = async (mudanca, texto) => {
    const gravou = await gravarPrefs($, mudanca);
    redesenhar($);
    return texto + (gravou ? '' : SO_NA_SESSAO);
  };
  if (partes.length === 1) {
    if (PRESETS.includes(a)) return troca({ preset: a }, `painel: ${a}`);
    if (TEMAS.includes(a)) return troca({ tema: a }, `painel: ${a}`);
    if (a === 'ligar') return abrirPeloDono($, 'painel ligado');
    if (a === 'mostrar') {
      const r = await abrirPeloDono($, 'painel visível');
      return S.local === 'acima' ? r.replace(`painel ${NOME_LOCAL.acima}`, 'painel visível') : r;
    }
    if (a === 'desligar' || a === 'ocultar') {
      const gravou = await gravarPrefs($, { ligado: false });
      S.aberta = false;
      try { await $.ui.close({ id: ID_PANE }); } catch { /* já fechada */ }
      redesenhar($);
      return (a === 'ocultar' ? 'painel oculto (PAROU e perguntas continuam)' : 'painel desligado (PAROU ainda avisa)') + (gravou ? '' : SO_NA_SESSAO);
    }
    if (LOCAIS.includes(a)) return trocarLocal($, a);
    return USO_GABARITO;
  }
  if (partes.length === 2) {
    if (a === 'narracao' && (b === 'on' || b === 'off')) return troca({ narracao: b === 'on' }, `painel: narração ${b === 'on' ? 'ligada' : 'desligada'}`);
    if (a === 'nomes') return nomesDoPainel($, b);
  }
  return USO_GABARITO;
}

/**
 * `/gabarito painel lateral|acima` (REQ-GLB-1, D-P2): grava `painel.local` por `onboarding.mjs painel --local <x>` (merge de chave, T21) e troca
 * sem reiniciar: `acima` fecha a Pane; `lateral` a abre (se o painel não está oculto). Gravação recusada ⇒ vale só nesta sessão, e a resposta diz.
 */
async function trocarLocal($, local) {
  let cwd;
  try { cwd = await $.session.root(); } catch { cwd = null; }
  let gravou = false;
  if (typeof cwd === 'string') {
    try {
      const r = await $.process.run(['node', `${$.plugin.root}/gates/scripts/onboarding.mjs`, 'painel', '--local', local], { cwd, timeoutMs: TIMEOUT_MS });
      const o = r?.exitCode === 0 && typeof r.stdout === 'string' ? JSON.parse(r.stdout) : null;
      gravou = ehObj(o) && o.ok === true && o.local === local;
    } catch { gravou = false; }
  }
  S.local = local;
  S.localAplicado = true; // a troca já aplica o local abaixo
  if (local === 'acima') {
    S.aberta = false;
    try { await $.ui.close({ id: ID_PANE }); } catch { /* já fechada */ }
  } else {
    S.fechadaPeloDono = false;
    S.aberta = false;
    await abrirPainel($);
    S.aberta = S.prefs.ligado !== false;
  }
  redesenhar($);
  return `painel ${NOME_LOCAL[local]}` + (gravou ? '' : SO_NA_SESSAO);
}

async function nomesDoPainel($, p) {
  if (!PACOTE_RE.test(p)) return `pacote inválido: ${cortar(limpar(p), 40)} (fábrica: ${PACOTES_FABRICA.join(' ')})`;
  if (!PACOTES_FABRICA.includes(p)) {
    let raiz = null;
    try { raiz = (await $.session.repo())?.root ?? null; } catch { raiz = null; }
    if (typeof raiz !== 'string') { try { raiz = await $.session.root(); } catch { raiz = null; } }
    if (typeof raiz !== 'string' || raiz === '') return `pacote não encontrado: ${p}`;
    let existe;
    try { existe = await $.fs.exists(`${raiz}/.harness/temas/nomes/${p}.json`); } catch { return `não consegui verificar o pacote: ${p}`; }
    if (existe !== true) return `pacote não encontrado: ${p}`;
  }
  const gravou = await gravarPrefs($, { pacote: p });
  void atualizar($, 'prefs');
  return `painel: nomes ${p}` + (gravou ? '' : SO_NA_SESSAO);
}

/** `/gabarito painel …` (`partes` = o que vem depois de `painel`). A resposta é uma linha (`umaLinha`), salvo a ajuda (`USO_GABARITO`). Nunca lança. */
export async function comandoPainel($, partes) {
  try {
    const r = await comandoPainelBruto($, Array.isArray(partes) ? partes : []);
    return r === USO_GABARITO ? r : umaLinha(r);
  } catch {
    return 'painel: erro inesperado';
  }
}

// ─────────────────────────────────────────────────────────────── desenho (hooks)

const colunasDe = (props) => larguraDe(props?.bodyColumns);

/** Um `Button` por ação: `onPress` põe o comando no input (`replace`), NUNCA envia. Chaves `painel-acao`, `painel-acao-2`, … */
function botoesDe($, Button, Text, botoes) {
  return botoes.flatMap((b, i) => [h(Text, { key: `painel-esp-${i + 1}` }, ' '), h(Button, {
    key: i === 0 ? 'painel-acao' : `painel-acao-${i + 1}`,
    label: b.rotulo,
    onPress: async () => {
      try {
        const r = await $.prompt.fill({ text: b.comando, mode: 'replace' });
        if (r?.isFilled !== true) $.ui.status('gabarito: não consegui pôr o comando no prompt');
      } catch {
        try { $.ui.status('gabarito: não consegui pôr o comando no prompt'); } catch { /* sem tela */ }
      }
    },
  })]);
}

/** Linhas ⇒ árvore; `botoes` vão SÓ na linha do topo (`indiceDoTopo`), que é cortada para eles caberem em `largura`. */
function arvoreDeLinhas($, e, linhas, botoes = [], largura = 0) {
  const { Box, Button, Text } = $.ui.resolve(e);
  const topo = botoes.length > 0 ? indiceDoTopo(linhas) : -1;
  return h(Box, { flexDirection: 'column' }, ...linhas.map((l0, i) => {
    const l = i === topo && largura > 0 ? cortarLinha(l0, largura - colunasDosBotoes(botoes)) : l0;
    const filhos = l.filter((s) => s.texto !== '').map((s) => h(Text, s.cor === undefined ? null : { color: s.cor }, s.texto));
    const texto = h(Text, null, ...(filhos.length === 0 ? [' '] : filhos));
    return i === topo ? h(Box, { flexDirection: 'row' }, texto, ...botoesDe($, Button, Text, botoes)) : texto;
  }));
}

/**
 * `session.start` do painel: chamado de dentro do hook que `gabarito.mjs` já tem (o motor recusa dois `on('session.start')` sem matcher). Não bloqueia:
 * `atualizar('inicio')` roda num timer. `-p` (`isInteractive: false` ou `surface: null`) sem nenhuma superfície em `$.session.surfaces()` ⇒ nada do painel.
 */
export async function iniciarPainel($, e) {
  S.interativo = e?.isInteractive === true && e?.surface !== null && e?.surface !== undefined;
  if (!S.interativo && await temSuperficie($)) S.interativo = true; // start repetido (reload do módulo) depois de um attach: a tela segue lá, não rebaixa
  if (!S.interativo) return;
  if (typeof e?.transcript_path === 'string' && e.transcript_path.startsWith('/')) S.transcriptSessao = e.transcript_path;
  S.preparando = null; // cada `session.start` relê as prefs e confere o sorteio (mesma sessão ⇒ mantém)
  S.localAplicado = false; // e reaplica o local resolvido à Pane listada
  try { $.clock.after(0, () => { void atualizar($, 'inicio'); }); } catch { /* sem relógio */ }
}

/** Alguma superfície desenha a sessão? (`$.session.surfaces()`: vazio em `-p`; no app desktop o SDK chega sem tela no `session.start` e ela aparece em `session.attach`.) Nunca lança. */
async function temSuperficie($) {
  try {
    const l = await $.session.surfaces();
    return Array.isArray(l) && l.length > 0;
  } catch {
    return false;
  }
}

/** `turn.complete` do painel (qualquer `agentId`): o turno não espera a ponte (até 5 s), `atualizar` roda num timer. */
export async function turnoDoPainel($) {
  if (!S.interativo) return;
  try { $.clock.after(0, () => { void atualizar($, 'turno'); }); } catch { /* sem relógio */ }
}

/** Registra os hooks de desenho do painel (`ui.close`, `ui.render`). Chamado no começo de `register` de `gabarito.mjs`. */
export function registrarPainel(on) {
  on('classic.SubagentStart', async ($, e, next) => {
    try { await registrarSubagente($, e); } catch { /* o painel não derruba o hook */ }
    return next(e);
  });

  // GM-14 T35: a ação ao vivo (S12) e o segundo plano (S14). O resultado do motor passa intacto; o painel só observa.
  on('tool.call', async ($, e, next) => {
    if (!S.interativo) return next(e);
    try { if (await anotarAcao($, e)) await pedirReleitura($, { limitar: true }); } catch { /* o painel não derruba a chamada */ }
    const r = await next(e);
    try { if (await anotarSegundoPlano($, e, r)) await pedirReleitura($); } catch { /* idem */ }
    return r;
  });

  on('classic.SubagentStop', async ($, e, next) => {
    try { podarSegundoPlano(e); await pedirReleitura($, { espera: ESPERA_STOP_MS }); } catch { /* o painel não derruba o hook */ }
    return next(e);
  });

  on('classic.Stop', async ($, e, next) => {
    try { if (podarSegundoPlano(e)) await pedirReleitura($); } catch { /* idem */ }
    return next(e);
  });

  on('session.attach', async ($, e, next) => {
    try {
      S.interativo = true; // há uma superfície anexada (app desktop, celular): tem gente olhando
      $.clock.after(0, () => { void atualizar($, 'attach'); });
    } catch { /* o painel não derruba o hook */ }
    return next(e);
  });

  on('ui.close', async ($, e, next) => {
    if (e?.id === ID_PANE && e?.origin?.kind === 'person') S.fechadaPeloDono = true;
    return next(e);
  });

  on('ui.render', { component: 'Pane', requestId: ID_PANE }, async ($, e) => {
    if (!S.interativo && await temSuperficie($)) S.interativo = true; // alguém desenha a Pane: a sessão tem tela
    if (S.interativo && S.relogio === null && !S.semLoop) { // módulo recarregado com a Pane de pé: recomeça o ciclo (uma vez: o relógio passa a existir)
      try { $.clock.after(0, () => { void atualizar($, 'render'); }); } catch { /* sem relógio */ }
    }
    if (S.local !== 'lateral') { // nunca os dois: em `acima` o painel é a faixa; a Pane listada de antes não desenha (e `uma` a fecha)
      const { Box } = $.ui.resolve(e);
      return h(Box, null);
    }
    let linhas;
    let botoes = [];
    const larg = colunasDe(e.props);
    try {
      // GM-14 T20: orçamento = `scroll.bodyRows` (ausente ⇒ 7, nunca rola); o estado novo ganha os botões do topo
      const bodyRows = e.props?.scroll?.bodyRows;
      const novo = estadoNovo(S.estado);
      botoes = novo ? botoesDoTopo(S.estado, $.plugin.root) : [];
      linhas = linhasDaPane(novo ? estadoParaDesenho(S.estado) : S.estado, S.prefs, larg, {
        falha: S.falha, avisos: S.avisos, semLoop: S.semLoop, semLerS: S.semLerS, altura: bodyRows, orcamento: orcamentoLateral(bodyRows), local: 'lateral',
      });
      if (novo) linhas = linhas.slice(0, orcamentoLateral(bodyRows));
    } catch {
      linhas = [[{ texto: 'painel: não consegui desenhar', cor: 'warning' }]];
      botoes = [];
    }
    return arvoreDeLinhas($, e, linhas, botoes, larg);
  });

  /**
   * Faixa acima do input (GM-14 T20, REQ-GLB-1): survey ⇒ `next(e)`. `acima` e visível ⇒ o painel inteiro no orçamento de H/`maxRows`.
   * `lateral` com a Pane visível ⇒ `next(e)` (nunca os dois). Pane invisível ou painel oculto ⇒ 1 linha só com PAROU ou pergunta; sem eles, `next(e)`.
   * EXCEÇÃO DECLARADA (T50, emenda 44) a "em lateral o AbovePrompt devolve next(e)": `lateral` com a Pane que a plataforma lista sem colocar ⇒ a mesma
   * linha única leva o aviso "painel lateral precisa de <N> colunas: /gabarito painel para abrir" depois do PAROU/pergunta; não é 2º local.
   */
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!S.interativo || e.props?.hasSurvey === true) return next(e);
    const oculto = S.prefs.ligado === false;
    const larg = colunasDe(e.props);
    const { Box, Button, Text } = $.ui.resolve(e);
    if (S.local === 'acima' && !oculto) {
      if (S.estado === null && S.falha === null) return next(e);
      let linhas;
      let botoes;
      try {
        botoes = botoesDoTopo(S.estado, $.plugin.root);
        linhas = linhasDaFaixa(S.estado, S.prefs, { largura: larg, h: hDoViewport(e), maxRows: e.props?.maxRows, falha: S.falha, avisos: S.avisos, semLerS: S.semLerS });
      } catch {
        linhas = [[{ texto: 'painel: não consegui desenhar', cor: 'warning' }]];
        botoes = [];
      }
      return arvoreDeLinhas($, e, linhas, botoes, larg);
    }
    let aviso = null;
    if (S.local === 'lateral' && !oculto) {
      await lerPanes($);
      if (S.paneVisivel) return next(e);
      // GM-14 T50 (emenda 44): a plataforma não colocou a Pane (abaixo do limiar, sem o dono pedir) ⇒ o aviso entra na linha única; o dono abre com /gabarito painel
      if (S.paneEspera && !S.fechadaPeloDono) aviso = avisoPaneEspera(S.razaoPane);
    }
    let f;
    try { f = faixaUmaLinha(S.estado, { root: $.plugin.root, aviso }); } catch { f = null; }
    if (f === null) return next(e);
    const cabe = Math.max(1, larg - colunasDosBotoes(f.botoes) - RESERVA_BORDA_DIREITA);
    const cor = S.prefs.tema === 'mono' ? null : { color: f.cor };
    return h(Box, null, h(Text, cor, cortar(f.texto, cabe)), ...botoesDe($, Button, Text, f.botoes));
  });
}

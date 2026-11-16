/**
 * Painel (E4, GM-12): núcleo puro. `projetarPainel(plano, eventos, entrada)` ⇒ `EstadoPainel` (T2) e o despacho do render por preset (T1).
 * Puro: relógio só por `entrada.agoraMs`, fuso só por `entrada.fuso` (via `painel-hora`); sem `fs`, `process` nem `Date.now()`.
 * O fecho de imports não tem `node:*` (o mod carrega o `dist/`): o cronômetro das durações e a contagem de consultas da Sombra vêm de
 * `diario-puro.ts`, a MESMA implementação que `diario.ts` e `sombra.ts` reexportam (sem cópia); o teste `duracoes-igual-ao-diario` prova a fiação.
 * Decisões: `.superpowers/sdd/2026-11-09-e4-painel/sombra-p1a.md` §0 (D-A a D-C) e "Task 2".
 */

import { projetarEmendas, shaAceito } from './emenda.js';
import { cmp, contarConsultas, duracoes, EM_TRABALHO, mediana, projetarDecisoes } from './diario-puro.js';
import { dependeDe } from './depende.js';
import { origemDe } from './origem.js';
import { loteRecomendadas, perguntasAbertas } from './perguntas.js';
import { pousoPendente,              } from './pouso-pendente.js';
import { pedidoDeClear } from './pouso.js';
import { encerramentoDe, trilhaDe } from './trilha.js';
                                               
import { estadoDe, ordenar, proximaAcao, TIPOS_DE_PROGRESSO, TIPOS_DE_TASK } from './loop.js';
                                            
import { formaInvalida } from './formas.js';
import { renderBlocos, renderEsquadrao } from './painel-esquadrao.js';
import { historicoDe } from './painel-texto.js';
import { renderExecutivo } from './painel-executivo.js';
import { cortar } from './painel-largura.js';
import { chaveDoPar, higienizarDescricao, integrandoDe, nomesPorPapel, projetarEquipe, resolverAtivos, rotuloDoShell } from './painel-equipe.js';
                                                         
import { dataCivil, fusoValido, horaLocal } from './painel-hora.js';
                                                                                                                                                                                                                                              

/** Despacha para o render do preset. Preset desconhecido não vira sucesso: lança (quem chama é o CLI, que já validou a flag). */
export function renderPainel(e              , o              )          {
  // GM-14 T17: estado novo (projetado com `fatos`) ⇒ um renderizador só, os 5 blocos; o executivo é o mesmo sem lúdico (FIEL-12)
  if (e !== null && typeof e === 'object' && e.modo !== undefined && (o?.preset === 'esquadrao' || o?.preset === 'executivo')) {
    const l = linhaEntregue(e, o);
    return l !== null ? [l] : renderBlocos(e, o);
  }
  if (o.preset === 'esquadrao') return renderEsquadrao(e, o);
  if (o.preset === 'executivo') return renderExecutivo(e, o);
  throw new RangeError(`preset desconhecido: ${String(o.preset)} (esquadrao | executivo)`);
}

/**
 * GM-15 T8 (REQ-ENT-1 d i): com a entrega encerrada e nada vivo nem pendente além dela, o painel é 1 linha: "<ID> entregue (versão X.Y.Z)" e a próxima
 * (o botão "seguir" vive em `estado.proxima.acoes`). Agente vivo ou item que não é da entrega (fonte que falhou) ⇒ `null` e os blocos de sempre.
 */
function linhaEntregue(e              , o              )               {
  const ent = e.entregue;
  if (ent === null || ent === undefined || typeof ent.id !== 'string' || !ID_ENTREGUE.test(ent.id)) return null;
  const p = e.proxima;
  const daProxima = p !== null && p !== undefined && typeof p.texto === 'string' ? motivoDaProxima(p.texto) : null;
  // r1 MAJOR-2: o que não é da entrega e ficou no estado (pergunta, ATENÇÃO do `_sem-id`; no DEPENDE o PAROU, o /clear da sessão, fonte que falhou) ⇒ os blocos
  if ((e.agora?.agentes?.length ?? 0) > 0 || (e.agora?.segundoPlano?.length ?? 0) > 0 || ehObj(e.pergunta)
    || (Array.isArray(e.atencao) && e.atencao.length > 0)
    || (Array.isArray(e.depende) && e.depende.some((i) => i?.motivo !== NADA && i?.motivo !== daProxima))) return null;
  const w = typeof o?.largura === 'number' && Number.isFinite(o.largura) && o.largura >= 1 ? Math.floor(o.largura) : 80;
  const versao = typeof ent.versao === 'string' && VERSAO_RE.test(ent.versao) ? ` (versão ${ent.versao})` : '';
  const prox = p === null || p === undefined || typeof p.texto !== 'string' || p.texto === '' ? ''
    : p.tipo === 'nenhuma' ? ` · ${p.texto}` : ` · próxima: ${p.texto}`;
  // com o botão "seguir" a linha é item do dono (`◆ `): é a marca que o mod lê para pôr nela os botões do 1º item do DEPENDE (o da próxima)
  const comBotao = daProxima !== null && Array.isArray(p?.acoes) && p.acoes.length > 0 && Array.isArray(e.depende) && e.depende.some((i) => i?.motivo === daProxima);
  return [{ texto: cortar(`${comBotao ? '◆ ' : ''}GABARITO · ${ent.id} entregue${versao}${prox}`, w), cor: comBotao ? 'warning' : 'inactive' }];
}
/** GM-15 T8 (review r1 MAJOR-1): o item do DEPENDE que leva o botão "seguir" da próxima entrega. Não é item da entrega encerrada: é a oferta da próxima. */
export const motivoDaProxima = (texto        )         => `próxima entrega: ${texto}`;
const ID_ENTREGUE = /^[A-Za-z0-9-]{1,40}$/;
/** X.Y.Z com pré-release opcional, a MESMA forma que `formas.ts` (SEMVER_RE) aceita no `entrega.encerrada`: a versão aparece inteira ou não aparece. */
const VERSAO_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * GM-15 T8 (REQ-ENT-1 c, d): a entrega `id` com `entrega.encerrada` vigente (regra única `encerramentoDe`) ⇒ `{id, versao}`; senão `null`. `versao` = a do
 * encerramento INTEIRA (pré-release incluída, sem o `v`: "v2.1.0-alpha.2" ⇒ "2.1.0-alpha.2", nunca "2.1.0"); sem ela, `null` (r1 MAJOR-3): o `fato.medido
 * release` é o último release do repo, sem amarra ao PR nem ao `mergeado_em`, então não diz a versão desta entrega. Puro, nunca lança.
 */
export function entregueDe(eventos                 , id               )                  {
  if (typeof id !== 'string' || !ID_ENTREGUE.test(id) || !Array.isArray(eventos)) return null;
  const enc = encerramentoDe(eventos, id);
  if (!enc.encerrada || enc.primeira === null) return null;
  const v = typeof enc.primeira.versao === 'string' ? enc.primeira.versao.trim().replace(/^v/, '') : '';
  return { id, versao: VERSAO_RE.test(v) ? v : null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tabela do PAROU (REQ-PNL-3, B7): texto e ações fixos por motivo, só comandos que existem. `<task>` é preenchido na projeção.

const MARCA_TASK = '<task>';
/**
 * A tabela da REQ-PNL-3, reescrita em linguagem natural (GM-14 T17, REQ-LNG-1): texto e rótulo sem comando, sem marca técnica e sem palavra que é
 * tipo de evento ou motivo de parada; o comando só vive em `Acao.comando` (o botão). `<task>` só em `teto_rodadas`.
 */
export const TABELA_PARAR                                                        = {
  teto_rodadas: {
    texto: `teto de rodadas de review em ${MARCA_TASK}`,
    acoes: [{ rotulo: 'aprovar', comando: `/gabarito-mestre:liberar ${MARCA_TASK}` }, { rotulo: 'recusar: deixe a task parada e emende a spec', comando: null }],
  },
  ci_vermelho: { texto: 'CI vermelho 2× depois da última integração', acoes: [{ rotulo: 'veja o CI, corrija ou peça a correção, e diga ao loop para seguir', comando: null }] },
  teto_tokens: { texto: 'teto de tokens da entrega', acoes: [{ rotulo: 'aumente o teto de tokens nas configurações ou encerre a entrega', comando: null }] },
  sem_pouso: { texto: 'o pouso automático falhou', acoes: [{ rotulo: 'digite uma mensagem para retomar pelo diário', comando: null }] },
  sem_progresso: { texto: '3 paradas sem progresso', acoes: [{ rotulo: 'leia o diário e diga ao loop o que fazer', comando: null }] },
  diario_invalido: { texto: 'diário fora da tabela de transições', acoes: [{ rotulo: 'confira o diário; nada segue até ele ser válido', comando: null }] },
  nao_conseguiu: { texto: 'sem próxima ação e sem agente vivo', acoes: [{ rotulo: 'leia o diário e diga ao loop o que fazer', comando: null }] },
  smoke: { texto: 'a verificação em produção falhou e a versão anterior voltou', acoes: [{ rotulo: 'confira produção e a causa antes de nova entrega', comando: null }] },
  rollback: { texto: 'a volta à versão anterior falhou: produção em estado desconhecido', acoes: [{ rotulo: 'aja em produção agora', comando: null }] },
  janela_ausente: { texto: 'entrega exige produção sem janela ou comandos', acoes: [{ rotulo: 'declare a janela e os comandos de entrega na configuração de origem', comando: null }] },
};

const ehMotivo = (x         )                   => typeof x === 'string' && Object.hasOwn(TABELA_PARAR, x);

/**
 * Linha da tabela já com a task. O comando só é montado com `task` que o chamador provou ser id do plano; sem task, a ação de liberar
 * vira instrução sem comando (nunca `<task>` literal nem texto do diário num comando).
 */
function linhaDaTabela(motivo             , task               )                                   {
  const { texto, acoes } = TABELA_PARAR[motivo];
  if (motivo !== 'teto_rodadas') return { texto, acoes: acoes.map((a) => ({ ...a })) };
  if (task === null) {
    return {
      texto: texto.replace(` em ${MARCA_TASK}`, ''),
      acoes: acoes.map((a, i) => (i === 0 ? { rotulo: 'liberar: task não identificada; leia o diário', comando: null } : { ...a })),
    };
  }
  return {
    texto: texto.replace(MARCA_TASK, task),
    acoes: acoes.map((a) => ({ rotulo: a.rotulo, comando: a.comando === null ? null : a.comando.replace(MARCA_TASK, task) })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Utilitários

const ehObj = (x         )                               => x !== null && typeof x === 'object' && !Array.isArray(x);
const dadosDe = (ev         )                          => (ehObj(ev) && ehObj(ev.dados) ? ev.dados : {});
const tipoDe = (ev         )                => (ehObj(ev) && typeof ev.tipo === 'string' ? ev.tipo : null);
const msDe = (ev         )         => (ehObj(ev) && typeof ev.ts === 'string' ? Date.parse(ev.ts) : Number.NaN);
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const EM_VOO                        = ['implementando', 'em_revisao', 'corrigindo'];
const PAPEL_DO_ESTADO                                     = { implementando: 'implementador', corrigindo: 'correcao', em_revisao: 'revisor' };
const SEGUNDA_RODADA                        = ['reprovada', 'corrigindo', 'concluida', 'em_revisao'];
const TIPOS_TASK                      = new Set(TIPOS_DE_TASK);
/** Fim do Parar vigente: o progresso do loop e o início de uma entrega (sombra-p1a.md, "Parar vigente"). `jaParou` não serve: `sessao.inicio` o apaga. */
const LIMPA_PARAR                      = new Set([...TIPOS_DE_PROGRESSO.filter((t) => t !== 'aprendizado' && t !== 'aprendizado.nada'), 'entrega.inicio']);
const SINAIS_NEUTROS         = { slots: 0, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false };

const taskDe = (ev         )                => {
  const t = dadosDe(ev).task;
  return typeof t === 'string' ? t : null;
};

/** Quantil por interpolação linear, tipo 7 (`pos = (n − 1)·q`). `xs` ordenado e não vazio. */
function quantil(xs          , q        )         {
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, xs.length - 1);
  return xs[lo] + (pos - lo) * (xs[hi] - xs[lo]);
}

/**
 * `p`: o maior nº de tasks simultaneamente em `EM_TRABALHO` (inclui `concluida`, o mesmo conjunto do cronômetro) ao varrer os eventos de task
 * por `(ts, sessao, seq)`; o estado de cada task só sai de `estadoDe`. Task cuja sequência `estadoDe` recusa não conta. Mínimo 1.
 */
function paralelismo(eventos          )         {
  const alvo = eventos.filter((ev) => ehObj(ev) && TIPOS_TASK.has(String(ev.tipo)) && taskDe(ev) !== null && Number.isFinite(msDe(ev)));
  alvo.sort((a, b) => msDe(a) - msDe(b) || cmp(String(a.sessao), String(b.sessao)) || Number(a.seq) - Number(b.seq));
  const filas = new Map                  ();
  const trabalhando = new Set        ();
  let pico = 1;
  for (const ev of alvo) {
    const id = taskDe(ev)          ;
    const fila = filas.get(id) ?? [];
    fila.push(ev);
    filas.set(id, fila);
    const r = estadoDe(fila);
    if (!('invalido' in r) && EM_TRABALHO.has(r.estado)) trabalhando.add(id);
    else trabalhando.delete(id);
    pico = Math.max(pico, trabalhando.size);
  }
  return pico;
}

/**
 * Ocupação (GM-15 T30, D-G2): da 1ª task iniciada até `agoraMs`, a fração do relógio com ao menos uma task em `EM_TRABALHO`. O tempo parado (noite,
 * `loop.parar`, espera do dono) é o que faz a previsão pelo tempo de trabalho errar para menos; o restante é dividido por esta fração (piso 0,1).
 * `null` sem o que medir (menos de 1 min de relógio ou diário sem task).
 */
export function ocupacaoDe(eventos          , agoraMs        )                {
  const alvo = eventos.filter((ev) => ehObj(ev) && TIPOS_TASK.has(String(ev.tipo)) && taskDe(ev) !== null && Number.isFinite(msDe(ev)) && msDe(ev) <= agoraMs);
  alvo.sort((a, b) => msDe(a) - msDe(b) || cmp(String(a.sessao), String(b.sessao)) || Number(a.seq) - Number(b.seq));
  if (alvo.length === 0) return null;
  const filas = new Map                  ();
  const trabalhando = new Set        ();
  let ativo = 0;
  let desde                = null;
  const inicio = msDe(alvo[0]);
  for (const ev of alvo) {
    const id = taskDe(ev)          ;
    const fila = filas.get(id) ?? [];
    fila.push(ev);
    filas.set(id, fila);
    const r = estadoDe(fila);
    if (!('invalido' in r) && EM_TRABALHO.has(r.estado)) trabalhando.add(id);
    else trabalhando.delete(id);
    const t = msDe(ev);
    if (trabalhando.size > 0 && desde === null) desde = t;
    else if (trabalhando.size === 0 && desde !== null) { ativo += t - desde; desde = null; }
  }
  if (desde !== null) ativo += Math.max(0, agoraMs - desde);
  const total = agoraMs - inicio;
  if (!(total >= 60_000)) return null;
  return Math.min(1, Math.max(0.1, ativo / total));
}

/**
 * ETA (REQ-PNL-1, D5): restante = mediana × ⌈restantes ÷ p⌉; ± = (Q3 − Q1)/2 × ⌈restantes ÷ p⌉ sobre as durações (quartis tipo 7, sem desvio-padrão).
 * n < 3 ⇒ `null` (antes de `restantes = 0`). `restantes ≤ 0` ou não finito ⇒ 0 e 0. A hora nunca fica antes de `agoraMs`. O render arredonda para minutos.
 */
export function etaDe(eventos          , restantes        , agoraMs        , fuso        , integradas                      )                               {
  // GM-15 T33 (g.13): com `integradas`, a conta usa só as durações das tasks integradas (a aprovada que ainda não integrou é de quem vai integrar, não amostra); o
  // paralelismo segue medido sobre todos os eventos (o que de fato rodou junto)
  const ds = duracoes(eventos.filter(ehObj).filter((ev) => integradas === undefined || !TIPOS_TASK.has(String(ev.tipo)) || integradas.has(String(taskDe(ev)))));
  if (ds.length < 3) return null;
  const falta = Number.isFinite(restantes) && restantes > 0 ? restantes : 0;
  const ondas = Math.ceil(falta / paralelismo(eventos));
  const ordenadas = [...ds].sort((a, b) => a - b);
  const restanteS = mediana(ds) * ondas;
  const maisMenosS = ((quantil(ordenadas, 0.75) - quantil(ordenadas, 0.25)) / 2) * ondas;
  return { hora: horaLocal(agoraMs + restanteS * 1000, agoraMs, fuso), restanteS, maisMenosS, n: ds.length };
}

/**
 * Previsão exata (GM-15 T30, D-G2, REQ-HIG-1 h): caminho crítico do plano com o tempo medido de cada etapa (implementação, revisão, integração),
 * crédito do que já rodou e faixa P25-P75. Tudo sai do MESMO vetor, o das tasks integradas (g.13/g.14); o fechamento (h.1) soma depois do caminho.
 */
                                                                        
                                                                         
                                                                                                                                             
                                                                                                                                                
                                                                                    
                                     
                        
  
                                                               

/** Etapas das tasks integradas: iniciada → concluída (implementação), concluída → aprovada (revisão com correções), aprovada → integrada. Segundos. */
export function etapasDe(eventos          , integradas                     )         {
  const porTask = new Map                  ();
  for (const ev of eventos) {
    const id = taskDe(ev);
    if (id === null || !integradas.has(id) || !TIPOS_TASK.has(String(ev.tipo)) || !Number.isFinite(msDe(ev))) continue;
    const f = porTask.get(id) ?? [];
    f.push(ev);
    porTask.set(id, f);
  }
  const saida         = { impl: [], rev: [], integ: [] };
  for (const f of porTask.values()) {
    f.sort((a, b) => msDe(a) - msDe(b) || cmp(String(a.sessao), String(b.sessao)) || Number(a.seq) - Number(b.seq));
    let ini = f.map((ev) => tipoDe(ev)).lastIndexOf('task.reaberta') + 1; // a última reabertura recomeça o relógio
    const sub = f.slice(ini);
    const t0 = sub.find((ev) => tipoDe(ev) === 'task.iniciada');
    const integ = [...sub].reverse().find((ev) => tipoDe(ev) === 'task.integrada');
    if (t0 === undefined || integ === undefined) continue;
    const conc = sub.find((ev) => tipoDe(ev) === 'task.concluida' && msDe(ev) >= msDe(t0));
    const apr = [...sub].reverse().find((ev) => tipoDe(ev) === 'review.veredito' && dadosDe(ev).veredito === 'APROVADO' && msDe(ev) <= msDe(integ));
    if (conc === undefined || apr === undefined) continue;
    const a = msDe(t0), b = msDe(conc), c = msDe(apr), d = msDe(integ);
    if (!(a <= b && b <= c && c <= d)) continue;
    saida.impl.push((b - a) / 1000);
    saida.rev.push((c - b) / 1000);
    saida.integ.push((d - c) / 1000);
    ini = 0;
  }
  return saida;
}

/** Um ciclo de relógio com noite dentro: a janela do ritmo. */
const DIA_MS = 24 * 3_600_000;

/**
 * Relógio por task integrada no ÚLTIMO CICLO DE 24 h até `agoraMs` (uma noite e as esperas dentro): 24 h ÷ integradas na janela. Com menos de 24 h
 * de história, a janela começa na 1ª `task.iniciada`. Nenhuma integrada na janela ⇒ da 1ª iniciada até agora ÷ todas. `null` sem integrada.
 * Replay da GM-14 (2026-11-16): a conta da entrega inteira pesava a rajada do 1º dia e errava 29,1 % contra o término real; a do último dia, 25 %.
 */
export function ritmoDe(eventos          , integradas                     , agoraMs        )                {
  let ini = Number.NaN;
  for (const ev of eventos) if (tipoDe(ev) === 'task.iniciada' && msDe(ev) <= agoraMs && !(msDe(ev) >= ini)) ini = msDe(ev);
  if (integradas.size === 0 || !(agoraMs > ini)) return null;
  const desde = Math.max(ini, agoraMs - DIA_MS);
  const na = new Set        ();
  for (const ev of eventos) {
    const t = msDe(ev);
    const id = taskDe(ev);
    if (tipoDe(ev) === 'task.integrada' && id !== null && integradas.has(id) && t > desde && t <= agoraMs) na.add(id);
  }
  return na.size === 0 ? (agoraMs - ini) / 1000 / integradas.size : (agoraMs - desde) / 1000 / na.size;
}

/**
 * h.1: segundos da última `task.integrada` ao primeiro `entrega.encerrada` depois dela; o fim é o `mergeado_em` (o merge na main, T4) quando válido,
 * senão o `ts` do evento (o `medir` pode gravar dias depois do merge). `null` sem os dois (nunca palpite).
 */
export function fechamentoDe(eventos          )                {
  let ultima = Number.NaN;
  for (const ev of eventos) if (tipoDe(ev) === 'task.integrada' && !(msDe(ev) <= ultima)) ultima = msDe(ev);
  if (!Number.isFinite(ultima)) return null;
  const fimDe = (ev        )         => {
    const m = dadosDe(ev).mergeado_em;
    const t = typeof m === 'string' ? Date.parse(m) : Number.NaN;
    return Number.isFinite(t) ? t : msDe(ev);
  };
  const fim = eventos.filter((ev) => tipoDe(ev) === 'entrega.encerrada').map(fimDe).filter((t) => Number.isFinite(t) && t >= ultima).sort((a, b) => a - b)[0];
  return fim === undefined ? null : (fim - ultima) / 1000;
}

/** h.1, a fonte do painel: mediana de `fechamentoDe` nas OUTRAS entregas do repo (a `atual` fica fora); nenhuma medida ⇒ `null`. */
export function fechamentoDasAnteriores(diarios                                                  , atual               )                {
  const fs = diarios.filter((d) => d.id !== atual).map((d) => fechamentoDe(d.eventos)).filter((x)              => x !== null);
  return fs.length === 0 ? null : mediana(fs);
}

/**
 * Emenda 3 (fallback): as etapas das OUTRAS entregas do repo, juntas (cada uma com as suas integradas); a `atual` fica fora. A previsão usa
 * quando a entrega corrente ainda não mediu 3 tasks.
 */
export function etapasDasAnteriores(diarios                                                  , atual               )         {
  const saida         = { impl: [], rev: [], integ: [] };
  for (const d of diarios) {
    if (d.id === atual || !Array.isArray(d.eventos)) continue;
    const ints = new Set        ();
    for (const ev of d.eventos) { const id = taskDe(ev); if (tipoDe(ev) === 'task.integrada' && id !== null) ints.add(id); }
    const et = etapasDe(d.eventos, ints);
    saida.impl.push(...et.impl); saida.rev.push(...et.rev); saida.integ.push(...et.integ);
  }
  return saida;
}

/**
 * Emenda 3 (fallback, r2 MAJOR 1): o ritmo (s de relógio por task integrada) das OUTRAS entregas do repo, juntas: soma, em cada uma, da 1ª
 * `task.iniciada` à última `task.integrada`, ÷ o total de tasks integradas. A `atual` fica fora; nenhuma integrada ⇒ `null` (a previsão vira "?").
 * Replay GM-14 (2026-11-16): sem ele o ponto do fallback (caminho ÷ ocupação) errava 78,5 a 79,8 %; com ele, 2,4 a 2,8 % (anterior = a própria GM-14).
 */
export function ritmoDasAnteriores(diarios                                                  , atual               )                {
  let relogio = 0, tasks = 0;
  for (const d of diarios) {
    if (d.id === atual || !Array.isArray(d.eventos)) continue;
    let ini = Number.NaN, fim = Number.NaN;
    const ints = new Set        ();
    for (const ev of d.eventos) {
      const t = msDe(ev), id = taskDe(ev);
      if (!Number.isFinite(t)) continue;
      if (tipoDe(ev) === 'task.iniciada' && !(t >= ini)) ini = t;
      if (tipoDe(ev) === 'task.integrada' && id !== null) { ints.add(id); if (!(t <= fim)) fim = t; }
    }
    if (ints.size === 0 || !(fim > ini)) continue;
    relogio += (fim - ini) / 1000;
    tasks += ints.size;
  }
  return tasks === 0 ? null : relogio / tasks;
}

/** Tempo que falta para a task, com crédito do que já rodou na etapa atual (piso 0). `q` escolhe a medida da etapa (mediana ou quartil). */
function faltaDaTask(est                              , agoraMs        , e                                              )         {
  if (est === undefined || est.estado === 'pendente' || est.estado === 'reprovada' || est.estado === 'no_teto') return e.impl + e.rev + e.integ;
  const gasto = Math.max(0, (agoraMs - msDe(est.ultimo)) / 1000);
  switch (est.estado) {
    case 'implementando': return Math.max(0, e.impl - gasto) + e.rev + e.integ;
    case 'concluida': case 'em_revisao': case 'corrigindo': return Math.max(0, e.rev - gasto) + e.integ;
    case 'aprovada': return Math.max(0, e.integ - gasto);
    default: return 0; // integrada, adiada, cortada
  }
}

/** Escalonamento por lista, `p` vagas, a task de maior cauda primeiro (caminho crítico). Devolve o término (s) e o nº de tasks da cadeia crítica. */
function escalonar(deps                       , falta                     , p        )                                  {
  const abertas = [...falta.keys()].filter((id) => (falta.get(id)          ) > 0);
  const aberta = new Set(abertas);
  const filhos = new Map                  ();
  for (const id of abertas) for (const d of deps.get(id) ?? []) if (aberta.has(d)) filhos.set(d, [...(filhos.get(d) ?? []), id]);
  const cauda = new Map                                  ();
  const visitando = new Set        ();
  const caudaDe = (id        )                           => {
    const c = cauda.get(id);
    if (c !== undefined) return c;
    if (visitando.has(id)) return { s: 0, n: 0 }; // ciclo: não segue
    visitando.add(id);
    let melhor = { s: 0, n: 0 };
    for (const f of filhos.get(id) ?? []) { const x = caudaDe(f); if (x.s > melhor.s) melhor = x; }
    visitando.delete(id);
    const r = { s: (falta.get(id)          ) + melhor.s, n: 1 + melhor.n };
    cauda.set(id, r);
    return r;
  };
  for (const id of abertas) caudaDe(id);
  const fimDe = new Map                ();
  const vagas = new Array        (Math.max(1, p)).fill(0);
  const restantes = new Set(abertas);
  let fim = 0;
  while (restantes.size > 0) {
    const prontas = [...restantes].filter((id) => (deps.get(id) ?? []).every((d) => !aberta.has(d) || fimDe.has(d)));
    const pool = prontas.length > 0 ? prontas : [...restantes]; // ciclo no plano: segue sem travar
    pool.sort((a, b) => (cauda.get(b)                 ).s - (cauda.get(a)                 ).s || cmp(a, b));
    const id = pool[0];
    const k = vagas.indexOf(Math.min(...vagas));
    const prontoEm = Math.max(0, ...(deps.get(id) ?? []).map((d) => fimDe.get(d) ?? 0));
    const termina = Math.max(vagas[k], prontoEm) + (falta.get(id)          );
    vagas[k] = termina;
    fimDe.set(id, termina);
    restantes.delete(id);
    fim = Math.max(fim, termina);
  }
  const cadeia = abertas.length === 0 ? 0 : Math.max(...abertas.map((id) => (cauda.get(id)                 ).n));
  return { fim, cadeia };
}

/**
 * Previsão exata. `null` sem etapa medida em ≥ 3 tasks integradas. O ponto é a mediana de cada etapa; a faixa usa o quartil 1 e o 3 de cada etapa.
 * `fechamentoS` `null` ⇒ a conta fecha no caminho crítico, a faixa abre em `'?'` e o motivo diz por quê (h.1).
 */
export function previsaoExata(
  plano       , eventos          , estados                                       , integradas                     ,
  agoraMs        , fuso        , fechamentoS               , rodadas               , anteriores                = null, ritmoAnteriores                = null,
)                       {
  const daqui = etapasDe(eventos, integradas);
  // Emenda 3: menos de 3 medidas aqui ⇒ as etapas E o ritmo das entregas anteriores do repo (o ritmo desta, de 0 a 2 integradas, não sustenta conta).
  // Sem ritmo medido nas anteriores o ponto seria só caminho ÷ ocupação (erro ~79 % no replay, r2 MAJOR 1): nenhuma previsão, o painel mostra "?" (D-P13)
  const rAnt = typeof ritmoAnteriores === 'number' && Number.isFinite(ritmoAnteriores) && ritmoAnteriores > 0 ? ritmoAnteriores : null;
  const fallback = daqui.impl.length < 3 && anteriores !== null && Array.isArray(anteriores.impl) && anteriores.impl.length >= 3 && rAnt !== null;
  // as 1 ou 2 tasks já medidas aqui somam às anteriores (r2 MINOR 4), não se descartam
  const et         = fallback ? { impl: [...(anteriores          ).impl, ...daqui.impl], rev: [...(anteriores          ).rev, ...daqui.rev], integ: [...(anteriores          ).integ, ...daqui.integ] } : daqui;
  if (et.impl.length < 3) return null;
  const med = (xs          )         => mediana(xs);
  const q = (xs          , x        )         => quantil([...xs].sort((a, b) => a - b), x);
  const medidas = { impl: med(et.impl), rev: med(et.rev), integ: med(et.integ) };
  const lo = { impl: q(et.impl, 0.25), rev: q(et.rev, 0.25), integ: q(et.integ, 0.25) };
  const hi = { impl: q(et.impl, 0.75), rev: q(et.rev, 0.75), integ: q(et.integ, 0.75) };
  const deps = new Map(plano.tasks.map((t) => [t.id, [...t.deps]]));
  const fazer = (e                                              )                                  =>
    escalonar(deps, new Map(plano.tasks.map((t) => [t.id, faltaDaTask(estados.get(t.id), agoraMs, e)])), paralelismo(eventos));
  const oc = ocupacaoDe(eventos, agoraMs) ?? 1;
  const meio = fazer(medidas);
  const f = fechamentoS !== null && Number.isFinite(fechamentoS) && fechamentoS >= 0 ? fechamentoS : null;
  const soma = f ?? 0;
  // o caminho crítico é o piso; o ritmo medido (relógio por task integrada, com as paradas dentro) é o que ele não vê. O ponto é o maior dos dois.
  const abertas = plano.tasks.filter((t) => faltaDaTask(estados.get(t.id), agoraMs, medidas) > 0).length;
  const ritmo = fallback ? rAnt : ritmoDe(eventos, integradas, agoraMs);
  const piso = meio.fim / oc;
  const pontoS = Math.max(piso, ritmo === null ? 0 : ritmo * abertas);
  // a faixa é a do ponto: a razão P25 ÷ mediana e P75 ÷ mediana do caminho aplicada a ELE (ritmo ou caminho), então o ponto fica dentro dela
  // e nunca vira a ponta (r1 MINOR 6). Com o caminho no ponto, dá o mesmo que P25 ÷ ocupação e P75 ÷ ocupação.
  const razao = (x        )         => (meio.fim > 0 ? x / meio.fim : 1);
  const baixo = pontoS * Math.min(1, razao(fazer(lo).fim)) + soma;
  const alto = pontoS * Math.max(1, razao(fazer(hi).fim)) + soma;
  const restanteS = pontoS + soma;
  const hora = (s        )         => horaLocal(agoraMs + s * 1000, agoraMs, fuso);
  const porTaskS = medidas.impl + medidas.rev + medidas.integ;
  return {
    hora: hora(restanteS), restanteS, maisMenosS: (alto - baixo) / 2, n: et.impl.length,
    conta: { caminho: meio.cadeia, minPorTask: Math.round(porTaskS / 60), rodadas, fechamentoS: f, ocupacao: oc, ritmoMin: ritmo === null ? null : Math.round(ritmo / 60) },
    faixa: { de: hora(baixo), ate: f === null ? '?' : hora(alto) },
    motivo: [fallback ? `etapas das entregas anteriores: ${daqui.impl.length} de 3 integradas nesta` : null, f === null ? 'fechamento não medido: sem entrega anterior com registro' : null]
      .filter((x) => x !== null).join('; ') || null,
  };
}

/** `pronto.previsao`: a exata quando medida (hora, base, faixa e motivo da mesma conta); senão a antiga, com a base = o `n` dela. */
function previsaoDoPronto(legado              )                                                               {
  const x = PREVISAO_DO_ESTADO.get(legado) ?? null;
  const eta = legado.plano.eta                                             ;
  if (x === null) return { hora: eta.hora, base: eta.n };
  const exata = { hora: x.hora, base: x.n, faixa: x.faixa, conta: x.conta, motivo: x.motivo, restanteS: x.restanteS, maisMenosS: x.maisMenosS };
  return exata;
}

/**
 * A previsão exata de cada estado legado, ao lado do estado (sem mudar a forma de `plano.eta`, que a conta antiga D5 segue ocupando).
 * `projetarNovo` a lê para `pronto.previsao`: hora, base e faixa saem da mesma conta (g.14, h.2).
 */
const PREVISAO_DO_ESTADO = new WeakMap                              ();

function previsaoDo(plano       , ord          , c         , integradas                     , agora        , fuso        , rodadas               , entrada               )                       {
  const dado          = entrada.fechamentoS; // tipo declarado; o valor ainda pode vir de fora do contrato
  const fechamento = typeof dado === 'number' && Number.isFinite(dado) && dado >= 0 ? dado : fechamentoDe(ord);
  const ant          = entrada.etapasAnteriores;
  const ok = (xs         )                 => Array.isArray(xs) && xs.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
  const anteriores = ant !== null && typeof ant === 'object' && ok((ant          ).impl) && ok((ant          ).rev) && ok((ant          ).integ)
    && (ant          ).impl.length === (ant          ).rev.length && (ant          ).rev.length === (ant          ).integ.length ? (ant          ) : null;
  const r          = entrada.ritmoAnterioresS;
  return previsaoExata(plano, ord, c.estados, integradas, agora, fuso, fechamento, rodadas, anteriores, typeof r === 'number' ? r : null);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Projeção

                
               
                         
               
                                                                                     
                  
                                                                  
                       
                                                                                  
                  
                                                                                                
                                                   
                  
                                                 
  

function tentarOrdenar(lista          )                  {
  try {
    const o = ordenar(lista);
    return o.ok ? o.eventos : null;
  } catch {
    return null;
  }
}

/** Mesma régua do loop (cláusula (1) de `proximaAcao`, loop.ts:243): sinais neutros, a cláusula não depende deles. */
function conteudoValido(plano       , lista          )          {
  try {
    const a = proximaAcao(plano, lista, SINAIS_NEUTROS);
    return !(a.tipo === 'parar' && a.motivo === 'diario_invalido');
  } catch {
    return false;
  }
}

function maiorTs(lista          )                {
  let m                = null;
  for (const ev of lista) {
    const t = msDe(ev);
    if (Number.isFinite(t) && (m === null || t > m)) m = t;
  }
  return m;
}

/** Estado de cada task do plano pelo diário ordenado; a que `estadoDe` recusa fica de fora. */
function estadosDe(plano       , ord                 )                     {
  const saida                     = new Map();
  if (ord === null) return saida;
  const filas = new Map                  (plano.tasks.map((t) => [t.id, []]));
  for (const ev of ord) {
    if (!TIPOS_TASK.has(ev.tipo)) continue;
    const t = taskDe(ev);
    if (t !== null) filas.get(t)?.push(ev);
  }
  for (const [id, fila] of filas) {
    const r = estadoDe(fila);
    if ('invalido' in r) continue;
    const iniciadas = fila.filter((ev) => ev.tipo === 'task.iniciada');
    const modelo = dadosDe(iniciadas[iniciadas.length - 1]).modelo;
    saida.set(id, { estado: r.estado, rodada: r.rodada, ultimo: fila[fila.length - 1], ...(typeof modelo === 'string' && modelo !== '' ? { modelo } : {}) });
  }
  return saida;
}

/** `loop.parar` vigente: o último, sem `LIMPA_PARAR` depois dele. `chave`/`hora` vêm do 1º `loop.parar` da sequência (o mod regrava depois de cada evento). */
function pararVigente(ord          )                                              {
  let u = -1;
  for (let i = ord.length - 1; i >= 0; i--) {
    if (LIMPA_PARAR.has(ord[i].tipo)) return null;
    if (ord[i].tipo === 'loop.parar') {
      u = i;
      break;
    }
  }
  if (u < 0) return null;
  let p = u;
  for (let i = u - 1; i >= 0; i--) {
    if (LIMPA_PARAR.has(ord[i].tipo)) break;
    if (ord[i].tipo === 'loop.parar') p = i;
  }
  return { ultimo: ord[u], primeiro: ord[p] };
}

function calcularParar(c                                                                                                                                             )                   {
  const { plano, entrada, fuso, lista, ord, valido, estados } = c;
  const agora = entrada.agoraMs;
  const horaDe = (ms               )         => (ms === null ? '--:--' : horaLocal(ms, agora, fuso));
  const noTeto = plano.tasks.find((t) => estados.get(t.id)?.estado === 'no_teto')?.id ?? null;
  const montar = (motivo             , chave        , hora        , taskDoDiario         ) => {
    const task = typeof taskDoDiario === 'string' && plano.tasks.some((t) => t.id === taskDoDiario) ? taskDoDiario : noTeto;
    const { texto, acoes } = linhaDaTabela(motivo, task);
    return { motivo, texto, acoes, hora, chave, emVoo: [], alteracoes: 0 };
  };
  // 1. diário não válido
  if (!valido) return montar('diario_invalido', 'computado:diario_invalido', horaDe(maiorTs(lista)), null);
  // 2. loop.parar vigente
  const v = ord === null ? null : pararVigente(ord);
  if (v !== null) {
    const dados = ehObj(v.ultimo.dados) ? v.ultimo.dados : null;
    const motivo              = dados !== null && ehMotivo(dados.motivo) ? dados.motivo : 'diario_invalido';
    return montar(motivo, `parar:${v.primeiro.sessao}:${v.primeiro.seq}`, horaDe(msDe(v.primeiro)), dados?.task);
  }
  // 3. decisão de entrega
  const d = entrada.decisaoEntrega;
  if (ehObj(d) && d.tipo === 'parar') {
    const motivo              = ehMotivo(d.motivo) ? d.motivo : 'diario_invalido';
    return montar(motivo, `computado:entrega:${String(d.motivo)}`, horaDe(maiorTs(lista)), null);
  }
  return null;
}

/** `producao.acesso`/`operacao.destrutiva`/`entrega.inicio` e o CI, varridos sem ordenar. */
function contarRodape(lista          , ord                 , agoraMs        , fuso        )                                                                                                           {
  let leituras = 0;
  let alteracoes = 0;
  for (const ev of lista) {
    const tipo = tipoDe(ev);
    const d = dadosDe(ev);
    if (tipo === 'producao.acesso' && d.ambiente === 'prod') {
      if (d.acao === 'leitura') leituras += 1;
      else if (d.acao === 'escrita' || d.acao === 'execucao') alteracoes += 1;
    } else if (tipo === 'operacao.destrutiva' && d.ambiente === 'prod') alteracoes += 1;
    else if (tipo === 'entrega.inicio') alteracoes += 1;
  }
  const hoje = dataCivil(agoraMs, fuso);
  let execucoesHoje = 0;
  let verde                 = null;
  for (const ev of ord ?? lista) {
    if (tipoDe(ev) !== 'ci.resultado' || typeof dadosDe(ev).verde !== 'boolean') continue;
    verde = dadosDe(ev).verde           ;
    const dia = dataCivil(msDe(ev), fuso);
    if (hoje !== '' && dia === hoje) execucoesHoje += 1;
  }
  return { prod: { leituras, alteracoes }, ci: { verde, execucoesHoje } };
}

/** Vermelhos consecutivos do loop (loop.ts:162-167): `homolog` exato fica de fora; `verde` não booleano não conta. */
function ciVermelhos(ord          )         {
  let n = 0;
  for (const ev of ord) {
    if (ev.tipo !== 'ci.resultado') continue;
    const d = dadosDe(ev);
    if (typeof d.verde !== 'boolean' || d.alvo === 'homolog') continue;
    n = d.verde ? 0 : n + 1;
  }
  return n;
}

/**
 * Glifo da task. O "vivo" e o casamento são os de `painel-equipe` (`resolverAtivos`), os mesmos do AGORA e do ATENÇÃO (FIEL-3 a): `●` só com ativo
 * casado no papel do estado; task `pendente` com ativo casado (qualquer papel) aparece em curso (`●`), nunca fila.
 */
function glifoDe(t                                    , quem                       )            {
  switch (t.estado) {
    case 'integrada': return '✓';
    case 'pendente': return quem?.ativos?.some((x) => x.casamento.task === t.id) === true ? '●' : '○';
    case 'no_teto': return '✗';
    case 'concluida': case 'reprovada': case 'aprovada': return '◐'; // esperam outro papel por definição
    default: {
      if (quem === null || quem.ativos === null) return '●'; // sem mod não há como saber: nunca finge ausência
      const papel = PAPEL_DO_ESTADO[t.estado];
      return papel !== undefined && quem.cobertos.has(`${t.id}:${papel}`) ? '●' : '◐';
    }
  }
}

/** Motivo da devolução cortado para o topo: controle vira espaço (como o diário), no máximo 60 caracteres e `…`. */
function cortarMotivo(m        )         {
  // eslint-disable-next-line no-control-regex
  const limpo = m.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
  const cps = [...limpo];
  return cps.length <= 60 ? limpo : `${cps.slice(0, 59).join('')}…`;
}

function calcular(plano       , eventos                 , entrada               )          {
  const fuso = fusoValido(entrada.fuso);
  const lista           = Array.isArray(eventos) ? eventos : [];
  const ord = Array.isArray(eventos) ? tentarOrdenar(lista) : null;
  // GM-15 T9 (REQ-ENT-2): sem plano legível não há tabela de tasks contra a qual julgar o diário; vale a ordem (o PAROU do diário é do diário, não do plano)
  const valido = ord !== null && (planoInvalidoDe(entrada) !== null || conteudoValido(plano, lista));
  const estados = estadosDe(plano, ord);
  const base = { plano, entrada, fuso, lista, ord, valido, estados };
  const parar = calcularParar(base);
  const emVoo = plano.tasks.filter((t) => EM_VOO.includes(estados.get(t.id)?.estado              )).map((t) => t.id);
  const { prod } = contarRodape(lista, ord, entrada.agoraMs, fuso);
  if (parar !== null) {
    parar.emVoo = emVoo;
    parar.alteracoes = prod.alteracoes;
  }
  return { ...base, parar, emVoo, prod };
}

/** REQ-ENT-2: `adiada`/`cortada` são terminais fora do alvo (o mesmo `FORA` do núcleo, loop.ts). */
const FORA_DO_ALVO                        = ['adiada', 'cortada'];
const foraDoAlvo = (r                                    )          => r !== undefined && FORA_DO_ALVO.includes(r.estado);
/** As tasks do alvo: as do plano que não estão fora (o denominador do PRONTO, do % e da ETA). */
const alvoDe = (plano       , estados                    )                 => plano.tasks.filter((t) => !foraDoAlvo(estados.get(t.id)));

/** GM-15 T9: o motivo do `plano.json` inválido, 1 linha sem controle, no máximo 120 caracteres; ausente ou vazio ⇒ `null`. */
function planoInvalidoDe(entrada               )                {
  const m = (entrada                               )?.planoInvalido;
  if (typeof m !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpo = m.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (limpo === '') return null;
  const cps = [...limpo];
  return cps.length <= 120 ? limpo : `${cps.slice(0, 119).join('')}…`;
}

function montarDepende(c         )                {
  const { entrada, lista, ord, parar } = c;
  const itens                = [];
  if (parar !== null) itens.push({ nivel: 'parar', motivo: parar.texto, acoes: parar.acoes });
  // spec aguardando: o sha atual não é o último aceito (regra única `shaAceito`: última aprovação ou fim da cadeia de emendas aplicadas)
  if (entrada.specSha !== null && entrada.specSha !== undefined) {
    const aprovada = shaAceito(lista, entrada.specSha);
    if (!aprovada) itens.push({ nivel: 'dono', motivo: 'spec aguardando aprovação', acoes: [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }] });
  }
  // `projetarEmendas` ordena por conta própria e, com o diário fora de ordem, não devolve nenhuma aberta (falha fechada: o PAROU cobre).
  const abertas = projetarEmendas(lista).abertas;
  for (const p of abertas.slice(0, 3)) {
    itens.push({
      nivel: 'dono', motivo: `emenda #${p.seq} em ${p.req}`,
      acoes: [{ rotulo: 'aprovar', comando: `/gabarito-mestre:emenda aprovar ${p.seq}` }, { rotulo: 'rejeitar', comando: `/gabarito-mestre:emenda rejeitar ${p.seq}` }],
    });
  }
  if (abertas.length > 3) itens.push({ nivel: 'dono', motivo: `e mais ${abertas.length - 3} emenda(s) aberta(s)`, acoes: [] });
  if (entrada.pausado) itens.push({ nivel: 'dono', motivo: 'loop pausado', acoes: [{ rotulo: 'retomar', comando: '/gabarito retomar' }] });
  if (ord !== null) {
    let devolvida = -1;
    let inicio = -1;
    ord.forEach((ev, i) => {
      if (ev.tipo === 'entrega.devolvida' && formaInvalida('entrega.devolvida', ev.dados) === null) devolvida = i;
      else if (ev.tipo === 'entrega.inicio') inicio = i;
    });
    if (devolvida > inicio) {
      itens.push({
        nivel: 'dono', motivo: `deploy devolvido ao dono: ${cortarMotivo(String(dadosDe(ord[devolvida]).motivo))}`,
        acoes: [{ rotulo: 'executar', comando: `node <plugin>/gates/scripts/entrega.mjs executar --entrega ${entrada.entregaId}` }],
      });
    }
  }
  const d = entrada.decisaoEntrega;
  if (ehObj(d) && d.tipo === 'release_pr') itens.push({ nivel: 'dono', motivo: `merge da release para ${d.base}`, acoes: [{ rotulo: 'faça o merge da release', comando: null }] });
  return itens;
}

/**
 * Itens de "depende de você" na ordem fixa: Parar, spec, emendas, pausa, devolvida, release. `subir`, `agendar`, `esperar` e `entregue` nunca acendem.
 * GM-14 T17: com `fatos`, é o `depende` do estado novo, que passa por `dependeDe` (REQ-DEP-1) com estes itens como base.
 */
export function dependeDeVoce(plano       , eventos                 , entrada             )                {
  if (ehObj(entrada?.fatos)) return projetarPainel(plano, eventos, entrada).depende;
  return montarDepende(calcular(plano, eventos, entrada));
}

function montarAtencao(c         )           {
  const { plano, entrada, ord, lista, estados, emVoo } = c;
  const atencao           = [];
  const citadas = new Set        ();
  if (ord !== null) {
    for (const t of plano.tasks) {
      const r = estados.get(t.id);
      if (r !== undefined && r.rodada === 1 && SEGUNDA_RODADA.includes(r.estado)) {
        atencao.push(`${t.id} na 2ª rodada de review`);
        citadas.add(t.id);
      }
    }
    if (ciVermelhos(ord) === 1) atencao.push('CI vermelho 1× depois do último verde');
  }
  const consultas = contarConsultas(lista);
  if (consultas > entrada.tetoSombra) atencao.push(`Sombra: ${consultas} consultas, acima do teto de ${entrada.tetoSombra}`);
  const soltas = emVoo.filter((id) => !citadas.has(id));
  if (atencao.length > 0 && soltas.length > 0) atencao.push(`loop segue em ${soltas.join(' ')}`);
  return atencao;
}

/** `A`, `A e B`, `A, B e C`. */
function listaE(xs          )         {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

/**
 * Narrativa do líder (tabela N, 1ª linha que casar): Parar ▸ pausa ▸ tasks em voo (na ordem do último `task.iniciada` de cada uma, mais as que aguardam
 * revisão) ▸ todas integradas ▸ aguarda o próximo despacho. Texto fixo, só com ids do plano.
 */
function narrativaDo(c         , feitas        )         {
  const { plano, entrada, ord, estados, emVoo, parar } = c;
  if (parar !== null) {
    const v = parar.emVoo;
    return `parado · ${v.length === 0 ? 'nada continua' : v.length === 1 ? `${v[0]} continua` : `${v.join(' ')} continuam`}`;
  }
  if (entrada.pausado === true) return 'pausado, nada novo é despachado';
  // GM-15 T33 (g.15): a narração cita só os despachos da ÚLTIMA janela (o mesmo minuto do despacho mais recente) e o shell de fundo que integra ("integrando T16")
  const integrando = integrandoDe((entrada                                              ).segundoPlano);
  const sufixoInt = integrando.length > 0 ? ` · integrando ${listaE(integrando)}` : '';
  if (emVoo.length > 0) {
    const ultimo = new Map                ();
    const quando = new Map                ();
    (ord ?? []).forEach((ev, i) => {
      if (ev.tipo === 'task.iniciada') {
        const t = taskDe(ev);
        if (t !== null) { ultimo.set(t, i); quando.set(t, msDe(ev)); }
      }
    });
    const minuto = (id        )         => Math.floor((quando.get(id) ?? Number.NaN) / 60_000);
    const todos = [...emVoo].sort((a, b) => (ultimo.get(a) ?? 0) - (ultimo.get(b) ?? 0));
    const fim = minuto(todos[todos.length - 1]);
    const janela = todos.filter((id) => !Number.isFinite(fim) || minuto(id) === fim);
    const ids = janela.length > 0 ? janela : todos;
    const quem = ids.length === 1 ? ids[0] : ids.length === 2 ? `${ids[0]} e ${ids[1]} em paralelo` : `${ids[0]}, ${ids[1]} e mais ${ids.length - 2} em paralelo`;
    const aguardam = plano.tasks.filter((t) => estados.get(t.id)?.estado === 'concluida').map((t) => t.id);
    return `despachou ${quem}${sufixoInt}${aguardam.length > 0 ? ` · aguarda revisão de ${listaE(aguardam)}` : ''}`;
  }
  if (integrando.length > 0) return `integrando ${listaE(integrando)}`;
  const alvo = alvoDe(plano, estados).length;
  if (alvo > 0 && feitas === alvo) return 'todas as tasks integradas';
  return 'aguarda o próximo despacho';
}

/**
 * Projeta o estado do painel. `eventos === null`: diário ilegível ou cadeia quebrada (PAROU `diario_invalido`); `[]`: pasta ausente (estado vazio).
 * Determinística: a ordem de chegada entre sessões não muda nada; o painel não reordena `seq` dentro da sessão (como o loop).
 * T2b (fiação): `TaskPainel.nome`/`papel` por `nomesPorPapel` (T3), `historico`/`ocultos` por `historicoDe` (T4, com o texto real de `TABELA_PARAR`) e
 * `equipe.lider.narrativa` pela tabela N (sombra-p1a.md, "Tabela N").
 */
export function projetarPainel(planoOuNulo              , eventos                 , entrada             )               {
  const plano        = planoOuNulo !== null && typeof planoOuNulo === 'object' ? planoOuNulo : { entrega: '', tasks: [] };
  const legado = projetarLegado(plano, eventos, entrada);
  if (!ehObj(entrada?.fatos)) return legado;
  return projetarNovo(planoOuNulo !== null && typeof planoOuNulo === 'object' ? plano : null, eventos, entrada                                        , legado);
}

function projetarLegado(plano       , eventos                 , entrada               )               {
  const c = calcular(plano, eventos, entrada);
  const { fuso, estados, ord, lista, valido } = c;
  const quem = resolverAtivos(plano, lista, entrada);
  const agora = entrada.agoraMs;
  const nomes = nomesPorPapel(lista, entrada.pacote);

  const tasks               = [];
  for (const t of plano.tasks) {
    const r = estados.get(t.id);
    if (r === undefined || foraDoAlvo(r)) continue; // REQ-ENT-2: a task fora não é item do alvo (nem fila, nem em voo)
    const ms = msDe(r.ultimo);
    const desdeS = Number.isFinite(agora) && Number.isFinite(ms) ? Math.max(0, Math.floor((agora - ms) / 1000)) : undefined;
    const papel = PAPEL_DO_ESTADO[r.estado];
    const nome = papel === undefined ? undefined : nomes.get(chaveDoPar(t.id, papel));
    tasks.push({
      id: t.id,
      ...(typeof t.titulo === 'string' ? { titulo: t.titulo } : {}),
      estado: r.estado,
      glifo: glifoDe({ id: t.id, estado: r.estado }, quem),
      ...(papel !== undefined ? { papel } : {}),
      ...(nome !== undefined ? { nome } : {}),
      ...(r.modelo !== undefined ? { modelo: r.modelo } : {}),
      ...(desdeS !== undefined && r.estado !== 'pendente' && r.estado !== 'integrada' ? { desdeS } : {}),
      deps: [...t.deps],
    });
  }
  const feitas = tasks.filter((t) => t.estado === 'integrada').length;
  const total = alvoDe(plano, estados).length; // REQ-ENT-2: adiada e cortada saem do denominador
  const integradas = [...estados.values()].filter((r) => r.estado === 'integrada');
  const rodadaMedia = integradas.length === 0 ? null : Math.round((integradas.reduce((s, r) => s + r.rodada, 0) / integradas.length) * 10) / 10;
  // g.13: a mediana e a ETA saem do MESMO vetor, o das integradas
  const idsIntegradas = new Set([...estados].filter(([, r]) => r.estado === 'integrada').map(([id]) => id));
  const medidas = ord === null ? [] : duracoes(ord.filter((ev) => !TIPOS_TASK.has(String(ev.tipo)) || idsIntegradas.has(String(taskDe(ev)))));
  let mortas                = null;
  for (const ev of lista) {
    if (tipoDe(ev) !== 'task.integrada') continue;
    const m = dadosDe(ev).mutacoes;
    // `total: 0` = o gate não mediu mutação nenhuma (loop.mjs grava `{total: 0, mortas: 0}` sem `mutacoes`): ausente, nunca "0 mortas"
    if (ehObj(m) && formaInvalida('task.integrada', ev.dados) === null && (m.total          ) > 0) mortas = (mortas ?? 0) + (m.mortas          );
  }
  const rod = contarRodape(lista, ord, agora, fuso);
  const dias = entrada.politica?.dias;
  const politica = `${entrada.politica?.politica}${Array.isArray(dias) ? ` [${dias.map((d) => DIAS[d] ?? String(d)).join(' ')}]` : ''}`;
  const notif = entrada.notificacao;
  // a notificação é o resultado da transição para o Parar (REQ-PNL-12): `ts` anterior ao PAROU vigente é de um Parar antigo e não aparece sob o atual
  const vigente = ord === null ? null : pararVigente(ord);
  const inicioParar = vigente === null ? Number.NaN : msDe(vigente.primeiro);
  const notifTs = ehObj(notif) && typeof notif.ts === 'string' ? Date.parse(notif.ts) : Number.NaN;
  const notificacao                              =
    ehObj(notif) && 'ts' in notif
      ? Number.isFinite(inicioParar) && Number.isFinite(notifTs) && notifTs < inicioParar ? null : { hora: horaLocal(notifTs, agora, fuso) }
      : ehObj(notif) && typeof notif.motivo === 'string' ? { motivo: notif.motivo } : null;
  const titulo = typeof entrada.titulo === 'string' && entrada.titulo.trim() !== '' ? entrada.titulo : null;
  // histórico: agente vivo casado ⇒ nome do par (`subagent:<id>` é o `agente` que a guarda grava); o texto do PAROU é o da TABELA_PARAR, com a task só se for do plano
  const porAgente = new Map                ();
  for (const x of quem.ativos ?? []) if (x.id !== '') porAgente.set(`subagent:${x.id}`, x.nome); // o mesmo nome que a equipe mostra (FIEL-3 d)
  const textoParar = (motivo        , task               )                =>
    ehMotivo(motivo) ? linhaDaTabela(motivo, task !== null && plano.tasks.some((t) => t.id === task) ? task : null).texto : null;
  const hist = ord === null
    ? { itens: [], ocultos: 0 }
    : historicoDe(lista, { nomes, lider: entrada.pacote.lider, sabio: entrada.pacote.sabio, porAgente, fuso, agoraMs: agora, textoParar });
  const equipe = projetarEquipe(plano, lista, entrada);
  equipe.lider.narrativa = narrativaDo(c, feitas);

  const estado               = {
    id: plano.entrega,
    titulo,
    pacote: entrada.pacote.nome,
    plano: {
      tasks, feitas, total, pct: total === 0 ? 0 : Math.round((feitas / total) * 100),
      eta: valido ? etaDe(ord            , total - feitas, agora, fuso, idsIntegradas) : null,
      rodadaMedia,
      medianaS: medidas.length >= 3 ? mediana(medidas) : null,
    },
    equipe,
    parado: c.parar !== null || entrada.pausado === true,
    parar: c.parar,
    depende: montarDepende(c),
    atencao: montarAtencao(c),
    historico: hist.itens,
    ocultos: hist.ocultos,
    rodape: { ci: rod.ci, prod: rod.prod, politica },
    notificacao,
    qualidade: { rodadaMedia, mortas },
  };
  PREVISAO_DO_ESTADO.set(estado, valido ? previsaoDo(plano, ord            , c, idsIntegradas, agora, fuso, rodadaMedia, entrada) : null);
  return estado;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GM-14 T17: estado dos 5 blocos (REQ-GLB-1, REQ-DEP-1, REQ-LNG-1; FIEL-3 b, FIEL-4, FIEL-6 b, FIEL-7, FIEL-10..13, N17 b).

/**
 * O que o CLI (T18) e o mod (T20) passam além da E4. Tudo opcional: ausente = não medido, nunca "ok".
 * `fontesFalhas`: nomes naturais das fontes que não leram ("o GitHub"); `desatualizadoS`: segundos desde a última leitura do diário pelo mod;
 * `ultima`: a última entrega e o estado em palavras (o núcleo não lê pastas); `fora`: fora de um repositório git.
 */
                                           
                                                                                                                                              
                                                        
                                                                                                                                                                                         
                         
                                                                                                                                                
                             
                           
                                                                                                                                                                 
                             
  

/** FIEL-13 b: limite de "desatualizado" (180 s provisório = 3 × o relógio do mod, até o valor do S15). */
export const LIMITE_DESATUALIZADO_S = 180;
const NADA = 'nada depende de você'; // D-G12 (r.13): o mesmo texto de `dependeDe`
const DESATUALIZADO = 'depende de você: ? (o painel está sem ler o diário)';
const ACAO_DO_PAPEL                        = { implementador: 'implementando', revisor: 'revisando', correcao: 'corrigindo' };
const finitoNaoNeg = (v         )                => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** RECENTE (FIEL-10 d, D-P9): só resultados. `quem` antes do texto (o executivo troca por papel); origem da tabela de `origemDe`. */
function recenteDe(ord                 , plano       , entrada               , nomes                     , comNomes         , fuso        ,
  textoParar                                                        )                                                        {
  if (ord === null) return { itens: [], decisao: null };
  const itens                = [];
  let ultimaDecisao                     = null; // a decisão da Sombra mais recente, mesmo fora dos 5 do RECENTE (reserva do T42, emenda 32)
  const hora = (ev        )         => horaLocal(Date.parse(ev.ts), entrada.agoraMs, fuso);
  const nome = (n                           )                => (comNomes && typeof n === 'string' && n !== '' ? n : null);
  // Emenda 4 (REQ-LNG-1): `loop.pausa` é gravado pelo comando do dono (pausar ou retomar) ⇒ `(você)`; `loop.parar` é do loop ⇒ `(automático)`
  const AUTO = '(automático)';
  const VOCE = '(você)';
  for (const ev of ord) {
    const d = dadosDe(ev);
    const task = taskDe(ev);
    const origem = origemDe(ev);
    let item                                              = null;
    if (ev.tipo === 'review.veredito' && formaInvalida(ev.tipo, ev.dados) === null && task !== null) {
      const quem             = { nome: nome(nomes.get(chaveDoPar(task, 'revisor'))), papel: 'revisor' };
      if (d.veredito === 'APROVADO') item = { glifo: '✓', cor: 'success', quem, texto: `aprovou ${task}` };
      else if (d.veredito === 'REPROVADO') {
        const n = (Number(d.major) || 0) + (Number(d.blocker) || 0);
        item = { glifo: '✗', cor: 'warning', quem, texto: `reprovou ${task} · ${n} ${n === 1 ? 'achado' : 'achados'}` };
      }
    } else if (ev.tipo === 'task.integrada' && task !== null) {
      item = { glifo: '✓', cor: 'success', quem: null, texto: `integrou ${task}${d.ja_na_base === true ? ' (já estava na base)' : ''}` };
    } else if (ev.tipo === 'loop.parar') {
      const t = typeof d.motivo === 'string' ? textoParar(d.motivo, task) : null;
      item = { glifo: '✗', cor: 'error', quem: null, texto: t === null ? 'o loop travou' : `travou: ${t}` };
    } else if (ev.tipo === 'decisao.sombra' && formaInvalida(ev.tipo, ev.dados) === null) {
      item = { glifo: '●', cor: 'planMode', quem: { nome: nome(entrada.pacote?.sabio), papel: 'sombra' }, texto: `decidiu: ${String(d.resposta).trim()}` };
    } else if (ev.tipo === 'spec.aprovada' && formaInvalida(ev.tipo, ev.dados) === null) {
      item = { glifo: '✓', cor: 'success', quem: null, texto: 'spec aprovada' };
    } else if (ev.tipo === 'task.reaberta' && d.origem === 'dono' && task !== null) {
      item = { glifo: '●', cor: 'success', quem: null, texto: `${task} liberada para mais uma rodada` };
    } else if (ev.tipo === 'task.reaberta' && d.origem === 'sombra' && task !== null) {
      // GM-14 T36 (FIEL-15 c): origem `(Sombra)` vem de `origemDe`
      item = { glifo: '●', cor: 'success', quem: null, texto: `a Sombra liberou a ${task}` };
    } else if (ev.tipo === 'dono.resposta' && origem !== null) {
      item = { glifo: '●', cor: 'success', quem: null, texto: 'pergunta respondida' };
    } else if (ev.tipo === 'loop.pausa' && (d.estado === 'pausado' || d.estado === 'retomado')) {
      item = { glifo: '○', cor: 'inactive', quem: null, texto: 'pausa' };
    }
    if (item === null) continue;
    const o = origem ?? (ev.tipo === 'loop.parar' ? AUTO : ev.tipo === 'loop.pausa' ? VOCE : null);
    if (o === null) continue;
    const feito = { ...item, hora: hora(ev), origem: o };
    if (ev.tipo === 'decisao.sombra') ultimaDecisao = feito;
    itens.push(feito);
  }
  void plano;
  return { itens: itens.reverse().slice(0, 5), decisao: ultimaDecisao };
}

/**
 * "Uma linha" do modo projeto (FIEL-10 e): a ÚNICA regra. Só no modo `projeto` e sem nada pedindo o dono (PAROU, pergunta, "depende de você" que não
 * seja "nada") nem trabalhando (agente vivo); `ultima` = a da entrada (id e estado) ou, sem ela, a conhecida da trilha (estado `null`).
 * `projetarNovo` a chama com os campos que acabou de calcular; `painel.mjs` (entrega publicada, plano só fora da apresentação) a chama com o estado projetado
 * do cálculo com o plano e o `modo` da apresentação: os campos são os mesmos (`estado.parar` é `c.parar`; `agora.agentes` é `agentes`).
 */
export function umaLinhaDe(
  e                                                                                                                                                                                                             ,
  ultimaDaEntrada         ,
)                                                                  {
  const pendente = e.parar !== null || e.pergunta !== null || (e.agora.agentes?.length ?? 0) > 0 || e.depende.some((i) => i.motivo !== NADA);
  if (e.modo !== 'projeto' || pendente || ehObj(e.entregue)) return null; // GM-15 T8: com a entrega encerrada a linha é a de entregue
  const u = ehObj(ultimaDaEntrada) ? ultimaDaEntrada : null;
  const ultima = u !== null && typeof u.id === 'string' ? { id: u.id, estado: typeof u.estado === 'string' ? u.estado : null }
    : typeof e.trilha.ultimaConhecida === 'string' ? { id: e.trilha.ultimaConhecida, estado: null } : null;
  return { ultima };
}

function projetarNovo(plano              , eventos                 , entrada                                      , legado              )               {
  const p        = plano ?? { entrega: '', tasks: [] };
  const c = calcular(p, eventos, entrada);
  const { lista, ord, estados, fuso } = c;
  const fatos = entrada.fatos;
  const comNomes = entrada.agentes !== null; // FIEL-4: sem dados da sessão, nenhum nome sorteado
  const nomes = nomesPorPapel(lista, entrada.pacote);

  // fontes e diário
  const fontes           = (Array.isArray(entrada.fontesFalhas) ? entrada.fontesFalhas : []).filter((f)              => typeof f === 'string');
  if (eventos === null && !fontes.includes('o diário')) fontes.push('o diário');
  const desat = finitoNaoNeg(entrada.desatualizadoS);
  const velho = desat !== null && desat > LIMITE_DESATUALIZADO_S;

  // GM-15 T8 (REQ-ENT-1 d ii): com a entrega encerrada, os itens dela saem do topo (PAROU, pergunta, DEPENDE), do ATENÇÃO e do PRONTO
  const entregue                  = ehObj(entrada.entregue) && typeof entrada.entregue.id === 'string' ? { id: entrada.entregue.id, versao: typeof entrada.entregue.versao === 'string' ? entrada.entregue.versao : null } : null;
  const proxima                 = entregue !== null && ehObj(entrada.proxima) ? entrada.proxima : null;
  // (d)(ii) tira só os itens DA entrega: só some o que é do diário projetado quando ele é o da entregue (r1 MAJOR-2); a última conhecida não zera o `_sem-id`
  const zera = entregue !== null && entrada.entregueDoDiario !== false;

  // trilha, perguntas e "depende de você" pelas funções únicas (T3, T12, T13)
  const trilha = trilhaDe(fatos, lista);
  const abertas = zera ? [] : perguntasAbertas(lista, trilha, { sessao: typeof fatos.sessao === 'string' ? fatos.sessao : null, ...(Array.isArray(fatos.ultimas) ? { ultimas: fatos.ultimas } : {}) })
    .filter((q) => q.gatilho !== 'pendencia' && q.gatilho !== 'ideia'); // pendência (3) e ideia (4) são itens de `dependeDe`, com o botão "feito"/"visto"
  const pergunta = abertas[0] ?? null;
  // GM-15 T35 (r.12, r.9): o pedido de /clear da regra única `pedidoDeClear`: sem medição não há pedido; adiado ("agora não") some do painel até +10 p.p.
  const clear = pedidoDeClear(eventos, entrada.onboarding === true, entrada.medicaoPouso);
  const [sessaoPouso, seqPouso] = clear.id === null ? [null, null] : [clear.id.slice(0, clear.id.lastIndexOf(':')), Number(clear.id.slice(clear.id.lastIndexOf(':') + 1))];
  const pousoDe                                   = clear.pendente && !clear.adiado ? { pendente: true, sessao: sessaoPouso, seq: seqPouso } : { pendente: false, sessao: null, seq: null };
  // o pedido de /clear é da sessão, não da entrega: entra nos dois ramos (r1 MAJOR-2)
  const pedidoClear = entrada.pousoPendente === true ? true : { pendente: pousoDe.pendente, id: clear.id };
  let depende = zera ? dependeDe(null                            , [], [], { falhou: fontes }, pedidoClear, { branch: null, idPadrao: fatos.idPadrao }) : dependeDe(trilha, lista, legado.depende, { falhou: fontes }, pedidoClear,
    { branch: typeof fatos.branch === 'string' ? fatos.branch : null, idPadrao: fatos.idPadrao });
  // GM-15 T8 (review r1 MAJOR-1): a próxima com botão vira item do DEPENDE (o mod já desenha os botões dos itens); nunca é item da encerrada
  if (entregue !== null && proxima !== null && Array.isArray(proxima.acoes) && proxima.acoes.length > 0) {
    depende = [...depende.filter((i) => i.motivo !== NADA), { nivel: 'dono', motivo: motivoDaProxima(proxima.texto), acoes: proxima.acoes.map((a) => ({ ...a })) }];
  }
  if (pergunta !== null) depende = depende.filter((i) => i.motivo !== NADA);
  if (velho) depende = depende.map((i) => (i.motivo === NADA ? { ...i, motivo: DESATUALIZADO } : i));

  // AGORA: só ativos, pelo casamento e pelo "ativo" de `painel-equipe` (FIEL-3 a, FIEL-6): as mesmas linhas da equipe, do glifo e do ATENÇÃO
  const equipeAtiva = resolverAtivos(p, lista, entrada);
  const ativos = equipeAtiva.ativos;
  const desdeIni = (task        , papel       )                => {
    let ms = Number.NaN;
    for (const ev of ord ?? []) if (ev.tipo === 'task.iniciada' && taskDe(ev) === task && chaveDoPar(task, String(dadosDe(ev).papel)) === chaveDoPar(task, papel)) ms = msDe(ev);
    return Number.isFinite(ms) ? Math.max(0, Math.floor((entrada.agoraMs - ms) / 1000)) : null;
  };
  const agentes                       = ativos === null ? null : ativos.map((x) => {
    const a = x.agente;
    const c = x.casamento;
    const nome = comNomes ? x.nome : null;
    const util = higienizarDescricao(a.description);
    // FIEL-11 b: 1) o que o mod viu agora (`acoes`); 2) plano B, o que está registrado, marcado "(registrado)"; sem fonte ⇒ `null` ("?")
    const aoVivo = ehObj(entrada.acoes) && ehObj(entrada.acoes[x.id]) && typeof entrada.acoes[x.id].texto === 'string' ? higienizarDescricao(entrada.acoes[x.id].texto) : null;
    if (c.task === null || c.papel === null) {
      const visto = finitoNaoNeg(a.vistoEm);
      return { quem: { nome, papel: c.papelExibido ?? 'implementador' }, task: null, acao: aoVivo ?? (util === null ? null : `${util} (registrado)`),
        desdeS: visto === null ? null : Math.max(0, Math.floor((entrada.agoraMs - visto) / 1000)) };
    }
    // a `description` casada que é só "<task> <papel>" não diz o que faz: o papel em palavras (último fato registrado)
    const soPapel = util !== null && /^\S+ (implementador|revisor|correcao)$/.test(util);
    const registrado = util === null || soPapel ? `${ACAO_DO_PAPEL[c.papel]} (registrado)` : `${util} (registrado)`;
    return { quem: { nome, papel: c.papelExibido ?? c.papel }, task: c.task, acao: aoVivo ?? registrado, desdeS: desdeIni(c.task, c.papel) };
  });
  // segundo plano (FIEL-11 c, GM-15 T33 g.11/D-G8): seção própria, 1 linha por shell: `acao` = tipo (rotuloDoShell: Integrando/Teste/Aguardando/Comando), `task` = a que o
  // comando ou a descrição provam (senão a do agente dono), `quem` = quem disparou (a sessão principal ou o agente); sem prova de task ⇒ `null` (nunca palpite)
  const donoDe = new Map((ativos ?? []).map((x) => [x.id, x]));
  const segundoPlano                = ativos === null || !Array.isArray(entrada.segundoPlano) ? [] : entrada.segundoPlano.filter((b) => ehObj(b) && typeof b.id === 'string').map((b) => {
    const r = rotuloDoShell(b);
    const d = b.dono === 'orquestrador' ? undefined : donoDe.get(b.dono);
    const quem             = b.dono === 'orquestrador' ? { nome: null, papel: 'orquestrador' }
      : d === undefined ? { nome: null, papel: 'implementador' } : { nome: comNomes ? d.nome : null, papel: d.casamento.papelExibido ?? d.casamento.papel ?? 'implementador' };
    return { quem, task: r.task ?? d?.casamento.task ?? null, acao: r.tipo, desdeS: Number.isFinite(b.desde) ? Math.max(0, Math.floor((entrada.agoraMs - b.desde) / 1000)) : null };
  });

  // ATENÇÃO (FIEL-10 c): só travado ou com problema
  const atencao           = [];
  if (ativos !== null) {
    for (const t of equipeAtiva.esperando) atencao.push(`${t} sem agente trabalhando`);
    const d = equipeAtiva.desconhecidos;
    if (d > 0) atencao.push(`${d} ${d === 1 ? 'agente' : 'agentes'} com estado desconhecido`);
  }
  if (legado.rodape.ci.verde === false) atencao.push('CI vermelho na última execução');
  const alt = c.prod.alteracoes;
  if (alt > 0) atencao.push(`produção alterada ${alt} ${alt === 1 ? 'vez' : 'vezes'} nesta entrega`);
  const semRegistro = contarConsultas(lista) - projetarDecisoes(lista).size;
  const sombraAtiva = (ativos ?? []).some((x) => x.casamento.papelExibido === 'sombra');
  if (semRegistro > 0 && !sombraAtiva) atencao.push(`${semRegistro} ${semRegistro === 1 ? 'consulta' : 'consultas'} à Sombra sem decisão registrada`);
  if (zera) atencao.length = 0; // M8a: nada da entrega encerrada (consultas à Sombra, CI, produção, task sem agente) fica no ATENÇÃO
  if (velho) atencao.push(`painel sem ler o diário há ${Math.floor((desat          ) / 60)} min`);

  // PRONTO (com plano) ou FASE (sem plano)
  const feitas = legado.plano.feitas;
  const total = legado.plano.total; // REQ-ENT-2: o alvo (sem as tasks fora), o mesmo do legado
  const invalido = planoInvalidoDe(entrada);
  const pronto = !zera && plano !== null && invalido === null && total > 0
    ? { integradas: feitas, total, previsao: feitas < total && (PREVISAO_DO_ESTADO.get(legado) ?? null) !== null ? previsaoDoPronto(legado)
      : feitas >= 3 && feitas < total && legado.plano.eta !== null ? previsaoDoPronto(legado) : null }
    : null;
  const nAtivos = agentes?.length ?? 0;
  const sufixo           = [];
  if (trilha.fase !== 5) {
    if (nAtivos > 0) sufixo.push(`${nAtivos} ${nAtivos === 1 ? 'agente trabalhando' : 'agentes trabalhando'}: ${(agentes?.[0]?.acao ?? '?').replace(/ \(registrado\)$/, '')}`);
    if (projetarEmendas(lista).abertas.length > 0) sufixo.push('emenda aguardando você');
  }
  // GM-15 T9 (REQ-ENT-2): plano.json inválido ⇒ "?" com o motivo, nunca o plano velho nem uma fase que finja saber
  const fase = pronto !== null ? null : invalido !== null ? {
    numero: null, marcas: [...trilha.marcas], motivo: `plano inválido: ${invalido}`, progresso: trilha.progresso, sufixo,
  } : {
    numero: trilha.fase, marcas: [...trilha.marcas], motivo: trilha.motivos.find((m) => typeof m === 'string') ?? null, progresso: trilha.progresso, sufixo,
  };

  // modo e "uma linha" (FIEL-10 e)
  const modo                       = entrada.fora === true ? 'fora' : plano !== null || trilha.identificada ? 'entrega' : 'projeto';
  const umaLinha = umaLinhaDe({ modo, parar: c.parar, pergunta, depende, agora: { agentes }, trilha, entregue }, entrada.ultima);

  const pct = finitoNaoNeg(entrada.contexto?.percent);
  const textoParar = (motivo        , task               )                =>
    ehMotivo(motivo) ? linhaDaTabela(motivo, task !== null && p.tasks.some((t) => t.id === task) ? task : null).texto : null;

  // `pousoPendente {pendente, sessao, seq}` no estado (FIEL-14 d): a `chavePouso` do mod lê o `seq` do último `sessao.pouso` (pouso novo ⇒ chave nova ⇒ push novo).
  const rec = recenteDe(ord, p, entrada, nomes, comNomes, fuso, textoParar);
  const estado                                                                                                                              = {
    ...legado,
    pousoPendente: pousoDe,
    recomendadas: loteRecomendadas(abertas).length, // GM-15 T35 (r.16): o botão "aprovar recomendadas (N)" do mod
    id: plano !== null ? p.entrega : (trilha.entrega ?? ''),
    modo, trilha, pergunta, perguntasMais: Math.max(0, abertas.length - 1), umaLinha, pronto, fase,
    depende, atencao, entregue, proxima,
    ...(zera ? { parar: null, parado: false } : {}),
    agora: {
      orquestrador: { nome: comNomes ? entrada.pacote?.lider ?? null : null, contexto: pct, estimado: false, pousar: pct !== null && pct >= entrada.x },
      agentes, segundoPlano,
    },
    recente: rec.itens,
    decisaoSombra: rec.decisao, // T42: o render reserva 1 linha dela quando o corte tiraria o RECENTE inteiro
    desatualizadoS: desat,
    fontesFalhas: fontes,
  };
  return estado;
}

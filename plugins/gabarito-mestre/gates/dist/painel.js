/**
 * Painel (E4, GM-12): núcleo puro. `projetarPainel(plano, eventos, entrada)` ⇒ `EstadoPainel` (T2) e o despacho do render por preset (T1).
 * Puro: relógio só por `entrada.agoraMs`, fuso só por `entrada.fuso` (via `painel-hora`); sem `fs`, `process` nem `Date.now()`.
 * O fecho de imports não tem `node:*` (o mod carrega o `dist/`): o cronômetro das durações e a contagem de consultas da Sombra vêm de
 * `diario-puro.ts`, a MESMA implementação que `diario.ts` e `sombra.ts` reexportam (sem cópia); o teste `duracoes-igual-ao-diario` prova a fiação.
 * Decisões: `.superpowers/sdd/2026-11-09-e4-painel/sombra-p1a.md` §0 (D-A a D-C) e "Task 2".
 */

import { projetarEmendas } from './emenda.js';
import { cmp, contarConsultas, duracoes, EM_TRABALHO, mediana, projetarDecisoes } from './diario-puro.js';
import { dependeDe } from './depende.js';
import { origemDe } from './origem.js';
import { perguntasAbertas } from './perguntas.js';
import { trilhaDe } from './trilha.js';
                                               
import { estadoDe, ordenar, proximaAcao, TIPOS_DE_PROGRESSO, TIPOS_DE_TASK } from './loop.js';
                                            
import { formaInvalida } from './formas.js';
import { renderBlocos, renderEsquadrao } from './painel-esquadrao.js';
import { historicoDe } from './painel-texto.js';
import { renderExecutivo } from './painel-executivo.js';
import { casarAgente, chaveDoPar, nomesPorPapel, projetarEquipe } from './painel-equipe.js';
import { dataCivil, fusoValido, horaLocal } from './painel-hora.js';
                                                                                                                                                                                                                                       

/** Despacha para o render do preset. Preset desconhecido não vira sucesso: lança (quem chama é o CLI, que já validou a flag). */
export function renderPainel(e              , o              )          {
  // GM-14 T17: estado novo (projetado com `fatos`) ⇒ um renderizador só, os 5 blocos; o executivo é o mesmo sem lúdico (FIEL-12)
  if (e !== null && typeof e === 'object' && e.modo !== undefined && (o?.preset === 'esquadrao' || o?.preset === 'executivo')) return renderBlocos(e, o);
  if (o.preset === 'esquadrao') return renderEsquadrao(e, o);
  if (o.preset === 'executivo') return renderExecutivo(e, o);
  throw new RangeError(`preset desconhecido: ${String(o.preset)} (esquadrao | executivo)`);
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
const HEX64 = /^[0-9a-f]{64}$/;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const ENCERRADO                       = new Set(['idle', 'completed', 'failed', 'killed']);
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
 * ETA (REQ-PNL-1, D5): restante = mediana × ⌈restantes ÷ p⌉; ± = (Q3 − Q1)/2 × ⌈restantes ÷ p⌉ sobre as durações (quartis tipo 7, sem desvio-padrão).
 * n < 3 ⇒ `null` (antes de `restantes = 0`). `restantes ≤ 0` ou não finito ⇒ 0 e 0. A hora nunca fica antes de `agoraMs`. O render arredonda para minutos.
 */
export function etaDe(eventos          , restantes        , agoraMs        , fuso        )                               {
  const ds = duracoes(eventos.filter(ehObj));
  if (ds.length < 3) return null;
  const falta = Number.isFinite(restantes) && restantes > 0 ? restantes : 0;
  const ondas = Math.ceil(falta / paralelismo(eventos));
  const ordenadas = [...ds].sort((a, b) => a - b);
  const restanteS = mediana(ds) * ondas;
  const maisMenosS = ((quantil(ordenadas, 0.75) - quantil(ordenadas, 0.25)) / 2) * ondas;
  return { hora: horaLocal(agoraMs + restanteS * 1000, agoraMs, fuso), restanteS, maisMenosS, n: ds.length };
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

const vivoDe = (a         )                  => ehObj(a) && !ENCERRADO.has(a.status);

function glifoDe(t                                    , plano       , agentes                     )            {
  switch (t.estado) {
    case 'integrada': return '✓';
    case 'pendente': return '○';
    case 'no_teto': return '✗';
    case 'concluida': case 'reprovada': case 'aprovada': return '◐'; // esperam outro papel por definição
    default: {
      if (agentes === null) return '●'; // sem mod não há como saber: nunca finge ausência
      const papel = PAPEL_DO_ESTADO[t.estado];
      return agentes.some((a) => {
        const c = casarAgente(a.description, plano);
        return c !== null && c.task === t.id && c.papel === papel;
      }) ? '●' : '◐';
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
  const valido = ord !== null && conteudoValido(plano, lista);
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

function montarDepende(c         )                {
  const { entrada, lista, ord, parar } = c;
  const itens                = [];
  if (parar !== null) itens.push({ nivel: 'parar', motivo: parar.texto, acoes: parar.acoes });
  // spec aguardando: nenhum `spec.aprovada` com o sha atual (só sha de 64 hex minúsculos; varredura sem ordem)
  if (entrada.specSha !== null && entrada.specSha !== undefined) {
    const aprovada = lista.some((ev) => tipoDe(ev) === 'spec.aprovada' && typeof dadosDe(ev).sha256 === 'string' && HEX64.test(dadosDe(ev).sha256          ) && dadosDe(ev).sha256 === entrada.specSha);
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
  if (emVoo.length > 0) {
    const ultimo = new Map                ();
    (ord ?? []).forEach((ev, i) => {
      if (ev.tipo === 'task.iniciada') {
        const t = taskDe(ev);
        if (t !== null) ultimo.set(t, i);
      }
    });
    const ids = [...emVoo].sort((a, b) => (ultimo.get(a) ?? 0) - (ultimo.get(b) ?? 0));
    const quem = ids.length === 1 ? ids[0] : ids.length === 2 ? `${ids[0]} e ${ids[1]} em paralelo` : `${ids[0]}, ${ids[1]} e mais ${ids.length - 2} em paralelo`;
    const aguardam = plano.tasks.filter((t) => estados.get(t.id)?.estado === 'concluida').map((t) => t.id);
    return `despachou ${quem}${aguardam.length > 0 ? ` · aguarda revisão de ${listaE(aguardam)}` : ''}`;
  }
  if (plano.tasks.length > 0 && feitas === plano.tasks.length) return 'todas as tasks integradas';
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
  const agentes = Array.isArray(entrada.agentes) ? entrada.agentes.filter(vivoDe) : null;
  const agora = entrada.agoraMs;
  const nomes = nomesPorPapel(lista, entrada.pacote);

  const tasks               = [];
  for (const t of plano.tasks) {
    const r = estados.get(t.id);
    if (r === undefined) continue;
    const ms = msDe(r.ultimo);
    const desdeS = Number.isFinite(agora) && Number.isFinite(ms) ? Math.max(0, Math.floor((agora - ms) / 1000)) : undefined;
    const papel = PAPEL_DO_ESTADO[r.estado];
    const nome = papel === undefined ? undefined : nomes.get(chaveDoPar(t.id, papel));
    tasks.push({
      id: t.id,
      ...(typeof t.titulo === 'string' ? { titulo: t.titulo } : {}),
      estado: r.estado,
      glifo: glifoDe({ id: t.id, estado: r.estado }, plano, agentes),
      ...(papel !== undefined ? { papel } : {}),
      ...(nome !== undefined ? { nome } : {}),
      ...(r.modelo !== undefined ? { modelo: r.modelo } : {}),
      ...(desdeS !== undefined && r.estado !== 'pendente' && r.estado !== 'integrada' ? { desdeS } : {}),
      deps: [...t.deps],
    });
  }
  const feitas = tasks.filter((t) => t.estado === 'integrada').length;
  const total = plano.tasks.length;
  const integradas = [...estados.values()].filter((r) => r.estado === 'integrada');
  const rodadaMedia = integradas.length === 0 ? null : Math.round((integradas.reduce((s, r) => s + r.rodada, 0) / integradas.length) * 10) / 10;
  const medidas = ord === null ? [] : duracoes(ord);
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
  for (const a of agentes ?? []) {
    const casado = ehObj(a) && typeof a.id === 'string' ? casarAgente(a.description, plano) : null;
    const nome = casado === null ? undefined : nomes.get(chaveDoPar(casado.task, casado.papel));
    if (nome !== undefined) porAgente.set(`subagent:${a.id}`, nome);
  }
  const textoParar = (motivo        , task               )                =>
    ehMotivo(motivo) ? linhaDaTabela(motivo, task !== null && plano.tasks.some((t) => t.id === task) ? task : null).texto : null;
  const hist = ord === null
    ? { itens: [], ocultos: 0 }
    : historicoDe(lista, { nomes, lider: entrada.pacote.lider, sabio: entrada.pacote.sabio, porAgente, fuso, agoraMs: agora, textoParar });
  const equipe = projetarEquipe(plano, lista, entrada);
  equipe.lider.narrativa = narrativaDo(c, feitas);

  return {
    id: plano.entrega,
    titulo,
    pacote: entrada.pacote.nome,
    plano: {
      tasks, feitas, total, pct: total === 0 ? 0 : Math.round((feitas / total) * 100),
      eta: valido ? etaDe(ord            , total - feitas, agora, fuso) : null,
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
const NADA = 'depende de você: nada';
const DESATUALIZADO = 'depende de você: ? (o painel está sem ler o diário)';
const ATIVO_FIM                       = ENCERRADO;
const PAPEL_DO_TIPO                          = [[/revisor/i, 'revisor'], [/sombra/i, 'sombra'], [/spike/i, 'spike']];
const ACAO_DO_PAPEL                        = { implementador: 'implementando', revisor: 'revisando', correcao: 'corrigindo' };
const finitoNaoNeg = (v         )                => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Papel de um vivo sem task casada: pelo `type` do despacho; sem pista, implementador (FIEL-3 a fica com a T29). */
function papelDoTipo(tipo         )              {
  const t = typeof tipo === 'string' ? tipo : '';
  for (const [re, p] of PAPEL_DO_TIPO) if (re.test(t)) return p;
  return 'implementador';
}

/** RECENTE (FIEL-10 d, D-P9): só resultados. `quem` antes do texto (o executivo troca por papel); origem da tabela de `origemDe`. */
function recenteDe(ord                 , plano       , entrada               , nomes                     , comNomes         , fuso        ,
  textoParar                                                        )                {
  if (ord === null) return [];
  const itens                = [];
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
    } else if (ev.tipo === 'dono.resposta' && origem !== null) {
      item = { glifo: '●', cor: 'success', quem: null, texto: 'pergunta respondida' };
    } else if (ev.tipo === 'loop.pausa' && (d.estado === 'pausado' || d.estado === 'retomado')) {
      item = { glifo: '○', cor: 'inactive', quem: null, texto: 'pausa' };
    }
    if (item === null) continue;
    const o = origem ?? (ev.tipo === 'loop.parar' ? AUTO : ev.tipo === 'loop.pausa' ? VOCE : null);
    if (o === null) continue;
    itens.push({ ...item, hora: hora(ev), origem: o });
  }
  void plano;
  return itens.reverse().slice(0, 5);
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

  // trilha, perguntas e "depende de você" pelas funções únicas (T3, T12, T13)
  const trilha = trilhaDe(fatos, lista);
  const abertas = perguntasAbertas(lista, trilha, { sessao: typeof fatos.sessao === 'string' ? fatos.sessao : null, ...(Array.isArray(fatos.ultimas) ? { ultimas: fatos.ultimas } : {}) })
    .filter((q) => q.gatilho !== 'pendencia'); // pendência é item (3) de `dependeDe`, com o botão "feito"
  const pergunta = abertas[0] ?? null;
  let depende = dependeDe(trilha, lista, legado.depende, { falhou: fontes }, entrada.pousoPendente === true,
    { branch: typeof fatos.branch === 'string' ? fatos.branch : null, idPadrao: fatos.idPadrao });
  if (pergunta !== null) depende = depende.filter((i) => i.motivo !== NADA);
  if (velho) depende = depende.map((i) => (i.motivo === NADA ? { ...i, motivo: DESATUALIZADO } : i));

  // AGORA: só ativos; casados ao plano pelo `casarAgente` da E4 (o casamento novo é da T29)
  const ativos = entrada.agentes === null ? null : (Array.isArray(entrada.agentes) ? entrada.agentes : []).filter((a)                  => ehObj(a) && !ATIVO_FIM.has(a.status));
  const desdeIni = (task        , papel       )                => {
    let ms = Number.NaN;
    for (const ev of ord ?? []) if (ev.tipo === 'task.iniciada' && taskDe(ev) === task && chaveDoPar(task, String(dadosDe(ev).papel)) === chaveDoPar(task, papel)) ms = msDe(ev);
    return Number.isFinite(ms) ? Math.max(0, Math.floor((entrada.agoraMs - ms) / 1000)) : null;
  };
  const cobertos = new Set        ();
  const agentes                       = ativos === null ? null : ativos.map((a) => {
    const casado = casarAgente(a.description, p);
    const descricao = typeof a.description === 'string' && a.description.trim() !== '' ? a.description : null;
    if (casado === null) {
      const visto = finitoNaoNeg(a.vistoEm);
      return { quem: { nome: comNomes && typeof a.nome === 'string' && a.nome !== '' ? a.nome : null, papel: papelDoTipo(a.type) }, task: null, acao: descricao,
        desdeS: visto === null ? null : Math.max(0, Math.floor((entrada.agoraMs - visto) / 1000)) };
    }
    cobertos.add(`${casado.task}:${casado.papel}`);
    // a `description` casada é só "<task> <papel>": o que está fazendo vem do último fato registrado, o papel em palavras (FIEL-11 b, plano B)
    return { quem: { nome: nomes.get(chaveDoPar(casado.task, casado.papel)) ?? null, papel: casado.papel }, task: casado.task,
      acao: `${ACAO_DO_PAPEL[casado.papel]} (registrado)`, desdeS: desdeIni(casado.task, casado.papel) };
  });

  // ATENÇÃO (FIEL-10 c): só travado ou com problema
  const atencao           = [];
  if (ativos !== null) {
    for (const t of p.tasks) {
      const estado = estados.get(t.id)?.estado;
      const papel = estado === undefined ? undefined : PAPEL_DO_ESTADO[estado];
      if (papel !== undefined && !cobertos.has(`${t.id}:${papel}`)) atencao.push(`${t.id} sem agente trabalhando`);
    }
  }
  if (legado.rodape.ci.verde === false) atencao.push('CI vermelho na última execução');
  const alt = c.prod.alteracoes;
  if (alt > 0) atencao.push(`produção alterada ${alt} ${alt === 1 ? 'vez' : 'vezes'} nesta entrega`);
  const semRegistro = contarConsultas(lista) - projetarDecisoes(lista).size;
  if (semRegistro > 0) atencao.push(`${semRegistro} ${semRegistro === 1 ? 'consulta' : 'consultas'} à Sombra sem decisão registrada`);
  if (velho) atencao.push(`painel sem ler o diário há ${Math.floor((desat          ) / 60)} min`);

  // PRONTO (com plano) ou FASE (sem plano)
  const feitas = legado.plano.feitas;
  const total = p.tasks.length;
  const pronto = plano !== null && total > 0
    ? { integradas: feitas, total, previsao: feitas >= 3 && feitas < total && legado.plano.eta !== null ? { hora: legado.plano.eta.hora, base: feitas } : null }
    : null;
  const nAtivos = agentes?.length ?? 0;
  const sufixo           = [];
  if (trilha.fase !== 5) {
    if (nAtivos > 0) sufixo.push(`${nAtivos} ${nAtivos === 1 ? 'agente trabalhando' : 'agentes trabalhando'}: ${agentes?.[0]?.acao ?? '?'}`);
    if (projetarEmendas(lista).abertas.length > 0) sufixo.push('emenda aguardando você');
  }
  const fase = pronto !== null ? null : {
    numero: trilha.fase, marcas: [...trilha.marcas], motivo: trilha.motivos.find((m) => typeof m === 'string') ?? null, progresso: trilha.progresso, sufixo,
  };

  // modo e "uma linha" (FIEL-10 e)
  const modo                       = entrada.fora === true ? 'fora' : plano !== null || trilha.identificada ? 'entrega' : 'projeto';
  const pendente = c.parar !== null || pergunta !== null || nAtivos > 0 || depende.some((i) => i.motivo !== NADA);
  const ultima = ehObj(entrada.ultima) && typeof entrada.ultima.id === 'string'
    ? { id: entrada.ultima.id, estado: typeof entrada.ultima.estado === 'string' ? entrada.ultima.estado : null }
    : typeof trilha.ultimaConhecida === 'string' ? { id: trilha.ultimaConhecida, estado: null } : null;
  const umaLinha = modo === 'projeto' && !pendente ? { ultima } : null;

  const pct = finitoNaoNeg(entrada.contexto?.percent);
  const textoParar = (motivo        , task               )                =>
    ehMotivo(motivo) ? linhaDaTabela(motivo, task !== null && p.tasks.some((t) => t.id === task) ? task : null).texto : null;

  return {
    ...legado,
    id: plano !== null ? p.entrega : (trilha.entrega ?? ''),
    modo, trilha, pergunta, perguntasMais: Math.max(0, abertas.length - 1), umaLinha, pronto, fase,
    depende, atencao,
    agora: {
      orquestrador: { nome: comNomes ? entrada.pacote?.lider ?? null : null, contexto: pct, estimado: false, pousar: pct !== null && pct >= entrada.x },
      agentes, segundoPlano: [],
    },
    recente: recenteDe(ord, p, entrada, nomes, comNomes, fuso, textoParar),
    desatualizadoS: desat,
    fontesFalhas: fontes,
  };
}

/**
 * Texto base do painel (E4, GM-12 T4): `limpar`, `colunas`, `cortar`, `barra`, `cortarLinha`, `blocoTopo`, `fraseHistorico`, `historicoDe` e `paraTexto`.
 * Núcleo puro: sem `node:*`, sem `Intl.Segmenter` (o mod carrega o `dist/`; D-B), sem relógio (hora só por `painel-hora.ts` com `agoraMs` e `fuso` recebidos).
 *
 * Contrato de falha: dado ausente, de tipo errado ou de forma inválida nunca vira texto bonito. `fraseHistorico` devolve `null`
 * (o evento some do histórico), `blocoTopo` omite a parte que não tem dado, `paraTexto` recusa tema desconhecido com `RangeError`.
 * Ponto único de limpeza: `paraTexto` aplica `limpar` a todo segmento, e `colunas` mede o texto já limpo.
 */

import { ordenar } from './loop.js';
import { horaLocal } from './painel-hora.js';
                                                                                 

// ───────────────────────────── limpeza e largura ─────────────────────────────

/** Controle C0, DEL, C1 (inclui `\x1b` e `\x9b`), separadores de linha/parágrafo e bidi: viram espaço (como `diario.ts:352-353`). */
const CONTROLE_G = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;
const CONTROLE_1 = /^[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]$/u;
const MARCA_1 = /^[\p{Mn}\p{Me}]$/u;
const PICTO_1 = /^\p{Extended_Pictographic}$/u;
const ZWJ = 0x200d;

/** Glifos do painel, todos de largura 1 (Global Constraints). `▶` é pictográfico no Unicode, mas o terminal o desenha em 1 coluna. */
export const GLIFOS                    = ['▰', '▱', '█', '░', '✓', '●', '◐', '○', '◌', '✗', '■', '◆', '▲', '▼', '▶', '─', '│', '├', '└', '·'];
const GLIFOS_LARGURA_1                      = new Set(GLIFOS.map((g) => g.codePointAt(0)          ));

/** Troca controle por espaço. Não texto vira `''`. */
export function limpar(s        )         {
  return typeof s === 'string' ? s.replace(CONTROLE_G, ' ') : '';
}

/** East Asian Wide/Fullwidth: Hangul Jamo, CJK (inclui Hiragana/Katakana), Hangul, compatibilidade, Fullwidth Forms. `…` e `·` ficam fora: 1 coluna. */
function largo(p        )          {
  return (
    (p >= 0x1100 && p <= 0x115f) || (p >= 0x2e80 && p <= 0xa4cf) || (p >= 0xac00 && p <= 0xd7a3) || (p >= 0xf900 && p <= 0xfaff) ||
    (p >= 0xfe30 && p <= 0xfe6f) || (p >= 0xff00 && p <= 0xff60) || (p >= 0xffe0 && p <= 0xffe6) || (p >= 0x20000 && p <= 0x3fffd)
  );
}

/** Colunas de um ponto de código (já sem controle). `aposZwj`: o ponto anterior foi ZWJ. */
function medida(c        , p        , aposZwj         )         {
  if (p >= 0x20 && p <= 0x7e) return 1; // caminho rápido: ASCII imprimível
  if (CONTROLE_1.test(c)) return 1; // vira espaço
  if (p === ZWJ || p === 0xfe0e || p === 0xfe0f || MARCA_1.test(c)) return 0;
  if (PICTO_1.test(c)) return aposZwj ? 0 : GLIFOS_LARGURA_1.has(p) ? 1 : 2;
  return largo(p) ? 2 : 1;
}

/** Colunas de terminal do texto já limpo. Marca, ZWJ e seletor de variação valem 0; pictográfico após ZWJ vale 0; Wide e pictográfico 2; resto 1. Linear. */
export function colunas(s        )         {
  if (typeof s !== 'string') return 0;
  let n = 0;
  let aposZwj = false;
  for (const c of s) {
    const p = c.codePointAt(0)          ;
    n += medida(c, p, aposZwj);
    aposZwj = p === ZWJ;
  }
  return n;
}

/**
 * Corta por coluna, com `…` no fim quando corta. `max` não finito ou ≤ 0 ⇒ `''`; `max` não inteiro ⇒ `floor`; cabe ⇒ `limpar(s)`; `max === 1` ⇒ `…`.
 * O prefixo tem no máximo `max − 1` colunas, nunca parte par substituto, nunca separa marca ou ZWJ da base; caractere de 2 colunas que não cabe sai inteiro.
 * Para no 1º excesso (não varre o resto de um texto enorme).
 */
export function cortar(s        , max        )         {
  if (typeof s !== 'string' || typeof max !== 'number') return '';
  const m = Math.floor(max);
  if (!Number.isFinite(m) || m <= 0) return '';
  let w = 0;
  let corte = 0;
  let idx = 0;
  let aposZwj = false;
  for (const c of s) {
    const p = c.codePointAt(0)          ;
    const mw = medida(c, p, aposZwj);
    // fronteira de grupo: só antes de um ponto que ocupa coluna e que não está colado a um ZWJ
    if (!aposZwj && mw > 0 && w <= m - 1) corte = idx;
    w += mw;
    if (w > m) return m === 1 ? '…' : `${limpar(s.slice(0, corte))}…`;
    aposZwj = p === ZWJ;
    idx += c.length;
  }
  return limpar(s);
}

/** Barra de `largura` células: `cheios = round(clamp(pct, 0, 100) / 100 × largura)`. `pct` não finito vale 0; `largura` ≤ 0 ou não finita ⇒ `''`. */
export function barra(pct        , largura        , cheio           , vazio           )         {
  if (typeof largura !== 'number' || !Number.isFinite(largura)) return '';
  const l = Math.floor(largura);
  if (l <= 0) return '';
  const p = typeof pct === 'number' && Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const cheios = Math.round((p / 100) * l);
  return cheio.repeat(cheios) + vazio.repeat(l - cheios);
}

const colunasDaLinha = (l       )         => l.reduce((n, s) => n + colunas(s.texto), 0);

/** Corta a linha em `max` colunas: o último segmento que estoura é cortado (`…`), os seguintes caem. Linha que cabe volta igual. */
export function cortarLinha(l       , max        )        {
  if (typeof max !== 'number' || !Number.isFinite(max) || Math.floor(max) <= 0) return [];
  const limite = Math.floor(max);
  const saida        = [];
  let usado = 0;
  for (const seg of l) {
    const c = colunas(seg.texto);
    if (usado + c <= limite) {
      saida.push(seg);
      usado += c;
      continue;
    }
    const resta = limite - usado;
    if (resta >= 1) {
      saida.push({ ...seg, texto: cortar(seg.texto, resta) });
    } else if (saida.length > 0) {
      // nada sobrou para o segmento que estoura: a reticência toma o lugar do fim do anterior
      const ult = saida[saida.length - 1];
      saida[saida.length - 1] = { ...ult, texto: cortar(`${ult.texto}…`, Math.max(1, colunas(ult.texto))) };
    }
    return saida;
  }
  return saida;
}

// ───────────────────────────── topo (depende de você / PAROU) ─────────────────────────────

const ehObj = (v         )                               => v !== null && typeof v === 'object' && !Array.isArray(v);
const txt = (v         )              => typeof v === 'string' && v.trim() !== '';
const seg = (texto        , cor          )           => (cor === undefined ? { texto } : { texto, cor });

const MOTIVO_MIN = 12;
const SEP_ACOES = ' · ';
const NOTIF_MOTIVO_MAX = 30;

/** `comando` sem as palavras que ele repete do 1º comando (`…:emenda aprovar 3` e `…:emenda rejeitar 3` ⇒ `rejeitar 3`). Nunca esvazia: fica ao menos a última palavra. */
function semPrefixoComum(primeiro        , comando        )         {
  const a = primeiro.split(' ');
  const b = comando.split(' ');
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  if (n >= b.length) n = b.length - 1;
  return b.slice(n).join(' ');
}

                                                           

function acoesDe(v         )             {
  if (!Array.isArray(v)) return [];
  const out             = [];
  for (const a of v) {
    if (!ehObj(a) || !txt(a.rotulo)) continue;
    out.push({ rotulo: limpar(a.rotulo), comando: txt(a.comando) ? limpar(a.comando) : null });
  }
  return out;
}

/** Ação sem comando: o rótulo com o 1º `: ` trocado por dois espaços. */
const instrucao = (rotulo        )         => rotulo.replace(': ', '  ');

/** Texto de cada ação, na ordem; a partir da 2ª o comando perde o prefixo que repete o do 1º. */
function corposDas(acoes            , comRotulo         )           {
  const primeiro = acoes[0]?.comando ?? null;
  return acoes.map((a, i) => {
    if (a.comando === null) return instrucao(a.rotulo);
    const cmd = i > 0 && primeiro !== null ? semPrefixoComum(primeiro, a.comando) : a.comando;
    return comRotulo ? `${a.rotulo}  ${cmd}` : cmd;
  });
}

/** Cada texto em linha própria, indentada em 4 (menos se só assim ele cabe); maior que a largura sozinho ⇒ cortado só no fim. */
function linhasProprias(textos          , largura        )          {
  return textos.map((t) => {
    const recuo = Math.max(0, Math.min(4, largura - colunas(t)));
    return [seg(' '.repeat(recuo) + cortar(t, largura - recuo))];
  });
}

/** Item `dono`: `  <motivo>  <ações>`; o motivo encolhe até 12 colunas, depois cada ação vai para linha própria. */
function linhasDoItem(motivo        , acoes          , largura        )          {
  if (acoes.length === 0) return [[seg(`  ${cortar(motivo, largura - 2)}`)]];
  const juntas = acoes.join(SEP_ACOES);
  const disp = largura - 4 - colunas(juntas);
  if (disp >= Math.min(MOTIVO_MIN, colunas(motivo))) return [[seg(`  ${cortar(motivo, disp)}  ${juntas}`)]];
  return [[seg(`  ${cortar(motivo, largura - 2)}`)], ...linhasProprias(acoes, largura)];
}

function notificacaoDe(n         )                {
  if (!ehObj(n)) return null;
  if (txt(n.hora)) return `notificação enviada ${limpar(n.hora)}`;
  if (txt(n.motivo)) return `não enviada: ${cortar(limpar(n.motivo), NOTIF_MOTIVO_MAX)}`;
  return null;
}

function blocoParar(p                                    , notificacao         , largura        )          {
  const cabeca = `■ PAROU ${limpar(typeof p.hora === 'string' ? p.hora : '--:--')}`;
  const texto = limpar(typeof p.texto === 'string' ? p.texto : '');
  const disp = largura - colunas(cabeca) - 2;
  const l1        = [seg(cabeca, 'error'), seg(`  ${disp >= Math.min(MOTIVO_MIN, colunas(texto)) ? cortar(texto, disp) : texto}`)];
  const linhas          = [l1];

  const acoes = corposDas(acoesDe(p.acoes), true);
  if (acoes.length > 0) {
    const juntas = acoes.join('   ');
    if (colunas(juntas) <= largura) linhas.push([seg(juntas)]);
    else linhas.push(...linhasProprias(acoes, largura));
  }

  const emVoo = Array.isArray(p.emVoo) ? p.emVoo.filter(txt).map(limpar) : [];
  const alt = typeof p.alteracoes === 'number' && Number.isFinite(p.alteracoes) ? Math.max(0, Math.floor(p.alteracoes)) : 0;
  const partes = [
    emVoo.length === 0 ? 'nada continua' : emVoo.length === 1 ? `${emVoo[0]} continua` : `${emVoo.join(' ')} continuam`,
    `produção: ${alt} ${alt === 1 ? 'alteração' : 'alterações'} nesta entrega`,
  ];
  const notif = notificacaoDe(notificacao);
  if (notif !== null) partes.push(notif);
  // as partes caem da direita para a esquerda; a 1ª, se sozinha estoura, é cortada no fim
  while (partes.length > 1 && colunas(partes.join(SEP_ACOES)) > largura) partes.pop();
  linhas.push([seg(cortar(partes.join(SEP_ACOES), largura), 'inactive')]);
  return linhas;
}

/**
 * Topo do painel, idêntico nos presets: PAROU (se houver), depois `◆ DEPENDE DE VOCÊ  N item(ns)` e os itens `dono`, ou `depende de você: nada`.
 * Itens `nivel:'parar'` não se repetem (o bloco PAROU já os mostra); sem PAROU, um item `parar` solto é mostrado como os demais (nunca some). Nenhuma linha passa de `largura`.
 */
export function blocoTopo(e              , largura        )          {
  if (typeof largura !== 'number' || !Number.isFinite(largura) || Math.floor(largura) <= 0) return [];
  const w = Math.floor(largura);
  const linhas          = [];
  const parar = ehObj(e?.parar) ? (e.parar                                      ) : null;
  if (parar !== null) linhas.push(...blocoParar(parar, e.notificacao, w));

  const itens = (Array.isArray(e?.depende) ? e.depende : []).filter((i) => ehObj(i) && (parar === null || i.nivel === 'dono'));
  if (itens.length > 0) {
    linhas.push([seg('◆ DEPENDE DE VOCÊ', 'warning'), seg(`  ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, 'warning')]);
    for (const i of itens) linhas.push(...linhasDoItem(limpar(typeof i.motivo === 'string' ? i.motivo : ''), corposDas(acoesDe(i.acoes), false), w));
  } else if (parar === null) {
    linhas.push([seg('depende de você: nada', 'inactive')]);
  }
  return linhas.map((l) => cortarLinha(l, w));
}

// ───────────────────────────── histórico ─────────────────────────────

                                                                            
                            
                                                                          
                             
                
                
                                                          
                                 
               
                  
                                                
                                                                                           
                           
  

const PAPEIS_TASK                    = ['implementador', 'revisor', 'correcao'];
const POLITICAS                    = ['continua', 'janela', 'sob_demanda'];
const inteiroNaoNeg = (v         )              => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const frase = (glifo        , cor         , texto        )                 => ({ glifo, cor, texto: limpar(texto) });

/**
 * Uma frase do histórico por evento da tabela fechada (REQ-PNL-7); qualquer outro tipo, `dados` que não é objeto ou campo com forma errada ⇒ `null`.
 * `texto` sem o glifo. `error` só no `loop.parar`.
 */
export function fraseHistorico(ev        , ctx              )                        {
  if (!ehObj(ev) || typeof ev.tipo !== 'string' || !ehObj(ev.dados)) return null;
  const dados                          = ev.dados;
  const d = (k        )          => (Object.hasOwn(dados, k) ? dados[k] : undefined);
  const nome = (task        , par                        , alternativa        )         => ctx.nomes?.get(`${task}:${par}`) ?? alternativa;
  const task = d('task');

  switch (ev.tipo) {
    case 'review.veredito': {
      const v = d('veredito');
      const major = d('major');
      const blocker = d('blocker');
      if (!txt(task) || (v !== 'APROVADO' && v !== 'REPROVADO')) return null;
      if ((major !== undefined && !inteiroNaoNeg(major)) || (blocker !== undefined && !inteiroNaoNeg(blocker))) return null;
      const quem = nome(task, 'revisor', 'revisor');
      if (v === 'APROVADO') {
        const s = ctx.revisaoS;
        const min = typeof s === 'number' && Number.isFinite(s) ? ` · ${Math.round(s / 60)} min` : ''; // negativo já virou `null` em `historicoDe`
        return frase('✓', 'success', `${quem} aprovou ${task}${min}`);
      }
      if (!inteiroNaoNeg(major) || !inteiroNaoNeg(blocker)) return null;
      const n = major + blocker;
      return frase('✗', 'warning', `${quem} reprovou ${task} · ${n} ${n === 1 ? 'achado' : 'achados'}`);
    }
    case 'task.iniciada': {
      const papel = d('papel');
      if (!txt(task) || typeof papel !== 'string' || !PAPEIS_TASK.includes(papel)) return null;
      return frase('▶', 'success', `despachou ${nome(task, papel === 'revisor' ? 'revisor' : 'trabalho', papel)} em ${task}`);
    }
    case 'task.integrada': {
      if (!txt(task)) return null;
      const m = d('mutacoes');
      let sufixo = '';
      if (ehObj(m) && inteiroNaoNeg(m.total) && inteiroNaoNeg(m.mortas) && m.mortas <= m.total) {
        sufixo = ` · ${m.mortas} ${m.mortas === 1 ? 'mutação morta' : 'mutações mortas'}`;
      }
      return frase('✓', 'success', `${task} integrada${sufixo}`);
    }
    case 'decisao.sombra': {
      const resposta = d('resposta');
      if (typeof resposta !== 'string' || resposta.trim() === '' || !Number.isInteger(ev.seq)) return null;
      return frase('◆', 'planMode', `${ctx.sabio} decidiu #${ev.seq} · ${resposta.trim()}`);
    }
    case 'producao.acesso':
    case 'operacao.destrutiva': {
      const acao = d('acao');
      const alvo = d('alvo');
      const verbo = acao === 'leitura' ? 'leu' : acao === 'escrita' ? 'alterou' : acao === 'execucao' ? 'executou em' : null;
      if (verbo === null || typeof alvo !== 'string') return null;
      const amb = d('ambiente');
      const ambiente = amb === 'prod' ? 'PRODUÇÃO' : amb === 'homolog' ? 'HOMOLOG' : 'ambiente desconhecido';
      const quem = ev.agente === 'orquestrador' ? ctx.lider : typeof ev.agente === 'string' ? (ctx.porAgente?.get(ev.agente) ?? 'agente') : 'agente';
      const sufixo = ev.tipo === 'producao.acesso' ? 'permitido' : 'destrutiva';
      return frase('▲', 'warning', `${quem} ${verbo} ${ambiente} · ${alvo.trim() === '' ? '—' : alvo} · ${sufixo}`);
    }
    case 'ci.resultado': {
      const verde = d('verde');
      if (typeof verde !== 'boolean') return null;
      return frase(verde ? '●' : '✗', verde ? 'success' : 'warning', `${verde ? 'CI verde' : 'CI vermelho'}${d('alvo') === 'homolog' ? ' homolog' : ''}`);
    }
    case 'emenda.proposta': {
      const req = d('req');
      if (!txt(req) || !Number.isInteger(ev.seq)) return null;
      return frase('◆', 'warning', `emenda #${ev.seq} proposta em ${req}`);
    }
    case 'spec.emendada':
    case 'emenda.rejeitada': {
      const n = d('proposta_seq');
      const origem = d('origem');
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || (origem !== 'dono' && origem !== 'sombra')) return null;
      const aprovada = ev.tipo === 'spec.emendada';
      return frase(aprovada ? '✓' : '✗', aprovada ? 'success' : 'warning', `emenda #${n} ${aprovada ? 'aprovada' : 'rejeitada'} (${origem})`);
    }
    case 'spec.aprovada':
      return frase('✓', 'success', 'spec aprovada');
    case 'loop.parar': {
      const motivo = d('motivo');
      const t = typeof motivo === 'string' ? ctx.textoParar(motivo) : null;
      return frase('■', 'error', t === null || t === undefined ? 'PAROU' : `PAROU · ${t}`);
    }
    case 'loop.pausa': {
      const estado = d('estado');
      if (estado === 'pausado') return frase('■', 'inactive', 'pausado');
      if (estado === 'retomado') return frase('▶', 'success', 'retomado');
      return null; // `{negado}` e qualquer outra forma
    }
    case 'task.reaberta':
      return txt(task) && d('origem') === 'dono' ? frase('▶', 'success', `dono liberou ${task}`) : null;
    case 'sessao.pouso': {
      const pct = d('percent');
      return typeof pct === 'number' && Number.isFinite(pct) ? frase('▼', 'inactive', `pouso da sessão em ${Math.round(pct)}%`) : null;
    }
    case 'sessao.retomada':
      return frase('▶', 'inactive', 'sessão retomada');
    case 'entrega.inicio': {
      const politica = d('politica');
      return typeof politica === 'string' && POLITICAS.includes(politica) ? frase('▲', 'warning', `entrega iniciada · ${politica}`) : null;
    }
    case 'entrega.smoke': {
      const ok = d('ok');
      return typeof ok === 'boolean' ? frase(ok ? '✓' : '✗', ok ? 'success' : 'warning', ok ? 'smoke ok' : 'smoke falhou') : null;
    }
    case 'entrega.rollback': {
      const ok = d('ok');
      return typeof ok === 'boolean' ? frase('▲', 'warning', ok ? 'rollback ok' : 'rollback falhou') : null;
    }
    case 'entrega.fim': {
      const ok = d('ok');
      if (typeof ok !== 'boolean') return null;
      const motivo = d('motivo');
      return ok ? frase('✓', 'success', 'entregue') : frase('✗', 'warning', `entrega falhou${txt(motivo) ? ` · ${motivo}` : ''}`);
    }
    case 'entrega.agendada': {
      const quando = d('quando');
      const ms = typeof quando === 'string' ? Date.parse(quando) : NaN;
      if (!Number.isFinite(ms)) return null;
      return frase('◆', 'warning', `entrega agendada ${horaLocal(ms, ctx.agoraMs, ctx.fuso)}`);
    }
    case 'entrega.devolvida': {
      const motivo = d('motivo');
      return txt(motivo) ? frase('◆', 'warning', `deploy devolvido ao dono · ${motivo}`) : null;
    }
    default:
      return null;
  }
}

/** Itens do histórico mostrados antes de "e mais N" (spec REQ-PNL-7). */
export const HIST_MAX = 20;
                                                              

/**
 * Histórico do estado: frases não nulas do diário ordenado, mais recente primeiro, até `HIST_MAX`; `ocultos` = as que sobram.
 * Diário que `ordenar` recusa (ou que não é lista) ⇒ vazio: o painel não inventa histórico de diário inválido (o PAROU `diario_invalido` já avisa).
 * `revisaoS` de um veredito = `ts` dele − `ts` do último `task.iniciada {papel:'revisor'}` da mesma task antes dele; ausente ou negativo ⇒ sem duração.
 */
export function historicoDe(eventos          , ctx                                )                                              {
  const vazio = { itens: [], ocultos: 0 };
  if (!Array.isArray(eventos)) return vazio;
  const ord = ordenar(eventos);
  if (!ord.ok) return vazio;
  const inicioRevisao = new Map                ();
  const todos                  = [];
  for (const ev of ord.eventos) {
    const dados = ehObj(ev.dados) ? ev.dados : null;
    const task = dados !== null && Object.hasOwn(dados, 'task') ? dados.task : undefined;
    const ms = Date.parse(ev.ts);
    let revisaoS                = null;
    if (txt(task)) {
      if (ev.tipo === 'task.iniciada' && dados?.papel === 'revisor') inicioRevisao.set(task, ms);
      if (ev.tipo === 'review.veredito') {
        const ini = inicioRevisao.get(task);
        if (ini !== undefined && ms - ini >= 0) revisaoS = (ms - ini) / 1000;
      }
    }
    const f = fraseHistorico(ev, { ...ctx, revisaoS });
    if (f !== null) todos.push({ glifo: f.glifo, texto: f.texto, hora: horaLocal(ms, ctx.agoraMs, ctx.fuso), cor: f.cor });
  }
  todos.reverse();
  return { itens: todos.slice(0, HIST_MAX), ocultos: Math.max(0, todos.length - HIST_MAX) };
}

// ───────────────────────────── saída em texto ─────────────────────────────

/** SGR de 16 cores por chave de tema. A CLI não conhece o RGB do tema; o 24 bits é do mod. */
export const SGR                                    = {
  success: 32, warning: 33, error: 31, inactive: 90, planMode: 36, claude: 91, suggestion: 94, autoAccept: 95, ide: 34, remember: 96,
};

/**
 * Linhas ⇒ texto. `mono`: segmentos limpos e concatenados, espaço à direita removido, `\n` entre linhas. `color`: o mesmo, cada segmento com cor entre SGR e `\x1b[0m`
 * (a cor nunca vaza para a linha seguinte). Invariante: `color` sem os SGR === `mono`. Tema desconhecido lança (não escolhe um por conta própria).
 */
export function paraTexto(linhas         , tema                  )         {
  if (tema !== 'color' && tema !== 'mono') throw new RangeError(`tema desconhecido: ${String(tema)} (color | mono)`);
  return linhas
    .map((l) => {
      const segs = l.map((s) => ({ texto: limpar(s.texto), cor: s.cor }));
      // espaço à direita sai da linha toda, atravessando segmentos
      while (segs.length > 0) {
        const ult = segs[segs.length - 1];
        ult.texto = ult.texto.replace(/ +$/, '');
        if (ult.texto !== '') break;
        segs.pop();
      }
      return segs
        .map((s) => (tema === 'color' && s.cor !== undefined && Object.hasOwn(SGR, s.cor) && s.texto !== '' ? `\x1b[${SGR[s.cor]}m${s.texto}\x1b[0m` : s.texto))
        .join('');
    })
    .join('\n');
}

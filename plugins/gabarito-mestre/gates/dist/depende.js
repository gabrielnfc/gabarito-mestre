/**
 * "Depende de você" fora do loop (GM-14, REQ-DEP-1 e Emenda 2 consolidada). Núcleo puro: sem E/S, sem relógio, nunca lança.
 *
 * Ordem da saída: `base` (E4 REQ-PNL-2; começa pelo PAROU) ▸ (6) pouso pendente ▸ (5) task no limite de revisões ▸ (1) aprovação
 * ▸ (2) pedido de revisão aberto ▸ (3) pendências abertas ▸ (4) ideias ▸ (7) emenda aberta. A pergunta aberta do painel (T12) tem
 * lugar próprio no estado e não é item daqui.
 *
 * "nada" só com todas as fontes lidas sem falha e lista vazia; fonte que falhou (nome dado pelo chamador, ou o diário que não
 * ordena) ⇒ "depende de você: ? (não consegui ler <fonte>)", nunca "nada" (D-P13 1). Os textos são linguagem natural: o comando só
 * vive em `acoes[].comando`, e só quando provado seguro (id de task em formato fechado; branch da entrega, DP-3 ajuste 3).
 */
import { projetarEmendas } from './emenda.js';
import { formaInvalida, ID_PERGUNTA_RE } from './formas.js';
import { AGORA_NAO_TETO, ehAdiamento } from './pouso.js';
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.js';
                                                            
import { idDaBranch } from './trilha.js';
                                          

const CMD_APROVAR = '/gabarito-mestre:aprovar';
/** Id de task que pode ir num comando: letra e até 15 letras, dígitos ou hífen (ex.: `T12`, `T1b`). Fora disso o item sai sem botão. */
const TASK_SEGURA = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;
const ENTREGA_SEGURA = /^[A-Za-z0-9-]{1,40}$/;
const NOME_FONTE_MAX = 60;

const obj = (v         )                          => (v !== null && typeof v === 'object' ? (v                           ) : {});
const item = (motivo        , acoes         = [])              => ({ nivel: 'dono', motivo, acoes });

/** `A`, `A e B`, `A, B e C`. */
const listaE = (xs          )         => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/** Nome de fonte vindo do chamador: sem controle, 1 linha, no máximo 60 caracteres; vazio ⇒ "uma fonte". */
function nomeDeFonte(v         )         {
  const limpo = [...(typeof v === 'string' ? v : '')].map((ch) => { const c = ch.codePointAt(0)          ; return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? ' ' : ch; }).join('');
  const t = limpo.replace(/\s+/g, ' ').trim();
  return t === '' ? 'uma fonte' : Array.from(t).slice(0, NOME_FONTE_MAX).join('');
}

const copia = (i             )              => ({ nivel: i.nivel, motivo: i.motivo, acoes: (Array.isArray(i.acoes) ? i.acoes : []).map((a) => ({ ...a })) });

/** Estado do último fato `pr` por número; devolve o maior número aberto. */
function prAberto(evs          )                {
  const por = new Map                ();
  for (const e of evs) {
    if (e.tipo !== 'fato.medido' || obj(e.dados).chave !== 'pr') continue;
    const v = obj(obj(e.dados).valor);
    // mesmo critério de prs() da trilha (trilha.ts:95): número inteiro e estado texto, sem exigir a forma exata do fato.
    if (Number.isInteger(v.numero) && typeof v.estado === 'string') por.set(v.numero          , v.estado);
  }
  let aberto                = null;
  for (const [numero, estado] of por) if (estado === 'aberto' && (aberto === null || numero > aberto)) aberto = numero;
  return aberto;
}

/** Tasks (na ordem do 1º evento no diário) cujo ciclo termina em `no_teto`. Ciclo inválido não conta (o PAROU da base cobre). */
function tasksNoTeto(evs          )           {
  const ordem           = [];
  const por = new Map                  ();
  for (const e of evs) {
    const task = obj(e.dados).task;
    if (!TIPOS_DE_TASK.includes(e.tipo) || typeof task !== 'string') continue;
    if (!por.has(task)) {
      por.set(task, []);
      ordem.push(task);
    }
    (por.get(task)            ).push(e);
  }
  return ordem.filter((id) => {
    const r = estadoDe(por.get(id)            );
    return !('invalido' in r) && r.estado === 'no_teto';
  });
}

/**
 * REGRA ÚNICA de "pendência aberta" (Sombra 4ad3f283; a T12 importa esta função). `nota` é a nota do diário `evs` (em ordem).
 * Aberta = `nota` de tipo pendência com forma válida (texto ≤ 160; nota maior nunca foi pendência) sem `dono.resposta` POSTERIOR a ela,
 * de forma válida e na forma com `rotulo` (a digitada {sha256, chars} NÃO fecha), cuja `pergunta` é o id `<sessao>:<seq>` da nota.
 * Resposta anterior à nota, de forma inválida ou de outro id não fecha. Id fora de ID_PERGUNTA_RE ⇒ não é pendência. Nunca lança.
 */
export function pendenciaAberta(evs          , nota        )                                       {
  if (!Array.isArray(evs) || obj(nota).tipo !== 'nota' || formaInvalida('nota', obj(nota).dados) !== null || obj(obj(nota).dados).tipo !== 'pendencia') return null;
  const id = `${nota.sessao}:${nota.seq}`;
  if (!ID_PERGUNTA_RE.test(id)) return null;
  const i = evs.indexOf(nota);
  if (i < 0) return null;
  // GM-15 T35 (r.14): "agora não" adia, nunca fecha
  const fechada = evs.some((r, j) => j > i && r.tipo === 'dono.resposta' && formaInvalida('dono.resposta', r.dados) === null && r.dados.pergunta === id && 'rotulo' in r.dados && !ehAdiamento(r.dados.rotulo));
  return fechada ? null : { id, texto: nota.dados.texto           };
}

/**
 * GM-15 T35 (r.14, D-G12 2): ids adiados pelo dono = a ÚLTIMA `dono.resposta` por rótulo (forma válida) ao id é "agora não…". Resposta
 * de verdade depois do adiamento o desfaz (e fecha); o gatilho que muda abre id novo (âncora nova), que não está aqui. Nunca lança.
 */
export function adiadas(evs          )              {
  const ultima = new Map                 ();
  for (const r of Array.isArray(evs) ? evs : []) {
    if (obj(r).tipo !== 'dono.resposta' || formaInvalida('dono.resposta', r.dados) !== null || !('rotulo' in r.dados)) continue;
    ultima.set(r.dados.pergunta          , ehAdiamento(r.dados.rotulo));
  }
  return new Set([...ultima].filter(([, a]) => a).map(([id]) => id));
}

/** GM-15 T35 (r.13, D-G12 1): nota de pendência/ideia escrita pelo orquestrador é lembrete dele (vai ao plano/brief), nunca item do dono. */
export const notaDoOrquestrador = (e        )          => obj(e).tipo === 'nota' && obj(e).agente === 'orquestrador'
  && (obj(obj(e).dados).tipo === 'pendencia' || obj(obj(e).dados).tipo === 'ideia');

const pendenciasAbertas = (evs          )                                  =>
  evs.flatMap((e) => { const p = pendenciaAberta(evs, e); return p === null ? [] : [p]; });

const VISTO = 'visto';
/** Texto do item (4) e da pergunta de ideias (T13b): uma frase só, para painel e hook dizerem o mesmo. */
export const textoIdeias = (n        )         => `decidir se ${n === 1 ? 'a ideia vira' : `as ${n} ideias viram`} a próxima entrega`;

/**
 * REGRA ÚNICA de "ideias abertas" (REQ-DEP-1 item 4, Emenda 5; a T12 importa esta função). `n` = as `nota ideia` válidas POSTERIORES à
 * última `dono.resposta` de rótulo "visto" (sem caixa, sem espaço nas pontas, como a repetição de opção da T1; forma com `rotulo`, a digitada
 * não vale) cuja `pergunta` é o id de uma ideia anterior a ela; `id` = `<sessao>:<seq>` da última dessas ideias. `nota ideia` tem pergunta
 * própria: a âncora de (b) a pula (`trilha.ts`), então o id nunca é o de (b). Falha fechada: a última ideia nova com id fora de
 * ID_PERGUNTA_RE (sessão com `.` ou `_`) é irrespondível ⇒ `null` inteiro (nada de botão que o hook recusa; a T12 também não a abre).
 * Nota do modelo, resposta de outro rótulo e resposta a outro id não fecham. Sem ideia nova ⇒ `null`. Nunca lança.
 */
export function ideiasAbertas(evs          )                                   {
  if (!Array.isArray(evs)) return null;
  const ideias                              = [];
  const posDoId = new Map                ();
  evs.forEach((e, i) => {
    if (obj(e).tipo !== 'nota' || formaInvalida('nota', e.dados) !== null || e.dados.tipo !== 'ideia') return;
    const id = `${e.sessao}:${e.seq}`;
    ideias.push({ i, id });
    if (ID_PERGUNTA_RE.test(id)) posDoId.set(id, i);
  });
  let desde = -1;
  evs.forEach((r, j) => {
    if (obj(r).tipo !== 'dono.resposta' || formaInvalida('dono.resposta', r.dados) !== null || !('rotulo' in r.dados)) return;
    if (String(r.dados.rotulo).trim().toLowerCase() !== VISTO) return;
    const p = posDoId.get(r.dados.pergunta          );
    if (p !== undefined && p < j) desde = j;
  });
  const novas = ideias.filter((x) => x.i > desde);
  const ultima = novas[novas.length - 1];
  return ultima !== undefined && ID_PERGUNTA_RE.test(ultima.id) ? { id: ultima.id, n: novas.length } : null;
}

/** Texto do dono/modelo no motivo: sem marca técnica (REQ-LNG-1): crase, "--", "/x", snake_case, "a.b", extensão e "node". */
function higienizar(texto        )         {
  const t = texto.replace(/`/g, '').replace(/--+/g, ' ').replace(/\/[a-z]/g, (m) => ` ${m[1]}`).replace(/\bnode\b/g, 'no')
    .replace(/([A-Za-z0-9])[_.]([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])[_.]([A-Za-z0-9])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  return t === '' ? 'uma pendência' : t;
}

export function dependeDe(
  trilha        , eventos          , base               ,
  fontes                      , pousoPendente                                                    , git                                             ,
)                {
  const falhou           = [];
  for (const f of Array.isArray(fontes?.falhou) ? fontes.falhou : []) {
    const n = nomeDeFonte(f);
    if (!falhou.includes(n)) falhou.push(n);
  }
  let ord                             = { ok: false };
  try {
    if (Array.isArray(eventos)) ord = ordenar(eventos);
  } catch {
    ord = { ok: false };
  }
  const evs = ord.ok ? ord.eventos : [];
  if (!ord.ok && !falhou.includes('o diário')) falhou.push('o diário');

  const t = obj(trilha)                   ;
  const identificada = t.identificada === true && typeof t.entrega === 'string' && t.entrega !== '';
  const marcas = Array.isArray(t.marcas) ? t.marcas : [];

  // (6) pouso pendente
  // GM-15 T35 (r.9): com o id do pouso, o pedido traz "agora não (loop parado)" (o hook `responder` grava o adiamento; no teto o loop segue parado)
  const pouso = obj(pousoPendente);
  const pedeClear = pousoPendente === true || pouso.pendente === true;
  const idPouso = typeof pouso.id === 'string' && ID_PERGUNTA_RE.test(pouso.id) && !pouso.id.startsWith('herdar:') ? pouso.id : null;
  const limpar = pedeClear
    ? [item('limpar a conversa', [{ rotulo: 'limpar', comando: '/clear' }, ...(idPouso === null ? [] : [{ rotulo: AGORA_NAO_TETO, comando: `/gabarito-mestre:responder ${idPouso} agora` }])])]
    : [];
  // GM-15 T35 (r.13, r.14): o DEPENDE não mostra lembrete do orquestrador nem item adiado pelo dono
  const adiados = adiadas(evs);
  const doDono = evs.filter((e) => !notaDoOrquestrador(e));

  // (5) task no limite de revisões; a base (PAROU de teto, REQ-PNL-3) já traz o mesmo botão `liberar <task>`: não repete.
  const jaNaBase = (id        )          => (Array.isArray(base) ? base : []).some((b) => Array.isArray(b?.acoes) && b.acoes.some((a) => a?.comando === `/gabarito-mestre:liberar ${id}`)
    || b?.motivo === `teto de rodadas de review em ${id}` || (!TASK_SEGURA.test(id) && typeof b?.motivo === 'string' && b.motivo.startsWith('teto de rodadas de review')));
  const limite = tasksNoTeto(evs).filter((id) => !jaNaBase(id)).map((id) => (TASK_SEGURA.test(id)
    ? item(`decidir a ${id}: chegou ao limite de revisões`, [{ rotulo: 'liberar mais uma rodada', comando: `/gabarito-mestre:liberar ${id}` }])
    : item('decidir uma task: chegou ao limite de revisões')));

  // (1) aprovação: "mudou depois" ou aprovação `●`; os dois juntos são 1 item (a versão nova). Botão só na branch da entrega (DP-3 aj. 3).
  const aprovar                = [];
  if (identificada && (t.mudouDepois === true || marcas[2] === '●')) {
    const nova = t.mudouDepois === true;
    const entrega = t.entrega          ;
    const de = ENTREGA_SEGURA.test(entrega) ? `da ${entrega}` : 'desta entrega';
    const texto = `${nova ? 'aprovar a versão nova da spec' : 'aprovar a spec'} ${de}`;
    const naBranch = idDaBranch(typeof git?.branch === 'string' ? git.branch : null, git?.idPadrao) === entrega;
    aprovar.push(naBranch
      ? item(texto, [{ rotulo: nova ? 'aprovar a versão nova' : 'aprovar a spec', comando: CMD_APROVAR }])
      : item(`${texto}: abra a conversa na branch da entrega para aprovar`));
  }

  // (2) pedido de revisão aberto da entrega
  const aberto = identificada ? prAberto(evs) : null;
  const revisar = aberto !== null ? [item(`revisar e aceitar o pedido de revisão #${aberto}`)] : [];

  // (3) pendências abertas, com o botão "feito"
  const pendencias = pendenciasAbertas(doDono).filter((p) => !adiados.has(p.id)).map((p) => item(higienizar(p.texto), [{ rotulo: 'feito', comando: `/gabarito-mestre:responder ${p.id} 1` }]));

  // (4) ideias para a próxima entrega
  const ideias = ideiasAbertas(doDono);
  const decidirIdeias = ideias !== null && !adiados.has(ideias.id)
    ? [item(textoIdeias(ideias.n), [{ rotulo: VISTO, comando: `/gabarito-mestre:responder ${ideias.id} 1` }])]
    : [];

  // (7) emendas abertas (os botões são os da E4)
  const emendas = ord.ok ? projetarEmendas(evs).abertas : [];
  const decidirEmendas = emendas.map((p) => item(`decidir a emenda ${p.seq}`, [
    { rotulo: 'aprovar', comando: `/gabarito-mestre:emenda aprovar ${p.seq}` }, { rotulo: 'rejeitar', comando: `/gabarito-mestre:emenda rejeitar ${p.seq}` },
  ]));

  // A base não repete o que (1) e (7) já dizem (a E4 também lista "spec aguardando" e "emenda #n").
  const daBase = (Array.isArray(base) ? base : []).filter((b) => {
    if (aprovar.length > 0 && Array.isArray(b?.acoes) && b.acoes.some((a) => a?.comando === CMD_APROVAR)) return false;
    if (emendas.length > 0 && typeof b?.motivo === 'string' && /^(emenda #\d+ |e mais \d+ emenda)/.test(b.motivo)) return false;
    return true;
  }).map(copia);

  const saida = [...daBase, ...limpar, ...limite, ...aprovar, ...revisar, ...pendencias, ...decidirIdeias, ...decidirEmendas];
  if (falhou.length > 0) saida.push(item(`depende de você: ? (não consegui ler ${listaE(falhou)})`));
  else if (saida.length === 0) saida.push(item('depende de você: nada'));
  return saida;
}

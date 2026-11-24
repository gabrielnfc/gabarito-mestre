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
import { ehRespostaDeAdiamento, formaInvalida, ID_PERGUNTA_RE, TIPOS_EVENTO } from './formas.js';
import { AGORA_NAO_TETO } from './pouso.js';
import { estadoDe, freioDaLiberacao, ordenar, sombraDecideOTeto, TIPOS_DE_TASK } from './loop.js';
import { cmp } from './diario-puro.js';
/**
 * GM-15 T19 (REQ-POU-4, r1 MAJOR-1): a régua ÚNICA do sinal do loop, a mesma do Stop (`sinalArmado`): só `armado` (da sessão, fresco) é loop ligado; tudo mais
 * (ausente, `nao_conferivel`, velho, de outra sessão, sem arquivo, sem sessão: `null`) é desligado ⇒ avisa "ligar o loop" e nunca oferece /clear.
 * `undefined` = o chamador não mediu o sinal (projeção pura, sem a CLI): nada muda.
 */
export function loopDesligado(sinal                                         )          {
  return sinal !== undefined && sinal !== 'armado';
}
                                                                                        
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

/** (5) e o lote: a task no limite de revisões, com o botão do dono só para id seguro. */
const itemTeto = (id        , freio         )              => {
  const porque = freio === undefined ? '' : ` (${freio})`; // GM-15 T36: o freio da Sombra, 1 linha (`freioDaLiberacao`)
  return TASK_SEGURA.test(id)
    ? item(`decidir a ${id}: chegou ao limite de revisões${porque}`, [{ rotulo: 'liberar mais uma rodada', comando: `/gabarito-mestre:liberar ${id}` }])
    : item(`decidir uma task: chegou ao limite de revisões${porque}`);
};
/** (7) e o lote: a emenda aberta com os botões da E4. */
const itemEmenda = (seq        )              => item(`decidir a emenda ${seq}`, [
  { rotulo: 'aprovar', comando: `/gabarito-mestre:emenda aprovar ${seq}` }, { rotulo: 'rejeitar', comando: `/gabarito-mestre:emenda rejeitar ${seq}` },
]);

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
  const fechada = evs.some((r, j) => j > i && r.tipo === 'dono.resposta' && formaInvalida('dono.resposta', r.dados) === null && r.dados.pergunta === id && 'rotulo' in r.dados && !ehRespostaDeAdiamento(r.dados));
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
    ultima.set(r.dados.pergunta          , ehRespostaDeAdiamento(r.dados));
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

/** GM-15 T8 (REQ-ENT-1 d i): o botão "seguir" da próxima entrega abre o loop (a skill que conduz a entrega a partir da spec e do plano). */
export const CMD_SEGUIR = '/gabarito-mestre:gabarito-loop';
export const NENHUMA_PROXIMA = 'nenhuma próxima anotada';

/**
 * GM-15 T8 (REQ-ENT-1 d i): a próxima entrega, nesta ordem: (1) a spec com `PBI:` (id seguro) cuja entrega não tem `entrega.encerrada` vigente, a mais
 * nova pelo nome do arquivo (as specs levam a data no nome); (2) as ideias para a próxima anotadas na entrega encerrada (`eventos`, a regra única
 * `ideiasAbertas`, sem as do orquestrador, que são lembrete dele); (3) "nenhuma próxima anotada", sem botão. `encerradas` = ids com encerramento vigente
 * (inclui a própria entregue). O título passa pela higiene de linguagem do DEPENDE. Puro, nunca lança.
 */
export function proximaEntrega(specs         , encerradas                     , eventos         )          {
  const seguir = [{ rotulo: 'seguir', comando: CMD_SEGUIR }];
  const todas = (Array.isArray(specs) ? specs : []).map((x) => obj(x));
  // GM-20 T7 (REQ-PRX-1, DT15): o corte é o maior caminho de spec cujo PBI está encerrado; spec mais antiga que ele não é "próxima".
  let corte                = null;
  for (const x of todas) {
    if (typeof x.pbi === 'string' && typeof x.caminho === 'string' && encerradas.has(x.pbi) && (corte === null || cmp(x.caminho, corte) > 0)) corte = x.caminho;
  }
  const candidatas = todas
    .filter((x) => typeof x.pbi === 'string' && ENTREGA_SEGURA.test(x.pbi) && typeof x.caminho === 'string' && !encerradas.has(x.pbi) && (corte === null || cmp(x.caminho, corte) > 0))
    .sort((a, b) => cmp(a.caminho          , b.caminho          ));
  const nova = candidatas[candidatas.length - 1];
  if (nova !== undefined) {
    const titulo = typeof nova.titulo === 'string' && nova.titulo.trim() !== '' ? higienizar(nova.titulo) : '';
    return { tipo: 'spec', texto: titulo === '' ? (nova.pbi          ) : `${nova.pbi          } ${titulo}`, acoes: seguir };
  }
  let evs           = [];
  try {
    const ord = Array.isArray(eventos) ? ordenar(eventos            ) : { ok: false          };
    if (ord.ok) evs = ord.eventos;
  } catch { evs = []; }
  const ideias = ideiasAbertas(evs.filter((e) => !notaDoOrquestrador(e)));
  if (ideias !== null && ideias.n > 0) return { tipo: 'ideias', texto: textoIdeias(ideias.n), acoes: seguir };
  return { tipo: 'nenhuma', texto: NENHUMA_PROXIMA, acoes: [] };
}

/**
 * GM-15 T19 (REQ-POU-4, aprendizado 185): o botão que liga o loop automático: um `/loop` sem intervalo (dinâmico) com a tarefa de seguir o loop da entrega.
 * O texto do item nunca leva o comando (REQ-LNG-1): ele só vive no botão.
 */
export const CMD_LIGAR_LOOP = `/loop ${CMD_SEGUIR}`;
export const MOTIVO_LIGAR_LOOP = 'ligar o loop automático: sem ele nada retoma o trabalho depois do pouso';
export const MOTIVO_LIGAR_ANTES_DO_CLEAR = 'ligar o loop automático antes de limpar a conversa';
const BOTAO_LIGAR_LOOP       = { rotulo: 'ligar o loop', comando: CMD_LIGAR_LOOP };
/** GM-15 T19 (REQ-POU-3): contexto em X ou acima sem pouso da sessão. Quem limpa é o mod (pouso automático), nunca o agente: não há botão. */
export const motivoContextoAlto = (percent        , x        )         =>
  `limpar a conversa: contexto em ${Math.round(percent)} % (teto ${Math.round(x)} %); quem limpa é o mod, não o agente`;
const contextoValido = (v         )                                        => {
  const c = obj(v);
  return typeof c.percent === 'number' && Number.isFinite(c.percent) && typeof c.x === 'number' && Number.isFinite(c.x) && c.x > 0 ? { percent: c.percent, x: c.x } : null;
};

/** D-G12 (emenda 16 r.13): sem item que trave, 1 linha com este texto literal. */
export const NADA_DEPENDE = 'nada depende de você';

export function dependeDe(
  trilha        , eventos          , base               ,
  fontes                      ,
  // GM-15 T19: `loop` = o sinal do loop automático da sessão do painel (`armado` | `ausente` | `null`; só `armado` é ligado, a régua do Stop: `loopDesligado`; `undefined` = não medido, nada muda); `contexto` = a leitura
  // própria em X ou acima sem pouso desta sessão (o painel já decidiu); `ligarLoop` = o painel decidiu que falta o loop (onboarding, sinal não armado e trabalho a seguir)
  pousoPendente                                                                                                                                                               ,
  git                                             ,
  lote                       ,
)                {
  // GM-15 T13 (REQ-AUT-1): com o lote do dono (`loteDoDono`, o MESMO que `loop.mjs proxima` devolve), ele substitui (5) e (7), inteiro e na mesma ordem.
  const comLote = Array.isArray(lote);
  const doLote = comLote ? (lote                 ).map(copia) : [];

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
  const agoraNao = idPouso === null ? [] : [{ rotulo: AGORA_NAO_TETO, comando: `/gabarito-mestre:responder ${idPouso} agora` }];
  // GM-15 T19 (REQ-POU-4, aprendizado 185): com o loop sabidamente desligado nunca se pede /clear: o item manda ligar o loop antes
  const semLoop = loopDesligado(pouso.loop                                           );
  const contexto = contextoValido(pouso.contexto);
  const limpar = pedeClear
    ? [semLoop ? item(MOTIVO_LIGAR_ANTES_DO_CLEAR, [{ ...BOTAO_LIGAR_LOOP }, ...agoraNao]) : item('limpar a conversa', [{ rotulo: 'limpar', comando: '/clear' }, ...agoraNao])]
    : [
      // GM-15 T19 (REQ-POU-3): contexto alto sem pouso desta sessão: "limpar a conversa", e quem limpa é o mod (sem botão)
      ...(contexto !== null ? [item(motivoContextoAlto(contexto.percent, contexto.x))] : []),
      ...(pouso.ligarLoop === true ? [item(MOTIVO_LIGAR_LOOP, [{ ...BOTAO_LIGAR_LOOP }])] : []),
    ];
  // GM-15 T35 (r.13, r.14): o DEPENDE não mostra lembrete do orquestrador nem item adiado pelo dono
  const adiados = adiadas(evs);
  const doDono = evs.filter((e) => !notaDoOrquestrador(e));

  // (5) task no limite de revisões; a base (PAROU de teto, REQ-PNL-3) já traz o mesmo botão `liberar <task>`: não repete.
  const jaNaBase = (id        )          => (Array.isArray(base) ? base : []).some((b) => Array.isArray(b?.acoes) && b.acoes.some((a) => a?.comando === `/gabarito-mestre:liberar ${id}`)
    || b?.motivo === `teto de rodadas de review em ${id}` || (!TASK_SEGURA.test(id) && typeof b?.motivo === 'string' && b.motivo.startsWith('teto de rodadas de review')));
  const limite = tasksNoTeto(evs).filter((id) => !jaNaBase(id)).map((id) => itemTeto(id));

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
  const decidirEmendas = emendas.map((p) => itemEmenda(p.seq));

  // A base não repete o que (1) e (7) já dizem (a E4 também lista "spec aguardando" e "emenda #n").
  const daBase = (Array.isArray(base) ? base : []).filter((b) => {
    if (aprovar.length > 0 && Array.isArray(b?.acoes) && b.acoes.some((a) => a?.comando === CMD_APROVAR)) return false;
    if (emendas.length > 0 && typeof b?.motivo === 'string' && /^(emenda #\d+ |e mais \d+ emenda)/.test(b.motivo)) return false;
    return true;
  }).map(copia);

  // O PAROU de teto da base (REQ-PNL-3) já é o item do dono daquela task, com o mesmo botão: o lote não o repete (a regra de (5)); o resto vai inteiro e na ordem.
  const LIBERAR = '/gabarito-mestre:liberar ';
  const loteSemBase = doLote.filter((i) => !(i.motivo.startsWith('decidir uma task: chegou ao limite de revisões') && jaNaBase(''))
    && !i.acoes.some((a) => typeof a.comando === 'string' && a.comando.startsWith(LIBERAR) && jaNaBase(a.comando.slice(LIBERAR.length))));
  const saida = comLote
    ? [...daBase, ...limpar, ...loteSemBase, ...aprovar, ...revisar, ...pendencias, ...decidirIdeias]
    : [...daBase, ...limpar, ...limite, ...aprovar, ...revisar, ...pendencias, ...decidirIdeias, ...decidirEmendas];
  if (falhou.length > 0) saida.push(item(`depende de você: ? (não consegui ler ${listaE(falhou)})`));
  else if (saida.length === 0) saida.push(item(NADA_DEPENDE)); // D-G12 (r.13): o texto literal
  return saida;
}

                           

export const MOTIVO_PLUGIN_ATRAS = 'atualizar o plugin: o diário tem evento de uma versão mais nova';
/** O motivo com a versão instalada (a medível: o evento desconhecido não traz a que o diário exige); sem versão, o motivo de antes. */
export const motivoPluginAtras = (versao         )         =>
  typeof versao === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(versao) ? `atualizar o plugin (instalado: ${versao}): o diário tem evento de uma versão mais nova` : MOTIVO_PLUGIN_ATRAS;
const CONHECIDOS                      = new Set(TIPOS_EVENTO);

/**
 * GM-15 T13 (REQ-AUT-1): o lote do dono, o que é previsível e só o dono destrava, 1 item cada, nesta ordem:
 * (a) task `no_teto` (ordem do plano) que a Sombra não pode liberar: `sombra.libera_teto` desligado em origin ou um freio (`freioDaLiberacao`: abordagens esgotadas ou
 * orçamento 3×; GM-15 T36, sem limite numérico de liberações); (b) emenda aberta com `sombra.julga_emendas` desligado; (c) o plugin atrás do diário
 * (evento de tipo que este plugin não conhece, aprendizado 585); (d) por último, `next ⇒ main` no fim da entrega: base diferente de `main`, sem
 * `entrega.autonomia` e sem `entrega.encerrada`. `loop.mjs proxima` o devolve em `lote` e `dependeDe` o mostra igual. Puro, nunca lança; diário que
 * não ordena ⇒ lote vazio (o PAROU e o "?" do DEPENDE já cobrem).
 */
export function loteDoDono(plano              , eventos          , cfg            )                {
  let evs          ;
  try {
    const ord = Array.isArray(eventos) ? ordenar(eventos) : { ok: false          };
    if (!ord.ok) return [];
    evs = ord.eventos;
  } catch { return []; }
  const c = obj(cfg);
  const tasks = Array.isArray(plano?.tasks) ? (plano         ).tasks.map((t) => t?.id).filter((id)               => typeof id === 'string') : [];
  const daTask = (id        )           => evs.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && obj(e.dados).task === id);
  const noTeto = (id        )          => { const r = estadoDe(daTask(id)); return !('invalido' in r) && r.estado === 'no_teto'; };
  // GM-15 T36 (emenda 22 l.4, emenda 24 m.2): no_teto só vira item do dono com a flag desligada ou num freio da Sombra (`freioDaLiberacao`, a regra única do `liberar`); antes disso a Sombra decide.
  const teto = tasks.filter(noTeto).flatMap((id) => {
    if (sombraDecideOTeto(plano         , evs, id, c.liberaTeto)) return []; // a regra única de quem decide (`proxima` e painel usam a mesma)
    if (c.liberaTeto !== true) return [itemTeto(id)];
    const { freio } = freioDaLiberacao(plano         , evs, id);
    return [itemTeto(id, freio?.resumo)];
  });
  const emendas = c.julgaEmendas === true ? [] : projetarEmendas(evs).abertas.map((p) => itemEmenda(p.seq));
  // GM-15 T34 (backlog T26 MINOR-1, REQ-EME-3 B; review r1 MAJOR-3 e r2 MAJOR-1): a redação da Sombra (`emenda.proposta` com `origem: sombra`) REJEITADA (por quem não é o dono) vai
  // ao dono; a Sombra não repropõe na âncora. Fonte: emenda de âncora de REQ-EME-3 B ("proposta com origem sombra rejeitada vai ao dono"), D-G10 ("não há 3ª proposta do orquestrador"),
  // emenda 15 r.10 e emenda 16 r.15. O item é do DONO e SÓ sai por decisão dele ou pelo fim da entrega: (a) ele mesmo rejeitou (`emenda.rejeitada` origem dono) ou (c) a entrega foi
  // encerrada. Proposta do orquestrador NÃO tira o item. Aqui (e não no `proxima`) para o painel e o `proxima` terem o mesmo lote pela mesma função.
  const encerrada = evs.some((e) => e.tipo === 'entrega.encerrada');
  const est = projetarEmendas(evs);
  const rejeitadoPeloDono = (seq        )          => evs.some((e) => e.tipo === 'emenda.rejeitada' && obj(e.dados).proposta_seq === seq && obj(e.dados).origem === 'dono');
  const redacoes = encerrada ? [] : est.rejeitadas
    .filter((p) => p.origem === 'sombra' && /^[A-Za-z0-9._-]{1,60}$/.test(p.req) && !rejeitadoPeloDono(p.seq))
    .map((p) => item(`decidir a redação da Sombra rejeitada (emenda ${p.seq}, ${p.req}): a Sombra não repropõe nessa âncora`));
  const versao = evs.some((e) => !CONHECIDOS.has(e.tipo)) ? [item(motivoPluginAtras(typeof c.versaoPlugin === 'string' ? c.versaoPlugin : undefined), [{ rotulo: 'atualizar', comando: '/plugin' }])] : [];
  const base = typeof c.base === 'string' && c.base !== '' ? c.base : 'main';
  // GM-20 D-G47 (REQ-CRD-2): encerrada na base ≠ main NÃO tira o lembrete da virada; tira o PR em main, mergeado, que o `painel medir` viu conter o sha da encerrada
  // (`fato.medido pr` com `contem`). Encerrada sem sha (dono, gh sem `mergeCommit`) mantém o item: não há fato que prove a virada.
  const shaEnc = evs.filter((e) => e.tipo === 'entrega.encerrada').map((e) => obj(e.dados).sha).filter((x)              => typeof x === 'string' && x !== '').pop();
  const viradaFeita = shaEnc !== undefined && evs.some((e) => {
    if (e.tipo !== 'fato.medido') return false;
    const d = obj(e.dados);
    const v = obj(d.valor);
    return d.chave === 'pr' && v.base === 'main' && v.estado === 'mergeado' && v.contem === shaEnc;
  });
  const main = tasks.length > 0 && base !== 'main' && c.autonomiaEntrega !== true && !viradaFeita
    ? [item(`no fim da entrega: levar ${higienizar(base)} para main`)] : [];
  return [...teto, ...emendas, ...redacoes, ...versao, ...main];
}

/**
 * GM-15 T13 (obrigação da review T6 r1 P9, REQ-ENT-2): `adiar`/`cortar`/`reabrir --origem sombra` sem `--fonte` é recusado e vira item do dono
 * (Sombra sem fonte ⇒ dono), com o comando humano. Id fora da forma segura sai sem botão.
 */
export function itemSemFonte(verbo                                , task        )              {
  const seguro = typeof task === 'string' && TASK_SEGURA.test(task);
  const quem = seguro ? `a ${task}` : 'uma task';
  const motivo = verbo === 'reabrir' ? `decidir se ${quem} volta ao alvo: a Sombra não tem fonte` : `decidir se ${quem} sai do alvo (${verbo}): a Sombra não tem fonte`;
  return item(motivo, seguro ? [{ rotulo: verbo, comando: `/gabarito-mestre:${verbo} ${task}` }] : []);
}

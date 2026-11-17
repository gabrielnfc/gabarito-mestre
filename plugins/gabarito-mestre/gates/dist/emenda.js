/**
 * Núcleo puro de emendas (GM-11 T3, REQ-EME-1, EME-2). Sem E/S e sem relógio: o instante entra pelo evento, nunca por `Date.now()`.
 * A proposta é `emenda.proposta` de forma válida gravada na sessão fixa `emendas`; o julgamento (`spec.emendada` / `emenda.rejeitada`)
 * vem de qualquer sessão (o hook do dono grava na sessão dele) e o 1º julgamento válido, na ordem de `ordenar`, fecha a proposta.
 *
 * Contrato de falha: diário ausente (`[]`) é estado vazio; diário corrompido (fora de ordem) é estado vazio COM `invalido`, e
 * os dois validadores recusam. Estado vazio sem `invalido` descongelaria todo REQ e levaria `versaoDoReq` a 0 (hash da Sombra errado).
 */

import { ordenar } from './loop.js';
import { formaInvalida } from './formas.js';
import { normalizarCaminho, temDependencia } from './plano.js';
                                                                         

export const SESSAO_EMENDAS = 'emendas';

                        
                                                                                                                                         
                                                                                                                          
                    
  
                             
                      
                                                         
                                                                                                                                              
                                                                
                                                                                         
                    
  

const INVALIDO = 'diário fora de ordem';
const vazio = ()                => ({ abertas: [], aprovadas: [], rejeitadas: [] });
const ehObjeto = (v         )                               => v !== null && typeof v === 'object' && !Array.isArray(v);
const campo = (o                         , k        )          => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Caminhos normalizados (mesma regra de `plano.ts`), sem repetição; o inválido é descartado. */
function normalizados(brutos                    )           {
  const saida           = [];
  for (const b of brutos) {
    const n = typeof b === 'string' ? normalizarCaminho(b) : null;
    if (n !== null && !saida.includes(n)) saida.push(n);
  }
  return saida;
}

/** Proposta de um evento, ou `null` se não é `emenda.proposta` válida da sessão `emendas`. */
function comoProposta(e        )                  {
  if (e.tipo !== 'emenda.proposta' || e.sessao !== SESSAO_EMENDAS) return null;
  if (formaInvalida('emenda.proposta', e.dados) !== null) return null;
  const d = e.dados;
  const arquivos = campo(d, 'arquivos');
  const task = campo(d, 'task');
  return {
    seq: e.seq,
    req: campo(d, 'req')          ,
    ...(typeof task === 'string' ? { task } : {}),
    diff: campo(d, 'diff')          ,
    fato: campo(d, 'fato')          ,
    alternativa: campo(d, 'alternativa')          ,
    ...(campo(d, 'origem') === 'sombra' ? { origem: 'sombra'          } : {}),
    arquivos: Array.isArray(arquivos) ? normalizados(arquivos) : [],
    causa: campo(d, 'causa')         ,
    ts: e.ts,
  };
}

/** `[proposta_seq, origem]` de um julgamento de forma válida, ou `null`. */
function comoJulgamento(e        )                                                                    {
  if (e.tipo !== 'spec.emendada' && e.tipo !== 'emenda.rejeitada') return null;
  if (formaInvalida(e.tipo, e.dados) !== null) return null;
  return { seq: campo(e.dados, 'proposta_seq')          , origem: campo(e.dados, 'origem')                    , aprova: e.tipo === 'spec.emendada' };
}

/**
 * Regra ÚNICA de fechamento (projeção e registro a usam): por `proposta_seq`, o 1º julgamento válido na ordem do diário fecha a proposta; os seguintes são
 * ignorados. EXCEÇÃO (GM-15 T34, D-G15): a rejeição da SOMBRA é revertida pelo 1º julgamento do DONO que vier depois (palavra final dele); a rejeição do
 * dono e a aprovação (de quem for) são finais. `eventos` já ordenados por `ordenar`; julgamento de forma inválida é ignorado.
 */
export function fecharJulgamentos(eventos          )                                                             {
  const fecha = new Map                                                       ();
  for (const e of eventos) {
    if (!ehObjeto(e)) continue;
    const j = comoJulgamento(e);
    if (j === null) continue;
    const atual = fecha.get(j.seq);
    if (atual !== undefined && !(atual.aprova === false && atual.origem === 'sombra' && j.origem === 'dono')) continue;
    fecha.set(j.seq, { aprova: j.aprova, origem: j.origem });
  }
  return fecha;
}

export function projetarEmendas(eventos          )                {
  if (!Array.isArray(eventos)) return { ...vazio(), invalido: INVALIDO };
  if (eventos.length === 0) return vazio();
  let ordem                            ;
  try {
    ordem = ordenar(eventos);
  } catch {
    return { ...vazio(), invalido: INVALIDO };
  }
  if (!ordem.ok) return { ...vazio(), invalido: INVALIDO };

  // 1ª passada: as propostas. Um julgamento pode vir antes da proposta em `ordenar` (empate de ts), então não dá para fechar de passagem.
  const propostas = new Map                  ();
  for (const e of ordem.eventos) {
    if (!ehObjeto(e)) continue;
    const p = comoProposta(e);
    if (p !== null) propostas.set(p.seq, p);
  }

  // 2ª passada: a regra de fechamento é `fecharJulgamentos` (única, o registro a importa).
  const est = vazio();
  const julgadas = new Set        ();
  for (const [seq, j] of fecharJulgamentos(ordem.eventos)) {
    const p = propostas.get(seq);
    if (p === undefined) continue;
    julgadas.add(seq);
    if (j.aprova) est.aprovadas.push({ ...p, origem: j.origem });
    else est.rejeitadas.push({ ...p, rejeitadaPor: j.origem });
  }
  est.abertas = [...propostas.values()].filter((p) => !julgadas.has(p.seq)).sort((a, b) => a.seq - b.seq);
  return est;
}

/** `seq` da última aprovada do REQ, na ordem do julgamento; nenhuma ⇒ 0. */
export function versaoDoReq(est               , req        )         {
  for (let i = est.aprovadas.length - 1; i >= 0; i--) if (est.aprovadas[i].req === req) return est.aprovadas[i].seq;
  return 0;
}

/** REQs com proposta aberta. Diário inválido ⇒ vazio: quem chama já parou antes (`diario_invalido`). */
export function reqsCongelados(est               )              {
  if (est.invalido !== undefined) return new Set();
  return new Set(est.abertas.map((p) => p.req));
}

/** Arquivos da task somados aos das aprovadas da própria task, normalizados e sem repetição. Task fora do plano ⇒ `[]` (fecha o gate). */
export function escopoDaTask(plano       , est               , task        )           {
  const t = plano.tasks.find((x) => x.id === task);
  if (t === undefined) return [];
  return normalizados([...t.arquivos, ...est.aprovadas.filter((p) => p.task === task).flatMap((p) => p.arquivos)]);
}

/**
 * Emenda 13 (REQ-EME-3, REQ-AUT-1): a ÚNICA regra de quem age numa âncora (só o REQ). 2+ rejeições do orquestrador e redação da Sombra
 * já rejeitada ⇒ `dono` (a Sombra não repropõe e o orquestrador não tem 3ª); só as 2+ ⇒ `sombra` redige; senão o `orquestrador` propõe.
 * `validarProposta` e o brief de `sombra.mjs perguntar --proposta` usam esta função; nenhuma das duas camadas recontagem por conta própria.
 */
export function quemRedigeNaAncora(est               , req        )                                                                  {
  const daAncora = est.rejeitadas.filter((p) => p.req === req);
  const rejeicoes = daAncora.filter((p) => p.origem !== 'sombra').length;
  if (rejeicoes < 2) return { quem: 'orquestrador', rejeicoes };
  return { quem: daAncora.some((p) => p.origem === 'sombra') ? 'dono' : 'sombra', rejeicoes };
}

/** Motivo pelo qual a proposta não pode ser gravada, ou `null`. Ordem V0..V6: o 1º que casa vence. */
export function validarProposta(plano       , est               , dados                         )                {
  if (est.invalido !== undefined) return est.invalido;
  const forma = formaInvalida('emenda.proposta', dados);
  if (forma !== null) return forma;
  const taskBruta = campo(dados, 'task');
  const task = typeof taskBruta === 'string' ? taskBruta : undefined;
  const brutos = (campo(dados, 'arquivos') ?? [])            ;
  const t = task === undefined ? undefined : plano.tasks.find((x) => x.id === task);
  if (task !== undefined && t === undefined) return 'task fora do plano';
  if (t !== undefined && (t.reqs === undefined || !t.reqs.includes(campo(dados, 'req')          ))) return 'req fora da task';
  if (task === undefined && brutos.length > 0) return 'arquivos exigem task';
  const arquivos           = [];
  for (const c of brutos) {
    const n = normalizarCaminho(c);
    if (n === null) return `caminho inválido: ${c}`;
    arquivos.push(n);
  }
  const origem = campo(dados, 'origem');
  // Emenda 13 (REQ-EME-3): a âncora é só o REQ; a decisão vem da MESMA função que o brief da Sombra usa (REQ-AUT-1).
  const { quem } = quemRedigeNaAncora(est, campo(dados, 'req')          );
  if (origem === 'sombra') {
    if (quem === 'dono') return 'redação da Sombra rejeitada nesta âncora: vai ao dono (a Sombra não repropõe)';
    if (quem === 'orquestrador') return 'origem sombra só depois da 2ª rejeição da mesma âncora';
  } else if (quem === 'dono') {
    return 'terceira proposta do orquestrador na mesma âncora: a redação da Sombra já foi rejeitada, vai ao dono';
  } else if (quem === 'sombra') {
    return 'terceira proposta do orquestrador na mesma âncora: a Sombra redige o texto (origem sombra)';
  }
  if (task !== undefined) {
    for (const outra of plano.tasks) {
      if (outra.id === task || temDependencia(plano, task, outra.id)) continue;
      const dela = new Set([...escopoDaTask(plano, est, outra.id), ...est.abertas.filter((p) => p.task === outra.id).flatMap((p) => p.arquivos)]);
      const f = arquivos.find((a) => dela.has(a));
      if (f !== undefined) return `arquivo ${f} colide com ${outra.id} sem dependência`;
    }
  }
  return null;
}

/** Motivo pelo qual o julgamento não pode ser gravado, ou `null`. Ordem J0..J5. `origem:'dono'` não depende de `julgaEmendas`. */
export function validarJulgamento(est               , proposta_seq        , origem                  , julgaEmendas         )                {
  if (est.invalido !== undefined) return est.invalido;
  if (typeof proposta_seq !== 'number' || !Number.isInteger(proposta_seq) || proposta_seq < 1) return 'proposta_seq inválido: esperado inteiro ≥ 1';
  if (origem !== 'dono' && origem !== 'sombra') return 'origem inválida: esperado dono ou sombra';
  if (origem === 'sombra' && julgaEmendas !== true) return 'origem sombra sem sombra.julga_emendas';
  if (est.aprovadas.some((p) => p.seq === proposta_seq)) return 'proposta já julgada';
  const rej = est.rejeitadas.find((p) => p.seq === proposta_seq);
  // GM-15 T34 (D-G15): só o DONO reverte, e só a rejeição que foi da SOMBRA; o dono não re-julga o que ele mesmo julgou, nem a Sombra (ou o orquestrador) o já julgado.
  if (rej !== undefined) return origem === 'dono' && rej.rejeitadaPor === 'sombra' ? null : 'proposta já julgada';
  if (!est.abertas.some((p) => p.seq === proposta_seq)) return 'proposta inexistente';
  return null;
}

// ───────────────────────────────────────────────────────────── T54 (emenda 54): sha aceito da spec e a cadeia de emendas aplicadas

const HEX64 = /^[0-9a-f]{64}$/;

                                                                                           
                                                                                                  

/**
 * A REGRA ÚNICA do sha aceito da spec (REQ-TRI-1, REQ-DEP-1 (1), REQ-DIA-1, emenda 54). A cadeia, na ordem do diário (`ordenar`):
 * `spec.aprovada` válida REINICIA a cadeia (a ponta é o sha aprovado); `spec.aplicada` válida AVANÇA a ponta só se (a) o `spec` é o da
 * aprovação de origem, (b) `sha256_antes` é a ponta, (c) `seq` tem `spec.emendada` na mesma entrega (1º julgamento válido, aprovando) e
 * (d) a `seq` ainda não foi aplicada. Qualquer outra aplicada é ignorada (cadeia quebrada nunca vira aceito). Diário fora de ordem ⇒ `null`.
 * `filtro` restringe as aprovações a um caminho (a trilha da spec candidata); sem ele, toda aprovação vale.
 * Quem decide "o sha atual da spec está aceito?" é só `shaAceito`; painel, trilha e registro não comparam sha por conta própria.
 */
export function pontaDaSpec(eventos          , filtro                            )                                                         {
  const vazio = { ponta: null, aplicacoes: [] };
  if (!Array.isArray(eventos)) return vazio;
  let ordem                            ;
  try {
    ordem = ordenar(eventos);
  } catch {
    return vazio;
  }
  if (!ordem.ok) return vazio;
  const julgadas = new Set(projetarEmendas(eventos).aprovadas.map((p) => p.seq));
  const aplicadas = new Set        ();
  const aplicacoes              = [];
  let ponta                     = null;
  for (const e of ordem.eventos) {
    if (!ehObjeto(e) || !ehObjeto(e.dados)) continue;
    const ref = `${e.sessao}:${e.seq}`;
    if (e.tipo === 'spec.aprovada') {
      if (formaInvalida('spec.aprovada', e.dados) !== null) continue;
      const spec = campo(e.dados, 'spec')          ;
      if (filtro !== undefined && !filtro(spec)) continue;
      ponta = { spec, sha256: campo(e.dados, 'sha256')          , aplicadas: 0, ref };
    } else if (e.tipo === 'spec.aplicada') {
      if (ponta === null || formaInvalida('spec.aplicada', e.dados) !== null) continue;
      const seq = campo(e.dados, 'seq')          ;
      const spec = campo(e.dados, 'spec')          ;
      const antes = campo(e.dados, 'sha256_antes')          ;
      const depois = campo(e.dados, 'sha256_depois')          ;
      if (spec !== ponta.spec || antes !== ponta.sha256 || !julgadas.has(seq) || aplicadas.has(seq)) continue;
      aplicadas.add(seq);
      aplicacoes.push({ seq, spec, antes, depois, ref });
      ponta = { spec, sha256: depois, aplicadas: ponta.aplicadas + 1, ref };
    }
  }
  return { ponta, aplicacoes };
}

/** `true` só se `sha` (64 hex minúsculos) é o último sha aceito da spec: o da última aprovação, ou o fim da cadeia de aplicadas que parte dela. */
export function shaAceito(eventos          , sha         , filtro                            )          {
  if (typeof sha !== 'string' || !HEX64.test(sha)) return false;
  const { ponta } = pontaDaSpec(eventos, filtro);
  return ponta !== null && ponta.sha256 === sha;
}

                                                                                                                              

/**
 * Pode gravar `spec.aplicada` da `seq`? Só `seq` com `spec.emendada` (aprovada) nesta entrega, uma vez por seq, e só com spec aprovada (ponta
 * da cadeia) para partir dela. Emenda rejeitada, aberta ou inexistente ⇒ `emenda_nao_aprovada`. Devolve o motivo fechado ou a ponta (`sha256_antes`).
 */
export function validarAplicacao(eventos          , seq         )                                                                          {
  const est = projetarEmendas(eventos);
  if (est.invalido !== undefined) return { ok: false, motivo: 'diario_invalido' };
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return { ok: false, motivo: 'seq_invalido' };
  if (!est.aprovadas.some((p) => p.seq === seq)) return { ok: false, motivo: 'emenda_nao_aprovada' };
  const { ponta, aplicacoes } = pontaDaSpec(eventos);
  // Já gravada na cadeia ou em qualquer `spec.aplicada` válido da mesma seq (mesmo de cadeia que a aprovação nova reiniciou).
  const jaGravada = eventos.some((e) => ehObjeto(e) && e.tipo === 'spec.aplicada' && ehObjeto(e.dados) && formaInvalida('spec.aplicada', e.dados) === null && campo(e.dados, 'seq') === seq);
  if (aplicacoes.some((a) => a.seq === seq) || jaGravada) return { ok: false, motivo: 'ja_aplicada' };
  if (ponta === null) return { ok: false, motivo: 'spec_sem_aprovacao' };
  return { ok: true, ponta };
}

/**
 * Núcleo puro da Sombra (GM-11 T2, REQ-SOM-1 a SOM-4): hash da pergunta, projeção das decisões do diário, contagem de consultas
 * para o teto, trecho do REQ e texto do brief. Sem `node:fs`, sem relógio, sem `process.env`: o CLI (`sombra.mjs`, T7) lê e grava.
 *
 * Contrato de falha (D1, nunca adivinha): evento cuja forma `formaInvalida` recusa é ignorado pela projeção; diário cuja ordem não
 * se sustenta (`seq` não crescente dentro da sessão, `ts` ilegível) não vira decisão: as projeções devolvem vazio e `diarioEmOrdem`
 * diz `false`, para o CLI recusar com motivo em vez de tratar "não sei" como "não há". `contarConsultas` é a exceção deliberada: conta as
 * consultas válidas mesmo fora de ordem (subcontar afrouxaria o teto; o CLI recusa antes por `diarioEmOrdem`).
 * Ausente e corrompido são casos distintos: lista vazia = sem decisão; evento sem `dados` ou com `dados` que não é objeto = evento recusado pela forma, nunca exceção.
 */
import { createHash } from 'node:crypto';
import { formaInvalida, REQ_RE } from './formas.js';
import { ordenar } from './loop.js';
                                                    

                                                        
                             
                                                                               
                                                                                                              
                                          
  

/** NFC, minúsculas, `trim` e qualquer sequência de espaço (inclui quebra de linha e NBSP) vira um espaço. NFC de novo ao fim: caixa pode decompor. */
export function normalizarPergunta(p        )         {
  return p.normalize('NFC').toLowerCase().normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** `REQ-X-1` ou `task:T3`. */
export function textoAncora(a        )         {
  return 'req' in a ? a.req : `task:${a.task}`;
}

/**
 * sha256 hex de `âncora \n versao \n pergunta normalizada`. Recusa o que tornaria o hash ambíguo ou sem sentido:
 * âncora vazia ou com quebra de linha (o `\n` é o separador), `versao` que não é inteiro ≥ 0, pergunta vazia depois de normalizar.
 */
export function hashPergunta(ancora        , versao        , pergunta        )         {
  if (typeof ancora !== 'string' || ancora === '' || /[\r\n]/u.test(ancora)) throw new RangeError('âncora inválida: vazia ou com quebra de linha');
  if (typeof versao !== 'number' || !Number.isInteger(versao) || versao < 0) throw new RangeError('versao inválida: esperado inteiro ≥ 0');
  if (typeof pergunta !== 'string') throw new RangeError('pergunta inválida: esperado texto');
  const norm = normalizarPergunta(pergunta);
  if (norm === '') throw new RangeError('pergunta vazia');
  return createHash('sha256').update(`${ancora}\n${versao}\n${norm}`).digest('hex');
}

/**
 * Ordem do diário = a de `ordenar` do loop (única fonte): `seq` dentro da sessão, `(ts, sessao)` entre sessões, `ts` no formato do
 * diário. `null` se o diário não se sustenta (`seq` que não cresce na sessão, `ts`/`sessao`/`seq` ilegíveis, não é lista).
 */
function ordenado(eventos          )                  {
  if (!Array.isArray(eventos)) return null;
  const o = ordenar(eventos);
  return o.ok ? o.eventos : null;
}

/** `false` quando o diário está fora de ordem ou ilegível: o CLI recusa com motivo em vez de decidir sobre ele. */
export function diarioEmOrdem(eventos          )          {
  return ordenado(eventos) !== null;
}

const valido = (e        , tipo        )          => e.tipo === tipo && formaInvalida(e.tipo, e.dados) === null;

function paraDecisao(e        )                {
  const d = e.dados                           ;
  const dec                = {
    hash: d.pergunta_hash          , resposta: d.resposta          , arquivo: d.arquivo          ,
    pergunta_enviesada: d.pergunta_enviesada           , sessao: e.sessao, seq: e.seq, ts: e.ts,
  };
  if (d.req !== undefined) dec.req = d.req          ;
  if (d.task !== undefined) dec.task = d.task          ;
  if (d.fontes !== undefined) dec.fontes = d.fontes            ;
  if (d.medicao !== undefined) dec.medicao = d.medicao          ;
  if (d.fora_da_regra === true) dec.fora_da_regra = true;
  if (d.emenda_seq !== undefined) dec.emenda_seq = d.emenda_seq          ;
  return dec;
}

                                                   

/**
 * Vigentes por hash, com a posição na ordem do diário. Entre as `decisao.sombra` de forma válida do mesmo hash:
 * 1. `substitui {sessao, seq}` que aponta uma decisão válida do MESMO hash tira o alvo da disputa, independente de `ts`
 *    (relógio defasado não desfaz a substituição); vale em cadeia (A←B←C: vence C). Alvo inexistente, de outro tipo, de forma
 *    inválida, de outro hash ou a própria decisão: o `substitui` é ignorado.
 * 2. Entre as que sobraram, vence a mais recente pela ordem do diário. Se todas foram substituídas (ciclo forjado, que o CLI
 *    nunca grava), vale a mais recente de todas: decisão gravada nunca some.
 * Diário fora de ordem ⇒ mapa vazio (ver cabeçalho).
 */
function vigentes(eventos          )                       {
  const ord = ordenado(eventos);
  const saida = new Map                 ();
  if (ord === null) return saida;
  const porHash = new Map                                      ();
  ord.forEach((e, pos) => {
    if (!valido(e, 'decisao.sombra')) return;
    const h = (e.dados                             ).pergunta_hash;
    const lista = porHash.get(h) ?? [];
    lista.push({ e, pos });
    porHash.set(h, lista);
  });
  for (const [h, lista] of porHash) {
    const substituidas = new Set        ();
    for (const { e } of lista) {
      const s = (e.dados                                                   ).substitui;
      if (s === undefined) continue;
      const alvo = lista.find((c) => c.e.sessao === s.sessao && c.e.seq === s.seq);
      if (alvo !== undefined && alvo.e !== e) substituidas.add(alvo.e);
    }
    const livres = lista.filter((c) => !substituidas.has(c.e));
    const disputa = livres.length > 0 ? livres : lista;
    const escolhida = disputa[disputa.length - 1];
    saida.set(h, { dec: paraDecisao(escolhida.e), pos: escolhida.pos });
  }
  return saida;
}

/** Decisão vigente por hash (regra em `vigentes`). */
export function projetarDecisoes(eventos          )                             {
  return new Map([...vigentes(eventos)].map(([h, v]) => [h, v.dec]));
}

/** Hashes de `sombra.consulta` válida, na ordem em que aparecem, sem decisão vigente. Sem repetir hash. */
export function consultasAbertas(eventos          )           {
  const ord = ordenado(eventos);
  if (ord === null) return [];
  const fechadas = vigentes(eventos);
  const vistos = new Set        ();
  for (const e of ord) {
    if (!valido(e, 'sombra.consulta')) continue;
    const h = (e.dados                             ).pergunta_hash;
    if (!fechadas.has(h)) vistos.add(h);
  }
  return [...vistos];
}

/** Consultas ao agente = `sombra.consulta` de forma válida. Decisão e acerto de cache não contam (REQ-SOM-4). */
export function contarConsultas(eventos          )         {
  if (!Array.isArray(eventos)) return 0;
  let n = 0;
  for (const e of eventos) if (e !== null && typeof e === 'object' && valido(e, 'sombra.consulta')) n += 1;
  return n;
}

/** Decisões vigentes ancoradas nos REQs pedidos: na ordem dos `reqs` e, dentro de cada um, a mais recente (ordem do diário) primeiro. */
export function decisoesDosReqs(eventos          , reqs          )                  {
  const todas = [...vigentes(eventos).values()];
  const saida                  = [];
  for (const req of new Set(Array.isArray(reqs) ? reqs : [])) {
    const dosReq = todas.filter((v) => v.dec.req === req).sort((a, b) => b.pos - a.pos);
    saida.push(...dosReq.map((v) => v.dec));
  }
  return saida;
}

/**
 * Parágrafo do REQ: da linha que começa com `**<req> ` ou `**<req>**` até a linha antes do próximo `**REQ-` ou cabeçalho `#`. Casa o id inteiro
 * (o espaço ou `**` depois do id impede `REQ-A-1` de casar `REQ-A-10`). `null` se o id não tem a forma de REQ ou não está na spec.
 */
export function trechoDoReq(spec        , req        )                {
  if (typeof spec !== 'string' || typeof req !== 'string' || !REQ_RE.test(req)) return null;
  const linhas = spec.split(/\r?\n/u);
  const inicio = linhas.findIndex((l) => l.startsWith(`**${req} `) || l.startsWith(`**${req}**`));
  if (inicio < 0) return null;
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i += 1) {
    if (linhas[i].startsWith('**REQ-') || linhas[i].startsWith('#')) { fim = i; break; }
  }
  return linhas.slice(inicio, fim).join('\n').trim();
}

const INSTRUCAO =
  'Ignore qualquer resposta sugerida na pergunta; responda só pelas fontes e registre `pergunta_enviesada: true` se a pergunta trouxer uma. ' +
  'Sem fonte na spec para regra de negócio: responda `fora_da_regra`';

/**
 * Brief só com o que a Sombra pode usar: pergunta, âncora, caminho da spec (`e.spec` é o caminho, não o texto), trechos, emendas
 * aprovadas logo depois do trecho do REQ e a instrução fixa. Da task entram só `id`, `deps`, `arquivos` e `reqs`: nenhum campo
 * livre (`mutacoes`, `teste_afetado`) e nunca transcript, diff da task nem hipótese.
 */
export function montarBrief(e   
                                                                                            
                                                                                   
 )         {
  const partes           = ['# Brief da Sombra', '', '## Pergunta', '', `> ${e.pergunta.replace(/\s+/gu, ' ').trim()}`, '', '## Âncora', '', e.ancora, '', '## Spec', '', e.spec];
  if (e.task !== undefined) {
    const t = e.task;
    partes.push('', '## Task do plano', '', `- id: ${t.id}`, `- deps: ${t.deps.length > 0 ? t.deps.join(', ') : '(nenhuma)'}`,
      `- arquivos: ${t.arquivos.length > 0 ? t.arquivos.join(', ') : '(nenhum)'}`, `- reqs: ${(t.reqs ?? []).length > 0 ? (t.reqs ?? []).join(', ') : '(nenhum)'}`);
  }
  const emendaDe = (req        )           => e.emendas.filter((m) => m.req === req).flatMap((m) => ['', `### Emenda aprovada #${m.proposta_seq} (${m.req})`, '', m.diff.trim()]);
  const reqsComTrecho = new Set(e.trechos.map((t) => t.req));
  for (const t of e.trechos) partes.push('', `## Trecho ${t.req}`, '', t.texto.trim(), ...emendaDe(t.req));
  const orfas = e.emendas.filter((m) => !reqsComTrecho.has(m.req));
  if (orfas.length > 0) partes.push('', '## Emendas aprovadas', ...orfas.flatMap((m) => ['', `### Emenda aprovada #${m.proposta_seq} (${m.req})`, '', m.diff.trim()]));
  partes.push('', '## Instrução', '', `${INSTRUCAO}.`, '');
  return partes.join('\n');
}

/** Texto fixo do despacho: só o caminho do brief entra. A guarda compara este texto inteiro (T12). */
export function promptSombra(briefRel        )         {
  return `Leia o brief em ${briefRel} e responda só pelo que ele manda, no formato de resposta.json do seu papel. Nada além do brief.`;
}

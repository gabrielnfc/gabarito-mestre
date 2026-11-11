/**
 * Trilha da entrega: 7 fases, marcas e progresso (GM-14, REQ-TRI-1 e FIEL-1 b). Núcleo puro: sem E/S, sem relógio, nunca lança.
 *
 * Regras (spec REQ-TRI-1; S3b de `t0b.md`, plano B como regra):
 * - Entrega identificada = `dono.resposta` cujo rótulo é um ID (casa `idPadrao` ancorado; o mais recente vale), ou o ID de
 *   `idDaBranch` com 2º fato (spec com `PBI: <ID>`, `plano.json`, ledger). A pasta da entrega e o diário com evento não são 2º fato.
 *   FIEL-1 b: a branch sozinha não identifica entrega com PR `✓` (último mergeado, nenhum aberto); PR `?` (gh falhou) identifica.
 * - Fato próprio por fase; anterior a fase com fato = `✓`, menos aprovação sem `spec.aprovada` ⇒ `?` "não achei o registro da
 *   aprovação"; `●` = seguinte à última com fato. Fonte que falhou ou que não existe no repo (gh falho, diário que não ordena,
 *   branch sem o ID da entrega para plano e PR) ⇒ `?` "não consegui conferir <fase>", e depois dela nada é inferido:
 *   sem fato próprio ⇒ `?`, nunca `●` nem `○`.
 * - 2+ specs da entrega ⇒ spec `?` e `ambigua`, até uma `dono.resposta` com o título ou o caminho de uma delas, posterior à
 *   entrada da última spec do conjunto (DP-2 ajuste 2); a escolhida passa a ser "a spec".
 */
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.js';
                                         

export const FASES = Object.freeze(['ideia', 'spec', 'aprovacao', 'plano', 'execucao', 'pr', 'uso']         );
                                          
                                                                                                               
                           
                                                                                                
                                                                                          
  
                      
                                                                                                                       
                                                                                                                    
  

const NOME_FASE = ['a ideia', 'a spec', 'a aprovação', 'o plano', 'a execução', 'o pedido de revisão', 'o uso'];
const SEM_REGISTRO_APROVACAO = 'não achei o registro da aprovação';
const SPEC_AMBIGUA = 'achei mais de uma spec desta entrega';
const naoConferi = (i        )         => `não consegui conferir ${NOME_FASE[i]}`;
const IDX = { ideia: 0, spec: 1, aprovacao: 2, plano: 3, execucao: 4, pr: 5, uso: 6 }         ;

const obj = (v         )                          => (v !== null && typeof v === 'object' ? (v                           ) : {});
const lista =    (v         )      => (Array.isArray(v) ? (v       ) : []);
const semPonto = (c         )         => (typeof c === 'string' ? c.replace(/^\.\//, '') : '');
const chaveTexto = (s         )         => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** `idPadrao` ancorado inteiro (a alternância fica dentro); regex inválida ou não texto ⇒ `null`. */
function ancorada(idPadrao         )                {
  if (typeof idPadrao !== 'string' || idPadrao.length > 200) return null;
  try {
    return new RegExp(`^(?:${idPadrao})$`);
  } catch {
    return null;
  }
}

/** ID da entrega pelo último segmento da branch (prefixo de 1 ou 2 tokens que casa `idPadrao` ancorado); `null` sem casamento. */
export function idDaBranch(branch               , idPadrao        )                {
  if (typeof branch !== 'string' || branch === '' || branch === 'main') return null;
  const re = ancorada(idPadrao);
  if (re === null) return null;
  const tokens = branch.slice(branch.lastIndexOf('/') + 1).split('-');
  const candidatos = [tokens[0], tokens.length >= 2 ? `${tokens[0]}-${tokens[1]}` : ''];
  for (const c of candidatos) if (c !== '' && re.test(c)) return c;
  return null;
}

const fatoMedido = (e        , chave        )                                 =>
  e.tipo === 'fato.medido' && obj(e.dados).chave === chave ? obj(obj(e.dados).valor) : null;

/** Rótulo da `dono.resposta` mais recente que é um ID de entrega. */
function ligadaPorResposta(evs          , re               )                {
  if (re === null) return null;
  for (let i = evs.length - 1; i >= 0; i--) {
    const rotulo = evs[i].tipo === 'dono.resposta' ? obj(evs[i].dados).rotulo : undefined;
    if (typeof rotulo === 'string' && re.test(rotulo)) return rotulo;
  }
  return null;
}

                                                                                                            

/** Último estado medido por número; "último PR" = maior número; `aberto` = maior número aberto. */
function prs(evs          )           {
  const por = new Map                ();
  for (const e of evs) {
    const v = fatoMedido(e, 'pr');
    if (v && Number.isInteger(v.numero) && typeof v.estado === 'string') por.set(v.numero          , v.estado);
  }
  let ultimo                     = null;
  let aberto                = null;
  for (const [numero, estado] of por) {
    if (ultimo === null || numero > ultimo.numero) ultimo = { numero, estado };
    if (estado === 'aberto' && (aberto === null || numero > aberto)) aberto = numero;
  }
  return { ultimo, aberto, total: por.size };
}

/** Escolha da pergunta (c): resposta com título ou caminho de exatamente 1 das specs, depois da entrada da última delas. */
function escolhaDaSpec(evs          , specs            )                  {
  const caminhos = new Set(specs.map((s) => semPonto(s.caminho)));
  const vistos = new Set        ();
  let entrada = -1;
  evs.forEach((e, i) => {
    const c = semPonto(fatoMedido(e, 'spec')?.caminho);
    if (caminhos.has(c) && !vistos.has(c)) {
      vistos.add(c);
      entrada = i;
    }
  });
  for (let i = evs.length - 1; i > entrada; i--) {
    if (evs[i].tipo !== 'dono.resposta') continue;
    const r = chaveTexto(obj(evs[i].dados).rotulo);
    if (r === '') continue;
    const casam = specs.filter((s) => chaveTexto(s.titulo) === r || chaveTexto(semPonto(s.caminho)) === r);
    if (casam.length === 1) return casam[0];
  }
  return null;
}

/** Integradas do plano; `null` se algum ciclo de task do diário é impossível (diário inválido para a execução). */
function integradas(tasks          , evs          )                {
  let n = 0;
  for (const id of tasks) {
    const r = estadoDe(evs.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && obj(e.dados).task === id));
    if ('invalido' in r) return null;
    if (r.estado === 'integrada') n++;
  }
  return n;
}

const plural = (n        , um        , varios        )         => `${n} ${n === 1 ? um : varios}`;
const ideias = (evs          )         =>
  plural(evs.filter((e) => e.tipo === 'nota' && obj(e.dados).tipo === 'ideia').length, 'ideia anotada', 'ideias anotadas');

function ultimaConhecida(ultimas         )                {
  let melhor                                      = null;
  for (const u of lista                                (ultimas)) {
    if (typeof u?.id !== 'string' || typeof u.data !== 'string') continue;
    if (melhor === null || u.data > melhor.data) melhor = { id: u.id, data: u.data };
  }
  return melhor?.id ?? null;
}

function naoIdentificada(fatos             , evs          , candidato               )         {
  return {
    entrega: null, identificada: false, candidato, marcas: ['●', '○', '○', '○', '○', '○', '○'], motivos: Array(7).fill(null),
    fase: 1, progresso: ideias(evs), mudouDepois: false, ultimaConhecida: ultimaConhecida(fatos?.ultimas), ambigua: [],
  };
}

/** `true` = fato próprio; `false` = sem fato; texto = `?` com o motivo. `propaga`: a fonte faltou (nada depois é inferido). */
                                                                

export function trilhaDe(fatos             , eventos          )         {
  const f = obj(fatos)               ;
  const ord = Array.isArray(eventos) ? ordenar(eventos) : { ok: true         , eventos: []             };
  const corrompido = !ord.ok;
  const evs = ord.ok ? ord.eventos : [];
  const re = ancorada(f.idPadrao);
  const daBranch = idDaBranch(f.branch, f.idPadrao);
  const ligada = ligadaPorResposta(evs, re);
  const candidato = ligada ?? daBranch;
  if (candidato === null) return naoIdentificada(f, evs, null);

  const specs = lista          (f.specs).filter((s) => s !== null && typeof s === 'object');
  const doId = specs.filter((s) => s.pbi === candidato);
  const plano = f.plano !== null && typeof f.plano === 'object' ? { tasks: lista        (f.plano.tasks) } : null;
  const segundo = doId.length >= 1 || plano !== null || f.ledger === true;
  const semFonte = daBranch !== candidato; // sem branch com o ID: nem plano.json nem `gh pr list --head` têm onde procurar
  const pr = prs(evs);

  // Fase PR: fonte falhou ⇒ `?`; senão último (maior número) mergeado e nenhum aberto.
  let celPr        ;
  if (f.gh === 'falhou' || corrompido || (pr.total === 0 && semFonte)) celPr = { fato: naoConferi(IDX.pr), propaga: true };
  else celPr = { fato: pr.ultimo !== null && pr.ultimo.estado === 'mergeado' && pr.aberto === null, propaga: false };

  if (ligada === null && !(segundo && celPr.fato !== true)) return naoIdentificada(f, evs, candidato);
  const entrega = candidato;

  // Spec: exatamente 1 da entrega, ou a escolhida na pergunta (c).
  let spec                  = doId.length === 1 ? doId[0] : null;
  let ambigua             = [];
  if (doId.length >= 2) {
    spec = escolhaDaSpec(evs, doId);
    if (spec === null) ambigua = doId;
  }

  // Aprovação: `spec.aprovada` de "a spec" (ou de qualquer uma das candidatas; sem spec conhecida, qualquer), com qualquer sha.
  const alvos = spec !== null ? [spec] : ambigua;
  const aprovacoes = evs.filter((e) => e.tipo === 'spec.aprovada' && (alvos.length === 0 || alvos.some((s) => semPonto(s.caminho) === semPonto(obj(e.dados).spec))));
  const aprovado = aprovacoes.length > 0;
  const ultimaAprovacao = aprovado ? obj(aprovacoes[aprovacoes.length - 1].dados) : null;
  const mudouDepois = spec !== null && ultimaAprovacao !== null && ultimaAprovacao.sha256 !== spec.sha256;

  const nInteg = plano !== null && !corrompido ? integradas(plano.tasks, evs) : 0;
  const planoMedido = evs.some((e) => fatoMedido(e, 'plano') !== null);

  const celulas           = [
    { fato: true, propaga: false },
    ambigua.length > 0 ? { fato: SPEC_AMBIGUA, propaga: false } : { fato: spec !== null, propaga: false },
    corrompido ? { fato: naoConferi(IDX.aprovacao), propaga: true } : { fato: aprovado, propaga: false },
    plano === null && !planoMedido && semFonte ? { fato: naoConferi(IDX.plano), propaga: true } : { fato: plano !== null, propaga: false },
    corrompido || nInteg === null
      ? { fato: naoConferi(IDX.execucao), propaga: true }
      : { fato: plano !== null && plano.tasks.length > 0 && nInteg === plano.tasks.length, propaga: false },
    celPr,
    { fato: false, propaga: false },
  ];

  let ult = -1;
  celulas.forEach((c, i) => { if (c.fato === true) ult = i; });
  const marcas          = [];
  const motivos                    = [];
  celulas.forEach((c, i) => {
    if (c.fato === true) { marcas.push('✓'); motivos.push(null); }
    else if (typeof c.fato === 'string') { marcas.push('?'); motivos.push(c.fato); }
    else if (i < ult && i === IDX.aprovacao) { marcas.push('?'); motivos.push(SEM_REGISTRO_APROVACAO); }
    else if (i < ult) { marcas.push('✓'); motivos.push(null); }
    else if (i === ult + 1) { marcas.push('●'); motivos.push(null); }
    else { marcas.push('○'); motivos.push(null); }
  });
  const sem = celulas.findIndex((c) => c.propaga);
  if (sem >= 0) {
    for (let i = sem + 1; i < 7; i++) {
      if (celulas[i].fato === true) continue;
      marcas[i] = '?';
      motivos[i] = typeof celulas[i].fato === 'string' ? (celulas[i].fato          ) : naoConferi(i);
    }
  }

  const atual = marcas.indexOf('●');
  const k = atual >= 0 ? atual : Math.min(marcas.lastIndexOf('✓') + 1, IDX.uso);
  return {
    entrega, identificada: true, candidato, marcas, motivos, fase: atual >= 0 ? atual + 1 : null,
    progresso: progresso(k, { evs, spec, plano, nInteg: nInteg ?? 0, pr }), mudouDepois, ultimaConhecida: null, ambigua,
  };
}

                                                                                                                       

/** Uma linha por fase atual (spec REQ-TRI-1 "Progresso"); falta o dado da fase ⇒ cai na fase anterior. */
function progresso(k        , d       )         {
  const secoes = (s          ) => `spec com ${plural(Number.isInteger(s.secoes) ? s.secoes : 0, 'seção', 'seções')}`;
  const tasks = (p                     ) => {
    const m = p.tasks.length;
    return d.nInteg === 0 ? plural(m, 'task', 'tasks') : `${d.nInteg} de ${plural(m, 'task integrada', 'tasks integradas')}`;
  };
  if (k >= IDX.uso && d.pr.ultimo !== null && d.pr.ultimo.estado === 'mergeado') {
    let versao                = null;
    for (const e of d.evs) {
      const tag = fatoMedido(e, 'release')?.tag;
      const m = typeof tag === 'string' ? /(\d+\.\d+\.\d+)/.exec(tag) : null;
      if (m) versao = m[1];
    }
    return `pedido de revisão #${d.pr.ultimo.numero} aceito · ${versao !== null ? `versão ${versao} publicada` : 'aguardando publicação'}`;
  }
  if (k >= IDX.pr && d.pr.aberto !== null) return `pedido de revisão #${d.pr.aberto} aberto`;
  if (k >= IDX.execucao && d.plano !== null && d.plano.tasks.length > 0) return tasks(d.plano);
  if (k >= IDX.plano && d.spec !== null) return secoes(d.spec);
  if (k === IDX.aprovacao && d.spec !== null) return `${secoes(d.spec)} · falta aprovar`;
  return ideias(d.evs);
}

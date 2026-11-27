/**
 * Trilha da entrega: 7 fases, marcas e progresso (GM-14, REQ-TRI-1 e FIEL-1 b). Núcleo puro: sem E/S, sem relógio, nunca lança.
 *
 * Regras (spec REQ-TRI-1; S3b de `t0b.md`, plano B como regra):
 * - Entrega identificada = a `dono.resposta` mais recente à pergunta (b) DA SESSÃO ATUAL (`fatos.sessao`), se o rótulo é um ID
 *   (casa `idPadrao` ancorado); sem sessão atual nunca liga por resposta (DP-2 ajuste 1, plano T3). Ou o ID de
 *   `idDaBranch` com 2º fato (spec com `PBI: <ID>`, `plano.json`, ledger). A pasta da entrega e o diário com evento não são 2º fato.
 *   FIEL-1 b: a branch sozinha não identifica entrega com PR `✓` (último mergeado, nenhum aberto); PR `?` (gh falhou) identifica.
 * - Fato próprio por fase; anterior a fase com fato = `✓`, menos aprovação sem `spec.aprovada` ⇒ `?` "não achei o registro da
 *   aprovação"; `●` = seguinte à última com fato. Fonte que falhou ou que não existe no repo (gh falho, diário que não ordena,
 *   branch sem o ID da entrega para plano e PR) ⇒ `?` "não consegui conferir <fase>", e depois dela nada é inferido:
 *   sem fato próprio ⇒ `?`, nunca `●` nem `○`.
 * - 2+ specs da entrega ⇒ spec `?` e `ambigua`, até uma `dono.resposta` com o título ou o caminho de uma delas, posterior à
 *   entrada da última spec do conjunto (DP-2 ajuste 2); a escolhida passa a ser "a spec".
 */
import { estadosPorTask, ordenar } from './loop.js';
import { shaAceito } from './emenda.js';
                                         

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

/** Notas que já são âncora de pergunta própria do painel ((a), (d), pendência): nunca são a âncora de (b) (Emenda 2 consolidada). */
const NOTA_COM_PERGUNTA                       = new Set(['assunto', 'duvida', 'pendencia', 'ideia']);

/**
 * Âncora da pergunta (b) da sessão (DP-2 ajuste 1; Sombra 7c74258a): `<sessao>:<seq>` do 1º evento de trabalho dela — `fato.medido`
 * que não é de chave `spec` (âncora de (c)) ou `nota` que não é pergunta própria (`assunto`, `duvida`, `pendencia`), para (b) nunca
 * dividir id com outra pergunta. REGRA ÚNICA: `perguntas.ts` importa esta função. Sem sessão ou sem esse evento ⇒ `null` ((b) não
 * abre: falha fechada).
 */
export function ancoraDaPerguntaB(eventos          , sessao               )                {
  if (typeof sessao !== 'string' || sessao === '' || !Array.isArray(eventos)) return null;
  const e = eventos.find((x) => x?.sessao === sessao
    && ((x.tipo === 'fato.medido' && obj(x.dados).chave !== 'spec') || (x.tipo === 'nota' && !NOTA_COM_PERGUNTA.has(obj(x.dados).tipo))));
  return e !== undefined ? `${sessao}:${e.seq}` : null;
}

/** Rótulo da 1ª `dono.resposta` (a mais antiga vence: corrida entre sessões não troca a escolha) à pergunta (b) da sessão, posterior à âncora; só vale se é um ID de entrega. */
function ligadaPorResposta(evs          , re               , sessao         )                {
  if (re === null || typeof sessao !== 'string') return null;
  const ancora = ancoraDaPerguntaB(evs, sessao);
  if (ancora === null) return null;
  const desde = evs.findIndex((e) => e.sessao === sessao && `${sessao}:${e.seq}` === ancora);
  for (let i = desde + 1; i < evs.length; i++) {
    if (evs[i].tipo !== 'dono.resposta' || obj(evs[i].dados).pergunta !== ancora) continue;
    const rotulo = obj(evs[i].dados).rotulo;
    return typeof rotulo === 'string' && re.test(rotulo) ? rotulo : null;
  }
  return null;
}

                                                                                                            

/**
 * Último estado medido por número; "último PR" = maior número; `aberto` = maior número aberto. GM-15 (T3): o PR achado por `via: 'titulo'`
 * vale mesmo com head sem o ID; o descarte por head (head que não casa a entrega) vale só para `via: 'head'` ou fato sem `via`.
 * `entrega` ausente ⇒ sem descarte (só os testes antigos de `prs` não passam por `trilhaDe`).
 */
function prs(evs          , entrega               , idPadrao        )           {
  const por = new Map                ();
  for (const e of evs) {
    const v = fatoMedido(e, 'pr');
    if (!v || !Number.isInteger(v.numero) || typeof v.estado !== 'string') continue;
    if (entrega !== null && v.via !== 'titulo' && typeof v.branch === 'string' && v.branch !== '' && idDaBranch(v.branch, idPadrao) !== entrega) {
      por.delete(v.numero          ); // o PR "saiu" da entrega: o head de outra entrega (a remedição por número pode revelá-lo)
      continue;
    }
    por.set(v.numero          , v.estado);
  }
  let ultimo                     = null;
  let aberto                = null;
  for (const [numero, estado] of por) {
    if (ultimo === null || numero > ultimo.numero) ultimo = { numero, estado };
    if (estado === 'aberto' && (aberto === null || numero > aberto)) aberto = numero;
  }
  return { ultimo, aberto, total: por.size };
}

const escapar = (id        )         => id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const ms = (v         )         => (typeof v === 'string' ? Date.parse(v) : NaN);

                            
                                                                                   
                     
                                                                                                  
                                                                                     
                                                      
                            
                                                                                                  
                             
  

/**
 * GM-15 T3 (REQ-ENT-1 c, d): estado de encerramento da entrega `id`, puro (nunca lança). O diário que não ordena não afirma (`encerrada: false`).
 * Depois de uma `entrega.reaberta` só vale uma `entrega.encerrada` posterior a ela, de PR que ainda não encerrou e cujo `mergeado_em`
 * (o `mergedAt` do GitHub, nunca o `ts` da medição) é posterior a `em`.
 */
export function encerramentoDe(eventos          , id        )               {
  const vazio               = { encerrada: false, primeira: null, reabertaEm: null, prsQueEncerraram: [] };
  const ord = Array.isArray(eventos) ? ordenar(eventos) : { ok: false          };
  if (!ord.ok) return vazio;
  const usados = new Set        ();
  let reabertaEm                = null;
  let primeira                           = null;
  for (const e of ord.eventos) {
    const d = obj(e.dados);
    if (d.entrega !== id) continue;
    if (e.tipo === 'entrega.reaberta') {
      reabertaEm = typeof d.em === 'string' ? d.em : reabertaEm;
      primeira = null;
    } else if (e.tipo === 'entrega.encerrada' && primeira === null && Number.isInteger(d.pr) && typeof d.mergeado_em === 'string') {
      // GM-18 (REQ-ENC-1 iv, D4): o dono re-encerra pela ordem do diário, sem PR novo; `head`/`titulo` seguem exigindo PR novo.
      if (reabertaEm !== null && d.via !== 'dono' && !(ms(d.mergeado_em) > ms(reabertaEm) && !usados.has(d.pr          ))) continue; // re-encerramento só com PR novo
      primeira = { pr: d.pr          , via: String(d.via), mergeado_em: d.mergeado_em, ...(typeof d.versao === 'string' ? { versao: d.versao } : {}) };
      usados.add(d.pr          );
    }
  }
  return { encerrada: primeira !== null, primeira, reabertaEm, prsQueEncerraram: [...usados] };
}

                                                                                                                                                          

/** Margem de relógio entre a máquina e o GitHub para comparar o `mergeado_em` do PR com a última integração (GM-21 DT2). */
const MARGEM_RELOGIO_MS = 5 * 60 * 1000;

/**
 * GM-21 T1 (REQ-ENC-1, DT1, a regra ÚNICA de "plano aberto"; `podeEncerrar` e a fase PR de `trilhaDe` a usam): as tasks de `tasks` que não estão integradas
 * nem fora (`adiada`/`cortada`), pela mesma `estadosPorTask` de `integradas`. Task em `invalidas` (reabertura de origem inválida) conta como aberta.
 * Diário que não ordena ou não projeta ⇒ `[]` (lado seguro: a regra de hoje). Evento de task fora do plano é ignorado, como na trilha.
 */
export function tasksAbertas(tasks          , eventos          )           {
  const ids = lista        (tasks).filter((t) => typeof t === 'string');
  if (ids.length === 0 || !Array.isArray(eventos)) return [];
  const ord = ordenar(eventos);
  if (!ord.ok) return [];
  const r = estadosPorTask(ids, ord.eventos, true);
  if (!r.ok) return [];
  return ids.filter((id) => {
    if (r.invalidas.has(id)) return true;
    const est = r.estados.get(id)?.estado;
    return est !== 'integrada' && est !== 'adiada' && est !== 'cortada';
  });
}

/** `true` se `tasksAbertas` não é vazia. */
export function planoAberto(tasks          , eventos          )          {
  return tasksAbertas(tasks, eventos).length > 0;
}

/**
 * GM-15 T3 (REQ-ENT-1 a, b, c): este PR pode encerrar a entrega `id`? PR com a `base` da entrega (GM-20 REQ-CRD-2: parâmetro, `main` por omissão; fato sem `base` nunca encerra), mergeado, head casando
 * o ID (`via: 'head'`) ou título casando (`via: 'titulo'`), que ainda não encerrou; depois de `entrega.reaberta`, só com `mergeado_em` posterior a `em`.
 * GM-21 T1: (DT1) com `plano` (as tasks do `plano.json`) e alguma aberta (`planoAberto`), nenhum PR encerra, por nenhuma `via`; sem `plano` (ou `null`), a regra de hoje.
 * (DT2) entrega com ao menos 1 `task.integrada`: só encerra o PR com `mergeado_em` >= o `ts` da última integração menos 5 min (margem de relógio).
 */
export function podeEncerrar(eventos          , id        , pr          , base = 'main', plano                             = null)          {
  if (pr === null || typeof pr !== 'object' || pr.estado !== 'mergeado' || pr.base !== base || !Number.isInteger(pr.numero)) return false;
  if (pr.via === 'head') { if (idDaBranch(pr.branch ?? null, escapar(id)) !== id) return false; }
  else if (pr.via !== 'titulo') return false;
  const enc = encerramentoDe(eventos, id);
  if (enc.encerrada || enc.prsQueEncerraram.includes(pr.numero)) return false;
  if (plano !== null && typeof plano === 'object' && planoAberto(plano.tasks, eventos)) return false;
  const integracoes = Array.isArray(eventos) ? eventos.filter((e) => e?.tipo === 'task.integrada').map((e) => ms(e.ts)) : [];
  if (integracoes.length > 0) {
    const ultima = Math.max(...integracoes); // `ts` ilegível ⇒ NaN ⇒ não afirma (não encerra)
    if (!(ms(pr.mergeado_em) >= ultima - MARGEM_RELOGIO_MS)) return false;
  }
  return enc.reabertaEm === null || ms(pr.mergeado_em) > ms(enc.reabertaEm);
}

/**
 * O rótulo (já sem caixa e aparado) que aceita 1 spec como "a spec": título, caminho, nome do arquivo, ou `…` + final do caminho
 * (rótulo gravável de ≤ 60 caracteres quando título e caminho não cabem ou se repetem; `perguntas.ts` escolhe o que cabe).
 */
export function rotuloCasaSpec(s                                       , r        )          {
  if (r === '') return false;
  const caminho = chaveTexto(semPonto(s.caminho));
  return chaveTexto(s.titulo) === r || caminho === r || caminho.split('/').pop() === r || (r.startsWith('…') && r.length > 1 && caminho.endsWith(r.slice(1)));
}

/**
 * Âncora da pergunta (c) (REGRA ÚNICA: `perguntas.ts` importa esta função e `escolhaDaSpec` só aceita resposta a este id):
 * `<sessao>:<seq>` da 1ª entrada do caminho que completou o conjunto de `caminhos`; sem entrada medida de todos ⇒ `null`.
 */
export function ancoraDaPerguntaC(eventos          , caminhos          )                {
  const alvo = new Set(caminhos.map(semPonto));
  const vistos = new Set        ();
  let ancora                = null;
  for (const e of eventos) {
    const c = semPonto(fatoMedido(e, 'spec')?.caminho);
    if (alvo.has(c) && !vistos.has(c)) {
      vistos.add(c);
      ancora = e;
    }
  }
  return ancora !== null && vistos.size === alvo.size ? `${ancora.sessao}:${ancora.seq}` : null;
}

/**
 * Escolha da pergunta (c): resposta À PERGUNTA (c) (`pergunta` = âncora de `ancoraDaPerguntaC`) cujo rótulo (título, caminho, nome do
 * arquivo ou `…`+final do caminho: `rotuloCasaSpec`) casa com exatamente 1 das specs. Resposta a outra pergunta não resolve.
 */
function escolhaDaSpec(evs          , specs            )                  {
  const id = ancoraDaPerguntaC(evs, specs.map((s) => s.caminho          ));
  if (id === null) return null;
  const entrada = evs.findIndex((e) => `${e.sessao}:${e.seq}` === id);
  for (let i = entrada + 1; i < evs.length; i++) {
    if (evs[i].tipo !== 'dono.resposta' || obj(evs[i].dados).pergunta !== id) continue;
    const r = chaveTexto(obj(evs[i].dados).rotulo);
    if (r === '') continue;
    const casam = specs.filter((s) => rotuloCasaSpec(s, r));
    if (casam.length === 1) return casam[0];
  }
  return null;
}

/**
 * Integradas do plano; `null` se algum ciclo de task do diário é impossível (diário inválido para a execução). Reabertura de origem inválida afeta só a task
 * dela (GM-15 T25, MAJOR-2: `estadosPorTask`, a regra única de `proximaAcao` e do pouso): ela não conta como integrada e as outras seguem contadas.
 */
function integradas(tasks          , evs          )                {
  const r = estadosPorTask(tasks, evs, true);
  if (!r.ok) return null;
  let n = 0;
  for (const est of r.estados.values()) if (est.estado === 'integrada') n++;
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
  const ligada = ligadaPorResposta(evs, re, f.sessao);
  const candidato = ligada ?? daBranch;
  if (candidato === null) return naoIdentificada(f, evs, null);

  const specs = lista          (f.specs).filter((s) => s !== null && typeof s === 'object');
  const doId = specs.filter((s) => s.pbi === candidato);
  const plano = f.plano !== null && typeof f.plano === 'object' ? { tasks: lista        (f.plano.tasks) } : null;
  const segundo = doId.length >= 1 || plano !== null || f.ledger === true;
  const semFonte = daBranch !== candidato; // sem branch com o ID: nem plano.json nem `gh pr list --head` têm onde procurar
  const pr = prs(evs, candidato, f.idPadrao);

  // Fase PR: fonte falhou ⇒ `?`; senão último (maior número) mergeado e nenhum aberto.
  let celPr        ;
  if (f.gh === 'falhou' || corrompido || (pr.total === 0 && semFonte)) celPr = { fato: naoConferi(IDX.pr), propaga: true };
  // GM-21 DT1 (emenda 1): a regra única de "publicada" é esta fase; com task aberta no plano, o PR mergeado não a cumpre (a entrega segue identificada).
  else celPr = { fato: pr.ultimo !== null && pr.ultimo.estado === 'mergeado' && pr.aberto === null && !(plano !== null && planoAberto(plano.tasks, evs)), propaga: false };

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
  // T54 (emenda 54): "mudou depois" = o sha atual não é o último aceito (regra única `shaAceito`: aprovação ou cadeia de emendas aplicadas).
  const dosAlvos = (caminho        )          => alvos.length === 0 || alvos.some((s) => semPonto(s.caminho) === semPonto(caminho));
  const mudouDepois = spec !== null && ultimaAprovacao !== null && !shaAceito(evs, spec.sha256, dosAlvos);

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

/**
 * Núcleo puro do loop (REQ-LOOP-2): mesma entrada, mesma saída. Sem E/S e sem relógio.
 * A precedência de `proximaAcao` é o contrato da Task 2 do plano da E2; cada cláusula traz o número dela.
 */

// O mod carrega `dist/loop.js` como módulo de hook: só import relativo e, no fecho inteiro, nenhum módulo embutido do Node (por isso `plano.ts` normaliza caminho por conta própria).
// A projeção das propostas abertas é UMA só, a de `emenda.ts`; `emenda.ts` importa `ordenar` daqui (ciclo medido nos runners).
import { escopoDaTask, projetarEmendas } from './emenda.js';
import { MOTIVOS_REENTREGA, PAPEIS } from './formas.js';
import { pendenciasAprendizado } from './pendencias.js';
                                                                                         

                                                                                         

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Papéis de task do loop; a lista mora em `formas.ts` (a forma do aprendizado a usa e `loop.ts` já depende de `formas.ts` por `emenda.ts`). */
export { PAPEIS };
export const TIPOS_DE_TASK                    = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta', 'task.fora'];
/**
 * Progresso (REQ-LOOP-5): os eventos que `proximaAcao` consome, TIPOS_DE_TASK, `ci.resultado` e o julgamento de emenda (descongela).
 * Fonte única: o hook Stop (contador de Stops) e o mod (marcador de pouso pendente) importam esta lista; guarda, sessão, custo,
 * pouso, pausa e a própria `emenda.proposta` (só um pedido) não contam.
 */
export const TIPOS_DE_PROGRESSO                    = [...TIPOS_DE_TASK, 'ci.resultado', 'spec.emendada', 'emenda.rejeitada', 'aprendizado', 'aprendizado.nada'];

/** Comparação por código, nunca por localidade: a ordem não pode depender da máquina. */
const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ordem só por `seq` dentro da sessão: a guarda carimba `ts` antes do lock, então `ts` contraditório na sessão
 * é esperado e não invalida. Entre sessões, intercala pelas cabeças em `(ts, sessao)`, sem reordenar nenhuma delas.
 */
export function ordenar(eventos          )                                                  {
  const sessoes = new Map                                     ();
  for (const e of eventos) {
    if (typeof e?.sessao !== 'string' || !Number.isInteger(e.seq) || typeof e.ts !== 'string' || !TS_RE.test(e.ts)) {
      return { ok: false };
    }
    const ms = Date.parse(e.ts);
    if (Number.isNaN(ms)) return { ok: false };
    const fila = sessoes.get(e.sessao) ?? [];
    const anterior = fila[fila.length - 1];
    if (anterior && e.seq <= anterior.e.seq) return { ok: false };
    fila.push({ e, ms });
    sessoes.set(e.sessao, fila);
  }
  const nomes = [...sessoes.keys()].sort(cmp);
  const cabeca = new Map(nomes.map((n) => [n, 0]));
  const saida           = [];
  while (saida.length < eventos.length) {
    let melhor                                      = null;
    for (const nome of nomes) {
      const prox = (sessoes.get(nome)                               )[cabeca.get(nome)          ];
      if (prox && (!melhor || prox.ms < melhor.ms)) melhor = { nome, ms: prox.ms };
    }
    const { nome } = melhor                    ;
    const i = cabeca.get(nome)          ;
    saida.push((sessoes.get(nome)                               )[i].e);
    cabeca.set(nome, i + 1);
  }
  return { ok: true, eventos: saida };
}

                        
                                                                                                                                                         

/** Eventos de task como a tabela os enxerga; o veredito já vem classificado pela rodada e pelos achados. */
export const CHAVES_DE_EVENTO = [
  'iniciada.implementador', 'iniciada.revisor', 'iniciada.correcao', 'task.concluida',
  'veredito.aprovado', 'veredito.aprovado.com_achado',
  'veredito.reprovado.r1', 'veredito.reprovado.teto', 'veredito.reprovado.sem_achado',
  'task.integrada', 'reaberta.retomada', 'reaberta.dono', 'reaberta.sombra', 'concluida.reentrega',
  'fora.adiada', 'fora.cortada', 'reaberta.fora',
]         ;
                                                            

const VEREDITOS = {
  'veredito.aprovado': 'aprovada',
  'veredito.reprovado.r1': 'reprovada',
  'veredito.reprovado.teto': 'no_teto',
  'veredito.reprovado.sem_achado': 'reprovada',
}         ;

/**
 * Única fonte do estado de uma task: estado → evento → próximo estado. Par ausente é diário inválido.
 * `veredito.aprovado.com_achado` não aparece em nenhum estado de propósito (A11).
 * `reaberta.retomada` fora de agente em voo não muda nada: quem decide reabrir é o orquestrador, não esta tabela.
 * `concluida.reentrega` (FIEL-8 b, `concluir --motivo`): commit novo depois do `concluir` só em `concluida` (b1, rodada igual) e em
 * `aprovada` (b2, rodada − 1: o APROVADO anulado não conta); em qualquer outro estado é par ausente (b3). O motivo não dá poder: não tira do teto, não pula review.
 * `reaberta.sombra` (GM-14 T36, FIEL-15): SÓ em `no_teto` (⇒ `pendente`, rodada 0); em qualquer outro estado é par ausente: a Sombra nunca grava
 * evento sem efeito que pareça liberação. Os limites da liberação (progresso medido, abordagens esgotadas, orçamento 3×; sem limite numérico, GM-15 T36) são da borda e de `freioDaLiberacao`, que contam no diário.
 * GM-15 T5 (REQ-ENT-2): `fora.adiada` e `fora.cortada` (`task.fora`) levam a `adiada`/`cortada` SÓ de estado não integrado e sem agente em voo
 * (`pendente`, `concluida`, `reprovada`, `aprovada`, `no_teto`); de `implementando`, `corrigindo`, `em_revisao`, `integrada` ou de outro fora é par ausente.
 * `adiada` e `cortada` são terminais: só `reaberta.fora` (`task.reaberta {de:'fora'}`, dono ou Sombra) sai, para `pendente` com rodada 0 (aprendizado 142).
 */
export const TRANSICOES                                                               = {
  pendente: { 'fora.adiada': 'adiada', 'fora.cortada': 'cortada', 'iniciada.implementador': 'implementando', 'reaberta.retomada': 'pendente', 'reaberta.dono': 'pendente' },
  implementando: { 'task.concluida': 'concluida', 'reaberta.retomada': 'pendente', 'reaberta.dono': 'implementando' },
  concluida: { 'fora.adiada': 'adiada', 'fora.cortada': 'cortada', 'iniciada.revisor': 'em_revisao', ...VEREDITOS, 'reaberta.retomada': 'concluida', 'reaberta.dono': 'concluida', 'concluida.reentrega': 'concluida' },
  em_revisao: { ...VEREDITOS, 'reaberta.retomada': 'concluida', 'reaberta.dono': 'em_revisao' },
  reprovada: { 'fora.adiada': 'adiada', 'fora.cortada': 'cortada', 'iniciada.correcao': 'corrigindo', 'reaberta.retomada': 'reprovada', 'reaberta.dono': 'reprovada' },
  corrigindo: { 'task.concluida': 'concluida', 'reaberta.retomada': 'reprovada', 'reaberta.dono': 'corrigindo' },
  aprovada: { 'fora.adiada': 'adiada', 'fora.cortada': 'cortada', 'task.integrada': 'integrada', 'reaberta.retomada': 'aprovada', 'reaberta.dono': 'aprovada', 'concluida.reentrega': 'concluida' },
  // Autotransição: só o dono (ou a Sombra, 1 vez, com o flag de origin: FIEL-15) tira do teto; evento avulso não tira nem quebra. `task.integrada` fica de fora: integrar sem liberação é fraude.
  no_teto: {
    'fora.adiada': 'adiada', 'fora.cortada': 'cortada',
    'iniciada.implementador': 'no_teto', 'iniciada.revisor': 'no_teto', 'iniciada.correcao': 'no_teto', 'task.concluida': 'no_teto',
    'veredito.aprovado': 'no_teto', 'veredito.aprovado.com_achado': 'no_teto', 'veredito.reprovado.r1': 'no_teto',
    'veredito.reprovado.teto': 'no_teto', 'veredito.reprovado.sem_achado': 'no_teto',
    'reaberta.retomada': 'no_teto', 'reaberta.dono': 'pendente', 'reaberta.sombra': 'pendente',
  },
  integrada: { 'reaberta.retomada': 'integrada', 'reaberta.dono': 'integrada' },
  adiada: { 'reaberta.fora': 'pendente' },
  cortada: { 'reaberta.fora': 'pendente' },
};

const contagem = (v         )          => Number.isInteger(v) && (v          ) >= 0;

/** Classifica um evento de task; `string` é o motivo de o `dados` não cumprir o contrato. */
function chaveDe(e        , rodada        , estado            )                                                         {
  const dados = e.dados ?? {};
  switch (e.tipo) {
    case 'task.iniciada':
      if (!(PAPEIS                      ).includes(dados.papel)) return 'papel inválido';
      return { chave: `iniciada.${dados.papel         }`               , rodada: null };
    case 'task.concluida':
      // Sem `motivo` é a entrega da 2.0.0 (chave `task.concluida`); com ele, a reentrega (b), e só os 3 literais valem (b6).
      if (dados.motivo === undefined) return { chave: 'task.concluida', rodada: null };
      if (!(MOTIVOS_REENTREGA                      ).includes(dados.motivo)) return 'motivo inválido';
      return { chave: 'concluida.reentrega', rodada: estado === 'aprovada' ? rodada - 1 : null };
    case 'task.integrada':
      return { chave: 'task.integrada', rodada: null };
    case 'task.fora':
      if (dados.como !== 'adiada' && dados.como !== 'cortada') return 'como inválido';
      return { chave: `fora.${dados.como}`               , rodada: null };
    case 'task.reaberta':
      // GM-15 T5: a volta de `fora` ({de:'fora'}) é do dono ou da Sombra, nunca `retomada`; outro valor de `de` não é lido como reabertura comum.
      if (dados.de !== undefined) {
        if (dados.de !== 'fora') return 'de inválido';
        if (dados.origem !== 'dono' && dados.origem !== 'sombra') return 'origem inválida';
        return { chave: 'reaberta.fora', rodada: null };
      }
      if (dados.origem !== 'dono' && dados.origem !== 'retomada' && dados.origem !== 'sombra') return 'origem inválida';
      return { chave: `reaberta.${dados.origem}`               , rodada: null };
    case 'review.veredito': {
      const { veredito, rodada: declarada, major, blocker } = dados;
      if (veredito !== 'APROVADO' && veredito !== 'REPROVADO') return 'veredito inválido';
      if (!contagem(declarada) || !contagem(major) || !contagem(blocker)) return 'contagem inválida';
      // Rodada é o nº de vereditos desde a última reabertura do dono; quem declara outra mente.
      // No teto o veredito é avulso: não conta rodada, e a duplicata não pode quebrar a saída do dono.
      const noTeto = estado === 'no_teto';
      if (!noTeto && declarada !== rodada + 1) return 'rodada fora de sequência';
      const n = noTeto ? (declarada          ) : rodada + 1;
      const novaRodada = noTeto ? null : n;
      const achados = (major          ) + (blocker          );
      if (veredito === 'APROVADO') return { chave: achados > 0 ? 'veredito.aprovado.com_achado' : 'veredito.aprovado', rodada: novaRodada };
      if (n === 1) return { chave: 'veredito.reprovado.r1', rodada: novaRodada };
      return { chave: achados > 0 ? 'veredito.reprovado.teto' : 'veredito.reprovado.sem_achado', rodada: novaRodada };
    }
    default:
      return 'tipo fora do contrato de task';
  }
}

/** Redutor único: eventos de UMA task, já ordenados, para o estado dela. Nada decide estado fora de `TRANSICOES`. */
export function estadoDe(eventosDaTask          )                                                                {
  let estado             = 'pendente';
  let rodada = 0;
  for (const e of eventosDaTask) {
    const c = chaveDe(e, rodada, estado);
    if (typeof c === 'string') return { invalido: c };
    const proximo = TRANSICOES[estado][c.chave];
    if (proximo === undefined) return { invalido: `${c.chave} em ${estado}` };
    estado = proximo;
    rodada = proximo === 'pendente' ? 0 : (c.rodada ?? rodada);
  }
  return { estado, rodada };
}

                                                           

/**
 * Causas de `estadoDe` que atingem só a task dela (GM-15 T25, REQ-HIG-1 D; aprendizado 585): `task.reaberta` com `origem` ou `de` fora da lista, já gravada.
 * O `append` a recusa (T1); o que já está no diário não invalida o diário inteiro. Qualquer outra causa segue derrubando a projeção.
 */
const CAUSAS_DA_TASK                    = ['origem inválida', 'de inválido'];

/**
 * A regra ÚNICA de validade por task (GM-15 T25 MAJOR-2): `proximaAcao`, `tasksEmVoo` (pouso, `loop.mjs pousar` e o mod) e a trilha usam esta função.
 * `eventos` já ordenados. Evento de task fora de `ids` ⇒ `fora_do_plano` (ou ignorado com `ignorarFora`, como a trilha faz); causa que atinge só a task
 * ⇒ `invalidas` (task → causa, sem estado); qualquer outro defeito ⇒ `tabela` com a task.
 */
                            
                                                                                    
                                          
                                                  
export function estadosPorTask(ids                   , eventosOrdenados          , ignorarFora = false)                 {
  const porTask = new Map                  (ids.map((id) => [id, []]));
  for (const e of eventosOrdenados) {
    if (!TIPOS_DE_TASK.includes(e.tipo)) continue;
    const t = e.dados !== null && typeof e.dados === 'object' ? (e.dados                           ).task : undefined;
    const fila = typeof t === 'string' ? porTask.get(t) : undefined;
    if (fila === undefined) {
      if (ignorarFora) continue;
      return { ok: false, motivo: 'fora_do_plano' };
    }
    fila.push(e);
  }
  const estados = new Map                      ();
  const invalidas = new Map                ();
  for (const [id, fila] of porTask) {
    const r = estadoDe(fila);
    if ('invalido' in r) {
      if (!CAUSAS_DA_TASK.includes(r.invalido)) return { ok: false, motivo: 'tabela', task: id };
      invalidas.set(id, r.invalido);
      continue;
    }
    estados.set(id, r);
  }
  return { ok: true, estados, invalidas };
}

/** Estado por task, ou `null` se algum evento sai do plano, do contrato de `dados` ou da tabela. A task com reabertura de origem inválida sai de `estados` e entra em `invalidas` com a causa. */
function projetar(plano       , eventos          )                                                                                                     {
  let ciVermelhos = 0;
  for (const e of eventos) {
    if (e.tipo === 'ci.resultado') {
      const dados = e.dados ?? {};
      if (typeof dados.verde !== 'boolean') return null;
      // CI de homolog é da entrega (T4/T8), não do loop: não soma nem zera os vermelhos. Só `homolog` exato sai da conta.
      if (dados.alvo === 'homolog') continue;
      ciVermelhos = dados.verde ? 0 : ciVermelhos + 1;
    }
  }
  const r = estadosPorTask(plano.tasks.map((t) => t.id), eventos);
  if (!r.ok) return null;
  return { estados: r.estados, ciVermelhos, invalidas: r.invalidas };
}

/** Tasks do plano cuja reabertura gravada tem `origem`/`de` fora da lista, com a causa (REQ-HIG-1 D). Diário que não projeta ⇒ vazio (quem decide é `proximaAcao`). */
export function tasksInvalidas(plano       , eventos          )                      {
  const ord = ordenar(eventos);
  const proj = ord.ok ? projetar(plano, ord.eventos) : null;
  return proj === null ? new Map() : proj.invalidas;
}

const de = (estados                           , id        )                         => estados.get(id)?.estado;

/** Ancestrais de `id`, com guarda contra ciclo: `validarPlano` barra ciclo, a função pura não presume. */
function ancestrais(plano       , id        )           {
  const porId = new Map(plano.tasks.map((t) => [t.id, t]));
  const vistos = new Set        ();
  const pilha = [...(porId.get(id)?.deps ?? [])];
  while (pilha.length > 0) {
    const d = pilha.pop()          ;
    if (vistos.has(d)) continue;
    vistos.add(d);
    pilha.push(...(porId.get(d)?.deps ?? []));
  }
  return [...vistos];
}

function integravel(plano       , estados                           , id        )          {
  return de(estados, id) === 'aprovada' && ancestrais(plano, id).every((a) => de(estados, a) === 'integrada');
}

/**
 * Congelamento mínimo (REQ-EME-2, GM-15 T10 REQ-EME-3 A). `congeladas`: task NÃO integrada que tem o REQ de uma proposta aberta (casamento exato, não por
 * prefixo, e nunca pela `task` citada) ou arquivo em comum com o `--arquivos` dela (escopo da task: `arquivos` do plano + os das aprovadas); e, só quando a
 * proposta cita `task` ou `arquivos`, as dependentes não integradas dessas. Sem `--task` e sem `--arquivos` congela só as diretas pelo REQ. Task integrada
 * nunca congela nem propaga. `abertas`: TODAS as propostas abertas válidas por `seq`, citem ou não uma task. Diário que não ordena, ou que não projeta
 * estado, ⇒ todas as tasks congeladas (falha fechada).
 */
function congelamento(plano       , eventos          )                                                         {
  const todas = new Set(plano.tasks.map((t) => t.id));
  const ord = ordenar(eventos);
  if (!ord.ok) return { congeladas: todas, abertas: [] };
  const emendas = projetarEmendas(eventos);
  const abertas = emendas.abertas.map((p) => ({ seq: p.seq, req: p.req }));
  const proj = projetar(plano, ord.eventos);
  if (proj === null) return { congeladas: todas, abertas };
  const naoIntegrada = (id        )          => de(proj.estados, id) !== 'integrada';
  const diretas = new Set        ();
  const propagam = new Set        ();
  for (const p of emendas.abertas) {
    const arqs = new Set(p.arquivos);
    for (const t of plano.tasks) {
      if (!naoIntegrada(t.id)) continue;
      const porReq = Array.isArray(t.reqs) && t.reqs.includes(p.req);
      const porArquivo = arqs.size > 0 && escopoDaTask(plano, emendas, t.id).some((a) => arqs.has(a));
      if (!porReq && !porArquivo) continue;
      diretas.add(t.id);
      if (p.task !== undefined || arqs.size > 0) propagam.add(t.id);
    }
  }
  const congeladas = new Set(diretas);
  for (const t of plano.tasks) if (naoIntegrada(t.id) && ancestrais(plano, t.id).some((a) => propagam.has(a))) congeladas.add(t.id);
  return { congeladas, abertas };
}

/** Tasks que uma proposta aberta congela (REQ-EME-2): pelo REQ e pelas dependências. Puro. */
export function tasksCongeladas(plano       , eventos          )              {
  return congelamento(plano, eventos).congeladas;
}

/** Aprovada, não integrada, com a cadeia inteira de dependências integrada e fora do congelamento. */
export function podeIntegrar(plano       , eventos          , id        )          {
  const ord = ordenar(eventos);
  if (!ord.ok) return false;
  const proj = projetar(plano, ord.eventos);
  return proj !== null && integravel(plano, proj.estados, id) && !tasksCongeladas(plano, eventos).has(id);
}

/** A9 (r13): dependente só despacha com a dependência integrada; `abrir` parte da integração, sem o código dela não há o que implementar. */
function depLiberada(estados                           , dep        )          {
  return de(estados, dep) === 'integrada';
}

const EM_VOO                        = ['implementando', 'corrigindo', 'em_revisao'];
const SEM_RESTO                        = ['integrada', 'no_teto', 'adiada', 'cortada'];
/** REQ-ENT-2: terminal que sai do alvo, do `parar teto_rodadas`, do `nao_conseguiu` e do `concluir`. */
const FORA                        = ['adiada', 'cortada'];
const FORA_PERMITIDO                        = ['pendente', 'concluida', 'reprovada', 'aprovada', 'no_teto'];

                           
                
                                                                                                  
                                                                

/**
 * REQ-ENT-2: `adiar`/`cortar` `task` é permitido? Só de estado não integrado e sem agente em voo; e só se todo dependente direto já está fora.
 * Puro: a borda (`loop.mjs`) chama antes de gravar `task.fora` e lista os `dependentes` na recusa.
 */
export function foraPermitido(plano       , eventos          , task        )                {
  const ord = ordenar(eventos);
  const proj = ord.ok ? projetar(plano, ord.eventos) : null;
  if (!proj) return { ok: false, motivo: 'diario_invalido' };
  if (proj.invalidas.has(task)) return { ok: false, motivo: 'diario_invalido' };
  const e = proj.estados.get(task);
  if (e === undefined) return { ok: false, motivo: 'task_desconhecida' };
  if (!FORA_PERMITIDO.includes(e.estado)) return { ok: false, motivo: 'estado', estado: e.estado };
  const dependentes = plano.tasks.filter((t) => t.deps.includes(task) && !FORA.includes(de(proj.estados, t.id)              )).map((t) => t.id);
  return dependentes.length > 0 ? { ok: false, motivo: 'dependentes', dependentes } : { ok: true };
}

export function proximaAcao(planoInteiro       , eventos          , sinais                                      )           {
  // (1)
  const ord = ordenar(eventos);
  const proj = ord.ok ? projetar(planoInteiro, ord.eventos) : null;
  if (!proj) return { tipo: 'parar', motivo: 'diario_invalido' };
  // REQ-HIG-1 D: a task com reabertura de origem inválida não anda e não conta como feita; as demais seguem. Dependente dela nunca tem a dependência liberada.
  const { invalidas } = proj;
  const plano        = invalidas.size === 0 ? planoInteiro : { ...planoInteiro, tasks: planoInteiro.tasks.filter((t) => !invalidas.has(t.id)) };
  // (2)
  if (sinais.pausado) return { tipo: 'esperar', motivo: 'pausado' };
  // (3)
  if (sinais.tokens !== null && sinais.tetoTokens !== null && sinais.tokens >= sinais.tetoTokens) {
    return { tipo: 'parar', motivo: 'teto_tokens' };
  }
  // (4)
  if (proj.ciVermelhos >= 2) return { tipo: 'parar', motivo: 'ci_vermelho' };
  // (4b) Política `sob_demanda` com produção exigida não tem janela para subir. `politica` ausente = não avaliada: Stop e mod não a
  // passam e não podem parar por isto; só `loop.mjs proxima` a preenche (D6-1).
  if (plano.politica_entrega?.exige_prod === true && sinais.politica === 'sob_demanda') {
    return { tipo: 'parar', motivo: 'janela_ausente' };
  }
  // (4c) REQ-APR-2: pendência de aprendizado aberta vence tudo que vem depois (plano vazio, pouso, integração, despacho, concluir). A (1) já
  // barrou o diário fora da tabela: `pendenciasAprendizado` devolve `[]` nele e nunca é lido como "sem pendência".
  // GM-14 T27 (FIEL-2 b): a pendência `dono` (conversa) não trava despacho nem integração; só `pousar` e `concluir` a esperam, porque o diário
  // guarda hash e tamanho, nunca o texto, e depois do `/clear` ela só fecharia às cegas. O filtro mora aqui, nunca em `pendenciasAprendizado`.
  const pendencias = pendenciasAprendizado(planoInteiro, ord.eventos);
  const aprender = ()           => ({ tipo: 'aprender', pendencias });
  if (pendencias.some((p) => p.tipo !== 'dono')) return aprender();
  const donoAberto = pendencias.length > 0;
  // Plano vazio não é sucesso: nada foi entregue.
  if (planoInteiro.tasks.length === 0) return { tipo: 'parar', motivo: 'nao_conseguiu' };
  // REQ-ENT-2: o alvo é só o que não está fora; plano com tudo fora também não entregou nada.
  if (plano.tasks.length === 0) return { tipo: 'parar', motivo: 'nao_conseguiu', task: [...invalidas.keys()][0] }; // só sobrou task inválida (REQ-HIG-1 D)
  if (plano.tasks.every((t) => FORA.includes(de(proj.estados, t.id)              ))) return { tipo: 'parar', motivo: 'nao_conseguiu' };

  const { estados } = proj;
  const est = (id        )               => estados.get(id)                ;
  const ids = plano.tasks.map((t) => t.id);
  const { congeladas, abertas } = congelamento(planoInteiro, ord.eventos);
  // REQ-AUT-1: a retomada é de 1 vez por task, contada no diário inteiro; só a origem `retomada` gasta (o dono e a Sombra não).
  const retomadas = (id        )         => ord.eventos.filter((e) => e.tipo === 'task.reaberta' && e.dados?.task === id && e.dados?.origem === 'retomada').length;
  const orfa = ()                     => ids.find((id) => EM_VOO.includes(est(id).estado));
  const retomavel = ()                       => {
    const id = orfa();
    return id !== undefined && retomadas(id) === 0 ? { tipo: 'retomar', task: id } : undefined;
  };
  const livre = (id        )          => !congeladas.has(id);
  const capacidade = Math.max(0, sinais.slots - sinais.vivos);
  const despachar = (itens                                  )           => ({ tipo: 'despachar', itens: itens.slice(0, capacidade) });
  // Congelada não ganha revisor, correção, integração nem despacho novo; em voo ela termina (a tabela segue aceitando o evento).
  const revisores = ids.filter((id) => est(id).estado === 'concluida' && livre(id)).map((task) => ({ task, papel: 'revisor'          }));

  // (5) `percent` nulo não satisfaz a comparação. GM-14 T34 (FIEL-14 e, f): pouso pendente entra aqui como se o contexto estivesse acima de `x`, mas NÃO
  // despacha revisor (revoga, só para o pendente, o despacho da 2.0): o que está em voo termina e nada novo começa. O sinal vem de quem lê o diário com a
  // regra única de `pouso-pendente.ts`: `loop.mjs proxima`, o hook Stop (`stop-loop.mjs`) e, desde a T59 (emenda 67), o mod o passam: com contexto >= X e o pouso da fronteira feito, task `concluida` à espera do revisor NÃO vence o pouso (0 vivos ⇒ `pousar`, com vivos ⇒ `esperar`).
  const pendente = sinais.pousoPendente === true;
  if (pendente || (sinais.percent !== null && sinais.percent >= sinais.x)) {
    if (!pendente && revisores.length > 0 && capacidade >= 1) return despachar(revisores);
    if (pendente && sinais.vivos > 0) return { tipo: 'esperar', motivo: 'pouso_pendente' };
    if (sinais.vivos > 0) return { tipo: 'esperar', motivo: 'agentes vivos antes do pouso' };
    // (5b) Sem agente vivo, task em voo não é fronteira (REQ-POU-1 exige `review.veredito`): o agente morreu. Não pousa.
    const emVoo = orfa();
    if (emVoo !== undefined) return retomavel() ?? { tipo: 'parar', motivo: 'nao_conseguiu', task: emVoo };
    // (5d) Pousar só se resta trabalho que não espera um teto: task fora de {integrada, no_teto} e sem ancestral em `no_teto`.
    // Sem resto, o loop conclui (8) ou para no teto (9) antes de qualquer pouso.
    if (plano.tasks.some((t) => !SEM_RESTO.includes(est(t.id).estado) && !ancestrais(plano, t.id).some((a) => de(estados, a) === 'no_teto'))) {
      if (!sinais.podePousar) return { tipo: 'parar', motivo: 'sem_pouso' };
      return donoAberto ? aprender() : { tipo: 'pousar' };
    }
  }

  // (6)
  const integraveis = ids.filter((id) => livre(id) && integravel(plano, estados, id));
  if (integraveis.length > 0) return { tipo: 'integrar', tasks: integraveis };

  // (7)
  const correcoes = ids
    .filter((id) => livre(id) && est(id).estado === 'reprovada' && est(id).rodada === 1)
    .map((task) => ({ task, papel: 'correcao'          }));
  const novas = plano.tasks
    .filter((t) => livre(t.id) && est(t.id).estado === 'pendente' && t.deps.every((d) => depLiberada(estados, d)))
    .map((t) => ({ task: t.id, papel: 'implementador'          }));
  const itens = [...correcoes, ...revisores, ...novas];
  if (itens.length > 0) {
    return capacidade >= 1 ? despachar(itens) : { tipo: 'esperar', motivo: 'sem slot livre' };
  }

  // (8) Tudo integrado: com proposta aberta a spec está em disputa, então nem `concluir` nem entrega (REQ-EME-2).
  const esperaEmenda = ()           => ({ tipo: 'esperar', motivo: 'emenda', propostas: abertas });
  if (ids.every((id) => est(id).estado === 'integrada' || FORA.includes(est(id).estado))) {
    if (abertas.length > 0) return esperaEmenda();
    // Com task inválida o resto está pronto, mas a entrega não: nunca `concluir`; cai no (9), que espera agente vivo e só para quando nada mais é acionável.
    if (invalidas.size === 0) return donoAberto ? aprender() : { tipo: 'concluir' };
  }

  // (9)
  if (sinais.vivos > 0) return { tipo: 'esperar', motivo: 'agentes vivos' };
  // REQ-AUT-1: a task que o agente deixou morta é reaberta (1 vez) antes de qualquer parar, inclusive o do teto de outra.
  const reabrir = retomavel();
  if (reabrir !== undefined) return reabrir;
  const noLimite = ids.find((id) => est(id).estado === 'no_teto');
  if (noLimite !== undefined) return { tipo: 'parar', motivo: 'teto_rodadas', task: noLimite };
  // Task em voo sem agente vivo morreu, congelada ou não: a emenda não a explica.
  const morta = orfa();
  if (morta !== undefined) return { tipo: 'parar', motivo: 'nao_conseguiu', task: morta };
  // Só espera o dono quando TUDO que falta está congelado; uma task fora do congelamento que ninguém despacha está presa.
  const faltam = ids.filter((id) => est(id).estado !== 'integrada' && !FORA.includes(est(id).estado));
  // REQ-HIG-1 D: nada mais a fazer além da task inválida (que não anda sozinha): para nomeando a task. Só aqui, depois de espera, retomada, teto e emenda.
  if (faltam.length === 0 && invalidas.size > 0) return { tipo: 'parar', motivo: 'nao_conseguiu', task: [...invalidas.keys()][0] };
  if (faltam.every((id) => congeladas.has(id))) return esperaEmenda();
  // O que resta só espera a task inválida (dependentes dela): a causa é ela, não o dependente.
  if (invalidas.size > 0) return { tipo: 'parar', motivo: 'nao_conseguiu', task: [...invalidas.keys()][0] };
  // Sem agente vivo e sem próxima ação (ex.: task iniciada cujo agente morreu): para, nunca em silêncio.
  return { tipo: 'parar', motivo: 'nao_conseguiu', task: faltam.find(livre)           };
}

// ───────────────────────────────────────────────────────────── GM-15 T36 (REQ-AUT-1, emendas 22 e 24): progresso medido e freios da liberação da Sombra

                                                                                                               

/** Janela de "mesmo trecho" (emenda 24 m.1): o mesmo arquivo a até 10 linhas de distância. */
export const TRECHO_LINHAS = 10;
/** Orçamento (emenda 24 m.2): tempo ou tokens da task acima de 3× a mediana das integradas da entrega. */
export const FATOR_ORCAMENTO = 3;
/** Liberações da Sombra com `abordagem_nova` que esgotam a task (emenda 22 l.3). */
export const ABORDAGENS_MAX = 2;

const LOCAL_RE = /([A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)(?::(\d+))?/;

/**
 * Os achados BLOCKER/MAJOR de um `review-r<n>.md` (o revisor grava um por linha, `agents/gabarito-revisor.md`): a 1ª severidade da linha e o 1º
 * `arquivo[:linha]` (nome com extensão) dela; sem arquivo ⇒ `arquivo: null`. MINOR e linha sem severidade não entram. Total: nunca lança.
 */
export function achadosDeReview(texto        )                   {
  const saida                   = [];
  if (typeof texto !== 'string') return saida;
  for (const l of texto.split(/\r?\n/)) {
    const sev = /\b(BLOCKER|MAJOR)\b/.exec(l);
    if (sev === null) continue;
    const loc = LOCAL_RE.exec(l.slice(sev.index + sev[0].length));
    saida.push({ severidade: sev[1]                       , arquivo: loc === null ? null : loc[1], linha: loc === null || loc[2] === undefined ? null : Number(loc[2]) });
  }
  return saida;
}

                                                                            

/**
 * A régua ÚNICA do progresso (emenda 24 m.1), pura sobre os textos dos reviews do ÚLTIMO e do ciclo ANTERIOR: progresso = nenhum BLOCKER/MAJOR do último com o
 * mesmo arquivo e trecho (±`TRECHO_LINHAS` linhas; achado com arquivo e sem linha casa o arquivo todo) de um do anterior E total BLOCKER+MAJOR não maior.
 * Review ausente, vazio ou sem nenhum BLOCKER/MAJOR legível ⇒ `progresso: null` com motivo (conta como sem progresso: falha não vira sucesso).
 */
export function progressoMedido(ultimo                           , anterior                           )                  {
  const quem = (t                           , nome        )                            => {
    if (typeof t !== 'string' || t.trim() === '') return `review do ${nome} ciclo ausente ou vazio`;
    const a = achadosDeReview(t);
    return a.length === 0 ? `review do ${nome} ciclo sem nenhum BLOCKER/MAJOR legível` : a;
  };
  const u = quem(ultimo, 'último');
  if (typeof u === 'string') return { progresso: null, motivo: u };
  const a = quem(anterior, 'anterior');
  if (typeof a === 'string') return { progresso: null, motivo: a };
  for (const x of u) {
    if (x.arquivo === null) continue;
    const igual = a.find((y) => y.arquivo === x.arquivo && (x.linha === null || y.linha === null || Math.abs(x.linha - y.linha) <= TRECHO_LINHAS));
    if (igual !== undefined) return { progresso: false, motivo: `o achado ${x.arquivo}${x.linha === null ? '' : `:${x.linha}`} reapareceu do ciclo anterior (${igual.arquivo}${igual.linha === null ? '' : `:${igual.linha}`})` };
  }
  if (u.length > a.length) return { progresso: false, motivo: `${u.length} BLOCKER/MAJOR no último ciclo contra ${a.length} no anterior` };
  return { progresso: true, motivo: `${u.length} BLOCKER/MAJOR no último ciclo contra ${a.length} no anterior, nenhum no mesmo trecho` };
}

const medianaDe = (v          )                => {
  if (v.length === 0) return null;
  const o = [...v].sort((x, y) => x - y);
  const m = o.length >> 1;
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/** Tempo medido da task (ms): soma, em ordem, de cada `task.iniciada` até o 1º `task.concluida` (implementador e correção) ou `review.veredito` (revisor) seguinte; início sem fim não conta. */
function tempoDaTask(eventos          , task        )         {
  let total = 0;
  let aberto                                       = null;
  for (const e of eventos) {
    if (e.dados?.task !== task || !TIPOS_DE_TASK.includes(e.tipo)) continue;
    if (e.tipo === 'task.iniciada') {
      aberto = { ms: Date.parse(e.ts), fecha: e.dados?.papel === 'revisor' ? 'review.veredito' : 'task.concluida' };
    } else if (aberto !== null && e.tipo === aberto.fecha) {
      const d = Date.parse(e.ts) - aberto.ms;
      if (Number.isFinite(d) && d > 0) total += d;
      aberto = null;
    } else if (e.tipo === 'task.reaberta') aberto = null;
  }
  return total;
}

/** Tokens medidos da task: entrada + saída + criação de cache dos `custo.medicao` que citam `task` (leitura de cache não conta, a régua do teto de tokens); nenhum ⇒ `null`. */
function tokensDaTask(eventos          , task        )                {
  let total                = null;
  for (const e of eventos) {
    if (e.tipo !== 'custo.medicao' || e.dados?.task !== task) continue;
    let soma = 0;
    for (const c of ['input_tokens', 'output_tokens', 'cache_creation']) {
      const n = e.dados?.[c];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) soma += n;
    }
    total = (total ?? 0) + soma;
  }
  return total;
}

                                                                                                          

/**
 * Os freios da liberação pela Sombra, a regra ÚNICA do `liberar --origem sombra`, do `proxima` e do lote do dono (emendas 22 l.3 e 24 m.2), puros sobre o diário:
 * (1) `abordagens_esgotadas`: `ABORDAGENS_MAX` liberações da Sombra desta task com `abordagem_nova` (texto não vazio); as do dono não contam nem zeram;
 * (2) `orcamento_estourado`: tempo da task OU tokens medidos acima de `FATOR_ORCAMENTO`× a mediana das tasks integradas do plano (só as com medida > 0
 * entram). `semMediana`: nenhuma mediana (nem de tempo nem de tokens) ⇒ sem freio por orçamento e o `proxima` avisa. Diário que não ordena ⇒ sem freio.
 */
export function freioDaLiberacao(plano       , eventos          , task        )                                                          {
  const ord = Array.isArray(eventos) ? ordenar(eventos) : { ok: false          };
  if (!ord.ok) return { freio: null, semMediana: false };
  const evs = ord.eventos;
  const abordagens = evs.filter((e) => e.tipo === 'task.reaberta' && e.dados?.task === task && e.dados?.origem === 'sombra' && typeof e.dados?.abordagem_nova === 'string' && e.dados.abordagem_nova.trim() !== '').length;
  const integradas = (plano?.tasks ?? []).map((t) => t.id).filter((id) => {
    const r = estadoDe(evs.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === id));
    return !('invalido' in r) && r.estado === 'integrada';
  });
  const medT = medianaDe(integradas.map((id) => tempoDaTask(evs, id)).filter((n) => n > 0));
  const medK = medianaDe(integradas.map((id) => tokensDaTask(evs, id)).filter((n)              => n !== null && n > 0));
  const semMediana = medT === null && medK === null;
  if (abordagens >= ABORDAGENS_MAX) {
    return { freio: { motivo: 'abordagens_esgotadas', resumo: `${abordagens} abordagens novas da Sombra e a task voltou ao teto sem convergir` }, semMediana };
  }
  const min = (ms        )         => Math.round((ms / 60_000) * 10) / 10;
  const tempo = tempoDaTask(evs, task);
  if (medT !== null && tempo > FATOR_ORCAMENTO * medT) {
    return { freio: { motivo: 'orcamento_estourado', resumo: `gastou ${min(tempo)} min contra a mediana de ${min(medT)} min das integradas (limite ${FATOR_ORCAMENTO}×)` }, semMediana };
  }
  const tokens = tokensDaTask(evs, task);
  if (medK !== null && tokens !== null && tokens > FATOR_ORCAMENTO * medK) {
    return { freio: { motivo: 'orcamento_estourado', resumo: `gastou ${tokens} tokens contra a mediana de ${medK} das integradas (limite ${FATOR_ORCAMENTO}×)` }, semMediana };
  }
  return { freio: null, semMediana };
}

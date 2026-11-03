/**
 * Núcleo puro do loop (REQ-LOOP-2): mesma entrada, mesma saída. Sem E/S e sem relógio.
 * A precedência de `proximaAcao` é o contrato da Task 2 do plano da E2; cada cláusula traz o número dela.
 */

                                                                         

                                                                                         

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const PAPEIS                     = ['implementador', 'revisor', 'correcao'];
const TIPOS_DE_TASK                    = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada'];

/** Comparação por código, nunca por localidade: a ordem não pode depender da máquina. */
const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

/** Ordem por `seq` dentro da sessão e `(ts, sessao)` entre sessões. Fora de ordem não se adivinha. */
export function ordenar(eventos          )                                                  {
  const ultimo = new Map                                     ();
  const comMs                              = [];
  for (const e of eventos) {
    if (typeof e?.sessao !== 'string' || !Number.isInteger(e.seq) || typeof e.ts !== 'string' || !TS_RE.test(e.ts)) {
      return { ok: false };
    }
    const ms = Date.parse(e.ts);
    if (Number.isNaN(ms)) return { ok: false };
    const anterior = ultimo.get(e.sessao);
    if (anterior && (e.seq <= anterior.seq || ms < anterior.ms)) return { ok: false };
    ultimo.set(e.sessao, { seq: e.seq, ms });
    comMs.push({ e, ms });
  }
  comMs.sort((a, b) => a.ms - b.ms || cmp(a.e.sessao, b.e.sessao) || a.e.seq - b.e.seq);
  return { ok: true, eventos: comMs.map((x) => x.e) };
}

                                                                                    
               
                    
                     
                       
                     
                      
                            
  

const contagem = (v         )          => Number.isInteger(v) && (v          ) >= 0;

/** Estado por task, ou `null` se algum evento de task sai do plano ou do contrato de `dados`. */
function projetar(plano       , eventos          )                                                               {
  const estados = new Map                ();
  for (const t of plano.tasks) {
    estados.set(t.id, { iniciada: false, integrada: false, concluidaPos: -1, revisorPos: -1, correcaoPos: -1, veredito: null });
  }
  let ciVermelhos = 0;
  for (const [pos, e] of eventos.entries()) {
    const dados = e.dados ?? {};
    if (e.tipo === 'ci.resultado') {
      if (typeof dados.verde !== 'boolean') return null;
      ciVermelhos = dados.verde ? 0 : ciVermelhos + 1;
      continue;
    }
    if (!TIPOS_DE_TASK.includes(e.tipo)) continue;
    const est = estados.get(dados.task          );
    if (!est) return null;
    if (e.tipo === 'task.iniciada') {
      if (!PAPEIS.includes(dados.papel)) return null;
      est.iniciada = true;
      if (dados.papel === 'revisor') est.revisorPos = pos;
      if (dados.papel === 'correcao') est.correcaoPos = pos;
    } else if (e.tipo === 'task.concluida') {
      est.iniciada = true;
      est.concluidaPos = pos;
    } else if (e.tipo === 'task.integrada') {
      est.integrada = true;
    } else {
      const { veredito, rodada, major, blocker } = dados;
      if (veredito !== 'APROVADO' && veredito !== 'REPROVADO') return null;
      if (!contagem(rodada) || (rodada          ) < 1 || !contagem(major) || !contagem(blocker)) return null;
      est.iniciada = true;
      // Vale o da maior rodada; na mesma rodada, o mais recente.
      if (!est.veredito || (rodada          ) >= est.veredito.rodada) {
        est.veredito = { aprovado: veredito === 'APROVADO', rodada: rodada          , achados: (major          ) + (blocker          ), pos };
      }
    }
  }
  return { estados, ciVermelhos };
}

/** Commit posterior ao veredito válido (ou nenhum veredito): o que está na branch ainda não foi revisto. */
const semRevisao = (e        )          => e.concluidaPos >= 0 && (!e.veredito || e.concluidaPos > e.veredito.pos);
const aprovada = (e        )          => !semRevisao(e) && e.veredito?.aprovado === true;
const reprovadaSemCommitNovo = (e        )          => !semRevisao(e) && e.veredito?.aprovado === false;
const noTeto = (e        )          =>
  !e.integrada && reprovadaSemCommitNovo(e) && e.veredito .rodada >= 2 && e.veredito .achados > 0;

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

function integravel(plano       , estados                     , id        )          {
  const e = estados.get(id);
  if (!e || e.integrada || !aprovada(e)) return false;
  return ancestrais(plano, id).every((a) => estados.get(a)?.integrada === true);
}

/** Aprovada, não integrada e com a cadeia inteira de dependências já integrada. */
export function podeIntegrar(plano       , eventos          , id        )          {
  const ord = ordenar(eventos);
  if (!ord.ok) return false;
  const proj = projetar(plano, ord.eventos);
  return proj !== null && integravel(plano, proj.estados, id);
}

/** A9: dep libera o dependente se integrada, se no teto, ou se aprovada e presa por um teto acima dela. */
function depLiberada(plano       , estados                     , dep        )          {
  const e = estados.get(dep);
  if (!e) return false;
  if (e.integrada || noTeto(e)) return true;
  return aprovada(e) && ancestrais(plano, dep).some((a) => noTeto(estados.get(a)          ));
}

const paraRevisor = (e        )          => !e.integrada && semRevisao(e) && e.revisorPos < e.concluidaPos;

export function proximaAcao(plano       , eventos          , sinais        )           {
  // (1)
  const ord = ordenar(eventos);
  const proj = ord.ok ? projetar(plano, ord.eventos) : null;
  if (!proj) return { tipo: 'parar', motivo: 'diario_invalido' };
  // (2)
  if (sinais.pausado) return { tipo: 'esperar', motivo: 'pausado' };
  // (3)
  if (sinais.tokens !== null && sinais.tetoTokens !== null && sinais.tokens >= sinais.tetoTokens) {
    return { tipo: 'parar', motivo: 'teto_tokens' };
  }
  // (4)
  if (proj.ciVermelhos >= 2) return { tipo: 'parar', motivo: 'ci_vermelho' };
  // Plano vazio não é sucesso: nada foi entregue.
  if (plano.tasks.length === 0) return { tipo: 'parar', motivo: 'nao_conseguiu' };

  const { estados } = proj;
  const est = (id        )         => estados.get(id)          ;
  const ids = plano.tasks.map((t) => t.id);
  const capacidade = Math.max(0, sinais.slots - sinais.vivos);
  const despachar = (itens                                  )           => ({ tipo: 'despachar', itens: itens.slice(0, capacidade) });
  const revisores = ids.filter((id) => paraRevisor(est(id))).map((task) => ({ task, papel: 'revisor'          }));

  // (5) `percent` nulo não satisfaz a comparação.
  if (sinais.percent !== null && sinais.percent >= sinais.x) {
    if (revisores.length > 0 && capacidade >= 1) return despachar(revisores);
    if (sinais.vivos > 0) return { tipo: 'esperar', motivo: 'agentes vivos antes do pouso' };
    return sinais.podePousar ? { tipo: 'pousar' } : { tipo: 'parar', motivo: 'sem_pouso' };
  }

  // (6)
  const integraveis = ids.filter((id) => integravel(plano, estados, id));
  if (integraveis.length > 0) return { tipo: 'integrar', tasks: integraveis };

  // (7)
  const correcoes = ids
    .filter((id) => {
      const e = est(id);
      return !e.integrada && reprovadaSemCommitNovo(e) && e.veredito .rodada === 1 && e.correcaoPos < e.veredito .pos;
    })
    .map((task) => ({ task, papel: 'correcao'          }));
  const novas = plano.tasks
    .filter((t) => !est(t.id).iniciada && t.deps.every((d) => depLiberada(plano, estados, d)))
    .map((t) => ({ task: t.id, papel: 'implementador'          }));
  const itens = [...correcoes, ...revisores, ...novas];
  if (itens.length > 0) {
    return capacidade >= 1 ? despachar(itens) : { tipo: 'esperar', motivo: 'sem slot livre' };
  }

  // (8)
  if (ids.every((id) => est(id).integrada)) return { tipo: 'concluir' };

  // (9)
  if (sinais.vivos > 0) return { tipo: 'esperar', motivo: 'agentes vivos' };
  const noLimite = ids.find((id) => noTeto(est(id)));
  if (noLimite !== undefined) return { tipo: 'parar', motivo: 'teto_rodadas', task: noLimite };
  // Sem agente vivo e sem próxima ação (ex.: task iniciada cujo agente morreu): para, nunca em silêncio.
  return { tipo: 'parar', motivo: 'nao_conseguiu', task: ids.find((id) => !est(id).integrada)           };
}

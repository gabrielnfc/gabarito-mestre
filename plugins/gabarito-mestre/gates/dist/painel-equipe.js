/**
 * Equipe do painel (E4, T3): pacotes de nomes, sorteio, nome por papel, uso do transcript e a projeção `equipe` do `EstadoPainel`.
 * Puro: sem `fs`, `process`, `Date.now()` nem `node:*` (o mod importa o `dist/`, que não tem Node; ver `loop.ts`). Por isso o sorteio usa FNV-1a
 * em TS e este módulo não importa `sombra.ts` (que traz `node:crypto`): as decisões vigentes da Sombra vêm de `projetarDecisoes` em
 * `diario-puro.ts` (a mesma de `sombra.ts`), e `tokensDe` vem de `pouso.ts` (puro, o mod já o carrega).
 */

import { projetarDecisoes } from './diario-puro.js';
                                                      
import { formaInvalida } from './formas.js';
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.js';
                                            
import { dataCivil } from './painel-hora.js';
import { colunas, limpar } from './painel-largura.js';
import { tokensDe } from './pouso.js';
                                                                                                                                               

const DESCRICAO_RE = /^(\S+) (implementador|revisor|correcao)$/;

/**
 * Liga o agente vivo à task pela `description` do `Agent` (D3), que é `"<task> <papel>"` do item de `loop.mjs proxima`.
 * Nunca por aproximação: depois de `trim`, só o padrão exato, com task do plano e papel conhecido; qualquer outra coisa é `null`
 * (o render escreve `sem task`). `description` que não é texto também é `null`, sem lançar.
 */
export function casarAgente(description        , plano       )                                        {
  if (typeof description !== 'string') return null;
  const m = DESCRICAO_RE.exec(description.trim());
  if (m === null) return null;
  const tasks = plano !== null && typeof plano === 'object' && Array.isArray(plano.tasks) ? plano.tasks : [];
  if (!tasks.some((t) => t.id === m[1])) return null;
  return { task: m[1], papel: m[2]          };
}

// ---------- pacote de nomes ----------

/** Caixa alta, largura 1 por construção e ≤ 10 colunas: não depende de `colunas` (T4). */
const NOME_RE = /^[A-Z0-9ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ'-]{1,10}$/u;
const NOME_MAX_COLUNAS = 20;

const ehObjeto = (v         )                               => v !== null && typeof v === 'object' && !Array.isArray(v);
const nomeOk = (v         )              => typeof v === 'string' && NOME_RE.test(v);

/**
 * Valida um pacote de nomes (REQ-PNL-6). `nomes`, `lider` e `sabio` seguem `NOME_RE`; `nomes` tem ≥ 8, sem repetidos e sem `lider`/`sabio`;
 * `lider ≠ sabio`; `nome` (rótulo exibido) é texto de 1 a 20 colunas. Devolve cópia, sem campos extras. Nunca lança.
 */
export function validarPacote(bruto         )                                                                  {
  const erro = (e        )                              => ({ ok: false, erro: e });
  if (!ehObjeto(bruto)) return erro('pacote não é objeto');
  const { nome, lider, sabio, nomes } = bruto;
  if (typeof nome !== 'string' || nome.trim() === '') return erro('`nome` ausente ou vazio');
  if (limpar(nome) !== nome) return erro('`nome` com caractere de controle');
  const cols = colunas(nome); // a mesma medida do render (`painel-largura.ts`)
  if (cols > NOME_MAX_COLUNAS) return erro(`\`nome\` com ${cols} colunas, máximo ${NOME_MAX_COLUNAS}`);
  if (!nomeOk(lider)) return erro('`lider` ausente ou fora do padrão (caixa alta, até 10 colunas)');
  if (!nomeOk(sabio)) return erro('`sabio` ausente ou fora do padrão (caixa alta, até 10 colunas)');
  if (lider === sabio) return erro('`lider` e `sabio` são o mesmo nome');
  if (!Array.isArray(nomes)) return erro('`nomes` não é lista');
  if (nomes.length < 8) return erro(`\`nomes\` com ${nomes.length} itens, mínimo 8`);
  const vistos = new Set        ();
  for (let i = 0; i < nomes.length; i++) {
    const n          = nomes[i];
    if (!nomeOk(n)) return erro(`\`nomes\`[${i}] fora do padrão (caixa alta, até 10 colunas)`);
    if (vistos.has(n)) return erro(`\`nomes\`[${i}] repetido: ${n}`);
    if (n === lider || n === sabio) return erro(`\`nomes\`[${i}] repete o líder ou o sábio: ${n}`);
    vistos.add(n);
  }
  return { ok: true, pacote: { nome, lider, sabio, nomes: [...(nomes            )] } };
}

/** FNV-1a de 32 bits sobre as unidades UTF-16: determinístico, sem `node:crypto`. */
function fnv1a32(texto        )         {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Sorteia o pacote de nomes da sessão: `fnv1a32(sessionId) % candidatos.length`, candidatos = únicos de `nomes` ordenados por código, sem
 * `anterior`. Só o anterior existe ⇒ ele mesmo (repetir é o único jeito). `nomes` vazio ⇒ `'terra-media'`. `sessionId` que não é texto ⇒ hash de `''`.
 */
export function sortearPacote(sessionId        , nomes          , anterior               )         {
  const unicos = [...new Set((Array.isArray(nomes) ? nomes : []).filter((n)              => typeof n === 'string'))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (unicos.length === 0) return 'terra-media';
  const candidatos = unicos.filter((n) => n !== anterior);
  const lista = candidatos.length > 0 ? candidatos : unicos;
  return lista[fnv1a32(typeof sessionId === 'string' ? sessionId : '') % lista.length];
}

// ---------- nome por papel ----------

const PAPEIS                    = ['implementador', 'revisor', 'correcao'];
/** Chave do par nomeado: implementador e correção dividem `<task>:trabalho`; o revisor é `<task>:revisor`. */
export const chaveDoPar = (task        , papel        )         => `${task}:${papel === 'revisor' ? 'revisor' : 'trabalho'}`;
const ordemSegura = (eventos         )                  => {
  if (!Array.isArray(eventos)) return null;
  const o = ordenar(eventos            );
  return o.ok ? o.eventos : null;
};

/**
 * Nome de cada par: `${task}:trabalho` (implementador e correção) e `${task}:revisor`. O par recebe `nomes[i % n]`, com `i` = ordem do 1º
 * `task.iniciada` do par no diário ordenado; evento novo no fim nunca troca nome antigo, e `task.reaberta` mantém o par. Diário que não ordena
 * ou pacote sem nomes ⇒ mapa vazio (todo nome fica `null`). Limite declarado: evento de outra sessão com `ts` anterior reordena (`ordenar`
 * intercala por `ts`) e pode trocar nomes.
 */
export function nomesPorPapel(eventos          , pacote             )                      {
  const mapa = new Map                ();
  const ord = ordemSegura(eventos);
  const nomes = pacote !== null && typeof pacote === 'object' && Array.isArray(pacote.nomes) ? pacote.nomes : [];
  if (ord === null || nomes.length === 0) return mapa;
  for (const e of ord) {
    if (e.tipo !== 'task.iniciada' || !ehObjeto(e.dados)) continue;
    const { task, papel } = e.dados;
    if (typeof task !== 'string' || task === '' || typeof papel !== 'string' || !PAPEIS.includes(papel)) continue;
    const chave = chaveDoPar(task, papel);
    if (!mapa.has(chave)) mapa.set(chave, nomes[mapa.size % nomes.length]);
  }
  return mapa;
}

// ---------- uso do transcript ----------

const CAMPO_VALIDO = (v         )              => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Uso de um agente a partir das linhas do transcript. Linha que não é texto, sem `"usage"`, JSON inválido (inclui a linha partida da cauda),
 * `message.model` começando com `<` (`<synthetic>`), `usage` que não é objeto ou com campo presente e que não é número finito ≥ 0: ignorada.
 * `input_tokens` é obrigatório; `output` e os dois de cache ausentes valem 0. `contexto` = `input + cache_read + cache_creation` da última linha
 * aceita; `tok` = Σ por `message.id` (maior valor por campo) de `input + output + cache_creation`, sem `cache_read` (mesma conta de `tokensDe`);
 * linha sem `message.id` entra em `contexto`, não em `tok`; `modelo` = último `message.model` aceito. Nenhuma linha aceita ⇒ `null`.
 */
export function usoDoTranscript(linhas          )                   {
  if (!Array.isArray(linhas)) return null;
  let contexto                = null;
  let modelo                = null;
  const porId = new Map                                                            ();
  for (const l of linhas) {
    if (typeof l !== 'string' || !l.includes('"usage"')) continue;
    let o         ;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const m = ehObjeto(o) ? o.message : undefined;
    if (!ehObjeto(m)) continue;
    const modeloDaLinha = m.model;
    if (typeof modeloDaLinha === 'string' && modeloDaLinha.startsWith('<')) continue;
    const u = m.usage;
    if (!ehObjeto(u)) continue;
    const lido                         = {};
    let torto = false;
    for (const campo of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
      const v = u[campo];
      if (v === undefined) {
        if (campo === 'input_tokens') torto = true; // sem entrada não há contexto
        lido[campo] = 0;
      } else if (CAMPO_VALIDO(v)) {
        lido[campo] = v;
      } else {
        torto = true;
      }
    }
    if (torto) continue;
    contexto = lido.input_tokens + lido.cache_read_input_tokens + lido.cache_creation_input_tokens;
    if (typeof modeloDaLinha === 'string' && modeloDaLinha !== '') modelo = modeloDaLinha;
    const id = m.id;
    if (typeof id === 'string' && id !== '') {
      const a = porId.get(id) ?? { input: 0, output: 0, criacao: 0 };
      a.input = Math.max(a.input, lido.input_tokens);
      a.output = Math.max(a.output, lido.output_tokens);
      a.criacao = Math.max(a.criacao, lido.cache_creation_input_tokens);
      porId.set(id, a);
    }
  }
  if (contexto === null) return null;
  let tok = 0;
  for (const a of porId.values()) tok += a.input + a.output + a.criacao;
  return { contexto, tok, modelo };
}

// ---------- Sombra (decisões vigentes) ----------

const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

/** Mais recente por `(ts, sessao, seq)`, a ordem de `diario.ts` e do bloco da Sombra. */
function maisRecente(eventos                 )                       {
  let melhor                       = null;
  for (const e of eventos) {
    if (melhor === null) { melhor = e; continue; }
    const d = Date.parse(e.ts) - Date.parse(melhor.ts) || cmp(e.sessao, melhor.sessao) || e.seq - melhor.seq;
    if (d > 0) melhor = e;
  }
  return melhor;
}

// ---------- projeção ----------

const ENCERRADO                      = new Set(['idle', 'completed', 'failed', 'killed']);
const ORDEM_COR                     = ['claude', 'suggestion', 'autoAccept', 'ide', 'remember'];
const FAMILIA_RE = /haiku|sonnet|opus|fable/;
const PAPEIS_ORDEM                   = ['implementador', 'correcao', 'revisor'];
const PAPEL_DO_ESTADO                                     = { implementando: 'implementador', corrigindo: 'correcao', em_revisao: 'revisor' };

const familia = (modelo         )                => {
  if (typeof modelo !== 'string') return null;
  const m = FAMILIA_RE.exec(modelo);
  return m === null ? null : m[0];
};

/** Vivo = `status` fora de `{idle, completed, failed, killed}`; dado desconhecido (inclusive não texto) conta como vivo (`vivosDe`). */
const vivoDe = (a         )          => {
  const s = ehObjeto(a) ? a.status : undefined;
  return !(typeof s === 'string' && ENCERRADO.has(s));
};

/** `tok` ausente ou corrompido é `null` (nunca 0: zero é medida, e ausente não é medida); o `contexto` válido segue valendo. */
                                                                               
const usoValido = (u         )                 =>
  ehObjeto(u) && CAMPO_VALIDO(u.contexto) ? { contexto: u.contexto, tok: CAMPO_VALIDO(u.tok) ? u.tok : null, modelo: typeof u.modelo === 'string' ? u.modelo : null } : null;

function estadosDasTasks(plano       , ord                 )                          {
  const estados = new Map                    ();
  if (ord === null) return estados;
  for (const t of plano.tasks) {
    const fila = ord.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && ehObjeto(e.dados) && e.dados.task === t.id);
    const r = estadoDe(fila);
    if (!('invalido' in r)) estados.set(t.id, r.estado);
  }
  return estados;
}

function mutacoesDeHoje(ord                 , entrada               )                                           {
  if (ord === null) return null;
  const hoje = dataCivil(entrada.agoraMs, entrada.fuso);
  let achou                                           = null;
  for (const e of ord) {
    if (e.tipo !== 'task.integrada' || formaInvalida(e.tipo, e.dados) !== null || !ehObjeto(e.dados) || !ehObjeto(e.dados.mutacoes)) continue;
    if (dataCivil(Date.parse(e.ts), entrada.fuso) !== hoje) continue;
    const { total, mortas } = e.dados.mutacoes                                     ;
    if (total === 0) continue; // o gate não mediu nada: ausente ≠ zero (Global Constraint)
    achou = { total: (achou?.total ?? 0) + total, mortas: (achou?.mortas ?? 0) + mortas };
  }
  return achou;
}

/**
 * Projeta `equipe`: líder, agentes (vivos casados, vivos sem task e `◌ sem agente`), revisores aguardando e Sombra (sempre presente).
 * `entrada.agentes === null` (CLI sem mod) ⇒ nenhuma linha de agente e nenhum `◌`; `[]` ⇒ `◌ sem agente` para toda task em voo.
 * Diário que não ordena ⇒ nomes `null`, sem estado de task e sem `◌`: quem sinaliza é o PAROU (T2).
 */
export function projetarEquipe(plano       , eventos                 , entrada               )                         {
  const todos           = Array.isArray(eventos) ? eventos : [];
  const ord = ordemSegura(todos);
  const nomes = nomesPorPapel(todos, entrada.pacote);
  const estados = estadosDasTasks(plano, ord);
  const base = ord ?? todos.filter(ehObjeto); // lixo na lista (null) não derruba a projeção

  const iniciada = (task        , papel       )                => {
    const chave = chaveDoPar(task, papel);
    let achado                = null;
    for (const e of ord ?? []) {
      if (e.tipo === 'task.iniciada' && ehObjeto(e.dados) && e.dados.task === task && typeof e.dados.papel === 'string' && PAPEIS.includes(e.dados.papel) && chaveDoPar(task, e.dados.papel) === chave) achado = e;
    }
    return achado;
  };
  const desdeS = (ini               )                => {
    if (ini === null) return null;
    const ms = Date.parse(ini.ts);
    return Number.isFinite(ms) ? Math.max(0, Math.floor((entrada.agoraMs - ms) / 1000)) : null;
  };
  const corDe = (nome               )          => {
    const i = nome === null ? -1 : entrada.pacote.nomes.indexOf(nome);
    return i < 0 ? 'inactive' : ORDEM_COR[i % ORDEM_COR.length];
  };
  const janela = entrada.contexto?.window;
  const pctDe = (uso                )                =>
    uso !== null && typeof uso.modelo === 'string' && typeof entrada.modeloSessao === 'string' && uso.modelo === entrada.modeloSessao
      && typeof janela === 'number' && Number.isFinite(janela) && janela > 0
      ? Math.round((uso.contexto / janela) * 100)
      : null;

  // líder
  const medicoes = base.filter((e) => e.tipo === 'custo.medicao');
  const doOrquestrador = tokensDe(medicoes.filter((e) => e.agente === 'orquestrador'));
  const lider                                  = {
    nome: entrada.pacote.lider, modelo: familia(entrada.modeloSessao), ctx: entrada.contexto.percent, x: entrada.x,
    tok: doOrquestrador.ok ? doOrquestrador.tokens : null, h5: entrada.limites.h5, d7: entrada.limites.d7, narrativa: '',
  };

  // agentes
  const agentes                 = [];
  const cobertos = new Set        (); // `${task}:${papel}` com agente vivo casado
  if (entrada.agentes !== null) {
    for (const a of Array.isArray(entrada.agentes) ? (entrada.agentes                ) : []) {
      if (!vivoDe(a)) continue;
      const uso = ehObjeto(a) ? usoValido(a.uso) : null;
      const casado = ehObjeto(a) ? casarAgente(a.description, plano) : null;
      if (casado === null) {
        agentes.push({
          nome: null, papel: null, task: undefined, estadoTask: null, modelo: familia(uso?.modelo), ctxPct: pctDe(uso), ctxTok: uso?.contexto ?? null,
          tok: uso?.tok ?? null, desdeS: null, cor: 'inactive', vivo: true,
        });
        continue;
      }
      cobertos.add(`${casado.task}:${casado.papel}`);
      const ini = iniciada(casado.task, casado.papel);
      const nome = nomes.get(chaveDoPar(casado.task, casado.papel)) ?? null;
      agentes.push({
        nome, papel: casado.papel, task: casado.task, estadoTask: estados.get(casado.task) ?? null,
        modelo: familia(uso?.modelo) ?? familia(ini !== null && ehObjeto(ini.dados) ? ini.dados.modelo : null),
        ctxPct: pctDe(uso), ctxTok: uso?.contexto ?? null, tok: uso?.tok ?? null, desdeS: desdeS(ini), cor: corDe(nome), vivo: true,
      });
    }
    for (const t of plano.tasks) {
      const estado = estados.get(t.id);
      const papel = estado === undefined ? undefined : PAPEL_DO_ESTADO[estado];
      if (papel === undefined || cobertos.has(`${t.id}:${papel}`)) continue;
      const ini = iniciada(t.id, papel);
      const nome = nomes.get(chaveDoPar(t.id, papel)) ?? null;
      agentes.push({
        nome, papel, task: t.id, estadoTask: estado              , modelo: familia(ini !== null && ehObjeto(ini.dados) ? ini.dados.modelo : null),
        ctxPct: null, ctxTok: null, tok: null, desdeS: desdeS(ini), cor: corDe(nome), vivo: false,
      });
    }
  }

  // D-R2: ordem estável, independente da ordem em que o mod lista os agentes: (índice da task no plano, papel, vivo antes de ◌); `sem task` no fim, na ordem de entrada
  const indiceDaTask = new Map(plano.tasks.map((t, i) => [t.id, i]));
  const chaveDeOrdem = (a              )                           =>
    a.task === undefined || !indiceDaTask.has(a.task) ? [Infinity, 0, 0] : [indiceDaTask.get(a.task)          , a.papel === null ? 3 : PAPEIS_ORDEM.indexOf(a.papel), a.vivo ? 0 : 1];
  const ordenados = agentes
    .map((a, i) => ({ a, i, k: chaveDeOrdem(a) }))
    .sort((x, y) => (x.k[0] === y.k[0] ? 0 : x.k[0] < y.k[0] ? -1 : 1) || x.k[1] - y.k[1] || x.k[2] - y.k[2] || x.i - y.i)
    .map((x) => x.a);
  const vivos = entrada.agentes === null ? null : ordenados.filter((a) => a.vivo).length;

  // revisores aguardando (task em `concluida`); mutações de hoje somam a entrega, não a task
  const hoje = mutacoesDeHoje(ord, entrada);
  const revisoresAguardando = plano.tasks
    .filter((t) => estados.get(t.id) === 'concluida')
    .map((t) => ({ nome: nomes.get(chaveDoPar(t.id, 'revisor')) ?? null, task: t.id, mutacoesHoje: hoje?.total ?? null, mortasHoje: hoje?.mortas ?? null }));

  // Sombra
  const vigentes = [...projetarDecisoes(todos).values()];
  const ultimaDec = maisRecente(vigentes);
  const ultima = ultimaDec === null ? null : (() => {
    const d = ultimaDec;
    const fonte = Array.isArray(d.fontes) && d.fontes.length > 0 ? d.fontes[0] : d.medicao !== undefined ? 'medicao' : null;
    return { seq: d.seq, resposta: d.resposta, fonte };
  })();
  const dasSombra = medicoes.filter((e) => ehObjeto(e.dados) && e.dados.papel === 'sombra');
  const ultimaSombra = dasSombra.length > 0 ? dasSombra[dasSombra.length - 1] : null;
  const sombra = {
    nome: entrada.pacote.sabio, modelo: familia(ultimaSombra !== null && ehObjeto(ultimaSombra.dados) ? ultimaSombra.dados.modelo : null),
    decisoes: vigentes.length, ultima,
  };

  return { lider, agentes: ordenados, vivos, revisoresAguardando, sombra };
}

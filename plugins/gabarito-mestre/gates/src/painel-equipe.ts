/**
 * Equipe do painel (E4, T3): pacotes de nomes, sorteio, nome por papel, uso do transcript e a projeção `equipe` do `EstadoPainel`.
 * Puro: sem `fs`, `process`, `Date.now()` nem `node:*` (o mod importa o `dist/`, que não tem Node; ver `loop.ts`). Por isso o sorteio usa FNV-1a
 * em TS e este módulo não importa `sombra.ts` (que traz `node:crypto`): as decisões vigentes da Sombra são recontadas aqui (`decisoesVigentes`),
 * e o teste `sombra-vigentes-igual-projetarDecisoes` prende a cópia ao original.
 */

import { formaInvalida } from './formas.ts';
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.ts';
import type { EstadoTask } from './loop.ts';
import { dataCivil } from './painel-hora.ts';
import { tokensDe } from './pouso.ts';
import type { AgentePainel, AgenteVivo, CorTema, EntradaPainel, EstadoPainel, Evento, PacoteNomes, Papel, Plano, UsoAgente } from './tipos.ts';

const DESCRICAO_RE = /^(\S+) (implementador|revisor|correcao)$/;

/**
 * Liga o agente vivo à task pela `description` do `Agent` (D3), que é `"<task> <papel>"` do item de `loop.mjs proxima`.
 * Nunca por aproximação: depois de `trim`, só o padrão exato, com task do plano e papel conhecido; qualquer outra coisa é `null`
 * (o render escreve `sem task`). `description` que não é texto também é `null`, sem lançar.
 */
export function casarAgente(description: string, plano: Plano): { task: string; papel: Papel } | null {
  if (typeof description !== 'string') return null;
  const m = DESCRICAO_RE.exec(description.trim());
  if (m === null) return null;
  const tasks = plano !== null && typeof plano === 'object' && Array.isArray(plano.tasks) ? plano.tasks : [];
  if (!tasks.some((t) => t.id === m[1])) return null;
  return { task: m[1], papel: m[2] as Papel };
}

// ---------- pacote de nomes ----------

/** Caixa alta, largura 1 por construção e ≤ 10 colunas: não depende de `colunas` (T4). */
const NOME_RE = /^[A-Z0-9ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ'-]{1,10}$/u;
const LARGO_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
const NOME_MAX_COLUNAS = 20;

const ehObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const nomeOk = (v: unknown): v is string => typeof v === 'string' && NOME_RE.test(v);

/** Colunas do rótulo exibido do pacote (`terra média`): largo vale 2; controle é `-1` (recusado). */
function colunasDoRotulo(s: string): number {
  let n = 0;
  for (const c of s) {
    if (/\p{Cc}/u.test(c)) return -1;
    n += LARGO_RE.test(c) ? 2 : 1;
  }
  return n;
}

/**
 * Valida um pacote de nomes (REQ-PNL-6). `nomes`, `lider` e `sabio` seguem `NOME_RE`; `nomes` tem ≥ 8, sem repetidos e sem `lider`/`sabio`;
 * `lider ≠ sabio`; `nome` (rótulo exibido) é texto de 1 a 20 colunas. Devolve cópia, sem campos extras. Nunca lança.
 */
export function validarPacote(bruto: unknown): { ok: true; pacote: PacoteNomes } | { ok: false; erro: string } {
  const erro = (e: string): { ok: false; erro: string } => ({ ok: false, erro: e });
  if (!ehObjeto(bruto)) return erro('pacote não é objeto');
  const { nome, lider, sabio, nomes } = bruto;
  if (typeof nome !== 'string' || nome.trim() === '') return erro('`nome` ausente ou vazio');
  const cols = colunasDoRotulo(nome);
  if (cols < 0) return erro('`nome` com caractere de controle');
  if (cols > NOME_MAX_COLUNAS) return erro(`\`nome\` com ${cols} colunas, máximo ${NOME_MAX_COLUNAS}`);
  if (!nomeOk(lider)) return erro('`lider` ausente ou fora do padrão (caixa alta, até 10 colunas)');
  if (!nomeOk(sabio)) return erro('`sabio` ausente ou fora do padrão (caixa alta, até 10 colunas)');
  if (lider === sabio) return erro('`lider` e `sabio` são o mesmo nome');
  if (!Array.isArray(nomes)) return erro('`nomes` não é lista');
  if (nomes.length < 8) return erro(`\`nomes\` com ${nomes.length} itens, mínimo 8`);
  const vistos = new Set<string>();
  for (let i = 0; i < nomes.length; i++) {
    const n: unknown = nomes[i];
    if (!nomeOk(n)) return erro(`\`nomes\`[${i}] fora do padrão (caixa alta, até 10 colunas)`);
    if (vistos.has(n)) return erro(`\`nomes\`[${i}] repetido: ${n}`);
    if (n === lider || n === sabio) return erro(`\`nomes\`[${i}] repete o líder ou o sábio: ${n}`);
    vistos.add(n);
  }
  return { ok: true, pacote: { nome, lider, sabio, nomes: [...(nomes as string[])] } };
}

/** FNV-1a de 32 bits sobre as unidades UTF-16: determinístico, sem `node:crypto`. */
function fnv1a32(texto: string): number {
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
export function sortearPacote(sessionId: string, nomes: string[], anterior: string | null): string {
  const unicos = [...new Set((Array.isArray(nomes) ? nomes : []).filter((n): n is string => typeof n === 'string'))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (unicos.length === 0) return 'terra-media';
  const candidatos = unicos.filter((n) => n !== anterior);
  const lista = candidatos.length > 0 ? candidatos : unicos;
  return lista[fnv1a32(typeof sessionId === 'string' ? sessionId : '') % lista.length];
}

// ---------- nome por papel ----------

const PAPEIS: readonly string[] = ['implementador', 'revisor', 'correcao'];
const chaveDoPar = (task: string, papel: string): string => `${task}:${papel === 'revisor' ? 'revisor' : 'trabalho'}`;
const ordemSegura = (eventos: unknown): Evento[] | null => {
  if (!Array.isArray(eventos)) return null;
  const o = ordenar(eventos as Evento[]);
  return o.ok ? o.eventos : null;
};

/**
 * Nome de cada par: `${task}:trabalho` (implementador e correção) e `${task}:revisor`. O par recebe `nomes[i % n]`, com `i` = ordem do 1º
 * `task.iniciada` do par no diário ordenado; evento novo no fim nunca troca nome antigo, e `task.reaberta` mantém o par. Diário que não ordena
 * ou pacote sem nomes ⇒ mapa vazio (todo nome fica `null`). Limite declarado: evento de outra sessão com `ts` anterior reordena (`ordenar`
 * intercala por `ts`) e pode trocar nomes.
 */
export function nomesPorPapel(eventos: Evento[], pacote: PacoteNomes): Map<string, string> {
  const mapa = new Map<string, string>();
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

const CAMPO_VALIDO = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Uso de um agente a partir das linhas do transcript. Linha que não é texto, sem `"usage"`, JSON inválido (inclui a linha partida da cauda),
 * `message.model` começando com `<` (`<synthetic>`), `usage` que não é objeto ou com campo presente e que não é número finito ≥ 0: ignorada.
 * `input_tokens` é obrigatório; `output` e os dois de cache ausentes valem 0. `contexto` = `input + cache_read + cache_creation` da última linha
 * aceita; `tok` = Σ por `message.id` (maior valor por campo) de `input + output + cache_creation`, sem `cache_read` (mesma conta de `tokensDe`);
 * linha sem `message.id` entra em `contexto`, não em `tok`; `modelo` = último `message.model` aceito. Nenhuma linha aceita ⇒ `null`.
 */
export function usoDoTranscript(linhas: string[]): UsoAgente | null {
  if (!Array.isArray(linhas)) return null;
  let contexto: number | null = null;
  let modelo: string | null = null;
  const porId = new Map<string, { input: number; output: number; criacao: number }>();
  for (const l of linhas) {
    if (typeof l !== 'string' || !l.includes('"usage"')) continue;
    let o: unknown;
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
    const lido: Record<string, number> = {};
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

type Decisao = { e: Evento; pos: number };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Decisão vigente por hash, mesma regra de `sombra.ts` (`vigentes`): entre as `decisao.sombra` de forma válida do mesmo hash, o `substitui`
 * que aponta uma decisão válida do mesmo hash tira o alvo da disputa; das que sobram vence a mais recente na ordem do diário; todas
 * substituídas (ciclo forjado) ⇒ a mais recente de todas. Diário que não ordena ⇒ vazio.
 */
function decisoesVigentes(eventos: unknown): Evento[] {
  const ord = ordemSegura(eventos);
  if (ord === null) return [];
  const porHash = new Map<string, Decisao[]>();
  ord.forEach((e, pos) => {
    if (e.tipo !== 'decisao.sombra' || formaInvalida(e.tipo, e.dados) !== null) return;
    const h = (e.dados as { pergunta_hash: string }).pergunta_hash;
    const lista = porHash.get(h) ?? [];
    lista.push({ e, pos });
    porHash.set(h, lista);
  });
  const vigentes: Evento[] = [];
  for (const lista of porHash.values()) {
    const substituidas = new Set<Evento>();
    for (const { e } of lista) {
      const s = (e.dados as { substitui?: { sessao: string; seq: number } }).substitui;
      if (s === undefined) continue;
      const alvo = lista.find((c) => c.e.sessao === s.sessao && c.e.seq === s.seq);
      if (alvo !== undefined && alvo.e !== e) substituidas.add(alvo.e);
    }
    const livres = lista.filter((c) => !substituidas.has(c.e));
    const disputa = livres.length > 0 ? livres : lista;
    vigentes.push(disputa[disputa.length - 1].e);
  }
  return vigentes;
}

/** Mais recente por `(ts, sessao, seq)`, a ordem de `diario.ts` e do bloco da Sombra. */
function maisRecente(eventos: Evento[]): Evento | null {
  let melhor: Evento | null = null;
  for (const e of eventos) {
    if (melhor === null) { melhor = e; continue; }
    const d = Date.parse(e.ts) - Date.parse(melhor.ts) || cmp(e.sessao, melhor.sessao) || e.seq - melhor.seq;
    if (d > 0) melhor = e;
  }
  return melhor;
}

// ---------- projeção ----------

const ENCERRADO: ReadonlySet<string> = new Set(['idle', 'completed', 'failed', 'killed']);
const ORDEM_COR: readonly CorTema[] = ['claude', 'suggestion', 'autoAccept', 'ide', 'remember'];
const FAMILIA_RE = /haiku|sonnet|opus|fable/;
const PAPEL_DO_ESTADO: Partial<Record<EstadoTask, Papel>> = { implementando: 'implementador', corrigindo: 'correcao', em_revisao: 'revisor' };

const familia = (modelo: unknown): string | null => {
  if (typeof modelo !== 'string') return null;
  const m = FAMILIA_RE.exec(modelo);
  return m === null ? null : m[0];
};

/** Vivo = `status` fora de `{idle, completed, failed, killed}`; dado desconhecido (inclusive não texto) conta como vivo (`vivosDe`). */
const vivoDe = (a: unknown): boolean => {
  const s = ehObjeto(a) ? a.status : undefined;
  return !(typeof s === 'string' && ENCERRADO.has(s));
};

const usoValido = (u: unknown): UsoAgente | null =>
  ehObjeto(u) && CAMPO_VALIDO(u.contexto) ? { contexto: u.contexto, tok: CAMPO_VALIDO(u.tok) ? u.tok : 0, modelo: typeof u.modelo === 'string' ? u.modelo : null } : null;

function estadosDasTasks(plano: Plano, ord: Evento[] | null): Map<string, EstadoTask> {
  const estados = new Map<string, EstadoTask>();
  if (ord === null) return estados;
  for (const t of plano.tasks) {
    const fila = ord.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && ehObjeto(e.dados) && e.dados.task === t.id);
    const r = estadoDe(fila);
    if (!('invalido' in r)) estados.set(t.id, r.estado);
  }
  return estados;
}

function mutacoesDeHoje(ord: Evento[] | null, entrada: EntradaPainel): { total: number; mortas: number } | null {
  if (ord === null) return null;
  const hoje = dataCivil(entrada.agoraMs, entrada.fuso);
  let achou: { total: number; mortas: number } | null = null;
  for (const e of ord) {
    if (e.tipo !== 'task.integrada' || formaInvalida(e.tipo, e.dados) !== null || !ehObjeto(e.dados) || !ehObjeto(e.dados.mutacoes)) continue;
    if (dataCivil(Date.parse(e.ts), entrada.fuso) !== hoje) continue;
    const { total, mortas } = e.dados.mutacoes as { total: number; mortas: number };
    achou = { total: (achou?.total ?? 0) + total, mortas: (achou?.mortas ?? 0) + mortas };
  }
  return achou;
}

/**
 * Projeta `equipe`: líder, agentes (vivos casados, vivos sem task e `◌ sem agente`), revisores aguardando e Sombra (sempre presente).
 * `entrada.agentes === null` (CLI sem mod) ⇒ nenhuma linha de agente e nenhum `◌`; `[]` ⇒ `◌ sem agente` para toda task em voo.
 * Diário que não ordena ⇒ nomes `null`, sem estado de task e sem `◌`: quem sinaliza é o PAROU (T2).
 */
export function projetarEquipe(plano: Plano, eventos: Evento[], entrada: EntradaPainel): EstadoPainel['equipe'] {
  const todos: Evento[] = Array.isArray(eventos) ? eventos : [];
  const ord = ordemSegura(todos);
  const nomes = nomesPorPapel(todos, entrada.pacote);
  const estados = estadosDasTasks(plano, ord);
  const base = ord ?? todos;

  const iniciada = (task: string, papel: Papel): Evento | null => {
    const chave = chaveDoPar(task, papel);
    let achado: Evento | null = null;
    for (const e of ord ?? []) {
      if (e.tipo === 'task.iniciada' && ehObjeto(e.dados) && e.dados.task === task && typeof e.dados.papel === 'string' && PAPEIS.includes(e.dados.papel) && chaveDoPar(task, e.dados.papel) === chave) achado = e;
    }
    return achado;
  };
  const desdeS = (ini: Evento | null): number | null => {
    if (ini === null) return null;
    const ms = Date.parse(ini.ts);
    return Number.isFinite(ms) ? Math.max(0, Math.floor((entrada.agoraMs - ms) / 1000)) : null;
  };
  const corDe = (nome: string | null): CorTema => {
    const i = nome === null ? -1 : entrada.pacote.nomes.indexOf(nome);
    return i < 0 ? 'inactive' : ORDEM_COR[i % ORDEM_COR.length];
  };
  const janela = entrada.contexto?.window;
  const pctDe = (uso: UsoAgente | null): number | null =>
    uso !== null && typeof uso.modelo === 'string' && typeof entrada.modeloSessao === 'string' && uso.modelo === entrada.modeloSessao
      && typeof janela === 'number' && Number.isFinite(janela) && janela > 0
      ? Math.round((uso.contexto / janela) * 100)
      : null;

  // líder
  const medicoes = base.filter((e) => e.tipo === 'custo.medicao');
  const doOrquestrador = tokensDe(medicoes.filter((e) => e.agente === 'orquestrador'));
  const lider: EstadoPainel['equipe']['lider'] = {
    nome: entrada.pacote.lider, modelo: familia(entrada.modeloSessao), ctx: entrada.contexto.percent, x: entrada.x,
    tok: doOrquestrador.ok ? doOrquestrador.tokens : null, h5: entrada.limites.h5, d7: entrada.limites.d7, narrativa: '',
  };

  // agentes
  const agentes: AgentePainel[] = [];
  const cobertos = new Set<string>(); // `${task}:${papel}` com agente vivo casado
  if (entrada.agentes !== null) {
    for (const a of Array.isArray(entrada.agentes) ? (entrada.agentes as AgenteVivo[]) : []) {
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
        nome, papel, task: t.id, estadoTask: estado as EstadoTask, modelo: familia(ini !== null && ehObjeto(ini.dados) ? ini.dados.modelo : null),
        ctxPct: null, ctxTok: null, tok: null, desdeS: desdeS(ini), cor: corDe(nome), vivo: false,
      });
    }
  }

  // revisores aguardando (task em `concluida`); mutações de hoje somam a entrega, não a task
  const hoje = mutacoesDeHoje(ord, entrada);
  const revisoresAguardando = plano.tasks
    .filter((t) => estados.get(t.id) === 'concluida')
    .map((t) => ({ nome: nomes.get(chaveDoPar(t.id, 'revisor')) ?? null, task: t.id, mutacoesHoje: hoje?.total ?? null, mortasHoje: hoje?.mortas ?? null }));

  // Sombra
  const vigentes = decisoesVigentes(todos);
  const ultimaEv = maisRecente(vigentes);
  const ultima = ultimaEv === null ? null : (() => {
    const d = ultimaEv.dados as { resposta: string; fontes?: string[]; medicao?: string };
    const fonte = Array.isArray(d.fontes) && d.fontes.length > 0 ? d.fontes[0] : d.medicao !== undefined ? 'medicao' : null;
    return { seq: ultimaEv.seq, resposta: d.resposta, fonte };
  })();
  const dasSombra = medicoes.filter((e) => ehObjeto(e.dados) && e.dados.papel === 'sombra');
  const ultimaSombra = dasSombra.length > 0 ? dasSombra[dasSombra.length - 1] : null;
  const sombra = {
    nome: entrada.pacote.sabio, modelo: familia(ultimaSombra !== null && ehObjeto(ultimaSombra.dados) ? ultimaSombra.dados.modelo : null),
    decisoes: vigentes.length, ultima,
  };

  return { lider, agentes, revisoresAguardando, sombra };
}

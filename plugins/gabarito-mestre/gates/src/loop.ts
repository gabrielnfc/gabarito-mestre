/**
 * Núcleo puro do loop (REQ-LOOP-2): mesma entrada, mesma saída. Sem E/S e sem relógio.
 * A precedência de `proximaAcao` é o contrato da Task 2 do plano da E2; cada cláusula traz o número dela.
 */

import type { AcaoLoop, Evento, Papel, Plano, Sinais } from './tipos.ts';

export type { AcaoLoop, MotivoParar, Papel, Plano, Sinais, TaskPlano } from './tipos.ts';

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const PAPEIS: readonly unknown[] = ['implementador', 'revisor', 'correcao'];
const TIPOS_DE_TASK: readonly string[] = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'];

/** Comparação por código, nunca por localidade: a ordem não pode depender da máquina. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ordem só por `seq` dentro da sessão: a guarda carimba `ts` antes do lock, então `ts` contraditório na sessão
 * é esperado e não invalida. Entre sessões, intercala pelas cabeças em `(ts, sessao)`, sem reordenar nenhuma delas.
 */
export function ordenar(eventos: Evento[]): { ok: true; eventos: Evento[] } | { ok: false } {
  const sessoes = new Map<string, { e: Evento; ms: number }[]>();
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
  const saida: Evento[] = [];
  while (saida.length < eventos.length) {
    let melhor: { nome: string; ms: number } | null = null;
    for (const nome of nomes) {
      const prox = (sessoes.get(nome) as { e: Evento; ms: number }[])[cabeca.get(nome) as number];
      if (prox && (!melhor || prox.ms < melhor.ms)) melhor = { nome, ms: prox.ms };
    }
    const { nome } = melhor as { nome: string };
    const i = cabeca.get(nome) as number;
    saida.push((sessoes.get(nome) as { e: Evento; ms: number }[])[i].e);
    cabeca.set(nome, i + 1);
  }
  return { ok: true, eventos: saida };
}

export type EstadoTask =
  | 'pendente' | 'implementando' | 'concluida' | 'em_revisao' | 'reprovada' | 'corrigindo' | 'aprovada' | 'no_teto' | 'integrada';

/** Eventos de task como a tabela os enxerga; o veredito já vem classificado pela rodada e pelos achados. */
export const CHAVES_DE_EVENTO = [
  'iniciada.implementador', 'iniciada.revisor', 'iniciada.correcao', 'task.concluida',
  'veredito.aprovado', 'veredito.aprovado.com_achado',
  'veredito.reprovado.r1', 'veredito.reprovado.teto', 'veredito.reprovado.sem_achado',
  'task.integrada', 'reaberta.retomada', 'reaberta.dono',
] as const;
export type ChaveEvento = (typeof CHAVES_DE_EVENTO)[number];

const VEREDITOS = {
  'veredito.aprovado': 'aprovada',
  'veredito.reprovado.r1': 'reprovada',
  'veredito.reprovado.teto': 'no_teto',
  'veredito.reprovado.sem_achado': 'reprovada',
} as const;

/**
 * Única fonte do estado de uma task: estado → evento → próximo estado. Par ausente é diário inválido.
 * `veredito.aprovado.com_achado` não aparece em nenhum estado de propósito (A11).
 * `reaberta.retomada` fora de agente em voo não muda nada: quem decide reabrir é o orquestrador, não esta tabela.
 */
export const TRANSICOES: Record<EstadoTask, Partial<Record<ChaveEvento, EstadoTask>>> = {
  pendente: { 'iniciada.implementador': 'implementando', 'reaberta.retomada': 'pendente', 'reaberta.dono': 'pendente' },
  implementando: { 'task.concluida': 'concluida', 'reaberta.retomada': 'pendente', 'reaberta.dono': 'implementando' },
  concluida: { 'iniciada.revisor': 'em_revisao', ...VEREDITOS, 'reaberta.retomada': 'concluida', 'reaberta.dono': 'concluida' },
  em_revisao: { ...VEREDITOS, 'reaberta.retomada': 'concluida', 'reaberta.dono': 'em_revisao' },
  reprovada: { 'iniciada.correcao': 'corrigindo', 'reaberta.retomada': 'reprovada', 'reaberta.dono': 'reprovada' },
  corrigindo: { 'task.concluida': 'concluida', 'reaberta.retomada': 'reprovada', 'reaberta.dono': 'corrigindo' },
  aprovada: { 'task.integrada': 'integrada', 'reaberta.retomada': 'aprovada', 'reaberta.dono': 'aprovada' },
  // Autotransição: só o dono tira do teto; evento avulso não tira nem quebra. `task.integrada` fica de fora: integrar sem liberação é fraude.
  no_teto: {
    'iniciada.implementador': 'no_teto', 'iniciada.revisor': 'no_teto', 'iniciada.correcao': 'no_teto', 'task.concluida': 'no_teto',
    'veredito.aprovado': 'no_teto', 'veredito.aprovado.com_achado': 'no_teto', 'veredito.reprovado.r1': 'no_teto',
    'veredito.reprovado.teto': 'no_teto', 'veredito.reprovado.sem_achado': 'no_teto',
    'reaberta.retomada': 'no_teto', 'reaberta.dono': 'pendente',
  },
  integrada: { 'reaberta.retomada': 'integrada', 'reaberta.dono': 'integrada' },
};

const contagem = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0;

/** Classifica um evento de task; `string` é o motivo de o `dados` não cumprir o contrato. */
function chaveDe(e: Evento, rodada: number, estado: EstadoTask): { chave: ChaveEvento; rodada: number | null } | string {
  const dados = e.dados ?? {};
  switch (e.tipo) {
    case 'task.iniciada':
      if (!PAPEIS.includes(dados.papel)) return 'papel inválido';
      return { chave: `iniciada.${dados.papel as Papel}` as ChaveEvento, rodada: null };
    case 'task.concluida':
      return { chave: 'task.concluida', rodada: null };
    case 'task.integrada':
      return { chave: 'task.integrada', rodada: null };
    case 'task.reaberta':
      if (dados.origem !== 'dono' && dados.origem !== 'retomada') return 'origem inválida';
      return { chave: `reaberta.${dados.origem}` as ChaveEvento, rodada: null };
    case 'review.veredito': {
      const { veredito, rodada: declarada, major, blocker } = dados;
      if (veredito !== 'APROVADO' && veredito !== 'REPROVADO') return 'veredito inválido';
      if (!contagem(declarada) || !contagem(major) || !contagem(blocker)) return 'contagem inválida';
      // Rodada é o nº de vereditos desde a última reabertura do dono; quem declara outra mente.
      // No teto o veredito é avulso: não conta rodada, e a duplicata não pode quebrar a saída do dono.
      const noTeto = estado === 'no_teto';
      if (!noTeto && declarada !== rodada + 1) return 'rodada fora de sequência';
      const n = noTeto ? (declarada as number) : rodada + 1;
      const novaRodada = noTeto ? null : n;
      const achados = (major as number) + (blocker as number);
      if (veredito === 'APROVADO') return { chave: achados > 0 ? 'veredito.aprovado.com_achado' : 'veredito.aprovado', rodada: novaRodada };
      if (n === 1) return { chave: 'veredito.reprovado.r1', rodada: novaRodada };
      return { chave: achados > 0 ? 'veredito.reprovado.teto' : 'veredito.reprovado.sem_achado', rodada: novaRodada };
    }
    default:
      return 'tipo fora do contrato de task';
  }
}

/** Redutor único: eventos de UMA task, já ordenados, para o estado dela. Nada decide estado fora de `TRANSICOES`. */
export function estadoDe(eventosDaTask: Evento[]): { estado: EstadoTask; rodada: number } | { invalido: string } {
  let estado: EstadoTask = 'pendente';
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

type EstadoRodada = { estado: EstadoTask; rodada: number };

/** Estado por task, ou `null` se algum evento sai do plano, do contrato de `dados` ou da tabela. */
function projetar(plano: Plano, eventos: Evento[]): { estados: Map<string, EstadoRodada>; ciVermelhos: number } | null {
  const porTask = new Map<string, Evento[]>();
  for (const t of plano.tasks) porTask.set(t.id, []);
  let ciVermelhos = 0;
  for (const e of eventos) {
    if (e.tipo === 'ci.resultado') {
      const verde = (e.dados ?? {}).verde;
      if (typeof verde !== 'boolean') return null;
      ciVermelhos = verde ? 0 : ciVermelhos + 1;
    } else if (TIPOS_DE_TASK.includes(e.tipo)) {
      const fila = porTask.get((e.dados ?? {}).task as string);
      if (!fila) return null;
      fila.push(e);
    }
  }
  const estados = new Map<string, EstadoRodada>();
  for (const [id, fila] of porTask) {
    const r = estadoDe(fila);
    if ('invalido' in r) return null;
    estados.set(id, r);
  }
  return { estados, ciVermelhos };
}

const de = (estados: Map<string, EstadoRodada>, id: string): EstadoTask | undefined => estados.get(id)?.estado;

/** Ancestrais de `id`, com guarda contra ciclo: `validarPlano` barra ciclo, a função pura não presume. */
function ancestrais(plano: Plano, id: string): string[] {
  const porId = new Map(plano.tasks.map((t) => [t.id, t]));
  const vistos = new Set<string>();
  const pilha = [...(porId.get(id)?.deps ?? [])];
  while (pilha.length > 0) {
    const d = pilha.pop() as string;
    if (vistos.has(d)) continue;
    vistos.add(d);
    pilha.push(...(porId.get(d)?.deps ?? []));
  }
  return [...vistos];
}

function integravel(plano: Plano, estados: Map<string, EstadoRodada>, id: string): boolean {
  return de(estados, id) === 'aprovada' && ancestrais(plano, id).every((a) => de(estados, a) === 'integrada');
}

/** Aprovada, não integrada e com a cadeia inteira de dependências já integrada. */
export function podeIntegrar(plano: Plano, eventos: Evento[], id: string): boolean {
  const ord = ordenar(eventos);
  if (!ord.ok) return false;
  const proj = projetar(plano, ord.eventos);
  return proj !== null && integravel(plano, proj.estados, id);
}

/** A9: dep libera o dependente se integrada, se no teto, ou se aprovada e presa por um teto acima dela. */
function depLiberada(plano: Plano, estados: Map<string, EstadoRodada>, dep: string): boolean {
  const e = de(estados, dep);
  if (e === 'integrada' || e === 'no_teto') return true;
  return e === 'aprovada' && ancestrais(plano, dep).some((a) => de(estados, a) === 'no_teto');
}

export function proximaAcao(plano: Plano, eventos: Evento[], sinais: Sinais): AcaoLoop {
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
  const est = (id: string): EstadoRodada => estados.get(id) as EstadoRodada;
  const ids = plano.tasks.map((t) => t.id);
  const capacidade = Math.max(0, sinais.slots - sinais.vivos);
  const despachar = (itens: { task: string; papel: Papel }[]): AcaoLoop => ({ tipo: 'despachar', itens: itens.slice(0, capacidade) });
  const revisores = ids.filter((id) => est(id).estado === 'concluida').map((task) => ({ task, papel: 'revisor' as const }));

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
    .filter((id) => est(id).estado === 'reprovada' && est(id).rodada === 1)
    .map((task) => ({ task, papel: 'correcao' as const }));
  const novas = plano.tasks
    .filter((t) => est(t.id).estado === 'pendente' && t.deps.every((d) => depLiberada(plano, estados, d)))
    .map((t) => ({ task: t.id, papel: 'implementador' as const }));
  const itens = [...correcoes, ...revisores, ...novas];
  if (itens.length > 0) {
    return capacidade >= 1 ? despachar(itens) : { tipo: 'esperar', motivo: 'sem slot livre' };
  }

  // (8)
  if (ids.every((id) => est(id).estado === 'integrada')) return { tipo: 'concluir' };

  // (9)
  if (sinais.vivos > 0) return { tipo: 'esperar', motivo: 'agentes vivos' };
  const noLimite = ids.find((id) => est(id).estado === 'no_teto');
  if (noLimite !== undefined) return { tipo: 'parar', motivo: 'teto_rodadas', task: noLimite };
  // Sem agente vivo e sem próxima ação (ex.: task iniciada cujo agente morreu): para, nunca em silêncio.
  return { tipo: 'parar', motivo: 'nao_conseguiu', task: ids.find((id) => est(id).estado !== 'integrada') as string };
}

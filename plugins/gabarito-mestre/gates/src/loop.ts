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

type Veredito = { aprovado: boolean; rodada: number; achados: number; pos: number };
type Estado = {
  iniciada: boolean;
  integrada: boolean;
  concluidaPos: number;
  revisorPos: number;
  correcaoPos: number;
  veredito: Veredito | null;
  /** Estado, não derivação do último veredito: só `task.reaberta {origem:'dono'}` desliga. */
  teto: boolean;
  /** Último veredito por rodada e o commit a que ele se refere, para achar vereditos opostos. */
  porRodada: Map<number, { aprovado: boolean; concluidaPos: number }>;
};

const contagem = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0;

const estadoInicial = (): Estado => ({
  iniciada: false, integrada: false, concluidaPos: -1, revisorPos: -1, correcaoPos: -1, veredito: null, teto: false, porRodada: new Map(),
});

/** Estado por task, ou `null` se algum evento de task sai do plano ou do contrato de `dados`. */
function projetar(plano: Plano, eventos: Evento[]): { estados: Map<string, Estado>; ciVermelhos: number } | null {
  const estados = new Map<string, Estado>();
  for (const t of plano.tasks) estados.set(t.id, estadoInicial());
  let ciVermelhos = 0;
  for (const [pos, e] of eventos.entries()) {
    const dados = e.dados ?? {};
    if (e.tipo === 'ci.resultado') {
      if (typeof dados.verde !== 'boolean') return null;
      ciVermelhos = dados.verde ? 0 : ciVermelhos + 1;
      continue;
    }
    if (!TIPOS_DE_TASK.includes(e.tipo)) continue;
    const est = estados.get(dados.task as string);
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
      // Integrar sem aprovação vigente é o fechamento sozinho (A11): nunca vira `concluir`.
      if (!aprovada(est)) return null;
      est.integrada = true;
    } else if (e.tipo === 'task.reaberta') {
      if (dados.origem !== 'dono' && dados.origem !== 'retomada') return null;
      if (dados.origem === 'dono') {
        if (est.teto && !est.integrada) estados.set(dados.task as string, estadoInicial());
      } else if (est.iniciada && est.concluidaPos < 0 && !est.veredito) {
        est.iniciada = false;
      }
    } else {
      const { veredito, rodada, major, blocker } = dados;
      if (veredito !== 'APROVADO' && veredito !== 'REPROVADO') return null;
      if (!contagem(rodada) || (rodada as number) < 1 || !contagem(major) || !contagem(blocker)) return null;
      const achados = (major as number) + (blocker as number);
      const aprovado = veredito === 'APROVADO';
      if (aprovado && achados > 0) return null;
      const mesma = est.porRodada.get(rodada as number);
      if (mesma && mesma.concluidaPos === est.concluidaPos && mesma.aprovado !== aprovado) return null;
      est.porRodada.set(rodada as number, { aprovado, concluidaPos: est.concluidaPos });
      est.iniciada = true;
      if (!aprovado && (rodada as number) >= 2 && achados > 0) est.teto = true;
      // Vale o da maior rodada; na mesma rodada, o mais recente.
      if (!est.veredito || (rodada as number) >= est.veredito.rodada) {
        est.veredito = { aprovado, rodada: rodada as number, achados, pos };
      }
    }
  }
  return { estados, ciVermelhos };
}

/** Commit posterior ao veredito válido (ou nenhum veredito): o que está na branch ainda não foi revisto. */
const semRevisao = (e: Estado): boolean => e.concluidaPos >= 0 && (!e.veredito || e.concluidaPos > e.veredito.pos);
const aprovada = (e: Estado): boolean => !e.teto && !semRevisao(e) && e.veredito?.aprovado === true;
const reprovadaSemCommitNovo = (e: Estado): boolean => !semRevisao(e) && e.veredito?.aprovado === false;
const noTeto = (e: Estado): boolean => !e.integrada && e.teto;

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

function integravel(plano: Plano, estados: Map<string, Estado>, id: string): boolean {
  const e = estados.get(id);
  if (!e || e.integrada || !aprovada(e)) return false;
  return ancestrais(plano, id).every((a) => estados.get(a)?.integrada === true);
}

/** Aprovada, não integrada e com a cadeia inteira de dependências já integrada. */
export function podeIntegrar(plano: Plano, eventos: Evento[], id: string): boolean {
  const ord = ordenar(eventos);
  if (!ord.ok) return false;
  const proj = projetar(plano, ord.eventos);
  return proj !== null && integravel(plano, proj.estados, id);
}

/** A9: dep libera o dependente se integrada, se no teto, ou se aprovada e presa por um teto acima dela. */
function depLiberada(plano: Plano, estados: Map<string, Estado>, dep: string): boolean {
  const e = estados.get(dep);
  if (!e) return false;
  if (e.integrada || noTeto(e)) return true;
  return aprovada(e) && ancestrais(plano, dep).some((a) => noTeto(estados.get(a) as Estado));
}

const paraRevisor = (e: Estado): boolean => !e.integrada && !e.teto && semRevisao(e) && e.revisorPos < e.concluidaPos;

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
  const est = (id: string): Estado => estados.get(id) as Estado;
  const ids = plano.tasks.map((t) => t.id);
  const capacidade = Math.max(0, sinais.slots - sinais.vivos);
  const despachar = (itens: { task: string; papel: Papel }[]): AcaoLoop => ({ tipo: 'despachar', itens: itens.slice(0, capacidade) });
  const revisores = ids.filter((id) => paraRevisor(est(id))).map((task) => ({ task, papel: 'revisor' as const }));

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
      return !e.integrada && reprovadaSemCommitNovo(e) && e.veredito!.rodada === 1 && e.correcaoPos < e.veredito!.pos;
    })
    .map((task) => ({ task, papel: 'correcao' as const }));
  const novas = plano.tasks
    .filter((t) => !est(t.id).iniciada && t.deps.every((d) => depLiberada(plano, estados, d)))
    .map((t) => ({ task: t.id, papel: 'implementador' as const }));
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
  return { tipo: 'parar', motivo: 'nao_conseguiu', task: ids.find((id) => !est(id).integrada) as string };
}

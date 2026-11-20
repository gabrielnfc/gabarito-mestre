/**
 * Visão de projeto (GM-15 T31, REQ-ENT-2 emenda 4, decisão do dono D-G3): uma linha por PBI/entrega do projeto, acima da visão de entrega.
 * Núcleo PURO: sem `node:*` (o mod carrega o `dist/`). A borda (T32, `painel.mjs`) roda `git worktree list --porcelain`, lê de cada árvore os
 * cards de `fluxo.mapeamento.FL1`, o plano .md que o card aponta, `plano.json` e o diário de `.harness/entregas/<id>/`, e entrega `ArvoreLida[]`.
 *
 * Regras (emenda 4, itens 1 a 5):
 *  1. fontes = card (status do frontmatter), `plano.json` (ou o plano .md, `### Task N:`, quando não houver `plano.json`) e o diário, em TODAS as
 *     worktrees; falha do git ⇒ só a árvore atual + aviso (`worktreesDe`).
 *  2. PBI sem plano: "sem plano", nunca 0 %; o total diz quantos PBIs ficam fora da conta.
 *  3. totais: % de tasks integradas, restantes e previsão pelo ritmo medido da T30 (`ritmoDasAnteriores`): `medida` (a) só com o que tem plano;
 *     `estimada` (b) soma os PBIs sem plano pela mediana de tasks dos PBIs com plano, sinalizada.
 *  4. entrega sem `plano.json`: "fase não medida" em vez de "FASE n de 7" (`rotuloFase`).
 *  5. agente sem `loop.mjs iniciar`: "agente fora do loop" em vez de "sem task" (`rotuloAgente`).
 */
import { estadoDe, TIPOS_DE_TASK } from './loop.ts';
import type { EstadoTask } from './loop.ts';
import { cmp, mediana } from './diario-puro.ts';
import { ritmoDasAnteriores } from './painel.ts';
import { horaLocal } from './painel-hora.ts';
import { validarPlano } from './plano.ts';
import type { Evento } from './tipos.ts';

export const ROTULO_FASE_NAO_MEDIDA = 'fase não medida';
export const ROTULO_FORA_DO_LOOP = 'agente fora do loop';
const ID_PADRAO = /^[A-Z]+-\d+$/;

/** O que a borda leu de UMA árvore (worktree). `planoMd` = texto do plano .md que o card aponta, lido na mesma árvore (`null` = sem arquivo). */
export type ArvoreLida = {
  caminho: string;
  cards: Array<{ arquivo: string; texto: string; planoMd: string | null }>;
  /**
   * `plano`: `null` = sem `plano.json`; `ok:false` = arquivo ilegível. `planoCommitMs`: data (ms) do último commit que tocou o `plano.json` nesta
   * árvore (`git log -1`, lido por quem chama); `null`/ausente = sem git ou não versionado. `eventos`: `null` = diário ilegível.
   */
  entregas: Array<{ id: string; plano: { ok: true; bruto: unknown } | { ok: false; motivo: string } | null; planoCommitMs?: number | null; eventos: Evento[] | null }>;
};

export type Card = { id: string; status: string | null; titulo: string | null; atualizadoEm: string | null; planoMd: string | null };
/** `integradas` = medidas no diário; `estimadas` = de PBI concluído sem registro no diário (emenda 18 p.2): nunca somam às medidas. */
export type TasksLinha = { total: number; integradas: number; estimadas: number; restantes: number; fora: number };
export type LinhaProjeto = {
  id: string;
  titulo: string | null;
  status: string | null;
  /** card "Concluído" ou `entrega.encerrada` sem `entrega.reaberta` depois. */
  feito: boolean;
  plano: 'json' | 'md' | null;
  /** fora da conta de tasks: sem plano, plano inválido ou plano .md ausente. */
  semPlano: boolean;
  tasks: TasksLinha | null;
  /** `null` = fora da conta (nunca 0 % por falta de plano). Só o medido. */
  pct: number | null;
  /** medido + estimado (sinalizado: só difere de `pct` com `tasks.estimadas` > 0). */
  pctComEstimadas: number | null;
  /** texto curto para o render, sem nome técnico (REQ-LNG-1). */
  texto: string;
  /** motivo técnico do "?" (não vai ao render da linha). */
  motivo: string | null;
  /** `null` = a fase é a da trilha (com `plano.json`); senão "fase não medida". */
  fase: string | null;
  /** árvore de onde veio o plano (ou o card). */
  origem: string;
};
export type PrevisaoProjeto = {
  /** s de relógio por task integrada no projeto (T30), `null` sem task integrada. */
  ritmoS: number | null;
  /** (a) medida: ritmo × restantes dos PBIs com plano. */
  medida: { restanteS: number; hora: string } | null;
  /**
   * (b) estimada (emenda 19 p.5): a medida + `tasks` = mediana de tasks dos PBIs com plano × PBIs sem plano não concluídos, no ritmo medido.
   * Só na previsão (fora do %). `texto` marca os números com "~" e diz "estimadas". `null` sem PBI sem plano aberto.
   */
  estimada: { restanteS: number; hora: string; pbisSemPlano: number; tasksPorPbi: number; tasks: number; texto: string } | null;
  motivo: string | null;
};
export type EstadoProjeto = {
  linhas: LinhaProjeto[];
  totais: { pbis: number; feitos: number; foraDaConta: number; opcoes: number; tasks: number; integradas: number; estimadas: number; restantes: number; pct: number | null; pctComEstimadas: number | null; previsao: PrevisaoProjeto };
  avisos: string[];
};

// ---------- worktrees ----------

/** Caminhos a varrer (a atual primeiro). `git worktree list --porcelain`; `prunable` e `bare` ficam fora. Falha ou saída sem worktree ⇒ só a atual + aviso. */
export function worktreesDe(git: { ok: true; saida: string } | { ok: false; motivo: string }, atual: string): { caminhos: string[]; aviso: string | null } {
  if (!git.ok) return { caminhos: [atual], aviso: `git worktree list falhou (${git.motivo}): só a árvore atual` };
  const achados: string[] = [];
  let algum = false;
  for (const bloco of String(git.saida).split(/\n\s*\n/)) {
    const linhas = bloco.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const wt = linhas.find((l) => l.startsWith('worktree '));
    if (wt === undefined) continue;
    algum = true;
    if (linhas.some((l) => l === 'bare' || l === 'prunable' || l.startsWith('prunable '))) continue;
    achados.push(wt.slice('worktree '.length));
  }
  if (!algum) return { caminhos: [atual], aviso: 'git worktree list sem worktree na saída: só a árvore atual' };
  return { caminhos: [atual, ...achados.filter((c) => c !== atual)].filter((c, i, xs) => xs.indexOf(c) === i), aviso: null };
}

// ---------- card e plano .md ----------

/** Caminho do plano .md no card (`Plano: \`docs/plans/x.md\``); "a escrever" ou sem `.md` ⇒ `null`. */
export function planoMdDoCard(texto: string): string | null {
  const m = /Plano:\s*`([^`]+\.md)`/.exec(String(texto));
  return m === null ? null : m[1];
}

/** Card FL1: frontmatter `id` (casa `idPadrao`; senão `null`, ex. `PBI-EXEMPLO`), `status`, `atualizadoEm`; título = 1º `# `. */
export function cardDe(_arquivo: string, texto: string, idPadrao: RegExp = ID_PADRAO): Card | null {
  const linhas = String(texto).split('\n');
  if (linhas[0]?.trim() !== '---') return null;
  const fim = linhas.indexOf('---', 1);
  if (fim < 0) return null;
  const fm = new Map<string, string>();
  for (const l of linhas.slice(1, fim)) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(l);
    if (m !== null) fm.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  const id = fm.get('id');
  if (id === undefined || !idPadrao.test(id)) return null;
  const tit = linhas.slice(fim + 1).find((l) => l.startsWith('# '));
  return { id, status: fm.get('status') || null, titulo: tit === undefined ? null : tit.slice(2).trim(), atualizadoEm: fm.get('atualizadoEm') || null, planoMd: planoMdDoCard(texto) };
}

/**
 * Cabeçalho de task do plano .md (REQ-PRJ-1): `##`/`###` + (`Task` id [anotação] | `T`id) + separador.
 * Id `\d+[a-z]?`; anotação = 1 grupo entre parênteses (com `_`/`*` em volta), só na forma `Task`; separador = `:`/`—`/`–` com espaço opcional antes, ou ` - `.
 */
const CABECALHO_TASK = /^#{2,3} (?:Task (\d+[a-z]?)(?: [_*]?\([^()]*\)[_*]?)?|T(\d+[a-z]?))(?: ?[:—–]| - )/;

/** Tasks do plano .md como `T<id>`, fora de bloco cercado (a cerca abre e fecha com o mesmo caractere); repetição conta 1 vez (a 1ª). */
export function tasksDoPlanoMd(texto: string): string[] {
  const ids: string[] = [];
  let cerca: string | null = null;
  for (const linha of String(texto).split('\n')) {
    const c = /^(```|~~~)/.exec(linha);
    if (c !== null) { if (cerca === null) cerca = c[1][0]; else if (cerca === c[1][0]) cerca = null; continue; }
    if (cerca !== null) continue;
    const m = CABECALHO_TASK.exec(linha);
    if (m === null) continue;
    const id = `T${m[1] ?? m[2]}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------- rótulos (itens 4 e 5) ----------

/** Item 4: sem `plano.json` a fase não é medida; com ele, "FASE n de 7" (`?` sem n). */
export function rotuloFase(temPlanoJson: boolean, n: number | null): string {
  if (!temPlanoJson) return ROTULO_FASE_NAO_MEDIDA;
  return `FASE ${n === null ? '?' : n} de 7`;
}

/**
 * Item 5: o agente só é da task se ela saiu de `pendente` (alguém rodou `loop.mjs iniciar`); sem task casada, ou task sem início ⇒ "agente fora
 * do loop". Sem exceção, a Sombra sem task também (emenda 18 p.6).
 */
export function rotuloAgente(c: { task: string | null; papelExibido: string | null }, estados: ReadonlyMap<string, EstadoTask>): string {
  if (c.task === null) return ROTULO_FORA_DO_LOOP;
  const e = estados.get(c.task);
  return e === undefined || e === 'pendente' ? ROTULO_FORA_DO_LOOP : c.task;
}

// ---------- projeção ----------

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const msDe = (ev: Evento): number => Date.parse(String(ev.ts));
const chaveEv = (ev: Evento): string => `${ev.sessao}\u0000${ev.seq}\u0000${ev.ts}\u0000${ev.tipo}`;
function ordemId(a: string, b: string): number {
  const ma = /^(.*?)(\d+)$/.exec(a), mb = /^(.*?)(\d+)$/.exec(b);
  if (ma !== null && mb !== null && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return cmp(a, b);
}

/** `entrega.encerrada` é o último entre encerrada e reaberta. */
function encerrada(eventos: Evento[]): boolean {
  let ultimo: string | null = null;
  for (const ev of eventos) if (ev.tipo === 'entrega.encerrada' || ev.tipo === 'entrega.reaberta') ultimo = ev.tipo;
  return ultimo === 'entrega.encerrada';
}

/** Colunas do quadro FL1 sem `fluxo.status.FL1` legível (F6): nomes e chaves. */
const COLUNAS_FL1_PADRAO = ['Preparado', 'Em execução', 'Revisão e teste', 'Pronto para liberar', 'Concluído', 'preparado', 'em_execucao', 'revisao', 'pronto', 'concluido'];

/**
 * Colunas do quadro FL1 (REQ-PRJ-2 a): as chaves e os valores de `fluxo.status.FL1` (`statusCfg`), normalizados (sem acento, caixa e espaço nas
 * pontas). Sem objeto legível (ausente, não objeto, vazio, sem valor texto) ⇒ os 5 nomes e as 5 chaves padrão.
 */
export function colunasFl1(statusCfg: unknown): Set<string> {
  const cols = new Set<string>();
  if (typeof statusCfg === 'object' && statusCfg !== null && !Array.isArray(statusCfg)) {
    for (const [k, v] of Object.entries(statusCfg as Record<string, unknown>)) {
      if (typeof v !== 'string' || semAcento(v) === '') continue;
      cols.add(semAcento(k));
      cols.add(semAcento(v));
    }
  }
  return cols.size > 0 ? cols : new Set(COLUNAS_FL1_PADRAO.map(semAcento));
}

/** Predicado único (REQ-PRJ-2 a; o doctor o importa do `dist/`): `status` é coluna do quadro FL1? */
export function ehColunaFl1(status: string, statusCfg?: unknown): boolean {
  return colunasFl1(statusCfg).has(semAcento(status));
}

type Fonte = { idx: number; caminho: string };

export function projetarProjeto(arvores: ArvoreLida[], opcoes: { agoraMs: number; fuso: string; idPadrao?: RegExp; avisos?: string[]; statusFl1?: unknown; opcoesComoContagem?: boolean }): EstadoProjeto {
  // D-G27: só o booleano `true` liga; a borda lê a config, o núcleo nunca
  const opcoesLigadas = opcoes.opcoesComoContagem === true;
  let nOpcoes = 0;
  const idPadrao = opcoes.idPadrao ?? ID_PADRAO;
  const avisos = [...(opcoes.avisos ?? [])];
  const cards = new Map<string, Array<Card & Fonte & { textoMd: string | null }>>();
  const entregas = new Map<string, Array<ArvoreLida['entregas'][number] & Fonte>>();
  arvores.forEach((a, idx) => {
    for (const c of a.cards ?? []) {
      const card = cardDe(c.arquivo, c.texto, idPadrao);
      if (card !== null) cards.set(card.id, [...(cards.get(card.id) ?? []), { ...card, idx, caminho: a.caminho, textoMd: c.planoMd }]);
    }
    for (const e of a.entregas ?? []) {
      if (idPadrao.test(e.id)) entregas.set(e.id, [...(entregas.get(e.id) ?? []), { ...e, idx, caminho: a.caminho }]);
    }
  });
  const ids = [...new Set([...cards.keys(), ...entregas.keys()])].sort(ordemId);
  const linhas: LinhaProjeto[] = [];
  const diarios: Array<{ id: string; eventos: Evento[] }> = [];
  for (const id of ids) {
    // card: o mais novo (atualizadoEm); empate ⇒ o da árvore que vem antes (a atual)
    const card = [...(cards.get(id) ?? [])].sort((a, b) => cmp(b.atualizadoEm ?? '', a.atualizadoEm ?? '') || a.idx - b.idx)[0] ?? null;
    const ents = [...(entregas.get(id) ?? [])].sort((a, b) => a.idx - b.idx);
    // diário: união das árvores, evento repetido conta 1 vez
    const vistos = new Set<string>();
    const eventos: Evento[] = [];
    for (const e of ents) {
      if (e.eventos === null) { avisos.push(`${id}: diário ilegível em ${e.caminho}`); continue; }
      for (const ev of e.eventos) { const k = chaveEv(ev); if (!vistos.has(k)) { vistos.add(k); eventos.push(ev); } }
    }
    eventos.sort((a, b) => msDe(a) - msDe(b) || cmp(String(a.sessao), String(b.sessao)) || a.seq - b.seq);
    // REQ-PRJ-2 (b, c): com a chave ligada, card COM status fora do quadro FL1 é opção (não vira linha); a medição vence o card; diário ilegível conta como medição (nunca ausência)
    const medido = ents.some((e) => e.plano !== null) || ents.some((e) => e.eventos === null) || eventos.some((ev) => TIPOS_DE_TASK.includes(ev.tipo));
    if (opcoesLigadas && card !== null && card.status !== null && !ehColunaFl1(card.status, opcoes.statusFl1) && !medido) { nOpcoes++; continue; }
    if (eventos.length > 0) diarios.push({ id, eventos });
    const feito = (card !== null && semAcento(card.status ?? '') === 'concluido') || encerrada(eventos);
    // plano: inválido ⇒ "?" (nunca o .md nem plano velho); sem plano.json, o .md do card
    const comJson = escolherPlanoJson(ents);
    let plano: LinhaProjeto['plano'] = null;
    let taskIds: string[] | null = null;
    let motivo: string | null = null;
    let origem = card?.caminho ?? ents[0]?.caminho ?? '';
    if (comJson !== undefined && comJson.plano !== null) {
      origem = comJson.caminho;
      if (!comJson.plano.ok) motivo = comJson.plano.motivo;
      else {
        const v = validarPlano(comJson.plano.bruto);
        if (v.ok) { plano = 'json'; taskIds = v.plano.tasks.map((t) => t.id); } else motivo = v.erro;
      }
    } else if (card !== null && card.planoMd !== null) {
      if (card.textoMd === null) motivo = `plano ${card.planoMd} não encontrado`;
      else {
        const ts = tasksDoPlanoMd(card.textoMd);
        if (ts.length > 0) { plano = 'md'; taskIds = ts; origem = card.caminho; }
      }
    }
    let tasks: TasksLinha | null = null;
    if (taskIds !== null) {
      const norm = (t: unknown): string | null => (typeof t !== 'string' ? null : plano === 'md' && /^\d+[a-z]?$/.test(t) ? `T${t}` : t);
      let integradas = 0, fora = 0;
      for (const t of taskIds) {
        const doTask = eventos.filter((ev) => TIPOS_DE_TASK.includes(ev.tipo) && norm((ev.dados ?? {}).task) === t);
        const r = estadoDe(doTask);
        if ('invalido' in r) { avisos.push(`${id} ${t}: estado inválido no diário (${r.invalido})`); continue; }
        if (r.estado === 'integrada') integradas++;
        else if (r.estado === 'adiada' || r.estado === 'cortada') fora++;
      }
      const total = taskIds.length - fora;
      // p.2: PBI concluído sem registro das tasks no diário ⇒ o que falta registrar é ESTIMADO como feito, sinalizado, nunca medido
      const estimadas = feito ? total - integradas : 0;
      tasks = { total, integradas, estimadas, restantes: total - integradas - estimadas, fora };
    }
    const semPlano = tasks === null;
    const pctDe = (n: number): number | null => (tasks === null || tasks.total <= 0 ? null : Math.round((n / tasks.total) * 100));
    const pct = tasks === null ? null : pctDe(tasks.integradas);
    const pctComEstimadas = tasks === null ? null : pctDe(tasks.integradas + tasks.estimadas);
    const texto = motivo !== null ? '? plano inválido'
      : tasks === null ? (feito ? 'feito, sem plano' : 'sem plano')
        : feito ? (tasks.estimadas > 0 ? `feito (${tasks.estimadas} tasks estimadas)` : 'feito')
          : pct === null ? '? sem task no plano' : `${pct} % (${tasks.integradas} de ${tasks.total})`;
    linhas.push({
      id, titulo: card?.titulo ?? null, status: card?.status ?? null, feito, plano, semPlano, tasks, pct, pctComEstimadas, texto, motivo,
      fase: plano === 'json' ? null : ROTULO_FASE_NAO_MEDIDA, origem,
    });
  }
  // totais: medidas e estimadas separadas (p.2); o sem plano fica fora da conta
  let tasks = 0, integradas = 0, estimadas = 0;
  for (const l of linhas) {
    if (l.tasks === null) continue;
    tasks += l.tasks.total;
    integradas += l.tasks.integradas;
    estimadas += l.tasks.estimadas;
  }
  const restantes = tasks - integradas - estimadas;
  const foraDaConta = linhas.filter((l) => l.semPlano).length;
  return {
    linhas,
    totais: {
      pbis: linhas.length, opcoes: nOpcoes, feitos: linhas.filter((l) => l.feito).length, foraDaConta, tasks, integradas, estimadas, restantes,
      pct: tasks > 0 ? Math.round((integradas / tasks) * 100) : null,
      pctComEstimadas: tasks > 0 ? Math.round(((integradas + estimadas) / tasks) * 100) : null,
      previsao: previsaoDoProjeto(linhas, diarios, restantes, opcoes.agoraMs, opcoes.fuso),
    },
    avisos,
  };
}

/** Item 3: o mesmo ritmo medido da T30 (relógio por task integrada), sobre todas as entregas do projeto. Sem ritmo ⇒ `?` com motivo. */
function previsaoDoProjeto(linhas: LinhaProjeto[], diarios: Array<{ id: string; eventos: Evento[] }>, restantes: number, agoraMs: number, fuso: string): PrevisaoProjeto {
  const ritmo = ritmoDasAnteriores(diarios, null);
  if (ritmo === null || !Number.isFinite(ritmo) || ritmo <= 0) return { ritmoS: null, medida: null, estimada: null, motivo: 'sem ritmo medido: nenhuma task integrada no projeto' };
  const hora = (s: number): string => horaLocal(agoraMs + s * 1000, agoraMs, fuso);
  const medidaS = ritmo * restantes;
  const medida = { restanteS: medidaS, hora: hora(medidaS) };
  const est = estimativaSemPlano(linhas);
  if (est === null) return { ritmoS: ritmo, medida, estimada: null, motivo: null };
  if ('motivo' in est) return { ritmoS: ritmo, medida, estimada: null, motivo: est.motivo };
  const tasks = est.tasksPorPbi * est.abertos;
  const estS = medidaS + ritmo * tasks;
  const h = hora(estS);
  const texto = `~${Math.round(tasks)} tasks estimadas em ${est.abertos} PBIs sem plano, até ~${h}`;
  return { ritmoS: ritmo, medida, estimada: { restanteS: estS, hora: h, pbisSemPlano: est.abertos, tasksPorPbi: est.tasksPorPbi, tasks, texto }, motivo: null };
}

/**
 * Emenda 19 p.5 (D-G13): PBIs sem plano e não concluídos × mediana de tasks dos PBIs com plano; só para a previsão, nunca no %.
 * `null` = nenhum PBI sem plano aberto.
 */
function estimativaSemPlano(linhas: LinhaProjeto[]): { abertos: number; tasksPorPbi: number } | { motivo: string } | null {
  const abertos = linhas.filter((l) => l.semPlano && !l.feito).length;
  if (abertos === 0) return null;
  const porPbi = linhas.filter((l) => l.tasks !== null && l.tasks.total > 0).map((l) => (l.tasks as TasksLinha).total);
  if (porPbi.length === 0) return { motivo: `sem PBI com plano para estimar os ${abertos} sem plano` };
  return { abertos, tasksPorPbi: mediana(porPbi) };
}

/**
 * Emenda 19 p.3p (D-G13): entre worktrees vale o `plano.json` cujo último commit é o mais recente. Empate, ou alguma árvore sem data de commit
 * (sem git, não versionado) ⇒ o da árvore atual (`ents` vem com a atual primeiro, depois a ordem do git).
 */
function escolherPlanoJson<T extends { plano: unknown; planoCommitMs?: number | null }>(ents: T[]): T | undefined {
  const com = ents.filter((e) => e.plano !== null);
  if (com.length === 0) return undefined;
  const data = (e: T): number | null => (typeof e.planoCommitMs === 'number' && Number.isFinite(e.planoCommitMs) ? e.planoCommitMs : null);
  if (com.some((e) => data(e) === null)) return com[0];
  let melhor = com[0];
  for (const e of com.slice(1)) if ((data(e) as number) > (data(melhor) as number)) melhor = e;
  return melhor;
}

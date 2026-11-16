/**
 * Testes do painel em 5 blocos (GM-14 T17; REQ-GLB-1, REQ-DEP-1, REQ-LNG-1; FIEL-3 b, FIEL-4, FIEL-5, FIEL-6 b, FIEL-7, FIEL-10..13, N17 b).
 * Estado novo = `projetarPainel(plano | null, eventos, entrada & { fatos })`; render = `renderPainel` (um renderizador só, `ludico` pelo preset).
 * P9: os estados saem de `projetarPainel` real, que chama `trilhaDe`, `perguntasAbertas` e `dependeDe` reais (sem stub).
 * Mutações: .superpowers/sdd/2026-11-11-proxima/task-17-mut.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projetarPainel, renderPainel, TABELA_PARAR } from '../src/painel.ts';
import { fraseHistorico, historicoDe, paraTexto } from '../src/painel-texto.ts';
import { PAPEL_EXECUTIVO } from '../src/painel-executivo.ts';
import { orcamentoDe } from '../src/orcamento.ts';
import { renderBlocos, renderEsquadrao } from '../src/painel-esquadrao.ts';
import { linhaTecnica } from '../src/origem.ts';
import { colunas } from '../src/painel-largura.ts';
import type { FatosTrilha } from '../src/trilha.ts';
import type { AgenteVivo, EntradaPainel, EstadoPainel, Evento, MotivoParar, OpcoesRender, Plano, TipoEvento } from '../src/tipos.ts';

const T0 = Date.parse('2026-11-11T12:00:00Z');
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const AGORA = T0 + 3 * 3_600_000;

type Item = { t: number; tipo: TipoEvento; dados?: unknown; sessao?: string; agente?: string };
const e = (t: number, tipo: TipoEvento, dados: unknown = {}, sessao = 's1', agente = 'orquestrador'): Item => ({ t, tipo, dados, sessao, agente });
function D(itens: Item[]): Evento[] {
  const seqs = new Map<string, number>();
  return [...itens].map((x, i) => ({ x, i })).sort((a, b) => a.x.t - b.x.t || a.i - b.i).map(({ x }) => {
    const sessao = x.sessao ?? 's1';
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    return { seq, ts: iso(x.t), autor: 't', sessao, agente: x.agente ?? 'orquestrador', tipo: x.tipo, dados: x.dados, hash_anterior: null } as unknown as Evento;
  });
}
const ini = (t: number, task: string, papel = 'implementador') => e(t, 'task.iniciada', { task, papel });
const con = (t: number, task: string) => e(t, 'task.concluida', { task });
const ver = (t: number, task: string, ok: boolean, rodada = 1, major = 0) => e(t, 'review.veredito', { task, veredito: ok ? 'APROVADO' : 'REPROVADO', rodada, major, blocker: 0 });
const integ = (t: number, task: string, extra: Record<string, unknown> = {}) => e(t, 'task.integrada', { task, ...extra });
const ciclo = (task: string, a: number): Item[] => [ini(a, task), con(a + 1, task), ini(a + 2, task, 'revisor'), ver(a + 5, task, true), integ(a + 6, task)];
const noTeto = (task: string, a: number): Item[] => [
  ini(a, task), con(a + 1, task), ini(a + 2, task, 'revisor'), ver(a + 3, task, false, 1, 1),
  ini(a + 4, task, 'correcao'), con(a + 5, task), ini(a + 6, task, 'revisor'), ver(a + 7, task, false, 2, 1),
];
const DEC = (t: number, resposta: string, task = 'T3') => e(t, 'decisao.sombra', { pergunta_hash: 'a'.repeat(64), task, resposta, arquivo: 'sombra.md', pergunta_enviesada: false, fontes: ['spec:1'] });
const nota = (t: number, tipo: string, texto: string, extra: Record<string, unknown> = {}, sessao = 's1') => e(t, 'nota', { tipo, texto, ...extra }, sessao);

const ID_PADRAO = '[A-Z]+-\\d+';
const IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const P = (...ids: string[]): Plano => ({ entrega: 'GM-14', tasks: ids.map((id) => ({ id, deps: [], arquivos: [] })) });
const PACOTE = { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['ARAGORN', 'LEGOLAS', 'GIMLI', 'FRODO', 'SAM', 'MERRY', 'PIPPIN', 'BOROMIR'] };
const fatos = (extra: Partial<FatosTrilha> = {}): FatosTrilha => ({
  branch: 'enabler/GM-14-clareza', idPadrao: ID_PADRAO, specs: [], plano: { tasks: IDS }, ledger: false, gh: 'ok', ultimas: [], sessao: 's1', ...extra,
});
type Entrada = EntradaPainel & { fatos?: FatosTrilha; fontesFalhas?: string[]; pousoPendente?: boolean; desatualizadoS?: number | null; fora?: boolean; ultima?: { id: string; estado: string | null } | null };
const entrada = (extra: Partial<Entrada> = {}): Entrada => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: 40, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
  pacote: PACOTE, notificacao: null, agoraMs: AGORA, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
  entregaId: 'GM-14', modeloSessao: null, specSha: null, tetoSombra: 26, fatos: fatos(), ...extra,
} as Entrada);
const proj = (plano: Plano | null, itens: Item[] | null, extra: Partial<Entrada> = {}): EstadoPainel =>
  projetarPainel(plano, itens === null ? null : D(itens), entrada(extra) as EntradaPainel & { fatos: FatosTrilha });
const vivo = (description: string, status = 'running', type = 'general-purpose'): AgenteVivo => ({ id: `a-${description}`, type, description, status, uso: null });
/** GM-15 T29 (D-G1b): o desenho é o do E4. `cru` = as linhas desenhadas; `linhas` = sem os separadores `─` e sem o rótulo do preset à direita do cabeçalho (layout, não regra). */
const SEP = /^─+$/;
const semRotulo = (l: string): string => l.replace(/ {2,}(esquadrão( · .*)?|executivo)$/, '');
const cru = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string[] =>
  paraTexto(renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 200, ...o }), 'mono').split('\n').filter((l) => l !== '');
const linhas = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string[] => cru(s, o).filter((l) => !SEP.test(l)).map(semRotulo);
const texto = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string => linhas(s, o).join('\n');
/** Igualdade módulo as trocas do E4 com pouca altura (mesma informação): barra de largura diferente, contexto com o nome do líder, item com o `◆` do rótulo. */
const norm = (x: string): string => x.replace(/[█░]+/g, '#').replace(/^(│ {2}|\S+ )ctx /, 'ctx ').replace(/^◆ (?!ATENÇÃO|DEPENDE)/, '  ');
/** Linhas do RECENTE no desenho do E4 (histórico `hh:mm <glifo> …`; hora sem leitura = "?"). */
const ehRecente = (x: string): boolean => /^(\d\d:\d\d|\?) [✓✗●○?] /.test(x);
/** Itens do topo (DEPENDE): PAROU, `depende de você: …` e os itens recuados; sem o rótulo `◆ DEPENDE DE VOCÊ` (desenho) e sem continuações. */
const itensTopo = (xs: string[]): string[] => {
  const fimTopo = xs.findIndex((x, i) => i > 0 && /^(PLANO|FASE|EQUIPE|última entrega|◆ ATENÇÃO)/.test(x) || ehRecente(x));
  return xs.slice(1, fimTopo < 0 ? xs.length : fimTopo).filter((x) => !/^◆ DEPENDE DE VOCÊ|^    /.test(x));
};
/**
 * Prioridade de corte (D-P8) de cada linha do desenho, pelo padrão do E4: 1 topo · 2 cabeçalho, PLANO/FASE, última entrega · 3 orquestrador
 * (ctx), agentes, linha-resumo, FIEL-4 · 4 ATENÇÃO · 5 RECENTE · 6 o que só o E4 tinha (tasks, fila, faixa, limites, rótulos, nome do líder, narração, rodapé).
 */
const prioDe = (x: string): number => {
  if (/^(GABARITO|PLANO|FASE|última entrega)/.test(x)) return 2;
  if (/^◆ DEPENDE DE VOCÊ|^EQUIPE {2,}|^\S+ {2}orquestra|^│ {1,2}(5h|7d|▸)|^SEGUNDO PLANO|^segundo plano:|^CI ●|^ {2}[●○◐✓✗?] |^[●○◐✓✗?] T|^○ /.test(x)) return 6;
  if (/^│ {2}ctx |^\S+ ctx |^[├└]─? [●○]|^ {2}\d+ agentes:|^EQUIPE · /.test(x)) return 3;
  if (/^ {2}◦ /.test(x)) return 7; // SEGUNDO PLANO (GM-15 T33, g.11): a 1ª a encolher
  if (/^◆ ATENÇÃO|^ {11}\S/.test(x)) return 4;
  if (ehRecente(x)) return 5;
  return 1;
};

/** Execução: T1..T3 integradas, T4 implementando, T5 em revisão, T6 pendente. */
const EXECUCAO: Item[] = [...ciclo('T1', 0), ...ciclo('T2', 10), ...ciclo('T3', 20), ini(40, 'T4'), ini(41, 'T5'), con(42, 'T5'), ini(43, 'T5', 'revisor')];
const RECENTES: Item[] = [
  ...ciclo('T1', 0), ...ciclo('T2', 10),
  ini(30, 'T3'), con(31, 'T3'), ini(32, 'T3', 'revisor'), ver(33, 'T3', false, 1, 2),
  DEC(34, 'seguir com a T3'),
  e(35, 'loop.pausa', { estado: 'pausado' }), e(36, 'loop.pausa', { estado: 'retomado' }),
];

// ───────────────────────────── orçamento e prioridade (REQ-GLB-1, Review Focus 1)

test('orcamento-1-parou-vence-pergunta: com PAROU e pergunta aberta e 1 linha, o topo é o PAROU e a pergunta vai a (+1)', () => {
  const s = proj(P(...IDS), [...noTeto('T1', 0), e(20, 'loop.parar', { motivo: 'teto_rodadas', task: 'T1' }), nota(21, 'duvida', 'qual caminho seguir?', { opcoes: ['este', 'aquele'] })]);
  assert.ok(s.parar !== null);
  assert.equal(s.pergunta?.texto, 'qual caminho seguir?');
  const l = linhas(s, { orcamento: 1 });
  assert.equal(l.length, 1);
  assert.match(l[0], /^■ PAROU \d\d:\d\d · teto de rodadas de review em T1/);
  assert.match(l[0], /\(\+\d+\)$/, 'o que não coube vira (+N), nunca some em silêncio');
  const n = Number(/\(\+(\d+)\)$/.exec(l[0])?.[1]);
  const todas = itensTopo(linhas(s));
  assert.ok(n >= 1 && n === todas.length - 1, `(+${n}) = itens do topo que não couberam (${todas.length - 1})`);
  // com 2 linhas a pergunta entra logo depois do PAROU (o rótulo `◆ DEPENDE DE VOCÊ` sai antes e o item leva o `◆`)
  const l2 = linhas(s, { orcamento: 2 });
  assert.match(l2[1], /^◆ qual caminho seguir\?/);
});

test('mais-n-so-se-nao-cabe: lista do topo que cabe inteira não ganha (+N); que não cabe, ganha', () => {
  const s = proj(P(...IDS), [nota(1, 'pendencia', 'renovar o certificado'), nota(2, 'pendencia', 'pagar a conta')]);
  const todas = linhas(s);
  assert.ok(todas.some((x) => /renovar o certificado/.test(x)) && todas.some((x) => /pagar a conta/.test(x)));
  for (const orc of [5, 9, 40]) assert.ok(linhas(s, { orcamento: orc }).every((x) => !/\(\+\d+\)/.test(x)), `orçamento ${orc}: cabe, sem (+N)`);
  const curto = linhas(s, { orcamento: 1 });
  assert.equal(curto.length, 1);
  assert.match(curto[0], /^◆ renovar o certificado.*\(\+1\)$/);
});

test('prioridades-por-h-e-maxrows: 9 pares de H × maxRows ⇒ ≤ orçamento, topo presente, blocos de cima antes dos de baixo, 0 "N more"', () => {
  const s = proj(P(...IDS), [...EXECUCAO, ...RECENTES.slice(-3), nota(50, 'pendencia', 'renovar o certificado')], {
    agentes: [vivo('T4 implementador'), vivo('T5 revisor')],
  });
  const pares: [number | undefined, number][] = [[50, 20], [40, 15], [24, 7], [20, 5], [50, 50], [24, 24], [20, 20], [24, 6], [50, 19]];
  const cheio = linhas(s);
  for (const [h, maxRows] of pares) {
    const orc = orcamentoDe(h, maxRows);
    const bruto = cru(s, { orcamento: orc });
    const l = linhas(s, { orcamento: orc });
    assert.ok(bruto.length <= orc, `H ${h} maxRows ${maxRows}: ${bruto.length} > ${orc}`);
    assert.ok(bruto.length >= Math.min(orc, cheio.length), `H ${h} maxRows ${maxRows}: sobrou linha vazia`);
    assert.ok(l.some((x) => /renovar o certificado/.test(x)), `H ${h}: topo sumiu`);
    assert.ok(l.every((x) => !/\bmore\b/.test(x)), 'sem "N more"');
    const maxPrio = Math.max(...l.map(prioDe));
    const presentes = new Set(l);
    // trocas do E4 (mesma informação): o item do topo leva o `◆` do rótulo; a linha do contexto leva o nome do líder
    const normais = new Set(l.map(norm));
    const presente = (x: string): boolean => presentes.has(x) || normais.has(norm(x));
    // exceção declarada (emenda 37, 2ª ao D-P8): com a decisão da Sombra, o AGORA encolhe para a linha-resumo `N agentes:` antes de o RECENTE sair
    const resumido = l.some((x) => /^  \d+ agentes:/.test(x));
    for (const x of cheio) if (prioDe(x) < maxPrio && !(resumido && /^[├└]/.test(x))) assert.ok(presente(x) || /\(\+\d+\)/.test(l.join('\n')), `H ${h}: "${x}" (prio ${prioDe(x)}) saiu antes de prio ${maxPrio}`);
  }
});

test('blocos-na-ordem-e-vazios-somem: cabeçalho · DEPENDE · PLANO · EQUIPE · ATENÇÃO · histórico (desenho do E4); bloco sem conteúdo não ocupa linha', () => {
  const cheio = proj(P(...IDS), [...EXECUCAO, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] });
  const l = linhas(cheio);
  const rotulos = l.map((x) => (ehRecente(x) ? 'RECENTE' : /^(GABARITO|depende de você|◆ DEPENDE DE VOCÊ|PLANO|FASE|EQUIPE|◆ ATENÇÃO|CI ●)/.exec(x)?.[1])).filter((x) => x !== undefined)
    .filter((x, i, xs) => i === 0 || xs[i - 1] !== x);
  assert.deepEqual(rotulos, ['GABARITO', 'depende de você', 'PLANO', 'EQUIPE', '◆ ATENÇÃO', 'RECENTE', 'CI ●']);
  // separadores do E4 entre as seções, nunca 2 colados
  const c = cru(cheio);
  assert.ok(c.some((x) => SEP.test(x)) && c.every((x, i) => !(SEP.test(x) && SEP.test(c[i + 1] ?? ''))), c.join('\n'));
  const semAtencao = linhas(proj(P(...IDS), [...ciclo('T1', 0)], { agentes: [] }));
  assert.ok(semAtencao.every((x) => !/ATENÇÃO/.test(x)), 'ATENÇÃO vazio some');
  const semRecente = linhas(proj(P(...IDS), [ini(0, 'T1')], { agentes: [vivo('T1 implementador')] }));
  assert.ok(semRecente.every((x) => !ehRecente(x)), 'RECENTE vazio some');
  assert.ok(l.every((x) => !/\bT[123] integrada\b|^\s*✓ T[123]\b/.test(x)), 'task integrada não é listada');
  assert.ok(l.some((x) => /^  ✓ 3 integradas/.test(x)), 'a faixa do E4 diz quantas, sem listar');
});

// ───────────────────────────── RECENTE (FIEL-10 d, D-P9)

test('recente-5-lateral-2-acima e recente-so-resultados: só aprovou/reprovou/integrou/travou/decisão/pausa, mais novo no topo, com origem', () => {
  const s = proj(P(...IDS), RECENTES);
  const lat = linhas(s, { local: 'lateral' });
  const rec = (xs: string[]) => xs.filter(ehRecente);
  const r5 = rec(lat);
  assert.equal(r5.length, 5);
  assert.match(r5[0], /pausa \(você\)$/, 'mais novo no topo; retomar do dono também é "pausa (você)"');
  assert.match(r5[1], /pausa \(você\)$/);
  assert.match(r5[2], /ELROND decidiu: seguir com a T3 \(anotado pelo orquestrador\)$/);
  assert.match(r5[3], /reprovou T3 · 2 achados \(automático\)$/);
  assert.match(r5[4], /integrou T2 \(automático\)$/);
  const tudo = lat.join('\n');
  assert.doesNotMatch(tudo, /despachou|iniciou|entregou/, 'despachou/iniciou/entregou fora');
  const r2 = rec(linhas(s, { local: 'acima' }));
  assert.equal(r2.length, 2);
  assert.match(r2[0], /pausa \(você\)$/);
  assert.match(r2[1], /pausa \(você\)$/);
  assert.equal(rec(linhas(s)).length, 5, 'local ausente = lateral');
});

test('recente-encolhe-primeiro-acima: com pouco orçamento o RECENTE sai antes do AGORA e do ATENÇÃO', () => {
  const s = proj(P(...IDS), [...EXECUCAO, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] });
  const cheio = linhas(s, { local: 'acima' });
  // no desenho do E4 as linhas que só ele tinha (prio 6: tasks, limites, rodapé…) saem antes; o que sobra = blocos 1–4 sem o RECENTE
  const semRecente = cheio.filter((x) => !ehRecente(x) && prioDe(x) < 5);
  assert.ok(cheio.some(ehRecente) && cheio.some((x) => /^◆ ATENÇÃO/.test(x)), 'premissa: há RECENTE e ATENÇÃO');
  const l = linhas(s, { local: 'acima', orcamento: semRecente.length });
  assert.deepEqual(l.map(norm), semRecente.map(norm)); // `norm`: o contexto do líder leva o nome quando a linha do nome sai (troca do E4)
});

// ───────────────────────────── PRONTO / FASE (FIEL-10 b)

test('pronto-pinta-so-integradas: aprovada esperando não pinta; integrada não é listada', () => {
  const s = proj(P(...IDS), [...ciclo('T1', 0), ini(10, 'T2'), con(11, 'T2'), ini(12, 'T2', 'revisor'), ver(13, 'T2', true)]);
  assert.deepEqual(s.pronto, { integradas: 1, total: 6, previsao: null });
  const l = linhas(s).find((x) => /^PLANO/.test(x)) as string;
  assert.match(l, /^PLANO   ▰{4}▱{17}  17%  1\/6 tasks +ETA \?: n insuficiente$/, 'barra do E4 (21) pinta só a integrada: 1/6 ≈ 4 de 21; a ETA sem base diz por quê (g.9)');
  assert.match(linhas(s, { largura: 80 }).find((x) => /^PLANO/.test(x)) as string, /1\/6 tasks$/, 'abaixo de 100 colunas fica só o "?" (sem o motivo)');
  assert.ok(linhas(s).some((x) => /^  ◐ T2 +aprovada/.test(x)), 'a aprovada esperando aparece na fila do E4, sem pintar');
});

test('previsao-so-com-base: previsão só com ≥ 3 integradas nesta entrega, dita com a base', () => {
  const dois = proj(P(...IDS), [...ciclo('T1', 0), ...ciclo('T2', 10)]);
  assert.equal(dois.pronto?.previsao, null);
  assert.doesNotMatch(texto(dois), /previsão/);
  const tres = proj(P(...IDS), [...ciclo('T1', 0), ...ciclo('T2', 10), ...ciclo('T3', 20)]);
  assert.equal(tres.pronto?.previsao?.base, 3);
  assert.match(texto(tres), /^PLANO   ▰+▱+  50%  3\/6 tasks +previsão \d\d:\d\d \(base: 3 tasks desta entrega\)$/m);
});

test('fase-fora-de-entrega: sem plano, a linha FASE mostra n de 7, barra só de ✓, progresso e a trilha', () => {
  const spec = { caminho: 'docs/superpowers/specs/x.md', pbi: 'GM-14', sha256: 'a'.repeat(64), secoes: 6, titulo: 'Clareza' };
  const s = proj(null, [e(1, 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } })], { fatos: fatos({ plano: null, specs: [spec] }) });
  assert.equal(s.modo, 'entrega');
  assert.equal(s.pronto, null);
  const l = linhas(s).find((x) => /^FASE/.test(x)) as string;
  assert.equal(l, 'FASE 3 de 7 ▰▰▱▱▱▱▱ · spec com 6 seções · falta aprovar · ✓ ideia › ✓ spec › ● aprovação › ○ plano › ○ execução › ○ PR › ○ uso');
  assert.ok(linhas(s).every((x) => !/^PLANO/.test(x)), 'em-loop-sem-linha-de-trilha: FASE e PLANO nunca juntos');
  const exec = proj(P(...IDS), EXECUCAO);
  assert.ok(linhas(exec).every((x) => !/^FASE/.test(x)), 'em execução a linha PRONTO, não a FASE');
});

test('uma-linha-sem-entrega-em-curso e fora-de-um-projeto', () => {
  const sem = proj(null, [], { fatos: fatos({ branch: 'main', plano: null }), ultima: { id: 'GM-13', estado: 'publicada' } });
  assert.deepEqual(linhas(sem), ['GABARITO · sem entrega em curso · última: GM-13 (publicada)']);
  const nenhuma = proj(null, [], { fatos: fatos({ branch: 'main', plano: null }) });
  assert.deepEqual(linhas(nenhuma), ['GABARITO · sem entrega em curso']);
  const fora = proj(null, [], { fatos: fatos({ branch: null, plano: null }), fora: true });
  assert.equal(fora.modo, 'fora');
  assert.deepEqual(linhas(fora), ['GABARITO · fora de um projeto']);
  // sem entrega MAS com pendência: não é uma linha, o topo aparece
  const comPendencia = proj(null, [nota(1, 'pendencia', 'renovar o certificado')], { fatos: fatos({ branch: 'main', plano: null }) });
  assert.match(texto(comPendencia), /^◆ DEPENDE DE VOCÊ {2}1 item\n {2}renovar o certificado \[feito\]$/m);
  assert.equal(comPendencia.modo, 'projeto');
});

// ───────────────────────────── DEPENDE (REQ-DEP-1, FIEL-13)

test('nada-so-com-todas-as-fontes: fixture 18:40 com T12 no limite ⇒ item (5), nunca "nada"; fonte que falhou ⇒ "?"', () => {
  const s = proj(P('T11', 'T12', 'T13'), noTeto('T12', 0), { fatos: fatos({ plano: { tasks: ['T11', 'T12', 'T13'] } }) });
  const t = texto(s);
  assert.match(t, /^◆ DEPENDE DE VOCÊ {2}1 item\n {2}decidir a T12: chegou ao limite de revisões \[liberar mais uma rodada\]$/m);
  assert.doesNotMatch(t, /depende de você: nada/);
  const falhou = proj(P(...IDS), [], { fontesFalhas: ['o GitHub'] });
  assert.match(texto(falhou), /depende de você: \? \(não consegui ler o GitHub\)/);
  assert.doesNotMatch(texto(falhou), /nada/);
  const ilegivel = proj(P(...IDS), null);
  assert.match(texto(ilegivel), /não consegui ler o diário/);
  const tudoOk = proj(P(...IDS), []);
  assert.match(texto(tudoOk), /^depende de você: nada$/m);
});

test('limpar-no-depende: pouso pendente ⇒ "limpar a conversa" com o botão, sem o comando no texto', () => {
  const s = proj(P(...IDS), [], { pousoPendente: true });
  const t = texto(s);
  assert.match(t, /^◆ DEPENDE DE VOCÊ {2}1 item\n {2}limpar a conversa \[limpar\]$/m);
  assert.doesNotMatch(t, /\/clear/);
  assert.deepEqual(s.depende.find((i) => i.motivo === 'limpar a conversa')?.acoes, [{ rotulo: 'limpar', comando: '/clear' }]);
});

test('desatualizado-atencao-e-nunca-nada: passou de 180 s ⇒ ATENÇÃO e o topo nunca diz "nada"', () => {
  const s = proj(P(...IDS), [], { desatualizadoS: 600 });
  const t = texto(s);
  assert.match(t, /^◆ ATENÇÃO {2}painel sem ler o diário há 10 min$/m);
  assert.doesNotMatch(t, /depende de você: nada/);
  assert.match(t, /depende de você: \?/);
  const dentro = proj(P(...IDS), [], { desatualizadoS: 180 });
  assert.match(texto(dentro), /depende de você: nada/);
  assert.doesNotMatch(texto(dentro), /ATENÇÃO/);
});

test('pergunta-real-pelo-projetar (P9): nota de dúvida vira pergunta no topo; resposta à outra pergunta não fecha; a que cita o id fecha', () => {
  const base = [nota(1, 'duvida', 'qual caminho seguir?', { opcoes: ['este', 'aquele'] }), nota(2, 'duvida', 'e a cor?', { opcoes: ['azul', 'verde'] })];
  const s = proj(P(...IDS), base);
  assert.equal(s.pergunta?.id, 's1:1');
  assert.equal(s.perguntasMais, 1);
  assert.match(texto(s), /^◆ DEPENDE DE VOCÊ {2}2 itens\n {2}qual caminho seguir\? · 1 este · 2 aquele\n {2}mais 1 pergunta aberta$/m);
  assert.doesNotMatch(texto(s), /depende de você: nada/, 'com pergunta aberta o topo não diz "nada"');
  const outra = proj(P(...IDS), [...base, e(3, 'dono.resposta', { pergunta: 's1:2', opcao: 1, rotulo: 'azul' }, 'dono')]);
  assert.equal(outra.pergunta?.id, 's1:1', 'resposta a s1:2 não fecha s1:1');
  assert.equal(outra.perguntasMais, 0);
  const fechada = proj(P(...IDS), [...base, e(3, 'dono.resposta', { pergunta: 's1:1', opcao: 2, rotulo: 'aquele' }, 'dono')]);
  assert.equal(fechada.pergunta?.id, 's1:2');
});

const MOTIVOS = Object.keys(TABELA_PARAR) as MotivoParar[];
const recenteDe = (itens: Item[], extra: Partial<Entrada> = {}): string[] => {
  return linhas(proj(P(...IDS), itens, { agentes: null, ...extra }), { local: 'lateral' }).filter(ehRecente);
};

test('recente-origem-da-pausa (emenda 4): pausa e retomada do dono são "pausa (você)", nunca "(automático)"', () => {
  for (const estado of ['pausado', 'retomado']) {
    const r = recenteDe([e(1, 'loop.pausa', { estado })]).join('\n');
    assert.match(r, /\d\d:\d\d \S pausa \(você\)$/m, estado);
    assert.doesNotMatch(r, /pausa[^\n]*\(automático\)/, `${estado}: pausa nunca automática`);
    assert.doesNotMatch(r, /loop pausado|loop retomado/, estado);
  }
});

test('recente-travou-em-palavras-automatico: cada MotivoParar vira "travou: <palavras> (automático)", nunca técnico', () => {
  for (const motivo of MOTIVOS) {
    const r = recenteDe([e(1, 'loop.parar', { motivo, task: 'T1' })]).filter((x) => /travou/.test(x));
    assert.equal(r.length, 1, motivo);
    assert.match(r[0], /\d\d:\d\d \S travou: .+ \(automático\)$/, motivo);
    assert.ok(!linhaTecnica(r[0]), `${motivo}: "${r[0]}"`);
    assert.doesNotMatch(r[0], new RegExp(motivo), `${motivo}: motivo cru`);
    assert.doesNotMatch(r[0], /\(você\)/, motivo);
  }
});

test('recente-motivo-fora-de-MotivoParar-nunca-cru (r3, O4): "o loop travou", sem o motivo, sem técnico', () => {
  const r = recenteDe([e(1, 'loop.parar', { motivo: 'motivo_inventado_xyz', task: 'T1' })]).filter((x) => /travou/.test(x));
  assert.equal(r.length, 1);
  assert.match(r[0], /\d\d:\d\d \S o loop travou \(automático\)$/);
  assert.doesNotMatch(r[0], /motivo_inventado|inventado|xyz/);
  assert.ok(!linhaTecnica(r[0]), r[0]);
});

test('id-de-entrega-natural-se-nao-casa: true_force em `ultima` e em e.id vai por nomeNatural; GM-13 fica cru', () => {
  const ult = (id: string) => texto(proj(null, [], { fatos: fatos({ branch: 'main', plano: null }), ultima: { id, estado: 'publicada' } }));
  assert.equal(ult('true_force'), 'GABARITO · sem entrega em curso · última: true force (publicada)');
  assert.ok(!linhaTecnica(ult('true_force')));
  assert.equal(ult('GM-13'), 'GABARITO · sem entrega em curso · última: GM-13 (publicada)');
  const base = proj(P(...IDS), [], { titulo: null });
  const cabecalho = linhas({ ...base, id: 'true_force' })[0];
  assert.equal(cabecalho, 'GABARITO · true force');
  assert.ok(!linhaTecnica(cabecalho));
  assert.equal(linhas({ ...base, id: 'GM-14' })[0], 'GABARITO · GM-14');
});

test('pergunta-b-pela-sessao-do-fato: fatos.sessao abre a (b) com a opção GM-13 crua no render (R-X6)', () => {
  const s = proj(null, [nota(1, 'desvio', 'usar o painel novo')], { fatos: fatos({ branch: 'main', plano: null, ultimas: [{ id: 'GM-13', data: iso(-60) }] }) }); // ideia não ancora (b) desde a T13b
  assert.equal(s.pergunta?.gatilho, 'b');
  assert.ok(s.pergunta?.opcoes?.some((o) => /GM-13/.test(JSON.stringify(o))), 'opção GM-13 crua no estado');
  assert.match(texto(s), /GM-13/);
  assert.doesNotMatch(texto(s), /GM 13/);
});

test('pergunta-ideia-pelo-perguntasAbertas-real (r3, T13b): opção única "visto", render natural e sem linha técnica', () => {
  const s = proj(P(...IDS), [nota(1, 'ideia', 'usar o painel novo'), nota(2, 'ideia', 'true_force no meu_app.config')]);
  assert.equal(s.pergunta, null, 'a ideia não é pergunta aberta: é o item (4) do "depende de você"');
  const l = linhas(s);
  const q = l.filter((x) => /ideias? viram? a próxima/.test(x));
  assert.deepEqual(q, ['  decidir se as 2 ideias viram a próxima entrega [visto]'], `a ideia sai 1 vez só (item (4)):\n${l.join('\n')}`);
  for (const x of l) assert.ok(!linhaTecnica(x), `técnica: "${x}"`);
  for (const preset of ['esquadrao', 'executivo'] as const) for (const largura of [20, 40, 80, 120]) for (const x of linhas(s, { preset, largura })) {
    assert.ok(!linhaTecnica(x), `técnica ${preset} ${largura}: "${x}"`);
    assert.ok(colunas(x) <= largura, `passou da largura ${preset} ${largura}: "${x}"`);
  }
});

test('ideia-so-no-depende (r2): spec por aprovar + ideia => "aprovar a spec" antes, ideia 1x; orçamento 2 não manda a spec para (+N); dúvida vence a ideia', () => {
  const spec = { caminho: 'docs/superpowers/specs/x.md', pbi: 'GM-14', sha256: 'a'.repeat(64), secoes: 6, titulo: 'Clareza' };
  const f = fatos({ plano: null, specs: [spec] });
  const branch = e(1, 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } });
  const s = proj(null, [branch, nota(2, 'ideia', 'usar o painel novo')], { fatos: f });
  const l = linhas(s);
  const iSpec = l.findIndex((x) => /aprovar a spec da GM-14/.test(x));
  const iIdeia = l.findIndex((x) => /ideia vira a próxima/.test(x));
  assert.ok(iSpec >= 0 && iIdeia > iSpec, `spec antes da ideia:\n${l.join('\n')}`);
  assert.equal(l.filter((x) => /ideia vira a próxima/.test(x)).length, 1, l.join('\n'));
  const curto = linhas(s, { orcamento: 2 });
  assert.ok(curto.some((x) => /aprovar a spec da GM-14/.test(x)), `"aprovar a spec" não cai para (+N):\n${curto.join('\n')}`);
  const comDuvida = proj(P(...IDS), [nota(1, 'ideia', 'usar o painel novo'), nota(2, 'duvida', 'qual caminho seguir?', { opcoes: ['este', 'aquele'] })]);
  const ld = linhas(comDuvida);
  const iD = ld.findIndex((x) => /qual caminho seguir/.test(x));
  const iI = ld.findIndex((x) => /ideia vira a próxima/.test(x));
  assert.ok(iD >= 0 && (iI < 0 || iD < iI), `dúvida antes da ideia:\n${ld.join('\n')}`);
  assert.equal(comDuvida.pergunta?.gatilho, 'd');
});

test('id-de-entrega-intacto: o ID cru aparece no cabeçalho e na pergunta (b), nunca naturalizado', () => {
  const s = proj(null, [e(1, 'fato.medido', { chave: 'agente', fonte: 'mod', valor: { id: 'x', papel: 'implementador', estado: 'running' } })],
    { fatos: fatos({ branch: 'main', plano: null, ultimas: [{ id: 'GM-13', data: iso(-60) }] }) });
  const t = texto(s);
  assert.match(t, /GM-13/);
  assert.doesNotMatch(t, /GM 13/);
  const comId = proj(P(...IDS), [], { titulo: 'GM-14 — Clareza' });
  assert.match(texto(comId), /^GABARITO · GM-14 Clareza$/m);
  assert.match(texto(proj(P(...IDS), [], { titulo: 'gm-14 — Clareza' })), /^GABARITO · GM-14 Clareza$/m, 'prefixo sem diferenciar caixa');
});

// ───────────────────────────── cabeçalho (FIEL-5 a, D-P14)

test('titulo-uma-vez-sem-marcacao: sem o prefixo do ID, sem crase, ** nem _ de ênfase', () => {
  for (const [titulo, esperado] of [
    ['GM-14 — Clareza para quem usa', 'GABARITO · GM-14 Clareza para quem usa'],
    ['GM-14: Clareza', 'GABARITO · GM-14 Clareza'],
    ['GM-14 - Clareza', 'GABARITO · GM-14 Clareza'],
    ['GM-14 – Clareza', 'GABARITO · GM-14 Clareza'],
    ['**Clareza** com `painel` e _ênfase_', 'GABARITO · GM-14 Clareza com painel e ênfase'],
    ['GM-14', 'GABARITO · GM-14'],
  ] as const) {
    const l = linhas(proj(P(...IDS), [], { titulo }));
    assert.equal(l[0], esperado, titulo);
    assert.equal((l.join('\n').match(/GM-14/g) ?? []).length, 1, `${titulo}: ID uma vez`);
  }
});

test('titulo-tira-o-id-cru-antes-de-naturalizar (r3): o prefixo é comparado com e.id CRU; o ID natural aparece uma vez', () => {
  const cab = (id: string, titulo: string) => linhas({ ...proj(P(...IDS), [], { titulo: null }), id, titulo })[0];
  for (const sep of ['—', '–', '-', ':']) {
    assert.equal(cab('true_force', `true_force ${sep} painel novo`), 'GABARITO · true force painel novo', `separador ${sep}`);
  }
  assert.equal(cab('true_force', 'true_force: painel novo'), 'GABARITO · true force painel novo');
  assert.equal(cab('true_force', 'true_force'), 'GABARITO · true force');
  assert.equal(cab('minha_entrega', 'minha_entrega'), 'GABARITO · minha entrega');
  assert.equal(cab('minha_entrega', '**minha_entrega** — `painel`'), 'GABARITO · minha entrega painel');
  assert.equal(cab('GM-14', 'GM-14 — Clareza'), 'GABARITO · GM-14 Clareza');
});

// ───────────────────────────── AGORA (FIEL-3 b, FIEL-4, FIEL-11 a)

test('orquestrador-primeira-linha-do-agora: contexto e hora de pousar; contexto ausente é "?", nunca 0', () => {
  const s = proj(P(...IDS), [ini(0, 'T1')], { agentes: [vivo('T1 implementador')], contexto: { percent: 55, tokens: null, window: null } });
  const l = linhas(s);
  // desenho do E4: rótulo EQUIPE, o líder e, logo abaixo, a linha do contexto com a barra
  const i = l.findIndex((x) => /^EQUIPE/.test(x));
  assert.equal(l[i + 1], 'GANDALF  orquestra');
  assert.equal(l[i + 2], `│  ctx ${'█'.repeat(16)}${'░'.repeat(13)} 55% · pouso em 50% · hora de pousar   tok ? (sem medição)`);
  assert.equal(l[i + 3], '│  7d ? (sem medição)', 'g.10 (D-G7): sem five_hour o campo 5h some (nunca "5h ?"); o 7d segue, com o motivo');
  assert.ok(l.every((x) => !/5h/.test(x)), '5h omitido');
  assert.ok(l.some((x) => /^├─ ● ARAGORN  T1  ctx \? \(sem medição\)  \d+(m|h\d\d)  implementando \(registrado\)$/.test(x)), l.join('\n'));
  assert.ok(l.some((x) => /^└─ ○ ELROND$/.test(x)), 'g.8: a Sombra é o último └ da EQUIPE, sem decisão só o nome');
  const semCtx = linhas(proj(P(...IDS), [], { contexto: { percent: null, tokens: null, window: null } }));
  assert.ok(semCtx.includes('│  ctx ? (sem medição) · pouso em 50%   tok ? (sem medição)'), 'sem medição: "?" com o motivo (g.9) no lugar da barra, nunca barra vazia nem 0');
  assert.ok(semCtx.every((x) => !/ctx [█░]|ctx 0%|hora de pousar/.test(x)));
  const abaixo = linhas(proj(P(...IDS), [], { contexto: { percent: 49, tokens: null, window: null } }));
  assert.ok(abaixo.includes(`│  ctx ${'█'.repeat(14)}${'░'.repeat(15)} 49% · pouso em 50%   tok ? (sem medição)`), abaixo.join('\n'));
});

test('cli-sem-agentes-sem-nomes-nem-traco: sem --agentes, 1 linha no AGORA e nenhum nome sorteado', () => {
  const s = proj(P(...IDS), [...RECENTES, ini(50, 'T4')], { agentes: null });
  const t = texto(s);
  assert.match(t, /^EQUIPE · agentes e contexto: medidos só no painel da sessão$/m);
  // a seção da equipe é 1 linha só: nenhum ctx, tok, 5h/7d, narração, árvore nem nome na fila
  assert.equal(t.split('\n').filter((x) => /^EQUIPE|^\S+ {2}orquestra|^│|^[├└]/.test(x)).length, 1);
  assert.doesNotMatch(t, /GANDALF|ELROND|ARAGORN|LEGOLAS|agentes —|ctx|tok|5h|7d|vivos?\b/);
  assert.match(t, /Sombra decidiu: seguir com a T3/);
  const comAgentes = texto(proj(P(...IDS), [...RECENTES, ini(50, 'T4')], { agentes: [vivo('T4 implementador')] }));
  assert.match(comAgentes, /ELROND decidiu/, 'cli-com-agentes-igual-ao-mod: com --agentes os nomes voltam');
});

test('descricao-tecnica-higienizada e vivo-sem-task-mostra-descricao', () => {
  const s = proj(P(...IDS), [ini(0, 'T1')], { agentes: [vivo('Rascunho spec-brief.md com node'), vivo('Explorar o repositório'), vivo('T1 implementador')] });
  const l = linhas(s);
  assert.ok(l.includes('├─ ● LEGOLAS  sem task  ctx ? (sem medição)        Rascunho … com … (registrado)'), l.join('\n')); // todo vivo tem nome (FIEL-3 d): o par da T1 fica com o 1º, os sem task com os livres
  assert.ok(l.includes('├─ ● GIMLI    sem task  ctx ? (sem medição)        Explorar o repositório (registrado)'), l.join('\n'));
  assert.ok(l.some((x) => /^├─ ● ARAGORN  T1        ctx \? \(sem medição\)  \d+(m|h\d\d)  implementando \(registrado\)$/.test(x)), l.join('\n'));
  assert.equal(s.agora?.agentes?.length, 3, 'vivos-igual-linhas-de-agente');
  assert.equal(l.filter((x) => /^[├└]─ ● /.test(x)).length, 3);
  assert.ok(l.includes('└─ ○ ELROND'), 'a Sombra fecha a árvore (g.8) e não conta como agente vivo');
  assert.ok(l.some((x) => /^EQUIPE +agentes 3 vivos$/.test(x)), 'N vivos = linhas de agente');
});

test('em-voo-sem-agente-vai-a-atencao: task em voo sem agente vivo ⇒ ATENÇÃO, nunca linha no AGORA', () => {
  const s = proj(P(...IDS), [ini(0, 'T1'), ini(1, 'T2'), con(2, 'T2'), ini(3, 'T2', 'revisor')], { agentes: [vivo('T2 revisor')] });
  const t = texto(s);
  assert.match(t, /^◆ ATENÇÃO {2}T1 sem agente trabalhando$/m);
  assert.ok(t.split('\n').every((x) => !/^[├└]─? .* T1 /.test(x)), 'T1 não vira linha de agente na árvore');
  assert.doesNotMatch(t, /◌/);
  assert.doesNotMatch(texto(proj(P(...IDS), [ini(0, 'T1')], { agentes: null })), /sem agente trabalhando/, 'sem mod não se sabe: nada no ATENÇÃO');
});

// ───────────────────────────── Sombra (FIEL-7)

test('sombra-decisao-no-recente, sombra-consulta-sem-registro-na-atencao e sem-linha-fixa-da-sombra', () => {
  const consulta = (t: number) => e(t, 'sombra.consulta', { pergunta_hash: 'a'.repeat(64), task: 'T1' });
  const s = proj(P(...IDS), [consulta(1), consulta(2), DEC(3, 'sim', 'T1')]);
  const t = texto(s);
  assert.match(t, /^\d\d:\d\d ● ELROND decidiu: sim \(anotado pelo orquestrador\)$/m);
  assert.match(t, /^◆ ATENÇÃO {2}1 consulta à Sombra sem decisão registrada$/m);
  // g.8 (emenda 11, revoga a D-P4 só neste ponto): a Sombra é o último └ da EQUIPE: nome, "aconselha", nº de decisões e a última #seq resposta (fonte)
  assert.match(t, /^└─ ○ ELROND {2}aconselha {2}1 decisão · #3 sim \(spec:1\)$/m, 'a Sombra fecha a árvore, com a contagem e a última decisão');
  assert.ok(t.split('\n').filter((x) => /^[├└]─? [●○] ELROND/.test(x)).length === 1, '1 linha só da Sombra');
  const semDecisao = texto(proj(P(...IDS), [consulta(1)]));
  assert.match(semDecisao, /^└─ ○ ELROND$/m, 'sem decisão só o nome');
  assert.doesNotMatch(semDecisao, /aconselha|\d+ decis(ão|ões)\b/);
  const semConsulta = texto(proj(P(...IDS), [consulta(1), DEC(3, 'sim', 'T1')]));
  assert.doesNotMatch(semConsulta, /consulta/);
});

// ───────────────────────────── progresso fora da execução (N17 b)

test('progresso-spec-com-revisor-vivo, progresso-emenda-aberta e progresso-execucao-sem-sufixo', () => {
  const spec = { caminho: 'docs/superpowers/specs/x.md', pbi: 'GM-14', sha256: 'a'.repeat(64), secoes: 6, titulo: 'Clareza' };
  const f = fatos({ plano: null, specs: [spec] });
  const comRevisor = proj(null, [], { fatos: f, agentes: [vivo('revisar a spec da entrega', 'running', 'gabarito-mestre:gabarito-revisor')] });
  assert.match(linhas(comRevisor).find((x) => /^FASE/.test(x)) as string, /falta aprovar · 1 agente trabalhando: revisar a spec da entrega ·/);
  const emenda = e(1, 'emenda.proposta', { req: 'REQ-DEP-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', arquivos: ['docs/x.md'] }, 'emendas');
  const comEmenda = proj(null, [emenda], { fatos: f });
  assert.match(linhas(comEmenda).find((x) => /^FASE/.test(x)) as string, /· emenda aguardando você ·/);
  const exec = proj(P(...IDS), EXECUCAO, { agentes: [vivo('T4 implementador')] });
  assert.ok(linhas(exec).every((x) => !/\d+ agentes? trabalhando|emenda aguardando/.test(x)), 'em execução, sem sufixo');
  // fase de execução pela trilha (sem plano no estado): a linha FASE aparece e não ganha sufixo
  const aprovada = e(1, 'spec.aprovada', { spec: spec.caminho, sha256: spec.sha256 });
  const naExecucao = proj(null, [aprovada, emenda], { fatos: fatos({ specs: [spec], plano: { tasks: IDS } }), agentes: [vivo('Explorar o repositório')] });
  const fase = linhas(naExecucao).find((x) => /^FASE/.test(x)) as string;
  assert.match(fase, /^FASE 5 de 7 /);
  assert.doesNotMatch(fase, /agente trabalhando|emenda aguardando/);
});

// ───────────────────────────── executivo = o mesmo render (FIEL-12)

test('executivo-igual-esquadrao-menos-nomes e executivo-papeis-da-tabela', () => {
  const s = proj(P(...IDS), [...RECENTES, ini(50, 'T4'), ini(51, 'T5'), con(52, 'T5'), ini(53, 'T5', 'revisor')],
    { agentes: [vivo('T4 implementador'), vivo('T5 revisor')] });
  // o alinhamento das colunas do E4 acompanha o tamanho do nome: compara-se com os espaços de alinhamento colapsados (layout, não texto)
  const colapsa = (x: string): string => x.replace(/ {2,}/g, ' ');
  const esq = colapsa(texto(s, { preset: 'esquadrao' }));
  const exe = colapsa(texto(s, { preset: 'executivo' }));
  assert.match(cru(s, { preset: 'esquadrao' })[0], / esquadrão · terra média$/);
  assert.match(cru(s, { preset: 'executivo' })[0], / executivo$/, 'o rótulo do preset (o pacote é lúdico) é a única outra troca');
  // troca cada nome temático pelo papel do próprio estado (quem do AGORA e do RECENTE, orquestrador e Sombra)
  const pares = new Map<string, string>([['GANDALF', 'Orquestrador'], ['ELROND', 'Conselheiro']]);
  for (const q of [...(s.agora?.agentes ?? []).map((a) => a.quem), ...(s.recente ?? []).map((r) => r.quem)]) if (q?.nome) pares.set(q.nome, PAPEL_EXECUTIVO[q.papel]);
  assert.ok(pares.size >= 4, 'o estado tem nomes de ao menos 2 papéis além do orquestrador e da Sombra');
  let trocado = esq;
  for (const [nome, papel] of pares) trocado = trocado.split(nome).join(papel);
  assert.equal(trocado, exe);
  assert.notEqual(esq, exe, 'o esquadrão tem nomes');
  assert.deepEqual(PAPEL_EXECUTIVO, {
    orquestrador: 'Orquestrador', implementador: 'Implementador', correcao: 'Implementador', spike: 'Implementador',
    revisor: 'Revisor', sombra: 'Conselheiro', teste: 'Teste',
  });
  assert.match(exe, /^Orquestrador orquestra$/m);
  assert.match(exe, /^├─ ● Implementador T4 ctx \? \(sem medição\) \d+(m|h\d\d) implementando \(registrado\)$/m);
  assert.match(exe, /^├─ ● Revisor T5 ctx \? \(sem medição\) \d+(m|h\d\d) revisando \(registrado\)$/m);
  assert.match(exe, /^└─ ○ Conselheiro aconselha 1 decisão · #\d+ seguir com a T3 \(spec:1\)$/m, 'a Sombra no executivo é o Conselheiro (g.8, nos 2 presets)');
  assert.match(exe, /^ ● T4 implementando Implementador /m, 'o nome na fila do E4 também vira papel');
});

// ───────────────────────────── histórico com origem (REQ-LNG-1) e FIEL-5 b

test('historico-com-origem: cada item do histórico traz a origem da tabela fechada', () => {
  const evs = D([...ciclo('T1', 0), e(10, 'spec.aprovada', { spec: 'docs/x.md', sha256: 'a'.repeat(64) }), DEC(11, 'sim', 'T1')]);
  const h = historicoDe(evs, { nomes: new Map(), lider: 'G', sabio: 'E', porAgente: new Map(), fuso: 'UTC', agoraMs: AGORA, textoParar: () => null });
  assert.deepEqual(h.itens.map((i) => i.origem), ['(anotado pelo orquestrador)', '(você)', '(automático)', '(automático)', '(automático)', '(automático)']);
});

test('historico-push-desconhecido-sem-permitido: ambiente desconhecido não diz "permitido"', () => {
  const ctx = { nomes: new Map(), lider: 'GANDALF', sabio: 'ELROND', porAgente: new Map(), fuso: 'UTC', agoraMs: AGORA, textoParar: () => null };
  const ev = (ambiente: unknown) => ({ seq: 1, ts: iso(0), autor: 't', sessao: 's', agente: 'orquestrador', tipo: 'producao.acesso', dados: { ambiente, acao: 'escrita', alvo: 'origin' }, hash_anterior: null }) as unknown as Evento;
  assert.equal(fraseHistorico(ev('desconhecido'), ctx)?.texto, 'GANDALF alterou origin (não consegui conferir se é produção)');
  assert.equal(fraseHistorico(ev(undefined), ctx)?.texto, 'GANDALF alterou origin (não consegui conferir se é produção)');
  assert.equal(fraseHistorico(ev('prod'), ctx)?.texto, 'GANDALF alterou PRODUÇÃO · origin · permitido');
});

// ───────────────────────────── PAROU em verbo, comando só no botão (M-T17a)

test('parou-sem-comando-no-texto: TABELA_PARAR sem comando, sem palavra-tipo e sem marca técnica; comando só em acoes', () => {
  for (const [motivo, linha] of Object.entries(TABELA_PARAR)) {
    assert.ok(!linhaTecnica(linha.texto), `${motivo}: "${linha.texto}"`);
    for (const a of linha.acoes) assert.ok(!linhaTecnica(a.rotulo.replace('<task>', 'T1')), `${motivo}: rótulo "${a.rotulo}"`);
  }
  const s = proj(P(...IDS), [...noTeto('T1', 0), e(20, 'loop.parar', { motivo: 'teto_rodadas', task: 'T1' })]);
  const l = linhas(s)[1];
  assert.match(l, /^■ PAROU \d\d:\d\d · teto de rodadas de review em T1 \[aprovar\] · recusar: deixe a task parada e emende a spec$/);
  assert.equal(s.parar?.acoes[0].comando, '/gabarito-mestre:liberar T1');
});

test('corte-nunca-cria-palavra-tecnica: cortar "notariado" em "nota…" casaria a palavra-tipo; o corte recua', () => {
  const s = proj(P(...IDS), [], { titulo: 'notariado grande' });
  for (let w = 18; w <= 30; w++) {
    const l = linhas(s, { largura: w })[0];
    assert.ok(!linhaTecnica(l), `${w}: "${l}"`);
  }
  assert.equal(linhas(s, { largura: 22 })[0], 'GABARITO · GM-14 not…');
});

test('marca-sem-entrega: sem entrega identificada o cabeçalho diz exatamente "GABARITO · entrega não identificada" (spec:53), nos dois presets e sem título', () => {
  const base = proj(P(...IDS), [], { titulo: 'GM-14 — Clareza' });
  const sem = { ...base, id: '' } as EstadoPainel;
  for (const preset of ['executivo', 'esquadrao'] as const) {
    const l = renderPainel(sem, { largura: 80, preset } as OpcoesRender).map((x) => x.map((s) => s.texto).join(''));
    assert.equal(semRotulo(l[0]), 'GABARITO · entrega não identificada', preset);
    assert.ok(!l.join('\n').includes('sem entrega identificada'));
  }
});

test('ultima-entrega-conhecida: sem entrega, a 1ª linha fora do topo é exatamente "última entrega conhecida: <ID>" (spec:53), nos dois presets; com entrega ou sem ultimaConhecida não aparece', () => {
  const base = proj(P(...IDS), [], { titulo: 'GM-14 — Clareza' });
  const trilha = { ...(base.trilha as object), ultimaConhecida: 'GM-12' } as EstadoPainel['trilha'];
  const sem = { ...base, id: '', trilha } as EstadoPainel;
  for (const preset of ['executivo', 'esquadrao'] as const) {
    const l = renderPainel(sem, { largura: 80, preset } as OpcoesRender).map((x) => x.map((s) => s.texto).join(''));
    assert.equal(semRotulo(l[0]), 'GABARITO · entrega não identificada', preset);
    assert.ok(l.includes('última entrega conhecida: GM-12'), `${preset}: ${JSON.stringify(l)}`);
    assert.equal(l.indexOf('última entrega conhecida: GM-12'), l.findIndex((x) => !/^(depende de você|◆ DEPENDE DE VOCÊ|  |■ PAROU)/.test(x) && x !== l[0]), preset);
    const nula = renderPainel({ ...sem, trilha: { ...(trilha as object), ultimaConhecida: null } } as EstadoPainel, { largura: 80, preset } as OpcoesRender).map((x) => x.map((s) => s.texto).join(''));
    assert.ok(!nula.join('\n').includes('última entrega conhecida'), `${preset}: sem dado, sem linha`);
    const com = renderPainel({ ...base, trilha } as EstadoPainel, { largura: 80, preset } as OpcoesRender).map((x) => x.map((s) => s.texto).join(''));
    assert.ok(!com.join('\n').includes('última entrega conhecida'), `${preset}: com entrega identificada, sem a linha`);
  }
});

test('topo-nunca-cortado: o PAROU longo a 80 colunas quebra em linhas, com o motivo inteiro, nenhuma passa de 80 nem termina em "…" (REQ-GLB-1)', () => {
  const motivo = 'deixe a task parada e emende a spec antes de qualquer nova rodada de review, para não repetir o mesmo achado';
  const base = proj(P(...IDS), [], {});
  const s = { ...base, parar: { hora: '2026-11-12T12:25:00.000Z', texto: `teto de rodadas de review em T2 · recusar: ${motivo}`, acoes: [{ rotulo: 'aprovar', comando: 'x' }] } } as unknown as EstadoPainel;
  for (const preset of ['executivo', 'esquadrao'] as const) {
    const l = renderPainel(s, { largura: 80, preset } as OpcoesRender).map((x) => x.map((t) => t.texto).join(''));
    const topo = l.filter((x, i) => i >= 1 && i < l.findIndex((y) => SEP.test(y)));
    assert.ok(topo.length >= 2, preset);
    assert.ok(topo.every((x) => colunas(x) <= 80 && !x.endsWith('…')), `${preset}: ${JSON.stringify(topo)}`);
    assert.ok(topo.join(' ').replace(/ +/g, ' ').includes(`recusar: ${motivo} [aprovar]`), preset);
  }
});

// T37 r3: (+N) do topo conta ITENS escondidos, nunca linhas quebradas; a continuação fica com o item (REQ-GLB-1, spec:47; D15)
const topoMedido = (parar: unknown, depende: { motivo: string }[], o: Record<string, unknown>): string[] => {
  const est: any = { modo: 'loop', id: 'GM-14', titulo: 'x', parar, pergunta: null, depende: depende.map((d) => ({ ...d, acoes: [{ rotulo: 'aprovar', comando: 'y' }], nivel: 'x' })), pronto: { integradas: 1, total: 3, previsao: null }, agora: null, atencao: [], recente: [], trilha: {} };
  return renderBlocos(est, { largura: 80, preset: 'executivo', ...o } as any).map((x: any) => x.map((t: any) => t.texto).join(''));
};
const PAROU_LONGO = { hora: '12:25', texto: 'teto de rodadas de review em T2', acoes: [{ rotulo: 'aprovar', comando: 'x' }, { rotulo: 'recusar: deixe a task parada e emende a spec', comando: null }] };
const MOTIVO_LONGO = `decidir a emenda ${'muito '.repeat(14)}longa`;

test('topo-mais-por-item: (+N) conta itens escondidos, não linhas quebradas', () => {
  const sem = topoMedido(PAROU_LONGO, [{ motivo: 'decidir a emenda 1' }, { motivo: 'decidir a emenda 2' }], {});
  assert.ok(sem.length >= 4 && !sem.join('\n').includes('(+'), JSON.stringify(sem)); // PAROU em 2 linhas, nada escondido
  const o3 = topoMedido(PAROU_LONGO, [{ motivo: 'decidir a emenda 1' }, { motivo: 'decidir a emenda 2' }, { motivo: 'decidir a emenda 3' }], { orcamento: 3 });
  assert.equal(o3.length, 3, JSON.stringify(o3));
  assert.ok(o3[2].startsWith('◆ decidir a emenda 1'), o3[2]);
  assert.ok(o3[2].endsWith(' (+2)'), `2 itens escondidos, não ${o3[2]}`);
  assert.ok(o3.every((x) => colunas(x) <= 80));
  const o2 = topoMedido(PAROU_LONGO, [{ motivo: 'decidir a emenda 1' }], { orcamento: 2 });
  assert.equal(o2.length, 2, JSON.stringify(o2));
  assert.ok(o2[1].endsWith(' (+1)') && o2.join(' ').replace(/ +/g, ' ').includes('recusar: deixe a task parada e emende a spec'), JSON.stringify(o2)); // PAROU inteiro; 1 item escondido (por linha daria +2)
  assert.ok(o2[0].startsWith('■ PAROU 12:25'));
});

test('topo-item-inteiro: um item que não cabe inteiro sai inteiro, sem sobrar meia continuação', () => {
  const o = topoMedido(PAROU_LONGO, [{ motivo: MOTIVO_LONGO }, { motivo: 'decidir a emenda 2' }], { orcamento: 3 });
  assert.equal(o.length, 2, JSON.stringify(o));
  assert.ok(!o.join('\n').includes('decidir a emenda'), 'o item 2 quebrado não entra pela metade');
  assert.ok(o[1].endsWith(' (+2)') && colunas(o[1]) <= 80, o[1]);
  const tres = topoMedido(PAROU_LONGO, [{ motivo: `decidir a emenda ${'muito '.repeat(35)}longa` }], { orcamento: 4 });
  assert.equal(tres.length, 2, `item de 3 linhas com 2 vagas sai inteiro: ${JSON.stringify(tres)}`);
  assert.ok(tres[1].endsWith(' (+1)'), tres[1]);
  const cabe = topoMedido({ ...PAROU_LONGO, acoes: [] }, [{ motivo: 'decidir a emenda 1' }, { motivo: 'decidir a emenda 2' }], { orcamento: 1 });
  assert.equal(cabe.length, 1, JSON.stringify(cabe));
  assert.ok(cabe[0].startsWith('■ PAROU 12:25') && cabe[0].endsWith(' (+2)'), cabe[0]);
});

test('topo-1o-item-maior-que-o-orcamento (LIMITE, aguarda decisão): D15 vence; mostra só as linhas do orçamento, a última termina em "…" e não inventa (+N)', () => {
  const o = topoMedido(PAROU_LONGO, [], { orcamento: 1 });
  assert.equal(o.length, 1, JSON.stringify(o));
  assert.ok(o[0].startsWith('■ PAROU 12:25') && o[0].endsWith('…') && colunas(o[0]) <= 80 && !o[0].includes('(+'), o[0]);
  const c = topoMedido(PAROU_LONGO, [{ motivo: 'decidir a emenda 1' }], { orcamento: 1 });
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.ok(c[0].endsWith('… (+1)') && !c[0].includes('……') && colunas(c[0]) <= 80, c[0]);
  // reticência única, linha inteira (com " (+N)") nunca passa da largura
  const tres = topoMedido({ ...PAROU_LONGO, texto: `lon${'g'.repeat(200)}`, acoes: [] }, [{ motivo: 'decidir a emenda 1' }], { orcamento: 2 });
  assert.ok(tres.every((l) => !l.includes('……') && colunas(l) <= 80) && tres[tres.length - 1].endsWith('… (+1)'), JSON.stringify(tres));
  const est: any = { modo: 'loop', id: 'GM-14', titulo: 'x', parar: PAROU_LONGO, pergunta: null, depende: [{ motivo: 'decidir a emenda 1', acoes: [{ rotulo: 'aprovar', comando: 'y' }], nivel: 'x' }], pronto: { integradas: 1, total: 3, previsao: null }, agora: null, atencao: [], recente: [], trilha: {} };
  const l20 = renderBlocos(est, { largura: 20, preset: 'executivo', orcamento: 1 } as any).map((x: any) => x.map((t: any) => t.texto).join(''));
  assert.ok(l20.every((l: string) => !l.includes('……') && colunas(l) <= 20) && l20[0].endsWith('… (+1)'), JSON.stringify(l20));
});

test('topo-ultimo-item-inteiro-perde-o-fim-para-o-(+N) (LIMITE declarado, D15 vence)', () => {
  const o = topoMedido({ ...PAROU_LONGO, texto: 'x'.repeat(60), acoes: [{ rotulo: 'aprovar', comando: 'x' }] }, [{ motivo: 'decidir a emenda 1' }], { orcamento: 1 });
  assert.equal(o.length, 1, JSON.stringify(o));
  assert.ok(o[0].endsWith('… (+1)') && !o[0].includes('……') && colunas(o[0]) <= 80 && !o[0].includes('[aprovar]'), o[0]);
});

test('topo-palavra-maior-que-a-largura: é partida em linhas, sem "…" e sem perder caractere (REQ-GLB-1)', () => {
  const palavra = 'x'.repeat(107);
  const o = topoMedido({ ...PAROU_LONGO, texto: `p${palavra}`, acoes: [] }, [], {});
  const topo = o.slice(1, o.findIndex((x) => SEP.test(x)));
  assert.ok(topo.length >= 2 && topo.every((x) => colunas(x) <= 80 && !x.includes('…')), JSON.stringify(topo));
  assert.equal(topo.join('').replace(/[^x]/g, '').length, 107, JSON.stringify(topo));
});

// T37 r4: linha truncada com EXATAMENTE `cabe` colunas (ramo colunas(l) === cabe em painel-esquadrao.ts).
test('T37: linha truncada que ocupa exatamente a largura mantém uma reticência só e não passa da largura', () => {
  const est = (texto: string, nd: number): EstadoPainel => ({
    modo: 'loop', id: 'GM-14', titulo: 'x', parar: { hora: '12:25', texto, acoes: [] }, pergunta: null,
    depende: Array.from({ length: nd }, () => ({ motivo: 'outro', acoes: [], nivel: 'x' })),
    pronto: { integradas: 1, total: 3, previsao: null }, agora: null, atencao: [], recente: [], trilha: {},
  }) as unknown as EstadoPainel;
  const rende = (e: EstadoPainel, orcamento: number): string[] =>
    renderBlocos(e, { largura: 20, preset: 'executivo', orcamento } as OpcoesRender).map((x) => x.map((s) => s.texto).join(''));
  // sem "(+N)": a linha cortada tinha exatamente 20 colunas (cabe); abre mão de 1 coluna para a "…" caber e ser única
  const sem = rende(est(`a ${'b'.repeat(200)}`, 0), 2);
  assert.deepEqual(sem, ['■ PAROU 12:25 · a', `    ${'b'.repeat(14)}…`]);
  // com "(+N)": mesma largura exata (cabe = 20 - 5 colunas do " (+1)" incluído); termina em "…" antes do "(+1)", sem "……"
  // (GM-15 T29: o `■ ` do E4 alarga o PAROU em 2; sem o "a " a 1ª linha volta a ter exatamente `cabe` = 15 colunas, "■ PAROU 12:25 ·")
  const com = rende(est(`${'b'.repeat(200)}`, 1), 1);
  assert.equal(colunas('■ PAROU 12:25 ·'), 15, 'premissa: a linha truncada tem exatamente cabe colunas');
  assert.deepEqual(com, ['■ PAROU… (+1)']); // a hora (número) nunca é cortada: recua inteira (cortarLinha)
  for (const ls of [sem, com]) assert.ok(ls.every((l) => colunas(l) <= 20 && !l.includes('……')), JSON.stringify(ls));
  assert.ok(sem[sem.length - 1].endsWith('…') && com[0].replace(/ \(\+\d+\)$/, '').endsWith('…'));
});

// ───────────────────────────── T42 (emenda 32): a decisão da Sombra fica reservada quando o corte tiraria o RECENTE inteiro

/** Render a 80 (padrão) sem separadores e sem o rótulo do preset; com orçamento, confere antes que o desenho INTEIRO (com os separadores do E4) não passa dele (D15). */
const cabe = (s: EstadoPainel, o: Partial<OpcoesRender>): string[] => {
  const c = cru(s, { largura: 80, ...o });
  if (o.orcamento !== undefined) assert.ok(c.length <= o.orcamento, `D15: ${c.length} linhas > orçamento ${o.orcamento}: ${c.join('|')}`);
  return c.filter((l) => !SEP.test(l)).map(semRotulo);
};
const eRec = (xs: string[]): boolean => xs.some(ehRecente);
const ehDecidiu = (x: string): boolean => /ELROND decidiu: seguir com a T3 \(anotado pelo orquestrador\)$/.test(x);
const noVoo = (itens: Item[]): EstadoPainel => proj(P(...IDS), [...EXECUCAO, ...itens, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] });
/** Linhas dos blocos 1–3 (prioridade ≤ 3: topo, cabeçalho, PLANO/FASE, contexto do líder e agentes) de um estado: o piso que a reserva nunca fura. */
const blocos123 = (s: EstadoPainel, local: 'lateral' | 'acima'): string[] => cabe(s, { local }).filter((x) => prioDe(x) <= 3);
/** `xs` contém `x` módulo as trocas do E4 com pouca altura (`norm`). */
const tem = (xs: string[], x: string): boolean => xs.map(norm).includes(norm(x));

for (const local of ['lateral', 'acima'] as const) {
  test(`decisao-sombra-reservada-80x24-${local}: orçamento que tiraria o RECENTE inteiro mantém 1 linha "decidiu:" e os blocos 1–3`, () => {
    const s = noVoo([DEC(50, 'seguir com a T3')]);
    const b123 = blocos123(s, local);
    const sem = cabe(proj(P(...IDS), [...EXECUCAO, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] }), { local, orcamento: b123.length + 1 });
    assert.ok(!eRec(sem) && !sem.some(ehDecidiu), 'sem decisão, o orçamento b123+1 corta o RECENTE (premissa)');
    const l = cabe(s, { local, orcamento: b123.length + 1 });
    assert.ok(l.length <= b123.length + 1, 'nunca passa do orçamento');
    assert.equal(l.filter(ehDecidiu).length, 1, `1 linha da decisão: ${l.join('|')}`);
    for (const x of b123) assert.ok(tem(l, x), `bloco 1–3 presente: "${x}"`);
    assert.ok(l.every((x) => colunas(x) <= 80));
  });
}

test('decisao-sombra-reservada: a mais recente vence e a origem fica quando o texto é cortado', () => {
  const s = noVoo([DEC(50, 'primeira resposta'), DEC(52, 'segunda resposta que é bem longa para estourar a largura de quarenta colunas')]);
  const orc = blocos123(s, 'lateral').length + 1;
  const l = cabe(s, { local: 'lateral', orcamento: orc, largura: 80 });
  const d = l.filter((x) => /decidiu:/.test(x));
  assert.equal(d.length, 1);
  assert.match(d[0], /segunda resposta/);
  assert.match(d[0], /…/);
  assert.match(d[0], /\(anotado pelo orquestrador\)$/);
  assert.ok(colunas(d[0]) <= 80);
  const estreita = cabe(s, { local: 'lateral', orcamento: orc, largura: 44 }).filter((x) => /decidiu:/.test(x));
  assert.equal(estreita.length, 1, 'em 44 colunas o texto vence a origem, e a linha ainda aparece');
  assert.ok(colunas(estreita[0]) <= 44);
});

test('sem-decisao-sem-reserva: sem decisao.sombra o corte é o de hoje (nenhuma linha "decidiu:", RECENTE some)', () => {
  const s = noVoo([e(50, 'loop.pausa', { estado: 'pausado' })]);
  const orc = blocos123(s, 'lateral').length + 1;
  const l = cabe(s, { local: 'lateral', orcamento: orc });
  assert.ok(!eRec(l), 'RECENTE inteiro cortado como hoje');
  assert.equal(l.length, orc, 'o orçamento sobra para o ATENÇÃO, não para uma reserva');
  assert.ok(l.some((x) => /^◆ ATENÇÃO/.test(x)));
  assert.ok(!l.some((x) => /decidiu:/.test(x)));
});

test('reserva-cede-sem-espaco: orçamento menor que blocos 1–3 + 1 ⇒ blocos 1–3 vencem e a reserva sai', () => {
  const s = noVoo([DEC(50, 'seguir com a T3')]);
  const b123 = blocos123(s, 'lateral');
  const l = cabe(s, { local: 'lateral', orcamento: b123.length });
  assert.deepEqual(l.map(norm), b123.map(norm));
  assert.ok(!l.some((x) => /decidiu:/.test(x)));
});

test('reserva-vence-atencao: com ATENÇÃO e decisão, no orçamento b123+1 a linha "decidiu:" fica e o ATENÇÃO sai antes dela', () => {
  const s = noVoo([DEC(50, 'seguir com a T3')]);
  const b123 = blocos123(s, 'lateral');
  assert.ok(cabe(s, { local: 'lateral' }).some((x) => /^◆ ATENÇÃO/.test(x)), 'premissa: há ATENÇÃO');
  const l = cabe(s, { local: 'lateral', orcamento: b123.length + 1 });
  assert.equal(l.filter(ehDecidiu).length, 1);
  assert.ok(!l.some((x) => /^◆ ATENÇÃO/.test(x)), 'ATENÇÃO saiu antes da reserva');
  const maior = cabe(s, { local: 'lateral', orcamento: 200 });
  assert.ok(maior.some((x) => /^◆ ATENÇÃO/.test(x)) && maior.some(ehDecidiu), 'sem aperto, ATENÇÃO e RECENTE aparecem normais');
});

test('reserva-quando-recente-cortado-so-em-parte: se alguma linha do RECENTE sobrevive não há reserva extra (sem duplicar a decisão)', () => {
  const s = noVoo([DEC(50, 'seguir com a T3')]);
  const l = cabe(s, { local: 'lateral', orcamento: 200 });
  assert.equal(l.filter(ehDecidiu).length, 1);
});

// ───────────────────────────── T42 (emenda 37): AGORA compacta em 1 linha-resumo quando a reserva da Sombra não cabe

/** ESTADO DO ROTEIRO do A1 (pontos.json, msgs 3–52): DEPENDE com 2 itens (2 linhas). Nunca um estado inventado: os motivos vêm do arquivo. */
const PONTOS = JSON.parse(readFileSync(new URL('./e2e/conversa-2026-11-11/pontos.json', import.meta.url), 'utf8')) as { pontos: { msg: number; esperado: { depende: string[] } }[] };
const DEPENDE_ROTEIRO = PONTOS.pontos.find((x) => x.msg === 3)!.esperado.depende;
const doRoteiro = (s: EstadoPainel): EstadoPainel => ({ ...s, depende: DEPENDE_ROTEIRO.map((motivo) => ({ motivo, acoes: [], nivel: 'dono' })) }) as EstadoPainel;
const VIVOS = ['T4 implementador', 'T5 revisor', 'T6 implementador'];
const roteiro = (n: number, itens: Item[] = [DEC(50, 'seguir com a T3')], extra: Partial<Entrada> = {}): EstadoPainel =>
  doRoteiro(proj(P(...IDS), [...EXECUCAO, ...itens], { agentes: VIVOS.slice(0, n).map((d) => vivo(d)), ...extra }));
/** 80x24 acima do input: 7 linhas + 1 da linha da Sombra (g.8, GM-15 T33), que é do bloco 3 e fecha a árvore (antes de a Sombra ter linha fixa eram 7). */
const ORC_80X24 = orcamentoDe(24, 12);
const ORC_ACIMA = ORC_80X24 + 1;
const ehSombraLinha = (x: string): boolean => /^└─ ○ /.test(x);
/** Linhas do AGORA no desenho do E4: contexto do líder, árvore dos agentes e linha-resumo (prioridade 3). */
const linhasAgora = (l: string[]): string[] => l.filter((x) => prioDe(x) === 3 && !ehSombraLinha(x));
/** Linhas dos blocos 1–2 (prioridade ≤ 2): topo, cabeçalho, PLANO/FASE. */
const blocos12 = (l: string[]): string[] => l.filter((x) => prioDe(x) <= 2);
const resumoDe = (l: string[]): string[] => l.filter((x) => /^  \d+ agentes:/.test(x));

test('roteiro-premissa: DEPENDE do roteiro tem 2 itens e orcamentoDe(24, 12) = 7', () => {
  assert.equal(DEPENDE_ROTEIRO.length, 2);
  assert.equal(ORC_80X24, 7);
  assert.equal(ORC_ACIMA, 8, 'a Sombra fixa pede +1 linha');
});

for (const n of [2, 3]) {
  test(`reserva-com-agora-compacto-acima-80x24-roteiro: ${n} vivos ⇒ "decidiu:" presente e AGORA em 2 linhas (orquestrador + "${n} agentes:")`, () => {
    const s = roteiro(n);
    const cheio = cabe(s, { local: 'acima', orcamento: 200 });
    assert.ok(cheio.length > ORC_ACIMA && resumoDe(cheio).length === 0, 'premissa: sem aperto cada agente tem a sua linha');
    const l = cabe(s, { local: 'acima', orcamento: ORC_ACIMA });
    assert.ok(l.length <= ORC_ACIMA, l.join('|'));
    assert.equal(l.filter(ehDecidiu).length, 1, `a decisão da Sombra fica: ${l.join('|')}`);
    const agora = linhasAgora(l);
    assert.equal(agora.length, 2, agora.join('|'));
    assert.match(agora[0], /^GANDALF ctx █+░+ 40% · pouso em 50%   tok \?$/, 'sem a linha do nome, o contexto leva o nome (troca do E4); a 80 colunas o "?" fica sem o motivo (g.9)');
    assert.match(agora[1], new RegExp(`^  ${n} agentes: .*T4`));
    for (const x of DEPENDE_ROTEIRO) assert.ok(l.some((y) => y.includes(x)), `DEPENDE presente: ${x}`);
    assert.ok(l.some((x) => /^PLANO|^FASE/.test(x)) && l[0].startsWith('GABARITO'));
    assert.ok(l.every((x) => colunas(x) <= 80));
  });
}

test('linha-resumo: rótulo (nome temático) e task de cada agente; N = vivos; o segundo plano (seção própria, g.11) não entra na linha nem conta em N', () => {
  const s = roteiro(3, [DEC(50, 'seguir com a T3')], { segundoPlano: [{ id: 'bg1', dono: 'orquestrador', texto: 'npm test', desde: AGORA - 30_000 }] });
  assert.equal(s.agora?.segundoPlano.length, 1, 'premissa: 1 linha de segundo plano');
  assert.equal(s.agora?.segundoPlano[0].acao, 'Teste', 'e o painel o rotulou pelo comando (npm test ⇒ Teste)');
  const [r] = resumoDe(cabe(s, { local: 'acima', orcamento: ORC_ACIMA }));
  assert.ok(r !== undefined, 'compactou');
  assert.match(r, /^  3 agentes: /, 'N conta só agentes');
  const nomes = (s.agora?.agentes ?? []).map((a) => `${a.quem.nome} ${a.task}`);
  assert.equal(nomes.length, 3);
  for (const x of nomes) assert.ok(r.includes(x), `"${x}" na linha-resumo: ${r}`);
  assert.doesNotMatch(r, /Teste|npm test/, 'o segundo plano não é item da linha-resumo: a EQUIPE só tem agentes (D-G8)');
  assert.ok(!/implementando|revisando|\d+ ?s\b|lendo/.test(r), 'ação e tempo saem');
});

test('linha-resumo-truncada: "…" no fim, cabe em w, N segue = todos os vivos, itens visíveis inteiros', () => {
  const s = roteiro(3);
  const todos = (s.agora?.agentes ?? []).map((a) => `${a.quem.nome} ${a.task}`);
  const completo = resumoDe(cabe(s, { local: 'acima', orcamento: ORC_ACIMA }))[0];
  assert.ok(!completo.endsWith('…'), 'em 80 colunas cabem os 3');
  const w = colunas(`  3 agentes: ${todos[0]} · ${todos[1]}`) + 2; // cabe 2 itens e o " …", não o 3º
  // a largura estreita quebra o DEPENDE em mais linhas: o menor orçamento em que a decisão ainda cabe compactando
  const orc = Array.from({ length: 30 }, (_, i) => i + 5).find((o) => resumoDe(cabe(s, { local: 'acima', orcamento: o, largura: w })).length === 1);
  assert.ok(orc !== undefined, 'em algum orçamento o AGORA compacta');
  const l = cabe(s, { local: 'acima', orcamento: orc, largura: w });
  const [r] = resumoDe(l);
  assert.ok(r !== undefined && colunas(r) <= w, `${r}`);
  assert.ok(r.endsWith(' …'), r);
  assert.match(r, /^  3 agentes: /, 'N = vivos, mesmo com 1 escondido pelo "…"');
  assert.ok(r.includes(todos[0]) && r.includes(todos[1]) && !r.includes(todos[2]), r);
  assert.equal(l.filter((x) => /decidiu:/.test(x)).length, 1);
});

test('sem-compactar-quando-cabe: com a reserva cabendo (180×50 sem corte, lateral com folga, orçamento b123+1) cada agente tem a sua linha', () => {
  const s = roteiro(3);
  for (const o of [{ local: 'lateral' as const, largura: 180 }, { local: 'lateral' as const, largura: 80, orcamento: 14 }, { local: 'acima' as const, largura: 80, orcamento: 14 }]) {
    const l = cabe(s, o);
    assert.equal(resumoDe(l).length, 0, `${JSON.stringify(o)}: ${l.join('|')}`);
    assert.equal(l.filter((x) => /^[├└]─ ● \S+ +T\d /.test(x)).length, 3, '1 linha por agente');
  }
  // reserva cabendo SEM compactar: RECENTE cortado inteiro, blocos 1–3 completos (orquestrador + 3 agentes) + a reserva
  const pleno = cabe(s, { local: 'acima', orcamento: 200 });
  const b123 = pleno.filter((x) => prioDe(x) <= 3).length;
  const l = cabe(s, { local: 'acima', orcamento: b123 + 1 });
  assert.equal(resumoDe(l).length, 0, l.join('|'));
  assert.equal(l.filter(ehDecidiu).length, 1);
  assert.equal(l.filter((x) => /^[├└]─ ● \S+ +T\d /.test(x)).length, 3);
});

test('reserva-cabe-sem-compactar-com-atencao: ATENÇÃO ocupa a linha do RECENTE, a reserva a toma e o AGORA fica com 1 linha por agente (D-P8 + emenda 32)', () => {
  const s = roteiro(3, [DEC(50, 'seguir com a T3'), e(60, 'ci.resultado', { verde: false, alvo: 'main' })]);
  const pleno = cabe(s, { local: 'acima', orcamento: 200 });
  const b123 = pleno.filter((x) => prioDe(x) <= 3).length;
  assert.ok(pleno.findIndex((x) => /^◆ ATENÇÃO/.test(x)) >= 0 && pleno.findIndex((x) => /^◆ ATENÇÃO/.test(x)) < pleno.findIndex(ehRecente), 'premissa: o ATENÇÃO vem antes do RECENTE');
  const l = cabe(s, { local: 'acima', orcamento: b123 + 1 });
  assert.equal(l.filter(ehDecidiu).length, 1, l.join('|'));
  assert.equal(resumoDe(l).length, 0, l.join('|'));
  assert.equal(l.filter((x) => /^[├└]─ ● \S+ +T\d /.test(x)).length, 3, '1 linha por agente');
});

test('decisao-com-folga-nao-duplica: reserva entra uma vez só mesmo com linha sobrando depois de compactar', () => {
  const s = roteiro(3);
  const l = cabe(s, { local: 'acima', orcamento: ORC_ACIMA + 1 });
  assert.equal(l.filter(ehDecidiu).length, 1, l.join('|'));
});

test('sem-decisao-nunca-compacta: sem decisao.sombra o AGORA não vira linha-resumo, mesmo apertado', () => {
  for (const n of [2, 3]) {
    const s = roteiro(n, [e(50, 'loop.pausa', { estado: 'pausado' })]);
    for (const orc of [ORC_ACIMA, 6, 5, 4]) {
      const l = cabe(s, { local: 'acima', orcamento: orc });
      assert.equal(resumoDe(l).length, 0, `n=${n} orc=${orc}: ${l.join('|')}`);
      assert.ok(!l.some((x) => /decidiu:/.test(x)));
    }
  }
});

test('reserva-cede-mesmo-compactado: blocos 1–2 + 2 linhas de AGORA + reserva > orçamento ⇒ a reserva cede e o AGORA fica como hoje', () => {
  const s = roteiro(3);
  const b12 = blocos12(cabe(s, { local: 'acima', orcamento: 200 })).length;
  assert.equal(b12, 4, 'blocos 1–2 do roteiro: GABARITO + 2 itens do DEPENDE + PLANO (o rótulo `◆ DEPENDE DE VOCÊ` do E4 é desenho, sai antes)');
  const limiar = b12 + 2 + 1 + 1; // = 8: cabe compactado (blocos 1–2, contexto, linha-resumo, a Sombra fixa e a reserva)
  const cabeLa = cabe(s, { local: 'acima', orcamento: limiar });
  assert.equal(cabeLa.filter(ehDecidiu).length, 1);
  assert.equal(resumoDe(cabeLa).length, 1);
  const cede = cabe(s, { local: 'acima', orcamento: limiar - 1 });
  assert.ok(!cede.some((x) => /decidiu:/.test(x)), cede.join('|'));
  assert.equal(resumoDe(cede).length, 0, 'compactar não ajudou: o AGORA fica com 1 linha por agente');
  assert.equal(cede.length, limiar - 1);
  assert.ok(cede.some((x) => /ctx /.test(x) && prioDe(x) === 3) && cede.some((x) => /^PLANO/.test(x)));
});

for (const n of [2, 3]) {
  test(`decisao-nao-ultima-acima-80x24-roteiro: decisão seguida de loop.pausa, ${n} vivos ⇒ "decidiu:" presente (compactar só vale com a decisão à vista)`, () => {
    const s = roteiro(n, [DEC(50, 'seguir com a T3'), e(55, 'loop.pausa', { estado: 'pausado' })]);
    const l = cabe(s, { local: 'acima', orcamento: ORC_ACIMA });
    assert.ok(l.length <= ORC_ACIMA, l.join('|'));
    assert.equal(l.filter(ehDecidiu).length, 1, `a decisão da Sombra fica: ${l.join('|')}`);
  });
}

test('reserva-compacta-uma-vez: 1 vivo sem segundo plano não ganha linha-resumo (não economiza linha)', () => {
  const s = roteiro(1);
  const l = cabe(s, { local: 'acima', orcamento: 5 });
  assert.equal(resumoDe(l).length, 0, l.join('|'));
});

test('linha-resumo-executivo-igual-esquadrao-menos-nomes: o executivo usa o papel, o esquadrão o nome temático (FIEL-12)', () => {
  const s = roteiro(3);
  const esq = resumoDe(cabe(s, { local: 'acima', orcamento: ORC_ACIMA, preset: 'esquadrao' }))[0];
  const exe = resumoDe(cabe(s, { local: 'acima', orcamento: ORC_ACIMA, preset: 'executivo' }))[0];
  assert.ok(esq !== undefined && exe !== undefined);
  let trocado = esq;
  for (const a of s.agora?.agentes ?? []) trocado = trocado.split(a.quem.nome as string).join(PAPEL_EXECUTIVO[a.quem.papel]);
  assert.equal(trocado, exe);
  assert.notEqual(esq, exe);
  assert.match(exe, /^  3 agentes: Implementador T4 · Revisor T5 · Implementador T6$/);
});

// ───────────────────────────── T42 (r4, MAJOR da r1): a decisão da Sombra fica em toda célula, também com o RECENTE cortado em parte

test('reserva-varredura-decisao-visivel-em-toda-celula: decisão + 0/1/2 eventos × 1–3 vivos × orçamento 7–12 × lateral/acima × com/sem ATENÇÃO, largura 80', () => {
  const seguintes: [string, Item[]][] = [
    ['0 eventos', []],
    ['pausa', [e(55, 'loop.pausa', { estado: 'pausado' })]],
    ['pausa+retoma', [e(55, 'loop.pausa', { estado: 'pausado' }), e(56, 'loop.pausa', { estado: 'retomado' })]],
  ];
  let casos = 0;
  let comPiso = 0;
  for (const [nome, depois] of seguintes) for (const n of [1, 2, 3]) for (const local of ['lateral', 'acima'] as const) for (const atencao of [false, true]) {
    const base = roteiro(n, [DEC(50, 'seguir com a T3'), ...depois]);
    const s = atencao ? ({ ...base, atencao: ['task em voo sem agente'] } as EstadoPainel) : base;
    const cheio = cabe(s, { local, orcamento: 200 });
    const b12 = blocos12(cheio).length;
    assert.ok(b12 > 0, `premissa: AGORA no render cheio (${nome}/${n}/${local})`);
    for (let orc = 7; orc <= 12; orc++) {
      casos++;
      const l = cabe(s, { local, orcamento: orc });
      const rotulo = `${nome} n=${n} ${local} atencao=${atencao} orc=${orc}`;
      assert.ok(l.length <= orc, `${rotulo}: passou do orçamento: ${l.join('|')}`);
      assert.ok(l.filter(ehDecidiu).length <= 1, `${rotulo}: decisão duplicada: ${l.join('|')}`);
      assert.deepEqual(blocos12(l).map(norm), blocos12(cheio).map(norm), `${rotulo}: blocos 1–2 intactos`);
      // a reserva só existe com corte por ORÇAMENTO no RECENTE (ciclo 3, emenda 32); sem corte, a decisão além do teto do local não aparece
      const corte = JSON.stringify(l.filter(ehRecente)) !== JSON.stringify(cheio.filter(ehRecente));
      if (orc >= b12 + 2 + 1 + 1 /* + a Sombra fixa (g.8) */ && corte) {
        comPiso++;
        assert.equal(l.filter(ehDecidiu).length, 1, `${rotulo}: a decisão da Sombra some: ${l.join('|')}`);
        assert.ok(l.some((x) => /ctx /.test(x) && prioDe(x) === 3), `${rotulo}: sem AGORA (bloco 3): ${l.join('|')}`);
        // a linha que cede à reserva é a ÚLTIMA do RECENTE: sobrando alguma pausa, é a mais nova (12:56 em pausa+retoma)
        const pausas = l.filter((x) => /\d\d:\d\d ○ pausa/.test(x));
        if (nome === 'pausa+retoma' && pausas.length > 0) assert.match(pausas[0], /12:56/, `${rotulo}: a pausa que sobra é a mais nova: ${l.join('|')}`);
      }
    }
  }
  assert.ok(casos >= 3 * 3 * 2 * 2 * 6 && comPiso > 20, `a varredura viu ${casos} casos (${comPiso} acima do piso)`);
});

test('reserva-parcial-toma-a-ultima-linha-do-recente: decisão + pausa, lateral, 2 vivos, orçamento 9 — 1 linha de RECENTE sobra e é a decisão, sem aumentar o total', () => {
  const s = roteiro(2, [DEC(50, 'seguir com a T3'), e(55, 'loop.pausa', { estado: 'pausado' })]);
  const l7 = cabe(s, { local: 'lateral', orcamento: 8 }); // 7 do GM-14 + 1 da Sombra fixa (g.8)
  for (const orc of [9, 10]) {
    const l = cabe(s, { local: 'lateral', orcamento: orc });
    assert.equal(l.filter(ehDecidiu).length, 1, l.join('|'));
    assert.ok(l.length <= orc);
  }
  assert.equal(l7.filter(ehDecidiu).length, 1, l7.join('|'));
});

// ───────────────────────────── T42 (ciclo 3, emenda 32): a reserva só existe com corte por ORÇAMENTO no RECENTE e toma o lugar da última linha, nunca soma

const ehRec = ehRecente;
const eventosApos = (k: number): Item[] => Array.from({ length: k }, (_, i) => e(55 + i, 'loop.pausa', { estado: i % 2 === 0 ? 'pausado' : 'retomado' }));

test('reserva-varredura-teto-e-corte: decisão + 0–6 eventos × 1–3 vivos × orçamento 7–40 × lateral/acima × com/sem ATENÇÃO × largura 80/180', () => {
  let casos = 0;
  let comCorte = 0;
  let semCorte = 0;
  for (const k of [0, 1, 2, 3, 4, 5, 6]) for (const n of [1, 2, 3]) for (const local of ['lateral', 'acima'] as const) for (const atencao of [false, true]) for (const largura of [80, 180]) {
    const base = roteiro(n, [DEC(50, 'seguir com a T3'), ...eventosApos(k)]);
    const s = atencao ? ({ ...base, atencao: ['task em voo sem agente'] } as EstadoPainel) : base;
    const cheio = cabe(s, { local, orcamento: 200, largura });
    const b12 = blocos12(cheio).length;
    const teto = local === 'acima' ? 2 : 5;
    assert.ok(b12 > 0 && cheio.filter(ehRec).length <= teto, `premissa: render cheio respeita o teto (k=${k} n=${n} ${local} w=${largura})`);
    for (let orc = 7; orc <= 40; orc++) {
      casos++;
      const l = cabe(s, { local, orcamento: orc, largura });
      const rotulo = `k=${k} n=${n} ${local} atencao=${atencao} w=${largura} orc=${orc}`;
      assert.ok(l.length <= orc, `${rotulo}: passou do orçamento: ${l.join('|')}`);
      assert.ok(l.filter(ehRec).length <= teto, `${rotulo}: RECENTE acima do teto ${teto}: ${l.join('|')}`);
      assert.ok(l.filter(ehDecidiu).length <= 1, `${rotulo}: decisão duplicada: ${l.join('|')}`);
      assert.deepEqual(blocos12(l).map(norm), blocos12(cheio).map(norm), `${rotulo}: blocos 1–2 intactos`);
      const corte = JSON.stringify(l.filter(ehRec)) !== JSON.stringify(cheio.filter(ehRec));
      if (!corte) {
        semCorte++;
        // sem corte por orçamento: o RECENTE normal, com o seu teto — a decisão só aparece se estava entre as linhas do teto
        assert.equal(l.filter(ehDecidiu).length, cheio.filter(ehDecidiu).length, `${rotulo}: reserva sem corte por orçamento: ${l.join('|')}`);
      } else {
        comCorte++;
        if (orc >= b12 + 2 + 1 + 1 /* + a Sombra fixa (g.8) */) assert.equal(l.filter(ehDecidiu).length, 1, `${rotulo}: corte por orçamento e a decisão some: ${l.join('|')}`);
      }
    }
  }
  assert.ok(casos === 7 * 3 * 2 * 2 * 2 * 34 && comCorte > 300 && semCorte > 300, `a varredura viu ${casos} casos (${comCorte} com corte, ${semCorte} sem)`);
});

test('reserva-sem-corte-nao-soma: largura 180, orçamento 40 — decisão seguida de 2 eventos (acima) tem 2 linhas de RECENTE, seguida de 5 (lateral) tem 5', () => {
  const acima = cabe(roteiro(2, [DEC(50, 'seguir com a T3'), ...eventosApos(2)]), { local: 'acima', orcamento: 40, largura: 180 });
  assert.equal(acima.filter(ehRec).length, 2, acima.join('|'));
  const lateral = cabe(roteiro(2, [DEC(50, 'seguir com a T3'), ...eventosApos(5)]), { local: 'lateral', orcamento: 40, largura: 180 });
  assert.equal(lateral.filter(ehRec).length, 5, lateral.join('|'));
  assert.ok(!lateral.some(ehDecidiu), 'decisão antiga além do teto: comportamento normal do RECENTE, sem reserva');
});

test('reserva-reconhece-decisao-por-campos: estado serializado (cópia do item) com a decisão entre as sobras não ganha 2ª linha "decidiu:"', () => {
  const s0 = roteiro(2, [e(40, 'loop.pausa', { estado: 'pausado' }), e(41, 'loop.pausa', { estado: 'retomado' }), e(42, 'loop.pausa', { estado: 'pausado' }), DEC(50, 'seguir com a T3')]);
  const s = JSON.parse(JSON.stringify(s0)) as EstadoPainel;
  let visto = 0;
  for (let orc = 7; orc <= 14; orc++) {
    const l = cabe(s, { local: 'lateral', orcamento: orc });
    assert.ok(l.filter(ehDecidiu).length <= 1, `orc=${orc}: ${l.join('|')}`);
    if (l.filter(ehDecidiu).length === 1 && l.filter(ehRec).length >= 2) visto++;
  }
  assert.ok(visto > 0, 'premissa: há orçamento com corte parcial e a decisão entre as sobras');
});

// ───────────────────────────── GM-15 T29 (D-G1b, D-G1c): a cara do E4 com a regra do painel novo e a validação que o E4 não tinha

/** Estado rico, do projetar real: 3 integradas, T4 implementando (com uso medido), T5 em revisão, T6–T8 na fila, pendência, CI vermelho, decisão da Sombra. */
const IDS8 = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const P8: Plano = { entrega: 'GM-14', tasks: IDS8.map((id, i) => ({ id, titulo: `Tarefa ${id} do painel`, deps: i === 5 ? ['T5'] : [], arquivos: [] })) };
const rico = (extra: Partial<Entrada> = {}): EstadoPainel => {
  const s = proj(P8, [...EXECUCAO, nota(45, 'pendencia', 'renovar o certificado'), DEC(50, 'seguir com a T3'), e(60, 'ci.resultado', { verde: false, alvo: 'main' })], {
    agentes: [{ ...vivo('T4 implementador'), uso: { contexto: 60_000, tok: 90_000, modelo: 'claude-sonnet' } }, vivo('T5 revisor')],
    contexto: { percent: 55, tokens: 120_000, window: 200_000 }, limites: { h5: 30, d7: 70 }, modeloSessao: 'claude-sonnet', titulo: 'GM-14 — Clareza para quem usa',
    fatos: fatos({ plano: { tasks: IDS8 } }), ...extra,
  });
  return { ...s, equipe: { ...s.equipe, lider: { ...s.equipe.lider, tok: 732_000 } } }; // tok do líder vem de custo.medicao; o estado é dado
};
const segs = (l: { texto: string; cor?: string }[]): string => l.map((x) => x.texto).join('');
const desenho = (s: EstadoPainel, o: Partial<OpcoesRender>, velho = false): { texto: string; cor?: string }[][] =>
  (velho ? renderEsquadrao(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 120, ...o } as OpcoesRender)
    : renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 120, ...o } as OpcoesRender)) as { texto: string; cor?: string }[][];
/** Classe estrutural de cada linha do desenho do E4 (a mesma para o render novo e o `renderEsquadrao` de referência). */
const classe = (x: string): string => {
  if (SEP.test(x)) return 'sep';
  if (/^GABARITO/.test(x)) return 'cabeçalho';
  if (/^◆ DEPENDE DE VOCÊ/.test(x)) return 'depende';
  if (/^PLANO/.test(x)) return 'plano';
  if (/^ {2}✓ /.test(x)) return 'faixa';
  if (/^ {2}[●◐✗] T/.test(x)) return 'task';
  if (/^ {2}○ /.test(x)) return 'fila';
  if (/^EQUIPE/.test(x)) return 'equipe';
  if (/^\S+ {2}orquestra/.test(x)) return 'líder';
  if (/^│ {2}ctx /.test(x)) return 'ctx';
  if (/^│ {2}(5h|7d) /.test(x)) return 'limites';
  if (/^│ {2}[▶▸] /.test(x)) return 'narração';
  if (/^[├└]─ ○ \S+( {2}aconselha.*)?$/.test(x)) return 'sombra-fixa'; // sem decisão (g.8) só o nome
  if (/^[├└]─ ◐ /.test(x)) return 'revisor-aguarda';
  if (/^[├└]─ [●◌] /.test(x)) return 'agente';
  if (/^◆ ATENÇÃO/.test(x)) return 'atenção';
  if (/^(\d\d:\d\d|\?) \S /.test(x)) return 'histórico';
  if (/^CI ●/.test(x)) return 'rodapé';
  return 'item';
};
const estrutura = (xs: string[]): string[] => xs.map(classe).filter((c, i, cs) => i === 0 || cs[i - 1] !== c);

for (const largura of [120, 80]) {
  test(`layout-e4-snapshot-${largura}: mesmo estado, render novo × renderEsquadrao (2.0.0): mesmas seções na mesma ordem; diferenças só as da regra nova`, () => {
    const s = rico();
    const novo = desenho(s, { largura }).map(segs);
    const velho = desenho(s, { largura }, true).map(segs);
    // diferenças que a regra nova manda (cada uma, uma só): FIEL-6 c sem "revisor aguarda" falso (a Sombra voltou a ter a linha fixa de `renderEsquadrao`, g.8)
    const esperado = estrutura(velho).filter((c) => c !== 'revisor-aguarda');
    assert.deepEqual(estrutura(novo), esperado, `novo:\n${novo.join('\n')}\n\nE4:\n${velho.join('\n')}`);
    assert.ok(novo.every((x) => colunas(x) <= largura), 'nenhuma linha passa da largura');
    // campo a campo: cada dado do E4 está no novo (mutação que tira qualquer um morre)
    const t = novo.join('\n');
    assert.match(novo[0], /^GABARITO · GM-14 Clareza para quem usa +esquadrão · terra média$/, 'cabeçalho com o preset à direita; título uma vez (o E4 dizia "GM-14 GM-14")');
    assert.equal((novo[0].match(/GM-14/g) ?? []).length, 1);
    assert.match(t, /^◆ DEPENDE DE VOCÊ {2}1 item\n {2}renovar o certificado \[feito\]$/m, 'DEPENDE');
    assert.match(t, /^PLANO {3}▰+▱+ {2}38% {2}3\/8 tasks +previsão \d\d:\d\d \(base: 3 tasks desta entrega\)$/m, 'PLANO com barra, %, k/N tasks e o status à direita');
    assert.match(t, /^ {2}✓ 3 integradas · 1\.0 rodada média · mediana \d+ min$/m, 'faixa das integradas');
    assert.match(t, /^ {2}● T4 {2}(Tarefa T4 do painel {2})?implementando {2}\S+ +\d+(m|h\d\d)$/m, 'task em voo com estado, nome e tempo');
    assert.match(t, /^ {2}○ T6 {2}(Tarefa T6 do painel {2})?fila · depende de T5$/m, 'fila com a dependência aberta');
    assert.match(t, /^ {2}○ T7–T8 {2}fila$/m, 'resto da fila');
    assert.match(t, /^EQUIPE +agentes 2 vivos$/m);
    assert.match(t, /^GANDALF {2}orquestra · sonnet$/m);
    assert.match(t, /^│ {2}ctx █+░+ 55% · pouso em 50% · hora de pousar {3}tok 732k$/m, 'barra de contexto, pouso, hora de pousar e tokens do líder');
    assert.match(t, /^│ {2}5h █{3}░{7} 30% {3}7d █{7}░{3} 70%$/m, 'barras de 10 dos limites 5h e 7d');
    assert.match(t, /^│ {2}▸ \S/m, 'narração');
    assert.match(t, /^├─ ● \S+ · sonnet +T4 +ctx █{3}░{7} 30% +60k · \d+(m|h\d\d) +implementando( \(registrado\)| \(regis.*…)$/m, 'agente com barra de contexto, tokens, tempo e o que faz (cortado no fim, nunca no número)');
    assert.match(t, largura === 120 ? /^├─ ● \S+ +T5 +ctx \? \(sem medição\) +\d+(m|h\d\d) +revisando \(registrado\)$/m : /^├─ ● \S+ +T5 +ctx \? +\d+(m|h\d\d) +revisando \(regis/m,
      'agente sem medição: "?", nunca barra vazia; o motivo (g.9) só a partir de 100 colunas');
    assert.match(t, /^└─ ○ ELROND {2}aconselha {2}1 decisão · #\d+ seguir com a T3 \(spec:1\)$/m, 'g.8: a Sombra é o último └ da EQUIPE (nome, aconselha, nº de decisões, última #seq resposta (fonte))');
    assert.ok(novo.every((x) => !/^[├└]─ [●○] \S+ +(Teste|Integrando|Comando|Aguardando)/.test(x)), 'g.11: shell de fundo nunca na árvore da EQUIPE');
    assert.match(t, /^◆ ATENÇÃO {2}CI vermelho na última execução$/m);
    assert.match(t, /^\d\d:\d\d ● ELROND decidiu: seguir com a T3 \(anotado pelo orquestrador\)$/m, 'histórico com origem');
    assert.match(t, /^CI ● vermelho {3}PROD leu 0 · alterou 0 {3}política continua$/m, 'rodapé');
    if (largura === 120) {
      // barras idênticas às do E4 (mesma largura, mesmos glifos)
      const barras = (xs: string[]): string[] => xs.flatMap((x) => x.match(/[▰▱]{5,}|[█░]{10,}/g) ?? []);
      for (const b of barras(velho.filter((x) => /^(PLANO|│ {2}ctx|│ {2}5h)/.test(x)))) assert.ok(barras(novo).includes(b), `barra do E4 "${b}" no novo`);
    }
  });
}

test('cores-paridade-e4: segmento a segmento (texto → cor) igual ao renderEsquadrao nas linhas equivalentes; mono sem cor', () => {
  const s = rico();
  const novo = desenho(s, {});
  const velho = desenho(s, {}, true);
  const linha = (xs: { texto: string; cor?: string }[][], re: RegExp) => xs.find((l) => re.test(segs(l))) as { texto: string; cor?: string }[];
  const cor = (l: { texto: string; cor?: string }[], re: RegExp): string | undefined => l.find((x) => re.test(x.texto))?.cor;
  // barras: ctx do líder, limites, plano, agente
  for (const [re, glifos] of [[/^│ {2}ctx/, [/^█+$/, /^░+$/]], [/^│ {2}5h/, [/^█+$/, /^░+$/]], [/^PLANO/, [/^▰+$/, /^▱+$/]]] as [RegExp, RegExp[]][]) {
    for (const g of glifos) assert.equal(cor(linha(novo, re), g), cor(linha(velho, re), g), `${re} ${g}`);
  }
  assert.equal(cor(linha(novo, /^│ {2}ctx/), /^│$/), 'inactive');
  assert.equal(cor(linha(novo, /^│ {2}ctx/), /pouso em/), cor(linha(velho, /^│ {2}ctx/), /pouso em/));
  // fila: glifo e estado pela cor do estado; nome pela cor do agente
  for (const re of [/^ {2}● T4/, /^ {2}● T5/]) {
    const a = linha(novo, re);
    const b = linha(velho, re);
    for (const g of [/^●$/, /implementando|em revisão/]) assert.equal(cor(a, g), cor(b, g), `${re} ${g}`);
    const nome = b.find((x) => /^[A-Z]{3,} *$/.test(x.texto));
    assert.ok(nome !== undefined && nome.cor !== undefined, 'premissa: o E4 pinta o nome');
    assert.equal(cor(a, new RegExp(`^${nome.texto.trim()} *$`)), nome.cor, `${re}: cor do agente na fila`);
  }
  // árvore: glifo pela cor do estado da task, nome pela cor do agente, barra
  const agN = linha(novo, /^├─ ● /);
  const agV = linha(velho, /^├─ ● /);
  for (const g of [/^●$/, /^[A-Z]{3,} *$/, /^█+$/, /^├─ $/]) assert.equal(cor(agN, g), cor(agV, g), `agente ${g}`);
  assert.ok(cor(agN, /^[A-Z]{3,} *$/) !== undefined, 'o agente tem cor própria (corDoNome do E4)');
  // faixa, CI, histórico
  assert.equal(cor(linha(novo, /^ {2}✓/), /^✓$/), cor(linha(velho, /^ {2}✓/), /^✓$/));
  assert.equal(cor(linha(novo, /^CI/), /^●$/), 'warning');
  assert.equal(cor(linha(novo, /^CI/), /^●$/), cor(linha(velho, /^CI/), /^●$/));
  assert.equal(cor(linha(novo, /^◆ ATENÇÃO/), /^◆ ATENÇÃO$/), 'warning');
  assert.equal(cor(linha(novo, /^\d\d:\d\d ● ELROND/), /^\d\d:\d\d $/), 'inactive');
  // mono: sem SGR; color: com
  assert.doesNotMatch(paraTexto(renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 120 }), 'mono'), /\x1b\[/);
  assert.match(paraTexto(renderPainel(s, { preset: 'esquadrao', tema: 'color', narracao: true, largura: 120 }), 'color'), /\x1b\[/);
});

/** Painel real da 2.0.0 a 89 colunas, colado pelo dono (D-G1c, .claude-tmp/gm15/painel-referencia-dono.txt): a cara a reproduzir, com os erros que NÃO voltam. */
const REFERENCIA_DONO = `GABARITO · GM-14 GM-14 — Clareza para quem usa                       esquadrão · hogwarts
◆ DEPENDE DE VOCÊ  1 item
  loop pausado  /gabarito retomar
─────────────────────────────────────────────────────────────────────────────────────────
PLANO   ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  3%  1/31 tasks                                loop pausado
  ✓ T1   integrada · 1.0 rodada média · mediana 55 min
  ◐ T0   Spikes pré-construção                 aprovada           1h19
  ◐ T1b  Contratos do painel fiel              aguarda revisão    36m
  ◐ T2   Orçamento e prioridade de linhas      aprovada           6m
  ◐ T3   Trilha, fase e progresso              aguarda revisão    36m
  ◐ T4   Origem, normalização e regex técnica  aprovada           44m
  ◐ T5   Linha de ferramenta natural           aguarda revisão    36m
  ◐ T6   \`loop.mjs anotar\`                     aprovada           16m
  ◐ T7   Onboarding em linguagem simples       aprovada           35m
  ◐ T8   Herança da 1.x, coleta                reprovada          5m
  ◐ T9   Oferta do modo foco                   aprovada           17m
  ◐ T10  Instalador ignora \`_onboarding/\`      aprovada           11m
  ◐ T12  Perguntas abertas                     aguarda revisão    5m
  ◐ T27  Dono só barra pousar e concluir       aprovada           13m
  ○ T11  \`painel.mjs medir\`                    fila · depende de T3
  ○ 16 tasks  fila
─────────────────────────────────────────────────────────────────────────────────────────
EQUIPE                                                                    agentes 0 vivos
MINERVA  orquestra · opus
│  ctx ███████░░░░░░░░░░░░░░░░░░░░░░ 23% · pouso em 50%   tok 732k
│  7d ███░░░░░░░ 34%
│  ▶ pausado, nada novo é despachado
├─ ◐ revisor aguarda T1b
├─ ◐ revisor aguarda T3
├─ ◐ revisor aguarda T5
├─ ◐ HARRY  revisa aguarda T12
└─ ○ DUMBLEDORE  aconselha  2 decisões · #51 MAJOR-A: entrega identificada pela ponte di…
─────────────────────────────────────────────────────────────────────────────────────────
◆ ATENÇÃO  T8 na 2ª rodada de review · T12 na 2ª rodada de review
─────────────────────────────────────────────────────────────────────────────────────────
18:03 ▶ despachou DRACO em T12
18:03 ▶ despachou SNAPE em T2
18:05 ✓ SNAPE aprovou T2 · 2 min
18:05 ✗ GINNY reprovou T8 · 1 achado
CI ● —   PROD leu 0 · alterou 0   política sob_demanda                       ▼ 60 eventos`;

test('referencia-do-dono-2-0-0 (D-G1c): estado equivalente ao painel real de 89 col tem a mesma estrutura, sem os erros que não podem voltar', () => {
  const ref = REFERENCIA_DONO.split('\n').filter((l) => l !== '');
  // erros da referência (regra nova): agentes falsos "revisor aguarda" saem; o título não repete o ID; nada de "—"; a linha fixa da Sombra voltou (g.8)
  const esperado = estrutura(ref).filter((c) => c !== 'revisor-aguarda');
  const IDSR = ['T0', 'T1', 'T1b', 'T2', 'T3', 'T11', 'T13', 'T14'];
  const s = proj({ entrega: 'GM-14', tasks: IDSR.map((id) => ({ id, titulo: `Tarefa ${id}`, deps: id === 'T11' ? ['T3'] : [], arquivos: [] })) },
    [...ciclo('T1', 0), ini(10, 'T0'), con(11, 'T0'), ini(12, 'T1b'), con(13, 'T1b'), ini(14, 'T2'), con(15, 'T2'), ini(16, 'T3'), con(17, 'T3'), nota(20, 'pendencia', 'retomar o loop'), e(30, 'ci.resultado', { verde: false, alvo: 'main' })],
    { agentes: [], limites: { h5: null, d7: 34 }, titulo: 'GM-14 — Clareza para quem usa', politica: { politica: 'sob_demanda', dias: null }, fatos: fatos({ plano: { tasks: IDSR } }) });
  const l = cru(s, { largura: 89 });
  assert.deepEqual(estrutura(l), esperado, `novo:\n${l.join('\n')}\n\nreferência:\n${ref.join('\n')}`);
  const t = l.join('\n');
  assert.match(l[0], /^GABARITO · GM-14 Clareza para quem usa +esquadrão · terra média$/);
  assert.doesNotMatch(t, /GM-14 GM-14|aguarda T|revisa aguarda|—|rodada de review/, 'erros da 2.0.0 que não voltam');
  assert.match(t, /^│ {2}7d █{3}░{7} 34%$/m, 'g.10 (D-G7): sem five_hour o campo 5h é omitido (nunca "5h ?"), o 7d medido segue');
  assert.doesNotMatch(t, /5h/, 'nenhum "5h ?"');
  assert.match(t, /^ {2}◐ T0 .* entregue/m, 'concluída se diz "entregue" (FIEL-8)');
  assert.ok(l.every((x) => colunas(x) <= 89));
});

const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/u;
test('largura-glifos-validacao-nova: 120/100/80/60/44 sem linha maior que a largura, sem quebra, sem glifo que vire emoji, nos dois presets e em 5 estados', () => {
  const estados: [string, EstadoPainel][] = [
    ['rico', rico()],
    ['parou', proj(P(...IDS), [...noTeto('T1', 0), e(20, 'loop.parar', { motivo: 'teto_rodadas', task: 'T1' })], { agentes: [vivo('T2 implementador')] })],
    ['sem-agentes', rico({ agentes: null })],
    ['vazio', proj(P(...IDS), [])],
    ['segundo-plano', rico({ segundoPlano: [{ id: 'b', dono: 'orquestrador', texto: 'npm test ⚠️ 🚀 com emoji', desde: AGORA - 60_000 }] })],
  ];
  for (const [nome, s] of estados) for (const preset of ['esquadrao', 'executivo'] as const) for (const largura of [120, 100, 80, 60, 44]) {
    const l = cru(s, { preset, largura });
    for (const x of l) {
      assert.ok(colunas(x) <= largura, `${nome} ${preset} ${largura}: passou da largura: "${x}"`);
      assert.ok(!x.includes('\n') && !EMOJI_RE.test(x), `${nome} ${preset} ${largura}: glifo emoji ou quebra: "${x}"`);
      assert.ok(!linhaTecnica(x) || /^│/.test(x) === false, `${nome}: técnica "${x}"`);
    }
    assert.ok(!l.some((x) => /▶/.test(x)), '▶ do E4 é pictográfico: a narração usa ▸');
  }
});

test('hora-de-pousar-nunca-cortada: 80, 60 e 44 colunas, com e sem a linha do nome (orçamento), contexto estimado incluso', () => {
  for (const largura of [80, 72, 60, 50, 44]) for (const orcamento of [undefined, 9, 7]) {
    const s = rico();
    const l = cru(s, { largura, ...(orcamento === undefined ? {} : { orcamento }) });
    const ctx = l.find((x) => /ctx .*55%/.test(x));
    assert.ok(ctx !== undefined && / · hora de pousar/.test(ctx), `${largura}/${orcamento}: ${l.join('|')}`);
    const est = { ...s, agora: { ...s.agora!, orquestrador: { ...s.agora!.orquestrador, estimado: true } } } as EstadoPainel;
    const le = cru(est, { largura });
    assert.ok(le.some((x) => /ctx .*~55%( \(estimado\))? .*· hora de pousar/.test(x) && colunas(x) <= largura), `${largura} estimado: ${le.join('|')}`);
    if (largura >= 60) assert.ok(le.some((x) => /~55% \(estimado\)/.test(x)), `${largura}: o "(estimado)" só cede abaixo de 60`);
  }
});

test('hora-de-pousar-nunca-cortada-estreito-e-nome-longo (review T29 r1): abaixo de 44 e com líder de nome longo, o nome e a barra cedem antes', () => {
  for (const lider of ['GANDALF', 'GANDALFOOOOOOOOOOLONGO']) for (const largura of [80, 60, 44, 43, 36, 30, 24, 20]) for (const orcamento of [undefined, 7]) for (const estimado of [false, true]) {
    const s0 = rico({ pacote: { ...PACOTE, lider } });
    const s = estimado ? ({ ...s0, agora: { ...s0.agora!, orquestrador: { ...s0.agora!.orquestrador, estimado: true } } } as EstadoPainel) : s0;
    const l = cru(s, { largura, ...(orcamento === undefined ? {} : { orcamento }) });
    const ctx = l.filter((x) => /pous/.test(x));
    const rot = `${lider} ${largura}/${orcamento}/${estimado}: ${l.join('|')}`;
    assert.equal(ctx.length, 1, rot);
    // o número cede só quando nem ele cabe ao lado do aviso (20 colunas com "~55%")
    assert.match(ctx[0], largura >= 24 ? /~?55%( \(estimado\))?( · pouso em \d+%)? · hora de pousar( {3}tok \S+)?$/ : /(^|~?55% · )hora de pousar$/, rot);
    assert.ok(colunas(ctx[0]) <= largura, rot);
    // o nome cede encurtando ("…") antes de sair: a 30 colunas ainda se lê o começo do líder
    if (largura >= 30 && !ctx[0].startsWith('│')) assert.match(ctx[0], /^GAN/, rot);
  }
});

test('atencao-agrupada-nada-some (review T29 r1): N avisos que não cabem numa linha vão às linhas seguintes; todos aparecem, inteiros, a 120, 80 e 44', () => {
  const avisos = ['primeiro aviso de atenção da fila', 'segundo aviso de atenção da fila', 'terceiro aviso de atenção da fila', 'quarto aviso de atenção da fila',
    'quinto aviso de atenção da fila', 'sexto aviso de atenção da fila', 'sétimo aviso de atenção da fila'];
  const s = { ...rico(), atencao: avisos } as EstadoPainel;
  for (const largura of [120, 80, 44]) {
    const l = cru(s, { largura });
    const i0 = l.findIndex((x) => /^◆ (ATENÇÃO {2})?primeiro aviso/.test(x));
    assert.ok(i0 >= 0, `${largura}: ${l.join('|')}`);
    const bloco: string[] = [l[i0]];
    for (let i = i0 + 1; i < l.length && /^ {2,}\S/.test(l[i]); i++) bloco.push(l[i]);
    assert.ok(bloco.length >= 2, `${largura}: os 7 avisos não cabem numa linha: ${bloco.join('|')}`);
    const itens = bloco.map((x, k) => (k === 0 ? x.replace(/^◆ (ATENÇÃO {2})?/, '') : x.trim())).flatMap((x) => x.split(' · '));
    assert.deepEqual(itens, avisos, `${largura}: todos, inteiros e na ordem: ${bloco.join('|')}`);
    assert.ok(bloco.every((x) => colunas(x) <= largura), `${largura}: ${bloco.join('|')}`);
    assert.equal(l.filter((x) => /^◆ ATENÇÃO/.test(x)).length, largura >= 60 ? 1 : 0, `${largura}: um rótulo só`);
  }
});

test('ausente-corrompido-zero-distintos: ausente e corrompido viram "?" (nunca 0 nem "—"); 0 medido é 0', () => {
  const base = rico();
  const base_ = (v: unknown, campo: 'h5' | 'd7' | 'tok'): EstadoPainel => ({ ...base, equipe: { ...base.equipe, lider: { ...base.equipe.lider, [campo]: v } } } as EstadoPainel);
  const comLider = (v: unknown, campo: 'h5' | 'd7' | 'tok'): string => cru({ ...base, equipe: { ...base.equipe, lider: { ...base.equipe.lider, [campo]: v } } } as EstadoPainel).join('\n');
  for (const v of [null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY, '30']) {
    // g.10 (D-G7): 5h ausente ou corrompido é OMITIDO (exceção à D-P13 só para este campo); 7d e tok seguem "?" e, a partir de 100 colunas, dizem por quê (g.9)
    assert.match(comLider(v, 'h5'), /^│ {2}7d █/m, `5h ${String(v)}`);
    assert.doesNotMatch(comLider(v, 'h5'), /5h/, `5h ${String(v)}: nunca "5h ?"`);
    assert.match(comLider(v, 'd7'), / {3}7d \? \(sem medição\)$/m, `7d ${String(v)}`);
    assert.match(comLider(v, 'tok'), /tok \? \(sem medição\)$/m, `tok ${String(v)}`);
    assert.match(cru(base_(v, 'tok'), { largura: 80 }).join('\n'), /tok \?$/m, `tok ${String(v)} a 80 colunas: só o "?"`);
  }
  assert.match(comLider(0, 'h5'), /^│ {2}5h ░{10} 0% /m, '0 medido é barra vazia com 0%');
  assert.match(comLider(0, 'tok'), /tok 0$/m);
  const orq = (v: unknown): string => cru({ ...base, agora: { ...base.agora!, orquestrador: { ...base.agora!.orquestrador, contexto: v } } } as EstadoPainel).join('\n');
  for (const v of [null, Number.NaN, -5, '55']) {
    assert.match(orq(v), /^│ {2}ctx \? \(sem medição\) · pouso em 50% {3}tok 732k$/m, `ctx ${String(v)}`);
    assert.doesNotMatch(orq(v), /hora de pousar/);
  }
  assert.match(orq(0), /^│ {2}ctx ░+ 0% · pouso em 50%/m);
  const agente = (v: unknown): string => cru({ ...base, equipe: { ...base.equipe, agentes: base.equipe.agentes.map((a) => (a.task === 'T4' ? { ...a, ctxPct: v, ctxTok: v } : a)) } } as EstadoPainel).join('\n');
  for (const v of [null, Number.NaN, -1]) assert.match(agente(v), /^├─ ● \S+ · sonnet +T4 +ctx \? /m, `agente ${String(v)}`);
  assert.match(agente(0), /^├─ ● \S+ · sonnet +T4 +ctx ░{10} 0% +0 · /m);
  const rod = (v: unknown): string => cru({ ...base, rodape: { ...base.rodape, prod: { leituras: v, alteracoes: v }, ci: { verde: null, execucoesHoje: 0 } } } as EstadoPainel).join('\n');
  assert.match(rod(Number.NaN), /^CI ● \? \(CI sem execução\) {3}PROD leu \? \(diário sem leitura\) · alterou \? \(diário sem leitura\) {3}política/m, 'g.9: cada "?" do rodapé diz por quê');
  assert.match(rod(0), /^CI ● \? \(CI sem execução\) {3}PROD leu 0 · alterou 0/m);
  const pr = (v: unknown): string => cru({ ...base, pronto: { ...base.pronto!, integradas: v } } as EstadoPainel).join('\n');
  assert.match(pr(Number.NaN), /^PLANO {3}\? {2}\?\/8 tasks/m, 'sem número, "?" no lugar da barra');
  assert.match(pr(0), /^PLANO {3}▱+ {2}0% {2}0\/8 tasks/m);
  for (const x of [rico(), base].flatMap((s) => cru(s))) assert.ok(!x.includes('—') || /^GABARITO/.test(x), `"—" no lugar de "?": ${x}`);
});

test('fiel4-sem-agentes-em-toda-largura: sem --agentes nenhuma linha de ctx, tok, 5h/7d, árvore ou nome sorteado', () => {
  const s = rico({ agentes: null });
  for (const largura of [120, 80, 60, 50, 40]) for (const preset of ['esquadrao', 'executivo'] as const) {
    const t = cru(s, { largura, preset }).join('\n');
    assert.match(t, /^EQUIPE · agentes e contexto/m, `${largura} ${preset}`);
    assert.doesNotMatch(t, /ctx|tok |5h|7d|^[├└]|GANDALF|ARAGORN|LEGOLAS|GIMLI|orquestra\b|▸/m, `${largura} ${preset}:\n${t}`);
  }
});

test('arvore-cede-texto-antes-de-numero: a 60 colunas a linha do agente cede o modelo e o tempo para a ação aparecer; ctx e tokens nunca são cortados', () => {
  const s = rico();
  const linha = (largura: number): string => cru(s, { largura }).find((x) => /^├─ ● .* T4 /.test(x)) as string;
  assert.match(linha(120), /· sonnet .* 30% +60k · \d+(m|h\d\d) {2}implementando \(registrado\)$/);
  const l60 = linha(60);
  assert.ok(colunas(l60) <= 60, l60);
  assert.match(l60, /ctx █{3}░{7} 30% {2}60k {2}implementa/, `nível do E4: sem modelo e sem tempo, a ação à vista: ${l60}`);
  assert.doesNotMatch(l60, /sonnet/);
});

// ───────────────────────────── GM-15 T33 (emenda 11, g.8–g.11; D-G7, D-G8): Sombra na EQUIPE, "?" com motivo, 5h omitido, SEGUNDO PLANO

const SHELLS = [
  { id: 'b1', dono: 'orquestrador', texto: 'integrar T16', desde: AGORA - 300_000, comando: 'node gates/scripts/loop.mjs integrar T16' },
  { id: 'b2', dono: 'orquestrador', texto: 'rodar a suíte', desde: AGORA - 90_000, comando: 'bash plugins/gabarito-mestre/scripts/test/mod-test.sh' },
  { id: 'b3', dono: 'a-T4 implementador', texto: 'esperar o arquivo', desde: AGORA - 45_000, comando: 'until grep -q pronto saida.txt; do sleep 5; done' },
  { id: 'b4', dono: 'orquestrador', texto: 'listar', desde: AGORA - 12_000, comando: 'ls -la' },
] as unknown as NonNullable<EntradaPainel['segundoPlano']>;
const comShells = (extra: Partial<Entrada> = {}): EstadoPainel => proj(P(...IDS), [...EXECUCAO, DEC(50, 'seguir com a T3')], { agentes: [vivo('T4 implementador'), vivo('T5 revisor')], segundoPlano: SHELLS, ...extra });
const arvore = (l: string[]): string[] => l.filter((x) => /^[├└]─? /.test(x));
const secaoSegundoPlano = (l: string[]): string[] => { const i = l.findIndex((x) => /^SEGUNDO PLANO/.test(x)); return i < 0 ? [] : l.slice(i + 1).filter((x, k, xs) => xs.slice(0, k + 1).every((y) => /^ {2}◦ /.test(y))); };

test('shell-nunca-na-equipe: nenhum shell de fundo (integrando, teste, aguardando, comando) vira linha da árvore da EQUIPE (D-G8)', () => {
  const s = comShells();
  assert.equal(s.agora?.agentes?.length, 2, 'agora.agentes só tem os agentes');
  assert.equal(s.agora?.segundoPlano.length, 4, 'o shell vive em agora.segundoPlano');
  for (const largura of [200, 120, 80, 60, 44]) for (const preset of ['esquadrao', 'executivo'] as const) {
    const l = linhas(s, { largura, preset });
    const t = arvore(l);
    assert.equal(t.length, 3, `${largura} ${preset}: 2 agentes + a Sombra: ${t.join('|')}`);
    assert.equal(t.filter((x) => /^[├└]─? ● /.test(x)).length, 2, `${largura} ${preset}: só os 2 agentes: ${t.join('|')}`);
    assert.ok(t.every((x) => !/Integrando|Aguardando|Comando|\bTeste\b/.test(x)), `${largura} ${preset}: shell na árvore: ${t.join('|')}`);
    assert.match(l.find((x) => /^EQUIPE/.test(x)) ?? 'EQUIPE agentes 2 vivos', /2 vivos$|^EQUIPE$/, 'N vivos não conta o shell');
  }
});

test('subagente-nunca-no-segundo-plano: o SEGUNDO PLANO lista só shell; agente vivo (implementador, revisor) nunca é linha da seção, só aparece como QUEM disparou', () => {
  const l = linhas(comShells(), { largura: 200 });
  const sec = secaoSegundoPlano(l);
  assert.equal(sec.length, 4, `4 shells, 1 linha cada: ${sec.join('|')}`);
  assert.ok(sec.every((x) => /^ {2}◦ (Integrando|Teste|Aguardando|Comando)\b/.test(x)), `só tipos de shell: ${sec.join('|')}`);
  assert.equal(sec.filter((x) => /^ {2}◦ (ARAGORN|GIMLI|Implementador|Revisor)/.test(x)).length, 0, 'nenhum agente como linha');
  assert.equal(sec.filter((x) => x.includes('ARAGORN')).length, 1, 'o agente dono do shell b3 aparece só como quem o disparou');
  const so = linhas(proj(P(...IDS), [...EXECUCAO], { agentes: [vivo('T4 implementador'), vivo('T5 revisor')], segundoPlano: [] }), { largura: 200 });
  assert.equal(secaoSegundoPlano(so).length, 0, '2 agentes e 0 shell ⇒ seção nenhuma (agente não é shell)');
});

test('segundo-plano-1-linha-80col: 1 linha por shell com tipo · task · quem disparou · tempo, e nenhuma passa de 80 colunas; ordem DEPENDE · PLANO · EQUIPE · SEGUNDO PLANO · ATENÇÃO · RECENTE · rodapé', () => {
  const l = linhas(comShells({ fatos: fatos() }), { largura: 80 });
  const cab = l.findIndex((x) => /^SEGUNDO PLANO/.test(x));
  assert.ok(cab > 0, l.join('\n'));
  assert.match(l[cab], /^SEGUNDO PLANO +1 integrando · 1 teste · 1 aguardando · 1 comando$/, 'cabeçalho com a contagem por tipo');
  const sec = secaoSegundoPlano(l);
  assert.equal(sec.length, 4);
  assert.match(sec[0], /^ {2}◦ Integrando T16 · GANDALF · 5m$/, 'integrar T16: task provada pelo comando, quem = a sessão principal, tempo');
  assert.match(sec[1], /^ {2}◦ Teste · GANDALF · 1m$/, 'mod-test.sh ⇒ Teste; sem task provada não inventa task');
  assert.match(sec[2], /^ {2}◦ Aguardando T4 · ARAGORN · 0m$/, 'laço until ⇒ Aguardando; a task e o nome são os do agente que o disparou');
  assert.match(sec[3], /^ {2}◦ Comando · GANDALF · 0m$/, 'o resto ⇒ Comando');
  assert.ok(l.every((x) => colunas(x) <= 80), 'nada passa de 80 colunas');
  // ordem das seções (D-G8)
  const marcas = l.map((x, i) => [i, /^depende de você|^◆ DEPENDE/.test(x) ? 'DEPENDE' : /^PLANO/.test(x) ? 'PLANO' : /^EQUIPE/.test(x) ? 'EQUIPE' : /^SEGUNDO PLANO/.test(x) ? 'SEGUNDO' : /^◆ ATENÇÃO/.test(x) ? 'ATENÇÃO' : ehRecente(x) ? 'RECENTE' : /^CI ●/.test(x) ? 'RODAPÉ' : ''] as const).filter(([, m]) => m !== '').map(([, m]) => m)
    .filter((m, i, ms) => i === 0 || ms[i - 1] !== m);
  assert.deepEqual(marcas, ['DEPENDE', 'PLANO', 'EQUIPE', 'SEGUNDO', 'RECENTE', 'RODAPÉ']);
  // o separador do E4 vai entre a EQUIPE e o SEGUNDO PLANO (seção própria, não continuação da árvore) e entre ele e o que vem depois
  const c = cru(comShells(), { largura: 80 });
  const ic = c.findIndex((x) => /^SEGUNDO PLANO/.test(x));
  assert.ok(SEP.test(c[ic - 1]), `separador antes do SEGUNDO PLANO: ${c.join('|')}`);
  assert.ok(SEP.test(c[ic + 5]), `separador depois das 4 linhas de shell: ${c.join('|')}`);
  // a Sombra segue como último └ da EQUIPE, antes da seção
  assert.ok(l.findIndex((x) => /^└─ ○ /.test(x)) < cab, 'a Sombra fecha a EQUIPE antes do SEGUNDO PLANO');
});

test('segundo-plano-estreito-resumo: abaixo de 60 colunas a seção é 1 linha-resumo "segundo plano: 1 integrando · 1 teste · …"', () => {
  for (const largura of [59, 50, 44]) {
    const l = linhas(comShells(), { largura });
    const r = l.filter((x) => /^segundo plano:/.test(x));
    assert.deepEqual(r, ['segundo plano: 1 integrando · 1 teste · 1 aguardando · 1 comando'].map((x) => (colunas(x) <= largura ? x : r[0])), `${largura}`);
    assert.equal(r.length, 1);
    assert.ok(l.every((x) => !/^ {2}◦ /.test(x)), 'sem 1 linha por shell');
    assert.ok(l.every((x) => colunas(x) <= largura));
  }
});

test('segundo-plano-e-a-1a-a-encolher: com o orçamento apertando, o SEGUNDO PLANO cai antes de tudo (prioridade 7; o resumo da seção, 6,9) e o resto fica', () => {
  const s = comShells();
  const cheio = cabe(s, { local: 'lateral', orcamento: 200, largura: 100 });
  const dosShells = cheio.filter((x) => /^ {2}◦ /.test(x));
  const resto = cheio.filter((x) => !/^ {2}◦ /.test(x) && !/^SEGUNDO PLANO/.test(x));
  assert.equal(dosShells.length, 4);
  // sem o SEGUNDO PLANO o desenho cabe em `resto.length` linhas (mais os separadores sobrando); cortando de 1 em 1 só sai shell até o resumo e depois nada do resto antes dele
  let ultimoComShell = 0;
  for (let orc = cru(s, { largura: 100, local: 'lateral' }).length; orc >= 9; orc--) {
    const l = cabe(s, { local: 'lateral', orcamento: orc, largura: 100 });
    const nShells = l.filter((x) => /^ {2}◦ /.test(x)).length;
    if (nShells > 0) ultimoComShell = orc;
    if (nShells < 4) for (const x of resto) assert.ok(l.map(norm).includes(norm(x)) || prioDe(x) >= 5, `orc ${orc}: "${x}" (prio ${prioDe(x)}) saiu antes do segundo plano`);
  }
  assert.ok(ultimoComShell > 0);
  const apertado = cabe(s, { local: 'lateral', orcamento: resto.length + 1, largura: 100 });
  assert.ok(apertado.every((x) => !/^ {2}◦ /.test(x)), 'sem folga, as linhas de shell são as primeiras a sair');
});

test('segundo-plano-vazio-some: sem shell de fundo não há cabeçalho, linha-resumo nem separador sobrando', () => {
  for (const largura of [200, 100, 80, 60, 44]) {
    const s = proj(P(...IDS), [...EXECUCAO, DEC(50, 'seguir com a T3')], { agentes: [vivo('T4 implementador')], segundoPlano: [] });
    const c = cru(s, { largura });
    assert.ok(c.every((x) => !/SEGUNDO PLANO|segundo plano|^ {2}◦ /.test(x)), `${largura}: ${c.join('|')}`);
    assert.ok(c.every((x, i) => !(SEP.test(x) && SEP.test(c[i + 1] ?? ''))), 'nunca 2 separadores colados');
    const sem = proj(P(...IDS), [...EXECUCAO], { agentes: [vivo('T4 implementador')] });
    assert.ok(cru(sem, { largura }).every((x) => !/SEGUNDO PLANO|segundo plano/.test(x)), 'campo ausente também some');
  }
});

test('sombra-ultimo-na-equipe (g.8): a Sombra é o último └ da árvore, nos 2 presets: nome, aconselha, modelo, decisões, última #seq resposta (fonte); estreito nome + #seq; sem decisão só o nome', () => {
  const s = comShells();
  for (const [preset, nome] of [['esquadrao', 'ELROND'], ['executivo', 'Conselheiro']] as const) {
    const t = arvore(linhas(s, { largura: 200, preset }));
    assert.equal(t.length, 3, `2 agentes + a Sombra: ${t.join('|')}`);
    assert.match(t[2], new RegExp(`^└─ ○ ${nome} {2}aconselha(?: · \\S+)? {2}1 decisão · #\\d+ seguir com a T3 \\(spec:1\\)$`), t[2]);
    assert.ok(t.slice(0, 2).every((x) => /^├─ ● /.test(x)), 'os agentes ficam com ├─; só a Sombra fecha');
  }
  const estreito = arvore(linhas(s, { largura: 50 }));
  assert.match(estreito[estreito.length - 1], /^└ ○ ELROND #\d+$/, 'estreito: nome + #seq');
  const sem = arvore(linhas(proj(P(...IDS), [...EXECUCAO], { agentes: [vivo('T4 implementador')] }), { largura: 200 }));
  assert.equal(sem[sem.length - 1], '└─ ○ ELROND', 'sem decisão só o nome');
  assert.ok(sem.slice(0, -1).every((x) => /^├─ /.test(x)) || sem.length === 2);
  // 2 decisões: o contador pluraliza
  const dois = arvore(linhas(proj(P(...IDS), [...EXECUCAO, DEC(50, 'a'), e(51, 'decisao.sombra', { pergunta_hash: 'b'.repeat(64), task: 'T3', resposta: 'b', arquivo: 'sombra.md', pergunta_enviesada: false, fontes: ['spec:1'] })], { agentes: [vivo('T4 implementador')] }), { largura: 200 }));
  assert.match(dois[dois.length - 1], /2 decisões · #\d+ b \(spec:1\)$/);
});

test('limite-5h-ausente-omite e limite-5h-presente-mostra (D-G7, g.10): sem five_hour só o 7d; com five_hour os dois', () => {
  const sem = linhas(proj(P(...IDS), [], { limites: { h5: null, d7: 70 } }), { largura: 200 });
  assert.ok(sem.includes('│  7d ███████░░░ 70%'), sem.join('\n'));
  assert.ok(sem.every((x) => !/5h/.test(x)), 'nunca "5h ?"');
  const com = linhas(proj(P(...IDS), [], { limites: { h5: 30, d7: 70 } }), { largura: 200 });
  assert.ok(com.includes('│  5h ███░░░░░░░ 30%   7d ███████░░░ 70%'), com.join('\n'));
  for (const largura of [80, 60, 44]) {
    assert.ok(linhas(proj(P(...IDS), [], { limites: { h5: null, d7: 70 } }), { largura }).every((x) => !/5h/.test(x)), `${largura}: omitido também no estreito`);
    assert.ok(linhas(proj(P(...IDS), [], { limites: { h5: 30, d7: 70 } }), { largura }).some((x) => /5h .*30%/.test(x) && /7d/.test(x)), `${largura}: presente aparece`);
  }
});

test('interrogacao-com-motivo (g.9): a partir de 100 colunas todo "?" diz por que falta; abaixo de 100 fica só o "?"', () => {
  const s = proj(P(...IDS), [...EXECUCAO], { agentes: [vivo('T4 implementador')], contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null } });
  const largo = linhas(s, { largura: 100 }).join('\n');
  assert.match(largo, /ctx \? \(sem medição\)/);
  assert.match(largo, /tok \? \(sem medição\)/);
  assert.match(largo, /7d \? \(sem medição\)/);
  assert.match(largo, /^CI ● \? \(CI sem execução\) {3}PROD leu 0 · alterou 0/m);
  assert.match(largo, /^PLANO .*3\/6 tasks.*$/m);
  const estreito = linhas(s, { largura: 99 }).join('\n');
  assert.doesNotMatch(estreito, /sem medição|CI sem execução|n insuficiente|diário sem leitura|sem fonte/, '99 colunas: só o "?"');
  assert.match(estreito, /ctx \?/);
  // ETA sem base (menos de 3 integradas) diz por quê a partir de 100 colunas
  const eta = proj(P(...IDS), [...ciclo('T1', 0)], {});
  assert.match(linhas(eta, { largura: 100 }).find((x) => /^PLANO/.test(x)) as string, /ETA \?: n insuficiente$/);
  assert.doesNotMatch(linhas(eta, { largura: 99 }).find((x) => /^PLANO/.test(x)) as string, /ETA|insuficiente/);
  // CI em execução (rodape.ci.pendente) ⇒ "CI pendente"
  const base = rico();
  const pend = cru({ ...base, rodape: { ...base.rodape, ci: { verde: null, execucoesHoje: 0, pendente: true } } } as EstadoPainel, { largura: 120 }).join('\n');
  assert.match(pend, /^CI ● \? \(CI pendente\)/m);
});

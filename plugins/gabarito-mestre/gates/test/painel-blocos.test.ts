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
import { renderBlocos } from '../src/painel-esquadrao.ts';
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
const linhas = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string[] =>
  paraTexto(renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 200, ...o }), 'mono').split('\n').filter((l) => l !== '');
const texto = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string => linhas(s, o).join('\n');

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
  assert.match(l[0], /^PAROU \d\d:\d\d · teto de rodadas de review em T1/);
  assert.match(l[0], /\(\+\d+\)$/, 'o que não coube vira (+N), nunca some em silêncio');
  const n = Number(/\(\+(\d+)\)$/.exec(l[0])?.[1]);
  const todas = linhas(s).filter((x) => /^(PAROU|depende de você|  )/.test(x) && !/^  \d\d:/.test(x));
  assert.ok(n >= 1 && n === todas.length - 1, `(+${n}) = itens do topo que não couberam (${todas.length - 1})`);
  // com 2 linhas a pergunta entra logo depois do PAROU
  const l2 = linhas(s, { orcamento: 2 });
  assert.match(l2[1], /qual caminho seguir\?/);
});

test('mais-n-so-se-nao-cabe: lista do topo que cabe inteira não ganha (+N); que não cabe, ganha', () => {
  const s = proj(P(...IDS), [nota(1, 'pendencia', 'renovar o certificado'), nota(2, 'pendencia', 'pagar a conta')]);
  const todas = linhas(s);
  assert.ok(todas.some((x) => /renovar o certificado/.test(x)) && todas.some((x) => /pagar a conta/.test(x)));
  for (const orc of [5, 9, 40]) assert.ok(linhas(s, { orcamento: orc }).every((x) => !/\(\+\d+\)/.test(x)), `orçamento ${orc}: cabe, sem (+N)`);
  const curto = linhas(s, { orcamento: 1 });
  assert.equal(curto.length, 1);
  assert.match(curto[0], /renovar o certificado.*\(\+1\)$/);
});

test('prioridades-por-h-e-maxrows: 9 pares de H × maxRows ⇒ ≤ orçamento, topo presente, blocos de cima antes dos de baixo, 0 "N more"', () => {
  const s = proj(P(...IDS), [...EXECUCAO, ...RECENTES.slice(-3), nota(50, 'pendencia', 'renovar o certificado')], {
    agentes: [vivo('T4 implementador'), vivo('T5 revisor')],
  });
  const ordem = (l: string) => (/^(PAROU|depende de você|  [a-z])/i.test(l) && !/^  (\d|ARAGORN|LEGOLAS|GIMLI|FRODO|SAM|MERRY|PIPPIN|BOROMIR|Teste)/.test(l) ? 1 : 0);
  void ordem;
  const pares: [number | undefined, number][] = [[50, 20], [40, 15], [24, 7], [20, 5], [50, 50], [24, 24], [20, 20], [24, 6], [50, 19]];
  const cheio = linhas(s);
  const blocoDe = (l: string, i: number, xs: string[]): string => {
    for (let k = i; k >= 0; k--) {
      const m = /^(GABARITO|depende de você|PAROU|PRONTO|FASE|AGORA|ATENÇÃO|RECENTE)/.exec(xs[k]);
      if (m) return m[1] === 'PAROU' ? 'depende de você' : m[1];
    }
    return '?';
  };
  const PRIO: Record<string, number> = { 'depende de você': 1, GABARITO: 2, PRONTO: 2, FASE: 2, AGORA: 3, 'ATENÇÃO': 4, RECENTE: 5 };
  const prioCheio = cheio.map((l, i) => PRIO[blocoDe(l, i, cheio)]);
  for (const [h, maxRows] of pares) {
    const orc = orcamentoDe(h, maxRows);
    const l = linhas(s, { orcamento: orc });
    assert.ok(l.length <= orc, `H ${h} maxRows ${maxRows}: ${l.length} > ${orc}`);
    assert.ok(l.length >= Math.min(orc, cheio.length), `H ${h} maxRows ${maxRows}: sobrou linha vazia`);
    assert.ok(l.some((x) => /^depende de você/.test(x)), `H ${h}: topo sumiu`);
    assert.ok(l.every((x) => !/\bmore\b/.test(x)), 'sem "N more"');
    const maxPrio = Math.max(...l.map((x) => PRIO[blocoDe(x, l.indexOf(x), l)] ?? 9));
    const presentes = new Set(l);
    // exceção declarada (emenda 37, 2ª ao D-P8): com a decisão da Sombra, o AGORA encolhe para a linha-resumo `N agentes:` antes de o RECENTE sair
    const resumido = l.some((x) => /^  \d+ agentes:/.test(x));
    cheio.forEach((x, i) => { if (prioCheio[i] < maxPrio && !(resumido && /^  \S+ · .* · /.test(x) && prioCheio[i] === 3)) assert.ok(presentes.has(x) || /\(\+\d+\)/.test(l.join('\n')), `H ${h}: "${x}" (prio ${prioCheio[i]}) saiu antes de prio ${maxPrio}`); });
  }
});

test('blocos-na-ordem-e-vazios-somem: DEPENDE · PRONTO · AGORA · ATENÇÃO · RECENTE; bloco sem conteúdo não ocupa linha', () => {
  const cheio = proj(P(...IDS), [...EXECUCAO, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] });
  const l = linhas(cheio);
  const rotulos = l.map((x) => /^(GABARITO|depende de você|PRONTO|FASE|AGORA|ATENÇÃO|RECENTE)/.exec(x)?.[1]).filter((x) => x !== undefined);
  assert.deepEqual(rotulos, ['GABARITO', 'depende de você', 'PRONTO', 'AGORA', 'ATENÇÃO', 'RECENTE']);
  const semAtencao = linhas(proj(P(...IDS), [...ciclo('T1', 0)], { agentes: [] }));
  assert.ok(semAtencao.every((x) => !/^ATENÇÃO/.test(x)), 'ATENÇÃO vazio some');
  const semRecente = linhas(proj(P(...IDS), [ini(0, 'T1')], { agentes: [vivo('T1 implementador')] }));
  assert.ok(semRecente.every((x) => !/^RECENTE/.test(x)), 'RECENTE vazio some');
  assert.ok(l.every((x) => !/^(PLANO|EQUIPE)\b/.test(x)), 'não há bloco PLANO nem EQUIPE');
  assert.ok(l.every((x) => !/\bT[123] integrada\b|^\s*✓ T[123]\b/.test(x)), 'task integrada não é listada');
});

// ───────────────────────────── RECENTE (FIEL-10 d, D-P9)

test('recente-5-lateral-2-acima e recente-so-resultados: só aprovou/reprovou/integrou/travou/decisão/pausa, mais novo no topo, com origem', () => {
  const s = proj(P(...IDS), RECENTES);
  const lat = linhas(s, { local: 'lateral' });
  const rec = (xs: string[]) => {
    const i = xs.findIndex((x) => /^RECENTE/.test(x));
    return i < 0 ? [] : xs.slice(i).filter((x, k) => k === 0 || /^  \d\d:\d\d/.test(x));
  };
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
  const semRecente = cheio.filter((x) => !/^RECENTE|^  \d\d:\d\d/.test(x));
  const l = linhas(s, { local: 'acima', orcamento: semRecente.length });
  assert.deepEqual(l, semRecente);
});

// ───────────────────────────── PRONTO / FASE (FIEL-10 b)

test('pronto-pinta-so-integradas: aprovada esperando não pinta; integrada não é listada', () => {
  const s = proj(P(...IDS), [...ciclo('T1', 0), ini(10, 'T2'), con(11, 'T2'), ini(12, 'T2', 'revisor'), ver(13, 'T2', true)]);
  assert.deepEqual(s.pronto, { integradas: 1, total: 6, previsao: null });
  const l = linhas(s).find((x) => /^PRONTO/.test(x)) as string;
  assert.match(l, /^PRONTO ▰{2}▱{8} 1 de 6 integradas$/);
});

test('previsao-so-com-base: previsão só com ≥ 3 integradas nesta entrega, dita com a base', () => {
  const dois = proj(P(...IDS), [...ciclo('T1', 0), ...ciclo('T2', 10)]);
  assert.equal(dois.pronto?.previsao, null);
  assert.doesNotMatch(texto(dois), /previsão/);
  const tres = proj(P(...IDS), [...ciclo('T1', 0), ...ciclo('T2', 10), ...ciclo('T3', 20)]);
  assert.equal(tres.pronto?.previsao?.base, 3);
  assert.match(texto(tres), /PRONTO ▰{5}▱{5} 3 de 6 integradas · previsão \d\d:\d\d \(base: 3 tasks desta entrega\)/);
});

test('fase-fora-de-entrega: sem plano, a linha FASE mostra n de 7, barra só de ✓, progresso e a trilha', () => {
  const spec = { caminho: 'docs/superpowers/specs/x.md', pbi: 'GM-14', sha256: 'a'.repeat(64), secoes: 6, titulo: 'Clareza' };
  const s = proj(null, [e(1, 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } })], { fatos: fatos({ plano: null, specs: [spec] }) });
  assert.equal(s.modo, 'entrega');
  assert.equal(s.pronto, null);
  const l = linhas(s).find((x) => /^FASE/.test(x)) as string;
  assert.equal(l, 'FASE 3 de 7 ▰▰▱▱▱▱▱ · spec com 6 seções · falta aprovar · ✓ ideia › ✓ spec › ● aprovação › ○ plano › ○ execução › ○ PR › ○ uso');
  assert.ok(linhas(s).every((x) => !/^PRONTO/.test(x)), 'em-loop-sem-linha-de-trilha: FASE e PRONTO nunca juntos');
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
  assert.match(texto(comPendencia), /depende de você: renovar o certificado \[feito\]/);
  assert.equal(comPendencia.modo, 'projeto');
});

// ───────────────────────────── DEPENDE (REQ-DEP-1, FIEL-13)

test('nada-so-com-todas-as-fontes: fixture 18:40 com T12 no limite ⇒ item (5), nunca "nada"; fonte que falhou ⇒ "?"', () => {
  const s = proj(P('T11', 'T12', 'T13'), noTeto('T12', 0), { fatos: fatos({ plano: { tasks: ['T11', 'T12', 'T13'] } }) });
  const t = texto(s);
  assert.match(t, /depende de você: decidir a T12: chegou ao limite de revisões \[liberar mais uma rodada\]/);
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
  assert.match(t, /depende de você: limpar a conversa \[limpar\]/);
  assert.doesNotMatch(t, /\/clear/);
  assert.deepEqual(s.depende.find((i) => i.motivo === 'limpar a conversa')?.acoes, [{ rotulo: 'limpar', comando: '/clear' }]);
});

test('desatualizado-atencao-e-nunca-nada: passou de 180 s ⇒ ATENÇÃO e o topo nunca diz "nada"', () => {
  const s = proj(P(...IDS), [], { desatualizadoS: 600 });
  const t = texto(s);
  assert.match(t, /ATENÇÃO · painel sem ler o diário há 10 min/);
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
  assert.match(texto(s), /depende de você: qual caminho seguir\? · 1 este · 2 aquele/);
  assert.match(texto(s), /mais 1 pergunta aberta/);
  assert.doesNotMatch(texto(s), /depende de você: nada/, 'com pergunta aberta o topo não diz "nada"');
  const outra = proj(P(...IDS), [...base, e(3, 'dono.resposta', { pergunta: 's1:2', opcao: 1, rotulo: 'azul' }, 'dono')]);
  assert.equal(outra.pergunta?.id, 's1:1', 'resposta a s1:2 não fecha s1:1');
  assert.equal(outra.perguntasMais, 0);
  const fechada = proj(P(...IDS), [...base, e(3, 'dono.resposta', { pergunta: 's1:1', opcao: 2, rotulo: 'aquele' }, 'dono')]);
  assert.equal(fechada.pergunta?.id, 's1:2');
});

const MOTIVOS = Object.keys(TABELA_PARAR) as MotivoParar[];
const recenteDe = (itens: Item[], extra: Partial<Entrada> = {}): string[] => {
  const l = linhas(proj(P(...IDS), itens, { agentes: null, ...extra }), { local: 'lateral' });
  const i = l.findIndex((x) => /^RECENTE/.test(x));
  return i < 0 ? [] : l.slice(i).filter((x, k) => k === 0 || /^  \d\d:\d\d/.test(x));
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
  assert.deepEqual(q, ['depende de você: decidir se as 2 ideias viram a próxima entrega [visto]'], `a ideia sai 1 vez só (item (4)):\n${l.join('\n')}`);
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
  const i = l.findIndex((x) => /^AGORA/.test(x));
  assert.equal(l[i], 'AGORA · GANDALF · contexto 55 % · hora de pousar');
  assert.match(l[i + 1], /^  ARAGORN · T1 · implementando \(registrado\) · \d+(m|h\d\d)$/);
  const semCtx = linhas(proj(P(...IDS), [], { contexto: { percent: null, tokens: null, window: null } }));
  assert.ok(semCtx.includes('AGORA · GANDALF · contexto ?'));
  const abaixo = linhas(proj(P(...IDS), [], { contexto: { percent: 49, tokens: null, window: null } }));
  assert.ok(abaixo.includes('AGORA · GANDALF · contexto 49 %'));
});

test('cli-sem-agentes-sem-nomes-nem-traco: sem --agentes, 1 linha no AGORA e nenhum nome sorteado', () => {
  const s = proj(P(...IDS), [...RECENTES, ini(50, 'T4')], { agentes: null });
  const t = texto(s);
  assert.match(t, /^AGORA · agentes e contexto: medidos só no painel da sessão$/m);
  assert.equal(t.split('\n').filter((x) => /^AGORA|^  [A-Z][a-z]+ · T\d/.test(x)).length, 1);
  assert.doesNotMatch(t, /GANDALF|ELROND|ARAGORN|LEGOLAS|agentes —|ctx —|5h|7d/);
  assert.match(t, /Sombra decidiu: seguir com a T3/);
  const comAgentes = texto(proj(P(...IDS), [...RECENTES, ini(50, 'T4')], { agentes: [vivo('T4 implementador')] }));
  assert.match(comAgentes, /ELROND decidiu/, 'cli-com-agentes-igual-ao-mod: com --agentes os nomes voltam');
});

test('descricao-tecnica-higienizada e vivo-sem-task-mostra-descricao', () => {
  const s = proj(P(...IDS), [ini(0, 'T1')], { agentes: [vivo('Rascunho spec-brief.md com node'), vivo('Explorar o repositório'), vivo('T1 implementador')] });
  const l = linhas(s);
  assert.ok(l.includes('  LEGOLAS · sem task · Rascunho … com … (registrado)'), l.join('\n')); // todo vivo tem nome (FIEL-3 d): o par da T1 fica com o 1º, os sem task com os livres
  assert.ok(l.includes('  GIMLI · sem task · Explorar o repositório (registrado)'), l.join('\n'));
  assert.ok(l.some((x) => /^  ARAGORN · T1 · implementando \(registrado\) · \d+(m|h\d\d)$/.test(x)), l.join('\n'));
  assert.equal(s.agora?.agentes?.length, 3, 'vivos-igual-linhas-de-agente');
  assert.equal(l.filter((x) => / · (sem task|T\d) · /.test(x)).length, 3);
});

test('em-voo-sem-agente-vai-a-atencao: task em voo sem agente vivo ⇒ ATENÇÃO, nunca linha no AGORA', () => {
  const s = proj(P(...IDS), [ini(0, 'T1'), ini(1, 'T2'), con(2, 'T2'), ini(3, 'T2', 'revisor')], { agentes: [vivo('T2 revisor')] });
  const t = texto(s);
  assert.match(t, /ATENÇÃO · T1 sem agente trabalhando/);
  assert.doesNotMatch(t, /AGORA[^\n]*\n(  [^\n]*\n)*  [^\n]*T1 ·/, 'T1 não vira linha do AGORA');
  assert.doesNotMatch(t, /◌/);
  assert.doesNotMatch(texto(proj(P(...IDS), [ini(0, 'T1')], { agentes: null })), /sem agente trabalhando/, 'sem mod não se sabe: nada no ATENÇÃO');
});

// ───────────────────────────── Sombra (FIEL-7)

test('sombra-decisao-no-recente, sombra-consulta-sem-registro-na-atencao e sem-linha-fixa-da-sombra', () => {
  const consulta = (t: number) => e(t, 'sombra.consulta', { pergunta_hash: 'a'.repeat(64), task: 'T1' });
  const s = proj(P(...IDS), [consulta(1), consulta(2), DEC(3, 'sim', 'T1')]);
  const t = texto(s);
  assert.match(t, /RECENTE · \d\d:\d\d ● ELROND decidiu: sim \(anotado pelo orquestrador\)/);
  assert.match(t, /ATENÇÃO · 1 consulta à Sombra sem decisão registrada/);
  assert.doesNotMatch(t, /aconselha|\d+ decis(ão|ões)\b/, 'sem linha fixa da Sombra com contagem');
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
  const esq = texto(s, { preset: 'esquadrao' });
  const exe = texto(s, { preset: 'executivo' });
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
  assert.match(exe, /^AGORA · Orquestrador · contexto 40 %$/m);
  assert.match(exe, /^  Implementador · T4 · implementando \(registrado\)/m);
  assert.match(exe, /^  Revisor · T5 · revisando \(registrado\)/m);
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
  assert.match(l, /^PAROU \d\d:\d\d · teto de rodadas de review em T1 \[aprovar\] · recusar: deixe a task parada e emende a spec$/);
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
    assert.equal(l[0], 'GABARITO · entrega não identificada', preset);
    assert.ok(!l.join('\n').includes('sem entrega identificada'));
  }
});

test('ultima-entrega-conhecida: sem entrega, a 1ª linha fora do topo é exatamente "última entrega conhecida: <ID>" (spec:53), nos dois presets; com entrega ou sem ultimaConhecida não aparece', () => {
  const base = proj(P(...IDS), [], { titulo: 'GM-14 — Clareza' });
  const trilha = { ...(base.trilha as object), ultimaConhecida: 'GM-12' } as EstadoPainel['trilha'];
  const sem = { ...base, id: '', trilha } as EstadoPainel;
  for (const preset of ['executivo', 'esquadrao'] as const) {
    const l = renderPainel(sem, { largura: 80, preset } as OpcoesRender).map((x) => x.map((s) => s.texto).join(''));
    assert.equal(l[0], 'GABARITO · entrega não identificada', preset);
    assert.ok(l.includes('última entrega conhecida: GM-12'), `${preset}: ${JSON.stringify(l)}`);
    assert.equal(l.indexOf('última entrega conhecida: GM-12'), l.findIndex((x) => !/^(depende de você|  |PAROU)/.test(x) && x !== l[0]), preset);
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
    const topo = l.filter((x, i) => i >= 1 && i < l.findIndex((y) => y.startsWith('PRONTO')));
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
  assert.ok(o3[2].startsWith('depende de você: decidir a emenda 1'), o3[2]);
  assert.ok(o3[2].endsWith(' (+2)'), `2 itens escondidos, não ${o3[2]}`);
  assert.ok(o3.every((x) => colunas(x) <= 80));
  const o2 = topoMedido(PAROU_LONGO, [{ motivo: 'decidir a emenda 1' }], { orcamento: 2 });
  assert.equal(o2.length, 2, JSON.stringify(o2));
  assert.ok(o2[1].endsWith(' (+1)') && o2.join(' ').replace(/ +/g, ' ').includes('recusar: deixe a task parada e emende a spec'), JSON.stringify(o2)); // PAROU inteiro; 1 item escondido (por linha daria +2)
  assert.ok(o2[0].startsWith('PAROU 12:25'));
});

test('topo-item-inteiro: um item que não cabe inteiro sai inteiro, sem sobrar meia continuação', () => {
  const o = topoMedido(PAROU_LONGO, [{ motivo: MOTIVO_LONGO }, { motivo: 'decidir a emenda 2' }], { orcamento: 3 });
  assert.equal(o.length, 2, JSON.stringify(o));
  assert.ok(!o.join('\n').includes('depende de você'), 'o item 2 quebrado não entra pela metade');
  assert.ok(o[1].endsWith(' (+2)') && colunas(o[1]) <= 80, o[1]);
  const tres = topoMedido(PAROU_LONGO, [{ motivo: `decidir a emenda ${'muito '.repeat(35)}longa` }], { orcamento: 4 });
  assert.equal(tres.length, 2, `item de 3 linhas com 2 vagas sai inteiro: ${JSON.stringify(tres)}`);
  assert.ok(tres[1].endsWith(' (+1)'), tres[1]);
  const cabe = topoMedido({ ...PAROU_LONGO, acoes: [] }, [{ motivo: 'decidir a emenda 1' }, { motivo: 'decidir a emenda 2' }], { orcamento: 1 });
  assert.equal(cabe.length, 1, JSON.stringify(cabe));
  assert.ok(cabe[0].startsWith('PAROU 12:25') && cabe[0].endsWith(' (+2)'), cabe[0]);
});

test('topo-1o-item-maior-que-o-orcamento (LIMITE, aguarda decisão): D15 vence; mostra só as linhas do orçamento, a última termina em "…" e não inventa (+N)', () => {
  const o = topoMedido(PAROU_LONGO, [], { orcamento: 1 });
  assert.equal(o.length, 1, JSON.stringify(o));
  assert.ok(o[0].startsWith('PAROU 12:25') && o[0].endsWith('…') && colunas(o[0]) <= 80 && !o[0].includes('(+'), o[0]);
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
  const topo = o.slice(1, o.findIndex((x) => x.startsWith('PRONTO')));
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
  assert.deepEqual(sem, ['PAROU 12:25 · a', `    ${'b'.repeat(14)}…`]);
  // com "(+N)": mesma largura exata (cabe = 20 - 5 colunas do " (+1)" incluído); termina em "…" antes do "(+1)", sem "……"
  const com = rende(est(`a ${'b'.repeat(200)}`, 1), 1);
  assert.deepEqual(com, ['PAROU 12:25 ·… (+1)']);
  for (const ls of [sem, com]) assert.ok(ls.every((l) => colunas(l) <= 20 && !l.includes('……')), JSON.stringify(ls));
  assert.ok(sem[sem.length - 1].endsWith('…') && com[0].replace(/ \(\+\d+\)$/, '').endsWith('…'));
});

// ───────────────────────────── T42 (emenda 32): a decisão da Sombra fica reservada quando o corte tiraria o RECENTE inteiro

const cabe = (s: EstadoPainel, o: Partial<OpcoesRender>): string[] => linhas(s, { largura: 80, ...o });
const eRec = (xs: string[]): boolean => xs.some((x) => /^RECENTE|^  \d\d:\d\d/.test(x));
const ehDecidiu = (x: string): boolean => /ELROND decidiu: seguir com a T3 \(anotado pelo orquestrador\)$/.test(x);
const noVoo = (itens: Item[]): EstadoPainel => proj(P(...IDS), [...EXECUCAO, ...itens, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] });
/** Linhas dos blocos 1–3 (tudo menos ATENÇÃO e RECENTE) de um estado: o piso que a reserva nunca fura. */
const blocos123 = (s: EstadoPainel, local: 'lateral' | 'acima'): string[] => {
  const l = cabe(s, { local });
  const i = l.findIndex((x) => /^(ATENÇÃO|RECENTE)/.test(x));
  return i < 0 ? l : l.slice(0, i);
};

for (const local of ['lateral', 'acima'] as const) {
  test(`decisao-sombra-reservada-80x24-${local}: orçamento que tiraria o RECENTE inteiro mantém 1 linha "decidiu:" e os blocos 1–3`, () => {
    const s = noVoo([DEC(50, 'seguir com a T3')]);
    const b123 = blocos123(s, local);
    const sem = cabe(proj(P(...IDS), [...EXECUCAO, e(60, 'ci.resultado', { verde: false, alvo: 'main' })], { agentes: [vivo('T4 implementador')] }), { local, orcamento: b123.length + 1 });
    assert.ok(!eRec(sem) && !sem.some(ehDecidiu), 'sem decisão, o orçamento b123+1 corta o RECENTE (premissa)');
    const l = cabe(s, { local, orcamento: b123.length + 1 });
    assert.ok(l.length <= b123.length + 1, 'nunca passa do orçamento');
    assert.equal(l.filter(ehDecidiu).length, 1, `1 linha da decisão: ${l.join('|')}`);
    for (const x of b123) assert.ok(l.includes(x), `bloco 1–3 presente: "${x}"`);
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
  assert.ok(l.some((x) => /^ATENÇÃO/.test(x)));
  assert.ok(!l.some((x) => /decidiu:/.test(x)));
});

test('reserva-cede-sem-espaco: orçamento menor que blocos 1–3 + 1 ⇒ blocos 1–3 vencem e a reserva sai', () => {
  const s = noVoo([DEC(50, 'seguir com a T3')]);
  const b123 = blocos123(s, 'lateral');
  const l = cabe(s, { local: 'lateral', orcamento: b123.length });
  assert.deepEqual(l, b123);
  assert.ok(!l.some((x) => /decidiu:/.test(x)));
});

test('reserva-vence-atencao: com ATENÇÃO e decisão, no orçamento b123+1 a linha "decidiu:" fica e o ATENÇÃO sai antes dela', () => {
  const s = noVoo([DEC(50, 'seguir com a T3')]);
  const b123 = blocos123(s, 'lateral');
  assert.ok(cabe(s, { local: 'lateral' }).some((x) => /^ATENÇÃO/.test(x)), 'premissa: há ATENÇÃO');
  const l = cabe(s, { local: 'lateral', orcamento: b123.length + 1 });
  assert.equal(l.filter(ehDecidiu).length, 1);
  assert.ok(!l.some((x) => /^ATENÇÃO/.test(x)), 'ATENÇÃO saiu antes da reserva');
  const maior = cabe(s, { local: 'lateral', orcamento: 200 });
  assert.ok(maior.some((x) => /^ATENÇÃO/.test(x)) && maior.some(ehDecidiu), 'sem aperto, ATENÇÃO e RECENTE aparecem normais');
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
const ORC_ACIMA = orcamentoDe(24, 12);
const linhasAgora = (l: string[]): string[] => l.filter((x) => /^AGORA|^  (\d+ agentes:|\S+ · )/.test(x) && !/decidiu:|^  \d\d:\d\d/.test(x));
const resumoDe = (l: string[]): string[] => l.filter((x) => /^  \d+ agentes:/.test(x));

test('roteiro-premissa: DEPENDE do roteiro tem 2 itens e orcamentoDe(24, 12) = 7', () => {
  assert.equal(DEPENDE_ROTEIRO.length, 2);
  assert.equal(ORC_ACIMA, 7);
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
    assert.match(agora[0], /^AGORA · GANDALF · contexto 40 %/);
    assert.match(agora[1], new RegExp(`^  ${n} agentes: .*T4`));
    for (const x of DEPENDE_ROTEIRO) assert.ok(l.some((y) => y.includes(x)), `DEPENDE presente: ${x}`);
    assert.ok(l.some((x) => /^PRONTO|^FASE/.test(x)) && l[0].startsWith('GABARITO'));
    assert.ok(l.every((x) => colunas(x) <= 80));
  });
}

test('linha-resumo: rótulo (nome temático) e task de cada agente; N = vivos; o segundo plano entra como item e não conta em N', () => {
  const s = roteiro(3, [DEC(50, 'seguir com a T3')], { segundoPlano: [{ id: 'bg1', dono: 'orquestrador', texto: 'npm test', desde: AGORA - 30_000 }] });
  assert.equal(s.agora?.segundoPlano.length, 1, 'premissa: 1 linha de segundo plano');
  const [r] = resumoDe(cabe(s, { local: 'acima', orcamento: ORC_ACIMA }));
  assert.ok(r !== undefined, 'compactou');
  assert.match(r, /^  3 agentes: /, 'N conta só agentes');
  const nomes = (s.agora?.agentes ?? []).map((a) => `${a.quem.nome} ${a.task}`);
  assert.equal(nomes.length, 3);
  for (const x of nomes) assert.ok(r.includes(x), `"${x}" na linha-resumo: ${r}`);
  assert.match(r, /Teste orquestrador$/, 'o segundo plano é um item da linha');
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
    assert.equal(l.filter((x) => /^  \S+ · T\d · /.test(x)).length, 3, '1 linha por agente');
  }
  // reserva cabendo SEM compactar: RECENTE cortado inteiro, blocos 1–3 completos (orquestrador + 3 agentes) + a reserva
  const pleno = cabe(s, { local: 'acima', orcamento: 200 });
  const b123 = pleno.findIndex((x) => /^(ATENÇÃO|RECENTE)/.test(x));
  const l = cabe(s, { local: 'acima', orcamento: b123 + 1 });
  assert.equal(resumoDe(l).length, 0, l.join('|'));
  assert.equal(l.filter(ehDecidiu).length, 1);
  assert.equal(l.filter((x) => /^  \S+ · T\d · /.test(x)).length, 3);
});

test('reserva-cabe-sem-compactar-com-atencao: ATENÇÃO ocupa a linha do RECENTE, a reserva a toma e o AGORA fica com 1 linha por agente (D-P8 + emenda 32)', () => {
  const s = roteiro(3, [DEC(50, 'seguir com a T3'), e(60, 'ci.resultado', { verde: false, alvo: 'main' })]);
  const pleno = cabe(s, { local: 'acima', orcamento: 200 });
  const b123 = pleno.findIndex((x) => /^(ATENÇÃO|RECENTE)/.test(x));
  assert.match(pleno[b123], /^ATENÇÃO/, 'premissa: o ATENÇÃO vem antes do RECENTE');
  const l = cabe(s, { local: 'acima', orcamento: b123 + 1 });
  assert.equal(l.filter(ehDecidiu).length, 1, l.join('|'));
  assert.equal(resumoDe(l).length, 0, l.join('|'));
  assert.equal(l.filter((x) => /^  \S+ · T\d · /.test(x)).length, 3, '1 linha por agente');
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
  const b12 = cabe(s, { local: 'acima', orcamento: 200 }).findIndex((x) => /^AGORA/.test(x));
  assert.equal(b12, 4, 'blocos 1–2 do roteiro: GABARITO + 2 do DEPENDE + PRONTO');
  const limiar = b12 + 2 + 1; // = 7: cabe compactado
  const cabeLa = cabe(s, { local: 'acima', orcamento: limiar });
  assert.equal(cabeLa.filter(ehDecidiu).length, 1);
  assert.equal(resumoDe(cabeLa).length, 1);
  const cede = cabe(s, { local: 'acima', orcamento: limiar - 1 });
  assert.ok(!cede.some((x) => /decidiu:/.test(x)), cede.join('|'));
  assert.equal(resumoDe(cede).length, 0, 'compactar não ajudou: o AGORA fica com 1 linha por agente');
  assert.equal(cede.length, limiar - 1);
  assert.ok(cede.some((x) => /^AGORA/.test(x)) && cede.some((x) => /^PRONTO/.test(x)));
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
    const b12 = cheio.findIndex((x) => /^AGORA/.test(x));
    assert.ok(b12 > 0, `premissa: AGORA no render cheio (${nome}/${n}/${local})`);
    for (let orc = 7; orc <= 12; orc++) {
      casos++;
      const l = cabe(s, { local, orcamento: orc });
      const rotulo = `${nome} n=${n} ${local} atencao=${atencao} orc=${orc}`;
      assert.ok(l.length <= orc, `${rotulo}: passou do orçamento: ${l.join('|')}`);
      assert.ok(l.filter(ehDecidiu).length <= 1, `${rotulo}: decisão duplicada: ${l.join('|')}`);
      assert.deepEqual(l.slice(0, b12), cheio.slice(0, b12), `${rotulo}: blocos 1–2 intactos`);
      if (orc >= b12 + 2 + 1) {
        comPiso++;
        assert.equal(l.filter(ehDecidiu).length, 1, `${rotulo}: a decisão da Sombra some: ${l.join('|')}`);
        assert.ok(l.some((x) => /^AGORA/.test(x)), `${rotulo}: sem AGORA (bloco 3): ${l.join('|')}`);
        // a linha que cede à reserva é a ÚLTIMA do RECENTE: sobrando alguma pausa, é a mais nova (12:56 em pausa+retoma)
        const pausas = l.filter((x) => /\d\d:\d\d ○ pausa/.test(x));
        if (nome === 'pausa+retoma' && pausas.length > 0) assert.match(pausas[0], /12:56/, `${rotulo}: a pausa que sobra é a mais nova: ${l.join('|')}`);
      }
    }
  }
  assert.ok(casos >= 3 * 3 * 2 * 2 * 6 && comPiso > 100, `a varredura viu ${casos} casos (${comPiso} acima do piso)`);
});

test('reserva-parcial-toma-a-ultima-linha-do-recente: decisão + pausa, lateral, 2 vivos, orçamento 8 — 1 linha de RECENTE sobra e é a decisão, sem aumentar o total', () => {
  const s = roteiro(2, [DEC(50, 'seguir com a T3'), e(55, 'loop.pausa', { estado: 'pausado' })]);
  const l7 = cabe(s, { local: 'lateral', orcamento: 7 });
  for (const orc of [8, 9]) {
    const l = cabe(s, { local: 'lateral', orcamento: orc });
    assert.equal(l.filter(ehDecidiu).length, 1, l.join('|'));
    assert.ok(l.length <= orc);
  }
  assert.equal(l7.filter(ehDecidiu).length, 1, l7.join('|'));
});

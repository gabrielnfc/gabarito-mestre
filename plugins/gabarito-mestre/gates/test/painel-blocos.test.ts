/**
 * Testes do painel em 5 blocos (GM-14 T17; REQ-GLB-1, REQ-DEP-1, REQ-LNG-1; FIEL-3 b, FIEL-4, FIEL-5, FIEL-6 b, FIEL-7, FIEL-10..13, N17 b).
 * Estado novo = `projetarPainel(plano | null, eventos, entrada & { fatos })`; render = `renderPainel` (um renderizador só, `ludico` pelo preset).
 * P9: os estados saem de `projetarPainel` real, que chama `trilhaDe`, `perguntasAbertas` e `dependeDe` reais (sem stub).
 * Mutações: .superpowers/sdd/2026-11-11-proxima/task-17-mut.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projetarPainel, renderPainel, TABELA_PARAR } from '../src/painel.ts';
import { fraseHistorico, historicoDe, paraTexto } from '../src/painel-texto.ts';
import { PAPEL_EXECUTIVO } from '../src/painel-executivo.ts';
import { orcamentoDe } from '../src/orcamento.ts';
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
    cheio.forEach((x, i) => { if (prioCheio[i] < maxPrio) assert.ok(presentes.has(x) || /\(\+\d+\)/.test(l.join('\n')), `H ${h}: "${x}" (prio ${prioCheio[i]}) saiu antes de prio ${maxPrio}`); });
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
  assert.ok(l.includes('  Implementador · sem task · Rascunho … com …'), l.join('\n'));
  assert.ok(l.includes('  Implementador · sem task · Explorar o repositório'), l.join('\n'));
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

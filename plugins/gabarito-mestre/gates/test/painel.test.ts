/**
 * Testes de `painel.ts` (GM-12 T2): projeção do plano, "depende de você" e PAROU.
 * Fontes: plano "Task 2" + `.superpowers/sdd/2026-11-09-e4-painel/sombra-p1a.md` §0 e "Task 2" (a Sombra vence o plano).
 * Mutações: `.superpowers/sdd/2026-11-09-e4-painel/task-2-mut.json` (MUT-PNL-1, MUT-PNL-2, MUT-PNL-3b e as da Sombra).
 * `tok-lider-so-orquestrador` saiu da T2 para a T3 (o líder é de `projetarEquipe`; sombra-p1a.md, defeito 7).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dependeDeVoce, etaDe, projetarPainel, TABELA_PARAR } from '../src/painel.ts';
import { renderPainel } from '../src/painel.ts';
import { duracoes, mediana } from '../src/diario.ts';
import { contarConsultas } from '../src/sombra.ts';
import { tokensDe } from '../src/pouso.ts';
import { projetarEquipe } from '../src/painel-equipe.ts';
import { horaLocal } from '../src/painel-hora.ts';
import type { AgenteVivo, EntradaPainel, EstadoPainel, Evento, MotivoParar, Plano, TipoEvento } from '../src/tipos.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-11-09T12:00:00Z');
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const AGORA = T0 + 3 * 3_600_000; // 15:00Z

type Item = { t: number; tipo: TipoEvento; dados?: unknown; sessao?: string; seq?: number };
const e = (t: number, tipo: TipoEvento, dados: unknown = {}, sessao = 's1'): Item => ({ t, tipo, dados, sessao });

/** Ordena por instante (estável) e numera `seq` por sessão: o diário que a guarda gravaria. */
function D(itens: Item[]): Evento[] {
  const seqs = new Map<string, number>();
  return [...itens]
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.t - b.x.t || a.i - b.i)
    .map(({ x }) => {
      const sessao = x.sessao ?? 's1';
      const seq = x.seq ?? (seqs.get(sessao) ?? 0) + 1;
      seqs.set(sessao, seq);
      return { seq, ts: iso(x.t), autor: 't', sessao, agente: 'orquestrador', tipo: x.tipo, dados: x.dados, hash_anterior: null } as unknown as Evento;
    });
}

const ini = (t: number, task: string, papel = 'implementador', extra: Record<string, unknown> = {}) => e(t, 'task.iniciada', { task, papel, ...extra });
const con = (t: number, task: string) => e(t, 'task.concluida', { task });
const ver = (t: number, task: string, aprovado: boolean, rodada = 1, major = 0, blocker = 0) =>
  e(t, 'review.veredito', { task, veredito: aprovado ? 'APROVADO' : 'REPROVADO', rodada, major, blocker });
const integ = (t: number, task: string, extra: Record<string, unknown> = {}) => e(t, 'task.integrada', { task, ...extra });
/** Task aprovada e integrada: duração (cronômetro do diário) = `fim - inicio` minutos. */
const ciclo = (task: string, inicio: number, fim: number, extra: Record<string, unknown> = {}): Item[] => [
  ini(inicio, task), con(inicio + 1, task), ini(inicio + 2, task, 'revisor'), ver(fim, task, true), integ(fim + 1, task, extra),
];
const parar = (t: number, motivo: unknown = 'sem_progresso', extra: Record<string, unknown> = {}, sessao = 's1') => e(t, 'loop.parar', { motivo, ...extra }, sessao);

const P = (...ids: string[]): Plano => ({ entrega: 'GM-12', tasks: ids.map((id) => ({ id, deps: [], arquivos: [] })) });
const IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const entrada = (extra: Partial<EntradaPainel> = {}): EntradaPainel => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
  pacote: { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }, notificacao: null, agoraMs: AGORA, fuso: 'UTC',
  titulo: null, politica: { politica: 'continua', dias: null }, base: 'main', entregaId: 'GM-12', modeloSessao: null, specSha: null, tetoSombra: 26, ...extra,
});
const proj = (plano: Plano, eventos: Evento[] | null, extra: Partial<EntradaPainel> = {}): EstadoPainel => projetarPainel(plano, eventos, entrada(extra));
const vivo = (description: string, status = 'running'): AgenteVivo => ({ id: `a-${description}`, type: 'general-purpose', description, status, uso: null });
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const motivos = (s: EstadoPainel): string[] => s.depende.map((d) => d.motivo);

// ---------------------------------------------------------------- glifos e plano

/** Diário que leva a task `T1` a cada um dos 9 estados. */
const ATE: Record<string, Item[]> = {
  pendente: [],
  implementando: [ini(0, 'T1')],
  concluida: [ini(0, 'T1'), con(1, 'T1')],
  em_revisao: [ini(0, 'T1'), con(1, 'T1'), ini(2, 'T1', 'revisor')],
  reprovada: [ini(0, 'T1'), con(1, 'T1'), ini(2, 'T1', 'revisor'), ver(3, 'T1', false, 1, 1)],
  corrigindo: [ini(0, 'T1'), con(1, 'T1'), ini(2, 'T1', 'revisor'), ver(3, 'T1', false, 1, 1), ini(4, 'T1', 'correcao')],
  aprovada: [ini(0, 'T1'), con(1, 'T1'), ini(2, 'T1', 'revisor'), ver(3, 'T1', true)],
  no_teto: [ini(0, 'T1'), con(1, 'T1'), ini(2, 'T1', 'revisor'), ver(3, 'T1', false, 1, 1), ini(4, 'T1', 'correcao'), con(5, 'T1'), ini(6, 'T1', 'revisor'), ver(7, 'T1', false, 2, 1)],
  integrada: [ini(0, 'T1'), con(1, 'T1'), ini(2, 'T1', 'revisor'), ver(3, 'T1', true), integ(4, 'T1')],
};
const PAPEL_VIVO: Record<string, string> = { implementando: 'implementador', em_revisao: 'revisor', corrigindo: 'correcao' };

test('glifo-por-estado: 9 estados × agente vivo do papel certo / ninguém (B3)', () => {
  const esperado: Record<string, [string, string]> = {
    pendente: ['○', '○'], implementando: ['●', '◐'], concluida: ['◐', '◐'], em_revisao: ['●', '◐'], reprovada: ['◐', '◐'],
    corrigindo: ['●', '◐'], aprovada: ['◐', '◐'], no_teto: ['✗', '✗'], integrada: ['✓', '✓'],
  };
  for (const [estado, itens] of Object.entries(ATE)) {
    const comVivo = proj(P('T1'), D(itens), { agentes: PAPEL_VIVO[estado] ? [vivo(`T1 ${PAPEL_VIVO[estado]}`)] : [vivo('T1 implementador')] });
    const sem = proj(P('T1'), D(itens), { agentes: [] });
    assert.equal(comVivo.plano.tasks[0].estado, estado, `${estado}: estado`);
    assert.equal(comVivo.plano.tasks[0].glifo, esperado[estado][0], `${estado} vivo`);
    assert.equal(sem.plano.tasks[0].glifo, esperado[estado][1], `${estado} aguardando`);
  }
});

test('glifo-papel-incompativel-meia-lua: agente vivo de outro papel, de outra task, encerrado ou sem casar não dá ●; status desconhecido é vivo', () => {
  const g = (agentes: AgenteVivo[]) => proj(P('T1', 'T2'), D(ATE.implementando), { agentes }).plano.tasks[0].glifo;
  assert.equal(g([vivo('T1 revisor')]), '◐');
  assert.equal(g([vivo('T1 correcao')]), '◐');
  assert.equal(g([vivo('T2 implementador')]), '◐');
  assert.equal(g([vivo('T1 implementador', 'completed')]), '◐');
  assert.equal(g([vivo('T1 implementador', 'idle')]), '◐');
  assert.equal(g([vivo('T1 implementador', 'failed')]), '◐');
  assert.equal(g([vivo('T1 implementador', 'killed')]), '◐');
  assert.equal(g([vivo('T1  implementador')]), '◐'); // espaço interno nunca casa
  assert.equal(g([vivo('T1 implementador', 42 as unknown as string)]), '●'); // dado desconhecido não vira "encerrado"
  assert.equal(g([vivo('T1 implementador')]), '●');
  assert.equal(g([null as unknown as AgenteVivo, vivo('T1 implementador')]), '●'); // lixo na lista não derruba
});

test('glifo-agentes-null-cheio: sem mod (agentes null) as 3 em trabalho ficam ●; as que esperam outro papel seguem ◐', () => {
  const itens = [...ATE.implementando.map((x) => ({ ...x, dados: { ...(x.dados as object), task: 'T1' } })),
    ini(0, 'T2'), con(1, 'T2'), ini(2, 'T2', 'revisor'),
    ini(0, 'T3'), con(1, 'T3'), ini(2, 'T3', 'revisor'), ver(3, 'T3', false, 1, 1), ini(4, 'T3', 'correcao'),
    ini(0, 'T4'), con(1, 'T4')];
  const s = proj(P('T1', 'T2', 'T3', 'T4', 'T5'), D(itens), { agentes: null as unknown as AgenteVivo[] });
  assert.deepEqual(s.plano.tasks.map((t) => [t.id, t.estado, t.glifo]), [
    ['T1', 'implementando', '●'], ['T2', 'em_revisao', '●'], ['T3', 'corrigindo', '●'], ['T4', 'concluida', '◐'], ['T5', 'pendente', '○'],
  ]);
});

test('feitas-so-integrada: aprovada e concluida não contam; pct arredonda', () => {
  const itens = [...ciclo('T1', 0, 10), ...ATE.aprovada.map((x) => ({ ...x, t: x.t + 20, dados: { ...(x.dados as object), task: 'T2' } })), ini(40, 'T3'), con(41, 'T3')];
  const s = proj(P('T1', 'T2', 'T3'), D(itens));
  assert.equal(s.plano.feitas, 1);
  assert.equal(s.plano.total, 3);
  assert.equal(s.plano.pct, 33);
  assert.deepEqual(s.plano.tasks.map((t) => t.estado), ['integrada', 'aprovada', 'concluida']);
  assert.equal(proj(P('T1', 'T2', 'T3'), D([...ciclo('T1', 0, 10), ...ciclo('T2', 20, 30)])).plano.pct, 67); // 66,67: round, não floor
});

test('campos-da-task: id, deps, titulo, modelo (último task.iniciada), desdeS (último evento da task) são lidos do plano e do diário', () => {
  const plano: Plano = { entrega: 'GM-12', tasks: [{ id: 'T1', deps: [], arquivos: [], titulo: 'Contratos' }, { id: 'T2', deps: ['T1'], arquivos: [] }, { id: 'T3', deps: ['T1', 'T2'], arquivos: [] }] };
  const itens = [...ciclo('T1', 0, 10), ini(20, 'T2', 'implementador', { modelo: 'sonnet' }), con(21, 'T2'), ini(22, 'T2', 'revisor', { modelo: 'opus' })];
  const s = proj(plano, D(itens), { agoraMs: T0 + 22 * 60_000 + 90_000 });
  const [t1, t2, t3] = s.plano.tasks;
  assert.equal(t1.titulo, 'Contratos');
  assert.equal('titulo' in t2, false);
  assert.deepEqual(t3.deps, ['T1', 'T2']);
  assert.equal(t2.modelo, 'opus');
  assert.equal('modelo' in t1, false);
  assert.equal(t2.desdeS, 90);
  assert.equal('desdeS' in t1, false); // integrada
  assert.equal('desdeS' in t3, false); // pendente
  assert.equal(t2.estado, 'em_revisao');
  // 90,6 s ⇒ floor (90), não round
  assert.equal(proj(plano, D(itens), { agoraMs: T0 + 22 * 60_000 + 90_600 }).plano.tasks[1].desdeS, 90);
  // relógio da outra máquina atrás do evento: nunca negativo
  assert.equal(proj(plano, D(itens), { agoraMs: T0 + 22 * 60_000 - 5_000 }).plano.tasks[1].desdeS, 0);
});

test('cabecalho-e-rodape-lidos-da-entrada: id do plano, título, pacote, política com dias, notificação convertida por horaLocal', () => {
  const s = proj(P('T1'), [], { titulo: 'E4 Painel', politica: { politica: 'janela', dias: [1, 2, 3, 4, 5] }, notificacao: { ts: iso(127) } });
  assert.equal(s.id, 'GM-12');
  assert.equal(s.titulo, 'E4 Painel');
  assert.equal(s.pacote, 'Terra Média');
  assert.equal(s.rodape.politica, 'janela [seg ter qua qui sex]');
  assert.deepEqual(s.notificacao, { hora: '14:07' });
  assert.equal(proj(P('T1'), [], { politica: { politica: 'continua', dias: null } }).rodape.politica, 'continua');
  assert.equal(proj(P('T1'), [], { politica: { politica: 'janela', dias: [0, 6] } }).rodape.politica, 'janela [dom sab]');
  assert.equal(proj(P('T1'), [], { titulo: null }).titulo, null);
  assert.equal(proj(P('T1'), [], { titulo: '   ' }).titulo, null);
  assert.deepEqual(proj(P('T1'), [], { notificacao: { motivo: 'sem mod' } }).notificacao, { motivo: 'sem mod' });
  assert.equal(proj(P('T1'), [], { notificacao: null }).notificacao, null);
  assert.deepEqual(proj(P('T1'), [], { notificacao: { ts: iso(127) }, fuso: 'America/Sao_Paulo' }).notificacao, { hora: '11:07' });
});

// ---------------------------------------------------------------- ETA

const tresFeitas = (inicios: [number, number][]): Item[] => inicios.flatMap(([a, b], i) => ciclo(`T${i + 1}`, a, b));

test('eta-n2-sem-dados: n < 3 ⇒ eta null e medianaS null (antes de restantes = 0)', () => {
  const s = proj(P(...IDS), D(tresFeitas([[0, 10], [20, 40]])));
  assert.equal(s.plano.eta, null);
  assert.equal(s.plano.medianaS, null);
  const todas = proj(P('T1', 'T2'), D(tresFeitas([[0, 10], [20, 40]]))); // restantes = 0 e n = 2: ainda null
  assert.equal(todas.plano.eta, null);
});

test('medianaS-null-n2: com 3 durações a mediana aparece em segundos', () => {
  assert.equal(proj(P(...IDS), D(tresFeitas([[0, 10], [20, 40], [50, 80]]))).plano.medianaS, 1200);
  assert.equal(proj(P(...IDS), D(tresFeitas([[0, 10], [20, 40]]))).plano.medianaS, null);
});

test('eta-iqr: mediana × ⌈restantes ÷ p⌉ e ± = (Q3 − Q1)/2 × ⌈restantes ÷ p⌉ com quartis tipo 7, sem desvio-padrão', () => {
  const s = proj(P(...IDS), D(tresFeitas([[0, 10], [20, 40], [50, 80], [90, 130]])));
  // durações 600, 1200, 1800, 2400 s; restantes 2, p 1; Q1 = 1050, Q3 = 1950
  assert.deepEqual(s.plano.eta, { hora: '15:50', restanteS: 3000, maisMenosS: 900, n: 4 });
  assert.equal(s.plano.medianaS, 1500);
  assert.equal(s.plano.rodadaMedia, 1);
});

test('eta-p-paralelo: p = maior nº de tasks simultâneas em trabalho; ⌈restantes ÷ p⌉ (teto, não arredondamento)', () => {
  // A 0–10, B 5–15 sobrepõem (p = 2); C 20–30 sozinha. Durações 600 ×3. Pendentes: T4..T8 = 5 ⇒ ⌈5/2⌉ = 3
  const a = proj(P('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'), D([...ciclo('T1', 0, 10), ...ciclo('T2', 5, 15), ...ciclo('T3', 20, 30)]));
  assert.deepEqual(a.plano.eta && [a.plano.eta.restanteS, a.plano.eta.maisMenosS, a.plano.eta.n], [1800, 0, 3]);
  // três sobrepostas (p = 3), 4 pendentes ⇒ ⌈4/3⌉ = 2 (round daria 1)
  const b = proj(P('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'), D([...ciclo('T1', 0, 10), ...ciclo('T2', 1, 11), ...ciclo('T3', 2, 12)]));
  assert.equal(b.plano.eta?.restanteS, 1200);
});

test('eta-p-conta-concluida: sobreposição só enquanto uma task está em concluida ⇒ p = 2 (EM_TRABALHO do diário)', () => {
  // A: implementa 0, concluida 5–20 (espera o revisor), aprovada 25. B: 6–12 inteira dentro da espera de A.
  const itens = [ini(0, 'T1'), con(5, 'T1'), ini(6, 'T2'), con(8, 'T2'), ini(9, 'T2', 'revisor'), ver(12, 'T2', true), integ(13, 'T2'),
    ini(20, 'T1', 'revisor'), ver(25, 'T1', true), integ(26, 'T1'), ...ciclo('T3', 30, 40)];
  const s = proj(P('T1', 'T2', 'T3', 'T4', 'T5'), D(itens));
  // durações: T1 1500, T2 360, T3 600 ⇒ mediana 600; restantes 2; p = 2 ⇒ ⌈2/2⌉ = 1; Q1 480, Q3 1050
  assert.deepEqual(s.plano.eta && [s.plano.eta.restanteS, s.plano.eta.maisMenosS, s.plano.eta.n], [600, 285, 3]);
});

test('eta-outro-dia-dd-mm: hora fora de hoje (data civil no fuso) sai dd/mm hh:mm', () => {
  const evs = D(tresFeitas([[0, 10], [20, 40], [50, 80], [90, 130]]));
  const s = proj(P(...IDS), evs, { agoraMs: Date.parse('2026-11-09T23:30:00Z') }); // +3000 s = 00:20 do dia seguinte
  assert.equal(s.plano.eta?.hora, '10/11 00:20');
  const sp = proj(P(...IDS), evs, { agoraMs: Date.parse('2026-11-10T01:30:00Z'), fuso: 'America/Sao_Paulo' }); // 22:30 de 09/11 em SP; +50 min = 23:20, ainda hoje
  assert.equal(sp.plano.eta?.hora, '23:20');
  const spVira = proj(P(...IDS), evs, { agoraMs: Date.parse('2026-11-10T02:30:00Z'), fuso: 'America/Sao_Paulo' }); // 23:30 em SP; +50 min = 00:20 de 10/11
  assert.equal(spVira.plano.eta?.hora, '10/11 00:20');
});

test('eta-restantes-zero: tudo integrado ⇒ restanteS = maisMenosS = 0 e hora = agora', () => {
  const s = proj(P('T1', 'T2', 'T3'), D(tresFeitas([[0, 10], [20, 40], [50, 80]])));
  assert.deepEqual(s.plano.eta, { hora: '15:00', restanteS: 0, maisMenosS: 0, n: 3 });
});

test('eta-no-teto-conta-como-restante: restantes = total − feitas', () => {
  const noTeto = ATE.no_teto.map((x) => ({ ...x, t: x.t + 200, dados: { ...(x.dados as object), task: 'T4' } }));
  const s = proj(P('T1', 'T2', 'T3', 'T4'), D([...tresFeitas([[0, 10], [20, 40], [50, 80]]), ...noTeto]));
  assert.equal(s.plano.eta?.restanteS, 1200); // mediana 1200 × ⌈1/1⌉
});

test('etaDe: função exportada, mesma conta; restantes negativo ou não finito vira 0', () => {
  const evs = D(tresFeitas([[0, 10], [20, 40], [50, 80]]));
  assert.deepEqual(etaDe(evs, 2, AGORA, 'UTC'), { hora: '15:40', restanteS: 2400, maisMenosS: 600, n: 3 });
  assert.equal(etaDe(evs, -3, AGORA, 'UTC')?.restanteS, 0);
  assert.equal(etaDe(evs, Number.NaN, AGORA, 'UTC')?.restanteS, 0);
  assert.equal(etaDe([], 3, AGORA, 'UTC'), null);
});

test('eta-p-varre-por-ts-nao-por-chegada: etaDe com as sessões concatenadas (sem intercalar) ainda vê a sobreposição entre sessões', () => {
  // T1 em s1 (0–10) e T2 em s2 (5–15) sobrepõem; T3 em s1 (20–30). Entrada: toda s1, depois toda s2.
  const s1 = D([...ciclo('T1', 0, 10), ...ciclo('T3', 20, 30)]);
  const s2 = D(ciclo('T2', 5, 15)).map((x) => ({ ...x, sessao: 's2' }));
  const eta = etaDe([...s1, ...s2], 5, AGORA, 'UTC'); // durações 600 ×3; p = 2 ⇒ ⌈5/2⌉ = 3
  assert.deepEqual(eta && [eta.restanteS, eta.n], [1800, 3]);
});

test('eta-p-minimo-1-ts-contraditorio: ts fora da ordem de seq na sessão (esperado, a guarda carimba antes do lock) nunca zera p nem dá Infinity', () => {
  // task.concluida com ts ANTES do task.iniciada: a duração (por seq) existe, mas a varredura por ts não vê a task em trabalho.
  const itens = ['T1', 'T2', 'T3'].flatMap((id, i) => [ini(i * 30 + 1, id), con(i * 30, id), ini(i * 30 + 2, id, 'revisor'), ver(i * 30 + 10, id, true), integ(i * 30 + 11, id)]);
  const evs = itens.map((x, i) => ({ seq: i + 1, ts: iso(x.t), autor: 't', sessao: 's1', agente: 'a', tipo: x.tipo, dados: x.dados, hash_anterior: null }) as unknown as Evento); // seq na ordem escrita, ts contraditório
  const eta = etaDe(evs, 2, AGORA, 'UTC');
  assert.ok(eta !== null && Number.isFinite(eta.restanteS), JSON.stringify(eta));
  assert.equal(eta?.restanteS, 2 * 540 * 1); // duração = ver − ini = 9 min, mediana 540 s, p = 1
});

test('ts-futuro-tempo-zero: task.iniciada com ts em 2099 ⇒ desdeS 0 e ETA nunca antes de agora', () => {
  const evs = D(tresFeitas([[0, 10], [20, 40], [50, 80]]));
  const ultimo = evs[evs.length - 1];
  evs.push({ ...ultimo, seq: ultimo.seq + 1, ts: '2099-01-01T00:00:00.000Z', tipo: 'task.iniciada', dados: { task: 'T4', papel: 'implementador' } });
  const s = proj(P(...IDS), evs);
  assert.equal(s.plano.tasks[3].estado, 'implementando');
  assert.equal(s.plano.tasks[3].desdeS, 0);
  assert.ok(s.plano.eta !== null && s.plano.eta.restanteS >= 0);
  assert.equal(s.plano.eta?.hora, horaLocal(AGORA + (s.plano.eta?.restanteS ?? 0) * 1000, AGORA, 'UTC'));
});

test('duracoes-igual-ao-diario: medianaS, n e ± batem com duracoes/mediana de diario.ts em diário com retomada, reprovação e reabertura', () => {
  const itens = [
    ini(0, 'T1'), e(2, 'task.reaberta', { task: 'T1', origem: 'retomada' }), ...ciclo('T1', 5, 25), // tentativa abandonada não soma
    ini(30, 'T2'), con(31, 'T2'), ini(32, 'T2', 'revisor'), ver(35, 'T2', false, 1, 1), ini(36, 'T2', 'correcao'), con(40, 'T2'), ini(41, 'T2', 'revisor'), ver(50, 'T2', true, 2), integ(51, 'T2'),
    ...ciclo('T3', 60, 100), ...ciclo('T4', 105, 111),
  ];
  const evs = D(itens);
  const ds = duracoes(evs);
  assert.equal(ds.length, 4);
  const s = proj(P(...IDS), evs);
  assert.equal(s.plano.medianaS, mediana(ds));
  assert.equal(s.plano.eta?.n, ds.length);
  const o = [...ds].sort((a, b) => a - b);
  const q = (p: number) => { const pos = (o.length - 1) * p; const lo = Math.floor(pos); return o[lo] + (pos - lo) * ((o[lo + 1] ?? o[lo]) - o[lo]); };
  assert.equal(s.plano.eta?.maisMenosS, (q(0.75) - q(0.25)) / 2 * 2);
  assert.equal(s.plano.eta?.restanteS, mediana(ds) * 2);
});

test('qualidade-mortas-ausente-null: ausente ≠ 0; soma só os eventos que trazem mutacoes; rodadaMedia uma casa', () => {
  const sem = proj(P('T1', 'T2'), D([...ciclo('T1', 0, 10), ...ciclo('T2', 20, 30)]));
  assert.equal(sem.qualidade.mortas, null);
  assert.equal(sem.qualidade.rodadaMedia, 1);
  const com = proj(P('T1', 'T2', 'T3'), D([...ciclo('T1', 0, 10, { mutacoes: { total: 10, mortas: 7 } }), ...ciclo('T2', 20, 30, { mutacoes: { total: 5, mortas: 5 } }), ...ciclo('T3', 40, 50)]));
  assert.equal(com.qualidade.mortas, 12);
  const zero = proj(P('T1'), D(ciclo('T1', 0, 10, { mutacoes: { total: 3, mortas: 0 } })));
  assert.equal(zero.qualidade.mortas, 0); // 0 informado ≠ ausente
  assert.equal(proj(P('T1'), []).qualidade.rodadaMedia, null);
  // rodadas 1, 1, 2 ⇒ 1,3 (1,333…)
  const r2 = [ini(60, 'T3'), con(61, 'T3'), ini(62, 'T3', 'revisor'), ver(63, 'T3', false, 1, 1), ini(64, 'T3', 'correcao'), con(65, 'T3'), ini(66, 'T3', 'revisor'), ver(67, 'T3', true, 2), integ(68, 'T3')];
  const m = proj(P('T1', 'T2', 'T3'), D([...ciclo('T1', 0, 10), ...ciclo('T2', 20, 30), ...r2]));
  assert.equal(m.qualidade.rodadaMedia, 1.3);
  assert.equal(m.plano.rodadaMedia, 1.3);
});

// ---------------------------------------------------------------- validade do diário

test('diario-null-x-vazio: null (ilegível) ⇒ PAROU diario_invalido; [] (pasta ausente) ⇒ estado vazio sem PAROU', () => {
  const nulo = proj(P('T1', 'T2'), null);
  assert.equal(nulo.parar?.motivo, 'diario_invalido');
  assert.equal(nulo.parar?.chave, 'computado:diario_invalido');
  assert.equal(nulo.parar?.hora, '--:--');
  assert.deepEqual([nulo.plano.tasks, nulo.plano.feitas, nulo.plano.total, nulo.plano.eta, nulo.plano.rodadaMedia, nulo.plano.medianaS], [[], 0, 2, null, null, null]);
  assert.equal(nulo.parado, true);
  const vazio = proj(P('T1', 'T2'), []);
  assert.equal(vazio.parar, null);
  assert.equal(vazio.parado, false);
  assert.deepEqual(vazio.plano.tasks.map((t) => [t.estado, t.glifo]), [['pendente', '○'], ['pendente', '○']]);
  assert.deepEqual(vazio.depende, []);
  assert.equal(proj(P('T1'), { nao: 'lista' } as unknown as Evento[]).parar?.motivo, 'diario_invalido'); // não é lista: ilegível, nunca lança
});

test('diario-invalido-parar: ordem de arquivo, CI torto e task fora do plano dão PAROU diario_invalido, igual ao loop', () => {
  for (const [nome, evs] of [
    ['seq trocado', D([ini(0, 'T1', 'implementador'), con(1, 'T1')]).reverse()],
    ['ci verde torto', D([e(0, 'ci.resultado', { verde: 'sim' })])],
    ['task fora do plano', D([ini(0, 'ZZ')])],
    ['lixo na lista', [null as unknown as Evento]],
  ] as [string, Evento[]][]) {
    const s = proj(P('T1'), evs);
    assert.equal(s.parar?.motivo, 'diario_invalido', nome);
    assert.equal(s.parar?.texto, TABELA_PARAR.diario_invalido.texto, nome);
    assert.equal(s.depende[0].nivel, 'parar', nome);
    assert.equal(s.parado, true, nome);
  }
});

test('ci-verde-torto-diario-invalido: o loop pararia (loop.ts:164); o painel não deixa passar. Tasks válidas mantêm o estado, eta null', () => {
  const s = proj(P('T1', 'T2'), D([ini(0, 'T1'), e(5, 'ci.resultado', { verde: 'sim' })]));
  assert.equal(s.parar?.motivo, 'diario_invalido');
  assert.deepEqual(s.plano.tasks.map((t) => t.estado), ['implementando', 'pendente']);
  assert.equal(s.plano.eta, null);
  assert.equal(s.parar?.hora, '12:05'); // maior ts legível, nunca agoraMs
  // com 3 durações e diário de conteúdo inválido: eta null; mediana e rodadaMedia dos válidos seguem calculadas
  const tres = proj(P(...IDS), D([...tresFeitas([[0, 10], [20, 40], [50, 80]]), e(100, 'ci.resultado', { verde: 'sim' })]));
  assert.equal(tres.parar?.motivo, 'diario_invalido');
  assert.equal(tres.plano.eta, null);
  assert.equal(tres.plano.medianaS, 1200);
  assert.equal(tres.plano.rodadaMedia, 1);
  assert.equal(tres.plano.feitas, 3);
});

test('task-fora-do-plano-diario-invalido: task inválida sai de tasks mas conta em total; eta null; a válida mantém o estado', () => {
  const evs = D([ini(0, 'T1'), con(1, 'T2')]); // T2: task.concluida em pendente = transição inválida
  const s = proj(P('T1', 'T2'), evs);
  assert.equal(s.parar?.motivo, 'diario_invalido');
  assert.deepEqual(s.plano.tasks.map((t) => t.id), ['T1']);
  assert.equal(s.plano.total, 2);
  assert.equal(s.plano.eta, null);
  const fora = proj(P('T1'), D([ini(0, 'T1'), ini(1, 'ZZ')]));
  assert.equal(fora.parar?.motivo, 'diario_invalido');
  assert.deepEqual(fora.plano.tasks.map((t) => [t.id, t.estado]), [['T1', 'implementando']]);
});

test('seq-trocado-na-sessao-diario-invalido: o painel NÃO reordena por (sessao, seq): diverge do loop se reordenasse', () => {
  const evs = D([ini(0, 'T1'), con(1, 'T1')]);
  const trocado = [evs[1], evs[0]];
  assert.equal(proj(P('T1'), trocado).parar?.motivo, 'diario_invalido');
  assert.deepEqual(proj(P('T1'), trocado).plano.tasks, []);
});

test('ordem-de-chegada-nao-muda: intercalação diferente entre sessões (cada uma em seq crescente) ⇒ deepEqual', () => {
  const a = D([ini(0, 'T1', 'implementador', {}), con(2, 'T1'), ini(4, 'T1', 'revisor')]);
  const b = D([ini(1, 'T2', 'implementador'), con(3, 'T2'), parar(5, 'sem_progresso', {}, 'sB')].map((x, i) => ({ ...x, sessao: 'sB', seq: i + 1 })));
  const ordem1 = [...a, ...b];
  const ordem2 = [b[0], a[0], a[1], b[1], a[2], b[2]];
  const ordem3 = [...b, ...a];
  const base = proj(P('T1', 'T2'), ordem1);
  assert.deepEqual(proj(P('T1', 'T2'), ordem2), base);
  assert.deepEqual(proj(P('T1', 'T2'), ordem3), base);
  assert.equal(base.parar?.motivo, 'sem_progresso');
  assert.deepEqual(base.plano.tasks.map((t) => t.estado), ['em_revisao', 'concluida']);
});

// ---------------------------------------------------------------- PAROU

test('parar-sobrevive-sessao-nova: sessao.inicio, guarda.heartbeat, loop.pausa {negado} e producao.acesso não apagam o PAROU nem mudam a chave', () => {
  const antes = D([parar(0, 'sem_progresso')]);
  const depois = D([parar(0, 'sem_progresso'), e(1, 'sessao.inicio', {}, 's2'), e(2, 'guarda.heartbeat', {}, 's2'), e(3, 'loop.pausa', { negado: 'Bash' }, 's2'),
    e(4, 'producao.acesso', { ambiente: 'homolog', acao: 'leitura', alvo: 'x' }, 's2'), e(5, 'guarda.deny', {}, 's2')]);
  const a = proj(P('T1'), antes);
  const d = proj(P('T1'), depois);
  assert.equal(d.parar?.motivo, 'sem_progresso');
  assert.equal(d.parar?.chave, a.parar?.chave);
  assert.equal(d.parar?.chave, 'parar:s1:1');
  assert.equal(d.parar?.hora, '12:00');
  assert.equal(d.parado, true);
});

test('parar-chave-do-primeiro-da-sequencia: dois loop.parar com sessao.inicio entre eles ⇒ a chave é a do 1º; progresso entre eles ⇒ nova chave', () => {
  const dois = D([parar(0, 'sem_progresso'), e(1, 'sessao.inicio'), parar(2, 'sem_progresso')]);
  const s = proj(P('T1'), dois);
  assert.equal(s.parar?.chave, 'parar:s1:1');
  assert.equal(s.parar?.hora, '12:00'); // hora do 1º, não do último
  const limpa = D([parar(0, 'sem_progresso'), e(1, 'ci.resultado', { verde: true }), parar(2, 'sem_progresso')]);
  assert.equal(proj(P('T1'), limpa).parar?.chave, 'parar:s1:3');
  assert.equal(proj(P('T1'), limpa).parar?.hora, '12:02');
  const tres = D([parar(0, 'sem_progresso'), parar(1, 'sem_progresso'), e(2, 'sessao.inicio'), parar(3, 'ci_vermelho')]);
  const t = proj(P('T1'), tres);
  assert.equal(t.parar?.chave, 'parar:s1:1');
  assert.equal(t.parar?.motivo, 'ci_vermelho'); // o motivo é o do último
});

test('parar-entrega-inicio-limpa: entrega.inicio depois do loop.parar apaga o PAROU', () => {
  const s = proj(P('T1'), D([parar(0, 'smoke'), e(1, 'entrega.inicio', { politica: 'continua' })]));
  assert.equal(s.parar, null);
  assert.deepEqual(s.depende, []);
  assert.equal(s.parado, false);
});

test('parar-some-apos-liberar: PAROU por teto_rodadas liberado pelo dono (task.reaberta dono) volta a "depende de você" sem PAROU residual', () => {
  const noTeto = ATE.no_teto;
  const parado = proj(P('T1'), D([...noTeto, parar(10, 'teto_rodadas', { task: 'T1' })]));
  assert.equal(parado.parar?.motivo, 'teto_rodadas');
  assert.equal(parado.depende[0].nivel, 'parar');
  const liberado = proj(P('T1'), D([...noTeto, parar(10, 'teto_rodadas', { task: 'T1' }), e(11, 'task.reaberta', { task: 'T1', origem: 'dono' })]));
  assert.equal(liberado.parar, null);
  assert.equal(liberado.parado, false);
  assert.equal(liberado.depende.some((d) => d.nivel === 'parar'), false);
  assert.equal(liberado.plano.tasks[0].estado, 'pendente');
});

test('parar-motivo-desconhecido-diario-invalido: motivo fora de MotivoParar ou dados não objeto ⇒ diario_invalido, nunca some', () => {
  for (const dados of [{ motivo: 'xyz' }, 'x', null, { motivo: 42 }, {}, { motivo: '__proto__' }, { motivo: 'constructor' }]) {
    const s = proj(P('T1'), D([e(0, 'loop.parar', dados)]));
    assert.equal(s.parar?.motivo, 'diario_invalido', JSON.stringify(dados));
    assert.equal(s.parar?.chave, 'parar:s1:1', JSON.stringify(dados));
    assert.equal(s.parar?.texto, TABELA_PARAR.diario_invalido.texto);
  }
});

test('tabela-parar-10-motivos: chaves = MotivoParar; todo comando ∈ {liberar <task>} ou null; cada motivo projeta o texto da tabela', () => {
  const esperadas: MotivoParar[] = ['teto_rodadas', 'ci_vermelho', 'teto_tokens', 'sem_pouso', 'sem_progresso', 'diario_invalido', 'nao_conseguiu', 'smoke', 'rollback', 'janela_ausente'];
  assert.deepEqual(Object.keys(TABELA_PARAR).sort(), [...esperadas].sort());
  for (const m of esperadas) {
    assert.ok(TABELA_PARAR[m].texto.length > 0, m);
    assert.ok(TABELA_PARAR[m].acoes.length >= 1, m);
    for (const a of TABELA_PARAR[m].acoes) {
      assert.ok(a.comando === null || a.comando === '/gabarito-mestre:liberar <task>', `${m}: ${a.comando}`);
      assert.ok(a.rotulo.length > 0, m);
    }
  }
  assert.deepEqual(TABELA_PARAR.teto_rodadas.acoes, [{ rotulo: 'aprovar', comando: '/gabarito-mestre:liberar <task>' }, { rotulo: 'recusar: deixe a task parada e emende a spec', comando: null }]);
  assert.equal(TABELA_PARAR.ci_vermelho.texto, 'CI vermelho 2× depois da última integração');
  assert.equal(TABELA_PARAR.teto_tokens.texto, 'teto de tokens da entrega');
  assert.deepEqual(TABELA_PARAR.teto_tokens.acoes, [{ rotulo: 'suba loop.tetoTokens no harness.config.json ou encerre a entrega', comando: null }]);
  assert.deepEqual(TABELA_PARAR.ci_vermelho.acoes, [{ rotulo: 'veja o CI, corrija ou peça a correção, e diga ao loop para seguir', comando: null }]);
  assert.deepEqual(TABELA_PARAR.sem_pouso.acoes, [{ rotulo: 'digite uma mensagem para retomar pelo diário', comando: null }]);
  assert.deepEqual(TABELA_PARAR.sem_progresso.acoes, [{ rotulo: 'leia o diário e diga ao loop o que fazer', comando: null }]);
  assert.deepEqual(TABELA_PARAR.nao_conseguiu.acoes, [{ rotulo: 'leia o diário e diga ao loop o que fazer', comando: null }]);
  assert.deepEqual(TABELA_PARAR.diario_invalido.acoes, [{ rotulo: 'confira o diário; nada segue até ele ser válido', comando: null }]);
  assert.equal(TABELA_PARAR.sem_pouso.texto, 'o pouso automático falhou');
  assert.equal(TABELA_PARAR.sem_progresso.texto, '3 paradas sem progresso');
  assert.equal(TABELA_PARAR.diario_invalido.texto, 'diário fora da tabela de transições');
  assert.equal(TABELA_PARAR.nao_conseguiu.texto, 'sem próxima ação e sem agente vivo');
  assert.equal(TABELA_PARAR.smoke.texto, 'smoke em produção falhou; rollback feito');
  assert.equal(TABELA_PARAR.rollback.texto, 'rollback falhou: produção em estado desconhecido');
  assert.equal(TABELA_PARAR.janela_ausente.texto, 'entrega exige produção sem janela ou comandos');
  assert.deepEqual(TABELA_PARAR.janela_ausente.acoes, [{ rotulo: 'declare entrega.janela/entrega.comandos em origin', comando: null }]);
  assert.deepEqual(TABELA_PARAR.smoke.acoes, [{ rotulo: 'confira produção e a causa antes de nova entrega', comando: null }]);
  assert.deepEqual(TABELA_PARAR.rollback.acoes, [{ rotulo: 'aja em produção agora', comando: null }]);
  for (const m of esperadas.filter((x) => x !== 'teto_rodadas')) {
    const s = proj(P('T1'), D([e(0, 'loop.parar', { motivo: m })]));
    assert.equal(s.parar?.motivo, m);
    assert.equal(s.parar?.texto, TABELA_PARAR[m].texto, m);
    assert.deepEqual(s.parar?.acoes, TABELA_PARAR[m].acoes, m);
    assert.deepEqual(s.depende[0], { nivel: 'parar', motivo: TABELA_PARAR[m].texto, acoes: TABELA_PARAR[m].acoes }, m);
  }
  // a projeção devolve cópia: mexer no estado não mexe na tabela
  const s = proj(P('T1'), D([e(0, 'loop.parar', { motivo: 'smoke' })]));
  s.parar?.acoes.push({ rotulo: 'x', comando: null });
  assert.equal(TABELA_PARAR.smoke.acoes.length, 1);
});

test('teto-task-fora-do-plano-usa-no-teto (teto-rodadas-comando-so-de-task-do-plano): usa dados.task se for id do plano; senão a 1ª no_teto; nenhuma ⇒ ação sem comando', () => {
  const dois = (id: string) => ATE.no_teto.map((x) => ({ ...x, dados: { ...(x.dados as object), task: id } }));
  const comTask = proj(P('T1', 'T2'), D([...dois('T2'), parar(20, 'teto_rodadas', { task: 'T2' })]));
  assert.equal(comTask.parar?.texto, 'teto de rodadas de review em T2');
  assert.deepEqual(comTask.parar?.acoes[0], { rotulo: 'aprovar', comando: '/gabarito-mestre:liberar T2' });
  assert.deepEqual(comTask.parar?.acoes[1], { rotulo: 'recusar: deixe a task parada e emende a spec', comando: null });
  // task do diário fora do plano / com texto perigoso: nenhum texto do diário vira comando
  for (const ruim of ['T9; rm -rf ~', 'ZZ', 42, undefined, null]) {
    const s = proj(P('T1', 'T2'), D([...dois('T1'), parar(20, 'teto_rodadas', { task: ruim })]));
    assert.equal(s.parar?.texto, 'teto de rodadas de review em T1', String(ruim));
    assert.deepEqual(s.parar?.acoes[0], { rotulo: 'aprovar', comando: '/gabarito-mestre:liberar T1' }, String(ruim));
    assert.equal(JSON.stringify(s).includes('rm -rf'), false);
  }
  // nenhuma task em no_teto ⇒ nunca <task> nem comando inventado
  const nenhuma = proj(P('T1', 'T2'), D([parar(0, 'teto_rodadas', { task: 'T9; rm -rf ~' })]));
  assert.deepEqual(nenhuma.parar?.acoes[0], { rotulo: 'liberar: task não identificada; leia o diário', comando: null });
  assert.equal(nenhuma.parar?.texto.includes('<task>'), false);
  assert.equal(JSON.stringify(nenhuma).includes('<task>'), false);
});

test('parar-por-decisao-de-entrega: decisaoEntrega parar vira PAROU com chave computada e hora do maior ts; o loop.parar vigente vence', () => {
  const evs = D([ini(0, 'T1'), con(30, 'T1')]);
  const s = proj(P('T1'), evs, { decisaoEntrega: { tipo: 'parar', motivo: 'smoke' } });
  assert.equal(s.parar?.motivo, 'smoke');
  assert.equal(s.parar?.chave, 'computado:entrega:smoke');
  assert.equal(s.parar?.hora, '12:30');
  assert.equal(s.parar?.texto, TABELA_PARAR.smoke.texto);
  assert.equal(proj(P('T1'), [], { decisaoEntrega: { tipo: 'parar', motivo: 'rollback' } }).parar?.hora, '--:--');
  const dois = proj(P('T1'), D([parar(0, 'rollback')]), { decisaoEntrega: { tipo: 'parar', motivo: 'rollback' } });
  assert.equal(dois.parar?.chave, 'parar:s1:1'); // vale o vigente
  assert.equal(dois.depende.filter((d) => d.nivel === 'parar').length, 1);
  const vence = proj(P('T1'), D([parar(0, 'ci_vermelho')]), { decisaoEntrega: { tipo: 'parar', motivo: 'smoke' } });
  assert.equal(vence.parar?.motivo, 'ci_vermelho');
});

test('hora-parar-sem-evento-nao-e-agora: a hora do PAROU não anda com agoraMs', () => {
  const evs = D([e(5, 'ci.resultado', { verde: 'x' })]);
  const a = proj(P('T1'), evs, { agoraMs: AGORA });
  const b = proj(P('T1'), evs, { agoraMs: AGORA + 3_600_000 });
  assert.equal(a.parar?.hora, '12:05');
  assert.equal(b.parar?.hora, '12:05');
  assert.equal(proj(P('T1'), null, { agoraMs: AGORA }).parar?.hora, '--:--');
  assert.equal(proj(P('T1'), null, { agoraMs: AGORA + 3_600_000 }).parar?.hora, '--:--');
  const vigA = proj(P('T1'), D([parar(7)]), { agoraMs: AGORA });
  const vigB = proj(P('T1'), D([parar(7)]), { agoraMs: AGORA + 7_200_000 });
  assert.equal(vigA.parar?.hora, '12:07');
  assert.equal(vigB.parar?.hora, '12:07');
  assert.equal(proj(P('T1'), D([parar(7)]), { agoraMs: Date.parse('2026-11-10T09:00:00Z') }).parar?.hora, '09/11 12:07'); // outro dia civil: dd/mm
});

test('parar-campos: emVoo e alteracoes (rodapé) acompanham o PAROU', () => {
  const evs = D([ini(0, 'T1'), ini(0, 'T2'), con(1, 'T2'), parar(5, 'sem_progresso'), e(6, 'producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'db' }, 's2')]);
  const s = proj(P('T1', 'T2', 'T3'), evs);
  assert.deepEqual(s.parar?.emVoo, ['T1']); // T2 está concluida (espera revisor): não está "em voo"
  assert.equal(s.parar?.alteracoes, 1);
  assert.equal(s.parar?.alteracoes, s.rodape.prod.alteracoes);
});

test('emvoo-do-diario-sem-mod: emVoo vem do diário (implementando, em_revisao, corrigindo, na ordem do plano), com agentes null, [] ou cheio', () => {
  const t = (id: string, itens: Item[]) => itens.map((x) => ({ ...x, dados: { ...(x.dados as object), task: id } }));
  const evs = D([...t('T3', ATE.implementando), ...t('T1', ATE.em_revisao), ...t('T4', ATE.corrigindo), ...t('T2', ATE.concluida), parar(50, 'sem_progresso')]);
  const plano = P('T1', 'T2', 'T3', 'T4', 'T5');
  for (const agentes of [null, [], [vivo('T3 implementador')]] as (AgenteVivo[] | null)[]) {
    assert.deepEqual(proj(plano, evs, { agentes: agentes as AgenteVivo[] }).parar?.emVoo, ['T1', 'T3', 'T4']);
  }
});

// ---------------------------------------------------------------- depende de você

test('spec-aguardando-sha-antigo: specSha sem spec.aprovada com esse sha ⇒ aguardando; sha antigo não vale; só hex minúsculo de 64', () => {
  const item = { nivel: 'dono', motivo: 'spec aguardando aprovação', acoes: [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }] };
  assert.deepEqual(proj(P('T1'), [], { specSha: SHA_A }).depende, [item]);
  const antigo = D([e(0, 'spec.aprovada', { spec: 'docs/x.md', sha256: SHA_B })]);
  assert.deepEqual(proj(P('T1'), antigo, { specSha: SHA_A }).depende, [item]);
  assert.deepEqual(proj(P('T1'), D([e(0, 'spec.aprovada', { spec: 'x', sha256: SHA_A })]), { specSha: SHA_A }).depende, []);
  assert.deepEqual(proj(P('T1'), D([e(0, 'spec.aprovada', { spec: 'x', sha256: SHA_B }), e(1, 'spec.aprovada', { spec: 'x', sha256: SHA_A })]), { specSha: SHA_A }).depende, []);
  assert.deepEqual(proj(P('T1'), D([e(0, 'spec.aprovada', { spec: 'x', sha256: SHA_A }), e(1, 'spec.aprovada', { spec: 'x', sha256: SHA_B })]), { specSha: SHA_A }).depende, []); // a aprovada não precisa ser a última
  assert.deepEqual(proj(P('T1'), [], { specSha: null }).depende, []);
  // maiúsculas ou 63 caracteres: aguardando
  for (const torto of [SHA_A.toUpperCase(), 'a'.repeat(63)]) {
    assert.deepEqual(proj(P('T1'), D([e(0, 'spec.aprovada', { spec: 'x', sha256: torto })]), { specSha: torto }).depende, [item], torto);
    assert.deepEqual(proj(P('T1'), D([e(0, 'spec.aprovada', { spec: 'x', sha256: torto })]), { specSha: SHA_A }).depende, [item], torto);
  }
  // diário não válido: a spec ainda sai, depois do Parar
  const inv = proj(P('T1'), null, { specSha: SHA_A });
  assert.deepEqual(inv.depende.map((d) => d.nivel), ['parar', 'dono']);
});

const prop = (t: number, seq: number, req = 'REQ-PNL-5'): Item => ({ t, tipo: 'emenda.proposta', sessao: 'emendas', seq, dados: { req, diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica' } });

test('emenda-tem-comando: emenda aberta ⇒ aprovar e rejeitar com o seq da proposta', () => {
  const s = proj(P('T1'), D([prop(0, 7, 'REQ-PNL-5')]));
  assert.deepEqual(s.depende, [{
    nivel: 'dono', motivo: 'emenda #7 em REQ-PNL-5',
    acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 7' }, { rotulo: 'rejeitar', comando: '/gabarito-mestre:emenda rejeitar 7' }],
  }]);
  // julgada (aprovada ou rejeitada) sai
  const julgada = D([prop(0, 7), e(1, 'emenda.rejeitada', { proposta_seq: 7, origem: 'dono' }, 'sd')]);
  assert.deepEqual(proj(P('T1'), julgada).depende, []);
});

test('emenda-3-e-mais-n: até 3 emendas (seq crescente) e depois "e mais N emenda(s) aberta(s)" sem comando', () => {
  const s = proj(P('T1'), D([prop(0, 1), prop(1, 2), prop(2, 3), prop(3, 4), prop(4, 5)]));
  assert.deepEqual(motivos(s), ['emenda #1 em REQ-PNL-5', 'emenda #2 em REQ-PNL-5', 'emenda #3 em REQ-PNL-5', 'e mais 2 emenda(s) aberta(s)']);
  assert.deepEqual(s.depende[3], { nivel: 'dono', motivo: 'e mais 2 emenda(s) aberta(s)', acoes: [] });
  assert.deepEqual(motivos(proj(P('T1'), D([prop(0, 1), prop(1, 2), prop(2, 3)]))), ['emenda #1 em REQ-PNL-5', 'emenda #2 em REQ-PNL-5', 'emenda #3 em REQ-PNL-5']);
});

test('emenda-excedente-sem-comando: nenhum comando inventado no item "e mais N"', () => {
  const s = proj(P('T1'), D([1, 2, 3, 4, 5, 6].map((n) => prop(n, n))));
  const extra = s.depende[s.depende.length - 1];
  assert.equal(extra.motivo, 'e mais 3 emenda(s) aberta(s)');
  assert.deepEqual(extra.acoes, []);
});

test('pausado-retomar: entrada.pausado ⇒ item com /gabarito retomar; parado sem PAROU', () => {
  const s = proj(P('T1'), [], { pausado: true });
  assert.deepEqual(s.depende, [{ nivel: 'dono', motivo: 'loop pausado', acoes: [{ rotulo: 'retomar', comando: '/gabarito retomar' }] }]);
  assert.equal(s.parado, true);
  assert.equal(s.parar, null);
  assert.equal(proj(P('T1'), [], { pausado: false }).parado, false);
});

test('devolvida-acende-e-inicio-apaga: entrega.devolvida sem entrega.inicio posterior ⇒ node <plugin>/…/entrega.mjs executar; inicio apaga; nova devolvida acende', () => {
  const dev = (t: number, motivo = 'executar negado no modo auto'): Item => e(t, 'entrega.devolvida', { motivo });
  const item = { nivel: 'dono', motivo: 'deploy devolvido ao dono: executar negado no modo auto', acoes: [{ rotulo: 'executar', comando: 'node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-12' }] };
  assert.deepEqual(proj(P('T1'), D([dev(0)])).depende, [item]);
  assert.deepEqual(proj(P('T1'), D([dev(0), e(1, 'entrega.inicio', { politica: 'continua' })])).depende, []);
  assert.deepEqual(proj(P('T1'), D([dev(0), e(1, 'entrega.inicio', { politica: 'continua' }), dev(2)])).depende, [item]);
  assert.equal(proj(P('T1'), D([dev(0)]), { entregaId: 'GM-99' }).depende[0].acoes[0].comando, 'node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-99');
  // motivo comprido é cortado (nada de 200 caracteres no topo)
  const longo = proj(P('T1'), D([dev(0, 'x'.repeat(200))])).depende[0].motivo;
  assert.ok(longo.startsWith('deploy devolvido ao dono: xxx') && longo.endsWith('…') && longo.length < 100, longo);
  // controle vira espaço
  assert.equal(proj(P('T1'), D([dev(0, 'a\x1b[31mb\nc')])).depende[0].motivo.includes('\x1b'), false);
});

test('devolvida-forma-invalida-apagada: motivo vazio ou não texto não acende; só ordena', () => {
  for (const dados of [{ motivo: '' }, { motivo: '   ' }, { motivo: 7 }, {}, 'x', null]) {
    assert.deepEqual(proj(P('T1'), D([e(0, 'entrega.devolvida', dados)])).depende, [], JSON.stringify(dados));
  }
  // com diário fora de ordem a devolvida não acende (exige ordenar); o PAROU cobre
  const fora = D([e(0, 'entrega.devolvida', { motivo: 'm' }), e(1, 'sessao.inicio')]).reverse();
  assert.deepEqual(proj(P('T1'), fora).depende.map((d) => d.nivel), ['parar']);
});

test('subir-sem-devolvida-nao-acende: subir, agendar, esperar e entregue não viram item', () => {
  for (const d of [{ tipo: 'subir' }, { tipo: 'agendar', quando: '2026-11-10T09:00:00.000Z' }, { tipo: 'esperar', motivo: 'homolog' }, { tipo: 'entregue' }, null] as EntradaPainel['decisaoEntrega'][]) {
    assert.deepEqual(proj(P('T1'), [], { decisaoEntrega: d }).depende, [], JSON.stringify(d));
    assert.equal(proj(P('T1'), [], { decisaoEntrega: d }).parar, null);
  }
});

test('release-pr-merge-base: release_pr ⇒ "merge da release para <base da decisão>" sem comando; entrada.base não vale', () => {
  const s = proj(P('T1'), [], { decisaoEntrega: { tipo: 'release_pr', base: 'develop' }, base: 'main' });
  assert.deepEqual(s.depende, [{ nivel: 'dono', motivo: 'merge da release para develop', acoes: [{ rotulo: 'faça o merge da release', comando: null }] }]);
  assert.equal(s.parado, false);
});

test('release-base-da-decisao: a base do merge é a da decisão (já passou por BASE_RE), nunca a de entrada.base', () => {
  assert.equal(proj(P('T1'), [], { decisaoEntrega: { tipo: 'release_pr', base: 'release/2' }, base: 'main' }).depende[0].motivo, 'merge da release para release/2');
  assert.equal(proj(P('T1'), [], { decisaoEntrega: { tipo: 'release_pr', base: 'main' }, base: 'develop' }).depende[0].motivo, 'merge da release para main');
});

test('depende-ordem-fixa: Parar, spec, emenda(s), pausa, devolvida, release', () => {
  const evs = D([parar(0, 'ci_vermelho'), e(1, 'entrega.devolvida', { motivo: 'm' }, 's2'), prop(2, 1)]);
  const s = proj(P('T1'), evs, { specSha: SHA_A, pausado: true, decisaoEntrega: { tipo: 'release_pr', base: 'main' } });
  assert.deepEqual(motivos(s), [TABELA_PARAR.ci_vermelho.texto, 'spec aguardando aprovação', 'emenda #1 em REQ-PNL-5', 'loop pausado', 'deploy devolvido ao dono: m', 'merge da release para main']);
  assert.deepEqual(s.depende.map((d) => d.nivel), ['parar', 'dono', 'dono', 'dono', 'dono', 'dono']);
  assert.deepEqual(dependeDeVoce(P('T1'), evs, entrada({ specSha: SHA_A, pausado: true, decisaoEntrega: { tipo: 'release_pr', base: 'main' } })), s.depende);
});

// ---------------------------------------------------------------- rodapé

test('prod-alteracoes-so-escrita-prod: leitura em prod não é alteração; escrita e execução em prod e operacao.destrutiva em prod são', () => {
  const pa = (ambiente: string, acao: string) => e(0, 'producao.acesso', { ambiente, acao, alvo: 'db' });
  const evs = D([pa('prod', 'leitura'), pa('prod', 'leitura'), pa('prod', 'escrita'), pa('prod', 'execucao'), e(5, 'operacao.destrutiva', { ambiente: 'prod', acao: 'escrita', alvo: 'db' })]);
  const s = proj(P('T1'), evs);
  assert.deepEqual(s.rodape.prod, { leituras: 2, alteracoes: 3 });
});

test('alteracoes-homolog-fora: homolog e desconhecido não entram em nenhuma das duas contagens', () => {
  const evs = D([
    e(0, 'producao.acesso', { ambiente: 'homolog', acao: 'escrita', alvo: 'x' }), e(1, 'producao.acesso', { ambiente: 'homolog', acao: 'leitura', alvo: 'x' }),
    e(2, 'operacao.destrutiva', { ambiente: 'homolog', acao: 'escrita', alvo: 'x' }), e(3, 'producao.acesso', { ambiente: 'desconhecido', acao: 'escrita', alvo: 'x' }),
  ]);
  assert.deepEqual(proj(P('T1'), evs).rodape.prod, { leituras: 0, alteracoes: 0 });
});

test('alteracoes-conta-entrega-inicio: cada entrega.inicio é uma alteração em produção (a entrega só grava producao.acesso no rollback)', () => {
  const evs = D([e(0, 'entrega.inicio', { politica: 'continua' }), e(10, 'entrega.inicio', { politica: 'janela' })]);
  assert.deepEqual(proj(P('T1'), evs).rodape.prod, { leituras: 0, alteracoes: 2 });
});

test('prod-contagem-vale-com-diario-invalido: as contagens varrem sem ordenar', () => {
  const evs = D([e(0, 'producao.acesso', { ambiente: 'prod', acao: 'leitura', alvo: 'x' }), e(1, 'producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'x' }), e(2, 'ci.resultado', { verde: 'x' })]);
  const s = proj(P('T1'), evs);
  assert.equal(s.parar?.motivo, 'diario_invalido');
  assert.deepEqual(s.rodape.prod, { leituras: 1, alteracoes: 1 });
  assert.deepEqual(proj(P('T1'), [evs[1], evs[0], null as unknown as Evento]).rodape.prod, { leituras: 1, alteracoes: 1 }); // fora de ordem e com lixo
});

test('execucoes-hoje-fuso: ci.resultado com verde booleano na data civil de agora, no fuso; ci.verde = o último booleano', () => {
  const ci = (iso: string, verde: unknown, sessao: string, seq: number, alvo?: string): Evento =>
    ({ seq, ts: iso, autor: 't', sessao, agente: 'a', tipo: 'ci.resultado', dados: { verde, ...(alvo ? { alvo } : {}) }, hash_anterior: null }) as unknown as Evento;
  const evs = [ci('2026-11-09T01:30:00.000Z', true, 's1', 1), ci('2026-11-09T12:00:00.000Z', false, 's1', 2), ci('2026-11-09T13:00:00.000Z', true, 's1', 3, 'homolog')];
  const utc = proj(P('T1'), evs, { agoraMs: Date.parse('2026-11-09T15:00:00Z'), fuso: 'UTC' });
  assert.equal(utc.rodape.ci.execucoesHoje, 3);
  assert.equal(utc.rodape.ci.verde, true); // o último, de qualquer alvo
  const sp = proj(P('T1'), evs, { agoraMs: Date.parse('2026-11-09T15:00:00Z'), fuso: 'America/Sao_Paulo' });
  assert.equal(sp.rodape.ci.execucoesHoje, 2); // 01:30Z é 22:30 de 08/11 em SP
  assert.equal(proj(P('T1'), evs, { agoraMs: Date.parse('2026-11-10T15:00:00Z') }).rodape.ci.execucoesHoje, 0);
  // "hoje" é a data civil de agora NO FUSO: 01:30Z de 10/11 ainda é 09/11 em São Paulo (os de 12:00Z e 13:00Z de 09/11 contam; o de 01:30Z de 09/11 é 08/11 lá)
  assert.equal(proj(P('T1'), evs, { agoraMs: Date.parse('2026-11-10T01:30:00Z'), fuso: 'America/Sao_Paulo' }).rodape.ci.execucoesHoje, 2);
  assert.equal(proj(P('T1'), evs, { agoraMs: Date.parse('2026-11-10T01:30:00Z'), fuso: 'UTC' }).rodape.ci.execucoesHoje, 0);
  assert.equal(proj(P('T1'), []).rodape.ci.verde, null);
  assert.deepEqual(proj(P('T1'), []).rodape.ci, { verde: null, execucoesHoje: 0 });
  const torto = [ci('2026-11-09T01:30:00.000Z', true, 's1', 1), ci('2026-11-09T02:30:00.000Z', 'sim', 's1', 2)];
  const t = proj(P('T1'), torto);
  assert.equal(t.rodape.ci.verde, true); // o 'sim' não é booleano: ignorado
  assert.equal(t.rodape.ci.execucoesHoje, 1);
  const falso = proj(P('T1'), [ci('2026-11-09T02:30:00.000Z', false, 's1', 1)]);
  assert.equal(falso.rodape.ci.verde, false);
});

// ---------------------------------------------------------------- atenção técnica

const consulta = (t: number, n: number): Item => e(t, 'sombra.consulta', { pergunta_hash: n.toString(16).padStart(64, '0'), req: 'REQ-PNL-1' });

test('atencao-segunda-rodada-ci-teto: os três textos fixos', () => {
  const dois = proj(P('T1'), D(ATE.reprovada));
  assert.deepEqual(dois.atencao, ['T1 na 2ª rodada de review']);
  for (const k of ['corrigindo', 'em_revisao'] as const) assert.deepEqual(proj(P('T1'), D([...ATE.corrigindo, ...(k === 'em_revisao' ? [con(5, 'T1'), ini(6, 'T1', 'revisor')] : [])])).atencao, ['T1 na 2ª rodada de review'], k);
  assert.deepEqual(proj(P('T1'), D(ATE.concluida)).atencao, []); // 1ª rodada
  assert.deepEqual(proj(P('T1'), D(ATE.aprovada)).atencao, []);
  assert.deepEqual(proj(P('T1'), D([e(0, 'ci.resultado', { verde: false })])).atencao, ['CI vermelho 1× depois do último verde']);
  const teto = proj(P('T1'), D([consulta(0, 1), consulta(1, 2), consulta(2, 3)]), { tetoSombra: 2 });
  assert.deepEqual(teto.atencao, ['Sombra: 3 consultas, acima do teto de 2']);
  assert.deepEqual(proj(P('T1'), D([consulta(0, 1), consulta(1, 2)]), { tetoSombra: 2 }).atencao, []); // no teto não passa dele
  // N do texto = contarConsultas (sombra.ts): consulta de forma inválida não conta
  const mistas = D([consulta(0, 1), e(1, 'sombra.consulta', { pergunta_hash: 'curto', req: 'REQ-PNL-1' }), e(2, 'sombra.consulta', { pergunta_hash: SHA_A }), consulta(3, 2), e(4, 'decisao.sombra', {})]);
  assert.equal(contarConsultas(mistas), 2);
  assert.deepEqual(proj(P('T1'), mistas, { tetoSombra: 1 }).atencao, ['Sombra: 2 consultas, acima do teto de 1']);
  // ordem do texto: 2ª rodada, CI, Sombra
  const tudo = proj(P('T1'), D([...ATE.reprovada, e(10, 'ci.resultado', { verde: false }), consulta(11, 1), consulta(12, 2)]), { tetoSombra: 1 });
  assert.deepEqual(tudo.atencao, ['T1 na 2ª rodada de review', 'CI vermelho 1× depois do último verde', 'Sombra: 2 consultas, acima do teto de 1']);
});

test('atencao-ci-zera-no-verde: vermelho, verde ⇒ nada; vermelho ×2 é do PAROU do loop, não da atenção; verde depois do vermelho zera', () => {
  const ci = (t: number, verde: boolean, extra: Record<string, unknown> = {}) => e(t, 'ci.resultado', { verde, ...extra });
  assert.deepEqual(proj(P('T1'), D([ci(0, false), ci(1, true)])).atencao, []);
  assert.deepEqual(proj(P('T1'), D([ci(0, false), ci(1, false)])).atencao, []);
  assert.deepEqual(proj(P('T1'), D([ci(0, false), ci(1, true), ci(2, false)])).atencao, ['CI vermelho 1× depois do último verde']);
});

test('atencao-homolog-nao-conta: CI de homolog não soma nem zera os vermelhos do loop', () => {
  const ci = (t: number, verde: boolean, alvo?: string) => e(t, 'ci.resultado', { verde, ...(alvo ? { alvo } : {}) });
  assert.deepEqual(proj(P('T1'), D([ci(0, false, 'homolog')])).atencao, []);
  assert.deepEqual(proj(P('T1'), D([ci(0, false), ci(1, true, 'homolog')])).atencao, ['CI vermelho 1× depois do último verde']);
  assert.deepEqual(proj(P('T1'), D([ci(0, false), ci(1, false, 'homolog')])).atencao, ['CI vermelho 1× depois do último verde']);
});

test('atencao-loop-segue-exclui-citada: "loop segue em <tasks em voo não citadas>" só com item de atenção e task em voo fora dele', () => {
  const t = (id: string, itens: Item[]) => itens.map((x) => ({ ...x, dados: { ...(x.dados as object), task: id } }));
  const plano = P('T1', 'T2', 'T3', 'T4');
  const base = [...t('T1', ATE.corrigindo), ...t('T2', ATE.implementando), ...t('T3', ATE.em_revisao), ...t('T4', ATE.concluida)];
  const s = proj(plano, D(base));
  assert.deepEqual(s.atencao, ['T1 na 2ª rodada de review', 'loop segue em T2 T3']); // T1 citada; T4 concluida não está em voo
  // sem item de atenção, nenhuma linha "loop segue"
  assert.deepEqual(proj(plano, D([...t('T2', ATE.implementando), ...t('T3', ATE.em_revisao)])).atencao, []);
  // tudo citado: nada a acrescentar
  assert.deepEqual(proj(P('T1'), D(ATE.corrigindo)).atencao, ['T1 na 2ª rodada de review']);
  // item sem task citada (CI): todas as em voo entram
  assert.deepEqual(proj(P('T1', 'T2'), D([...t('T1', ATE.implementando), ...t('T2', ATE.em_revisao), e(30, 'ci.resultado', { verde: false })])).atencao, ['CI vermelho 1× depois do último verde', 'loop segue em T1 T2']);
});

test('execucoes-hoje-instante-invalido: data civil vazia (agoraMs ou ts ilegível) nunca casa com outra vazia', () => {
  const torto = { seq: 1, ts: 'ontem', autor: 't', sessao: 's', agente: 'a', tipo: 'ci.resultado', dados: { verde: true }, hash_anterior: null } as unknown as Evento;
  assert.equal(proj(P('T1'), [torto], { agoraMs: Number.NaN }).rodape.ci.execucoesHoje, 0);
  assert.equal(proj(P('T1'), [torto]).rodape.ci.execucoesHoje, 0);
  assert.equal(proj(P('T1'), D([e(0, 'ci.resultado', { verde: true })]), { agoraMs: Number.NaN }).rodape.ci.execucoesHoje, 0);
});

test('eventos-ausentes-x-corrompidos: [] ≠ null ≠ lixo; cada um com saída distinta, nenhuma lança', () => {
  const ausente = proj(P('T1'), []);
  const nulo = proj(P('T1'), null);
  const lixo = proj(P('T1'), [{ seq: 'x' } as unknown as Evento]);
  const ts = proj(P('T1'), [{ seq: 1, ts: 'ontem', autor: 'a', sessao: 's', agente: 'a', tipo: 'sessao.inicio', dados: {}, hash_anterior: null } as Evento]);
  assert.equal(ausente.parar, null);
  for (const [nome, s] of [['null', nulo], ['lixo', lixo], ['ts torto', ts]] as [string, EstadoPainel][]) {
    assert.equal(s.parar?.motivo, 'diario_invalido', nome);
    assert.deepEqual(s.plano.tasks, [], nome);
  }
  assert.notDeepEqual(ausente, nulo);
  assert.equal(proj(P('T1'), [{ seq: 1, ts: iso(3), autor: 'a', sessao: 's', agente: 'a', tipo: 'sessao.inicio', dados: 'texto', hash_anterior: null } as unknown as Evento]).parar, null); // dados não objeto em evento irrelevante: aceito
  // plano vazio: nada quebra
  assert.equal(proj(P(), []).plano.pct, 0);
  assert.equal(proj(P(), []).plano.total, 0);
});

test('fuso-invalido-utc: fuso desconhecido cai em UTC sem lançar', () => {
  const evs = D([parar(7)]);
  assert.equal(proj(P('T1'), evs, { fuso: 'Marte/Olimpo' }).parar?.hora, '12:07');
  assert.equal(proj(P('T1'), evs, { fuso: '' }).parar?.hora, '12:07');
});

test('forma-completa: todas as chaves de EstadoPainel, com os campos que outras tasks preenchem vazios mas presentes', () => {
  const s = proj(P('T1'), []);
  assert.deepEqual(Object.keys(s).sort(), ['atencao', 'depende', 'equipe', 'historico', 'id', 'notificacao', 'ocultos', 'parado', 'parar', 'pacote', 'plano', 'qualidade', 'rodape', 'titulo'].sort());
  assert.deepEqual(s.historico, []);
  assert.equal(s.ocultos, 0);
  assert.equal(s.equipe.lider.nome, 'GANDALF');
  assert.deepEqual(Object.keys(s.plano).sort(), ['eta', 'feitas', 'medianaS', 'pct', 'rodadaMedia', 'tasks', 'total']);
  assert.deepEqual(Object.keys(proj(P('T1'), D([parar(0)])).parar ?? {}).sort(), ['acoes', 'alteracoes', 'chave', 'emVoo', 'hora', 'motivo', 'texto']);
});

// ---------------------------------------------------------------- costura (P9) e fecho do módulo

test('costura-P9: projetarPainel do dist (o artefato que o CLI e o mod carregam) = o do src, e o render real consome o estado sem lançar', async () => {
  const dist = (await import(join(AQUI, '..', 'dist', 'painel.js'))) as typeof import('../src/painel.ts');
  // 3 integradas (2 em paralelo ⇒ p = 2), 1 no teto, 2 pendentes: ETA presente, PAROU, emenda, spec e pausa
  const evs = D([...ciclo('T1', 0, 10), ...ciclo('T2', 5, 15), ...ciclo('T3', 20, 30), ...ATE.no_teto.map((x) => ({ ...x, t: x.t + 40, dados: { ...(x.dados as object), task: 'T4' } })), parar(60, 'teto_rodadas', { task: 'T4' }), prop(61, 1)]);
  const plano6 = P(...IDS);
  const entradaCheia = entrada({ specSha: SHA_A, pausado: true, titulo: 'E4 Painel', notificacao: { ts: iso(61) } });
  const doSrc = projetarPainel(plano6, evs, entradaCheia);
  const doDist = dist.projetarPainel(plano6, evs, entradaCheia);
  assert.deepEqual(doDist, doSrc);
  assert.deepEqual(doSrc.plano.eta && [doSrc.plano.eta.restanteS, doSrc.plano.eta.n], [1200, 3]); // restantes 3, p 2 ⇒ ⌈3/2⌉ = 2 × 600 s (floor daria 1)
  assert.equal(doSrc.parar?.acoes[0].comando, '/gabarito-mestre:liberar T4');
  assert.deepEqual(dist.TABELA_PARAR, TABELA_PARAR);
  for (const preset of ['esquadrao', 'executivo'] as const) {
    const linhas = renderPainel(doSrc, { preset, tema: 'mono', narracao: true, largura: 80 });
    assert.ok(Array.isArray(linhas) && linhas.length > 0, preset);
  }
});

test('fecho-sem-node: dist/painel.js e tudo que ele importa (relativo) não usam node:* nem import() dinâmico (o mod carrega o dist)', () => {
  const vistos = new Set<string>();
  const visitar = (arquivo: string): void => {
    if (vistos.has(arquivo)) return;
    vistos.add(arquivo);
    assert.ok(existsSync(arquivo), `dist ausente: ${arquivo}`);
    const js = readFileSync(arquivo, 'utf8');
    assert.equal(/^\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]node:|^\s*import\s*['"]node:/m.test(js), false, `${arquivo} importa node:*`);
    assert.equal(/\bimport\s*\(/.test(js), false, `${arquivo} usa import() dinâmico`);
    assert.equal(/\brequire\s*\(/.test(js), false, `${arquivo} usa require`);
    for (const m of js.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g)) visitar(join(dirname(arquivo), m[1]));
  };
  visitar(join(AQUI, '..', 'dist', 'painel.js'));
  assert.ok(vistos.size >= 5, [...vistos].join(','));
  const fonte = readFileSync(join(AQUI, '..', 'src', 'painel.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\bDate\.now\s*\(|from\s*['"]node:|process\.|new Date\s*\(\s*\)|Intl\.Segmenter/.test(fonte), false, 'painel.ts: relógio, node:* ou Segmenter');
});

test('equipe-com-lixo-e-null: eventos null ou com elemento null chegam a projetarEquipe sem lançar; a equipe sai e o PAROU vem do painel', () => {
  for (const evs of [null, [null as unknown as Evento], [undefined as unknown as Evento, ...D([ini(0, 'T1')])]]) {
    assert.doesNotThrow(() => projetarEquipe(P('T1'), evs, entrada()));
    const eq = projetarEquipe(P('T1'), evs, entrada());
    assert.equal(eq.lider.nome, 'GANDALF');
    assert.equal(eq.lider.tok, null);
    assert.equal(eq.sombra.nome, 'ELROND');
    const s = proj(P('T1'), evs);
    assert.equal(s.parar?.motivo, 'diario_invalido');
    assert.equal(s.equipe.lider.nome, 'GANDALF');
  }
});

test('tokens-igual-ao-pouso: o tok do líder (cópia sem node:*) = tokensDe de pouso.ts, com medição, sem medição e com contagem inválida', () => {
  const med = (t: number, dados: Record<string, unknown>, agente = 'orquestrador') => ({ ...e(t, 'custo.medicao', dados), agente });
  const casos: Evento[][] = [
    [],
    D([ini(0, 'T1')]),
    D([e(0, 'custo.medicao', { agente: 'orquestrador', input_tokens: 10, output_tokens: 5, cache_creation: 3, cache_read: 1000 })]),
    D([e(0, 'custo.medicao', { agente: 'orquestrador', input_tokens: 10 }), e(1, 'custo.medicao', { agente: 'orquestrador', output_tokens: 7 })]),
    D([e(0, 'custo.medicao', { agente: 'orquestrador', input_tokens: -1 })]),
    D([e(0, 'custo.medicao', { agente: 'orquestrador', input_tokens: '9' })]),
  ];
  for (const evs of casos) {
    const doOrq = evs.map((x) => ({ ...x, agente: 'orquestrador' })) as Evento[];
    const esperado = tokensDe(doOrq.filter((x) => x.tipo === 'custo.medicao'));
    const tok = projetarEquipe(P('T1'), doOrq, entrada()).lider.tok;
    assert.equal(tok, esperado.ok ? esperado.tokens : null, JSON.stringify(evs.map((x) => x.dados)));
  }
  assert.equal(projetarEquipe(P('T1'), D([e(0, 'custo.medicao', { input_tokens: 10, output_tokens: 5, cache_creation: 3, cache_read: 1000 })]).map((x) => ({ ...x, agente: 'orquestrador' })) as Evento[], entrada()).lider.tok, 18);
  void med;
});

test('fecho-sem-diario-sombra: o fecho de dist/painel.js tem diario-puro.js e não tem diario.js nem sombra.js (esses importam node:*)', () => {
  const vistos: string[] = [];
  const visitar = (arq: string): void => {
    if (vistos.includes(arq)) return;
    vistos.push(arq);
    for (const m of readFileSync(arq, 'utf8').matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g)) visitar(join(dirname(arq), m[1]));
  };
  visitar(join(AQUI, '..', 'dist', 'painel.js'));
  assert.equal(vistos.some((v) => v.endsWith('diario.js') || v.endsWith('sombra.js')), false, vistos.join(','));
  assert.equal(vistos.some((v) => v.endsWith('diario-puro.js')), true, vistos.join(','));
});

// ---------------------------------------------------------------- cronômetro: regras do módulo puro lidas pelo painel (GM-12 T2 r3)
// O painel usa `duracoes` de `diario-puro.ts` (a mesma de `diario.ts`). Estes casos leem o número que sai no painel, para que uma
// mutação na regra do cronômetro caia também aqui (R-M1: intervalo com ts anterior ao início; R-M2: reabertura do dono zera a soma).
{
  const rawT0 = Date.UTC(2026, 10, 3, 10, 0, 0);
  const rawTs = (s: number | string): string => (typeof s === 'number' ? new Date(rawT0 + s * 1000).toISOString() : s);
  const R = (seq: number, s: number | string, tipo: TipoEvento, dados: Record<string, unknown>): Evento =>
    ({ seq, ts: rawTs(s), autor: 'a', sessao: 's1', agente: 'orquestrador', tipo, dados, hash_anterior: null }) as unknown as Evento;
  const rIni = (n: number, s: number | string, task: string, papel = 'implementador') => R(n, s, 'task.iniciada', { task, papel });
  const rCon = (n: number, s: number | string, task: string) => R(n, s, 'task.concluida', { task });
  const rVer = (n: number, s: number | string, task: string, veredito = 'APROVADO', rodada = 1, major = 0) =>
    R(n, s, 'review.veredito', { task, veredito, blocker: 0, major, rodada });
  const rReab = (n: number, s: number | string, task: string, origem: 'dono' | 'retomada') => R(n, s, 'task.reaberta', { task, origem });
  const rCiclo = (b: number, task: string, a: number | string, f: number | string, veredito = 'APROVADO'): Evento[] =>
    [rIni(b * 10, a, task), rCon(b * 10 + 1, a, task), rIni(b * 10 + 2, a, task, 'revisor'), rVer(b * 10 + 3, f, task, veredito)];
  const duas = (a: number, b: number): Evento[] => [...rCiclo(1, 'T1', 1000, 1000 + a), ...rCiclo(3, 'T2', 3000, 3000 + b)];

  test('cronometro-veredito-antes-do-inicio-nao-soma-negativo: o intervalo com ts anterior ao início é descartado e a task segue na amostra (R-M1)', () => {
    const t3 = [...rCiclo(5, 'T3', '2026-11-03T20:00:00.000Z', '2026-11-03T19:00:00.000Z', 'REPROVADO'),
      rIni(60, 30000, 'T3', 'correcao'), rCon(61, 30010, 'T3'), rIni(62, 30020, 'T3', 'revisor'), rVer(63, 30300, 'T3', 'APROVADO', 2)];
    const s = proj(P('T1', 'T2', 'T3'), [...duas(100, 900), ...t3]);
    assert.equal(s.plano.medianaS, 300);
    assert.deepEqual(s.plano.eta && s.plano.eta.n, 3);
  });

  test('cronometro-dono-reabre-zera-a-soma: task.reaberta do dono volta a pendente e as rodadas anteriores não entram (R-M2)', () => {
    const t3 = [...rCiclo(5, 'T3', 10000, 10400, 'REPROVADO'),
      rIni(60, 10410, 'T3', 'correcao'), rCon(61, 10420, 'T3'), rIni(62, 10430, 'T3', 'revisor'), rVer(63, 10900, 'T3', 'REPROVADO', 2, 1),
      rReab(64, 12000, 'T3', 'dono'),
      rIni(65, 13000, 'T3'), rCon(66, 13010, 'T3'), rIni(67, 13020, 'T3', 'revisor'), rVer(68, 13100, 'T3', 'APROVADO', 1)];
    assert.equal(proj(P('T1', 'T2', 'T3'), [...duas(50, 1000), ...t3]).plano.medianaS, 100);
  });
}

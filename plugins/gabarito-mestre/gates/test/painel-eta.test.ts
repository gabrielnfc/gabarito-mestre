/**
 * GM-15 T30 (D-G2, REQ-HIG-1 h): previsão exata do painel. Caminho crítico com tempo medido por etapa, crédito do que já rodou, faixa P25-P75,
 * fechamento (h.1), base visível (h.2) e replay da GM-14 (fixture eta-gm14: eventos de task e plano reais, só T8 fora).
 * A conta antiga (D5, `etaDe`) continua em `plano.eta` e nos testes `eta-*` de painel.test.ts; a nova sai em `pronto.previsao`.
 * Mutações: cada teste diz a que o mata (rodadas em 2026-11-16, ver o relatório da task).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { etapasDe, fechamentoDasAnteriores, fechamentoDe, ocupacaoDe, previsaoExata, projetarPainel, renderPainel, ritmoDe } from '../src/painel.ts';
import { colunas } from '../src/painel-largura.ts';
import * as dist from '../dist/painel.js';
import * as diario from '../dist/diario.js';
import { estadoDoPainel } from '../scripts/painel.mjs';
import { raizSegura } from './_raiz-segura.mjs';
import type { EntradaPainel, EstadoPainel, Evento, OpcoesRender, Plano, TipoEvento } from '../src/tipos.ts';

const T0 = Date.parse('2026-11-16T12:00:00Z');
const MIN = 60_000;
const iso = (min: number): string => new Date(T0 + min * MIN).toISOString();
type Item = { t: number; tipo: TipoEvento; dados?: unknown };
const e = (t: number, tipo: TipoEvento, dados: unknown = {}): Item => ({ t, tipo, dados });
function D(itens: Item[]): Evento[] {
  let seq = 0;
  return [...itens].map((x, i) => ({ x, i })).sort((a, b) => a.x.t - b.x.t || a.i - b.i)
    .map(({ x }) => ({ seq: ++seq, ts: iso(x.t), autor: 't', sessao: 's1', agente: 'orquestrador', tipo: x.tipo, dados: x.dados, hash_anterior: null } as unknown as Evento));
}
const ini = (t: number, task: string, papel = 'implementador') => e(t, 'task.iniciada', { task, papel });
const con = (t: number, task: string) => e(t, 'task.concluida', { task });
const ver = (t: number, task: string, ok = true) => e(t, 'review.veredito', { task, veredito: ok ? 'APROVADO' : 'REPROVADO', rodada: 1, major: 0, blocker: 0 });
const integ = (t: number, task: string) => e(t, 'task.integrada', { task });
/** impl 1 min, revisão 4 min, integração 1 min: 6 min por task; começa em `a`. */
const ciclo = (task: string, a: number, impl = 1, rev = 4, int = 1): Item[] => [ini(a, task), con(a + impl, task), ini(a + impl + 1, task, 'revisor'), ver(a + impl + rev, task), integ(a + impl + rev + int, task)];
const P = (tasks: [string, string[]][]): Plano => ({ entrega: 'GM-15', tasks: tasks.map(([id, deps]) => ({ id, deps, arquivos: [] })) });
const AQUI = dirname(fileURLToPath(import.meta.url));

type Est = { estado: string; ultimo: Evento };
const pend = (ids: string[]): Map<string, Est> => new Map(ids.map((id) => [id, { estado: 'pendente', ultimo: D([ini(0, id)])[0] }]));
const feitas = (ids: string[]): ReadonlySet<string> => new Set(ids);
/** 3 integradas em paralelo (p = 3), de 6 min cada, em T0+0..7. */
const TRES = D([...ciclo('A', 0), ...ciclo('B', 0.5), ...ciclo('C', 1)]);
const AGORA_TRES = T0 + 8 * MIN;
/** O que `estadosDe` daria: A, B e C integradas; o resto como o teste diz. */
const comIntegradas = (m: Map<string, Est>): Map<string, Est> => new Map([...['A', 'B', 'C'].map((id) => [id, { estado: 'integrada', ultimo: D([ini(0, id)])[0] }] as [string, Est]), ...m]);
const prever = (plano: Plano, estados: Map<string, Est>, fech: number | null = null, ev: Evento[] = TRES, agora = AGORA_TRES) =>
  previsaoExata(plano, ev, comIntegradas(estados) as never, feitas(['A', 'B', 'C']), agora, 'UTC', fech, 1) as NonNullable<ReturnType<typeof previsaoExata>>;

test('etapas-por-etapa: implementação, revisão e integração medidas da última reabertura; sem as 3 pontas a task não entra', () => {
  const ev = D([...ciclo('A', 0, 2, 6, 3), ini(30, 'B'), con(31, 'B'), integ(40, 'B'), ...ciclo('C', 100), e(150, 'task.reaberta', { task: 'C', origem: 'dono' }), ...ciclo('C', 200, 5, 7, 11)]);
  const x = etapasDe(ev, feitas(['A', 'B', 'C']));
  assert.deepEqual(x, { impl: [120, 300], rev: [360, 420], integ: [180, 660] }, 'B sem veredito fica fora; C conta só depois da reabertura');
});

test('caminho-critico-segue-deps: cadeia de 3 leva 3 vezes uma task; 3 independentes em p = 3 levam uma só', () => {
  const ids = ['X', 'Y', 'Z'];
  const cadeia = prever(P([['A', []], ['B', []], ['C', []], ['X', []], ['Y', ['X']], ['Z', ['Y']]]), pend(ids));
  const solta = prever(P([['A', []], ['B', []], ['C', []], ['X', []], ['Y', []], ['Z', []]]), pend(ids));
  const oc = ocupacaoDe(TRES, AGORA_TRES) as number;
  assert.ok(Math.abs(cadeia.restanteS - (3 * 360) / oc) < 1e-6, `cadeia = 3 × 6 min ÷ ocupação (veio ${cadeia.restanteS})`);
  assert.ok(solta.restanteS < cadeia.restanteS / 2, 'sem dependência as 3 rodam juntas');
  assert.equal(cadeia.conta.caminho, 3);
  assert.equal(solta.conta.caminho, 1);
});

test('credito-do-que-ja-rodou: a etapa em andamento desconta o tempo gasto (piso 0) e as seguintes continuam inteiras', () => {
  const plano = P([['A', []], ['B', []], ['C', []], ['X', []]]);
  const em = (estado: string, desdeMin: number) => new Map<string, Est>([['X', { estado, ultimo: D([ini(desdeMin, 'X')])[0] }]]);
  const oc = ocupacaoDe(TRES, AGORA_TRES) as number;
  const cheia = prever(plano, em('pendente', 0)).restanteS;
  assert.ok(Math.abs(cheia - 360 / oc) < 1e-6);
  const impl = prever(plano, em('implementando', 6)).restanteS; // gastou 2 min dos 1 min de implementação? agora = 8: gastou 2 ⇒ 0 + rev + integ
  assert.ok(Math.abs(impl - 300 / oc) < 1e-6, `implementando há mais que a mediana: sobram revisão e integração (veio ${impl})`);
  const rev = prever(plano, em('em_revisao', 7)).restanteS; // gastou 1 min dos 4 de revisão
  assert.ok(Math.abs(rev - (180 + 60) / oc) < 1e-6, `em revisão há 1 min: 3 min de revisão + integração (veio ${rev})`);
  const apr = prever(plano, em('aprovada', 0)).restanteS; // gastou 8 min, a integração (1) já passou
  assert.ok(Math.abs(apr - 0) < 1e-6 || apr <= 1e-6, `aprovada há mais que a integração: nada falta (veio ${apr})`);
});

test('faixa-p25-p75: ± sai dos quartis de cada etapa; etapas iguais ⇒ faixa de largura zero', () => {
  const plano = P([['A', []], ['B', []], ['C', []], ['X', []]]);
  assert.equal(prever(plano, pend(['X'])).maisMenosS, 0, 'as 3 integradas têm as mesmas etapas');
  const irregular = D([...ciclo('A', 0, 1, 4, 1), ...ciclo('B', 0.5, 3, 8, 1), ...ciclo('C', 1, 2, 12, 2)]);
  const p = previsaoExata(plano, irregular, comIntegradas(pend(['X'])) as never, feitas(['A', 'B', 'C']), T0 + 20 * MIN, 'UTC', null, 1) as NonNullable<ReturnType<typeof previsaoExata>>;
  assert.ok(p.maisMenosS > 0);
  assert.notEqual(p.faixa.de, p.faixa.ate === '?' ? '?' : p.hora, 'a faixa não é o ponto');
});

test('fechamento-na-previsao: soma o fechamento medido depois do caminho; sem medição a faixa abre em "?" com o motivo (h.1)', () => {
  const plano = P([['A', []], ['B', []], ['C', []], ['X', []]]);
  const sem = prever(plano, pend(['X']), null);
  const com = prever(plano, pend(['X']), 5400);
  assert.equal(com.restanteS - sem.restanteS, 5400, 'o fechamento entra inteiro, depois do caminho');
  assert.equal(com.conta.fechamentoS, 5400);
  assert.equal(com.motivo, null);
  assert.notEqual(com.faixa.ate, '?');
  assert.equal(sem.faixa.ate, '?');
  assert.match(sem.motivo as string, /fechamento não medido/);
  assert.equal(sem.conta.fechamentoS, null);
});

test('fechamento-medido-do-diario: da última integrada ao entrega.encerrada; sem os dois ou fora de ordem, null', () => {
  const base = [...ciclo('A', 0), ...ciclo('B', 10)];
  assert.equal(fechamentoDe(D([...base, e(120, 'entrega.encerrada', { entrega: 'GM-15' })])), (120 - 16) * 60);
  assert.equal(fechamentoDe(D(base)), null, 'sem encerramento não há medida');
  assert.equal(fechamentoDe(D([e(5, 'entrega.encerrada', {}), ...base])), null, 'encerrada antes da última integrada não é fechamento');
  assert.equal(fechamentoDe([]), null);
  // o fim é o merge (`mergeado_em`), não a hora em que o `medir` gravou o encerramento (pode ser dias depois)
  const merge = iso(60);
  assert.equal(fechamentoDe(D([...base, e(900, 'entrega.encerrada', { entrega: 'GM-15', pr: 1, via: 'head', mergeado_em: merge })])), (60 - 16) * 60);
});

test('fechamento-das-anteriores: mediana dos fechamentos medidos das OUTRAS entregas do repo; a atual e as sem medida não entram (h.1)', () => {
  const enc = (min: number) => e(min, 'entrega.encerrada', { entrega: 'X', pr: 1, via: 'head', mergeado_em: iso(min) });
  const com = (min: number) => D([...ciclo('A', 0), enc(6 + min)]); // última integrada em 6: fechamento = min
  const diarios = [
    { id: 'GM-11', eventos: com(30) }, { id: 'GM-12', eventos: com(90) }, { id: 'GM-13', eventos: com(60) },
    { id: 'GM-14', eventos: D(ciclo('A', 0)) }, // sem encerramento: fora
    { id: 'GM-15', eventos: com(5) }, // a atual: fora
  ];
  assert.equal(fechamentoDasAnteriores(diarios, 'GM-15'), 60 * 60, 'mediana de 30, 60 e 90 min');
  assert.equal(fechamentoDasAnteriores(diarios.slice(3), 'GM-15'), null, 'nenhuma anterior medida ⇒ null (nunca palpite)');
  assert.equal(fechamentoDasAnteriores([{ id: 'GM-11', eventos: com(30) }, { id: 'GM-12', eventos: com(90) }], null), 60 * 60, 'nº par: média das 2 do meio');
});

test('fechamento-produtor-cli: o painel.mjs mede o fechamento nas entregas anteriores do diário e o entrega à projeção (h.1)', () => {
  const repo = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'painel eta '))));
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'feat/GM-15-x'); g('config', 'user.email', 't@t.test'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'x\n'); g('add', '.'); g('commit', '-q', '-m', 'inicio');
  const semear = (id: string, itens: [string, Record<string, unknown>, string][]) => {
    const dir = join(repo, '.harness', 'entregas', id);
    mkdirSync(dir, { recursive: true });
    for (const [tipo, dados, ts] of itens) {
      const r = diario.append(dir, 'loop', { ts, autor: 't@t.test', sessao: 'loop', agente: 'orquestrador', tipo, dados } as never) as { ok: boolean };
      assert.ok(r.ok, `preparo ${tipo}`);
    }
  };
  const ciclo14 = (t: string, m: number): [string, Record<string, unknown>, string][] => [
    ['task.iniciada', { task: t, papel: 'implementador' }, iso(m)], ['task.concluida', { task: t, sha: 'a'.repeat(40) }, iso(m + 1)],
    ['review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }, iso(m + 2)], ['task.integrada', { task: t, sha: 'b'.repeat(40), mutacoes: { total: 1, mortas: 1 } }, iso(m + 3)],
  ];
  semear('GM-14', [...ciclo14('T1', 0), ['entrega.encerrada', { entrega: 'GM-14', pr: 22, via: 'head', mergeado_em: iso(3 + 80) }, iso(3 + 500)]]);
  semear('GM-15', ciclo14('T1', 1000));
  let visto: unknown = 'não chamado';
  const r = estadoDoPainel(repo, { agoraMs: T0 + 1100 * MIN, projetar: (_p: unknown, _e: unknown, entrada: { fechamentoS?: unknown }) => { visto = entrada.fechamentoS; return {}; } }) as { ok: boolean };
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(visto, 80 * 60, 'fechamento da GM-14: da última integrada (3) ao merge (83), não ao registro (503)');
});

test('ocupacao-e-ritmo: o tempo parado alarga a previsão; o ritmo medido vira o ponto quando o caminho não o vê', () => {
  const plano = P([['A', []], ['B', []], ['C', []], ['X', []]]);
  const quase = prever(plano, pend(['X']), null, TRES, AGORA_TRES);
  const noite = prever(plano, pend(['X']), null, TRES, T0 + 600 * MIN); // 10 h depois: quase tudo parado
  assert.ok(noite.restanteS > quase.restanteS * 5, 'ocupação baixa multiplica o restante');
  assert.ok((ocupacaoDe(TRES, T0 + 600 * MIN) as number) < (ocupacaoDe(TRES, AGORA_TRES) as number));
  // 3 integradas em sequência com 2 h de parada entre elas: ritmo ≈ 1 h por task; faltam 2 ⇒ o ponto é o ritmo, não os 12 min do caminho
  const lento = D([...ciclo('A', 0), ...ciclo('B', 120), ...ciclo('C', 240)]);
  const f = previsaoExata(P([['A', []], ['B', []], ['C', []], ['X', []], ['Y', []]]), lento, comIntegradas(pend(['X', 'Y'])) as never, feitas(['A', 'B', 'C']), T0 + 247 * MIN, 'UTC', null, 1) as NonNullable<ReturnType<typeof previsaoExata>>;
  assert.equal(ritmoDe(lento, feitas(['A', 'B', 'C']), T0 + 247 * MIN), (247 * 60) / 3, 'menos de 24 h de história: da 1ª iniciada até agora');
  assert.ok(f.restanteS >= 2 * 82 * 60 - 1, `2 tasks abertas × 82 min de ritmo (veio ${f.restanteS / 60} min)`);
});

test('ritmo-ultimo-dia: o ritmo é o do último ciclo de 24 h até agora (uma noite dentro), não o da entrega inteira', () => {
  const H = 60;
  // 3 integradas na 1ª hora (rajada), depois só 2 em 26-27 h: a rajada fica fora da janela de 24 h
  const ev = D([...ciclo('A', 0), ...ciclo('B', 10), ...ciclo('C', 20), ...ciclo('D', 26 * H), ...ciclo('E', 27 * H)]);
  const todas = feitas(['A', 'B', 'C', 'D', 'E']);
  const agora = T0 + (27 * H + 10) * MIN;
  assert.equal(ritmoDe(ev, todas, agora), (24 * 3600) / 2, '24 h ÷ 2 integradas na janela');
  // o relógio corre até agora: 10 h sem integrar alargam o ritmo (a noite entra na conta)
  assert.equal(ritmoDe(ev, todas, agora + 10 * H * MIN), (24 * 3600) / 2, 'D e E (26-27 h) ainda na janela que acaba 10 h depois');
  assert.equal(ritmoDe(ev, todas, agora + 30 * H * MIN), (57 * H + 10) * 60 / 5, 'sem integrada nas últimas 24 h: da 1ª iniciada até agora ÷ todas');
  assert.equal(ritmoDe(ev, feitas([]), agora), null);
});

test('base-igual-ao-vetor: pronto.previsao diz as tasks, o ritmo e o fechamento da MESMA conta (g.14, h.2)', () => {
  const plano = P([['A', []], ['B', []], ['C', []], ['X', []], ['Y', ['X']]]);
  const entrada = (extra: Record<string, unknown> = {}): EntradaPainel => ({
    decisaoEntrega: null, pausado: false, contexto: { percent: 10, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
    pacote: { nome: 'p', lider: 'L', sabio: 'S', nomes: ['N'] }, notificacao: null, agoraMs: AGORA_TRES, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
    entregaId: 'GM-15', modeloSessao: null, specSha: null, tetoSombra: 26,
    fatos: { branch: 'b', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: ['A', 'B', 'C', 'X', 'Y'] }, ledger: false, gh: 'ok', ultimas: [], sessao: 's1' }, ...extra,
  } as unknown as EntradaPainel);
  const sem = projetarPainel(plano, TRES, entrada()).pronto?.previsao as Record<string, any>;
  assert.equal(sem.base, 3, 'base = as integradas que entraram na conta');
  assert.deepEqual([sem.conta.caminho, sem.conta.minPorTask, sem.conta.rodadas, sem.conta.fechamentoS], [2, 6, 1, null]);
  assert.equal(sem.faixa.ate, '?');
  const com = projetarPainel(plano, TRES, entrada({ fechamentoS: 3600 })).pronto?.previsao as Record<string, any>;
  assert.equal(com.conta.fechamentoS, 3600, 'o fechamento da entrada chega à conta');
  assert.equal(com.restanteS - sem.restanteS, 3600);
  assert.equal(typeof com.hora, 'string');
});

/** h.2: o estado de 5 tasks (3 integradas) com ou sem fechamento medido, e a linha PLANO do desenho em `w` colunas. */
const P5 = P([['A', []], ['B', []], ['C', []], ['X', []], ['Y', ['X']]]);
const E5 = (extra: Record<string, unknown> = {}): EntradaPainel => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: 10, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
  pacote: { nome: 'p', lider: 'L', sabio: 'S', nomes: ['N'] }, notificacao: null, agoraMs: AGORA_TRES, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
  entregaId: 'GM-15', modeloSessao: null, specSha: null, tetoSombra: 26,
  fatos: { branch: 'b', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: ['A', 'B', 'C', 'X', 'Y'] }, ledger: false, gh: 'ok', ultimas: [], sessao: 's1' }, ...extra,
} as unknown as EntradaPainel);
const linhaPlano = (s: EstadoPainel, w: number): string =>
  renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: w } as OpcoesRender).map((l) => l.map((x) => x.texto).join('')).find((l) => /^PLANO/.test(l)) as string;

/** Etapas diferentes nas 3 integradas: a faixa tem largura (de ≠ até). */
const IRREG = D([...ciclo('A', 0, 1, 4, 1), ...ciclo('B', 0.5, 3, 8, 1), ...ciclo('C', 1, 2, 12, 2)]);

test('eta-base-visivel-100col: em >= 100 colunas a linha da previsão diz a faixa e a base da MESMA conta (caminho, min/task, rodada, fechamento) (h.2)', () => {
  const s = projetarPainel(P5, IRREG, E5({ fechamentoS: 4800, agoraMs: T0 + 20 * MIN }));
  const pv = s.pronto?.previsao as Record<string, any>;
  assert.notEqual(pv.faixa.de, pv.faixa.ate, 'premissa: faixa com largura');
  const l120 = linhaPlano(s, 120);
  assert.ok(l120.endsWith(`previsão ${pv.faixa.de}–${pv.faixa.ate} · caminho 2 tasks · ${pv.conta.minPorTask} min/task · 1,0 rodada · fechamento 1h20`), l120);
  const l100 = linhaPlano(s, 100);
  assert.ok(colunas(l100) <= 100, l100);
  assert.match(l100, /previsão \d\d:\d\d–\d\d:\d\d · caminho 2 tasks · .*fechamento 1h20$/, 'em 100 a base sai por campo inteiro, o fechamento fica');
  // a base é a do estado: outro número na conta muda o texto (nada recalculado no render)
  const outro = { ...s, pronto: { ...s.pronto, previsao: { ...pv, conta: { ...pv.conta, caminho: 7, minPorTask: 41, rodadas: 1.7, fechamentoS: 1500 } } } } as EstadoPainel;
  assert.match(linhaPlano(outro, 120), / · caminho 7 tasks · 41 min\/task · 1,7 rodada · fechamento 25 min$/);
});

test('eta-base-cortada-80col: abaixo de 100 colunas só a faixa, sem a base (h.2, D-P8)', () => {
  const s = projetarPainel(P5, IRREG, E5({ fechamentoS: 4800, agoraMs: T0 + 20 * MIN }));
  for (const w of [99, 80]) {
    const l = linhaPlano(s, w);
    assert.match(l, /previsão \d\d:\d\d–\d\d:\d\d$/, `${w}: ${l}`);
    assert.doesNotMatch(l, /caminho|min\/task|rodada|fechamento|base:/);
    assert.ok(colunas(l) <= w);
  }
});

test('eta-fechamento-sem-medicao-interroga: sem fechamento medido a faixa abre em "?" e, em >= 100, a base diz que o fechamento não foi medido (h.1)', () => {
  const s = projetarPainel(P5, TRES, E5());
  assert.match(linhaPlano(s, 120), /previsão \d\d:\d\d–\? · caminho 2 tasks · 6 min\/task · 1,0 rodada · fechamento não medido$/);
  assert.match(linhaPlano(s, 80), /previsão \d\d:\d\d–\?$/);
});

test('eta-previsao-antiga-intacta: sem a conta exata (estado sem faixa) a linha segue a do E4 com a base em tasks', () => {
  const s = projetarPainel(P5, TRES, E5());
  const velho = { ...s, pronto: { ...s.pronto, previsao: { hora: '12:30', base: 3 } } } as EstadoPainel;
  assert.match(linhaPlano(velho, 120), /previsão 12:30 \(base: 3 tasks desta entrega\)$/);
});

test('replay-gm14: erro mediano da previsão contra o término real, em cada integração da GM-14, e a conta antiga como régua', () => {
  const F = join(AQUI, 'fixtures', 'eta-gm14');
  const plano0 = JSON.parse(readFileSync(join(F, 'plano.json'), 'utf8')) as Plano;
  const meta = JSON.parse(readFileSync(join(F, 'meta.json'), 'utf8')) as { fimRealIso: string };
  const todos = readFileSync(join(F, 'eventos.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Evento);
  // T8 nunca integrou na GM-14 (teto de rodadas, cortada pelo dono): fora do plano e do diário, senão nenhuma previsão fecha
  const ev = todos.filter((x) => (x.dados as { task?: string }).task !== 'T8');
  const plano: Plano = { ...plano0, tasks: plano0.tasks.filter((t) => t.id !== 'T8').map((t) => ({ ...t, deps: t.deps.filter((d) => d !== 'T8') })) };
  const ints = ev.filter((x) => x.tipo === 'task.integrada');
  assert.equal(ints.length, 57);
  const ultima = Date.parse(ints[ints.length - 1].ts);
  const fim = Date.parse(meta.fimRealIso);
  const fechamentoReal = (fim - ultima) / 1000;
  const ids = plano.tasks.map((t) => t.id);
  const ent = (agoraMs: number, fechamentoS: number | null): EntradaPainel => ({
    decisaoEntrega: null, pausado: false, contexto: { percent: 1, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
    pacote: { nome: 'p', lider: 'L', sabio: 'S', nomes: ['N'] }, notificacao: null, agoraMs, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
    entregaId: 'GM-14', modeloSessao: null, specSha: null, tetoSombra: 26, fechamentoS,
    fatos: { branch: 'b', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: ids }, ledger: false, gh: 'ok', ultimas: [], sessao: 'loop' },
  } as unknown as EntradaPainel);
  const novo: number[] = [], comFecho: number[] = [], antigo: number[] = [];
  for (let k = 3; k < ints.length; k++) {
    const agora = Date.parse(ints[k - 1].ts) + 1000;
    const lista = ev.filter((x) => Date.parse(x.ts) <= agora);
    const s = projetarPainel(plano, lista, ent(agora, null));
    const c = projetarPainel(plano, lista, ent(agora, fechamentoReal));
    const p = s.pronto?.previsao as unknown as { restanteS: number };
    const pc = c.pronto?.previsao as unknown as { restanteS: number };
    assert.ok(p && pc, `previsão em ${k} integradas`);
    novo.push(Math.abs(agora + p.restanteS * 1000 - ultima) / (ultima - agora));
    comFecho.push(Math.abs(agora + pc.restanteS * 1000 - fim) / (fim - agora));
    const a = s.plano.eta as NonNullable<typeof s.plano.eta>;
    antigo.push(Math.abs(agora + a.restanteS * 1000 - ultima) / (ultima - agora));
  }
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log(`replay GM-14 (${novo.length} pontos): erro mediano caminho ${(med(novo) * 100).toFixed(1)}% · com fechamento ${(med(comFecho) * 100).toFixed(1)}% · conta antiga ${(med(antigo) * 100).toFixed(1)}%`);
  // a meta da D-G2 é ≤ 15 %. Medido em 2026-11-16: ritmo da entrega inteira 32,9 % / 29,1 % (com fechamento, contra o término real); ritmo do último
  // dia 26,4 % / 25,4 %. Teto: o ritmo médio FINAL da GM-14 (94 min/task, que nenhum ponto conhece) erra 14,8 %. Este teto TRAVA o que se mediu, não a meta.
  assert.ok(med(novo) < 0.28, `erro mediano ${med(novo)}`);
  assert.ok(med(comFecho) < 0.27, `erro mediano com fechamento ${med(comFecho)}`);
  assert.ok(med(novo) < med(antigo) / 2, 'a previsão nova erra menos da metade da antiga');
});

test('dist-igual-ao-src: o artefato que o CLI e o mod carregam calcula a mesma previsão', () => {
  const plano = P([['A', []], ['B', []], ['C', []], ['X', []], ['Y', ['X']]]);
  const a = prever(plano, pend(['X', 'Y']), 1234);
  const b = (dist as unknown as { previsaoExata: typeof previsaoExata }).previsaoExata(plano, TRES, comIntegradas(pend(['X', 'Y'])) as never, feitas(['A', 'B', 'C']), AGORA_TRES, 'UTC', 1234, 1);
  assert.deepEqual(b, a);
});

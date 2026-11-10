/**
 * Testes de `painel-formato` e do campo `equipe.vivos` (GM-12 T4c, D-R1, D-R2, D-R3, D-R5).
 * Mutações prescritas (.superpowers/sdd/2026-11-09-e4-painel/task-4c-mut.json):
 *  vivos = 0 sem mod ............ `vivos-null-sem-mod`        · ordem de entrada mantida ... `equipe-ordem-nao-depende-da-lista-do-mod`
 *  previsão com eta antes de parar `previsao-precedencia`     · `fmtTok` com `floor` ....... `fmt-tok-limites`
 *  (mais uma por função exportada: ver o JSON)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alinhar, corEstadoTask, faixaIds, fmtPct, fmtTempo, fmtTok, num, previsao, separador, textoDoPapel, textoEstadoTask } from '../src/painel-formato.ts';
import { projetarEquipe } from '../src/painel-equipe.ts';
import { projetarPainel } from '../src/painel.ts';
import { colunas } from '../src/painel-largura.ts';
import { cortarLinha } from '../src/painel-texto.ts';
import type { EstadoTask } from '../src/loop.ts';
import type { AgenteVivo, EntradaPainel, EstadoPainel, Evento, Linha, PacoteNomes, Plano, TipoEvento } from '../src/tipos.ts';
import { ESTADOS, EXTRAS, NOMES_EXTRAS } from './painel-fixtures/estados.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TEXTO = (l: Linha): string => l.map((s) => s.texto).join('');
const LARG = (l: Linha): number => colunas(TEXTO(l));

// ---------- números ----------

test('num: só número finito; NaN, Infinity, texto e null viram null; 0 e negativo passam', () => {
  assert.equal(num(0), 0);
  assert.equal(num(-3), -3);
  assert.equal(num(1.5), 1.5);
  for (const v of [NaN, Infinity, -Infinity, '5', null, undefined, {}, [], true]) assert.equal(num(v), null, String(v));
});

test('fmt-tok-limites: 999, 1000, 999 499, 999 500, 1 000 000, null, NaN, negativo', () => {
  assert.equal(fmtTok(0), '0');
  assert.equal(fmtTok(999), '999');
  assert.equal(fmtTok(1000), '1k');
  assert.equal(fmtTok(1499), '1k');
  assert.equal(fmtTok(1500), '2k', 'round, não floor');
  assert.equal(fmtTok(412_600), '413k', 'round, não floor');
  assert.equal(fmtTok(999_499), '999k');
  assert.equal(fmtTok(999_500), '1.0M', 'o arredondamento nunca escreve 1000k');
  assert.equal(fmtTok(1_000_000), '1.0M');
  assert.equal(fmtTok(1_250_000), '1.3M', '1 casa, ponto');
  assert.equal(fmtTok(2_340_000), '2.3M');
  assert.equal(fmtTok(null), '—');
  assert.equal(fmtTok(undefined), '—');
  assert.equal(fmtTok(NaN), '—');
  assert.equal(fmtTok(Infinity), '—');
  assert.equal(fmtTok(-1), '—', 'token negativo é dado corrompido');
});

test('fmt-tempo-hora: minutos até 59m, depois h e mm com 2 dígitos; ausente é vazio', () => {
  assert.equal(fmtTempo(null), '');
  assert.equal(fmtTempo(undefined), '');
  assert.equal(fmtTempo(NaN), '');
  assert.equal(fmtTempo(Infinity), '');
  assert.equal(fmtTempo(-5), '');
  assert.equal(fmtTempo(0), '0m');
  assert.equal(fmtTempo(59), '0m', 'floor');
  assert.equal(fmtTempo(60), '1m');
  assert.equal(fmtTempo(540), '9m');
  assert.equal(fmtTempo(3599), '59m');
  assert.equal(fmtTempo(3600), '1h00');
  assert.equal(fmtTempo(3600 + 5 * 60), '1h05', 'mm com zero à esquerda');
  assert.equal(fmtTempo(2 * 3600 + 59 * 60 + 59), '2h59');
  assert.equal(fmtTempo(25 * 3600), '25h00');
});

test('fmt-pct: round, sem teto, ausente é travessão, zero é 0%', () => {
  assert.equal(fmtPct(0), '0%');
  assert.equal(fmtPct(30.5), '31%');
  assert.equal(fmtPct(30.4), '30%');
  assert.equal(fmtPct(125), '125%', 'ctx passa de 100');
  assert.equal(fmtPct(null), '—');
  assert.equal(fmtPct(NaN), '—');
  assert.equal(fmtPct(Infinity), '—');
  assert.equal(fmtPct(-1), '—');
});

// ---------- previsão ----------

const estado = (nome: keyof typeof ESTADOS | (typeof NOMES_EXTRAS)[number]): EstadoPainel => structuredClone(nome in ESTADOS ? ESTADOS[nome as keyof typeof ESTADOS] : EXTRAS[nome as (typeof NOMES_EXTRAS)[number]]);

test('previsao-precedencia: parar > pausa > todas > sem dados > eta; dd/mm marca outro dia', () => {
  // parar COM eta presente ⇒ parado (um ETA bonito nunca esconde o PAROU)
  const p = estado('parou-teto');
  assert.notEqual(p.plano.eta, null);
  assert.deepEqual(previsao(p), { tipo: 'parado' });
  // pausa COM eta ⇒ pausado
  const z = estado('pausado');
  assert.notEqual(z.plano.eta, null);
  assert.equal(z.parar, null);
  assert.deepEqual(previsao(z), { tipo: 'pausado' });
  // parar E pausa ⇒ parado (parar vem antes)
  const pz = estado('parou-teto');
  pz.parado = true;
  assert.deepEqual(previsao(pz), { tipo: 'parado' });
  // 12/12 ⇒ todas, mesmo com eta
  const t = estado('concluir-release');
  assert.notEqual(t.plano.eta, null);
  assert.deepEqual(previsao(t), { tipo: 'todas' });
  // 0/0 não é "todas"
  const v = estado('vazio');
  assert.deepEqual(previsao(v), { tipo: 'sem_dados' });
  // eta null com plano em andamento
  const s = estado('em-voo-7-12');
  s.plano.eta = null;
  assert.deepEqual(previsao(s), { tipo: 'sem_dados' });
  // eta presente: hora, n, ±min arredondado; sem barra ⇒ não é outro dia
  assert.deepEqual(previsao(estado('em-voo-7-12')), { tipo: 'eta', hora: '17:42', outroDia: false, maisMenosMin: 9, n: 7 });
  const arred = estado('em-voo-7-12');
  arred.plano.eta = { hora: '17:42', restanteS: 100, maisMenosS: 1_530, n: 3 };
  assert.deepEqual(previsao(arred), { tipo: 'eta', hora: '17:42', outroDia: false, maisMenosMin: 26, n: 3 }, '25,5 min ⇒ round 26');
  // dd/mm ⇒ outro dia
  assert.deepEqual(previsao(estado('eta-outro-dia')), { tipo: 'eta', hora: '10/11 09:00', outroDia: true, maisMenosMin: 9, n: 7 });
});

// ---------- estado da task ----------

test('estado-da-task: tabela T-E (texto e cor), no_teto é warning e nunca error, integrada sem texto', () => {
  const T: [EstadoTask, string, string][] = [
    ['pendente', 'fila', 'inactive'], ['implementando', 'implementando', 'success'], ['em_revisao', 'em revisão', 'success'],
    ['corrigindo', 'corrigindo', 'warning'], ['reprovada', 'reprovada', 'warning'], ['concluida', 'aguarda revisão', 'warning'],
    ['aprovada', 'aprovada', 'warning'], ['no_teto', 'no teto', 'warning'], ['integrada', '', 'success'],
  ];
  for (const [est, texto, cor] of T) {
    assert.equal(textoEstadoTask(est), texto, est);
    assert.equal(corEstadoTask(est), cor, est);
  }
  for (const lixo of [null, undefined, 'constructor', 'x'] as unknown as EstadoTask[]) {
    assert.equal(textoEstadoTask(lixo), '', String(lixo));
    assert.equal(corEstadoTask(lixo), 'inactive', String(lixo));
  }
});

test('texto-do-papel: implementador, correcao, revisor; nulo ou desconhecido é vazio', () => {
  assert.equal(textoDoPapel('implementador'), 'implementando');
  assert.equal(textoDoPapel('correcao'), 'corrigindo');
  assert.equal(textoDoPapel('revisor'), 'em revisão');
  assert.equal(textoDoPapel(null), '');
  assert.equal(textoDoPapel('toString' as never), '');
});

// ---------- faixa de ids ----------

test('faixa-ids-nao-contigua: 1 id, contíguos, buraco, fora do plano, desordem, repetido, vazio', () => {
  const PL = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  assert.equal(faixaIds([], PL), '');
  assert.equal(faixaIds(['T3'], PL), 'T3');
  assert.equal(faixaIds(['T2', 'T3'], PL), 'T2–T3', 'travessão de 1 coluna');
  assert.equal(faixaIds(['T2', 'T3', 'T4'], PL), 'T2–T4');
  assert.equal(faixaIds(['T4', 'T2', 'T3'], PL), 'T2–T4', 'ordem de entrada não importa');
  assert.equal(faixaIds(['T2', 'T4'], PL), '2 tasks', 'buraco');
  assert.equal(faixaIds(['T1', 'T2', 'T4'], PL), '3 tasks');
  assert.equal(faixaIds(['T2', 'T9'], PL), '2 tasks', 'id fora do plano nunca é contíguo');
  assert.equal(faixaIds(['T2', 'T2'], PL), 'T2', 'repetido conta 1');
  assert.equal(faixaIds(['T9'], PL), 'T9', 'um id só volta ele mesmo');
  assert.equal(faixaIds(['T9', 'T8'], PL), '2 tasks');
  assert.equal(faixaIds(['T9', 'T1'], PL), '2 tasks', 'fora do plano (índice -1) ao lado do 1º não forma faixa');
});

// ---------- alinhar e separador ----------

const seg = (texto: string, cor?: 'success'): Linha => [cor === undefined ? { texto } : { texto, cor }];

test('alinhar: cabe ⇒ dir encostada à direita, largura exata, segmentos e cores preservados', () => {
  const l = alinhar([{ texto: 'GABARITO · GM-12', cor: 'success' }, { texto: ' E4' }], [{ texto: 'executivo', cor: 'success' }], 40);
  assert.equal(LARG(l), 40);
  assert.equal(TEXTO(l), `GABARITO · GM-12 E4${' '.repeat(40 - 19 - 9)}executivo`);
  assert.deepEqual(l[0], { texto: 'GABARITO · GM-12', cor: 'success' });
  assert.deepEqual(l[l.length - 1], { texto: 'executivo', cor: 'success' });
  // 1 espaço no mínimo: justo
  assert.equal(TEXTO(alinhar(seg('aaaa'), seg('bbbb'), 9)), 'aaaa bbbb');
});

test('alinhar-corta-esquerda-antes: sem espaço a esq é cortada e a dir fica inteira; só depois a dir cai', () => {
  const esq: Linha = [{ texto: 'GABARITO · GM-12' }, { texto: ' um título bem comprido que não cabe' }];
  const dir = seg('esquadrão · terra média');
  const l = alinhar(esq, dir, 60);
  assert.equal(LARG(l), 60);
  assert.ok(TEXTO(l).endsWith('esquadrão · terra média'), TEXTO(l));
  assert.ok(TEXTO(l).startsWith('GABARITO · GM-12 um título'), TEXTO(l));
  assert.ok(TEXTO(l).includes('… '), 'a esq termina em reticências antes da dir');
  // aperto: o mínimo `GABARITO · GM-12` (16) + 1 + dir (23) = 40 ainda mantém a dir
  const aperto = alinhar(esq, dir, 40);
  assert.equal(TEXTO(aperto), 'GABARITO · GM-12 esquadrão · terra média');
  // abaixo do mínimo a dir cai INTEIRA (nunca meia dir) e a esq ocupa a linha
  const cai = alinhar(esq, dir, 39);
  assert.equal(TEXTO(cai).includes('esquadrão'), false);
  assert.equal(TEXTO(cai), TEXTO(cortarLinha(esq, 39)));
  assert.ok(LARG(cai) <= 39);
  // esq curta que cabe sozinha e dir que não cabe junto: sai SÓ a esq, sem nenhum pedaço da dir
  assert.equal(TEXTO(alinhar(seg('GABARITO · GM-12'), dir, 30)), 'GABARITO · GM-12');
  // sem 1 espaço de folga a dir não encosta na esq: 4 + 4 em 8 colunas deixa a dir cair
  assert.equal(TEXTO(alinhar(seg('aaaa'), seg('bbbb'), 8)), 'aaaa');
  // dir vazia: só a esq, cortada
  assert.equal(TEXTO(alinhar(esq, [], 20)), TEXTO(cortarLinha(esq, 20)));
});

test('alinhar: largura nunca passa, com texto largo (CJK) e para qualquer largura de 1 a 90', () => {
  const esq: Linha = [{ texto: 'GABARITO · 漢字漢字' }, { texto: ' 日本語のタイトルがとても長い' }];
  const dir = seg('executivo');
  for (let w = 1; w <= 90; w++) assert.ok(LARG(alinhar(esq, dir, w)) <= w, `w=${w}`);
  for (const w of [0, -1, NaN, Infinity, 3.5 - 4]) assert.deepEqual(alinhar(esq, dir, w), [], String(w));
});

test('separador: ─ × largura, sem cor; largura fracionária faz floor; inválida ⇒ vazio', () => {
  assert.deepEqual(separador(5), [{ texto: '─────' }]);
  assert.equal('cor' in separador(5)[0], false, 'sem cor');
  assert.deepEqual(separador(5.9), [{ texto: '─────' }]);
  assert.deepEqual(separador(1), [{ texto: '─' }]);
  for (const w of [0, -2, NaN, Infinity, 0.5]) assert.deepEqual(separador(w), [], String(w));
});

// ---------- equipe.vivos e ordem (D-R1, D-R2) ----------

const TM: PacoteNomes = { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['GIMLI', 'LEGOLAS', 'ARAGORN', 'BOROMIR', 'FRODO', 'SAM', 'MERRY', 'PIPPIN'] };
const PLANO: Plano = { entrega: 'GM-12', tasks: ['T07', 'T08', 'T09', 'T10'].map((id) => ({ id, deps: [], arquivos: [] })) };
const AGORA = Date.parse('2026-11-09T15:00:00.000Z');
let SEQ = 0;
function diario(...itens: [TipoEvento, Record<string, unknown>][]): Evento[] {
  SEQ = 0;
  return itens.map(([tipo, dados], i) => ({
    seq: ++SEQ, ts: new Date(Date.parse('2026-11-09T12:00:00.000Z') + i * 60_000).toISOString(), autor: 'dev@x', sessao: 's1', agente: 'orquestrador', tipo, dados, hash_anterior: null,
  }));
}
const ini = (task: string, papel: string): [TipoEvento, Record<string, unknown>] => ['task.iniciada', { task, papel }];
const concl = (task: string): [TipoEvento, Record<string, unknown>] => ['task.concluida', { task }];
const entrada = (extra: Partial<EntradaPainel> = {}): EntradaPainel => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: 36, tokens: 72_000, window: 200_000 }, limites: { h5: 42, d7: 18 }, x: 50,
  agentes: [], pacote: TM, notificacao: null, agoraMs: AGORA, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
  base: 'main', entregaId: 'GM-12', modeloSessao: 'claude-opus-4-8', specSha: null, tetoSombra: 26, ...extra,
});
const ag = (description: string): AgenteVivo => ({ id: `a-${description}`, type: 'general-purpose', description, status: 'running', uso: null });

test('vivos-null-sem-mod: agentes null ⇒ vivos null (não 0), com task em voo e sem nenhuma linha de agente', () => {
  const eq = projetarEquipe(PLANO, diario(ini('T07', 'implementador')), entrada({ agentes: null }));
  assert.equal(eq.vivos, null);
  assert.deepEqual(eq.agentes, [], 'sem mod, sem ◌');
  // mod presente e nenhum vivo ⇒ 0 (≠ null): `agentes —` e `0 vivos` são coisas distintas
  const zero = projetarEquipe(PLANO, [], entrada({ agentes: [] }));
  assert.equal(zero.vivos, 0);
  assert.notEqual(zero.vivos, eq.vivos);
});

test('vivos-conta-sem-task-nao-conta-sem-agente: vivo casado e vivo sem task contam; ◌ não', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'), ini('T09', 'implementador'), concl('T09'), ini('T09', 'revisor'));
  // T07: vivo; T08: ◌ (sem agente); T09 em revisão: ◌; um vivo que não casa com task nenhuma
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador'), ag('faz uma coisa qualquer')] }));
  assert.equal(eq.agentes.filter((a) => a.vivo).length, 2);
  assert.equal(eq.agentes.filter((a) => !a.vivo).length, 2, 'T08 e T09 sem agente');
  assert.equal(eq.agentes.some((a) => a.nome === null && a.papel === null && a.vivo), true, 'o sem task existe');
  assert.equal(eq.vivos, 2);
  // 1 vivo só: o ◌ não entra
  const um = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador')] }));
  assert.equal(um.vivos, 1);
  // agente que terminou (status ≠ running) não é vivo
  const fim = projetarEquipe(PLANO, eventos, entrada({ agentes: [{ ...ag('T07 implementador'), status: 'completed' }] }));
  assert.equal(fim.vivos, 0);
});

test('equipe-ordem-nao-depende-da-lista-do-mod: a mesma lista permutada dá deepEqual; ordem = task, papel, vivo antes de ◌, sem task no fim', () => {
  // T07 em correção (reprovada→corrigindo), T08 implementando, T09 em revisão, T10 implementando sem agente (◌)
  const eventos = diario(
    ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'), ['review.veredito', { task: 'T07', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }], ini('T07', 'correcao'),
    ini('T08', 'implementador'),
    ini('T09', 'implementador'), concl('T09'), ini('T09', 'revisor'),
    ini('T10', 'implementador'),
  );
  const lista = [ag('T09 revisor'), ag('T08 implementador'), ag('T07 correcao'), ag('coisa solta A'), ag('coisa solta B')];
  const base = projetarEquipe(PLANO, eventos, entrada({ agentes: lista }));
  assert.deepEqual(base.agentes.map((a) => `${a.task ?? '-'}:${a.papel ?? '-'}:${a.vivo ? 'v' : 'o'}`), [
    'T07:correcao:v', 'T08:implementador:v', 'T09:revisor:v', 'T10:implementador:o', '-:-:v', '-:-:v',
  ]);
  // permutações das 3 casadas (os sem task ficam na ordem de entrada: a regra é "na ordem de entrada", e é estável)
  const [a, b, c, d, f] = lista;
  for (const p of [[c, b, a, d, f], [b, a, c, d, f], [a, c, b, d, f], [c, a, b, d, f], [b, c, a, d, f]]) {
    assert.deepEqual(projetarEquipe(PLANO, eventos, entrada({ agentes: p })), base);
  }
  // os sem task mantêm a ordem de entrada
  const inv = projetarEquipe(PLANO, eventos, entrada({ agentes: [f, d, a, b, c] }));
  assert.equal(inv.agentes.length, base.agentes.length);
  assert.deepEqual(inv.agentes.slice(0, 4), base.agentes.slice(0, 4));
});

test('equipe-ordem-papel-e-vivo: na mesma task, implementador < correcao < revisor e vivo antes de ◌', () => {
  // T07 tem dois vivos de papéis diferentes (o 2º casado pela description); listados ao contrário
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 revisor'), ag('T07 correcao'), ag('T07 implementador')] }));
  assert.deepEqual(eq.agentes.filter((a) => a.task === 'T07').map((a) => a.papel), ['implementador', 'correcao', 'revisor']);
  // T08 implementando sem agente (◌) vem depois de todos da T07 (índice da task) e, entre dois de T07, o vivo antes
  assert.equal(eq.agentes[eq.agentes.length - 1].task, 'T08');
  assert.equal(eq.agentes[eq.agentes.length - 1].vivo, false);
  // por que `vivo antes de ◌` nunca desempata (E28): o ◌ só existe para o par (task, papel) SEM vivo casado, então um par nunca tem os dois
  const pares = eq.agentes.filter((a) => a.task !== undefined).map((a) => `${a.task}:${a.papel}`);
  assert.equal(new Set(pares).size, pares.length, 'nenhum par (task, papel) aparece duas vezes');
});

// ---------- costura (P9) ----------

test('costura-P9: o estado real de projetarPainel (src) alimenta as funções do dist (o artefato que o mod carrega) com o mesmo resultado, vivos incluído', async () => {
  const dist = (await import(join(AQUI, '..', 'dist', 'painel-formato.js'))) as typeof import('../src/painel-formato.ts');
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const real = projetarPainel(PLANO, eventos, entrada({ agentes: [ag('T08 implementador'), ag('lixo')] }));
  assert.equal(real.equipe.vivos, 2);
  assert.deepEqual(real.equipe.agentes.map((a) => [a.task, a.vivo]), [['T07', false], ['T08', true], [undefined, true]]);
  assert.deepEqual(dist.previsao(real), previsao(real));
  assert.equal(dist.fmtTok(412_600), fmtTok(412_600));
  assert.equal(dist.faixaIds(['T07', 'T08'], PLANO.tasks.map((t) => t.id)), 'T07–T08');
  const linha = dist.alinhar(seg('GABARITO · GM-12'), seg('executivo'), 40);
  assert.equal(TEXTO(linha), TEXTO(alinhar(seg('GABARITO · GM-12'), seg('executivo'), 40)));
  const semMod = projetarPainel(PLANO, eventos, entrada({ agentes: null }));
  assert.equal(semMod.equipe.vivos, null);
});

// ---------- fixtures (D-R5) ----------

test('fixtures-vivos: os 10 estados e os extras têm vivos coerente com agentes (null só sem mod)', () => {
  const todos: [string, EstadoPainel][] = [...Object.entries(ESTADOS), ...Object.entries(EXTRAS)];
  for (const [n, e] of todos) {
    if (n === 'sem-mod') { assert.equal(e.equipe.vivos, null, n); continue; }
    assert.equal(e.equipe.vivos, e.equipe.agentes.filter((a) => a.vivo).length, n);
  }
  assert.equal(ESTADOS['em-voo-7-12'].equipe.vivos, 2);
  assert.equal(ESTADOS['vazio'].equipe.vivos, 0);
  assert.equal(EXTRAS['sem-mod'].equipe.agentes.length, 0);
});

test('fixtures-corrigidas: frase da Sombra em planMode e política como a projeção escreve', () => {
  const sombra = ESTADOS['em-voo-7-12'].historico.find((h) => h.glifo === '◆');
  assert.equal(sombra?.cor, 'planMode');
  assert.equal(ESTADOS['em-voo-7-12'].rodape.politica, 'janela [seg ter qua qui sex]');
  assert.equal(ESTADOS['deploy-devolvido'].historico[0].cor, 'warning', 'o resto do histórico não mudou');
});

test('fixtures-extras: os 10 extras existem, em ordem, cada um com o que o nome promete', () => {
  assert.deepEqual([...NOMES_EXTRAS], ['sem-mod', 'sem-agente', 'sem-task', 'pct-so-tokens', 'eta-outro-dia', 'no-teto', 'titulos-hostis', 'numeros-corrompidos', 'historico-cheio', 'zeros']);
  assert.deepEqual(Object.keys(EXTRAS), [...NOMES_EXTRAS]);
  assert.equal(Object.keys(ESTADOS).length, 10, 'os 10 de T12 continuam 10');
  const e = EXTRAS;
  const sa = e['sem-agente'].equipe.agentes;
  assert.deepEqual([sa.length, sa[0].vivo, sa[0].estadoTask, sa[0].papel], [1, false, 'implementando', 'implementador']);
  assert.equal(e['sem-agente'].plano.tasks.find((t) => t.id === 'T8')?.glifo, '◐');
  const st = e['sem-task'].equipe.agentes.find((a) => a.papel === null);
  assert.deepEqual([st?.nome, st?.papel, st?.vivo, st?.task], [null, null, true, undefined]);
  const pt = e['pct-so-tokens'].equipe.agentes[0];
  assert.deepEqual([pt.ctxPct, pt.ctxTok], [null, 88_000]);
  assert.equal(e['eta-outro-dia'].plano.eta?.hora, '10/11 09:00');
  const nt = e['no-teto'].plano.tasks.find((t) => t.estado === 'no_teto');
  assert.deepEqual([nt?.id, nt?.glifo], ['T9', '✗']);
  const h = e['titulos-hostis'];
  assert.equal(h.id.length, 10);
  assert.equal(colunas(h.titulo ?? ''), 40, 'título de 40 colunas');
  assert.ok(/[\u4e00-\u9fff]/u.test(h.titulo ?? ''), 'CJK');
  assert.ok((h.titulo ?? '').includes('\u200d'), 'emoji ZWJ');
  assert.ok((h.titulo ?? '').includes('\x1b[2J'), 'sequência de escape');
  const nc = e['numeros-corrompidos'];
  const a0 = nc.equipe.agentes[0];
  assert.deepEqual([Number.isNaN(a0.ctxPct), a0.tok, a0.desdeS, Number.isNaN(nc.plano.pct)], [true, -1, Infinity, true]);
  const hc = e['historico-cheio'];
  assert.deepEqual([hc.historico.length, hc.ocultos], [20, 5]);
  assert.equal(hc.historico.filter((x) => /^\d\d\/\d\d \d\d:\d\d$/.test(x.hora)).length, 1);
  const z = e['zeros'];
  assert.deepEqual(
    [z.equipe.lider.h5, z.equipe.lider.tok, z.equipe.revisoresAguardando[0].mutacoesHoje, z.equipe.revisoresAguardando[0].mortasHoje, z.qualidade.mortas, z.rodape.ci.execucoesHoje, z.equipe.agentes[0].tok],
    [0, 0, 0, 0, 0, 0, 0],
  );
});

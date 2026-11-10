/**
 * Registro de decisões (GM-13 T11, REQ-REG-1): `montarRegistro` puro. Cada campo que entra no texto é lido por asserção que o troca.
 * MUTAÇÕES PRESCRITAS (task-11-mut.json): M-REG1 sem `ordenar` (ordem de chegada) · demais: uma por cláusula (seção, origem, controle, `- nenhum`, M com fonte e número).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarRegistro } from '../src/registro.ts';
import type { Evento } from '../src/tipos.ts';

const HASH = 'b'.repeat(64);
const SHA = 'a'.repeat(64);
const SHA2 = 'c'.repeat(64);
const ev = (sessao: string, seq: number, tipo: string, dados: unknown, ts: string): Evento =>
  ({ seq, ts, autor: 'a@x', sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null }) as unknown as Evento;
const t = (n: number): string => `2026-11-10T10:00:${String(n).padStart(2, '0')}.000Z`;

const APROVA = ev('loop', 1, 'spec.aprovada', { spec: 'docs/spec.md', sha256: SHA }, t(1));
const SOMBRA = ev('loop', 2, 'decisao.sombra', { pergunta_hash: HASH, req: 'REQ-REG-1', resposta: 'sim, determinístico', arquivo: 'sombra.md', pergunta_enviesada: false, fontes: ['a.md', 'b.md'] }, t(2));
const PROP = ev('emendas', 1, 'emenda.proposta', { req: 'REQ-APR-1', diff: 'troca X por Y', fato: 'X não existe', alternativa: 'nenhuma', evidencia: 'spike', causa: 'tecnica', task: 'T4' }, t(3));
const APROV_DONO = ev('dono', 1, 'spec.emendada', { proposta_seq: 1, origem: 'dono' }, t(4));
const PROP2 = ev('emendas', 2, 'emenda.proposta', { req: 'REQ-POU-1', diff: 'd2', fato: 'f2', alternativa: 'a2', evidencia: 'e2', causa: 'regra_negocio' }, t(5));
const REJ_SOMBRA = ev('loop', 3, 'emenda.rejeitada', { proposta_seq: 2, origem: 'sombra' }, t(6));
const TETO = ev('loop', 4, 'task.reaberta', { task: 'T7', origem: 'dono' }, t(7));
const RETOMADA = ev('loop', 5, 'task.reaberta', { task: 'T8', origem: 'retomada' }, t(8));
const DESVIO = ev('loop', 6, 'desvio', { task: 'T3', req: 'REQ-DIA-1', evidencia: 'o diário já canta', arquivos: ['a.ts', 'b.ts'], causa: 'tecnica' }, t(9));
const DESCOB = ev('loop', 7, 'descoberta', { evidencia: 'A5 é medido', causa: 'regra_negocio' }, t(10));
const APR_D = ev('loop', 8, 'aprendizado', { tipo: 'A', status: 'D', gatilho: { sessao: 'loop', seq: 6 }, evidencia: { eventos: [{ sessao: 'loop', seq: 6 }] }, regra: 'rode o build antes', entra_em: ['instantaneo', 'brief:revisor'] }, t(11));
const APR_M = ev('loop', 9, 'aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: { medicao: { fonte: 'docs/medida.md', numero: 4.5 } }, regra: 'suspeita medida', entra_em: ['spec'] }, t(12));
const TODOS = [APROVA, SOMBRA, PROP, APROV_DONO, PROP2, REJ_SOMBRA, TETO, RETOMADA, DESVIO, DESCOB, APR_D, APR_M];

const TITULOS = ['Aprovação da spec', 'Decisões da Sombra', 'Emendas', 'Liberações de teto', 'Desvios', 'Descobertas', 'Aprendizados D', 'Aprendizados M'];
/** Corpo (linhas) de uma seção, pelo título. */
const corpo = (r: string, titulo: string): string[] => {
  const i = r.indexOf(`## ${titulo}\n`);
  assert.ok(i >= 0, `seção ${titulo}`);
  const resto = r.slice(i + `## ${titulo}\n`.length).split('\n## ')[0];
  return resto.split('\n').filter((l) => l !== '');
};

describe('montarRegistro: determinismo e ordem', () => {
  test('registro-sem-relogio-nem-localidade: a fonte não lê relógio, localidade nem `Map` iterado sem ordem de origem (preso por teste)', () => {
    const fonte = readFileSync(new URL('../src/registro.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/Date\.now|new Date|toLocale|Intl\.|Math\.random|process\.|node:/.test(fonte), false);
  });

  test('registro-mesmo-diario-mesmo-byte: 2 rodadas, mesmo texto, sem relógio', () => {
    const a = montarRegistro('GM-13', TODOS, SHA);
    const b = montarRegistro('GM-13', TODOS, SHA);
    assert.equal(a, b);
    assert.equal(a.endsWith('\n'), true);
    assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}T/, 'nenhum instante de relógio no texto');
  });

  test('registro-ordem-de-chegada-nao-muda: sessões chegando em outra ordem dão o mesmo byte; a ordem interna é a de `ordenar` (ts entre sessões)', () => {
    const grupo = (s: string): Evento[] => TODOS.filter((e) => e.sessao === s);
    const base = montarRegistro('GM-13', TODOS, SHA);
    assert.equal(montarRegistro('GM-13', [...grupo('dono'), ...grupo('emendas'), ...grupo('loop')], SHA), base);
    assert.equal(montarRegistro('GM-13', [...grupo('emendas'), ...grupo('loop'), ...grupo('dono')], SHA), base);
    // `emendas` (ts 3 e 5) intercala com `loop` (ts 1, 2, 4, 6…): a proposta #1 vem antes da #2 pela ordem de `ordenar`, não pela de chegada
    const desc = (n: number, s: string, ts: number): Evento => ev(s, n, 'descoberta', { evidencia: `de ${s}`, causa: 'tecnica' }, t(ts));
    const a = [desc(1, 'zeta', 1), desc(2, 'zeta', 5), desc(1, 'alfa', 3)];
    const d = corpo(montarRegistro('GM-13', a, null), 'Descobertas');
    assert.deepEqual(d, ['- zeta:1 · tecnica · de zeta', '- alfa:1 · tecnica · de alfa', '- zeta:2 · tecnica · de zeta']);
  });

  test('registro-seq-invertido-na-sessao-lanca: a lista de trás para frente é diário fora de ordem, nunca um registro "arrumado"', () => {
    assert.throws(() => montarRegistro('GM-13', [...TODOS].reverse(), SHA), /fora de ordem/);
  });

  test('registro-diario-fora-de-ordem-lanca: seq repetido na sessão não vira registro', () => {
    assert.throws(() => montarRegistro('GM-13', [ev('loop', 1, 'descoberta', { evidencia: 'a', causa: 'tecnica' }, t(1)), ev('loop', 1, 'descoberta', { evidencia: 'b', causa: 'tecnica' }, t(2))], null), /fora de ordem/);
  });
});

describe('montarRegistro: seções', () => {
  const r = montarRegistro('GM-13', TODOS, SHA);

  test('registro-secoes-fixas-na-ordem: cabeçalho da entrega e os 8 títulos, nesta ordem', () => {
    assert.match(r, /^# Registro de decisões — GM-13\n/);
    const achados = [...r.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(achados, TITULOS);
  });

  test('registro-secoes-vazias: diário vazio ⇒ cada seção é `- nenhum`', () => {
    const v = montarRegistro('GM-13', [], null);
    for (const titulo of TITULOS) assert.deepEqual(corpo(v, titulo), ['- nenhum'], titulo);
  });

  test('registro-secao-so-recebe-o-que-e-dela: sem desvio, só Desvios fica vazia', () => {
    const sem = montarRegistro('GM-13', TODOS.filter((e) => e.tipo !== 'desvio'), SHA);
    assert.deepEqual(corpo(sem, 'Desvios'), ['- nenhum']);
    assert.notDeepEqual(corpo(sem, 'Descobertas'), ['- nenhum']);
  });

  test('registro-aprovacao-da-spec: caminho, sha256 aprovado e se o atual confere', () => {
    const l = corpo(r, 'Aprovação da spec');
    assert.equal(l[0], `- loop:1 · spec docs/spec.md · sha256 ${SHA}`);
    assert.equal(l[1], `- sha256 atual da spec: ${SHA} (confere com a última aprovação)`);
    assert.match(corpo(montarRegistro('GM-13', TODOS, SHA2), 'Aprovação da spec')[1], new RegExp(`${SHA2} \\(difere da última aprovação\\)`));
    assert.equal(corpo(montarRegistro('GM-13', TODOS, null), 'Aprovação da spec')[1], '- sha256 atual da spec: indisponível');
  });

  test('registro-decisoes-da-sombra: âncora, resposta curta, fontes e medição', () => {
    const l = corpo(r, 'Decisões da Sombra');
    assert.equal(l.length, 1);
    assert.equal(l[0], '- loop:2 · REQ-REG-1 · sim, determinístico · fontes: a.md, b.md');
    const d = ev('loop', 2, 'decisao.sombra', { pergunta_hash: HASH, task: 'T9', resposta: 'x'.repeat(500), arquivo: 'a.md', pergunta_enviesada: false, medicao: 'ls | wc -l = 7' }, t(2));
    const l2 = corpo(montarRegistro('GM-13', [d], null), 'Decisões da Sombra')[0];
    assert.match(l2, /^- loop:2 · task T9 · x{240}… · medição: ls \| wc -l = 7$/, 'resposta curta: 240 caracteres e reticências');
  });

  test('registro-dono-e-sombra-julgaram: cada emenda diz quem julgou (origem) e se aprovou ou rejeitou', () => {
    const l = corpo(r, 'Emendas');
    assert.equal(l.length, 2);
    assert.equal(l[0], '- #1 · REQ-APR-1 · task T4 · tecnica · aprovada por dono · fato: X não existe · diff: troca X por Y');
    assert.equal(l[1], '- #2 · REQ-POU-1 · regra_negocio · rejeitada por sombra · fato: f2 · diff: d2');
    const troca = montarRegistro('GM-13', [PROP, ev('dono', 1, 'spec.emendada', { proposta_seq: 1, origem: 'sombra' }, t(4))], null);
    assert.match(corpo(troca, 'Emendas')[0], /aprovada por sombra/);
    assert.match(corpo(montarRegistro('GM-13', [PROP], null), 'Emendas')[0], /· aberta ·/);
  });

  test('registro-primeiro-julgamento-fecha: dois julgamentos da mesma proposta, vale o 1º na ordem do diário (a Sombra não desfaz o dono)', () => {
    const depois = ev('loop', 3, 'emenda.rejeitada', { proposta_seq: 1, origem: 'sombra' }, t(9));
    const l = corpo(montarRegistro('GM-13', [PROP, APROV_DONO, depois], null), 'Emendas');
    assert.equal(l.length, 1);
    assert.match(l[0], /· aprovada por dono ·/);
  });

  test('registro-emenda-julgamento-sem-proposta: não some calado', () => {
    const l = corpo(montarRegistro('GM-13', [APROV_DONO], null), 'Emendas');
    assert.equal(l[0], '- #1 · julgamento sem proposta no diário · aprovada por dono');
  });

  test('registro-liberacao-de-teto: só `task.reaberta` do dono; a retomada não é liberação', () => {
    assert.deepEqual(corpo(r, 'Liberações de teto'), ['- loop:4 · task T7 · liberada pelo dono']);
    assert.deepEqual(corpo(montarRegistro('GM-13', [RETOMADA], null), 'Liberações de teto'), ['- nenhum']);
  });

  test('registro-desvios-e-descobertas: task, REQ, causa, evidência e arquivos lidos', () => {
    assert.deepEqual(corpo(r, 'Desvios'), ['- loop:6 · task T3 · REQ-DIA-1 · tecnica · o diário já canta · arquivos: a.ts, b.ts']);
    assert.deepEqual(corpo(r, 'Descobertas'), ['- loop:7 · regra_negocio · A5 é medido']);
  });

  test('registro-m-com-fonte-e-numero: M mostra a fonte e o número; D mostra os eventos; D e M não se misturam', () => {
    assert.deepEqual(corpo(r, 'Aprendizados M'), ['- loop:9 · E · suspeita medida · entra em: spec · fonte: docs/medida.md · número: 4.5']);
    assert.deepEqual(corpo(r, 'Aprendizados D'), ['- loop:8 · A · rode o build antes · entra em: instantaneo, brief:revisor · sem medição · eventos: loop:6 · gatilho: loop:6']);
    const sub = ev('loop', 10, 'aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: {}, regra: 'nova', entra_em: ['spec'], substitui: { sessao: 'loop', seq: 9, entrega: 'GM-12' } }, t(13));
    assert.match(corpo(montarRegistro('GM-13', [APR_M, sub], null), 'Aprendizados M')[1], /· sem medição · substitui GM-12\/loop:9$/);
  });
});

describe('montarRegistro: texto limpo e falha fechada', () => {
  test('registro-texto-sem-controle: quebra de linha, tabulação e NUL do diário viram espaço; nenhuma linha extra nasce', () => {
    const d = ev('loop', 1, 'descoberta', { evidencia: 'linha1\n## Desvios\r\n\tlinha2\u0000fim\u2028x', causa: 'tecnica' }, t(1));
    const r = montarRegistro('GM-13', [d], null);
    assert.doesNotMatch(r, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
    assert.deepEqual(corpo(r, 'Descobertas'), ['- loop:1 · tecnica · linha1 ## Desvios linha2 fim x']);
    assert.equal([...r.matchAll(/^## Desvios$/gm)].length, 1, 'o `## Desvios` digitado não virou seção');
  });

  test('registro-evento-fora-da-forma-lanca: decisão sem fonte e desvio sem REQ não viram registro sem a linha', () => {
    const ruim = ev('loop', 2, 'decisao.sombra', { pergunta_hash: HASH, req: 'REQ-REG-1', resposta: 'x', arquivo: 'a.md', pergunta_enviesada: false }, t(2));
    assert.throws(() => montarRegistro('GM-13', [ruim], null), /não tem a forma do contrato/);
    assert.throws(() => montarRegistro('GM-13', [ev('loop', 1, 'desvio', { task: 'T1' }, t(1))], null), /não tem a forma do contrato/);
    assert.throws(() => montarRegistro('GM-13', [ev('loop', 1, 'task.reaberta', { origem: 'dono' }, t(1))], null), /sem `task`/);
  });

  test('registro-nao-lista-evento-de-outro-tipo: o que não é decisão não entra', () => {
    const v = montarRegistro('GM-13', [ev('loop', 1, 'ci.resultado', { verde: true }, t(1)), ev('dono', 1, 'dono.mensagem', { sha256: SHA, chars: 3 }, t(2))], null);
    for (const titulo of TITULOS) assert.deepEqual(corpo(v, titulo), ['- nenhum'], titulo);
  });
});

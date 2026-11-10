/**
 * Núcleo do aprendizado (GM-13 T2, REQ-APR-1/3): existência das referências, vigentes, destino, leitura da árvore.
 * MUTAÇÕES PRESCRITAS: M-APR1a `aprendizadosVigentes` aceita forma inválida ⇒ `vigentes-forma-invalida-ignorada`.
 * Demais (task-2-mut.json): gatilho/evento/fonte/substitui sem checagem, M entra em destino, destino por prefixo,
 * ciclo trava, ordem por ts, avisos calados.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aprendizadosVigentes, paraDestino, validarAprendizado } from '../src/aprendizado.ts';
import type { AprendizadoVigente } from '../src/aprendizado.ts';
import { append, lerAprendizados } from '../src/diario.ts';
import type { DadosAprendizado, Evento } from '../src/tipos.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'gm-aprend-'));
const dado = (extra: Partial<DadosAprendizado> = {}): DadosAprendizado => ({
  tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] },
  regra: 'rode o build antes do teste', entra_em: ['instantaneo'], ...extra,
});
const ev = (sessao: string, seq: number, tipo: string, dados: unknown, ts = '2026-11-10T10:00:00.000Z'): Evento =>
  ({ seq, ts, autor: 'a@x', sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null }) as unknown as Evento;
const apr = (sessao: string, seq: number, extra: Partial<DadosAprendizado> = {}, ts?: string): Evento => ev(sessao, seq, 'aprendizado', dado(extra), ts);
const loop1 = ev('loop', 1, 'loop.iniciar', {});
const mapa = (o: Record<string, Evento[]>): Map<string, Evento[]> => new Map(Object.entries(o));

describe('validarAprendizado', () => {
  const eventos = [loop1, ev('loop', 2, 'review.resultado', {}), apr('loop', 3)];
  test('validar-ok-devolve-null', () => {
    assert.equal(validarAprendizado(eventos, dado({ gatilho: { sessao: 'loop', seq: 2 } }), 'GM-1', mapa({ 'GM-1': eventos })), null);
  });
  test('validar-gatilho-inexistente', () => {
    const r = validarAprendizado(eventos, dado({ gatilho: { sessao: 'loop', seq: 99 } }), 'GM-1', mapa({}));
    assert.match(r ?? '', /^gatilho_inexistente: .*loop:99/);
    // sessão certa, seq errada e seq certa, sessão errada: os dois são inexistentes
    assert.match(validarAprendizado(eventos, dado({ gatilho: { sessao: 'outra', seq: 2 } }), 'GM-1', mapa({})) ?? '', /^gatilho_inexistente/);
  });
  test('validar-evento-evidencia-inexistente', () => {
    const r = validarAprendizado(eventos, dado({ evidencia: { eventos: [{ sessao: 'loop', seq: 1 }, { sessao: 'loop', seq: 42 }] } }), 'GM-1', mapa({}));
    assert.match(r ?? '', /^evento_inexistente: .*loop:42/);
  });
  test('validar-evento-fonte-inexistente', () => {
    const med = (fonte: string): DadosAprendizado => dado({ evidencia: { medicao: { fonte, numero: 3 } } });
    assert.equal(validarAprendizado(eventos, med('evento:loop:2'), 'GM-1', mapa({})), null);
    assert.match(validarAprendizado(eventos, med('evento:loop:77'), 'GM-1', mapa({})) ?? '', /^evento_inexistente: .*evento:loop:77/);
    assert.match(validarAprendizado(eventos, med('evento:nada:2'), 'GM-1', mapa({})) ?? '', /^evento_inexistente/);
    // fonte que não é evento: (arquivo relativo) não é procurada no diário
    assert.equal(validarAprendizado(eventos, med('docs/medicao.md'), 'GM-1', mapa({})), null);
  });
  test('validar-fonte-malformada-recusada-pela-forma', () => {
    // `evento:` fora da forma estrita é recusada por `formaInvalida` ANTES da busca (o ramo `m === null` é defesa em profundidade, inalcançável)
    for (const fonte of ['evento:loop', 'evento:loop:', 'evento:loop:2:3', 'evento::2']) {
      const r = validarAprendizado(eventos, dado({ evidencia: { medicao: { fonte, numero: 3 } } }), 'GM-1', mapa({}));
      assert.match(r ?? '', /^aprendizado: .*fonte/, fonte);
    }
  });
  test('validar-substitui-usa-eventos-da-entrega-nao-o-mapa', () => {
    // o mapa traz a entrega corrente defasada (sem o alvo); vale `eventosDaEntrega`
    const subs = { sessao: 'loop', seq: 3 };
    assert.equal(validarAprendizado(eventos, dado({ substitui: subs }), 'GM-1', mapa({ 'GM-1': [loop1] })), null);
    assert.equal(validarAprendizado(eventos, dado({ substitui: { ...subs, entrega: 'GM-1' } }), 'GM-1', mapa({ 'GM-1': [loop1] })), null);
  });
  test('validar-getter-que-falha-depois-da-forma-nao-vira-sucesso', () => {
    // 1º acesso (a forma) devolve valor válido, o 2º lança: o resultado nunca é `null`
    const dados = dado();
    let n = 0;
    Object.defineProperty(dados, 'gatilho', { get() { n++; if (n > 1) throw new Error('boom'); return null; }, enumerable: true });
    const r = validarAprendizado(eventos, dados, 'GM-1', mapa({}));
    assert.match(r ?? '', /^aprendizado: dados corrompido .*boom/);
  });
  test('validar-substitui-inexistente', () => {
    const subs = (s: DadosAprendizado['substitui']): string | null => validarAprendizado(eventos, dado({ substitui: s }), 'GM-1', mapa({ 'GM-1': eventos }));
    assert.equal(subs({ sessao: 'loop', seq: 3 }), null);
    assert.match(subs({ sessao: 'loop', seq: 9 }) ?? '', /^substitui_inexistente/);
    // alvo existe mas não é aprendizado
    assert.match(subs({ sessao: 'loop', seq: 2 }) ?? '', /^substitui_inexistente/);
    // alvo é um aprendizado de forma inválida
    const torto = [loop1, ev('loop', 2, 'aprendizado', { tipo: 'X' })];
    assert.match(validarAprendizado(torto, dado({ substitui: { sessao: 'loop', seq: 2 } }), 'GM-1', mapa({})) ?? '', /^substitui_inexistente/);
  });
  test('substitui-entre-entregas', () => {
    const outra = [loop1, apr('loop', 2)];
    const subs = { sessao: 'loop', seq: 2, entrega: 'GM-2' };
    assert.equal(validarAprendizado(eventos, dado({ substitui: subs }), 'GM-1', mapa({ 'GM-2': outra })), null);
    // a entrega citada não está no mapa, ou o alvo só existe na entrega corrente
    assert.match(validarAprendizado(eventos, dado({ substitui: subs }), 'GM-1', mapa({})) ?? '', /^substitui_inexistente: .*GM-2/);
    assert.match(validarAprendizado(eventos, dado({ substitui: { sessao: 'loop', seq: 3, entrega: 'GM-2' } }), 'GM-1', mapa({ 'GM-2': outra, 'GM-1': eventos })) ?? '', /^substitui_inexistente/);
  });
  test('validar-forma-invalida-e-ausente-x-corrompido', () => {
    assert.match(validarAprendizado(eventos, undefined as unknown as DadosAprendizado, 'GM-1', mapa({})) ?? '', /dados ausente/);
    assert.match(validarAprendizado(eventos, 'texto' as unknown as DadosAprendizado, 'GM-1', mapa({})) ?? '', /dados corrompido/);
    assert.match(validarAprendizado(eventos, dado({ regra: '' }), 'GM-1', mapa({})) ?? '', /regra/);
  });
  test('validar-getter-hostil-nao-lanca', () => {
    const hostil = dado();
    Object.defineProperty(hostil, 'gatilho', { get() { throw new Error('boom'); }, enumerable: true });
    assert.notEqual(validarAprendizado(eventos, hostil, 'GM-1', mapa({})), null);
  });
});

describe('aprendizadosVigentes', () => {
  test('vigentes-le-todos-os-campos', () => {
    const v = aprendizadosVigentes(mapa({ 'GM-1': [loop1, apr('loop', 2, { tipo: 'A', regra: 'regra x', entra_em: ['spec', 'brief:revisor'] }, '2026-11-10T11:00:00.000Z')] }));
    assert.equal(v.length, 1);
    assert.deepEqual(v[0], {
      tipo: 'A', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] },
      regra: 'regra x', entra_em: ['spec', 'brief:revisor'], entrega: 'GM-1', sessao: 'loop', seq: 2, ts: '2026-11-10T11:00:00.000Z',
    });
  });
  test('vigentes-forma-invalida-ignorada', () => {
    const v = aprendizadosVigentes(mapa({ 'GM-1': [
      loop1,
      ev('loop', 2, 'aprendizado', { ...dado(), tipo: 'X' }),
      ev('loop', 3, 'aprendizado', undefined),
      ev('loop', 4, 'aprendizado', 'lixo'),
      ev('loop', 5, 'loop.iniciar', dado()), // outro tipo com dados de aprendizado
      apr('loop', 6),
    ] }));
    assert.deepEqual(v.map((x) => x.seq), [6]);
  });
  test('vigentes-envelope-invalido-ignorado', () => {
    const quebrado = { ...apr('loop', 2), ts: 123 } as unknown as Evento;
    const semSeq = { ...apr('loop', 3), seq: 'x' } as unknown as Evento;
    assert.deepEqual(aprendizadosVigentes(mapa({ 'GM-1': [quebrado, semSeq, null as unknown as Evento, apr('loop', 4)] })).map((x) => x.seq), [4]);
  });
  test('vigentes-substituido-sai', () => {
    const v = aprendizadosVigentes(mapa({ 'GM-1': [loop1, apr('loop', 2), apr('loop', 3, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T11:00:00.000Z')] }));
    assert.deepEqual(v.map((x) => x.seq), [3]);
  });
  test('vigentes-cadeia-tres-so-o-ultimo', () => {
    const v = aprendizadosVigentes(mapa({ 'GM-1': [
      loop1, apr('loop', 2), apr('loop', 3, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T11:00:00.000Z'),
      apr('loop', 4, { substitui: { sessao: 'loop', seq: 3 } }, '2026-11-10T12:00:00.000Z'),
    ] }));
    assert.deepEqual(v.map((x) => x.seq), [4]);
  });
  test('vigentes-substitui-alvo-ausente-nao-some-nada', () => {
    const v = aprendizadosVigentes(mapa({ 'GM-1': [apr('loop', 2, { substitui: { sessao: 'loop', seq: 77 } })] }));
    assert.deepEqual(v.map((x) => x.seq), [2]);
  });
  test('substitui-ciclo-termina', () => {
    // 2 e 3 se substituem; o mais recente (3) vale, o outro sai
    const v = aprendizadosVigentes(mapa({ 'GM-1': [
      loop1,
      apr('loop', 2, { substitui: { sessao: 'loop', seq: 3 } }, '2026-11-10T10:00:00.000Z'),
      apr('loop', 3, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T11:00:00.000Z'),
    ] }));
    assert.deepEqual(v.map((x) => x.seq), [3]);
    // inverso no tempo: vale o 2
    const w = aprendizadosVigentes(mapa({ 'GM-1': [
      loop1,
      apr('loop', 2, { substitui: { sessao: 'loop', seq: 3 } }, '2026-11-10T12:00:00.000Z'),
      apr('loop', 3, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T11:00:00.000Z'),
    ] }));
    assert.deepEqual(w.map((x) => x.seq), [2]);
  });
  test('substitui-auto-referencia-nao-some', () => {
    const v = aprendizadosVigentes(mapa({ 'GM-1': [apr('loop', 2, { substitui: { sessao: 'loop', seq: 2 } })] }));
    assert.deepEqual(v.map((x) => x.seq), [2]);
  });
  test('substitui-ciclo-de-tres-com-rabo', () => {
    // 2→3→4→2 e 5 substitui 2; 5 (o mais novo) fica fora do ciclo e tira o 2; o ciclo perde a aresta que aponta para o mais novo dele (4); sobram 5 e 4
    const v = aprendizadosVigentes(mapa({ 'GM-1': [
      loop1,
      apr('loop', 2, { substitui: { sessao: 'loop', seq: 3 } }, '2026-11-10T10:00:00.000Z'),
      apr('loop', 3, { substitui: { sessao: 'loop', seq: 4 } }, '2026-11-10T10:01:00.000Z'),
      apr('loop', 4, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T10:02:00.000Z'),
      apr('loop', 5, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T10:03:00.000Z'),
    ] }));
    assert.deepEqual(v.map((x) => x.seq), [5, 4]);
  });
  test('substitui-entre-entregas-projecao', () => {
    const v = aprendizadosVigentes(mapa({
      'GM-1': [loop1, apr('loop', 2, {}, '2026-11-10T10:00:00.000Z')],
      'GM-2': [loop1, apr('loop', 2, { substitui: { sessao: 'loop', seq: 2, entrega: 'GM-1' } }, '2026-11-10T11:00:00.000Z')],
    }));
    assert.deepEqual(v.map((x) => `${x.entrega}:${x.seq}`), ['GM-2:2']);
    // mesma (sessao, seq) na entrega corrente NÃO é o alvo: sem `entrega` vale a corrente
    const w = aprendizadosVigentes(mapa({
      'GM-1': [loop1, apr('loop', 2, {}, '2026-11-10T10:00:00.000Z')],
      'GM-2': [loop1, apr('loop', 2, {}, '2026-11-10T11:00:00.000Z'), apr('loop', 3, { substitui: { sessao: 'loop', seq: 2 } }, '2026-11-10T12:00:00.000Z')],
    }));
    assert.deepEqual(w.map((x) => `${x.entrega}:${x.seq}`).sort(), ['GM-1:2', 'GM-2:3']);
  });
  test('vigente-mais-recente-por-ts-entrega', () => {
    const v = aprendizadosVigentes(mapa({
      'GM-1': [apr('loop', 1, {}, '2026-11-10T10:00:00.000Z'), apr('loop', 2, {}, '2026-11-10T12:00:00.000Z')],
      'GM-2': [apr('loop', 1, {}, '2026-11-10T12:00:00.000Z'), apr('s2', 1, {}, '2026-11-10T11:00:00.000Z')],
    }));
    // ts desc; empate de ts desempata por entrega desc, depois sessao desc, seq desc
    assert.deepEqual(v.map((x) => `${x.entrega}:${x.sessao}:${x.seq}`), ['GM-2:loop:1', 'GM-1:loop:2', 'GM-2:s2:1', 'GM-1:loop:1']);
    const mesmo = aprendizadosVigentes(mapa({ 'GM-1': [apr('loop', 1), apr('loop', 2), apr('s9', 1)] }));
    assert.deepEqual(mesmo.map((x) => `${x.sessao}:${x.seq}`), ['s9:1', 'loop:2', 'loop:1']);
  });
  test('vigentes-ausente-x-vazio', () => {
    assert.deepEqual(aprendizadosVigentes(new Map()), []);
    assert.deepEqual(aprendizadosVigentes(mapa({ 'GM-1': [] })), []);
    assert.deepEqual(aprendizadosVigentes(mapa({ 'GM-1': undefined as unknown as Evento[] })), []);
  });
});

describe('paraDestino', () => {
  const v = (extra: Partial<DadosAprendizado>, seq: number): AprendizadoVigente => ({ ...dado(extra), entrega: 'GM-1', sessao: 'loop', seq, ts: '2026-11-10T10:00:00.000Z' });
  test('para-destino-nunca-m', () => {
    const lista = [v({ status: 'M', evidencia: {}, entra_em: ['brief:revisor', 'instantaneo'] }, 1), v({ status: 'D', entra_em: ['brief:revisor'] }, 2)];
    assert.deepEqual(paraDestino(lista, 'brief:revisor').map((x) => x.seq), [2]);
    assert.deepEqual(paraDestino(lista, 'instantaneo').map((x) => x.seq), []);
  });
  test('para-destino-papel-exato', () => {
    const lista = [v({ entra_em: ['brief:revisor'] }, 1), v({ entra_em: ['brief:implementador', 'spec'] }, 2), v({ entra_em: ['brief:correcao'] }, 3)];
    assert.deepEqual(paraDestino(lista, 'brief:implementador').map((x) => x.seq), [2]);
    assert.deepEqual(paraDestino(lista, 'brief:revisor').map((x) => x.seq), [1]);
    assert.deepEqual(paraDestino(lista, 'brief').map((x) => x.seq), []);
    assert.deepEqual(paraDestino(lista, 'spec').map((x) => x.seq), [2]);
  });
  test('para-destino-preserva-ordem', () => {
    const lista = [v({}, 3), v({}, 1), v({}, 2)];
    assert.deepEqual(paraDestino(lista, 'instantaneo').map((x) => x.seq), [3, 1, 2]);
  });
});

describe('lerAprendizados (árvore real)', () => {
  const grava = (raiz: string, entrega: string, sessao: string, tipo: Evento['tipo'], dados: Record<string, unknown>, ts = '2026-11-10T10:00:00.000Z'): void => {
    const r = append(join(raiz, entrega), sessao, { ts, autor: 'a@x', sessao, agente: 'orquestrador', tipo, dados });
    assert.equal(r.ok, true, JSON.stringify(r));
  };
  test('ler-aprendizados-ausente-x-corrompido', () => {
    const raiz = tmp();
    // ausente: mapa vazio, sem aviso
    assert.deepEqual(lerAprendizados(join(raiz, 'nao-existe')), { porEntrega: new Map(), avisos: [] });
    // pasta existe e está vazia: também vazio sem aviso
    const vazia = join(raiz, 'vazia'); mkdirSync(vazia);
    assert.deepEqual(lerAprendizados(vazia), { porEntrega: new Map(), avisos: [] });
    // corrompido: a árvore é um arquivo, não pasta ⇒ aviso, nunca lança
    const arq = join(raiz, 'arquivo'); writeFileSync(arq, 'x');
    const r = lerAprendizados(arq);
    assert.equal(r.porEntrega.size, 0);
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /^aprendizados: .*arquivo ilegível/);
  });
  test('vigentes-outra-entrega-corrompida-avisa', () => {
    const raiz = tmp();
    grava(raiz, 'GM-1', 'loop', 'loop.iniciar', {});
    grava(raiz, 'GM-1', 'loop', 'aprendizado', dado({ gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] } }) as unknown as Record<string, unknown>);
    // GM-2: linha torta (JSON inválido)
    mkdirSync(join(raiz, 'GM-2'));
    writeFileSync(join(raiz, 'GM-2', 'events.loop.jsonl'), 'isto não é json\n');
    // GM-3: cadeia quebrada (hash_anterior errado na 2ª linha)
    grava(raiz, 'GM-3', 'loop', 'loop.iniciar', {});
    const f3 = join(raiz, 'GM-3', 'events.loop.jsonl');
    const l3 = readFileSync(f3, 'utf8').trimEnd();
    writeFileSync(f3, `${l3}\n${JSON.stringify({ seq: 2, ts: '2026-11-10T10:00:00.000Z', autor: 'a@x', sessao: 'loop', agente: 'o', tipo: 'loop.iniciar', dados: {}, hash_anterior: 'deadbeef' })}\n`);
    const { porEntrega, avisos } = lerAprendizados(raiz);
    assert.deepEqual([...porEntrega.keys()], ['GM-1']);
    assert.deepEqual(avisos.map((a) => a.replace(/\(.*\)/, '(…)')), ['aprendizados: GM-2 ilegível (…)', 'aprendizados: GM-3 ilegível (…)']);
    assert.match(avisos[0], /linha 1 ilegível em events\.loop\.jsonl/);
    assert.match(avisos[1], /hash_anterior não confere/);
    // a projeção da entrega corrente segue
    assert.deepEqual(aprendizadosVigentes(porEntrega).map((x) => `${x.entrega}:${x.seq}`), ['GM-1:2']);
  });
  test('ler-aprendizados-ordem-estavel-por-nome', () => {
    const raiz = tmp();
    const nomes = Array.from({ length: 40 }, (_, i) => `GM-${(i * 7919) % 97 + 100}`);
    for (const n of nomes) { mkdirSync(join(raiz, n)); writeFileSync(join(raiz, n, 'events.loop.jsonl'), 'torto\n'); }
    const { avisos } = lerAprendizados(raiz);
    const ordenado = [...nomes].sort().map((n) => `aprendizados: ${n} ilegível (linha 1 ilegível em events.loop.jsonl)`);
    assert.deepEqual(avisos, ordenado);
  });
  test('arvore-ignora-arquivo-solto-e-le-varias-sessoes', () => {
    const raiz = tmp();
    writeFileSync(join(raiz, 'README.md'), 'solto');
    grava(raiz, 'GM-1', 'loop', 'loop.iniciar', {});
    grava(raiz, 'GM-1', 's2', 'loop.iniciar', {});
    const { porEntrega, avisos } = lerAprendizados(raiz);
    assert.deepEqual(avisos, []);
    assert.deepEqual([...porEntrega.keys()], ['GM-1']);
    assert.deepEqual((porEntrega.get('GM-1') as Evento[]).map((e) => e.sessao).sort(), ['loop', 's2']);
  });
  test('costura-append-real-ler-validar-vigentes-destino', () => {
    // P9: diário gravado pelo `append` real (que chama formaInvalida) → leitura da árvore → validar → vigentes → paraDestino
    const raiz = tmp();
    grava(raiz, 'GM-1', 'loop', 'loop.iniciar', {});
    const d1 = dado({ entra_em: ['instantaneo', 'brief:revisor'] });
    const lido1 = lerAprendizados(raiz);
    assert.equal(validarAprendizado(lido1.porEntrega.get('GM-1') as Evento[], d1, 'GM-1', lido1.porEntrega), null);
    grava(raiz, 'GM-1', 'loop', 'aprendizado', d1 as unknown as Record<string, unknown>, '2026-11-10T10:00:00.000Z');
    const d2 = dado({ regra: 'regra nova', entra_em: ['instantaneo'], substitui: { sessao: 'loop', seq: 2 } });
    const lido2 = lerAprendizados(raiz);
    assert.equal(validarAprendizado(lido2.porEntrega.get('GM-1') as Evento[], d2, 'GM-1', lido2.porEntrega), null);
    grava(raiz, 'GM-1', 'loop', 'aprendizado', d2 as unknown as Record<string, unknown>, '2026-11-10T11:00:00.000Z');
    const { porEntrega, avisos } = lerAprendizados(raiz);
    assert.deepEqual(avisos, []);
    const vig = aprendizadosVigentes(porEntrega);
    assert.deepEqual(vig.map((x) => [x.seq, x.regra]), [[3, 'regra nova']]);
    assert.deepEqual(paraDestino(vig, 'instantaneo').map((x) => x.seq), [3]);
    assert.deepEqual(paraDestino(vig, 'brief:revisor'), []);
  });
  test('ler-aprendizados-sem-permissao-avisa-nao-lanca', { skip: process.getuid?.() === 0 }, () => {
    const raiz = tmp();
    grava(raiz, 'GM-1', 'loop', 'loop.iniciar', {});
    chmodSync(join(raiz, 'GM-1'), 0o000);
    try {
      const r = lerAprendizados(raiz);
      assert.equal(r.porEntrega.size, 0);
      assert.match(r.avisos[0] ?? '', /^aprendizados: GM-1 ilegível \(pasta do diário ilegível\)/);
    } finally { chmodSync(join(raiz, 'GM-1'), 0o755); }
  });
});

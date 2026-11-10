/**
 * Núcleo do aprendizado (GM-13 T2, REQ-APR-1/3): existência das referências, vigentes, destino, leitura da árvore.
 * MUTAÇÕES PRESCRITAS: M-APR1a `aprendizadosVigentes` aceita forma inválida ⇒ `vigentes-forma-invalida-ignorada`.
 * Demais (task-2-mut.json): gatilho/evento/fonte/substitui sem checagem, M entra em destino, destino por prefixo,
 * ciclo trava, ordem por ts, avisos calados.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aprendizadosVigentes, avisosAprendizado, paraDestino, validarAprendizado } from '../src/aprendizado.ts';
import type { AprendizadoVigente } from '../src/aprendizado.ts';
import { append, lerAprendizados } from '../src/diario.ts';
import { PAPEIS as PAPEIS_REAIS } from '../src/formas.ts';
import type { DadosAprendizado, Evento, Plano } from '../src/tipos.ts';

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
  test('validar-grava-estrito-papel-desconhecido-recusado: a gravação não herda a tolerância do doctor', () => {
    for (const entra of [['brief:arquitetura'], ['instantaneo', 'brief:arquitetura']]) {
      const r = validarAprendizado(eventos, dado({ entra_em: entra }), 'GM-1', mapa({}));
      assert.match(r ?? '', /entra_em/, entra.join(','));
    }
    assert.equal(validarAprendizado(eventos, dado({ entra_em: ['brief:revisor'] }), 'GM-1', mapa({})), null);
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
  test('validar-substitui-alvo-com-papel-removido: o alvo tolera SÓ o papel (D gravado quando o papel existia); o substituto segue estrito', () => {
    assert.equal(PAPEIS_REAIS.includes('arquitetura' as never), false);
    const subs = (alvo: Evento, extra: Partial<DadosAprendizado> = {}): string | null =>
      validarAprendizado([loop1, alvo], dado({ substitui: { sessao: 'loop', seq: 2 }, ...extra }), 'GM-1', mapa({}));
    assert.equal(subs(apr('loop', 2, { entra_em: ['brief:arquitetura'] })), null);
    assert.equal(subs(apr('loop', 2, { entra_em: ['instantaneo', 'brief:arquitetura'] })), null);
    // alvo inválido por OUTRO motivo continua inexistente
    for (const extra of [{ regra: '' }, { entra_em: ['brief:arquitetura', 'brief:arquitetura'] }, { entra_em: ['brief:'] }, { entra_em: [] }]) {
      assert.match(subs(apr('loop', 2, extra as Partial<DadosAprendizado>)) ?? '', /^substitui_inexistente/, JSON.stringify(extra));
    }
    // o substituto com papel desconhecido segue recusado (gravação estrita), mesmo com alvo tolerado
    assert.match(subs(apr('loop', 2, { entra_em: ['brief:arquitetura'] }), { entra_em: ['brief:arquitetura'] }) ?? '', /entra_em/);
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
  test('ler-aprendizados-symlink-no-diario-avisa-e-nao-segue', () => {
    // R1: o diário que é symlink (mesmo para arquivo regular válido) não é lido; a entrega fica fora e vira aviso
    const raiz = tmp();
    grava(raiz, 'GM-1', 'loop', 'loop.iniciar', {});
    const real = join(raiz, 'GM-1', 'events.loop.jsonl');
    const fora = join(raiz, 'fora.jsonl');
    writeFileSync(fora, readFileSync(real, 'utf8'));
    mkdirSync(join(raiz, 'GM-2'));
    symlinkSync(fora, join(raiz, 'GM-2', 'events.link.jsonl'));
    const { porEntrega, avisos } = lerAprendizados(raiz);
    assert.deepEqual([...porEntrega.keys()], ['GM-1']);
    assert.deepEqual(avisos, ['aprendizados: GM-2 ilegível (events.link.jsonl não é arquivo regular — diário não lido)']);
  });
  test('ler-aprendizados-fifo-nao-trava-e-avisa', () => {
    // o filho trava (e o timeout o mata) se a leitura abrir a FIFO; processo separado para o teste nunca pendurar
    const raiz = tmp();
    grava(raiz, 'GM-1', 'loop', 'loop.iniciar', {});
    mkdirSync(join(raiz, 'GM-2'));
    execFileSync('mkfifo', [join(raiz, 'GM-2', 'events.s1.jsonl')]);
    const diarioTs = fileURLToPath(new URL('../src/diario.ts', import.meta.url));
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e',
      `import { lerAprendizados } from ${JSON.stringify(diarioTs)}; const r = lerAprendizados(${JSON.stringify(raiz)}); console.log(JSON.stringify({ k: [...r.porEntrega.keys()], a: r.avisos }));`], { encoding: 'utf8', timeout: 4000 });
    assert.equal(r.error, undefined, `travou na FIFO: ${r.error?.message}`);
    assert.deepEqual(JSON.parse(r.stdout), { k: ['GM-1'], a: ['aprendizados: GM-2 ilegível (events.s1.jsonl não é arquivo regular — diário não lido)'] });
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

// ── avisosAprendizado (T13, REQ-APR-4): o que o doctor mostra, cada aviso com o comando que fecha ───────────────────────────────
describe('avisosAprendizado', () => {
  const PAPEIS = ['implementador', 'revisor', 'correcao'];
  const t = (min: number): string => new Date(Date.UTC(2026, 10, 10, 10, min, 0)).toISOString();
  const marco = (sessao: string, seq: number, min: number): Evento => ev(sessao, seq, 'loop.iniciar', {}, t(min));
  const M = (sessao: string, seq: number, min: number, extra: Partial<DadosAprendizado> = {}): Evento =>
    apr(sessao, seq, { status: 'M', entra_em: ['instantaneo'], ...extra }, t(min));
  /** Entrega que só começa no minuto `min` (o menor `ts` dela). */
  const depois = (min: number): Evento[] => [marco('loop', 1, min), marco('loop', 2, min + 1)];
  const semPlanos = new Map<string, Plano>();
  const plano = (...ids: string[]): Plano => ({ entrega: 'GM-9', tasks: ids.map((id) => ({ id, deps: [], arquivos: [`${id}.ts`], reqs: ['REQ-APR-4'] })) });
  const integrada = (id: string, seq: number, min: number): Evento[] => [
    ev('loop', seq, 'task.iniciada', { task: id, papel: 'implementador' }, t(min)),
    ev('loop', seq + 1, 'task.concluida', { task: id }, t(min + 1)),
    ev('loop', seq + 2, 'task.iniciada', { task: id, papel: 'revisor' }, t(min + 2)),
    ev('loop', seq + 3, 'review.veredito', { task: id, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, t(min + 3)),
    ev('loop', seq + 4, 'task.integrada', { task: id }, t(min + 4)),
  ];
  const veredito = (seq: number, min: number, major: number): Evento =>
    ev('loop', seq, 'review.veredito', { task: 'T0', veredito: 'REPROVADO', rodada: 1, major, blocker: 0 }, t(min));

  test('m-tres-entregas-depois-avisa', () => {
    const porEntrega = mapa({ 'GM-1': [marco('loop', 1, 0), M('loop', 2, 1)], 'GM-2': depois(10), 'GM-3': depois(20), 'GM-4': depois(30) });
    const r = avisosAprendizado(porEntrega, semPlanos, PAPEIS);
    assert.equal(r.length, 1);
    assert.match(r[0], /GM-1\/loop:2/);
    assert.match(r[0], /3 entregas/);
    assert.match(r[0], /loop\.mjs aprendizado E D .*--substitui GM-1\/loop:2/);
  });
  test('m-duas-entregas-silencio', () => {
    // a borda é > 2: exatamente 2 entregas depois não avisa
    const porEntrega = mapa({ 'GM-1': [marco('loop', 1, 0), M('loop', 2, 1)], 'GM-2': depois(10), 'GM-3': depois(20) });
    assert.deepEqual(avisosAprendizado(porEntrega, semPlanos, PAPEIS), []);
  });
  test('m-conta-entregas-cujo-menor-ts-e-posterior', () => {
    // GM-2 começa ANTES do M (só termina depois): não conta. Sobram 2 depois do M ⇒ silêncio; a 3ª posterior faz avisar.
    const base = { 'GM-1': [marco('loop', 1, 0), M('loop', 2, 5)], 'GM-2': [marco('loop', 1, 2), marco('loop', 2, 50)], 'GM-3': depois(10), 'GM-4': depois(20) };
    assert.deepEqual(avisosAprendizado(mapa(base), semPlanos, PAPEIS), []);
    // empate de ts com o M não é "posterior"
    assert.deepEqual(avisosAprendizado(mapa({ ...base, 'GM-5': [marco('loop', 1, 5)] }), semPlanos, PAPEIS), []);
    assert.equal(avisosAprendizado(mapa({ ...base, 'GM-5': depois(30) }), semPlanos, PAPEIS).length, 1);
  });
  test('m-substituido-por-outra-entrega-silencio', () => {
    // o D de GM-5 substitui o M de GM-1 (D-4): o M sai dos vigentes e não avisa; o D (não é M) também não
    const subst = apr('loop', 3, { status: 'D', substitui: { entrega: 'GM-1', sessao: 'loop', seq: 2 } }, t(40));
    const porEntrega = mapa({ 'GM-1': [marco('loop', 1, 0), M('loop', 2, 1)], 'GM-2': depois(10), 'GM-3': depois(20), 'GM-4': depois(30), 'GM-5': [marco('loop', 1, 35), marco('loop', 2, 36), subst] });
    assert.deepEqual(avisosAprendizado(porEntrega, semPlanos, PAPEIS), []);
    // sem o substitui, o mesmo cenário avisa o M (prova que o silêncio vem do vigente)
    const sem = apr('loop', 3, { status: 'D' }, t(40));
    const r = avisosAprendizado(mapa({ 'GM-1': [marco('loop', 1, 0), M('loop', 2, 1)], 'GM-2': depois(10), 'GM-3': depois(20), 'GM-4': depois(30), 'GM-5': [marco('loop', 1, 35), marco('loop', 2, 36), sem] }), semPlanos, PAPEIS);
    assert.equal(r.length, 1);
  });
  test('d-antigo-nao-avisa', () => {
    // só M envelhece: D (mesmo com 3 entregas depois) não gera aviso
    const porEntrega = mapa({ 'GM-1': [marco('loop', 1, 0), apr('loop', 2, { status: 'D' }, t(1))], 'GM-2': depois(10), 'GM-3': depois(20), 'GM-4': depois(30) });
    assert.deepEqual(avisosAprendizado(porEntrega, semPlanos, PAPEIS), []);
  });
  test('pendencia-em-entrega-concluida-avisa', () => {
    const eventos = [...integrada('T1', 1, 0), veredito(6, 10, 1)];
    const r = avisosAprendizado(mapa({ 'GM-9': eventos }), new Map([['GM-9', plano('T1')]]), PAPEIS);
    // 2 pendências abertas: o major (loop:6) e o fechamento (âncora = último task.integrada, loop:5)
    assert.equal(r.length, 2);
    assert.match(r[0], /GM-9/);
    assert.match(r[0], /pendência/);
    assert.match(r[0], /fechamento loop:5/);
    assert.match(r[0], /loop\.mjs aprendizado nada --gatilho loop:5 --motivo <texto> --entrega GM-9/);
    assert.match(r[1], /review loop:6/);
    assert.match(r[1], /loop\.mjs aprendizado nada --gatilho loop:6 --motivo <texto> --entrega GM-9/);
    // fechadas (aprendizado.nada com o gatilho de cada uma) ⇒ some tudo
    const fecha = (seq: number, g: number, min: number): Evento => ev('loop', seq, 'aprendizado.nada', { gatilho: { sessao: 'loop', seq: g }, motivo: 'nada a registrar' }, t(min));
    const meio = [...eventos, fecha(7, 6, 11)];
    const resto = avisosAprendizado(mapa({ 'GM-9': meio }), new Map([['GM-9', plano('T1')]]), PAPEIS);
    assert.equal(resto.length, 1);
    assert.match(resto[0], /fechamento loop:5/);
    assert.deepEqual(avisosAprendizado(mapa({ 'GM-9': [...meio, fecha(8, 5, 12)] }), new Map([['GM-9', plano('T1')]]), PAPEIS), []);
  });
  test('pendencia-em-entrega-em-andamento-silencio', () => {
    // T1 integrada, T2 ainda não: a entrega não está concluída ⇒ a pendência (do major) não é "esquecida", segue na fila do loop
    const eventos = [...integrada('T1', 1, 0), veredito(6, 10, 1)];
    assert.deepEqual(avisosAprendizado(mapa({ 'GM-9': eventos }), new Map([['GM-9', plano('T1', 'T2')]]), PAPEIS), []);
  });
  test('papel-removido-avisa', () => {
    // `arquitetura` não está em PAPEIS: a forma estrita recusa o evento, mas o aviso o enxerga (o mesmo PAPEIS da validação)
    assert.equal(PAPEIS_REAIS.includes('arquitetura' as never), false);
    const d = apr('loop', 2, { entra_em: ['instantaneo', 'brief:arquitetura'] }, t(1));
    const porEntrega = mapa({ 'GM-1': [marco('loop', 1, 0), d] });
    assert.deepEqual(aprendizadosVigentes(porEntrega), [], 'a vigência estrita segue recusando a forma (brief e gravação não mudam)');
    const r = avisosAprendizado(porEntrega, semPlanos, PAPEIS_REAIS);
    assert.equal(r.length, 1);
    assert.match(r[0], /GM-1\/loop:2/);
    assert.match(r[0], /brief:arquitetura/);
    assert.match(r[0], /papéis: implementador, revisor, correcao/);
    assert.match(r[0], /loop\.mjs aprendizado E D .*--substitui GM-1\/loop:2/);
    // papel válido pela forma e fora da lista passada também avisa; com a lista certa, nada
    const v = mapa({ 'GM-1': [marco('loop', 1, 0), apr('loop', 2, { entra_em: ['brief:revisor'] }, t(1))] });
    assert.deepEqual(avisosAprendizado(v, semPlanos, PAPEIS_REAIS), []);
    assert.equal(avisosAprendizado(v, semPlanos, ['implementador', 'correcao']).length, 1);
    // M nunca entra em brief: um M com papel removido não gera este aviso
    const m = mapa({ 'GM-1': [marco('loop', 1, 0), M('loop', 2, 1, { entra_em: ['brief:arquitetura'] })] });
    assert.deepEqual(avisosAprendizado(m, semPlanos, PAPEIS_REAIS), []);
    // comparação exata, não por prefixo: `implementador-x` não passa por `implementador`
    const outro = mapa({ 'GM-1': [marco('loop', 1, 0), apr('loop', 2, { entra_em: ['brief:implementador-x'] }, t(1))] });
    assert.equal(avisosAprendizado(outro, semPlanos, PAPEIS_REAIS).length, 1);
  });
  test('papel-removido-so-tolera-o-papel: forma inválida por outro motivo não vira aviso de papel', () => {
    const torto = [
      { entra_em: ['brief:arquitetura', 'brief:arquitetura'] }, // repetição
      { entra_em: ['brief:'] }, // papel vazio
      { entra_em: [] },
      { entra_em: ['brief:arquitetura', 42] },
      { entra_em: ['brief:arquitetura'], regra: '' }, // resto da forma inválido
    ];
    for (const extra of torto) {
      const porEntrega = mapa({ 'GM-1': [marco('loop', 1, 0), apr('loop', 2, extra as Partial<DadosAprendizado>, t(1))] });
      assert.deepEqual(avisosAprendizado(porEntrega, semPlanos, PAPEIS_REAIS), [], JSON.stringify(extra));
    }
  });
  test('papel-removido-substituido-nao-avisa: o D que o substitui (validado pela gravação) fecha o aviso', () => {
    const velho = apr('loop', 2, { entra_em: ['brief:arquitetura'] }, t(1));
    const dadosNovo = dado({ entra_em: ['brief:revisor'], substitui: { sessao: 'loop', seq: 2 } });
    assert.equal(validarAprendizado([marco('loop', 1, 0), velho], dadosNovo, 'GM-1', mapa({ 'GM-1': [marco('loop', 1, 0), velho] })), null);
    const novo = ev('loop', 3, 'aprendizado', dadosNovo, t(2));
    assert.equal(avisosAprendizado(mapa({ 'GM-1': [marco('loop', 1, 0), velho] }), semPlanos, PAPEIS_REAIS).length, 1);
    assert.deepEqual(avisosAprendizado(mapa({ 'GM-1': [marco('loop', 1, 0), velho, novo] }), semPlanos, PAPEIS_REAIS), []);
  });
  test('m-entrega-sem-ts-legivel-nao-conta-como-posterior', () => {
    // R4: entrega sem evento (só plano.json) ou com `ts` torto não tem início conhecido: não é "posterior"
    const base = { 'GM-1': [marco('loop', 1, 0), M('loop', 2, 1)], 'GM-2': depois(10), 'GM-3': depois(20) };
    assert.deepEqual(avisosAprendizado(mapa({ ...base, 'GM-4': [] }), semPlanos, PAPEIS), []);
    assert.deepEqual(avisosAprendizado(mapa({ ...base, 'GM-4': [ev('loop', 1, 'loop.iniciar', {}, 'torto')] }), semPlanos, PAPEIS), []);
    assert.equal(avisosAprendizado(mapa({ ...base, 'GM-4': depois(30) }), semPlanos, PAPEIS).length, 1, 'com início legível, passa a contar');
  });
  test('avisos-ausente-x-corrompido', () => {
    // ausente: entrega sem plano, mapas vazios ⇒ silêncio (nada a avisar, nada ilegível)
    assert.deepEqual(avisosAprendizado(mapa({}), semPlanos, PAPEIS), []);
    assert.deepEqual(avisosAprendizado(mapa({ 'GM-1': [veredito(1, 0, 1)] }), semPlanos, PAPEIS), []);
    // corrompido: eventos que não são lista, ou diário que não ordena numa entrega COM plano ⇒ aviso de leitura, nunca silêncio
    const r1 = avisosAprendizado(mapa({ 'GM-1': 'lixo' as unknown as Evento[] }), semPlanos, PAPEIS);
    assert.equal(r1.length, 1);
    assert.match(r1[0], /GM-1 ilegível/);
    const fora = [ev('loop', 2, 'loop.iniciar', {}, t(0)), ev('loop', 1, 'loop.iniciar', {}, t(1))];
    const r2 = avisosAprendizado(mapa({ 'GM-9': fora }), new Map([['GM-9', plano('T1')]]), PAPEIS);
    assert.equal(r2.length, 1);
    assert.match(r2[0], /GM-9 ilegível/);
    assert.notEqual(r2[0], '');
  });
  test('avisos-uma-linha-sem-controle', () => {
    // o aviso vai para o terminal: entrega vinda do diário não injeta quebra de linha
    const r = avisosAprendizado(mapa({ ['GM-1\nX']: 'lixo' as unknown as Evento[] }), semPlanos, PAPEIS);
    assert.equal(r.length, 1);
    assert.doesNotMatch(r[0], /[\u0000-\u001f]/);
  });
});

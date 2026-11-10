/**
 * Testes do texto base do painel (GM-12 T4): `limpar`, `colunas`, `cortar`, `barra`, `cortarLinha`, `blocoTopo`, `fraseHistorico`, `historicoDe`, `paraTexto`.
 * Mutações prescritas: .superpowers/sdd/2026-11-09-e4-painel/task-4-mut.json (MUT-PNL-7, MUT-PNL-9a e as da sombra-p1a.md, seção Task 4).
 * Costura (P9): `costura-diario-real-ate-texto` grava no diário real (`append`), lê com `lerEstrito` e passa por `ordenar`, `horaLocal` e `paraTexto`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GLIFOS, HIST_MAX, SGR, barra, blocoTopo, colunas, cortar, cortarLinha, fraseHistorico, historicoDe, limpar, paraTexto,
  type CtxHistorico,
} from '../src/painel-texto.ts';
import { append, lerEstrito } from '../src/diario.ts';
import { ESTADOS, NOMES_ESTADOS } from './painel-fixtures/estados.ts';
import type { CorTema, EstadoPainel, Evento, Linha } from '../src/tipos.ts';

const SEM_SGR = /\x1b\[\d+m/g;
const ms = (iso: string) => Date.parse(iso);
const estado = (nome: (typeof NOMES_ESTADOS)[number]): EstadoPainel => structuredClone(ESTADOS[nome]);
const mono = (l: Linha[]) => paraTexto(l, 'mono');
const topo = (e: EstadoPainel, w = 80) => mono(blocoTopo(e, w)).split('\n');
const ultima = (e: EstadoPainel, w: number) => topo(e, w).at(-1) as string;
const AGORA = ms('2026-11-09T18:00:00Z');
const CTX: Omit<CtxHistorico, 'revisaoS'> = {
  nomes: new Map([['T9:revisor', 'LEGOLAS'], ['T8:trabalho', 'GIMLI']]),
  lider: 'GANDALF', sabio: 'ELROND', porAgente: new Map([['subagent:a1', 'ARAGORN']]), fuso: 'UTC', agoraMs: AGORA,
  textoParar: (m) => (m === 'teto_rodadas' ? 'teto de rodadas de review' : null),
};
let seqGlobal = 0;
const ev = (tipo: string, dados: unknown, extra: Partial<Evento> = {}): Evento =>
  ({ seq: ++seqGlobal, ts: '2026-11-09T14:00:00.000Z', autor: 'x', sessao: 's1', agente: 'orquestrador', tipo, dados, hash_anterior: null, ...extra }) as Evento;

// ───────────────────────────── limpeza e largura ─────────────────────────────

test('limpa-ansi-c0-c1', () => {
  assert.equal(limpar('a\x1b]0;pwned\x07\x1b[2Jb'), 'a ]0;pwned  [2Jb');
  assert.equal(limpar('\x9b31m'), ' 31m'); // CSI em C1
  assert.equal(limpar('x\x00y\x7fz\u2028w\u2029'), 'x y z w ');
  assert.equal(limpar(undefined as unknown as string), '', 'não texto ⇒ vazio');
  for (const saida of [paraTexto([[{ texto: 'a\x1b[2J\x9bX', cor: 'error' }]], 'mono'), paraTexto([[{ texto: 'a\x1b[2J\x9bX', cor: 'error' }]], 'color').replace(SEM_SGR, '')]) {
    assert.doesNotMatch(saida, /[\x1b\x9b]/);
  }
});

test('limpa-bidi', () => {
  assert.equal(limpar('T\u202eabc'), 'T abc');
  assert.equal(limpar('\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'), ' '.repeat(9));
  assert.equal(colunas('T\u202eabc'), 5, 'o bidi vira 1 coluna de espaço, não 0');
});

test('limpa-mantem-marca-zwj-e-seletor', () => {
  const s = 'e\u0301\u200d\ufe0f\ufe0e';
  assert.equal(limpar(s), s);
});

test('colunas-largo-e-controle', () => {
  assert.equal(colunas('abc'), 3);
  assert.equal(colunas('漢字'), 4);
  assert.equal(colunas('한'), 2);
  assert.equal(colunas('あ'), 2);
  assert.equal(colunas('ア'), 2);
  assert.equal(colunas('Ａ'), 2, 'fullwidth U+FF21');
  assert.equal(colunas('￦'), 2, 'fullwidth U+FFE6');
  assert.equal(colunas('😀'), 2);
  assert.equal(colunas('a\x1bb'), 3, 'controle vira espaço: 1 coluna');
  assert.equal(colunas('\x9b'), 1);
  assert.equal(colunas('…'), 1);
  assert.equal(colunas('·'), 1);
  assert.equal(colunas(''), 0);
  assert.equal(colunas(undefined as unknown as string), 0);
});

test('colunas-zwj-uma-vez', () => {
  assert.equal(colunas('👨\u200d👩\u200d👧'), 2, 'a sequência conta uma vez');
  assert.equal(colunas('👨\u200d👩\u200d👧 x'), 4);
  assert.equal(colunas('👨👩'), 4, 'sem ZWJ cada emoji conta 2');
});

test('colunas-combinante-zero', () => {
  assert.equal(colunas('e\u0301'), 1);
  assert.equal(colunas('\u0301'), 0);
  assert.equal(colunas('e\u20dd'), 1, 'Me');
  assert.equal(colunas('❤\ufe0f'), 2, 'seletor de variação vale 0 (o pictográfico vale 2)');
});

test('glifos-largura-1', () => {
  assert.equal(GLIFOS.length, 20);
  for (const g of GLIFOS) assert.equal(colunas(g), 1, `glifo ${g}`);
  // `▶` é Extended_Pictographic no Unicode, mas o terminal o desenha em 1 coluna: o conjunto de glifos é exceção declarada
  assert.equal(/\p{Extended_Pictographic}/u.test('▶'), true);
  assert.equal(colunas('▶'), 1);
});

test('colunas-modificador-de-pele-bandeira-keycap-e-largura-zero (T4 MINOR 3)', () => {
  assert.equal(colunas('👍'), 2);
  assert.equal(colunas('👍🏽'), 2, 'o modificador de pele cola na base e vale 0');
  assert.equal(colunas('👍🏽👍🏿'), 4);
  assert.equal(colunas('🇧🇷'), 2, 'bandeira = 2 indicadores regionais = 2 colunas');
  assert.equal(colunas('1\ufe0f\u20e3'), 2, 'keycap = 2 colunas');
  assert.equal(colunas('▶\ufe0f'), 2, '▶ com seletor de emoji (VS16) é desenhado em 2 colunas');
  assert.equal(colunas('❤\ufe0f'), 2, 'pictográfico já vale 2: o VS16 não soma de novo');
  for (const zw of ['\u200b', '\u200c', '\u200e', '\u200f', '\u2060', '\ufeff', '\u061c']) assert.equal(colunas(`a${zw}b`), 2, `U+${zw.codePointAt(0)!.toString(16)} vale 0`);
});

test('cortar-nao-parte-modificador-bandeira-nem-keycap (T4 MINOR 3)', () => {
  assert.equal(cortar('👍🏽abc', 3), '👍🏽…', 'a base e o modificador saem juntos');
  assert.equal(cortar('👍🏽abc', 4), '👍🏽a…');
  assert.equal(cortar('👍🏽abc', 2), '…', 'não cabe a base inteira: nada de base sem modificador');
  assert.equal(cortar('🇧🇷abc', 3), '🇧🇷…', 'a bandeira sai inteira');
  assert.equal(cortar('🇧🇷abc', 2), '…', 'nunca um indicador regional solto');
  assert.equal(cortar('🇧🇷🇺🇸abc', 5), '🇧🇷🇺🇸…', 'dois pares: a fronteira cai entre pares');
  assert.equal(cortar('🇧🇷🇺🇸abc', 4), '🇧🇷…', 'não corta no meio do 2º par');
  assert.equal(cortar('1\ufe0f\u20e3abc', 3), '1\ufe0f\u20e3…');
  assert.equal(cortar('1\ufe0f\u20e3abc', 2), '…', 'o keycap não se parte');
  for (const t of ['👍🏽abc', '🇧🇷🇺🇸abc', '1\ufe0f\u20e3abc', 'a\u200bbcdef']) for (let m = 1; m <= 8; m++) assert.ok(colunas(cortar(t, m)) <= m, `${JSON.stringify(t)} em ${m}`);
});

test('cortar-cabe-devolve-limpo', () => {
  assert.equal(cortar('abcd', 4), 'abcd', 'colunas = max cabe');
  assert.equal(cortar('ab\x1bcd', 5), 'ab cd');
  assert.equal(cortar('', 5), '');
});

test('cortar-na-borda', () => {
  assert.equal(cortar('abcdef', 4), 'abc…', 'prefixo de max−1 colunas inteiro');
  assert.equal(cortar('abcdef', 2), 'a…');
  assert.equal(cortar('abcdef', 1), '…');
  assert.equal(cortar('abcde', 4), 'abc…');
});

test('cortar-largo-na-borda', () => {
  assert.equal(cortar('漢字漢字', 5), '漢字…');
  assert.equal(colunas(cortar('漢字漢字', 5)), 5);
  assert.equal(cortar('漢字漢字', 4), '漢…');
  assert.equal(colunas(cortar('漢字漢字', 4)), 3);
  assert.equal(cortar('漢字漢字', 8), '漢字漢字');
  assert.equal(cortar('漢字漢字', 2), '…');
});

test('cortar-nao-parte-surrogate', () => {
  const r = cortar('😀😀😀', 4);
  assert.equal(r, '😀…');
  assert.doesNotMatch(r, /[\ud800-\udbff](?![\udc00-\udfff])/, 'nenhum substituto alto solto');
  assert.doesNotMatch(r, /(?<![\ud800-\udbff])[\udc00-\udfff]/, 'nenhum substituto baixo solto');
  const f = cortar('👨\u200d👩\u200d👧 família', 3);
  assert.equal(f, '👨\u200d👩\u200d👧…', 'não parte a sequência ZWJ');
  assert.ok(colunas(f) <= 3);
  const m = cortar('e\u0301ab', 2);
  assert.equal(m, 'e\u0301…', 'não separa a marca da base');
  assert.equal(cortar('xA\u200dBCD', 3), 'x…', 'ZWJ cola o que vem depois: não corta entre ZWJ e B');
  assert.equal(cortar('\u0301abc', 1), '…', 'max 1 ⇒ só a reticência, mesmo com marca solta no começo');
  assert.equal(cortar('e\u0301', 1), 'e\u0301', 'cabe: volta inteiro');
  assert.equal(cortar('e\u0301ab', 1), '…');
});

test('cortar-max-invalido', () => {
  for (const ruim of [0, -1, NaN, Infinity, -Infinity, 0.5, '5', undefined, null]) assert.equal(cortar('abcdef', ruim as number), '', String(ruim));
  assert.equal(cortar('abcdef', 3.9), 'ab…', 'não inteiro ⇒ floor');
  assert.equal(cortar(undefined as unknown as string, 5), '');
});

test('cortar-1mb-linear', () => {
  const grande = 'a'.repeat(1_000_000);
  const t0 = performance.now();
  assert.equal(cortar(grande, 10), 'aaaaaaaaa…');
  assert.equal(colunas(grande), 1_000_000);
  assert.equal(cortar('漢'.repeat(500_000), 7), '漢漢漢…');
  assert.equal(colunas('e\u0301'.repeat(300_000)), 300_000);
  assert.equal(limpar('\x1b'.repeat(1_000_000)).length, 1_000_000);
  assert.ok(performance.now() - t0 < 10_000, 'sem regex catastrófica (limite largo: só pega o crescimento não linear)');
});

test('barra-limites', () => {
  assert.equal(barra(0, 10, '▰', '▱'), '▱'.repeat(10));
  assert.equal(barra(100, 10, '▰', '▱'), '▰'.repeat(10));
  assert.equal(barra(150, 10, '▰', '▱'), '▰'.repeat(10), '> 100 vira cheia');
  assert.equal(barra(-20, 10, '▰', '▱'), '▱'.repeat(10), 'negativo vira vazia');
  assert.equal(barra(50, 10, '█', '░'), '█████░░░░░');
  assert.equal(barra(58, 12, '▰', '▱'), '▰▰▰▰▰▰▰▱▱▱▱▱', '58% de 12 = 6,96 ⇒ 7');
  assert.equal(barra(50, 5, '█', '░'), '███░░', 'round: 2,5 ⇒ 3');
});

test('barra-nan', () => {
  assert.equal(barra(NaN, 10, '▰', '▱'), '▱'.repeat(10));
  assert.equal(barra(Infinity, 10, '▰', '▱'), '▱'.repeat(10), 'não finito vale 0, não 100');
  assert.equal(barra(50, 0, '▰', '▱'), '');
  assert.equal(barra(50, -3, '▰', '▱'), '');
  assert.equal(barra(50, NaN, '▰', '▱'), '');
  assert.equal(barra(50, Infinity, '▰', '▱'), '');
  assert.equal(barra(50, 4.9, '▰', '▱'), '▰▰▱▱', 'largura não inteira ⇒ floor');
});

test('cortar-linha-corta-o-ultimo-segmento-que-estoura', () => {
  const l: Linha = [{ texto: 'abc', cor: 'success' }, { texto: 'defgh', cor: 'error' }, { texto: 'ij' }];
  assert.deepEqual(cortarLinha(l, 20), l);
  assert.deepEqual(cortarLinha(l, 6), [{ texto: 'abc', cor: 'success' }, { texto: 'de…', cor: 'error' }]);
  assert.deepEqual(cortarLinha(l, 3), [{ texto: 'ab…', cor: 'success' }], 'nada sobrou: a reticência toma o fim do anterior');
  assert.deepEqual(cortarLinha(l, 0), []);
  assert.deepEqual(cortarLinha(l, NaN), []);
});

// ───────────────────────────── topo ─────────────────────────────

test('topo-nada', () => {
  assert.deepEqual(blocoTopo(estado('vazio'), 80), [[{ texto: 'depende de você: nada', cor: 'inactive' }]]);
  assert.deepEqual(blocoTopo(estado('vazio'), 0), []);
});

test('topo-cabecalho-n-itens', () => {
  const e = estado('vazio');
  e.depende = [
    { nivel: 'dono', motivo: 'spec da E5 aguardando aprovação', acoes: [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }] },
    { nivel: 'dono', motivo: 'emenda #3 em REQ-PNL-5', acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 3' }, { rotulo: 'rejeitar', comando: '/gabarito-mestre:emenda rejeitar 3' }] },
  ];
  assert.deepEqual(topo(e), [
    '◆ DEPENDE DE VOCÊ  2 itens',
    '  spec da E5 aguardando aprovação  /gabarito-mestre:aprovar',
    '  emenda #3 em REQ-PNL-5  /gabarito-mestre:emenda aprovar 3 · rejeitar 3',
  ]);
  const linhas = blocoTopo(e, 80);
  assert.deepEqual(linhas[0], [{ texto: '◆ DEPENDE DE VOCÊ', cor: 'warning' }, { texto: '  2 itens', cor: 'warning' }]);
  e.depende = e.depende.slice(0, 1);
  assert.equal(topo(e)[0], '◆ DEPENDE DE VOCÊ  1 item', 'singular');
});

test('topo-abrevia-prefixo-comum', () => {
  const e = estado('emenda-aberta');
  assert.deepEqual(topo(e).slice(0, 2), ['◆ DEPENDE DE VOCÊ  1 item', '  emenda #3 em REQ-PNL-5 aguard…  /gabarito-mestre:emenda aprovar 3 · rejeitar 3'], 'o motivo encolhe, o comando segue inteiro');
  assert.equal(topo(e, 120)[1], '  emenda #3 em REQ-PNL-5 aguarda você  /gabarito-mestre:emenda aprovar 3 · rejeitar 3');
  // o `comando` do estado continua inteiro (é ele que o botão usa)
  assert.equal(e.depende[0].acoes[1].comando, '/gabarito-mestre:emenda rejeitar 3');
  const f = estado('vazio');
  f.depende = [{ nivel: 'dono', motivo: 'm', acoes: [{ rotulo: 'a', comando: 'um x' }, { rotulo: 'b', comando: 'dois y' }, { rotulo: 'c', comando: 'um x' }] }];
  assert.equal(topo(f)[1], '  m  um x · dois y · x', 'sem palavra comum: inteiro; idêntico ao 1º: fica a última palavra');
  const g = estado('vazio');
  g.depende = [{ nivel: 'dono', motivo: 'm', acoes: [{ rotulo: 'a', comando: null }, { rotulo: 'b', comando: 'cmd z' }] }];
  assert.equal(topo(g)[1], '  m  a · cmd z', '1º sem comando: nada a abreviar');
});

test('topo-parou-error-tres-linhas', () => {
  const e = estado('parou-teto');
  e.notificacao = { hora: '14:07' } as unknown as EstadoPainel['notificacao'];
  assert.deepEqual(topo(e, 100), [
    '■ PAROU 14:07  teto de rodadas de review em T9',
    '  aprovar  /gabarito-mestre:liberar T9   recusar  deixe a task parada e emende a spec',
    '  T8 continua · produção: 0 alterações nesta entrega · notificação enviada 14:07',
  ]);
  const l = blocoTopo(e, 100);
  assert.deepEqual(l[0][0], { texto: '■ PAROU 14:07', cor: 'error' });
  assert.equal(l[0][1].cor, undefined, 'só o selo PAROU é vermelho');
  assert.equal(l[2][0].cor, 'inactive');
  // o `parar` de depende não se repete, e não há cabeçalho de dono
  assert.equal(topo(e, 100).join('\n').match(/teto de rodadas/g)?.length, 1);
  assert.doesNotMatch(topo(e, 100).join('\n'), /DEPENDE/);
});

test('topo-parar-acoes-em-linhas-proprias-quando-nao-cabe', () => {
  const e = estado('parou-teto');
  const l = topo(e, 60);
  assert.deepEqual(l.slice(1, 3), ['    aprovar  /gabarito-mestre:liberar T9', '    recusar  deixe a task parada e emende a spec']);
  assert.match(l[3], /^  T8 continua · /, 'a L3 mantém o recuo de 2 mesmo com as ações quebradas');
  assert.ok(l.every((x) => colunas(x) <= 60));
});

test('topo-parar-recuo-de-2-colunas-nas-linhas-2-e-3 (mockup APROVADO, mockup-painel.html:90-91; T4 MINOR 2)', () => {
  const l = topo(estado('parou-teto'), 100);
  assert.ok(!l[0].startsWith(' '), 'a L1 não tem recuo');
  assert.ok(l[1].startsWith('  aprovar') && !l[1].startsWith('   '), 'L2: exatamente 2 colunas');
  assert.ok(l[2].startsWith('  T8 continua') && !l[2].startsWith('   '), 'L3: exatamente 2 colunas');
  const d = estado('parou-diario');
  const m = topo(d, 100);
  assert.equal(m[1], '  confira o diário; nada segue até ele ser válido', 'ação sem comando também recuada');
});

test('topo-parar-comando-que-cabe-sozinho-nao-e-cortado (T4 MINOR 1; spec: comando nunca cortado)', () => {
  const e = estado('parou-teto');
  const comando = `node ${'x'.repeat(59)}`; // 64 colunas
  assert.equal(colunas(comando), 64);
  e.parar!.acoes = [{ rotulo: 'subir a entrega', comando }];
  const l = topo(e, 80);
  assert.ok(l.every((x) => colunas(x) <= 80), JSON.stringify(l));
  assert.ok(l.some((x) => x.trim() === comando), `o comando de 64 colunas cabe sozinho em 80 e sai inteiro: ${JSON.stringify(l)}`);
  assert.ok(l.some((x) => x.trim() === 'subir a entrega'), 'o rótulo vai na linha de cima, também inteiro');
  assert.equal(l.filter((x) => x.includes('…')).length, 0, 'nada foi cortado');
  // comando que não cabe nem sozinho: cortado só no fim
  e.parar!.acoes = [{ rotulo: 'subir', comando: `node ${'y'.repeat(95)}` }];
  const g = topo(e, 80);
  assert.ok(g.every((x) => colunas(x) <= 80));
  assert.ok(g.some((x) => x.endsWith('…') && x.trim().startsWith('node yyy')), 'cortado só no fim');
});

test('topo-acao-sem-comando-dois-espacos', () => {
  const e = estado('parou-diario');
  assert.equal(topo(e, 100)[1], '  confira o diário; nada segue até ele ser válido', 'sem `: `, o rótulo vai como está');
  e.parar!.acoes = [{ rotulo: 'recusar: deixe a task parada: e emende', comando: null }];
  assert.equal(topo(e, 100)[1], '  recusar  deixe a task parada: e emende', 'só o 1º `: ` vira dois espaços');
  e.parar!.acoes = [];
  assert.equal(topo(e, 100).length, 2, 'sem ações, sem linha de ações');
});

test('topo-continua-singular', () => {
  const e = estado('parou-teto');
  assert.match(topo(e, 100)[2], /^  T8 continua · /);
  e.parar!.emVoo = ['T8', 'T9'];
  assert.match(topo(e, 100)[2], /^  T8 T9 continuam · /);
  e.parar!.emVoo = [];
  assert.match(topo(e, 100)[2], /^  nada continua · /);
});

test('topo-alteracao-singular', () => {
  const e = estado('parou-teto');
  const l3 = (n: number) => { e.parar!.alteracoes = n; return topo(e, 100)[2]; };
  assert.match(l3(1), /produção: 1 alteração nesta entrega/);
  assert.match(l3(0), /produção: 0 alterações nesta entrega/);
  assert.match(l3(2), /produção: 2 alterações nesta entrega/);
});

test('topo-notificacao-ausente-omitida', () => {
  const e = estado('parou-teto');
  for (const n of [null, { ts: '2026-11-09T14:07:30.000Z' }, {}, { hora: '' }, 'x', 7]) {
    e.notificacao = n as EstadoPainel['notificacao'];
    assert.equal(topo(e, 100)[2], '  T8 continua · produção: 0 alterações nesta entrega', JSON.stringify(n));
  }
  e.notificacao = { motivo: 'sem mod' };
  assert.equal(topo(e, 100)[2], '  T8 continua · produção: 0 alterações nesta entrega · não enviada: sem mod');
  e.notificacao = { motivo: 'x'.repeat(500) };
  const l3 = topo(e, 100)[2];
  assert.ok(l3.endsWith(`não enviada: ${'x'.repeat(29)}…`), l3);
  assert.ok(topo(e, 80).every((x) => colunas(x) <= 80), 'nada passa da largura');
});

test('topo-l3-cai-da-direita', () => {
  const e = estado('parou-teto');
  e.notificacao = { hora: '14:07' } as unknown as EstadoPainel['notificacao'];
  assert.equal(ultima(e, 80), '  T8 continua · produção: 0 alterações nesta entrega · notificação enviada 14:07');
  assert.equal(ultima(e, 79), '  T8 continua · produção: 0 alterações nesta entrega', 'cai a notificação');
  assert.equal(ultima(e, 51), '  T8 continua', 'cai a produção');
  assert.equal(ultima(e, 8), '  T8 co…', 'a 1ª parte é cortada no fim');
});

test('topo-parou-mais-dono', () => {
  const e = estado('parou-teto');
  e.notificacao = { hora: '14:07' } as unknown as EstadoPainel['notificacao'];
  e.depende.push({ nivel: 'dono', motivo: 'emenda #3 em REQ-PNL-5', acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 3' }] });
  const l = topo(e, 100);
  assert.equal(l.length, 5);
  assert.match(l[0], /^■ PAROU/);
  assert.equal(l[3], '◆ DEPENDE DE VOCÊ  1 item', 'só o item dono conta; o `parar` não');
  assert.equal(l[4], '  emenda #3 em REQ-PNL-5  /gabarito-mestre:emenda aprovar 3');
});

test('topo-pausa-sem-parar-so-item-dono', () => {
  const l = topo(estado('pausado'));
  assert.deepEqual(l, ['◆ DEPENDE DE VOCÊ  1 item', '  loop pausado  /gabarito retomar']);
});

test('topo-item-parar-sem-bloco-parou-nao-some', () => {
  const e = estado('parou-teto');
  e.parar = null; // estado incoerente: o item `parar` não pode sumir em silêncio
  const l = topo(e, 100);
  assert.equal(l[0], '◆ DEPENDE DE VOCÊ  1 item');
  assert.match(l[1], /^  teto de rodadas de re/);
  assert.match(topo(e, 200)[1], /^  teto de rodadas de review em T9  \/gabarito-mestre:liberar T9 · recusar  deixe a task parada e emende a spec$/);
});

test('topo-comando-nunca-cortado', () => {
  const e = estado('deploy-devolvido');
  const comando = e.depende[0].acoes[0].comando as string;
  assert.equal(colunas(comando), 64);
  const comando70 = `${comando} --dry`;
  e.depende[0].acoes[0].comando = comando70;
  assert.equal(colunas(comando70), 70);
  const l80 = topo(e, 80);
  assert.ok(l80.some((x) => x.trim() === comando70), 'a 80: motivo encolhe e o comando vai inteiro em linha própria');
  const l20 = topo(e, 20);
  assert.ok(l20.every((x) => colunas(x) <= 20), JSON.stringify(l20));
  const ult = l20[l20.length - 1];
  assert.ok(ult.endsWith('…'), 'cortado só no fim');
  assert.ok(ult.trim().startsWith(comando70.slice(0, 10)), 'o começo do comando está lá');
  assert.equal(e.depende[0].acoes[0].comando, comando70, 'o comando do estado continua inteiro');
});

test('topo-comando-que-cabe-sem-recuo-nao-e-cortado', () => {
  const e = estado('vazio');
  e.depende = [{ nivel: 'dono', motivo: 'motivo longo o bastante', acoes: [{ rotulo: 'x', comando: 'c'.repeat(18) }] }];
  const l = topo(e, 20);
  const alvo = l.find((x) => x.trim() === 'c'.repeat(18));
  assert.ok(alvo !== undefined && !alvo.includes('…'), `18 colunas cabem em 20, com recuo de 2 e não de 4: ${JSON.stringify(l)}`);
});

test('topo-motivo-encolhe-ate-12-antes-de-quebrar', () => {
  const e = estado('vazio');
  e.depende = [{ nivel: 'dono', motivo: 'm'.repeat(40), acoes: [{ rotulo: 'x', comando: '/cmd/xx' }] }];
  assert.equal(topo(e, 30)[1], `  ${'m'.repeat(18)}…  /cmd/xx`, 'sobram 30−4−7 = 19 colunas: motivo cortado em 19');
  assert.deepEqual(topo(e, 22), ['◆ DEPENDE DE VOCÊ  1 …', `  ${'m'.repeat(19)}…`, '    /cmd/xx'], 'sobram 11 < 12: a ação vai para linha própria');
});

test('topo-largura-nunca-estoura', () => {
  for (const nome of NOMES_ESTADOS) {
    for (const hora of [true, false]) {
      const e = estado(nome);
      if (hora && e.parar) e.notificacao = { hora: '14:07' } as unknown as EstadoPainel['notificacao'];
      if (!hora && e.parar) e.notificacao = { motivo: 'm'.repeat(200) };
      for (const w of [1, 2, 3, 5, 8, 12, 20, 33, 44, 60, 80, 120]) {
        for (const l of blocoTopo(e, w)) assert.ok(colunas(l.map((s) => s.texto).join('')) <= w, `${nome} w=${w}: ${JSON.stringify(l)}`);
      }
    }
  }
});

test('topo-texto-com-largo-e-controle', () => {
  const e = estado('vazio');
  e.depende = [{ nivel: 'dono', motivo: '漢字\x1b[31m漢字漢字漢字漢字漢字漢字', acoes: [{ rotulo: 'x', comando: '/c' }] }];
  for (const w of [10, 15, 21, 40]) {
    for (const l of topo(e, w)) {
      assert.ok(colunas(l) <= w, `${w}: ${l}`);
      assert.doesNotMatch(l, /\x1b/);
    }
  }
});

// ───────────────────────────── histórico ─────────────────────────────

type Caso = [string, string, unknown, { glifo: string; cor: CorTema; texto: string }, Partial<Evento>?];
const TABELA: Caso[] = [
  ['review aprovado', 'review.veredito', { task: 'T9', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, { glifo: '✓', cor: 'success', texto: 'LEGOLAS aprovou T9' }],
  ['review reprovado', 'review.veredito', { task: 'T9', veredito: 'REPROVADO', rodada: 1, major: 2, blocker: 1 }, { glifo: '✗', cor: 'warning', texto: 'LEGOLAS reprovou T9 · 3 achados' }],
  ['review reprovado 1 achado', 'review.veredito', { task: 'T9', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }, { glifo: '✗', cor: 'warning', texto: 'LEGOLAS reprovou T9 · 1 achado' }],
  ['review sem nome do par', 'review.veredito', { task: 'T3', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, { glifo: '✓', cor: 'success', texto: 'revisor aprovou T3' }],
  ['iniciada implementador', 'task.iniciada', { task: 'T8', papel: 'implementador' }, { glifo: '▶', cor: 'success', texto: 'despachou GIMLI em T8' }],
  ['iniciada correção', 'task.iniciada', { task: 'T8', papel: 'correcao' }, { glifo: '▶', cor: 'success', texto: 'despachou GIMLI em T8' }],
  ['iniciada revisor', 'task.iniciada', { task: 'T9', papel: 'revisor' }, { glifo: '▶', cor: 'success', texto: 'despachou LEGOLAS em T9' }],
  ['iniciada sem nome ⇒ papel literal', 'task.iniciada', { task: 'T5', papel: 'revisor' }, { glifo: '▶', cor: 'success', texto: 'despachou revisor em T5' }],
  ['integrada', 'task.integrada', { task: 'T7', sha: 'abc' }, { glifo: '✓', cor: 'success', texto: 'T7 integrada' }],
  ['integrada com mutações', 'task.integrada', { task: 'T7', mutacoes: { total: 7, mortas: 6 } }, { glifo: '✓', cor: 'success', texto: 'T7 integrada · 6 mutações mortas' }],
  ['decisão da Sombra', 'decisao.sombra', { resposta: 'seguir com a forma opcional' }, { glifo: '◆', cor: 'planMode', texto: 'ELROND decidiu #41 · seguir com a forma opcional' }, { seq: 41 }],
  ['produção leitura', 'producao.acesso', { ambiente: 'prod', acao: 'leitura', alvo: 'users' }, { glifo: '▲', cor: 'warning', texto: 'GANDALF leu PRODUÇÃO · users · permitido' }],
  ['produção escrita', 'producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'users' }, { glifo: '▲', cor: 'warning', texto: 'GANDALF alterou PRODUÇÃO · users · permitido' }],
  ['produção execução', 'producao.acesso', { ambiente: 'prod', acao: 'execucao', alvo: 'job' }, { glifo: '▲', cor: 'warning', texto: 'GANDALF executou em PRODUÇÃO · job · permitido' }],
  ['destrutiva', 'operacao.destrutiva', { ambiente: 'homolog', acao: 'escrita', alvo: 'tabela' }, { glifo: '▲', cor: 'warning', texto: 'GANDALF alterou HOMOLOG · tabela · destrutiva' }],
  ['CI verde', 'ci.resultado', { verde: true }, { glifo: '●', cor: 'success', texto: 'CI verde' }],
  ['CI vermelho', 'ci.resultado', { verde: false }, { glifo: '✗', cor: 'warning', texto: 'CI vermelho' }],
  ['CI verde homolog', 'ci.resultado', { verde: true, alvo: 'homolog' }, { glifo: '●', cor: 'success', texto: 'CI verde homolog' }],
  ['CI vermelho homolog', 'ci.resultado', { verde: false, alvo: 'homolog' }, { glifo: '✗', cor: 'warning', texto: 'CI vermelho homolog' }],
  ['emenda proposta', 'emenda.proposta', { req: 'REQ-PNL-5' }, { glifo: '◆', cor: 'warning', texto: 'emenda #3 proposta em REQ-PNL-5' }, { seq: 3 }],
  ['emenda aprovada', 'spec.emendada', { proposta_seq: 3, origem: 'dono' }, { glifo: '✓', cor: 'success', texto: 'emenda #3 aprovada (dono)' }, { seq: 9 }],
  ['emenda rejeitada', 'emenda.rejeitada', { proposta_seq: 4, origem: 'sombra' }, { glifo: '✗', cor: 'warning', texto: 'emenda #4 rejeitada (sombra)' }, { seq: 9 }],
  ['spec aprovada', 'spec.aprovada', { spec: 'docs/x.md', sha256: 'a'.repeat(64) }, { glifo: '✓', cor: 'success', texto: 'spec aprovada' }],
  ['parar com texto', 'loop.parar', { motivo: 'teto_rodadas', task: 'T9' }, { glifo: '■', cor: 'error', texto: 'PAROU · teto de rodadas de review' }],
  ['parar fora da tabela', 'loop.parar', { motivo: 'inventado' }, { glifo: '■', cor: 'error', texto: 'PAROU' }],
  ['pausado', 'loop.pausa', { estado: 'pausado' }, { glifo: '■', cor: 'inactive', texto: 'pausado' }],
  ['retomado', 'loop.pausa', { estado: 'retomado' }, { glifo: '▶', cor: 'success', texto: 'retomado' }],
  ['dono liberou', 'task.reaberta', { task: 'T9', origem: 'dono' }, { glifo: '▶', cor: 'success', texto: 'dono liberou T9' }],
  ['pouso', 'sessao.pouso', { percent: 49.6 }, { glifo: '▼', cor: 'inactive', texto: 'pouso da sessão em 50%' }],
  ['retomada', 'sessao.retomada', {}, { glifo: '▶', cor: 'inactive', texto: 'sessão retomada' }],
  ['entrega inicio', 'entrega.inicio', { politica: 'janela' }, { glifo: '▲', cor: 'warning', texto: 'entrega iniciada · janela' }],
  ['smoke ok', 'entrega.smoke', { ok: true }, { glifo: '✓', cor: 'success', texto: 'smoke ok' }],
  ['smoke falhou', 'entrega.smoke', { ok: false }, { glifo: '✗', cor: 'warning', texto: 'smoke falhou' }],
  ['rollback ok', 'entrega.rollback', { ok: true }, { glifo: '▲', cor: 'warning', texto: 'rollback ok' }],
  ['rollback falhou', 'entrega.rollback', { ok: false }, { glifo: '▲', cor: 'warning', texto: 'rollback falhou' }],
  ['entregue', 'entrega.fim', { ok: true }, { glifo: '✓', cor: 'success', texto: 'entregue' }],
  ['entrega falhou', 'entrega.fim', { ok: false, motivo: 'smoke' }, { glifo: '✗', cor: 'warning', texto: 'entrega falhou · smoke' }],
  ['entrega falhou sem motivo', 'entrega.fim', { ok: false }, { glifo: '✗', cor: 'warning', texto: 'entrega falhou' }],
  ['agendada hoje', 'entrega.agendada', { quando: '2026-11-09T21:00:00Z' }, { glifo: '◆', cor: 'warning', texto: 'entrega agendada 21:00' }],
  ['devolvida', 'entrega.devolvida', { motivo: 'executar negado no modo auto' }, { glifo: '◆', cor: 'warning', texto: 'deploy devolvido ao dono · executar negado no modo auto' }],
];

test('historico-tabela-fechada', () => {
  for (const [nome, tipo, dados, esperado, extra] of TABELA) {
    assert.deepEqual(fraseHistorico(ev(tipo, dados, extra), CTX), esperado, nome);
  }
});

test('historico-custo-medicao-null', () => {
  const nulos: [string, unknown][] = [
    ['custo.medicao', { agente: 'orquestrador', tokens: 5 }], ['guarda.deny', { x: 1 }], ['guarda.ask', {}], ['guarda.heartbeat', {}], ['diario.recusa', { motivo: 'x' }],
    ['sombra.consulta', {}], ['task.concluida', { task: 'T1' }], ['loop.pausa', { negado: 'Bash' }], ['task.reaberta', { task: 'T1', origem: 'retomada' }],
    ['desvio', { task: 'T1' }], ['descoberta', {}], ['sessao.inicio', {}], ['tipo.inexistente', {}],
  ];
  for (const [tipo, dados] of nulos) assert.equal(fraseHistorico(ev(tipo, dados), CTX), null, tipo);
});

test('historico-formas-erradas-null', () => {
  const ruins: [string, unknown][] = [
    ['ci.resultado', { verde: 'true' }], ['ci.resultado', {}], ['review.veredito', { task: 'T1', veredito: 'APROVADO', major: '2' }],
    ['review.veredito', { task: 'T1', veredito: 'REPROVADO', major: 1 }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', major: 1, blocker: -1 }],
    ['review.veredito', { task: 'T1', veredito: 'TALVEZ', major: 0, blocker: 0 }], ['review.veredito', { veredito: 'APROVADO' }],
    ['task.iniciada', { task: 'T1', papel: 'sombra' }], ['task.iniciada', { papel: 'revisor' }], ['task.integrada', {}],
    ['decisao.sombra', { resposta: '' }], ['decisao.sombra', { resposta: 5 }],
    ['producao.acesso', { ambiente: 'prod', acao: 'leitura' }], ['producao.acesso', { ambiente: 'prod', acao: 'apagar', alvo: 'x' }],
    ['emenda.proposta', {}], ['spec.emendada', { proposta_seq: 0, origem: 'dono' }], ['spec.emendada', { proposta_seq: 2, origem: 'x' }], ['emenda.rejeitada', { origem: 'dono' }],
    ['loop.pausa', { estado: 'outro' }], ['task.reaberta', { origem: 'dono' }], ['sessao.pouso', { percent: '49' }], ['sessao.pouso', {}],
    ['entrega.inicio', { politica: 'nunca' }], ['entrega.smoke', { ok: 'sim' }], ['entrega.rollback', {}], ['entrega.fim', { ok: 1 }],
    ['entrega.agendada', { quando: 'amanhã' }], ['entrega.agendada', { quando: 7 }], ['entrega.devolvida', { motivo: '  ' }], ['entrega.devolvida', {}],
  ];
  for (const [tipo, dados] of ruins) assert.equal(fraseHistorico(ev(tipo, dados, { seq: 5 }), CTX), null, `${tipo} ${JSON.stringify(dados)}`);
});

test('evento-ausente-x-corrompido', () => {
  for (const [, tipo] of TABELA) {
    for (const dados of [undefined, null, 'x', 42, [], ['task']]) {
      assert.equal(fraseHistorico(ev(tipo, dados), CTX), null, `${tipo} dados=${JSON.stringify(dados)}`);
    }
  }
  for (const ruim of [null, undefined, 'x', 7, [], {}, { tipo: 5, dados: {} }]) assert.equal(fraseHistorico(ruim as unknown as Evento, CTX), null);
  // propriedade herdada não conta como dado (só própria)
  const herdado = Object.create({ verde: true });
  assert.equal(fraseHistorico(ev('ci.resultado', herdado), CTX), null);
});

test('historico-cor-nunca-error-fora-parar', () => {
  for (const [nome, tipo, dados, , extra] of TABELA) {
    const f = fraseHistorico(ev(tipo, dados, extra), CTX);
    assert.notEqual(f, null, nome);
    assert.equal((f as { cor: CorTema }).cor === 'error', tipo === 'loop.parar', nome);
  }
});

test('historico-prod-homolog', () => {
  const t = (ambiente: unknown, tipo = 'producao.acesso') => (fraseHistorico(ev(tipo, { ambiente, acao: 'leitura', alvo: 'a' }), CTX) as { texto: string }).texto;
  assert.equal(t('prod'), 'GANDALF leu PRODUÇÃO · a · permitido');
  assert.equal(t('homolog'), 'GANDALF leu HOMOLOG · a · permitido');
  assert.equal(t('desconhecido'), 'GANDALF leu ambiente desconhecido · a · permitido');
  assert.equal(t(undefined), 'GANDALF leu ambiente desconhecido · a · permitido');
  assert.equal(t('teste'), 'GANDALF leu TESTE · a · permitido', 'ambiente `teste` existe (decidir.ts:68-73, faixa log): não é "desconhecido" (T4 MINOR 4)');
  assert.equal(t('teste', 'operacao.destrutiva'), 'GANDALF leu TESTE · a · destrutiva');
  assert.equal(t('prod', 'operacao.destrutiva'), 'GANDALF leu PRODUÇÃO · a · destrutiva');
  const vazio = fraseHistorico(ev('operacao.destrutiva', { ambiente: 'prod', acao: 'escrita', alvo: '' }), CTX) as { texto: string };
  assert.equal(vazio.texto, 'GANDALF alterou PRODUÇÃO · — · destrutiva');
});

test('historico-parar-textoParar-recebe-a-task-do-evento', () => {
  const texto = (dados: unknown) => (fraseHistorico(ev('loop.parar', dados), { ...CTX, textoParar: (m, t) => `${m}|${String(t)}` }) as { texto: string }).texto;
  assert.equal(texto({ motivo: 'teto_rodadas', task: 'T9' }), 'PAROU · teto_rodadas|T9');
  assert.equal(texto({ motivo: 'teto_rodadas' }), 'PAROU · teto_rodadas|null', 'sem task ⇒ null, nunca undefined');
  assert.equal(texto({ motivo: 'teto_rodadas', task: 7 }), 'PAROU · teto_rodadas|null', 'task que não é texto ⇒ null');
});

test('historico-quem-orquestrador-lider', () => {
  const dados = { ambiente: 'prod', acao: 'leitura', alvo: 'u' };
  const q = (agente: unknown) => (fraseHistorico(ev('producao.acesso', dados, { agente } as Partial<Evento>), CTX) as { texto: string }).texto.split(' ')[0];
  assert.equal(q('orquestrador'), 'GANDALF');
  assert.equal(q('subagent:a1'), 'ARAGORN');
  assert.equal(q('subagent:zz'), 'agente');
  assert.equal(q('outro'), 'agente');
  assert.equal(q(undefined), 'agente');
});

test('historico-revisao-sem-iniciada-sem-min', () => {
  const dados = { task: 'T9', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 };
  const t = (revisaoS?: number | null) => (fraseHistorico(ev('review.veredito', dados), { ...CTX, revisaoS }) as { texto: string }).texto;
  assert.equal(t(1080), 'LEGOLAS aprovou T9 · 18 min');
  assert.equal(t(1109), 'LEGOLAS aprovou T9 · 18 min', 'arredonda para o minuto');
  assert.equal(t(1111), 'LEGOLAS aprovou T9 · 19 min');
  assert.equal(t(null), 'LEGOLAS aprovou T9');
  assert.equal(t(undefined), 'LEGOLAS aprovou T9');
  assert.equal(t(NaN), 'LEGOLAS aprovou T9');
  // reprovado nunca leva duração
  const r = fraseHistorico(ev('review.veredito', { task: 'T9', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }), { ...CTX, revisaoS: 600 }) as { texto: string };
  assert.equal(r.texto, 'LEGOLAS reprovou T9 · 1 achado');
});

test('historico-integrada-sem-mutacoes-sem-sufixo', () => {
  const t = (mutacoes?: unknown) => (fraseHistorico(ev('task.integrada', { task: 'T7', mutacoes }), CTX) as { texto: string }).texto;
  assert.equal(t(undefined), 'T7 integrada');
  assert.equal(t({ total: 5, mortas: 5 }), 'T7 integrada · 5 mutações mortas');
  assert.equal(t({ total: 9, mortas: 0 }), 'T7 integrada · 0 mutações mortas');
  assert.equal(t({ total: 5, mortas: 1 }), 'T7 integrada · 1 mutação morta');
  for (const ruim of [{ total: 5, mortas: 6 }, { total: 5 }, { mortas: 5 }, { total: '5', mortas: '5' }, { total: 5, mortas: -1 }, { total: 5.5, mortas: 2 }, 'x', 3, null, []]) {
    assert.equal(t(ruim), 'T7 integrada', JSON.stringify(ruim));
  }
});

test('historico-agendada-outro-dia', () => {
  const t = (quando: string, fuso = 'UTC') => (fraseHistorico(ev('entrega.agendada', { quando }), { ...CTX, fuso }) as { texto: string }).texto;
  assert.equal(t('2026-11-10T09:00:00Z'), 'entrega agendada 10/11 09:00', 'amanhã ⇒ dd/mm');
  assert.equal(t('2026-11-09T09:00:00Z'), 'entrega agendada 09:00', 'hoje ⇒ hh:mm');
  assert.equal(t('2026-11-08T23:59:00Z'), 'entrega agendada 08/11 23:59', 'ontem ⇒ dd/mm');
  // o fuso decide a data civil: 02:30Z de 10/11 é 23:30 de 09/11 em São Paulo
  assert.equal(t('2026-11-10T02:30:00Z', 'America/Sao_Paulo'), 'entrega agendada 23:30');
  assert.equal(t('2026-11-10T02:30:00Z', 'UTC'), 'entrega agendada 10/11 02:30');
  assert.equal(t('2026-11-10T09:00:00-03:00'), 'entrega agendada 10/11 12:00', 'offset no instante');
});

test('historico-texto-sem-controle', () => {
  const f = fraseHistorico(ev('producao.acesso', { ambiente: 'prod', acao: 'leitura', alvo: 'x\x1b]0;pwned\x07\x1b[2J\u202e' }), CTX) as { texto: string };
  assert.doesNotMatch(f.texto, /[\x00-\x1f\u202e]/);
  assert.match(f.texto, /^GANDALF leu PRODUÇÃO · x /);
  const g = fraseHistorico(ev('decisao.sombra', { resposta: 'a\nb\x9b' }, { seq: 2 }), CTX) as { texto: string };
  assert.equal(g.texto, 'ELROND decidiu #2 · a b ');
});

const em = (n: number, tipo: string, dados: unknown, hh: string, extra: Partial<Evento> = {}): Evento =>
  ({ seq: n, ts: `2026-11-09T${hh}.000Z`, autor: 'x', sessao: 's1', agente: 'orquestrador', tipo, dados, hash_anterior: null, ...extra }) as Evento;

test('historicoDe-ordem-e-hist-max', () => {
  assert.equal(HIST_MAX, 20);
  const lista: Evento[] = [];
  for (let i = 0; i < 25; i++) {
    lista.push(em(lista.length + 1, 'sessao.retomada', {}, `10:${String(i).padStart(2, '0')}:00`));
    if (i % 8 === 0) lista.push(em(lista.length + 1, 'custo.medicao', { tokens: 1 }, `10:${String(i).padStart(2, '0')}:30`));
  }
  const r = historicoDe(lista, CTX);
  assert.equal(r.itens.length, 20);
  assert.equal(r.ocultos, 5, 'só frases não nulas contam; custo.medicao fica fora');
  assert.equal(r.itens[0].hora, '10:24', 'mais recente primeiro');
  assert.equal(r.itens[19].hora, '10:05');
  assert.deepEqual(r.itens[0], { glifo: '▶', texto: 'sessão retomada', hora: '10:24', cor: 'inactive' });
  const desc = r.itens.map((i) => i.hora);
  assert.deepEqual(desc, [...desc].sort().reverse());
});

test('historicoDe-duas-sessoes-intercaladas-por-ts', () => {
  const a = [em(1, 'sessao.retomada', {}, '10:00:00', { sessao: 'a' }), em(2, 'sessao.retomada', {}, '10:20:00', { sessao: 'a' })];
  const b = [em(1, 'spec.aprovada', { spec: 'x', sha256: 'a'.repeat(64) }, '10:10:00', { sessao: 'b' }), em(2, 'sessao.retomada', {}, '10:30:00', { sessao: 'b' })];
  assert.deepEqual(historicoDe([...a, ...b], CTX).itens.map((i) => i.hora), ['10:30', '10:20', '10:10', '10:00']);
  assert.deepEqual(historicoDe([...b, ...a], CTX).itens.map((i) => i.hora), ['10:30', '10:20', '10:10', '10:00'], 'a ordem de chegada das sessões não muda a saída');
});

test('historicoDe-limite-exato', () => {
  const faz = (n: number) => Array.from({ length: n }, (_, i) => em(i + 1, 'sessao.retomada', {}, `11:${String(i).padStart(2, '0')}:00`));
  assert.deepEqual([historicoDe(faz(20), CTX).itens.length, historicoDe(faz(20), CTX).ocultos], [20, 0]);
  assert.deepEqual([historicoDe(faz(21), CTX).itens.length, historicoDe(faz(21), CTX).ocultos], [20, 1]);
  assert.deepEqual([historicoDe(faz(3), CTX).itens.length, historicoDe(faz(3), CTX).ocultos], [3, 0]);
  assert.deepEqual(historicoDe([], CTX), { itens: [], ocultos: 0 });
});

test('historicoDe-diario-invalido-vazio', () => {
  const ruins: unknown[] = [
    [em(2, 'sessao.retomada', {}, '10:00:00'), em(1, 'sessao.retomada', {}, '10:01:00')], // seq fora de ordem na sessão
    [em(1, 'sessao.retomada', {}, '10:00:00'), em(1, 'sessao.retomada', {}, '10:01:00')], // seq repetido
    [em(1, 'sessao.retomada', {}, 'amanha')], // ts inválido
    [{ ...em(1, 'sessao.retomada', {}, '10:00:00'), sessao: 7 }],
    null, undefined, 'x', {},
  ];
  for (const r of ruins) assert.deepEqual(historicoDe(r as Evento[], CTX), { itens: [], ocultos: 0 }, String(JSON.stringify(r) ?? r).slice(0, 60));
});

test('historicoDe-hora-no-fuso-e-outro-dia', () => {
  const lista = [em(1, 'sessao.retomada', {}, '14:02:00'), { ...em(2, 'sessao.retomada', {}, '10:00:00'), ts: '2026-11-08T23:50:00.000Z' }];
  const lista2 = [lista[1], lista[0]].map((e, i) => ({ ...e, seq: i + 1 }));
  assert.deepEqual(historicoDe(lista2, CTX).itens.map((i) => i.hora), ['14:02', '08/11 23:50']);
  assert.deepEqual(historicoDe(lista2, { ...CTX, fuso: 'America/Sao_Paulo' }).itens.map((i) => i.hora), ['11:02', '08/11 20:50']);
});

test('historicoDe-revisao-duracao-do-ultimo-iniciada-da-mesma-task', () => {
  const ap = { veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 };
  const lista = [
    em(1, 'task.iniciada', { task: 'T9', papel: 'revisor' }, '13:00:00'),
    em(2, 'task.iniciada', { task: 'T8', papel: 'revisor' }, '13:30:00'), // outra task: não conta
    em(3, 'task.iniciada', { task: 'T9', papel: 'implementador' }, '13:40:00'), // outro papel: não conta
    em(4, 'review.veredito', { task: 'T9', ...ap }, '13:50:00'),
    em(5, 'review.veredito', { task: 'T7', ...ap }, '13:55:00'), // sem iniciada de revisor: sem min
    em(6, 'task.iniciada', { task: 'T9', papel: 'revisor' }, '14:00:00'), // o ÚLTIMO início vale
    em(7, 'review.veredito', { task: 'T9', ...ap }, '14:18:00'),
  ];
  const textos = historicoDe(lista, CTX).itens.map((i) => i.texto);
  assert.deepEqual(textos, [
    'LEGOLAS aprovou T9 · 18 min', 'despachou LEGOLAS em T9', 'revisor aprovou T7', 'LEGOLAS aprovou T9 · 50 min',
    'despachou implementador em T9', 'despachou revisor em T8', 'despachou LEGOLAS em T9',
  ]);
});

test('historicoDe-revisao-negativa-sem-min-e-zero-com-min', () => {
  const ap = { task: 'T9', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 };
  // relógio de outra máquina: o veredito carrega `ts` anterior ao início (mesma sessão, `seq` em ordem)
  const neg = [em(1, 'task.iniciada', { task: 'T9', papel: 'revisor' }, '14:00:00'), em(2, 'review.veredito', ap, '13:50:00')];
  assert.equal(historicoDe(neg, CTX).itens[0].texto, 'LEGOLAS aprovou T9');
  const zero = [em(1, 'task.iniciada', { task: 'T9', papel: 'revisor' }, '14:00:00'), em(2, 'review.veredito', ap, '14:00:00')];
  assert.equal(historicoDe(zero, CTX).itens[0].texto, 'LEGOLAS aprovou T9 · 0 min');
});

test('historicoDe-textoParar-e-sabio-vem-do-contexto', () => {
  const lista = [em(1, 'loop.parar', { motivo: 'teto_rodadas' }, '14:07:00'), em(2, 'decisao.sombra', { resposta: 'ok' }, '14:08:00')];
  assert.deepEqual(historicoDe(lista, { ...CTX, sabio: 'DUMBLEDORE' }).itens.map((i) => i.texto), ['DUMBLEDORE decidiu #2 · ok', 'PAROU · teto de rodadas de review']);
  assert.deepEqual(historicoDe(lista, { ...CTX, textoParar: () => null }).itens.map((i) => i.texto)[1], 'PAROU');
});

test('costura-diario-real-ate-texto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-painel-texto-'));
  const g = (tipo: string, dados: Record<string, unknown>, ts: string, agente = 'orquestrador') => {
    const r = append(dir, 'sessao1', { ts, autor: 'a@b.c', sessao: 'sessao1', agente, tipo: tipo as Evento['tipo'], dados });
    assert.equal(r.ok, true, JSON.stringify(r));
  };
  g('loop.parar', { motivo: 'teto_rodadas', task: 'T9' }, '2026-11-08T23:30:00.000Z');
  g('task.iniciada', { task: 'T9', papel: 'revisor' }, '2026-11-09T13:00:00.000Z');
  g('review.veredito', { task: 'T9', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, '2026-11-09T13:18:00.000Z');
  g('task.integrada', { task: 'T9', sha: 'abc', mutacoes: { total: 4, mortas: 4 } }, '2026-11-09T13:19:00.000Z');
  g('producao.acesso', { ambiente: 'prod', acao: 'leitura', alvo: 'users' }, '2026-11-09T13:20:00.000Z', 'subagent:a1');
  const lido = lerEstrito(dir);
  assert.equal(lido.ok, true);
  if (!lido.ok) return;
  const { itens, ocultos } = historicoDe(lido.eventos, { ...CTX, fuso: 'America/Sao_Paulo' });
  assert.equal(ocultos, 0);
  const linhas: Linha[] = itens.map((i) => [{ texto: `${i.hora} ` }, { texto: i.glifo, cor: i.cor }, { texto: ` ${i.texto}` }]);
  assert.equal(mono(linhas), [
    '10:20 ▲ ARAGORN leu PRODUÇÃO · users · permitido',
    '10:19 ✓ T9 integrada · 4 mutações mortas',
    '10:18 ✓ LEGOLAS aprovou T9 · 18 min',
    '10:00 ▶ despachou LEGOLAS em T9',
    '08/11 20:30 ■ PAROU · teto de rodadas de review',
  ].join('\n'));
  const cor = paraTexto(linhas, 'color');
  assert.equal(cor.replace(SEM_SGR, ''), mono(linhas));
  assert.match(cor, /\x1b\[31m■\x1b\[0m/, 'o PAROU sai em SGR 31');
});

// ───────────────────────────── paraTexto ─────────────────────────────

test('mono-igual-color-texto', () => {
  for (const nome of NOMES_ESTADOS) {
    const e = estado(nome);
    const linhas: Linha[] = [...blocoTopo(e, 80), ...e.historico.map((h) => [{ texto: `${h.hora} ` }, { texto: h.glifo, cor: h.cor }, { texto: ` ${h.texto}` }] as Linha)];
    assert.equal(paraTexto(linhas, 'color').replace(SEM_SGR, ''), paraTexto(linhas, 'mono'), nome);
  }
});

test('color-sem-sgr-igual-mono', () => {
  const linhas: Linha[] = [
    [{ texto: 'a ', cor: 'success' }, { texto: 'b', cor: 'warning' }, { texto: '   ', cor: 'error' }],
    [],
    [{ texto: '  x' }, { texto: '', cor: 'ide' }, { texto: 'y  ' }, { texto: '  ', cor: 'inactive' }],
    [{ texto: 'e\u0301 漢', cor: 'planMode' }],
  ];
  const c = paraTexto(linhas, 'color');
  assert.equal(c.replace(SEM_SGR, ''), paraTexto(linhas, 'mono'));
  assert.equal(paraTexto(linhas, 'mono'), 'a b\n\n  xy\ne\u0301 漢');
  assert.equal(c.split('\n').length, 4);
});

test('color-fecha-cor-no-fim-da-linha', () => {
  const linhas: Linha[] = [[{ texto: 'a', cor: 'success' }, { texto: 'b' }, { texto: 'c', cor: 'error' }], [{ texto: 'd', cor: 'warning' }]];
  const c = paraTexto(linhas, 'color').split('\n');
  assert.equal(c[0], '\x1b[32ma\x1b[0mb\x1b[31mc\x1b[0m');
  assert.equal(c[1], '\x1b[33md\x1b[0m');
  for (const l of c) {
    const abre = l.match(/\x1b\[(?!0m)\d+m/g) ?? [];
    const fecha = l.match(/\x1b\[0m/g) ?? [];
    assert.equal(abre.length, fecha.length);
    assert.ok(l.endsWith('\x1b[0m'), 'a cor não vaza para a linha seguinte');
  }
});

test('color-mapa-sgr-de-16-cores', () => {
  const esperado: Record<CorTema, number> = { success: 32, warning: 33, error: 31, inactive: 90, planMode: 36, claude: 91, suggestion: 94, autoAccept: 95, ide: 34, remember: 96 };
  assert.deepEqual({ ...SGR }, esperado);
  for (const [cor, n] of Object.entries(esperado)) assert.equal(paraTexto([[{ texto: 'x', cor: cor as CorTema }]], 'color'), `\x1b[${n}mx\x1b[0m`, cor);
  assert.equal(paraTexto([[{ texto: 'x', cor: 'inventada' as CorTema }]], 'color'), 'x', 'cor desconhecida: sem cor, nunca SGR inventado');
});

test('mono-sem-cor-e-sem-espaco-a-direita', () => {
  assert.equal(paraTexto([[{ texto: 'a  ', cor: 'error' }], [{ texto: 'b' }, { texto: '  ' }]], 'mono'), 'a\nb');
  assert.equal(paraTexto([], 'mono'), '');
  assert.equal(paraTexto([[{ texto: 'a\x1b[2J', cor: 'error' }]], 'mono'), 'a [2J');
});

test('para-texto-tema-desconhecido-lanca', () => {
  for (const t of ['', 'MONO', undefined, 'truecolor']) assert.throws(() => paraTexto([], t as 'mono'), RangeError, String(t));
});

test('topo-mono-mantem-o-parou', () => {
  // MUT-PNL-9a: o texto mono do PAROU não pode sumir
  const e = estado('parou-teto');
  assert.ok(mono(blocoTopo(e, 100)).includes('■ PAROU 14:07'));
  assert.ok(paraTexto(blocoTopo(e, 100), 'color').includes('\x1b[31m■ PAROU 14:07\x1b[0m'));
});

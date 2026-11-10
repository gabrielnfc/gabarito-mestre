/**
 * Testes de validarPlano (REQ-LOOP-1). Mutações prescritas (task-1-mut.json):
 *  M1 sem detecção de ciclo ⇒ plano-ciclo falha
 *  M2 sem checagem de dep inexistente ⇒ plano-dep-inexistente falha
 *  M3 sem checagem de id repetido ⇒ plano-id-repetido falha
 *  M4 colisão ignora dependência (sempre erro) ⇒ plano-arquivo-colide-com-dep-transitiva-ok falha
 *  M5 sem normalizar caminho ⇒ plano-arquivo-normalizado falha
 * GM-11 T1:
 *  M-P1 `reqs` sem checar repetição ⇒ plano-reqs-fora-do-padrao falha
 *  M-P2 janela sem checar fuso ⇒ plano-politica-janela-invalida falha
 *  M-P3 temDependencia só direta ⇒ tem-dependencia-transitiva falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validarPlano, temDependencia, normalizarCaminho } from '../src/plano.ts';
import { EM_TRABALHO, duracoes, mediana } from '../src/diario.ts';
import { casarAgente } from '../src/painel-equipe.ts';
import { projetarEquipe } from '../src/painel-equipe.ts';
import { renderPainel } from '../src/painel.ts';
import { renderEsquadrao } from '../src/painel-esquadrao.ts';
import { renderExecutivo } from '../src/painel-executivo.ts';
import { ESTADOS, NOMES_ESTADOS } from './painel-fixtures/estados.ts';
import type { Evento, EntradaPainel, Plano } from '../src/tipos.ts';

const t = (id: string, deps: string[] = [], arquivos: string[] = []) => ({ id, deps, arquivos });
const plano = (...tasks: unknown[]) => ({ entrega: 'GM-10', tasks });

test('plano-valido', () => {
  const r = validarPlano(plano(t('a', [], ['x.ts']), t('b', ['a'], ['y.ts'])));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.plano.entrega, 'GM-10');
    assert.deepEqual(r.plano.tasks.map((x) => x.id), ['a', 'b']);
  }
});

test('plano-ciclo: erro cita os ids', () => {
  const r = validarPlano(plano(t('a', ['b']), t('b', ['a'])));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /ciclo.*a.*b|ciclo.*b.*a/);
});

test('plano-autodependencia e ciclo longo', () => {
  assert.equal(validarPlano(plano(t('a', ['a']))).ok, false);
  assert.equal(validarPlano(plano(t('a', ['c']), t('b', ['a']), t('c', ['b']))).ok, false);
});

test('plano-dep-inexistente', () => {
  const r = validarPlano(plano(t('a', ['zzz'])));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /zzz/);
});

test('plano-id-repetido', () => {
  const r = validarPlano(plano(t('a'), t('a')));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /repetido.*a|a.*repetido/);
});

test('plano-arquivo-colide-sem-dep: erro cita o arquivo', () => {
  const r = validarPlano(plano(t('a', [], ['src/x.ts']), t('b', [], ['src/x.ts'])));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /src\/x\.ts/);
});

test('plano-arquivo-colide-com-dep-transitiva-ok', () => {
  const r = validarPlano(plano(t('a', [], ['src/x.ts']), t('b', ['a']), t('c', ['b'], ['src/x.ts'])));
  assert.equal(r.ok, true);
});

test('plano-arquivo-normalizado: ./a e a colidem', () => {
  const r = validarPlano(plano(t('a', [], ['./a.ts']), t('b', [], ['a.ts'])));
  assert.equal(r.ok, false);
  const r2 = validarPlano(plano(t('a', [], ['d/../a.ts']), t('b', [], ['./a.ts'])));
  assert.equal(r2.ok, false);
  const ok = validarPlano(plano(t('a', [], ['./a.ts'])));
  assert.equal(ok.ok && ok.plano.tasks[0].arquivos[0], 'a.ts');
});

test('plano-json-invalido: nunca lança', () => {
  const ruins: unknown[] = [null, undefined, 42, 'x', [], {}, { tasks: 'x' }, { entrega: 1, tasks: [] }, plano(null), plano([]), plano({ id: 1 }),
    plano({ id: 'a', deps: 'b', arquivos: [] }), plano({ id: 'a', deps: [], arquivos: [1] }), plano({ id: '', deps: [], arquivos: [] }),
    plano({ id: 'a', deps: [], arquivos: ['/abs'] }), plano({ id: 'a', deps: [], arquivos: ['../fora'] })];
  for (const x of ruins) {
    let r: ReturnType<typeof validarPlano> | undefined;
    assert.doesNotThrow(() => { r = validarPlano(x); });
    assert.equal(r?.ok, false, JSON.stringify(x));
    if (r && !r.ok) assert.match(r.erro, /\S/);
  }
});

test('plano-entrada-hostil: getters que lançam não lançam; __proto__ não polui', () => {
  const hostil = { entrega: 'e', get tasks(): never { throw new Error('boom'); } };
  assert.doesNotThrow(() => validarPlano(hostil));
  assert.equal(validarPlano(hostil).ok, false);
  const r = validarPlano(JSON.parse('{"entrega":"e","tasks":[{"id":"__proto__","deps":["__proto__"],"arquivos":[]},{"id":"constructor","deps":[],"arquivos":[]}]}'));
  assert.equal(r.ok, false); // autodependência de __proto__ é ciclo, não polui
  const r2 = validarPlano(JSON.parse('{"entrega":"e","tasks":[{"id":"__proto__","deps":[],"arquivos":["a"]},{"id":"b","deps":["__proto__"],"arquivos":[]}]}'));
  assert.equal(r2.ok, true);
  assert.equal(({} as Record<string, unknown>).arquivos, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

const recusado = (...tasks: unknown[]) => validarPlano(plano(...tasks));

test('plano-arquivos-ausente: arquivos ausente ou null recusa citando task e campo; [] segue válido', () => {
  for (const ruim of [{ id: 'a', deps: [] }, { id: 'a', deps: [], arquivos: null }, { id: 'a', deps: [], arquivos: undefined }]) {
    const r = recusado(ruim);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.erro, /task a.*arquivos/);
  }
  // campo digitado errado nas duas tasks: não pode virar ok:true sem colisão
  assert.equal(recusado({ id: 'a', arquivo: ['x.ts'], deps: [] }, { id: 'b', arquivo: ['x.ts'], deps: [] }).ok, false);
  assert.equal(recusado({ id: 'a', deps: [], arquivos: [] }).ok, true);
});

test('plano-deps-ausente: deps ausente ou null recusa citando task e campo; [] segue válido', () => {
  for (const ruim of [{ id: 'a', arquivos: [] }, { id: 'a', deps: null, arquivos: [] }, { id: 'a', deps: undefined, arquivos: [] }]) {
    const r = recusado(ruim);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.erro, /task a.*deps/);
  }
  assert.equal(recusado({ id: 'a', deps: [], arquivos: [] }).ok, true);
});

test('plano-campo-nao-array: string, objeto e item não string recusam', () => {
  const casos: [unknown, RegExp][] = [
    [{ id: 'a', deps: [], arquivos: 'x.ts' }, /task a.*arquivos/],
    [{ id: 'a', deps: [], arquivos: { 0: 'x.ts' } }, /task a.*arquivos/],
    [{ id: 'a', deps: [], arquivos: ['x.ts', 1] }, /task a.*arquivos/],
    [{ id: 'a', deps: {}, arquivos: [] }, /task a.*deps/],
    [{ id: 'a', deps: 'a', arquivos: [] }, /task a.*deps/],
    [{ id: 'a', deps: [1], arquivos: [] }, /task a.*deps/],
  ];
  for (const [task, re] of casos) {
    const r = recusado(task);
    assert.equal(r.ok, false, JSON.stringify(task));
    if (!r.ok) assert.match(r.erro, re);
  }
});

test('plano-spec: `spec` é campo do topo do plano, preservado; vazio, não texto ou dentro de tasks[] recusa (REQ-LOOP-1)', () => {
  const r = validarPlano({ ...plano(t('a', [], ['x.ts']), t('b', ['a'], ['y.ts'])), spec: 'docs/minha spec.md:10-20' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.plano.spec, 'docs/minha spec.md:10-20');
    assert.equal('spec' in r.plano.tasks[0], false, 'a task não carrega spec');
  }
  const sem = validarPlano(plano(t('a', [], ['x.ts'])));
  assert.equal(sem.ok, true);
  if (sem.ok) assert.equal('spec' in sem.plano, false, 'ausente fica ausente');
  for (const spec of ['', 7, null, ['x'], {}]) {
    const x = validarPlano({ ...plano(t('a', [], ['x.ts'])), spec });
    assert.equal(x.ok, false, JSON.stringify(spec));
    if (!x.ok) assert.match(x.erro, /spec/);
  }
  const naTask = validarPlano(plano({ ...t('a', [], ['x.ts']), spec: 'docs/spec.md' }));
  assert.equal(naTask.ok, false, 'spec em tasks[] não some em silêncio');
  if (!naTask.ok) assert.match(naTask.erro, /task a.*spec.*plano/);
});

// ── GM-11 T1: reqs por task, política de entrega e temDependencia ──────────────────────────────────────────────────────────────────
const comReqs = (reqs: unknown) => plano({ ...t('a', [], ['x.ts']), reqs });
const comPolitica = (politica_entrega: unknown) => ({ ...plano(t('a', [], ['x.ts'])), politica_entrega });

test('plano-reqs-validos: reqs preservado; ausente fica ausente', () => {
  const r = validarPlano(comReqs(['REQ-SOM-1', 'REQ-EME-2']));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.plano.tasks[0].reqs, ['REQ-SOM-1', 'REQ-EME-2']);
  const sem = validarPlano(plano(t('a', [], ['x.ts'])));
  assert.equal(sem.ok && 'reqs' in sem.plano.tasks[0], false);
});

test('plano-reqs-fora-do-padrao: fora de REQ_RE, repetido, vazio, não-lista e não-string recusam citando task e campo', () => {
  const ruins: unknown[] = [['REQ-A-1x'], ['req-a-1'], ['REQ-A-1', 'REQ-A-1'], [], 'REQ-A-1', { 0: 'REQ-A-1' }, [1], [null], [''], null, [['REQ-A-1']]];
  for (const reqs of ruins) {
    const r = validarPlano(comReqs(reqs));
    assert.equal(r.ok, false, JSON.stringify(reqs));
    if (!r.ok) assert.match(r.erro, /task a.*reqs/);
  }
});

test('plano-sem-politica-ok: politica_entrega é opcional e não aparece quando ausente', () => {
  const r = validarPlano(plano(t('a', [], ['x.ts'])));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal('politica_entrega' in r.plano, false);
});

test('plano-politica-valida: preservada inteira', () => {
  const p = { politica: 'janela', exige_prod: true, janela: { dias: [1, 2, 3], inicio: '22:00', fim: '06:00', fuso: 'America/Sao_Paulo' } };
  const r = validarPlano(comPolitica(p));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.plano.politica_entrega, p);
  assert.equal(validarPlano(comPolitica({ exige_prod: false })).ok, true);
  assert.equal(validarPlano(comPolitica({ politica: 'continua', exige_prod: false })).ok, true);
});

test('plano-politica-janela-invalida: dia 7, 24:00, 23:60, fuso Mars/Base e demais formas ruins recusam sem lançar', () => {
  const j = (extra: Record<string, unknown>) => ({ exige_prod: false, janela: { dias: [1], inicio: '09:00', fim: '18:00', fuso: 'UTC', ...extra } });
  const ruins: unknown[] = [
    j({ dias: [7] }), j({ dias: [-1] }), j({ dias: [] }), j({ dias: [1.5] }), j({ dias: ['1'] }), j({ dias: 1 }), j({ dias: undefined }),
    j({ inicio: '24:00' }), j({ fim: '23:60' }), j({ inicio: '9:00' }), j({ fim: '18:00:00' }), j({ inicio: 900 }), j({ inicio: undefined }),
    j({ fuso: 'Mars/Base' }), j({ fuso: '' }), j({ fuso: 7 }), j({ fuso: undefined }),
    { exige_prod: false, janela: 'x' }, { exige_prod: false, janela: null }, { exige_prod: false, janela: [] },
    { exige_prod: 'sim' }, {}, { politica: 'continua' }, { politica: 'sempre', exige_prod: false }, { politica: 7, exige_prod: false }, 'x', 7, [], null,
  ];
  for (const p of ruins) {
    let r: ReturnType<typeof validarPlano> | undefined;
    assert.doesNotThrow(() => { r = validarPlano(comPolitica(p)); });
    assert.equal(r?.ok, false, JSON.stringify(p));
    if (r && !r.ok) assert.match(r.erro, /politica_entrega/);
  }
  assert.equal(validarPlano(comPolitica(j({ inicio: '00:00', fim: '23:59', dias: [0, 6], fuso: 'America/New_York' }))).ok, true);
});

test('plano-politica-intl-lancando: Intl que lança no fuso não lança do validarPlano', () => {
  const original = Intl.DateTimeFormat;
  // @ts-expect-error troca controlada para provar o try
  Intl.DateTimeFormat = function () { throw new TypeError('Intl indisponível'); };
  try {
    let r: ReturnType<typeof validarPlano> | undefined;
    assert.doesNotThrow(() => { r = validarPlano(comPolitica({ exige_prod: false, janela: { dias: [1], inicio: '09:00', fim: '18:00', fuso: 'UTC' } })); });
    assert.equal(r?.ok, false);
  } finally { Intl.DateTimeFormat = original; }
});

test('tem-dependencia-transitiva: ancestral direto ou transitivo, nos dois sentidos; irmãs e a própria task não', () => {
  const r = validarPlano(plano(t('a', [], ['a.ts']), t('b', ['a'], ['b.ts']), t('c', ['b'], ['c.ts']), t('d', [], ['d.ts']), t('e', ['a'], ['e.ts'])));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const p = r.plano;
  assert.equal(temDependencia(p, 'a', 'b'), true);
  assert.equal(temDependencia(p, 'b', 'a'), true);
  assert.equal(temDependencia(p, 'a', 'c'), true, 'transitiva');
  assert.equal(temDependencia(p, 'c', 'a'), true, 'transitiva, sentido inverso');
  assert.equal(temDependencia(p, 'b', 'e'), false, 'irmãs');
  assert.equal(temDependencia(p, 'd', 'a'), false);
  assert.equal(temDependencia(p, 'a', 'a'), false);
  assert.equal(temDependencia(p, 'a', 'inexistente'), false);
  assert.equal(temDependencia(p, '__proto__', 'a'), false);
});

test('tem-dependencia-ciclo-nao-trava: grafo cíclico (que validarPlano barra) não entra em laço', () => {
  const ciclico = { entrega: 'e', tasks: [{ id: 'a', deps: ['b'], arquivos: [] }, { id: 'b', deps: ['a'], arquivos: [] }, { id: 'z', deps: [], arquivos: [] }] };
  assert.equal(temDependencia(ciclico, 'a', 'z'), false);
  assert.equal(temDependencia(ciclico, 'a', 'b'), true);
});

test('normalizar-caminho-exportada: a regra que validarPlano usa para comparar arquivos', () => {
  assert.equal(normalizarCaminho('./a'), 'a');
  assert.equal(normalizarCaminho('a'), 'a');
  assert.equal(normalizarCaminho('a//b'), 'a/b');
  assert.equal(normalizarCaminho('d/../a.ts'), 'a.ts');
  assert.equal(normalizarCaminho('a\\b'), 'a/b');
  assert.equal(normalizarCaminho('a/b/'), 'a/b');
  for (const ruim of ['', '/abs', '../fora', '.', 'a\0b', 'C:\\x']) assert.equal(normalizarCaminho(ruim), null, JSON.stringify(ruim));
});

test('barra-invertida-absoluta-recusa: `\\a` e `\\\\srv\\x` são absolutos depois da troca, no normalizador e no plano', () => {
  for (const abs of ['\\a', '\\\\srv\\x', '\\', '\\a\\b']) {
    assert.equal(normalizarCaminho(abs), null, JSON.stringify(abs));
    const r = validarPlano(plano(t('a', [], [abs])));
    assert.equal(r.ok, false, JSON.stringify(abs));
    if (!r.ok) assert.match(r.erro, /caminho inválido/);
  }
  assert.equal(normalizarCaminho('a\\b'), 'a/b', 'barra invertida no meio continua separador');
});

test('normaliza-igual-posix-no-relativo: sem `node:path` no núcleo, o oráculo vive só aqui', () => {
  const alfabeto = ['a', '.', '..', '/', '\\', '', 'C:'];
  const ehRelativoSimples = (o: string, c: string): boolean => !c.includes('\0') && !/^[A-Za-z]:/.test(c) && !/^[A-Za-z]:/.test(o) && !o.startsWith('/') && o !== '' && o !== '.' && o !== '..' && !o.startsWith('../');
  let comparados = 0;
  let escapam = 0;
  const gera = (prefixo: string[], fundo: number): void => {
    const c = prefixo.join('');
    const oraculo = posix.normalize(c.replace(/\\/g, '/') || '.').replace(/\/+$/, '');
    const n = normalizarCaminho(c);
    // idempotência: o que sai normalizado entra normalizado (escopoDaTask re-normaliza `arquivos` já guardados)
    if (n !== null) assert.equal(normalizarCaminho(n), n, `n(n(x)) != n(x) para ${JSON.stringify(c)}`);
    if (!c.includes('\0') && !c.replace(/\\/g, '/').startsWith('/') && oraculo.startsWith('../')) {
      assert.equal(n, null, `escapa da raiz: ${JSON.stringify(c)}`);
      escapam++;
    }
    if (ehRelativoSimples(oraculo, c)) {
      assert.equal(n, oraculo, JSON.stringify(c));
      comparados++;
    } else if (c.replace(/\\/g, '/').startsWith('/')) {
      assert.equal(normalizarCaminho(c), null, `absoluto: ${JSON.stringify(c)}`);
    }
    if (fundo === 0) return;
    for (const x of alfabeto) gera([...prefixo, x], fundo - 1);
  };
  gera([], 5);
  assert.ok(comparados > 500, `comparou só ${comparados}`);
  assert.ok(escapam > 500, `só ${escapam} entradas que escapam da raiz`);
});

test('normaliza-idempotente-com-prefixo-de-unidade: `X:` vale para a SAÍDA, não só a entrada (r2 MAJOR 1)', () => {
  assert.equal(normalizarCaminho('./a:b'), normalizarCaminho('a:b'));
  assert.equal(normalizarCaminho('./a:b'), null);
  for (const c of ['./C:\\x', 'd/../c:x', './x:', 'a/../b:/c', 'C:/../a', 'c:/x/../..']) {
    assert.equal(normalizarCaminho(c), null, JSON.stringify(c));
  }
  assert.equal(normalizarCaminho('./ab:c'), 'ab:c', 'só uma letra seguida de `:` é unidade');
  assert.equal(normalizarCaminho('x/a:b'), 'x/a:b', 'dois-pontos fora do começo é nome');
});

test('ponto-ponto-nao-desempilha-ponto-ponto: a guarda da pilha defende a raiz (r2 MAJOR 2)', () => {
  for (const c of ['../../a', '../../../a', 'a/../../../b', '../a/../../b']) assert.equal(normalizarCaminho(c), null, JSON.stringify(c));
  assert.equal(normalizarCaminho('a/../b'), 'b');
});

// ---- E4 (GM-12 T1): `titulo` por task (≤ 40 colunas, sem controle) e a fiação do painel (exports, casarAgente, renderPainel, fixtures).

test('plano-titulo-41-colunas: 40 cabe, 41 recusa; coluna não é caractere (CJK vale 2)', () => {
  const com = (titulo: unknown) => validarPlano(plano({ ...t('a'), titulo }));
  const ok40 = com('x'.repeat(40));
  assert.equal(ok40.ok, true);
  if (ok40.ok) assert.equal(ok40.plano.tasks[0].titulo, 'x'.repeat(40));
  const r = com('x'.repeat(41));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /titulo/);
  assert.equal(com('漢'.repeat(20)).ok, true, '20 CJK = 40 colunas');
  const largo = com('漢'.repeat(21));
  assert.equal(largo.ok, false, '21 CJK = 42 colunas, embora 21 caracteres');
  if (!largo.ok) assert.match(largo.erro, /titulo/);
  assert.equal(com('x'.repeat(39) + '漢').ok, false, '39 + 1 largo = 41');
  assert.equal(com('x'.repeat(38) + '漢').ok, true, '38 + 1 largo = 40');
  assert.equal(com('😀'.repeat(20)).ok, true, '20 emoji = 40 colunas');
  assert.equal(com('😀'.repeat(21)).ok, false, '21 emoji = 42 colunas');
});

test('plano-titulo-usa-a-mesma-colunas-do-painel (T4 desvio 4): marca, modificador de pele e invisível valem 0; ▶ vale 1', () => {
  const com = (titulo: unknown) => validarPlano(plano({ ...t('a'), titulo }));
  assert.equal(com('x'.repeat(40) + '\u0301').ok, true, '40 colunas + marca combinante (0) = 40');
  assert.equal(com('x'.repeat(40) + '\u200b').ok, true, 'ZWSP vale 0');
  assert.equal(com('👍🏽'.repeat(20)).ok, true, '20 × (base 2 + modificador 0) = 40');
  assert.equal(com('👍🏽'.repeat(21)).ok, false, '42');
  assert.equal(com('▶'.repeat(40)).ok, true, '▶ é glifo de 1 coluna (exceção declarada)');
  assert.equal(com('🇧🇷'.repeat(20)).ok, true, 'bandeira = 2: 20 bandeiras = 40');
  assert.equal(com('🇧🇷'.repeat(21)).ok, false);
});

test('plano-carrega-sozinho-com-formas-e-painel-largura: dist/plano.js numa pasta só com formas.js e painel-largura.js valida título; as demais entradas carregam sem TDZ', () => {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const so = mkdtempSync(join(tmpdir(), 'plano-so-'));
  for (const n of ['plano.js', 'formas.js', 'painel-largura.js']) cpSync(join(dist, n), join(so, n));
  const isolado = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { validarPlano } = await import(${JSON.stringify(join(so, 'plano.js'))}); const t = (titulo) => validarPlano({ entrega: 'X', tasks: [{ id: 'a', deps: [], arquivos: [], titulo }] }).ok; console.log(t('x'.repeat(40) + '\\u0301'), t('x'.repeat(41)))`], { encoding: 'utf8' });
  assert.equal(isolado.trim(), 'true false', 'título medido em colunas pela painel-largura isolada');
  for (const m of ['plano', 'loop', 'emenda', 'painel-largura', 'painel-texto', 'painel-equipe', 'painel']) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(join(dist, `${m}.js`))}); console.log(Object.keys(m).length)`], { encoding: 'utf8' });
    assert.ok(Number(out.trim()) > 0, m);
  }
  // o plano de verdade valida título com a `colunas` do painel, carregando só `plano.js` (a entrada do ciclo)
  const r = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { validarPlano } = await import(${JSON.stringify(join(dist, 'plano.js'))}); console.log(validarPlano({ entrega: 'X', tasks: [{ id: 'a', deps: [], arquivos: [], titulo: 'x'.repeat(40) + '\\u0301' }] }).ok)`], { encoding: 'utf8' });
  assert.equal(r.trim(), 'true');
});

test('plano-titulo-controle: caractere de controle recusa, e titulo vazio ou que não é texto também', () => {
  const com = (titulo: unknown) => validarPlano(plano({ ...t('a'), titulo }));
  for (const c of ['a\u0007b', 'a\nb', 'a\tb', 'a\u001b[31mb', 'a\u007fb', 'a\u009bb', '\u0000']) {
    const r = com(c);
    assert.equal(r.ok, false, JSON.stringify(c));
    if (!r.ok) assert.match(r.erro, /titulo/);
  }
  for (const v of ['', '   ', 7, null, {}, [], ['x'], true]) {
    const r = com(v);
    assert.equal(r.ok, false, JSON.stringify(v));
    if (!r.ok) assert.match(r.erro, /titulo/);
  }
});

test('plano-sem-titulo-ok: titulo ausente segue válido e não aparece no plano; presente é preservado byte a byte', () => {
  const sem = validarPlano(plano(t('a'), { ...t('b', ['a']), titulo: ' Projeção do painel ' }));
  assert.equal(sem.ok, true);
  if (sem.ok) {
    assert.equal(Object.hasOwn(sem.plano.tasks[0], 'titulo'), false);
    assert.equal(sem.plano.tasks[1].titulo, ' Projeção do painel ');
  }
  const undef = validarPlano(plano({ ...t('a'), titulo: undefined }));
  assert.equal(undef.ok, true);
  if (undef.ok) assert.equal(Object.hasOwn(undef.plano.tasks[0], 'titulo'), false);
});

test('diario-exports-do-painel: EM_TRABALHO, duracoes e mediana saem do diário sem mudar de regra', () => {
  assert.deepEqual([...EM_TRABALHO].sort(), ['concluida', 'corrigindo', 'em_revisao', 'implementando']);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  const T0 = Date.UTC(2026, 10, 3, 10, 0, 0);
  const e = (seq: number, s: number, tipo: Evento['tipo'], dados: Record<string, unknown>): Evento => ({
    seq, ts: new Date(T0 + s * 1000).toISOString(), autor: 'a', sessao: 's1', agente: 'o', tipo, dados, hash_anterior: null,
  });
  const ciclo: Evento[] = [
    e(1, 0, 'task.iniciada', { task: 'T1', papel: 'implementador' }), e(2, 0, 'task.concluida', { task: 'T1' }),
    e(3, 0, 'task.iniciada', { task: 'T1', papel: 'revisor' }),
    e(4, 300, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }),
  ];
  assert.deepEqual(duracoes(ciclo), [300]);
  assert.deepEqual(duracoes([]), []);
});

const plan = (...ids: string[]): Plano => ({ entrega: 'GM-12', tasks: ids.map((id) => ({ id, deps: [], arquivos: [] })) });

test('casarAgente-exato: "<task> <papel>" com task do plano e papel conhecido, depois de trim', () => {
  const p = plan('T1', 'T2', 'T10');
  assert.deepEqual(casarAgente('T1 implementador', p), { task: 'T1', papel: 'implementador' });
  assert.deepEqual(casarAgente('T2 revisor', p), { task: 'T2', papel: 'revisor' });
  assert.deepEqual(casarAgente('T10 correcao', p), { task: 'T10', papel: 'correcao' });
  assert.deepEqual(casarAgente('  T1 revisor \n', p), { task: 'T1', papel: 'revisor' });
});

test('casarAgente-nunca-por-aproximacao: espaço extra, caixa, papel ou task desconhecidos, texto a mais ⇒ null', () => {
  const p = plan('T1', 'T2');
  for (const d of ['T1  revisor', 'T1\trevisor', 't1 revisor', 'T1 Revisor', 'T1 REVISOR', 'T1 reviewer', 'T1 correção', 'T9 revisor', 'T1 revisor extra', 'x T1 revisor',
    'T1', 'revisor', '', '   ', 'T1 ', 'T1-revisor', 'T1 revisor T2', 'T1 implementador\nT2 revisor', 'T 1 revisor', '__proto__ revisor', 'constructor revisor', 'toString revisor']) {
    assert.equal(casarAgente(d, p), null, JSON.stringify(d));
  }
});

test('casarAgente-ausente-x-corrompido: description que não é texto e plano vazio ⇒ null, sem lançar', () => {
  const p = plan('T1');
  for (const d of [undefined, null, 7, {}, [], ['T1 revisor'], { toString: () => 'T1 revisor' }]) {
    assert.doesNotThrow(() => casarAgente(d as unknown as string, p));
    assert.equal(casarAgente(d as unknown as string, p), null);
  }
  assert.equal(casarAgente('T1 revisor', { entrega: 'x', tasks: [] }), null);
});

const entradaMinima = (extra: Partial<EntradaPainel> = {}): EntradaPainel => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 40, agentes: [],
  pacote: { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }, notificacao: null, agoraMs: 0, fuso: 'UTC',
  titulo: null, politica: { politica: 'continua', dias: null }, base: 'main', entregaId: 'GM-12', modeloSessao: null, specSha: null, tetoSombra: 26, ...extra,
});

test('projetarEquipe-stub: devolve equipe vazia, sem lançar; líder e sábio vêm do pacote', () => {
  const eq = projetarEquipe(plan('T1'), [], entradaMinima({ limites: { h5: 42, d7: 17 } }));
  assert.deepEqual(eq.agentes, []);
  assert.deepEqual(eq.revisoresAguardando, []);
  assert.equal(eq.lider.nome, 'GANDALF');
  assert.equal(eq.sombra.nome, 'ELROND');
  assert.equal(eq.sombra.decisoes, 0);
  assert.equal(eq.sombra.ultima, null);
  assert.equal(eq.lider.x, 40);
  assert.equal(eq.lider.h5, 42);
  assert.equal(eq.lider.d7, 17);
  assert.deepEqual(eq.lider.tok, null);
  assert.equal(entradaMinima({ x: 33 }).x, 33);
  assert.equal(projetarEquipe(plan('T1'), [], entradaMinima({ x: 33 })).lider.x, 33);
});

test('renderPainel-despacha-por-preset: cada preset chama o seu render; preset desconhecido não vira sucesso', () => {
  const e = ESTADOS['vazio'];
  const o = { tema: 'mono' as const, narracao: true, largura: 80 };
  const esq = renderPainel(e, { ...o, preset: 'esquadrao' });
  const exe = renderPainel(e, { ...o, preset: 'executivo' });
  assert.deepEqual(esq, renderEsquadrao(e, { ...o, preset: 'esquadrao' }));
  assert.deepEqual(exe, renderExecutivo(e, { ...o, preset: 'executivo' }));
  assert.notDeepEqual(esq, exe);
  assert.throws(() => renderPainel(e, { ...o, preset: 'outro' as unknown as 'esquadrao' }), /preset/);
  assert.throws(() => renderPainel(e, { ...o, preset: undefined as unknown as 'esquadrao' }), /preset/);
});

test('fixtures-do-painel: 10 estados nomeados, cada um com a forma completa de EstadoPainel e o conteúdo que o nome promete', () => {
  assert.deepEqual([...NOMES_ESTADOS], ['vazio', 'em-voo-7-12', 'emenda-aberta', 'pausado', 'parou-teto', 'parou-diario', 'concluir-release', 'deploy-devolvido', 'spec-aguardando', 'sem-limites-sem-uso']);
  assert.deepEqual(Object.keys(ESTADOS), [...NOMES_ESTADOS]);
  const CHAVES = ['id', 'titulo', 'pacote', 'plano', 'equipe', 'parado', 'parar', 'depende', 'atencao', 'historico', 'ocultos', 'rodape', 'notificacao', 'qualidade'];
  for (const n of NOMES_ESTADOS) {
    const e = ESTADOS[n];
    assert.deepEqual(Object.keys(e).sort(), [...CHAVES].sort(), n);
    assert.deepEqual(Object.keys(e.plano).sort(), ['eta', 'feitas', 'medianaS', 'pct', 'rodadaMedia', 'tasks', 'total'], n);
    assert.deepEqual(Object.keys(e.equipe).sort(), ['agentes', 'lider', 'revisoresAguardando', 'sombra', 'vivos'], n);
    assert.deepEqual(Object.keys(e.equipe.lider).sort(), ['ctx', 'd7', 'h5', 'modelo', 'narrativa', 'nome', 'tok', 'x'], n);
    assert.deepEqual(Object.keys(e.rodape).sort(), ['ci', 'politica', 'prod'], n);
    assert.equal(e.plano.total, e.plano.tasks.length, `${n}: total = tasks`);
    assert.equal(e.plano.feitas, e.plano.tasks.filter((x) => x.estado === 'integrada').length, `${n}: feitas = integradas`);
    assert.equal(e.plano.pct, e.plano.total === 0 ? 0 : Math.round((e.plano.feitas / e.plano.total) * 100), `${n}: pct`);
    assert.equal(e.parado, e.parar !== null || n === 'pausado', `${n}: parado = PAROU ou pausa`);
    for (const tk of e.plano.tasks) {
      const fixo: Record<string, string> = { integrada: '✓', pendente: '○', no_teto: '✗' };
      if (tk.estado in fixo) assert.equal(tk.glifo, fixo[tk.estado], `${n} ${tk.id} glifo`);
      else assert.ok(['●', '◐'].includes(tk.glifo), `${n} ${tk.id} glifo`);
    }
  }
  const E = ESTADOS;
  assert.equal(E['vazio'].plano.total, 0);
  assert.equal(E['vazio'].plano.eta, null);
  assert.equal(E['vazio'].depende.length, 0);
  assert.equal(E['em-voo-7-12'].plano.total, 12);
  assert.equal(E['em-voo-7-12'].plano.feitas, 7);
  assert.equal(E['em-voo-7-12'].plano.pct, 58);
  assert.ok(E['em-voo-7-12'].equipe.agentes.length >= 2);
  assert.ok(E['em-voo-7-12'].plano.eta !== null);
  assert.ok(E['emenda-aberta'].depende.some((d) => d.nivel === 'dono' && d.acoes.some((a) => /^\/gabarito-mestre:emenda aprovar \d+$/.test(a.comando ?? ''))));
  assert.equal(E['pausado'].parar, null);
  assert.ok(E['pausado'].depende.some((d) => d.acoes.some((a) => a.comando === '/gabarito retomar')));
  assert.equal(E['parou-teto'].parar?.motivo, 'teto_rodadas');
  assert.equal(E['parou-teto'].depende[0].nivel, 'parar');
  assert.equal(E['parou-diario'].parar?.motivo, 'diario_invalido');
  assert.equal(E['parou-diario'].plano.pct, 67);
  assert.ok(E['concluir-release'].depende.some((d) => /^merge da release para /.test(d.motivo)));
  assert.equal(E['concluir-release'].plano.feitas, E['concluir-release'].plano.total);
  assert.ok(E['deploy-devolvido'].depende.some((d) => d.acoes.some((a) => /^node <plugin>\/gates\/scripts\/entrega\.mjs executar --entrega \S+$/.test(a.comando ?? ''))));
  assert.ok(E['spec-aguardando'].depende.some((d) => d.acoes.some((a) => a.comando === '/gabarito-mestre:aprovar')));
  assert.equal(E['sem-limites-sem-uso'].equipe.lider.h5, null);
  assert.equal(E['sem-limites-sem-uso'].equipe.lider.d7, null);
  assert.equal(E['sem-limites-sem-uso'].equipe.lider.ctx, null);
  assert.ok(E['sem-limites-sem-uso'].equipe.agentes.length > 0 && E['sem-limites-sem-uso'].equipe.agentes.every((a) => a.ctxPct === null && a.ctxTok === null));
});

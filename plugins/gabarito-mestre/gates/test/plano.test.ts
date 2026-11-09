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
import { posix } from 'node:path';
import { validarPlano, temDependencia, normalizarCaminho } from '../src/plano.ts';

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

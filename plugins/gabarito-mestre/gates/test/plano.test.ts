/**
 * Testes de validarPlano (REQ-LOOP-1). Mutações prescritas (task-1-mut.json):
 *  M1 sem detecção de ciclo ⇒ plano-ciclo falha
 *  M2 sem checagem de dep inexistente ⇒ plano-dep-inexistente falha
 *  M3 sem checagem de id repetido ⇒ plano-id-repetido falha
 *  M4 colisão ignora dependência (sempre erro) ⇒ plano-arquivo-colide-com-dep-transitiva-ok falha
 *  M5 sem normalizar caminho ⇒ plano-arquivo-normalizado falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarPlano } from '../src/plano.ts';

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

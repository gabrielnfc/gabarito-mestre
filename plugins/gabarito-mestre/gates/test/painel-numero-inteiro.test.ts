/**
 * T14b (review final, MAJOR 1): número nunca é cortado em NENHUMA linha do render, nos dois presets.
 * Todas as fixtures de estados.ts (ESTADOS + EXTRAS) × larguras 20..200, sem altura e com altura: nenhum token numérico (\d+(k|M|%|m|h)?) termina em `…`.
 * O que cede é texto, na ordem que cada linha já usa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEsquadrao } from '../src/painel-esquadrao.ts';
import { renderExecutivo } from '../src/painel-executivo.ts';
import { colunas } from '../src/painel-largura.ts';
import { cortarLinha } from '../src/painel-texto.ts';
import type { EstadoPainel, Linha, OpcoesRender } from '../src/tipos.ts';
import { ESTADOS, EXTRAS } from './painel-fixtures/estados.ts';

const TEXTO = (l: Linha): string => l.map((s) => s.texto).join('');
const todos: [string, EstadoPainel][] = [...Object.entries(ESTADOS), ...Object.entries(EXTRAS)];
const clone = <T>(x: T): T => structuredClone(x);
// token numérico solto (não parte de id como T8, E4, GM-12) terminado em `…`: 127, 62k, 1M, 64%, 9m, 2h, #12
const CORTADO = /(?<![A-Za-z0-9_-])\d+([.,]\d+)?(k|M|%|m|h)?…/;

function renderiza(preset: 'esquadrao' | 'executivo', e: EstadoPainel, largura: number, altura?: number): string[] {
  const o: OpcoesRender = { preset, tema: 'mono', narracao: true, largura, ...(altura === undefined ? {} : { altura }) };
  return (preset === 'esquadrao' ? renderEsquadrao(e, o) : renderExecutivo(e, o)).map(TEXTO);
}

/** Fixtures com revisor aguardando e contagens de 1, 2 e 3 dígitos (o caso do review: 127 ⇒ "hoje, 1…"). */
function variantes(): [string, EstadoPainel][] {
  const out: [string, EstadoPainel][] = [...todos.map(([n, e]) => [n, clone(e)] as [string, EstadoPainel])];
  for (const [m, k] of [[3, 1], [11, 2], [127, 100], [1234, 1234]]) {
    const e = clone(ESTADOS['em-voo-7-12']);
    e.equipe.revisoresAguardando = [{ nome: 'GIMLI', task: 'T10', mutacoesHoje: m, mortasHoje: k }, { nome: null, task: 'T11', mutacoesHoje: m, mortasHoje: k }];
    out.push([`revisor-${m}`, e]);
  }
  return out;
}

for (const preset of ['esquadrao', 'executivo'] as const) {
  for (const comAltura of [false, true]) {
    test(`numero-inteiro-${preset}-${comAltura ? 'com' : 'sem'}-altura: nenhum token numérico termina em … (todas as fixtures × larguras 20..200)`, () => {
      let linhas = 0;
      for (const [nome, e] of variantes()) {
        for (let w = 20; w <= 200; w++) {
          const alturas = comAltura ? [1, 8, 14, 20, 30] : [undefined];
          for (const alt of alturas) {
            for (const l of renderiza(preset, clone(e), w, alt)) {
              linhas++;
              assert.ok(colunas(l) <= w, `${preset} ${nome} ${w}x${alt}: estourou em "${l}"`);
              assert.doesNotMatch(l, CORTADO, `${preset} ${nome} ${w}x${alt}: número cortado em "${l}"`);
            }
          }
        }
      }
      assert.ok(linhas > 20_000, `a propriedade viu ${linhas} linhas`);
    });
  }
}

test('numero-inteiro-cortarLinha: o corte nunca deixa token numérico (com unidade, hora, data, #seq) terminado em …; id (T8, GM-12) não é número', () => {
  const textos = ['ctx 31% 62k · 9m', 'tok 1.2M e 2h', 'ETA 10/11 09:00 ±9m', 'decidiu #41 seguir', 'a 62k xyz', 'hoje, 127 mutações'];
  for (const txt of textos) {
    for (let n = 1; n <= txt.length + 1; n++) {
      const l = cortarLinha([{ texto: txt }], n).map((s) => s.texto).join('');
      assert.ok(colunas(l) <= n, `"${txt}" em ${n}: estourou ("${l}")`);
      assert.doesNotMatch(l, CORTADO, `"${txt}" em ${n}: número cortado em "${l}"`);
    }
  }
  // o recuo leva o token inteiro, com a unidade e o separador que o ligava ao texto
  assert.equal(cortarLinha([{ texto: 'a 62k xyz' }], 6).map((s) => s.texto).join(''), 'a…');
  assert.equal(cortarLinha([{ texto: 'hoje, 127 mutações' }], 8).map((s) => s.texto).join(''), 'hoje…');
  assert.equal(cortarLinha([{ texto: 'ctx ' }, { texto: '31% ' }, { texto: '62k' }], 10).map((s) => s.texto).join(''), 'ctx…', 'o recuo atravessa segmentos e leva também o 31% que ficou colado ao corte');
  // id não é número: `T8…` fica (texto cortado, não dado)
  assert.equal(cortarLinha([{ texto: 'loop segue em T8 T9' }], 17).map((s) => s.texto).join(''), 'loop segue em T8…');
  // linha que cabe volta igual
  assert.deepEqual(cortarLinha([{ texto: '62k' }], 3), [{ texto: '62k' }]);
});

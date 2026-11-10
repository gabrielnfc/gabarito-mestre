/**
 * T14b (review final, D2 da Sombra): densidade por altura. `OpcoesRender.altura?` ausente ⇒ saída byte a byte igual; presente e o desenho maior ⇒ tiram-se linhas
 * ACIMA do 1º agente vivo, numa ordem fixa por preset, até o último agente vivo caber. Fonte: sombra-t14.md §D2 "Correção (c)" itens 1–4.
 *   Esquadrão: separadores · narrativa ▶ · linha 5h/7d · fila (2 linhas viram 1) · faixa ✓ integradas.   Executivo: separadores · Limites · Contexto · Produção.
 * Mutações prescritas: task-14b-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPainel } from '../src/painel.ts';
import { blocoTopo, paraTexto } from '../src/painel-texto.ts';
import { colunas } from '../src/painel-largura.ts';
import type { EstadoPainel, Linha, OpcoesRender } from '../src/tipos.ts';
import { ESTADOS, EXTRAS } from './painel-fixtures/estados.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PRESETS = ['esquadrao', 'executivo'] as const;
type Preset = (typeof PRESETS)[number];
const TEXTO = (l: Linha): string => l.map((s) => s.texto).join('');
const clone = <T>(x: T): T => structuredClone(x);
const todos: [string, EstadoPainel][] = [...Object.entries(ESTADOS), ...Object.entries(EXTRAS)];
const op = (preset: Preset, largura: number, altura?: unknown): OpcoesRender => ({ preset, tema: 'mono', narracao: true, largura, ...(altura === undefined ? {} : { altura: altura as number }) });
const linhas = (e: EstadoPainel, preset: Preset, largura: number, altura?: unknown): string[] => renderPainel(e, op(preset, largura, altura)).map(TEXTO);
const voo = (): EstadoPainel => clone(ESTADOS['em-voo-7-12']);
const ehAgente = (preset: Preset) => (l: string): boolean => (preset === 'esquadrao' ? /^[├└]─? ● /.test(l) : /^● /.test(l));

/** Fixture com `n` agentes vivos (1 ou 3), copiando o 1º com nomes e tasks distintos. */
function comVivos(n: 1 | 3): EstadoPainel {
  const e = voo();
  const [a, b] = e.equipe.agentes;
  e.equipe.agentes = n === 1 ? [a] : [a, b, { ...a, nome: 'ARAGORN', task: 'T10', estadoTask: 'implementando' }];
  e.equipe.vivos = n;
  return e;
}

test('alt-ausente-identico: altura ausente ⇒ goldens 44/60/72/80 dos dois presets sem diff; altura inválida ou maior que o desenho ⇒ a mesma saída (deepEqual)', () => {
  for (const preset of PRESETS) {
    for (const w of [44, 60, 72, 80]) {
      const gold = readFileSync(join(AQUI, 'painel-golden', `${preset}-${w}.txt`), 'utf8');
      assert.equal(`${paraTexto(renderPainel(voo(), op(preset, w)), 'mono')}\n`, gold, `${preset}-${w}`);
      assert.equal(`${paraTexto(renderPainel(voo(), op(preset, w, 1000)), 'mono')}\n`, gold, `${preset}-${w}: altura de sobra muda a saída`);
    }
    for (const [nome, e] of todos) {
      for (let w = 20; w <= 200; w += 3) {
        const base = renderPainel(clone(e), op(preset, w));
        for (const alt of [1000, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, '9' as unknown]) {
          if (typeof alt === 'number' && alt >= 1 && Number.isFinite(alt)) continue;
          assert.deepEqual(renderPainel(clone(e), op(preset, w, alt)), base, `${preset} ${nome} ${w}: altura ${String(alt)} muda a saída`);
        }
        assert.deepEqual(renderPainel(clone(e), op(preset, w, 1000)), base, `${preset} ${nome} ${w}: altura 1000 muda a saída`);
      }
    }
  }
});

test('alt-agente-na-janela (propriedade): 1 e 3 vivos × larguras 44..200 × alturas do mínimo a 40 ⇒ todo agente vivo está nas `altura` primeiras; topo inteiro; nada passa da largura', () => {
  let casos = 0;
  const fixtures: [string, EstadoPainel][] = [['1-vivo', comVivos(1)], ['3-vivos', comVivos(3)], ['emenda-aberta', ESTADOS['emenda-aberta']], ['parou-teto', ESTADOS['parou-teto']], ['pausado', ESTADOS['pausado']]];
  for (const preset of PRESETS) {
    for (const [nome, e] of fixtures) {
      for (let w = 44; w <= 200; w += w < 90 ? 1 : 5) {
        const sem = linhas(clone(e), preset, w);
        const nAgentes = sem.filter(ehAgente(preset)).length;
        const topo = blocoTopo(clone(e), w).map(TEXTO);
        // o mínimo é onde cai o último agente vivo depois de TODOS os cortes (altura 1 corta tudo o que pode)
        const cortado = linhas(clone(e), preset, w, 1);
        const minimo = Math.max(0, ...cortado.map((l, i) => (ehAgente(preset)(l) ? i + 1 : 0)));
        for (let alt = Math.max(1, minimo); alt <= 40; alt++) {
          const ls = linhas(clone(e), preset, w, alt);
          casos++;
          const ags = ls.map((l, i) => [l, i] as const).filter(([l]) => ehAgente(preset)(l));
          assert.equal(ags.length, nAgentes, `${preset} ${nome} ${w}x${alt}: agente cortado`);
          for (const [l, i] of ags) assert.ok(i < alt, `${preset} ${nome} ${w}x${alt}: agente na linha ${i + 1} (> ${alt}): "${l}"`);
          for (const t of topo) assert.ok(ls.includes(t), `${preset} ${nome} ${w}x${alt}: topo cortado: "${t}"`);
          for (const l of ls) assert.ok(colunas(l) <= w, `${preset} ${nome} ${w}x${alt}: passou da largura: "${l}"`);
        }
        if (nome === '1-vivo' || nome === '3-vivos') assert.ok(minimo >= 1 && minimo <= 20, `${preset} ${nome} ${w}: mínimo ${minimo}`);
      }
    }
  }
  assert.ok(casos > 10_000, `a propriedade viu ${casos} casos`);
});

test('alt-ordem-dos-cortes (Esquadrão 80): separadores → narrativa ▶ → 5h/7d → fila → faixa ✓; líder, ctx, PLANO e tasks em voo nunca saem', () => {
  const tem = (ls: string[], re: RegExp): boolean => ls.some((l) => re.test(l));
  const sep = (ls: string[]): number => ls.filter((l) => /^─+$/.test(l)).length;
  const inteiro = linhas(voo(), 'esquadrao', 80);
  assert.equal(inteiro.length, 27);
  // o último agente vivo está na linha 18; 18 ou mais não corta nada
  assert.deepEqual(linhas(voo(), 'esquadrao', 80, 18), inteiro);
  // 16 e 17 exigem só (1): os 2 separadores ACIMA do agente caem (os 2 de baixo ficam), TUDO o mais fica (inclusive a narrativa e a linha de ctx do líder)
  for (const alt of [16, 17]) {
    const ls = linhas(voo(), 'esquadrao', 80, alt);
    assert.equal(sep(ls), 2, `${alt}: separadores acima do agente ficaram, ou os de baixo caíram`);
    assert.ok(tem(ls, /^│ {2}▶ esperando o loop$/), `${alt}: a narrativa caiu cedo`);
    assert.ok(tem(ls, /^│ {2}5h .* 7d /), `${alt}: 5h/7d caiu cedo`);
    assert.ok(tem(ls, /^│ {2}ctx .* 36%/), `${alt}: a linha de ctx do líder caiu`);
    assert.equal(ls.length, 25, `${alt}: 27 − 2 separadores`);
  }
  // 15: (2) a narrativa cai; 5h/7d fica
  let ls = linhas(voo(), 'esquadrao', 80, 15);
  assert.ok(!tem(ls, /▶ esperando/) && tem(ls, /^│ {2}5h /), '15');
  // 14: (3) 5h/7d cai; as duas linhas de fila ficam
  ls = linhas(voo(), 'esquadrao', 80, 14);
  assert.ok(!tem(ls, /^│ {2}5h /) && tem(ls, /○ T11 .*fila · depende de T8/) && tem(ls, /○ T12 {2}fila/), '14');
  // 13: (4) a fila vira 1 linha `○ T11–T12  fila`
  ls = linhas(voo(), 'esquadrao', 80, 13);
  assert.ok(tem(ls, /^ {2}○ T11–T12 {2}fila$/) && !tem(ls, /depende de T8/) && !tem(ls, /○ T12/), `13: ${ls.join('|')}`);
  assert.ok(tem(ls, /✓ T1–T7/), '13: a faixa ainda fica');
  // 12: (5) a faixa ✓ cai; nada mais pode cair
  for (const alt of [12, 5, 1]) {
    ls = linhas(voo(), 'esquadrao', 80, alt);
    assert.ok(!tem(ls, /✓ T1/), `${alt}: faixa ficou`);
    for (const re of [/^GABARITO/, /^depende de você/, /^PLANO/, /● T8 /, /● T9 /, /◐ T10 /, /○ T11–T12/, /^EQUIPE/, /^GANDALF {2}orquestra/, /^│ {2}ctx /, /^├─ ● GIMLI/, /^├─ ● LEGOLAS/, /^├─ ◐ revisor/, /^└─ ○ ELROND/, /^◆ ATENÇÃO/, /^CI /]) assert.ok(tem(ls, re), `${alt}: faltou ${String(re)}`);
    assert.equal(ls.length, 27 - 2 - 1 - 1 - 1 - 1, `${alt}: só as 6 linhas das 5 classes, acima do agente, caem`);
  }
  // abaixo do agente não se corta: revisor aguardando, Sombra, ATENÇÃO, histórico e rodapé ficam mesmo com a janela menor que o desenho
  assert.deepEqual(linhas(voo(), 'esquadrao', 80, 1).slice(-8), inteiro.slice(-8), 'o que fica abaixo dos agentes é o mesmo, separadores inclusive');
});

test('alt-ordem-dos-cortes (Executivo 80): separadores → Limites → Contexto → Produção; Entrega, Previsão, Tasks, Qualidade, CI e os agentes nunca saem', () => {
  const tem = (ls: string[], re: RegExp): boolean => ls.some((l) => re.test(l));
  const inteiro = linhas(voo(), 'executivo', 80);
  assert.equal(inteiro.length, 17);
  const fixos = [/^GABARITO/, /^depende de você/, /^Entrega /, /^Previsão /, /^Tasks /, /^Qualidade /, /^CI /, /^Agentes em voo/, /^● implementador 1/, /^● revisor 1/, /^◐ revisor/, /^○ Sombra/];
  assert.deepEqual(linhas(voo(), 'executivo', 80, 15), inteiro, 'o último agente está na linha 15: 15 não corta nada');
  for (const alt of [13, 14]) {
    const ls = linhas(voo(), 'executivo', 80, alt);
    assert.equal(ls.filter((l) => /^─+$/.test(l)).length, 0, `${alt}: separador ficou`);
    for (const re of [/^Produção/, /^Contexto/, /^Limites/]) assert.ok(tem(ls, re), `${alt}: ${String(re)} caiu cedo`);
    assert.equal(ls.length, 15, 'os 2 separadores estão acima dos agentes');
  }
  let ls = linhas(voo(), 'executivo', 80, 12);
  assert.ok(!tem(ls, /^Limites/) && tem(ls, /^Contexto/) && tem(ls, /^Produção/), '12');
  ls = linhas(voo(), 'executivo', 80, 11);
  assert.ok(!tem(ls, /^Contexto/) && tem(ls, /^Produção/), '11');
  for (const alt of [10, 4, 1]) {
    ls = linhas(voo(), 'executivo', 80, alt);
    for (const re of [/^Produção/, /^Contexto/, /^Limites/]) assert.ok(!tem(ls, re), `${alt}: ${String(re)} ficou`);
    for (const re of fixos) assert.ok(tem(ls, re), `${alt}: faltou ${String(re)}`);
    assert.equal(ls.length, 17 - 2 - 3);
  }
});

test('alt-sem-agente-vivo-nao-corta: sem agente vivo não há o que proteger, a altura não muda nada', () => {
  for (const preset of PRESETS) {
    for (const nome of ['vazio', 'sem-mod', 'sem-agente'] as const) {
      const e = nome === 'vazio' ? ESTADOS.vazio : EXTRAS[nome];
      assert.deepEqual(linhas(clone(e), preset, 80, 3), linhas(clone(e), preset, 80), `${preset} ${nome}`);
    }
  }
});

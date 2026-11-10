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

// ───────────── r2: propriedade das classes de corte (review r1, MAJOR 1: `marca('narr')` fora do `if` retroetiquetava a linha anterior) ─────────────

/** Oráculo INDEPENDENTE do código: classifica as linhas do desenho inteiro (sem altura) por texto e aplica a ordem da Sombra (sombra-t14.md §D2 item 1). */
const CLASSES_ESQ = ['sep', 'narr', 'lim', 'fila', 'faixa'] as const;
function classeEsq(ls: string[], i: number): string {
  const l = ls[i];
  if (/^─+$/.test(l)) return 'sep';
  if (/^│ {2}▶ /.test(l)) return 'narr';
  if (/^│ {2}(5h|7d) /.test(l)) return 'lim';
  if (/^ {2}✓ /.test(l)) return 'faixa';
  // duas linhas de fila seguidas (`  ○ Tn … fila` e `  ○ Tn  fila`): a 1ª vira a junta, a 2ª cai
  if (/^ {2}○ \S+ .*fila/.test(l) && i + 1 < ls.length && /^ {2}○ \S+ +fila$/.test(ls[i + 1])) return 'fila1';
  if (/^ {2}○ \S+ +fila$/.test(l) && i > 0 && /^ {2}○ \S+ .*fila/.test(ls[i - 1])) return 'fila2';
  return '';
}
function oraculoEsq(inteiro: string[], alt: number): (string | null)[] {
  let cur: (string | null)[] = [...inteiro];
  const cls = inteiro.map((_, i) => classeEsq(inteiro, i));
  let idx = cur.map((_, i) => i);
  const vivo = (i: number): boolean => ehAgente('esquadrao')(inteiro[i]);
  for (const c of CLASSES_ESQ) {
    const ultimo = idx.reduce((u, k, pos) => (vivo(k) ? pos : u), -1);
    if (ultimo < 0 || ultimo < alt) break;
    const novo: number[] = [];
    const novoCur: (string | null)[] = [];
    idx.forEach((k, pos) => {
      const t = cls[k];
      const da = t === c || (c === 'fila' && (t === 'fila1' || t === 'fila2'));
      if (!da || pos > ultimo) { novo.push(k); novoCur.push(cur[pos]); return; }
      if (c === 'fila' && t === 'fila1') { novo.push(k); novoCur.push(null); } // a junta: texto não conferido aqui (teste da ordem confere)
    });
    idx = novo; cur = novoCur;
  }
  return cur;
}

test('alt-classes-nunca-saem-fora-da-vez (propriedade, Esquadrão): narração on/off/vazia × com/sem 5h/7d × fila 0/1/2 × larguras 20..200 × alturas 1..30 ⇒ saída = oráculo; líder, ctx do líder, PLANO, tasks em voo e todo agente vivo ficam', () => {
  let casos = 0;
  const variantes: [string, (e: EstadoPainel) => void][] = [
    ['base', () => {}],
    ['sem-5h7d', (e) => { e.equipe.lider.h5 = null; e.equipe.lider.d7 = null; }],
    ['so-5h', (e) => { e.equipe.lider.d7 = null; }],
    ['narrativa-vazia', (e) => { e.equipe.lider.narrativa = ''; }],
    ['narrativa-vazia-sem-5h7d', (e) => { e.equipe.lider.narrativa = ''; e.equipe.lider.h5 = null; e.equipe.lider.d7 = null; }],
    ['fila-0', (e) => { e.plano.tasks = e.plano.tasks.filter((x) => x.estado !== 'pendente'); }],
    ['fila-1', (e) => { let n = 0; e.plano.tasks = e.plano.tasks.filter((x) => x.estado !== 'pendente' || n++ < 1); }],
    ['fila-0-sem-5h7d', (e) => { e.plano.tasks = e.plano.tasks.filter((x) => x.estado !== 'pendente'); e.equipe.lider.h5 = null; e.equipe.lider.d7 = null; }],
  ];
  for (const [nome, mexe] of variantes) {
    for (const narracao of [true, false]) {
      const mk = (): EstadoPainel => { const e = comVivos(3); mexe(e); return e; };
      for (let w = 20; w <= 200; w++) {
        const o = (altura?: number): OpcoesRender => ({ preset: 'esquadrao', tema: 'mono', narracao, largura: w, ...(altura === undefined ? {} : { altura }) });
        const inteiro = renderPainel(mk(), o()).map(TEXTO);
        if (w >= 72 && w % 8 === 0) {
          for (const re of [/^GANDALF {2}orquestra/, /^│ {2}ctx .*36%/, /^PLANO/, /● T8 /, /^├─ ● /]) assert.ok(inteiro.some((l) => re.test(l)), `${nome} n=${narracao} ${w}: o desenho inteiro não tem ${String(re)}`);
        }
        for (let alt = 1; alt <= 30; alt++) {
          const got = renderPainel(mk(), o(alt)).map(TEXTO);
          const esp = oraculoEsq(inteiro, alt);
          casos++;
          assert.equal(got.length, esp.length, `${nome} n=${narracao} ${w}x${alt}: ${got.length} linhas, o oráculo espera ${esp.length}\n${got.join('\n')}`);
          esp.forEach((l, i) => { if (l !== null) assert.equal(got[i], l, `${nome} n=${narracao} ${w}x${alt}: linha ${i}`); });
          // as classes protegidas são as que o oráculo NUNCA remove: toda linha sem classe do desenho inteiro está na saída cortada
          const protegidas = inteiro.filter((_, i) => classeEsq(inteiro, i) === '');
          let j = 0;
          for (const l of got) if (l === protegidas[j]) j++;
          assert.equal(j, protegidas.length, `${nome} n=${narracao} ${w}x${alt}: linha protegida saiu (${protegidas[j]})`);
        }
      }
    }
  }
  assert.ok(casos > 20_000, `a propriedade viu ${casos} casos`);
});

test('alt-ordem-sem-narrativa: sem narrativa (narração off, 60–71 col ou vazia) 5h/7d cai no passo 3 e a linha de ctx do líder fica mesmo sem 5h/7d, a 1 linha de altura', () => {
  const tem = (ls: string[], re: RegExp): boolean => ls.some((l) => re.test(l));
  for (const [rotulo, w, narracao, narr] of [['narração off', 80, false, 'esperando o loop'], ['65 col', 65, true, 'esperando o loop'], ['narrativa vazia', 80, true, '']] as const) {
    const mk = (limites: boolean): EstadoPainel => { const e = voo(); e.equipe.lider.narrativa = narr; if (!limites) { e.equipe.lider.h5 = null; e.equipe.lider.d7 = null; } return e; };
    const ro = (e: EstadoPainel, altura: number): string[] => renderPainel(e, { preset: 'esquadrao', tema: 'mono', narracao, largura: w, altura }).map(TEXTO);
    const inteiro = ro(mk(true), 1000);
    const ultimo = inteiro.reduce((u, l, i) => (ehAgente('esquadrao')(l) ? i : u), -1);
    // exige só os separadores (passo 1): 5h/7d tem de ficar
    const semSep = inteiro.length - inteiro.slice(0, ultimo).filter((l) => /^─+$/.test(l)).length;
    assert.ok(tem(ro(mk(true), ultimo), /^│ {2}5h /), `${rotulo}: 5h/7d caiu no passo 1/2`);
    assert.equal(ro(mk(true), ultimo).length, semSep, `${rotulo}: só os separadores deviam cair`);
    assert.ok(tem(ro(mk(true), 1), /^│ {2}ctx .*36%/) && tem(ro(mk(false), 1), /^│ {2}ctx .*36%/), `${rotulo}: a linha de ctx do líder caiu`);
    assert.ok(tem(ro(mk(false), 1), /^GANDALF {2}orquestra/), `${rotulo}: líder caiu`);
  }
});

test('alt-classes-nunca-saem-fora-da-vez (propriedade, Executivo): com/sem Limites × com/sem ctx × larguras 20..200 × alturas 1..30 ⇒ saída = oráculo; só sep → Limites → Contexto → Produção caem, agentes e o resto ficam', () => {
  const CL = ['sep', 'lim', 'ctx', 'prod'] as const;
  const classe = (l: string): string => (/^─+$/.test(l) ? 'sep' : /^(Limites|Lim) /.test(l) ? 'lim' : /^(Contexto|Ctx) /.test(l) ? 'ctx' : /^(Produção|Prd) /.test(l) ? 'prod' : '');
  let casos = 0;
  const variantes: [string, (e: EstadoPainel) => void][] = [
    ['base', () => {}],
    ['sem-limites', (e) => { e.equipe.lider.h5 = null; e.equipe.lider.d7 = null; }],
    ['sem-ctx', (e) => { e.equipe.lider.ctx = null; }],
    ['sem-nada', (e) => { e.equipe.lider.h5 = null; e.equipe.lider.d7 = null; e.equipe.lider.ctx = null; }],
  ];
  for (const [nome, mexe] of variantes) {
    for (const narracao of [true, false]) {
      const mk = (): EstadoPainel => { const e = comVivos(3); mexe(e); return e; };
      for (let w = 20; w <= 200; w++) {
        const o = (altura?: number): OpcoesRender => ({ preset: 'executivo', tema: 'mono', narracao, largura: w, ...(altura === undefined ? {} : { altura }) });
        const inteiro = renderPainel(mk(), o()).map(TEXTO);
        const cls = inteiro.map(classe);
        const vivo = inteiro.map(ehAgente('executivo'));
        for (let alt = 1; alt <= 30; alt++) {
          let idx = inteiro.map((_, i) => i);
          for (const c of CL) {
            const ultimo = idx.reduce((u, k, pos) => (vivo[k] ? pos : u), -1);
            if (ultimo < 0 || ultimo < alt) break;
            idx = idx.filter((k, pos) => cls[k] !== c || pos > ultimo);
          }
          const got = renderPainel(mk(), o(alt)).map(TEXTO);
          casos++;
          assert.deepEqual(got, idx.map((k) => inteiro[k]), `${nome} n=${narracao} ${w}x${alt}`);
          assert.equal(got.filter(ehAgente('executivo')).length, vivo.filter(Boolean).length, `${nome} ${w}x${alt}: agente saiu`);
        }
      }
    }
  }
  assert.ok(casos > 10_000, `a propriedade viu ${casos} casos`);
});

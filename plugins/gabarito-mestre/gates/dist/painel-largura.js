/**
 * Núcleo de largura do painel (E4, GM-12 T2b r2): `GLIFOS`, `limpar`, `colunas` e `cortar`.
 * SEM nenhum import: `plano.ts` mede o título com a mesma `colunas` do render, e o hook Stop carrega `dist/plano.js` antes de `loop.js`
 * e `diario.js`. Se este módulo importasse algo do painel, `plano.js` passaria a depender de `loop.js` (ciclo plano → painel-texto → loop →
 * emenda → plano) e os testes de "dist ausente" do Stop falhariam no lugar errado. `painel-texto.ts` re-exporta estes nomes.
 * Núcleo puro: sem `node:*`, sem `Intl.Segmenter` (o mod carrega o `dist/`).
 */

// ───────────────────────────── limpeza e largura ─────────────────────────────

/** Controle C0, DEL, C1 (inclui `\x1b` e `\x9b`), separadores de linha/parágrafo e bidi: viram espaço (como `diario.ts:352-353`). */
const CONTROLE_G = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;
const CONTROLE_1 = /^[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]$/u;
const MARCA_1 = /^[\p{Mn}\p{Me}]$/u;
const PICTO_1 = /^\p{Extended_Pictographic}$/u;
const ZWJ = 0x200d;

/** Glifos do painel, todos de largura 1 (Global Constraints). `▶` é pictográfico no Unicode, mas o terminal o desenha em 1 coluna. */
export const GLIFOS                    = ['▰', '▱', '█', '░', '✓', '●', '◐', '○', '◌', '✗', '■', '◆', '▲', '▼', '▶', '─', '│', '├', '└', '·'];
const GLIFOS_LARGURA_1                      = new Set(GLIFOS.map((g) => g.codePointAt(0)          ));

/** Troca controle por espaço. Não texto vira `''`. */
export function limpar(s        )         {
  return typeof s === 'string' ? s.replace(CONTROLE_G, ' ') : '';
}

/** East Asian Wide/Fullwidth: Hangul Jamo, CJK (inclui Hiragana/Katakana), Hangul, compatibilidade, Fullwidth Forms. `…` e `·` ficam fora: 1 coluna. */
function largo(p        )          {
  return (
    (p >= 0x1100 && p <= 0x115f) || (p >= 0x2e80 && p <= 0xa4cf) || (p >= 0xac00 && p <= 0xd7a3) || (p >= 0xf900 && p <= 0xfaff) ||
    (p >= 0xfe30 && p <= 0xfe6f) || (p >= 0xff00 && p <= 0xff60) || (p >= 0xffe0 && p <= 0xffe6) || (p >= 0x20000 && p <= 0x3fffd)
  );
}

/** Formato de largura 0 que não é marca: ZWSP, ZWNJ, LRM, RLM, word joiner e invisíveis, BOM e ALM. (ZWJ, VS e marcas têm tratamento próprio.) */
const ZERO_FORMATO                      = new Set([0x200b, 0x200c, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x061c]);
const ehModificador = (p        )          => p >= 0x1f3fb && p <= 0x1f3ff;
const ehIndicadorRegional = (p        )          => p >= 0x1f1e6 && p <= 0x1f1ff;
const ehTag = (p        )          => p === 0xe0001 || (p >= 0xe0020 && p <= 0xe007f);

/** Memória de um passo ao outro da varredura: o ponto anterior, se ele foi pictográfico (e de 1 coluna) e se há indicador regional aberto. */
                                                                                     
const inicio = ()            => ({ ant: 0, picto: false, picto1: false, riAberto: false });

/**
 * Colunas de um ponto de código (já sem controle) e se ele COLA no anterior (não é fronteira de corte): depois de ZWJ, modificador de pele
 * depois de pictográfico, keycap (U+20E3 depois de VS16), tag, 2º indicador regional do par (a bandeira). `v` é atualizado.
 */
function passo(c        , p        , v           )                               {
  const ant = v.ant;
  let w        ;
  let cola = ant === ZWJ;
  let picto = false;
  let picto1 = false;
  let riAberto = false;
  if (p >= 0x20 && p <= 0x7e) w = 1; // caminho rápido: ASCII imprimível
  else if (CONTROLE_1.test(c)) w = 1; // vira espaço
  else if (p === 0xfe0f) w = v.picto1 ? 1 : 0; // VS16 transforma o glifo de 1 coluna (▶) em emoji de 2
  else if (p === 0x20e3 && ant === 0xfe0f) { w = 1; cola = true; } // keycap: dígito + VS16 + U+20E3 = 2 colunas
  else if (p === ZWJ || p === 0xfe0e || MARCA_1.test(c) || ZERO_FORMATO.has(p)) w = 0;
  else if (ehTag(p)) { w = 0; cola = true; }
  else if (ehModificador(p)) {
    if (v.picto) { w = 0; cola = true; } else { w = 2; picto = true; }
  } else if (ehIndicadorRegional(p)) {
    w = 1;
    if (v.riAberto) cola = true;
    else riAberto = true;
  } else if (PICTO_1.test(c)) {
    w = ant === ZWJ ? 0 : GLIFOS_LARGURA_1.has(p) ? 1 : 2;
    picto = true;
    picto1 = w === 1;
  } else w = largo(p) ? 2 : 1;
  v.ant = p;
  v.picto = picto;
  v.picto1 = picto1;
  v.riAberto = riAberto;
  return { w, cola };
}

/** Colunas de terminal do texto já limpo. Marca, ZWJ, seletor, formato invisível e modificador de pele valem 0; pictográfico após ZWJ vale 0; Wide e pictográfico 2; bandeira e keycap 2; resto 1. Linear. */
export function colunas(s        )         {
  if (typeof s !== 'string') return 0;
  let n = 0;
  const v = inicio();
  for (const c of s) n += passo(c, c.codePointAt(0)          , v).w;
  return n;
}

/**
 * Corta por coluna, com `…` no fim quando corta. `max` não finito ou ≤ 0 ⇒ `''`; `max` não inteiro ⇒ `floor`; cabe ⇒ `limpar(s)`; `max === 1` ⇒ `…`.
 * O prefixo tem no máximo `max − 1` colunas, nunca parte par substituto, nunca separa marca, ZWJ, modificador de pele, bandeira ou keycap da base; caractere de 2 colunas que não cabe sai inteiro.
 * Para no 1º excesso (não varre o resto de um texto enorme).
 */
export function cortar(s        , max        )         {
  if (typeof s !== 'string' || typeof max !== 'number') return '';
  const m = Math.floor(max);
  if (!Number.isFinite(m) || m <= 0) return '';
  let w = 0;
  let corte = 0;
  let idx = 0;
  const v = inicio();
  for (const c of s) {
    const p = c.codePointAt(0)          ;
    const { w: mw, cola } = passo(c, p, v);
    // fronteira de grupo: só antes de um ponto que ocupa coluna e que não está colado ao anterior
    if (!cola && mw > 0 && w <= m - 1) corte = idx;
    w += mw;
    if (w > m) return m === 1 ? '…' : `${limpar(s.slice(0, corte))}…`;
    idx += c.length;
  }
  return limpar(s);
}


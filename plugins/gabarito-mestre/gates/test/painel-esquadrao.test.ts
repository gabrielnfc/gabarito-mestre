/**
 * Testes do preset Esquadrão (GM-12 T5, REQ-PNL-4/5/9). Mutações prescritas: .superpowers/sdd/2026-11-09-e4-painel/task-5-mut.json
 * Fonte das tabelas: sombra-p1c.md, "Task 5". Todo campo que o render lê tem asserção que LÊ o valor (P15: `esq-cada-campo-lido`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEsquadrao } from '../src/painel-esquadrao.ts';
import { renderPainel, projetarPainel } from '../src/painel.ts';
import { blocoTopo, paraTexto } from '../src/painel-texto.ts';
import { colunas } from '../src/painel-largura.ts';
import type { AgenteVivo, EntradaPainel, EstadoPainel, Evento, Linha, OpcoesRender, PacoteNomes, Plano, TipoEvento } from '../src/tipos.ts';
import { ESTADOS, EXTRAS } from './painel-fixtures/estados.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TEXTO = (l: Linha): string => l.map((s) => s.texto).join('');
const LINHAS = (ls: Linha[]): string[] => ls.map(TEXTO);
const todos: [string, EstadoPainel][] = [...Object.entries(ESTADOS), ...Object.entries(EXTRAS)];
const clone = <T>(x: T): T => structuredClone(x);
const op = (largura: number, extra: Partial<OpcoesRender> = {}): OpcoesRender => ({ preset: 'esquadrao', tema: 'mono', narracao: true, largura, ...extra });
const render = (e: EstadoPainel, largura: number, extra: Partial<OpcoesRender> = {}): string[] => LINHAS(renderEsquadrao(e, op(largura, extra)));
const voo = (): EstadoPainel => clone(ESTADOS['em-voo-7-12']);
const achar = (ls: string[], re: RegExp): string => ls.find((l) => re.test(l)) ?? '';

// ---------- cabeçalho, plano, faixa, fila ----------

test('esq-cabecalho-pacote: GABARITO · id título à esquerda, esquadrão · pacote em minúsculas encostado à direita', () => {
  const ls = render(voo(), 80);
  assert.equal(ls[0].length, 80);
  assert.ok(ls[0].startsWith('GABARITO · GM-12 E4 Painel'), ls[0]);
  assert.ok(ls[0].endsWith('esquadrão · terra média'), ls[0]);
  const sem = voo();
  sem.titulo = null;
  assert.ok(render(sem, 80)[0].startsWith('GABARITO · GM-12 '), 'título null ⇒ só o id');
  assert.equal(render(sem, 80)[0].includes('E4 Painel'), false);
  const larga = render(voo(), 40 + 48)[0];
  assert.ok(larga.endsWith('esquadrão · terra média'), larga);
});

test('esq-cabecalho-primeiro-segmento: o 1º segmento é exatamente "GABARITO · <id>" e o título vem em segmento próprio (alinhar só preserva o 1º)', () => {
  const e = voo();
  e.id = 'GM-12-ABCD';
  e.titulo = 'Um título bem comprido que não cabe ao lado do pacote';
  e.pacote = 'Pacote Com Nome Muito Longo Mesmo';
  assert.equal(renderEsquadrao(e, op(120))[0][1].texto.startsWith(' Um título'), true, 'título em segmento próprio');
  for (const w of [60, 61, 64, 67, 68, 70, 80]) {
    const l = renderEsquadrao(e, op(w))[0];
    assert.equal(l[0].texto, 'GABARITO · GM-12-ABCD', `w=${w}`);
    assert.ok(colunas(TEXTO(l)) <= w);
    assert.ok(TEXTO(l).startsWith('GABARITO · GM-12-ABCD'), `o id nunca é cortado, w=${w}`);
    // dir inteira ou ausente, nunca meia: a direita só aparece se coube inteira
    const dir = 'esquadrão · pacote com nome muito longo mesmo';
    assert.ok(TEXTO(l).endsWith(dir) || !TEXTO(l).includes('esquadrão'), `w=${w}: ${TEXTO(l)}`);
  }
});

test('esq-faixa-integradas: ✓ T1–T7, rodada média com 1 casa e mediana em min; não contígua vira N tasks; sem integrada some', () => {
  const ls = render(voo(), 72);
  assert.ok(ls.some((l) => /^ {2}✓ T1–T7 {3}integradas · 1\.4 rodada média · mediana 18 min$/.test(l)), ls.join('\n'));
  const e = voo();
  e.plano.rodadaMedia = null;
  e.plano.medianaS = null;
  assert.ok(render(e, 72).some((l) => /^ {2}✓ T1–T7 {3}integradas$/.test(l)), 'sem dado nenhum: só "integradas"');
  e.plano.tasks[2] = { ...e.plano.tasks[2], estado: 'concluida', glifo: '◐' };
  assert.ok(render(e, 72).some((l) => l.includes('✓ 6 tasks')), 'buraco ⇒ N tasks');
  assert.equal(render(ESTADOS['vazio'], 72).some((l) => l.includes('✓')), false, 'sem integrada, sem faixa');
  assert.equal(render(ESTADOS['spec-aguardando'], 72).some((l) => l.includes('✓')), false);
});

test('esq-fila-depende: 1ª pendente com deps ainda abertas; as demais numa linha de faixa; dep já integrada não aparece', () => {
  const ls = render(voo(), 80);
  assert.ok(ls.some((l) => /^ {2}○ T11 +Task T11 +fila · depende de T8$/.test(l)), ls.join('\n'));
  assert.ok(ls.some((l) => /^ {2}○ T12 {2}fila$/.test(l)), 'a demais, só a faixa');
  const e = voo();
  e.plano.tasks = e.plano.tasks.map((t) => (t.id === 'T12' ? { ...t, estado: 'pendente' as const } : t));
  e.plano.tasks = e.plano.tasks.map((t) => (t.id === 'T11' ? { ...t, deps: ['T1', 'T8'] } : t)); // T1 integrada: não conta
  assert.ok(render(e, 80).some((l) => /○ T11 .*fila · depende de T8$/.test(l)));
  e.plano.tasks = e.plano.tasks.map((t) => (t.id === 'T11' ? { ...t, deps: ['T1'] } : t));
  assert.ok(render(e, 80).some((l) => /○ T11 .*fila$/.test(l)), 'nenhuma dep aberta ⇒ só "fila"');
  const tres = voo();
  tres.plano.tasks.push({ id: 'T13', titulo: 'x', estado: 'pendente', glifo: '○', deps: [] });
  tres.plano.total = 13;
  assert.ok(render(tres, 80).some((l) => /○ T12–T13 {2}fila$/.test(l)), 'faixa contígua');
});

// ---------- líder, limites, ctx ----------

test('esq-limite-ausente-omitido: h5/d7 null omitem a parte; 0 aparece como 0%; os dois null omitem a linha (MUT-PNL-5b)', () => {
  const e = voo();
  e.equipe.lider.h5 = 0;
  e.equipe.lider.d7 = null;
  let ls = render(e, 80);
  assert.ok(ls.some((l) => /^│ {2}5h █*░* 0%$/.test(l)), ls.join('\n'));
  assert.equal(ls.some((l) => l.includes('7d')), false);
  e.equipe.lider.h5 = null;
  e.equipe.lider.d7 = 0;
  ls = render(e, 80);
  assert.ok(ls.some((l) => /^│ {2}7d █*░* 0%$/.test(l)));
  assert.equal(ls.some((l) => l.includes('5h')), false);
  e.equipe.lider.d7 = null;
  ls = render(e, 80);
  assert.equal(ls.some((l) => l.includes('5h') || l.includes('7d')), false, 'os dois null ⇒ linha omitida');
  assert.equal(ls.some((l) => /^│ {2}$/.test(l)), false, 'nem linha vazia sobra');
});

test('esq-ctx-traco-sem-uso: ctx null do líder escreve "ctx —" sem barra e sem %; tok null escreve "tok —"', () => {
  const ls = render(ESTADOS['sem-limites-sem-uso'], 80);
  const l = achar(ls, /^│ {2}ctx/);
  assert.match(l, /^│ {2}ctx — · pouso em 50% {3}tok —$/);
  assert.equal(/[█░]/.test(l), false);
  assert.equal(ls.some((x) => x.includes('GANDALF  orquestra') && x.includes('·')), false, 'modelo null ⇒ sem " · modelo"');
  assert.ok(ls.includes('GANDALF  orquestra'));
});

test('esq-sem-pct-so-tokens: agente com ctxPct null e ctxTok presente escreve ctx 88k, sem barra e sem %', () => {
  const ls = render(EXTRAS['pct-so-tokens'], 80);
  const l = achar(ls, /^├─ ● GIMLI/);
  assert.match(l, /ctx 88k/);
  assert.equal(/%/.test(l), false);
  assert.equal(/ctx [█░]/.test(l), false);
  const e = clone(EXTRAS['pct-so-tokens']);
  e.equipe.agentes[0].ctxTok = null;
  assert.match(achar(render(e, 80), /^├─ ● GIMLI/), /ctx —/, 'os dois null ⇒ ctx —');
});

test('esq-tok-nunca-desenhado: a linha do agente mostra ctxTok (88k), nunca tok (900k); trocar tok não muda o texto', () => {
  const e = voo();
  e.equipe.agentes[0].tok = 900_000;
  e.equipe.agentes[0].ctxTok = 88_000;
  e.equipe.agentes[0].ctxPct = 44;
  const ls = render(e, 80);
  const l = achar(ls, /^├─ ● GIMLI/);
  assert.match(l, /88k/);
  assert.equal(ls.join('\n').includes('900k'), false);
  const b = voo();
  const c = voo();
  c.equipe.agentes[0].tok = 1;
  assert.deepEqual(render(b, 80), render(c, 80));
});

test('esq-sombra-planmode: a Sombra usa planMode; o líder não tem cor de identidade; cor do agente vem de a.cor', () => {
  const ls = renderEsquadrao(voo(), op(80));
  const sombra = ls.find((l) => l.some((s) => s.texto === 'ELROND'))!;
  assert.equal(sombra.find((s) => s.texto === 'ELROND')!.cor, 'planMode');
  const lider = ls.find((l) => l.some((s) => s.texto === 'GANDALF'))!;
  assert.equal(lider.find((s) => s.texto === 'GANDALF')!.cor, undefined, 'líder sem cor de identidade');
  const gimli = ls.find((l) => TEXTO(l).startsWith('├─ ● GIMLI'))!;
  assert.equal(gimli.find((s) => s.texto.trim() === 'GIMLI')!.cor, 'claude');
  assert.equal(gimli.find((s) => s.texto === '●')!.cor, 'success', 'glifo pela tabela T-E');
});

// ---------- larguras ----------

test('esq-narracao-off-sem-historico: sem hh:mm glifo, sem ▼, sem ▶', () => {
  for (const nome of ['em-voo-7-12', 'parou-teto']) {
    for (const w of [44, 60, 72, 80, 120]) {
      const ls = render(ESTADOS[nome as keyof typeof ESTADOS], w, { narracao: false });
      const txt = ls.join('\n');
      assert.equal(/^\d\d:\d\d [^ ]/m.test(txt), false, `${nome} ${w}`);
      assert.equal(txt.includes('▼'), false, `${nome} ${w}`);
      assert.equal(txt.includes('▶'), false, `${nome} ${w}`);
    }
  }
  assert.ok(render(voo(), 80, { narracao: true }).join('\n').includes('▶'), 'com narração, o ▶ existe');
});

test('esq-60-sem-titulo-sem-narrativa: 60–71 sem coluna de título nem ▶ do líder; 72 tem os dois', () => {
  const t60 = render(voo(), 60).join('\n');
  assert.equal(t60.includes('Task T8'), false);
  assert.equal(t60.includes('esperando o loop'), false, 'sem narrativa do líder');
  assert.ok(/● T8 {3}implementando/.test(t60), t60);
  const t72 = render(voo(), 72).join('\n');
  assert.ok(t72.includes('Task T8'));
  assert.ok(t72.includes('│  ▶ esperando o loop'));
});

test('esq-44-desenho: cabeçalho curto com barra 12, tasks sem título, árvore com ├ e └, ATENÇÃO só com ◆, rodapé curto', () => {
  const ls = render(voo(), 44);
  assert.match(ls[0], /^GM-12 ▰{7}▱{5} 58% ETA 17:42$/, 'previsão curta, sem ±');
  assert.ok(ls.includes('● T8 GIMLI    implementando    9m'), ls.join('\n'));
  assert.ok(ls.includes('○ T11–T12 fila'));
  assert.ok(ls.some((l) => /^GANDALF ctx █+░+ 36%$/.test(l)));
  assert.ok(ls.includes('│ 5h 42% 7d 18% tok 412k'));
  assert.ok(ls.includes('├ ● GIMLI   31% 62k'));
  assert.ok(ls.includes('├ ◐ revisor aguarda T10'), 'sem sufixo de mutações em 44');
  assert.ok(ls.includes('└ ○ ELROND #41'));
  assert.ok(ls.some((l) => l.startsWith('◆ T9 na 2ª rodada')));
  assert.equal(ls.some((l) => l.includes('ATENÇÃO')), false);
  assert.ok(ls.includes('CI ● verde  PROD 2/0  ▼ 11'), 'K = ocultos 9 + 2 não mostradas');
  assert.equal(ls.some((l) => l.includes('EQUIPE') || l.includes('orquestra')), false);
  assert.equal(ls.filter((l) => /^\d\d:\d\d /.test(l)).length, 1, 'histórico: 1 linha');
});

test('esq-menor-44-so-essencial: topo, plano numa linha e as tasks em voo; sem separador, equipe, histórico nem rodapé', () => {
  const ls = render(voo(), 43);
  assert.deepEqual(ls, ['depende de você: nada', '7/12 · ETA 17:42', '● T8 implementando', '● T9 em revisão', '◐ T10 aguarda revisão']);
  const p = render(ESTADOS['parou-diario'], 30);
  assert.equal(p[0].startsWith('■ PAROU'), true, 'o topo vem antes de tudo');
  assert.ok(p.includes('4/6 · loop parado'));
});

test('esq-bordas-de-faixa: a faixa muda exatamente em 44, 60, 72 e 80 (≥)', () => {
  assert.equal(render(voo(), 43).some((l) => l.includes('─')), false, '43: sem separador');
  assert.equal(render(voo(), 44).some((l) => l.includes('─')), true, '44: com separador');
  assert.equal(render(voo(), 59).some((l) => l.includes('GABARITO')), false, '59: cabeçalho curto');
  assert.equal(render(voo(), 60).some((l) => l.includes('GABARITO')), true, '60: cabeçalho completo');
  assert.equal(render(voo(), 59).some((l) => l.includes('EQUIPE')), false);
  assert.equal(render(voo(), 60).some((l) => l.includes('EQUIPE')), true);
  const hist = (w: number): number => render(ESTADOS['parou-teto'], w).filter((l) => /^\d\d:\d\d /.test(l)).length;
  assert.deepEqual([hist(43), hist(44), hist(59), hist(60), hist(71), hist(72)], [0, 1, 1, 3, 3, 4]);
  assert.equal(render(voo(), 71).some((l) => l.includes('Task T8')), false, '71: sem título');
  assert.equal(render(voo(), 72).some((l) => l.includes('Task T8')), true, '72: com título');
  assert.equal(render(voo(), 71).join('\n').includes('▶ esperando'), false);
  assert.equal(render(voo(), 72).join('\n').includes('▶ esperando'), true);
  const longo = voo();
  longo.plano.tasks = longo.plano.tasks.map((t) => ({ ...t, titulo: 'x'.repeat(40) }));
  const maior = (w: number): number => Math.max(...render(longo, w).map((l) => Math.max(0, ...(l.match(/x+/g) ?? []).map((m) => m.length))));
  assert.equal(maior(79), 23, '72–79: coluna de 24 (23 + …)');
  assert.equal(maior(80), 31, '≥ 80: min(40, w − 48) = 32 (31 + …)');
  assert.equal(maior(100), 40, 'w − 48 = 52 ⇒ teto 40, e 40 colunas cabem inteiras');
});

// ---------- topo, estados ----------

test('esq-topo-identico-ao-blocoTopo: as linhas do topo são as de blocoTopo(e, w), contíguas e logo depois do cabeçalho (antes de tudo em < 44)', () => {
  for (const [n, e] of todos) {
    for (const w of [20, 30, 43, 44, 59, 60, 72, 80, 120]) {
      const ls = renderEsquadrao(e, op(w));
      const topo = blocoTopo(e, w);
      const i = w < 44 ? 0 : 1;
      assert.deepEqual(ls.slice(i, i + topo.length), topo, `${n} w=${w}`);
    }
  }
});

test('esq-tema-nao-muda-linhas: o render nunca lê o tema', () => {
  for (const [n, e] of todos) {
    for (const w of [44, 72, 100]) assert.deepEqual(renderEsquadrao(e, op(w, { tema: 'mono' })), renderEsquadrao(e, op(w, { tema: 'color' })), `${n} ${w}`);
  }
});

test('esq-parado-sem-eta: com Parar a linha PLANO é "loop parado", sem ETA nem ±, mesmo com eta válido', () => {
  const e = ESTADOS['parou-teto'];
  assert.notEqual(e.plano.eta, null);
  for (const w of [60, 80]) {
    const plano = achar(render(e, w), /^PLANO/);
    assert.ok(plano.endsWith('loop parado'), plano);
    assert.equal(/ETA|±/.test(plano), false);
  }
  assert.ok(render(e, 44)[0].endsWith('loop parado'));
  const d = render(ESTADOS['parou-diario'], 72);
  assert.ok(achar(d, /^PLANO/).includes('4/6 tasks'), 'parou-diario: tasks parciais e eta null');
  assert.ok(achar(d, /^PLANO/).endsWith('loop parado'));
  assert.ok(d[0].startsWith('GABARITO'));
  assert.ok(d.some((l) => l.startsWith('■ PAROU')), 'o bloco PAROU vem do topo');
  assert.ok(render(e, 80).some((l) => l.includes('■ PAROU · teto de rodadas')), 'histórico com o ■');
  const hist = renderEsquadrao(e, op(80)).find((l) => TEXTO(l).includes('■ PAROU ·'))!;
  assert.equal(hist.find((s) => s.texto === '■')!.cor, 'error');
});

test('esq-pausado: PLANO "loop pausado" e a narrativa do líder', () => {
  const ls = render(ESTADOS['pausado'], 80);
  assert.ok(achar(ls, /^PLANO/).endsWith('loop pausado'));
  assert.ok(ls.includes('│  ▶ pausado, nada novo é despachado'));
  assert.ok(ls.some((l) => l.includes('loop pausado') && !l.startsWith('PLANO')), 'o item do topo');
});

test('esq-todas-integradas: faixa ✓ T1–T12, nenhuma task, "todas integradas"', () => {
  const ls = render(ESTADOS['concluir-release'], 80);
  assert.ok(ls.some((l) => /✓ T1–T12 {3}integradas · 1\.3 rodada média · mediana 17 min/.test(l)), ls.join('\n'));
  assert.ok(achar(ls, /^PLANO/).endsWith('todas integradas'));
  assert.ok(achar(ls, /^PLANO/).includes('12/12 tasks'));
  assert.equal(ls.some((l) => /^ {2}[●◐○✗] T/.test(l)), false, 'nenhuma linha de task');
});

test('esq-plano-vazio: 0/0 tasks, ETA sem dados, sem faixa ✓ e sem fila; equipe só líder + Sombra', () => {
  const ls = render(ESTADOS['vazio'], 80);
  const plano = achar(ls, /^PLANO/);
  assert.ok(plano.includes('0/0 tasks') && plano.includes('0%'), plano);
  assert.ok(plano.endsWith('ETA sem dados'));
  assert.equal(ls.some((l) => l.includes('✓') || l.includes('○ T')), false);
  assert.ok(ls.includes('EQUIPE' + ' '.repeat(80 - 'EQUIPE'.length - 'agentes 0 vivos'.length) + 'agentes 0 vivos'));
  assert.equal(ls.some((l) => l.startsWith('├─')), false);
  assert.ok(ls.some((l) => l.startsWith('└─ ○ ELROND')));
  const c = render(ESTADOS['vazio'], 50);
  assert.equal(c.some((l, i) => l.startsWith('─') && c[i + 1]?.startsWith('─')), false, 'sem 2 separadores colados em 44–59');
});

test('esq-sem-mod-traco: vivos null ⇒ agentes —, nenhuma linha de agente, nenhum ◌; revisor aguardando e Sombra continuam', () => {
  const ls = render(EXTRAS['sem-mod'], 80);
  assert.ok(ls.some((l) => /^EQUIPE +agentes —$/.test(l)));
  assert.equal(ls.some((l) => l.includes('agentes 0 vivos')), false);
  assert.equal(ls.some((l) => l.includes('◌')), false);
  assert.equal(ls.some((l) => l.includes('GIMLI    implementando')), false, 'nenhuma linha de agente');
  assert.ok(ls.some((l) => l.includes('◐ revisor aguarda T10')));
  assert.ok(ls.some((l) => l.startsWith('└─ ○ ELROND')));
  assert.ok(ls.some((l) => /^ {2}● T8 .*implementando +GIMLI/.test(l)), 'tasks com ● e o nome do diário');
  const e = clone(EXTRAS['sem-mod']);
  e.equipe.agentes = [{ ...e.equipe.agentes[0] ?? voo().equipe.agentes[0] }];
  assert.equal(render(e, 80).some((l) => l.startsWith('├─ ● ')), false, 'vivos null manda: sem linha de agente');
});

test('esq-zero-vivos-com-sem-agente: mod presente, 0 vivos e 1 ◌ ⇒ "agentes 0 vivos" e a linha ◌', () => {
  const ls = render(EXTRAS['sem-agente'], 80);
  assert.ok(ls.some((l) => /^EQUIPE +agentes 0 vivos$/.test(l)));
  assert.ok(ls.includes('├─ ◌ GIMLI  sem agente · T8'), ls.join('\n'));
  assert.ok(render(EXTRAS['sem-agente'], 44).includes('├ ◌ GIMLI T8'));
  const e = voo();
  e.equipe.agentes = [{ ...e.equipe.agentes[0], vivo: false, ctxPct: null, ctxTok: null }];
  e.equipe.vivos = 0;
  const l2 = render(e, 80);
  assert.ok(l2.some((l) => /agentes 0 vivos$/.test(l)));
  assert.ok(l2.some((l) => l.startsWith('├─ ◌ ')));
  const semNome = clone(EXTRAS['sem-agente']);
  semNome.equipe.agentes[0].nome = null;
  assert.ok(render(semNome, 80).some((l) => l.includes('◌ implementador  sem agente')), 'sem nome ⇒ o papel literal');
});

test('esq-sem-task: vivo sem task escreve "sem task" e a cor do glifo é inactive', () => {
  const ls = renderEsquadrao(EXTRAS['sem-task'], op(80));
  const l = ls.find((x) => TEXTO(x).startsWith('├─ ● sem task'))!;
  assert.match(TEXTO(l), /^├─ ● sem task · sonnet {2}ctx █░{9} 12% {2}24k$/);
  assert.equal(l.find((s) => s.texto === '●')!.cor, 'inactive');
  assert.ok(render(EXTRAS['sem-task'], 44).includes('├ ● sem task 12% 24k'));
});

test('esq-limite-zero-aparece: tok 0 e h5 0 aparecem (ausente ≠ zero)', () => {
  const ls = render(EXTRAS['zeros'], 80);
  assert.ok(ls.some((l) => /tok 0$/.test(l)), 'tok 0');
  assert.ok(ls.some((l) => /^│ {2}5h █*░* 0% {3}7d/.test(l)));
  assert.ok(render(EXTRAS['zeros'], 44).includes('│ 5h 0% 7d 18% tok 0'));
  const e = clone(EXTRAS['zeros']);
  e.rodape.prod = { leituras: 0, alteracoes: 0 };
  assert.ok(render(e, 80).some((l) => l.includes('PROD leu 0 · alterou 0')));
  assert.ok(render(e, 44).some((l) => l.includes('PROD 0/0')));
});

test('esq-revisor-zero-aparece: 0 mutações e 0 mortas aparecem; null em qualquer um omite o sufixo', () => {
  const ls = render(EXTRAS['zeros'], 80);
  assert.ok(ls.includes('├─ ◐ revisor aguarda T10 · 0 mutações do gate hoje, 0 mortas'), ls.join('\n'));
  const e = clone(EXTRAS['zeros']);
  e.equipe.revisoresAguardando[0].mutacoesHoje = null;
  assert.ok(render(e, 80).includes('├─ ◐ revisor aguarda T10'), 'mutacoesHoje null ⇒ sem sufixo');
  e.equipe.revisoresAguardando[0].mutacoesHoje = 3;
  e.equipe.revisoresAguardando[0].mortasHoje = null;
  assert.ok(render(e, 80).includes('├─ ◐ revisor aguarda T10'), 'mortasHoje null ⇒ sem sufixo');
  e.equipe.revisoresAguardando[0].nome = 'GIMLI';
  e.equipe.revisoresAguardando[0].mortasHoje = 3;
  assert.ok(render(e, 80).some((l) => /^├─ ◐ GIMLI +revisa aguarda T10 · 3 mutações do gate hoje, 3 mortas$/.test(l)), render(e, 80).join('\n'));
});

test('esq-sombra-sem-decisao: 0 decisões e ultima null ⇒ só a contagem; 1 decisão no singular; fonte null ⇒ sem parênteses', () => {
  const ls = render(ESTADOS['vazio'], 80);
  assert.ok(ls.includes('└─ ○ ELROND  aconselha · opus  0 decisões'), ls.join('\n'));
  const e = voo();
  e.equipe.sombra = { nome: 'ELROND', modelo: null, decisoes: 1, ultima: { seq: 14, resposta: 'largura mínima 44', fonte: null } };
  assert.ok(render(e, 100).includes('└─ ○ ELROND  aconselha  1 decisão · #14 largura mínima 44'), render(e, 100).join('\n'));
  e.equipe.sombra.ultima!.fonte = 'D10';
  assert.ok(render(e, 100).some((l) => l.endsWith('· #14 largura mínima 44 (D10)')));
  assert.ok(render(e, 44).includes('└ ○ ELROND #14'));
  e.equipe.sombra.ultima = null;
  assert.ok(render(e, 44).includes('└ ○ ELROND 1 dec'));
});

test('esq-historico-orcamento-e-ordem: 4/3/1/0 por faixa, a mais antiga no alto; hora dd/mm e --:-- sem hora', () => {
  const e = EXTRAS['historico-cheio'];
  const linhasH = (w: number): string[] => render(e, w).filter((l) => /^(\d\d:\d\d|\d\d\/\d\d|--:--) /.test(l));
  const h72 = linhasH(72);
  assert.equal(h72.length, 4);
  assert.deepEqual(h72.map((l) => l.match(/evento (\d+)/)![1]), ['4', '3', '2', '1'], 'a mais antiga do orçamento no alto');
  assert.equal(linhasH(60).length, 3);
  assert.equal(linhasH(50).length, 1);
  assert.equal(linhasH(40).length, 0);
  const sem = clone(e);
  sem.historico = [{ glifo: '✓', texto: 'sem hora', hora: '', cor: 'success' }];
  assert.ok(render(sem, 80).includes('--:-- ✓ sem hora'));
  const velho = clone(e);
  velho.historico = [{ glifo: '✓', texto: 'ontem', hora: '08/11 23:50', cor: 'success' }];
  assert.ok(render(velho, 80).includes('08/11 23:50 ✓ ontem'));
});

test('esq-ocultos-somados: ▼ K = ocultos + não mostradas; K = 0 omitido; só ocultos não basta; o rodapé corta o ▼ primeiro', () => {
  // política curta: o rodapé de 72 colunas cabe com o ▼ (com `janela [seg ter qua qui sex]` ele cai, pela regra de cortar da direita)
  const e = clone(EXTRAS['historico-cheio']);
  e.rodape.politica = 'continua';
  assert.ok(render(e, 72).some((l) => l.endsWith('▼ 21 eventos')), render(e, 72).join('\n'));
  assert.ok(render(e, 80).some((l) => l.endsWith('▼ 21 eventos')));
  assert.ok(render(e, 50).some((l) => l.endsWith('▼ 24')), '44–59: 1 mostrada, 19 + 5');
  const zero = voo();
  zero.ocultos = 0; // 3 itens, todos cabem em 72
  zero.rodape.politica = 'continua';
  assert.equal(render(zero, 72).some((l) => l.includes('▼')), false, 'K = 0 ⇒ omitido');
  const so = clone(e);
  so.ocultos = 0;
  assert.ok(render(so, 72).some((l) => l.endsWith('▼ 16 eventos')), 'sem ocultos, as 16 não mostradas contam');
  const ocu = voo();
  ocu.ocultos = 9;
  ocu.rodape.politica = 'continua';
  assert.ok(render(ocu, 72).some((l) => l.endsWith('▼ 9 eventos')), 'só ocultos, tudo cabe');
  assert.equal(render(ocu, 72, { narracao: false }).some((l) => l.includes('▼')), false, 'narração off ⇒ sem ▼');
  const longa = clone(EXTRAS['historico-cheio']); // política de 5 dias: o rodapé de 60 estoura e o ▼ é o que cai
  const r60 = render(longa, 60).find((l) => l.startsWith('CI'))!;
  assert.ok(colunas(r60) <= 60 && !r60.includes('▼') && r60.includes('PROD leu'), r60);
}
);

test('esq-rodape: CI verde/vermelho/—, PROD leu N · alterou M, política; vermelho não usa error', () => {
  const ls = renderEsquadrao(voo(), op(100));
  assert.equal(TEXTO(ls[ls.length - 1]), 'CI ● verde   PROD leu 2 · alterou 0   política janela [seg ter qua qui sex]   ▼ 9 eventos');
  const e = voo();
  e.rodape.ci.verde = false;
  const l = renderEsquadrao(e, op(100));
  assert.match(TEXTO(l[l.length - 1]), /^CI ● vermelho /);
  assert.equal(l[l.length - 1].find((s) => s.texto === '●')!.cor, 'warning');
  e.rodape.ci.verde = null;
  assert.match(TEXTO(renderEsquadrao(e, op(100)).at(-1)!), /^CI ● — /);
});

// ---------- lixo, largura, corrupção ----------

test('esq-sem-itens-cortados: nenhuma linha de nenhuma fixture em nenhuma largura casa os termos cortados da spec', () => {
  const proibido = /slots|serviço pago|autorizar|afetados|\bRED\b|\bGREEN\b|pousad/;
  for (const [n, e] of todos) for (const w of [20, 44, 60, 72, 80, 120]) assert.equal(proibido.test(render(e, w).join('\n')), false, `${n} ${w}`);
});

test('esq-sem-lixo-no-texto: nunca NaN, Infinity, undefined, null ou [object, com dado corrompido', () => {
  const lixo = /NaN|Infinity|undefined|null|\[object/;
  for (const [n, e] of todos) for (const w of [20, 44, 60, 72, 80, 120]) for (const narracao of [true, false]) {
    assert.equal(lixo.test(render(e, w, { narracao }).join('\n')), false, `${n} ${w}`);
  }
  const ls = render(EXTRAS['numeros-corrompidos'], 80);
  const l = achar(ls, /^├─ ● GIMLI/);
  assert.match(l, /ctx 62k/, 'ctxPct NaN trata como ausente e mostra ctxTok');
  assert.equal(/ · /.test(l.split('T8')[1] ?? ''), false, 'desdeS Infinity ⇒ sem tempo');
  assert.ok(achar(ls, /^PLANO/).includes('▱'.repeat(21) + '  —  7/12'), 'pct NaN ⇒ barra vazia e —');
  const neg = clone(voo());
  neg.equipe.agentes[0].desdeS = -30;
  assert.match(achar(render(neg, 80), /^├─ ● GIMLI/), / 0m$/, 'desdeS negativo ⇒ 0m');
  neg.equipe.lider.tok = -1;
  assert.ok(render(neg, 80).some((l) => l.endsWith('tok —')), 'tok negativo ⇒ —');
});

test('esq-nunca-passa-largura: toda linha cabe em largura (1 a 200), com 10 estados + extras, narração on/off', () => {
  for (const [n, e] of todos) {
    for (let w = 1; w <= 200; w++) for (const narracao of [true, false]) {
      for (const [i, l] of renderEsquadrao(e, op(w, { narracao })).entries()) assert.ok(colunas(TEXTO(l)) <= w, `${n} w=${w} linha ${i}: ${TEXTO(l)}`);
    }
  }
});

test('esq-titulos-hostis: CJK, emoji ZWJ e escape: sem \\x1b no texto, nada passa da largura', () => {
  const e = EXTRAS['titulos-hostis'];
  for (const w of [44, 60, 72, 80, 100, 160]) {
    const ls = renderEsquadrao(e, op(w));
    for (const l of ls) for (const s of l) assert.equal(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(s.texto), false, `w=${w} ${JSON.stringify(s.texto)}`);
    assert.equal(paraTexto(ls, 'mono').includes('\x1b'), false);
    for (const l of ls) assert.ok(colunas(TEXTO(l)) <= w);
  }
  assert.ok(render(e, 120)[0].startsWith('GABARITO · GM-12-ABCD'), 'o id (10 colunas) nunca é cortado pelo título');
});

test('estado-ausente-x-corrompido: histórico [] e tasks sem título renderizam sem lançar, cada um do seu jeito', () => {
  const e = voo();
  e.historico = [];
  e.ocultos = 0;
  e.plano.tasks = e.plano.tasks.map((t) => ({ ...t, titulo: undefined }));
  const ls = render(e, 80);
  assert.equal(ls.some((l) => /^\d\d:\d\d /.test(l)), false, 'ausente: sem linha de histórico');
  assert.ok(ls.some((l) => /^ {2}● T8 +implementando/.test(l)), 'ausente: coluna do título em branco, não "undefined"');
  const c = voo();
  c.plano.tasks = c.plano.tasks.map((t) => ({ ...t, titulo: 'a\x1b[31mb\u202Ec' + 'z'.repeat(80) }));
  const lc = render(c, 80);
  assert.equal(lc.join('\n').includes('\x1b'), false);
  assert.ok(lc.some((l) => /a {1}\[31mb {1}c/.test(l)), 'corrompido: o controle vira espaço, não some em silêncio');
  assert.ok(lc.every((l) => colunas(l) <= 80));
  const h = voo();
  h.historico = [{ glifo: '✓', texto: 'x', hora: undefined as unknown as string, cor: 'success' }];
  assert.ok(render(h, 80).includes('--:-- ✓ x'));
});

test('esq-largura-invalida-lanca: NaN, 0, negativa, Infinity e < 1 viram RangeError (não 1 linha vazia)', () => {
  for (const w of [NaN, 0, -3, Infinity, 0.5, '80' as unknown as number, undefined as unknown as number]) {
    assert.throws(() => renderEsquadrao(voo(), op(w)), RangeError, String(w));
  }
  assert.ok(renderEsquadrao(voo(), op(80.9)).every((l) => colunas(TEXTO(l)) <= 80), 'fração: floor');
});

// ---------- P15: cada campo lido ----------

type Mut = [string, (e: EstadoPainel) => void, 'texto' | 'cor'?];
const CAMPOS: Mut[] = [
  ['id', (e) => { e.id = 'GM-99'; }],
  ['titulo', (e) => { e.titulo = 'Outro titulo'; }],
  ['pacote', (e) => { e.pacote = 'Outro Pacote'; }],
  ['plano.pct', (e) => { e.plano.pct = 10; }],
  ['plano.feitas', (e) => { e.plano.feitas = 6; }],
  ['plano.total', (e) => { e.plano.total = 13; }],
  ['plano.eta.hora', (e) => { e.plano.eta!.hora = '23:59'; }],
  ['plano.eta.maisMenosS', (e) => { e.plano.eta!.maisMenosS = 60; }],
  ['plano.rodadaMedia', (e) => { e.plano.rodadaMedia = 2.5; }],
  ['plano.medianaS', (e) => { e.plano.medianaS = 120; }],
  ['tasks[].id', (e) => { e.plano.tasks[7].id = 'T88'; }],
  ['tasks[].titulo', (e) => { e.plano.tasks[7].titulo = 'Outro'; }],
  ['tasks[].estado', (e) => { e.plano.tasks[7].estado = 'corrigindo'; }],
  ['tasks[].glifo', (e) => { e.plano.tasks[7].glifo = '○'; }],
  ['tasks[].nome', (e) => { e.plano.tasks[7].nome = 'FRODO'; }],
  ['tasks[].desdeS', (e) => { e.plano.tasks[7].desdeS = 7_200; }],
  ['tasks[].deps', (e) => { e.plano.tasks[10].deps = ['T9']; }],
  ['equipe.vivos', (e) => { e.equipe.vivos = 5; }],
  ['lider.nome', (e) => { e.equipe.lider.nome = 'SAURON'; }],
  ['lider.modelo', (e) => { e.equipe.lider.modelo = 'haiku'; }],
  ['lider.ctx', (e) => { e.equipe.lider.ctx = 77; }],
  ['lider.x', (e) => { e.equipe.lider.x = 65; }],
  ['lider.tok', (e) => { e.equipe.lider.tok = 5_000; }],
  ['lider.h5', (e) => { e.equipe.lider.h5 = 99; }],
  ['lider.d7', (e) => { e.equipe.lider.d7 = 88; }],
  ['lider.narrativa', (e) => { e.equipe.lider.narrativa = 'outra frase'; }],
  ['agentes[].nome', (e) => { e.equipe.agentes[0].nome = 'BOROMIR'; }],
  ['agentes[].papel', (e) => { e.equipe.agentes[0].papel = 'correcao'; }],
  ['agentes[].task', (e) => { e.equipe.agentes[0].task = 'T7'; }],
  ['agentes[].modelo', (e) => { e.equipe.agentes[0].modelo = 'haiku'; }],
  ['agentes[].ctxPct', (e) => { e.equipe.agentes[0].ctxPct = 88; }],
  ['agentes[].ctxTok', (e) => { e.equipe.agentes[0].ctxTok = 9_000; }],
  ['agentes[].desdeS', (e) => { e.equipe.agentes[0].desdeS = 7_200; }],
  ['agentes[].vivo', (e) => { e.equipe.agentes[0].vivo = false; }],
  ['agentes[].cor', (e) => { e.equipe.agentes[0].cor = 'remember'; }, 'cor'],
  ['agentes[].estadoTask', (e) => { e.equipe.agentes[0].estadoTask = 'corrigindo'; }, 'cor'],
  ['revisores[].nome', (e) => { e.equipe.revisoresAguardando[0].nome = 'GIMLI'; }],
  ['revisores[].task', (e) => { e.equipe.revisoresAguardando[0].task = 'T9'; }],
  ['revisores[].mutacoesHoje', (e) => { e.equipe.revisoresAguardando[0].mutacoesHoje = 3; }],
  ['revisores[].mortasHoje', (e) => { e.equipe.revisoresAguardando[0].mortasHoje = 2; }],
  ['sombra.nome', (e) => { e.equipe.sombra.nome = 'SARUMAN'; }],
  ['sombra.modelo', (e) => { e.equipe.sombra.modelo = 'haiku'; }],
  ['sombra.decisoes', (e) => { e.equipe.sombra.decisoes = 9; }],
  ['sombra.ultima.seq', (e) => { e.equipe.sombra.ultima!.seq = 99; }],
  ['sombra.ultima.resposta', (e) => { e.equipe.sombra.ultima!.resposta = 'outra resposta'; }],
  ['sombra.ultima.fonte', (e) => { e.equipe.sombra.ultima!.fonte = 'D99'; }],
  ['atencao', (e) => { e.atencao = ['outro aviso']; }],
  ['historico[].hora', (e) => { e.historico[0].hora = '01:01'; }],
  ['historico[].glifo', (e) => { e.historico[0].glifo = '▲'; }],
  ['historico[].texto', (e) => { e.historico[0].texto = 'outro texto'; }],
  ['historico[].cor', (e) => { e.historico[0].cor = 'error'; }, 'cor'],
  ['ocultos', (e) => { e.ocultos = 30; }],
  ['rodape.ci.verde', (e) => { e.rodape.ci.verde = false; }],
  ['rodape.prod.leituras', (e) => { e.rodape.prod.leituras = 77; }],
  ['rodape.prod.alteracoes', (e) => { e.rodape.prod.alteracoes = 66; }],
  ['rodape.politica', (e) => { e.rodape.politica = 'sob demanda'; }],
  ['parado', (e) => { e.parado = true; }],
];

test('esq-cada-campo-lido (P15): trocar cada campo lido muda o texto (ou a cor, para os de cor)', () => {
  const base = voo();
  for (const w of [100]) {
    const t0 = render(base, w);
    const c0 = JSON.stringify(renderEsquadrao(base, op(w)));
    for (const [nome, muda, tipo] of CAMPOS) {
      const e = voo();
      muda(e);
      const t1 = render(e, w);
      const c1 = JSON.stringify(renderEsquadrao(e, op(w)));
      if (tipo === 'cor') {
        assert.deepEqual(t1, t0, `${nome}: só a cor muda`);
        assert.notEqual(c1, c0, `${nome}: a cor tem de mudar`);
      } else {
        assert.notDeepEqual(t1, t0, `${nome}: o texto tem de mudar (w=${w})`);
      }
    }
  }
});

test('esq-cada-campo-lido-faixas: campos que só aparecem em outra faixa mudam o texto nela (44 e 60)', () => {
  const casos: [number, string, (e: EstadoPainel) => void][] = [
    [44, 'id', (e) => { e.id = 'GM-99'; }], [44, 'pct', (e) => { e.plano.pct = 10; }], [44, 'eta.hora', (e) => { e.plano.eta!.hora = '23:59'; }],
    [44, 'agente.ctxPct', (e) => { e.equipe.agentes[0].ctxPct = 88; }], [44, 'agente.ctxTok', (e) => { e.equipe.agentes[0].ctxTok = 9_000; }],
    [44, 'sombra.seq', (e) => { e.equipe.sombra.ultima!.seq = 99; }], [44, 'lider.ctx', (e) => { e.equipe.lider.ctx = 77; }],
    [44, 'lider.tok', (e) => { e.equipe.lider.tok = 5_000; }], [44, 'atencao', (e) => { e.atencao = ['outro aviso']; }], [44, 'rodape.prod', (e) => { e.rodape.prod.leituras = 77; }],
    [60, 'tasks.nome', (e) => { e.plano.tasks[7].nome = 'FRODO'; }], [60, 'agente.task', (e) => { e.equipe.agentes[0].task = 'T7'; }],
    [60, 'lider.x', (e) => { e.equipe.lider.x = 65; }], [60, 'eta.maisMenosS', (e) => { e.plano.eta!.maisMenosS = 60; }],
  ];
  for (const [w, nome, muda] of casos) {
    const e = voo();
    muda(e);
    assert.notDeepEqual(render(e, w), render(voo(), w), `${nome} em ${w}`);
  }
});

// ---------- costura (P9) ----------

const TM: PacoteNomes = { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['GIMLI', 'LEGOLAS', 'ARAGORN', 'BOROMIR'] };
const PLANO: Plano = { entrega: 'GM-12', tasks: ['T07', 'T08', 'T09'].map((id) => ({ id, deps: [], arquivos: [] })) };
const evento = (i: number, tipo: TipoEvento, dados: Record<string, unknown>): Evento => ({
  seq: i + 1, ts: new Date(Date.parse('2026-11-09T12:00:00.000Z') + i * 60_000).toISOString(), autor: 'dev@x', sessao: 's1', agente: 'orquestrador', tipo, dados, hash_anterior: null,
});
const entrada = (agentes: AgenteVivo[] | null): EntradaPainel => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: 36, tokens: 72_000, window: 200_000 }, limites: { h5: 42, d7: 18 }, x: 50,
  agentes, pacote: TM, notificacao: null, agoraMs: Date.parse('2026-11-09T15:00:00.000Z'), fuso: 'UTC', titulo: 'E4 Painel', politica: { politica: 'continua', dias: null },
  base: 'main', entregaId: 'GM-12', modeloSessao: 'claude-opus-4-8', specSha: null, tetoSombra: 26,
});

test('costura-P9: diário e projetarPainel reais (src) ⇒ renderPainel do dist (o artefato que o mod carrega) ⇒ o mesmo texto do src, com nome, tarefa e sem mod', async () => {
  const dist = (await import(join(AQUI, '..', 'dist', 'painel.js'))) as typeof import('../src/painel.ts');
  const distEsq = (await import(join(AQUI, '..', 'dist', 'painel-esquadrao.js'))) as typeof import('../src/painel-esquadrao.ts');
  const eventos = [evento(0, 'task.iniciada', { task: 'T07', papel: 'implementador' }), evento(1, 'task.iniciada', { task: 'T08', papel: 'implementador' })];
  const vivo: AgenteVivo = { id: 'a1', type: 'general-purpose', description: 'T08 implementador', status: 'running', uso: null };
  for (const agentes of [[vivo], null]) {
    const st = projetarPainel(PLANO, eventos, entrada(agentes));
    for (const w of [44, 72, 100]) {
      const doDist = LINHAS(dist.renderPainel(st, op(w)));
      assert.deepEqual(doDist, render(st, w), `w=${w}`);
      assert.deepEqual(LINHAS(distEsq.renderEsquadrao(st, op(w))), doDist);
      assert.deepEqual(LINHAS(renderPainel(st, op(w))), doDist);
    }
    const ls = render(st, 100);
    assert.ok(ls.some((l) => /T08 .*implementando/.test(l)), ls.join('\n'));
    if (agentes === null) assert.ok(ls.some((l) => /agentes —$/.test(l)), 'sem mod: traço');
    else assert.ok(ls.some((l) => /agentes 1 vivos$/.test(l)) && ls.some((l) => /^├─ ◌ .*sem agente · T07/.test(l)), ls.join('\n'));
  }
});

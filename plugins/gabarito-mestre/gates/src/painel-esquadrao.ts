/**
 * Preset Esquadrão (E4, GM-12 T5): plano em cima, equipe embaixo, cinco faixas por largura (≥ 80, 72–79, 60–71, 44–59, < 44).
 * Núcleo puro: sem `node:*`, sem relógio, sem `Intl`; o render devolve `Linha[]` e NUNCA lê `o.tema` (a cor só vira SGR em `paraTexto`).
 *
 * Formatos (tokens, tempo, previsão, estado da task, faixa de ids, alinhar) vêm só de `painel-formato.ts` (T4c); o topo só de `blocoTopo` (T4),
 * colado sem alteração; largura só de `painel-largura.ts`. Toda outra linha passa por `cortarLinha(l, largura)` no fim.
 *
 * Contrato de falha: número ausente ou corrompido (`NaN`, `Infinity`, negativo onde não pode) nunca vira texto; vira `—` ou omissão. `0` é `0`.
 * `equipe.vivos === null` (sem mod) escreve `agentes —` e nenhuma linha de agente; `largura` inválida lança `RangeError`.
 */

import { alinhar, corEstadoTask, faixaIds, fmtPct, fmtTempo, fmtTok, num, previsao, separador, textoDoPapel, textoEstadoTask } from './painel-formato.ts';
import type { Previsao } from './painel-formato.ts';
import { colunas, cortar, limpar } from './painel-largura.ts';
import { barra, blocoTopo, cortarLinha } from './painel-texto.ts';
import type { AgentePainel, CorTema, EstadoPainel, Linha, OpcoesRender, Segmento, TaskPainel } from './tipos.ts';

const seg = (texto: string, cor?: CorTema): Segmento => (cor === undefined ? { texto } : { texto, cor });
const t = (v: unknown): string => (typeof v === 'string' ? limpar(v) : '');
const nn = (v: unknown): number | null => {
  const n = num(v);
  return n === null || n < 0 ? null : n;
};
const larg = (l: Linha): number => l.reduce((n, s) => n + colunas(s.texto), 0);
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - colunas(s)));
const maxCol = (xs: string[]): number => xs.reduce((m, s) => Math.max(m, colunas(s)), 0);
/** Remove espaços do fim da linha (colunas de alinhamento sem conteúdo à direita). */
function aparar(l: Linha): Linha {
  const s = [...l];
  while (s.length > 0 && s[s.length - 1].texto.trim() === '') s.pop();
  if (s.length > 0) s[s.length - 1] = { ...s[s.length - 1], texto: s[s.length - 1].texto.trimEnd() };
  return s;
}

/** Barra com a parte cheia colorida e a vazia `inactive`; `pct` ausente vale 0. */
function barraSegs(pct: number | null, w: number, cheio: '▰' | '█', vazio: '▱' | '░', cor: CorTema): Linha {
  const b = barra(pct ?? 0, w, cheio, vazio);
  const n = [...b].filter((c) => c === cheio).length;
  const resto = [...b].length - n;
  return [...(n > 0 ? [seg(cheio.repeat(n), cor)] : []), ...(resto > 0 ? [seg(vazio.repeat(resto), 'inactive')] : [])];
}

/** Previsão do plano (texto de `previsao()`); `curta` (44–59 e < 44) não leva `±`. */
function prevSegs(p: Previsao, curta: boolean): Linha {
  switch (p.tipo) {
    case 'parado': return [seg('loop parado', 'inactive')];
    case 'pausado': return [seg('loop pausado', 'inactive')];
    case 'todas': return [seg('todas integradas', 'inactive')];
    case 'sem_dados': return [seg('ETA sem dados', 'inactive')];
    default: return [seg('ETA '), seg(t(p.hora)), ...(curta ? [] : [seg(` ±${p.maisMenosMin}m`, 'inactive')])];
  }
}

const cardinal = (v: unknown): string => {
  const n = nn(v);
  return n === null ? '—' : String(Math.round(n));
};
/** `desdeS` negativo vale `0m` (relógio andou para trás); ausente ou não finito ⇒ sem tempo. */
const tempoDe = (v: unknown): string => {
  const n = num(v);
  return n === null ? '' : fmtTempo(Math.max(0, n));
};
const corDoNome = (e: EstadoPainel, nome: unknown): CorTema | undefined => e.equipe.agentes.find((a) => a.nome !== null && a.nome === nome)?.cor;

/** Orçamento do histórico por largura (D-R4): a Pane rola, então "cabem" é fixo por faixa. */
const orcamentoHistorico = (w: number): number => (w >= 72 ? 4 : w >= 60 ? 3 : w >= 44 ? 1 : 0);

const PREFIXO = (ultimo: boolean, larga: boolean): string => (ultimo ? (larga ? '└─ ' : '└ ') : larga ? '├─ ' : '├ ');

export function renderEsquadrao(e: EstadoPainel, o: OpcoesRender): Linha[] {
  const w0 = o?.largura;
  if (typeof w0 !== 'number' || !Number.isFinite(w0) || Math.floor(w0) < 1) throw new RangeError(`largura inválida: ${String(w0)} (número finito ≥ 1)`);
  const w = Math.floor(w0);
  const narracao = o.narracao === true;
  const larga = w >= 60; // desenho completo (A–C)
  const minima = w < 44;

  const topo = blocoTopo(e, w);
  const prev = previsao(e);
  const pctTxt = fmtPct(e.plano.pct);
  const tasksTxt = `${cardinal(e.plano.feitas)}/${cardinal(e.plano.total)} tasks`;
  const ordem = e.plano.tasks.map((x) => x.id);
  const emVoo = e.plano.tasks.filter((x) => x.estado !== 'pendente' && x.estado !== 'integrada');
  const fila = e.plano.tasks.filter((x) => x.estado === 'pendente');
  const integradas = e.plano.tasks.filter((x) => x.estado === 'integrada').map((x) => x.id);
  const aberta = (id: string): boolean => e.plano.tasks.find((x) => x.id === id)?.estado !== 'integrada';

  const saida: Linha[] = [];

  // ───────── < 44: topo, 1 linha de plano e as tasks em voo ─────────
  if (minima) {
    saida.push(...topo);
    saida.push(cortarLinha([seg(`${tasksTxt.replace(' tasks', '')} · `), ...prevSegs(prev, true)], w));
    for (const x of emVoo) saida.push(cortarLinha(aparar([seg(x.glifo, corEstadoTask(x.estado)), seg(` ${t(x.id)} `), seg(textoEstadoTask(x.estado), corEstadoTask(x.estado))]), w));
    return saida;
  }

  const sep = separador(w);

  // ───────── cabeçalho ─────────
  if (larga) {
    const esq: Linha = [seg(`GABARITO · ${t(e.id)}`), ...(t(e.titulo) !== '' ? [seg(` ${t(e.titulo)}`)] : [])];
    saida.push(cortarLinha(alinhar(esq, [seg(`esquadrão · ${t(e.pacote).toLowerCase()}`, 'inactive')], w), w));
  } else {
    saida.push(cortarLinha([seg(t(e.id)), seg(' '), ...barraSegs(nn(e.plano.pct), 12, '▰', '▱', 'success'), seg(` ${pctTxt} `), ...prevSegs(prev, true)], w));
  }
  saida.push(...topo);
  saida.push(sep);

  // ───────── PLANO ─────────
  if (larga) {
    const previsaoSegs = prevSegs(prev, false);
    const resto = 8 + 2 + colunas(pctTxt) + 2 + colunas(tasksTxt) + 3 + larg(previsaoSegs);
    const bw = Math.min(21, Math.max(5, w - resto));
    const esq: Linha = [seg('PLANO   '), ...barraSegs(nn(e.plano.pct), bw, '▰', '▱', 'success'), seg(`  ${pctTxt}  ${tasksTxt}`)];
    saida.push(cortarLinha(alinhar(esq, previsaoSegs, w), w));

    if (integradas.length > 0) {
      const partes = [integradas.length === 1 ? 'integrada' : 'integradas'];
      const r = nn(e.plano.rodadaMedia);
      if (r !== null) partes.push(`${r.toFixed(1)} rodada média`);
      const m = nn(e.plano.medianaS);
      if (m !== null) partes.push(`mediana ${Math.round(m / 60)} min`);
      saida.push(cortarLinha([seg('  '), seg('✓', 'success'), seg(` ${t(faixaIds(integradas, ordem))}   `), seg(partes.join(' · '), 'inactive')], w));
    }
  }

  // ───────── tasks em voo e fila ─────────
  const recuo = larga ? '  ' : '';
  const antesTasks = saida.length;
  const nomeW = maxCol(emVoo.map((x) => t(x.nome)));
  const estW = maxCol(emVoo.map((x) => textoEstadoTask(x.estado)));
  const primeira: TaskPainel | undefined = fila[0];
  const idW = maxCol([...emVoo.map((x) => t(x.id)), ...(larga && primeira ? [t(primeira.id)] : [])]);

  if (larga) {
    // coluna do título: min(40, w − 48) em ≥ 80, 24 em 72–79, nenhuma em 60–71
    const tcol = w >= 80 ? Math.min(40, w - 48) : w >= 72 ? 24 : 0;
    const titulo = (x: TaskPainel): string => (tcol > 0 ? cortar(t(x.titulo), tcol) : '');
    const tw = maxCol([...emVoo.map(titulo), ...(primeira ? [titulo(primeira)] : [])]);
    const colTitulo = (x: TaskPainel, cor?: CorTema): Linha => (tw > 0 ? [seg(pad(titulo(x), tw), cor), seg('  ')] : []);
    for (const x of emVoo) {
      const c = corEstadoTask(x.estado);
      saida.push(cortarLinha(aparar([
        seg(recuo), seg(x.glifo, c), seg(` ${pad(t(x.id), idW)}  `), ...colTitulo(x),
        seg(pad(textoEstadoTask(x.estado), estW), c), seg('  '), seg(pad(t(x.nome), nomeW), corDoNome(e, x.nome)), seg('  '), seg(tempoDe(x.desdeS), 'inactive'),
      ]), w));
    }
    if (primeira) {
      const deps = primeira.deps.filter(aberta).map(t);
      saida.push(cortarLinha(aparar([
        seg(recuo), seg('○', 'inactive'), seg(` ${pad(t(primeira.id), idW)}  `, 'inactive'), ...colTitulo(primeira, 'inactive'),
        seg(deps.length > 0 ? `fila · depende de ${deps.join(' ')}` : 'fila', 'inactive'),
      ]), w));
      if (fila.length > 1) saida.push(cortarLinha([seg(recuo), seg(`○ ${t(faixaIds(fila.slice(1).map((x) => x.id), ordem))}  fila`, 'inactive')], w));
    }
  } else {
    for (const x of emVoo) {
      const c = corEstadoTask(x.estado);
      saida.push(cortarLinha(aparar([
        seg(x.glifo, c), seg(` ${t(x.id)} `), ...(t(x.nome) !== '' ? [seg(pad(t(x.nome), nomeW), corDoNome(e, x.nome)), seg('  ')] : []),
        seg(pad(textoEstadoTask(x.estado), estW), c), seg('  '), seg(tempoDe(x.desdeS), 'inactive'),
      ]), w));
    }
    if (fila.length > 0) saida.push(cortarLinha([seg(`○ ${t(faixaIds(fila.map((x) => x.id), ordem))} fila`, 'inactive')], w));
  }
  // plano vazio em 44–59 (sem linha de PLANO): sem task a mostrar, o bloco some e não deixa 2 separadores colados
  if (larga || saida.length > antesTasks) saida.push(sep);

  // ───────── EQUIPE ─────────
  const eq = e.equipe;
  const vivos = nn(eq.vivos);
  if (larga) saida.push(cortarLinha(alinhar([seg('EQUIPE')], [seg(vivos === null ? 'agentes —' : `agentes ${Math.round(vivos)} ${Math.round(vivos) === 1 ? 'vivo' : 'vivos'}`, 'inactive')], w), w));

  const lider = eq.lider;
  const lctx = nn(lider.ctx);
  const pouso = nn(lider.x);
  const tokL = `tok ${fmtTok(lider.tok)}`;
  const h5 = nn(lider.h5);
  const d7 = nn(lider.d7);
  if (larga) {
    saida.push(cortarLinha(aparar([seg(t(lider.nome)), seg('  orquestra'), ...(t(lider.modelo) !== '' ? [seg(` · ${t(lider.modelo)}`, 'inactive')] : [])]), w));
    const bw = w >= 72 ? 29 : 19;
    saida.push(cortarLinha([
      seg('│', 'inactive'), seg('  ctx '),
      ...(lctx === null ? [seg('—')] : [...barraSegs(lctx, bw, '█', '░', 'success'), seg(` ${fmtPct(lctx)}`)]),
      ...(pouso !== null ? [seg(` · pouso em ${fmtPct(pouso)}`, 'inactive')] : []), seg(`   ${tokL}`),
    ], w));
    if (h5 !== null || d7 !== null) {
      const lim = (rot: string, v: number | null): Linha => (v === null ? [] : [seg(`${rot} `), ...barraSegs(v, 10, '█', '░', 'success'), seg(` ${fmtPct(v)}`)]);
      saida.push(cortarLinha([seg('│', 'inactive'), seg('  '), ...lim('5h', h5), ...(h5 !== null && d7 !== null ? [seg('   ')] : []), ...lim('7d', d7)], w));
    }
    if (narracao && w >= 72 && t(lider.narrativa) !== '') saida.push(cortarLinha([seg('│', 'inactive'), seg('  '), seg('▶', 'success'), seg(` ${t(lider.narrativa)}`)], w));
  } else {
    saida.push(cortarLinha([seg(t(lider.nome)), seg(' ctx '), ...(lctx === null ? [seg('—')] : [...barraSegs(lctx, 19, '█', '░', 'success'), seg(` ${fmtPct(lctx)}`)])], w));
    const partes = [...(h5 !== null ? [`5h ${fmtPct(h5)}`] : []), ...(d7 !== null ? [`7d ${fmtPct(d7)}`] : []), tokL];
    saida.push(cortarLinha([seg('│ ', 'inactive'), seg(partes.join(' '))], w));
  }

  // agentes (só com mod); revisores aguardando e Sombra vêm do diário e continuam sem mod
  const reais = vivos === null ? [] : eq.agentes.filter((a) => !(a.vivo && a.nome === null && a.papel === null));
  const nw = maxCol([...reais.map((a) => t(a.nome ?? a.papel)), ...eq.revisoresAguardando.filter((r) => r.nome !== null).map((r) => t(r.nome))]);
  {
    const verbos = eq.agentes.filter((a) => a.vivo).map((a) => textoDoPapel(a.papel));
    const vw = maxCol(verbos);
    const modelos = eq.agentes.filter((a) => a.vivo).map((a) => (t(a.modelo) !== '' ? ` · ${t(a.modelo)}` : ''));
    const mw = maxCol(modelos);
    const tw = maxCol(eq.agentes.map((a) => t(a.task)));
    if (vivos !== null) {
      // número nunca é cortado (P1c D-R6): se a linha mais larga não cabe, TODAS cedem juntas, texto primeiro (nível 1: sem modelo), depois o tempo inteiro (nível 2)
      let nivel = 0;
      const montar = (n: number): Linha[] => eq.agentes.map((a) => linhaAgente(a, larga, nw, vw, n === 0 ? mw : 0, tw, n));
      while (nivel < 2 && larga && montar(nivel).some((l) => larg(l) > w)) nivel++;
      for (const l of montar(nivel)) saida.push(cortarLinha(l, w));
    }
    for (const r of eq.revisoresAguardando) {
      const nome = t(r.nome);
      const m = nn(r.mutacoesHoje);
      const k = nn(r.mortasHoje);
      const sufixo = m !== null && k !== null ? ` · ${Math.round(m)} ${Math.round(m) === 1 ? 'mutação' : 'mutações'} do gate hoje, ${Math.round(k)} ${Math.round(k) === 1 ? 'morta' : 'mortas'}` : '';
      if (larga) {
        saida.push(cortarLinha(aparar([
          seg(PREFIXO(false, true), 'inactive'), seg('◐', 'warning'), seg(' '),
          ...(nome !== '' ? [seg(pad(nome, nw), corDoNome(e, r.nome)), seg('  revisa'), seg(' ')] : [seg('revisor ')]),
          seg(`aguarda ${t(r.task)}${sufixo}`, 'inactive'),
        ]), w));
      } else {
        saida.push(cortarLinha(aparar([seg(PREFIXO(false, false), 'inactive'), seg('◐', 'warning'), seg(` ${nome !== '' ? pad(nome, nw) : 'revisor'} `, corDoNome(e, r.nome)), seg(`aguarda ${t(r.task)}`, 'inactive')]), w));
      }
    }
  }

  // Sombra: sempre, sempre `└`
  const s = eq.sombra;
  const dec = nn(s.decisoes);
  const ult = s.ultima;
  const seq = ult ? nn(ult.seq) : null;
  if (larga) {
    const cont = dec === null ? '' : `${Math.round(dec)} ${Math.round(dec) === 1 ? 'decisão' : 'decisões'}`;
    const resp = ult && seq !== null ? `#${Math.round(seq)} ${t(ult.resposta)}${t(ult.fonte) !== '' ? ` (${t(ult.fonte)})` : ''}` : '';
    saida.push(cortarLinha(aparar([
      seg(PREFIXO(true, true), 'inactive'), seg('○', 'inactive'), seg(' '), seg(t(s.nome), 'planMode'), seg('  aconselha'),
      ...(t(s.modelo) !== '' ? [seg(` · ${t(s.modelo)}`, 'inactive')] : []), seg(`  ${[cont, resp].filter((x) => x !== '').join(' · ')}`, 'inactive'),
    ]), w));
  } else {
    const fim = ult && seq !== null ? `#${Math.round(seq)}` : dec === null ? '' : `${Math.round(dec)} dec`;
    saida.push(cortarLinha(aparar([seg(PREFIXO(true, false), 'inactive'), seg('○', 'inactive'), seg(' '), seg(t(s.nome), 'planMode'), seg(` ${fim}`, 'inactive')]), w));
  }
  saida.push(sep);

  // ───────── ATENÇÃO ─────────
  const atencao = (Array.isArray(e.atencao) ? e.atencao : []).map(t).filter((x) => x !== '');
  if (atencao.length > 0) {
    saida.push(cortarLinha(larga ? [seg('◆ ATENÇÃO', 'warning'), seg(`  ${atencao.join(' · ')}`)] : [seg('◆', 'warning'), seg(` ${atencao.join(' · ')}`)], w));
    if (larga) saida.push(sep);
  }

  // ───────── histórico e rodapé ─────────
  const hist = Array.isArray(e.historico) ? e.historico : [];
  const orc = narracao ? orcamentoHistorico(w) : 0;
  const mostradas = hist.slice(0, orc);
  // a mais antiga no alto (o estado vem com a mais recente primeiro)
  for (const h of [...mostradas].reverse()) {
    saida.push(cortarLinha([seg(t(h.hora) !== '' ? t(h.hora) : '--:--', 'inactive'), seg(' '), seg(t(h.glifo), h.cor), seg(` ${t(h.texto)}`)], w));
  }
  const k = narracao ? (nn(e.ocultos) ?? 0) + (hist.length - mostradas.length) : 0;

  const ci = e.rodape.ci.verde;
  const leu = cardinal(e.rodape.prod.leituras);
  const alt = cardinal(e.rodape.prod.alteracoes);
  const ciTxt = ci === true ? 'verde' : ci === false ? 'vermelho' : '—';
  const ciCor: CorTema = ci === true ? 'success' : ci === false ? 'warning' : 'inactive';
  if (larga) {
    // `▼ K eventos` encostado à direita e sempre inteiro; quem cede é a política (cortada com `…`), nunca o contador
    saida.push(cortarLinha(alinhar(
      [seg('CI '), seg('●', ciCor), seg(` ${ciTxt}   PROD leu ${leu} · alterou ${alt}   política ${t(e.rodape.politica)}`)],
      k > 0 ? [seg(`▼ ${k} ${k === 1 ? 'evento' : 'eventos'}`, 'inactive')] : [], w), w));
  } else {
    saida.push(cortarLinha([seg('CI '), seg('●', ciCor), seg(` ${ciTxt}  PROD ${leu}/${alt}`), ...(k > 0 ? [seg(`  ▼ ${k}`, 'inactive')] : [])], w));
  }
  return saida;
}

/** Linha de agente: vivo (`●`), `sem task`, ou `◌ sem agente` (task em voo sem agente de papel compatível). */
function linhaAgente(a: AgentePainel, larga: boolean, nw: number, vw: number, mw: number, tw: number, nivel = 0): Linha {
  const pre = seg(PREFIXO(false, larga), 'inactive');
  const nome = t(a.nome ?? a.papel);
  if (!a.vivo) {
    return aparar([pre, seg('◌', 'inactive'), seg(` ${larga ? pad(nome, nw) : nome}`, a.cor), seg(larga ? '  sem agente' : '', 'inactive'), seg(`${larga ? ' · ' : ' '}${t(a.task)}`, 'inactive')]);
  }
  const pct = nn(a.ctxPct);
  const tok = nn(a.ctxTok);
  const semTask = a.nome === null && a.papel === null;
  const gc: CorTema = semTask || a.estadoTask === null ? 'inactive' : corEstadoTask(a.estadoTask);
  if (!larga) {
    const fim = [pct !== null ? fmtPct(pct) : '', tok !== null ? fmtTok(tok) : ''].filter((x) => x !== '').join(' ');
    return aparar([pre, seg('●', gc), seg(' '), seg(semTask ? 'sem task' : pad(nome, nw), semTask ? 'inactive' : a.cor), seg(fim !== '' ? ` ${fim}` : '', 'inactive')]);
  }
  const ctx: Linha = pct !== null
    ? [seg('ctx '), ...barraSegs(pct, 10, '█', '░', 'success'), seg(` ${fmtPct(pct)}`)]
    : [seg(tok !== null ? `ctx ${fmtTok(tok)}` : 'ctx —')];
  const cauda = [...(pct !== null && tok !== null ? [fmtTok(tok)] : []), ...(nivel < 2 && tempoDe(a.desdeS) !== '' ? [tempoDe(a.desdeS)] : [])];
  const modelo = nivel === 0 && t(a.modelo) !== '' ? ` · ${t(a.modelo)}` : '';
  const fim = cauda.length > 0 ? [seg(`  ${cauda.join(' · ')}`, 'inactive')] : [];
  if (semTask) return aparar([pre, seg('●', gc), seg(' '), seg('sem task', 'inactive'), seg(modelo, 'inactive'), seg('  '), ...ctx, ...fim]);
  return aparar([
    pre, seg('●', gc), seg(' '), seg(pad(nome, nw), a.cor), seg('  '), seg(pad(textoDoPapel(a.papel), vw)), seg(pad(modelo, mw), 'inactive'),
    seg('  '), seg(pad(t(a.task), tw)), seg('  '), ...ctx, ...fim,
  ]);
}

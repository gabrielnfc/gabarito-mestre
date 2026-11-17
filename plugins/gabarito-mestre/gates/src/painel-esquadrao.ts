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
import { PAPEL_EXECUTIVO } from './painel-executivo.ts';
import { PRIORIDADE_RESERVA, cortarComReserva, cortarPorPrioridade } from './orcamento.ts';
import type { LinhaPrioridade } from './orcamento.ts';
import { linhaTecnica, nomeNatural, tagNatural } from './origem.ts';
import type { Previsao } from './painel-formato.ts';
import { ROTULO_FORA_DO_LOOP, rotuloAgente, rotuloFase } from './projeto.ts';
import type { EstadoProjeto, LinhaProjeto } from './projeto.ts';
import type { EstadoTask } from './loop.ts';
import { colunas, cortar, limpar } from './painel-largura.ts';
import { alturaValida, barra, blocoTopo, cortarLinha, cortarPorAltura } from './painel-texto.ts';
import type { LinhaMarcada } from './painel-texto.ts';
import type { Acao, AgenteAgora, AgentePainel, CorTema, EstadoPainel, ItemRecente, Linha, OpcoesRender, QuemPainel, Segmento, TaskPainel } from './tipos.ts';

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
  // classe de corte por altura de cada linha de `saida` (índice ⇒ marca); ver `cortarPorAltura`
  const marcas = new Map<number, { tag: string; trocar?: Linha }>();
  const marca = (tag: string, trocar?: Linha): void => { marcas.set(saida.length - 1, trocar === undefined ? { tag } : { tag, trocar }); };

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
  saida.push(sep); marca('sep');

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
      saida.push(cortarLinha([seg('  '), seg('✓', 'success'), seg(` ${t(faixaIds(integradas, ordem))}   `), seg(partes.join(' · '), 'inactive')], w)); marca('faixa');
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
      if (fila.length > 1) {
        // 2 linhas de fila: com pouca altura viram uma só (`○ T10–T12  fila`); a 2ª cai
        const junta = cortarLinha([seg(recuo), seg(`○ ${t(faixaIds(fila.map((x) => x.id), ordem))}  fila`, 'inactive')], w);
        marca('fila', junta);
        saida.push(cortarLinha([seg(recuo), seg(`○ ${t(faixaIds(fila.slice(1).map((x) => x.id), ordem))}  fila`, 'inactive')], w)); marca('fila');
      }
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
  if (larga || saida.length > antesTasks) { saida.push(sep); marca('sep'); }

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
      saida.push(cortarLinha([seg('│', 'inactive'), seg('  '), ...lim('5h', h5), ...(h5 !== null && d7 !== null ? [seg('   ')] : []), ...lim('7d', d7)], w)); marca('lim');
    }
    if (narracao && w >= 72 && t(lider.narrativa) !== '') {
      saida.push(cortarLinha([seg('│', 'inactive'), seg('  '), seg('▶', 'success'), seg(` ${t(lider.narrativa)}`)], w));
      marca('narr'); // só com a linha empurrada: fora do bloco reetiquetava a linha anterior (ctx do líder ou 5h/7d)
    }
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
    const estadosLegado = new Map<string, EstadoTask>(e.plano.tasks.map((x) => [x.id, x.estado as EstadoTask]));
    // o rótulo único ("agente fora do loop", emenda 4 item 5) é o 1º a ceder, CORTADO com `…` (nunca trocado por outro texto), antes de o modelo sair
    let labW: number | null = null;
    let rotuloTentado = false;
    const rotulo = (): string => (labW === null ? ROTULO_FORA_DO_LOOP : cortar(ROTULO_FORA_DO_LOOP, labW));
    const twDe = (): number => maxCol(eq.agentes.map((a) => (a.vivo && rotuloAgente({ task: typeof a.task === 'string' && t(a.task) !== '' ? t(a.task) : null, papelExibido: null }, estadosLegado) === ROTULO_FORA_DO_LOOP ? rotulo() : t(a.task))));
    if (vivos !== null) {
      // número nunca é cortado (P1c D-R6): se a linha mais larga não cabe, TODAS cedem juntas, texto primeiro (nível 1: sem modelo), depois o tempo inteiro (nível 2)
      // níveis: 0 tudo · 1 sem modelo · 2 sem tempo · 3 sem o verbo do papel · 4 nome encurtado com `…` (texto, nunca número)
      let nivel = 0;
      let nwUsado = nw;
      const montar = (n: number): Linha[] => eq.agentes.map((a) => linhaAgente(a, larga, nwUsado, n >= 3 ? 0 : vw, n === 0 ? mw : 0, twDe(), n, estadosLegado, rotulo()));
      while (nivel < 4 && larga && montar(nivel).some((l) => larg(l) > w)) {
        if (!rotuloTentado && nivel === 0) {
          // 1º o rótulo (cortado com `…`, no mínimo 8 colunas), depois o modelo; só vale se a linha mais larga realmente encolhe
          rotuloTentado = true;
          const antes = Math.max(...montar(0).map(larg));
          labW = Math.max(8, colunas(ROTULO_FORA_DO_LOOP) - (antes - w));
          if (Math.max(...montar(0).map(larg)) >= antes) labW = null;
          else continue;
        }
        nivel++;
        if (nivel === 4) {
          const sobra = Math.max(...montar(3).map(larg)) - w;
          nwUsado = Math.max(1, nw - sobra);
        }
      }
      // o rótulo cortado só perde o que o nível final exige: o maior corte que ainda cabe
      if (labW !== null) {
        const cheio = colunas(ROTULO_FORA_DO_LOOP);
        for (let k = cheio; k >= 8; k--) { labW = k; if (!montar(nivel).some((l) => larg(l) > w)) break; }
        if (labW === cheio) labW = null;
      }
      montar(nivel).forEach((l, i) => { saida.push(cortarLinha(l, w)); if (eq.agentes[i].vivo) marca('vivo'); });
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
  saida.push(sep); marca('sep');

  // ───────── ATENÇÃO ─────────
  const atencao = (Array.isArray(e.atencao) ? e.atencao : []).map(t).filter((x) => x !== '');
  if (atencao.length > 0) {
    saida.push(cortarLinha(larga ? [seg('◆ ATENÇÃO', 'warning'), seg(`  ${atencao.join(' · ')}`)] : [seg('◆', 'warning'), seg(` ${atencao.join(' · ')}`)], w));
    if (larga) { saida.push(sep); marca('sep'); }
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
  return cortarPorAltura(saida.map((l, i): LinhaMarcada => ({ l, tag: marcas.get(i)?.tag ?? '', ...(marcas.get(i)?.trocar === undefined ? {} : { trocar: marcas.get(i)?.trocar }) })), o.altura, ['sep', 'narr', 'lim', 'fila', 'faixa']);
}

/** Linha de agente: vivo (`●`), `agente fora do loop`, ou `◌ sem agente` (task em voo sem agente de papel compatível). */
function linhaAgente(a: AgentePainel, larga: boolean, nw: number, vw: number, mw: number, tw: number, nivel = 0, estados: ReadonlyMap<string, EstadoTask> = new Map(), rotuloFora: string = ROTULO_FORA_DO_LOOP): Linha {
  const pre = seg(PREFIXO(false, larga), 'inactive');
  // GM-15 T32 (item 5): o rótulo único de `projeto.ts` (agente sem task ou com task não iniciada)
  const tarefa = rotuloAgente({ task: typeof a.task === 'string' && t(a.task) !== '' ? t(a.task) : null, papelExibido: null }, estados);
  const foraDoLoop = tarefa === ROTULO_FORA_DO_LOOP;
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
    return aparar([pre, seg('●', gc), seg(' '), seg(semTask ? rotuloFora : pad(nome, nw), semTask ? 'inactive' : a.cor), seg(fim !== '' ? ` ${fim}` : '', 'inactive')]);
  }
  const ctx: Linha = pct !== null
    ? [seg('ctx '), ...barraSegs(pct, 10, '█', '░', 'success'), seg(` ${fmtPct(pct)}`)]
    : [seg(tok !== null ? `ctx ${fmtTok(tok)}` : 'ctx —')];
  const cauda = [...(pct !== null && tok !== null ? [fmtTok(tok)] : []), ...(nivel < 2 && tempoDe(a.desdeS) !== '' ? [tempoDe(a.desdeS)] : [])];
  const modelo = nivel === 0 && t(a.modelo) !== '' ? ` · ${t(a.modelo)}` : '';
  const fim = cauda.length > 0 ? [seg(`  ${cauda.join(' · ')}`, 'inactive')] : [];
  if (semTask) return aparar([pre, seg('●', gc), seg(' '), seg(rotuloFora, 'inactive'), seg(modelo, 'inactive'), seg('  '), ...ctx, ...fim]);
  return aparar([
    pre, seg('●', gc), seg(' '), seg(pad(nivel >= 4 ? cortar(nome, nw) : nome, nw), a.cor), seg('  '), ...(vw > 0 ? [seg(pad(textoDoPapel(a.papel), vw))] : []), seg(pad(modelo, mw), 'inactive'),
    seg('  '), seg(pad(foraDoLoop ? rotuloFora : t(a.task), tw)), seg('  '), ...ctx, ...fim,
  ]);
}

// ───────────────────────────── GM-15 T32 (REQ-ENT-2 emenda 4, D-G3): visão de PROJETO, acima da visão de entrega ─────────────────────────────
//
// O núcleo é `projeto.ts` (T31, puro); a borda (`painel.mjs`) lê todas as worktrees e cola `estado.projeto`. Aqui só se DESENHA. Aparece com 2 ou mais PBIs/entregas
// (com 1 só, a visão de entrega já é o projeto). ≥ 72 colunas: totais em 2 ou 3 linhas (contagens · previsão medida · previsão estimada) + 1 linha por PBI; abaixo, 1 linha de totais (D-P8: a visão de entrega
// mantém a prioridade dela, o projeto é o 1º a encolher); < 44, só a contagem. Número nunca cortado: o que cede é o título; a linha cortada termina em "…".
// PBI sem plano: "sem plano", nunca 0 % (o total diz quantos ficam fora da conta). Previsão: "(medida)" = ritmo medido (T30) só do que tem plano;
// a parte dos PBIs sem plano vem com "~" e "estimadas" (emenda 19 p.5, D-G13), nunca somada ao %.

/** GM-15 T33 (g.9): todo "?" diz por que falta o dado, em 1–3 palavras, a partir de 100 colunas; abaixo disso só o "?". A regra única (renderBlocos e o projeto). */
const motivoEm = (w: number) => (m: string): string => (w >= 100 ? ` (${m})` : '');

/** Largura mínima das linhas por PBI; abaixo, 1 linha de totais. */
const LARGURA_PROJETO_LINHAS = 72;

/** `estado.projeto` válido e com 2 ou mais linhas; senão `null` (nada desenhado). */
function projetoDe(e: EstadoPainel): EstadoProjeto | null {
  const p = (e as EstadoPainel & { projeto?: EstadoProjeto | null }).projeto;
  if (p === null || p === undefined || typeof p !== 'object' || !Array.isArray(p.linhas) || p.totais === null || typeof p.totais !== 'object') return null;
  return p.linhas.filter((l) => l !== null && typeof l === 'object' && typeof l.id === 'string').length >= 2 ? p : null;
}

function linhasDoProjeto(p: EstadoProjeto, w: number, mot: (m: string) => string): { totais: Linha[]; pbis: Linha[] } {
  const tt = p.totais;
  const feitos = ouInterroga(tt.feitos);
  const total = ouInterroga(tt.pbis);
  const pctN = nn(tt.pct);
  const pct = pctN === null ? '?' : `${Math.round(pctN)}%`;
  const fora = inteiroNaoNeg(tt.foraDaConta) ?? 0;
  const med = tt.previsao?.medida ?? null;
  const est = tt.previsao?.estimada ?? null;
  if (w < 44) return { totais: [[seg(`PBIs ${feitos}/${total} · ${pct}`)]], pbis: [] };
  if (w < LARGURA_PROJETO_LINHAS) {
    const prev = est !== null ? `~${t(est.hora)} estimada` : med !== null ? `${t(med.hora)} medida` : '?';
    return { totais: [[seg(`PROJETO ${feitos}/${total} PBIs · ${pct} · ${prev}${fora > 0 ? ` · ${fora} sem plano` : ''}`)]], pbis: [] };
  }
  // linha 1: contagens (o número nunca é cortado: o que não cabe em `w` sai por variantes mais curtas, a mais longa primeiro)
  const estimadas = inteiroNaoNeg(tt.estimadas) ?? 0;
  const tasks = `${pct} das tasks (${ouInterroga(tt.integradas)} de ${ouInterroga(tt.tasks)}${estimadas > 0 ? `, +${estimadas} estimadas` : ''})`;
  const base = `PROJETO  ${feitos} de ${total} PBIs feitos · ${tasks}`;
  const variantes = [
    `${base} · ${ouInterroga(tt.restantes)} restantes${fora > 0 ? ` · ${fora} sem plano, fora da conta` : ''}`,
    `${base} · ${ouInterroga(tt.restantes)} restantes${fora > 0 ? ` · ${fora} sem plano` : ''}`,
    `${base}${fora > 0 ? ` · ${fora} sem plano` : ''}`,
    base,
  ];
  const l1 = variantes.find((v) => colunas(v) <= w) ?? variantes[variantes.length - 1];
  // linha 2: a previsão medida (a); linha 3: a parte dos PBIs sem plano, estimada (b), com "~"
  const totais: Linha[] = [
    [seg(l1)],
    [seg(med !== null ? `  previsão ${t(med.hora)} (medida)` : `  previsão ?${mot(tt.previsao?.ritmoS === null || tt.previsao?.ritmoS === undefined ? 'sem ritmo medido' : 'sem fonte')}`, 'inactive')],
    ...(est !== null ? [[seg(`  ${t(est.texto)}`, 'inactive')] as Linha] : []),
  ];
  const ls = p.linhas.filter((l): l is LinhaProjeto => l !== null && typeof l === 'object' && typeof l.id === 'string');
  const idW = maxCol(ls.map((l) => t(l.id)));
  const txt = (l: LinhaProjeto): string => t(l.texto) || '?';
  const txtW = maxCol(ls.map(txt));
  const tcol = Math.min(40, w - (8 + idW + txtW));
  const titulos = ls.map((l) => (tcol >= 4 ? cortar(natural(l.titulo), tcol) : ''));
  const tw = maxCol(titulos);
  const pbis = ls.map((l, i): Linha => {
    const g = l.motivo !== null && l.motivo !== undefined ? '?' : l.feito === true ? '✓' : l.semPlano === true ? '○' : '●';
    const cor: CorTema | undefined = g === '✓' ? 'success' : g === '○' ? 'inactive' : g === '?' ? 'warning' : undefined;
    return aparar([seg('  '), seg(g, cor), seg(` ${pad(t(l.id), idW)}  `), ...(tw > 0 ? [seg(`${pad(titulos[i], tw)}  `)] : []), seg(txt(l), l.semPlano === true && g !== '?' ? 'inactive' : undefined)]);
  });
  return { totais, pbis };
}

/**
 * As linhas únicas (`sem entrega em curso`, `<ID> entregue`) seguem 1 linha, MAS a visão de projeto vem ACIMA delas (emenda 4; é o caso do repo com main
 * e nada em curso). Exceção: linha única que é item do dono (`◆ …`, o botão "seguir"): o mod só a acha como 1ª/2ª linha de conteúdo, então o projeto vai abaixo.
 */
export function comProjetoAcima(e: EstadoPainel, w: number, unica: Linha[]): Linha[] {
  const p = projetoDe(e);
  if (p === null) return unica;
  const dp = linhasDoProjeto(p, w, motivoEm(w));
  const proj = [...dp.totais, ...dp.pbis].map((l) => cortarNatural(l, w));
  const itemDoDono = unica.length > 0 && textoDe(unica[0]).startsWith('◆ ');
  return itemDoDono ? [...unica, ...proj] : [...proj, ...unica];
}

// ───────────────────────────── GM-14 T17 (regra dos 5 blocos) + GM-15 T29 (desenho do E4): `renderBlocos` (REQ-GLB-1, REQ-LNG-1, FIEL-10..13) ─────────────────────────────
//
// Um renderizador só para os dois presets (FIEL-12): `ludico` (esquadrão) mostra o nome temático; o executivo, o papel de `PAPEL_EXECUTIVO`.
// Blocos e prioridade de corte (D-P8): 1 DEPENDE DE VOCÊ (topo; PAROU, pergunta, itens) · 2 cabeçalho e PRONTO/FASE · 3 AGORA · 4 ATENÇÃO
// · 5 RECENTE. Bloco vazio não ocupa linha; topo nunca cortado: o que dele não couber vira `(+N)` na última linha do topo que ficou.
// REQ-LNG-1: todo texto que vem de dado passa por `natural` (marcação fora, sem emoji, token técnico normalizado ou "…"); o comando nunca
// aparece (só o rótulo do botão, entre colchetes). Número nunca cortado (`cortarLinha`); a linha cortada nunca vira técnica (`cortarNatural`).

/** Símbolo que vira emoji no terminal (FIEL-13 c): sai antes do render. */
const EMOJI = /[\p{Extended_Pictographic}\uFE0F]/gu;

/** Marcação de texto (D-P14): crase, `**`, `__` e `_ênfase_` saem; o texto fica. */
const semMarcacao = (s: string): string => s.replace(/`+|\*\*|__/g, '').replace(/(^|[\s(])_([^_\s][^_]*?)_(?=$|[\s).,:;!?])/g, '$1$2');

/**
 * Texto de dado em linguagem natural. `nome`: token técnico ⇒ tag `X.Y.Z` ou `nomeNatural` (`true_force` ⇒ `true force`), e o que ainda for técnico
 * (`node`, palavra que é tipo de evento) ⇒ "…". `reticencia` (descrição de despacho, FIEL-3 b): token técnico ⇒ "…". ID de entrega (`GM-14`)
 * não é técnico e nunca passa por `nomeNatural` (DP-4).
 */
function natural(v: unknown, modo: 'nome' | 'reticencia' = 'nome'): string {
  const base = semMarcacao(limpar(typeof v === 'string' ? v : '')).replace(EMOJI, '');
  const saida: string[] = [];
  for (const tok of base.split(/\s+/)) {
    if (tok === '') continue;
    if (!linhaTecnica(tok)) { saida.push(tok); continue; }
    if (modo === 'reticencia') { saida.push('…'); continue; }
    const tag = /\d+\.\d+\.\d+/.test(tok) ? tagNatural(tok) : null;
    if (tag !== null) { saida.push(tag); continue; }
    for (const w of nomeNatural(tok).split(' ')) if (w !== '') saida.push(linhaTecnica(w) ? '…' : w);
  }
  return saida.join(' ').replace(/…(\s+…)+/g, '…');
}

/** ID de entrega (DP-4): cru só no formato `GM-14` (`^[A-Z]+-\d+$`); qualquer outro (`true_force`) vai por `nomeNatural`. */
const ID_ENTREGA = /^[A-Z]+-\d+$/;
/** Quebra `texto` em linhas de até `w` colunas nos espaços; continuações com recuo de 4; palavra maior que a linha é partida (nunca reticência). */
function quebrarTopo(texto: string, w: number): string[] {
  const RECUO = Math.min(4, Math.max(0, w - 1));
  const saida: string[] = [];
  let atual = '';
  const limite = (): number => (saida.length === 0 ? w : w - RECUO);
  const fecha = (): void => { saida.push(saida.length === 0 ? atual : ' '.repeat(RECUO) + atual); atual = ''; };
  const lead = /^ */.exec(texto)?.[0] ?? '';
  for (const palavra of texto.slice(lead.length).split(' ')) {
    if (palavra === '') continue;
    let pal = palavra;
    let cand = atual === '' ? (saida.length === 0 ? lead : '') + pal : `${atual} ${pal}`;
    if (colunas(cand) <= limite()) { atual = cand; continue; }
    if (atual !== '') { fecha(); cand = pal; }
    while (colunas(cand) > limite()) {
      let n = cand.length;
      while (n > 1 && colunas(cand.slice(0, n)) > limite()) n--;
      atual = cand.slice(0, n); cand = cand.slice(n); fecha();
    }
    atual = cand;
  }
  if (atual !== '' || saida.length === 0) fecha();
  return saida;
}

const idNatural = (v: unknown): string => { const c = limpar(typeof v === 'string' ? v : ''); return ID_ENTREGA.test(c) ? c : natural(c); };

/**
 * Título (FIEL-5 a, D-P14): sem o prefixo `<ID> —|–|-|:`, sem marcação, uma vez. O prefixo sai comparando o título CRU (sem marcação) com o ID CRU
 * (`true_force`, não `true force`); só depois o resto vira natural.
 */
function tituloLimpo(titulo: unknown, idCru: unknown): string {
  let t = semMarcacao(limpar(typeof titulo === 'string' ? titulo : '')).trim();
  const id = limpar(typeof idCru === 'string' ? idCru : '').trim();
  if (id !== '') {
    if (t.toLowerCase() === id.toLowerCase()) return '';
    if (t.toLowerCase().startsWith(id.toLowerCase())) {
      const resto = t.slice(id.length);
      const m = /^\s*[—–:-]\s*/.exec(resto);
      if (m) t = resto.slice(m[0].length);
    }
  }
  return natural(t);
}

const textoDe = (l: Linha): string => l.map((x) => x.texto).join('');

/** `cortarLinha` que nunca deixa técnica uma linha que não era (corte no meio de palavra: `notaria` ⇒ `nota…`): recua até não casar. */
function cortarNatural(l: Linha, w: number): Linha {
  const r = cortarLinha(l, w);
  if (!linhaTecnica(textoDe(r)) || linhaTecnica(textoDe(l))) return r;
  for (let k = w - 1; k >= 1; k--) {
    const x = cortarLinha(l, k);
    if (!linhaTecnica(textoDe(x))) return x;
  }
  return [];
}

/** Glifo de resultado do RECENTE: só os da forma (`✓ ✗ ● ○`); outro texto (corrompido) vira "?" — nunca símbolo que vire emoji (FIEL-13 c). */
const glifoRecente = (g: unknown): string => (typeof g === 'string' && ['✓', '✗', '●', '○'].includes(g) ? g : '?');

/** Linha do RECENTE no desenho do histórico do E4 (GM-15 T29): `hh:mm <glifo> <quem> <texto> <origem>`; o texto já natural. */
function linhaRecente(r: ItemRecente, quemTexto: (q: QuemPainel | null | undefined) => string, texto: string): Linha {
  const quem = quemTexto(r.quem);
  const origem = limpar(typeof r.origem === 'string' ? r.origem : '');
  return aparar([seg(`${horaDe(r.hora)} `, 'inactive'), seg(glifoRecente(r.glifo), r.cor), seg(` ${quem !== '' ? `${quem} ` : ''}${texto} `), seg(origem, 'inactive')]);
}

/**
 * Linha reservada da decisão da Sombra (T42, emenda 32): a mesma linha do RECENTE, truncada em `w` pelo TEXTO da decisão, para a origem
 * (`(anotado pelo orquestrador)`, REQ-LNG-1) ficar à vista. Sem folga para o texto (< 16 colunas, o suficiente para dizer algo), o texto vence a origem: cai no corte comum da linha inteira.
 */
function linhaReserva(r: ItemRecente, quemTexto: (q: QuemPainel | null | undefined) => string, w: number): Linha {
  const t = natural(r.texto);
  const inteira = linhaRecente(r, quemTexto, t);
  if (colunas(textoDe(inteira)) <= w) return inteira;
  const fixo = colunas(textoDe(linhaRecente(r, quemTexto, '')));
  const folga = w - fixo;
  return folga >= 16 ? linhaRecente(r, quemTexto, cortar(t, folga)) : cortarNatural(inteira, w);
}

/**
 * Linha-resumo do AGORA (T42, emenda 37): `  <N> agentes: <rótulo> <task> · <rótulo> <task> …`. N = TODOS os vivos (mesmo os que o "…" esconde);
 * itens = só agentes (o segundo plano é seção própria, g.11); ação e tempo saem. Corta em fronteira de item e termina em "…" quando algum não coube.
 */
function linhaResumo(n: number, itens: { r: string; t: string }[], w: number): Linha {
  const pre = `  ${n} agentes:`;
  let txt = pre;
  let todos = true;
  for (let i = 0; i < itens.length; i++) {
    const cand = `${txt}${i === 0 ? ' ' : ' · '}${itens[i].r} ${itens[i].t}`;
    const cabeIt = colunas(cand) <= w && (i === itens.length - 1 || colunas(`${cand} …`) <= w);
    if (!cabeIt) { todos = false; break; }
    txt = cand;
  }
  if (txt === pre) return cortarNatural([seg(`${pre} ${itens.map((x) => `${x.r} ${x.t}`).join(' · ')}`)], w);
  return [seg(todos ? txt : `${txt} …`)];
}

/** Botões no texto: só o rótulo (`[aprovar a spec]`); ação sem comando é instrução (` · rótulo`). O comando fica em `Acao.comando`. */
function botoes(acoes: unknown): string {
  if (!Array.isArray(acoes)) return '';
  return (acoes as Acao[]).map((a) => {
    if (a === null || typeof a !== 'object' || typeof a.rotulo !== 'string' || a.rotulo.trim() === '') return '';
    const r = natural(a.rotulo);
    return typeof a.comando === 'string' && a.comando !== '' ? ` [${r}]` : ` · ${r}`;
  }).join('');
}

/** Hora sem leitura (`--:--` da E4) vira "?": `--` é marca técnica (REQ-LNG-1). */
const horaDe = (h: unknown): string => {
  const t = limpar(typeof h === 'string' ? h : '');
  return t === '' || t.includes('--') ? '?' : t;
};

const FASES_NOME = ['ideia', 'spec', 'aprovação', 'plano', 'execução', 'PR', 'uso'];
const inteiroNaoNeg = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Duração do fechamento (h.2): `< 1 h` em minutos, senão `1h20`. */
function fmtFechamento(s: number): string {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/**
 * Texto da previsão do PLANO (GM-15 T30, h.1/h.2). Com a conta exata (`faixa`): a faixa `de–ate` (`ate` `?` = fechamento não medido); em `w >= 100`
 * a base da MESMA conta (`pronto.previsao.conta`, nada recalculado): caminho, min por task, rodada, fechamento, por campo inteiro até caber em `cabe`
 * colunas (saem rodada, min por task e caminho, nesta ordem; o fechamento fica). Número inválido ⇒ o campo some (D-P13). Sem a conta exata, o texto do E4.
 */
function textoPrevisao(pv: NonNullable<NonNullable<EstadoPainel['pronto']>['previsao']>, w: number, cabe: number): string {
  const fx = pv.faixa;
  if (fx === null || typeof fx !== 'object' || typeof fx.de !== 'string' || limpar(fx.de) === '') return `previsão ${limpar(pv.hora)} (base: ${inteiroNaoNeg(pv.base) ?? '?'} tasks desta entrega)`;
  // o 1º número é sempre o ponto (`hora`), a faixa vem atrás (r1 MAJOR 1: a ponta de baixo sozinha erra o que o ponto não erra)
  const ponto = horaDe(pv.hora);
  const de = limpar(fx.de);
  const ate = typeof fx.ate === 'string' && limpar(fx.ate) !== '' ? limpar(fx.ate) : '?';
  const faixa = `previsão ${de === ate && de === ponto ? ponto : de === ponto ? `${ponto}–${ate}` : `${ponto} (${de}–${ate})`}`;
  if (w < 100) return faixa;
  const c = pv.conta !== null && typeof pv.conta === 'object' ? pv.conta : null;
  const caminho = inteiroNaoNeg(c?.caminho);
  const mpt = inteiroNaoNeg(c?.minPorTask);
  const rod = nn(c?.rodadas);
  const fe = c?.fechamentoS === null ? 'fechamento não medido' : nn(c?.fechamentoS) !== null ? `fechamento ${fmtFechamento(nn(c?.fechamentoS) as number)}` : null;
  // [texto, ordem de saída] — sai primeiro o de maior número
  const campos: [string | null, number][] = [
    [caminho === null ? null : `caminho ${caminho} ${caminho === 1 ? 'task' : 'tasks'}`, 3], [mpt === null ? null : `${mpt} min por task`, 2],
    [rod === null ? null : `${rod.toFixed(1).replace('.', ',')} rodada`, 1], [fe, 4],
  ];
  let vivos = campos.filter((x): x is [string, number] => x[0] !== null);
  const montar = (): string => [faixa, ...vivos.map((x) => x[0])].join(' · ');
  while (vivos.length > 0 && colunas(montar()) > cabe) {
    const menor = Math.min(...vivos.map((x) => x[1]));
    vivos = vivos.filter((x) => x[1] !== menor);
  }
  return montar();
}


/** Glifo de task da forma (`TaskPainel.glifo`); outro texto (corrompido) vira "?". */
const glifoTask = (g: unknown): string => (typeof g === 'string' && ['✓', '●', '◐', '○', '✗'].includes(g) ? g : '?');
/** Número do painel (contagem, %): só finito ≥ 0, senão "?" (D-P13: ausente e corrompido nunca viram 0 nem texto técnico). */
const ouInterroga = (v: unknown): string => { const n = nn(v); return n === null ? '?' : String(Math.round(n)); };

/**
 * Painel do estado novo (GM-15 T29, D-G1b/D-G1c): a CARA do painel E4 (`renderEsquadrao`, v2.0.0 — cabeçalho com o preset à direita, topo
 * `◆ DEPENDE DE VOCÊ`, PLANO com barra ▰▱ e a fila de tasks, EQUIPE com orquestrador, barras █░ de contexto e de 5h/7d, árvore ├─/└─ dos agentes,
 * `◆ ATENÇÃO`, histórico `hh:mm` e rodapé CI/PROD/política, separadores `─`, faixas por largura ≥ 60 / 44–59 / < 44) com TODA a regra do
 * painel de 5 blocos da GM-14: o que entra no topo (REQ-DEP-1), PRONTO/FASE (FIEL-10 b), AGORA ao vivo (FIEL-11), ATENÇÃO (FIEL-10 c), RECENTE
 * só resultados e com origem (FIEL-10 d), natural (REQ-LNG-1), D-P13 ("?" sem fonte, nunca 0), corte por orçamento (D-P8, emendas 32 e 37).
 *
 * Prioridade de corte (D-P8): 1 topo · 2 cabeçalho e PLANO/FASE · 3 orquestrador e agentes · 4 ATENÇÃO · 5 RECENTE; as linhas que só o E4 tinha
 * saem antes de todas (6 tasks em voo · 6.1 limites · 6.3 fila · 6.4 faixa de integradas · 6.5 rótulo EQUIPE · 6.6 nome do orquestrador · 6.7
 * narração · 6.8 rodapé), e os separadores só entram nas linhas que sobram (como no E4, cortados primeiro). Com pouca altura, como no E4: o
 * nome do orquestrador sai e a linha do contexto passa a levá-lo; as 2 linhas da fila viram 1.
 */
export function renderBlocos(e: EstadoPainel, o: OpcoesRender): Linha[] {
  const w0 = o?.largura;
  if (typeof w0 !== 'number' || !Number.isFinite(w0) || Math.floor(w0) < 1) throw new RangeError(`largura inválida: ${String(w0)} (número finito ≥ 1)`);
  const w = Math.floor(w0);
  const ludico = o.preset === 'esquadrao';
  const larga = w >= 60;
  const minima = w < 44;
  const id = idNatural(e.id);
  const fim = (l: Linha): Linha => cortarNatural(l, w);
  /** GM-15 T33 (g.9): todo "?" diz por que falta o dado, em 1–3 palavras, a partir de 100 colunas; abaixo disso fica só o "?". */
  const mot = motivoEm(w);

  if (e.modo === 'fora') return [fim([seg('GABARITO · fora de um projeto', 'inactive')])];
  if (e.umaLinha !== null && e.umaLinha !== undefined) {
    const u = e.umaLinha.ultima;
    const ult = u === null || typeof u?.id !== 'string' ? '' : ` · última: ${idNatural(u.id)}${typeof u.estado === 'string' && u.estado !== '' ? ` (${natural(u.estado)})` : ''}`;
    return comProjetoAcima(e, w, [fim([seg(`GABARITO · sem entrega em curso${ult}`, 'inactive')])]); // a linha única segue 1 linha; o projeto vem acima (emenda 4)
  }

  const quemTexto = (q: QuemPainel | null | undefined): string => {
    if (q === null || q === undefined) return '';
    if (ludico && typeof q.nome === 'string' && q.nome !== '') return natural(q.nome);
    if (!ludico) return PAPEL_EXECUTIVO[q.papel] ?? 'Implementador';
    return q.papel === 'orquestrador' ? 'orquestrador' : q.papel === 'sombra' ? 'Sombra' : (PAPEL_EXECUTIVO[q.papel] ?? 'Implementador');
  };

  const ls: LinhaPrioridade[] = [];
  const secao = new Map<Linha, number>(); // 0 cabeçalho e topo · 1 PLANO · 2 EQUIPE · 3 ATENÇÃO · 4 histórico e rodapé: o separador vai entre seções
  const topo = new Set<Linha>();
  const itensLinhas: Linha[][] = []; // as linhas de cada item do topo: um item entra inteiro ou não entra
  let ordem = 0;
  const por = (prioridade: number, l: Linha, sec: number): Linha => { ls.push({ prioridade, ordem: ordem++, l }); secao.set(l, sec); return l; };

  // ───────── cabeçalho (FIEL-10 f): o título uma vez; o preset à direita, como no E4 ─────────
  const titulo = id === '' ? '' : tituloLimpo(e.titulo, e.id); // sem entrega identificada, o título (da entrega) não se aplica
  const cab = `GABARITO · ${id !== '' ? id : 'entrega não identificada'}${titulo !== '' ? ` ${titulo}` : ''}`;
  const pacote = natural(e.pacote).toLowerCase();
  const rotuloPreset = ludico ? `esquadrão${pacote !== '' ? ` · ${pacote}` : ''}` : 'executivo';
  por(2, larga && colunas(cab) + 1 + colunas(rotuloPreset) <= w ? alinhar([seg(cab)], [seg(rotuloPreset, 'inactive')], w) : [seg(cab)], 0);

  // ───────── topo: PAROU, depois `◆ DEPENDE DE VOCÊ  N itens` com os itens recuados (REQ-DEP-1) ─────────
  type ItemTopo = { texto: string; cor?: CorTema; tipo: 'parou' | 'item' | 'proprio'; peso: number };
  const itensTopo: ItemTopo[] = [];
  const p = e.parar;
  if (p !== null && typeof p === 'object') itensTopo.push({ texto: `■ PAROU ${horaDe(p.hora)} · ${natural(p.texto)}${botoes(p.acoes)}`, cor: 'error', tipo: 'parou', peso: 0 });
  const q = e.pergunta;
  if (q !== null && q !== undefined && typeof q.texto === 'string') {
    const ops = (Array.isArray(q.opcoes) ? q.opcoes : []).map((x, i) => ` · ${i + 1} ${natural(x)}`).join('');
    itensTopo.push({ texto: `${natural(q.texto)}${ops}`, tipo: 'item', peso: 1 });
  }
  const mais = inteiroNaoNeg(e.perguntasMais) ?? 0;
  if (mais > 0) itensTopo.push({ texto: `mais ${mais} ${mais === 1 ? 'pergunta aberta' : 'perguntas abertas'}`, tipo: 'item', peso: mais });
  for (const i of Array.isArray(e.depende) ? e.depende : []) {
    if (i === null || typeof i !== 'object' || (p !== null && i.nivel === 'parar')) continue;
    const m = typeof i.motivo === 'string' ? i.motivo : '';
    if (m === 'nada depende de você') itensTopo.push({ texto: m, cor: 'inactive', tipo: 'proprio', peso: 0 }); // D-G12 (r.13): linha de situação
    else if (/^depende de você:/.test(m)) {
      const resto = natural(m.slice('depende de você:'.length));
      itensTopo.push({ texto: `depende de você:${resto === '' ? '' : ` ${resto}`}`, cor: /nada$/.test(m) ? 'inactive' : 'warning', tipo: 'proprio', peso: 0 });
    } else itensTopo.push({ texto: `${natural(m)}${botoes(i.acoes)}`, tipo: 'item', peso: 1 });
  }
  const nItens = itensTopo.reduce((n, x) => n + (x.tipo === 'item' ? x.peso : 0), 0);
  // O rótulo `◆ DEPENDE DE VOCÊ  N itens` do E4 é desenho, não item: com pouca altura é o 1º a sair e o 1º item passa a começar por `◆`
  // (troca no fim, mesma largura) — o (+N) conta só itens e a altura vai para o que é regra.
  let rotuloDepende: Linha | null = null;
  let primeiraDoItem: Linha | null = null;
  let semRotulo: Linha | null = null;
  for (const it of itensTopo) {
    if (it.tipo === 'item' && rotuloDepende === null) {
      rotuloDepende = por(6.9, [seg('◆ DEPENDE DE VOCÊ', 'warning'), seg(`  ${nItens} ${nItens === 1 ? 'item' : 'itens'}`, 'warning')], 0);
    }
    // REQ-GLB-1: o topo nunca sai cortado; o que não cabe em `w` quebra em linhas de continuação (recuo de 4), sem perder palavra
    const doItem = quebrarTopo(it.tipo === 'item' ? `  ${it.texto}` : it.texto, w).map((t): Linha => (it.cor === undefined ? [seg(t)] : [seg(t, it.cor)]));
    if (it.tipo === 'item' && primeiraDoItem === null && doItem.length > 0) {
      primeiraDoItem = doItem[0];
      semRotulo = [seg('◆', 'warning'), seg(textoDe(doItem[0]).slice(1))];
    }
    itensLinhas.push(doItem.map((l) => { por(1, l, 0); topo.add(l); return l; }));
  }

  // sem entrega: a última conhecida logo depois do topo (spec:53)
  const ultima = id === '' && typeof e.trilha?.ultimaConhecida === 'string' ? idNatural(e.trilha.ultimaConhecida) : '';
  if (ultima !== '') por(2, [seg(`última entrega conhecida: ${ultima}`, 'inactive')], 0);

  // ───────── PROJETO (GM-15 T32, emenda 4): acima da visão de entrega; o 1º a encolher no corte (a entrega mantém a prioridade D-P8) ─────────
  const projeto = projetoDe(e);
  if (projeto !== null) {
    const dp = linhasDoProjeto(projeto, w, mot);
    for (const l of dp.totais) por(6.94, l, 0.5);
    for (const l of dp.pbis) por(6.96, l, 0.5);
  }

  // nomes e cores dos agentes do AGORA (FIEL-3 d): o nome é único entre os ativos; a medição (ctx, tokens, modelo, cor) é a da equipe
  const ag = e.agora;
  const agentesAg: AgenteAgora[] | null = ag !== undefined && ag !== null && Array.isArray(ag.agentes) ? ag.agentes.filter((a) => a !== null && typeof a === 'object') : null;
  const eqAg: AgentePainel[] = Array.isArray(e.equipe?.agentes) ? e.equipe.agentes.filter((a) => a !== null && typeof a === 'object' && a.vivo === true) : [];
  const daEquipe = (a: AgenteAgora): AgentePainel | undefined => {
    const nome = a.quem?.nome;
    const porNome = typeof nome === 'string' && nome !== '' ? eqAg.filter((x) => x.nome === nome) : [];
    if (porNome.length === 1) return porNome[0];
    const porTask = eqAg.filter((x) => (x.task ?? null) === (a.task ?? null));
    return porNome.length === 0 && porTask.length === 1 ? porTask[0] : undefined;
  };

  // ───────── PLANO: PRONTO com a fila de tasks do E4 (FIEL-10 b), ou FASE sem plano ─────────
  const pr = e.pronto;
  let fila1: Linha | null = null;
  let fila2: Linha | null = null;
  let filaJunta: Linha | null = null;
  if (pr !== null && pr !== undefined) {
    const integ = inteiroNaoNeg(pr.integradas);
    const total = inteiroNaoNeg(pr.total);
    const pct = integ !== null && total !== null && total > 0 ? Math.round((Math.min(integ, total) / total) * 100) : null;
    const pctTxt = pct === null ? '?' : `${pct}%`;
    const tasksTxt = `${integ ?? '?'}/${total ?? '?'} tasks`;
    const prevV = pr.previsao !== null && typeof pr.previsao?.hora === 'string' && limpar(pr.previsao.hora) !== '' ? pr.previsao : null;
    // h.2: a base nunca encolhe a barra do PLANO (paridade com o E4): cabe no que sobra ao lado da barra que a faixa sozinha deixaria
    const fixo = 8 + 2 + colunas(pctTxt) + 2 + colunas(tasksTxt);
    const barraDaFaixa = prevV === null ? 5 : Math.min(21, Math.max(5, w - (fixo + 3 + colunas(textoPrevisao(prevV, 0, 0)))));
    const cabePrev = w - (fixo + barraDaFaixa + 3);
    const status = prevV !== null ? textoPrevisao(prevV, w, cabePrev)
      : p !== null && typeof p === 'object' ? 'loop parado' : e.parado === true ? 'loop pausado' : integ !== null && total !== null && total > 0 && integ >= total ? 'todas integradas'
        : w >= 100 && integ !== null && integ < 3 ? 'ETA ?: n insuficiente' : '';
    // a barra pinta só integradas (D-P6); sem número, "?" no lugar da barra (nunca barra vazia que pareça 0 %)
    const barraPlano = (bw: number): Linha => (pct === null ? [seg('?')] : barraSegs(pct, bw, '▰', '▱', 'success'));
    if (larga) {
      const resto = 8 + 2 + colunas(pctTxt) + 2 + colunas(tasksTxt) + 3 + colunas(status);
      const bw = Math.min(21, Math.max(5, w - resto));
      const esq: Linha = [seg('PLANO   '), ...barraPlano(bw), ...(pct === null ? [seg(`  ${tasksTxt}`)] : [seg(`  ${pctTxt}  ${tasksTxt}`)])];
      // status à direita como no E4; se não cabe, vai no fim da linha (cortado com "…"), nunca corta número
      por(2, status === '' ? esq : larg(esq) + 1 + colunas(status) <= w ? alinhar(esq, [seg(status, 'inactive')], w) : [...esq, seg(` · ${status}`, 'inactive')], 1);
    } else {
      por(2, [seg('PLANO '), ...barraPlano(minima ? 5 : 10), ...(pct === null ? [seg(` ${tasksTxt}`)] : [seg(` ${pctTxt} ${tasksTxt}`)]), ...(status !== '' ? [seg(` · ${status}`, 'inactive')] : [])], 1);
    }

    // faixa das integradas (E4): a contagem, nunca a lista (FIEL-10 b: task integrada não é listada)
    if (larga && integ !== null && integ > 0) {
      const partes = [`${integ} ${integ === 1 ? 'integrada' : 'integradas'}`];
      const r = nn(e.plano?.rodadaMedia);
      const m = nn(e.plano?.medianaS);
      const extra = [...(r !== null ? [`${r.toFixed(1)} rodada média`] : []), ...(m !== null ? [`mediana ${Math.round(m / 60)} min`] : [])];
      por(6.4, [seg('  '), seg('✓', 'success'), seg(` ${partes[0]}`), ...(extra.length > 0 ? [seg(` · ${extra.join(' · ')}`, 'inactive')] : [])], 1);
    }

    // tasks em voo e fila (E4); `pendente` com vivo casado está em curso, nunca na fila (FIEL-3 a)
    const tasks: TaskPainel[] = Array.isArray(e.plano?.tasks) ? e.plano.tasks.filter((x) => x !== null && typeof x === 'object' && typeof x.id === 'string') : [];
    const ordemIds = tasks.map((x) => x.id);
    const emCurso = (x: TaskPainel): boolean => x.estado === 'pendente' && x.glifo === '●';
    const emVoo = tasks.filter((x) => x.estado !== 'integrada' && (x.estado !== 'pendente' || emCurso(x)));
    const fila = tasks.filter((x) => x.estado === 'pendente' && !emCurso(x));
    const aberta = (tid: unknown): boolean => tasks.find((x) => x.id === tid)?.estado !== 'integrada';
    // FIEL-8: `concluida` se diz "entregue"; `pendente` em curso, "em curso"
    const estadoTxt = (x: TaskPainel): string => (emCurso(x) ? 'em curso' : x.estado === 'concluida' ? 'entregue' : textoEstadoTask(x.estado));
    const estadoCor = (x: TaskPainel): CorTema => (emCurso(x) ? 'success' : corEstadoTask(x.estado));
    // o nome na fila é o do agente vivo da task (o mesmo do AGORA); sem dados da sessão (FIEL-4), nenhum nome
    const agenteDaTask = (x: TaskPainel): AgenteAgora | undefined => agentesAg?.find((a) => a.task === x.id);
    const nomeDe = (x: TaskPainel): string => { const a = agenteDaTask(x); return a === undefined ? '' : quemTexto(a.quem); };
    const corNome = (x: TaskPainel): CorTema | undefined => { const a = agenteDaTask(x); return a === undefined ? undefined : daEquipe(a)?.cor; };
    const nomeW = maxCol(emVoo.map(nomeDe));
    const estW = maxCol(emVoo.map(estadoTxt));
    const primeira: TaskPainel | undefined = fila[0];
    const id2 = (x: TaskPainel): string => t(x.id);
    const idW = maxCol([...emVoo.map(id2), ...(larga && primeira ? [id2(primeira)] : [])]);
    const tempoTask = (x: TaskPainel): string => tempoDe(x.desdeS);
    if (larga) {
      const tcol = w >= 80 ? Math.min(40, w - 48) : w >= 72 ? 24 : 0;
      const tituloT = (x: TaskPainel): string => (tcol > 0 ? cortar(natural(x.titulo), tcol) : '');
      const tw = maxCol([...emVoo.map(tituloT), ...(primeira ? [tituloT(primeira)] : [])]);
      const colTitulo = (x: TaskPainel, cor?: CorTema): Linha => (tw > 0 ? [seg(pad(tituloT(x), tw), cor), seg('  ')] : []);
      for (const x of emVoo) {
        const c = estadoCor(x);
        por(6, aparar([
          seg('  '), seg(glifoTask(x.glifo), c), seg(` ${pad(id2(x), idW)}  `), ...colTitulo(x),
          seg(pad(estadoTxt(x), estW), c), seg('  '), ...(nomeW > 0 ? [seg(pad(nomeDe(x), nomeW), corNome(x)), seg('  ')] : []), seg(tempoTask(x), 'inactive'),
        ]), 1);
      }
      if (primeira) {
        const deps = (Array.isArray(primeira.deps) ? primeira.deps : []).filter(aberta).map(t).filter((x) => x !== '');
        fila1 = por(6.3, aparar([
          seg('  '), seg('○', 'inactive'), seg(` ${pad(id2(primeira), idW)}  `, 'inactive'), ...colTitulo(primeira, 'inactive'),
          seg(deps.length > 0 ? `fila · depende de ${deps.join(' ')}` : 'fila', 'inactive'),
        ]), 1);
        if (fila.length > 1) {
          filaJunta = [seg('  '), seg(`○ ${t(faixaIds(fila.map((x) => x.id), ordemIds))}  fila`, 'inactive')];
          fila2 = por(6.3, [seg('  '), seg(`○ ${t(faixaIds(fila.slice(1).map((x) => x.id), ordemIds))}  fila`, 'inactive')], 1);
        }
      }
    } else {
      for (const x of emVoo) {
        const c = estadoCor(x);
        const nome = nomeDe(x);
        por(6, aparar([
          seg(glifoTask(x.glifo), c), seg(` ${id2(x)} `), ...(nome !== '' ? [seg(pad(nome, nomeW), corNome(x)), seg('  ')] : []),
          seg(pad(estadoTxt(x), estW), c), seg('  '), seg(tempoTask(x), 'inactive'),
        ]), 1);
      }
      if (fila.length > 0) fila1 = por(6.3, [seg(`○ ${t(faixaIds(fila.map((x) => x.id), ordemIds))} fila`, 'inactive')], 1);
    }
  } else if (e.fase !== null && e.fase !== undefined) {
    const f = e.fase;
    const marcas = Array.isArray(f.marcas) ? f.marcas : [];
    const n = inteiroNaoNeg(f.numero);
    const barra7 = FASES_NOME.map((_, i) => (marcas[i] === '✓' ? '▰' : '▱')).join('');
    const trilha = FASES_NOME.map((nome, i) => `${['✓', '●', '○', '?'].includes(marcas[i]) ? marcas[i] : '?'} ${nome}`).join(' › ');
    const partes = [natural(f.progresso), ...(Array.isArray(f.sufixo) ? f.sufixo.map((x) => natural(x)) : []), ...(typeof f.motivo === 'string' ? [`? ${natural(f.motivo)}`] : [])].filter((x) => x !== '');
    // GM-15 T32 (emenda 4 item 4, D-P13): sem `plano.json` a fase não é medida ("fase não medida", sem "n de 7" nem barra); com ele, "FASE n de 7". Sem a marca (estado de fora do CLI), como antes.
    const semPlanoJson = (e as EstadoPainel & { temPlanoJson?: boolean }).temPlanoJson === false;
    const rotuloF = rotuloFase(!semPlanoJson, n);
    por(2, semPlanoJson
      ? [seg(rotuloF), seg(`${partes.map((x) => ` · ${x}`).join('')} · `), seg(trilha, 'inactive')]
      : [seg(`${rotuloF} `), seg(barra7, 'success'), seg(`${partes.map((x) => ` · ${x}`).join('')} · `), seg(trilha, 'inactive')], 1);
  }

  // ───────── EQUIPE: o AGORA (FIEL-4, FIEL-11) no desenho do E4 ─────────
  const agoraAgentes: LinhaPrioridade[] = []; // as linhas de agente (candidatas à linha-resumo, T42 emenda 37)
  const resumo: { r: string; t: string }[] = [];
  let nVivos = 0;
  let linhaNomeOrq: Linha | null = null;
  let linhaCtx: Linha | null = null;
  let ctxComNome: Linha | null = null;
  if (ag !== undefined && ag !== null) {
    if (agentesAg === null) {
      // FIEL-4: sem dados da sessão, 1 linha só; nada de contexto, tokens, 5h/7d nem nomes sorteados
      por(3, [seg('EQUIPE · '), seg('agentes e contexto: medidos só no painel da sessão', 'inactive')], 2);
    } else {
      nVivos = agentesAg.length; // "N agentes" = número de linhas de agente (FIEL-6 b)
      if (larga) por(6.5, alinhar([seg('EQUIPE')], [seg(`agentes ${nVivos} ${nVivos === 1 ? 'vivo' : 'vivos'}`, 'inactive')], w), 2);
      const or = ag.orquestrador;
      const nomeOrq = quemTexto({ nome: typeof or?.nome === 'string' ? or.nome : null, papel: 'orquestrador' });
      const lider = e.equipe?.lider;
      const c0 = or?.contexto;
      const pct = typeof c0 === 'number' && Number.isFinite(c0) && c0 >= 0 ? Math.round(c0) : null;
      const estim = or?.estimado === true && pct !== null;
      const xp = nn(lider?.x);
      const hora = pct !== null && or?.pousar === true ? ' · hora de pousar' : '';
      const tokV = nn(lider?.tok);
      const tokTxt = `   tok ${tokV === null ? `?${mot('sem medição')}` : fmtTok(tokV)}`;
      /** Linha do contexto do orquestrador: barra █░ (sem medição, "?" no lugar dela); "hora de pousar" nunca é cortada: a barra cede, depois o "pouso em". */
      const ctxOrq = (comNome: boolean, comTok: boolean): Linha => {
        let pre: Linha = comNome ? [seg(nomeOrq), seg(' ctx ')] : [seg('│', 'inactive'), seg('  ctx ')];
        let tk = comTok ? tokTxt : '';
        const teto = comNome ? 19 : w >= 72 ? 29 : 19;
        let pz = xp === null ? '' : ` · pouso em ${fmtPct(xp)}`;
        let est = estim ? ' (estimado)' : '';
        const txtPct = (): string => (pct === null ? `?${mot('sem medição')}` : `${estim ? '~' : ''}${pct}%${est}`);
        const fixo = (): number => larg(pre) + (pct === null ? 0 : 1) + colunas(txtPct()) + colunas(pz) + colunas(hora) + colunas(tk);
        let bw = Math.min(teto, w - fixo());
        // "hora de pousar" nunca é cortada: cede a barra, depois o "pouso em", depois o "(estimado)" (o "~" segue dizendo que é estimado),
        // depois os tokens, depois o nome (encurtado com "…", depois fora) e por fim o "ctx " (review T29 r1: < 44 e nome longo)
        if (bw < 5 && pz !== '') { pz = ''; bw = Math.min(teto, w - fixo()); }
        if (bw < 1 && est !== '') { est = ''; bw = Math.min(teto, w - fixo()); }
        if (hora !== '' && bw < 1 && tk !== '') { tk = ''; bw = Math.min(teto, w - fixo()); }
        if (hora !== '' && bw < -1 && comNome) {
          const nomeCabe = colunas(nomeOrq) + bw + 1; // sem barra, o espaço antes do número também sai
          pre = nomeCabe >= 2 ? [seg(cortar(nomeOrq, nomeCabe)), seg(' ctx ')] : [seg('ctx ')];
          bw = Math.min(teto, w - fixo());
        }
        if (hora !== '' && bw < -1) { pre = []; bw = Math.min(teto, w - fixo()); }
        // nem o número cabe ao lado: fica só o aviso, inteiro
        if (hora !== '' && bw < -1) return [seg(hora.replace(/^ · /, ''), 'warning')];
        bw = Math.max(0, bw);
        return [
          ...pre, ...(pct === null ? [seg(txtPct())] : [...barraSegs(pct, bw, '█', '░', 'success'), seg(`${bw > 0 ? ' ' : ''}${txtPct()}`)]),
          ...(pz !== '' ? [seg(pz, 'inactive')] : []), ...(hora !== '' ? [seg(hora, 'warning')] : []), ...(tk !== '' ? [seg(tk)] : []),
        ];
      };
      const h5 = nn(lider?.h5);
      const d7 = nn(lider?.d7);
      if (larga) {
        const modelo = t(lider?.modelo);
        linhaNomeOrq = por(6.6, aparar([seg(nomeOrq), seg('  orquestra'), ...(modelo !== '' ? [seg(` · ${modelo}`, 'inactive')] : [])]), 2);
        linhaCtx = por(3, ctxOrq(false, true), 2);
        ctxComNome = ctxOrq(true, true);
        // limites 5h e 7d com a barra de 10 do E4; sem medição, "?" no lugar da barra (D-P13)
        // D-G7 (g.10): sem `five_hour` na plataforma o campo 5h não existe (omitido, nunca "5h ?"); o 7d segue, com "?" quando não medido (D-P13)
        const lim = (rot: string, v: number | null): Linha => (v === null ? [seg(`${rot} ?${mot('sem medição')}`)] : [seg(`${rot} `), ...barraSegs(v, 10, '█', '░', 'success'), seg(` ${fmtPct(v)}`)]);
        por(6.1, [seg('│', 'inactive'), seg('  '), ...(h5 !== null ? [...lim('5h', h5), seg('   ')] : []), ...lim('7d', d7)], 2);
        const narr = natural(lider?.narrativa);
        // `▶` do E4 é pictográfico (vira emoji em terminal, FIEL-13 c): `▸`
        if (o.narracao === true && w >= 72 && narr !== '') por(6.7, [seg('│', 'inactive'), seg('  '), seg('▸', 'success'), seg(` ${narr}`)], 2);
      } else {
        linhaCtx = por(3, ctxOrq(true, false), 2);
        por(6.1, [seg('│ ', 'inactive'), seg(`${h5 === null ? '' : `5h ${fmtPct(h5)} `}7d ${d7 === null ? '?' : fmtPct(d7)}${tokTxt.replace(/^ +/, ' ')}`)], 2);
      }

      // árvore dos agentes (├─ … └─): só ativos (FIEL-6); o que faz (FIEL-11 b) no fim da linha, onde o corte não alcança número
      // GM-15 T33 (g.11, D-G8): a EQUIPE tem só agentes (+ Sombra); o shell de fundo vai para a seção SEGUNDO PLANO, abaixo
      // GM-15 T32 (emenda 4 item 5): o agente só é da task se ela saiu de `pendente` (alguém rodou `loop.mjs iniciar`); senão "agente fora do loop" (a regra única de `projeto.ts`)
      const estadosDasTasks = new Map<string, EstadoTask>((Array.isArray(e.plano?.tasks) ? e.plano.tasks : []).filter((x) => x !== null && typeof x === 'object' && typeof x.id === 'string').map((x) => [x.id, x.estado as EstadoTask]));
      const dados = agentesAg.map((a) => {
        const eq = daEquipe(a);
        const tempo = inteiroNaoNeg(a.desdeS);
        return {
          nome: quemTexto(a.quem), cor: eq?.cor, gc: (eq?.estadoTask == null ? 'inactive' : corEstadoTask(eq.estadoTask)) as CorTema, modelo: t(eq?.modelo),
          task: rotuloAgente({ task: typeof a.task === 'string' && t(a.task) !== '' ? t(a.task) : null, papelExibido: null }, estadosDasTasks),
          pct: nn(eq?.ctxPct), tok: nn(eq?.ctxTok), tempo: tempo === null ? '' : fmtTempo(tempo),
          acao: a.acao === null || a.acao === undefined ? `?${mot('sem fonte')}` : natural(a.acao, 'reticencia') || `?${mot('sem fonte')}`,
        };
      });
      type Dado = (typeof dados)[number];
      const ctxSegs = (d: Dado): Linha => (d.pct !== null
        ? [seg('ctx '), ...barraSegs(d.pct, 10, '█', '░', 'success'), seg(` ${fmtPct(d.pct)}`)]
        : [seg(d.tok !== null ? `ctx ${fmtTok(d.tok)}` : `ctx ?${mot('sem medição')}`)]);
      const linhas: Linha[] = [];
      const sb = e.equipe?.sombra;
      const temSombra = sb !== null && typeof sb === 'object';
      if (larga) {
        const nw = maxCol(dados.map((d) => d.nome));
        const tw = maxCol(dados.map((d) => d.task));
        const cw = maxCol(dados.map((d) => textoDe(ctxSegs(d))));
        const acaoMin = Math.min(12, maxCol(dados.map((d) => d.acao)));
        // níveis (o número nunca é cortado, P1c D-R6): 0 tudo · 1 sem modelo · 2 sem tempo · 3 nome encurtado com "…"
        const bases = (nivel: number, nwU: number): Linha[] => {
          const nomeDe = (d: Dado): string => (nivel >= 3 ? cortar(d.nome, nwU) : d.nome);
          const modeloDe = (d: Dado): string => (nivel === 0 && d.modelo !== '' ? ` · ${d.modelo}` : '');
          const nmw = maxCol(dados.map((d) => `${nomeDe(d)}${modeloDe(d)}`));
          const caudas = dados.map((d) => [...(d.pct !== null && d.tok !== null ? [fmtTok(d.tok)] : []), ...(nivel < 2 && d.tempo !== '' ? [d.tempo] : [])].join(' · '));
          const caw = maxCol(caudas);
          return dados.map((d, i) => [
            seg(PREFIXO(i === dados.length - 1 && !temSombra, true), 'inactive'), seg('●', d.gc), seg(' '), seg(nomeDe(d), d.cor),
            ...(modeloDe(d) !== '' ? [seg(modeloDe(d), 'inactive')] : []), seg(' '.repeat(nmw - colunas(`${nomeDe(d)}${modeloDe(d)}`))), seg('  '), seg(pad(d.task, tw)), seg('  '),
            ...ctxSegs(d), seg(' '.repeat(cw - colunas(textoDe(ctxSegs(d))))), ...(caw > 0 ? [seg(`  ${pad(caudas[i], caw)}`, 'inactive')] : []),
          ]);
        };
        let nivel = 0;
        let nwU = nw;
        const largura = (n: number): number => Math.max(0, ...bases(n, nwU).map(larg)) + 2 + acaoMin;
        while (nivel < 3 && largura(nivel) > w) {
          nivel++;
          if (nivel === 3) nwU = Math.max(1, nw - (largura(3) - w));
        }
        bases(nivel, nwU).forEach((b, i) => linhas.push([...b, seg(`  ${dados[i].acao}`)]));
      } else {
        const nw = maxCol(dados.map((d) => d.nome));
        dados.forEach((d, i) => {
          const nums = [d.pct !== null ? fmtPct(d.pct) : '', d.tok !== null ? fmtTok(d.tok) : ''].filter((x) => x !== '').join(' ') || '?';
          linhas.push(aparar([
            seg(PREFIXO(i === dados.length - 1 && !temSombra, false), 'inactive'), seg('●', d.gc), seg(' '), seg(pad(d.nome, nw), d.cor), seg(` ${d.task}`),
            seg(`${nums !== '' ? ` ${nums}` : ''}${d.tempo !== '' ? ` ${d.tempo}` : ''}`, 'inactive'), seg(` ${d.acao}`),
          ]));
        });
      }
      linhas.forEach((l, i) => {
        por(3, l, 2); agoraAgentes.push(ls[ls.length - 1]);
        resumo.push({ r: dados[i].nome, t: dados[i].task });
      });
      // GM-15 T33 (g.8, emenda 11): a Sombra é o último `└` da EQUIPE, como no E4 (`renderEsquadrao`): nome, "aconselha", modelo, nº de decisões e a última
      // `#seq resposta (fonte)`; estreito ⇒ nome + `#seq`; sem decisão ⇒ só o nome. Nos 2 presets (o executivo chama de Conselheiro, `PAPEL_EXECUTIVO`).
      if (temSombra) {
        const nomeS = quemTexto({ nome: typeof sb.nome === 'string' ? sb.nome : null, papel: 'sombra' });
        const decS = nn(sb.decisoes);
        const ultS = sb.ultima !== null && typeof sb.ultima === 'object' ? sb.ultima : null;
        const seqS = ultS === null ? null : nn(ultS.seq);
        const temDecisao = (decS !== null && decS > 0) || seqS !== null;
        if (larga) {
          const cont = decS === null || decS === 0 ? '' : `${Math.round(decS)} ${Math.round(decS) === 1 ? 'decisão' : 'decisões'}`;
          const resp = ultS !== null && seqS !== null ? `#${Math.round(seqS)} ${natural(ultS.resposta)}${t(ultS.fonte) !== '' ? ` (${t(ultS.fonte)})` : ''}` : '';
          const mod = t(sb.modelo);
          por(3, aparar(temDecisao
            ? [seg(PREFIXO(true, true), 'inactive'), seg('○', 'inactive'), seg(' '), seg(nomeS, 'planMode'), seg('  aconselha'), ...(mod !== '' ? [seg(` · ${mod}`, 'inactive')] : []),
              seg(`  ${[cont, resp].filter((x) => x !== '').join(' · ')}`, 'inactive')]
            : [seg(PREFIXO(true, true), 'inactive'), seg('○', 'inactive'), seg(' '), seg(nomeS, 'planMode')]), 2);
        } else {
          const fim2 = ultS !== null && seqS !== null ? ` #${Math.round(seqS)}` : '';
          por(3, aparar([seg(PREFIXO(true, false), 'inactive'), seg('○', 'inactive'), seg(' '), seg(nomeS, 'planMode'), ...(fim2 !== '' ? [seg(fim2, 'inactive')] : [])]), 2);
        }
      }
      // GM-15 T33 (g.11, D-G8): SEGUNDO PLANO, seção própria abaixo da EQUIPE, 1 linha por shell de fundo (tipo · task · quem disparou · tempo); `agora.segundoPlano`
      // já vem rotulado por `painel.ts` (`quem` = quem disparou, `task`, `acao` = tipo). É a 1ª a encolher no corte (prioridade 7; o resumo da seção, 6,9); vazia, some.
      const shells = Array.isArray(ag.segundoPlano) ? ag.segundoPlano.filter((a) => a !== null && typeof a === 'object') : [];
      if (shells.length > 0) {
        const TIPOS: [string, string, string][] = [['Integrando', 'integrando', 'integrando'], ['Teste', 'teste', 'testes'], ['Aguardando', 'aguardando', 'aguardando'], ['Comando', 'comando', 'comandos']];
        const tipoDe = (a: AgenteAgora): string => (TIPOS.some((x) => x[0] === a.acao) ? (a.acao as string) : 'Comando');
        const contagem = TIPOS.map(([k, um, varios]) => { const n = shells.filter((a) => tipoDe(a) === k).length; return n === 0 ? '' : k === 'Integrando' || k === 'Aguardando' ? `${n} ${um}` : `${n} ${n === 1 ? um : varios}`; }).filter((x) => x !== '').join(' · ');
        if (larga) {
          por(6.9, alinhar([seg('SEGUNDO PLANO')], [seg(contagem, 'inactive')], w), 2.5);
          for (const a of shells) {
            const quemS = a.quem !== null && typeof a.quem === 'object' && a.quem.papel === 'orquestrador' ? nomeOrq : quemTexto(a.quem);
            const taskS = typeof a.task === 'string' && t(a.task) !== '' ? ` ${t(a.task)}` : '';
            const tempoS = inteiroNaoNeg(a.desdeS);
            por(7, aparar([seg('  ◦ ', 'inactive'), seg(`${tipoDe(a)}${taskS}`), seg(` · ${quemS}${tempoS !== null ? ` · ${fmtTempo(tempoS)}` : ''}`, 'inactive')]), 2.5);
          }
        } else {
          por(6.9, [seg(`segundo plano: ${contagem}`, 'inactive')], 2.5);
        }
      }
    }
  }

  // ───────── ATENÇÃO (FIEL-10 c): `◆ ATENÇÃO  a · b` do E4; o que não cabe vai à linha seguinte, alinhado ─────────
  const atencao = (Array.isArray(e.atencao) ? e.atencao : []).map((x) => natural(x)).filter((x) => x !== '');
  const rotAt = larga ? '◆ ATENÇÃO  ' : '◆ ';
  const grupos: string[][] = [];
  for (const x of atencao) {
    const g = grupos[grupos.length - 1];
    if (g !== undefined && colunas(rotAt) + colunas([...g, x].join(' · ')) <= w) g.push(x);
    else grupos.push([x]);
  }
  grupos.forEach((g, i) => por(4, i === 0 ? [seg(rotAt.trimEnd(), 'warning'), seg(`${larga ? '  ' : ' '}${g.join(' · ')}`)] : [seg(`${' '.repeat(colunas(rotAt))}${g.join(' · ')}`)], 3));

  // ───────── histórico do E4 = RECENTE (FIEL-10 d): só resultados, mais novo no topo, com origem; até 5 na lateral e 2 acima do input ─────────
  const cap = o.local === 'acima' ? 2 : 5;
  const todosRec = Array.isArray(e.recente) ? e.recente.filter((r) => r !== null && typeof r === 'object') : [];
  const rec = todosRec.slice(0, cap);
  const dec = (e as EstadoPainel & { decisaoSombra?: ItemRecente | null }).decisaoSombra;
  const daDecisao: Linha[] = [];
  for (const r of rec) {
    const lr = por(5, linhaRecente(r, quemTexto, natural(r.texto)), 4);
    if (dec !== null && dec !== undefined && typeof dec === 'object' && (r === dec || (r.hora === dec.hora && r.texto === dec.texto && r.glifo === dec.glifo && r.origem === dec.origem))) daDecisao.push(lr);
  }

  // rodapé do E4: CI, produção e política; sem medição, "?" (D-P13); `▼ N` = resultados que o teto do local escondeu
  if (e.rodape !== null && typeof e.rodape === 'object') {
    const ci = e.rodape.ci?.verde;
    // g.9: nenhum `ci.resultado` da entrega ⇒ "CI sem execução"; `rodape.ci.pendente` (execução rodando) ⇒ "CI pendente"
    const ciTxt = ci === true ? 'verde' : ci === false ? 'vermelho' : `?${mot((e.rodape.ci as { pendente?: boolean } | undefined)?.pendente === true ? 'CI pendente' : 'CI sem execução')}`;
    const ciCor: CorTema = ci === true ? 'success' : ci === false ? 'warning' : 'inactive';
    const leu = ouInterroga(e.rodape.prod?.leituras) + (nn(e.rodape.prod?.leituras) === null ? mot('diário sem leitura') : '');
    const alt = ouInterroga(e.rodape.prod?.alteracoes) + (nn(e.rodape.prod?.alteracoes) === null ? mot('diário sem leitura') : '');
    const pol0 = natural(e.rodape.politica);
    const pol = pol0 === '' || pol0 === 'undefined' || pol0 === 'null' ? `?${mot('sem política')}` : pol0;
    const k = Math.max(0, todosRec.length - rec.length);
    por(6.8, larga
      ? alinhar([seg('CI '), seg('●', ciCor), seg(` ${ciTxt}   PROD leu ${leu} · alterou ${alt}   política ${pol}`)], k > 0 ? [seg(`▼ ${k} ${k === 1 ? 'evento' : 'eventos'}`, 'inactive')] : [], w)
      : [seg('CI '), seg('●', ciCor), seg(` ${ciTxt}  PROD ${leu}/${alt}`), ...(k > 0 ? [seg(`  ▼ ${k}`, 'inactive')] : [])], 4);
  }

  // Reserva (T42, emenda 32): a decisão da Sombra mais recente, na mesma linha do RECENTE; entra quando o corte tira o RECENTE (inteiro ou em parte) e a decisão não sobra.
  const reserva: Linha | null = dec === null || dec === undefined || typeof dec !== 'object' ? null : linhaReserva(dec, quemTexto, w);
  if (reserva !== null) secao.set(reserva, 4);

  // corte por orçamento (REQ-GLB-1): `orcamento`, senão `altura`; sem os dois, sem corte
  const orc = alturaValida(o.orcamento) ?? alturaValida(o.altura);
  let cortado: { linhas: Linha[]; cortadasTopo: number } = orc === undefined ? { linhas: ls.map((x) => x.l), cortadasTopo: 0 } : cortarComReserva(ls, orc, reserva, daDecisao);
  // Linha-resumo (T42, emenda 37): só quando há reserva da Sombra, ela NÃO coube e compactar o AGORA (agentes) em 1 linha a faz caber.
  if (orc !== undefined && reserva !== null && !cortado.linhas.includes(reserva) && nVivos >= 1 && agoraAgentes.length >= 2) {
    const recente = ls.filter((x) => x.prioridade === 5).map((x) => x.l);
    if (recente.length > 0 && !recente.some((l) => cortado.linhas.includes(l))) {
      const compacta = linhaResumo(nVivos, resumo, w);
      secao.set(compacta, 2);
      const fora = new Set(agoraAgentes);
      const ls2: LinhaPrioridade[] = [];
      ls.forEach((x) => { if (x === agoraAgentes[0]) ls2.push({ ...x, l: compacta }); else if (!fora.has(x)) ls2.push(x); });
      const semRecente = ls2.filter((x) => x.prioridade !== 5);
      const ultimo = ls2.reduce((m, x) => Math.max(m, x.ordem), 0) + 1;
      const c2 = cortarPorPrioridade([...semRecente, { prioridade: PRIORIDADE_RESERVA, ordem: ultimo, l: reserva }], orc);
      if (c2.linhas.includes(reserva)) cortado = { linhas: c2.linhas, cortadasTopo: c2.cortadasTopo };
    }
  }
  const ficou = new Set(cortado.linhas);
  // trocas do E4 com pouca altura: sem a linha do nome, o contexto do orquestrador leva o nome; sem a 2ª linha da fila, a 1ª vira a faixa inteira
  const troca = new Map<Linha, Linha>();
  if (rotuloDepende !== null && primeiraDoItem !== null && semRotulo !== null && !ficou.has(rotuloDepende) && ficou.has(primeiraDoItem)) troca.set(primeiraDoItem, semRotulo);
  if (linhaNomeOrq !== null && linhaCtx !== null && ctxComNome !== null && !ficou.has(linhaNomeOrq) && ficou.has(linhaCtx)) troca.set(linhaCtx, ctxComNome);
  if (fila1 !== null && fila2 !== null && filaJunta !== null && ficou.has(fila1) && !ficou.has(fila2)) troca.set(fila1, filaJunta);

  // (+N) conta ITENS escondidos (spec:47), nunca linhas quebradas; o item que não coube inteiro sai inteiro.
  // LIMITE (spec não diz quem cede): o 1º item sozinho maior que o orçamento — D15 vence; fica o que cabe, a última linha termina em "…" (uma só).
  const sai = new Set<Linha>();
  let escondidos = 0;
  let truncada: Linha | null = null;
  itensLinhas.forEach((item, k) => {
    const dentro = item.filter((l) => ficou.has(l)).length;
    if (dentro === item.length) return;
    if (k === 0 && dentro > 0) { truncada = item[dentro - 1]; return; }
    escondidos++;
    for (const l of item) sai.add(l);
  });
  const linhas = cortado.linhas.filter((l) => !sai.has(l));
  const ultTopo = escondidos > 0 || truncada !== null ? linhas.reduce((k, l, i) => (topo.has(l) && !sai.has(l) ? i : k), -1) : -1;
  const desenhadas = linhas.map((l, i): { orig: Linha; l: Linha } => {
    const reticencia = l === truncada;
    if (i !== ultTopo && !reticencia) return { orig: l, l: fim(troca.get(l) ?? l) };
    const mais2 = escondidos > 0 ? ` (+${escondidos})` : '';
    const cabe = Math.max(1, w - colunas(mais2));
    const folga = reticencia && colunas(textoDe(l)) < cabe;
    const lt = troca.get(l) ?? l;
    const base = cortarNatural(lt, reticencia && !folga ? (colunas(textoDe(l)) === cabe ? Math.max(1, cabe - 1) : cabe) : cabe);
    return { orig: l, l: [...base, ...(folga ? [seg('…', 'warning')] : []), ...(mais2 !== '' ? [seg(mais2, 'warning')] : [])] };
  });

  // separadores do E4 entre seções, só nas linhas que sobram do orçamento (cortados primeiro, como no E4); < 44 colunas não tem
  let livres = orc === undefined ? Number.POSITIVE_INFINITY : orc - desenhadas.length;
  const saida: Linha[] = [];
  let anterior = -1;
  for (const d of desenhadas) {
    const s = secao.get(d.orig) ?? anterior;
    if (!minima && saida.length > 0 && s !== anterior && livres > 0) { saida.push(separador(w)); livres--; }
    saida.push(d.l);
    anterior = s;
  }
  return saida;
}

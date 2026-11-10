/**
 * Preset Executivo (E4, GM-12 T6, REQ-PNL-4 e REQ-PNL-9): o painel para quem só quer os números.
 * Mesmos números do Esquadrão (formatos de `painel-formato.ts`, topo de `blocoTopo`), sem nome de ninguém, sem histórico, sem narrativa, sem Atenção técnica.
 * Faixas: ≥ 60 desenho completo; 50-59 linha de agente curta; < 50 rótulos de 3 letras.
 * Núcleo puro (sem `node:*`). Nunca lê `o.tema` (a cor só vira SGR em `paraTexto`), nem `o.narracao`, nem `o.preset`.
 * Contrato de falha: ausente e corrompido nunca viram texto (`NaN`, `undefined`...): `num()` trata os dois como ausente (`—` ou omissão); `0` é `0`.
 * Decisões: `.superpowers/sdd/2026-11-09-e4-painel/sombra-p1c.md` §0 e "Task 6".
 */

import { colunas, cortar, limpar } from './painel-largura.js';
import { barra, blocoTopo, cortarLinha, cortarPorAltura } from './painel-texto.js';
                                                      
import { alinhar, corEstadoTask, fmtPct, fmtTempo, fmtTok, num, previsao, separador } from './painel-formato.js';
                                                                                                     

const MDASH = '—';
const ROTULO_LONGO = 13;
const ROTULO_CURTO = 4;
const FAIXA_AGENTE_LONGA = 60;
const FAIXA_ROTULO_LONGO = 50;

const seg = (texto        , cor          )           => (cor === undefined ? { texto } : { texto, cor });
const larguraDe = (l       )         => l.reduce((n, s) => n + colunas(s.texto), 0);
/** Valor que não pode ser negativo (%, tokens, contagem): negativo é dado corrompido, igual a ausente. */
const naoNeg = (v         )                => {
  const n = num(v);
  return n === null || n < 0 ? null : n;
};
const inteiro = (v         )                => {
  const n = naoNeg(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const texto = (v         )         => (typeof v === 'string' ? limpar(v).trim() : '');
const plural = (n        , um        , varios        )         => `${n} ${n === 1 ? um : varios}`;
const clamp = (v        , min        , max        )         => Math.min(max, Math.max(min, v));

/** Rótulo das linhas de dados: 13 colunas em ≥ 50, 4 colunas (3 letras + espaço) abaixo. */
const ROTULOS                                             = {
  entrega: ['Entrega', 'Ent'], previsao: ['Previsão', 'Prv'], tasks: ['Tasks', 'Tsk'], qualidade: ['Qualidade', 'Qld'],
  ci: ['CI', 'CI'], producao: ['Produção', 'Prd'], contexto: ['Contexto', 'Ctx'], limites: ['Limites', 'Lim'],
};

function linhaDado(chave        , curto         , valor            )        {
  const [longo, abrev] = ROTULOS[chave];
  return [seg(curto ? abrev.padEnd(ROTULO_CURTO) : longo.padEnd(ROTULO_LONGO)), ...valor];
}

function larguraValida(v         )         {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) throw new RangeError(`largura inválida: ${String(v)} (número finito ≥ 1)`);
  return Math.floor(v);
}

export function renderExecutivo(e              , o              )          {
  const w = larguraValida(o?.largura);
  const curto = w < FAIXA_ROTULO_LONGO;
  const linhas          = [];
  // classe de corte por altura (índice de `linhas` ⇒ marca): separadores, Limites, Contexto, Produção; ver `cortarPorAltura`
  const marcas = new Map                ();
  const marca = (tag        )       => { marcas.set(linhas.length - 1, tag); };

  // Cabeçalho: `GABARITO · <id> <título>` + `executivo` à direita.
  const titulo = texto(e.titulo);
  const esq        = [seg(`GABARITO · ${texto(e.id)}`), ...(titulo === '' ? [] : [seg(` ${titulo}`)])];
  linhas.push(alinhar(esq, [seg('executivo', 'inactive')], w));

  // Topo (depende de você / PAROU): o mesmo bloco do Esquadrão, colado sem alteração.
  linhas.push(...blocoTopo(e, w));
  linhas.push(separador(w)); marca('sep');

  const tasks = Array.isArray(e.plano?.tasks) ? e.plano.tasks : [];

  // Entrega
  const pct = naoNeg(e.plano?.pct);
  linhas.push(linhaDado('entrega', curto, [seg(barra(pct ?? 0, clamp(w - 19, 5, 21), '▰', '▱'), 'success'), seg(` ${fmtPct(pct)}`)]));

  // Previsão
  const p = previsao(e);
  let prev            ;
  if (p.tipo === 'eta') {
    const mm = `±${p.maisMenosMin} min`;
    const n = inteiro(p.n);
    const detalhe = n === null ? `(${mm})` : `(${mm}, ${plural(n, 'medição', 'medições')})`;
    prev = [seg(p.outroDia ? limpar(p.hora) : `hoje ${limpar(p.hora)}`), seg(` ${detalhe}`, 'inactive')];
  } else if (p.tipo === 'parado') prev = [seg('loop parado', 'warning')];
  else if (p.tipo === 'pausado') prev = [seg('loop pausado', 'warning')];
  else if (p.tipo === 'todas') prev = [seg('todas integradas', 'success')];
  else prev = [seg('sem dados', 'inactive')];
  linhas.push(linhaDado('previsao', curto, prev));

  // Tasks: em curso = estado fora de {integrada, pendente} (inclui `no_teto`); na fila = pendente.
  const feitas = inteiro(e.plano?.feitas);
  const emCurso = tasks.filter((t) => t.estado !== 'integrada' && t.estado !== 'pendente').length;
  const fila = tasks.filter((t) => t.estado === 'pendente').length;
  linhas.push(linhaDado('tasks', curto, [seg(`${feitas === null ? MDASH : feitas} ${feitas === 1 ? 'integrada' : 'integradas'} · ${emCurso} em curso · ${fila} na fila`)]));

  // Qualidade: contagem de mutações mortas, nunca %.
  const rodada = naoNeg(e.qualidade?.rodadaMedia);
  const mortas = inteiro(e.qualidade?.mortas);
  const partesQ           = [];
  if (rodada !== null) partesQ.push(`${rodada.toFixed(1)} rodada/review`);
  if (mortas !== null) partesQ.push(plural(mortas, 'mutação morta', 'mutações mortas'));
  linhas.push(linhaDado('qualidade', curto, [seg(partesQ.length === 0 ? 'sem dados' : partesQ.join(' · '), partesQ.length === 0 ? 'inactive' : undefined)]));

  // CI
  const ci = e.rodape?.ci;
  const exec = inteiro(ci?.execucoesHoje);
  const execTxt = `${exec === null ? MDASH : exec} ${exec === 1 ? 'execução' : 'execuções'} hoje`;
  if (ci?.verde === true) linhas.push(linhaDado('ci', curto, [seg('verde', 'success'), seg(` · ${execTxt}`)]));
  else if (ci?.verde === false) linhas.push(linhaDado('ci', curto, [seg('vermelho', 'warning'), seg(` · ${execTxt}`)]));
  else linhas.push(linhaDado('ci', curto, [seg('sem dados', 'inactive')]));

  // Produção
  const leit = inteiro(e.rodape?.prod?.leituras);
  const alt = inteiro(e.rodape?.prod?.alteracoes);
  const politica = texto(e.rodape?.politica);
  const partesP = [
    leit === null ? `${MDASH} leituras` : plural(leit, 'leitura', 'leituras'),
    alt === null ? `${MDASH} alterações` : plural(alt, 'alteração', 'alterações'),
    ...(politica === '' ? [] : [politica]),
  ];
  linhas.push(linhaDado('producao', curto, [seg(partesP.join(' · '))])); marca('prod');

  // Contexto do líder
  const ctx = naoNeg(e.equipe?.lider?.ctx);
  linhas.push(linhaDado('contexto', curto, ctx === null ? [seg(MDASH)] : [seg(barra(ctx, clamp(w - 19, 5, 29), '█', '░'), 'success'), seg(` ${fmtPct(ctx)}`)])); marca('ctx');

  // Limites (cada um omitido se ausente; os dois ausentes ⇒ a linha some)
  const h5 = naoNeg(e.equipe?.lider?.h5);
  const d7 = naoNeg(e.equipe?.lider?.d7);
  const lim = [...(h5 === null ? [] : [`5h ${fmtPct(h5)}`]), ...(d7 === null ? [] : [`7d ${fmtPct(d7)}`])];
  if (lim.length > 0) { linhas.push(linhaDado('limites', curto, [seg(lim.join(' · '))])); marca('lim'); }

  // Agentes em voo, por papel (sem nome de ninguém)
  linhas.push(separador(w)); marca('sep');
  const vivos = inteiro(e.equipe?.vivos);
  linhas.push(alinhar([seg('Agentes em voo')], [seg(vivos === null ? MDASH : `${vivos} ${vivos === 1 ? 'vivo' : 'vivos'}`, 'inactive')], w));
  const bloco = blocoAgentes(e, tasks, w);
  bloco.linhas.forEach((l, i) => { linhas.push(l); if (i < bloco.vivos) marca('vivo'); });

  const marcadas = linhas.map((l, i)               => ({ l: cortarLinha(l, w), tag: marcas.get(i) ?? '' }));
  return cortarPorAltura(marcadas, o.altura, ['sep', 'lim', 'ctx', 'prod']);
}

                                                                                        

const GENERICO = { implementador: 'implementador', correcao: 'implementador', revisor: 'revisor' }         ;

/** `vivos` = quantas das primeiras `linhas` são agentes vivos (os itens vêm antes de revisor aguardando e Sombra). */
function blocoAgentes(e              , tasks                                , w        )                                     {
  const longa = w >= FAIXA_AGENTE_LONGA;
  const agentes                 = Array.isArray(e.equipe?.agentes) ? e.equipe.agentes : [];
  const contagem                         = {};
  const itens             = [];

  for (const a of agentes) {
    if (a.vivo !== true) continue; // `◌ sem agente` não é agente em voo (a contagem "em curso" já o cobre)
    const gen = a.papel !== null && Object.hasOwn(GENERICO, a.papel) ? GENERICO[a.papel] : 'agente';
    contagem[gen] = (contagem[gen] ?? 0) + 1;
    const nome = `${gen} ${contagem[gen]}`;
    const idTask = texto(a.task);
    const t = tasks.find((x) => x.id === a.task);
    const sufixo = a.papel === 'correcao' ? ' (corrigindo)' : '';
    const pctTxt = naoNeg(a.ctxPct) === null ? '' : fmtPct(a.ctxPct);
    const tokTxt = naoNeg(a.ctxTok) === null ? '' : fmtTok(a.ctxTok);
    const tempo = fmtTempo(a.desdeS);
    let ctxTxt        ;
    if (longa) {
      ctxTxt = [pctTxt, tokTxt].filter((s) => s !== '').join(' ');
      if (ctxTxt === '') ctxTxt = `ctx ${MDASH}`;
      if (tempo !== '') ctxTxt += ` · ${tempo}`;
    } else {
      ctxTxt = pctTxt !== '' ? pctTxt : tokTxt !== '' ? tokTxt : `ctx ${MDASH}`;
    }
    const resto        = [seg(idTask === '' ? 'sem task' : idTask)];
    itens.push({
      glifo: '●', cor: corEstadoTask(a.estadoTask), nome,
      resto: longa ? [...resto, seg(texto(t?.titulo), undefined), seg(sufixo)] : resto,
      dir: [seg(ctxTxt, undefined)],
    });
  }

  const aguardando = (Array.isArray(e.equipe?.revisoresAguardando) ? e.equipe.revisoresAguardando : []).map((r) => texto(r.task));
  const sombra = e.equipe?.sombra;
  const largNome = Math.max('revisor'.length, 'Sombra'.length, ...itens.map((i) => colunas(i.nome)));
  const out          = [];

  for (const it of itens) {
    const pad = longa ? largNome : colunas(it.nome);
    const cabeca        = [seg(it.glifo, it.cor), seg(` ${it.nome}${' '.repeat(pad - colunas(it.nome))}  `)];
    if (!longa) {
      out.push([...cabeca, ...it.resto, seg(`  ${it.dir[0].texto}`)]);
      continue;
    }
    const [id, titulo, sufixo] = it.resto;
    const fixo = larguraDe(cabeca) + colunas(id.texto) + colunas(sufixo.texto);
    const folga = w - larguraDe(it.dir) - 1 - fixo - 1; // 1 espaço antes do dir, 1 antes do título
    const t = titulo.texto !== '' && folga >= 2 ? [seg(` ${cortar(titulo.texto, folga)}`)] : [];
    const esq        = [...cabeca, id, ...t, ...(sufixo.texto === '' ? [] : [sufixo])];
    out.push(alinhar(esq, [seg(it.dir[0].texto, 'inactive')], w));
  }

  for (const t of aguardando) {
    out.push([seg('◐', 'warning'), seg(` ${'revisor'.padEnd(longa ? largNome : 7)}  aguarda ${t}`)]);
  }

  const dec = inteiro(sombra?.decisoes);
  const ult = sombra?.ultima ?? null;
  const decTxt = dec === null ? `${MDASH} decisões` : plural(dec, 'decisão', 'decisões');
  let corpo        ;
  if (!longa) corpo = dec === null ? `${MDASH} dec` : `${dec} dec`;
  else {
    const seq = ult === null ? null : inteiro(ult.seq);
    const resposta = ult === null ? '' : texto(ult.resposta);
    corpo = ult === null ? decTxt : `${decTxt} · ${seq === null ? '#—' : `#${seq}`}${resposta === '' ? '' : ` ${resposta}`}`;
  }
  out.push([seg('○', 'inactive'), seg(' '), seg('Sombra', 'planMode'), seg(`${' '.repeat(longa ? largNome - 'Sombra'.length : 0)}  ${corpo}`)]);
  return { linhas: out, vivos: itens.length };
}

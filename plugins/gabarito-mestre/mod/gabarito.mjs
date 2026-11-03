/**
 * Mod do gabarito-mestre (E2 Task 9, REQ-POU-1, REQ-POU-2, REQ-OBS-1): pouso automático, trava de despacho acima de X,
 * `/gabarito pausar|retomar` e medição de tokens por subagent. Adaptador fino: a decisão está em `gates/dist/pouso.js`.
 *
 * Estados do pouso, em `$.store['pouso:<pasta da entrega>']` (`$.state` zera no /clear, o store não: M2):
 *   ocioso (sem chave) -> pousando (gravado ANTES do /clear) -> retomando -> ocioso.
 * Falha em qualquer passo: `loop.parar {sem_pouso}` + aviso visível + ocioso, e nunca um segundo /clear.
 * Sem mod, loop e kill switch seguem (D1): nada aqui é pré-requisito dos hooks clássicos.
 */
import {
  codigoPonte, dadosMedicao, decidirPouso, ehRevisor, fronteira, lerX, textoRetomada, vivosDe,
} from '../gates/dist/pouso.js';

const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const USO = 'Uso: /gabarito pausar | /gabarito retomar';

// Variáveis do módulo recomeçam num reload; o que precisa sobreviver está no store.
let interativo = true;
let ctx = null; // { cwd, raiz, dir }, só depois de a ponte responder
let ocupado = false; // um turn.complete decide por vez; fica preso até o pouso terminar
let desistiu = false; // um pouso falhou: só tenta de novo depois que o percent cair abaixo de X
let semPousoRegistrado = false;
let xAvisado = null;

const chaveDe = (dir) => `pouso:${dir}`;

async function avisar($, texto) {
  try { await $.ui.toast(texto, { timeoutMs: 20000 }); } catch { /* sem tela */ }
  try { $.ui.log(texto, { to: 'transcript' }); } catch { /* sem transcript */ }
}

/** Uma chamada à ponte (node). Qualquer falha vira `{ ok: false }`. */
async function ponte($, pedido) {
  try {
    const url = ('file://' + encodeURI(`${$.plugin.root}/gates/dist/diario.js`)).replace(/#/g, '%23').replace(/\?/g, '%3F');
    const r = await $.process.run(['node', '--input-type=module', '-e', codigoPonte(url)], {
      cwd: pedido.cwd, stdin: JSON.stringify(pedido), timeoutMs: 5000,
    });
    if (r.exitCode !== 0) return { ok: false };
    const o = JSON.parse(r.stdout);
    return o !== null && typeof o === 'object' ? o : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Raiz do checkout e pasta da entrega (a ponte resolve, como `uso-subagent.mjs`). Falha não é guardada. */
async function contexto($) {
  if (ctx !== null) return ctx;
  try {
    const cwd = await $.session.root();
    const r = await ponte($, { op: 'dir', cwd });
    if (r.ok === true && typeof r.dir === 'string' && typeof r.raiz === 'string') ctx = { cwd, raiz: r.raiz, dir: r.dir };
  } catch { /* sem sessão */ }
  return ctx;
}

/** Loop ativo = a pasta da entrega tem plano.json. Sem ele o mod não muda nada. */
async function loopAtivo($) {
  const c = await contexto($);
  if (c === null) return null;
  try {
    return (await $.fs.exists(`${c.dir}/plano.json`)) === true ? c : null;
  } catch {
    return null;
  }
}

async function gravar($, c, ev, extra = {}) {
  try {
    const sessao = await $.session.id();
    const r = await ponte($, { op: 'append', dir: c.dir, cwd: c.cwd, sessao, ev, ...extra });
    return r.ok === true;
  } catch {
    return false;
  }
}

async function xAtual($) {
  let bruto;
  try { bruto = await $.env.get('GABARITO_POUSO_X'); } catch { bruto = undefined; }
  const { x, aviso } = lerX(bruto);
  if (aviso !== null && xAvisado !== bruto) {
    xAvisado = bruto;
    await avisar($, aviso);
  }
  return x;
}

async function percentAtual($) {
  try {
    const p = (await $.session.usage()).context?.percent;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

async function falharPouso($, c, causa) {
  desistiu = true;
  try { await $.store.delete(chaveDe(c.dir)); } catch { /* o aviso abaixo diz o resto */ }
  await gravar($, c, { agente: 'orquestrador', tipo: 'loop.parar', dados: { motivo: 'sem_pouso', causa } });
  await avisar($, `gabarito: pouso automático falhou (${causa}) — loop parado, motivo sem_pouso. Nenhum segundo /clear será tentado.`);
}

/** Passos do pouso depois do `clock.after(0)`: evento, instantâneo, /clear, retomada. */
async function executarPouso($, c, percent, x) {
  const chave = chaveDe(c.dir);
  try {
    if (!(await gravar($, c, { agente: 'orquestrador', tipo: 'sessao.pouso', dados: { percent, x } }))) return await falharPouso($, c, 'diario');
    const inst = await ponte($, { op: 'instantaneo', dir: c.dir, cwd: c.cwd });
    const texto = inst.ok === true ? textoRetomada(inst.texto) : null;
    if (texto === null) return await falharPouso($, c, 'instantaneo');
    try {
      await $.command.run({ command: 'clear' }); // fora de sessão (`-p`) lança (S7 P1); lançar é a única forma de falha
    } catch {
      return await falharPouso($, c, 'clear');
    }
    try { await $.store.set(chave, { estado: 'retomando', desde: await $.clock.now() }); } catch { /* o /clear já aconteceu: segue */ }
    let enviado = false;
    try {
      const r = await $.prompt.submit({ text: texto });
      enviado = r !== null && typeof r === 'object' && r.drop === undefined;
    } catch { /* cai abaixo */ }
    if (!enviado) return await falharPouso($, c, 'submit');
    await gravar($, c, { agente: 'orquestrador', tipo: 'sessao.retomada', dados: { chars: texto.length } });
    try { await $.store.delete(chave); } catch { /* sessão seguinte reinicia o estado */ }
  } finally {
    ocupado = false;
  }
}

async function iniciarPouso($, c, percent, x) {
  const chave = chaveDe(c.dir);
  try {
    await $.store.set(chave, { estado: 'pousando', desde: await $.clock.now() });
    const lido = await $.store.get(chave);
    if (lido === null || typeof lido !== 'object' || lido.estado !== 'pousando') throw new Error('store não gravou');
  } catch {
    await falharPouso($, c, 'store');
    return false;
  }
  // `ocupado` segue preso até `executarPouso` terminar.
  try {
    $.clock.after(0, () => { executarPouso($, c, percent, x).catch(() => { ocupado = false; }); });
  } catch {
    await falharPouso($, c, 'clock');
    return false;
  }
  return true;
}

/** `true` quando um pouso foi agendado (o `ocupado` fica preso até ele terminar). */
async function aoCompletarTurno($) {
  const c = await loopAtivo($);
  if (c === null) return false;
  const x = await xAtual($);
  const percent = await percentAtual($);
  if (percent !== null && percent < x) desistiu = false;
  let jaPousando = desistiu;
  try {
    const v = await $.store.get(chaveDe(c.dir));
    if (v !== undefined) jaPousando = true;
  } catch {
    jaPousando = true;
  }
  if (decidirPouso({ percent, x, vivos: 0, fronteira: true, jaPousando, orquestrador: true }) === 'nada') return false;
  if (!interativo) {
    // F1: `-p` não tem sessão onde rodar /clear nem `$.agent.list`; sem_pouso uma vez, nunca pousa.
    if (!semPousoRegistrado) {
      semPousoRegistrado = true;
      await falharPouso($, c, 'nao_interativo');
    }
    return false;
  }
  let lista = null;
  try { lista = await $.agent.list(); } catch { lista = null; }
  const vivos = vivosDe(lista);
  let front = false;
  if (vivos === 0) {
    const l = await ponte($, { op: 'ler', dir: c.dir, cwd: c.cwd });
    front = l.ok === true && fronteira(l.eventos);
  }
  const d = decidirPouso({ percent, x, vivos, fronteira: front, jaPousando, orquestrador: true });
  if (d !== 'pousar') return false;
  return await iniciarPouso($, c, percent, x);
}

async function medir($, e) {
  if (typeof e.agentId !== 'string' || !ID_RE.test(e.agentId)) return;
  const dados = dadosMedicao(e.usage);
  if (dados === null) return;
  const c = await loopAtivo($);
  if (c === null) return;
  await gravar($, c, { agente: `subagent:${e.agentId}`, tipo: 'custo.medicao', dados }, { unicoPorAgente: true });
}

async function pausar($) {
  const repo = await $.session.repo();
  const raiz = repo?.root ?? (await $.session.root());
  return `${raiz}/.harness/PAUSAR`;
}

async function comandoPausa($, acao) {
  const c = await contexto($);
  const registrar = async (estado) => (c !== null && (await gravar($, c, { agente: 'orquestrador', tipo: 'loop.pausa', dados: { estado } })));
  let arquivo;
  try { arquivo = await pausar($); } catch { return { text: 'Falhou: não achei a raiz do repositório. Nada foi alterado.' }; }
  if (acao === 'pausar') {
    try {
      await $.fs.write(arquivo, `pausado em ${new Date(await $.clock.now()).toISOString()}\n`);
      if ((await $.fs.exists(arquivo)) !== true) throw new Error('não apareceu');
    } catch {
      return { text: `Falhou: não consegui gravar ${arquivo}. O loop NÃO está pausado.` };
    }
    const gravou = await registrar('pausado');
    return { text: `Pausado: ${arquivo} gravado; nenhum despacho novo. /gabarito retomar continua.${gravou ? '' : ' O diário não gravou loop.pausa.'}` };
  }
  try {
    if ((await $.fs.exists(arquivo)) !== true) return { text: 'Não estava pausado: .harness/PAUSAR não existe. Nada foi alterado.' };
    const r = await $.process.run(['node', '-e', 'require("node:fs").unlinkSync(process.argv[1])', arquivo]);
    if (r.exitCode !== 0 || (await $.fs.exists(arquivo)) === true) throw new Error('continua');
  } catch {
    return { text: `Falhou: não consegui remover ${arquivo}. O loop continua pausado.` };
  }
  const gravou = await registrar('retomado');
  return { text: `Retomado: ${arquivo} removido.${gravou ? '' : ' O diário não gravou loop.pausa.'}` };
}

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    interativo = e.isInteractive === true;
    try {
      await $.command.register({
        name: 'gabarito', description: 'Pausa ou retoma o loop do plano', argumentHint: 'pausar|retomar', immediate: true,
      });
    } catch { /* sem comando: o caminho sem mod (/<plugin>:gabarito) segue valendo */ }
    try {
      const c = await contexto($);
      if (c !== null) {
        const v = await $.store.get(chaveDe(c.dir));
        if (v !== undefined) {
          await $.store.delete(chaveDe(c.dir));
          const estado = typeof v?.estado === 'string' ? v.estado : 'desconhecido';
          await avisar($, `gabarito: a sessão anterior parou no meio do pouso (${estado}). Estado voltou a ocioso; nenhum /clear será repetido. Retome pelo diário.`);
        }
      }
    } catch { /* sem store: o pouso também não acontece */ }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    try {
      if (e.agentId !== undefined) await medir($, e);
      else if (!ocupado) {
        ocupado = true;
        let agendado = false;
        try {
          agendado = await aoCompletarTurno($);
        } finally {
          if (!agendado) ocupado = false;
        }
      }
    } catch { /* falha do mod não derruba o turno */ }
    return r;
  });

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    try {
      if (!ehRevisor(e.subagent_type) && (await loopAtivo($)) !== null) {
        const x = await xAtual($);
        const percent = await percentAtual($);
        if (percent !== null && percent >= x) {
          return { deny: `pouso: contexto em ${percent}% (X=${x}%). Sem despacho novo até pousar; só o revisor passa.` };
        }
      }
    } catch { /* o mod não prende a sessão */ }
    return next(e);
  });

  on('command.run', { command: 'gabarito' }, async ($, e) => {
    const acao = typeof e.args === 'string' ? e.args.trim() : '';
    if (acao !== 'pausar' && acao !== 'retomar') return { text: USO };
    try {
      return await comandoPausa($, acao);
    } catch {
      return { text: 'Falhou: erro inesperado. O estado de pausa não foi confirmado.' };
    }
  });
};

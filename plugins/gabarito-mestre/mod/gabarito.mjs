/**
 * Mod do gabarito-mestre (E2 Task 9, REQ-POU-1, REQ-POU-2, REQ-OBS-1): pouso automático, trava de despacho acima de X,
 * `/gabarito pausar|retomar` e medição de tokens por subagent. Adaptador fino: a decisão está em `gates/dist/pouso.js`.
 *
 * Decisão: tabela de 7 estados em `decidirEstado` (gates/src/pouso.ts); aqui só se lê o mundo e se executa a linha.
 * Passos do pouso, em `$.store['pouso:<pasta da entrega>']` (`$.state` zera no /clear, o store não: M2):
 *   ocioso (sem chave) -> pousando (gravado ANTES do /clear) -> retomando -> ocioso.
 * Um pouso consome a fronteira: o próximo exige `review.veredito` novo. Diário lido sem tolerância (`lerEstrito`).
 * Falha em qualquer passo: `loop.parar {sem_pouso}` + aviso visível + ocioso, e nunca um segundo /clear.
 * Entrega, trava e medição são resolvidas a cada disparo: nada de pasta guardada entre turnos.
 * Sem mod, loop e kill switch seguem (D1): nada aqui é pré-requisito dos hooks clássicos.
 */
import {
  analisarFronteira, codigoPonte, dadosMedicao, decidirEstado, ehRevisor, lerX, marcaDeProgresso, textoRetomada, vivosDe,
} from '../gates/dist/pouso.js';

const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const USO = 'Uso: /gabarito pausar | /gabarito retomar';

// Variáveis do módulo recomeçam num reload; o que precisa sobreviver está no store.
let interativo = true;
let ocupado = false; // um turn.complete decide por vez; fica preso até o pouso terminar
let desistiu = false; // um pouso falhou: só tenta de novo depois que o percent cair abaixo de X
let xAvisado = null;
let diarioAvisado = null; // motivo do último aviso de diário ilegível (não repete a cada turno)
let encalhe = null; // { dir, marca, n }: turnos seguidos sem evento novo no estado ENCALHADO
const TURNOS_ENCALHADO = 3; // alinhado a REQ-LOOP-5

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

/** Raiz do checkout e pasta da entrega, resolvidas a CADA disparo (a ponte lê a branch, como `uso-subagent.mjs`). Sem entrega ⇒ `null`. */
async function contexto($) {
  try {
    const cwd = await $.session.root();
    const r = await ponte($, { op: 'dir', cwd });
    if (r.ok === true && typeof r.dir === 'string' && typeof r.raiz === 'string') return { cwd, raiz: r.raiz, dir: r.dir };
  } catch { /* sem sessão */ }
  return null;
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

async function avisarDiario($, motivo) {
  if (diarioAvisado === motivo) return;
  diarioAvisado = motivo;
  await avisar($, `gabarito: diário não pôde ser lido com segurança (${motivo}). Sem fronteira: nenhum pouso até o diário voltar a ser íntegro.`);
}

/** Diário lido sem tolerância. Qualquer dúvida ⇒ sem fronteira, com aviso (nunca pouso). `marca` = -1 quando ilegível. */
async function lerFronteira($, c) {
  const l = await ponte($, { op: 'ler', dir: c.dir, cwd: c.cwd });
  if (l.ok !== true || !Array.isArray(l.eventos)) {
    await avisarDiario($, typeof l.erro === 'string' ? l.erro : 'leitura falhou');
    return { nova: false, consumida: false, marca: -1 };
  }
  const a = analisarFronteira(l.eventos);
  if (a.motivo !== null) {
    await avisarDiario($, a.motivo);
    return { nova: false, consumida: false, marca: marcaDeProgresso(l.eventos) };
  }
  diarioAvisado = null;
  return { nova: a.nova, consumida: a.consumida, marca: marcaDeProgresso(l.eventos) };
}

/** Sinais da tabela, lidos agora. Dado que falha não vira "tudo certo": store ilegível conta como pousando, lista de agentes ilegível como vivo. */
async function lerSinais($, c) {
  const x = await xAtual($);
  const percent = await percentAtual($);
  if (percent !== null && percent < x) desistiu = false;
  let pousando = false;
  try { pousando = (await $.store.get(chaveDe(c.dir))) !== undefined; } catch { pousando = true; }
  let vivos = 0;
  let f = { nova: false, consumida: false, marca: -1 };
  if (percent !== null && percent >= x) {
    let lista = null;
    try { lista = await $.agent.list(); } catch { lista = null; }
    vivos = vivosDe(lista);
    f = await lerFronteira($, c);
  }
  const entrada = {
    orquestrador: true, percent, x, pousando, desistiu, interativo, consumida: f.consumida, vivos, novaFronteira: f.nova,
  };
  return { entrada, marca: f.marca };
}

/** `true` quando um pouso foi agendado (o `ocupado` fica preso até ele terminar). */
async function aoCompletarTurno($) {
  const c = await loopAtivo($);
  if (c === null) { encalhe = null; return false; }
  const { entrada, marca } = await lerSinais($, c);
  const linha = decidirEstado(entrada);
  if (linha.estado !== 'ENCALHADO') encalhe = null;
  if (linha.acao === 'parar_nao_interativo') {
    // F1: `-p` não tem sessão onde rodar /clear nem `$.agent.list`; sem_pouso, nunca pousa.
    await falharPouso($, c, 'nao_interativo');
  } else if (linha.acao === 'encalhe') {
    // E3: sem vivos, sem fronteira nova e nada a fazer: depois de N turnos sem evento novo, para com aviso (nunca silêncio).
    encalhe = encalhe !== null && encalhe.dir === c.dir && encalhe.marca === marca ? { ...encalhe, n: encalhe.n + 1 } : { dir: c.dir, marca, n: 1 };
    if (encalhe.n >= TURNOS_ENCALHADO) {
      encalhe = null;
      await falharPouso($, c, 'sem_fronteira');
    }
  } else if (linha.acao === 'pousar') {
    return await iniciarPouso($, c, entrada.percent, entrada.x);
  }
  return false;
}

async function medir($, e) {
  if (typeof e.agentId !== 'string' || !ID_RE.test(e.agentId)) return;
  const dados = dadosMedicao(e.usage);
  if (dados === null) return;
  const c = await loopAtivo($);
  if (c === null) return;
  await gravar($, c, { agente: `subagent:${e.agentId}`, tipo: 'custo.medicao', dados }, { unicoPorAgente: true });
}

/** REQ-OBS-1: com mod o orquestrador é medido, um `custo.medicao` por turno (o `usage()` zera no /clear; o total vive no diário). */
async function medirOrquestrador($, e) {
  const dados = dadosMedicao(e.usage);
  if (dados === null) return;
  const c = await loopAtivo($);
  if (c === null) return;
  await gravar($, c, { agente: 'orquestrador', tipo: 'custo.medicao', dados });
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
      else {
        // um turn.complete decide por vez (`ocupado`); a medição não espera nem depende disso
        const dono = !ocupado;
        if (dono) ocupado = true;
        let agendado = false;
        try {
          await medirOrquestrador($, e);
          // lista permitida: só o fim normal decide. Esc do dono, erro de API, recusa ou reason desconhecido nunca pousam (E4).
          if (dono && e.reason === 'answer' && e.isAborted === false) agendado = await aoCompletarTurno($);
        } finally {
          if (dono && !agendado) ocupado = false;
        }
      }
    } catch { /* falha do mod não derruba o turno */ }
    return r;
  });

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    try {
      const c = ehRevisor(e.subagent_type) ? null : await loopAtivo($);
      if (c !== null) {
        const { entrada } = await lerSinais($, c);
        const linha = decidirEstado(entrada);
        if (linha.despacho === 'negar') {
          return { deny: `pouso: contexto em ${entrada.percent}% (X=${entrada.x}%), estado ${linha.estado}. Sem despacho novo até pousar; só o revisor passa.` };
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

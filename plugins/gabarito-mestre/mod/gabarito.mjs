/**
 * Mod do gabarito-mestre (E2 Task 9, REQ-POU-1, REQ-POU-2, REQ-OBS-1): pouso automático, trava de despacho acima de X,
 * `/gabarito pausar|retomar` e medição de tokens por subagent. Adaptador fino: a decisão está em `gates/dist/pouso.js`.
 *
 * Decisão (E8): uma só, no núcleo. O mod lê o mundo (percent, vivos, pausa, diário, plano, config), chama `proximaAcao` com
 * sinais reais e executa a resposta; só as pré-condições (`portaDoPouso`: A a E da Sombra T9b) são dele.
 * `Agent` nega para quem não é revisor ⇔ a cláusula (5) de `proximaAcao` dispararia (`negaDespacho`).
 * Passos do pouso, em `$.store['pouso:<pasta da entrega>']` (`$.state` zera no /clear, o store não: M2):
 *   ocioso (sem chave) -> pousando (gravado ANTES do /clear) -> retomando -> ocioso.
 * Um pouso consome a fronteira (`sessao.pouso` depois do último `review.veredito`): o mod passa `percent: null` ao núcleo e a (5)
 * não dispara. Diário lido sem tolerância (`lerEstrito`); dado ausente, corrompido ou API lançando nunca vira pouso.
 * Falha em qualquer passo: `loop.parar {sem_pouso}` + aviso visível + ocioso, e nunca um segundo /clear.
 * Entrega, trava e medição são resolvidas a cada disparo: nada de pasta guardada entre turnos.
 * Sem mod, loop e kill switch seguem (D1): nada aqui é pré-requisito dos hooks clássicos.
 */
import { proximaAcao } from '../gates/dist/loop.js';
import { pendenciasAprendizado } from '../gates/dist/pendencias.js';
import * as nucleo from '../gates/dist/loop.js'; // `nucleo.TIPOS_DE_PROGRESSO`: fonte única da lista (lida só em marcarPousoPendente)
import {
  analisarFronteira, codigoPonte, dadosMedicao, ehMensagemDoDono, ehRevisor, jaParou, lerX, marcaDeProgresso, negaDespacho, portaDoPouso, PROMPT_RECUPERACAO, PROMPT_RETOMADA,
  tasksDoNegado, tasksEmVoo, textoPendencia, textoPendenciaNaoVerificada, textoRetomada, tokensDe, vivosDe,
} from '../gates/dist/pouso.js';
import { comandoPainel, iniciarPainel, registrarPainel, turnoDoPainel, USO_GABARITO } from './painel.mjs'; // E4 T10: Pane, faixa, atualização e aviso do PAROU (nada do pouso depende dele)

const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Variáveis do módulo recomeçam num reload; o que precisa sobreviver está no store.
let interativo = true;
let ocupado = false; // um turn.complete decide por vez; fica preso até o pouso terminar
let desistiu = false; // um pouso falhou: só tenta de novo depois que o percent cair abaixo de X
let xAvisado = null;
let diarioAvisado = null; // motivo do último aviso de diário ilegível (não repete a cada turno)
let negados = 0; // Agent de despacho negado neste turno: o `iniciar` dele ficou no diário sem agente
let negadoAte = null; // hora (relógio de parede, como o diário) da última negação; null ⇒ sem ordenar por ela
let espera = null; // { dir, marca, n }: turnos seguidos sem evento novo com o núcleo respondendo `nao_conseguiu`
let terminados = 0; // `turn.complete` de subagent: cada um traz um hand-back (`prompt.submit` peer) a caminho
let recebidos = 0; // `prompt.submit` com `origin.kind === 'peer'`; `terminados > recebidos` ⇒ hand-back ainda a caminho
const recuperadas = new Map(); // `${dir}|${task}` → vezes que o mod reabriu a task em voo sem agente
const MAX_RECUPERACOES = 2; // REQ-LOOP-5: até 2 por task; na seguinte `loop.parar {nao_conseguiu}`
const TURNOS_ESPERA = 3; // alinhado a REQ-LOOP-5: o hand-back pode ainda não ter chegado

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

/**
 * Raiz do checkout e pasta da entrega, resolvidas a CADA disparo (a ponte lê a branch, como `uso-subagent.mjs`).
 * `{ c, falha }`: `c` com a entrega; `c: null, falha: null` só quando não há repositório (nada a ler); `falha` com a causa quando não deu para ler.
 */
async function lerContexto($) {
  let cwd;
  try { cwd = await $.session.root(); } catch { return { c: null, falha: 'sessão sem raiz' }; }
  const r = await ponte($, { op: 'dir', cwd });
  if (r.ok === true && typeof r.dir === 'string' && typeof r.raiz === 'string') return { c: { cwd, raiz: r.raiz, dir: r.dir }, falha: null };
  let repo;
  try { repo = await $.session.repo(); } catch { return { c: null, falha: 'ponte do diário falhou' }; }
  return repo === null || repo === undefined ? { c: null, falha: null } : { c: null, falha: typeof r.erro === 'string' ? r.erro : 'ponte do diário falhou' };
}

async function contexto($) {
  return (await lerContexto($)).c;
}

/**
 * Loop ativo = a pasta da entrega tem plano.json. `{ c: null, falha: null }` é "sem loop" de verdade (sem repositório ou sem plano);
 * `falha` é "não consegui ler" (ponte ou `fs.exists` falhando) e NUNCA se confunde com ausência.
 */
async function loopAtivo($) {
  const k = await lerContexto($);
  if (k.c === null) return k;
  try {
    return (await $.fs.exists(`${k.c.dir}/plano.json`)) === true ? { c: k.c, falha: null } : { c: null, falha: null };
  } catch {
    return { c: null, falha: 'não consegui confirmar se há plano.json' };
  }
}

let leituraAvisada = null; // causa do último aviso de "não consegui ler" (não repete a cada turno)
/** Falha de leitura em caminho de pouso, despacho ou medição: avisa uma vez por causa; nunca pousa. */
async function avisarLeitura($, falha) {
  if (falha === undefined) return;
  if (falha === null) { leituraAvisada = null; return; }
  if (leituraAvisada === falha) return;
  leituraAvisada = falha;
  await avisar($, `gabarito: não consegui ler se há loop nesta entrega (${falha}). Nenhum pouso e nenhuma medição até voltar a ler.`);
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
    if (Array.isArray(inst.avisos) && inst.avisos.length > 0) await avisarAprendizados($); // só o bloco de aprendizados some; o pouso segue
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
    if (!enviado) {
      // REQ-POU-3: depois do /clear o contexto já está limpo e a fronteira consumida; o submit falho NÃO é `sem_pouso`. Sem `loop.parar`,
      // `desistiu` intocado e nenhum segundo /clear; o wakeup do /loop ou a próxima mensagem do dono reabre o turno.
      try { await $.store.delete(chave); } catch { /* sessão seguinte reinicia o estado */ }
      await avisar($, 'gabarito: retomada pelo contexto; o wakeup do /loop ou sua próxima mensagem reabre o turno');
      return;
    }
    const gravou = await gravar($, c, { agente: 'orquestrador', tipo: 'sessao.retomada', dados: { via: 'mod', chars: texto.length } });
    try { await $.store.delete(chave); } catch { /* sessão seguinte reinicia o estado */ }
    if (!gravou) await avisar($, 'gabarito: retomada aconteceu mas sessao.retomada não gravou; o próximo cartão pode repetir a linha de pouso.');
  } finally {
    ocupado = false;
  }
}

let aprendizadosAvisado = false;
async function avisarAprendizados($) {
  if (aprendizadosAvisado) return;
  aprendizadosAvisado = true;
  await avisar($, 'gabarito: aprendizados indisponíveis; o instantâneo do pouso segue sem o bloco de aprendizados.');
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
  await avisar($, `gabarito: diário ou plano não puderam ser lidos com segurança (${motivo}). Nenhum pouso até voltarem a ser íntegros.`);
}

async function pausadoAgora($) {
  try { return (await $.fs.exists(await pausar($))) !== false; } catch { return true; } // não saber é pausar: nunca pousa
}

const inteiroPositivo = (n) => Number.isSafeInteger(n) && n >= 1;

/**
 * O que o núcleo pede, lido agora, sem tolerância. Qualquer dúvida (diário, plano, config ou teto ilegíveis) ⇒ `null` com aviso:
 * nunca pouso e nunca "tudo certo". Lista de agentes que falha conta como vivo (`vivosDe`); pausa que não se confirma conta como pausa.
 */
async function lerMundo($, c) {
  const l = await ponte($, { op: 'ler', dir: c.dir, cwd: c.cwd });
  if (l.ok !== true || !Array.isArray(l.eventos)) { await avisarDiario($, typeof l.erro === 'string' ? l.erro : 'leitura falhou'); return null; }
  const a = analisarFronteira(l.eventos);
  if (a.motivo !== null) { await avisarDiario($, a.motivo); return null; }
  const t = tokensDe(l.eventos);
  if (!t.ok) { await avisarDiario($, 'custo.medicao com contagem inválida'); return null; }
  const p = await ponte($, { op: 'plano', dir: c.dir, raiz: c.raiz, cwd: c.cwd });
  const tetoOk = p.tetoTokens === null || inteiroPositivo(p.tetoTokens);
  if (p.ok !== true || p.plano === null || typeof p.plano !== 'object' || !inteiroPositivo(p.slots) || !tetoOk) {
    await avisarDiario($, typeof p.erro === 'string' ? p.erro : 'plano ilegível');
    return null;
  }
  let lista = null;
  try { lista = await $.agent.list(); } catch { lista = null; }
  return {
    eventos: l.eventos, plano: p.plano, slots: p.slots, tetoTokens: p.tetoTokens, tokens: t.tokens,
    vivos: vivosDe(lista), pausado: await pausadoAgora($), consumida: a.consumida, marca: marcaDeProgresso(l.eventos),
  };
}

function descrever(r) {
  if (r.porta.estado !== 'NUCLEO') return `estado ${r.porta.estado}`;
  if (r.mundo === null) return 'diário ou plano ilegíveis';
  if (r.acao === null) return 'núcleo sem resposta';
  const a = r.acao;
  if (a.tipo === 'aprender') return 'aprendizado pendente: feche antes de despachar'; // nunca `aprender` cru (Sombra 2d.4)
  if (a.tipo === 'pousar') return 'pouso pendente';
  if (a.tipo === 'esperar') return `esperar (${a.motivo})`;
  if (a.tipo === 'parar') return `loop parado (${a.motivo})`;
  return a.tipo === 'despachar' ? 'revisão pendente' : a.tipo;
}

/**
 * A decisão de um disparo: pré-condições do mod, depois o núcleo. Fora de `NUCLEO` a ação é `null`.
 * `negar` = `Agent` não revisor negado. Consumida ⇒ `percent: null` ao núcleo (E1); `proximaAcao` lançando ⇒ sem ação e nega.
 */
async function avaliar($, c) {
  const x = await xAtual($);
  const percent = await percentAtual($);
  if (percent !== null && percent < x) desistiu = false;
  let pousando = false;
  try { pousando = (await $.store.get(chaveDe(c.dir))) !== undefined; } catch { pousando = true; }
  const porta = portaDoPouso({ orquestrador: true, percent, x, pousando, desistiu, interativo });
  const r = { porta, percent, x, mundo: null, acao: null, negar: porta.despacho === 'negar' };
  if (porta.estado !== 'NUCLEO') return r;
  r.negar = true;
  r.mundo = await lerMundo($, c);
  if (r.mundo === null) return r;
  const m = r.mundo;
  try {
    r.acao = proximaAcao(m.plano, m.eventos, {
      slots: m.slots, percent: m.consumida ? null : percent, x, pausado: m.pausado, vivos: m.vivos,
      tokens: m.tokens, tetoTokens: m.tetoTokens, podePousar: true,
    });
  } catch {
    await avisarDiario($, 'o núcleo do loop falhou');
    return r;
  }
  if (!(r.acao.tipo === 'parar' && r.acao.motivo === 'diario_invalido')) diarioAvisado = null;
  r.negar = negaDespacho(r.acao, m.consumida);
  return r;
}

/** `parar` do núcleo (teto de rodadas, CI, teto de tokens, `nao_conseguiu`): grava `loop.parar` uma vez, com aviso. Sem pouso. */
async function pararDoNucleo($, c, acao, m) {
  if (acao.motivo === 'diario_invalido') { await avisarDiario($, 'sequência de eventos fora da tabela de transições'); return; }
  if (jaParou(m.eventos)) return;
  if (acao.motivo === 'nao_conseguiu') {
    // task em voo sem agente: o hand-back pode ainda não ter chegado; só para depois de N turnos sem evento novo
    espera = espera !== null && espera.dir === c.dir && espera.marca === m.marca ? { ...espera, n: espera.n + 1 } : { dir: c.dir, marca: m.marca, n: 1 };
    if (espera.n < TURNOS_ESPERA) return;
    espera = null;
  }
  const dados = acao.task === undefined ? { motivo: acao.motivo } : { motivo: acao.motivo, task: acao.task };
  await gravar($, c, { agente: 'orquestrador', tipo: 'loop.parar', dados });
  await avisar($, `gabarito: loop parado (${acao.motivo}${acao.task === undefined ? '' : `, task ${acao.task}`}). Nenhum pouso automático; veja o diário da entrega.`);
}

/** `true` quando um pouso foi agendado (o `ocupado` fica preso até ele terminar). */
async function aoCompletarTurno($) {
  const { c, falha } = await loopAtivo($);
  await avisarLeitura($, falha);
  if (c === null) { espera = null; return false; }
  const r = await avaliar($, c);
  if (r.porta.acao === 'parar_nao_interativo') {
    // F1: `-p` não tem sessão onde rodar /clear nem `$.agent.list`; sem_pouso, nunca pousa.
    espera = null;
    await falharPouso($, c, 'nao_interativo');
    return false;
  }
  const acao = r.acao;
  if (acao === null || acao.tipo !== 'parar' || acao.motivo !== 'nao_conseguiu') espera = null;
  if (acao === null) return false;
  if (acao.tipo === 'pousar') return await iniciarPouso($, c, r.percent, r.x);
  if (acao.tipo === 'parar') await pararDoNucleo($, c, acao, r.mundo);
  return false;
}

/**
 * D1: `Agent` negado não pode deixar `task.iniciada` para trás. No fim normal do turno, ANTES de decidir, com vivos = 0 reabre
 * (origem `retomada`) as `min(negados, em voo)` tasks: a que não é de revisor primeiro, a iniciada por último. Com agente vivo
 * não há como saber qual task é de quem, então a negação FICA (inclusive em Esc, erro e `/clear`; `session.start` não zera).
 * Só zera depois de `tasksDoNegado` dar ok (diário, plano e lista legíveis) com vivos = 0. As iniciadas depois da última
 * negação (`negadoAte`) vão atrás na ordem: são despachos aceitos, não a negada. Reabertura que falha avisa e não insiste. Núcleo intacto.
 */
async function desfazerNegados($) {
  if (negados === 0) return;
  const { c } = await loopAtivo($);
  if (c === null) return;
  const l = await ponte($, { op: 'ler', dir: c.dir, cwd: c.cwd });
  const p = await ponte($, { op: 'plano', dir: c.dir, raiz: c.raiz, cwd: c.cwd });
  if (l.ok !== true || p.ok !== true) return;
  let lista = null;
  try { lista = await $.agent.list(); } catch { return; }
  if (!Array.isArray(lista) || vivosDe(lista) > 0) return;
  const r = tasksDoNegado(p.plano, l.eventos, negados, 0, negadoAte);
  if (!r.ok) return; // plano ou diário ilegível para a regra: a negação FICA
  negados = 0;
  for (const task of r.tasks) {
    if (!(await gravar($, c, { agente: 'orquestrador', tipo: 'task.reaberta', dados: { task, origem: 'retomada' } }))) {
      await avisar($, `gabarito: não consegui gravar task.reaberta da task ${task}; o pouso não acontece. Rode reabrir ${task} pelo loop.mjs.`);
      return;
    }
  }
}

/**
 * REQ-LOOP-5, task em voo sem agente (Q-T13F D1): `iniciar` sem `Agent` (um hand-back entrou entre os dois). No fim normal do turno, com
 * vivos = 0, sem hand-back a caminho, sem pausa e sem `parar`, reabre as tasks em voo (origem `retomada`) e abre um turno, sem pousar nele.
 * Antes de reabrir, pergunta ao núcleo (Q-T13G): `parar` com motivo diferente de `nao_conseguiu` é gravado e não reabre nem abre turno.
 * Até 2 vezes por task em cada ciclo (`liberar` recomeça a conta); na seguinte grava `loop.parar {nao_conseguiu}` e avisa. Qualquer leitura ruim, ou `task.reaberta` que não grava:
 * não reabre e devolve `false` (o núcleo decide, como antes). `true` = o mod agiu e o turno não decide mais nada.
 */
async function recuperarOrfas($) {
  const { c } = await loopAtivo($);
  if (c === null || terminados > recebidos) return false;
  const m = await lerMundo($, c); // diário, plano, config, teto, vivos e pausa; qualquer dúvida ⇒ `null`
  if (m === null || m.pausado || m.vivos > 0 || jaParou(m.eventos)) return false;
  const voo = tasksEmVoo(m.plano, m.eventos);
  if (!voo.ok || voo.tasks.length === 0) return false;
  // Q-T13G: o núcleo manda. `percent: null` (sem o (5b), que trocaria o motivo por `nao_conseguiu`), vivos 0, tokens e teto reais.
  // `parar` com motivo diferente de `nao_conseguiu` ⇒ grava esse `parar` e não reabre nem abre turno. Núcleo que lança ⇒ não reabre.
  let acao = null;
  try {
    acao = proximaAcao(m.plano, m.eventos, {
      slots: m.slots, percent: null, x: await xAtual($), pausado: false, vivos: 0, tokens: m.tokens, tetoTokens: m.tetoTokens, podePousar: true,
    });
  } catch {
    await avisarDiario($, 'o núcleo do loop falhou');
    return false;
  }
  if (acao.tipo === 'parar' && acao.motivo !== 'nao_conseguiu') {
    espera = null;
    await pararDoNucleo($, c, acao, m);
    return true;
  }
  // a conta é por ciclo: cada `task.reaberta {dono}` (liberar) da task recomeça a contagem
  const donos = (t) => m.eventos.filter((e) => e?.tipo === 'task.reaberta' && e.dados?.origem === 'dono' && e.dados?.task === t).length;
  const chave = (t) => `${c.dir}|${t}|${donos(t)}`;
  const esgotada = voo.tasks.find((t) => (recuperadas.get(chave(t)) ?? 0) >= MAX_RECUPERACOES);
  if (esgotada !== undefined) {
    const gravou = await gravar($, c, { agente: 'orquestrador', tipo: 'loop.parar', dados: { motivo: 'nao_conseguiu', task: esgotada } });
    espera = null;
    await avisar($, gravou
      ? `gabarito: loop parado (nao_conseguiu, task ${esgotada}): iniciada ${MAX_RECUPERACOES + 1} vezes sem agente. Nenhum pouso automático; veja o diário da entrega.`
      : `gabarito: a task ${esgotada} ficou ${MAX_RECUPERACOES + 1} vezes em voo sem agente e não consegui gravar loop.parar. O loop não segue sozinho; veja o diário da entrega.`);
    return false;
  }
  for (const task of voo.tasks) {
    if (!(await gravar($, c, { agente: 'orquestrador', tipo: 'task.reaberta', dados: { task, origem: 'retomada' } }))) {
      await avisar($, `gabarito: não consegui gravar task.reaberta da task ${task}; nenhum turno aberto. Rode reabrir ${task} pelo loop.mjs.`);
      return false;
    }
    recuperadas.set(chave(task), (recuperadas.get(chave(task)) ?? 0) + 1);
  }
  espera = null;
  if (!abrirTurno($, PROMPT_RECUPERACAO)) await avisar($, `gabarito: ${voo.tasks.join(', ')} reaberta(s), mas não consegui agendar o turno do loop. Digite uma mensagem para continuar.`);
  return true;
}

/** GM-11 T9: modelo que respondeu o turno (`usage.model`); vazio, `<synthetic>` ou fora do padrão ⇒ `null`. A chave sempre vai. */
const modeloDe = (usage) => (typeof usage?.model === 'string' && usage.model !== '' && !usage.model.startsWith('<') ? usage.model : null);

async function medir($, e) {
  if (typeof e.agentId !== 'string' || !ID_RE.test(e.agentId)) return;
  const base = dadosMedicao(e.usage);
  if (base === null) return;
  const dados = { ...base, modelo: modeloDe(e.usage) };
  const { c, falha } = await loopAtivo($);
  await avisarLeitura($, falha);
  if (c === null) return;
  await gravar($, c, { agente: `subagent:${e.agentId}`, tipo: 'custo.medicao', dados }, { unicoPorAgente: true });
}

/** REQ-OBS-1: com mod o orquestrador é medido, um `custo.medicao` por turno (o `usage()` zera no /clear; o total vive no diário). */
async function medirOrquestrador($, e) {
  const base = dadosMedicao(e.usage);
  if (base === null) return;
  const dados = { ...base, modelo: modeloDe(e.usage) };
  const { c, falha } = await loopAtivo($);
  await avisarLeitura($, falha);
  if (c === null) return;
  await gravar($, c, { agente: 'orquestrador', tipo: 'custo.medicao', dados });
}

/**
 * Pouso pendente (REQ-LOOP-5): o Stop não pode bloquear o turno que vai pousar. Grava `.harness/pouso-pendente.json {entrega, linhas}`,
 * `linhas` = eventos de progresso, a mesma contagem do contador do Stop. Falhar em gravar não muda o deny (o Stop cai na regra normal).
 */
async function marcarPousoPendente($, c, eventos) {
  try {
    // Fonte única com o Stop (gates/src/loop.ts). Lista ausente ou vazia: não grava (contagem falsa liberaria parada indevida); o deny segue.
    const tipos = nucleo.TIPOS_DE_PROGRESSO;
    if (!Array.isArray(tipos) || tipos.length === 0) return;
    const entrega = c.dir.split('/').filter(Boolean).at(-1);
    const linhas = eventos.filter((ev) => tipos.includes(ev?.tipo)).length;
    await $.fs.write(`${c.raiz}/.harness/pouso-pendente.json`, JSON.stringify({ entrega, linhas }) + '\n');
  } catch { /* o deny segue */ }
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
  const { c: loop, falha } = await loopAtivo($); // sem entrega com plano não há loop a recomeçar; não conseguir ler NÃO é isso
  const r = falha !== null
    ? { abrir: false, texto: `Não reabri nada nem abri turno: não consegui ler se há loop (${falha}). O loop não recomeça sozinho.` }
    : loop === null ? { texto: '', abrir: false } : await recomecarLoop($, loop);
  const gravou = await registrar('retomado');
  const aviso = gravou ? '' : ' O diário não gravou loop.pausa.';
  let texto = `Retomado: ${arquivo} removido.${aviso} ${r.texto}`.trim();
  if (r.abrir && !abrirTurno($)) texto += ' Não consegui agendar o turno: o loop não voltou sozinho.';
  return { text: texto };
}

/**
 * Depois de remover PAUSAR (tabela de transições de `/gabarito retomar`, T15): com vivos 0 reabre cada task em voo (origem
 * `retomada`, o que `proxima` não faz sozinho) e abre um turno. Vivos > 0, vivos não medidos, plano ou diário ilegível, ou
 * reabertura que falhou: não reabre mais nada e não abre turno (nunca dois implementadores na mesma worktree); a causa vai no texto.
 */
async function recomecarLoop($, c) {
  let lista = null;
  try { lista = await $.agent.list(); } catch { lista = null; }
  if (!Array.isArray(lista)) return { abrir: false, texto: 'Não reabri nada nem abri turno: agentes vivos não medidos (agent.list falhou). O loop não recomeça sozinho.' };
  const l = await ponte($, { op: 'ler', dir: c.dir, cwd: c.cwd });
  if (l.ok !== true || !Array.isArray(l.eventos)) {
    return { abrir: false, texto: `Não reabri nada nem abri turno: diário ilegível (${typeof l.erro === 'string' ? l.erro : 'leitura falhou'}). O loop não recomeça sozinho.` };
  }
  const p = await ponte($, { op: 'plano', dir: c.dir, raiz: c.raiz, cwd: c.cwd });
  if (p.ok !== true || p.plano === null || typeof p.plano !== 'object') {
    return { abrir: false, texto: `Não reabri nada nem abri turno: plano ilegível (${typeof p.erro === 'string' ? p.erro : 'leitura falhou'}). O loop não recomeça sozinho.` };
  }
  if (vivosDe(lista) > 0) return { abrir: false, texto: 'Agentes vivos terminam o que fazem; a notificação deles retoma o loop. Nada foi reaberto e nenhum turno foi aberto.' };
  const voo = tasksEmVoo(p.plano, l.eventos);
  if (!voo.ok) return { abrir: false, texto: `Não reabri nada nem abri turno: ${voo.motivo}. O loop não recomeça sozinho.` };
  for (const task of voo.tasks) {
    if (!(await gravar($, c, { agente: 'orquestrador', tipo: 'task.reaberta', dados: { task, origem: 'retomada' } }))) {
      return { abrir: false, texto: `Não consegui gravar task.reaberta da task ${task}: parei sem abrir turno. Rode reabrir ${task} pelo loop.mjs.` };
    }
  }
  const n = voo.tasks.length;
  return { abrir: true, texto: n === 0 ? 'Nenhuma task em voo; abrindo o turno do loop.' : `${n} task(s) reaberta(s) (${voo.tasks.join(', ')}); abrindo o turno do loop.` };
}

/** Agenda o `prompt.submit` fora do handler do comando (mesmo padrão do pouso, S7). `false` se não deu para agendar; falha do envio vai à tela. */
function abrirTurno($, texto = PROMPT_RETOMADA) {
  try {
    $.clock.after(0, () => {
      Promise.resolve($.prompt.submit({ text: texto }))
        .then((s) => { if (s === null || typeof s !== 'object' || s.drop !== undefined) throw new Error('recusado'); })
        .catch(() => avisar($, 'gabarito: o turno da retomada não abriu; o loop não voltou sozinho. Digite uma mensagem para continuar.'));
    });
    return true;
  } catch {
    return false;
  }
}

let mensagemAvisada = null; // causa do último aviso de mensagem do dono não registrada (não repete)
async function avisarMensagem($, causa) {
  if (mensagemAvisada === causa) return;
  mensagemAvisada = causa;
  await avisar($, `gabarito: mensagem do dono não registrada (${causa}); o gatilho de aprendizado desta mensagem não abre.`);
}

/** REQ-APR-2: grava `dono.mensagem` (só hash e tamanho; a ponte calcula). Nunca bloqueia nem altera o prompt; falha avisa. */
async function registrarMensagemDoDono($, texto) {
  let causa = null;
  try {
    const { c, falha } = await loopAtivo($);
    await avisarLeitura($, falha);
    if (c === null) return;
    const r = await ponte($, { op: 'mensagem', dir: c.dir, cwd: c.cwd, texto });
    if (r.ok !== true) causa = typeof r.erro === 'string' ? r.erro : 'ponte falhou';
  } catch {
    causa = 'erro inesperado';
  }
  if (causa !== null) await avisarMensagem($, causa);
}

/**
 * Porta `permitir` (inclui `percent` ausente): o núcleo não roda, então a pendência de aprendizado é lida aqui. Texto de negação, ou `null`
 * quando não há pendência. Dúvida (leitura, plano, ordem do diário ou núcleo de pendências) NEGA: com loop ativo o mod não presume que está tudo certo.
 */
async function negaPorPendencia($, c) {
  const l = await ponte($, { op: 'ler', dir: c.dir, cwd: c.cwd });
  if (l.ok !== true || !Array.isArray(l.eventos)) return textoPendenciaNaoVerificada(typeof l.erro === 'string' ? l.erro : 'leitura falhou');
  const p = await ponte($, { op: 'plano', dir: c.dir, raiz: c.raiz, cwd: c.cwd });
  if (p.ok !== true || p.plano === null || typeof p.plano !== 'object') return textoPendenciaNaoVerificada(typeof p.erro === 'string' ? p.erro : 'plano ilegível');
  const voo = tasksEmVoo(p.plano, l.eventos); // diário fora de ordem, fora da tabela ou task fora do plano: `pendenciasAprendizado` devolveria [] e passaria
  if (!voo.ok) return textoPendenciaNaoVerificada(voo.motivo);
  let pendencias;
  try { pendencias = pendenciasAprendizado(p.plano, l.eventos); } catch { return textoPendenciaNaoVerificada('núcleo de pendências falhou'); }
  return pendencias.length > 0 ? textoPendencia(pendencias) : null;
}

export const register = (on) => {
  registrarPainel(on);
  on('session.start', async ($, e, next) => {
    interativo = e.isInteractive === true;
    await iniciarPainel($, e);
    try {
      await $.command.register({
        name: 'gabarito', description: 'Painel, pausa e retomada do loop', argumentHint: 'painel …|pausar|retomar', immediate: true,
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

  // hand-back de subagent (S7): chega como `prompt.submit` de origem `peer`. Só contado, nunca alterado.
  on('prompt.submit', async ($, e, next) => {
    if (e?.origin?.kind === 'peer') recebidos += 1;
    if (ehMensagemDoDono(e)) {
      // a ponte custa 2 `node` (até 5 s cada): o prompt do dono nunca espera por ela
      const texto = e.text;
      try { $.clock.after(0, () => { registrarMensagemDoDono($, texto).catch(() => {}); }); } catch { avisarMensagem($, 'clock').catch(() => {}); }
    }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    await turnoDoPainel($); // agenda e volta: o turno nunca espera a ponte do painel
    const r = await next(e);
    try {
      if (e.agentId !== undefined) { terminados += 1; await medir($, e); }
      else {
        // um turn.complete decide por vez (`ocupado`); a medição não espera nem depende disso
        const dono = !ocupado;
        if (dono) ocupado = true;
        let agendado = false;
        try {
          await medirOrquestrador($, e);
          // lista permitida: só o fim normal decide. Esc do dono, erro de API, recusa ou reason desconhecido nunca pousam (E4).
          if (dono && e.reason === 'answer' && e.isAborted === false) {
            const tinhaNegado = negados > 0; // negação pendente: o núcleo decide (pouso ou nao_conseguiu); recuperar junto reabriria a task aceita
            await desfazerNegados($);
            if (tinhaNegado || !(await recuperarOrfas($))) agendado = await aoCompletarTurno($);
          }
        } finally {
          if (dono && !agendado) ocupado = false;
        }
      }
    } catch { /* falha do mod não derruba o turno */ }
    return r;
  });

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    try {
      const { c, falha } = ehRevisor(e.subagent_type) ? { c: null } : await loopAtivo($);
      await avisarLeitura($, falha);
      if (c !== null) {
        const r = await avaliar($, c);
        const negou = () => {
          negados += 1;
          try { negadoAte = new Date().toISOString(); } catch { negadoAte = null; } // parede: o diário grava `new Date()`, o `$.clock` dos testes não
        };
        if (r.negar) {
          negou();
          if (r.acao?.tipo === 'pousar' && r.mundo !== null) await marcarPousoPendente($, c, r.mundo.eventos);
          if (r.acao?.tipo === 'aprender') return { deny: textoPendencia(r.acao.pendencias) }; // texto único: nunca `aprender` cru nem "encerre o turno"
          return { deny: `pouso: contexto em ${r.percent}% (X=${r.x}%), ${descrever(r)}. Sem despacho novo; só o revisor passa. Não tente de novo: encerre o turno.` };
        }
        if (r.porta.despacho === 'permitir') {
          const motivo = await negaPorPendencia($, c);
          if (motivo !== null) { negou(); return { deny: motivo }; }
        }
      }
    } catch { /* o mod não prende a sessão */ }
    return next(e);
  });

  on('command.run', { command: 'gabarito' }, async ($, e) => {
    const acao = typeof e.args === 'string' ? e.args.trim().replace(/\s+/g, ' ') : '';
    if (acao === 'painel' || acao.startsWith('painel ')) return { text: await comandoPainel($, acao.split(' ').slice(1)) };
    if (acao !== 'pausar' && acao !== 'retomar') return { text: USO_GABARITO };
    try {
      return await comandoPausa($, acao);
    } catch {
      return { text: 'Falhou: erro inesperado. O estado de pausa não foi confirmado.' };
    }
  });
};

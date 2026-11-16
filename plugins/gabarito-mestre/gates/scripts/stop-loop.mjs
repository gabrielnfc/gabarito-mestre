#!/usr/bin/env node
/**
 * Hook `Stop` do loop (E2 Task 8, REQ-LOOP-5): o orquestrador não para em silêncio enquanto há ação.
 *
 * Decisão, na ordem (a primeira que casa):
 *   stdin ausente/inválido ........ systemMessage com a causa
 *   sem card, sem git, sem plano ... silêncio (fora de loop nada muda)
 *   plano ilegível/inválido ........ systemMessage, nunca block
 *   subagent vivo ................. silêncio (shell em background não conta)
 *   .harness/PAUSAR ............... silêncio (na raiz ou no checkout principal)
 *   diário ilegível ............... systemMessage, nunca vira `concluir`
 *   proximaAcao parar diario_invalido ... systemMessage (não consulta pendência: o CLI do aprendizado não fecharia nada)
 *   aprendizado pendente (T7b, REQ-APR-2) ... calculado à parte (`pendenciasAprendizado`, nunca de acao.tipo === 'aprender': ci_vermelho,
 *                                  teto_rodadas e nao_conseguiu vencem o `aprender`): não avisada ⇒ block uma vez por gatilho; já avisada ⇒ systemMessage
 *   loop.parar sem task depois .... silêncio
 *   proximaAcao: esperar ......... silêncio (exceto `emenda`: systemMessage com as propostas abertas, sem block e sem contador); parar: systemMessage; despachar/integrar: block
 *   concluir ...................... silêncio, ou systemMessage listando as liberações do teto (`task.reaberta` origem `dono`, REQ-LOOP-2, e
 *                                   origem `sombra` como "a Sombra liberou a <task>", GM-14 T36 FIEL-15 c)
 * Avisos de GM-15 T18 (REQ-AUT-2 c, REQ-POU-3, REQ-POU-4), todos `systemMessage`, nunca `block`, só depois de o loop estar de pé (plano válido, sem agente vivo, sem pausa, sem entrega publicada):
 *   - `parar` há mais de 30 min (idade = o último evento de progresso ou `loop.parar` do diário): texto com o comando, 1 vez por trava (chave = motivo + início, `.harness/contexto/stop-avisos.<sessao>.json`);
 *   - contexto próprio (mod, fresco) >= X sem `sessao.pouso` DESTA sessão na fronteira atual: "limpar a conversa", dito que quem limpa é o mod;
 *   - sem o sinal do loop (T17, `contexto/loop-dinamico.<sessao>.json` da raiz principal, só o `armado` da PRÓPRIA sessão, escrito há até 2 h): "ligar o loop automático" 1 vez por sessão,
 *     e nunca `/clear` nem "limpar a conversa" enquanto o loop não está armado (aprendizado 185). Só com onboarding: sem ele o mod não grava o sinal.
 * Pouso pendente (T18): `.harness/pouso-pendente.json {entrega, linhas}`, gravado pelo mod ao negar `Agent` porque a ação é `pousar`.
 * Marcador válido (mesma entrega e mesma contagem de progresso) ⇒ apaga marcador e contador, avisa e NÃO bloqueia, para o turno
 * terminar e o `turn.complete` pousar. Ausente, de outra contagem, ilegível ou que não apaga: regra normal, nunca silencia duas vezes.
 * Entrega publicada (T48: `entregaPublicada` de dist/guarda.js, a regra única) ⇒ silêncio: o Stop não conta nem grava nela.
 * O terceiro Stop sem evento de progresso (tipos que `proximaAcao` consome) no diário da entrega grava `loop.parar {sem_progresso}` e deixa parar com aviso.
 * Falha de dado ou de ferramenta dentro de loop vira systemMessage com a causa, nunca block que prenda a sessão.
 * Sai sempre 0. Núcleo em dist/ (loop.js, plano.js, diario.js): ausente ⇒ aviso, nunca exceção.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';
import { idPadraoDe } from '../lib/config.mjs';
import { raizPorFs, inferirPbi } from '../lib/git.mjs';
import { temOnboarding } from './cartao-sessao.mjs';

export const LIMITE_SEM_PROGRESSO = 3;
const X_PADRAO = 50;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_DO_HOOK = 'stop-loop';
const PLANO_MAX = 1024 * 1024;
const STOPS_MAX = 1_000_000;
const ITENS_NO_MOTIVO = 6;
const PENDENCIAS_NO_MOTIVO = 6;
const COMANDO_APRENDIZADO = 'Feche com `loop.mjs aprendizado <E|A> D --regra <t> --entra-em <a> --gatilho <sessao:seq> --eventos <sessao:seq>` (D também aceita `--fonte <arquivo> --numero <n>`, arquivo versionado, no lugar de --eventos), `loop.mjs aprendizado <E|A> M --regra <t> --entra-em <a> --gatilho <sessao:seq>` (M não leva evidência) ou `loop.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>`.';
const PAPEL = { implementador: 'implementador', revisor: 'revisor', correcao: 'correção' };
const MOTIVO = {
  teto_rodadas: 'teto de rodadas de review',
  ci_vermelho: 'CI vermelho duas vezes',
  teto_tokens: 'teto de tokens',
  sem_pouso: 'sem como pousar',
  sem_progresso: 'sem progresso',
  diario_invalido: 'diário inválido',
  nao_conseguiu: 'sem próxima ação e sem agente vivo',
};
export const TRAVA_LONGA_MS = 30 * 60_000;
/** O mod regrava o sinal a cada Stop; um `armado` mais velho que isto (turno enorme, mod parado) não prova wakeup: vira "não conferível". Futuro > 5 min também. */
export const SINAL_FRESCO_MS = 2 * 60 * 60_000;
const AVISOS_MAX = 50;
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const aviso = (systemMessage) => ({ systemMessage });
const curto = (s, n = 200) => String(s).replace(/[\r\n\t]+/g, ' ').slice(0, n);
/** Id vindo do plano entra em texto de aviso: só letras, números e pontuação mansa, tamanho limitado. */
const limpo = (s) => String(s).replace(/[^\p{L}\p{N}._:/\- ]/gu, '?').slice(0, 60);

function git(cwd, args) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    const t = r.status === 0 ? r.stdout.trim() : '';
    return t === '' ? null : t.split('\n')[0];
  } catch {
    return null;
  }
}

/** Texto do motivo de um `block` ou de um aviso, a partir da ação. `null` = silêncio. Puro. */
export function saidaParaAcao(acao, entrega) {
  const e = limpo(entrega);
  switch (acao?.tipo) {
    case 'despachar': {
      const itens = Array.isArray(acao.itens) ? acao.itens : [];
      if (itens.length === 0) return null;
      const lista = itens.slice(0, ITENS_NO_MOTIVO).map((i) => `${limpo(i.task)} (${PAPEL[i.papel] ?? limpo(i.papel)})`);
      const resto = itens.length - lista.length;
      return { decision: 'block', reason: `Loop da entrega ${e} segue: despache ${lista.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}.` };
    }
    case 'integrar': {
      const tasks = Array.isArray(acao.tasks) ? acao.tasks : [];
      if (tasks.length === 0) return null;
      const lista = tasks.slice(0, ITENS_NO_MOTIVO).map(limpo);
      const resto = tasks.length - lista.length;
      return { decision: 'block', reason: `Loop da entrega ${e} segue: integre ${lista.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}.` };
    }
    case 'parar': {
      const id = typeof acao.motivo === 'string' ? limpo(acao.motivo) : '?';
      const task = acao.task !== undefined ? ` (task ${limpo(acao.task)})` : '';
      return aviso(`Loop da entrega ${e} parou: ${MOTIVO[acao.motivo] ?? id} [${id}]${task}. Nada foi gravado; veja o diário e retome pelo comando do dono.`);
    }
    case 'esperar': {
      // Só `emenda` fala: espera por julgamento do dono. Aviso, nunca block (o dono não é um agente que o hook possa acionar).
      if (acao.motivo !== 'emenda') return null;
      const propostas = Array.isArray(acao.propostas) ? acao.propostas : [];
      if (propostas.length === 0) return null;
      const lista = propostas.slice(0, ITENS_NO_MOTIVO).map((p) => `#${limpo(p?.seq)} ${limpo(p?.req)}`);
      const resto = propostas.length - lista.length;
      return aviso(`Loop da entrega ${e} espera julgamento de emenda: ${lista.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}. Julgue com /gabarito-mestre:emenda aprovar|rejeitar <seq>.`);
    }
    default:
      return null; // concluir e pousar: o hook não tem o que dizer
  }
}

async function carregar(nome) {
  try {
    return { ok: true, mod: await import(pathToFileURL(join(DIST, `${nome}.js`)).href) };
  } catch (e) {
    return { ok: false, aviso: aviso(`Loop: dist/${nome}.js ausente ou inválido (${curto(e?.code ?? e?.name ?? 'erro', 60)}); rode node gates/scripts/build.mjs`) };
  }
}

/** Todas as linhas dos `events.*.jsonl` da entrega, ou o motivo de não poder lê-las. Linha torta invalida o diário. */
function lerDiario(dir) {
  let nomes;
  try {
    nomes = readdirSync(dir).filter((n) => /^events\..+\.jsonl$/.test(n)).sort();
  } catch (e) {
    return { erro: `diretório da entrega (${e?.code ?? 'erro'})` };
  }
  const eventos = [];
  for (const nome of nomes) {
    let bruto;
    try {
      bruto = readFileSync(join(dir, nome), 'utf8');
    } catch (e) {
      return { erro: `${limpo(nome)} (${e?.code ?? 'erro'})` };
    }
    for (const l of bruto.split('\n')) {
      if (l === '') continue;
      let o;
      try {
        o = JSON.parse(l);
      } catch {
        return { erro: `${limpo(nome)} tem linha que não é JSON` };
      }
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return { erro: `${limpo(nome)} tem linha que não é objeto` };
      eventos.push(o);
    }
  }
  return { eventos };
}

const inteiro = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

/** Contador `{entrega, linhas, stops}`. Ausente ou de outra entrega ⇒ recomeça calado; corrompido ⇒ recomeça com causa. */
function lerContador(caminho, entrega) {
  let bruto;
  try {
    bruto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { anterior: null, causa: null };
    return { anterior: null, causa: `contador ilegível (${e?.code ?? 'erro'}); recomeçou do zero` };
  }
  let o;
  try {
    o = JSON.parse(bruto);
  } catch {
    return { anterior: null, causa: 'contador corrompido (não é JSON); recomeçou do zero' };
  }
  if (o === null || typeof o !== 'object' || typeof o.entrega !== 'string' || !inteiro(o.linhas, Number.MAX_SAFE_INTEGER) || !inteiro(o.stops, STOPS_MAX)) {
    return { anterior: null, causa: 'contador corrompido (formato); recomeçou do zero' };
  }
  return o.entrega === entrega ? { anterior: o, causa: null } : { anterior: null, causa: null };
}

/** Grava por arquivo temporário + rename: dois processos nunca deixam JSON pela metade. */
function gravarContador(caminho, valor) {
  const tmp = `${caminho}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(tmp, JSON.stringify(valor) + '\n');
    renameSync(tmp, caminho);
    return null;
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nada a limpar */ }
    return e?.code ?? 'erro';
  }
}

/**
 * Marcador de pouso pendente. `{ valido: true }` só se leu, bateu entrega e contagem E apagou: sem apagar, avisar de novo a cada Stop
 * silenciaria o loop para sempre. Qualquer outra coisa: `{ valido: false, causa }`, com `causa` só quando o arquivo existe e não se lê.
 */
function lerMarcador(caminho, entrega, linhas) {
  let bruto;
  try {
    bruto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { valido: false, causa: null };
    tentarApagar(caminho);
    return { valido: false, causa: `marcador de pouso pendente ilegível (${e?.code ?? 'erro'}); ignorei` };
  }
  let o;
  try {
    o = JSON.parse(bruto);
  } catch {
    tentarApagar(caminho);
    return { valido: false, causa: 'marcador de pouso pendente corrompido (não é JSON); ignorei' };
  }
  if (o === null || typeof o !== 'object' || typeof o.entrega !== 'string' || !inteiro(o.linhas, Number.MAX_SAFE_INTEGER)) {
    tentarApagar(caminho);
    return { valido: false, causa: 'marcador de pouso pendente corrompido (formato); ignorei' };
  }
  const apagou = tentarApagar(caminho);
  return { valido: apagou && o.entrega === entrega && o.linhas === linhas, causa: null };
}

function tentarApagar(caminho) {
  try {
    unlinkSync(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Estado `{entrega, avisados: string[]}` (`"sessao:seq"`). Ausente ou de outra entrega ⇒ vazio e calado; ilegível, não JSON ou de forma
 * errada ⇒ vazio com `causa`. A forma é validada: `avisados` de texto faria `.includes` casar substring.
 */
function lerAvisados(caminho, entrega) {
  let bruto;
  try {
    bruto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { avisados: new Set(), causa: null };
    return { avisados: new Set(), causa: `Loop: estado do aviso de aprendizado ilegível (${e?.code ?? 'erro'}); recomeçou` };
  }
  const corrompido = { avisados: new Set(), causa: 'Loop: estado do aviso de aprendizado corrompido; recomeçou' };
  let o;
  try {
    o = JSON.parse(bruto);
  } catch {
    return corrompido;
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o) || typeof o.entrega !== 'string'
    || !Array.isArray(o.avisados) || !o.avisados.every((c) => typeof c === 'string')) return corrompido;
  return { avisados: o.entrega === entrega ? new Set(o.avisados) : new Set(), causa: null };
}

/** Aviso de aprendizado pendente. Todas já avisadas ⇒ só systemMessage; alguma nova ⇒ block, depois de gravar o estado (block sem estado seria infinito). */
function avisoAprendizado(raiz, entrega, abertas) {
  const caminho = join(raiz, '.harness', 'stop-aprender.json');
  const chaves = abertas.map((p) => `${p.sessao}:${p.seq}`);
  const { avisados, causa } = lerAvisados(caminho, entrega);
  const novas = chaves.some((c) => !avisados.has(c));
  const lista = abertas.slice(0, PENDENCIAS_NO_MOTIVO).map((p) => `${limpo(p.tipo)} ${limpo(p.sessao)}:${limpo(p.seq)}`);
  const resto = abertas.length - lista.length;
  const texto = `Loop da entrega ${limpo(entrega)} tem aprendizado pendente: ${lista.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}. ${COMANDO_APRENDIZADO}`;
  const igual = causa === null && chaves.length === avisados.size && chaves.every((c) => avisados.has(c));
  const falha = igual ? null : gravarContador(caminho, { entrega, avisados: chaves }); // poda: fica só o que ainda está aberto
  if (falha !== null) return aviso(`${texto} O estado do aviso não grava (${falha}); sem ele o bloqueio não teria fim, então não bloqueio.`);
  if (!novas) return aviso(texto);
  return causa === null ? { decision: 'block', reason: texto } : { decision: 'block', reason: texto, systemMessage: causa };
}

function pausado(raiz) {
  if (existsSync(join(raiz, '.harness', 'PAUSAR'))) return true;
  const comum = git(raiz, ['rev-parse', '--git-common-dir']);
  if (comum === null) return false;
  const principal = dirname(resolve(raiz, comum));
  return principal !== raiz && existsSync(join(principal, '.harness', 'PAUSAR'));
}

function lerEntrada(texto) {
  if (texto === null || texto.trim() === '') return { aviso: aviso('Loop: stdin do hook Stop ausente; nada decidido') };
  let o;
  try {
    o = JSON.parse(texto);
  } catch {
    return { aviso: aviso('Loop: stdin do hook Stop não é JSON válido; nada decidido') };
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return { aviso: aviso('Loop: stdin do hook Stop não é um objeto JSON; nada decidido') };
  return { entrada: o };
}

/**
 * Entrega da branch pela MESMA regra do `loop.mjs` e do cartão (`idDaBranch` com `idPadraoDe`, GM-15 hotfix): `hotfix/GM-15-alpha2` ⇒ GM-15.
 * `dist/trilha.js` ausente ⇒ cai em `inferirPbi` (o aviso de dist ausente vem dos outros módulos, mais adiante). Nunca lança.
 */
async function entregaDaBranch(raiz, branch) {
  try {
    const dt = await carregar('trilha');
    if (dt.ok) return dt.mod.idDaBranch(branch, idPadraoDe(raiz));
    let cfg;
    try { cfg = JSON.parse(readFileSync(join(raiz, 'harness.config.json'), 'utf8')); } catch { /* sem config: padrões */ }
    return inferirPbi(branch, cfg)?.pbi ?? null;
  } catch {
    return null;
  }
}

/**
 * `concluir` com liberação do teto no diário: lista task, hora e sessão (a forja pelo mesmo usuário de SO não é evitável, só visível). Nunca bloqueia.
 * GM-14 T36 (FIEL-15 c): a liberação da Sombra entra na mesma lista como "a Sombra liberou a <task>"; a do dono segue como antes (só a task).
 */
function avisoLiberacoes(eventos, entrega) {
  const liberacoes = eventos.filter((e) => e?.tipo === 'task.reaberta' && (e.dados?.origem === 'dono' || e.dados?.origem === 'sombra'));
  if (liberacoes.length === 0) return null;
  const lista = liberacoes.slice(0, ITENS_NO_MOTIVO).map((e) => `${e.dados.origem === 'sombra' ? 'a Sombra liberou a ' : ''}${limpo(e.dados.task)} (${limpo(e.ts)}, ${limpo(e.sessao)})`);
  const resto = liberacoes.length - lista.length;
  return aviso(`Loop da entrega ${limpo(entrega)} concluído. Liberações do teto: ${lista.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}. Se não foi você, confira o diário.`);
}

const SHELL_INTEGRANDO = /\b(integrar|gate-task)\b/;
const SHELL_ENCERRADO = new Set(['idle', 'completed', 'failed', 'killed']);

/**
 * Trabalho vivo em segundo plano: subagent (qualquer status) ou shell de fundo do orquestrador que integra (GM-15 STP-1, forma medida no S5:
 * `{type:'shell', status:'running', description, command}`). A `description` vem do modelo, então `command` também vale. Outro shell não conta;
 * shell já encerrado também não.
 */
function temTrabalhoVivo(tarefas) {
  if (!Array.isArray(tarefas)) return false;
  return tarefas.some((t) => {
    if (t === null || typeof t !== 'object') return false;
    if (t.type === 'subagent') return true;
    if (t.type !== 'shell' || (typeof t.status === 'string' && SHELL_ENCERRADO.has(t.status))) return false;
    return [t.description, t.command].some((c) => typeof c === 'string' && c.length <= 2000 && SHELL_INTEGRANDO.test(c));
  });
}

/** Comando de quem destrava: o teto de rodadas é do dono (`/gabarito-mestre:liberar <task>`), o resto se retoma pelo `/gabarito retomar`. Id fora do padrão cai no genérico. */
function comandoDaTrava(acao) {
  if (acao?.motivo === 'teto_rodadas' && typeof acao.task === 'string') {
    const t = limpo(acao.task);
    if (/^[\p{L}\p{N}._-]+$/u.test(t)) return `/gabarito-mestre:liberar ${t}`;
  }
  return '/gabarito retomar';
}

/** Texto longo de uma trava com `minutos` de idade: motivo e comando. Puro. */
export function textoTravaLonga(acao, minutos) {
  const motivo = MOTIVO[acao?.motivo] ?? (typeof acao?.motivo === 'string' ? limpo(acao.motivo) : '?');
  return `Parado há ${minutos} min: ${motivo}. Para destravar: \`${comandoDaTrava(acao)}\`.`;
}

/** Id de sessão aceito no nome do arquivo de avisos (a mesma forma do mod/gabarito.mjs). */
const ID_AVISOS = /^[A-Za-z0-9-]{1,128}$/;

/**
 * `.harness/contexto/stop-avisos.<sessao>.json {entrega, trava: string[], loop: string[]}`: o que já foi dito (chaves de trava e sessões já avisadas de loop desligado).
 * Ausente, ilegível, de outra entrega ou fora da forma ⇒ vazio (só repetiria um aviso, nunca prende nada).
 */
function lerAvisos(caminho, entrega) {
  const vazio = { trava: [], loop: [] };
  try {
    const o = JSON.parse(readFileSync(caminho, 'utf8'));
    const lista = (v) => Array.isArray(v) && v.every((c) => typeof c === 'string');
    if (o === null || typeof o !== 'object' || o.entrega !== entrega || !lista(o.trava) || !lista(o.loop)) return vazio;
    return { trava: o.trava, loop: o.loop };
  } catch {
    return vazio;
  }
}

/** `true` se `chave` já constava em `campo`; senão grava (poda nas últimas 50) e devolve `false`. Gravar falhou ⇒ `false` (o aviso sai; nunca bloqueia, só pode repetir). */
function jaAvisou(raiz, sessao, entrega, campo, chave) {
  if (typeof sessao !== 'string' || !ID_AVISOS.test(sessao)) return false; // sem id utilizável não há chave: não grava (o aviso sai)
  const caminho = join(raiz, '.harness', 'contexto', `stop-avisos.${sessao}.json`);
  const estado = lerAvisos(caminho, entrega);
  if (estado[campo].includes(chave)) return true;
  estado[campo] = [...estado[campo], chave].slice(-AVISOS_MAX);
  gravarContador(caminho, { entrega, ...estado });
  return false;
}

/** Raiz do checkout principal (onde o mod grava `.harness/contexto/`), mesma conta do `pausado`. */
function raizPrincipal(raiz) {
  const comum = git(raiz, ['rev-parse', '--git-common-dir']);
  return comum === null ? raiz : dirname(resolve(raiz, comum));
}

/** O sinal do loop da T17 para ESTA sessão: `true` só com `armado`, da própria sessão e fresco. Qualquer outra coisa (ausente, corrompido, velho, de outra sessão, mod fora do lugar) ⇒ `false`. */
async function sinalArmado(raiz, sessao, agoraMs) {
  if (sessao === null) return false;
  try {
    const mod = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mod', 'gabarito.mjs')).href);
    const arquivo = mod.arquivoSinalLoop(sessao);
    if (arquivo === null) return false;
    const s = mod.interpretarSinalLoop(readFileSync(join(raizPrincipal(raiz), '.harness', arquivo), 'utf8'), sessao);
    if (s.estado !== 'armado') return false;
    const em = Date.parse(s.em);
    return Number.isFinite(em) && agoraMs - em <= SINAL_FRESCO_MS && em - agoraMs <= 5 * 60_000;
  } catch {
    return false;
  }
}

/** Percentual da leitura própria; `leituraPropria` ausente ou falhando perde só o aviso de contexto (0), nunca o Stop. */
function percentePropria(dpp, medicao) {
  try { return dpp.mod.leituraPropria(medicao)?.percent ?? 0; } catch { return 0; }
}

/** Há `sessao.pouso` DESTA sessão depois do último `review.veredito` (a fronteira atual)? */
function pousouNaFronteira(eventos, sessao) {
  if (sessao === null) return false;
  let veredito = Number.NEGATIVE_INFINITY;
  for (const e of eventos) {
    const t = e?.tipo === 'review.veredito' ? Date.parse(e.ts) : Number.NaN;
    if (Number.isFinite(t) && t > veredito) veredito = t;
  }
  return eventos.some((e) => e?.tipo === 'sessao.pouso' && e.sessao === sessao && Date.parse(e.ts) > veredito);
}

/** `parar`: o aviso de sempre; com a trava há mais de 30 min, e ainda não dita (motivo + início), o texto longo com o comando. */
function avisoParar(raiz, sessao, entrega, acao, eventos, tiposDeProgresso, agoraMs) {
  const saida = saidaParaAcao(acao, entrega);
  const inicio = eventos
    .filter((e) => tiposDeProgresso.includes(e.tipo) || e.tipo === 'loop.parar')
    .reduce((m, e) => Math.max(m, Date.parse(e.ts)), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(inicio) || agoraMs - inicio <= TRAVA_LONGA_MS) return saida;
  if (jaAvisou(raiz, sessao, entrega, 'trava', `${typeof acao.motivo === 'string' ? limpo(acao.motivo) : '?'}@${new Date(inicio).toISOString()}`)) return saida;
  return aviso(`${saida.systemMessage} ${textoTravaLonga(acao, Math.floor((agoraMs - inicio) / 60_000))}`);
}

/** Junta ao que o hook decidiu os avisos de contexto e de loop desligado (nunca muda `decision`). `ctx.p` só existe com o loop de pé. */
function acrescentarAvisos(saida, ctx) {
  const p = ctx.p;
  if (p === undefined || p.acao === undefined || p.acao.tipo === 'concluir') return saida;
  const msgs = [];
  if (p.noTeto && !p.pousou && p.armado) {
    msgs.push(`Loop da entrega ${limpo(p.entrega)}: contexto em ${Math.round(p.percent)} % (teto ${p.x} %), é hora de limpar a conversa. Quem limpa é o mod (pouso automático), não o agente: nenhum comando seu é preciso.`);
  }
  const precisaDoLoop = p.pendente || p.noTeto || ['despachar', 'integrar', 'pousar'].includes(p.acao.tipo);
  if (p.onboarding && !p.armado && precisaDoLoop && !p.falouLoop
    && !jaAvisou(p.raiz, p.sessao, p.entrega, 'loop', p.sessao ?? 'sem-sessao')) {
    msgs.push(`Loop da entrega ${limpo(p.entrega)}: ligar o loop automático (um /loop sem intervalo, com a tarefa de seguir o loop da entrega): sem o sinal dele nesta sessão nada retoma o trabalho depois do pouso.`);
  }
  if (msgs.length === 0) return saida;
  const base = saida?.systemMessage;
  return { ...(saida ?? {}), systemMessage: [base, ...msgs].filter((m) => typeof m === 'string' && m !== '').join(' ') };
}

/** Núcleo do hook. Devolve o objeto a imprimir, ou `null` para silêncio. */
export async function executar(texto, ambiente = process.env, cwdProcesso = process.cwd()) {
  const ctx = {};
  return acrescentarAvisos(await decidir(texto, ambiente, cwdProcesso, ctx), ctx);
}

async function decidir(texto, ambiente, cwdProcesso, ctx) {
  const { entrada, aviso: erroEntrada } = lerEntrada(texto);
  if (erroEntrada) return erroEntrada;

  const raiz = [ambiente.CLAUDE_PROJECT_DIR, entrada.cwd, cwdProcesso]
    .map((c) => (typeof c === 'string' && c !== '' ? raizPorFs(resolve(c)) : null))
    .find((r) => r !== null) ?? null;
  if (raiz === null) return null;
  const branch = git(raiz, ['symbolic-ref', '--short', 'HEAD']);
  if (branch === null) return null;
  const entrega = await entregaDaBranch(raiz, branch);
  if (entrega === null) return null;

  // GM-14 T48 (emenda 43): entrega publicada (a regra única de `dist/guarda.js`, a mesma do painel e dos gravadores) não é loop: nem contador nem `loop.parar`.
  const dg = await carregar('guarda');
  if (dg.ok && dg.mod.entregaPublicada(raiz, entrega, typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null)) return null;

  const dir = join(raiz, '.harness', 'entregas', entrega);
  const arquivoPlano = join(dir, 'plano.json');
  let brutoPlano;
  try {
    if (statSync(arquivoPlano).size > PLANO_MAX) return aviso(`Loop: plano.json da entrega ${limpo(entrega)} grande demais; nada decidido`);
    brutoPlano = readFileSync(arquivoPlano, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null;
    return aviso(`Loop: plano.json da entrega ${limpo(entrega)} ilegível (${e?.code ?? 'erro'}); nada decidido`);
  }

  const dp = await carregar('plano');
  if (!dp.ok) return dp.aviso;
  let bruto;
  try {
    bruto = JSON.parse(brutoPlano);
  } catch {
    return aviso(`Loop: plano.json da entrega ${limpo(entrega)} não é JSON válido; nada decidido`);
  }
  const v = dp.mod.validarPlano(bruto);
  if (!v.ok) return aviso(`Loop: plano.json da entrega ${limpo(entrega)} inválido: ${curto(v.erro)}; nada decidido`);
  const plano = v.plano;

  if (temTrabalhoVivo(entrada.background_tasks)) return null;
  if (pausado(raiz)) return null;

  const dl = await carregar('loop');
  if (!dl.ok) return dl.aviso;
  const dd = await carregar('diario');
  if (!dd.ok) return dd.aviso;
  // Fonte única dos tipos (loop.ts). Lista ausente ou vazia nunca vira "0 progresso": sem ela não há como contar, então só avisa.
  const listaOk = (l) => Array.isArray(l) && l.length > 0 && l.every((t) => typeof t === 'string');
  if (!listaOk(dl.mod.TIPOS_DE_TASK) || !listaOk(dl.mod.TIPOS_DE_PROGRESSO)) {
    return aviso('Loop: dist/loop.js sem TIPOS_DE_PROGRESSO; nada decidido; rode node gates/scripts/build.mjs');
  }
  const TIPOS_DE_TASK = dl.mod.TIPOS_DE_TASK;
  const TIPOS_DE_PROGRESSO = dl.mod.TIPOS_DE_PROGRESSO;

  const lido = lerDiario(dir);
  if (lido.erro) return aviso(`Loop: diário da entrega ${limpo(entrega)} ilegível: ${lido.erro}; nada decidido`);
  const { eventos } = lido;

  const ord = dl.mod.ordenar(eventos);
  // GM-14 FIEL-14 (f), emenda 29: a MESMA `pousoPendente` do `loop.mjs proxima` (dist/pouso-pendente.js, sem 2ª definição) e o MESMO fato de
  // onboarding (`temOnboarding`, config local). Sem onboarding nunca é pendente: o Stop segue como na 2.0.
  const dpp = await carregar('pouso-pendente');
  if (!dpp.ok) return dpp.aviso;
  // GM-14 T53 (emendas 52 e 53, I1): com o mod medindo ESTA sessão só a leitura dela (`.harness/contexto/<sessao>.json`, fonte `mod`, `em` <= 120 s) decide; nenhuma outra
  // sessão libera ou prende esta. A regra é a mesma `pousoPendente` (nenhuma 2ª definição). Arquivo ausente/ilegível ⇒ sem leitura ⇒ a regra sem mod.
  const sessaoAtual = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : null;
  // GM-15 T16 (HIG-1): o mesmo `lerX` do mod e do `pouso.mjs` (decimal em (0, 100], inválido ⇒ 50); dist/pouso.js ausente ⇒ X padrão, sem lançar.
  const dpx = await carregar('pouso');
  const xTeto = dpx.ok && typeof dpx.mod.lerX === 'function' ? dpx.mod.lerX(process.env.GABARITO_POUSO_X).x : X_PADRAO;
  const onboarding = temOnboarding(raiz);
  const armado = await sinalArmado(raiz, sessaoAtual, Date.now());
  let medicao;
  let pendente = false;
  let noTeto = false;
  try {
    const leituras = [];
    if (sessaoAtual !== null) {
      try {
        const l = dpp.mod.lerLeitura(sessaoAtual, readFileSync(join(raiz, '.harness', 'contexto', `${sessaoAtual}.json`), 'utf8'));
        if (l !== null) leituras.push(l);
      } catch { /* sem arquivo: sem leitura */ }
    }
    medicao = { x: xTeto, agoraMs: Date.now(), sessaoAtual, leituras };
    pendente = dpp.mod.pousoPendente(eventos, onboarding, medicao).pendente === true;
    noTeto = dpp.mod.noTeto(medicao) === true;
  } catch { pendente = false; noTeto = false; }
  // "Aguardando o pouso do mod" só é verdade com o mod medindo AGORA (leitura fresca: a mesma situação da regra única), com veredito (há fronteira) e sem o mod já
  // ter desistido (`sem_pouso`): fora disso o dono é quem limpa, e a instrução "digite /clear" é a certa.
  let modAtivo = false;
  try {
    const dpo = await carregar('pouso');
    modAtivo = medicao !== undefined && dpo.ok && dpp.mod.leituraPropria(medicao) !== null
      && dpo.mod.pousoDaFronteira(eventos) === true && dpo.mod.jaParou(eventos) !== true;
  } catch { modAtivo = false; }
  let acao;
  let falhaAcao = null;
  try {
    acao = dl.mod.proximaAcao(plano, eventos, {
      slots: 1, percent: null, x: X_PADRAO, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false, pousoPendente: pendente,
    });
  } catch (e) {
    falhaAcao = aviso(`Loop: proximaAcao falhou (${curto(e?.name ?? 'erro', 60)}); nada decidido`);
  }
  // Diário que a `proximaAcao` recusa: aviso de sempre, sem pendência (calculada sobre ele, o CLI do aprendizado não a fecharia).
  if (acao?.tipo === 'parar' && acao.motivo === 'diario_invalido') return saidaParaAcao(acao, entrega);

  ctx.p = {
    raiz, entrega, sessao: sessaoAtual, acao, pendente, noTeto, onboarding, armado, x: xTeto,
    percent: percentePropria(dpp, medicao), pousou: pousouNaFronteira(eventos, sessaoAtual), falouLoop: false,
  };
  // Pendência à parte: `parar` por ci_vermelho/teto_rodadas/nao_conseguiu vence o `aprender`, e o `loop.parar` do mod abre pendência `parar`.
  if (ord.ok) {
    const dpend = await carregar('pendencias');
    if (!dpend.ok) return dpend.aviso;
    let abertas;
    try {
      abertas = dpend.mod.pendenciasAprendizado(plano, eventos);
    } catch (e) {
      return aviso(`Loop: pendenciasAprendizado falhou (${curto(e?.name ?? 'erro', 60)}); nada decidido`);
    }
    if (Array.isArray(abertas) && abertas.length > 0) return avisoAprendizado(raiz, entrega, abertas);
    const iParar = ord.eventos.map((e) => e.tipo).lastIndexOf('loop.parar');
    if (iParar >= 0 && !ord.eventos.slice(iParar + 1).some((e) => TIPOS_DE_TASK.includes(e.tipo))) return null;
  }
  if (falhaAcao !== null) return falhaAcao;
  if (acao.tipo === 'concluir') return avisoLiberacoes(eventos, entrega);
  // Pouso pendente: nada novo começa e o Stop não conta "sem progresso" (a conversa precisa de /clear, não de despacho).
  if (pendente && (acao.tipo === 'despachar' || acao.tipo === 'integrar' || acao.tipo === 'pousar' || (acao.tipo === 'parar' && acao.motivo === 'sem_pouso'))) {
    // com o mod ativo quem limpa é ele (T53): o Stop nunca pede despacho e não manda o dono digitar /clear
    // aprendizado 185 (REQ-POU-4): sem o wakeup armado nunca se pede /clear; manda ligar o loop primeiro
    if (!modAtivo && !armado) {
      ctx.p.falouLoop = true;
      return aviso(`Loop da entrega ${limpo(entrega)}: pouso pendente; ligar o loop automático (um /loop sem intervalo, com a tarefa de seguir o loop da entrega) antes de limpar a conversa, porque sem ele nada retoma depois (nada novo é despachado antes)`);
    }
    return aviso(modAtivo
      ? `Loop da entrega ${limpo(entrega)}: aguardando o pouso do mod (a conversa precisa ser limpa e medida; nada novo é despachado antes)`
      : `Loop da entrega ${limpo(entrega)}: pouso pendente; digite /clear para retomar em conversa limpa (nada novo é despachado antes)`);
  }
  // T53 (52 b): no teto de contexto o Stop também não pede despacho novo (revisor segue valendo: ele fecha a fronteira que o pouso espera)
  if (noTeto && acao.tipo === 'despachar' && !acao.itens.some((i) => i?.papel === 'revisor')) {
    return aviso(`Loop da entrega ${limpo(entrega)}: contexto no teto, aguardando o pouso do mod (nada novo é despachado antes)`);
  }
  if (acao.tipo === 'parar') return avisoParar(raiz, sessaoAtual, entrega, acao, ord.ok ? ord.eventos : [], TIPOS_DE_PROGRESSO, Date.now());
  if (acao.tipo !== 'despachar' && acao.tipo !== 'integrar') return saidaParaAcao(acao, entrega);

  const saida = saidaParaAcao(acao, entrega);
  if (saida === null) return null;

  // Há ação: o `block` só vale se houver contador que o termine.
  const caminho = join(raiz, '.harness', 'stop-contador.json');
  const linhas = eventos.filter((e) => TIPOS_DE_PROGRESSO.includes(e.tipo)).length; // campo `linhas` do contador = eventos de progresso
  const marcador = lerMarcador(join(raiz, '.harness', 'pouso-pendente.json'), entrega, linhas);
  if (marcador.valido) {
    tentarApagar(caminho); // contador recomeça: o pouso é progresso
    return aviso('Loop: pouso pendente; se a sessão não retomar, digite uma mensagem');
  }
  const { anterior, causa: causaContador } = lerContador(caminho, entrega);
  const causa = [marcador.causa, causaContador].filter((c) => c !== null).join('; ') || null;
  const stops = anterior !== null && anterior.linhas === linhas ? anterior.stops + 1 : 0;

  if (stops >= LIMITE_SEM_PROGRESSO) {
    const sessao = typeof entrada.session_id === 'string' && SESSAO_RE.test(entrada.session_id) ? entrada.session_id : SESSAO_DO_HOOK;
    let res;
    try {
      res = dd.mod.append(dir, sessao, {
        ts: new Date().toISOString(),
        autor: git(raiz, ['config', 'user.email']) ?? 'desconhecido',
        sessao,
        agente: 'orquestrador',
        tipo: 'loop.parar',
        dados: { motivo: 'sem_progresso', stops },
      });
    } catch (e) {
      res = { ok: false, erro: curto(e?.name ?? 'erro', 60) };
    }
    if (res.ok && res.gravado === 'evento') {
      return aviso(`Loop da entrega ${limpo(entrega)} parou: ${LIMITE_SEM_PROGRESSO} Stops sem evento de progresso no diário [sem_progresso]. Gravei loop.parar; retome pelo comando do dono.`);
    }
    return aviso(`Loop da entrega ${limpo(entrega)}: ${LIMITE_SEM_PROGRESSO} Stops sem evento de progresso [sem_progresso], mas NÃO consegui gravar loop.parar (${curto(res.erro ?? res.gravado, 80)}); deixo parar sem bloquear.`);
  }

  const falha = gravarContador(caminho, { entrega, linhas, stops });
  if (falha !== null) {
    return aviso(`Loop da entrega ${limpo(entrega)} tem ação pendente, mas o contador não grava (${falha}); sem contador o bloqueio não teria fim, então não bloqueio.`);
  }
  return causa === null ? saida : { ...saida, systemMessage: `Loop: ${causa}` };
}

async function principal() {
  let texto = null;
  try {
    texto = readFileSync(0, 'utf8');
  } catch { /* stdin ausente */ }
  let saida;
  try {
    saida = await executar(texto);
  } catch (e) {
    saida = aviso(`Loop: o hook Stop falhou (${curto(e?.name ?? 'erro', 60)}); nada decidido`);
  }
  if (saida !== null) process.stdout.write(JSON.stringify(saida) + '\n');
  process.exitCode = 0;
}

if (ehEntrypoint(import.meta.url)) await principal();

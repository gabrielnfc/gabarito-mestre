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
 *   loop.parar sem task depois .... silêncio
 *   diário ilegível ............... systemMessage, nunca vira `concluir`
 *   proximaAcao: concluir/esperar . silêncio; parar: systemMessage; despachar/integrar: block
 * Pouso pendente (T18): `.harness/pouso-pendente.json {entrega, linhas}`, gravado pelo mod ao negar `Agent` porque a ação é `pousar`.
 * Marcador válido (mesma entrega e mesma contagem de progresso) ⇒ apaga marcador e contador, avisa e NÃO bloqueia, para o turno
 * terminar e o `turn.complete` pousar. Ausente, de outra contagem, ilegível ou que não apaga: regra normal, nunca silencia duas vezes.
 * O terceiro Stop sem evento de progresso (tipos que `proximaAcao` consome) no diário da entrega grava `loop.parar {sem_progresso}` e deixa parar com aviso.
 * Falha de dado ou de ferramenta dentro de loop vira systemMessage com a causa, nunca block que prenda a sessão.
 * Sai sempre 0. Núcleo em dist/ (loop.js, plano.js, diario.js): ausente ⇒ aviso, nunca exceção.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';
import { raizPorFs, inferirPbi } from '../lib/git.mjs';

export const LIMITE_SEM_PROGRESSO = 3;
const X_PADRAO = 50;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_DO_HOOK = 'stop-loop';
const PLANO_MAX = 1024 * 1024;
const STOPS_MAX = 1_000_000;
const ITENS_NO_MOTIVO = 6;
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
    default:
      return null; // concluir, esperar e pousar: o hook não tem o que dizer
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

function entregaDaBranch(raiz, branch) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(raiz, 'harness.config.json'), 'utf8'));
  } catch { /* sem config: padrões */ }
  try {
    return inferirPbi(branch, cfg)?.pbi ?? null;
  } catch {
    return null;
  }
}

/** Núcleo do hook. Devolve o objeto a imprimir, ou `null` para silêncio. */
export async function executar(texto, ambiente = process.env, cwdProcesso = process.cwd()) {
  const { entrada, aviso: erroEntrada } = lerEntrada(texto);
  if (erroEntrada) return erroEntrada;

  const raiz = [ambiente.CLAUDE_PROJECT_DIR, entrada.cwd, cwdProcesso]
    .map((c) => (typeof c === 'string' && c !== '' ? raizPorFs(resolve(c)) : null))
    .find((r) => r !== null) ?? null;
  if (raiz === null) return null;
  const branch = git(raiz, ['symbolic-ref', '--short', 'HEAD']);
  if (branch === null) return null;
  const entrega = entregaDaBranch(raiz, branch);
  if (entrega === null) return null;

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

  if (Array.isArray(entrada.background_tasks) && entrada.background_tasks.some((t) => t !== null && typeof t === 'object' && t.type === 'subagent')) return null;
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
  if (ord.ok) {
    const iParar = ord.eventos.map((e) => e.tipo).lastIndexOf('loop.parar');
    if (iParar >= 0 && !ord.eventos.slice(iParar + 1).some((e) => TIPOS_DE_TASK.includes(e.tipo))) return null;
  }

  let acao;
  try {
    acao = dl.mod.proximaAcao(plano, eventos, {
      slots: 1, percent: null, x: X_PADRAO, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false,
    });
  } catch (e) {
    return aviso(`Loop: proximaAcao falhou (${curto(e?.name ?? 'erro', 60)}); nada decidido`);
  }
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

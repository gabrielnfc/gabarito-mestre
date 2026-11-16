#!/usr/bin/env node
/**
 * Painel (E4, GM-12, T9): CLI de LEITURA. Única borda de E/S do painel; o núcleo (`dist/painel*.js`) é puro.
 *
 *   painel.mjs estado [--agentes] [--pacote <nome>] [--entrega <ID>]
 *   painel.mjs texto  [--largura N] [--preset esquadrao|executivo] [--tema color|mono] [--pacote <nome>] [--agentes] [--entrega <ID>]
 *   painel.mjs medir  [--agentes]   (GM-14 REQ-DIA-1: o ÚNICO subcomando que grava; em `painel-medir.mjs`. GM-15 T4 (REQ-ENT-1 c), papel novo: além de
 *                                    `fato.medido` grava `entrega.encerrada` (origem automática) quando um PR com base `main` encerra a entrega)
 *
 * `--agentes`: JSON em stdin `{sessao:{percent,tokens,window,h5,d7,x,notificacao,pacote}, agentes:[{id,type,description,status,transcript}]|null}`
 * (sombra-p1d D-M3). SEM `--agentes` o stdin NUNCA é lido (a skill chama pelo Bash com stdin herdado: o CLI travaria).
 * `estado` imprime `{ok:true, estado, avisos}`; `texto` imprime `paraTexto(renderPainel(...))` (padrão: 80 colunas, esquadrao, mono).
 * Falha: UMA linha JSON `{ok:false, erro, mensagem}`, rc 1; uso errado rc 2. `texto` falha com a mesma linha JSON.
 *
 * `estado` e `texto` SÓ LEEM (D8). Nada de `decidirAgora`, lock, âncora, `append` ou `.harness/` criado: o painel pode rodar a cada 30 s, durante um deploy, com a janela fechada.
 * A decisão de entrega vem de `prepararLeitura` + `decisaoDe` (entrega.mjs), só com o loop em `concluir`.
 *
 * LEITURA ESTÁVEL DO DIÁRIO (D-M2). O diário são vários `events.<sessao>.jsonl` de processos diferentes; lidos em sequência, uma linha em gravação
 * ou um evento que cai num arquivo já lido (e o que depende dele num ainda não lido) parecem diário inválido. `lerDiarioEstavel` compara
 * (nome, tamanho) de todo `events.*.jsonl` antes e depois da leitura: iguais ⇒ vale; diferentes ⇒ relê, até 3 vezes (50 ms entre elas); 3 instáveis ⇒
 * `diario_em_escrita` (falha de leitura, NUNCA PAROU). "Inválido" só vale lido estável.
 *
 * LIMITES DECLARADOS. (1) `prepararLeitura` relê o diário (2ª fotografia); só alimenta `decisaoEntrega`. (2) `AgentePainel.tok` = soma com dedupe da
 * CAUDA lida (≤ 256 KB), não do transcript inteiro (MINOR, backlog: nenhum render o lê).
 */
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readFileSync, readdirSync } from 'node:fs';
import { isatty } from 'node:tty';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';
import { idPadraoDe, lerConfigOrigin } from '../lib/config.mjs';
import { dirEntrega, lerEstrito } from '../dist/diario.js';
import { lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { estadoDe, ordenar, proximaAcao, TIPOS_DE_TASK } from '../dist/loop.js';
import { entregueDe, etapasDasAnteriores, fechamentoDasAnteriores, projetarPainel, renderPainel, ritmoDasAnteriores, umaLinhaDe } from '../dist/painel.js';
import { validarPacote, validarStdinAgentes, usoDoTranscript } from '../dist/painel-equipe.js';
import { fusoValido } from '../dist/painel-hora.js';
import { paraTexto } from '../dist/painel-texto.js';
import { lerX } from '../dist/pouso.js';
import { sessoesDeRetomada } from '../dist/pouso-pendente.js';
import { encerramentoDe, idDaBranch, trilhaDe } from '../dist/trilha.js';
import { proximaEntrega } from '../dist/depende.js';
import { temOnboarding } from './cartao-sessao.mjs';
import { carregarPlano, checkoutDaSessao, contexto, lerDiarioEstrito, lerSpec, lerSpecs, medicaoDoPouso, tetoDaSombra } from './loop.mjs';
import { decisaoDe, pausado, prepararLeitura } from './entrega.mjs';
import { medir } from './painel-medir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MOD_NOMES = join(AQUI, '..', '..', 'mod', 'temas', 'nomes');
const PACOTE_PADRAO = 'terra-media';
const PACOTE_RE = /^[a-z0-9-]{1,32}$/;
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const LARGURA_RE = /^[1-9]\d{0,5}$/;
const PRESETS = ['esquadrao', 'executivo'];
const TEMAS = ['color', 'mono'];
const CAUDA_MAX = 262144;
const STDIN_MAX = 4 * 1024 * 1024;
const TENTATIVAS = 3;
const INTERVALO_MS = 50;
const SINAIS_NEUTROS = { slots: 1, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false };
const USO = 'uso: painel.mjs estado [--agentes] [--pacote <nome>] [--entrega <ID>] [--sessao <id>] | painel.mjs texto [--largura N] [--preset esquadrao|executivo] [--tema color|mono] [--pacote <nome>] [--agentes] [--entrega <ID>] [--sessao <id>] | painel.mjs medir [--agentes]';

/** Falha com código: vira `{ok:false, erro, mensagem}` (rc 1; uso é 2). */
class Falha extends Error {
  constructor(erro, mensagem, rc = 1) {
    super(mensagem);
    this.erro = erro;
    this.rc = rc;
  }
}

const ehObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const numero = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// ─────────────────────────────────────────────────────────────── argumentos

/** Estrito: subcomando, flag desconhecida, repetida, sem valor, valor fora da forma e posicional a mais são uso (rc 2). */
export function lerArgs(argv) {
  const [cmd, ...resto] = argv;
  if (cmd !== 'estado' && cmd !== 'texto' && cmd !== 'medir') throw new Falha('uso', `subcomando ${JSON.stringify(cmd ?? null)}: esperado estado, texto ou medir. ${USO}`, 2);
  const COM_VALOR = cmd === 'texto' ? ['largura', 'preset', 'tema', 'pacote', 'entrega', 'sessao'] : cmd === 'medir' ? [] : ['pacote', 'entrega', 'sessao'];
  const flags = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (!a.startsWith('--')) throw new Falha('uso', `argumento inesperado ${JSON.stringify(a)}. ${USO}`, 2);
    const nome = a.slice(2);
    if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${USO}`, 2);
    if (nome === 'agentes') {
      flags.agentes = true;
    } else if (COM_VALOR.includes(nome)) {
      const v = resto[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Falha('uso', `${a} exige um valor. ${USO}`, 2);
      flags[nome] = v;
      i++;
    } else {
      throw new Falha('uso', `flag desconhecida${cmd === 'estado' && ['largura', 'preset', 'tema'].includes(nome) ? ` em estado (${a} é do texto)` : ''}: ${a}. ${USO}`, 2);
    }
  }
  if (flags.largura !== undefined && !LARGURA_RE.test(flags.largura)) throw new Falha('uso', `--largura ${JSON.stringify(flags.largura)}: esperado inteiro >= 1. ${USO}`, 2);
  if (flags.preset !== undefined && !PRESETS.includes(flags.preset)) throw new Falha('uso', `--preset ${JSON.stringify(flags.preset)}: esperado ${PRESETS.join(' | ')}. ${USO}`, 2);
  if (flags.tema !== undefined && !TEMAS.includes(flags.tema)) throw new Falha('uso', `--tema ${JSON.stringify(flags.tema)}: esperado ${TEMAS.join(' | ')}. ${USO}`, 2);
  if (flags.pacote !== undefined && !PACOTE_RE.test(flags.pacote)) throw new Falha('uso', `--pacote ${JSON.stringify(flags.pacote)} fora da forma ${PACOTE_RE}. ${USO}`, 2);
  if (flags.sessao !== undefined && !SESSAO_RE.test(flags.sessao)) throw new Falha('uso', `--sessao ${JSON.stringify(flags.sessao)} fora da forma ${SESSAO_RE}. ${USO}`, 2);
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('uso', `--entrega ${JSON.stringify(flags.entrega)} fora da forma ${ENTREGA_RE}. ${USO}`, 2);
  return { cmd, flags };
}

// ─────────────────────────────────────────────────────────────── stdin (só com --agentes)

function lerStdin() {
  if (isatty(0)) return '';
  const partes = [];
  const buf = Buffer.alloc(65536);
  let total = 0;
  for (;;) {
    let n;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e?.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
      if (e?.code === 'EOF') break;
      throw new Falha('stdin_ausente', `stdin ilegível (${e?.code ?? e?.message})`);
    }
    if (n === 0) break;
    total += n;
    if (total > STDIN_MAX) throw new Falha('stdin_invalido', `stdin passa de ${STDIN_MAX} bytes`);
    partes.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(partes).toString('utf8');
}

/** Texto do stdin ⇒ objeto. Vazio ⇒ `stdin_ausente`; não JSON e JSON não objeto ⇒ `stdin_invalido` (mensagens distintas). */
export function lerEntradaAgentes(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') throw new Falha('stdin_ausente', '--agentes sem JSON no stdin');
  let bruto;
  try { bruto = JSON.parse(texto); } catch (e) { throw new Falha('stdin_invalido', `stdin não é JSON (${String(e.message).split('\n')[0]})`); }
  if (!ehObj(bruto)) throw new Falha('stdin_invalido', 'stdin é JSON mas não é um objeto {sessao, agentes}');
  return bruto;
}

// ─────────────────────────────────────────────────────────────── transcript (cauda)

/**
 * Últimas `max` bytes do arquivo como linhas. Corte no meio de uma linha ⇒ descarta a 1ª (partida); corte exatamente depois de `\n` ⇒ MANTÉM.
 * Ausente, não abre ou erro de leitura ⇒ `null`; arquivo vazio ⇒ `[]`. Abre sem seguir link e sem bloquear (FIFO).
 */
export function lerCauda(caminho, max = CAUDA_MAX) {
  let fd;
  try {
    fd = openSync(caminho, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const size = st.size;
    if (size === 0) return [];
    const inicio = Math.max(0, size - max);
    // 1 byte a mais, antes da janela, para saber se o corte caiu no começo de uma linha
    const de = inicio > 0 ? inicio - 1 : 0;
    const buf = Buffer.alloc(size - de);
    let lido = 0;
    while (lido < buf.length) {
      const n = readSync(fd, buf, lido, buf.length - lido, de + lido);
      if (n === 0) break;
      lido += n;
    }
    let corpo = buf.subarray(0, lido);
    if (inicio > 0) {
      const partida = corpo[0] !== 0x0a;
      corpo = corpo.subarray(1);
      if (partida) {
        const i = corpo.indexOf(0x0a);
        corpo = i < 0 ? Buffer.alloc(0) : corpo.subarray(i + 1);
      }
    }
    return corpo.toString('utf8').split('\n').filter((l) => l !== '');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* já fechado */ } }
  }
}

/** O transcript do item só vale na forma `<abs>/subagents/agent-<id>.jsonl`, sem `..`, arquivo regular (nem link, nem FIFO). Senão `null`, sem abrir. */
function caminhoDoTranscript(item) {
  const t = item.transcript;
  if (typeof t !== 'string' || t === '' || t.includes('\0') || !isAbsolute(t)) return null;
  if (t.split(/[\\/]/).includes('..')) return null;
  if (basename(t) !== `agent-${item.id}.jsonl`) return null;
  if (basename(dirname(t)) !== 'subagents') return null;
  try {
    return lstatSync(t).isFile() ? t : null;
  } catch {
    return null;
  }
}

function usoDoItem(item) {
  const caminho = caminhoDoTranscript(item);
  if (caminho === null) return null;
  const linhas = lerCauda(caminho);
  return linhas === null ? null : usoDoTranscript(linhas);
}

// ─────────────────────────────────────────────────────────────── diário estável (D-M2)

function fotoDoDiario(dir) {
  let nomes;
  try {
    nomes = readdirSync(dir);
  } catch {
    return '';
  }
  return nomes
    .filter((n) => /^events\..+\.jsonl$/.test(n))
    .sort()
    .map((n) => {
      try { return `${n}:${lstatSync(join(dir, n)).size}`; } catch { return `${n}:?`; }
    })
    .join('|');
}

const dormirSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * `{eventos, motivo?}`: `eventos` é a lista, `[]` (nenhum arquivo) ou `null` (inválido LIDO ESTÁVEL; `motivo` diz por quê).
 * Instável nas 3 tentativas ⇒ `Falha('diario_em_escrita')`. `deps` troca o leitor, a foto, o sono e os números (testes).
 */
export function lerDiarioEstavel(dir, deps = {}) {
  const { ler = lerDiarioEstrito, foto = fotoDoDiario, dormir = dormirSync, tentativas = TENTATIVAS, intervaloMs = INTERVALO_MS } = deps;
  for (let i = 0; i < tentativas; i++) {
    const antes = foto(dir);
    let r;
    try {
      r = { eventos: ler(dir) };
    } catch (e) {
      if (typeof e?.erro !== 'string') throw e;
      r = { eventos: null, motivo: e.message };
    }
    if (foto(dir) === antes) return r;
    if (i < tentativas - 1) dormir(intervaloMs);
  }
  throw new Falha('diario_em_escrita', `o diário mudou durante a leitura ${tentativas} vezes seguidas (escrita em curso): tente de novo`);
}

// ─────────────────────────────────────────────────────────────── pacote de nomes

function lerPacoteDe(arquivo) {
  let texto;
  try { texto = readFileSync(arquivo, 'utf8'); } catch (e) { return { ok: false, erro: e?.code === 'ENOENT' ? 'não existe' : `ilegível (${e?.code ?? e?.message})` }; }
  let bruto;
  try { bruto = JSON.parse(texto); } catch { return { ok: false, erro: 'não é JSON' }; }
  return validarPacote(bruto);
}

/** `mod/temas/nomes/<p>.json`, senão `<raiz>/.harness/temas/nomes/<p>.json`; inválido ou inexistente ⇒ `terra-media` e aviso. */
function carregarPacote(nome, raiz, avisos) {
  const motivos = [];
  for (const arquivo of [join(MOD_NOMES, `${nome}.json`), ...(raiz === null ? [] : [join(raiz, '.harness', 'temas', 'nomes', `${nome}.json`)])]) {
    const r = lerPacoteDe(arquivo);
    if (r.ok) return r.pacote;
    motivos.push(r.erro);
  }
  if (nome === PACOTE_PADRAO) throw new Falha('pacote_fabrica_invalido', `o pacote de fábrica ${PACOTE_PADRAO} não valida (${motivos[0]})`);
  const distinto = motivos.find((m) => m !== 'não existe');
  avisos.push(`pacote "${nome}" ${distinto === undefined ? 'não existe' : `inválido (${distinto})`}: usando ${PACOTE_PADRAO}`);
  return carregarPacote(PACOTE_PADRAO, raiz, avisos);
}

// ─────────────────────────────────────────────────────────────── estado

const tituloDe = (bytes) => {
  for (const linha of bytes.toString('utf8').split('\n')) {
    const m = /^# (.+)$/.exec(linha.replace(/\r$/, ''));
    if (m !== null) return m[1].trim() === '' ? null : m[1].trim();
  }
  return null;
};

/**
 * Agentes do stdin ⇒ `AgenteVivo[]`. Item que não é objeto ou sem `id` string é descartado; `id` repetido fica o 1º. Não array ⇒ `null`.
 * `nomes` (já validado por `validarStdinAgentes`, FIEL-3 d): `{agent_id: {nome, vistoEm}}` do `$.store` do mod; o agente com entrada leva `nome` e `vistoEm`.
 */
function agentesDe(bruto, nomes = {}) {
  if (!Array.isArray(bruto)) return null;
  const vistos = new Set();
  const saida = [];
  for (const it of bruto) {
    if (!ehObj(it) || typeof it.id !== 'string' || it.id === '' || vistos.has(it.id)) continue;
    vistos.add(it.id);
    saida.push({
      id: it.id,
      type: typeof it.type === 'string' ? it.type : '',
      description: typeof it.description === 'string' ? it.description : '',
      status: typeof it.status === 'string' ? it.status : 'desconhecido', // status desconhecido conta como vivo
      uso: usoDoItem(it),
      ...(Object.hasOwn(nomes, it.id) ? { nome: nomes[it.id].nome, vistoEm: nomes[it.id].vistoEm } : {}),
    });
  }
  return saida;
}

function notificacaoDe(n) {
  if (!ehObj(n)) return null;
  if (typeof n.ts === 'string') return { ts: n.ts };
  if (typeof n.motivo === 'string') return { motivo: n.motivo };
  return null;
}

function modeloDoDiario(eventos) {
  if (eventos === null) return null;
  const o = ordenar(eventos);
  const lista = o.ok ? o.eventos : eventos;
  let modelo = null;
  for (const ev of lista) {
    if (ev?.tipo === 'custo.medicao' && ev.agente === 'orquestrador' && ehObj(ev.dados) && typeof ev.dados.modelo === 'string' && ev.dados.modelo !== '') modelo = ev.dados.modelo;
  }
  return modelo;
}

// ─────────────────────────────────────────────────────────────── fatos da trilha (GM-14 T18)

/** Nomes naturais das fontes (D-P13): o render os mostra em "não consegui ler <fonte>"; nunca nome de arquivo nem código. */
const FONTE = Object.freeze({ specs: 'as specs', medir: 'o registro de medição do painel', gh: 'o GitHub', entregas: 'a lista de entregas', diarioDe: (id) => `o diário da ${id}` });
const ausenteFs = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';

/** Branch do checkout da sessão; HEAD solto ou erro ⇒ `null` (não há branch a ler). */
function branchDe(cwd) {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/** `<ledgerDir>/<ID>.md` (padrão `docs/ledgers`), a mesma regra do `responder.mjs`. */
function temLedger(raiz, id, ledgerDir) {
  const dir = typeof ledgerDir === 'string' && ledgerDir !== '' && !ledgerDir.startsWith('/') && !ledgerDir.split('/').includes('..') ? ledgerDir : 'docs/ledgers';
  try { return lstatSync(join(raiz, dir, `${id}.md`)).isFile(); } catch { return false; }
}

/** Estado da entrega em palavras, só com fato: `N de M tasks integradas` | `tasks todas integradas`; sem `plano.json` legível ⇒ `null`. */
function estadoEmPalavras(dir, eventos) {
  let tasks;
  try {
    const j = JSON.parse(readFileSync(join(dir, 'plano.json'), 'utf8'));
    if (!ehObj(j) || !Array.isArray(j.tasks)) return null;
    tasks = j.tasks.map((t) => t?.id).filter((x) => typeof x === 'string');
  } catch {
    return null;
  }
  if (tasks.length === 0) return null;
  let n = 0;
  for (const id of tasks) {
    const r = estadoDe(eventos.filter((e) => TIPOS_DE_TASK.includes(e?.tipo) && e?.dados?.task === id));
    if (!('invalido' in r) && r.estado === 'integrada') n++;
  }
  return n === tasks.length ? 'tasks todas integradas' : `${n} de ${tasks.length} tasks integradas`;
}

/**
 * Pontos de atividade `{id, data}` (pendência T14/T15: a MESMA regra do `responder.mjs`): 1 por `ts` distinto de cada entrega de
 * `.harness/entregas/` fora das pastas `_*`. Diário ilegível ⇒ a fonte entra em `fontes` (nunca lista vazia calada). `ultima` = a de `ts` mais recente.
 * `diarios` (GM-15 T30, h.1): os eventos de cada entrega lida, para medir o fechamento das anteriores sem reler.
 */
function atividades(raiz, fontes) {
  const base = join(raiz, '.harness', 'entregas');
  let nomes;
  try {
    nomes = readdirSync(base).filter((n) => !n.startsWith('_')).sort();
  } catch (e) {
    if (!ausenteFs(e)) fontes.push(FONTE.entregas);
    return { ultimas: [], ultima: null, diarios: [] };
  }
  const ultimas = [];
  const diarios = [];
  let ultima = null;
  for (const id of nomes) {
    const dir = join(base, id);
    try { if (!lstatSync(dir).isDirectory()) continue; } catch { continue; }
    const lido = lerEstrito(dir);
    if (!lido.ok) { fontes.push(FONTE.diarioDe(id)); continue; }
    diarios.push({ id, eventos: lido.eventos });
    const vistos = new Set();
    let maior = null;
    for (const e of lido.eventos) {
      if (typeof e?.ts !== 'string' || vistos.has(e.ts)) continue;
      vistos.add(e.ts);
      ultimas.push({ id, data: e.ts });
      if (maior === null || e.ts > maior) maior = e.ts;
    }
    if (maior !== null && (ultima === null || maior > ultima.data)) ultima = { id, data: maior, dir, eventos: lido.eventos };
  }
  return { ultimas, ultima: ultima === null ? null : { id: ultima.id, estado: estadoEmPalavras(ultima.dir, ultima.eventos) }, diarios };
}

/** `gh` da entrega pelo `.harness/painel-medir.json` (T11; `estado` só lê): ausente ⇒ `nunca`; corrompido ⇒ `nunca` + fonte que falhou; `falhou` ⇒ o GitHub. */
function ghDe(raiz, chave, fontes) {
  let texto;
  try {
    texto = readFileSync(join(raiz, '.harness', 'painel-medir.json'), 'utf8');
  } catch (e) {
    if (!ausenteFs(e)) fontes.push(FONTE.medir);
    return 'nunca';
  }
  let j;
  try { j = JSON.parse(texto); } catch { fontes.push(FONTE.medir); return 'nunca'; }
  if (!ehObj(j)) { fontes.push(FONTE.medir); return 'nunca'; }
  const it = j[chave];
  if (it === undefined) return 'nunca';
  if (!ehObj(it) || (it.gh !== 'ok' && it.gh !== 'falhou')) { fontes.push(FONTE.medir); return 'nunca'; }
  if (it.gh === 'falhou') fontes.push(FONTE.gh);
  return it.gh;
}

/**
 * GM-15 T33 (g.17): o pacote de nomes vigente da sessão, de onde o mod o grava (`.harness/contexto/<sessao>.json`, campo `pacote`). A sessão dada (`--sessao` ou o
 * `session_id` do mod) vale com qualquer idade; sem ela, só a leitura mais recente do mod (`fonte: mod`, até 10 min). Fora da forma, ilegível ou ausente ⇒ `null`.
 */
const JANELA_PACOTE_MS = 600_000;
function pacoteVigente(raiz, sessao, agoraMs) {
  const dir = join(raiz, '.harness', 'contexto');
  const ler = (arq) => {
    try {
      const j = JSON.parse(readFileSync(arq, 'utf8'));
      return ehObj(j) && typeof j.pacote === 'string' && PACOTE_RE.test(j.pacote) ? { pacote: j.pacote, fonte: j.fonte, emMs: Date.parse(j.em) } : null;
    } catch { return null; }
  };
  if (typeof sessao === 'string' && SESSAO_RE.test(sessao)) return ler(join(dir, `${sessao}.json`))?.pacote ?? null;
  let melhor = null;
  let nomes = [];
  try { nomes = readdirSync(dir); } catch { return null; }
  for (const n of nomes) {
    if (!/^[A-Za-z0-9-]{1,128}\.json$/.test(n)) continue;
    const l = ler(join(dir, n));
    if (l !== null && l.fonte === 'mod' && Number.isFinite(l.emMs) && agoraMs - l.emMs <= JANELA_PACOTE_MS && l.emMs - agoraMs <= 5_000 && (melhor === null || l.emMs > melhor.emMs)) melhor = l;
  }
  return melhor === null ? null : melhor.pacote;
}

/** A medição do pouso de `loop.mjs proxima` (`medicaoDoPouso`) para a sessão do painel, mais a de cada sessão que retomou depois do pouso (`sessoesDeRetomada`). */
function medicaoDoPainel(raiz, sessao, x, eventos, agoraMs) {
  const m = medicaoDoPouso(raiz, sessao, x, agoraMs);
  for (const id of sessoesDeRetomada(eventos)) m.leituras.push(...medicaoDoPouso(raiz, id, x, agoraMs).leituras);
  return m;
}

/** `session_id` do mod (stdin de `--agentes`), a mesma leitura do `medir`; sem ele a trilha nunca liga por resposta (falha fechada). */
function sessaoDoMod(agentes) {
  const s = agentes?.session_id ?? agentes?.sessao?.session_id;
  return typeof s === 'string' && s !== '' ? s : null;
}

/**
 * T47: a projeção de uma entrega NÃO identificada (publicada) mostra o que o plano ausente mostraria (sem PRONTO, `modo`/`id`/`fase` da trilha,
 * `plano` vazio) e mantém do cálculo com o plano o que depende de casar eventos e vivos com as tasks (parar, AGORA, depende, atenção, recente).
 * `comPlano` e `semPlano` vêm do mesmo `projetar`, com as mesmas entradas.
 */
function semPlanoNaApresentacao(comPlano, semPlano, entrada) {
  if (!ehObj(comPlano) || !ehObj(semPlano)) return comPlano;
  const saida = { ...comPlano, modo: semPlano.modo, id: semPlano.id, pronto: semPlano.pronto, fase: semPlano.fase, plano: semPlano.plano };
  // o sufixo da FASE diz o que o AGORA diz: a ação do vivo casado (do cálculo com o plano), não a descrição crua do vivo sem task
  const crua = semPlano.agora?.agentes?.[0]?.acao;
  const casada = comPlano.agora?.agentes?.[0]?.acao;
  if (ehObj(saida.fase) && Array.isArray(saida.fase.sufixo) && typeof crua === 'string' && typeof casada === 'string') {
    const tira = (a) => a.replace(/ \(registrado\)$/, '');
    saida.fase = { ...saida.fase, sufixo: saida.fase.sufixo.map((x) => (typeof x === 'string' && x.endsWith(`: ${tira(crua)}`) ? `${x.slice(0, x.length - tira(crua).length)}${tira(casada)}` : x)) };
  }
  // a MESMA regra de `projetarNovo` (painel.ts), sobre o estado do cálculo com o plano e o `modo` da apresentação
  saida.umaLinha = umaLinhaDe(saida, entrada?.ultima);
  return saida;
}

/**
 * Monta o estado do painel. `opts`: `agentes` (objeto do stdin; ausente = sem `--agentes`, equipe só do diário), `pacote`, `entrega`, `agoraMs`
 * (um só `Date.now()` por execução), `env` (padrão `process.env`), `fuso`, `diario` (deps de `lerDiarioEstavel`), `preparar` (troca `prepararLeitura`, para contar chamadas) e `projetar` (troca `projetarPainel`, para ler a entrada). Nunca lança: `{ok:true, estado, avisos}`
 * ou `{ok:false, erro, mensagem}`.
 *
 * GM-14 T18 (REQ-GLB-1, FIEL-10 b/e): num repo git NUNCA devolve `sem_loop`/`plano_ausente`/`entrega_nao_inferida`. Sem plano ⇒ FASE pela trilha;
 * branch sem ID ⇒ diário de `_sem-id`; fora de repo ⇒ `modo: 'fora'`. Sempre passa `fatos` (FatosTrilha: branch, idPadrao, specs de `lerSpecs`,
 * plano, ledger, gh de `painel-medir.json`, `ultimas`, `sessao` do stdin) a `projetarPainel` e as fontes que falharam em `fontesFalhas`.
 */
export function estadoDoPainel(cwd, opts = {}) {
  const avisos = [];
  try {
    const agoraMs = opts.agoraMs ?? Date.now();
    const env = opts.env ?? process.env;
    const fontes = [];

    // raiz e entrega: fora de repo ⇒ `fora`; branch sem ID ⇒ `_sem-id` (a mesma regra de raiz do loop)
    let raiz = null;
    try {
      raiz = contexto(cwd, { entrega: opts.entrega ?? '_sem-id' }).raiz;
    } catch (e) {
      if (e?.erro !== 'fora_de_repo') throw e;
    }
    const origin = raiz === null ? { cfg: null, fonte: 'nenhuma', invalida: false } : lerConfigOrigin(raiz);
    if (origin.invalida === true) avisos.push(`config de origin/HEAD inválida (${origin.motivo})`);
    const idPadrao = idPadraoDe(raiz ?? cwd); // a regra do loop (lib/config.mjs), sem cópia
    const branch = raiz === null ? null : branchDe(cwd);
    const id = opts.entrega ?? idDaBranch(branch, idPadrao);
    const c = raiz === null ? null : { cwd, raiz, entrega: id ?? '_sem-id', dirEntrega: dirEntrega(raiz, id ?? null), sessao: 'loop' };

    let plano = null;
    if (c !== null && id !== null) {
      try {
        plano = carregarPlano(c);
      } catch (e) {
        if (e?.erro !== 'plano_ausente') throw e;
      }
    }
    const lido = c === null ? { eventos: [] } : lerDiarioEstavel(c.dirEntrega, opts.diario);
    const eventos = lido.eventos;

    // DP-3 aj. 4: specs (com e sem plano) do checkout da sessão, o mesmo de `aprovarSpec`/`lerSpecs` do loop; diário na raiz principal
    const sessaoRaiz = raiz === null ? null : checkoutDaSessao(cwd);
    let specs = [];
    if (raiz !== null) {
      try { specs = lerSpecs(sessaoRaiz, idPadrao); } catch (e) { if (typeof e?.erro !== 'string') throw e; fontes.push(FONTE.specs); }
    }
    const ativ = raiz === null ? { ultimas: [], ultima: null, diarios: [] } : atividades(raiz, fontes);
    // GM-15 T8 (REQ-ENT-1 d): a entrega encerrada que o painel mostra: a da branch (ou `--entrega`); sem ela, a última conhecida (a do "sem entrega em
    // curso · última"). A próxima: spec com PBI sem encerramento mais nova ⇒ ideias anotadas na entregue ⇒ nenhuma (regra de `proximaEntrega`).
    const daEntregue = id !== null ? { id, eventos } : ativ.ultima === null ? null : { id: ativ.ultima.id, eventos: ativ.diarios.find((x) => x.id === ativ.ultima.id)?.eventos ?? null };
    const entregue = daEntregue === null ? null : entregueDe(daEntregue.eventos, daEntregue.id);
    const encerradas = new Set(ativ.diarios.filter((x) => encerramentoDe(x.eventos, x.id).encerrada).map((x) => x.id));
    const proxima = entregue === null ? null : proximaEntrega(specs, encerradas, daEntregue.eventos);
    const gh = raiz === null ? 'nunca' : ghDe(raiz, id !== null && c.dirEntrega.endsWith(id) ? id : '_sem-id', fontes);
    const sessaoMod = sessaoDoMod(opts.agentes);
    const fatos = {
      branch, idPadrao, specs, plano: plano === null ? null : { tasks: plano.tasks.map((t) => t.id) },
      ledger: raiz !== null && id !== null && temLedger(raiz, id, origin.cfg?.fluxo?.ledgerDir), gh, ultimas: ativ.ultimas, sessao: sessaoMod,
    };

    // FIEL-1 b / spec:53: sem `--entrega`, o plano só entra na projeção quando a trilha liga a entrega (PR mergeado com a branch sozinha não liga:
    // nada de PRONTO "N de N integradas" de uma entrega não identificada; a trilha segue vendo o plano em `fatos`)
    // T47: o plano descartado segue sendo o que casa os eventos de task do diário e os vivos (FIEL-3 a): sem ele, T1 não está no plano e o diário vira
    // `diario_invalido`. Ele só não aparece em PRONTO/modo/id/fase (a regra de "publicada" é a de `trilhaDe`, a única).
    const planoDoDiario = plano;
    const descartado = plano !== null && opts.entrega === undefined && eventos !== null && trilhaDe(fatos, eventos).identificada !== true;
    if (descartado) plano = null;

    // spec: sha e título dos MESMOS bytes (com plano: `plano.spec`; sem plano: a única de `lerSpecs` com o PBI da entrega)
    let specSha = null;
    let titulo = null;
    if (plano !== null && typeof plano.spec === 'string' && plano.spec !== '') {
      const s = lerSpec(sessaoRaiz, plano);
      if (s.ok) { specSha = s.sha256; titulo = tituloDe(s.bytes); } else avisos.push(`spec: ${s.erro} (${s.mensagem})`);
    } else if (id !== null) {
      const daEntrega = specs.filter((s) => s.pbi === id);
      if (daEntrega.length === 1 && daEntrega[0].titulo !== '') titulo = daEntrega[0].titulo;
    }

    // origem: teto da Sombra e política
    const teto = tetoDaSombra(origin);
    if (teto.aviso !== undefined) avisos.push(teto.aviso);
    const config = lerConfigEntrega(origin.cfg);
    avisos.push(...config.erros);
    const efetiva = politicaEfetiva(config, plano?.politica_entrega);
    if (!efetiva.ok) avisos.push(`política de entrega: ${efetiva.mensagem}`);
    const politica = efetiva.ok
      ? { politica: efetiva.politica, dias: efetiva.janela?.dias ?? null }
      : { politica: config.politica, dias: config.janela?.dias ?? null };

    // fuso do processo
    const fusoBruto = opts.fuso !== undefined ? opts.fuso : Intl.DateTimeFormat().resolvedOptions().timeZone;
    let fuso = 'UTC';
    if (typeof fusoBruto === 'string' && fusoBruto !== '' && fusoValido(fusoBruto) === fusoBruto) fuso = fusoBruto;
    else avisos.push(`fuso ${JSON.stringify(fusoBruto ?? null)} ausente ou inválido: usando UTC`);

    // stdin (só quando o chamador passou --agentes)
    const comAgentes = opts.agentes !== undefined && opts.agentes !== null;
    const sessao = comAgentes && ehObj(opts.agentes.sessao) ? opts.agentes.sessao : {};
    // FIEL-3 d, FIEL-6 a, FIEL-11: `nomes`, `encerrados`, `acoes`, `segundoPlano`; ausente = vazio, fora do contrato = falha (nunca vazio calado)
    const extras = comAgentes ? validarStdinAgentes(opts.agentes) : null;
    if (extras !== null && !extras.ok) throw new Falha('stdin_invalido', extras.erro);
    const agentes = comAgentes ? agentesDe(opts.agentes.agentes, extras.valor.nomes) : null;

    // x: o do stdin vence o do env (o mod conhece o X que ele passa)
    const xBruto = sessao.x === undefined || sessao.x === null ? env.GABARITO_POUSO_X : typeof sessao.x === 'number' ? String(sessao.x) : typeof sessao.x === 'string' ? sessao.x : '?';
    const x = lerX(xBruto);
    if (x.aviso !== null) avisos.push(x.aviso);

    // pacote: flag > stdin > terra-media
    let nomePacote = PACOTE_PADRAO;
    if (opts.pacote !== undefined) nomePacote = opts.pacote;
    else if (typeof sessao.pacote === 'string') {
      if (PACOTE_RE.test(sessao.pacote)) nomePacote = sessao.pacote;
      else avisos.push(`sessao.pacote ${JSON.stringify(sessao.pacote.slice(0, 40))} fora da forma: usando ${PACOTE_PADRAO}`);
    } else if (raiz !== null) {
      // g.17: sem pacote no pedido, o da sessão (o que o mod gravou), não o de fábrica
      nomePacote = pacoteVigente(raiz, opts.sessao ?? sessaoMod, agoraMs) ?? PACOTE_PADRAO;
    }
    const pacote = carregarPacote(nomePacote, raiz, avisos);

    // decisão de entrega: só com plano e o loop em `concluir` (custo); sem efeito
    let decisaoEntrega = null;
    if (plano !== null && eventos !== null && eventos.length > 0) {
      const ord = ordenar(eventos);
      if (ord.ok && proximaAcao(plano, eventos, SINAIS_NEUTROS).tipo === 'concluir') {
        const r = (opts.preparar ?? prepararLeitura)(cwd, { entrega: c.entrega, agoraMs });
        if (r.ok) decisaoEntrega = decisaoDe(r.p);
        else if (r.erro !== 'entrega_em_curso' && r.erro !== 'entrega_incompleta') avisos.push(`decisão de entrega não lida: ${r.erro} (${r.mensagem})`);
      }
    }

    // GM-15 T33 (emenda 5): a MESMA medição do `loop.mjs proxima` (`medicaoDoPouso`): a leitura própria da sessão que pergunta (`--sessao`, senão o `session_id` do mod),
    // fresca até 120 s; mais a leitura das sessões que retomaram depois do pouso (g.18). Sem sessão ou fora de repo ⇒ sem medição ⇒ a regra sem mod.
    const sessaoPouso = opts.sessao ?? sessaoMod;
    const medicaoPouso = raiz === null || sessaoPouso === null ? undefined : medicaoDoPainel(raiz, sessaoPouso, x.x, eventos, agoraMs);
    const entrada = {
      decisaoEntrega,
      pausado: c === null ? false : pausado(c),
      contexto: { percent: numero(sessao.percent), tokens: numero(sessao.tokens), window: numero(sessao.window) },
      limites: { h5: numero(sessao.h5), d7: numero(sessao.d7) },
      x: x.x,
      agentes,
      ...(extras !== null ? { encerrados: extras.valor.encerrados, acoes: extras.valor.acoes, segundoPlano: extras.valor.segundoPlano } : {}),
      pacote,
      notificacao: notificacaoDe(sessao.notificacao),
      agoraMs,
      fuso,
      titulo,
      politica,
      entregaId: plano !== null ? c.entrega : id,
      modeloSessao: modeloDoDiario(eventos),
      specSha,
      tetoSombra: teto.teto,
      fatos,
      fontesFalhas: fontes,
      fora: raiz === null,
      onboarding: raiz !== null && temOnboarding(raiz), // FIEL-14 h: o mesmo critério e a mesma leitura do cartão (config LOCAL)
      ultima: ativ.ultima,
      // h.1: o fechamento medido nas entregas anteriores do repo (da última integrada ao merge na main); sem medida ⇒ `null` e a faixa abre em "?"
      fechamentoS: fechamentoDasAnteriores(ativ.diarios, id),
      // Emenda 3: as etapas das entregas anteriores, para a previsão com menos de 3 integradas nesta entrega
      etapasAnteriores: etapasDasAnteriores(ativ.diarios, id),
      // ... e o ritmo delas (relógio por task integrada); sem ritmo medido o fallback mostra "?" (r2 MAJOR 1)
      ritmoAnterioresS: ritmoDasAnteriores(ativ.diarios, id),
      ...(medicaoPouso !== undefined ? { medicaoPouso } : {}),
      entregue,
      proxima,
      // r1 MAJOR-2: a entregue só zera o diário projetado quando é a dele (branch com ID ou `--entrega`); a última conhecida não zera o `_sem-id`
      entregueDoDiario: id !== null,
    };
    const projetar = opts.projetar ?? projetarPainel;
    const estado = projetar(descartado ? planoDoDiario : plano, eventos, entrada);
    return { ok: true, estado: descartado ? semPlanoNaApresentacao(estado, projetar(null, eventos, entrada), entrada) : estado, avisos };
  } catch (e) {
    if (e instanceof Falha || typeof e?.erro === 'string') return { ok: false, erro: e.erro, mensagem: e.message };
    return { ok: false, erro: 'erro_interno', mensagem: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}

// ─────────────────────────────────────────────────────────────── main

/** `io` troca a saída, o aviso, o stdin (função ⇒ texto) e o relógio (testes em processo). */
export function main(argv, cwd = process.cwd(), io = {}) {
  const saida = io.saida ?? ((t) => process.stdout.write(t));
  const aviso = io.aviso ?? ((t) => process.stderr.write(t));
  const falha = (e) => {
    const erro = e instanceof Falha || typeof e?.erro === 'string' ? e : new Falha('erro_interno', String(e instanceof Error ? e.message : e).slice(0, 200));
    saida(`${JSON.stringify({ ok: false, erro: erro.erro, mensagem: erro.message })}\n`);
    return erro.rc ?? 1;
  };
  try {
    const { cmd, flags } = lerArgs(argv);
    if (cmd === 'medir') {
      // GM-14 T1: só o despacho. A T11 lê o stdin de `--agentes` e grava; o stub lança antes de qualquer leitura ou escrita.
      const r = medir(cwd, { agentes: flags.agentes === true });
      saida(`${JSON.stringify(r)}\n`);
      return r?.ok === true ? 0 : 1;
    }
    const agentes = flags.agentes === true ? lerEntradaAgentes((io.stdin ?? lerStdin)()) : undefined;
    const r = estadoDoPainel(cwd, { agentes, pacote: flags.pacote, entrega: flags.entrega, sessao: flags.sessao, agoraMs: io.agoraMs });
    if (!r.ok) return falha(new Falha(r.erro, r.mensagem));
    if (cmd === 'estado') {
      saida(`${JSON.stringify({ ok: true, estado: r.estado, avisos: r.avisos })}\n`);
      return 0;
    }
    const texto = paraTexto(
      renderPainel(r.estado, { preset: flags.preset ?? 'esquadrao', tema: flags.tema ?? 'mono', narracao: true, largura: flags.largura === undefined ? 80 : Number(flags.largura) }),
      flags.tema ?? 'mono',
    );
    for (const a of r.avisos) aviso(`painel: aviso: ${a}\n`);
    saida(`${texto}\n`);
    return 0;
  } catch (e) {
    return falha(e);
  }
}

if (ehEntrypoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));

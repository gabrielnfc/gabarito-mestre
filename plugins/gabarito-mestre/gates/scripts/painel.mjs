#!/usr/bin/env node
/**
 * Painel (E4, GM-12, T9): CLI de LEITURA. Única borda de E/S do painel; o núcleo (`dist/painel*.js`) é puro.
 *
 *   painel.mjs estado [--agentes] [--pacote <nome>] [--entrega <ID>]
 *   painel.mjs texto  [--largura N] [--preset esquadrao|executivo] [--tema color|mono] [--pacote <nome>] [--agentes] [--entrega <ID>]
 *   painel.mjs medir  [--agentes]   (GM-14 REQ-DIA-1: o ÚNICO subcomando que grava, e só `fato.medido`; em `painel-medir.mjs`. A T1 só liga o
 *                                    despacho: devolve `nao_implementado`, rc 1, nada lido do stdin nem gravado; a T11 implementa)
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
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readFileSync, readdirSync } from 'node:fs';
import { isatty } from 'node:tty';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';
import { lerConfigOrigin } from '../lib/config.mjs';
import { lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { ordenar, proximaAcao } from '../dist/loop.js';
import { projetarPainel, renderPainel } from '../dist/painel.js';
import { validarPacote, usoDoTranscript } from '../dist/painel-equipe.js';
import { fusoValido } from '../dist/painel-hora.js';
import { paraTexto } from '../dist/painel-texto.js';
import { lerX } from '../dist/pouso.js';
import { carregarPlano, contexto, lerDiarioEstrito, lerSpec, tetoDaSombra } from './loop.mjs';
import { decisaoDe, pausado, prepararLeitura } from './entrega.mjs';
import { medir } from './painel-medir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MOD_NOMES = join(AQUI, '..', '..', 'mod', 'temas', 'nomes');
const PACOTE_PADRAO = 'terra-media';
const PACOTE_RE = /^[a-z0-9-]{1,32}$/;
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const LARGURA_RE = /^[1-9]\d{0,5}$/;
const PRESETS = ['esquadrao', 'executivo'];
const TEMAS = ['color', 'mono'];
const CAUDA_MAX = 262144;
const STDIN_MAX = 4 * 1024 * 1024;
const TENTATIVAS = 3;
const INTERVALO_MS = 50;
const SINAIS_NEUTROS = { slots: 1, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false };
const USO = 'uso: painel.mjs estado [--agentes] [--pacote <nome>] [--entrega <ID>] | painel.mjs texto [--largura N] [--preset esquadrao|executivo] [--tema color|mono] [--pacote <nome>] [--agentes] [--entrega <ID>] | painel.mjs medir [--agentes]';

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
  const COM_VALOR = cmd === 'texto' ? ['largura', 'preset', 'tema', 'pacote', 'entrega'] : cmd === 'medir' ? [] : ['pacote', 'entrega'];
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
  for (const arquivo of [join(MOD_NOMES, `${nome}.json`), join(raiz, '.harness', 'temas', 'nomes', `${nome}.json`)]) {
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

/** Agentes do stdin ⇒ `AgenteVivo[]`. Item que não é objeto ou sem `id` string é descartado; `id` repetido fica o 1º. Não array ⇒ `null`. */
function agentesDe(bruto) {
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

/**
 * Monta o estado do painel. `opts`: `agentes` (objeto do stdin; ausente = sem `--agentes`, equipe só do diário), `pacote`, `entrega`, `agoraMs`
 * (um só `Date.now()` por execução), `env` (padrão `process.env`), `fuso`, `diario` (deps de `lerDiarioEstavel`) e `preparar` (troca `prepararLeitura`, para contar chamadas). Nunca lança: `{ok:true, estado, avisos}`
 * ou `{ok:false, erro, mensagem}`.
 */
export function estadoDoPainel(cwd, opts = {}) {
  const avisos = [];
  try {
    const agoraMs = opts.agoraMs ?? Date.now();
    const env = opts.env ?? process.env;
    const c = contexto(cwd, { entrega: opts.entrega });
    const plano = carregarPlano(c);
    const lido = lerDiarioEstavel(c.dirEntrega, opts.diario);
    const eventos = lido.eventos;

    // spec: sha e título dos MESMOS bytes
    let specSha = null;
    let titulo = null;
    if (typeof plano.spec === 'string' && plano.spec !== '') {
      const s = lerSpec(c.raiz, plano);
      if (s.ok) { specSha = s.sha256; titulo = tituloDe(s.bytes); } else avisos.push(`spec: ${s.erro} (${s.mensagem})`);
    }

    // origem: teto da Sombra e política
    const origin = lerConfigOrigin(c.raiz);
    if (origin.invalida === true) avisos.push(`config de origin/HEAD inválida (${origin.motivo})`);
    const teto = tetoDaSombra(origin);
    if (teto.aviso !== undefined) avisos.push(teto.aviso);
    const config = lerConfigEntrega(origin.cfg);
    avisos.push(...config.erros);
    const efetiva = politicaEfetiva(config, plano.politica_entrega);
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
    const agentes = comAgentes ? agentesDe(opts.agentes.agentes) : null;

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
    }
    const pacote = carregarPacote(nomePacote, c.raiz, avisos);

    // decisão de entrega: só com o loop em `concluir` (custo); sem efeito
    let decisaoEntrega = null;
    if (eventos !== null && eventos.length > 0) {
      const ord = ordenar(eventos);
      if (ord.ok && proximaAcao(plano, eventos, SINAIS_NEUTROS).tipo === 'concluir') {
        const r = (opts.preparar ?? prepararLeitura)(cwd, { entrega: c.entrega, agoraMs });
        if (r.ok) decisaoEntrega = decisaoDe(r.p);
        else if (r.erro !== 'entrega_em_curso' && r.erro !== 'entrega_incompleta') avisos.push(`decisão de entrega não lida: ${r.erro} (${r.mensagem})`);
      }
    }

    const entrada = {
      decisaoEntrega,
      pausado: pausado(c),
      contexto: { percent: numero(sessao.percent), tokens: numero(sessao.tokens), window: numero(sessao.window) },
      limites: { h5: numero(sessao.h5), d7: numero(sessao.d7) },
      x: x.x,
      agentes,
      pacote,
      notificacao: notificacaoDe(sessao.notificacao),
      agoraMs,
      fuso,
      titulo,
      politica,
      entregaId: c.entrega,
      modeloSessao: modeloDoDiario(eventos),
      specSha,
      tetoSombra: teto.teto,
    };
    return { ok: true, estado: projetarPainel(plano, eventos, entrada), avisos };
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
    const r = estadoDoPainel(cwd, { agentes, pacote: flags.pacote, entrega: flags.entrega, agoraMs: io.agoraMs });
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

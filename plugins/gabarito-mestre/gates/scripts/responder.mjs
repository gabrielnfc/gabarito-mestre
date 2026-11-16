#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` do comando humano `/gabarito-mestre:responder <sessao>:<seq> <n>` (GM-14 T14, REQ-PRG-1): grava `dono.resposta`.
 *
 * É o único caminho que fecha uma pergunta do painel. O modelo não chega aqui: a skill tem `disable-model-invocation: true`. Adaptador
 * fino no desenho de `aprovar-spec.mjs`: a regra de "pergunta aberta" e de "resposta válida" é de `perguntas.ts` (`perguntasAbertas`,
 * `respostaValida`), importada de `dist/`, nunca copiada; este arquivo só lê o repositório, escolhe o diário e grava.
 *
 * Decisão, na ordem:
 *   stdin ausente, não JSON ou não objeto ... block
 *   `command_name` diferente do comando ..... sai 0 calado, sem efeito
 *   `agent_id` presente (subagent) ........... block
 *   `command_args` não texto, vazio ou acima de 2000 caracteres ... block (o teto vale antes de qualquer regex)
 *   id `herdar:<hex>` ........................ block: a herança não é respondida por este comando (nunca aceita)
 *   args = `<id> <n>` (separadores: espaço, tab, quebra de linha; as pontas são aparadas, então "3:4  2\n" = "3:4 2") ⇒ resposta por botão
 *   qualquer coisa a mais (3+ palavras, ou a 2ª não é inteiro) ⇒ resposta digitada: só se o id é de pergunta ABERTA grava
 *       `dono.resposta {pergunta, sha256, chars}` dos args crus (o texto nunca entra no diário; essa forma não fecha pergunta) e devolve
 *       block "resposta não reconhecida"; id que não é de pergunta aberta ⇒ block sem gravar nada
 *   id só (sem número) ⇒ block, nada gravado
 * Onde procurar o id: no diário da entrega da branch (`idDaBranch`, se a pasta existe) e em `_sem-id`. Aberta nos dois ⇒ block
 * ("existe nos dois"); em nenhum ⇒ block `inexistente` ou `respondida`. Diário que existe e não passa em `lerEstrito` ⇒ block (ausente
 * não é corrompido; falha nunca vira sucesso). Contexto de `perguntasAbertas` = `{sessao: session_id do stdin, ultimas}` (1 ponto de
 * atividade `{id, data}` por evento, de cada entrega fora `_*`), o mesmo que o painel passa: as opções (e o rótulo gravado) saem da
 * MESMA lista que o dono viu. O rótulo vem SEMPRE da opção da pergunta, nunca do argumento.
 * Gravação: confere de novo logo antes do `append`, grava `{pergunta, opcao, rotulo}`, relê com `lerEstrito` e só então sai 0
 * (a pergunta tem de ter sumido das abertas e a resposta ser a única).
 *
 * Limite declarado (como `aprovarSpec`, `loop.mjs`): sem lock entre sessões, duas sessões que respondem no mesmo instante podem gravar 2
 * respostas; o hook detecta pela releitura e devolve block dizendo que há 2 (a primeira é a que `trilha.ts` usa para ligar a
 * entrega). Sob o mesmo usuário de SO, `node -e` com `diario.append` grava um evento válido; o núcleo não distingue (Q14).
 * O repositório vem do `cwd` do stdin, nunca de variável de ambiente.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ehEntrypoint } from '../lib/cli.mjs';
import { lerConfig } from '../lib/config.mjs';
import { PADROES } from '../lib/git.mjs';
import * as diario from '../dist/diario.js';
import { ID_PERGUNTA_RE } from '../dist/formas.js';
import { adiamentoValido, impressaoDoLote, loteRecomendadas, perguntasAbertas, respostaValida } from '../dist/perguntas.js';
import { lerX, pedidoDeClear, rotuloAdiamentoClear } from '../dist/pouso.js';
import { medicaoDoPouso } from './loop.mjs';
import { idDaBranch, trilhaDe } from '../dist/trilha.js';

/** Falha com código: o despachante a devolve como `{ok:false, erro, ...}` e rc 1. */
export class Falha extends Error {
  constructor(erro, mensagem) {
    super(mensagem);
    this.erro = erro;
  }
}

const COMANDO = 'gabarito-mestre:responder';
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_PADRAO = 'dono';
const ARGS_MAX = 2000;
const OPCAO_RE = /^[1-9][0-9]{0,8}$/;
const SPEC_MAX = 4 * 1024 * 1024;

const bloquear = (reason, prefixo = 'Resposta recusada') => ({ decision: 'block', reason: `${prefixo}: ${reason}` });
const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const ausente = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function raizPrincipal(cwd) {
  const comum = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const real = realpathSync(comum);
  if (basename(real) !== '.git') throw new Falha('repo_nao_suportado', `git-common-dir inesperado (${real})`);
  return dirname(real);
}

/** `docs/superpowers/specs/*.md` com `PBI: <ID>` nas 15 primeiras linhas. Ausente ⇒ []; ilegível ⇒ lança (falha, não "sem spec"). */
function lerSpecs(raiz) {
  const dir = join(raiz, 'docs', 'superpowers', 'specs');
  let nomes;
  try {
    nomes = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch (e) {
    if (ausente(e)) return [];
    throw new Falha('specs_ilegiveis', `não consegui listar as specs (${e.code ?? 'erro'})`);
  }
  const specs = [];
  for (const nome of nomes) {
    const arq = join(dir, nome);
    let st;
    try { st = lstatSync(arq); } catch (e) { throw new Falha('specs_ilegiveis', `não consegui ler ${nome} (${e.code ?? 'erro'})`); }
    if (!st.isFile() || st.size > SPEC_MAX) continue;
    let bytes;
    try { bytes = readFileSync(arq); } catch (e) { throw new Falha('specs_ilegiveis', `não consegui ler ${nome} (${e.code ?? 'erro'})`); }
    const linhas = bytes.toString('utf8').split('\n');
    let pbi = null;
    for (const l of linhas.slice(0, 15)) {
      const m = /(?:^|[\s·|])PBI:\s*([A-Za-z0-9-]+)/.exec(l.slice(0, 400));
      if (m) { pbi = m[1]; break; }
    }
    const t = linhas.find((l) => l.startsWith('# '));
    specs.push({
      caminho: `docs/superpowers/specs/${nome}`, pbi, sha256: createHash('sha256').update(bytes).digest('hex'),
      secoes: linhas.filter((l) => l.startsWith('## ')).length, titulo: t === undefined ? '' : t.slice(2).trim(),
    });
  }
  return specs;
}

function lerPlano(raiz, id) {
  try {
    const j = JSON.parse(readFileSync(join(raiz, '.harness', 'entregas', id, 'plano.json'), 'utf8'));
    return ehObj(j) && Array.isArray(j.tasks) ? { tasks: j.tasks.map((t) => t?.id).filter((x) => typeof x === 'string') } : null;
  } catch {
    return null;
  }
}

function temLedger(raiz, id, ledgerDir) {
  const dir = typeof ledgerDir === 'string' && ledgerDir !== '' && !ledgerDir.startsWith('/') && !ledgerDir.split('/').includes('..') ? ledgerDir : 'docs/ledgers';
  try { return lstatSync(join(raiz, dir, `${id}.md`)).isFile(); } catch { return false; }
}

/** Pontos de atividade `{id, data}`: 1 por evento de cada entrega (pastas `_*` fora). Diário ilegível ⇒ lança. */
function atividades(raiz) {
  const base = join(raiz, '.harness', 'entregas');
  let nomes;
  try {
    nomes = readdirSync(base).filter((n) => !n.startsWith('_')).sort();
  } catch (e) {
    if (ausente(e)) return [];
    throw new Falha('diario_ilegivel', `não consegui listar as entregas (${e.code ?? 'erro'})`);
  }
  const pontos = [];
  for (const id of nomes) {
    const lido = diario.lerEstrito(join(base, id));
    if (!lido.ok) {
      // pasta sem diário (nem `events.*`) é só pasta: lerEstrito lista vazia como ok; erro de verdade lança
      throw new Falha('diario_ilegivel', `o diário de ${id} não passa na leitura estrita (${lido.motivo})`);
    }
    const vistos = new Set();
    for (const e of lido.eventos) {
      if (typeof e?.ts !== 'string' || vistos.has(e.ts)) continue;
      vistos.add(e.ts);
      pontos.push({ id, data: e.ts });
    }
  }
  return pontos;
}

/** Diários onde a pergunta pode estar: o da entrega da branch (se a pasta existe) e `_sem-id`. */
function diarios(raiz, branch, idPadrao) {
  const out = [];
  const id = idDaBranch(branch, idPadrao);
  const dirEntrega = diario.dirEntrega(raiz, id);
  const semId = diario.dirEntrega(raiz, null);
  if (dirEntrega !== semId) out.push({ rotulo: id, dir: dirEntrega });
  out.push({ rotulo: '_sem-id', dir: semId });
  return out;
}

/**
 * Os diários onde a pergunta pode estar (`diarios`), cada um lido com `lerEstrito` e com as perguntas abertas pelo MESMO contexto do painel.
 * Pasta ausente não entra; diário ilegível lança `Falha` (ausente não é corrompido). `[{rotulo, dir, eventos, abertas}]`.
 */
function lerDiarios(raiz, ctxHook) {
  const cfg = lerConfig(raiz).cfg;
  const idPadrao = typeof cfg?.fluxo?.idPadrao === 'string' ? cfg.fluxo.idPadrao : PADROES.idPadrao;
  let branch = null;
  try { branch = git(ctxHook.cwd, 'rev-parse', '--abbrev-ref', 'HEAD') || null; } catch { /* sem branch: só `_sem-id` */ }
  const ultimas = atividades(raiz);
  const specs = lerSpecs(raiz);
  const ctx = { sessao: ctxHook.sessao, ultimas };
  const lidos = [];
  for (const d of diarios(raiz, branch, idPadrao)) {
    try { lstatSync(d.dir); } catch (e) { if (ausente(e)) continue; throw new Falha('diario_ilegivel', `não consegui abrir o diário de ${d.rotulo} (${e.code ?? 'erro'}); nada foi gravado`); } // ausente ≠ corrompido
    const lido = diario.lerEstrito(d.dir);
    if (!lido.ok) {
      throw new Falha('diario_ilegivel', `o diário de ${d.rotulo} não passa na leitura estrita (${lido.motivo}); nada foi gravado`);
    }
    const idDir = d.rotulo === '_sem-id' ? null : d.rotulo;
    const fatos = {
      branch, idPadrao, specs, plano: idDir === null ? null : lerPlano(raiz, idDir), ledger: idDir === null ? false : temLedger(raiz, idDir, cfg?.fluxo?.ledgerDir),
      gh: 'nunca', ultimas, sessao: ctxHook.sessao ?? null,
    };
    const trilha = trilhaDe(fatos, lido.eventos);
    lidos.push({ ...d, eventos: lido.eventos, abertas: perguntasAbertas(lido.eventos, trilha, ctx) });
  }
  return lidos;
}

/** Procura a pergunta e valida a resposta. Devolve `{ok, ...}`; lança `Falha` quando uma fonte não lê. */
function avaliar(raiz, ctxHook, id, opcao) {
  const achadas = [];
  let respondida = false;
  for (const l of lerDiarios(raiz, ctxHook)) {
    if (l.abertas.some((p) => p.id === id)) achadas.push(l);
    else if (respostaValida(l.abertas, id, opcao ?? 1, l.eventos).erro === 'respondida') respondida = true;
  }
  if (achadas.length >= 2) {
    return { ok: false, erro: 'ambigua', mensagem: `a pergunta ${id} existe nos diários de ${achadas.map((a) => a.rotulo).join(' e ')}; nada foi gravado` };
  }
  if (achadas.length === 0) {
    return respondida
      ? { ok: false, erro: 'respondida', mensagem: `a pergunta ${id} já foi respondida; nada foi gravado` }
      : { ok: false, erro: 'inexistente', mensagem: `não há pergunta aberta ${id} neste diário; nada foi gravado` };
  }
  const [a] = achadas;
  if (opcao === null) return { ok: true, dir: a.dir, rotulo: a.rotulo, eventos: a.eventos, abertas: a.abertas };
  const v = respostaValida(a.abertas, id, opcao, a.eventos);
  if (!v.ok) {
    return { ok: false, erro: v.erro, mensagem: v.erro === 'opcao_fora' ? `a opção ${opcao} não existe na pergunta ${id} (há ${a.abertas.find((p) => p.id === id).opcoes.length}); nada foi gravado` : `pergunta ${id}: ${v.erro}; nada foi gravado` };
  }
  return { ok: true, dir: a.dir, entrega: a.rotulo, rotulo: v.rotulo, eventos: a.eventos, abertas: a.abertas };
}

function gravar(raiz, dir, sessao, tipo, dados) {
  let autor = 'desconhecido';
  try { autor = git(raiz, 'config', 'user.email') || autor; } catch { /* sem user.email: o diário aceita "desconhecido" */ }
  const r = diario.append(dir, sessao, { ts: new Date().toISOString(), autor, sessao, agente: 'orquestrador', tipo, dados });
  if (!r.ok) throw new Falha('evento_nao_gravado', `${tipo} não gravado: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `${tipo} recusado pelo diário (canário ou tamanho)`);
}

/**
 * GM-15 T35 (r.9, r.14): "agora não" para o id `<sessao>:<seq>`. Vale para pergunta ABERTA (`adiamentoValido`, rótulo "agora não") e para o pedido de
 * /clear em curso desta sessão (`pedidoDeClear` com a leitura própria de `medicaoDoPouso`, a mesma de `loop.mjs proxima`; rótulo com o contexto medido,
 * que a volta em +10 p.p. lê). Grava `{pergunta, opcao: 1, rotulo}` (a forma exige opcao 1..4; o rótulo decide) e relê. `{ok, ...}` ou Falha.
 */
function adiar(raiz, ctxHook, sessao, id) {
  const x = lerX(process.env.GABARITO_POUSO_X).x;
  const medicao = medicaoDoPouso(raiz, ctxHook.sessao, x);
  const achadas = [];
  for (const l of lerDiarios(raiz, ctxHook)) {
    if (adiamentoValido(l.abertas, id).ok) achadas.push({ dir: l.dir, rotulo: l.rotulo, gravar: adiamentoValido(l.abertas, id).rotulo });
    const clear = pedidoDeClear(l.eventos, false, medicao);
    if (clear.pendente && !clear.adiado && clear.id === id) achadas.push({ dir: l.dir, rotulo: l.rotulo, gravar: rotuloAdiamentoClear(clear.percent) });
  }
  if (achadas.length === 0) return bloquear(`inexistente: não há pergunta aberta nem pedido de limpar a conversa ${id} para adiar; nada foi gravado`);
  if (achadas.length >= 2) return bloquear(`ambigua: ${id} existe nos diários de ${achadas.map((a) => a.rotulo).join(' e ')}; nada foi gravado`);
  const [a] = achadas;
  gravar(raiz, a.dir, sessao, 'dono.resposta', { pergunta: id, opcao: 1, rotulo: a.gravar });
  const lido = diario.lerEstrito(a.dir);
  if (!lido.ok) throw new Falha('resposta_sem_efeito', `o adiamento foi gravado mas o diário não relê (${lido.motivo}); confira o diário`);
  const ultima = respostasDe(lido.eventos, id).pop();
  if (ultima?.dados?.rotulo !== a.gravar || ultima.sessao !== sessao) throw new Falha('resposta_sem_efeito', 'a releitura não mostra o adiamento gravado; confira o diário');
  return { systemMessage: `Resposta registrada: ${a.gravar}.` };
}

/** Itens do lote das recomendadas nos diários lidos (`loteRecomendadas`, perguntas.ts), cada um com o diário dele. */
const itensDoLote = (lidos) => lidos.flatMap((l) => loteRecomendadas(l.abertas).map((i) => ({ ...i, dir: l.dir })));

/**
 * GM-15 T35 (r.16, D-G12 4, C6): "aprovar todas as recomendadas". `lote` só mostra (quantas, 1 linha de cada, o comando com a impressão) e não grava;
 * `lote <impressão>` grava 1 `dono.resposta {pergunta, opcao, rotulo}` por item com o rótulo recomendado, só se o lote é o MESMO que o dono viu, e relê.
 */
function lote(raiz, ctxHook, sessao, impressao) {
  const itens = itensDoLote(lerDiarios(raiz, ctxHook));
  if (itens.length === 0) return bloquear('nenhuma pergunta aberta com opção recomendada; nada foi gravado');
  const imp = impressaoDoLote(itens);
  if (impressao === null) {
    const linhas = itens.map((i, k) => `${k + 1}) ${i.texto} ⇒ ${i.rotulo}`).join('; ');
    return bloquear(`${itens.length} ${itens.length === 1 ? 'pergunta' : 'perguntas'} com recomendação: ${linhas}. Para gravar ${itens.length === 1 ? 'esta resposta' : `as ${itens.length}`}, digite /${COMANDO} lote ${imp}; nada foi gravado`, 'Confirme o lote');
  }
  if (impressao !== imp) return bloquear(`o lote mudou desde que você o viu (outra pergunta abriu ou fechou); peça de novo com /${COMANDO} lote; nada foi gravado`);
  for (const i of itens) gravar(raiz, i.dir, sessao, 'dono.resposta', { pergunta: i.id, opcao: i.opcao, rotulo: i.rotulo });
  const depois = lerDiarios(raiz, ctxHook);
  const abertos = new Set(depois.flatMap((l) => l.abertas.map((p) => p.id)));
  const faltou = itens.filter((i) => abertos.has(i.id) || !depois.some((l) => respostasDe(l.eventos, i.id).some((r) => r.dados.rotulo === i.rotulo && r.sessao === sessao)));
  if (faltou.length > 0) throw new Falha('resposta_sem_efeito', `${faltou.length} do lote não aparecem fechadas na releitura (${faltou.map((i) => i.id).join(', ')}); confira o diário`);
  return { systemMessage: `Respostas registradas: ${itens.length} ${itens.length === 1 ? 'recomendada' : 'recomendadas'}.` };
}

const respostasDe = (eventos, id) => eventos.filter((e) => e.tipo === 'dono.resposta' && e.dados?.pergunta === id && 'rotulo' in e.dados);

/** Núcleo puro de decisão: devolve o objeto a imprimir, ou `null` para silêncio. Nunca lança. `opcoes.antes`/`depois`: só o teste usa. */
export async function decidir(texto, cwdProcesso = process.cwd(), opcoes = {}) {
  try {
    if (texto === null || String(texto).trim() === '') return bloquear('stdin do hook ausente; nada foi gravado');
    let o;
    try { o = JSON.parse(texto); } catch { return bloquear('stdin do hook não é JSON; nada foi gravado'); }
    if (!ehObj(o)) return bloquear('stdin do hook não é um objeto JSON; nada foi gravado');
    if (o.command_name !== COMANDO) return null;
    if (Object.hasOwn(o, 'agent_id')) return bloquear('pedido de subagent (agent_id presente): só o dono responde, digitando o comando; nada foi gravado');
    const args = o.command_args;
    if (typeof args !== 'string') return bloquear(`argumento ${JSON.stringify(args ?? null)} inválido (uso: /${COMANDO} <pergunta> <n>); nada foi gravado`);
    if (args.length > ARGS_MAX) return bloquear(`argumento com ${args.length} caracteres, acima do limite de ${ARGS_MAX}; nada foi gravado`);
    const palavras = args.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').split(/[ \t\r\n]+/).filter((p) => p !== '');
    if (palavras.length === 0) return bloquear(`falta a pergunta e a opção (uso: /${COMANDO} <pergunta> <n>); nada foi gravado`);
    const id = palavras[0];
    // GM-15 T35 (r.16): `lote` e `lote <impressão>` (o resto do caminho é o mesmo: sessão, raiz, gravação e releitura)
    const ehLote = id === 'lote' && (palavras.length === 1 || (palavras.length === 2 && /^[0-9a-f]{12}$/.test(palavras[1])));
    const ehAdiar = palavras.length === 2 && palavras[1] === 'agora';
    if (ehLote || ehAdiar) {
      if (ehAdiar && (!ID_PERGUNTA_RE.test(id) || /^herdar:/.test(id))) return bloquear(`pergunta ${JSON.stringify(id.slice(0, 60))} fora da forma <sessao>:<seq>; nada foi gravado`);
      const sessaoStdin = typeof o.session_id === 'string' && SESSAO_RE.test(o.session_id) ? o.session_id : null;
      const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : cwdProcesso;
      let raiz;
      try { raiz = raizPrincipal(cwd); } catch (e) { return bloquear(`não é um repositório git utilizável (${e instanceof Error ? e.message : String(e)}); nada foi gravado`); }
      const ctxHook = { sessao: sessaoStdin, cwd };
      return ehLote ? lote(raiz, ctxHook, sessaoStdin ?? SESSAO_PADRAO, palavras.length === 2 ? palavras[1] : null) : adiar(raiz, ctxHook, sessaoStdin ?? SESSAO_PADRAO, id);
    }
    if (/^herdar:/.test(id)) return bloquear('perguntas de herança não são respondidas por este comando; nada foi gravado');
    if (!ID_PERGUNTA_RE.test(id)) return bloquear(`pergunta ${JSON.stringify(id.slice(0, 60))} fora da forma <sessao>:<seq>; nada foi gravado`);
    if (palavras.length === 1) return bloquear(`falta a opção (uso: /${COMANDO} ${id} <n>); nada foi gravado`);
    const porBotao = palavras.length === 2 && OPCAO_RE.test(palavras[1]);

    const sessaoStdin = typeof o.session_id === 'string' && SESSAO_RE.test(o.session_id) ? o.session_id : null;
    const sessao = sessaoStdin ?? SESSAO_PADRAO;
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : cwdProcesso;
    let raiz;
    try { raiz = raizPrincipal(cwd); } catch (e) { return bloquear(`não é um repositório git utilizável (${e instanceof Error ? e.message : String(e)}); nada foi gravado`); }
    const ctxHook = { sessao: sessaoStdin, cwd };

    const opcao = porBotao ? Number(palavras[1]) : null;
    const a = avaliar(raiz, ctxHook, id, opcao);
    if (!a.ok) return bloquear(`${a.erro}: ${a.mensagem}`);

    if (!porBotao) {
      // resposta digitada: só {pergunta, sha256, chars}; o texto nunca entra no diário
      gravar(raiz, a.dir, sessao, 'dono.resposta', { pergunta: id, sha256: sha256(args), chars: [...args].length });
      return bloquear('resposta não reconhecida: o painel só aceita um dos botões da pergunta (nada do que você digitou foi guardado, só a impressão digital); use o botão');
    }

    opcoes.antes?.();
    const de_novo = avaliar(raiz, ctxHook, id, opcao);
    if (!de_novo.ok) return bloquear(`${de_novo.erro}: ${de_novo.mensagem}`);
    if (de_novo.dir !== a.dir || de_novo.rotulo !== a.rotulo) return bloquear(`a pergunta ${id} mudou de lugar entre a conferência e a gravação; responda de novo; nada foi gravado`);
    gravar(raiz, de_novo.dir, sessao, 'dono.resposta', { pergunta: id, opcao, rotulo: de_novo.rotulo });
    opcoes.depois?.();

    // O que só o disco revela: reler e conferir que a resposta subiu, é a única e a pergunta saiu das abertas.
    const lido = diario.lerEstrito(de_novo.dir);
    if (!lido.ok) throw new Falha('resposta_sem_efeito', `a resposta foi gravada mas o diário não relê (${lido.motivo}); confira o diário`);
    // ordem do diário (ts, sessao, seq): a mesma de `trilhaDe`, para "a primeira" daqui ser a que vale lá
    const minhas = respostasDe(lido.eventos, id).sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts) || (x.sessao < y.sessao ? -1 : x.sessao > y.sessao ? 1 : 0) || x.seq - y.seq);
    if (minhas.length !== 1) {
      return bloquear(`a pergunta ${id} recebeu ${minhas.length} respostas ao mesmo tempo (outra sessão respondeu junto); a sua ficou no diário, mas vale a primeira (${minhas[0].dados.rotulo}) — confira o painel`, 'Resposta gravada');
    }
    if (avaliar(raiz, ctxHook, id, opcao).ok) throw new Falha('resposta_sem_efeito', `a pergunta ${id} continua aberta depois da resposta; confira o diário`);
    if (minhas[0].dados.opcao !== opcao || minhas[0].dados.rotulo !== de_novo.rotulo || minhas[0].sessao !== sessao) {
      throw new Falha('resposta_sem_efeito', 'a releitura não mostra a resposta gravada; confira o diário');
    }
    return { systemMessage: `Resposta registrada: ${de_novo.rotulo}.` };
  } catch (e) {
    if (e instanceof Falha) return bloquear(`${e.erro}: ${e.message}`);
    return bloquear(`o hook falhou (${e instanceof Error ? e.message : String(e)}); nada foi gravado`);
  }
}

async function principal() {
  let texto = null;
  try { texto = readFileSync(0, 'utf8'); } catch { /* stdin ausente */ }
  const saida = await decidir(texto);
  if (saida !== null) process.stdout.write(`${JSON.stringify(saida)}\n`);
  process.exitCode = 0;
}

if (ehEntrypoint(import.meta.url)) await principal();

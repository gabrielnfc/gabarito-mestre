#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` dos comandos humanos do dono da GM-15 (REQ-ENT-1 c, REQ-ENT-2; regra transversal "comando humano"):
 *   /gabarito-mestre:reabrir-entrega <ID>        grava `entrega.reaberta {entrega, em}` (a ÚNICA gravação, `reabrirEntrega` abaixo)
 *   /gabarito-mestre:adiar [<entrega>] <task> <motivo>   `foraDono(..., 'adiada', ...)`  (loop.mjs, T6; GM-18: `<entrega>` opcional, 1º token que casa ENTREGA_RE)
 *   /gabarito-mestre:cortar [<entrega>] <task> <motivo>  `foraDono(..., 'cortada', ...)` (loop.mjs, T6; idem)
 *   /gabarito-mestre:reabrir [<entrega>] <task>          `reabrirDono(...)`              (loop.mjs, T6; devolve a task de `fora` a `pendente`; idem)
 *   /gabarito-mestre:encerrar <entrega> <PR> [<versão>]  grava `entrega.encerrada {entrega, pr, via:"dono", mergeado_em, versao?}` (GM-18, `encerrarEntrega` abaixo; o `gh` confere o PR)
 *
 * Mesmo padrão e contrato de falha de `liberar-teto.mjs`: o modelo não chega aqui (cada skill tem `disable-model-invocation: true`, e a chamada via `Skill`
 * não dispara este hook); nenhum argumento do `loop.mjs` grava estes eventos com origem `dono` (as funções vivem FORA de `ESPEC`); o evento é gravado
 * ANTES do texto da skill (`onFailure: block` em hooks.json) e recusa vira `block` com a causa, nada gravado. Adaptador fino: a regra das tasks é de
 * `foraDono`/`reabrirDono`; a da entrega é de `reabrirEntrega` (só entrega com `entrega.encerrada` vigente, e só vale com o `entregaPublicada` relido `false`) e de
 * `encerrarEntrega` (só entrega ainda não encerrada, com o PR mergeado segundo o `gh`, e só vale com o `entregaPublicada` relido `true`).
 *
 * Decisão, na ordem:
 *   stdin ausente, não JSON ou não objeto ... block
 *   `command_name` que não é de nenhum dos 5 ... sai 0 calado
 *   `agent_id` presente (subagent) ........... block
 *   argumento fora da forma do comando ....... block (vazio, espaço a mais, caminho, metacaractere, texto grande demais)
 *   a função com ok:false .................... block com `erro` e `mensagem`
 *   a função com ok:true ..................... sai 0 com `systemMessage`; só com o evento gravado e relido
 * Falha do próprio hook também vira block. Sai sempre 0. O repositório vem do `cwd` do stdin, nunca de variável de ambiente.
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append` ou JSON falso neste script gravam um evento válido; o núcleo não distingue.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { ehEntrypoint } from '../lib/cli.mjs';
import * as diario from '../dist/diario.js';
import { entregaPublicada, SESSAO_QUALQUER } from '../dist/guarda.js';
import { encerramentoDe } from '../dist/trilha.js';

const PREFIXO = 'gabarito-mestre:';
export const COMANDOS = ['reabrir-entrega', 'adiar', 'cortar', 'reabrir', 'encerrar'];
const ID_TASK_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ID_ENTREGA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Mesma forma de `ENTREGA_RE` e `SEMVER_RE` de `formas.ts` e de `loop.mjs` (lá não exportadas): o ID vira diretório, a versão vem sem o `v`. */
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** O que o hook aceita de `encerrar`: `<entrega> <PR> [<versão>]`, 1 espaço entre eles, PR com `#` opcional, até 9 dígitos. */
const ARGS_ENCERRAR_RE = /^(\S+) #?(\d{1,9})(?: (\S+))?$/;
const GH_TIMEOUT_MS = 5000; // F13 (medido 2026-11-21): `gh pr view` leva ~0,5 s; o hook tem 10 s
const GH_SAIDA_MAX = 65536;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_PADRAO = 'dono';
const ARGS_MAX = 2000;
const MOTIVO_MAX = 1000;

const bloquear = (nome, reason) => ({ decision: 'block', reason: `Comando ${nome} recusado: ${reason}` });

/**
 * REQ-ENT-1 (c): a ÚNICA gravação de `entrega.reaberta`. Fora de `ESPEC` de propósito: nenhum argumento do CLI chega aqui, só o hook do comando que o dono
 * digita. Exige `entrega.encerrada` vigente (reabrir o que não está encerrado seria evento sem efeito que parece reabertura) e relê: o `entregaPublicada` da
 * entrega tem de voltar a `false`. Nunca lança: `{ok:true, entrega, em}` ou `{ok:false, erro, mensagem}`.
 */
export async function reabrirEntrega(cwd, id, sessao) {
  try {
    if (typeof id !== 'string' || !ID_ENTREGA_RE.test(id)) return { ok: false, erro: 'id_invalido', mensagem: `entrega ${JSON.stringify(id)} fora da forma ${ID_ENTREGA_RE}` };
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) return { ok: false, erro: 'argumento_invalido', mensagem: `sessão fora da forma ${SESSAO_RE}` };
    const { contexto } = await import('./loop.mjs');
    const c = contexto(cwd, { entrega: id, sessao });
    const lido = diario.lerEstrito(c.dirEntrega);
    if (!lido.ok) return { ok: false, erro: 'diario_invalido', mensagem: `o diário da entrega ${id} não está legível (ausente ou corrompido); nada foi gravado` };
    if (!encerramentoDe(lido.eventos, id).encerrada) {
      return { ok: false, erro: 'entrega_nao_encerrada', mensagem: `a entrega ${id} não está encerrada (sem entrega.encerrada vigente no diário): não há o que reabrir; nada foi gravado` };
    }
    const em = new Date().toISOString();
    let autor = 'desconhecido';
    try { autor = (await import('node:child_process')).execFileSync('git', ['config', 'user.email'], { cwd: c.raiz, encoding: 'utf8' }).trim() || autor; } catch { /* sem user.email */ }
    const r = diario.append(c.dirEntrega, sessao, { ts: em, autor, sessao, agente: 'orquestrador', tipo: 'entrega.reaberta', dados: { entrega: id, em } });
    if (!r.ok || r.gravado !== 'evento') return { ok: false, erro: 'gravacao_recusada', mensagem: `o diário recusou o evento (${r.ok ? r.gravado : r.erro}); nada foi gravado` };
    if (entregaPublicada(c.raiz, id, SESSAO_QUALQUER)) {
      return { ok: false, erro: 'reabertura_sem_efeito', mensagem: `o evento de ${id} foi gravado mas a entrega segue publicada no diário relido; confira o diário` };
    }
    return { ok: true, entrega: id, em };
  } catch (e) {
    return { ok: false, erro: e?.erro ?? 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
  }
}

/** Executor padrão do `gh` (só leitura): o `gh` do `PATH`, no repositório; os testes do hook põem um `gh` falso no `PATH` do subprocesso. */
function ghPadrao(numero, cwd, timeoutMs) {
  return spawnSync('gh', ['pr', 'view', String(numero), '--json', 'number,state,mergedAt'], { cwd, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: GH_SAIDA_MAX });
}

/** Confere o PR pelo `gh`: `{ok:true, mergeado_em}` ou `{ok:false, erro, mensagem}` (`pr_nao_conferido` | `pr_nao_mergeado`). Falha de qualquer tipo nunca vira "mergeado". */
function conferirPr(numero, cwd, opcoes) {
  const naoConferido = (m) => ({ ok: false, erro: 'pr_nao_conferido', mensagem: `${m}; nada foi gravado` });
  const timeoutMs = opcoes.timeoutMs ?? GH_TIMEOUT_MS;
  let r;
  try { r = (opcoes.gh ?? ghPadrao)(numero, cwd, timeoutMs); } catch (e) { return naoConferido(`o gh falhou (${e instanceof Error ? e.message : String(e)})`); }
  if (r?.error?.code === 'ENOENT') return naoConferido('gh não encontrado no PATH (não consigo conferir o PR)');
  if (r?.error?.code === 'ETIMEDOUT' || r?.signal === 'SIGKILL' || r?.signal === 'SIGTERM') return naoConferido(`o gh expirou em ${timeoutMs / 1000} s`);
  if (r?.error) return naoConferido(`o gh não rodou (${r.error.code ?? r.error.message})`);
  if (r?.status !== 0) return naoConferido(`o gh saiu com rc ${r?.status}: ${String(r?.stderr ?? '').trim().slice(0, 200) || 'sem mensagem'}`);
  let j;
  try { j = JSON.parse(String(r.stdout)); } catch { return naoConferido('a saída do gh não é JSON'); }
  const mergedAt = j?.mergedAt;
  const forma = j !== null && typeof j === 'object' && !Array.isArray(j) && j.number === numero && typeof j.state === 'string' && (mergedAt === null || typeof mergedAt === 'string');
  if (!forma) return naoConferido('a saída do gh está fora da forma {number, state, mergedAt} do PR pedido');
  if (j.state !== 'MERGED' || mergedAt === null) return { ok: false, erro: 'pr_nao_mergeado', mensagem: `o PR #${numero} não está mergeado (state ${j.state}, mergedAt ${mergedAt === null ? 'ausente' : mergedAt}); nada foi gravado` };
  if (Number.isNaN(Date.parse(mergedAt))) return naoConferido(`mergedAt ${JSON.stringify(mergedAt)} não é uma data`);
  return { ok: true, mergeado_em: mergedAt };
}

/**
 * GM-18 (REQ-ENC-2): a ÚNICA gravação de `entrega.encerrada` com `via: "dono"`. Fora de `ESPEC`: nenhum argumento do CLI chega aqui, só o hook do comando que o dono
 * digita. Ordem: forma ⇒ pasta ⇒ diário legível ⇒ ainda não encerrada ⇒ `gh` (PR mergeado) ⇒ simulação ⇒ gravação ⇒ releitura. Cada recusa não grava nada.
 * `opcoes.gh(numero, cwd, timeoutMs)` devolve o resultado de `spawnSync` (padrão: o `gh` real). Nunca lança: `{ok:true, entrega, pr, versao?}` ou `{ok:false, erro, mensagem}`.
 */
export async function encerrarEntrega(cwd, args, sessao, opcoes = {}) {
  try {
    const m = typeof args === 'string' ? ARGS_ENCERRAR_RE.exec(args) : null;
    if (m === null || !ENTREGA_RE.test(m[1]) || Number(m[2]) < 1 || (m[3] !== undefined && !SEMVER_RE.test(m[3]))) {
      return { ok: false, erro: 'id_invalido', mensagem: `argumento ${JSON.stringify(String(args).slice(0, 80))} inválido (uso: ${USO.encerrar}); nada foi gravado` };
    }
    const [, id, prTexto, versao] = m;
    const pr = Number(prTexto);
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) return { ok: false, erro: 'argumento_invalido', mensagem: `sessão fora da forma ${SESSAO_RE}` };
    const { contexto } = await import('./loop.mjs');
    const c = contexto(cwd, { entrega: id, sessao });
    if (!existsSync(c.dirEntrega) || !statSync(c.dirEntrega).isDirectory()) return { ok: false, erro: 'entrega_inexistente', mensagem: `a entrega ${id} não existe (sem .harness/entregas/${id}); nada foi criado nem gravado` };
    const lido = diario.lerEstrito(c.dirEntrega);
    if (!lido.ok) return { ok: false, erro: 'diario_invalido', mensagem: `diário corrompido na entrega ${id} (${lido.motivo}); nada foi gravado` };
    if (lido.eventos.length === 0) return { ok: false, erro: 'diario_invalido', mensagem: `pasta sem diário na entrega ${id} (nenhum events.*.jsonl); nada foi gravado` };
    const antes = encerramentoDe(lido.eventos, id);
    if (antes.encerrada) {
      return { ok: false, erro: 'entrega_ja_encerrada', mensagem: `a entrega ${id} já está encerrada (PR #${antes.primeira.pr}, via ${antes.primeira.via}); para encerrar de novo, reabra antes com /${PREFIXO}reabrir-entrega ${id}; nada foi gravado` };
    }
    const conf = conferirPr(pr, c.raiz, opcoes);
    if (!conf.ok) return conf;
    const ts = new Date().toISOString();
    let autor = 'desconhecido';
    try { autor = spawnSync('git', ['config', 'user.email'], { cwd: c.raiz, encoding: 'utf8' }).stdout.trim() || autor; } catch { /* sem user.email */ }
    const dados = { entrega: id, pr, via: 'dono', mergeado_em: conf.mergeado_em, ...(versao === undefined ? {} : { versao }) };
    const seqDaSessao = Math.max(0, ...lido.eventos.filter((e) => e.sessao === sessao).map((e) => e.seq)) + 1;
    const candidato = { seq: seqDaSessao, ts, autor, sessao, agente: 'orquestrador', tipo: 'entrega.encerrada', dados, hash_anterior: null };
    if (!encerramentoDe([...lido.eventos, candidato], id).encerrada) {
      return { ok: false, erro: 'encerramento_sem_efeito', mensagem: `o diário da entrega ${id} (ordenado por ts entre sessões) não daria a entrega por encerrada com este evento (há evento de outra sessão à frente do relógio); nada foi gravado` };
    }
    const r = diario.append(c.dirEntrega, sessao, { ts, autor, sessao, agente: 'orquestrador', tipo: 'entrega.encerrada', dados });
    if (!r.ok || r.gravado !== 'evento') return { ok: false, erro: 'gravacao_recusada', mensagem: `o diário recusou o evento (${r.ok ? r.gravado : r.erro}); nada foi gravado` };
    const depois = diario.lerEstrito(c.dirEntrega);
    const enc = depois.ok ? encerramentoDe(depois.eventos, id) : null;
    if (enc === null || !enc.encerrada || enc.primeira.via !== 'dono' || enc.primeira.pr !== pr || !entregaPublicada(c.raiz, id, SESSAO_QUALQUER)) {
      return { ok: false, erro: 'encerramento_sem_efeito', mensagem: `o evento de ${id} foi gravado mas o diário relido não dá a entrega por encerrada pelo dono (PR #${pr}); confira o diário` };
    }
    return { ok: true, entrega: id, pr, ...(versao === undefined ? {} : { versao }) };
  } catch (e) {
    return { ok: false, erro: e?.erro ?? 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
  }
}

/** Separa `[<entrega>] <resto>`: o 1º token que casa `ENTREGA_RE` é sempre a entrega (D-G31); o `resto` é o que sobra depois dele (ou `null` se nada sobra). */
function separarEntrega(args) {
  const m = /^(\S+) ([\s\S]*)$/.exec(args);
  if (m !== null && ENTREGA_RE.test(m[1])) return { entrega: m[1], resto: m[2] };
  return { entrega: ENTREGA_RE.test(args) ? args : undefined, resto: ENTREGA_RE.test(args) ? null : args };
}

/** Núcleo puro de decisão: devolve o objeto a imprimir, ou `null` para silêncio. Nunca lança. */
export async function decidir(texto, cwdProcesso = process.cwd()) {
  let nome = 'do dono';
  try {
    if (texto === null || String(texto).trim() === '') return bloquear(nome, 'stdin do hook ausente; nada foi gravado');
    let o;
    try { o = JSON.parse(texto); } catch { return bloquear(nome, 'stdin do hook não é JSON; nada foi gravado'); }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return bloquear(nome, 'stdin do hook não é um objeto JSON; nada foi gravado');
    const comando = typeof o.command_name === 'string' && o.command_name.startsWith(PREFIXO) ? o.command_name.slice(PREFIXO.length) : null;
    if (comando === null || !COMANDOS.includes(comando)) return null;
    nome = `/${PREFIXO}${comando}`;
    if (Object.hasOwn(o, 'agent_id')) return bloquear(nome, 'pedido de subagent (agent_id presente): só o dono decide, digitando o comando; nada foi gravado');
    const args = o.command_args;
    if (typeof args !== 'string' || args.length > ARGS_MAX) return bloquear(nome, `argumento ausente ou grande demais (uso: ${USO[comando]}); nada foi gravado`);
    const sessao = typeof o.session_id === 'string' && SESSAO_RE.test(o.session_id) ? o.session_id : SESSAO_PADRAO;
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : cwdProcesso;
    const uso = () => bloquear(nome, `argumento ${JSON.stringify(args.length > 80 ? `${args.slice(0, 80)}…` : args)} inválido (uso: ${USO[comando]}); nada foi gravado`);

    if (comando === 'reabrir-entrega') {
      if (!ID_ENTREGA_RE.test(args)) return uso();
      const r = await reabrirEntrega(cwd, args, sessao);
      return r.ok === true ? { systemMessage: `Entrega ${r.entrega} reaberta pelo dono (${r.em}): deixa de contar como entregue.` } : bloquear(nome, `${r.erro}: ${r.mensagem}`);
    }
    if (comando === 'encerrar') {
      const r = await encerrarEntrega(cwd, args, sessao);
      return r.ok === true ? { systemMessage: `Entrega ${r.entrega} encerrada pelo dono (PR #${r.pr}${r.versao === undefined ? '' : `, versão ${r.versao}`}): passa a contar como entregue.` } : bloquear(nome, `${r.erro}: ${r.mensagem}`);
    }
    const { foraDono, reabrirDono } = await import('./loop.mjs');
    const { entrega, resto } = separarEntrega(args);
    if (comando === 'reabrir') {
      if (resto === null || !ID_TASK_RE.test(resto)) return uso();
      const r = reabrirDono(cwd, resto, sessao, entrega);
      return r.ok === true ? { systemMessage: `Task ${r.task} reaberta pelo dono (entrega ${r.entrega}): volta a ${r.estado}.` } : bloquear(nome, `${r.erro}: ${r.mensagem}`);
    }
    const m = resto === null ? null : /^(\S+) (\S[\s\S]*)$/.exec(resto);
    if (m === null || !ID_TASK_RE.test(m[1]) || m[2].trim().length > MOTIVO_MAX) return uso();
    const como = comando === 'adiar' ? 'adiada' : 'cortada';
    const r = foraDono(cwd, m[1], como, m[2].trim(), sessao, entrega);
    if (r.ok === true) return { systemMessage: `Task ${r.task} ${como} pelo dono (entrega ${r.entrega}): sai do alvo da entrega.` };
    const dep = Array.isArray(r.dependentes) && r.dependentes.length > 0 ? ` (dependentes: ${r.dependentes.join(', ')})` : '';
    return bloquear(nome, `${r.erro}: ${r.mensagem}${dep}`);
  } catch (e) {
    return bloquear(nome, `o hook falhou (${e instanceof Error ? e.message : String(e)}); nada foi gravado`);
  }
}

const USO = {
  'reabrir-entrega': '/gabarito-mestre:reabrir-entrega <ID da entrega>',
  adiar: '/gabarito-mestre:adiar [<entrega>] <task> <motivo>',
  cortar: '/gabarito-mestre:cortar [<entrega>] <task> <motivo>',
  reabrir: '/gabarito-mestre:reabrir [<entrega>] <task>',
  encerrar: '/gabarito-mestre:encerrar <entrega> <PR> [<versão>]',
};

async function principal() {
  let texto = null;
  try { texto = readFileSync(0, 'utf8'); } catch { /* stdin ausente */ }
  const saida = await decidir(texto);
  if (saida !== null) process.stdout.write(`${JSON.stringify(saida)}\n`);
  process.exitCode = 0;
}

if (ehEntrypoint(import.meta.url)) await principal();

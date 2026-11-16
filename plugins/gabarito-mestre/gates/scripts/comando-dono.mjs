#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` dos comandos humanos do dono da GM-15 (REQ-ENT-1 c, REQ-ENT-2; regra transversal "comando humano"):
 *   /gabarito-mestre:reabrir-entrega <ID>        grava `entrega.reaberta {entrega, em}` (a ÚNICA gravação, `reabrirEntrega` abaixo)
 *   /gabarito-mestre:adiar <task> <motivo>       `foraDono(..., 'adiada', ...)`  (loop.mjs, T6)
 *   /gabarito-mestre:cortar <task> <motivo>      `foraDono(..., 'cortada', ...)` (loop.mjs, T6)
 *   /gabarito-mestre:reabrir <task>              `reabrirDono(...)`              (loop.mjs, T6; devolve a task de `fora` a `pendente`)
 *
 * Mesmo padrão e contrato de falha de `liberar-teto.mjs`: o modelo não chega aqui (cada skill tem `disable-model-invocation: true`, e a chamada via `Skill`
 * não dispara este hook); nenhum argumento do `loop.mjs` grava estes eventos com origem `dono` (as funções vivem FORA de `ESPEC`); o evento é gravado
 * ANTES do texto da skill (`onFailure: block` em hooks.json) e recusa vira `block` com a causa, nada gravado. Adaptador fino: a regra das tasks é de
 * `foraDono`/`reabrirDono`; a da entrega é de `reabrirEntrega` (só entrega com `entrega.encerrada` vigente, e só vale com o `entregaPublicada` relido `false`).
 *
 * Decisão, na ordem:
 *   stdin ausente, não JSON ou não objeto ... block
 *   `command_name` que não é de nenhum dos 4 ... sai 0 calado
 *   `agent_id` presente (subagent) ........... block
 *   argumento fora da forma do comando ....... block (vazio, espaço a mais, caminho, metacaractere, texto grande demais)
 *   a função com ok:false .................... block com `erro` e `mensagem`
 *   a função com ok:true ..................... sai 0 com `systemMessage`; só com o evento gravado e relido
 * Falha do próprio hook também vira block. Sai sempre 0. O repositório vem do `cwd` do stdin, nunca de variável de ambiente.
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append` ou JSON falso neste script gravam um evento válido; o núcleo não distingue.
 */
import { readFileSync } from 'node:fs';
import { ehEntrypoint } from '../lib/cli.mjs';
import * as diario from '../dist/diario.js';
import { entregaPublicada, SESSAO_QUALQUER } from '../dist/guarda.js';
import { encerramentoDe } from '../dist/trilha.js';

const PREFIXO = 'gabarito-mestre:';
export const COMANDOS = ['reabrir-entrega', 'adiar', 'cortar', 'reabrir'];
const ID_TASK_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ID_ENTREGA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
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
    const { foraDono, reabrirDono } = await import('./loop.mjs');
    if (comando === 'reabrir') {
      if (!ID_TASK_RE.test(args)) return uso();
      const r = reabrirDono(cwd, args, sessao);
      return r.ok === true ? { systemMessage: `Task ${r.task} reaberta pelo dono (entrega ${r.entrega}): volta a ${r.estado}.` } : bloquear(nome, `${r.erro}: ${r.mensagem}`);
    }
    const m = /^(\S+) (\S[\s\S]*)$/.exec(args);
    if (m === null || !ID_TASK_RE.test(m[1]) || m[2].trim().length > MOTIVO_MAX) return uso();
    const como = comando === 'adiar' ? 'adiada' : 'cortada';
    const r = foraDono(cwd, m[1], como, m[2].trim(), sessao);
    if (r.ok === true) return { systemMessage: `Task ${r.task} ${como} pelo dono: sai do alvo da entrega.` };
    const dep = Array.isArray(r.dependentes) && r.dependentes.length > 0 ? ` (dependentes: ${r.dependentes.join(', ')})` : '';
    return bloquear(nome, `${r.erro}: ${r.mensagem}${dep}`);
  } catch (e) {
    return bloquear(nome, `o hook falhou (${e instanceof Error ? e.message : String(e)}); nada foi gravado`);
  }
}

const USO = {
  'reabrir-entrega': '/gabarito-mestre:reabrir-entrega <ID da entrega>',
  adiar: '/gabarito-mestre:adiar <task> <motivo>',
  cortar: '/gabarito-mestre:cortar <task> <motivo>',
  reabrir: '/gabarito-mestre:reabrir <task>',
};

async function principal() {
  let texto = null;
  try { texto = readFileSync(0, 'utf8'); } catch { /* stdin ausente */ }
  const saida = await decidir(texto);
  if (saida !== null) process.stdout.write(`${JSON.stringify(saida)}\n`);
  process.exitCode = 0;
}

if (ehEntrypoint(import.meta.url)) await principal();

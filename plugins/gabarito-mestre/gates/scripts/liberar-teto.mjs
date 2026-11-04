#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` do comando humano `/gabarito-mestre:liberar <task>` (REQ-LOOP-2, spec r12; spike A1, 2.1.318).
 *
 * É o único caminho que grava `task.reaberta {origem:"dono"}` e tira uma task do teto de rodadas. O modelo não chega aqui: a skill tem
 * `disable-model-invocation: true` (a chamada via `Skill` é recusada e não dispara este hook). Adaptador fino: a regra e a gravação
 * são de `liberarTeto` em `loop.mjs`.
 *
 * Decisão, na ordem:
 *   stdin ausente, não JSON ou não objeto ... block (não dá para saber que o comando não é o nosso)
 *   `command_name` diferente do comando ..... sai 0 calado, sem efeito (outro comando não é problema deste hook)
 *   `agent_id` presente (subagent) ........... block
 *   `command_args` fora de ID_RE ............. block (vazio, espaço, caminho, metacaractere)
 *   `liberarTeto` com ok:false ............... block com `erro` e `mensagem`, nada gravado
 *   `liberarTeto` com ok:true ................ sai 0 com `systemMessage`; só com o evento gravado e relido
 * Falha do próprio hook (exceção, `loop.mjs` ou `dist/` ausente) também vira block. Sai sempre 0: o bloqueio é o JSON, e
 * `onFailure: block` em hooks.json cobre crash e timeout.
 *
 * O repositório vem do `cwd` do stdin (nunca de variável de ambiente: o teste e o TUI veem o mesmo caminho).
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append`, `claude -p '/gabarito-mestre:liberar T1'` aninhado
 * ou JSON falso neste script gravam um evento válido; o núcleo não distingue. O Stop em `concluir` lista as liberações ao dono.
 */
import { readFileSync } from 'node:fs';
import { ehEntrypoint } from '../lib/cli.mjs';

const COMANDO = 'gabarito-mestre:liberar';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_PADRAO = 'dono';

const bloquear = (reason) => ({ decision: 'block', reason: `Liberação recusada: ${reason}` });

/** Núcleo puro de decisão: devolve o objeto a imprimir, ou `null` para silêncio. Nunca lança. */
export async function decidir(texto, cwdProcesso = process.cwd()) {
  try {
    if (texto === null || String(texto).trim() === '') return bloquear('stdin do hook ausente; nada foi gravado');
    let o;
    try { o = JSON.parse(texto); } catch { return bloquear('stdin do hook não é JSON; nada foi gravado'); }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return bloquear('stdin do hook não é um objeto JSON; nada foi gravado');
    if (o.command_name !== COMANDO) return null;
    if (Object.hasOwn(o, 'agent_id')) return bloquear('pedido de subagent (agent_id presente): só o dono libera, digitando o comando; nada foi gravado');
    const task = o.command_args;
    if (typeof task !== 'string' || !ID_RE.test(task)) {
      return bloquear(`argumento ${JSON.stringify(task)} não é um id de task (uso: /${COMANDO} <task>); nada foi gravado`);
    }
    const sessao = typeof o.session_id === 'string' && SESSAO_RE.test(o.session_id) ? o.session_id : SESSAO_PADRAO;
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : cwdProcesso;
    const { liberarTeto } = await import('./loop.mjs');
    const r = liberarTeto(cwd, task, sessao);
    if (r.ok === true) {
      return { systemMessage: `Task ${r.task} liberada do teto de rodadas pelo dono (entrega ${r.entrega}): recomeça em ${r.estado}, rodada 0.` };
    }
    return bloquear(`${r.erro}: ${r.mensagem}`);
  } catch (e) {
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

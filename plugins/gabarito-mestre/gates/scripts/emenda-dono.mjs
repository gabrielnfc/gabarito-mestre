#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` do comando humano `/gabarito-mestre:emenda aprovar|rejeitar <seq>` (GM-11 T10, REQ-EME-1; desenho de `liberar-teto.mjs`).
 *
 * É o único caminho que grava `spec.emendada` ou `emenda.rejeitada` com `origem:"dono"`. O modelo não chega aqui: a skill tem
 * `disable-model-invocation: true` (a chamada via `Skill` é recusada e não dispara este hook). Adaptador fino: a regra e a gravação
 * são de `julgarEmendaDono` em `loop.mjs`.
 *
 * Decisão, na ordem:
 *   stdin ausente, não JSON ou não objeto ... block (não dá para saber que o comando não é o nosso)
 *   `command_name` diferente do comando ..... sai 0 calado, sem efeito (outro comando não é problema deste hook)
 *   `agent_id` presente (subagent) ........... block
 *   `command_args` fora de `^(aprovar|rejeitar) [1-9][0-9]{0,8}$` ... block (sem `trim`: " aprovar 3", "Aprovar 3", "aprovar 03", "aprovar 3;x")
 *   `julgarEmendaDono` com ok:false .......... block com `erro` e `mensagem`, nada gravado (inclui `plano_ausente`: comando explícito do dono não vira silêncio)
 *   `julgarEmendaDono` com ok:true ........... sai 0 com `systemMessage`; só com o evento gravado e relido fechando a proposta com origem `dono`
 * Falha do próprio hook (exceção, `loop.mjs` ou `dist/` ausente) também vira block. Sai sempre 0: o bloqueio é o JSON, e
 * `onFailure: block` em hooks.json cobre crash e timeout.
 *
 * O repositório vem do `cwd` do stdin (nunca de variável de ambiente: o teste e o TUI veem o mesmo caminho).
 * Limite declarado (Q14, como `liberar`): sob o mesmo usuário de SO, `node -e` com `diario.append`, `claude -p '/gabarito-mestre:emenda aprovar 3'`
 * aninhado ou JSON falso neste script gravam um evento válido; o núcleo não distingue.
 */
import { readFileSync } from 'node:fs';
import { ehEntrypoint } from '../lib/cli.mjs';

const COMANDO = 'gabarito-mestre:emenda';
const ARGS_RE = /^(aprovar|rejeitar) ([1-9][0-9]{0,8})$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SESSAO_PADRAO = 'dono';

const bloquear = (reason) => ({ decision: 'block', reason: `Emenda recusada: ${reason}` });

/** Núcleo puro de decisão: devolve o objeto a imprimir, ou `null` para silêncio. Nunca lança. */
export async function decidir(texto, cwdProcesso = process.cwd()) {
  try {
    if (texto === null || String(texto).trim() === '') return bloquear('stdin do hook ausente; nada foi gravado');
    let o;
    try { o = JSON.parse(texto); } catch { return bloquear('stdin do hook não é JSON; nada foi gravado'); }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return bloquear('stdin do hook não é um objeto JSON; nada foi gravado');
    if (o.command_name !== COMANDO) return null;
    if (Object.hasOwn(o, 'agent_id')) return bloquear('pedido de subagent (agent_id presente): só o dono julga, digitando o comando; nada foi gravado');
    const m = typeof o.command_args === 'string' ? ARGS_RE.exec(o.command_args) : null;
    if (m === null) {
      return bloquear(`argumento ${JSON.stringify(o.command_args)} inválido (uso: /${COMANDO} aprovar|rejeitar <seq>, seq inteiro >= 1 com até 9 dígitos); nada foi gravado`);
    }
    const sessao = typeof o.session_id === 'string' && SESSAO_RE.test(o.session_id) ? o.session_id : SESSAO_PADRAO;
    const cwd = typeof o.cwd === 'string' && o.cwd !== '' ? o.cwd : cwdProcesso;
    const { julgarEmendaDono } = await import('./loop.mjs');
    const r = julgarEmendaDono(cwd, Number(m[2]), m[1], sessao);
    if (r.ok === true) {
      return { systemMessage: `Emenda #${r.seq} (${r.req}) ${m[1] === 'aprovar' ? 'aprovada' : 'rejeitada'} pelo dono; entrega ${r.entrega}` };
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

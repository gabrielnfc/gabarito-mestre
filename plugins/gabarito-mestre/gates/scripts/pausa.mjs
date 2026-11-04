#!/usr/bin/env node
/**
 * GM-10, REQ-POU-2 — estado da pausa para `/gabarito pausar|retomar`, SÓ LEITURA.
 *
 * Usa as mesmas funções da guarda (`dist/guarda.js`): o que este CLI chama de "pausado" é o que a guarda nega.
 * Escrever ou remover `.harness/PAUSAR` fica com o modelo, em caminho absoluto, e cai no anel de integridade (`ask`);
 * este script não tem verbo de escrita de propósito (senão viraria o contorno do anel).
 *
 * Saída: uma linha JSON `{pausado, ilegivel, alvo, existentes}`.
 *   alvo        checkout principal da raiz (a própria raiz fora de worktree); null se desconhecido (ponteiro ilegível, sem repo)
 *   existentes  raízes onde `.harness/PAUSAR` existe
 * Sai 0 com raiz resolvida, 2 fora de repositório. Qualquer outra falha (guarda.js ausente, erro inesperado) sai ≠ 0 e ≠ 2,
 * sem JSON: dado ausente ou ferramenta falhando nunca vira "não pausado".
 *
 * Limite medido: `CLAUDE_PROJECT_DIR` não chega ao Bash, então parte do cwd; com `cd` para outro repositório, `alvo` aponta
 * esse repositório (o comando manda parar quando `alvo` não é o da sessão).
 */
import { raizPorFs, raizPrincipal, raizesDePausa, existePausar } from '../dist/guarda.js';

const raizCwd = raizPorFs(process.cwd());
const raizSessao = raizPorFs(process.env.CLAUDE_PROJECT_DIR) ?? raizCwd;
const { raizes, ilegivel } = raizesDePausa(raizSessao, raizCwd);
const existentes = raizes.filter(existePausar);
const principal = raizSessao === null ? null : raizPrincipal(raizSessao);
const alvo = ilegivel || raizSessao === null ? null : (typeof principal === 'string' ? principal : raizSessao);
process.stdout.write(`${JSON.stringify({ pausado: ilegivel || existentes.length > 0, ilegivel, alvo, existentes })}\n`);
process.exit(raizes.length ? 0 : 2);

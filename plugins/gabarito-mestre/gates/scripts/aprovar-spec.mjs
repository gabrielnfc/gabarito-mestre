#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` de `/gabarito-mestre:aprovar` (E4, REQ-PNL-8). STUB da T1 (GM-12): a T8 o implementa.
 *
 * Enquanto for stub, bloqueia sempre e não grava nada: aprovar a spec é ato do dono e o comando existe no hooks.json desde já,
 * então um stub que saísse 0 deixaria o comando "funcionar" sem gravar `spec.aprovada`. Sai 0 e imprime `{decision: 'block', reason}`;
 * `onFailure: block` no hooks.json cobre crash e timeout.
 */
import { readFileSync } from 'node:fs';
import { ehEntrypoint } from '../lib/cli.mjs';

export const BLOQUEIO = { decision: 'block', reason: 'Aprovação recusada: não implementado; nada foi gravado' };

if (ehEntrypoint(import.meta.url)) {
  try { readFileSync(0, 'utf8'); } catch { /* stdin ausente: o stub bloqueia do mesmo jeito */ }
  process.stdout.write(`${JSON.stringify(BLOQUEIO)}\n`);
  process.exitCode = 0;
}

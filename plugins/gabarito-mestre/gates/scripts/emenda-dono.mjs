#!/usr/bin/env node
/**
 * Hook `UserPromptExpansion` do comando humano `/gabarito-mestre:emenda aprovar|rejeitar <seq>` (GM-11, REQ-EME-1).
 *
 * STUB da T1: só existe para o registro em hooks.json ter alvo. Enquanto a T10 não o implementa, o comando da emenda é recusado
 * (`block`, "nada foi gravado"): falha não vira sucesso. Qualquer outro comando sai 0 calado; sem loop ativo (sem `plano.json`) nada muda,
 * porque o matcher de hooks.json já restringe o disparo ao comando da emenda. stdin ausente, não JSON ou não objeto também bloqueia
 * (não dá para saber que o comando não é o nosso), como em `liberar-teto.mjs`. Sai sempre 0: o bloqueio é o JSON.
 */
import { readFileSync } from 'node:fs';
import { ehEntrypoint } from '../lib/cli.mjs';

const COMANDO = 'gabarito-mestre:emenda';

const bloquear = (reason) => ({ decision: 'block', reason: `Emenda recusada: ${reason}` });

/** Núcleo de decisão: devolve o objeto a imprimir, ou `null` para silêncio. Nunca lança. */
export function decidir(texto) {
  try {
    if (texto === null || String(texto).trim() === '') return bloquear('stdin do hook ausente; nada foi gravado');
    let o;
    try { o = JSON.parse(texto); } catch { return bloquear('stdin do hook não é JSON; nada foi gravado'); }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return bloquear('stdin do hook não é um objeto JSON; nada foi gravado');
    if (o.command_name !== COMANDO) return null;
    return bloquear('não implementado; nada foi gravado');
  } catch (e) {
    return bloquear(`o hook falhou (${e instanceof Error ? e.message : String(e)}); nada foi gravado`);
  }
}

function principal() {
  let texto = null;
  try { texto = readFileSync(0, 'utf8'); } catch { texto = null; }
  const saida = decidir(texto);
  if (saida !== null) process.stdout.write(`${JSON.stringify(saida)}\n`);
}

if (ehEntrypoint(import.meta.url)) principal();

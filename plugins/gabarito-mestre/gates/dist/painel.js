/**
 * Painel (E4, GM-12): núcleo puro. T1 entrega só o despacho do render; a projeção (`projetarPainel`, `dependeDeVoce`, `etaDe`, `TABELA_PARAR`) é da T2.
 * Puro: relógio só por `entrada.agoraMs`, fuso só por `entrada.fuso`; sem `fs`, `process` nem `Date.now()`.
 */

import { renderEsquadrao } from './painel-esquadrao.js';
import { renderExecutivo } from './painel-executivo.js';
                                                                    

/** Despacha para o render do preset. Preset desconhecido não vira sucesso: lança (quem chama é o CLI, que já validou a flag). */
export function renderPainel(e              , o              )          {
  if (o.preset === 'esquadrao') return renderEsquadrao(e, o);
  if (o.preset === 'executivo') return renderExecutivo(e, o);
  throw new RangeError(`preset desconhecido: ${String(o.preset)} (esquadrao | executivo)`);
}

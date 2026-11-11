/**
 * Perguntas abertas do painel por gatilho fechado (GM-14, REQ-PRG-1). Núcleo puro.
 * STUB da T1: a T12 implementa. Até lá toda função lança `nao_implementado`.
 */
import type { Evento, IdPergunta } from './tipos.ts';
import type { Trilha } from './trilha.ts';

export type Pergunta = { id: IdPergunta; gatilho: 'a' | 'b' | 'c' | 'd' | 'pendencia'; texto: string; opcoes: string[] };

const naoImplementado = (nome: string): never => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** Perguntas abertas, a mais antiga primeiro. */
export function perguntasAbertas(_eventos: Evento[], _trilha: Trilha): Pergunta[] {
  return naoImplementado('perguntasAbertas');
}

export function respostaValida(_p: Pergunta[], _id: IdPergunta, _opcao: number):
  { ok: true; rotulo: string } | { ok: false; erro: 'inexistente' | 'respondida' | 'opcao_fora' } {
  return naoImplementado('respostaValida');
}

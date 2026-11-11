/**
 * Linha de ferramenta em linguagem natural (GM-14, REQ-CHT-1). Núcleo puro.
 * STUB da T1: a T5 implementa. Até lá toda função lança `nao_implementado`.
 */
export type Chamada = { nome: string; erro: boolean; papel?: string };

const naoImplementado = (nome: string): never => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** 1 linha para o grupo de chamadas; `null` ⇒ o mod devolve `next(e)`. */
export function linhaDoGrupo(_cs: Chamada[]): string | null {
  return naoImplementado('linhaDoGrupo');
}

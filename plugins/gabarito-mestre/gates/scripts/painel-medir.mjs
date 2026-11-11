/**
 * `painel.mjs medir` (GM-14, REQ-DIA-1): único que grava `fato.medido`, e só quando o valor muda.
 * STUB da T1: a T11 implementa. Até lá `medir` lança `Falha('nao_implementado')` sem tocar em nada.
 */

/** Falha com código: o despachante a devolve como `{ok:false, erro, ...}` e rc 1. */
export class Falha extends Error {
  constructor(erro, mensagem) {
    super(mensagem);
    this.erro = erro;
  }
}

const naoImplementado = (nome) => {
  throw new Falha('nao_implementado', `${nome}: ainda não implementado (GM-14)`);
};

/** → { ok, gravados: ChaveFato[], falhas: string[] } */
export function medir(_cwd, _opcoes = {}) {
  return naoImplementado('painel.mjs medir');
}

/**
 * `onboarding.mjs herdar --root <d> [--gravar]` (GM-14, REQ-ONB-3 a): regras da 1.x com origem, só leitura das fontes.
 * STUB da T1: a T8 implementa. Até lá `herdar` lança `Falha('nao_implementado')` sem tocar em nada.
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

/** → { candidatos: [{ id, trecho, origem: '<arquivo>:<linha>', tipo }], fora: number } */
export function herdar(_raiz, _opcoes = {}) {
  return naoImplementado('onboarding.mjs herdar');
}

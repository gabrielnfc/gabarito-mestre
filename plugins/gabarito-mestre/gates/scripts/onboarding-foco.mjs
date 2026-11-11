/**
 * `onboarding.mjs foco --root <d> [--sim]` (GM-14, REQ-ONB-2): oferta do modo foco e gravação com ok.
 * STUB da T1: a T9 implementa. Até lá as funções lançam `Falha('nao_implementado')` sem tocar em nada.
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

/** → { oferecer, texto, opcoes, default } */
export function ofertaFoco(_raiz) {
  return naoImplementado('onboarding.mjs foco');
}

/** → { ok, chaves, gitignore, frase, comoVoltar } */
export function gravarFoco(_raiz, _opcoes = {}) {
  return naoImplementado('onboarding.mjs foco --sim');
}

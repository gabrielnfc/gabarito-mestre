/**
 * Hook `PostToolUse` de `AskUserQuestion` (GM-14, REQ-ONB-3 c): resposta do dono a um candidato herdado.
 * STUB da T1: a T19 implementa e liga em `hooks/hooks.json`. Até lá `decidir` lança `Falha('nao_implementado')`.
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

export async function decidir(_texto, _cwd) {
  return naoImplementado('onboarding-resposta');
}

/**
 * Perguntas abertas do painel por gatilho fechado (GM-14, REQ-PRG-1). Núcleo puro.
 * STUB da T1: a T12 implementa. Até lá toda função lança `nao_implementado`.
 */
                                                     
                                          

                                                                                                                         

const naoImplementado = (nome        )        => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** Perguntas abertas, a mais antiga primeiro. */
export function perguntasAbertas(_eventos          , _trilha        )             {
  return naoImplementado('perguntasAbertas');
}

export function respostaValida(_p            , _id            , _opcao        ) 
                                                                                                  {
  return naoImplementado('respostaValida');
}

/**
 * Núcleo do aprendizado (GM-13, REQ-APR-1/3). T1: só o contrato; a implementação é da T2.
 * Cada export lança até lá, para ninguém tomar o stub por sucesso (contrato de falha: dado ausente não vira "0 aprendizados").
 */
                                                           

                                                                                                                 

const naoImplementado = (nome        )        => { throw new Error(`nao_implementado: ${nome} (T2 da E5a)`); };

export function validarAprendizado(_eventosDaEntrega          , _dados                  , _entrega        , _porEntrega                       )                {
  return naoImplementado('validarAprendizado');
}
export function aprendizadosVigentes(_porEntrega                       )                       {
  return naoImplementado('aprendizadosVigentes');
}
/** Só D, com `entra_em` incluindo o destino. */
export function paraDestino(_v                      , _destino        )                       {
  return naoImplementado('paraDestino');
}

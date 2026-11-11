/**
 * Trilha da entrega: 7 fases, marcas e progresso (GM-14, REQ-TRI-1). Núcleo puro.
 * STUB da T1: a T3 implementa. Até lá toda função lança `nao_implementado`.
 */
                                         

export const FASES = Object.freeze(['ideia', 'spec', 'aprovacao', 'plano', 'execucao', 'pr', 'uso']         );
                                          
                                                                                                               
                           
                                                                                                
                                                                                          
  
                      
                                                                                                                       
                                                                                                                    
  

const naoImplementado = (nome        )        => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** ID da entrega pelo último segmento da branch (prefixo de 1 ou 2 tokens que casa `idPadrao` ancorado); `null` sem casamento. */
export function idDaBranch(_branch               , _idPadrao        )                {
  return naoImplementado('idDaBranch');
}

export function trilhaDe(_fatos             , _eventos          )         {
  return naoImplementado('trilhaDe');
}

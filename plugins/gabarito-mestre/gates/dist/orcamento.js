/**
 * Orçamento de linhas do painel e corte por prioridade (GM-14, REQ-GLB-1). Núcleo puro.
 * STUB da T1: a T2 implementa. Até lá toda função lança `nao_implementado`.
 */
                                        

                                                                              

const naoImplementado = (nome        )        => {
  throw Object.assign(new Error(`${nome}: nao_implementado (GM-14)`), { erro: 'nao_implementado' });
};

/** Linhas que cabem: `min(maxRows, ⌊H/2⌋ − 5)`, piso 1; H desconhecido pela regra de REQ-GLB-1. */
export function orcamentoDe(_h                    , _maxRows        )         {
  return naoImplementado('orcamentoDe');
}

/** Linhas de prioridade 1..k, na ordem de exibição (`ordem`), até `orcamento`; prioridade 1 nunca sai. */
export function porPrioridade(_ls                   , _orcamento        )          {
  return naoImplementado('porPrioridade');
}

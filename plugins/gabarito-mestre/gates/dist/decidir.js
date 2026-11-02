/**
 * Decisão por faixa (REQ-GRD-4, D1). Pura: sem I/O, sem `process.env`, sem relógio, sem ler `permission_mode`
 * (Q13: o `ask` chega ao humano em todos os modos). Nunca devolve `allow`.
 *
 * Faixas, da mais grave para a mais leve: deny > ask > mostrar > log > silencio.
 */

import { classificar } from './classificar-alvo.js';
                                                                                                          

// `*` casa qualquer trecho; o resto é literal. Casa o segmento inteiro (Q6).
function casa(padrao        , texto        )          {
  const re = padrao.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}$`).test(texto);
}

function permitido(c               , config                     )          {
  const padroes = config?.permitidos ?? [];
  return c.segmentosProdEscrita.every((seg) => padroes.some((p) => casa(p, seg)));
}

const ROTULO                         = { prod: 'PRODUÇÃO', homolog: 'HOMOLOG', desconhecido: 'ALVO NÃO VERIFICADO', teste: 'TESTE' };

function mensagemMostrar(c               )         {
  const verbo = c.acao === 'leitura' ? 'leu' : c.acao === 'escrita' ? 'escreveu em' : 'executou em';
  return `${verbo} ${ROTULO[c.ambiente]} · ${c.alvo} · permitido`;
}

function dadosDe(c               )                          {
  const dados                          = { ambiente: c.ambiente, acao: c.acao, alvo: c.alvo };
  if (c.anel) dados.anel = c.anel;
  return dados;
}

export function decidir(entrada             , config                     , contexto          )          {
  const c = classificar(entrada, config, contexto);
  const subagent = entrada?.agent_id !== undefined && entrada?.agent_id !== '';
  const dados = dadosDe(c);

  const barrar = (rotulo        )          =>
    subagent
      ? {
          classificacao: c,
          faixa: 'deny',
          permissionDecision: 'deny',
          evento: { tipo: 'guarda.deny', dados },
          systemMessage: null,
          motivo: `${rotulo} em ${c.alvo}: só o orquestrador pode pedir; subagent não opera aqui`,
        }
      : {
          classificacao: c,
          faixa: 'ask',
          permissionDecision: 'ask',
          evento: { tipo: 'guarda.ask', dados },
          systemMessage: null,
          motivo: `${rotulo} em ${c.alvo} exige confirmação humana`,
        };

  // O anel vem antes do ambiente.
  if (c.anel === 'segredo') return barrar('segredo');
  if (c.anel === 'integridade') return barrar('integridade');

  if (c.segmentosProdEscrita.length > 0 && !(!subagent && permitido(c, config))) return barrar('escrita em PRODUÇÃO');

  const mostra = c.ambiente !== 'teste' && c.alvo !== '';
  if (mostra) {
    const tipo             = c.destrutivo && c.ambiente !== 'desconhecido' ? 'operacao.destrutiva' : 'producao.acesso';
    return { classificacao: c, faixa: 'mostrar', evento: { tipo, dados }, systemMessage: mensagemMostrar(c), motivo: null };
  }
  if (c.destrutivo) return { classificacao: c, faixa: 'log', evento: { tipo: 'operacao.destrutiva', dados }, systemMessage: null, motivo: null };
  return { classificacao: c, faixa: 'silencio', evento: null, systemMessage: null, motivo: null };
}

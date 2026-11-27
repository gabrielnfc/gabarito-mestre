/**
 * Decisão por faixa (REQ-GRD-4, D1). Pura: sem I/O, sem `process.env`, sem relógio, sem ler `permission_mode`
 * (Q13: o `ask` chega ao humano em todos os modos). Nunca devolve `allow`.
 *
 * Faixas, da mais grave para a mais leve: deny > ask > mostrar > log > silencio.
 */

import { classificar } from './classificar-alvo.js';
import { TETO_COMANDO } from './aneis.js';
                                                                                                          

// `*` casa qualquer trecho; o resto é literal. Casa o segmento inteiro (Q6).
function casa(padrao        , texto        )          {
  const re = padrao.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}$`).test(texto);
}

function permitido(c               , config                     )          {
  const padroes = config?.permitidos ?? [];
  return c.segmentosProd.every((seg) => padroes.some((p) => casa(p, seg)));
}

const ROTULO_ACAO                         = { leitura: 'leitura', escrita: 'escrita', execucao: 'execução' };
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

function decidirConteudo(entrada             , config                     , contexto          )          {
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

  // Q26: prod com qualquer ação pede; `permitidos` (só orquestrador) precisa casar todo segmento prod.
  if (c.segmentosProd.length > 0 && !(!subagent && permitido(c, config))) return barrar(`${ROTULO_ACAO[c.acao]} em PRODUÇÃO`);

  const mostra = c.ambiente !== 'teste' && c.alvo !== '';
  if (mostra) {
    const tipo             = c.destrutivo && c.ambiente !== 'desconhecido' ? 'operacao.destrutiva' : 'producao.acesso';
    return { classificacao: c, faixa: 'mostrar', evento: { tipo, dados }, systemMessage: mensagemMostrar(c), motivo: null };
  }
  if (c.destrutivo) return { classificacao: c, faixa: 'log', evento: { tipo: 'operacao.destrutiva', dados }, systemMessage: null, motivo: null };
  return { classificacao: c, faixa: 'silencio', evento: null, systemMessage: null, motivo: null };
}

/**
 * Q17: comando Bash acima do teto não foi lido inteiro (`segmentar` só vê o início). Sem poder inspecionar, pede:
 * orquestrador ⇒ `ask`, subagent ⇒ `deny`. `ask`/`deny` do prefixo prevalece. O evento leva `motivo` e `chars`, nunca o comando.
 */
function decidirComTeto(entrada             , config                     , contexto          )          {
  const d = decidirConteudo(entrada, config, contexto);
  if (d.faixa === 'ask' || d.faixa === 'deny') return d;
  const comando = entrada?.tool_name === 'Bash' && typeof entrada?.tool_input === 'object' && entrada.tool_input !== null ? entrada.tool_input.command : undefined;
  if (typeof comando !== 'string') return d;
  const longo = comando.length > TETO_COMANDO;
  if (!longo && d.classificacao.cdPerdido !== true) return d;
  const subagent = entrada.agent_id !== undefined && entrada.agent_id !== '';
  const dados = { ...dadosDe(d.classificacao), motivo: 'teto', chars: comando.length };
  const motivo = longo
    ? 'comando acima de 64 KB: a guarda só lê o início e não consegue inspecionar o resto; reduza ou grave o script por Write'
    : 'cadeia de cd longa demais: a guarda perdeu o diretório corrente e não consegue inspecionar o resto; reduza ou grave o script por Write';
  return subagent
    ? { classificacao: d.classificacao, faixa: 'deny', permissionDecision: 'deny', evento: { tipo: 'guarda.deny', dados }, systemMessage: null, motivo }
    : { classificacao: d.classificacao, faixa: 'ask', permissionDecision: 'ask', evento: { tipo: 'guarda.ask', dados }, systemMessage: null, motivo };
}

/**
 * Nível da autonomia (GM-22 DT2, DT8): `publica` = config de origin/HEAD com `guarda.autonomia: orquestrador` E `entrega.autonomia: true`,
 * mais o interruptor da máquina; `trabalha` = a mesma guarda e o interruptor, sem `entrega.autonomia`; `nenhuma` = o resto.
 */
                                                                

/** Texto fixo que o `ask` ao orquestrador ganha com nível ≠ `nenhuma` (DT7, REQ-PUB-3): diz o que a autonomia cala desde a 2.3.1. */
const SUFIXO_AUTONOMIA =
  ' · autonomia (2.3.1): cala só publicar (push e merge na branch de produção, deploy), e só com a resposta "publica"; produção de terceiro, delete em massa, harness e push sem hooks sempre perguntam';

/**
 * Autonomia do orquestrador (D-G52, DT2, DT6; dono, GM-22): a autonomia passa a valer só para entrega/deploy. Só o nível `publica` cala, e só
 * um `ask` de PUBLICAR (`classificacao.publicar`: forma fechada de push, merge ou deploy na branch de produção, 1 segmento, não destrutivo,
 * sem anel): vira passagem silenciosa e grava `guarda.autonomia_usada` com os mesmos `dados` (só {acao, alvo, ambiente}, nunca o comando).
 * Continuam `ask` em todo nível: segredo, integridade (inclui a escrita no interruptor, que revoga a emenda de 2026-11-12), push sem hooks,
 * produção de terceiro, delete em massa e destrutivo, comando misto, o comando acima do teto (Q17) ou com `cd` perdido, onde a guarda não
 * leu tudo, e a exceção da guarda (Q21). `trabalha` não cala nada (o rótulo dela é "espere o meu pode para publicar"). O subagent não muda
 * (`deny`, igual nos 3 níveis). Com nível ≠ `nenhuma`, todo `ask` ao orquestrador ganha o sufixo fixo (DT7); `nenhuma` devolve o motivo de hoje.
 */
export function decidir(entrada             , config                     , contexto          , nivel                 = 'nenhuma')          {
  const d = decidirComTeto(entrada, config, contexto);
  if (d.faixa !== 'ask') return d;
  if (nivel === 'nenhuma') return d;
  const c = d.classificacao;
  const comando = entrada?.tool_name === 'Bash' && typeof entrada?.tool_input === 'object' && entrada.tool_input !== null ? entrada.tool_input.command : undefined;
  const naoLeuTudo = typeof comando === 'string' && (comando.length > TETO_COMANDO || c.cdPerdido === true);
  if (nivel === 'publica' && c.publicar && !c.destrutivo && c.anel === null && !naoLeuTudo) {
    const dados = d.evento?.dados ?? dadosDe(c);
    return { classificacao: c, faixa: 'silencio', evento: { tipo: 'guarda.autonomia_usada', dados }, systemMessage: null, motivo: null };
  }
  return { ...d, motivo: `${d.motivo ?? ''}${SUFIXO_AUTONOMIA}` };
}

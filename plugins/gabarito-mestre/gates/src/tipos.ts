/**
 * Contratos de tipos da guarda 2.0 (E1). Só tipos: nenhum código em tempo de execução.
 * Consumidores: classificar-alvo, decidir, diario, guarda e seus testes.
 */

export type Ambiente = 'teste' | 'homolog' | 'prod' | 'desconhecido';
export type Acao = 'leitura' | 'escrita' | 'execucao';
export type Faixa = 'silencio' | 'log' | 'mostrar' | 'ask' | 'deny';
export type TipoEvento =
  | 'producao.acesso'
  | 'operacao.destrutiva'
  | 'guarda.deny'
  | 'guarda.ask'
  | 'sessao.inicio'
  | 'guarda.heartbeat'
  | 'diario.recusa'
  | 'task.iniciada'
  | 'task.concluida'
  | 'review.veredito'
  | 'task.integrada'
  | 'task.reaberta'
  | 'ci.resultado'
  | 'loop.parar'
  | 'loop.pausa'
  | 'custo.medicao'
  | 'sessao.pouso'
  | 'sessao.retomada'
  // E3 (GM-11): Sombra, emendas e entrega
  | 'sombra.consulta'
  | 'decisao.sombra'
  | 'desvio'
  | 'descoberta'
  | 'emenda.proposta'
  | 'spec.emendada'
  | 'emenda.rejeitada'
  | 'entrega.inicio'
  | 'entrega.smoke'
  | 'entrega.rollback'
  | 'entrega.fim'
  | 'entrega.agendada';
export type Fonte = 'origin' | 'local';
export type AmbienteDecl = {
  hosts?: string[];
  projetos?: string[];
  bancos?: string[];
  mcps?: string[];
  variaveis?: string[];
  branches?: string[];
};
export type ConfigGuarda = {
  ambientes: Partial<Record<'teste' | 'homolog' | 'prod', AmbienteDecl>>;
  permitidos: string[];
};
export type Contexto = {
  branchAtual: string | null;
  refLinkado: string | null;
  remoteUrl: string | null;
  raiz: string | null;
  pluginRoot: string | null;
};
export type EntradaHook = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  agent_id?: string;
  agent_type?: string;
  permission_mode?: string;
  session_id?: string;
  cwd?: string;
};
export type Classificacao = {
  ambiente: Ambiente;
  acao: Acao;
  alvo: string;
  destrutivo: boolean;
  anel: 'segredo' | 'integridade' | null;
  /** Q26/Q6: todo segmento `prod`, de qualquer ação (Bash: o segmento cru; MCP: o nome da tool). */
  segmentosProd: string[];
  /** Q17: a cadeia de `cd` passou de LIMITE_CD e a guarda perdeu o diretório corrente (só Bash). */
  cdPerdido?: boolean;
};
export type Decisao = {
  classificacao: Classificacao;
  faixa: Faixa;
  permissionDecision?: 'ask' | 'deny';
  evento: { tipo: TipoEvento; dados: Record<string, unknown> } | null;
  systemMessage: string | null;
  motivo: string | null;
};
export type Evento = {
  seq: number;
  ts: string;
  autor: string;
  sessao: string;
  agente: string;
  tipo: TipoEvento;
  dados: Record<string, unknown>;
  hash_anterior: string | null;
};

// E2 (GM-10): plano como dado e contratos do loop. `dados` do diário nunca carrega comando cru.
// `task.reaberta`: `dados = {task, origem: 'dono' | 'retomada'}`; só `dono`, por comando humano, libera o teto.
export type Causa = 'regra_negocio' | 'tecnica';
export type OrigemJulgamento = 'dono' | 'sombra';
export type PoliticaEntrega = 'continua' | 'janela' | 'sob_demanda';
/** `dias` 0-6, `inicio`/`fim` `HH:MM`, `fuso` IANA. */
export type Janela = { dias: number[]; inicio: string; fim: string; fuso: string };
/** `politica_entrega` do plano só aperta o que o config de `origin/HEAD` declara; afrouxar é recusado (T4, não daqui). */
export type PoliticaPlano = { politica?: PoliticaEntrega; exige_prod: boolean; janela?: Janela };
export type TaskPlano = { id: string; deps: string[]; arquivos: string[]; reqs?: string[]; teste_afetado?: string; mutacoes?: string };
export type Plano = { entrega: string; spec?: string; politica_entrega?: PoliticaPlano; tasks: TaskPlano[] };
export type Sinais = {
  slots: number;
  percent: number | null;
  x: number;
  pausado: boolean;
  vivos: number;
  tokens: number | null;
  tetoTokens: number | null;
  podePousar: boolean;
  /** Ausente = não avaliada: a cláusula de `janela_ausente` não se aplica. Só `loop.mjs proxima` (T10) preenche, com a política efetiva de origin; a entrega reconfere em `decidirEntrega`. */
  politica?: PoliticaEntrega;
};
export type Papel = 'implementador' | 'revisor' | 'correcao';
export type MotivoParar =
  | 'teto_rodadas'
  | 'ci_vermelho'
  | 'teto_tokens'
  | 'sem_pouso'
  | 'sem_progresso'
  | 'diario_invalido'
  | 'nao_conseguiu'
  | 'smoke'
  | 'rollback'
  | 'janela_ausente';
/** Proposta de emenda aberta: `seq` na sessão fixa `emendas` e o REQ que ela congela. */
export type PropostaAberta = { seq: number; req: string };
/** Papel de custo/modelo (REQ-MOD-1); distinto de `Papel`, que é o papel de uma task do loop. */
export type PapelModelo = 'implementador' | 'revisor' | 'sombra' | 'revisor_final' | 'spike' | 'basico';
export type AcaoLoop =
  | { tipo: 'despachar'; itens: { task: string; papel: Papel }[] }
  | { tipo: 'integrar'; tasks: string[] }
  | { tipo: 'esperar'; motivo: string; propostas?: PropostaAberta[] }
  | { tipo: 'pousar' }
  | { tipo: 'parar'; motivo: MotivoParar; task?: string }
  | { tipo: 'concluir' };

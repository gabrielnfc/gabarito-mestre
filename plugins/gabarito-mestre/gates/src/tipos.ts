/**
 * Contratos de tipos da guarda 2.0 (E1). Só tipos: nenhum código em tempo de execução.
 * Consumidores: classificar-alvo, decidir, diario, guarda e seus testes.
 */

import type { DecisaoEntrega } from './entrega.ts';
import type { EstadoTask } from './loop.ts';

export type Ambiente = 'teste' | 'homolog' | 'prod' | 'desconhecido';
/** Ação da ferramenta sobre o alvo (guarda). `Acao` é o botão do painel (E4); este era `Acao` até GM-12 T1. */
export type AcaoFerramenta = 'leitura' | 'escrita' | 'execucao';
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
  | 'entrega.agendada'
  // E4 (GM-12): painel
  | 'spec.aprovada'
  | 'entrega.devolvida'
  // E5a (GM-13): aprendizado, fechamento sem regra e mensagem do dono
  | 'aprendizado'
  | 'aprendizado.nada'
  | 'dono.mensagem';
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
  acao: AcaoFerramenta;
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
/** `titulo` (E4): ≤ 40 colunas, sem caractere de controle; só o painel o lê. */
export type TaskPlano = { id: string; deps: string[]; arquivos: string[]; reqs?: string[]; teste_afetado?: string; mutacoes?: string; titulo?: string };
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
// E5a (GM-13): aprendizado. `substitui.entrega` casa `^[A-Z]+-\d+$` (D-4); ausente = entrega corrente.
export type RefEvento = { sessao: string; seq: number };
export type RefAprendizado = RefEvento & { entrega?: string };
export type DadosAprendizado = {
  tipo: 'E' | 'A'; status: 'D' | 'M'; gatilho: RefEvento | null;
  evidencia: { eventos?: RefEvento[]; medicao?: { fonte: string; numero: number } };
  regra: string; entra_em: string[]; substitui?: RefAprendizado;
};
export type TipoGatilho = 'review' | 'parar' | 'fechamento' | 'dono';
export type Pendencia = RefEvento & { tipo: TipoGatilho };
export type PerfilModelo = 'economia' | 'padrao' | 'qualidade';
/** Proposta de emenda aberta: `seq` na sessão fixa `emendas` e o REQ que ela congela. */
export type PropostaAberta = { seq: number; req: string };
/** Papel de custo/modelo (REQ-MOD-1); distinto de `Papel`, que é o papel de uma task do loop. */
export type PapelModelo = 'implementador' | 'revisor' | 'sombra' | 'revisor_final' | 'spike' | 'basico';
export type AcaoLoop =
  | { tipo: 'despachar'; itens: { task: string; papel: Papel }[] }
  | { tipo: 'integrar'; tasks: string[] }
  | { tipo: 'esperar'; motivo: string; propostas?: PropostaAberta[] }
  | { tipo: 'pousar' }
  | { tipo: 'aprender'; pendencias: Pendencia[] }
  | { tipo: 'parar'; motivo: MotivoParar; task?: string }
  | { tipo: 'concluir' };

// E4 (GM-12): contratos do painel. Núcleo puro em `painel*.ts`; `EntradaPainel` é o que o CLI (`painel.mjs`) monta, `EstadoPainel` o que o render lê.
export type CorTema = 'success' | 'warning' | 'error' | 'inactive' | 'planMode' | 'claude' | 'suggestion' | 'remember' | 'autoAccept' | 'ide';
export type Segmento = { texto: string; cor?: CorTema };
export type Linha = Segmento[];
export type PacoteNomes = { nome: string; lider: string; sabio: string; nomes: string[] };
export type UsoAgente = { contexto: number; tok: number; modelo: string | null };
export type AgenteVivo = { id: string; type: string; description: string; status: string; uso: UsoAgente | null };
/** `fuso`, `entregaId`, `modeloSessao`, `specSha` e `tetoSombra` só o CLI preenche (Sombra 5); o mod nunca. */
export type EntradaPainel = {
  /** Só preenchida pelo CLI com o loop em `concluir` (toda task integrada e sem proposta aberta). */
  decisaoEntrega: DecisaoEntrega | null;
  pausado: boolean;
  contexto: { percent: number | null; tokens: number | null; window: number | null };
  limites: { h5: number | null; d7: number | null };
  x: number;
  /** `null` = sem mod (CLI sem `--agentes`): sem linha `◌ sem agente` e `agentes —`. `[]` = mod presente e nenhum vivo. */
  agentes: AgenteVivo[] | null;
  pacote: PacoteNomes;
  notificacao: { ts: string } | { motivo: string } | null;
  agoraMs: number;
  fuso: string;
  titulo: string | null;
  politica: { politica: PoliticaEntrega; dias: number[] | null };
  entregaId: string;
  modeloSessao: string | null;
  /** sha256 atual de `plano.spec`. */
  specSha: string | null;
  /** `sombra.teto` de origin (26 padrão). */
  tetoSombra: number;
};
/** Botão do painel: `comando` null quando a ação é uma instrução ao dono, sem comando que a execute. (Não confundir com `AcaoFerramenta`.) */
export type Acao = { rotulo: string; comando: string | null };
export type ItemDepende = { nivel: 'parar' | 'dono'; motivo: string; acoes: Acao[] };
export type GlifoTask = '✓' | '●' | '◐' | '○' | '✗';
export type TaskPainel = { id: string; titulo?: string; estado: EstadoTask; glifo: GlifoTask; nome?: string; papel?: Papel; modelo?: string; desdeS?: number; deps: string[] };
export type AgentePainel = {
  nome: string | null; papel: Papel | null; task?: string; estadoTask: EstadoTask | null; modelo: string | null;
  ctxPct: number | null; ctxTok: number | null; tok: number | null; desdeS: number | null; cor: CorTema;
  /** `true` = agente vivo (`●`); `false` = task em voo sem agente de papel compatível (`◌ sem agente`). */
  vivo: boolean;
};
export type EstadoPainel = {
  id: string; titulo: string | null; pacote: string;
  plano: {
    tasks: TaskPainel[]; feitas: number; total: number; pct: number;
    eta: { hora: string; restanteS: number; maisMenosS: number; n: number } | null; rodadaMedia: number | null; medianaS: number | null;
  };
  equipe: {
    lider: { nome: string; modelo: string | null; ctx: number | null; x: number; tok: number | null; h5: number | null; d7: number | null; narrativa: string };
    agentes: AgentePainel[];
    /** `null` = sem mod (`entrada.agentes === null`); senão o nº de `agentes` com `vivo: true` (inclui `sem task`, exclui `◌ sem agente`). */
    vivos: number | null;
    /** Sombra 6: `nome` null antes do 1º despacho do par (task, revisor); `mutacoesHoje`/`mortasHoje` null sem integração de hoje com `mutacoes`. */
    revisoresAguardando: { nome: string | null; task: string; mutacoesHoje: number | null; mortasHoje: number | null }[];
    sombra: { nome: string; modelo: string | null; decisoes: number; ultima: { seq: number; resposta: string; fonte: string | null } | null };
  };
  parado: boolean;
  /** `chave` identifica a ocorrência do Parar (o mod avisa 1× por chave); `hora` é `hh:mm`, `dd/mm hh:mm` ou `--:--` (sem evento com hora legível). */
  parar: { motivo: MotivoParar; texto: string; acoes: Acao[]; hora: string; chave: string; emVoo: string[]; alteracoes: number } | null;
  depende: ItemDepende[]; atencao: string[];
  historico: { glifo: string; texto: string; hora: string; cor: CorTema }[]; ocultos: number;
  rodape: { ci: { verde: boolean | null; execucoesHoje: number }; prod: { leituras: number; alteracoes: number }; politica: string };
  /** Já convertida por `horaLocal`: o render não conhece o fuso. */
  notificacao: { hora: string } | { motivo: string } | null; qualidade: { rodadaMedia: number | null; mortas: number | null };
};
export type OpcoesRender = { preset: 'esquadrao' | 'executivo'; tema: 'color' | 'mono'; narracao: boolean; largura: number;
  /** T14b: linhas que a superfície dá ao corpo (`props.scroll.bodyRows` da Pane). Ausente ⇒ saída byte a byte igual à sem altura; presente e menor que o desenho ⇒ densidade por altura (REQ-PNL-9, emenda D-R4). */
  altura?: number };

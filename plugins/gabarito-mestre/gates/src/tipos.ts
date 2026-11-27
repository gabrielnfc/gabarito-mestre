/**
 * Contratos de tipos da guarda 2.0 (E1). Só tipos: nenhum código em tempo de execução.
 * Consumidores: classificar-alvo, decidir, diario, guarda e seus testes.
 */

import type { DecisaoEntrega } from './entrega.ts';
import type { EstadoTask } from './loop.ts';
import type { Pergunta } from './perguntas.ts';
import type { Trilha } from './trilha.ts';

export type Ambiente = 'teste' | 'homolog' | 'prod' | 'desconhecido';
/** Ação da ferramenta sobre o alvo (guarda). `Acao` é o botão do painel (E4); este era `Acao` até GM-12 T1. */
export type AcaoFerramenta = 'leitura' | 'escrita' | 'execucao';
export type Faixa = 'silencio' | 'log' | 'mostrar' | 'ask' | 'deny';
/** `sessao.pouso.tentativa` (GM-14 T53, emenda 53): o mod repete o pouso; NÃO é `sessao.pouso` (nem consome fronteira, nem muda a chave do push). */
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
  | 'sessao.pouso.tentativa'
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
  | 'spec.aplicada'
  | 'entrega.devolvida'
  // E5a (GM-13): aprendizado, fechamento sem regra e mensagem do dono
  | 'aprendizado'
  | 'aprendizado.nada'
  | 'dono.mensagem'
  // GM-14: fato medido, anotação do orquestrador e resposta do dono por botão
  | 'fato.medido'
  | 'nota'
  | 'dono.resposta'
  // GM-15 (T1): adiada/cortada, encerramento e reabertura da entrega, uso da autonomia da guarda
  | 'task.fora'
  | 'entrega.encerrada'
  | 'entrega.reaberta'
  | 'guarda.autonomia_usada'
  // GM-21 (T6, DT8): task herdada de antes do gabarito, com a origem, fora de TIPOS_DE_TASK (o loop nunca a lê como ciclo nem como progresso)
  | 'task.herdada';
export type Fonte = 'origin' | 'local';
export type AmbienteDecl = {
  hosts?: string[];
  projetos?: string[];
  bancos?: string[];
  mcps?: string[];
  variaveis?: string[];
  branches?: string[];
};
/** GM-15 (REQ-AUT-2): `guarda.autonomia` do config; lida só de `origin/HEAD`, ausente = `nenhuma`. */
export type AutonomiaGuarda = 'nenhuma' | 'orquestrador';
export type ConfigGuarda = {
  ambientes: Partial<Record<'teste' | 'homolog' | 'prod', AmbienteDecl>>;
  permitidos: string[];
  autonomia?: AutonomiaGuarda;
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
  /**
   * GM-22 (DT1): o comando tem 1 segmento só, passa o portão de caracteres e é uma das 3 formas fechadas de publicar
   * (`git push` a branch prod sem `+`/`:`/flags fora da lista, `gh pr merge` em prod, `vercel` deploy/promote/rollback).
   * Fail-closed: o que não está na lista é produção de terceiro. Anel ⇒ `false`. Ainda não muda decisão (T3).
   */
  publicar: boolean;
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
// `task.reaberta`: `dados = {task, origem: 'dono' | 'retomada'}` ou `{task, origem: 'sombra', hash, abordagem_nova?}`. `dono`, por comando humano, libera o teto;
// `sombra` (GM-14 T36, FIEL-15; GM-15 T36: sem limite numérico) libera com `sombra.libera_teto: true` em origin e a decisão `hash` com `libera: true`; sem progresso medido só com `abordagem_nova`;
// os freios (2 abordagens novas sem convergir, orçamento 3× a mediana) passam a task ao dono (`freioDaLiberacao`).
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
  evidencia: { eventos?: RefEvento[]; medicao?: { fonte: string; numero: number }; confirmacao?: Confirmacao };
  regra: string; entra_em: string[]; substitui?: RefAprendizado;
};
export type TipoGatilho = 'review' | 'parar' | 'fechamento' | 'dono';
export type Pendencia = RefEvento & { tipo: TipoGatilho };
export type PerfilModelo = 'economia' | 'padrao' | 'qualidade';
/** Proposta de emenda aberta: `seq` na sessão fixa `emendas` e o REQ que ela congela. */
export type PropostaAberta = { seq: number; req: string };
/** Papel de custo/modelo (REQ-MOD-1); distinto de `Papel`, que é o papel de uma task do loop. */
export type PapelModelo = 'implementador' | 'revisor' | 'sombra' | 'revisor_final' | 'spike' | 'basico' | 'orquestrador';
export type AcaoLoop =
  | { tipo: 'despachar'; itens: { task: string; papel: Papel }[] }
  | { tipo: 'integrar'; tasks: string[] }
  | { tipo: 'esperar'; motivo: string; propostas?: PropostaAberta[] }
  | { tipo: 'pousar' }
  | { tipo: 'aprender'; pendencias: Pendencia[] }
  | { tipo: 'parar'; motivo: MotivoParar; task?: string }
  /** GM-15 T12/T13 (REQ-AUT-1): reabertura única de task em voo cujo agente morreu (`loop.mjs reabrir`, `task.reaberta {origem: retomada}`). */
  | { tipo: 'retomar'; task: string }
  | { tipo: 'concluir' };

// E4 (GM-12): contratos do painel. Núcleo puro em `painel*.ts`; `EntradaPainel` é o que o CLI (`painel.mjs`) monta, `EstadoPainel` o que o render lê.
export type CorTema = 'success' | 'warning' | 'error' | 'inactive' | 'planMode' | 'claude' | 'suggestion' | 'remember' | 'autoAccept' | 'ide';
export type Segmento = { texto: string; cor?: CorTema };
export type Linha = Segmento[];
export type PacoteNomes = { nome: string; lider: string; sabio: string; nomes: string[] };
export type UsoAgente = { contexto: number; tok: number; modelo: string | null };
/** `nome`/`vistoEm` (GM-14 FIEL-3 d): vêm de `nomes` do stdin de `--agentes` (o `$.store` do mod); ausentes no CLI e na 2.0.0. */
export type AgenteVivo = { id: string; type: string; description: string; status: string; uso: UsoAgente | null; nome?: string; vistoEm?: number };
/** stdin de `painel.mjs estado|texto --agentes`, campo `nomes` (GM-14 FIEL-3 d): `agent_id` ⇒ nome estável e 1ª vez que o mod o viu (ms). Teto 64. */
export type NomesAgentes = { [agentId: string]: { nome: string; vistoEm: number } };
/** stdin de `--agentes`, `acoes` (FIEL-11 b, T35): a última ação ao vivo de cada agente; `fonte` diz de onde veio (`tool.call` ou `Bash`). */
export type AcoesAgentes = { [agentId: string]: { texto: string; fonte: 'tool' | 'bash'; em: number } };
/** stdin de `--agentes`, `segundoPlano` (FIEL-11 c): `dono` = `orquestrador` ou o `agent_id`; `desde` em ms. */
export type SegundoPlanoItem = { id: string; dono: string; texto: string; desde: number };
/**
 * GM-15 T30 (D-G2, h.2): a previsão do PRONTO. `hora`/`base` sempre; o resto só quando a previsão exata foi medida (sem ela, a conta antiga D5).
 * `conta` é a base da conta, a MESMA dos números (g.14): tasks do caminho crítico, min/task medidos por etapa, rodada média, fechamento (s, `null` =
 * não medido), ocupação do relógio e ritmo (min/task no último dia). `faixa.ate` `'?'` = fechamento não medido (h.1), com o `motivo`.
 */
export type PrevisaoPronto = {
  hora: string;
  base: number;
  faixa?: { de: string; ate: string };
  conta?: { caminho: number; minPorTask: number; rodadas: number | null; fechamentoS: number | null; ocupacao: number; ritmoMin: number | null };
  motivo?: string | null;
  restanteS?: number;
  maisMenosS?: number;
};
/** `fuso`, `entregaId`, `modeloSessao` e `specSha` só o CLI preenche (Sombra 5); o mod nunca. */
export type EntradaPainel = {
  /** Só preenchida pelo CLI com o loop em `concluir` (toda task integrada e sem proposta aberta). */
  decisaoEntrega: DecisaoEntrega | null;
  pausado: boolean;
  contexto: { percent: number | null; tokens: number | null; window: number | null };
  limites: { h5: number | null; d7: number | null };
  x: number;
  /** `null` = sem mod (CLI sem `--agentes`): sem linha `◌ sem agente` e `agentes —`. `[]` = mod presente e nenhum vivo. */
  agentes: AgenteVivo[] | null;
  /** GM-14 FIEL-6 a (stdin do mod): ids com `SubagentStop`; saem do AGORA na hora, antes do `status`. Ausente = nenhum. */
  encerrados?: string[];
  /** GM-14 FIEL-11 b: ação ao vivo por `agent_id`; ausente = só o que está registrado. */
  acoes?: AcoesAgentes;
  /** GM-14 FIEL-11 c: trabalhos em segundo plano; ausente = nenhum. */
  segundoPlano?: SegundoPlanoItem[];
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
  /**
   * GM-15 T13 (REQ-AUT-1): config do lote do dono, a MESMA de `loop.mjs proxima` (`configDoLote`: Sombra só de origin/HEAD, entrega de `lerConfigEntrega`);
   * só o CLI preenche. Ausente = sem lote (o DEPENDE de antes, com (5) e (7)).
   */
  configLote?: ConfigLote;
  /** GM-15 T30 (h.1): fechamento medido (s) nas entregas anteriores do repo (`fechamentoDasAnteriores`); só o CLI preenche. Ausente/`null` = não medido. */
  fechamentoS?: number | null;
  /** GM-15 T30 (Emenda 3, fallback): etapas medidas (s) nas entregas anteriores do repo (`etapasDasAnteriores`); só o CLI preenche. Ausente/`null` = sem fallback. */
  etapasAnteriores?: { impl: number[]; rev: number[]; integ: number[] } | null;
  /** GM-15 T30 (Emenda 3, fallback, r2 MAJOR 1): ritmo (s por task integrada) das entregas anteriores (`ritmoDasAnteriores`); só o CLI preenche. Ausente/`null` ⇒ fallback em "?". */
  ritmoAnterioresS?: number | null;
  /**
   * GM-15 T9 (REQ-ENT-2): o `plano.json` da entrega existe e não vale (o motivo, de `carregarPlano`). Só o CLI preenche. Presente ⇒ o painel não tem plano
   * (nada do plano velho), mostra "?" com o motivo e não julga o diário pelas tasks de plano nenhum (sem PAROU `diario_invalido` por isso).
   */
  planoInvalido?: string | null;
};
/** Botão do painel: `comando` null quando a ação é uma instrução ao dono, sem comando que a execute. (Não confundir com `AcaoFerramenta`.) */
export type Acao = { rotulo: string; comando: string | null };
/** GM-15 T13 (REQ-AUT-1): o que o lote do dono lê da config (Sombra de origin/HEAD; entrega de `lerConfigEntrega`). */
export type ConfigLote = { liberaTeto: boolean; julgaEmendas: boolean; autonomiaEntrega: boolean; base: string; versaoPlugin?: string };
export type ItemDepende = { nivel: 'parar' | 'dono'; motivo: string; acoes: Acao[] };
export type GlifoTask = '✓' | '●' | '◐' | '○' | '✗';
export type TaskPainel = { id: string; titulo?: string; estado: EstadoTask; glifo: GlifoTask; nome?: string; papel?: Papel; modelo?: string; desdeS?: number; deps: string[] };
export type AgentePainel = {
  nome: string | null; papel: Papel | null; task?: string; estadoTask: EstadoTask | null; modelo: string | null;
  ctxPct: number | null; ctxTok: number | null; tok: number | null; desdeS: number | null; cor: CorTema;
  /** `true` = agente vivo (`●`); `false` = task em voo sem agente de papel compatível (`◌ sem agente`). */
  vivo: boolean;
  /** GM-14 FIEL-3 b: `description` do despacho, já higienizada (token técnico ⇒ "…"); `null` sem vivo. */
  descricao: string | null;
  /** GM-14 FIEL-3 a: papel mostrado (antigo > tipo > `correcao` em `corrigindo` > estado > tipo sem task); `null` sem papel. */
  papelExibido: 'implementador' | 'revisor' | 'correcao' | 'spike' | 'sombra' | null;
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
    /** GM-14 FIEL-6 b: tasks em `implementando`/`corrigindo`/`em_revisao` sem vivo casado ("esperando o orquestrador" no PLANO). */
    esperando: string[];
    /** GM-14 FIEL-7: `consultasAbertas` = consultas (`contarConsultas`) além das decisões registradas; 0 quando não passa. */
    sombra: { nome: string; modelo: string | null; decisoes: number; ultima: { seq: number; resposta: string; fonte: string | null } | null; consultasAbertas: number };
  };
  parado: boolean;
  /** `chave` identifica a ocorrência do Parar (o mod avisa 1× por chave); `hora` é `hh:mm`, `dd/mm hh:mm` ou `--:--` (sem evento com hora legível). */
  parar: { motivo: MotivoParar; texto: string; acoes: Acao[]; hora: string; chave: string; emVoo: string[]; alteracoes: number } | null;
  depende: ItemDepende[]; atencao: string[];
  /** `origem` (GM-14 T17, REQ-LNG-1): a da tabela fechada de `origemDe`; `null` = tipo fora da tabela. */
  historico: { glifo: string; texto: string; hora: string; cor: CorTema; origem?: string | null }[]; ocultos: number;
  rodape: { ci: { verde: boolean | null; execucoesHoje: number }; prod: { leituras: number; alteracoes: number }; politica: string };
  /** Já convertida por `horaLocal`: o render não conhece o fuso. */
  notificacao: { hora: string } | { motivo: string } | null; qualidade: { rodadaMedia: number | null; mortas: number | null };
  // GM-14 T17 (REQ-GLB-1, FIEL-10..13): estado dos 5 blocos. Presentes só quando `projetarPainel` recebe `fatos`; sem eles o render é o da E4.
  /** `entrega`: plano ou entrega identificada; `projeto`: repo sem entrega identificada; `fora`: fora de um repositório git. */
  modo?: 'entrega' | 'projeto' | 'fora';
  trilha?: Trilha | null;
  /** 1ª pergunta aberta (a mais antiga), sem as pendências (que são itens de `depende`); `perguntasMais` = as outras abertas. */
  pergunta?: Pergunta | null;
  perguntasMais?: number;
  /** FIEL-10 e: sem entrega em curso e nada pendente ⇒ o painel é 1 linha. `estado` em palavras, `null` = não conhecido. */
  umaLinha?: { ultima: { id: string; estado: string | null } | null } | null;
  /** FIEL-10 b, com plano: só integradas pintam; previsão só com ≥ 3 integradas nesta entrega (`base`). */
  pronto?: { integradas: number; total: number; previsao: PrevisaoPronto | null } | null;
  /** FIEL-10 b, sem plano: a trilha em 1 linha. `motivo` = o do 1º `?`; `sufixo` = N17 b (fora da execução). */
  fase?: { numero: number | null; marcas: string[]; motivo: string | null; progresso: string; sufixo: string[] } | null;
  /** FIEL-11: `agentes` `null` = sem dados da sessão (CLI sem `--agentes`, FIEL-4); `contexto` `null` = não medido. */
  agora?: {
    orquestrador: { nome: string | null; contexto: number | null; estimado: boolean; pousar: boolean };
    agentes: AgenteAgora[] | null; segundoPlano: AgenteAgora[];
  };
  /** FIEL-10 d: só resultados, mais novo primeiro (até 5; o render corta 2 acima do input). */
  recente?: ItemRecente[];
  /** FIEL-13 b: segundos desde a última leitura bem-sucedida do diário pelo mod; `null` = não medido. */
  desatualizadoS?: number | null;
  /** Fontes que falharam (nomes naturais), para o DEPENDE nunca dizer "nada" com falha. */
  fontesFalhas?: string[];
  /** GM-15 T8 (REQ-ENT-1 d): a entrega com `entrega.encerrada` vigente (a da branch ou, sem ela, a última conhecida); `versao` X.Y.Z ou `null`. Presente ⇒ o painel é 1 linha. */
  entregue?: Entregue | null;
  /** GM-15 T8 (REQ-ENT-1 d i): a próxima entrega oferecida com a entregue; `acoes` traz o botão "seguir" (vazia em `nenhuma`). */
  proxima?: Proxima | null;
};
/** GM-15 T8 (REQ-ENT-1 d). */
export type Entregue = { id: string; versao: string | null };
/** GM-15 T8: na ordem, a spec com `PBI:` sem `entrega.encerrada` mais nova, as ideias para a próxima ou nenhuma. `texto` em linguagem natural. */
export type Proxima = { tipo: 'spec' | 'ideias' | 'nenhuma'; texto: string; acoes: Acao[] };
/** Papel de quem aparece no AGORA e no RECENTE; o executivo troca o nome por `PAPEL_EXECUTIVO[papel]` (FIEL-12). */
export type PapelPainel = 'orquestrador' | 'implementador' | 'correcao' | 'spike' | 'revisor' | 'sombra' | 'teste';
/** `nome` = nome temático (só com dados da sessão; FIEL-4); `null` ⇒ o render usa o papel. */
export type QuemPainel = { nome: string | null; papel: PapelPainel };
/** Linha do AGORA: `acao` já higienizada (FIEL-3 b); `null` = sem fonte ("?"). */
export type AgenteAgora = { quem: QuemPainel; task: string | null; acao: string | null; desdeS: number | null };
/** Resultado do RECENTE: `quem` (se houver) vem antes do `texto`; `origem` da tabela de REQ-LNG-1. */
export type ItemRecente = { hora: string; glifo: '✓' | '✗' | '●' | '○'; cor: CorTema; quem: QuemPainel | null; texto: string; origem: string };
export type OpcoesRender = { preset: 'esquadrao' | 'executivo'; tema: 'color' | 'mono'; narracao: boolean; largura: number;
  /** T14b: linhas que a superfície dá ao corpo (`props.scroll.bodyRows` da Pane). Ausente ⇒ saída byte a byte igual à sem altura; presente e menor que o desenho ⇒ densidade por altura (REQ-PNL-9, emenda D-R4). */
  altura?: number;
  /** GM-14 T17 (REQ-GLB-1): linhas que cabem (de `orcamentoDe`). Ausente ⇒ `altura`; sem os dois, sem corte (como a E4). Só no estado novo. */
  orcamento?: number;
  /** GM-14 T17: local do painel; o RECENTE mostra até 5 em `lateral` (padrão) e 2 em `acima`. */
  local?: 'lateral' | 'acima' };

// GM-14 (2.1.0): fato medido, nota, resposta do dono e confirmação de regra herdada. Formas fechadas, conferidas por `formaInvalida` no `append`.
export type ChaveFato = 'branch' | 'spec' | 'plano' | 'pr' | 'release' | 'agente';
/**
 * `valor` tem exatamente as chaves da forma de `chave` (campo a mais ⇒ recusa). O `sessao` do evento que carrega um `fato.medido` de sessão
 * é o `session_id` do mod (DP-2): a pergunta (b) se ancora por sessão.
 */
export type DadosFato = { chave: ChaveFato; fonte: 'git' | 'gh' | 'arquivo' | 'mod'; valor:
  { nome: string } | { caminho: string; sha256: string; secoes: number } | { tasks: number } |
  { numero: number; estado: 'aberto' | 'mergeado' | 'fechado'; branch: string } | { tag: string } |
  { id: string; papel: string; estado: string } };
export type TipoNota = 'ideia' | 'desvio' | 'assunto' | 'duvida' | 'pendencia';
/** `texto` 1..160 caracteres, 1 linha; `opcoes` só (e sempre) com `duvida`: 2..4 de 1..60, sem repetição (caixa e espaço das pontas não distinguem). */
export type DadosNota = { tipo: TipoNota; texto: string; opcoes?: string[] };
/** `<sessao>:<seq>` (`ID_PERGUNTA_RE`) ou `herdar:<id>`, id estável do candidato herdado em hex 8..64 (DP-6: origem + sha256 do trecho, nunca índice). */
export type IdPergunta = string;
/** Uma das duas, nunca as duas: rótulo das opções, ou só `{sha256, chars}` do que foi digitado (o texto do dono nunca vai ao diário). */
export type DadosResposta = { pergunta: IdPergunta; opcao: number; rotulo: string } | { pergunta: IdPergunta; sha256: string; chars: number };
/** `fonte` = `<arquivo relativo>:<linha ≥ 1>`; `resposta` aponta a `dono.resposta` que confirmou (D11). */
export type Confirmacao = { fonte: string; resposta: RefEvento };

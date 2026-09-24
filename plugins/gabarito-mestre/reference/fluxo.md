# Fluxo — Workflow TRUE no harness

Fonte normativa do fluxo de trabalho (Flight Levels + Kanban, fase 1: TI e Desenvolvimento). Transcrita de `docs/workflow-true.html` (Flow Management Office, versão de 2026-09-10); onde este arquivo e o HTML divergirem, **este arquivo vence** e o HTML é corrigido. Instalado em `docs/harness/fluxo.md`; não é importado no `CLAUDE.md` — é consultado sob demanda por quem escreve design, plano, card ou conformidade.

Como o harness usa os termos: **Iniciativa = FL3** · **Epic = FL2 = documento de design** · **PBI = FL1 = plano, branch e PR** (ADR-FLX-1: um plano por PBI). Task de plano não é card: é fatia de um PBI. `tipo` de um PBI ∈ {`US`, `Enabler`, `TechDebt`, `Spike`, `Bug`, `Tarefa`}.

O que liga os níveis é o **fio condutor**: todo item operacional existe porque está vinculado a algo tático, que existe porque está vinculado a algo estratégico. Nenhum item é aberto sem vínculo explícito com o nível imediatamente acima. PBI sem Epic, ou Epic sem Iniciativa, é desalinhamento no fluxo, não exceção aceitável (R19).

## 1. Os três níveis

Cada nível tem quadro, cadência e políticas próprias, e nenhum opera isolado. O objetivo é enxergar, em qualquer altitude, como o trabalho flui, onde trava e o que precisa de decisão.

### 1.1 FL3 — Portfólio (estratégia e investimento)

- **Propósito:** decidir onde investir a capacidade da organização e acompanhar se o investimento gera o resultado esperado.
- **O que flui:** Iniciativa / Projeto.
- **Cadência:** revisão mensal, com o comitê de priorização.
- **WIP:** proporcional à capacidade real de execução simultânea; revisado a cada ciclo.
- **DoR (entrada):** problema de negócio e resultado esperado descritos, com patrocinador identificado.
- **DoD (saída):** resultado de negócio validado — não apenas escopo entregue.
- Conecta-se a Epics.

### 1.2 FL2 — Tático (coordenação e sequenciamento)

- **Propósito:** traduzir a intenção estratégica em blocos de entrega sequenciáveis e coordenar dependências entre times.
- **O que flui:** Epic.
- **Cadência:** reposição quinzenal ou por gatilho de capacidade livre; revisão de fluxo quinzenal com líderes técnicos e POs.
- **WIP:** definido por área ou squad e visível no quadro.
- **DoR:** Iniciativa vinculada, com valor e critérios de aceite descritos.
- **DoD:** Epic entregue e validado com o solicitante.
- Recebe direção de Iniciativas; conecta-se aos PBIs.

### 1.3 FL1 — Operacional (execução dentro do time)

- **Propósito:** executar o trabalho do dia a dia com previsibilidade, sinalizando cedo qualquer bloqueio ou dívida técnica.
- **O que flui:** User Story, Enabler, Tech Debt, Spike, Bug, Tarefa.
- **Cadência:** reposição em fluxo contínuo, conforme capacidade livre do time; reunião de fluxo diária, focada em itens travados, não em status individual.
- **WIP:** explícito por coluna do quadro, definido pelo próprio time. No harness: PBIs em voo ≤ WIP FL1 do time; implementadores simultâneos ≤ `orquestracao.paralelismo.simultaneos`.
- **DoR:** Epic vinculado e item concluível em poucos dias. Item executado fora da TI entra com área responsável e prazo acordado.
- **DoD:** validado, testado e liberado conforme o padrão técnico da área. No harness: DoD de PBI = DoD de todas as tasks (`AGENTS.md §7`) + PR mergeada.
- Recebe direção de Epics.

## 2. Os oito tipos de card

Cada tipo existe para um propósito. Template e exemplo vêm da fonte; placeholders entre `[…]`. Os templates prontos para copiar vivem em `templates/fluxo/<tipo>.md`.

### 2.1 Iniciativa / Projeto — FL3

**O que é.** Um resultado de negócio relevante, com escopo, horizonte e investimento associados. Costuma atravessar mais de uma área.
**Quando usar.** Em demandas que exigem coordenação entre times e têm impacto estratégico mensurável.
**Por que existe.** Dá à liderança visibilidade do que está priorizado e por quê, sem entrar no detalhe da execução.
**O card declara** por que a organização vai investir capacidade e como saberá que valeu a pena.
```
TEMPLATE
Problema de Negócio
  Hoje [situação atual], o que causa [impacto no negócio] para [quem é afetado].
Resultado Esperado
  Queremos [resultado desejado] até [horizonte de tempo], medido por [indicador].
Escopo e Horizonte
  Dentro: [o que faz parte].
  Fora: [o que não faz parte].
  Horizonte: [período].
  Patrocinador: [quem responde pela iniciativa].
Critério de Sucesso
  A Iniciativa é considerada bem-sucedida quando [indicador] atingir [meta] em [prazo].
```
```
EXEMPLO
Problema de Negócio
  Hoje as solicitações de TI chegam por WhatsApp, e-mail e conversa de corredor. Não há registro, prazo nem histórico, e a fila é invisível tanto para o time quanto para quem pediu.
Resultado Esperado
  Queremos centralizar as solicitações de TI em um canal único até o fim do trimestre, com prazo acordado por tipo de atendimento e fila visível para as lideranças.
Escopo e Horizonte
  Dentro: portal de chamados, catálogo de serviços, SLA por categoria e base de conhecimento.
  Fora: atendimento a clientes externos e chamados de outras áreas.
  Horizonte: um trimestre.
  Patrocinador: Gerência de TI.
Critério de Sucesso
  A Iniciativa é bem-sucedida quando 80% dos chamados forem abertos pelo portal e o tempo médio de primeira resposta ficar abaixo de 4 horas, medido no segundo mês de operação.
```
### 2.2 Epic — FL2

**O que é.** Um bloco de capacidade com valor perceptível, decomposto de uma Iniciativa e entregável em algumas semanas.
**Quando usar.** Sempre que uma Iniciativa precisa virar trabalho sequenciável para um ou mais times.
**Por que existe.** É o elo entre intenção estratégica e trabalho real, e revela dependências antes que virem bloqueios.
**O card declara** um bloco de valor entregável por um time em algumas semanas, sempre vinculado a uma Iniciativa. No harness, o Epic é o documento de design e **lista os PBIs** (índice), não os planeja.
```
TEMPLATE
Narrativa (Elevator Pitch)
  Para [público ou persona]
  que [necessidade ou problema],
  o [nome do Epic]
  é um [tipo de solução]
  que [benefício principal].
  Diferente de [alternativa atual],
  ele [diferencial].
Regras Gerais de Negócio
  RN01. [regra que vale para todas as histórias deste Epic]
  RN02. [regra de negócio, restrição ou política aplicável]
  RN03. [...]
Critérios Gerais de Aceite
  CA01. [condição observável para o Epic ser considerado entregue]
  CA02. [...]
```
```
EXEMPLO
Narrativa (Elevator Pitch)
  Para os colaboradores da TRUE
  que precisam de suporte de TI e hoje pedem ajuda por canais informais,
  o Portal de Chamados
  é um canal único de atendimento
  que registra, classifica e acompanha cada solicitação até a conclusão.
  Diferente do contato direto com o analista,
  ele garante prazo acordado, histórico e fila visível.
Regras Gerais de Negócio
  RN01. Todo chamado nasce com categoria e criticidade obrigatórias.
  RN02. O prazo de atendimento é definido pela criticidade e não pode ser alterado pelo solicitante.
  RN03. Chamados sem categoria não entram na fila de atendimento.
  RN04. O solicitante recebe notificação a cada mudança de status.
Critérios Gerais de Aceite
  CA01. O colaborador abre e acompanha um chamado sem apoio do time de TI.
  CA02. A fila, o responsável e o prazo estão visíveis para o solicitante e para a liderança.
  CA03. Todo chamado encerrado possui registro de solução consultável.
```
### 2.3 User Story (US) — FL1

**O que é.** Uma necessidade descrita da perspectiva de quem usa, pequena o suficiente para concluir em poucos dias.
**Quando usar.** Para qualquer funcionalidade visível ao usuário que faça parte de um Epic.
**Por que existe.** Mantém o time entregando em fatias pequenas e validáveis, reduzindo o risco de retrabalho.
```
TEMPLATE
Narrativa
  Como [perfil de usuário],
  quero [ação ou capacidade],
  para [benefício ou motivo].
Regras de Negócio
  RN01. [regra específica desta história]
  RN02. [...]
Critérios de Aceite (BDD)
  Cenário: [nome do cenário]
  Dado que [contexto inicial]
  Quando [ação do usuário]
  Então [resultado observável]
```
```
EXEMPLO
Narrativa
  Como colaborador da TRUE,
  quero acompanhar o andamento do meu chamado pelo portal,
  para saber o prazo sem precisar procurar o analista.
Regras de Negócio
  RN01. O solicitante vê apenas os chamados abertos por ele.
  RN02. O prazo exibido considera apenas horário comercial.
  RN03. O histórico mostra data, hora e autor de cada mudança de status.
Critérios de Aceite (BDD)
  Cenário: Acompanhar chamado em andamento
  Dado que tenho um chamado aberto e em atendimento
  Quando acesso a área "Meus chamados" no portal
  Então vejo o status atual, o responsável, o prazo e o histórico de interações

  Cenário: Chamado encerrado
  Dado que meu chamado foi encerrado
  Quando abro o registro
  Então vejo a solução aplicada e a data de encerramento
```
### 2.4 Enabler — FL1

**O que é.** Trabalho técnico que viabiliza entregas futuras, como infraestrutura, arquitetura ou integração.
**Quando usar.** Quando uma capacidade futura depende de uma base técnica que ainda não existe.
**Por que existe.** Torna visível e priorizável um trabalho que, de outra forma, geraria atrito nas entregas seguintes.
```
TEMPLATE
Narrativa
  Para [capacidade ou resultado que isso viabiliza],
  precisamos [trabalho técnico a ser feito].
Critérios de Aceite
  CA01. [evidência objetiva de que a base técnica está pronta]
  CA02. [...]
```
```
EXEMPLO
Narrativa
  Para que o portal seja acessado com a conta corporativa, sem senha nova,
  precisamos habilitar o login único integrado ao diretório de usuários.
Critérios de Aceite
  CA01. Usuário com conta ativa acessa o portal sem informar senha adicional.
  CA02. Usuário desligado perde o acesso automaticamente ao ser desativado no diretório.
  CA03. Integração documentada e validada em ambiente de homologação.
```
### 2.5 Tech Debt — FL1

**O que é.** Uma escolha passada de código, arquitetura ou design que aumenta o custo e o risco das mudanças futuras.
**Quando usar.** Quando algo já existente compromete velocidade, qualidade ou segurança do trabalho atual.
**Por que existe.** Transforma um problema silencioso em item de fluxo visível, em vez de deixá-lo vazar para outros itens.
```
TEMPLATE
Narrativa
  Para [risco, custo ou limitação que queremos eliminar],
  precisamos [correção estrutural a ser feita].
Critérios de Aceite
  CA01. [evidência objetiva de que o débito foi quitado]
  CA02. [...]
```
```
EXEMPLO
Narrativa
  Para reduzir o risco de perda de pedidos quando a integração falha,
  precisamos substituir o processamento agendado por fila com reprocessamento automático.
Critérios de Aceite
  CA01. Falhas de integração são reprocessadas automaticamente, sem intervenção manual.
  CA02. Registros com erro ficam visíveis em painel de acompanhamento.
  CA03. Rotina antiga desativada e removida da agenda de execução.
```
### 2.6 Spike — FL1

**O que é.** Uma investigação com tempo limitado (timebox) para reduzir incerteza técnica ou de negócio.
**Quando usar.** Quando falta informação para estimar ou decidir o caminho de uma US ou de um Epic.
**Por que existe.** Separa descobrir de entregar, protegendo o fluxo de itens com ambiguidade excessiva. No harness, um Spike responde CONFIRMADA/REFUTADA com número (`gabarito-spike`); não implementa.
```
TEMPLATE
Narrativa
  Para [decisão que precisa ser tomada],
  precisamos [investigação a ser feita] em até [timebox].
Critérios de Aceite
  CA01. [entregável da investigação]
  CA02. [recomendação registrada e comunicada]
```
```
EXEMPLO
Narrativa
  Para decidir como sincronizar os cadastros entre o portal e o ERP,
  precisamos comparar as duas abordagens de integração possíveis em até 3 dias.
Critérios de Aceite
  CA01. Documento comparando as abordagens, com riscos, custo e impacto operacional.
  CA02. Recomendação registrada e validada com o líder técnico.
  CA03. Estimativa de esforço para a abordagem recomendada.
```
### 2.7 Bug — FL1

**O que é.** Um comportamento do sistema, em produção ou em ambiente relevante, que diverge do esperado.
**Quando usar.** Quando algo já entregue quebra ou funciona de forma incorreta.
**Por que existe.** Dá visibilidade e prioridade à correção, sem que ela compita de forma invisível com o trabalho novo.
```
TEMPLATE
Falha Observada
  [O que acontece], em [tela, módulo ou ambiente], desde [quando], afetando [quem ou quantos].
Passo a Passo para Reprodução
  1. [passo]
  2. [passo]
  3. [passo]
  4. [resultado obtido]
Comportamento Esperado
  O sistema deveria [comportamento correto], exibindo [mensagem ou retorno esperado].
```
```
EXEMPLO
Falha Observada
  Ao anexar arquivo acima de 5 MB na abertura de chamado, a tela retorna erro genérico e o chamado é salvo sem o anexo. Ocorre em produção desde a última atualização e afeta todos os solicitantes.
Passo a Passo para Reprodução
  1. Acessar o portal com um usuário padrão.
  2. Abrir um novo chamado e preencher os campos obrigatórios.
  3. Anexar um arquivo de 8 MB.
  4. Clicar em "Enviar": a tela exibe "Erro inesperado" e o chamado é criado sem o anexo.
Comportamento Esperado
  O sistema deveria aceitar anexos até o limite configurado e, quando o arquivo exceder esse limite, bloquear o envio informando o tamanho máximo permitido antes de salvar o chamado.
```
### 2.8 Tarefa (fora da TI) — FL1

**O que é.** Entrega de uma área de negócio — Compras, Jurídico, RH, CX, Comercial, Processos — da qual uma entrega do fluxo depende.
**Quando usar.** Quando o próximo passo não é técnico: contrato a assinar, fornecedor a homologar, processo a definir, pessoa a contratar, política a publicar.
**Por que existe.** Traz para o quadro a dependência externa que hoje atrasa entregas em silêncio, com responsável e prazo visíveis. Acompanhada na cadência do nível tático (política 4).
```
TEMPLATE
Narrativa
  Para [capacidade ou entrega que isso viabiliza],
  precisamos [entrega da área de negócio].
Área Responsável e Prazo
  Área: [área que executa].
  Ponto focal: [nome de quem responde pela entrega].
  Prazo acordado: [data combinada].
Critérios de Aceite
  CA01. [evidência objetiva de que a entrega foi concluída]
  CA02. [...]
```
```
EXEMPLO
Narrativa
  Para contratar a ferramenta de monitoramento e liberar a integração com o ambiente,
  precisamos do contrato de serviço assinado com o fornecedor.
Área Responsável e Prazo
  Área: Compras, com apoio do Jurídico.
  Ponto focal: responsável pela negociação com o fornecedor.
  Prazo acordado: 20 dias corridos a partir da proposta aprovada.
Critérios de Aceite
  CA01. Contrato assinado pelas duas partes e arquivado no repositório da área.
  CA02. Ordem de compra emitida e aprovada.
  CA03. Credenciais de acesso liberadas para o time de TI.
```
## 3. Políticas gerais

As regras de cada nível estão em §1. Estas cinco valem para o sistema inteiro e sustentam a conexão entre as três altitudes.

1. **Fio condutor obrigatório.** Nenhum PBI é aberto sem vínculo com um Epic ativo, e nenhum Epic sem vínculo com uma Iniciativa ativa. Uma Iniciativa padrão por repo, com override explícito no Epic (`Iniciativa: <outro ID> (override: <motivo>)`, D4).
2. **Bloqueios escalam por altitude.** Item bloqueado além do combinado no nível operacional sobe para o tático; a mesma regra vale do tático para o estratégico.
3. **Métricas acompanham o fluxo, não a pessoa.** Lead time, cycle time, throughput e envelhecimento são medidos por item, nunca usados para avaliar indivíduos (§7).
4. **Trabalho fora da TI também entra no quadro.** Dependência de área de negócio vira Tarefa (§2.8), com ponto focal e prazo acordado, acompanhada na cadência do nível tático.
5. **Revisão de políticas.** As regras não são definitivas: são revisadas nas cadências de cada nível, com base em dado real de fluxo. No harness, `AGENTS.md §8` registra "políticas de fluxo (`fluxo.md`) revisadas a cada `____`".

## 4. Colunas e regras de movimento

Uma coluna só existe quando representa uma espera ou uma decisão real, e cada uma tem regra objetiva de saída. Enquanto a regra não é cumprida, o card não avança. Entre parênteses, a chave usada em `harness.config.json` (`fluxo.status`) quando a coluna é lida por script.

### 4.1 FL3 — Quadro de Portfólio

| # | Coluna | WIP | Sai quando |
|---|---|---|---|
| 01 | Funil | — | problema de negócio e resultado esperado estão descritos |
| 02 | Descoberta | conta | patrocinador definido e critério de sucesso mensurável |
| 03 | Preparado | — | é priorizada para execução, com capacidade disponível e ao menos um Epic preparado |
| 04 | Em execução | conta | todos os Epics da Iniciativa estão concluídos |
| 05 | Validando resultado | — | o indicador é medido e comparado à meta acordada |
| 06 | Concluído | — | estado final: resultado de negócio validado |

### 4.2 FL2 — Quadro Tático (Epics)

| # | Coluna | WIP | Sai quando |
|---|---|---|---|
| 01 | Backlog | — | entra na fila de refinamento na cadência quinzenal |
| 02 | Em refinamento | conta | narrativa, regras e critérios gerais escritos, dependências mapeadas |
| 03 | Preparado (`preparado`) | — | o time puxa o Epic — nunca por empurrão da liderança |
| 04 | Em execução (`em_execucao`) | conta | todos os PBIs vinculados estão concluídos |
| 05 | Em validação (`em_validacao`) | — | o solicitante registra o aceite |
| 06 | Concluído (`concluido`) | — | estado final: Epic aceito pelo solicitante |

### 4.3 FL1 — Quadro Operacional (PBIs do time)

| # | Coluna | WIP | Sai quando |
|---|---|---|---|
| 01 | Preparado (`preparado`) | — | alguém do time puxa o item e assume a execução |
| 02 | Em execução (`em_execucao`) | conta | o trabalho está pronto para revisão de outra pessoa |
| 03 | Revisão e teste (`revisao`) | conta | revisão aprovada e testes concluídos com sucesso |
| 04 | Pronto para liberar (`pronto`) | — | publicado no ambiente alvo conforme o padrão da área |
| 05 | Concluído (`concluido`) | — | estado final: item liberado e validado |

### 4.4 As cinco regras de movimentação

1. **Todo movimento é puxado.** O card avança quando quem executa a etapa seguinte tem espaço no WIP, não quando alguém decide empurrar.
2. **Quem move é quem executa.** O card é movido por quem está com ele em mãos, não pelo gestor durante a reunião.
3. **Movimento só para frente.** Voltar de coluna é exceção e exige registro do motivo — retrabalho invisível distorce a leitura do fluxo.
4. **Bloqueio é marcação, não coluna.** O card permanece onde está, sinalizado com a data do bloqueio e o responsável pelo desbloqueio. Qualquer impedimento conta: dependência externa, ambiente, review reprovado `rodadasAntesDeEscalar` vezes. No harness, a marcação é uma linha no ledger do PBI: `BLOQUEADA <AAAA-MM-DD> <motivo> — dono: <quem>`. Linha sem `dono:` é bloqueio sem responsável — aviso no cartão de sessão.
5. **Envelhecimento tem limite.** Item parado em uma coluna além do tempo combinado entra na pauta da cadência do nível acima. No harness, o limite é `fluxo.envelhecimentoDias` (default 3): PBI sem movimento há mais dias que isso aparece no cartão de sessão como "envelhecido — pauta do nível acima".

## 5. Propagação entre níveis

O card de um nível muda de estado por causa do que acontece no nível de baixo. Ninguém atualiza os três quadros na mão.

| Quando | Então |
|---|---|
| primeiro PBI entra em Em execução (FL1) | Epic move para Em execução (FL2) |
| todos os PBIs do Epic concluídos | Epic move para Em validação (FL2) |
| primeiro Epic entra em Em execução (FL2) | Iniciativa move para Em execução (FL3) |
| todos os Epics concluídos | Iniciativa move para Validando resultado (FL3) |
| Iniciativa em Preparado ou Em execução | autoriza um Epic a entrar em Preparado (FL2) |
| Epic em Preparado ou Em execução | autoriza um PBI a entrar em Preparado (FL1) |

No harness, o gatilho de FL1 é a integração do primeiro commit do PBI; o orquestrador registra `MOVIMENTO FL2 <EPIC> preparado→em_execucao <AAAA-MM-DD>` no ledger e em `.harness/fluxo-cache.json` (`<de>`/`<para>` são as chaves de `fluxo.status.FL2` — `preparado`, `em_execucao`, `em_validacao`, `concluido` —, nunca o nome de coluna; `cartao-sessao.mjs` também aceita o nome da coluna, normalizando-o para a chave). A ferramenta de planejamento só é escrita com `fluxo.escrita: true` (ADR-FLX-2); em `ferramenta: arquivos`, o `status` do Epic muda em `docs/fluxo/epics/<ID>.md` na branch do PBI, nunca em `main` (REQ-FLX-6).

## 6. Ponto de compromisso, WIP e vazão por nível

Cada quadro carrega três marcos: onde o compromisso é assumido, onde o WIP é contado e onde a vazão é medida. Antes do marco, o item é **opção** e pode ser descartado sem custo. Depois, é **promessa**: conta no WIP, ocupa capacidade e o relógio de quem pediu está correndo. **Lead Time = WIP ÷ Vazão**; vazão muda em meses, WIP muda hoje.

| | FL3 — Iniciativas | FL2 — Epics | FL1 — PBIs |
|---|---|---|---|
| Compromisso | na priorização com capacidade disponível (entrada em Em execução) | na entrada em Preparado | todo o quadro é pós-compromisso: o item chega comprometido pelo Epic |
| Opção | Funil · Descoberta · Preparado | Backlog · Em refinamento | — |
| Promessa | Em execução · Validando resultado | Preparado · Em execução · Em validação | Preparado (fila) · Em execução · Revisão e teste · Pronto para liberar (espera) |
| WIP | Iniciativas priorizadas e não concluídas | Epics comprometidos e não concluídos | PBIs por coluna, contra o limite do time — limitado coluna a coluna para expor o gargalo |
| Vazão | Iniciativas concluídas por trimestre | Epics concluídos por quinzena | PBIs concluídos por semana |
| Prazo | Time to Market (da ideia ao resultado medido) · Customer Lead Time (o que a organização promete) | Time to Market do Epic · Customer Lead Time (prazo prometido ao solicitante) | Lead time do PBI (do compromisso à conclusão) · Cycle time (o trecho que o time controla) |
| Decide | quantas frentes ficam abertas e qual entra a seguir; o que não cabe na vazão fica no Funil | o prazo prometido ao solicitante, no percentil 85; reposição no máximo igual à vazão observada | o que destravar hoje e quando parar de puxar: item novo entra quando um sai, não quando alguém fica livre |

Iniciativa em Preparado ainda é opção, mesmo pronta — tratar item não priorizado como promessa é a origem mais comum de portfólio inflado. Um Epic só é comprometido quando a vazão do período comporta.

## 7. Métricas medem item, nunca pessoa

Lead time, cycle time, throughput (vazão) e envelhecimento (idade do item na coluna atual) são propriedades do **item** e do **sistema**. Servem para calcular prazo (percentil 85 da distribuição, nunca média), expor gargalo (coluna onde o WIP acumula) e revisar políticas (§3.5). Não servem para avaliar indivíduos: métrica de fluxo usada em avaliação de pessoa deixa de medir o fluxo no dia seguinte, porque passa a ser otimizada por quem é medido.

O que o harness registra hoje: movimento (`MOVIMENTO` no ledger, §5), bloqueio (`BLOQUEADA`, §4.4) e envelhecimento por PBI (cartão de sessão, §4.4). Cálculo agregado de lead time e throughput **não** está no harness 1.1.0 — é item de `docs/backlog.md` do plugin, gatilho "fase 2 do Workflow TRUE" (b).

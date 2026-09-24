# Fase 1 — Fluxo · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plano-mestre (contrato de interfaces, constraints, grafo):** `docs/superpowers/plans/2026-09-24-workflow-true-1.1.0.md` — leia "Global Constraints" e "Contrato de interfaces" antes de qualquer task.
**Spec:** `docs/superpowers/specs/2026-09-24-workflow-true-design.md` — REQ-FLX-1 (l.65), REQ-FLX-5 (l.92), REQ-FLX-8 (l.101), REQ-ONB-2 (l.110), "Fora de escopo" (l.260-272), "Rollout" (l.303-314).
**Fonte do Workflow TRUE:** `docs/workflow-true.html` (local, gitignored, não versionado). Texto e templates de card estão dentro do `<script>` (`CARDS`, campos `name`/`tpl`/`ex`). Este plano já traz o conteúdo transcrito; o HTML só serve para conferência.
**Branch:** `enabler/GM-1-fluxo` · **Ledger:** `docs/ledgers/GM-1.md` · **Commits:** `docs(GM-1): …` / `feat(GM-1): …`.

**Goal:** Entregar a fonte normativa do fluxo (`reference/fluxo.md`), os 8 templates de card, a tabela de ferramentas MCP e o backlog deste repo — os 11 arquivos que as fases 2–6 citam. Só texto e JSON; nenhum script, hook ou skill.

**Architecture:** Fonte legível separada da fonte de máquina. `fluxo.md` é lido por pessoas e pela skill de conformidade; `templates/fluxo/*.md` são copiados pelo onboarding (`ferramenta: arquivos`); `ferramentas-mcp.json` é lido pela skill de onboarding para propor `fluxo.ferramenta`/`fluxo.mcp`. Nada aqui é importado no `CLAUDE.md`.

**Tech Stack:** Markdown, YAML frontmatter, JSON. Verificação com `grep`, `ls`, `awk`, `node -e`. Zero dependências.

## Global Constraints (herdadas do mestre; as que tocam esta fase)

- Idioma de todo texto: português do Brasil. Chaves de config/JSON em português sem acento, camelCase (`padraoServidor`, `hierarquiaSugerida`).
- `reference/fluxo.md` tem **exatamente 7** cabeçalhos `## ` (subseções usam `###`); nenhum bloco de código dentro dele começa linha com `## `.
- Marcação (a)/(b)/(c) obrigatória em afirmação sobre implementação. Nenhum passo deixa conteúdo para depois.
- Nenhuma task faz `push`, PR ou merge (R1). Nenhum arquivo do usuário é sobrescrito (R2) — todos os arquivos desta fase são novos.
- Tom do `AGENTS.md`: frase curta, imperativa, sem adjetivo de marketing, exemplo concreto onde o texto for regra.

## Review Focus (o que o revisor confere nesta fase, além das contagens)

1. **`grep -c "^## " reference/fluxo.md` = 7 e na ordem da REQ-FLX-1** — um `## ` a mais dentro de um exemplo de card quebra o gate da Fase 1.
2. **Frontmatter YAML válido com placeholders `[…]`** — `id: [PBI-n]` sem aspas é lista em YAML; todo placeholder em frontmatter vai entre aspas.
3. **Nomes de status coincidem letra a letra** entre `fluxo.md §4`, os templates (`status:`) e as chaves do contrato (`preparado`, `em_execucao`, `em_validacao`, `revisao`, `pronto`, `concluido`) — o cartão (T9) e o onboarding (T5) leem essas chaves.
4. **`padraoServidor` casa os nomes reais observados** — `claude_ai_ClickUp`, `plugin_productivity_clickup`, `plugin_design_atlassian`, `plugin_design_linear`, `plugin_design_notion`, `plugin_design_asana`, `plugin_productivity_monday` (todos (a): vistos na lista de tools desta sessão em 2026-09-24). Trello não foi observado — (b).
5. **Nenhuma URL com token, nenhum dado real de terceiro** nos exemplos (§11 da referência) — os exemplos são os do HTML (portal de chamados fictício).

---

## Pré-condições (orquestrador, antes de T1)

- [ ] `git switch -c enabler/GM-1-fluxo main`.
- [ ] Commitar a linha já presente no `.gitignore` (`docs/workflow-true.html`): `git add .gitignore && git commit -m "chore(GM-1): ignora a fonte local docs/workflow-true.html"`.
- [ ] Criar `docs/ledgers/GM-1.md` com o cabeçalho **novo** de `referencia.md §2.3` (formato que a Fase 4, T18, versiona — `PBI:`/`Epic:` no título e `## LER PRIMEIRO`; este repo não tem onboarding, então `Epic:` é (b)): primeira linha `# Ledger — PBI: GM-1 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-1-fluxo.md   Branch: enabler/GM-1-fluxo @ <sha>   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md`, depois `Rulings herdados: …   Contexto externo: nenhum`, e as seções `## LER PRIMEIRO — <AAAA-MM-DD>` (≤ 5 linhas: "Fase 1: T1, T2, T4 paralelos; T3 depois de T2"), `## Pre-flight — pares produz × consome`, `## Progresso`, `## CORTE DA SESSÃO (com motivo)`, `## FECHO — PR mergeada`. Commit `docs(GM-1): ledger da fase 1`.
- [ ] Ordem: T1, T2 e T4 são independentes (podem ir em paralelo, arquivos disjuntos); **T3 depende de T2** (nomes de seção, campos e status).

---

### Task T1: `docs/backlog.md` deste repositório

**Files:**
- Create: `docs/backlog.md`

**Interfaces:**
- Consumes: spec "Fora de escopo" (l.260-272); formato de `referencia.md §2.4` (`| Item | Origem | Gatilho |`, cabeçalho normativo).
- Produces: o único dono de item deferido neste repo (R17). Fases 2–6 anotam aqui o que sair de escopo; T21 cria o *template* `templates/backlog.md` para repos de usuário com o mesmo cabeçalho.

- [ ] **Step 1: Escreva `docs/backlog.md` com este conteúdo**

````markdown
# Backlog — gabarito-mestre

Item sai daqui quando entra num plano ou a decisão de descarte é registrada. Item entregue ou revogado é riscado no mesmo merge (`referencia.md §2.4`). Um formato só.

| Item | Origem | Gatilho |
|---|---|---|
| Escrita na ferramenta de planejamento como default (hoje só com `fluxo.escrita: true`, ADR-FLX-2) | spec 2026-09-24 Workflow TRUE, "Fora de escopo" — dono: Gabriel | 3 repos do time com escrita autorizada e sem incidente |
| Adaptador de escrita por ferramenta (criar card a partir do plano) | idem | primeiro PBI que precisar abrir card a partir do plano |
| Métricas de fluxo (lead time, throughput, envelhecimento agregado) calculadas pelo harness | idem | fase 2 do Workflow TRUE |
| Bloqueio de prompt inline via `UserPromptSubmit` exit 2 (hoje só lembrete, ORQ-4) | idem | R21 violada 3× no piloto |
| Isolamento remoto como default de dispatch | idem | máquina do piloto em `slots: 1` em mais de 50% das sessões |
| Abordagem B — harness reescrito por altitude (2.0.0) | idem (D6) | 3 achados de conformidade por confusão de conceito |
| Enumeração automática de modelos (substituir a resposta (b) do usuário em ONB-5) | idem (D5, M9) | Claude Code expor API/CLI de listagem |
````

- [ ] **Step 2: Verifique**

Run: `grep -c "^| " docs/backlog.md` → Expected: `8` (1 cabeçalho + 7 itens; a linha `|---|` não começa com `| `).
Run: `grep -c "item sai daqui quando entra num plano" docs/backlog.md` → Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog.md
git commit -m "docs(GM-1): backlog do repo com os 7 itens fora de escopo da 1.1.0"
```

---

### Task T2: `reference/fluxo.md` — fonte normativa do Workflow TRUE

**Files:**
- Create: `plugins/gabarito-mestre/reference/fluxo.md`

**Interfaces:**
- Consumes: `docs/workflow-true.html` (texto + `CARDS` do `<script>`); REQ-FLX-1 (ordem das 7 seções); REQ-FLX-8 (bloqueio/envelhecimento); contrato do mestre (chaves de `fluxo.status`, linha `BLOQUEADA` do ledger, `envelhecimentoDias`).
- Produces: os nomes de seção `## 1.`…`## 7.`; os nomes de coluna por nível (§4) que T3 usa em `status:` e T5 grava em `fluxo.status`; os tokens de `tipo` (`Iniciativa`, `Epic`, `US`, `Enabler`, `TechDebt`, `Spike`, `Bug`, `Tarefa`) que T3, T9 e T23 usam; os DoR/DoD que T17 (`AGENTS.md §7`) cita. **T10 acrescenta `put reference/fluxo.md docs/harness/fluxo.md` ao `instalar.sh`** — nesta fase o arquivo ainda não é instalado (b).

- [ ] **Step 1: Escreva `plugins/gabarito-mestre/reference/fluxo.md` com este conteúdo**

````markdown
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
````

- [ ] **Step 2: Verifique estrutura e ordem**

Run: `grep -c "^## " plugins/gabarito-mestre/reference/fluxo.md` → Expected: `7`.
Run: `grep "^## " plugins/gabarito-mestre/reference/fluxo.md | cut -c1-30` → Expected, nesta ordem: `## 1. Os três níveis`, `## 2. Os oito tipos de card`, `## 3. Políticas gerais`, `## 4. Colunas e regras de mov…`, `## 5. Propagação entre níveis`, `## 6. Ponto de compromisso, W…`, `## 7. Métricas medem item, nu…`.
Run: `grep -c "^### 2\." plugins/gabarito-mestre/reference/fluxo.md` → Expected: `8`.
Run: `grep -c "^TEMPLATE$" plugins/gabarito-mestre/reference/fluxo.md; grep -c "^EXEMPLO$" plugins/gabarito-mestre/reference/fluxo.md` → Expected: `8` e `8`.
Run: `grep -c "Bloqueio é marcação, não coluna\|Envelhecimento tem limite" plugins/gabarito-mestre/reference/fluxo.md` → Expected: `2`.
Run: `grep -c "fluxo.md" plugins/gabarito-mestre/templates/CLAUDE.md` → Expected: `0` (FLX-1: não importado).
Run: `python3 -c "import re;s=open('docs/workflow-true.html').read();sc=re.findall(r'<script[^>]*>(.*?)</script>',s,re.S)[0];print(len(re.findall(r'name:\"',sc)))"` → Expected: `22`; confira à mão que os 22 campos do HTML aparecem no §2 (4+3+3+2+3+2+2+3).

- [ ] **Step 3: Commit**

```bash
git add plugins/gabarito-mestre/reference/fluxo.md
git commit -m "docs(GM-1): reference/fluxo.md — fonte normativa do Workflow TRUE (7 seções)"
```

---

### Task T3: `templates/fluxo/*.md` — 8 cards com frontmatter

**Files:**
- Create: `plugins/gabarito-mestre/templates/fluxo/iniciativa.md`, `epic.md`, `us.md`, `enabler.md`, `tech-debt.md`, `spike.md`, `bug.md`, `tarefa.md`

**Interfaces:**
- Consumes: `fluxo.md §2` (campos por card), `§4` (nomes de coluna para `status:`), tokens de `tipo`.
- Produces: frontmatter que T9 (`cartao-sessao.mjs`, em `arquivos`) lê de `docs/fluxo/pbis/<ID>.md` — chaves exatas `id`, `tipo`, `epic`, `status`, `atualizadoEm`; Epic tem `iniciativa` no lugar de `epic`; Iniciativa não tem vínculo. T22 (onboarding, `ferramenta: arquivos`) copia `iniciativa.md` → `docs/fluxo/iniciativa.md`, `epic.md` → `docs/fluxo/epics/`, os seis restantes → `docs/fluxo/pbis/`. T10 acrescenta `put` desses arquivos ao `instalar.sh` **só** se o onboarding não os copiar (decidido em T22; hoje (b)).

Regras comuns: frontmatter delimitado por `---`; todo placeholder em frontmatter vai **entre aspas** (`"[PBI-n]"` — sem aspas, `[…]` é lista YAML); `status` inicial é a primeira coluna do quadro do nível (`Funil`, `Backlog`, `Preparado`); `atualizadoEm` em `AAAA-MM-DD`; corpo com `# [Título]`, linha de nível/tipo e um `## <Campo>` por campo do card, com o template do §2 dentro.

- [ ] **Step 1: `templates/fluxo/iniciativa.md`**
````markdown
---
id: "[INI-n]"
tipo: Iniciativa
status: Funil
atualizadoEm: "AAAA-MM-DD"
---
# [Nome da Iniciativa]
FL3 · Iniciativa / Projeto · `docs/harness/fluxo.md §2.1`. Status possíveis: Funil · Descoberta · Preparado · Em execução · Validando resultado · Concluído.
## Problema de Negócio
Hoje [situação atual], o que causa [impacto no negócio] para [quem é afetado].
## Resultado Esperado
Queremos [resultado desejado] até [horizonte de tempo], medido por [indicador].
## Escopo e Horizonte
Dentro: [o que faz parte].
Fora: [o que não faz parte].
Horizonte: [período].
Patrocinador: [quem responde pela iniciativa].
## Critério de Sucesso
A Iniciativa é considerada bem-sucedida quando [indicador] atingir [meta] em [prazo].
## Epics
- [EPIC-n] — [nome] — [status]
````

- [ ] **Step 2: `templates/fluxo/epic.md`**
````markdown
---
id: "[EPIC-n]"
tipo: Epic
iniciativa: "[INI-n]"
status: Backlog
atualizadoEm: "AAAA-MM-DD"
---
# [Nome do Epic]
FL2 · Epic · `docs/harness/fluxo.md §2.2`. Status possíveis: Backlog · Em refinamento · Preparado · Em execução · Em validação · Concluído. Override de Iniciativa (D4): `Iniciativa: [outro ID] (override: [motivo])` nesta linha — nunca só no frontmatter.
## Narrativa (Elevator Pitch)
Para [público ou persona]
que [necessidade ou problema],
o [nome do Epic]
é um [tipo de solução]
que [benefício principal].
Diferente de [alternativa atual],
ele [diferencial].
## Regras Gerais de Negócio
RN01. [regra que vale para todas as histórias deste Epic]
RN02. [regra de negócio, restrição ou política aplicável]
RN03. [...]
## Critérios Gerais de Aceite
CA01. [condição observável para o Epic ser considerado entregue]
CA02. [...]
## PBIs (índice — um plano por PBI, ADR-FLX-1)
- [PBI-n] · [tipo] — [título] — [status]
````

- [ ] **Step 3: `templates/fluxo/us.md`**
````markdown
---
id: "[PBI-n]"
tipo: US
epic: "[EPIC-n]"
status: Preparado
atualizadoEm: "AAAA-MM-DD"
---
# [Título da User Story]
FL1 · User Story · `docs/harness/fluxo.md §2.3`. Status possíveis: Preparado · Em execução · Revisão e teste · Pronto para liberar · Concluído. Plano: `docs/superpowers/plans/[…].md` · Ledger: `docs/ledgers/[PBI-n].md`.
## Narrativa
Como [perfil de usuário],
quero [ação ou capacidade],
para [benefício ou motivo].
## Regras de Negócio
RN01. [regra específica desta história]
RN02. [...]
## Critérios de Aceite (BDD)
Cenário: [nome do cenário]
Dado que [contexto inicial]
Quando [ação do usuário]
Então [resultado observável]
````

- [ ] **Step 4: `templates/fluxo/enabler.md`**
````markdown
---
id: "[PBI-n]"
tipo: Enabler
epic: "[EPIC-n]"
status: Preparado
atualizadoEm: "AAAA-MM-DD"
---
# [Título do Enabler]
FL1 · Enabler · `docs/harness/fluxo.md §2.4`. Status possíveis: Preparado · Em execução · Revisão e teste · Pronto para liberar · Concluído. Plano: `docs/superpowers/plans/[…].md` · Ledger: `docs/ledgers/[PBI-n].md`.
## Narrativa
Para [capacidade ou resultado que isso viabiliza],
precisamos [trabalho técnico a ser feito].
## Critérios de Aceite
CA01. [evidência objetiva de que a base técnica está pronta]
CA02. [...]
````

- [ ] **Step 5: `templates/fluxo/tech-debt.md`**
````markdown
---
id: "[PBI-n]"
tipo: TechDebt
epic: "[EPIC-n]"
status: Preparado
atualizadoEm: "AAAA-MM-DD"
---
# [Título do Tech Debt]
FL1 · Tech Debt · `docs/harness/fluxo.md §2.5`. Status possíveis: Preparado · Em execução · Revisão e teste · Pronto para liberar · Concluído. Plano: `docs/superpowers/plans/[…].md` · Ledger: `docs/ledgers/[PBI-n].md`.
## Narrativa
Para [risco, custo ou limitação que queremos eliminar],
precisamos [correção estrutural a ser feita].
## Critérios de Aceite
CA01. [evidência objetiva de que o débito foi quitado]
CA02. [...]
````

- [ ] **Step 6: `templates/fluxo/spike.md`**
````markdown
---
id: "[PBI-n]"
tipo: Spike
epic: "[EPIC-n]"
status: Preparado
atualizadoEm: "AAAA-MM-DD"
---
# [Título do Spike]
FL1 · Spike · `docs/harness/fluxo.md §2.6`. Status possíveis: Preparado · Em execução · Revisão e teste · Pronto para liberar · Concluído. Timebox: [n dias]. Resposta esperada: CONFIRMADA ou REFUTADA, com número (`gabarito-spike`).
## Narrativa
Para [decisão que precisa ser tomada],
precisamos [investigação a ser feita] em até [timebox].
## Critérios de Aceite
CA01. [entregável da investigação]
CA02. [recomendação registrada e comunicada]
````

- [ ] **Step 7: `templates/fluxo/bug.md`**
````markdown
---
id: "[PBI-n]"
tipo: Bug
epic: "[EPIC-n]"
status: Preparado
atualizadoEm: "AAAA-MM-DD"
---
# [Título do Bug]
FL1 · Bug · `docs/harness/fluxo.md §2.7`. Status possíveis: Preparado · Em execução · Revisão e teste · Pronto para liberar · Concluído. Ambiente: [produção | homologação | …]. Plano: `docs/superpowers/plans/[…].md` · Ledger: `docs/ledgers/[PBI-n].md`.
## Falha Observada
[O que acontece], em [tela, módulo ou ambiente], desde [quando], afetando [quem ou quantos].
## Passo a Passo para Reprodução
1. [passo]
2. [passo]
3. [passo]
4. [resultado obtido]
## Comportamento Esperado
O sistema deveria [comportamento correto], exibindo [mensagem ou retorno esperado].
````

- [ ] **Step 8: `templates/fluxo/tarefa.md`**
````markdown
---
id: "[PBI-n]"
tipo: Tarefa
epic: "[EPIC-n]"
status: Preparado
atualizadoEm: "AAAA-MM-DD"
---
# [Título da Tarefa]
FL1 · Tarefa (fora da TI) · `docs/harness/fluxo.md §2.8`. Status possíveis: Preparado · Em execução · Revisão e teste · Pronto para liberar · Concluído. Acompanhada na cadência do nível tático (política 4). Sem plano de código; o ledger do Epic registra o acompanhamento.
## Narrativa
Para [capacidade ou entrega que isso viabiliza],
precisamos [entrega da área de negócio].
## Área Responsável e Prazo
Área: [área que executa].
Ponto focal: [nome de quem responde pela entrega].
Prazo acordado: [data combinada].
## Critérios de Aceite
CA01. [evidência objetiva de que a entrega foi concluída]
CA02. [...]
````

- [ ] **Step 9: Verifique**

Run: `ls plugins/gabarito-mestre/templates/fluxo | wc -l` → Expected: `8`.
Run: `for f in plugins/gabarito-mestre/templates/fluxo/*.md; do awk 'NR==1&&$0!="---"{print FILENAME": sem frontmatter"; exit 1}' "$f"; done` → Expected: nenhuma saída.
Run: `grep -L "^id: \"\[" plugins/gabarito-mestre/templates/fluxo/*.md` → Expected: nenhuma saída (todo `id` com placeholder entre aspas).
Run: `grep -l "^epic: " plugins/gabarito-mestre/templates/fluxo/*.md | wc -l` → Expected: `6`.
Run: `grep -l "^iniciativa: " plugins/gabarito-mestre/templates/fluxo/*.md` → Expected: só `epic.md`.
Run: `grep -h "^tipo: " plugins/gabarito-mestre/templates/fluxo/*.md | sort | tr '\n' ' '` → Expected: `tipo: Bug tipo: Enabler tipo: Epic tipo: Iniciativa tipo: Spike tipo: Tarefa tipo: TechDebt tipo: US`.
Run: `grep -L "^atualizadoEm: \"AAAA-MM-DD\"" plugins/gabarito-mestre/templates/fluxo/*.md` → Expected: nenhuma saída.
Run: `node -e "const fs=require('fs');for(const f of fs.readdirSync('plugins/gabarito-mestre/templates/fluxo')){const t=fs.readFileSync('plugins/gabarito-mestre/templates/fluxo/'+f,'utf8');const m=t.match(/^---\n([\s\S]*?)\n---\n/);if(!m)throw f;for(const l of m[1].split('\n')){if(!/^[a-zA-Z]+: (\"[^\"]*\"|[A-Za-z]+)$/.test(l))throw f+': '+l}}console.log('frontmatter ok')"` → Expected: `frontmatter ok` (toda linha é `chave: valor` escalar; nada de lista).

- [ ] **Step 10: Commit**

```bash
git add plugins/gabarito-mestre/templates/fluxo
git commit -m "feat(GM-1): templates/fluxo — 8 cards do Workflow TRUE com frontmatter"
```

---

### Task T4: `reference/ferramentas-mcp.json` — 7 ferramentas

**Files:**
- Create: `plugins/gabarito-mestre/reference/ferramentas-mcp.json`

**Interfaces:**
- Consumes: REQ-ONB-2; contrato do mestre (`fluxo.ferramenta` ∈ `clickup|jira|linear|notion|trello|asana|monday|arquivos`; `fluxo.mapeamento.{FL3,FL2,FL1}`; chaves de `fluxo.status`).
- Produces: `{ "_comment", "versao": 1, "ferramentas": [ {padraoServidor, ferramenta, hierarquiaSugerida, statusSugerido, comoBuscarIniciativa, confirmadoEm} ] }`. T22 (skill de onboarding) extrai `<server>` de cada tool `mcp__<server>__<tool>` visível e testa `new RegExp(padraoServidor, 'i').test(server)`; primeiro match propõe `ferramenta` e `mcp: <server>`; `hierarquiaSugerida` e `statusSugerido` são os defaults das perguntas fechadas de ONB-3; `comoBuscarIniciativa` é instrução para o agente. Toda entrada é **(b)** até um onboarding real confirmar (`confirmadoEm: null`); a lista cresce por PR.

- [ ] **Step 1: Escreva o arquivo**

````json
{
  "_comment": "Servidor MCP → ferramenta de planejamento → hierarquia e status sugeridos para o Workflow TRUE (docs/harness/fluxo.md §1, §4). padraoServidor é testado com new RegExp(p, 'i') sobre o segmento <server> de mcp__<server>__<tool>. Nomes observados em 2026-09-24 (a): claude_ai_ClickUp, plugin_productivity_clickup, plugin_design_atlassian, plugin_design_linear, plugin_design_notion, plugin_design_asana, plugin_productivity_monday. Hierarquia e status são sugestão (b) até um onboarding confirmar; então grave confirmadoEm. Sem match: ferramenta 'arquivos' ou nome livre informado pelo usuário. A lista cresce por PR.",
  "versao": 1,
  "ferramentas": [
    {
      "padraoServidor": "clickup",
      "ferramenta": "clickup",
      "hierarquiaSugerida": { "FL3": "Space ou Folder (uma Iniciativa por Folder)", "FL2": "List (um Epic por List) ou Task com custom field Tipo=Epic", "FL1": "Task (subtask = task do plano, opcional)" },
      "statusSugerido": { "FL2": { "preparado": "Preparado", "em_execucao": "Em execução", "em_validacao": "Em validação", "concluido": "Concluído" },
                          "FL1": { "preparado": "Preparado", "em_execucao": "Em execução", "revisao": "Revisão e teste", "pronto": "Pronto para liberar", "concluido": "Concluído" } },
      "comoBuscarIniciativa": "Peça ok para LER (ONB-3). Use clickup_get_workspace_hierarchy e procure Space/Folder cujo nome contenha o nome informado; se não achar, clickup_search pelo nome. Confirme que está ativo (não arquivado) — existir não é estar ativo (I10). Grave id, nome e URL sem token. Vazio não é prova: pergunte de novo antes de gravar (b).",
      "confirmadoEm": null
    },
    {
      "padraoServidor": "jira|atlassian",
      "ferramenta": "jira",
      "hierarquiaSugerida": { "FL3": "Initiative (Advanced Roadmaps / Premium) ou Project", "FL2": "Epic", "FL1": "Story, Task, Bug (Sub-task = task do plano, opcional)" },
      "statusSugerido": { "FL2": { "preparado": "To Do", "em_execucao": "In Progress", "em_validacao": "In Review", "concluido": "Done" },
                          "FL1": { "preparado": "To Do", "em_execucao": "In Progress", "revisao": "In Review", "pronto": "Ready to Release", "concluido": "Done" } },
      "comoBuscarIniciativa": "Peça ok para LER. Busque com JQL `issuetype = Initiative AND summary ~ \"<nome>\"`; sem tipo Initiative no site, use `project = <chave>` e trate o Project como Iniciativa. Confirme status ativo (não Done/Closed). Grave chave, nome e URL sem token. Vazio não é prova (I4).",
      "confirmadoEm": null
    },
    {
      "padraoServidor": "linear",
      "ferramenta": "linear",
      "hierarquiaSugerida": { "FL3": "Initiative", "FL2": "Project", "FL1": "Issue (sub-issue = task do plano, opcional)" },
      "statusSugerido": { "FL2": { "preparado": "Planned", "em_execucao": "In Progress", "em_validacao": "In Review", "concluido": "Completed" },
                          "FL1": { "preparado": "Todo", "em_execucao": "In Progress", "revisao": "In Review", "pronto": "Ready", "concluido": "Done" } },
      "comoBuscarIniciativa": "Peça ok para LER. Liste Initiatives e filtre pelo nome; sem Initiatives no workspace, use Projects e trate o Project como Iniciativa (então FL2 = milestone ou label Epic — confirme com o usuário). Confirme status ativo. Grave id, nome e URL sem token.",
      "confirmadoEm": null
    },
    {
      "padraoServidor": "notion",
      "ferramenta": "notion",
      "hierarquiaSugerida": { "FL3": "Database 'Iniciativas' (uma página por Iniciativa)", "FL2": "Database 'Epics' com relation → Iniciativa", "FL1": "Database 'PBIs' com relation → Epic" },
      "statusSugerido": { "FL2": { "preparado": "Preparado", "em_execucao": "Em execução", "em_validacao": "Em validação", "concluido": "Concluído" },
                          "FL1": { "preparado": "Preparado", "em_execucao": "Em execução", "revisao": "Revisão e teste", "pronto": "Pronto para liberar", "concluido": "Concluído" } },
      "comoBuscarIniciativa": "Peça ok para LER. Use a busca do servidor pelo nome e filtre resultados que sejam páginas de um database de Iniciativas (propriedade Status presente). Confirme status ativo. Grave id da página, nome e URL sem token. Pergunte qual propriedade (relation) liga PBI→Epic; grave em vinculoPbiEpic.",
      "confirmadoEm": null
    },
    {
      "padraoServidor": "trello",
      "ferramenta": "trello",
      "hierarquiaSugerida": { "FL3": "Card no board 'Portfólio'", "FL2": "Card no board 'Tático' (link para o card da Iniciativa)", "FL1": "Card no board do time (link para o card do Epic)" },
      "statusSugerido": { "FL2": { "preparado": "Preparado", "em_execucao": "Em execução", "em_validacao": "Em validação", "concluido": "Concluído" },
                          "FL1": { "preparado": "Preparado", "em_execucao": "Em execução", "revisao": "Revisão e teste", "pronto": "Pronto para liberar", "concluido": "Concluído" } },
      "comoBuscarIniciativa": "Nome de servidor não observado (b): confirme o padrão com o usuário antes de gravar. Peça ok para LER. Liste boards, localize 'Portfólio' e busque o card pelo nome; a lista (coluna) do card é o status. Grave id, nome e URL sem token. Vínculo PBI→Epic é por link/attachment no card: grave em vinculoPbiEpic.",
      "confirmadoEm": null
    },
    {
      "padraoServidor": "asana",
      "ferramenta": "asana",
      "hierarquiaSugerida": { "FL3": "Portfolio (ou Project marcado Iniciativa)", "FL2": "Project (um Epic por Project) ou Section", "FL1": "Task (subtask = task do plano, opcional)" },
      "statusSugerido": { "FL2": { "preparado": "Preparado", "em_execucao": "Em execução", "em_validacao": "Em validação", "concluido": "Concluído" },
                          "FL1": { "preparado": "Preparado", "em_execucao": "Em execução", "revisao": "Revisão e teste", "pronto": "Pronto para liberar", "concluido": "Concluído" } },
      "comoBuscarIniciativa": "Peça ok para LER. Busque Portfolios pelo nome; sem Portfolios no plano da conta, busque Projects e trate o Project como Iniciativa (então FL2 = Section — confirme). Confirme que não está arquivado. Grave gid, nome e URL sem token.",
      "confirmadoEm": null
    },
    {
      "padraoServidor": "monday",
      "ferramenta": "monday",
      "hierarquiaSugerida": { "FL3": "Item no board 'Portfólio'", "FL2": "Group ou Item no board 'Tático' (coluna Connect boards → Iniciativa)", "FL1": "Item no board do time (Connect boards → Epic; subitem = task do plano, opcional)" },
      "statusSugerido": { "FL2": { "preparado": "Preparado", "em_execucao": "Working on it", "em_validacao": "Em validação", "concluido": "Done" },
                          "FL1": { "preparado": "Preparado", "em_execucao": "Working on it", "revisao": "Revisão e teste", "pronto": "Pronto para liberar", "concluido": "Done" } },
      "comoBuscarIniciativa": "Peça ok para LER. Liste boards, localize 'Portfólio' e busque o item pelo nome; a coluna Status é o status. Grave id, nome e URL sem token. Pergunte qual coluna Connect boards liga PBI→Epic; grave em vinculoPbiEpic.",
      "confirmadoEm": null
    }
  ]
}
````

- [ ] **Step 2: Verifique**

Run: `node -e "const j=require('./plugins/gabarito-mestre/reference/ferramentas-mcp.json');const f=j.ferramentas;if(f.length!==7)throw 'n='+f.length;const chaves=['padraoServidor','ferramenta','hierarquiaSugerida','statusSugerido','comoBuscarIniciativa','confirmadoEm'];for(const e of f){for(const k of chaves)if(!(k in e))throw e.ferramenta+' sem '+k;for(const n of ['FL3','FL2','FL1'])if(!e.hierarquiaSugerida[n])throw e.ferramenta+' sem '+n;for(const k of ['preparado','em_execucao','em_validacao','concluido'])if(!e.statusSugerido.FL2[k])throw e.ferramenta+' FL2 sem '+k;for(const k of ['preparado','em_execucao','revisao','pronto','concluido'])if(!e.statusSugerido.FL1[k])throw e.ferramenta+' FL1 sem '+k;new RegExp(e.padraoServidor,'i')}console.log('ok', f.map(e=>e.ferramenta).join(','))"` → Expected: `ok clickup,jira,linear,notion,trello,asana,monday`.
Run: `node -e "const j=require('./plugins/gabarito-mestre/reference/ferramentas-mcp.json');const casa=s=>j.ferramentas.find(e=>new RegExp(e.padraoServidor,'i').test(s))?.ferramenta;const esperado={claude_ai_ClickUp:'clickup',plugin_productivity_clickup:'clickup',plugin_design_atlassian:'jira',plugin_design_linear:'linear',plugin_design_notion:'notion',plugin_design_asana:'asana',plugin_productivity_monday:'monday',claude_ai_Gmail:undefined,plugin_design_figma:undefined};for(const [s,e] of Object.entries(esperado))if(casa(s)!==e)throw s+' → '+casa(s);console.log('padrões ok')"` → Expected: `padrões ok` (os sete nomes observados casam; Gmail e Figma não casam nada).
Run: `grep -c "token" plugins/gabarito-mestre/reference/ferramentas-mcp.json` → Expected: `7` (só nas frases "URL sem token"; nenhum valor de token).

- [ ] **Step 3: Commit**

```bash
git add plugins/gabarito-mestre/reference/ferramentas-mcp.json
git commit -m "feat(GM-1): reference/ferramentas-mcp.json — 7 ferramentas de planejamento (b)"
```

---

## Gate da Fase 1 (orquestrador, antes de pedir ok para PR)

- [ ] `git diff --stat main..enabler/GM-1-fluxo --name-only | grep -v "^docs/ledgers\|^\.gitignore" | wc -l` → `11` (1 backlog + 1 `fluxo.md` + 8 templates + 1 JSON).
- [ ] `grep -c "^## " plugins/gabarito-mestre/reference/fluxo.md` → `7` · `ls plugins/gabarito-mestre/templates/fluxo | wc -l` → `8` · o `node -e` de T4 Step 2 imprime `ok …`.
- [ ] `cd plugins/gabarito-mestre/gates && npm test` continua verde (nenhum script tocado; prova de que nada regrediu).
- [ ] `claude plugin validate ./plugins/gabarito-mestre --strict` passa (arquivos novos em `reference/` e `templates/` não afetam o manifesto).
- [ ] Ledger `docs/ledgers/GM-1.md`: uma linha `Task Tn: complete (review Aprovado — <o que foi provado>; sha)` por task; `## LER PRIMEIRO` com o que a Fase 2 precisa saber: `fluxo.md` ainda não é instalado (`instalar.sh`, T10) e os templates ainda não são copiados (T22) — ambos (b).
- [ ] Review adversarial (`gabarito-revisor`) sobre o diff integrado, com as mutações: remover a seção `## 4.` de `fluxo.md` → o grep de T2 Step 2 deve falhar; trocar `id: "[PBI-n]"` por `id: [PBI-n]` em um template → o `node -e` de T3 Step 9 deve lançar; trocar `"jira|atlassian"` por `"jira"` → o teste de padrões de T4 deve lançar em `plugin_design_atlassian`.
- [ ] Pedir ok explícito do usuário para PR (R1). Título da PR: `enabler(GM-1): Fase 1 — fluxo (fluxo.md, templates, ferramentas-mcp, backlog)`.

## Emendas (2026-09-24, revisão cruzada)

- #16: pré-condição do ledger `GM-1.md` passa ao cabeçalho novo de `referencia.md §2.3` (Fase 4, T18): `PBI: GM-1 · Epic: (b) — repo do plugin, sem onboarding`, `## LER PRIMEIRO — <data>`, Pre-flight, Progresso, CORTE, FECHO.
- Nova 1: `fluxo.md §5` — exemplo do ledger passa de `MOVIMENTO FL2 <Epic> Preparado→Em execução <data>` para `MOVIMENTO FL2 <EPIC> preparado→em_execucao <AAAA-MM-DD>` (grafia canônica do plano-mestre), com nota: chaves de `fluxo.status.FL2`; `cartao-sessao.mjs` também aceita o nome da coluna.

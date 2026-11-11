# Decisões do dono — brainstorm do painel e fechamento da GM-14 (2026-11-11, ~18:10–18:50)

Fonte: conversa com o dono na sessão 1081797f (loop pausado durante o brainstorm). Cada item abaixo foi dito ou confirmado pelo dono ("fecha assim"). Marcação: **[dono]** = fala ou confirmação explícita do dono; **[orq]** = recomendação do orquestrador aceita pelo dono.

## Painel

- D-P1 **[dono]** O painel é **um só, global**, mesmo conteúdo. Muda só o **local de exibição**: lateral (Pane, como na 2.0) **ou** acima da caixa de input. É uma opção — nunca os dois ao mesmo tempo. Revoga D7 ("A Pane sai") e a parte de REQ-GLB-1 que proíbe `Pane`/`$.ui.open`.
- D-P2 **[dono]** Padrão: **lateral**. Troca pelo **onboarding** ou por **comando**.
- D-P3 **[dono]** Manter o que existe e corrigir os defeitos apontados ao vivo (N31, N33: "depende de você: nada" falso, agentes fantasmas, nome repetido, sem dizer o que o agente faz, estados errados, cabeçalho "GM-14 GM-14", crase crua, ETA sem base).
- D-P4 **[dono]** Objetivo: **visão do momento, ao vivo**. Mostra só o que está pronto, o que está acontecendo e o que depende do dono. O que não está pronto nem começou **não aparece**. Sem poluição.
- D-P5 **[dono]** Primeira coisa: **o que depende de mim, com clareza**, e tudo que está rolando ao vivo.
- D-P6 **[dono]** Tarefas integradas não são listadas: só contam na barra (`N de 31 integradas`). A barra mostra **só o que está pronto** (integrado); aprovada-esperando não pinta.
- D-P7 **[dono]** Equipe: só quem está **ativo**. Agente que pousou **sai na hora** (31 tasks ⇒ spam). Cada linha diz **o que o agente está fazendo, claro e objetivo** (1 frase), não só o papel.
- D-P8 **[orq, aceito]** Blocos, de cima para baixo, cada um só com conteúdo: DEPENDE DE VOCÊ (sempre topo) · PRONTO/FASE · AGORA (inclui trabalho em segundo plano: testes, integrações) · ATENÇÃO (só travado ou com problema) · RECENTE.
- D-P9 **[dono]** Histórico recente objetivo, sem spam: **5 linhas na lateral, 2 acima do input**; só resultados (aprovou, reprovou, integrou, travou, decisão, pausa), mais novo no topo, motivo curto quando é problema; "despachou" não entra. Acima do input, é o primeiro bloco a encolher.
- D-P10 **[dono]** Modo **executivo continua** (há usuários que vão usar): **o mesmo painel, sem a parte lúdica**. Não é outro desenho.
- D-P11 **[dono]** No executivo, no lugar do nome temático vai o **papel**: Orquestrador, Implementador, Revisor, Conselheiro (Sombra), Teste (trabalho em segundo plano). O nº da task diferencia dois do mesmo papel.
- D-P12 **[orq, aceito]** Fora de entrega/fase de spec: os mesmos blocos; a barra vira **FASE** (ideia › spec › aprovação › plano › execução › PR › uso), reaproveitando a T3. Sem nada em curso: **uma linha** (`GABARITO · sem entrega em curso · última: <id> (<estado>)`).
- D-P13 **[orq, aceito]** Três condições: (1) **só mostrar o que tem registro** (fato gravado); sem fonte ⇒ `?` e o que falta; (2) **aviso de desatualizado** quando o diário não é lido há mais que um limite (valor a medir); (3) **nenhum símbolo que vire emoji** em terminal.
- D-P14 **[orq, aceito]** Regras derivadas: título escrito uma vez, sem marcação; dois agentes ativos nunca com o mesmo nome; ação = botão que põe o comando no input sem enviar (já existe, F7/D3; texto do painel sem comando — REQ-LNG-1).
- D-P15 **[orq, aceito]** Linha do orquestrador fica: contexto usado + aviso de pouso a 50 %, 1 linha no topo do AGORA.
- D-P16 **[orq, aceito]** Plano B se o Claude Code não expõe a ação atual do subagente: mostrar o **último fato registrado** dele (ex.: "Revisor · T12 · rodando mutações · 4m"); nunca inventar.

## Escopo da GM-14

- D-E1 **[dono]** **Herança da 1.x sai da GM-14** e vai para a 2.2 (REQ-ONB-3: T16, T19, parte de herança da T21; T8 fica guardada, não descartada; T10 fica, já aprovada). Motivo: só o dono usa 1.x; maior fila dependente; T8 com meta S6b 67–71 % < 83 %.
- D-E2 **[dono]** Resto do escopo fica (onboarding simples, modo foco, perguntas abertas, painel, loop).
- D-E3 **[orq, aceito]** Uma **revisão única da spec**: painel novo + Emenda 2 (reentrega/concluir no hand-back) + Emenda 3 (integrar `ja_na_base`, destrava T0) + corte da herança + regra de pouso, com mapa de reaproveitamento das tasks.

## Pouso e wakeup

- D-W1 **[orq, aceito]** Antes de escrever a regra: **spike** — o wakeup sobrevive ao `/clear`?
- D-W2 **[orq, aceito]** Pouso é **regra do produto**: a 50 % grava a retomada, arma o wakeup, mostra em DEPENDE DE VOCÊ "limpar a conversa · [limpar]" e notifica (push).
- D-W3 **[dono]** Wakeup que dispara **sem** `/clear` (contexto acima do limite): o loop **não despacha nada novo**; termina o que está em voo e repete o pedido de limpar. Não segue no automático com a conversa cheia.

## Processo

- D-R1 **[dono]** Fluxo: spikes ⇒ este registro ⇒ revisão única da spec ⇒ **review adversarial** (Opus, instância nova, teto 2 rodadas; BLOCKER/MAJOR bloqueiam, MINOR ⇒ backlog) ⇒ **Sombra aprova a spec** ⇒ plano refeito + review ⇒ loop até a entrega (review final Fable, merge em `next` se CI verde e review aprovado).
- D-R2 **[dono]** **Nova regra:** a Sombra aprova spec e emendas cujas decisões o dono tomou em conversa registrada (este arquivo é a fonte). Sem fonte ⇒ `fora_da_regra` ⇒ dono. Sempre seguindo o conceito do produto e a regra de negócio, dentro das boas práticas.
- D-R3 **[dono]** Continuam do dono, no fim: leigo do A2, versão/release 2.1.0, `next` ⇒ `main`.

## Fatos medidos depois do registro

- F-W1 (spike W1, 2026-11-11): **wakeup do ScheduleWakeup sobrevive ao `/clear`: 7 de 7 casos dispararam** (transcritos do projeto; marcador "Claude resuming /loop wakeup"). O de hoje disparou 8m46s após vencer (17:50 local), na sessão nova 0da4553b — atraso não explicado (hipótese: sessão ocupada com Stop hook). A sessão nova começa só com o prompt do `/loop`: o prompt tem de ser autossuficiente. Detalhe: .claude-tmp/spike-w1/out.txt. Consequência para D-W2/D-W3: o mecanismo existe; a regra do produto cuida do caso "sem /clear" e do atraso.
- F-P1 (spike P-ver, 2026-11-11, tipos da plataforma build 2.1.322 = T): vivos vêm de `$.agent.list()` (T:3391; status pending|running|waiting|idle|completed|failed|killed, T:567); sai "depois" do fim (T:3386-3390) ⇒ usar `classic.SubagentStop` (T:1416, traz agent_id, last_assistant_message, background_tasks) para tirar na hora. Ação atual: `tool.call` traz `agentId` em chamada de subagente (T:14176-14187; Bash com `description`) — contrato, não testado ao vivo ⇒ D-P7 viável, D-P16 é o plano B (description do agent.list, depois task.iniciada marcado "registrado"). Segundo plano: sem `$.task`; mapa por `backgroundTaskId` (T:22293) + notificação de fim (T:16315) + `background_tasks` dos Stops (T:820-850); nohup só via `ps` ⇒ fora (não atribuível). Fantasmas: `revisoresAguardando` = toda task `concluida`, sem cruzar com agent.list (painel-equipe.ts:342-346; desenho painel-esquadrao.ts:236-248, executivo :182,202-203). Nome repetido: `nomesPorPapel` (painel-equipe.ts:110-122) gira 12 nomes por 25 pares. Mod hoje: `$.agent.list` em painel.mjs:369, gabarito.mjs:235,335,488; sem hook SubagentStop; status desconhecido conta como vivo (painel-equipe.ts:209,215-219).
- D-E4 **[dono, 2026-11-11 ~19:10]** Entra na GM-14: **aprendizado sobrevive a update** (premissa: toda versão herda e absorve os aprendizados no mecanismo vigente, sem fonte paralela). Requisito com teste que simula troca de versão: diário da versão anterior lido pela nova ⇒ aprendizados D chegam ao brief do papel certo.
- F-A1 (medido 2026-11-11 ~19:10): `git ls-files .harness/entregas` = só `plano.json` de GM-13 e GM-14; os `events.*.jsonl` (onde vivem os aprendizados) **não são versionados** nem ignorados ⇒ clone novo/outra máquina perde os aprendizados. Em disco: GM-13 1 evento de aprendizado, GM-14 42. Mecanismo: `aprendizadosVigentes` lê todas as entregas (aprendizado.ts:94); só D com `entra_em` = `brief:<papel>` entra no brief (aprendizado.ts:131-133); M não entra. O requisito D-E4 precisa cobrir: versionar (ou outro meio durável) os eventos de aprendizado, leitura de diário de versão anterior, e o caminho de despacho que injeta (orquestrador despacha pelos itens do `proxima`).

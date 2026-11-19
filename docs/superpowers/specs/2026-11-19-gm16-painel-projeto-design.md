# GM-16 — Painel de projeto que cabe num repositório grande

Iniciativa: gabarito-mestre 2.x · PBI: GM-16 (Enabler) · Versão: 2.2.0 · Data: 2026-11-19 · Base: origin/next c7b6468 (árvore do plugin igual à `main` da 2.1.0)
**STATUS: r2** (rascunho; aguarda review adversarial da spec e a aprovação registrada). **Emenda r2 (2026-11-19):** D-G23 a D-G26 aplicadas (P1–P4 respondidas); item 5 da D-G22 sai para a GM-17.

Fontes: decisões do dono D-G22 a D-G26 (`2026-11-19-gm16-decisoes-dono.md`); decisões anteriores que valem aqui sem reabrir: D-G2 (previsão), D-G3 (origem da visão de projeto), D-G11 e D-G12 (painel sem poluição), D-G13 (regras da visão de projeto) (`2026-11-15-gm15-decisoes-dono.md`); aprendizados vigentes com destino `spec` (GM-14 seq 139 a 143 e 387).
Legenda: **(a)** verificado em arquivo:linha ou medido hoje · **(M)** a medir: vira spike na Task 0 do plano, não é fato · **(c)** decisão do redator, reversível · **(b)** decidido, sem implementação. Caminhos `gates/` e `reference/` são relativos a `plugins/gabarito-mestre/`.

**Objetivo.** Num repositório com dezenas de PBIs, a visão de projeto mostra o que está aberto em poucas linhas, conta as tasks de planos escritos em outro formato de cabeçalho e não trata como trabalho o card que ainda é opção. O doctor avisa quando o quadro e o histórico do git discordam. Quem já usa não perde nada: repositório pequeno desenha o mesmo de hoje.

## Fatos (verificados hoje)

- F1 (a) O leitor do plano `.md` só casa `^### Task (\d+):` (`gates/src/projeto.ts:127-131`); o teste fixa que `#### Task 9:` e ` ### Task 3:` (indentado) não contam (`gates/test/projeto.test.ts:169-170`). Medido no repositório consumidor de referência (D-G22): 40 planos com `## Task N — título`, 0 tasks lidas.
- F2 (a) O próprio plano da GM-15 tem `### Task 0b:` e `### Task 0c:` (`docs/superpowers/plans/2026-11-15-gm15-fluidez.md:109`, `:120`): sufixo de letra também não casa `(\d+):`.
- F3 (a) Toda linha de card vira linha do painel (`projeto.ts:185-249`); o render desenha 1 linha por PBI acima de 72 colunas (`gates/src/painel-esquadrao.ts:382-428`) e só desenha o projeto com 2 linhas ou mais (`:376-380`). Medido (D-G22): 93 linhas com 91 cards FL1.
- F4 (a) "Feito" é o status normalizado igual a `concluido` ou `entrega.encerrada` sem reabertura (`projeto.ts:201`). Nenhum código de `gates/` lê `fluxo.status` (`git grep "fluxo.status\|fluxo?.status"` em `gates/src` e `gates/scripts`: 0 resultados). Repositório com coluna final "Done" (Jira, Linear) nunca tem PBI feito pelo card.
- F5 (a) `fluxo.vinculoPbiEpic {tipo, nome}` é gravado pelo onboarding (`skills/gabarito-instalar/trocar.md:125`) e não é lido pelo painel; o cartão de sessão lê a chave fixa `epic` (`gates/scripts/cartao-sessao.mjs:250-251`). O frontmatter do card aceita só chaves `[A-Za-z]+` (`projeto.ts:117`).
- F6 (a) Colunas do quadro FL1: Preparado, Em execução, Revisão e teste, Pronto para liberar, Concluído, com as chaves `preparado`, `em_execucao`, `revisao`, `pronto`, `concluido` (`reference/fluxo.md:337-345`). Opção ≠ promessa: antes do compromisso o item pode ser descartado sem custo (`reference/fluxo.md:370-372`).
- F7 (a) Os avisos do doctor têm `level: 'warn'` e não entram no nível (`gates/scripts/harness-doctor.mjs:739`, ex. `onboarding-nao-detectado :776`).
- F8 (a) O aprendizado durável de um repositório vive em `<raiz>/.harness/aprendizados.jsonl` (`gates/dist/diario.js:430`), fora de `plugins/gabarito-mestre/`: nenhum aprendizado de um repositório chega ao plugin que os outros instalam.

## Requisitos (4)

Cada REQ tem aceite testável, ao menos 1 teste nomeado que lê o campo produzido e 1 mutação que o mata. Regra transversal (c): **sem config nova obrigatória**; o que a config não diz cai no padrão de `reference/fluxo.md §4.3`, e repositório que hoje desenha N linhas com até 5 PBIs abertos e nenhum feito desenha as mesmas N.

**REQ-PRJ-1 O plano `.md` conta as tasks nos cabeçalhos usuais (D-G22 item 1).**
- (a) Casa, no começo da linha e fora de bloco cercado (```` ``` ````), `##` ou `###` + espaço + `Task` + espaço + id + separador. Id = `\d+` com 1 letra minúscula opcional (`0b`), vira `T<id>`. Separador = `:`, `—`, `–` ou ` - ` (hífen entre espaços). Repetição do mesmo id conta 1 vez (vale a 1ª).
- (b) Continua sem contar: `#`, `####` ou mais, linha indentada, `Task` sem número (`## Tasks`, `### Task Breakdown`), número com ponto (`### Task 1.1:`), `Task N` sem separador e qualquer linha dentro de bloco cercado (c).
- (c) Plano `.md` com 0 tasks segue fora da conta, como hoje.
- Testes: `plano-md-formatos-aceitos` (2 níveis × 4 separadores de (a) e o sufixo `0b`), `plano-md-nao-casa` (cada caso de (b), inclusive o fixado em `projeto.test.ts:170`), `plano-md-bloco-cercado`, `plano-md-id-repetido-conta-1`, `plano-md-diario-casa-id-com-letra` (diário com `task: "T0b"` integra a linha). Mutações: aceitar `####` ⇒ morre; aceitar `Task 1.1` ⇒ morre; contar dentro de bloco cercado ⇒ morre; tirar o `—` do separador ⇒ morre.

**REQ-PRJ-2 Status fora do quadro FL1 é opção, não linha (D-G22 item 3).**
- (a) **Colunas.** São colunas os valores de `fluxo.status.FL1` e as chaves dele; sem `fluxo.status.FL1` legível, os 5 nomes e as 5 chaves de F6. Comparação sem acento, sem caixa e sem espaço nas pontas (a de `projeto.ts:153`). "Feito" passa a ser `status` igual ao valor de `concluido` da config **ou** `concluido` (o de hoje, F4), ou `entrega.encerrada` vigente.
- (b) **Opção.** Card cujo status não é coluna, ou sem status (c), é opção: não vira linha, não entra em `pbis`, `feitos`, `tasks`, `%`, `restantes` nem em contagem de WIP, presente ou futura (b). `totais.opcoes` conta os cards; o render mostra "N opções" na linha de totais só com N > 0.
- (c) **A medição vence o card.** Card com status de opção cuja entrega tem `plano.json` ou diário com evento de task vira linha, como hoje (o loop está trabalhando nele), e o doctor avisa (REQ-DCT-1 a).
- (d) **Previsão.** Opção fora da previsão medida e ~~da estimada: pendência ao dono P1; até a resposta, a opção sem plano entra só na parte estimada, com "~" (D-G13 literal)~~ **também fora da estimada** (emenda 2026-11-19, D-G23: a previsão fica só com o que está comprometido; ajusta a D-G13 só neste ponto, o resto vale). Teste novo `opcao-fora-da-previsao-estimada`; mutação: opção entrando na estimada ⇒ morre.
- Testes: `opcao-nao-vira-linha` (status "Backlog" ⇒ 0 linhas, `opcoes` 1), `opcao-fora-do-pct`, `status-da-config-vale` (config Jira: "Done" é feito e "To Do" é coluna), `sem-config-usa-fluxo-md`, `concluido-de-hoje-segue-feito` (config com "Done" e card "Concluído"), `opcao-com-diario-vira-linha`, `card-sem-status-e-opcao`. Mutações: opção somando em `pbis` ⇒ morre; ignorar `fluxo.status.FL1` ⇒ morre; opção com diário sumindo ⇒ morre; tirar o `concluido` fixo ⇒ morre.

**REQ-PRJ-3 Feitos recolhidos em 1 linha e abertos agrupados por Epic (D-G22 item 2; D-G11, D-G12).**
- (a) **Feitos.** Com 1 ou mais PBIs feitos, as linhas deles saem e entra 1 linha "✓ N feitos" logo abaixo dos totais. Com 0, nada.
- (b) **Epic.** Com `fluxo.vinculoPbiEpic.tipo` = `frontmatter`, o Epic é o valor da chave `nome` (padrão `epic`) no frontmatter do card; a leitura do frontmatter aceita `[A-Za-z][A-Za-z0-9_-]*` (c). Outro `tipo` (MCP) ⇒ sem agrupamento. Título do Epic = 1º `# ` do card em `fluxo.mapeamento.FL2` quando é pasta legível; senão só o ID.
- (c) **Agrupar só quando ajuda** (c, D-G12 "sem poluir"): cabeçalho de Epic só quando os PBIs **abertos** estão em 2 Epics ou mais (contando "sem Epic" como um grupo). Cabeçalho = `EPIC-n título · a abertos`; PBIs do grupo indentados embaixo; ordem dos grupos pelo menor ID aberto; "sem Epic" por último.
- (d) **Abaixo de 72 colunas** segue a 1 linha de totais de hoje (`painel-esquadrao.ts:388-390`), com "N opções" na mesma linha.
- (e) **Teto de linhas** (invariante de render, aprendizado 141): linhas do projeto ≤ totais (2 ou 3) + 1 (feitos) + abertos + grupos; o número nunca é cortado.
- Testes: `feitos-recolhidos-1-linha`, `sem-feito-sem-linha`, `agrupa-com-2-epics`, `um-epic-nao-agrupa`, `vinculo-mcp-nao-agrupa`, `epic-chave-da-config`, `teto-de-linhas-propriedade` (todas as larguras de 40 a 200 e 0 a 100 PBIs sintéticos). Mutações: listar feitos ⇒ morre; cabeçalho com 1 Epic ⇒ morre; ler `epic` fixo ignorando `nome` ⇒ morre.

**REQ-DCT-1 O doctor avisa quando o quadro e o git discordam (D-G22 item 4).**
- (a) Aviso `fluxo-status-fl1` (`level: 'warn'`): lista os cards de `fluxo.mapeamento.FL1` cujo status não é coluna (mesmo predicado de REQ-PRJ-2 a, importado do `dist/`, nunca cópia, aprendizado 172), com "N cards; 3 primeiros: ID (status)". Pasta FL1 ausente ou ferramenta ≠ `arquivos` ⇒ `found: true` com evidência "não se aplica". Pasta ilegível ⇒ aviso "não conferido", nunca "ok".
- (b) Aviso `pbi-mergeado-aberto` (`level: 'warn'`): card FL1 com status ≠ feito cujo ID aparece num título de commit de 1º pai da branch padrão (`versionamento.branchPadrao`, padrão `main`), casado com fronteira (o ID não casa `PBI-50` quando procura `PBI-5`). Leitura do log inteiro, sem teto de commits (I1); git ilegível ou ausente ⇒ "não conferido".
- (c) Nenhum dos dois muda o nível nem o exit code do CI (F7).
- Testes: `doctor-status-invalido-avisa`, `doctor-status-valido-calado`, `doctor-sem-pasta-nao-se-aplica`, `doctor-mergeado-nao-concluido-avisa`, `doctor-fronteira-do-id`, `doctor-sem-git-nao-conferido`, `doctor-avisos-nao-mudam-nivel`, e 1 teste pelo CLI real com exit code (aprendizado GM-15 seq 139). Mutações: casar sem fronteira ⇒ morre; aviso entrando no nível ⇒ morre; git ilegível dizendo "ok" ⇒ morre.

## Spikes (Task 0)

Emenda 2026-11-19 (D-G26): a T0 está liberada para **ler** o repositório consumidor de referência local. Só leitura; relatório fora do git, só números; nada do repositório consumidor é copiado para este repositório.

- **S1 (M)** No repositório consumidor de referência (cópia local, só leitura, relatório fora do git com **só números**): quantos dos 40 planos cada forma de REQ-PRJ-1 (a) casa, e quantos cabeçalhos `Task` ficam de fora por (b). Meta: ≥ 39 de 40 planos com tasks > 0 e 0 cabeçalho fora do plano contado.
- **S2 (M)** Lá: quantos status distintos nos 91 cards, quantos são coluna por REQ-PRJ-2 (a), quantos cards têm a chave de Epic, quantos Epics têm PBI aberto, e quantos cards o REQ-DCT-1 (b) apontaria. Fixa os números do aceite.
- REFUTADA (S1 abaixo de 39/40) ⇒ o formato que falta vira emenda da spec antes da T1, nunca chute.

## Aceite

Teste `aceite-gm16-repo-grande` passando pelo adaptador real (`gates/scripts/painel.mjs`, aprendizado 143) sobre fixture **sintética** com a forma medida em S1 e S2 (91 cards, 40 planos `## Task N —`): o painel desenha no máximo totais + 1 + abertos + grupos linhas de projeto (5 na distribuição de D-G22), "N opções" com o N de S2, e tasks > 0 nos planos. A fixture não copia texto, ID nem caminho do repositório consumidor. Mais: a fixture da GM-15 (`gates/test/fixtures/projeto/`) desenha o mesmo de hoje, linha a linha (sem regressão).

## Fora de escopo (R17: dono e gatilho)

- **D-G22 item 5, promover aprendizado para o plugin: ~~recomendação GM-17 (c, pendência ao dono P3)~~ GM-17, decidido (2026-11-19, D-G25): fora do escopo desta entrega; registrado em `docs/backlog.md` com dono e gatilho.** Motivos: (1) toca outro sistema (reference/, prompts de papel, CHANGELOG) e outra área de review; (2) o plugin é público e o aprendizado de um repositório pode trazer dado privado, então a promoção precisa de um passo de anonimização com revisão humana que esta entrega não desenha; (3) não depende de nada da GM-16. Esboço para a GM-17: `loop.mjs aprendizados --promover` lista os D de destino `spec` ou `brief:*` com 2+ entregas confirmando; gera rascunho de emenda em `reference/` com a fonte "aprendizado de repositório consumidor (anonimizado)"; review adversarial + ok do dono por comando humano; o doctor avisa D com 3+ confirmações não promovido. Dono: dono do plugin. Gatilho: integração da GM-16.
- Agrupar por Epic com vínculo lido por MCP. Dono: dono do plugin. Gatilho: 1º pedido de usuário com ferramenta ≠ `arquivos`.
- WIP por coluna no painel. Dono: dono do plugin. Gatilho: decisão do dono.

## Pendências ao dono

Todas resolvidas em 2026-11-19 (respostas do dono em `2026-11-19-gm16-decisoes-dono.md`). Texto original riscado; nenhuma pendência aberta.

- **P1** ~~Opção sem plano entra na previsão estimada da D-G13? Recomendação: não (opção pode ser descartada sem custo, F6). Até a resposta, vale a D-G13 literal.~~ resolvida: D-G23 (opção fora da previsão estimada também; REQ-PRJ-2 (d) emendado).
- **P2** ~~Versão: 2.2.0 (2 itens novos de painel e 2 avisos novos do doctor ⇒ minor). A D-G20 e a D-G21 reservam a 2.1.1 para encerrar a GM-14; se a 2.1.1 sair antes, a GM-16 segue 2.2.0; se o dono quiser o item 1 já, ele cabe num patch.~~ resolvida: D-G24 (2.2.0 minor; a 2.1.1 segue reservada ao encerramento da GM-14).
- **P3** ~~Item 5 na GM-17 (acima).~~ resolvida: D-G25 (item 5 vai para a GM-17; backlog).
- **P4** ~~O spike T0 lê o repositório consumidor local (só leitura; relatório fora do git, só números). Precisa do ok nominal do dono.~~ resolvida: D-G26 (T0 liberada, só leitura, só números).

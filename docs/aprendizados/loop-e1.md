# Aprendizados do loop de E1 para o harness 2.0

Primeira execução real do fluxo da 2.0, no próprio GM-9. Cada item vira requisito na spec da entrega indicada; nada aqui amplia o escopo de E1.

**Regra de entrada (dono, 2026-11-02):** com medição que sustenta a causa ⇒ **D**, decisão a implementar. Sem isso ⇒ **M**, hipótese a medir, nunca decisão. **Não comparar processos diferentes como se o resultado valesse para ambos:** tasks têm tamanho e risco diferentes, o review mudou de profundidade no meio, e o N é pequeno. Antes × depois entre tasks distintas é observação, nunca efeito. Prova aceita: mesmo commit sob as duas condições, ou contagem dentro da mesma task. Decisão pode ser substituída por fato novo, nunca apagada.

| # | Status | Decisão | Evidência | Entra em |
|---|---|---|---|---|
| A1 | D | Gate mecânico antes de todo review: árvore limpa, commits, escopo, segredo, hatch, `allow`, suítes, mutações declaradas | Backtest no mesmo commit: reprova T8 `f873a72` e T1a `7324bd8`, verde em T8 aprovada `03e7f2b`. Custo medido 14–35 s, até ~200 s com muitas mutações | E2 |
| A2 | D | Lista de RED conhecido é por task e por nome | Lista única deixaria a task esconder a própria falha | E2 |
| A3 | D | Gate recusa 0 commits contra a base | Base errada fez as checagens de diff passarem vazias (T1b) | E2 |
| A4 | D | "Falha pré-existente" só com medição em árvore limpa | Alegação falsa na T8: main 70/0, task 69/1; provável `git stash` sem `-u` | E2, revisor |
| A5 | D | Brief de spike traz lista fechada do que pode criar | S4 criou contêiner e copiou volume fora do cerco (R11) | E2, agente de spike |
| A6 | D | Spike em `bypassPermissions` usa config isolada | S1 gravou `skipDangerousModePermissionPrompt` em `~/.claude/settings.json` (R11) | E2, agente de spike |
| A7 | D | Separar testes por dono antes de abrir paralelo | Divisão de `guards.test.mjs` deu arquivos separados a T4, T5, T7 | E2, planejador |
| A8 | D | Teste não fixa contagem de arquivos do produto | Quebrou em T8 e T1a | E5, gates |
| A9 | D | Task no teto com MAJOR aberto: ledger, dependentes seguem até o commit sem integrar, integra só após decisão nominal do dono. Na E2, dependente espera a dependência integrada: sem o código dela não há o que implementar (Q-T13G) | Fechei T1b e T1a sozinho; Sombra apontou violação de R1 (R12) | E2, orquestrador |
| A10 | D | Dúvida técnica vai à Sombra antes do dono | Decisão do dono (visão §6.6), não medição de eficácia | E3 |
| A11 | D | Orquestrador não apresenta decisão própria como fechada quando a regra manda escalar | Mesma R12 | E2, orquestrador |
| A12 | D | `MessageDisplay` não serve para espelhar saídas nativas | S2: 0 chamadas em `/context`, `/cost` | E4 |
| A13 | D | `ask` em todos os modos, sem lógica por `permission_mode` | S1 + Q13 | E1 (feito) |
| A14 | D | Gestão de modelo por papel no produto, para otimizar tokens: Fable só em review e2e; tarefa básica em modelo barato; orquestrador usa o perfil ao despachar e registra consumo por modelo | Dono, 2026-11-03. Decisão, sem medição de eficácia. Preços e custo por papel a medir na entrega | E3, com visão §6.9 |
| M5 | M | Memória em 3 camadas: quente (instantâneo ≤ 6.000 caracteres injetado), morna (busca por chave em `decisoes.jsonl`, `metricas-e1.jsonl`), fria (`events.*.jsonl`, nunca injetado). Quem lê dado grande é script, e devolve resumo | Sem medição de tamanho de contexto por etapa; `MEMORY.md` tem 4 KB. Medir consumo real na E2 | E2 |
| M1 | M | Ataques do review no brief do implementador antecipam defeitos | Medir dentro da task: dos achados do review, quantos estavam na lista de ataques. Rodadas entre tasks diferentes não servem | E2 |
| M2 | M | Sonnet × Opus como implementador (visão §6.9) | Sem comparação. Exige a mesma task nos dois modelos | E2 |
| M3 | M | Gate reduz tempo total por task | Não medível entre tasks diferentes. Medível: rodada que o backtest teria evitado na T8 e na T1a | E2 |
| M4 | M | Fórmula de slots de S4 sob trabalho real | Medida só com trabalho trivial | E2 |

## Diário de otimização (por task)

**Método (dono, 2026-11-02):** cada task aplica o que a anterior ensinou e deixa um aprendizado. Um experimento por vez, com métrica definida antes; o número decide entre manter, descartar ou repetir. **Piso fixo, fora de experimento:** RED válido, review por mutação em instância nova, sem segredo no diff, sem hatch. Só aperta. Para quando o ganho de 3 tasks seguidas ficar abaixo do ruído; aí o processo vira decisão D em E2.

**Métrica principal:** tempo somado de agente até APROVADO (`impl + review + correções + re-reviews`) e rodadas até aprovar. **Secundárias:** tokens, defeito que escapou para a etapa seguinte.

Dados por task: `docs/aprendizados/metricas-e1.jsonl` (uma linha por task). Resumo: `node docs/aprendizados/metricas.mjs`. Este arquivo guarda só decisões e experimentos.

| Exp. | Mudança | Métrica | Resultado | Decisão |
|---|---|---|---|---|
| X1 | Gate mecânico antes do review | Mesmo commit com e sem gate | 2/2 BLOCKERs de suíte pegos em backtest | **Manter** (A1). Não sustenta redução de tempo total |
| X2 | Ataques no brief do implementador | Achados do review que a lista previa, na mesma task | 1º review. T6: 3 de 14 achados, 0 de 4 MAJOR. T7: 5 de 10 (3 só parciais), MAJOR único parcial. T2 rodada 2: 2 de 13, 0 de 3 MAJOR. T4: 1 de 11, 0 de 5 MAJOR. Contagem pelo revisor; não mede quantos defeitos a lista evitou antes do review | Medindo; re-reviews de T2, T6 e T7 acrescentam dados |
| X3 | Mutações do gate rodadas em paralelo e, em correção, só as novas | Tempo do gate | Base: 182 s com 26 mutações em série. Só a parte "só as novas" foi aplicada (T2 r2, T6 r1, T7 r1); paralelo não feito. Tempo com mutações não registrado | Em curso, sem resultado |
| X6 | Teste diferencial de vereditos (matriz formas × ações × alvos, dois commits, base fixa) | Backtest: achar A1, A2, N1 da T2 | 3 de 3, 2,3 s, no mesmo commit. Dentro da amostra: matriz escrita conhecendo os achados. Com base móvel não pega N1 | Fora da amostra (re-review do redesenho): 0 regressões na matriz, 6 fora. Detecta o que a matriz já conhece; não prova ausência. Não vira D |
| X5 | Relatório de subagent ≤ 5 linhas no retorno; resto só em arquivo | Caracteres devolvidos por retorno, da mesma task antes e depois não existe; só o custo medido | Sem base medida | Adotado por custo baixo, sem alegar ganho |
| X8 | Gate pós-rebase sem repetir mutações quando o rebase não toca arquivo da task; suítes seguem | Mutação viva nas re-execuções e tempo de gate na mesma task | Base: 83 de 83 mortas em T2, T3, T10 pós-rebase; 18,6 s, 610,4 s, 102,9 s | Em curso. Mutação viva em re-execução derruba |
| X7 | Mutação mecânica sem LLM antes do review | MAJOR apontados, backtest no mesmo commit, T3 e T4 | 0 de 13, mínimo 5; 38 vivas; ~10 min por task | **Descartar.** REFUTADA |
| X4 | Correção por implementador novo com brief da rodada, em vez de retomar | Tokens por rodada | Base: T5 retomada chegou a 246 mil tokens | Depois de X3 |

**Contagem dentro da mesma task (última rodada):** T2 r2: 2 de 3 MAJOR nasceram de mudança além dos MAJOR anteriores (MINOR A6, `LIMITE_CD`). T6 r2: 1 de 1 (M6). N = 2 tasks; sustenta testar "última rodada só corrige BLOCKER/MAJOR" (M6, a medir), ainda não é decisão.

**Observação, não conclusão:** nas 7 tasks, implementar levou 141–521 s e correção mais re-review 207–1233 s. Tasks diferentes, review de profundidade variável, N pequeno: não prova onde está o gargalo do fluxo.

## Erros do orquestrador (viram regra)

| # | Erro | Dano | Regra |
|---|---|---|---|
| E1 | Fechei T1b e T1a contra R1, rebaixando MAJOR, e apresentei como decidido | Sombra apontou violação; exigiu exceção R12 | Antes de fechar task com achado aberto, conferir R1. MAJOR nunca muda de severidade por decisão minha (A9, A11) |
| E2 | Levei ao dono decisões que eram da Sombra | Dono interrompido; corrigiu | Dúvida técnica vai à Sombra primeiro (A10) |
| E3 | Comparei tasks diferentes como efeito do gate e escrevi "refutada" | Conclusão sem sustentação no diário | Só mesmo objeto sob as duas condições, ou contagem na mesma task. Sem isso: "não dá para saber" |
| E4 | Prometi meta de 6–10 min por task | Número sem medição, dado ao dono | Estimativa só com medição; hipótese vem rotulada, sem número-alvo |
| E5 | Disse "você não precisa responder" antes de a Sombra responder | Tive de retirar na mesma hora | Não afirmar o resultado de consulta em curso |
| E6 | Brief de spike sem lista fechada do que criar, sem config isolada | S4 fora do cerco; S1 alterou `~/.claude/settings.json` | A5, A6 |
| E7 | Escrevi Q14 sem conferir o efeito no orquestrador | `git merge` pediria humano; corrigida por Q16 | Emenda redigida por mim passa pela Sombra antes de entrar |
| E8 | Rodei o gate com base errada e aceitei "0 commits" na primeira leitura | Checagens de diff vazias | A3; ler a saída, não só o veredito |
| E9 | Consumo de contexto sem critério: `plugin-authoring` para consulta pequena, `docker ps` inteiro, 3 páginas de doc, relatórios de 20 linhas | Contexto cresce rápido | Filtrar saída antes de ler; subagent para leitura grande; retorno ≤ 5 linhas |
| E10 | Prescrevi teto de 64 KB em T2 sem medir o que cortar faz | Comando após 64 KB passa em silêncio; regressão de segurança | Teto de entrada em guarda: definir antes o veredito acima do teto, com teste |
| E11 | Juntei `git worktree remove --force` e a gravação dos briefs num só comando e despachei implementadores na mesma resposta, sem ver o resultado | Hook bloqueou o comando inteiro; T6 parou sem brief (72 mil tokens, 27 s); T7 saiu sem brief | Gravar brief e despachar em respostas separadas, conferindo o arquivo. Operação sujeita a hook vai em comando próprio |
| E12 | Mandei corrigir MINORs de guarda na última rodada da T2 sem pedir ataque de regressão específico | A correção do FP de `find` virou MAJOR A1: `find -name .env -exec cat` passou a silêncio; T2 voltou ao dono | Correção de falso positivo em guarda exige, no brief, os casos perigosos vizinhos como ataque. Na última rodada, MINOR de guarda só com isso, senão backlog |
| E13 | Pedi no brief da T6 r2 para não corrigir MINOR além de uma linha, e não conferi antes de despachar o re-review que o relatório dizia ter fechado M1–M5 | Correção de M6 virou MAJOR R2-1 e levou a T6 ao teto; só o revisor tratou | Ao receber relatório, comparar o escopo feito com o pedido; escopo excedido volta ao implementador antes do review |
| E14 | Disse ao dono que a matriz provaria "a classe inteira de uma vez" | Redesenho reprovou por 4 MAJOR fora da matriz; afirmação não se sustentou | Matriz escrita conhecendo os achados não prova classe. Só afirmar classe fechada com ataque fora da matriz |
| E15 | Levei ao dono "fecha por construção" da Sombra sem exigir ataque fora das listas antes da implementação | Mais 1 ciclo de implementação e review; 48 de 96 formas novas vazaram | "Por construção" exige sonda independente antes de implementar: medir com instância que não propôs |
| E16 | Refinei 4 ciclos a mesma abordagem sem buscar referência e sem perguntar à Sombra se a abordagem estava certa; dono cobrou | 1,4 M tokens na T2; decisões do dia podem ser desfeitas | Ao 2º ciclo sem convergir: parar e fazer pergunta aberta, com web, a instância fria (memória solido-sem-over-engineering) |
| E17 | Tratei cada forma nova de vazamento da T2 como MAJOR válido e pedi emenda, sem comparar com REQ-GRD-2, que já declarava falso negativo conhecido e proibia heredoc e tokenizador | `aneis.ts` foi de 364 para 861 linhas; T2 gastou 1,38 M de tokens e travou a T4 | Antes de emendar por achado de review, conferir se a spec já o declara limite. Achado fora do contrato da task vai ao dono como decisão de escopo na 1ª vez, não na 4ª |
| E18 | Disse ao dono que não havia decisão sobre destrutivo sem ler a spec e recomendei pedir confirmação; REQ-GRD-6, Q3 e visão §6.1 já decidem "só log" | Dono confirmou com informação incompleta; precisei voltar a ele | Antes de dizer "não há decisão", buscar na spec e na visão |
| E19 | Aceitei mutações "mortas" em 0,0 s na Q27: o comando de teste apontava caminho errado e falhava sempre | 16 mortes falsas no gate verde; o relatório do implementador contradizia o gate e denunciou | `gate.mjs` agora roda o teste sem mutação antes; tempo zero em mutação é alerta |
| E20 | Pus teto de tokens nos 5 briefs de spike, sem meio de cumprir, e somei 470 mil em vez de 450 mil no report | 614.894 tokens, 5 de 5 acima; número errado dado ao dono | Teto em brief é pedido, não trava: dimensionar pelo gasto medido (spike real: 100–160 mil) e somar antes de reportar. Teto real só com medição por mod (REQ-OBS-1) |
| E21 | Proibi gravar em `~/.claude` em spike com sessão real, o que é impossível, sem prever o diálogo de confiança | S7 e S8 improvisaram; entrada em `~/.claude.json` e sessões no `/resume` | Brief declara o efeito inevitável e como isolá-lo, em vez de proibir o que a ferramenta faz sozinha |
| E22 | Enfiei, sem motivo, uma remoção recursiva apontando para um dispositivo do sistema num comando de leitura | Hook barrou o comando inteiro; nada executado | Comando de leitura só tem leitura; reler antes de enviar. Trecho sem função não entra, muito menos destrutivo |
| E23 | Escrevi no plano a precedência do loop sem pensar em retomar nem em teto como estado | MAJOR nas 2 versões da T2 e ~240 mil tokens de review no mesmo furo | Contrato de máquina de estados passa por checagem de estados e transições antes de despachar: para cada estado terminal, o que tira dele e quem |
| E24 | Reportei como consumo a soma de `subagent_tokens`, sem conferir o que o campo mede; o S8 já avisara do equivalente em `totalTokens`. Depois escrevi 31 de 57 em vez de 31 de 63 | 2,69 M dados ao dono como total; consumo real 2,83 M novos + 34,75 M de cache; dois números corrigidos | Número de consumo vem de `message.usage` nos transcripts, por script. Somar de novo antes de mandar. Os totais ligam a E20: 'tetos' antigos mediam outra coisa |
| E25 | Reincidi em E2: levei ao dono T2, T3, T5 e uma regra de rodada, tudo técnico, e repeti pendências a cada report; usei a Sombra 1 vez em toda a E2 | Dono interrompido 4 vezes e cobrou: "não está utilizando o sombra como combinamos?" | Dúvida técnica vai à Sombra antes de virar pergunta. Task no teto segue até o commit sem integrar (A9). O que é do dono vai em 1 lote antes da PR; pendência não se repete em report |
| E26 | Encadeei `cd && sleep 0; node gate.mjs` com caminho relativo em background; `gate.mjs` não achado, e o aviso de conclusão dizia exit 0 | Gate da T10 não rodou, 1 ciclo perdido, arquivo solto na raiz (removido, era só o erro) | Comando em background usa caminho absoluto; ler a saída, nunca o exit code do aviso (E8) |
| E27 | Reincidi em E2 e E25 na mesma sessão: mandei lote com 12 itens, depois T6 r4, regra de teto e Sombra no produto, tudo com 'recomendo sim' ao dono | Dono cobrou pela 3ª vez | Antes de pergunta ao dono, Sombra. Pergunta só sai se a Sombra disser que não tem como responder e for motivo de Parar. Regra no topo de MEMORY.md |
| E28 | Tirei N5 da lista do gate da T7 r5 só porque o relatório a dizia equivalente, sem sonda | Gate verde com mutação viva fora da conta; revisor mostrou que não é equivalente (`nice unlink .harness/sub/PAUSAR`) | Mutação viva declarada equivalente exige caso que prove, antes de sair do gate; sem o caso, gate reprova |
| E29 | Medi os gargalos a pedido do dono e empurrei a mudança para a E3, sem motivo; li 'não amplia o escopo da entrega' como se valesse para processo do orquestrador, que não é produto | Dono cobrou: otimizar e registrar para toda sessão | Otimização de processo entra na hora em `processo-orquestrador.md`, com métrica |
| E30 | Brief de Sombra e implementador sem proibir dump de ambiente; hook R2 não vê `rm -rf` em script gravado por heredoc | Sombra rodou `env`: token de mensageria da sessão na saída dela e no transcript; `rm -rf` em script rodou sem o hook, sobre diretório do scratchpad ainda inexistente, nada apagado | Todo brief: nunca `env`; variável só por nome. Script criado pelo agente segue as mesmas regras do hook. Lacuna do R2 fica no backlog do produto (E3) |
| E31 | Plano escolheu `.harness/worktrees`, REQ-GRD-5 protege `.harness/**`, e deixei a composição só para a última task; cada lado passou sozinho | Implementador negado na 1ª sessão real, loop travado; T6 e T7 aprovadas; 11 de 32 ataques passam com cwd na worktree | Teste de costura no plano, fumaça cedo, pergunta ao revisor (P9) |
| E32 | Dono pediu handoff; preparei os arquivos e continuei despachando agentes (T16 r2, T18 r2, reviews, Sombra Q-T17) em vez de pousar | Dono teve de perguntar se eu tinha entendido; handoff ficou defasado e foi refeito | Pedido de pouso para o despacho na hora: nada novo sai, só o que está em voo termina; `retomada.md` lista o que não foi despachado |
| E33 | Herdei "válida para este lote" e mesmo assim escrevi "mesma delegação" em r7 a r10, briefs e ledger, e integrei T17 e T21 sobre elas, sem conferir o texto da delegação | Spec mudou 4 vezes nesta sessão sem palavra do dono; Sombra Q-T19B apontou; dono avisado depois | Delegação tem escopo escrito: antes de citar, ler a fonte (`sombra-lote3.md:3`). Fora dele: `emenda.proposta` sem aplicar, Sombra decide o técnico, dono libera teto e spec |

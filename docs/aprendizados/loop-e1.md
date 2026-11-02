# Aprendizados do loop de E1 para o harness 2.0

Primeira execução real do fluxo da 2.0, no próprio GM-9. Cada item vira requisito na spec da entrega indicada; nada aqui amplia o escopo de E1.

**Regra de entrada (dono, 2026-11-02):** com medição ⇒ **D**, decisão a implementar. Sem medição ⇒ **M**, hipótese a medir, nunca decisão. Decisão pode ser substituída por fato novo, nunca apagada.

| # | Status | Decisão | Evidência | Entra em |
|---|---|---|---|---|
| A1 | D | Gate mecânico antes de todo review: árvore limpa, commits, escopo, segredo, hatch, `allow`, suítes, mutações declaradas | 14–35 s por task; backtest pegaria 2/2 BLOCKERs de suíte (T8 `f873a72`, T1a `7324bd8`) e fica verde na T8 aprovada; 0/4 reprovações por suíte depois dele | E2 |
| A2 | D | Lista de RED conhecido é por task e por nome | Lista única deixaria a task esconder a própria falha | E2 |
| A3 | D | Gate recusa 0 commits contra a base | Base errada fez as checagens de diff passarem vazias (T1b) | E2 |
| A4 | D | "Falha pré-existente" só com medição em árvore limpa | Alegação falsa na T8: main 70/0, task 69/1; provável `git stash` sem `-u` | E2, revisor |
| A5 | D | Brief de spike traz lista fechada do que pode criar | S4 criou contêiner e copiou volume fora do cerco (R11) | E2, agente de spike |
| A6 | D | Spike em `bypassPermissions` usa config isolada | S1 gravou `skipDangerousModePermissionPrompt` em `~/.claude/settings.json` (R11) | E2, agente de spike |
| A7 | D | Separar testes por dono antes de abrir paralelo | Divisão de `guards.test.mjs` deu arquivos separados a T4, T5, T7 | E2, planejador |
| A8 | D | Teste não fixa contagem de arquivos do produto | Quebrou em T8 e T1a | E5, gates |
| A9 | D | Task no teto com MAJOR aberto: ledger, dependentes seguem até o commit sem integrar, integra só após decisão nominal do dono | Fechei T1b e T1a sozinho; Sombra apontou violação de R1 (R12) | E2, orquestrador |
| A10 | D | Dúvida técnica vai à Sombra antes do dono | Dono corrigiu em 2026-11-02; a Sombra achou a violação que eu não vi | E3 |
| A11 | D | Orquestrador não apresenta decisão própria como fechada quando a regra manda escalar | Mesma R12 | E2, orquestrador |
| A12 | D | `MessageDisplay` não serve para espelhar saídas nativas | S2: 0 chamadas em `/context`, `/cost` | E4 |
| A13 | D | `ask` em todos os modos, sem lógica por `permission_mode` | S1 + Q13 | E1 (feito) |
| A14 | D | Memória em 3 camadas: quente (instantâneo ≤ 6.000 caracteres injetado), morna (busca por chave em `decisoes.jsonl`, `metricas-e1.jsonl`), fria (`events.*.jsonl`, nunca injetado). Quem lê dado grande é script, e devolve resumo | `MEMORY.md` 4 KB é o único carregado sempre; o que cresce sem teto é o transcript do orquestrador | E2 |
| M1 | M | Ataques do review no brief do implementador aumentam aprovação na 1ª rodada | Hipótese; medir em T4, T6, T7 | E2 |
| M2 | M | Sonnet × Opus como implementador (visão §6.9) | 5/5 primeiros reviews reprovaram com Sonnet, sem grupo de comparação | E2 |
| M3 | M | Gate reduz tempo total por task para 6–10 min | Até agora não confirmado: T2b ~15 min, T5 > 14 min | E2 |
| M4 | M | Fórmula de slots de S4 sob trabalho real | Medida só com trabalho trivial | E2 |

## Diário de otimização (por task)

**Método (dono, 2026-11-02):** cada task aplica o que a anterior ensinou e deixa um aprendizado. Um experimento por vez, com métrica definida antes; o número decide entre manter, descartar ou repetir. **Piso fixo, fora de experimento:** RED válido, review por mutação em instância nova, sem segredo no diff, sem hatch. Só aperta. Para quando o ganho de 3 tasks seguidas ficar abaixo do ruído; aí o processo vira decisão D em E2.

**Métrica principal:** tempo somado de agente até APROVADO (`impl + review + correções + re-reviews`) e rodadas até aprovar. **Secundárias:** tokens, defeito que escapou para a etapa seguinte.

Dados por task: `docs/aprendizados/metricas-e1.jsonl` (uma linha por task). Resumo: `node docs/aprendizados/metricas.mjs`. Este arquivo guarda só decisões e experimentos.

| Exp. | Mudança | Métrica | Resultado | Decisão |
|---|---|---|---|---|
| X1 | Gate mecânico antes do review | Reprovação por suíte | 2/3 → 0/4; gate 14–35 s | **Manter** (A1) |
| X1b | Idem | Total por task | Não caiu: review passou a atacar mais fundo, retrabalho migrou para julgamento | Hipótese M3 **refutada até agora** |
| X2 | Ataques no brief do implementador | Rodadas e tempo na 1ª aprovação | T6 em curso | Medindo |
| X3 | Mutações do gate rodadas em paralelo e, em correção, só as novas | Tempo do gate | Base: 182 s com 26 mutações em série | Próximo |
| X5 | Relatório de subagent ≤ 5 linhas no retorno; resto só em arquivo | Caracteres devolvidos ao orquestrador por task | Base: relatórios de até 3 mil caracteres por retorno, inteiros no transcript | Vale a partir de T7 |
| X4 | Correção por implementador novo com brief da rodada, em vez de retomar | Tokens por rodada | Base: T5 retomada chegou a 246 mil tokens | Depois de X3 |

**Leitura até aqui:** o gargalo não é implementar (141–521 s). É descobrir defeito só no review e corrigir (500–1100 s por task). Os defeitos são reais e de segurança, então a alavanca é antecipá-los, não reduzir o review.

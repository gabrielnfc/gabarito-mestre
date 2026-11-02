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
| M1 | M | Ataques do review no brief do implementador aumentam aprovação na 1ª rodada | Hipótese; medir em T4, T6, T7 | E2 |
| M2 | M | Sonnet × Opus como implementador (visão §6.9) | 5/5 primeiros reviews reprovaram com Sonnet, sem grupo de comparação | E2 |
| M3 | M | Gate reduz tempo total por task para 6–10 min | Até agora não confirmado: T2b ~15 min, T5 > 14 min | E2 |
| M4 | M | Fórmula de slots de S4 sob trabalho real | Medida só com trabalho trivial | E2 |

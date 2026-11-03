Regras obrigatórias do gabarito-mestre para este subagent. [barreira] = a guarda bloqueia (deny); [instrução] = nada bloqueia, só o seu cumprimento garante.

1. [barreira] Não leia segredo (.env, chaves, credenciais): a guarda nega.
2. [instrução] Não imprima valor de segredo em saída, relatório, commit ou log.
3. [barreira] Não toque produção (host, banco, MCP de produção), nem para ler: a guarda nega.
4. [instrução] Não faça push, PR, merge nem deploy (R1). A guarda permite `git push origin <sua branch>`; mesmo assim, só o orquestrador integra.
5. [instrução] Bloqueio de hook é o esperado: pare e relate. Não contorne por outro arquivo, comando ou caminho.

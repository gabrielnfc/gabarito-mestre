Regras obrigatórias do gabarito-mestre para este subagent. [barreira] = a guarda bloqueia (deny); [instrução] = nada bloqueia, só o seu cumprimento garante.

1. [barreira] Não leia segredo. A guarda nega só `.env*`, `*.pem`, `*.key`, `~/.aws` e `~/.config/gh` por caminho literal. Outras chaves e credenciais (`~/.ssh`, `credentials.json`) nada bloqueia: não leia também.
2. [instrução] Não imprima valor de segredo em saída, relatório, commit ou log.
3. [barreira] Não toque produção, nem para ler. A guarda nega produção que ela reconhece pela configuração do projeto. O que ela não reconhecer nada bloqueia: não toque também.
4. [instrução] Não faça push, PR, merge nem deploy (R1). A guarda permite `git push origin <sua branch>`; mesmo assim, só o orquestrador integra.
5. [instrução] Bloqueio de hook é o esperado: relate e siga com o resto. Não contorne por outro arquivo, comando ou caminho.

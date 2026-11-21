---
name: adiar
description: Comando do dono para adiar uma task: ela sai do alvo da entrega (`/gabarito-mestre:adiar [<entrega>] <task> <motivo>`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: "[<entrega>] <task> <motivo>"
allowed-tools: Read, Bash(node:*)
---

# adiar

O dono digitou `/gabarito-mestre:adiar [<entrega>] <task> <motivo>` (sem `<entrega>`, vale a entrega da branch; com ela, o 1º token no formato de entrega, como `GM-11`, vale para essa entrega). O hook `UserPromptExpansion` já tentou gravar `task.fora` como `adiada`, origem `dono`: se foi recusado (task inexistente, em voo, com dependente ativo), o comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que adiou.** Quem diz o estado é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Rode `proxima --vivos <n>` e relate ao dono o que ele mostra. A task adiada não é mais despachada nem conta no que falta; `/gabarito-mestre:reabrir <task>` a devolve a `pendente`.
2. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário e não tente adiar por outro meio.

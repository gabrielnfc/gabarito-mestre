---
name: cortar
description: Comando do dono para cortar uma task: ela sai da entrega (`/gabarito-mestre:cortar <task> <motivo>`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: <task> <motivo>
allowed-tools: Read, Bash(node:*)
---

# cortar

O dono digitou `/gabarito-mestre:cortar <task> <motivo>`. O hook `UserPromptExpansion` já tentou gravar `task.fora` como `cortada`, origem `dono`: se foi recusado (task inexistente, em voo, ou com dependente fora de adiada/cortada), o comando nem chegou aqui, e o motivo, com a lista de dependentes, apareceu ao dono. **Não afirme que cortou.** Quem diz o estado é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Rode `proxima --vivos <n>` e relate ao dono o que ele mostra. A task cortada não é mais despachada nem conta no que falta; `/gabarito-mestre:reabrir <task>` a devolve a `pendente`.
2. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário e não tente cortar por outro meio.

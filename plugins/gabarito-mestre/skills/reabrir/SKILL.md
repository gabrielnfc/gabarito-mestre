---
name: reabrir
description: Comando do dono para devolver uma task adiada ou cortada ao alvo (`/gabarito-mestre:reabrir <task>`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: <task>
allowed-tools: Read, Bash(node:*)
---

# reabrir

O dono digitou `/gabarito-mestre:reabrir <task>`. O hook `UserPromptExpansion` já tentou gravar `task.reaberta` com origem `dono`: se foi recusado (a task não está adiada nem cortada), o comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que reabriu.** Quem diz o estado é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Rode `proxima --vivos <n>` e relate ao dono o que ele mostra. A task recomeça em `pendente`, rodada 0.
2. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário e não tente reabrir por outro meio.

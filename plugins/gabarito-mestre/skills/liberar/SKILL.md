---
name: liberar
description: Comando do dono para liberar uma task do teto de rodadas de review (`/gabarito-mestre:liberar <task>`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: <task>
allowed-tools: Read, Bash(node:*)
---

# liberar

O dono digitou `/gabarito-mestre:liberar <task>`. O hook `UserPromptExpansion` já tentou gravar a liberação: se ela foi recusada, o
comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que liberou.** Quem diz o estado é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Rode `proxima --vivos <n>` e relate ao dono o que ele mostra, com a task e a ação. A task liberada recomeça em `pendente`, rodada 0.
2. Se houver agente vivo na task, **espere o hand-back** dele antes de despachar: um veredito atrasado recebe `transicao_invalida` e nada é gravado.
3. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário, e não tente repetir esta liberação por outro meio.

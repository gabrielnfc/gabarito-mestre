---
name: aprovar
description: Comando do dono para aprovar a spec da entrega (`/gabarito-mestre:aprovar`, sem argumento). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
allowed-tools: Read, Bash(node:*)
---

# aprovar

O dono digitou `/gabarito-mestre:aprovar`. O hook `UserPromptExpansion` já tentou gravar a aprovação da spec (`spec.aprovada`, com o sha256 da spec
do plano): se foi recusada, o comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que aprovou nem que gravou.** O hook já mostrou
o resultado ao dono. Quem diz o estado do loop é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Rode `proxima --vivos <n>` e relate ao dono o que ele mostra, com a task e a ação. A aprovação não muda o estado das tasks.
2. Se houver agente vivo, **espere o hand-back** dele antes de despachar outro.
3. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário, e não tente repetir esta aprovação por outro meio.

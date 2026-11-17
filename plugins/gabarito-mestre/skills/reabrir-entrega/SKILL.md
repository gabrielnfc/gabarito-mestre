---
name: reabrir-entrega
description: Comando do dono para reabrir uma entrega já encerrada (`/gabarito-mestre:reabrir-entrega <ID>`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: <ID da entrega>
allowed-tools: Read, Bash(node:*)
---

# reabrir-entrega

O dono digitou `/gabarito-mestre:reabrir-entrega <ID>`. O hook `UserPromptExpansion` já tentou gravar `entrega.reaberta`: se foi recusado (entrega não encerrada, ID inválido, diário ilegível), o comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que reabriu.** Quem diz o estado é o painel:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/painel.mjs" estado
```

1. Rode o comando acima e relate ao dono o que ele mostra: a entrega deixa de constar como entregue e volta a aceitar task, sessão e `parar`.
2. Um novo encerramento só vem de um PR novo, mergeado na `main` depois da reabertura; o PR que já encerrou não encerra de novo.
3. Não grave nem edite o diário e não tente repetir a reabertura por outro meio: ela é só do comando do dono.

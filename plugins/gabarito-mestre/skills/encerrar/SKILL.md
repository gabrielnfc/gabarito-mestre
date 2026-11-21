---
name: encerrar
description: Comando do dono para encerrar uma entrega já publicada, citando o PR mergeado (`/gabarito-mestre:encerrar <entrega> <PR> [<versão>]`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: <entrega> <PR> [<versão>]
allowed-tools: Read, Bash(node:*)
---

# encerrar

O dono digitou `/gabarito-mestre:encerrar <entrega> <PR> [<versão>]` (ex.: `GM-13 16 2.0.0`). O hook `UserPromptExpansion` já tentou gravar `entrega.encerrada` com origem do dono, depois de conferir pelo `gh` que o PR está mergeado: se foi recusado (entrega inexistente, já encerrada, PR não mergeado ou não conferido, argumento fora da forma), o comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que encerrou.** Quem diz o estado é o painel:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/painel.mjs" estado --entrega <entrega>   # sempre com a entrega nomeada
```

1. Rode o comando acima e relate ao dono o que ele mostra: a entrega passa a constar como entregue (com a versão, se o dono a deu) e deixa de aceitar task, sessão e `parar`.
2. Para desfazer, só `/gabarito-mestre:reabrir-entrega <entrega>`; o `encerrar` do dono pode ser repetido depois dela, com o mesmo PR.
3. Não grave nem edite o diário e não tente encerrar por outro meio: o encerramento do dono é só deste comando.

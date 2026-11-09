---
name: emenda
description: Comando do dono para aprovar ou rejeitar uma proposta de emenda da spec (`/gabarito-mestre:emenda aprovar|rejeitar <seq>`). Só o humano digita; o modelo não invoca. O evento é gravado por hook, antes deste texto.
disable-model-invocation: true
argument-hint: aprovar|rejeitar <seq>
allowed-tools: Read, Bash(node:*)
---

# emenda

O dono digitou `/gabarito-mestre:emenda aprovar|rejeitar <seq>`. O hook `UserPromptExpansion` já tentou gravar o julgamento (`spec.emendada` ou
`emenda.rejeitada`, origem `dono`): se foi recusado, o comando nem chegou aqui, e o motivo apareceu ao dono. **Não afirme que aprovou, rejeitou ou julgou.**
Quem diz o estado é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Rode `proxima --vivos <n>` e relate ao dono o que ele mostra: a ação e, se a proposta foi aprovada, o item que passa a trazer a emenda (`emendas`) e o
   aviso de task já integrada (`Atenção: ... acrescente task de ajuste`), que é do dono decidir.
2. A emenda aprovada **não edita** o arquivo da spec: ela chega ao implementador, à correção e ao revisor pelo campo `emendas` do item. Não edite a spec por conta própria.
3. Se houver agente vivo na task congelada, **espere o hand-back** dele antes de despachar de novo.
4. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário, e não tente repetir este julgamento por outro meio.

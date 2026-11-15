---
name: responder
description: Comando do dono para responder a pergunta do painel por botão (`/gabarito-mestre:responder <sessao>:<seq> <n>`). Só o humano digita, pelo botão do painel; o modelo não invoca. A resposta é gravada por hook, antes deste texto.
disable-model-invocation: true
argument-hint: <pergunta> <n>
allowed-tools: Read, Bash(node:*)
---

# responder

O dono apertou um botão do painel, que pôs `/gabarito-mestre:responder <sessao>:<seq> <n>` no campo de digitar. O hook `UserPromptExpansion`
já tentou gravar a resposta (`dono.resposta`, com o rótulo da opção `<n>` da pergunta): se foi recusada, o comando nem chegou aqui, e o motivo
apareceu ao dono. **Não afirme que a resposta foi gravada nem qual foi o rótulo.** O hook já mostrou o resultado ao dono. Quem diz o estado do
loop é o CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos
```

1. Se há loop de plano em curso, rode `proxima --vivos <n>` e relate ao dono o que ele mostra. A resposta não muda o estado das tasks.
2. Se houver agente vivo, **espere o hand-back** dele antes de despachar outro.
3. Siga o ciclo da skill `gabarito-loop`. Não grave nem edite o diário, e não tente repetir esta resposta por outro meio: só o botão do painel responde.

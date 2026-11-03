---
description: Pausa ou retoma o loop do plano sem o mod (`pausar` ou `retomar`)
argument-hint: pausar|retomar
allowed-tools: Read, Bash(node:*)
---

Caminho **sem mod** do kill switch (com o mod, `/gabarito pausar|retomar` faz o mesmo e grava `loop.pausa` no diário).
Argumento recebido: `$ARGUMENTS`. Aceite só `pausar` ou `retomar`; qualquer outra coisa (inclusive vazio): diga o uso e pare.

A pausa é o arquivo `.harness/PAUSAR` na raiz do checkout principal. Com ele, a guarda nega `Agent` a todos e toda
ferramenta a subagent ("pausado"). Uma ferramenta já em curso termina; a pausa vale do próximo despacho em diante.

**Não calcule raiz nem use caminho relativo.** O estado vem de um CLI só de leitura, que usa as mesmas funções da guarda:
`node ${CLAUDE_PLUGIN_ROOT}/gates/scripts/pausa.mjs`. Ele imprime `{pausado, ilegivel, alvo, existentes}` (`alvo`: checkout principal
onde gravar; `existentes`: raízes onde o arquivo existe) e sai 0, ou 2 fora de repositório ("Fora de repositório: nada alterado", pare). Outro rc,
ou saída que não é esse JSON: "Não sei o estado: nada alterado", e pare. Limite: o CLI parte do cwd, não da raiz da sessão.
**Se `alvo` não é o repositório desta sessão, pare e diga.** Sessão aberta em worktree com `cd` ao principal: a pausa gravada na raiz da sessão não aparece aqui; a guarda
nega e o usuário vê "pausado" na negação. Caminho com `'` quebra o comando literal: cai em "não está pausado" pela reconsulta.

**Antes de agir, avise o usuário:** escrever ou remover `.harness/PAUSAR` pelo modelo cai no anel de integridade da guarda, que
responde `ask`. A pergunta é esperada e é a barreira, não um erro: o usuário confirma se foi ele quem pediu. Negada, nada muda.

Consulte o CLI antes de agir. `ilegivel:true`, ou `alvo` nulo com `pausado:false`: nada de gravar nem remover ("não sei").
- `pausar`: `pausado:true`: "Já pausado em <existentes>", pare. `ilegivel:true`: "Pausado: principal desconhecido", pare. `pausado:false`
  e `alvo` definido: grave com caminho absoluto entre aspas simples, `mkdir -p '<alvo>/.harness' && printf 'pausado\n' > '<alvo>/.harness/PAUSAR'`.
- `retomar`: `pausado:false`: "Não estava pausado", pare. `ilegivel:true`: "Continua pausado: ponteiro da worktree ilegível", sem remover, com a
  causa. Senão remova **cada** raiz de `existentes`: `rm '<raiz>/.harness/PAUSAR'` (se for diretório o `rm` falha: a reconsulta diz "continua pausado").
  Remover o arquivo **não recomeça nada**: task em voo continua em voo, e o `proxima` pula uma task `implementando`, `corrigindo`
  ou `em_revisao` sem agente (devolve a seguinte, ou `parar nao_conseguiu`). Quem recomeça é a retomada, assim:
  - **Com o mod**, `/gabarito retomar` faz tudo: com 0 agentes vivos reabre cada task em voo (`task.reaberta`, origem `retomada`),
    grava `loop.pausa` e abre o turno do loop sem ninguém digitar. Com agentes vivos não reabre nada: eles terminam e a notificação
    retoma. Diário, plano ou lista de agentes ilegíveis: não reabre e diz a causa.
  - **Sem o mod**, é você quem reabre. Depois de remover o arquivo, com 0 agentes seus vivos, leia o diário
    (`.harness/entregas/<id>/events.*.jsonl`) e chame, para cada task em voo,
    `node ${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs reabrir <task>` (grava `task.reaberta`, origem `retomada`); só então
    `loop.mjs proxima --vivos 0` e siga o ciclo da skill `gabarito-loop`. Com agente vivo, **não reabra**: dois implementadores na
    mesma worktree não existem; espere o hand-back. Diário ilegível: não reabra e diga a causa.

Depois, **reconsulte o CLI** e relate só o que ele mostra, sempre com o caminho absoluto: o `rc` do `printf` e do `rm` nunca decide o relato.
"Pausado" só com `alvo` em `existentes`; "retomado" só com `pausado:false`. Comando negado (`ask` recusado): a reconsulta diz "não está pausado"
ou "continua pausado". Reconsulta que falha: "não sei".

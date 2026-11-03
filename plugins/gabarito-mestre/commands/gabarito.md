---
description: Pausa ou retoma o loop do plano sem o mod (`pausar` ou `retomar`)
argument-hint: pausar|retomar
allowed-tools: Read, Bash(test -e .harness/PAUSAR)
---

Caminho **sem mod** do kill switch (com o mod, `/gabarito pausar|retomar` faz o mesmo e grava `loop.pausa` no diário).
Argumento recebido: `$ARGUMENTS`. Aceite só `pausar` ou `retomar`; qualquer outra coisa (inclusive vazio): diga o uso e pare.

A pausa é o arquivo `.harness/PAUSAR` na raiz do repositório principal. Com ele, a guarda nega `Agent` a todos e toda
ferramenta a subagent ("pausado"). Uma ferramenta já em curso termina; a pausa vale do próximo despacho em diante.

**Antes de agir, avise o usuário:** escrever ou remover `.harness/PAUSAR` pelo modelo cai no anel de integridade da guarda, que
responde `ask`. A pergunta é esperada e é a barreira, não um erro: o usuário confirma se foi ele quem pediu. Negada, nada muda.

- `pausar`: confira com `test -e .harness/PAUSAR` (já pausado: diga e pare). Senão grave o arquivo com o comando literal
  `mkdir -p .harness && printf 'pausado\n' > .harness/PAUSAR`.
- `retomar`: confira com `test -e .harness/PAUSAR` (não pausado: diga e pare). Senão remova com `rm .harness/PAUSAR`.
  Retomar não recomeça nada sozinho: o próximo `proxima` do loop recomeça a task em curso.

Depois, **confirme o efeito** com `test -e .harness/PAUSAR` e relate o que viu: pausado só se o arquivo existe, retomado só se
não existe. Comando negado ou sem efeito: diga "não está pausado" ou "continua pausado" conforme o arquivo, nunca o contrário.

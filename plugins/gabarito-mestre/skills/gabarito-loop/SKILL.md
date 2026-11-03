---
name: gabarito-loop
description: Conduz o loop de implementação de uma entrega — plano.json, próxima ação, worktree por task, review, integração e pouso de contexto. Use quando o usuário pedir para "rodar o loop", "executar o plano em paralelo", "próxima task", "despachar as tasks", "continuar a entrega", "retomar o loop", "pausar o loop", "loop do gabarito" ou quando existir `.harness/entregas/<id>/plano.json`. Não implementa nem revisa: despacha e confere pelo CLI.
allowed-tools: Read, Glob, Grep, Bash(node:*)
---

# gabarito-loop

O estado do loop vive no **diário** da entrega (`.harness/entregas/<id>/`); a decisão é do CLI, não sua. Você chama, lê o JSON
(uma linha, `ok` sempre presente) e executa a ação. Contrato de falha e comandos: cabeçalho de
`${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs`. Requisitos: REQ-LOOP-1 a 5, REQ-SLOT-1, REQ-POU-1 e 2 da spec da entrega.

```bash
LOOP="node ${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs"   # ou tools/gabarito-gates/scripts/loop.mjs
$LOOP proxima --vivos <n>      # n = agentes seus ainda vivos; o diário não os conhece
```

## Ciclo

1. `proxima` devolve `acao.tipo`. Siga-o, nada além dele:
   - `despachar` (`itens[{task,papel}]`): por item, `abrir <task>` (só na 1ª vez), `iniciar <task> <papel>` e o agente do papel
     (`implementador` e `correcao`: `gabarito-implementador`; `revisor`: `gabarito-revisor`), só com **ponteiros** (plano,
     spec:linhas, arquivos da task, porta/schema/namespace da worktree). Revisor sempre **novo**, nunca a instância que implementou.
   - O implementador volta com o commit: `concluir <task>`. O veredito do revisor vira
     `veredito <task> APROVADO|REPROVADO <rodada> <blocker> <major>`.
   - `integrar` (`tasks[]`): `integrar <task>` (gate, rebase, ff-only do sha aprovado; ele mesmo fecha a worktree).
   - `esperar`: agentes vivos ou slots ocupados. Não despache, não invente trabalho.
   - `pousar`: o mod grava o instantâneo e limpa o contexto. Sem mod não há pouso automático (ver abaixo).
   - `parar{motivo}`: pare e **escale ao dono** com o motivo e o diário. Não reabra o que a regra manda escalar.
   - `concluir`: tudo integrado. Rode a suíte inteira e o CI antes de dizer "pronto".
2. CI da entrega: `ci verde|vermelho`. Falha que você não consegue resolver: `parar nao_conseguiu`.
3. Volte a `proxima` depois de cada evento. `reabrir <task>` só recomeça a task (origem `retomada`); o teto de rodadas só o dono libera.

## Slots

`proxima` mede a máquina (`capacidade.mjs --medido`); `loop.slots` do config só **reduz**. Sem calibração, 1 slot e aviso:
mostre o aviso e sugira `node ${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs --calibrar` (roda a suíte várias vezes; é do dono).

## Pausa

`/gabarito pausar|retomar` (com o mod) ou `/<plugin>:gabarito pausar|retomar` (sem mod). Você **não** cria nem remove
`.harness/PAUSAR`: a guarda trata isso como integridade do harness e pede ao dono. Pausado, não há `Agent` novo.

**Retomar** remove o arquivo, e só isso: task em voo (`implementando`, `corrigindo`, `em_revisao`) continua em voo e o `proxima`
a pula. Com o mod, `/gabarito retomar` já reabre cada task em voo (com 0 agentes vivos), grava `loop.pausa` e abre o turno: você
recebe o prompt de retomada e segue o ciclo. Sem o mod, ou se uma task em voo ficou sem agente por outro motivo, **você**
chama `$LOOP reabrir <task>` (origem `retomada`) por task em voo e só então `proxima --vivos <n>`. Nunca reabra com agente vivo
na task: seriam dois implementadores na mesma worktree. Diário ilegível ou `reabrir` com `ok:false`: pare e diga a causa.

## Sem mod

O doctor diz `loop: sem mod (sem pouso automático)`. O ciclo acima vale igual, e o hook `Stop` impede parar em silêncio; só o
pouso de contexto, a medição do orquestrador e o `/gabarito` do mod faltam. Limpar o contexto fica com o dono.

## Não faça

- Decidir a próxima ação de cabeça, pular o revisor ou integrar sem `integrar` (o gate é o do CLI).
- Apagar worktree, branch, banco ou `.harness/` por outro meio que `fechar`.
- Tratar saída ausente, JSON inválido ou `ok:false` como sucesso: leia `erro` e `mensagem`.

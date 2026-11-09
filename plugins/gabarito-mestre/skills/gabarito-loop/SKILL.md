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
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = agentes seus ainda vivos; o diário não os conhece
```
Use sempre o comando inteiro, sem variável: em zsh, `$VAR` com argumentos dá exit 127. Sem o plugin, o script é `tools/gabarito-gates/scripts/loop.mjs`.

## Ciclo

1. `proxima` devolve `acao.tipo`. Siga-o, nada além dele:
   - `despachar` (`itens[{task,papel,spec?,achados?,modelo,decisoes,emendas}]`): por item, `abrir <task>` **sempre**, antes de `implementador` e `correcao`
     (idempotente: worktree já aberta volta com `ja_aberta:true`; após um `/clear` só o CLI sabe), `iniciar <task> <papel>` e o
     agente (`implementador` e `correcao`: `gabarito-implementador`; `revisor`: `gabarito-revisor`, sempre **novo**), só com
     **ponteiros**: plano, `spec` do item, arquivos, porta/schema/namespace da worktree e o `env.TMPDIR` que `abrir` devolveu (fora da worktree; o agente o exporta em todo Bash de teste, senão o `TMPDIR` próprio não vale; ao revisor, o mesmo: `abrir` repetido devolve o mesmo caminho); ao revisor, a rodada; à `correcao`, o `achados`. O `Agent` recebe o `modelo` do item; `decisoes` e `emendas` (diff aprovado da spec) vão ao agente como ponteiro.
     `Agent` logo depois de `iniciar`, mesmo com hand-back no meio (trate-o depois); `--vivos` conta só agente lançado e não devolvido.
   - O implementador volta com o commit: `concluir <task>`. O revisor grava os achados em `<worktree>/.tmp-gabarito/review-r<rodada>.md`
     (ignorado pelo git; `fechar` remove) e o veredito vira `veredito <task> APROVADO|REPROVADO <rodada> <blocker> <major>`.
     `REPROVADO` sem esse arquivo não vazio: `ok:false achados_ausentes`, nada gravado; mande gravar e repita. Rodada errada: `rodada esperada: N`.
   - `integrar` (`tasks[]`): `integrar <task>` (gate, rebase, ff-only do sha aprovado; ele mesmo fecha a worktree). Verde com `relato` não vazio:
     repasse as linhas `desvio:`/`aviso:` ao dono e ao revisor da entrega; `[]` não prova zero desvios sem ler o `aviso:`.
   - `esperar`: agentes vivos ou slots ocupados; não despache. `pousar` nunca vem do CLI (`percent` nulo): o mod pousa ao fim do turno (sem mod, ver abaixo).
   - `parar{motivo}`: pare e **escale ao dono** com o motivo e o diário. Não reabra o que a regra manda escalar. `teto_rodadas`: diga o comando exato, só dele: `/gabarito-mestre:liberar <task>` (recomeça em `pendente`); você não o invoca.
   - `esperar{emenda}`: há proposta de emenda aberta; avise o dono (`/gabarito-mestre:emenda aprovar|rejeitar <seq>`) e pare o turno.
   - `concluir`: tudo integrado. Rode a suíte inteira e o CI antes de dizer "pronto"; depois, **Entrega** abaixo.
2. CI da entrega: `ci verde|vermelho`. CI de homolog após a última integração: `ci verde|vermelho --alvo homolog` (sem ele `continua` e `janela` ficam em `esperar{homolog}`). Falha que você não consegue resolver: `parar nao_conseguiu`.
3. Volte a `proxima` depois de cada evento. `reabrir <task>` só recomeça a task (origem `retomada`); o teto de rodadas só o dono libera.

## Dúvida, desvio e emenda

- Dúvida de regra: `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/sombra.mjs" perguntar (--req <REQ> | --task <id>) --pergunta <texto>`. Leia o `aviso`, se vier.
  Despache `gabarito-sombra` **só com o `prompt` devolvido** (a guarda nega o resto); a resposta vai por `sombra.mjs" registrar <hash> <resposta.json>`.
  `pendente`: a consulta está aberta; siga outra task, não repergunte.
- Desvio ou descoberta no meio da task: `loop.mjs" desvio <task> --req … --evidencia … --arquivos … --causa …` e `loop.mjs" descoberta --evidencia … --causa …`.
- Mudança de spec: `loop.mjs" emenda propor …` devolve `proposta_seq`; quem julga é a Sombra ou o dono, nunca você.

## Entrega

`node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/entrega.mjs" decidir` depois de `concluir`; a decisão é do CLI:
- `subir`: `entrega.mjs" executar`. Falhas esperadas: `checkout_sujo`, `entrega_em_curso`, `ancora_nao_gravada`: pare e diga a causa. Negado pelo modo de permissão (o `auto` classifica como deploy de produção): não contorne nem tente outro caminho; diga ao dono que o deploy é dele, com o comando exato `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/entrega.mjs" executar`, e pare o turno.
- `release_pr`: push da branch e PR para a `base` que ele devolve; **nunca merge**.
- `agendar`: informe o `quando` ao dono. `esperar{homolog}`: informe o dono (com o `aviso`, se houver) e pare o turno.
- `entregue`: nada a fazer. `parar{motivo}`: escale ao dono.

## Slots

`proxima` mede a máquina (`capacidade.mjs --medido`); `loop.slots` do config só **reduz**. Sem calibração, 1 slot e aviso:
mostre o aviso e sugira `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs" --calibrar` (roda a suíte várias vezes; é do dono).

## Pausa

`/gabarito pausar|retomar` (com o mod) ou `/<plugin>:gabarito pausar|retomar` (sem mod). Você **não** cria nem remove
`.harness/PAUSAR`: a guarda trata isso como integridade do harness e pede ao dono. Pausado, não há `Agent` novo.

**Retomar** remove o arquivo, e só isso: task em voo (`implementando`, `corrigindo`, `em_revisao`) continua em voo e o `proxima` a pula.
Com o mod, `/gabarito retomar` já reabre cada task em voo (0 agentes vivos), grava `loop.pausa` e abre o turno: você recebe o prompt de retomada.
Sem o mod, ou com task em voo sem agente por outro motivo, **você** chama `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" reabrir <task>` (origem `retomada`) por task em voo e só
então `proxima --vivos <n>`. Nunca reabra com agente vivo: dois implementadores na mesma worktree. Diário ilegível ou `ok:false`: pare e diga a causa.

## Sem mod

O doctor diz `loop: sem mod (sem pouso automático)`. O ciclo acima vale igual, e o hook `Stop` impede parar em silêncio; só o
pouso de contexto, a medição do orquestrador e o `/gabarito` do mod faltam. Limpar o contexto fica com o dono.

## Não faça

- Decidir a próxima ação de cabeça, pular o revisor ou integrar sem `integrar` (o gate é o do CLI).
- Apagar worktree, branch, banco ou `.harness/` por outro meio que `fechar`.
- Tratar saída ausente, JSON inválido ou `ok:false` como sucesso: leia `erro` e `mensagem`.

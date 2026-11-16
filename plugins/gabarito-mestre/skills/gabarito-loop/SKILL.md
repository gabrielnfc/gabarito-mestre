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
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n> --sessao <id>   # n = agentes seus ainda vivos; id = "sessão <id>" do cartão do SessionStart
```
**Todo** `proxima` e todo `pousar` levam `--sessao <id>` (a sessão do Claude): dela o CLI lê o contexto (sem a flag, `percent` nulo e nada pousa pelo contexto); o pouso pendente vem só do diário. Use sempre o comando inteiro, sem variável: em zsh, `$VAR` com argumentos dá exit 127. Sem o plugin, o script é `tools/gabarito-gates/scripts/loop.mjs`.

## Ciclo
Com o painel visível (mod), **não cole** a saída de `painel.mjs texto` na conversa: o painel já a mostra; responda em 1 ou 2 linhas. Sem mod ou com o painel oculto (`/gabarito painel ocultar`):
Status ao dono: comece por `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/painel.mjs" texto --preset executivo --largura 80`.

1. `proxima` devolve `acao.tipo`. Siga-o, nada além dele:
   - `aprender` (`pendencias[{tipo,sessao,seq}]`): antes de qualquer despacho, feche cada uma. M (hipótese): `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" aprendizado <E|A> M --regra <t> --entra-em instantaneo,brief:implementador --gatilho <sessao>:<seq>`; D (medido): `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" aprendizado <E|A> D --regra <t> --entra-em instantaneo,brief:implementador --gatilho <sessao>:<seq> --eventos <sessao>:<seq>` (ou `--fonte <arquivo> --numero <n>` no lugar de `--eventos`; D sem evidência o CLI recusa); sem regra, `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" aprendizado nada --gatilho <sessao>:<seq> --motivo <t>`. E = erro, A = acerto.
   - `despachar` (`itens[{task,papel,spec?,achados?,modelo,decisoes,emendas}]`): por item, `abrir <task>` **sempre**, antes de `implementador` e `correcao` (idempotente: worktree já aberta volta com `ja_aberta:true`; após um `/clear` só o CLI sabe), `iniciar <task> <papel> --modelo <modelo do item>` (spike entra como `implementador`: `iniciar T0 spike` recusa) e o agente (`implementador` e `correcao`: `gabarito-implementador`; `revisor`: `gabarito-revisor`, sempre **novo**), só com **ponteiros**: plano, `spec` do item, arquivos, porta/schema/namespace da worktree e o `env.TMPDIR` que `abrir` devolveu (fora da worktree; o agente o exporta em todo Bash de teste, senão o `TMPDIR` próprio não vale; ao revisor, o mesmo: `abrir` repetido devolve o mesmo caminho); ao revisor, a rodada; à `correcao`, o `achados`. O `Agent` recebe o `modelo` do item; `decisoes` e `emendas` (diff aprovado da spec) vão ao agente como ponteiro. A `description` do `Agent` é a `descricao` do item, sem mudar. Ela é "<task> <resto>": o 1º token é o id da task. Despache **só** os itens de `proxima`, nada de cabeça. `aprendizados[]` do item vão no brief, como texto, colados por você (limite declarado: nada confere que foram colados). `Agent` logo depois de `iniciar`, mesmo com hand-back no meio (trate-o depois); `--vivos` conta só agente lançado e não devolvido.
   - O implementador volta com o commit: `concluir <task>` no hand-back, antes do gate. Commit novo depois (gate, Sombra ou pedido do dono), task `concluida` sem revisor vivo ou `aprovada`: `concluir <task> --motivo <gate|sombra|dono>` (reentrega: anula o APROVADO; o próximo revisor revê o `diff` inteiro do item; mesmo sha recusa `sha_igual`). Nunca um REPROVADO fictício. O revisor grava os achados em `<worktree>/.tmp-gabarito/review-r<rodada>.md` (ignorado pelo git; `fechar` remove) e o veredito vira `veredito <task> APROVADO|REPROVADO <rodada> <blocker> <major>`. `REPROVADO` sem esse arquivo não vazio: `ok:false achados_ausentes`, nada gravado; mande gravar e repita. Rodada errada: `rodada esperada: N`.
   - `integrar` (`tasks[]`): `integrar <task>` (gate, rebase, ff-only do sha aprovado; ele mesmo fecha a worktree). Verde com `relato` não vazio:
     repasse as linhas `desvio:`/`aviso:` ao dono e ao revisor da entrega; `[]` não prova zero desvios sem ler o `aviso:`.
   - `esperar`: agentes vivos ou slots ocupados (ou `pouso_pendente`); não despache.
   - `pousar` (com `--sessao`, a partir de `x`, 50 %): nesta ordem, `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" pousar --sessao <id>`; arme o wakeup do `/loop` com prompt autossuficiente, 1ª linha "retome a entrega <ID>" e o `instantaneo` do JSON (é o prompt de retomada; não existe arquivo de retomada). Com o mod, ele limpa a conversa e avisa o dono por push (o push é o aviso do mod, nunca `git push`); sem mod, peça ao dono, em 1 linha, que digite `/clear`. Pouso pendente (`/clear` ainda não dado): **não despache nada novo**; `esperar` espera, `pousar` de novo repete o pedido. Sem onboarding nunca há pouso pendente.
   - `parar{motivo}`: pare e **escale ao dono** com o motivo e o diário. Não reabra o que a regra manda escalar. `teto_rodadas`: diga o comando exato, só dele: `/gabarito-mestre:liberar <task>` (recomeça em `pendente`); você não o invoca. Com `sombra.libera_teto: true` em `origin/HEAD`, a **1ª** liberação da task pode ser da Sombra: `sombra.mjs" perguntar --task <task> --libera-teto`, despache a Sombra com o `prompt`, registre com `libera: true` só se ela liberar, e então `loop.mjs" liberar <task> --origem sombra --hash <hash>`. Recusa (`libera_teto_desligado`, `teto_sombra_esgotado`, `fora_do_teto`, `hash_invalido`, `sombra_nao_liberou`) nada grava: escale ao dono. A 2ª é sempre dele.
   - `esperar{emenda}`: há proposta de emenda aberta; avise o dono (`/gabarito-mestre:emenda aprovar|rejeitar <seq>`) e pare o turno.
   - `concluir`: tudo integrado. Rode a suíte inteira e o CI antes de dizer "pronto". Depois: `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" registro`, que gera e commita o registro (não commite à mão); então **Entrega** abaixo.
2. CI da entrega: `ci verde|vermelho`. CI de homolog após a última integração: `ci verde|vermelho --alvo homolog` (sem ele `continua` e `janela` ficam em `esperar{homolog}`). Falha que você não consegue resolver: `parar nao_conseguiu`.
3. Volte a `proxima` depois de cada evento. `reabrir <task>` só recomeça a task (origem `retomada`); o teto de rodadas só o dono libera (ou a Sombra, 1 vez por task, com o flag em origin). Rode a entrega sob `/loop` dinâmico (sem intervalo): o wakeup deve retomar o turno depois do `/clear` (ainda em verificação); sem ele ativo, peça ao dono, em 1 linha, que o inicie.

## Dúvida, desvio e emenda

- Dúvida de regra: `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/sombra.mjs" perguntar (--req <REQ> | --task <id>) --pergunta <texto>`. Leia o `aviso`, se vier.
  Despache `gabarito-sombra` **só com o `prompt` devolvido** (a guarda nega o resto); a resposta vai por `sombra.mjs" registrar <hash> <resposta.json>`.
  `pendente`: a consulta está aberta; siga outra task, não repergunte.
- Desvio ou descoberta no meio da task: `loop.mjs" desvio <task> --req … --evidencia … --arquivos … --causa …` e `loop.mjs" descoberta --evidencia … --causa …`; `--causa` só aceita `regra_negocio` ou `tecnica`.
- Mudança de spec: `loop.mjs" emenda propor … --diff <arquivo> …` (`--diff` é o CAMINHO de um arquivo com o diff, não o texto) devolve `proposta_seq`; quem julga é a Sombra ou o dono, nunca você: `emenda julgar <seq> aprovar|rejeitar` com origem Sombra só vale com `sombra.julga_emendas: true` em `origin/HEAD`.

## Anotar na hora

Sem plano e sem pedir licença, em 1 linha e com as **suas** palavras (nunca a fala do dono copiada): `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" anotar --tipo <tipo> --texto <t> --sessao <id>`. Tipos: `ideia` (ideia nova), `desvio`, `assunto` (mudança de assunto), `duvida` (só o dono resolve: 2 a 4 `--opcao <rótulo>`; marque a sua recomendação com "(recomendado)" no rótulo). `pendencia` o CLI recusa: o painel do dono só mostra o que trava e só ele decide, então lembrete ou obrigação sua vai ao plano (plano.json, brief da task) ou à retomada; pendência antiga sua você fecha com `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" anotar --fechar <sessao>:<seq>` (item do dono o CLI recusa). Anote ao acontecer, antes de seguir o ciclo.

## Entrega

`node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/entrega.mjs" decidir` depois de `concluir`; a decisão é do CLI:
- `subir`: `entrega.mjs" executar`. Falhas esperadas: `checkout_sujo`, `entrega_em_curso`, `ancora_nao_gravada`: pare e diga a causa. Negado pelo modo de permissão (o `auto` classifica como deploy de produção): não contorne nem tente outro caminho; diga ao dono que o deploy é dele, com o comando exato `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/entrega.mjs" executar`, e pare o turno. Antes de parar, `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/entrega.mjs" devolver --motivo <t>` (grava `entrega.devolvida`; o painel mostra o comando ao dono).
- `release_pr`: `git push -u origin HEAD` e `gh pr create --base <base> --head <branch> --title "<entrega>: …" --body-file <registro.md>`. Push de branch e PR não são deploy. Não rode `executar` nem `devolver`: só valem para `subir` e aqui dão `nao_subiu`. A base é a do `decidir`, mesmo que a doc do projeto diga outra; repasse o `aviso`, se vier. Negado pelo modo de permissão: dê ao dono os 2 comandos exatos e pare o turno. Se o `AGENTS.md` do projeto pedir ok para push/PR sem essa exceção (R1 da 1.1.0), não passe por cima: dê ao dono as 2 linhas completas, já preenchidas (`git push -u origin HEAD` e `gh pr create --base <base> --head <branch> --title "…" --body-file <registro.md>`), diga que `gabarito-instalar --atualizar` traz a R1 nova, e pare o turno. **Nunca merge.**
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
então `proxima --vivos <n> --sessao <id>`. Nunca reabra com agente vivo: dois implementadores na mesma worktree. Diário ilegível ou `ok:false`: pare e diga a causa.

## Sem mod

O doctor diz `loop: sem mod (sem pouso automático)`. O ciclo acima vale igual, e o hook `Stop` impede parar em silêncio; só o
pouso de contexto, a medição do orquestrador e o `/gabarito` do mod faltam. O `/clear` do pouso é feito pelo mod; sem mod é do dono: na fronteira (contexto perto de 50 %, entre tasks), rode `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" pousar --sessao <id>` (`task_em_voo` ⇒ ainda não); se passar, peça ao dono, em 1 linha, que digite `/clear`, e repasse o `aviso` do JSON, se vier. Nunca diga que você roda `/clear`.

## Não faça

- Decidir a próxima ação de cabeça, pular o revisor ou integrar sem `integrar` (o gate é o do CLI).
- Apagar worktree, branch, banco ou `.harness/` por outro meio que `fechar`.
- Tratar saída ausente, JSON inválido ou `ok:false` como sucesso: leia `erro` e `mensagem`.

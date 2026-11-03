# E2 — Loop + pouso

Iniciativa: gabarito-mestre 2.0 · Epic: E2 · PBI: GM-10 (Enabler) · Data: 2026-11-03 · Visão: `2026-10-31-visao-2.0-design.md` · r3 (r2 + REQ-POU-2 e REQ-SLOT-1 decididos pela Sombra sob delegação nominal do dono, `sombra-lote3.md`; r2 = r1 + emendas da Sombra aprovadas pelo dono em lote, 2026-11-03: `sombra-t7.md`, `sombra-t8.md`, `sombra-t9.md`, `sombra-t9b.md`, `sombra-t6.md`)
Legenda: **(a)** medido/lido · **(b)** a medir · **(c)** decisão do dono ou do redator. Medições: `.superpowers/sdd/2026-11-03-e2-loop/spike-S{7..11}-relatorio.md`, resumidas no ledger GM-10.

**STATUS.** Hoje: guarda, diário, `capacidade.mjs` com limiares binários. Sem loop, sem pouso, sem kill switch. **Esta spec: nada implementado.**

**Objetivo.** Plano aprovado → tasks em paralelo, cada uma em worktree, com gate e review, integradas sem intervenção; o orquestrador pousa sozinho na fronteira da task e o dono pausa com uma palavra.

## Fatos (a)

| # | Fato |
|---|---|
| F1 | S7: `/clear` + `prompt.submit` por mod retoma 10/10 em TUI `default` e `auto`, 0 digitação; 0/1 em `-p` (`$.command.run` lança). `percent` indefinido até a 1ª resposta e após `/clear`, definido em `turn.complete` |
| F2 | S7: subagent vivo no `/clear` não morre (0/3) nem perde a notificação (0/3), mas volta a um modelo sem contexto (3/3) |
| F3 | S7: 6.000 caracteres = 2.772 tokens, acima do teto de 1,5k da visão §6.7 |
| F4 | S7: mod lê tudo (`usage()`, `turn.complete.usage` com `agentId`); hook clássico só por transcript (F7). `/gabarito` + args registra por mod; nome com espaço, recusado |
| F5 | S8: `Stop` com `block` continua, teto 9 seguidos, ferramenta zera (22 observados). Com agente vivo, `background_tasks[]` traz a lista; bloquear gira em falso 9× em 16–24 s; acorda sozinho 4/4 com ou sem bloqueio |
| F6 | S8: PreToolUse `Agent` nega o despacho, também de dentro de subagent; `deny` por arquivo vale 3/3; ferramenta em curso termina (~21 s, N=1). Hook: p95 30,1 ms |
| F7 | S8: `totalTokens` do `SubagentStop` é só o último turno; somar `message.usage` do `agent_transcript_path` funciona com releitura ≥ 51 ms e dedupe por `message.id` (última mensagem ausente 7/7 no instante do hook) |
| F8 | S9: clones simultâneos 0 falhas em 8; falha só com sessão presa no template (8/8); clone 29,7 ms em 41 MB, 493 ms em 499 MB, tmpfs. `DROP … WITH (FORCE)` funciona. Conexão não prova worker vivo (6 s). `LIKE 'gm_%'` pegou `gmaster` |
| F9 | S10: `npm test` + hooks por slot em N=1/2/3/4/8 = 14,9/19,5/22,9/35,2/62,8 s; falha por tempo em N=4 (10/12) e N=8 (14/24), 0/18 em N≤3; 5,0 núcleos e até 1,65 GB; fórmula de S4 refutada (26→1 pela CPU, 3 medidos sem falha). Worktree 2,3 MB, 0,05 s. 84 MB por execução no `TMPDIR` |
| F10 | S11: X=60 refutado (86,6 % > piso medido 84,2 % = 842.026 tokens; janela 1M suposta, não exposta); 40 e 50 cabem; 40 ≈ 18 % menos `cache_read` por turno e ≈ 23 % menos turnos por ciclo; custo do pouso não medido. Compactação a 27,0/37,8/84,3 %, todas após ~53,8 min ociosa, 0 por pressão em 1.882 turnos. Janelas > 120 min excluídas do limite (se contadas, nenhum X cabe) |

| F11 | S12: `SessionStart:compact` dispara 7/7 e `additionalContext` chega ao request 9/9; hand-back logo após a compactação encontra o contexto, 5/5. `PreCompact` também dispara sem compactação (2/2), logo não serve de detector; bloqueia em manual e na rota `reactive` forçada, auto natural não medido. Opus e Fable: `window` 1.000.000, limiar 967.000 |

## Decisões (c)

- **D1 Núcleo puro decide, adaptador executa.** `gates/src/loop.ts` sem I/O; CLI, hook e mod só traduzem. Sem mod, loop e kill switch seguem; só pouso automático e teto de tokens faltam, e o doctor diz. Rejeitado: lógica no mod (API instável, M1).
- **D2 X = 50.** F10 refuta 60; 40 e 50 cabem; 40 é mais barato por turno e pousa mais vezes, e o custo do pouso não foi medido: sem dado para sair do default da visão. Rejeitado: 40, sem qualidade medida em função do contexto.
- **D3 Slots por escada medida no repo, não por custo estimado.** F9: o limite real é falha por tempo sob contenção, não soma de núcleos. Rejeitado: só recalibrar `cpu_slot`, deu 1 contra 3 medidos. Emenda à visão §6.8 aprovada pelo dono em 2026-11-03.
- **D4 Sem fila nem lock em clone.** F8. Rejeitado: advisory lock, sem falha que o justifique.

## Requisitos

**REQ-LOOP-1 Plano como dado.** `.harness/entregas/<id>/plano.json`: `tasks[{id, deps[], arquivos[], teste_afetado?, mutacoes?}]`. *Given* ciclo, dep inexistente ou id repetido *Then* recusa com o motivo. *Given* duas tasks sem dep que tocam o mesmo arquivo *Then* recusa: escopo de arquivos é fechado (A7).

**REQ-LOOP-2 Próxima ação pura.** `proximaAcao(plano, eventos, sinais) → despachar[] | integrar[] | esperar | pousar | parar{motivo} | concluir`, em `loop.ts`; `sinais = {slots, percent, pausado, vivos, tokens}`. Task no teto de 2 rodadas com MAJOR ⇒ `parar`, dependentes seguem até o commit sem integrar (A9); teto é estado: só `task.reaberta {origem:"dono"}`, gravado por comando humano, libera; `task.reaberta {origem:"retomada"}` recomeça a task sem liberar teto; o orquestrador não apresenta como fechado o que a regra manda escalar (A11). Parar: não conseguiu, CI vermelho 2×, teto de tokens (visão §6.5). Skill `gabarito-loop` traz o ciclo, ponteiros, sem cópia de spec. Ordem por `seq` dentro da sessão e `(ts, sessao)` entre sessões; evento fora de ordem ⇒ `parar{diario_invalido}`, sem adivinhar. Brief de spike traz lista fechada e config isolada (A5, A6).

**REQ-LOOP-3 Worktree por task.** `loop.mjs abrir|integrar|fechar <task>`: branch e worktree a partir da integração; `TMPDIR` próprio (F9); integrar = rebase, gate, `merge --ff-only` do sha aprovado pelo gate, tudo ou nada: falha devolve a branch ao sha revisado; fechar remove sem `--force`, ignorado é removido e relatado, modificado ou não rastreado recusa; nunca apaga por outro meio.

**REQ-LOOP-4 Gate no produto.** `gate-task.mjs` traz para o plugin a ferramenta da E1: árvore limpa, commits contra a base (0 commits reprova, A3), escopo, segredo, suítes, mutações com teste rodado sem mutação antes (E19), lista de RED por task e por nome (A2). Falha "pré-existente" só com medição em árvore limpa (A4).

**REQ-LOOP-5 Não para em silêncio.** Hook `Stop`: loop ativo, sem `parar`, `background_tasks` vazio e há ação ⇒ `block` com a ação. Agente vivo ⇒ não bloqueia (F5). Contador próprio por progresso de evento: 3 Stops sem evento de progresso no diário da entrega ⇒ grava `parar{sem_progresso}` e deixa parar com aviso visível. Progresso = evento que `proximaAcao` consome: `task.iniciada`, `task.concluida`, `review.veredito`, `task.integrada`, `task.reaberta`, `ci.resultado`; guarda, sessão, custo, pouso e pausa não contam.

**REQ-SLOT-1 Capacidade medida.** `capacidade.mjs --calibrar` roda a suíte do repo em N=1,2,3,… e para na 1ª falha ou na 1ª queda de vazão; grava `slots_max`, RSS pico e `TMPDIR` por slot, a CPU total da medição e a carga do degrau aprovado (`load_medido`, mediana do `load1` durante o degrau) em `.harness/capacidade.json` (gitignored, chave `hostname`). Em runtime: `slots = min(slots_max, quociente de memória, quociente de disco, reduzido pela carga acima da medida)`, nunca < 1; carga acima da medida é `load1 > load_medido`, e a redução é `floor(slots_max × load_medido / load1)`. O termo só reduz. Sem calibração, ou com `load_medido` ausente ou inválido: 1 slot e aviso. Fórmula e constantes sem número do MacBook.

**REQ-DB-1 Banco por worktree.** `db.psql` (argv em config, `docker exec` é um valor) + `db.template`. Template é banco próprio, nunca `postgres`; migrado e com seed 1× por sessão, `ALLOW_CONNECTIONS false` após migrar; clone `gm_<entrega>_<task>` com ids em minúsculas `[a-z0-9]`, sem `_`, ≤ 63 bytes; papel só com `CREATEDB` ⇒ template `IS_TEMPLATE true`, desmarcado antes do drop; `DROP … WITH (FORCE)` ao fechar. Órfão = nome exato com escape, sem worktree viva; conexão não é prova (F8). Só host local; outro host ⇒ recusa. Sem `db` declarado ⇒ n/a, doctor mostra. Limite declarado: Supabase local não medido.

**REQ-POU-1 Pouso.** Mod no `turn.complete` do orquestrador: `percent ≥ X` ⇒ sem despacho novo (`Agent` negado); vivos = 0 (`$.agent.list` sem `pending|running|waiting`) e fronteira = `review.veredito` da task corrente gravado após afetados verdes (visão §6.7) ⇒ grava evento, gera instantâneo ≤ 3.200 caracteres (F3 ≈ 1,5k tokens; `plugin test` confere `context.tokens` ≤ 1,5k) e `clock.after(0)` → `/clear` → `prompt.submit`. `percent` indefinido ⇒ não pousa. O mod não decide sozinho: passa sinais reais a `proximaAcao` e executa a ação; pouso consome a fronteira, e novo pouso exige `review.veredito` posterior ao último `sessao.pouso` (consumida ⇒ `percent:null`, despacho liberado). `turn.complete` abortado ou com erro não decide pouso. Vivos = 0 com task em `implementando|corrigindo|em_revisao` não pousa; `pousar` só se resta task fora de `{integrada, no_teto}`. Hand-back que chega após `/clear` entra com o instantâneo (F2). Compactação fora do pouso ⇒ hook clássico `SessionStart:compact` reinjeta o instantâneo por `additionalContext` (F10, F11), sem depender de mod; não bloqueia a compactação. `-p` não pousa (F1): `parar{sem_pouso}` em X.

**REQ-POU-2 Kill switch.** `.harness/PAUSAR` + `/gabarito pausar|retomar` (mod) ou `/<plugin>:gabarito` (sem mod). Com o arquivo: guarda nega `Agent` a todos e toda ferramenta a subagent, com mensagem "pausado: `/gabarito retomar`". Ferramenta em curso termina: limite declarado (F6). Retomar recomeça a task; nunca despausa sozinho; apagar o arquivo pelo modelo cai no anel de integridade. A pausa vale nas raízes `{sessão, cwd}` e no checkout principal de cada uma (worktree de task obedece ao principal). Nessas mesmas raízes entram no anel, em caminho absoluto ou relativo ao `cd` rastreado no comando, sem distinção de caixa (caso direto, Q26 item 1): (i) `.harness/PAUSAR` escrito como argumento de qualquer comando que não seja leitor conhecido, ou como alvo de redirecionamento; (ii) remoção, movimentação e escrita de `.harness` e da própria raiz pelos comandos que o anel conhece (Q2, `unlink`, `shred`, `mv`, `git rm|mv`). Ler o arquivo ou citar o caminho em texto (mensagem, `echo`, comentário) não é alvo. As demais áreas de REQ-GRD-5 seguem o toplevel do cwd (Q14). Token com espaço segue Q28. Limite declarado: o que só vira caminho depois de expandido ou percorrido (formas de Q26 item 4, `~`, `cd` não rastreado, pathspec com magia, `--work-tree`, `find -delete`, `xargs`, `git clean`, `git stash -u`, `pushd`); `.harness` ou a raiz em comando fora de (ii); diretório acima da raiz; escrita por comando leitor (`sort -o`), que não apaga o arquivo; caminho dentro de texto de argumento: comando inteiro entre aspas (`eval "…"`, `sh -c "…"` atrás de prefixo que o anel não abre), como interpretador. Forma nova fora disso vai ao backlog com gatilho (Q26 item 2).

**REQ-OBS-1 ETA e tokens.** Projeção: ETA = mediana de duração por task aprovada, com < 3 "sem dados". Mod grava `custo.medicao {agente, input_tokens, output_tokens, cache_read}` de `turn.complete.usage` (F4); com mod, o orquestrador entra como `agente:'orquestrador'`, por turno; sem mod, hook `SubagentStop` soma por transcript (F7) e só o orquestrador fica "sem medição". Teto em config ⇒ `parar{teto_tokens}`.

## Spikes e medições dentro das tasks (b)

A6 modelo do implementador: a 1ª task pura roda em Sonnet `high` e Opus `low` no mesmo commit; métrica = tokens por task aprovada. M1 ataques: contagem na mesma task. M3: rodadas que o gate evitou, contadas na mesma task. M5: tokens de contexto por etapa, por `session.measure`. Causa da compactação ociosa: não medida, exige ~54 min e não é determinística. Supabase real: fora, sem autorização. `five_hour`: 0/58, não prova ausência.

## Fora de escopo (dono: Gabriel)

Sombra e emendas (E3) · política de entrega (E3) · painel e árvore de agentes (E4) · onboarding (E5) · runner remoto (backlog) · `services: postgres` na CI do usuário (E5).

## Testes e aceites

Núcleo puro por `node --test`, com mutação nomeada por REQ. Mod por `plugin test`. **Aceite 1:** plano descartável de 3 tasks, 2 paralelas e 1 dependente, em TUI `--permission-mode auto`, haiku, termina em `concluir` sem digitação, com `GABARITO_POUSO_X=1` e ao menos 1 par `sessao.pouso`/`sessao.retomada`, cada `sessao.pouso` precedido por `review.veredito` novo, nenhum na mesma fronteira; `context.tokens` do prompt de retomada ≤ 1,5k. **Aceite 2:** `PAUSAR` no meio ⇒ nenhum despacho, retomar recomeça a task. **Aceite 3:** `.harness/capacidade.json` deste repo, sem falha por tempo em `slots_max` em 3 rodadas. **Aceite 4:** diário do aceite 1 traz ETA e tokens por agente. **Aceite 5:** `npm test` deixa 0 bytes de `TMPDIR` após `fechar`. CI 100 % verde; review final Fable.

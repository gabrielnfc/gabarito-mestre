# GM-15 T0: relatório dos spikes S1, S2, S3, S7 e locais dos MINORs

Medido em 2026-11-15, na worktree `wt/GM-15-T0` (base 8f1dc8f). `gh` só leitura. Diário da GM-14 lido do repo principal e copiado para `mkdtemp` antes de qualquer gravação de teste. Sondas e saídas em `.claude-tmp/gm15-t0/` (gitignored). Nenhum código de produto foi tocado.

## S1: o critério de ENT-1 (a) acha o PR de entrega da GM-13 e da GM-14?

Critério testado: `gh pr list --base main --state merged --search "<ID> in:title"` ou `--head <ID>`.

| Consulta | GM-13 (#16) | GM-14 (#22) |
|---|---|---|
| `--search "<ID> in:title"` | `[]` (0 PR) | #22 (1 PR) |
| `--state merged --head <ID>` | `[]` | `[]` |
| `--search "<ID>"` (sem `in:title`) | #21, #16, #6 | #22, #21 |

- PRs de entrega achados pelo critério (a): **1 de 2** (só o #22, porque o título leva "GM-14"). O #16 se chama "release: gabarito-mestre 2.0.0", head `next`, sem o ID no título. `--head` com o ID: 0 de 2 (as duas entregas subiram por `next` ou por `chore/GM-14-virada-2-1`, nunca por branch com o ID puro).
- Sem `in:title` o #16 aparece (o corpo cita `GM-13`), mas junto com ruído: GM-13 devolve 3 PR (1 certo), GM-14 devolve 2 (1 certo). Precisão 2 de 5.
- Tempo do `gh`: 564 ms (GM-13) e 634 ms (GM-14) com `in:title`; 688 ms e 630 ms sem.
- Amostra: 22 PRs no repositório (`gh pr list --state all`), 11 mergeados na `main` (#1-#7, #16, #18, #21, #22). **8 de 11 levam ID de entrega no título** (#1-#7 = GM-1..GM-7, #22 = GM-14); #16, #18 e #21 não levam.

### S1b: precisão (review r1, MAJOR-1)

A busca do GitHub é por token, não por cadeia exata. Medi, para cada ID GM-1..GM-15, `gh pr list --base main --state merged --search "<ID> in:title"` e, sobre o resultado, 3 filtros de cliente. Verdade: o PR que entregou o ID na `main` (GM-1..7 = #1..#7, GM-13 = #16, GM-14 = #22; GM-8..12 e GM-15 não têm PR na `main`: 0 esperado). Script `.claude-tmp/gm15-t0/s1.mjs`.

| Critério | Acertos | Falsos positivos | Perdidos |
|---|---|---|---|
| só a busca `<ID> in:title` | 8 | **7** | 1 (#16) |
| + regex com fronteira `(^\|[^A-Za-z0-9-])<ID>([^0-9A-Za-z-]\|$)` | 8 | **0** | 1 (#16) |
| + `\b<ID>\b` | 8 | 0 | 1 (#16) |
| + prefixo `tipo(<ID>)` ou `<ID>:` | 8 | 0 | 1 (#16) |

- A busca sozinha erra: `GM-1` devolve 7 PRs (#1, #2, #4, #5, #6, #7, #22) com 1 certo (6 falsos); `GM-2` devolve #2 e #22 (1 falso). Sem o filtro de cliente a entrega GM-1 seria dada como encerrada pelo #22.
- Casos sintéticos do regex de fronteira para `GM-1`: `feat(GM-1): x`, `(GM-1)` e `GM-1` casam; `GM-15: x`, `enabler(GM-14): y`, `XGM-1 z` e `GM-1-x` **não** casam (`\b` casa `GM-1-x`; a fronteira com `-` não).
- Os 7 falsos da busca no escopo medido (GM-1..GM-15) saem todos no filtro; o limite do #16 (sem ID no título) segue.

**Critério proposto (medido: 8 acertos, 0 falsos, 1 perdido):** o PR conta como entrega do ID só se o título casa o ID com fronteira exata, `(^|[^A-Za-z0-9-])<ID>([^0-9A-Za-z-]|$)`, aplicado no cliente sobre o que a busca devolve.
**Conclusão para T3/T4:** casar ID exato com fronteira, nunca confiar na busca por token; testes `titulo-com-id-prefixo-nao-casa` (`GM-15:` não conta para `GM-1`), `titulo-sem-id-nao-conta` (caso #16, limite declarado) e `titulo-com-id-exato-conta`.

**VEREDITO S1: REFUTADA** para a busca sozinha (recall 1/2 em GM-13/GM-14, precisão 8/15 = 53 %); o critério com fronteira exata tem precisão 8/8 no escopo medido.
Consequência no plano: o PR da virada leva o ID da entrega no título (como o #22) e o limite fica declarado: PR de virada sem ID no título (caso #16) não é achado pelo critério (a). T3/T4 não dependem de `--head` com o ID.

## S2: de onde veio o `events.sessao-1.jsonl`?

- `git log --all -S'sessao-1'` e `git grep`: `sessao-1` é o `SID` de `plugins/gabarito-mestre/gates/test/painel-medir.test.mjs:25` (e uma linha de `skills-shell.test.mjs:335`). O arquivo nunca foi versionado.
- O conteúdo bate com a fixture, fato por fato (6 de 6): `pr 7 mergeado` e `pr 8 aberto` = a saída do `gh` falso em modo `ok` (`fixtures/gh/gh:20`); `release v2.0.0` = o `gh` falso; branch `enabler/GM-14-clareza` = o padrão de `repo()` (`painel-medir.test.mjs:37`); ts `2026-11-11T20:00:00.000Z` = o `agora` falso dos testes (`:60`); autor `painel`, sessão `sessao-1`. Os fatos `plano 36` e depois `plano 58` batem com o `plano.json` real da GM-14 em dois momentos (hoje 58 tasks): houve **2 execuções** do `medir` com relógio e `gh` de fixture contra a raiz **real**, em sessão `sessao-1`.
- Nas 3 versões do teste lidas (bd88155, b8aebd4, HEAD) o CLI roda com `cwd: d` (repo `mkdtemp`); `git show` dessas 3 não traz `process.cwd()` nem a raiz real (as demais, até 137ba8b, não foram lidas).
- Medição: rodei na worktree os 7 arquivos de teste que chamam `medir`/o CLI do painel (`painel-medir`, `painel-costura`, `painel-cli`, `aprovar-spec`, `conversa-pontos`, `fumaca-gm14`, `loop-cli`) e comparei `git status --short --ignored` depois de cada um: **0 de 7 gravaram em `.harness/` da raiz** (só o `.tmp-gabarito/` que já existia). Ressalva: 6 arquivos terminaram (todos rc 0); o `loop-cli` não terminou (cortei após ~4 min de execução, sem nenhuma gravação até então; o único `medir` dele roda em `cwd` de `mkdtemp`, `loop-cli.test.mjs:5159`).
- **Número: testes que gravam na raiz real hoje = 0 de 6 concluídos (+ `loop-cli`, cortado sem gravação).** O defeito que gerou o arquivo foi fechado antes (ou foi execução manual com `gh` de fixture durante a T11). Não foi possível dizer qual das duas; o que ficou é a ausência de guarda.
- Lista exata para a T24: a guarda é o produto (falha se a raiz é a do checkout), e o conserto é no helper comum de raiz de teste. Arquivos que chamam `medir`/CLI e precisam usar o helper: os 7 acima. Nenhum teste existente precisa de correção para parar de gravar; a T24 só acrescenta a guarda e cobre o caminho da raiz real com teste.

**VEREDITO S2: CONFIRMADA** (o arquivo é saída da fixture do `painel-medir.test.mjs` gravada na raiz real; 0 testes atuais gravam lá).

## S3: por que pendência marcada "feito" ou "visto" segue listada?

Reprodução em `mkdtemp`, com a cópia do diário real da GM-14 (20 arquivos `events.*.jsonl`, 12 pendências e 1 ideia abertas):

- `append` de `dono.resposta {pergunta: 'loop:1061', opcao: 1, rotulo: 'feito'}` por sessão `01db6bdc-aaaa`: abertas **12 → 12** (não fechou).
- Mesma resposta por sessão `zzzz-sessao`: abertas **12 → 11** (fechou).
- Ideia `loop:1209`, resposta `visto`: sessão `01db6bdc-aaaa` ⇒ `{id:'loop:1209', n:1}` antes e depois; sessão `zzzz-sessao` ⇒ `null` depois.

**Causa:** `diario.ts:233` (`ler`) concatena os arquivos por `nomes.sort()` (nome do arquivo), não por ordem causal. `depende.ts:85` (`pendenciaAberta`: `j > i`) e `depende.ts` `ideiasAbertas` (`p < j`) comparam o **índice** no array. Uma resposta gravada em `events.<sessao>.jsonl` cujo nome ordena antes de `events.loop.jsonl` vem antes da nota no array e nunca é "posterior". Toda sessão de conversa tem id UUID hexadecimal (`0-9a-f` < `l`), então a resposta do dono pelo botão, que grava na sessão dele, não fecha nota alguma do `loop` (que são as 12 pendências). Só sessão com nome igual a `loop` (ou `loop*`) ou depois dele (`m`-`z`) fecha.

**Número:** pendências listadas antes/depois da resposta: 12/12 (sessão UUID) e 12/11 (nome > `loop`). Ideia: 1/1 e 1/0.
Consequência (T8): "posterior" passa a ser por `ts` (com desempate por ordem do arquivo, para `ts` iguais), não por índice; teste com sessão antes e depois de `loop` na ordem de nome. A mesma regra vale em `perguntas.ts` (`pendenciaAberta` é importada) e no `responder.mjs` (`avaliar` usa `perguntasAbertas` sobre `lerEstrito`, que também ordena por nome).

**VEREDITO S3: CONFIRMADA.**

## S7: congelamento atual (`loop.ts:218-227`) × regra EME-3 (A) no plano e nas emendas da GM-14

Método: 71 `emenda.proposta` do diário real (sessão `emendas`), plano final `plano.json` (58 tasks). Para cada proposta, no `ts` dela: tasks integradas = `task.integrada` menos `task.reaberta` até aquele instante. Regra atual: tasks com o `req` exato + dependentes transitivas de qualquer estado. Regra EME-3 (A): tasks **não integradas** com o `req` ou com `arquivos` em comum com a proposta (`arquivos` do `--arquivos`), mais dependentes não integradas delas. Script `.claude-tmp/gm15-t0/s7.mjs` (reescrito e rodado de novo: saída idêntica linha a linha a `s7.out`, 71 linhas); saída completa por proposta em `.claude-tmp/gm15-t0/s7.out`.

| Regra | Soma de tasks congeladas (71 propostas) | Média | Mediana | Máximo |
|---|---|---|---|---|
| Atual | 3684 | 51,89 | 56 | 58 |
| EME-3 (A) | 1332 | 18,76 | 19 | 42 |

- A regra atual congela task **integrada** em 65 de 71 propostas (2102 tasks integradas congeladas no total). A EME-3 (A) nunca congela integrada.
- EME-3 (A) congela menos em 65 propostas, igual em 6 (as de `REQ-APR-5` e `REQ-POU-1`, poucas tasks e quase todas integradas ou sem arquivo em comum), **mais em 0**.
- Por proposta (exemplos): seq 1 `REQ-DIA-1`: 56 → 36; seq 14 `REQ-DIA-2`: 56 → 27; seq 31 `REQ-GLB-1`: 58 → 20; seq 44: 58 → 12; seq 66: 58 → 4; seq 71 `REQ-DIA-1`: 56 → 1. Sem `--task` e sem `--arquivos` (13 propostas): só as diretas pelo `req`.
- Limite: o plano usado é o final (58 tasks); nas primeiras propostas o plano tinha menos tasks (o fato `plano 36` aparece em 11/11), então os números das propostas iniciais superestimam as duas regras na mesma proporção. Não dá para reconstruir `plano.json` por instante sem o histórico dele.

**VEREDITO S7: CONFIRMADA.** A regra atual congela em média 51,9 tasks por proposta (89 % do plano); a EME-3 (A) congela 18,8 (32 %), redução de 64 % na soma. A T10 está justificada.

## Locais dos MINORs (HIG-1)

| Item | Reproduz? | Local e prova | Destino |
|---|---|---|---|
| T48 r2: `guarda.ts:234` ts ilegível | **Sim** (efeito) | `guarda.ts:234` (`tsMs`) e `:241-242` (`Number.isNaN(t)` pula o PR). Diário sintético GM-99, mesmo PR mergeado, resposta do dono posterior: ts do PR legível ⇒ `entregaPublicada` = `true`; ts do PR `lixo` ⇒ `false` (entrega volta a "aberta"). `lerEstrito` não valida `ts`. A causa exata (a `trilha.ts` também lê `ts`?) não foi isolada com mutação | T3 (corte por `mergeado_em` do fato, não por `ts`); teste `ts-ilegivel-do-pr-nao-reabre-a-entrega` |
| T48 r2: `guarda.ts:238` corte pelo maior 1º merge | **Não reproduzido** | Hoje o corte é `Math.max` dos 1ºs merges por número (`guarda.ts:246`; a linha 238 do pendência é a antiga). Reproduzir exige resposta que **ligue** a sessão pela âncora (b), que o diário sintético não montou (cenário D ficou `true`, sem ligação). Sem reprodução ⇒ registro, sem código | T3 troca o corte por `mergeado_em` e `base`; condição 2 da Sombra |
| T50 r1: reserva `[-]` (`mod/painel.mjs:413-415`, uso `:1413`) | **Parcial** | "Teste repete constantes": **sim**, `mod/test/gabarito.test.ts:3856-3857` redefine `MOLDURA_BOTAO = 4` e `RESERVA_BORDA = 3` (a asserção `:3870` recalcula com as mesmas literais; mutar a constante do produto não derruba a soma de forma independente, só o `toBeLessThanOrEqual`). "Sobram 3 col" e "2+ botões de 60 car quebram linha": **não medível offline**, exige sessão real (o `mock` do kit não mede largura; aprendizado vigente) | Registro; sessão real fica para a task do mod (T17) se ela mexer na linha única; sem código na T0 |
| `docs/virada-2.1.md:3,12` (caminho real `plugins/gabarito-mestre/docs/virada-2.1.md`) | **Linha 3 sim; linha 12 depende da T17** | `:3` manda ao `CHANGELOG.md` seção `[2.1.0]`: `CHANGELOG.md` só tem `[2.1.0-alpha.1]` (0 ocorrências de `## [2.1.0]`, `grep -n '^## \['`). `:12` diz "pede que você limpe a conversa"; `skills/gabarito-loop/SKILL.md:29` diz que com o mod ele limpa e avisa por push, sem mod pede `/clear`: o texto cobre só o caso sem mod | T25: a linha 3 passa a valer na virada (seção `[2.1.0]` criada) e entra na lista da T25; a linha 12 espera o comportamento final da T17 |
| Regex de sessão em `gates/scripts/painel.mjs` | **Sim** (divergência) | `painel.mjs:419-422` (`sessaoDoMod`) aceita qualquer string não vazia; o comentário diz "a mesma leitura do `medir`", mas `painel-medir.mjs:37,228` exige `SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/`. 5 entradas (`abc-123`, `a b`, `../x`, 200×`x`, `a:b`): painel aceita **5 de 5**, medir aceita **1 de 5**. Uso só em comparação de igualdade (`trilha.ts:79-90`), sem caminho de arquivo: impacto baixo | Teste `regex-sessao-painel`; `painel.mjs` entra na lista da T24 ou T25 (o orquestrador atualiza o `plano.json`) |
| Vigia do `/clear` em turno aberto (`mod/gabarito.mjs:386-407`, hoje `~:370-400`) | **Não reproduzido** | 0 ocorrências de `turn.start`/`turnoAberto`/`emTurno` em `mod/gabarito.mjs`: a vigia (`vigiar`, `armarVigia`) reavalia a cada 30 s sem consultar se há turno aberto; os 5 testes de vigia (`mod/test/gabarito.test.ts:4721,4735,4893,4923,4937`) são todos "sem turno". Se o pouso dispara `/clear` com turno aberto só se prova em sessão real (S4/S8 da T0b) | Registro; sem código; a T0b (S4) decide e a T17/T19 cobre |

## O que a medição NÃO responde

- S1: não mede outros repositórios nem PRs futuros com título diferente; só os 2 PRs de entrega que existem.
- S2: não identifica qual execução gravou o arquivo (os 6 fatos batem com a fixture, mas não há log da execução). Mede só o estado de hoje dos arquivos de teste; o `loop-cli` ficou incompleto.
- S3: mede a causa na leitura (`ler`/`lerEstrito` por nome de arquivo); não mede qual fração das respostas reais do dono vem de sessão com id < `loop` (hoje 0 `dono.resposta` no diário da GM-14).
- S7: plano final aplicado a todo o histórico; não reconstrói o plano de cada instante. Não mede o efeito sobre o tempo de entrega.
- Locais: T50 r1 (largura real) e a vigia em turno aberto exigem sessão real; ficaram sem veredito de defeito.

# GM-19 Velocidade e qualidade dos testes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O loop é o `gabarito-loop` sobre `.harness/entregas/GM-19/plano.json` (rascunho em `.claude-tmp/gm19/plano-rascunho.json`, 3 tasks).

PBI: GM-19 · Epic: não vinculado (D-G39) · Iniciativa: não vinculado (D-G39).

_(Emenda 2026-11-22, r2, conformidade r1: ~~T2 dividir fumaça e conversa-pontos~~ sai (F-5); fechar furos passa de ~~T3~~ a T2; T3 nova corta os repetidos (F-3); a T1 ganha a prova B (F-4); sai a previsão da CI (F-2) e os números vêm do JUnit (F-1).)_

**Goal:** O `integrar` espera menos sem perder proteção: `loop-cli` dividido com prova de igualdade, 3 furos fechados e o repetido cortado com prova por mutação.

**Architecture:** Só testes e scripts de teste. T1 divide e mede. T2 fecha os furos. T3 corta. Nada em `src/`, `dist/`, CI ou config (mutação temporária é restaurada).

**Tech Stack:** `node --test` (Node ≥ 22.18), reporter JUnit do próprio Node, bash, `python3 -I` só na prova local. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-22-gm19-velocidade-testes-design.md` (r2, não aprovada). Decisão do dono: D-G35. Q1 a Q4 (`spec:163-167`) respondidas: D-G36 a D-G39. DS9 a DS11 aprovadas pela Sombra.

## Pré-condições (antes da 1ª linha de código)

- Spec aprovada pelo dono. Q1 ou Q3 diferentes da recomendação ⇒ emenda deste plano antes de abrir. DS9 a DS11 confirmadas pela Sombra.
- Orquestrador na branch `enabler/GM-19-velocidade-testes` antes do `abrir`.
- S6 rodado na base antes do 1º `integrar`. Vermelho fora da task ⇒ `descoberta` e `integrar` com `S6_REPOS_DIR` numa pasta vazia (processo, "Golden S6"). A medição de aceite roda sem esse desvio, como a base.
- Base: `.claude-tmp/gm19/run3.junit.xml` e as linhas de bfa322ad. Se algum teste mudar na base antes da T1, o orquestrador colhe outra (`spec:66-70`) e as faixas viram emenda.

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/` e `.claude-tmp/`. Testes rodam de `gates/`.
- **Ao dividir, nenhum teste sai e nenhuma linha de corpo muda** (`spec:72-95`). Na T3, **só sai o que a mutação provou coberto** (`spec:129-147`).
- **P5:** suíte inteira e cronômetro são do orquestrador, sem agente testando e sem outra suíte. O implementador roda só os testes da task. O revisor não roda a suíte inteira (P16).
- **P18:** antes de `concluir` correção ou reentrega, o orquestrador roda 1 vez os testes dos arquivos tocados.
- **P8:** ninguém usa `env`, `printenv`, `set` nem dump de variável. Ninguém lê `.env`.
- Suítes simultâneas usam TMPDIR distinto. Temporários e JUnit ficam em `.claude-tmp/gm19/`.
- Mutação temporária é restaurada na hora. `git diff --stat` no fim mostra só arquivos da task.
- Tempo nunca vira asserção nem teto em teste. Timeout não aumenta. Nomes de job, `harness.config.json` e ruleset não mudam.
- Commits `tipo(GM-19): …` com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `git add` por caminho, sem `git stash`, sem push.

## Mapa REQ → task

| REQ | Task | Spec |
|---|---|---|
| REQ-SEG-1 | T1 | `spec:72-95` |
| REQ-VEL-1 | T1 | `spec:97-104` |
| REQ-VEL-3 | T1 (prova no PR) | `spec:108-112` |
| REQ-FURO-1 | T2 | `spec:114-117` |
| REQ-FURO-2 | T2 | `spec:119-122` |
| REQ-FURO-3 | T2 | `spec:124-127` |
| REQ-RED-1 | T3 | `spec:129-147` |

## Grafo

| Onda | Task (dependências) | Observação |
|---|---|---|
| A | T1 (sem dependência) | maior ganho; o gate dela já roda a suíte dividida |
| B | T2 (T1) | se a T1 não integrar, a dependência sai por emenda (`spec:100-102`) |
| C | T3 (T2) | `gates/test/package.test.mjs` em comum com a T2: em sequência |

- **Serial (recurso compartilhado):** a máquina. 1 teste pesado por vez: medição, `integrar` e suíte do mod nunca se sobrepõem.
- **Contenda (R21):** nenhuma task toca `package-lock.json`, `prisma/`, `src/index.ts` ou `docs/fluxo/` (padrões do plugin: a config não tem lista).
- **Incógnita externa:** não há Task 0. O tempo dividido se mede na T1, antes de integrar. A CI se mede no PR e nenhuma task depende dela.

**Gate de fase (contagem):**
- T1 completa = 5 partes + 1 helper + provas A e B com rc 0 + 7 provas negativas (MS-a a MS-g) + 3 execuções válidas + 1 decisão escrita.
- T2 completa = 3 testes novos (gates 5783 ⇒ 5786) + 9 mutações mortas + 1 prova real do mod + 11 linhas novas no backlog.
- T3 completa = 5 mutações mortas pelo teste que fica + MR5 reconferida + 4 testes e 1 asserção removidos (gates 5786 ⇒ 5783, mod base ⇒ base − 1). Item sem prova fica e a contagem esperada sobe na mesma medida.
- Entrega completa = as 3 tasks + 3 execuções verdes da CI no PR, com mediana ≤ 811 s e `tests` igual ao local.

**Estimativa (hipótese, não meta):** 2 a 4 h de relógio depois da aprovação, em 3 ondas. O topo da faixa é medição repetida por carga ou 2ª rodada na T1.

**Modelo:** Opus 5.5 nas 3 tasks (helper compartilhado, falso verde, remoção de teste). Review: Opus 5.5, instância nova.

---

### Task 1: Dividir loop-cli e medir

**tipo:** Enabler. **Depende de:** nada. **Onda A.** **Fecha:** REQ-SEG-1, REQ-VEL-1, REQ-VEL-3. **Aceite (Dado/Quando/Então):** `spec:72-104`, `spec:108-112`, condição em `spec:66-70`.

**Files:** Modify `gates/test/loop-cli.test.mjs` (vira a parte 1), `gates/test/loop-aprendizado.test.mjs` (só o comentário `:8`: M-APR3a fica na parte 3). Create `gates/test/loop-cli-2.test.mjs`, `gates/test/loop-cli-3.test.mjs`, `gates/test/loop-cli-4.test.mjs`, `gates/test/loop-cli-5.test.mjs`, `gates/test/_loop-cli-helpers.mjs`.

- [ ] **Step 0:** guardar o original e o JUnit só dele em `.claude-tmp/gm19/`: `node --test --test-reporter=junit --test-reporter-destination=<base-grupo> test/loop-cli.test.mjs`. `git grep -n "loop-cli"` fora de `fixtures/`: citação que precise mudar e esteja fora da lista ⇒ emenda antes de editar.
- [ ] **Step 1:** copiar as faixas de `spec:98` por comando, nunca à mão. Cada arquivo: comentários `//`, 1 import por linha, o marcador e o corpo. `export ` só no helper, na própria linha da declaração.
- [ ] **Step 2:** prova B (`spec:84-92`) com rc 0. JUnit das 5 partes juntas: prova A (`spec:73-83`) contra o do Step 0, 441 testes.
- [ ] **Step 3 (provas negativas):** MS-a a MS-g, uma por vez, cada uma derrubada pela prova nomeada em `spec:94`.
- [ ] **Step 4: Commit** `test(GM-19): divide loop-cli em 5 arquivos`.
- [ ] **Step 5 (orquestrador, antes de integrar):** 3 execuções da suíte na condição. A 1ª fecha a prova A contra `run3.junit.xml`. Aplicar `spec:100-102` e registrar mediana, load e decisão no diário.

### Task 2: Fechar furos dos testes

**tipo:** Enabler. **Depende de:** T1. **Onda B.** **Fecha:** REQ-FURO-1, REQ-FURO-2, REQ-FURO-3. **Aceite (Dado/Quando/Então):** `spec:114-127`.

**Files:** Modify `scripts/test/mod-test.sh` (regra do cabeçalho depois de `:20-22`; as 3 atuais ficam), `scripts/test/texto.test.sh` (1 `check` antes do resumo final, com a chamada por `$P`; cabeçalho de mutações), `gates/test/package.test.mjs` (3 testes novos e o cabeçalho real no caso de `:104`), `docs/backlog.md` (as 11 linhas de `spec:169-185` que ainda não estão lá).

- [ ] **Step 0 (medições curtas, sem suíte junto):** `bash scripts/test/texto-nom.test.sh` com rc e tempo. Em cópia temporária, import quebrado em `mod/test/chat.test.ts` e a saída crua de `claude plugin test .`. `texto-nom` vermelho, ou saída sem o cabeçalho de F11 ⇒ emenda antes do Step 1.
- [ ] **Step 1 (testes vermelhos):** `mod-test-outro-arquivo-nao-carrega`, `texto-nom-e-chamado-pelo-texto` e `npm-test-cobre-todo-arquivo-de-teste`. Os 2 primeiros falham no código de hoje. O 3º prova pelas mutações MF3.
- [ ] **Step 2:** implementação mínima. Regra do mod, já provada em log gravado (verde continua 0, chat plantado dá 1): `awk '/^[^ (].*\.test\.[cm]?[jt]s:$/{arq=$0} /^\(fail\) the file did not load/ && arq !~ /^gates\/test\//{ruim=1} END{exit ruim}'`.
- [ ] **Step 3 (mutações):** MF1-a a MF1-c, MF2-a a MF2-c, MF3-a a MF3-c, uma por vez, cada uma morta pela prova nomeada na spec. Prova real do mod quebrado pelo script: rc 1.
- [ ] **Step 4:** `node --test test/package.test.mjs test/painel-modtest-timeout.test.mjs`, `bash scripts/test/texto.test.sh` e `bash scripts/test/mod-test.sh` verdes. **Commit** `test(GM-19): fecha os furos do mod, do texto e dos globs`.

### Task 3: Cortar testes repetidos

**tipo:** Enabler. **Depende de:** T2. **Onda C.** **Fecha:** REQ-RED-1. **Aceite (Dado/Quando/Então):** `spec:129-147`.

**Files:** Modify `mod/test/gabarito.test.ts` (R1), `gates/test/autonomia-processo.test.mjs` (R2), `gates/test/package.test.mjs` (R3, R4, R6). Nenhum outro arquivo no commit. `gates/test/painel-modtest-timeout.test.mjs` não muda (R5).

- [ ] **Step 0:** JUnit dos 2 arquivos de gates e saída crua de `claude plugin test .` (total do mod, confirmar os 581). Localizar os 6 itens pelo nome: a T2 desloca linhas.
- [ ] **Step 1 (provar antes de remover):** MR1 a MR4 e MR6 (`spec:132-139`), uma por vez. Rodar o teste que fica (`--test-name-pattern` em gates; suíte do mod em R1), colar a falha de asserção e restaurar. MR5: reconferir que só os casos que ficam caem. Teste que não cair ⇒ o item não sai.
- [ ] **Step 2:** remover só os itens provados. Nenhuma outra linha muda, salvo import que ficar sem uso.
- [ ] **Step 3:** `nomes` (`spec:75-81`) antes e depois: só somem R2, R3 e R4. No mod, só R1. Contagens de `spec:143-147`.
- [ ] **Step 4:** testes dos 2 arquivos de gates e `bash scripts/test/mod-test.sh` verdes. **Commit** `test(GM-19): corta testes repetidos com prova por mutação`.

---

## Depois das tasks (orquestrador, não é task)

- PR para `next` ao integrar o último código (P12). Medir REQ-VEL-3 em 3 execuções do mesmo sha.
- Gravar os números finais em `docs/aprendizados/processo-orquestrador.md` (P7).
- Sem virada própria (Q3). A release seguinte leva a GM-19 no CHANGELOG. `next ⇒ main`, release e ruleset só por ordem ou ato do dono.

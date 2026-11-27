# GM-21 Resto do relato do consumidor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O loop é o `gabarito-loop` sobre `.harness/entregas/GM-21/plano.json` (12 tasks; rascunho validado em `.claude-tmp/gm21/plano.json`, a guarda negou a escrita do planejador em `.harness/`).

PBI: GM-21 (Bug, com as melhorias 8, 9 e 12) · Epic: não vinculado · Iniciativa: não vinculado (D-G39; `spec:3`) · Versão 2.4.0 (D-G56).

**Goal:** o painel só encerra a entrega com o plano fechado e por PR posterior à última integração; o loop confere plano e suítes antes de abrir a task; o gate conta vitest e jest e roda o `teste_afetado` sozinho; `herdar --tasks` importa trabalho antigo em `task.herdada`; o painel separa herdado de medido e pede amostra para prever (`spec:13`).

**Architecture:** núcleo puro em `gates/src/*.ts` (trilha, guarda, formas, projeto, depende, painel, painel-esquadrao, tipos), borda em `gates/scripts/*.mjs` (painel-medir, painel, loop, gate-task, onboarding, onboarding-herdar, harness-doctor, plano-executavel novo), `gates/lib/config.mjs` e docs (`reference/`, `skills/`). `gates/dist/*.js` é gerado por `npm run build`.

**Tech Stack:** TypeScript com `--experimental-strip-types`, `node --test` (Node ≥ 22.18), bash. Nenhuma dependência nova (vitest e jest **não** são instalados: as fixtures imprimem o texto com `printf`, `spec:141`).

**Spec:** `docs/superpowers/specs/2026-11-26-gm21-relato-consumidor-design.md`, r2 aprovada (commit 74e90958, sha256 `7f9eb4a2…`). As linhas citadas aqui são da r2. A emenda 1 (MJ1 da review r2, `.claude-tmp/gm21/emenda-1.diff`) acrescenta 1 linha depois de `spec:89`; depois de aplicada, some 1 às linhas ≥ 90.

## Pré-condições (antes da 1ª linha de código)

- **Emenda 1 aplicada e aprovada pela Sombra** (`.claude-tmp/gm21/emenda-1.diff`, MJ1 da review r2: `planoAberto` na fase PR de `trilhaDe`, aceite e mutação do `painel.mjs estado`). O escopo da T1 no `plano.json` já tem `painel.mjs` e `entrega-encerrada-cli.test.mjs`: a emenda não pede replanejar.
- Respostas da Sombra: P2 antes da T1, P3 antes da T12, P4 antes da T8, P5 antes da T7 (`spec:303-306`).
- Orquestrador na branch `enabler/GM-21-relato-consumidor` antes do `abrir` (`spec:280`).
- S6 rodado na base antes do 1º `integrar` (processo, "Golden S6").

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `.claude-tmp/`, `.harness/` e `CHANGELOG.md` (`spec:16`). Testes rodam de `gates/`.
- **`gates/dist/*` é build de `gates/src/*`:** toda task que muda `src/X.ts` roda `npm run build` e commita só `dist/X.js` do seu escopo; o review confere `git diff --stat` sem `dist/` alheio (`spec:244`). `tipos.ts` não tem `dist`.
- **Nada do projeto consumidor no plugin** (D-G41, D-G49): fixtures `PBI-7`, `feat/PBI-7-loop`, `docs/PBI-7-plano`, `db.local.exemplo` (`spec:84`).
- **Reproduz × regressão (P15):** cada REQ tem os testes "reproduz" (falham na base 74e90958 e passam com a mudança; o implementador mostra o vermelho no relato) e "regressão" (passam hoje; cada um com troca de valor antes do commit). Teste com relógio usa barreira por arquivo-marcador, nunca sobreposição por tempo (`spec:84`).
- **P9:** os testes de costura marcados na spec atravessam o CLI real (`medir()` ⇒ diário ⇒ `entregaPublicada`/`trilhaDe` ⇒ `loop.mjs`/`painel.mjs`; onboarding ⇒ `conferirExecutavel`; `suitesDaTask` ⇒ `avaliar`; `herdar --tasks --gravar` ⇒ `projetoDoRepo`; gh ⇒ fato ⇒ DEPENDE).
- **P16:** implementador roda só os testes dos arquivos tocados + `npm run build -- --check` + `bash scripts/test/texto.test.sh`. Suíte inteira só no `integrar`. Revisor não roda a suíte inteira.
- **Mutações:** prescritas por nome neste plano e na spec; o revisor aplica uma por vez e relata o teste que caiu. Como na GM-22, o `plano.json` não usa `mutacoes` nem `teste_afetado` (o `carregarMutacoes` exige JSON em disco, `loop.mjs:932-947`; `teste_afetado` vira suíte extra, `loop.mjs:955-967`). Se o orquestrador quiser o gate rodando as mutações, cria `.harness/entregas/GM-21/mutacoes/T<n>.json` (`[{nome, arquivo, de, para, teste, cwd?}]`, formato da GM-16) e emenda o plano.
- TMPDIR de teste em `$(getconf DARWIN_USER_TEMP_DIR)`, nunca em `.claude-tmp/`. Ninguém usa `env`/`printenv`/`set`; ninguém lê `.env`. Documento por Write/Edit, nunca heredoc.
- Commits `tipo(GM-21): …` com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `git add` por caminho, sem `git stash`, sem push.

## Mapa REQ → task

| REQ | Task | Spec (r2) |
|---|---|---|
| REQ-ENC-1, REQ-ENC-2 | T1 | DT1 `:65`, DT2 `:66`; `:88-99`; M2-M5, M4b `:25-29`; emenda 1 |
| REQ-MIG-2 | T2 (detecção, doctor), T12 (costura com `conferirExecutavel`) | DT5 `:69`; `:121-126` |
| REQ-MIG-1, REQ-MIG-3 | T3 | DT4 `:68`; `:113-130`; M8-M13 `:32-37` |
| REQ-CNT-1 | T4 | DT6 `:70`; `:134-141`; M14 `:38` |
| REQ-SUI-1 | T5 | DT7 `:71`; `:145-151`; M15-M16 `:39-40` |
| REQ-ORQ-1 | T12 | DT3 `:67`; `:103-109`; M6-M7 `:30-31` |
| REQ-TIT-1 | T9 | DT13 `:77`; `:187-190`; M19 `:43` |
| REQ-MUT-1 | T10 | DT14 `:78`; `:194-196`; M22 `:46` |
| REQ-HER-1, REQ-HER-2 | T6 | DT8 `:72`, DT9 `:73`; `:155-165`; M20 `:44` |
| REQ-HER-3, REQ-PRV-1 | T7 | DT10 `:74`, DT11 `:75`; `:167-178`; M17, M21 `:41`, `:45` |
| REQ-DEP-1 | T8 | DT12 `:76`; `:180-185`; M18 `:42` |
| REQ-VRS-1 | T11 | `:200-202`; M23 `:47`; CHANGELOG `:246-274` |

## Grafo

Em 1 linha: `{T1,T2,T4} → T3 → {T5, T12, T9, T10} → T6 → {T7, T8} → T11`.

| Onda | Task (deps) | Observação |
|---|---|---|
| 1a | T1 (—), T2 (—), T4 (—) | o que trava o loop (D-G57): itens 2, 4 b, 5; arquivos disjuntos |
| 1b | T3 (T1, T4) | itens 4 a e c, backlog l.122; `loop-cli-5.test.mjs` de T1, `gate-task.mjs` de T4 |
| 2 | T5 (T3, T4), T12 (T2, T3), T9 (T1), T10 (T3) | escopos disjuntos entre si |
| 3 | T6 (T2, T12) | `onboarding.mjs` depois de T2 e T12 |
| 4 | T7 (T6), T8 (T1, T6) | escopos disjuntos; `dist/` por arquivo |
| 5 | T11 (todas) | versão, CHANGELOG, backlog |

Contagem por onda: 1a = 3, 1b = 1, 2 = 4, 3 = 1, 4 = 2, 5 = 1 (12 tasks).

Diferenças contra a tabela da spec (`spec:229-244`), todas sem REQ novo:
- **T1** ganha `gates/scripts/painel.mjs` e `gates/test/entrega-encerrada-cli.test.mjs` (emenda 1, MJ1). Por isso **T9 depende de T1** (`painel.mjs`); `validarPlano` recusa o plano sem essa dependência (medido).
- **T12 depende também de T3** e leva o teste de costura `onboarding-suites-passa-no-conferir` da REQ-MIG-2 (MINOR 1 da review r2; `docs/backlog.md`, seção GM-21). A T2 fica com os outros 5 testes da REQ-MIG-2.
- **T11** ganha `docs/backlog.md` (linhas de "Fora de escopo", `spec:286-298`, que ainda não estão lá), como a T5 da GM-22.

Recursos compartilhados: a máquina (1 `integrar` por vez, P17b). Incógnitas externas sem Task 0: `gh pr list --json isDraft` é passo 0 da T8; o custo do card no `bench-painel.mjs` é passo 0 da T9; o tempo do `integrar` com `teste_afetado` em série é medido na T5 (informativo; `spec:307-309`).

**Gate de fase (contagem):** T1 = 11 testes (com a emenda) + ME1-a a g + ME2-a a c; T2 = 5 testes + MM2-a a c; T3 = 9 testes CLI + 1 de texto + MM1-a a d + MM3-a; T4 = 8 testes + MC1-a a c; T5 = 6 testes + MS1-a a d + tempo do `integrar`; T12 = 4 testes + costura + MO1-a a d; T9 = 3 testes + bench + MT1-a, b; T10 = 1 de texto + MU1-a; T6 = 8 testes CLI + MH1-a, b + MH2-a a d; T7 = 9 testes + MH3-a a d + MP1-a, b; T8 = 5 testes + MD1-a a d; T11 = versões + `[2.4.0]` + MV1-a. **Entrega completa** = 12 tasks + fumaça de `spec:223` + CI verde no PR para `next`.

**Modelo:** Opus 5.5 em T1 (guarda), T3, T5, T6 (contratos do loop e do diário); Sonnet em T2, T4, T7, T8, T9, T12; Haiku ou Sonnet em T10 e T11 (texto). Review de task: Opus 5.5, instância nova; review final da entrega: Fable.

**Estimativa (hipótese, não meta):** 12 tasks em 6 ondas, até 4 frentes na onda 2; a faixa vai ao dono pelo painel com o ritmo medido depois da onda 1a.

---

### Task 1: Encerramento e publicada

**tipo:** Bug. **Onda 1a.** **Depende de:** nada. **Fecha:** REQ-ENC-1, REQ-ENC-2. **Só com P2 respondida e a emenda 1 aplicada.**
**Aceite:** `spec:88-99` + o aceite do `painel.mjs estado` da emenda 1; DT1 `spec:65` (regra única na fase PR de `trilhaDe`, `trilha.ts:282-288`; `entregaPublicada` passa as tasks do `plano.json` à `trilhaDe` em `guarda.ts:290`), DT2 `spec:66`.
**Files:** os 12 de `plano.json` T1 (`trilha.ts`/`dist`, `guarda.ts`/`dist` só `entregaPublicada`, `painel-medir.mjs`, `painel.mjs` só o comentário de `:768`, testes `trilha`, `encerramento`, `painel-medir`, `entrega-encerrada-cli`, `loop-cli-5` só o caso `publicada-nao-com-plano-aberto`, fixture `gh-encerramento/gh`).

- [ ] **Step 0:** rodar `node .claude-tmp/gm21/rv-publicada.mjs .claude-tmp/gm21/rv` e `node .claude-tmp/gm21/rv2-trilha.mjs` na base: anotar `true`/`identificada false` (o vermelho de M4b e do MJ1). `git grep -n "podeEncerrar\|trilhaDe(\|entregaPublicada("` em `gates/src`, `gates/scripts`, `mod/`: todo chamador listado (o único de `podeEncerrar` é `painel-medir.mjs:454`).
- [ ] **Step 1 (vermelho):** reproduz `encerra-nao-com-plano-aberto-titulo`, `encerra-nao-com-plano-aberto-head`, `publicada-nao-com-plano-aberto` (P9, `loop.mjs iniciar T2` real), `painel-plano-aberto-segue-identificado` (P9, `painel.mjs estado` real: PRONTO `1 de 2`, T2 próxima), `aviso-encerrar-uma-vez`, `encerra-so-pr-posterior`, `encerra-margem-de-relogio` (6 min). Regressão: `encerra-com-task-fora`, `encerra-sem-plano-igual` (os testes atuais passam sem edição; as 22 chamadas de `podeEncerrar` seguem válidas), `publicada-encerrada-dono-igual`, DT2 sem `task.integrada` não se aplica.
- [ ] **Step 2:** `planoAberto` exportado; fase PR de `trilhaDe` com `!planoAberto`; `podeEncerrar` com 5º argumento opcional e a DT2 (margem 5 min); `entregaPublicada` lê `plano.json` com `validarPlano` e passa as tasks (ausente ou inválido ⇒ `[]`); `painel-medir.mjs` passa o plano de `alvo.dir` e devolve o aviso só no `estado`. Do backlog (MINOR 2 e 3 da r2, destino T1): diário que não projeta ⇒ regra de hoje; task em `invalidas` conta como aberta (1 caso de regressão); a dedup do aviso amarra-se à 1ª gravação do fato `pr` #n na sessão (`painel-medir.mjs:420-424`), sem evento novo.
- [ ] **Step 3:** ME1-a a g, ME2-a a c, uma por vez, cada uma derrubada (nome do teste no relato). ME1-d (fase PR de `trilhaDe` ignora o plano) tem de derrubar o caso do `painel.mjs estado`.
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/trilha.test.ts test/encerramento.test.ts` e `node --test test/painel-medir.test.mjs test/entrega-encerrada-cli.test.mjs test/loop-cli-5.test.mjs` verdes. **Commit** `fix(GM-21): plano aberto não encerra nem publica`.

### Task 2: Onboarding e doctor sabem de `gates.suites`

**tipo:** Bug. **Onda 1a.** **Depende de:** nada. **Fecha:** REQ-MIG-2 (menos a costura, que é da T12).
**Aceite:** `spec:121-125` (menos o 4º item); DT5 `spec:69`; M11 `spec:35`.
**Files:** `plano.json` T2.

- [ ] **Step 1 (vermelho):** reproduz `onboarding-detecta-suites`, `doctor-suites-declaradas`. Regressão: `onboarding-nao-sobrescreve-suites`, `onboarding-sem-script-test-nao-pergunta`, `onboarding-placeholder-nao-grava`.
- [ ] **Step 2:** detecção ao lado de `detectarTipoRepo` (`onboarding.mjs:384-394`), gravação em `patches`, linha na prévia; item `suites-declaradas` no doctor. Nenhuma pergunta nova.
- [ ] **Step 3:** MM2-a a c, cada uma derrubada.
- [ ] **Step 4:** `node --test test/onboarding.test.mjs test/harness-doctor-loop.test.mjs test/onboarding-texto.test.mjs` verdes. **Commit** `fix(GM-21): onboarding detecta gates.suites e o doctor avisa sem`.

### Task 4: Contagem de vitest e jest

**tipo:** Bug. **Onda 1a.** **Depende de:** nada. **Fecha:** REQ-CNT-1.
**Aceite:** `spec:134-141`; DT6 `spec:70`; M14 `spec:38`.
**Files:** `plano.json` T4.

- [ ] **Step 1 (vermelho):** reproduz `conta-vitest-verde`, `conta-vitest-com-ansi`, `vitest-falha-reprova`, `vitest-so-falhas`, `conta-jest-verde`, `conta-jest-com-pulado` (suíte = `printf` do texto). Regressão: `test-files-nao-conta`, `node-test-igual` (byte a byte) e os testes atuais de `gate-task.test.mjs`.
- [ ] **Step 2:** `falhas` e `somar` viram `contagem(out)` → `{tests, pass, fail}`, sem ANSI; `Test Files`/`Test Suites` não contam; "RED conhecido" só node/TAP.
- [ ] **Step 3:** MC1-a a c, cada uma derrubada.
- [ ] **Step 4:** `node --test test/gate-task.test.mjs` verde. **Commit** `fix(GM-21): o gate conta vitest e jest`.

### Task 3: Plano executável conferido antes do abrir

**tipo:** Bug. **Onda 1b.** **Depende de:** T1 (`loop-cli-5.test.mjs`), T4 (`gate-task.mjs`). **Fecha:** REQ-MIG-1, REQ-MIG-3.
**Aceite:** `spec:113-130`; DT4 `spec:68`; M8-M13 `spec:32-37`.
**Files:** `plano.json` T3 (`plano-executavel.mjs` e seu teste novos; `gate-task.mjs` só o `export` de `normalizarSuites`).

- [ ] **Step 1 (vermelho):** reproduz `abrir-recusa-mutacoes-texto-livre`, `abrir-recusa-teste-afetado-caminho`, `abrir-recusa-sem-suites`, `proxima-tira-invalida`, `proxima-todas-invalidas-espera` (CLI real). Regressão: `abrir-plano-valido-igual` (formato da GM-16 com `cwd`), `suites-em-texto-aceitas`, `escopo-por-emenda-e-diretorio`, `conferir-ignora-integrada`. Texto: literais `teste_afetado`, `{nome, arquivo, de, para, teste, cwd?}` e `plano_nao_executavel` em `reference/fluxo.md` via `texto.test.sh`.
- [ ] **Step 2:** `conferirExecutavel` (escopo pelo mesmo cálculo do gate, `loop.mjs:949-953`, `:1125`); `abrir` recusa antes da worktree; `proxima` tira a inválida e avisa; seção "Campos da task do plano.json" em `reference/fluxo.md` e 1 linha em `skills/gabarito-loop/SKILL.md`.
- [ ] **Step 3:** MM1-a a d, MM3-a, cada uma derrubada.
- [ ] **Step 4:** `node --test test/plano-executavel.test.mjs test/loop-cli-5.test.mjs test/gate-task.test.mjs` e `bash scripts/test/texto.test.sh` verdes. **Commit** `fix(GM-21): abrir confere plano e suítes antes da worktree`.

### Task 5: `teste_afetado` sozinho e `serial: true`

**tipo:** Bug. **Onda 2.** **Depende de:** T3, T4. **Fecha:** REQ-SUI-1.
**Aceite:** `spec:145-151` (fixture de barreira em `:146`); DT7 `spec:71`.
**Files:** `plano.json` T5.

- [ ] **Step 0:** medir o tempo do `integrar` de 1 task da GM-21 antes da mudança (informativo, `spec:307`).
- [ ] **Step 1 (vermelho):** reproduz `teste-afetado-depois`, `serial-nao-sobrepoe`, `a4-mesma-ordem`, `integrar-teste-afetado-em-serie` (P9, `loop.mjs integrar` real). Regressão: `paralelas-seguem-paralelas`, `mod-test-segue-depois`.
- [ ] **Step 2:** `normalizarSuites` lê `serial`; passo 5 e `medirBase` rodam paralelas, depois `serial`, `mod-test.sh` e `teste_afetado`; `suitesDaTask` marca `serial: true`.
- [ ] **Step 3:** MS1-a a d (arquivo de cada uma em `spec:151`), cada uma derrubada.
- [ ] **Step 4:** `node --test test/gate-task.test.mjs test/loop-cli-5.test.mjs` verdes; tempo depois da mudança no relato. **Commit** `fix(GM-21): teste_afetado e suítes serial rodam sozinhos`.

### Task 12: Alias do orquestrador

**tipo:** Bug. **Onda 2.** **Depende de:** T2 (mesmos arquivos), T3 (`conferirExecutavel` para a costura). **Fecha:** REQ-ORQ-1 e a costura da REQ-MIG-2. **Só com P3 respondida.**
**Aceite:** `spec:103-109`; 4º item de `spec:125`; DT3 `spec:67`; M6-M7.
**Files:** `plano.json` T12.

- [ ] **Step 1 (vermelho):** reproduz `alias-orquestrador-por-papel` (3 perfis e o explícito), `doctor-orquestrador-abaixo`, `doctor-alias-divergente`, `onboarding-suites-passa-no-conferir` (P9). Regressão: `revisor-final-inalterado`; o `deepEqual` de `lib.test.mjs:520-543` ganha o papel.
- [ ] **Step 2:** papel `orquestrador` (`opus`) nos 3 perfis de `config.mjs`; alias pelo papel em `onboarding.mjs:779-788`, `:865`; doctor avisa abaixo do recomendado e a divergência do alias gravado.
- [ ] **Step 3:** MO1-a a d, cada uma derrubada; trocar `gates.suites` gravado por lista vazia derruba a costura.
- [ ] **Step 4:** `node --test test/onboarding.test.mjs test/harness-doctor-loop.test.mjs test/lib.test.mjs` verdes. **Commit** `fix(GM-21): alias do orquestrador pelo papel orquestrador`.

### Task 9: Título da entrega pelo card

**tipo:** Melhoria. **Onda 2.** **Depende de:** T1 (`painel.mjs`). **Fecha:** REQ-TIT-1.
**Aceite:** `spec:187-190`; DT13 `spec:77`; M19 `spec:43`.
**Files:** `plano.json` T9 (teste em `gates/test/painel-cli.test.mjs`, que já monta repo).

- [ ] **Step 0:** `bench-painel.mjs` na base (número no relato, `spec:309`).
- [ ] **Step 1 (vermelho):** reproduz `titulo-do-card`, `titulo-card-ambiguo`. Regressão: `titulo-sem-card-igual`.
- [ ] **Step 2:** título do card de `fluxo.mapeamento.FL1` (frontmatter `id` = entrega) antes da spec (`painel.mjs:775-782`).
- [ ] **Step 3:** MT1-a, b, cada uma derrubada; bench não piora mais que 5 %.
- [ ] **Step 4:** `node --test test/painel-cli.test.mjs` verde. **Commit** `feat(GM-21): título da entrega vem do card`.

### Task 10: Doc da mutação de SQL

**tipo:** Melhoria (doc). **Onda 2.** **Depende de:** T3 (`texto.test.sh`). **Fecha:** REQ-MUT-1.
**Aceite:** `spec:194-196`; DT14 `spec:78`.
**Files:** `plano.json` T10.

- [ ] **Step 1 (vermelho):** checagem dos literais em `texto.test.sh` (incl. "nunca banco de produção nem compartilhado").
- [ ] **Step 2:** subseção "Migration de banco" em `reference/gates.md:225-239` com as 2 formas e 1 exemplo.
- [ ] **Step 3:** MU1-a derrubada.
- [ ] **Step 4:** `bash scripts/test/texto.test.sh` verde. **Commit** `docs(GM-21): mutação de migration de banco`.

### Task 6: `herdar --tasks` e `task.herdada`

**tipo:** Bug (contrato D-G50). **Onda 3.** **Depende de:** T2, T12 (`onboarding.mjs`). **Fecha:** REQ-HER-1, REQ-HER-2.
**Aceite:** `spec:155-165`; DT8 `spec:72`, DT9 `spec:73`; M20 `spec:44`.
**Files:** `plano.json` T6.

- [ ] **Step 1 (vermelho):** reproduz `forma-task-herdada`, `herdar-tasks-le-sem-gravar`, `herdar-tasks-grava-3`, `herdar-tasks-recusa-tudo-ou-nada` (1 caso por motivo), `herdar-tasks-idempotente`, `herdar-tasks-nao-toca-plano` (CLI real, gh falso com o #10 `MERGED`). Regressão: `herdada-fora-do-loop` (`TIPOS_DE_TASK`/`TIPOS_LOOP` `deepEqual`), `tipos-evento-cobre-a-uniao`, testes atuais do `herdar` sem `--tasks`.
- [ ] **Step 2:** tipo em `tipos.ts` e `TIPOS_EVENTO` (`formas.ts:13-21`) com a forma; `herdarTasks` em `onboarding-herdar.mjs` (origem conferida, tudo ou nada, sessão `herdar`); flags em `onboarding.mjs:960-972`; passo 6b em `skills/gabarito-instalar/SKILL.md:63-67`.
- [ ] **Step 3:** MH1-a, b, MH2-a a d, cada uma derrubada.
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/formas.test.ts test/loop.test.ts` e `node --test test/onboarding-herdar.test.mjs` verdes. **Commit** `feat(GM-21): herdar --tasks grava task.herdada com origem`.

### Task 7: Painel: herdadas e previsão com amostra

**tipo:** Melhoria. **Onda 4.** **Depende de:** T6. **Fecha:** REQ-HER-3, REQ-PRV-1. **PRV-1 só com P5 respondida.**
**Aceite:** `spec:167-178`; DT10 `spec:74`, DT11 `spec:75`; M17, M21.
**Files:** `plano.json` T7.

- [ ] **Step 1 (vermelho):** reproduz `projeto-conta-herdadas` (13 / 92 % / `12 feitas: 11 herdadas, 1 medida`), `totais-com-herdadas`, `feito-nao-estima-herdada`, `herdada-e-integrada-conta-uma`, `previsao-projeto-pede-5`, e o caso P9 pelo `projetoDoRepo` sobre o diário gravado pelo `herdar --tasks --gravar` da T6. Regressão: `projeto-sem-herdada-igual`, `ritmo-ignora-herdada`, `previsao-projeto-com-5-igual`, `fallback-entrega-igual`.
- [ ] **Step 2:** `herdadas` na linha e nos `totais` (`projeto.ts:365-412`), `estimadas` descontando herdadas; piso de 5 em `projeto.ts:429-431`; texto em `painel-esquadrao.ts` se não vier pronto.
- [ ] **Step 3:** MH3-a a d, MP1-a, b, cada uma derrubada.
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/projeto.test.ts test/painel-projeto.test.ts test/painel-esquadrao.test.ts` verdes. **Commit** `feat(GM-21): painel separa herdado de medido e pede amostra`.

### Task 8: DEPENDE sem rascunho nem merge do orquestrador

**tipo:** Melhoria. **Onda 4.** **Depende de:** T1 (`painel-medir.mjs`, fixture), T6 (`formas.ts`). **Fecha:** REQ-DEP-1. **Só com P4 respondida.**
**Aceite:** `spec:180-185`; DT12 `spec:76`; M18 `spec:42`.
**Files:** `plano.json` T8.

- [ ] **Step 0:** `gh pr list --json isDraft --limit 1` contra este repo, só leitura (`spec:308`); resultado no relato.
- [ ] **Step 1 (vermelho):** reproduz `depende-sem-rascunho`, `depende-sem-pr-com-autonomia`, `fato-pr-rascunho-opcional`, `painel-rascunho-ponta-a-ponta` (P9, `GH_PRS_EXTRA` com o #12 `isDraft: true`). Regressão: `depende-pr-sem-autonomia-igual` (troca de valor `true`/`false`/ausente).
- [ ] **Step 2:** `isDraft` em `CAMPOS_PR` e `rascunho` em `prDoGh`; `rascunho` opcional booleano no fato `pr` (`formas.ts:381-390`); `depende.ts` e `painel.ts:1187-1194` passam `autonomiaEntrega`.
- [ ] **Step 3:** MD1-a a d, cada uma derrubada.
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/depende.test.ts test/formas.test.ts` e `node --test test/painel-medir.test.mjs` verdes. **Commit** `feat(GM-21): DEPENDE sem PR de rascunho nem de merge do orquestrador`.

### Task 11: Versão 2.4.0 e CHANGELOG

**tipo:** Tarefa. **Onda 5.** **Depende de:** todas. **Fecha:** REQ-VRS-1.
**Aceite:** `spec:200-202`; texto `spec:246-274`; M23 `spec:47`.
**Files:** `plano.json` T11.

- [ ] **Step 1:** `plugin.json:4` e `gates/package.json:3` = `2.4.0`; `package.test.mjs:49-50` e `texto.test.sh:279` fixam `2.4.0`; ordem `[2.4.0] > [2.3.1] > [2.3.0]` em `texto.test.sh`; `[2.4.0]` datada com o texto de `spec:249-273`, cada item apontando o item do relato. Em "Limites declarados", a DT2 não vale na regra antiga antes do PR final abrir (MINOR 4 da r2, backlog GM-21).
- [ ] **Step 2:** `git grep -n "2\.3\.1" -- ':!*.md' ':!.harness'` só acha as checagens do CHANGELOG `[2.3.1]` e o sufixo `autonomia (2.3.1)` de `decidir.ts:106`. Linhas de "Fora de escopo" (`spec:286-298`) que faltam em `docs/backlog.md`.
- [ ] **Step 3:** MV1-a derrubada por `package.test.mjs` e `texto.test.sh`.
- [ ] **Step 4:** `node --test test/package.test.mjs` e `bash scripts/test/texto.test.sh` verdes. **Commit** `chore(GM-21): versão 2.4.0 e CHANGELOG`.

---

## Depois das tasks (orquestrador, não é task)

- Fumaça de `spec:223`: `medir.mjs` contra a worktree (M2, M6, M8, M14, M17 mudam como os REQs dizem), `rv-publicada.mjs` (M4b vira `false`), `rv2-trilha.mjs` (`identificada true`), repo tmp com plano da alpha.1 em que `abrir` recusa; saídas no PR.
- PR `enabler/GM-21-relato-consumidor ⇒ next`; `next ⇒ main`, tag e release só por ordem do dono (D-G56, R1).
- Gravar números e aprendizados em `docs/aprendizados/processo-orquestrador.md` (P7).

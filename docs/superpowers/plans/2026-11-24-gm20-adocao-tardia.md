# GM-20 Adoção tardia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O loop é o `gabarito-loop` sobre `.harness/entregas/GM-20/plano.json` (rascunho em `.claude-tmp/gm20/plano-rascunho.json`, 12 tasks).

PBI: GM-20 · Epic: não vinculado · Iniciativa: não vinculado (D-G39, regra da GM-19 herdada e aplicada à GM-20 pelo orquestrador: sem vínculo até o dono criar Epic; não é decisão nova do dono; `spec:3`).

**Goal:** o painel lê sem contradição um projeto que adotou o gabarito tarde, e o `gabarito-instalar --atualizar` oferece ligar o que veio antes. Versão 2.3.0 (D-G45).

**Architecture:** correções no núcleo puro (`gates/src/*.ts`, com `gates/dist/*.js` gerado por `npm run build`), na borda (`gates/scripts/painel.mjs`, `painel-medir.mjs`, `loop.mjs`, `onboarding-herdar.mjs`) e na skill `gabarito-instalar`. Nenhuma mudança na guarda nem nos hooks.

**Tech Stack:** TypeScript com `--experimental-strip-types`, `node --test` (Node ≥ 22.18), bash. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-24-gm20-adocao-tardia-design.md` (r1, não aprovada). Decisões do dono: D-G41 a D-G46 (a D-G46 confirma a D-G43: painel trata e avisa, nenhum card é escrito).

## Pré-condições (antes da 1ª linha de código)

- Spec aprovada pelo dono. Sombra confirma a DT16 (`spec:82`, P2) antes da T10.
- Orquestrador na branch `enabler/GM-20-adocao-tardia` antes do `abrir` (processo, "Orquestrador na branch da entrega").
- S6 rodado na base antes do 1º `integrar`. Vermelho fora da task ⇒ `descoberta` e `integrar` com `S6_REPOS_DIR` vazio (processo, "Golden S6").

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `.claude-tmp/` e `CHANGELOG.md`. Testes rodam de `gates/`.
- **`gates/dist/*` é build de `gates/src/*`:** toda task que muda `src/X.ts` roda `npm run build` e commita `dist/X.js` junto. `dist em dia` na CI confere.
- **Nada do projeto canário no plugin** (D-G41): nenhum id, caminho ou status de lá em código, teste ou doc.
- **Nenhum card é escrito** por nenhuma task (D-G43, D-G46, DT17 `spec:83`); a T11 prova com teste que lê o card antes e depois.
- Fixture comum `gates/test/painel-fixtures/adotado.mjs` nasce na T1 completa (`spec:91`); as outras tasks só a leem. Precisa de caso novo ⇒ fixture local no próprio teste.
- TMPDIR de teste em `$(getconf DARWIN_USER_TEMP_DIR)`, nunca em `.claude-tmp/` (processo, "TMPDIR fora do repositório").
- **P16:** implementador roda só os testes dos arquivos tocados + `npm run build -- --check` (se existir) + `bash scripts/test/texto.test.sh`. Suíte inteira só no `integrar`. Revisor não roda a suíte inteira.
- **P15:** cada campo produzido tem asserção que o lê; cada "não toca X" tem teste com troca de valor.
- **P18:** antes de `concluir` correção ou reentrega, o orquestrador roda 1 vez os testes dos arquivos tocados.
- **P8:** ninguém usa `env`, `printenv`, `set` nem dump de variável. Ninguém lê `.env`.
- Documento se grava por Write/Edit, nunca por heredoc (processo, "Brief de redator").
- Commits `tipo(GM-20): …` com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `git add` por caminho, sem `git stash`, sem push.

## Mapa REQ → task

| REQ | Task | Spec |
|---|---|---|
| REQ-PCT-1, 2, 3 | T1 | `spec:93-107` |
| REQ-TER-1, 2 | T2 | `spec:128-140` |
| REQ-LEG-1, 2, 3 | T3 | `spec:109-126` |
| REQ-PRV-1 | T4 | `spec:198-204` |
| REQ-SEP-1 | T5 | `spec:206-211` |
| REQ-CRD-2 | T6 | `spec:153-159` |
| REQ-PRX-1 | T7 | `spec:213-219` |
| REQ-FAN-1, 2, 3 | T8 | `spec:161-176` |
| REQ-EXE-1, 2, 3 | T9 | `spec:178-196` |
| REQ-ADO-1, 2, 3 | T10 | `spec:221-244` |
| REQ-CRD-1 | T11 | `spec:142-151` (D-G43, D-G46 `spec:61-62`) |
| REQ-VRS-1 | T12 | `spec:246-250` |

## Grafo

Em 1 linha: `T1→T2→{T3,T4}; T4→T5; T3→T8→T9; T3→T10; {T5,T10}→T11; T6, T7 livres; tudo→T12`.

| Onda | Task (dependências) | Observação |
|---|---|---|
| A | T1 (—), T6 (—), T7 (—) | T6 e T7 não tocam arquivo de outra task |
| B | T2 (T1) | `projeto.ts`, `painel-esquadrao.ts`: contenda com T1 |
| C | T3 (T2), T4 (T2) | T3 em `projeto.ts`/`painel.mjs`; T4 em `painel-esquadrao.ts`: sem arquivo comum |
| D | T5 (T4), T8 (T3), T10 (T3) | T5 `painel-esquadrao.ts`; T8 `painel.mjs`/`painel-equipe.ts`; T10 onboarding e skill |
| E | T9 (T8) | `painel-equipe.ts` em comum com T8 |
| F | T11 (T5, T10) | toca `projeto.ts`, `painel-esquadrao.ts`, `onboarding-herdar.mjs` (troca o detector local pelo exportado) |
| G | T12 (T1 a T11) | versão e CHANGELOG |

- **serial: contenda (R21):**
  - `gates/src/projeto.ts` + `dist/projeto.js`: T1 → T2 → T3 → T11.
  - `gates/src/painel-esquadrao.ts` + `dist/painel-esquadrao.js`: T1 → T2 → T4 → T5 → T11.
  - `gates/scripts/painel.mjs`: T2 → T3 → T8.
  - `gates/src/painel-equipe.ts` + `dist/painel-equipe.js`: T8 → T9.
  - `onboarding-herdar.mjs`, `gates/test/onboarding-herdar.test.mjs`: T10 → T11. `skills/gabarito-instalar/SKILL.md`: só T10.
  - `gates/test/painel-cli.test.mjs`: T2 → T3 → T8 (a T11 não toca). `gates/test/painel-projeto.test.ts`: T1 → T2 → T4 → T11.
  - `CHANGELOG.md`, `.claude-plugin/plugin.json`, `gates/package.json`, `docs/backlog.md`: só T12.
  - `gates/test/loop-cli-3.test.mjs`: só T10. `gates/test/loop-cli-5.test.mjs`: só T9.
- **Serial (recurso compartilhado):** a máquina. 1 `integrar` por vez (P17b).
- **Incógnita externa:** não há Task 0. As medições que faltam (`spec:324-332`) são passo 0 das tasks T8 e T10.

**Gate de fase (contagem):**
- T1 = fixture com 10 PBIs + 4 testes novos (3 + `render-projeto-propriedade-larguras`) + 5 mutações mortas (MP1-a, MP2-a a c, MP3-a) + comentário `projeto.ts:39` emendado. T2, T4 e T11 estendem o teste de propriedade com o seu texto (sem contar teste novo).
- T2 = 2 testes + 1 pelo CLI `painel.mjs` + 6 mutações (MT1-a a c, MT2-a a c).
- T3 = 3 testes + 1 pelo CLI + `plano-md-nao-casa` intacto + 7 mutações (ML1-a, b, ML2-a, b, ML3-a a c) + emenda GM-16 REQ-PRJ-1 (c).
- T4 = 1 teste + regex/contagem ajustadas + 2 mutações. T5 = 1 teste em 2 locais + 2 mutações.
- T6 = 1 teste com 5 casos + 3 mutações. T7 = 1 teste com 2 casos + 2 mutações + fumaça neste repo sem "GM-12".
- T8 = 4 testes + 1 CLI + 6 mutações + 1 medição de tempo. T9 = 7 testes + 7 mutações.
- T10 = 8 testes (7 nomeados + 1 de mesma contagem, P9) + 6 mutações + 4 docs coerentes (skill, `commands/gabarito.md`, `virada-2.1.md`, `reference/fluxo.md`).
- T11 = 5 testes (núcleo, reaberta, render, cláusula negativa pelo CLI `painel.mjs` com bytes e `mtime` do card iguais, mesma contagem `herdar` × painel) + `herdar-nao-escreve-card` da T10 verde + 4 mutações (MC1-a a d). T12 = 2 versões + `[2.3.0]` + testes de versão verdes + 1 mutação + backlog com as linhas de "Fora de escopo".
- **Entrega completa** = 12 tasks + fumaça do painel deste repo com o diário real inteiro (cabeçalho inteiro conferido) + CI verde no PR para `next`.

**Estimativa (hipótese, não meta):** (M, calculado) 12 tasks de 30 a 60 min de implementação cada, mais review e `integrar`, em 7 ondas com até 3 frentes. Não há medição de entrega parecida; a faixa vai ao dono pelo painel, com o ritmo medido depois da T1.

**Modelo:** Sonnet nas tasks T4, T5, T6, T7, T12; Opus 5.5 em T1, T2, T3, T8, T9, T10, T11 (estado, contrato de falha ou escrita em config: P1 do processo pede Sombra antes do despacho de T8, T9, T10). Review: Opus 5.5, instância nova; review final da entrega: Fable.

---

### Task 1: % do projeto sem misturar denominadores

**tipo:** Bug. **Depende de:** nada. **Onda A.** **serial: contenda** (`projeto.ts`, `painel-esquadrao.ts`). **Fecha:** REQ-PCT-1, REQ-PCT-2, REQ-PCT-3. **Aceite (Dado/Quando/Então):** `spec:95-107`; fixture `spec:91`.

**Files:** Create `gates/test/painel-fixtures/adotado.mjs`. Modify `gates/src/projeto.ts` (`:39`, `:300-335`), `gates/src/painel-esquadrao.ts` (`:393`), `gates/dist/projeto.js`, `gates/dist/painel-esquadrao.js`, `gates/test/projeto.test.ts`, `gates/test/painel-projeto.test.ts`.

- [ ] **Step 0:** montar a fixture com os 10 PBIs e `montarNoDisco(dir, {planosLegados?, terminais?})`, diário pelo `append` de `dist/diario.js`. Conferir que reproduz M1 (`pbis 9`+1, `pct 55`) antes de mudar código.
- [ ] **Step 1 (vermelho):** `pct-concluido-sem-plano-json-fora-das-duas-pontas`, `render-pct-com-estimadas`, `sem-plano-conta-so-abertos`, e o teste de propriedade `render-projeto-propriedade-larguras` em `gates/test/painel-projeto.test.ts` (larguras 44 a 120: número nunca cortado, ausente ≠ `0`; texto `+N estimadas`; `spec:102`).
- [ ] **Step 2:** concluído sem `plano.json` (inclui `.md`) com `tasks` fora dos totais; render lê `pctComEstimadas ?? pct`; `foraDaConta = semPlano && !feito`; comentário `:39`.
- [ ] **Step 3:** MP1-a, MP2-a, MP2-b, MP2-c, MP3-a, uma por vez, cada uma derrubada.
- [ ] **Step 4:** `npm run build`; testes de `projeto`, `painel-projeto`, `painel-esquadrao`, `painel-golden` verdes (golden que mudar: diff explicado no relato). **Commit** `fix(GM-20): % do projeto sem misturar denominadores`.

### Task 2: Status terminal fora das contas

**tipo:** Bug. **Depende de:** T1. **Onda B.** **serial: contenda** (`projeto.ts`, `painel-esquadrao.ts`, `painel.mjs`). **Fecha:** REQ-TER-1, REQ-TER-2. **Aceite:** `spec:130-140`; DT5 `spec:71`.

**Files:** Modify `gates/src/projeto.ts` (predicado `ehTerminal` exportado; antes de `:274`), `gates/src/painel-esquadrao.ts` (linha 1 dos totais, variantes), `gates/scripts/painel.mjs` (`:375-382`, passa `fluxo.status.terminais`), `gates/dist/projeto.js`, `gates/dist/painel-esquadrao.js`, `gates/test/projeto.test.ts`, `gates/test/painel-projeto.test.ts`, `gates/test/painel-cli.test.mjs`.

- [ ] **Step 1 (vermelho):** `status-terminal-fora`, `status-terminal-config`, e 1 caso pelo CLI `painel.mjs` sobre a fixture em disco (P9). Estender `render-projeto-propriedade-larguras` (`painel-projeto.test.ts`) com `N encerrados sem entrega`.
- [ ] **Step 2:** terminal antes de opção; terminal com medição segue linha e avisa; `totais.terminais`; "N encerrados sem entrega" cortado antes do número.
- [ ] **Step 3:** MT1-a a c, MT2-a a c.
- [ ] **Step 4:** build; testes dos arquivos tocados verdes. **Commit** `fix(GM-20): status terminal sai das contas do projeto`.

### Task 3: Plano no formato anterior

**tipo:** Bug. **Depende de:** T2. **Onda C.** **serial: contenda** (`projeto.ts`, `painel.mjs`). **Fecha:** REQ-LEG-1, REQ-LEG-2, REQ-LEG-3. **Aceite:** `spec:111-126`; DT3, DT4 `spec:69-70`.

**Files:** Modify `gates/src/projeto.ts` (`planoLegadoDe` exportado; `:290-295`, texto da linha), `gates/scripts/painel.mjs` (`lerArvoreDoProjeto` `:300-333`: fallback depois do ponteiro), `gates/dist/projeto.js`, `gates/test/projeto.test.ts`, `gates/test/painel-cli.test.mjs`, `docs/superpowers/specs/2026-11-19-gm16-painel-projeto-design.md` (emenda inline em REQ-PRJ-1 (c), l.39).

- [ ] **Step 0:** `git grep -n "sem plano"` em `gates/src`, `gates/test`, `mod/`, `reference/`: todo texto que muda está nesta lista ou vira emenda.
- [ ] **Step 1 (vermelho):** `plano-legado-por-padrao`, `plano-antigo-sem-task-rotulado`, `plano-legado-padrao-seguro`, e 1 caso pelo CLI.
- [ ] **Step 2:** ordem json > ponteiro > padrão; `..`, absoluto, `**` e `*` em pasta ignorados com aviso; ambíguo não liga; `{PBI}` com fronteira de dígito.
- [ ] **Step 3:** ML1-a, b, ML2-a, b, ML3-a a c. `plano-md-nao-casa` segue verde sem edição.
- [ ] **Step 4:** build; testes verdes; emenda GM-16 `_(Emenda 2026-11-24, GM-20 DT4 — …)_`. **Commit** `fix(GM-20): painel reconhece plano no formato anterior`.

### Task 4: Uma linha de previsão

**tipo:** Bug. **Depende de:** T2. **Onda C.** **serial: contenda** (`painel-esquadrao.ts`). **Fecha:** REQ-PRV-1. **Aceite:** `spec:200-204`; DT13 `spec:79`.

**Files:** Modify `gates/src/painel-esquadrao.ts` (`:421-427`), `gates/dist/painel-esquadrao.js`, `gates/test/painel-projeto.test.ts` (`:118-121`, `:135`), `gates/test/painel-esquadrao.test.ts`.

- [ ] **Step 1 (vermelho):** `uma-linha-de-previsao`; ajustar `doProjeto` e `nLinhasProjeto` (fixture GM-15: de 9 para 8 linhas, conferir). Estender `render-projeto-propriedade-larguras` (`painel-projeto.test.ts`) com a previsão em 1 linha (hora nunca cortada).
- [ ] **Step 2:** 1 linha com variantes; sem estimada, o texto de hoje; abaixo de 72 colunas nada muda.
- [ ] **Step 3:** MV1-a, MV1-b.
- [ ] **Step 4:** build; testes verdes. **Commit** `fix(GM-20): uma linha de previsão no projeto`.

### Task 5: Separadores com o projeto na tela

**tipo:** Bug. **Depende de:** T4. **Onda D.** **serial: contenda** (`painel-esquadrao.ts`). **Fecha:** REQ-SEP-1. **Aceite:** `spec:208-211`; DT14 `spec:80`; M15 `spec:38`.

**Files:** Modify `gates/src/painel-esquadrao.ts` (`:1175-1190`), `gates/dist/painel-esquadrao.js`, `gates/test/painel-altura.test.ts`.

- [ ] **Step 0:** reproduzir 0 separadores com a fixture, 80 colunas, lateral 25 linhas, e com `local` acima (orçamento como `mod/painel.mjs:448`).
- [ ] **Step 1 (vermelho):** `separadores-sobrevivem-ao-projeto` (lateral e acima).
- [ ] **Step 2:** separadores entram em `ls` com prioridade 6.93 antes do corte; `minima` intacta; `comProjetoAcima` intacto.
- [ ] **Step 3:** MS1-a, MS1-b. Testes de altura existentes verdes (o orçamento nunca estoura).
- [ ] **Step 4:** build. **Commit** `fix(GM-20): separadores reservados antes do corte`.

### Task 6: Encerramento pela base da entrega

**tipo:** Bug. **Depende de:** nada. **Onda A.** **Fecha:** REQ-CRD-2. **Aceite:** `spec:153-159`; DT6 `spec:72`.

**Files:** Modify `gates/scripts/painel-medir.mjs` (`:42`, `:346`, `:348`, `:356`, `:374`), `gates/test/painel-medir.test.mjs`.

- [ ] **Step 0:** `git grep -n "'main'" gates/scripts gates/src`: ponto de encerramento fora desta lista ⇒ emenda antes de editar.
- [ ] **Step 1 (vermelho):** `medir-encerra-pela-base-da-entrega` com gh falso: base `next` mergeado encerra; `main` com base `next` não; sem config, `main` como hoje; sem `mergedAt` descarta; base divergente origin × HEAD segue `resolverBaseEntrega`.
- [ ] **Step 2:** base por `lerBaseDaEntrega` (`lib/config.mjs`) + `resolverBaseEntrega`, lida 1 vez por execução.
- [ ] **Step 3:** MC2-a a c. **Commit** `fix(GM-20): entrega encerra pela base configurada`.

### Task 7: "Próxima" sem spec já superada

**tipo:** Bug. **Depende de:** nada. **Onda A.** **Fecha:** REQ-PRX-1. **Aceite:** `spec:215-219`; DT15 `spec:81`.

**Files:** Modify `gates/src/depende.ts` (`:183-191`), `gates/dist/depende.js`, `gates/test/depende.test.ts`.

- [ ] **Step 1 (vermelho):** `proxima-ignora-spec-antiga` com os 2 casos.
- [ ] **Step 2:** corte = maior `caminho` de spec com PBI em `encerradas`; candidatas só acima dele.
- [ ] **Step 3:** MX1-a, MX1-b. Build. **Commit** `fix(GM-20): próxima não aponta spec mais antiga que a última entregue`.
- [ ] **Step 4 (orquestrador, depois do integrar):** `node plugins/gabarito-mestre/gates/scripts/painel.mjs estado --entrega GM-19` neste repo: `proxima` sem `GM-12`.

### Task 8: Agente fantasma sai da EQUIPE

**tipo:** Bug. **Depende de:** T3. **Onda D.** **serial: contenda** (`painel.mjs`, `painel-equipe.ts`). **Fecha:** REQ-FAN-1, REQ-FAN-2, REQ-FAN-3. **Aceite:** `spec:163-176`; DT7 a DT9 `spec:73-75`.

**Files:** Modify `gates/src/painel-equipe.ts` (`:57-80`, `:450-457`, `:522-572`), `gates/scripts/painel.mjs` (união dos `custo.medicao` das entregas lidas, inclusive `_sem-id`; `mtime` do transcript em `agentesDe` `:423-439`), `gates/dist/painel-equipe.js`, `gates/test/painel-equipe.test.ts`, `gates/test/painel-cli.test.mjs`.

- [ ] **Step 0 (medições):** ler `mod/painel.mjs` e dizer se `vistoEm` é a 1ª vez visto ou a última ação (`spec:329`); tempo de `painel.mjs texto --agentes` neste repo antes da mudança (3 execuções, mediana).
- [ ] **Step 1 (vermelho):** `fantasma-handback-outra-entrega`, `fantasma-retomado-volta`, `fantasma-silencio-60-min`, `vivo-nao-casa-task-pendente`, e o caso CLI com a fixture do spike B refeita no teste (`repo-fantasma2` e `repo-fantasma`).
- [ ] **Step 2:** `idsEncerrados` recebe a união; retomada por `mtime` posterior ao hand-back; 60 min só com transcript legível; casamento só fora de `pendente`.
- [ ] **Step 3:** MF1-a, b, MF2-a a c, MF3-a.
- [ ] **Step 4:** build; tempo depois (mesma condição); aumento acima de 20 % vai ao relato. **Commit** `fix(GM-20): agente encerrado em outra entrega ou calado sai da equipe`.

### Task 9: Task executada pelo orquestrador

**tipo:** Bug. **Depende de:** T8. **Onda E.** **serial: contenda** (`painel-equipe.ts`). **Fecha:** REQ-EXE-1, REQ-EXE-2, REQ-EXE-3. **Aceite:** `spec:180-196`; DT10 a DT12 `spec:76-78`.

**Files:** Modify `gates/scripts/loop.mjs` (`:442-461`, `:2086-2100`, cabeçalho de uso `:14-46`), `gates/src/formas.ts` (`:584-594`), `gates/src/painel-equipe.ts` (cobertura em `resolverAtivos`, dono no PLANO), `gates/src/painel.ts` (`:1250-1251`), `gates/src/registro.ts` (`:118-125`), `gates/dist/formas.js`, `gates/dist/painel-equipe.js`, `gates/dist/painel.js`, `gates/dist/registro.js`, `gates/test/loop-cli-5.test.mjs`, `gates/test/formas.test.ts`, `gates/test/painel-equipe.test.ts`, `gates/test/registro.test.ts`, `skills/gabarito-loop/SKILL.md` (1 linha: quando usar, motivo obrigatório).

- [ ] **Step 0:** `git grep -n "iniciar" skills reference commands`: texto que descreve `iniciar` e precise do flag ⇒ na lista ou emenda. Conferir o teto de linhas da skill (`harness-doctor-loop.test.mjs:369`).
- [ ] **Step 1 (vermelho):** os 7 testes de `spec:180-196`.
- [ ] **Step 2:** 1 evento; recusas antes de gravar; "1 por vez" por entrega; ATENÇÃO troca o alerta pela linha de desvio; `registro.md` lista.
- [ ] **Step 3:** ME1-a a d, ME2-a, b, ME3-a. Prova de compatibilidade: diário com o evento novo lido pelo `dist` da base 0a5fda2e sem "estado inválido".
- [ ] **Step 4:** build; testes verdes. **Commit** `feat(GM-20): iniciar --executor orquestrador com motivo e desvio visível`.

### Task 10: Passo de adoção no --atualizar

**tipo:** US. **Depende de:** T3. **Onda D.** **serial: contenda** (`onboarding-herdar.mjs` e `onboarding-herdar.test.mjs` com T11). **Fecha:** REQ-ADO-1, REQ-ADO-2, REQ-ADO-3. **Aceite:** `spec:223-244`; DT16, DT17 `spec:82-83`. **Só com a P2 confirmada.**

**Files:** Modify `gates/scripts/onboarding-herdar.mjs`, `gates/scripts/onboarding.mjs` (`:23`, `:957-967`), `skills/gabarito-instalar/SKILL.md` (passo 6b), `commands/gabarito.md` (`:62`), `docs/virada-2.1.md` (`:43`), `reference/fluxo.md` (§4.3: `fluxo.planosLegados`, `fluxo.status.terminais`), `gates/test/loop-cli-3.test.mjs` (`:1518`), `gates/test/skills-shell.test.mjs` (`:436`), `gates/test/onboarding-skill.test.mjs`. Create `gates/test/onboarding-herdar.test.mjs`.

- [ ] **Step 0:** `foco` ainda é stub? (`spec:331`). `git grep -n "herdar"` fora de `docs/superpowers/specs`: cada citação da "herança da 1.x" está na lista ou vira emenda. Teto de linhas de `SKILL.md`, se houver teste.
- [ ] **Step 1 (vermelho):** `herdar-detecta-adocao`, `herdar-sem-adocao-nao-oferece`, `herdar-so-le`, `herdar-grava-so-2-chaves`, `herdar-dry-run-nao-grava`, `herdar-nao-escreve-card` (dono único do "herdar não escreve card": bytes, `mtime` e lista da pasta de cards iguais antes e depois de `herdar --gravar`; `spec:238`), `skill-instalar-passo-adocao`; mais 1 que prova a mesma contagem de `herdar` e do painel na fixture (P9).
- [ ] **Step 2:** `herdar` reusa `ehFeito`, `ehColunaFl1`, `ehTerminal` e `planoLegadoDe` do `dist/projeto.js`; `cardsDesatualizados` por `encerrada && !ehFeito` local, só lista (a T11 troca pelo `cardDesatualizado` exportado); `--gravar` pelo escritor do `gravar` (`onboarding.mjs:902`), só as 2 chaves; `--dry-run`; falha fechada.
- [ ] **Step 3:** MA1-a a c, MA2-a, b, MA3-a.
- [ ] **Step 4:** testes dos arquivos tocados + `bash scripts/test/texto.test.sh` verdes. **Commit** `feat(GM-20): passo de adoção no gabarito-instalar --atualizar`.

### Task 11: Card desatualizado (painel trata e avisa, sem escrever no card)

**tipo:** Bug. **Depende de:** T5, T10. **Onda F.** **serial: contenda** (`projeto.ts`, `painel-esquadrao.ts`, `onboarding-herdar.mjs`, `painel-projeto.test.ts`, `onboarding-herdar.test.mjs`). **Fecha:** REQ-CRD-1. **Aceite:** `spec:144-151`; D-G43 e D-G46 `spec:61-62`; M10 `spec:33`.

**Files:** Modify `gates/src/projeto.ts` (`cardDesatualizado(card, eventos, statusFl1)` exportado, ao lado de `encerrada` `:184-188`; uso em `:276`; campo `cardDesatualizado` na `LinhaProjeto`; aviso em `avisos`), `gates/src/painel-esquadrao.ts` (sufixo `(card desatualizado)` na linha de PBI feito, 1º a ser cortado), `gates/dist/projeto.js`, `gates/dist/painel-esquadrao.js`, `gates/scripts/onboarding-herdar.mjs` (troca o detector local pelo exportado), `gates/test/projeto.test.ts`, `gates/test/painel-projeto.test.ts`, `gates/test/onboarding-herdar.test.mjs`. Create `gates/test/card-desatualizado.test.mjs` (cláusula negativa pelo CLI; arquivo próprio porque `painel-cli.test.mjs` é da T8, que não é ancestral da T11, e o `validarPlano` recusa). Nenhum arquivo de card na lista: a task não escreve card.

- [ ] **Step 0:** com a fixture comum, confirmar que PBI-7 já conta feito hoje (M10) e que não há aviso; `git grep -n "writeFile\|appendFile\|renameSync" gates/scripts gates/src` e anotar todo caminho de escrita que receba caminho de card (esperado: nenhum).
- [ ] **Step 1 (vermelho):**
  - `card-desatualizado-conta-feito-e-avisa` (`projeto.test.ts`): PBI-7 `feito: true`, `cardDesatualizado: "Em execução"`, `avisos` contém `PBI-7: card "Em execução" desatualizado (entrega encerrada)`; PBI-8 sem aviso e não feito; card "Concluído" + encerrada sem aviso; sem card sem aviso.
  - `card-desatualizado-reaberta-nao-avisa` (`projeto.test.ts`, fixture local): `entrega.reaberta` depois da encerrada ⇒ nem feito nem aviso.
  - `card-desatualizado-render` (`painel-projeto.test.ts`): 100 colunas mostra `(card desatualizado)` na linha de PBI-7; na largura mínima o sufixo sai antes do id. Estender `render-projeto-propriedade-larguras` (mesmo arquivo) com o sufixo.
  - `card-desatualizado-nunca-escreve-card` (`card-desatualizado.test.mjs`, **cláusula negativa**): monta a fixture em disco, lê `readFileSync` + `statSync().mtimeMs` do arquivo do card de PBI-7 (e a lista de arquivos da pasta de cards) **antes**; roda `painel.mjs estado` e `painel.mjs texto`; lê de novo **depois** e afirma bytes, `mtime` e lista iguais. O lado `herdar --gravar` é de `herdar-nao-escreve-card` (T10, `onboarding-herdar.test.mjs`), que tem de seguir verde.
  - `herdar-e-painel-mesma-contagem-desatualizados` (`onboarding-herdar.test.mjs`, P9): `cardsDesatualizados` do `herdar` = ids com `cardDesatualizado` no painel.
- [ ] **Step 2:** `cardDesatualizado` exportado; `projetarProjeto` preenche o campo e o aviso; render com o sufixo cortável; `herdar` importa do `dist/projeto.js`.
- [ ] **Step 3:** MC1-a (tirar o aviso), MC1-b (só `!ehFeito`, sem `encerrada` ⇒ PBI-8 avisa), MC1-c (ignorar `entrega.reaberta`), MC1-d (inserir `writeFileSync` no caminho do card dentro de `painel.mjs` ou do `herdar --gravar`), uma por vez, cada uma derrubada; MC1-d em `painel.mjs` cai pela cláusula negativa, no `herdar --gravar` cai por `herdar-nao-escreve-card` (T10).
- [ ] **Step 4:** `npm run build`; testes dos arquivos tocados verdes. **Commit** `fix(GM-20): painel avisa card desatualizado sem escrever no card`.

### Task 12: Versão 2.3.0 e CHANGELOG

**tipo:** Tarefa. **Depende de:** T1 a T11. **Onda G.** **serial: contenda** (`CHANGELOG.md`, `plugin.json`, `package.json`, `docs/backlog.md`). **Fecha:** REQ-VRS-1. **Aceite:** `spec:248-250`; texto `spec:274-298`.

**Files:** Modify `.claude-plugin/plugin.json`, `gates/package.json`, `gates/test/package.test.mjs` (`:49-50`), `scripts/test/texto.test.sh` (`:279`, `:295`: `2.3.0` acima de `2.2.2`), `CHANGELOG.md` (`[2.3.0]` com a data do dia, o "Limites declarados" do item 4 conforme D-G46: o plugin não atualiza o card), `docs/backlog.md` (linhas de "Fora de escopo" da spec que ainda não estão lá; a linha `:69` marcada resolvida pela T10).

- [ ] **Step 1:** versões, testes de versão e CHANGELOG.
- [ ] **Step 2:** `git grep -n "2\.2\.2" -- ':!*.md' ':!.harness'` só acha a checagem de ordem do CHANGELOG.
- [ ] **Step 3:** MR1-a (versão só no `plugin.json`) derrubada por `package.test.mjs` e `texto.test.sh`.
- [ ] **Step 4:** `node --test test/package.test.mjs` e `bash scripts/test/texto.test.sh` verdes. **Commit** `chore(GM-20): versão 2.3.0 e CHANGELOG`.

---

## Depois das tasks (orquestrador, não é task)

- Fumaça do painel deste repo com o diário real inteiro, cabeçalho inteiro conferido (processo, "Fumaça de correção de painel").
- PR para `next` ao integrar o último código (P12). Com a T6, o merge desse PR encerra a GM-20 (base `next`).
- Gravar números e aprendizados em `docs/aprendizados/processo-orquestrador.md` (P7).
- `next ⇒ main`, tag e release 2.3.0 só por ordem do dono. Depois, `claude plugin update --scope` nos escopos locais.

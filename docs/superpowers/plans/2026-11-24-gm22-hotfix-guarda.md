# GM-22 Hotfix da guarda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O loop é o `gabarito-loop` sobre `.harness/entregas/GM-22/plano.json` (rascunho em `.claude-tmp/gm22-plano-rascunho.json`, 5 tasks).

PBI: GM-22 (Bug, segurança) · Epic: não vinculado · Iniciativa: não vinculado (D-G39, regra da GM-19 herdada pelo orquestrador; `spec:3`).

**Goal:** a autonomia cala só publicar, e só com a resposta `publica`; hooks do git e push sem hooks entram no anel de integridade. Versão 2.3.1 (D-G51, D-G52).

**Architecture:** núcleo puro da guarda (`gates/src/aneis.ts`, `classificar-alvo.ts`, `decidir.ts`, `tipos.ts`), borda (`gates/src/guarda.ts`, o hook real `gates/dist/guarda.js`), onboarding (`gates/scripts/onboarding.mjs`) e docs. `gates/dist/*.js` é gerado por `npm run build`.

**Tech Stack:** TypeScript com `--experimental-strip-types`, `node --test` (Node ≥ 22.18), bash. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-24-gm22-hotfix-guarda-design.md` (r1, não aprovada). Decisões do dono: D-G51, D-G52 (`spec:47-48`).

## Pré-condições (antes da 1ª linha de código)

- Spec aprovada pelo dono. Sombra confirma a DT2 (`spec:52`, P1 `spec:196`) antes da T3.
- Orquestrador na branch `hotfix/GM-22-guarda-autonomia` (base `main` 607c20d8, plugin 2.3.0) antes do `abrir` (processo, "Orquestrador na branch da entrega").
- S6 rodado na base antes do 1º `integrar`. Vermelho fora da task ⇒ `descoberta` e `integrar` com `S6_REPOS_DIR` vazio (processo, "Golden S6").

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `.claude-tmp/`, `README.md` e `CHANGELOG.md`. Testes rodam de `gates/`.
- **`gates/dist/*` é build de `gates/src/*`:** toda task que muda `src/X.ts` roda `npm run build` e commita `dist/X.js` junto. `dist em dia` na CI confere.
- **Nada do projeto consumidor no plugin** (D-G51, como D-G41): fixtures com `db.prod.exemplo.com`, `api.terceiro.exemplo`, `mcp__banco_prod__`; nenhum nome, host ou caminho de lá.
- **Nenhuma mudança amplia o silêncio:** toda decisão nova é `ask`/`deny` onde era `silencio`, salvo nenhuma. Revisor confere com a tabela da spec (`spec:70-81`).
- **Teste pelo hook real (P9):** T1 pelo e2e do corpus (`hooks/test/guarda-corpus-e2e.test.mjs`, `node gates/dist/guarda.js`); T3 por `gates/test/autonomia-processo.test.mjs` (`rodar()` de `_adaptador-helpers.mjs`, `HOME` tmp, config em `origin/HEAD`). O `$HOME` real nunca entra.
- TMPDIR de teste em `$(getconf DARWIN_USER_TEMP_DIR)`, nunca em `.claude-tmp/` (processo, "TMPDIR fora do repositório").
- **P16:** implementador roda só os testes dos arquivos tocados + `npm run build -- --check` + `bash scripts/test/texto.test.sh`. Suíte inteira só no `integrar`. Revisor não roda a suíte inteira.
- **P15:** cada campo produzido (`publicar`, `faixa`, `evento.tipo`, `evento.dados`, `motivo`, `anel`, `alvo`) tem asserção que o lê; cada cláusula negativa ("subagente não muda", "segredo não muda", "sem autonomia nada muda", "leitura livre", "rótulos iguais") tem teste com troca de valor.
- **"Antes do commit" item 4 (vizinhos):** caixa, relativo e absoluto, worktree e principal, flag antes e depois do refspec, texto de mensagem que cita a flag.
- **P8:** ninguém usa `env`, `printenv`, `set` nem dump de variável. Ninguém lê `.env`. O interruptor real (`~/.claude/…`) nunca é lido nem escrito: só o do `HOME` tmp.
- Documento se grava por Write/Edit, nunca por heredoc (processo, "Brief de redator").
- Commits `tipo(GM-22): …` com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `git add` por caminho, sem `git stash`, sem push.

## Mapa REQ → task

| REQ | Task | Spec |
|---|---|---|
| REQ-HKS-1, REQ-HKS-2 | T1 | `spec:85-96`; DT4, DT5 `spec:54-55` |
| REQ-PUB-1 | T2 | `spec:100-105`; DT1 `spec:51` |
| REQ-PUB-2, REQ-PUB-3 (guarda) | T3 | `spec:66-81`, `:107-118`; DT2, DT3, DT6 a DT8 `spec:52-58` |
| REQ-PUB-3 (compat do onboarding), REQ-TXT-1 | T4 | `spec:117`, `:122-127` |
| REQ-VRS-1 | T5 | `spec:131-134`; texto `spec:150-170` |

## Grafo

Em 1 linha: `{T1,T2}→T3; T4 livre; tudo→T5`.

| Onda | Task (dependências) | Observação |
|---|---|---|
| A | T1 (—), T2 (—), T4 (—) | arquivos disjuntos |
| B | T3 (T1, T2) | a tabela de decisão usa os anéis da T1 e o campo `publicar` da T2 |
| C | T5 (T1 a T4) | versão e CHANGELOG |

- **serial: contenda (R21):** nenhum arquivo é tocado por 2 tasks sem dependência. `README.md` só T4; `CHANGELOG.md` e manifestos só T5; `gates/src/tipos.ts` só T2.
- **Serial (recurso compartilhado):** a máquina. 1 `integrar` por vez (P17b).
- **Incógnita externa:** não há Task 0. A abreviação `--no-veri` (`spec:197`) é passo 0 da T1.

**Gate de fase (contagem):**
- T1 = 6 testes novos + 16 casos novos no corpus (8 orq + 8 sub) com `TOTAL_CORPUS` + 16 + 7 mutações mortas (MH1-a a c, MH2-a a d).
- T2 = 1 teste (≥ 5 positivos, ≥ 12 negativos, 1 misto) + 4 mutações (MP1-a a d).
- T3 = tabela (10 categorias × 3 níveis × 2 papéis) + 3 testes de nível + 6 casos de processo real + 3 de motivo + 3 arquivos reescritos + 8 mutações (MP2-a a f, MP3-a, b) + contagem de `guarda.autonomia_usada` do diário deste repo por `anel`/`alvo` no relato.
- T4 = 3 testes (`onboarding-pergunta-autonomia-diz-o-que-cala`, `rotulos-autonomia-iguais`, `config-222-segue-valida`) + ajustes de texto + 3 mutações (MP3-c, MT1-a, b) + `trocar.md` e `README.md` coerentes.
- T5 = 2 versões + `[2.3.1]` + testes de versão verdes + 1 mutação + backlog com as linhas de "Fora de escopo".
- **Entrega completa** = 5 tasks + fumaça `medir.mts` com a tabela inteira conferida + CI verde no PR para `main`.

**Estimativa (hipótese, não meta):** (M, calculado) 5 tasks de 30 a 60 min de implementação cada, mais review e `integrar`, em 3 ondas com até 3 frentes. A faixa vai ao dono pelo painel, com o ritmo medido depois da 1ª task.

**Modelo:** Opus 5.5 em T1, T2, T3 (guarda: contrato de falha; P1 pede Sombra antes do despacho de T3); Sonnet em T4 e T5. Review: Opus 5.5, instância nova; review final da entrega: Fable.

---

### Task 1: Hooks do git e push sem hooks no anel de integridade

**tipo:** Bug. **Depende de:** nada. **Onda A.** **Fecha:** REQ-HKS-1, REQ-HKS-2. **Aceite (Dado/Quando/Então):** `spec:85-96`; DT4, DT5 `spec:54-55`; M6 a M10 `spec:30-34`.

**Files:** Modify `gates/src/aneis.ts` (`AREAS_DIR` `:490`; ramo `push` `:815-817`; atribuições `GIT_CONFIG_*` no segmento `git`, junto de `:806`), `gates/dist/aneis.js`, `hooks/test/corpus/guarda-integridade.jsonl`, `gates/test/corpus-guarda.test.ts` (`TOTAL_CORPUS` `:23`). Create `gates/test/anel-hooks-git.test.ts`.

- [ ] **Step 0:** em repo tmp (`$(getconf DARWIN_USER_TEMP_DIR)`, bare local como remoto, hook `pre-push` que sai 1), medir se `git push --no-veri` e `--no-verif` pulam o hook e se `--no-ve` é recusado. Anotar no relato; a regra de prefixo `--no-veri` fica igual em qualquer resultado (fail-closed). `git grep -n "AREAS_DIR\|\.githooks\|\.husky"` em `gates/src`, `gates/scripts`, `hooks`, `reference`: todo uso listado.
- [ ] **Step 1 (vermelho):** em `anel-hooks-git.test.ts`: `anel-githooks-escrita-pede` (Edit, Write, NotebookEdit; relativo, absoluto, worktree, `.GitHooks`; `.husky/pre-push`), `anel-githooks-bash-pede` (`echo >`, `rm -rf .githooks`, `chmod -x .husky/pre-push`, `cp a .githooks/pre-push`), `anel-githooks-leitura-livre` (Read e `cat`: sem anel), `push-sem-hooks-pede` (`--no-verify` antes e depois do refspec, `--no-veri`; orq `ask`, sub `deny`, `anel: 'integridade'`, `alvo: '.git/hooks'`), `push-sem-hooks-por-variavel-pede` (`GIT_CONFIG_COUNT/KEY_0/VALUE_0` no push, `GIT_CONFIG_PARAMETERS` no commit), `push-comum-segue-livre` (`git push origin feat/x`, `--verbose`, `git commit -m "--no-verify"`, `git log --grep=no-verify`, `GIT_CONFIG_GLOBAL=/dev/null git status`: sem anel, faixa igual à de hoje). Cada teste afirma `faixa`, `anel` e `alvo` (P15). 16 casos no corpus (`req: "GRD-5"`, orq `ask` e sub `deny`), que o e2e roda pelo hook real.
- [ ] **Step 2:** `.githooks` e `.husky` em `AREAS_DIR`; no ramo `push`, token com prefixo `--no-veri` ⇒ integridade `.git/hooks` para os 2 papéis; atribuição `GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+` em segmento `git` ⇒ integridade `.git/config`. `TOTAL_CORPUS` + 16.
- [ ] **Step 3:** MH1-a (tirar `.githooks`), MH1-b (tirar `.husky`), MH1-c (caixa exata), MH2-a (`--no-verify` exato), MH2-b (só orquestrador), MH2-c (sem a regra das variáveis), MH2-d (procurar no `cru`), uma por vez, cada uma derrubada (nome do teste que caiu no relato).
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/anel-hooks-git.test.ts test/corpus-guarda.test.ts test/autonomia-refs.test.ts` e `node --test ../hooks/test/guarda-corpus-e2e.test.mjs` verdes. **Commit** `fix(GM-22): hooks do git e push sem hooks no anel de integridade`.

### Task 2: O classificador marca "publicar"

**tipo:** Bug. **Depende de:** nada. **Onda A.** **Fecha:** REQ-PUB-1. **Aceite:** `spec:100-105`; DT1 `spec:51`; M11, M12 `spec:35-36`.

**Files:** Modify `gates/src/tipos.ts` (`Classificacao.publicar: boolean`, `:98-108`), `gates/src/classificar-alvo.ts` (`Parcial` `:33`, `nada()` `:245`, `vercel` `:293-303`, `git push` `:318-351`, `gh pr merge` `:352-360`, agregação `:415-423`, `NEUTRO` `:35`, `classificarMcp` `:438-456`, `classificarCaminho`), `gates/dist/classificar-alvo.js`. Create `gates/test/classificar-publicar.test.ts`.

- [ ] **Step 0:** `git grep -n "segmentosProd\|Classificacao = \|: Classificacao"` em `gates/src`, `gates/scripts`, `gates/test`, `mod/`: todo construtor de `Classificacao` recebe `publicar` (o tipo obriga; `npm run build -- --check` e os testes `.ts` acusam).
- [ ] **Step 1 (vermelho):** `classificar-publicar-formas`: positivos `git push origin main`, `git push -u origin main`, `git push` com branch atual `main`, `gh pr merge 5` com branch atual `main`, `vercel --prod`, `vercel deploy --prod`, `vercel promote x`, `vc --prod` ⇒ `publicar: true`, `ambiente: 'prod'`, `segmentosProd.length === 1`. Negativos (`publicar: false`): `--force`, `+main`, `:main`, `--delete`, `--all`, `-o x`, remoto `outro`, `vercel env pull --prod`, `vercel logs --prod`, `supabase db push --project-ref <prod>`, `psql -h db.prod.exemplo.com -c "select 1"`, MCP `mcp__banco_prod__execute_sql`, `git push origin feat/x` (não prod), Edit de arquivo. Misto `git push origin main && psql -h db.prod.exemplo.com -c "select 1"` ⇒ `false`.
- [ ] **Step 2:** `publicar` por `Parcial` só nas 3 formas de DT1 (allowlist de flags do push; remoto `origin` ou omitido; refspec sem `+` nem `:` inicial; `vercel` com subcomando ausente, `deploy`, `redeploy`, `promote`, `rollback`); `Classificacao.publicar` = há segmento prod e todo segmento prod tem `publicar`; anel ⇒ `false`. Nenhuma outra saída do classificador muda (os testes de `classificar` existentes seguem verdes sem edição).
- [ ] **Step 3:** MP1-a a d, uma por vez, cada uma derrubada.
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/classificar-publicar.test.ts test/prod-leitura.test.ts test/corpus-guarda.test.ts` verdes. **Commit** `fix(GM-22): classificador marca o segmento de publicar`.

### Task 3: A autonomia cala só publicar, e só com `publica`

**tipo:** Bug. **Depende de:** T1, T2. **Onda B.** **Fecha:** REQ-PUB-2, REQ-PUB-3 (lado da guarda). **Aceite:** tabela `spec:66-81`; `spec:107-118`; DT2, DT3, DT6, DT7, DT8 `spec:52-58`. **Só com a P1 confirmada.**

**Files:** Modify `gates/src/decidir.ts` (`:98-114`: `nivel`, regra de publicar, sufixo do motivo), `gates/src/guarda.ts` (`type Guarda` `:33`; `lerGuarda` `:110-128`: `entregaAutonomia` de `origin/HEAD`; `:671`: nível), `gates/dist/decidir.js`, `gates/dist/guarda.js`, `gates/test/autonomia-guarda.test.ts`, `gates/test/autonomia-refs.test.ts`, `gates/test/autonomia-processo.test.mjs`. Create `gates/test/autonomia-tabela.test.ts`.

- [ ] **Step 0:** `git grep -n "decidir(.*true)\|autonomia === true\|lerAutonomia"` em `gates/src`, `gates/scripts`, `gates/test`, `mod/`: todo chamador listado. Ler `harness-doctor.mjs:1381-1420` e confirmar que o doctor não chama `decidir` (as 4 chaves e o descompasso seguem iguais). Contar no diário deste repo (`.harness/entregas/*/events.*.jsonl`, só leitura, `jq`/`grep -c`) os `guarda.autonomia_usada` por `anel`/`alvo`: número no relato (`spec:198`).
- [ ] **Step 1 (vermelho):** em `autonomia-tabela.test.ts`: `tabela-decisao-autonomia` (uma linha por categoria da spec, cada uma com 2 a 4 exemplos e vizinhos; 3 níveis × 2 papéis; afirma `faixa`, `permissionDecision`, `evento.tipo` e, em publicar com `publica`, `Object.keys(evento.dados)` = `['acao','alvo','ambiente']` sem o comando); `autonomia-so-publica-cala`; `autonomia-trabalha-nao-cala-publicar`; `autonomia-publica-nao-cala-terceiro-delete-integridade` (troca de valor: decisão com `publica` = decisão com `nenhuma` em toda linha que não é publicar; subagente igual nos 3 níveis); `motivo-avisa-com-autonomia`, `motivo-igual-sem-autonomia` (byte a byte o de hoje), `motivo-subagente-igual`. Em `autonomia-processo.test.mjs` (hook real): `publica-push-main-passa-e-grava-evento`; `publica-terceiro-delete-integridade-hooks-pedem` (Write `harness.config.json`, `git push --no-verify origin main`, Edit `.githooks/pre-push`, `psql -h db.prod.exemplo.com -c "DELETE FROM t"`, `curl https://api.terceiro.exemplo/x`, MCP prod); `entrega-autonomia-so-da-origem` (`true` só na árvore local ⇒ `ask`); `sem-interruptor-pede`; `subagente-nega-com-publica`. Reescrever os testes de `autonomia-guarda.test.ts`, `autonomia-refs.test.ts` e `autonomia-processo.test.mjs` que esperam `silencio` em integridade ou no interruptor para `ask`; nenhum teste apagado sem caso equivalente (lista no relato).
- [ ] **Step 2:** `type NivelAutonomia = 'nenhuma' | 'trabalha' | 'publica'`; `decidir(…, nivel = 'nenhuma')` cala só `ask` com `classificacao.publicar && !destrutivo && anel === null && nivel === 'publica'` (teto e `cd` perdido seguem `ask`); com nível ≠ `nenhuma`, `ask` ao orquestrador ganha o sufixo literal de `spec:115`; `lerGuarda` devolve `entregaAutonomia` (`origin/HEAD`, `entrega.autonomia === true`; árvore local nunca); `principal` monta o nível com config E interruptor. Comentário de `decidir.ts:98-106` reescrito (D-G52, DT6).
- [ ] **Step 3:** MP2-a a f, MP3-a, MP3-b, uma por vez, cada uma derrubada.
- [ ] **Step 4:** `npm run build`; `node --experimental-strip-types --test test/autonomia-tabela.test.ts test/autonomia-guarda.test.ts test/autonomia-refs.test.ts test/corpus-guarda.test.ts test/robustez-guarda.test.ts test/prod-leitura.test.ts` e `node --test test/autonomia-processo.test.mjs test/guarda-adaptador.test.mjs ../hooks/test/guarda-corpus-e2e.test.mjs` verdes. **Commit** `fix(GM-22): autonomia cala só publicar, e só com a resposta publica`.

### Task 4: Texto do onboarding e documentação

**tipo:** Bug. **Depende de:** nada. **Onda A.** **Fecha:** REQ-TXT-1, REQ-PUB-3 (compat do onboarding). **Aceite:** `spec:117`, `:122-127`; DT2, DT6, DT7 `spec:52-57`.

**Files:** Modify `gates/scripts/onboarding.mjs` (`:656-670` texto da pergunta; `:762` nome da prévia), `gates/test/onboarding.test.mjs` (`:810`, `:1110-1117`, `:1801`, e os 3 testes novos), `gates/test/onboarding-texto.test.mjs` (`:396`), `skills/gabarito-instalar/trocar.md` (`:19`), `README.md` (`:194-200`).

- [ ] **Step 0:** `git grep -n "autonomia em produção\|Posso trabalhar e publicar"` em todo o repo fora de `docs/superpowers` e `CHANGELOG.md`: cada ocorrência está nesta lista ou vira emenda. Teto de linhas ou colunas da pergunta, se algum teste fixar (`onboarding-skill.test.mjs`, `skills-shell.test.mjs`).
- [ ] **Step 1 (vermelho):** `onboarding-pergunta-autonomia-diz-o-que-cala` (texto inteiro de `spec:123`, variante normal e mista); `rotulos-autonomia-iguais` (os 3 `rotulo` e `valor` byte a byte os de hoje, cláusula negativa); `config-222-segue-valida` (`perguntas()` sobre as 3 configs de `CHAVES_AUTONOMIA` devolve `default` `espera`/`trabalha`/`publica` sem `mista`; `CHAVES_AUTONOMIA` `deepEqual` ao de hoje); ajustes de `autonomia em produção` ⇒ `autonomia para publicar` nos testes listados.
- [ ] **Step 2:** texto da pergunta e nome da prévia; `trocar.md:19` com a regra nova (o que cada resposta cala; interruptor pede sempre); `README.md:194-200` com a tabela resumida da spec e sem "com a autonomia ligada o orquestrador passa no interruptor".
- [ ] **Step 3:** MP3-c, MT1-a, MT1-b, uma por vez, cada uma derrubada.
- [ ] **Step 4:** `node --test test/onboarding.test.mjs test/onboarding-texto.test.mjs test/onboarding-skill.test.mjs test/skills-shell.test.mjs` e `bash scripts/test/texto.test.sh` verdes. **Commit** `fix(GM-22): onboarding diz o que a autonomia cala`.

### Task 5: Versão 2.3.1 e CHANGELOG

**tipo:** Tarefa. **Depende de:** T1 a T4. **Onda C.** **Fecha:** REQ-VRS-1. **Aceite:** `spec:131-134`; texto `spec:150-170`.

**Files:** Modify `.claude-plugin/plugin.json`, `gates/package.json`, `gates/test/package.test.mjs` (`:49-50`), `scripts/test/texto.test.sh` (`:279`; `:295` e `:296`: `[2.3.1]` acima de `[2.3.0]` e trecho `[2.3.1]`→`[2.3.0]`), `CHANGELOG.md` (`[2.3.1]` com a data do dia, texto de `spec:153-169`), `docs/backlog.md` (linhas de "Fora de escopo" da spec, `spec:183-192`, que ainda não estão lá).

- [ ] **Step 1:** versões, testes de versão e CHANGELOG.
- [ ] **Step 2:** `git grep -n "2\.3\.0" -- ':!*.md' ':!.harness'` só acha as checagens do CHANGELOG `[2.3.0]` (`texto.test.sh:295`, `:296`) e as ocorrências alheias de `painel-medir.test.mjs`.
- [ ] **Step 3:** MV1-a (versão só no `plugin.json`) derrubada por `package.test.mjs` e `texto.test.sh`.
- [ ] **Step 4:** `node --test test/package.test.mjs` e `bash scripts/test/texto.test.sh` verdes. **Commit** `chore(GM-22): versão 2.3.1 e CHANGELOG`.

---

## Depois das tasks (orquestrador, não é task)

- Fumaça: `node --experimental-strip-types .claude-tmp/gm22/medir.mts` contra a branch com o código novo (ajustar a chamada para `nivel`), tabela inteira conferida contra `spec:70-81`; saída no PR.
- PR `hotfix/GM-22-guarda-autonomia ⇒ main` ao integrar o último código (P12). Merge, tag `gabarito-mestre--v2.3.1` e release só por ordem do dono (D-G51, R1). O repo tem `delete_branch_on_merge=true`.
- Depois da release: sincronizar `next` com `main` (merge de `main` em `next`); a GM-20 já está em `main`, sem emenda do teste de ordem. `claude plugin update --scope` nos escopos locais.
- Gravar números e aprendizados em `docs/aprendizados/processo-orquestrador.md` (P7).

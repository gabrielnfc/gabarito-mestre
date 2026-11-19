# GM-16 Painel de projeto num repositório grande (2.2.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. O loop é o `gabarito-loop` sobre `.harness/entregas/GM-16/plano.json` (validado por `validarPlano`: 9 tasks).

**Goal:** A visão de projeto conta as tasks de planos com `## Task N —`, recolhe os PBIs feitos em 1 linha, agrupa os abertos por Epic quando ajuda e trata como opção o card com status fora do quadro FL1; o doctor avisa quando quadro e git discordam. Nada muda para quem tem repositório pequeno.

**Architecture:** Tudo no núcleo puro `gates/src/projeto.ts` (T1 → T2 → T3, mesmo arquivo, em série), depois o render `painel-esquadrao.ts` e a borda `scripts/painel.mjs` (T4). O doctor (T5) importa do `dist/` o predicado de coluna FL1 da T2, nunca uma cópia. Aceite pelo adaptador real (T6), texto de referência (T7) e virada (T8).

**Tech Stack:** Node ≥ 22.18 sem dependências, TypeScript com strip-types e `dist/` commitado (`node scripts/build.mjs`; `build.mjs --check` sai 0), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-gm16-painel-projeto-design.md` (r1). **Decisões do dono:** `2026-11-19-gm16-decisoes-dono.md` (D-G22). Pendências P1–P4 da spec não bloqueiam T1–T5; P4 bloqueia a T0 (ok nominal para ler o repositório consumidor).

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `CHANGELOG.md`, `.claude-plugin/` e `.superpowers/` da raiz. Testes rodam de `gates/`. Nenhum módulo novo em `MODULOS`; nenhuma dependência nova.
- **Repositório público.** Nenhuma fixture, teste, commit, relatório versionado ou aprendizado leva nome, ID, caminho, status literal ou texto do repositório consumidor de referência. Fixture da T6 é **sintética**, gerada por código no teste, com a forma medida (números) da T0. O relatório da T0 fica em `.superpowers/` (fora do git) e só com números.
- **Sem config nova obrigatória** e sem mudar o `harness.config.json` deste repo. Repositório que hoje desenha N linhas com até 5 PBIs abertos e nenhum feito desenha as mesmas N (teste de regressão na T4 sobre `test/fixtures/projeto/`).
- **CHANGELOG só na T8.** `scripts/test/texto.test.sh:280` reprova `## [Unreleased]`; nenhuma task antes da T8 toca `CHANGELOG.md`.
- Testes nunca gravam no `.harness/` real: raiz em `mkdtemp`; fixture com git define `user.name`/`user.email` (aprendizado 149); relógio só por parâmetro.
- Ausente × corrompido distintos em cada leitura nova (pasta FL1, pasta FL2, log do git). Leitura ilegível vira "?" ou "não conferido", nunca "ok" nem 0.
- Commits `tipo(GM-16): …` terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `git add` por caminho, sem `git stash`, sem push.
- Implementador muta **cada** condição da regra nova e entrega teste que mata cada mutação (aprendizado GM-15 seq 356); só commita arquivos da lista da task (aprendizado 616); `git grep` de todo leitor de `tasksDoPlanoMd`, `cardDe` e `projetarProjeto` antes de mudar assinatura (aprendizado 151).

## Review Focus

1. Plano `.md` com `## Task 1 —` e bloco cercado com `### Task 9:` dentro: conta só T1 → T1.
2. Config Jira (`concluido: "Done"`) com card "Concluído" e card "Done": os dois feitos; card "Backlog": opção → T2.
3. Card de opção com diário de task: segue linha → T2; doctor avisa → T5.
4. Largura 71 e 72 com 0, 1 e 2 Epics: teto de linhas e número nunca cortado → T4.
5. `PBI-5` aberto e commit `feat(PBI-50): …` na `main`: sem aviso → T5.

## Mapa REQ → task

| REQ | Tasks |
|---|---|
| REQ-PRJ-1 (cabeçalhos do plano `.md`) | T0 (S1), T1, T6 |
| REQ-PRJ-2 (status fora do quadro é opção) | T0 (S2), T2, T4, T6, T7 |
| REQ-PRJ-3 (feitos recolhidos, Epic) | T0 (S2), T3, T4, T6 |
| REQ-DCT-1 (avisos do doctor) | T0 (S2), T5, T6, T7 |

## Grafo

| Onda | Tasks (dependências) | Observação |
|---|---|---|
| A | **T0** (—) | spike sem suíte; precisa do ok P4 |
| B | T1 (T0) | `projeto.ts` |
| C | T2 (T1) | `projeto.ts` |
| D | T3 (T2), T5 (T2) | arquivos disjuntos: podem correr juntas |
| E | T4 (T3) | |
| F | T6 (T4, T5), T7 (T4, T5) | arquivos disjuntos |
| G | T8 (todas) | virada; tag, release e `next ⇒ main` são do dono |

**Caminho crítico:** T0 → T1 → T2 → T3 → T4 → T6 → T8 (7 ondas). **Séries por arquivo:** `projeto.ts`/`dist/projeto.js`/`projeto.test.ts` T1 → T2 → T3 (o `plano.json` impõe por dependência; `validarPlano` ok).

**Modelo:** Opus 5.5 em T0, T2, T5 (regra de status, git e doctor). Sonnet 5.5 `high` em T1, T3, T4, T6. Haiku 5.5 em T7, T8. Review de task: Opus 5.5, instância nova.

**Estimativa (hipótese, não meta; base GM-15 ~26 min/task de relógio):** 8 tasks de código × 26 min ≈ 3,5 h de agente; 7 ondas ⇒ **3 a 5 h de relógio**, sem espera do dono. Topo da faixa: S1 refutada (formato a mais vira emenda antes da T1), 2ª rodada na T2 e na T5.

## Spikes que podem mudar o plano

- **S1** REFUTADA (< 39 de 40 planos com tasks) ⇒ emenda da spec com o formato que falta antes do despacho da T1.
- **S2** fixa os números do aceite (T6). Se o repositório consumidor não usa `fluxo.vinculoPbiEpic` com `tipo: frontmatter`, o agrupamento da T3 segue com fixture sintética e o limite vai ao CHANGELOG.

---

### Task 0: Spikes S1 e S2 no repositório consumidor de referência

**Depende de:** —. **Onda A.** **Modelo:** Opus 5.5. Sem suíte, sem código de produto. **Precisa do ok P4.**

**Files:** Create `.superpowers/sdd/2026-11-19-gm16/t0-relatorio.md` (fora do git). Sondas em `.claude-tmp/gm16-t0/`.

- [ ] **S1** Para cada forma de REQ-PRJ-1 (a): quantos dos 40 planos ela casa; quantos cabeçalhos `Task` ficam fora por (b); quantos planos ficam com 0 task. CONFIRMADA com ≥ 39/40.
- [ ] **S2** Status distintos nos 91 cards e quantos são coluna por REQ-PRJ-2 (a); cards com a chave de Epic; Epics com PBI aberto; cards que REQ-DCT-1 (b) apontaria; tempo do `git log --first-parent --format=%s` da branch padrão inteira.
- [ ] Relatório só com números e formas genéricas (nunca ID, título, status literal nem caminho). Registro no ledger: 1 linha por spike com número e veredito.

### Task 1: Plano `.md` conta os cabeçalhos usuais (REQ-PRJ-1)

**Depende de:** T0. **Onda B.** **Modelo:** Sonnet 5.5 `high`.

**Files:** Modify `gates/src/projeto.ts` (`tasksDoPlanoMd :127-131`), `gates/dist/projeto.js`, `gates/test/projeto.test.ts` (o teste `:169-170` continua passando; mutação M16 do cabeçalho continua morta).

- [ ] **Step 1: Testes vermelhos** `plano-md-formatos-aceitos` (`##`/`###` × `:`/`—`/`–`/` - `, id `0b`), `plano-md-nao-casa`, `plano-md-bloco-cercado`, `plano-md-id-repetido-conta-1`, `plano-md-diario-casa-id-com-letra`.
- [ ] **Step 2:** regex por linha com estado de bloco cercado; id `\d+[a-z]?` ⇒ `T<id>`; `norm` de `projeto.ts:224` aceita o id com letra.
- [ ] **Mutações** M1a aceitar `####` · M1b aceitar `Task 1.1` · M1c contar dentro de bloco cercado · M1d tirar `—` do separador · M1e id com letra virar `T0` ⇒ cada uma morre (cabeçalho da suíte, como `projeto.test.ts:5-38`).
- [ ] **Step 3:** `node scripts/build.mjs`; `build.mjs --check`; suíte afetada. **Commit** `fix(GM-16): plano .md conta tasks em ## Task N — e ids com letra`.

### Task 2: Status fora do quadro FL1 é opção (REQ-PRJ-2)

**Depende de:** T1. **Onda C.** **Modelo:** Opus 5.5.

**Files:** Modify `gates/src/projeto.ts` (exporta `colunasFl1(statusCfg)` e `ehColunaFl1`, `ehFeito`; `projetarProjeto` recebe `statusFl1?` em `opcoes`; `totais.opcoes`), `gates/dist/projeto.js`, `gates/test/projeto.test.ts`, `gates/test/fixtures/projeto/` (cards com status de opção e config Jira).

- [ ] **Step 1: Testes vermelhos** os 7 de REQ-PRJ-2. Regressão: a fixture da GM-15 dá as mesmas linhas e totais de hoje.
- [ ] **Step 2:** predicado único (`ehColunaFl1`), exportado para o doctor (T5); opção fica fora de linhas e totais; opção com `plano.json` ou evento de task vira linha; previsão estimada segue a D-G13 até a resposta da P1 (ponto isolado numa função, para a resposta mudar 1 linha).
- [ ] **Mutações** M2a opção somando em `pbis` · M2b ignorar `fluxo.status.FL1` · M2c opção com diário sumindo · M2d tirar o `concluido` fixo · M2e card sem status virar linha ⇒ morrem.
- [ ] **Step 3:** build, check, suíte afetada. **Commit** `feat(GM-16): card com status fora do quadro FL1 vira opção`.

### Task 3: Núcleo dos feitos recolhidos e do Epic (REQ-PRJ-3 a, b, c)

**Depende de:** T2. **Onda D.** **Modelo:** Sonnet 5.5 `high`.

**Files:** Modify `gates/src/projeto.ts` (`cardDe` lê a chave do vínculo, frontmatter `[A-Za-z][A-Za-z0-9_-]*`; `LinhaProjeto.epic`; `EstadoProjeto.grupos` só com 2+ grupos de abertos; `opcoes.vinculo` e `opcoes.titulosEpic`), `gates/dist/projeto.js`, `gates/test/projeto.test.ts`.

- [ ] **Step 1: Testes vermelhos** `agrupa-com-2-epics`, `um-epic-nao-agrupa`, `vinculo-mcp-nao-agrupa`, `epic-chave-da-config`, `sem-epic-por-ultimo`, `feitos-contados-para-recolher`.
- [ ] **Mutações** M3a agrupar com 1 Epic · M3b ler `epic` fixo · M3c vínculo MCP agrupando · M3d "sem Epic" fora da ordem ⇒ morrem.
- [ ] **Step 2–3:** build, check, suíte. **Commit** `feat(GM-16): projeto agrupa os PBIs abertos por Epic`.

### Task 4: Render e borda da visão de projeto (REQ-PRJ-2 b, REQ-PRJ-3 a, c, d, e)

**Depende de:** T3. **Onda E.** **Modelo:** Sonnet 5.5 `high`.

**Files:** Modify `gates/src/painel-esquadrao.ts` (`linhasDoProjeto :382-428`: "✓ N feitos", cabeçalhos de Epic, "N opções" nas 3 larguras), `gates/dist/painel-esquadrao.js`, `gates/scripts/painel.mjs` (`projetoDoRepo :338-349`: passa `cfg.fluxo.status.FL1`, `cfg.fluxo.vinculoPbiEpic` e os títulos dos Epics da pasta `fluxo.mapeamento.FL2`, ausente × ilegível), `gates/test/painel-projeto.test.ts`.

- [ ] **Step 1: Testes vermelhos** `feitos-recolhidos-1-linha`, `sem-feito-sem-linha`, `opcoes-na-linha-de-totais` (3 larguras), `teto-de-linhas-propriedade` (40 a 200 colunas × 0 a 100 PBIs sintéticos; número nunca cortado, aprendizado 141), `regressao-fixture-gm15` (mesmas linhas de hoje), 1 teste pelo `painel.mjs` real com config (aprendizado 143) e 1 do helper de render real (aprendizado 1193).
- [ ] **Mutações** M4a listar os feitos · M4b cortar o número de opções · M4c borda sem passar `fluxo.status.FL1` · M4d cabeçalho de Epic com 1 grupo ⇒ morrem.
- [ ] **Step 2–3:** build, check, suíte afetada e `bash scripts/test/mod-test.sh` (o mod desenha o painel). **Commit** `feat(GM-16): painel recolhe os feitos e mostra as opções`.

### Task 5: Doctor avisa status FL1 inválido e PBI mergeado aberto (REQ-DCT-1)

**Depende de:** T2. **Onda D** (paralela à T3). **Modelo:** Opus 5.5.

**Files:** Modify `gates/scripts/harness-doctor.mjs` (2 checks `level: 'warn'` depois de `onboarding-nao-detectado :776`; `ehColunaFl1` pelo import dinâmico do `dist/` que já existe `:48-58`; `git log <branchPadrao> --first-parent --format=%s` sem teto, com timeout), Create `gates/test/harness-doctor-fluxo.test.mjs`.

- [ ] **Step 0:** `git grep` dos testes que fixam a lista de checks do doctor (`harness-doctor-110`, `harness-doctor-loop`, `e2e/avaliar-onboarding.mjs:216`); se algum fixar contagem total, ele entra na lista desta task por emenda antes de abrir (aprendizado GM-15 seq 115).
- [ ] **Step 1: Testes vermelhos** os 7 de REQ-DCT-1 mais o teste pelo CLI real com exit code; fixture git com `user.name`/`user.email`.
- [ ] **Mutações** M5a casar sem fronteira · M5b aviso no nível · M5c git ilegível dizendo "ok" · M5d predicado copiado em vez de importado (teste que troca o `dist/` e vê o doctor mudar) ⇒ morrem.
- [ ] **Step 2:** suíte afetada; doctor deste repo (ClickUp, sem pasta FL1) ⇒ os 2 checks "não se aplica". **Commit** `feat(GM-16): doctor avisa status FL1 fora do quadro e PBI mergeado em aberto`.

### Task 6: Aceite no repositório grande sintético

**Depende de:** T4, T5. **Onda F.** **Modelo:** Sonnet 5.5 `high`.

**Files:** Create `gates/test/aceite-gm16.test.mjs`, `gates/test/fixtures/gm16-repo-grande/` (só o gerador e a config; os 91 cards e 40 planos são gerados em `mkdtemp`).

- [ ] Teste `aceite-gm16-repo-grande` com os números da T0: linhas de projeto ≤ totais + 1 + abertos + grupos; "N opções" com o N de S2; tasks > 0 nos 40 planos; doctor com os 2 avisos e o mesmo nível. Gerador sem texto do repositório consumidor (revisor confere).
- [ ] **Commit** `test(GM-16): aceite da visão de projeto num repositório grande`.

### Task 7: Referência do fluxo e do doctor

**Depende de:** T4, T5. **Onda F.** **Modelo:** Haiku 5.5.

**Files:** Modify `reference/fluxo.md` (§4.3 e §6: card com status fora das colunas é opção no painel e aviso no doctor; `fluxo.status.FL1` lido pelo painel), `commands/gabarito-doctor.md` (os 2 avisos novos).

- [ ] Cada frase nova com marca (a) e `arquivo:linha` do código integrado. **Commit** `docs(GM-16): opção no painel e avisos do doctor na referência`.

### Task 8: Virada 2.2.0

**Depende de:** todas. **Onda G.** **Modelo:** Haiku 5.5.

**Files:** Modify `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (raiz), `gates/package.json`, `gates/test/package.test.mjs:46-47`, `scripts/test/texto.test.sh:278-280`, `CHANGELOG.md` (seção `[2.2.0]` datada, sem `[Unreleased]`; limites declarados: P1 se não respondida, vínculo por MCP sem agrupamento).

- [ ] Versão conforme a resposta da P2 (padrão 2.2.0). `claude plugin validate ./plugins/gabarito-mestre --strict` e `claude plugin validate . --strict`. **Commit** `chore(GM-16): virada 2.2.0`. Tag, release e PR `next ⇒ main` são atos do dono (R1).

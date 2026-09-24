# Gabarito Mestre 1.1.0 — Fase 6: pacote e medição (T25–T26)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a 1.1.0: três `version` iguais, CHANGELOG com a seção da versão, README com as seções novas e a tabela de medições (M14/M15 **NÃO MEDIDO** até T26 medir), CI do repositório rodando os testes novos e os greps de invariantes; depois medir M14 (onboarding com MCP ClickUp) e M15 (sem MCP, com mutação de prompt da conformidade) em dois repos descartáveis e escrever os números no README.

**Architecture:** Fase 6 do rollout — última porque as medições só existem depois de 1–5 rodarem. T25 é texto e manifestos; T26 é medição manual (interativa para M14, headless para M15) com registro literal no ledger e no README. Nada aqui muda comportamento de código: se uma medição refutar algo, o achado volta como PBI novo, não como "conserto" nesta fase.

**Tech Stack:** JSON (manifestos), Markdown, YAML (GitHub Actions, ações pinadas por SHA), bash, `claude` CLI 2.1.281 (`-p`, `--plugin-dir`, `--strict-mcp-config`, `--output-format json`), `script(1)` do macOS para capturar sessão interativa.

**Spec:** `docs/superpowers/specs/2026-09-24-workflow-true-design.md` — REQ-PKG-1 (l.252–253), PKG-2 (l.255–256), ONB-1..8 (l.104–130), TIM-1 (l.244–245), CNF-1 (l.239–240), M2/M3 (l.14–15), M12 (l.24), tabela "Testes e gates" (l.284, 286, 297), "Fora de escopo" (l.260–272), "Pendências" (l.317–324: contagem de testes e bytes do `AGENTS.md` são medidos, não estimados).
**Contrato:** `docs/superpowers/plans/2026-09-24-workflow-true-1.1.0.md` — Global Constraints (l.26–40: `plugin.json` sem `hooks`; versão em três lugares), flags de `instalar.sh` (l.232–234), cartão (l.202–216), gate da Fase 6 (l.286), T25/T26 (l.318–319).
**Memória:** `~/.claude/projects/-Users-gabs-dev-projetos-pessoais-gabarito-mestre/memory/plugin-json-hooks-field-duplicate.md` — `"hooks": "./hooks/hooks.json"` em `plugin.json` quebra o load (`Duplicate hooks file detected`, medido em 2.1.261); `validate --strict` não pega; só `claude plugin list` depois de instalar.

**PBI desta fase:** `GM-6` (Enabler). Branch `enabler/GM-6-pacote`. Ledger `docs/ledgers/GM-6.md`. Commits `chore(GM-6): …` / `docs(GM-6): …`. Nenhuma task faz push, PR ou merge (R1).

---

## Pré-condições

- [ ] Fase 5 integrada em `main` e revisada. Medir:
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre
  git checkout main && git pull --ff-only
  P=plugins/gabarito-mestre
  grep -c '^## Fase ' $P/skills/gabarito-instalar/SKILL.md            # 4
  grep -c 'contenda (R21)' $P/skills/gabarito-conformidade/SKILL.md   # ≥ 2
  grep -c 'Isolamento: porta' $P/agents/gabarito-implementador.md     # 1
  grep -c 'warn modelo-resolvido' $P/commands/gabarito-doctor.md      # 1
  claude plugin validate ./$P --strict && claude plugin validate . --strict
  (cd $P/gates && npm test 2>&1 | tail -12)                            # verde; anotar "# tests N" de cada suíte
  node --test $P/hooks/test/guards.test.mjs 2>&1 | tail -8             # verde; anotar "# tests N"
  bash $P/scripts/test/instalar.test.sh                                # verde
  ```
- [ ] Branch e ledger:
  ```bash
  git checkout -b enabler/GM-6-pacote
  mkdir -p docs/ledgers && cat > docs/ledgers/GM-6.md <<'EOF'
  # Ledger — PBI: GM-6 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-6-pacote.md   Branch: enabler/GM-6-pacote @ (sha ao abrir)   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
  Rulings herdados: R1, R2, R3, R16, R18          Contexto externo: M14 lê ClickUp por MCP (só leitura, ok nominal do usuário na sessão); repos descartáveis em mktemp

  ## LER PRIMEIRO — <AAAA-MM-DD>
  Fase 6: T25 → T26 (T26 depende de T25); nada medido ainda.
  ## Pre-flight — pares produz × consome
  | Par | Produz × Consome | Achado |
  | T25 × T11 | `gates/package.json` já em 1.1.0 (T11) × T25 confere os três iguais | não reescrever; só conferir |
  | T25 × T21 | `templates/gabarito.yml` sem número no job (T21) × grep "77 testes" = 0 | T25 cobre os arquivos que T21/T22 não tocaram (CONTRIBUTING, gates/README, gates.md, README) |
  | T26 × T22/T23 | skills finais × medições M14/M15 | mutação de prompt roda sobre CÓPIA do plugin, nunca sobre a árvore do repo |
  ## Rulings de pre-flight
  ## Progresso
  ## CORTE DA SESSÃO (com motivo)
  ## FECHO — PR mergeada
  EOF
  ```

## Grafo

```
T25 ─ T26   (serial: T26 mede o pacote que T25 fechou e escreve no README que T25 editou)
```

Nenhuma contenda de arquivo com outra fase. Recurso compartilhado em T26: **a conta ClickUp do usuário** (M14) — só leitura, uma sessão por vez; e a máquina local (calibração) — nada mais roda durante a medição, senão `capacidade.mjs` mede o ruído.

**Gate de fase (contagem verificável):** 3 `version` = `1.1.0` · `claude plugin validate --strict` passa nos dois manifestos · README com M14/M15 (NÃO MEDIDO em T25; números em T26) · CI verde no PR com **6 jobs** (validate, gates, instalador, hooks, texto, doctor-self) · `grep -rn "77 testes"` = 0 fora de `CHANGELOG.md`.

---

## T25 — três `version`, CHANGELOG, README, `ci.yml`

**Fecha:** REQ-PKG-1, PKG-2 (grep de nomes e ausência de `hooks` no `plugin.json`), ONB-5 (README explica "cada pessoa instala uma vez"), rollout 6.
**Arquivos:** `plugins/gabarito-mestre/.claude-plugin/plugin.json` · `.claude-plugin/marketplace.json` · `plugins/gabarito-mestre/gates/package.json` (conferir) · `CHANGELOG.md` · `README.md` · `.github/workflows/ci.yml` · `CONTRIBUTING.md` (1 linha) · `plugins/gabarito-mestre/gates/README.md` (1 linha) · `plugins/gabarito-mestre/reference/gates.md` (1 linha).
**Aceite:** Given os três manifestos · When `node -p` lê `version` · Then os três imprimem `1.1.0`. Given `grep -rn "77 testes"` no repo (menos `CHANGELOG.md`) · Then 0 linhas. Given `plugin.json` · When `grep '"hooks"'` · Then 0. Given o CI · When PR aberto · Then os 6 jobs passam.

### Passos — manifestos

- [ ] Ler os três e conferir o ponto de partida:
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre
  node -p "require('./plugins/gabarito-mestre/.claude-plugin/plugin.json').version"      # 1.0.1 → vai a 1.1.0
  node -p "require('./.claude-plugin/marketplace.json').plugins[0].version"               # 1.0.1 → vai a 1.1.0
  node -p "require('./plugins/gabarito-mestre/gates/package.json').version"               # 1.1.0 (T11); se 1.0.0, T11 não foi integrada — pare
  ```
- [ ] `plugins/gabarito-mestre/.claude-plugin/plugin.json` — `Edit`: `"version": "1.0.1"` → `"version": "1.1.0"`; `description` passa a (texto final, uma linha):
  `Molde de referência para engenharia com agentes: barra o destrutivo, o acesso a produção e o versionamento fora do padrão (hooks R2/R3/R20), confere o que é produzido (design, plano, cards de fluxo, review, spike), injeta o cartão de sessão (R21) e mede o nível real de adoção (doctor). Onboarding do Workflow TRUE (Flight Levels + Kanban) na instalação. Compõe com superpowers (processo) e ui-ux-pro-max (interface).`
  `keywords` recebe, ao fim da lista existente: `"workflow"`, `"kanban"`, `"flight-levels"`, `"trunk-based"`. **Nenhuma chave `hooks`** — nem agora, nem nunca (memória citada acima).
- [ ] `.claude-plugin/marketplace.json` — `Edit`: `"version": "1.0.1"` → `"version": "1.1.0"`; `description` do plugin passa a:
  `Barra o destrutivo, produção e versionamento fora do padrão (hooks R2/R3/R20), confere o produzido (conformidade com fio condutor, review adversarial, spike), injeta o cartão de sessão e mede o nível real de adoção (doctor). Onboarding do Workflow TRUE na instalação. Exige superpowers; ui-ux-pro-max quando a tarefa é de UI/UX.`
  `keywords` recebe `"workflow"`, `"kanban"`.
- [ ] Verificar:
  ```bash
  for f in plugins/gabarito-mestre/.claude-plugin/plugin.json .claude-plugin/marketplace.json plugins/gabarito-mestre/gates/package.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "json ok: $f"; done
  v1=$(node -p "require('./plugins/gabarito-mestre/.claude-plugin/plugin.json').version"); v2=$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].version"); v3=$(node -p "require('./plugins/gabarito-mestre/gates/package.json').version"); echo "$v1 $v2 $v3"; [ "$v1" = 1.1.0 ] && [ "$v2" = 1.1.0 ] && [ "$v3" = 1.1.0 ] && echo "três iguais"
  grep -c '"hooks"' plugins/gabarito-mestre/.claude-plugin/plugin.json     # 0
  claude plugin validate ./plugins/gabarito-mestre --strict && claude plugin validate . --strict
  ```
- [ ] Commit:
  ```bash
  git add plugins/gabarito-mestre/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  git commit -m "$(cat <<'EOF'
  chore(GM-6): versão 1.1.0 nos três manifestos

  plugin.json e marketplace.json a 1.1.0 (gates/package.json já estava, T11);
  descrições citam R20, cartão de sessão e onboarding do Workflow TRUE. Sem
  chave "hooks" em plugin.json (duplicata quebra o load).

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

### Passos — contagem de testes (medida, não estimada)

- [ ] Medir e anotar no ledger:
  ```bash
  (cd plugins/gabarito-mestre/gates && npm run test:mjs 2>&1 | grep '^# tests'; npm run test:ts 2>&1 | grep '^# tests')
  node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs 2>&1 | grep '^# tests'
  ```
  Sejam `NM` (mjs), `NT` (ts), `NH` (hooks). O número escrito nos arquivos abaixo é **`NM + NT`** para os gates e **`NH`** para os hooks — os que o comando imprimiu, sem arredondar.
- [ ] Substituir a contagem antiga nas quatro linhas (a única forma aceita é a medida; `CHANGELOG.md` mantém "77" nas entradas 1.0.x — histórico, R16):
  - `CONTRIBUTING.md:20` → `cd plugins/gabarito-mestre/gates && npm test                     # <NM+NT> testes (medido em 2026-09-24)`
  - `plugins/gabarito-mestre/gates/README.md:21` → `npm test          # <NM+NT> testes (medido em 2026-09-24)`
  - `plugins/gabarito-mestre/reference/gates.md:8` → `Rode \`npm test\` lá: a contagem é medida a cada versão (1.1.0: <NM+NT> testes), incluindo os que reproduzem os incidentes originais.`
  - `README.md` — as duas ocorrências entram nas seções reescritas abaixo.
  Nas linhas acima, `<NM+NT>` é substituído pelo número medido antes do commit — a verificação a seguir falha se sobrar um `<`.
- [ ] Verificar: `grep -rn "77 testes" . --include='*.md' --include='*.yml' --include='*.sh' --include='*.json' | grep -v node_modules | grep -v '^./CHANGELOG.md' | grep -v docs/superpowers` → **0 linhas**; `grep -n '<NM' CONTRIBUTING.md plugins/gabarito-mestre/gates/README.md plugins/gabarito-mestre/reference/gates.md` → 0.

### Passos — `CHANGELOG.md` (raiz)

- [ ] Inserir, entre a linha `Usuários do plugin só recebem atualização quando \`version\` muda.` e `## [1.0.1] — 2026-09-05`, a seção abaixo (a data é a do dia do commit desta task; se não for 2026-09-24, troque no cabeçalho — a tag e o link de compare usam a versão, não a data):

```markdown
## [1.1.0] — 2026-09-24

Camada de fluxo (Workflow TRUE: Flight Levels + Kanban), onboarding na instalação, versionamento trunk-based como gate,
orquestração por subagente com paralelismo medido e contexto em camadas. **Aditiva sobre a 1.0.1**: nenhuma regra, gate,
hook, skill ou agente removido (ADR-CTX-1: texto do núcleo do `AGENTS.md` migrou para a referência; regra não sumiu).
Repos 1.0.x não mudam até rodarem `instalar.sh --atualizar`.

### Adicionado
- **Fluxo** — `reference/fluxo.md` (7 seções: níveis · 8 tipos de card · políticas · movimento · propagação ·
  compromisso/WIP/vazão · métricas medem item, nunca pessoa), instalado em `docs/harness/fluxo.md`; `templates/fluxo/`
  com os 8 cards; `reference/ferramentas-mcp.json`; seção `fluxo` do `harness.config.json` — gravada pelo onboarding,
  nunca pelo template. Regra **R19 — fio condutor obrigatório** (`AGENTS.md §7`).
- **Onboarding** — `gabarito-instalar` em 4 fases (instalação · fluxo · versionamento · orquestração), gatilho por
  `resolvidoEm` de cada fase, detecção da ferramenta de planejamento por MCP (`claude mcp list` + tools visíveis),
  leitura da Iniciativa só com ok em uma linha (I10: existe ≠ ativa; I4: vazio não é prova), escrita na ferramenta
  desligada por default (ADR-FLX-2), `CODEOWNERS` a partir de "Áreas e donos", `docs/fluxo/` quando não há ferramenta,
  modo `--vincular <PBI>`; `gates/scripts/onboarding-config.mjs` (merge chave a chave, `_comment` preservado, `--settings`).
- **Versionamento** — regra **R20** (`AGENTS.md §3`, detalhe em `referencia.md §10`); hook `guard-versioning.sh`
  (branch `tipo/<PBI>-slug` · `wt/<PBI>-<n>` · commit `tipo(PBI): assunto`, inclusive `-m "$(cat <<'EOF' …)"`, `-F`,
  `-am`), escape hatch `GABARITO_ALLOW_VERSIONING` (hatches não cruzam), fail-open sem onboarding;
  `gates/scripts/versionamento-check.mjs` (ignora merge commits; CI com `fetch-depth: 0`); templates
  `PULL_REQUEST_TEMPLATE.md`, `CHANGELOG.md`, `backlog.md`; atestado `squash-titulo-pr`.
- **Orquestração** — regra **R21 — orquestrador despacha, não implementa** (`AGENTS.md §6`; velocidade nunca compra
  concorrência); hook `session-card.sh` (SessionStart: cartão ≤ 40 linhas via `cartao-sessao.mjs` — modelo e validade,
  PBI/Epic/Iniciativa, em voo, slots, doctor em cache, envelhecidos, LER PRIMEIRO, versão instalada × plugin,
  superpowers); hook `remind-orchestrator.sh` (UserPromptSubmit, `lembretePorPrompt`, desligado por default, nunca
  bloqueia); `.harness/fluxo-cache.json`; política de modelo por alias com validade de 90 dias (ADR-ORQ-1).
- **Paralelismo** — `gates/scripts/capacidade.mjs` (cores, load, memória disponível via `vm_stat`/`MemAvailable`,
  disco, processos pesados excluindo a árvore do Claude Code; `slots`; `--calibrar`; `GABARITO_PARALELISMO`);
  `arquivosDeContenda` (serial sem override); `isolamentoWorktree` resolvido no prompt do implementador
  ("Isolamento: porta · schema · namespace — não use outro"); escalada ao usuário após `rodadasAntesDeEscalar`.
- **Doctor** — checagens `fluxo-configurado`, `iniciativa-resolvida` (atestado), `versionamento`, `changelog`,
  `tag-semver` (opcional), `agents-tamanho` (núcleo ≤ 17.291 B, Apêndice ≤ 4.096 B), `paralelismo-calibrado` e
  `warn modelo-resolvido` (aviso, não entra no nível); `--cache` (24 h); linha "checagens novas da 1.1.0: rode o
  onboarding ou declare o nível medido".
- **Instalador** — `--atualizar` (`.novo` + `diff --stat`, aviso "R19–R21 são do harness; regras de projeto passam a
  R30+"), `--atualizar --gates-substituir` (ADR-TIM-1: só `tools/gabarito-gates/`, `.bak`, recusa por hash divergente),
  `--codeowners`; `tools/gabarito-gates/.instalado.json`; emenda do `.gitignore` (`.harness/doctor-cache.json`,
  `.harness/fluxo-cache.json`, `*.novo`, `*.bak`); `scripts/test/instalar.test.sh`.
- **Conformidade** — checklists por tipo de card (Iniciativa, Epic com lista de PBIs, US, Enabler, TechDebt, Tarefa,
  Spike, Bug) citando `fluxo.md §2`; fio condutor no design (`Iniciativa:`/`Epic:` + PBIs) e no plano (`PBI:` único,
  `Epic:`, tipo por task); contenda serial no grafo; fail-open declarado — sem `fluxo.resolvidoEm`, fio condutor é AVISO.
- **Referência** — `referencia.md §3.5` "Camadas de contexto" (orquestrador não lê saída bruta que um subagente possa
  resumir) e `§10` "Versionamento"; `adocao.md §4` "MCP demais no contexto" e `§5` reescrito (orquestração por pessoa
  **com** ownership por área); `prompts.md` com "Isolamento" (Implementador) e "Antes de despachar" (Orquestrador);
  `AGENTS.md §6` com a tabela de 5 camadas de contexto e Apêndice com Fluxo · Versionamento · Modelo · Paralelismo ·
  Isolamento · Áreas e donos.
- CI deste repositório: job `instalador` (`instalar.test.sh`, Ubuntu + macOS) e job `texto` (7 seções de `fluxo.md`;
  R19/R20/R21/R30+ e `§3.7` = 0 no `AGENTS.md`; `§3.5` e "Versionamento" em `referencia.md`; "MCP demais" em
  `adocao.md`; `AskUserQuestion` e nenhum `mcp__` no `allowed-tools` da skill; três `version` iguais; sem `"hooks"`
  em `plugin.json`; sem "77 testes"; lista de nomes da 1.0.1 presente).

### Alterado
- `AGENTS.md`: núcleo com teto de **17.291 bytes** (ADR-CTX-1) — os blocos "Motivo"/"Gate" de R2/R3, os "dois
  incidentes" do §6, "Consequência prática", "Fronteira com UI/UX" e a lista de limites dos hooks do §9 e o comando do
  §0.2 migraram para `referencia.md §5/§11/§12/§3.1`, `adocao.md §1` e README; §7 reescrito (Iniciativa → Epic → PBI,
  **um plano por PBI** — ADR-FLX-1; Ready/Done por altitude); ponteiro `§3.7` corrigido para `§3.4`; §8 ganha a revisão
  das políticas de fluxo; regras de projeto passam de `R19+` a **`R30+`**.
- `referencia.md §3.1` (worktree `wt/<PBI>-<n>`) e `§3.4` ("unidade da PR é o PBI"; WIP por nível em `fluxo.md`;
  "Sem sprint, sem timebox, sem WIP formal" removido).
- `hooks/_common.sh`: `gabarito_escape_hatch <ROTULO> <VAR>` (R2 e R3 continuam aceitando uma pela outra — comportamento
  medido da 1.0.1; R20 não cruza), `gabarito_repo_root` (`git rev-parse --show-toplevel`, monorepo em subpasta),
  `gabarito_config_get`.
- `templates/gabarito.yml`: `fetch-depth: 0`, job `versionamento`, nome do job de testes sem número.
- `templates/attest.json`: chaves `iniciativa-resolvida` e `squash-titulo-pr`. `templates/harness.config.json`: só o
  `_comment` (as seções novas nascem no onboarding).
- `gates/package.json`: versão alinhada ao plugin (era `1.0.0`, M12) e `bin` novos.
- `/gabarito-doctor`: explica `warn` (≠ `FALTA` ≠ `--`), a linha "checagens novas da 1.1.0" e `--cache`.
- `gabarito-implementador`: bloco "Isolamento", idêntico ao de `prompts.md`.
- `gabarito-instalar`: `allowed-tools` com `AskUserQuestion`, `Edit`, `Bash(claude mcp list:*)` — nenhum `mcp__*`
  (permissão por chamada, R3).
- README: seções Fluxo, Onboarding, Versionamento, Orquestração e modelo, Paralelismo medido, Contexto em camadas,
  Atualizar de 1.0.x e a tabela "Medições da 1.1.0" (M14/M15); contagem de testes medida nesta versão.
```

- [ ] No rodapé, acima de `[1.0.1]: …`, acrescentar (mesmo padrão de tag `gabarito-mestre--vX.Y.Z`):
  ```
  [1.1.0]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.1...gabarito-mestre--v1.1.0
  ```
- [ ] Verificar: `grep -c '^## \[1.1.0\]' CHANGELOG.md` = 1 · `grep -c '^\[1.1.0\]: ' CHANGELOG.md` = 1 · `grep -c '^## \[1.0.1\]' CHANGELOG.md` = 1 (nada removido) · `grep -c 'R30+' CHANGELOG.md` ≥ 1.

### Passos — `README.md`

Substituições e inserções, na ordem do arquivo. Texto **final**; onde aparece `<NM+NT>` ou `<NH>`, entra o número medido acima antes do commit.

- [ ] **Parágrafo de medições (l.9)** — trocar `Todos os números deste README foram **medidos em 2026-09-05** (Claude Code 2.1.261, Node 24.14.1, macOS). Onde não foi possível medir, está escrito **NÃO MEDIDO**.` por:
  `Os números das seções de hooks e peso morto foram **medidos em 2026-09-05** (Claude Code 2.1.261, Node 24.14.1, macOS) e valem para a 1.0.1 e a 1.1.0 (hooks R2/R3 inalterados). Os números da 1.1.0 estão na seção **Medições da 1.1.0**, cada um com a própria data. Onde não foi possível medir, está escrito **NÃO MEDIDO**.`
- [ ] **"Plugins vizinhos — o que instalar à mão" (l.31–50, composição)** — inserir, logo após o parágrafo `Em conflito, **o gabarito vence** …` e antes de `**Composição medida (M12):**`, o parágrafo que a Fase 4 tirou do núcleo do `AGENTS.md` (handoff C11 — texto **idêntico** ao de `2026-09-24-workflow-true-1.1.0-fase-4-referencia.md`, "Handoffs", "Para T25"):
  `**Fronteira com UI/UX:** ui-ux-pro-max manda na forma visual e na interação; o gabarito continua mandando no que é regra dentro da tela — **o servidor é a fronteira (R9), erro em três camadas (\`referencia.md §8\`), tenant absoluto (R10)**.`
  Verificar: `grep -c 'Fronteira com UI/UX' README.md` = 1 · `grep -c 'Fronteira com UI/UX' plugins/gabarito-mestre/reference/AGENTS.md` = 0 (saiu do núcleo, CTX-1).
- [ ] **"O que vem no pacote" (l.55–68)** — trocar o bloco de árvore por:
  ```
  plugins/gabarito-mestre/
    skills/    gabarito-instalar (4 fases + --vincular) · gabarito-conformidade (anatomia + cards + fio condutor) · gabarito-review · gabarito-spike
    agents/    gabarito-implementador (com Isolamento) · gabarito-revisor · gabarito-spike
    commands/  /gabarito-doctor
    hooks/     guard-destructive.sh (R2) · guard-production.sh (R3) · guard-versioning.sh (R20) · session-card.sh (cartão de sessão) · remind-orchestrator.sh (R21, opcional)
    reference/ AGENTS.md + referencia.md · gates.md · adocao.md · prompts.md · fluxo.md · ferramentas-mcp.json
    gates/     7 gates + 4 scripts de fluxo (onboarding-config · capacidade · versionamento-check · cartao-sessao), <NM+NT> testes, zero dependências
    templates/ harness.config.json · attest.json · CLAUDE.md · gabarito.yml (CI) · PULL_REQUEST_TEMPLATE.md · CHANGELOG.md · backlog.md · fluxo/ (8 cards)
    scripts/   instalar.sh (--atualizar · --gates-substituir · --codeowners) · test/instalar.test.sh
  ```
  e o parágrafo seguinte por:
  `Depois de instalar o plugin, **instale o harness no seu repositório**: diga "instala o gabarito" (skill \`gabarito-instalar\`) ou rode \`bash <plugin-root>/scripts/instalar.sh .\`. A fase 1 cria \`AGENTS.md\`, \`CLAUDE.md\` (só a linha \`@AGENTS.md\`), \`docs/harness/\` (com \`fluxo.md\`), \`tools/gabarito-gates/\` (+ \`.instalado.json\`), \`harness.config.json\`, \`.harness/attest.json\`, \`.github/workflows/gabarito.yml\` e emenda o \`.gitignore\`; nunca sobrescreve nem apaga. As fases 2–4 (só pela skill) fazem o onboarding do fluxo, do versionamento e da orquestração. **O nível de adoção fica \`____\`** — é o doctor quem mede (\`/gabarito-doctor\`).`
- [ ] **Inserir, logo após "O que vem no pacote" e antes de `## Hooks`**, as sete seções abaixo, separadas por `---`:

````markdown
## Fluxo (Workflow TRUE)

A 1.1.0 põe o harness sob o **Workflow TRUE** — Flight Levels com Kanban: **FL3 Iniciativa** (propósito, horizonte, patrocinador) → **FL2 Epic** (narrativa, RN, CA, lista de PBIs; **um design por Epic**) → **FL1 PBI** (concluível em poucos dias; **um plano, uma branch, uma PR, um ledger por PBI** — ADR-FLX-1). Oito tipos de card: Iniciativa, Epic, US, Enabler, TechDebt, Tarefa, Spike, Bug — templates em `templates/fluxo/`. A fonte normativa versionada é `reference/fluxo.md` (instalado em `docs/harness/fluxo.md`, sete seções: níveis · tipos de card · políticas · movimento · propagação · compromisso/WIP/vazão · métricas), e é ela que a conformidade cita — não o HTML de origem.

Três regras novas no `AGENTS.md`, todas com gate:

| Regra | Uma linha | Gate |
|---|---|---|
| **R19 — fio condutor obrigatório** (§7) | nenhum PBI sem Epic ativo, nenhum Epic sem Iniciativa ativa; card sem vínculo é desalinhamento, não exceção; métricas medem item, nunca pessoa | `gabarito-conformidade` (design: `Iniciativa:`/`Epic:` + PBIs; plano: `PBI:` único + `Epic:` + tipo por task) · cartão de sessão (`PBI: (b) não resolvido` quando falta) |
| **R20 — versionamento é gate, não convenção** (§3) | trunk-based · branch por PBI · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag por release · squash com título CC | `guard-versioning.sh` (PreToolUse) · `versionamento-check.mjs` (CI e doctor) |
| **R21 — orquestrador despacha, não implementa** (§6) | toda implementação, spike, review e exploração pesada roda em subagente; **velocidade nunca compra concorrência** — arquivo disjunto, contenda e recurso compartilhado serial não têm override | cartão de sessão · `remind-orchestrator.sh` (opcional) · conformidade (contenda) |

Regras de projeto no Apêndice passam de `R19+` a **`R30+`** — `instalar.sh --atualizar` avisa a renumeração.

**Bloqueio é marcação, não coluna**: qualquer impedimento vira `BLOQUEADA <data> <motivo> — dono: <quem>` no ledger, e o item não muda de coluna. PBI sem movimento há mais de `fluxo.envelhecimentoDias` (default 3) aparece no cartão de sessão como **envelhecido — pauta do nível acima**. Ao integrar o primeiro commit de um PBI, o orquestrador registra `MOVIMENTO FL2 <EPIC> preparado→em_execucao <data>` no ledger (`<de>`/`<para>` são as chaves de `fluxo.status.FL2`, sem espaços) e grava `.harness/fluxo-cache.json`; escreve na ferramenta de planejamento **só** se o onboarding autorizou (`fluxo.escrita: true`, ADR-FLX-2) — senão avisa em uma linha que o movimento ficou pendente lá.

**Sem ferramenta de planejamento** (`ferramenta: arquivos`): Iniciativa, Epics e PBIs vivem em `docs/fluxo/` (`iniciativa.md`, `epics/`, `pbis/`) com os mesmos templates, frontmatter `id · tipo · status` mais o vínculo para cima: `epic:` no PBI (`pbis/<ID>.md`) e `iniciativa:` no Epic (`epics/<ID>.md`) — o cartão de sessão resolve a Iniciativa do PBI lendo o Epic, e só cai em `fluxo.iniciativa.id` se o Epic não a declarar. Os valores de `status:` são os **nomes de coluna** de `fluxo.md §4` (`Preparado`, `Em execução`, …), não as chaves; `docs/fluxo/` entra em `arquivosDeContenda` por default. `docs/backlog.md` continua sendo o backlog do harness (R17).

---

## Onboarding

`gabarito-instalar` tem **quatro fases**; cada uma das fases 2–4 roda quando o seu `resolvidoEm` falta em `harness.config.json` (`fluxo.resolvidoEm` · `versionamento.resolvidoEm` · `orquestracao.modelo.resolvidoEm`) ou quando você pede "refazer onboarding". Onboarding interrompido retoma da fase que falta; repo com os três preenchidos roda só a fase 1 e diz "onboarding já feito em <data>".

| Fase | O que faz | Grava |
|---|---|---|
| **1 — instalação** | `instalar.sh` (determinístico; nunca sobrescreve) e, se o harness já existe em versão anterior, `--atualizar` | arquivos da tabela acima, `.instalado.json`, `.gitignore` |
| **2 — fluxo** | lista os servidores MCP da sessão (`mcp__<servidor>__*` + `claude mcp list`), cruza com `reference/ferramentas-mcp.json`, avisa em uma linha **quantos servidores MCP** estão conectados e o custo de contexto (`adocao.md §4`); pede ok em uma linha antes de **ler** a Iniciativa na ferramenta (existe ≠ ativa — confirma status; busca vazia não é prova); perguntas fechadas (`AskUserQuestion`): hierarquia FL3/FL2/FL1, nomes de status, formato de ID, campo PBI→Epic, **escrita autorizada? (default não)**, áreas e donos; sem ferramenta, cria `docs/fluxo/` | `fluxo` (via `onboarding-config.mjs`), `.github/CODEOWNERS` (se ausente), Apêndice "Fluxo" e "Áreas e donos" |
| **3 — versionamento** | confirma trunk-based e o mapa tipo de PBI → prefixo (US→`feat`, Bug→`fix`, Enabler→`enabler`, TechDebt→`debt`, Spike→`spike`, Tarefa→`task`; sem PBI: `chore|docs|ci|build|test/<slug>`; worktree `wt/<PBI>-<n>`); instala **se ausentes** `.github/PULL_REQUEST_TEMPLATE.md` (título `tipo(PBI-n): assunto` — é o que vira commit de squash —, PBI, Epic, requisito, migration compatível, plano de volta, janela, teardown, revisor humano), `CHANGELOG.md` (Keep a Changelog, `Unreleased`) e `docs/backlog.md` | `versionamento`, Apêndice "Versionamento" |
| **4 — orquestração** | pergunta **qual família de modelo é a mais potente hoje na sua conta** (fonte: `/model` na UI — não há API para enumerar; a resposta é **(b)** do usuário, gravada com data e validade de 90 dias); mostra o **diff** de `.claude/settings.json` e pede **dois oks separados**: `model` para o time inteiro (afeta custo de todos) e `enabledPlugins` + `extraKnownMarketplaces` do gabarito (liga hooks PreToolUse de terceiro para quem clonar — ponto de consentimento); calibra a máquina (`capacidade.mjs --calibrar`) e confirma `simultaneos`, `teto` e `arquivosDeContenda` (lockfile, `prisma/`, `src/index.ts`, `docs/fluxo/`) | `orquestracao`, `.claude/settings.json` (só o confirmado; chaves existentes intactas), Apêndice "Modelo", "Paralelismo", "Isolamento" |

Termina com o doctor e a lista **"o que ficou (b)"**. Sessão sem `AskUserQuestion` (headless): defaults marcados (b), consentimento de `settings.json` vale **não**.

**Cada pessoa instala o plugin uma vez.** `enabledPlugins` e `extraKnownMarketplaces` no `.claude/settings.json` do projeto deixam o plugin habilitado para quem clona, mas **não instalam nada**: cada pessoa roda `claude plugin install gabarito-mestre@gabarito-mestre` na própria máquina (M3, medido em `settings-example` da doc oficial). Tools MCP **não** entram no `allowed-tools` da skill — pedem permissão por chamada, de propósito (R3).

**`--vincular <PBI>`**: ao abrir a branch de um PBI, "gabarito-instalar --vincular PBI-123" lê o card (na ferramenta, só com ok, ou em `docs/fluxo/pbis/PBI-123.md`), grava `.harness/fluxo-cache.json` (`{ "PBI-123": { "epic", "iniciativa", "titulo", "em" } }`, gitignored — a única fonte offline de PBI→Epic para os hooks) e registra uma linha no ledger. **Nunca escreve na ferramenta**, mesmo com escrita autorizada.

---

## Versionamento

Trunk-based (D2): `main` protegida, branch curta por PBI, Conventional Commits com escopo do PBI, SemVer, CHANGELOG na PR, tag por release, squash-merge com título CC. O que a máquina lembra:

- **`guard-versioning.sh`** (PreToolUse · Bash · `timeout 10`): intercepta criação de branch (`git checkout -b|-B`, `git switch -c|-C|--create`, `git branch <nome>`, `git worktree add -b|-B`) e valida contra `branchPadrao` **ou** `branchWorktree`; intercepta `git commit` com `-m`, `--message=`, `-am`, `-m` múltiplo (valida o primeiro), `-m "$(cat <<'EOF' … EOF)"` (a forma padrão do Claude Code — valida a primeira linha do corpo), `-F <arquivo>` e `-F -` com heredoc, e valida `tipo(escopo): assunto` — escopo casando `idPadrao` quando o tipo ∈ `tiposComEscopoDePbi`, livre ou ausente quando ∈ `tiposLivres`. **Não** intercepta `--amend` sem `-m`, commit interativo, nem mensagens em `main`/`master`. Bloqueia com `exit 2` e motivo em três camadas. Passam: `feat/PBI-12-x`, `chore/bump-deps`, `wt/PBI-12-1`, `feat(PBI-123): …`, `docs: …`. Reprovam: `hotfix/PBI-1`, `chore/PBI-1`, `feat/pbi-12`, `git commit -m "arrumei"`, `fix: c` (escopo obrigatório ausente).
- **Escape hatch** `GABARITO_ALLOW_VERSIONING="<motivo ≥ 8 caracteres, ≥ 2 palavras>"` — mesmas regras dos outros; **hatches não cruzam** (R2 e R3 continuam aceitando uma pela outra, comportamento medido da 1.0.1; R20 não aceita nenhuma das duas).
- **`versionamento-check.mjs`** (`--base origin/main --branch "$GITHUB_HEAD_REF"`): valida commits de `base..HEAD` **ignorando merge commits** (2 pais) e o nome da branch; no `gabarito.yml` com `fetch-depth: 0`; no doctor, checagem `versionamento` sobre os últimos 20 commits de primeiro pai. O título CC no squash é **atestado** (`squash-titulo-pr` em `attest.json`) — nenhuma varredura prova a configuração do ruleset. **Limite declarado (VER-3, b):** o doctor confere o first-parent de `HEAD` — a branch em que roda —, não `main` mais a branch atual; commits trazidos por merge de outras branches não são inspecionados.
- **Fail-open declarado (G9):** sem `versionamento.resolvidoEm`, o hook avisa em stderr e deixa passar — repo sem onboarding não é travado. Raiz do repo via `git rev-parse --show-toplevel`: sessão aberta em subpasta de monorepo funciona.

Detalhe da regra em `referencia.md §10` ("Versionamento"); a política de prefixos deriva de `tiposComEscopoDePbi` + `tiposLivres` — uma lista, não duas.

---

## Orquestração e modelo

**R21** vale para o orquestrador humano-com-agente e para a sessão: implementação, spike, review e exploração pesada rodam em **subagente com contexto próprio**; a exceção continua sendo a mudança de uma linha. O modelo do orquestrador é o resolvido em `orquestracao.modelo`; subagentes herdam (`model: inherit`).

**Modelo por alias de família, nunca por ID** (ADR-ORQ-1, D5): a config guarda `{ politica: "mais-potente", alias, resolvidoEm, validadeDias: 90 }`. Nenhum ID é pinado — IDs envelhecem em silêncio; a resolução vence em 90 dias (alinhado ao autodiagnóstico trimestral de `adocao.md §6`) e, vencida, o **cartão de sessão** diz `VENCIDO — revalide com gabarito-instalar` e o doctor emite `warn modelo-resolvido` — **aviso**: não derruba nível, não quebra CI. Se você fixar um ID por decisão registrada (custo, por exemplo), ele vence junto com a resolução (cláusula de morte do ADR).

**Cartão de sessão** (`session-card.sh` · SessionStart `startup|resume|clear|compact` · `timeout 30`): `cartao-sessao.mjs` injeta **até 40 linhas** como `additionalContext` — modelo e dias restantes · branch e sha · PBI inferido da branch (`idPadrao`, case-sensitive; `wt/<PBI>-<n>` vira PBI + índice; `main` e `chore/x` viram `(b) não inferido`) · Epic e Iniciativa do `fluxo-cache.json` ou do frontmatter em `docs/fluxo/pbis/` (ausente: `(b) não resolvido — gabarito-instalar --vincular <PBI>`) · PBIs em voo e worktrees vivos · `slots` de `capacidade.mjs` · nível do doctor em cache (`.harness/doctor-cache.json`, 24 h) · envelhecidos · ponteiro para "LER PRIMEIRO" do ledger · versão instalada × versão do plugin (`rode instalar.sh --atualizar` quando diferem) · superpowers presente/ausente **(c)** (lido de `~/.claude/plugins/installed_plugins.json`) · a linha `R21: despache, não implemente. Velocidade nunca compra concorrência.` Sem `fluxo.resolvidoEm`, o cartão é **uma linha**: `GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)`.

**Lembrete por prompt** (`remind-orchestrator.sh` · UserPromptSubmit · `timeout 5`): só com `lembretePorPrompt: true` (default `false`); injeta uma linha (`R21: despache, não implemente · slots: n`) e **nunca** bloqueia (exit 2 está fora — bloqueio inline é item do backlog com gatilho "R21 violada 3× no piloto").

**Escalada** (PAR-5): task reprovada `rodadasAntesDeEscalar` vezes (default 2) vira `BLOQUEADA` no ledger e o orquestrador **pergunta ao usuário** com o custo estimado das opções, em vez de tentar de novo.

---

## Paralelismo medido

**Subagente não roda na máquina; o que pesa é o que ele executa** (ADR-PAR-1): suíte, build, dev server, banco. O limite é por processos pesados simultâneos, **medidos antes de cada dispatch** — não por número de agentes.

`capacidade.mjs` mede cores, load de 1 min, **memória disponível** (macOS: `vm_stat` free + inactive + speculative; Linux: `/proc/meminfo MemAvailable`), disco livre no cwd e processos pesados vivos (CPU > 20 % **ou** RSS > 500 MB, **excluindo a árvore do Claude Code** — PID pai do hook e descendentes). Devolve `{ slots, motivo, medidas }` com `slots = min(simultaneos, teto, permitido pelos limites)`, nunca < 1. `GABARITO_PARALELISMO=<n>` substitui `simultaneos` na sessão, ainda ≤ `teto`. `--calibrar` sugere `simultaneos = clamp(floor(cores/4), 1, 3)` e `teto = clamp(floor(cores/2), 2, 8)` — 8 cores → 2/4; 2 cores → 1/2 — e o onboarding grava com `calibradoEm` (doctor `paralelismo-calibrado`, nível 3, 180 dias).

Vocabulário fixo (ORQ-1): **`simultaneos`** = implementadores rodando ao mesmo tempo (máquina) · **PBIs em voo** = WIP FL1 (Kanban) · **worktrees vivos** = medição. Nunca "WIP" sozinho na config.

**Contenda nunca é override** (R21, D7): task que toca qualquer caminho de `arquivosDeContenda` (default: lockfile detectado, `prisma/`, `src/index.ts`, `docs/fluxo/`) é `serial: contenda` no plano; `gabarito-conformidade` reprova grafo que paraleliza duas tasks com contenda. O orquestrador registra `DISPATCH Task <N> slots=<n> worktree wt/<PBI>-<n>` no ledger a cada dispatch (`prompts.md`, "Antes de despachar") — fixture sem linha `slots=` gera o aviso "dispatch sem medição".

**Isolamento por worktree** (PAR-4): cada implementador recebe `isolamentoWorktree` resolvido para o índice `n` do seu `wt/<PBI>-<n>` — `porta 3000+n · schema wt_{n} · namespace wt-{n}` — no bloco `Isolamento: porta X · schema Y · namespace Z — não use outro` do prompt (`n=2` → `porta 3002 · schema wt_2 · namespace wt-2`).

---

## Contexto em camadas

`AGENTS.md` é carregado em **toda** sessão (`@AGENTS.md`). Na 1.0.1 ele tinha 18.010 bytes com Apêndice vazio (M1). A 1.1.0 fixa o **teto do núcleo** (bytes antes de `## Apêndice`) em **17.291** e dá ao Apêndice orçamento próprio de **4.096** (`contexto.nucleoMaxBytes` / `contexto.apendiceMaxBytes`; doctor `agents-tamanho`, nível 2; CRLF conta bytes reais; o corte é no primeiro cabeçalho que **começa** com `## Apêndice`). Para caber, texto migrou do núcleo para a referência — regra nenhuma sumiu (ADR-CTX-1; "nada removido" vale para regra, não para bytes). O teto só sobe por decisão registrada com medição de impacto.

| Camada | O quê | Custo |
|---|---|---|
| 0 | núcleo do `AGENTS.md` | sempre, ≤ 17.291 B |
| 1 | cartão de sessão | ≤ 40 linhas por SessionStart |
| 2 | referência por ponteiro (`docs/harness/*.md`, `fluxo.md`) | sob demanda, nunca importada |
| 3 | subagente com contexto isolado, relatório ≤ 25 linhas | por dispatch |
| — | handoff por ledger (`LER PRIMEIRO`) | entre sessões |

Regra de `referencia.md §3.5`: **o orquestrador não lê saída bruta que um subagente possa resumir.** E o onboarding avisa quantos servidores MCP estão conectados — cada um custa contexto em toda sessão; `adocao.md §4` ("MCP demais no contexto") recomenda escopo de projeto (`.mcp.json`) só com o necessário.

---

## Atualizar de 1.0.x

Repos 1.0.1 **não mudam** até você rodar:

```bash
bash <plugin-root>/scripts/instalar.sh . --atualizar                      # reference/ → <arquivo>.novo + diff --stat; nada sobrescrito
bash <plugin-root>/scripts/instalar.sh . --atualizar --gates-substituir   # tools/gabarito-gates/ arquivo a arquivo, com .bak
```

- `--atualizar`: para `AGENTS.md` e `docs/harness/*.md` já existentes grava `<nome>.novo` e imprime `diff --stat` — você aplica o que quiser à mão (R2). Avisa: **"R19–R21 agora são do harness; regras de projeto passam a R30+"** — renumere o seu Apêndice. O doctor **não** roda ao fim (você ainda vai aplicar os `.novo`).
- `--gates-substituir` (exige `--atualizar`; ADR-TIM-1 — a única exceção declarada ao "nunca sobrescreve"): para cada arquivo de `gates/`, compara o hash instalado (`tools/gabarito-gates/.instalado.json`, gravado pelo instalador) com o do disco; **igual** → substitui com `.bak`; **diferente** (você editou) → grava `.novo` e avisa; ausente do `.instalado.json` (instalação 1.0.x, sem hashes) → trata como editado. A exceção morre quando os gates virarem dependência npm versionada.
- `.gitignore` recebe, sem duplicar e sem remover, `.harness/doctor-cache.json`, `.harness/fluxo-cache.json`, `*.novo`, `*.bak`.
- Depois: `gabarito-instalar` faz o onboarding (fases 2–4). Até lá o doctor 1.1.0 num repo nível 2 ou 3 **cai para 1** e diz `checagens novas da 1.1.0: rode o onboarding ou declare o nível medido` — repo em nível 0 ou 1 não muda de nível. Hooks de versionamento, cartão e conformidade ficam **fail-open** até o onboarding.

Nomes da 1.0.1 que continuam existindo (PKG-2, conferido por grep no CI): 4 skills, 3 agents, 1 command, 2 hooks, 7 gates, R1–R18, G1–G9, I1–I12. `plugin.json` continua **sem** chave `hooks`.
````

- [ ] **Seção "Hooks" (l.72 em diante)** — trocar a primeira frase `Dois \`PreToolUse\` sobre \`Bash\`. Leem o comando, inspecionam por grep (não parser — I9), bloqueiam com \`exit 2\` e devolvem o motivo em três camadas (frase → o que fazer → regra citada).` por `Três \`PreToolUse\` sobre \`Bash\` (R2, R3 e, a partir da 1.1.0, R20 — descrito em **Versionamento**), um \`SessionStart\` (cartão) e um \`UserPromptSubmit\` (lembrete, desligado por default). Os PreToolUse leem o comando, inspecionam por grep (não parser — I9), bloqueiam com \`exit 2\` e devolvem o motivo em três camadas (frase → o que fazer → regra citada).` Na subseção **Escape hatch**, no item `vale no ambiente do processo (…) — cada uma aceita a outra`, acrescentar ao fim do item: `; \`GABARITO_ALLOW_VERSIONING\` para R20 **não** cruza com nenhuma das duas`. Nada mais muda nas taxas medidas (hooks R2/R3 inalterados na 1.1.0).
- [ ] **Inserir, antes de `## Verificação do próprio pacote`**, a seção:

````markdown
## Medições da 1.1.0

Medidas em repos descartáveis (`mktemp -d`, `git init`, `instalar.sh`, sessão com `--plugin-dir` apontando para este repo), com o transcript guardado fora do repositório. O que ainda não foi medido está escrito.

| # | Medição | Resultado | Quando |
|---|---|---|---|
| M14 | **Onboarding com MCP ClickUp** — sessão interativa: número de servidores MCP avisado; `ferramenta: clickup` proposta e confirmada; ok em uma linha antes de ler; Iniciativa lida com status confirmado (I10); `fluxo` gravado com `escrita: false`; `CODEOWNERS` com as áreas informadas; `.claude/settings.json` pré-existente com `permissions` intacto após gravar `model`; `--vincular <PBI>` grava o cache **sem nenhuma chamada de escrita** no ClickUp (grep do transcript); doctor ao fim. **Mutação (ONB-1):** apagar `versionamento.resolvidoEm` e pedir "instala" → só a fase 3 roda | **NÃO MEDIDO** | — |
| M15 | **Onboarding sem MCP (`arquivos`), headless** — `docs/fluxo/` criado com `PBI-EXEMPLO.md` (`epic:` no frontmatter); PR template, `CHANGELOG.md` e `docs/backlog.md` criados só se ausentes; calibração gravada com `calibradoEm`; `settings.json` **não** gravado (sem consentimento); cartão de sessão em branch `feat/PBI-1-…` com `PBI: PBI-1 · Epic: EPIC-1` após `--vincular`, ≤ 40 linhas. **Conformidade:** design sem `Epic:` → AVISO antes do onboarding, FALTA depois; plano com T2 ∥ T3 tocando `prisma/` → "contenda (R21)"; Epic sem lista de PBIs → "Epic: PBIs (fluxo.md §2)". **Mutação de prompt:** retirar a linha "fio condutor" do checklist de design → o item some do veredito; retirar "contenda" → idem | **NÃO MEDIDO** | — |
| M16 | Contagem de testes: gates (`npm test`) · hooks (`guards.test.mjs`) · instalador (`instalar.test.sh`, casos) | <NM+NT> · <NH> · <NI> | 2026-09-24 |
````

  `<NI>` = número de casos que `instalar.test.sh` imprime ao fim (o script T10 imprime `ok N casos`; se imprimir outra forma, use o que ele imprime).
- [ ] **"Verificação do próprio pacote"** — trocar o bloco de comandos por:
  ```bash
  claude plugin validate ./plugins/gabarito-mestre --strict   # Validation passed
  claude plugin validate . --strict                            # Validation passed (marketplace)
  cd plugins/gabarito-mestre/gates && npm test                  # <NM+NT> testes (<NM> mjs + <NT> ts) — medido em 2026-09-24
  node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs               # <NH> casos: corpora R2, R3, R20, cartão, lembrete
  bash plugins/gabarito-mestre/scripts/test/instalar.test.sh                   # fixture 1.0.1 → --atualizar / --gates-substituir
  ```
  e acrescentar, após o parágrafo "Testes dos hooks", o parágrafo: `**Job \`texto\` do CI:** invariantes de texto da 1.1.0 conferidas por grep — 7 seções de \`fluxo.md\` na ordem; R19, R20, R21, "não têm override" e "R30+" no \`AGENTS.md\` (e \`§3.7\` = 0); \`§3.5\` e "Versionamento" em \`referencia.md\`; "MCP demais" em \`adocao.md\`; \`AskUserQuestion\` e nenhum \`mcp__\` no \`allowed-tools\` de \`gabarito-instalar\`; três \`version\` iguais; nenhum \`"hooks"\` em \`plugin.json\`; nenhum "77 testes"; lista de nomes da 1.0.1 presente. Cada grep é a mutação nomeada na spec, invertida.`
- [ ] **Verificar o README:**
  ```bash
  for s in 'Fluxo (Workflow TRUE)' 'Onboarding' 'Versionamento' 'Orquestração e modelo' 'Paralelismo medido' 'Contexto em camadas' 'Atualizar de 1.0.x' 'Medições da 1.1.0'; do n=$(grep -c "^## $s\$" README.md); [ "$n" -eq 1 ] || echo "FALTA seção: $s ($n)"; done
  grep -c 'NÃO MEDIDO' README.md                   # ≥ 3 (parágrafo inicial + M14 + M15)
  grep -c 'cada pessoa instala' README.md           # ≥ 1 (M3)
  grep -c 'GABARITO_ALLOW_VERSIONING' README.md     # ≥ 2
  grep -c '77 testes' README.md                     # 0
  grep -c '<NM\|<NT\|<NH\|<NI' README.md            # 0 (números medidos já escritos)
  grep -c 'R30+' README.md                          # ≥ 2
  ```
- [ ] Commit:
  ```bash
  git add CHANGELOG.md README.md CONTRIBUTING.md plugins/gabarito-mestre/gates/README.md plugins/gabarito-mestre/reference/gates.md
  git commit -m "$(cat <<'EOF'
  docs(GM-6): CHANGELOG e README da 1.1.0

  CHANGELOG [1.1.0] com Adicionado/Alterado e link de compare; README com as
  seções Fluxo (Workflow TRUE), Onboarding ("cada pessoa instala uma vez"),
  Versionamento, Orquestração e modelo, Paralelismo medido, Contexto em camadas,
  Atualizar de 1.0.x, e a tabela Medições da 1.1.0 com M14/M15 NÃO MEDIDO até
  T26; contagem de testes medida (não estimada) em README, CONTRIBUTING,
  gates/README e gates.md — "77 testes" só sobrevive no histórico do CHANGELOG.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

### Passos — `.github/workflows/ci.yml`

- [ ] Substituir o arquivo inteiro por (SHAs das ações mantidos):

````yaml
# CI do repositório do plugin. Ações pinadas por SHA (referencia.md §10).
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    name: claude plugin validate --strict
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - run: npm install -g @anthropic-ai/claude-code
      - run: claude plugin validate ./plugins/gabarito-mestre --strict
      - run: claude plugin validate . --strict

  gates:
    name: gates — node --test (mjs + ts)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - run: cd plugins/gabarito-mestre/gates && npm test

  instalador:
    name: instalar.sh — fixture 1.0.1, --atualizar, --gates-substituir (bash ${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - run: bash --version | head -1
      - run: bash plugins/gabarito-mestre/scripts/test/instalar.test.sh

  hooks:
    name: hooks — corpora (bash ${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - run: bash --version | head -1
      - run: node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs

  texto:
    name: texto — invariantes da 1.1.0 (grep)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - name: fluxo.md — 7 seções (FLX-1)
        run: |
          set -eu
          F=plugins/gabarito-mestre/reference/fluxo.md
          n=$(grep -c '^## ' "$F"); [ "$n" -eq 7 ] || { echo "fluxo.md: $n seções, esperado 7"; exit 1; }
          # ORDEM, não só contagem — os 7 títulos exatos da Fase 1 (T2, FLX-1)
          diff <(grep '^## ' "$F") <(printf '%s\n' \
            '## 1. Os três níveis' \
            '## 2. Os oito tipos de card' \
            '## 3. Políticas gerais' \
            '## 4. Colunas e regras de movimento' \
            '## 5. Propagação entre níveis' \
            '## 6. Ponto de compromisso, WIP e vazão por nível' \
            '## 7. Métricas medem item, nunca pessoa') || { echo "fluxo.md: seções fora da ordem/título da Fase 1"; exit 1; }
          grep '^## ' "$F" | nl
      - name: AGENTS.md — R19, R20, R21, R30+, sem §3.7 (FLX-4, VER-4, ORQ-2, CTX-1)
        run: |
          set -eu
          A=plugins/gabarito-mestre/reference/AGENTS.md
          grep -q 'R19' "$A" && grep -q 'R20' "$A" && grep -q 'R21' "$A"
          grep -q 'não têm override' "$A"
          grep -q 'R30+' "$A"
          [ "$(grep -c '§3.7' "$A")" -eq 0 ] || { echo "AGENTS.md ainda cita §3.7"; exit 1; }
          [ "$(grep -c 'R19+' "$A")" -eq 0 ] || { echo "AGENTS.md ainda diz R19+"; exit 1; }
          node -e "
            const t=require('fs').readFileSync('$A','utf8');
            const i=t.search(/^## Apêndice/m); const nucleo=Buffer.byteLength(i<0?t:t.slice(0,i));
            const ap=i<0?0:Buffer.byteLength(t.slice(i));
            console.log('núcleo', nucleo, 'B · apêndice', ap, 'B');
            if(nucleo>17291){console.error('núcleo acima do teto 17.291');process.exit(1)}
            if(ap>4096){console.error('apêndice (vazio) acima de 4.096');process.exit(1)}"
      - name: referencia.md / adocao.md / prompts.md (FLX-7, CTX-2, CTX-3, TIM-1, PAR-4)
        run: |
          set -eu
          R=plugins/gabarito-mestre/reference/referencia.md
          D=plugins/gabarito-mestre/reference/adocao.md
          Q=plugins/gabarito-mestre/reference/prompts.md
          [ "$(grep -c 'Sem sprint, sem timebox, sem WIP formal' "$R")" -eq 0 ]
          grep -q '^### 3.5' "$R" && grep -q 'ADR-FLX-1' "$R" && grep -q 'Versionamento' "$R"
          grep -q 'MCP demais' "$D"
          [ "$(grep -c 'assume orquestração por uma pessoa sênior' "$D")" -eq 0 ]
          grep -q 'Isolamento: porta' "$Q" && grep -q 'Antes de despachar' "$Q"
          grep -q 'Isolamento: porta' plugins/gabarito-mestre/agents/gabarito-implementador.md
      - name: skills (ONB-8, CNF-1)
        run: |
          set -eu
          S=plugins/gabarito-mestre/skills/gabarito-instalar/SKILL.md
          C=plugins/gabarito-mestre/skills/gabarito-conformidade/SKILL.md
          sed -n '/^allowed-tools:/p' "$S" | grep -q 'AskUserQuestion'
          sed -n '/^allowed-tools:/p' "$S" | grep -q 'Edit'
          sed -n '/^allowed-tools:/p' "$S" | grep -q 'Bash(claude mcp list:\*)'
          [ "$(sed -n '/^allowed-tools:/p' "$S" | grep -c 'mcp__')" -eq 0 ]
          [ "$(grep -c '^## Fase ' "$S")" -eq 4 ]
          grep -q 'fio condutor' "$C" && grep -q 'contenda (R21)' "$C" && grep -q 'Epic: PBIs (fluxo.md §2)' "$C"
      - name: pacote — versões, hooks, 77, nomes da 1.0.1 (PKG-1, PKG-2)
        run: |
          set -eu
          v1=$(node -p "require('./plugins/gabarito-mestre/.claude-plugin/plugin.json').version")
          v2=$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].version")
          v3=$(node -p "require('./plugins/gabarito-mestre/gates/package.json').version")
          [ "$v1" = "$v2" ] && [ "$v2" = "$v3" ] || { echo "versions divergem: $v1 $v2 $v3"; exit 1; }
          echo "version $v1 nos três manifestos"
          [ "$(grep -c '"hooks"' plugins/gabarito-mestre/.claude-plugin/plugin.json)" -eq 0 ] || { echo 'plugin.json não pode ter "hooks"'; exit 1; }
          n=$(grep -rn '77 testes' plugins/gabarito-mestre README.md CONTRIBUTING.md --include='*.md' --include='*.yml' --include='*.sh' --include='*.json' | wc -l | tr -d ' ')
          [ "$n" -eq 0 ] || { echo "'77 testes' ainda aparece ($n)"; exit 1; }
          P=plugins/gabarito-mestre
          for f in skills/gabarito-instalar/SKILL.md skills/gabarito-conformidade/SKILL.md skills/gabarito-review/SKILL.md skills/gabarito-spike/SKILL.md \
                   agents/gabarito-implementador.md agents/gabarito-revisor.md agents/gabarito-spike.md commands/gabarito-doctor.md \
                   hooks/guard-destructive.sh hooks/guard-production.sh hooks/guard-versioning.sh hooks/session-card.sh hooks/remind-orchestrator.sh \
                   gates/src/mass-mutation-guard.ts gates/src/production-host-guard.ts gates/eslint/no-unfiltered-mass-mutation.js \
                   gates/scripts/migrations-guard.mjs gates/scripts/deploy-order-check.mjs gates/scripts/quality-ratchet.mjs gates/scripts/harness-doctor.mjs \
                   gates/scripts/onboarding-config.mjs gates/scripts/capacidade.mjs gates/scripts/versionamento-check.mjs gates/scripts/cartao-sessao.mjs; do
            test -f "$P/$f" || { echo "ausente: $f"; exit 1; }
          done
          A=$P/reference/AGENTS.md
          # fronteira de palavra escrita à mão: portável entre GNU grep (Ubuntu) e BSD grep (macOS)
          for r in $(seq 1 18); do grep -qE "(^|[^A-Z0-9])R$r([^0-9]|$)" "$A" || { echo "R$r ausente do AGENTS.md"; exit 1; }; done
          for g in $(seq 1 9);  do grep -qE "(^|[^A-Z0-9])G$g([^0-9]|$)" "$A" || { echo "G$g ausente do AGENTS.md"; exit 1; }; done
          for i in $(seq 1 12); do grep -qE "(^|[^A-Z0-9])I$i([^0-9]|$)" "$A" || { echo "I$i ausente do AGENTS.md"; exit 1; }; done
          echo "nomes da 1.0.1 presentes: 4 skills, 3 agents, 1 command, 2 hooks (+3), 7 gates (+4 scripts), R1–R18, G1–G9, I1–I12"

  doctor-self:
    name: doctor não se auto-detecta (M10)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '22'
      - run: |
          node plugins/gabarito-mestre/gates/scripts/harness-doctor.mjs --json > out.json
          node -e "const j=require('./out.json');const bad=j.resultados.filter(r=>r.found&&/gabarito-mestre\//.test(r.evidence||''));if(bad.length){console.error('auto-detecção:',bad.map(r=>r.id));process.exit(1)}console.log('ok — nenhuma evidência vinda do plugin')"
````

- [ ] **Rodar o job `texto` localmente antes de commitar** — é bash puro e os greps são portáveis (sem `\b`); extrair os blocos `run: |` que ficam entre `  texto:` e `  doctor-self:` para um script temporário e executar da raiz do repo:
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre
  node -e "
    const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8');
    const ini=y.indexOf('\n  texto:'), fim=y.indexOf('\n  doctor-self:');
    const m=y.slice(ini,fim).split('\n'); let out=['set -eu'],on=false;
    for(const l of m){ if(/^\s+run: \|$/.test(l)){on=true;continue;} if(on&&/^\s{10}\S/.test(l)){out.push(l.slice(10));continue;} if(on&&/^\s{0,9}\S/.test(l)){on=false;} }
    require('fs').writeFileSync(process.env.HOME+'/.cache/gm-ci-texto.sh',out.join('\n'));" && mkdir -p ~/.cache && bash ~/.cache/gm-ci-texto.sh; echo "exit=$?"
  ```
  Esperado: `exit=0` e as linhas `version 1.1.0 nos três manifestos` e `nomes da 1.0.1 presentes`. Falha local em um grep = falha no CI: conserte o texto, não o grep.
- [ ] Commit:
  ```bash
  git add .github/workflows/ci.yml
  git commit -m "$(cat <<'EOF'
  chore(GM-6): ci.yml roda instalar.test.sh e os greps de invariantes da 1.1.0

  Job gates sem número no nome; job instalador (Ubuntu + macOS); job texto com
  as mutações da spec invertidas: 7 seções de fluxo.md, R19/R20/R21/R30+ e
  §3.7 = 0 no AGENTS.md com teto de bytes, §3.5/Versionamento, MCP demais,
  AskUserQuestion sem mcp__, três version iguais, sem "hooks" em plugin.json,
  sem "77 testes", nomes da 1.0.1 presentes.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```
- [ ] Ledger: `Task T25: DONE (sha; NM/NT/NH/NI medidos; greps locais exit=0; validate --strict ok nos dois manifestos)`.

---

## T26 — Medição M14/M15 em dois repos descartáveis

**Fecha:** REQ-PKG-1 (números no README), ONB-1..6 e ONB-8 (manual), TIM-1 (CODEOWNERS), CNF-1/FLX-3/FLX-5/PAR-3 (manual + mutação de prompt), ORQ-3/ORQ-6 (cartão após `--vincular`).
**Arquivos:** `README.md` (linhas M14/M15/M16 da tabela e a data do parágrafo inicial) · `docs/ledgers/GM-6.md` (registro literal). Nada mais.
**Aceite:** Given os dois repos descartáveis · When as sessões rodam · Then cada célula "Resultado" de M14/M15 no README tem número, veredito literal e data, e o ledger tem a saída resumida com o caminho do transcript. Given a mutação de prompt · When conformidade roda sobre a cópia mutada · Then o item "fio condutor (R19)" **some** do veredito (e "contenda (R21)" idem) — se não sumir, isso é achado, não conserto.

**Regras da medição:** só leitura no ClickUp (M14), com o ok nominal do usuário dentro da sessão; transcripts ficam **fora** do repo (podem carregar nomes de cards); nenhum `rm -rf` sem hatch e ok do usuário (R2) — repos descartáveis podem ficar em `mktemp` até o sistema limpar; a mutação de prompt roda sobre **cópia** do plugin, nunca sobre a árvore de trabalho; nada mais roda na máquina durante `capacidade.mjs --calibrar`.

### Preparação comum

- [ ] Variáveis e função headless (bash da sessão do executor; caminhos absolutos):
  ```bash
  REPO=/Users/gabs-dev/projetos_pessoais/gabarito-mestre
  PLUG="$REPO/plugins/gabarito-mestre"
  TOOLS='Skill,Read,Glob,Grep,Edit,AskUserQuestion,Bash(bash:*),Bash(node:*),Bash(ls:*),Bash(cat:*),Bash(cp:*),Bash(mkdir:*),Bash(git status:*),Bash(git rev-parse:*),Bash(claude mcp list:*),Bash(git diff:*),Bash(git log:*),Bash(wc:*)'
  HOJE=$(date +%F)
  # gm <prefixo-de-saída> <prompt>  — headless, SEM MCP, plugin da variável PLUG; imprime o texto e guarda o JSON (turns, ms, custo)
  gm() {
    claude -p --output-format json --plugin-dir "$PLUG" --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
      --permission-mode acceptEdits --allowedTools "$TOOLS" --max-turns 80 "$2" > "$1.json"
    node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.result);console.error("turns="+j.num_turns+" ms="+j.duration_ms+" usd="+j.total_cost_usd+" is_error="+j.is_error)' "$1.json" | tee "$1.txt"
  }
  cd "$REPO" && git checkout enabler/GM-6-pacote && claude plugin validate "$PLUG" --strict
  ```
- [ ] Fixtures de conformidade (mesmo texto para M14 e M15); função que as escreve no repo corrente:
  ```bash
  fixtures() {
    mkdir -p docs/specs docs/plans docs/fluxo/epics docs/fluxo/pbis
    cat > docs/specs/design-sem-epic.md <<'EOF'
  # Design — exportador de relatórios
  Iniciativa: INI-1
  **STATUS: DESENHO PRONTO.** Nada implementado.
  ## Fatos medidos
  | M1 | 1.200 linhas por relatório | 2026-09-24 | n/a |
  ## Decisões
  | D1 | CSV, não XLSX | XLSX rejeitado: dependência pesada | não reabrir |
  ## Requisitos
  **REQ-EXP-1** — Given 1.200 linhas · When exporto · Then CSV em menos de 2 s.
  ## Fora de escopo
  | XLSX | Gabriel | 3 pedidos de cliente |
  ## Testes e gates
  | REQ-EXP-1 | teste de tempo | remover o streaming |
  ## Rollout
  1. exportador — motivo: sem dependência nova. Janela: nenhuma.
  ## Pendências
  nenhuma.
  EOF
    cat > docs/plans/plano-contenda.md <<'EOF'
  # Plano — PBI-12 exportador
  PBI: PBI-12
  Epic: EPIC-1
  ## Grafo
  T1 → (T2 ∥ T3)
  ## Tasks
  ### T1 · tipo: Enabler · fecha REQ-EXP-1 · arquivos: src/export.ts · aceite: Given/When/Then em docs/specs/design-sem-epic.md:9
  ### T2 · tipo: US · fecha REQ-EXP-1 · arquivos: prisma/schema.prisma, src/a.ts · aceite: idem
  ### T3 · tipo: US · fecha REQ-EXP-1 · arquivos: prisma/migrations/001.sql, src/b.ts · aceite: idem
  EOF
    cat > docs/fluxo/epics/EPIC-1.md <<'EOF'
  ---
  id: EPIC-1
  tipo: Epic
  iniciativa: INI-1
  status: Preparado
  ---
  # EPIC-1 — Exportação de relatórios
  ## Narrativa
  Clientes pedem os relatórios em arquivo.
  Hoje copiam da tela.
  Erram colunas.
  Suporte recebe o retrabalho.
  Exportar em CSV resolve o caso comum.
  XLSX fica para depois.
  Meta: zero tickets de "coluna errada" em 30 dias.
  ## RN
  - RN1: só o dono do relatório exporta.
  ## CA
  - Given relatório com 1.200 linhas · When exporto · Then CSV íntegro em menos de 2 s.
  EOF
    cat > docs/fluxo/pbis/PBI-1.md <<'EOF'
  ---
  id: PBI-1
  tipo: US
  epic: EPIC-1
  iniciativa: INI-1
  status: Preparado
  ---
  # PBI-1 — Exportar CSV
  Como dono do relatório, quero exportar em CSV, para enviar sem copiar da tela.
  ## RN
  - RN1: só o dono exporta.
  ## CA
  - Given 1.200 linhas · When exporto · Then CSV em menos de 2 s.
  EOF
  }
  ```

### M15 — sem MCP, headless (`ferramenta: arquivos`)

- [ ] Repo descartável com sinais de contenda reais (lockfile, `prisma/`, `src/index.ts`):
  ```bash
  R15="$(mktemp -d "${TMPDIR:-/tmp}/gm-m15.XXXXXX")"; echo "$R15" | tee -a "$REPO/docs/ledgers/GM-6.md"
  cd "$R15" && git init -q -b main && git config user.email m15@example.invalid && git config user.name M15
  printf '{ "name": "m15", "private": true }\n' > package.json; printf 'lockfileVersion: 9\n' > pnpm-lock.yaml
  mkdir -p prisma src && : > prisma/schema.prisma && : > src/index.ts
  git add -A && git commit -q -m "chore: raiz do repo descartável M15"
  ```
- [ ] **Fase 1 (instalador) e conformidade ANTES do onboarding** — mede o fail-open de FLX-3:
  ```bash
  bash "$PLUG/scripts/instalar.sh" "$R15" 2>&1 | tee m15-1-instalar.txt
  grep -c '  criado' m15-1-instalar.txt; test -f tools/gabarito-gates/.instalado.json && echo ".instalado.json ok"; grep -c 'fluxo-cache' .gitignore
  grep 'Nível alcançado' m15-1-instalar.txt
  fixtures
  gm m15-2-conf-antes "use a skill gabarito-conformidade e confira docs/specs/design-sem-epic.md contra o gabarito"
  grep -n 'AVISO' m15-2-conf-antes.txt | head -5        # esperado: a linha do item "Fio condutor" com AVISO; veredito NÃO muda por ele
  grep -c 'sem onboarding' m15-2-conf-antes.txt          # ≥ 1 (linha Fluxo:)
  ```
- [ ] **Onboarding headless** (sem `AskUserQuestion`: defaults marcados (b); consentimento de settings = não):
  ```bash
  date +%T | tee m15-3-inicio.txt
  gm m15-3-onboarding "use a skill gabarito-instalar: instala o gabarito neste repositório e faz o onboarding completo. Não há ferramenta de planejamento — use arquivos. A Iniciativa é INI-1, 'Exportação de relatórios'. Áreas: src/ → @gabrielnfc; prisma/ → @gabrielnfc."
  date +%T | tee m15-3-fim.txt
  node -p "const c=require('./harness.config.json');[c.fluxo.resolvidoEm,c.fluxo.ferramenta,c.fluxo.escrita,c.versionamento.resolvidoEm,c.orquestracao.modelo.resolvidoEm,c.orquestracao.modelo.alias,c.orquestracao.paralelismo.calibradoEm,c.orquestracao.paralelismo.simultaneos,c.orquestracao.paralelismo.teto,JSON.stringify(c.orquestracao.paralelismo.arquivosDeContenda),c._comment?'_comment ok':'_comment PERDIDO',c.deployOrder?'deployOrder ok':'deployOrder PERDIDO'].join(' | ')"
  # esperado: <hoje> | arquivos | false | <hoje> | <hoje> | fable | <hoje> | <n> | <m> | ["pnpm-lock.yaml","prisma/","src/index.ts","docs/fluxo/"] | _comment ok | deployOrder ok
  ls docs/fluxo/iniciativa.md docs/fluxo/epics/EPIC-EXEMPLO.md docs/fluxo/pbis/PBI-EXEMPLO.md && grep '^epic:' docs/fluxo/pbis/PBI-EXEMPLO.md
  ls .github/PULL_REQUEST_TEMPLATE.md CHANGELOG.md docs/backlog.md .github/CODEOWNERS && wc -l < .github/CODEOWNERS   # 3 (comentário + 2 áreas)
  test -e .claude/settings.json && echo "ERRO: settings gravado sem consentimento" || echo "settings.json não gravado (correto)"
  grep -c '(b)' m15-3-onboarding.txt                     # ≥ 3 — a lista "o que ficou (b)"
  grep -n 'Nível alcançado' m15-3-onboarding.txt
  grep -c 'Áreas e donos\|^| Fluxo:' AGENTS.md            # ≥ 2 (Apêndice preenchido — rótulos reais das linhas `| Fluxo: ferramenta · …` e `| Áreas e donos (\`.github/CODEOWNERS\`)` da Fase 4, 17.3)
  node "$PLUG/gates/scripts/harness-doctor.mjs" --explain 2>&1 | grep -E 'fluxo-configurado|versionamento|changelog|agents-tamanho|paralelismo-calibrado|modelo-resolvido|Nível alcançado'
  ```
- [ ] **Conformidade DEPOIS do onboarding** — os três vereditos de CNF-1/FLX-3/PAR-3:
  ```bash
  gm m15-4-conf-design "use a skill gabarito-conformidade e confira docs/specs/design-sem-epic.md contra o gabarito"
  grep -c 'NÃO CONFORME' m15-4-conf-design.txt; grep -n 'Fio condutor\|fio condutor' m15-4-conf-design.txt | head -3   # FALTA
  gm m15-5-conf-plano "use a skill gabarito-conformidade e confira docs/plans/plano-contenda.md contra o gabarito"
  grep -n 'contenda (R21)' m15-5-conf-plano.txt | head -3                                                               # FALTA, cita T2/T3 e prisma/
  gm m15-6-conf-epic "use a skill gabarito-conformidade e confira o card docs/fluxo/epics/EPIC-1.md contra o gabarito"   # EPIC-1.md não tem lista de PBIs, de propósito
  grep -n 'Epic: PBIs (fluxo.md §2)' m15-6-conf-epic.txt | head -3                                                      # FALTA
  ```
- [ ] **Mutação de prompt** (a prova de que o item é o que reprova) — sobre cópia do plugin:
  ```bash
  MUT="$(mktemp -d "${TMPDIR:-/tmp}/gm-mut.XXXXXX")/gabarito-mestre"; cp -R "$PLUG" "$MUT"
  node -e "const fs=require('fs');const p=process.argv[1];let t=fs.readFileSync(p,'utf8');const antes=t.split('\n').length;
    t=t.split('\n').filter(l=>!/^\| 12 \| \*\*Fio condutor/.test(l)).join('\n');fs.writeFileSync(p,t);console.log('linhas',antes,'→',t.split('\n').length)" "$MUT/skills/gabarito-conformidade/SKILL.md"   # −1 linha
  PLUG_ORIG="$PLUG"; PLUG="$MUT"
  gm m15-7-mut-fio "use a skill gabarito-conformidade e confira docs/specs/design-sem-epic.md contra o gabarito"
  grep -c 'Fio condutor\|fio condutor' m15-7-mut-fio.txt   # esperado 0 na tabela (o item sumiu). Se ainda aparecer como FALTA: remover também a frase "itens de fio condutor reprovam" da Pré-conferência na cópia, repetir, e registrar os dois resultados
  PLUG="$PLUG_ORIG"; cp -R "$PLUG_ORIG" "$MUT.2" && PLUG="$MUT.2"
  node -e "const fs=require('fs');const p=process.argv[1];let t=fs.readFileSync(p,'utf8');t=t.split('\n').filter(l=>!/^\| 11 \| \*\*Contenda serial/.test(l)).join('\n');fs.writeFileSync(p,t)" "$MUT.2/skills/gabarito-conformidade/SKILL.md"
  gm m15-8-mut-contenda "use a skill gabarito-conformidade e confira docs/plans/plano-contenda.md contra o gabarito"
  grep -c 'contenda (R21)' m15-8-mut-contenda.txt          # esperado 0 (item 7 "recurso compartilhado" pode ainda reprovar por outro nome — registrar o texto literal)
  PLUG="$PLUG_ORIG"
  ```
- [ ] **`--vincular` e cartão de sessão** (ORQ-6 + ORQ-3 ponta a ponta):
  ```bash
  gm m15-9-vincular "use a skill gabarito-instalar no modo --vincular PBI-1"
  cat .harness/fluxo-cache.json                              # {"PBI-1":{"epic":"EPIC-1","iniciativa":"INI-1","titulo":"…","em":"<hoje>"}}
  grep -c '^VINCULO PBI-1' docs/ledgers/PBI-1.md             # 1
  git checkout -q -b feat/PBI-1-exportar-csv
  node "$PLUG/gates/scripts/cartao-sessao.mjs" --root . --plugin-root "$PLUG" | tee m15-10-cartao.txt
  wc -l < m15-10-cartao.txt                                   # ≤ 40
  grep -c 'PBI: PBI-1 · Epic: EPIC-1 · Iniciativa: INI-1' m15-10-cartao.txt   # 1
  grep -c 'fonte: cache' m15-10-cartao.txt                    # 1
  ```
- [ ] **Mutação por fase (ONB-1), headless:** apagar `versionamento.resolvidoEm` e pedir "instala" → só a fase 3:
  ```bash
  git checkout -q main
  node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('harness.config.json','utf8'));delete c.versionamento.resolvidoEm;fs.writeFileSync('harness.config.json',JSON.stringify(c,null,2)+'\n')"
  F2=$(node -p "require('./harness.config.json').fluxo.resolvidoEm"); F4=$(node -p "require('./harness.config.json').orquestracao.modelo.resolvidoEm")
  gm m15-11-fase3 "use a skill gabarito-instalar: instala o gabarito"
  grep -c 'Fase 3\|fase 3' m15-11-fase3.txt                  # ≥ 1 (informativo)
  grep -c 'vou LER na ferramenta\|família' m15-11-fase3.txt  # 0 — nenhuma pergunta das fases 2 e 4
  node -p "const c=require('./harness.config.json');[c.fluxo.resolvidoEm==='$F2',c.orquestracao.modelo.resolvidoEm==='$F4',c.versionamento.resolvidoEm].join(' ')"   # true true <hoje> — esta linha é a prova
  ```
- [ ] Registrar no ledger (literal, uma linha por medição): caminho `$R15`, `criados` da fase 1, nível do doctor antes/depois, os três vereditos (texto da linha do item), os dois resultados da mutação de prompt (com `turns/ms/usd` de cada `gm`), o cartão (linhas e a linha `PBI:`), e o resultado da mutação por fase. Tempo de parede do onboarding: `m15-3-inicio.txt` → `m15-3-fim.txt`.

### M14 — com MCP ClickUp, interativo

- [ ] Pré-requisito medido, não presumido: `claude mcp list` mostra o servidor do ClickUp (na máquina de origem é o conector `claude_ai_ClickUp`, tools `mcp__claude_ai_ClickUp__*`); o usuário escolhe **uma Iniciativa real** para leitura e **um PBI real** para `--vincular`, e diz em voz alta que a leitura está autorizada (fica no transcript). Nenhuma escrita: a skill não tem como (só com `escrita: true`, que não será dado).
- [ ] Repo descartável com `settings.json` pré-existente (mede o "byte a byte" de ONB-5):
  ```bash
  R14="$(mktemp -d "${TMPDIR:-/tmp}/gm-m14.XXXXXX")"; echo "$R14" | tee -a "$REPO/docs/ledgers/GM-6.md"
  cd "$R14" && git init -q -b main && git config user.email m14@example.invalid && git config user.name M14
  printf '{ "name": "m14", "private": true }\n' > package.json; printf '{}\n' > package-lock.json
  mkdir -p .claude && printf '{\n  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] }\n}\n' > .claude/settings.json
  PERM_ANTES=$(node -p "JSON.stringify(require('./.claude/settings.json').permissions)")
  git add -A && git commit -q -m "chore: raiz do repo descartável M14"
  bash "$PLUG/scripts/instalar.sh" "$R14" 2>&1 | tee m14-1-instalar.txt
  ```
- [ ] Sessão interativa capturada (macOS: `script -q <arquivo> <comando>`); o plugin vem de `--plugin-dir`, o MCP do ClickUp vem da configuração normal da máquina:
  ```bash
  date +%T | tee m14-2-inicio.txt
  script -q "$R14/m14-2-onboarding.log" claude --plugin-dir "$PLUG"
  ```
  Dentro da sessão, nesta ordem, anotando o que a skill imprime:
  1. `instala o gabarito e faz o onboarding` → anotar a linha `<N> servidores MCP conectados` (N literal) e a proposta `ferramenta: clickup · mcp: claude_ai_ClickUp`; confirmar.
  2. Na linha `vou LER na ferramenta ClickUp … ok?` → responder `ok`. Informar a Iniciativa escolhida; anotar se a skill **confirmou o status** (I10) e o que leu (nome, URL sem token — conferir que a URL gravada não tem `?` com token).
  3. Responder as perguntas fechadas com os defaults, **exceto** "escrita autorizada?" → `não`; áreas: duas (`src/` e `docs/`), donos `@gabrielnfc`.
  4. Fase 3: `sim` ao trunk-based e ao mapa de prefixos.
  5. Fase 4: alias `fable`; no diff do `settings.json`, responder **(i) sim** e **(ii) sim** (repo descartável; mede o caminho de gravação); confirmar `simultaneos`/`teto` sugeridos e a lista de contenda — esperado `package-lock.json` (lockfile detectado) e `docs/fluxo/` (a skill o inclui sempre, é o default do contrato, mesmo com ClickUp); anotar a lista literal.
  6. Anotar a lista "o que ficou (b)" e o nível do doctor. `/exit`.
  ```bash
  date +%T | tee m14-2-fim.txt
  PERM_DEPOIS=$(node -p "JSON.stringify(require('./.claude/settings.json').permissions)"); [ "$PERM_ANTES" = "$PERM_DEPOIS" ] && echo "permissions byte a byte: ok" || echo "ERRO permissions mudou"
  node -p "const s=require('./.claude/settings.json');[s.model,JSON.stringify(s.enabledPlugins),JSON.stringify(s.extraKnownMarketplaces)].join(' | ')"
  # esperado: fable | {"gabarito-mestre@gabarito-mestre":true} | {"gabarito-mestre":{"source":{"source":"github","repo":"gabrielnfc/gabarito-mestre"}}}
  node -p "const c=require('./harness.config.json');[c.fluxo.ferramenta,c.fluxo.mcp,c.fluxo.escrita,c.fluxo.iniciativa.id,/[?&](token|key|sig)=/.test(c.fluxo.iniciativa.url)?'URL COM TOKEN':'url limpa',c.fluxo.resolvidoEm,c.versionamento.resolvidoEm,c.orquestracao.modelo.resolvidoEm].join(' | ')"
  wc -l < .github/CODEOWNERS      # 3
  grep -c 'servidores MCP conectados' m14-2-onboarding.log        # ≥ 1
  grep -c 'clickup_update\|clickup_create\|clickup_add\|clickup_move\|clickup_delete\|clickup_merge' m14-2-onboarding.log   # 0 — nenhuma tool de escrita chamada
  ```
- [ ] **`--vincular` com PBI real** (só leitura; prova por grep no transcript):
  ```bash
  script -q "$R14/m14-3-vincular.log" claude --plugin-dir "$PLUG"
  #   na sessão: "gabarito-instalar --vincular <ID real>"  → ok à leitura → /exit
  cat .harness/fluxo-cache.json; grep -c '^VINCULO' docs/ledgers/<ID real>.md
  grep -c 'clickup_update\|clickup_create\|clickup_add\|clickup_move\|clickup_delete\|clickup_merge' m14-3-vincular.log   # 0
  grep -c 'ferramenta não atualizada (escrita não autorizada)' m14-3-vincular.log   # 1 se o card não estava "em execução"; registrar
  ```
- [ ] **Mutação por fase (ONB-1), interativa** — a da spec (l.286):
  ```bash
  node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('harness.config.json','utf8'));delete c.versionamento.resolvidoEm;fs.writeFileSync('harness.config.json',JSON.stringify(c,null,2)+'\n')"
  script -q "$R14/m14-4-fase3.log" claude --plugin-dir "$PLUG"
  #   na sessão: "instala o gabarito" → deve rodar SÓ a fase 3 (uma pergunta: trunk-based) → /exit
  grep -c 'vou LER na ferramenta' m14-4-fase3.log             # 0 (fase 2 não rodou)
  grep -c 'família' m14-4-fase3.log                           # 0 (fase 4 não rodou)
  node -p "require('./harness.config.json').versionamento.resolvidoEm"   # <hoje>
  ```
- [ ] Registrar no ledger: `$R14`, N de servidores MCP, Iniciativa (só o ID — nome e URL ficam no transcript, fora do repo), status confirmado sim/não, vereditos dos greps (escrita = 0), `permissions byte a byte: ok`, CODEOWNERS 3 linhas, nível do doctor, tempo de parede (`m14-2-inicio.txt` → `m14-2-fim.txt`), resultado da mutação por fase. Transcripts (`*.log`) **não** entram no repo.

### Escrever os números no README

- [ ] `README.md`, tabela "Medições da 1.1.0" — substituir as duas células `**NÃO MEDIDO**` e os `—` de "Quando". Forma exata de cada célula "Resultado" (texto corrido, separadores `·`, números literais):
  - **M14:** `<N> servidores MCP avisados · clickup detectado e confirmado · ok pedido antes da leitura · Iniciativa <ID> lida, status <confirmado|não confirmado> (I10) · escrita: false · CODEOWNERS 3 linhas · permissions byte a byte: ok, model/enabledPlugins/extraKnownMarketplaces gravados com 2 oks · --vincular <ID>: cache gravado, 0 chamadas de escrita no ClickUp (grep do transcript) · doctor: nível <n> · mutação ONB-1: só a fase 3 rodou (<sim|não>) · <t> min de parede`
  - **M15:** `docs/fluxo/ criado (PBI-EXEMPLO.md com epic:) · PR template, CHANGELOG, backlog criados · calibradoEm <data>, simultaneos <n>, teto <m> · settings.json não gravado · cartão: <k> linhas, "PBI: PBI-1 · Epic: EPIC-1 · Iniciativa: INI-1 (fonte: cache)" · conformidade: design sem Epic → AVISO antes / FALTA depois (<sim|não>) · contenda (R21) em T2/T3 (<sim|não>) · Epic: PBIs (<sim|não>) · mutação de prompt: fio condutor sumiu (<sim|não>, <turns/usd>) · contenda sumiu (<sim|não>) · mutação ONB-1 headless: só fase 3 (<sim|não>) · <t> min de parede, <usd> no total`
  - "Quando": `$HOJE` nas duas linhas.
  Qualquer `<não>` fica escrito como está — resultado refutado é resultado; vira item de backlog (`docs/backlog.md` deste repo, `| Item | Origem | Gatilho |`) com origem `M14`/`M15`, **não** conserto nesta fase.
- [ ] Parágrafo inicial do README: a frase `Os números da 1.1.0 estão na seção **Medições da 1.1.0**, cada um com a própria data.` permanece; nenhum "NÃO MEDIDO" deve sobrar na tabela: `grep -c 'NÃO MEDIDO' README.md` → **1** (só o parágrafo inicial, que explica a convenção).
- [ ] Custo de contexto do plugin (registro no ledger; opcional no README): `claude plugin details "$PLUG"` → anotar o "projected token cost".
- [ ] Verificação final do pacote:
  ```bash
  cd "$REPO"
  claude plugin validate ./plugins/gabarito-mestre --strict && claude plugin validate . --strict
  grep -c 'NÃO MEDIDO' README.md    # 1
  grep -n '| M14 \|| M15 \|| M16 ' README.md
  git status --short                # só README.md e docs/ledgers/GM-6.md (e docs/backlog.md se houve refutação)
  ```
- [ ] Commit:
  ```bash
  git add README.md docs/ledgers/GM-6.md docs/backlog.md
  git commit -m "$(cat <<'EOF'
  docs(GM-6): M14/M15 medidos em repos descartáveis

  M14 (onboarding com MCP ClickUp, interativo): servidores contados, Iniciativa
  lida com status, escrita false, CODEOWNERS, settings.json emendado com
  permissions intacto, --vincular sem chamada de escrita, mutação ONB-1.
  M15 (sem MCP, headless): docs/fluxo/, arquivos da fase 3, calibração, cartão
  de sessão após --vincular, três vereditos da conformidade e mutação de prompt
  (fio condutor · contenda). Números literais no README; transcripts fora do repo.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```
- [ ] Repos descartáveis: **não apagar** nesta task. Se o usuário pedir limpeza, é ele quem autoriza, com hatch nominal: `GABARITO_ALLOW_DESTRUCTIVE="autorizado por <usuário> em $HOJE — repos descartáveis M14/M15" rm -rf "$R14" "$R15" "$MUT" "$MUT.2"`.

---

## Fecho da fase (orquestrador)

- [ ] Review adversarial sobre o diff integrado de T25 + T26. Mutações prescritas: **T25** — voltar um `version` a `1.0.1` → job `texto` falha; acrescentar `"hooks": "./hooks/hooks.json"` ao `plugin.json` → job `texto` falha (e `validate --strict` **não** pega — é por isso que o grep existe); reintroduzir "77 testes" no README → falha; apagar `hooks/session-card.sh` da lista de nomes → o grep de nomes deixa de proteger o arquivo (o revisor confere que a lista cobre os 3 hooks novos e os 4 scripts). **T26** — trocar um número medido por outro no README → o ledger contradiz (o revisor confere ledger × README linha a linha).
- [ ] Gate de fase medido e escrito no ledger: `3 version = 1.1.0 · validate --strict ok (plugin e marketplace) · README M14/M15 com números e data · CI: 6 jobs verdes no PR · "77 testes" = 0 fora do CHANGELOG`.
- [ ] PR `enabler/GM-6-pacote` → `main`, título `enabler(GM-6): pacote 1.1.0 — manifestos, CHANGELOG, README, CI e medições M14/M15` — **só com ok do usuário** (R1). Depois do merge, ainda com ok: tag `gabarito-mestre--v1.1.0` no commit de merge (o padrão das tags existentes) e release — o campo `version` é o que faz a atualização chegar aos usuários do marketplace.
- [ ] `## FECHO — PR mergeada` no ledger: achados do review, itens de backlog gerados pelas medições (qualquer `<não>` de M14/M15), e a pendência aberta da spec que este fecho encerra: "Contagem de testes 1.1.0" e "Lista inicial de `ferramentas-mcp.json`" (M14 prova o match com ClickUp; as outras seis ferramentas seguem (b) até alguém medir — registrar isso em `docs/backlog.md` com gatilho "primeiro repo do time com Jira/Linear/Notion/Trello/Asana/Monday").

## Emendas (2026-09-24, revisão cruzada)

- #2: grafia canônica de `MOVIMENTO` (`preparado→em_execucao`) no README e nas fixtures de M15.
- #5: README "Fluxo" descreve `epics/<ID>.md` com `iniciativa:` e `pbis/<ID>.md` com `epic:`; o cartão resolve a Iniciativa via Epic.
- #6: fixtures de M15 (`EPIC-1.md`, `PBI-1.md`) usam `status: Preparado` (nome de coluna, como o README diz), não `preparado`.
- #7: T25/README — passo novo na seção "Plugins vizinhos — o que instalar à mão": colar o parágrafo "Fronteira com UI/UX" (handoff C11 da Fase 4) após "Em conflito, o gabarito vence"; greps README = 1 / `reference/AGENTS.md` = 0.
- #13: M15 — grep do Apêndice usa os rótulos reais da Fase 4 (17.3): `grep -c 'Áreas e donos\|^| Fluxo:' AGENTS.md` ≥ 2.
- #14: `ci.yml`, job `texto` — além de contar 7 `## ` em `fluxo.md`, `diff` da ORDEM contra os 7 títulos exatos da Fase 1 (T2).
- #16: pré-condição do ledger `GM-6.md` no cabeçalho novo de `referencia.md §2.3` (`PBI: GM-6 · Epic: (b) — repo do plugin, sem onboarding`, `## LER PRIMEIRO — <data>`).
- VER-3 (b): README "Versionamento" declara o limite — `versionamento-check`/doctor conferem o first-parent de `HEAD`, não `main` + branch atual.

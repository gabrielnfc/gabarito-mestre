# Gabarito Mestre 1.1.0 — Fase 5: skills, agente e comando (T22–T24)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As duas skills que orquestram a camada de fluxo passam a existir na forma final: `gabarito-instalar` com onboarding em quatro fases, gatilho por `resolvidoEm`, e modo `--vincular`; `gabarito-conformidade` conferindo cards de fluxo, fio condutor e contenda. O agente implementador ganha o bloco de isolamento; o comando do doctor explica `warn`.

**Architecture:** Fase 5 do rollout da spec — depende de 1–4 integradas (`fluxo.md`, templates, `onboarding-config.mjs`, `capacidade.mjs`, `cartao-sessao.mjs`, doctor com checagens novas, `prompts.md` com "Isolamento", `AGENTS.md` com Apêndice novo). Skills **não reimplementam** nada: chamam os scripts pelo CLI do contrato e citam a referência por seção. Nenhum `mcp__*` entra em `allowed-tools` (R3: permissão por chamada).

**Tech Stack:** Markdown com frontmatter YAML (skills, agents, commands do Claude Code). Verificação por `grep`, `sed`, `claude plugin validate --strict`.

**Spec:** `docs/superpowers/specs/2026-09-24-workflow-true-design.md` — REQ-ONB-1..8 (l.104–130), ORQ-6 (l.196), FLX-3 (l.84–87), FLX-5 (l.92), FLX-6 (l.95), CNF-1 (l.239–240), PAR-3 (l.208–209), PAR-4 (l.211–212), ORQ-5 (l.193–194), ADR-FLX-2 (l.53), M2/M3/M6/M7 (l.14–19), tabela "Testes e gates" (l.284, 286).
**Contrato:** `docs/superpowers/plans/2026-09-24-workflow-true-1.1.0.md` — "Contrato de interfaces" (l.112–249): CLI de `onboarding-config.mjs`, `capacidade.mjs`, `cartao-sessao.mjs`; flags de `instalar.sh`; gatilho por fase (l.168); calibração (l.166); formato do cartão (l.202–216); `.harness/fluxo-cache.json` (l.174); linhas do ledger (l.181–186).

**PBI desta fase:** `GM-5` (Enabler). Branch `enabler/GM-5-skills`. Ledger `docs/ledgers/GM-5.md`. Commits `feat(GM-5): …`. Nenhuma task faz push, PR ou merge (R1).

---

## Pré-condições (antes da primeira edição)

- [ ] Fases 1–4 integradas em `main` e revisadas. Verificar por medição, não por relatório:
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre/plugins/gabarito-mestre
  test -f reference/fluxo.md && [ "$(grep -c '^## ' reference/fluxo.md)" -eq 7 ] && echo "fluxo.md ok"
  ls templates/fluxo/{iniciativa,epic,us,enabler,tech-debt,spike,bug,tarefa}.md
  ls gates/scripts/{onboarding-config,capacidade,cartao-sessao,versionamento-check}.mjs
  ls templates/{PULL_REQUEST_TEMPLATE.md,CHANGELOG.md,backlog.md}
  test -f reference/ferramentas-mcp.json && echo "ferramentas-mcp ok"
  grep -c "Isolamento: porta" reference/prompts.md          # esperado: 1
  grep -c "Antes de despachar" reference/prompts.md          # esperado: 1
  grep -c "Áreas e donos" reference/AGENTS.md                # esperado: ≥ 1
  grep -c "R30+" reference/AGENTS.md                         # esperado: 1
  node gates/scripts/onboarding-config.mjs --root /tmp --dry-run >/dev/null 2>&1; echo "onboarding-config exit=$?"   # esperado: exit 1 (uso — sem --set/--settings; contrato "1 = erro de argumento")
  node gates/scripts/capacidade.mjs --calibrar --json | head -3
  ```
  Qualquer linha fora do esperado: **pare** — a Fase 5 não começa (gate de fase do plano-mestre).
- [ ] Branch criada a partir de `main`:
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre && git checkout main && git pull --ff-only && git checkout -b enabler/GM-5-skills
  ```
- [ ] Ledger criado com o cabeçalho **novo** de `referencia.md §2.3` (formato da Fase 4, T18 — `PBI:`/`Epic:` no título e `## LER PRIMEIRO`; este repo não tem onboarding, então `Epic:` é (b)):
  ```bash
  mkdir -p docs/ledgers && cat > docs/ledgers/GM-5.md <<'EOF'
  # Ledger — PBI: GM-5 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-5-skills.md   Branch: enabler/GM-5-skills @ (sha ao abrir)   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
  Rulings herdados: R1, R2, R3, R16, R18          Contexto externo: nenhum (só texto; sem banco, sem rede)

  ## LER PRIMEIRO — <AAAA-MM-DD>
  Fase 5: T22 → T23 → T24 (grafo abaixo); nada implementado ainda.
  ## Pre-flight — pares produz × consome
  | Par | Produz × Consome | Achado |
  | T22 × T9 | SKILL cita `cartao-sessao.mjs` e `--vincular` × cartão lê `.harness/fluxo-cache.json` | formato do cache é o do contrato l.174 |
  | T22 × T5 | SKILL chama `onboarding-config.mjs --set/--settings` × CLI do contrato l.192 | nomes de seção e flags idênticos |
  | T23 × T2 | conformidade cita `fluxo.md §n` × seções de `fluxo.md` | 7 seções, ordem FLX-1 |
  | T24 × T20 | agente copia bloco Isolamento × `prompts.md` | texto idêntico (fonte única) |
  ## Rulings de pre-flight
  ## Progresso
  ## CORTE DA SESSÃO (com motivo)
  ## FECHO — PR mergeada
  EOF
  ```
- [ ] Executor de cada task recebe: o plano-mestre (contrato), este plano, ponteiros da spec (`REQ-ID` + linhas) e a lista fechada de arquivos da task. Nunca conteúdo copiado (referencia.md §3.3).

---

## Grafo e paralelismo

```
T22 ─┐
T23 ─┼─ paralelas (arquivos disjuntos: skills/gabarito-instalar/ · skills/gabarito-conformidade/ · agents/ + commands/)
T24 ─┘
```

Nenhum arquivo de contenda (`gates/package.json`, `hooks/hooks.json`) é tocado nesta fase. Nenhum recurso compartilhado. Consultar `capacidade.mjs` antes do dispatch e registrar `DISPATCH Task <N> slots=<n> worktree wt/GM-5-<n>` no ledger (PAR-2).

**Gate de fase (contagem verificável):** 2 `SKILL.md` + 1 agent + 1 command modificados = **4 arquivos**; `claude plugin validate ./plugins/gabarito-mestre --strict` passa; conferência manual em fixture: design sem `Epic:` em repo com `fluxo.resolvidoEm` → linha "fio condutor (R19)" **FALTA**; mesmo design em repo sem `fluxo.resolvidoEm` → **AVISO**.

---

## T22 — `skills/gabarito-instalar/SKILL.md`: quatro fases, gatilho por `resolvidoEm`, `--vincular`

**Fecha:** REQ-ONB-1, ONB-2, ONB-3, ONB-4, ONB-5, ONB-6, ONB-8, ORQ-6, FLX-5, FLX-6 (aviso "ferramenta não atualizada"), TIM-1 (CODEOWNERS na fase 2), CTX-3 (aviso de N servidores MCP).
**Arquivos:** `plugins/gabarito-mestre/skills/gabarito-instalar/SKILL.md` (substituição integral).
**Aceite:** Given frontmatter da skill · When leio `allowed-tools` · Then contém `AskUserQuestion`, `Edit`, `Bash(claude mcp list:*)` e nenhum `mcp__` (ONB-8). Given repo com os três `resolvidoEm` · When "instala o gabarito" · Then só a fase 1 roda e a skill diz "onboarding já feito em <data>; para refazer, peça 'refazer onboarding'" (ONB-1). Given `--vincular PBI-123`, `ferramenta: clickup`, `escrita: false` · When roda · Then lê o card, grava `.harness/fluxo-cache.json`, registra linha no ledger e **não** escreve na ferramenta (ORQ-6).

### Passos

- [ ] **Ler antes de escrever:** `reference/ferramentas-mcp.json` (estrutura de T4/fase 1: `{ "_comment", "versao", "ferramentas": [ { padraoServidor, ferramenta, hierarquiaSugerida, statusSugerido: { FL2, FL1 }, comoBuscarIniciativa, confirmadoEm } ] }` — chaves camelCase; **nenhum** nome snake_case existe nesse arquivo), `templates/fluxo/*.md` (nomes exatos dos 8 templates e chaves do frontmatter), `reference/AGENTS.md` do Apêndice em diante (nomes exatos das linhas `Fluxo · Versionamento · Modelo · Paralelismo · Isolamento · Áreas e donos` que T17 criou — se a redação divergir do texto abaixo, **o AGENTS.md vence** e a skill usa o nome que está lá), `gates/scripts/onboarding-config.mjs` (confirmar que `--set` aceita as quatro seções e `--settings` grava `.claude/settings.json`) e `gates/scripts/capacidade.mjs` (formato da saída de `--calibrar --json`).

- [ ] **Substituir o arquivo inteiro** por este texto (adaptando **só** os nomes de linha do Apêndice e os nomes de template, se a leitura acima mostrar diferença):

````markdown
---
name: gabarito-instalar
description: Instala o harness Gabarito Mestre neste repositório e faz o onboarding do fluxo em quatro fases (instalação determinística, fluxo, versionamento, orquestração). Use quando o usuário pedir para "instalar o gabarito", "instalar o harness", "adotar o gabarito-mestre", "configurar AGENTS.md", "setup do harness", "colocar os gates neste repo", "bootstrap do gabarito", "install gabarito", "fazer o onboarding", "refazer onboarding", "vincular PBI-<n>" ou "gabarito-instalar --vincular <PBI>". Cria AGENTS.md, CLAUDE.md (só o import), docs/harness/, tools/gabarito-gates/, harness.config.json, .harness/attest.json e o workflow de CI; grava as seções fluxo, versionamento e orquestracao do harness.config.json via onboarding-config.mjs; roda o doctor ao fim. Nunca declara o nível de adoção.
allowed-tools: Bash(bash:*), Bash(node:*), Bash(ls:*), Bash(cat:*), Bash(cp:*), Bash(mkdir:*), Bash(git status:*), Bash(git rev-parse:*), Bash(claude mcp list:*), Read, Glob, Grep, Edit, AskUserQuestion
---

# gabarito-instalar

Instala o harness e faz o **onboarding do fluxo** (Workflow TRUE: Flight Levels + Kanban, `docs/harness/fluxo.md`). **Instalar não é adotar**: ao fim, o nível de adoção fica `____` e é o doctor quem mede.

Quatro fases, nesta ordem: **(1)** instalação determinística · **(2)** fluxo · **(3)** versionamento · **(4)** orquestração. As fases 2–4 gravam em `harness.config.json` via `onboarding-config.mjs` (merge chave a chave, nunca remove, imprime o diff) e no Apêndice do `AGENTS.md` via `Edit` — **sempre mostrando o bloco antes de aplicar**.

## Divisão de trabalho (`${CLAUDE_PLUGIN_ROOT}/reference/AGENTS.md §9`)

- **superpowers CONDUZ** — planejar a subida de nível depois da instalação é `superpowers:brainstorming` → `superpowers:writing-plans`. Esta skill não planeja.
- **ui-ux-pro-max DESENHA** — não participa.
- **gabarito-mestre MANDA** — o que entra no repo, o que vai para a config, e o fato de que o nível não é declarado por ninguém além do doctor.

**Fail-open declarado (G9):** superpowers ausente não impede nada aqui (instalação e onboarding são determinísticos). Avise em uma linha: `superpowers não está instalado — a instalação segue; o planejamento da subida de nível ficará sem a maquinaria de brainstorm/plano.`

**Sessão sem `AskUserQuestion`** (headless `claude -p`, ou ferramenta indisponível): **não invente respostas.** Use o default de cada pergunta, marque cada valor como **(b)** e liste todos no fechamento ("o que ficou (b)"). Escrita na ferramenta (`fluxo.escrita`) **nunca** fica `true` sem resposta explícita.

## Gatilho por fase

1. Raiz do repo: `git rev-parse --show-toplevel` (fallback: diretório atual). Não instale em subpasta sem o usuário pedir.
2. Se `harness.config.json` existe, leia-o (`Read`). Decida por chave:

| Fase | Roda quando falta | Chave |
|---|---|---|
| 2 — fluxo | `fluxo.resolvidoEm` | `AAAA-MM-DD` |
| 3 — versionamento | `versionamento.resolvidoEm` | idem |
| 4 — orquestração | `orquestracao.modelo.resolvidoEm` | idem |

3. Os três presentes e o pedido foi "instala": roda **só a fase 1** e diga: `onboarding já feito em <maior das três datas>; para refazer, peça "refazer onboarding".`
4. Pedido "refazer onboarding": rodam as fases 2–4 inteiras, com os valores atuais como default de cada pergunta.
5. Pedido "vincular <PBI>" / "--vincular <PBI>": vá direto ao **Modo `--vincular`** (exige `fluxo.resolvidoEm`; sem ele, rode a fase 2 primeiro).
6. Onboarding interrompido retoma da primeira fase cuja chave falta — nunca refaz o que já tem data.

## Fase 1 — instalação determinística

Rode o instalador — ele **nunca sobrescreve nem apaga**; arquivo existente é mantido e reportado:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/instalar.sh" .
```

Antes de rodar, meça o que já existe:

```bash
if [ -d tools/gabarito-gates ] && [ ! -f tools/gabarito-gates/.instalado.json ]; then echo "harness 1.0.x (sem .instalado.json)"; fi
[ -f tools/gabarito-gates/.instalado.json ] && node -e 'console.log("instalado", JSON.parse(require("fs").readFileSync("tools/gabarito-gates/.instalado.json","utf8")).versao)'
```

`tools/gabarito-gates/` **sem** `.instalado.json` é instalação **1.0.x** (o manifesto nasceu na 1.1.0): trate como versão anterior — pergunte por `AskUserQuestion` se roda `instalar.sh . --atualizar` (opções: `--atualizar` · `--atualizar --gates-substituir` · só instalar o que falta, sem `--atualizar`). Se o repo já tem harness de uma versão anterior (esse caso, ou `.instalado.json` com `versao` ≠ `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`), **pergunte** antes: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/instalar.sh" . --atualizar` grava `<arquivo>.novo` + `diff --stat` para `AGENTS.md` e `docs/harness/*.md` (nunca sobrescreve) e avisa que **R19–R21 agora são do harness; regras de projeto passam a R30+**; `--atualizar --gates-substituir` troca `tools/gabarito-gates/` arquivo a arquivo com `.bak`, recusando (→ `.novo`) o que foi editado localmente (ADR-TIM-1). Com `--atualizar` o doctor **não** roda ao fim — o usuário ainda vai aplicar os `.novo`.

O que o instalador cria (de `${CLAUDE_PLUGIN_ROOT}/reference/` e `templates/`):

| Destino | Origem | Observação |
|---|---|---|
| `AGENTS.md` | `reference/AGENTS.md` | núcleo (≤ 17.291 B, lido sempre); Apêndice em branco (≤ 4.096 B) |
| `CLAUDE.md` | `templates/CLAUDE.md` | **APENAS** `@AGENTS.md`. Os docs de referência **não** são importados — são sob demanda, de propósito |
| `docs/harness/{referencia,gates,adocao,prompts,fluxo}.md` | `reference/` | consultados por ponteiro; `fluxo.md` é a fonte normativa do Workflow TRUE |
| `tools/gabarito-gates/` + `.instalado.json` | `gates/` | gates e scripts, zero dependências, Node ≥ 22.18; `.instalado.json` guarda hash por arquivo |
| `harness.config.json` | `templates/` | template — as seções `fluxo`, `versionamento`, `orquestracao` **não** vêm nele: nascem no onboarding |
| `.harness/attest.json` | `templates/` | tudo `confirmado: false` — atestar é ato nominal e datado (inclui `iniciativa-resolvida`, `squash-titulo-pr`) |
| `.github/workflows/gabarito.yml` | `templates/` | doctor + testes dos gates + versionamento (`fetch-depth: 0`) + guarda de migrations (guarda de migrations desligada por padrão — `gates.md §4`) |
| `.gitignore` (emenda) | — | garante `.harness/doctor-cache.json`, `.harness/fluxo-cache.json`, `*.novo`, `*.bak`; nada removido |

Cole a saída do instalador. Se nenhuma fase 2–4 for rodar, cole também a do doctor e vá ao **Fechamento**.

## Fase 2 — fluxo (roda se falta `fluxo.resolvidoEm`)

### 2.1 Detectar a ferramenta de planejamento

1. Liste as ferramentas `mcp__<servidor>__<tool>` visíveis nesta sessão (plugins aparecem como `mcp__plugin_<plugin>_<servidor>__`). Complemente com:
   ```bash
   claude mcp list
   ```
2. Conte os servidores distintos e avise **em uma linha, com o número**: `<N> servidores MCP conectados — cada um custa contexto em toda sessão; recomendo escopo de projeto (.mcp.json) só com o necessário (docs/harness/adocao.md §4, "MCP demais").`
3. Leia `${CLAUDE_PLUGIN_ROOT}/reference/ferramentas-mcp.json` (`ferramentas[]`) e, para cada `<server>` extraído de `mcp__<server>__<tool>`, teste cada entrada com `new RegExp(padraoServidor, 'i').test(server)` — primeiro match vence. Match → proponha `ferramenta` e `mcp: <server>` (ex.: `mcp__claude_ai_ClickUp__*` → `ferramenta: clickup`, `mcp: claude_ai_ClickUp`) e peça confirmação por `AskUserQuestion` (opções: a proposta · outra da lista · `arquivos` · nome livre de servidor). Entrada com `confirmadoEm: null` é sugestão (b): diga isso em uma linha.
4. Sem match: proponha `arquivos` **ou** nome livre de servidor que o usuário informe (grava como está; a lista do plugin cresce por PR — diga isso em uma linha).

### 2.2 Ler a Iniciativa na ferramenta (só com ok)

Antes de qualquer chamada `mcp__*` de leitura, diga **em uma linha** e espere o ok:
`vou LER na ferramenta <X> para confirmar a Iniciativa; ferramenta de planejamento não é produção de terceiro por padrão, mas é sistema vivo — ok?`

Com ok: pergunte o ID ou nome da Iniciativa e busque conforme `comoBuscarIniciativa` da entrada casada em `ferramentas-mcp.json` (é instrução para o agente, em prosa; sem entrada casada — nome livre — pergunte ao usuário como buscar). Regras:
- **I10 — existe ≠ ativa.** Leia o status e confirme com o usuário que é a Iniciativa ativa deste repo.
- **I4 — vazio não é prova.** Busca sem resultado: não grave; pergunte de novo (nome alternativo, outro espaço). Se o usuário insistir, grave com `"nome"` prefixado por `(b) ` e liste no fechamento.
- Leia `nome` e `url`. **URL sem token, nunca** — se a URL da ferramenta carregar `token=`, `key=` ou `sig=`, corte a query string.
- Uma só chamada de leitura por pergunta. Nenhuma escrita nesta fase, em nenhum caso.

Sem ferramenta (`arquivos`): pergunte ID e nome da Iniciativa; `url` fica `""`.

### 2.3 Perguntas fechadas (`AskUserQuestion`, uma por vez)

| # | Pergunta | Default |
|---|---|---|
| 1 | Onde vivem FL3 / FL2 / FL1 na hierarquia da ferramenta? | `hierarquiaSugerida` (`FL3`/`FL2`/`FL1`) da entrada casada; em `arquivos`: `docs/fluxo/iniciativa.md` / `docs/fluxo/epics/` / `docs/fluxo/pbis/` |
| 2 | Nomes dos status FL2 (Epic) para as chaves `preparado` · `em_execucao` · `em_validacao` · `concluido` | `statusSugerido.FL2` da entrada casada (os nomes que a ferramenta mostra); em `arquivos`: os **nomes de coluna** de `fluxo.md §4` — `Preparado`, `Em execução`, `Em validação`, `Concluído` (FL2 tem ainda `Backlog` e `Em refinamento`, que não são chaves do harness) |
| 3 | Nomes dos status FL1 (PBI) para as chaves `preparado` · `em_execucao` · `revisao` · `pronto` · `concluido` | `statusSugerido.FL1` da entrada casada; em `arquivos`: `Preparado`, `Em execução`, `Revisão e teste`, `Pronto para liberar`, `Concluído` |
| 4 | Formato de ID (regex) | `^[A-Z]+-\d+$` |
| 5 | Campo/relacionamento que liga PBI → Epic | `hierarquiaSugerida.FL1` cita o vínculo; em `arquivos`: `frontmatter` |

As **chaves** de `fluxo.status` (`preparado`, `em_execucao`, …) nunca mudam — são o que `MOVIMENTO` e o cartão usam; só os **valores** variam por ferramenta. Em `arquivos`, o valor é o que vai em `status:` no frontmatter de `docs/fluxo/**/*.md`.
| 6 | **Escrita autorizada na ferramenta?** (ADR-FLX-2) | **não** — só vira `true` com resposta explícita; anote quem e quando |
| 7 | Áreas do repo e dono de cada uma (TIM-1) | uma área: `*` → o usuário |

### 2.4 Gravar `fluxo`

Monte o JSON e grave (o script faz merge, preserva `_comment` e chaves desconhecidas, e imprime o diff — cole o diff):

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root . --set fluxo '{
  "ferramenta": "<clickup|jira|linear|notion|trello|asana|monday|arquivos|nome livre>",
  "mcp": "<nome do servidor ou null>",
  "iniciativa": { "id": "<ID>", "nome": "<nome>", "url": "<url sem token ou vazio>" },
  "mapeamento": { "FL3": "<resposta 1>", "FL2": "<resposta 1>", "FL1": "<resposta 1>" },
  "status": {
    "FL2": { "preparado": "<…>", "em_execucao": "<…>", "em_validacao": "<…>", "concluido": "<…>" },
    "FL1": { "preparado": "<…>", "em_execucao": "<…>", "revisao": "<…>", "pronto": "<…>", "concluido": "<…>" }
  },
  "vinculoPbiEpic": "<resposta 5>",
  "escrita": false,
  "idPadrao": "<resposta 4>",
  "ledgerDir": "docs/ledgers",
  "envelhecimentoDias": 3,
  "resolvidoEm": "<AAAA-MM-DD de hoje>"
}'
```

`escrita: true` só se a resposta 6 foi sim; nesse caso o Apêndice recebe `escrita autorizada por <quem> em <data>`. Exit 1 = JSON inválido: corrija e repita; não edite `harness.config.json` à mão. **Exit 0 com `fail-open declarado` no stderr = não gravou** (o `harness.config.json` existente está inválido — decisão 2 da fase 2): pare, mostre o stderr ao usuário e não avance para 2.5 até ele consertar o arquivo.

### 2.5 Áreas e donos → `CODEOWNERS`

Três casos, decididos por medição (não por memória da fase 1):

```bash
if [ ! -e .github/CODEOWNERS ]; then echo "CODEOWNERS: ausente"
elif [ "$(grep -vc '^[[:space:]]*\(#.*\)\?$' .github/CODEOWNERS)" -eq 0 ] && grep -q '^# Áreas e donos (TIM-1) — preenchido pelo onboarding' .github/CODEOWNERS; then echo "CODEOWNERS: esqueleto"
else echo "CODEOWNERS: próprio"; fi
```

- **ausente** → crie com uma linha por área (`<padrão de caminho> <@dono>`), mostrando antes:
  ```bash
  mkdir -p .github && cat > .github/CODEOWNERS <<'EOF'
  # Áreas e donos — gerado pelo onboarding do gabarito-mestre em <AAAA-MM-DD>. Fonte: AGENTS.md, Apêndice "Áreas e donos".
  <padrão> <@dono>
  EOF
  ```
- **esqueleto** (só comentários, e o primeiro é o marcador que `instalar.sh --codeowners` escreve: `# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:`) → **preencha**: mantenha o marcador, troque a linha `# <caminho/>  @<dono>` pelas linhas reais (`Edit`, mostrando o diff antes).
- **próprio** (qualquer linha não comentada, ou comentário que não é o marcador) → **não toque**; diga em uma linha que o Apêndice vai citar o arquivo existente.

### 2.6 Sem ferramenta: `docs/fluxo/` (FLX-5)

Só com `ferramenta: arquivos`. Crie **apenas o que não existe**:

```bash
mkdir -p docs/fluxo/epics docs/fluxo/pbis
[ -e docs/fluxo/iniciativa.md ]        || cp "${CLAUDE_PLUGIN_ROOT}/templates/fluxo/iniciativa.md" docs/fluxo/iniciativa.md
[ -e docs/fluxo/epics/EPIC-EXEMPLO.md ] || cp "${CLAUDE_PLUGIN_ROOT}/templates/fluxo/epic.md"       docs/fluxo/epics/EPIC-EXEMPLO.md
[ -e docs/fluxo/pbis/PBI-EXEMPLO.md ]   || cp "${CLAUDE_PLUGIN_ROOT}/templates/fluxo/us.md"         docs/fluxo/pbis/PBI-EXEMPLO.md
```

Depois, com `Edit`, preencha no frontmatter de `docs/fluxo/iniciativa.md` o `id` e o nome da Iniciativa; em `EPIC-EXEMPLO.md` o `iniciativa: <ID>`; em `PBI-EXEMPLO.md` o `epic: EPIC-EXEMPLO`. Os outros templates (`enabler`, `tech-debt`, `spike`, `bug`, `tarefa`) ficam no plugin: quem abre um card copia de `${CLAUDE_PLUGIN_ROOT}/templates/fluxo/<tipo>.md` — diga isso em uma linha. `docs/backlog.md` continua sendo o backlog do harness (R17), não um nível do fluxo.

### 2.7 Apêndice do `AGENTS.md`

Mostre o bloco, peça ok, aplique com `Edit` preenchendo a célula vazia da linha existente (a linha existe desde a 1.1.0; num `AGENTS.md` 1.0.x, **acrescente** a linha ao fim da tabela — nunca remova nada):

```
| Fluxo | ferramenta <x> · MCP <nome|—> · Iniciativa <ID> "<nome>" (<url|sem url>) · FL3/FL2/FL1 = <a> / <b> / <c> · vínculo PBI→Epic: <campo> · escrita: não autorizada | autorizada por <quem> em <data> · (b): <o que não foi confirmado na ferramenta> · resolvido em <AAAA-MM-DD> |
| Áreas e donos | <área> → <@dono> · <área> → <@dono> (fonte: .github/CODEOWNERS) |
```

O Apêndice tem orçamento de **4.096 bytes** (`contexto.apendiceMaxBytes`, doctor `agents-tamanho`): uma linha por item, sem prosa.

## Fase 3 — versionamento (roda se falta `versionamento.resolvidoEm`)

1. Confirme por `AskUserQuestion` o modelo **trunk-based** (D2): `main` protegida · branch curta por PBI · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag por release · squash-merge com título CC. Opções: `sim` (default) · `não`. Com `não`: **não grave** `versionamento` (o hook R20 fica fail-open), registre a decisão do usuário no Apêndice como (b) e siga para a fase 4.
2. Mostre o mapa tipo de PBI → prefixo de branch e peça ok: US→`feat` · Bug→`fix` (hotfix é `fix` com PBI de Bug) · Enabler→`enabler` · TechDebt→`debt` · Spike→`spike` · Tarefa→`task`; sem PBI: `chore|docs|ci|build|test/<slug>`; worktree de implementador: `wt/<PBI>-<n>`.
3. Instale **só o que não existe** (ONB-4; nenhum arquivo pré-existente é alterado):
   ```bash
   mkdir -p .github docs
   [ -e .github/PULL_REQUEST_TEMPLATE.md ] || cp "${CLAUDE_PLUGIN_ROOT}/templates/PULL_REQUEST_TEMPLATE.md" .github/PULL_REQUEST_TEMPLATE.md
   [ -e CHANGELOG.md ]                     || cp "${CLAUDE_PLUGIN_ROOT}/templates/CHANGELOG.md" CHANGELOG.md
   [ -e docs/backlog.md ]                  || cp "${CLAUDE_PLUGIN_ROOT}/templates/backlog.md" docs/backlog.md
   ```
   Se o `PULL_REQUEST_TEMPLATE.md` já existia, avise em uma linha quais itens do template do gabarito faltam nele (título `tipo(PBI-n): assunto`, PBI, Epic, requisito, migration compatível, plano de volta, janela, teardown, revisor humano) — **não edite**.
4. Grave:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root . --set versionamento '{
     "modelo": "trunk",
     "branchPadrao": "^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$",
     "branchWorktree": "^wt/[A-Z]+-\\d+-\\d+$",
     "commit": "conventional",
     "tiposComEscopoDePbi": ["feat","fix","enabler","debt","spike","task","perf","refactor"],
     "tiposLivres": ["chore","docs","ci","build","test","release","revert"],
     "tag": "^v\\d+\\.\\d+\\.\\d+$",
     "changelog": "CHANGELOG.md",
     "resolvidoEm": "<AAAA-MM-DD de hoje>"
   }'
   ```
   Se `fluxo.idPadrao` não for `^[A-Z]+-\d+$`, substitua `[A-Z]+-\d+` em `branchPadrao` e `branchWorktree` pelo padrão do usuário (sem âncoras) e mostre o resultado antes de gravar. **Exit 0 com `fail-open declarado` no stderr = não gravou**: pare, mostre o stderr ao usuário e não siga para o passo 5.
5. Apêndice (mostrar, ok, `Edit`):
   ```
   | Versionamento | trunk-based (D2) · branch tipo/<PBI>-slug · worktree wt/<PBI>-<n> · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag vX.Y.Z · squash com título CC · resolvido em <AAAA-MM-DD> |
   ```
6. Diga em uma linha: a partir de agora o hook `guard-versioning.sh` (R20) barra branch e commit fora do padrão; escape hatch nominal `GABARITO_ALLOW_VERSIONING="<motivo ≥ 8 caracteres, ≥ 2 palavras>"` — hatches não cruzam.

## Fase 4 — orquestração (roda se falta `orquestracao.modelo.resolvidoEm`)

### 4.1 Modelo

Mostre os aliases conhecidos (`fable`, `opus`, `sonnet`, `haiku` — M2) e pergunte por `AskUserQuestion`: **qual família é a mais potente hoje na sua conta?** Fonte: `/model` na UI do Claude Code — **não existe API para enumerar**; a resposta é **(b)** do usuário e é gravada com a data de hoje. Opções: `fable` (default) · `opus` · `sonnet` · outro alias. Validade: 90 dias; vencido, o cartão de sessão e o doctor (`warn modelo-resolvido`) cobram revalidação.

### 4.2 `.claude/settings.json` — dois oks separados

1. Gere o diff **sem gravar**:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root . --dry-run --settings '{
     "model": "<alias>",
     "enabledPlugins": { "gabarito-mestre@gabarito-mestre": true },
     "extraKnownMarketplaces": { "gabarito-mestre": { "source": { "source": "github", "repo": "gabrielnfc/gabarito-mestre" } } }
   }'
   ```
   Cole o diff. Chaves existentes (`permissions`, `env`, `hooks`…) ficam **byte a byte** — o script emenda chave a chave (R2).
2. Pergunte, **separadamente**, por `AskUserQuestion`:
   - (i) gravar `model: <alias>` para o **time inteiro**? (settings de projeto > user: afeta o custo de todos que clonam) — `sim` / `não`.
   - (ii) registrar o marketplace do gabarito e habilitar o plugin (`enabledPlugins` + `extraKnownMarketplaces`)? Isto liga **hooks PreToolUse de terceiro** para quem clonar — é o ponto de consentimento. `sim` / `não`.
3. Grave **só o confirmado**, em uma chamada, sem `--dry-run`, com o JSON reduzido ao que recebeu `sim`. Nenhum `sim` → não grave nada e diga por quê. **Sessão sem `AskUserQuestion`: (i) e (ii) valem `não`** — consentimento não tem default `sim`; o diff fica na saída e o item vai para a lista (b).
4. Diga em uma linha: **cada pessoa instala o plugin uma vez** (`claude plugin install gabarito-mestre@gabarito-mestre`); `enabledPlugins` só o habilita para quem já instalou (M3).

### 4.3 Máquina e paralelismo

1. Calibre:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs" --root . --calibrar --json
   ```
   Fórmula (contrato): `simultaneos = clamp(floor(cores/4), 1, 3)`; `teto = clamp(floor(cores/2), 2, 8)`. Mostre cores, load, memória disponível, disco e os valores sugeridos.
2. Pergunte `simultaneos` e `teto` com os medidos como default (`teto ≥ simultaneos ≥ 1`).
3. Proponha `arquivosDeContenda` a partir do que existe no repo — verifique com `ls`/`Glob`: lockfile detectado (`package-lock.json` · `pnpm-lock.yaml` · `yarn.lock` · `bun.lockb` · `Cargo.lock` · `poetry.lock` · `go.sum`), `prisma/` se existir, `src/index.ts` se existir, e **sempre** `docs/fluxo/`. Usuário confirma a lista.
4. Grave:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root . --set orquestracao '{
     "modelo": { "politica": "mais-potente", "alias": "<alias>", "resolvidoEm": "<AAAA-MM-DD de hoje>", "validadeDias": 90 },
     "sempreSubagente": true,
     "lembretePorPrompt": false,
     "paralelismo": {
       "modo": "auto",
       "simultaneos": <n>,
       "teto": <n>,
       "limites": { "loadPorCoreMax": 1.5, "memDisponivelMinMB": 2048, "discoLivreMinGB": 5 },
       "arquivosDeContenda": [<lista confirmada>],
       "isolamentoWorktree": { "porta": "3000+n", "dbSchema": "wt_{n}", "namespace": "wt-{n}" },
       "rodadasAntesDeEscalar": 2,
       "calibradoEm": "<AAAA-MM-DD de hoje>"
     }
   }'
   ```
   Se o projeto usa outra porta base ou outro prefixo de schema/namespace, pergunte e ajuste `isolamentoWorktree` antes de gravar. `lembretePorPrompt` fica `false` (default); diga que `true` liga uma linha "R21: despache, não implemente" a cada prompt. **Exit 0 com `fail-open declarado` no stderr = não gravou**: pare, mostre o stderr ao usuário e não siga para o passo 5.
5. Apêndice (mostrar, ok, `Edit`):
   ```
   | Modelo | política mais-potente · alias <alias> · resolvido em <AAAA-MM-DD> (b — fonte: /model do usuário) · validade 90 d |
   | Paralelismo | simultaneos <n> · teto <n> · contenda: <lista> · calibrado em <AAAA-MM-DD> (<cores> cores) |
   | Isolamento | porta 3000+n · schema wt_{n} · namespace wt-{n} (n = índice de wt/<PBI>-<n>) |
   ```

## Fechamento (toda execução termina aqui)

1. **Lista "o que ficou (b)"** — uma linha por item: Iniciativa não confirmada na ferramenta · status não lidos da ferramenta · alias do modelo (sempre (b)) · respostas por default em sessão sem `AskUserQuestion` · qualquer arquivo pré-existente que impediu instalação (PR template, CHANGELOG, CODEOWNERS).
2. Rode o doctor e cole a saída inteira. **Não interprete o nível como "pretendido"**: o que vale é `Nível alcançado`. Linhas `warn` (ex.: `modelo-resolvido`) são aviso, não falta.
   ```bash
   node tools/gabarito-gates/scripts/harness-doctor.mjs --explain
   ```
3. Diga ao usuário, nesta ordem: preencher o resto do **Apêndice** (stack, fronteiras, tenant, comandos) — sem ele o documento é teoria · declarar no `§0.2` **o nível que o doctor mediu** (repo novo: `0`) · **antes de ligar qualquer gate, calibrar** (`docs/harness/adocao.md §3`) · marcar no Apêndice o que é inaplicável (R7, G7, G8) em vez de fingir · abrir a primeira branch de PBI já com `gabarito-instalar --vincular <PBI>`.
4. `git status` — mostre e **pare**. Não commite (R1).

## Modo `--vincular <PBI>` (ORQ-6)

Registra o vínculo PBI → Epic → Iniciativa no cache local que os hooks leem. Roda ao abrir a branch do PBI; **só leitura** na ferramenta, mesmo com `fluxo.escrita: true`.

1. Exige `fluxo.resolvidoEm` (senão: fase 2 primeiro). Valide `<PBI>` contra `fluxo.idPadrao`; não casa → pare e diga o padrão.
2. Leia o card:
   - **Com MCP** (`fluxo.mcp` ≠ null): a linha de ok da §2.2 (uma vez por sessão), depois busque o card pelo ID conforme `comoBuscarIniciativa` da entrada de `ferramentas-mcp.json` cujo `padraoServidor` casa `fluxo.mcp` (mesma busca, agora pelo ID do PBI) e o vínculo por `vinculoPbiEpic`; leia `titulo`, o Epic pelo campo `vinculoPbiEpic`, e a Iniciativa do Epic (ausente → `fluxo.iniciativa.id`, marcado (b)). Card não encontrado: **I4** — não grave; pergunte o ID de novo.
   - **`arquivos`**: `Read docs/fluxo/pbis/<PBI>.md`; `epic:` do frontmatter; `iniciativa:` do `docs/fluxo/epics/<epic>.md` (ausente → `fluxo.iniciativa.id`). Arquivo ausente: não grave; ofereça criar de `${CLAUDE_PLUGIN_ROOT}/templates/fluxo/<tipo>.md` e vincular depois.
3. Grave o cache (merge por chave; formato do contrato; escrita atômica):
   ```bash
   node -e '
   const fs = require("fs"); const p = ".harness/fluxo-cache.json";
   const [pbi, epic, iniciativa, titulo] = process.argv.slice(1);
   let c = {}; try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
   c[pbi] = { epic, iniciativa, titulo, em: new Date().toISOString().slice(0, 10) };
   fs.mkdirSync(".harness", { recursive: true });
   fs.writeFileSync(p + ".tmp", JSON.stringify(c, null, 2) + "\n"); fs.renameSync(p + ".tmp", p);
   console.log("fluxo-cache:", pbi, "→", epic, "→", iniciativa);
   ' "<PBI>" "<EPIC>" "<INI>" "<título do card>"
   ```
4. Ledger `<fluxo.ledgerDir>/<PBI>.md`: se não existe, crie com o cabeçalho de `docs/harness/referencia.md §2.3` (plano: `(b) ainda sem plano`). Acrescente a linha (não é lida por script; é rastro):
   ```bash
   cat >> "<ledgerDir>/<PBI>.md" <<'EOF'
   VINCULO <PBI> epic=<EPIC> iniciativa=<INI> <AAAA-MM-DD> fonte=<ferramenta|arquivo>
   EOF
   ```
5. Com `fluxo.escrita: false`, se o card na ferramenta ainda não está em "em execução", avise **em uma linha**: `ferramenta não atualizada (escrita não autorizada) — mova <PBI> à mão ou autorize escrita no onboarding` (FLX-6). Nunca escreva.
6. Mostre `cat .harness/fluxo-cache.json` e `git status`; pare. O cache é gitignored; o ledger é versionado.

## Proibido

- Declarar nível de adoção. A skill deixa `____`. Nível é medido, nunca presumido.
- Importar `docs/harness/*.md` no `CLAUDE.md`.
- Sobrescrever ou apagar qualquer arquivo do usuário (R2). O instalador não faz isso; `onboarding-config.mjs` só emenda; você também não. Única exceção: `tools/gabarito-gates/` via `--atualizar --gates-substituir`, com `.bak` (ADR-TIM-1).
- Editar `harness.config.json` ou `.claude/settings.json` à mão — só via `onboarding-config.mjs`.
- Escrever na ferramenta de planejamento sem `fluxo.escrita: true` (ADR-FLX-2). `--vincular` **nunca** escreve.
- Chamar qualquer `mcp__*` antes do ok em uma linha (§2.2), ou pôr `mcp__*` no `allowed-tools`.
- Gravar URL com token, ou qualquer segredo, em config, cache, ledger ou Apêndice.
- Inventar resposta em sessão sem `AskUserQuestion` — default marcado (b), sempre.
- Commitar (R1). Mostre o `git status` e pare.
````

- [ ] **Verificar** (todos os números têm de bater):
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre/plugins/gabarito-mestre
  S=skills/gabarito-instalar/SKILL.md
  sed -n '/^allowed-tools:/p' "$S" | grep -c 'AskUserQuestion'          # 1
  sed -n '/^allowed-tools:/p' "$S" | grep -c 'Edit'                     # 1
  sed -n '/^allowed-tools:/p' "$S" | grep -c 'Bash(claude mcp list:\*)' # 1
  sed -n '/^allowed-tools:/p' "$S" | grep -c 'mcp__'                    # 0
  grep -c '^## Fase ' "$S"                                              # 4
  grep -c 'resolvidoEm' "$S"                                            # ≥ 8
  grep -c 'onboarding-config.mjs' "$S"                                  # ≥ 5
  grep -c 'capacidade.mjs" --root . --calibrar' "$S"                    # 1
  grep -c 'extraKnownMarketplaces' "$S"                                 # ≥ 1
  grep -c 'fluxo-cache.json' "$S"                                       # ≥ 3
  grep -c 'escrita não autorizada' "$S"                                 # 1
  grep -c 'servidores MCP conectados' "$S"                              # 1
  grep -c '"escrita": false' "$S"                                       # 1 (default de ADR-FLX-2 no JSON gravado)
  grep -c '^## Proibido' "$S"                                           # 1
  claude plugin validate . --strict                                     # Validation passed
  ```
- [ ] **Conferência de contrato:** para cada `--set <secao>` do SKILL.md, os nomes de chave do JSON são exatamente os do contrato (l.120–161 do plano-mestre). Rode um teste real em diretório temporário:
  ```bash
  T="$(mktemp -d)" && cp templates/harness.config.json "$T/" && cd "$T"
  node "$OLDPWD/gates/scripts/onboarding-config.mjs" --root . --set fluxo '{"ferramenta":"arquivos","mcp":null,"iniciativa":{"id":"INI-1","nome":"x","url":""},"mapeamento":{"FL3":"docs/fluxo/iniciativa.md","FL2":"docs/fluxo/epics/","FL1":"docs/fluxo/pbis/"},"status":{"FL2":{"preparado":"preparado","em_execucao":"em_execucao","em_validacao":"em_validacao","concluido":"concluido"},"FL1":{"preparado":"preparado","em_execucao":"em_execucao","revisao":"revisao","pronto":"pronto","concluido":"concluido"}},"vinculoPbiEpic":"frontmatter","escrita":false,"idPadrao":"^[A-Z]+-\\d+$","ledgerDir":"docs/ledgers","envelhecimentoDias":3,"resolvidoEm":"2026-09-24"}'
  node -e "const c=require('./harness.config.json');console.log(c._comment?'_comment preservado':'ERRO _comment', c.deployOrder?'deployOrder preservado':'ERRO deployOrder', c.fluxo.resolvidoEm)"
  cd "$OLDPWD"
  ```
  Esperado: `_comment preservado deployOrder preservado 2026-09-24`.
- [ ] Commit:
  ```bash
  git add plugins/gabarito-mestre/skills/gabarito-instalar/SKILL.md
  git commit -m "$(cat <<'EOF'
  feat(GM-5): gabarito-instalar com onboarding em 4 fases e --vincular

  Gatilho por resolvidoEm de cada fase (ONB-1); detecção de MCP cruzada com
  ferramentas-mcp.json e aviso de N servidores (ONB-2, CTX-3); leitura da
  Iniciativa só com ok, I10/I4 (ONB-3); perguntas fechadas via AskUserQuestion,
  escrita default não (ADR-FLX-2); gravação via onboarding-config.mjs (ONB-7);
  CODEOWNERS na fase 2 (TIM-1); docs/fluxo/ em arquivos (FLX-5); PR template,
  CHANGELOG e backlog na fase 3 (ONB-4); modelo (b) com data e dois oks para
  settings.json (ONB-5); calibração da máquina (ONB-6); modo --vincular grava
  .harness/fluxo-cache.json e linha no ledger, nunca escreve na ferramenta (ORQ-6).
  allowed-tools sem mcp__* (ONB-8).

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```
- [ ] Ledger: `Task T22: DONE (worktree @ sha; verificações acima com os números medidos; desvios: <nenhum | lista>)`.

---

## T23 — `skills/gabarito-conformidade/SKILL.md`: cards de fluxo, fio condutor, contenda, `PBI:` único

**Fecha:** REQ-CNF-1, FLX-3 (inclusive o fail-open), PAR-3, ADR-FLX-1 (plano por PBI).
**Arquivos:** `plugins/gabarito-mestre/skills/gabarito-conformidade/SKILL.md` (substituição integral).
**Aceite:** Given repo com `fluxo.resolvidoEm` e design sem `Epic:`, ou plano com dois `PBI:` · When conformidade · Then NÃO CONFORME com item "fio condutor (R19)". Given repo sem `fluxo.resolvidoEm` e design sem `Epic:` · When conformidade · Then item marcado **AVISO** e o veredito não muda por ele. Given Epic sem lista de PBIs · Then NÃO CONFORME item "Epic: PBIs (fluxo.md §2)". Given plano com T2 e T3 paralelas, ambas tocando `prisma/` · Then NÃO CONFORME item "contenda (R21)".

### Passos

- [ ] **Ler antes de escrever:** `reference/fluxo.md` (os 7 cabeçalhos `## ` — os números de seção citados abaixo assumem a ordem de FLX-1: §1 níveis · §2 tipos de card · §3 políticas · §4 movimento · §5 propagação · §6 compromisso/WIP/vazão · §7 métricas; se T2 numerou diferente, **`fluxo.md` vence** e as citações são ajustadas), `templates/fluxo/*.md` (chaves do frontmatter: `id`, `tipo`, `epic`, `iniciativa`, `status`) e `reference/AGENTS.md §3/§6/§7` (texto de R19, R20, R21).

- [ ] **Substituir o arquivo inteiro** por este texto (ajustando só os `§n` de `fluxo.md` se a leitura acima mostrar diferença):

````markdown
---
name: gabarito-conformidade
description: Confere um artefato — design, spec, plano, ADR, card de fluxo (Iniciativa, Epic, PBI de qualquer tipo) — contra a anatomia do harness e o Workflow TRUE, e devolve o que falta com a emenda proposta. Use quando o usuário pedir para "conferir o design", "validar o plano", "checar a spec", "revisar o ADR", "conferir o card", "o Epic está completo?", "o PBI está pronto (DoR)?", "está conforme?", "confere contra o gabarito", "o plano está completo?", "valida este documento", "check this plan/spec/design/card" ou depois que superpowers produzir um design ou plano. Não escreve o artefato — superpowers escreve; esta skill confere.
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(wc:*)
---

# gabarito-conformidade

Recebe **qualquer artefato** e confere contra a anatomia de `${CLAUDE_PLUGIN_ROOT}/reference/referencia.md §2` e, para cards e fio condutor, contra `docs/harness/fluxo.md` (fonte normativa do Workflow TRUE; no plugin: `${CLAUDE_PLUGIN_ROOT}/reference/fluxo.md`). Saída: **o que falta, item a item, e a emenda proposta**. Não aprova por impressão.

## Divisão de trabalho (`reference/AGENTS.md §9`)

- **superpowers CONDUZ:** o design nasce em `superpowers:brainstorming`; o plano em `superpowers:writing-plans`. Esta skill **não reescreve** o artefato nem substitui essas skills — régua duplicada em dois lugares é o que `referencia.md §6` proíbe.
- **ui-ux-pro-max DESENHA:** quando o artefato é de UI/UX, layout, interação, acessibilidade e texto de interface são dele — esta skill **não** confere estética. Ela continua conferindo o que é regra dentro da tela: **servidor é a fronteira (R9), erro em três camadas (§8), tenant absoluto (R10)**.
- **gabarito-mestre MANDA:** a anatomia, o fio condutor (R19), a contenda (R21) e a marcação (a)/(b)/(c). Em conflito, o gabarito vence (§0, item 1).

**Sequência:** superpowers produz → esta skill confere → reporta o que faltou → o usuário (ou superpowers) emenda → conferir de novo → só então concluir.

**Fail-closed declarado (G9):** se superpowers não estiver instalado, avise em uma linha — `superpowers ausente: o artefato não passou pelo brainstorm/plano dele; conferindo mesmo assim` — e confira. Indisponibilidade nunca vira silêncio nem aprovação.

## Pré-conferência: o repo tem fluxo?

1. Raiz: `git rev-parse --show-toplevel` (fallback: diretório atual). `Read` `harness.config.json` se existir.
2. `fluxo.resolvidoEm` presente (`AAAA-MM-DD`) → **modo fluxo**: itens de fio condutor reprovam. Ausente, arquivo ausente ou JSON inválido → **fail-open declarado (G9)**: os itens de fio condutor viram **AVISO** e não entram na contagem de faltas — repo sem onboarding não reprova por vínculo que ainda não existe. Diga qual modo está ativo na linha `Fluxo:` da saída.
3. `orquestracao.paralelismo.arquivosDeContenda` → lista de contenda. Ausente → defaults `["package-lock.json", "prisma/", "src/index.ts", "docs/fluxo/"]` e a nota `defaults (orquestracao ausente)` na saída. Contenda **não** é fail-open: R21 vale com ou sem onboarding.
4. Tipo do artefato: `tipo:` do frontmatter (cards) · cabeçalho `PBI:`/`Epic:` + tasks numeradas (plano) · `STATUS` + requisitos (design/spec) · "Decisão/Racional/Alternativas" (ADR). Em dúvida, pergunte em uma linha.

## Checklist — DESIGN / SPEC (`referencia.md §2.1`)

Ordem fixa. Seção pulada = incompleto, não enxuto.

| # | Item | Reprova se |
|---|---|---|
| 1 | **STATUS** no topo, destacado | não separa o que o sistema **faz** do que está **escrito** que fará |
| 2 | **Fatos medidos** `M1..Mn` (medição · resultado · quando · autorização se tocou terceiro) | fato e desenho dividem parágrafo; medição sem número ou sem data |
| 3 | **Decisões** `D1..Dn` com **alternativa rejeitada e por quê**, marcadas *não reabrir* | decisão sem alternativa rejeitada |
| 4 | **ADRs** com **cláusula de morte** quando for exceção | exceção sem condição de encerramento |
| 5 | **Requisitos** `REQ-<ÁREA>-<n>` em **Given/When/Then**, com gate de permissão e `arquivo:linha` quando existir | requisito como intenção, sem critério de aceite |
| 6 | **Fora de escopo** com **dono e gatilho** (R17) | item sem dono |
| 7 | **Testes e gates** — o que prova cada requisito + **mutações que devem derrubar a suíte** | requisito sem mutação nomeada está coberto, não testado |
| 8 | **Rollout** — a ordem **e o motivo dela**; janela declarada | ordem sem motivo |
| 9 | **Pendências** — o que ficou aberto, por quê, o que desbloqueia | risco só na cabeça de alguém |
| 10 | **Emendas datadas** inline (`_(Emenda AAAA-MM-DD, origem — motivo)_`), nada apagado (R16) | histórico reescrito |
| 11 | **Marcação (a)/(b)/(c)** em toda afirmação normativa (R18) | (b) citado como se fosse (a) |
| 12 | **Fio condutor (R19, `fluxo.md §5`)** — cabeçalho com `Iniciativa: <ID>` e `Epic: <ID>`; lista dos PBIs do Epic (ID + tipo), índice, não plano (ADR-FLX-1); Iniciativa diferente da padrão do repo só como `Iniciativa: <ID> (override: <motivo>)` (D4) | sem `Epic:` · sem `Iniciativa:` · sem lista de PBIs · override sem motivo · ID fora de `fluxo.idPadrao`. **Sem `fluxo.resolvidoEm`: AVISO, não falta** |

## Checklist — PLANO (`referencia.md §2.2`)

| # | Item | Reprova se |
|---|---|---|
| 1 | Tasks **numeradas** | — |
| 2 | **Grafo de dependências explícito** (é ele que autoriza paralelismo) | paralelismo implícito |
| 3 | Cada task diz **qual requisito fecha** | task órfã de requisito |
| 4 | **Gate de fase em contagem verificável** ("12 primitivos + 5 substituições = fase completa") | "parece pronto" |
| 5 | **Task 0 = spike** quando há incógnita externa | incógnita virou premissa (I6) |
| 6 | Pré-condições de rollout **antes** da primeira linha de código | — |
| 7 | Recurso compartilhado (banco, fila, sandbox) declarado **serial** (§6) | duas tasks no mesmo banco em paralelo |
| 8 | Cada task com aceite Given/When/Then e ponteiro (arquivo + linhas) para a spec | conteúdo copiado em vez de ponteiro |
| 9 | **`PBI: <ID>` único e `Epic: <ID>` no cabeçalho** (ADR-FLX-1: um plano por PBI; fases são grupos, nunca outros PBIs) | dois `PBI:` · nenhum `PBI:` · sem `Epic:` · ID fora de `fluxo.idPadrao`. **Sem `fluxo.resolvidoEm`: AVISO** |
| 10 | **Tipo por task**: cada task declara `tipo:` ∈ {US, Enabler, TechDebt, Spike, Bug, Tarefa} (`fluxo.md §2`) | task sem tipo ou tipo fora da lista. **Sem `fluxo.resolvidoEm`: AVISO** |
| 11 | **Contenda serial (R21, `AGENTS.md §6`)** — task que toca qualquer caminho de `arquivosDeContenda` está marcada `serial: contenda` **e** o grafo não a paraleliza com outra task que também toque contenda | duas tasks declaradas paralelas tocando o mesmo caminho de contenda · task de contenda sem `serial: contenda`. Item "contenda (R21)". Nunca AVISO |

Para o item 11, cruze a lista de arquivos de cada task com a lista de contenda (prefixo de diretório conta: `prisma/migrations/x.sql` toca `prisma/`). Cite as duas tasks e o caminho.

## Checklist — CARDS DE FLUXO (`fluxo.md §2`)

Tipo lido de `tipo:` no frontmatter ou do título. Card vindo de ferramenta (ClickUp, Jira…): o usuário cola o texto ou aponta o arquivo exportado — esta skill **não lê MCP**.

**Comum a todo card** (`fluxo.md §2` e `§5`): frontmatter com `id` (casa `fluxo.idPadrao`), `tipo`, `status` (nome que existe em `fluxo.status` do nível) · **vínculo**: PBI tem `epic:`; Epic tem `iniciativa:` (ou override com motivo); Iniciativa não tem pai · sem vínculo = item "fio condutor (R19)" (AVISO sem `fluxo.resolvidoEm`) · **DoR** do nível (`fluxo.md §1`) antes de entrar em execução.

| Tipo | Campos obrigatórios (`fluxo.md §2`) | Reprova se |
|---|---|---|
| **Iniciativa** (FL3) | Problema · Resultado **com indicador** · Escopo · Horizonte · Patrocinador · Critério de sucesso **com meta** | resultado sem indicador · critério sem número/meta · sem patrocinador |
| **Epic** (FL2) | Narrativa em **7 linhas** · RN (regras de negócio) · CA (critérios de aceite) · **lista de PBIs** (ID + tipo) | narrativa ausente ou > 7 linhas · sem RN · sem CA · sem lista → item "Epic: PBIs (fluxo.md §2)" |
| **US** (FL1) | `Como <papel> / quero <ação> / para <valor>` · RN · CA em **BDD** (Given/When/Then) | qualquer das três partes ausente · CA sem BDD |
| **Enabler** (FL1) | `Para <objetivo> / precisamos <o quê>` · CA | sem CA · sem "para" |
| **TechDebt** (FL1) | `Para / precisamos` · CA | idem Enabler |
| **Tarefa** (FL1) | `Para / precisamos` · CA · **área** · **ponto focal** · **prazo** | sem área, ponto focal ou prazo |
| **Spike** (FL1) | `Para / precisamos / em até <timebox>` · CA (pergunta **fechada** + o que conta como resposta) | sem timebox · pergunta aberta · CA sem número esperado |
| **Bug** (FL1) | descrição com **onde** / **desde quando** / **afetando quem** · **reprodução** passo a passo · **esperado** × observado | sem reprodução · sem "desde" · sem esperado |

Movimento e bloqueio (`fluxo.md §4`): card "bloqueado" é **marcação com data, motivo e dono do desbloqueio**, não coluna; card parado além de `fluxo.envelhecimentoDias` sem movimento é pauta do nível acima — aponte, não reprove.

## Checklist — ADR

Decisão · racional · alternativas rejeitadas · **cláusula de morte** se for exceção a R6–R12 · data · marcação (a)/(b).

## Formato da saída

```
CONFORMIDADE — <artefato> (<tipo>)   veredito: CONFORME | NÃO CONFORME (<n> faltas · <m> avisos)

| # | Item da anatomia | Estado | Onde (linha) | Emenda proposta |
|---|---|---|---|---|
| 3 | Decisões com alternativa rejeitada | FALTA | D2, l.41 | acrescentar "Rejeitado: X porque Y" |
| 12 | Fio condutor (R19) | FALTA | cabeçalho, l.1–6 | acrescentar `Epic: EPIC-7` e a lista dos PBIs |
| 11 | Contenda (R21) | FALTA | T2/T3 × prisma/ | marcar T3 `serial: contenda`; grafo T2 → T3 |
...
Fluxo: <"resolvido em <data> (modo fluxo)" | "sem onboarding — fio condutor como AVISO (fail-open declarado, G9); rode gabarito-instalar">
Contenda: <lista usada> <"(config)" | "(defaults — orquestracao ausente)">
UI/UX: <"n/a" | "estética delegada a ui-ux-pro-max; R9/§8/R10 conferidos: ok | falta em …">
Maquinaria: <"superpowers presente" | "superpowers ausente — modo próprio">
```

Estados: `FALTA` (conta no veredito) · `AVISO` (não conta; só fio condutor sem onboarding, e envelhecimento) · `SUSPEITA` (sem fonte na linha) · `ok`. Cada linha é uma **alegação com fonte** (linha do artefato). Sem fonte, é suspeita — escreva "suspeita", não "falta". Veredito: `NÃO CONFORME` se e só se há ≥ 1 `FALTA`.

## Proibido

- Reescrever o artefato inteiro. Emenda é cirúrgica e proposta, não aplicada sem o usuário.
- Aprovar por impressão geral. Veredito sem tabela não vale.
- Conferir estética de UI — isso é do ui-ux-pro-max.
- Reprovar por fio condutor em repo sem `fluxo.resolvidoEm` — é AVISO (FLX-3). Silenciar o aviso também é proibido.
- Rebaixar contenda a aviso: R21 não tem override, com ou sem onboarding.
- Ler a ferramenta de planejamento por MCP — esta skill confere texto que recebe.
````

- [ ] **Verificar:**
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre/plugins/gabarito-mestre
  C=skills/gabarito-conformidade/SKILL.md
  grep -c 'fio condutor' "$C"                    # ≥ 5
  grep -c 'contenda (R21)' "$C"                  # ≥ 2
  grep -c 'Epic: PBIs (fluxo.md §2)' "$C"        # 1
  grep -c 'fail-open declarado' "$C"             # ≥ 2
  grep -c '^| \*\*\(Iniciativa\|Epic\|US\|Enabler\|TechDebt\|Tarefa\|Spike\|Bug\)\*\*' "$C"   # 8
  grep -c 'PBI: <ID>` único' "$C"                # 1
  grep -c 'serial: contenda' "$C"                # ≥ 2
  grep -c 'AVISO' "$C"                           # ≥ 6
  sed -n '/^allowed-tools:/p' "$C" | grep -c 'mcp__'   # 0
  claude plugin validate . --strict              # Validation passed
  ```
- [ ] **Conferência manual (gate de fase; registrar no ledger com o veredito literal):** crie uma fixture em diretório temporário e rode a skill em sessão headless com o plugin local — sem MCP, para a medição não depender de conectores:
  ```bash
  P=/Users/gabs-dev/projetos_pessoais/gabarito-mestre/plugins/gabarito-mestre
  F="$(mktemp -d)" && cd "$F" && git init -q -b main && mkdir -p docs/specs docs/plans
  cat > docs/specs/design-sem-epic.md <<'EOF'
  # Design — exportador de relatórios
  Iniciativa: INI-1
  **STATUS: DESENHO PRONTO.** Nada implementado.
  ## Fatos medidos
  | M1 | 1.200 linhas/relatório | 2026-09-24 | n/a |
  ## Decisões
  | D1 | CSV, não XLSX | XLSX rejeitado: dependência pesada |
  ## Requisitos
  **REQ-EXP-1** — Given 1.200 linhas · When exporto · Then CSV em < 2 s.
  ## Fora de escopo
  | XLSX | Gabriel | 3 pedidos de cliente |
  ## Testes e gates
  | REQ-EXP-1 | teste de tempo | remover o streaming |
  ## Rollout
  1. exportador (motivo: sem dependência).
  ## Pendências
  nenhuma.
  EOF
  cat > docs/plans/plano-contenda.md <<'EOF'
  # Plano — PBI-12
  PBI: PBI-12
  Epic: EPIC-7
  ## Grafo
  T1 → (T2 ∥ T3)
  ## Tasks
  ### T1 · tipo: Enabler · fecha REQ-EXP-1 · arquivos: src/export.ts
  ### T2 · tipo: US · fecha REQ-EXP-1 · arquivos: prisma/schema.prisma, src/a.ts
  ### T3 · tipo: US · fecha REQ-EXP-1 · arquivos: prisma/migrations/001.sql, src/b.ts
  EOF
  # (1) sem onboarding → fio condutor AVISO
  claude -p --plugin-dir "$P" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --permission-mode plan \
    "use a skill gabarito-conformidade e confira docs/specs/design-sem-epic.md contra o gabarito" | tee "$F/out-1.txt"
  grep -c 'AVISO' "$F/out-1.txt"        # ≥ 1 e a linha do item 12 marcada AVISO
  # (2) com onboarding → fio condutor FALTA
  printf '{"fluxo":{"resolvidoEm":"2026-09-24","idPadrao":"^[A-Z]+-\\\\d+$"}}\n' > harness.config.json
  claude -p --plugin-dir "$P" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --permission-mode plan \
    "use a skill gabarito-conformidade e confira docs/specs/design-sem-epic.md contra o gabarito" | tee "$F/out-2.txt"
  grep -c 'NÃO CONFORME' "$F/out-2.txt" # 1
  grep -c 'fio condutor' "$F/out-2.txt" # ≥ 1, estado FALTA
  # (3) plano com contenda paralela → "contenda (R21)"
  claude -p --plugin-dir "$P" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --permission-mode plan \
    "use a skill gabarito-conformidade e confira docs/plans/plano-contenda.md contra o gabarito" | tee "$F/out-3.txt"
  grep -c 'contenda (R21)' "$F/out-3.txt" # ≥ 1, estado FALTA
  ```
  Os três resultados (com o texto literal da linha do item) vão para o ledger `GM-5.md`. A **mutação de prompt** (retirar "fio condutor" do checklist e ver o design passar) é a M15 da Fase 6 (T26), não desta task.
- [ ] Commit:
  ```bash
  git add plugins/gabarito-mestre/skills/gabarito-conformidade/SKILL.md
  git commit -m "$(cat <<'EOF'
  feat(GM-5): gabarito-conformidade confere cards, fio condutor e contenda

  Checklists por tipo de card (Iniciativa, Epic com lista de PBIs, US, Enabler,
  TechDebt, Tarefa, Spike, Bug) citando fluxo.md por seção (CNF-1); fio condutor
  no design (Iniciativa:/Epic: + PBIs) e no plano (PBI: único, Epic:, tipo por
  task) com fail-open declarado: sem fluxo.resolvidoEm o item vira AVISO (FLX-3);
  contenda serial no grafo lida de arquivosDeContenda, nunca aviso (PAR-3, R21).

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```
- [ ] Ledger: `Task T23: DONE (worktree @ sha; contagens dos greps; vereditos literais das três conferências manuais)`.

---

## T24 — `agents/gabarito-implementador.md` (bloco Isolamento) · `commands/gabarito-doctor.md` (`warn` ≠ FALTA)

**Fecha:** REQ-PAR-4 (agente), REQ-ORQ-5 e DOC-1 (comando: `warn`, linha "checagens novas da 1.1.0", `--cache`).
**Arquivos:** `plugins/gabarito-mestre/agents/gabarito-implementador.md`, `plugins/gabarito-mestre/commands/gabarito-doctor.md`.
**Aceite:** Given `n=2` · When dispatch · Then o prompt do implementador contém `porta 3002 · schema wt_2 · namespace wt-2` (PAR-4) — o agente carrega o bloco com placeholders (`<3000+n>`, `<wt_n>`, `<wt-n>`); quem resolve é o orquestrador. Given `resolvidoEm` há 91 dias · When `/gabarito-doctor` · Then a explicação distingue `warn modelo-resolvido` de `FALTA` e não sugere subir o §0.2.

### Passos — agente

- [ ] **Ler** `reference/prompts.md`, seção "## Implementador", e copiar **verbatim** o bloco "Isolamento" que T20 escreveu. O texto de referência é o abaixo; se `prompts.md` divergir, **`prompts.md` vence** (o agente diz que é o prompt de papel versionado lá — fonte única):
  ```
  Isolamento: porta <3000+n> · schema <wt_n> · namespace <wt-n> — não use outro.
  Você está no worktree wt/<PBI>-<n> (branch a partir de <branch do PBI>). Tudo que você sobe
  — dev server, banco de teste, fila, cache, diretório temporário — usa SÓ esses três valores.
  Porta, schema ou namespace fora deles pertencem a outro implementador ou ao orquestrador:
  encontrou um ocupado, não "pegue o próximo" — pare e reporte.
  ```
  (Bloco copiado VERBATIM da Fase 4 — T20, prompt do Implementador em `prompts.md`; os placeholders são `<3000+n>`, `<wt_n>`, `<wt-n>`, não `<X>/<Y>/<Z>`. Não acrescente as linhas "(resolvido de … PAR-4.)" — a resolução é dever do orquestrador, descrita em "Antes de despachar".)
- [ ] Inserir o bloco em `agents/gabarito-implementador.md` **imediatamente após** a linha `Escopo: trabalhe SOMENTE em <lista de arquivos>. Precisou tocar outro arquivo? Pare e reporte.` e uma linha em branco. Nenhuma linha de proibição é removida ou reordenada.
- [ ] Na linha de abertura do agente (`Preencha os <placeholders> com o que veio no dispatch…`), acrescentar ao fim: `O bloco "Isolamento" chega resolvido pelo orquestrador (prompts.md, "Antes de despachar"); você não escolhe porta, schema nem namespace.`
- [ ] **Verificar:**
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre/plugins/gabarito-mestre
  grep -c 'Isolamento: porta <3000+n> · schema <wt_n> · namespace <wt-n> — não use outro' agents/gabarito-implementador.md   # 1
  grep -c 'Isolamento: porta <3000+n> · schema <wt_n> · namespace <wt-n> — não use outro' reference/prompts.md               # 1
  # compara SÓ o bloco verbatim (da linha "Isolamento:" até "pare e reporte."), extraído dos dois arquivos
  diff <(sed -n '/^Isolamento: porta/,/não "pegue o próximo" — pare e reporte\.$/p' agents/gabarito-implementador.md) \
       <(sed -n '/^Isolamento: porta/,/não "pegue o próximo" — pare e reporte\.$/p' reference/prompts.md) && echo "bloco idêntico"
  grep -c 'Proibido: deletar qualquer coisa (R2)' agents/gabarito-implementador.md                                 # 1 (nada removido)
  grep -c '^model: inherit' agents/gabarito-implementador.md                                                        # 1
  # teste de string do dispatch (PAR-4, mutação "n fixo em 1"): resolver n=2 sobre o bloco
  sed 's/<3000+n>/3002/; s/<wt_n>/wt_2/; s/<wt-n>/wt-2/' agents/gabarito-implementador.md | grep -c 'porta 3002 · schema wt_2 · namespace wt-2'   # 1
  ```

### Passos — comando

- [ ] Em `commands/gabarito-doctor.md`, trocar `3. Explique, em no máximo 12 linhas:` por `3. Explique, em no máximo 14 linhas:` e acrescentar, depois do item "O que está marcado `--`…", estes três itens (texto final):
  ```markdown
     - **`warn`** (ex.: `warn modelo-resolvido`): **aviso, não falta** — não entra no nível, não muda o exit code, não quebra CI. Significa que `orquestracao.modelo.resolvidoEm` passou de `validadeDias` (90): a família "mais potente" pode ter mudado. Conserto: revalidar em `gabarito-instalar` (fase 4 — "refazer onboarding"). `warn` ≠ `FALTA` ≠ `--`.
     - A linha **`checagens novas da 1.1.0: rode o onboarding ou declare o nível medido`** aparece em repo 1.0.x cujo nível caiu por checagens que não existiam (`fluxo-configurado`, `versionamento`, `changelog`, `agents-tamanho`, `iniciativa-resolvida`, `paralelismo-calibrado`). Conserto: `gabarito-instalar` (onboarding) **ou** baixar o `§0.2` para o medido — nunca o contrário.
     - `--cache` grava `.harness/doctor-cache.json` (`{ nivel, declarado, em }`) para o cartão de sessão; **não** passe `--cache` no CI nem ao explicar para o usuário — o cartão o chama sozinho quando o cache tem mais de 24 h.
  ```
- [ ] No passo 1 do comando, acrescentar após o bloco da cópia do plugin: `A cópia instalada pode estar atrás do plugin (o cartão de sessão avisa "rode instalar.sh --atualizar"); nesse caso, rode as duas e explique a diferença — a que vale no CI é a instalada.`
- [ ] **Verificar:**
  ```bash
  cd /Users/gabs-dev/projetos_pessoais/gabarito-mestre/plugins/gabarito-mestre
  grep -c 'warn modelo-resolvido' commands/gabarito-doctor.md            # 1
  grep -c 'aviso, não falta' commands/gabarito-doctor.md                 # 1
  grep -c 'checagens novas da 1.1.0' commands/gabarito-doctor.md         # 1
  grep -c 'no máximo 14 linhas' commands/gabarito-doctor.md              # 1
  grep -c 'Nunca\*\* sugira editar o número do §0.2 para cima' commands/gabarito-doctor.md   # 1 (nada removido)
  claude plugin validate . --strict                                      # Validation passed
  ```
- [ ] Commit (um só; os dois arquivos fecham a mesma task):
  ```bash
  git add plugins/gabarito-mestre/agents/gabarito-implementador.md plugins/gabarito-mestre/commands/gabarito-doctor.md
  git commit -m "$(cat <<'EOF'
  feat(GM-5): implementador com bloco Isolamento · doctor explica warn

  Agente recebe "Isolamento: porta <X> · schema <Y> · namespace <Z> — não use
  outro", idêntico ao de prompts.md (PAR-4). /gabarito-doctor explica warn
  (modelo vencido) como aviso que não entra no nível nem quebra CI (ORQ-5), a
  linha "checagens novas da 1.1.0" (DOC-1) e o uso de --cache (DOC-2).

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```
- [ ] Ledger: `Task T24: DONE (worktree @ sha; "bloco idêntico" medido; greps)`.

---

## Fecho da fase (orquestrador)

- [ ] Integrar T22, T23, T24 com `merge --no-ff` na ordem do grafo (qualquer ordem: arquivos disjuntos). Revisor adversarial (`gabarito-revisor`) sobre o diff integrado, com as mutações prescritas: **T22** — remover `Bash(claude mcp list:*)` do frontmatter → grep de verificação cai; trocar `"escrita": false` por `true` no JSON da §2.4 → viola ADR-FLX-2 (grep `"escrita": false` = 1 deve ser o gate). **T23** — retirar a linha "Sem `fluxo.resolvidoEm`: AVISO" → o repo sem onboarding passa a reprovar (viola FLX-3). **T24** — fixar `n` em 1 no bloco → `sed` de verificação com `n=2` deixa de casar.
- [ ] Gate de fase medido e escrito no ledger: `4 arquivos modificados · validate --strict ok · conferência manual: (1) AVISO (2) FALTA (3) contenda (R21)`.
- [ ] PR `enabler/GM-5-skills` → `main` com título `enabler(GM-5): skills, agente e comando da 1.1.0` — abrir **só com ok do usuário** (R1). Corpo: os três commits, o gate de fase, e a lista "o que ficou (b)": os números de seção de `fluxo.md` citados em T23 dependem da numeração de T2 (conferida, não presumida); o bloco Isolamento é (a) idêntico ao de `prompts.md` pelo `diff`.
- [ ] `## FECHO — PR mergeada` no ledger com achados do review e backlog gerado (candidatos: "conformidade lê card direto da ferramenta por MCP" — dono Gabriel, gatilho: 3 pedidos de conferência de card colado à mão).

## Emendas (2026-09-24, revisão cruzada)

- #1: nomes de chave da config em camelCase (`resolvidoEm`, `calibradoEm`, `arquivosDeContenda`, …) em toda a skill `gabarito-instalar`.
- #4: T24 — bloco "Isolamento" substituído pela cópia VERBATIM do prompt do Implementador da Fase 4 (`porta <3000+n> · schema <wt_n> · namespace <wt-n>` + 4 linhas), sem as linhas "(resolvido de … PAR-4.)"; greps e `sed 's/<3000+n>/3002/; s/<wt_n>/wt_2/; s/<wt-n>/wt-2/'` ajustados; o `diff` compara só o bloco verbatim extraído dos dois arquivos; Aceite deixa de falar em "instrução de resolução".
- #6: tabela de `status` da fase 2 do onboarding usa os nomes de coluna de `fluxo.md §4`.
- #8: `.github/CODEOWNERS` — três casos (ausente → cria; existe → não toca; `--codeowners` → esqueleto).
- #10: detecção de repo 1.0.x (`tools/gabarito-gates/` sem `.instalado.json`) antes da fase 1.
- #11: `onboarding-config.mjs` exit 1 = erro de argumento/JSON inválido; a skill corrige e repete.
- #12: fail-open com stderr explícito — a skill lê o stderr e para.
- #15: tabela "O que o instalador cria" — `gabarito.yml` anota "(guarda de migrations desligada por padrão — `gates.md §4`)".
- #16: pré-condição do ledger `GM-5.md` no cabeçalho novo de `referencia.md §2.3` (`PBI: GM-5 · Epic: (b) — repo do plugin, sem onboarding`, `## LER PRIMEIRO — <data>`).

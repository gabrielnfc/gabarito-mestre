# Gabarito Mestre 1.1.0 — Plano-mestre de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a versão 1.1.0 do plugin `gabarito-mestre`: camada de fluxo (Workflow TRUE), onboarding na instalação, versionamento trunk-based como gate, orquestração por subagente com paralelismo medido, e contexto em camadas.

**Architecture:** Abordagem A da spec — camada aditiva sobre o harness 1.0.1. Fonte legível (`reference/fluxo.md`) separada da fonte de máquina (`harness.config.json` seções `fluxo`, `versionamento`, `orquestracao`, `contexto`). Scripts Node zero-dependência em `gates/scripts/` são a base; hooks bash 3.2 os chamam; texto de referência os cita; skills os orquestram; pacote fecha.

**Tech Stack:** Node ≥ 22.18 (ESM, `node --test`, `node:fs/os/child_process`), bash 3.2 (macOS) com `jq|node|python3` para JSON, Markdown, JSON. Zero dependências npm.

**Spec:** `docs/superpowers/specs/2026-09-24-workflow-true-design.md` — o plano argumenta a partir dela; executores leem os dois.

**Planos de fase (tasks detalhadas, passo a passo):**

| Fase | Arquivo | Tasks | Rollout da spec |
|---|---|---|---|
| 1 | `2026-09-24-workflow-true-1.1.0-fase-1-fluxo.md` | T1–T4 | 0, 1 e parte de 4 |
| 2 | `2026-09-24-workflow-true-1.1.0-fase-2-gates.md` | T5–T11 | 2 |
| 3 | `2026-09-24-workflow-true-1.1.0-fase-3-hooks.md` | T12–T16 | 3 |
| 4 | `2026-09-24-workflow-true-1.1.0-fase-4-referencia.md` | T17–T21 | 4 |
| 5 | `2026-09-24-workflow-true-1.1.0-fase-5-skills.md` | T22–T24 | 5 |
| 6 | `2026-09-24-workflow-true-1.1.0-fase-6-pacote.md` | T25–T26 | 6 |

**PBI:** este repositório ainda não está sob o fluxo (é o plugin). Cada fase é tratada como um PBI de Enabler: branch `enabler/GM-<fase>-<slug>`, ledger `docs/ledgers/GM-<fase>.md`, PR por fase. Commits em Conventional Commits com escopo `GM-<fase>` (ex.: `feat(GM-2): capacidade.mjs`).

## Global Constraints

- Node `>=22.18`; scripts `.mjs` ESM; **zero dependências** (`gates/package.json` `dependencies: {}` permanece vazio).
- Hooks em bash compatível com **3.2** (macOS): sem `mapfile`, sem `declare -A`, sem `${var,,}`; JSON lido por `jq → node → python3` (função `gabarito_read_command` existente).
- **Nunca sobrescrever nem apagar arquivo do usuário** (R2). Única exceção: `tools/gabarito-gates/` via `--gates-substituir` com `.bak` e recusa por hash (ADR-TIM-1).
- **Fail-open declarado** em todo script/hook quando `harness.config.json` não tem a seção que ele precisa: stderr com "fail-open declarado (G9)", exit 0, nada bloqueado.
- Raiz do repo em hooks e scripts: `git rev-parse --show-toplevel` (fallback: cwd).
- Teto do núcleo do `AGENTS.md` (bytes antes de `## Apêndice`): **17.291**; Apêndice: **4.096** (defaults; `contexto.nucleoMaxBytes` / `contexto.apendiceMaxBytes`).
- Cartão de sessão: **≤ 40 linhas**; hook SessionStart `timeout: 30`; UserPromptSubmit `timeout: 5`; PreToolUse `timeout: 10`.
- Validade do modelo: **90 dias** → `warn`, nunca FALTA. Cache do doctor: **24 h**. Atestados: **180 dias**.
- `plugin.json` **sem** chave `hooks` (chave duplicada quebra o load).
- Versão `1.1.0` em três lugares: `plugins/gabarito-mestre/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/gabarito-mestre/gates/package.json`.
- Testes: `node --test` nos `.mjs`; corpora de hooks em `hooks/test/corpus/*.txt` (uma entrada por linha; entradas multilinha usam o separador já usado por `guards.test.mjs` — o executor lê o arquivo antes de adicionar).
- Idioma de todo texto voltado ao usuário: **português do Brasil**. Nomes de chaves de config em português sem acento (`simultaneos`, `teto`).
- Nenhuma URL com token, nenhum segredo em config, cache ou log.

## Review Focus

Cinco entradas que a spec implica mas nenhum teste de task cobre por padrão — cada uma ganha teste na task dona:

1. **`git commit -m "$(cat <<'EOF' … EOF)"` multilinha** (forma padrão do Claude Code): o hook tem de validar a **primeira linha do corpo do heredoc**, não a linha `git commit`. → teste em T13.
2. **Sessão aberta em subpasta de monorepo** (`apps/api/`): scripts e hooks resolvem a raiz via `git rev-parse --show-toplevel`; sem `.git` (fixture solta), usam cwd e não quebram. → testes em T9 e T14.
3. **`harness.config.json` ausente, vazio, ou com JSON inválido**: nenhum script lança stack trace; todos imprimem "fail-open declarado" e saem 0 (doctor: `FALTA fluxo-configurado`, não crash). → testes em T5, T6, T7, T9.
4. **`AGENTS.md` com CRLF ou cabeçalho `## Apêndice —` (com travessão e texto)**: a contagem de bytes do núcleo corta no primeiro cabeçalho que **começa** com `## Apêndice`, e o CRLF conta bytes reais. → teste em T8.
5. **Branch sem PBI** (`main`, `wt/PBI-7-2`, `chore/GM-3-x`, `feat/pbi-12-x` em minúsculas): o cartão infere `PBI` só quando casa `idPadrao` (case-sensitive), trata `wt/<PBI>-<n>` como PBI + índice, e escreve `PBI: (b) não inferido` nos demais — nunca inventa. → teste em T9.

---

## Estrutura de arquivos (criar · modificar)

```
plugins/gabarito-mestre/
  reference/
    fluxo.md                         CRIAR   (T2)  fonte normativa do Workflow TRUE
    ferramentas-mcp.json             CRIAR   (T4)  servidor MCP → ferramenta → hierarquia sugerida
    AGENTS.md                        MOD     (T17) cortes CTX-1 · R19 §7 · R20 §3 · R21 §6 · camadas §6 · §8 · §9 · Apêndice · R30+
    referencia.md                    MOD     (T18) §3.1 wt/ · §3.4 reescrito · §3.5 novo · §5/§11/§12 recebem texto · §10 Versionamento
    adocao.md                        MOD     (T19) §4 MCP demais · §5 time
    prompts.md                       MOD     (T20) Implementador: Isolamento · Orquestrador: Antes de despachar
  templates/
    fluxo/{iniciativa,epic,us,enabler,tech-debt,spike,bug,tarefa}.md   CRIAR (T3)
    attest.json                      MOD     (T21) + iniciativa-resolvida, squash-titulo-pr
    gabarito.yml                     MOD     (T21) fetch-depth 0 · job versionamento · nome sem número
    PULL_REQUEST_TEMPLATE.md         CRIAR   (T21)
    CHANGELOG.md                     CRIAR   (T21)
    backlog.md                       CRIAR   (T21)
    harness.config.json              MOD     (T21) só o _comment: seções novas vêm do onboarding
  gates/
    package.json                     MOD     (T11) version 1.1.0 · bin novos
    scripts/
      onboarding-config.mjs          CRIAR   (T5)
      capacidade.mjs                 CRIAR   (T6)
      versionamento-check.mjs        CRIAR   (T7)
      harness-doctor.mjs             MOD     (T8)  checagens novas · --cache · agents-tamanho
      cartao-sessao.mjs              CRIAR   (T9)
    test/
      onboarding-config.test.mjs     CRIAR   (T5)
      capacidade.test.mjs            CRIAR   (T6)
      versionamento-check.test.mjs   CRIAR   (T7)
      harness-doctor.test.mjs        MOD     (T8)
      cartao-sessao.test.mjs         CRIAR   (T9)
  scripts/
    instalar.sh                      MOD     (T10) --atualizar · --gates-substituir · .instalado.json · .gitignore
    test/instalar.test.sh            CRIAR   (T10)
  hooks/
    _common.sh                       MOD     (T12) gabarito_escape_hatch <ROTULO> <VAR> · gabarito_repo_root
    guard-versioning.sh              CRIAR   (T13)
    session-card.sh                  CRIAR   (T14)
    remind-orchestrator.sh           CRIAR   (T15)
    hooks.json                       MOD     (T16)
    test/corpus/versionamento.txt    CRIAR   (T13)
    test/guards.test.mjs             MOD     (T13, T14, T15)
  skills/
    gabarito-instalar/SKILL.md       MOD     (T22) 4 fases · --vincular · frontmatter
    gabarito-conformidade/SKILL.md   MOD     (T23) checklists de card · fio condutor · contenda
  agents/gabarito-implementador.md   MOD     (T24) bloco Isolamento
  commands/gabarito-doctor.md        MOD     (T24) warn ≠ FALTA
  .claude-plugin/plugin.json         MOD     (T25) 1.1.0
.claude-plugin/marketplace.json      MOD     (T25) 1.1.0
CHANGELOG.md · README.md             MOD     (T25)
.github/workflows/ci.yml             MOD     (T25) roda os testes novos + instalar.test.sh
docs/backlog.md                      CRIAR   (T1)
```

---

## Contrato de interfaces (vale para todas as fases)

Todo executor lê **este bloco** antes da sua task. Nomes aqui são os nomes; não invente sinônimos.

### Config — `harness.config.json` (raiz do repo do usuário)

Seções novas, **nunca** presentes no template; gravadas por `onboarding-config.mjs`. Formas exatas:

```json
"fluxo": {
  "ferramenta": "clickup|jira|linear|notion|trello|asana|monday|arquivos",
  "mcp": "claude_ai_ClickUp | null",
  "iniciativa": { "id": "INI-1", "nome": "…", "url": "https://… (sem token)" },
  "mapeamento": { "FL3": "…", "FL2": "…", "FL1": "…" },
  "status": { "FL2": { "preparado": "…", "em_execucao": "…", "em_validacao": "…", "concluido": "…" },
              "FL1": { "preparado": "…", "em_execucao": "…", "revisao": "…", "pronto": "…", "concluido": "…" } },
  "vinculoPbiEpic": { "tipo": "campo | relacionamento | frontmatter", "nome": "<nome na ferramenta>" },
  "escrita": false,
  "idPadrao": "^[A-Z]+-\\d+$",
  "ledgerDir": "docs/ledgers",
  "envelhecimentoDias": 3,
  "resolvidoEm": "AAAA-MM-DD"
},
"versionamento": {
  "modelo": "trunk",
  "branchPadrao": "^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$",
  "branchWorktree": "^wt/[A-Z]+-\\d+-\\d+$",
  "commit": "conventional",
  "tiposComEscopoDePbi": ["feat","fix","enabler","debt","spike","task","perf","refactor"],
  "tiposLivres": ["chore","docs","ci","build","test","release","revert"],
  "tag": "^v\\d+\\.\\d+\\.\\d+$",
  "changelog": "CHANGELOG.md",
  "resolvidoEm": "AAAA-MM-DD"
},
"orquestracao": {
  "modelo": { "politica": "mais-potente", "alias": "fable", "resolvidoEm": "AAAA-MM-DD", "validadeDias": 90 },
  "sempreSubagente": true,
  "lembretePorPrompt": false,
  "paralelismo": {
    "modo": "auto",
    "simultaneos": 2,
    "teto": 4,
    "limites": { "loadPorCoreMax": 1.5, "memDisponivelMinMB": 2048, "discoLivreMinGB": 5 },
    "arquivosDeContenda": ["package-lock.json", "prisma/", "src/index.ts", "docs/fluxo/"],
    "isolamentoWorktree": { "porta": "3000+n", "dbSchema": "wt_{n}", "namespace": "wt-{n}" },
    "rodadasAntesDeEscalar": 2,
    "calibradoEm": "AAAA-MM-DD"
  }
},
"contexto": { "nucleoMaxBytes": 17291, "apendiceMaxBytes": 4096 }
```

Defaults quando a seção falta: cada script carrega `DEFAULTS` próprio com exatamente os valores acima, avisa `defaults (<secao> ausente)` em stderr e **declara fail-open** onde a spec manda (hooks de versionamento, cartão, conformidade → AVISO).

Calibração (`capacidade.mjs --calibrar`): `simultaneos = clamp(floor(cores / 4), 1, 3)`; `teto = clamp(floor(cores / 2), 2, 8)`; `limites` = defaults acima.

Gatilho do onboarding por fase: fase 2 roda se falta `fluxo.resolvidoEm`; fase 3 se falta `versionamento.resolvidoEm`; fase 4 se falta `orquestracao.modelo.resolvidoEm`. Onboarding interrompido retoma da fase que falta.

Movimento de Epic (FLX-6): sempre ledger + `.harness/fluxo-cache.json`; em `arquivos`, `status` em `docs/fluxo/epics/<ID>.md` commitado **na branch do PBI** (`chore(fluxo): <Epic> → <status>`), nunca em `main`; com MCP, só se `fluxo.escrita: true`.

### Arquivos de estado (raiz do repo do usuário; gitignored pelo instalador)

- `.harness/fluxo-cache.json` → `{ "<PBI>": { "epic": "EPIC-7", "iniciativa": "INI-1", "titulo": "…", "em": "AAAA-MM-DD" } }`
- `.harness/doctor-cache.json` → `{ "nivel": 1, "declarado": 0, "em": "<ISO 8601>" }`
- `tools/gabarito-gates/.instalado.json` → `{ "versao": "1.1.0", "em": "<ISO>", "arquivos": { "<rel>": "<sha256 hex>" } }`
- `.gitignore` recebe (sem duplicar, sem remover): `.harness/doctor-cache.json`, `.harness/fluxo-cache.json`, `*.novo`, `*.bak`

### Ledger — linhas que os scripts leem (`<ledgerDir>/<PBI>.md`)

```
MOVIMENTO FL2 <EPIC> <de>→<para> <AAAA-MM-DD>
BLOQUEADA <AAAA-MM-DD> <motivo livre> — dono: <quem>
DISPATCH Task <N> slots=<n> worktree wt/<PBI>-<n>
## LER PRIMEIRO
```

**Grafia canônica de `MOVIMENTO`:** `<de>` e `<para>` são as **chaves** de `fluxo.status.FL2` (`preparado`, `em_execucao`, `em_validacao`, `concluido`), minúsculas, sem espaços — nunca o nome de coluna (`Em execução`). Exemplo: `MOVIMENTO FL2 EPIC-7 preparado→em_execucao 2026-09-21`. `lerLedger` (T9) tolera a grafia com nome de coluna (normaliza `trim` + minúsculas + espaço→`_`), mas templates, prompts e README escrevem sempre as chaves.

### Scripts — CLI e exports

| Script | CLI | Exports (ESM) | Exit |
|---|---|---|---|
| `onboarding-config.mjs` | `--root <dir>` `--set <fluxo\|versionamento\|orquestracao\|contexto> '<json>'` · `--settings '<json>'` (grava `.claude/settings.json`) · `--dry-run` | `mergeDeep(base, patch)` (objetos: recursivo; arrays: substitui; `undefined`: ignora; nunca remove) · `aplicar(root, secao, patch) → { antes, depois, diff: string[] }` | 0 ok · 1 JSON inválido |
| `capacidade.mjs` | `--root <dir>` `--json` `--calibrar` | `medir() → Medidas` · `calcularSlots(paralelismo, medidas, env) → { slots, motivo, medidas }` | sempre 0 |
| `versionamento-check.mjs` | `--root <dir>` `--base <ref>` `--branch <nome>` `--max 20` `--json` | `parseCabecalho(msg) → { tipo, escopo, assunto } \| null` · `validarCommit(msg, cfg) → { ok, motivo }` · `validarBranch(nome, cfg) → { ok, motivo }` · `checar(root, opts) → { ok, achados: [{ sha, motivo }] }` | 0 ok · 1 achado · 0 fail-open sem config |
| `harness-doctor.mjs` | + `--cache` | `run(root, opts)` (puro, como hoje) · `CHECKS` + novos · `parseDeclaredLevel` · `tamanhoAgents(texto) → { nucleo, apendice }` | como hoje |
| `cartao-sessao.mjs` | `--root <dir>` `--plugin-root <dir>` `--json` `--agora <ISO>` (teste) | `montarCartao(ctx) → string[]` (≤ 40) · `inferirPbi(branch, cfg) → { pbi, n } \| null` · `coletar(root, pluginRoot, opts) → ctx` | sempre 0 |

`Medidas` = `{ cores, load1, memDisponivelMB, discoLivreGB, pesados, plataforma }`. Overrides de teste por env: `GABARITO_CAP_CORES`, `GABARITO_CAP_LOAD1`, `GABARITO_CAP_MEM_MB`, `GABARITO_CAP_DISCO_GB`, `GABARITO_CAP_PESADOS`; override de sessão: `GABARITO_PARALELISMO`. Processo pesado: CPU > 20 % **ou** RSS > 500 MB, excluindo a árvore de processos cujo raiz é `GABARITO_PID_RAIZ` (default: `process.ppid`).

`ctx` do cartão = `{ agora, config, branch, sha, pbi, n, epic, iniciativa, fonteVinculo, emVoo, worktrees, capacidade, doctor: { nivel, declarado, em, fonte }, envelhecidos: [{ pbi, dias }], ledger: { caminho, linhaLerPrimeiro }, versoes: { instalada, plugin }, superpowers: 'presente (c)' | 'ausente (c)' | 'desconhecido' }`.

Cartão — formato fixo (linhas ausentes quando não se aplicam; total ≤ 40):
```
GABARITO · cartão de sessão · <AAAA-MM-DD HH:MM>
Modelo: <politica> · alias <alias> · resolvido <data> (<n> d restantes | VENCIDO — revalide com gabarito-instalar)
Branch: <branch> @ <sha7>
PBI: <ID> · Epic: <ID> · Iniciativa: <ID> (fonte: cache <data> | arquivo | (b) não resolvido — gabarito-instalar --vincular <ID>)
Em voo: <n> PBI · worktrees vivos: <n> · slots: <n> (<motivo curto>)
Doctor: nível <n> medido · declarado <n> (cache <h> h | recalculado agora)
Envelhecidos: <PBI> <n>d, … | —
Ledger: <caminho> — LER PRIMEIRO l.<n> | sem ledger
Harness: instalado <v> · plugin <v> [· rode instalar.sh --atualizar]
Plugins: superpowers <estado> (c)
R21: despache, não implemente. Velocidade nunca compra concorrência.
```
Sem `fluxo.resolvidoEm`: o cartão é **uma linha**: `GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)`.

### Hooks — nomes, eventos, saída

| Hook | Evento / matcher | Lê | Saída |
|---|---|---|---|
| `guard-versioning.sh` | `PreToolUse` · `Bash` | `GABARITO_CMD` **cru** (não usa `gabarito_scan_text`) | `gabarito_deny` (exit 2) ou nada |
| `session-card.sh` | `SessionStart` · `startup\|resume\|clear\|compact` | cwd → raiz | `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<cartão>"}}` |
| `remind-orchestrator.sh` | `UserPromptSubmit` | config | idem com `hookEventName":"UserPromptSubmit"`, só se `lembretePorPrompt: true`; **nunca** exit 2 |

`_common.sh` novo: `gabarito_escape_hatch <ROTULO> <VAR>` (ex.: `gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING`); os dois guards atuais passam a chamar com `GABARITO_ALLOW_DESTRUCTIVE` / `GABARITO_ALLOW_PRODUCTION` mantendo o comportamento medido (aceitam um pelo outro **só entre esses dois**, que é o comportamento atual documentado); `gabarito_repo_root` (git toplevel → cwd); `gabarito_config_get <caminho.jsonpath>` (lê `harness.config.json` via jq/node/python3, vazio se ausente).

Formas de `git commit` que `guard-versioning.sh` cobre (corpus `versionamento.txt`): `-m "x"`, `-m 'x'`, `--message="x"`, `-am "x"`, `-m "a" -m "b"` (valida só o primeiro), `-m "$(cat <<'EOF'\n<linha1>\n…\nEOF\n)"` (valida `<linha1>`), `-F <arquivo>` (lê `<raiz>/<arquivo>` ou caminho absoluto; ausente → fail-open com aviso), `-F -` com heredoc (valida a primeira linha do corpo). Não intercepta: `--amend` sem `-m`, `git commit` sem mensagem, mensagens em branch `main`/`master`.

Formas de criação de branch cobertas: `git checkout -b|-B <n>`, `git switch -c|-C|--create <n>`, `git branch <n>` (sem `-d|-D|-m|-M|--list|-a|-r|-v`), `git worktree add -b|-B <n> <dir>`. Valida `<n>` contra `branchPadrao` **ou** `branchWorktree`. Exemplos que passam: `feat/PBI-12-x`, `chore/bump-deps`, `wt/PBI-12-1`; reprovam: `hotfix/PBI-1`, `chore/PBI-1`, `feat/pbi-12`.

### `instalar.sh` — flags

`instalar.sh [dir] [--atualizar] [--gates-substituir] [--codeowners]`. Sem flag: comportamento 1.0.1 **mais** `.instalado.json` e emenda do `.gitignore`. `--atualizar`: `reference/*` → `<destino>.novo` + `diff --stat`; avisa "R19–R21 agora são do harness; regras de projeto passam a R30+". `--gates-substituir` (exige `--atualizar`): para cada arquivo de `gates/`, compara hash instalado (`.instalado.json`) com o do disco; igual → substitui com `.bak`; diferente → `.novo` e aviso; ausente do `.instalado.json` → trata como editado. Doctor **não** roda ao fim quando `--atualizar` (o usuário ainda vai aplicar os `.novo`).

### Doctor — checagens novas (`id` · nível · evidência)

| id | nível | evidência (found = true quando) |
|---|---|---|
| `fluxo-configurado` | 2 | `harness.config.json` tem `fluxo.resolvidoEm` no formato `AAAA-MM-DD` |
| `iniciativa-resolvida` | 2 | atestado `iniciativa-resolvida` em `attest.json` confirmado e ≤ 180 d |
| `versionamento` | 2 | `versionamento.resolvidoEm` presente **e** `checar(root, { max: 20 })` ok (via import de `versionamento-check.mjs`) |
| `changelog` | 2 | arquivo `versionamento.changelog` existe e contém `## [Unreleased]` ou `## Unreleased` |
| `tag-semver` | 2, opcional | `git tag --list` tem ao menos uma tag casando `versionamento.tag` (sem git: `--`) |
| `agents-tamanho` | 2 | `nucleo ≤ nucleoMaxBytes` **e** `apendice ≤ apendiceMaxBytes` (fixtures: 17.291 passa, 17.292 falta) |
| `paralelismo-calibrado` | 3 | `orquestracao.paralelismo.calibradoEm` ≤ 180 d e `teto ≥ simultaneos ≥ 1` |
| `modelo-resolvido` | **warn** (não entra no nível) | `orquestracao.modelo.resolvidoEm` ≤ `validadeDias`; vencido → linha `warn` |

Saída extra quando alguma checagem nova é FALTA e o nível declarado > alcançado: linha `checagens novas da 1.1.0: rode o onboarding ou declare o nível medido`.

---

## Grafo de dependências e paralelismo

```
T1 ─┐
T2 ─┼─ Fase 1 (independentes entre si; T3 depende de T2 para os nomes das seções)
T3 ─┤
T4 ─┘
T5 ─┬─ T8 ─┬─ T9 ─┐
T6 ─┤      │      ├─ T11 (serial: gates/package.json é contenda)
T7 ─┘      └──────┘
T10 (independente; serial com T11 só por package.json? não — T10 não toca package.json)
T12 ─┬─ T13 ─┐
     ├─ T14 ─┼─ T16 (serial: hooks.json é contenda)
     └─ T15 ─┘
T17 ─┐ (T17 e T18 trocam texto entre si: SERIAL, T17 antes; o executor de T18 lê o que T17 cortou)
T18 ─┤
T19 ─┼─ Fase 4 (T19, T20, T21 paralelos entre si, após T17/T18)
T20 ─┤
T21 ─┘
T22 ─┬─ Fase 5 (paralelos; T24 toca agents/ e commands/, disjunto)
T23 ─┤
T24 ─┘
T25 ─ T26 (serial; T26 é medição manual em repos descartáveis)
```

**Fase N+1 só começa com a fase N integrada e revisada** (rollout da spec: cada fase cita a anterior). Dentro da fase, paralelo só onde o grafo diz **e** os arquivos são disjuntos. `gates/package.json` e `hooks/hooks.json` são contenda: tasks que os tocam rodam por último e sozinhas. Recurso compartilhado: nenhum banco; a suíte roda em `tmpdir` por teste.

**Gate de fase (contagem verificável):**
- Fase 1: 1 backlog + 1 `fluxo.md` com 7 seções + 8 templates + 1 JSON = **11 arquivos**; `grep -c "^## " reference/fluxo.md` = 7.
- Fase 2: 4 scripts novos + doctor com 8 checagens novas + `instalar.sh` com 3 flags; `npm test` verde com **contagem medida e escrita no ledger**; `instalar.test.sh` verde.
- Fase 3: 3 hooks novos + `_common.sh` generalizado; `guards.test.mjs` verde com corpus `versionamento.txt` ≥ 30 entradas (≥ 12 legítimas, ≥ 12 inválidas, ≥ 4 worktree, ≥ 2 hatch).
- Fase 4: `AGENTS.md` núcleo ≤ 17.291 B medido por `tamanhoAgents`; `grep -c "§3.7"` = 0; R19/R20/R21 presentes; `referencia.md` com §3.5 e §10 "Versionamento"; 6 templates tocados.
- Fase 5: 2 SKILL.md + 1 agent + 1 command; conferência manual: design sem `Epic:` → NÃO CONFORME.
- Fase 6: 3 `version` = 1.1.0; `claude plugin validate --strict` passa; README com M14/M15 (NÃO MEDIDO até medir); CI verde.

---

## Tasks (índice — passos detalhados nos planos de fase)

| # | Task | Fase | Requisitos que fecha | Arquivos |
|---|---|---|---|---|
| T1 | `docs/backlog.md` deste repo com os 7 itens de fora de escopo | 1 | rollout 0, R17 | `docs/backlog.md` |
| T2 | `reference/fluxo.md` — 7 seções | 1 | FLX-1, FLX-8 (texto) | `reference/fluxo.md` |
| T3 | `templates/fluxo/*.md` — 8 cards com frontmatter | 1 | FLX-5 | `templates/fluxo/` |
| T4 | `reference/ferramentas-mcp.json` — 7 ferramentas | 1 | ONB-2 | `reference/ferramentas-mcp.json` |
| T5 | `onboarding-config.mjs` + teste | 2 | ONB-7, ONB-5 (settings) | `gates/scripts`, `gates/test` |
| T6 | `capacidade.mjs` + teste | 2 | PAR-1, ONB-6 | idem |
| T7 | `versionamento-check.mjs` + teste | 2 | VER-3 | idem |
| T8 | doctor: 8 checagens, `--cache`, `tamanhoAgents`, fixtures 1.0.1/1.1.0 | 2 | DOC-1, DOC-2, CTX-1, ORQ-5, FLX-2 | `harness-doctor.mjs`, teste |
| T9 | `cartao-sessao.mjs` + teste | 2 | ORQ-3, ORQ-6, FLX-8, PAR-2 (leitura) | idem |
| T10 | `instalar.sh --atualizar/--gates-substituir/--codeowners` + `.instalado.json` + `.gitignore` + `instalar.test.sh` | 2 | TIM-2, DOC-2 (gitignore), TIM-1 (codeowners) | `scripts/` |
| T11 | `gates/package.json` 1.1.0 + `bin` novos + `npm test` cobrindo tudo | 2 | PKG-1 (parcial) | `gates/package.json` |
| T12 | `_common.sh`: `gabarito_escape_hatch <ROTULO> <VAR>`, `gabarito_repo_root`, `gabarito_config_get`; guards atuais adaptados; suíte atual verde | 3 | VER-2 (hatch) | `hooks/_common.sh`, 2 guards |
| T13 | `guard-versioning.sh` + corpus + testes | 3 | VER-2 | `hooks/` |
| T14 | `session-card.sh` + testes | 3 | ORQ-3 | `hooks/` |
| T15 | `remind-orchestrator.sh` + testes | 3 | ORQ-4 | `hooks/` |
| T16 | `hooks.json` com os 3 hooks novos; `claude plugin validate --strict` | 3 | ORQ-3/4, VER-2 | `hooks/hooks.json` |
| T17 | `AGENTS.md`: cortes de CTX-1, R19 §7, R20 §3, R21 §6, tabela de camadas §6, §8 políticas de fluxo, §9 hooks novos, Apêndice (Fluxo · Versionamento · Modelo · Paralelismo · Isolamento · Áreas e donos), "R30+"; núcleo ≤ 17.291 B | 4 | FLX-4, VER-4, ORQ-2, CTX-1, CTX-2, FLX-8 | `reference/AGENTS.md` |
| T18 | `referencia.md`: §3.1 `wt/`, §3.4 reescrito, §3.5 novo, §5/§11/§12 recebem o texto cortado de T17, §10 "Versionamento" | 4 | FLX-7, CTX-2, VER-4 | `reference/referencia.md` |
| T19 | `adocao.md` §4 e §5 | 4 | CTX-3, TIM-1 | `reference/adocao.md` |
| T20 | `prompts.md`: Implementador "Isolamento", Orquestrador "Antes de despachar" | 4 | PAR-2, PAR-4 | `reference/prompts.md` |
| T21 | templates: `attest.json`, `gabarito.yml`, `PULL_REQUEST_TEMPLATE.md`, `CHANGELOG.md`, `backlog.md`, `harness.config.json` `_comment` | 4 | DOC-1, VER-3, ONB-4, PKG-1 | `templates/` |
| T22 | `gabarito-instalar/SKILL.md`: 4 fases, `--vincular`, frontmatter | 5 | ONB-1..6, ONB-8, ORQ-6, FLX-6 | skill |
| T23 | `gabarito-conformidade/SKILL.md`: checklists de card, fio condutor, contenda, `PBI:` único | 5 | CNF-1, FLX-3, PAR-3 | skill |
| T24 | `agents/gabarito-implementador.md` (Isolamento) · `commands/gabarito-doctor.md` (warn) | 5 | PAR-4, ORQ-5 | agents, commands |
| T25 | três `version` 1.1.0 · CHANGELOG 1.1.0 · README (seções novas, M14/M15 NÃO MEDIDO, "cada pessoa instala uma vez") · `ci.yml` do repo roda testes novos | 6 | PKG-1, PKG-2 | raiz |
| T26 | Medição M14/M15 em dois repos descartáveis (com MCP ClickUp · sem MCP); README recebe os números; `claude plugin validate --strict` | 6 | PKG-1, ONB-*, TIM-1, CNF-1 (manual) | README |

---

## Pré-condições de rollout (antes da primeira linha de código)

- [ ] Branch `enabler/GM-1-fluxo` criada a partir de `main` (o hook de versionamento ainda não existe; a partir da Fase 3 ele passa a valer no próprio repo do plugin quando `harness.config.json` local tiver `versionamento` — **este repo não é onboarded**, então o hook fica fail-open aqui; convenção seguida à mão).
- [ ] `docs/ledgers/GM-1.md` criado com o cabeçalho de `referencia.md §2.3`.
- [ ] Executor de cada task recebe: este arquivo (contrato), o plano da fase, a spec por ponteiro (`REQ-ID` + linhas), e a lista fechada de arquivos.
- [ ] Nenhuma task faz `git push`, PR ou merge (R1). Integração e PR são do orquestrador com ok do usuário.

## Emendas (2026-09-24, revisão cruzada)

- #2: grafia canônica de `MOVIMENTO` fixada no contrato ("Ledger"): `MOVIMENTO FL2 <EPIC> <de>→<para> <AAAA-MM-DD>` com `<de>`/`<para>` = chaves de `fluxo.status.FL2` (minúsculas, sem espaço); `lerLedger` tolera o nome de coluna.
- #7 (review final de branch, 2026-09-24): T9 deve tratar `status` sem chave correspondente em `fluxo.status` (ex.: `Backlog`, `Em refinamento` — todo o FL3, que não tem chave mapeada) como "opção, não comprometido", nunca como bloqueio ou erro de configuração.
- #8 (review final de branch, 2026-09-24): `fluxo.vinculoPbiEpic` fixado como objeto `{ "tipo": "campo | relacionamento | frontmatter", "nome": "<nome na ferramenta>" }`, não string solta — `tipo` diz a natureza do vínculo, `nome` diz como ele se chama na ferramenta detectada. Exemplo do contrato de config (linha 128) ajustado.
- Fase 2 (review final de branch, 2026-09-24) → **fase 3 (T14 `session-card.sh`)**: exportar `GABARITO_PID_RAIZ=$PPID` antes de chamar `cartao-sessao.mjs`/`capacidade.mjs` — dentro do node do hook, `process.ppid` é o bash do hook, não o Claude Code; sempre passar `--plugin-root "$CLAUDE_PLUGIN_ROOT"` (o default do script na cópia instalada resolve para `tools/`).
- Fase 2 → **fase 5 (T22)**: ONB-7 com alvo inválido sai 0 e imprime no stdout `[ONB-7] harness.config.json NÃO escrito — JSON inválido (fail-open declarado, G9)`; sucesso é a linha `[ONB-7] … atualizado` — a skill decide pelo stdout (ruling F2-R8). CODEOWNERS: o esqueleto de T10 é uma linha contendo `Áreas e donos (TIM-1) — preenchido pelo onboarding` mais texto; casar por substring.
- Fase 2 → **fase 6 (T25/T26)**: `migrations-guard`, `deploy-order-check`, `quality-ratchet` ainda resolvem a raiz por cwd puro (alinhar ou documentar); `ledger-versionado` do doctor aceita arquivo não versionado como evidência (falso positivo medido); CHANGELOG avisa que repos 1.0.1 em nível 2 caem para 1 até o onboarding; `plugin.json` só sobe para 1.1.0 em T25 (até lá o cartão pede `--atualizar`).
- Fase 2 → **contrato**: `versionamento-check.mjs` sem `versionamento.resolvidoEm` diz `versionamento.resolvidoEm ausente (repo sem onboarding)` em vez de `defaults (secao ausente)` — exceção documentada (não usa defaults nesse caso). Datas gravadas (`calibradoEm`, `em`, cabeçalho do cartão) em fuso local (ruling F2-R10). Upgrade 1.0.x: `gates/.hashes-anteriores` embarcado no plugin com os sha256 da release anterior (ruling F2-R9).

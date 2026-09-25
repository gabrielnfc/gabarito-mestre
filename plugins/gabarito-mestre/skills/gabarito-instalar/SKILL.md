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

## Como ler a saída de `onboarding-config.mjs`

Decida pelo **stdout** (a primeira linha diz o que aconteceu); o stderr só explica. Vale para `--set` (alvo `harness.config.json`) e `--settings` (alvo `.claude/settings.json`):

| stdout | exit | O que fazer |
|---|---|---|
| `[ONB-7] harness.config.json atualizado` + linhas `+`/`~` | 0 | gravou — cole o diff e siga |
| `[ONB-7] harness.config.json sem mudanças` | 0 | nada mudou (valores iguais aos atuais) — siga |
| `[ONB-7] dry-run — <alvo> não foi escrito` + diff | 0 | só mostrou (§4.2); nada gravado |
| `[ONB-7] harness.config.json NÃO escrito — JSON inválido (fail-open declarado, G9)` | 0 | o arquivo **existente** está inválido: **pare**, mostre o stderr ao usuário e não avance até ele consertar o arquivo; depois repita a mesma chamada |
| vazio (stderr: `uso: …`, `[ONB-7] JSON inválido no argumento: …`, `seção desconhecida`, `o patch precisa ser um objeto JSON`) | 1 | o erro é do **seu** JSON ou argumento: mostre o stderr, corrija e repita |

Nunca conte "exit 0" como sucesso sozinho: exit 0 com `NÃO escrito` é falha declarada.

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

Cole a saída do instalador. **Anote** se ela tem a linha `criado   .github/workflows/gabarito.yml` (o arquivo nasceu nesta execução) ou `mantido` — a fase 3 decide por isso se pode ajustar o trunk no workflow. Se nenhuma fase 2–4 for rodar, cole também a do doctor e vá ao **Fechamento**.

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
| 5 | Como o PBI aponta para o Epic: `tipo` (`campo` · `relacionamento` · `frontmatter`) e `nome` na ferramenta | com ferramenta: o vínculo que `hierarquiaSugerida.FL1`/`comoBuscarIniciativa` citam (custom field → `campo`; relation, link ou lista-pai → `relacionamento`), com o nome que a ferramenta mostra; em `arquivos`: `frontmatter` / `epic` (a chave que o cartão de sessão lê em `docs/fluxo/pbis/<PBI>.md`) |
| 6 | **Escrita autorizada na ferramenta?** (ADR-FLX-2) | **não** — só vira `true` com resposta explícita; anote quem e quando |
| 7 | Áreas do repo e dono de cada uma (TIM-1) | uma área: `*` → o usuário |

As **chaves** de `fluxo.status` (`preparado`, `em_execucao`, …) nunca mudam — são o que `MOVIMENTO` e o cartão usam; só os **valores** variam por ferramenta. Em `arquivos`, o valor é o que vai em `status:` no frontmatter de `docs/fluxo/**/*.md`.

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
  "vinculoPbiEpic": { "tipo": "<campo|relacionamento|frontmatter — resposta 5>", "nome": "<nome na ferramenta — resposta 5>" },
  "escrita": false,
  "idPadrao": "<resposta 4>",
  "ledgerDir": "docs/ledgers",
  "envelhecimentoDias": 3,
  "resolvidoEm": "<AAAA-MM-DD de hoje>"
}'
```

`escrita: true` só se a resposta 6 foi sim; nesse caso o Apêndice recebe `escrita autorizada por <quem> em <data>`. Decida pela saída (**Como ler a saída de `onboarding-config.mjs`**): só avance para 2.5 com `atualizado` ou `sem mudanças`; `NÃO escrito` ou exit 1 → pare, mostre o stderr, corrija e repita. Não edite `harness.config.json` à mão.

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

Mostre o bloco, peça ok, aplique com `Edit` preenchendo a **segunda célula** (vazia) da linha existente — o rótulo fica como está (as linhas existem desde a 1.1.0; num `AGENTS.md` 1.0.x, **acrescente** a linha inteira, com o rótulo abaixo, ao fim da tabela — nunca remova nada):

```
| Fluxo: ferramenta · Iniciativa padrão (ID · nome) · escrita autorizada por `____` em `____` (ADR-FLX-2) | ferramenta <x> · MCP <nome ou —> · Iniciativa <ID> "<nome>" (<url ou sem url>) · FL3/FL2/FL1 = <a> / <b> / <c> · vínculo PBI→Epic: <tipo> `<nome>` · escrita: <não autorizada, ou autorizada por <quem> em <data>> · (b): <o que não foi confirmado na ferramenta> · resolvido em <AAAA-MM-DD> |
| Áreas e donos (`.github/CODEOWNERS`) | <área> → <@dono> · <área> → <@dono> (fonte: .github/CODEOWNERS) |
```

Com escrita autorizada, troque também os dois `____` do rótulo da linha Fluxo por quem e data. O Apêndice tem orçamento de **4.096 bytes** (`contexto.apendiceMaxBytes`, doctor `agents-tamanho`): uma linha por item, sem prosa.

## Fase 3 — versionamento (roda se falta `versionamento.resolvidoEm`)

1. Meça o trunk:
   ```bash
   git rev-parse --abbrev-ref origin/HEAD
   ```
   Saída `origin/<trunk>`. Falhou (sem remoto, ou `origin/HEAD` não configurado) → pergunte o trunk por `AskUserQuestion` (default `main`, marcado (b)).
2. Confirme por `AskUserQuestion` o modelo **trunk-based** (D2): `<trunk>` protegida · branch curta por PBI · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag por release · squash-merge com título CC. Opções: `sim` (default) · `não`. Com `não`: **não grave** `versionamento` (o hook R20 fica fail-open), registre a decisão do usuário no Apêndice como (b) e siga para a fase 4.
3. **Trunk ≠ `main`:** o `.github/workflows/gabarito.yml` do template roda `versionamento-check.mjs --base origin/main` e reprovaria toda PR. Localize a linha (`Grep` por `--base origin/main` no arquivo) e mostre a troca de `--base origin/main` por `--base origin/<trunk>`:
   - arquivo **criado pela fase 1 desta mesma execução** (a saída do instalador teve `criado   .github/workflows/gabarito.yml`) → peça ok por `AskUserQuestion` e aplique com `Edit` **só com ok**. Sem ok, ou sessão sem `AskUserQuestion`: não aplique; o item vai para a lista (b).
   - arquivo que **já existia** (saída `mantido`, ou a fase 1 não rodou nesta execução) → **não edite** (R2); avise em uma linha qual linha trocar e em qual arquivo.
4. Mostre o mapa tipo de PBI → prefixo de branch e peça ok: US→`feat` · Bug→`fix` (hotfix é `fix` com PBI de Bug) · Enabler→`enabler` · TechDebt→`debt` · Spike→`spike` · Tarefa→`task`; sem PBI: `chore|docs|ci|build|test/<slug>`; worktree de implementador: `wt/<PBI>-<n>`.
5. Instale **só o que não existe** (ONB-4; nenhum arquivo pré-existente é alterado):
   ```bash
   mkdir -p .github docs
   [ -e .github/PULL_REQUEST_TEMPLATE.md ] || cp "${CLAUDE_PLUGIN_ROOT}/templates/PULL_REQUEST_TEMPLATE.md" .github/PULL_REQUEST_TEMPLATE.md
   [ -e CHANGELOG.md ]                     || cp "${CLAUDE_PLUGIN_ROOT}/templates/CHANGELOG.md" CHANGELOG.md
   [ -e docs/backlog.md ]                  || cp "${CLAUDE_PLUGIN_ROOT}/templates/backlog.md" docs/backlog.md
   ```
   Se o `PULL_REQUEST_TEMPLATE.md` já existia, avise em uma linha quais itens do template do gabarito faltam nele (título `tipo(PBI-n): assunto`, PBI, Epic, requisito, migration compatível, plano de volta, janela, teardown, revisor humano) — **não edite**.
6. Grave:
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
   Se `fluxo.idPadrao` não for `^[A-Z]+-\d+$`, substitua `[A-Z]+-\d+` em `branchPadrao` e `branchWorktree` pelo padrão do usuário (sem âncoras) e mostre o resultado antes de gravar. Decida pela saída (**Como ler a saída de `onboarding-config.mjs`**): `NÃO escrito` ou exit 1 → pare, mostre o stderr e não siga para o passo 7.
7. Apêndice (mostrar, ok, `Edit` na segunda célula da linha existente):
   ```
   | Versionamento: modelo · prefixos de branch · resolvido em (R20) | trunk-based (D2), trunk <trunk> · branch tipo/<PBI>-slug · worktree wt/<PBI>-<n> · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag vX.Y.Z · squash com título CC · resolvido em <AAAA-MM-DD> |
   ```
8. Diga em uma linha: a partir de agora o hook `guard-versioning.sh` (R20) barra branch e commit fora do padrão; escape hatch nominal `GABARITO_ALLOW_VERSIONING="<motivo ≥ 8 caracteres, ≥ 2 palavras>"` — hatches não cruzam.

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
   Cole o diff. Chaves existentes (`permissions`, `env`, `hooks`…) ficam **byte a byte** — o script emenda chave a chave (R2). Saída `.claude/settings.json NÃO escrito — JSON inválido` → o settings do usuário está inválido: pare e mostre o stderr, como na tabela de saída.
2. Pergunte, **separadamente**, por `AskUserQuestion`:
   - (i) gravar `model: <alias>` para o **time inteiro**? (settings de projeto > user: afeta o custo de todos que clonam) — `sim` / `não`.
   - (ii) registrar o marketplace do gabarito e habilitar o plugin (`enabledPlugins` + `extraKnownMarketplaces`)? Isto liga **hooks PreToolUse de terceiro** para quem clonar — é o ponto de consentimento. `sim` / `não`.
3. Grave **só o confirmado**, em uma chamada, sem `--dry-run`, com o JSON reduzido ao que recebeu `sim`; sucesso é `[ONB-7] .claude/settings.json atualizado` (ou `sem mudanças`). Nenhum `sim` → não grave nada e diga por quê. **Sessão sem `AskUserQuestion`: (i) e (ii) valem `não`** — consentimento não tem default `sim`; o diff fica na saída e o item vai para a lista (b).
4. Diga em uma linha: **cada pessoa instala o plugin uma vez** (`claude plugin install gabarito-mestre@gabarito-mestre`); `enabledPlugins` só o habilita para quem já instalou (M3).

### 4.3 Máquina e paralelismo

1. Calibre:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs" --root . --calibrar --json
   ```
   A saída traz `simultaneos`, `teto`, `limites` e `calibradoEm`. Fórmula (contrato): `simultaneos = clamp(floor(cores/4), 1, 3)`; `teto = clamp(floor(cores/2), 2, 8)`. Para mostrar cores, load, memória disponível e disco, rode também `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs" --root . --json` (objeto `medidas`: `cores`, `load1`, `memDisponivelMB`, `discoLivreGB`) e mostre-os junto dos valores sugeridos.
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
   Se o projeto usa outra porta base ou outro prefixo de schema/namespace, pergunte e ajuste `isolamentoWorktree` antes de gravar. `lembretePorPrompt` fica `false` (default); diga que `true` liga uma linha "R21: despache, não implemente" a cada prompt. Decida pela saída (**Como ler a saída de `onboarding-config.mjs`**): `NÃO escrito` ou exit 1 → pare, mostre o stderr e não siga para o passo 5.
5. Apêndice (mostrar, ok, `Edit` na segunda célula de cada linha existente):
   ```
   | Modelo do orquestrador: política · alias · resolvido em (validade 90 d) | política mais-potente · alias <alias> · resolvido em <AAAA-MM-DD> (b — fonte: /model do usuário) · validade 90 d |
   | Paralelismo: simultaneos · teto · calibrado em | simultaneos <n> · teto <n> · calibrado em <AAAA-MM-DD> (<cores> cores) |
   | Arquivos de contenda (serial, sem override) | <lista confirmada> |
   | Isolamento de worktree: porta · schema · namespace por `n` | porta 3000+n · schema wt_{n} · namespace wt-{n} (n = índice de wt/<PBI>-<n>) |
   ```

## Fechamento (toda execução termina aqui)

1. **Lista "o que ficou (b)"** — uma linha por item: Iniciativa não confirmada na ferramenta · status não lidos da ferramenta · alias do modelo (sempre (b)) · trunk não medido, ou `gabarito.yml` ainda com `--base origin/main` num trunk ≠ `main` · respostas por default em sessão sem `AskUserQuestion` · qualquer arquivo pré-existente que impediu instalação (PR template, CHANGELOG, CODEOWNERS).
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
   - **Com MCP** (`fluxo.mcp` ≠ null): a linha de ok da §2.2 (uma vez por sessão), depois busque o card pelo ID conforme `comoBuscarIniciativa` da entrada de `ferramentas-mcp.json` cujo `padraoServidor` casa `fluxo.mcp` (mesma busca, agora pelo ID do PBI); leia `titulo`, o Epic pelo vínculo `fluxo.vinculoPbiEpic` (o `campo` ou `relacionamento` chamado `vinculoPbiEpic.nome`), e a Iniciativa do Epic (ausente → `fluxo.iniciativa.id`, marcado (b)). Card não encontrado: **I4** — não grave; pergunte o ID de novo.
   - **`arquivos`**: `Read docs/fluxo/pbis/<PBI>.md`; o Epic é a chave `vinculoPbiEpic.nome` do frontmatter (default `epic:`); `iniciativa:` do `docs/fluxo/epics/<epic>.md` (ausente → `fluxo.iniciativa.id`). Arquivo ausente: não grave; ofereça criar de `${CLAUDE_PLUGIN_ROOT}/templates/fluxo/<tipo>.md` e vincular depois.
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
- Tratar exit 0 de `onboarding-config.mjs` como sucesso sem ler o stdout (`NÃO escrito` é falha declarada).
- Escrever na ferramenta de planejamento sem `fluxo.escrita: true` (ADR-FLX-2). `--vincular` **nunca** escreve.
- Chamar qualquer `mcp__*` antes do ok em uma linha (§2.2), ou pôr `mcp__*` no `allowed-tools`.
- Gravar URL com token, ou qualquer segredo, em config, cache, ledger ou Apêndice.
- Inventar resposta em sessão sem `AskUserQuestion` — default marcado (b), sempre.
- Commitar (R1). Mostre o `git status` e pare.

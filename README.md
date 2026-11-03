# Gabarito Mestre

[![ci](https://github.com/gabrielnfc/gabarito-mestre/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielnfc/gabarito-mestre/actions/workflows/ci.yml) [![release](https://img.shields.io/github/v/release/gabrielnfc/gabarito-mestre?label=release)](https://github.com/gabrielnfc/gabarito-mestre/releases) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Gabarito mestre** é o molde de referência da manufatura — aquele contra o qual todos os outros são conferidos. É o que este plugin de Claude Code faz: **pede confirmação onde o estrago não volta** — segredo, integridade do harness e escrita em produção — e registra o resto (guarda) e **confere o que é produzido** (skills de conformidade, review adversarial e spike), enquanto o **doctor** mede — e reprova quando mente — o nível real de adoção do harness.

Derivado de prática medida, não de boa-prática genérica: cada regra e cada gate existe por causa de um incidente real, e o incidente está escrito ao lado da regra (`plugins/gabarito-mestre/reference/AGENTS.md`).

Os números de peso morto foram **medidos em 2026-09-05** na 1.0.1 (Claude Code 2.1.261, Node 24.14.1, macOS). Os hooks `guard-destructive.sh` e `guard-production.sh`, que essas medições descreviam, **foram removidos na 2.0**: a guarda é um hook só (seção **Guarda de ambiente**), com medição própria e datada. A tabela de peso morto **não foi remedida**, e para o que a 1.1.0 e a 2.0 acrescentaram ela é **NÃO MEDIDO**. Os números da 1.1.0 estão na seção **Medições da 1.1.0**, cada um com a própria data. Onde não foi possível medir, está escrito **NÃO MEDIDO**.

---

## Instalação

```
/plugin marketplace add gabrielnfc/gabarito-mestre
/plugin install gabarito-mestre@gabarito-mestre
```

Ou pela linha de comando:

```bash
claude plugin marketplace add gabrielnfc/gabarito-mestre
claude plugin install gabarito-mestre@gabarito-mestre
```

**Repo privado funciona** desde que `git clone` funcione com as credenciais locais (o marketplace é clonado via git). **Node ≥ 22.18** para os gates (type stripping ligado por padrão; abaixo disso, `--experimental-strip-types` ou copie os dois `.ts` para o seu `src/`).

**Atualização só chega quando o campo `version` de `plugin.json` muda.** Editar o conteúdo sem subir a versão não atualiza ninguém. Auto-update está desligado por padrão em marketplaces não-Anthropic: `claude plugin update gabarito-mestre` ou ligue em `/plugin`.

**Num time, cada pessoa instala o plugin uma vez**, na própria máquina — o `.claude/settings.json` do projeto habilita, mas não instala (seção **Onboarding**).

### Plugins vizinhos — o que instalar à mão

| Plugin | Papel | Instala sozinho? (M11, medido) |
|---|---|---|
| **superpowers** `superpowers@claude-plugins-official` | **sempre** — CONDUZ o processo (brainstorm, plano, TDD, subagentes) | **Sim, se** o marketplace `claude-plugins-official` já estiver registrado: `✔ Successfully installed plugin: gabarito-mestre@gabarito-mestre (scope: user) (+ 1 dependency: superpowers)`. **Não, se** não estiver: o plugin instala mas **falha ao carregar**, com erro explícito (não silencioso): `Dependency "superpowers@claude-plugins-official" is not installed — run claude plugin install superpowers@claude-plugins-official, or check that its marketplace is added`. Conserto: `claude plugin marketplace add anthropics/claude-plugins-official` e reinstale. |
| **ui-ux-pro-max** | **condicional** — DESENHA quando a tarefa é de UI/UX | **Não declarado como dependência.** Na máquina de origem ele existe como skill avulsa em `~/.claude/skills/ui-ux-pro-max/` (44 KB de SKILL.md), **não** como plugin de nenhum marketplace registrado, e não foi possível confirmar um identificador `plugin@marketplace`. Instale por conta própria; as skills do gabarito degradam com aviso se ele faltar. |

Divisão de trabalho (escrita em `reference/AGENTS.md §9` e no corpo de cada skill):

```
superpowers      CONDUZ   como o trabalho é dividido, despachado e executado
ui ux pro max    DESENHA  layout, interação, acessibilidade, texto de interface
gabarito-mestre  MANDA    o que não se negocia, e o formato do que sai
```

Em conflito, **o gabarito vence** (item 1 da ordem de autoridade). As skills do gabarito **não refazem** o que superpowers faz: delegam, conferem, emendam. Plugin vizinho ausente **não** pula a etapa — a skill degrada para o modo próprio e avisa em uma linha (G9).

**Fronteira com UI/UX:** ui-ux-pro-max manda na forma visual e na interação; o gabarito continua mandando no que é regra dentro da tela — **o servidor é a fronteira (R9), erro em três camadas (`referencia.md §8`), tenant absoluto (R10)**.

**Composição medida (M12):** numa sessão headless com os dois plugins ativos, pedido de plano de implementação → `superpowers:brainstorming` → `superpowers:writing-plans` conduziram; `gabarito-conformidade` conferiu depois (6 faltas na 1ª passada: STATUS, alternativa rejeitada em D1/D3/D4/D6, mutação nomeada em REQ-2/REQ-4, emenda datada, ponteiros arquivo:linha), emendou, reconferiu CONFORME. Sem duplicação de régua. O hook R2 barrou um `rm -rf` de diretório temporário no meio da conferência e a sessão respeitou.

---

## O que vem no pacote

```
plugins/gabarito-mestre/
  skills/    gabarito-instalar (4 fases + --vincular) · gabarito-conformidade (anatomia + cards + fio condutor) · gabarito-review · gabarito-spike
  agents/    gabarito-implementador (com Isolamento) · gabarito-revisor · gabarito-spike
  commands/  /gabarito-doctor
  hooks/     hooks.json: guarda de ambiente (R2/R3, `gates/dist/guarda.js`, 3 matchers) · session-card.sh (cartão de sessão) · remind-orchestrator.sh (R21, opcional); R20 é hook git, instalado por instalar.sh
  reference/ AGENTS.md + referencia.md · gates.md · adocao.md · prompts.md · fluxo.md · ferramentas-mcp.json
  gates/     7 gates + 4 scripts de fluxo (onboarding-config · capacidade · versionamento-check · cartao-sessao), 268 testes, zero dependências
  templates/ harness.config.json · attest.json · CLAUDE.md · gabarito.yml (CI) · PULL_REQUEST_TEMPLATE.md · CHANGELOG.md · backlog.md · fluxo/ (8 cards)
  scripts/   instalar.sh (--atualizar · --guarda · --codeowners) · test/instalar.test.sh
```

Depois de instalar o plugin, **instale o harness no seu repositório**: diga "instala o gabarito" (skill `gabarito-instalar`) ou rode `bash <plugin-root>/scripts/instalar.sh .`. A fase 1 cria `AGENTS.md`, `CLAUDE.md` (só a linha `@AGENTS.md`), `docs/harness/` (com `fluxo.md`), `tools/gabarito-gates/`, `harness.config.json`, `.harness/attest.json`, `.github/workflows/gabarito.yml` e emenda o `.gitignore`; nunca sobrescreve nem apaga. As fases 2–4 (só pela skill) fazem o onboarding do fluxo, do versionamento e da orquestração. **O nível de adoção fica `____`** — é o doctor quem mede (`/gabarito-doctor`).

---

## Fluxo (Workflow TRUE)

A 1.1.0 põe o harness sob o **Workflow TRUE** — Flight Levels com Kanban: **FL3 Iniciativa** (propósito, horizonte, patrocinador) → **FL2 Epic** (narrativa, RN, CA, lista de PBIs; **um design por Epic**) → **FL1 PBI** (concluível em poucos dias; **um plano, uma branch, uma PR, um ledger por PBI** — ADR-FLX-1). Oito tipos de card: Iniciativa, Epic, US, Enabler, TechDebt, Tarefa, Spike, Bug — templates em `templates/fluxo/`. A fonte normativa versionada é `reference/fluxo.md` (instalado em `docs/harness/fluxo.md`, sete seções: níveis · tipos de card · políticas · movimento · propagação · compromisso/WIP/vazão · métricas), e é ela que a conformidade cita — não o HTML de origem.

Três regras novas no `AGENTS.md`, todas com gate:

| Regra | Uma linha | Gate |
|---|---|---|
| **R19 — fio condutor obrigatório** (§7) | nenhum PBI sem Epic ativo, nenhum Epic sem Iniciativa ativa; card sem vínculo é desalinhamento, não exceção; métricas medem item, nunca pessoa | `gabarito-conformidade` (design: `Iniciativa:`/`Epic:` + PBIs; plano: `PBI:` único + `Epic:` + tipo por task) · cartão de sessão (`PBI: (b) não resolvido` quando falta) |
| **R20 — versionamento é gate, não convenção** (§3) | trunk-based · branch por PBI · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag por release · squash com título CC | hooks git `commit-msg` e `pre-push` · `versionamento-check.mjs` (CI e doctor) |
| **R21 — orquestrador despacha, não implementa** (§6) | toda implementação, spike, review e exploração pesada roda em subagente; **velocidade nunca compra concorrência** — arquivo disjunto, contenda e recurso compartilhado serial não têm override | cartão de sessão · `remind-orchestrator.sh` (opcional) · conformidade (contenda) |

Regras de projeto no Apêndice passam de `R19+` a **`R30+`** — `instalar.sh --atualizar` avisa a renumeração.

**Bloqueio é marcação, não coluna**: qualquer impedimento vira `BLOQUEADA <data> <motivo> — dono: <quem>` no ledger, e o item não muda de coluna. PBI sem movimento há mais de `fluxo.envelhecimentoDias` (default 3) aparece no cartão de sessão como **envelhecido — pauta do nível acima**. Ao integrar o primeiro commit de um PBI, o orquestrador registra `MOVIMENTO FL2 <EPIC> preparado→em_execucao <data>` no ledger (`<de>`/`<para>` são as chaves de `fluxo.status.FL2`, sem espaços) e grava `.harness/fluxo-cache.json`; escreve na ferramenta de planejamento **só** se o onboarding autorizou (`fluxo.escrita: true`, ADR-FLX-2) — senão avisa em uma linha que o movimento ficou pendente lá.

**Sem ferramenta de planejamento** (`ferramenta: arquivos`): Iniciativa, Epics e PBIs vivem em `docs/fluxo/` (`iniciativa.md`, `epics/`, `pbis/`) com os mesmos templates, frontmatter `id · tipo · status` mais o vínculo para cima: `epic:` no PBI (`pbis/<ID>.md`) e `iniciativa:` no Epic (`epics/<ID>.md`) — o cartão de sessão resolve a Iniciativa do PBI lendo o Epic, e só cai em `fluxo.iniciativa.id` se o Epic não a declarar. Os valores de `status:` são os **nomes de coluna** de `fluxo.md §4` (`Preparado`, `Em execução`, …), não as chaves; `docs/fluxo/` entra em `arquivosDeContenda` por default. `docs/backlog.md` continua sendo o backlog do harness (R17).

---

## Onboarding

`gabarito-instalar` tem **quatro fases**; cada uma das fases 2–4 roda quando o seu `resolvidoEm` falta em `harness.config.json` (`fluxo.resolvidoEm` · `versionamento.resolvidoEm` · `orquestracao.modelo.resolvidoEm`) ou quando você pede "refazer onboarding". Onboarding interrompido retoma da fase que falta; repo com os três preenchidos roda só a fase 1 e diz "onboarding já feito em <data>".

| Fase | O que faz | Grava |
|---|---|---|
| **1 — instalação** | `instalar.sh` (determinístico; nunca sobrescreve) e, se o harness já existe em versão anterior, `--atualizar` | arquivos da tabela acima, `.gitignore` |
| **2 — fluxo** | lista os servidores MCP da sessão (`mcp__<servidor>__*` + `claude mcp list`), cruza com `reference/ferramentas-mcp.json`, avisa em uma linha **quantos servidores MCP** estão conectados e o custo de contexto (`adocao.md §4`); pede ok em uma linha antes de **ler** a Iniciativa na ferramenta (existe ≠ ativa — confirma status; busca vazia não é prova); perguntas fechadas (`AskUserQuestion`): hierarquia FL3/FL2/FL1, nomes de status, formato de ID, campo PBI→Epic, **escrita autorizada? (default não)**, áreas e donos; sem ferramenta, cria `docs/fluxo/` | `fluxo` (via `onboarding-config.mjs`), `.github/CODEOWNERS` (se ausente), Apêndice "Fluxo" e "Áreas e donos" |
| **3 — versionamento** | confirma trunk-based e o mapa tipo de PBI → prefixo (US→`feat`, Bug→`fix`, Enabler→`enabler`, TechDebt→`debt`, Spike→`spike`, Tarefa→`task`; sem PBI: `chore|docs|ci|build|test/<slug>`; worktree `wt/<PBI>-<n>`); instala **se ausentes** `.github/PULL_REQUEST_TEMPLATE.md` (título `tipo(PBI-n): assunto` — é o que vira commit de squash —, PBI, Epic, requisito, migration compatível, plano de volta, janela, teardown, revisor humano), `CHANGELOG.md` (Keep a Changelog, `Unreleased`) e `docs/backlog.md` | `versionamento`, Apêndice "Versionamento" |
| **4 — orquestração** | pergunta **qual família de modelo é a mais potente hoje na sua conta** (fonte: `/model` na UI — não há API para enumerar; a resposta é **(b)** do usuário, gravada com data e validade de 90 dias); mostra o **diff** de `.claude/settings.json` e pede **dois oks separados**: `model` para o time inteiro (afeta custo de todos) e `enabledPlugins` + `extraKnownMarketplaces` do gabarito (liga hooks PreToolUse de terceiro para quem clonar — ponto de consentimento); calibra a máquina (`capacidade.mjs --sugerir`) e confirma `simultaneos`, `teto` e `arquivosDeContenda` (lockfile, `prisma/`, `src/index.ts`, `docs/fluxo/`) | `orquestracao`, `.claude/settings.json` (só o confirmado; chaves existentes intactas), Apêndice "Modelo", "Paralelismo", "Isolamento" |

Termina com o doctor e a lista **"o que ficou (b)"**. Sessão sem `AskUserQuestion` (headless): defaults marcados (b), consentimento de `settings.json` vale **não**.

**Cada pessoa instala o plugin uma vez.** `enabledPlugins` e `extraKnownMarketplaces` no `.claude/settings.json` do projeto deixam o plugin habilitado para quem clona, mas **não instalam nada**: cada pessoa roda `claude plugin install gabarito-mestre@gabarito-mestre` na própria máquina (M3, medido em `settings-example` da doc oficial). Tools MCP **não** entram no `allowed-tools` da skill — pedem permissão por chamada, de propósito (R3).

**`--vincular <PBI>`**: ao abrir a branch de um PBI, "gabarito-instalar --vincular PBI-123" lê o card (na ferramenta, só com ok, ou em `docs/fluxo/pbis/PBI-123.md`), grava `.harness/fluxo-cache.json` (`{ "PBI-123": { "epic", "iniciativa", "titulo", "em" } }`, gitignored — a única fonte offline de PBI→Epic para os hooks) e registra uma linha no ledger. **Nunca escreve na ferramenta**, mesmo com escrita autorizada.

---

## Versionamento

Trunk-based (D2): `main` protegida, branch curta por PBI, Conventional Commits com escopo do PBI, SemVer, CHANGELOG na PR, tag por release, squash-merge com título CC. O que a máquina lembra:

- **Hooks git `commit-msg` e `pre-push`** (instalados por `instalar.sh`, que anexa entre marcadores e encadeia em `.husky/` ou `core.hooksPath`): chamam `versionamento-check.mjs --msg|--branch` e recusam mensagem fora de `tipo(escopo): assunto` e branch fora do padrão. O `PreToolUse` de versionamento deixou de existir. **Limite declarado:** `--no-verify`, `HUSKY=0` e `-c core.hooksPath=` contornam o hook local; o backstop é o job `versionamento` do CI. Não existe variável de escape.
- **`versionamento-check.mjs`** (`--base origin/main --branch "$GITHUB_HEAD_REF"`): valida commits de `base..HEAD` **ignorando merge commits** (2 pais) e o nome da branch; no `gabarito.yml` com `fetch-depth: 0`; no doctor, checagem `versionamento` sobre os últimos 20 commits de primeiro pai. O título CC no squash é **atestado** (`squash-titulo-pr` em `attest.json`) — nenhuma varredura prova a configuração do ruleset. **Limite declarado (VER-3, b):** o doctor confere o first-parent de `HEAD` — a branch em que roda —, não `main` mais a branch atual; commits trazidos por merge de outras branches não são inspecionados.
- **Fail-open declarado (G9):** sem `versionamento.resolvidoEm`, o hook git avisa em stderr e deixa passar — repo sem onboarding não é travado. Raiz do repo via `git rev-parse --show-toplevel`: sessão aberta em subpasta de monorepo funciona.

Detalhe da regra em `referencia.md §10` ("Versionamento"); a política de prefixos deriva de `tiposComEscopoDePbi` + `tiposLivres` — uma lista, não duas.

---

## Orquestração e modelo

**R21** vale para o orquestrador humano-com-agente e para a sessão: implementação, spike, review e exploração pesada rodam em **subagente com contexto próprio**; a exceção continua sendo a mudança de uma linha. O modelo do orquestrador é o resolvido em `orquestracao.modelo`; subagentes herdam (`model: inherit`).

**Modelo por alias de família, nunca por ID** (ADR-ORQ-1, D5): a config guarda `{ politica: "mais-potente", alias, resolvidoEm, validadeDias: 90 }`. Nenhum ID é pinado — IDs envelhecem em silêncio; a resolução vence em 90 dias (alinhado ao autodiagnóstico trimestral de `adocao.md §6`) e, vencida, o **cartão de sessão** diz `VENCIDO — revalide com gabarito-instalar` e o doctor emite `warn modelo-resolvido` — **aviso**: não derruba nível, não quebra CI. Se você fixar um ID por decisão registrada (custo, por exemplo), ele vence junto com a resolução (cláusula de morte do ADR).

**Cartão de sessão** (`session-card.sh` · SessionStart `startup|resume|clear|compact` · `timeout 30`): `cartao-sessao.mjs` injeta como `additionalContext` o cartão (até 40 linhas) mais o instantâneo do diário, **≤ 6.000 caracteres no total**, e uma `systemMessage` de até 3 linhas; grava `sessao.inicio`, `guarda.heartbeat` e o marcador local `.harness/heartbeat.json` (só em repo com onboarding) — — modelo e dias restantes · branch e sha · PBI inferido da branch (`idPadrao`, case-sensitive; `wt/<PBI>-<n>` vira PBI + índice; `main` e `chore/x` viram `(b) não inferido`) · Epic e Iniciativa do `fluxo-cache.json` ou do frontmatter em `docs/fluxo/pbis/` (ausente: `(b) não resolvido — gabarito-instalar --vincular <PBI>`) · PBIs em voo e worktrees vivos · `slots` de `capacidade.mjs` · nível do doctor em cache (`.harness/doctor-cache.json`, 24 h) · envelhecidos · ponteiro para "LER PRIMEIRO" do ledger · versão instalada × versão do plugin (`rode instalar.sh --atualizar` quando diferem) · superpowers presente/ausente **(c)** (lido de `~/.claude/plugins/installed_plugins.json`) · a linha `R21: despache, não implemente. Velocidade nunca compra concorrência.` Sem `fluxo.resolvidoEm`, o cartão é **uma linha**: `GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)`.

**Lembrete por prompt** (`remind-orchestrator.sh` · UserPromptSubmit · `timeout 5`): só com `lembretePorPrompt: true` (default `false`); injeta uma linha (`R21: despache, não implemente · slots: n`) e **nunca** bloqueia (exit 2 está fora — bloqueio inline é item do backlog com gatilho "R21 violada 3× no piloto").

**Escalada** (PAR-5): task reprovada `rodadasAntesDeEscalar` vezes (default 2) vira `BLOQUEADA` no ledger e o orquestrador **pergunta ao usuário** com o custo estimado das opções, em vez de tentar de novo.

---

## Paralelismo medido

**Subagente não roda na máquina; o que pesa é o que ele executa** (ADR-PAR-1): suíte, build, dev server, banco. O limite é por processos pesados simultâneos, **medidos antes de cada dispatch** — não por número de agentes.

`capacidade.mjs` mede cores, load de 1 min, **memória disponível** (macOS: `vm_stat` free + inactive + speculative; Linux: `/proc/meminfo MemAvailable`), disco livre no cwd e processos pesados vivos (CPU > 20 % **ou** RSS > 500 MB, **excluindo a árvore do Claude Code** — PID pai do hook e descendentes). Devolve `{ slots, motivo, medidas }` com `slots = min(simultaneos, teto, permitido pelos limites)`, nunca < 1. `GABARITO_PARALELISMO=<n>` substitui `simultaneos` na sessão, ainda ≤ `teto`. `--sugerir` sugere `simultaneos = clamp(floor(cores/4), 1, 3)` e `teto = clamp(floor(cores/2), 2, 8)` — 8 cores → 2/4; 2 cores → 1/2 — e o onboarding grava com `calibradoEm` (doctor `paralelismo-calibrado`, nível 3, 180 dias).

Vocabulário fixo (ORQ-1): **`simultaneos`** = implementadores rodando ao mesmo tempo (máquina) · **PBIs em voo** = WIP FL1 (Kanban) · **worktrees vivos** = medição. Nunca "WIP" sozinho na config.

**Contenda nunca é override** (R21, D7): task que toca qualquer caminho de `arquivosDeContenda` (default: lockfile detectado, `prisma/`, `src/index.ts`, `docs/fluxo/`) é `serial: contenda` no plano; `gabarito-conformidade` reprova grafo que paraleliza duas tasks com contenda. O orquestrador registra `DISPATCH Task <N> slots=<n> worktree wt/<PBI>-<n>` no ledger a cada dispatch (`prompts.md`, "Antes de despachar") — fixture sem linha `slots=` gera o aviso "dispatch sem medição".

**Isolamento por worktree** (PAR-4): cada implementador recebe `isolamentoWorktree` resolvido para o índice `n` do seu `wt/<PBI>-<n>` — `porta 3000+n · schema wt_{n} · namespace wt-{n}` — no bloco `Isolamento: porta X · schema Y · namespace Z — não use outro` do prompt (`n=2` → `porta 3002 · schema wt_2 · namespace wt-2`).

---

## Contexto em camadas

`AGENTS.md` é carregado em **toda** sessão (`@AGENTS.md`). Na 1.0.1 ele tinha 18.010 bytes com Apêndice vazio (M1). A 1.1.0 fixa o **teto do núcleo** (bytes antes de `## Apêndice`) em **17.291** e dá ao Apêndice orçamento próprio de **4.096** (`contexto.nucleoMaxBytes` / `contexto.apendiceMaxBytes`; doctor `agents-tamanho`, nível 2; CRLF conta bytes reais; o corte é no primeiro cabeçalho que **começa** com `## Apêndice`). Para caber, texto migrou do núcleo para a referência — regra nenhuma sumiu (ADR-CTX-1; "nada removido" vale para regra, não para bytes). O teto só sobe por decisão registrada com medição de impacto.

| Camada | O quê | Custo |
|---|---|---|
| 0 | núcleo do `AGENTS.md` | sempre, ≤ 17.291 B |
| 1 | cartão de sessão | cartão ≤ 40 linhas + instantâneo do diário, ≤ 6.000 caracteres por SessionStart |
| 2 | referência por ponteiro (`docs/harness/*.md`, `fluxo.md`) | sob demanda, nunca importada |
| 3 | subagente com contexto isolado, relatório ≤ 25 linhas | por dispatch |
| — | handoff por ledger (`LER PRIMEIRO`) | entre sessões |

Regra de `referencia.md §3.5`: **o orquestrador não lê saída bruta que um subagente possa resumir.** E o onboarding avisa quantos servidores MCP estão conectados — cada um custa contexto em toda sessão; `adocao.md §4` ("MCP demais no contexto") recomenda escopo de projeto (`.mcp.json`) só com o necessário.

---

## Atualizar de 1.0.x

Repos 1.0.1 **não mudam** até você rodar:

```bash
bash <plugin-root>/scripts/instalar.sh . --atualizar   # reference/ e tools/gabarito-gates/ → <arquivo>.novo + diff --stat; nada sobrescrito
```

- `--atualizar`: para `AGENTS.md`, `docs/harness/*.md` e os gates de `tools/gabarito-gates/` já existentes que diferem do plugin, grava `<nome>.novo` e imprime `diff --stat` — você aplica o que quiser à mão (R2). Avisa: "R19–R21 agora são do harness (fluxo · versionamento · orquestração); regras de projeto passam a R30+ — renumere no Apêndice ao aplicar o AGENTS.md.novo." O doctor **não** roda ao fim (você ainda vai aplicar os `.novo`).
- Não existe mais `--gates-substituir` nem manifesto `.instalado.json` (2.0): nada em `tools/gabarito-gates/` é trocado pelo instalador. O `.instalado.json` que a 1.1.x deixou fica onde está, sem uso.
- `.gitignore` recebe, sem duplicar e sem remover, `.harness/doctor-cache.json`, `.harness/fluxo-cache.json`, `.harness/entregas/_sem-id/`, `.harness/heartbeat.json`, `*.novo`, `*.bak`.
- Depois: `gabarito-instalar` faz o onboarding (fases 2–4). Até lá o doctor num repo nível 2 ou 3 **cai para 1** e diz `checagens novas da 1.1.0: rode o onboarding ou declare o nível medido` — repo em nível 0 ou 1 não muda de nível. Hooks de versionamento, cartão e conformidade ficam **fail-open** até o onboarding.

Nomes da 1.0.1 que continuam existindo (PKG-2, conferido por grep no CI): 4 skills, 3 agents, 1 command, 2 hooks, 7 gates, R1–R18, G1–G9, I1–I12. `plugin.json` continua **sem** chave `hooks`.

---

## Guarda de ambiente — o que pede, o que registra, e os números

Um `PreToolUse` só (`gates/dist/guarda.js`, `timeout 5`) em três matchers — `Bash`, `Edit|Write|Read|Grep` e `mcp__.*` —, mais um `SessionStart` (cartão) e um `UserPromptSubmit` (lembrete, desligado por default). Substitui `guard-destructive.sh` (R2) e `guard-production.sh` (R3), que bloqueavam por regex de comando. O hook classifica o **alvo** (host, banco, projeto, MCP, caminho) contra os ambientes que o repo declara e decide por faixa; sempre sai com exit 0 e nunca devolve `allow`, de modo que o prompt nativo do Claude Code continua valendo.

| Faixa | Quando | O que acontece |
|---|---|---|
| silêncio | `teste` ou alvo desconhecido | nada |
| log | destrutivo em alvo local (`rm -rf .next`, `TRUNCATE` em `127.0.0.1`) | evento no diário, sem mensagem |
| mostrar | `homolog`; leitura ou execução em produção | evento e `systemMessage` de uma linha (`leu PRODUÇÃO · <host> · permitido`) |
| pedir | **segredo** (`.env*`, `*.pem`, `*.key`, `~/.aws`…), **integridade do harness** (`.harness/**`, `harness.config.json`, `.claude/settings*.json`, `.github/workflows/**`, `.git/**`, o próprio plugin) e **escrita em produção** fora de `guarda.producao.permitidos` | `ask` ao orquestrador; `deny` ao subagent (`agent_id` presente) |

A config vem de `refs/remotes/origin/HEAD:harness.config.json`, **nunca da árvore local**: um subagent que reescreve o arquivo não muda o veredito. Sem essa ref, a árvore local vale com `permitidos` vazio, e a guarda avisa uma vez por sessão. Comando Bash acima de 64 KB não é lido inteiro e por isso pede. O diário (`.harness/entregas/<PBI>/events.<sessao>.jsonl`) guarda `ambiente`, `acao` e `alvo`, nunca o comando nem URL com credencial, e só existe em repo com onboarding.

**Sem escape hatch.** Não há variável de ambiente, prefixo de comando nem mensagem que libere: o `ask` é o caminho para o humano autorizar, e `permitidos[]` (lido de `origin/HEAD`, portanto mudado só por merge revisado) é o caminho para a rotina de produção.

### Fail-open declarado (G9)

Payload que não é JSON, sem `tool_input` ou com `command` que não é texto: aviso em stderr, exit 0, sem decisão. `cwd` fora de repositório git: só os anéis de segredo e integridade valem. Diário indisponível (`.harness` somente leitura, `session_id` fora do padrão): a guarda segue e o `systemMessage` avisa; lock preso não atrasa a decisão, que sai antes da gravação. **Exceção da própria guarda depois de ler a chamada (Q21, proposta, aguarda o dono):** o que ela não conseguiu classificar, ela pede, em toda chamada: `ask` ao orquestrador, `deny` ao subagent, com saída constante que não depende do caminho que falhou; custo declarado: um bug na guarda vira `ask` em toda chamada até ser corrigido, ruidoso e visível, nunca silencioso. Envelope ilegível continua fail-open, como acima. `node` ausente é o único caso em que o hook nem sobe (shell devolve 127): pela documentação do Claude Code, saída diferente de 0 e 2 é erro não bloqueante; **não medido aqui**.

### Medido

| Medição | Resultado |
|---|---|
| Latência do hook, 20 execuções em processo novo, comando benigno, config em `origin/HEAD` (`gates/scripts/bench-guarda.mjs`, 2026-11-02, Node 24.14.1, macOS) | p50 33,0 ms · p95 34,4 ms (piso do Node: p95 19,6 ms) · limite local 60 ms, CI 150 ms |
| Corpus da guarda (`hooks/test/corpus/guarda-*.jsonl`) | 220 casos em `gates/test/corpus-guarda.test.ts`; 10 deles ponta a ponta por `dist/guarda.js` em `hooks/test/guarda-corpus-e2e.test.mjs` |

As taxas de falso positivo e negativo da 1.0.1 (7.037 comandos reais) descreviam os hooks por regex e **não valem para a guarda 2.0**; a remedição com transcript real é **NÃO MEDIDO**.

### Limites declarados (o que a guarda NÃO pega)

Não há tokenizador de shell completo. Passam: indireção (`X=rm; $X`, `base64 | sh`, `eval`), script gravado por `Write` e executado no comando seguinte, `xargs`/`timeout`/`exec`/`rsync` como invólucro de comando destrutivo, expansão de chaves (`{.env,x}`) e `SELECT fn_que_escreve()` em MCP. Sob o mesmo usuário de SO a guarda é *tamper-evident*, não *tamper-proof*: a prevenção real é o ruleset do GitHub e o CI. Detalhe em `classificar-alvo.ts` e na spec E1.

---

## Peso morto por tipo de projeto (M9, medido)

**Medido na 1.0.1 (2026-09-05) e não remedido na 1.1.0.** As contagens abaixo são as da 1.0.1: 19 checagens, R1–R18, 2 hooks. A 1.1.0 tem 27 checagens no doctor (`CHECKS.length` em `gates/scripts/harness-doctor.mjs`, contado em 2026-09-25; as 8 novas estão em `NOVAS_1_1_0`), R1–R21 e 5 hooks. Quanto disso é inaplicável num CLI puro: **NÃO MEDIDO**. O nível 1 continua com as mesmas 7 checagens.

Instalado em dois repositórios descartáveis:

**(a) com ORM (Prisma), migrations e fronteira externa** — 5 das 7 checagens de nível 1 passam de imediato ao ligar `massMutationGuard()` + `assertNotProduction()` + teardown por id + `.env` ignorado; faltam só os dois atestados. Tudo se aplica.

**(b) CLI puro — sem banco, sem rede, sem tenant:**

| O que | Inaplicável | Lista |
|---|---|---|
| Checagens do doctor (19, 1 opcional) | **8 / 19** | G3 mutação em massa · G3 undefined estrito · R3 trava de produção · backup verificado · G8 migrations · ordem de subida · health commit+versão · RLS (opcional) |
| Regras do `AGENTS.md` (R1–R18) | **6 / 18** | R6 cliente único · R7 fronteira não mockada · R8 idempotência · R10 tenant · R11 erro cru de terceiro · R12 escrita em ambiente compartilhado |
| Guardas (G1–G9) | **8 / 9** | G1–G8 (só G9 fail-closed sobrevive) |
| Hooks (1.0.1) | **1 / 2 sem uso** | medido com os dois guards bash, removidos na 2.0; a guarda de ambiente, num CLI puro e sem ambientes declarados, só aplica segredo e integridade |

**Consequência que importa:** num CLI puro, **4 das 7 checagens obrigatórias de nível 1 são inaplicáveis** (G3 ×2, R3, backup) — o repo **nunca sai do nível 0 pelo doctor**, por construção, não por falha. Declare no Apêndice o que é inaplicável em vez de fingir; o que vale sem nenhum gate — §1, §4 e a marcação (a)/(b)/(c) — vale igual num CLI. `adocao.md §5` diz quando o harness não serve.

---

## ANTES DE LIGAR OS GATES: MEÇA

Os parâmetros que vêm no pacote foram **calibrados em OUTRO projeto**. Copiar sem medir é herdar a calibragem de outra pessoa:

| Parâmetro | Valor de partida | Onde |
|---|---|---|
| Massa suspeita (G4) | ≥20 % **e** ≥5 registros | `referencia.md §5` |
| Corte temporal da guarda de migrations (G8) | data em que a guarda entrou — sem ele, a primeira PR trava para sempre nas migrations antigas | `migrations-guard.mjs` (constante pinada por teste) |
| Tolerância do ratchet | 0,5 pp | `quality-ratchet.mjs` |
| Teto de duplicação | medição atual + folga pequena | `harness.config.json` |
| Padrão destrutivo de migration | `DROP\|TRUNCATE\|UPDATE\|DELETE`, isentando ação referencial de FK (sem isso: 11 de 36 falsos positivos no projeto de origem) | `migrations-guard.mjs` |

**Como calibrar cada um: `docs/harness/adocao.md §3`.** Toda calibragem entra no Apêndice do `AGENTS.md` com a data da medição. Parâmetro sem data é parâmetro herdado.

**Limites declarados (G9) dos gates, do doctor e do cartão — conhecidos, não corrigidos na 1.1.0 (itens em `docs/backlog.md`):**

- `migrations-guard.mjs`, `deploy-order-check.mjs` e `quality-ratchet.mjs` (1.0.1) resolvem a raiz do repositório pelo **cwd puro** — rode-os **da raiz do repo**; os scripts novos da 1.1.0 usam `git rev-parse --show-toplevel`.
- A checagem `ledger-versionado` do doctor aceita um ledger **não versionado** (fora do git) como evidência — falso positivo medido. O mesmo vale para as outras checagens: o doctor varre o disco, não o índice do git, e aceita arquivo ignorado pelo git como evidência (medido: `pr-template` achou o template de um repo descartável dentro de `.superpowers/`, que é gitignored).
- `cartao-sessao.mjs` lê o vínculo PBI→Epic do frontmatter de `docs/fluxo/pbis/` pelo campo fixo `epic`, não pelo nome configurado em `fluxo.vinculoPbiEpic.nome` — coerente com o que o onboarding grava em `arquivos`; com ferramenta MCP, o vínculo chega pelo cache do `--vincular`.

---

## Medições da 1.1.0

Medidas em repos descartáveis (`mktemp -d`, `git init`, `instalar.sh`, sessão com `--plugin-dir` apontando para este repo), com o transcript guardado fora do repositório. O que ainda não foi medido está escrito.

| # | Medição | Resultado | Quando |
|---|---|---|---|
| M14 | **Onboarding com MCP ClickUp** — sessão interativa: número de servidores MCP avisado; `ferramenta: clickup` proposta e confirmada; ok em uma linha antes de ler; Iniciativa lida com status confirmado (I10); `fluxo` gravado com `escrita: false`; `CODEOWNERS` com as áreas informadas; `.claude/settings.json` pré-existente com `permissions` intacto após gravar `model`; `--vincular <PBI>` grava o cache **sem nenhuma chamada de escrita** no ClickUp (grep do transcript); doctor ao fim. **Mutação (ONB-1):** apagar `versionamento.resolvidoEm` e pedir "instala" → só a fase 3 roda | PARCIAL — método: sessão do orquestrador seguindo o SKILL.md da branch, ClickUp real, só leitura (ruling F6-R9) · provado: 36 criados · 13 servidores MCP conectados avisados · clickup detectado e confirmado · ok pedido antes da leitura · só leitura: 0 chamadas de escrita · I10: status da Iniciativa confirmado · parou quando a estrutura real não seguia Folder/List/Task · não medido: gravação de fluxo com MCP, CODEOWNERS com 2 áreas, settings.json com 2 oks e permissions byte a byte, calibração, --vincular com PBI real, mutação ONB-1 (a M15 cobre parte disso sem ferramenta; `settings.json` com `permissions` intacto e `--vincular` com PBI real **não foram medidos em nenhuma das duas**) · validação completa: primeiro onboarding real de projeto (backlog) · ≈ 18 min | 2026-09-25 |
| M15 | **Onboarding sem MCP (`arquivos`), headless** — `docs/fluxo/` criado com `PBI-EXEMPLO.md` (`epic:` no frontmatter); PR template, `CHANGELOG.md` e `docs/backlog.md` criados só se ausentes; calibração gravada com `calibradoEm`; `settings.json` **não** gravado (sem consentimento); cartão de sessão em branch `feat/PBI-1-…` com `PBI: PBI-1 · Epic: EPIC-1` após `--vincular`, ≤ 40 linhas. **Conformidade:** design sem `Epic:` → AVISO antes do onboarding, FALTA depois; plano com T2 ∥ T3 tocando `prisma/` → "contenda (R21)"; Epic sem lista de PBIs → "Epic: PBIs (fluxo.md §2)". **Mutação de prompt:** retirar do `SKILL.md` a linha "fio condutor" do checklist de design e, em outra execução, a linha "contenda", e conferir se o item correspondente some do veredito | docs/fluxo/ criado (PBI-EXEMPLO.md com epic: "EPIC-EXEMPLO") · PR template, CHANGELOG, backlog criados · calibradoEm 2026-09-25, simultaneos 3, teto 6 · settings.json não gravado · cartão: 11 linhas, "PBI: PBI-1 · Epic: EPIC-1 · Iniciativa: INI-1" (fonte: cache) · conformidade: design sem Epic → AVISO antes / FALTA depois (sim) · contenda (R21) em T2/T3 (sim) · Epic: PBIs (sim) · mutação de prompt: fio condutor sumiu (não — 2 tentativas, 11 turns/US$0,48 e 6 turns/US$0,46; item ancorado em reference/referencia.md:18, não tocado pela mutação prescrita) · contenda sumiu (não — 5 turns/US$0,38; mesma causa, referencia.md:41/96) · mutação ONB-1 headless: só fase 3 rodou (sim, pela prova de config; grep literal "fase 3" no texto = 0) · ≈15 min de parede, US$ 5,34 no total | 2026-09-25 |
| M16 | Contagem de testes: gates (`npm test`) · hooks (`hooks/test/*.test.mjs`) · instalador (`instalar.test.sh`, casos) | medido a cada execução (sem número fixo) | 2026-09-25 |

---

## Verificação do próprio pacote

```bash
claude plugin validate ./plugins/gabarito-mestre --strict   # Validation passed
claude plugin validate . --strict                            # Validation passed (marketplace)
cd plugins/gabarito-mestre/gates && npm test                  # 268 testes (241 mjs + 27 ts) — medido em 2026-09-25
node --test plugins/gabarito-mestre/hooks/test/*.test.mjs                # corpora R2, R3, R20, cartão, lembrete
bash plugins/gabarito-mestre/scripts/test/instalar.test.sh                   # 70 casos: fixture 1.0.1 → --atualizar / --gates-substituir
```

**Testes dos hooks:** `node --test plugins/gabarito-mestre/hooks/test/*.test.mjs` roda os corpora deste README (legítimos, destrutivos, produção, escape hatch) contra os scripts reais — é o que o CI do repositório executa.

**Job `texto` do CI:** invariantes de texto da 1.1.0 conferidas por grep — 7 seções de `fluxo.md` na ordem; R19, R20, R21, "não têm override" e "R30+" no `AGENTS.md` (e `§3.7` = 0); `§3.5` e "Versionamento" em `referencia.md`; "MCP demais" em `adocao.md`; `AskUserQuestion` e nenhum `mcp__` no `allowed-tools` de `gabarito-instalar`; três `version` iguais; nenhum `"hooks"` em `plugin.json`; nenhuma contagem de testes da 1.0.x; lista de nomes da 1.0.1 presente. Cada grep é a mutação nomeada na spec, invertida.

**Por que `plugin.json` não declara `hooks`:** `hooks/hooks.json` é carregado automaticamente; declarar `"hooks": "./hooks/hooks.json"` faz o plugin **falhar ao carregar** com `Duplicate hooks file detected` (medido em 2.1.261). `validate --strict` não pega isso; só `claude plugin list` depois de instalar.

O doctor **não se auto-detecta**: o pacote de gates e a pasta `reference/` são excluídos da varredura em qualquer local de instalação (M10). Antes dessa exclusão, rodar o doctor na raiz deste repositório contava 9 checagens como "ok" a partir dos próprios testes dos gates.

## Contribuir

[`CONTRIBUTING.md`](CONTRIBUTING.md) — o que aceitamos e o checklist de PR · [`SECURITY.md`](SECURITY.md) — bypass de hook é vulnerabilidade · [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) · [`CHANGELOG.md`](CHANGELOG.md).

O achado mais valioso é um **comando legítimo bloqueado**: abra a issue "Hook: falso positivo / negativo" com o comando exato.

## Licença

[MIT](LICENSE).

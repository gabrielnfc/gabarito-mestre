# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento: [SemVer](https://semver.org/lang/pt-BR/).
Usuários do plugin só recebem atualização quando `version` muda.

## [Unreleased]

## [1.1.0] — 2026-09-25

Camada de fluxo (Workflow TRUE: Flight Levels + Kanban), onboarding na instalação, versionamento trunk-based como gate,
orquestração por subagente com paralelismo medido e contexto em camadas. **Aditiva sobre a 1.0.1**: nenhuma regra, gate,
hook, skill ou agente removido (ADR-CTX-1: texto do núcleo do `AGENTS.md` migrou para a referência; regra não sumiu).
Repos 1.0.x não mudam até rodarem `instalar.sh --atualizar`.

> **Aviso:** um repositório já em nível 2 ou 3 com o harness 1.0.1 **cai para nível 1** assim que
> `harness-doctor` 1.1.0 rodar, até o onboarding ser refeito — as checagens novas (fluxo, versionamento,
> changelog, tamanho do `AGENTS.md`) contam para o nível 2. Não é regressão do harness: é o doctor medindo
> em vez de presumir. Rode o onboarding para recuperar o nível.

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
  `PULL_REQUEST_TEMPLATE.md` (fio condutor, banco e deploy, prova, revisor humano), `CHANGELOG.md`, `backlog.md` —
  instalados pelo onboarding só se ausentes; atestado `squash-titulo-pr`.
- **Orquestração** — regra **R21 — orquestrador despacha, não implementa** (`AGENTS.md §6`; velocidade nunca compra
  concorrência); hook `session-card.sh` (SessionStart: cartão ≤ 40 linhas via `cartao-sessao.mjs` — modelo e validade,
  PBI/Epic/Iniciativa, PBIs em voo, slots, doctor em cache, envelhecidos, LER PRIMEIRO, versão instalada × plugin,
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
- **Instalador** — `--atualizar` (`.novo` + `diff --stat`, aviso de que R19–R21 agora são do harness e as regras de
  projeto passam a R30+, com renumeração no Apêndice), `--atualizar --gates-substituir` (ADR-TIM-1: só `tools/gabarito-gates/`, `.bak`, recusa por hash divergente),
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
  **um plano por PBI** — ADR-FLX-1; Ready/Done por altitude); papéis do orquestrador/implementador/revisor; ponteiro
  `§3.7` corrigido para `§3.4`; §8 ganha a revisão das políticas de fluxo.
- **Numeração das regras de projeto (quebra para quem já adotou):** as regras específicas do projeto, no Apêndice do
  `AGENTS.md`, passam de `R19+` a **`R30+`**, porque R19–R21 agora são regras do núcleo. Quem já adotou a 1.0.x e tem
  R19+ no Apêndice precisa renumerar para R30+ e atualizar as referências a elas (`instalar.sh --atualizar` avisa).
- `referencia.md §3.1` (worktree `wt/<PBI>-<n>`) e `§3.4` ("unidade da PR é o PBI"; WIP por nível em `fluxo.md`;
  "Sem sprint, sem timebox, sem WIP formal" removido).
- `adocao.md`: escada de níveis de adoção alinhada ao que o doctor mede de fato; a orientação deixa de assumir uma
  pessoa sênior orquestrando sozinha.
- `hooks/_common.sh`: `gabarito_escape_hatch <ROTULO> <VAR>` (R2 e R3 continuam aceitando uma pela outra — comportamento
  medido da 1.0.1; R20 não cruza), `gabarito_repo_root` (`git rev-parse --show-toplevel`, monorepo em subpasta),
  `gabarito_config_get`.
- `templates/gabarito.yml`: `fetch-depth: 0`, job `versionamento` (Conventional Commits com escopo do PBI e nome de
  branch contra o histórico da PR), nome do job de testes sem número.
- `templates/attest.json`: chaves `iniciativa-resolvida` e `squash-titulo-pr`. `templates/harness.config.json`: só o
  `_comment` (as seções novas nascem no onboarding).
- `gates/package.json`: versão alinhada ao plugin (era `1.0.0`, M12) e `bin` novos.
- `/gabarito-doctor`: explica `warn` (≠ `FALTA` ≠ `--`), a linha "checagens novas da 1.1.0" e `--cache`.
- `gabarito-implementador`: bloco "Isolamento", idêntico ao de `prompts.md`.
- `gabarito-instalar`: `allowed-tools` com `AskUserQuestion`, `Edit`, `Bash(claude mcp list:*)` — nenhum `mcp__*`
  (permissão por chamada, R3).
- `.github/PULL_REQUEST_TEMPLATE.md` deste repositório passa a ser o `templates/PULL_REQUEST_TEMPLATE.md` do plugin.
- README: seções Fluxo, Onboarding, Versionamento, Orquestração e modelo, Paralelismo medido, Contexto em camadas,
  Atualizar de 1.0.x e a tabela "Medições da 1.1.0" (M14/M15); limites declarados novos (hooks de versionamento, raiz
  por cwd em 3 gates da 1.0.1, falso positivo de `ledger-versionado`); contagem de testes medida nesta versão — gates
  268 (241 mjs + 27 ts), hooks 271, instalador 70 casos.

## [1.0.1] — 2026-09-05

Correções do review adversarial independente (2 Critical, 7 Important, 14 Minor).

### Corrigido
- **Hooks — bypass por heredoc sem aspas** (C1): `cat > x <<EOF` + `$(rm -rf …)` passava; agora o corpo só é
  ignorado quando o terminador é citado (`'EOF'`), e linhas com `$(`, crase ou `${` são mantidas.
- **Gates — scripts mudos em caminho com espaço ou acento** (C2): o guard de entrypoint usava `file://` cru e
  `main()` não rodava (exit 0 silencioso). Agora usa `fileURLToPath` + `resolve`.
- **Hooks — falsos negativos** (I1): `{ rm -rf; }`, `then`/`do`, `\rm`, `nohup`, `timeout N`, `bash -c`, `eval`,
  `<<<`, `fs.rmSync(…recursive)`, `shutil.rmtree`, `find -delete|-exec rm`, `rimraf`, `git rm -r`,
  `git reset --hard`, `git worktree remove --force`, `rsync --delete`, `docker rm -f`, `aws s3 rm --recursive`,
  `gsutil rm -r`.
- **Hooks — host com sufixo `-prod` fora de URL** (I2): `psql -h db-prod.example.com`, `prod.internal`.
- **Hooks — menção ≠ acesso** (I3): `grep`, `rg`, `sed`, `echo`, `git log/commit -m` e heredoc de anotação não
  bloqueiam mais; o que vem depois de `|`/`;`/`&&` continua varrido.
- **Escape hatch** (I6): só no início do comando ou no ambiente; motivo ≥ 8 caracteres e ≥ 2 palavras;
  alias `GABARITO_ALLOW_PRODUCTION` para R3.
- JSON do aviso válido com TAB/controles no motivo (M1); stdin vazio/malformado avisa em stderr (M2);
  hooks invocados via `bash "…"` para não depender do bit +x (M3); `instalar.sh` sem `|| true` mascarando o
  doctor, sem `.DS_Store`, com padrão citado (M5); contagem de testes unificada em 77 (I5).

### Alterado
- Pacote de gates renomeado para `gabarito-gates`; exemplos de import em `gates.md` usam caminho relativo (M6).
- Template de CI não liga mais a guarda de migrations por padrão — calibre antes (I7).
- `/gabarito-doctor` prefere a cópia instalada em `tools/gabarito-gates/` (M11).
- `gabarito-review`: `allowed-tools` restrito a `git checkout -- *` (M10).

### Adicionado
- Suíte de testes dos hooks (`hooks/test/guards.test.mjs`, 148 casos) com os corpora do README.
- Seção "Limites declarados" no README e no `AGENTS.md §9`.
- Arquivos de comunidade: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, templates de issue/PR, CODEOWNERS, CI.

## [1.0.0] — 2026-09-05

Primeira publicação: marketplace + plugin com hooks R2/R3, 4 skills, 3 agents, `/gabarito-doctor`, 7 gates
(77 testes), instalador, templates e README com as 13 medições.

[1.1.0]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.1...gabarito-mestre--v1.1.0
[1.0.1]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.0...gabarito-mestre--v1.0.1
[1.0.0]: https://github.com/gabrielnfc/gabarito-mestre/releases/tag/gabarito-mestre--v1.0.0

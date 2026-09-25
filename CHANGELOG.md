# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento: [SemVer](https://semver.org/lang/pt-BR/).
Usuários do plugin só recebem atualização quando `version` muda.

## [Unreleased]

Rollout do Workflow TRUE (1.1.0): três níveis de card, gates de versionamento no CI, hooks novos e
harness-doctor mais rigoroso.

> **Aviso:** um repositório já em nível 2 ou 3 com o harness 1.0.1 **cai para nível 1** assim que
> `harness-doctor` 1.1.0 rodar, até o onboarding ser refeito — as checagens novas (fluxo, versionamento,
> changelog, tamanho do `AGENTS.md`) contam para o nível 2. Não é regressão do harness: é o doctor medindo
> em vez de presumir. Rode o onboarding para recuperar o nível.

### Adicionado
- **Workflow TRUE**: três níveis de card (Iniciativa · Epic · PBI), oito tipos, políticas de fluxo e
  colunas de movimento em `docs/harness/fluxo.md`; templates dos 8 tipos de card prontos para uso.
- **Gate de versionamento no CI**: novo job `versionamento` em `gabarito.yml` valida Conventional Commits
  com escopo do PBI e nome de branch (R20) contra o histórico da PR.
- **`harness-doctor` mais rigoroso**: 8 checagens novas (fluxo configurado, versionamento, changelog,
  iniciativa resolvida, tamanho do `AGENTS.md`, entre outras), `--cache` e `--explain` para ler cada item.
- **Três hooks novos**: `guard-versioning.sh` barra commit ou branch fora do padrão antes de acontecer;
  `session-card.sh` injeta um cartão de sessão (≤ 40 linhas) no início de cada sessão; `remind-orchestrator.sh`
  lembra a regra "orquestrador não implementa" (R21), quando habilitado.
- **`instalar.sh`**: flags `--atualizar` (upgrade sem sobrescrever edição local do repo), `--gates-substituir`
  e `--codeowners`.
- **Templates novos**, instalados pelo onboarding: `PULL_REQUEST_TEMPLATE.md` (fio condutor, banco e deploy,
  prova, revisor humano), `CHANGELOG.md` e `docs/backlog.md`.
- **`attest.json`**: dois atestados novos — `iniciativa-resolvida` e `squash-titulo-pr`.

### Alterado
- **`AGENTS.md`** reescrito para a 1.1.0: três regras novas no núcleo — R19 (fio condutor Iniciativa → Epic →
  PBI), R20 (versionamento é gate) e R21 (orquestrador despacha, não implementa; contenda sem override) —,
  papéis do orquestrador/implementador/revisor, camadas de contexto por agente, ciclo por altitude (Iniciativa →
  Epic → PBI → task). O detalhamento que saiu do núcleo migrou para `docs/harness/referencia.md`, `adocao.md` e
  `prompts.md` — nenhuma regra foi removida.
- **`docs/harness/adocao.md`**: escada de níveis de adoção alinhada ao que o doctor mede de fato; a orientação
  deixa de assumir uma pessoa sênior orquestrando sozinha.
- **`docs/harness/prompts.md`**: prompt do implementador ganha o isolamento por worktree (porta, schema,
  namespace); prompt do orquestrador ganha o passo "antes de despachar".
- **Numeração das regras de projeto (quebra para quem já adotou):** as regras específicas do projeto, no Apêndice
  do `AGENTS.md`, passam a começar em **R30** (antes **R19**), porque R19–R21 agora são regras do núcleo. Quem já
  adotou a 1.0.x e tem R19+ no Apêndice precisa renumerar para R30+ e atualizar as referências a elas.

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

[1.0.1]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.0...gabarito-mestre--v1.0.1
[1.0.0]: https://github.com/gabrielnfc/gabarito-mestre/releases/tag/gabarito-mestre--v1.0.0

# Design — Gabarito Mestre 1.1.0: Workflow TRUE, onboarding, versionamento e orquestração

**STATUS: DESENHO PRONTO · plano ainda não escrito.** Nada abaixo está implementado. Toda afirmação sobre o pacote 1.1.0 é **(b)** até o plano ser executado e o doctor medir. Fatos M1–M8 e M10 são **(a)**; M9 é **(c)**.

Escopo: adequar o plugin `gabarito-mestre` (hoje 1.0.1) ao Workflow TRUE (Flight Levels + Kanban, fase 1 TI), acrescentar onboarding de fluxo na instalação, impor versionamento trunk-based, impor orquestração por subagente no modelo mais potente, e fechar furos de paralelismo e de janela de contexto. Fonte do workflow: `docs/workflow-true.html` (local, não versionado). **A fonte normativa versionada é `reference/fluxo.md`** (REQ-FLX-1), escrita antes de qualquer gate que a cite.

---

## Fatos medidos

| # | Medição | Resultado | Quando | Autorização |
|---|---|---|---|---|
| M1 | Tamanho de `reference/AGENTS.md` (carregado toda sessão via `@AGENTS.md`) | 18.010 bytes, 250 linhas, **com Apêndice vazio** | 2026-09-24 | n/a |
| M2 | `.claude/settings.json` de projeto aceita `model` com alias (`fable`, `opus`, `sonnet`, `haiku`) e ID completo; precedência `--model` > `ANTHROPIC_MODEL` > project local > project > user | confirmado em `code.claude.com/docs/en/model-config`, `settings` | 2026-09-24 | n/a (docs públicas) |
| M3 | `enabledPlugins` e `extraKnownMarketplaces` em settings de projeto: plugin fica habilitado para quem clona, **mas cada pessoa instala uma vez** | confirmado em `settings-example` | 2026-09-24 | n/a |
| M4 | Frontmatter de agente aceita `model: inherit` e aliases; existe `CLAUDE_CODE_SUBAGENT_MODEL` | confirmado em `sub-agents` | 2026-09-24 | n/a |
| M5 | Hook `SessionStart` (matchers `startup\|resume\|clear\|compact`) injeta `hookSpecificOutput.additionalContext`; `UserPromptSubmit` injeta e bloqueia com exit 2 | confirmado em `hooks` | 2026-09-24 | n/a |
| M6 | Servidores MCP conectados são visíveis pelo prefixo `mcp__<server>__<tool>` (plugin: `mcp__plugin_<plugin>_<server>__`) e por `claude mcp list` | confirmado em `mcp` | 2026-09-24 | n/a |
| M7 | Plugin **não** pode escrever settings do projeto do usuário por mecanismo próprio; só fornece skills, agents, hooks, MCP, LSP. (Uma *skill* rodando como agente, com ferramenta Write e ok do usuário, pode.) | confirmado em `plugins-reference` | 2026-09-24 | n/a |
| M8 | Doctor atual: 19 checagens (7 nível 1, 7 nível 2, 5 nível 3, 1 opcional), estrutura `{id, level, found, opcional}` em `harness-doctor.mjs:155-433`; `run()` puro, escrita só em `main()` | lido | 2026-09-24 | n/a |
| M9 | Hooks recebem o modelo da sessão ou a lista de plugins ativos no payload? | **não encontrado** na doc — tratado como ausente **(c)** | 2026-09-24 | n/a |
| M10 | Bytes por seção do `AGENTS.md`: cabeçalho 783 · §0 2.091 · §1 3.022 · §2 1.170 · §3 1.031 · §4 1.759 · §5 1.491 · §6 1.730 · §7 1.001 · §8 707 · §9 2.506 · Apêndice 719 | soma 18.010 (awk) | 2026-09-24 | n/a |
| M11 | `hooks/_common.sh`: `gabarito_scan_text` remove segmentos `git commit -m`; `gabarito_escape_hatch` só conhece `DESTRUCTIVE`/`PRODUCTION` e aceita uma pela outra | lido (`_common.sh:55-59, 114`) | 2026-09-24 | n/a |
| M12 | `templates/gabarito.yml`: checkout sem `fetch-depth`, job nomeado "77 testes"; `gates/package.json` já está em `1.0.0` ≠ plugin `1.0.1` | lido | 2026-09-24 | n/a |
| M13 | `AGENTS.md §7` remete a `referencia.md §3.7`, que não existe (§3 vai até 3.4) | lido | 2026-09-24 | n/a |

---

## Decisões do usuário (não reabrir)

| # | Decisão | Alternativa rejeitada e por quê |
|---|---|---|
| D1 | Sem MCP de planejamento, Iniciativa/Epics/PBIs vivem em `docs/fluxo/` no repo, nos mesmos templates dos cards | *Só IDs no Apêndice*: sem template, conformidade não tem o que conferir. *Exigir ferramenta*: fio condutor viraria opcional, e fio condutor opcional é o que o Workflow TRUE proíbe. |
| D2 | Trunk-based: `main` protegida, branch curta por PBI, Conventional Commits, SemVer, CHANGELOG, tag por release, squash-merge | *GitFlow*: cerimônia de release longa não combina com PBI concluível em dias. |
| D3 | Enforcement por settings de projeto versionadas + hook SessionStart + regra no AGENTS.md | *Só regra*: depende de cada pessoa; *user scope*: não chega ao time. |
| D4 | Uma Iniciativa padrão por repo, com override explícito no card | *Exatamente uma*: repo compartilhado por duas Iniciativas reprovaria trabalho legítimo. *Lista*: onboarding mais longo sem ganho no piloto. |
| D5 | Nenhum ID de modelo pinado. Config guarda política `mais-potente` + alias resolvido + data; resolução vence | *ID fixo*: modelos mudam; ID pinado envelhece em silêncio. |
| D6 | Abordagem A: camada de fluxo sobre o harness, aditiva, versão 1.1.0 | *B (reescrever por altitude)*: quebra anatomia medida e doctor, 2.0.0 sem prática que justifique. *C (só onboarding)*: fio condutor ficaria (b). |
| D7 | Paralelismo mede a máquina antes de cada dispatch; simultaneidade e teto parametrizáveis pelo usuário; contenda nunca é override | *Só limite fixo*: trava a máquina de quem tem menos recurso, subutiliza quem tem mais. |

---

## ADRs

**ADR-FLX-1 — PBI é a unidade de entrega; um plano por PBI.** O harness dizia "a unidade da PR é a ENTREGA". O Workflow TRUE diz que PBI é concluível em poucos dias e sai como "liberado". Decisão: **entrega = PBI**. Branch, PR, ledger e **plano** são por PBI; grupos dentro do plano são fases, nunca outros PBIs. Um Epic tem N PBIs, cada um com plano próprio; o design do Epic lista os PBIs (índice), não os planeja. Alternativa rejeitada: PR por Epic (grande demais, viola "poucos dias"); plano multi-PBI (dois implementadores não saberiam em que branch rodar). Não é exceção a R6–R12: sem cláusula de morte.

**ADR-ORQ-1 — Modelo por alias de família, nunca por ID.** Racional: M2 confirma alias flutuante; D5. Alternativa rejeitada: ID completo (envelhece). Exceção quando o usuário fixa ID por decisão registrada (ex.: custo). **Cláusula de morte:** ID fixo vence junto com a resolução (90 dias) e o cartão de sessão cobra revalidação.

**ADR-PAR-1 — Subagente não roda na máquina; o que pesa é o que ele executa.** Limite de paralelismo é por processos pesados simultâneos (suíte, build, dev server, banco), medidos, não por número de agentes. Racional: D7. Alternativa rejeitada: contar agentes (não mede nada local). Não é exceção a R6–R12: sem cláusula de morte.

**ADR-CTX-1 — O núcleo do `AGENTS.md` tem teto de bytes; o Apêndice tem orçamento próprio.** Núcleo = tudo antes de `## Apêndice`; teto = bytes do núcleo atual (M1 − Apêndice = 17.291). Apêndice preenchido tem orçamento separado (default 4.096). Conteúdo novo do núcleo empurra detalhe para `fluxo.md`/`referencia.md`; **"nada removido" (REQ-PKG-2) vale para funcionalidade e regra, não para bytes do núcleo** — texto migra, regra não some. Alternativa rejeitada: teto único sobre o arquivo inteiro (todo repo com Apêndice preenchido reprovaria por construção). **Cláusula de morte:** teto sobe só por decisão registrada com medição de impacto em contexto.

**ADR-FLX-2 — Escrita na ferramenta de planejamento é decisão por repo, gravada no onboarding.** R3 proíbe escrita em terceiro em produção; a ferramenta de planejamento não é produção "por padrão", mas é sistema vivo de alguém. Decisão: leitura sempre com ok do usuário na primeira vez; **escrita só se o Apêndice declarar `ferramenta de planejamento: escrita autorizada por <quem> em <data>`**. Sem isso, propagação de estado (REQ-FLX-6) vive só no ledger e no cache local. Alternativa rejeitada: escrever sempre (viola R3); nunca escrever (mata a propagação para quem autoriza). Não é exceção a R6–R12.

**ADR-TIM-1 — `tools/gabarito-gates/` é código do plugin, não do usuário.** `instalar.sh --atualizar --gates-substituir` pode sobrescrever **só** esse diretório, arquivo a arquivo, com backup `.bak` do que mudou. É a única exceção declarada ao "nunca sobrescreve"; `reference/` instalado em `docs/harness/` e `AGENTS.md` continuam intocáveis (`.novo` + diff). Alternativa rejeitada: `.novo` para gates (ninguém aplica 20 arquivos à mão; o doctor ficaria velho para sempre). Guarda: se um usuário editar `tools/gabarito-gates/` localmente (hash divergente do último instalado), o flag recusa aquele arquivo e cai para `.novo`. **Cláusula de morte:** a exceção encerra quando os gates passarem a ser instalados como dependência npm versionada (`gabarito-gates@x.y.z`), momento em que `--gates-substituir` é removido.

---

## Requisitos

Área `FLX` fluxo · `ONB` onboarding · `VER` versionamento · `ORQ` orquestração · `PAR` paralelismo · `CTX` contexto · `DOC` doctor · `CNF` conformidade · `TIM` time · `PKG` pacote. Ponteiros `arquivo:linha` são do estado atual (1.0.1).

### FLX — fluxo

**REQ-FLX-1** — Existe `reference/fluxo.md` (instalado em `docs/harness/fluxo.md`) com, nesta ordem: (1) os três níveis — propósito, o que flui, cadência, WIP, DoR, DoD; (2) os oito tipos de card com template e exemplo; (3) as cinco políticas gerais; (4) as cinco regras de movimento, incluindo "bloqueio é marcação, não coluna" e "envelhecimento tem limite"; (5) a propagação entre níveis; (6) ponto de compromisso, WIP e vazão por nível; (7) "métricas medem item, nunca pessoa".
Given o instalador rodou · When leio `docs/harness/fluxo.md` · Then as sete seções existem nesta ordem, o arquivo não é importado no `CLAUDE.md`, e é ele (não o HTML) que CNF-1 cita.

**REQ-FLX-2** — `harness.config.json` ganha a seção `fluxo`. **O template não a traz**; quem grava é `onboarding-config.mjs` (REQ-ONB-7). "Sem onboarding" = ausência de `fluxo.resolvidoEm`.
```json
"fluxo": {
  "ferramenta": "clickup | jira | linear | notion | trello | asana | monday | arquivos",
  "mcp": "<nome do servidor MCP ou null>",
  "iniciativa": { "id": "", "nome": "", "url": "<sem token, nunca>" },
  "mapeamento": { "FL3": "", "FL2": "", "FL1": "" },
  "status": { "FL2": {}, "FL1": {} },
  "vinculoPbiEpic": "<campo/relacionamento na ferramenta, ou 'frontmatter' em arquivos>",
  "escrita": false,
  "idPadrao": "^[A-Z]+-\\d+$",
  "resolvidoEm": "AAAA-MM-DD"
}
```
Given config sem `fluxo.resolvidoEm` · When rodo o doctor · Then `FALTA fluxo-configurado` (n2) com o conserto "rode o onboarding (`gabarito-instalar`)".

**REQ-FLX-3** — Fio condutor nos artefatos: design/spec declara `Iniciativa: <ID>` e `Epic: <ID>` no cabeçalho e lista os PBIs do Epic; plano declara `PBI: <ID>` (um só) e `Epic: <ID>` no cabeçalho; cada task tem `tipo` ∈ {US, Enabler, TechDebt, Spike, Bug, Tarefa}. Override de Iniciativa (D4): o Epic declara `Iniciativa: <outro ID> (override: <motivo>)`.
Fail-open declarado: sem `fluxo.resolvidoEm` no repo, o item "fio condutor" é **AVISO**, não falta (repo sem onboarding não reprova por vínculo que ainda não existe — este próprio documento é o caso).
Given repo com `fluxo.resolvidoEm` e design sem `Epic:`, ou plano com dois `PBI:` · When rodo `gabarito-conformidade` · Then NÃO CONFORME com item "fio condutor (R19)".
Given repo sem `fluxo.resolvidoEm` e design sem `Epic:` · When conformidade · Then item marcado AVISO e o veredito não muda por ele.

**REQ-FLX-4** — `AGENTS.md §7` (`reference/AGENTS.md:181-191`) reescrito: ciclo `Iniciativa (FL3) → Epic (FL2) = design → PBI (FL1) = entrega, um plano por PBI → tasks → execução → ledger`, Ready/Done por altitude (DoR/DoD de `fluxo.md`), ponteiro `§3.7` corrigido para `§3.4` (M13). Regra nova **R19 — Fio condutor obrigatório**: nenhum PBI sem Epic ativo, nenhum Epic sem Iniciativa ativa; card sem vínculo é desalinhamento, não exceção; métricas de fluxo medem item, nunca pessoa. `AGENTS.md:250` (Apêndice, "Regras adicionais deste projeto | R19+") passa a "**R30+**"; `--atualizar` avisa a renumeração.
Given `AGENTS.md` instalado pela 1.1.0 · When leio §3 e §7 · Then R19 existe, "R30+" existe, e `grep -c "§3.7"` = 0.

**REQ-FLX-5** — Sem MCP (`ferramenta: arquivos`): onboarding cria `docs/fluxo/iniciativa.md`, `docs/fluxo/epics/`, `docs/fluxo/pbis/` a partir de `templates/fluxo/*.md` (um por tipo de card, frontmatter `id`, `tipo`, `status`, `atualizadoEm`, mais `epic` nos PBIs e `iniciativa` no Epic; Iniciativa não tem vínculo — a Iniciativa de um PBI resolve via Epic) _(Emenda 2026-09-24, plano fase 1)_. `docs/backlog.md` continua sendo o backlog do harness (R17). `docs/fluxo/**` entra em `arquivosDeContenda` por default.
Given `ferramenta: arquivos` · When onboarding termina · Then os três caminhos existem e `docs/fluxo/pbis/PBI-EXEMPLO.md` tem frontmatter com `epic:`.

**REQ-FLX-6** — Propagação de estado. Ao integrar o primeiro commit de um PBI, o orquestrador registra `MOVIMENTO FL2 <Epic> Preparado→Em execução <data>` no ledger; ao concluir todos os PBIs do Epic, `→Em validação`. Além do ledger: o orquestrador grava `.harness/fluxo-cache.json` (estado imediato, local); em `arquivos`, o `status` do Epic em `docs/fluxo/epics/<ID>.md` é commitado **na branch do PBI** (`chore(fluxo): <Epic> → <status>`; arquivo em contenda, serial) e vale para todos após o merge — **nenhum commit direto em `main`** (D2: `main` protegida). _(Emenda 2026-09-24, conformidade r2 — era: "commit direto em `main` autorizado por R1", que contradizia D2.)_ Com MCP, escreve na ferramenta **só se** `fluxo.escrita: true` (ADR-FLX-2), senão avisa em uma linha que o movimento ficou pendente na ferramenta.
Given `fluxo.escrita: false` e primeiro PBI integrado · When ledger é atualizado · Then há a linha de MOVIMENTO e a linha "ferramenta não atualizada (escrita não autorizada)".

**REQ-FLX-7** — `referencia.md §3.4` (`referencia.md:107-112`) reescrito: cadência = fluxo contínuo; WIP por nível vive em `fluxo.md` (FL1 por coluna, definido pelo time); "uma entrega em voo por vez" vira "PBIs em voo ≤ WIP FL1 do time; implementadores simultâneos ≤ `paralelismo.simultaneos`"; "unidade da PR é a ENTREGA" vira "unidade da PR é o PBI (ADR-FLX-1)"; as cinco exceções de PR separada permanecem, agora como "PBI que exige PR própria mesmo pequeno".
Given `referencia.md` 1.1.0 · When grep "Sem sprint, sem timebox, sem WIP formal" · Then 0 ocorrências, e `§3.4` cita ADR-FLX-1.

**REQ-FLX-8** — Bloqueio e envelhecimento. Qualquer impedimento (externo, dependência, review reprovado N vezes) marca a task/PBI no ledger como `BLOQUEADA <data> <motivo> <dono do desbloqueio>`; o item não muda de coluna. Cartão de sessão (ORQ-3) lista PBIs sem movimento há mais de `fluxo.envelhecimentoDias` (default 3) como "envelhecido — pauta do nível acima". `AGENTS.md §8` ganha a linha "políticas de fluxo (`fluxo.md`) revisadas a cada `____` com base em dado real".
Given ledger com `BLOQUEADA` há 4 dias · When SessionStart · Then o cartão traz "envelhecido: <PBI> 4d".

### ONB — onboarding

**REQ-ONB-1** — `gabarito-instalar` passa a ter quatro fases, nesta ordem: (1) instalação determinística (`instalar.sh`, inalterado no que já faz); (2) fluxo; (3) versionamento; (4) orquestração. Fases 2–4 gravam via `onboarding-config.mjs` (ONB-7) e no Apêndice do `AGENTS.md` (via Edit, com o bloco mostrado ao usuário antes). Cada fase 2–4 roda quando o seu `resolvidoEm` está ausente (`fluxo.resolvidoEm` · `versionamento.resolvidoEm` · `orquestracao.modelo.resolvidoEm`), ou por pedido explícito ("refazer onboarding"). Onboarding interrompido retoma da fase que falta. _(Emenda 2026-09-24, conformidade r2 — era: gatilho só por `fluxo.resolvidoEm`.)_
Given repo com os três `resolvidoEm` preenchidos · When peço "instala o gabarito" · Then só a fase 1 roda e a skill diz "onboarding já feito em <data>; para refazer, peça".
Given repo com `fluxo.resolvidoEm` e sem `versionamento.resolvidoEm` · When peço "instala o gabarito" · Then fases 3 e 4 rodam, a 2 não.

**REQ-ONB-2** — Fase 2 detecta ferramenta de planejamento: lista tools `mcp__*` visíveis na sessão e cruza com `reference/ferramentas-mcp.json` (`{ padraoServidor, ferramenta, hierarquiaSugerida, statusSugerido, comoBuscarIniciativa, confirmadoEm }` — `confirmadoEm: null` é a marca (b)) _(Emenda 2026-09-24, plano fase 1 — era snake_case)_; complementa com `claude mcp list`. Sem match: propõe `arquivos` **ou** nome livre de servidor que o usuário informe (grava e a lista cresce por PR). Avisa em uma linha, com número, quantos servidores MCP estão conectados e o custo de contexto (CTX-3).
Given sessão com `mcp__claude_ai_ClickUp__*` · When onboarding roda · Then propõe `ferramenta: clickup`, `mcp: claude_ai_ClickUp` e pede confirmação.

**REQ-ONB-3** — Com ferramenta detectada: a skill diz em uma linha "vou LER na ferramenta X para confirmar a Iniciativa; ferramenta de planejamento não é produção de terceiro por padrão, mas é sistema vivo — ok?"; com ok, busca a Iniciativa (I10: existe ≠ ativa — confirma status), lê nome/URL (URL sem token). Pergunta o padrão em perguntas fechadas (`AskUserQuestion`): onde vivem FL3/FL2/FL1 na hierarquia (com a `hierarquia_sugerida` como default), nomes dos status por nível, formato de ID, campo que liga PBI→Epic, **escrita autorizada?** (ADR-FLX-2; default não). Grava tudo em `fluxo`; o que não foi confirmado na ferramenta é marcado (b) no Apêndice.
Given Iniciativa informada não existe na ferramenta · When busca retorna vazio · Then a skill não grava e pergunta de novo (I4: vazio não é prova; oferece gravar como (b) se o usuário insistir).

**REQ-ONB-4** — Fase 3 confirma trunk-based (D2) e os prefixos por tipo (VER-1); grava `versionamento`; instala `.github/PULL_REQUEST_TEMPLATE.md` (se ausente) com: título `tipo(PBI-n): assunto` (é o título que vira commit de squash), PBI, Epic, requisito que fecha, migration compatível, plano de volta, janela, teardown, revisor humano; instala `CHANGELOG.md` (se ausente) em Keep a Changelog com `Unreleased`; cria `docs/backlog.md` (se ausente) com o cabeçalho normativo de `referencia.md §2.4`.
Given repo sem os três arquivos · When fase 3 termina · Then os três existem e nenhum arquivo pré-existente foi alterado.

**REQ-ONB-5** — Fase 4, modelo: a skill mostra os aliases conhecidos (M2) e pergunta ao usuário qual família é a mais potente hoje na sua conta (fonte: `/model` na UI — não existe API para enumerar; a resposta é **(b)** do usuário, gravada com data). Grava `orquestracao.modelo`. Depois mostra o **diff** do `.claude/settings.json` proposto (`model: <alias>`, `enabledPlugins`, `extraKnownMarketplaces`) e pergunta, separadamente: (i) gravar `model` para o time inteiro? (project > user: afeta custo de todos); (ii) registrar o marketplace do gabarito (hooks PreToolUse de terceiro — ponto de consentimento). Só grava o que foi confirmado; se `settings.json` existe, `onboarding-config.mjs` emenda chave a chave (R2). README explica "cada pessoa instala uma vez" (M3).
Given `.claude/settings.json` existente com `permissions` · When fase 4 grava · Then `permissions` permanece byte a byte e `model` foi adicionado.

**REQ-ONB-6** — Fase 4, máquina: roda `capacidade.mjs --calibrar` e grava `paralelismo` com `calibradoEm`; pergunta `simultaneos` e `teto` com os medidos como default; propõe `arquivosDeContenda` a partir do que existe no repo (lockfile detectado, `prisma/`, barrel `src/index.ts`, `docs/fluxo/`), usuário confirma.
Fórmula de `--calibrar`: `simultaneos = clamp(floor(cores / 4), 1, 3)`; `teto = clamp(floor(cores / 2), 2, 8)`; `limites` = defaults de ORQ-1 (calibragem fina é do usuário, com data).
Given máquina com 8 cores · When calibra · Then `simultaneos` = 2, `teto` = 4, `calibradoEm` = hoje. Given 2 cores · Then `simultaneos` = 1, `teto` = 2.

**REQ-ONB-7** — Script `scripts/onboarding-config.mjs` (no plugin e copiado para `tools/gabarito-gates/scripts/`): `--set fluxo '<json>'`, `--set versionamento '<json>'`, `--set orquestracao '<json>'`, `--settings '<json>'`. Faz merge chave a chave, preserva chaves desconhecidas e comentários `_comment`, nunca remove, escreve atomicamente, imprime o diff. Testado.
Given `harness.config.json` com `deployOrder` · When `--set fluxo …` · Then `deployOrder` inalterado e `fluxo` presente.

**REQ-ONB-8** — Frontmatter de `gabarito-instalar` ganha `AskUserQuestion`, `Edit`, `Bash(claude mcp list:*)`; tools MCP **não** entram no `allowed-tools` (pedem permissão por chamada — é o esperado, R3). Onboarding termina com o doctor e a lista "o que ficou (b)".
Given frontmatter da skill 1.1.0 · When leio `allowed-tools` · Then contém `AskUserQuestion`, `Edit`, `Bash(claude mcp list:*)` e nenhum `mcp__*`.

### VER — versionamento

**REQ-VER-1** — `harness.config.json.versionamento` (gravado por ONB-7, não pelo template):
```json
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
}
```
Mapa tipo de PBI → prefixo: US→`feat`, Bug→`fix` (hotfix é `fix` com PBI de Bug), Enabler→`enabler`, TechDebt→`debt`, Spike→`spike`, Tarefa→`task`. Os prefixos de branch **são** os `tiposComEscopoDePbi` (com ID) mais os `tiposLivres` que fazem sentido em branch (`chore|docs|ci|build|test`, slug livre) — uma lista deriva da outra. _(Emenda 2026-09-24, conformidade r2 — era: `chore|hotfix` exigindo ID.)_
Given `feat/PBI-12-x`, `chore/bump-deps`, `wt/PBI-12-1` · When `validarBranch` · Then os três passam; `hotfix/PBI-1`, `chore/PBI-1`, `feat/pbi-12` reprovam. Branch de worktree de implementador é `wt/<PBI>-<n>` (`referencia.md §3.1` passa a dizer isso; `n` é o índice do worktree, gravado no nome e no ledger).

**REQ-VER-2** — Hook `guard-versioning.sh` (PreToolUse Bash). Lê `GABARITO_CMD` **cru** (não passa por `gabarito_scan_text`, M11) — mas remove corpos de heredoc de escrita com terminador citado e só reconhece `git` em posição de comando, para que `echo 'git commit -m x'` e anotação em arquivo não bloqueiem (mesma classe dos 3 falsos positivos medidos em R2). Os regex do contrato usam `\d`; o hook traduz `\d`→`[0-9]` e `\w`→`[A-Za-z0-9_]` porque o `grep -E` BSD não os entende. _(Emenda 2026-09-24, plano fase 3 — protótipo rodado no bash 3.2: 252 testes verdes.)_ Intercepta: criação de branch — `git checkout -b|-B`, `git switch -c|-C|--create`, `git branch <nome>` (sem `-d/-D/-m/--list`), `git worktree add -b|-B` — e valida contra `branchPadrao` **ou** `branchWorktree`; commit — `git commit` com `-m`, `--message=`, `-am`, `-m` múltiplo, `-m "$(cat <<'EOF' … EOF)"` (forma padrão do Claude Code), `-F <arquivo>` (lê relativo ao `cwd` do payload), `-F -` com heredoc — e valida o cabeçalho `tipo(escopo): assunto`, escopo casando `idPadrao` quando tipo ∈ `tiposComEscopoDePbi`, livre ou ausente quando ∈ `tiposLivres`. Não intercepta `--amend` sem `-m`, commit interativo, `main`/`master`. Bloqueia com exit 2 e motivo em três camadas. Escape hatch `GABARITO_ALLOW_VERSIONING` (mesmas regras; **hatches não cruzam** — `gabarito_escape_hatch` generalizado para receber o nome da variável). Fail-open declarado sem `versionamento.resolvidoEm` (repo sem onboarding não é travado); raiz do repo via `git rev-parse --show-toplevel` (monorepo em subpasta). `timeout: 10`.
Given `git commit -m "arrumei"` · When hook roda · Then exit 2 citando R20 e mostrando `feat(PBI-123): …`.
Given `git worktree add -b wt/PBI-123-1 ../wt1` · When hook roda · Then passa.

**REQ-VER-3** — `versionamento-check.mjs` nos gates: `--base <ref> --branch <nome>`; valida commits de `base..HEAD` **ignorando commits com 2 pais** (merge do orquestrador) e o nome da branch. No CI: `fetch-depth: 0`, `--branch "$GITHUB_HEAD_REF"`, `--base origin/main`. No doctor: checagem `versionamento` (n2) sobre os últimos 20 commits de primeiro pai de `main` + branch atual quando não for `main`. `attest.json` ganha `squash-titulo-pr` (ruleset exige título CC no squash — nenhuma varredura prova).
Given log com `feat(PBI-1): a`, merge commit, `docs: b` · When check roda · Then passa; trocar `docs: b` por `fix: c` (escopo obrigatório ausente) reprova.

**REQ-VER-4** — Regra **R20 — Versionamento é gate, não convenção** no `AGENTS.md §3` (uma linha: trunk-based · branch por PBI · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag por release · squash com título CC); detalhe em `referencia.md §10`, nova subseção "Versionamento".
Given `AGENTS.md` 1.1.0 · When grep `R20` · Then 1 ocorrência no §3 e a subseção existe em `referencia.md`.

### ORQ — orquestração

**REQ-ORQ-1** — `harness.config.json.orquestracao` (gravado por ONB-7):
```json
"orquestracao": {
  "modelo": { "politica": "mais-potente", "alias": "", "resolvidoEm": "", "validadeDias": 90 },
  "sempreSubagente": true,
  "lembretePorPrompt": false,
  "paralelismo": {
    "modo": "auto",
    "simultaneos": 2,
    "teto": 4,
    "limites": { "loadPorCoreMax": 1.5, "memDisponivelMinMB": 2048, "discoLivreMinGB": 5 },
    "arquivosDeContenda": ["<lockfile detectado>", "prisma/", "src/index.ts", "docs/fluxo/"],
    "isolamentoWorktree": { "porta": "3000+n", "dbSchema": "wt_{n}", "namespace": "wt-{n}" },
    "rodadasAntesDeEscalar": 2,
    "calibradoEm": ""
  }
}
```
Vocabulário fixo: `simultaneos` = implementadores rodando ao mesmo tempo (máquina); "PBIs em voo" = WIP FL1 (Kanban); "worktrees vivos" = medição. Nunca a palavra "WIP" sozinha no config. _(Emenda 2026-09-24, review — era: `wip`.)_
Given config sem `orquestracao` · When qualquer script lê · Then usa exatamente estes defaults e avisa "defaults (orquestracao ausente)" em stderr.

**REQ-ORQ-2** — Regra **R21 — Orquestrador despacha, não implementa** no `AGENTS.md §6`: toda implementação, spike, review e exploração pesada roda em subagente com contexto próprio; exceção única continua sendo mudança de uma linha; modelo do orquestrador é o resolvido em `orquestracao.modelo`, subagentes herdam (`inherit`); **velocidade nunca compra concorrência**: arquivo disjunto, contenda e recurso compartilhado serial não têm override.
Given `AGENTS.md` 1.1.0 · When grep `R21` · Then 1 ocorrência no §6 com a frase "não têm override".

**REQ-ORQ-3** — Hook `session-card.sh` (SessionStart, matchers `startup|resume|clear|compact`, `timeout: 30`): raiz via `git rev-parse --show-toplevel`; executa `${CLAUDE_PLUGIN_ROOT}/gates/scripts/cartao-sessao.mjs` e injeta `additionalContext` com **até 40 linhas**: modelo (política, alias, dias restantes; "VENCIDO — revalide" quando passou de `validadeDias`); branch e sha; PBI inferido da branch (`idPadrao`); Epic e Iniciativa lidos de `.harness/fluxo-cache.json` (ORQ-6) ou, em `arquivos`, do frontmatter de `docs/fluxo/pbis/<ID>.md` — ausente: `Epic: (b) não resolvido — registre com gabarito-instalar --vincular <PBI>`; PBIs em voo e worktrees vivos; `slots` de `capacidade.mjs`; nível do doctor em cache (DOC-2); PBIs envelhecidos (FLX-8); ponteiro para "LER PRIMEIRO" do ledger do PBI; `harness-versao`: versão instalada (`tools/gabarito-gates/package.json`) × versão do plugin (`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`), com "rode `instalar.sh --atualizar`" quando diferirem; aviso `superpowers` ausente lido de `~/.claude/plugins/installed_plugins.json` marcado **(c)**. Fail-open declarado: sem `fluxo.resolvidoEm`, injeta uma linha "harness sem onboarding: rode `gabarito-instalar`".
Given branch `feat/PBI-123-x` e cache com `PBI-123 → EPIC-7` · When SessionStart · Then o contexto contém `PBI: PBI-123`, `Epic: EPIC-7`, e tem ≤ 40 linhas.

**REQ-ORQ-4** — Hook `remind-orchestrator.sh` (UserPromptSubmit, `timeout: 5`): só quando `lembretePorPrompt: true`; injeta uma linha ("R21: despache, não implemente · slots: n"); **nunca** exit 2. Default desligado.
Given `lembretePorPrompt: false` · When prompt · Then stdout vazio e exit 0.

**REQ-ORQ-5** — Validade do modelo: `modelo.resolvidoEm` + `validadeDias` (90, alinhado ao autodiagnóstico trimestral de `adocao.md §6`). Vencido → aviso no cartão de sessão **e** `warn` no doctor (não derruba nível, não quebra CI).
Given `resolvidoEm` há 91 dias · When doctor roda · Then linha `warn modelo-resolvido` e nível inalterado.

**REQ-ORQ-6** — `.harness/fluxo-cache.json` (`{ "<PBI>": { "epic", "iniciativa", "titulo", "em" } }`, gitignored): gravado pelo orquestrador ao abrir a branch do PBI (`gabarito-instalar --vincular <PBI>` faz a leitura na ferramenta ou no arquivo e grava), com linha no ledger. É a única fonte offline de PBI→Epic para hooks.
Given `--vincular PBI-123` com ferramenta `clickup` e `escrita: false` · When roda · Then lê o card, grava o cache, não escreve na ferramenta.

### PAR — paralelismo

**REQ-PAR-1** — `capacidade.mjs` nos gates: mede cores, load 1 min, memória **disponível** (macOS via `vm_stat`: free + inactive + speculative; Linux via `/proc/meminfo MemAvailable`), disco livre no cwd, processos pesados vivos = processos com CPU > 20% **ou** RSS > 500 MB, **excluindo a árvore de processos do Claude Code** (PID pai do hook e descendentes). Devolve JSON `{ slots, motivo, medidas }`, `slots = min(simultaneos, teto, permitido pelos limites)`, nunca < 1. `GABARITO_PARALELISMO=<n>` substitui `simultaneos` na sessão, ainda ≤ `teto`. `--calibrar` imprime valores sugeridos. Medidas injetáveis por env de teste. macOS e Linux, zero dependência.
Given load/core 2.0 e limite 1.5 · When roda · Then `slots: 1`, `motivo` cita load.
Given `GABARITO_PARALELISMO=9`, `teto: 4` · When roda · Then `slots ≤ 4`.

**REQ-PAR-2** — Orquestrador consulta `capacidade.mjs` **antes de cada dispatch**; registra `slots=<n>` no ledger a cada dispatch; item entra quando um sai. `prompts.md` ganha o parágrafo "Antes de despachar" no papel do orquestrador (`referencia.md §3.1`).
Given ledger de entrega com 3 dispatches · When leio · Then há 3 linhas `slots=`.

**REQ-PAR-3** — Task que toca qualquer caminho de `arquivosDeContenda` é serial: o plano marca `serial: contenda`; `gabarito-conformidade` reprova plano cujo grafo paraleliza duas tasks com contenda.
Given plano com T2 e T3 paralelas, ambas tocando `prisma/` · When conformidade · Then NÃO CONFORME item "contenda (R21)".

**REQ-PAR-4** — Dispatch de implementador injeta `isolamentoWorktree` resolvido para o índice `n` do worktree (o `n` de `wt/<PBI>-<n>`): porta, schema, namespace. `prompts.md` (Implementador) ganha o bloco "Isolamento: porta X · schema Y · namespace Z — não use outro".
Given `n=2` · When dispatch · Then o prompt contém `porta 3002 · schema wt_2 · namespace wt-2`.

**REQ-PAR-5** — Escalada: task reprovada `rodadasAntesDeEscalar` vezes é marcada `BLOQUEADA` (FLX-8) e o orquestrador **escala ao usuário** com custo estimado das opções, em vez de tentar de novo.
Given 2 reprovações · When terceira rodada seria despachada · Then não é; ledger tem `BLOQUEADA` e a sessão pergunta ao usuário.

### CTX — contexto

**REQ-CTX-1** — Teto do **núcleo** do `AGENTS.md` (bytes antes de `## Apêndice`) = 17.291 (M1 − Apêndice M10); orçamento do Apêndice = `contexto.apendiceMaxBytes` (default 4.096). Doctor checa `agents-tamanho` (n2) para os dois. Para caber: R2/R3 perdem os blocos "Motivo" e "Gate" (→ `referencia.md §11/§12`), §5 vira lista de duas linhas (→ `§5`), §9 perde "Consequência prática", "Fronteira com UI/UX" e a lista de limites dos hooks (→ SKILL.md e README), §0.2 perde o bloco de comando (→ `adocao.md §1`), §6 perde "dois incidentes" (→ `§3.1`). Estimativa **(b)** (M10 + review): −3.250 B liberados, +3.140 B adicionados. **Emendas no `AGENTS.md` do plugin são rastreadas por git e CHANGELOG, não inline (R16 vale para o documento instalado do usuário, que ele emenda; o do plugin é código).**
Given núcleo com exatamente 17.291 bytes · When doctor · Then `ok`. Given 17.292 · Then `FALTA agents-tamanho`. (As duas fixtures juntas fazem a mutação `>`→`>=` derrubar a suíte.) _(Emenda 2026-09-24, conformidade r2 — era: só a fixture de 17.292.)_

**REQ-CTX-2** — Camadas de contexto documentadas: tabela de 5 linhas no `AGENTS.md §6` (0 núcleo sempre · 1 cartão de sessão · 2 referência por ponteiro · 3 subagente isolado, relatório ≤25 linhas · handoff por ledger) e nova `referencia.md §3.5 "Camadas de contexto"` com a regra "orquestrador não lê saída bruta que um subagente possa resumir".
Given `referencia.md` 1.1.0 · When grep `§3.5` · Then existe e §3.3 continua sendo "Fronteira de sessão e handoff".

**REQ-CTX-3** — Onboarding (ONB-2) avisa quantos servidores MCP estão conectados e recomenda escopo de projeto (`.mcp.json`) só com o necessário; texto em `adocao.md §4` (`adocao.md:93-106`, "ferramenta pessoal no caminho da medição" ganha a linha "MCP demais no contexto").
Given sessão com 12 servidores MCP · When fase 2 · Then a saída contém "12 servidores MCP conectados" e o ponteiro para `adocao.md §4`.

### DOC — doctor

**REQ-DOC-1** — Checagens novas em `harness-doctor.mjs`, todas com `--explain`: `fluxo-configurado` (n2), `iniciativa-resolvida` (n2, **atestado** em `attest.json`: chave nova `iniciativa-resolvida`, TTL 180 d — o doctor é offline, sem `--online`), `versionamento` (n2), `changelog` (n2), `tag-semver` (n2, opcional em repo sem release), `agents-tamanho` (n2, núcleo + Apêndice), `paralelismo-calibrado` (n3: `calibradoEm` presente e ≤ 180 d), `modelo-resolvido` (**warn**, não conta nível). `harness-versao` **não** é do doctor (vive no cartão, ORQ-3). Template `attest.json` ganha as chaves `iniciativa-resolvida` e `squash-titulo-pr`.
Given repo 1.0.1 em nível 0 ou 1 · When doctor 1.1.0 roda · Then nível inalterado e as `FALTA` novas aparecem com conserto.
Given repo 1.0.1 em nível 2 ou 3 · When doctor 1.1.0 roda sem onboarding · Then o nível **cai** para 1 e a saída diz "checagens novas da 1.1.0: rode o onboarding ou declare o nível medido". Rebaixar uma checagem nova para nível 1 deve derrubar a suíte.

**REQ-DOC-2** — Cache: `main()` do doctor grava `.harness/doctor-cache.json` (`{ nivel, declarado, em }`) quando chamado com `--cache`; `run()` continua puro. O cartão de sessão chama o doctor **do plugin** com `--cache` quando o cache está ausente ou > 24 h, dentro do `timeout` do hook; CI não usa cache. O instalador **emenda** `.gitignore` (mesma regra do `CLAUDE.md`: garante as linhas `.harness/doctor-cache.json`, `.harness/fluxo-cache.json`, `*.novo`, sem remover nada).
Given cache com 25 h · When SessionStart · Then o doctor roda com `--cache` e o arquivo é reescrito; ignorar o TTL deve derrubar o teste.

### CNF — conformidade

**REQ-CNF-1** — Checklists novos em `gabarito-conformidade`, citando `fluxo.md` por seção: Iniciativa (Problema, Resultado com indicador, Escopo/Horizonte/Patrocinador, Critério de sucesso com meta); Epic (Narrativa em 7 linhas, RN, CA, lista de PBIs); PBI por tipo (US: Como/quero/para + RN + BDD · Enabler/TechDebt/Tarefa: Para/precisamos + CA, Tarefa com área/ponto focal/prazo · Spike: Para/precisamos/em até timebox + CA · Bug: descrição com onde/desde/afetando + reprodução + esperado). Design: fio condutor (FLX-3). Plano: `PBI:` único, `Epic:`, contenda serial (PAR-3), tipo por task.
Given Epic sem lista de PBIs · When conformidade · Then NÃO CONFORME item "Epic: PBIs (fluxo.md §2)".

### TIM — time

**REQ-TIM-1** — `adocao.md §5` (`adocao.md:108-116`) reescrito: harness assume orquestração por pessoa **com** ownership por área. Apêndice ganha tabela "Áreas e donos". Na **fase 2 do onboarding** (agente, não `instalar.sh`), a skill pergunta as áreas e gera `.github/CODEOWNERS` (se ausente). PR template exige revisor humano além do review adversarial.
Given onboarding com 2 áreas informadas · When fase 2 termina · Then `CODEOWNERS` tem 2 linhas e o Apêndice a tabela.

**REQ-TIM-2** — `instalar.sh --atualizar`: para `reference/` → `docs/harness/*.md` e `AGENTS.md` já existentes, grava `<nome>.novo` e imprime `diff --stat`, nunca sobrescreve; avisa a renumeração R19→R30+ (FLX-4). `--atualizar --gates-substituir` (ADR-TIM-1): sobrescreve `tools/gabarito-gates/` arquivo a arquivo com `.bak` do que mudou, **recusando** se o hash instalado divergir do último instalado (`tools/gabarito-gates/.instalado.json`, gravado pelo instalador com hashes). `.gitignore` emendado com `*.novo` e `*.bak`.
Given `tools/gabarito-gates/scripts/harness-doctor.mjs` editado localmente · When `--gates-substituir` · Then recusa esse arquivo, grava `.novo`, e substitui os demais.

### PKG — pacote

**REQ-PKG-1** — Versão 1.1.0 em `plugin.json`, `marketplace.json` **e `gates/package.json`** (hoje 1.0.0, M12); CHANGELOG com seção 1.1.0; README com seções novas (fluxo, onboarding, versionamento, orquestração, paralelismo, contexto, "cada pessoa instala uma vez") e medições novas M14 (onboarding com MCP ClickUp) e M15 (sem MCP) marcadas **NÃO MEDIDO** até serem medidas; `templates/gabarito.yml` com `fetch-depth: 0`, job `versionamento`, nome do job de testes **sem número**.
Given `grep -r "77 testes" templates/` · When 1.1.0 · Then 0 ocorrências.

**REQ-PKG-2** — Nenhuma regra, gate, hook, skill ou agente da 1.0.1 removido; texto do núcleo do `AGENTS.md` pode migrar para referência (ADR-CTX-1). `plugin.json` continua sem chave `hooks`.
Given a lista de nomes da 1.0.1 (4 skills, 3 agents, 1 command, 2 hooks, 7 gates, R1–R18, G1–G9, I1–I12) · When diff da 1.1.0 · Then nenhum nome ausente e `grep '"hooks"' plugin.json` = 0.

---

## Fora de escopo

Vive em `docs/backlog.md` deste repo (criado no rollout, passo 0), formato `| Item | Origem | Gatilho |`; a cópia abaixo é índice.

| Item | Dono | Gatilho |
|---|---|---|
| Escrita na ferramenta como default (hoje: só com `fluxo.escrita: true`) | Gabriel | 3 repos do time com escrita autorizada e sem incidente |
| Adaptador de escrita por ferramenta (criar card a partir do plano) | Gabriel | primeiro PBI que precisar abrir card a partir do plano |
| Métricas de fluxo (lead time, throughput, envelhecimento agregado) calculadas pelo harness | Gabriel | fase 2 do Workflow TRUE |
| Bloqueio de prompt inline via UserPromptSubmit exit 2 | Gabriel | R21 violada 3× no piloto |
| Isolamento remoto como default de dispatch | Gabriel | máquina do piloto em `slots: 1` em mais de 50% das sessões |
| Abordagem B (harness reescrito por altitude, 2.0.0) | Gabriel | 3 achados de conformidade por confusão de conceito |
| Enumeração automática de modelos (substituir a resposta (b) do usuário em ONB-5) | Gabriel | Claude Code expor API/CLI de listagem |

---

## Testes e gates

| Requisito | Prova | Mutação que deve derrubar a suíte |
|---|---|---|
| FLX-1 | teste de grep no CI do plugin: 7 cabeçalhos `## ` em `fluxo.md`, na ordem | remover a seção (4) |
| FLX-4, VER-4, ORQ-2 | `harness-doctor.test.mjs` (fixture do `AGENTS.md` 1.1.0) + grep no CI do plugin | apagar R19 · apagar R20 · apagar "não têm override" |
| FLX-7, CTX-2, CTX-3 | grep no CI do plugin sobre `referencia.md`/`adocao.md` | reintroduzir "sem WIP formal" · apagar §3.5 · apagar "MCP demais" |
| FLX-2, VER-1, ORQ-1, DOC-1, ORQ-5 | `harness-doctor.test.mjs`: fixtures 1.0.1 e 1.1.0 com/sem seções, atestados vencidos | remover leitura de `fluxo`; rebaixar checagem nova para n1; tornar `modelo-resolvido` FALTA |
| FLX-3, FLX-5, CNF-1, PAR-3 | teste manual da skill em repo descartável (design sem `Epic:`, plano com contenda paralela, Epic sem PBIs) → M15 no README | **mutação de prompt** registrada em M15: retirar "fio condutor" do checklist → conformidade passa a aprovar design sem `Epic:` (deve acontecer, prova que o item é o que reprova); idem "contenda" |
| FLX-6, FLX-8, PAR-2, PAR-5 | `cartao-sessao.test.mjs` (ledger fixture com MOVIMENTO, BLOQUEADA, `slots=`) | FLX-6: omitir linha MOVIMENTO no fixture → cartão deixa de mostrar o Epic em execução · FLX-8: ignorar `envelhecimentoDias` · PAR-2: fixture com 0 linhas `slots=` deve gerar aviso "dispatch sem medição" · PAR-5: `BLOQUEADA` sem "dono:" deve gerar aviso |
| ONB-1..6, ONB-8 | teste manual medido em dois repos descartáveis (com MCP ClickUp · sem MCP), M14/M15 no README | mutação de prompt em M14: apagar `versionamento.resolvidoEm` e pedir "instala" → só a fase 3 deve rodar; ONB-8: `grep AskUserQuestion SKILL.md` no CI do plugin |
| ONB-7 | `onboarding-config.test.mjs`: merge preserva chaves, `_comment`, atomicidade, diff | apagar chave desconhecida no merge |
| VER-2 | `guards.test.mjs` + corpus `versionamento.txt` (legítimos, inválidos, worktree, heredoc `$(cat <<'EOF')`, `-F`, hatch, sem config) | inverter regex do escopo; aceitar hatch `DESTRUCTIVE` para versionamento |
| VER-3 | `versionamento-check.test.mjs`: log sintético com merge commit | contar merge commit; aceitar `fix:` sem escopo |
| ORQ-3, ORQ-6, DOC-2 | `cartao-sessao.test.mjs`: cwd fixture, branch fake, cache presente/ausente/vencido, `harness-versao` | omitir `PBI:`; ultrapassar 40 linhas; ignorar TTL 24 h |
| ORQ-4 | `guards.test.mjs`: `lembretePorPrompt` false/true | exit 2 em qualquer caso |
| PAR-1 | `capacidade.test.mjs`: medidas injetadas por env | `slots` < 1; ignorar `teto`; contar a árvore do Claude |
| PAR-4 | `prompts.md` + teste de string no dispatch (fixture) | `n` fixo em 1 |
| CTX-1 | `harness-doctor.test.mjs`: núcleo e Apêndice acima/abaixo dos tetos | `>` por `>=` |
| TIM-1 | manual (M14/M15) + grep no CI: `adocao.md §5` sem "assume orquestração por uma pessoa sênior" | reintroduzir a frase |
| TIM-2 | `instalar.test.sh` (bash, novo): repo fixture 1.0.1 → `--atualizar` gera `.novo`; `--gates-substituir` com hash divergente recusa | sobrescrever `AGENTS.md`; ignorar hash |
| PKG-1, PKG-2 | `claude plugin validate --strict`; grep no CI do plugin (`77 testes` = 0; três `version` iguais; lista de nomes 1.0.1 presente) | voltar um `version` a `1.0.1` · remover um nome da lista |

Suíte dos gates continua zero dependência, Node ≥ 22.18. Hooks continuam bash 3.2. Contagem de testes nova é medida e escrita no README, não estimada.

---

## Rollout

Ordem e motivo:
0. **`docs/backlog.md`** deste repo com os itens de "Fora de escopo" — R17: item fora de escopo vive no backlog, e este repo não tem um.
1. **`reference/fluxo.md`** — é a fonte normativa que gates, skills e conformidade citam; sem ela, tudo que a cita nasce sem fonte (R14).
2. **Gates e scripts novos com testes** (`onboarding-config`, `capacidade`, `cartao-sessao`, `versionamento-check`, doctor, `instalar.sh --atualizar`) — base que hooks e skills chamam.
3. **Hooks novos com corpus** (`guard-versioning`, `session-card`, `remind-orchestrator`, `_common.sh` generalizado) — dependem de 2.
4. **Referência** (`AGENTS.md` §3/§6/§7/§8/§9/Apêndice e cortes de CTX-1, `referencia.md` §3.1/§3.4/§3.5/§10, `adocao.md` §4/§5, `prompts.md`, templates: `attest.json`, `gabarito.yml`, `fluxo/*.md`, PR template, CHANGELOG, `ferramentas-mcp.json`) — cita gates já existentes, para não nascer (b).
5. **Skills** (`gabarito-instalar` com onboarding e `--vincular`, `gabarito-conformidade`) — dependem de 1–4.
6. **Pacote** (três `version`, CHANGELOG, README) — último porque as medições M14/M15 só existem depois de 1–5 rodarem nos repos descartáveis.
Janela: nenhuma. Repos 1.0.1 não mudam até rodarem `--atualizar`.

---

## Pendências

| O que | Por quê | O que desbloqueia |
|---|---|---|
| Lista inicial de `ferramentas-mcp.json` | nomes reais dos servidores variam por instalação | onboarding aceita nome livre; lista cresce por PR |
| Valores iniciais de `limites` e dos heurísticos de "processo pesado" | calibrados em uma máquina só | `--calibrar` grava com data; M14/M15 medem |
| Contagem de testes 1.1.0 | só existe depois do rollout 2–3 | README escreve o número medido |
| Bytes finais do `AGENTS.md` | estimativa −3.250/+3.140 é apertada (< 200 B de folga) | doctor `agents-tamanho` é o gate; se não couber, cortar mais do §9 antes de subir o teto (ADR-CTX-1) |

---

## Emendas

_(Emenda 2026-09-24, conformidade + review adversarial — 44 achados incorporados antes da aprovação do plano.)_ Principais: teto de bytes só sobre o núcleo (ADR-CTX-1); um plano por PBI (ADR-FLX-1); escrita na ferramenta por decisão gravada (ADR-FLX-2); `--gates-substituir` como exceção declarada (ADR-TIM-1); R19→R30+ para regras de projeto; branch `wt/<PBI>-<n>` e `git worktree add` interceptado; formas de `git commit` do Claude Code no hook; merge commits ignorados e squash atestado; `fluxo-cache.json` como fonte offline de PBI→Epic; `harness-versao` no cartão, não no doctor; `modelo-resolvido` como warn e validade 90 d; `memDisponivel` via `vm_stat`/`MemAvailable` e exclusão da árvore do Claude; `simultaneos` no lugar de `wip`; `iniciativa-resolvida` como atestado; CODEOWNERS na fase 2; `docs/fluxo/` em contenda; commit direto em `main` só para `chore(fluxo)`; bloqueio por qualquer impedimento, envelhecimento e revisão de políticas (FLX-8); `§3.5` novo; `gates/package.json` e `gabarito.yml` corrigidos; Given/When/Then em 36 dos 41 requisitos; `docs/backlog.md` no rollout.

_(Emenda 2026-09-24, conformidade round 2 — 3 faltas parciais e 5 contradições.)_ G/W/T nos 5 requisitos restantes (ONB-8, VER-1, ORQ-1, CTX-3, PKG-2); ponteiros `AGENTS.md:250`, `referencia.md:107-112`, `adocao.md:93-106/108-116`; movimento de Epic em `arquivos` via branch do PBI, nunca commit direto em `main`; fixture de 17.291 que passa; fio condutor como AVISO sem onboarding; gatilho do onboarding por fase; `branchPadrao` alinhado aos tipos de commit; fórmula de `--calibrar`; cláusula de morte real em ADR-TIM-1; mutação nomeada por requisito, inclusive mutação de prompt para skills; estimativa de bytes marcada (b); marcas inline nos requisitos alterados.

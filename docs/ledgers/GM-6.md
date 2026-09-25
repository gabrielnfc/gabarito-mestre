# Ledger — PBI: GM-6 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-6-pacote.md   Branch: enabler/GM-6-pacote @ 820ac2c   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
Rulings herdados: R1, R2, R3, R16, R18, F2-R1..R11, F3-R1..R8, F4-R1..R10, F5-R1..R12          Contexto externo: M14 lê ClickUp por MCP (só leitura, ok nominal do usuário na sessão); repos descartáveis em mktemp

## LER PRIMEIRO — 2026-09-25
Fase 6: T25 → T26 (T26 depende de T25); nada medido ainda.
Fases 1–5 integradas em `main` (PR #5, `820ac2c`, squash). Pré-condições medidas: 4 fases na skill de instalação · "contenda (R21)"=2 · "Isolamento: porta"=1 · "warn modelo-resolvido"=1 · `validate --strict` ok no plugin e no marketplace · gates 240 mjs + 27 ts · hooks 269 · instalador 70 · slots 1.
Handoff consolidado das fases 2–5: `.superpowers/sdd/2026-09-24-workflow-true-1.1.0-fase-6-pacote/handoff.md` (scratch); resumo nas rulings abaixo.

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
|---|---|---|
| T25 × T11 | `gates/package.json` já em 1.1.0 × T25 confere os três iguais | não reescrever; só conferir |
| T25 × T21 | `templates/gabarito.yml` sem número no job × grep "77 testes" = 0 | T25 cobre os arquivos que T21/T22 não tocaram (CONTRIBUTING, gates/README, gates.md, README) |
| T26 × T22/T23 | skills finais × medições M14/M15 | mutação de prompt roda sobre CÓPIA do plugin, nunca sobre a árvore do repo |
| T25 (`ci.yml`) × ruleset de `main` | plano renomeia o job de gates e cria `instalador` e `texto` × ruleset exige 4 nomes | os 4 nomes obrigatórios não mudam no plano (validate, hooks ×2, doctor M10); jobs novos entram no ruleset depois do merge → F6-R4 |
| T25 × handoff das fases 3–5 | ~30 itens de texto, checagens de CI e backlog × plano da fase 6 não os traz | → F6-R2 |
| plano da fase 6 × Emendas "Fase 2 → fase 6" | raiz por cwd em 3 scripts 1.0.1; `ledger-versionado` com falso positivo × plano não cita | fase 6 não muda código → README declara + backlog (F6-R3) |
| T26 × usuário | M14 precisa da conta ClickUp e de respostas reais | M15 roda headless sozinho; M14 espera o usuário (F6-R5) |

## Rulings de pre-flight
F6-R1 — modelos (usuário: só opus e sonnet): opus em T25a (README e CHANGELOG, maior texto e juízo) e no review final; sonnet em T25b, T25c, T26 (M15) e nos reviews — custo-se-errado: uma rodada extra.
F6-R2 — T25 em três partes seriais, com arquivos disjuntos: T25c (correções de texto do handoff em `reference/`, skills, agente e o PR template do próprio repo) → T25a (manifestos, CHANGELOG `[1.1.0]`, README, backlog) → T25b (`ci.yml` com os 6 jobs do plano + as checagens de texto do handoff + testes que faltaram). T25b por último porque os greps têm de casar o texto final — custo-se-errado: um grep ajustado depois.
F6-R3 — nada de código de comportamento nesta fase (arquitetura do plano): `cartao-sessao.mjs` lendo `vinculoPbiEpic.nome`, raiz por cwd nos 3 scripts 1.0.1 e o falso positivo de `ledger-versionado` viram limites declarados no README + itens de `docs/backlog.md` com dono e gatilho. Testes novos (não comportamento) entram em T25b — custo-se-errado: um limite conhecido fica aberto até o próximo PBI.
F6-R4 — os nomes dos 4 checks obrigatórios do ruleset não mudam nesta fase; depois do merge o orquestrador acrescenta ao ruleset os jobs novos (gates renomeado, `instalador`, `texto`) — custo-se-errado: PR bloqueada esperando check que não roda.
F6-R5 — T26: M15 (headless, sem MCP) roda com subagente; M14 (interativo, ClickUp) é conduzido com o usuário na sessão dele; até lá o README fica com M14 "NÃO MEDIDO" e a PR da fase 6 só abre com M14 medido ou com decisão explícita do usuário de publicar sem ele — custo-se-errado: release com medição faltando.
F6-R6 — trailer: `Co-Authored-By: Claude Opus 5.5 (1M context)` + `Claude-Session` — custo-se-errado: atribuição.

## Progresso
Task T25c: DONE (sonnet; 9a0c1ef, 2bf4247, ecb36d7, 61f7dbc, 3adcd91 + af144a6 fix). Handoff A1–A7: mensagem de fail-open do §10 = a do hook; "PBIs em voo" (cartão) × "tasks em voo" (DISPATCH) desambiguados em `prompts.md` e `referencia.md`; snippet do `--vincular` grava data local (medido: 23:30 -03:00 → local 2026-09-25, UTC daria 2026-09-26); exceção serial do Isolamento em agente, `prompts.md` e `referencia.md §3.1` com o bloco verbatim idêntico; conformidade cita a abertura de `fluxo.md` para o fio condutor; linha `VINCULO` em `referencia.md §2.3`; `.github/PULL_REQUEST_TEMPLATE.md` do repo = template do plugin (doctor: `pr-template` sem aviso; check M10 ok). Review (sonnet) REPROVADO por 1 MAJOR ("em voo" sem qualificar em `referencia.md:149`), fix round 1/5 (1 addressed, 0 open; 3adcd91..af144a6), re-review APROVADO. Suítes: validate ok · gates 240 + 27 · hooks 269.
Task T25a: DONE (opus; 210f200 chore, ae381fa docs, 80e3193 docs). `plugin.json` e `marketplace.json` em 1.1.0 (gates já estava), `plugin.json` sem chave `hooks`. CHANGELOG: `[Unreleased]` da fase 4 promovido a `## [1.1.0] — 2026-09-25`, com aviso de queda de nível e renumeração R30+, link de compare no padrão `gabarito-mestre--vX.Y.Z`, `[Unreleased]` vazio no topo. README: seções novas (Fluxo, Onboarding, Versionamento, Orquestração e modelo, Paralelismo medido, Contexto em camadas, Atualizar de 1.0.x, Medições da 1.1.0), Fronteira com UI/UX (C11), VER-3 (b), limites do guard de versionamento, raiz por cwd nos 3 gates 1.0.1, falso positivo do `ledger-versionado`, cartão lendo `epic` fixo; M14/M15 NÃO MEDIDO; contagem medida gates 267 (240 + 27) · hooks 269 · instalador 70. `docs/backlog.md` + D1–D9 com dono e gatilho. Cartão no próprio repo: uma linha "sem onboarding", não pede `--atualizar`. Review (sonnet) APROVADO: versão 1.0.1, `"hooks":` no `plugin.json`, "77 testes" no README e item sob `[Unreleased]` — as 4 mutações pegas pelo comando equivalente; `validate --strict` confirmado cego ao `"hooks":`.
Ruling F6-R7 — para T25b: (1) "77 testes" restante em `plugins/gabarito-mestre/gates/README.md:21` (editar derruba o cenário 8 de `instalar.test.sh`, que usa esse README como arquivo idêntico entre 1.0.1 e 1.1.0 — trocar o arquivo de referência do cenário antes de editar) e em `plugins/gabarito-mestre/reference/gates.md:8`; (2) o grep do plano para `"hooks"` em `plugin.json` é sempre verdadeiro (a keyword `"hooks"` do array já conta 1) — o job `texto` usa `grep -c '"hooks"[[:space:]]*:'` = 0 — custo-se-errado: job `texto` vermelho ou gate que nunca falha.

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

# Ledger — PBI: GM-4 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-4-referencia.md   Branch: enabler/GM-4-referencia @ 85a49fd   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
Rulings herdados: R1, R2, R21, F1-R1, F2-R1..R11, F3-R1..R8   Contexto externo: nenhum (texto e templates; verificação por grep, `wc -c` e `tamanhoAgents`)

## LER PRIMEIRO — 2026-09-25
Fase 4: T17 → T18 seriais; T19–T21 paralelos depois.
Fases 1–3 integradas em `main` (PR #3, `85a49fd`). Pré-condições medidas: 7 arquivos das fases 2–3 presentes · `fluxo.md` com 7 seções (1. Os três níveis · 2. Os oito tipos de card · 3. Políticas gerais · 4. Colunas e regras de movimento · 5. Propagação entre níveis · 6. Ponto de compromisso, WIP e vazão por nível · 7. Métricas medem item, nunca pessoa) · `tamanhoAgents` = function · `AGENTS.md` 18.010 B (núcleo 17.291 · Apêndice 719).
Handoff para T23/T24/T25: ver "Handoff para as Fases 5 e 6" no plano da fase (C10, C11, bloco Isolamento, greps do CI).

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
|---|---|---|
| T17 × T18 | T17 corta C1–C11 do `AGENTS.md` · T18 cola em `referencia.md` §5/§11/§12 (e C1 vai para `adocao.md` em T19) | T17 antes; implementador de T18 lê o diff de T17 |
| T17 × T19 | C1 (comando do doctor) sai do núcleo · T19 §1 "Medição" recebe | T19 depois de T17 |
| T18 × T19–T21 | nenhum arquivo em comum | disjuntos; paralelos se houver slots |
| T17 × fixture do doctor (fase 2) | fixture 1.1.0 pode copiar o `AGENTS.md` | `npm test` dos gates no fim de T17 |
| T20 × fase 2 | prompt do orquestrador cita `capacidade.mjs --json`, linha `DISPATCH … slots=<n> worktree wt/<PBI>-<n>` | CLIs conferidas no código: ok |
| T21 × fase 2 | `gabarito.yml` roda `versionamento-check.mjs --base origin/main --branch "$GITHUB_HEAD_REF"` com `fetch-depth: 0` | flags conferidas no código: ok (base ausente é fail-closed, F2-R3) |
| T21 × T25 | `grep -r "77 testes" templates/` = 0 · o `ci.yml` do repo ainda chama um job "gates — 77 testes" | nome do job do repo é T25; não entra aqui |
| cada task (texto próprio) | T17–T21 mandam commitar `docs/ledgers/GM-4.md` | conflita com worktrees paralelos → F4-R3 |

## Rulings de pre-flight
F4-R1 — modelos (pedido do usuário: só opus e sonnet): opus em T17 (cortes com teto de bytes e realocação de regra) e no review final; sonnet em T18–T21, T21b e nos reviews por task — custo-se-errado: uma rodada extra.
F4-R2 — T19–T21 em worktrees `wt/GM-4-1..3` só se `capacidade.mjs` medir slots ≥ 2 no dispatch; senão serial T19 → T20 → T21 neste worktree — custo-se-errado: tempo de relógio.
F4-R3 — implementadores não tocam `docs/ledgers/GM-4.md`; o orquestrador atualiza após cada review — custo-se-errado: nenhum.
F4-R4 — task extra T21b: `CHANGELOG.md` da raiz ganha `## [Unreleased]` com o que as fases 1–4 entregaram (pedido do usuário: release e versionamento conforme as políticas; T25 depois promove para `[1.1.0]`) — custo-se-errado: T25 reescreve a seção.
F4-R5 — trailer dos commits desta fase: `Co-Authored-By: Claude Opus 5.5 (1M context)` + `Claude-Session`, porque nenhum trabalho desta fase roda em fable — custo-se-errado: atribuição trocada em commits de documentação.
F4-R6 — configurações do GitHub (só squash com título da PR, apagar branch no merge, ruleset em `main` com checks obrigatórios) foram negadas pela permissão desta sessão; ficam com o usuário, com os comandos no relatório. O merge desta PR segue o plano: squash — custo-se-errado: `main` desprotegido até o usuário aplicar.

## Progresso

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

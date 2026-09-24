# Ledger — PBI: GM-1 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-1-fluxo.md   Branch: enabler/GM-1-fluxo @ 3b427db   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
Rulings herdados: R1, R2, R21   Contexto externo: nenhum (sem sandbox, sem banco)

## LER PRIMEIRO — 2026-09-24
Fase 1 do rollout 1.1.0: fonte normativa do fluxo (11 arquivos). Tasks T1→T2→T3→T4 seriais neste worktree (ruling F1-R1). Baseline verde: 77 gates + 148 hooks. Pendências (b): T10 instala `fluxo.md`; T22 copia `templates/fluxo/`.

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
|---|---|---|
| T2 × T3 | nomes/ordem dos 8 tipos e campos em `fluxo.md §2` × `## <Campo>` dos templates | ok — T3 declara dependência de T2 |
| T2 × T4 | chaves `fluxo.status` em `fluxo.md §4` × `statusSugerido` | ok se T2 gravar as chaves do contrato |
| T2 × mestre | grafia `MOVIMENTO FL2 <EPIC> <de>→<para> <data>` | emendada em f1 l.461 antes do dispatch |
| T4 × fase 5 | campos camelCase | alinhado (#1) |

## Rulings de pre-flight
F1-R1 — tasks seriais no worktree único — motivo: skill SDD proíbe implementadores paralelos no mesmo checkout — custo-se-errado: ~20 min.
F1-R2 — spec, planos e `.gitignore` no primeiro commit (`3b427db`) — motivo: brainstorming manda commitar o design — custo-se-errado: um commit a reverter.

## Progresso

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

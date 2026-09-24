# Ledger — PBI: GM-2 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-2-gates.md   Branch: enabler/GM-2-gates @ 6c0a38f   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
Rulings herdados: R1, R2, R21, F1-R1   Contexto externo: nenhum (sem sandbox, sem banco; fixtures em tmpdir)

## LER PRIMEIRO — 2026-09-24
Fase 2 do rollout 1.1.0: os 4 scripts novos, 8 checagens do doctor, `instalar.sh --atualizar`, `package.json` 1.1.0. Fase 1 integrada em `main` (PR #1, `6c0a38f`). Tasks T5→T6→T7→T8→T9→T10→T11 seriais neste worktree. Baseline verde: 77 gates (50 mjs + 27 ts) + 148 hooks. Contrato do mestre é lei; decisões 1–8 do plano são (b) até o review.

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
|---|---|---|
| T5 × T8 | T5 grava seções em `harness.config.json` · T8 lê o mesmo arquivo (JSON inválido sem crash) | disjuntos em código; formato = contrato |
| T7 × T8 | T7 exporta `checar(root, opts)` · T8 importa para a checagem `versionamento` | T7 antes de T8 |
| T6 × T9 | T6 `calcularSlots`/`medir` · T9 consome `slots` | T6 antes de T9 |
| T8 × T9 | T8 `--json --cache` · T9 executa o doctor do plugin quando o cache vence | T8 antes de T9 |
| T9 × fase 1 | frontmatter `epic:` (PBI) / `iniciativa:` (Epic) | fase 1 gravou assim; T9 lê `epics/<epic>.md` para a Iniciativa (emenda #5) |
| T10 × T11 | `instalar.sh` · `gates/package.json` | disjuntos; T11 por último (contenda) |

## Rulings de pre-flight
F2-R1 — tasks seriais no worktree único (mesmo motivo de F1-R1) — custo-se-errado: ~1 h de parede.
F2-R2 — modelo por task: haiku em T5/T6/T7/T11 (código completo no plano, arquivos novos); sonnet em T8/T9/T10 (modificam arquivo existente ou integram vários) — custo-se-errado: rodada extra de correção.

## Progresso

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

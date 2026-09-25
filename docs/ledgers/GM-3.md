# Ledger — PBI: GM-3 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-3-hooks.md   Branch: enabler/GM-3-hooks @ 3143d38   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
Rulings herdados: R1, R2, R21, F1-R1, F2-R1..R11   Contexto externo: nenhum (hooks testados contra scripts falsos em tmpdir)

## LER PRIMEIRO — 2026-09-24
Fase 3 do rollout 1.1.0: `_common.sh` generalizado (T12), `guard-versioning.sh` R20 (T13), `session-card.sh` (T14), `remind-orchestrator.sh` (T15), `hooks.json` (T16). Fase 2 integrada em `main` (PR #2, `3143d38`). Baseline medida: gates 236 mjs + 27 ts · instalador 70 ok · hooks 148.
Ordem: T12 → (T13 em worktree próprio ‖ T14 → T15 neste worktree, conforme slots medidos) → T16 sozinha. Emendas da fase 2 valem: `GABARITO_PID_RAIZ=$PPID` e `--plugin-root` sempre.

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
|---|---|---|
| T12 × T13/T14/T15 | T12 cria `gabarito_escape_hatch`, `gabarito_repo_root`, `gabarito_config_get`, `gabarito_ere`, `gabarito_strip_write_heredocs` e os helpers de teste `cleanEnv`/`runAt`/`fixtureRepo`/`runCommon` · os três consomem | T12 antes de todas |
| T14 × T15 | T14 cria o helper de teste `fakePluginRoot` (com `capacidade`) · T15 usa | T15 depois de T14 |
| T13 × T14/T15 | todos acrescentam `describe` ao fim de `guards.test.mjs` e linhas M6–M13 no cabeçalho | contenda textual só; união resolve |
| T13–T15 × T16 | três scripts · `hooks.json` os registra | T16 por último, sozinha |
| T14 × emenda fase 2 | script do plano chama `cartao-sessao.mjs` sem `GABARITO_PID_RAIZ` | lacuna → F3-R1 |
| T15 × emenda fase 2 | script do plano chama `capacidade.mjs` sem `GABARITO_PID_RAIZ` | lacuna → F3-R2 |
| T12..T16 (texto próprio) | cada task manda commitar `docs/ledgers/GM-3.md` junto | conflito com execução paralela → F3-R4 |

## Rulings de pre-flight
F3-R1 — T14 exporta `GABARITO_PID_RAIZ=$PPID` antes do `node` e ganha teste (script falso ecoa a variável; tem de ser o PID de quem chamou o hook, não o bash do hook) — emenda da fase 2 vence o texto do plano — custo-se-errado: um teste a mais.
F3-R2 — T15 idem para `capacidade.mjs` (sem isso `process.ppid` é o bash do hook e o Claude Code conta como pesado) — custo-se-errado: um teste a mais.
F3-R3 — paralelismo: T13 roda em worktree/branch próprio a partir da cabeça de T12, em paralelo com T14→T15 neste worktree, **só se** `capacidade.mjs` medir slots ≥ 2 no dispatch (pedido do usuário: velocidade sem estourar o MacBook); com slot 1, serial T13→T14→T15. T13 integra por rebase feito pelo próprio implementador (resolução por união) — custo-se-errado: um rebase com conflito textual.
F3-R4 — implementadores não tocam `docs/ledgers/GM-3.md`; o orquestrador o atualiza e commita após cada review — custo-se-errado: nenhum.
F3-R5 — modelos: sonnet em T12–T15 (bash com comportamento a preservar/integrar), haiku em T16 (JSON + testes transcritos) — custo-se-errado: rodada extra.

## Progresso
Task T12: DONE (sonnet; fd9fd2d feat, 06ce11f test). Hooks 148 → RED 151/157 → GREEN 157 → 158 após correção. `_common.sh` 6→9 funções; fallback jq→node→python3 3/3 medido; instalador 70 ok. Review adversarial (sonnet): M1, M3, M4, M5 + 2 próprias derrubaram; 1 BLOCKER — a validação do nome da VAR antes do `eval` não tinha teste (o teste com espaço passava por word-splitting; payload com `${IFS}` executava código com a validação removida). Corrigido com teste de sentinela em tmpdir; re-review confirmou por mutação (158→157, cai só o teste novo). M2 não derruba mais (linha redundante com a checagem de tamanho); cabeçalho de mutações ajustado. Capacidade medida no fim: slots 1 (4 pesados) → T13 serial (F3-R3).

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

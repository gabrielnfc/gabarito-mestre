# Ledger — PBI: GM-5 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-5-skills.md   Branch: enabler/GM-5-skills @ d2c47af   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md
Rulings herdados: R1, R2, R3, R16, R18, F2-R8, F3-R1..R8, F4-R1..R10          Contexto externo: nenhum (só texto; sem banco, sem rede)

## LER PRIMEIRO — 2026-09-25
Fase 5: T22 (gabarito-instalar) · T23 (gabarito-conformidade) · T24 (agente implementador + comando doctor) — paralelas no grafo, seriais aqui enquanto `capacidade.mjs` der slot 1.
Fases 1–4 integradas em `main` (PR #4, `d2c47af`). Pré-condições medidas: `fluxo.md` 7 seções · 8 cards · 4 scripts · 3 templates novos · `ferramentas-mcp.json` · "Isolamento: porta"=1 · "antes de despachar"=1 · "Áreas e donos"=1 · "R30+"=1 · `onboarding-config.mjs` sem `--set` sai 1 · slots 1 (7 pesados).
Handoff da fase 4 (`docs/ledgers/GM-4.md`): C10 → T23; m8 → T24; m6 e m10 entram nesta fase (F5-R6, F5-R7); m7 e o resto → T25.

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
|---|---|---|
| T22 × T9 | SKILL cita `cartao-sessao.mjs` e `--vincular` × cartão lê `.harness/fluxo-cache.json` | formato do cache é o do contrato |
| T22 × T5 | SKILL chama `onboarding-config.mjs --set/--settings` × CLI do contrato | flags ok; a saída ONB-7 no stdout (F2-R8) não está no brief → F5-R5 |
| T22 × Emenda #8 do mestre | `vinculoPbiEpic` é objeto `{tipo, nome}` × brief usa string (`"<resposta 5>"`, `"frontmatter"` no exemplo de verificação) | → F5-R5 |
| T22 × T21 (fase 4) | skill instala `PULL_REQUEST_TEMPLATE.md`, `CHANGELOG.md`, `backlog.md` (o `instalar.sh` não copia) × templates existem | ok |
| T22 × m10 (fase 4) | `templates/gabarito.yml` fixa `--base origin/main` × trunk `master` reprova sempre | → F5-R7 |
| T23 × T2 | conformidade cita `fluxo.md §n` × seções de `fluxo.md` | 7 seções, ordem FLX-1 |
| T23 × handoff C10 (fase 4) | texto "as skills do gabarito não refazem o que superpowers faz" tem de entrar na SKILL × brief não o traz | → F5-R4 |
| T24 × T20 | agente copia bloco Isolamento × `prompts.md` | cópia verbatim (Emenda #4), `diff` do bloco |
| T24 × m8 (fase 4) | prompts supõem worktree em todo dispatch × `referencia.md §3.1` só no paralelo | → F5-R6 |
| pré-condição do plano | `grep -c "Antes de despachar"` (maiúscula) = 1 × cabeçalho real "antes de despachar" | → F5-R8 |

## Rulings de pre-flight
F5-R1 — modelos (usuário: só opus e sonnet): opus em T22 (onboarding em quatro fases, maior juízo) e no review final; sonnet em T23, T24(+b) e nos reviews por task — custo-se-errado: uma rodada extra.
F5-R2 — T22–T24 em worktrees `wt/GM-5-<n>` só com slots ≥ 2 no dispatch; slot 1 → serial T22 → T23 → T24 neste worktree — custo-se-errado: tempo de relógio.
F5-R3 — implementadores não tocam `docs/ledgers/GM-5.md`; o orquestrador atualiza após cada review — custo-se-errado: nenhum.
F5-R4 — T23 cola o bloco C10 (handoff da fase 4, texto no plano da fase 4, "Handoff para as Fases 5 e 6"), adaptando "as skills" para "esta skill" — REQ-PKG-2: texto que saiu do núcleo tem destino — custo-se-errado: parágrafo a mais na skill.
F5-R5 — T22: (a) depois de cada `onboarding-config.mjs --set`, a skill decide pelo stdout — `[ONB-7] … atualizado` é sucesso; `[ONB-7] harness.config.json NÃO escrito — JSON inválido (fail-open declarado, G9)` e exit 1 fazem a skill parar, mostrar o stderr e corrigir (F2-R8, Emendas #11/#12); (b) `vinculoPbiEpic` é gravado como objeto `{ "tipo": "campo|relacionamento|frontmatter", "nome": "…" }` (Emenda #8 do mestre), inclusive no exemplo de verificação — custo-se-errado: onboarding que grava a forma velha e o cartão lê a nova.
F5-R6 — T24 ganha: (a) m8 — o bloco Isolamento do agente vale quando o dispatch é num worktree `wt/<PBI>-<n>` (paralelo); dispatch serial no checkout do orquestrador não usa porta/schema próprios (uma linha, sem mexer no bloco verbatim); (b) T24b — `templates/PULL_REQUEST_TEMPLATE.md` passa a listar `release` e `revert` entre os tipos sem PBI (m6; `tiposLivres` do contrato) — custo-se-errado: uma linha em cada arquivo.
F5-R7 — T22, fase 3 do onboarding (versionamento): se o trunk detectado não é `main`, a skill mostra a troca de `--base origin/main` por `--base origin/<trunk>` em `.github/workflows/gabarito.yml` e aplica com `Edit` só com ok (arquivo criado pela fase 1 do mesmo onboarding; R2 respeitado se já existia antes, aí só avisa) — m10 — custo-se-errado: CI do usuário com trunk `master` reprovando até ele editar.
F5-R8 — a pré-condição "Antes de despachar" com maiúscula não casa porque o cabeçalho canônico (fase 4, T20) é minúsculo; conferido com `grep -ci` = 1 — custo-se-errado: nenhum.
F5-R9 — trailer dos commits: `Co-Authored-By: Claude Opus 5.5 (1M context)` + `Claude-Session` (mesmo motivo de F4-R5) — custo-se-errado: atribuição.

## Progresso

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

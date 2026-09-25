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
Task T5: DONE (haiku; 3f4e7f7 test, b7c34e9 feat, d8bf625 + a3a6061 testes de cobertura). RED→GREEN 0→28 focados; suíte 77→105. Review adversarial (sonnet): M1–M5 derrubaram; 2 mutações próprias não derrubavam (atomicidade, raiz via repositório) → 2 rodadas de correção; re-review confirmou por mutação. Commit de scratch forçado foi desfeito (ruling). Suíte final 105/105.
Task T6: DONE (haiku; bf7a3bf test, c757e6b feat). RED→GREEN 0→32 focados; suíte 105→137. Review adversarial (sonnet) APROVADO: 5 prescritas + 2 próprias derrubaram; medição real da máquina exercida (12 cores). Minors diferidos: linha de ps sem RSS sem teste dedicado; tmpdir sem limpeza.
Task T7: DONE (haiku; 2ca85fb test, e4052f2 feat, c73d18e fix). RED→GREEN 0→31 focados; suíte 137→168. Review adversarial (sonnet): 5 prescritas + 3 próprias derrubaram; 1 Important — `--base` com ref inexistente virava "sem git legível" e o CLI imprimia "ok". Ruling F2-R3: base ausente é FAIL-CLOSED (G9). Corrigido, re-review confirmou por mutação M6 e reprodução manual. Minor diferido: ramos idênticos no catch.
Task T8: DONE (sonnet; 84ca3e0 test, 66bdacc feat, d26f7d0 test). RED→GREEN focados 0→44; suíte 168→196. Review adversarial (sonnet): M4–M9 + 2 próprias derrubaram; 1 Important (linha "checagens novas" sem teste de ausência) corrigido e confirmado por M10. Doctor não se autodetecta neste repo (medido). Minors diferidos: `checar()` relê config do disco (herdado de T7); seção "Avisos" sempre renderizada.
Task T9: DONE (sonnet; 072c7db test, 344e35f feat). RED→GREEN 0→39 focados; suíte 196→235. Review adversarial (sonnet) APROVADO: 8 prescritas + 3 próprias; doctor travado degrada para "indisponível" em ~20 s (medido). Desvio aceito: realpath antes de invocar o doctor. Achado herdado: guard de entrypoint dos 8 scripts falha atrás de symlink → Ruling F2-R4: task extra T9b corrige na fonte com teste via symlink. Minor diferido: cap de 40 linhas é código morto (máximo real ~13).
Task T9b (extra, ruling F2-R4): DONE (sonnet; 0500d88 test, b3ea4ad fix). RED 8/8 provou o bug nos 8 scripts (inclusive os 4 da 1.0.1); GREEN 16/16; suíte 235→251. Review APROVADO: M1/M2 derrubam exatamente o script mutado; teste discrimina também em Linux (symlink explícito).
Task T10: DONE (sonnet; caf5dae test, bad3734 feat). RED 16 ok/22 falhas → GREEN 38 ok. Review APROVADO: 6 prescritas + 2 próprias derrubaram (1 própria não caiu por o Mac ter `sha256sum` além de `shasum` — ambiente, não código); bash 3.2 puro confirmado; idempotência e `set -e` do doctor verificados em execução real. Ruling F2-R5: `ferramentas-mcp.json` não é instalado no repo do usuário (skill lê do plugin). Minor diferido: escape parcial no sed do manifesto.
Task T11: DONE (haiku; 65d809e test, 7f05515 feat). package.json 1.1.0, 8 bin, zero deps. Gate da fase medido: 8 scripts · NOVAS_1_1_0 8 · CHECKS 27 · npm test 229 mjs + 27 ts = 256 · instalar.test.sh 38 · guards 148 · validate --strict ok · doctor sem autodetecção.
Nota de processo: este ledger foi restaurado ao commit inicial por um subagente durante T11 (provável `checkout` amplo); reconstruído a partir do ledger scratch (`.superpowers/sdd/…/progress.md`), que é a fonte de recuperação. Ruling F2-R6: implementadores só podem `checkout --` os próprios arquivos — reforçado nos dispatches seguintes.

Review final da branch (fable): COM CORREÇÕES. C1 — upgrade 1.0.1→1.1.0 deixava `tools/gabarito-gates` misto (1.0.1 nunca gravou manifesto; instalador recusava substituir) e o CI do usuário vermelho. I1 — cache do doctor vencido rotulado "recalculado agora" quando o doctor falha. I2 — git ilegível contava `versionamento` como found. I4 — ONB-7 fail-open só em stderr. M1–M9 (datas UTC, `--branch --json`, cache não atômico, etc.).
Rulings: F2-R7 git ilegível → `found:false` (G9 vence o plano T8) · F2-R8 ONB-7 alvo inválido: exit 0 + linha explícita no stdout · F2-R9 upgrade: hashes da 1.0.1 embarcados em `gates/.hashes-anteriores`, idêntico entra no manifesto, `test/` novos vão para `.novo` se algum gate divergir e não for substituído · F2-R10 datas gravadas em fuso local.
Para as fases seguintes: fase 3 — hook exporta `GABARITO_PID_RAIZ=$PPID` e sempre passa `--plugin-root`; fase 6 — default de `--plugin-root` na cópia instalada, raiz por cwd nos 3 scripts 1.0.1, `plugin.json` 1.0.1 até T25, `ledger-versionado` aceita arquivo não versionado, CHANGELOG avisa queda de nível dos repos 1.0.1; contrato — `versionamento-check` sem `resolvidoEm` diz "repo sem onboarding".

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

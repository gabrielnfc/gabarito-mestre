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
Task T17: DONE (opus; f747864). `AGENTS.md` = bloco 17.3 do plano, 18.545 B: núcleo 17.244 (teto 17.291) · Apêndice 1.301 (teto 4.096), por `tamanhoAgents` e por medição independente. Corte de §9 (passo 9) não foi necessário. Greps dos passos 3–6 e 11 todos no esperado; R1–R21, I1–I12, G1–G9 presentes; gates 238 + 27. Cortes C1–C12 com texto literal conferido contra `f747864~1` (C1 → `adocao.md §1`; C2–C7 → `referencia.md`; C8, C9, C12 sem destino por redundância; C10 → T23; C11 → T25). Review (sonnet) APROVADO: mutações 1, 2 e 8 do fecho derrubam `tamanhoAgents`/grep; duas próprias não são pegas por nenhum grep (esvaziar o texto de I11 mantendo o rótulo; citar `versionamento-checker.mjs` inexistente).
Ruling F4-R7 — os dois gaps de cobertura não voltam para T17 (o diff está certo; falta checagem): viram insumo para o `ci.yml` de T25 — conferir texto mínimo de cada R/I/G, não só o rótulo, e que todo `*.mjs`/`*.sh` citado no `AGENTS.md` existe no plugin — custo-se-errado: uma regra esvaziada passa até T25.
Task T18: DONE (sonnet; 1596b4b). `referencia.md` 29.787 → 43.496 B (sem teto declarado). Greps do passo 4 no esperado; as 7 frases migradas de T17 presentes 1× cada; os 7 ponteiros do `AGENTS.md` para `referencia.md` (§2, §3.1, §3.4, §3.5, §5, §10, §11) e os 2 para §12 resolvem. Desvio aceito: §11/§12 seguem o texto do plano (rótulos "R2 — … (G3)"), com as frases de C2–C5 intactas. Review (sonnet) APROVADO: mutações 3 e 4 do fecho + 2 próprias derrubaram o grep; linhas do ledger em §2.3 batem com os regex de `lerLedger` (`cartao-sessao.mjs:107-132`). Ponteiros para frente (`PULL_REQUEST_TEMPLATE.md`, `squash-titulo-pr`) fecham em T21.
Capacidade antes de T19–T21: slots 1 (5 pesados, load 2,69) → serial (F4-R2). Para ganhar tempo sem perder review, T19+T20 foram a um só implementador, com um commit por task e review com veredito por task.
Task T19: DONE (sonnet; 464266b). `adocao.md`: C1 em §1 "Medição", escada alinhada ao doctor (Emenda #9), "MCP demais no contexto", §5 reescrito com `--codeowners` e marcador (Emenda #8). Greps: "pessoa sênior"=0 · "MCP demais no contexto"=1 · `--explain`=1 · "ownership por área"=1 · 6 seções.
Task T20: DONE (sonnet; 2099ca9). `prompts.md`: Implementador com "Isolamento: porta <3000+n> · schema <wt_n> · namespace <wt-n> — não use outro" (T24 procura essa string) e R20; novo "Orquestrador — antes de despachar" com `capacidade.mjs --json`, DISPATCH, BLOQUEADA, passos 9 e 10 (Emenda #18) e grafia canônica de MOVIMENTO (Emenda #2; grafia antiga = 0). Nenhuma proibição removida.
Review T19+T20 (sonnet) APROVADO nas duas: mutação 5 do fecho + 4 próprias derrubaram; formatos batem com `lerLedger`, níveis com `harness-doctor.mjs`, marcador com `instalar.sh:183-187`. Minors diferidos (insumo para o CI de T25): trocar "opcional" do `tag-semver` na escada não é pego por grep; o grep de `preparado→em_execucao` sozinho não pega a remoção do passo 9.

## CORTE DA SESSÃO (com motivo)

## FECHO — PR mergeada

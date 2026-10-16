# Ledger GM-7 — hotfix 1.1.1 (segurança: orquestrador × subagente, MCP, segredos)

**Branch:** `fix/GM-7-hotfix-seguranca` · **Worktree:** `.claude/worktrees/fix+GM-7-hotfix-seguranca` · **Dono:** Gabriel

## Estado

| Item | Estado | Onde |
|---|---|---|
| Spec | **r23** — r21 aprovada (3/3 Fable, 0 achado, ok do dono); r22 = E1–E7 (R3); r23 = exceção de HOME (R4); r24 = E8/E9 (R5) | `docs/superpowers/specs/2026-10-15-hotfix-1.1.1-design.md` (histórico r0–r23 em §8) |
| Plano-mestre | r4 (commit c7faa51); rodadas Fable: r1 REPROVADO, r2 REPROVADO (1 MAJOR 5 MINOR), r3 REPROVADO (2 MINOR de documentação) — em emenda | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1.md` |
| Planos de fase | r4 (commit c7faa51). F3 **APROVADO** na rodada 2 (0 achado). F1 r2: 2 MINOR (corrigidos); F2 r2: 2 MAJOR 5 MINOR (corrigidos, rodada 3 em curso); F4 r2: 1 MAJOR 5 MINOR (corrigidos; r3 só o MINOR de contrato do mestre) | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1-fase-{1-base,2-segredos,3-guardas,4-integracao}.md` |
| Implementação | Não iniciada | — |

## HANDOFF (2026-10-15, atualizado na sessão 2)

Próximos passos, nesta ordem:

1. Planos escritos (950372b) e emendados até r4 (c7faa51); spec em r23 + MH149 (rulings R3, R4; decisão F2-20).
2. Retomar na rodada de review: zerar os achados abertos (delta), depois review completo por instâncias novas do Fable.
3. Review dos planos (mestre + fases) no **Fable**; só passa com **0 achado** (BLOCKER, MAJOR e MINOR). Repetir emenda + review do delta até zerar; terminar com um review completo por instância nova.
4. Pedir o ok do dono no plano e o método de execução (recomendado: subagent-driven, implementador opus, revisor fable por task).
5. T0 (spike M-A..M-E) antes de qualquer código; resultados aqui e em `hooks/lib/medicoes.mjs`.

## Regras do dono para esta entrega

- Reviews de spec, plano e task **sempre no modelo mais potente (Fable)**.
- Spec/plano só passam com **0 achado**; MINOR não vira "residual de plano".
- Comunicação em português do Brasil.

## Rulings

- R1 (2026-10-15): pivô D9 — subagente em lista branca, orquestrador em lista negra contra acidente (aprovado pelo dono após r5).
- R2 (2026-10-15): mantida a entrega única (sem dividir em duas PRs); dono aprovou a spec r21 com "ok".
- R3 (2026-10-15): spec r22 — dono aprovou E1, E3, E4, E5, E6 como propostas; E2 pelo lado A (l.86 mantida; casos de l.183 viram `grep -rn --null`/`rg --hidden -0`); E7 ratificada (`-o` não é flag de saída em ferramentas de busca). Origem: conflitos internos da spec achados no review Fable dos planos (rodada 1). Detalhe em spec §8.
- R4 (2026-10-15): spec r23 — fora de git, `cwd` = `$HOME`, ancestral de `$HOME` ou `/` não dá escopo de escrita a S (REQ-H0-5; MH148 em §6 H0-5). Origem: A19 da emenda do plano da fase 3. Escopo de leitura inalterado (segredos seguem cobertos por H3).
- R5 (2026-10-16): spec r24 — E8 ampla (ambiente no prefixo ou exportado antes no mesmo comando, fora da lista sempre-aceita, antes de ferramenta de H3-8/H3-9 (a) ⇒ deny sem replay; promove F2-20) e E9 (wrappers `env|command|builtin|exec|time|nice|nohup|timeout|stdbuf|sudo` desembrulhados em H3 e H4, O e S; opção desconhecida ⇒ ilegível; H7 inalterado). MH150 (E8), MH151 (E9). Origem: review Fable rodada 3 da fase 2.
- Decisão de plano F2-20 (2026-10-15, orquestrador; spec omissa, alinhada a l.85): no replay de H3, só atribuições `CI|NODE_ENV|FORCE_COLOR|NO_COLOR|TZ|LANG|LC_ALL` no prefixo do segmento; outra ⇒ deny sem replay (custo: `IFS=: grep -rn x src` nega). Comunicada ao dono, que pode promovê-la a emenda E8.
- Nota (falso positivo para a 1.2.0): aplicar E5 por `sed` no Bash foi barrado pela R3 da 1.1.0 por **menção** a host `*.prod.*.com` dentro de texto de script; contornado com Edit.

## Medições (Task 0)

| # | Pergunta | Resultado | Data |
|---|---|---|---|
| M-A | `ask` chega em auto mode (Bash, Write, Edit, WebFetch)? | — | — |
| M-B | `fork`/`Workflow` trazem `agent_id`? | — | — |
| M-C | worktree: `--git-common-dir` aponta o principal? | — | — |
| M-D | `tool_name` reais de subagente no PreToolUse `.*` | — | — |
| M-E | `CLAUDE_CODE_EXECPATH` + `ARGV0=rg` responde como ripgrep? | — | — |

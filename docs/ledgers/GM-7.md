# Ledger GM-7 — hotfix 1.1.1 (segurança: orquestrador × subagente, MCP, segredos)

**Branch:** `fix/GM-7-hotfix-seguranca` · **Worktree:** `.claude/worktrees/fix+GM-7-hotfix-seguranca` · **Dono:** Gabriel

## Estado

| Item | Estado | Onde |
|---|---|---|
| Spec | **r23** — r21 aprovada (3/3 Fable, 0 achado, ok do dono); r22 = E1–E7 (R3); r23 = exceção de HOME (R4) | `docs/superpowers/specs/2026-10-15-hotfix-1.1.1-design.md` (histórico r0–r23 em §8) |
| Plano-mestre | Escrito; review Fable rodada 1 **REPROVADO** (transversal: 1 BLOCKER, 4 MAJOR, 2 MINOR) — em emenda | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1.md` |
| Planos de fase | Escritos (commit 950372b); review Fable rodada 1 **REPROVADO** em todas (F1: 1 MAJOR 6 MINOR; F2: 2 BLOCKER 4 MAJOR 4 MINOR; F3: 5 MAJOR 5 MINOR; F4: 1 BLOCKER 2 MINOR) — em emenda | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1-fase-{1-base,2-segredos,3-guardas,4-integracao}.md` |
| Implementação | Não iniciada | — |

## HANDOFF (2026-10-15, sessão encerrada a ~60% de contexto)

Próximos passos, nesta ordem:

1. Ler o plano-mestre inteiro e as seções §3, §4 e §6 da spec (a spec tem ~94 KB: ler em partes com offset/limit).
2. Escrever os 4 planos de fase com `superpowers:writing-plans`, código TDD completo por passo, seguindo **exatamente** o contrato de interfaces do plano-mestre. Sugestão: despachar 4 subagentes (opus) em paralelo, um por fase, cada um com ponteiros (plano-mestre + spec:linhas + arquivos do código atual), nunca conteúdo copiado.
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

# Ledger GM-7 — hotfix 1.1.1 (segurança: orquestrador × subagente, MCP, segredos)

**Branch:** `fix/GM-7-hotfix-seguranca` · **Worktree:** `.claude/worktrees/fix+GM-7-hotfix-seguranca` · **Dono:** Gabriel

## Estado

| Item | Estado | Onde |
|---|---|---|
| Spec | **r21 aprovada** — 3/3 revisores Fable com 0 achado; ok do dono em 2026-10-15 | `docs/superpowers/specs/2026-10-15-hotfix-1.1.1-design.md` (histórico das 22 rodadas em §8) |
| Plano-mestre | Escrito (contrato de interfaces, tasks T0–T14, mapeamento REQ → §6 → MH, Review Focus) — **ainda não revisado** | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1.md` |
| Planos de fase | **A escrever** (4 arquivos, listados no plano-mestre) | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1-fase-{1-base,2-segredos,3-guardas,4-integracao}.md` |
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

## Medições (Task 0)

| # | Pergunta | Resultado | Data |
|---|---|---|---|
| M-A | `ask` chega em auto mode (Bash, Write, Edit, WebFetch)? | — | — |
| M-B | `fork`/`Workflow` trazem `agent_id`? | — | — |
| M-C | worktree: `--git-common-dir` aponta o principal? | — | — |
| M-D | `tool_name` reais de subagente no PreToolUse `.*` | — | — |
| M-E | `CLAUDE_CODE_EXECPATH` + `ARGV0=rg` responde como ripgrep? | — | — |

# Ledger GM-7 — hotfix 1.1.1 (segurança: orquestrador × subagente, MCP, segredos)

**Branch:** `fix/GM-7-hotfix-seguranca` · **Worktree:** `.claude/worktrees/fix+GM-7-hotfix-seguranca` · **Dono:** Gabriel

## Estado

| Item | Estado | Onde |
|---|---|---|
| Spec | **r26** — r21 aprovada (3/3 Fable, 0 achado, ok do dono); r22 E1–E7 (R3); r23 HOME (R4); r24 E8/E9 (R5); r24.1 git (R6); r25 acidente × disfarce (R7) e fgrep/zgrep (R8); r26 S1–S6 (R10) | `docs/superpowers/specs/2026-10-15-hotfix-1.1.1-design.md` (histórico r0–r26 em §8) |
| Plano-mestre | r11 (66a46c8); review completo final Opus (R9) REPROVADO → emendado; rodada 8 (Opus): 8 MINOR — em emenda |
| Planos de fase | r11 (66a46c8); rodada 8 (Opus): F1 5 MINOR; F2 2 MAJOR 4 MINOR; F3 1 MAJOR 4 MINOR — em emenda |
| Implementação | Não iniciada | — |

## HANDOFF (2026-10-16, sessão 2 — parada por falta de créditos do Fable)

Próximos passos, nesta ordem:

1. Planos escritos (950372b) e emendados até r8; spec r25 (rulings R3–R8; F2-20 promovida a E8). A partir da r25 os revisores classificam cada vetor como acidente (cobre) ou disfarce (§5-2 para O, R7).
2. Review completo final (Opus, R9) feito em 8916ad0: REPROVADO (F1 3 MAJOR; F2 5 MAJOR; F3 1 MAJOR; F4 1 BLOCKER; transversal 1 MAJOR) — achados em scratchpad `achados-final.md` (resumo nesta linha). Em emenda: spec r26 (R10) + 5 planos. Depois: review do delta (Opus) até zerar e novo review completo final (Opus).
3. Review dos planos (mestre + fases) no **Opus** (R9/R10; Fable sem créditos); só passa com **0 achado** (BLOCKER, MAJOR e MINOR). Repetir emenda + review do delta até zerar; terminar com um review completo por instância nova.
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
- R6 (2026-10-16): spec r24.1 — E8 em `git` só nos subcomandos que H3 lê (`git grep`, `git add` amplo, produtores de REQ-H3-9 (a)); `GIT_PAGER=cat git log`, `GIT_AUTHOR_NAME=x git commit` permitidos.
- R7 (2026-10-16): critério de convergência para O (D9 "contra acidente"): forma que agente escreve por acidente é coberta; composição deliberada (`set -a`+`declare`, `eval "export …"`, `exec N<`+`read -u N`, grupo em subshell com `<`, `echo . | xargs grep -r`, alias/função antes) é limite §5-2 para O e deny para S (lista branca). Revisores classificam antes de achar.
- R8 (2026-10-16): `fgrep`/`zgrep` entram em REQ-H3-8 e E8 (spec r25).
- R9 (2026-10-16): créditos do Fable esgotados no review completo final; dono autorizou o review final no segundo modelo mais forte disponível (Opus 5.5). Exceção pontual à regra "review sempre no Fable".
- R10 (2026-10-16): spec r26 — S1 instalador grava `producao`/listas por `--set-arquivo` (sem valor no comando; R3 × REQ-H6-4); S2 comparação sem caixa no macOS (escopo, alvos de config, segredo; `realpathSync.native`); S3 REQ-H4-3 += `sed` com `i` em grupo, `git rm|mv`, `unlink`, `patch`, operandos de `git -C`; S4 `rg --hostname-bin` sem replay; S5 `xargs`/`while read` alimentados por `<` ou here-string seguem REQ-H3-9; S6 `fgrep|zgrep` em REQ-H0-10 e na exceção de `-o`. MH152–MH157. Origem: review completo final (Opus, R9). Revisor até o fim: Opus.
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

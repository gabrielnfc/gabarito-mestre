# Ledger GM-7 — hotfix 1.1.1 (segurança: orquestrador × subagente, MCP, segredos)

**Branch:** `fix/GM-7-hotfix-seguranca` · **Worktree:** `.claude/worktrees/fix+GM-7-hotfix-seguranca` · **Dono:** Gabriel

## Estado

| Item | Estado | Onde |
|---|---|---|
| Entrega | **ARQUIVADA (R13, 2026-10-18)** — tag `archive/GM-7`; spec e planos preservados só na tag; guarda reaproveitada pela 2.0 | `git show archive/GM-7` |
| Spec | **r27.1** — r21 aprovada (3/3 Fable, 0 achado, ok do dono); r22 E1–E7 (R3); r23 HOME (R4); r24 E8/E9 (R5); r24.1 git (R6); r25 acidente × disfarce (R7) e fgrep/zgrep (R8); r26 S1–S6 (R10); r27 replay de git restrito (R11) | `docs/superpowers/specs/2026-10-15-hotfix-1.1.1-design.md` na tag (histórico r0–r27 em §8) |
| Plano-mestre | r15 — arquivado | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1.md` na tag |
| Planos de fase | r15; rodada 11 emendada em F1/F3/F4/mestre; F2 sem a rodada 11 — arquivados | `docs/superpowers/plans/2026-10-15-hotfix-1.1.1-fase-{1-base,2-segredos,3-guardas,4-integracao}.md` na tag |
| Implementação | Não iniciada; não será | — |

## HANDOFF (2026-10-18, sessão 2 encerrada — DONO DECIDIU PIVOTAR; discutir em sessão nova)

**Resolvido na sessão 3 (2026-10-18):** pivô ouvido, destino decidido — R13. O texto abaixo é histórico.

**Pivô:** em 2026-10-18 o dono disse que "resolveu pivotar tudo" e quer discutir em sessão nova. O conteúdo do pivô ainda NÃO foi dito. Nada abaixo deve ser executado antes dessa conversa; a primeira ação da próxima sessão é ouvir o pivô e decidir o destino deste trabalho (aproveitar, reduzir escopo ou arquivar).

**Onde o trabalho parou (para avaliar o que aproveitar):**
- Spec r27.1 (`docs/superpowers/specs/2026-10-15-hotfix-1.1.1-design.md`, 251 linhas, MH1–MH158; rulings R1–R12 na seção Rulings; histórico em §8). Numeração das l.1–249 estável desde a r25 (regra: emenda nunca insere linha antes de §8).
- Plano-mestre + 4 planos de fase em r15 (commit do handoff): rodada 11 (delta, Opus) emendada nas fases 1, 3, 4 e mestre; **fase 2 NÃO recebeu a rodada 11** (corretor interrompido no handoff). Pendências da fase 2: (1) `RE_CONFIG_RISCO` só `core.fsmonitor` com caminho (r27.1) e testes allow com `filter.lfs`/`gpg.ssh.program` globais; (2) `LS_FILES_ARVORE` com prefixos de longas (`--mod`, `--del`); (3) casos `ls-files -k|-u|--debug|--killed|--unmerged`; (4) `git grep --ext-grep` deny; (5) regex única do jq `(?<![.\w$])env(?!\w)|\$ENV|(?<![.\w$"])(?:include|import)\b` exportada de `segredos.mjs` (a fase 3 já consome por stub); (6) texto/código morto de `ENV_GIT_SEGURO`/`GIT_SEM_PROGRAMA_DIFF`.
- Revisor: Opus (R9/R10; Fable sem créditos). Critério R7 (acidente × disfarce) nos prompts. Regra do dono: 0 achado (MINOR inclusive).
- Trajetória do review (delta): rodada 8 = 3 MAJOR/21 MINOR → rodada 11 = 2 MAJOR/15 MINOR; o review completo final (Opus) ainda não passou. Implementação: não iniciada (T0 não rodou).
- Lição para o pivô: o custo veio quase todo de H3 (replay de comandos do usuário/repo para decidir segredo) e do tokenizador de shell — superfície adversarial sem fim; R7 (acidente × disfarce) e R11 (replay de git restrito) foram as decisões que fizeram convergir.

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
- R11 (2026-10-16): spec r27 — replay de git só de `git ls-files` (índice) e `git grep` sem `--textconv|-O`; produtores git que listam nomes e tinham replay até a r26 (`status --porcelain|--short`, `diff|show|log|stash show --name-only|--name-status`, `ls-tree -r --name-only`) e `ls-files` com opção vetada, para abridor ⇒ deny sem replay ((a′)); outros produtores git seguem o item (c) (O allow sem replay, S deny); config do usuário volta ao replay (checagem de risco em todos os escopos); `GIT_SEGURO` com `core.hooksPath=/dev/null`, `diff.ignoreSubmodules=all`, `gpg.*program=/nonexistent`, `GIT_OPTIONAL_LOCKS=0`. MH158. Origem: rodadas 8–10 acharam fsmonitor, filtros, gpg, hook `post-index-change`, submódulos — superfície não convergia.
- R13 (2026-10-18): **entrega arquivada** — dono ratificou "arquivar com reaproveitamento" após ouvir o pivô para o gabarito-mestre 2.0 (mod de Claude Code com orquestrador autônomo; ver ledger da 2.0 quando aberto). Reaproveitado pela 2.0 como guarda de `tool.call`: D9/R1 (S lista branca, O lista negra contra acidente), R7 (acidente × disfarce), R11 (replay de git restrito), listas de deny de H0/H4/H5/H6, medições T0, regra de 0 achado. Reduzido: H3 sem replay de comando (segredo por caminho/padrão + E8). Arquivado: replay de git, tokenizador de shell, as 6 pendências da F2, planos r15. Motivo técnico: o custo veio de simular shell; o mod intercepta `tool.call` tipado antes do shell. Mecânica: tag `archive/GM-7`, branch e worktree removidos, só este ledger segue para `main`.
- R12 (2026-10-18): spec r27.1 — chave de risco da checagem de config antes do replay de git = só `core.fsmonitor` com caminho (medido: `git ls-files` sem opção vetada e `git grep` não rodam filtro/textconv/gpg); tira o falso positivo de git-lfs global e assinatura SSH. `GIT_SEGURO` segue como 2ª camada.
- Decisão de plano F2-25 (2026-10-16, orquestrador; **ajustada pela r27/R11**: config de todos os escopos via `--show-scope`, config do usuário não é anulada, `GIT_SEGURO` ampliado — o texto a seguir é a forma original da rodada 9; spec já exige replay sem efeito colateral): antes de qualquer replay de git, ler a config do repo-alvo com `git config --get-regexp` (não executa nada); chave de risco (`filter.*`, `core.fsmonitor`, `gpg.*`, `log.showSignature`, `diff.*.textconv|command`, `diff.external`) ⇒ deny sem replay; replay com `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` e `-c core.fsmonitor=false -c log.showSignature=false`. Spec l.123 (REQ-H7-3) alinhada editorialmente com S4 (`--hostname-bin`).
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

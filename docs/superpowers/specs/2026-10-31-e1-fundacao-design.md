# E1 — Fundação: guarda por ambiente, diário mínimo, spikes

Iniciativa: gabarito-mestre 2.0 · Epic: E1 · PBI: GM-9 (Enabler)
Data: 2026-10-31 · Visão: `2026-10-31-visao-2.0-design.md` · r3 (r0: 3 BLOCKER, 5 MAJOR, 15 MINOR; r1: 0 BLOCKER, 5 MAJOR, 8 MINOR; r2 verificação diff-only 4/5, residual fechado por regra em D2 — ver ledger GM-9 R4, R6, R8)
Legenda: **(a)** medido/lido · **(b)** a medir · **(c)** decisão do dono ou do redator.

**STATUS.** Hoje (1.1.0): três hooks Bash (`guard-destructive.sh`, `guard-production.sh`, `guard-versioning.sh`) com regex que simula shell, escape hatch `GABARITO_ALLOW_*`, cartão de sessão de 40 linhas só para o modelo. **Esta spec: nada implementado.**

## Objetivo

Trocar a guarda regex por uma guarda **por ambiente** que classifica e mostra, pede confirmação só onde a visão manda e nunca suprime o prompt nativo; começar o diário que E2–E6 leem; responder com número as premissas A1–A4 da visão.

**Meta de forma (c):** o **corte mínimo** (S1, T1–T4, T8) mergeado em `next` em ≤ 7 dias corridos. T5–T7 entram se couberem; senão viram E1b na semana seguinte. Se o corte mínimo não mergear, o processo é revisto antes de E2.

## Fatos medidos (a)

| # | Medição | Resultado | Quando |
|---|---|---|---|
| M1 | CPU dos 3 hooks por comando Bash benigno | 71 ms, ~29 processos | 2026-10-31 |
| M2 | Node vazio nesta máquina | 19 ms | 2026-10-31 |
| M3 | Suíte hooks + gates + instalador, sequencial | ~36 s (hooks 21–23 s) | 2026-10-31 |
| M4 | Hatch textual com motivo "qualquer coisa aqui" | liberou `rm -rf src`; `_DESTRUCTIVE` liberou psql em host prod | 2026-10-31 |
| M5 | Doc hooks: `allow` de hook PreToolUse | "skip the prompt" — suprime o prompt nativo | 2026-10-31 |
| M6 | Doc hooks: `agent_type` | presente em subagent **ou** sessão `--agent`; `agent_id` ausente no orquestrador (spike GM-8 F25) | 2026-10-31 / 2026-10-19 |
| M7 | Doc permissions: regras de caminho | `Write(path)` em deny "never match"; `Read(path)` cobre leituras, `< file` e `cat|sed|tee` reconhecidos; redirecionamento de saída `>` é checado contra `Edit`; padrão sem `./` tem semântica gitignore (qualquer profundidade), `./` ancora no cwd | 2026-10-31 |
| M10 | Doc hooks: `ask` em modo `auto` | "sends the tool call to the permission prompt, and the classifier doesn't decide it" — S1 só precisa medir `bypassPermissions`, `-p` e `SessionStart.systemMessage` | 2026-10-31 |
| M11 | Doc hooks: input traz `permission_mode` | guarda sabe o modo sem heurística | 2026-10-31 |
| M8 | Doc permissions: mod × deny | sem managed settings nem login Team/Enterprise, mod pode aprovar o que `deny` ou hook recusou | 2026-10-31 |
| M9 | Doc permission-modes: `-p` e `dontAsk` | `ask` sem ninguém para responder ⇒ negado | 2026-10-31 |

## Decisões (c, não reabrir sem fato novo)

- **D1 A guarda nunca devolve `allow`.** Faixas `livre` e `mostrar` saem **sem `permissionDecision`** (só evento e `systemMessage`); o fluxo nativo de permissão continua. Rejeitado: `allow` explícito — M5 mostra que suprime o prompt nativo e um `rm -rf` fora do repo passaria sem pergunta.
- **D2 Fonte da config da guarda é `origin/HEAD`.** Ref resolvida por `git symbolic-ref refs/remotes/origin/HEAD` (nunca por `branchPadrao` da árvore local — seria forjável); `guarda.*` e `versionamento.branchPadrao` lidos **do arquivo nessa ref**. Árvore local divergente ⇒ ignorada + `systemMessage`. **Sem remoto, remoto sem `HEAD` resolvível, ref nunca buscada ou arquivo ausente na ref ⇒ tudo ≡ "sem remoto": config local com `permitidos` tratado como vazio**, `systemMessage` e heartbeat `fonte: local`. **Subagent não administra remoto nem refs — regra, não lista:** qualquer `git remote …` (inclui `set-head`), `git fetch …`, `git pull …`, `git update-ref …`, `git symbolic-ref …`, `git config …`, e qualquer `git -c remote.*|url.*|core.hooksPath …`, além de escrita em `.git/config`, `.git/refs/remotes/**`, `.git/packed-refs`, entra no anel de integridade (REQ-GRD-5): `deny` para subagent, `ask` para orquestrador. Subagent em worktree só precisa de `add|commit|status|diff|log|checkout|switch|push <sua branch>`; o orquestrador faz o resto. Plumbing (`hash-object`, `commit-tree`) sem `set-head`/`update-ref` não move `origin/HEAD` e é inofensivo. Limite declarado: orquestrador com aprovação humana no `ask` pode forjar — fora do modelo de ameaça (ameaça é o subagent e o orquestrador *sem* humano). Rejeitado: ler a árvore local — subagent reescreve a config por Bash (`cat >`) e o hatch volta; rejeitado: `origin/<branchPadrao>` com `branchPadrao` local — forjável por `git push HEAD:x`.
- **D3 Sinais fortes embutidos.** `--prod`, `--production`, `--target production`, `--linked`/`--project-ref` casando ref de prod, environment `production`, push/merge em branch de prod ⇒ `prod`; hostname com `prod|production|prd` sem alvo declarado ⇒ faixa `mostrar`, nunca bloqueia. Fora disso, só alvo declarado. Rejeitado: só alvo declarado — FN em `vercel --prod`; rejeitado: regex de nome como deny — FP por menção medidos na 1.1.0.
- **D4 Identidade por `agent_id`.** Subagent = `agent_id` presente. Rejeitado: `agent_type` — M6: também aparece em sessão `--agent`, travaria `prod/escrita` sem orquestrador possível.
- **D5 Um processo Node direto, JS commitado.** `hooks.json` chama `node gates/dist/guarda.js`; `gates/dist/` commitado e CI falha se `dist ≠ build(src)`. Rejeitado: wrapper bash (+40 ms); strip-types em runtime (latência de import não medida).
- **D6 Diário: arquivo por sessão.** `events.<sessao>.jsonl`, cadeia de hash por arquivo, projeção junta por `(ts, sessao)`. Rejeitado: arquivo único — N worktrees em E2 ⇒ conflito de merge.
- **D7 Segredo e integridade: `deny` para subagent, `ask` para o orquestrador.** Em `auto` o `ask` vai ao prompt (M10). Em `bypassPermissions`, `dontAsk` e `-p` (lidos de `permission_mode`, M11) o `ask` seria negado: a guarda devolve `deny` + `systemMessage` "operação em segredo/integridade/prod exige modo `default` ou `auto`; rode nesse modo" — instrução de modo, nunca contorno. Limite declarado: nesses modos `cp .env.example .env` pelo orquestrador não é possível. Rejeitado: deny para todos — `cp .env.example .env` legítimo travaria sem saída (anti-meta da visão).
- **D8 Sem exceção de integridade em E1.** Enablers de CI em subagent ficam para E5 com mecanismo próprio. Rejeitado: `escopo.integridade` via evento do diário — registro forjável = autodeclaração.
- **D9 Gates seguem vendorizados como cópia simples até E5** (pacote `npx`). Exceção com fim declarado.

## Fora de escopo (dono: Gabriel)

Loop autônomo (gatilho: E2) · pouso (E2) · Sombra (E3) · painel/mod (E4) · onboarding novo (E5) · renomeação (E5) · schema do pacote (E5) · enablers de esteira (E5) · exceção de integridade por task (E5) · UI além de `systemMessage` (E4).

## Spikes (Task 0; só S1 bloqueia — T4 não começa sem S1)

- **S1 ‡ (b)** `permissionDecision: ask` em hook PreToolUse chega ao humano em `bypassPermissions`? (`auto` já é fato: M10; `-p` e `dontAsk` negam: M9 — confirmar os três de passagem.) Medir também: `agent_id`/`agent_type` no orquestrador com e sem `--agent`; `systemMessage` em `SessionStart` é exibido ao humano? Se `ask` não chega em `auto`/`bypass`: guarda usa `deny` + `systemMessage` com instrução nesses modos (fallback já decidido).
- **S2 (b)** Pane do mod aceita cor 24-bit por célula? `MessageDisplay` entrega saídas nativas? Só informa E4.
- **S3 (b)** Sob o login do dono: `classic.PreToolUse` de plugin de usuário roda? (= org gerenciada). Mod `tool.check` consegue aprovar o que `permissions.deny` recusou (M8)? Resultado vai ao doctor como aviso.
- **S4 (b)** Slots reais: 2, 3 e 4 subagents em worktrees + `CREATE DATABASE … TEMPLATE` no **Supabase local do true_force** (autorizado pelo dono em 2026-10-31). Cerco: só porta 54322; só bancos `gm_spike_*`, criados e dropados pelo spike; worktrees no scratchpad; zero commit; zero toque em `.env`; limpeza registrada no ledger. **Entrega a fórmula, não um número**: custo por slot (MB de RAM, % de CPU, MB de disco de um subagent + clone de banco) e a regra `slots = f(núcleos, memória livre, carga, disco, custo_por_slot)` que `capacidade.mjs` aplica em runtime em qualquer máquina, recalculada a cada sessão e durante o loop; o resultado no MacBook do dono é só o exemplo que valida a fórmula. Não bloqueia T1–T3.

## Requisitos

**REQ-GRD-1 Ambientes declarados.** `harness.config.json` ganha `guarda.ambientes.{teste,homolog,prod}` com `hosts` (só hostname, nunca URL com credencial), `projetos` (refs gcloud/vercel/supabase), `bancos` (**só host**), `mcps` (prefixo `mcp__…`; o ambiente vale para o **servidor inteiro**), `variaveis` (nomes), `branches` (prod default = `versionamento.branchPadrao`); `guarda.producao.permitidos[]` (padrões de rotina). **`permitidos` não suprime o prompt nativo do Claude Code; só evita o `ask` da guarda** (D1). *Given* seção ausente *When* qualquer chamada *Then* só anéis de segredo e integridade ativos, doctor avisa, nada é negado por ambiente.

**REQ-GRD-2 Classificador puro.** `gates/src/classificar-alvo.ts(entrada, ambientes, contexto)` → `{ambiente, acao: leitura|escrita|execucao, alvo}` com `alvo` **reduzido a host/ref/caminho** (nunca comando cru, nunca URL com credencial). `contexto` é fornecido pelo adaptador, sem rede: `branchAtual` (`git symbolic-ref --short HEAD`, ~5 ms), `refLinkado` (`supabase/.temp/project-ref` se existir), `remoteUrl` (`git remote get-url origin`). **Sem `baseDaPr`** (exigiria `gh pr view`, rede, quebra o p95): `gh pr merge` e `git push` cujo alvo não é conhecível ⇒ faixa `mostrar` (evento + `systemMessage`), nunca `ask` — o backstop é o ruleset do GitHub; caso `gh-pr-merge-base-desconhecida` no corpus. Bash: primeiro token por segmento (`&&`, `||`, `;`, `|`) + casamento de alvo declarado + D3; sem tokenizador completo, sem heredoc, sem backreference; FN conhecidos (`X=rm; $X`, `base64 | sh`) documentados. MCP: ambiente do servidor declarado; `leitura` se nome casa `^(list|get|search|read|describe|fetch)_` ou primeiro token SQL em `query|sql` ∈ {SELECT, EXPLAIN, SHOW}; resto `escrita`. FN conhecido: `SELECT fn_que_escreve()` (RPC) vira `leitura` — backlog. `Edit|Write|Read|Grep`: caminho. *Given* corpus de ≥ 50 casos nomeados *When* `node --test` *Then* 100% dos vereditos batem.

**REQ-GRD-3 Hook único.** `hooks.json`: um hook `node gates/dist/guarda.js` com matchers `Bash`, `Edit|Write|Read|Grep`, `mcp__.*`; `guard-destructive.sh` e `guard-production.sh` removidos. *Given* comando benigno *When* 20 execuções *Then* p95 wall-clock ≤ 60 ms local (CI: ≤ 150 ms).

**REQ-GRD-4 Decisão por faixa (D1).**
- *Given* `teste` ou `desconhecido` fora de prod *Then* sem decisão, sem evento (silêncio).
- *Given* `homolog`, ou `prod` com `leitura|execucao`, ou D3 hostname *Then* sem decisão + evento `producao.acesso {ambiente, acao, alvo}` + `systemMessage` 1 linha (`leu PRODUÇÃO · <host> · permitido`).
- *Given* `prod/escrita` e `agent_id` **ausente** *Then* `ask` com motivo e como seguir — **salvo** `permitidos[]` (de `origin`, D2) casar ⇒ sem decisão + evento.
- *Given* `prod/escrita` e `agent_id` **presente** *Then* `deny` + mensagem "só o orquestrador pode pedir"; evento `guarda.deny`.

**REQ-GRD-5 Anéis fixos.** Segredo: `Read|Edit|Write|Grep` em `.env*` (exceto `.env.example`), `*.pem`, `*.key`, `~/.aws/**`, `~/.config/gh/**`, e `Bash` cujo alvo (argumento ou redirecionamento `>`/`>>`/`tee`) é um desses caminhos. Integridade (relativo ao repo): `.harness/**`, `harness.config.json`, `tools/gabarito-gates/**`, `.claude/settings*.json`, `.github/workflows/**`, `.git/config`, `.git/refs/remotes/**`, `.git/packed-refs`, mais `${CLAUDE_PLUGIN_ROOT}/**`; nunca `hooks/**` genérico. **A mesma cláusula Bash vale para integridade:** alvo por argumento, redirecionamento `>`/`>>`, `tee`, `sed -i`, destino de `mv`/`cp`, e os comandos de ref/remoto de D2. *Given* `agent_id` presente *Then* `deny`; *Given* ausente *Then* `ask`. Segunda camada: `instalar.sh --guarda` grava em `.claude/settings.json` do repo `permissions.deny` com `Read(.env*)`, `Read(!.env.example)`, `Edit(.env*)`, `Read(**/*.pem)`, `Edit(**/*.pem)`, `Read(**/*.key)`, `Edit(**/*.key)` — sem `./` (profundidade qualquer, M7), nunca `Write(…)` (M7). Sem escape hatch; nenhuma mensagem explica contorno; `GABARITO_ALLOW_*` ausente de `plugins/**` — código, `reference/`, `templates/`, skills (teste `texto.test.sh`: 0 ocorrências, excluindo o próprio arquivo de teste; specs e ledgers em `docs/` podem citar o nome como histórico).

**REQ-GRD-6 Destrutivo deixa de bloquear.** *Given* `rm -rf`, `git reset --hard`, `docker rm`, `DROP|TRUNCATE` em `teste`/local *Then* sem decisão + evento `operacao.destrutiva` (só log). *Given* em `homolog` *Then* + `systemMessage`. *Given* em `prod` *Then* REQ-GRD-4 (`escrita`). Corpus prova: `rm -rf .next dist`, `TRUNCATE` em `127.0.0.1`, comentário com `TRUNCATE` ⇒ silêncio; `git push --force` e `git push` sem args e `HEAD:main` com `contexto.branchAtual ∈ prod.branches`, `gh pr merge` com `branchAtual ∈ prod.branches` (base da PR desconhecida ⇒ `mostrar`, REQ-GRD-2), `vercel --prod`, `vercel deploy --target production`, `supabase db push --linked` e `supabase link --project-ref X && supabase db push` com ref prod, `mcp__*supabase*__execute_sql` com `DROP` em servidor prod ⇒ `prod/escrita`.

**REQ-DIA-1 Diário mínimo.** `gates/src/diario.ts` (puro) + `gates/dist/diario.js`: `append(evento)` em `.harness/entregas/<id>/events.<sessao>.jsonl` com `seq, ts, autor (git user.email), sessao, agente ('orquestrador' | 'subagent:<agent_id>'), tipo, dados, hash_anterior`; `dados` nunca carrega comando cru. Lock `wx`; lock com > 2 s é quebrado; diário indisponível ⇒ guarda **segue** + `systemMessage`. Canário recusa linha com `ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{12,}|\bASIA[A-Z0-9]{12,}|-----BEGIN|\bsk-[A-Za-z0-9]{16,}|xox[bp]-[A-Za-z0-9-]{10,}|://[^/\s]+:[^@\s]+@|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[\w-]{20,}\.eyJ[\w-]{20,}` (todas com borda ou comprimento mínimo: `docs/task-list.md`, `risk-matrix.ts`, `prod-disk-01` **não** casam — caso `canario-nao-recusa-task` no corpus). Recusa **nunca é silenciosa**: grava `diario.recusa {tipo, padrao}` sem `dados`. `projetar(eventos)` → `{instantaneo ≤ 6.000 caracteres, resumo}`. ID da entrega pela branch (`fluxo.idPadrao`); `main`/fora do padrão ⇒ `.harness/entregas/_sem-id/` (gitignored). Hook grava; commit do `events.*.jsonl` vem com a task (E2); em E1 entra no PR final. Eventos: `producao.acesso`, `operacao.destrutiva`, `guarda.deny`, `guarda.ask`, `sessao.inicio`, `guarda.heartbeat`. `session-card.sh` injeta o instantâneo em `additionalContext` (**substitui** o cartão de 40 linhas; incorpora modelo resolvido, PBI/Epic, slots, cache do doctor) e `systemMessage` ≤ 3 linhas (exibição a confirmar em S1).

**REQ-INF-1 Versionamento sai do PreToolUse.** `guard-versioning.sh` removido; `instalar.sh` grava hooks git `commit-msg` e `pre-push` → `node tools/gabarito-gates/scripts/versionamento-check.mjs --msg|--branch`; encadeia em `.husky/` ou `core.hooksPath` se existirem, senão `.git/hooks/`; nunca sobrescreve, anexa com marcador. Limite declarado: `--no-verify`, `HUSKY=0`, `-c core.hooksPath=` contornam — backstop é o job `versionamento` do CI (`gabarito.yml`, já existe). *Given* três repos temporários (sem husky, com husky, com hooksPath) *Then* recusam `git commit -am"foo"` e aceitam `feat(GM-9): …`.

**REQ-INF-2 Doctor e config.** Doctor reporta camada de guarda: `ativa (heartbeat há Nh)` / `configurada` / `permissions.deny` / `mod` / `nenhuma`, com **`fonte: origin | local` e `divergente` quando árvore ≠ `origin/HEAD`** — heartbeat = evento `guarda.heartbeat {fonte}` gravado no SessionStart; lista ambientes; aviso de M8 quando S3 mostrar que mod pode sobrepor deny; perfil `repo sem app` (G3/teardown = n/a); G8 não aceita `.md` como evidência; varredura por `git ls-files`. Chaves mortas removidas (`migrationsDir`, `versionamento.modelo`, `versionamento.commit`, `orquestracao.sempreSubagente`, `paralelismo.modo`, `attest.squash-titulo-pr`). `gates/lib/{config,git,cli,datas}.mjs` substitui as cópias (7× config, 8× `ehEntrypoint`, 5× `arg`, 6× raiz).

**REQ-INF-3 Instalador enxuto.** Não copia `test/`, `README`, `.hashes-anteriores`; template de CI do usuário perde `gates-tests`; `--gates-substituir` e manifesto de hashes removidos (D9).

## Testes e mutações (o que prova cada requisito)

| REQ | Prova | Mutação que deve derrubar |
|---|---|---|
| GRD-2/4/6 | corpus `hooks/test/corpus/*.jsonl` ≥ 50 casos com veredito (inclui `gh-pr-merge-base-desconhecida` ⇒ mostrar); mudar veredito = mudar o caso | remover checagem de `agent_id` ⇒ `subagent-prod-escrita` falha; trocar `ask` por `allow` ⇒ `orq-prod-escrita` falha; devolver `allow` em `teste` ⇒ `teste-sem-decisao` falha |
| GRD-1/D2 | teste com `origin` fake: config local com `permitidos:["*"]` ≠ origin; `origin-head-ausente` (≡ sem remoto, `permitidos` vazio, `systemMessage`); `branchpadrao-local-ignorado` | ler da árvore local ⇒ `permitidos-forjado` falha; ler `branchPadrao` local ⇒ falha |
| GRD-5 | `segredo-env-sub` (deny), `segredo-env-orq` (ask), `cp-env-example` (sem decisão), `integridade-config-sub`, `integridade-config-sub-bash` (`cat > .claude/settings.json`), `integridade-update-ref-sub`, `integridade-remote-set-url-sub`, `integridade-remote-set-head-sub`, `integridade-fetch-refspec-sub` (`git fetch origin +x:refs/remotes/origin/main`), `integridade-git-c-remote-sub` (`git -c remote.origin.url=/tmp/x fetch`), `fallback-bypass-deny` | remover anel de segredo ⇒ falha; remover cláusula Bash da integridade ⇒ falha; remover `Read(…)` do settings ⇒ `settings-deny` falha |
| GRD-5 hatch | `texto.test.sh`: 0 ocorrências de `GABARITO_ALLOW` em `plugins/**` | reintroduzir ⇒ falha |
| DIA-1 | `diario-recusa-segredo` (9 padrões), `diario-recusa-grava-evento`, `canario-nao-recusa-task`, `diario-cadeia` (hash_anterior), `diario-lock-orfao`, `diario-indisponivel-segue`, `instantaneo-6000` | remover canário ⇒ falha; recusa silenciosa ⇒ falha; quebrar cadeia ⇒ falha |
| INF-1 | 3 repos temporários | remover hook ⇒ `commit-am` passa ⇒ falha |
| GRD-3 | benchmark 20× no ledger | — |
| INF-2 | `doctor-camada-ativa`, `doctor-repo-sem-app`, `g8-md-nao-evidencia` | aceitar `.md` ⇒ falha |

## Critérios de aceite

1. Corpus e mutações da tabela verdes; review Fable final executa as mutações e APROVA.
2. p95 wall ≤ 60 ms local (ledger), ≤ 150 ms no CI; suíte total ≤ 15 s local (M3: 36 s).
3. S1 com número e veredito no ledger **antes de T4**; S2–S4 antes do review final.
4. Doctor neste repo com `harness.config.json` + ambientes + perfil `repo sem app` sai de nível 0 e reporta camada; `doctor-self` do CI testa a exclusão com perfil explícito.
5. PR em **`next`** (canal alpha, visão A10), versão `2.0.0-alpha.1`; `main` intocado.

## Rollout (ordem e motivo)

T0 S1–S4 (S1 bloqueia T4; S4 em paralelo) → T1 `gates/lib` + corpus em RED (TDD: o corpus nasce antes do classificador) → T2 classificador puro → T3 diário puro → T4 `guarda.js` + `hooks.json` (só após S1) → T8 canal `next` + `2.0.0-alpha.1` (antes do review, para o review ler o que será servido) → **corte mínimo** → T5 hooks git → T6 doctor/config/instalador → T7 session-card duas vias → review final Fable (mutações da tabela) → PR `enabler/GM-9-fundacao-2.0` → `next`.

## Pendências

- A1–A4 da visão (fecham em S1–S4).
- Exibição de `systemMessage` em SessionStart (S1).
- Mod sobrepondo `deny` sem managed settings (S3) — se verdadeiro, doctor avisa e E4 ganha requisito.
- Backlog (dono Gabriel): teto de latência no CI por máquina (gatilho: 1º falso vermelho por p95); FN de Bash (`X=rm`, `base64 | sh`) e de MCP (`SELECT fn_que_escreve()`) — gatilho: visto em transcript real.

## Riscos

- S1 refutado em `auto`/`bypass`: fallback `deny` + `systemMessage` já decidido.
- Build do Claude Code mudar na semana: spikes registram versão; CI do plugin falha se versão medida ≠ instalada.
- Prazo: só o corte mínimo é compromisso; T5–T7 → E1b.

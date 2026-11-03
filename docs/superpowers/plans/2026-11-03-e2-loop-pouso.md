# E2 Loop + pouso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Neste repo o ciclo de cada task está em `.superpowers/sdd/2026-11-03-e2-loop/retomada.md`.

**Goal:** Plano aprovado vira tasks em paralelo, cada uma em worktree, com gate e review, integradas sem intervenção; o orquestrador pousa sozinho na fronteira da task e o dono pausa com uma palavra.

**Architecture:** Núcleo puro em `gates/src/loop.ts` decide a próxima ação a partir do plano, do diário e de sinais; CLIs, hooks clássicos e um mod só traduzem. Sem mod, loop e kill switch seguem; pouso automático é do mod.

**Tech Stack:** Node ≥ 22 sem dependências, TypeScript com strip-types e `dist/` commitado, `node --test`, hooks clássicos, API de mods do Claude Code.

**Spec:** `docs/superpowers/specs/2026-11-03-e2-loop-pouso-design.md`

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`. Testes rodam de `gates/`.
- Sem dependência nova. `dist/` regenerado por `node scripts/build.mjs` a cada mudança em `src/`.
- `dados` do diário nunca carrega comando cru. Sem `allow`. Sem `GABARITO_ALLOW`. Sem número do MacBook em constante.
- X = 50, env `GABARITO_POUSO_X` sobrepõe. Instantâneo ≤ 3.200 caracteres. ETA com < 3 medições: "sem dados".
- Teto de 2 rodadas. Stop: 3 sem linha nova ⇒ `parar{sem_progresso}`.
- Commits `tipo(GM-10): …`, `git add` por caminho, sem `git stash`.
- Testes novos sem limite absoluto de tempo; se indispensável, com folga e mutação.
- Comportamento fora de loop ativo não muda: sem `plano.json` e sem `.harness/PAUSAR`, hooks novos saem 0 sem saída.

## Review Focus

1. `plano.json` ausente, corrompido ou editado no meio: mensagem clara, nunca bloqueio de sessão comum → T1 `plano-json-invalido`, T8 `stop-plano-corrompido-nao-bloqueia`.
2. Worktree com trabalho não commitado ao fechar: relata, não remove, não apaga → T6 `fechar-sujo-relata`.
3. Nome de banco com hífen, maiúscula ou acima de 63 bytes: normaliza sem colidir → T4 `nome-banco-normaliza`.
4. Kill switch com hook falhando: `PAUSAR` legível mas diário fora do ar continua negando → T7 `pausar-diario-indisponivel-nega`.
5. Pouso com `percent` indefinido após `/clear` e hand-back chegando no mesmo instante: nunca dois `/clear` seguidos → T9 `pouso-nao-repete`.

## Grafo

```
T1 ─┬─ T2 ──┐
    ├─ T3 ──┼─ T6 ─┐
    ├─ T4 ──┘      │
    ├─ T5 ──── T9 ─┼─ T12 ─ T13
    ├─ T7 ─────────┤
    ├─ T8 ─────────┤
    └─ T10 ────────┘
T11 congelada: emenda à visão §6.8 aguarda o dono. Até lá, 3 slots (S10).
```

T1 é serial porque concentra os arquivos compartilhados (`tipos.ts`, `build.mjs`, `hooks.json`, `.gitignore`). Depois dela, T2, T3, T4, T5, T7, T8, T10 não se tocam.

---

### Task 1: Contratos, plano e fiação

**Files:** Create `gates/src/plano.ts`, `gates/src/loop.ts` (só tipos reexportados e `proximaAcao` lançando "não implementado"), `gates/scripts/stop-loop.mjs`, `gates/scripts/uso-subagent.mjs` (ambos no-op, saem 0), `mod/gabarito.mjs` (registra nada), `gates/test/plano.test.ts`. Modify `gates/src/tipos.ts`, `gates/scripts/build.mjs:27`, `hooks/hooks.json`, `.gitignore` (raiz, `.harness/capacidade.json`, `.harness/PAUSAR`), `hooks/test` do formato de `hooks.json` se fixar contagem.

**Interfaces — Produces:**

```ts
// tipos.ts: TipoEvento ganha 'task.iniciada' | 'task.concluida' | 'review.veredito' | 'task.integrada'
//   | 'ci.resultado' | 'loop.parar' | 'loop.pausa' | 'custo.medicao' | 'sessao.pouso' | 'sessao.retomada'
export type TaskPlano = { id: string; deps: string[]; arquivos: string[]; teste_afetado?: string; mutacoes?: string };
export type Plano = { entrega: string; tasks: TaskPlano[] };
export type Sinais = { slots: number; percent: number | null; x: number; pausado: boolean; vivos: number;
  tokens: number | null; tetoTokens: number | null; podePousar: boolean };
export type Papel = 'implementador' | 'revisor' | 'correcao';
export type MotivoParar = 'teto_rodadas' | 'ci_vermelho' | 'teto_tokens' | 'sem_pouso' | 'sem_progresso' | 'diario_invalido' | 'nao_conseguiu';
export type AcaoLoop =
  | { tipo: 'despachar'; itens: { task: string; papel: Papel }[] }
  | { tipo: 'integrar'; tasks: string[] }
  | { tipo: 'esperar'; motivo: string }
  | { tipo: 'pousar' }
  | { tipo: 'parar'; motivo: MotivoParar; task?: string }
  | { tipo: 'concluir' };
// plano.ts
export function validarPlano(bruto: unknown): { ok: true; plano: Plano } | { ok: false; erro: string };
```

`dados` por tipo: `task.iniciada {task, papel}`, `task.concluida {task, sha}`, `review.veredito {task, veredito: 'APROVADO'|'REPROVADO', blocker, major, rodada}`, `task.integrada {task, sha}`, `ci.resultado {verde}`, `loop.parar {motivo, task?}`, `custo.medicao {agente, input_tokens, output_tokens, cache_read}`. `integrar` entra na lista de ações da spec como desvio necessário: sem ele a task aprovada não tem próxima ação.

`hooks.json`: PreToolUse matcher `Agent` → `guarda.js`; `Stop` → `stop-loop.mjs`; `SubagentStop` → `uso-subagent.mjs`; `modules` → `mod/gabarito.mjs`. `plugin.json` não ganha campo `hooks`.

- [ ] **Step 1: Testes em `plano.test.ts`:** `plano-valido`; `plano-ciclo` (a→b→a, erro cita ids); `plano-dep-inexistente`; `plano-id-repetido`; `plano-arquivo-colide-sem-dep` (duas tasks independentes com `src/x.ts` ⇒ erro cita o arquivo); `plano-arquivo-colide-com-dep-transitiva-ok`; `plano-json-invalido` (`null`, array, `tasks` não array ⇒ `ok:false`, sem lançar). Mais `guarda-agent-silencio` em `guarda-adaptador.test.mjs`: entrada `tool_name:'Agent'` sem `PAUSAR` ⇒ sem saída.
- [ ] **Step 2: RED.** `node --experimental-strip-types --test test/plano.test.ts`: falha por módulo ausente.
- [ ] **Step 3: Implementar `validarPlano`,** tipos, stubs, fiação e `MODULOS` + `'plano','loop'`; `node scripts/build.mjs`.
- [ ] **Step 4: GREEN.** `npm test` verde; `claude plugin validate .` sem erro; `build.mjs --check` sai 0.
- [ ] **Step 5: Commit** `enabler(GM-10): contratos do loop, plano e fiação dos hooks`.

### Task 2: Próxima ação pura (dupla, medição A6)

Roda duas vezes no mesmo commit de T1, em worktrees separadas: Sonnet `high` e Opus `low`. Só uma integra; métrica = tokens até APROVADO, gravada em `metricas-e2.jsonl`.

**Files:** Modify `gates/src/loop.ts`. Create `gates/test/loop.test.ts`.

**Interfaces — Consumes:** tipos de T1, `Evento`. **Produces:** `proximaAcao(plano: Plano, eventos: Evento[], sinais: Sinais): AcaoLoop`; `podeIntegrar(plano: Plano, eventos: Evento[], id: string): boolean`; `ordenar(eventos: Evento[]): { ok: true; eventos: Evento[] } | { ok: false }`.

Precedência: (1) `ordenar` falha ⇒ `parar diario_invalido`; (2) `pausado` ⇒ `esperar`; (3) `tokens ≥ tetoTokens` ⇒ `parar teto_tokens`; (4) 2 `ci.resultado {verde:false}` seguidos ⇒ `parar ci_vermelho`; (5) `percent ≥ x`: task `concluida` sem veredito ⇒ `despachar` só `revisor`; `vivos>0` ⇒ `esperar`; senão `podePousar` ? `pousar` : `parar sem_pouso`; `percent` nulo não entra neste ramo; (6) aprovadas não integradas com `podeIntegrar` ⇒ `integrar`; (7) reprovada na rodada 1 ⇒ `correcao`; concluída sem veredito ⇒ `revisor`; deps integradas e não iniciadas ⇒ `implementador`; sempre até `slots − vivos`, mínimo 0; (8) todas integradas ⇒ `concluir`; (9) nada a fazer e `vivos>0` ⇒ `esperar`; nada a fazer, `vivos=0` e task no teto ⇒ `parar teto_rodadas {task}`.

Task no teto: rodada 2 REPROVADA com `major+blocker>0`. Dependentes dela despacham e commitam, mas `podeIntegrar` é `false` (transitivo).

- [ ] **Step 1: Testes:** um por cláusula acima, mais `paralelas-respeitam-slots` (4 prontas, `slots:3, vivos:1` ⇒ 2 itens), `teto-independente-segue`, `teto-dependente-nao-integra`, `x-so-revisor`, `percent-nulo-nao-pousa`, `seq-fora-de-ordem-para`, `duas-sessoes-ordem-ts-sessao`, `concluir-exige-todas-integradas`.
- [ ] **Step 2: RED** com o erro "não implementado".
- [ ] **Step 3: Implementar;** função pura, sem `node:*`.
- [ ] **Step 4: GREEN;** `build.mjs`.
- [ ] **Step 5: Commit** `feat(GM-10): próxima ação do loop como função pura`.

### Task 3: Gate no produto

**Files:** Create `gates/scripts/gate-task.mjs`, `gates/test/gate-task.test.mjs`. Base: `.superpowers/sdd/2026-11-03-e2-loop/gate.mjs`.

**Interfaces — Produces:** CLI `gate-task.mjs <worktree> <base> [--red f] [--files f] [--mut f] [--suite <cmd>]…`; sai 0 verde, 1 reprovado. `export function avaliar(opts): Promise<{ reprova: number; relato: string[] }>`. Id do card vem da branch ou de `--card`, sem `GM-9` fixo. Suítes vêm de `--suite`, ou de `gates.suites` no config, sem caminho deste repo fixo.

- [ ] **Step 1: Testes** com repo git temporário: `gate-0-commits`, `gate-arvore-suja`, `gate-commit-fora-padrao`, `gate-fora-do-escopo`, `gate-segredo`, `gate-mutacao-viva`, `gate-mutacao-morta`, `gate-teste-ja-falha-sem-mutacao` (E19), `gate-tempo-zero-alerta`, `gate-red-por-nome-so-da-task` (A2), `gate-restaura-arvore`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Portar;** mutações em série no mesmo worktree, com restauração em `finally`.
- [ ] **Step 4: GREEN** e `node scripts/gate-task.mjs` contra um commit real deste repo.
- [ ] **Step 5: Commit** `feat(GM-10): gate de task no plugin`.

### Task 4: Banco por worktree

**Files:** Create `gates/scripts/db-template.mjs`, `gates/test/db-template.test.mjs`.

**Interfaces — Produces:** CLI `db-template.mjs preparar|clonar <task>|soltar <task>|orfaos`; `nomeBanco(entrega: string, task: string): string`; config `db.psql: string[]`, `db.template: string`, `db.migrar: string[]`, `db.host`. Sem `db` ⇒ imprime `n/a`, sai 0.

`preparar`: cria template próprio (nunca `postgres`, recusa), `db.migrar` com seed, `ALLOW_CONNECTIONS false`; papel sem superusuário ⇒ `IS_TEMPLATE true`. Host fora de `localhost|127.0.0.1|::1` ⇒ recusa. Órfão: `gm\_<entrega>\_%` com escape e sem worktree viva da task.

- [ ] **Step 1: Testes** com `db.psql` apontando para script falso que grava argv: `nome-banco-normaliza` (`GM-10`,`T-1` ⇒ `gm_gm10_t1`; 70 caracteres ⇒ ≤ 63 bytes com sufixo de hash, sem colisão), `recusa-template-postgres`, `recusa-host-remoto`, `sem-db-na`, `clonar-usa-template`, `soltar-force`, `orfao-com-escape-nao-pega-gmaster`, `orfao-worktree-viva-fica`, `template-sem-conexao-apos-preparar`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar** chamando `db.psql` por argv, sem shell.
- [ ] **Step 4: GREEN.** Prova real, fora da suíte: contêiner `gm-e2-pg` com `docker run --rm` e tmpfs, porta 54399, só preparar, 3 clones, soltar, órfãos; `docker stop`. Evidência no relatório.
- [ ] **Step 5: Commit** `feat(GM-10): banco por worktree a partir de template`.

### Task 5: Instantâneo e ETA

**Files:** Modify `gates/src/diario.ts:32,211-235`, `gates/test/diario.test.ts`, `gates/test/cartao-sessao.test.mjs` onde fixa instantâneo, `reference/referencia.md:143`, `reference/AGENTS.md:167`.

**Interfaces — Produces:** `projetar` devolve também `eta: { medianaS: number; n: number } | null` e o instantâneo traz linha `ETA: sem dados` ou `ETA: <n> tasks, mediana <s> s`. Duração = `task.iniciada` do implementador até `review.veredito` APROVADO. `LIMITE_CONTEXTO` do cartão não muda: decisão pendente do dono.

- [ ] **Step 1: Testes:** `instantaneo-3200` substitui `instantaneo-6000`; `eta-sem-dados-com-2`; `eta-mediana-com-3`; `eta-ignora-reprovada`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: `INSTANTANEO_MAX = 3200`** e cálculo no `projetar`. Linha de ETA conta no orçamento.
- [ ] **Step 4: GREEN;** `build.mjs`.
- [ ] **Step 5: Commit** `fix(GM-10): instantâneo no teto de 1,5k tokens, com ETA`.

### Task 6: Worktree por task

**Depende de T2, T3, T4.**

**Files:** Create `gates/scripts/loop.mjs`, `gates/test/loop-cli.test.mjs`.

**Interfaces — Consumes:** `validarPlano`, `proximaAcao`, `podeIntegrar`, `avaliar`, `db-template.mjs`, `medir/calcularSlots`. **Produces:** `loop.mjs proxima | abrir <task> | integrar <task> | fechar <task> | parar <motivo>`, saída JSON em stdout. Branch `wt/<entrega>-<task>`, worktree em `.harness/worktrees/<task>` (gitignored por T1 se faltar, senão aqui), `TMPDIR` em `<worktree>/.tmp-gabarito` exportado na saída de `abrir`. `abrir` e `integrar` gravam `task.iniciada`, `task.integrada`.

`integrar`: recusa com `podeIntegrar=false`; rebase; gate; `merge --ff-only`; grava evento; chama `fechar`. `fechar`: `soltar` banco, apaga `.tmp-gabarito` (só esse caminho, validado dentro da worktree), `git worktree remove` sem `--force`.

- [ ] **Step 1: Testes** em repo temporário: `abrir-cria-branch-e-worktree`, `abrir-duas-vezes-recusa`, `integrar-ff`, `integrar-recusa-gate-vermelho`, `integrar-recusa-sem-podeintegrar`, `integrar-conflito-rebase-relata-e-nao-integra`, `fechar-sujo-relata` (mantém worktree, sai 1), `fechar-tmpdir-limpo` (aceite 5), `proxima-json`, `proxima-sem-plano-mensagem`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** `execFileSync` por argv.
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** `feat(GM-10): worktree por task e integração com gate`.

### Task 7: Kill switch na guarda

**Files:** Modify `gates/src/guarda.ts`, `gates/src/decidir.ts` só se a decisão couber lá, `gates/test/guarda-adaptador.test.mjs`. Create `gates/test/kill-switch.test.mjs`.

**Interfaces — Produces:** com `<raiz>/.harness/PAUSAR`: `Agent` ⇒ `deny` a todos; qualquer ferramenta com `agent_id` ⇒ `deny`; orquestrador em outras ferramentas segue a guarda normal. Mensagem exata: `pausado: /gabarito retomar`. Evento `loop.pausa {negado: tool}`. Checagem antes da classificação; sem custo fora de `existsSync`.

- [ ] **Step 1: Testes:** `pausar-nega-agent-orquestrador`, `pausar-nega-tudo-subagent`, `pausar-orquestrador-le`, `sem-pausar-silencio`, `pausar-diario-indisponivel-nega`, `pausar-remocao-pelo-modelo-e-integridade` (`rm .harness/PAUSAR` por subagent ⇒ `deny`; orquestrador ⇒ `ask`), `mensagem-nao-ensina-bypass`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** `build.mjs`.
- [ ] **Step 4: GREEN;** `node scripts/bench-guarda.mjs` p95 sem regressão > 5 ms contra a base, número no relatório.
- [ ] **Step 5: Commit** `feat(GM-10): kill switch por arquivo na guarda`.

### Task 8: Não parar em silêncio

**Files:** Modify `gates/scripts/stop-loop.mjs`. Create `gates/test/stop-loop.test.mjs`.

**Interfaces — Consumes:** stdin do `Stop` com `background_tasks[]`; `validarPlano`, `proximaAcao` via `dist`. **Produces:** `block` com motivo = ação em português; contador em `.harness/stop-contador.json` (gitignored), `{linhas, stops}`.

Loop ativo = `plano.json` da entrega da branch e sem `task.integrada` final. `background_tasks` com `type:'subagent'` ⇒ sai 0 sem saída. `parar` já gravado ⇒ sai 0. 3 Stops sem linha nova em `events.*.jsonl` ⇒ grava `loop.parar {sem_progresso}` e `systemMessage`.

- [ ] **Step 1: Testes:** `stop-sem-plano-sai`, `stop-plano-corrompido-nao-bloqueia` (sai 0 + `systemMessage`), `stop-com-acao-bloqueia`, `stop-agente-vivo-nao-bloqueia`, `stop-shell-background-nao-conta`, `stop-parar-gravado-sai`, `stop-3-sem-progresso-para`, `stop-linha-nova-zera`, `stop-pausado-sai`, `stop-concluir-sai`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** `feat(GM-10): hook Stop mantém o loop e registra falta de progresso`.

### Task 9: Mod de pouso

**Depende de T5 e de S12.** Compactação segue o que S12 medir; se S12 não fechar a detecção, o trecho vira limite declarado e medição, sem chute.

**Files:** Create `gates/src/pouso.ts`, `gates/test/pouso.test.ts`, `mod/test/gabarito.test.mjs`. Modify `mod/gabarito.mjs`, `gates/scripts/build.mjs:27` só com `'pouso'` (T1 não o declara: é serial após T5).

**Interfaces — Produces:** `decidirPouso(a: { percent: number|null; x: number; vivos: number; fronteira: boolean; jaPousando: boolean; orquestrador: boolean }): 'nada'|'bloquear_despacho'|'pousar'`. Mod: `turn.complete` sem `agentId` ⇒ decide; `$.clock.after(0)` → grava `sessao.pouso`, gera instantâneo, `$.command.run('clear')`, `$.prompt.submit`, grava `sessao.retomada`. `$.store.pousando` sobrevive ao `/clear`; `$.state` zera (M2). `tool.call` de `Agent` com `percent ≥ x` nega salvo `subagent_type` revisor. Registra `/gabarito` com args `pausar|retomar`: `pausar` escreve `.harness/PAUSAR`, `retomar` remove, grava `loop.pausa`. `session.measure` grava `custo.medicao` por `agentId`.

- [ ] **Step 1: Testes** puros: `abaixo-x-nada`, `x-com-vivos-bloqueia`, `x-sem-fronteira-bloqueia`, `x-fronteira-pousa`, `percent-nulo-nada`, `pouso-nao-repete`, `subagent-nada`. No mod, por `plugin test`: ordem dos passos, `store` antes de `clear`, `revisor-passa-acima-x`, `gabarito-pausar-escreve`, `gabarito-args-invalidos-mostra-uso`, `instantaneo-tokens` (`context.tokens` ≤ 1,5k).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** núcleo em `pouso.ts`, mod só adaptador.
- [ ] **Step 4: GREEN;** `claude plugin validate .`.
- [ ] **Step 5: Commit** `feat(GM-10): pouso automático por mod`.

### Task 10: Tokens sem mod

**Files:** Modify `gates/scripts/uso-subagent.mjs`. Create `gates/test/uso-subagent.test.mjs`.

**Interfaces — Produces:** lê `agent_transcript_path`, soma `message.usage` com dedupe por `message.id`, relê após 60 ms para a última mensagem (S8: ≥ 51 ms), grava `custo.medicao {agente: 'subagent:<id>', …}`. Só campos numéricos; nunca conteúdo. Com evento do mod para o mesmo `agente`, não duplica. Ignora disparo com `agent_type` vazio (S7: ruído).

- [ ] **Step 1: Testes:** `soma-dedupe-por-id`, `ultima-mensagem-tardia`, `agent-type-vazio-ignora`, `transcript-ausente-sai-0`, `linha-corrompida-ignora`, `nao-grava-conteudo` (sentinela na mensagem, ausente do evento), `nao-duplica-com-mod`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** `feat(GM-10): tokens por subagent sem mod`.

### Task 11: Capacidade medida (CONGELADA)

Aguarda o dono julgar a emenda à visão §6.8. Se aprovada:

**Files:** Modify `gates/scripts/capacidade.mjs`, `gates/test/capacidade.test.mjs`, `.harness/capacidade.json` (gerado, gitignored).

**Interfaces — Produces:** `capacidade.mjs --calibrar [--suite <cmd>]`: N=1,2,3,…; para na 1ª falha ou 1ª queda de vazão; grava `{hostname, slots_max, rss_pico_mb, tmpdir_mb, cpu_total}`. Runtime: `slots = min(slots_max, floor((mem − reserva)/rss), floor((disco − reserva)/tmpdir), reduzido por CPU atual acima de cpu_total)`, ≥ 1. Hostname diferente ou sem arquivo: 1 slot e aviso.

- [ ] **Step 1: Testes** com suíte fake: `calibra-para-na-falha`, `calibra-para-na-queda`, `outro-hostname-1-slot`, `sem-arquivo-1-slot-aviso`, `carga-reduz`, `memoria-reduz`, `nunca-menos-que-1`, `sem-numero-fixo`.
- [ ] **Step 2: RED.** **Step 3: Implementar.** **Step 4: GREEN;** calibrar neste repo, 3 rodadas em `slots_max` sem falha (aceite 3).
- [ ] **Step 5: Commit** `feat(GM-10): slots por escada medida no repositório`.

### Task 12: Skill, agente, doctor, versão

**Depende de T6–T10.**

**Files:** Create `skills/gabarito-loop/SKILL.md`, `commands/gabarito.md`. Modify `agents/gabarito-spike.md` (A5, A6), `gates/scripts/harness-doctor.mjs` e seu teste (linha `loop: mod ativo|sem mod (sem pouso automático)` e `db: declarado|n/a`), `.claude-plugin/plugin.json` e manifesto do marketplace para `2.0.0-alpha.2`, `CHANGELOG.md`.

**Interfaces — Consumes:** CLI de T6. A skill só traz ponteiros e o ciclo, ≤ 60 linhas; sem cópia de spec. `commands/gabarito.md` é o caminho sem mod (`/<plugin>:gabarito pausar|retomar`).

- [ ] **Step 1: Testes:** `doctor-loop-sem-mod`, `doctor-db-na`; `texto.test.sh` sem `GABARITO_ALLOW`; versão em `package.test.mjs`.
- [ ] **Step 2: RED.** **Step 3: Escrever.** **Step 4: GREEN;** `claude plugin validate .`.
- [ ] **Step 5: Commit** `enabler(GM-10): skill do loop, doctor e versão alpha.2`.

### Task 13: Aceites de ponta a ponta

**Depende de T12.** Sem código de produto; defeito volta à task dona.

**Files:** Create `gates/test/e2e/aceite-loop.exp` e plano de exemplo em `gates/test/e2e/plano-exemplo.json`, fora de `npm test`.

- [ ] **Step 1: Aceite 1:** repo descartável, plano de 3 tasks, 2 paralelas e 1 dependente, TUI `--permission-mode auto`, haiku, `GABARITO_POUSO_X=1`. Esperado: `concluir` sem digitação, 1 `sessao.pouso`, 1 `sessao.retomada`.
- [ ] **Step 2: Aceite 2:** `.harness/PAUSAR` no meio ⇒ nenhum `Agent` novo; `/gabarito retomar` recomeça a task.
- [ ] **Step 3: Aceite 4:** diário traz ETA e tokens por agente.
- [ ] **Step 4: Aceite 5:** `TMPDIR` 0 bytes após `fechar`.
- [ ] **Step 5: Evidência** no ledger; commit `test(GM-10): aceites de ponta a ponta do loop`.

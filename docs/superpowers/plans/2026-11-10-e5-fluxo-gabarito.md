# E5a Fluxo Gabarito Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ciclo de cada task: `.superpowers/sdd/2026-11-09-e3-sombra/implementador-comum.md` e `task-review-comum.md`, com GM-13 no lugar de GM-11 e a pasta `.superpowers/sdd/2026-11-10-e5-fluxo/`, com P1, P2, P9 e P15 de `docs/aprendizados/processo-orquestrador.md`. A E5a roda pelo `gabarito-loop` do `gabarito-mestre-next` instalado (REQ-DOG-1), com o `plano.json` da Task 0.

**Goal:** O adotante recebe sem tela nova o que o dono usa: o loop pousa e retoma depois do `/clear` sem depender de `session.start`; todo gatilho medido vira aprendizado do diário que volta no instantâneo, no cartão e no brief; as decisões viram `registro.md`; o onboarding vira uma fase com 3 perguntas de decisão; o nome é Fluxo Gabarito; `next` vira `main` como 2.0.0.

**Architecture:** O núcleo puro ganha `aprendizado.ts` (forma, existência, vigentes, avisos), `pendencias.ts` (gatilhos ⇒ pendências) e `registro.ts` (markdown determinístico). `proximaAcao` ganha `aprender` depois de (4b). Gravação e I/O ficam nos adaptadores existentes: `loop.mjs` (subcomandos `aprendizado`, `aprendizados`, `pousar`, `registro`, implementados em `scripts/loop-aprendizado.mjs` com dependências injetadas), `cartao-sessao.mjs`, `stop-loop.mjs`, mod e doctor. O onboarding é o script puro `onboarding.mjs` (detectar ⇒ perguntas ⇒ config) mais a skill reescrita. A autonomia é uma linha em `politicaEfetiva`.

**Tech Stack:** Node ≥ 22.18 sem dependências, TypeScript com strip-types e `dist/` commitado, `node --test`, hooks clássicos (`SessionStart`, `Stop`), API de mods do Claude Code 2.1.3xx (`prompt.submit` com `origin.kind`, `command.run`, `store`).

**Spec:** `docs/superpowers/specs/2026-11-10-e5-fluxo-gabarito-design.md` (r3 aprovada). Decisões: `.superpowers/sdd/2026-11-10-e5-fluxo/sombra-spec.md` (A1–A13, B3–B6) e `sombra-r3.md`; notas M1 da E4 em `.superpowers/sdd/2026-11-09-e4-painel/sombra-t14.md`. Onde divergirem deste plano, elas vencem. Decisões do plano: `.superpowers/sdd/2026-11-10-e5-fluxo/sombra-plano.md` (D-1..D-6, resumo no fim).

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`; testes rodam de `gates/`. Sem dependência nova. `node scripts/build.mjs` a cada mudança em `src/`; `build.mjs --check` sai 0 (CI "dist em dia"). `MODULOS` ganha `'aprendizado','pendencias','registro'`. Mudança em `mod/` ⇒ `bash scripts/test/mod-test.sh` verde.
- `aprendizado.regra` ≤ **300** caracteres. `brief:<papel>` só com `PAPEIS = implementador|revisor|correcao`. `entra_em` ⊆ `instantaneo | spec | brief:<papel>`, lista não vazia e sem repetição.
- **M nunca** entra em brief, cartão nem instantâneo; aparece só no registro. D só com evidência da máquina (D4); sem ela, recusa com motivo `grave como M`.
- Instantâneo: aprendizados D com `instantaneo`, até **800** caracteres, **160** por linha, com rodapé `... <k> aprendizado(s) fora`. O total segue **3.200**; decisões seguem **1.600**.
- Cartão do `SessionStart`: teto somado **4.329**. Ordem de corte: corpo do cartão, depois instantâneo, **nunca** a linha de retomada, cujo texto exato é `Loop da entrega <id> em pouso: rode loop.mjs proxima e siga.`.
- O hook `SessionStart` não grava evento novo: segue gravando só `sessao.inicio` e `guarda.heartbeat`. Só o mod grava `sessao.retomada {via:'mod', chars}`.
- Falha de `prompt.submit` depois do `/clear`: aviso exato `retomada pelo contexto; o wakeup do /loop ou sua próxima mensagem reabre o turno` e nenhum `loop.parar`. Falha antes do `/clear` mantém `loop.parar {sem_pouso}`. Nunca dois `/clear`.
- `dono.mensagem {sha256, chars}` vai em `events.dono.jsonl`, **nunca o texto**. Só `origin.kind ∈ {composer, bridge}`, sem `e.command`, com loop ativo.
- Perfis (Sombra r3). `economia` = implementador sonnet/medium, revisor sonnet, sombra opus, revisor_final opus, spike sonnet, basico haiku. `padrao` = `MODELOS_PADRAO`. `qualidade` = implementador opus/high, revisor opus, sombra opus, revisor_final fable, spike opus, basico sonnet. Resolução: `orquestracao.modelos.<papel>` > perfil > `MODELOS_PADRAO`.
- `entrega.autonomia` é lida de `origin/HEAD` por `lerConfigEntrega`; não booleano ⇒ erro e `false`; `autonomia !== true` ⇒ a política do config vale `sob_demanda`. `decidirEntrega` não muda. Nada faz merge na base (REQ-ENT-1).
- Onboarding: sempre 3 `AskUserQuestion` fixas, nesta ordem: política de entrega, autonomia em produção, perfil de modelos. Mais 1 por fato `ambiguo|nao_detectado`, na ordem fixa `tipo_repo, ambientes, planejamento, versionamento, orquestracao`. **Teto 5**. Fato detectado nunca é perguntado. Acima do teto, o fato fica `nao_detectado`, sem default.
- NOM-1: `workflow[ _-]?true` sem caixa, no escopo e com as exceções de REQ-NOM-1 copiados literalmente.
- `dados` do diário nunca carrega comando cru (`tipos.ts:87`). Toda task tem teste "ausente × corrompido" distintos e segue P15. Relógio só por parâmetro no núcleo.
- Commits `tipo(GM-13): …`, `git add` por caminho, sem `git stash`, P2 em todo Step 5. Nada de deploy real nem merge em `main` (só o dono).

## Review Focus

1. Pendência aberta com todas as tasks integradas: `entrega.mjs executar` e o painel esperam `concluir`. A entrega recusa com `entrega_incompleta` citando `aprender`, nunca sobe nem fica em silêncio → T7a `entrega-recusa-com-pendencia`.
2. Diário de **outra** entrega corrompido (linha torta, cadeia quebrada): a projeção da entrega corrente segue e o aviso cita a pasta. Nunca "0 aprendizados" calado nem exceção → T2 `vigentes-outra-entrega-corrompida-avisa`.
3. Cadeia de `substitui` com ciclo, ou apontando para aprendizado de outra entrega: termina, vale o mais recente, nada some → T2 `substitui-ciclo-termina`, `substitui-entre-entregas`.
4. `prompt.submit` com `origin` ausente, texto vazio ou só espaço, ou `/loop …` digitado: não grava `dono.mensagem` → T10 `origem-ausente-nao-grava`, `texto-vazio-nao-grava`.
5. Regra com quebra de linha, caractere de controle ou segredo (canário): instantâneo e cartão em 1 linha sem controle; o diário recusa o segredo com motivo, sem gravar → T9 `regra-com-controle-uma-linha`, T8 `regra-canario-recusa`.

## Grafo

| Onda | Tasks (dependências) |
|---|---|
| 0 | T0 (—, não roda suíte), T1 (—) |
| 1 | T2 (T1), T3 (T1), T4a (T1), T4b (T1) |
| 2 | T5 (T4b), T6a (T1, T0·S6), T7a (T3, T4a, T4b), T9 (T2) |
| 3 | T6b (T6a, T4b), T7b (T7a), T8 (T2, T4b, T7a), T10 (T7a, T9) |
| 4 | T11 (T8), T13 (T2, T4b, T5, T6b) |
| 5 | T12 (T8, T11), T14 (T5, T6b, T13) |
| 6 | T15 (T8, T11, T12, T14), T16 (T6b, T10–T13) |
| 7 | T17 (todas) |
| 8 | T18 (T17 + aceite final do dono, D13): **BLOQUEADA PELO DONO** |

O loop despacha pelos `deps` do `plano.json` (`loop.ts:296-298`), não pela onda; deps conferidas pela Sombra (2a). No máximo 3 agentes testando por vez; worktree por task. Arquivos não se cruzam dentro de uma onda. `loop.mjs`: T1 cria o despacho e T4b → T8 → T11 → T12 tocam em série (T11 e T12 só mexem em `loop-aprendizado.mjs`, em funções distintas). `texto.test.sh`: T5 → T14 → T15. Doctor: T4b → T5 → T13. `pouso.ts`: T7a → T10. Caminhos críticos: T1→T4b→T7a→T8→T11→T12→T15→T17 e T0→T6a→T6b→T13→T14→T15→T17 (o 2º manda se o T0 passar de ~1 h). **Marcados por spike:** T6a consome S6; T9 consome S4; T10 consome S1; T15 e T17 consomem S3; S5 só informa D10.

---

### Task 0: Spikes S1, S3, S4, S5, S6 e plano da GM-13

**Files:** Create `.superpowers/sdd/2026-11-10-e5-fluxo/t0-relatorio.md` e `.superpowers/sdd/2026-11-10-e5-fluxo/s6-gabarito.json`; sondas em `.claude-tmp/e5-spike/`. Orquestrador: `.harness/entregas/GM-13/plano.json`, com T1–T17 (T4, T6 e T7 partidas em a/b), deps do Grafo, `arquivos` e `reqs` destas tasks. Nenhum arquivo de produto.

Cada item: pergunta fechada, número, CONFIRMADA/REFUTADA.
- **S1** Mod de sonda por `--plugin-dir`, N = 3 `/clear` em sessão TUI. Pergunta: `$.session.id()` muda? `$.clock.every(5s)` dispara depois do `/clear`? `$.agent.list()` mantém um agente haiku vivo lançado antes? Se `agent.list` perde os vivos ⇒ volta à Sombra antes da T10.
- **S3** Plugin `gabarito-mestre-next` instalado, `/loop` dinâmico ativo, `/clear` manual, N ≥ 3. Pergunta: o wakeup abre turno depois do `/clear`? Se REFUTADA ⇒ T15 e Aceite 2 trocam "wakeup" por "próxima mensagem do dono"; vai à Sombra.
- **S4 (sintético)** Diário com 30 `decisao.sombra` de 200 caracteres, 20 aprendizados D de 300 caracteres e 200 eventos. Pela aritmética do orçamento da T9: caracteres por bloco, cartão restante abaixo de 4.329 com a linha de retomada. Meta: decisões intactas, linha presente. Repetido com o diário real na T17.
- **S5** Transcripts das sessões da E4 (2026-11-09/10, desta conta): mensagens humanas digitadas por entrega, excluindo hand-back, slash e retomada. Número por entrega. Só informa D10; > 50 % viraria o gatilho fora de escopo.
- **S6** Gabarito manual, só leitura, sem `.env` nem produção, em `/Users/gabs-dev/projetos-true/true_force`, `sherlocktrue` e `separatrue`. Por fato (os 5 da ordem fixa): estado e valor esperados pelas regras da T6a (perguntas pela T6b), com a fonte; perguntas = 3 + condicionais. Grava `s6-gabarito.json` `[{repo, item, estado, valor, fonte}]`. Meta: média ≤ 5 perguntas, típico 3. Repo com mais de 2 fatos não resolvidos ⇒ volta ao dono.

- [ ] **Step 1:** `plano.json` da GM-13 e `loop.mjs proxima` do plugin instalado devolvem `despachar T1`.
- [ ] **Step 2:** medir S1, S3, S4, S5 e S6; colar números.
- [ ] **Step 3:** relatório com veredito e consequência por item; commit `docs(GM-13): spikes da E5a e plano do loop`.

### Task 1: Contratos, forma do diário e fiação

**Files:** Modify `gates/src/tipos.ts`, `gates/src/formas.ts`, `gates/src/loop.ts` (só `export` de `PAPEIS` tipado), `gates/scripts/build.mjs` (MODULOS), `gates/scripts/loop.mjs` (despacho de `aprendizado`, `aprendizados`, `pousar`, `registro`). Create stubs `gates/src/{aprendizado,pendencias,registro}.ts` e `gates/scripts/loop-aprendizado.mjs` (exports lançando `Falha('nao_implementado')`). Test: `gates/test/formas.test.ts`, `gates/test/loop-cli.test.mjs`.

**Interfaces — Produces:**
```ts
// tipos.ts — TipoEvento ganha 'aprendizado' | 'aprendizado.nada' | 'dono.mensagem'
export type RefEvento = { sessao: string; seq: number };
export type RefAprendizado = RefEvento & { entrega?: string };            // D-4: ENTREGA_RE; ausente = corrente
export type DadosAprendizado = { tipo: 'E' | 'A'; status: 'D' | 'M'; gatilho: RefEvento | null;
  evidencia: { eventos?: RefEvento[]; medicao?: { fonte: string; numero: number } };
  regra: string; entra_em: string[]; substitui?: RefAprendizado };
export type TipoGatilho = 'review' | 'parar' | 'fechamento' | 'dono';
export type Pendencia = RefEvento & { tipo: TipoGatilho };
// AcaoLoop ganha | { tipo: 'aprender'; pendencias: Pendencia[] }
export type PerfilModelo = 'economia' | 'padrao' | 'qualidade';
// loop.ts
export const PAPEIS: readonly Papel[];
```
```js
// loop.mjs: deps injetadas, sem import circular
//   case 'aprendizado' | 'aprendizados' | 'pousar' | 'registro' → loopAprendizado[cmd]({ c, plano, gravar, lerDiarioEstrito, Falha, git }, pos, flags)
// loop-aprendizado.mjs
export function aprendizado(deps, pos, flags), aprendizados(deps, pos, flags), pousar(deps, pos, flags), registro(deps, pos, flags)
```
`formaInvalida`, por tipo:
- `aprendizado`: `tipo ∈ E|A`; `status ∈ D|M`; `gatilho` `null` ou `RefEvento` (`sessao` casa `SESSAO_RE`, `seq` inteiro ≥ 1); `evidencia` objeto; `eventos?` lista não vazia de `RefEvento`; `medicao?` `{fonte, numero}` com `numero` finito (`"12"` e `NaN` recusam) e `fonte` relativa sem `..` nem `/` inicial, ou `evento:<sessao>:<seq>`; `regra` 1..300; `entra_em` como nas Global Constraints; `substitui?` `RefAprendizado`: `entrega?` casa `^[A-Z]+-\d+$` (o `ENTREGA_RE` de `loop.mjs:61`), nunca `/`, `..` ou vazio; ausente = entrega corrente (D-4, Sombra). Teste `forma-substitui-entrega-invalida` (`../GM-1`, `gm-1`, `''`); `status: 'D'` sem `eventos` nem `medicao` ⇒ motivo contendo `grave como M`.
- `aprendizado.nada {gatilho: RefEvento, motivo 1..300}`.
- `dono.mensagem {sha256: hex 64, chars: inteiro ≥ 0}`; qualquer chave fora de `{sha256, chars}` (inclusive `texto`) ⇒ recusa.

- [ ] **Step 1: Testes.** `formas.test.ts`: `forma-aprendizado-brief-sombra-recusa`, `forma-aprendizado-numero-texto-e-nan-recusa` (`"12"`, `NaN`, `Infinity`), `forma-aprendizado-d-sem-evidencia-grave-como-m`, `forma-aprendizado-m-sem-evidencia-ok`, `forma-aprendizado-regra-301`, `forma-aprendizado-fonte-absoluta-e-ponto-ponto`, `forma-aprendizado-fonte-evento-ok`, `forma-aprendizado-entra-em-repetido`, `forma-substitui-entrega-invalida`, `forma-nada-sem-motivo`, `forma-dono-mensagem-chave-extra-recusa` (`texto` ou qualquer chave fora de `{sha256, chars}` ⇒ recusa; Sombra 2d.3), `forma-novos-ausente-x-corrompido`. `loop-cli.test.mjs`: `subcomandos-e5-stub-nao-implementado` (rc 1, `erro: 'nao_implementado'`, nada gravado). Mutação **M-APR1c** (aceita `status:'D'` sem evidência) morre em `forma-aprendizado-d-sem-evidencia-grave-como-m`. Mutação **M-APR2f** (aceita chave extra) morre em `forma-dono-mensagem-chave-extra-recusa`.
- [ ] **Step 2: RED.** Falha por tipo ou módulo ausente.
- [ ] **Step 3: Implementar** forma, tipos, stubs e despacho; `node scripts/build.mjs`.
- [ ] **Step 4: GREEN.** `npm test`; `build.mjs --check`; `claude plugin validate .`.
- [ ] **Step 5: P2 + Commit** `enabler(GM-13): contratos da E5a, forma do diário e fiação`.

### Task 2: Núcleo do aprendizado (existência e vigentes)

**Files:** Modify `gates/src/aprendizado.ts`, `gates/src/diario.ts` (só `lerAprendizados`). Create `gates/test/aprendizado.test.ts`.

**Interfaces — Consumes:** T1. **Produces:**
```ts
export type AprendizadoVigente = DadosAprendizado & { entrega: string; sessao: string; seq: number; ts: string };
export function validarAprendizado(eventosDaEntrega: Evento[], dados: DadosAprendizado, entrega: string, porEntrega: Map<string, Evento[]>): string | null;
export function aprendizadosVigentes(porEntrega: Map<string, Evento[]>): AprendizadoVigente[];
export function paraDestino(v: AprendizadoVigente[], destino: string): AprendizadoVigente[];   // só D, `entra_em` inclui destino
// diario.ts
export function lerAprendizados(dirEntregas: string): { porEntrega: Map<string, Evento[]>; avisos: string[] };
```
- `validarAprendizado` recusa `gatilho_inexistente`, `evento_inexistente` (cada `eventos[]` e `fonte` `evento:<s>:<q>` na entrega corrente) e `substitui_inexistente` (procura em `substitui.entrega ?? entrega`; o alvo tem de ser `aprendizado` válido).
- `aprendizadosVigentes`: só eventos de forma válida; o alvo de um `substitui` sai; ciclo não trava (vale o mais recente da cadeia). Ordem mais recente primeiro por `(ts, entrega, sessao, seq)`.
- `lerAprendizados` lê `<dirEntregas>/*/events.*.jsonl` por `lerEstrito`. Entrega ilegível fica fora e gera aviso `aprendizados: <entrega> ilegível (<motivo>)`. Pasta ausente ⇒ mapa vazio sem aviso. Nunca lança.

- [ ] **Step 1: Testes:** `validar-gatilho-inexistente`, `validar-evento-fonte-inexistente`, `validar-substitui-inexistente`, `substitui-ciclo-termina`, `substitui-entre-entregas`, `vigente-mais-recente-por-ts-entrega`, `para-destino-nunca-m` (M com `brief:revisor` fora), `para-destino-papel-exato` (item `revisor` não traz `brief:implementador`), `vigentes-outra-entrega-corrompida-avisa`, `ler-aprendizados-ausente-x-corrompido`. Mutação **M-APR1a**: `aprendizadosVigentes` aceita forma inválida (morre em `vigentes-forma-invalida-ignorada`).
- [ ] **Step 2: RED. Step 3: Implementar** (puro, salvo `lerAprendizados`); `build.mjs`. **Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): núcleo do aprendizado e projeção da árvore`.

### Task 3: Pendências de aprendizado

**Files:** Modify `gates/src/pendencias.ts`. Create `gates/test/pendencias.test.ts`.

**Interfaces — Consumes:** `ordenar`, `estadoDe` (loop.ts; ciclo de import aceito como em `emenda.ts`), `formaInvalida`. **Produces:** `export function pendenciasAprendizado(plano: Plano, eventos: Evento[]): Pendencia[]` (ordem do diário; diário fora de ordem ⇒ `[]`, porque a cláusula (1) de `proximaAcao` vem antes).

Gatilhos:
1. `review.veredito` com `major + blocker ≥ 1` ⇒ `review`.
2. `loop.parar` de qualquer motivo, exceto `motivo === 'sem_progresso'` com `dados.stops` inteiro (o gravado pelo Stop) ⇒ `parar`.
3. Todas as tasks do plano `integrada` ⇒ 1 pendência `fechamento` no **último** `task.integrada`; reintegração depois de emenda gera nova âncora.
4. `dono.mensagem` ⇒ no máximo 1 pendência `dono`, ancorada na mais recente ainda não fechada.

Fecha: `aprendizado` com `gatilho` igual, ou `aprendizado.nada` com `gatilho` igual, ambos de forma válida. Para `dono`, fechar o gatilho `{dono, q}` fecha toda `dono.mensagem` com `seq ≤ q`.

- [ ] **Step 1: Testes:** `fechamento-ancora-no-ultimo-integrada` (3 tasks), `fechamento-fechado-some`, `major-abre`, `aprovado-com-achado-abre`, `aprovado-limpo-nao-abre`, `parar-abre`, `parar-sem-progresso-do-stop-nao-abre`, `parar-sem-progresso-manual-abre` (sem `stops`), `cinco-mensagens-uma-pendencia`, `nada-fecha-todas-anteriores`, `mensagem-depois-do-nada-reabre`, `pendencias-ausente-x-corrompido`. Mutações **M-APR2b** (âncora no 1º `task.integrada`) e **M-APR2c** (1 pendência por mensagem).
- [ ] **Step 2: RED. Step 3: Implementar;** `build.mjs`. **Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): pendências de aprendizado como projeção pura`.

### Task 4a: Autonomia em produção

**Files:** Modify `gates/src/entrega.ts` (`lerConfigEntrega`, `politicaEfetiva`). Test: `gates/test/entrega.test.ts`, `gates/test/entrega-cli.test.mjs`. Arquivos disjuntos da T4b; rodam em paralelo.

**Interfaces — Produces:**
```ts
// ConfigEntrega ganha autonomia: boolean   (ausente ⇒ false; não booleano ⇒ false + erro 'entrega.autonomia: esperado booleano')
// politicaEfetiva: c.autonomia !== true ⇒ trata c.politica como 'sob_demanda' antes da comparação com o plano; decidirEntrega intacta
```

- [ ] **Step 1: Testes:** **AUT-1** `continua-autonomia-ausente-false-e-sim-texto-sob-demanda` (3 casos ⇒ `politicaEfetiva` = `sob_demanda`, `decidirEntrega` ⇒ `release_pr`), `continua-autonomia-true-sobe` (homolog verde ⇒ `subir`), `plano-continua-autonomia-false-afrouxada`, `janela-autonomia-false-sob-demanda`, `config-local-autonomia-ignorada` (CLI: local `true`, origin sem chave ⇒ `release_pr`), `autonomia-ausente-x-corrompida`. Mutações **M-AUT1a** (lê `autonomia` do config local), **M-AUT1b** (ausente ⇒ `true`), **M-AUT1c** (autonomia aplicada só no ramo `continua`).
- [ ] **Step 2: RED. Step 3: Implementar;** `build.mjs`. **Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): autonomia só aperta a entrega`.

### Task 4b: Perfis de modelo

**Files:** Modify `gates/lib/config.mjs`, `gates/scripts/loop.mjs` (`modeloDoItem`, `:1053`), `gates/scripts/harness-doctor.mjs` (`modelos-por-papel`, `:678`). Test: `gates/test/lib.test.mjs`, `gates/test/harness-doctor-loop.test.mjs`, `gates/test/loop-cli.test.mjs`.

**Interfaces — Produces:**
```js
export const PERFIS_MODELO // { economia:{…}, padrao: MODELOS_PADRAO, qualidade:{…} } — valores das Global Constraints
export function resolverModelo(orquestracao, papel) // → { modelo, esforco?, fonte: 'explicito'|'perfil'|'padrao', aviso?: string }
```
Doctor: compara com a tabela do perfil escolhido. Com `economia`, 1 linha `perfil economia: review de task e spike em sonnet, review final em opus`. Perfil inválido ⇒ aviso e `padrao`.

- [ ] **Step 1: Testes:** `economia-revisor-final-opus`, `qualidade-basico-sonnet`, `explicito-vence-perfil`, `perfil-ausente-padrao`, `perfil-invalido-aviso` (ausente × inválido distintos), `proxima-item-modelo-do-perfil`, `doctor-economia-nao-avisa-abaixo-do-padrao`, `doctor-economia-linha-informar`. Mutações **M-ONB-p1** (`economia` resolve revisor_final para fable), **M-ONB-p2** (explícito perde para o perfil), **M-ONB-p3** (doctor compara com `padrao`).
- [ ] **Step 2: RED. Step 3: Implementar. Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): perfis de modelo`.

### Task 5: Fluxo Gabarito (NOM-1)

**Files:** Modify `scripts/test/texto.test.sh` (caso novo), `.claude-plugin/marketplace.json` (raiz), `plugins/gabarito-mestre/.claude-plugin/plugin.json` (description), `reference/fluxo.md`, `reference/ferramentas-mcp.json`, `skills/gabarito-conformidade/SKILL.md`, `skills/gabarito-instalar/SKILL.md` (só o nome), `gates/scripts/harness-doctor.mjs:473` (comentário), `README.md`, `docs/backlog.md`. Create `scripts/test/texto-nom.test.sh` (fixture descartável).

O caso varre com `git grep -nIiE 'workflow[ _-]?true'` os caminhos de REQ-NOM-1. Exceções: `docs/ledgers/**`, `docs/aprendizados/**`, `docs/references/**`, e specs e planos cujo prefixo `AAAA-MM-DD` é < `2026-11-10`. No `CHANGELOG.md`, ignora as linhas abaixo do 1º cabeçalho `## [1.` (seções ≤ 1.1.x). Em `reference/fluxo.md`, a citação `docs/workflow-true.html` (arquivo local, ignorado pelo git) vira "documento HTML do Flow Management Office, local do dono".

- [ ] **Step 1: Testes** em `texto-nom.test.sh` (repo git em `mktemp -d`): `nom-plantado-no-plugin-falha` (string em `plugins/gabarito-mestre/README.md` ⇒ rc 1), `nom-em-ledger-passa`, `nom-changelog-secao-110-passa`, `nom-plano-datado-antigo-passa`, `nom-plano-novo-falha` (`2026-11-10-x.md`).
- [ ] **Step 2: RED** (o repo real tem ocorrências). **Step 3:** caso + renomeação. **Step 4: GREEN:** `bash scripts/test/texto.test.sh` e o novo. **Step 5: P2 + Commit** `docs(GM-13): Fluxo Gabarito no lugar de Workflow TRUE`.

### Task 6a: Coleta e detecção do onboarding (script puro)

**Files:** Create `gates/scripts/onboarding.mjs` (coleta, detecção, CLI `detectar`), `gates/test/onboarding.test.mjs`, `gates/test/fixtures/onboarding/{completa,monorepo}/`.

**Interfaces — Consumes:** `DEFAULTS` (capacidade.mjs; nunca `medir`/`calcularSlots`), `reference/ferramentas-mcp.json`. **Produces:**
```js
export const ORDEM_ITENS = ['tipo_repo', 'ambientes', 'planejamento', 'versionamento', 'orquestracao'];
export function coletarFatos(raiz, { rodar }) // → { arquivos, packageJson, workflows, envExample, mcps: string[]|null, originHead: string|null, integracao: {[ref]: number}|null, mcpRepo: string[], configExistente } (claude mcp list e git por `rodar`; falha ⇒ null; `integracao` = contagem em 60 d por candidato de base, regra de `versionamento`; `hoje` por parâmetro)
export function detectar(fatos) // → [{ item, estado: 'detectado'|'ambiguo'|'nao_detectado', valor, fonte, candidatos: string[], motivo? }] na ORDEM_ITENS
// CLI: onboarding.mjs detectar --root <d>  → {ok, itens}   (T6b acrescenta perguntas e previa)
```
Regras (fonte em cada item):
- `tipo_repo`: marcadores de monorepo (`workspaces`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`) ⇒ `ambiguo`, candidatos `app | repo-sem-app`.
- `ambientes` (S6, Sombra): candidatos = workflows com `environment:` e workflows de deploy (`name:` ou arquivo casa `/deploy/i`) com `on.push.branches`; nome = `environment:`, senão o único branch de `on.push.branches`, senão `name:` sem `deploy-`; produção = nome casa `/prod|produc|prd/i`; prefixos `PROD_|PRODUCTION_|STAGING_|STG_|HOMOLOG_|HML_` de `.env.example` só somam candidatos. Sem workflow ⇒ `nao_detectado` (`sem CI`); CI sem candidato ⇒ `nao_detectado` (`CI sem deploy`); 1 produção ⇒ `detectado` `{producao, outros[]}`; 0 ou > 1 produção com candidatos ⇒ `ambiguo`. Fonte arquivo:linha por candidato.
- `planejamento` (S6, Sombra): (i) `fluxo.ferramenta` da config ⇒ `detectado`; (ii) senão `mcpRepo` + `mcps` casados por `ferramentas-mcp.json`: 1 ferramenta distinta ⇒ `detectado`; ≥ 2 ⇒ `ambiguo` (candidatos na ordem do JSON, default o do `.mcp.json` do repo, senão o 1º); 0 ⇒ `nao_detectado`; `mcps: null` ⇒ `nao_detectado` com motivo.
- `versionamento` (S6, Sombra): candidatos = `origin/HEAD` + refs remotas de nome exato `staging|develop|development|dev|homolog|homologacao|hml|next` (feature herda merges da base: nunca candidata). Conta first-parent em 60 d os commits merge ou com assunto terminado em `(#N)`. HEAD único com > 0 ou estritamente maior ⇒ `detectado` HEAD; outro com contagem ≥ HEAD e > 0 ⇒ `ambiguo`, candidatos por contagem decrescente, default o 1º; sem `origin/HEAD` ⇒ `nao_detectado`. Fonte cita as contagens. O valor vai em `entrega.base` (D-1).
- `versionamento` (D-1, Sombra): o trunk de `origin/HEAD` vai em `entrega.base`; `gravar` escreve só `versionamento.{modelo:'trunk', resolvidoEm}` e nunca `versionamento.branchPadrao` (é regex no R20, `versionamento-check.mjs:65-70`, e nome de branch na guarda, `guarda.ts:100`). Config existente com `branchPadrao` **literal** (casa `^[A-Za-z0-9._/-]+$`, sem metacaractere de regex) ⇒ item `nao_detectado` com motivo `branchPadrao é nome de branch (guarda), não regex (R20)` e sem `versionamento.resolvidoEm`. Testes: `fixture-completa-…` assere `entrega.base: 'trunk'` e `versionamento.branchPadrao` ausente; `branchpadrao-nome-de-branch-nao-resolve` (config com `"main"` ⇒ `nao_detectado`, sem `resolvidoEm`). Mutação **M-ONB7** (grava `branchPadrao: trunk`) morre em `fixture-completa-…`. (Detecção e `branchpadrao-…` na T6a; gravação, `fixture-completa-…-3-perguntas` e M-ONB7 na T6b.) `branchPadrao` com metacaractere é regex do dono: preservado byte a byte, nunca reescrito, e não muda o estado do item (o estado vem da base). Teste `branchpadrao-regex-real-preservado` (regex de sherlocktrue com ID `[0-9a-z]{9,11}` ⇒ estado da base; na T6b, `gravar` mantém o `branchPadrao` igual e escreve `versionamento.resolvidoEm`). Mutação **M-ONB10** (volta o teste por amostra `feat/ABC-1-1-x`) morre nele.
- `orquestracao` (S6, Sombra): `orquestracao.paralelismo.{simultaneos,teto}` da config ⇒ `detectado` (fonte config:linha); sem config ⇒ `detectado` com `DEFAULTS` de `capacidade.mjs` e fonte `DEFAULTS de capacidade.mjs (sem config)`. Nunca `medir`/`calcularSlots` (carga do momento: 1 slot nos 3 repos do S6).

- [ ] **Step 1: Testes:** `fixture-completa-tudo-detectado` (`package.json`, CI, `.env.example`, MCP ClickUp, `origin/HEAD` = `trunk` ⇒ 5 `detectado` com `fonte` não vazia), `fixture-monorepo-tres-nao-resolvidos`, `branchpadrao-nome-de-branch-nao-resolve`, `coletar-mcp-falha-x-saida-torta` (ausente ⇒ `null`; texto ilegível ⇒ `null` com motivo distinto), `ambientes-deploy-sem-environment` (`environment: deploy-producao` + `deploy-staging` com `branches:[staging]` ⇒ `{producao:'deploy-producao', outros:['staging']}`), `ambientes-ci-sem-deploy-nao-detectado`, `planejamento-config-vence-conectores`, `planejamento-duas-ferramentas-ambiguo`, `versionamento-base-integracao-ambiguo` (main 1 × staging 3 ⇒ `ambiguo` [staging, main], default staging), `versionamento-so-head-detectado`, `versionamento-feature-nao-e-candidata`, `orquestracao-ignora-carga` (sem config e carga alta ⇒ 2/4 com fonte DEFAULTS), `s6-gabarito-zero-errado` (compara só `estado` e `valor`, contagens envelhecem; roda `detectar` nos 3 repos do S6 só se existirem; senão `skip` com motivo; compara com `s6-gabarito.json`). Mutação **M-ONB2** (fato detectado sai como não resolvido e vira pergunta) morre em `fixture-completa-tudo-detectado`. Mutações **M-ONB8** (ignora workflow de deploy sem `environment:`) morre em `ambientes-deploy-sem-environment`; **M-ONB9** (base = sempre `origin/HEAD`) morre em `versionamento-base-integracao-ambiguo`; **M-ONB11** (usa `calcularSlots`) morre em `orquestracao-ignora-carga`.
- [ ] **Step 2: RED. Step 3: Implementar. Step 4: GREEN;** S6 com 0 errado (errado > 0 ⇒ corrigir antes de seguir). **Step 5: P2 + Commit** `feat(GM-13): onboarding detecta fatos com fonte`.

### Task 6b: Perguntas, prévia e gravação do onboarding

**Files:** Modify `gates/scripts/onboarding.mjs` (perguntas, prévia, config, CLI `gravar`), `gates/scripts/onboarding-config.mjs` (`SECOES` += `entrega`, `onboarding`; `aplicarPerfil`), `gates/test/onboarding.test.mjs`.

**Interfaces — Consumes:** T6a, `PERFIS_MODELO` (T4b), `aplicar`/`aplicarEm` (onboarding-config). **Produces:**
```js
export function perguntas(itens, existente) // → [{ id, texto, opcoes:[{valor, rotulo}], default }] ≤ 5
export function previa(itens, perguntasFixas) // → string: 'detectei: …', 1 fato por linha com estado e fonte, as 3 decisões com default, linha 'trocar <item>'
export function configDasRespostas(itens, respostas, existente, hoje) // → { patches: { [secao]: object }, perfil?: 'repo-sem-app', naoDetectado: string[] }
export function aplicarPerfil(root, valor, opts) // onboarding-config.mjs: só 'repo-sem-app'; mesmo aplicarEm (merge, diff, tmp + rename)
// CLI: onboarding.mjs detectar --root <d>  → {ok, itens, perguntas, previa}
//      onboarding.mjs gravar --root <d> --respostas <arquivo.json> [--dry-run] → {ok, diff, naoDetectado}
```
Fixas: (a) `entrega.politica`, default `sob_demanda` ou a existente. (b) `entrega.autonomia`, default `não`; `sim` com config `continua|janela` sem `autonomia`; com (a) ≠ `sob_demanda`, o rótulo de "não" é `a entrega vira sob demanda: PR de release, você faz merge e deploy`. (c) `orquestracao.perfil`, default `padrao` ou o existente. Janela escolhida sem janela no config ⇒ `{dias:[1,2,3,4,5], inicio:'09:00', fim:'17:00', fuso:<Intl>}`, mostrada na prévia (c, planejador). A prévia mostra a política efetiva quando difere da escolhida.

Mapa fato → chave (D-6, Sombra): `tipo_repo` ⇒ `perfil` na raiz, só `repo-sem-app` (`aplicarPerfil` novo em `onboarding-config.mjs`, mesmo `aplicarEm`); `planejamento` ⇒ `fluxo.ferramenta`/`fluxo.mcp`; `versionamento` ⇒ D-1 (base detectada ou escolhida na condicional ⇒ `entrega.base`; `branchPadrao` existente nunca tocado); `orquestracao` ⇒ nada a gravar (config existente fica; com fonte DEFAULTS, não fixa o default); `ambientes` ⇒ `onboarding.fatos.ambientes` (nunca `guarda.*`; prévia diz que é informativo); janela padrão ⇒ `entrega.janela`; não resolvidos ⇒ `onboarding.naoDetectado` na ordem de `ORDEM_ITENS`. `SECOES` += `entrega`, `onboarding`. Testes `gravar-nunca-toca-guarda` (config com `guarda` byte a byte igual depois), `gravar-perfil-so-repo-sem-app`.

`*.resolvidoEm` (D-2, Sombra): uma execução de `gravar` escreve `fluxo.resolvidoEm`, `versionamento.resolvidoEm` (salvo D-1), `orquestracao.modelo.resolvidoEm` e `onboarding.resolvidoEm` com `hoje` (parâmetro). `orquestracao.modelo.alias` = `orquestracao.modelos.revisor_final` explícito, senão o `revisor_final` do perfil; `politica` e `validadeDias` existentes ficam (ausentes ⇒ `mais-potente`, 90). `fluxo` recebe só `ferramenta`, `mcp` e `resolvidoEm`. A skill não cita nenhum `resolvidoEm`. Teste `gravar-resolvidoEm-uma-execucao` (as 4 datas iguais a `hoje`, alias `opus` com `economia`) e `gravar-cartao-sai-do-sem-onboarding` (P9: `gravar` real ⇒ `coletar` do cartão com `semOnboarding:false`).

- [ ] **Step 1: Testes:**
  - `fixture-completa-tudo-detectado-3-perguntas`: 3 perguntas; config com `entrega.base: 'trunk'` e `versionamento.branchPadrao` ausente (D-1).
  - `fixture-monorepo-5-perguntas`: sem CI nem conector ⇒ 3 fixas + 2 condicionais; o 3º fato em `naoDetectado` e sem valor gravado.
  - Demais: `fixa-ordem-e-defaults`, `default-de-config-110` (config 1.1.x vira default), `autonomia-default-sim-com-continua-legada`, `rotulo-nao-com-continua`, `previa-mostra-efetiva`, `previa-todo-item-tem-fonte`, `gravar-dry-run-nao-escreve`, `gravar-resolvidoEm-uma-execucao`, `gravar-cartao-sai-do-sem-onboarding`, `gravar-nunca-toca-guarda`, `gravar-perfil-so-repo-sem-app`, `gravar-respostas-ausente-x-corrompidas`, `gravar-orquestracao-defaults-nao-fixa`, `gravar-preserva-branchpadrao-regex`.
  - Mutações **M-ONB1** (pula uma fixa), **M-ONB3** (6ª pergunta), **M-ONB4** (grava default acima do teto), **M-ONB5** (item sem fonte na prévia), **M-ONB7** (grava `branchPadrao: trunk`).
- [ ] **Step 2: RED. Step 3: Implementar. Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): onboarding pergunta só decisões e grava a config`.

### Task 7a: `aprender` no loop e mod-nega no núcleo

**Files:** Modify `gates/src/loop.ts`, `gates/src/pouso.ts` (`negaDespacho`), `gates/src/painel.ts` (`LIMPA_PARAR` = `TIPOS_DE_PROGRESSO` menos `aprendizado`, `aprendizado.nada`, mais `entrega.inicio`; D-5). Ajuste aditivo de fixture nos testes que integram tudo ou gravam MAJOR (`loop.test.ts`, `loop-cli.test.mjs`, `pouso.test.ts`, `fumaca-{loop,e3,e4}`, `painel-cli.test.mjs`, `painel-costura.test.mjs`, `entrega-cli.test.mjs`, `liberar-teto.test.mjs`, `anel-worktree.test.mjs`, `avaliar-*.test.mjs`, `test/e2e/avaliar*.mjs`), mais `painel.test.ts`. O helper `fecharPendencias(eventos)` em `gates/test/_adaptador-helpers.mjs` grava `aprendizado.nada`. Cada teste ajustado é listado no relatório, com o motivo "REQ-APR-2 muda a ordem".

**Ajuste só aditivo (Sombra).** Em teste que já existia, a única mudança permitida é inserir `fecharPendencias(...)` (ou o evento `aprendizado.nada` equivalente) antes da asserção. Linha removida ou alterada fora disso ⇒ parar e citar a linha no relatório. Prova do revisor: (1) `git diff <base> -- <testes ajustados> | grep -E '^-[^-]'` = 0 linhas, salvo as citadas; (2) a contagem de `test(`/`it(` por arquivo não cai; (3) mutação **M-T7h** "`fecharPendencias` não grava nada" faz cair ≥ 1 teste de cada arquivo ajustado. Arquivo que não cai é ajuste inútil e sai do diff. `fecharPendencias` fecha só o que `pendenciasAprendizado` do `dist/` devolve, nunca um `nada` cego.

**Interfaces — Consumes:** `pendenciasAprendizado` (T3). **Produces:**
- `proximaAcao`: logo depois de (4b), `pendencias.length > 0` ⇒ `{tipo:'aprender', pendencias}`.
- `TIPOS_DE_PROGRESSO` += `'aprendizado','aprendizado.nada'`; `LIMPA_PARAR` do painel os exclui.
- `negaDespacho`: `aprender` ⇒ `true` sempre.

- [ ] **Step 1: Testes:**
  - `loop.test.ts`: `tres-integradas-aprender-com-terceiro`, `aprender-fechado-concluir`, `major-acima-de-x-aprender-nao-pousar`, `aprender-depois-de-4b` (pausado vence), `despachar-bloqueado-com-pendencia`, `proxima-pendencias-ausente-x-corrompido`.
  - `pouso.test.ts`: `nega-com-aprender-mesmo-consumida`. `entrega-cli.test.mjs`: `entrega-recusa-com-pendencia`. `painel.test.ts`: `painel-parar-segue-depois-de-aprendizado`.
  - Mutações **M-APR2a** (despacha com pendência), **M-APR2g** (`LIMPA_PARAR` sem a exclusão) e **M-T7h**.
- [ ] **Step 2: RED. Step 3: Implementar;** `build.mjs`. **Step 4: GREEN;** `npm test` inteiro. **Step 5: P2 + Commit** `feat(GM-13): loop aprende antes de pousar e de concluir`.

### Task 7b: Stop avisa pendência de aprendizado

**Files:** Modify `gates/scripts/stop-loop.mjs`, `.gitignore` (raiz: `.harness/stop-aprender.json*`). Test: `gates/test/stop-loop.test.mjs` (casos novos + ajuste só aditivo da T7a). Consome T7a; T8 e T10 não dependem desta.

**Produces:** Stop: a pendência é avaliada **antes** da regra "loop.parar ⇒ silêncio". O estado fica em `.harness/stop-aprender.json {entrega, avisados: string[]}` (`"sessao:seq"`), gravado por tmp + rename. Pendência não avisada ⇒ `{decision:'block', reason}`, com `reason` = `Loop da entrega <e> tem aprendizado pendente: <tipo> <sessao:seq>, …. Feche com loop.mjs aprendizado <E|A> <D|M> --gatilho <sessao:seq> --regra <t> --entra-em <a> ou loop.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>.`. Todas já avisadas ⇒ `systemMessage` com o mesmo comando, sem block. Estado ausente ⇒ vazio; corrompido ⇒ recomeça com causa no aviso; não grava ⇒ aviso, sem block.

- [ ] **Step 1: Testes:** `dois-stops-block-depois-aviso`, `aprender-apos-loop-parar-ainda-block`, `stop-aprender-ausente-x-corrompido`, `parar-sem-progresso-do-stop-sem-pendencia`. Mutação **M-APR2t** (era M-APR2d, colide com a T3) (`block` sempre).
- [ ] **Step 2: RED. Step 3: Implementar. Step 4: GREEN;** `npm test` e hooks. **Step 5: P2 + Commit** `feat(GM-13): Stop avisa aprendizado pendente`.

### Task 8: CLI do aprendizado e aprendizados no despacho

**Files:** Modify `gates/scripts/loop-aprendizado.mjs` (`aprendizado`, `aprendizados`), `gates/scripts/loop.mjs` (`enriquecer`, `:1203`). Test: `gates/test/loop-aprendizado.test.mjs`, `gates/test/loop-cli.test.mjs`.

**Interfaces — Produces:**
```
loop.mjs aprendizado <E|A> <D|M> --regra <t> --entra-em <a,b> [--gatilho <sessao:seq>] [--eventos <s:q,…>] [--fonte <f> --numero <n>] [--substitui [<entrega>/]<sessao:seq>]
loop.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>
loop.mjs aprendizados [--para <instantaneo|spec|brief:<papel>>]   # não exige entrega na branch; lista D vigentes da árvore
proxima: item despachar ganha aprendizados: string[] (regra de paraDestino(vigentes, `brief:${papel}`))
```
Ordem do CLI:
1. forma (T1);
2. `fonte` de arquivo ⇒ `git ls-files --error-unmatch -- <fonte>` na raiz principal; falha ⇒ `erro: 'fonte_nao_versionada'`, mensagem com `grave como M`;
3. `validarAprendizado` (T2), com códigos de erro iguais aos motivos;
4. `gravar`.

`gatilho` precisa ser pendência aberta ou evento existente da entrega. `aprendizado nada` só com gatilho de pendência aberta (erro `pendencia_inexistente`, nada gravado; D-5, Sombra).

- [ ] **Step 1: Testes:** `aprendizado-d-com-evento-grava`, `nada-sem-pendencia-recusa`, `aprendizado-fonte-nao-versionada-recusa` (arquivo criado e não adicionado), `aprendizado-fonte-inexistente-recusa`, `aprendizado-numero-nan-recusa`, `aprendizado-brief-sombra-recusa`, `nada-fecha-e-proxima-segue`, `regra-canario-recusa` (nada gravado), `aprendizados-sem-entrega-na-branch`, `proxima-item-revisor-sem-implementador`, `proxima-m-nunca-no-item`, `aprendizado-diario-ausente-x-ilegivel`. Mutações **M-APR1b** (pula `ls-files`) e **M-APR3a** (M no brief).
- [ ] **Step 2: RED. Step 3: Implementar. Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): aprendizado pelo CLI e no brief do papel`.

### Task 9: Instantâneo, cartão e linha de retomada

**Files:** Modify `gates/src/diario.ts` (`projetar`, `pousoSemRetomada`), `gates/scripts/cartao-sessao.mjs` (`montarSaidaHook`, `:515-575`; `:298,330` "fase N" ⇒ `gabarito-instalar (trocar <item>)`, Sombra 2d.2). Test: `gates/test/diario.test.ts`, `gates/test/cartao-sessao.test.mjs`.

**Interfaces — Consumes:** `aprendizadosVigentes`, `paraDestino`, `lerAprendizados` (T2). **Produces:**
```ts
export function projetar(eventos: Evento[], opcoes?: { aprendizados?: AprendizadoVigente[] }): { …atual; aprendizados: number };
// bloco "Aprendizados (<n>):" depois das decisões, D com `instantaneo`, linha `<E|A> <regra cortada em 160, sem controle>`, ≤ 800 com rodapé; sem D ⇒ nenhuma linha
export function pousoSemRetomada(eventos: Evento[]): boolean;   // último sessao.pouso sem sessao.retomada nem loop.parar posteriores (ordem de `ordenar`); fora de ordem ⇒ false
```
```js
export function montarContexto({ cartao: string, instantaneo: string, retomada: string | null }, limite = LIMITE_CONTEXTO) // → string ≤ limite
// ordem no texto: retomada, cartão, instantâneo; corte: cartão, depois instantâneo; retomada nunca
```
Cartão: origem `clear|resume|startup` e `pousoSemRetomada` ⇒ `retomada = 'Loop da entrega <id> em pouso: rode loop.mjs proxima e siga.'`. O instantâneo leva `lerAprendizados(<raiz>/.harness/entregas)`. Nenhum evento novo gravado.

- [ ] **Step 1: Testes:** `instantaneo-aprendizados-ate-800`, `instantaneo-linha-160`, `instantaneo-conta-fora`, `instantaneo-total-3200-com-decisoes-1600`, `instantaneo-sem-d-igual-e4` (byte a byte), `instantaneo-m-nunca`, `regra-com-controle-uma-linha`, `pouso-sem-retomada-e-com-retomada`, `pouso-com-parar-depois-nao-traz`, `cartao-clear-traz-linha`, `cartao-cheio-com-retomada-ate-4329-linha-presente` (recalcula o T11), `hook-grava-zero-sessao-retomada` (conta eventos `sessao.retomada` gravados pelo hook = 0), `cartao-diario-ausente-x-corrompido`. Mutações **M-APR3b** (linha de retomada cortada antes do cartão) e **M-POU3a** (hook grava `sessao.retomada`).
- [ ] **Step 2: RED. Step 3: Implementar;** `build.mjs`. **Step 4: GREEN;** número do S4 sintético conferido no relatório. **Step 5: P2 + Commit** `feat(GM-13): aprendizado e retomada no instantâneo e no cartão`.

### Task 10: Mod — mensagem do dono, retomada e negação por pendência

**Files:** Modify `mod/gabarito.mjs` (`executarPouso :142-168`, `prompt.submit :536`, `tool.call Agent :567`), `gates/src/pouso.ts` (`codigoPonte`: op `mensagem` e `instantaneo` com aprendizados). Test: `mod/test/gabarito.test.ts`, `gates/test/pouso.test.ts`.

**Interfaces — Consumes:** T7a (`negaDespacho`), T9 (`projetar` com opções), `pendenciasAprendizado` do `dist/`, S1. **Produces:**
- ponte `{op:'mensagem', dir, cwd, texto}` calcula `sha256` e `chars` em node e grava `dono.mensagem` na sessão `dono`; o texto nunca vai ao diário.
- ponte `{op:'instantaneo'}` passa `lerAprendizados(dirname(dir))`.
- `prompt.submit`: `origin.kind ∈ {composer, bridge}`, sem `e.command`, `text.trim() !== ''` e `loopAtivo` ⇒ op `mensagem` (falha ⇒ aviso, nunca bloqueia o prompt).
- `executarPouso`: submit falho depois do `/clear` ⇒ aviso exato das Global Constraints, `store` limpo, nenhum `loop.parar`; sucesso ⇒ `sessao.retomada {via:'mod', chars}`.
- `tool.call Agent` não revisor com porta `permitir`: lê diário e plano e nega se `pendenciasAprendizado(...)` não for vazio, com o texto `aprendizado pendente: feche antes de despachar`. O motivo de negação do mod (`mod/gabarito.mjs:230-233`) usa o mesmo texto, nunca `aprender` cru (Sombra 2d.4).

- [ ] **Step 1: Testes** (mod): `so-composer-grava` (origens `composer`, `peer`, `plugin`, `scheduled-trigger`, `composer`+`command` ⇒ 1 evento), `bridge-grava`, `origem-ausente-nao-grava`, `texto-vazio-nao-grava`, `mensagem-nunca-o-texto` (sentinela ausente de todo jsonl), `sem-loop-nao-grava`, `submit-pos-clear-falha-sem-parar` (0 `loop.parar`, 1 `sessao.pouso`, aviso exato), `falha-antes-do-clear-sem-pouso`, `retomada-via-mod`, `um-so-clear`, `agent-negado-com-pendencia-abaixo-de-x`, `revisor-passa-com-pendencia`, `ponte-mensagem-ausente-x-corrompida`. Mutações **M-APR2w** (aceita `peer`) e **M-POU3b** (submit pós-`/clear` grava `loop.parar`), por `cd .. && bash scripts/test/mod-test.sh`.
- [ ] **Step 2: RED. Step 3: Implementar;** `build.mjs`. **Step 4: GREEN;** `mod-test.sh`; `claude plugin validate .`. **Step 5: P2 + Commit** `feat(GM-13): mod grava mensagem do dono e retoma pelo contexto`.

### Task 11: Registro de decisões

**Files:** Modify `gates/src/registro.ts`, `gates/scripts/loop-aprendizado.mjs` (`registro`). Create `gates/test/registro.test.ts`. Test: `gates/test/loop-aprendizado.test.mjs`.

**Interfaces — Produces:** `export function montarRegistro(entrega: string, eventos: Evento[], specSha: string | null): string`, com seções fixas na ordem: Aprovação da spec · Decisões da Sombra (resposta curta + fontes/medição) · Emendas (aprovadas e rejeitadas, `origem`) · Liberações de teto (`task.reaberta {dono}`) · Desvios · Descobertas · Aprendizados D · Aprendizados M (fonte e número). Ordem interna por `ordenar`; sem `Date.now()`; texto sem controle. Seção vazia ⇒ `- nenhum`. CLI `loop.mjs registro` grava `<dirEntrega>/registro.md` por tmp + rename e devolve `{ok, arquivo, sha256}`; diário ilegível ⇒ `diario_ilegivel`, nada gravado.

- [ ] **Step 1: Testes:** `registro-mesmo-diario-mesmo-byte` (2 rodadas), `registro-ordem-de-chegada-nao-muda` (eventos embaralhados), `registro-secoes-vazias`, `registro-m-com-fonte-e-numero`, `registro-dono-e-sombra-julgaram`, `registro-cli-grava-e-relê`, `registro-diario-ausente-x-ilegivel`. Mutação **M-REG1** (sem `ordenar`: ordem de chegada muda o registro).
- [ ] **Step 2: RED. Step 3: Implementar;** `build.mjs`. **Step 4: GREEN. Step 5: P2 + Commit** `feat(GM-13): registro de decisões determinístico`.

### Task 12: Pouso sem mod

**Files:** Modify `gates/scripts/loop-aprendizado.mjs` (`pousar`). Test: `gates/test/loop-aprendizado.test.mjs`.

**Interfaces — Produces:** `loop.mjs pousar` → `{ok, evento, instantaneo}`. Grava `sessao.pouso {percent:null, x, via:'dono'}` (`x` de `GABARITO_POUSO_X`, ou 50) só com 0 tasks em `implementando|corrigindo|em_revisao`; senão `erro:'task_em_voo'` citando a task, nada gravado. Imprime o instantâneo de `projetar(…, {aprendizados})`.

- [ ] **Step 1: Testes:** `pousar-com-task-implementando-recusa`, `pousar-na-fronteira-grava`, `pousar-cartao-traz-linha` (P9: `pousar` real, depois `montarSaidaHook` com `source:'clear'`), `pousar-diario-ausente-x-ilegivel`. Mutação **M-POU3c** (pousa com task em voo).
- [ ] **Step 2–4. Step 5: P2 + Commit** `feat(GM-13): pouso pelo dono sem mod`.

### Task 13: Doctor sem destino

**Files:** Modify `gates/src/aprendizado.ts` (`avisosAprendizado`), `gates/scripts/harness-doctor.mjs` (checks `aprendizado-sem-destino` e `onboarding-nao-detectado`, ambos `level:'warn'`; linha `loop: sem mod` ganha `· sem gatilho de mensagem do dono`; fix/label do doctor :479,:480,:501,:665 ⇒ `gabarito-instalar (trocar <item>)`, Sombra 2d.2). Test: `gates/test/aprendizado.test.ts`, `gates/test/harness-doctor-loop.test.mjs`.

**Interfaces — Produces:** `export function avisosAprendizado(porEntrega: Map<string, Evento[]>, planos: Map<string, Plano>, papeis: readonly string[]): string[]`. Cada aviso traz o comando que fecha:
- pendência aberta numa entrega com todas as tasks integradas;
- `brief:<papel>` fora de `papeis`;
- M com **mais de 2** entregas cujo menor `ts` é posterior ao do M, sem `substitui` (lido de `aprendizadosVigentes`: substituído por outra entrega não avisa).

`onboarding-nao-detectado`: um aviso por item de `onboarding.naoDetectado` (D-6) com `trocar <item>` e o motivo, se houver (D-1: `branchPadrao é nome de branch (guarda), não regex (R20)`). Nunca muda o nível.

- [ ] **Step 1: Testes:** `m-tres-entregas-depois-avisa`, `m-substituido-por-outra-entrega-silencio`, `m-duas-entregas-silencio`, `pendencia-em-entrega-concluida-avisa`, `papel-removido-avisa`, `doctor-sem-mod-cita-mensagem`, `doctor-nao-detectado-avisa-sem-bloquear`, `avisos-ausente-x-corrompido`. Mutação **M-APR4** (`>= 2`).
- [ ] **Step 2–4;** `build.mjs`. **Step 5: P2 + Commit** `feat(GM-13): doctor avisa aprendizado sem destino`.

### Task 14: Skill `gabarito-instalar` em fase única

**Files:** Rewrite `skills/gabarito-instalar/SKILL.md` (≤ 140 linhas; mantém `## Modo --vincular <PBI>` e `## Proibido`). Modify `scripts/test/texto.test.sh` (troca os checks de fases 2–4, B5, `4 seções '## Fase '`, `capacidade --sugerir` da 4.3 pelos de fase única; caso novo: `git grep -nE 'fase [2-4]|\(fase' -- gates/scripts reference skills` sem saída, fora de comentário de ruling), `reference/adocao.md:55,129` ("fase N" ⇒ `gabarito-instalar (trocar <item>)`, Sombra 2d.2). Create `gates/test/onboarding-skill.test.mjs`.

Fluxo da skill:
1. harness 1.1.x presente ⇒ `instalar.sh --atualizar`; senão `instalar.sh`;
2. `onboarding.mjs detectar`;
3. mostrar a `previa`;
4. as perguntas na ordem devolvida (3 fixas + condicionais), Enter confirma;
5. respostas em `.claude-tmp/onboarding-respostas.json`;
6. `onboarding.mjs gravar`;
7. doctor `--explain`, com a distância até a esteira padrão;
8. fechamento com `trocar <item>` em 1 linha.

Fora das perguntas (D-3, Sombra): settings do time, CODEOWNERS, Apêndice, Iniciativa e `arquivosDeContenda` não são gravados; a linha de fechamento os lista com `trocar <item>`. "trocar settings" mantém os 2 consentimentos separados sem default `sim`; "trocar iniciativa" pede ok antes de ler a ferramenta. Teste `skill-fora-das-perguntas-so-no-trocar`.

"trocar <item>" regrava só aquele item pelo `gravar`. Nenhuma saída manda o usuário copiar ou digitar comando.

- [ ] **Step 1: Testes** (`onboarding-skill.test.mjs`): `skill-3-fixas-na-ordem` (as 3 cabeças de pergunta na ordem), `skill-condicionais-so-do-script` (texto manda perguntar só os itens de `perguntas`), `skill-sem-resolvidoEm`, `skill-sem-fase`, `skill-sem-comando-para-colar` (nenhuma linha "cole/copie/digite" seguida de bloco de comando e nenhuma ocorrência de `--set`/`--tudo`), `skill-cita-trocar`, `skill-atualizar-com-110`, `skill-fora-das-perguntas-so-no-trocar`. Mutação **M-ONB6** (skill imprime comando para colar).
- [ ] **Step 2–4;** `texto.test.sh` verde; `claude plugin validate .`. **Step 5: P2 + Commit** `feat(GM-13): onboarding numa fase com 3 decisões`.

### Task 15: Skills do loop e da conformidade, versão alpha.5

**Files:** Modify `skills/gabarito-loop/SKILL.md`, `skills/gabarito-conformidade/SKILL.md` (+ `Bash(node:*)` em `allowed-tools`), `.claude-plugin/plugin.json` e `gates/package.json` (`2.0.0-alpha.5`), `gates/test/package.test.mjs`, `gates/test/skills-shell.test.mjs`, `scripts/test/texto.test.sh` (versão), `CHANGELOG.md`.

Loop:
- `aprender` ⇒ fechar cada pendência com `aprendizado` ou `aprendizado nada` antes de qualquer despacho;
- `aprendizados[]` do item vão no brief;
- rodar a entrega sob `/loop` dinâmico (S3);
- sem mod: na fronteira, `pousar` e pedir ao dono, em 1 linha, que digite `/clear`;
- `concluir` ⇒ `registro`, commit do `registro.md`, depois Entrega.

Conformidade: ao conferir spec nova, `loop.mjs aprendizados --para spec`, listando os D e marcando os que a spec não trata. Teto da skill do loop: **95** linhas (o de 80 vira 95, motivo no relatório).

- [ ] **Step 1: Testes:** `skill-loop-cita-aprender-pousar-registro-loop-dinamico` (grep), `skill-loop-ate-95-linhas`, `skill-conformidade-lista-d-com-spec`, versão `2.0.0-alpha.5` em `package.test.mjs` e `texto.test.sh`.
- [ ] **Step 2–4;** `claude plugin validate .`. **Step 5: P2 + Commit** `enabler(GM-13): skills do loop e da conformidade, versão alpha.5`.

### Task 16: Fumaça sem LLM

**Files:** Create `gates/test/fumaca-e5.test.mjs`, `gates/test/fumaca-e5/{caminhada.mjs,plano.json,spec.md}`. Entra em `npm test`. Usa só CLIs reais e `dist/` (P9).

- [ ] **Step 1:** `fumaca-aprende-e-volta`: plano de 3 tasks; review MAJOR na T1 ⇒ `proxima` = `aprender`; `aprendizado E D --eventos <veredito> --entra-em instantaneo,brief:implementador` ⇒ `projetar` (instantâneo), `montarSaidaHook` (cartão, `source:'clear'`, depois de `pousar`) e o item `implementador` de `proxima` trazem a regra. T3 integrada ⇒ `aprender{fechamento}` ⇒ `nada` ⇒ `concluir`.
- [ ] **Step 2:** `fumaca-registro-determinístico` (`registro` 2× ⇒ mesmo `sha256`), `fumaca-doctor-pendencia-aberta`, `fumaca-onboarding-respostas` (3 fixas + condicionais, inclusive config 1.1.x como default ⇒ config esperada byte a byte).
- [ ] **Step 3: GREEN** em `npm test`. **Step 4: P2 + Commit** `test(GM-13): fumaça sem LLM da E5a`.

### Task 17: Aceites com TUI, S4 real e dogfooding

**Depende de todas.** Sem código de produto; defeito volta à task dona. **Files:** Create `gates/test/e2e/{aceite-e5.exp,plano-e5.json,avaliar-e5.mjs}` (fora de `npm test`). Modify `harness.config.json` (raiz, pelo onboarding), `docs/ledgers/GM-13.md`. Commit `.harness/entregas/GM-13/registro.md`.

- [ ] **Step 1: Aceite 1** (TUI, `auto`, haiku, pty 180×50, limite: um terminal, sem mouse): pouso com `GABARITO_POUSO_X` baixo, `/clear` e retomada sem digitar nada; o instantâneo traz o aprendizado do gatilho anterior. Uma mensagem digitada grava `dono.mensagem` com `composer`; a retomada do mod (`plugin`) não grava (S2).
- [ ] **Step 2: Aceite 2:** `prompt.submit` forçado a falhar depois do `/clear` ⇒ 1 `sessao.pouso`, 0 `sessao.retomada`, 0 `loop.parar`, ≥ 1 evento de progresso depois (wakeup, S3), 1 só `/clear`.
- [ ] **Step 3: S4 real** com o diário da GM-13: caracteres do instantâneo e do cartão; decisões e linha de retomada intactas.
- [ ] **Step 4: Dogfooding** com o código da branch: `onboarding` neste repo (prévia, perguntas ≤ 5, nenhum comando para colar, doctor) e `loop.mjs registro` da GM-13; `registro.md` commitado. Os aprendizados do orquestrador seguem em `docs/aprendizados/`.
- [ ] **Step 5: Evidência** no ledger; P2; commit `test(GM-13): aceites da E5a e dogfooding`. Depois: review final Fable da branch e PR para `next`.

### Task 18: Virada 2.0.0 — **BLOQUEADA PELO DONO** (D13: aceite final num projeto dele, com a alpha.5)

**Files:** Modify `.claude-plugin/plugin.json`, `gates/package.json`, `gates/test/package.test.mjs`, `scripts/test/texto.test.sh` (`2.0.0`), `CHANGELOG.md` (`## [2.0.0]`). Create `docs/virada-2.0.md`: como instalar; "rode o onboarding" para quem tem 1.1.x; como voltar (tag `gabarito-mestre--v1.1.0`); backlog conhecido (MINORs GM-9..GM-13, E5b, E6, importação de E1–E50). Backlog 2.1 (item B da Sombra, segurança, dono Gabriel, gatilho "virada"): a guarda lê `versionamento.branchPadrao` como nome da branch de produção, mas o onboarding 1.1 grava ali uma regex; nesses repos `git push origin main` não é `prod` (`classificar-alvo.ts:326,345`). A E5a não piora isso (D-1); correção: guarda lendo `entrega.base` ou `guarda.ambientes.prod.branches` explícito.

- [ ] **Step 1:** só depois do registro do aceite do dono no ledger (itens 1–5 de D13); versão 2.0.0 e nota; CI 100 % verde; commit `release(GM-13): 2.0.0`.
- [ ] **Step 2:** o **dono** faz o merge `next ⇒ main`; no conflito, `marketplace.json` fica com `"name": "gabarito-mestre"`. Depois, `next` avança por fast-forward até `main` (D11) e só então recebe alphas 2.1 como `gabarito-mestre-next`. O agente não faz merge.

---

## Cobertura REQ → task

| REQ | Task(s) | Teste âncora | Mutação |
|---|---|---|---|
| APR-1 | T1 (forma), T2 (existência), T8 (CLI) | `forma-aprendizado-brief-sombra-recusa`, `aprendizado-fonte-inexistente-recusa`, `forma-aprendizado-numero-texto-e-nan-recusa`, `forma-substitui-entrega-invalida` | M-APR1c D sem evidência (T1); M-APR1b pular `ls-files` (T8) |
| APR-2 | T1, T3, T7a, T7b, T8, T10 | `tres-integradas-aprender-com-terceiro`, `cinco-mensagens-uma-pendencia`, `dois-stops-block-depois-aviso`, `so-composer-grava`, `nada-sem-pendencia-recusa`, `painel-parar-segue-depois-de-aprendizado` | M-APR2a despachar (T7a), 2b âncora (T3), 2c 1/mensagem (T3), 2t/2u/2v `block` sempre e extras (T7b; 2d/2e são da T3), 2w `peer` (T10), 2f chave extra (T1), 2g `LIMPA_PARAR` (T7a), M-T7h ajuste aditivo (T7a) |
| APR-3 | T2, T8, T9, T15 | `proxima-item-revisor-sem-implementador`, `cartao-cheio-com-retomada-ate-4329-linha-presente` | M-APR3a M no brief (T8), 3b linha cortada (T9) |
| APR-4 | T13 | `m-tres-entregas-depois-avisa`, `m-substituido-por-outra-entrega-silencio` | M-APR4 `>= 2` |
| REG-1 | T11, T15 | `registro-mesmo-diario-mesmo-byte` | M-REG1 ordem de chegada |
| POU-3 | T9, T10, T12, T15 | `cartao-clear-traz-linha`, `submit-pos-clear-falha-sem-parar`, `pousar-com-task-implementando-recusa` | M-POU3a hook grava (T9), 3b `loop.parar` (T10), 3c em voo (T12) |
| ONB-1 | T4b (perfis), T6a, T6b, T9/T13/T14 (texto "fase N"), T13, T14 | `fixture-monorepo-5-perguntas`, `fixture-completa-tudo-detectado-3-perguntas`, `branchpadrao-nome-de-branch-nao-resolve`, `skill-3-fixas-na-ordem` | M-ONB2 (T6a), M-ONB1/3/4/5/7 (T6b), M-ONB6 (T14), M-ONB-p1–p3 (T4b) |
| AUT-1 | T4a | `continua-autonomia-ausente-false-e-sim-texto-sob-demanda` | M-AUT1a–c |
| NOM-1 | T5 | `nom-plantado-no-plugin-falha`, `nom-em-ledger-passa` | remover o caso ⇒ `nom-plantado` passa |
| DOG-1 | T0 (plano.json), T17 (onboarding) + D13 item 4 (`registro.md`) | onboarding neste repo; `registro.md` no aceite do dono (emenda Sombra, ledger GM-13 R33) | — |
| VIR-1 | T18 (bloqueada) | CI verde + merge do dono | — |
| S1–S6 | T0 (S1, S3, S4 sint., S5, S6), T17 (S2, S4 real) | relatórios | — |

## Execução: modelo, P1 e estimativa

Sonnet 5.5 `high` em tudo, exceto: T0 Opus 5.5 (spike); T5, T12 e T15 Haiku 5.5 (texto e ligação). P1 em lote (Sombra): {T3,T4a}, {T6a,T6b,T7a,T7b}, {T8,T9}, {T10} após S1, {T14}. 21 unidades até a T17 (18 + 3 partições). Estimativa da Sombra (medição E3 26,0 e E4 32,5 min/unidade, +23 % de não planejadas): **≈ 12h30 de relógio (11h11–13h59)** até a T17, sem espera do dono; riscos acima: S3 REFUTADA, S6 com > 2 fatos não resolvidos, TUI da T17.

## Decisões da Sombra (`sombra-plano.md`)

- **D-1 (A):** trunk em `entrega.base`; `gravar` nunca escreve `versionamento.branchPadrao`; `branchPadrao` existente que reprova `feat/<ID>-1-x` ⇒ `versionamento` `nao_detectado` com motivo (T6a/T6b, T13); emenda de texto do ONB-1 na spec.
- **D-2 (A):** uma execução de `gravar` escreve os 4 `resolvidoEm` com `hoje`; `orquestracao.modelo.alias` do `revisor_final`; `fluxo` só `ferramenta`/`mcp`/`resolvidoEm` (T6b); "fase N" ⇒ `trocar <item>` (T9, T13, T14).
- **D-3 (A, default):** settings, CODEOWNERS, Apêndice, Iniciativa e `arquivosDeContenda` só no `trocar <item>` do fechamento (T14).
- **D-4 (A):** `substitui: {sessao, seq, entrega?}` com `ENTREGA_RE`, ausente = corrente (T1, T13); emenda de texto do APR-1 na spec.
- **D-5 (A):** `aprendizado.nada` só com pendência aberta (T8); `LIMPA_PARAR` do painel exclui os 2 tipos novos (T7a).
- **D-6 (A):** mapa fato → chave com `aplicarPerfil` só `repo-sem-app`, `ambientes` só informativo em `onboarding.fatos`, nunca `guarda.*` (T6b).
- **S6 (`sombra-s6.md`, A):** regras de detecção do onboarding corrigidas (ambientes por workflow de deploy, planejamento config > conectores, base de versionamento = `origin/HEAD` ou integração com mais merges, orquestração sem carga, `branchPadrao` regex preservado); 5 perguntas por repo, 0 errado (T6a/T6b; emenda de texto do ONB-1 na spec).
- **Item B (só o dono, fora da E5a):** guarda × `branchPadrao` vai como linha de backlog 2.1 na nota da virada (T18); não muda o plano.

## Autorrevisão (writing-plans)

- **Cobertura:** cada REQ e cada mutação nomeada da spec tem task dona (tabela acima, conferida pela Sombra 2d); S2 e S4 real ficam na T17.
- **Passos:** cada step tem nome de teste, valor, assinatura ou comando.
- **Tipos:** `Pendencia`, `AprendizadoVigente`, `paraDestino`, `lerAprendizados`, `pendenciasAprendizado` e `resolverModelo` têm o mesmo nome do produtor a todos os consumidores (T2 → T8, T9, T13; T3 → T7a, T10; T4b → T6b, T8).
- **Review Focus:** 5 linhas, cada uma com teste na task dona.
- **Proporção:** ~440 linhas para spec de 111, dentro do teto de ~450 depois das decisões da Sombra. Código só em interfaces.

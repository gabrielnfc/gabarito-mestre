# E3 Sombra + emendas + entrega Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ciclo de cada task: o mesmo da E2 (`.superpowers/sdd/2026-11-03-e2-loop/retomada.md`), com P1, P2 e P9 de `docs/aprendizados/processo-orquestrador.md`.

**Goal:** Dúvida do loop vai à Sombra por caminho fixo e nunca é perguntada duas vezes; desvio, descoberta e emenda viram evento com evidência e congelam só o REQ afetado; a entrega segue a política declarada em `origin/HEAD`, sem perguntar na hora do deploy.

**Architecture:** Núcleos puros novos (`formas.ts`, `sombra.ts`, `emenda.ts`, `entrega.ts`) e `proximaAcao` estendida decidem; os CLIs `sombra.mjs`, `entrega.mjs` e `loop.mjs` gravam e validam o que depende de estado (D1); guarda, Stop, gate e `uso-subagent` só adaptam. Decisão, emenda e entrega são eventos do diário, nunca arquivo à parte.

**Tech Stack:** Node ≥ 22.18 sem dependências, TypeScript com strip-types e `dist/` commitado, `node --test`, hooks clássicos (`UserPromptExpansion`, `PreToolUse`, `Stop`, `SubagentStop`), API de mods do Claude Code.

**Spec:** `docs/superpowers/specs/2026-11-09-e3-sombra-emendas-entrega-design.md` (r2). **As decisões de `.superpowers/sdd/2026-11-09-e3-sombra/sombra-plano.md` (dúvidas 1 a 6: textos de emenda e testes novos de T3, T4, T8, T9, T10, T14, versão `2.0.0-alpha.3` em T14) vencem este plano onde divergem.** Divisão de tasks: `.superpowers/sdd/2026-11-09-e3-sombra/sombra-spec.md`, "Ordem de tasks e paralelismo".

## Global Constraints

- Caminhos relativos a `plugins/gabarito-mestre/`. Testes rodam de `gates/`. Sem dependência nova; `dist/` regenerado por `node scripts/build.mjs` a cada mudança em `src/`; `build.mjs --check` sai 0.
- `dados` do diário nunca carrega comando cru (`tipos.ts:87`): comando de entrega só no stdout e em `systemMessage`.
- Teto da Sombra: `sombra.teto` default **26** por entrega, nível Atenção (`aviso`), nunca Parar. Acerto de cache não conta.
- `resposta` de `decisao.sombra` ≤ **1.000** caracteres; texto inteiro em `<entrega>/sombra/<hash>.resposta.md`. Linha do diário ≤ 16.384 (`diario.ts:36`).
- Instantâneo: decisões ocupam no máximo **1.600** dos **3.200** caracteres, `resposta` cortada em **160** por linha, com contagem do que ficou fora.
- `pergunta_hash` = sha256 de `âncora \n versao \n pergunta normalizada`; âncora `<REQ>` ou `task:<id>`.
- `entrega.politica` ∈ `continua | janela | sob_demanda`, default `sob_demanda`; `entrega.base` default `main`; `entrega.comandos.*.timeout_s` default **600**, estouro = falha; argv, sem shell.
- `entrega.*`, `sombra.julga_emendas` (default `false`) e `sombra.teto` lidos de `refs/remotes/origin/HEAD:harness.config.json` (mesma regra da guarda); sem origin: `sob_demanda`, sem comandos, `julga_emendas: false`, teto 26.
- `plano.politica_entrega` só aperta (`continua` → `janela` → `sob_demanda`); afrouxar é recusado.
- `causa: 'regra_negocio' | 'tecnica'` em `desvio`, `descoberta` e `emenda.proposta`.
- `origem:'dono'` só pelo hook `UserPromptExpansion` de `/gabarito-mestre:emenda aprovar|rejeitar <seq>` (limite declarado Q14, como `liberar`).
- Modelos: Sombra Opus 5.5; implementador Sonnet 5.5 `high` (GM-10 R9); `orquestracao.modelo` existente segue para o orquestrador. Doctor avisa, nunca bloqueia.
- Nada de deploy real. `entrega.mjs` só com scripts falsos em repo descartável (`mkdtemp` em `os.tmpdir()`), com remoto bare local como `origin`.
- Toda task: 1 teste "falha não vira sucesso" com **ausente × corrompido** como casos distintos; nenhum teste depende de relógio ou carga sem folga (relógio entra por parâmetro `agoraMs`, nunca `Date.now()` no núcleo).
- Fora de loop ativo nada muda: sem `plano.json`, hooks novos e ramos novos saem 0 sem saída.
- Commits `tipo(GM-11): …`, `git add` por caminho, sem `git stash`. Todo Step 5 roda antes **P2 "Antes do commit"** (`docs/aprendizados/processo-orquestrador.md:34-42`) e relata os 5 itens.
- Brief de implementador proíbe `env`, dump de variável e leitura de `.env` (P8).

## Review Focus

1. CI de homolog verde **anterior** à última `task.integrada`: não é homolog do código atual, nunca vira `subir` → T4 `homolog-verde-antigo-nao-sobe`.
2. Sessão morreu no meio do deploy (`entrega.inicio` sem `entrega.fim`): a próxima sessão não roda deploy de novo; para com aviso → T4 `inicio-sem-fim-para`, T8 `executar-apos-inicio-sem-fim-nao-roda`.
3. Mesma pergunta com caixa, espaços, quebra de linha ou NFD/NFC diferentes: mesmo hash; pergunta vazia ou só espaço recusa → T2 `normaliza-caixa-espaco-quebra-nfc`, T7 `perguntar-vazia-recusa`.
4. Transcript com `message.model: "<synthetic>"` ou com mais de um modelo: `modelo` é o último real, nunca `<synthetic>`; nenhum ⇒ `null` → T9 `modelo-ignora-synthetic`.
5. Janela que cruza a meia-noite e fuso com horário de verão (`America/New_York`, 2026-03-08): dentro/fora certos e `quando` ≥ agora → T4 `janela-cruza-meia-noite`, `janela-dst-new-york`.

## Grafo

| Onda | Tasks | Depende de |
|---|---|---|
| 0 | T1 | — |
| 1 | T2, T3, T4, T5 | T1 |
| 2 | T6 (T3, T4), T7 (T2, T3, T5), T8 (T4, T5), T9 (T1) | |
| 3 | T10 (T6, T7), T11 (T2, T5), T12 (T7, T8), T13 (T6) | |
| 4 | T14 (T9, T10), T16 (T10, T13) | |
| 5 | T15 (todas, inclusive T16) | |

Paralelismo efetivo 3 (`slots_max` medido, E2 F9). Caminho crítico T1 → T3 → T6 → T10 → T14 → T15.

**Desvios da tabela da Sombra (motivo escrito):**
- `src/formas.ts` (forma de `dados` por tipo) nasce em **T1**, não em T5: T2 e T3 (onda 1) precisam dela para ignorar o inválido na projeção (D1) e não podem consumir arquivo de vizinho da mesma onda. T5 fica com a ligação em `append` e o contrato de recusa.
- **T1** também cria os stubs `src/sombra.ts`, `src/emenda.ts`, `src/entrega.ts` (exports lançando `não implementado`) e `scripts/emenda-dono.mjs` (block `não implementado; nada foi gravado`), e põe `lerConfigOrigin` e `MODELOS_PADRAO` em `lib/config.mjs`: `build.mjs` MODULOS, `hooks.json` e o leitor de `origin/HEAD` são compartilhados por T7, T8, T10, T12 e T14.
- **T12** não toca `src/classificar-alvo.ts`: a negação de `entrega.mjs` é por substring do texto inteiro, antes da classificação; reaproveitar a cabeça do segmento herdaria o furo `rtk`/`exec`/`xargs` (M15).
- **T13** não toca `loop.mjs`: o escopo somado pelas emendas vai pelo `--files` que `loop.mjs integrar` já passa (T10, via `escopoDaTask` de T3); o gate só relata desvios lendo o diário da entrega a partir da worktree.
- **P9:** a fumaça sem LLM nasce em **T10** (primeira task com o esqueleto inteiro de Sombra e emenda), não em T15; T15 só acrescenta o caminho de entrega e os aceites.

## Cobertura por REQ (teste nomeado e mutação nomeada)

| REQ | Teste (task) | Mutação que o teste mata |
|---|---|---|
| SOM-1 | `perguntar-segunda-vez-cache` (T7), `hash-muda-com-versao` (T2) | M-SOM1: hash sem `versao` ⇒ `cache-invalida-apos-spec-emendada` falha |
| SOM-2 | `registrar-sem-fontes-nem-medicao-recusa` (T7), `forma-decisao-fora-da-regra-sem-emenda-seq` (T1) | M-SOM2: aceitar `medicao: ''` como fonte |
| SOM-3 | `instantaneo-decisoes-ate-1600` (T11), `item-implementador-traz-decisoes-do-req` (T10) | M-SOM3: orçamento de decisões = 3.200 |
| SOM-4 | `cache-nao-conta-no-teto` (T2), `proxima-aviso-acima-do-teto` (T10), `sombra-prompt-com-hipotese-nega` (T12), `custo-sombra-papel` (T9) | M-SOM4a: contar `decisao.sombra` como consulta · M-SOM4b: comparar prompt por prefixo |
| EME-1 | `forma-proposta-sem-causa` (T1), `emenda-dono-grava-origem-dono` (T10), `julgar-sombra-sem-flag-recusa` (T10) | M-EME1: aceitar `origem:'sombra'` sem `julga_emendas` |
| EME-2 | `congela-so-req-afetado` (T6), `esperar-emenda-stop-avisa` (T13), `escopo-soma-arquivos-aprovados` (T3) | M-EME2: congelar só `pendente` ⇒ `aprovada-congelada-nao-integra` falha |
| EME-3 | `revisor-item-traz-emendas-aprovadas` (T10), `gate-relata-desvio` (T13), `integrar-verde-relata-desvio` (T16) | M-EME3: item `revisor` sem `diff`; M-REL1 |
| ENT-1 | `plano-afrouxa-recusa` (T4), `config-local-ignorada` (T8), `exige-prod-sob-demanda-para` (T6) | M-ENT1: aceitar `continua` sobre `janela` |
| ENT-2 | `smoke-falho-rollback-parar` (T8), `subagent-entrega-mjs-caixa-nega` (T12) | M-ENT2a: pular rollback · M-ENT2b: casar só no início do segmento |
| MOD-1 | `proxima-item-traz-modelo` (T10), `custo-traz-modelo-e-papel` (T9), `doctor-avisa-abaixo` (T14) | M-MOD1: doctor compara entre papéis ⇒ `doctor-nao-compara-entre-papeis` falha |

---

### Task 1: Contratos, forma do diário e fiação

**Files:** Modify `gates/src/tipos.ts`, `gates/src/plano.ts`, `gates/scripts/build.mjs` (MODULOS), `hooks/hooks.json`, `gates/lib/config.mjs`, `hooks/test/hooks-json.test.mjs`. Create `gates/src/formas.ts`, stubs `gates/src/{sombra,emenda,entrega}.ts`, `gates/scripts/emenda-dono.mjs` (stub), `gates/test/formas.test.ts`. Test: `gates/test/plano.test.ts`.

**Interfaces — Produces:**

```ts
// tipos.ts — TipoEvento ganha:
//   'sombra.consulta' | 'decisao.sombra' | 'desvio' | 'descoberta' | 'emenda.proposta' | 'spec.emendada' | 'emenda.rejeitada'
//   | 'entrega.inicio' | 'entrega.smoke' | 'entrega.rollback' | 'entrega.fim' | 'entrega.agendada'
export type Causa = 'regra_negocio' | 'tecnica';
export type OrigemJulgamento = 'dono' | 'sombra';
export type PoliticaEntrega = 'continua' | 'janela' | 'sob_demanda';
export type Janela = { dias: number[]; inicio: string; fim: string; fuso: string };   // dias 0-6, 'HH:MM', IANA
export type PoliticaPlano = { politica?: PoliticaEntrega; exige_prod: boolean; janela?: Janela };
export type TaskPlano = { id: string; deps: string[]; arquivos: string[]; reqs?: string[]; teste_afetado?: string; mutacoes?: string };
export type Plano = { entrega: string; spec?: string; politica_entrega?: PoliticaPlano; tasks: TaskPlano[] };
export type Sinais = { /* E2 inalterado */ ...; politica?: PoliticaEntrega };   // ausente = 'sob_demanda'
export type MotivoParar = /* E2 */ ... | 'smoke' | 'rollback' | 'janela_ausente';
export type PropostaAberta = { seq: number; req: string };
// AcaoLoop: o ramo esperar vira { tipo: 'esperar'; motivo: string; propostas?: PropostaAberta[] }
export type PapelModelo = 'implementador' | 'revisor' | 'sombra' | 'revisor_final' | 'spike' | 'basico';
// formas.ts
export const REQ_RE: RegExp;          // /^REQ-[A-Z0-9]+-\d+$/
export function formaInvalida(tipo: string, dados: unknown): string | null;   // null = forma ok ou tipo sem regra
// plano.ts
export function temDependencia(plano: Plano, a: string, b: string): boolean;  // a ancestral de b ou b de a (transitivo)
```

```js
// lib/config.mjs
export function lerConfigOrigin(raiz) // → { cfg: object | null, fonte: 'origin' | 'nenhuma' }; mesma resolução exata de REF_ORIGIN de lerGuarda; nunca lança
export const MODELOS_PADRAO // { implementador:{modelo:'sonnet',esforco:'high'}, revisor:{modelo:'opus'}, sombra:{modelo:'opus'},
                            //   revisor_final:{modelo:'fable'}, spike:{modelo:'opus'}, basico:{modelo:'haiku'} }
export const ORDEM_MODELO   // { haiku: 0, sonnet: 1, opus: 2, fable: 3 }
```

`formaInvalida` por tipo (só os novos; tipos da E1/E2 sem regra nova, salvo os opcionais abaixo):
`sombra.consulta {pergunta_hash: hex 64, req | task}` (exatamente um); `decisao.sombra {pergunta_hash, req | task, resposta: 1..1000, arquivo, pergunta_enviesada: boolean, fontes?: string[] não vazia, medicao?: string não vazia, fora_da_regra?: true, emenda_seq?: inteiro ≥ 1, substitui?: {sessao, seq}}` com `fora_da_regra` ⇒ `emenda_seq` obrigatório, senão `fontes` ou `medicao`; `desvio {task, req, evidencia ≠ '', arquivos: string[], causa}`; `descoberta {evidencia ≠ '', causa}`; `emenda.proposta {req, task?, diff ≠ '', fato, alternativa, evidencia ≠ '', causa, arquivos?: string[]}`; `spec.emendada | emenda.rejeitada {proposta_seq: inteiro ≥ 1, origem}`; `entrega.inicio {politica}`; `entrega.smoke | entrega.rollback {ok: boolean}`; `entrega.fim {ok: boolean, motivo?}`; `entrega.agendada {quando: ISO}`; `ci.resultado` aceita `alvo?: 'homolog'`; `custo.medicao` aceita `papel?: string`, `modelo?: string | null`. Texto que não é string, `req` fora de `REQ_RE`, `causa` fora do enum ⇒ motivo citando o campo.

`validarPlano`: `reqs` lista de `REQ_RE` sem repetição; `politica_entrega` com `exige_prod` boolean, `politica` no enum, `janela` com `dias` não vazia de inteiros 0-6, `inicio`/`fim` `HH:MM` 00:00-23:59, `fuso` aceito por `new Intl.DateTimeFormat('en', { timeZone })`. Afrouxar contra o config não é daqui (T4: o plano não vê o config).

`hooks.json`: `UserPromptExpansion` ganha matcher `^gabarito-mestre:emenda$` → `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/emenda-dono.mjs"`, timeout 10, `onFailure: block`. MODULOS + `'formas','sombra','emenda','entrega'`.

- [ ] **Step 1: Testes.** `formas.test.ts`: `forma-consulta-req-ou-task` (os dois ⇒ erro; nenhum ⇒ erro), `forma-decisao-sem-fontes-nem-medicao`, `forma-decisao-fora-da-regra-sem-emenda-seq`, `forma-decisao-resposta-1001`, `forma-proposta-sem-causa`, `forma-desvio-evidencia-vazia`, `forma-julgamento-seq-zero`, `forma-tipo-antigo-sem-regra` (`guarda.deny` com dados quaisquer ⇒ `null`), `forma-ci-alvo-invalido`, `forma-ausente-x-corrompida` (`dados` ausente × `dados: 'x'` ⇒ dois motivos distintos, nenhum lança). `plano.test.ts`: `plano-reqs-validos`, `plano-reqs-fora-do-padrao`, `plano-politica-janela-invalida` (dia 7, `24:00`, fuso `Mars/Base`), `plano-sem-politica-ok`, `tem-dependencia-transitiva`. `hooks-json.test.mjs`: `emenda-user-prompt-expansion-onfailure-block`, `emenda-dono-stub-bloqueia`. Teste de `lerConfigOrigin` em `test/lib.test.mjs`: `config-origin-ausente-x-invalida` (sem remoto ⇒ `nenhuma`; blob não JSON ⇒ `nenhuma`, nunca lança).
- [ ] **Step 2: RED.** `node --experimental-strip-types --test test/formas.test.ts test/plano.test.ts`: falha por módulo ausente.
- [ ] **Step 3: Implementar** `formaInvalida` (total, nunca lança), tipos, validação do plano, `temDependencia`, stubs, fiação; `node scripts/build.mjs`.
- [ ] **Step 4: GREEN.** `npm test` verde; `build.mjs --check` 0; `claude plugin validate .` sem erro.
- [ ] **Step 5: P2 + Commit** `enabler(GM-11): contratos da E3, forma do diário e fiação`.

### Task 2: Núcleo da Sombra

**Files:** Modify `gates/src/sombra.ts`. Create `gates/test/sombra.test.ts`.

**Interfaces — Consumes:** `Evento`, `TaskPlano`, `formaInvalida`, `REQ_RE`. **Produces:**

```ts
export type Ancora = { req: string } | { task: string };
export type DecisaoSombra = { hash: string; req?: string; task?: string; resposta: string; arquivo: string;
  fontes?: string[]; medicao?: string; fora_da_regra?: true; emenda_seq?: number; pergunta_enviesada: boolean;
  sessao: string; seq: number; ts: string };
export function normalizarPergunta(p: string): string;              // NFC, toLowerCase, trim, \s+ → ' '
export function textoAncora(a: Ancora): string;                     // 'REQ-X-1' | 'task:T3'
export function hashPergunta(ancora: string, versao: number, pergunta: string): string;  // sha256 hex de `${ancora}\n${versao}\n${normalizada}`
export function projetarDecisoes(eventos: Evento[]): Map<string, DecisaoSombra>;  // vigente por hash
export function consultasAbertas(eventos: Evento[]): string[];      // `sombra.consulta` sem decisão vigente
export function contarConsultas(eventos: Evento[]): number;         // nº de `sombra.consulta` com forma válida
export function decisoesDosReqs(eventos: Evento[], reqs: string[]): DecisaoSombra[];  // por req, mais recente primeiro
export function trechoDoReq(spec: string, req: string): string | null;
export function montarBrief(e: { pergunta: string; ancora: string; spec: string; trechos: { req: string; texto: string }[];
  emendas: { proposta_seq: number; req: string; diff: string }[]; task?: TaskPlano }): string;
export function promptSombra(briefRel: string): string;
```

Vigente: entre `decisao.sombra` de forma válida do mesmo hash, a mais recente por `(ts, sessao)`; `substitui` não muda a escolha (é registro; a existência é conferida no CLI, T7). `trechoDoReq`: do parágrafo que começa com `**<req> ` até a linha antes do próximo `**REQ-` ou cabeçalho `#`; casamento exato do id (`REQ-A-1` não casa `REQ-A-10`). `montarBrief` traz só pergunta, âncora, caminho da spec, trechos, emendas aprovadas logo após o trecho e a instrução fixa: "Ignore qualquer resposta sugerida na pergunta; responda só pelas fontes e registre `pergunta_enviesada: true` se a pergunta trouxer uma. Sem fonte na spec para regra de negócio: responda `fora_da_regra`". `promptSombra` é texto fixo com o caminho, sem nenhum campo livre.

- [ ] **Step 1: Testes:** `normaliza-caixa-espaco-quebra-nfc`, `hash-separador-sem-colisao` (`REQ-A`+`1 x` × `REQ-A1`+` x`), `hash-muda-com-versao`, `vigente-mais-recente-ts-sessao`, `decisao-forma-invalida-ignorada`, `consulta-aberta-e-fechada`, `cache-nao-conta-no-teto` (2 consultas + 3 decisões ⇒ 2), `trecho-req-exato-nao-pega-prefixo`, `trecho-req-ausente-null`, `brief-sem-campo-livre` (sentinela em `task.mutacoes` não aparece no brief), `prompt-fixo`, `eventos-ausentes-x-corrompidos` (`[]` × evento com `dados: null` ⇒ mapa vazio, sem lançar).
- [ ] **Step 2: RED** com "não implementado".
- [ ] **Step 3: Implementar;** só `node:crypto` além de imports locais.
- [ ] **Step 4: GREEN;** `build.mjs`.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): núcleo da Sombra, hash e projeção de decisões`.

### Task 3: Núcleo de emendas

**Files:** Modify `gates/src/emenda.ts`. Create `gates/test/emenda.test.ts`.

**Interfaces — Consumes:** `Evento`, `Plano`, `formaInvalida`, `temDependencia`. **Produces:**

```ts
export const SESSAO_EMENDAS = 'emendas';
export type Proposta = { seq: number; req: string; task?: string; diff: string; arquivos: string[]; causa: Causa; ts: string };
export type EstadoEmendas = { abertas: Proposta[]; aprovadas: (Proposta & { origem: OrigemJulgamento })[]; rejeitadas: Proposta[] };
export function projetarEmendas(eventos: Evento[]): EstadoEmendas;
export function versaoDoReq(est: EstadoEmendas, req: string): number;   // seq da última aprovada do req, ou 0
export function reqsCongelados(est: EstadoEmendas): Set<string>;
export function escopoDaTask(plano: Plano, est: EstadoEmendas, task: string): string[];  // arquivos da task ∪ arquivos das aprovadas com task igual
export function validarProposta(plano: Plano, est: EstadoEmendas, dados: Record<string, unknown>): string | null;
export function validarJulgamento(est: EstadoEmendas, proposta_seq: number, origem: OrigemJulgamento, julgaEmendas: boolean): string | null;
```

Proposta = `emenda.proposta` de forma válida gravada na sessão `SESSAO_EMENDAS` (seq único por construção do lock; outra sessão ⇒ ignorada, ver Dúvida 1). Julgamento: o 1º `spec.emendada`/`emenda.rejeitada` válido na ordem do diário (`ordenar`) fecha a proposta; os seguintes são ignorados. `validarProposta` recusa: `task` fora do plano, `req` fora de `task.reqs` quando há `task`, e `arquivos` que coincidam com os de outra task sem `temDependencia` com ela. `validarJulgamento` recusa proposta inexistente ou já julgada e `origem:'sombra'` com `julgaEmendas` falso.

- [ ] **Step 1: Testes:** `aberta-aprovada-rejeitada`, `segundo-julgamento-ignorado`, `proposta-de-outra-sessao-ignorada`, `versao-do-req`, `escopo-soma-arquivos-aprovados`, `escopo-ignora-aprovada-de-outra-task`, `proposta-arquivo-colide-sem-dep-recusa`, `proposta-arquivo-com-dep-ok`, `proposta-req-fora-da-task-recusa`, `julgar-inexistente-recusa`, `julgar-ja-julgada-recusa`, `julgar-sombra-sem-flag-recusa`, `diario-ausente-x-corrompido` (`[]` × evento sem `dados` ⇒ estado vazio).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** puro.
- [ ] **Step 4: GREEN;** `build.mjs`.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): núcleo de emendas por REQ`.

### Task 4: Decisão de entrega pura

**Files:** Modify `gates/src/entrega.ts`. Create `gates/test/entrega.test.ts`.

**Interfaces — Consumes:** `Evento`, `PoliticaPlano`, `Janela`, `PoliticaEntrega`. **Produces:**

```ts
export type ComandoEntrega = { argv: string[]; timeout_s: number };
export type ConfigEntrega = { politica: PoliticaEntrega; base: string; janela: Janela | null;
  comandos: { deploy?: ComandoEntrega; smoke?: ComandoEntrega; rollback?: ComandoEntrega }; erros: string[] };
export function lerConfigEntrega(cfg: unknown): ConfigEntrega;    // null ⇒ sob_demanda, base 'main', sem comandos
export function politicaEfetiva(c: ConfigEntrega, p?: PoliticaPlano):
  { ok: true; politica: PoliticaEntrega; janela: Janela | null } | { ok: false; erro: 'politica_afrouxada' | 'janela_ausente'; mensagem: string };
export function dentroDaJanela(j: Janela, agoraMs: number): boolean;
export function proximaAbertura(j: Janela, agoraMs: number): string;    // ISO UTC, ≥ agora
export type DecisaoEntrega =
  | { tipo: 'subir' } | { tipo: 'agendar'; quando: string } | { tipo: 'release_pr'; base: string; aviso?: string }
  | { tipo: 'esperar'; motivo: 'homolog' } | { tipo: 'entregue' } | { tipo: 'parar'; motivo: MotivoParar };
export function decidirEntrega(e: { politica: PoliticaEntrega; janela: Janela | null; exigeProd: boolean; base: string;
  comandos: ConfigEntrega['comandos']; eventos: Evento[]; agoraMs: number }): DecisaoEntrega;
```

Tabela, na ordem: (1) `exigeProd` e `sob_demanda` ⇒ `parar{janela_ausente}`; (2) último `entrega.fim {ok:false}` ⇒ `parar{motivo}` dele se for `smoke`/`rollback`, senão `parar{nao_conseguiu}`; `entrega.fim {ok:true}` ⇒ `entregue`; (3) `entrega.inicio` sem `entrega.fim` depois ⇒ `parar{nao_conseguiu}`; (4) `sob_demanda` ⇒ `release_pr{base}`; (5) faltando qualquer de `deploy`, `smoke`, `rollback` ⇒ `release_pr{base, aviso}` citando os ausentes; (6) `continua`: último `ci.resultado {alvo:'homolog'}` posterior à última `task.integrada` com `verde:true` ⇒ `subir`, senão `esperar{homolog}`; (7) `janela`: dentro ⇒ `subir`, fora ⇒ `agendar{proximaAbertura}`. Ordem do diário por `ordenar` de `loop.ts`. `politicaEfetiva`: rank `continua 0 < janela 1 < sob_demanda 2`; plano com rank menor que o config ⇒ `politica_afrouxada`; janela do config vence quando o config é `janela`; plano que aperta `continua` → `janela` traz a janela dele, e sem janela em nenhum dos dois ⇒ `janela_ausente`. `fim ≤ inicio` = janela cruza a meia-noite, o dia é o do início. `proximaAbertura` varre em passos de 1 minuto até 8 dias pelo `Intl.DateTimeFormat` do fuso. `timeout_s` ausente = 600; inteiro ≤ 0 ou `argv` que não é lista de texto não vazia ⇒ comando ausente e motivo em `erros`.

- [ ] **Step 1: Testes:** um por linha da tabela, mais `plano-afrouxa-recusa` (config `janela`, plano `continua`), `plano-aperta-ok`, `janela-sem-janela-ausente`, `homolog-verde-antigo-nao-sobe`, `inicio-sem-fim-para`, `entregue-nao-repete`, `continua-sem-comandos-release-pr-com-aviso`, `comandos-parciais-citam-ausentes`, `janela-cruza-meia-noite`, `janela-dst-new-york` (agoraMs fixo em 2026-03-08), `quando-nunca-antes-de-agora`, `config-ausente-x-corrompida` (`null` × `{entrega: 'x'}` ⇒ `sob_demanda` e `erros` não vazio no 2º).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** puro, relógio só por `agoraMs`.
- [ ] **Step 4: GREEN;** `build.mjs`.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): política de entrega como função pura`.

### Task 5: Forma de `dados` no `append`

**Files:** Modify `gates/src/diario.ts` (`append`, `diario.ts:134-185`). Test: `gates/test/diario.test.ts`.

**Interfaces — Consumes:** `formaInvalida` (T1). **Produces:** `append` devolve `{ ok: false; erro: 'forma_invalida: <tipo>: <motivo>' }` sem tocar o arquivo (nem lock, nem linha) quando `formaInvalida(ev.tipo, ev.dados) !== null`. A checagem roda antes do canário. Nada mais muda em `append`.

- [ ] **Step 1: Testes:** `append-forma-invalida-nada-gravado` (arquivo e `.lock` ausentes depois), `append-forma-valida-grava`, `append-tipo-antigo-segue`, `append-forma-antes-do-canario`, `append-dados-ausente-x-corrompido` (dois `erro` distintos, 0 bytes), `append-pelo-dist` (P9: `dist/diario.js` recusa o mesmo caso).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** `build.mjs`.
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: P2 + Commit** `feat(GM-11): diário recusa forma inválida por tipo`.

### Task 6: Congelar por REQ no loop

**Files:** Modify `gates/src/loop.ts`. Test: `gates/test/loop.test.ts`.

**Interfaces — Consumes:** `projetarEmendas`, `reqsCongelados` (T3); `Sinais.politica`, `Plano.politica_entrega`. **Produces:** `proximaAcao` estendida; `export function tasksCongeladas(plano: Plano, eventos: Evento[]): Set<string>` (task com REQ congelado e toda dependente transitiva); `TIPOS_DE_PROGRESSO` ganha `'spec.emendada', 'emenda.rejeitada'`.

Cláusulas novas: (4b) depois de (4): `plano.politica_entrega?.exige_prod` e `(sinais.politica ?? 'sob_demanda') === 'sob_demanda'` ⇒ `parar{janela_ausente}`; (5), (6) e (7) excluem tasks congeladas de revisores, integráveis, correções e novas; task em voo segue (sua `task.concluida` é aceita); (9) depois de `vivos > 0` e do teto: congeladas não integradas ⇒ `{tipo:'esperar', motivo:'emenda', propostas}` (abertas que congelam alguma task, por `seq`); teto vence emenda.

- [ ] **Step 1: Testes:** `congela-so-req-afetado` (T1 congelada, T2 independente despacha), `congela-dependente`, `aprovada-congelada-nao-integra`, `concluida-congelada-sem-revisor`, `em-voo-termina`, `x-revisor-exclui-congelada`, `esperar-emenda-com-propostas`, `teto-vence-emenda`, `spec-emendada-libera`, `rejeitada-libera`, `task-sem-reqs-nao-congela`, `exige-prod-sob-demanda-para`, `exige-prod-sinais-sem-politica-para`, `progresso-inclui-julgamento`, `emenda-ausente-x-corrompida` (sem evento de emenda × `emenda.proposta` com `dados` inválido ⇒ nada congela e nenhum `diario_invalido`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** puro.
- [ ] **Step 4: GREEN;** `build.mjs`; testes da E2 em `loop.test.ts` inalterados e verdes.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): proposta aberta congela só o REQ`.

### Task 7: CLI da Sombra e agente

**Files:** Create `gates/scripts/sombra.mjs`, `agents/gabarito-sombra.md`, `gates/test/sombra-cli.test.mjs`.

**Interfaces — Consumes:** T2, `projetarEmendas`/`versaoDoReq` (T3), `append` com forma (T5), `lerConfigOrigin` (T1). **Produces:**

```
sombra.mjs perguntar (--req <REQ> | --task <id>) --pergunta <texto> [--entrega <id>] [--sessao <id>]
  → {ok, hash, cache:true, decisao} | {ok, hash, pendente:true} | {ok, hash, brief, prompt, consultas, teto}
sombra.mjs registrar <hash> <resposta.json> [--sessao <id>]  → {ok, evento}
resposta.json: { resposta, texto, pergunta_enviesada, fontes?, medicao?, fora_da_regra?, emenda_seq?, substitui?: {sessao, seq} }
```

Saída: uma linha JSON com `ok`; falha com `erro` e `mensagem`, rc 1; uso errado rc 2 (contrato de `loop.mjs`). `perguntar`: recusa `plano_sem_spec`, `req_fora_da_spec` (via `trechoDoReq`), `task_fora_do_plano`, `pergunta_vazia`; com decisão vigente ⇒ cache; com consulta aberta ⇒ pendente; senão grava `sombra.consulta` **antes** de escrever `<dirEntrega>/sombra/<hash>.md` e devolve `prompt = promptSombra(<caminho relativo à raiz>)`. Versão da âncora `task:` = maior `versaoDoReq` entre os `reqs` da task, ou 0. `registrar`: recusa `sem_consulta`, `resposta_longa` (> 1.000, antes do diário), `sem_fonte`, `substitui_inexistente` (mesmo hash), `emenda_seq_inexistente` (proposta do mesmo REQ, ou de um `req` da task); escreve `<hash>.resposta.md` com `texto` e só então grava `decisao.sombra` com `arquivo`. Agente: `model: opus`, ferramentas só de leitura (`Read, Glob, Grep`), proíbe `env` e `.env`, devolve o formato de `resposta.json`.

- [ ] **Step 1: Testes** em repo temporário com `plano.json` e spec: `perguntar-grava-consulta-e-brief`, `perguntar-segunda-vez-pendente`, `perguntar-segunda-vez-cache` (após `registrar`), `cache-invalida-apos-spec-emendada`, `perguntar-task-sem-req`, `perguntar-vazia-recusa`, `req-fora-da-spec-recusa`, `plano-sem-spec-recusa`, `registrar-sem-fontes-nem-medicao-recusa`, `registrar-resposta-longa-nada-gravado`, `registrar-fora-da-regra-exige-emenda`, `registrar-substitui-inexistente`, `registrar-sem-consulta`, `brief-sem-hipotese` (pergunta com "acho que é X" chega só como pergunta; nada do diff/transcript), `prompt-igual-a-promptSombra`, `diario-ausente-x-corrompido` (sem pasta ⇒ grava; cadeia quebrada ⇒ `diario_ilegivel`, nada gravado), `agente-sombra-frontmatter` (opus, sem `Write`/`Edit`/`Bash`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** E/S só aqui, núcleo pelo `dist/`.
- [ ] **Step 4: GREEN;** `claude plugin validate .`.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): consulta à Sombra por caminho fixo`.

### Task 8: Execução da entrega

**Files:** Create `gates/scripts/entrega.mjs`, `gates/test/entrega-cli.test.mjs`.

**Interfaces — Consumes:** T4, `append` (T5), `lerConfigOrigin` (T1), `validarPlano`. **Produces:**

```
entrega.mjs decidir  [--entrega <id>]  → {ok, decisao: DecisaoEntrega, politica, aviso?}; `agendar` grava `entrega.agendada {quando}` se não houver o mesmo `quando`
entrega.mjs executar [--entrega <id>]  → {ok, etapas:[{etapa, comando, ok, saida}], decisao}; rc 0 entregue, 1 parar
export async function executarEntrega(cwd, opts?: { agoraMs?: number }): Promise<object>   // o CLI nunca recebe relógio
export function decidirAgora(cwd, opts?: { agoraMs?: number }): object
```

`executar` só roda com `decisao.tipo === 'subir'`: grava `entrega.inicio {politica}`; `producao.acesso {ambiente:'prod', acao:'escrita', alvo:'entrega:deploy'}`; deploy; smoke ⇒ `entrega.smoke {ok}`; smoke falho ⇒ `producao.acesso {… alvo:'entrega:rollback'}`, rollback, `entrega.rollback {ok}`, `entrega.fim {ok:false, motivo:'smoke'|'rollback'}`, `loop.parar {motivo}`; sucesso ⇒ `entrega.fim {ok:true}`. Deploy falho (Dúvida 6) ⇒ rollback; rollback falho ⇒ `motivo:'rollback'` e `loop.parar {rollback}`; rollback ok ⇒ `entrega.fim {ok:false, motivo:'deploy'}` e `loop.parar {nao_conseguiu}`. `spawnSync(argv[0], argv.slice(1), {cwd: raiz, shell:false, timeout: timeout_s*1000})`; rc ≠ 0, sinal, `ETIMEDOUT` ou `ENOENT` = falha. `comando` e `saida` (últimos 2.000 caracteres) só no stdout; `systemMessage` com o comando de cada etapa.

- [ ] **Step 1: Testes** com remoto bare como `origin` e scripts falsos em `mkdtemp`: `smoke-falho-rollback-parar` (aceite 3: marcador do rollback criado; `parar{smoke}`), `rollback-falho-parar-rollback`, `deploy-falho-roda-rollback`, `sucesso-entregue`, `timeout-e-falha` (`timeout_s: 1`, script `sleep 30`), `enoent-e-falha`, `comando-nunca-no-diario` (sentinela no argv ausente de todo `events.*.jsonl`), `producao-acesso-em-deploy-e-rollback`, `config-local-ignorada` (local `continua`, origin `sob_demanda` ⇒ `release_pr`), `sem-origin-sob-demanda`, `executar-apos-inicio-sem-fim-nao-roda`, `agendar-grava-uma-vez`, `politica-afrouxada-recusa`, `config-ausente-x-corrompida` (origin sem arquivo ⇒ `sob_demanda`; origin com JSON inválido ⇒ `sob_demanda` e `aviso`), `alvo-nunca-real` (todo argv executado está sob o `mkdtemp`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: P2 + Commit** `feat(GM-11): entrega por comandos declarados com rollback`.

### Task 9: Papel e modelo no custo

**Files:** Modify `gates/scripts/uso-subagent.mjs`, `mod/gabarito.mjs` (gravação de `custo.medicao`, `mod/gabarito.mjs:380-405`). Test: `gates/test/uso-subagent.test.mjs`, `mod/test/gabarito.test.mjs`.

**Interfaces — Produces:** `custo.medicao.dados` ganha `modelo: string | null` e, quando o `agent_type` casa, `papel`. Exports de `uso-subagent.mjs`: `papelDoAgente(agentType: string): 'sombra' | 'revisor' | 'implementador' | 'spike' | null` (sufixo `gabarito-sombra|gabarito-revisor|gabarito-implementador|gabarito-spike`, com ou sem prefixo `<plugin>:`); `modeloDoTranscript(linhas: string[]): string | null` (último `message.model` não vazio que não começa com `<`). `agente` continua `subagent:<id>` (dedupe de `uso-subagent.mjs:163` intacto). Mod: antes de codificar, ler a API de mods (skill `plugin-authoring`) para o campo de modelo em `session.measure`/`turn.complete`; existe ⇒ grava; não existe ⇒ `modelo: null` e o relatório registra a medição (b).

- [ ] **Step 1: Testes:** `custo-sombra-papel`, `custo-traz-modelo-e-papel`, `papel-desconhecido-omitido`, `modelo-ignora-synthetic`, `modelo-ultimo-real`, `modelo-ausente-null`, `dedupe-intacto-com-papel`, `transcript-ausente-x-corrompido` (sem arquivo ⇒ nada gravado; linha torta ⇒ ignorada, soma do resto), `nao-grava-conteudo` (inalterado). Mod: `mod-custo-tem-modelo` (valor ou `null`, nunca ausente).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN;** `claude plugin validate .`.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): papel e modelo no custo por subagent`.

### Task 10: `proxima` com Sombra, emendas e modelo; CLI de emenda; comando do dono; fumaça

**Files:** Modify `gates/scripts/loop.mjs`, `gates/scripts/emenda-dono.mjs`, `gates/test/loop-cli.test.mjs`. Create `skills/emenda/SKILL.md`, `gates/test/emenda-dono.test.mjs`, `gates/test/fumaca-e3.test.mjs`, `gates/test/fumaca-e3/caminhada.mjs`, `gates/test/fumaca-e3/plano.json`, `gates/test/fumaca-e3/spec.md`.

**Interfaces — Consumes:** T3, T4 (`lerConfigEntrega`, `politicaEfetiva`), T6, T7 (`sombra.mjs`, `decisoesDosReqs`, `contarConsultas`), `MODELOS_PADRAO`, `lerConfigOrigin`. **Produces:**

```
loop.mjs desvio <task> --req <REQ> --evidencia <t> --arquivos <a,b> --causa <c>
loop.mjs descoberta --evidencia <t> --causa <c>
loop.mjs emenda propor --req <REQ> [--task <id>] --diff <arquivo> --fato <t> --alternativa <t> --evidencia <t> --causa <c> [--arquivos <a,b>]
loop.mjs emenda julgar <seq> <aprovar|rejeitar>          # origem 'sombra'; recusa sem sombra.julga_emendas:true de origin/HEAD
loop.mjs ci <verde|vermelho> [--alvo homolog]
export function julgarEmendaDono(cwd, seq: number, decisao: 'aprovar'|'rejeitar', sessao: string): {ok:true, seq, req, tipo} | {ok:false, erro, mensagem}
```

`emenda propor` grava sempre na sessão `SESSAO_EMENDAS`, com `validarProposta`; `diff` lido do arquivo, > 4.000 caracteres ⇒ `diff_longo` antes do diário. `proxima`: `sinais.politica` = `politicaEfetiva(lerConfigEntrega(origin), plano.politica_entrega)`, com `ok:false` ⇒ falha `politica_afrouxada`/`janela_ausente` e nada despachado; cada item ganha `modelo` (`orquestracao.modelos[papel]` sobre `MODELOS_PADRAO`; `correcao` usa `implementador`) e `decisoes` (`decisoesDosReqs` dos `reqs`, `resposta` + `arquivo`); `revisor` ganha `emendas` aprovadas (`proposta_seq`, `req`, `diff`); `aviso` com `contarConsultas > sombra.teto` (Atenção) e com `spec.emendada` em REQ de task `integrada` (cita a task). `integrar` passa `escopoDaTask` ao `--files`. `emenda-dono.mjs`: mesmo desenho de `liberar-teto.mjs` (stdin ausente/não JSON ⇒ block; outro comando ⇒ silêncio; `agent_id` ⇒ block; args fora de `^(aprovar|rejeitar) [1-9][0-9]{0,8}$` ⇒ block; `ok:false` ⇒ block com motivo; `ok:true` só com o evento gravado e relido). Skill `emenda`: `disable-model-invocation: true`, `argument-hint: aprovar|rejeitar <seq>`, texto no padrão de `skills/liberar/SKILL.md`.

Fumaça sem LLM (P9, entra em `npm test`): plano de 3 tasks com `reqs`, pelos CLIs reais e `dist/`: consulta, `pendente`, `registrar`, cache; proposta no REQ de T1 congela T1, T2 independente chega a `integrada`, `proxima` devolve `esperar{emenda}`; hook `emenda-dono.mjs` com JSON de `UserPromptExpansion` aprova; T1 segue a `concluir`.

- [ ] **Step 1: Testes:** `proxima-item-traz-modelo`, `proxima-modelo-config-vence-padrao`, `item-implementador-traz-decisoes-do-req`, `revisor-item-traz-emendas-aprovadas`, `proxima-aviso-acima-do-teto`, `proxima-aviso-emenda-em-integrada`, `proxima-politica-afrouxada-falha`, `desvio-grava`, `desvio-sem-evidencia-recusa`, `propor-diff-longo-recusa-antes-do-diario`, `propor-colide-sem-dep-recusa`, `julgar-sombra-sem-flag-recusa`, `julgar-sombra-com-flag-origin`, `julgar-sombra-flag-so-local-recusa`, `integrar-escopo-com-emenda-aprovada-passa-gate` (P9: gate real), `ci-alvo-homolog`. `emenda-dono.test.mjs`: `emenda-dono-grava-origem-dono`, `emenda-dono-subagent-bloqueia`, `emenda-dono-args-invalidos`, `emenda-dono-stdin-ausente-x-corrompido`, `emenda-dono-outro-comando-silencio`, `emenda-dono-ja-julgada-bloqueia`, `hooks-json-matcher-real`. `fumaca-e3.test.mjs`: `fumaca-sombra-e-emenda`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN;** `npm test` inteiro; `claude plugin validate .`.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): proxima com Sombra e emendas, comando do dono e fumaça`.

### Task 11: Instantâneo com decisões

**Files:** Modify `gates/src/diario.ts` (`projetar`, `diario.ts:331-357`). Test: `gates/test/diario.test.ts`, `gates/test/cartao-sessao.test.mjs` onde fixa o instantâneo.

**Interfaces — Consumes:** `projetarDecisoes` (T2). **Produces:** `projetar` devolve também `decisoes: number`; instantâneo ganha, após a linha de ETA, `Decisões da Sombra (<n>):` e uma linha por decisão vigente, mais recente primeiro, `<âncora> <hash 8> <resposta cortada em 160, sem quebra>`, até 1.600 caracteres somando cabeçalho e rodapé `... <k> decisão(ões) fora`; o resto do orçamento (3.200) segue para os eventos. Sem decisão, nenhuma linha nova.

- [ ] **Step 1: Testes:** `instantaneo-decisoes-ate-1600` (30 decisões de 200 caracteres), `instantaneo-total-3200`, `instantaneo-resposta-160`, `instantaneo-conta-fora`, `instantaneo-sem-decisao-igual-e2`, `instantaneo-decisao-corrompida-ignorada` (ausente × `dados` inválido), `instantaneo-mostra-decisao-gravada-por-registrar` (P9: `sombra.mjs registrar` real, depois `projetar` do `dist/`).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** `build.mjs`.
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: P2 + Commit** `feat(GM-11): decisões da Sombra no instantâneo`.

### Task 12: Guarda da Sombra e da entrega

**Files:** Modify `gates/src/guarda.ts`. Create `gates/test/guarda-sombra.test.mjs`.

**Interfaces — Consumes:** `consultasAbertas`, `promptSombra` (T2), `dirEntrega`, `ler`/`lerEstrito`. **Produces:** duas checagens antes da classificação, depois da pausa:
- `Agent`/`Task` com `subagent_type` que casa `/(^|:)gabarito-sombra$/i`: `deny` salvo `tool_input.prompt === promptSombra(<.harness/entregas/<id>/sombra/<h>.md>)` para algum `h` de `consultasAbertas`. Mensagem: `Sombra só com o prompt devolvido por sombra.mjs perguntar`. Diário ausente ⇒ `deny` (sem consulta aberta); diário ilegível ⇒ `deny` com `diário ilegível`.
- Subagent (`agent_id` presente) com `Bash` cujo `command.toLowerCase()` contém `entrega.mjs` ⇒ `deny`, mensagem `entrega só pelo orquestrador`. Orquestrador segue a guarda normal. Limite declarado no cabeçalho: nome montado em tempo de execução (`'entrega' + '.mjs'`) não casa.

- [ ] **Step 1: Testes:** `sombra-prompt-igual-passa`, `sombra-prompt-com-hipotese-nega`, `sombra-prompt-prefixo-nega`, `sombra-sem-consulta-aberta-nega`, `sombra-consulta-ja-decidida-nega`, `sombra-diario-ausente-x-ilegivel` (dois motivos), `sombra-tipo-com-prefixo-e-caixa`, `outro-agente-nao-confere`, `subagent-entrega-mjs-caixa-nega` (`ENTREGA.MJS`), `subagent-entrega-mjs-qualquer-posicao` (`rtk node x/entrega.mjs`, `echo a; node entrega.mjs`, `xargs node entrega.mjs`), `orquestrador-entrega-mjs-segue`, `guarda-aceita-prompt-devolvido-por-perguntar` (P9: `sombra.mjs perguntar` real, depois `dist/guarda.js` com o `prompt` devolvido).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar;** `build.mjs`.
- [ ] **Step 4: GREEN;** `node scripts/bench-guarda.mjs` p95 sem regressão > 5 ms contra a base, número no relatório.
- [ ] **Step 5: P2 + Commit** `feat(GM-11): guarda confere o prompt da Sombra e barra entrega a subagent`.

### Task 13: Stop em `esperar{emenda}` e gate com desvios

**Files:** Modify `gates/scripts/stop-loop.mjs` (`saidaParaAcao`, `stop-loop.mjs:64-90`), `gates/scripts/gate-task.mjs`. Test: `gates/test/stop-loop.test.mjs`, `gates/test/gate-task.test.mjs`.

**Interfaces — Consumes:** `esperar{motivo:'emenda', propostas}` (T6); evento `desvio` (T1). **Produces:** `saidaParaAcao` com `esperar` e `motivo === 'emenda'` ⇒ `{systemMessage}` sem `decision`: `Loop da entrega <e> espera julgamento de emenda: #<seq> <REQ>, …. Julgue com /gabarito-mestre:emenda aprovar|rejeitar <seq>.` (até `ITENS_NO_MOTIVO`, depois `e mais <n>`); outro `esperar` segue em silêncio; não passa pelo contador. `gate-task.mjs`: `export function desviosDaTask(worktree: string): { desvios: object[] } | { aviso: string }`, raiz principal por `git rev-parse --git-common-dir`, entrega e task pela branch `wt/<entrega>-<task>`; cada desvio vira linha `desvio: <req> <arquivos> (<causa>)` no relato, nunca reprova; diário ilegível ⇒ linha `aviso: desvios não lidos (<causa>)`, nunca "0 desvios".

- [ ] **Step 1: Testes:** `esperar-emenda-stop-avisa`, `esperar-emenda-nao-bloqueia`, `esperar-emenda-nao-conta-sem-progresso` (4 Stops ⇒ nenhum `loop.parar`), `esperar-outro-motivo-silencio`, `stop-esperar-emenda-via-dist` (P9: diário real com proposta aberta, `proximaAcao` do `dist/`), `gate-relata-desvio`, `gate-desvio-nao-reprova`, `gate-sem-diario-x-diario-ilegivel` (sem pasta ⇒ nenhuma linha; cadeia quebrada ⇒ aviso), `gate-fora-de-worktree-de-task-silencio`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: P2 + Commit** `feat(GM-11): Stop avisa emenda pendente e gate relata desvios`.

### Task 14: Doctor dos modelos e skill do loop

**Files:** Modify `gates/scripts/harness-doctor.mjs` (perto de `modelo-resolvido`, `harness-doctor.mjs:660`), `gates/test/harness-doctor-loop.test.mjs`, `skills/gabarito-loop/SKILL.md`, `.claude-plugin/plugin.json` e manifesto do marketplace (`2.0.0-alpha.3`), `gates/package.json` (versão), `CHANGELOG.md`.

**Interfaces — Consumes:** `MODELOS_PADRAO`, `ORDEM_MODELO`; CLIs de T7, T8, T10. **Produces:** check de aviso `modelos-por-papel` (não muda nível, não quebra CI): por papel declarado em `orquestracao.modelos`, `ORDEM_MODELO[declarado] < ORDEM_MODELO[recomendado]` ⇒ aviso com papel, declarado e recomendado; nome fora de `ORDEM_MODELO` ⇒ aviso `desconhecido`; nunca compara um papel com outro. Skill: ciclo ganha (a) dúvida ⇒ `sombra.mjs perguntar`, despachar `gabarito-sombra` só com o `prompt` devolvido, `registrar`; `pendente` ⇒ seguir outra task; (b) desvio/descoberta/proposta pelo `loop.mjs`; `esperar{emenda}` ⇒ avisar o dono e parar o turno; (c) `concluir` ⇒ `entrega.mjs decidir`; `subir` ⇒ `entrega.mjs executar`; `release_pr` ⇒ push e PR para `base`, nunca merge; `agendar` ⇒ informar `quando`. Só ponteiros, sem cópia da spec, ≤ 80 linhas.

- [ ] **Step 1: Testes:** `doctor-avisa-abaixo` (revisor `sonnet`), `doctor-nao-compara-entre-papeis` (implementador e revisor `opus` ⇒ nenhum aviso), `doctor-modelo-desconhecido`, `doctor-sem-modelos-silencio`, `doctor-config-ausente-x-corrompida`, `skill-loop-cita-sombra-emenda-entrega` (grep dos três CLIs), versão em `package.test.mjs`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Escrever.**
- [ ] **Step 4: GREEN;** `claude plugin validate .`; `npm test`.
- [ ] **Step 5: P2 + Commit** `enabler(GM-11): doctor dos modelos, skill do loop e versão alpha.3`.

### Task 16: `integrar` relata desvios no verde (emenda da Sombra, `sombra-relato-verde.md`)

**Depende de:** T10, T13. Onda 4, em paralelo com T14. T15 passa a depender também de T16.

**Files:** Modify `gates/scripts/loop.mjs` (`integrar`, ramo verde), `gates/test/loop-cli.test.mjs`.

**Produces:** no VERDE, `integrar` devolve `relato: string[]` só com as linhas `^(desvio|aviso): ` do gate, `[]` sem nenhuma; resto do retorno e rc sem mudança; ramo `gate_reprovado` sem mudança. `[]` não prova 0 desvios (diário ilegível vem como `aviso:`).

- [ ] **Step 1: Testes (P9, gate real, CLIs reais):** `integrar-verde-relata-desvio`, `integrar-verde-sem-desvio-relato-vazio` (toda linha casa `/^(desvio|aviso): /`). Mutações M-REL1 (sem `relato`), M-REL2 (`[]` fixo), M-REL3 (sem filtro).
- [ ] **Step 2: RED. Step 3: Implementar. Step 4: GREEN. Step 5: P2 + Commit** `fix(GM-11): integrar relata desvios no verde`.

### Task 15: Fumaça de entrega e aceites

**Depende de todas.** Sem código de produto; defeito volta à task dona.

**Files:** Modify `gates/test/fumaca-e3.test.mjs`, `gates/test/fumaca-e3/caminhada.mjs`. Create `gates/test/e2e/aceite-e3.exp`, `gates/test/e2e/plano-e3.json`, `gates/test/e2e/avaliar-e3.mjs` (fora de `npm test`).

- [ ] **Step 1: Fumaça** `fumaca-entrega-smoke-falho`: repo descartável, origin bare com `entrega.politica: continua` e scripts falsos (deploy ok, smoke falha, rollback grava marcador), `ci --alvo homolog verde` após a última integração, `entrega.mjs executar` ⇒ rollback executado, `parar{smoke}`, comando ausente do diário. Entra em `npm test`.
- [ ] **Step 2: Aceite 1:** TUI `--permission-mode auto`, haiku, a mesma pergunta 2× ⇒ 1 `Agent` Sombra e 1 `decisao.sombra`; a 2ª volta `cache: true`.
- [ ] **Step 3: Aceite 2:** proposta aberta no REQ de T1: T2 independente chega a `integrada`, T1 espera com aviso no Stop; `/gabarito-mestre:emenda aprovar <seq>` ⇒ T1 segue a `concluir`.
- [ ] **Step 4: Aceite 3** (fumaça do Step 1 pela TUI) e **Aceite 4:** `custo.medicao` do aceite 1 traz `modelo` e `papel: 'sombra'`.
- [ ] **Step 5: Evidência** no ledger `docs/ledgers/GM-11.md`; P2; commit `test(GM-11): fumaça de entrega e aceites da E3`.

---

## Execução: modelo e P1 por task

| Task | Modelo | P1 (Sombra antes) | Motivo |
|---|---|---|---|
| T1 | Sonnet 5.5 high | não | contratos e forma; serial, revisão cuidadosa |
| T2 | Sonnet 5.5 high | não | puro, regras fechadas |
| T3 | Sonnet 5.5 high | **sim** | estado de proposta e julgamento |
| T4 | Sonnet 5.5 high | **sim** | tabela de entrega, janela e fuso |
| T5 | Haiku 5.5 | não | ligação mecânica |
| T6 | Sonnet 5.5 high | **sim** | precedência de `proximaAcao` |
| T7 | Sonnet 5.5 high | **sim** | contrato de falha do CLI, ordem consulta → brief |
| T8 | Sonnet 5.5 high | **sim** | contrato de falha, rollback, timeout |
| T9 | Sonnet 5.5 high | não | adaptador; leitura da API do mod |
| T10 | Sonnet 5.5 high | **sim** | hook do dono, CLI de emenda, fumaça |
| T11 | Sonnet 5.5 high | não | orçamento de texto |
| T12 | Sonnet 5.5 high | **sim** | decisão de segurança na guarda |
| T13 | Sonnet 5.5 high | não | adaptadores |
| T14 | Haiku 5.5 | não | check de aviso e texto |
| T15 | Sonnet 5.5 high | não | aceites, sem código de produto |

## Dúvidas abertas (não resolvidas pelo plano; default provisório entre parênteses)

1. `proposta_seq` é o `seq` do evento, que é por sessão: duas sessões colidem. (Default: `emenda.proposta` só vale gravada na sessão `emendas`, T3/T10.)
2. `janela` dentro ⇒ `subir` sem exigir homolog verde (leitura literal da spec); sessão que chega depois de `quando` com a janela já fechada reagenda em vez de subir fora da janela. (Default: as duas leituras.)
3. `continua` com homolog não verde: spec não diz. (Default: `esperar{homolog}`; homolog só conta posterior à última `task.integrada`.)
4. Com mod ativo, quem grava primeiro o `custo.medicao` do subagent decide se `papel` aparece (dedupe por `agente`); o mod pode não ver `agent_type`. Aceite 4 depende disso. (Default: T9 mede e relata; sem campo no mod, aceite 4 roda sem mod.)
5. Ordem `haiku < sonnet < opus < fable` para "abaixo do recomendado" e bump para `2.0.0-alpha.3` em T14. (Default: os dois.)
6. Deploy falho (antes do smoke): spec só define smoke e rollback. (Default: roda rollback; `entrega.fim {ok:false, motivo:'deploy'}` e `loop.parar {nao_conseguiu}`; rollback falho ⇒ `parar{rollback}`.)

# E5 — Fluxo Gabarito (E5a: o que a virada exige)

Iniciativa: gabarito-mestre 2.0 · Epic: E5 · PBI: GM-13 (Enabler) · Data: 2026-11-10 · Visão: `2026-10-31-visao-2.0-design.md` §6.7, §6.11, §6.12, §8 (A8, A10), §9 item 5, §10 · Decisões do dono de 2026-11-09 (memória `loop-ate-entrega-2-0`, ledger GM-12 R2), que vencem a visão onde diferem · r1 (r0 + A1–A13 e B3–B6 decididos pela Sombra, `.superpowers/sdd/2026-11-10-e5-fluxo/sombra-spec.md`, delegação do dono de 2026-11-04; B1, B2, B7 pendentes do dono, fim do documento)
Legenda: **(a)** medido/lido · **(b)** a medir · **(c)** decisão do dono, da Sombra ou do redator. Caminhos `gates/`, `mod/`, `hooks/`, `skills/`, `scripts/` são relativos a `plugins/gabarito-mestre/`.

**STATUS: aguardando aprovação do dono.** Hoje (E4 em `enabler/GM-12-painel`, a mergear em `next`; `next` = 62ca3dd + E4): loop, pouso automático pelo mod, Sombra, emendas, entrega, painel. O produto **não** aprende sozinho: aprendizado é prática manual do orquestrador deste repo (`docs/aprendizados/loop-e1.md`). **Esta spec: nada implementado.**

**Objetivo.** O adotante recebe, sem tela nova e sem passo manual, o que o dono usa todo dia: o loop pousa e retoma sozinho depois do `/clear`, todo erro e acerto medido vira regra que volta ao trabalho seguinte, e as decisões ficam registradas. Com isso, mais onboarding curto e o nome Fluxo Gabarito, `next` vira `main` como 2.0.0.

## Corte proposto (c, redator; pendente do dono, B1)

A visão (§9.5) mais as decisões do dono somam ~16 requisitos: não cabem em 1 página nem em 10 REQ (visão §6.12). Proposta:
- **E5a (esta spec, obrigatória para a virada):** auto-aprendizado, retomada pós-`/clear`, registro de decisões, onboarding novo, renomeação, dogfooding, virada. É o que o dono disse que **tem de** estar no v2 e o que o time vê ao instalar.
- **E5b (spec própria, depois da virada, em `main` como 2.1):** schema `pacote/v1` e `/gabarito spec --pacote`; enablers de esteira (GitHub Environments, flags, digest, DB template no CI) com exceção de integridade por task; gates como pacote `npx`.
- *Por quê:* nada da E5b é pedido do dono para a virada; o pacote depende de pré-requisitos do Horizon fora deste repo (visão §7, D-H120/121 a reabrir); `gabarito-gates` não existe no npm (F8) e publicar é ação externa do dono; a exceção de integridade só serve aos enablers. *Rejeitado:* E5 inteira antes da virada — dobra a entrega e adia o que o dono já usa; *rejeitado:* virar sem onboarding novo — o time recebe o onboarding que o dono chamou de confuso.

## Fatos (a)

| # | Fato |
|---|---|
| F1 | Nenhuma ocorrência de "aprendiz" em `plugins/` (git grep, 2026-11-10). `TipoEvento` fechado sem aprendizado (`gates/src/tipos.ts:13-47`). Diário de entrega é versionado: o instalador só ignora `.harness/entregas/_sem-id/` (`scripts/instalar.sh:60`) |
| F2 | Prática de origem: regra D (com medição) / M (hipótese) e tabela E<n> com erro, dano, regra (`docs/aprendizados/loop-e1.md:5`, E1–E50); acertos P1–P15 com métrica (`processo-orquestrador.md:13-30`). E39: fechei a E3 sem registrar aprendizados, o dono teve de lembrar. E45: memórias do Claude ficaram na conta errada e não carregaram |
| F3 | Pouso: `executarPouso` grava `sessao.pouso`, gera instantâneo, `/clear`, `store retomando`, `$.prompt.submit` e `sessao.retomada` (`mod/gabarito.mjs:142-168`); falha ⇒ `loop.parar sem_pouso` (`:134-139`), que silencia o Stop (`gates/scripts/stop-loop.mjs:11`). Instantâneo ≤ 3.200 caracteres (`gates/src/pouso.ts:12`), decisões ocupam até 1.600 (E3 REQ-SOM-3) |
| F4 | `session.start` não dispara no `/clear`; `session.end {reason:'clear'}` sim; `$.state` e `usage()` zeram, `$.store` não (`sombra-t14.md` §M1, `task-14-relatorio.md:34`). A checagem "sessão anterior parou no meio do pouso" só roda em `session.start` (`mod/gabarito.mjs:520-531`). Hook clássico `SessionStart` casa `clear` (`hooks/hooks.json:17`) |
| F5 | Dono, 2026-11-09 (N=1): o wakeup do `/loop` dinâmico sobreviveu ao `/clear` e retomou o loop (memória `loop-sobrevive-clear`) |
| F6 | Decisões já no diário: `decisao.sombra`, `spec.aprovada`, `spec.emendada`, `emenda.rejeitada`, liberação de teto (`tipos.ts:32-47`; `spec.aprovada` só por hook humano, `gates/scripts/aprovar-spec.mjs:5`). Não há relatório markdown da entrega (só JSON do CLI; visão §5 prevê) |
| F7 | Onboarding 1.1.0: skill de 374 linhas, 4 fases, 13 menções a `AskUserQuestion` (`skills/gabarito-instalar/SKILL.md`); dono achou "muito confuso e nada intuitivo" (memória `onboarding-refatorar`, 2026-10-19), sem lista dos pontos concretos. `instalar.sh --atualizar` existe e nunca sobrescreve (`scripts/instalar.sh:3,7`) |
| F8 | "Workflow TRUE" em arquivos distribuídos: 12 ocorrências em 8 arquivos; 45 em 17 arquivos no repo todo, com histórico. CI tem job `texto` (`scripts/test/texto.test.sh`, `.github/workflows/ci.yml:91-99`). `npm view gabarito-gates` ⇒ 404 |
| F9 | Canal: `next` publica `gabarito-mestre-next`, `main` publica `gabarito-mestre` 1.1.0 (`.claude-plugin/marketplace.json:3` em cada ref). Tag `gabarito-mestre--v1.1.0` existe. Versão atual `2.0.0-alpha.4` |
| F10 | Dogfooding hoje é mínimo: `harness.config.json` da raiz com `perfil: repo-sem-app`; `.harness/` só com `capacidade.json`; E1–E4 rodaram com orquestração manual |
| F11 | O cartão do `SessionStart` já injeta o instantâneo em toda origem, `clear` inclusive, teto somado de 4.329 caracteres (`gates/scripts/cartao-sessao.mjs:5,30-37,340-349,515-575`); num pouso bem-sucedido o modelo já recebe o instantâneo 2× |
| F12 | O mod vê a origem do prompt: `PromptSubmitInput.origin.kind` ∈ `composer` (Enter no terminal), `bridge`, `scheduled-trigger` (/loop), `peer` (hand-back), `plugin`, `auto-continuation`…; slash command em `e.command` (`claude-code-2.1.319.d.ts:9499-9580,9765`). O mod já usa `peer` (`mod/gabarito.mjs:536-539`). O `UserPromptSubmit` clássico não traz a origem no contrato lido (`hooks/remind-orchestrator.sh:4,43`) |
| F13 | Papéis fechados `PAPEIS = implementador|revisor|correcao` (`gates/src/loop.ts:14`); `proximaAcao` devolve `concluir` com todas as tasks integradas (`:304`) |

## Decisões (c)

- **D1 Validação = o dono, nos projetos dele** (dono, 2026-11-09). Substitui o teste com pessoa de produto (visão A8, §6.11) e cumpre a entrega real na alpha (A10).
- **D2 Virada ao fim da E5a**, 2.0.0 sem alpha, CHANGELOG + nota ao time, tag 1.1.x preservada, backlog visível na nota (dono, 2026-11-09; "fim da E5a" depende de B1).
- **D3 Aprendizado é evento do diário**, projetado por todas as entregas da árvore corrente. Rejeitado: markdown à mão (E39); memória do Claude (por máquina e conta, E45); arquivo separado sem cadeia de hash (E3 D1).
- **D4 D só com evidência da máquina** (Sombra A4): `eventos[]` que existam no diário, ou `medicao {fonte, numero}` com `numero` finito e `fonte` = arquivo versionado no repo (conferido pelo CLI) ou `evento:<sessao>:<seq>` existente. Sem isso, grava como M. Limite: o agente pode versionar a própria fonte; o registro a expõe.
- **D5 Gatilho cria pendência, não lembrete.** Rejeitado: lembrete ignorável (E39); classificar "correção do dono" por texto.
- **D6 Sem tela nova** (dono: "trivial e intrínseco, mecanismo padrão"): aprendizado aparece em saídas existentes (cartão/instantâneo, item de `proxima`, conformidade, doctor, registro).
- **D7 Retomada pelo contexto, não por hook que grava** (Sombra A1, A7): só o mod grava `sessao.retomada`; o hook nunca grava nem decide "falhou"; o fallback é o cartão existente mais o turno reaberto pelo wakeup do `/loop` ou pela próxima mensagem do dono.
- **D8 Time com 1.1.x sem task de migração** (Sombra B3, reversível): o onboarding novo lê a config 1.1.x como default e usa `instalar.sh --atualizar`.
- **D9 Mecanismo começa vazio** (Sombra B4, reversível): E1–E50 e P1–P15 não são importados; importação vai ao backlog 2.x com gatilho "dono pedir". O dogfooding da GM-13 gera os primeiros.
- **D10 Mensagem do dono segue gatilho, com colapso** (Sombra B5): no máximo 1 pendência aberta de `dono.mensagem`; S5 mede o ruído.
- **D11 `next` continua canal de alphas** (Sombra B6, reversível): após o merge `next ⇒ main`, `next` avança por fast-forward até `main` e só então recebe alphas 2.1 como `gabarito-mestre-next`.

## Requisitos

**REQ-APR-1 Evento `aprendizado`.** `aprendizado {tipo: E|A, status: D|M, gatilho: {sessao, seq} | null, evidencia: {eventos[]?, medicao?: {fonte, numero}}, regra ≤ 300 caracteres, entra_em: [instantaneo|spec|brief:<papel>], substitui?: {sessao, seq}}`. `tipo`: `E` (erro: o que deu errado, dano, regra) ou `A` (acerto: prática que funcionou, métrica antes/depois); D/M é status. `brief:<papel>` só com papel de `PAPEIS` (`implementador|revisor|correcao`); fora disso o diário recusa. Recusa também sem `regra`, sem `entra_em` ou `substitui` inexistente. Forma no núcleo (`numero` finito; `fonte` relativa sem `..` nem absoluta, ou `evento:<sessao>:<seq>`; `eventos[]` existentes); o CLI `loop.mjs aprendizado` confere `fonte` de arquivo por `git ls-files --error-unmatch`. `status: D` sem evidência válida (D4) é recusado com motivo "grave como M". Nunca apaga; vale o mais recente da cadeia de `substitui`. Fechar sem regra: `loop.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>`.

**REQ-APR-2 Gatilhos e pendência.** Projeção pura `pendenciasAprendizado(eventos)` abre pendência para: (1) `review.veredito` com MAJOR ≥ 1 ou BLOCKER ≥ 1; (2) `loop.parar` de qualquer motivo, salvo `sem_progresso` gravado pelo próprio Stop; (3) fechamento da entrega, 1 por fechamento: gatilho = `{sessao, seq}` do último `task.integrada` quando todas as tasks do plano estão integradas, sem tipo novo em `TipoEvento`; (4) mensagem do dono durante loop ativo: o mod grava `dono.mensagem {sha256, chars}` em `events.dono.jsonl` quando `prompt.submit` tem `origin.kind` `composer` ou `bridge` e não é slash command; nunca o texto; sem mod, este gatilho não existe (doctor diz). Mensagens do dono não acumulam: no máximo 1 pendência aberta de `dono.mensagem`, ancorada na mais recente; fechá-la fecha as anteriores. Pendência aberta ⇒ `proximaAcao` (núcleo) devolve `aprender{pendencias[{sessao,seq,tipo}]}` depois das paradas (1)–(4b) e antes do pouso e de qualquer despacho (agente em voo segue); o mod nega `Agent` não revisor nesse caso. Stop com pendência: `block` uma vez por gatilho, com o comando que fecha; na segunda, aviso e deixa parar (também depois de `loop.parar`). `aprendizado` conta como progresso (`TIPOS_DE_PROGRESSO`). Fecha por `aprendizado` com `gatilho` igual ou por `aprendizado nada`.

**REQ-APR-3 Volta ao trabalho.** Projeção `aprendizadosVigentes` lê `.harness/entregas/*/events.*.jsonl` da árvore corrente (entregas de outras branches ficam fora até o merge). Instantâneo traz os D com `instantaneo`, até 800 caracteres, 160 por linha, com contagem do que ficou fora (limite de 3.200 não muda; S4). No `SessionStart`, aprendizado e linha de retomada (REQ-POU-3) vão no cartão existente (`cartao-sessao.mjs`), sob o teto somado de 4.329; corta primeiro o corpo do cartão, depois o instantâneo, nunca a linha de retomada. Itens `despachar` de `proxima` trazem `aprendizados[]` (D com `brief:<papel>` do item); a skill `gabarito-loop` manda incluí-los no brief. `SubagentStart` não muda. Skill `gabarito-conformidade` lista, ao conferir spec nova, os D com `spec` e marca os que a spec não trata. M nunca entra em brief, cartão nem instantâneo; aparece só no registro.

**REQ-APR-4 Doctor sem destino.** Doctor avisa (não bloqueia), com o comando que fecha: pendência aberta numa entrega concluída; `brief:<papel>` cujo papel saiu de `PAPEIS` depois de gravado; M envelhecido = mais de 2 entregas cujo primeiro evento é posterior ao M, sem `substitui`; loop sem mod ⇒ gatilho de mensagem do dono ausente.

**REQ-REG-1 Registro de decisões.** `loop.mjs registro` gera `.harness/entregas/<id>/registro.md` determinístico (mesmo diário ⇒ mesmo byte) com: aprovação da spec, decisões da Sombra (resposta curta + fontes), emendas aprovadas/rejeitadas e quem julgou, liberações de teto, desvios, descobertas, aprendizados D e M com fonte e número. Gerado e commitado no `concluir` pela skill; nunca editado à mão.

**REQ-POU-3 Retomada que não depende de `session.start`.** Com `sessao.pouso` sem `sessao.retomada` nem `loop.parar` posteriores na entrega, o cartão do `SessionStart` (`source: clear|resume|startup`) acrescenta, dentro do teto de 4.329, a linha `Loop da entrega <id> em pouso: rode loop.mjs proxima e siga.` (o instantâneo já vai no cartão). O hook não grava evento. Só o mod grava `sessao.retomada {via:'mod', chars}`, depois de `prompt.submit` aceito. Falha de `prompt.submit` depois do `/clear`: o mod avisa ("retomada pelo contexto; o wakeup do /loop ou sua próxima mensagem reabre o turno") e **não** grava `loop.parar`; falhas antes do `/clear` seguem `loop.parar {sem_pouso}`. Nunca dois `/clear`. A skill `gabarito-loop` manda rodar a entrega sob `/loop` dinâmico (F5, S3). Sem mod: `loop.mjs pousar` grava `sessao.pouso {percent:null, x, via:'dono'}` só na fronteira (recusa com task em voo) e imprime o instantâneo; a skill pede ao dono, em 1 linha, que digite `/clear`; o cartão retoma pelo mesmo caminho.

**REQ-ONB-1 Onboarding em ≤ 5 perguntas.** `gabarito-instalar` faz no máximo 5 perguntas, cada uma com "por que pergunto" e default pré-selecionado pelo que detectou (git, `package.json`, MCPs, origin/HEAD) ou pela config existente; mostra a prévia do que será criado e grava com um comando; termina com o doctor e a distância até a esteira padrão. Com harness anterior (1.1.x), a config existente vira default e o instalador roda `--atualizar` (D8). Perguntas propostas (pendente do dono, B2): tipo do repo, ambientes detectados, política de entrega, ferramenta de planejamento, perfil de modelos; versionamento e orquestração passam a ser detectados. Respostas viram JSON por script puro testável (`onboarding-config.mjs`).

**REQ-NOM-1 Fluxo Gabarito.** Job `texto` do CI (`scripts/test/texto.test.sh`) falha com `workflow[ _-]?true` (sem caixa) em `plugins/gabarito-mestre/**`, `.claude-plugin/marketplace.json`, `README.md`, `CHANGELOG.md` (fora das seções ≤ 1.1.x) e `docs/**`; exceções: `docs/ledgers/**`, `docs/aprendizados/**`, `docs/references/**`, specs e planos datados antes de 2026-11-10.

**REQ-DOG-1 Dogfooding.** A E5a roda pelo `gabarito-loop` do `gabarito-mestre-next` instalado (E4) desde a 1ª task. A última task roda, com o código da branch, o onboarding novo neste repo e `loop.mjs registro` da GM-13; o `registro.md` commitado é a prova. Aprendizados do orquestrador seguem em `docs/aprendizados/` até a virada. Dogfooding é aceite do fim, não de cada task.

**REQ-VIR-1 Virada.** `plugin.json`/`gates/package.json` 2.0.0; no merge `next ⇒ main`, `marketplace.json` fica com o nome de `main` (`gabarito-mestre`); depois, `next` avança por fast-forward até `main` (D11). CHANGELOG 2.0.0; nota ao time em `docs/` com como instalar, "rode o onboarding" para quem tem 1.1.x, como voltar à 1.1.x (tag `gabarito-mestre--v1.1.0`) e o backlog conhecido (MINORs GM-9..GM-13, E5b, E6, importação de E1–E50). Merge em `main` só pelo dono.

## Spikes e medições (b), Task 0

- **S1** (sombra-t14 M1.4): `$.session.id` muda no `/clear`? `$.clock.every` segue disparando? `$.agent.list` mantém os vivos?
- **S2** Sem spike separado: confirmar no aceite TUI que a mensagem digitada chega com `origin.kind: composer` e a retomada do mod com `plugin` (contrato lido no d.ts, F12).
- **S3** O wakeup do `/loop` sobrevive ao `/clear` numa sessão com o plugin instalado (repete F5 com N ≥ 3)?
- **S4** Tamanho real do instantâneo e do cartão numa entrega com decisões (fumaça com o diário da GM-13): cabem 800 caracteres de aprendizado sem cortar decisão nem a linha de retomada?
- **S5** Mensagens humanas por entrega nas sessões da E4 (transcripts): ruído do gatilho de mensagem do dono.

## Fora de escopo (dono: Gabriel)

E5b inteira (gatilho: virada concluída) · E6 QA via browser e output style · backlog da visão §10 (`git commit -am`, raiz por cwd, `Bash(bash:*)`, `--vincular` sem dedupe, `CODEOWNERS` EEXIST, chaves mortas, `.hashes-anteriores`, cópia de `test/`, job `gates-tests`): E5b, gatilho spec da E5b · MINORs GM-12 (ledger, seção Backlog): na nota da virada · importar E1–E50/P1–P15 (gatilho: dono pedir) · `brief:` para Sombra, spike e revisor final (gatilho: 1º aprendizado que precise) · classificar mensagem do dono por conteúdo (gatilho: S5 mostrar ruído > 50 % de `nada`) · entregas de branch não mergeada na projeção (limite declarado).

## Testes e aceites

Núcleo puro por `node --test`, mutação nomeada por REQ:
- **APR-1:** `brief:sombra` ⇒ recusa; `fonte` inexistente ⇒ recusa; `numero` `"12"`/`NaN` ⇒ recusa. Mutações: aceitar D sem evidência; pular `ls-files` (teste de arquivo não versionado falha).
- **APR-2:** plano de 3 tasks integradas ⇒ `aprender` com gatilho do 3º `task.integrada`, fechado ⇒ `concluir`; MAJOR + percent ≥ X ⇒ `aprender`, não `pousar`; 5 `dono.mensagem` ⇒ 1 pendência, 1 `nada` ⇒ 0; `loop.parar sem_progresso` ⇒ 0 pendência; 2 Stops seguidos ⇒ `block` e depois `systemMessage`; mod com origens `composer`, `peer`, `plugin`, `scheduled-trigger`, `composer`+`command` ⇒ só a 1ª grava. Mutações: despachar com pendência; ancorar no 1º `task.integrada`; 1 pendência por mensagem; `block` sempre; aceitar `peer`.
- **APR-3:** item revisor não traz aprendizado de implementador; cartão com instantâneo cheio + linha de retomada ⇒ ≤ 4.329 e linha presente. Mutações: M no brief; linha de retomada cortada antes do cartão.
- **APR-4:** fixture com 3 entregas posteriores ao M ⇒ aviso; 2 ⇒ silêncio. Mutação: `>=` 2.
- **REG-1:** mesmo diário em 2 rodadas ⇒ mesmo byte. Mutação: ordem de chegada muda o registro.
- **POU-3:** diário com `sessao.pouso` sem retomada ⇒ cartão `clear` traz a linha; com `sessao.retomada` posterior ⇒ não traz; `pousar` com task `implementando` ⇒ recusa. Mutações: hook grava `sessao.retomada` (teste que conta 0 eventos do hook falha); submit pós-`/clear` grava `loop.parar`; pousa com task em voo.
- **NOM-1:** string plantada em `plugins/…/README` ⇒ falha; em `docs/ledgers/x.md` ⇒ passa.

**Fumaça sem LLM** em `npm test`: plano de 3 tasks com review MAJOR ⇒ `aprender` ⇒ aprendizado D ⇒ instantâneo, cartão e brief do papel o trazem; `concluir` gera `registro.md` idêntico em 2 rodadas; doctor avisa pendência aberta; respostas do onboarding (inclusive com config 1.1.x) ⇒ config esperada.
**Aceite 1 (TUI, `auto`, haiku, pty 180×50; limite: um terminal, sem mouse):** pouso com `GABARITO_POUSO_X` baixo, `/clear` e retomada sem digitar nada; o instantâneo traz o aprendizado do gatilho anterior; mensagem digitada grava `dono.mensagem` com `composer`, retomada do mod não grava (S2).
**Aceite 2 (TUI):** `prompt.submit` forçado a falhar depois do `/clear` ⇒ diário com 1 `sessao.pouso`, 0 `sessao.retomada`, 0 `loop.parar`, ≥ 1 evento de progresso depois (turno reaberto pelo wakeup), 1 só `/clear`.
**Aceite final (dono, nos projetos dele, antes da virada; projeto pendente, B7):** instala a alpha da E5a e vê, sem pedir: (1) onboarding com ≤ 5 perguntas até o doctor; (2) ≥ 1 pouso com retomada sem digitar (pode sair com `GABARITO_POUSO_X` baixo); (3) ≥ 1 aprendizado por gatilho (o de fechamento basta) reaparecendo no brief ou instantâneo seguinte; (4) `registro.md` commitado; (5) nenhum "Workflow TRUE" na interface. CI 100 % verde; review final Fable.

## Pendente do dono

1. **Corte da E5:** (a) **[recomendado]** E5a agora (aprendizado, retomada, registro, onboarding, nome, virada); pacote `pacote/v1`, `/gabarito spec --pacote` e gates via `npx` vão para 2.1 · (b) E5 inteira antes da virada (aprox. o dobro do prazo) · (c) outro corte.
2. **Onboarding — o que confundiu na 1.1.0?** (marque quantas quiser) (a) 4 fases longas · (b) perguntas demais (~13) · (c) colar comando `--set`/`--tudo` · (d) perguntas de versionamento/orquestração que eu não sabia responder · (e) outro: ___. **E as 5 perguntas:** (a) **[recomendado]** tipo do repo, ambientes detectados, política de entrega, ferramenta de planejamento, perfil de modelos · (b) trocar alguma: ___.
3. **Aceite final antes da virada:** em qual projeto você instala a alpha da E5a? (a) **[recomendado]** o que tiver a próxima entrega pequena real (diga qual: True Force / Sherlock / Separatrue) · (b) os três · (c) só neste repo (dogfooding) e virar sem projeto externo.

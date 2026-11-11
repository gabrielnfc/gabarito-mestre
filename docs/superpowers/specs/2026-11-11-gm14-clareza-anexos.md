# GM-14 — Anexos da spec (r4, Emenda 2 consolidada)

Anexos de `2026-11-11-gm14-clareza-design.md`. Valem como a spec; o corpo traz só o requisito. Legenda e caminhos: os do corpo.

## A. Fatos

| # | Fato | |
|---|---|---|
| F1 | O painel é uma Pane lateral (`$.ui.open`, `mod/painel.mjs:349-353,652-663`) mais uma faixa `AbovePrompt` de 1 linha (`faixaDe`, `:176-199,665-692`) | (a) |
| F2 | Sem `plano.json` o painel diz `sem_loop` (`mod/painel.mjs:58,114`; `gates/scripts/loop.mjs:343,360`; `gates/scripts/painel.mjs:311-317`) | (a) |
| F3 | `AbovePrompt` (`tui` S1, 12 sessões): em tela cheia e foco `maxRows` = 20/15/7/5 em 50/40/24/20 linhas (= ⌊H/2⌋ − 5), com janela `maxRows − 1` + "N more"; sem tela cheia `maxRows` = H, sem teto nem rolagem, e o topo some (80×24, 20 linhas: perde 1–2); botão fora da janela ainda disparou; redesenho de 30 s = 0 byte novo; não medidos: `hasSurvey`, foco sem tela cheia | (a) |
| F4 | `ui.render` de `ToolGroup` troca a linha de ferramenta 4/4 nos 3 modos, ctrl+o mostra o cru (`tui` S2); `MessageDisplay` só vê o stream do assistente (`docs/ledgers/GM-9.md:54`); `viewMode: "focus"` exige `tui: fullscreen` pela doc e nenhum mod o grava (`chat`) | (a)/(b) |
| F6 | `TipoEvento` guarda `dono.mensagem {sha256, chars}`, nunca o texto (`gates/src/tipos.ts:51`); sem ID o diário vai a `_sem-id/` (`gates/src/diario.ts:440`), ignorado pelo instalador (`scripts/instalar.sh:60`) | (a) |
| F7 | O painel mostra comandos (`/gabarito-mestre:liberar`, `loop.tetoTokens`; E4 REQ-PNL-2/3); o botão já põe o comando no prompt sem enviar (`mod/painel.mjs:680-688`) | (a) |
| F8 | Comando humano é provado por hook `UserPromptExpansion` com `disable-model-invocation` (`hooks/hooks.json:52`); `$.agent.list` dá os agentes vivos (E4 F6) | (a) |
| F9 | O onboarding pergunta com jargão ("Política de entrega", "Perfil de modelos", `gates/scripts/onboarding.mjs:573,614-624`), a skill manda mostrar a prévia "como veio" e cita "R19 a R21" (`skills/gabarito-instalar/SKILL.md:30,41`) | (a) |
| F10 | `onboarding.mjs` não lê ledger, backlog nem Apêndice (0 ocorrências); D exige evidência da máquina (E5 D4) | (a) |
| F12 | `gh` (N = 25): `pr list` p95 659 ms, `release list` p95 762 ms; sem rede rc = 1 em ~65 ms, 3/3 (`dados` S3) | (a) |
| F13 | Nota da virada e fechamento do onboarding prometem o painel "ao lado" (`docs/virada-2.0.md:28`, `SKILL.md:68`) | (a) |
| F14 | Canvas: 7 fases, "fase N de 7" com barra, origem em cada linha do histórico, pergunta com 3 botões (telas 1–3, 6–9); tela 10 pergunta pela consequência, incluindo publicar sozinha (E5 D13) | (a) |
| F15 | As regras de fase da r1 erram 7 de 8 células (`dados` S3): spec editada 3–9× após aprovar, 2 specs por ID, 2 PRs por ID, 0 de 162 branches do Sherlock casam `[A-Z]+-\d+` e o token casa "afterclick" em 33; `versionamento-check.mjs:39` e `loop.mjs:341` divergem | (a) |
| F16 | `PostToolUse` de `AskUserQuestion` chega ao hook com `tool_response.answers`, 3/3, `agent_id` nulo (`tui` S5); não medidos `multiSelect` e resposta digitada | (a) |
| F17 | Herança (`dados` S6): fontes da r1 = 0 candidatos nos 3 repos; ampliadas, 175/175 com origem literal, 18/84/73 candidatos, origem certa 12/12, 4/12, 6/12 (12 do Separatrue de 1 arquivo). S6b final: 0 inventado 14/14; certo 3/3, 4/4, 6/7 (`t0b.md:48,59`) | (a) |
| F18 | A ponte do mod resolve a raiz por `git rev-parse --show-toplevel` do checkout da sessão e a entrega por `/[A-Z]+-\d+/` na branch desse checkout (`gates/src/pouso.ts:323-327`); o `loop.mjs` usa a raiz PRINCIPAL (`--git-common-dir`, `gates/scripts/loop.mjs:122-133`) e a branch do `cwd` (`:335-345`); o painel lê pelo `loop.mjs` (`gates/scripts/painel.mjs:316`). Sessão numa worktree ⇒ o mod grava num diário e o painel lê de outro. `loopAtivo`, `avaliar`, `negaPorPendencia` e o pouso usam o `c.dir` da ponte (`mod/gabarito.mjs:535,625-641`) | (a) |
| F19 | 19:02–19:12 as mensagens do dono foram para `GM-13/events.dono.jsonl` (seq 1–7): o checkout principal estava em `enabler/GM-13-virada`, com a GM-13 já publicada (PR #14 mergeado, release 2.0.0) | (a) |
| F20 | "o que depende de mim?" digitada 1×, com o turno em curso (transcript: `enqueue`, `popAll`, `enqueue`, 1 `queued_command`); o diário tem 2 `dono.mensagem` com o mesmo sha (seq 2 e 3); o `prompt.submit` do mod não deduplica (`mod/gabarito.mjs:586-594`) | (a); mecanismo [M] S8 |
| F21 | A pendência `dono` é no máximo 1, na `dono.mensagem` válida mais recente (`gates/src/pendencias.ts:79-93`); `proximaAcao` devolve `aprender` antes de pouso, integração, despacho e `concluir` (`gates/src/loop.ts:262-265`); o mod nega `Agent` pelo núcleo (`mod/gabarito.mjs:636`) e por `negaPorPendencia` (`:640`, `:549-561`). Medido: 2 `Agent` negados por uma pergunta de status. É o desenho da E5 REQ-APR-2 | (a) |
| F22 | Slash command não vira `dono.mensagem` (`/gabarito-mestre:aprovar` 19:14:34 fora do diário); N5 e N12 refutados nesta sessão | (a) |
| F23 | `iniciar` grava o `modelo` lido do config por papel (`gates/scripts/loop.mjs:1077-1090,1422-1423`); T1 despachada com `model: "opus"`, diário com "sonnet" em toda `task.iniciada implementador` | (a) |
| F24 | Papéis do loop: só `implementador\|revisor\|correcao` (`gates/src/formas.ts:26`); T0 com spikes vivos aparecia "fila"; `papelDoAgente` dá `spike` e `sombra` pelo tipo (`uso-subagent.mjs:41-52`), sem `correcao`, que é despachada com o tipo `gabarito-implementador` | (a) |
| F25 | O vivo só casa com `description` exatamente `<task> <papel>` (`gates/src/painel-equipe.ts:18-31`); despachos reais ("T1 contratos GM-14 (implementador)", "T0a spikes TUI …") não casam: vivo "sem task" e task "◌ sem agente" (`:300-329`) | (a) |
| F26 | `AgentePainel` não tem descrição (`gates/src/tipos.ts:206-211`); vivo sem task sai só "sem task" (`painel-executivo.ts:174`) | (a) |
| F27 | `painel.mjs texto` sem `--agentes` ⇒ `agentes = null`, `percent = null`, pacote `terra-media` (`gates/scripts/painel.mjs:349-385`): "agentes —", "ctx —", GANDALF, ELROND e nomes dos pares no PLANO. O mod sorteia o pacote por sessão. Ctx "—" no mod: [M] S10 | (a) CLI |
| F28 | Cabeçalho `GABARITO · ${id} ${titulo}` (`painel-esquadrao.ts:106`, `painel-executivo.ts:63`); título = 1º `# ` da spec, sem limpeza (`painel.mjs:261-264`, `painel.ts:488`) ⇒ ID repetido | (a) |
| F29 | `git push` sem refspec fora de produção vira `{ambiente:'desconhecido'}` (`classificar-alvo.ts:325-329`) ⇒ `producao.acesso` (`decidir.ts:68-71`) ⇒ "alterou ambiente desconhecido · … · permitido" (`painel-texto.ts:323-333`). A guarda está certa; a frase não | (a) |
| F30 | REQ-TRI-1 dá progresso só de spec, plano, tasks e PR; o evento de review de spec está no backlog B5 | (a) |
| F31 | O nome só vem do par da task (`nomesPorPapel`, ordem do 1º `task.iniciada`); vivo não casado sai `nome: null` (`painel-equipe.ts:300-306`); o núcleo não guarda memória entre renders; o mod já guarda `agent_id → transcript` no `$.store`, teto 64 (`mod/painel.mjs:31,33`) | (a) |
| F32 | Vivo = `status` fora de `{idle, completed, failed, killed}` (desconhecido conta como vivo); task `implementando\|corrigindo\|em_revisao` sem vivo casado ganha "◌ <nome> sem agente" na EQUIPE (`:318-329`), mas `vivos` conta só `vivo: true` (`:338`): "2 vivos" e 7 linhas no diário GM-14. No SubagentStop, `uso-subagent.mjs` grava `custo.medicao` com `agente: 'subagent:<id>'` (`:211-229`): prova de que o agente terminou | (a) |
| F33 | O painel lê decisões da Sombra só de `decisao.sombra` (`diario-puro.ts:163-165`), que nasce em `sombra.mjs registrar` (`sombra.mjs:336-417`) depois de `perguntar` ⇒ `sombra.consulta` (`:309`); consulta aberta sem registro não chega ao render (`contarConsultas`, `diario-puro.ts:167-173`) | (a) |
| F34 | Emenda 2 (C1+C2): `concluida` e `aprovada` não aceitam `task.concluida` (`gates/src/loop.ts:91,95,149-150`; `loop.mjs:470-475`) | (a) |
| F35 | Emenda 2 (C3+C4): `reaberta.retomada` é autotransição; o único caminho para commit novo é um REPROVADO fictício, que gasta a rodada 1 (`loop.ts:76-81,129,134-135`) | (a) |
| F36 | Emenda 2 (C6+C7): o processo passou a concluir só com gate verde; entre hand-back e gate o PLANO diz "implementando" (`painel-formato.ts:66-68`); a skill já manda concluir no hand-back (`SKILL.md:28`) | (a) |
| F37 | Emenda 3 (C2+C4+C5+C6): T0 aprovada com sha `cd23d8f` já ancestral da base; `integrar` rebaseia para diff vazio, o gate reprova "0 commits" e o `merge --ff-only` cairia em `merge_sem_efeito` (`loop.mjs:880,902,936-938`; `gate-task.mjs:228`) | (a) |
| F38 | Emenda 3 (C7+C8): `aprovada` só sai por `task.integrada`; a regra (6) `integrar` vem antes do despacho (7): T0 integrável trava o despacho (`loop.ts:95,293-306,311`) | (a) |
| F39 | Emenda 3 (C9): `preparar` da entrega recusa `entrega_incompleta` com a T0 aprovada | (a) pelo spike do orquestrador |
| F40 | F-P1 (tipos da plataforma, build 2.1.322): vivos de `$.agent.list()` (status `pending\|running\|waiting\|idle\|completed\|failed\|killed`); a lista solta o agente "depois" do fim ⇒ `classic.SubagentStop` (traz `agent_id`, `last_assistant_message`, `background_tasks`) tira na hora; `tool.call` de subagente traz `agentId` (contrato, não testado ao vivo); segundo plano por `backgroundTaskId` + notificação de fim + `background_tasks` dos Stops, sem `$.task`; `nohup` só por `ps` (não atribuível). Hoje: `revisoresAguardando` = toda task `concluida` sem cruzar com a lista (`painel-equipe.ts:342-346`), `nomesPorPapel` gira 12 nomes por 25 pares (`:110-122`), status desconhecido conta como vivo (`:209,215-219`); o mod não registra `SubagentStop` | (b) contrato; (a) código |
| F41 | F-W1: o wakeup do `ScheduleWakeup` sobreviveu ao `/clear` 7 de 7; disparou com até 8m46s de atraso; a sessão nova começa só com o prompt do `/loop` | (a) |
| F42 | F-A1: `git ls-files .harness/entregas` = só `plano.json` (GM-13, GM-14); os `events.*.jsonl`, onde moram os aprendizados, não são versionados nem ignorados. Em disco: GM-13 1 evento de aprendizado, GM-14 42 (28 legados absorvidos em `events.loop.jsonl` seq 133–160: 22 D, 6 M). Leitor único: `diario.lerAprendizados` (`loop.mjs:1173-1180`), projeção `aprendizadosVigentes` (`aprendizado.ts:94`), brief por `paraDestino` exato `brief:<papel>` (`:131-133`), sem teto; o instantâneo corta em 800, mais recente primeiro, com rodapé "… N aprendizado(s) fora" (`diario.ts:49,368-381`) | (a) |
| F43 | Medido 18:40 pelo CLI do plugin 2.0.0: T12 `no_teto` e o painel diz "depende de você: nada"; cabeçalho "GM-14 GM-14 — …"; título de task com crase crua; "Previsão hoje 21:30 (±26 min, 10 medições)" | (a) |


## B. FIEL-8 (Emenda 2) — texto integral

Fonte: `.superpowers/sdd/2026-11-11-gm15/emenda2.md` §2, sem mudança de regra. **Ajuste da r4 (D-P4, D-P6, D-P8, D-P9):** não há bloco PLANO; "entregue" vale onde a task aparece (AGORA, ATENÇÃO, `painel-formato.ts`) e não é resultado do RECENTE; M-F8h passa a "o texto da task volta a 'aguarda revisão' ou perde o motivo". A revogação de "concluir só com gate verde" em `processo-orquestrador.md` é do orquestrador, quando a T31 integrar.

### Texto da emenda

Entra na seção "Cláusulas da Emenda 1" da spec, renomeada para "Cláusulas das Emendas 1 e 2". A contagem continua em 10 REQ: FIEL-8 é cláusula de REQ-DIA-2 (o que o orquestrador grava pelo `loop.mjs`) e de REQ-GLB-1 (o bloco PLANO).

**FIEL-8 Entregue é entregue, e commit novo depois do `concluir` não finge reprovação (N21, N22, N30, R17; REQ-DIA-2, REQ-GLB-1 PLANO; F34–F36).**

- (a) **"Entregue" no PLANO.** O orquestrador grava `concluir <task>` no hand-back do implementador, antes do gate. Não existe estado novo: `concluida` vai do hand-back até o revisor começar, e o gate do orquestrador roda dentro desse intervalo. No PLANO, `concluida` aparece como "entregue" (antes, "aguarda revisão"). Depois de uma reentrega, aparece como "entregue de novo" mais o motivo: "após o gate", "por decisão da Sombra" ou "a seu pedido". `painel.ts` troca "aguarda revisão de <ids>" por "entregues, aguardam gate e revisão: <ids>". Nada disso casa a regex de REQ-LNG-1. A linha `processo-orquestrador.md:67` ("concluir só com gate verde") é revogada e trocada pela ordem hand-back ⇒ `concluir` ⇒ gate ⇒ revisor.
- (b) **Reentrega.** O comando é `loop.mjs concluir <task> --motivo <gate|sombra|dono>`, sem subcomando novo. Ele grava `task.concluida {task, sha, motivo}`: o mesmo tipo, para não abrir mais 5 listas de tipo em `tipos.ts`, `formas.ts:16`, `diario-puro.ts:26`, `pouso.ts:92` e `loop.mjs:74`, que estão em série com T1b, T17, T29 e T30. Com `motivo`, o evento ganha uma chave própria na tabela, `concluida.reentrega`. Regras:
  - (b1) `concluida` + `concluida.reentrega` ⇒ `concluida`, com a rodada inalterada.
  - (b2) `aprovada` + `concluida.reentrega` ⇒ `concluida`, com rodada − 1. O APROVADO anulado não conta, porque o commit que ele aprovou não entra. O próximo veredito declara a mesma rodada que foi anulada.
  - (b3) Em qualquer outro estado, a chave é par ausente ⇒ `transicao_invalida`. Os estados são `pendente`, `implementando`, `corrigindo`, `em_revisao` (revisor em voo: espere o veredito), `reprovada` (o caminho é a correção), `no_teto` (só o dono tira) e `integrada`.
  - (b4) `concluir` **sem** `--motivo` em `concluida` ou `aprovada` continua inválido (N21 vira proteção, não defeito). A mensagem passa a citar `--motivo`.
  - (b5) A borda recusa com `sha_igual` e não grava nada quando o sha é igual ao do último `task.concluida` da task.
  - (b6) `motivo` fora de {gate, sombra, dono} ⇒ rc 1, nada gravado (`formas.ts`, forma de `task.concluida`, campo opcional). No núcleo, `chaveDe` devolve "motivo inválido".
  - (b7) A reentrega não grava `review.veredito` e não gasta rodada.
  - (b8) O revisor seguinte revê o diff inteiro. Em `enriquecer`, o item `revisor` ganha `diff: "<gabaritoBase>...<sha do último task.concluida>"` e, se houve reentrega, `reentrega: <motivo>`. Nunca `<sha anterior>..<sha novo>`.
  - Limite declarado: `motivo: dono` é declarado pelo orquestrador, como `origem: retomada`. O motivo não dá poder nenhum: não tira do teto e não pula review. A garantia vem de (b8) e de (c).
- (c) **`integrar` continua exigindo commit revisado.** Nada muda em `loop.mjs:869-874`. Depois de uma reentrega, a task está em `concluida`, então `podeIntegrar` é falso até um APROVADO novo. O `sha` exigido é o do ÚLTIMO `task.concluida`, que agora é o da reentrega.

**Fatos novos da spec:** F34 = C1+C2, F35 = C3+C4, F36 = C6+C7 (fonte: esta emenda, seção 1).

**Cobertura e mutações (FIEL-8):**

- Núcleo (`gates/test/loop.test.ts`):
  - `reentrega-em-concluida-fica-concluida-mesma-rodada`
  - `reentrega-em-aprovada-volta-concluida-rodada-anterior`: APROVADO r1 ⇒ reentrega ⇒ REPROVADO r1 é aceito e dá `reprovada`, não `no_teto`
  - `concluir-sem-motivo-apos-concluir-segue-invalido`
  - `reentrega-fora-de-concluida-e-aprovada-invalida`: por tabela, nos 7 estados de (b3)
  - `motivo-fora-da-lista-invalido`
  - `reentrega-nao-libera-integrar` (`podeIntegrar` falso)
- CLI (`gates/test/loop-cli.test.mjs`):
  - `concluir-motivo-sha-novo-grava`: dados `{task, sha, motivo}` e 0 `review.veredito` novo
  - `concluir-motivo-sha-igual-recusa`
  - `concluir-motivo-invalido-rc1-nada-gravado`
  - `integrar-apos-reentrega-exige-sha-da-reentrega`: commit em cima ⇒ `commit_nao_revisado`; APROVADO no sha da reentrega ⇒ integra
  - `revisor-apos-reentrega-recebe-diff-inteiro`: `diff` = base...sha novo, `reentrega: 'gate'`
- Forma (`gates/test/formas.test.ts`): `forma-task-concluida-motivo`, com ausente válido, os 3 valores válidos e `'outro'` recusado.
- Painel (`gates/test/painel*.test.ts`):
  - `concluida-mostra-entregue`
  - `reentregue-mostra-motivo`
  - `entregue-passa-lng` (dentro de `lng-propriedade`)
- Mutações:
  - **M-F8a** `aprovada` + reentrega sem rodada − 1
  - **M-F8b** `task.concluida` sem motivo aceito em `concluida`
  - **M-F8c** reentrega aceita em `implementando` ou `em_revisao`
  - **M-F8d** `integrar` lê o 1º `task.concluida` (`at(0)`)
  - **M-F8e** a borda aceita sha igual
  - **M-F8f** `diff` do revisor a partir do sha anterior
  - **M-F8g** a reentrega grava também `review.veredito`
  - **M-F8h** o PLANO volta a "aguarda revisão" ou perde o motivo


## C. FIEL-9 (Emenda 3) — texto integral com as correções da r4

Fonte: `.superpowers/sdd/2026-11-11-proxima/emenda3.md` §2. **Correções da r4, que valem sobre o texto da fonte:**
- **Correção 1 (sha aprovado = sha checado):** `alvo` é uma variável só, lida 1 vez do último `task.concluida`; (a5) a compara com o HEAD, (a6) a testa e (b1) a grava; nenhum `rev-parse` da branch ou da base entre (a5) e (b1). Com reentrega (FIEL-8 b2), o último `task.concluida` é o da reentrega, e o APROVADO exigido é posterior a ele. Teste `ja-na-base-mesmo-alvo-nas-tres-guardas`; mutação **M-F9l** (`alvo` relido em (b1)).
- **Correção 2 (última task sem integrar seguinte):** `<cobertura>` = (i) "o gate da integração de <Tx> já rodou sobre ele", se existe `task.integrada` anterior sem `ja_na_base` cujo sha tem `alvo` como ancestral; senão (ii) "o próximo integrar roda sobre ele", **só** se resta task do plano fora de `integrada` depois deste evento; senão (iii) "nenhum gate rodou sobre ele e não há outro integrar: a CI do pedido de revisão é a 1ª verificação, e o merge espera ela verde". Teste `ja-na-base-ultima-task-cita-ci`; mutação **M-F9m** (cobertura (ii) sem task restante).

### Texto da emenda

Entra na seção "Cláusulas das Emendas 1, 2 e 3" da spec. A contagem continua em 10 REQ: FIEL-9 é cláusula de REQ-DIA-2 (o que o orquestrador grava pelo `loop.mjs`) e de REQ-GLB-1 (bloco PLANO e histórico).

**FIEL-9 Commit aprovado que já está na base integra sem merge, sem rebase e com marca (C1–C9; REQ-DIA-2, REQ-GLB-1; F37–F39).**

- (a) **Guardas, nesta ordem.** Todas já existem até a (a5). A (a6) é nova. Qualquer falha ⇒ erro nomeado, rc 1, `{merge: false, evento: false}`, nada gravado, branch intocada.
  - (a1) diário válido (`diario_invalido`) e `podeIntegrar` verdadeiro: task `aprovada`, cadeia integrada (`nao_integravel`). `loop.mjs:850-851`.
  - (a2) worktree limpa (`worktree_suja`). `loop.mjs:852-854`.
  - (a3) base gravada e igual à da worktree principal (`base_divergente`). `loop.mjs:862-866`.
  - (a4) HEAD da worktree em `refs/heads/<branch>` (`head_divergente`). `loop.mjs:867-869`.
  - (a5) HEAD da branch = sha do ÚLTIMO `task.concluida` (`commit_nao_revisado`). `loop.mjs:870-875`. Esse é o sha que o APROVADO cobre: `podeIntegrar` só é verdadeiro com o veredito posterior a esse `task.concluida`. `review.veredito` não carrega sha; a guarda é esta.
  - (a6) **Nova.** `git merge-base --is-ancestor <sha aprovado> refs/heads/<base>`, lido pelo código de saída. 0 ⇒ caminho (b). 1 ⇒ caminho normal, sem mudança. Qualquer outro código ⇒ `ancestral_indeterminado`, nada gravado. A checagem roda depois de (a5) e antes de `carregarMutacoes` e do `rebase` (`loop.mjs:876`, `:880`).
- (b) **Caminho "já na base".** Sem `rebase`, sem gate, sem `merge`. A branch e a base não se movem.
  - (b1) Grava `task.integrada {task, sha: <sha aprovado>, ja_na_base: true}`, sem `mutacoes`.
  - (b2) Chama `fechar(c, task)`, como no caminho normal. Os erros `evento_nao_gravado` e `fechar_falhou` valem iguais, com `merge: false`.
  - (b3) Devolve `{task, branch, base, merge: false, ja_na_base: true, evento: true, fechada: true, banco, ignorados_removidos, relato: [<aviso>]}`.
  - (b4) A linha `aviso:` do relato: `aviso: <task> já estava na base (<sha12> é ancestral de <base>): integrada sem merge, sem rebase e sem gate; <cobertura>`. `<cobertura>` = `o gate da integração de <Tx> já rodou sobre ele`, quando existe `task.integrada` anterior sem `ja_na_base` cujo `sha` tem o sha aprovado como ancestral (a 1ª em ordem do diário). Senão: `nenhum gate rodou sobre ele ainda; o próximo integrar roda`.
- (c) **Sem gate no caminho (b): decisão e motivo.**
  - O gate mede um diff. Com o sha na base, o diff é vazio por construção (C4, C5). Rodar o gate só reprovaria.
  - O conteúdo já está na base. Todo `integrar` seguinte roda as suítes sobre a base com ele (`loop.mjs:902`, `wt` rebaseada). Na T0, isso já aconteceu (C3).
  - Exigir uma integração com gate antes travaria: pela C8, nada é despachado enquanto a task estiver integrável.
  - A garantia que fica: revisão aprovada (a1, a5) e a `<cobertura>` dita no relato (b4). Nunca em silêncio.
- (d) **Caso normal intacto.** Com `--is-ancestor` = 1, o fluxo segue igual a hoje: rebase, gate, `merge --ff-only`, `task.integrada {task, sha: alvo, mutacoes}`, sem a chave `ja_na_base`.
- (e) **Forma.** `task.integrada.ja_na_base` é opcional. Se presente, só o literal `true`. `ja_na_base` junto de `mutacoes` ⇒ recusa. O núcleo (`loop.ts`) não muda: `aprovada + task.integrada ⇒ integrada` já existe (`:95`). C7, C8 e C9 se resolvem pelo evento.
- (f) **Painel.** O histórico mostra "<task> integrada (já estava na base)", sem contagem de mutações. A frase passa na regex de REQ-LNG-1. A contagem de mortas do rodapé ignora o evento: `mutacoes` ausente já é "não medido" (`gates/src/painel.ts:472-474`).
- **Limites declarados.**
  - O loop roda com o plugin 2.0.0 instalado. A correção só vale para a T0 quando o orquestrador chamar o `gates/scripts/loop.mjs` do repo, depois que a T32 integrar (dogfooding), ou na 2.1 instalada.
  - O escopo de arquivos do commit já na base não é reconferido pelo gate. Quem o conferiu foi o revisor (a1). Na T0: 1 arquivo, `docs/ledgers/GM-14.md`.
  - Commitar trabalho de task direto na base continua errado. FIEL-9 tira o loop do travamento, não legitima o atalho. A regra vai a `docs/aprendizados/processo-orquestrador.md`, pelo orquestrador, quando a T32 integrar.

**Fatos novos da spec:** F37 = C2+C4+C5+C6, F38 = C7+C8, F39 = C9 (fonte: esta emenda, seção 1).

**Cobertura e mutações (FIEL-9):**

- Forma (`gates/test/formas.test.ts`):
  - `forma-task-integrada-ja-na-base`: ausente válido; `true` válido; `false`, `'sim'` e `1` recusados; `true` com `mutacoes` recusado.
- Núcleo (`gates/test/loop.test.ts`), regressão sem código novo no núcleo:
  - `integrada-ja-na-base-libera-concluir`: T0 `aprovada`, resto `integrada` ⇒ `integrar`; com o evento ⇒ `concluir`.
  - `integrada-ja-na-base-libera-despacho`: T0 `aprovada` e T2 pendente sem dependência ⇒ `integrar`; com o evento ⇒ `despachar` T2.
- CLI (`gates/test/loop-cli.test.mjs`, `describe` novo logo após `integrar entra só o commit aprovado`, nunca no fim do arquivo):
  - `ja-na-base-integra-sem-merge`: base avançada até o sha aprovado. rc 0; evento `{task, sha: aprovado, ja_na_base: true}` sem `mutacoes`; HEAD da base igual antes e depois; worktree fechada; `merge: false`; `avaliar` injetado que lança não é chamado.
  - `ja-na-base-com-base-a-frente`: base com 1 commit depois do sha aprovado. Mesmo resultado; `sha` gravado = aprovado, não o HEAD da base.
  - `ja-na-base-aviso-sem-gate-ainda`: relato com a linha `aviso:` e "nenhum gate rodou sobre ele ainda".
  - `ja-na-base-aviso-cita-integracao-que-cobriu`: outra task integrada com gate sobre a base com o sha ⇒ aviso cita essa task.
  - `ja-na-base-head-alem-do-aprovado-recusa`: commit novo na branch depois do aprovado, sha aprovado na base ⇒ `commit_nao_revisado`, nada gravado.
  - `ja-na-base-worktree-suja-recusa`: ⇒ `worktree_suja`, nada gravado.
  - `ja-na-base-sem-aprovado-recusa`: task `concluida`, sha na base ⇒ `nao_integravel`, nada gravado.
  - `ancestral-indeterminado-recusa`: código 128 injetado (`opcoes.ancestral`) ⇒ `ancestral_indeterminado`, nada gravado, branch intocada.
  - `nao-ancestral-segue-caminho-normal`: base divergente com commit próprio ⇒ rebase, gate, merge; evento com `mutacoes` e sem `ja_na_base`.
  - `proxima-apos-ja-na-base`: `proxima` antes = `integrar`; depois = `concluir` (ou `despachar`, com pendente).
  - Asserção nova em `integrada-grava-sha` (existente): sem a chave `ja_na_base`.
- Painel (na T29, ver seção 3): `integrada-ja-na-base-mostra-marca`, dentro de `lng-propriedade`.
- Mutações:
  - **M-F9a** sem a guarda (a6): todo `integrar` vai ao caminho (b) ⇒ morre em `nao-ancestral-segue-caminho-normal`.
  - **M-F9b** (a6) antes de (a5) ⇒ morre em `ja-na-base-head-alem-do-aprovado-recusa`.
  - **M-F9c** `--is-ancestor` com os argumentos trocados ⇒ morre em `ja-na-base-com-base-a-frente`.
  - **M-F9d** grava o HEAD da base no lugar do sha aprovado ⇒ morre em `ja-na-base-com-base-a-frente`.
  - **M-F9e** evento sem `ja_na_base` ⇒ morre em `ja-na-base-integra-sem-merge`.
  - **M-F9f** o caminho (b) roda o gate ⇒ morre em `ja-na-base-integra-sem-merge`.
  - **M-F9g** o caminho (b) faz rebase ou `merge` ⇒ morre em `ja-na-base-com-base-a-frente` (base muda).
  - **M-F9h** código ≠ 0 e ≠ 1 tratado como 1 ⇒ morre em `ancestral-indeterminado-recusa`.
  - **M-F9i** forma aceita `false` ou `ja_na_base` com `mutacoes` ⇒ morre em `forma-task-integrada-ja-na-base`.
  - **M-F9j** aviso sem a `<cobertura>` ou sem a linha ⇒ morre nos 2 testes de aviso.
  - **M-F9k** (T29) histórico sem a marca ⇒ morre em `integrada-ja-na-base-mostra-marca`.


## D. Cobertura e mutações (`node --test`; `claude plugin test` no mod)

M1, M2 (r1), M11–M17 (r2), M18–M19 (review r2).
- **GLB-1:** com `local: 'acima'`, `Pane`/`$.ui.open` ⇒ falha (com `lateral`, a Pane é o painel; `nunca-os-dois` cobre os dois lados); H × `maxRows` (50/20, 40/15, 24/7, 20/5 tela cheia; 50/50, 24/24, 20/20 sem) ⇒ prioridades 1..k presentes, ≤ orçamento, 0 "N more"; orçamento 4 ⇒ linha de histórico com origem; H ausente com `maxRows` 5, 7, 13, 24; em execução a linha PRONTO e não a FASE; sem plano ⇒ FIEL-10 (b, e), 0 `sem_loop`; `hasSurvey`; ocultar mantém PAROU. Mutações: M13; M17; `sem_loop` sem plano; ocultar esconde PAROU.
  - *FIEL-3:* `casa-t1-contratos-com-tipo-implementador`, `t0a-casa-t0`, `t10-nao-casa-t1`, `correcao-com-tipo-implementador-cobre` (task em `corrigindo`: linha no AGORA, 0 no ATENÇÃO), `papel-antigo-vence-tipo`, `vivo-sem-task-mostra-descricao`, `descricao-tecnica-higienizada` (em `lng-propriedade`), `t0-pendente-com-spike-vivo-em-curso`, `iniciar-modelo-flag-vence-config`, `iniciar-sem-flag-igual-2-0-0`, `todo-vivo-tem-nome`, `nome-estavel-com-novo-agente`, `nome-estavel-apos-reload`, `nome-nao-colide-com-par`, `pacote-esgotado-sufixo-e-agente`, `store-nomes-ausente-x-corrompido`, `agora-e-atencao-concordam` (correção com tipo implementador ⇒ linha no AGORA e nenhuma no ATENÇÃO; terminado ⇒ fora do AGORA e, com a task ainda em voo, no ATENÇÃO). Mutações: M-F3a casamento exato; M-F3b `startsWith` (`T10` casa `T1`); M-F3c `--modelo` ignorado; M-F3d descrição some; M-F3e não casado volta a `nome: null`; M-F3f nome pela posição, sem store; M-F3g tipo vence estado; M-F3h descrição sem higienizar; M-F3i ATENÇÃO com o casamento antigo.
  - *FIEL-6:* `terminado-por-subagentstop-sai-do-agora`, `vivos-igual-linhas-de-agente`, `em-revisao-sem-vivo-na-atencao` (fixture GM-14 de 17:05: T0 e T4 ⇒ 0 "◌" e 2 linhas "sem agente trabalhando" no ATENÇÃO; Emenda 2 consolidada). Mutações: M-F6a ignora `custo.medicao`; M-F6b "◌" volta à EQUIPE.
  - *FIEL-7 (r4):* `sombra-ativa-no-agora`, `sombra-decisao-no-recente` (`perguntar` + `registrar` reais ⇒ "Sombra decidiu: <resposta>" no RECENTE com origem), `sombra-consulta-sem-registro-na-atencao`, `sem-linha-fixa-da-sombra`. Mutações: M-F7a consultas sem registro não aparecem no ATENÇÃO; M-F7b a linha fixa com contagem volta.
- **TRI-1:** 7 fixtures por fase; `gh` falho ⇒ `?`; 2 specs ⇒ pergunta; spec editada após aprovar ⇒ `✓`, "mudou depois" no depende/histórico e não no progresso; PR #14 mergeado + #15 aberto ⇒ `●`; "afterclick" sem 2º fato ⇒ pergunta; `anotar --entrega X` sem outro fato ⇒ X não identificada; `idDaBranch` igual nos 2 usos; S3b célula errada ⇒ `?`. Mutações: M1; M11; M19; 1º PR mergeado; `gh` falho vira `○`.
  - *FIEL-1 (b):* `entrega-publicada-nao-identifica-pela-branch` (fixture GM-13 com PR #14 mergeado), `gh-falho-identifica-pela-branch-com-aviso`. Mutação: M-F1b PR mergeado identifica pela branch.
  - *N17 (b):* `progresso-spec-com-revisor-vivo`, `progresso-emenda-aberta`, `progresso-execucao-sem-sufixo`. Mutação: M-N17b sufixo some fora da execução.
- **DEP-1:** ordem 1–4; aprovado no sha atual ⇒ some; nota "feito" do modelo não fecha; `(+N)` só se a lista não cabe. Mutações: M12; `(+N)` com lista que cabe.
- **DIA-1:** 3 medições iguais ⇒ 1 evento; `estado` byte a byte igual; campo extra ⇒ recusa; sentinela no transcript, `dono.mensagem`, resposta digitada e argumento extra de `responder` ⇒ 0 ocorrências em `.harness/`; `multiSelect` ⇒ M. Mutações: M2; gravar a cada medição; gravar com `gh` falho.
  - *FIEL-1 (a, c):* `ponte-raiz-principal-da-worktree` (reprodução dentro do `node --test`), `ponte-branch-publicada-sem-loop-ativo` (0 negação, 0 pouso), `mod-nao-grava-mensagem-sem-identificacao`, `sem-estado-do-painel-pendencia-review-nega`, `ponte-falha-com-pendencia-review-avisa-e-nao-pousa`. Mutações: M-F1a ponte volta a `--show-toplevel`; M-F1c ponte usa só `idDaBranch`, sem o 2º fato; M-F1d mod grava `dono.mensagem` em `_sem-id` ou na entrega da branch; M-F1e identificação lida do estado do painel.
  - *FIEL-2:* `mensagem-repetida-no-mesmo-turno-um-evento`, `mensagem-repetida-apos-turno-dois-eventos` (condicionado ao S8), `pendencia-dono-nao-nega-agent` (2 variantes: `percent` presente, caminho do núcleo; ausente, `negaPorPendencia`), `pendencia-dono-nao-barra-integrar`, `pendencia-dono-barra-pousar`, `pendencia-dono-x-concluir` (esperado `aprender`), `pendencia-dono-bloqueia-stop-uma-vez`, `segunda-mensagem-novo-block`, `pendencia-review-ainda-nega`. Mutações: M-F2a sem deduplicação; M-F2b `dono` volta a barrar despacho; M-F2c Stop deixa de bloquear `dono`; M-F2d filtro sai de `negaPorPendencia`; M-F2e `dono` deixa de barrar `concluir`.
- **DIA-2:** `duvida` com 1 opção ⇒ recusa; token ⇒ recusa; sem plano grava. Mutações: aceitar `duvida` sem opções; pular o canário.
- **PRG-1:** gatilhos (a)–(d); 2 abertas ⇒ 1 + `(+1)`; subagent, repetida, opção fora ⇒ block; `fill`, nunca `submit`. Mutações: aceitar resposta do modelo; ligar sem resposta.
- **LNG-1:** propriedade 10 estados × larguras 20–200 × presets × temas, fixtures `true_force` e `gabarito-mestre--v2.0.0` ⇒ 0 casamentos; origem da tabela. Mutações: PAROU com comando; tag sem normalizar; tipo novo sem tabela.
  - *FIEL-4:* `cli-sem-agentes-sem-nomes-nem-traco` (AGORA), `cli-com-agentes-igual-ao-mod`. Mutação: M-F4 CLI sem `--agentes` volta a "agentes —", GANDALF e GIMLI.
  - *FIEL-5:* `titulo-sem-id-repetido` ("GM-140 x" fica intacto), `historico-push-desconhecido-sem-permitido`. Mutações: M-F5a título cru; M-F5b volta "permitido".
- **ONB-2:** golden de `perguntas()` sem texto = 2.0.0; 3 fixtures sem termo proibido; foco "não" ⇒ settings iguais; "sim" ⇒ só chaves novas; ignore global ausente ⇒ linha no `.gitignore`; S1b(ii) refutado ⇒ grava `tui`. Mutações: mudar default; termo sem explicação; gravar sem ok; gravar sem `check-ignore`.
- ~~**ONB-3**~~: sai com o REQ (D-E1); os testes da T8 ficam na branch guardada.
- **Emenda 2 consolidada — painel (FIEL-10..13, GLB-1, DEP-1, LNG-1):** `local-padrao-lateral` (config ausente e inválida), `nunca-os-dois` (em `lateral` o `AbovePrompt` dá `next(e)`; em `acima` 0 `Pane` registrada e 0 `$.ui.open`), `lateral-pane-fechada-so-parou-e-pergunta`, `comando-painel-troca-local-sem-reiniciar`, `onboarding-grava-local-por-merge`, `blocos-na-ordem-e-vazios-somem`, `recente-5-lateral-2-acima`, `recente-encolhe-primeiro-acima`, `recente-so-resultados` (despachou/iniciou/entregou fora), `pronto-pinta-so-integradas` (aprovada não pinta; integrada não listada), `previsao-so-com-base`, `fase-fora-de-entrega`, `uma-linha-sem-entrega-em-curso`, `nada-so-com-todas-as-fontes` (fixture GM-14 18:40: T12 `no_teto` ⇒ item (5), nunca "nada"; fonte que falhou ⇒ "?"), `limpar-no-depende`, `titulo-uma-vez-sem-marcacao`, `sem-emoji-no-render` (dentro de `lng-propriedade`: 0 `\p{Extended_Pictographic}`, 0 U+FE0F), `executivo-igual-esquadrao-menos-nomes`, `executivo-papeis-da-tabela`, `nomes-unicos-entre-ativos` (25 pares, 12 nomes, 6 ativos ⇒ 6 nomes distintos), `orquestrador-primeira-linha-do-agora`, `contexto-plano-b-estimado`, `acao-ao-vivo-bash-description`, `acao-plano-b-registrado`, `acao-sem-fonte-interrogacao`, `segundo-plano-aparece-e-sai`, `subagentstop-sai-na-hora`, `status-desconhecido-nao-e-ativo`, `sem-fantasma-de-concluida`, `em-voo-sem-agente-vai-a-atencao`, `sombra-decisao-no-recente`, `desatualizado-atencao-e-nunca-nada`. Mutações: **M-P1** os dois locais ao mesmo tempo; **M-P2** padrão `acima`; **M-P3** aprovada pinta a barra; **M-P4** RECENTE com "despachou"; **M-P5** RECENTE não encolhe primeiro; **M-P6** "nada" com fonte falha; **M-P7** nome do par sem checar ativos; **M-P8** status desconhecido conta como ativo; **M-P9** `revisoresAguardando` volta ao AGORA; **M-P10** ação inventada sem fonte (frase fixa); **M-P11** executivo com renderizador próprio que muda bloco; **M-P12** glifo `⚠` aceito; **M-P13** desatualizado não muda o DEPENDE.
- **FIEL-8:** testes e mutações M-F8a..g de `emenda2.md` §2 (núcleo, CLI, forma); M-F8h vira "texto da task em ATENÇÃO/AGORA volta a 'aguarda revisão'".
- **FIEL-9:** testes e mutações M-F9a..k de `emenda3.md` §2, mais `ja-na-base-mesmo-alvo-nas-tres-guardas` (rev-parse injetado que muda entre (a5) e (b1) ⇒ o gravado é o lido em (a5)) e `ja-na-base-ultima-task-cita-ci` (única task restante ⇒ cobertura (iii)). Mutações **M-F9l** `alvo` relido da branch em (b1); **M-F9m** cobertura (ii) com nenhuma task restante.
- **FIEL-14:** `pousar-a-partir-de-x-com-contexto-da-sessao`, `contexto-de-outra-sessao-nao-conta`, `contexto-velho-ou-corrompido-e-nulo`, `pousar-grava-sessao-do-claude` (com `--sessao`; sem ela ⇒ `percent` nulo), `cartao-mostra-sessao`, `pouso-pendente-nao-despacha-nem-revisor`, `pouso-pendente-com-vivos-espera`, `pouso-pendente-sem-vivos-repete-pousar-sem-segunda-retomada`, `clear-de-outra-sessao-tira-pendente`, `sessao-paralela-startup-nao-tira-pendente`, `resume-nao-tira-pendente`, `push-no-pouso` (mod: `$.ui.notify` 1× com a chave do `sessao.pouso`), `push-repetido-com-novo-pouso`, `push-mesma-chave-nao-repete`, `notify-falha-mantem-toast-e-depende`, `skill-wakeup-prompt-autossuficiente`, `skill-loop-proxima-e-pousar-com-sessao`, `pouso-pendente-regra-unica` (mesma função no `loop.mjs` e no painel), **P9** `pouso-atravessa-cli-proxima-depende-painel` (`loop.mjs pousar --sessao S` real ⇒ `proxima --sessao S` real devolve `pousar`/`esperar` sem despacho ⇒ `painel.mjs estado` real mostra "limpar a conversa" no DEPENDE ⇒ `sessao.inicio {origem:'clear'}` de S2 ⇒ item some e `proxima` volta a despachar). Mutações **M-W1** revisor despachado com pouso pendente; **M-W2** 2ª retomada gravada; **M-W3** pendente sai com `sessao.inicio` de origem `startup`; **M-W4** push ausente no pouso; **M-W5** push sem dedupe (2 na mesma chave); **M-W6** repetição sem push novo; **M-W7** contexto de outra sessão usado; **M-W8** o painel não passa `pousoPendente` a `dependeDe` (item (6) some); **M-W9** `loop.mjs` com regra própria que aceita `origem: 'startup'` (diverge do painel); **M-W10** a skill sem `--sessao` no `proxima`.
- **APR-5:** `extrato-regravado-apos-aprendizado` (byte a byte igual ao diário), `exportar-idempotente`, `clone-novo-le-do-extrato` (cópia só com `git ls-files` ⇒ mesmos vigentes), `versao-anterior-chega-ao-brief-do-papel` (diário gravado pelo formato da 2.0.0, fixture versionada, lido pela 2.1 ⇒ `proxima` despacha implementador com o D `brief:implementador` e sem o D `brief:revisor`; M nunca), `extrato-diverge-vale-diario-e-avisa`, `extrato-ausente-igual-2-0-0`, `extrato-corrompido-avisa`, `extrato-com-token-fica-fora`, `instantaneo-corte-avisa-mais-antigos`, `brief-sem-teto`, `instalador-nao-ignora-extrato`. Mutações **M-A1** extrato não regravado; **M-A2** extrato vence o diário; **M-A3** chave sem `entrega` (colide entre entregas); **M-A4** rodapé volta ao texto sem "mais antigos"; **M-A5** extrato sem canário.
- **CHT-1:** 2 Bash ⇒ "executou 2 comandos"; 3 Read + 1 Bash ⇒ partes por vírgula; `isExpanded`/erro/`chat cru` ⇒ `next(e)`. Mutação: reescrever com `isExpanded`.


## E. Spikes

**Feitos (a):** S1 (F3), S2 4/4 (F4), S3 REFUTADA 7/8 (F15), S5 3/3 (F16), S6 (F17).

**[M] Task 0, cada um com plano B:**
- **S1b** (i) o mod lê H? Plano B: fórmula de H desconhecido (REQ-GLB-1). (ii) foco com `tui` padrão mostra foco e painel? Plano B: grava `tui: "fullscreen"` junto (D14).
- **S1c** `hasSurvey` verdadeiro numa survey real. Plano B: limite declarado.
- **S2b** `ToolUse` solo trocado 3/3. Plano B: cru, limite declarado.
- **S3b** Regras de REQ-TRI-1 nas 8 células do S3; meta 0 fase errada. Plano B: célula errada ⇒ aquela fase só por fato próprio, senão `?` "não consegui conferir". Mais: `gh` com rede que engole o pacote.
- **S4** O orquestrador anota: roteiro `roteiro-s4.md`, regra de REQ-DIA-2, N = 2; meta 100 % dos pontos viram `nota` ou pergunta; abaixo ⇒ dono (R1).
- ~~**S6b**~~ histórico (herança na 2.2, D-E1): 0 inventado 14/14; certo 3/3, 4/4, 6/7 (F17); abaixo da meta de 83 %.
- ~~**S7**~~ histórico (herança na 2.2, D-E1).

**[M] Emenda 1, cada um com plano B, na task dona:**
- **S8** Mensagem digitada com o turno em curso dispara `prompt.submit` 2× sem `turn.complete` entre os dois? N = 3. Plano B: deduplicar por texto em até 120 s. `mensagem-repetida-apos-turno-dois-eventos` fica condicionado ao S8.
- **S9** `agent.list().type` traz o `subagent_type`? Plano B em FIEL-3.
- **S10** `usage.context.percent` vem nulo no mod? Plano B em FIEL-11 (a): transcript da sessão, "(estimado)".
- **S11** Que `status` recebe o agente devolvido? Não bloqueia (FIEL-6 a).

**[M] Emenda 2 consolidada, cada um com plano B (F40 é contrato da plataforma, não teste ao vivo). S12–S15 rodam na T0b, onda A, antes de a T29 fixar o contrato do stdin (review r1 m4):**
- **S12** `tool.call` de subagente chega ao mod com `agentId` e, no `Bash`, com `description`, 3/3? Plano B: D-P16, último fato registrado (FIEL-11 b 2). Consome: T29, T35.
- **S13** `classic.SubagentStop` dispara no mod com `agent_id` no fim de cada subagente, 3/3, antes de a lista soltar o agente? Plano B: `custo.medicao` do diário (FIEL-6 a). Consome: T35.
- **S14** Trabalho com `run_in_background` aparece por `backgroundTaskId` e some na notificação de fim ou no `background_tasks` do Stop, 3/3? Plano B: segundo plano não aparece no AGORA; limite declarado. Consome: T29, T35.
- **S15** Intervalo real entre leituras do diário pelo mod (p95), N ≥ 20. Define o limite de "desatualizado" (FIEL-13 b) = 2 × p95; até medir, 180 s. Consome: T20.
- **S10** passa a decidir a fonte da linha do orquestrador (FIEL-11 a); plano B transcript. Task T20.

Tela do canvas → REQ: anexo `.superpowers/sdd/2026-11-11-proxima/canvas-req.md` (fora do git).


## F. Backlog

**Emenda 2 consolidada:** B6 herança da 1.x (REQ-ONB-3, T8 guardada, T16, T19, parte da T21, A3) ⇒ 2.2 · B7 guarda no mod que confere os aprendizados no prompt do `Agent` (REQ-APR-5 d) · B8 processo solto sem `backgroundTaskId` no AGORA (FIEL-11 c) · B9 prioridade do instantâneo por tipo em vez de recência (REQ-APR-5 c) · B1 "PR" na trilha × proibido no onboarding; "CI", "ctx", "tok" escapam da regex · B2 guardas M5 e M6 · B3 total de seções da spec · B4 rede que engole o pacote além de 5 s · B5 evento de review de spec (tela 3) · "mais N" sem caminho de volta (P3) · Emenda 1: guarda e `uso-subagent` pela branch (FIEL-1); PR intermediário mergeado desidentifica a entrega (FIEL-1 b); ponte falhando deixa aberta a negação por pendência de review (herdado da 2.0); `SendMessage` em agente já medido (FIEL-6 a); N11 no mod até o S10.


## G. Riscos

- **R1 O orquestrador esquece de anotar.** Gatilho (b) de REQ-PRG-1 independe de anotação; S4 antes, A1 no fim.
- **R2 Painel alto rouba o chat.** Orçamento `⌊H/2⌋ − 5` e prioridade (D15); ocultar existe.
- **R3 `gh` lento ou sem rede.** p95 < 1 s, falha em 65 ms (F12); timeout 5 s ⇒ `?`.
- **R4 Texto do dono no diário.** O diário não é commitado nesta entrega; nenhum campo recebe texto do dono (sentinela); notas passam pelo canário; a nota pode parafrasear o dono, a regra manda palavras próprias.
- **R5 Foco muda o terminal inteiro.** Só com ok que diz isso, local, reversível.
- ~~R6, R7~~ (herança): 2.2.
- **R9 AGORA depende de contratos não testados ao vivo** (F40). S12–S15 na T0b (onda A) antes de a T29 fixar o contrato; cada um com plano B que nunca inventa.
- **R10 Extrato de aprendizados em repo público** (REQ-APR-5). Só texto do orquestrador, já passado pelo canário, que roda de novo no extrato; o dono pode pôr o arquivo no `.gitignore` e perde só a durabilidade.
- **R11 Pouso pendente trava o loop** se a sessão nova não grava `sessao.inicio`. Teste `sessao-nova-tira-pendente`; o `/gabarito retomar` da 2.0 segue.
- **R8 Fase ainda erra.** [M] S3b; plano B `?`, nunca chuta.

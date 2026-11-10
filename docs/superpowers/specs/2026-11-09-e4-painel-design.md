# E4 — Painel

Iniciativa: gabarito-mestre 2.0 · Epic: E4 · PBI: GM-12 (Enabler) · Data: 2026-11-09 · Visão: `2026-10-31-visao-2.0-design.md` §5 (Mod, ADR-1), §6.5, §6.10, §8 (A2, A9), §9 item 4 · r3 (r2 + 3 respostas do dono, nomes e B7–B11 do orquestrador; r2 = desenho de 31/10 completo; r1 = r0 + B1–B6)
Fonte visual obrigatória: `.superpowers/brainstorm/99595-1793448347/content/painel-final.html` (Esquadrão 72 col, Executivo, Esquadrão 44 col, PAROU). `estilo-painel.html` é a rodada anterior, com emoji e dinheiro recusados. Regras: memória `ui-painel-decisoes` (31/10 e 02/11).
Legenda: **(a)** medido/lido · **(b)** a medir · **(c)** decisão do dono, do orquestrador ou do redator. Caminhos `gates/`, `mod/`, `hooks/`, `skills/` e `scripts/` são relativos a `plugins/gabarito-mestre/`.

**STATUS.** Hoje (E3 em `next`, 62ca3dd): o mod faz pouso, pausa e medição de tokens; não abre Pane nem faixa. O estado chega ao dono por `systemMessage` do Stop e por texto escrito à mão. **Esta spec: nada implementado.**

**Objetivo.** O desenho de `painel-final.html` vivo no CLI, mais uma linha no topo: "depende de você". Todo número sai do diário, de um transcript ou de um sinal da sessão, com fonte citada. O que o desenho mostra sem fonte foi criado aqui como evento ou campo (REQ-PNL-14) ou está em Fora de escopo.

## Fatos (a)

| # | Fato |
|---|---|
| F1 | S2 (2.1.316, N=2): Pane desenha cor 24-bit num `Text`, CONFIRMADA. `classic.MessageDisplay` só recebe o stream do assistente: REFUTADA (`docs/ledgers/GM-9.md:54`, `task-S2-report.md`). Mais de uma cor por linha não foi medido |
| F2 | S3: `classic.PreToolUse` de plugin roda 3/3 (`GM-9.md:55`); a cláusula de morte do ADR-1 não disparou |
| F3 | Mod oficial `code-modernization` 1.0.0 (README: rodado em 2.1.280). Lido, não rodado por nós: `ui.render` de `Pane`/`AbovePrompt` (`register.ts:779,837`); `$.ui.resolve(e)` ⇒ `Box`, `Text`, `Button onPress` (`:801,844`, `views/deck.tsx:106`); `bodyColumns`, `scroll.bodyRows`, `maxRows`, `hasSurvey` (`register.ts:785-799,855,867`); `$.ui.open` ⇒ `{isPlaced, reason}` (`host.ts:15-20`); `$.ui.invalidate`, `$.clock.every`, `$.prompt.fill`, `$.fs.read` (`register.ts:55-76`); `Text` aninhado com várias cores de tema numa linha (`deck.tsx:153-162`, `palette.ts:6-11`) |
| F4 | Mod atual: `$.ui.toast`/`$.ui.log` (`mod/gabarito.mjs:41-44`); `$.session.usage().context.percent` (`:125-131`); comando `gabarito` com resposta `{text}` (`:515-517,581-589`); ponte `node` por `$.process.run` com 5 s de timeout (`:47-58`); `$.store` sobrevive ao `/clear` (`:8`); `custo.medicao` do orquestrador a cada turno (`:401-409`). Teste do mod no CI: `scripts/test/mod-test.sh`, chamado no job de `.github/workflows/ci.yml:26-35` |
| F5 | Fontes no diário e no plano:<br>• estado de task só por `TRANSICOES`/`estadoDe` (`gates/src/loop.ts:85-140`); ETA mediana com n ≥ 3 (`gates/src/diario.ts:384-394`)<br>• `jaParou`, `vivosDe`, `lerX` com X padrão 50, tokens por `custo.medicao` (`gates/src/pouso.ts:191,80,10,68,208`)<br>• `decisaoDe` é pura e não exportada (`gates/scripts/entrega.mjs:264`); `decidirAgora` grava `entrega.agendada` (`:291-299`); `lerConfigEntrega` (`gates/src/entrega.ts:90`)<br>• decisões e consultas da Sombra (`gates/src/sombra.ts:118-145`); propostas abertas (`gates/src/emenda.ts:66`)<br>• pausa = `.harness/PAUSAR` no principal ou na worktree (`gates/scripts/loop.mjs:1018-1022`); `loop.tetoTokens` no config (`:992-995`)<br>• `producao.acesso`/`operacao.destrutiva` com `acao` e `alvo` (`gates/src/decidir.ts:70`); `TaskPlano` sem título e `Plano.spec?` (`gates/src/tipos.ts:109-110`); `MotivoParar` com 10 valores (`:124-134`)<br>• `ci.resultado {verde, alvo?}` sem duração (`loop.mjs:1336`); mutações do gate carregadas (`loop.mjs:720-735`) e rodadas por `avaliar` no `integrar` (`loop.mjs:885`), sem resultado no diário<br>• comando humano por hook `UserPromptExpansion` (`hooks/hooks.json:52-70`, `gates/scripts/liberar-teto.mjs:1-12`); `release_pr` nunca faz merge (`skills/gabarito-loop/SKILL.md:50`) |
| F6 | Tipos do `$` 2.1.319 (`claude-code.d.ts` da skill plugin-authoring, cópia em `.claude-tmp/e4-redator/`; instalado 2.1.321):<br>• `rateLimits[{kind: five_hour\|seven_day, percentUsed}]`, vazio fora de assinatura (`:12249-12264,12664-12669`); `context.window` e `context.tokens` da sessão (`:11862-11872`)<br>• `$.ui.notify` ⇒ `{isSent, channel\|reason}` (`:2498-2514`); `ThemeKey` (`:13841`)<br>• `CommandRunResult.text` vai às requisições do modelo (`:1873-1897`)<br>• `$.agent.list` ⇒ `{id, description, type, status}`, sem uso nem modelo; `description` é a do `Agent` (`:125-175,566`)<br>• eventos `classic.<Hook>` acessíveis ao mod (`:1274-1278`); `SubagentStart` traz `agent_id`, `agent_type` e a base `session_id`, `transcript_path`, `cwd` (`:853-856,13389-13393`), mas em `ClassicFields` a base é opcional (`:16409`) |
| F7 | Uso por subagent (dono, 2026-11-09, N=1): `~/.claude*/projects/<proj>/<sessao>/subagents/agent-<id>.jsonl` tem `message.usage` por chamada (29 linhas); contexto da última = `input + cache_read + cache_creation` = 92.762; `message.model` = `claude-opus-5-5`. As pastas `<sessao>/subagents/` existem neste projeto. `gates/scripts/uso-subagent.mjs` já soma esse transcript no `SubagentStop`, com dedupe por `message.id` (`:5,148,215`) |
| F8 | Fora de `TipoEvento` (`tipos.ts:9-40`): `spec.aprovada`, `testes.afetados`, etapa RED/GREEN. `entrega.mjs executar` negado no modo `auto` não grava nada, e comando nunca vai ao diário (E3 REQ-ENT-2). Não há detector de "serviço pago" ou de impacto estrutural (visão D5 só nomeia) |

## Decisões (c)

- **D1 Esquadrão é o padrão, Executivo a alternativa, com troca a quente** (dono, 2026-11-09). Mesma projeção, mesmos números; Parar idêntico nos dois. Rejeitado: só o Executivo, porque o dono escolheu o desenho de 31/10 completo.
- **D2 Fonte única.** `gates/src/painel.ts` é puro: projeção (diário + entradas ⇒ estado) e render (estado ⇒ linhas). `gates/scripts/painel.mjs` lê plano, diário, `decisaoDe` exportada, `.harness/PAUSAR`, spec, config de entrega de origin e os transcripts dos agentes vivos. **Só lê** (B2): nunca `decidirAgora`. O mod passa como entrada os sinais da sessão (contexto, janela, 5h/7d, X, agentes vivos com caminho do transcript, hora da notificação) e não calcula nada. Rejeitado: o mod ler o diário.
- **D3 Equipe = diário + agentes vivos.** A task e o papel vêm do diário (`task.iniciada` aberta). O agente vivo vem de `$.agent.list`, ligado à task pela `description` do `Agent`, que é `"<task> <papel>"`. Esse texto vem do item de `loop.mjs proxima` (`descricao`, REQ-PNL-14) e a skill o passa sem mudar. Agente vivo sem casamento ⇒ linha própria `sem task`. Task em voo sem agente vivo ⇒ `◌ sem agente`. Rejeitado: casar por texto livre ou por ordem de despacho.
- **D4 Topo = "depende de você"** nos dois presets, com a lista fechada da r1 (REQ-PNL-2). A faixa `◆ ATENÇÃO` do Esquadrão leva a Atenção técnica (2ª rodada, CI vermelho 1×, teto da Sombra) mais "loop segue em <tasks>". O Executivo não leva Atenção técnica.
- **D5 ETA.** Restante = mediana × ⌈restantes ÷ p⌉, com `p` = maior número de tasks em trabalho simultâneo já visto (≥ 1). Hora = agora + restante. `±` = metade do intervalo interquartil × ⌈restantes ÷ p⌉. Com n < 3: "sem dados".
- **D6 Cor por chave de tema** (F6), não hex. Estado: `success` ok, `warning` atenção, `error` só Parar, `inactive` parado. Identidade do nome, em ordem: `claude suggestion remember autoAccept ide`. Sombra sempre `planMode`. Tema `mono` = mesmo texto sem cor. Sem emoji, sem dinheiro, sem log de ferramenta.
- **D7 Spec a aprovar** (dono): um evento `spec.aprovada`; "aguardando" é derivado; comando humano `/gabarito-mestre:aprovar`. Não trava o loop (E5).
- **D8 Merge só aparece se exigir o dono** (dono). Hoje é sempre do dono (F5).
- **D9 Deploy devolvido só com evento** (B1, B10). Depois de `executar` negado, o orquestrador segue a skill `gabarito-loop` e roda `entrega.mjs devolver --motivo <t>`, que grava `entrega.devolvida {motivo}`. O plano edita a skill. O comando é remontado pelo id; `subir` sem esse evento não acende nada.
- **D10 Nomes por papel na task** (pacotes: orquestrador). O orquestrador é o líder e a Sombra é o sábio. Cada par (task, implementador ou correção) e (task, revisor) recebe o próximo nome do pacote, na ordem do 1º `task.iniciada`, em ciclo, determinístico na sessão.
- **D11 Janela do agente.** % = contexto ÷ `context.window` da sessão, só quando o `message.model` do agente é o modelo da sessão (último `custo.medicao.modelo` do orquestrador). Modelo diferente ⇒ só tokens, sem %. Assim nenhuma janela é inventada.

## Requisitos

**REQ-PNL-1 Projeção.** `projetarPainel(plano, eventos, entrada)` ⇒ `EstadoPainel`.

Entrada: `decisaoEntrega`, `pausado`, `contexto{percent, tokens, window}`, `limites{h5, d7}`, `x`, `agentes[{id, type, description, status, uso{contexto, tok, modelo}|null}]`, `pacote`, `notificacao{ts|motivo}|null`, `agoraMs`, `fuso`, `titulo`, `politica`, `base`, `entregaId`, `modeloSessao`, `specSha` (sha256 atual de `plano.spec`, ou null), `tetoSombra` (`sombra.teto` de origin, 26 padrão). Os seis últimos, e `fuso`, vêm do CLI, nunca do mod; `modeloSessao` = último `custo.medicao.modelo` do orquestrador (D11). *(emenda Sombra 2026-11-09, sombra-plano.md)*

Saída:
- **plano:** `tasks{id, titulo?, estado, glifo, nome?, papel?, modelo?, desdeS?, deps}`, `feitas`, `total`, `%`, `eta{hora, restanteS, maisMenosS, n}|null`, `rodadaMedia`, `medianaS`.
- **equipe:** líder `{ctx, x, tok, h5, d7, narrativa}`; `agentes[{nome, papel, task?, estadoTask, modelo, ctxPct|null, ctxTok, tok, desdeS}]`; revisores aguardando; Sombra `{decisoes, ultima{seq, resposta, fonte}}`.
- **depende[], atencao[], historico[], ocultos.**
- **rodapé:** `ci{verde, execucoesHoje}`, `prod{leituras, alteracoes}`, política.

Glifos (B3): `integrada` ⇒ `✓`; `implementando`, `concluida`, `em_revisao`, `reprovada`, `corrigindo`, `aprovada` ⇒ `●` com agente vivo, `◐` aguardando outro papel; `pendente` ⇒ `○`; `no_teto` ⇒ `✗` só na linha da task.

Outras regras:
- `feitas` = `integrada`.
- Título = H1 de `plano.spec` (B5), senão só o id.
- `tok` do líder = soma dos `custo.medicao` com `agente: 'orquestrador'`.
- `prod.alteracoes` = `producao.acesso {acao: escrita}` + `operacao.destrutiva` em prod.
- Diário recusado por `ordenar`/`estadoDe` ⇒ Parar `diario_invalido`.
- Determinística: a ordem de chegada não muda nada.

**REQ-PNL-2 Depende de você.** Itens `{nivel: parar|dono, motivo, acoes[{rotulo, comando|null}]}`.
- **Parar:** `loop.parar` vigente (`jaParou`); `decisaoDe` = `parar{…}` com loop em `concluir`; diário inválido. Texto e ações pela tabela da REQ-PNL-3.
- **Dono:**
  - spec aguardando ⇒ `/gabarito-mestre:aprovar`;
  - emenda aberta ⇒ aprovar/recusar `/gabarito-mestre:emenda aprovar|rejeitar <seq>` (até 3, depois "e mais N");
  - `.harness/PAUSAR` ⇒ `/gabarito retomar`;
  - `entrega.devolvida` sem `entrega.inicio` posterior ⇒ `node <plugin>/gates/scripts/entrega.mjs executar --entrega <id>`;
  - `release_pr` com merge do dono ⇒ "merge da release para `<base>`".

Lista vazia ⇒ `depende de você: nada`. Parar ou pausa ⇒ `parado`.

**REQ-PNL-3 PAROU, idêntico nos dois presets.** O topo vira, em `error`:
- `■ PAROU hh:mm  <texto>`;
- uma linha de ações;
- `<tasks em voo> continuam` (ou `nada continua`) · `produção: N alterações nesta entrega` · `notificação enviada hh:mm` (ou `não enviada: <motivo>`; sem mod, omitida).

O resto do preset segue abaixo. Tabela fechada (B7), só comandos que existem; sem comando, a ação diz o que o dono faz:

| `MotivoParar` | Texto | Ação |
|---|---|---|
| `teto_rodadas` | teto de rodadas de review em `<task>` | aprovar `/gabarito-mestre:liberar <task>` · recusar: deixe a task parada e emende a spec |
| `ci_vermelho` | CI vermelho 2× depois da última integração | veja o CI, corrija ou peça a correção, e diga ao loop para seguir |
| `teto_tokens` | teto de tokens da entrega | suba `loop.tetoTokens` no `harness.config.json` ou encerre a entrega |
| `sem_pouso` | o pouso automático falhou | digite uma mensagem para retomar pelo diário |
| `sem_progresso` | 3 paradas sem progresso | leia o diário e diga ao loop o que fazer |
| `diario_invalido` | diário fora da tabela de transições | confira o diário; nada segue até ele ser válido |
| `nao_conseguiu` | sem próxima ação e sem agente vivo | leia o diário e diga ao loop o que fazer |
| `smoke` | smoke em produção falhou; rollback feito | confira produção e a causa antes de nova entrega |
| `rollback` | rollback falhou: produção em estado desconhecido | aja em produção agora |
| `janela_ausente` | entrega exige produção sem janela ou comandos | declare `entrega.janela`/`entrega.comandos` em origin |

**REQ-PNL-4 Presets e temas.** Opções do render: `{preset: esquadrao|executivo, tema: color|mono, narracao, largura}`. Vocabulário do produto: `integradas`, não "pousadas" (B8).
- **Esquadrão:**
  - cabeçalho `GABARITO · <id> <título>` + `esquadrão · <pacote>`, depois depende/PAROU;
  - PLANO: barra `▰▱`, `%`, `N/M tasks`, `ETA hh:mm ±Nm`; faixa de `✓` colapsada com `integradas · N rodada média · mediana N min`; uma linha por task em voo ou na fila, com título, estado, nome e tempo; fila com `depende de <deps>`;
  - EQUIPE, `◆ ATENÇÃO`, histórico;
  - rodapé `CI ● · PROD leu N · alterou M · política <p> [<dias>] · ▼ N eventos`.
- **Executivo:**
  - Entrega; Previsão `hoje hh:mm (±N min, n medições)`; Tasks `integradas · em curso · na fila`;
  - Qualidade `N rodada/review · M mutações mortas` (contagem, B11; sem dados ⇒ `sem dados`);
  - CI `estado · N execuções hoje`; Produção; Contexto; Limites. O topo (depende/PAROU) é o mesmo `blocoTopo` do Esquadrão, só no alto.
  - Agentes em voo (dono, 2026-11-09): bloco ao fim, uma linha por agente vivo com papel genérico numerado, sem nome de pacote: `● implementador N  <task> <título> [(<estado>)]  <ctxPct>% <ctxTok> · tempo`; `◐ revisor aguarda <task>`; `○ Sombra N decisões · #seq <resposta>`; cabeçalho `N vivos`. Mesma fonte da EQUIPE (REQ-PNL-5); em < 60 colunas, só papel, task e ctx%.
  - Sem nomes de pacote, narração ou histórico.

**REQ-PNL-5 Equipe.** Árvore líder ⇒ agentes (`├─`/`└─`).
- **Líder:** `<LÍDER> orquestra · <modelo>`; ctx em barra `█░` com `pouso em X%`; `tok`; `5h`/`7d` em barras (ausente ⇒ linha omitida); `▶` com a narrativa em modelo de texto fixo a partir de `agora`.
- **Agente vivo:** `● <NOME> <estado da task> · <modelo> <task> ctx <barra> N% <ctxTok> · <tempo>`; `tok` (soma) fica no estado e não é desenhado. O estado é `implementando`, `em revisão` ou `corrigindo`, sem RED/GREEN (dono). Sem % ⇒ só tokens (D11). Sem uso lido ⇒ `ctx —`.
- **Revisor aguardando:** task em `concluida` (o revisor do par ainda não foi despachado; `em_revisao` sem agente vivo é `◌ sem agente`, D3). Linha `◐ <NOME> revisa aguarda <task>` quando o par (task, revisor) já tem nome (D10); senão `◐ revisor aguarda <task>`. Sufixo `N mutações do gate hoje, M mortas` (REQ-PNL-14), omitido sem integração de hoje com `mutacoes`. "Hoje" = data civil de `agoraMs` no fuso local do CLI; hora fora de hoje sai `dd/mm hh:mm`. *(emenda Sombra 2026-11-09, sombra-plano.md)*
- **Sombra:** sempre presente, `○ <SÁBIO> aconselha · <modelo>` com `N decisões · #<seq> <resposta cortada> (<1ª fonte>)`.

Ramos concluídos colapsam. Cabeçalho: `agentes N vivos`.

**REQ-PNL-6 Nomes.** Pacotes de fábrica em `mod/temas/nomes/{terra-media,herois,galaxia,hogwarts}.json`, formato `{nome, lider, sabio, nomes[≥ 8]}`:
- Terra Média: GANDALF/ELROND;
- Heróis: CAPITÃO/STRANGE (líder = Capitão América, como `CAPITÃO`);
- Galáxia distante: LEIA/YODA;
- Hogwarts: MINERVA/DUMBLEDORE.

Pacote próprio em `.harness/temas/nomes/<pacote>.json`, validado; inválido ⇒ fábrica com aviso. Nomes em caixa alta, ≤ 10 colunas, só largura 1.

Sorteio no `session.start`: hash do `$.session.id` sobre os pacotes, sem o de `$.store['painel:pacote']`, que é regravado. Sem mod: `--pacote`, padrão `terra-media`. Atribuição por D10.

**REQ-PNL-7 Histórico em linguagem natural.** Tabela fechada evento ⇒ frase com nome, glifo e hora local:
- `review.veredito` ⇒ "✓ GIMLI aprovou T07 · 18 min" ou "✗ … reprovou · N achados";
- `task.iniciada` ⇒ "▶ despachou …";
- `task.integrada` ⇒ "✓ T07 integrada · N mutações mortas";
- `decisao.sombra` ⇒ "◆ ELROND decidiu #seq · <resposta>";
- `producao.acesso`/`operacao.destrutiva` ⇒ "▲ <NOME> leu|alterou PRODUÇÃO · <alvo> · <faixa>";
- frases próprias também para `ci.resultado`, `emenda.*`, `spec.emendada`, `spec.aprovada`, `loop.parar`, `loop.pausa {estado}` (`{negado}` da guarda é log de ferramenta e não aparece), `task.reaberta {origem:'dono'}` ("▶ dono liberou <task>"), `sessao.pouso`/`retomada` e `entrega.*`. *(emenda Sombra 2026-11-09, sombra-plano.md)*

Tabela fechada: qualquer outro tipo não aparece (entre eles `custo.medicao`, `guarda.*`, `diario.recusa`, `sombra.consulta`, `task.concluida`, `task.reaberta {origem:'retomada'}`, `desvio`, `descoberta`, `sessao.inicio`); `dados` fora da forma ⇒ não aparece. *(emenda Sombra 2026-11-09, sombra-plano.md)* Entram as mais recentes que cabem; o resto conta em `▼ N eventos`. `narracao: false` esconde o histórico.

**REQ-PNL-8 Aprovação da spec.** `/gabarito-mestre:aprovar` é uma skill com `disable-model-invocation: true` mais o hook `UserPromptExpansion` `gates/scripts/aprovar-spec.mjs`. Grava `spec.aprovada {spec, sha256}` com o caminho de `plano.spec` e o sha256 atual. Recusa com block e motivo, sem gravar nada: subagent, plano sem `spec`, arquivo ausente, sha256 já aprovado. O evento entra em `TipoEvento` com forma validada. "Aguardando" = nenhuma aprovação com o sha256 atual. Não trava o loop.

**REQ-PNL-9 Densidade por largura.** Nada passa da largura nem quebra; corte com `…`. Só glifos de largura 1 em locale não-CJK (`▰ ▱ █ ░ ✓ ● ◐ ○ ◌ ✗ ■ ◆ ▲ ▼ ▶ ─ │ ├ └ ·`; ambíguos em CJK são limite declarado).
- **Esquadrão:**
  - ≥ 80: o desenho de 72 com título mais longo (coluna do título `min(40, w − 48)`; 24 em 72–79); o histórico só é cortado no fim da linha;
  - 72–79: o desenho de 72;
  - 60–71: sem título de task e sem narrativa do líder;
  - 44–59: o desenho de 44;
  - < 44: depende/PAROU, `N/M · ETA` e tasks em voo.
- **Executivo:** ≥ 50 é o desenho; abaixo, rótulos de 3 letras (`Ent Prv Tsk Qld CI Prd Ctx Lim`).

Depende/PAROU usa a largura antes do resto e nunca é cortado antes do comando. `color` e `mono` dão o mesmo texto.

**REQ-PNL-10 CLI sem mod.** `gates/scripts/painel.mjs`:
- `painel.mjs estado [--agentes <json em stdin>]` imprime o JSON;
- `painel.mjs texto [--largura N] [--preset …] [--tema …] [--pacote …]` imprime o render (padrão: 80, `esquadrao`, `mono`).

Falha ⇒ uma linha de JSON com `ok:false`. Nunca escreve: diário, `.harness/` e git ficam byte a byte iguais (B2). Sem mod não há agentes vivos: a equipe sai só do diário. A skill `gabarito-loop` põe `texto --preset executivo --largura 80` no topo de toda atualização de status ao dono.

**REQ-PNL-11 Pane e faixa.**
- **Abertura:** no `session.start` com `plano.json`, o mod abre a Pane, que desenha na `bodyColumns`. Com `isPlaced: false`, a faixa carrega o essencial.
- **Faixa** (`AbovePrompt`, 1 linha, cede a `hasSurvey`): PAROU em `error` ou "depende de você" em `warning`, com botão que põe o comando no prompt por `$.prompt.fill` e nunca envia. Com nada pendente: some se a Pane está aberta; com a Pane fechada, mostra `<id> N/M · ETA` em `inactive`.
- **Atualização:** a cada `turn.complete` e a cada 30 s enquanto existir `plano.json`, inclusive depois de Parar (B6). Uma chamada de `painel.mjs estado` por vez, com 5 s de timeout.
- **Falha:** linha de erro no topo; os números anteriores ficam em `inactive`.

**REQ-PNL-12 Parar nunca em silêncio.** Na transição para Parar (chave = motivo + `seq`): toast 1× e `$.ui.notify` 1×. `isSent: false` ou rejeição ⇒ só toast e faixa, sem repetir. O resultado vira `entrada.notificacao`. Sem som.

**REQ-PNL-13 Comando.** `/gabarito painel` abre ou foca a Pane. `/gabarito painel esquadrao|executivo|color|mono|narracao on|off|nomes <pacote>|ligar|desligar` grava em `$.store['painel:prefs']` e invalida (troca a quente). A resposta `{text}` é sempre **uma linha** de confirmação, nunca o render (B9, F6). O texto completo só pelo CLI `painel.mjs texto`. `pausar|retomar` seguem como hoje.

**REQ-PNL-14 Dados novos.** Só campos opcionais; nada antigo passa a ser recusado.
- `task.iniciada.modelo`: família, gravada por `loop.mjs iniciar` via `modeloDoItem` (`loop.mjs:1045`).
- `task.integrada.mutacoes {total, mortas}`: do `avaliar` do `integrar` (`loop.mjs:885`); só as mutações do gate (dono).
- `TaskPlano.titulo?`: ≤ 40 colunas, validado em `validarPlano`.
- `descricao: "<task> <papel>"` em cada item de `proxima`; a skill a usa como `description` do `Agent` (D3).
- `entrega.devolvida {motivo}` (D9) e `spec.aprovada` (REQ-PNL-8).

**REQ-PNL-15 Uso por agente** (dono). O mod ouve `classic.SubagentStart` (F6) e guarda `{agent_id → caminho}` em `$.store['painel:transcripts']`, com caminho = `<dirname(transcript_path)>/<session_id>/subagents/agent-<agent_id>.jsonl` (F7). A cada atualização, passa a `painel.mjs estado` os vivos de `$.agent.list` com o caminho.

O CLI lê só o fim de cada arquivo (≤ 256 KB). O núcleo `usoDoTranscript(linhas)` devolve:
- `contexto` = `input + cache_read + cache_creation` da última linha com `message.usage`;
- `tok` = soma com dedupe por `message.id` (mesma conta de `uso-subagent.mjs`);
- `modelo` = último `message.model` real.

Arquivo ausente, ilegível ou sem `usage` ⇒ `uso: null` e `ctx —`, nunca 0. `transcript_path` ou `session_id` ausente no evento ⇒ sem caminho e `ctx —`.

## Spikes e medições (b)

**S-E4**, Task 0, no build instalado (2.1.321), pty como S2:
- **(i)** `rateLimits` com `five_hour`/`seven_day` na conta do dono.
- **(ii)** `$.ui.notify` com `isSent: true`.
- **(iii)** 2+ cores de tema numa linha emitem 2+ SGR; refutada ⇒ só a cor do glifo.
- **(iv)** p95 de `painel.mjs estado` com 2.000 eventos e 4 transcripts < 1 s; acima ⇒ intervalo de 60 s.
- **(v)** caminho de REQ-PNL-15: `classic.SubagentStart` chega ao mod com `transcript_path` e `session_id`, e o arquivo derivado existe e cresce enquanto o agente roda (N ≥ 2, um deles em worktree). Refutada ⇒ um novo `SubagentStart` em `hooks/` grava o caminho num arquivo local fora do diário, e o mod lê de lá.
- **(vi)** cor real de `planMode` e das 5 chaves de identidade nos temas claro e escuro.

## Fora de escopo (dono: Gabriel)

Itens do desenho sem fonte, cortados (gatilho, motivo):
- **Etapa RED/GREEN** (gatilho: existir fonte): a linha mostra o estado da task (dono).
- **"slots 2/2"** (gatilho: slot medido barato): `capacidade.mjs` a cada render é caro; mostra `agentes N vivos`.
- **"serviço pago" e Parar por impacto financeiro ou estrutural** (E5, detector): sem detector (F8).
- **`/gabarito autorizar`:** não existe; o PAROU usa só comandos reais.
- **"38 afetados"** (E5, `testes.afetados`): evento não existe.
- **Duração do CI** (gatilho: próxima mudança em `loop.mjs ci`): `ci.resultado` não traz duração.
- **Mutações do revisor** (dono): só as do gate.

Outros itens fora:
- Trava do loop por spec sem aprovação (E5).
- Chave de merge pelo orquestrador (D8).
- HTML local e `/gabarito log --detalhe`.
- Dedupe de `custo.medicao` (`GM-11.md:73`): o painel lê o transcript, não o `custo.medicao` do subagent.
- `ci.resultado {alvo:'homolog'}` depois da suíte local (`GM-11.md:94`): limite declarado.

## Testes e aceites

**Núcleo puro por `node --test`, mutação nomeada por REQ:**
- MUT-PNL-1: `aprovada` com `✓`; ETA com n = 2; ordem de chegada muda a saída.
- MUT-PNL-2: emenda sem comando; `subir` sem `entrega.devolvida` acende; `release_pr` some.
- MUT-PNL-3: PAROU difere entre presets; motivo fora da tabela; comando inventado na tabela.
- MUT-PNL-4: Executivo com nome; mutações em %.
- MUT-PNL-5: limite ausente vira 0%; Sombra some; % com modelo diferente.
- MUT-PNL-6: sorteio repete o anterior; nome muda dentro da sessão.
- MUT-PNL-7: `custo.medicao` no histórico.
- MUT-PNL-8: sha256 antigo aceito; subagent aceito.
- MUT-PNL-9: 45 colunas em largura 44; `mono` sem o PAROU.
- MUT-PNL-10: o CLI chama `decidirAgora` (hash do diário e de `.harness/` antes e depois, com a janela fechada).
- MUT-PNL-12: toast a cada refresh.
- MUT-PNL-13: `{text}` com mais de 1 linha.
- MUT-PNL-14: `iniciar` sem `modelo`; `integrar` sem `mutacoes`.
- MUT-PNL-15: contexto soma `output`; sem dedupe; ausente vira 0.

**Propriedades e golden:**
- Propriedade: larguras 20–200 × 2 presets × 2 temas × 10 estados fixos; nada passa da largura; depende/PAROU sempre inteiro.
- Goldens por largura (44, 60, 72, 80) e preset: o builder escreve a partir desta spec, com o vocabulário do produto e sem os itens cortados (B8). O dono confere a captura real no review final.

**Mod por `claude plugin test`:** Pane, faixa, `isPlaced: false`, ponte falhando, toast e notify 1×, botão chama `fill` e não `submit`, troca a quente, sorteio sem repetir, `classic.SubagentStart` sem `transcript_path`.

**Fumaça sem LLM em `npm test`:** repo descartável, plano de 3 tasks com título e spec ligada gravado por `loop.mjs`; aprovação pelo hook com stdin de fixture, emenda aberta, `entrega.devolvida`, transcript de fixture (o de F7, anonimizado), depois `loop.parar {teto_rodadas}`; `painel.mjs texto` nos dois presets igual ao golden.

**Aceites com TUI** (pty 180×50 e 60 colunas, haiku):
- **Aceite 1:** fixture 7/12 com emenda; Esquadrão na Pane, faixa amarela, botão põe o comando no prompt sem enviar.
- **Aceite 2:** `/gabarito painel executivo` troca sem reabrir e responde 1 linha.
- **Aceite 3:** `loop.parar` gravado por fora ⇒ em ≤ 30 s, sem turno, PAROU igual nos dois, toast e notify 1×.
- **Aceite 4:** um subagent real (haiku, tarefa de leitura) ⇒ a linha dele mostra ctx e tokens iguais aos da última linha do transcript.

Limite: o pty prova bytes e cores, não o layout visto. CI 100 % verde; review final Fable.

# Registro de decisões — GM-15

## Aprovação da spec

- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:30 · spec docs/superpowers/specs/2026-11-15-gm15-fluidez-design.md · sha256 40eda65e7d03704603a482ccad71ccb71819963510501c4259f62b9e89aee1f3
- sha256 atual da spec: 40eda65e7d03704603a482ccad71ccb71819963510501c4259f62b9e89aee1f3 (confere com a última aprovação)

## Decisões da Sombra

- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:66 · REQ-HIG-1 · Fora da regra: sem decisão do dono legível que emende a FIEL-11 da GM-14, só cabe corrigir a ajuda na T22. Com o registro, aprova a T29 (deps T9, T22, antes da T27) com 6 condições: contexto ? mantido; null de 5h/7d/tokens decidido entre om… · fontes: docs/superpowers/specs/2026-11-15-gm15-fluidez-design.md:62-73, docs/superpowers/specs/2026-11-11-gm14-clareza-design.md:123-130, docs/superpowers/specs/2026-11-11-gm14-clareza-design.md:161, plugins/gabarito-mestre/mod/painel.mjs:66, plugins/gabarito-mestre/gates/src/painel-esquadrao.ts:483 · fora da regra (emenda #1)
- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:171 · REQ-HIG-1 · Sem julgamento da Sombra: o dono julgou as emendas 1 e 2 direto (/gabarito-mestre:emenda aprovar 1 e 2, spec.emendada origem dono) antes desta resposta; consulta encerrada pelo orquestrador. · fontes: docs/superpowers/specs/2026-11-15-gm15-decisoes-dono.md

## Emendas

- #1 · REQ-HIG-1 · tecnica · aprovada por dono · fato: renderBlocos (GM-14 T17) não desenha h5/d7 nem tokens por agente que o mod coleta (mod/painel.mjs:101-119, painel-equipe.ts:560) · diff: Emenda GM-15 (correção, pedido do dono 2026-11-15): o painel de 5 blocos (GM-14 T17, renderBlocos em gates/src/painel-esquadrao.ts:336+) deixou de mostrar o que o painel E4 mostrava e o mod ainda coleta, sem decisão do dono que o retirasse …
- #2 · REQ-HIG-1 · regra_negocio · aprovada por dono · fato: D-G1 (3de06ad): dono decidiu paridade total do painel de 5 blocos com o E4, prioridade e publicação imediata · diff: Emenda 2 GM-15 (substitui a 1) — fonte: D-G1, docs/superpowers/specs/2026-11-15-gm15-decisoes-dono.md (commit 3de06ad), resposta literal do dono. REQ-HIG-1 ganha (g) PARIDADE DO PAINEL COM O E4: os 5 blocos (renderBlocos, gates/src/painel-e…
- #3 · REQ-HIG-1 · regra_negocio · aprovada por dono · fato: etaDe (painel.ts:138) usa só mediana × ondas; ignora deps, tasks em voo, revisão e integração · diff: Emenda 3 GM-15 — fonte D-G2 (docs/superpowers/specs/2026-11-15-gm15-decisoes-dono.md; AskUserQuestion do dono "Junto no hotfix"). REQ-HIG-1 ganha (h) PREVISÃO EXATA: etaDe (gates/src/painel.ts:138, hoje mediana × ⌈restantes÷p⌉) passa a: cam…
- #4 · REQ-ENT-2 · regra_negocio · aprovada por dono · fato: painel.mjs:5-6 só uma entrega; sem varredura de worktrees; Passada 16 cards FL1 e só PBI-1 com diário · diff: Emenda 4 GM-15 — fonte D-G3 (dono 2026-11-15: reclamação de usuário do repo Passada, "se fizer sentido, já vamos emendar na entrega"). Texto da reclamação: .claude-tmp/gm15/reclamacao-visao-projeto.md. Fatos conferidos (a): painel.mjs:5-6 s…
- #5 · REQ-POU-3 · tecnica · aprovada por dono · fato: painel.js:653 chama pousoPendente sem medicao; proxima passa a leitura propria; painel mostra limpar a conversa com loop despachando · diff: Emenda GM-15 — fonte: dono 2026-11-15 ~19:10 ("sim, segue com o 2": corrigir o painel para a mesma medição do proxima). Fatos (a, medidos 2026-11-15 19:04-19:10 BRT): - gates/src/painel.ts (dist/painel.js:653) chama `pousoPendente(eventos, …
- #6 · REQ-HIG-1 · task T30 · tecnica · aberta · fato: previsão 22:07 sem fechamento nem base; caminho crítico 11 · diff: Texto integral, fatos medidos e testes: docs/superpowers/specs/2026-11-15-gm15-emendas-painel-loop.md (versionado). Fonte: dono no chat 2026-11-15 19:20-19:55 e auditoria do painel (48 campos: 35 CONFIRMADA, 12 REFUTADA). REQ-HIG-1 (h) ganh…
- #7 · REQ-POU-3 · tecnica · aberta · fato: 7 bugs do loop medidos na sessão · diff: Texto integral, fatos medidos e testes: docs/superpowers/specs/2026-11-15-gm15-emendas-painel-loop.md (versionado). Fonte: dono no chat 2026-11-15 19:20-19:55 e auditoria do painel (48 campos: 35 CONFIRMADA, 12 REFUTADA). Nova task T34 "Rob…
- #8 · REQ-HIG-1 · tecnica · aberta · fato: painel sem Sombra, ? sem motivo, 5h inexistente no Ultra, shells como Teste na EQUIPE · diff: Texto integral, fatos medidos e testes: docs/superpowers/specs/2026-11-15-gm15-emendas-painel-loop.md (versionado). Fonte: dono no chat 2026-11-15 19:20-19:55 e auditoria do painel (48 campos: 35 CONFIRMADA, 12 REFUTADA). REQ-HIG-1 (g) ganh…
- #9 · REQ-HIG-1 · tecnica · aberta · fato: auditoria: 8 REFUTADAS novas · diff: Texto integral, fatos medidos e testes: docs/superpowers/specs/2026-11-15-gm15-emendas-painel-loop.md (versionado). Fonte: dono no chat 2026-11-15 19:20-19:55 e auditoria do painel (48 campos: 35 CONFIRMADA, 12 REFUTADA). REQ-HIG-1 (g) ganh…

## Liberações de teto

- nenhum

## Desvios

- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:166 · task T14 · REQ-AUT-2 · tecnica · commit f12fccb: contrato autonomia boolean→texto quebra onboarding-texto.test.mjs (4), golden-perguntas-2.0.0.json, fumaca-e5.test.mjs (2) e fumaca-e5/caminhada.mjs, fora da lista da task · arquivos: plugins/gabarito-mestre/gates/test/onboarding-texto.test.mjs, plugins/gabarito-mestre/gates/test/fixtures/onboarding/golden-perguntas-2.0.0.json, plugins/gabarito-mestre/gates/test/fumaca-e5.test.mjs, plugins/gabarito-mestre/gates/test/fumaca-e5/caminhada.mjs
- b858de5d-1f94-47d0-96d4-35029cafd8e2:57 · task T16 · REQ-STP-1 · tecnica · stop-loop.mjs aceita integrar/gate-task em description OU command (S5: description vem do modelo, nao garantida); teste stop-integrar-em-fundo-so-no-command · arquivos: plugins/gabarito-mestre/gates/scripts/stop-loop.mjs

## Descobertas

- loop:1 · tecnica · sessao.pouso seq 282 (sessao 01db6bdc) em .harness/entregas/GM-15; sessao.inicio{origem:clear} da sessao b858de5d gravado em .harness/entregas/_sem-id (cartao-sessao.mjs:556-560, entrega publicada ou PBI nao inferido da branch hotfix/GM-15-…
- loop:2 · tecnica · painel.js:653 chama pousoPendente(eventos, onboarding) SEM medicao; loop.mjs proxima passa a leitura propria (contexto/b858de5d.json 19% fresca) e despacha. Painel cai na regra sem mod e exige sessao.inicio{clear} no diario GM-15, que o /cl…
- b858de5d-1f94-47d0-96d4-35029cafd8e2:58 · tecnica · scripts/loop.mjs:1234 (proxima) le GABARITO_POUSO_X so como inteiro; Stop (T16 1e2eb63) usa lerX de dist/pouso.js com decimal: X decimal diverge entre Stop e proxima
- b858de5d-1f94-47d0-96d4-35029cafd8e2:66 · tecnica · T5 8dacdf6: listas proprias de tipos de task sem task.fora: scripts/loop.mjs:96 (T6), src/diario-puro.ts:26, src/pouso.ts:92, test/e2e/avaliar.mjs:58 (task fora lida como pendente); src/painel-formato.ts:66-74 Record<EstadoTask> sem adiada/…
- b858de5d-1f94-47d0-96d4-35029cafd8e2:110 · tecnica · gate do integrar T16 reprovado por s6-gabarito-zero-errado: true_force (onboarding.test.mjs:1748): fixture s6-gabarito.json espera planejamento clickup; ~/projetos-true/true_force mudou em b38784df 2026-11-13 (harness 2.0 com fluxo em arqui…
- b858de5d-1f94-47d0-96d4-35029cafd8e2:123 · tecnica · mod-test.sh teto 120s (comentario: suite leva ~13s) estoura no gate do integrar: 120.1s (19:20) e 120.0s (19:40), passou 103.8s (19:30); gates 4942 verdes na mesma rodada; 547 testes do mod rodando em paralelo com a suite dos gates. Integra…
- b858de5d-1f94-47d0-96d4-35029cafd8e2:162 · tecnica · painel-cli.test.mjs cli-sem-agentes-sem-nomes-nem-traco depende do relogio: regex /5h|7d/ casa o tempo decorrido da fixture de 09/11 09:00 (ex. '155h11' entre 20:00 e 20:59 de 15/11); falha no enabler sem a T14 (medido 20:1x). Correcao: rel…

## Aprendizados D

- b858de5d-1f94-47d0-96d4-35029cafd8e2:115 · E · Task que muda lista única (TIPOS_DE_TASK, TIPOS_DE_PROGRESSO) leva no escopo do plano todo teste e script que fixa a lista literal (git grep antes de abrir); senão o gate da integração cai fora da task · entra em: instantaneo, brief:implementador · sem medição · eventos: b858de5d-1f94-47d0-96d4-35029cafd8e2:105 · gatilho: b858de5d-1f94-47d0-96d4-35029cafd8e2:105
- b858de5d-1f94-47d0-96d4-35029cafd8e2:116 · E · Estado gravado por hook do mod (ex. sinal do loop) é chaveado pelo session_id do hook ou vai ao diário, nunca arquivo único por repo; teste com 2 sessões em que uma não vê o estado da outra · entra em: instantaneo, brief:implementador · sem medição · eventos: b858de5d-1f94-47d0-96d4-35029cafd8e2:113 · gatilho: b858de5d-1f94-47d0-96d4-35029cafd8e2:113
- b858de5d-1f94-47d0-96d4-35029cafd8e2:139 · E · Script que passa a rodar principal() só como entrypoint usa ehEntrypoint de lib/cli.mjs (symlink), e todo teste de função pura extraída de CLI tem 1 teste que roda o script com a flag real e confere o exit code (ligação CLI->função) · entra em: instantaneo, brief:implementador · sem medição · eventos: b858de5d-1f94-47d0-96d4-35029cafd8e2:138 · gatilho: b858de5d-1f94-47d0-96d4-35029cafd8e2:138

## Aprendizados M

- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:133 · E · Spike de critério de busca mede precisão (acha só os certos), não só recall; ID casado com fronteira exata · entra em: instantaneo, brief:implementador · sem medição · gatilho: 01db6bdc-dca6-4ee4-a54a-fabd77f23285:121
- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:134 · E · Redesenho de UI exige teste de paridade com a versão anterior (dados, barras, cores, layout) e decisão do dono para cada item retirado · entra em: instantaneo, spec, brief:revisor · sem medição · gatilho: dono:12
- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:172 · E · Orquestrador registra decisão do dono em docs de decisões; anotar --tipo pendencia só para tarefa real do dono (vira 'depende de você' no painel) · entra em: instantaneo · sem medição · gatilho: dono:15
- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:174 · E · Spike em sessão real guarda driver e registro bruto de cada sessão (N reprodutível) e nunca planta o sinal que quer medir · entra em: brief:implementador · sem medição · gatilho: 01db6bdc-dca6-4ee4-a54a-fabd77f23285:157
- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:175 · E · Spike de CI lê todas as tentativas de cada run (--attempt) e mede a sensibilidade do limite a regressão real, não só a folga · entra em: brief:implementador · sem medição · gatilho: 01db6bdc-dca6-4ee4-a54a-fabd77f23285:161
- 01db6bdc-dca6-4ee4-a54a-fabd77f23285:258 · E · Teste de paridade de UI cobre agrupamento e quebra de linha de cada bloco (item que não cabe não pode sumir), não só a presença do campo · entra em: brief:implementador, brief:revisor · sem medição · gatilho: 01db6bdc-dca6-4ee4-a54a-fabd77f23285:257
- b858de5d-1f94-47d0-96d4-35029cafd8e2:172 · A · Pedido de aprovação de várias emendas ao dono vem com aviso: cada comando digitado sozinho, com o turno parado; colado no meio do turno vira texto e não grava · entra em: instantaneo · sem medição · gatilho: dono:54

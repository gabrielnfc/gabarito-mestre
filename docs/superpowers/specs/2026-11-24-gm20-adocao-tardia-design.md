# GM-20: adoção tardia (o painel lê projeto que adotou o gabarito no meio do caminho)

Iniciativa: não vinculado · Epic: não vinculado (D-G39, regra da GM-19 em `2026-11-22-gm19-decisoes-dono.md:15`, herdada e aplicada à GM-20 pelo orquestrador: sem vínculo até o dono criar Epic; não é decisão nova do dono) _(Emenda 2026-11-24, conformidade r1)_ · PBI: GM-20 (Bug) · Versão: 2.3.0 (D-G45) · Data: 2026-11-24 · Base: `enabler/GM-20-adocao-tardia` 0a5fda2e (= `next`, plugin 2.2.2)
PBIs conhecidos, na ordem da D-G41: **GM-20** (esta entrega, emergência) · GM-17 (promoção de aprendizado, D-G25, volta depois).

**Tipo Bug, e não Enabler nem US.** O dono classificou como lacuna (D-G41 item 1): o produto promete um painel que lê o projeto, e num projeto adotado ele mostra números que se contradizem. É comportamento errado visível ao usuário, com reprodução e teste que falha hoje. Enabler é trabalho interno sem efeito para quem usa (GM-18, GM-19). US caberia ao passo de adoção sozinho, mas a D-G45 junta tudo numa entrega, e o motivo da entrega é o defeito. (c)

**STATUS: r1, rascunho do redator. Não conferida, não aprovada. Aguarda conformidade e `/gabarito-mestre:aprovar`.**
- **O que o sistema faz hoje:** o painel lê só `plano.json` e as 5 colunas do FL1; num projeto adotado, mistura denominadores, chama de "sem plano" o plano antigo, conta "Superado" como aberto, mantém agente fantasma, alerta "sem agente" para task feita pelo orquestrador, mostra 2 previsões e perde os separadores. A "próxima" aponta GM-12, já feita.
- **O que está escrito que fará:** tudo a partir de "Decisões". Nada foi executado.
- **Item 4 fechado pela D-G46 (2026-11-24):** o dono confirmou a D-G43 original. REQ-CRD-1 (painel trata e avisa, sem escrever no card) e REQ-CRD-2 (encerramento pela base configurada) são firmes; a T11 fica no fim do grafo por contenda de arquivo.
- A D-G41 só abre a entrega. Spec, `next ⇒ main` e release dependem do dono.

**Objetivo (dono, D-G41):** o painel lê um projeto que adotou o gabarito tarde sem número contraditório, com correção genérica e nada do projeto canário no plugin (open source).
**Desenho em uma frase:** o painel passa a reconhecer o que veio antes do gabarito (plano antigo, status terminal, entrega fechada fora do loop), larga o que não é mais dele (agente de outra entrega, task do orquestrador) e o `--atualizar` oferece ligar isso numa passada.
Fontes: `.claude-tmp/gm20/relato.md` (relato literal, não versionado); `2026-11-24-gm20-decisoes-dono.md` (D-G41 a D-G46); `.claude-tmp/gm20/spike-a.md` (itens 1, 2, 3, 4, 7, 8 e "próxima"); `.claude-tmp/gm20/spike-b.md` (itens 5, 6 e adoção); `docs/aprendizados/processo-orquestrador.md` (P9, P15, P16, "Fumaça de correção de painel", "Golden S6", "TMPDIR fora do repositório").

Legenda: **(a, medido)** número de execução nos spikes de 2026-11-24 · **(a, lido)** conferido no arquivo nesta redação · **(b)** dito por spike ou terceiro e não reconferido aqui · **(c)** escolha do redator, reversível · **(M, calculado)** conta sobre medição · **(M, a medir)** falta medir. Decisões e requisitos são (c), salvo marca. Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `.claude-tmp/`, `CHANGELOG.md` e `harness.config.json`.

## Fatos medidos (2026-11-24; spikes A e B, fixtures fora do repo, 62 arquivos `events.*.jsonl` iguais antes e depois)

| # | Medição | Resultado | Fonte |
|---|---|---|---|
| M1 | Fixture A, 9 PBIs (`$TMPDIR/gm20-spike-a/fixture`), painel de projeto real, 100 colunas | `4 de 9 PBIs feitos · 55% das tasks (6 de 11, +3 estimadas) · 2 restantes · 5 sem plano`; `pctComEstimadas` 82 | spike A, "Saída bruta" (a, medido) |
| M2 | Item 1 no próprio repo: `painel.mjs estado --entrega GM-19` | `feitos 6 de 7, pct 85, pctComEstimadas 100` | spike A (a, medido) |
| M3 | Render do % lê só `tt.pct`; `pctComEstimadas` é calculado e nenhum render o lê | `gates/src/painel-esquadrao.ts:393`; `gates/src/projeto.ts:342` | (a, lido) |
| M4 | Concluído sem plano já fica fora da conta; concluído com plano sem diário entra no denominador e só como `estimadas` no numerador | `projeto.ts:310`, `:313`, `:335` | (a, lido) |
| M5 | "N sem plano" mistura feitos e abertos: `foraDaConta` conta `semPlano` sem olhar `feito` | `projeto.ts:335`; na fixture, 5 = 2 feitos + 3 abertos | (a, lido; a, medido) |
| M6 | Plano antigo: só é lido o `.md` apontado por `Plano: \`x.md\`` no card; sem glob nem chave de config | `projeto.ts:110-113`, `:290`; `gates/scripts/painel.mjs:300-333` | (a, lido) |
| M7 | `## Task 1` sem separador não conta (decisão GM-16) e o PBI aparece "sem plano" | `projeto.ts:136`; spec GM-16 l.37-39; PBI-9 da fixture | (a, lido; a, medido) |
| M8 | Card `Superado — dividido em …` conta como aberto: `○ PBI-4 Superado sem plano`, `pbis 9` | `projeto.ts:191` (`COLUNAS_FL1_PADRAO`), `:218-225` (`ehFeito`), `:274` | (a, medido; a, lido) |
| M9 | Com `opcoesComoContagem: true` o "Superado" sai, mas com o rótulo "1 opção"; pôr "Superado" em `fluxo.status.FL1` vira coluna e conta aberto | spike A item 3 | (a, medido) |
| M10 | Entrega com `entrega.encerrada` e card velho já conta como feita; sem `entrega.encerrada` (só CI verde) fica aberta `100 % (2 de 2)` | `projeto.ts:276`, `:184-188`; PBI-7 e PBI-8 da fixture | (a, medido) |
| M11 | `painel medir` só encerra PR com base literal `main` | `gates/scripts/painel-medir.mjs:42`, `:346`, `:348`, `:356`, `:374` | (a, lido) |
| M12 | A base da entrega já tem regra única: `resolverBaseEntrega` | `gates/src/entrega.ts:95`; usada por `entrega.mjs:271` e pelo doctor | (a, lido) |
| M13 | Neste repo, `entrega.base` = `next` | `harness.config.json` | (a, lido) |
| M14 | Item 7: 2 linhas de previsão a partir de 72 colunas; abaixo de 72, 1 só | `painel-esquadrao.ts:425-426`, `:401` | (a, medido; a, lido) |
| M15 | Item 8: separadores somem por ALTURA, não por largura. Projeto de 9 PBIs, lateral, 25 linhas, ≥ 72 colunas: 0 separadores (sem projeto: 4) | `painel-esquadrao.ts:1180`, `:1185`; tabela do spike A | (a, medido) |
| M16 | "Próxima: GM-12 E4 — Painel" | `depende.ts:183-191` escolhe a spec mais nova com PBI fora de `encerradas`; `encerradas` só vem de diário existente (`painel.mjs:696`); GM-9 a GM-12 não têm diário | (a, medido; a, lido) |
| M17 | Item 5: fantasma reproduzido (`● Revisor agente fora do loop … 4h07 T1 revisor`); some com `encerrados:[id]` ou com o hand-back no diário da entrega exibida | spike B, variantes `repo-fantasma*` | (a, medido) |
| M18 | Causa do item 5: `idsEncerrados` procura `custo.medicao subagent:<id>` só no diário da entrega exibida | `gates/src/painel-equipe.ts:450`, `:528` | (a, lido) |
| M19 | Achado extra: o fantasma casa pelo token `T1` e põe `● T1 em curso` numa T1 da entrega atual que nunca foi iniciada | `painel-equipe.ts:57` (`casarVivo`); spike B `repo-fantasma` | (a, medido) |
| M20 | Silêncio dentro de 1112 transcripts de subagente deste repo: p50 1,2 min, p90 3,1, p99 29,9, máx 260; acima de 60 min: 4 (0,36 %) | spike B, só o campo `timestamp` | (a, medido) |
| M21 | `semSinalDeVida` usa 30 min e só com ação ao vivo medida pelo mod | `painel-equipe.ts:501`, `:507-519` | (a, lido) |
| M22 | Item 6: `iniciar T42 orquestrador` ⇒ `papel_invalido`, rc 1. `task.iniciada {papel:"orquestrador"}` faz o painel 2.2.2 avisar "estado inválido" | `gates/scripts/loop.mjs:104`, `:445`; `gates/src/formas.ts:51`; spike B | (a, medido; a, lido) |
| M23 | `task.iniciada` com campo extra (`executor`, `motivo`) passa na forma e no painel 2.2.2 sem aviso; o ATENÇÃO continua | `formas.ts:584-594`; spike B `repo-orq2` | (a, medido) |
| M24 | O ATENÇÃO "T42 sem agente trabalhando" nasce de `esperando` | `gates/src/painel.ts:1250-1251`; `painel-equipe.ts:566-571` | (a, lido) |
| M25 | `onboarding.mjs herdar` é STUB que lança `nao_implementado`; teste o fixa | `gates/scripts/onboarding-herdar.mjs:1-21`; `onboarding.mjs:23`, `:957`, `:963`; `gates/test/loop-cli-3.test.mjs:1518` | (a, lido) |
| M26 | A doc promete `herdar` como "regras da 1.x, na 2.2", e o backlog já registra isso como texto falso | `commands/gabarito.md:62`; `docs/virada-2.1.md:43`; `gates/test/skills-shell.test.mjs:436`; `docs/backlog.md:69` | (a, lido) |
| M27 | `--atualizar` não toca fluxo nem cards; a skill não tem passo de adoção | `skills/gabarito-instalar/SKILL.md` passos 1-8; `scripts/instalar.sh:41-55` (b) | (a, lido) |
| M28 | A regra "estimadas nunca somam às medidas" é a emenda 18 p.2 da GM-15, aprovada; comentário vivo no código | `.harness/entregas/GM-15/registro.md:32`; `projeto.ts:39` | (a, lido) |
| M29 | Versão 2.2.2 fixada fora de `.md` em 4 pontos | `.claude-plugin/plugin.json:4`; `gates/package.json:3`; `gates/test/package.test.mjs:49-50`; `scripts/test/texto.test.sh:279`, `:295` | (a, lido) |

Não medido (vai a Pendências): números reais do canário (103 PBIs, 310 tasks); por que faltam `entrega.encerrada` lá; se `$.agent.list()` mantém um agente `running` por 4 h; altura real da Pane do canário; custo de tempo da união dos diários.

## Decisões (não reabrir sem fato novo)

Do dono:
- **D-G41** Lacuna, correção genérica, teste + correção + CHANGELOG por item; a abertura não aprova spec nem release.
- **D-G42 (item 1)** PBI concluído sem `plano.json` sai do numerador e do denominador do % de tasks; a tela mostra o % já calculado com estimadas. Reabre a emenda 18 p.2 da GM-15 (M28) **só para o %**: a previsão segue sem somar estimadas.
- **D-G43 (item 4)** Entrega encerrada com card fora de "concluído" conta como feita e o painel mostra "card desatualizado"; o plugin não escreve no card (REQ-CRD-1). O encerramento automático usa a base configurada da entrega, não o literal `main` (REQ-CRD-2).
- **D-G46 (item 4, 2026-11-24)** Confirma a D-G43 original: o painel trata e avisa; o plugin nunca escreve no card. Fecha a pendência do item 4.
- **D-G44 (item 6)** `iniciar <task> implementador --executor orquestrador --motivo "…"`; tira o alerta, mostra "orquestrador" como dono, grava desvio visível no painel e na review; motivo obrigatório; 1 por vez; review e integração iguais.
- **D-G45** 2.3.0, uma entrega, uma virada.

Técnicas (c), cada uma com a alternativa rejeitada:
- **DT1 Concluído "sem `plano.json`" inclui o concluído com plano `.md` (antigo ou apontado).** A D-G42 fala de `plano.json`; o plano `.md` não tem diário de tasks e cairia no mesmo erro do relato (213 estimadas em 310). Rejeitado: manter o `.md` concluído no %, porque é exatamente o que gera o "8 %" (M1, M4).
- **DT2 "N sem plano" conta só abertos** (`semPlano && !feito`). Rejeitado: manter a soma com feitos, porque "5 sem plano" com 2 feitos dentro engana (M5).
- **DT3 Plano antigo por `fluxo.planosLegados`: lista de padrões com `{PBI}`, `*` só no nome do arquivo, pasta literal e relativa.** Ordem: `plano.json` > ponteiro `Plano:` do card > `planosLegados`. Mais de 1 arquivo casado para o mesmo PBI ⇒ ambíguo, não liga, e avisa. `{PBI}` casa o id seguido de não-dígito ou fim (PBI-1 não casa PBI-10). Rejeitado: `**` e glob livre, porque varre a árvore a cada render e abre caminho fora do repo. Rejeitado: chave no frontmatter do card, porque exige editar dezenas de cards (o ponteiro `Plano:` já existe para quem quiser).
- **DT4 Plano antigo sem task contável mostra "plano (formato anterior)" e fica fora da conta.** A regra de cabeçalho da GM-16 (l.37-39 (b): `## Task N` sem separador não conta) **não muda**. Rejeitado: contar `## Task N` nu ou `- [ ]`/`- [x]`, porque reabre a decisão da Sombra 5b5d97ca e os checkboxes dos planos deste repo são passos, não tasks (ex.: 5 por task no plano da GM-19). A emenda à GM-16 é só no (c): "com 0 tasks segue fora da conta, com rótulo 'plano (formato anterior)' em vez de 'sem plano'".
- **DT5 Terminais em `fluxo.status.terminais`; ausente ⇒ `["Superado", "Cancelado", "Descartado"]`; presente e lista de textos ⇒ substitui o padrão; inválida ⇒ padrão + aviso.** Casa o 1º termo do status (até ` — `, ` – `, ` - `, `:` ou `(`), sem acento, caixa nem espaço nas pontas. Terminal sai de linhas, `pbis`, `%`, `restantes` e previsão; o total mostra "N encerrados sem entrega". Terminal com medição (`plano.json` ou evento de task) segue linha e avisa, como a opção (GM-16 REQ-PRJ-2 c). Vale com `opcoesComoContagem` ligada ou desligada, e é testado antes dela. Rejeitado: pôr em `fluxo.status.FL1`, porque vira coluna (M9). Rejeitado: reaproveitar "opção", porque opção é trabalho futuro (M9). **Saída do terminal (c):** o PBI sai do terminal só quando o status do card muda para um texto fora da lista de terminais (quem muda é o time; o plugin não move card, D-G46); no render seguinte ele volta às contas pela regra comum (coluna FL1, `ehFeito`, opção). Evento do diário (`entrega.encerrada`, `entrega.reaberta`, task) não tira nem põe em terminal; só decide, como acima, se o terminal com medição segue linha. _(Emenda 2026-11-24, conformidade r1)_
- **DT6 Encerramento automático pela base da entrega** (`resolverBaseEntrega`, M12), nos 5 pontos de M11. Consequência (M, calculado): neste repo (base `next`, M13), a entrega passa a encerrar no merge do PR para `next`, não na virada para `main`. Rejeitado: aceitar `main` **ou** a base, porque a virada `next ⇒ main` de uma entrega já encerrada não precisa reencerrar, e duas regras somam caso de borda.
- **DT7 Agente sai da EQUIPE por hand-back em qualquer entrega lida.** A borda junta os ids de `custo.medicao subagent:<id>` de todas as entregas que `lerArvoreDoProjeto` já lê (`painel.mjs:300-333`), mais `_sem-id`, e passa ao núcleo junto do `encerrados` do mod. Volta se o transcript mudar depois do hand-back (retomada por `SendMessage`, S13). Rejeitado: gravar o encerramento no store do mod, porque um reload zera e a outra sessão não vê (M18).
- **DT8 Silêncio: 60 min pelo `mtime` do transcript, só quando o transcript é legível.** 60 > p99 de 29,9 min (M20). Sem transcript, a regra não vale e o agente fica como hoje: falha não vira sucesso. Os 30 min de `SEM_SINAL_MS` seguem para a ação ao vivo medida (M21). Rejeitado: usar `vistoEm` do mod como atividade, porque é a hora em que o agente foi visto, não a última ação (M, a medir; o spike B não separou). Rejeitado: 30 min no `mtime`, porque tira 10 de 1112 (0,9 %).
- **DT9 Agente casa com task do plano exibido só se a task saiu de `pendente` nesta entrega.** Fecha o achado extra (M19). Rejeitado: casar por token e só corrigir o glifo, porque o ATENÇÃO e o `cobertos` usam o mesmo casamento.
- **DT10 `--executor orquestrador` grava 1 evento só**: `task.iniciada {papel:"implementador", executor:"orquestrador", motivo}`. Painel e `registro.md` leem o campo. Rejeitado: papel novo, porque quebra leitor 2.2.2 instalado (M22). Rejeitado: evento extra de nota "desvio", porque são 2 gravações sem atomicidade e nota de orquestrador já virou item do dono por engano (processo, "ERRO orquestrador: … anotar --tipo pendencia").
- **DT11 Sem restrição por tipo de task.** `plano.json` não tem `tipo` por task (`gates/src/tipos.ts:140`, (b)); a D-G44 não pede. O limite é motivo obrigatório + 1 por vez + desvio visível. Rejeitado: campo `tipo` novo só para isto, porque muda o formato do plano por um caso.
- **DT12 "1 por vez" é por entrega**: com outra task da mesma entrega em voo com `executor: orquestrador`, `iniciar --executor` recusa com `executor_ocupado`. Rejeitado: por máquina, porque exige ler diário de todas as worktrees no CLI de escrita.
- **DT13 Uma linha de previsão:** `  previsão com plano <hora> · com estimativa do resto ~<hora> (~N tasks em M PBIs sem plano)`, com variantes mais curtas cortando o parêntese primeiro, depois a 2ª parte. Sem estimada: `  previsão <hora> (medida)` como hoje. Rejeitado: só a estimada com faixa, porque some o número medido.
- **DT14 Separadores reservados antes do corte**, com prioridade 6.93, acima dos totais do projeto (6.94) e das linhas de PBI (6.96). Abaixo de 44 colunas segue sem separador (`minima`). O caminho de 1 linha (`comProjetoAcima`, `painel-esquadrao.ts:474`) não muda. Rejeitado: separador em toda largura, porque o dono pediu "em qualquer largura" com hipótese de largura, refutada (M15).
- **DT15 "Próxima" descarta spec mais antiga que a spec mais nova de PBI encerrado.** Corte pelo `caminho` (data no nome), dentro de `proximaEntrega`. Rejeitado: tratar card `ehFeito` como encerrada, porque este repo não tem cards FL1 e o defeito é daqui (M16). Risco aceito: spec escrita antes e entregue depois some da "próxima"; o dono a acha pelo painel de projeto.
- **DT16 O passo de adoção ocupa o subcomando reservado `onboarding.mjs herdar`.** "Herdar" passa a ser herdar o que o projeto já tinha antes do gabarito. A herança das regras da 1.x (GM-14 REQ-ONB-3 a) nunca foi implementada e o próprio backlog marca a promessa como falsa (M26): fica no backlog com gatilho e, se voltar, entra como `herdar --regras`. Rejeitado: subcomando novo `adocao`, porque deixaria um stub que promete algo sem data. Para a Sombra confirmar antes do plano (Pendências P2).
- **DT17 `herdar` só lê; `herdar --gravar` grava só `fluxo.planosLegados` e `fluxo.status.terminais`, pelo mesmo escritor de config do `gravar`, com `--dry-run` e falha fechada.** Nenhum card é escrito por esta entrega (D-G43, D-G46): `cardsDesatualizados` só lista. Rejeitado: `herdar --gravar` propor e gravar `status` no card, porque a D-G46 proíbe escrita em card. Rejeitado: gravar pelo `gravar` com respostas do `detectar`, porque o `detectar` não pergunta isto e misturar muda o contrato dele.

ADRs: nenhuma. Não há exceção a regra.

## Requisitos

Regra transversal: **sem config nova obrigatória.** Sem `fluxo.planosLegados` e sem `fluxo.status.terminais`, todo repositório que hoje não tem card terminal, nem concluído com plano, desenha o mesmo painel. Projeto nascido no gabarito (todos os feitos com `plano.json` e diário) tem o mesmo `%`.

Fixture comum (criada na T1, só lida pelas outras): `gates/test/painel-fixtures/adotado.mjs`, os 9 PBIs da fixture A (M1): PBI-1 concluído sem plano; PBI-2 concluído com ponteiro `.md` de 3 tasks; PBI-3 concluído com plano antigo `docs/superpowers/plans/2026-11-02-PBI-3-legado.md` sem ponteiro; PBI-4 `Superado — dividido em PBI-5 e PBI-6`; PBI-5 em execução com `plano.json` 2 de 4; PBI-6 preparado sem plano; PBI-7 card velho (`Em execução`) + `entrega.encerrada`; PBI-8 card velho + `ci.resultado` verde sem encerrada; PBI-9 preparado com ponteiro para `.md` de `## Task 1` sem separador. Exporta os dados e `montarNoDisco(dir, { planosLegados?, terminais? })`. Mais 1 card `Cancelado` (PBI-10) para o padrão de terminais. Gravação do diário pelo `append` real de `dist/diario.js`, com TMPDIR em `$(getconf DARWIN_USER_TEMP_DIR)` (processo, "TMPDIR fora do repositório").

### Item 1: denominadores (D-G42, DT1, DT2)

**REQ-PCT-1 Concluído sem `plano.json` sai das duas pontas do %.** `projeto.ts:300-335`.
- Dado PBI-2 (concluído, plano `.md`, sem diário), Quando `projetarProjeto` roda, Então a linha diz `feito (3 tasks estimadas)` como hoje, mas `totais.tasks`, `integradas` e `estimadas` não somam as 3.
- Dado PBI-5 (`plano.json`, 2 de 4) e um PBI concluído com `plano.json` sem registro no diário, Então este último entra como `estimadas` (o caminho de hoje, `:310`).
- Teste `pct-concluido-sem-plano-json-fora-das-duas-pontas`. Mutação MP1-a: voltar a somar o `.md` concluído ⇒ `tasks` 11 em vez de 8 ⇒ cai.

**REQ-PCT-2 A tela mostra o % com estimadas.** `painel-esquadrao.ts:393`.
- Dado a fixture, Quando o render de 100 colunas roda, Então a linha 1 traz `pctComEstimadas`, e o texto `+N estimadas` segue quando N > 0. A previsão (`previsaoDoProjeto`, `projeto.ts:359`) não muda: estimadas seguem fora dela.
- Teste `render-pct-com-estimadas`. Mutação MP2-a: `nn(tt.pct)` de volta ⇒ cai. MP2-b: somar estimadas na previsão ⇒ cai `previsao-sem-estimadas` (existente ou novo, nomeado pelo implementador). **Teste de propriedade `render-projeto-propriedade-larguras`** (T1, `gates/test/painel-projeto.test.ts`): sobre a fixture, para toda largura de 44 a 120, nenhum número de texto novo é cortado (só some inteiro com o seu rótulo) e ausente nunca aparece como `0`; a T1 cobre `+N estimadas`, e a T2 (`N encerrados sem entrega`), a T4 (previsão em 1 linha) e a T11 (`(card desatualizado)`) acrescentam o seu texto ao mesmo teste, no mesmo arquivo. Mutação MP2-c: cortar `+N estimadas` por caractere em vez de inteiro ⇒ cai. _(Emenda 2026-11-24, conformidade r1)_
- Emenda: o comentário `projeto.ts:39` passa a dizer "nunca somam na previsão; no % exibido somam (D-G42)".

**REQ-PCT-3 "N sem plano" conta só abertos.** `projeto.ts:335`.
- Dado PBI-1 e PBI-3 (feitos, sem plano) e PBI-6 (aberto), Então `foraDaConta` = abertos sem plano, e a linha de feitos segue `✓ N feitos`.
- Teste `sem-plano-conta-so-abertos`. Mutação MP3-a: tirar `&& !feito` ⇒ cai.

### Item 2: plano no formato anterior (DT3, DT4)

**REQ-LEG-1 `fluxo.planosLegados` liga o plano antigo.** Borda `painel.mjs:300-333`; casamento puro exportado de `projeto.ts` (`planoLegadoDe(nomes, padrao, id)`), usado também pelo `herdar` (REQ-ADO-1).
- Dado PBI-3 sem ponteiro e `fluxo.planosLegados: ["docs/superpowers/plans/*-{PBI}-*.md"]`, Quando o painel lê o projeto, Então PBI-3 tem `plano: 'md'` e não aparece "sem plano".
- Dado a chave ausente, Então nada muda (PBI-3 `feito, sem plano`).
- Dado ponteiro `Plano:` no card e padrão que casa outro arquivo, Então vale o ponteiro. Dado `plano.json`, vale o json.
- Teste `plano-legado-por-padrao`. Mutações: ML1-a tirar o fallback ⇒ volta "sem plano"; ML1-b ordem invertida (padrão antes do ponteiro) ⇒ cai.

**REQ-LEG-2 Plano antigo sem task contável é "plano (formato anterior)".** `projeto.ts:290-295`, `:316-318`.
- Dado PBI-9 (`## Task 1` sem separador), Então a linha diz `plano (formato anterior)`, `semPlano` é falso, `tasks` é `null` e o PBI fica fora da conta do % e da previsão medida. Aberto, entra na estimada como hoje.
- Regra GM-16 l.37-39 (b) intacta: o teste `plano-md-nao-casa` existente segue verde sem mudança.
- Teste `plano-antigo-sem-task-rotulado`. Mutação ML2-a: marcar `semPlano` ⇒ cai. ML2-b: aceitar `## Task 1` sem separador ⇒ cai `plano-md-nao-casa`.

**REQ-LEG-3 O padrão é seguro.**
- Dado `..`, caminho absoluto, `**` ou `*` em pasta, Então o padrão é ignorado e o painel avisa `planosLegados: padrão inválido "<p>"`.
- Dado 2 arquivos casando o mesmo PBI, Então não liga e avisa `<PBI>: plano antigo ambíguo (2 arquivos)`.
- Dado `{PBI}` = PBI-1 e arquivo `…-PBI-10-…`, Então não casa.
- Teste `plano-legado-padrao-seguro`. Mutações: ML3-a aceitar `..` ⇒ cai; ML3-b ambíguo liga o 1º ⇒ cai; ML3-c `{PBI}` sem fronteira ⇒ cai.

### Item 3: status terminal (DT5)

**REQ-TER-1 Card terminal sai das contas e das linhas.** `projeto.ts:274-276`; render em `painel-esquadrao.ts:388-420`; borda passa `cfg.fluxo.status.terminais` em `painel.mjs:375-382`.
- Dado PBI-4 `Superado — dividido em PBI-5 e PBI-6` e PBI-10 `Cancelado`, sem config, Quando o painel roda, Então `pbis` não os conta, não há linha deles, e a linha 1 traz `· 2 encerrados sem entrega` quando cabe.
- Dado `opcoesComoContagem: true`, Então os 2 continuam terminais, nunca "opção".
- Dado terminal com `plano.json` ou evento de task, Então segue linha e avisa `<PBI>: status terminal com trabalho medido`.
- Teste `status-terminal-fora`. Mutações: MT1-a tirar o `continue` ⇒ `pbis` 10 e `○ PBI-4` ⇒ cai; MT1-b testar opção antes de terminal ⇒ "1 opção" ⇒ cai; MT1-c terminal vence a medição ⇒ cai.

**REQ-TER-2 Config e casamento.**
- Dado `fluxo.status.terminais: ["Arquivado"]`, Então só "Arquivado" é terminal (substitui o padrão) e "Superado" volta a ser aberto.
- Dado valor que não é lista de textos, Então vale o padrão e o painel avisa `fluxo.status.terminais inválido`.
- Casa o 1º termo: `Superado (ver PBI-5)`, `superado: x`, ` SUPERADO ` casam; `Superadoria` não.
- Teste `status-terminal-config`. Mutações: MT2-a mesclar com o padrão em vez de substituir ⇒ cai; MT2-b igualdade exata em vez de 1º termo ⇒ cai; MT2-c prefixo sem fronteira ⇒ `Superadoria` casa ⇒ cai.

### Item 4: card desatualizado

**REQ-CRD-1 Entrega encerrada com card aberto conta como feita e o painel avisa "card desatualizado"; nenhum card é escrito (D-G43, D-G46).** `projeto.ts:276` (a metade "conta como feita" já existe, M10); detector `encerrada(eventos) && card !== null && !ehFeito(card.status, statusFl1)` (`projeto.ts:184-188`, `:218`), exportado como `cardDesatualizado(card, eventos, statusFl1)` e reusado pelo `herdar` (REQ-ADO-1, `cardsDesatualizados`). _(Emenda 2026-11-24, D-G46 — pendência do item 4 respondida pelo dono; requisito firme)_
- Dado PBI-7 (card `Em execução` + `entrega.encerrada`), Quando `projetarProjeto` roda, Então a linha de PBI-7 tem `feito: true`, `cardDesatualizado: "Em execução"`, e `avisos` contém `PBI-7: card "Em execução" desatualizado (entrega encerrada)`.
- Dado PBI-7 com `entrega.reaberta` depois da `entrega.encerrada` (fixture local no teste), Então não é feito nem desatualizado (o último evento vence, `:184-188`).
- Dado PBI-8 (card velho + só `ci.resultado` verde, sem `entrega.encerrada`), Então não é feito e não há aviso (o encerramento é do REQ-CRD-2, não daqui).
- Dado card já em "Concluído" com `entrega.encerrada`, Então sem aviso. Dado sem card, Então sem aviso.
- Render (`painel-esquadrao.ts`, linha de PBI feito): quando cabe, `✓ PBI-7 … (card desatualizado)`; o sufixo é o 1º a ser cortado. (c)
- **Cláusula negativa:** nenhum caminho do plugin escreve no card. O teste lê os bytes e o `mtime` do arquivo do card de PBI-7 antes e depois de `painel.mjs estado` e `painel.mjs texto` sobre a fixture em disco, e afirma igualdade. O lado `herdar --gravar` tem 1 dono só: `herdar-nao-escreve-card` (REQ-ADO-2, T10), que segue verde na T11. _(Emenda 2026-11-24, conformidade r1)_
- Testes `card-desatualizado-conta-feito-e-avisa` (núcleo), `card-desatualizado-reaberta-nao-avisa`, `card-desatualizado-render`, `card-desatualizado-nunca-escreve-card` (CLI, só `painel.mjs`, em `gates/test/card-desatualizado.test.mjs`), `herdar-e-painel-mesma-contagem-desatualizados` (P9). Mutações: MC1-a tirar o aviso ⇒ cai; MC1-b avisar sem `entrega.encerrada` (só `!ehFeito`) ⇒ PBI-8 avisa ⇒ cai; MC1-c ignorar `entrega.reaberta` ⇒ cai; MC1-d escrever `status` no card (qualquer escrita no caminho do card) ⇒ em `painel.mjs` cai a cláusula negativa; no `herdar --gravar` cai `herdar-nao-escreve-card` (T10).

**REQ-CRD-2 O encerramento automático usa a base configurada da entrega.** `painel-medir.mjs:42`, `:346`, `:348`, `:356`, `:374`; base por `resolverBaseEntrega` (`entrega.ts:95`), a mesma do `entrega.mjs:271`.
- Dado `entrega.base: "next"` e PR da entrega mergeado em `next`, Quando `painel medir` roda, Então grava `entrega.encerrada` com o PR.
- Dado a mesma config e PR mergeado em `main` (virada), Então não encerra por ele.
- Dado config sem `entrega.base`, Então a base é `main`: o comportamento de hoje.
- Dado PR mergeado na base sem `mergedAt`, Então é descartado como hoje em `main` (`:42`).
- A exceção de virada de pré-versão (`ehViradaDePreVersao`, `:374`) segue igual.
- Teste `medir-encerra-pela-base-da-entrega` (gh falso, como os de `painel-medir.test.mjs`). Mutações: MC2-a literal `main` de volta em `:374` ⇒ cai; MC2-b aceitar qualquer base ⇒ cai o caso da virada; MC2-c base lida do checkout em vez de `resolverBaseEntrega` ⇒ cai o caso de base divergente.

### Item 5: agente fantasma (DT7, DT8, DT9)

**REQ-FAN-1 Hand-back em qualquer entrega tira o agente.** `painel-equipe.ts:450`, `:528`; borda `painel.mjs:300-333` (inclui `_sem-id`, hoje fora pelo filtro `:315`, só para estes ids).
- Dado o hand-back de `ghost01` no diário de GM-1 e o painel de GM-2 com o agente `running`, Então `ativos` não o tem e a EQUIPE não mostra "agente fora do loop".
- Dado o mesmo, com `mtime` do transcript posterior ao `ts` do hand-back, Então o agente volta (retomada).
- Testes `fantasma-handback-outra-entrega`, `fantasma-retomado-volta`, e CLI `painel.mjs texto --agentes --entrega GM-2` sobre a fixture `repo-fantasma2` do spike B, refeita dentro do teste. Mutações: MF1-a ler só a entrega exibida ⇒ cai; MF1-b ignorar o `mtime` ⇒ cai o da retomada.

**REQ-FAN-2 Sem atividade há mais de 60 min sai.** Borda: `mtime` por `lstat` do caminho já validado em `caminhoDoTranscript` (`painel.mjs:198-210`).
- Dado transcript com `mtime` há 61 min, sem hand-back, Então sai. Há 59 ou 60 min, fica. Sem transcript legível, fica (como hoje).
- `SEM_SINAL_MS` (30 min, `:501`) segue para a ação ao vivo.
- Teste `fantasma-silencio-60-min` (casos 59, 60 e 61 min; 60 exatos fica). Mutações: MF2-a `>=` no lugar de `>` ⇒ o de 60 min sai ⇒ cai; MF2-b N = 30 ⇒ o de 59 min sai ⇒ cai; MF2-c sem transcript conta como silêncio ⇒ cai.

**REQ-FAN-3 Casamento com task só fora de `pendente`.** `painel-equipe.ts:57-80`.
- Dado o fantasma `T1 revisor` e GM-2 com T1 `pendente`, Então o PLANO mostra `○ T1` (fila), não `● T1 em curso`.
- Dado T1 em `em_revisao` e agente `T1 revisor`, Então casa como hoje.
- Teste `vivo-nao-casa-task-pendente`. Mutação MF3-a: tirar a condição ⇒ cai.

### Item 6: task com o orquestrador (D-G44, DT10 a DT12)

**REQ-EXE-1 `iniciar <task> implementador --executor orquestrador --motivo "<t>"`.** `loop.mjs:104`, `:442-461`, `:2086-2100`; forma em `formas.ts:584-594`.
- Dado o comando com motivo, Então grava 1 `task.iniciada {papel:"implementador", executor:"orquestrador", motivo}`; worktree exigida como hoje (`loop.mjs:2088`).
- Dado sem `--motivo`, ou motivo vazio ou só espaço, Então `argumento_invalido`, rc 1, diário igual.
- Dado `--executor` com outro valor, ou com papel `revisor` ou `correcao`, Então `argumento_invalido`, rc 1, nada gravado.
- Dado outra task da mesma entrega em voo com `executor: orquestrador`, Então `executor_ocupado`, rc 1.
- A forma aceita `executor` só igual a `orquestrador` e exige `motivo` texto não vazio quando há `executor`.
- Testes em `gates/test/loop-cli-*.test.mjs` (arquivo escolhido pelo implementador, sem criar 6º): `iniciar-executor-orquestrador-grava`, `iniciar-executor-sem-motivo-recusa`, `iniciar-executor-revisor-recusa`, `iniciar-executor-um-por-vez`; `forma-task-iniciada-executor` em `formas.test.ts`. Mutações: ME1-a motivo opcional ⇒ cai; ME1-b aceitar com revisor ⇒ cai; ME1-c sem o "1 por vez" ⇒ cai; ME1-d forma aceita `executor` qualquer ⇒ cai.

**REQ-EXE-2 Painel: sem alerta, dono "orquestrador", desvio visível.** `painel-equipe.ts:522-572`; `painel.ts:1250-1251`.
- Dado T42 com o último `task.iniciada` com `executor: orquestrador`, Quando o painel roda com `--agentes` e lista vazia, Então o ATENÇÃO não tem `T42 sem agente trabalhando`, tem `T42 com o orquestrador: <motivo>`, e o PLANO mostra `orquestrador` como dono.
- Dado `reabrir` ou novo `iniciar` sem executor depois, Então vale o último: o alerta volta se não houver agente.
- Dado o diário lido pelo painel 2.2.2, Então sem "estado inválido" (já medido, M23).
- Teste `painel-task-com-orquestrador`. Mutação ME2-a: tirar a cobertura ⇒ o alerta volta ⇒ cai. ME2-b: esconder a linha de desvio ⇒ cai.

**REQ-EXE-3 O desvio entra na review.** `gates/src/registro.ts:118-125`.
- Dado a entrega com uma task `executor: orquestrador`, Quando o `registro.md` é gerado, Então lista `T42 executada pelo orquestrador: <motivo>` na seção de desvios.
- Teste `registro-lista-executor-orquestrador`. Mutação ME3-a: não listar ⇒ cai.

### Item 7: uma previsão (DT13)

**REQ-PRV-1 Uma linha de previsão a partir de 72 colunas.** `painel-esquadrao.ts:421-427`; regex e contagem em `gates/test/painel-projeto.test.ts:118-121`.
- Dado medida e estimada, Então 1 linha `  previsão com plano <h1> · com estimativa do resto ~<h2> (~N tasks em M PBIs sem plano)`, encurtada por variantes até caber, sem cortar hora.
- Dado só medida, Então `  previsão <h> (medida)`. Dado nenhuma, o texto de hoje com motivo.
- Abaixo de 72 colunas nada muda.
- Testes: `uma-linha-de-previsao` (0 linhas `^ {2}~\d+ tasks`), ajuste de `nLinhasProjeto` e `doProjeto`. Mutação MV1-a: 2 linhas de volta ⇒ cai. MV1-b: cortar a hora estimada antes do parêntese ⇒ cai.

### Item 8: separadores (DT14)

**REQ-SEP-1 Separadores reservados antes do corte.** `painel-esquadrao.ts:1175-1190`.
- Dado o projeto de 9 PBIs, 80 colunas, lateral, 25 linhas, Então ≥ 4 separadores (hoje 0, M15), e o painel não passa do orçamento.
- Dado < 44 colunas, Então 0 (como hoje). Dado orçamento menor que os separadores + topo, Então o topo vence (regra de prioridade de REQ-GLB-1 da GM-14).
- Teste `separadores-sobrevivem-ao-projeto` (lateral e acima). Mutação MS1-a: regra `livres > 0` de volta ⇒ 0 ⇒ cai. MS1-b: prioridade abaixo das linhas de PBI ⇒ cai.

### "Próxima" errada (DT15)

**REQ-PRX-1 A próxima ignora spec mais antiga que a última encerrada.** `depende.ts:183-191`.
- Dado specs [GM-9 sem diário, 2026-10-31; GM-13 encerrada, 2026-11-10], Então `proxima.tipo !== 'spec'`.
- Dado [GM-13 encerrada, 2026-11-10; GM-14 sem diário, 2026-11-11], Então a próxima é GM-14.
- Neste repo: `painel.mjs estado --entrega GM-19` deixa de dar `GM-12` (fumaça do orquestrador, não teste).
- Teste `proxima-ignora-spec-antiga` em `depende.test.ts`. Mutação MX1-a: tirar o corte ⇒ GM-9 ⇒ cai. MX1-b: corte com `>=` ⇒ cai o 2º caso.

### Passo de adoção (DT16, DT17)

**REQ-ADO-1 `onboarding.mjs herdar --root <d>` detecta, só lendo.** `gates/scripts/onboarding-herdar.mjs`; despacho `onboarding.mjs:957-967`.
- Dado a fixture em disco sem `.harness/entregas/<PBI>/plano.json` para PBI-1, 2, 3, Então devolve `{ok:true, oferecer:true, entreguesSemPlano:[…], planosLegados:{padrao, casados, sem, ambiguos}, statusFora:[{status, n}], cardsDesatualizados:[{id, status}]}`.
  - `entreguesSemPlano`: card `ehFeito` sem `plano.json` em nenhuma worktree.
  - `planosLegados.padrao`: o 1º de uma lista fixa de candidatos (`docs/superpowers/plans/*-{PBI}-*.md`, `docs/plans/*-{PBI}-*.md`) que casa ao menos 1 PBI, com `planoLegadoDe` (REQ-LEG-1).
  - `statusFora`: status fora de coluna FL1 e fora de terminal, com contagem.
  - `cardsDesatualizados`: na T10, predicado local `encerrada && !ehFeito`; a T11 troca pelo `cardDesatualizado` exportado (REQ-CRD-1), sem mudar a ordem do grafo. Só lista (nenhuma escrita em card). _(Emenda 2026-11-24, conformidade r1)_
- Dado projeto sem nada disso, Então `oferecer:false`.
- Dado config ilegível, Então `{ok:false, erro:'config_invalida'}`, rc 1.
- Nenhum arquivo muda (lista e `mtime` iguais antes e depois).
- Testes `herdar-detecta-adocao`, `herdar-sem-adocao-nao-oferece`, `herdar-so-le`. Mutações: MA1-a contar card concluído COM `plano.json` ⇒ cai; MA1-b escrever qualquer arquivo ⇒ cai; MA1-c status terminal em `statusFora` ⇒ cai.

**REQ-ADO-2 `herdar --gravar` grava só as 2 chaves.**
- Dado `--gravar --planos-legados "<p>" --terminais "A,B"`, Então só `fluxo.planosLegados` e `fluxo.status.terminais` mudam no `harness.config.json`, pelo escritor do `gravar` (`onboarding.mjs:902`), e a saída traz o `diff`.
- Dado `--dry-run`, Então mostra o diff e não grava. Dado padrão inválido (REQ-LEG-3), Então `argumento_invalido`, nada gravado.
- Nenhum card é escrito (D-G46).
- Testes `herdar-grava-so-2-chaves`, `herdar-dry-run-nao-grava`, `herdar-nao-escreve-card` (dono único do "herdar não escreve card": bytes, `mtime` e lista da pasta de cards iguais antes e depois de `herdar --gravar`; a cláusula negativa da T11 cobre só o `painel.mjs`). Mutações: MA2-a gravar outra chave ⇒ cai; MA2-b `--dry-run` grava ⇒ cai. _(Emenda 2026-11-24, conformidade r1)_

**REQ-ADO-3 Passo 6b na skill e docs coerentes.** `skills/gabarito-instalar/SKILL.md` (entre o passo 6 e as ofertas); `commands/gabarito.md:62`; `docs/virada-2.1.md:43`; `reference/fluxo.md` §4.3.
- Dado `--atualizar` ou cards achados, Então a skill roda `herdar`, mostra em 1 linha cada grupo e pergunta (`AskUserQuestion`, padrão "não") ligar os planos antigos e quais status são terminais. Headless: `--dry-run`, nada gravado.
- `commands/gabarito.md:62` e `virada-2.1.md:43` deixam de prometer "regras da 1.x" e descrevem a adoção. `reference/fluxo.md` §4.3 documenta as 2 chaves e os padrões.
- O teste `subcomandos-gm14-stub-nao-implementado` (`loop-cli-3.test.mjs:1518`) sai de `herdar` e fica com `foco` se ainda for stub (ler antes). `skills-shell.test.mjs:436` passa a fixar o texto novo.
- Teste `skill-instalar-passo-adocao` (fixa o comando e o padrão "não"). Mutação MA3-a: tirar o passo ⇒ cai.

### Versão

**REQ-VRS-1 2.3.0.** `.claude-plugin/plugin.json`, `gates/package.json`, `package.test.mjs:49-50`, `texto.test.sh:279`, `:295`; `CHANGELOG.md`.
- Dado a entrega, Então as 2 versões são `2.3.0`, `[2.3.0]` datada fica acima da `[2.2.2]`, e `git grep -n "2\.2\.2" -- ':!*.md' ':!.harness'` só acha o teste da ordem do CHANGELOG.
- Mutação MR1-a: versão só num manifesto ⇒ cai `package.test.mjs` e `texto.test.sh`.

Permissão: REQ-EXE-1 muda uma forma de evento e um comando existente; REQ-ADO-2 é um caminho de escrita novo, só em `harness.config.json`. A guarda não muda. Nenhum REQ escreve em card.

## Testes e gates

| REQ | Task | Prova | Mutações |
|---|---|---|---|
| REQ-PCT-1 a 3 | T1 | 3 testes + 1 de propriedade de render + fixture comum | MP1-a, MP2-a a c, MP3-a |
| REQ-TER-1, 2 | T2 | 2 testes | MT1-a a c, MT2-a a c |
| REQ-LEG-1 a 3 | T3 | 3 testes + `plano-md-nao-casa` intacto | ML1-a, b, ML2-a, b, ML3-a a c |
| REQ-PRV-1 | T4 | 1 teste + ajuste da regex | MV1-a, b |
| REQ-SEP-1 | T5 | 1 teste, lateral e acima | MS1-a, b |
| REQ-CRD-2 | T6 | 1 teste com gh falso | MC2-a a c |
| REQ-PRX-1 | T7 | 1 teste + fumaça neste repo | MX1-a, b |
| REQ-FAN-1 a 3 | T8 | 4 testes + CLI | MF1-a, b, MF2-a a c, MF3-a |
| REQ-EXE-1 a 3 | T9 | 7 testes | ME1-a a d, ME2-a, b, ME3-a |
| REQ-ADO-1 a 3 | T10 | 6 testes + 1 da skill + 1 de mesma contagem (P9) | MA1-a a c, MA2-a, b, MA3-a |
| REQ-VRS-1 | T12 | testes de versão | MR1-a |
| REQ-CRD-1 | T11 | 5 testes (núcleo, reaberta, render, cláusula negativa pelo CLI `painel.mjs`, mesma contagem `herdar` × painel) + `herdar-nao-escreve-card` da T10 verde | MC1-a a d |

P9 (camadas): REQ-LEG-1 e REQ-TER-1 cruzam borda (`painel.mjs`) e núcleo (`projeto.ts`): cada um tem 1 teste pelo CLI `painel.mjs` sobre a fixture em disco. REQ-ADO-1 reusa `planoLegadoDe` e o predicado de terminal: 1 teste prova que `herdar` e o painel dão a mesma contagem na mesma fixture.
Fumaça (processo, "Fumaça de correção de painel confere o cabeçalho inteiro"): antes do PR, o orquestrador roda o painel de projeto deste repo com o diário real inteiro e confere o cabeçalho inteiro (sem "próxima: GM-12", % coerente).

## CHANGELOG [2.3.0] previsto

```
## [2.3.0] — <data>

Projeto que adotou o gabarito com entregas antigas (GM-20, D-G41 a D-G46).

### Corrigido
- % das tasks: PBI concluído sem `plano.json` sai das duas pontas; a tela mostra o % com as estimadas. "N sem plano" conta só abertos.
- Plano antigo: `fluxo.planosLegados` liga planos `.md` por padrão com `{PBI}`; plano sem task contável aparece "plano (formato anterior)".
- Status terminal (`Superado`, `Cancelado`, `Descartado`, ou `fluxo.status.terminais`) sai das contas: "N encerrados sem entrega".
- Entrega encerra pela base configurada (`entrega.base`), não só por `main`.
- Entrega encerrada com card fora de "concluído": conta como feita e o painel avisa "card desatualizado".
- Agente com hand-back em outra entrega, ou sem atividade há mais de 60 min, sai da EQUIPE; agente de outra entrega não marca task pendente como em curso.
- Uma linha de previsão; separadores mantidos com o projeto na tela.
- A "próxima" não aponta spec mais antiga que a última entrega encerrada.

### Adicionado
- `loop.mjs iniciar <task> implementador --executor orquestrador --motivo "…"`: tira o alerta "sem agente", mostra o desvio no painel e no registro; 1 por vez.
- Passo de adoção no `gabarito-instalar --atualizar` (`onboarding.mjs herdar`): acha PBIs entregues sem `plano.json`, propõe o padrão de planos antigos e os status terminais. Só grava com "sim".

### Limites declarados
- O plugin não atualiza o status do card: "card desatualizado" é só aviso; quem move o card é o time.
- Teste rodado numa worktree ainda grava no diário do checkout principal (backlog, prioridade alta).
```

## Rollout

1. Confirmação da Sombra à DT16 (P2). Motivo: a DT16 muda o sentido de um subcomando documentado. (O item 4 já foi decidido pela D-G46.)
2. Aprovação da spec. Motivo: a D-G41 não aprova.
3. S6 na base antes do 1º `integrar` (processo, "Golden S6").
4. Ondas do plano: núcleo do projeto (T1 a T3) e, em paralelo, T6, T7; depois render (T4, T5), equipe (T8, T9), adoção (T10), item 4 (T11) e versão (T12) no fim. Motivo: contenda em `projeto.ts`, `painel-esquadrao.ts`, `painel.mjs`, `painel-equipe.ts`.
5. PR para `next` ao integrar o último código (P12). **Com DT6 neste repo (base `next`), o merge desse PR já encerra a GM-20.** Motivo: REQ-CRD-2.
6. `next ⇒ main`, tag e release 2.3.0 só por ordem do dono (R1). Plugin local por `claude plugin update --scope` depois.

Janela: quem usa o plugin vê o painel mudar só com cards concluídos com plano, cards terminais ou config nova. Volta: reverter o commit da task; as 2 chaves novas são opcionais e ignoradas pela 2.2.2.

## Fora de escopo (dono: Gabriel)

| Item | Motivo | Gatilho |
|---|---|---|
| Teste em worktree grava no diário principal | backlog, prioridade alta (CHANGELOG 2.2.2) | próxima entrega de testes ou novo diário sujo |
| `proxima` despachar sem `spec.aprovada` | outro defeito do loop | ordem do dono |
| GM-17 (promoção de aprendizado) | outra entrega (D-G25) | fim da GM-20 |
| Números reais do canário | o plugin não lê outro repo; correção genérica (D-G41) | dono rodar o painel 2.3.0 lá e trazer a tela |
| Contar `- [ ]`/`## Task N` nu em plano antigo | DT4 | dono pedir, com amostra dos planos antigos |
| Herança das regras da 1.x (`herdar --regras`) | DT16; nunca implementada | repositório 1.x pedindo adoção |
| `tipo` por task em `plano.json` | DT11 | 2º uso que precise de tipo |
| Separadores abaixo de 44 colunas | DT14 | dono pedir |

## Pendências

- Respondida: item 4 (antiga pendência do dono), fechada pela D-G46 em 2026-11-24 (painel trata e avisa; nenhum card é escrito). REQ-CRD-1 e a T11 firmes.
- **P2 (Sombra) DT16:** `herdar` vira o passo de adoção. Desbloqueia a T10.
- **(M, a medir)** Custo de tempo da união dos diários (REQ-FAN-1): T8 mede o `texto --agentes` antes e depois na fixture e neste repo; aumento acima de 20 % vai ao relato.
- **(M, a medir)** Se `vistoEm` é a 1ª vez visto ou a última ação (DT8): T8 lê `mod/painel.mjs` antes de codar; se for última ação, emenda.
- **(M, a medir)** Se `$.agent.list()` mantém `running` por horas: só no uso real; a correção não depende disso.
- **(M, a medir)** `foco` ainda é stub (`loop-cli-3.test.mjs:1518`): T10, passo 0.
- Emendas a outras specs, feitas nas tasks: GM-16 REQ-PRJ-1 (c) (T3, DT4); comentário da emenda 18 p.2 da GM-15 em `projeto.ts:39` (T1, D-G42).

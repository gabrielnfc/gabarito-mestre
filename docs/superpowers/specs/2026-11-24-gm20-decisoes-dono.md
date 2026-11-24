# GM-20 — decisões do dono

Numeração contínua com a GM-19 (`2026-11-22-gm19-decisoes-dono.md`, última D-G40).

- **D-G41 (2026-11-24, abertura):** o dono relatou "Temos uma emergência", com 8 itens de lacuna do painel em projeto que adotou o gabarito depois de já ter PBIs entregues por outro fluxo, mais o pedido de um passo de adoção no `gabarito-instalar --atualizar`. Relato literal em `.claude-tmp/gm20/relato.md` (não versionado). O dono definiu:
  1. classificação: **lacuna** (o gabarito não previu adoção tardia), não desvio;
  2. correção genérica, **sem nada específico do projeto canário** no plugin (open source);
  3. para cada item: teste que reproduz (fixture de projeto adotado), correção e nota no CHANGELOG;
  4. a abertura não aprova a spec (`/gabarito-mestre:aprovar`) nem `next ⇒ main` ou release.
- Ordem: a GM-20 passa na frente da GM-17 (promoção de aprendizado, D-G25) por ser emergência.

## Respostas do dono depois dos spikes A e B (2026-11-24, AskUserQuestion)

Insumo: `.claude-tmp/gm20/spike-a.md` e `.claude-tmp/gm20/spike-b.md`.

- **D-G42 (Q1, item 1):** "Excluir das 2 pontas (Recomendado)": PBI concluído sem `plano.json` sai do numerador e do denominador do % de tasks; a tela mostra o % já calculado com estimadas. Reabre a regra "estimadas nunca somam" da GM-15 só para o %.
- **D-G43 (Q2, item 4):** "Painel trata e avisa (Recomendado)": entrega encerrada com card aberto conta como feita e o painel mostra "card desatualizado"; o plugin não escreve no card. Inclui: o encerramento automático usa a base configurada da entrega, não o literal `main`.
- **D-G44 (Q3, item 6):** "--executor com limites (Recomendado)": `iniciar <task> implementador --executor orquestrador --motivo "…"`; tira o alerta, mostra "orquestrador" como dono, grava desvio sempre visível no painel e na review; motivo obrigatório; 1 por vez; review e integração iguais.
- **D-G45 (Q4, versão):** "2.3.0 numa entrega só (Recomendado)": itens 1 a 8, a "próxima" errada e o passo de adoção juntos, uma virada.

## Resposta do dono à P1 (2026-11-24, sessão 15480378, AskUserQuestion)

- **D-G46 (P1, item 4):** "(A) Painel trata e avisa (Recomendado)". Confirma a D-G43 original: entrega encerrada fora do loop com card aberto conta como feita e o painel mostra "card desatualizado"; o plugin nunca escreve no card. Fecha a P1 da spec; REQ-CRD-1 e a T11 saem do estado pendente.

## Resposta do dono sobre o lembrete `next ⇒ main` (2026-11-24, sessão 15480378, AskUserQuestion)

Insumo: review T6 r1 MAJOR-2 e decisão da Sombra (hash 56c73eb3, fora_da_regra): com o REQ-CRD-2 a entrega encerra no merge para a base configurada e o item do dono "no fim da entrega: levar <base> para main" (`depende.ts:373-375`) sumiria antes da virada.

- **D-G47:** "PR da virada mergeado em main (Recomendado)". O item fica no lote do dono depois do `entrega.encerrada` pela base configurada e só sai quando o `painel medir` vê um PR com base `main` mergeado que contém o commit de encerramento da entrega.

## Resposta do dono sobre o texto da estimada (2026-11-24, sessão 15480378, AskUserQuestion)

Insumo: review T3 r1 MAJOR-1 e decisão da Sombra (hash 4e10ca8c): o PBI aberto em formato anterior sai do total "N sem plano" (DT2, REQ-LEG-2), mas entra na estimada, cujo texto (DT13) diz "em M PBIs sem plano"; a tela mostra "1 sem plano" e "2 PBIs sem plano".

- **D-G48:** "Trocar texto para 'sem medida' (Recomendado)". O parêntese da estimada passa a dizer `(~N tasks em M PBIs sem medida)`, contando sem plano e formato anterior; o total "N sem plano" não muda. Emenda à DT13, só texto.

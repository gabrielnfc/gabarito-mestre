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

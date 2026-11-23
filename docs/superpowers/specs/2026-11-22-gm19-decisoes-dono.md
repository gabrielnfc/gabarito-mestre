# GM-19 — decisões do dono

Numeração contínua com a GM-18 (`2026-11-21-gm18-decisoes-dono.md`, última D-G34).

- **D-G35 (2026-11-22, abertura):** literal do dono, "pode abrir, está autorizado", em resposta a: abrir a GM-19 (velocidade dos testes) agora, com os 2 defeitos do painel achados no uso da GM-18 só no backlog, começando por medir os tempos atuais e trazendo a spec para aprovação.
  1. objetivo, literal de 2026-11-16: "otimizar seria o melhor caminho para ganharmos tempo e qualidade de forma segura, sem over engineer e excesso de testes de forma redundante";
  2. os 2 defeitos do painel ficam fora do escopo, no backlog;
  3. a autorização é de abertura: não aprova a spec (`/gabarito-mestre:aprovar`) nem `next ⇒ main` ou release.

## Respostas do dono depois da conformidade r2 (2026-11-23, AskUserQuestion; spec r2 sha256 d63b815d…)

- **D-G36 (Q1, meta):** "Só loop-cli (Recomendado)": dividir só `loop-cli`, mediana local ≤ 300 s, CI sem piora. Fumaça e conversa-pontos ficam no backlog.
- **D-G37 (Q2, ruleset):** "Exigir mod e dist (Recomendado)": exigir `mod` e `dist em dia` na `main` (8 ⇒ 10 de 11); `versao-medida` segue aviso. É ato do dono no ruleset, fora das tasks.
- **D-G38 (Q3, versão):** "Junto da próxima release (Recomendado)": sem versão nem virada própria; fica em `next` e vai à `main` com a próxima release.
- **D-G39 (Q4, vínculo):** "Sem vínculo (Recomendado)": Iniciativa e Epic não vinculados, como na D-G33.
- DS9, DS10 e DS11 aprovadas pela Sombra (`decisao.sombra`, hash 8fe49b6d…, 2026-11-23).
- **D-G37 executada (2026-11-23, autorização literal do dono "pode ajustar o ruleset"):** ruleset 23998269 da `main` passou de 8 para 10 checks exigidos (`mod — claude plugin test (só o teste do mod conta)` e `dist em dia (gates/dist == build de gates/src, Node 22)`), conferidos verdes em a43ea2e3 antes da troca; demais regras iguais. Cópia de antes e depois em `.claude-tmp/gm19/ruleset-23998269-{antes,depois}.json`.
- **Quarentena autorizada (2026-11-23, AskUserQuestion "Pode mover"):** 5 arquivos de fixture gravados por teste no diário real da GM-19 movidos para `.claude-tmp/gm19/quarentena/GM-19` (sha256 em `sha256.txt`); o defeito foi ao backlog como prioridade alta ("Backlog prioritário").
- **D-G40 (2026-11-23, virada):** literal do dono, "Está autorizado levar pra main seguindo todos os ritos", depois do merge em `next` (PR #31, a4fc50d7). Revoga a D-G38: a GM-19 vira a 2.2.2 (patch: só testes e CI, sem mudança de comportamento), com PR `next ⇒ main`, CI verde, tag `gabarito-mestre--v2.2.2`, release, sincronização de `next` e plugin local.

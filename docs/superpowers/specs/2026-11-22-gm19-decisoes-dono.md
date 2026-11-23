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

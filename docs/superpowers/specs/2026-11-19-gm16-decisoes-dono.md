# GM-16 — decisões do dono

Numeração contínua com a GM-15 (`2026-11-15-gm15-decisoes-dono.md`, última D-G21). Linguagem genérica: o repositório que motivou a entrega é "um repositório consumidor de referência"; nenhum nome, caminho ou dado dele entra aqui.

- **D-G22 (2026-11-19, painel de projeto num repositório grande):** fato trazido ao dono (medido num repositório consumidor de referência com 91 cards FL1 e 40 planos `.md`): a visão de PROJETO do painel desenha 93 linhas; corrigido o uso do fluxo no repositório, cai para 53; recolhendo os PBIs feitos, para 5. O painel lê 0 tasks dos 40 planos, porque eles usam o cabeçalho `## Task N — título` e o leitor do plano `.md` só aceita `### Task N:` (`gates/src/projeto.ts:127-131`). Decisão do dono, nesta ordem de prioridade, todos os itens sem quebrar quem já usa (padrão seguro, SemVer conforme o caso, CHANGELOG):
  1. o leitor do plano `.md` aceita também `## Task N —`, `## Task N:` e `### Task N —` (e o que mais for razoável sem falso positivo), com teste dos formatos;
  2. a visão de projeto recolhe os PBIs feitos numa linha ("✓ N feitos") e agrupa o resto por Epic quando o card tem Epic (`fluxo.vinculoPbiEpic`);
  3. card FL1 cujo status não é coluna do quadro FL1 (`reference/fluxo.md §4.3`, `fluxo.status.FL1`) não vira linha: entra como contagem "N opções", fora do WIP e do %;
  4. o doctor ganha avisos (não contam no nível) para status FL1 inválido e para PBI mergeado na branch padrão (título de commit com o ID) cujo card não está "Concluído";
  5. caminho formal para PROMOVER aprendizado comprovado (status D) do `.harness/aprendizados.jsonl` de um repositório para regra do plugin (`reference/`, prompts de papel), com revisão. O dono pediu a recomendação do orquestrador sobre fazer como fase 2 desta entrega ou numa GM seguinte. **Recomendação registrada na spec (`2026-11-19-gm16-painel-projeto-design.md`, "Fora de escopo"): GM seguinte (GM-17); aguarda o ok do dono.**

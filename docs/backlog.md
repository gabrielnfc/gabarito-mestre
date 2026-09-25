# Backlog — gabarito-mestre

Item sai daqui quando entra num plano ou a decisão de descarte é registrada. Item entregue ou revogado é riscado no mesmo merge (`referencia.md §2.4`). Um formato só.

| Item | Origem | Gatilho |
|---|---|---|
| Escrita na ferramenta de planejamento como default (hoje só com `fluxo.escrita: true`, ADR-FLX-2) | spec 2026-09-24 Workflow TRUE, "Fora de escopo" — dono: Gabriel | 3 repos do time com escrita autorizada e sem incidente |
| Adaptador de escrita por ferramenta (criar card a partir do plano) | idem — dono: Gabriel | primeiro PBI que precisar abrir card a partir do plano |
| Métricas de fluxo (lead time, throughput, envelhecimento agregado) calculadas pelo harness | idem — dono: Gabriel | fase 2 do Workflow TRUE |
| Bloqueio de prompt inline via `UserPromptSubmit` exit 2 (hoje só lembrete, ORQ-4) | idem — dono: Gabriel | R21 violada 3× no piloto |
| Isolamento remoto como default de dispatch | idem — dono: Gabriel | máquina do piloto em `slots: 1` em mais de 50% das sessões |
| Abordagem B — harness reescrito por altitude (2.0.0) | idem (D6) — dono: Gabriel | 3 achados de conformidade por confusão de conceito |
| Enumeração automática de modelos (substituir a resposta (b) do usuário em ONB-5) | idem (D5, M9) — dono: Gabriel | Claude Code expor API/CLI de listagem |
| `cartao-sessao.mjs` ler o campo de vínculo PBI→Epic de `fluxo.vinculoPbiEpic.nome` em vez de `epic` fixo (limite declarado no README) | ledger GM-5, MINOR-2; F6-R3 — dono: Gabriel | primeiro repo em `ferramenta: arquivos` que queira outro nome de campo |
| `--vincular` grava linha `VINCULO` repetida no ledger (sem dedupe); a criação do `CODEOWNERS` pelo onboarding (`writeFileSync` com `flag: "wx"`) sai com stack trace em vez de mensagem quando o arquivo passou a existir (`EEXIST`) | ledger GM-5, MINOR-8 — dono: Gabriel | primeira vez que um dos dois aparecer num repo do time |
| "Refazer onboarding" com Apêndice já preenchido tem comportamento indefinido (risco R2); `CODEOWNERS` gerado pelo onboarding sai sem o marcador e nunca é atualizado | ledger GM-5, MINOR-9 — dono: Gabriel | primeiro pedido de "refazer onboarding" num repo com Apêndice preenchido |
| `Bash(bash:*)` no `allowed-tools` de `gabarito-instalar` é largo — restringir ao caminho de `instalar.sh` | ledger GM-5, MINOR-10 — dono: Gabriel | próxima mudança do `allowed-tools` da skill ou primeiro achado de review sobre ele |
| `claude mcp list` faz health-check nos servidores antes do ok do usuário; prefixo de branch para PR de `release`/`revert` não definido | ledger GM-5, suspeitas — dono: Gabriel | health-check com efeito observável num servidor, ou primeira PR de release/revert |
| Bypass do guard de versionamento: `git commit -amFoo` / `-am"msg"` (flag colado) e `git commit -m -F arq` (limites declarados no README) | ledger GM-3, F3-R7 — dono: Gabriel | próxima fase que tocar `guard-versioning.sh`, ou um dos dois visto em transcript real |
| Raiz por cwd puro em `migrations-guard`, `deploy-order-check`, `quality-ratchet` (1.0.1); `ledger-versionado` do doctor aceita ledger não versionado (falso positivo medido) — limites declarados no README | Emenda do plano-mestre "Fase 2 → fase 6"; F6-R3 — dono: Gabriel | primeiro repo monorepo que rode um dos 3 gates fora da raiz, ou primeiro falso positivo de `ledger-versionado` reportado |
| Conformidade lê o card direto da ferramenta por MCP (hoje o card é colado à mão) | plano da fase 5 — dono: Gabriel | 3 pedidos de conferência de card colado à mão |
| `ferramentas-mcp.json`: as seis ferramentas além do ClickUp (Jira, Linear, Notion, Trello, Asana, Monday) seguem (b) — padrão de tools não medido | plano da fase 6 — dono: Gabriel | primeiro repo do time com Jira/Linear/Notion/Trello/Asana/Monday |

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

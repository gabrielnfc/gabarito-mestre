# Ledger — PBI: GM-8 · Epic: GAB-2.0-A "Sombra" (b — vincular no ClickUp)   Plano: (não escrito)   Branch: enabler/GM-8-fundacao-2.0   Spec (autoridade): docs/superpowers/specs/2026-10-18-fundacao-2.0-design.md
Rulings herdados: R1, R2, R3 (1.1.0) · GM-7 R13 (arquivamento; o que a 2.0 reaproveita)          Contexto externo: nenhum tocado; referências lidas só em scratchpad (ver memória `referencias-mods-2-0`)

## LER PRIMEIRO — 2026-10-19
A1 Fundação = GM-8. Spec r0 escrita em 2026-10-18; **r1 em 2026-10-19** após conformidade (11 faltas) + review Fable rodada 1 (REPROVADO: 4 BLOCKER, 23 MAJOR, 19 MINOR — todos aplicados; ver R7–R9). **Próximo:** Fable rodada 2 (agente frio) + conformidade r1 → 0 achado → dono lê → reader testing → `writing-plans`.
Regras do dono: fatos, não hipóteses (toda premissa é T0); 0 achado; review no modelo mais potente (Fable; fallback Opus registrado); PT-BR; nome do método = **Fluxo Gabarito**.

## Estado

| Item | Estado | Onde |
|---|---|---|
| Spec | **r1** — 47 REQ, 18 T0; conformidade r0 NÃO CONFORME (11) e Fable r0 REPROVADO (46) aplicados; rodada 2 em andamento | `docs/superpowers/specs/2026-10-18-fundacao-2.0-design.md` |
| Plano | não escrito | — |
| Implementação | não iniciada | — |
| T0 | nenhuma rodou | spec §Testes e gates |

## Rulings

- R1 (2026-10-18): fatiamento — A1 Fundação (GM-8) antes do loop (GM-9); motivo: toda T0 do loop lê do diário. Dono aprovou.
- R2 (2026-10-18): compatibilidade — mod assume a guarda; `guard-production.sh` fica sempre; `guard-destructive.sh`/`guard-versioning.sh` desligam com o mod ativo e morrem em PBI próprio se o corpus comparativo (T0-9) confirmar. Dono aprovou (opção 2).
- R3 (2026-10-18): pouso primário por `/clear` + `$.prompt.submit` — o validador do build 2.1.301 avisa que o hook `session.compact` não roda em plugin de usuário sob org gerenciada (M3).
- R4 (2026-10-18): hatch de produção/destrutivo sai do texto do comando; só `/gabarito autorizar` humano (M7: hatch atual é autodeclarável pelo modelo).
- R5 (2026-10-18): piso de qualidade tighten-only independe da spec (dev júnior no trilho); dono pediu explicitamente.
- R6 (2026-10-18): regra do dono para o diário — feature só entra na A1 se um requisito da A1 a usa (contra over-engineering); aplicada no self-review: checkpoint ficou (REQ-DIA-8 ↔ T0-11), assinatura GPG saiu (C).
- R7 (2026-10-19): fatos da API que mudaram a arquitetura na r1, todos conferidos no `.d.ts` (M15–M19): módulo sem Node ⇒ núcleo do diário puro + I/O no CLI via `$.process.run` (ADR-ARQ-2); hook falho = fail-open sem `.catch` ⇒ REQ-GRD-12; `$.turn.abort` só turno principal e sem `$.agent.kill` ⇒ D7 reescrita (abort + deny spawn; subagente em background = T0-4); `$.command.run`/`$.session.compact` rejeitam com turno rodando ⇒ pouso disparado por `$.clock.after(0)` (ADR-POU-1). Custo-se-errado: mod que não carrega ou guarda que abre em silêncio.
- R8 (2026-10-19): anel de integridade (D13/ADR-GRD-3/REQ-GRD-13) — o modelo nunca escreve em `.harness/**`, config, workflows, pasta do plugin, nem invoca `diario.mjs`. Motivo: sem ele o modelo forja `spec.aprovada`, despausa por `rm .harness/PAUSAR` e desliga os hooks Bash (B1 da rodada 1).
- R9 (2026-10-19): `guard-versioning.sh` nunca desliga (D4 corrigida — B3); `guard-destructive.sh` só desliga com marcador renovado (≤ 60 s) nascido após `guarda.pronta` (B4/M13). `fluxo.aprovarPlano` e `custo` saem da A1 (M18, R6). Decisões D4/D5/D7/D8/D11 ajustadas por **fato da API ou brecha provada**, não por reabertura — o dono confirma na leitura da r1.

## Referências que a implementação deve ler (licenças conferidas em 2026-10-18)
- Diário: `affaan-m/ECC` `scripts/lib/eval-harness/{canonical,envelope,capsule,receipt}.js` + testes (MIT) — clonar e adaptar.
- Classificador destrutivo: `affaan-m/ECC` `scripts/hooks/gateguard-fact-force.js:888-1390`, `scripts/lib/gateguard-heredoc.js` (MIT) — trechos.
- Pouso: `cablate/ctx-handoff-mod` (MIT) — padrão `/clear` + `$.prompt.submit`.
- Status/pane (B): `scasella/claude-flightdeck` `hooks/core.ts` (MIT), `Charlie0113-T/claude-agent-flow` (Apache-2.0).
- Oficiais: `anthropics/claude-code-playground/claude-code/mods/blast-radius` (Apache-2.0) — deny com botões; `anthropics/claude-code/mods/sec-default` — só leitura.
- Validação de skills: `anthropics/skills/skill-creator/scripts/quick_validate.py` (Apache-2.0).

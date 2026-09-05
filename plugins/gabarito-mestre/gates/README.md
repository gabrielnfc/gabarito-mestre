# harness-gates

Gates executáveis do harness de engenharia. **Zero dependências** — só builtins do Node ≥ 22.18 (ver "Requisitos" no fim).

Regra que virou gate para de ser prosa: cada arquivo aqui existe para que a regra
correspondente do `AGENTS.md` não precise ser lida por ninguém.

| Arquivo | Gate | Regra |
|---|---|---|
| `src/mass-mutation-guard.ts` | G3 — mutação em massa | R2 |
| `eslint/no-unfiltered-mass-mutation.js` | G3 — barreira estática | R2 |
| `src/production-host-guard.ts` | R3 trava de produção · G7 trava de boot | R3, R16 |
| `scripts/migrations-guard.mjs` | G8 — migrations | R2 |
| `scripts/deploy-order-check.mjs` | ordem de subida | §10 |
| `scripts/quality-ratchet.mjs` | ratchet de qualidade | R4 |
| `scripts/harness-doctor.mjs` | §0.2 — nível de adoção | §0.2 |

## Testes

```bash
npm test          # 76 testes
```

Cada suíte declara no cabeçalho as **mutações prescritas**. Toda uma delas tem que
derrubar a suíte — a que não derrubar é um achado, não um alívio.

## Instalação

`docs/harness/gates.md`.

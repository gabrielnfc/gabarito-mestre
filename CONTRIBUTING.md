# Contribuindo com o Gabarito Mestre

Obrigado por querer conferir o molde. Este repositório segue o próprio harness que distribui — leia
`plugins/gabarito-mestre/reference/AGENTS.md` antes de abrir PR. O que está abaixo é o resumo operacional.

## O que aceitamos

- **Falso positivo ou falso negativo nos hooks** — o achado mais valioso. Abra a issue "Hook: falso positivo /
  negativo" com o comando exato (anonimize caminhos e credenciais). Um comando legítimo bloqueado é bug de
  prioridade máxima: faz gente desligar o plugin inteiro.
- **Gate novo ou regra nova** — só com incidente ou medição que a justifique, e com teste que reproduza o incidente.
  Regra sem gate nasce marcada **(b)** (ver `AGENTS.md §0.1`).
- **Docs** — correção de fato, não de estilo. Todo número novo vem com data e comando que o mediu.

## Antes de abrir a PR

```bash
claude plugin validate ./plugins/gabarito-mestre --strict      # Validation passed
claude plugin validate . --strict                               # marketplace
cd plugins/gabarito-mestre/gates && npm test                     # 268 testes (medido em 2026-09-25)
node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs  # corpora dos hooks
```

Requisitos: Node ≥ 22.18, bash (os hooks são testados em bash 3.2 do macOS — não use bashismo ≥ 4), `jq` opcional.

## Regras de PR (o próprio harness, aplicado aqui)

1. **Toda afirmação no corpo da PR carrega (a) medido / (b) presumido** (R18). "Deve funcionar" não é resultado.
2. **Mudança em hook vem com caso novo no corpus** (`hooks/test/corpus/*.txt`) — o comando que motivou a mudança.
3. **Mudança em gate vem com teste** e, se for regra nova, com a mutação prescrita no cabeçalho da suíte.
4. **Nada é apagado da história**: regra morta é riscada mantendo o número (R16). Numeração é append-only.
5. **`version` sobe em `plugin.json` E em `marketplace.json`** — o `claude plugin tag` recusa se divergirem.
   Usuários só recebem atualização quando `version` muda.
6. Commits em português, imperativo, escopo curto. PR pequena: uma entrega por PR (`referencia.md §3.4`).

## Release

Feito pelo mantenedor: `CHANGELOG.md` atualizado → bump de `version` → commit → `claude plugin tag --push`
(cria `gabarito-mestre--v<versão>`) → release no GitHub com as notas do changelog.

## Conduta

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Segurança: [`SECURITY.md`](SECURITY.md).

## O que muda

<!-- uma entrega por PR. Se toca hook ou gate, diga qual regra (R2/R3/G8…) -->

## Como foi medido

<!-- comandos rodados e saída colada. Marque cada afirmação: (a) executado · (b) presumido -->

```
claude plugin validate ./plugins/gabarito-mestre --strict → 
cd plugins/gabarito-mestre/gates && npm test → 
node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs → 
```

## Checklist

- [ ] Mudança em hook veio com o comando motivador em `hooks/test/corpus/*.txt`
- [ ] Mudança em gate veio com teste (e mutação prescrita, se regra nova)
- [ ] `version` subiu em `plugin.json` **e** `marketplace.json` (se for release) e `CHANGELOG.md` foi atualizado
- [ ] Nada apagado da história: regra morta riscada, numeração append-only (R16)
- [ ] Nenhum número no README/docs sem data e comando que o mediu

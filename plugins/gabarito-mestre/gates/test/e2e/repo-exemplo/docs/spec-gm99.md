# GM-99: três funções pequenas (repositório descartável de aceite)

Módulos ES (`export function`). Cada task entrega o módulo e o teste do módulo (`node:test`, `node:assert/strict`),
em TDD: teste primeiro, visto falhar, depois a implementação.

Domínio: inteiros de -20 a 20. Fora dele o comportamento não é requisito; mutante que só muda fora do domínio, ou que é igual em todo o domínio, não é achado.

- REQ-A (task T1): `src/a.mjs` exporta `soma(a, b)` e devolve a + b. O teste percorre todos os pares do domínio. Teste em `test/a.test.mjs`.
- REQ-B (task T2): `src/b.mjs` exporta `dobro(n)` e devolve n + n. O teste percorre todo o domínio. Teste em `test/b.test.mjs`.
- REQ-C (task T3, depende de T1): `src/c.mjs` exporta `triplo(n)`, que devolve n + n + n, e reexporta `soma` de `./a.mjs`. O teste percorre todo o domínio e confere `c.soma === a.soma`. Teste em `test/c.test.mjs`.

Não há CI nem repositório remoto: o passo de CI não se aplica.

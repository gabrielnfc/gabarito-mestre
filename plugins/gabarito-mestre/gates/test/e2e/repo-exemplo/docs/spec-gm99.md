# GM-99: três funções pequenas (repositório descartável de aceite)

Módulos ES (`export function`). Cada task entrega o módulo e o teste do módulo (`node:test`, `node:assert/strict`),
em TDD: teste primeiro, visto falhar, depois a implementação.

- REQ-A (task T1): `src/a.mjs` exporta `soma(a, b)` e devolve a + b. Teste em `test/a.test.mjs`.
- REQ-B (task T2): `src/b.mjs` exporta `dobro(n)` e devolve n * 2. Teste em `test/b.test.mjs`.
- REQ-C (task T3, depende de T1): `src/c.mjs` exporta `triplo(n)`, que devolve n * 3, e reexporta `soma` de `./a.mjs`. Teste em `test/c.test.mjs`: confere `triplo` e que `c.soma === a.soma`.

Não há CI nem repositório remoto: o passo de CI não se aplica.

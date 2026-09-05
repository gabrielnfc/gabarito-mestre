# Gates executáveis

> **Regra que virou gate para de ser prosa.** Cada gate aqui existe para que a regra
> correspondente não precise ser lida por ninguém — a máquina lembra.
> Esta é a I12 aplicada ao próprio harness.

Código em `tools/gabarito-gates/`. **Zero dependências** — só builtins do Node ≥ 22.18 (ver "Requisitos" no fim).
Rode `npm test` lá: 76 testes, incluindo os que reproduzem os incidentes originais.

| Gate | Regra | Forma | O que ele torna impossível |
|---|---|---|---|
| **G3** mutação em massa | R2 | extension de ORM + regra de lint | apagar tabela por filtro que virou `{}` |
| **R3** trava de produção | R3 | guard nos entrypoints de teste | suíte apontando para produção de terceiro |
| **G7** trava de boot | R16 | guard no boot dos dois processos | subir com o marcador de outro ambiente |
| **G8** guarda de migrations | R2 | script de CI | migration destrutiva entrar sem plano de volta |
| **ordem de subida** | §10 | teste sobre o pipeline | subir produtor antes do consumidor |
| **ratchet** | R4 | baseline commitado | cobertura "melhorar" porque o denominador encolheu |
| **doctor** | §0.2 | varredura + veredito | o `AGENTS.md` declarar um nível que os gates não sustentam |

---

## Instalação

### 1. G3 — guarda de mutação em massa

```ts
// onde o client de banco nasce — UM lugar, nunca por chamada
import { massMutationGuard } from 'harness-gates/mass-mutation-guard';
export const db = new PrismaClient().$extends(massMutationGuard());
```

Ligue também a barreira estática (as duas são independentes de propósito — a estática
não enxerga valor vindo de variável; a de runtime só age depois que o código rodou):

```js
// eslint.config.js
import noUnfilteredMassMutation from 'harness-gates/eslint';
export default [
  {
    plugins: { harness: { rules: { 'no-unfiltered-mass-mutation': noUnfilteredMassMutation } } },
    rules: { 'harness/no-unfiltered-mass-mutation': 'error' },
  },
];
```

Escape hatch, quando a mutação sem filtro é mesmo intencional:

```ts
await db.log.deleteMany(allowFullScan('expurgo mensal de logs (RFC-42)', {}));
```

O motivo é obrigatório e não pode ser vazio — escape hatch silencioso vira o caminho
padrão em duas semanas. Cada uso emite aviso.

### 2. R3 — trava de produção

Nos **dois** entrypoints do runner de testes (setup de env e setup global — meia trava
é a que não protege o caminho que ninguém lembrou):

```ts
import { assertNotProduction } from 'harness-gates/production-host-guard';
assertNotProduction(process.env.API_BASE_URL, process.env.API_PROD_BASE_URL, 'o ERP');
```

Compara **host**, não URL. Não imprime nenhum dos lados. URL de destino inválida
**reprova**: sem host resolvível não existe prova de que não é produção.

### 3. G7 — trava de boot

Nos dois processos (API e worker):

```ts
import { assertBootEnvironment, hostOf } from 'harness-gates/production-host-guard';
assertBootEnvironment(
  hostOf(process.env.ERP_BASE_URL),   // host EFETIVO — o discriminador
  ['sandbox', 'localhost', '127.0.0.1'],
  'TF-',                              // marcador que produção deve usar
  prefixoResolvido(),                 // o que este processo resolveu
);
```

O discriminador é o **host**, nunca o `APP_ENV`: resolver o esperado a partir do
`APP_ENV` é circular, porque o `APP_ENV` é exatamente o que o copy-paste de comando de
deploy leva errado junto.

### 4. G8 — guarda de migrations

```yaml
- name: guarda de migrations
  run: node tools/gabarito-gates/scripts/migrations-guard.mjs --base origin/${{ github.base_ref }} --dir prisma/migrations
- name: comentário na PR
  run: node tools/gabarito-gates/scripts/migrations-guard.mjs --base origin/${{ github.base_ref }} --dir prisma/migrations --comment > body.md
```

**Antes de ligar, calibre.** Rode contra todo o histórico e conte falsos positivos —
guarda que grita sempre é guarda desligada. Depois fixe `MIGRATION_GUARD_CUTOFF` na
data em que ela entrou; o teste pina a constante, então mudá-la fica visível na PR.

### 5. Ordem de subida

`harness.config.json` na raiz:

```json
{
  "deployOrder": [
    {
      "label": "staging",
      "file": ".github/workflows/deploy-staging.yml",
      "deploy": ["SVC_WORKER", "SVC_API"],
      "rollback": ["SVC_API", "SVC_WORKER"],
      "rollbackSection": "rollback"
    }
  ]
}
```

```yaml
- run: node tools/gabarito-gates/scripts/deploy-order-check.mjs
```

Ele lê a **ordem real das ocorrências**. Um teste que confere se o comentário existe
passa verde com o laço invertido logo abaixo — isso é teatro documentado, e a suíte
deste gate tem um caso que prova a diferença.

### 6. Ratchet de qualidade

Configure em `harness.config.json` os caminhos dos relatórios que você já gera:

```json
{ "quality": {
    "baselineFile": ".quality/baseline.json",
    "coverage": { "api": "apps/api/coverage/coverage-summary.json" },
    "duplication": { "report": ".quality/jscpd.json", "ceiling": 2 },
    "violations": { "report": ".quality/eslint.json" } } }
```

```bash
node .../quality-ratchet.mjs --bootstrap   # cria o baseline; COMMITE
node .../quality-ratchet.mjs               # avalia (rode DEPOIS dos testes)
node .../quality-ratchet.mjs --accept      # sobe o baseline — ato deliberado (R4)
```

**A generalização que importa: o denominador.** A forma clássica de um ratchet de
cobertura mentir é o universo medido encolher — um arquivo sai da conta e a porcentagem
sobe sem ninguém ter escrito um teste. A defesa original era exigir que cada runner
declarasse seu universo explicitamente, o que é específico de cada ferramenta. A defesa
portátil, implementada aqui: **a contagem de arquivos vive no baseline, e cair reprova**,
seja qual for o runner.

Três regras que não têm aceite: teto de duplicação é teto · `errors` de lint reprova
sempre, inclusive com `--accept` · relatório ausente é falha, nunca aprovação por omissão.
E `--accept` é **recusado** enquanto houver erro de lint — run vermelho nunca grava baseline.

### 7. doctor

```yaml
- run: node tools/gabarito-gates/scripts/harness-doctor.mjs
```

Varre o repo, calcula o nível de adoção real, lê o declarado no `AGENTS.md §0.2` e
**reprova quando o declarado é maior**. Rode com `--explain` para receber o conserto de
cada item faltante, `--json` para máquina.

O que nenhuma varredura prova — proteção de branch, backup testado, checks obrigatórios
no ruleset — vive em `.harness/attest.json`:

```json
{
  "branch-protegida": { "confirmado": true, "por": "gabriel", "em": "2026-09-05" },
  "backup-verificado": { "confirmado": true, "por": "gabriel", "em": "2026-09-05" }
}
```

Atestado vence em **180 dias** — depois disso vira "não sei", que é "não". Atestado é
**(c)**, não (a); mas datado e nominal vale muito mais que presumido.

---

## O que cada gate apagou de prosa

Esta é a métrica que importa: gate implementado **remove** linhas do documento.

| Antes (prosa que alguém precisava lembrar) | Agora |
|---|---|
| "teardown só com filtro que restrinja ao que a própria suíte criou, e com `if (!id) return`" | G3 lança; o lint aponta antes |
| "nunca imprima o host ao comparar credenciais" | a trava não tem `console.log` — é impossível vazar por ela |
| "migration destrutiva exige plano de volta, e arquivo vazio não é plano" | G8 reprova, com a razão na mensagem |
| "a ordem é consumidor → produtor, e o motivo fica escrito no YAML" | o teste falha se inverter |
| "nunca declare um nível que os gates não sustentam" | o doctor reprova |

---

## Mutações prescritas

Cada suíte declara, no cabeçalho, as mutações que o revisor deve executar. **Toda uma
delas tem que derrubar a suíte** — a que não derrubar é um achado, não um alívio.

Execução de 05/09/2026, no G3: as quatro prescritas foram mortas.

| Mutação | Resultado |
|---|---|
| M1 checar filtro efetivo **antes** de procurar `undefined` | suíte vermelha |
| M2 `findUndefinedPath` sem recursão | suíte vermelha |
| M3 aceitar `allowFullScan` com motivo vazio | suíte vermelha |
| M4 tratar `OR` como `AND` | suíte vermelha |

---

## Dois defeitos que os próprios testes acharam

Registrados porque são a prova de que a suíte não é teatro:

1. **`teardown-por-id` passava num repo sem nenhum teste** — verde por vacuidade, que é
   exatamente o "verde mentindo" da §9.5. Corrigido: repo sem testes **reprova** a
   checagem, porque não tem teardown nenhum para ser seguro.
2. **A trava de boot resolvia o esperado a partir do `APP_ENV`** — circular, já que o
   `APP_ENV` é o que pode estar errado. Corrigido: o discriminador passou a ser o host.
3. **O ratchet gravava o baseline sem criar o diretório** — quebraria no primeiro
   `--bootstrap` de qualquer projeto. Pego pelo teste de ciclo completo em disco.

---

## Requisitos e verificação de instalação limpa

**Node ≥ 22.18.** É a versão em que o *type stripping* passou a ser ligado por padrão —
abaixo dela, os arquivos `.ts` dos guards precisam de `--experimental-strip-types` (22.6–22.17)
ou de serem compilados. Alternativa sempre válida, e a mais simples: **copiar os dois `.ts`
para dentro do seu `src/`**. Eles não importam nada.

Smoke test executado em projeto novo e vazio (05/09/2026, Node 22.22.2):

| Verificação | Resultado |
|---|---|
| `harness-doctor` em repo virgem | nível 0, exit 0 — honesto, não reclama do que não existe |
| `harness-doctor` com `AGENTS.md` declarando 3 | **exit 1** — reprova o nível inflado |
| `migrations-guard` sem migration | exit 0 |
| `migrations-guard` com `DROP TABLE` sem plano de volta | **exit 1**, com a razão na mensagem |
| `migrations-guard` com plano de volta | exit 0 |
| `deploy-order-check` sem `deployOrder` no config | **exit 1** — gate não declarado é gate ausente |
| regra ESLint sob ESLint 9 real | pegou `deleteMany()`, `where: {}` e `id: undefined`; **não** acusou o filtro válido nem o `allowFullScan` |
| `import` dos guards a partir de projeto consumidor | ok em runtime e sob `tsc --noEmit` |
| suíte completa rodando da cópia do consumidor | 76/76 |

**O limite da regra de lint, medido no mesmo teste:** ela **não** pega
`where: { tenantId }` quando `tenantId` é variável que vale `undefined` — que é
exatamente o incidente original. É por isso que a guarda de runtime é obrigatória, e não
opcional. Duas barreiras independentes, cada uma cobrindo o furo da outra.

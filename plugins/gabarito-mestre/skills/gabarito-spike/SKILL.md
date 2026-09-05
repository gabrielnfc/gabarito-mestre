---
name: gabarito-spike
description: Mede uma pergunta fechada e responde CONFIRMADA ou REFUTADA com número. Use quando o usuário pedir para "medir", "fazer um spike", "confirmar se a API pagina", "quantos registros", "isso é verdade?", "verificar a hipótese", "a premissa vale?", "rodar uma medição", "Task 0 do plano", "spike this" ou quando um plano tem incógnita externa. Não implementa nada.
allowed-tools: Read, Glob, Grep, Bash, Write
---

# gabarito-spike

Uma **pergunta fechada** → uma **medição com número** → **CONFIRMADA / REFUTADA**. Segue o prompt de papel "Spike" de `${CLAUDE_PLUGIN_ROOT}/reference/prompts.md`.

## Divisão de trabalho (`reference/AGENTS.md §9`)

- **superpowers CONDUZ:** o spike é a **Task 0** que `superpowers:writing-plans` coloca no plano quando há incógnita, e é despachado como subagente por `superpowers:subagent-driven-development` (agente `gabarito-spike` deste plugin). O resultado volta como **fato medido `Mn`** no design (`referencia.md §2.1`) — esta skill não escreve o design; ela entrega o número que superpowers registra.
- **ui-ux-pro-max DESENHA:** em spike de UI (ex.: "o componente X suporta Y?", "quantos ms o bundle leva"), a pergunta pode vir dele; a medição e o veredito continuam sendo desta skill. Regras de tela que valem mesmo no spike: **R9, §8, R10**.
- **gabarito-mestre MANDA:** o formato (método · dado bruto · veredito · o que a medição não responde) e as regras de validade (I1, I2, I5, I10).

**Fail-closed declarado (G9):** sem superpowers, avise em uma linha — `superpowers ausente: o número não será registrado automaticamente como fato Mn; registre-o você no design` — e meça.

## Procedimento

1. **Feche a pergunta.** Se não tem resposta verificável ("a API é boa?"), devolva-a reformulada e pare. Escreva o **custo estimado** (chamadas, páginas, entidades).

2. **Autorização (R3):** se a medição toca **sistema de terceiro em produção**, você precisa de autorização **nominal, para esta consulta**, já concedida. Não tem? **Pare e peça**, com o custo. "Se precisar, pode ler" não é autorização. Os hooks deste plugin barram acesso a produção por padrão — isso é o esperado, não um bug.

3. **Meça.** Regras que decidem a validade:
   - **I1** — leitura paginada: leia **até a página incompleta** antes de contar, somar ou dizer "não existe". Página cheia é truncamento, nunca censo.
   - **I2** — introspecção prova presença, nunca ausência.
   - **I5** — ferramenta que trunca ou corrompe saída invalida a **conclusão**, não a hipótese. Grep que não acha não prova ausência.
   - **I10** — "existe" ≠ "está configurado" ≠ "está ativo". Verifique separadamente.
   - **R2** — nenhuma escrita, em nenhum ambiente. Se a medição exige criar dado, é com id de teste e teardown por id, e só com autorização.

4. **Escreva fora do escopo: nada.** Artefatos da medição (scripts, saídas brutas) vão para um diretório de spike (`.spike/<data>-<tema>/`) — nunca para `src/`.

## Saída

```
SPIKE — <pergunta fechada>
Custo estimado: <n chamadas / páginas / entidades>   Autorização: <n/a | nominal por <quem> em <data>>

Método: <o que exatamente foi consultado, com que parâmetros, quando>
Dado bruto (resumido, com contagens): …
NÚMERO: <o número que responde à pergunta>
VEREDITO: CONFIRMADA | REFUTADA
O que a medição NÃO responde: …
Marcação: (a) medido · (b) inferido — item a item
```

## Proibido

- Virar implementação. Spike que "aproveita e implementa" é o anti-padrão que I8 nomeia.
- Veredito sem número. "Parece que sim" é REFUTADA por falta de prova.
- Tocar produção de terceiro sem autorização nominal (R3). Deletar ou escrever sem autorização (R2).

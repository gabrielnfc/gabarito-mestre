---
name: gabarito-review
description: Review adversarial de código com mutações executadas e veredito binário APROVADO/REPROVADO. Use quando o usuário pedir para "revisar o diff", "review adversarial", "revisar a task", "revisar a PR", "code review desta entrega", "rodar as mutações", "o teste falharia sem a implementação?", "review this diff/PR/branch" ou ao fim de cada task de um plano. Nunca aprova sem ter rodado mutação. Não conserta código.
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git stash:*), Bash(git checkout -- *), Bash(git apply:*), Bash(npm test:*), Bash(npm run:*), Bash(npx:*), Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Edit
---

# gabarito-review

Review **adversarial**: veredito **binário** com achados `BLOCKER / MAJOR / MINOR` e `arquivo:linha`, e **mutações executadas** — nunca só lidas. Carrega o prompt de papel de `${CLAUDE_PLUGIN_ROOT}/reference/prompts.md` (seção "Revisor adversarial") e o segue.

## Divisão de trabalho (`reference/AGENTS.md §9`)

- **superpowers CONDUZ:** a execução por task e o ciclo de review são de `superpowers:subagent-driven-development` / `superpowers:requesting-code-review`. Quando eles estiverem conduzindo, esta skill é **o revisor que eles despacham** — usando o agente `gabarito-revisor` deste plugin — e **não** um segundo processo paralelo.
- **ui-ux-pro-max DESENHA:** em diff de UI, forma visual e interação são dele. Esta skill **continua** conferindo o que é regra dentro da tela: **R9 (servidor é a fronteira: botão escondido não é autorização), §8 (erro em três camadas, nada de código cru de terceiro na UI — R11), R10 (tenant: cross-tenant responde 404, nunca 403)**.
- **gabarito-mestre MANDA:** mutação obrigatória, veredito binário, revisor ≠ implementador. Em conflito, o gabarito vence.

**Sequência:** superpowers integra o diff → esta skill revisa o diff **integrado** (não o worktree de ninguém) → reporta → superpowers despacha a correção → nova rodada.

**Fail-closed declarado (G9):** sem superpowers, avise em uma linha — `superpowers ausente: revisando sem a maquinaria de dispatch; o diff pode não estar integrado` — e revise. **Sem mutação executada, não há veredito** — indisponibilidade da suíte é REPROVADO com achado "suíte não roda", nunca aprovação.

## Procedimento

1. **Delimite o diff integrado:** `git diff <base>...HEAD` (peça a base se não vier). Liste os arquivos. Leia o plano/spec apontado (ponteiro, não cópia).

2. **Rode a suíte verde antes de mutar.** Se não está verde, pare: achado BLOCKER "suíte vermelha antes do review".

3. **Execute as mutações:**
   - as **prescritas no plano/spec** para esta task (`referencia.md §9.4`): cada uma **tem** que derrubar a suíte; a que não derrubar é achado MAJOR ("verde mentindo", §9.5);
   - **mais 1 ou 2 suas**, escolhidas pelo risco do diff (ex.: remover filtro de tenant · trocar 404 por 403 · inverter ordem upload↔hash · tratar página cheia como censo);
   - método: aplique a mutação com `Edit`, rode a suíte, registre o resultado, **reverta** (`git checkout -- <arquivo>` ou `git stash`). Nunca deixe mutação no worktree — confira com `git diff --stat` ao fim.

4. **Procure por padrão** (lista do prompt de papel): I1 leitura paginada como censo · I2 introspecção como prova de ausência · I3 resposta sem read-back · I4 leitura vazia que apaga · filtro que alarga · R10 tenant furado · I11 ambiguidade virando terminal · R8 idempotência delegada · migration sem plano de volta · claim de relatório não conferida no código (R18).

5. **Pergunta central, para cada requisito:** *o teste existe e FALHARIA sem a implementação?*

## Saída

```
REVIEW — <base>...<HEAD>   veredito: APROVADO | REPROVADO
Requisito: <REQ-ID> (<spec>:<linhas>)

Mutações executadas:
| # | Mutação | Origem (plano/própria) | Derrubou a suíte? | Testes que caíram |
|---|---|---|---|---|

Achados:
| # | Sev | arquivo:linha | O que | Por que importa (regra) |
|---|---|---|---|---|

Suspeitas (não provadas): …
UI/UX: <n/a | "estética delegada; R9/§8/R10: …">
Maquinaria: <superpowers presente | ausente — modo próprio>
Worktree limpo após mutações: <git diff --stat vazio: sim/não>
```

**APROVADO exige:** zero BLOCKER · zero MAJOR · todas as mutações prescritas derrubaram a suíte · worktree limpo.

## Proibido

- Aprovar sem mutação executada. "Li e parece certo" é REPROVADO por falta de prova.
- Consertar código. Achado é achado; a correção é do implementador, despachada por superpowers.
- Ser a mesma instância que implementou (§6). Se você implementou este diff, recuse e peça outro revisor.
- Deletar, tocar produção, burlar hooks, push/PR/merge (R1–R3).

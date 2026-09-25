---
description: Mede o nível real de adoção do harness neste repositório (harness-doctor --explain) e explica cada item
allowed-tools: Bash(node:*), Read
---

Rode o doctor do gabarito no diretório do projeto e explique a saída.

1. Se o repositório já tem a cópia instalada (`tools/gabarito-gates/`), use ela — é a que roda no CI:

```bash
node tools/gabarito-gates/scripts/harness-doctor.mjs --explain
```

   Senão (harness ainda não instalado), use a cópia do plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/harness-doctor.mjs" --explain
```

   A cópia instalada pode estar atrás do plugin (o cartão de sessão avisa "rode instalar.sh --atualizar"); nesse caso, rode as duas e explique a diferença — a que vale no CI é a instalada.

2. Cole a saída inteira. Não resuma antes de colar.

3. Explique, em no máximo 14 linhas:
   - **Nível alcançado × declarado** — e o exit code (`1` = o `AGENTS.md §0.2` declara mais do que os gates sustentam; conserto: implementar o que falta OU baixar o número).
   - Para cada `FALTA` de nível 1 (segurança), a linha `→` com o conserto. Nível 1 vem antes de qualquer outro (`adocao.md §2`).
   - Atestados vencidos ou ausentes (`.harness/attest.json`, TTL 180 dias): "não sei" é "não".
   - O que está marcado `--` (opcional/inaplicável) — não conta contra o nível.
   - **`warn`** (ex.: `warn modelo-resolvido`): **aviso, não falta** — não entra no nível, não muda o exit code, não quebra CI. Significa que `orquestracao.modelo.resolvidoEm` passou de `validadeDias` (90): a família "mais potente" pode ter mudado. Conserto: revalidar em `gabarito-instalar` (fase 4 — "refazer onboarding"). `warn` ≠ `FALTA` ≠ `--`.
   - A linha **`checagens novas da 1.1.0: rode o onboarding ou declare o nível medido`** aparece em repo 1.0.x cujo nível caiu por checagens que não existiam (`fluxo-configurado`, `versionamento`, `changelog`, `agents-tamanho`, `iniciativa-resolvida`, `paralelismo-calibrado`). Conserto: `gabarito-instalar` (onboarding) **ou** baixar o `§0.2` para o medido — nunca o contrário.
   - `--cache` grava `.harness/doctor-cache.json` (`{ nivel, declarado, em }`) para o cartão de sessão; **não** passe `--cache` no CI nem ao explicar para o usuário — o cartão o chama sozinho quando o cache tem mais de 24 h.

4. **Nunca** sugira editar o número do §0.2 para cima. Nível é medido, não declarado. Se o usuário pedir para "subir o nível", responda com a lista de `FALTA` do nível seguinte.

Argumentos extras: `$ARGUMENTS` (ex.: `--json` para saída de máquina).

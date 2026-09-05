---
description: Mede o nível real de adoção do harness neste repositório (harness-doctor --explain) e explica cada item
allowed-tools: Bash(node:*), Read
---

Rode o doctor do gabarito no diretório do projeto e explique a saída.

1. Execute exatamente:

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/harness-doctor.mjs" --explain
```

   Se o repositório já tem a cópia instalada em `tools/gabarito-gates/`, prefira ela (é a que roda no CI):

```bash
node tools/gabarito-gates/scripts/harness-doctor.mjs --explain
```

2. Cole a saída inteira. Não resuma antes de colar.

3. Explique, em no máximo 12 linhas:
   - **Nível alcançado × declarado** — e o exit code (`1` = o `AGENTS.md §0.2` declara mais do que os gates sustentam; conserto: implementar o que falta OU baixar o número).
   - Para cada `FALTA` de nível 1 (segurança), a linha `→` com o conserto. Nível 1 vem antes de qualquer outro (`adocao.md §2`).
   - Atestados vencidos ou ausentes (`.harness/attest.json`, TTL 180 dias): "não sei" é "não".
   - O que está marcado `--` (opcional/inaplicável) — não conta contra o nível.

4. **Nunca** sugira editar o número do §0.2 para cima. Nível é medido, não declarado. Se o usuário pedir para "subir o nível", responda com a lista de `FALTA` do nível seguinte.

Argumentos extras: `$ARGUMENTS` (ex.: `--json` para saída de máquina).

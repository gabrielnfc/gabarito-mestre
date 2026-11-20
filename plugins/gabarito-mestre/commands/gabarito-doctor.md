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
   - **`warn`** (ex.: `warn modelo-resolvido`): **aviso, não falta** — não entra no nível, não muda o exit code, não quebra CI. Significa que `orquestracao.modelo.resolvidoEm` passou de `validadeDias` (90): a família "mais potente" pode ter mudado. Conserto: revalidar em `gabarito-instalar (trocar orquestracao)`. `warn` ≠ `FALTA` ≠ `--`.
   - Dois avisos do quadro de PBIs (GM-16), ambos `warn`: não mudam o nível nem o exit code. (a) `gates/scripts/harness-doctor.mjs:915-919` e `:938-942`.
     - **`warn fluxo-status-fl1`**: lista cards do quadro FL1 cujo `status` não é uma coluna de `fluxo.status.FL1` (mostra a contagem e os 3 primeiros). Vale sempre, com `painel.projeto.opcoesComoContagem` ligada ou não; desligada, a saída acrescenta a dica de ligar a chave para o painel mostrar "N opções". (a) `harness-doctor.mjs:915-935`.
     - **`warn pbi-mergeado-aberto`**: lista PBIs ainda abertos no quadro (aberto = `ehFeito` falso: o `status` não é o `concluido` da config nem o fixo, sem diferença de acento, caixa ou espaço nas pontas; a entrega encerrada NÃO entra) que já têm commit `tipo(ID)` na base da entrega. O git é lido com `--first-parent`; o `tipo` é um da lista padrão fixa do doctor, `tiposComEscopoDePbi` de `versionamento-check.mjs` (`feat`, `fix`, `enabler`, `debt`, `spike`, `task`, `perf`, `refactor`); a chave `versionamento.tiposComEscopoDePbi` da config NÃO a muda. (a) `gates/scripts/versionamento-check.mjs:35`, importada em `harness-doctor.mjs:43` e usada em `:373` e `:457`; `ehFeito` em `:948`; `:449`, `:455-457`, `:945-985`. A base vem de `entrega.base`, pela mesma função da entrega (`lerBaseDaEntrega`), e não de `versionamento.branchPadrao`. (a) `harness-doctor.mjs:956-960`; `gates/lib/config.mjs:175-186`.
     - **Card com frontmatter quebrado é listado, não some** (REQ-DCT-1 f): arquivo da pasta FL1 cujo nome é um ID válido (`fluxo.idPadrao`, o da `origin/HEAD`, ou o padrão) mas cujo frontmatter não dá um `id` válido entra, nos DOIS avisos, numa linha própria `N cards ilegíveis; 3 primeiros: <arquivo>`; o resto do aviso segue conferido. Só cards ilegíveis e nenhum outro achado ⇒ o aviso sai `found: false` com a linha (nunca "ok"); arquivo cujo nome não é ID (`README.md`) não entra; nível e exit code não mudam. (a) `harness-doctor.mjs:425`, `:431`, `:931`, `:949`.
     - **Ilegível vira "não conferido"** (card ilegível, config de origin inválida, base inexistente ou git sem leitura), nunca "tudo certo". (a) `harness-doctor.mjs:432`, `:924`, `:962-979`.
     - **Ferramenta de fluxo diferente de `arquivos`** vira "não se aplica" e não conta contra o repositório. (a) `harness-doctor.mjs:398` e `:923`.
   - A linha **`checagens novas da 1.1.0: rode o onboarding ou declare o nível medido`** aparece em repo 1.0.x cujo nível caiu por checagens que não existiam (`fluxo-configurado`, `versionamento`, `changelog`, `agents-tamanho`, `iniciativa-resolvida`, `paralelismo-calibrado`). Conserto: `gabarito-instalar` (onboarding) **ou** baixar o `§0.2` para o medido — nunca o contrário.
   - `--cache` grava `.harness/doctor-cache.json` (`{ nivel, declarado, em }`) para o cartão de sessão; **não** passe `--cache` no CI nem ao explicar para o usuário — o cartão o chama sozinho quando o cache tem mais de 24 h.

4. **Nunca** sugira editar o número do §0.2 para cima. Nível é medido, não declarado. Se o usuário pedir para "subir o nível", responda com a lista de `FALTA` do nível seguinte.

Argumentos extras: `$ARGUMENTS` (ex.: `--json` para saída de máquina).

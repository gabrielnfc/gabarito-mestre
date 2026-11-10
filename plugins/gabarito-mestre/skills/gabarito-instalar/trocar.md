# gabarito-instalar: trocar um item que não é pergunta do onboarding

Carregado só quando o usuário pede `trocar orquestracao`, `trocar settings`, `trocar codeowners`, `trocar apendice`, `trocar iniciativa` ou `trocar contenda`. Siga só a seção do item pedido. `<raiz>` é a raiz do git (passo 1 do Fluxo em `SKILL.md`). Antes de qualquer gravação, mostre o bloco e peça ok.

Os dois scripts de config (`onboarding-config.mjs`) fazem merge chave a chave, nunca removem e imprimem o diff. Decida pelo **stdout** (a primeira linha diz o que aconteceu); o stderr só explica:

| stdout | exit | O que fazer |
|---|---|---|
| `[ONB-7] harness.config.json atualizado` + linhas `+`/`~` | 0 | gravou: mostre o diff e siga |
| `[ONB-7] harness.config.json sem mudanças` | 0 | nada mudou: siga |
| `[ONB-7] dry-run — <alvo> não foi escrito` + diff | 0 | só mostrou; nada gravado |
| `[ONB-7] <alvo> NÃO escrito — JSON inválido (fail-open declarado, G9)` | 0 | o arquivo existente está inválido: pare, mostre o stderr e peça ao usuário que conserte; depois repita |
| vazio (stderr: `uso: …`, `JSON inválido no argumento`, `seção desconhecida`) | 1 | o erro é do seu JSON: mostre o stderr, corrija e repita |

Exit 0 não é sucesso sozinho: exit 0 com `NÃO escrito` é falha declarada.

## orquestracao

Recalibra o paralelismo desta máquina: quantos implementadores trabalham ao mesmo tempo, o teto e os limites de carga, memória e disco. Só este item troca esses números; um onboarding repetido ou `trocar perfil` nunca mexe neles. O usuário vê antes e depois e decide.

1. Detecte com a prévia da recalibração, no lugar do `detectar` comum:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding.mjs" detectar --recalibrar --root "<raiz>"
   ```
2. Mostre a seção `calibração do paralelismo:` do campo `previa` (hoje ⇒ depois). Pergunte por `AskUserQuestion`, sem default `sim`: "Gravar a nova calibração do paralelismo?" com `sim` e `não`. `não`, ou sessão sem `AskUserQuestion`: não grave, diga que nada mudou e que o doctor continua avisando.
3. Com `sim`: passos 5 a 7 do Fluxo, com as respostas no `default` de cada pergunta e uma chave a mais no arquivo de respostas, `"_recalibrar": true`. O `gravar` calibra pelos núcleos desta máquina, mantém o resto de `paralelismo` (como `arquivosDeContenda`) e também renova a data do modelo. Depois mostre o diff e a linha do doctor sobre o paralelismo.

## settings

Grava `.claude/settings.json` do projeto. Não existe default `sim`: consentimento é ato do usuário.

1. O alias do modelo vem de `orquestracao.modelo.alias` em `harness.config.json`; se faltar, pergunte (`fable`, `opus`, `sonnet`, `haiku`). Mostre o diff **sem gravar**:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root "<raiz>" --dry-run --settings '{
     "model": "<alias>",
     "enabledPlugins": { "gabarito-mestre@gabarito-mestre": true },
     "extraKnownMarketplaces": { "gabarito-mestre": { "source": { "source": "github", "repo": "gabrielnfc/gabarito-mestre" } } }
   }'
   ```
   Chaves que o usuário já tem (`permissions`, `env`, `hooks`…) ficam byte a byte.
2. Pergunte por `AskUserQuestion` em dois oks separados, sem default `sim`:
   - (i) gravar `model: <alias>` para o time inteiro? Settings de projeto vencem os do usuário e mudam o custo de todos que clonam. `sim` / `não`.
   - (ii) registrar o marketplace do gabarito e habilitar o plugin (`enabledPlugins` + `extraKnownMarketplaces`)? Isso liga hooks de terceiro para quem clonar. `sim` / `não`.
3. Grave só o confirmado, em uma chamada, sem `--dry-run`, com o JSON reduzido ao que recebeu `sim` (mesmo comando do item 1, sem `--dry-run`). Nenhum `sim`: não grave e diga por quê. Sessão sem `AskUserQuestion`: (i) e (ii) valem `não`; o diff fica na saída.
4. Diga em uma linha: cada pessoa do time instala o plugin `gabarito-mestre` uma vez, pelo menu `/plugin` do Claude Code; `enabledPlugins` só o habilita para quem já instalou.

## codeowners

Áreas do repo e o dono de cada uma (`.github/CODEOWNERS`). Três casos, decididos por medição, um comando por vez:

```bash
test -e "<raiz>/.github/CODEOWNERS"
```
Exit 1: **ausente**. Exit 0: conte as linhas que não são comentário nem vazias e o marcador do esqueleto:
```bash
grep -c -v '^[[:space:]]*\(#.*\)\?$' "<raiz>/.github/CODEOWNERS"
```
```bash
grep -c '^# Áreas e donos (TIM-1) — preenchido pelo onboarding' "<raiz>/.github/CODEOWNERS"
```
(`grep -c` imprime `0` e sai com exit 1 quando não há linha: leia o número, não o exit.) Primeiro `0` e segundo `≥ 1`: **esqueleto**; qualquer outra combinação: **próprio**.

- **ausente**: pergunte as áreas e os donos (padrão de caminho e `@dono`; uma área `*` com o usuário serve) e crie o arquivo mostrando o conteúdo antes. `flag: "wx"` recusa se o arquivo passou a existir (R2):
  ```bash
  mkdir -p "<raiz>/.github"
  ```
  ```bash
  node -e 'const f = process.argv[2] + "/.github/CODEOWNERS"; require("fs").writeFileSync(f, process.argv[1], { flag: "wx" }); console.log("criado", f)' '# Áreas e donos — gerado pelo onboarding do gabarito-mestre em <AAAA-MM-DD>. Fonte: AGENTS.md, Apêndice "Áreas e donos".
  <padrão> <@dono>
  ' "<raiz>"
  ```
- **esqueleto** (só comentários, e o primeiro é o marcador que `instalar.sh --codeowners` escreve: `# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:`): preencha. Mantenha o marcador, troque a linha `# <caminho/>  @<dono>` pelas linhas reais (`Edit`, mostrando o diff antes).
- **próprio** (qualquer linha não comentada, ou comentário que não é o marcador): não toque; diga em uma linha que o Apêndice vai citar o arquivo existente.

## apendice

Preenche o Apêndice do `AGENTS.md` com o que já está em `harness.config.json`. Mostre o bloco, peça ok e aplique com `Edit` na **segunda célula** (vazia) da linha existente; o rótulo fica como está. Num `AGENTS.md` antigo que não tem a linha, acrescente a linha inteira ao fim da tabela; nunca remova nada. O Apêndice tem orçamento de 4.096 bytes: uma linha por item, sem prosa.

```
| Fluxo: ferramenta · Iniciativa padrão (ID · nome) · escrita autorizada por `____` em `____` (ADR-FLX-2) | ferramenta <x> · MCP <nome ou —> · Iniciativa <ID> "<nome>" (<url ou sem url>) · FL3/FL2/FL1 = <a> / <b> / <c> · vínculo PBI→Epic: <tipo> `<nome>` · escrita: <não autorizada, ou autorizada por <quem> em <data>> · (b): <o que não foi confirmado na ferramenta> · resolvido em <AAAA-MM-DD> |
| Áreas e donos (`.github/CODEOWNERS`) | <área> → <@dono> · <área> → <@dono> (fonte: .github/CODEOWNERS) |
| Versionamento: modelo · prefixos de branch · resolvido em (R20) | trunk-based (D2), trunk <trunk> · branch tipo/<PBI>-slug · worktree wt/<PBI>-<n> · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag vX.Y.Z · squash com título CC · resolvido em <AAAA-MM-DD> |
| Modelo do orquestrador: política · alias · resolvido em (validade 90 d) | política mais-potente · alias <alias> · resolvido em <AAAA-MM-DD> (b — fonte: /model do usuário) · validade 90 d |
| Paralelismo: simultaneos · teto · calibrado em | simultaneos <n> · teto <n> · calibrado em <AAAA-MM-DD> (<cores> cores) |
| Isolamento de worktree: porta · schema · namespace por `n` | porta 3000+n · schema wt_{n} · namespace wt-{n} (n = índice de wt/<PBI>-<n>) |
```

Com escrita autorizada na ferramenta, troque também os dois `____` do rótulo da linha Fluxo por quem e data. Item que a config não tem: deixe a célula como está e diga qual `trocar` o preenche.

## iniciativa

Lê a Iniciativa na ferramenta de planejamento e grava `fluxo` na config. A ferramenta (`fluxo.ferramenta`, `fluxo.mcp`) já foi detectada; se faltar, `trocar planejamento` primeiro.

1. Antes de qualquer chamada `mcp__*` de leitura, diga em uma linha e espere o ok: `vou LER na ferramenta <X> para confirmar a Iniciativa; ferramenta de planejamento não é produção de terceiro por padrão, mas é sistema vivo — ok?`. Sem ok, pare.
2. Com ok, pergunte o ID ou nome da Iniciativa e busque conforme `comoBuscarIniciativa` da entrada de `${CLAUDE_PLUGIN_ROOT}/reference/ferramentas-mcp.json` cujo `padraoServidor` casa `fluxo.mcp` (regex sem caixa; entrada com `confirmadoEm: null` é sugestão (b), diga isso). Sem entrada, pergunte ao usuário como buscar. Uma só chamada de leitura por pergunta; nenhuma escrita nesta etapa.
   - Existe não é ativa: leia o status e confirme com o usuário que é a Iniciativa ativa.
   - Vazio não é prova: busca sem resultado não grava; pergunte de novo. Se o usuário insistir, grave o `nome` prefixado por `(b) ` e liste no fechamento.
   - URL sem token: se a URL tiver `token=`, `key=` ou `sig=`, corte a query string.
   - Sem ferramenta (`arquivos`): pergunte ID e nome; `url` fica `""`.
3. Perguntas fechadas, uma por vez (`AskUserQuestion`):

   | # | Pergunta | Default |
   |---|---|---|
   | 1 | Onde vivem FL3 / FL2 / FL1 na ferramenta? | `hierarquiaSugerida` da entrada; em `arquivos`: `docs/fluxo/iniciativa.md` / `docs/fluxo/epics/` / `docs/fluxo/pbis/` |
   | 2 | Nomes dos status FL2: `preparado`, `em_execucao`, `em_validacao`, `concluido` | `statusSugerido.FL2`; em `arquivos`: `Preparado`, `Em execução`, `Em validação`, `Concluído` |
   | 3 | Nomes dos status FL1: `preparado`, `em_execucao`, `revisao`, `pronto`, `concluido` | `statusSugerido.FL1`; em `arquivos`: `Preparado`, `Em execução`, `Revisão e teste`, `Pronto para liberar`, `Concluído` |
   | 4 | Formato de ID (regex) | `^[A-Z]+-\d+$` |
   | 5 | Como o PBI aponta para o Epic: `tipo` (`campo`, `relacionamento`, `frontmatter`) e `nome` (só com ferramenta MCP) | o vínculo que a entrada cita; em `arquivos` não se pergunta: é `frontmatter` / `epic` |
   | 6 | **Escrita autorizada na ferramenta?** (ADR-FLX-2) | default **não**: só vira `true` com resposta explícita; anote quem e quando |

   As chaves de `fluxo.status` nunca mudam; só os valores variam por ferramenta.
4. Grave (o script preserva o que já existe e imprime o diff). Em `arquivos`, `mcp` é `null` sem aspas, nunca a string `"null"`:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root "<raiz>" --set fluxo '{
     "iniciativa": { "id": "<ID>", "nome": "<nome>", "url": "<url sem token ou vazio>" },
     "mapeamento": { "FL3": "<resposta 1>", "FL2": "<resposta 1>", "FL1": "<resposta 1>" },
     "status": {
       "FL2": { "preparado": "<…>", "em_execucao": "<…>", "em_validacao": "<…>", "concluido": "<…>" },
       "FL1": { "preparado": "<…>", "em_execucao": "<…>", "revisao": "<…>", "pronto": "<…>", "concluido": "<…>" }
     },
     "vinculoPbiEpic": { "tipo": "<resposta 5>", "nome": "<resposta 5>" },
     "escrita": false,
     "idPadrao": "<resposta 4>",
     "ledgerDir": "docs/ledgers",
     "envelhecimentoDias": 3
   }'
   ```
   `escrita: true` só se a resposta 6 foi sim; então o Apêndice recebe `escrita autorizada por <quem> em <data>` (item `apendice`). Sessão sem `AskUserQuestion`: `escrita` fica `false`.
5. Em `arquivos`, crie só o que não existe, um comando por vez: `mkdir -p "<raiz>/docs/fluxo/epics" "<raiz>/docs/fluxo/pbis"`; depois, para cada par, `test -e "<raiz>/<destino>"` e, só com exit 1, `cp -n` para `"<raiz>/<destino>"`:

   | Destino (dentro da raiz) | Origem em `${CLAUDE_PLUGIN_ROOT}/templates/fluxo/` |
   |---|---|
   | `docs/fluxo/iniciativa.md` | `iniciativa.md` |
   | `docs/fluxo/epics/EPIC-EXEMPLO.md` | `epic.md` |
   | `docs/fluxo/pbis/PBI-EXEMPLO.md` | `us.md` |

   Com `Edit`, preencha no frontmatter o `id` e o nome da Iniciativa, o `iniciativa: <ID>` do Epic e o `epic: EPIC-EXEMPLO` do PBI. Os outros templates (`enabler`, `tech-debt`, `spike`, `bug`, `tarefa`) ficam no plugin.

## contenda

Arquivos em que dois implementadores em paralelo não podem mexer ao mesmo tempo (`orquestracao.paralelismo.arquivosDeContenda`). Proponha a lista a partir do que existe no repo (`ls` ou `Glob`): o lockfile detectado (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `go.sum`), `prisma/` se existir, `src/index.ts` se existir e sempre `docs/fluxo/`. O usuário confirma a lista. Grave só esta chave (o resto de `paralelismo` fica):

```bash
node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding-config.mjs" --root "<raiz>" --set orquestracao '{ "paralelismo": { "arquivosDeContenda": [<lista confirmada>] } }'
```

Depois, no Apêndice (`trocar apendice`), a linha `Arquivos de contenda (serial, sem override)` recebe a lista, na segunda célula.

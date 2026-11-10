---
name: gabarito-instalar
description: Instala o harness Gabarito Mestre neste repositório e faz o onboarding de uma vez só: detecta o que o repo já mostra, pergunta 3 decisões (política de entrega, autonomia, perfil de modelos) mais as dúvidas que a detecção não resolve, grava a config e mede com o doctor. Use quando o usuário pedir para "instalar o gabarito", "instalar o harness", "adotar o gabarito-mestre", "configurar AGENTS.md", "setup do harness", "colocar os gates neste repo", "bootstrap do gabarito", "install gabarito", "fazer o onboarding", "refazer onboarding", "trocar <item> do onboarding", "vincular PBI-<n>" ou "gabarito-instalar --vincular <PBI>". Cria AGENTS.md, CLAUDE.md (só o import), docs/harness/, tools/gabarito-gates/, harness.config.json, .harness/attest.json e o workflow de CI. Nunca declara o nível de adoção.
allowed-tools: Bash(bash:*), Bash(node:*), Bash(ls:*), Bash(cat:*), Bash(cp:*), Bash(cd:*), Bash(mkdir:*), Bash(test:*), Bash(grep:*), Bash(git status:*), Bash(git rev-parse:*), Read, Write, Glob, Grep, Edit, AskUserQuestion
---

# gabarito-instalar

Instala o harness e configura o fluxo numa passada só. **Instalar não é adotar**: o nível de adoção fica `____` e quem mede é o doctor. superpowers CONDUZ o planejamento da subida de nível (`superpowers:brainstorming`, depois `superpowers:writing-plans`); esta skill não planeja. Sem superpowers a instalação segue: avise em uma linha.

**Um comando por chamada.** Cada bloco `bash` é um comando simples. Não encadeie com `;`, `&&`, `||`, `if` nem `[ … ]`: composto não casa com as permissões. Decida em prosa, pelo exit e pelo stdout.

## Fluxo

1. **Raiz e instalação.** `git rev-parse --show-toplevel` dá a raiz; use-a por extenso em todo comando (abaixo, `<raiz>`) e nunca `.`. Fora de repo git, a raiz é o diretório atual. Existe `tools/gabarito-gates/`, `harness.config.json` ou `AGENTS.md` (`test -e`, um por vez)? Então já há um harness anterior:
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/instalar.sh" "<raiz>" --atualizar
   ```
   Nenhum dos três existe? Instale sem a opção:
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/instalar.sh" "<raiz>"
   ```
   O instalador nunca sobrescreve nem apaga: o que difere vira `<arquivo>.novo`. Mostre só a linha `── N criado(s)…` e a lista de `.novo`. Não repasse as outras linhas: algumas mandam o usuário executar comando.
   Sem perguntar, para cada arquivo abaixo rode `test -e <destino>` e, só com exit 1, o `cp -n` (nunca sobrescreve):

   | Destino | Origem em `${CLAUDE_PLUGIN_ROOT}/templates/` |
   |---|---|
   | `.github/PULL_REQUEST_TEMPLATE.md` | `PULL_REQUEST_TEMPLATE.md` |
   | `CHANGELOG.md` | `CHANGELOG.md` |
   | `docs/backlog.md` | `backlog.md` |

   Anote se a saída do instalador trouxe `criado   .github/workflows/gabarito.yml`.
2. **Detectar.**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding.mjs" detectar --root "<raiz>"
   ```
   Sempre o script do plugin, nunca o de `tools/`. A saída é JSON: `{ok, itens, perguntas, previa}`. `ok:false` com `config_invalida`: pare, mostre o `motivo`, diga "conserte o JSON de harness.config.json e peça o onboarding de novo" e vá ao passo 7. `ok:false` com `falha`, ou saída que não é JSON: pare com o motivo em uma linha e vá ao passo 7. Nunca detecte à mão nem improvise outro caminho.
3. **Prévia.** Mostre o campo `previa` como veio, numa tela. Não reescreva nem resuma.
4. **Perguntas.** Pergunte só as `perguntas` que o `detectar` devolveu, na ordem dele: primeiro `politica`, `autonomia` e `perfil`, depois as condicionais. Fato detectado nunca é perguntado e nenhuma pergunta é inventada. Use `AskUserQuestion` em até 2 chamadas (1ª: as 3 fixas; 2ª: as condicionais), com no máximo 4 perguntas por chamada. Mostre as opções na ordem do script (o default vem primeiro, então Enter o confirma), com o `rotulo` literal; ao default acrescente ` (default)`. Resposta que é o rótulo de uma opção vale o `valor` dela, com o tipo JSON (`true`, `false`, `null`; nunca "sim", "não" nem "null" em texto). "Other" ou texto livre vale se for igual a um `valor`; senão, repergunte 1 vez e, na 2ª falha, pare sem gravar. Pergunta com mais de 4 opções: as 4 primeiras viram opção; as demais ficam no texto da pergunta e valem como "Other" exato.
   Sessão sem `AskUserQuestion` (headless): use o default de cada pergunta, rode o passo 6 com `--dry-run`, mostre o diff e não grave. No fechamento, diga "rode numa sessão com perguntas": consentimento não tem default.
5. **Respostas.** Escreva `<raiz>/.claude-tmp/onboarding-respostas.json`. Se o arquivo já existe, `Read` antes do `Write` (o `Write` falha sem `Read`); se o `Write` falhar, pare: nunca rode o passo 6 com o arquivo antigo. Só estas chaves, exatamente: `_previa` (o array `itens` do `detectar`, copiado sem mudar nada, na mesma ordem de chaves) e uma chave por `id` de pergunta (as 3 fixas e o nome do item de cada condicional). Chave a mais ou a menos faz o `gravar` recusar.
   ```json
   {
     "_previa": "<array itens do detectar, copiado sem mudar>",
     "politica": "sob_demanda",
     "autonomia": false,
     "perfil": "padrao",
     "versionamento": "staging"
   }
   ```
6. **Gravar.**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/onboarding.mjs" gravar --respostas "<raiz>/.claude-tmp/onboarding-respostas.json" --root "<raiz>"
   ```
   `ok:true`: mostre o `diff`, a `efetiva` (se veio: é a política que vale de fato) e cada `naoDetectado` com `trocar <item>`. `ok:false`, pelo campo `erro`:
   - `respostas_ausentes`, `respostas_invalidas`, `previa_ausente`: reescreva o arquivo 1 vez e rode de novo; na 2ª, pare com o motivo. Nada foi gravado.
   - `deteccao_mudou` (algo mudou entre a prévia e a gravação, como um servidor MCP que oscilou): volte ao passo 2 e pergunte só o que mudou ou é novo. No máximo 2 voltas; na 3ª, pare com "detecção instável: <itens>".
   - `resposta_fora_das_opcoes`: repergunte só aquele id, 1 vez.
   - `config_invalida`, `falha`: pare com o motivo. Nunca edite o `harness.config.json` à mão.
7. **Doctor** (sempre, também depois de erro). `cd "<raiz>"` e depois:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/harness-doctor.mjs" --explain
   ```
   É o doctor do plugin, da mesma versão do `onboarding.mjs`. Mostre `Nível alcançado` e as linhas `FALTA` do nível seguinte: é a distância até a esteira padrão. Com `.novo` pendente, diga em uma linha que o doctor mediu antes de aplicá-los.
8. **Fechamento.** Uma linha: `trocar <item>` serve para os 5 fatos (`tipo_repo`, `ambientes`, `planejamento`, `versionamento`, `orquestracao`), as 3 decisões (`politica`, `autonomia`, `perfil`) e o que fica fora das perguntas (`settings`, `codeowners`, `apendice`, `iniciativa`, `contenda`). Diga que falta preencher o resto do Apêndice do `AGENTS.md` (stack, fronteiras, comandos) e calibrar antes de ligar qualquer gate (`docs/harness/adocao.md §3`). Mostre `git status` e pare (R1: não commite).
   Base diferente de `main` e `gabarito.yml` criado agora: troque com `Edit` `--base origin/main` por `--base origin/<base>` sem perguntar (o arquivo é nosso) e diga em uma linha. Se ele já existia (`mantido`), só diga a linha a trocar.

## Trocar um item

Pedido "trocar `<item>`": rode os passos 1 (só a raiz) e 2 (`detectar`). Item fora das listas do passo 8: diga as listas e pare.
- `<item>` está nas `perguntas`: pergunte só ele; as outras respostas são o `default` de cada pergunta (o script garante que o default é o valor já gravado); siga os passos 5 a 7.
- `<item>` não está nas `perguntas` (fato detectado): não há o que perguntar. Diga a fonte (`itens[].fonte`) e que o valor muda quando o repo mudar. Não grave. `orquestracao`: o que se decide ali é o `perfil`; trate como `trocar perfil`, que também renova a data do modelo.
- `settings`, `codeowners`, `apendice`, `iniciativa`, `contenda`: leia `${CLAUDE_PLUGIN_ROOT}/skills/gabarito-instalar/trocar.md` e siga só a seção daquele item.

## Modo --vincular <PBI>

Registra o vínculo PBI, Epic e Iniciativa no cache local que os hooks leem. Só leitura na ferramenta, mesmo com `fluxo.escrita: true`. Raiz como no passo 1 do Fluxo.
1. Leia `harness.config.json`. Sem `fluxo.resolvidoEm`, faça o onboarding antes. Valide `<PBI>` contra `fluxo.idPadrao`; não casa: pare e diga o padrão.
2. Leia o card. Com MCP (`fluxo.mcp` ≠ null): a linha de ok de `trocar.md`, seção `iniciativa` (uma vez por sessão), depois busque pelo ID conforme `comoBuscarIniciativa` da entrada de `${CLAUDE_PLUGIN_ROOT}/reference/ferramentas-mcp.json` que casa `fluxo.mcp`; leia `titulo`, o Epic (vínculo `fluxo.vinculoPbiEpic`) e a Iniciativa do Epic (ausente: `fluxo.iniciativa.id`, marcado (b)). Card não encontrado: não grave; pergunte o ID de novo. Em `arquivos`: `Read docs/fluxo/pbis/<PBI>.md`; o Epic é a chave `vinculoPbiEpic.nome` do frontmatter; `iniciativa:` vem de `docs/fluxo/epics/<epic>.md`. Arquivo ausente: não grave; ofereça criar de `${CLAUDE_PLUGIN_ROOT}/templates/fluxo/<tipo>.md`.
3. Grave o cache (merge por chave, escrita atômica):
   ```bash
   node -e '
   const fs = require("fs"); const p = ".harness/fluxo-cache.json";
   const [pbi, epic, iniciativa, titulo] = process.argv.slice(1);
   let c = {}; try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
   const dataLocal = (d) => { const p2 = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }; // local, não toISOString() (UTC)
   c[pbi] = { epic, iniciativa, titulo, em: dataLocal(new Date()) };
   fs.mkdirSync(".harness", { recursive: true });
   fs.writeFileSync(p + ".tmp", JSON.stringify(c, null, 2) + "\n"); fs.renameSync(p + ".tmp", p);
   console.log("fluxo-cache:", pbi, "→", epic, "→", iniciativa);
   ' "<PBI>" "<EPIC>" "<INI>" "<título do card>"
   ```
4. Ledger `<fluxo.ledgerDir>/<PBI>.md`: crie com o cabeçalho de `docs/harness/referencia.md §2.3` se não existe (plano: `(b) ainda sem plano`) e acrescente a linha `VINCULO <PBI> epic=<EPIC> iniciativa=<INI> <AAAA-MM-DD> fonte=<ferramenta|arquivo>`. Criação com `flag: "wx"`: ledger existente só recebe a linha no fim.
   ```bash
   node -e '
   const fs = require("fs"); const [arq, cabecalho, linha] = process.argv.slice(1);
   fs.mkdirSync(require("path").dirname(arq), { recursive: true });
   try { fs.writeFileSync(arq, cabecalho, { flag: "wx" }); console.log("ledger criado:", arq); } catch (e) { if (e.code !== "EEXIST") throw e; }
   fs.appendFileSync(arq, linha + "\n"); console.log("ledger +", linha);
   ' "<ledgerDir>/<PBI>.md" "<cabeçalho de referencia.md §2.3, terminado em \n>" "<linha VINCULO>"
   ```
5. Com `fluxo.escrita: false` e card fora de "em execução", avise em uma linha: `ferramenta não atualizada (escrita não autorizada) — mova <PBI> à mão ou use trocar iniciativa para autorizar`. Nunca escreva.
6. Mostre `cat .harness/fluxo-cache.json` e `git status`; pare. O cache é gitignored; o ledger é versionado.

## Proibido

- Declarar nível de adoção: fica `____`; nível é medido, nunca presumido.
- Importar `docs/harness/*.md` no `CLAUDE.md`.
- Sobrescrever ou apagar arquivo do usuário (R2), nem em `tools/gabarito-gates/`: o que difere vira `<arquivo>.novo`.
- Editar `harness.config.json` ou `.claude/settings.json` à mão: só pelos scripts. Tratar exit 0 como sucesso sem ler o stdout.
- Mandar o usuário colar, copiar ou digitar comando: a skill roda o que precisa.
- Escrever na ferramenta de planejamento sem `fluxo.escrita: true` (ADR-FLX-2). `--vincular` nunca escreve.
- Chamar `mcp__*` antes do ok em uma linha, ou pôr `mcp__*` no `allowed-tools`.
- Gravar URL com token ou segredo em config, cache, ledger ou Apêndice.
- Inventar resposta em sessão sem `AskUserQuestion`: só `--dry-run`.
- Commitar (R1): mostre o `git status` e pare.

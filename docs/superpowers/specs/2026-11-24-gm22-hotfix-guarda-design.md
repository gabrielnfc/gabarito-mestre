# GM-22: hotfix da guarda (a autonomia cala só publicar; hooks do git no anel de integridade)

Iniciativa: não vinculado · Epic: não vinculado (regra da GM-19 em `2026-11-22-gm19-decisoes-dono.md:15`, D-G39, herdada pelo orquestrador: sem vínculo até o dono criar Epic; não é decisão nova do dono) · PBI: GM-22 (Bug, segurança) · Versão: 2.3.1 (D-G51) · Data: 2026-11-24 · Base: `main` 607c20d8 (plugin 2.3.0) · Branch: `hotfix/GM-22-guarda-autonomia`
PBIs conhecidos, na ordem da D-G51: **GM-22** (este hotfix, Bug) · GM-20 (Bug, 2.3.0, publicada) · GM-21 (restante do relato, depois da GM-20). _(Emenda 2026-11-24, conformidade r1 — lista de PBIs do fio condutor, como na GM-20)_

**Tipo Bug (segurança), e não Enabler nem US.** O dono escolheu "pode publicar sozinha" e a guarda passou a calar também produção de terceiro, delete em massa e integridade do harness, que o `AGENTS.md` põe acima de qualquer decisão (relato, item 1). E o hook `pre-push` do git é editável em silêncio, até por subagente (relato, item 6). É comportamento errado, com reprodução e teste que falha hoje. (c)

**STATUS: r1, rascunho do redator. Não conferida, não aprovada. Aguarda conformidade e `/gabarito-mestre:aprovar`.**
- **O que o sistema faz hoje:** com `guarda.autonomia: "orquestrador"` (respostas `trabalha` e `publica` do onboarding) e o interruptor da máquina, todo `ask` do orquestrador que não é `segredo` vira silêncio (M1, M2). `.githooks/` e `push --no-verify` estão fora de todo anel (M6 a M9).
- **O que está escrito que fará:** tudo a partir de "Decisões". Nada foi executado.
- A D-G51 abre o hotfix. Spec, merge em `main` e release 2.3.1 dependem do dono.

**Objetivo (dono, D-G51 e D-G52):** a autonomia vale só para publicar (entrega/deploy). Produção de terceiro, delete em massa, integridade do harness, push sem hooks e `.githooks/` sempre pedem ao orquestrador e são negados ao subagente, com qualquer autonomia. Correção genérica: nada do projeto consumidor no plugin (como D-G41).
**Desenho em uma frase:** a guarda marca o segmento de produção que é "publicar" e só esse pode passar calado, e só com a resposta `publica`; o anel de integridade ganha os diretórios de hooks do git e o push que pula hooks.
Fontes: `2026-11-24-gm21-decisoes-dono.md` (D-G51, D-G52); `.claude-tmp/gm21/spike-a.md` (itens 1 e 6); `.claude-tmp/gm21/relato.md` (itens 1 e 6, não versionado); `.claude-tmp/gm22/medir.mts` (medição desta redação, não versionada); `docs/aprendizados/processo-orquestrador.md` (P9, P15, "Antes do commit" item 4).

Legenda: **(a, medido)** número de execução (spike A de 2026-11-24 ou `medir.mts` nesta redação) · **(a, lido)** conferido no arquivo nesta redação · **(b)** dito por spike ou terceiro e não reconferido aqui · **(c)** escolha do redator, reversível · **(M, calculado)** conta sobre medição · **(M, a medir)** falta medir. Decisões e requisitos são (c), salvo marca. Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `.claude-tmp/`, `README.md` e `CHANGELOG.md`.

## Fatos medidos (2026-11-24)

`medir.mts` chama `decidir()` de `gates/src/decidir.ts` da worktree com config `prod {hosts: [db.prod.exemplo.com], branches: [main], mcps: [mcp__supabase_prod__]}`, nas 4 combinações orquestrador/subagente × autonomia desligada/ligada. Só leitura: nenhum arquivo do repo muda.

| # | Medição | Resultado | Fonte |
|---|---|---|---|
| M1 | Com autonomia, todo `ask` que não é `segredo` (nem teto, nem `cd` perdido) vira `silencio` + `guarda.autonomia_usada` | `gates/src/decidir.ts:107-114` | (a, lido) |
| M2 | 7 casos de produção e integridade passam de `ask` a `silencio` com autonomia: DROP e DELETE em massa em host prod, `execute_sql` em MCP prod, curl em API de terceiro declarada prod, Write em `harness.config.json`, `git push --no-verify origin main`; só `segredo` segue `ask`; subagente segue `deny` | spike A, tabela do item 1 | (b) |
| M3 | Reconfirmado: `git push origin main`, `git push --force origin main` (destrutivo), `gh pr merge 5` com a branch atual `main`, `vercel --prod`, `psql -h <host prod>`, `git pull` e `git config core.hooksPath .githooks`: orquestrador `ask` sem autonomia e `silencio` com ela; subagente `deny` nas duas | `medir.mts` | (a, medido) |
| M4 | A autonomia chega a `decidir` só com config de `origin/HEAD` (`guarda.autonomia === 'orquestrador'`) E interruptor `~/.claude/gabarito-autonomia.json` = `{"orquestrador": true}` | `gates/src/guarda.ts:121`, `:322-329`, `:671` | (a, lido) |
| M5 | `trabalha` e `publica` gravam `guarda: 'orquestrador'`; só `publica` grava `entrega: true`. Rótulo de `trabalha`: "espere o meu 'pode' para publicar" | `gates/scripts/onboarding.mjs:578-590`, `:832-834` | (a, lido) |
| M6 | `Edit .githooks/pre-push` e `Edit .husky/pre-push`: `silencio` nas 4 combinações (inclusive subagente). `.git/hooks/pre-push`: `ask`/`deny` | `medir.mts`; spike A item 6 | (a, medido) |
| M7 | Áreas de integridade: `['.harness', 'tools/gabarito-gates', '.github/workflows', '.git/refs/remotes']`, mais `.git/**`, `harness.config.json`, `.claude/settings*.json`, raiz do plugin, interruptor e `PAUSAR`; nenhuma cita hooks fora de `.git` | `gates/src/aneis.ts:490`, `:493-528` | (a, lido) |
| M8 | `git push --no-verify origin feat/x` e `git push --no-veri origin feat/x`: `silencio` nas 4 combinações (o subagente empurra sem hooks em silêncio). Com `main` só pede por ser branch prod | `medir.mts`; `grep -c no-verify src/*.ts` = 0 (spike A) | (a, medido) |
| M9 | `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin feat/x`: `silencio` nas 4. O mesmo por `git -c core.hooksPath=…`: integridade (`ask`/`deny`) | `medir.mts`; `aneis.ts:806` | (a, medido; a, lido) |
| M10 | O instalador põe `commit-msg` e `pre-push` no diretório efetivo de hooks: `git rev-parse --git-path hooks`, inclusive `.husky/` (husky 9) e `core.hooksPath` dentro do repo | `gates/scripts/instalar-hooks-git.mjs:1-22` | (a, lido) |
| M11 | Segmentos de produção que hoje pedem: host, banco, variável e projeto declarados prod; MCP por prefixo; `vercel` com `--prod`/`promote`/`rollback`; `supabase` em projeto prod; `git push` para branch prod; `gh pr merge` com a branch atual prod | `gates/src/classificar-alvo.ts:280-360`, `:438-456` | (a, lido) |
| M12 | `destrutivo` hoje: SQL `drop`/`truncate`/`delete` sem `where`; `push -f/--force/--force-with-lease/--mirror`; `rm -r`; `reset --hard`; `branch -D`; `docker rm/prune`; `supabase db reset` | `classificar-alvo.ts:62-66`, `:255-273`, `:317` | (a, lido) |
| M13 | O plugin nunca cria o interruptor; quem lê: a guarda e o doctor | `README.md:200`; `gates/scripts/harness-doctor.mjs:90`; `grep -rl 'autonomia\.json'` no plugin = só guarda, aneis, doctor e testes | (a, lido) |
| M14 | Testes que fixam o comportamento de hoje (vão mudar): `autonomia-guarda.test.ts` (12 testes), `autonomia-refs.test.ts` (6), `autonomia-processo.test.mjs` (11, processo real com `HOME` tmp); textos em `onboarding.test.mjs:810`, `:1110-1117`, `:1801` e `onboarding-texto.test.mjs:396` | `gates/test/` | (a, lido) |
| M15 | Corpus da guarda: 4 JSONL, `TOTAL_CORPUS` somado à mão; o e2e do corpus roda pelo hook real (`node gates/dist/guarda.js`, `hooks/hooks.json:9`) | `gates/test/corpus-guarda.test.ts:23`; `hooks/test/guarda-corpus-e2e.test.mjs` | (a, lido) |
| M16 | Versão 2.3.0 fixada fora de `.md` em 5 pontos | `.claude-plugin/plugin.json:4`; `gates/package.json:3`; `gates/test/package.test.mjs:49-50`; `scripts/test/texto.test.sh:279`, `:295`, `:296` | (a, lido) |

Não medido (vai a Pendências): se o git aceita `--no-veri` como abreviação de `--no-verify` no push (o parse-options do git aceita prefixo único, (b)); se o consumidor tinha o interruptor ligado (spike A, "O que a medição não responde").

## Decisões (não reabrir sem fato novo)

Do dono:
- **D-G51** Hotfix 2.3.1 já (hotfix; número 2.3.1 porque a 2.3.0 já saiu), só os itens 1 e 6 do relato; branch própria a partir de `main`, aberta em paralelo à GM-20 (hoje já publicada na 2.3.0); release por ordem do dono.
- **D-G52** A autonomia passa a valer só para entrega/deploy. Produção de terceiro, delete em massa, integridade do harness, push sem hooks (`--no-verify`) e `.githooks/` sempre `ask` para o orquestrador e `deny` para subagente, com qualquer autonomia. Sem opt-in por anel nesta versão. O texto da pergunta do onboarding diz o que a autonomia cala.

Técnicas (c), cada uma com a alternativa rejeitada:
- **DT1 "Publicar" é uma lista fechada de formas** (fail-closed), marcada por segmento no classificador: (a) `git push` para branch prod, remoto `origin` ou omitido, refspec sem `+` e sem `:` inicial, só com flags de `-u --set-upstream -q --quiet -v --verbose --follow-tags --atomic --porcelain -n --dry-run`; (b) `gh pr merge` que hoje é prod (branch atual prod); (c) `vercel`/`vc` prod com subcomando ausente, `deploy`, `redeploy`, `promote` ou `rollback`. Todo outro segmento prod é "produção de terceiro". Rejeitado: lista de negação ("tudo prod menos SQL e MCP"), porque forma nova de prod passaria calada.
- **DT2 Só a resposta `publica` cala publicar.** A guarda passa a ler também `entrega.autonomia` de `origin/HEAD`; o nível é `publica` (guarda `orquestrador` + `entrega.autonomia: true` + interruptor), `trabalha` (guarda `orquestrador` + interruptor, sem `entrega.autonomia`) ou `nenhuma`. Com `trabalha` a guarda não cala nada: o rótulo dela é "espere o meu 'pode' para publicar" (M5), e publicar é a única coisa que a D-G52 deixa calar. Rejeitado: `trabalha` calar publicar, porque contradiz o rótulo que o dono escolheu. Rejeitado: mudar `CHAVES_AUTONOMIA` (gravar `guarda: 'nenhuma'` em `trabalha`), porque toda config 2.2.2 com `trabalha` viraria "autonomia mista" no onboarding e no doctor.
- **DT3 Delete em massa = `destrutivo` do classificador (M12) num segmento prod.** Publicar destrutivo (`push --force` para `main`) não é publicar: pede. Rejeitado: detector novo de delete em massa, porque o hotfix não amplia a classificação de SQL (Fora de escopo).
- **DT4 Push sem hooks é integridade, para os dois papéis e para qualquer branch:** `git push` com token que começa por `--no-veri` (cobre `--no-verify` e as abreviações únicas que o git aceite; `--no-ve` é ambíguo com `--no-verbose` e o próprio git recusa) ou segmento `git` (qualquer subcomando) com atribuição `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` ou `GIT_CONFIG_VALUE_<n>`, que injetam `core.hooksPath` como o `-c` que já é integridade (M9). Alvo do achado: `.git/hooks`. Rejeitado: só `--no-verify` em branch prod, porque o subagente empurra hoje sem hooks na própria branch (M8). Rejeitado: ler a config dessas variáveis para decidir, porque o leitor de Bash não resolve valor (limite G9).
- **DT5 Diretórios de hooks fixos: `.githooks` e `.husky` entram em `AREAS_DIR`** (escrita e remoção pedem; leitura livre, como o resto da integridade). `.husky` entra porque o instalador grava lá (M10); é vizinho do caso (P15, "Antes do commit" item 4). Rejeitado: ler `core.hooksPath` efetivo a cada chamada, porque é 1 `git` a mais por hook sem medição de custo; vai a Fora de escopo com gatilho.
- **DT6 A escrita no interruptor pede sempre ao orquestrador.** É integridade (`aneis.ts:512`), e a D-G52 tira a integridade da autonomia. Revoga, por decisão posterior do dono, a emenda de 2026-11-12 ("ligada, o orquestrador passa no interruptor"; `decidir.ts:103-105`, `README.md:200`).
- **DT7 Compatibilidade sem migração:** config 2.2.2 com `guarda.autonomia: "orquestrador"` segue válida e lida igual pelo onboarding e pelo doctor (mesmas 4 chaves, mesma resposta); só cala menos. O aviso vai no próprio `ask`: com nível `trabalha` ou `publica`, o motivo do `ask` ao orquestrador ganha um sufixo fixo que diz o que a autonomia cala desde a 2.3.1. Rejeitado: aviso de sessão por `systemMessage`, porque soma ruído em toda chamada e não aparece no momento da surpresa. Rejeitado: migração que reescreve `harness.config.json`, porque é escrita em integridade e a config antiga não está errada.
- **DT8 `decidir(entrada, config, contexto, nivel)` com `nivel: 'nenhuma' | 'trabalha' | 'publica'`** (padrão `'nenhuma'`), no lugar do booleano. Rejeitado: dois booleanos, porque `trabalha` sem `publica` vira estado implícito.

ADRs: nenhuma. Não há exceção a regra.

## Requisitos

Regra transversal: **o subagente nunca muda** (todo caso `deny` hoje segue `deny`), **o anel `segredo` nunca muda**, e sem autonomia (`nenhuma`) toda decisão de hoje fica igual, salvo as duas ampliações de anel (REQ-HKS-1, REQ-HKS-2). Fixtures genéricas: `db.prod.exemplo.com`, `api.terceiro.exemplo`, `mcp__banco_prod__`; nenhum nome do consumidor.

### Tabela de decisão (o contrato do hotfix)

Orquestrador; o subagente é `deny` em toda linha marcada "pede" e `silencio` só onde a 2.2.2 já dava silêncio. Nível: `nenhuma` (sem config ou sem interruptor), `trabalha`, `publica` (DT2).

| Categoria (exemplo da fixture) | `nenhuma` | `trabalha` | `publica` | Subagente | Muda? |
|---|---|---|---|---|---|
| Segredo (`cat .env`) | ask | ask | ask | deny | não (só o sufixo de DT7 com nível ≠ `nenhuma`) |
| Integridade do harness (`Write harness.config.json`, `git remote add`, `git pull`, interruptor) | ask | ask | ask | deny | sim: era silêncio com autonomia |
| Hooks do git: `.githooks/**`, `.husky/**` (Edit, Write, `echo >`, `rm -rf`) | ask | ask | ask | deny | sim: era silêncio em tudo (M6) |
| Push sem hooks, qualquer branch (`git push --no-verify origin feat/x`, `GIT_CONFIG_COUNT=… git push`) | ask | ask | ask | deny | sim: era silêncio em tudo (M8, M9) |
| Produção de terceiro: host, banco, variável, projeto ou MCP prod; `vercel` prod que não publica (`env pull --prod`, `logs`); `supabase` em projeto prod | ask | ask | ask | deny | sim: era silêncio com autonomia |
| Delete em massa / destrutivo em prod (`psql … -c "DELETE FROM t"`, `git push --force origin main`, `push --delete main`, refspec `+x:main`) | ask | ask | ask | deny | sim: era silêncio com autonomia |
| Publicar (DT1): `git push origin main`, `git push -u origin main`, `gh pr merge 5` na `main`, `vercel --prod`, `vercel promote` | ask | ask | **silencio + `guarda.autonomia_usada`** | deny | sim em `trabalha` (era silêncio) |
| Comando misto: publicar + qualquer outra linha acima (`git push origin main && psql -h db.prod… -c "select 1"`) | ask | ask | ask | deny | sim: era silêncio com autonomia |
| Teto de 64 KB, `cd` perdido, exceção da guarda (Q21) | ask | ask | ask | deny | não |
| Fora de anel e de prod (`git push origin feat/x`, `ls`) | igual à 2.2.2 | igual | igual | igual | não |

### Item 6 e vizinhos: anéis

**REQ-HKS-1 `.githooks/` e `.husky/` no anel de integridade.** `gates/src/aneis.ts:490` (DT5).
- Dado `Edit`, `Write` ou `NotebookEdit` em `.githooks/pre-push`, `.githooks/commit-msg`, `.husky/pre-push`, em caminho relativo, absoluto, de worktree e com caixa trocada (`.GitHooks/pre-push`), Quando a guarda decide, Então orquestrador `ask` com `anel: 'integridade'` e subagente `deny`, com qualquer nível.
- Dado Bash `echo x > .githooks/pre-push`, `rm -rf .githooks`, `chmod -x .husky/pre-push`, `cp a .githooks/pre-push`, Então o mesmo.
- Dado `Read .githooks/pre-push` e `cat .githooks/pre-push`, Então segue sem anel (cláusula negativa: leitura livre, como o resto da integridade).
- Testes `anel-githooks-escrita-pede`, `anel-githooks-bash-pede`, `anel-githooks-leitura-livre` (novo `gates/test/anel-hooks-git.test.ts`) e casos no corpus `guarda-integridade.jsonl` (orq e sub, pelo e2e do hook real, M15). Mutações MH1-a: tirar `.githooks` de `AREAS_DIR` ⇒ cai; MH1-b: tirar `.husky` ⇒ cai; MH1-c: comparar com caixa exata ⇒ cai o caso `.GitHooks`.

**REQ-HKS-2 Push sem hooks é integridade.** Ramo `push` de `anelDeBash`, `aneis.ts:815-817`, e atribuições do segmento `git` (DT4).
- Dado `git push --no-verify origin feat/x`, `git push origin feat/x --no-verify` e `git push --no-veri origin feat/x`, Quando a guarda decide, Então orquestrador `ask` e subagente `deny`, com `anel: 'integridade'` e `alvo: '.git/hooks'`, com qualquer nível.
- Dado `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin feat/x` e `GIT_CONFIG_PARAMETERS="'core.hookspath=/dev/null'" git commit -m x`, Então o mesmo.
- Dado `git push origin feat/x`, `git push --verbose origin feat/x`, `git commit -m "--no-verify"` e `git log --grep=no-verify`, Então nada muda: subagente e orquestrador sem anel (cláusula negativa; o texto da mensagem não é flag, `semTextoLivre`).
- Dado `GIT_CONFIG_GLOBAL=/dev/null git status`, Então nada muda (só as 4 variáveis de injeção de config).
- Testes `push-sem-hooks-pede`, `push-sem-hooks-por-variavel-pede`, `push-comum-segue-livre` (mesmo arquivo novo) e casos no corpus. Mutações MH2-a: casar só `--no-verify` exato ⇒ cai `--no-veri`; MH2-b: aplicar só ao orquestrador ⇒ cai o caso do subagente; MH2-c: tirar a regra das variáveis ⇒ cai; MH2-d: procurar `no-verify` no `cru` em vez dos tokens ⇒ cai `git commit -m "--no-verify"`.

### Item 1: a autonomia cala só publicar

**REQ-PUB-1 O classificador marca "publicar" por segmento.** `gates/src/classificar-alvo.ts` (`Parcial`, `:33`; `git push` `:318-351`; `gh pr merge` `:352-360`; `vercel` `:293-303`; agregação `:421`); `gates/src/tipos.ts` (`Classificacao.publicar: boolean`).
- Dado cada forma de DT1, Quando `classificar` roda, Então `publicar: true`, `ambiente: 'prod'`, `segmentosProd` com 1 item.
- Dado `git push --force origin main`, `git push origin +main`, `git push origin :main`, `git push --delete origin main`, `git push --all origin`, `git push -o x origin main`, `git push outro main`, `vercel env pull --prod`, `vercel logs --prod`, `supabase db push --project-ref <prod>`, `psql -h db.prod.exemplo.com -c "select 1"` e MCP prod, Então `publicar: false`.
- Dado comando com 2 segmentos prod, um publicar e outro não, Então `publicar: false` (todo segmento prod precisa ser publicar).
- Dado classificação sem prod ou com anel, Então `publicar: false`.
- Teste `classificar-publicar-formas` (novo `gates/test/classificar-publicar.test.ts`), com asserção do campo `publicar` em cada caso positivo e negativo (P15). Mutações MP1-a: aceitar qualquer flag no push ⇒ cai `--force`/`-o`; MP1-b: aceitar refspec com `+` ⇒ cai; MP1-c: "algum segmento publicar" em vez de "todos" ⇒ cai o misto; MP1-d: `vercel env pull --prod` como publicar ⇒ cai.

**REQ-PUB-2 Só `publica` cala, e só publicar.** `gates/src/decidir.ts:98-114`; `gates/src/guarda.ts:33`, `:110-128` (`entregaAutonomia` de `origin/HEAD`), `:671` (nível) (DT2, DT3, DT6, DT8).
- Dado cada linha da tabela de decisão, Quando `decidir(…, nivel)` roda nos 3 níveis e nos 2 papéis, Então a faixa é a da tabela. Na linha "publicar" com `publica`: `faixa: 'silencio'`, `permissionDecision` ausente, `evento.tipo: 'guarda.autonomia_usada'`, `evento.dados` só com `{acao, alvo, ambiente}` e sem o comando.
- Dado `trabalha` ou `nenhuma` na linha "publicar", Então `ask` com `evento.tipo: 'guarda.ask'`.
- Dado o processo real (`node gates/dist/guarda.js` com `HOME` tmp e repo de `montar()`), Então: config `{guarda.autonomia: orquestrador, entrega.autonomia: true}` em `origin/HEAD` + interruptor ⇒ `git push origin main` sem decisão e com `guarda.autonomia_usada` no diário; a mesma config com `Write harness.config.json`, `git push --no-verify origin main`, `Edit .githooks/pre-push`, `psql -h db.prod.exemplo.com -c "DELETE FROM t"`, `curl https://api.terceiro.exemplo/x` e MCP prod ⇒ `ask`; `entrega.autonomia: false` em `origin/HEAD` (com `true` só na árvore local) ⇒ `git push origin main` `ask`; sem interruptor ⇒ `ask`; subagente ⇒ `deny` em todos (P9: atravessa `lerGuarda`, `decidir` e o diário pelo hook real).
- Cláusulas negativas com troca de valor (P15): para cada linha que não é "publicar", a decisão com `publica` é igual à decisão com `nenhuma` (mesma faixa e mesmo tipo de evento); para o subagente, igual nos 3 níveis.
- Testes `tabela-decisao-autonomia` (novo `gates/test/autonomia-tabela.test.ts`, uma linha por categoria e vizinhos), `autonomia-so-publica-cala`, `autonomia-trabalha-nao-cala-publicar`, `autonomia-publica-nao-cala-terceiro-delete-integridade`; `autonomia-guarda.test.ts`, `autonomia-refs.test.ts` e `autonomia-processo.test.mjs` reescritos para o contrato novo (os casos de integridade que esperavam `silencio` passam a `ask`; nenhum teste apagado sem o caso equivalente no arquivo novo). Mutações MP2-a: voltar a calar todo `ask` não segredo (o `decidir` de hoje) ⇒ cai a tabela; MP2-b: calar publicar com `trabalha` ⇒ cai; MP2-c: calar publicar destrutivo ⇒ cai `push --force`; MP2-d: ler `entrega.autonomia` da árvore local ⇒ cai o caso de processo; MP2-e: calar a escrita no interruptor com `publica` ⇒ cai; MP2-f: subagente com `publica` passa ⇒ cai.

**REQ-PUB-3 O `ask` diz o que a autonomia cala (compatibilidade, DT7).**
- Dado nível `trabalha` ou `publica` e um `ask` ao orquestrador, Então `motivo` termina com o texto fixo ` · autonomia (2.3.1): cala só publicar (push e merge na branch de produção, deploy), e só com a resposta "publica"; produção de terceiro, delete em massa, harness e push sem hooks sempre perguntam`.
- Dado nível `nenhuma`, Então o `motivo` é byte a byte o de hoje. Dado subagente (`deny`), Então o `motivo` é o de hoje com qualquer nível.
- Dado config 2.2.2 com `trabalha` ou `publica`, Então o onboarding e o doctor leem a mesma resposta (sem "autonomia mista") e nada é regravado.
- Testes `motivo-avisa-com-autonomia`, `motivo-igual-sem-autonomia`, `motivo-subagente-igual` (em `autonomia-tabela.test.ts`) e `config-222-segue-valida` (onboarding: `autonomiaDaConfig` das 3 configs de `CHAVES_AUTONOMIA` devolve a mesma resposta; `CHAVES_AUTONOMIA` com `deepEqual` igual ao de hoje). Mutações MP3-a: sufixo com nível `nenhuma` ⇒ cai; MP3-b: sufixo no `deny` ⇒ cai; MP3-c: mudar `CHAVES_AUTONOMIA.trabalha.guarda` ⇒ cai `config-222-segue-valida`.

### Texto do onboarding e documentação

**REQ-TXT-1 A pergunta diz o que a autonomia cala.** `gates/scripts/onboarding.mjs:656-670` (pergunta), `:762` (prévia); `skills/gabarito-instalar/trocar.md:19`; `README.md:194-200`.
- Dado o onboarding sem config mista, Então o `texto` cru da pergunta `autonomia` é: `Posso trabalhar e publicar sozinha? Sempre pergunto antes de tocar dados no ar, apagar em massa, mexer ou pular travas.` (119 caracteres; o glossário acrescenta a explicação de "publicar", 158 na saída de `perguntas()`). Com config mista: `A autonomia está mista: como devo trabalhar? Nada muda sem a sua escolha. Sempre pergunto antes de tocar dados no ar, apagar em massa, mexer ou pular travas.` (157). Valem o teto de 160 e a lista proibida de REQ-ONB-2 da GM-14 (`2026-11-11-gm14-clareza-design.md:67-68`): sem hook, merge, branch nem deploy. README e `trocar.md` mantêm a regra completa com os termos técnicos. _(Emenda 2026-11-26, Sombra T4 216e6d42: o literal anterior tinha ~372 caracteres e 4 termos proibidos)_
- Dado a prévia, Então o item passa de `autonomia em produção` para `autonomia para publicar`, com os mesmos valores (`não`, `trabalha sozinha, espera o seu ok para publicar`, `sim`, `autonomia mista: preciso da sua escolha`).
- Os 3 rótulos (`valor` e `rotulo`) não mudam (a skill os mostra literais, `SKILL.md:42`).
- `trocar.md:19` e `README.md:194-200` descrevem a regra nova (tabela resumida, DT2, DT6) e tiram "com a autonomia ligada o orquestrador passa no interruptor".
- Testes `onboarding-pergunta-autonomia-diz-o-que-cala` (fixa o texto inteiro devolvido por `perguntas()`, já com o glossário, nas 2 variantes, e confere ≤ 160 e sem termo proibido), ajuste de `onboarding.test.mjs:1110-1117`, `:1801` e `onboarding-texto.test.mjs:396` para o nome novo; `rotulos-autonomia-iguais` (cláusula negativa: os 3 rótulos byte a byte). Mutações MT1-a: tirar a frase "Sempre pergunto…" ⇒ cai; MT1-b: trocar um rótulo ⇒ cai `rotulos-autonomia-iguais`.

### Versão

**REQ-VRS-1 2.3.1.** `.claude-plugin/plugin.json:4`, `gates/package.json:3`, `gates/test/package.test.mjs:49-50`, `scripts/test/texto.test.sh:279`, `:295`, `:296`; `CHANGELOG.md`.
- Dado a entrega, Então as 2 versões são `2.3.1`, `[2.3.1]` datada fica acima da `[2.3.0]`, e `git grep -n "2\.3\.0" -- ':!*.md' ':!.harness'` só acha as checagens do CHANGELOG `[2.3.0]` (`texto.test.sh:295` e `:296`; as demais ocorrências de `2.3.0` fora de `.md` são comentários e fixtures de outras entregas, `painel-medir.test.mjs:1153,1155,1234`, que a task não toca). Os pontos fixados a mudar são `plugin.json:4`, `gates/package.json:3`, `package.test.mjs:49-50` e `texto.test.sh:279`; em `:295` e `:296` a `[2.3.1]` entra acima e o limite inferior do trecho passa a ser `[2.3.0]`.
- Mutação MV1-a: versão só num manifesto ⇒ cai `package.test.mjs` e `texto.test.sh`.

Permissão: muda a guarda (2 anéis maiores, autonomia menor). Nenhum caminho de escrita novo. Nenhum REQ amplia o que passa calado: toda mudança troca `silencio` por `ask`/`deny`.

## Testes e gates

| REQ | Task | Prova | Mutações |
|---|---|---|---|
| REQ-HKS-1, 2 | T1 | 6 testes + casos no corpus + casos na lista de `hooks/test/guarda-corpus-e2e.test.mjs` (e2e pelo hook real roda lista fixa; arquivo no escopo da T1) _(Emenda 2026-11-26, review T1 r1 MAJOR-2)_ | MH1-a a c, MH2-a a d |
| REQ-PUB-1 | T2 | 1 teste com casos positivos e negativos | MP1-a a d |
| REQ-PUB-2, 3 | T3 | tabela + 3 testes de nível + processo real + 3 de motivo + 3 arquivos reescritos | MP2-a a f, MP3-a, b |
| REQ-PUB-3 (compat), REQ-TXT-1 | T4 | `config-222-segue-valida` + 2 de texto + ajustes | MP3-c, MT1-a, b |
| REQ-VRS-1 | T5 | testes de versão | MV1-a |

P9 (camadas): REQ-HKS-1/2 cruzam `aneis.ts` e o hook pelo corpus e2e; REQ-PUB-2 cruza `classificar-alvo.ts` (T2), `decidir.ts` e `guarda.ts` pelo processo real em `autonomia-processo.test.mjs`.
Fumaça (orquestrador, antes do PR): rodar `medir.mts` contra a worktree com o código novo e conferir a tabela inteira; colar a saída no PR.

## CHANGELOG [2.3.1] previsto

```
## [2.3.1] — <data>

Hotfix de segurança da guarda (GM-22, D-G51, D-G52).

### Corrigido
- **A autonomia cala só publicar.** Com a resposta "publica" (e o interruptor da máquina), passa calado só o pedido de publicar: push e merge na branch de produção e deploy. Produção de terceiro, delete em massa (inclusive `push --force`), arquivos do harness, hooks do git e push sem hooks sempre perguntam ao orquestrador e são negados ao subagente. Com "trabalha", a guarda não cala nada.
- **Hooks do git no anel de integridade.** Escrever ou apagar em `.githooks/` e `.husky/` pede ao orquestrador e é negado ao subagente.
- **Push sem hooks** (`--no-verify` e as variáveis `GIT_CONFIG_*` que injetam `core.hooksPath`) pede ao orquestrador e é negado ao subagente, em qualquer branch.

### Mudado
- A pergunta de autonomia do onboarding diz o que cada resposta cala; a prévia diz "autonomia para publicar".
- A escrita no interruptor (`~/.claude/gabarito-autonomia.json`) pede sempre, mesmo com a autonomia ligada.
- Config da 2.2.2 com `guarda.autonomia: "orquestrador"` segue válida e só cala menos; o `ask` avisa o que a autonomia cala.

### Limites declarados
- O diretório de hooks é fixo (`.githooks`, `.husky`, `.git/hooks`); outro `core.hooksPath` não é protegido.
- `export GIT_CONFIG_…` em comando anterior e `git commit --no-verify` não são vistos.
```

## Rollout

1. Confirmação da Sombra à DT2 (P1 abaixo). Motivo: é a leitura do redator sobre `trabalha`.
2. Aprovação da spec. Motivo: a D-G51 não aprova.
3. Orquestrador na branch `hotfix/GM-22-guarda-autonomia` antes do `abrir`. Motivo: o `abrir` grava a branch atual como base (processo, "Orquestrador na branch da entrega").
4. Ondas: T1, T2, T4 em paralelo; T3 depois de T1 e T2; T5 no fim. Motivo: T3 testa a tabela inteira, que precisa dos anéis da T1 e do campo `publicar` da T2; T4 não divide arquivo com ninguém; versão só com o código pronto.
5. PR `hotfix/GM-22-guarda-autonomia ⇒ main`. Motivo: D-G51 (base `main` 607c20d8, a 2.3.0 já publicada; o repo tem `delete_branch_on_merge=true`, então a branch some no merge). Merge, tag `gabarito-mestre--v2.3.1` e release só por ordem do dono (R1).
6. Depois da release: sincronizar `next` com `main` (merge de `main` em `next`). Motivo: a GM-20 já está em `main` (2.3.0), então `next` só precisa receber o hotfix; não há emenda do teste de ordem da GM-20. Plugin local por `claude plugin update --scope`. _(Emenda 2026-11-24, conformidade r1 — motivo de cada passo)_

Janela: quem usa `trabalha` ou `publica` vê perguntas que a 2.2.2 calava; nenhuma pergunta some. Volta: reverter o merge; a config não muda.

## Fora de escopo (dono: Gabriel)

| Item | Motivo | Gatilho |
|---|---|---|
| Opt-in nominal por anel na autonomia | D-G52 | dono pedir |
| `core.hooksPath` efetivo, fora de `.githooks`/`.husky` | DT5; custo de 1 `git` por chamada não medido | projeto com outro diretório de hooks |
| `git commit --no-verify` (`-n`) e `export GIT_CONFIG_*` em segmento anterior | D-G52 cita só push; o leitor não segue `export` | dono pedir, ou commit-msg virar gate de segurança |
| `supabase db push`/`functions deploy` em prod como publicar | DT1: escreve no banco de produção | dono pedir publicar migração calado |
| MCP prod reconhecido por `project_id` em `projetos`; DELETE em massa em host não declarado sai `log` | achados extras do spike A, não são itens 1 e 6 | GM-21 |
| Itens 2, 3, 4, 5, 7 a 12 do relato | D-G51 | GM-21, depois da GM-20 |

## Pendências

- **P1 RESPONDIDA pelo dono (D-G54, 2026-11-24): DT2 confirmada; DT6 confirmada pela D-G53.** _(Emenda 2026-11-24, D-G53/D-G54)_ Texto original: **P1 (Sombra) DT2:** `trabalha` não cala nada (nem publicar). Fonte: rótulo de `trabalha` (M5) e D-G52. Desbloqueia a T3.
- **(M, a medir)** O git aceita `--no-veri` como `--no-verify` no push (T1, passo 0, em repo tmp fora do repositório). Se não aceitar, a regra de prefixo segue (fail-closed) e o teste do caso abreviado fica como está.
- **(M, a medir)** Comandos de rotina do orquestrador que passam a pedir com autonomia (ex.: `git pull`, `git fetch` com refspec): T3 conta no diário deste repo os `guarda.autonomia_usada` por `anel`/`alvo` e leva o número ao relato da task (informativo; a D-G52 já decidiu).

_(Rebase 2026-11-26: base `main` 607c20d8 = 2.3.0; versão 2.2.3 ⇒ 2.3.1 — cabeçalho, M16, D-G51, DT7, sufixo do `ask` (REQ), REQ-VRS-1, CHANGELOG previsto `[2.3.1]` acima de `[2.3.0]`, tag `gabarito-mestre--v2.3.1`, passos finais 5 e 6; `texto.test.sh:296` entrou em M16/REQ-VRS-1)_

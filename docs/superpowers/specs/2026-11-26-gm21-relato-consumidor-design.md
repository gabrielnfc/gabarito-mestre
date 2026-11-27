# GM-21: o resto do relato do repo consumidor (encerramento, plano antigo, contagem, herança e painel)

Iniciativa: não vinculado · Epic: não vinculado (regra da GM-19 em `2026-11-22-gm19-decisoes-dono.md:15`, D-G39, herdada pelo orquestrador) · PBI: GM-21 (Bug, com as melhorias 8, 9 e 12) · Versão: 2.4.0 (D-G56) · Data: 2026-11-26 · Base: `next` e2b5e032 (plugin 2.3.1) · Branch: `enabler/GM-21-relato-consumidor`
PBIs conhecidos, na ordem da D-G49 e da D-G51: GM-20 (2.3.0, publicada) · GM-22 (2.3.1, publicada: itens 1 e 6) · **GM-21** (este PBI: o resto do relato).

**Tipo Bug, e não Enabler nem US.** Os itens 2, 3, 4, 5 e 11 são comportamento errado com reprodução: o painel encerra a entrega errada e trava o loop, o plano antigo só quebra depois do review, a suíte vitest verde é reprovada, o cartão mostra o modelo errado. O item 7 é contrato prometido (D-G50) e não entregue. Os itens 8, 9 e 12 são melhorias pequenas no mesmo painel e entram juntos porque mexem nos mesmos arquivos. (c)

**STATUS: r2, rascunho do redator depois do review adversarial r1 (REPROVADO, 1 BLOCKER, 5 MAJOR, 14 MINOR; `.claude-tmp/gm21/review-spec-r1.md`). Não aprovada. Aguarda review r2, conformidade e `/gabarito-mestre:aprovar`.**
- **O que o sistema faz hoje:** a tabela "Fatos medidos".
- **O que está escrito que fará:** tudo a partir de "Decisões". Nada foi executado.

**Objetivo (dono, D-G49 e D-G50):** corrigir o resto do relato do consumidor "passada" (upgrade 2.1.0-alpha.1 ⇒ 2.2.2): itens 2, 3, 4, 5, 7, 8, 9, 10, 11 e 12. Os itens 1 e 6 já saíram na 2.3.1 (GM-22). Correção genérica: nada do projeto consumidor no plugin (D-G41, D-G49).
**Desenho em uma frase:** o painel só encerra a entrega com o plano fechado e por PR posterior à última integração; o loop confere o plano e as suítes antes de abrir a task; o gate conta vitest e jest e roda o teste afetado sozinho; o `herdar --tasks` importa trabalho antigo com origem num evento próprio; o painel separa herdado de medido e pede amostra para prever.
Fontes: `2026-11-24-gm21-decisoes-dono.md` (D-G49, D-G50, D-G56, D-G57); `.claude-tmp/gm21/relato.md` (12 itens, não versionado); `.claude-tmp/gm21/spike-a.md` (medições de 2026-11-24 sobre `enabler/GM-20-adocao-tardia`, não versionado); `$(getconf DARWIN_USER_TEMP_DIR)gm21-spec/medir.mjs` (medição desta redação, não versionada); `docs/backlog.md:122`; `docs/aprendizados/processo-orquestrador.md` (P9, P15).

Legenda: **(a, medido)** número de execução (`medir.mjs` nesta redação sobre `gates/dist` de `next` e2b5e032, ou o spike A quando dito) · **(a, lido)** conferido no arquivo nesta redação · **(b)** dito por spike, documentação ou terceiro e não reconferido aqui · **(c)** escolha do redator, reversível · **(M, a medir)** falta medir. Decisões e requisitos são (c), salvo marca. Caminhos relativos a `plugins/gabarito-mestre/`, salvo `docs/`, `.claude-tmp/`, `.harness/` e `CHANGELOG.md`.

## Fatos medidos (2026-11-26)

`medir.mjs` importa `gates/dist/plano.js`, `trilha.js`, `painel.js`, `lib/config.mjs` e `scripts/gate-task.mjs` e chama as funções puras. Só leitura: nenhum arquivo do repo muda.

| # | Medição | Resultado | Fonte |
|---|---|---|---|
| M1 | `idDaBranch('enabler/PBI-14-plano', 'PBI-\d+')` | `PBI-14`: a branch do plano é "da entrega" | `medir.mjs`; `gates/src/trilha.ts:56-64` | (a, medido) |
| M2 | `podeEncerrar([], 'PBI-14', pr, 'main')` com PR mergeado em `main`: `via: 'titulo'` com head da branch do plano, `via: 'titulo'` com head qualquer, `via: 'head'` com a branch do plano | `true` nos 3 | `medir.mjs`; `trilha.ts:174-182` | (a, medido) |
| M3 | O encerramento não olha o plano nem as integrações: só base, estado, `via` e reabertura. A busca por título (`--search "<ID> in:title"`) e `casaTitulo` aceitam qualquer PR mergeado na base com o ID no prefixo ou como único ID | `scripts/painel-medir.mjs:337-342`, `:353-355`, `:394`, `:454` | (a, lido) |
| M4 | Com `entrega.encerrada` o estado é só ele; o loop recusa `entrega_publicada` | `gates/src/guarda.ts:267`; `scripts/loop.mjs:139-144` | (a, lido) |
| M4b | **Sem** `entrega.encerrada` vale a regra antiga de `entregaPublicada`: a entrega cujo último PR está mergeado e nenhum aberto não é identificada pela trilha com gh `ok` (FIEL-1 b), e a chamada com gh `falhou` a devolve ⇒ publicada. O `plano.json` só entra como "tem plano" (`tasks: []`), nunca pelas tasks abertas. Medido: diário com `plano.json` de T1 e T2, só o fato `pr` #10 mergeado (`via: 'titulo'`, head `docs/PBI-7-plano`, base `main`), sem `entrega.encerrada` ⇒ `entregaPublicada(…, SESSAO_QUALQUER)` = `true`, sessão `s2` = `true`; com um fato `pr` #11 aberto ⇒ `false` | `guarda.ts:279-300`; `trilha.ts:282-288`; `.claude-tmp/gm21/rv-publicada.mjs` (script do revisor r1, rodado de novo nesta r2) | (a, medido) |
| M5 | Spike A: 4 de 7 cenários com o PR do plano encerram a entrega (título com e sem prefixo, sessão na branch do plano, base `next`); PR nova da entrega depois não destrava | spike A, tabela do item 2 | (b) |
| M6 | `resolverModelo({perfil:'padrao'}, 'revisor_final')` = `fable`; `economia` = `opus`; papel `orquestrador` lança `papel desconhecido` | `medir.mjs`; `lib/config.mjs:199-206`, `:249-250` | (a, medido) |
| M7 | O onboarding grava `orquestracao.modelo.alias` pelo papel `revisor_final`, e a prévia repete a regra; cartão e doctor exibem esse alias | `scripts/onboarding.mjs:779-788`, `:865`; `scripts/cartao-sessao.mjs:326`, `:662`; `scripts/harness-doctor.mjs:872-873` | (a, lido) |
| M8 | `validarPlano` aceita `mutacoes: "trocar > por >= …"` (texto livre) e `teste_afetado: "tests/a.test.ts"` (caminho) com `ok: true` e preserva o texto | `medir.mjs`; `gates/src/plano.ts:128-129` | (a, medido) |
| M9 | `carregarMutacoes` exige o caminho de um JSON em lista não vazia, e o único chamador está no `integrar`, depois das checagens de review aprovado; `abrir` e `proxima` não leem `mutacoes`, `teste_afetado` nem `gates.suites` | `loop.mjs:932-947`, `:1052-1099`, `:761-833`, `:1466-1507` | (a, lido) |
| M10 | `teste_afetado` vira suíte `{nome:'teste_afetado', cmd}` somada a `gates.suites`; sem `gates.suites` a função devolve `undefined` e o gate falha "nenhuma suíte declarada" | `loop.mjs:955-967`; `scripts/gate-task.mjs:281` | (a, lido) |
| M11 | Nenhum `onboarding*.mjs`, nem `scripts/instalar.sh`, nem `templates/harness.config.json` cita `suites` (0 ocorrências); o doctor também não | `grep -c suites` | (a, medido) |
| M12 | O formato das tasks do `plano.json` (`mutacoes`, `teste_afetado`) não está documentado em nenhum `.md` do plugin (`skills/`, `reference/`) | `grep -rn "teste_afetado\|arquivo, de, para" --include=*.md` = 0 | (a, medido) |
| M13 | Uso neste repo: das 8 entregas com `plano.json`, só a GM-16 usa `mutacoes` (6 de 10 tasks, caminho `.harness/entregas/GM-16/mutacoes/T1.json`) e `teste_afetado` (7 de 10, comando `cd … && node --test …`) | `.harness/entregas/*/plano.json` | (a, medido) |
| M14 | O gate só conta `^\s*(ℹ|#) (pass|tests|fail) N`. Texto do vitest 5.1.0 (spike A): ` Test Files  2 passed (2)` e `      Tests  1 failed | 3 passed | 1 skipped (5)`; com esse texto, `falhas().declaradas` = `null` e a contagem de `pass` = `null`. Jest (`Tests:       1 failed, 3 passed, 4 total`): `null` | `medir.mjs`; `gate-task.mjs:105-121`, `:291-300` | (a, medido) texto vitest (b) do spike; jest (b) documentação |
| M15 | As suítes não-mod rodam em paralelo (`Promise.all`); só `mod-test.sh` vai depois; a medição A4 da base também roda tudo em paralelo | `gate-task.mjs:283-288`, `:393` | (a, lido) |
| M16 | Este repo declara 3 suítes (`gates`, `hooks`, `mod-e-texto` com `semContagem`) | `harness.config.json` (raiz) | (a, medido) |
| M17 | `ritmoDasAnteriores` com 1 task integrada em 1 h devolve `3600`; a previsão do projeto só diz "sem ritmo" com ritmo `null` | `medir.mjs`; `gates/src/painel.ts:353-370`; `gates/src/projeto.ts:429-431` | (a, medido) |
| M18 | O DEPENDE lista "revisar e aceitar o pedido de revisão #N" para todo PR aberto da entrega; `CAMPOS_PR` não pede `isDraft`; o `configLote` (com `autonomiaEntrega`) já chega ao `painel.ts` | `gates/src/depende.ts:63-74`, `:297-299`; `painel-medir.mjs:35`; `painel.ts:1187-1192`; `loop.mjs:1519` | (a, lido) |
| M19 | O título da entrega no painel é o 1º `# ` do arquivo de `plano.spec`; o título do card (1º `# ` depois do frontmatter) só aparece na visão de projeto | `scripts/painel.mjs:453-459`, `:775-782`; `projeto.ts:151-152`; cards lidos de `fluxo.mapeamento.FL1` em `painel.mjs:323-330` | (a, lido) |
| M20 | **O `herdar` não é mais stub** (o relato diz que é): a GM-20 T10 o implementou como passo de adoção (`fluxo.planosLegados`, `fluxo.status.terminais`); a importação de tasks (`task.herdada`) não existe. `TIPOS_EVENTO` não tem `task.herdada`. A sessão `herdar` já é reservada no `anotar` | `scripts/onboarding-herdar.mjs:1-11`; `gates/src/formas.ts:13-21`; `loop.mjs:2032` | (a, lido) |
| M21 | O painel do projeto conta só `task.integrada` (e estima como feitas as restantes de PBI com card "feito"); `tasks` = `{total, integradas, estimadas, restantes, fora}` | `projeto.ts:365-392` | (a, lido) |
| M22 | A mutação do gate roda `teste` (comando de shell) depois de trocar `de` por `para` no `arquivo`; o `teste` pode ser composto | `gate-task.mjs:322-365` | (a, lido) |
| M23 | Versão 2.3.1 fixada fora de `.md`: `.claude-plugin/plugin.json:4`, `gates/package.json:3`, `gates/test/package.test.mjs:49-50`, `scripts/test/texto.test.sh:279`, `:295`, `:297`; o sufixo `autonomia (2.3.1)` de `decidir.ts:106` é texto de regra e fica | `git grep -n "2\.3\.1"` | (a, medido) |

**Fatos do spike A que o código atual desmente ou deslocou** (só leitura, nesta redação):
- Item 7: o relato diz que `herdar` é stub; não é mais (M20). Fica só o `--tasks`.
- Linhas que mudaram depois da GM-20/GM-22 (o conteúdo segue igual): `carregarMutacoes` `:932-947` (spike: `:854-868`/`:920-933`), seu chamador `:1099` (spike: `:1087`), `suitesDaTask` `:955-967` (spike: `:943-951`), `abrir` `:761` (spike: `:749`), "sem prova" `gate-task.mjs:300` (spike: `:294`), `guarda.ts:267` (spike: `:265`), `loop.mjs:143` (spike: `:140`), alias `onboarding.mjs:865` (spike: `:862`), previsão `projeto.ts:431` (spike: `:388`), `tituloDe` `painel.mjs:453` e uso `:778` (spike: `:416-422`, `:724`), título do card `projeto.ts:151-152` (spike: `:128`).
- Nenhum veredito do spike foi refutado.

Não medido (vai a Pendências): jest real (não instalado); `gh pr list --json isDraft` e a busca do GitHub (documentação, (b)); o tempo do `integrar` deste repo com o `teste_afetado` em série.

## Decisões (não reabrir sem fato novo)

Do dono:
- **D-G49** GM-21 depois da GM-20, com o relato inteiro menos o que a GM-22 levou; correção genérica.
- **D-G50** Importação de tasks com origem como `herdar --tasks`, num evento próprio (ex.: `task.herdada`), sem `task.integrada` falso.
- **D-G56** Versão 2.4.0 (minor: `herdar --tasks`/`task.herdada`, contagem vitest/jest, validação do plano antes do despacho). Release e `next ⇒ main` sob ordem do dono.
- **D-G57** Os falsos negativos da guarda do backlog com destino GM-21 ficam fora (PBI próprio depois). Ordem: primeiro o que trava o loop (itens 2, 4, 5 e backlog l.122), depois os menores (3, 7, 8, 9, 10, 11, 12). Item 10 na forma mínima (orientação na doc), que é a DT14.

Técnicas (c), cada uma com a alternativa rejeitada:
- **DT1 Plano aberto não encerra nem publica.** Uma regra única, `planoAberto(tasks, eventos)` em `trilha.ts` (task nem integrada nem fora `adiada`/`cortada`, pela mesma `estadosPorTask` de `integradas`, `trilha.ts:233-239`), vale em dois lugares: (1) `podeEncerrar` não encerra por PR, por nenhuma `via`; (2) a regra antiga de `entregaPublicada` (`guarda.ts:279-300`, a regra única do painel, da guarda, do cartão e do Stop) devolve `false` quando o `plano.json` válido da entrega tem task aberta (M4b). Com `entrega.encerrada` do dono (`via: 'dono'`) nada muda: o encerramento manda. O painel grava o fato `pr` como hoje (o PR segue na trilha e no DEPENDE) e devolve, só no `painel.mjs estado` e 1 vez por PR e sessão, o aviso `PR #<n> mergeado não encerra a <ID>: tasks abertas <T…>; se a entrega acabou, /gabarito-mestre:encerrar <ID> <n>`. Entrega sem `plano.json` segue as regras de hoje. **Muda a guarda** (o que ela dá por publicada); por isso está na P2. Rejeitado: não gravar o fato `pr` que não encerra, porque esconde o PR da trilha e do DEPENDE. Rejeitado: reconhecer "branch de plano" pelo sufixo `-plano`, porque é convenção do consumidor, não do plugin (D-G41). Rejeitado: só tirar a `via: 'titulo'`, porque a virada `next ⇒ main` deste repo encerra por título (head `next`, D-G14).
- **DT2 Com integração, o PR que encerra é posterior a ela.** Entrega com ao menos 1 `task.integrada`: só encerra o PR com `mergeado_em` maior ou igual ao `ts` da última `task.integrada` menos 5 min (margem de relógio entre a máquina e o GitHub). Fecha o caso "plano fechado depois, PR do plano antigo encerra com o número errado". Rejeitado: provar pelo sha (`gh pr list --search <sha>`), porque é 1 chamada `gh` a mais por medição e a busca do GitHub não foi medida aqui (b); fica a Fora de escopo com gatilho.
- **DT3 Papel `orquestrador` próprio nos perfis**, `opus` em `economia`, `padrao` e `qualidade`; `orquestracao.modelos.orquestrador` explícito vence. O alias vem dele, não de `revisor_final`. Rejeitado: ler `model` de `.claude/settings.json`, porque é arquivo de outra ferramenta, pode faltar, e a guarda trata `.claude/settings*.json` como integridade.
- **DT4 Plano executável conferido antes de despachar.** Uma função só (`conferirExecutavel`, em `gates/scripts/plano-executavel.mjs`) confere, por task não integrada nem fora: `mutacoes` é caminho relativo dentro da raiz, arquivo JSON em lista não vazia, cada item com `nome`, `arquivo`, `de`, `para`, `teste` em texto (e `cwd` opcional em texto, `gate-task.mjs:333`), e `arquivo` dentro do escopo real da task, o mesmo do gate: `escopo(wt, escopoDaTask(plano, projetarEmendas(eventos), task))` (`loop.mjs:949-953`, `:1125`), com diretório casando por prefixo; `teste_afetado` não é caminho de arquivo existente sem bit de execução; `gates.suites` passa em `normalizarSuites` do gate (exportada; aceita texto ou `{nome?, cmd, cwd?, semContagem?, serial?}`, `gate-task.mjs:142-152`) e dá ao menos 1 suíte. O `abrir <T>` recusa com `plano_nao_executavel` e os problemas **dessa task e da config**, antes de criar worktree. O `proxima` tira de `acao.itens` toda task com problema e põe os problemas em `aviso`; se todas saem, a ação vira `{tipo:'esperar', motivo:'plano_nao_executavel'}`. O `proximaAcao` puro (e o painel) não muda: o painel segue mostrando a task como próxima, e o aviso do `proxima` diz por que ela não foi despachada. `de` presente no arquivo **não** é conferido: o código ainda não existe antes da task. Rejeitado: pôr a checagem em `validarPlano`, porque é pura (sem disco) e é usada pelo painel e pelo doctor a cada leitura. Rejeitado: migrador que reescreve o `plano.json`, porque o texto livre não tem tradução segura.
- **DT5 `gates.suites` detectado, não perguntado.** O onboarding propõe `[{nome:'unit', cmd:'npm test'}]` quando `package.json` tem `scripts.test` que não é o placeholder do `npm init` (texto contendo `no test specified`) e a config não tem `gates.suites`; aparece na prévia e grava com o resto. Sem `scripts.test`, nada é gravado e o doctor avisa. Rejeitado: pergunta nova, porque o dono já achou o onboarding longo (memória "Onboarding: refatorar") e o teto de perguntas vale.
- **DT6 Contagem de vitest e jest pelo resumo de texto.** Além de `ℹ|# tests|pass|fail N`, o gate lê, sem cores ANSI, a linha `Tests  [N failed | ]N passed[ | N skipped] (N)` do vitest e `Tests:  [N failed, ]N passed, N total` do jest; `Test Files`/`Test Suites` não contam. Cada parte (`N failed`, `N passed`, `N skipped`, `N todo`) é opcional e em qualquer ordem: `Tests  3 failed (3)` dá `fail 3, pass 0`; `Tests: 1 skipped, 3 passed, 4 total` dá `pass 3`. Pulados não contam como prova. "RED conhecido" (rc 1 com nomes) segue só para node/TAP. Outros runners sem resumo reconhecido (mocha etc.) seguem em "sem prova" ou `semContagem`; declarado na [2.4.0]. Rejeitado: JSON de resultado por `--outputFile`, porque pede campo novo na suíte e arquivo temporário na worktree, que o passo 5a do gate reprovaria como árvore alterada.
- **DT7 `teste_afetado` roda sozinho, depois das suítes; suíte pode pedir `serial: true`.** O gate roda em paralelo só as suítes sem `serial` e não-mod; depois, em série e na ordem declarada, as `serial: true`, o `mod-test.sh` e por último o `teste_afetado`. A mesma regra vale na medição A4 da base. Rejeitado: tudo em série, porque este repo tem 3 suítes declaradas (M16) e o custo não foi medido.
- **DT8 `task.herdada` é evento novo fora de `TIPOS_DE_TASK`.** `dados: {task, origem: {tipo: 'pr'|'commit'|'ledger', ref}, titulo?}`, gravado pelo `herdar --tasks --gravar` no diário da entrega, sessão `herdar` (já reservada, M20). Fora de `TIPOS_DE_TASK` para o loop, o Stop e a guarda nunca o lerem como progresso nem como ciclo de task. Rejeitado: `task.integrada` com marca, por D-G50.
- **DT9 Origem conferida, falha fechada.** `commit:<sha>`: o commit existe e é ancestral de `HEAD` (`git merge-base --is-ancestor`). `pr:<n>`: `gh pr view <n>` diz `MERGED`; sem `gh`, recusa com motivo. `ledger:<arquivo>:<linha>`: arquivo versionado dentro da raiz e a linha existe. Task que está no `plano.json` da entrega é recusada (o loop mede); task já herdada é pulada (idempotente).
- **DT10 O painel separa herdado de medido.** `tasks` ganha `herdadas`; o total é o do plano mais as herdadas fora dele; o `%` conta as herdadas como feitas; o texto diz `N feitas: H herdadas, I medidas`. A previsão nunca usa herdadas (não têm duração).
- **DT11 Amostra mínima de 5 tasks integradas** (o número é do redator, sem fonte do dono: P5, Sombra) para a previsão do projeto. Abaixo: `sem ritmo: N de 5 tasks medidas`. Só na visão de projeto; o fallback da entrega (`painel.mjs:867`) fica como está (calibrado no replay da GM-14, `painel.ts:348-351`). Rejeitado: 3, porque com 3 o ritmo ainda é de 1 entrega só, em regra.
- **DT12 DEPENDE sem PR que não é do dono.** O item "revisar e aceitar o pedido de revisão #N" some quando o PR está em rascunho (`isDraft`) ou quando `entrega.autonomia` de `origin` é `true` (o merge é do orquestrador). O fato `pr` ganha `rascunho` opcional.
- **DT13 Título: card antes do plano.** O título da entrega no painel é o do card do PBI (pasta `fluxo.mapeamento.FL1`, frontmatter `id` igual à entrega); sem card, o 1º `# ` da spec, como hoje.
- **DT14 Mutação de SQL sem tipo novo.** O `teste` da mutação já é comando de shell (M22): a orientação documentada é (1) amarrar a constante a uma fonte única que o teste lê (preferida), ou (2) um `teste` que recria um banco **local e efêmero** e reaplica as migrations antes de rodar (`npm run db:reset:test && npx vitest run …`), nunca banco de produção nem compartilhado. Rejeitado: tipo de mutação com hook de banco, por D-G57 (forma mínima).

ADRs: nenhuma. Não há exceção a regra.

## Requisitos

Regra transversal: fixtures genéricas (`PBI-7`, branches `feat/PBI-7-loop` e `docs/PBI-7-plano`, `db.local.exemplo`); nenhum nome do consumidor. Os testes de cada REQ vêm em 2 grupos: **reproduz** (falha hoje e passa com a mudança) e **regressão** (cláusula negativa: passa hoje e tem de seguir passando; cada um com troca de valor antes do commit, P15). Teste com relógio usa barreira por arquivo-marcador, nunca sobreposição por tempo.

### Item 2: encerramento

**REQ-ENC-1 Plano aberto não encerra nem publica (DT1).** `gates/src/trilha.ts` (`planoAberto` novo, exportado; `podeEncerrar` `:174-182` ganha o 5º argumento opcional `plano: {tasks: string[]} | null`, ausente = regra de hoje, para as 22 chamadas de `test/encerramento.test.ts` seguirem válidas); `gates/src/guarda.ts:279-300` (`entregaPublicada`, regra antiga: lê `plano.json` com `validarPlano` e devolve `false` com `planoAberto`); `scripts/painel-medir.mjs:394`, `:450-457` (passa o plano lido de `alvo.dir`; aviso só no `estado`, 1 por PR e sessão).
- Dado a entrega `PBI-7` com `plano.json` de T1 e T2, T1 integrada e T2 aberta, e o PR #10 (head `docs/PBI-7-plano`, título `docs(PBI-7): plano`) mergeado em `main`, Quando `medir()` roda com o gh falso (`test/fixtures/gh-encerramento/gh`), Então nenhum `entrega.encerrada` é gravado, o fato `pr` #10 é gravado, `entregaPublicada(raiz, 'PBI-7', SESSAO_QUALQUER)` e com sessão `s2` = `false` (M4b dá `true` hoje), `loop.mjs iniciar T2` não recusa com `entrega_publicada`, e o `painel.mjs estado` traz o aviso de DT1 com `T2` e `/gabarito-mestre:encerrar PBI-7 10` uma vez só em 2 medições seguidas.
- Dado o mesmo com a sessão na branch `docs/PBI-7-plano` (`via: 'head'`) e com `entrega.base: next`, Então o mesmo.
- Dado T2 `cortada` (`task.fora`) e T1 integrada, Então o PR posterior (DT2) encerra e a entrega fica publicada.
- Dado `entrega.encerrada` do dono com T2 aberta, Então publicada (o encerramento manda).
- Reproduz: `encerra-nao-com-plano-aberto-titulo`, `encerra-nao-com-plano-aberto-head`, `publicada-nao-com-plano-aberto` (P9: atravessa `medir()`, o diário relido e `entregaPublicada` e o `loop.mjs iniciar` real), `aviso-encerrar-uma-vez`. Regressão: `encerra-com-task-fora`, `encerra-sem-plano-igual` (os testes atuais de `painel-medir.test.mjs` e `encerramento.test.ts` passam sem mudança), `publicada-encerrada-dono-igual`. Arquivos de teste: `test/trilha.test.ts`, `test/encerramento.test.ts`, `test/painel-medir.test.mjs`, `test/loop-cli-5.test.mjs` (já testam `entregaPublicada` e o `iniciar` real). Mutações ME1-a: `podeEncerrar` ignora o plano ⇒ cai; ME1-b: contar `fora` como aberta ⇒ cai `encerra-com-task-fora`; ME1-c: aplicar só a `via: 'titulo'` ⇒ cai o caso head; ME1-d: a regra antiga de `entregaPublicada` ignora o plano ⇒ cai `publicada-nao-com-plano-aberto`; ME1-e: o plano vence `entrega.encerrada` do dono ⇒ cai `publicada-encerrada-dono-igual`; ME1-f: aviso a cada medição ⇒ cai `aviso-encerrar-uma-vez`.

**REQ-ENC-2 PR anterior à última integração não encerra (DT2).** `trilha.ts:174-182`.
- Dado o plano fechado com T1 integrada em 2026-11-01T10:00Z e T2 em 2026-11-20T10:00Z, o PR #10 mergeado em 2026-11-03 e o PR #38 mergeado em 2026-11-21, Quando `medir()` roda, Então encerra o #38 (`entrega.encerrada.pr = 38`), nunca o #10.
- Dado PR mergeado 4 min antes da última integração, Então encerra (margem); 6 min antes, Então não.
- Dado entrega sem `task.integrada`, Então a regra de DT2 não se aplica (regressão).
- Reproduz: `encerra-so-pr-posterior`, `encerra-margem-de-relogio` (o caso de 6 min). Mutações ME2-a: comparar com a 1ª integração (2026-11-01) ⇒ o #10 encerra, cai; ME2-b: sem margem ⇒ cai o caso de 4 min; ME2-c: margem de 1 h ⇒ cai o de 6 min.

### Item 3: alias do orquestrador

**REQ-ORQ-1 Alias pelo papel `orquestrador` (DT3).** `lib/config.mjs:199-235` (papel nos 3 perfis); `scripts/onboarding.mjs:779-788`, `:865`.
- Dado perfil `padrao`, `economia` ou `qualidade` sem `modelos.orquestrador`, Quando o onboarding grava, Então `orquestracao.modelo.alias` = `opus`; com `modelos.orquestrador: "sonnet"`, `sonnet`.
- Dado a prévia de troca de perfil, Então a linha "modelo do orquestrador" cita `modelos.orquestrador`, não `modelos.revisor_final`.
- Dado `resolverModelo(orq, 'revisor_final')`, Então o resultado de hoje em cada perfil (cláusula negativa: `fable` em `padrao`).
- Dado o doctor com `modelos.orquestrador: "haiku"`, Então avisa `orquestrador: declarado haiku < recomendado opus` (a tabela já vem de `PERFIS_MODELO`, `harness-doctor.mjs:1008-1019`).
- Dado repo já instalado com `orquestracao.modelo.alias: "fable"` e perfil `padrao` sem `modelos.orquestrador`, Quando o doctor roda, Então avisa `modelo do orquestrador gravado fable ≠ opus do papel orquestrador: rode o onboarding de novo` (o alias só muda quando o onboarding regrava; vai também à Janela).
- Reproduz: `alias-orquestrador-por-papel` (3 perfis e o explícito), `doctor-orquestrador-abaixo`, `doctor-alias-divergente`. Regressão: `revisor-final-inalterado`. Arquivos de teste: `test/onboarding.test.mjs`, `test/harness-doctor-loop.test.mjs` (onde estão os testes de modelo, `:249`), `test/lib.test.mjs:520-543` (o `deepEqual` de `MODELOS_PADRAO` e `PERFIS_MODELO` ganha o papel). Mutações MO1-a: voltar a `revisor_final` ⇒ cai; MO1-b: `fable` em `qualidade` ⇒ cai; MO1-c: ignorar o explícito ⇒ cai; MO1-d: doctor sem a divergência ⇒ cai `doctor-alias-divergente`.

### Item 4 e backlog l.122: plano e suítes antes de despachar

**REQ-MIG-1 `conferirExecutavel` (DT4).** Novo `gates/scripts/plano-executavel.mjs`; `loop.mjs:761-770` (`abrir`), `:1466-1507` (`proxima`).
- Dado task com `mutacoes` em texto livre, com caminho inexistente, fora da raiz, JSON inválido, lista vazia, item sem `para`, `cwd` não texto, ou `arquivo` fora do escopo da task, Quando `loop.mjs abrir <T>` roda, Então `{ok:false, erro:'plano_nao_executavel'}`, rc 1, nenhuma worktree nem branch criada, e a mensagem cita a task, o campo e o motivo de cada problema dessa task e da config.
- Dado `teste_afetado: "tests/a.test.ts"` (arquivo existente sem bit de execução), Então o mesmo, com a sugestão `use o comando, ex.: "npx vitest run tests/a.test.ts"` sem inventar o runner (o exemplo é fixo).
- Dado `harness.config.json` sem `gates.suites`, com lista vazia ou com item sem `cmd`, Então o mesmo; dado `gates.suites: ["npm test"]` (texto, que o gate aceita), Então não recusa.
- Dado `arquivo` fora de `arquivos` do `plano.json` mas dentro do escopo ampliado por emenda aplicada, ou dentro de um diretório listado em `arquivos`, Então não recusa.
- Dado `proxima` com 1 task inválida e outra válida, Então `acao.itens` só tem a válida e `aviso` traz os problemas da inválida; com todas inválidas, Então `acao = {tipo:'esperar', motivo:'plano_nao_executavel'}`.
- Reproduz: `abrir-recusa-mutacoes-texto-livre` (a l.122 e o item 4 a), `abrir-recusa-teste-afetado-caminho` (item 4 c), `abrir-recusa-sem-suites` (item 4 b), `proxima-tira-invalida`, `proxima-todas-invalidas-espera`. Regressão: `abrir-plano-valido-igual` (o formato da GM-16, M13, com `cwd`), `suites-em-texto-aceitas`, `escopo-por-emenda-e-diretorio`, `conferir-ignora-integrada` (task integrada ou fora não é conferida). Arquivos: `test/loop-cli-5.test.mjs` (CLI real, P9), `test/plano-executavel.test.mjs`. Mutações MM1-a: conferir contra `arquivos` cru em vez do escopo ⇒ cai `escopo-por-emenda-e-diretorio`; MM1-b: checar só no `integrar` ⇒ cai o `abrir`; MM1-c: `proxima` lançar em vez de tirar ⇒ cai `proxima-tira-invalida`; MM1-d: regra própria de suíte em vez de `normalizarSuites` ⇒ cai `suites-em-texto-aceitas`.

**REQ-MIG-2 Onboarding e doctor sabem de `gates.suites` (DT5).** `scripts/onboarding.mjs` (detecção ao lado de `detectarTipoRepo`, `:384-394`, e gravação em `patches`); `scripts/harness-doctor.mjs` (item novo `suites-declaradas`).
- Dado `package.json` com `scripts.test` e config sem `gates.suites`, Quando `onboarding.mjs detectar` e `gravar` rodam, Então a prévia mostra `suítes de teste: npm test` e a config ganha `gates.suites: [{nome:'unit', cmd:'npm test'}]`.
- Dado config com `gates.suites`, Então nada muda; dado `package.json` sem `scripts.test`, ou com o placeholder `echo "Error: no test specified" && exit 1`, Então nada é gravado e nenhuma pergunta nova aparece.
- Dado o doctor sem `gates.suites`, Então `suites-declaradas` FALTA com `o abrir recusa sem suíte: declare gates.suites`; com, `found: true` e o número de suítes.
- Dado o `gates.suites` que o onboarding gravou, Quando `conferirExecutavel` (REQ-MIG-1) roda sobre a mesma config, Então não há problema de suíte (costura, P9).
- Reproduz: `onboarding-detecta-suites`, `doctor-suites-declaradas`, `onboarding-suites-passa-no-conferir` (depois do T3). Regressão: `onboarding-nao-sobrescreve-suites`, `onboarding-sem-script-test-nao-pergunta`, `onboarding-placeholder-nao-grava`. Arquivos: `test/onboarding.test.mjs`, `test/harness-doctor-loop.test.mjs`. Mutações MM2-a: sobrescrever `gates.suites` existente ⇒ cai; MM2-b: perguntar quando não detecta ⇒ cai; MM2-c: aceitar o placeholder ⇒ cai.

**REQ-MIG-3 O formato do `plano.json` está escrito (M12).** `reference/fluxo.md` (seção nova "Campos da task do plano.json"); `skills/gabarito-loop/SKILL.md` (1 linha com o ponteiro).
- Dado a doc, Então ela descreve `id`, `deps`, `arquivos`, `reqs`, `titulo`, `mutacoes` (caminho de JSON com `{nome, arquivo, de, para, teste, cwd?}`) e `teste_afetado` (comando de shell), com 1 exemplo de cada, e o que o `abrir` confere (REQ-MIG-1).
- Teste: checagem em `scripts/test/texto.test.sh` dos literais `teste_afetado`, `{nome, arquivo, de, para, teste, cwd?}` e `plano_nao_executavel` em `reference/fluxo.md`. Mutação MM3-a: tirar o exemplo ⇒ cai.

### Item 5: contagem

**REQ-CNT-1 Vitest e jest contam (DT6).** `scripts/gate-task.mjs:105-121` (`falhas`, `somar` viram uma `contagem(out)` que devolve `{tests, pass, fail}`), `:291-304`.
- Dado uma suíte cujo `cmd` imprime o texto do vitest verde (M14) com rc 0, Quando o gate roda, Então `verde: 3 teste(s)`; dado o texto com cores ANSI, Então o mesmo.
- Dado o texto do vitest com `1 failed` e rc 0, Então reprova com `rc=0 mas a saída declara fail 1`; com rc 1, Então reprova (não é RED conhecido).
- Dado o texto do jest verde (`Tests:       3 passed, 3 total`) e com pulado (`Tests:       1 skipped, 3 passed, 4 total`), Então `verde: 3`.
- Dado `      Tests  3 failed (3)` (sem `passed`) com rc 1, Então reprova com a falha declarada (`fail 3`).
- Dado só `Test Files  2 passed (2)` (sem a linha `Tests`), Então `rc=0 sem prova` (arquivos não são testes).
- Dado a saída do node `--test` de hoje, Então contagem e relato byte a byte iguais.
- Reproduz: `conta-vitest-verde`, `conta-vitest-com-ansi`, `vitest-falha-reprova`, `vitest-so-falhas`, `conta-jest-verde`, `conta-jest-com-pulado`. Regressão: `test-files-nao-conta`, `node-test-igual` (e os testes atuais de `gate-task.test.mjs`). Arquivo: `test/gate-task.test.mjs`, suíte de fixture = `printf` do texto, sem vitest nem jest instalados. Mutações MC1-a: contar `Test Files` ⇒ cai; MC1-b: não tirar ANSI ⇒ cai; MC1-c: ignorar `failed` do vitest ⇒ cai `vitest-falha-reprova`.

### Item 11: suítes em série

**REQ-SUI-1 `teste_afetado` sozinho e `serial: true` (DT7).** `gate-task.mjs:140-152` (`normalizarSuites` lê `serial`), `:283-288`, `:393`; `loop.mjs:955-967` (o `teste_afetado` sai com `serial: true`).
- Fixture de barreira (sem relógio): cada suíte é 1 script executável simples (sem `&&`, por causa do `COMPOSTO` de `gate-task.mjs:137` no A4) fora da worktree que grava `ini-<nome>` num `$TMPDIR` próprio; a paralela `p1` espera até 10 s pelo `ini-p2` e vice-versa (prova de paralelismo); a `serial`/`teste_afetado` falha se achar `ini-*` de outra sem o `fim-*` dela (prova de exclusão).
- Dado 2 suítes sem `serial` e o `teste_afetado`, Quando o gate roda, Então as 2 paralelas passam (se encontraram) e o `teste_afetado` passa (rodou sozinho, depois).
- Dado 2 suítes `serial: true`, Então rodam sozinhas, na ordem declarada.
- Dado o mesmo na medição A4 (`--red`), Então a mesma ordem.
- Dado `plano.json` com `teste_afetado` e `gates.suites` com 1 suíte de barreira, Quando o `loop.mjs integrar` real roda (P9: `suitesDaTask` ⇒ `avaliar`), Então o `teste_afetado` roda depois da suíte.
- Reproduz: `teste-afetado-depois`, `serial-nao-sobrepoe`, `a4-mesma-ordem`, `integrar-teste-afetado-em-serie` (em `test/loop-cli-5.test.mjs`). Regressão: `paralelas-seguem-paralelas`, `mod-test-segue-depois` (regra da GM-15 T34). Arquivos: `test/gate-task.test.mjs`, `test/loop-cli-5.test.mjs`. Mutações MS1-a (em `gate-task.mjs`): `teste_afetado`/`serial` no `Promise.all` ⇒ cai `teste-afetado-depois`; MS1-b (em `loop.mjs`, `suitesDaTask`): tirar `serial: true` do `teste_afetado` ⇒ cai `integrar-teste-afetado-em-serie`; MS1-c (em `gate-task.mjs`, `medirBase`): A4 em paralelo ⇒ cai `a4-mesma-ordem`; MS1-d: tudo em série ⇒ cai `paralelas-seguem-paralelas`.

### Item 7: herança de tasks

**REQ-HER-1 Evento `task.herdada` (DT8).** `gates/src/tipos.ts` (`TipoEvento`), `gates/src/formas.ts:13-21` (`TIPOS_EVENTO`) e a regra da forma; `gates/dist/formas.js`.
- Dado `{task:'T3', origem:{tipo:'commit', ref:'<40 hex>'}}`, `{…tipo:'pr', ref:'10'}` e `{…tipo:'ledger', ref:'docs/ledger.md:42'}`, Quando o diário valida, Então aceita; dado `tipo` fora dos 3, `ref` vazio, campo a mais, `task` fora de `ID_RE`, Então recusa com motivo.
- Dado `task.herdada` no diário, Então `proximaAcao`, `estadoDe` e o Stop o ignoram (cláusula negativa: `TIPOS_DE_TASK` e `TIPOS_LOOP` sem mudança, `deepEqual`).
- Reproduz: `forma-task-herdada` (válidos e inválidos). Regressão: `herdada-fora-do-loop`, `tipos-evento-cobre-a-uniao`. Arquivos: `test/formas.test.ts`, `test/loop.test.ts` (ou onde está o `deepEqual` de `TIPOS_DE_TASK`). Mutações MH1-a: aceitar `tipo` livre ⇒ cai; MH1-b: pôr em `TIPOS_DE_TASK` ⇒ cai `herdada-fora-do-loop`.

**REQ-HER-2 `herdar --tasks` (DT9).** `scripts/onboarding-herdar.mjs` (função `herdarTasks`); `scripts/onboarding.mjs:960-972` (flags `--tasks --entrega <ID> --arquivo <lista.json>`); `skills/gabarito-instalar/SKILL.md:63-67` (passo 6b: a oferta, com a lista mostrada ao dono e o `--gravar` só com o "sim").
- Dado a lista `[{task:'T1', origem:'commit:<sha>'}, {task:'T2', origem:'pr:10'}, {task:'T3', origem:'ledger:docs/ledger.md:42'}]` num repo de `montar()` com o commit e o arquivo, e o gh falso com o #10 `MERGED`, Quando roda sem `--gravar`, Então nada é escrito e a saída lista as 3 como `ok`; com `--gravar`, Então 3 `task.herdada` em `.harness/entregas/PBI-7/events.herdar.jsonl`, encadeados (`seq`, `hash_anterior`).
- Dado commit inexistente, commit fora do histórico de `HEAD`, PR `OPEN`, gh ausente, `ledger` com linha além do fim ou arquivo fora da raiz, ou task que está no `plano.json`, Então essa entrada sai `recusada` com motivo e, com `--gravar`, **nada** é gravado (tudo ou nada).
- Dado a mesma lista rodada 2 vezes com `--gravar`, Então a 2ª não grava nada (`ja_herdada`).
- Dado `--dry-run`, Então só mostra.
- Reproduz (todos: o `--tasks` não existe hoje): `herdar-tasks-le-sem-gravar`, `herdar-tasks-grava-3`, `herdar-tasks-recusa-tudo-ou-nada` (1 caso por motivo), `herdar-tasks-idempotente`, `herdar-tasks-nao-toca-plano` (o `plano.json` e a config byte a byte iguais). Regressão: os testes atuais do `herdar` sem `--tasks`. Em `test/onboarding-herdar.test.mjs`, pelo CLI real (P9). Mutações MH2-a: gravar as válidas quando há recusada ⇒ cai; MH2-b: aceitar task do plano ⇒ cai; MH2-c: não conferir ancestral ⇒ cai; MH2-d: PR sem gh aceito ⇒ cai.

**REQ-HER-3 O painel mostra herdado separado, na linha e nos totais (DT10).** `gates/src/projeto.ts:365-392` (linha: `herdadas`; `estimadas = feito ? total - integradas - herdadas : 0`, `:379`), `:397-412` (`totais` ganha `herdadas`; `pct` e `pctComEstimadas` do topo contam as herdadas como feitas; `restantes = tasks - integradas - herdadas - estimadas`, que alimenta a previsão); `gates/src/painel-esquadrao.ts` (o texto da linha e do topo, se não vier pronto de `projeto.ts`).
- Dado PBI-7 com `plano.json` de T12 e T13 (T12 integrada) e 11 `task.herdada` (T1 a T11, fora do plano), Quando `projetarProjeto` roda, Então a linha tem `tasks = {total:13, integradas:1, herdadas:11, estimadas:0, restantes:1, …}`, `pct` = 92 e o texto `12 feitas: 11 herdadas, 1 medida`; e os `totais` têm `tasks:13, integradas:1, herdadas:11, restantes:1, pct:92`.
- Dado o mesmo PBI com card "feito", Então `estimadas = 1` (só a T13), nunca 12 (as herdadas não viram estimadas).
- Dado `task.herdada` de uma task também integrada no diário, Então conta 1 vez, como medida.
- Reproduz: `projeto-conta-herdadas`, `totais-com-herdadas`, `feito-nao-estima-herdada`, `herdada-e-integrada-conta-uma`. Regressão: `projeto-sem-herdada-igual` (linha, texto e totais byte a byte iguais), `ritmo-ignora-herdada` (passa hoje: `ritmoDasAnteriores` só lê `task.iniciada`/`task.integrada`, `painel.ts:358-362`; fica como guarda). Arquivos: `test/projeto.test.ts`, `test/painel-projeto.test.ts`; P9: um caso pelo `projetoDoRepo` de `painel.mjs` sobre o diário que o `herdar --tasks --gravar` escreveu. Mutações MH3-a: herdada como integrada ⇒ cai o texto; MH3-b: contar 2 vezes ⇒ cai; MH3-c: `totais` sem herdadas ⇒ cai `totais-com-herdadas`; MH3-d: `estimadas` sem descontar herdadas ⇒ cai `feito-nao-estima-herdada`.

### Itens 8, 9 e 12: painel

**REQ-PRV-1 Previsão do projeto com amostra mínima (DT11).** `projeto.ts:429-431` (`ritmoDasAnteriores` ganha a contagem, ou função irmã que a devolve).
- Dado 1 a 4 tasks integradas no projeto, Quando `projetarProjeto` roda, Então `previsao.medida = null` e `motivo` = `sem ritmo: N de 5 tasks medidas`; com 5, Então a previsão de hoje.
- Dado o fallback da entrega (`ritmoAnterioresS`), Então o valor de hoje (cláusula negativa).
- Reproduz: `previsao-projeto-pede-5`. Regressão: `previsao-projeto-com-5-igual`, `fallback-entrega-igual`. Arquivo: `test/projeto.test.ts`. Mutações MP1-a: piso 1 ⇒ cai; MP1-b: aplicar ao fallback ⇒ cai.

**REQ-DEP-1 DEPENDE sem PR de rascunho nem de merge do orquestrador (DT12).** `painel-medir.mjs:35` (`isDraft` em `CAMPOS_PR`), `:39-46` (`rascunho`); `gates/src/formas.ts:381-390` (`rascunho` opcional booleano no fato `pr`); `depende.ts:63-74`, `:297-299`; `painel.ts:1187-1194` (passa `autonomiaEntrega`).
- Dado PR aberto com `isDraft: true`, Quando o painel projeta, Então o DEPENDE não tem "revisar e aceitar o pedido de revisão #N".
- Dado PR aberto não rascunho e `entrega.autonomia: true` em `origin`, Então também não; com `false` ou ausente, Então tem (cláusula negativa com troca de valor).
- Dado fato `pr` sem `rascunho` (diário 2.3.1), Então lido como não rascunho.
- Dado o gh falso com o PR #12 aberto e `isDraft: true` (`GH_PRS_EXTRA`), Quando `medir()` grava o fato e o `painel.mjs estado` projeta sobre o diário relido, Então o fato `pr` #12 tem `rascunho: true` e o DEPENDE não tem "revisar e aceitar o pedido de revisão #12" (costura `gh` ⇒ fato ⇒ DEPENDE, P9).
- Reproduz: `depende-sem-rascunho`, `depende-sem-pr-com-autonomia`, `fato-pr-rascunho-opcional`, `painel-rascunho-ponta-a-ponta`. Regressão: `depende-pr-sem-autonomia-igual`. Arquivos: `test/depende.test.ts`, `test/formas.test.ts`, `test/painel-medir.test.mjs`, `test/fixtures/gh-encerramento/gh` (se o falso não repassa `isDraft`). Mutações MD1-a: `depende.ts` ignora `rascunho` ⇒ cai; MD1-b: ignorar a autonomia ⇒ cai; MD1-c: esconder sempre ⇒ cai a regressão; MD1-d: `prDoGh` não copia `isDraft` ⇒ cai `painel-rascunho-ponta-a-ponta`.

**REQ-TIT-1 Título do card (DT13).** `scripts/painel.mjs:775-782`.
- Dado card `PBI-7` em `fluxo.mapeamento.FL1` com `# Login por e-mail` e spec com `# PBI-7 Implementation Plan`, Quando o painel projeta a entrega, Então o título é `Login por e-mail`.
- Dado sem card, ou card sem `# `, Então o título de hoje (cláusula negativa); dado 2 cards com o mesmo `id`, Então o da spec e um aviso.
- Reproduz: `titulo-do-card`, `titulo-card-ambiguo`. Regressão: `titulo-sem-card-igual`. Arquivo: o teste do `painel.mjs` que já monta repo (o plano escolhe; no escopo da T9). O `bench-painel.mjs` não piora mais que 5 % (M, a medir no T9). Mutações MT1-a: spec antes do card ⇒ cai; MT1-b: 1º card qualquer ⇒ cai o ambíguo.

### Item 10: mutação de SQL

**REQ-MUT-1 A orientação está escrita (DT14).** `reference/gates.md:225-239` (seção "Mutações prescritas" ganha "Migration de banco").
- Dado a doc, Então ela diz as 2 formas de DT14, com 1 exemplo de `teste` que recria banco local, e a frase "nunca banco de produção nem compartilhado".
- Teste: checagem em `scripts/test/texto.test.sh` dos literais. Mutação MU1-a: tirar a frase do banco ⇒ cai.

### Versão

**REQ-VRS-1 2.4.0 (D-G56).** M23; `CHANGELOG.md`.
- Dado a entrega, Então `plugin.json:4` e `gates/package.json:3` = `2.4.0`, `package.test.mjs:49-50` e `texto.test.sh:279` fixam `2.4.0`, `[2.4.0]` datada fica acima da `[2.3.1]` (`texto.test.sh` ganha a checagem de ordem `[2.4.0] > [2.3.1] > [2.3.0]`), e a `[2.4.0]` aponta cada item do relato que corrige (o relato pede, "Entregável pedido"). O sufixo `autonomia (2.3.1)` de `decidir.ts:106` não muda (é a versão da regra).
- Mutação MV1-a: versão só num manifesto ⇒ cai.

Permissão: **a REQ-ENC-1 muda a guarda**, só em `entregaPublicada` (o que ela dá por publicada; os anéis e o `decidir` não mudam): entrega com plano aberto e sem `entrega.encerrada` deixa de ser publicada, então o loop, o Stop e o cartão voltam a aceitar task nela. A mudança só abre o que hoje fica travado por engano; nada que a guarda pergunta ou nega passa a passar calado. Caminho de escrita novo: o `herdar --tasks --gravar` grava `events.herdar.jsonl` no diário da entrega, pelo `append` do diário (mesmo escritor do loop).

## Testes e gates

| REQ | Task | Prova | Mutações |
|---|---|---|---|
| REQ-ENC-1, 2 | T1 | 10 testes; `publicada-nao-com-plano-aberto` atravessa `medir()` ⇒ diário ⇒ `entregaPublicada` ⇒ `loop.mjs iniciar` (P9) | ME1-a a f, ME2-a a c |
| REQ-MIG-2 | T2 | 6 testes; `onboarding-suites-passa-no-conferir` atravessa onboarding ⇒ `conferirExecutavel` (P9) | MM2-a a c |
| REQ-MIG-1, 3 | T3 | 9 testes pelo CLI real + 1 de texto | MM1-a a d, MM3-a |
| REQ-CNT-1 | T4 | 8 testes | MC1-a a c |
| REQ-SUI-1 | T5 | 6 testes; `integrar-teste-afetado-em-serie` atravessa `suitesDaTask` ⇒ `avaliar` (P9) | MS1-a a d |
| REQ-HER-1, 2 | T6 | 8 testes pelo CLI real | MH1-a, b, MH2-a a d |
| REQ-HER-3, REQ-PRV-1 | T7 | 9 testes; 1 pelo `projetoDoRepo` sobre o diário do T6 (P9) | MH3-a a d, MP1-a, b |
| REQ-DEP-1 | T8 | 5 testes; `painel-rascunho-ponta-a-ponta` atravessa gh ⇒ fato ⇒ DEPENDE (P9) | MD1-a a d |
| REQ-ORQ-1 | T12 | 4 testes | MO1-a a d |
| REQ-TIT-1 | T9 | 3 testes + bench | MT1-a, b |
| REQ-MUT-1 | T10 | 1 de texto | MU1-a |
| REQ-VRS-1 | T11 | testes de versão | MV1-a |

Fumaça (orquestrador, antes do PR): rodar `medir.mjs` desta redação contra a worktree com o código novo e conferir que M2, M6, M8, M14 e M17 mudaram como os REQs dizem; rodar `.claude-tmp/gm21/rv-publicada.mjs` e conferir que o M4b passou a `false`; num repo tmp com `plano.json` no formato da alpha.1, `loop.mjs abrir` recusa com os problemas da task e da config; colar as saídas no PR.

## Tasks propostas

O plano vem depois; isto é a decomposição sugerida. Arquivos de teste ficam no escopo da task que os cita no REQ.

| Task | REQs | Arquivos | Depende de |
|---|---|---|---|
| T1 Encerramento e publicada | ENC-1, ENC-2 | `gates/src/trilha.ts`, `gates/dist/trilha.js`, `gates/src/guarda.ts` (só `entregaPublicada`), `gates/dist/guarda.js`, `gates/scripts/painel-medir.mjs`, `gates/test/trilha.test.ts`, `gates/test/encerramento.test.ts`, `gates/test/painel-medir.test.mjs`, `gates/test/loop-cli-5.test.mjs` (só o caso `publicada-nao-com-plano-aberto`), `gates/test/fixtures/gh-encerramento/` | — |
| T2 Onboarding e doctor: suítes | MIG-2 | `gates/scripts/onboarding.mjs` (detecção e gravação de `gates.suites`), `gates/scripts/harness-doctor.mjs` (item `suites-declaradas`), `gates/test/onboarding.test.mjs`, `gates/test/harness-doctor-loop.test.mjs` | — (o teste de costura com `conferirExecutavel` entra depois do T3, no mesmo arquivo) |
| T3 Plano executável | MIG-1, MIG-3 | `gates/scripts/plano-executavel.mjs` (novo), `gates/scripts/loop.mjs` (`abrir`, `proxima`), `gates/scripts/gate-task.mjs` (só `export` de `normalizarSuites`), `gates/test/plano-executavel.test.mjs` (novo), `gates/test/loop-cli-5.test.mjs`, `reference/fluxo.md`, `skills/gabarito-loop/SKILL.md`, `scripts/test/texto.test.sh` | T1 (`loop-cli-5.test.mjs`), T4 (`gate-task.mjs`) |
| T4 Contagem | CNT-1 | `gates/scripts/gate-task.mjs` (`falhas`, `somar`, passo 5), `gates/test/gate-task.test.mjs` | — |
| T5 Suítes em série | SUI-1 | `gates/scripts/gate-task.mjs` (`normalizarSuites`, passo 5, `medirBase`), `gates/scripts/loop.mjs` (`suitesDaTask`), `gates/test/gate-task.test.mjs`, `gates/test/loop-cli-5.test.mjs` | T3, T4 |
| T6 Herdar tasks | HER-1, HER-2 | `gates/src/tipos.ts`, `gates/src/formas.ts` (tipo novo), `gates/dist/formas.js`, `gates/scripts/onboarding-herdar.mjs`, `gates/scripts/onboarding.mjs` (despacho), `gates/test/formas.test.ts`, `gates/test/loop.test.ts`, `gates/test/onboarding-herdar.test.mjs`, `skills/gabarito-instalar/SKILL.md` | T2, T12 |
| T7 Painel: herdadas e previsão | HER-3, PRV-1 | `gates/src/projeto.ts`, `gates/dist/projeto.js`, `gates/src/painel-esquadrao.ts`, `gates/dist/painel-esquadrao.js`, `gates/test/projeto.test.ts`, `gates/test/painel-projeto.test.ts` | T6 |
| T8 DEPENDE | DEP-1 | `gates/scripts/painel-medir.mjs` (`CAMPOS_PR`, `prDoGh`), `gates/src/formas.ts` (fato `pr`), `gates/dist/formas.js`, `gates/src/depende.ts`, `gates/dist/depende.js`, `gates/src/painel.ts`, `gates/dist/painel.js`, `gates/test/depende.test.ts`, `gates/test/painel-medir.test.mjs`, `gates/test/formas.test.ts`, `gates/test/fixtures/gh-encerramento/gh` | T1, T6 |
| T9 Título | TIT-1 | `gates/scripts/painel.mjs`, `gates/test/painel-cli*.test.mjs` (ou o teste do painel que já monta repo) | — |
| T10 Doc da mutação de SQL | MUT-1 | `reference/gates.md`, `scripts/test/texto.test.sh` | T3 (mesmo `texto.test.sh`) |
| T11 Versão e CHANGELOG | VRS-1 | `.claude-plugin/plugin.json`, `gates/package.json`, `gates/test/package.test.mjs`, `scripts/test/texto.test.sh`, `CHANGELOG.md` | todas |
| T12 Alias do orquestrador | ORQ-1 | `gates/lib/config.mjs`, `gates/scripts/onboarding.mjs` (alias, `:779-788`, `:865`), `gates/scripts/harness-doctor.mjs` (divergência do alias), `gates/test/onboarding.test.mjs`, `gates/test/harness-doctor-loop.test.mjs`, `gates/test/lib.test.mjs` | T2 (mesmos `onboarding.mjs`, `harness-doctor.mjs` e testes) |

Ondas (ordem da D-G57: primeiro o que trava o loop, itens 2, 4, 5 e l.122): **1a** T1, T2, T4 em paralelo (item 2; item 4 b; item 5; nenhum arquivo em comum) · **1b** T3 (T1, T4; item 4 a e c, l.122) · **2** T5 (T3, T4), T12 (T2), T9, T10 (T3) · **3** T6 (T2, T12) · **4** T7 (T6) e T8 (T1, T6) em paralelo: escopos disjuntos, `dist/` listado por arquivo (`projeto.js`, `painel-esquadrao.js` na T7; `formas.js`, `depende.js`, `painel.js` na T8) · **5** T11. Motivo: `onboarding.mjs`/`harness-doctor.mjs` são de T2, T12 e T6; `loop.mjs` de T3 e T5; `loop-cli-5.test.mjs` de T1, T3 e T5; `gate-task.mjs` de T4, T3 e T5; `formas.ts`/`dist/formas.js` de T6 e T8; `painel-medir.mjs` de T1 e T8; `texto.test.sh` de T3, T10 e T11. O build do `dist/` de cada task regrava só os arquivos do seu escopo (conferir no review: `git diff --stat` sem `dist/` alheio).

## CHANGELOG [2.4.0] previsto

```
## [2.4.0] — <data>

Resto do relato de um repo consumidor que veio da 2.1.0-alpha.1 (GM-21, D-G49, D-G50).

### Corrigido
- O painel não encerra mais a entrega por um PR antigo (ex.: o PR só do plano), e o loop não a trata mais como publicada: com plano.json, só encerra ou publica com todas as tasks integradas ou fora, e só por PR mergeado depois da última integração (item 2).
- O modelo do orquestrador vem do papel `orquestrador` (opus nos 3 perfis), não do revisor final (item 3).
- Plano no formato antigo (mutacoes em texto livre, teste_afetado como caminho) e config sem `gates.suites` são recusados no `abrir`, com a lista do que migrar, e avisados no `proxima`; antes, só quebravam no `integrar`, depois do review (item 4).
- O gate conta os resumos de vitest e jest (item 5).
- O `teste_afetado` roda sozinho, depois das outras suítes; suíte com `serial: true` também (item 11).

### Novo
- `onboarding.mjs herdar --tasks`: importa task antiga com origem (commit, PR ou ledger) no evento `task.herdada`; o painel mostra "N feitas: H herdadas, I medidas" (item 7).
- O onboarding detecta `gates.suites` (`npm test`) e o doctor avisa sem ela.

### Mudado
- Previsão do projeto só com 5 tasks medidas ou mais (item 8).
- O DEPENDE não pede revisão de PR em rascunho nem quando o merge é do orquestrador (item 9).
- O título da entrega no painel vem do card do PBI (item 12).
- Mutação de migration de banco: orientação em reference/gates.md (item 10).

### Limites declarados
- "RED conhecido" (falha pré-existente declarada) só para node --test/TAP; vitest e jest com falha sempre reprovam.
- O resumo do jest foi lido da documentação, sem jest real; outros runners sem resumo reconhecido seguem em "sem prova" ou `semContagem`.
- O alias do orquestrador gravado antes da 2.4.0 só muda quando o onboarding roda de novo; o doctor avisa a divergência.
```

## Rollout

1. Respostas da Sombra a P2 a P5 (abaixo). Motivo: são leituras do redator sobre comportamento de produto.
2. Aprovação da spec. Motivo: a D-G49 não aprova.
3. Orquestrador na branch `enabler/GM-21-relato-consumidor` antes do `abrir` (o `abrir` grava a branch atual como base, `loop.mjs:766-770`).
4. Ondas da seção "Tasks propostas".
5. PR `enabler/GM-21-relato-consumidor ⇒ next`; depois a virada `next ⇒ main`, tag e release só por ordem do dono (R1).

Janela: quem tem `plano.json` com task aberta e PR mergeado deixa de ver a entrega encerrada sozinha e deixa de ter o loop travado em `entrega_publicada` (encerra com `/gabarito-mestre:encerrar <ID> <PR>`); entrega já encerrada por engano antes da 2.4.0 segue encerrada até o `/gabarito-mestre:reabrir-entrega`; repo instalado com `alias: fable` segue vendo `fable` no cartão até rodar o onboarding (o doctor avisa); quem não tem `gates.suites` passa a ver o `abrir` recusar antes, em vez do `integrar` depois. Volta: reverter o merge; nenhuma config é regravada sem o onboarding.

## Fora de escopo (dono: Gabriel)

| Item | Motivo | Gatilho |
|---|---|---|
| Itens 1 e 6 do relato | saíram na 2.3.1 (GM-22, D-G51) | — |
| Prova de encerramento pelo sha (`gh pr list --search <sha>`) | DT2; 1 `gh` a mais por medição, busca do GitHub não medida | DT2 errar num caso real |
| Reabrir sozinho quando abre PR nova na entrega encerrada | o reabrir é do dono (`/gabarito-mestre:reabrir-entrega`); DT1 evita a causa | dono pedir |
| Tipo de mutação com hook de banco | D-G57 (item 10 na forma mínima), DT14 | 2º consumidor com o mesmo caso |
| JSON de resultado (`--outputFile`) e "RED conhecido" para vitest/jest | DT6 | suíte vitest com RED declarado |
| Amostra mínima no fallback da entrega | DT11: calibrado no replay da GM-14 | erro do fallback medido |
| Backlog l.136 (MCP prod por `project_id`; DELETE em host não declarado sai `log`), l.147 (`PROD_DB=x psql`), l.148 (heredoc lido como comando), l.149 (FN de `git rm/mv/checkout/restore` em hooks, `GIT_CONFIG_GLOBAL`, `HUSKY=0`, interpretadores), l.151 (`vercel redeploy <id>`) | D-G57: falsos negativos da guarda vão a um PBI próprio depois da GM-21 | PBI próprio da guarda (D-G57) |
| Backlog l.150 (frase da [2.3.1] sobre o que passa calado na guarda) | D-G57 (mesmo grupo); a frase está fixada por `texto.test.sh:301` e erra no sentido seguro | PBI próprio da guarda (D-G57) |
| Backlog l.137 | é o próprio escopo desta spec | — |

## Pendências

- **P1 RESPONDIDA pelo dono (D-G56, 2026-11-26): versão 2.4.0.**
- **P2 (Sombra) DT1, com mudança na guarda:** PR mergeado com task aberta no `plano.json` não encerra a entrega, e a regra antiga de `entregaPublicada` (`guarda.ts:279-300`, a mesma do painel, do loop, do cartão e do Stop) deixa de dar por publicada a entrega com task aberta e sem `entrega.encerrada` (M4b); o dono encerra à mão com `/gabarito-mestre:encerrar <ID> <PR>`. A mudança só destrava (nenhum `ask`/`deny` vira silêncio). Fonte: relato item 2 ("correção esperada"; o loop recusou `entrega_publicada` com T12 e T13 abertas) e D-G14 (a virada encerra por título). Se a Sombra responder `fora_da_regra`, vai ao dono. Desbloqueia a T1.
- **P3 (Sombra) DT3:** `opus` para o orquestrador nos 3 perfis, inclusive `qualidade`. Fonte: relato item 3 e memória "Fable só em review e2e". Desbloqueia a T12.
- **P4 (Sombra) DT12:** com `entrega.autonomia: true` o DEPENDE não lista o PR aberto. Fonte: relato item 9. Desbloqueia a T8.
- **P5 (Sombra) DT11:** amostra mínima de 5 tasks integradas para a previsão do projeto. Fonte: relato item 8 ("amostra mínima", sem número). Desbloqueia a T7 (só a REQ-PRV-1).
- **(M, a medir)** Tempo do `integrar` deste repo com o `teste_afetado` em série (T5, antes e depois, 1 task da GM-21); informativo.
- **(M, a medir)** `gh pr list --json isDraft` no gh instalado (T8, passo 0, contra este repo, só leitura).
- **(M, a medir)** Custo do card no `bench-painel.mjs` (T9).

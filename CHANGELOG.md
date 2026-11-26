# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versionamento: [SemVer](https://semver.org/lang/pt-BR/).
Usuários do plugin só recebem atualização quando `version` muda.

## [2.3.1] — 2026-11-26

Hotfix de segurança da guarda (GM-22, D-G51, D-G52).

### Corrigido

- **A autonomia cala só publicar.** Com a resposta "publica" (e o interruptor da máquina), passa calado só o pedido de publicar, e só se for comando de 1 segmento, com os caracteres `[A-Za-z0-9 ._/@:,=-]`, sem preparo de ambiente, numa destas formas fechadas (medidas no código integrado): `git push` sem refspec, na branch de produção, ou com 1 refspec não nulo para ela (por exemplo `git push origin main`, `git push -u origin main`), com remoto `origin` ou omitido e só as flags `-u`, `--set-upstream`, `-q`, `--quiet`, `-v`, `--verbose`, `--follow-tags`, `--atomic`, `--porcelain`, `-n`, `--dry-run` (2 refspecs, outro remoto, `--force`, `--no-verify` e `-o` perguntam); `gh pr merge` com ou sem número (no máximo 1), na branch de produção, e só as flags `--merge`, `-m`, `--squash`, `-s`, `--rebase`, `-r`, `--auto`, `--delete-branch`, `-d` (`--admin`, URL e 2 números perguntam); `vercel` ou `vc` com `--prod` ou `--production` (`vercel --prod`, `vercel deploy --prod`, `vc --prod`), `promote` ou `rollback` com ou sem id e `redeploy --prod` com ou sem id (nas duas grafias, `vercel` e `vc`), só com as flags `--prod`, `--production`, `--yes`, `-y` e id de deploy só com letras, dígitos, `_` e `-` (`dpl_abc`, `abc123`; URL, caminho com `/` ou `.`, `:`, `--scope`, `--cwd` e `--token` perguntam). `npm test && git push origin main` pergunta. Origem de 4 ou mais zeros no refspec (`0000:main`) é destrutiva e pergunta; com menos zeros (`0:main`, `000:main`) o git não lê como id de objeto e o comando passa como publicar. Produção de terceiro, `push --force` para produção, arquivos do harness, hooks do git e push sem hooks perguntam ao orquestrador e são negados ao subagente só quando o comando começa pelo programa que a guarda reconhece (por exemplo `rm`, `mv`, `cp`, `tee`, `sed -i`, redireção `>`, `git push`, `git config`, `psql`, `curl`, `ssh`); outro caminho para as mesmas pastas e destinos não é visto (ver Limites declarados). `rm -rf` em pasta comum (`rm -rf src`) não é alvo desta guarda e segue como antes (registrado, sem pergunta). Com "trabalha", a autonomia não cala nada: o que pergunta com "publica" pergunta também com "trabalha".
- **Hooks do git no anel de integridade.** Comando que começa por `rm`, `mv`, `cp`, `tee`, `sed -i` ou redireção `>` com alvo em `.githooks/` ou `.husky/` na raiz do projeto pede ao orquestrador e é negado ao subagente; outras vias para essas pastas não são vistas (ver Limites declarados).
- **Push sem hooks**: `git push` com `--no-verify`, com `GIT_CONFIG_COUNT`/`GIT_CONFIG_PARAMETERS` ou com `git -c core.hooksPath=…` pede ao orquestrador e é negado ao subagente, em qualquer branch.

### Mudado

- A pergunta de autonomia do onboarding passa a dizer o que cada resposta cala, e a prévia diz "autonomia para publicar". O que continua perguntando é o que está descrito acima; este changelog não promete mais do que a guarda vê.
- A escrita no interruptor da máquina (`~/.claude/gabarito-autonomia.json`), por Write, Edit ou comando que começa por `cp`, `mv`, `rm`, `tee`, `sed -i` ou redireção `>`, pede mesmo com a autonomia ligada.
- Config da 2.2.2 com `guarda.autonomia: "orquestrador"` segue válida e só cala menos; o `ask` avisa o que a autonomia cala.
- O evento `guarda.autonomia_usada` de publicar não traz `anel`; o campo `anel` é opcional.

### Limites declarados

- `promote`, `rollback` ou `redeploy` com id de deploy de outro projeto não é detectado (exigiria I/O).
- `cd ../outro && …` não é publicar: pergunta.
- O diretório de hooks é fixo (`.githooks`, `.husky`, `.git/hooks`); outro `core.hooksPath` não é protegido.
- A guarda lê o comando pelo programa que o abre; qualquer outra via (wrapper como `nice`/`timeout`/`xargs`/`exec`/`eval`, subcomando do git como `git rm`/`mv`/`checkout`/`restore`, interpretador como `python3 -c`/`node -e`/`perl -i`, `rsync`, `find -delete`, variáveis como `GIT_CONFIG_GLOBAL`/`HUSKY=0`) não é vista e passa calada nos 2 papéis, com qualquer resposta de autonomia; FN anteriores à 2.3.1, no backlog.
- `export GIT_CONFIG_…` em comando anterior e `git commit --no-verify` também não são vistos.

## [2.3.0] — 2026-11-26

Projeto que adotou o gabarito com entregas antigas (GM-20, D-G41 a D-G46).

### Corrigido

- % das tasks: PBI concluído sem `plano.json` sai das duas pontas; a tela mostra o % com as estimadas. "N sem plano" conta só abertos.
- Plano antigo: `fluxo.planosLegados` liga planos `.md` por padrão com `{PBI}`; plano sem task contável aparece "plano (formato anterior)".
- Status terminal (`Superado`, `Cancelado`, `Descartado`, ou `fluxo.status.terminais`) sai das contas: "N encerrados sem entrega".
- Entrega encerra pela base configurada (`entrega.base`), não só por `main`.
- Entrega encerrada com card fora de "concluído": conta como feita e o painel avisa "card desatualizado".
- Agente com hand-back em outra entrega, ou sem atividade há mais de 60 min, sai da EQUIPE; agente de outra entrega não marca task pendente como em curso.
- Uma linha de previsão; separadores mantidos com o projeto na tela.
- A "próxima" não aponta spec mais antiga que a última entrega encerrada.

### Adicionado

- `loop.mjs iniciar <task> implementador --executor orquestrador --motivo "…"`: tira o alerta "sem agente", mostra o desvio no painel e no registro; 1 por vez.
- Passo de adoção no `gabarito-instalar --atualizar` (`onboarding.mjs herdar`): acha PBIs entregues sem `plano.json`, propõe o padrão de planos antigos e os status terminais. Só grava com "sim".

### Limites declarados

- O plugin não atualiza o status do card: "card desatualizado" é só aviso; quem move o card é o time.
- Teste rodado numa worktree ainda grava no diário do checkout principal (backlog, prioridade alta).

## [2.2.2] — 2026-11-23

Patch interno (GM-19, D-G40): testes mais rápidos e sem repetição. Nada muda no comportamento do plugin para quem usa.

### Mudado

- **Suíte local de ~490 s para 264 s de mediana** (3 rodadas: 271, 263, 264 s) e job `gates` da CI de 701 s para 549 s de mediana. O arquivo `loop-cli` foi dividido em 5 partes com helpers comuns (`_loop-cli-helpers.mjs`).
- **Mesma cobertura, 5783 testes.** Entraram 3 que fecham furos (cabeçalho do mod-test de outra pasta, `texto-nom` no `texto.test.sh`, globs). Saíram 3 repetidos, cada corte provado por mutação.
- **Ruleset da `main` exige 10 checks** (antes 8): `mod` e `dist em dia` passaram a ser obrigatórios (D-G37).

### Limites declarados

- Teste rodado numa worktree ainda grava no diário do checkout principal (`.harness/entregas`): está no backlog como prioridade alta.
- O golden `s6-gabarito-zero-errado: separatrue` segue vermelho na base; os gates locais rodam com `S6_REPOS_DIR` vazio.

## [2.2.1] — 2026-11-21

Patch sobre a 2.2.0 (GM-18, D-G30): o dono encerra por comando a entrega já publicada e passa a apontar a entrega em cortar, adiar e reabrir. Tag, release e o PR `next` para `main` só o dono publica.

### Adicionado

- **`/gabarito-mestre:encerrar <entrega> <PR> [<versão>]`.** Grava `entrega.encerrada` com `via: 'dono'` e origem do dono, no diário da entrega nomeada. A visão de projeto e o `entregueDe` passam a tratar a entrega como feita; `<versão>` (opcional) vira o campo `versao`.
- **`[<entrega>]` em `cortar`, `adiar` e `reabrir`.** O 1º token que casa o formato de entrega (ex. `GM-14`) é sempre a entrega; sem ele vale a entrega da branch, como na 2.2.0. Com 2 entregas com a mesma task, o comando acerta a pretendida.
- **Efeitos do encerrar.** A entrega encerrada pelo dono deixa de aceitar task, sessão e `parar`. Depois de `/gabarito-mestre:reabrir-entrega <entrega>`, o dono pode encerrar de novo com o mesmo PR.

### Limites declarados

- O PR é obrigatório no encerramento do dono. A release entra só pelo campo `versao`, junto com o PR (D-G32); encerrar só pela release, sem PR, fica no backlog.
- O 2º encerrar sem `<versão>` deixa a versão exibida vazia: o dono deve repetir a versão.
- O comando exige `gh` no momento em que roda e confere só "PR mergeado" (`mergeado_em` recebe o `mergedAt`), sem base nem ID no título (D-G34).
- Task com id no formato de entrega exige a entrega escrita no comando.
- A visão de projeto tem regra própria de encerrada (não exige `pr` nem `mergeado_em`): com `via: 'dono'` as duas regras concordam, um evento automático fora da regra ainda divergiria (backlog).

## [2.2.0] — 2026-11-20

Painel de projeto mais curto e doctor que confere o quadro contra o git (GM-16, versão minor, D-G24). Tag, release e o PR `next` para `main` só o dono publica. A 2.1.1 segue reservada ao encerramento da GM-14 (D-G20, D-G21).

### Muda para quem já usa

Tudo abaixo vale por padrão, sem chave nova. O painel lê `fluxo.status.FL1`, `fluxo.vinculoPbiEpic` e `painel.projeto.opcoesComoContagem` do `harness.config.json` de `origin/HEAD`: editar só o arquivo local não tem efeito até o commit chegar à origem. Foi conferido comparando o código de produto da 2.1.0 (`origin/main`) com o desta versão: o painel de projeto (`gates/src/projeto.ts`, `gates/src/painel-esquadrao.ts`, `gates/scripts/painel.mjs`) e o doctor (`gates/scripts/harness-doctor.mjs`).

- **O leitor do plano `.md` mudou, e os números do projeto mudam com ele.** Na 2.1.0 só valia `### Task N:` no começo da linha, em qualquer lugar do arquivo. Agora valem os cabeçalhos descritos em "Adicionado" e um cabeçalho dentro de bloco cercado deixa de contar. Efeito para quem atualiza, sem mexer em nada: as tasks, a porcentagem, o "N sem plano" e as previsões do painel de projeto podem mudar. A contagem de um plano pode subir (cabeçalhos antes ignorados passam a contar) e pode cair (cabeçalho dentro de bloco cercado deixa de contar); se o plano de um PBI ficar sem nenhuma task contada, o PBI passa a "sem plano" e sai da conta de tasks.
- **PBIs feitos saem do desenho.** No painel de projeto, as linhas dos PBIs feitos deixam de ser desenhadas e entra uma linha só, "✓ N feitos" (singular "✓ 1 feito"), logo abaixo dos totais. Isso só acontece com 72 colunas ou mais (abaixo disso o painel já não desenhava linhas de PBI). Sem PBI feito, a linha "✓ N feitos" não aparece. O JSON da visão de projeto segue trazendo a linha de cada feito, só o desenho as recolhe; ele ganha 3 campos: `epic` em cada linha, `grupos` e `totais.opcoes`.
- **O `concluido` de `fluxo.status.FL1` conta como feito.** Antes só o status "concluido" fixo valia; agora o valor que o seu `fluxo.status.FL1` dá a `concluido` (por exemplo "Done") também. O `concluido` fixo continua valendo, e a entrega encerrada também marca o PBI como feito. Medido rodando o núcleo nos mesmos cards (um PBI com status "Done" e outro aberto, cada um com plano de 2 tasks), sem e com `{"concluido": "Done"}`: o desenho muda em "N de M PBIs feitos" (0 para 1), em "+N estimadas" (0 para 2), em "restantes" (4 para 2, ou 3 para 1 quando já há uma task integrada) e na previsão medida (que parte dos restantes; no caso com ritmo, o tempo restante cai de 150 para 50 minutos), e o "✓ N feitos" passa a incluir o PBI. A porcentagem desenhada (integradas sobre o total de tasks, `totais.pct`) não muda: 0% nos dois casos sem task integrada, 25% nos dois com uma. Se o `fluxo.status.FL1` não for um objeto, o painel avisa "fluxo.status.FL1 ilegível: vale o quadro padrão" e usa o quadro padrão.
- **Painel estreito (abaixo de 72 colunas): o "sem plano" sai inteiro.** Antes a linha única de totais era cortada no fim; agora, se ela não cabe, "sem plano" sai da linha por inteiro, nunca pela metade (com a opção `opcoesComoContagem` ligada, "opções" sai depois dele).
- **Painel agrupado por Epic, sem chave nova.** Se o seu `harness.config.json` já tem `fluxo.vinculoPbiEpic.tipo` igual a `frontmatter` (é o que o onboarding grava no fluxo por arquivos), o painel de projeto passa a agrupar os PBIs abertos por Epic e desenha uma linha de cabeçalho por grupo, com 72 colunas ou mais (abaixo disso o painel não desenha linhas de PBI nem cabeçalhos). As condições estão em "Projeto agrupado por Epic", abaixo.
- **Nenhum card some do painel sem a chave nova.** Com o padrão, todo card legível continua sendo uma linha (ou entra em "✓ N feitos" se estiver feito).
- **Como ligar as opções.** Quem quer que o card com status fora do quadro FL1 (por exemplo "Backlog") deixe de contar como trabalho põe, no `harness.config.json` (o da `origin/HEAD`, veja acima):

  ```json
  { "painel": { "projeto": { "opcoesComoContagem": true } } }
  ```

  Só o valor `true` liga; ausente, `false` ou qualquer outro valor deixa desligada. Ligada, esse card não vira linha, não entra nos totais, na porcentagem nem na previsão, e aparece como "N opções" na linha de totais (só quando N é maior que 0). Card sem status nunca é opção, e card cuja entrega já tem plano, eventos de task ou diário ilegível continua linha, porque o loop está trabalhando nele. O onboarding não grava essa chave: é escolha de quem usa, à mão.
- **Dois avisos novos no doctor, sem mudar o nível.** `fluxo-status-fl1` lista cards do quadro FL1 com status que não é coluna, e `pbi-mergeado-aberto` lista PBI ainda aberto no quadro que já tem commit de PBI no 1º pai da base da entrega (título `tipo(ID): ...`, com `tipo` entre os que levam escopo de PBI, e o ID inteiro igual). Os dois são avisos: não mudam o nível de adoção nem o exit code do CI. Sem git ou sem a base da entrega, `pbi-mergeado-aberto` diz "não conferido" quando há PBI aberto no quadro para conferir (git ilegível vale para qualquer quadro); sem PBI aberto não há o que conferir e ele fecha "ok"; card cujo arquivo não abre ou passa de 1 MB entra como "não conferido" nos dois. Card cujo nome é um ID válido mas cujo frontmatter não dá um `id` válido não é "não conferido" nem some: entra nos dois avisos numa linha própria, `N cards ilegíveis; 3 primeiros: <arquivo>` (veja "Adicionado").

### Adicionado

- **O plano `.md` conta as tasks nos cabeçalhos usuais.** `##` ou `###` com `Task N` ou `TN` (e id com 1 letra minúscula, como `0b`), seguido de `:`, `—` ou `–` (com espaço opcional antes) ou de ` - `, fora de bloco cercado (a cerca é só a que começa a linha com três crases ou três til e fecha com o mesmo caractere; as diferenças para o CommonMark estão em "Limites declarados"). Na forma `Task N` vale 1 anotação entre parênteses depois do id (`## Task 4 (x) —`, também com `_` ou `*` em volta); título com ponto (`Task 1.1`), `####` e texto livre entre o id e o separador não contam.
- **Projeto agrupado por Epic.** Com `fluxo.vinculoPbiEpic.tipo` igual a `frontmatter`, os PBIs abertos são agrupados pelo Epic do frontmatter do card, com cabeçalho `EPIC-n título · a abertos` (o título é o 1º `# ` do card do Epic na pasta de `fluxo.mapeamento.FL2`; sem a pasta ou sem título, só o ID; pasta de Epics com caminho inválido ou ilegível, ou card de Epic que não abre, soma um aviso no painel: "fluxo.mapeamento.FL2 inválido: os Epics saem só com o ID", "fluxo.mapeamento.FL2 ilegível (código): os Epics saem só com o ID" e "Epic <arquivo> ilegível: sai só com o ID"); só quando os PBIs abertos caem em 2 grupos ou mais, e "sem Epic" conta como grupo (o PBI aberto sem Epic entra no grupo "sem Epic", sempre o último). O desenho do agrupamento vale de 72 colunas para cima.
- **Card FL1 ilegível é listado nos dois avisos do doctor.** Arquivo da pasta de `fluxo.mapeamento.FL1` cujo nome (sem `.md`) casa o `idPadrao` (o de `fluxo.idPadrao` na `origin/HEAD`, ou o padrão) mas cujo frontmatter não dá um `id` válido (sem frontmatter, sem `id`, ou `id` que não casa) entra em `fluxo-status-fl1` e em `pbi-mergeado-aberto` numa linha própria: `N cards ilegíveis; 3 primeiros: <arquivo>`. O resto do aviso segue conferido: o card com status fora do quadro e o PBI mergeado continuam listados. Se há só cards ilegíveis e nenhum outro achado, o aviso sai `found: false` com essa linha, e não "ok". Arquivo cujo nome não é um ID (como `README.md`) não entra. Segue aviso: não muda o nível nem o exit code.
- **Altura curta do painel de projeto: uma prioridade nova no meio.** Com pouca altura saem primeiro as linhas de PBI, depois a linha "✓ N feitos" e os cabeçalhos de Epic, por último os totais. Na 2.1.0 só havia 2 níveis (linhas de PBI e totais).

### Limites declarados

- O leitor do plano `.md` difere do CommonMark em cercas: não guarda o comprimento (4 crases fecham com 3), uma linha de cerca com texto depois da cerca também fecha o bloco, e cerca indentada não é reconhecida; a anotação entre parênteses aceita marcas trocadas (`_(x)*`). Registrado em `docs/backlog.md`.
- O vínculo PBI para Epic por MCP não agrupa: só o vínculo por frontmatter agrupa (a leitura por MCP fica sem agrupamento).
- A pendência P1 (opção sem plano entrar ou não na previsão estimada) está resolvida (D-G23): com a chave ligada, a opção fica fora da previsão medida e da estimada; com a chave desligada vale a regra de antes.
- O item 5 da D-G22 segue na GM-17.
- A chave `painel.projeto.opcoesComoContagem` não tem pergunta no onboarding; fica para o 1º pedido de usuário ou a 2ª entrega que a ligar à mão.

## [2.1.0] — 2026-11-17

Versão estável da 2.1.0 (GM-15, fluidez do loop e clareza para quem usa). Tag e release só o dono publica (`next` para `main`). Data da alpha.1 conferida pela data do commit da tag `gabarito-mestre--v2.1.0-alpha.1` (2026-11-15).

### Resumo da GM-15 (por tema)

- **Fluidez do loop**: o loop segue sozinho, lê a CI da main pelo sha do push, retoma depois do `/clear` e o painel/DEPENDE avisam trava de mais de 30 min, contexto alto sem pouso e loop desligado (régua do Stop); nunca pedem `/clear` com o loop desligado.
- **Entrega encerrada e reaberta**: o encerramento vem do merge na main; PR de virada de pré-versão não encerra a entrega, e a visão do que foi entregue usa a versão inteira (nunca truncada).
- **Adiar e cortar**: tasks adiadas e cortadas aparecem no painel; task com reabertura de origem inválida aparece como `?` nomeando a causa e não derruba pouso nem trilha.
- **Visão de projeto**: render e CLI da visão de projeto, com o rótulo único "agente fora do loop".
- **ETA**: previsão em faixa, com motivo.
- **Painel**: o painel da entrega atual não traz item de entrega anterior.
- **Robustez do loop (T34)**: o mod relê o id da sessão após `/clear`; `loop.mjs abrir` recusa base fora da entrega e `fechar` apaga só branch sem commit próprio; o dono reverte o julgamento da Sombra por `/emenda aprovar|rejeitar`; a suíte do mod roda depois dos gates, com teto de 3x a mediana medida.
- **Sombra libera por progresso (T36)**: sem limite numérico de liberações; a decisão do teto é uma função só (progresso medido, abordagem nova, freios por abordagens esgotadas e orçamento); o dono pode reverter emenda já aplicada e a spec fica divergente (`?` no painel).
- **Contribuições do Allan**: PRs #19 (autonomia do orquestrador na guarda, agora "projeto E máquina") e #20 incorporadas.

### Limites declarados

- Pré-versão não encerra a entrega: a GM-14 continua não encerrada até a 2.1.1 (D-G20, D-G21); o painel da GM-14 é limite até lá.
- Só 1 emenda é desfeita por edição (T36).
- Tokens por task seguem sem produtor (T36): o orçamento por task não usa tokens medidos.
- Pré-versão com versão no título: o PR de virada de pré-versão não encerra a entrega, mas um PR de virada **sem a versão no título** cuja release é prerelease ainda encerra (`guarda.ts:218`, "release prerelease não é medido"); vai à 2.1.1.
- Encerramento antecipado: um hotfix com o ID da entrega no título, mergeado na `main` no meio da entrega, a encerra; o dono reabre com `reabrir-entrega`.
- O PROJETO do painel ainda mostra a GM-14 em 98 % (57 de 58), porque ela não encerra até a 2.1.1 (D-G20, D-G21).
- S1 REFUTADA (medida): a busca por título no `gh` tem recall 1/2 na GM-13/GM-14 e precisão 8/15; o critério com ID exato e fronteira tem precisão 8/8. Efeito: o PR da virada precisa levar o ID da entrega no título; PR de virada sem o ID no título não é achado e a entrega não encerra por ele.
- S4 REFUTADA (medida, T20): o mod não consegue ler a própria versão carregada. Efeito: o `harness-doctor` diz "versão do painel carregado: não conferível" e manda reabrir o CLI depois de atualizar; nunca diz "ok".
- S8 REFUTADA (medida, T20): não dá para rodar um `/clear` real no CI. Efeito: a fumaça do pouso no CI simula o par `sessao.pouso` seguido de `sessao.inicio {origem: 'clear'}` e confere a retomada pelo `proxima`; o `/clear` real não é provado no CI e fica provado 1 vez por release, numa sessão local, com evidência anexada.
- R5 da guarda (PR #19, é grep, não sandbox): nome do interruptor montado por variável ou concatenação não é pego; abreviação de opção do git e execução por config ou ambiente (`core.pager`, `GIT_EDITOR`, `sequence.editor`) não são classificadas; falta no corpus o caso de alias do git com `!` que cita as áreas protegidas. Só o orquestrador passa, e cada passagem fica no diário.
- Aceites A2 e A1 **pendentes, não medidos**: a alpha.1 prometeu que a 2.1.0 só sairia depois do aceite A2 (quem nunca programou) e a alpha.2 deixou regravar o A1 no aceite da final. Não achei registro de A2 nem de regravação do A1 nas specs, decisões e commits da GM-15 (só o avaliador do A1 foi ajustado ao desenho do E4, T29). Por isso a 2.1.0 não declara A1 8/8 nem A2 feito; ficam como pendência explícita para o dono decidir antes de publicar.

### Adicionado (autonomia e guarda)
- **Autonomia do orquestrador na guarda: precisa do projeto E da máquina (GM-15 T15, REQ-AUT-2 b).** A guarda só deixa o `ask` do orquestrador passar quando as duas coisas valem: `guarda.autonomia` = `"orquestrador"` no `harness.config.json` lido de `origin/HEAD` (o projeto pede; exige merge) **e** o interruptor por máquina `~/.claude/gabarito-autonomia.json` (`{"orquestrador": true}`, protegido pelo anel integridade). Só um dos dois não basta: continua `ask`. A pergunta que grava `guarda.autonomia` é a única de autonomia do onboarding (3 respostas, 4 chaves; GM-15 T14).
  - Com os dois ligados, todo `ask` do orquestrador passa em silêncio e grava o evento `guarda.autonomia_usada` no diário (só anel, alvo, ação e ambiente; nunca o comando).
  - Continuam pedindo, mesmo com os dois ligados: anel `segredo`, exceção de classificação, comando acima do teto (65.536) e `cd` perdido.
  - Subagente continua `deny`.
  - O `harness-doctor` mostra as 4 chaves de autonomia, a "autonomia mista" e o descompasso nos dois sentidos (o projeto pede e a máquina não liga; a máquina liga e o projeto não pede).
  - Mudança sobre a PR #19 (Allan): a regra era "um ou outro" (`||`) e passou a "os dois" (`&&`); o evento `guarda.autonomia` virou `guarda.autonomia_usada`.

### Mudado
- `git fetch` comum do orquestrador (remoto de nome simples, sem refspec com `:`/`+`/`refs/`, flags de uma allowlist) não pede mais confirmação.

### Segurança
- Viram anel integridade (`deny` para subagente):
  - escrita no interruptor por qualquer caminho (Write, Edit, redirecionamento, `tee`, `cp`, `mv`, interpretadores, glob);
  - escrita em `refs/remotes`/`packed-refs` por interpretador;
  - `git branch -d/-D -r` e `-m` sobre ref remota;
  - `git rebase -x` e `-c alias.*=!` que citam essas áreas.
- Os testes que sobem `dist/guarda.js` usam `HOME` próprio em tmp e não dependem mais do `$HOME` real.

## [2.1.0-alpha.2] — 2026-11-15

Hotfix do painel (GM-15, decisões do dono D-G1, D-G1a, D-G1b, D-G1c e D-G4).

### Corrigido

- **Painel volta à cara da 2.0.0 com a regra da 2.1**: o desenho de 5 blocos da 2.1.0-alpha.1 deixou de mostrar dados que o painel da 2.0.0 mostrava, sem decisão do dono. Voltam o PLANO com a fila de tasks e a faixa de progresso, a EQUIPE em árvore com a barra de contexto da sessão, as barras dos limites de 5 h e de 7 dias, contexto e tokens de cada agente, a narração e as cores (por agente, por estado da task, do CI e das barras). Continuam valendo as regras da 2.1: só agentes vivos de verdade, "?" quando não há medição (nunca número inventado), "depende de você" e atenção verdadeiros, histórico com a origem e o mais novo no topo, "hora de pousar" nunca cortada. Os itens de ATENÇÃO que não cabem numa linha passam para a seguinte sem sumir. Botões só nos itens de "depende de você". Teste de paridade com a 2.0.0, validação em 120/100/80/60/44 colunas e 33 mutações.
- **Painel no app desktop**: ficava em "painel: lendo…" para sempre, porque o app hospeda o Claude Code via SDK (`session.start` com `isInteractive: false` e sem superfície). O painel agora passa a ler quando uma superfície se anexa (`session.attach`), quando a Pane é desenhada ou o `session.start` já enxerga uma superfície (`$.session.surfaces()`), ou quando a pessoa digita `/gabarito painel`. Em `-p` sem superfície nada muda: não lê. Contribuição de Allan Rolli (PR #20).
- **"Limpar a conversa" que não sumia**: em branch fora do padrão de tipos (ex.: `hotfix/GM-15-alpha2`), o cartão de sessão não reconhecia a entrega e gravava o `/clear` fora do diário dela; o pouso nunca fechava e o painel e o `loop.mjs proxima` pediam `/clear` para sempre. O cartão e o hook Stop agora inferem a entrega pela mesma regra do loop (`idDaBranch` + `idPadraoDe`).

### Limites

- A comparação do aceite A1 com a gravação da sessão real feita no desenho de 5 blocos fica pendente: regravar no aceite da 2.1.0 final.
- A 2.1.0 final segue em construção (GM-15): fechamento da entrega pelo merge na main, tasks adiadas, previsão exata, visão de projeto e chat em linguagem natural.

## [2.1.0-alpha.1] — 2026-11-15

Pré-versão da 2.1.0 (clareza para quem usa). Não é a versão estável: a 2.1.0 só sai depois do aceite de quem nunca programou (A2) e da publicação pelo dono (`next` para `main`).

### Adicionado

- **Onboarding em linguagem simples**: as perguntas da instalação usam palavras do dia a dia e explicam cada opção. Inclui a oferta do **modo foco**, que deixa o chat mais limpo e pode ser recusada (o foco só liga com sua resposta, em `.claude/settings.local.json`, e se desfaz).
- **Um painel só, acima do input ou ao lado**, em toda fase (spec, plano, execução, revisão) e fora de entrega. Mostra a trilha da fase e o progresso, o que depende de você (com botão que põe o comando no input sem enviar), os agentes vivos com nome, descrição e task, e a decisão da Sombra registrada. Em janela estreita (abaixo de 144 colunas, ao lado) o painel avisa de quantas colunas precisa e `/gabarito painel` o abre dentro do chat.
- **Linguagem natural no chat e no painel**: as linhas de ferramenta viram frases ("lendo o arquivo X") e todo evento do diário mostra a origem (você, agente, medição).
- **Perguntas com botões**: mudança de assunto e ideia nova do dono viram pergunta com botões; a resposta chega ao diário (`dono.resposta`). `loop.mjs anotar` registra ideias sem despachar.
- **Pouso de contexto no teto, sem depender do dono**: o mod limpa a conversa sozinho quando o contexto passa do limite e só dá o pouso por bom quando a sessão nova mede abaixo do limite; se o `/clear` não aconteceu, repete (até 3 tentativas por fronteira, registradas no diário).
- **Loop mais fluido**: `iniciar --modelo`, recusa clara do papel de spike, reentrega com motivo, `integrar` com sha já na base, aprendizado que sobrevive a update, entrega publicada não recebe gravações, Sombra pode liberar o teto de rodadas uma vez por task, spec lida do checkout da sessão.
- **Aceite A1 automático** (`gates/test/e2e/conversa-2026-11-11/rodar-a1.mjs`): refaz a conversa de 11/11 numa cópia isolada, em 8 combinações (local do painel × 80x24 ou 180x50 × tela cheia ou não), lendo a TELA da sessão real, mais 2 conversas completas e replay offline. O agente da célula nunca vê o repositório real; o runner prova antes e depois que ele ficou intocado.
- **Fixture do A1 em entrega ativa (T55)**: a conversa roda numa entrega GM-13 ativa; a publicada fica vigiada pela asserção 8c, em outra entrega, e o `gh` da célula não vê PR na branch da conversa.
- **Aviso sozinho na linha única do painel (T56)**: sem botão do topo, e o aviso sai inteiro em 80 colunas.
- **Runner do A1 recusa diálogo de permissão (T57)**: detecta o diálogo no tty real, nunca sai com ele aberto, e valida cada fala 1:1 com o `dono.mensagem` gravado (uma por janela de 120 s do mesmo texto).

- **Medição e escrita só com onboarding (T60, REQ-DIA-1)**: o mod e o painel só gravam em `.harness/` (`contexto/<sessao>.json`, `painel-medir.json`, `fato.medido` no diário, inclusive `_sem-id`) e só chamam `gh` (`pr list`, `release list`) em repositório com onboarding, o mesmo critério da guarda (`harness.config.json` em `origin/HEAD` ou na árvore local; uma função só, `temOnboarding`). Sem onboarding o painel só lê, como na 2.0.0: nenhuma escrita em `.harness/`, nenhuma chamada a `gh`, e o resto do painel segue visível. Sem onboarding não há `.harness/contexto`, então o loop não recebe percent de contexto, como na 2.0. Corrige o MAJOR-2 do review final.

### Aceite A1 (spec:154): REPROVADA

A 2.1.0-alpha.1 **foi reprovada no aceite A1 completo** e sai como **A1 parcial declarado**, por decisão do dono em 2026-11-15 (anotado pelo orquestrador; emenda 65 aprovada pela Sombra com condições). Ela **não** é declarada aceita pelo A1; o A1 8/8 continua sendo o aceite da 2.1.0 final. Resultado da 3ª matriz, por grupo:

- **Sessões curtas (asserção 12, placement da Pane): 8/8.**
- **Conversa lateral 180x50 cheia: falha 3, 4, 5, 6, 8b, 8d, 8e, 8f, 9 e 11.**
- **Conversa acima 180x50 cheia: falha as mesmas e também a 10; a célula morreu no teto de tempo.**
- **Replay: sem medida válida.**
- **Asserção 2: "RECENTE 0" na avaliação offline.**

Classe de cada falha, caminho da evidência, tabela e veredito do diagnóstico: `docs/ledgers/GM-14.md`, seção "T25: aceite A1, 3ª matriz". O que fica para a 2.1.1 (redesenho do A1, asserções 6 e 11) está lá também. As condições da spec:155 seguem valendo para a alpha.1: CI 100 % verde, review final (Fable) e PR da alpha.1 para `next`; a 2.1.0 em `main` só o dono publica.

### Limites declarados

- **Herança da 1.x** (leitura das regras antigas, A3) e a coleta correspondente (T8): adiadas para a 2.2.
- T41 (fluidez adicional do loop): vai para a 2.1.1.
- **Pedido de confirmação falso da guarda em git só de leitura**: consultar o e-mail configurado no git (`config --get`, `--get-all`, `--show-origin`) e listar remotos (`remote`, `remote -v`) pedem confirmação como se fossem escrita no `.git/config` (`gates/src/aneis.ts:578,771-773`). Cortou 4 turnos na conversa lateral do A1. Correção na 2.1.1.
- **Pergunta com botões do condutor** (`AskUserQuestion`) é registrada como pedido de permissão (achado MINOR da T57). Correção na 2.1.1.
- A1 isolado (T49): o plugin observador não enxerga a Pane de outro plugin, então o local lateral é medido pela tela, não por propriedade do mod; o resultado vale para o commit em que rodou e para a versão do Claude Code medida.
- A1 em 80 colunas (T52): com PAROU ou pergunta aberta, o aviso do painel lateral não aparece inteiro; ele só aparece depois que a pergunta é respondida (decisão do dono).
- Pouso automático (T53): a confirmação depende de a sessão nova medir o contexto em até 120 s; sem leitura, o mod mede de novo e não confirma.
- Push e PR no modo `auto` e o redesenho do painel após 30 s sem byte novo continuam sem medição própria.

## [2.0.0] — 2026-11-11

Versão estável da 2.0. Quem está na 1.1.x: leia `docs/virada-2.0.md` (como atualizar, o que rodar de novo e como voltar). Resumo do que muda para quem usa:

### Adicionado

- **Fluxo Gabarito**: é o nome da organização do trabalho (Iniciativa, Epic e PBI) em todos os textos. A conformidade confere cards e specs contra esse fluxo.
- **Instalação e onboarding em uma fase só**: `gabarito-instalar` detecta o que o repositório já mostra, faz uma prévia e pergunta no máximo cinco coisas (política de entrega, autonomia em produção, perfil de modelos e até duas dúvidas que a detecção não resolveu). Não há mais passos a colar no terminal. Quem veio da 1.1.x roda de novo.
- **Perfis de modelo**: o perfil escolhido na instalação (economia, padrão ou qualidade) define o modelo de cada papel (implementador, revisor etc.). O doctor avisa quando um papel fica abaixo do recomendado.
- **Entrega conduzida em loop** (skill `gabarito-loop`): a partir de um plano (`plano.json`), o agente despacha uma task por vez em uma worktree própria, exige review adversarial com mutações, integra e confere o CI, e registra tudo num diário da entrega. O número de tasks em paralelo vem da medição da máquina (`capacidade.mjs`); sem medição, 1.
- **Sombra**: um agente que responde às dúvidas do loop só a partir da spec, citando a fonte, para não interromper o dono. Regra de negócio sem fonte na spec não é inventada: vira proposta de emenda, que o dono aprova ou rejeita.
- **Spec aprovada pelo dono**: `/gabarito-mestre:aprovar` grava a aprovação (com o sha da spec; se a spec mudar, aprova de novo). Mudança de spec no meio da entrega entra por emenda (`/gabarito-mestre:emenda aprovar|rejeitar <n>`), e o limite de rodadas de review só o dono libera (`/gabarito-mestre:liberar <task>`).
- **Painel no terminal** (precisa do mod do Claude Code): abre sozinho ao lado, em terminal largo, quando uma entrega começa. Mostra o plano, a equipe (contexto e tokens de cada agente) e o histórico, e a faixa acima do prompt traz o que depende do dono, com o comando inteiro. O que não foi medido aparece como `—`, nunca como zero. `/gabarito` lista as opções: `painel esquadrao` (detalhado), `painel executivo` (resumido), `color`/`mono`, `narracao on|off`, `nomes <pacote>`, `ligar`/`desligar`, `pausar` e `retomar`. Sem o mod, `pausar` e `retomar` continuam valendo e o painel não existe.
- **Pouso de contexto**: o agente marca o ponto em que dá para limpar o contexto; depois do `/clear`, o resumo de início de sessão traz a linha de retomada e o loop segue de onde parou. Com o painel, isso é automático; sem ele, o agente pede ao dono, em uma linha, que digite `/clear`.
- **Aprendizado do agente**: ao fim de um erro ou de um acerto, o agente registra a regra (ou registra que não há regra a tirar). Regras comprovadas voltam sozinhas ao resumo de início de sessão, às instruções do papel a que se destinam e à conferência de spec nova. O doctor avisa de aprendizado pendente, de papel que não existe mais e de hipótese velha.
- **Registro de decisões**: `loop.mjs registro` gera o `registro.md` da entrega (aprovação da spec, decisões da Sombra, emendas, liberações do dono, desvios, descobertas e aprendizados), sempre igual para o mesmo histórico.
- **Catálogo de ferramentas de planejamento**: entrada da **Mesa**, gerenciador local de projetos com servidor MCP (`mcp__mesa__*`), com card de Iniciativa e de Epic e busca do card pelo `cardTaskId`. Contribuição de Allan Rolli (PR #12).
- **Doctor**: linhas `loop: mod ativo | sem mod` e `db: declarado | n/a`; "mod ativo" exige prova da sessão, não basta o mod existir.
- **Base do PR da entrega**: o PR vai para a base escolhida no onboarding. Se a `main` remota ainda não tem essa escolha, a base é lida do `harness.config.json` commitado na branch, e a entrega avisa de onde ela veio. Só a base é lida da branch: as regras de produção continuam vindo da `main` remota.
- **Push e PR sem pedir de novo**: a regra R1 do `AGENTS.md` ganha uma exceção. Com entrega por PR, a spec aprovada vale como ok para o push da branch e para abrir o PR. Merge, deploy, release e tag continuam pedindo ok. Limite: um repositório com o `AGENTS.md` da 1.1.0 só ganha a exceção ao aplicar o `AGENTS.md.novo` da 2.0.0; até lá o loop para antes do push e do PR e dá ao dono os comandos. Push e PR no modo `auto` não foram medidos.

### Alterado (quebra de comportamento em relação à 1.1)

- **Hook único da guarda** (`gates/dist/guarda.js`) substitui `guard-destructive.sh` e `guard-production.sh`. Ele só pede confirmação (`ask`) ou nega (`deny`) em segredo, integridade do harness e escrita em produção; comando destrutivo local vira evento no diário, sem barrar. Nunca devolve `allow`.
- **Escape hatch removido**: as variáveis `GABARITO_ALLOW_*` deixaram de existir e nenhuma mensagem explica contorno. Para rotina de produção autorizada, use `guarda.producao.permitidos` em `harness.config.json` (lido de `origin/HEAD`).
- **`gate-task.mjs`** confere a árvore de trabalho com arquivos novos e ignorados, independente da configuração local do git.
- **Nome do catálogo**: o catálogo é `gabarito-mestre` (na pré-versão era `gabarito-mestre-next`). Quem testou a pré-versão deve remover o catálogo antigo (veja `docs/virada-2.0.md`).
- Versão `2.0.0` no plugin e em `gates/package.json`.

### Limites conhecidos

- Os aprendizados e o `registro.md` ficam no repositório local; não chegam a um clone novo (previsto para a próxima versão).
- A integração com ClickUp e o modo automático não foram ensaiados de ponta a ponta antes desta versão.
- Quando 1.1.x e 2.0 ficam instaladas ao mesmo tempo com o mesmo nome, a documentação do Claude Code diz que os hooks de um deles são deixados de fora, sem dizer qual: deixe uma só.

## [1.1.0] — 2026-09-25

Camada de fluxo (Workflow TRUE: Flight Levels + Kanban), onboarding na instalação, versionamento trunk-based como gate,
orquestração por subagente com paralelismo medido e contexto em camadas. **Aditiva sobre a 1.0.1**: nenhuma regra, gate,
hook, skill ou agente removido (ADR-CTX-1: texto do núcleo do `AGENTS.md` migrou para a referência; regra não sumiu).
Repos 1.0.x não mudam até rodarem `instalar.sh --atualizar`.

> **Aviso:** um repositório já em nível 2 ou 3 com o harness 1.0.1 **cai para nível 1** assim que
> `harness-doctor` 1.1.0 rodar, até o onboarding ser refeito — as checagens novas (fluxo, versionamento,
> changelog, tamanho do `AGENTS.md`) contam para o nível 2. Não é regressão do harness: é o doctor medindo
> em vez de presumir. Rode o onboarding para recuperar o nível.

### Adicionado
- **Fluxo** — `reference/fluxo.md` (7 seções: níveis · 8 tipos de card · políticas · movimento · propagação ·
  compromisso/WIP/vazão · métricas medem item, nunca pessoa), instalado em `docs/harness/fluxo.md`; `templates/fluxo/`
  com os 8 cards; `reference/ferramentas-mcp.json`; seção `fluxo` do `harness.config.json` — gravada pelo onboarding,
  nunca pelo template. Regra **R19 — fio condutor obrigatório** (`AGENTS.md §7`).
- **Onboarding** — `gabarito-instalar` em 4 fases (instalação · fluxo · versionamento · orquestração), gatilho por
  `resolvidoEm` de cada fase, detecção da ferramenta de planejamento por MCP (`claude mcp list` + tools visíveis),
  leitura da Iniciativa só com ok em uma linha (I10: existe ≠ ativa; I4: vazio não é prova), escrita na ferramenta
  desligada por default (ADR-FLX-2), `CODEOWNERS` a partir de "Áreas e donos", `docs/fluxo/` quando não há ferramenta,
  modo `--vincular <PBI>`; `gates/scripts/onboarding-config.mjs` (merge chave a chave, `_comment` preservado, `--settings`).
- **Versionamento** — regra **R20** (`AGENTS.md §3`, detalhe em `referencia.md §10`); hook `guard-versioning.sh`
  (branch `tipo/<PBI>-slug` · `wt/<PBI>-<n>` · commit `tipo(PBI): assunto`, inclusive `-m "$(cat <<'EOF' …)"`, `-F`,
  `-am`), escape hatch `GABARITO_ALLOW_VERSIONING` (hatches não cruzam), fail-open sem onboarding;
  `gates/scripts/versionamento-check.mjs` (ignora merge commits; CI com `fetch-depth: 0`); templates
  `PULL_REQUEST_TEMPLATE.md` (fio condutor, banco e deploy, prova, revisor humano), `CHANGELOG.md`, `backlog.md` —
  instalados pelo onboarding só se ausentes; atestado `squash-titulo-pr`.
- **Orquestração** — regra **R21 — orquestrador despacha, não implementa** (`AGENTS.md §6`; velocidade nunca compra
  concorrência); hook `session-card.sh` (SessionStart: cartão ≤ 40 linhas via `cartao-sessao.mjs` — modelo e validade,
  PBI/Epic/Iniciativa, PBIs em voo, slots, doctor em cache, envelhecidos, LER PRIMEIRO, versão instalada × plugin,
  superpowers); hook `remind-orchestrator.sh` (UserPromptSubmit, `lembretePorPrompt`, desligado por default, nunca
  bloqueia); `.harness/fluxo-cache.json`; política de modelo por alias com validade de 90 dias (ADR-ORQ-1).
- **Paralelismo** — `gates/scripts/capacidade.mjs` (cores, load, memória disponível via `vm_stat`/`MemAvailable`,
  disco, processos pesados excluindo a árvore do Claude Code; `slots`; `--calibrar`; `GABARITO_PARALELISMO`);
  `arquivosDeContenda` (serial sem override); `isolamentoWorktree` resolvido no prompt do implementador
  ("Isolamento: porta · schema · namespace — não use outro"); escalada ao usuário após `rodadasAntesDeEscalar`.
- **Doctor** — checagens `fluxo-configurado`, `iniciativa-resolvida` (atestado), `versionamento`, `changelog`,
  `tag-semver` (opcional), `agents-tamanho` (núcleo ≤ 17.291 B, Apêndice ≤ 4.096 B), `paralelismo-calibrado` e
  `warn modelo-resolvido` (aviso, não entra no nível); `--cache` (24 h); linha "checagens novas da 1.1.0: rode o
  onboarding ou declare o nível medido".
- **Instalador** — `--atualizar` (`.novo` + `diff --stat`, aviso de que R19–R21 agora são do harness e as regras de
  projeto passam a R30+, com renumeração no Apêndice), `--atualizar --gates-substituir` (ADR-TIM-1: só `tools/gabarito-gates/`, `.bak`, recusa por hash divergente),
  `--codeowners`; `tools/gabarito-gates/.instalado.json`; emenda do `.gitignore` (`.harness/doctor-cache.json`,
  `.harness/fluxo-cache.json`, `*.novo`, `*.bak`); `scripts/test/instalar.test.sh`.
- **Conformidade** — checklists por tipo de card (Iniciativa, Epic com lista de PBIs, US, Enabler, TechDebt, Tarefa,
  Spike, Bug) citando `fluxo.md §2`; fio condutor no design (`Iniciativa:`/`Epic:` + PBIs) e no plano (`PBI:` único,
  `Epic:`, tipo por task); contenda serial no grafo; fail-open declarado — sem `fluxo.resolvidoEm`, fio condutor é AVISO.
- **Referência** — `referencia.md §3.5` "Camadas de contexto" (orquestrador não lê saída bruta que um subagente possa
  resumir) e `§10` "Versionamento"; `adocao.md §4` "MCP demais no contexto" e `§5` reescrito (orquestração por pessoa
  **com** ownership por área); `prompts.md` com "Isolamento" (Implementador) e "Antes de despachar" (Orquestrador);
  `AGENTS.md §6` com a tabela de 5 camadas de contexto e Apêndice com Fluxo · Versionamento · Modelo · Paralelismo ·
  Isolamento · Áreas e donos.
- CI deste repositório: job `instalador` (`instalar.test.sh`, Ubuntu + macOS) e job `texto` (7 seções de `fluxo.md`;
  R19/R20/R21/R30+ e `§3.7` = 0 no `AGENTS.md`; `§3.5` e "Versionamento" em `referencia.md`; "MCP demais" em
  `adocao.md`; `AskUserQuestion` e nenhum `mcp__` no `allowed-tools` da skill; três `version` iguais; sem `"hooks"`
  em `plugin.json`; sem "77 testes"; lista de nomes da 1.0.1 presente).

### Alterado
- `AGENTS.md`: núcleo com teto de **17.291 bytes** (ADR-CTX-1) — os blocos "Motivo"/"Gate" de R2/R3, os "dois
  incidentes" do §6, "Consequência prática", "Fronteira com UI/UX" e a lista de limites dos hooks do §9 e o comando do
  §0.2 migraram para `referencia.md §5/§11/§12/§3.1`, `adocao.md §1` e README; §7 reescrito (Iniciativa → Epic → PBI,
  **um plano por PBI** — ADR-FLX-1; Ready/Done por altitude); papéis do orquestrador/implementador/revisor; ponteiro
  `§3.7` corrigido para `§3.4`; §8 ganha a revisão das políticas de fluxo.
- **Numeração das regras de projeto (quebra para quem já adotou):** as regras específicas do projeto, no Apêndice do
  `AGENTS.md`, passam de `R19+` a **`R30+`**, porque R19–R21 agora são regras do núcleo. Quem já adotou a 1.0.x e tem
  R19+ no Apêndice precisa renumerar para R30+ e atualizar as referências a elas (`instalar.sh --atualizar` avisa).
- `referencia.md §3.1` (worktree `wt/<PBI>-<n>`) e `§3.4` ("unidade da PR é o PBI"; WIP por nível em `fluxo.md`;
  "Sem sprint, sem timebox, sem WIP formal" removido).
- `adocao.md`: escada de níveis de adoção alinhada ao que o doctor mede de fato; a orientação deixa de assumir uma
  pessoa sênior orquestrando sozinha.
- `hooks/_common.sh`: `gabarito_escape_hatch <ROTULO> <VAR>` (R2 e R3 continuam aceitando uma pela outra — comportamento
  medido da 1.0.1; R20 não cruza), `gabarito_repo_root` (`git rev-parse --show-toplevel`, monorepo em subpasta),
  `gabarito_config_get`.
- `templates/gabarito.yml`: `fetch-depth: 0`, job `versionamento` (Conventional Commits com escopo do PBI e nome de
  branch contra o histórico da PR), nome do job de testes sem número.
- `templates/attest.json`: chaves `iniciativa-resolvida` e `squash-titulo-pr`. `templates/harness.config.json`: só o
  `_comment` (as seções novas nascem no onboarding).
- `gates/package.json`: versão alinhada ao plugin (era `1.0.0`, M12) e `bin` novos.
- `/gabarito-doctor`: explica `warn` (≠ `FALTA` ≠ `--`), a linha "checagens novas da 1.1.0" e `--cache`.
- `gabarito-implementador`: bloco "Isolamento", idêntico ao de `prompts.md`.
- `gabarito-instalar`: `allowed-tools` com `AskUserQuestion`, `Edit`, `Bash(claude mcp list:*)` — nenhum `mcp__*`
  (permissão por chamada, R3).
- `.github/PULL_REQUEST_TEMPLATE.md` deste repositório passa a ser o `templates/PULL_REQUEST_TEMPLATE.md` do plugin.
- README: seções Fluxo, Onboarding, Versionamento, Orquestração e modelo, Paralelismo medido, Contexto em camadas,
  Atualizar de 1.0.x e a tabela "Medições da 1.1.0" (M14/M15); limites declarados novos (hooks de versionamento, raiz
  por cwd em 3 gates da 1.0.1, falso positivo de `ledger-versionado`); contagem de testes medida nesta versão — gates
  268 (241 mjs + 27 ts), hooks 271, instalador 70 casos.

## [1.0.1] — 2026-09-05

Correções do review adversarial independente (2 Critical, 7 Important, 14 Minor).

### Corrigido
- **Hooks — bypass por heredoc sem aspas** (C1): `cat > x <<EOF` + `$(rm -rf …)` passava; agora o corpo só é
  ignorado quando o terminador é citado (`'EOF'`), e linhas com `$(`, crase ou `${` são mantidas.
- **Gates — scripts mudos em caminho com espaço ou acento** (C2): o guard de entrypoint usava `file://` cru e
  `main()` não rodava (exit 0 silencioso). Agora usa `fileURLToPath` + `resolve`.
- **Hooks — falsos negativos** (I1): `{ rm -rf; }`, `then`/`do`, `\rm`, `nohup`, `timeout N`, `bash -c`, `eval`,
  `<<<`, `fs.rmSync(…recursive)`, `shutil.rmtree`, `find -delete|-exec rm`, `rimraf`, `git rm -r`,
  `git reset --hard`, `git worktree remove --force`, `rsync --delete`, `docker rm -f`, `aws s3 rm --recursive`,
  `gsutil rm -r`.
- **Hooks — host com sufixo `-prod` fora de URL** (I2): `psql -h db-prod.example.com`, `prod.internal`.
- **Hooks — menção ≠ acesso** (I3): `grep`, `rg`, `sed`, `echo`, `git log/commit -m` e heredoc de anotação não
  bloqueiam mais; o que vem depois de `|`/`;`/`&&` continua varrido.
- **Escape hatch** (I6): só no início do comando ou no ambiente; motivo ≥ 8 caracteres e ≥ 2 palavras;
  alias `GABARITO_ALLOW_PRODUCTION` para R3.
- JSON do aviso válido com TAB/controles no motivo (M1); stdin vazio/malformado avisa em stderr (M2);
  hooks invocados via `bash "…"` para não depender do bit +x (M3); `instalar.sh` sem `|| true` mascarando o
  doctor, sem `.DS_Store`, com padrão citado (M5); contagem de testes unificada em 77 (I5).

### Alterado
- Pacote de gates renomeado para `gabarito-gates`; exemplos de import em `gates.md` usam caminho relativo (M6).
- Template de CI não liga mais a guarda de migrations por padrão — calibre antes (I7).
- `/gabarito-doctor` prefere a cópia instalada em `tools/gabarito-gates/` (M11).
- `gabarito-review`: `allowed-tools` restrito a `git checkout -- *` (M10).

### Adicionado
- Suíte de testes dos hooks (`hooks/test/guards.test.mjs`, 148 casos) com os corpora do README.
- Seção "Limites declarados" no README e no `AGENTS.md §9`.
- Arquivos de comunidade: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, templates de issue/PR, CODEOWNERS, CI.

## [1.0.0] — 2026-09-05

Primeira publicação: marketplace + plugin com hooks R2/R3, 4 skills, 3 agents, `/gabarito-doctor`, 7 gates
(77 testes), instalador, templates e README com as 13 medições.

[1.1.0]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.1...gabarito-mestre--v1.1.0
[1.0.1]: https://github.com/gabrielnfc/gabarito-mestre/compare/gabarito-mestre--v1.0.0...gabarito-mestre--v1.0.1
[1.0.0]: https://github.com/gabrielnfc/gabarito-mestre/releases/tag/gabarito-mestre--v1.0.0

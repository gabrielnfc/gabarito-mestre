# Referência do harness

Detalhamento de `AGENTS.md`. Consultado sob demanda e **por ponteiro** (`arquivo:linhas`, §3.5), não lido inteiro toda sessão.

As regras (`R*`), invariantes (`I*`) e guardas (`G*`) citadas aqui estão definidas no `AGENTS.md`.
Os incidentes citados são reais e existem para que a regra não precise ser reaprendida pelo mesmo preço.

---

## §2. Documentos: design, plano, ledger, backlog

### 2.1 Anatomia do documento de design

Ordem fixa. Design que pula seção está incompleto, não enxuto.

| Seção | Conteúdo | Por quê |
|---|---|---|
| **Fio condutor** (topo) | `Iniciativa: <ID>` · `Epic: <ID>` · lista dos PBIs do Epic (índice, não plano). Override de Iniciativa: `Iniciativa: <outro ID> (override: <motivo>)` | R19 — design é do Epic; sem `Epic:` é NÃO CONFORME (`fluxo.md §2`) |
| **STATUS** (topo, destacado) | `DESENHO PRONTO · plano ainda não escrito` · `ENTREGA 1 IMPLEMENTADA · 2 e 3 são desenho` | separa ritualmente **o que o sistema faz** de **o que está escrito que fará** |
| **Fato medido** | tabela `M1..Mn`: medição · resultado · quando · autorização (quando tocou terceiro) | fato e desenho nunca dividem parágrafo |
| **Decisões do usuário** | `D1..Dn` — decisão · **alternativa rejeitada e por quê** — marcada *não reabrir* | força justificar o caminho não escolhido; é o que impede rediscussão infinita |
| **ADRs** | `ADR-<família>-<n>`: decisão · racional · **cláusula de morte** quando for exceção | exceção sem condição de encerramento vira precedente |
| **Requisitos** | `REQ-<ÁREA>-<n>` com **Given/When/Then**, gate de permissão, `arquivo:linha` | o critério de aceite é o requisito, não a intenção |
| **Fora de escopo** | item · dono · gatilho | R17 |
| **Testes e gates** | o que prova cada requisito + **mutações que devem derrubar a suíte** | §9 |
| **Rollout** | a ordem **e o motivo dela**; janela de deploy declarada | ordem sem motivo não sobrevive ao primeiro imprevisto |
| **Pendências** | o que ficou aberto, por quê, o que desbloqueia | risco escrito ≠ risco esquecido |
| **Emendas** | datadas, inline no requisito afetado | R16 |

O design passa por **review adversarial antes do plano** (decisão do usuário → design → review adversarial → plano): etapa do ciclo de `AGENTS.md §7`, feita por instância distinta de quem escreveu o design.

**Identificação**

- `REQ-<ÁREA 3 letras>-<n>` — **append-only**: nunca renumerado, nunca reutilizado. Gaps são legítimos (IDs reservados por spec paralela). Emenda de requisito ganha sufixo: `REQ-PED-1b`, `REQ-END-7a`.
- Emenda inline: `_(Emenda AAAA-MM-DD, <origem> — <motivo>)_`.
- Emenda descoberta **durante a execução** leva a marca **`(execução)`** e **vence** qualquer frase anterior que a contradiga — ela descreve o que o sistema faz.
- Requisito morto: `REQ-X-6 — SUBSTITUÍDO por REQ-X-29`. Nunca some.

### 2.2 Anatomia do plano

Cabeçalho `PBI: <ID>` (**um só** — ADR-FLX-1) e `Epic: <ID>` · tasks numeradas, cada uma com `tipo` ∈ {US, Enabler, TechDebt, Spike, Bug, Tarefa} · **grafo de dependências explícito** (é ele que declara o que pode rodar em paralelo) · task que toca caminho de `arquivosDeContenda` marca `serial: contenda` e nunca aparece em paralelo no grafo (R21) · cada task diz **qual requisito fecha** · fases com **gate objetivo em contagem verificável** · **Task 0 = spike** quando há incógnita externa · pré-condições de rollout listadas **antes** da primeira linha de código. Grupos dentro do plano são fases, nunca outros PBIs: dois PBIs, dois planos.

Gate de fase é contagem — *"12 primitivos tratados + 5 substituições + 3 retrofits = fase completa"* — não "parece pronto". Checkpoint humano julga estética, texto e produto; **nunca substitui o checklist**.

### 2.3 Ledger

Um por **PBI** (ADR-FLX-1), em `<ledgerDir>/<PBI>.md` (default `docs/ledgers/`). É o **mecanismo de continuidade entre sessões**: não é diário, é handoff. **Versione-o** (sem segredo dentro) — ledger gitignored morre com a máquina.

````
```
# Ledger — PBI: <ID> · Epic: <ID>   Plano: <caminho>   Branch: <nome> @ <sha>   Spec (autoridade): <caminho>
Rulings herdados: R3, R5, R8...          Contexto externo: (sandbox fora, lane afetada)

## LER PRIMEIRO — <AAAA-MM-DD>
(estado atual em ≤ 5 linhas; reescrito a cada corte de sessão — é o que o cartão de sessão aponta)
## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
## Rulings de pre-flight (F3-R1, F3-R2...)   — decisão + motivo + custo-se-errado
## Progresso
VINCULO <PBI> epic=<EPIC> iniciativa=<INI> <AAAA-MM-DD> fonte=<ferramenta|arquivo>   (gravada por --vincular ao abrir a branch; rastro — nenhum script lê)
MOVIMENTO FL2 <EPIC> preparado→em_execucao <AAAA-MM-DD>       (ao integrar o 1º commit do PBI; <de>/<para> = chaves de fluxo.status.FL2, sem espaços)
DISPATCH Task <N> slots=<slots> worktree wt/<PBI>-<n>        (uma linha por dispatch; slots medido)
Task N: DONE pelo implementador (worktree @ sha; RED→GREEN, contagens, achados/desvios)
Task N: complete (review Aprovado — o que o revisor PROVOU; sha de integração). Minors: ...
BLOQUEADA <AAAA-MM-DD> <motivo> — dono: <quem>               (item não muda de coluna)
## CORTE DA SESSÃO (com motivo)
## FECHO — PR mergeada
| # | Achado | Fix | Review |    + backlog gerado + decisões não escritas
```
````

As linhas `MOVIMENTO`, `DISPATCH`, `BLOQUEADA` e o título `## LER PRIMEIRO` são **lidas por máquina** (cartão de sessão, conformidade): grafia exata, uma por linha, sem markdown em volta. `MOVIMENTO` segue `fluxo.md §5` (propagação); `DISPATCH` vem de §3.1; `BLOQUEADA` de `fluxo.md §4` — bloqueio é marcação, não coluna, e tem dono do desbloqueio. `VINCULO` é **só rastro** — gravada por `gabarito-instalar --vincular` (ORQ-6) ao abrir a branch do PBI; nenhum script lê essa linha.

Cada task registra: quem fez (worktree + sha) · ciclo RED→GREEN com contagem de testes · achados e desvios declarados · veredito de review **com o que foi provado** · sha de integração · "minors" diferidos. Nada implícito.

**O ledger não é dono de nada** (R17): o que precisa sobreviver vira emenda no design ou item no backlog.

### 2.4 Backlog

Arquivo único, versionado, **um formato só**: `| Item | Origem | Gatilho |`. Cabeçalho normativo: *"item sai daqui quando entra num plano ou a decisão de descarte é registrada"*.

**Higiene obrigatória:** item entregue ou revogado é riscado no mesmo merge. Backlog com item morto ensina a ignorar o backlog.

---

## §3. Orquestração

### 3.1 Paralelismo — mecânica

Critério em `AGENTS.md §6` (R21). A mecânica:

Um **worktree git por implementador paralelo**, em branch **`wt/<PBI>-<n>`** criada a partir da branch do PBI — `n` é o índice do worktree (1, 2, …), gravado no nome da branch e no campo `worktree wt/<PBI>-<n>` da linha `DISPATCH Task <N> slots=<slots> worktree wt/<PBI>-<n>` do ledger (§2.3); `slots=<slots>` é o número medido por `capacidade.mjs`, não o índice (`lerLedger` conta como "sem medição" o dispatch sem `slots=<dígitos>`). O mesmo `n` resolve o **isolamento** do implementador — porta `3000+n`, schema `wt_{n}`, namespace `wt-{n}` (`orquestracao.paralelismo.isolamentoWorktree`) — e vai no prompt de dispatch (`prompts.md`, bloco "Isolamento"). O padrão `wt/…` é o único nome de branch sem tipo que `guard-versioning.sh` aceita (`versionamento.branchWorktree`). Motivo do isolamento: hooks fazem stash, commits concorrentes corrompem o index, e a suíte de um vê arquivo meio-escrito do vizinho. **O isolamento só vale em dispatch com worktree** (paralelo); dispatch serial no checkout do próprio orquestrador não usa porta, schema nem namespace próprios.

**Quantos ao mesmo tempo:** `slots` de `capacidade.mjs`, medido **antes de cada dispatch** (`prompts.md`, "Orquestrador — antes de despachar"): `min(simultaneos, teto, o que a máquina permite)`, nunca < 1; `GABARITO_PARALELISMO=<n>` substitui `simultaneos` na sessão, ainda sob o `teto`. Item entra quando um sai. Dispatch sem linha `slots=` no ledger é achado de review — o cartão de sessão avisa "dispatch sem medição".

**Contenda:** task que toca qualquer caminho de `orquestracao.paralelismo.arquivosDeContenda` (lockfile, `prisma/`, barrel, `docs/fluxo/`) é **serial** — o plano marca `serial: contenda`, `gabarito-conformidade` reprova grafo que a paraleliza, e não existe override em runtime: nem "é rápido", nem "é uma linha".

O orquestrador integra com `merge --no-ff` **na ordem do grafo** — são esses merge commits, de dois pais, que `versionamento-check.mjs` ignora (§10, "Versionamento"). O revisor roda sobre o **diff integrado**, não sobre o worktree. Conflito é raro por construção (arquivo disjunto é pré-condição) e, quando ocorre, o orquestrador resolve ou serializa e reexecuta a segunda task sobre a base nova.

**Escalada:** task reprovada `rodadasAntesDeEscalar` vezes (default 2) vira `BLOQUEADA <data> <motivo> — dono: <quem>` no ledger e o orquestrador **escala ao usuário** com o custo estimado das opções — nunca uma terceira rodada em silêncio (`fluxo.md §4`, bloqueio é marcação).

**Os dois incidentes que tornaram "recurso compartilhado é serial" uma pré-condição dura** — e o motivo de `AGENTS.md §6` dizer que não há override:

- **Três lanes de integração externa simultâneas:** colisão de namespace no sandbox compartilhado + degradação em rajada — leituras puras voltando vazias, cascateando para suítes ditas "locais". Regra que sobrou: espaçar lanes e **partir a lane hermética da não-hermética**.
- **Worker ligado durante a suíte:** o worker consumiu em paralelo o job que o teste enfileirou — corrida de status, erro de anti-duplicidade no externo e **quatro registros órfãos** que escaparam do teardown por id. Virou **guarda de partida no código da suíte**: falha alto se detectar worker vivo.

### 3.2 Review por task × review de entrega

**São processos distintos, não o mesmo em escalas diferentes.**

- **Por task:** revisor adversarial sobre o diff daquela task. Mutação obrigatória. Veredito binário. Achados **BLOCKER · MAJOR · MINOR**, numerados, com `arquivo:linha` ou medição.
- **Da entrega:** varredura de pontas soltas **no código, nunca só pelos relatórios** · gates completos (format, lint, build, unit, integração, qualidade, golden) · auditorias temáticas quando o assunto pede.

Um não substitui o outro — comprovado: um review final pegou **claim falsa no ledger** (um mapa "adicionado" que nunca foi) que todos os reviews por task deixaram passar. **Relatório de subagente é alegação, não prova** (R18).

Todo achado é emendado no texto ou registrado como limitação aceita com racional. Achado que "some" entre rounds é regressão de processo.

### 3.3 Fronteira de sessão e handoff

Uma entrega por sessão é **hábito forte, não regra** — planos grandes atravessam duas ou três.

**Obrigatório ao fim de sessão:** (1) estado atualizado com seção datada *LER PRIMEIRO*; (2) ledger atualizado; (3) pendências explícitas com dono; (4) o "estado atual" do repositório entra na **PR da entrega**, nunca em commit avulso.

**Handoff não tem documento próprio: plano + ledger SÃO o briefing.** Agente novo recebe **ponteiros** (spec do requisito com arquivo e linhas, task do plano, este harness) — nunca o conteúdo copiado. Orquestrador novo lê *LER PRIMEIRO* → estado atual → e **revalida por medição** (I6).

### 3.4 Cadência e unidade de PR

**Cadência é fluxo contínuo** — sem sprint e sem timebox. A estrutura é a dos três níveis de `fluxo.md §1`: **Iniciativa (FL3) → Epic (FL2) → PBI (FL1) → tasks do plano**. Limite de trabalho em andamento existe e é explícito, por nível: o **WIP de FL1 é por coluna e definido pelo time em `fluxo.md §6`**; **PBIs em voo ≤ WIP FL1 do time**; **implementadores simultâneos ≤ `paralelismo.simultaneos`**, medido a cada dispatch (§3.1). Leituras e spikes paralelos são livres — não ocupam slot nem coluna. Vocabulário: `simultaneos` é máquina; "PBIs em voo" é Kanban; "worktrees vivos" é medição — nunca "WIP" sem qualificador.

**A unidade da PR é o PBI** (ADR-FLX-1): branch, plano, ledger e PR são por PBI, e o título da PR é o cabeçalho Conventional Commits que vira o commit de squash (§10, "Versionamento"). Um Epic tem N PBIs, cada um com o próprio plano; o design do Epic lista os PBIs, não os planeja. PBI é concluível em poucos dias — se não é, eram dois.

O custo de abrir PR a mais é medido, não teórico: com branch obrigatoriamente atualizada e auto-merge desligado, mergear N PRs é **serial** — cada merge deixa as outras atrás, exigindo atualização + CI novo, e cada merge com código dispara um deploy que se espera **verificar** antes do próximo. Por isso a unidade é o PBI, não a task.

**PBI que exige PR própria mesmo pequeno:** *(1)* tem migration — a volta é diferente e a esteira tem ordem própria; *(2)* é Bug em produção (hotfix: `fix/<PBI>`) — fura a fila sem carregar trabalho inacabado; *(3)* precisa subir em ordem — se o deploy tem etapas, a PR acompanha; *(4)* toca escrita em sistema externo, RBAC ou segurança — não por tamanho, por **atenção**; *(5)* está incerto ou com revisão contestada — o que pode ser reprovado sai do lote. Um PBI que reúna dois desses motivos é sinal de que eram dois PBIs.

**Travas:** nunca abrir segunda PR de um PBI que já tem PR aberta · passou de ~15 arquivos de produção, **pare e pergunte** se dá para cortar (sinal para pensar, não regra dura — uma PR de guarda de segurança tinha 54 arquivos e era indivisível) · PBI mais longo ⇒ branch mais velha, sincronize a cada merge em `main` · **tamanho não é o risco real**: naquela PR de 54 arquivos a regressão que quase passou era de runtime, invisível para unit/build/qualidade e pega só pela lane de integração. **PR que toca ORM ou contrato exige a lane de integração antes de ser declarada pronta.**

### 3.5 Camadas de contexto

Tabela em `AGENTS.md §6`. A janela de contexto é recurso finito, dividido entre regra, estado e trabalho; o harness a separa em cinco camadas e cada agente carrega só as suas.

- **Camada 0 — núcleo.** `AGENTS.md` inteiro, toda sessão, via `@AGENTS.md`. Tem teto de bytes (ADR-CTX-1: 17.291 no núcleo, 4.096 no Apêndice — `contexto.nucleoMaxBytes` / `contexto.apendiceMaxBytes`), medido pelo doctor (`agents-tamanho`, n2). Conteúdo novo empurra detalhe para cá ou para `fluxo.md` — **texto migra, regra não some**. O teto sobe só por decisão registrada com medição de impacto.
- **Camada 1 — cartão de sessão.** ≤ 40 linhas injetadas no SessionStart por `session-card.sh` (`cartao-sessao.mjs`): modelo e validade, branch e sha, PBI/Epic/Iniciativa, em voo, worktrees, slots, nível do doctor em cache (24 h), envelhecidos, `LER PRIMEIRO` do ledger, versões instalada × plugin. É **estado**, não regra; nunca substitui o ledger. Sem onboarding, é uma linha.
- **Camada 2 — referência por ponteiro.** `referencia.md`, `fluxo.md`, spec e plano entram por `arquivo:linhas`, na seção que a pergunta exige, nunca inteiros. Quem despacha passa ponteiros; quem recebe lê o trecho (§3.3).
- **Camada 3 — subagente isolado.** Implementação, spike, review e exploração pesada rodam em contexto próprio (R21). Para o orquestrador volta **só o relatório** (≤ 25 linhas, cada afirmação marcada (a)/(b)); o resto morre com o subagente.
- **Camada 4 — handoff por ledger.** Entre sessões, o que sobrevive é o ledger com `LER PRIMEIRO` datado (§3.3). Contexto que não foi para o ledger não existe na sessão seguinte.

**Regra: o orquestrador não lê saída bruta que um subagente possa resumir.** Log de suíte, diff extenso, resultado de busca ampla, documentação de terceiro — vão para um subagente que devolve o resumo com `arquivo:linha`. O orquestrador lê bruto só o que precisa julgar por si: o veredito do revisor, a linha do ledger, a linha do gate que reprovou. Relatório é alegação (R18): o que precisa de prova, o orquestrador confere por medição pontual (`grep`, um teste, um `git show`), não por leitura integral.

**Antes de despachar** (a sequência completa em `prompts.md`, "Orquestrador — antes de despachar"): `capacidade.mjs` → `slots`; no ledger, `DISPATCH` sem `DONE` correspondente → em voo; `git worktree list` → vivos; só despacha se em voo < slots; registra `DISPATCH Task <N> slots=<slots> worktree wt/<PBI>-<n>`.

**Servidores MCP** também ocupam a janela: cada servidor conectado injeta a descrição de todas as suas ferramentas em toda sessão. Escopo de projeto (`.mcp.json`) só com o necessário — `adocao.md §4`, "MCP demais no contexto".

---

## §5. Guardas — mecanismo e parâmetros

Os números abaixo foram calibrados num projeto real. **Meça antes de ligar** (`adocao.md §3`).

Índice — a linha por guarda que vivia no `AGENTS.md §5` até a 1.0.1 (migrou para caber no teto do núcleo, ADR-CTX-1). Seis já são código em `tools/gabarito-gates/` (instalação em `gates.md`).

| # | Guarda | Em uma linha |
|---|---|---|
| **G1** | leitura truncada | helper único que pagina até a página incompleta e **lança** em vez de devolver censo parcial |
| **G2** | leitura vazia | leitura vazia com estado local a proteger ⇒ **no-op + warn estruturado**, nunca limpeza |
| **G3** | mutação em massa | recusa filtro sem condição efetiva **e** `undefined` em qualquer profundidade; escape hatch nominal com motivo obrigatório — `mass-mutation-guard.ts` |
| **G4** | massa suspeita | passada que muda uma fração grande do estado conhecido ⇒ zero updates + warn |
| **G5** | tenant | 404 uniforme para cross-tenant; chokepoint único por domínio |
| **G6** | config parcial | `PATCH` lê o **body cru**: chave ausente preserva, chave presente vale — inclusive `null` explícito |
| **G7** | trava de boot | recusa subir com ambiente inconsistente; discriminador é o **host efetivo**, nunca o nome do ambiente — `production-host-guard.ts` |
| **G8** | migration | grep (não parser): destrutiva exige plano de volta; migration aplicada não pode sumir do repo — `migrations-guard.mjs` |
| **G9** | fail-closed declarado | cada indisponibilidade decide explicitamente entre fechar e abrir, **no documento** |

**G1 — leitura truncada.** Helper único que pagina até página incompleta, com teto (ex.: 200 páginas), e que **lança** ao detectar página vazia em posição > 0 ou teto estourado com última página cheia. **Nunca devolve censo parcial.** Página 0 vazia é vazio legítimo. Todo consumidor usa o helper — implementação própria "que devolve parcial com warn" é o drift clássico, e apareceu no repo de origem.

**G2 — leitura vazia.** Sync que deriva remoção de ausência: leitura vazia **com estado local a proteger** ⇒ **no-op + warn estruturado** (`sync=<nome> atuais=<n> lidas=0`), nunca limpeza. Vale para toda leitura externa: API, planilha, arquivo. *Incidente: `0 setadas, 230 limpas` — uma leitura vazia tratada como lista legítima zerou 230 marcações válidas.*

**G3 — mutação em massa.** Recusa *(i)* filtro sem condição efetiva e *(ii)* **valor `undefined` em qualquer profundidade** do filtro, mesmo com outras condições presentes — é a *(ii)* que fecha a classe de bug (R2). Recursão em objetos literais; `AND`/`NOT` bastam um ramo efetivo, `OR` exige todos. Escape hatch nominal e grepável — `allowFullScan(motivo, args)` com **motivo não-vazio obrigatório** e aviso a cada uso. **Sem variável de ambiente que desligue.**

**G4 — massa suspeita.** Passada em que **≥20% E ≥5 registros** (as duas condições) dos que **já tinham estado gravado** mudam ⇒ passada suspeita: **zero updates**, warn estruturado, estado intacto. O denominador exclui quem nunca sincronizou. É assinatura de rota quebrada, não de mudança real.

**G5 — tenant.** 404 uniforme para cross-tenant (R10). 403 reservado a falta de capacidade **dentro** do alcance legítimo. Chokepoint único por domínio, nunca reimplementado por endpoint. Parâmetro de escopo só **estreita**, nunca alarga — proibido ramo que devolve filtro vazio a partir de input do cliente.

**G6 — config parcial.** `PATCH` de config estruturada lê o **body cru**, pré-parse: chave **ausente** preserva o gravado; chave **presente** vale, inclusive `null` explícito (= desconfigurar de propósito). Depois do parse, "não veio" e "veio undefined" são indistinguíveis — por isso o cru. *Incidente: substituição total apagou config em silêncio mais de uma vez.*

**G7 — trava de boot.** Processo recusa subir com combinação de ambiente inconsistente. **O discriminador é o host da conexão efetiva**, nunca o nome do ambiente nem uma variável genérica de "produção" (que costuma valer em staging também). Mapa de ambientes em estrutura congelada — defesa contra chave maliciosa tipo `__proto__`. Fiado nos **dois** entrypoints (API e worker). Recurso que nasce no boot engole "já existe" e **avisa** — e sua existência se confirma por **read-back**, nunca pelo log.

**G8 — migration.** Grep, não parser (I9). Padrão destrutivo ⇒ plano de volta obrigatório no mesmo diretório. **Isentar ação referencial de FK** por lookbehind — sem isso, 11 de 36 migrations davam falso-positivo. **Corte temporal pinado por teste** (senão a primeira PR de integração trava para sempre nas migrations antigas). Bloquear também remoção ou rename de migration já aplicada: ela não pode sumir do repo. Detectar o que é **aditivo na forma e destrutivo no efeito** — flip de `RESTRICT`→`CASCADE` é o furo clássico.

**G9 — fail-closed declarado.** Cada ponto de indisponibilidade decide explicitamente entre fail-closed e fail-open, **no documento**. Indisponibilidade de validação jamais equivale a "validou".

---

## §6. Contratos e dados

**Contratos**

- Schemas compartilhados vivem em **um pacote único** e são a fonte de verdade. O front nunca redeclara schema.
- **Entrada estrita, saída tolerante.** Payload de entrada e regra de negócio: estrito. Contrato de resposta: tolerante a campo desconhecido — é o que permite serviços fora de sincronia. *Se hoje a resposta é estrita, isso é dívida conhecida: cliente estrito + resposta estrita = janela de incompatibilidade a cada campo novo, e nenhuma ordem de subida a elimina.*
- **`.optional()` vs `.default()` é decisão consciente e comentada.** Use default para seção retrocompatível cujo default reproduz o comportamento anterior. Use **opcional, nunca default**, quando os três estados (ausente / null / valor) carregam semântica — um default materializa a chave em todo parse e **mata o fallback que dependia da ausência**, além de forçar a chave no tipo de saída e quebrar literais tipados (inclusive fixtures golden).
- **Toda exceção ao schema estrito é comentada no lugar.** Exceção sem comentário é indistinguível de esquecimento — e foi assim que uma raiz de schema ficou permissiva sem ninguém saber se era decisão.
- Chave opcional se omite por **spread condicional** (`...(x !== undefined ? { x } : {})`) — nunca enviar `undefined` explícito.
- Campo novo em schema estrito consumido pelo cliente = **breaking coordenada**: sobe no mesmo lote, com a **janela declarada no corpo da PR**.
- Todo export novo do barril exige acesso real no teste do barril: schema com parse, função **executada** com asserção, constante com igualdade. O ratchet de cobertura é quem cobra.

**Dados**

- Tenant: coluna `NOT NULL` + unique composta + **FKs compostas**. Isolamento no banco, não filtro de aplicação.
- Dinheiro em **inteiro**; percentual em basis points. Nunca float em regra de negócio.
- Regra de negócio pura (cálculo, classificação) em **pacote sem I/O e sem relógio**, consumido igualmente por servidor e cliente. Paridade provada pelo mesmo vetor nos dois.
- Migration **aditiva por padrão**. Destrutiva ou de dado exige plano de volta com **SQL executável ou declaração explícita de irreversibilidade com o procedimento manual** — arquivo vazio não é plano. E o plano de volta precisa dizer **como reidentifica as linhas**: um `UPDATE` de volta "por estado" só vale se nenhum outro caminho do app produz aquele estado. *Um rollback assim já foi escrito errado e teria reclassificado todo registro normal.*
- Migration de dado sobre tabela grande é **janela humana**, aplicada antes do merge — nunca dentro do timeout do pipeline.

---

## §7. Assíncrono

- Fila `<domínio>.<ação>`. Toda fila crítica: retry com backoff → **DLQ**.
- **Referência de correlação** (8 hex) nos **três** lugares — log, evento da entidade, linha de DLQ — e no corpo da resposta de erro. É o que o usuário informa ao suporte. Erro nunca marcado ganha referência nova com etapa `desconhecida`: **o rastro sempre tem referência**.
- **Exatamente um rastro por falha terminal.** Retry que depois sucede não deixa rastro de falha.
- Recusa explícita e não-retryable termina na primeira tentativa — **mas passa antes pelo read-back** (I3). Falha **não classificada** nunca é terminal: a escrita pode ter chegado ao servidor.
- **Chave de incidente** para colapso de itens repetidos: `ref ?? (operação + erro + payload canônico com chaves ordenadas)`. Sem isso, um job repetitivo ocupa a janela inteira da tela — *1.105 linhas pendentes eram 46 incidentes, um com 883 linhas idênticas, e a falha real ficava fora da janela.* Resolver um item alcança o incidente inteiro; payload diferente nunca é alcançado.
- `jobId` datado por execução. `jobId` fixo de job retido em estado terminal faz o enfileiramento ser **descartado em silêncio**.
- Payload persistido é **redigido** por lista de chaves (`authorization|token|secret|password`) e **capado** (ex.: 4000 chars) com corte marcado. Redação é defesa em profundidade — vale mesmo quando "não deveria" aparecer.
- **Mapa `operação → rótulo` exaustivo, com teste de exaustividade** contra o inventário real de escritores. Fallback genérico existe para linha antiga, nunca para operação viva. **Esse inventário se regera, não se copia** — foi assim que duas operações novas caíram no genérico com a suíte verde.

---

## §8. Erro e observabilidade

**Três camadas, sempre nesta ordem:**

1. **A frase** — o que aconteceu, sem vocabulário interno: nada de nome de campo, slug, unidade interna ou índice base-0 (numeração humana é base-1). Moeda e data no formato local.
2. **O que fazer** — oração imperativa acionável, derivada do **código** do erro, não do texto.
3. **O detalhe técnico** — atrás de disclosure **e de permissão**. Camada, não supressão.

Mais o **código do chamado**, copiável.

- Códigos de erro de negócio vivem numa **allowlist estrita** (enum). Cresce só por emenda de spec. Cada entrada tem mensagem escrita **por nós**, nunca texto repassado do terceiro. Código fora da lista ⇒ mensagem genérica canônica (fail-closed).
- **A frase pronta vem do servidor**; só o que depende do relógio do leitor (tempo relativo) é derivado no cliente — "parado há 12 min" embutido no servidor congela e mente a cada atualização.
- **A mesma frase tem uma fonte só.** Se duas telas mostram o mesmo erro, a função que o descreve vive no pacote compartilhado — texto próprio em cada uma diverge no primeiro ajuste de redação.
- Erro de leitura **nunca** vira estado vazio na tela. Falha de rede ≠ "nenhum item".
- Cliente **fail-closed no parse**: corpo vazio, não-JSON, ou que falhe o schema ⇒ erro de "resposta inválida". Nunca vazar exceção crua nem os detalhes do validador (podem conter fragmentos do payload).

---

## §9. Testes e ratchet

### 9.1 Lanes

| Lane | Onde roda | Gate de PR? |
|---|---|---|
| unit | CI + local | **sim** |
| integração **hermética** (sem segredo externo) | CI, PR | **sim** |
| integração **não-hermética** (ambiente real) | filtro por caminho + noturna + sob demanda | **não** — instabilidade externa; **declare isso**, senão o gate mente |
| guarda de migrations | CI, PR | **sim** |
| qualidade (ratchet) | CI + local | **sim** |
| e2e | CI, PR, **API sem worker** | **sim** |
| e2e contra externo | sob demanda | não |

A partição hermética × não-hermética vem de **fonte única** (uma lista de suítes), não de convenção de nome. Toda lane não-hermética tem **teto de tempo medido** — processo que não sai sozinho trava o runner até o limite da plataforma. Integração roda **serializada**: banco e ambiente externo são compartilhados.

> Uma lane não-obrigatória que fica vermelha por ambiente **não trava merge** — isso é escolha legítima, mas precisa estar escrita. Gate que ninguém sabe que não é gate é pior que gate ausente.

### 9.2 Ratchet

Três gates sequenciais; resumo em markdown; artefato de relatório; saída ≠ 0 se algum falhar.

- **Cobertura** por pacote (lines, statements, functions, branches), regra `atual ≥ baseline − 0,5 pp`. **Guarda fail-closed:** cada configuração de teste precisa declarar explicitamente o universo de arquivos cobertos — sem isso o gate **lança antes de rodar**, porque sem denominador a cobertura infla e o ratchet passa falso-positivo.
- **Duplicação**: teto fixo, calibrado sobre medição real. Sem aceite — teto é teto. Decisão sempre pelo relatório, nunca pelo código de saída da ferramenta.
- **Violações de lint**: `errors > 0` falha **sempre**, mesmo com aceite. `warnings` é ratchet. Métricas de tamanho de arquivo são relatório, nunca bloqueio.

**Run vermelho nunca grava baseline** — nem em bootstrap, nem com aceite. O baseline é commitado e nunca melhora sozinho (R4).

### 9.3 Golden fixture

Trava o formato de um payload crítico com literais **calculados à mão**, arquivo intocável, comparação por string (nunca tipo decimal cru), relógio congelado. **E declara por escrito o que NÃO cobre** — um golden que recebe um valor como argumento prova o formato, jamais a **origem** do valor.

> Golden byte-a-byte só se justifica contra sistema sensível a ordem/bytes. Em projeto normal, snapshot semântico basta.

### 9.4 Mutação

Prática de review, não de ferramenta: **toda mutação prescrita tem que derrubar a suíte**. A mutação é **nomeada no requisito** e **executada pelo revisor**: *"inverter a ordem upload↔hash deve derrubar a suíte"*, *"transformar 401 em ausência deve derrubar a suíte"*, *"remover o filtro de tenant deve derrubar a suíte"*. Requisito que não nomeia sua mutação não está testado — está coberto.

### 9.5 A pergunta do revisor

> **O teste existe e falharia sem a implementação?**

É o que separa cobertura de prova. Casos reais de **verde mentindo**: um teste afirmou por meses que a versão da aplicação não era `0.0.0` — passava sob o runner, onde o arquivo estava alcançável, e a imagem real devolvia `0.0.0`. Outro provava o achatamento de um cálculo e era lido como prova da configuração real.

### 9.6 Outras réguas

- **Relógio injetado**: módulo puro recebe a data por parâmetro; `new Date()` só como default na borda de I/O; relógio falso só quando o código sob teste chama o relógio inevitavelmente, com instante congelado e documentado.
- **Teardown por id, sempre**, com `if (!id) return` (R2).
- **Suíte que usa fila declara worker desligado** — com guarda de partida no código, não em comentário.
- Testes atômicos: independentes, sem ordem implícita, cada um cria e limpa o que usou.

---

## §10. CI/CD e deploy

**Jobs mínimos:** unit · integração hermética · guarda de migrations · qualidade · e2e. Todos **obrigatórios no ruleset da branch** — check que não trava merge não é gate, é decoração. Declare explicitamente quais lanes **não** são obrigatórias e por quê.

**Guarda de migrations, duas funções:** *(i)* reprovar destrutiva sem plano de volta; *(ii)* **comentar o SQL na PR**, em comentário único e atualizado por marcador, incluindo o plano de volta — para o revisor ler a afirmação de reversibilidade. Push sem migration marca o comentário anterior como **superado**: nunca cria outro nem deixa SQL órfão.

### Versionamento (R20)

Trunk-based (D2 da spec 1.1.0). É o detalhe da linha do `AGENTS.md §3`; entre parênteses, a máquina que sustenta cada item — sem ela, o item é convenção, e convenção não sobrevive a agente autônomo (I12).

- **`main` protegida**, nada entra sem PR (R1; atestado `branch-protegida`, 180 d).
- **Branch curta por PBI**: `<tipo>/<PBI>[-slug]`, `<tipo>` ∈ `tiposComEscopoDePbi`. Mapa tipo de card → prefixo: US→`feat` · Bug→`fix` (hotfix é `fix` com PBI de Bug) · Enabler→`enabler` · TechDebt→`debt` · Spike→`spike` · Tarefa→`task`; `perf` e `refactor` também levam PBI. Sem PBI só `chore|docs|ci|build|test` com slug livre em minúsculas. Worktree de implementador: `wt/<PBI>-<n>` (§3.1). Branch vive dias — PBI é concluível em poucos dias (`fluxo.md §1`). *(`guard-versioning.sh` intercepta `checkout -b|-B`, `switch -c|-C|--create`, `branch <nome>`, `worktree add -b|-B`; `versionamento-check.mjs --branch` no CI.)*
- **Conventional Commits com escopo**: cabeçalho `tipo(escopo): assunto`. Tipo ∈ `tiposComEscopoDePbi` **exige** escopo casando `idPadrao` (`feat(PBI-12): …`); tipo ∈ `tiposLivres` (`chore|docs|ci|build|test|release|revert`) aceita escopo livre ou ausente. A forma `git commit -m "$(cat <<'EOF' … EOF)"` é validada pela **primeira linha do corpo**; `-m` múltiplo, pelo primeiro; `-F <arquivo>`, pelo arquivo. *(`guard-versioning.sh` no commit; `versionamento-check.mjs --base origin/main` no CI; doctor `versionamento` sobre os últimos 20 commits de primeiro pai de `HEAD`, a branch em que roda.)* **Limite declarado (VER-3, b):** o doctor não confere `main` mais a branch atual; commits trazidos por merge de outras branches não são inspecionados.
- **Merge commits do orquestrador são ignorados pelo check.** `merge --no-ff` de worktree (§3.1) gera commit de dois pais com mensagem automática; o check valida só commits de um pai. O que chega a `main` é o squash — o histórico de worktree não sobrevive ao merge da PR.
- **Squash-merge com título CC**: um método de merge só (ver "Deploy"); o título da PR é o cabeçalho do commit que entra em `main` — `tipo(PBI-n): assunto`, primeira linha do `PULL_REQUEST_TEMPLATE.md`. Nenhuma varredura prova que o ruleset exige isso: **atestado `squash-titulo-pr`** em `.harness/attest.json`, 180 d — atestado sem checagem automática (b): nenhum código lê essa chave (o doctor não a confere).
- **SemVer** — `MAJOR` quebra contrato · `MINOR` adiciona · `PATCH` conserta. `feat` sugere MINOR, `fix` PATCH; `!` após o tipo ou `BREAKING CHANGE:` no rodapé sugere MAJOR. A versão é decidida no release, não em cada PR.
- **CHANGELOG na PR**: `CHANGELOG.md` em Keep a Changelog; **toda PR acrescenta a própria linha em `## [Unreleased]`**, na categoria certa (Added · Changed · Deprecated · Removed · Fixed · Security), citando o PBI. O release move `Unreleased` para `## [x.y.z] — AAAA-MM-DD`. *(doctor `changelog`: arquivo existe e tem `[Unreleased]`.)*
- **Tag por release**: `vMAJOR.MINOR.PATCH` sobre o commit de `main` que o CHANGELOG descreve. A tag é índice de qual commit está no ar; o deploy é por digest (ver "Deploy"). Tag exige ok explícito (R1). *(doctor `tag-semver`, opcional em repo sem release.)*
- **Escape hatch** `GABARITO_ALLOW_VERSIONING="<motivo>"` — nominal, ≥ 8 caracteres e ≥ 2 palavras, no início do comando ou no ambiente; **não cruza** com os hatches de R2/R3 (um hatch, uma regra). Uso sem autorização do usuário registrada é achado de review.
- **Fail-open declarado (G9):** sem `versionamento.resolvidoEm` em `harness.config.json`, hook e check não bloqueiam nada. O hook (`guard-versioning.sh`) avisa em stderr ("fail-open declarado, G9"); o check (`versionamento-check.mjs`) avisa em stderr do mesmo jeito ("fail-open declarado (G9)"), **exceto com `--json`**, que só marca `failOpen` no JSON de saída — sem linha em stderr. Repo sem onboarding não é travado — e também não está protegido: o doctor marca `FALTA versionamento` até o onboarding rodar.

**Deploy**

- Um método de merge só — elimina a classe de risco em vez de apostar em comportamento medido uma vez.
- **Por digest**, nunca por tag mutável. A tag é índice de qual commit está no ar.
- **Ordem consumidor → produtor.** Quem lê o dado novo sobe antes de quem o escreve; senão a versão velha ignora o campo e produz resultado errado **sem erro em lugar nenhum**. Essa ordem tem que ser **travada por teste** (grep sobre o próprio arquivo de pipeline, com o teste num job obrigatório). Ordem escrita em comentário não é gate — e um teste que só confere se o comentário existe é **teatro documentado**.
- Rollback é de **imagem**; o banco não volta. Por isso migration compatível com a versão no ar (expand/contract) é regra, não sugestão.
- **Rollback tem janela:** dispara entre o deploy e a verificação de saúde. Depois disso, falha de front ou smoke **não** reverte — trocaria "API nova × front velho" por "front novo × API velha".
- Alvo do rollback é a revisão **que serve**, nunca a "última pronta" — elas divergem exatamente depois de um rollback.
- **Após qualquer redirecionamento de tráfego, despinar explicitamente.** Tráfego pinado faz todo deploy seguinte não surtir efeito, **com o job verde**: a esteira vira teatro.
- Actions e dependências de pipeline **pinadas por SHA** — em tag móvel, uma dependência comprometida enxerga o token federado.
- Blocos de permissão do workflow **substituem** o default; toda permissão necessária é reafirmada.
- Identidade federada, sem chave estática, **pool separado por ambiente** — um identificador de repositório casa qualquer provedor do mesmo pool, então pool próprio é a fronteira real. Condição por branch **espelhada dentro do workflow**, porque a condição do provedor vive fora do repositório.
- Concorrência sem cancelar execução em voo; o passo de deploy **reconfere a cabeça** imediatamente antes de agir.

**Verificação pós-deploy, sobre a revisão que serve:** digest publicado · variáveis de ambiente críticas (e a ausência das erradas) · condição de pronto · endpoint de saúde devolvendo **commit e versão** · smoke que **mede** que o bundle servido é o do build. O que **não** é verificável — tipicamente o worker, sem endpoint público — é **declarado**, não presumido.

**Janela de deploy é declarada, não ignorada.** Quando não existe ordem que a elimine, escreve-se qual é, quanto dura, o que degrada e por que foi aceita.

---

## §11. Segurança

- **Duas barreiras independentes**: permissão de banco (revogação de DML + privilégios padrão para tabela futura) **e** RLS. Uma migration "aditiva" não pode derrubar sozinha a única defesa.
- **RLS não protege de quem conecta como dono.** Se a aplicação conecta com role proprietário ou com bypass, **escreva por extenso** o que a RLS protege (o perímetro público) e o que **não** protege (a própria aplicação) — e **congele o estado por teste**, incluindo um **sweep dinâmico** que pergunta ao catálogo quais tabelas existem *agora* e falha se alguma estiver sem proteção. Tabela nova sem RLS vira leitura pública.
- **Adversarial de verdade:** cliente com a chave pública + sessão de usuário real, tabelas listadas **dinamicamente** (nunca hardcoded), com dado semeado antes — provar que volta zero linha.
- Um segredo **por finalidade e por ambiente**. Credencial de aplicação nunca é reaproveitada para migration ou administração.
- Segredo nunca em log, saída padrão, disco, arquivo de exemplo, mensagem de erro ou commit. Comparação de credencial por igualdade, **sem imprimir nenhum dos lados**.
- Separação de identidade por ambiente é **real** (identidades distintas, condição de escopo), não convenção de nome.
- Auditoria de configuração sensível: autor, hora, **diff** — com caminhos sensíveis redigidos, porque o log de auditoria tem audiência mais ampla que quem gerencia o recurso.
- Dado real lido de terceiro **não vai para commit** — só o mapeamento de campos vira documento.
- Cadastro livre de usuário **desligado** em todo ambiente com autenticação gerenciada: o padrão da plataforma costuma ser o inverso, e isso é item de checklist de criação de ambiente, sem teste que pegue.

**Gates que sustentam R2 e R3** (texto que vivia no `AGENTS.md §1` até a 1.0.1; migrou para caber no teto do núcleo, ADR-CTX-1):

- **R2 — `massMutationGuard()` no client + regra de lint `no-unfiltered-mass-mutation`** (G3). Duas barreiras independentes — a estática não enxerga valor vindo de variável; a de runtime só age depois que o código rodou. Uma sozinha não bastaria. Instalação em `gates.md §1`.
- **R3 — `assertNotProduction()` nos dois entrypoints do runner** (API e worker). Compara **host**, nunca imprime nenhum dos lados, e reprova URL inválida — sem host resolvível não há prova de que não é produção. Credencial de produção nunca no CI. Instalação em `gates.md §2`.

---

## §12. Anti-padrões já pagos

**Os incidentes por trás de R2 e R3** (texto que vivia no `AGENTS.md §1` até a 1.0.1; migrou para caber no teto do núcleo, ADR-CTX-1). Existem para que a regra não precise ser reaprendida pelo mesmo preço:

- **R2 — incidente real:** uma base local com milhares de registros, montada com centenas de leituras e **sem backup**, foi apagada por um teardown cujo `where` ficou vazio — o ORM descarta campo `undefined` em silêncio, e `{ tenantId: undefined }` virou `DELETE … WHERE 1=1`. É a primeira linha da tabela abaixo; G3 é o conserto, e o backup verificado por read-back (`adocao.md §1`, nível 1) o que o teria tornado irrelevante.
- **R3 — por que leitura também exige permissão:** produção é o sistema vivo de alguém — a consulta consome sessão, aparece no log de auditoria do fornecedor, e quem responde por ela é o usuário, não o agente. Por isso a autorização é nominal, para aquela consulta, com custo estimado antes.

| Sintoma | Causa | Conserto |
|---|---|---|
| Tabela apagada sem erro | ORM remove chave `undefined` do filtro em silêncio | G3 — checagem estrita **e** guarda de runtime; uma sozinha não bastaria |
| Conclusão errada sobre dado externo | leitura paginada tratada como censo | G1 / I1 |
| Config apagada ao salvar outra seção | cliente que não conhece o campo faz substituição total | G6 |
| Deploy verde, ambiente não muda | tráfego pinado por rollback anterior | despinar após todo redirecionamento |
| Resultado errado sem erro nenhum | produtor novo + consumidor velho na mesma janela | ordem consumidor→produtor **travada por teste** |
| Migration "aditiva" que destrói | guarda mede sintaxe, não efeito | detecção dedicada ao padrão perigoso — não alargar a regra já calibrada |
| Retry cria duplicata | idempotência delegada ao externo, cuja regra nativa cobre janela curta | R8 |
| Erro que manda corrigir a coisa errada | mensagem derivada do sintoma local, não do motivo real do terceiro | §8 — motivo extraído do envelope, ação derivada do código |
| Painel inútil no dia do incidente | um job repetitivo ocupa a janela inteira | chave de incidente (§7) |
| Item deferido que ninguém executa | anotado no ledger, que morre no merge | R17 — backlog é o único dono |
| Suíte contaminada por dado que ninguém criou | processo zumbi da lane anterior segurando consumidor de fila | guarda de partida na suíte; caçar processo antes da lane |
| Lane vermelha sem ninguém ter mexido | ambiente externo degradado em rajada, ou configuração alterada do lado do fornecedor | espaçar lanes; sonda de saúde; documento "o que conferir após reset" |
| Dependência transitiva quebra a suíte | regeneração de lockfile importa versão nova | fixar a transitiva, documentar na PR **e como regra** |
| "Está protegido" que é sorte | invariante tácita dependente de premissa não testada em outro arquivo | comentário com o porquê **+** teste que falha quando a premissa cai |
| Mapa "exaustivo" que não é | teste de exaustividade congelado num censo antigo | o inventário se **regera**, não se copia |

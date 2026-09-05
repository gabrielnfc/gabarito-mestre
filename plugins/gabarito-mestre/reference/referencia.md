# Referência do harness

Detalhamento de `AGENTS.md`. Consultado sob demanda, não lido inteiro toda sessão.

As regras (`R*`), invariantes (`I*`) e guardas (`G*`) citadas aqui estão definidas no `AGENTS.md`.
Os incidentes citados são reais e existem para que a regra não precise ser reaprendida pelo mesmo preço.

---

## §2. Documentos: design, plano, ledger, backlog

### 2.1 Anatomia do documento de design

Ordem fixa. Design que pula seção está incompleto, não enxuto.

| Seção | Conteúdo | Por quê |
|---|---|---|
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

**Identificação**

- `REQ-<ÁREA 3 letras>-<n>` — **append-only**: nunca renumerado, nunca reutilizado. Gaps são legítimos (IDs reservados por spec paralela). Emenda de requisito ganha sufixo: `REQ-PED-1b`, `REQ-END-7a`.
- Emenda inline: `_(Emenda AAAA-MM-DD, <origem> — <motivo>)_`.
- Emenda descoberta **durante a execução** leva a marca **`(execução)`** e **vence** qualquer frase anterior que a contradiga — ela descreve o que o sistema faz.
- Requisito morto: `REQ-X-6 — SUBSTITUÍDO por REQ-X-29`. Nunca some.

### 2.2 Anatomia do plano

Tasks numeradas · **grafo de dependências explícito** (é ele que declara o que pode rodar em paralelo) · cada task diz **qual requisito fecha** · fases com **gate objetivo em contagem verificável** · **Task 0 = spike** quando há incógnita externa · pré-condições de rollout listadas **antes** da primeira linha de código.

Gate de fase é contagem — *"12 primitivos tratados + 5 substituições + 3 retrofits = fase completa"* — não "parece pronto". Checkpoint humano julga estética, texto e produto; **nunca substitui o checklist**.

### 2.3 Ledger

Um por entrega. É o **mecanismo de continuidade entre sessões**: não é diário, é handoff. **Versione-o** (sem segredo dentro) — ledger gitignored morre com a máquina.

```
# Ledger — plano: <caminho>   Branch: <nome> @ <sha>   Spec (autoridade): <caminho>
Rulings herdados: R3, R5, R8...          Contexto externo: (sandbox fora, lane afetada)

## Pre-flight — pares produz × consome
| Par | Produz × Consome | Achado |
## Rulings de pre-flight (F3-R1, F3-R2...)   — decisão + motivo + custo-se-errado
## Progresso
Task N: DONE pelo implementador (worktree @ sha; RED→GREEN, contagens, achados/desvios)
Task N: complete (review Aprovado — o que o revisor PROVOU; sha de integração). Minors: ...
## CORTE DA SESSÃO (com motivo)
## FECHO — PR mergeada
| # | Achado | Fix | Review |    + backlog gerado + decisões não escritas
```

Cada task registra: quem fez (worktree + sha) · ciclo RED→GREEN com contagem de testes · achados e desvios declarados · veredito de review **com o que foi provado** · sha de integração · "minors" diferidos. Nada implícito.

**O ledger não é dono de nada** (R17): o que precisa sobreviver vira emenda no design ou item no backlog.

### 2.4 Backlog

Arquivo único, versionado, **um formato só**: `| Item | Origem | Gatilho |`. Cabeçalho normativo: *"item sai daqui quando entra num plano ou a decisão de descarte é registrada"*.

**Higiene obrigatória:** item entregue ou revogado é riscado no mesmo merge. Backlog com item morto ensina a ignorar o backlog.

---

## §3. Orquestração

### 3.1 Paralelismo — mecânica

Critério em `AGENTS.md §6`. A mecânica:

Um **worktree git por implementador paralelo**, branch temporária a partir da branch da entrega. Motivo do isolamento: hooks fazem stash, commits concorrentes corrompem o index, e a suíte de um vê arquivo meio-escrito do vizinho.

O orquestrador integra com `merge --no-ff` **na ordem do grafo**. O revisor roda sobre o **diff integrado**, não sobre o worktree. Conflito é raro por construção (arquivo disjunto é pré-condição) e, quando ocorre, o orquestrador resolve ou serializa e reexecuta a segunda task sobre a base nova.

**Os dois incidentes que tornaram "recurso compartilhado é serial" uma pré-condição dura:**

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

**Sem sprint, sem timebox, sem WIP formal.** A estrutura é **Onda → Plano → Fatia/Task**. WIP implícito: **uma entrega de código em voo por vez**; leituras e spikes paralelos são livres.

**A unidade da PR é a ENTREGA**: o conjunto que faz sentido **reverter junto** e **subir junto**.

O custo de abrir PR a mais é medido, não teórico: com branch obrigatoriamente atualizada e auto-merge desligado, mergear N PRs é **serial** — cada merge deixa as outras atrás, exigindo atualização + CI novo, e cada merge com código dispara um deploy que se espera **verificar** antes do próximo.

**PR separada é obrigatória quando:** *(1)* tem migration — a volta é diferente e a esteira tem ordem própria; *(2)* é hotfix — fura a fila sem carregar trabalho inacabado; *(3)* precisa subir em ordem — se o deploy tem etapas, a PR acompanha; *(4)* toca escrita em sistema externo, RBAC ou segurança — não por tamanho, por **atenção**; *(5)* está incerto ou com revisão contestada — o que pode ser reprovado sai do lote.

**Travas:** nunca abrir segunda PR de um tema que já tem PR aberta · passou de ~15 arquivos de produção, **pare e pergunte** se dá para cortar (sinal para pensar, não regra dura — uma PR de guarda de segurança tinha 54 arquivos e era indivisível) · lote maior ⇒ branch mais velha, sincronize a cada merge · **tamanho não é o risco real**: naquela PR de 54 arquivos a regressão que quase passou era de runtime, invisível para unit/build/qualidade e pega só pela lane de integração. **PR que toca ORM ou contrato exige a lane de integração antes de ser declarada pronta.**

---

## §5. Guardas — mecanismo e parâmetros

Os números abaixo foram calibrados num projeto real. **Meça antes de ligar** (`adocao.md §3`).

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

---

## §12. Anti-padrões já pagos

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

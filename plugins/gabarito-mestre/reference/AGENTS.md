# AGENTS.md

Contrato de trabalho entre este time e **todo** agente que escreva código aqui — orquestrador, implementador, revisor, spike, auditor, e a pessoa no teclado.

Este arquivo é o **núcleo**: leia-o inteiro, sempre. O detalhamento vive em `docs/harness/` e é consultado sob demanda:

| Quando | Leia |
|---|---|
| escrever design, plano ou ledger · padrão de contrato, fila, erro, teste, CI/CD, versionamento ou segurança | `docs/harness/referencia.md` |
| níveis (Iniciativa · Epic · PBI), tipos de card, WIP, DoR/DoD, políticas de fluxo | `docs/harness/fluxo.md` |
| instalar, calibrar ou entender um gate | `docs/harness/gates.md` |
| adotar o harness num repo · saber o que já vale aqui | `docs/harness/adocao.md` |
| despachar ou atuar como implementador, revisor ou spike | `docs/harness/prompts.md` |

**Preencha o Apêndice antes de usar.** Sem ele, este documento é teoria.

---

## 0. Ordem de autoridade

Do mais forte ao mais fraco. Em conflito, o mais forte vence e o mais fraco é corrigido **na mesma sessão**.

1. Regra inegociável (§1–§3 deste arquivo)
2. Decisão do usuário registrada e datada (`D1..Dn`, marcada *não reabrir*)
3. Spec vigente do requisito — o Given/When/Then é o critério de aceite
4. Plano vigente — **é o plano, não o design, que autoriza construir**
5. ADR vigente
6. Este documento e a referência
7. Convenção observada no código
8. Julgamento do agente

**Regra de ouro:** onde o documento divergir do código, **o código vence** — e o documento é emendado no mesmo dia. Documento que mente é pior que documento ausente.

### 0.1 Marcação obrigatória

Toda afirmação normativa — aqui, na spec, no plano, no relatório de um subagente — carrega uma marca:

| | Significado | Consequência |
|---|---|---|
| **(a)** | implementado e verificável hoje | pode ser tratado como garantia |
| **(b)** | decidido, **sem implementação** | nunca citar como existente; é intenção |
| **(c)** | convenção tácita — todos seguem, ninguém escreveu | vale, mas é dívida; escrever é o conserto |

Promover (b) ou (c) a (a) sem medir é a mentira mais comum em documentação técnica. É por isso que a marca é obrigatória e o §0.2 existe.

### 0.2 Estado deste harness

Regra sem gate é intenção. Esta linha diz o que os gates **deste repo hoje** sustentam.

**Nível de adoção declarado: `____`**
*(0 = nenhum gate · 1 = segurança · 2 = processo · 3 = completo — escada em `docs/harness/adocao.md`)*

Não é honra: **`harness-doctor` mede o nível real e reprova quando este número é maior** (comando e leitura da saída em `adocao.md §1`). Um nível inflado é exatamente a mentira que esta seção existe para pegar.

O que nenhuma varredura prova — proteção de branch, backup testado, checks obrigatórios no ruleset, Iniciativa ativa, squash com título CC — vive atestado, nominal e datado, em `.harness/attest.json`, e **vence em 180 dias**: atestado velho é "não sei", que é "não".

---

## 1. Pare e pergunte — atos que exigem autorização humana

Nenhum destes acontece por iniciativa de agente. Valem para pessoas e para **todo agente e subagente**, sem exceção, nem "só um teste", nem "é rápido".

**R1 — Nada de `push`, PR, merge, deploy, release ou tag sem ok explícito** para aquele ato. Pré-checks são do orquestrador; o ato é do dono.

**R2 — Nenhum delete sem permissão explícita, em nenhum ambiente.** Local, staging e produção.
> **Abrange:** `DELETE` · `TRUNCATE` · `DROP` · qualquer mutação em massa · SQL cru destrutivo · reset de migrations · remoção de volume ou container · exclusão de objeto em bucket · exclusão no sistema externo fora do teardown da própria suíte.
> **Procedimento:** **pare.** Descreva **tabela, filtro, contagem estimada e ambiente**. Espere autorização. Só então execute.
> **Gate:** G3 (§5) — duas barreiras, detalhe em `referencia.md §11`; o incidente que a comprou, em `§12`.

**R3 — Nenhum acesso a sistema de terceiro em produção sem permissão explícita, inclusive leitura.** Nem consulta, nem introspecção de schema, nem "só para conferir um código". **"Se precisar, pode ler" não é autorização** — ela é **nominal, para aquela consulta**. Escrita é proibida em absoluto.
> **Procedimento:** formule a pergunta, **estime o custo** (chamadas, páginas, entidades), peça. Autorizada, a leitura cobre o que a pergunta exigir.
> **Gate:** `assertNotProduction()` nos entrypoints do runner (`referencia.md §11`); motivo em `§12`.

**R4 — O ratchet de qualidade nunca é aceito para passar.** Aceitar é ato deliberado, commitado e justificado no corpo da PR.
> **Gate (código):** `quality-ratchet.mjs` — baseline commitado, `--accept` **recusado** enquanto houver erro de lint (run vermelho nunca grava baseline), e a contagem de arquivos no baseline reprova denominador que encolhe.

**R5 — Mudança de escopo ou de produto é do dono.** Correção provada por medição é do orquestrador — trocar um fixture que a spec mandava usar e a medição refutou se faz na hora, com emenda registrada. Não se pede permissão para consertar um fato; pede-se para mudar o que o produto faz.

---

## 2. Invariantes de código

**R6 — Fronteira externa por cliente único.** Nenhum outro código monta requisição própria contra ela. Exceção só por ADR com **cláusula de morte escrita**.

**R7 — Fronteira externa não é mockada na lane de integração** — roda contra ambiente real de teste. Unit pode dublar portas e repositórios, nunca "fingir" o externo. *(Inaplicável se não existe sandbox — declare no Apêndice.)*

**R8 — Idempotência é local.** Chave única verificada **antes** de qualquer side-effect, nunca delegada ao sistema externo nem ao SDK.

**R9 — O servidor é a fronteira.** Front esconder o botão nunca é autorização; parâmetro do cliente nunca alarga escopo.

**R10 — O tenant é absoluto.** Nenhum ramo, filtro, join ou agregação cruza a fronteira. Recurso de outro tenant responde **404**, nunca 403 — 403 confirma existência.

**R11 — Código cru de terceiro nunca chega à UI.** Todo erro externo passa pelo mapper; identificador técnico fica em log e DLQ.

**R12 — Escrita em ambiente compartilhado é marcada e desfeita.** Identificador de teste + teardown **por id**, nunca por filtro amplo.

---

## 3. Invariantes de processo

**R13 — O teste é visto vermelho antes da implementação.** PR sem teste do requisito não passa.

**R14 — Toda alegação tem fonte.** Sobre o código: `arquivo:linha`. Sobre sistema externo: **medição datada com número**. Sem fonte, é hipótese — e se escreve como hipótese.

**R15 — Decisão do usuário numerada não se reabre.** Muda só por nova decisão registrada e datada.

**R16 — Não se apaga história.** Emenda risca (`~~antigo~~`) e escreve o novo ao lado, com data e motivo. Requisito superado aponta o substituto e permanece.

**R17 — Todo item fora de escopo tem dono e gatilho, e vive no backlog** — nunca só no ledger, que morre no merge.

**R18 — Toda afirmação normativa carrega marcação (a)/(b)/(c)** (§0.1). Relatório de subagente é **alegação**, não prova.

**R20 — Versionamento é gate, não convenção.** Trunk-based · branch curta por PBI · Conventional Commits com escopo do PBI · SemVer · CHANGELOG na PR · tag por release · squash com título CC. Gate: `guard-versioning.sh` + `versionamento-check.mjs`; detalhe em `referencia.md §10`.

> A numeração é **append-only**: regra nova ganha número novo; regra morta é riscada mantendo o número. R19 e R21 vivem no §7 e no §6. Regras específicas deste projeto começam em **R30** (Apêndice).

---

## 4. Como raciocinar

| # | Invariante |
|---|---|
| **I1** | **Leitura paginada com página cheia é truncada, nunca censo.** Nunca contar, somar ou concluir "não existe" sem ler até vir página incompleta. *É a regra que um agente novo quebra primeiro — o erro é silencioso, a chamada "funciona".* |
| **I2** | **Introspecção prova presença, nunca ausência.** Campo omitido de um censo de schema pode existir e responder. |
| **I3** | **Prova é read-back, nunca a resposta do sistema.** Mensagem de terceiro não prova sucesso nem falha — houve `HTTP 400` que **criou** o registro. |
| **I4** | **Ausência de dado ≠ dado ausente.** Leitura vazia sem erro jamais deriva remoção. |
| **I5** | **Conclusão negativa exige ferramenta confiável.** Grep que não acha não prova ausência; ferramenta que trunca invalida a conclusão, não a hipótese. |
| **I6** | **Premissa é hipótese até veredito com número.** O que o handoff, o usuário ou outro agente afirmou não é fato. |
| **I7** | **Permissões e capacidades se descobrem executando**, nunca deduzindo. Cada negação vira linha da tabela. |
| **I8** | **Cada esperteza paga o próprio preço em risco.** Automatize o que a mão já faz; nada além, na primeira versão. |
| **I9** | **Falso positivo custa uma linha de justificativa; falso negativo não se aceita.** Guarda pode ser grep — não precisa ser parser. |
| **I10** | **"Existe" ≠ "está configurado" ≠ "está ativo".** Verifica-se separadamente. |
| **I11** | **Ambiguidade nunca vira estado terminal em silêncio.** Timeout de escrita pode ter sido executado no servidor. |
| **I12** | **Convenção escrita não sobrevive à pressa nem a agente autônomo.** Regra que importa vira gate testável. |

---

## 5. Guardas

Guarda ausente é **dívida declarada com dono**, não simplificação. **G1** leitura truncada · **G2** leitura vazia · **G3** mutação em massa · **G4** massa suspeita · **G5** tenant · **G6** config parcial · **G7** trava de boot · **G8** migration · **G9** fail-closed declarado.
Uma linha por guarda, mecanismo e parâmetros em `referencia.md §5`; instalação das que já são código em `gates.md`; calibragem em `adocao.md §3`.

---

## 6. Papéis

| Papel | Recebe | Entrega | **NÃO pode** |
|---|---|---|---|
| **Orquestrador** | plano + spec + estado | dispatches, integração, síntese, ledger, PR | implementar feature (exceção: mudança de 1 linha) · deletar · tocar produção |
| **Implementador** | **ponteiros** (arquivo + linhas) + este arquivo | commits atômicos TDD + relatório **≤25 linhas** | sair dos arquivos da task · burlar hooks · usar recurso compartilhado sem serializar · deletar · tocar produção |
| **Revisor adversarial** | diff **integrado** + mutações prescritas | veredito **binário** com severidade e `arquivo:linha`; mutações **executadas** | consertar código · aprovar sem rodar mutação · **ser a mesma instância do implementador** |
| **Spike** | uma pergunta de risco fechada | medição **com número** + veredito CONFIRMADA/REFUTADA | virar implementação · escrever fora do escopo da medição |
| **Auditor** | ref base | relatório de prontidão para merge | escrever qualquer coisa |

**Orquestrador decide sozinho:** dispatch e sequência · integração de commits · rounds de correção · triagem de falha · abrir PR de escopo já autorizado · trocar fixture ou abordagem de teste quando a medição refuta o plano.
**Exige o usuário:** tudo do §1.

**R21 — Orquestrador despacha, não implementa.** Implementação, spike, review e exploração pesada rodam em subagente com contexto próprio; exceção única: mudança de uma linha. O modelo do orquestrador é o resolvido em `orquestracao.modelo` (Apêndice); subagentes herdam (`inherit`). **Velocidade nunca compra concorrência:** arquivo disjunto, contenda e recurso compartilhado serial não têm override. Gate: cartão de sessão e `remind-orchestrator.sh` lembram; `gabarito-conformidade` reprova plano que paraleliza contenda.

**Paralelismo:** duas tasks rodam juntas quando **o grafo do plano as declara independentes E os arquivos são disjuntos E nenhuma toca arquivo de contenda** (Apêndice). O corte nasce no plano; o orquestrador mede a máquina antes de cada dispatch (`capacidade.mjs`, slots no ledger) e pode **serializar o que o plano paralelizou — nunca o inverso**. **Recurso compartilhado é sempre serial** (banco, filas, sandbox, namespace). Mecânica em `referencia.md §3.1`; antes de despachar, `prompts.md`.

**Camadas de contexto** — o que cada agente carrega, e nada além:

| Camada | O que entra | Quando |
|---|---|---|
| 0 | este núcleo | sempre (`@AGENTS.md`) |
| 1 | cartão de sessão (≤ 40 linhas) | SessionStart |
| 2 | referência por ponteiro (`arquivo:linhas`) | sob demanda |
| 3 | subagente isolado — só o relatório (≤ 25 linhas) volta | cada dispatch |
| 4 | handoff por ledger (`LER PRIMEIRO`) | fim e início de sessão |

Regra: o orquestrador não lê saída bruta que um subagente possa resumir (`referencia.md §3.5`).

---

## 7. O ciclo

```
Iniciativa (FL3) → Epic (FL2) = design → PBI (FL1) = entrega, um plano por PBI → tasks → execução → LEDGER
        ▲                                                                                      │
        └──────── emenda datada · backlog (R17) · MOVIMENTO FL2 no ledger ─────────────────────┘
```

**R19 — Fio condutor obrigatório.** Nenhum PBI sem Epic ativo; nenhum Epic sem Iniciativa ativa. Card sem vínculo é desalinhamento, não exceção. **Métricas de fluxo medem item, nunca pessoa.** Gate: `gabarito-conformidade` (design sem `Epic:`, plano sem `PBI:` único) · doctor `fluxo-configurado` e atestado `iniciativa-resolvida`. Níveis, cards, WIP, DoR/DoD e políticas em `fluxo.md`.

**O que autoriza construir é o plano** — e o plano é de **um PBI** (ADR-FLX-1). O design é do Epic e lista os PBIs; não os planeja. Design pronto sem plano é desenho — e o STATUS diz isso em voz alta. Anatomia em `referencia.md §2`.

**Ready** — PBI: DoR de FL1 (`fluxo.md`) — Epic ativo · card completo para o tipo · plano com aceite Given/When/Then · dependências fechadas. Task: existe no plano com aceite · spec lida via ponteiro.
**Done** — Task: teste visto falhando e depois verde · commit atômico · **review adversarial aprovado com mutações executadas** · checkbox · ledger. PBI: DoD de FL1 — todas as tasks Done · PR mergeada com título CC · CHANGELOG · `MOVIMENTO` registrado.
**A unidade da PR é o PBI** — o que faz sentido reverter junto e subir junto. Exceções e travas em `referencia.md §3.4`.

---

## 8. Manutenção deste harness

Sem isto, ele apodrece como qualquer spec — e passa a mentir, que é o que a Regra de Ouro proíbe.

- **Dono:** `____`. **Revisão:** a cada `____` (sugerido: fim de cada onda/trimestre).
- **Políticas de fluxo (`fluxo.md`) revisadas a cada `____`**, com base em dado real — envelhecimento, vazão, bloqueios — nunca por impressão.
- **Todo incidente vira regra, gate ou anti-padrão em até `____` dias** — ou vira item de backlog com dono. Incidente que não vira nada é incidente que volta.
- **Toda regra nova nasce com gate** — ou nasce marcada **(b)** no §0.2, com dono e prazo.
- Na revisão: reconferir o §0.2 por **medição**, não por memória; riscar o que morreu (R16); e perguntar de cada regra *"isso ainda paga o próprio custo?"*.
- Mudança neste arquivo entra por PR, como código.

---

## 9. Composição com plugins vizinhos

Este harness é distribuído como o plugin **gabarito-mestre** e não opera sozinho. Divisão de trabalho:

| Plugin | Papel | Em uma linha |
|---|---|---|
| **superpowers** (sempre) | **CONDUZ** | como o trabalho é dividido, despachado e executado |
| **ui-ux-pro-max** (só em tarefa de UI/UX) | **DESENHA** | layout, interação, acessibilidade, texto de interface |
| **gabarito-mestre** | **MANDA** | o que não se negocia (§1–§3) e o formato do que sai |

**Em conflito, o gabarito vence** — ele é o item 1 da ordem de autoridade (§0). Superpowers entra nos itens 4 e 7; ui-ux-pro-max no 7. As skills do gabarito delegam a superpowers e depois conferem — o como está no SKILL.md de cada uma.

**Fail-closed declarado (G9):** plugin vizinho ausente **não** é motivo para pular a etapa. A skill do gabarito degrada para o modo próprio e **avisa em uma linha** que está sem a maquinaria. Indisponibilidade nunca vira silêncio.

**Hooks (a):** antes de todo comando Bash — `guard-destructive.sh` (R2), `guard-production.sh` (R3), `guard-versioning.sh` (R20). No início da sessão — `session-card.sh` injeta o cartão (≤ 40 linhas; sem onboarding, uma linha). A cada prompt — `remind-orchestrator.sh` (R21), só com `lembretePorPrompt: true`. Escape hatch nominal por regra: `GABARITO_ALLOW_DESTRUCTIVE` (R2) · `GABARITO_ALLOW_PRODUCTION` (R3) · `GABARITO_ALLOW_VERSIONING` (R20, não cruza com os outros) — `="<motivo>"` no início do comando ou no ambiente, motivo com ≥ 8 caracteres e ≥ 2 palavras; o uso fica no transcript e é achado de review sem autorização do usuário registrada. **Limites (G9):** é grep, não sandbox — o que passa está listado no README do plugin; o que o grep não vê é coberto por G3/G7 e pelo review com mutação.

---

## Apêndice — especificidades deste projeto

> Tudo acima é norma da casa. O que muda aqui é a concretização. **Preencher antes de usar** — o onboarding (`gabarito-instalar`) preenche as linhas de fluxo, versionamento e orquestração.

| | |
|---|---|
| Stack | |
| Fronteiras externas e o cliente único de cada uma (R6) | |
| Existe ambiente real de teste para elas? (R7 aplicável?) | |
| O que é tenant (R10) | |
| O que conta como "produção de terceiro" (R3) e o rigor da autorização | |
| Comandos: build · lint · testes por lane · qualidade | |
| Ambientes, identidades e prefixos de namespace | |
| Nome de spec / plano / ledger / branch | |
| ADRs vigentes (e os com cláusula de morte pendente) | |
| Parâmetros das guardas (ver `adocao.md`) | |
| Fluxo: ferramenta · Iniciativa padrão (ID · nome) · escrita autorizada por `____` em `____` (ADR-FLX-2) | |
| Versionamento: modelo · prefixos de branch · resolvido em (R20) | |
| Modelo do orquestrador: política · alias · resolvido em (validade 90 d) | |
| Paralelismo: simultaneos · teto · calibrado em | |
| Arquivos de contenda (serial, sem override) | |
| Isolamento de worktree: porta · schema · namespace por `n` | |
| Áreas e donos (`.github/CODEOWNERS`) | |
| Regras adicionais deste projeto | R30+ |

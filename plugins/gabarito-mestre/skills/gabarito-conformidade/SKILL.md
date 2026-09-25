---
name: gabarito-conformidade
description: Confere um artefato — design, spec, plano, ADR, card de fluxo (Iniciativa, Epic, PBI de qualquer tipo) — contra a anatomia do harness e o Workflow TRUE, e devolve o que falta com a emenda proposta. Use quando o usuário pedir para "conferir o design", "validar o plano", "checar a spec", "revisar o ADR", "conferir o card", "o Epic está completo?", "o PBI está pronto (DoR)?", "está conforme?", "confere contra o gabarito", "o plano está completo?", "valida este documento", "check this plan/spec/design/card" ou depois que superpowers produzir um design ou plano. Não escreve o artefato — superpowers escreve; esta skill confere.
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(wc:*)
---

# gabarito-conformidade

Recebe **qualquer artefato** e confere contra a anatomia de `${CLAUDE_PLUGIN_ROOT}/reference/referencia.md §2` e, para cards e fio condutor, contra `docs/harness/fluxo.md` (fonte normativa do Workflow TRUE; no plugin: `${CLAUDE_PLUGIN_ROOT}/reference/fluxo.md`). Saída: **o que falta, item a item, e a emenda proposta**. Não aprova por impressão.

## Divisão de trabalho (`reference/AGENTS.md §9`)

- **superpowers CONDUZ:** o design nasce em `superpowers:brainstorming`; o plano em `superpowers:writing-plans`. Esta skill **não reescreve** o artefato nem substitui essas skills — régua duplicada em dois lugares é o que `referencia.md §6` proíbe.
- **ui-ux-pro-max DESENHA:** quando o artefato é de UI/UX, layout, interação, acessibilidade e texto de interface são dele — esta skill **não** confere estética. Ela continua conferindo o que é regra dentro da tela: **servidor é a fronteira (R9), erro em três camadas (§8), tenant absoluto (R10)**.
- **gabarito-mestre MANDA:** a anatomia, o fio condutor (R19), a contenda (R21) e a marcação (a)/(b)/(c). Em conflito, o gabarito vence (§0, item 1).

**Consequência prática — esta skill do gabarito não refaz o que superpowers faz.** Ela DELEGA e depois CONFERE:
1. superpowers produz o artefato (design, plano, execução);
2. o gabarito valida contra a anatomia (`referencia.md §2.1` design · `§2.2` plano · `§3.2` review);
3. reporta o que faltou, emenda, e só então conclui.

Skill que reimplementa superpowers é régua duplicada em dois lugares — o que a `referencia.md §6` proíbe para schema vale para processo.

**Sequência:** superpowers produz → esta skill confere → reporta o que faltou → o usuário (ou superpowers) emenda → conferir de novo → só então concluir.

**Fail-closed declarado (G9):** se superpowers não estiver instalado, avise em uma linha — `superpowers ausente: o artefato não passou pelo brainstorm/plano dele; conferindo mesmo assim` — e confira. Indisponibilidade nunca vira silêncio nem aprovação.

## Pré-conferência: o repo tem fluxo?

1. Raiz: `git rev-parse --show-toplevel` (fallback: diretório atual). `Read` `harness.config.json` se existir.
2. `fluxo.resolvidoEm` presente (`AAAA-MM-DD`) → **modo fluxo**: itens de fio condutor reprovam. Ausente, arquivo ausente ou JSON inválido → **fail-open declarado (G9)**: os itens de fio condutor viram **AVISO** e não entram na contagem de faltas — repo sem onboarding não reprova por vínculo que ainda não existe. Diga qual modo está ativo na linha `Fluxo:` da saída.
3. `orquestracao.paralelismo.arquivosDeContenda` → lista de contenda. Ausente → defaults `["package-lock.json", "prisma/", "src/index.ts", "docs/fluxo/"]` e a nota `defaults (orquestracao ausente)` na saída. Contenda **não** é fail-open: R21 vale com ou sem onboarding.
4. Tipo do artefato: `tipo:` do frontmatter (cards) · cabeçalho `PBI:`/`Epic:` + tasks numeradas (plano) · `STATUS` + requisitos (design/spec) · "Decisão/Racional/Alternativas" (ADR). Em dúvida, pergunte em uma linha.

## Checklist — DESIGN / SPEC (`referencia.md §2.1`)

Ordem fixa. Seção pulada = incompleto, não enxuto.

| # | Item | Reprova se |
|---|---|---|
| 1 | **STATUS** no topo, destacado | não separa o que o sistema **faz** do que está **escrito** que fará |
| 2 | **Fatos medidos** `M1..Mn` (medição · resultado · quando · autorização se tocou terceiro) | fato e desenho dividem parágrafo; medição sem número ou sem data |
| 3 | **Decisões** `D1..Dn` com **alternativa rejeitada e por quê**, marcadas *não reabrir* | decisão sem alternativa rejeitada |
| 4 | **ADRs** com **cláusula de morte** quando for exceção | exceção sem condição de encerramento |
| 5 | **Requisitos** `REQ-<ÁREA>-<n>` em **Given/When/Then**, com gate de permissão e `arquivo:linha` quando existir | requisito como intenção, sem critério de aceite |
| 6 | **Fora de escopo** com **dono e gatilho** (R17) | item sem dono |
| 7 | **Testes e gates** — o que prova cada requisito + **mutações que devem derrubar a suíte** | requisito sem mutação nomeada está coberto, não testado |
| 8 | **Rollout** — a ordem **e o motivo dela**; janela declarada | ordem sem motivo |
| 9 | **Pendências** — o que ficou aberto, por quê, o que desbloqueia | risco só na cabeça de alguém |
| 10 | **Emendas datadas** inline (`_(Emenda AAAA-MM-DD, origem — motivo)_`), nada apagado (R16) | histórico reescrito |
| 11 | **Marcação (a)/(b)/(c)** em toda afirmação normativa (R18) | (b) citado como se fosse (a) |
| 12 | **Fio condutor (R19, `fluxo.md`, abertura antes de §1)** — cabeçalho com `Iniciativa: <ID>` e `Epic: <ID>`; lista dos PBIs do Epic (ID + tipo), índice, não plano (ADR-FLX-1); Iniciativa diferente da padrão do repo só como `Iniciativa: <ID> (override: <motivo>)` (D4) | sem `Epic:` · sem `Iniciativa:` · sem lista de PBIs · override sem motivo · ID fora de `fluxo.idPadrao`. **Sem `fluxo.resolvidoEm`: AVISO, não falta** |

## Checklist — PLANO (`referencia.md §2.2`)

| # | Item | Reprova se |
|---|---|---|
| 1 | Tasks **numeradas** | — |
| 2 | **Grafo de dependências explícito** (é ele que autoriza paralelismo) | paralelismo implícito |
| 3 | Cada task diz **qual requisito fecha** | task órfã de requisito |
| 4 | **Gate de fase em contagem verificável** ("12 primitivos + 5 substituições = fase completa") | "parece pronto" |
| 5 | **Task 0 = spike** quando há incógnita externa | incógnita virou premissa (I6) |
| 6 | Pré-condições de rollout **antes** da primeira linha de código | — |
| 7 | Recurso compartilhado (banco, fila, sandbox) declarado **serial** (§6) | duas tasks no mesmo banco em paralelo |
| 8 | Cada task com aceite Given/When/Then e ponteiro (arquivo + linhas) para a spec | conteúdo copiado em vez de ponteiro |
| 9 | **`PBI: <ID>` único e `Epic: <ID>` no cabeçalho** (ADR-FLX-1: um plano por PBI; fases são grupos, nunca outros PBIs) | dois `PBI:` · nenhum `PBI:` · sem `Epic:` · ID fora de `fluxo.idPadrao`. **Sem `fluxo.resolvidoEm`: AVISO** |
| 10 | **Tipo por task**: cada task declara `tipo:` ∈ {US, Enabler, TechDebt, Spike, Bug, Tarefa} (`fluxo.md §2`) | task sem tipo ou tipo fora da lista. **Sem `fluxo.resolvidoEm`: AVISO** |
| 11 | **Contenda serial (R21, `AGENTS.md §6`)** — task que toca qualquer caminho de `arquivosDeContenda` está marcada `serial: contenda` **e** o grafo não a paraleliza com outra task que também toque contenda | duas tasks declaradas paralelas tocando o mesmo caminho de contenda · task de contenda sem `serial: contenda`. Item "contenda (R21)". Nunca AVISO |

Para o item 11, cruze a lista de arquivos de cada task com a lista de contenda (prefixo de diretório conta: `prisma/migrations/x.sql` toca `prisma/`). Cite as duas tasks e o caminho.

## Checklist — CARDS DE FLUXO (`fluxo.md §2`)

Tipo lido de `tipo:` no frontmatter ou do título. Card vindo de ferramenta (ClickUp, Jira…): o usuário cola o texto ou aponta o arquivo exportado — esta skill **não lê MCP**.

**Comum a todo card** (`fluxo.md §2` e `§5`): frontmatter com `id` (casa `fluxo.idPadrao`), `tipo` · **status**: coluna com chave em `fluxo.status.<nível>` (`fluxo.md §4`) — bate com o valor mapeado da chave → confere como hoje, diverge → falta; coluna **sem** chave em `fluxo.status` (ex.: `Backlog` e `Em refinamento` em FL2, e todo o FL3, que não tem `fluxo.status.FL3`) é **opção, não comprometido** (Emenda #7 do plano-mestre) — linha informativa, nunca `FALTA`/`SUSPEITA`, e nenhuma emenda que empurre o card de coluna · **vínculo**: PBI tem `epic:`; Epic tem `iniciativa:` (ou override com motivo); Iniciativa não tem pai · sem vínculo = item "fio condutor (R19)" (AVISO sem `fluxo.resolvidoEm`) · **DoR** do nível (`fluxo.md §1`) antes de entrar em execução.

| Tipo | Campos obrigatórios (`fluxo.md §2`) | Reprova se |
|---|---|---|
| **Iniciativa** (FL3) | Problema · Resultado **com indicador** · Escopo · Horizonte · Patrocinador · Critério de sucesso **com meta** | resultado sem indicador · critério sem número/meta · sem patrocinador |
| **Epic** (FL2) | Narrativa em **7 linhas** · RN (regras de negócio) · CA (critérios de aceite) · **lista de PBIs** (ID + tipo) | narrativa ausente ou > 7 linhas · sem RN · sem CA · sem lista → item "Epic: PBIs (fluxo.md §2)" |
| **US** (FL1) | `Como <papel> / quero <ação> / para <valor>` · RN · CA em **BDD** (Given/When/Then) | qualquer das três partes ausente · CA sem BDD |
| **Enabler** (FL1) | `Para <objetivo> / precisamos <o quê>` · CA | sem CA · sem "para" |
| **TechDebt** (FL1) | `Para / precisamos` · CA | idem Enabler |
| **Tarefa** (FL1) | `Para / precisamos` · CA · **área** · **ponto focal** · **prazo** | sem área, ponto focal ou prazo |
| **Spike** (FL1) | `Para / precisamos / em até <timebox>` · CA (pergunta **fechada** + o que conta como resposta) | sem timebox · pergunta aberta · CA sem número esperado |
| **Bug** (FL1) | descrição com **onde** / **desde quando** / **afetando quem** · **reprodução** passo a passo · **esperado** × observado | sem reprodução · sem "desde" · sem esperado |

Movimento e bloqueio (`fluxo.md §4`): card "bloqueado" é **marcação com data, motivo e dono do desbloqueio**, não coluna; card parado além de `fluxo.envelhecimentoDias` sem movimento é pauta do nível acima — aponte, não reprove.

## Checklist — ADR

Decisão · racional · alternativas rejeitadas · **cláusula de morte** se for exceção a R6–R12 · data · marcação (a)/(b).

## Formato da saída

```
CONFORMIDADE — <artefato> (<tipo>)   veredito: CONFORME | NÃO CONFORME (<n> faltas · <m> avisos)

| # | Item da anatomia | Estado | Onde (linha) | Emenda proposta |
|---|---|---|---|---|
| 3 | Decisões com alternativa rejeitada | FALTA | D2, l.41 | acrescentar "Rejeitado: X porque Y" |
| 12 | Fio condutor (R19) | FALTA | cabeçalho, l.1–6 | acrescentar `Epic: EPIC-7` e a lista dos PBIs |
| 11 | Contenda (R21) | FALTA | T2/T3 × prisma/ | marcar T3 `serial: contenda`; grafo T2 → T3 |
...
Fluxo: <"resolvido em <data> (modo fluxo)" | "sem onboarding — fio condutor como AVISO (fail-open declarado, G9); rode gabarito-instalar">
Contenda: <lista usada> <"(config)" | "(defaults — orquestracao ausente)">
UI/UX: <"n/a" | "estética delegada a ui-ux-pro-max; R9/§8/R10 conferidos: ok | falta em …">
Maquinaria: <"superpowers presente" | "superpowers ausente — modo próprio">
```

Estados: `FALTA` (conta no veredito) · `AVISO` (não conta; só fio condutor sem onboarding, e envelhecimento) · `SUSPEITA` (sem fonte na linha) · `ok`. Cada linha é uma **alegação com fonte** (linha do artefato). Sem fonte, é suspeita — escreva "suspeita", não "falta". Veredito: `NÃO CONFORME` se e só se há ≥ 1 `FALTA`.

## Proibido

- Reescrever o artefato inteiro. Emenda é cirúrgica e proposta, não aplicada sem o usuário.
- Aprovar por impressão geral. Veredito sem tabela não vale.
- Conferir estética de UI — isso é do ui-ux-pro-max.
- Reprovar por fio condutor em repo sem `fluxo.resolvidoEm` — é AVISO (FLX-3). Silenciar o aviso também é proibido.
- Rebaixar contenda a aviso: R21 não tem override, com ou sem onboarding.
- Ler a ferramenta de planejamento por MCP — esta skill confere texto que recebe.

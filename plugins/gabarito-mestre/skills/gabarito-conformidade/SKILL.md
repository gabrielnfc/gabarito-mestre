---
name: gabarito-conformidade
description: Confere um artefato — design, spec, plano, ADR — contra a anatomia do harness e devolve o que falta com a emenda proposta. Use quando o usuário pedir para "conferir o design", "validar o plano", "checar a spec", "revisar o ADR", "está conforme?", "confere contra o gabarito", "o plano está completo?", "valida este documento", "check this plan/spec/design" ou depois que superpowers produzir um design ou plano. Não escreve o artefato — superpowers escreve; esta skill confere.
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*), Bash(wc:*)
---

# gabarito-conformidade

Recebe **qualquer artefato** e confere contra a anatomia de `${CLAUDE_PLUGIN_ROOT}/reference/referencia.md §2`. Saída: **o que falta, item a item, e a emenda proposta**. Não aprova por impressão.

## Divisão de trabalho (`reference/AGENTS.md §9`)

- **superpowers CONDUZ:** o design nasce em `superpowers:brainstorming`; o plano em `superpowers:writing-plans`. Esta skill **não reescreve** o artefato nem substitui essas skills — régua duplicada em dois lugares é o que `referencia.md §6` proíbe.
- **ui-ux-pro-max DESENHA:** quando o artefato é de UI/UX, layout, interação, acessibilidade e texto de interface são dele — esta skill **não** confere estética. Ela continua conferindo o que é regra dentro da tela: **servidor é a fronteira (R9), erro em três camadas (§8), tenant absoluto (R10)**.
- **gabarito-mestre MANDA:** a anatomia e a marcação (a)/(b)/(c). Em conflito, o gabarito vence (§0, item 1).

**Sequência:** superpowers produz → esta skill confere → reporta o que faltou → o usuário (ou superpowers) emenda → conferir de novo → só então concluir.

**Fail-closed declarado (G9):** se superpowers não estiver instalado, avise em uma linha — `superpowers ausente: o artefato não passou pelo brainstorm/plano dele; conferindo mesmo assim` — e confira. Indisponibilidade nunca vira silêncio nem aprovação.

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

## Checklist — ADR

Decisão · racional · alternativas rejeitadas · **cláusula de morte** se for exceção a R6–R12 · data · marcação (a)/(b).

## Formato da saída

```
CONFORMIDADE — <artefato> (<tipo>)   veredito: CONFORME | NÃO CONFORME (<n> faltas)

| # | Item da anatomia | Estado | Onde (linha) | Emenda proposta |
|---|---|---|---|---|
| 3 | Decisões com alternativa rejeitada | FALTA | D2, l.41 | acrescentar "Rejeitado: X porque Y" |
...
UI/UX: <"n/a" | "estética delegada a ui-ux-pro-max; R9/§8/R10 conferidos: ok | falta em …">
Maquinaria: <"superpowers presente" | "superpowers ausente — modo próprio">
```

Cada linha da tabela é uma **alegação com fonte** (linha do artefato). Sem fonte, é suspeita — escreva "suspeita", não "falta".

## Proibido

- Reescrever o artefato inteiro. Emenda é cirúrgica e proposta, não aplicada sem o usuário.
- Aprovar por impressão geral. Veredito sem tabela não vale.
- Conferir estética de UI — isso é do ui-ux-pro-max.

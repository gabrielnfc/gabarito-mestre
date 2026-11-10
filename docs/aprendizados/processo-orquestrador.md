# Processo do orquestrador: otimizações em vigor

Vale para toda sessão, a partir de 2026-11-03. Ler ao retomar, antes de escrever brief. Processo do orquestrador não é escopo de produto: mudar aqui não espera entrega. O que virar regra do produto segue `loop-e1.md` (D com medição, M sem).

## Base medida na E2 (2026-11-03, até 17:35)

`python3 docs/aprendizados/medir-fases.py`, separação por palavra no prompt, aproximada.

- 25 de 35 reviews reprovados; 1ª rodada aprovada em 0 de 12. 35 reviews para 11 tasks.
- Tempo somado de agente: implementação 405 min, review 405, spike 128, Sombra 112, outros 15. Gate 90 min, script.
- É observação, não causa provada. Cada mudança abaixo tem métrica; o número decide manter ou cortar.

## Em vigor

| # | Mudança | Por quê | Métrica | Estado |
|---|---|---|---|---|
| P1 | Antes de despachar task com estado, contrato de falha ou aceite: Sombra em Opus lê o brief e devolve tabela de transições, saída de cada estado e ataques. Só depois o implementador | MAJOR nascido de contrato ou regra: T2 (E23), T6 r4, T7 r4 | 1ª rodada aprovada, base 0 de 12; custo da Sombra, mediana 5,5 min | Experimento desde T13 |
| P2 | Todo brief de implementador aponta para a seção "Antes do commit" abaixo | Mesmas classes de MAJOR voltam em tasks diferentes | Achados do review nas classes da lista, na mesma task | Experimento desde T13 |
| P3 | Dependente não espera review da dependência: abre sobre o commit dela e rebaseia depois. Só integra após a dependência | T12 esperava T11; `A9` já permite até o commit | Tempo parado de task pronta para abrir | Em uso desde T12 |
| P4 | Revisão na 2ª rodada reprovada: Sombra antes de nova rodada, pergunta aberta sobre a abordagem (E16). Nada de 3ª rodada por inércia | T6 e T7 foram a 5 | Rodadas por task, base 3,2 | Em vigor |
| P5 | Medição pesada (calibração, escada, `npm test` repetido) só com máquina sem agente em teste; brief proíbe | Load 88–95 na calibração; Sombra subiu a ~33 durante T6 e T7 | Falha por tempo em gate | Em vigor |
| P6 | Mutação viva declarada equivalente exige o caso que prova; sem o caso, conta como viva (E28) | N5 e K10 refutadas | Viva declarada equivalente e refutada, base 2 | Em vigor |
| P8 | Todo brief proíbe `env` e dump de variável; lê só a variável pelo nome (E30) | Token de mensageria exposto em saída de Sombra | Exposição em transcript, base 1 | Em vigor |
| P9 | Task que cria recurso usado por outra camada nomeia 1 teste que atravessa as duas pelo adaptador real. Fumaça sem LLM entra em `npm test` assim que o esqueleto existe; com LLM, antes da última task. Revisor recebe: "qual camada consome o que esta task produz, e há teste que passa pelas duas?"; não ⇒ MAJOR | T13 r2: 1ª composição real só na última task (E31) | Defeito de costura achado só no aceite, base 1 | Em vigor |
| P10 | Sessão real parada em defeito de costura: antes de repetir, Sombra percorre o caminho inteiro por script, pelos adaptadores reais, sem LLM, e lista todos os defeitos de uma vez | T13 parou 3 vezes no aceite 0, cada uma num defeito diferente; r3 custou ~12 min de agente e 5 medições de sessão | Sessões reais por defeito achado, base 3 sessões para 3 defeitos | Experimento desde T13 r3 |
| P11 | Orquestrador mede o próprio contexto a cada marco com `medir-contexto.py <sessão>`; 50 % = pouso | Sem medidor, o limiar de pouso dependia do dono avisar | Diferença para o painel, base 35,6 × 36 | Em vigor |
| P12 | Fim de entrega em paralelo: PR e CI ao integrar o último código; aceites independentes juntos após a fumaça real; review final após o aceite 0 | Trecho final era sequencial sem necessidade | Tempo do fim da T19 ao merge, sem base | Experimento desde T13 r4 |
| P13 | Sessão real não espera review: com os commits das tasks de produto, sobe em branch de junção descartável, junto dos reviews e do delta do review final. Review que mudar produto repete só o aceite afetado. Pouso não para o que não depende do dono | Dono cobrou lentidão, 2026-11-04. T26 ficou parada no 3º pouso sem depender dele; 1.356 min somados de agente, com fim de entrega sequencial | Tempo do último commit de produto ao merge, sem base | Experimento desde T13 r7 |
| P14 | Push sem CI na PR com `mergeable_state` unknown, status do GitHub normal: fechar e reabrir a PR dispara o `pull_request`. Conferir `gh run list` a cada push, sem esperar o fim da entrega | 152 commits sem CI de 8c6dd8d a 5881657, cerca de 3 h; só vi no fim; reabrir resolveu em 20 s | Tempo entre push e 1ª execução, base 3 h | Em vigor |
| P15 | Brief comum exige asserção que lê cada campo produzido e teste para cada cláusula negativa ("sem tocar X"), com troca de valor antes do commit | E3 onda 1: 4 de 4 reprovações com MAJOR de campo ou cláusula sem asserção (T1 r1 e r2, T2 parcial, T3, T5) | MAJOR dessa classe por review, base 4 em 5 reviews | Experimento desde T3 r2 |
| P7 | Otimização achada entra aqui na hora, com métrica. Nunca "da próxima entrega em diante" sem motivo medido (E29) | Dono cobrou | | Em vigor |

**P1, 1º uso (T13, 2026-11-03):** Sombra, 6,5 min, 2 defeitos de produto (linha K, `/gabarito retomar`) e 1 erro de brief (`CLAUDE_CONFIG_DIR` zera a medição) antes de sessão real. Se os defeitos teriam aparecido só na T13: leitura, não medição do custo evitado.

## Antes do commit (implementador)

Rode cada item como sonda sua e relate o resultado:

1. **Siga a saída até o fim.** Toda mensagem que manda fazer algo: faça e confira o estado final. T6 r4 perdeu commit obedecendo à própria mensagem.
2. **Falha não vira sucesso.** Dado ausente, corrompido, ferramenta com erro, cada um dá qual saída? Ausente e corrompido são coisas diferentes (T4).
3. **Quem chama isto?** Mudou nome, flag, campo ou texto: `git grep` em skills, reference, README, doctor, CI. T11 quebrou o instalador em silêncio.
4. **Vizinhos do caso.** Corrigiu um caso, teste os adjacentes: caixa, espaço no caminho, aspas, relativo e absoluto, worktree e principal (T7, E12).
5. **O teste distingue?** Troque a regra por outra plausível: o teste precisa falhar. Ele não pode depender de carga ou relógio da máquina.

## Descartado

- X7, mutação mecânica sem LLM antes do review: REFUTADA. Backtest em T3 e T4: 0 de 13 MAJOR apontados, mínimo era 5; 38 vivas, 25 % equivalentes na amostra de 20; 0 tokens, ~10 min por task. Os MAJOR são checagem ausente ou caso não testado, que troca textual não cria. Relatório: `.superpowers/sdd/2026-11-03-e2-loop/spike-X7-relatorio.md`. Não entra no gate.

## Fila

- Contexto inicial de subagent: mediana 41.532 tokens no 1º turno (R13), pago por agente. Medir o que entra nele.
- X3, mutações em paralelo: gate pesa pouco (90 min de 7h30). Só depois de X7.

## E3 → E4 (2026-11-09, medido)
- **Duração da E3:** 1º commit 11:03, merge 18:51 = 7h48 para 16 tasks + T14b + T14c (git log). Única medição confiável de entrega inteira; E1/E2 em squash não mostram início. Base das estimativas da E4/E5.
- **Teste de tempo em runner compartilhado:** `bench-guarda` p95 153,9 ms × teto 150 no macOS do CI, piso do runner lento (p95 75,6 ms); passou no rerun e no commit anterior com o mesmo código. Hipótese M: teto sem folga para o runner; medir N execuções antes de mudar.
- **Fixtures que chamam git real** precisam de identidade explícita: macOS deriva identidade do sistema, Linux do runner não (R44 GM-11). Reproduzir com HOME vazio + `user.useConfigOnly=true`.
- **ALERTA "tempo ~zero" do gate é falso positivo quando a suíte toda é rápida** (T1 E4, 2026-11-09): `formas.test.ts` inteira roda em 65 ms; 12 mutações mortas em 0,09 s dispararam alerta. MUT-T1-F1 aplicada à mão: 2 testes caem (morte real). Hipótese M: limiar do alerta relativo ao tempo da suíte base, não absoluto; medir antes de mudar o gate.
- **Gate da junção pega o que o gate isolado não pega** (E4 onda 1, 2026-11-09): T2 e T3 verdes sozinhas; após rebase da T2 sobre a T3, o fecho `dist/painel.js` passou a importar `pouso.js` (node:*) e `eventos:null` quebrou código da T3. Regra (D, medido): task paralela que toca o mesmo módulo de saída integra com gate sobre a branch já com a irmã, nunca sobre a base antiga.
- **Agente tipo `Plan` é só leitura** (E5 planejador, 2026-11-10): não grava arquivo nem por Bash, mesmo com o brief autorizando; devolveu o plano inline (≈ 400 linhas) e o orquestrador extraiu do transcript por script. Regra (D, medido 1×): planejador/redator que grava arquivo vai como `general-purpose`, nunca `Plan`.

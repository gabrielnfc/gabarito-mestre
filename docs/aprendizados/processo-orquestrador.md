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
| P7 | Otimização achada entra aqui na hora, com métrica. Nunca "da próxima entrega em diante" sem motivo medido (E29) | Dono cobrou | | Em vigor |

## Antes do commit (implementador)

Rode cada item como sonda sua e relate o resultado:

1. **Siga a saída até o fim.** Toda mensagem que manda fazer algo: faça e confira o estado final. T6 r4 perdeu commit obedecendo à própria mensagem.
2. **Falha não vira sucesso.** Dado ausente, corrompido, ferramenta com erro, cada um dá qual saída? Ausente e corrompido são coisas diferentes (T4).
3. **Quem chama isto?** Mudou nome, flag, campo ou texto: `git grep` em skills, reference, README, doctor, CI. T11 quebrou o instalador em silêncio.
4. **Vizinhos do caso.** Corrigiu um caso, teste os adjacentes: caixa, espaço no caminho, aspas, relativo e absoluto, worktree e principal (T7, E12).
5. **O teste distingue?** Troque a regra por outra plausível: o teste precisa falhar. Ele não pode depender de carga ou relógio da máquina.

## Fila

- X7, contexto inicial de subagent: mediana 41.532 tokens no 1º turno (R13), pago por agente. Brief em `.superpowers/sdd/2026-11-03-e2-loop/spike-X7.md`.
- X3, mutações em paralelo: gate pesa pouco (90 min de 7h30). Só depois de X7.

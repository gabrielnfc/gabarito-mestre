# T0c — Spike S6: excesso do bench da guarda no macOS do CI (rodada 2, corrigida)

Pergunta fechada: distribuição de `p95(guarda) − p95(node -e "")` no runner macOS (passo `bench-guarda`), N ≥ 10, pelos logs de execuções existentes.

## Método
- Driver `t0c-dados/coleta.sh` (só leitura): `gh run list --workflow ci.yml --limit 300` = 130 runs (lista completa); para CADA run e CADA tentativa (`run_attempt` 1..n; 3 runs têm 2: 43721146846, 42705486672, 41765663328) `gh run view <id> --attempt <n> --log`, filtro das linhas `piso`, `guarda`, `limite p95`. 133 tentativas lidas. Nenhum workflow disparado, nenhum push.
- Dado bruto: `t0c-dados/bruto.tsv` (672 linhas), `t0c-dados/parte/` (uma por run/tentativa), `runs.json`. Análise: `node t0c-dados/analisa.mjs` → `analise.txt`.
- Detalhe: numa nova tentativa só roda o job que falhou; o outro job reaparece com o MESMO log (mesmo texto). Dedupe por run + texto da linha do piso ⇒ cada medição conta uma vez.
- Excesso = p95 guarda − p95 piso (ambos impressos pelo bench, n=20 cada).

## Dado bruto (macOS, todas as tentativas)
- 111 medições distintas em 109 runs (112 linhas de log; 1 duplicada por job não reexecutado). Antes: 109 só com a última tentativa (viés de sobrevivência).
- Excesso (ms): mín 15,9 · mediana 51,0 · p90 72,8 · p95 82,4 · p99 113,6 · máx 158,7. Critério de "estabilidade": p99/mediana = 2,23 (cauda de ~2× a mediana; não é estável, o excesso mistura ruído do runner).
- Piso do runner (p95): 23,4 a 99,8 ms, mediana 49,3.
- Estouros do limite bruto 150 ms: **6 em 111** (antes: 4 em 109): 42652055728 (ex 50,9), 42663757299 (98,5), 42705486672 tentativa 1 (piso 75,6; guarda 153,9; ex 78,3), 42892996899 (158,7, o máximo), 43213939506 (113,6), 43721146846 tentativa 1 (piso 66,3; guarda 172,5; ex 106,2).
- Correção da rodada 1: `43721146846` FALHOU na tentativa 1 (ESTOUROU) e passou na tentativa 2 (guarda 119,6; piso 57,0; ex 62,6) sem mudança de código. 42705486672 também: tentativa 1 falhou, 2 passou. O relatório anterior leu só a última tentativa.
- Ubuntu (medido agora, 109 medições): piso p95 mediana 24,0 (16,3 a 36,3); excesso mediana 23,6, máx 35,8; 0 estouros. "Piso ~25 ms" confirmado.

## Veredito: CONFIRMADA
Há log com piso em todas as medições, N = 111 ≥ 10. Excesso: mediana 51,0, p99 113,6, máx 158,7.

## Sensibilidade do limite (sobre o excesso) — para a Sombra decidir; NÃO escolhi
Simulação: soma-se uma regressão d ao excesso de cada uma das 111 medições; coluna = quantas passam do limite (o gate falharia). FP = quantas das 111 medições reais já estourariam sem regressão.

| limite | valor (ms) | +50 ms | +100 ms | +150 ms | FP histórico |
|---|---|---|---|---|---|
| p99 × 1,5 | 170,4 | 1/111 (0,9%) | 16/111 (14,4%) | 107/111 (96,4%) | 0 |
| máx × 1,5 (regra do plano) | 238,1 → 240 | 0/111 (0%) | 1/111 (0,9%) | 4/111 (3,6%) | 0 |
| p95 × 2 (proposto aqui) | 164,8 | 1/111 (0,9%) | 27/111 (24,3%) | 111/111 (100%) | 0 |

Justificativa do terceiro: p95 (82,4) é a cauda normal observada; ×2 dá folga de 2× sobre ela e tem 0 FP no histórico. Ainda assim só pega +100 ms em 24%.
Leitura: com o limite do plano (240) uma guarda 150 ms mais lenta (≈3× o excesso mediano) passa em 96% das execuções; nenhum candidato pega +50 ms de forma útil. O "repete 1x" da T21 reduz ainda mais a detecção (não simulado). Esse ruído do runner (cauda 2× a mediana, n=20) limita qualquer limite absoluto; alternativa a avaliar pela Sombra: comparar com mediana de várias rodadas ou medir em ordem de grandeza (razão guarda/piso), não medido aqui.

## O que a medição NÃO responde
- Runner futuro: só histórico até 2026-11-15.
- n=20 por execução: p95 ruidoso; o excesso mistura o ruído de dois p95.
- A regressão somada é sintética (aditiva); regressão real pode ter outra forma (ex. escala com o piso).
- Não separei PR de push; a sensibilidade com "repete 1x" não foi simulada.
- Não escolhe o limite.

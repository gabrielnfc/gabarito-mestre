# T0c — Spike S6: excesso do bench da guarda no macOS do CI

Pergunta fechada: distribuição de `p95(guarda) − p95(node -e "")` no runner macOS (passo `bench-guarda`), N ≥ 10, pelos logs de execuções existentes.

## Método
- `gh run list --workflow ci.yml --limit 300 --json ...`: 130 execuções (menos que o teto 300 ⇒ lista completa, mais antiga 2026-09-05).
- `gh run view <id> --log` (só leitura) para as 130; filtro das linhas `piso (node -e "")`, `guarda (guarda.js)` e `limite p95` do job macOS. Nenhum workflow disparado, nenhum push.
- Excesso por execução = p95 da guarda − p95 do piso (ambos impressos pelo próprio bench, n=20 cada).

## Dado bruto
- 130 execuções; 109 têm a linha do bench macOS com piso; 0 linhas sem piso (21 execuções sem bench macOS: anteriores ao passo ou jobs que não o rodam).
- Excesso (ms), N = 109: mínimo 15,9 · mediana 50,9 · p90 71,1 · p95 74,1 · p99 98,5 · máximo 158,7.
- Estouros do limite bruto 150 ms (4 em 109): 42652055728 (piso 99,8; guarda 150,7; excesso 50,9), 42663757299 (excesso 98,5), 42892996899 (excesso 158,7, é o máximo), 43213939506 (piso 82,2; guarda 195,8; excesso 113,6).
- Piso do runner varia 23,4 a 99,8 ms (p95); é isso que o limite bruto confunde com custo da guarda: 1 dos 4 estouros tem excesso na mediana (50,9).
- Correção ao brief: `43721146846` NÃO é falha. Run de push em main, conclusão success, guarda p95 119,6, piso 57,0, excesso 62,6. As falhas do macOS são as 4 acima (`43213939506` está entre elas).

## Veredito: CONFIRMADA
Há log com piso em todas as execuções medidas, N = 109 ≥ 10. O excesso é estável o bastante para um limite sobre ele (mediana 50,9; 1 outlier em 158,7).

Limite proposto (regra do plano): maior excesso × 1,5 = 238,05 ⇒ arredondado a 10 ms: **240 ms**. Decisão do planejador, reversível.
Observação para a T21: 240 sobre o excesso é muito folgado frente ao p99 (98,5); o máximo é um único outlier. Alternativa a escolher (não decidida aqui): p99 × 1,5 ≈ 150 ms de excesso. A regra do plano fixa 240.

## O que a medição NÃO responde
- Não mede o runner atual: só histórico até 2026-11-15; variação do runner futuro não é coberta.
- n=20 por execução dá p95 ruidoso (o 19º valor); o excesso mistura ruído dos dois p95.
- Não prova que um excesso de 240 ms ainda detecta regressão real da guarda (sensibilidade do limite); só que o histórico passaria.
- Não cobre ubuntu (piso ~25 ms, limite folgado lá).
- Execuções de PR e de push entram juntas; não separei por evento.

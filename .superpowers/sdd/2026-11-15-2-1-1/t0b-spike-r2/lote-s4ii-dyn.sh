#!/bin/bash
D=/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b/.superpowers/sdd/2026-11-15-2-1-1/t0b-spike-r2
for a in "tbare1 roteiro-loopbare" "tbare2 roteiro-loopbare" "tdev1 roteiro-loopdever" "tdev2 roteiro-loopdever"; do set -- $a; python3 -I $D/rodar-pty.py $1 $D/$2.json & done
$D/rodar-p.sh pbare1 6 "/loop" </dev/null &
$D/rodar-p.sh pdev1 6 "/loop verifique se existe o arquivo pronto.txt neste diretorio; se nao existir, continue verificando ate existir" </dev/null &
wait

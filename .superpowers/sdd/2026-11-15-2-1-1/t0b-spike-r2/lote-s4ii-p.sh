#!/bin/bash
D=/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b/.superpowers/sdd/2026-11-15-2-1-1/t0b-spike-r2
$D/rodar-p.sh pfix1 6 "/loop 5m responda apenas: ok" </dev/null &
$D/rodar-p.sh pfix2 6 "/loop 5m responda apenas: ok" </dev/null &
$D/rodar-p.sh pdin1 6 "/loop responda apenas: ok" </dev/null &
$D/rodar-p.sh pdin2 6 "/loop responda apenas: ok" </dev/null &
$D/rodar-p.sh ptroca1 6 "rode o comando sleep 12 e depois responda apenas: ok" 5 </dev/null &
$D/rodar-p.sh ptroca2 6 "rode o comando sleep 12 e depois responda apenas: ok" 5 </dev/null &
wait

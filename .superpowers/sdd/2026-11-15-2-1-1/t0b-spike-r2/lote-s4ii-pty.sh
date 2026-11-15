#!/bin/bash
D=/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b/.superpowers/sdd/2026-11-15-2-1-1/t0b-spike-r2
for a in "tdin1 roteiro-loopdin" "tdin2 roteiro-loopdin" "tfix1 roteiro-loopfix" "tfix2 roteiro-loopfix"; do set -- $a; python3 -I $D/rodar-pty.py $1 $D/$2.json & done; wait

#!/bin/bash
# S4(i): 2x clear com troca de disco, 2x meio (troca sem clear), 2x controle (clear sem troca), em paralelo
D=/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b/.superpowers/sdd/2026-11-15-2-1-1/t0b-spike-r2
for a in "clear2 roteiro-clear" "clear3 roteiro-clear" "meio1 roteiro-meio" "meio2 roteiro-meio" "ctrl1 roteiro-controle" "ctrl2 roteiro-controle"; do set -- $a; python3 -I $D/rodar-pty.py $1 $D/$2.json & done; wait

#!/usr/bin/env bash
# Roda `claude plugin test .` na raiz do plugin. Sai 0 só se o teste do mod carregou e nenhum teste falhou.
# Os *.test.ts de gates/test usam node:test e não carregam nesse runner: "did not load" deles não conta.
# Teto de tempo (T14b, review final: teste que trava em vez de falhar segurava o job até o teto do CI): MOD_TEST_TIMEOUT segundos (padrão 360).
# GM-15 T34 (emenda 7 r.7): teto = 3× a mediana medida. Medido 2026-11-16: isolada 36,0 / 34,5 s e com a suíte dos gates rodando ao lado 40,1 / 38,9 s (n = 4, mediana ~37 s;
# a suíte cresceu, o "~13 s" antigo não vale); sob o gate do integrar (T16, 19:20-19:40) 120,1 s e 120,0 s (os dois cortados pelo teto de 120) e 103,8 s ⇒ mediana >= 120 s,
# 3× = 360 s. Estourar o 360 é travamento, não disputa de CPU. MOD_TEST_TIMEOUT continua mandando.
# Estourou ⇒ mata o grupo de processos inteiro, imprime `mod-test: timeout` e sai 1. MOD_TEST_CMD troca o comando (só para provar o teto).
limite="${MOD_TEST_TIMEOUT:-360}"
comando="${MOD_TEST_CMD:-claude plugin test .}"
out=$(perl -e '
  my $t = shift; my $pid = fork();
  if (!$pid) { setpgrp(0, 0); exec @ARGV or exit 127; }
  $SIG{ALRM} = sub { kill "KILL", -$pid; print "mod-test: timeout (> ${t}s)\n"; exit 124; };
  alarm $t; waitpid($pid, 0); exit(($? & 127) ? 1 : ($? >> 8));
' "$limite" bash -c "$comando" 2>&1)
rc=$?
if [ "$rc" -eq 124 ]; then printf '%s\n' "$out"; exit 1; fi
printf '%s\n' "$out" | grep -q '^(pass)' || exit 1
printf '%s\n' "$out" | grep -q 'mod/test/gabarito.test.ts: cannot' && exit 1
printf '%s\n' "$out" | grep -E '^\(fail\)' | grep -qv 'the file did not load' && exit 1
exit 0

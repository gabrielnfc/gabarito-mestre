#!/usr/bin/env bash
# Roda `claude plugin test .` na raiz do plugin. Sai 0 só se o teste do mod carregou e nenhum teste falhou.
# Os *.test.ts de gates/test usam node:test e não carregam nesse runner: "did not load" deles não conta.
# Teto de tempo (T14b, review final: teste que trava em vez de falhar segurava o job até o teto do CI): MOD_TEST_TIMEOUT segundos (padrão 114).
# GM-15 T34 (emenda 7 r.7, review r1 MAJOR-2): a disputa foi medida (37 s isolada contra 120,1 / 120,0 / 103,8 s ao lado da suíte dos gates no integrar do T16), então o gate-task.mjs
# agora roda esta suíte DEPOIS das outras, nunca junto. Teto = 3× a mediana medida SERIALIZADA (máquina sem a suíte dos gates ao lado), 2026-11-16, n = 4: 36, 38, 38 e 40 s,
# mediana 38 s ⇒ 114 s. MOD_TEST_TIMEOUT continua mandando (o orquestrador integra com 300 até medir de novo sob o gate real serializado).
# Estourou ⇒ mata o grupo de processos inteiro, imprime `mod-test: timeout` e sai 1. MOD_TEST_CMD troca o comando (só para provar o teto).
limite="${MOD_TEST_TIMEOUT:-114}"
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

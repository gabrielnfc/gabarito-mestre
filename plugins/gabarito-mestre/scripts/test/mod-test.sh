#!/usr/bin/env bash
# Roda `claude plugin test .` na raiz do plugin. Sai 0 só se o teste do mod carregou e nenhum teste falhou.
# Os *.test.ts de gates/test usam node:test e não carregam nesse runner: "did not load" deles não conta.
out=$(claude plugin test . 2>&1)
printf '%s\n' "$out" | grep -q '^(pass)' || exit 1
printf '%s\n' "$out" | grep -q 'mod/test/gabarito.test.ts: cannot' && exit 1
printf '%s\n' "$out" | grep -E '^\(fail\)' | grep -qv 'the file did not load' && exit 1
exit 0

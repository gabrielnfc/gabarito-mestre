#!/bin/bash
# semear-teto.sh <repo> <plugin-root>   (GM-10 T13 r8, sessão B do aceite `liberar`)
# Leva a T1 ao teto de 2 rodadas pelo CLI REAL (nenhuma linha do diário é escrita à mão): abrir, commit, iniciar, concluir,
# revisor + achados + REPROVADO (rodada 1), correcao, concluir, revisor + achados + REPROVADO (rodada 2). Termina com
# `proxima` devolvendo `parar teto_rodadas T1` (a saída é conferida; senão rc 1). Sem agente, sem LLM, sem apagar nada.
set -euo pipefail
repo="${1:?repo}"; plugin="${2:?plugin-root}"
L="$plugin/gates/scripts/loop.mjs"
cd "$repo"
run() { node "$L" "$@" | tee /dev/stderr | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.exit(JSON.parse(s.trim().split("\n").at(-1)).ok===true?0:1)})'; }
run abrir T1 >/dev/null
W=.harness/worktrees/T1
mkdir -p "$W/src" "$W/test" "$W/.tmp-gabarito"
commit() { (cd "$W" && git add -A src test && git -c user.email=aceite@example.invalid -c user.name="Aceite GM-99" commit -q -m "$1"); }
printf 'export function soma(a, b) {\n  return a + b;\n}\n' > "$W/src/a.mjs"
printf "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { soma } from '../src/a.mjs';\n\ntest('soma', () => {\n  assert.equal(soma(1, 2), 3);\n});\n" > "$W/test/a.test.mjs"
commit "feat(GM-99): soma"
run iniciar T1 implementador >/dev/null; run concluir T1 >/dev/null
for r in 1 2; do
  run iniciar T1 revisor >/dev/null
  printf '# Achados rodada %s\n\n- MAJOR: o teste cobre um par só; a spec manda percorrer todo o dominio de -20 a 20.\n' "$r" > "$W/.tmp-gabarito/review-r$r.md"
  run veredito T1 REPROVADO "$r" 0 1 >/dev/null
  if [ "$r" = 1 ]; then
    run iniciar T1 correcao >/dev/null
    printf '// rodada 1\n' >> "$W/src/a.mjs"; commit "fix(GM-99): ajuste da rodada 1"
    run concluir T1 >/dev/null
  fi
done
out="$(node "$L" proxima --vivos 0)"
echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s.trim().split("\n").at(-1));if(o.acao?.tipo==="parar"&&o.acao?.motivo==="teto_rodadas"){console.log("semeado: parar teto_rodadas T1");}else{console.error("semente falhou: "+JSON.stringify(o.acao));process.exit(1)}})'

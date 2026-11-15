#!/usr/bin/env bash
# Driver T0c: lê (só leitura) logs de TODAS as tentativas de cada run do ci.yml, 6 em paralelo.
# Uso: coleta.sh  -> runs.json (se faltar) e parte/<run>_<att>.tsv; depois: cat parte/*.tsv > bruto.tsv
D="$(cd "$(dirname "$0")" && pwd)"; mkdir -p "$D/parte"
[ -f "$D/runs.json" ] || gh run list --workflow ci.yml --limit 300 --json databaseId,attempt,event,conclusion,createdAt > "$D/runs.json"
um() { id=$1; a=$2; D=$3; f="$D/parte/${id}_$a.tsv"; [ -f "$f.ok" ] && return
  gh run view "$id" --attempt "$a" --log 2>/dev/null | grep -E 'piso \(node|guarda \(guarda|limite p95' |
  sed -E 's/^(hooks[^\t]*\([^)]*\))\t[^\t]*\t[^ ]* /\1\t/' | awk -v i="$id" -v a="$a" '{print i"\t"a"\t"$0}' > "$f"; touch "$f.ok"; }
export -f um
node -e 'for(const r of require(process.argv[1])) for(let a=1;a<=r.attempt;a++) console.log(r.databaseId+" "+a)' "$D/runs.json" |
  xargs -P 6 -L1 bash -c 'um $0 $1 '"$D"
cat "$D"/parte/*.tsv > "$D/bruto.tsv"

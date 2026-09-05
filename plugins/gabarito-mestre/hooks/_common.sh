#!/usr/bin/env bash
# Funções comuns aos dois guards do gabarito-mestre. Compatível com bash 3.2 (macOS).
# Não é hook: é carregado por `source` pelos guards.

# Lê o JSON do stdin e devolve `.tool_input.command` em GABARITO_CMD.
# Ordem de parser: node → jq → python3. Sem nenhum deles, FAIL-OPEN DECLARADO (G9):
# avisa em stderr e deixa passar — sem parser não há como inspecionar, e bloquear
# TODO comando Bash faria o usuário desligar o plugin inteiro (e perder o resto).
gabarito_read_command() {
  local input
  input=$(cat)
  if command -v node >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const c=j&&j.tool_input&&j.tool_input.command;process.stdout.write(typeof c==="string"?c:"")}catch(e){process.stdout.write("")}})')
  elif command -v jq >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
  elif command -v python3 >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | python3 -c 'import sys,json
try:
  c=json.load(sys.stdin).get("tool_input",{}).get("command","")
  sys.stdout.write(c if isinstance(c,str) else "")
except Exception:
  pass')
  else
    echo "gabarito-mestre: sem parser JSON (node/jq/python3) — guarda DESATIVADA neste comando (fail-open declarado, G9)" >&2
    exit 0
  fi
}

# Escape hatch nominal e grepável: GABARITO_ALLOW_DESTRUCTIVE com motivo NÃO-VAZIO.
# Vale tanto no ambiente do processo quanto como prefixo inline do próprio comando
# (`GABARITO_ALLOW_DESTRUCTIVE='motivo' rm -rf build`), para que o motivo fique no
# transcript ao lado do ato. Motivo vazio ou só-espaços NÃO libera.
# Devolve 0 (liberado) e imprime o aviso; devolve 1 se não há liberação.
gabarito_escape_hatch() {
  local motivo="${GABARITO_ALLOW_DESTRUCTIVE-}"
  if [ -z "$motivo" ]; then
    motivo=$(printf '%s' "$GABARITO_CMD" | sed -nE "s/.*GABARITO_ALLOW_DESTRUCTIVE=(\"([^\"]*)\"|'([^']*)'|([^[:space:]]*)).*/\2\3\4/p" | head -n1)
  fi
  # trim
  motivo=$(printf '%s' "$motivo" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  if [ -n "$motivo" ]; then
    local esc
    esc=$(printf '%s' "$motivo" | sed -E 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    echo "gabarito-mestre: ESCAPE HATCH usado ($1) — motivo: $motivo" >&2
    printf '{"systemMessage":"⚠ gabarito-mestre: escape hatch usado (%s). Motivo declarado: %s"}\n' "$1" "$esc"
    return 0
  fi
  return 1
}

# Bloqueia: JSON no stdout (lido pelo Claude Code mesmo com exit 2) + motivo no stderr + exit 2.
gabarito_deny() {
  local reason="$1"
  local esc
  esc=$(printf '%s' "$reason" | sed -E 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  echo "$reason" >&2
  exit 2
}

# Remove o CORPO de heredocs que só ESCREVEM ARQUIVO (`cat > x <<EOF`, `cat >> x <<EOF`, `tee x <<EOF`),
# porque anotação em progress.md que cita `rm -rf` não é `rm -rf` (falso positivo real, medido em
# 7.037 comandos). Qualquer outro heredoc (psql <<SQL, bash <<EOF, python3 - <<PY, `cat <<EOF | bash`)
# é mantido: fail-closed. LIMITE DECLARADO: script escrito por heredoc e executado no comando
# seguinte é invisível a este grep — para isso existem as guardas de runtime (G3/G7).
# Uso: gabarito_strip_write_heredocs <<< "$cmd"  (lê stdin, escreve stdout)
gabarito_strip_write_heredocs() {
  awk '
    BEGIN { skip = 0 }
    skip == 1 { t = $0; sub(/^\t+/, "", t); if (t == term) { skip = 0 } ; next }
    {
      if ($0 ~ /^[[:space:]]*(cat[[:space:]]*>>?[[:space:]]*[^|;&<]*<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*$|cat[[:space:]]+<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*>>?[[:space:]]*[^|;&<]*$|tee([[:space:]]+-a)?[[:space:]]+[^|;&<]*<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*$)/) {
        t = $0; sub(/^.*<<-?[[:space:]]*/, "", t); sub(/[[:space:]]*>.*$/, "", t); gsub(/["'"'"']/, "", t); term = t; skip = 1; print; next
      }
      print
    }'
}

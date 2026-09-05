#!/usr/bin/env bash
# Funções comuns aos dois guards do gabarito-mestre. Compatível com bash 3.2 (macOS).
# Não é hook: é carregado por `source` pelos guards.

# Lê o JSON do stdin e devolve `.tool_input.command` em GABARITO_CMD.
# Ordem de parser: jq (≈5 ms) → node → python3. Sem nenhum deles, FAIL-OPEN DECLARADO (G9):
# avisa em stderr e deixa passar — sem parser não há como inspecionar, e bloquear
# TODO comando Bash faria o usuário desligar o plugin inteiro (e perder o resto).
# JSON malformado ou sem `.tool_input.command` também é fail-open DECLARADO: avisa em stderr.
gabarito_read_command() {
  local input
  input=$(cat)
  if command -v jq >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
  elif command -v node >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const c=j&&j.tool_input&&j.tool_input.command;process.stdout.write(typeof c==="string"?c:"")}catch(e){process.stdout.write("")}})')
  elif command -v python3 >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | python3 -c 'import sys,json
try:
  c=json.load(sys.stdin).get("tool_input",{}).get("command","")
  sys.stdout.write(c if isinstance(c,str) else "")
except Exception:
  pass')
  else
    echo "gabarito-mestre: sem parser JSON (jq/node/python3) — guarda DESATIVADA neste comando (fail-open declarado, G9)" >&2
    exit 0
  fi
  if [ -z "$GABARITO_CMD" ]; then
    echo "gabarito-mestre: stdin sem .tool_input.command (JSON vazio ou malformado) — nada a inspecionar (fail-open declarado, G9)" >&2
    exit 0
  fi
}

# Escapa uma string para dentro de um literal JSON: \ " e controles (tab, newline, etc.).
gabarito_json_escape() {
  printf '%s' "$1" | LC_ALL=C awk '
    BEGIN { ORS = "" }
    {
      if (NR > 1) printf "\\n"
      s = $0
      gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\t/, "\\t", s); gsub(/\r/, "\\r", s)
      gsub(/[[:cntrl:]]/, " ", s)
      printf "%s", s
    }'
}

# Escape hatch nominal e grepável. Duas variáveis (a segunda é alias para deixar o R3 legível):
#   GABARITO_ALLOW_DESTRUCTIVE="motivo"   GABARITO_ALLOW_PRODUCTION="motivo"
# Vale (1) no ambiente do processo do Claude Code, ou (2) como PREFIXO do próprio comando —
# só no INÍCIO do comando, para que comentário ou `echo` no meio não libere:
#   GABARITO_ALLOW_DESTRUCTIVE='expurgo de build autorizado por gabriel 2026-09-05' rm -rf build
# O motivo precisa ter ≥ 8 caracteres e ≥ 2 palavras — "lol" não é motivo. Vazio NÃO libera.
# Devolve 0 (liberado) e imprime o aviso; devolve 1 se não há liberação.
gabarito_escape_hatch() {
  local motivo="${GABARITO_ALLOW_DESTRUCTIVE-}"
  [ -z "$motivo" ] && motivo="${GABARITO_ALLOW_PRODUCTION-}"
  local origem="env"
  if [ -z "$motivo" ]; then
    motivo=$(printf '%s' "$GABARITO_CMD" | head -n1 | sed -nE "s/^[[:space:]]*GABARITO_ALLOW_(DESTRUCTIVE|PRODUCTION)=(\"([^\"]*)\"|'([^']*)'|([^[:space:]]*)).*/\3\4\5/p")
    origem="inline"
  fi
  motivo=$(printf '%s' "$motivo" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  [ -z "$motivo" ] && return 1
  local palavras
  palavras=$(printf '%s' "$motivo" | wc -w | tr -d ' ')
  if [ "${#motivo}" -lt 8 ] || [ "$palavras" -lt 2 ]; then
    echo "gabarito-mestre: escape hatch IGNORADO ($1) — motivo curto demais (mínimo 8 caracteres e 2 palavras): '$motivo'" >&2
    return 1
  fi
  local esc
  esc=$(gabarito_json_escape "$motivo")
  echo "gabarito-mestre: ESCAPE HATCH usado ($1, via $origem) — motivo: $motivo" >&2
  printf '{"systemMessage":"⚠ gabarito-mestre: escape hatch usado (%s, via %s). Motivo declarado: %s"}\n' "$1" "$origem" "$esc"
  return 0
}

# Bloqueia: JSON no stdout (lido pelo Claude Code mesmo com exit 2) + motivo no stderr + exit 2.
gabarito_deny() {
  local reason="$1"
  local esc
  esc=$(gabarito_json_escape "$reason")
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  echo "$reason" >&2
  exit 2
}

# ── Normalização do texto varrido: MENÇÃO ≠ EXECUÇÃO ────────────────────────────────────
# 1. Remove o corpo de heredocs que só ESCREVEM ARQUIVO (`cat > x <<'EOF'`, `cat >> x <<'EOF'`,
#    `tee x <<'EOF'`) — anotação em progress.md que cita `rm -rf` não é `rm -rf` (falso positivo real,
#    medido em 7.037 comandos). SÓ quando o terminador é CITADO ('EOF'/"EOF"): em heredoc sem aspas
#    o bash expande `$(…)`, `` `…` `` e `${…}` na hora da escrita, então essas linhas são mantidas.
#    Qualquer outro heredoc (psql <<SQL, bash <<EOF, python3 - <<PY, `cat <<EOF | bash`) é mantido.
# 2. Remove segmentos de comando que só LEEM ou REGISTRAM texto: grep/rg/ag, git grep/log/commit -m,
#    sed. `grep "DROP TABLE"` e `git commit -m "fix: prod.example.com"` são menção, não acesso.
#    O corte é no próximo `|`, `;` ou `&` — o que vem depois (`| xargs rm -rf`) continua varrido.
# LIMITE DECLARADO: script escrito por heredoc/Write e executado no comando seguinte é invisível a
# este grep — para isso existem as guardas de runtime (G3/G7) e o review adversarial.
gabarito_scan_text() {
  awk '
    BEGIN { skip = 0; quoted = 0 }
    skip == 1 {
      t = $0; sub(/^\t+/, "", t)
      if (t == term) { skip = 0; next }
      if (quoted == 0 && ($0 ~ /\$\(/ || $0 ~ /`/ || $0 ~ /\$\{/)) { print; next }
      next
    }
    {
      if ($0 ~ /^[[:space:]]*(cat[[:space:]]*>>?[[:space:]]*[^|;&<]*<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*$|cat[[:space:]]+<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*>>?[[:space:]]*[^|;&<]*$|tee([[:space:]]+-a)?[[:space:]]+[^|;&<]*<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*$)/) {
        t = $0; sub(/^.*<<-?[[:space:]]*/, "", t); sub(/[[:space:]]*>.*$/, "", t)
        quoted = (t ~ /^["'"'"']/) ? 1 : 0
        gsub(/["'"'"']/, "", t); term = t; skip = 1; print; next
      }
      print
    }' | LC_ALL=C sed -E 's/(^|[|;&])[[:space:]]*(git[[:space:]]+(grep|log|commit)|grep|egrep|fgrep|rg|ag|sed|echo|printf)([[:space:]]+[^|;&]*)?/\1 /g'
}

# Compatibilidade com o nome antigo.
gabarito_strip_write_heredocs() { gabarito_scan_text; }

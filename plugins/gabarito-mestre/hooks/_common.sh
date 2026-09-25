#!/usr/bin/env bash
# Funções comuns aos hooks do gabarito-mestre. Compatível com bash 3.2 (macOS).
# Não é hook: é carregado por `source` pelos hooks.

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

# Escape hatch nominal e grepável. Assinatura: gabarito_escape_hatch <ROTULO> [<VAR>]
#   gabarito_escape_hatch "R2 · rm recursivo" GABARITO_ALLOW_DESTRUCTIVE
#   gabarito_escape_hatch "R20 · cabeçalho" GABARITO_ALLOW_VERSIONING
# <VAR> é o nome da variável que libera ESTE hook. Compatibilidade medida (README "Escape hatch"):
# GABARITO_ALLOW_DESTRUCTIVE e GABARITO_ALLOW_PRODUCTION aceitam uma pela outra — SÓ entre essas duas.
# Qualquer outra variável (ex.: GABARITO_ALLOW_VERSIONING) libera só o seu hook: hatches não cruzam.
# Sem <VAR> (chamada antiga com um argumento) vale o par DESTRUCTIVE/PRODUCTION.
# Vale (1) no ambiente do processo do Claude Code, ou (2) como PREFIXO do próprio comando —
# só no INÍCIO do comando, para que comentário ou `echo` no meio não libere:
#   GABARITO_ALLOW_DESTRUCTIVE='expurgo de build autorizado por gabriel 2026-09-05' <comando>
# O motivo precisa ter ≥ 8 caracteres e ≥ 2 palavras — "lol" não é motivo. Vazio NÃO libera.
# Devolve 0 (liberado) e imprime o aviso; devolve 1 se não há liberação.
gabarito_escape_hatch() {
  local rotulo="$1"
  local vars="${2-}"
  case "$vars" in
    ""|GABARITO_ALLOW_DESTRUCTIVE|GABARITO_ALLOW_PRODUCTION) vars="GABARITO_ALLOW_DESTRUCTIVE GABARITO_ALLOW_PRODUCTION" ;;
  esac
  local motivo="" v origem="env"
  for v in $vars; do
    case "$v" in
      *[!A-Z0-9_]*|"") continue ;;   # só identificador entra no eval
    esac
    [ -z "$motivo" ] && eval "motivo=\${$v-}"
  done
  if [ -z "$motivo" ]; then
    local alt
    alt=$(printf '%s' "$vars" | tr ' ' '|')
    motivo=$(printf '%s' "$GABARITO_CMD" | head -n1 | sed -nE "s/^[[:space:]]*(${alt})=(\"([^\"]*)\"|'([^']*)'|([^[:space:]]*)).*/\3\4\5/p")
    origem="inline"
  fi
  motivo=$(printf '%s' "$motivo" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  [ -z "$motivo" ] && return 1
  local palavras
  palavras=$(printf '%s' "$motivo" | wc -w | tr -d ' ')
  if [ "${#motivo}" -lt 8 ] || [ "$palavras" -lt 2 ]; then
    echo "gabarito-mestre: escape hatch IGNORADO ($rotulo) — motivo curto demais (mínimo 8 caracteres e 2 palavras): '$motivo'" >&2
    return 1
  fi
  local esc
  esc=$(gabarito_json_escape "$motivo")
  echo "gabarito-mestre: ESCAPE HATCH usado ($rotulo, via $origem) — motivo: $motivo" >&2
  printf '{"systemMessage":"⚠ gabarito-mestre: escape hatch usado (%s, via %s). Motivo declarado: %s"}\n' "$rotulo" "$origem" "$esc"
  return 0
}

# Raiz do repositório: `git rev-parse --show-toplevel` (sessão aberta em subpasta de monorepo resolve
# para a raiz); sem git ou fora de repo, o diretório atual. Nunca falha, nunca imprime erro.
gabarito_repo_root() {
  local r
  r=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$r" ]; then printf '%s' "$r"; else printf '%s' "$(pwd -P)"; fi
}

# Lê um valor de `<raiz>/harness.config.json` por caminho pontuado: gabarito_config_get versionamento.resolvidoEm [raiz]
# Saída: escalar cru (string/número/true/false); array → um elemento por linha; objeto → JSON compacto;
# ausente, null, arquivo ausente ou JSON inválido → vazio (quem chama decide o fail-open).
# Parser: jq → node → python3, como gabarito_read_command. Sem parser: vazio.
gabarito_config_get() {
  local caminho="$1" raiz="${2-}" arq
  [ -z "$raiz" ] && raiz=$(gabarito_repo_root)
  arq="$raiz/harness.config.json"
  [ -f "$arq" ] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg p "$caminho" 'getpath($p | split(".")) | if . == null then empty elif type == "array" then .[] elif type == "object" then tojson else tostring end' "$arq" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e 'const [f,p]=process.argv.slice(1);let j;try{j=JSON.parse(require("fs").readFileSync(f,"utf8"))}catch(e){process.exit(0)}let v=j;for(const k of p.split(".")){if(v==null||typeof v!=="object"){v=undefined;break}v=v[k]}if(v==null)process.exit(0);if(Array.isArray(v))process.stdout.write(v.map(String).join("\n")+"\n");else if(typeof v==="object")process.stdout.write(JSON.stringify(v)+"\n");else process.stdout.write(String(v)+"\n")' "$arq" "$caminho" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,json
f,p=sys.argv[1],sys.argv[2]
try: j=json.load(open(f))
except Exception: sys.exit(0)
v=j
for k in p.split("."):
  v=v.get(k) if isinstance(v,dict) else None
  if v is None: sys.exit(0)
if isinstance(v,bool): print("true" if v else "false")
elif isinstance(v,list): print("\n".join(str(x) for x in v))
elif isinstance(v,dict): print(json.dumps(v))
else: print(v)' "$arq" "$caminho" 2>/dev/null
  fi
  return 0
}

# Traduz um regex vindo do JSON (estilo JavaScript: \d, \w) para ERE do grep -E do sistema (BSD e GNU).
gabarito_ere() {
  printf '%s' "$1" | sed -E 's/\\d/[0-9]/g; s/\\w/[A-Za-z0-9_]/g'
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
# Só a etapa 1 (heredocs de escrita), sem remover grep/sed/commit: é o que guard-versioning.sh usa,
# porque lá `git commit -m` É o objeto inspecionado — mas anotação em heredoc citando um commit não é commit.
gabarito_strip_write_heredocs() {
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
    }'
}

# Etapas 1 + 2: o que guard-destructive.sh e guard-production.sh varrem.
gabarito_scan_text() {
  gabarito_strip_write_heredocs | LC_ALL=C sed -E 's/(^|[|;&])[[:space:]]*(git[[:space:]]+(grep|log|commit)|grep|egrep|fgrep|rg|ag|sed|echo|printf)([[:space:]]+[^|;&]*)?/\1 /g'
}

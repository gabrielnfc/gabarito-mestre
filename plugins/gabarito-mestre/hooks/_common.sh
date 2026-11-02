#!/usr/bin/env bash
# Funções comuns aos hooks do gabarito-mestre. Compatível com bash 3.2 (macOS).
# Não é hook: é carregado por `source` pelos hooks.

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
# Parser: jq → node → python3. Sem parser: vazio.
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

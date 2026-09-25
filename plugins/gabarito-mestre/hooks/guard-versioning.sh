#!/usr/bin/env bash
# gabarito-mestre · guard-versioning.sh — implementa a R20 (versionamento é gate, não convenção).
# PreToolUse/Bash. Lê JSON no stdin; bloqueia com JSON + exit 2; permite com exit 0 sem saída.
#
# Lê GABARITO_CMD CRU — NÃO passa por gabarito_scan_text, que remove `git commit -m` de propósito (menção ≠
# execução vale para R2/R3; aqui o commit É o objeto inspecionado). Duas exceções, medidas no R2 como falso
# positivo: (i) corpo de heredoc que só escreve arquivo (`cat >> notas.md <<'EOF'`) é removido antes
# (gabarito_strip_write_heredocs); (ii) `git` só conta em POSIÇÃO DE COMANDO — início de linha/segmento, após
# ; & | ( ` $( — com atribuições de env antes (é assim que o hatch inline chega). `echo "git commit -m x"` passa.
#
# O que valida (config `versionamento` de <raiz>/harness.config.json; raiz = git toplevel → cwd):
#   1 criação de branch   git checkout -b|-B <n> · git switch -c|-C|--create <n> · git branch <n> (sem
#                         -d/-D/-m/-M/--list/-a/-r/-v…) · git worktree add … -b|-B <n>
#                         <n> tem de casar `branchPadrao` OU `branchWorktree`.
#   2 cabeçalho de commit git commit -m "x" · -m 'x' · --message=x · -am "x" · -m "a" -m "b" (só o 1º) ·
#                         -m "$(cat <<'EOF' … EOF)" (1ª linha do corpo) · -F - <<'EOF' (1ª linha do corpo) ·
#                         -F <arquivo> / --file=<arquivo> (1ª linha do arquivo; relativo ao cwd, depois à raiz;
#                         ausente → fail-open com aviso).
#                         Cabeçalho = `tipo(escopo): assunto` ou `tipo: assunto` (`!` antes de `:` aceito).
#                         tipo ∈ tiposComEscopoDePbi → escopo obrigatório casando `fluxo.idPadrao`;
#                         tipo ∈ tiposLivres → escopo livre ou ausente; outro tipo → reprova.
# NÃO intercepta: `--amend` sem -m/-F, `git commit` sem mensagem (interativo), commit em `main`/`master`
# (o merge/squash do orquestrador é validado pelo título da PR — attest `squash-titulo-pr`).
# FAIL-OPEN DECLARADO (G9): sem `versionamento.resolvidoEm` (repo sem onboarding) → aviso em stderr, exit 0.
# Escape hatch: GABARITO_ALLOW_VERSIONING="motivo" (env ou prefixo NO INÍCIO do comando); ≥8 chars e ≥2 palavras.
# Hatches não cruzam: GABARITO_ALLOW_DESTRUCTIVE/PRODUCTION NÃO liberam este hook.
set -u
. "$(dirname "$0")/_common.sh"
gabarito_read_command

# Texto varrido: comando cru menos corpos de heredoc-de-escrita (anotação não é commit).
SCAN=$(printf '%s' "$GABARITO_CMD" | gabarito_strip_write_heredocs)

# Posição de comando (mesma ideia do guard-destructive): início, ou após ; & | ( ` $( — com atribuições antes.
NL=$'\n'
ASSIGN='([A-Za-z_][A-Za-z0-9_]*=("([^"\\]|\\.)*"|'"'"'[^'"'"']*'"'"'|\$\([^)]*\)|[^[:space:]]*)[[:space:]]+)*'
GITOPTS='git([[:space:]]+-[A-Za-z-]+([[:space:]=][^[:space:]]+)?)*[[:space:]]+'
POS_LINHA="(^|[;&|(\`]|\\\$\\()[[:space:]]*${ASSIGN}"           # grep/sed: linha a linha, ^ é início de linha
POS_TEXTO="(^|[;&|(\`${NL}]|\\\$\\()[[:space:]]*${ASSIGN}"      # awk sobre o texto inteiro: newline entra no colchete
GITP_L="${POS_LINHA}${GITOPTS}"    # grupos: 1 posição · 2-4 atribuições · 5-6 opções do git → o próximo grupo é \7
GITP_T="${POS_TEXTO}${GITOPTS}"

# Pré-filtro barato: sem `git` em posição de comando seguido de commit/checkout/switch/branch/worktree, nada a fazer.
printf '%s\n' "$SCAN" | LC_ALL=C grep -Eq "${GITP_L}(commit|checkout|switch|branch|worktree)([[:space:]]|$)" || exit 0

ROOT=$(gabarito_repo_root)
RESOLVIDO=$(gabarito_config_get versionamento.resolvidoEm "$ROOT")
if [ -z "$RESOLVIDO" ]; then
  echo "gabarito-mestre: harness.config.json sem versionamento.resolvidoEm — R20 não aplicada neste repo; rode gabarito-instalar (fail-open declarado, G9)" >&2
  exit 0
fi

# ── Config com defaults (contrato do plano-mestre); lista vazia no JSON conta como ausente ─────
BRANCH_RE=$(gabarito_config_get versionamento.branchPadrao "$ROOT")
[ -z "$BRANCH_RE" ] && BRANCH_RE='^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$'
WT_RE=$(gabarito_config_get versionamento.branchWorktree "$ROOT")
[ -z "$WT_RE" ] && WT_RE='^wt/[A-Z]+-\d+-\d+$'
ID_RE=$(gabarito_config_get fluxo.idPadrao "$ROOT")
[ -z "$ID_RE" ] && ID_RE='^[A-Z]+-\d+$'
TIPOS_PBI=$(gabarito_config_get versionamento.tiposComEscopoDePbi "$ROOT" | tr '\n' ' ')
[ -z "${TIPOS_PBI// /}" ] && TIPOS_PBI="feat fix enabler debt spike task perf refactor"
TIPOS_LIVRES=$(gabarito_config_get versionamento.tiposLivres "$ROOT" | tr '\n' ' ')
[ -z "${TIPOS_LIVRES// /}" ] && TIPOS_LIVRES="chore docs ci build test release revert"
BRANCH_ERE=$(gabarito_ere "$BRANCH_RE"); WT_ERE=$(gabarito_ere "$WT_RE"); ID_ERE=$(gabarito_ere "$ID_RE")
EXEMPLO_PBI="$(printf '%s' "$TIPOS_PBI" | awk '{print $1}')(PBI-123): assunto"
EXEMPLO_LIVRE="$(printf '%s' "$TIPOS_LIVRES" | awk '{print $1}'): assunto"
LISTA_PBI=$(printf '%s' "$TIPOS_PBI" | sed -E 's/[[:space:]]+$//; s/[[:space:]]+/, /g')
LISTA_LIVRES=$(printf '%s' "$TIPOS_LIVRES" | sed -E 's/[[:space:]]+$//; s/[[:space:]]+/, /g')

em_lista() { # em_lista <item> <lista separada por espaço>
  local i; for i in $2; do [ "$i" = "$1" ] && return 0; done; return 1
}

bloquear() { # bloquear <frase> <o que fazer> — três camadas: frase · o que fazer · regra citada
  local frase="$1" oque="$2"
  if gabarito_escape_hatch "R20 · $frase" GABARITO_ALLOW_VERSIONING; then exit 0; fi
  gabarito_deny "Versionamento bloqueado pela regra R20 ($frase). $oque Formas aceitas — branch: <tipo>/<PBI>-<slug> (ex.: feat/PBI-123-login) ou <livre>/<slug> (ex.: chore/bump-deps) ou wt/<PBI>-<n>; commit: tipo(escopo): assunto (ex.: $EXEMPLO_PBI) — tipos com escopo de PBI: $LISTA_PBI; tipos livres (escopo opcional, ex.: $EXEMPLO_LIVRE): $LISTA_LIVRES. Ver AGENTS.md §3 (R20) e referencia.md §10. Só com autorização do usuário: repita com GABARITO_ALLOW_VERSIONING=\"autorizado por <quem> em <data> — <motivo>\" no início do comando."
}

# ── 1. Criação de branch (um nome por segmento; segmentos separados por ; | & e newline) ──────
BRANCH_FLAGS='[[:space:]](-[a-zA-Z]*[dDmMarvc][a-zA-Z]*|--list|--delete|--move|--copy|--show-current|--contains|--no-contains|--merged|--no-merged|--set-upstream-to(=[^[:space:]]+)?|--unset-upstream|--edit-description|--track|--no-track|--all|--remotes|--verbose|--points-at|--sort(=[^[:space:]]+)?|--format(=[^[:space:]]+)?)([[:space:]]|$)'
NOMES=$(printf '%s\n' "$SCAN" | tr ';|&' '\n\n\n' | while IFS= read -r seg; do
  n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}checkout([[:space:]]+-[A-Za-z-]+)*[[:space:]]+(-b|-B)[[:space:]]+([^[:space:]]+).*/\9/p")
  [ -z "$n" ] && n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}switch([[:space:]]+-[A-Za-z-]+)*[[:space:]]+(-c|-C|--create)[[:space:]]+([^[:space:]]+).*/\9/p")
  [ -z "$n" ] && n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}worktree[[:space:]]+add([[:space:]]+[^[:space:]]+)*[[:space:]]+(-b|-B)[[:space:]]+([^[:space:]]+).*/\9/p")
  if [ -z "$n" ] && ! printf '%s' "$seg" | LC_ALL=C grep -Eq "$BRANCH_FLAGS"; then
    n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}branch[[:space:]]+([^-[:space:]][^[:space:]]*).*/\7/p")
  fi
  [ -n "$n" ] && printf '%s\n' "$n"
done)
for nome in $NOMES; do
  if ! printf '%s' "$nome" | LC_ALL=C grep -Eq "$BRANCH_ERE" && ! printf '%s' "$nome" | LC_ALL=C grep -Eq "$WT_ERE"; then
    bloquear "nome de branch '$nome' fora do padrão" "Crie a branch com o tipo do PBI e o ID do card (branchPadrao: $BRANCH_RE) ou como worktree de implementador (branchWorktree: $WT_RE)."
  fi
done

# ── 2. Cabeçalho do commit ───────────────────────────────────────────────────────────────
# Recorta o texto a partir do primeiro `git … commit` em posição de comando; sem ele, não há commit a validar.
COMMIT_TXT=$(printf '%s\n' "$SCAN" | GITP="$GITP_T" awk '
  { s = s (NR > 1 ? "\n" : "") $0 }
  END { if (match(s, ENVIRON["GITP"] "commit([[:space:]]|$)")) print substr(s, RSTART) }')
[ -z "$COMMIT_TXT" ] && exit 0

ATUAL=$(git -C "$ROOT" symbolic-ref --short -q HEAD 2>/dev/null || git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)
case "$ATUAL" in main|master) exit 0 ;; esac

CAB=""; FONTE=""
# (a) heredoc na linha do commit: -m "$(cat <<'EOF' … )" ou -F - <<'EOF' → 1ª linha do corpo
CAB=$(printf '%s\n' "$COMMIT_TXT" | awk -v gitp="$GITOPTS" '
  found == 0 && $0 ~ (gitp "commit") && /<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?/ { found = 1; next }
  found == 1 { sub(/^\t+/, ""); print; exit }')
[ -n "$CAB" ] && FONTE="heredoc"
# (b) -F <arquivo> / --file=<arquivo> (que não seja "-")
if [ -z "$CAB" ]; then
  ARQ=$(printf '%s\n' "$COMMIT_TXT" | tr '\n' ' ' | sed -nE "s/.*${GITOPTS}commit[^;&|]*[[:space:]](-F|--file)[[:space:]=]+(\"([^\"]*)\"|'([^']*)'|([^[:space:];&|]+)).*/\5\6\7/p")
  if [ -n "$ARQ" ] && [ "$ARQ" != "-" ]; then
    case "$ARQ" in /*) CAND="$ARQ" ;; *) CAND="$PWD/$ARQ"; [ -f "$CAND" ] || CAND="$ROOT/$ARQ" ;; esac
    if [ -f "$CAND" ]; then
      CAB=$(head -n1 "$CAND"); FONTE="arquivo $ARQ"
    else
      echo "gabarito-mestre: git commit -F '$ARQ' — arquivo não encontrado a partir de $PWD nem de $ROOT; cabeçalho não inspecionado (fail-open declarado, G9)" >&2
      exit 0
    fi
  fi
fi
# (c) -m / --message= / -am / -m duplo → primeiro argumento após o PRIMEIRO flag de mensagem, 1ª linha
if [ -z "$CAB" ]; then
  CAB=$(printf '%s\n' "$COMMIT_TXT" | awk -v gitp="$GITOPTS" '
    { s = s (NR > 1 ? "\n" : "") $0 }
    END {
      if (!match(s, gitp "commit")) exit
      s = substr(s, RSTART + RLENGTH)
      if (!match(s, /(^|[[:space:]])(-[a-zA-Z]*m|--message)([[:space:]]+|=)/)) exit
      s = substr(s, RSTART + RLENGTH)
      c = substr(s, 1, 1)
      if (c == "\"") {
        out = ""; i = 2
        while (i <= length(s)) {
          ch = substr(s, i, 1)
          if (ch == "\\" && i < length(s)) { out = out substr(s, i + 1, 1); i += 2; continue }
          if (ch == "\"") break
          out = out ch; i++
        }
      } else if (c == "'"'"'") {
        out = substr(s, 2); sub(/'"'"'.*/, "", out)
      } else {
        out = s; sub(/[[:space:];&|].*/, "", out)
      }
      sub(/\n.*/, "", out)
      print out
    }')
  [ -n "$CAB" ] && FONTE="-m"
fi
[ -z "$CAB" ] && exit 0   # --amend sem -m, commit interativo, mensagem vazia: não é deste hook

TIPO=$(printf '%s' "$CAB" | sed -nE 's/^([a-z]+)(\(([^)]*)\))?!?: (.+)$/\1/p')
ESCOPO=$(printf '%s' "$CAB" | sed -nE 's/^([a-z]+)(\(([^)]*)\))?!?: (.+)$/\3/p')
if [ -z "$TIPO" ]; then
  bloquear "cabeçalho '$CAB' não é Conventional Commits" "Reescreva a primeira linha da mensagem (fonte: $FONTE) como tipo(escopo): assunto, com espaço depois dos dois-pontos."
fi
if em_lista "$TIPO" "$TIPOS_PBI"; then
  if [ -z "$ESCOPO" ]; then
    bloquear "tipo '$TIPO' exige o ID do PBI como escopo" "Escreva $TIPO(<PBI>): assunto, com <PBI> casando $ID_RE (ex.: $TIPO(PBI-123): assunto). Sem PBI, use um tipo livre ($LISTA_LIVRES) se couber."
  fi
  if ! printf '%s' "$ESCOPO" | LC_ALL=C grep -Eq "$ID_ERE"; then
    bloquear "escopo '$ESCOPO' não casa o padrão de ID $ID_RE" "Use o ID do card exatamente como na ferramenta (maiúsculas, hífen, número), ex.: $TIPO(PBI-123): assunto."
  fi
elif ! em_lista "$TIPO" "$TIPOS_LIVRES"; then
  bloquear "tipo '$TIPO' não existe na convenção" "Use um tipo com escopo de PBI ($LISTA_PBI) ou um tipo livre ($LISTA_LIVRES). Hotfix é fix(<PBI de Bug>): assunto."
fi
exit 0

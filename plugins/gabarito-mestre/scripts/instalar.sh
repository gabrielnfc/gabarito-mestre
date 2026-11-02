#!/usr/bin/env bash
# gabarito-mestre · instalar.sh — instala ou atualiza o harness no repositório alvo. bash 3.2 (macOS).
# uso: instalar.sh [dir] [--atualizar] [--guarda] [--codeowners]
#   (sem flag)    instala o que falta. NUNCA sobrescreve nem apaga (R2). Copia os gates para tools/gabarito-gates/
#                 SEM test/, README.md nem .hashes-anteriores (a suíte vive no repo do plugin) e emenda o .gitignore.
#                 Nível de adoção fica `____`; o doctor mede ao fim.
#   --atualizar   o que já existe e difere do plugin (reference/*, gates) → <destino>.novo + diff --stat (nunca
#                 sobrescreve); avisa R19→R30+. O doctor NÃO roda (os .novo ainda serão aplicados à mão).
#   --guarda      2ª camada da guarda: UNE as 7 entradas de segredo ao permissions.deny de .claude/settings.json.
#                 Em dúvida (JSON inválido ou com comentário, symlink, sem permissão, formato inesperado, sem node)
#                 NÃO escreve: diz o motivo e imprime a linha para você colar.
#   --codeowners  cria .github/CODEOWNERS (se ausente) com o esqueleto "Áreas e donos" (TIM-1).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEST=""; ATUALIZAR=0; GUARDA=0; CODEOWNERS=0
for a in "$@"; do
  case "$a" in
    --atualizar) ATUALIZAR=1 ;;
    --guarda) GUARDA=1 ;;
    --codeowners) CODEOWNERS=1 ;;
    --help|-h) sed -n '2,12p' "$0"; exit 0 ;;
    --*) echo "instalar.sh: flag desconhecida: $a (use --atualizar, --guarda, --codeowners)" >&2; exit 2 ;;
    *) DEST="$a" ;;
  esac
done
DEST="${DEST:-$PWD}"; DEST="$(cd "$DEST" && pwd)"
GATES_DIR="tools/gabarito-gates"
criados=0; mantidos=0; novos=0; iguais=0

# ── utilitários ────────────────────────────────────────────────────────────────────────────
diff_stat() { # diff_stat <antigo> <novo> — uma linha de resumo, indentada
  if command -v git >/dev/null 2>&1; then
    git diff --no-index --stat -- "$1" "$2" 2>/dev/null | tail -n1 | sed 's/^/           /' || true
  else
    printf '           %s linha(s) diferem\n' "$(diff "$1" "$2" | grep -c '^[<>]' || true)"
  fi
}

# ── instaladores ───────────────────────────────────────────────────────────────────────────
put() { # put <origem-rel-ao-plugin> <destino-rel>  — nunca sobrescreve
  local src="$ROOT/$1" dst="$DEST/$2"
  if [ -e "$dst" ]; then echo "  mantido  $2 (já existia — não sobrescrevo)"; mantidos=$((mantidos+1)); return; fi
  mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; echo "  criado   $2"; criados=$((criados+1))
}
put_ref() { # put_ref <origem> <destino-rel> — referência do harness e gates: --atualizar gera .novo + diff --stat
  local src="$ROOT/$1" dst="$DEST/$2"
  [ -e "$src" ] || return 0
  if [ ! -e "$dst" ]; then put "$1" "$2"; return; fi
  if [ "$ATUALIZAR" -eq 0 ]; then echo "  mantido  $2 (já existia — não sobrescrevo)"; mantidos=$((mantidos+1)); return; fi
  # rm -f "$dst.novo": só apaga um .novo que ESTE instalador tenha deixado para trás numa
  # execução anterior (ficou obsoleto porque agora $2 é igual à referência do plugin) — a
  # ÚNICA deleção que este script faz; nunca apaga nada que não tenha sido escrito por ele.
  if cmp -s "$src" "$dst"; then echo "  igual    $2"; iguais=$((iguais+1)); rm -f "$dst.novo"; return; fi
  cp "$src" "$dst.novo"; echo "  novo     $2.novo (aplique à mão; $2 intocado)"; diff_stat "$dst" "$dst.novo"; novos=$((novos+1))
}
emendar_gitignore() { # garante as linhas exatas; nunca remove; respeita arquivo sem \n final
  local gi="$DEST/.gitignore" l add=0
  [ -e "$gi" ] || : > "$gi"
  for l in '.harness/doctor-cache.json' '.harness/fluxo-cache.json' '.harness/entregas/_sem-id/' '*.novo' '*.bak'; do
    if ! grep -qxF -- "$l" "$gi"; then
      if [ -s "$gi" ] && [ -n "$(tail -c1 "$gi")" ]; then printf '\n' >> "$gi"; fi
      printf '%s\n' "$l" >> "$gi"; add=$((add+1))
    fi
  done
  if [ "$add" -gt 0 ]; then echo "  emendado .gitignore (+$add linha(s); nada removido)"; else echo "  mantido  .gitignore (já ignora o estado do harness)"; fi
}
instalar_guarda() { # --guarda: a emenda do JSON é do onboarding-config.mjs (une, nunca substitui; recusa em dúvida)
  local linha='"permissions": { "deny": ["Read(.env*)", "Read(!.env.example)", "Edit(.env*)", "Read(**/*.pem)", "Edit(**/*.pem)", "Read(**/*.key)", "Edit(**/*.key)"] }'
  if ! command -v node >/dev/null 2>&1; then
    echo "[ONB-7] .claude/settings.json NÃO escrito — node não encontrado (a emenda segura do JSON precisa dele)"
    echo "  Cole você mesmo em .claude/settings.json, dentro de \"permissions\":"
    echo "    $linha"
    return 0
  fi
  if ! node "$ROOT/gates/scripts/onboarding-config.mjs" --root "$DEST" --deny-guarda; then
    echo "[ONB-7] .claude/settings.json NÃO escrito — o script de emenda falhou"
    echo "  Cole você mesmo em .claude/settings.json, dentro de \"permissions\":"
    echo "    $linha"
  fi
}

# ── execução ───────────────────────────────────────────────────────────────────────────────
if [ "$ATUALIZAR" -eq 1 ]; then echo "gabarito-mestre → atualizando em $DEST"; else echo "gabarito-mestre → instalando em $DEST"; fi
put_ref reference/AGENTS.md         AGENTS.md
put_ref reference/referencia.md     docs/harness/referencia.md
put_ref reference/gates.md          docs/harness/gates.md
put_ref reference/adocao.md         docs/harness/adocao.md
put_ref reference/prompts.md        docs/harness/prompts.md
put_ref reference/fluxo.md          docs/harness/fluxo.md
put templates/harness.config.json harness.config.json
put templates/attest.json       .harness/attest.json
put templates/gabarito.yml      .github/workflows/gabarito.yml
# CLAUDE.md: só a linha de import. Se existir, garante a linha sem apagar nada.
if [ -e "$DEST/CLAUDE.md" ]; then
  if grep -qE '^@AGENTS\.md\s*$' "$DEST/CLAUDE.md"; then echo "  mantido  CLAUDE.md (já importa AGENTS.md)"; mantidos=$((mantidos+1))
  else printf '\n@AGENTS.md\n' >> "$DEST/CLAUDE.md"; echo "  emendado CLAUDE.md (+ linha @AGENTS.md; nada removido)"; criados=$((criados+1)); fi
else put templates/CLAUDE.md CLAUDE.md; fi
# gates → tools/gabarito-gates (arquivo a arquivo). A suíte (test/), o README e o .hashes-anteriores ficam no plugin.
while IFS= read -r f; do
  rel="${f#"$ROOT/gates/"}"
  case "$rel" in test/*|README.md|.hashes-anteriores) continue ;; esac
  put_ref "gates/$rel" "$GATES_DIR/$rel"
done < <(find "$ROOT/gates" -type f -not -path '*/node_modules/*' -not -name .DS_Store | sort)
emendar_gitignore
# Versionamento (R20) como hooks do git (commit-msg + pre-push). Anexa entre marcadores, nunca sobrescreve,
# idempotente; em dúvida o instalador NÃO toca e avisa (recusado). Só grava o hook se o versionamento-check
# INSTALADO anuncia --msg: gate antigo (1.1.0) sem --msg viraria hook que reprova todo commit. Sem node: avisa.
CHECK_INSTALADO="$DEST/$GATES_DIR/scripts/versionamento-check.mjs"
if ! command -v node >/dev/null 2>&1; then
  echo "  AVISO: node não encontrado — hooks git de versionamento (R20) não instalados"
elif [ -f "$CHECK_INSTALADO" ] && grep -q -- '--msg' "$CHECK_INSTALADO" && grep -q -- '--pre-push' "$CHECK_INSTALADO"; then
  node "$ROOT/gates/scripts/instalar-hooks-git.mjs" "$DEST" || true
else
  echo "  AVISO: $GATES_DIR/scripts/versionamento-check.mjs instalado é anterior (sem --msg/--pre-push) — hooks git (R20) NÃO instalados."
  echo "         Rode: instalar.sh --atualizar, aplique à mão o versionamento-check.mjs.novo e rode instalar.sh de novo."
fi
if [ "$GUARDA" -eq 1 ]; then instalar_guarda; fi
if [ "$CODEOWNERS" -eq 1 ]; then
  if [ -e "$DEST/.github/CODEOWNERS" ]; then echo "  mantido  .github/CODEOWNERS"; mantidos=$((mantidos+1)); else
    mkdir -p "$DEST/.github"
    printf '# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:\n# <caminho/>  @<dono>\n' > "$DEST/.github/CODEOWNERS"
    echo "  criado   .github/CODEOWNERS (esqueleto)"; criados=$((criados+1)); fi
fi

echo "── $criados criado(s), $mantidos mantido(s), $iguais igual(is), $novos .novo. Nenhum arquivo apagado ou sobrescrito."
if [ "$ATUALIZAR" -eq 1 ]; then
  echo "── R19–R21 agora são do harness (fluxo · versionamento · orquestração); regras de projeto passam a R30+ — renumere no Apêndice ao aplicar o AGENTS.md.novo."
  echo "── Aplique os .novo à mão (diff acima) e rode o doctor depois: node $GATES_DIR/scripts/harness-doctor.mjs --explain"
  exit 0
fi
echo "── Nível de adoção NÃO foi declarado (fica \`____\` no AGENTS.md §0.2). Meça com o doctor:"
echo
if ! command -v node >/dev/null 2>&1; then
  echo "AVISO: node não encontrado — o doctor não rodou. Instale Node ≥ 22.18 e rode: node $GATES_DIR/scripts/harness-doctor.mjs --explain"
else
  if (cd "$DEST" && node "$GATES_DIR/scripts/harness-doctor.mjs" --explain); then rc=0; else rc=$?; fi
  [ "$rc" -ne 0 ] && echo "doctor saiu com código $rc (nível declarado maior que o medido, ou erro acima)."
fi
echo
echo "── Próximos passos: (1) preencher o Apêndice do AGENTS.md · (2) declarar no §0.2 o nível que o doctor MEDIU · (3) calibrar antes de ligar gates (docs/harness/adocao.md §3) · (4) rodar gabarito-instalar para o onboarding de fluxo, versionamento e orquestração"

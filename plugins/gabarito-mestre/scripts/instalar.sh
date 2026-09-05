#!/usr/bin/env bash
# gabarito-mestre · instalar.sh — instala o harness no repositório alvo.
# uso: instalar.sh [dir-do-repo]   (default: diretório atual)
# NUNCA sobrescreve nem apaga: arquivo existente é mantido e reportado. Nível de adoção fica `____`.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$PWD}"; DEST="$(cd "$DEST" && pwd)"
criados=0; mantidos=0
put() { # put <origem> <destino-relativo>
  local src="$ROOT/$1" dst="$DEST/$2"
  if [ -e "$dst" ]; then echo "  mantido  $2 (já existia — não sobrescrevo)"; mantidos=$((mantidos+1)); return; fi
  mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; echo "  criado   $2"; criados=$((criados+1))
}
echo "gabarito-mestre → instalando em $DEST"
put reference/AGENTS.md         AGENTS.md
put reference/referencia.md     docs/harness/referencia.md
put reference/gates.md          docs/harness/gates.md
put reference/adocao.md         docs/harness/adocao.md
put reference/prompts.md        docs/harness/prompts.md
put templates/harness.config.json harness.config.json
put templates/attest.json       .harness/attest.json
put templates/gabarito.yml      .github/workflows/gabarito.yml
# CLAUDE.md: só a linha de import. Se existir, garante a linha sem apagar nada.
if [ -e "$DEST/CLAUDE.md" ]; then
  if grep -qE '^@AGENTS\.md\s*$' "$DEST/CLAUDE.md"; then echo "  mantido  CLAUDE.md (já importa AGENTS.md)"; mantidos=$((mantidos+1))
  else printf '\n@AGENTS.md\n' >> "$DEST/CLAUDE.md"; echo "  emendado CLAUDE.md (+ linha @AGENTS.md; nada removido)"; criados=$((criados+1)); fi
else put templates/CLAUDE.md CLAUDE.md; fi
# gates → tools/gabarito-gates (arquivo a arquivo, sem sobrescrever)
while IFS= read -r f; do rel="${f#$ROOT/gates/}"; put "gates/$rel" "tools/gabarito-gates/$rel"; done < <(find "$ROOT/gates" -type f -not -path '*/node_modules/*' | sort)
echo "── $criados criado(s), $mantidos mantido(s). Nenhum arquivo apagado ou sobrescrito."
echo "── Nível de adoção NÃO foi declarado (fica \`____\` no AGENTS.md §0.2). Meça com o doctor:"
echo
cd "$DEST" && node tools/gabarito-gates/scripts/harness-doctor.mjs --explain || true
echo
echo "── Próximos passos: (1) preencher o Apêndice do AGENTS.md · (2) declarar no §0.2 o nível que o doctor MEDIU · (3) calibrar antes de ligar gates (docs/harness/adocao.md §3)"

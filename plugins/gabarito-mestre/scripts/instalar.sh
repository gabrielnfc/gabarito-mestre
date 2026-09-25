#!/usr/bin/env bash
# gabarito-mestre · instalar.sh — instala ou atualiza o harness no repositório alvo. bash 3.2 (macOS).
# uso: instalar.sh [dir] [--atualizar] [--gates-substituir] [--codeowners]
#   (sem flag)          instala o que falta. NUNCA sobrescreve nem apaga (R2). Grava
#                       tools/gabarito-gates/.instalado.json (hashes do que ESTE script escreveu) e
#                       emenda o .gitignore. Nível de adoção fica `____`; o doctor mede ao fim.
#   --atualizar         reference/* já existentes → <destino>.novo + diff --stat (nunca sobrescreve);
#                       avisa R19→R30+. O doctor NÃO roda (os .novo ainda serão aplicados à mão).
#   --gates-substituir  (exige --atualizar) tools/gabarito-gates/ arquivo a arquivo, com .bak; RECUSA
#                       (→ .novo) o que foi editado localmente: hash ≠ .instalado.json. Única exceção
#                       ao "nunca sobrescreve" (ADR-TIM-1).
#   --codeowners        cria .github/CODEOWNERS (se ausente) com o esqueleto "Áreas e donos" (TIM-1).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEST=""; ATUALIZAR=0; GATES_SUBSTITUIR=0; CODEOWNERS=0
for a in "$@"; do
  case "$a" in
    --atualizar) ATUALIZAR=1 ;;
    --gates-substituir) GATES_SUBSTITUIR=1 ;;
    --codeowners) CODEOWNERS=1 ;;
    --help|-h) sed -n '2,13p' "$0"; exit 0 ;;
    --*) echo "instalar.sh: flag desconhecida: $a (use --atualizar, --gates-substituir, --codeowners)" >&2; exit 2 ;;
    *) DEST="$a" ;;
  esac
done
if [ "$GATES_SUBSTITUIR" -eq 1 ] && [ "$ATUALIZAR" -eq 0 ]; then
  echo "instalar.sh: --gates-substituir exige --atualizar (ADR-TIM-1: substituir gates é um passo da atualização)" >&2; exit 2
fi
DEST="${DEST:-$PWD}"; DEST="$(cd "$DEST" && pwd)"
GATES_DIR="tools/gabarito-gates"
MANIFESTO="$DEST/$GATES_DIR/.instalado.json"
criados=0; mantidos=0; novos=0; iguais=0; substituidos=0; recusados=0
ESCRITOS=""   # relativos a tools/gabarito-gates/, um por linha: o que ESTA execução escreveu
MISTO=0       # 1 = algum gate já instalado vai ficar diferente do plugin (F2-R9); ver pré-varredura abaixo

# ── utilitários ────────────────────────────────────────────────────────────────────────────
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
versao_gates() { sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/gates/package.json" | head -n1; }
# hash gravado no manifesto para <rel>, ou vazio (ausente do manifesto = nunca passou pelo
# instalador). Usado tal e qual por escrever_manifesto (preserva só o que já era conhecido —
# um .hashes-anteriores nunca deve "aparecer" sozinho no manifesto de um arquivo intocado).
hash_manifesto() {
  [ -f "$MANIFESTO" ] || return 0
  local chave; chave="$(printf '%s' "$1" | sed 's/[.[\*^$]/\\&/g')"
  sed -nE "s|^[[:space:]]*\"$chave\"[[:space:]]*:[[:space:]]*\"([0-9a-f]{64})\".*|\1|p" "$MANIFESTO" | head -n1
}
# hash da 1.0.1 (gates/.hashes-anteriores) para <rel>, ou vazio. Só entra na decisão de
# --gates-substituir (F2-R9): repo 1.0.1 sem manifesto ainda precisa provar "isto é o
# arquivo original" para ser substituído — nunca usado para preencher o manifesto novo.
hash_anterior() {
  [ -f "$ROOT/gates/.hashes-anteriores" ] || return 0
  awk -v r="$1" '$1 !~ /^#/ && $2 == r { print $1; exit }' "$ROOT/gates/.hashes-anteriores"
}
escrito_nesta_execucao() { printf '%s' "$ESCRITOS" | grep -qxF -- "$1"; }
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
put_ref() { # put_ref <origem> <destino-rel> — referência do harness: --atualizar gera .novo + diff --stat
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
put_gate() { # put_gate <rel-dentro-de-gates> — ADR-TIM-1
  local rel="$1" src="$ROOT/gates/$1" dst="$DEST/$GATES_DIR/$1" disco gravado
  if [ ! -e "$dst" ]; then
    # F2-R9: se algum gate JÁ instalado vai ficar diferente do plugin depois desta execução
    # (MISTO=1 — ver pré-varredura abaixo), um arquivo NOVO não é instalado direto — nunca
    # scripts/ de uma versão convivendo com test/ de outra. Duas situações:
    #   GATES_SUBSTITUIR=0 (sem flag nenhuma, ou --atualizar sem --gates-substituir): NADA em
    #     gates/ está sendo corrigido nesta execução — todo arquivo novo (scripts/ E test/) vai
    #     para .novo; a cópia instalada fica 100% na versão antiga até rodar --gates-substituir.
    #   GATES_SUBSTITUIR=1 com MISTO por causa de um arquivo RECUSADO (editado localmente): só
    #     os test/ novos (testariam a versão nova) vão para .novo; scripts/ novos são aditivos.
    if [ "$MISTO" -eq 1 ] && { [ "$GATES_SUBSTITUIR" -eq 0 ] || [ "${rel#test/}" != "$rel" ]; }; then
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst.novo"
      echo "  novo     $GATES_DIR/$rel.novo (tools/gabarito-gates em 1.0.x — rode --atualizar --gates-substituir)"
      novos=$((novos+1))
      return
    fi
    put "gates/$rel" "$GATES_DIR/$rel"; ESCRITOS="$ESCRITOS$rel"$'\n'; return
  fi
  if cmp -s "$src" "$dst"; then # idêntico ao plugin: registra no manifesto (F2-R9) — nunca fica "nunca passou pelo instalador"
    if [ "$ATUALIZAR" -eq 1 ]; then iguais=$((iguais+1)); else mantidos=$((mantidos+1)); fi
    ESCRITOS="$ESCRITOS$rel"$'\n'
    return
  fi
  if [ "$GATES_SUBSTITUIR" -eq 0 ]; then
    if [ "$ATUALIZAR" -eq 1 ]; then echo "  difere   $GATES_DIR/$rel (use --atualizar --gates-substituir)"; else echo "  mantido  $GATES_DIR/$rel (já existia — não sobrescrevo)"; fi
    mantidos=$((mantidos+1)); return
  fi
  disco="$(sha256 "$dst")"; gravado="$(hash_manifesto "$rel")"
  [ -n "$gravado" ] || gravado="$(hash_anterior "$rel")"
  if [ -n "$gravado" ] && [ "$gravado" = "$disco" ]; then
    cp "$dst" "$dst.bak"; cp "$src" "$dst"; ESCRITOS="$ESCRITOS$rel"$'\n'
    echo "  substituído $GATES_DIR/$rel (.bak guardado)"; substituidos=$((substituidos+1))
  else
    cp "$src" "$dst.novo"
    echo "  recusado $GATES_DIR/$rel — editado localmente (hash ≠ .instalado.json); gravei $rel.novo"; recusados=$((recusados+1))
  fi
}
escrever_manifesto() { # entradas: escritos nesta execução (hash novo) + entradas antigas ainda válidas
  local tmp="$MANIFESTO.tmp" primeiro=1 rel h
  mkdir -p "$(dirname "$MANIFESTO")"
  {
    printf '{\n  "versao": "%s",\n  "em": "%s",\n  "arquivos": {\n' "$(versao_gates)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      if escrito_nesta_execucao "$rel"; then h="$(sha256 "$DEST/$GATES_DIR/$rel")"; else h="$(hash_manifesto "$rel")"; fi
      [ -n "$h" ] || continue
      if [ "$primeiro" -eq 1 ]; then primeiro=0; else printf ',\n'; fi
      printf '    "%s": "%s"' "$rel" "$h"
    done < <(cd "$ROOT/gates" && find . -type f -not -path '*/node_modules/*' -not -name .DS_Store | sed 's|^\./||' | sort)
    printf '\n  }\n}\n'
  } > "$tmp"
  mv "$tmp" "$MANIFESTO"
}
emendar_gitignore() { # garante 4 linhas exatas; nunca remove; respeita arquivo sem \n final
  local gi="$DEST/.gitignore" l add=0
  [ -e "$gi" ] || : > "$gi"
  for l in '.harness/doctor-cache.json' '.harness/fluxo-cache.json' '*.novo' '*.bak'; do
    if ! grep -qxF -- "$l" "$gi"; then
      if [ -s "$gi" ] && [ -n "$(tail -c1 "$gi")" ]; then printf '\n' >> "$gi"; fi
      printf '%s\n' "$l" >> "$gi"; add=$((add+1))
    fi
  done
  if [ "$add" -gt 0 ]; then echo "  emendado .gitignore (+$add linha(s); nada removido)"; else echo "  mantido  .gitignore (já ignora o estado do harness)"; fi
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
# Pré-varredura (F2-R9, roda SEMPRE — com ou sem flags): existe algum gate JÁ instalado
# (tools/gabarito-gates/ pode já existir de uma instalação 1.0.x anterior, mesmo sem
# --atualizar) que vai ficar diferente do plugin depois desta execução (não será
# substituído)? Se sim, MISTO=1 — ver put_gate para o que isso muda nos arquivos NOVOS.
# Repo novo (tools/gabarito-gates/ ainda não existe): todo `[ -e "$dstm" ]` abaixo falha,
# o loop não encontra nada e MISTO continua 0 — instalação limpa não regride.
while IFS= read -r f; do
  relm="${f#"$ROOT/gates/"}"; dstm="$DEST/$GATES_DIR/$relm"
  [ -e "$dstm" ] || continue
  cmp -s "$f" "$dstm" && continue
  if [ "$GATES_SUBSTITUIR" -eq 0 ]; then MISTO=1; break; fi
  discom="$(sha256 "$dstm")"; gravadom="$(hash_manifesto "$relm")"
  [ -n "$gravadom" ] || gravadom="$(hash_anterior "$relm")"
  if [ -z "$gravadom" ] || [ "$gravadom" != "$discom" ]; then MISTO=1; break; fi
done < <(find "$ROOT/gates" -type f -not -path '*/node_modules/*' -not -name .DS_Store | sort)
# gates → tools/gabarito-gates (arquivo a arquivo)
while IFS= read -r f; do put_gate "${f#"$ROOT/gates/"}"; done < <(find "$ROOT/gates" -type f -not -path '*/node_modules/*' -not -name .DS_Store | sort)
escrever_manifesto
emendar_gitignore
if [ "$CODEOWNERS" -eq 1 ]; then
  if [ -e "$DEST/.github/CODEOWNERS" ]; then echo "  mantido  .github/CODEOWNERS"; mantidos=$((mantidos+1)); else
    mkdir -p "$DEST/.github"
    printf '# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:\n# <caminho/>  @<dono>\n' > "$DEST/.github/CODEOWNERS"
    echo "  criado   .github/CODEOWNERS (esqueleto)"; criados=$((criados+1)); fi
fi

echo "── $criados criado(s), $mantidos mantido(s), $iguais igual(is), $novos .novo, $substituidos substituído(s), $recusados recusado(s). Nenhum arquivo apagado ou sobrescrito fora de $GATES_DIR (e lá só com .bak e hash conferido)."
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

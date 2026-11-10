#!/usr/bin/env bash
# Testes do caso NOM-1 de texto.test.sh (REQ-NOM-1: nome "Fluxo Gabarito", sem "workflow[ _-]?true").
# Cada caso monta um repo git descartável em mktemp -d, copia texto.test.sh para o MESMO caminho
# relativo (a raiz do repo fixture é calculada pela localização do script), planta um arquivo e
# roda `texto.test.sh --nom`, que sai só com a checagem NOM-1. Rodar da raiz do plugin.
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
TEXTO="$AQUI/texto.test.sh"
# texto do nome antigo montado por partes: este arquivo não pode casar a própria checagem.
NOME_ANTIGO="Work""flow TRUE"

falhas=0
ok()    { echo "  ok    $1"; }
falha() { falhas=$((falhas+1)); echo "  FALHA $1: $2" >&2; }

# caso <nome> <rc esperado> <arquivo relativo à raiz do fixture> <conteúdo>
caso() {
  local nome="$1" esp="$2" arq="$3" txt="$4" fx rc
  fx="$(mktemp -d "${TMPDIR:-/tmp}/nom-XXXXXX")"
  mkdir -p "$fx/plugins/gabarito-mestre/scripts/test" "$(dirname "$fx/$arq")"
  cp "$TEXTO" "$fx/plugins/gabarito-mestre/scripts/test/texto.test.sh"
  printf '%s\n' "$txt" > "$fx/$arq"
  (cd "$fx" && git init -q && git add -A && bash plugins/gabarito-mestre/scripts/test/texto.test.sh --nom >/dev/null 2>&1)
  rc=$?
  if [ "$rc" = "$esp" ]; then ok "$nome (rc $rc)"; else falha "$nome" "rc $rc, esperado $esp"; fi
}

echo "── NOM-1 (texto-nom.test.sh): checagem de nome em repo fixture"
caso nom-plantado-no-plugin-falha 1 plugins/gabarito-mestre/README.md "x $NOME_ANTIGO"
caso nom-sem-caixa-e-separador-falha 1 plugins/gabarito-mestre/README.md "x work""flow_true"
caso nom-em-ledger-passa 0 docs/ledgers/GM-1.md "x $NOME_ANTIGO"
caso nom-em-aprendizado-passa 0 docs/aprendizados/loop-e1.md "x $NOME_ANTIGO"
caso nom-em-references-passa 0 docs/references/x.md "x $NOME_ANTIGO"
caso nom-changelog-secao-110-passa 0 CHANGELOG.md "## [2.0.0]
ok
## [1.1.0]
x $NOME_ANTIGO"
caso nom-changelog-acima-do-1-falha 1 CHANGELOG.md "## [2.0.0]
x $NOME_ANTIGO
## [1.1.0]
ok"
caso nom-plano-datado-antigo-passa 0 docs/superpowers/plans/2026-09-24-x.md "x $NOME_ANTIGO"
caso nom-spec-no-dia-anterior-passa 0 docs/superpowers/specs/2026-11-09-x-design.md "x $NOME_ANTIGO"
caso nom-plano-na-data-do-corte-passa 0 docs/superpowers/plans/2026-11-10-x.md "x $NOME_ANTIGO"
caso nom-plano-novo-falha 1 docs/superpowers/plans/2026-11-11-x.md "x $NOME_ANTIGO"
caso nom-spec-no-dia-seguinte-ao-corte-falha 1 docs/superpowers/specs/2026-11-11-x-design.md "x $NOME_ANTIGO"
caso nom-doc-comum-falha 1 docs/backlog.md "x $NOME_ANTIGO"
caso nom-fora-do-escopo-passa 0 outro/x.md "x $NOME_ANTIGO"

echo "── $falhas falha(s)"
[ "$falhas" -eq 0 ]

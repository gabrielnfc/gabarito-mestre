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

# caso_fase <nome> <rc esperado> <arquivo relativo à raiz do fixture> <conteúdo>: igual a `caso`, mas roda só a checagem FASE
caso_fase() {
  local nome="$1" esp="$2" arq="$3" txt="$4" fx rc
  fx="$(mktemp -d "${TMPDIR:-/tmp}/fase-XXXXXX")"
  mkdir -p "$fx/plugins/gabarito-mestre/scripts/test" "$(dirname "$fx/$arq")"
  cp "$TEXTO" "$fx/plugins/gabarito-mestre/scripts/test/texto.test.sh"
  printf '%s\n' "$txt" > "$fx/$arq"
  (cd "$fx" && git init -q && git add -A && bash plugins/gabarito-mestre/scripts/test/texto.test.sh --fase >/dev/null 2>&1)
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

echo "── FASE (T14): onboarding em uma etapa; nenhum texto fala de fases 2-4"
SK=plugins/gabarito-mestre/skills/gabarito-instalar/SKILL.md
caso_fase fase-plantada-com-caixa-falha 1 "$SK" "Fases 2–4 rodam depois."
caso_fase fase-plantada-minuscula-falha 1 "$SK" "faça a fase 3 agora"
caso_fase fase-entre-parenteses-falha 1 plugins/gabarito-mestre/commands/gabarito-doctor.md "revalidar (fase 4)"
caso_fase quatro-fases-falha 1 README.md "tem quatro fases"
caso_fase 4-fases-falha 1 plugins/gabarito-mestre/reference/adocao.md "o onboarding em 4 fases"
caso_fase fase-no-script-do-gate-falha 1 plugins/gabarito-mestre/gates/scripts/x.mjs "// fase 2 do onboarding"
caso_fase fase-entre-parenteses-sem-numero-falha 1 "$SK" "o onboarding (fase única)"
caso_fase fase-1-passa 0 "$SK" "fase 1 não é do onboarding"
caso_fase marcador-tim1-passa 0 plugins/gabarito-mestre/skills/gabarito-instalar/trocar.md "# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:"
caso_fase marcador-tim1-com-outra-fase-na-linha-falha 1 plugins/gabarito-mestre/skills/gabarito-instalar/trocar.md "# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 3). Uma linha por área:"
caso_fase fase-2-do-fluxo-gabarito-passa 0 plugins/gabarito-mestre/reference/fluxo.md "a fase 2 do Fluxo Gabarito mede lead time"
caso_fase ruling-passa 0 plugins/gabarito-mestre/gates/scripts/x.mjs "// RULING: fase 2 do onboarding"
caso_fase readme-medicao-historica-passa 0 README.md "| M14 | **Onboarding** só a fase 3 rodou |"
caso_fase readme-fora-da-tabela-falha 1 README.md "M14: só a fase 3 rodou"
caso_fase fora-do-escopo-passa 0 docs/x.md "fases 2–4"

echo "── $falhas falha(s)"
[ "$falhas" -eq 0 ]

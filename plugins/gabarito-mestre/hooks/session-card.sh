#!/usr/bin/env bash
# gabarito-mestre · session-card.sh — implementa a ORQ-3 (cartão de sessão em duas vias, GM-9 T7).
# SessionStart (startup|resume|clear|compact). Roda `gates/scripts/cartao-sessao.mjs --hook` do plugin com a raiz
# do repo (git toplevel → cwd) e REPASSA o stdin (session_id, source) ao node. O node lê o diário, grava
# `sessao.inicio` + `guarda.heartbeat {fonte}` e devolve o JSON final: `additionalContext` (≤ 4.329 caracteres,
# para o modelo) e `systemMessage` (≤ 3 linhas, para o humano). Este hook só resolve raiz e plugin-root e
# repassa; não reescreve o conteúdo. Nunca bloqueia: qualquer falha é FAIL-OPEN DECLARADO (stderr, exit 0).
set -u
. "$(dirname "$0")/_common.sh"
ENTRADA=$(cat 2>/dev/null || true)   # stdin de SessionStart: vai inteiro para o node

ROOT=$(gabarito_repo_root)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPT="$PLUGIN_ROOT/gates/scripts/cartao-sessao.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "gabarito-mestre: node ausente — cartão de sessão não gerado (fail-open declarado, G9)" >&2
  exit 0
fi
if [ ! -f "$SCRIPT" ]; then
  echo "gabarito-mestre: $SCRIPT ausente — cartão de sessão não gerado (fail-open declarado, G9)" >&2
  exit 0
fi

# RULING F3-R1 (emenda fase 2 → fase 3, 2026-09-24): dentro do node deste hook, process.ppid seria o bash
# do próprio hook, não o Claude Code — exporta o PID raiz real ($PPID = pai deste bash) para que
# cartao-sessao.mjs (via capacidade.mjs) meça a árvore de processos certa.
export GABARITO_PID_RAIZ=$PPID

SAIDA=$(printf '%s' "$ENTRADA" | node "$SCRIPT" --hook --root "$ROOT" --plugin-root "$PLUGIN_ROOT")
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "gabarito-mestre: cartao-sessao.mjs saiu com $STATUS — cartão não injetado (fail-open declarado, G9)" >&2
  exit 0
fi
case "$SAIDA" in
  '{'*'}') printf '%s\n' "$SAIDA" ;;
  '') ;;
  *) echo "gabarito-mestre: cartao-sessao.mjs devolveu saída que não é JSON — cartão não injetado (fail-open declarado, G9)" >&2 ;;
esac
exit 0

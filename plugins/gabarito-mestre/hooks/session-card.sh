#!/usr/bin/env bash
# gabarito-mestre · session-card.sh — implementa a ORQ-3 (cartão de sessão, ≤ 40 linhas).
# SessionStart (startup|resume|clear|compact). Não lê tool_input: o payload de SessionStart não tem comando.
# Roda `gates/scripts/cartao-sessao.mjs` do plugin com a raiz do repo (git toplevel → cwd) e injeta o texto em
# `hookSpecificOutput.additionalContext`. Nunca bloqueia: qualquer falha é FAIL-OPEN DECLARADO (stderr, exit 0).
# Quem decide o conteúdo (onboarding ausente → uma linha; PBI/Epic; slots; doctor…) é o script Node (T9);
# este hook só resolve raiz e plugin-root, delimita 40 linhas e embala o JSON.
set -u
. "$(dirname "$0")/_common.sh"
cat >/dev/null 2>&1 || true   # drena o stdin (JSON de SessionStart) sem depender dele

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

CARTAO=$(node "$SCRIPT" --root "$ROOT" --plugin-root "$PLUGIN_ROOT")
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "gabarito-mestre: cartao-sessao.mjs saiu com $STATUS — cartão não injetado (fail-open declarado, G9)" >&2
  exit 0
fi
CARTAO=$(printf '%s\n' "$CARTAO" | head -n 40)
[ -z "${CARTAO//[[:space:]]/}" ] && exit 0

ESC=$(gabarito_json_escape "$CARTAO")
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESC"
exit 0

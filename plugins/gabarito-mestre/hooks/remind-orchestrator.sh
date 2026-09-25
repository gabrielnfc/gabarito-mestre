#!/usr/bin/env bash
# gabarito-mestre · remind-orchestrator.sh — implementa a ORQ-4 (lembrete R21 por prompt).
# UserPromptSubmit, timeout 5. Só age quando `orquestracao.lembretePorPrompt: true` em <raiz>/harness.config.json
# (default desligado). Injeta UMA linha em additionalContext: "R21: despache, não implemente · slots: <n>".
# <n> vem de `gates/scripts/capacidade.mjs --json` (campo `slots`); se o script falhar ou faltar, usa
# `orquestracao.paralelismo.simultaneos` do config marcado "(config)". NUNCA sai com 2: este hook não bloqueia prompt.
set -u
. "$(dirname "$0")/_common.sh"
cat >/dev/null 2>&1 || true   # drena o stdin (JSON de UserPromptSubmit); o prompt não é lido

ROOT=$(gabarito_repo_root)
if [ ! -f "$ROOT/harness.config.json" ]; then
  exit 0   # repo sem harness: silêncio — ORQ-4 é opt-in, não há o que declarar a cada prompt (decisão 4)
fi
LEMBRETE=$(gabarito_config_get orquestracao.lembretePorPrompt "$ROOT")
if [ -z "$LEMBRETE" ]; then
  echo "gabarito-mestre: harness.config.json sem orquestracao.lembretePorPrompt — lembrete R21 desligado (fail-open declarado, G9)" >&2
  exit 0
fi
[ "$LEMBRETE" = "true" ] || exit 0

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CAP="$PLUGIN_ROOT/gates/scripts/capacidade.mjs"
SLOTS=""; FONTE=""
if command -v node >/dev/null 2>&1 && [ -f "$CAP" ]; then
  # RULING F3-R2 (emenda fase 2 → fase 3, vence o brief desta task): dentro do node de capacidade.mjs,
  # process.ppid seria o bash deste hook, não o Claude Code — exporta o PID raiz real ($PPID = pai deste
  # bash) para que a medição de processos pesados exclua a árvore certa (mesmo raciocínio de F3-R1).
  export GABARITO_PID_RAIZ=$PPID
  SAIDA=$(node "$CAP" --root "$ROOT" --json 2>/dev/null) || SAIDA=""
  if [ -n "$SAIDA" ]; then
    SLOTS=$(printf '%s' "$SAIDA" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const s=j&&j.slots;process.stdout.write(Number.isInteger(s)?String(s):"")}catch(e){process.stdout.write("")}})' 2>/dev/null)
  fi
fi
if [ -z "$SLOTS" ]; then
  SLOTS=$(gabarito_config_get orquestracao.paralelismo.simultaneos "$ROOT")
  [ -z "$SLOTS" ] && SLOTS=2
  FONTE=" (config)"
fi

LINHA="R21: despache, não implemente · slots: ${SLOTS}${FONTE}"
ESC=$(gabarito_json_escape "$LINHA")
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$ESC"
exit 0

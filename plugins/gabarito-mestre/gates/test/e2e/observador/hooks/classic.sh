#!/bin/bash
# Observador de teste (GM-10 T13): uma linha JSON por evento classico em $OBS_DIR/classic.jsonl. Só chaves e contagens,
# nunca o conteúdo de prompt, de mensagem ou de ferramenta. `t` = segundos desde a época (jq `now`).
[ -n "${OBS_DIR:-}" ] || exit 0
jq -c --arg pd "${CLAUDE_PROJECT_DIR:-}" '{
  t: now, ev: .hook_event_name, sid: .session_id, agent: .agent_id, agent_type: .agent_type,
  cwd: .cwd, project_dir: $pd, tool: .tool_name, source: .source, stop_active: .stop_hook_active,
  bg: ((.background_tasks // []) | map(select(.type == "subagent")) | length),
  subagent_type: (.tool_input.subagent_type // null), transcript: .agent_transcript_path
}' >> "$OBS_DIR/classic.jsonl" 2>/dev/null
exit 0

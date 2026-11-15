#!/bin/bash
# uso: rodar-p.sh <nome> <max-turns> "<prompt>" [segundos-para-trocar-versao-do-disco]
# Sessao real -p, config da conta, haiku, cwd isolado dentro da worktree T0b. Copia a sonda para r2/<nome>/plug.
set -u
WT=/Users/gabs-dev/projetos_pessoais/gabarito-mestre/.harness/worktrees/T0b
export TMPDIR=/private/var/folders/6d/fxf284xn73q8c8hk32n_0_lh0000gp/T/gabarito-76a6d5f31db07928
N=$1; MT=$2; P=$3; TROCA=${4:-}
R=$WT/.claude-tmp/gm15-t0b/r2/$N; rm -rf "$R"; mkdir -p "$R/out/mod" "$R/cwd"
cp -R $WT/.superpowers/sdd/2026-11-15-2-1-1/t0b-spike-r2/plug "$R/plug"
( if [ -n "$TROCA" ]; then sleep "$TROCA"; echo '{ "name": "gm15t0b", "version": "0.2.9", "description": "Sonda r2" }' > "$R/plug/.claude-plugin/plugin.json"; echo "troca-disco $(date +%s)" >> "$R/out/driver.log"; fi ) &
cd "$R/cwd" && echo "cmd: claude -p --model claude-haiku-5-5 --setting-sources project --strict-mcp-config --max-turns $MT --plugin-dir $R/plug <prompt>" > "$R/out/driver.log"
claude -p --model claude-haiku-5-5 --setting-sources project --strict-mcp-config --max-turns "$MT" --plugin-dir "$R/plug" "$P" > "$R/out/stdout.txt" 2> "$R/out/stderr.txt"; echo "exit=$?" >> "$R/out/driver.log"
wait

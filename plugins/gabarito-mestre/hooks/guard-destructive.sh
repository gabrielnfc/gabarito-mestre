#!/usr/bin/env bash
# gabarito-mestre · guard-destructive.sh — implementa a R2 (nenhum delete sem permissão explícita).
# PreToolUse/Bash. Lê JSON no stdin; bloqueia com JSON + exit 2; permite com exit 0 sem saída.
#
# Famílias barradas (inspeção por grep, não parser — I9):
#   1 rm recursivo            rm -rf · rm -r · rm --recursive (em posição de comando)
#   2 git clean forçado       git clean -f / -fdx / --force
#   3 docker                  docker volume rm|prune · docker system prune · docker compose down -v
#   4 reset de migrations     prisma migrate reset · typeorm schema:drop · sequelize db:drop ·
#                             knex migrate:rollback --all · drizzle-kit drop · supabase db reset ·
#                             rails db:drop|reset · artisan migrate:fresh|reset · manage.py flush ·
#                             mix ecto.drop|reset · dotnet ef database drop · flyway clean · liquibase drop-all
#   5 SQL/ORM em one-liner    DROP TABLE|DATABASE|SCHEMA · TRUNCATE · DELETE FROM · .deleteMany( · .updateMany(
#                             SÓ quando o comando também invoca um executor (psql, mysql, node -e, prisma db execute…).
#                             Sem executor, `grep "DROP TABLE"` é leitura e passa.
#   6 escrita crua em disco   dd of=/dev/… · > /dev/sd… · mkfs · diskutil erase · shred · wipefs
#
# Escape hatch: GABARITO_ALLOW_DESTRUCTIVE="motivo" (env ou prefixo inline). Motivo vazio NÃO libera.
set -u
. "$(dirname "$0")/_common.sh"
gabarito_read_command
[ -z "${GABARITO_CMD}" ] && exit 0

# Posição de comando: início de linha, ou após ; & | ( ` $( — com wrappers comuns opcionais.
POS='(^|[;&|(`]|\$\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]*)[[:space:]]+)*((sudo|exec|time|nice|command|env|xargs)([[:space:]]+-[A-Za-z0-9]+)*[[:space:]]+)?(/[A-Za-z0-9_./-]*/)?'

RM="${POS}rm[[:space:]]+(--?[A-Za-z-]+[[:space:]]+)*(-[A-Za-z]*[rR][A-Za-z]*|--recursive)([[:space:]]|$)"
GITCLEAN="${POS}git[[:space:]]+(-[A-Za-z-]+[[:space:]]+|-C[[:space:]]+[^[:space:]]+[[:space:]]+)*clean([[:space:]]+[^[:space:]]+)*[[:space:]]+(-[A-Za-z]*f[A-Za-z]*|--force)([[:space:]]|$)"
DOCKER="${POS}(docker|podman|nerdctl)([[:space:]]+-[A-Za-z-]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*[[:space:]]+(volume[[:space:]]+(rm|remove|prune)|system[[:space:]]+prune|(container|image|network|builder|buildx)[[:space:]]+prune|(compose|stack)[[:space:]]+.*down.*(-v|--volumes)|rm[[:space:]]+.*(-v|--volumes))"
DOCKERCOMPOSE="${POS}docker-compose([[:space:]]+[^[:space:]]+)*[[:space:]]+down([[:space:]]+[^[:space:]]+)*[[:space:]]+(-v|--volumes)"
RUNNER='((npx|pnpm|yarn|bunx|bun|deno)[[:space:]]+(dlx[[:space:]]+|run[[:space:]]+|x[[:space:]]+)?(-[A-Za-z-]+[[:space:]]+)*)?'
ORM="${POS}${RUNNER}(prisma[[:space:]]+(migrate[[:space:]]+reset|db[[:space:]]+push([[:space:]]+[^[:space:]]+)*[[:space:]]+--force-reset)|typeorm([[:space:]]+[^[:space:]]+)*[[:space:]]+schema:drop|sequelize(-cli)?[[:space:]]+db:(drop|migrate:undo:all)|knex[[:space:]]+migrate:rollback([[:space:]]+[^[:space:]]+)*[[:space:]]+--all|drizzle-kit[[:space:]]+drop|supabase[[:space:]]+db[[:space:]]+reset|(bin/|bundle[[:space:]]+exec[[:space:]]+)?rails[[:space:]]+db:(drop|reset|purge)|(bundle[[:space:]]+exec[[:space:]]+)?rake[[:space:]]+db:(drop|reset|purge)|(php[[:space:]]+)?artisan[[:space:]]+(migrate:(fresh|reset|refresh)|db:wipe)|(manage\.py|django-admin)[[:space:]]+flush|mix[[:space:]]+ecto\.(drop|reset)|dotnet[[:space:]]+ef[[:space:]]+database[[:space:]]+drop|flyway([[:space:]]+[^[:space:]]+)*[[:space:]]+clean|liquibase([[:space:]]+[^[:space:]]+)*[[:space:]]+drop-?all)"
EXECUTOR='(^|[[:space:]|;&(`])(psql|pgcli|mysql|mysqlsh|mariadb|sqlite3|mongosh|mongo|clickhouse-client|cqlsh|sqlcmd|bq[[:space:]]+query|prisma[[:space:]]+db[[:space:]]+execute|supabase[[:space:]]+db[[:space:]]+query|wrangler[[:space:]]+d1[[:space:]]+execute|node[[:space:]]+(-e|--eval|-p|--print)|tsx[[:space:]]+(-e|--eval)|ts-node[[:space:]]+(-e|--eval)|bun[[:space:]]+(-e|--eval)|deno[[:space:]]+eval|python3?[[:space:]]+-c|ruby[[:space:]]+-e|php[[:space:]]+-r|rails[[:space:]]+runner)([[:space:]]|$)|--command[= ]'
SQL='DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)|TRUNCATE([[:space:]]+TABLE)?[[:space:]]+[A-Za-z_"`]|DELETE[[:space:]]+FROM[[:space:]]|\.(deleteMany|updateMany)[[:space:]]*\('
DEVICE="(^|[[:space:]|;&(\`])dd[[:space:]]+.*of=/dev/(sd|hd|nvme|disk|mmcblk|vd|xvd|rdisk)|>[[:space:]]*/dev/(sd|hd|nvme|disk|mmcblk|vd|xvd|rdisk)|${POS}(mkfs(\.[a-z0-9]+)?[[:space:]]|diskutil[[:space:]]+(erase|reformat|zeroDisk|partitionDisk|secureErase)|shred[[:space:]]|wipefs[[:space:]])"

# Varre o comando SEM o corpo de heredocs de escrita de arquivo (ver _common.sh). Fail-closed no resto.
SCAN=$(printf '%s' "$GABARITO_CMD" | gabarito_strip_write_heredocs)
familia=""
c() { printf '%s' "$SCAN" | LC_ALL=C grep -Eq "$1"; }
ci() { printf '%s' "$SCAN" | LC_ALL=C grep -Eiq "$1"; }

if   c  "$RM";            then familia="rm recursivo"
elif c  "$GITCLEAN";      then familia="git clean forçado"
elif c  "$DOCKER" || c "$DOCKERCOMPOSE"; then familia="docker volume/prune"
elif c  "$ORM";           then familia="reset de migrations"
elif ci "$EXECUTOR" && ci "$SQL"; then familia="SQL/ORM destrutivo em one-liner"
elif c  "$DEVICE";        then familia="escrita crua em dispositivo"
fi

[ -z "$familia" ] && exit 0

if gabarito_escape_hatch "R2 · $familia"; then exit 0; fi

gabarito_deny "Comando destrutivo bloqueado pela regra R2 (padrão: $familia). Descreva o que seria apagado (alvo, filtro, contagem estimada, ambiente) e peça autorização ao usuário antes de repetir. Ver AGENTS.md §1. Autorizado? Repita com GABARITO_ALLOW_DESTRUCTIVE=\"<motivo>\" na frente do comando."

#!/usr/bin/env bash
# gabarito-mestre · guard-destructive.sh — implementa a R2 (nenhum delete sem permissão explícita).
# PreToolUse/Bash. Lê JSON no stdin; bloqueia com JSON + exit 2; permite com exit 0 sem saída.
#
# Famílias barradas (inspeção por grep, não parser — I9). "Posição de comando" = início de linha ou
# após ; & | ( ` $( { então/do/else, com wrappers opcionais (sudo, exec, xargs, nohup, timeout N, env…):
#   1 rm recursivo            rm -rf · rm -r · \rm -rf · rm --recursive · rimraf · find … -delete · find … -exec rm
#   2 git destrutivo          git clean -f · git reset --hard · git worktree remove --force · git rm -r (sem --cached)
#   3 docker                  docker volume rm|prune · docker system prune · docker rm -f|-v · docker compose down -v
#   4 reset de migrations     prisma migrate reset · typeorm schema:drop · sequelize db:drop · knex migrate:rollback --all ·
#                             drizzle-kit drop · supabase db reset · rails db:drop|reset · artisan migrate:fresh|reset ·
#                             manage.py flush · mix ecto.drop|reset · dotnet ef database drop · flyway clean · liquibase drop-all
#   5 payload destrutivo      DROP TABLE|DATABASE|SCHEMA · TRUNCATE · DELETE FROM · .deleteMany( · .updateMany( ·
#      em executor            fs.rm*(…recursive) · shutil.rmtree — SÓ quando o comando também invoca um executor
#                             (psql, mysql, node -e, python3 -c, prisma db execute, bash -c, eval, sh <<<…).
#                             Sem executor, `grep "DROP TABLE"` é leitura e passa.
#   6 sync/nuvem/disco        rsync --delete · aws s3 rm --recursive · gsutil rm -r · dd of=/dev/… · > /dev/sd… · mkfs ·
#                             diskutil erase… · shred · wipefs
#
# LIMITES DECLARADOS (não barra; ver README "Limites declarados"): kubectl delete · terraform destroy · gh repo delete ·
# git push --force · git branch -D · git checkout -- . · truncate -s0 · `: > arquivo` · script escrito e executado depois.
#
# Escape hatch: GABARITO_ALLOW_DESTRUCTIVE="motivo" (env, ou prefixo NO INÍCIO do comando). ≥8 chars e ≥2 palavras.
set -u
. "$(dirname "$0")/_common.sh"
gabarito_read_command

# Varre o comando sem corpo de heredoc-de-escrita e sem segmentos de grep/sed/commit (ver _common.sh).
SCAN=$(printf '%s' "$GABARITO_CMD" | gabarito_scan_text)

# Posição de comando. Aceita atribuições de env antes (`FOO=bar cmd`), wrappers, e caminho absoluto.
ASSIGN='([A-Za-z_][A-Za-z0-9_]*=("([^"\\]|\\.)*"|'"'"'[^'"'"']*'"'"'|\$\([^)]*\)|[^[:space:]]*)[[:space:]]+)*'
WRAP='((sudo|exec|time|nice|command|env|xargs|nohup|caffeinate|timeout[[:space:]]+[0-9]+[smh]?)([[:space:]]+-[A-Za-z0-9]+)*[[:space:]]+)*'
POS="(^|[;&|({\`]|\\\$\\(|[[:space:]](then|do|else)[[:space:]])[[:space:]]*${ASSIGN}${WRAP}(/[A-Za-z0-9_./-]*/|\\\\)?"
# Executor de shell: o argumento citado é comando. Aí posição de comando também pode ser abertura de aspas.
SHELLEXEC='(^|[[:space:]|;&(`])((ba|z|da)?sh[[:space:]]+(-[A-Za-z]+[[:space:]]+)*-[A-Za-z]*c[[:space:]]|eval[[:space:]]|<<<)'
QPOS="(^|[;&|({\`\"']|\\\$\\(|[[:space:]](then|do|else)[[:space:]])[[:space:]]*${ASSIGN}${WRAP}(/[A-Za-z0-9_./-]*/|\\\\)?"
if printf '%s' "$SCAN" | LC_ALL=C grep -Eq "$SHELLEXEC"; then POS="$QPOS"; fi

RM="${POS}(rm[[:space:]]+(--?[A-Za-z-]+[[:space:]]+)*(-[A-Za-z]*[rR][A-Za-z]*|--recursive)([[:space:]]|$)|((npx|pnpm|yarn|bunx)[[:space:]]+(dlx[[:space:]]+)?)?rimraf[[:space:]]|find[[:space:]]+.*[[:space:]](-delete([[:space:]]|$)|-exec[[:space:]]+(/[A-Za-z0-9_./-]*/)?rm[[:space:]]))"
GIT="${POS}git[[:space:]]+(-[A-Za-z-]+[[:space:]]+|-C[[:space:]]+[^[:space:]]+[[:space:]]+)*(clean([[:space:]]+[^[:space:]]+)*[[:space:]]+(-[A-Za-z]*f[A-Za-z]*|--force)([[:space:]]|$)|reset([[:space:]]+[^[:space:]]+)*[[:space:]]+--hard([[:space:]]|$)|worktree[[:space:]]+remove([[:space:]]+[^[:space:]]+)*[[:space:]]+(-f|--force)([[:space:]]|$)|rm[[:space:]]+(-[A-Za-z]*[rR][A-Za-z]*|--recursive)([[:space:]]|$))"
GITRMCACHED='git[[:space:]]+.*rm[[:space:]]+.*--cached'
DOCKER="${POS}(docker|podman|nerdctl)([[:space:]]+-[A-Za-z-]+([[:space:]]+[^[:space:]-][^[:space:]]*)?)*[[:space:]]+(volume[[:space:]]+(rm|remove|prune)|system[[:space:]]+prune|(container|image|network|builder|buildx)[[:space:]]+prune|(compose|stack)[[:space:]]+.*down.*(-v|--volumes)|(container[[:space:]]+)?rm[[:space:]]+(-[A-Za-z]*[fv][A-Za-z]*|--force|--volumes)([[:space:]]|$))"
DOCKERCOMPOSE="${POS}docker-compose([[:space:]]+[^[:space:]]+)*[[:space:]]+down([[:space:]]+[^[:space:]]+)*[[:space:]]+(-v|--volumes)"
RUNNER='((npx|pnpm|yarn|bunx|bun|deno)[[:space:]]+(dlx[[:space:]]+|run[[:space:]]+|x[[:space:]]+)?(-[A-Za-z-]+[[:space:]]+)*)?'
ORM="${POS}${RUNNER}(prisma[[:space:]]+(migrate[[:space:]]+reset|db[[:space:]]+push([[:space:]]+[^[:space:]]+)*[[:space:]]+--force-reset)|typeorm([[:space:]]+[^[:space:]]+)*[[:space:]]+schema:drop|sequelize(-cli)?[[:space:]]+db:(drop|migrate:undo:all)|knex[[:space:]]+migrate:rollback([[:space:]]+[^[:space:]]+)*[[:space:]]+--all|drizzle-kit[[:space:]]+drop|supabase[[:space:]]+db[[:space:]]+reset|(bin/|bundle[[:space:]]+exec[[:space:]]+)?rails[[:space:]]+db:(drop|reset|purge)|(bundle[[:space:]]+exec[[:space:]]+)?rake[[:space:]]+db:(drop|reset|purge)|(php[[:space:]]+)?artisan[[:space:]]+(migrate:(fresh|reset|refresh)|db:wipe)|(manage\.py|django-admin)[[:space:]]+flush|mix[[:space:]]+ecto\.(drop|reset)|dotnet[[:space:]]+ef[[:space:]]+database[[:space:]]+drop|flyway([[:space:]]+[^[:space:]]+)*[[:space:]]+clean|liquibase([[:space:]]+[^[:space:]]+)*[[:space:]]+drop-?all)"
EXECUTOR='(^|[[:space:]|;&(`])(psql|pgcli|mysql|mysqlsh|mariadb|sqlite3|mongosh|mongo|clickhouse-client|cqlsh|sqlcmd|bq[[:space:]]+query|prisma[[:space:]]+db[[:space:]]+execute|supabase[[:space:]]+db[[:space:]]+query|wrangler[[:space:]]+d1[[:space:]]+execute|node[[:space:]]+(-e|--eval|-p|--print)|tsx[[:space:]]+(-e|--eval)|ts-node[[:space:]]+(-e|--eval)|bun[[:space:]]+(-e|--eval)|deno[[:space:]]+eval|python3?[[:space:]]+-c|ruby[[:space:]]+-e|php[[:space:]]+-r|rails[[:space:]]+runner)([[:space:]]|$)|--command[= ]'
PAYLOAD='DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)|TRUNCATE([[:space:]]+TABLE)?[[:space:]]+[A-Za-z_"`]|DELETE[[:space:]]+FROM[[:space:]]|\.(deleteMany|updateMany)[[:space:]]*\(|fs\.(rm|rmdir|rmdirSync|rmSync)\([^)]*recursive|(shutil\.)?rmtree\('
CLOUD="${POS}(rsync([[:space:]]+[^[:space:]]+)*[[:space:]]+--delete|aws[[:space:]]+s3[[:space:]]+(rm|rb)([[:space:]]+[^[:space:]]+)*[[:space:]]+(--recursive|--force)|gsutil([[:space:]]+-[A-Za-z]+)*[[:space:]]+rm[[:space:]]+(-[A-Za-z]*r|-[A-Za-z]*R))"
DEVICE="(^|[[:space:]|;&(\`])dd[[:space:]]+.*of=/dev/(sd|hd|nvme|disk|mmcblk|vd|xvd|rdisk)|>[[:space:]]*/dev/(sd|hd|nvme|disk|mmcblk|vd|xvd|rdisk)|${POS}(mkfs(\.[a-z0-9]+)?[[:space:]]|diskutil[[:space:]]+(erase|reformat|zeroDisk|partitionDisk|secureErase)|shred[[:space:]]|wipefs[[:space:]])"

familia=""
c()  { printf '%s' "$SCAN" | LC_ALL=C grep -Eq "$1"; }
ci() { printf '%s' "$SCAN" | LC_ALL=C grep -Eiq "$1"; }

if   c "$RM";                                    then familia="rm recursivo"
elif c "$GIT" && ! c "$GITRMCACHED";             then familia="git destrutivo (clean -f / reset --hard / worktree remove -f / rm -r)"
elif c "$DOCKER" || c "$DOCKERCOMPOSE";          then familia="docker rm -f / volume / prune"
elif c "$ORM";                                   then familia="reset de migrations"
elif (ci "$EXECUTOR" || c "$SHELLEXEC") && ci "$PAYLOAD"; then familia="payload destrutivo em executor (SQL/ORM/fs)"
elif c "$CLOUD";                                 then familia="rsync --delete / s3 rm --recursive / gsutil rm -r"
elif c "$DEVICE";                                then familia="escrita crua em dispositivo"
fi

[ -z "$familia" ] && exit 0

if gabarito_escape_hatch "R2 · $familia" GABARITO_ALLOW_DESTRUCTIVE; then exit 0; fi

gabarito_deny "Comando destrutivo bloqueado pela regra R2 (padrão: $familia). Descreva o que seria apagado (alvo, filtro, contagem estimada, ambiente) e peça autorização ao usuário antes de repetir. Ver AGENTS.md §1. Só com autorização do usuário: repita com GABARITO_ALLOW_DESTRUCTIVE=\"autorizado por <quem> em <data> — <o quê>\" no início do comando."

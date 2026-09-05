#!/usr/bin/env bash
# gabarito-mestre · guard-production.sh — implementa a R3 (nenhum acesso a produção de terceiro sem permissão nominal).
# PreToolUse/Bash. Lê JSON no stdin; bloqueia com JSON + exit 2; permite com exit 0 sem saída.
#
# O que barra (default, configurável por env):
#   1 USO de variável de credencial/host de produção:  $X_PROD_URL · ${PROD_TOKEN} · process.env.API_PROD_KEY ·
#     os.environ["DB_URL_PROD"] · e atribuição com valor NÃO-VAZIO (API_PROD_TOKEN=abc …).
#     Nome = contém PROD_/PRODUCTION_ ou termina em _PROD/_PRODUCTION, junto com URL|HOST|DB|DATABASE|TOKEN|KEY|
#     SECRET|PASS|PASSWORD|API|BASE|DSN|CONN|URI. `API_PROD_TOKEN=` (vazio, ex.: .env.example) NÃO barra.
#   2 HOST de produção: prod.exemplo.com · api.production.exemplo.com · prd-eu.exemplo.com.br
#     (nome de arquivo tipo deploy-production.yml NÃO barra — não é host).
#   3 URL com segmento prod: postgres://…@db-prod.host/… · https://…/prod/…  (`/products` NÃO barra).
#
# Configuração:
#   GABARITO_PROD_PATTERNS        ERE (case-insensitive) que SUBSTITUI o default inteiro.
#   GABARITO_PROD_PATTERNS_EXTRA  ERE (case-insensitive) somado ao default. Ex.: 'sankhyacloud\.com\.br|erp-vivo'
# Escape hatch: GABARITO_ALLOW_DESTRUCTIVE="motivo" (env ou prefixo inline). Motivo vazio NÃO libera.
set -u
. "$(dirname "$0")/_common.sh"
gabarito_read_command
[ -z "${GABARITO_CMD}" ] && exit 0

KIND='(URL|HOST|DB|DATABASE|TOKEN|KEY|SECRET|PASS|PASSWORD|API|BASE|DSN|CONN|URI)'
NAME="([A-Z0-9_]*PROD(UCTION)?_[A-Z0-9_]*${KIND}[A-Z0-9_]*|[A-Z0-9_]*${KIND}[A-Z0-9_]*_PROD(UCTION)?)"
USE="(\\\$\\{?|process\\.env\\.|process\\.env\\[['\"]|os\\.environ(\\.get)?\\(?\\[?['\"]|ENV\\[['\"]|getenv\\(['\"]|Deno\\.env\\.get\\(['\"])${NAME}([^A-Z0-9_]|$)"
ASSIGN="(^|[[:space:]]|export[[:space:]]+|-e[[:space:]]+|--env[[:space:]=])${NAME}=([^[:space:]'\"]|'[^']|\"[^\"])"
HOST='(^|[^A-Za-z0-9.-])([a-z0-9-]+\.)*(prod|production|prd)(-[a-z0-9]+)?\.([a-z0-9-]+\.)+[a-z]{2,}'
URLSEG="[a-z]+(\\+srv)?://[^[:space:]'\"]*[^a-z](prod|production|prd)([^a-z]|$)"

hit=""
c()  { printf '%s' "$GABARITO_CMD" | LC_ALL=C grep -Eq "$1"; }
ci() { printf '%s' "$GABARITO_CMD" | LC_ALL=C grep -Eiq "$1"; }

if [ -n "${GABARITO_PROD_PATTERNS-}" ]; then
  ci "$GABARITO_PROD_PATTERNS" && hit="padrão configurado em GABARITO_PROD_PATTERNS"
else
  if c "$USE" || c "$ASSIGN"; then hit="uso de credencial/host de produção por variável"
  elif ci "$HOST"; then
    # descarta falso host que é só nome de arquivo (…production.example.yml)
    m=$(printf '%s' "$GABARITO_CMD" | LC_ALL=C grep -Eio "$HOST" | sed -E 's/.*\.//' | tr 'A-Z' 'a-z' | grep -Evx 'yml|yaml|json|js|ts|mjs|cjs|tsx|jsx|md|txt|env|sh|py|rb|toml|ini|cfg|xml|html|css|lock' | head -n1)
    [ -n "$m" ] && hit="host de produção no comando"
  elif ci "$URLSEG"; then hit="URL com segmento de produção"
  fi
fi
if [ -z "$hit" ] && [ -n "${GABARITO_PROD_PATTERNS_EXTRA-}" ]; then
  ci "$GABARITO_PROD_PATTERNS_EXTRA" && hit="padrão configurado em GABARITO_PROD_PATTERNS_EXTRA"
fi

[ -z "$hit" ] && exit 0

if gabarito_escape_hatch "R3 · $hit"; then exit 0; fi

gabarito_deny "Acesso a produção de terceiro bloqueado pela regra R3 ($hit). Formule a pergunta, estime o custo (chamadas, páginas, entidades) e peça ao usuário autorização NOMINAL para esta consulta antes de repetir — leitura inclusive; escrita é proibida em absoluto. Ver AGENTS.md §1. Autorizado? Repita com GABARITO_ALLOW_DESTRUCTIVE=\"<motivo>\" na frente do comando."

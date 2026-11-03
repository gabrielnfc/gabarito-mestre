#!/bin/bash
# montar-repo.sh <destino> <plano.json>   (GM-10 T13)
# Cria o repositório descartável de aceite: branch enabler/GM-99-aceite, sem remoto, .harness/ ignorado, plano da entrega e
# capacidade.json DECLARADA COMO FIXTURE (slots_max 2 e load_medido alto: não é calibração da máquina, é para as "2 paralelas"
# poderem ser 2). Recusa destino existente (nunca apaga nada).
set -euo pipefail
dest="${1:?destino}"; plano="${2:?plano.json}"
aqui="$(cd "$(dirname "$0")" && pwd)"
[ ! -e "$dest" ] || { echo "destino já existe: $dest" >&2; exit 2; }
mkdir -p "$dest"
cp -R "$aqui/repo-exemplo/." "$dest/"
cd "$dest"
git init -q -b enabler/GM-99-aceite
git config user.email aceite@example.invalid
git config user.name "Aceite GM-99"
git add -A
git commit -q -m "chore(GM-99): repositorio descartavel de aceite"
mkdir -p .harness/entregas/GM-99
cp "$plano" .harness/entregas/GM-99/plano.json
node --input-type=module -e '
import { hostname } from "node:os"; import { writeFileSync } from "node:fs";
writeFileSync(".harness/capacidade.json", JSON.stringify({ hostname: hostname(), slots_max: 2, rss_pico_mb: 100, tmpdir_mb: 10, cpu_total: 1, load_medido: 200, fixture: true }) + "\n");'
echo "repo pronto: $dest"

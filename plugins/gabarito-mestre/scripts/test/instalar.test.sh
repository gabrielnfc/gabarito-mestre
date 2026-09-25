#!/usr/bin/env bash
# Testes do instalar.sh — bash puro (3.2+), repo fixture em mktemp -d, sem git no fixture.
# Roda: bash plugins/gabarito-mestre/scripts/test/instalar.test.sh   (exit 0 = tudo verde)
#
# O que está em jogo é R2 sobre o repo do usuário: --atualizar NUNCA sobrescreve AGENTS.md/docs/harness;
# --gates-substituir só toca tools/gabarito-gates/ e recusa o que foi editado localmente (ADR-TIM-1).
#
# MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
#  M1  sobrescrever AGENTS.md em --atualizar (em vez de .novo)
#  M2  ignorar o hash do .instalado.json em --gates-substituir (substituir o editado)
#  M3  duplicar linha no .gitignore na segunda execução
#  M4  rodar o doctor em --atualizar
#  M5  aceitar --gates-substituir sem --atualizar
#  M6  gravar no manifesto o hash de arquivo "mantido" que o instalador não escreveu
#  M7  cenário 8/8b: remover o fallback de gates/.hashes-anteriores (hash_anterior sempre vazio)
#  M8  cenário 8/8b: MISTO nunca fica 1 (novos de test/ sempre instalados direto)
set -eu
AQUI="$(cd "$(dirname "$0")" && pwd)"
INSTALAR="$AQUI/../instalar.sh"
PLUGIN="$(cd "$AQUI/../.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN/../.." && pwd)"
passou=0; falhou=0
ok()    { passou=$((passou+1)); echo "  ok    $1"; }
falha() { falhou=$((falhou+1)); echo "  FALHA $1" >&2; }
check() { if eval "$2"; then ok "$1"; else falha "$1"; fi; }   # check "<nome>" '<expressão bash>'
sha()   { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
novo_repo() { mktemp -d "${TMPDIR:-/tmp}/instalar-XXXXXX"; }
GATES="tools/gabarito-gates"
MANIF="$GATES/.instalado.json"
hash_no_manifesto() { sed -nE "s|^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"([0-9a-f]{64})\".*|\1|p" "$1/$MANIF" | head -n1; }
# Fixture 1.0.1 REAL de gates/ (commit 1c85330), sem .instalado.json — imprime o caminho do dir extraído.
fixture_101_gates() {
  local out; out="$(mktemp -d "${TMPDIR:-/tmp}/gm-101-XXXXXX")"
  (cd "$REPO_ROOT" && git archive 1c85330 plugins/gabarito-mestre/gates) | (cd "$out" && tar -x)
  printf '%s' "$out/plugins/gabarito-mestre/gates"
}

echo "── cenário 1: instalação limpa"
R="$(novo_repo)"
if SAIDA="$(bash "$INSTALAR" "$R" 2>&1)"; then RC1=0; else RC1=$?; fi
check "instalação sai 0"                          '[ "$RC1" -eq 0 ]'
check "AGENTS.md criado"                          '[ -f "$R/AGENTS.md" ]'
check "docs/harness/referencia.md criado"         '[ -f "$R/docs/harness/referencia.md" ]'
check "gates copiados"                            '[ -f "$R/$GATES/scripts/harness-doctor.mjs" ]'
check ".instalado.json existe"                    '[ -f "$R/$MANIF" ]'
check ".instalado.json tem versao e em"           'grep -q "\"versao\": \"" "$R/$MANIF" && grep -q "\"em\": \"" "$R/$MANIF"'
H="$(sha "$R/$GATES/scripts/harness-doctor.mjs")"
check "hash do doctor no manifesto = hash do disco" '[ "$(hash_no_manifesto "$R" scripts/harness-doctor.mjs)" = "$H" ]'
check "manifesto não lista a si mesmo"            '! grep -q "instalado.json" "$R/$MANIF"'
check ".gitignore com as 4 linhas"                '[ "$(grep -cxF -e ".harness/doctor-cache.json" -e ".harness/fluxo-cache.json" -e "*.novo" -e "*.bak" "$R/.gitignore")" -eq 4 ]'
check "doctor rodou ao fim"                       'printf "%s" "$SAIDA" | grep -q "harness-doctor — evidência"'
check "resumo sem sobrescrita"                    'printf "%s" "$SAIDA" | grep -q "Nenhum arquivo apagado ou sobrescrito"'

echo "── cenário 2: segunda execução sem flag é idempotente"
SAIDA2="$(bash "$INSTALAR" "$R" 2>&1)"
check ".gitignore não duplica"                    '[ "$(grep -cxF -e "*.novo" "$R/.gitignore")" -eq 1 ]'
check "AGENTS.md mantido"                         'printf "%s" "$SAIDA2" | grep -q "mantido  AGENTS.md"'
check "manifesto preserva o hash"                 '[ "$(hash_no_manifesto "$R" scripts/harness-doctor.mjs)" = "$H" ]'

echo "── cenário 3: repo com .gitignore sem newline final e CLAUDE.md próprio"
R3="$(novo_repo)"; printf 'node_modules/' > "$R3/.gitignore"; printf '# meu\n' > "$R3/CLAUDE.md"
bash "$INSTALAR" "$R3" >/dev/null 2>&1
check "linha antiga preservada e as novas em linhas próprias" '[ "$(grep -cxF -e "node_modules/" -e "*.bak" "$R3/.gitignore")" -eq 2 ]'
check "CLAUDE.md emendado com @AGENTS.md sem perder o conteúdo" 'grep -qxF "# meu" "$R3/CLAUDE.md" && grep -qxF "@AGENTS.md" "$R3/CLAUDE.md"'

echo "── cenário 4: --atualizar sobre um repo 1.0.1 com AGENTS.md editado"
R4="$(novo_repo)"
bash "$INSTALAR" "$R4" >/dev/null 2>&1
printf '\nR19 — minha regra de projeto\n' >> "$R4/AGENTS.md"
cp "$R4/AGENTS.md" "$R4/AGENTS.md.antes"
if SAIDA4="$(bash "$INSTALAR" "$R4" --atualizar 2>&1)"; then RC4=0; else RC4=$?; fi
check "--atualizar sai 0"                         '[ "$RC4" -eq 0 ]'
check "AGENTS.md intocado"                        'cmp -s "$R4/AGENTS.md" "$R4/AGENTS.md.antes"'
check "AGENTS.md.novo = referência do plugin"     'cmp -s "$R4/AGENTS.md.novo" "$PLUGIN/reference/AGENTS.md"'
check "diff --stat impresso"                      'printf "%s" "$SAIDA4" | grep -q "novo     AGENTS.md.novo"'
check "referencia.md idêntica → igual, sem .novo" 'printf "%s" "$SAIDA4" | grep -q "igual    docs/harness/referencia.md" && [ ! -e "$R4/docs/harness/referencia.md.novo" ]'
check "aviso R30+"                                'printf "%s" "$SAIDA4" | grep -q "R30+"'
check "doctor NÃO roda em --atualizar"            '! printf "%s" "$SAIDA4" | grep -q "harness-doctor — evidência"'
check "gates diferentes só avisam sem --gates-substituir" '! printf "%s" "$SAIDA4" | grep -q "^  substituído"'

echo "── cenário 5: --gates-substituir com hash conferido"
R5="$(novo_repo)"
bash "$INSTALAR" "$R5" >/dev/null 2>&1
# (a) quality-ratchet.mjs: simula versão instalada anterior — disco ≠ plugin, mas manifesto == disco → substitui
printf '\n// versao antiga instalada pelo instalador\n' >> "$R5/$GATES/scripts/quality-ratchet.mjs"
NH="$(sha "$R5/$GATES/scripts/quality-ratchet.mjs")"
sed "s|\"scripts/quality-ratchet.mjs\": \"[0-9a-f]*\"|\"scripts/quality-ratchet.mjs\": \"$NH\"|" "$R5/$MANIF" > "$R5/$MANIF.tmp" && mv "$R5/$MANIF.tmp" "$R5/$MANIF"
# (b) harness-doctor.mjs: editado localmente — manifesto ≠ disco → recusa
printf '\n// minha edicao local\n' >> "$R5/$GATES/scripts/harness-doctor.mjs"
# (c) README.md dos gates: apagado do manifesto — "ausente do .instalado.json → editado" → recusa
printf '\nnota local\n' >> "$R5/$GATES/README.md"
grep -v '"README.md"' "$R5/$MANIF" > "$R5/$MANIF.tmp" && mv "$R5/$MANIF.tmp" "$R5/$MANIF"
if SAIDA5="$(bash "$INSTALAR" "$R5" --atualizar --gates-substituir 2>&1)"; then RC5=0; else RC5=$?; fi
check "--gates-substituir sai 0"                  '[ "$RC5" -eq 0 ]'
check "quality-ratchet substituído = plugin"      'cmp -s "$R5/$GATES/scripts/quality-ratchet.mjs" "$PLUGIN/gates/scripts/quality-ratchet.mjs"'
check ".bak guarda a versão antiga"               'grep -q "versao antiga instalada" "$R5/$GATES/scripts/quality-ratchet.mjs.bak"'
check "manifesto atualizado para o hash novo"     '[ "$(hash_no_manifesto "$R5" scripts/quality-ratchet.mjs)" = "$(sha "$PLUGIN/gates/scripts/quality-ratchet.mjs")" ]'
check "doctor editado localmente NÃO foi tocado"  'grep -q "minha edicao local" "$R5/$GATES/scripts/harness-doctor.mjs"'
check "doctor recusado gera .novo = plugin"       'cmp -s "$R5/$GATES/scripts/harness-doctor.mjs.novo" "$PLUGIN/gates/scripts/harness-doctor.mjs"'
check "saída cita recusado e substituído"         'printf "%s" "$SAIDA5" | grep -q "^  recusado" && printf "%s" "$SAIDA5" | grep -q "^  substituído"'
check "ausente do manifesto = editado → recusa"   'grep -q "nota local" "$R5/$GATES/README.md" && [ -f "$R5/$GATES/README.md.novo" ]'
check "arquivo recusado não entra no manifesto"   '[ -z "$(hash_no_manifesto "$R5" README.md)" ]'

echo "── cenário 6: flags inválidas"
R6="$(novo_repo)"
if bash "$INSTALAR" "$R6" --gates-substituir >/dev/null 2>&1; then falha "--gates-substituir sem --atualizar deveria falhar"; else ok "--gates-substituir sem --atualizar sai != 0"; fi
check "nada instalado quando a flag é inválida"   '[ ! -e "$R6/AGENTS.md" ]'
if bash "$INSTALAR" "$R6" --xyz >/dev/null 2>&1; then falha "flag desconhecida deveria falhar"; else ok "flag desconhecida sai != 0"; fi

echo "── cenário 7: --codeowners"
R7="$(novo_repo)"
bash "$INSTALAR" "$R7" --codeowners >/dev/null 2>&1
check "CODEOWNERS criado com esqueleto"           'grep -q "Áreas e donos" "$R7/.github/CODEOWNERS"'
printf '* @time\n' > "$R7/.github/CODEOWNERS"
bash "$INSTALAR" "$R7" --codeowners >/dev/null 2>&1
check "CODEOWNERS existente é mantido"            '[ "$(cat "$R7/.github/CODEOWNERS")" = "* @time" ]'

echo "── cenário 8: --atualizar --gates-substituir sobre 1.0.1 REAL (fixture do commit 1c85330, sem manifesto)"
R8="$(novo_repo)"
mkdir -p "$R8/$GATES"
FX8="$(fixture_101_gates)"
cp -R "$FX8/." "$R8/$GATES/"
if SAIDA8="$(bash "$INSTALAR" "$R8" --atualizar --gates-substituir 2>&1)"; then RC8=0; else RC8=$?; fi
check "sai 0"                                        '[ "$RC8" -eq 0 ]'
check "harness-doctor.mjs (1.0.1→1.1.0) substituído" 'cmp -s "$R8/$GATES/scripts/harness-doctor.mjs" "$PLUGIN/gates/scripts/harness-doctor.mjs"'
check ".bak guarda a versão 1.0.1 do doctor"         '[ -f "$R8/$GATES/scripts/harness-doctor.mjs.bak" ]'
check "package.json (1.0.1→1.1.0) substituído"       'cmp -s "$R8/$GATES/package.json" "$PLUGIN/gates/package.json"'
check "migrations-guard.mjs (1.0.1→1.1.0) substituído" 'cmp -s "$R8/$GATES/scripts/migrations-guard.mjs" "$PLUGIN/gates/scripts/migrations-guard.mjs"'
check "README.md (idêntico nas duas versões) sem .bak" '[ ! -e "$R8/$GATES/README.md.bak" ]'
check "README.md entra no manifesto mesmo idêntico"  '[ -n "$(hash_no_manifesto "$R8" README.md)" ]'
check "script novo da 1.1.0 (capacidade.mjs) instalado" '[ -f "$R8/$GATES/scripts/capacidade.mjs" ]'
check "teste novo da 1.1.0 (capacidade.test.mjs) instalado (tudo substituído — sem estado misto)" '[ -f "$R8/$GATES/test/capacidade.test.mjs" ]'
check "nenhum .novo sobra (substituição completa)"   '[ -z "$(find "$R8/$GATES" -name "*.novo")" ]'
if NPMOUT8="$(cd "$R8/$GATES" && node --test test/*.test.mjs 2>&1)"; then NPMRC8=0; else NPMRC8=$?; fi
check "node --test test/*.test.mjs é verde na cópia instalada" '[ "$NPMRC8" -eq 0 ]'

echo "── cenário 8b: idem, mas com UM arquivo 1.0.1 editado localmente — só ele é recusado"
R8B="$(novo_repo)"
mkdir -p "$R8B/$GATES"
FX8B="$(fixture_101_gates)"
cp -R "$FX8B/." "$R8B/$GATES/"
printf '\n// edicao local\n' >> "$R8B/$GATES/scripts/harness-doctor.mjs"
EDITADO_ANTES="$(cat "$R8B/$GATES/scripts/harness-doctor.mjs")"
if SAIDA8B="$(bash "$INSTALAR" "$R8B" --atualizar --gates-substituir 2>&1)"; then RC8B=0; else RC8B=$?; fi
check "sai 0"                                        '[ "$RC8B" -eq 0 ]'
check "arquivo editado NÃO foi tocado"               '[ "$(cat "$R8B/$GATES/scripts/harness-doctor.mjs")" = "$EDITADO_ANTES" ]'
check ".novo do arquivo editado = plugin"            'cmp -s "$R8B/$GATES/scripts/harness-doctor.mjs.novo" "$PLUGIN/gates/scripts/harness-doctor.mjs"'
check "outro arquivo 1.0.1 (migrations-guard) foi substituído normalmente" 'cmp -s "$R8B/$GATES/scripts/migrations-guard.mjs" "$PLUGIN/gates/scripts/migrations-guard.mjs"'
check "script novo da 1.1.0 (capacidade.mjs) instalado (aditivo, não é test/)" '[ -f "$R8B/$GATES/scripts/capacidade.mjs" ]'
check "teste novo da 1.1.0 (capacidade.test.mjs) vai para .novo (estado misto)" '[ ! -e "$R8B/$GATES/test/capacidade.test.mjs" ] && [ -f "$R8B/$GATES/test/capacidade.test.mjs.novo" ]'
check "teste novo (cartao-sessao.test.mjs) também vai para .novo"   '[ -f "$R8B/$GATES/test/cartao-sessao.test.mjs.novo" ]'
check "aviso de versão mista aparece"                'printf "%s" "$SAIDA8B" | grep -q "tools/gabarito-gates em 1.0.x — rode --atualizar --gates-substituir"'
NOVO_TEST_REAL="$(find "$R8B/$GATES/test" -name "*.novo" | wc -l | tr -d ' ')"
check "6 testes novos da 1.1.0 foram para .novo"     '[ "$NOVO_TEST_REAL" -eq 6 ]'
NOVO_CONTADO="$(printf '%s' "$SAIDA8B" | grep -oE '[0-9]+ \.novo' | grep -oE '^[0-9]+')"
check "contador do resumo (\$novos .novo) bate com os 6 arquivos .novo de test/" '[ "$NOVO_CONTADO" = "$NOVO_TEST_REAL" ]'

echo "── $passou ok, $falhou falha(s)"
[ "$falhou" -eq 0 ]

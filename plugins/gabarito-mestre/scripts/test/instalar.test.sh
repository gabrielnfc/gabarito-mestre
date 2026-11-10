#!/usr/bin/env bash
# Testes do instalar.sh — bash puro (3.2+), repo fixture em mktemp -d, sem git no fixture.
# Roda: bash plugins/gabarito-mestre/scripts/test/instalar.test.sh   (exit 0 = tudo verde)
#
# O que está em jogo é R2 sobre o repo do usuário: o instalador NUNCA sobrescreve nem apaga. --atualizar gera
# `.novo` ao lado do que difere; `--guarda` emenda `.claude/settings.json` (une, nunca substitui) e, em dúvida,
# RECUSA e dá a linha para colar. 2.0 (E1): sem `--gates-substituir`, sem manifesto, sem `test/` nem README nos gates.
#
# MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
#  M1  sobrescrever AGENTS.md em --atualizar (em vez de .novo)
#  M3  duplicar linha no .gitignore na segunda execução
#  M4  rodar o doctor em --atualizar
#  M10 T6: copiar test/ para tools/gabarito-gates/  ⇒ instalador-nao-copia-test, instalador-conjunto-exato
#  M11 T6: --guarda sem `Read(.env*)` na lista     ⇒ settings-deny
#  M12 T6: --guarda com `Write(.env*)` na lista    ⇒ settings-deny
#  M13 T6: --guarda substitui o deny existente      ⇒ settings-deny-preserva-existente
#  M14 T6: --guarda sobrescreve JSON inválido       ⇒ settings-deny-recusa
#  M15 T6: .gitignore sem `.harness/entregas/_sem-id/` ⇒ gitignore-sem-id
#  M20 T6 r1: `Write(.env*)` (ou entrada a menos) na linha para colar de instalar.sh ⇒ linha-colavel-igual-ao-deny
#  M-T14  tirar `.claude-tmp/` da lista de emendar_gitignore ⇒ gitignore-claude-tmp
#  M19 T6 r1: .gitignore sem `.harness/heartbeat.json` ⇒ gitignore-heartbeat-local
#  M16 T6: --atualizar sobrescreve gate editado     ⇒ atualizar-nao-sobrescreve-gate
set -eu
AQUI="$(cd "$(dirname "$0")" && pwd)"
INSTALAR="$AQUI/../instalar.sh"
PLUGIN="$(cd "$AQUI/../.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN/../.." && pwd)"
passou=0; falhou=0
ok()    { passou=$((passou+1)); echo "  ok    $1"; }
falha() { falhou=$((falhou+1)); echo "  FALHA $1" >&2; }
check() { if eval "$2"; then ok "$1"; else falha "$1"; fi; }   # check "<nome>" '<expressão bash>'
novo_repo() { mktemp -d "${TMPDIR:-/tmp}/instalar-XXXXXX"; }
GATES="tools/gabarito-gates"
SETTINGS=".claude/settings.json"
# A lista da guarda (REQ-GRD-5), literal e independente do código: 7 entradas, sem `./`, nunca `Write(`.
DENY_EXATO='Read(.env*)|Read(!.env.example)|Edit(.env*)|Read(**/*.pem)|Edit(**/*.pem)|Read(**/*.key)|Edit(**/*.key)'
deny_de() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(((j.permissions||{}).deny||[]).join("|"))' "$1" 2>/dev/null || true; }
chave_de() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify(j[process.argv[2]]))' "$1" "$2" 2>/dev/null || true; }

# Conjunto EXATO de arquivos que uma instalação limpa cria (R12 depende disto). Os fixos são o contrato do instalador;
# os de gates/ vêm do plugin, menos test/, README.md e .hashes-anteriores.
esperado_instalado() {
  {
    printf '%s\n' .github/workflows/gabarito.yml .gitignore .harness/attest.json AGENTS.md CLAUDE.md \
      docs/harness/adocao.md docs/harness/fluxo.md docs/harness/gates.md docs/harness/prompts.md docs/harness/referencia.md \
      harness.config.json
    (cd "$PLUGIN/gates" && find . -type f -not -path '*/node_modules/*' -not -path './test/*' -not -path './README.md' \
      -not -path './.hashes-anteriores' -not -name .DS_Store | sed "s|^\./|$GATES/|")
  } | LC_ALL=C sort
}
instalado_de() { (cd "$1" && find . -type f -not -name .DS_Store | sed 's|^\./||' | LC_ALL=C sort); }
# Fixture 1.0.1 REAL de gates/ (commit 1c85330) — imprime o caminho do dir extraído.
fixture_101_gates() {
  local out; out="$(mktemp -d "${TMPDIR:-/tmp}/gm-101-XXXXXX")"
  (cd "$REPO_ROOT" && git archive 1c85330 plugins/gabarito-mestre/gates) | (cd "$out" && tar -x)
  printf '%s' "$out/plugins/gabarito-mestre/gates"
}
# Plugin 1.1.0 REAL (tag da release) — imprime o caminho de plugins/gabarito-mestre extraído, ou nada se a tag não existe.
plugin_110() {
  git -C "$REPO_ROOT" rev-parse -q --verify gabarito-mestre--v1.1.0 >/dev/null 2>&1 || return 0
  local out; out="$(mktemp -d "${TMPDIR:-/tmp}/gm-110-XXXXXX")"
  (cd "$REPO_ROOT" && git archive gabarito-mestre--v1.1.0 plugins/gabarito-mestre) | (cd "$out" && tar -x)
  printf '%s' "$out/plugins/gabarito-mestre"
}

echo "── cenário 1: instalação limpa"
R="$(novo_repo)"
if SAIDA="$(bash "$INSTALAR" "$R" 2>&1)"; then RC1=0; else RC1=$?; fi
check "instalação sai 0"                          '[ "$RC1" -eq 0 ]'
check "AGENTS.md criado"                          '[ -f "$R/AGENTS.md" ]'
check "docs/harness/referencia.md criado"         '[ -f "$R/docs/harness/referencia.md" ]'
check "gates copiados"                            '[ -f "$R/$GATES/scripts/harness-doctor.mjs" ] && [ -f "$R/$GATES/lib/config.mjs" ] && [ -f "$R/$GATES/dist/guarda.js" ]'
check "instalador-conjunto-exato: o que foi instalado é exatamente o esperado, nem a mais nem a menos" \
  '[ "$(instalado_de "$R")" = "$(esperado_instalado)" ]'
check "instalador-nao-copia-test: sem test/, sem README, sem .hashes-anteriores, sem manifesto" \
  '[ ! -e "$R/$GATES/test" ] && [ ! -e "$R/$GATES/README.md" ] && [ ! -e "$R/$GATES/.hashes-anteriores" ] && [ ! -e "$R/$GATES/.instalado.json" ]'
check ".gitignore com as 6 linhas"                '[ "$(grep -cxF -e ".harness/doctor-cache.json" -e ".harness/fluxo-cache.json" -e ".harness/entregas/_sem-id/" -e ".harness/heartbeat.json" -e "*.novo" -e "*.bak" "$R/.gitignore")" -eq 6 ]'
check "gitignore-claude-tmp: .claude-tmp/ ignorado (as respostas do onboarding não entram no git add . do adotante)" 'grep -qxF ".claude-tmp/" "$R/.gitignore"'
check "gitignore-heartbeat-local: .harness/heartbeat.json ignorado (nao viaja pelo git)" 'grep -qxF ".harness/heartbeat.json" "$R/.gitignore"'
check "gitignore-sem-id: .harness/entregas/_sem-id/ ignorado" 'grep -qxF ".harness/entregas/_sem-id/" "$R/.gitignore"'
check "template de CI instalado não tem o job gates-tests (test/ não vai junto)" '! grep -q "gates-tests" "$R/.github/workflows/gabarito.yml" && ! grep -q "npm test" "$R/.github/workflows/gabarito.yml"'
check "config instalada não traz chaves mortas"   '! grep -q "migrationsDir" "$R/harness.config.json" && ! grep -q "squash-titulo-pr" "$R/.harness/attest.json"'
check "sem --guarda, .claude/settings.json NÃO é criado" '[ ! -e "$R/$SETTINGS" ]'
check "doctor rodou ao fim"                       'printf "%s" "$SAIDA" | grep -q "harness-doctor — evidência"'
check "resumo sem sobrescrita"                    'printf "%s" "$SAIDA" | grep -q "Nenhum arquivo apagado ou sobrescrito"'
check "o instalador não menciona --gates-substituir nem manifesto" '! printf "%s" "$SAIDA" | grep -qiE "gates-substituir|instalado\.json|substituíd"'

echo "── cenário 2: segunda execução sem flag é idempotente"
ANTES2="$(instalado_de "$R")"
SAIDA2="$(bash "$INSTALAR" "$R" 2>&1)"
check ".gitignore não duplica"                    '[ "$(grep -cxF -e "*.novo" "$R/.gitignore")" -eq 1 ] && [ "$(grep -cxF -e ".harness/entregas/_sem-id/" "$R/.gitignore")" -eq 1 ]'
check "AGENTS.md mantido"                         'printf "%s" "$SAIDA2" | grep -q "mantido  AGENTS.md"'
check "nenhum arquivo novo (nem .novo) na segunda execução" '[ "$(instalado_de "$R")" = "$ANTES2" ]'

echo "── cenário 3: repo com .gitignore sem newline final e CLAUDE.md próprio"
R3="$(novo_repo)"; printf 'node_modules/' > "$R3/.gitignore"; printf '# meu\n' > "$R3/CLAUDE.md"
bash "$INSTALAR" "$R3" >/dev/null 2>&1
check "linha antiga preservada e as novas em linhas próprias" '[ "$(grep -cxF -e "node_modules/" -e "*.bak" -e ".harness/entregas/_sem-id/" "$R3/.gitignore")" -eq 3 ]'
check "CLAUDE.md emendado com @AGENTS.md sem perder o conteúdo" 'grep -qxF "# meu" "$R3/CLAUDE.md" && grep -qxF "@AGENTS.md" "$R3/CLAUDE.md"'

echo "── cenário 4: --atualizar sobre repo com AGENTS.md e um gate editados"
R4="$(novo_repo)"
bash "$INSTALAR" "$R4" >/dev/null 2>&1
printf '\nR19 — minha regra de projeto\n' >> "$R4/AGENTS.md"
cp "$R4/AGENTS.md" "$R4/AGENTS.md.antes"
printf '\n// minha edicao local\n' >> "$R4/$GATES/scripts/quality-ratchet.mjs"
cp "$R4/$GATES/scripts/quality-ratchet.mjs" "$R4/quality-ratchet.antes"
if SAIDA4="$(bash "$INSTALAR" "$R4" --atualizar 2>&1)"; then RC4=0; else RC4=$?; fi
check "--atualizar sai 0"                         '[ "$RC4" -eq 0 ]'
check "AGENTS.md intocado"                        'cmp -s "$R4/AGENTS.md" "$R4/AGENTS.md.antes"'
check "AGENTS.md.novo = referência do plugin"     'cmp -s "$R4/AGENTS.md.novo" "$PLUGIN/reference/AGENTS.md"'
check "diff --stat impresso"                      'printf "%s" "$SAIDA4" | grep -q "novo     AGENTS.md.novo"'
check "referencia.md idêntica → igual, sem .novo" 'printf "%s" "$SAIDA4" | grep -q "igual    docs/harness/referencia.md" && [ ! -e "$R4/docs/harness/referencia.md.novo" ]'
check "aviso R30+"                                'printf "%s" "$SAIDA4" | grep -q "R30+"'
check "doctor NÃO roda em --atualizar"            '! printf "%s" "$SAIDA4" | grep -q "harness-doctor — evidência"'
check "atualizar-nao-sobrescreve-gate: gate editado fica como está"  'cmp -s "$R4/$GATES/scripts/quality-ratchet.mjs" "$R4/quality-ratchet.antes"'
check "gate editado ganha .novo = plugin"         'cmp -s "$R4/$GATES/scripts/quality-ratchet.mjs.novo" "$PLUGIN/gates/scripts/quality-ratchet.mjs"'
check "gate idêntico ao plugin: igual, sem .novo" '[ ! -e "$R4/$GATES/scripts/harness-doctor.mjs.novo" ]'
check "nenhum .bak criado (não há mais substituição)" '[ -z "$(find "$R4" -name "*.bak")" ]'

echo "── cenário 5: --guarda (2ª camada — .claude/settings.json)"
R5="$(novo_repo)"
if SAIDA5="$(bash "$INSTALAR" "$R5" --guarda 2>&1)"; then RC5=0; else RC5=$?; fi
check "--guarda sai 0"                            '[ "$RC5" -eq 0 ]'
check "settings-deny: grava EXATAMENTE as 7 entradas, na ordem" '[ "$(deny_de "$R5/$SETTINGS")" = "$DENY_EXATO" ]'
check "settings-deny: nenhum Write( e nenhum ./"  '! deny_de "$R5/$SETTINGS" | grep -qE "Write\(|\./"'
check "settings-deny: nenhuma outra chave no arquivo criado" '[ "$(node -e "console.log(Object.keys(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"))).join())" "$R5/$SETTINGS")" = "permissions" ]'
check "saída diz que gravou"                      'printf "%s" "$SAIDA5" | grep -q "settings.json criado"'
ANTES5="$(cat "$R5/$SETTINGS" 2>/dev/null || echo AUSENTE)"
SAIDA5B="$(bash "$INSTALAR" "$R5" --guarda 2>&1 || true)"
check "settings-deny: idempotente (nenhum byte muda, 'sem mudanças')" '[ "$(cat "$R5/$SETTINGS")" = "$ANTES5" ] && printf "%s" "$SAIDA5B" | grep -q "sem mudanças"'

R5C="$(novo_repo)"; mkdir -p "$R5C/.claude"
printf '{\n    "model": "fable",\n    "permissions": {\n        "allow": ["Read"],\n        "deny": ["Bash(rm:*)", "Read(.env*)"]\n    },\n    "hooks": {"x": 1}\n}\n' > "$R5C/$SETTINGS"
bash "$INSTALAR" "$R5C" --guarda >/dev/null 2>&1 || true
check "settings-deny-preserva-existente: deny próprio mantido, na frente, sem duplicar" \
  '[ "$(deny_de "$R5C/$SETTINGS")" = "Bash(rm:*)|Read(.env*)|Read(!.env.example)|Edit(.env*)|Read(**/*.pem)|Edit(**/*.pem)|Read(**/*.key)|Edit(**/*.key)" ]'
check "settings-deny-preserva-existente: model, allow e hooks intactos" \
  '[ "$(chave_de "$R5C/$SETTINGS" model)" = "\"fable\"" ] && [ "$(chave_de "$R5C/$SETTINGS" hooks)" = "{\"x\":1}" ] && [ "$(node -e "console.log(JSON.stringify(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\")).permissions.allow))" "$R5C/$SETTINGS")" = "[\"Read\"]" ]'
check "settings-deny-preserva-existente: indentação do usuário (4 espaços) mantida" 'grep -q "^    \"model\"" "$R5C/$SETTINGS"'

recusa() { # recusa <nome> <setup: função que prepara $1> — settings fica intacto, instalação segue, linha para colar na saída
  local nome="$1" dir saida rc=0 antes depois
  dir="$(novo_repo)"; mkdir -p "$dir/.claude"; "$2" "$dir"
  antes="$(cat "$dir/$SETTINGS" 2>/dev/null || echo AUSENTE)"
  if saida="$(bash "$INSTALAR" "$dir" --guarda 2>&1)"; then rc=0; else rc=$?; fi
  depois="$(cat "$dir/$SETTINGS" 2>/dev/null || echo AUSENTE)"
  check "settings-deny-recusa ($nome): instalação sai 0 e o resto foi instalado" '[ "$rc" -eq 0 ] && [ -f "$dir/AGENTS.md" ]'
  check "settings-deny-recusa ($nome): arquivo intacto" '[ "$antes" = "$depois" ]'
  check "settings-deny-recusa ($nome): diz NÃO escrito, o motivo e a linha para colar" \
    'printf "%s" "$saida" | grep -q "settings.json NÃO escrito — " && printf "%s" "$saida" | grep -qF "Read(**/*.pem)" && printf "%s" "$saida" | grep -q "Cole você mesmo"'
  check "settings-deny-recusa ($nome): nenhum .tmp deixado" '[ -z "$(find "$dir/.claude/" -name "*.tmp*" 2>/dev/null)" ]'
}
s_invalido() { printf '{"permissions": ' > "$1/$SETTINGS"; }
s_comentario() { printf '{\n  // comentário\n  "model": "x"\n}\n' > "$1/$SETTINGS"; }
s_deny_nao_lista() { printf '{"permissions":{"deny":"Read"}}' > "$1/$SETTINGS"; }
s_symlink() { local f; f="$(novo_repo)"; printf '{"model":"x"}' > "$f/alvo.json"; ln -s "$f/alvo.json" "$1/$SETTINGS"; }
s_dir_symlink() { local f; f="$(novo_repo)"; printf '{}' > "$f/settings.json"; rmdir "$1/.claude"; ln -s "$f" "$1/.claude"; }
s_somente_leitura() { printf '{"model":"x"}' > "$1/$SETTINGS"; chmod 444 "$1/$SETTINGS"; }
recusa "JSON inválido" s_invalido
recusa "comentário" s_comentario
recusa "deny não é lista" s_deny_nao_lista
recusa "symlink" s_symlink
recusa ".claude symlink" s_dir_symlink
if [ "$(id -u)" -ne 0 ]; then recusa "sem permissão de escrita" s_somente_leitura; else ok "sem permissão de escrita: pulado (root ignora chmod)"; fi

# A linha para colar (caminho sem node) é digitada à mão em instalar.sh: tem de ser, entrada por entrada, a lista que o
# onboarding-config.mjs grava (M10-O7: um `Write(.env*)` ali passava despercebido porque o caminho sem node não roda aqui).
LINHA_SH="$(sed -n "s/^  local linha='\(.*\)'\$/\1/p" "$INSTALAR")"
check "linha-colavel-igual-ao-deny: a linha do instalar.sh (sem node) tem EXATAMENTE as 7 entradas e nenhum Write(" \
  'node -e "const l=JSON.parse(\"{\"+process.argv[1]+\"}\").permissions.deny; const e=process.argv[2].split(\"|\"); process.exit(JSON.stringify(l)===JSON.stringify(e)&&!l.some(x=>x.startsWith(\"Write(\"))?0:1)" "$LINHA_SH" "$DENY_EXATO"'
# sem node: recusa com a linha, não quebra a instalação (só roda onde /usr/bin:/bin não tem node)
if ! PATH="/usr/bin:/bin" command -v node >/dev/null 2>&1; then
  R5N="$(novo_repo)"
  SAIDA5N="$(PATH="/usr/bin:/bin" bash "$INSTALAR" "$R5N" --guarda 2>&1 || true)"
  check "settings-deny-recusa (sem node): não cria o arquivo e dá a linha" '[ ! -e "$R5N/$SETTINGS" ] && printf "%s" "$SAIDA5N" | grep -q "settings.json NÃO escrito — node"'
  check "settings-deny-recusa (sem node): a linha traz as 7 entradas, as mesmas do caminho com node" 'set -f; LINHAS=0; for e in $(printf "%s" "$DENY_EXATO" | tr "|" " "); do printf "%s" "$SAIDA5N" | grep -qF "\"$e\"" && LINHAS=$((LINHAS+1)); done; set +f; [ "$LINHAS" -eq 7 ]'
else
  ok "sem node: pulado (node está em /usr/bin ou /bin nesta máquina)"
fi

echo "── cenário 6: flags"
R6="$(novo_repo)"
if bash "$INSTALAR" "$R6" --xyz >/dev/null 2>&1; then falha "flag desconhecida deveria falhar"; else ok "flag desconhecida sai != 0"; fi
if SAIDA6="$(bash "$INSTALAR" "$R6" --atualizar --gates-substituir 2>&1)"; then falha "--gates-substituir foi removida (D9): deveria falhar"; else ok "--gates-substituir (removida) sai != 0"; fi
check "nada instalado quando a flag é inválida"   '[ ! -e "$R6/AGENTS.md" ]'
check "a mensagem lista as flags que existem"     'printf "%s" "$SAIDA6" | grep -q -- "--guarda"'

echo "── cenário 7: --codeowners"
R7="$(novo_repo)"
bash "$INSTALAR" "$R7" --codeowners >/dev/null 2>&1
check "CODEOWNERS criado com esqueleto"           'grep -q "Áreas e donos" "$R7/.github/CODEOWNERS"'
printf '* @time\n' > "$R7/.github/CODEOWNERS"
bash "$INSTALAR" "$R7" --codeowners >/dev/null 2>&1
check "CODEOWNERS existente é mantido"            '[ "$(cat "$R7/.github/CODEOWNERS")" = "* @time" ]'

echo "── cenário 8: SEM flags sobre gates 1.0.1 REAL (fixture do commit 1c85330) — nada existente é tocado"
R8="$(novo_repo)"
mkdir -p "$R8/$GATES"
FX8="$(fixture_101_gates)"
cp -R "$FX8/." "$R8/$GATES/"
if SAIDA8="$(bash "$INSTALAR" "$R8" 2>&1)"; then RC8=0; else RC8=$?; fi
check "sai 0"                                        '[ "$RC8" -eq 0 ]'
check "harness-doctor.mjs 1.0.1 NÃO foi tocado (sem --atualizar, R2)" 'cmp -s "$R8/$GATES/scripts/harness-doctor.mjs" "$FX8/scripts/harness-doctor.mjs"'
check "gate novo (capacidade.mjs) instalado direto; test/ nunca vem" '[ -f "$R8/$GATES/scripts/capacidade.mjs" ] && [ ! -e "$R8/$GATES/test/capacidade.test.mjs" ] && [ ! -e "$R8/$GATES/test/capacidade.test.mjs.novo" ]'
check "nenhum .novo sem --atualizar"                 '[ -z "$(find "$R8" -name "*.novo")" ]'

echo "── cenário 9: upgrade de uma instalação 1.1.0 REAL (tag gabarito-mestre--v1.1.0)"
P110="$(plugin_110)"
if [ -z "$P110" ]; then
  ok "tag gabarito-mestre--v1.1.0 ausente neste clone: cenário pulado (CI usa fetch-depth 0)"
else
  R9="$(novo_repo)"
  bash "$P110/scripts/instalar.sh" "$R9" >/dev/null 2>&1
  check "a instalação 1.1.0 trouxe test/ e manifesto (premissa da fixture)" '[ -f "$R9/$GATES/test/harness-doctor.test.mjs" ] && [ -f "$R9/$GATES/.instalado.json" ]'
  printf '\nR30 — regra do projeto\n' >> "$R9/AGENTS.md"
  printf '\n// edicao local\n' >> "$R9/$GATES/scripts/quality-ratchet.mjs"
  cp "$R9/AGENTS.md" "$R9/AGENTS.md.antes"; cp "$R9/$GATES/scripts/quality-ratchet.mjs" "$R9/quality-ratchet.antes"
  cp "$R9/$GATES/.instalado.json" "$R9/instalado.antes"
  TESTS_ANTES="$(cd "$R9/$GATES/test" && find . -type f | LC_ALL=C sort)"
  if SAIDA9="$(bash "$INSTALAR" "$R9" --atualizar 2>&1)"; then RC9=0; else RC9=$?; fi
  check "--atualizar sai 0"                              '[ "$RC9" -eq 0 ]'
  check "AGENTS.md do usuário intacto"                   'cmp -s "$R9/AGENTS.md" "$R9/AGENTS.md.antes"'
  check "gate editado intacto, com .novo"                'cmp -s "$R9/$GATES/scripts/quality-ratchet.mjs" "$R9/quality-ratchet.antes" && [ -f "$R9/$GATES/scripts/quality-ratchet.mjs.novo" ]'
  check "doctor 1.1.0 diferente do 2.0: intacto, com .novo = plugin" '! cmp -s "$R9/$GATES/scripts/harness-doctor.mjs" "$PLUGIN/gates/scripts/harness-doctor.mjs" && cmp -s "$R9/$GATES/scripts/harness-doctor.mjs.novo" "$PLUGIN/gates/scripts/harness-doctor.mjs"'
  check "o instalador NÃO apaga o manifesto, test/ nem README antigos (R2)" 'cmp -s "$R9/$GATES/.instalado.json" "$R9/instalado.antes" && [ -f "$R9/$GATES/README.md" ] && [ "$(cd "$R9/$GATES/test" && find . -type f -not -name "*.novo" | LC_ALL=C sort)" = "$TESTS_ANTES" ]'
  check "o instalador não cria nem atualiza nada em test/ (sem .novo lá)" '[ -z "$(find "$R9/$GATES/test" -name "*.novo")" ]'
  check "arquivos novos da 2.0 (lib/, dist/) entram"     '[ -f "$R9/$GATES/lib/config.mjs" ] && [ -f "$R9/$GATES/dist/guarda.js" ]'
  check "o manifesto antigo não é mais escrito nem citado na saída" '! printf "%s" "$SAIDA9" | grep -q "instalado.json"'
fi

echo "── cenário 10: repo NOVO (sem tools/) sem flags — instalação limpa"
RN="$(novo_repo)"
if SAIDAN="$(bash "$INSTALAR" "$RN" 2>&1)"; then RCN=0; else RCN=$?; fi
check "sai 0"                                        '[ "$RCN" -eq 0 ]'
check "gates instalados direto (sem .novo)"          '[ -f "$RN/$GATES/scripts/harness-doctor.mjs" ] && [ -z "$(find "$RN/$GATES" -name "*.novo")" ]'
if DOCN="$(cd "$RN" && node "$GATES/scripts/harness-doctor.mjs" --json 2>&1)"; then rcN=0; else rcN=$?; fi
check "o doctor instalado roda no repo alvo e reporta a camada (exit $rcN)" 'printf "%s" "$DOCN" | grep -q "\"camada\"" && ! printf "%s" "$DOCN" | grep -q "    at "'

echo "── cenário 11: hooks git de versionamento (R20) — repo git novo, gate antigo e hook de terceiro"
GITENV="GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1"
R10="$(novo_repo)"; env $GITENV git -C "$R10" init -q
if SAIDA10="$(env $GITENV bash "$INSTALAR" "$R10" 2>&1)"; then RC10=0; else RC10=$?; fi
check "repo git novo: sai 0 e grava commit-msg e pre-push" '[ "$RC10" -eq 0 ] && [ -x "$R10/.git/hooks/commit-msg" ] && [ -x "$R10/.git/hooks/pre-push" ]'
check "2ª execução não duplica o bloco" 'bash "$INSTALAR" "$R10" >/dev/null 2>&1; [ "$(grep -c "# >>> gabarito-mestre" "$R10/.git/hooks/commit-msg")" -eq 1 ]'
R10B="$(novo_repo)"; env $GITENV git -C "$R10B" init -q
mkdir -p "$R10B/$GATES/scripts"; printf 'export const x = 1; // versionamento-check 1.1.0, sem o modo de hook\n' > "$R10B/$GATES/scripts/versionamento-check.mjs"
SAIDA10B="$(env $GITENV bash "$INSTALAR" "$R10B" 2>&1)" || true
check "gate instalado sem --msg: NÃO grava hook e explica como atualizar" '[ ! -e "$R10B/.git/hooks/commit-msg" ] && printf "%s" "$SAIDA10B" | grep -q "anterior" && printf "%s" "$SAIDA10B" | grep -q -- "--atualizar" && ! printf "%s" "$SAIDA10B" | grep -q -- "--gates-substituir"'
R10C="$(novo_repo)"; env $GITENV git -C "$R10C" init -q
printf '#!/usr/bin/env python3\nprint(1)\n' > "$R10C/.git/hooks/commit-msg"; chmod +x "$R10C/.git/hooks/commit-msg"; cp "$R10C/.git/hooks/commit-msg" "$R10C.orig"
if SAIDA10C="$(env $GITENV bash "$INSTALAR" "$R10C" 2>&1)"; then RC10C=0; else RC10C=$?; fi
check "hook python de terceiro: sai 0, avisa, e o arquivo fica byte a byte igual" '[ "$RC10C" -eq 0 ] && cmp -s "$R10C/.git/hooks/commit-msg" "$R10C.orig" && printf "%s" "$SAIDA10C" | grep -q "NÃO instalados"'

echo "── $passou ok, $falhou falha(s)"
[ "$falhou" -eq 0 ]

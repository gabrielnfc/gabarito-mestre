#!/usr/bin/env bash
# Invariantes de TEXTO da 1.1.0 — job `texto` do ci.yml chama este script (B11, handoff §B).
# bash puro (3.2+/GNU), roda da RAIZ do repositório. Cada checagem imprime o que conferiu; um
# desvio NÃO interrompe — o script roda todas as checagens, acumula as falhas e sai 1 no fim se
# houver ao menos uma (nunca "imprime e sai 0" — B11).
#
# Fonte de cada checagem: handoff.md §B (B1–B11), task-25-brief.md (Emenda #14, fluxo.md
# 7 seções em ORDEM), ruling F6-R4 (nomes dos 4 jobs do ruleset não mudam — conferido no
# ci.yml, não aqui) e F6-R7 (grep de "hooks" no plugin.json tem de casar `[[:space:]]*:`).
#
# MUTAÇÕES PRESCRITAS (cada uma tem que derrubar este script — ver task-25b-report.md para a
# tabela mutação → checagem, com RC medido):
#  B1  encurtar uma regra R/I para só o rótulo em negrito, sem conteúdo
#  B1b citar em AGENTS.md um *.mjs/*.sh que não existe em gates/scripts/ nem hooks/
#  B2  DISPATCH diverge entre prompts.md e referencia.md; hatch citado no AGENTS.md sem uso em hooks/
#  B3  apagar "opcional" de tag-semver; remover o passo 9 de prompts.md
#  B4  trocar um `uses:` de SHA por `@v4`
#  B5  desalinhar a tabela de fases 2-4 ou a frase "já existia" do SKILL.md de instalar
#  B6  remover "Ela DELEGA e depois CONFERE" ou a frase do Emenda #7 do SKILL.md de conformidade
#  B7  desalinhar cache/Apêndice/fluxo.md/Isolamento/CODEOWNERS entre os arquivos que têm de casar
#  B8  PR_TEMPLATE.md listar tipo que não está em tiposComEscopoDePbi/tiposLivres (DEFAULTS)
#  F6-R7 usar `grep -c '"hooks"'` sem `[[:space:]]*:` (sempre 1, por causa da keyword)
#  "77 testes" reintroduzido em plugins/gabarito-mestre, .github/, README.md ou CONTRIBUTING.md
#  renomear no ci.yml um dos 4 checks exigidos pelo ruleset de main, ou tirar ubuntu-latest/macos-latest da matriz de hooks
#  nomes da 1.0.1 (4 skills · 3 agents · 1 command · 2+3 hooks · 7 gates + 4 scripts · R1–R18 · G1–G9 · I1–I12)
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
P="$(cd "$AQUI/../.." && pwd)"                 # plugins/gabarito-mestre
ROOT="$(cd "$P/../.." && pwd)"                 # raiz do repositório
cd "$ROOT" || exit 1

falhas=0
ok()    { echo "  ok    $1"; }
falha() { falhas=$((falhas+1)); echo "  FALHA $1: $2" >&2; }
# check "<nome>" '<expressão bash>' "<motivo se falhar>"
check() { if eval "$2"; then ok "$1"; else falha "$1" "$3"; fi; }

A="$P/reference/AGENTS.md"
R="$P/reference/referencia.md"
D="$P/reference/adocao.md"
Q="$P/reference/prompts.md"
F="$P/reference/fluxo.md"
SI="$P/skills/gabarito-instalar/SKILL.md"
SC="$P/skills/gabarito-conformidade/SKILL.md"
AG="$P/agents/gabarito-implementador.md"
IS="$P/scripts/instalar.sh"
VC="$P/gates/scripts/versionamento-check.mjs"
CS="$P/gates/scripts/cartao-sessao.mjs"
PRT="$P/templates/PULL_REQUEST_TEMPLATE.md"

# ── fluxo.md — 7 seções, EM ORDEM (Emenda #14, task-25-brief.md) ──────────────────────
echo "── fluxo.md — 7 seções em ordem (FLX-1, Emenda #14)"
n=$(grep -c '^## ' "$F")
check "7 seções (achei $n)" '[ "'"$n"'" -eq 7 ]' "fluxo.md tem $n seções '## ', esperado 7"
DIFF_FLUXO=$(diff <(grep '^## ' "$F") <(printf '%s\n' \
  '## 1. Os três níveis' \
  '## 2. Os oito tipos de card' \
  '## 3. Políticas gerais' \
  '## 4. Colunas e regras de movimento' \
  '## 5. Propagação entre níveis' \
  '## 6. Ponto de compromisso, WIP e vazão por nível' \
  '## 7. Métricas medem item, nunca pessoa') 2>&1)
check "títulos e ordem exatos da Fase 1 (T2)" '[ -z "$DIFF_FLUXO" ]' "diff: $DIFF_FLUXO"

# ── AGENTS.md — R19/R20/R21/R30+, sem §3.7, teto de bytes ─────────────────────────────
echo "── AGENTS.md (FLX-4, VER-4, ORQ-2, CTX-1)"
check "cita R19"          "grep -q 'R19' '$A'" "R19 ausente"
check "cita R20"          "grep -q 'R20' '$A'" "R20 ausente"
check "cita R21"          "grep -q 'R21' '$A'" "R21 ausente"
check "'não têm override'" "grep -q 'não têm override' '$A'" "frase ausente"
check "cita R30+"         "grep -q 'R30+' '$A'" "R30+ ausente"
check "sem §3.7"          '[ "$(grep -c "§3.7" "'"$A"'")" -eq 0 ]' "AGENTS.md ainda cita §3.7"
check "sem R19+"          '[ "$(grep -c "R19+" "'"$A"'")" -eq 0 ]' "AGENTS.md ainda diz R19+"
BYTES_OUT=$(node -e "
  const t=require('fs').readFileSync('$A','utf8');
  const i=t.search(/^## Apêndice/m); const nucleo=Buffer.byteLength(i<0?t:t.slice(0,i));
  const ap=i<0?0:Buffer.byteLength(t.slice(i));
  console.log('núcleo', nucleo, 'B · apêndice', ap, 'B');
  if(nucleo>17291){console.error('núcleo acima do teto 17.291');process.exit(1)}
  if(ap>4096){console.error('apêndice acima de 4.096');process.exit(1)}")
RC_BYTES=$?
echo "  $BYTES_OUT"
check "núcleo ≤ 17.291 B · apêndice ≤ 4.096 B" '[ "$RC_BYTES" -eq 0 ]' "teto de bytes estourado"

# ── B1 (handoff §B.1) — conteúdo mínimo de R1–R21/I1–I12, scripts citados existem ─────
echo "── B1: conteúdo mínimo das regras (não só o rótulo) e scripts citados existem"
b1_falhou=0
while IFS=: read -r ln rest; do
  len=$(printf '%s' "$rest" | wc -m | tr -d ' ')
  if [ "$len" -lt 40 ]; then falha "B1: linha $ln de AGENTS.md" "só $len caracteres depois do rótulo (< 40)"; b1_falhou=1; fi
done < <(grep -nE '^\*\*R[0-9]+ — ' "$A")
while IFS=: read -r ln rest; do
  len=$(printf '%s' "$rest" | wc -m | tr -d ' ')
  if [ "$len" -lt 40 ]; then falha "B1: linha $ln de AGENTS.md (I)" "só $len caracteres (< 40)"; b1_falhou=1; fi
done < <(grep -nE '^\| \*\*I[0-9]+\*\* \|' "$A")
LINHA_G=$(grep '\*\*G1\*\*' "$A")
LEN_G=$(printf '%s' "$LINHA_G" | wc -m | tr -d ' ')
if [ "$LEN_G" -lt 200 ]; then falha "B1: linha dos G1–G9" "só $LEN_G caracteres (< 200)"; b1_falhou=1; fi
for gn in 1 2 3 4 5 6 7 8 9; do
  printf '%s' "$LINHA_G" | grep -qE "\*\*G$gn\*\* [^·.]{3,}" || { falha "B1: G$gn" "sem gloss de ≥ 3 caracteres depois do rótulo"; b1_falhou=1; }
done
[ "$b1_falhou" -eq 0 ] && ok "R1–R21 e I1–I12 com conteúdo ≥ 40 caracteres; G1–G9 com gloss"
b1b_falhou=0
for f in $(grep -oE '[A-Za-z0-9_-]+\.(mjs|sh)' "$A" | sort -u); do
  if [ ! -f "$P/gates/scripts/$f" ] && [ ! -f "$P/hooks/$f" ]; then
    falha "B1: $f citado em AGENTS.md" "não existe em gates/scripts/ nem hooks/"; b1b_falhou=1
  fi
done
[ "$b1b_falhou" -eq 0 ] && ok "todo *.mjs/*.sh citado no AGENTS.md existe em gates/scripts/ ou hooks/"

# ── B2 (handoff §B.2) — DISPATCH idêntico, hatches usados, ≤ 40 == MAX_LINHAS, inegociável ──
echo "── B2: DISPATCH idêntico, hatches em hooks/, ≤ 40 == MAX_LINHAS, inegociável cobre R1–R21"
DISPATCH_FMT='DISPATCH Task <N> slots=<slots> worktree wt/<PBI>-<n>'
# Achado MAJOR #1 (review T25b, task-25b-review.md): `grep -qF` só prova PRESENÇA em algum lugar do
# arquivo — referencia.md cita a linha DISPATCH 3x (§2.3 l.62, §3.1 l.92, "Antes de despachar" l.150);
# mutar só a ocorrência canônica (l.62) deixava a checagem verde porque as outras duas ainda casavam.
# Fix: toda ocorrência do literal "DISPATCH Task" no arquivo tem de ser, ela mesma, uma ocorrência do
# formato canônico completo — conta as duas e exige igualdade (e ≥ 1, para não passar vazio).
for par in "$Q:prompts.md" "$R:referencia.md"; do
  arq="${par%%:*}"; nome="${par##*:}"
  n_lit=$(grep -o 'DISPATCH Task' "$arq" | wc -l | tr -d ' ')
  n_can=$(grep -o -F "$DISPATCH_FMT" "$arq" | wc -l | tr -d ' ')
  check "toda ocorrência de 'DISPATCH Task' em $nome casa o formato canônico ($n_can/$n_lit)" \
    '[ "'"$n_lit"'" -ge 1 ] && [ "'"$n_lit"'" -eq "'"$n_can"'" ]' \
    "$nome tem $n_lit ocorrência(s) de 'DISPATCH Task' mas só $n_can casa(m) o formato completo"
done
for hv in GABARITO_ALLOW_DESTRUCTIVE GABARITO_ALLOW_PRODUCTION GABARITO_ALLOW_VERSIONING; do
  check "$hv citado no AGENTS.md existe em hooks/" "grep -q '$hv' '$A' && grep -rlq '$hv' '$P/hooks/'*.sh >/dev/null 2>&1" "hatch sem uso em hooks/"
done
MAXL=$(grep -oE "MAX_LINHAS = [0-9]+" "$CS" | grep -oE '[0-9]+')
check "'≤ 40' do AGENTS.md bate com MAX_LINHAS=$MAXL de cartao-sessao.mjs" "grep -q '≤ 40 linhas' '$A' && [ '$MAXL' = 40 ]" "MAX_LINHAS ≠ 40 ou AGENTS.md não cita ≤ 40 linhas"
check "'inegociável' cobre R1–R21" "grep -q 'inegociável (R1–R21' '$A'" "frase de cobertura ausente ou alcance diferente"

# ── B3 (handoff §B.3) — adocao.md tag-semver opcional; prompts.md passo 9 ─────────────
echo "── B3: tag-semver opcional; passo 9 do orquestrador"
check "tag-semver marcado 'opcional' em adocao.md" "grep -qF '(\`tag-semver\`, **opcional**' '$D'" "marcação 'opcional' ausente/mudou"
check "prompts.md: aviso de escrita não autorizada (FLX-6)" '[ "$(grep -c "ferramenta não atualizada (escrita não autorizada)" "'"$Q"'")" -eq 1 ]' "grafia ausente ou duplicada"
check "prompts.md: grafia canônica preparado→em_execucao" "grep -q 'preparado→em_execucao' '$Q'" "grafia ausente/mudou"

# ── B4 (handoff §B.4) — uses: pinado por SHA de 40 hex em templates/gabarito.yml e .github/workflows/*.yml ──
echo "── B4: uses: pinado por SHA (nenhum @vN)"
NAO_PINADO=$(grep -n 'uses:' "$P/templates/gabarito.yml" "$ROOT"/.github/workflows/*.yml 2>/dev/null | grep -vE '@[0-9a-f]{40} ')
check "todo 'uses:' pinado por SHA de 40 hex" '[ -z "$NAO_PINADO" ]' "$NAO_PINADO"

# ── B5 (handoff §B.5, F5-R10) — skills/gabarito-instalar/SKILL.md ─────────────────────
echo "── B5: SKILL.md de gabarito-instalar — tabela de fases e frase 'já existia'"
N5=$(grep -cE '^\| (2 — fluxo \| `fluxo|3 — versionamento \| `versionamento|4 — orquestração \| `orquestracao\.modelo)\.resolvidoEm` \|' "$SI")
check "3 linhas da tabela de fases 2–4 com \`.resolvidoEm\`" '[ "'"$N5"'" -eq 3 ]' "achei $N5, esperado 3"
check "frase 'já existia** ... não edite (R2)'" "grep -qF 'já existia** (saída \`mantido\`, ou a fase 1 não rodou nesta execução) → **não edite** (R2)' '$SI'" "frase ausente/mudou"

# ── B6 (handoff §B.6, F5-R11) — skills/gabarito-conformidade/SKILL.md ─────────────────
echo "── B6: SKILL.md de gabarito-conformidade"
check "'Ela DELEGA e depois CONFERE'" '[ "$(grep -c "Ela DELEGA e depois CONFERE" "'"$SC"'")" -eq 1 ]' "frase ausente/duplicada"
check "sem fluxo.resolvidoEm → AVISO (pré-conferência)" "grep -q 'fail-open declarado (G9)' '$SC' && grep -q 'AVISO' '$SC'" "regra de fail-open ausente"
check "'status sem chave = opção, não comprometido' (Emenda #7)" "grep -qF '**opção, não comprometido** (Emenda #7' '$SC'" "frase ausente/mudou"

# ── B7 (handoff §B.7, 5 contratos) ─────────────────────────────────────────────────────
echo "── B7: cinco contratos entre arquivos (GM-5 MINOR-6)"
# (a) chaves do cache que a skill grava == chaves que cartao-sessao.mjs lê
check "(a) skill grava epic/iniciativa/titulo/em" "grep -q 'c\[pbi\] = { epic, iniciativa, titulo, em:' '$SI'" "objeto do cache mudou de forma na skill"
check "(a) cartao-sessao.mjs lê c.epic, c.iniciativa, c.em" "grep -q 'c\.epic' '$CS' && grep -q 'c\.iniciativa' '$CS' && grep -q 'c\.em' '$CS'" "leitura do cache mudou em cartao-sessao.mjs"
# (b) as SEIS linhas do Apêndice que o onboarding (fases 2-4) preenche — rótulo em AGENTS.md ==
# rótulo citado na skill (as demais linhas do Apêndice são preenchidas à mão na fase 1, fora do onboarding).
b7b_falhou=0
ROTULOS_ONBOARDING=(
  'Fluxo: ferramenta · Iniciativa padrão (ID · nome) · escrita autorizada por `____` em `____` (ADR-FLX-2)'
  'Versionamento: modelo · prefixos de branch · resolvido em (R20)'
  'Modelo do orquestrador: política · alias · resolvido em (validade 90 d)'
  'Paralelismo: simultaneos · teto · calibrado em'
  'Isolamento de worktree: porta · schema · namespace por `n`'
  'Áreas e donos (`.github/CODEOWNERS`)'
)
for rotulo in "${ROTULOS_ONBOARDING[@]}"; do
  grep -qF "$rotulo" "$A" || { falha "B7(b): rótulo do Apêndice" "'$rotulo' sumiu de AGENTS.md"; b7b_falhou=1; }
  grep -qF "$rotulo" "$SI" || { falha "B7(b): rótulo do Apêndice" "'$rotulo' não aparece na skill de instalar"; b7b_falhou=1; }
done
[ "$b7b_falhou" -eq 0 ] && ok "(b) as 6 linhas do Apêndice que o onboarding preenche batem AGENTS.md × skill de instalar"
# (c) §N de fluxo.md citados pela conformidade estão dentro de 1..7
b7c_falhou=0
for secn in $(grep -oE 'fluxo\.md §[0-9]+' "$SC" | grep -oE '[0-9]+' | sort -u); do
  { [ "$secn" -ge 1 ] && [ "$secn" -le 7 ]; } || { falha "B7(c): fluxo.md §$secn" "citado na conformidade mas fluxo.md só tem 7 seções"; b7c_falhou=1; }
done
[ "$b7c_falhou" -eq 0 ] && ok "(c) §N de fluxo.md citados pela conformidade existem (1..7)"
# (d) bloco Isolamento idêntico entre o agente e prompts.md
BLOCO_AGENTE=$(sed -n '/^Isolamento: porta <3000+n>/,/referencia\.md §3\.1/p' "$AG")
BLOCO_PROMPTS=$(sed -n '/^Isolamento: porta <3000+n>/,/referencia\.md §3\.1/p' "$Q")
check "(d) bloco Isolamento idêntico entre agente e prompts.md" '[ "$BLOCO_AGENTE" = "$BLOCO_PROMPTS" ] && [ -n "$BLOCO_AGENTE" ]' "diff não vazio ou bloco não encontrado"
# (e) marcador do CODEOWNERS igual entre a skill e instalar.sh
MARCADOR='# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:'
check "(e) marcador CODEOWNERS igual na skill e em instalar.sh" "grep -qF '$MARCADOR' '$SI' && grep -qF '$MARCADOR' '$IS'" "marcador ausente/diferente"

# ── B8 (handoff §B.8) — PR_TEMPLATE lista exatamente os tipos de versionamento-check.mjs ──
echo "── B8: PULL_REQUEST_TEMPLATE.md lista tiposComEscopoDePbi/tiposLivres do DEFAULTS"
COM_PBI=$(node -e "console.log(require('$VC').DEFAULTS.tiposComEscopoDePbi.join(' | '))")
SEM_PBI=$(node -e "console.log(require('$VC').DEFAULTS.tiposLivres.join(' | '))")
check "PR_TEMPLATE.md cita tiposComEscopoDePbi (com PBI)" "grep -qF '$COM_PBI' '$PRT'" "lista com PBI mudou (esperado '$COM_PBI')"
check "PR_TEMPLATE.md cita tiposLivres (sem PBI)"          "grep -qF '$SEM_PBI' '$PRT'" "lista sem PBI mudou (esperado '$SEM_PBI')"

# ── referencia.md / adocao.md / prompts.md — GM-4 T19/T20 minors + FLX-7/CTX-2/CTX-3 ──
echo "── referencia.md / adocao.md / prompts.md"
check "'Sem sprint, sem timebox' removido" '[ "$(grep -c "Sem sprint, sem timebox, sem WIP formal" "'"$R"'")" -eq 0 ]' "frase ainda presente"
check "referencia.md §3.5 + ADR-FLX-1 + Versionamento" "grep -q '^### 3.5' '$R' && grep -q 'ADR-FLX-1' '$R' && grep -q 'Versionamento' '$R'"  "algum dos três ausente"
check "adocao.md cita 'MCP demais'" "grep -q 'MCP demais' '$D'" "frase ausente"
check "adocao.md sem 'assume orquestração por uma pessoa sênior'" '[ "$(grep -c "assume orquestração por uma pessoa sênior" "'"$D"'")" -eq 0 ]' "frase antiga ainda presente"
check "prompts.md: 'Isolamento: porta' e 'antes de despachar'" "grep -q 'Isolamento: porta' '$Q' && grep -qi 'antes de despachar' '$Q'" "algum dos dois ausente"
check "gabarito-implementador.md: 'Isolamento: porta'" "grep -q 'Isolamento: porta' '$AG'" "ausente"

# ── skills (ONB-8, CNF-1) ──────────────────────────────────────────────────────────────
echo "── skills — allowed-tools e checklists"
check "SKILL.md instalar: AskUserQuestion no allowed-tools"  "sed -n '/^allowed-tools:/p' '$SI' | grep -q 'AskUserQuestion'" "ausente"
check "SKILL.md instalar: Edit no allowed-tools"              "sed -n '/^allowed-tools:/p' '$SI' | grep -q 'Edit'" "ausente"
check "SKILL.md instalar: Bash(claude mcp list:*)"            "sed -n '/^allowed-tools:/p' '$SI' | grep -q 'Bash(claude mcp list:\*)'" "ausente"
check "SKILL.md instalar: nenhum mcp__ no allowed-tools"      '[ "$(sed -n "/^allowed-tools:/p" "'"$SI"'" | grep -c "mcp__")" -eq 0 ]' "mcp__ apareceu no allowed-tools"
check "SKILL.md instalar: 4 seções '## Fase '"                '[ "$(grep -c "^## Fase " "'"$SI"'")" -eq 4 ]' "contagem de fases ≠ 4"
check "SKILL.md conformidade: fio condutor · contenda (R21) · Epic: PBIs" "grep -q 'fio condutor' '$SC' && grep -q 'contenda (R21)' '$SC' && grep -q 'Epic: PBIs (fluxo.md §2)' '$SC'" "algum dos três ausente"

# ── pacote — versões, hooks (F6-R7), 77 testes, nomes da 1.0.1 (PKG-1, PKG-2) ─────────
echo "── pacote — versões, sem hooks em plugin.json, sem 77 testes, nomes da 1.0.1"
v1=$(node -p "require('$P/.claude-plugin/plugin.json').version" 2>/dev/null)
v2=$(node -p "require('$ROOT/.claude-plugin/marketplace.json').plugins[0].version" 2>/dev/null)
v3=$(node -p "require('$P/gates/package.json').version" 2>/dev/null)
check "os três version == 1.1.0 (achei '$v1' '$v2' '$v3')" '[ "$v1" = "$v2" ] && [ "$v2" = "$v3" ] && [ "$v1" = "1.1.0" ]' "versões divergem ou ≠ 1.1.0"
# RULING F6-R7 (2): o grep do plano `grep -c '"hooks"'` é sempre verdadeiro — a keyword do array já
# conta 1. A checagem correta ancora na FORMA DE CHAVE JSON: `"hooks"` seguido de `:` (com ou sem espaço).
HOOKS_KEY=$(grep -c '"hooks"[[:space:]]*:' "$P/.claude-plugin/plugin.json")
check "plugin.json sem chave \"hooks\" (F6-R7)" '[ "'"$HOOKS_KEY"'" -eq 0 ]' "plugin.json declara uma chave \"hooks\" (achei $HOOKS_KEY)"
N77=$(grep -rn '77 testes' "$P" "$ROOT/.github" "$ROOT/README.md" "$ROOT/CONTRIBUTING.md" --include='*.md' --include='*.yml' --include='*.sh' --include='*.json' 2>/dev/null | grep -v 'scripts/test/texto.test.sh' | wc -l | tr -d ' ')
check "'77 testes' = 0 fora do CHANGELOG" '[ "'"$N77"'" -eq 0 ]' "'77 testes' ainda aparece ($N77 linha(s))"
# Ruleset de main (F6-R4, MINOR-7 do review final): os 4 checks exigidos são nomes de job do ci.yml.
# Renomear um deles trava toda PR no GitHub — aqui o desvio aparece antes do push.
CI="$ROOT/.github/workflows/ci.yml"
HOOKS_JOB=$(awk '/^  hooks:/{f=1;next} f&&/^  [a-z][a-z-]*:/{f=0} f' "$CI")
check "ci.yml: check 'claude plugin validate --strict' (ruleset)" "grep -qxF '    name: claude plugin validate --strict' '$CI'" "nome de job exigido pelo ruleset ausente"
check "ci.yml: check 'doctor não se auto-detecta (M10)' (ruleset)" "grep -qxF '    name: doctor não se auto-detecta (M10)' '$CI'" "nome de job exigido pelo ruleset ausente"
check "ci.yml: check 'hooks — corpora (bash \${{ matrix.os }})' (ruleset)" 'printf "%s\n" "$HOOKS_JOB" | grep -qxF "    name: hooks — corpora (bash \${{ matrix.os }})"' "nome do job hooks exigido pelo ruleset ausente"
check "ci.yml: matriz de hooks com ubuntu-latest e macos-latest (ruleset)" 'OSL=$(printf "%s\n" "$HOOKS_JOB" | grep -E "^ +os:"); printf "%s" "$OSL" | grep -q "ubuntu-latest" && printf "%s" "$OSL" | grep -q "macos-latest"' "matriz do job hooks não produz os 2 nomes exigidos"
# F6-R12: cenário 8/8b do instalar.test.sh extrai a fixture 1.0.1 com `git archive 1c85330 …`
# (instalar.test.sh l.36) — exige histórico completo. Checkout raso do Actions derruba o job
# instalador com "fatal: not a valid object name: 1c85330". O checkout do job instalador tem
# de pedir fetch-depth: 0.
INSTALADOR_JOB=$(awk '/^  instalador:/{f=1;next} f&&/^  [a-z][a-z-]*:/{f=0} f' "$CI")
check "ci.yml: job instalador com fetch-depth: 0 (cenário 8 lê 1c85330)" 'printf "%s\n" "$INSTALADOR_JOB" | grep -qE "fetch-depth:[[:space:]]*0"' "checkout do job instalador sem fetch-depth: 0 — cenário 8 do instalar.test.sh precisa do histórico completo"
nomes_falhou=0
for f in skills/gabarito-instalar/SKILL.md skills/gabarito-conformidade/SKILL.md skills/gabarito-review/SKILL.md skills/gabarito-spike/SKILL.md \
         agents/gabarito-implementador.md agents/gabarito-revisor.md agents/gabarito-spike.md commands/gabarito-doctor.md \
         hooks/guard-destructive.sh hooks/guard-production.sh hooks/guard-versioning.sh hooks/session-card.sh hooks/remind-orchestrator.sh \
         gates/src/mass-mutation-guard.ts gates/src/production-host-guard.ts gates/eslint/no-unfiltered-mass-mutation.js \
         gates/scripts/migrations-guard.mjs gates/scripts/deploy-order-check.mjs gates/scripts/quality-ratchet.mjs gates/scripts/harness-doctor.mjs \
         gates/scripts/onboarding-config.mjs gates/scripts/capacidade.mjs gates/scripts/versionamento-check.mjs gates/scripts/cartao-sessao.mjs; do
  [ -f "$P/$f" ] || { falha "nomes da 1.0.1: $f" "ausente"; nomes_falhou=1; }
done
for rn in $(seq 1 18); do grep -qE "(^|[^A-Z0-9])R$rn([^0-9]|$)" "$A" || { falha "nomes da 1.0.1: R$rn" "ausente do AGENTS.md"; nomes_falhou=1; }; done
for gn in $(seq 1 9);  do grep -qE "(^|[^A-Z0-9])G$gn([^0-9]|$)" "$A" || { falha "nomes da 1.0.1: G$gn" "ausente do AGENTS.md"; nomes_falhou=1; }; done
for in_ in $(seq 1 12); do grep -qE "(^|[^A-Z0-9])I$in_([^0-9]|$)" "$A" || { falha "nomes da 1.0.1: I$in_" "ausente do AGENTS.md"; nomes_falhou=1; }; done
[ "$nomes_falhou" -eq 0 ] && ok "nomes da 1.0.1 presentes: 4 skills, 3 agents, 1 command, 2 hooks (+3), 7 gates (+4 scripts), R1–R18, G1–G9, I1–I12"

echo "── $falhas falha(s)"
[ "$falhas" -eq 0 ]

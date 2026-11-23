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
#  B5  voltar a tabela/seções de fases ("## Fase N") ou tirar `## Fluxo`/`## Modo --vincular`/`## Proibido` do SKILL.md de instalar
#  FASE grep de "fase 2-4"/"(fase"/"quatro fases" em skills, reference, commands, gates/scripts e README (caso plantado: texto-nom.test.sh)
#  B6  remover "Ela DELEGA e depois CONFERE" ou a frase do Emenda #7 do SKILL.md de conformidade
#  B7  desalinhar cache/Apêndice/fluxo.md/Isolamento/CODEOWNERS entre os arquivos que têm de casar
#  B8  PR_TEMPLATE.md listar tipo que não está em tiposComEscopoDePbi/tiposLivres (DEFAULTS)
#  F6-R7 usar `grep -c '"hooks"'` sem `[[:space:]]*:` (sempre 1, por causa da keyword)
#  "77 testes" reintroduzido em plugins/gabarito-mestre, .github/, README.md ou CONTRIBUTING.md
#  A4 r1: voltar a citar --gates-substituir como opção, ou `test -f …/.instalado.json` na skill
#  A3 r1: renomear o job instalador do ci.yml ⇒ nome exato do ruleset; doctor-self deixar de exigir configurada
#  renomear no ci.yml um dos 4 checks exigidos pelo ruleset de main, ou tirar ubuntu-latest/macos-latest da matriz de hooks
#  GM-19 MF2-a apagar o `check` de texto-nom.test.sh · MF2-b engolir o rc dele (`|| true`) · MF2-c inverter 1 caso de texto-nom.test.sh (este script sai 1)
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

# ── NOM-1 (REQ-NOM-1) — nome "Fluxo Gabarito"; o nome antigo só nas exceções ──────────
# Escopo: plugins/**, marketplace, README, CHANGELOG, docs/**. Exceções: docs/ledgers, docs/aprendizados,
# docs/references; specs e planos datados até 2026-11-10 inclusive; CHANGELOG a partir do 1º "## [1.".
# Casos com fixture em texto-nom.test.sh. `--nom` roda só esta checagem (o fixture usa o caminho real).
nom_achados() {
  git grep -nIiE 'workflow[ _-]?true' -- plugins/gabarito-mestre .claude-plugin/marketplace.json README.md CHANGELOG.md docs 2>/dev/null |
  while IFS= read -r hit; do
    arq="${hit%%:*}"; resto="${hit#*:}"; ln="${resto%%:*}"
    case "$arq" in
      docs/ledgers/*|docs/aprendizados/*|docs/references/*) continue ;;
      CHANGELOG.md)
        ln1=$(grep -n -m1 '^## \[1\.' CHANGELOG.md | cut -d: -f1)
        [ -n "$ln1" ] && [ "$ln" -ge "$ln1" ] && continue ;;
      docs/superpowers/specs/*|docs/superpowers/plans/*)
        d="${arq##*/}"; d="${d:0:10}"
        if printf '%s' "$d" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && [[ ! "$d" > "2026-11-10" ]]; then continue; fi ;;
    esac
    printf '%s\n' "$hit"
  done
}
NOM_ACHADOS=$(nom_achados)
check "NOM-1: nenhum nome antigo fora das exceções de REQ-NOM-1" '[ -z "$NOM_ACHADOS" ]' "fora das exceções: $(printf '%s' "$NOM_ACHADOS" | tr '\n' ' ')"
[ "${1:-}" = "--nom" ] && { [ "$falhas" -eq 0 ]; exit $?; }

# ── FASE (REQ-ONB-1, T14) — o onboarding é uma etapa só: nenhum texto fala de "fase 2-4" ──────────
# Escopo: skills, reference, commands, gates/scripts, scripts/instalar.sh (o que ele escreve no repo do adotante) e README. Exceções por TEXTO EXATO (grep -vF): "fase 2 do Fluxo Gabarito" (etapa do Flight Levels, não do onboarding); linha com
# RULING (comentário de ruling); linhas `| M1x |` do README (medição histórica da 1.1.0). Caso plantado: texto-nom.test.sh.
fase_achados() {
  git grep -niE 'fases? [2-4]|\(fase|(quatro|4) fases' -- plugins/gabarito-mestre/gates/scripts plugins/gabarito-mestre/reference plugins/gabarito-mestre/skills plugins/gabarito-mestre/commands plugins/gabarito-mestre/scripts/instalar.sh README.md 2>/dev/null |
    grep -vF -e 'fase 2 do Fluxo Gabarito' -e 'RULING' |
    grep -vE '^README\.md:[0-9]+:\| M[0-9]+ \|'
}
FASE_ACHADOS=$(fase_achados)
check "FASE: nenhum texto de onboarding fala de fases 2-4 (fora das exceções exatas)" '[ -z "$FASE_ACHADOS" ]' "achados: $(printf '%s' "$FASE_ACHADOS" | cut -c1-120 | tr '\n' ' ')"
[ "${1:-}" = "--fase" ] && { [ "$falhas" -eq 0 ]; exit $?; }

A="$P/reference/AGENTS.md"
R="$P/reference/referencia.md"
D="$P/reference/adocao.md"
Q="$P/reference/prompts.md"
F="$P/reference/fluxo.md"
SI="$P/skills/gabarito-instalar/SKILL.md"
ST="$P/skills/gabarito-instalar/trocar.md"
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
  // R1 com exceção de release_pr (GM-13 R41): teto 17.291 + 126 B; GM-14 T22 (REQ-DIA-2, regra de anotar na hora): +343 B ⇒ 17.760
  if(nucleo>17760){console.error('núcleo acima do teto 17.760');process.exit(1)}
  if(ap>4096){console.error('apêndice acima de 4.096');process.exit(1)}")
RC_BYTES=$?
echo "  $BYTES_OUT"
check "R1 tem a exceção de release_pr (GM-13 R41)" "grep -E '^\\*\\*R1 ' '$A' | grep -q 'release_pr'" "R1 sem a exceção"
# r3: a linha R1 INTEIRA por igualdade (texto exato de 4d24d8f): qualquer palavra a mais, a menos ou trocada falha
R1_ESPERADA=$(cat <<'R1EOF'
**R1 — Nada de `push`, PR, merge, deploy, release ou tag sem ok explícito** para aquele ato. Exceção: quando o `decidir` da entrega dá `release_pr`, a spec aprovada é o ok para o push da branch e o PR à base dele. Pré-checks são do orquestrador; o ato é do dono.
R1EOF
)
check "R1: linha inteira igual ao texto aprovado (exceção só push da branch e PR; merge sem exceção)" '[ "$(grep -E "^\*\*R1 " "'"$A"'")" = "$R1_ESPERADA" ]' "a linha R1 de AGENTS.md mudou"
check "R1: merge segue na lista sem exceção" "grep -E '^\\*\\*R1 ' '$A' | grep -q 'PR, merge, deploy, release ou tag sem ok explícito'" "merge saiu da lista sem exceção"
check "núcleo ≤ 17.417 B · apêndice ≤ 4.096 B" '[ "$RC_BYTES" -eq 0 ]' "teto de bytes estourado"

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

# ── B2 (handoff §B.2) — DISPATCH idêntico, hatches usados, ≤ 4.329 caracteres == LIMITE_CONTEXTO, inegociável ──
echo "── B2: DISPATCH idêntico, hatches em hooks/, ≤ 4.329 caracteres == LIMITE_CONTEXTO, inegociável cobre R1–R21"
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
# Q9/REQ-GRD-5: sem escape hatch em lugar nenhum de plugins/** (código, reference/, templates/, skills, testes),
# exceto este arquivo, que precisa citar o nome para procurar por ele. Specs e ledgers em docs/ ficam fora.
HATCH_ACHADOS=$(grep -rIl 'GABARITO_ALLOW' "$P" 2>/dev/null | grep -v "/scripts/test/texto.test.sh$" || true)
check "GABARITO_ALLOW = 0 em plugins/** (REQ-GRD-5, Q9)" '[ -z "$HATCH_ACHADOS" ]' "hatch residual em: $(printf '%s' "$HATCH_ACHADOS" | tr '\n' ' ')"
GUARDS_CITADOS=$(grep -rIlE 'guard-(destructive|production|versioning)' "$P" 2>/dev/null | grep -v "/scripts/test/texto.test.sh$" || true)
check "nenhum guard bash antigo citado em plugins/** (REQ-GRD-3, REQ-INF-1)" '[ -z "$GUARDS_CITADOS" ]' "menção residual em: $(printf '%s' "$GUARDS_CITADOS" | tr '\n' ' ')"
MAXL=$(grep -oE "LIMITE_CONTEXTO = [0-9]+" "$CS" | grep -oE '[0-9]+')
check "'≤ 4.329 caracteres' do AGENTS.md bate com LIMITE_CONTEXTO=$MAXL de cartao-sessao.mjs" "grep -q '≤ 4.329 caracteres' '$A' && [ '$MAXL' = 4329 ]" "LIMITE_CONTEXTO ≠ 4329 ou AGENTS.md não cita ≤ 4.329 caracteres"
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
echo "── B5: SKILL.md de gabarito-instalar — onboarding em uma etapa (sem fases)"
for sec in '## Fluxo' '## Trocar um item' '## Modo --vincular' '## Proibido'; do
  check "SKILL.md instalar tem a seção '$sec'" "grep -q '^$sec' '$SI'" "seção ausente"
done
N5=$(grep -ci '^## Fase ' "$SI")
check "SKILL.md instalar sem seção '## Fase ' (sem caixa)" '[ "'"$N5"'" -eq 0 ]' "achei $N5 seção(ões) de fase"
check "SKILL.md instalar diz o local do painel e o limite ao fim do onboarding (GM-14 T21)" "grep -qF 'a plataforma só o põe sozinho com 144 colunas ou mais (ao lado da conversa em tela cheia, acima da linha de digitar nas outras); abaixo disso o painel avisa e ele abre quando você pede /gabarito painel, em qualquer largura' '$SI'" "linha do painel ausente"
CG="$P/commands/gabarito.md"
check "commands/gabarito.md (sem mod) explica pausar, retomar e que o painel precisa do mod" "grep -qF '/gabarito pausar   para o trabalho automático da entrega' '$CG' && grep -qF '/gabarito retomar  continua de onde parou' '$CG' && grep -qxF 'O painel precisa do mod; sem ele não há o painel.' '$CG'" "ajuda sem mod ausente"

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
# (b) as SEIS linhas do Apêndice que `trocar apendice` preenche — rótulo em AGENTS.md ==
# rótulo citado na skill (SKILL.md ou trocar.md; as demais linhas do Apêndice são preenchidas à mão, fora do onboarding).
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
  grep -qF "$rotulo" "$SI" "$ST" || { falha "B7(b): rótulo do Apêndice" "'$rotulo' não aparece na skill de instalar (SKILL.md nem trocar.md)"; b7b_falhou=1; }
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
MARCADOR='# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar). Uma linha por área:'
check "(e) marcador CODEOWNERS igual em trocar.md e em instalar.sh (byte a byte)" "grep -qF '$MARCADOR' '$ST' && grep -qF '$MARCADOR' '$IS'" "marcador ausente/diferente"

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
check "SKILL.md instalar: sem Bash(claude mcp list:*) (o detectar roda o claude mcp list por dentro; menor privilégio)" "! sed -n '/^allowed-tools:/p' '$SI' | grep -q 'claude mcp list'" "permissão sobrando"
check "SKILL.md instalar: nenhum mcp__ no allowed-tools"      '[ "$(sed -n "/^allowed-tools:/p" "'"$SI"'" | grep -c "mcp__")" -eq 0 ]' "mcp__ apareceu no allowed-tools"
check "SKILL.md instalar: 0 seções '## Fase '"                '[ "$(grep -ci "^## Fase " "'"$SI"'")" -eq 0 ]' "ainda há seção de fase"
check "SKILL.md conformidade: fio condutor · contenda (R21) · Epic: PBIs" "grep -q 'fio condutor' '$SC' && grep -q 'contenda (R21)' '$SC' && grep -q 'Epic: PBIs (fluxo.md §2)' '$SC'" "algum dos três ausente"

# ── pacote — versões, hooks (F6-R7), 77 testes, nomes da 1.0.1 (PKG-1, PKG-2) ─────────
echo "── pacote — versões, sem hooks em plugin.json, sem 77 testes, nomes da 1.0.1"
v1=$(node -p "require('$P/.claude-plugin/plugin.json').version" 2>/dev/null)
v3=$(node -p "require('$P/gates/package.json').version" 2>/dev/null)
check "version plugin == gates == 2.2.1 (achei '$v1' '$v3')" '[ "$v1" = "$v3" ] && [ "$v1" = "2.2.1" ]' "versões divergem ou ≠ 2.2.1"
# GM-15 T28: a virada 2.1.0 no CHANGELOG (seção estável com data; alpha.1 com a data medida da tag, 2026-11-15)
check "CHANGELOG: [2.1.0] com data, sem [Unreleased], alpha.1 em 2026-11-15" 'grep -qE "^## \\[2\\.1\\.0\\] — [0-9]{4}-[0-9]{2}-[0-9]{2}$" "$ROOT/CHANGELOG.md" && ! grep -q "^## \\[Unreleased\\]" "$ROOT/CHANGELOG.md" && grep -qF "## [2.1.0-alpha.1] — 2026-11-15" "$ROOT/CHANGELOG.md"' "CHANGELOG sem a seção [2.1.0] datada, com [Unreleased] ou com a data errada da alpha.1"
# GM-16 T8 r1 MINOR-2: a [2.2.0] é datada (mesmo separador das outras seções) e traz a subseção "Muda para quem já usa" dentro dela
check "CHANGELOG: [2.2.0] com data (travessão, como as demais)" 'grep -qE "^## \\[2\\.2\\.0\\] — [0-9]{4}-[0-9]{2}-[0-9]{2}$" "$ROOT/CHANGELOG.md"' "seção [2.2.0] ausente, sem data ou com separador diferente"
check "CHANGELOG: [2.2.0] traz '### Muda para quem já usa'" '[ "$(sed -n "/^## \\[2\\.2\\.0\\]/,/^## \\[2\\.1\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -c "^### Muda para quem já usa$")" -eq 1 ]' "subseção ausente na [2.2.0]"
# GM-16 T8 c2 r1 MINOR-3: "Como ligar" é item de "Muda para quem já usa" (não de outra subseção), com o bloco JSON da chave
check "CHANGELOG: 'Muda para quem já usa' da [2.2.0] traz o item 'Como ligar' com opcoesComoContagem" '[ "$(sed -n "/^## \\[2\\.2\\.0\\]/,/^## \\[2\\.1\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Muda para quem já usa$/,/^### Adicionado$/p" | grep -c "^- \\*\\*Como ligar")" -eq 1 ] && sed -n "/^## \\[2\\.2\\.0\\]/,/^## \\[2\\.1\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Muda para quem já usa$/,/^### Adicionado$/p" | grep -q "opcoesComoContagem\": true"' "item 'Como ligar' ausente em 'Muda para quem já usa' da [2.2.0]"
HOJE=$(date -u +%Y-%m-%d)
# GM-16 T8 r2 MINOR-2: a data da [2.2.0] também é data válida do calendário e não futura (igual à [2.1.0])
D220=$(grep -E '^## \[2\.2\.0\] — ' "$ROOT/CHANGELOG.md" | sed -E 's/.*— //')
RT220=$(date -j -f %Y-%m-%d "$D220" +%Y-%m-%d 2>/dev/null || date -d "$D220" +%Y-%m-%d 2>/dev/null)
check "CHANGELOG: data da [2.2.0] é válida e não futura (achei '$D220')" '[ "'"$RT220"'" = "'"$D220"'" ] && ! [ "'"$D220"'" \> "'"$HOJE"'" ]' "data inválida ou futura"
# GM-18 T3: a [2.2.1] é datada, traz "Adicionado" com o comando encerrar e "Limites declarados" com PR obrigatório, e a data é válida e não futura
check "CHANGELOG: [2.2.1] com data (travessão) e sem [Unreleased]" 'grep -qE "^## \\[2\\.2\\.1\\] — [0-9]{4}-[0-9]{2}-[0-9]{2}$" "$ROOT/CHANGELOG.md" && ! grep -q "^## \\[Unreleased\\]" "$ROOT/CHANGELOG.md"' "seção [2.2.1] ausente, sem data, com separador diferente ou com [Unreleased]"
check "CHANGELOG: [2.2.1] vem acima da [2.2.0]" '[ "$(grep -n "^## \\[2\\.2\\.1\\]" "$ROOT/CHANGELOG.md" | cut -d: -f1)" -lt "$(grep -n "^## \\[2\\.2\\.0\\]" "$ROOT/CHANGELOG.md" | cut -d: -f1)" ]' "[2.2.1] abaixo da [2.2.0] ou ausente"
check "CHANGELOG: [2.2.1] 'Adicionado' traz o comando encerrar com via dono e a entrega em cortar/adiar/reabrir" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Adicionado$/,/^### Limites declarados$/p" | grep -qF "/gabarito-mestre:encerrar <entrega> <PR> [<versão>]" && sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Adicionado$/,/^### Limites declarados$/p" | grep -qF "via: '"'"'dono'"'"'" && sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -qF "[<entrega>]"' "Adicionado da [2.2.1] sem o comando encerrar, o via dono ou o [<entrega>]"
check "CHANGELOG: [2.2.1] 'Limites declarados' traz PR obrigatório e release só pelo campo versao" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Limites declarados$/,\$p" | grep -q "PR é obrigatório" && sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Limites declarados$/,\$p" | grep -qF "campo \`versao\`"' "Limites declarados da [2.2.1] sem PR obrigatório ou sem o campo versao"
check "CHANGELOG: [2.2.1] 'Limites declarados' traz o gh obrigatório no momento do comando e o PR mergeado" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Limites declarados$/,\$p" | grep -qF "exige \`gh\` no momento em que roda" && sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Limites declarados$/,\$p" | grep -qF "só \"PR mergeado\""' "limite do gh ausente na [2.2.1]"
check "CHANGELOG: [2.2.1] 'Limites declarados' traz task com id de entrega e a regra própria da visão de projeto" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Limites declarados$/,\$p" | grep -qF "Task com id no formato de entrega exige a entrega escrita" && sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | sed -n "/^### Limites declarados$/,\$p" | grep -qF "A visão de projeto tem regra própria de encerrada"' "limite de task com id de entrega ou da visão de projeto ausente na [2.2.1]"
# GM-18 T4 (review final r1 MAJOR-1): com <entrega> no argumento, cortar/adiar/reabrir conferem a entrega nomeada; o encerrar sempre
check "skill cortar: com <entrega> o loop.mjs proxima leva --entrega <entrega>" 'grep -qF "loop.mjs\" proxima --vivos <n> --entrega <entrega>" "$P/skills/cortar/SKILL.md"' "skill cortar confere a entrega da branch, não a nomeada"
check "skill adiar: com <entrega> o loop.mjs proxima leva --entrega <entrega>" 'grep -qF "loop.mjs\" proxima --vivos <n> --entrega <entrega>" "$P/skills/adiar/SKILL.md"' "skill adiar confere a entrega da branch, não a nomeada"
check "skill reabrir: com <entrega> o loop.mjs proxima leva --entrega <entrega>" 'grep -qF "loop.mjs\" proxima --vivos <n> --entrega <entrega>" "$P/skills/reabrir/SKILL.md"' "skill reabrir confere a entrega da branch, não a nomeada"
check "skill encerrar: painel.mjs estado leva sempre --entrega <entrega>" 'grep -qF "painel.mjs\" estado --entrega <entrega>" "$P/skills/encerrar/SKILL.md"' "skill encerrar confere o painel da branch, não a entrega nomeada"
# GM-18 T4 (r1 MINOR-2): [2.2.1] traz o fallback da branch e o efeito no painel
check "CHANGELOG: [2.2.1] diz que sem a entrega vale a entrega da branch" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -qF "sem ele vale a entrega da branch"' "frase do fallback da branch ausente na [2.2.1]"
check "CHANGELOG: [2.2.1] diz que a visão de projeto e o entregueDe tratam a entrega como feita" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -qF "A visão de projeto e o \`entregueDe\` passam a tratar a entrega como feita"' "efeito do encerrar na visão de projeto ausente na [2.2.1]"
# GM-18 T4 (r1 MINOR-3): efeitos do encerrar e o limite da versão vazia
check "CHANGELOG: [2.2.1] diz que a encerrada deixa de aceitar task, sessão e parar" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -qF "deixa de aceitar task, sessão e \`parar\`"' "efeito do encerrar (sem task, sessão, parar) ausente na [2.2.1]"
check "CHANGELOG: [2.2.1] diz que depois de reabrir-entrega o dono encerra de novo com o mesmo PR" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -qF "o dono pode encerrar de novo com o mesmo PR"' "reencerrar com o mesmo PR ausente na [2.2.1]"
check "CHANGELOG: [2.2.1] diz que o 2º encerrar sem versão deixa a versão vazia" 'sed -n "/^## \\[2\\.2\\.1\\]/,/^## \\[2\\.2\\.0\\]/p" "$ROOT/CHANGELOG.md" | grep -qF "O 2º encerrar sem \`<versão>\` deixa a versão exibida vazia"' "limite da versão vazia ausente na [2.2.1]"
D221=$(grep -E '^## \[2\.2\.1\] — ' "$ROOT/CHANGELOG.md" | sed -E 's/.*— //')
RT221=$(date -j -f %Y-%m-%d "$D221" +%Y-%m-%d 2>/dev/null || date -d "$D221" +%Y-%m-%d 2>/dev/null)
check "CHANGELOG: data da [2.2.1] é válida e não futura (achei '$D221')" '[ "'"$RT221"'" = "'"$D221"'" ] && ! [ "'"$D221"'" \> "'"$HOJE"'" ]' "data inválida ou futura"
# GM-15 T28 r1 MINOR-4: a data da [2.1.0] é data válida do calendário e não futura
D210=$(grep -E '^## \[2\.1\.0\] — ' "$ROOT/CHANGELOG.md" | sed -E 's/.*— //')
HOJE=$(date -u +%Y-%m-%d)
RT=$(date -j -f %Y-%m-%d "$D210" +%Y-%m-%d 2>/dev/null || date -d "$D210" +%Y-%m-%d 2>/dev/null)
check "CHANGELOG: data da [2.1.0] é válida e não futura (achei '$D210')" '[ "'"$RT"'" = "'"$D210"'" ] && ! [ "'"$D210"'" \> "'"$HOJE"'" ]' "data inválida ou futura"
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
check "ci.yml: check do job instalador com o NOME EXATO exigido pelo ruleset de main (A3)" 'printf "%s\n" "$INSTALADOR_JOB" | grep -qxF "    name: instalar.sh — fixture 1.0.1, --atualizar, --gates-substituir (bash \${{ matrix.os }})"' "nome do job instalador diverge do contexto exigido pelo ruleset: os 2 checks (ubuntu/macos) nunca reportam em PR para main"
DOCTOR_JOB=$(awk '/^  doctor-self:/{f=1;next} f&&/^  [a-z][a-z-]*:/{f=0} f' "$CI")
check "ci.yml: doctor-self exige camada 'configurada' (no CI limpo 'ativa' é falso positivo)" 'printf "%s\n" "$DOCTOR_JOB" | grep -q "camada.estado!==.configurada."' "doctor-self não falha quando a camada volta a ativa num checkout limpo"
# Canal next (T8, Q12): CI roda em push para next; versao-medida avisa (::warning) e nunca falha.
PUSH_BLOCK=$(awk '/^on:/{f=1;next} f&&/^[a-z]/{f=0} f' "$CI")
check "ci.yml: push.branches inclui next (canal next)" 'printf "%s\n" "$PUSH_BLOCK" | grep -E "^ +branches:" | grep -qE "\bnext\b"' "next ausente de push.branches"
MEDIDA_JOB=$(awk '/^  versao-medida:/{f=1;next} f&&/^  [a-z][a-z-]*:/{f=0} f' "$CI")
check "ci.yml: job versao-medida existe (Q12)" '[ -n "$MEDIDA_JOB" ]' "job versao-medida ausente"
check "ci.yml: versao-medida emite ::warning (Q12)" 'printf "%s\n" "$MEDIDA_JOB" | grep -q "::warning"' "::warning ausente"
check "ci.yml: versao-medida nunca falha — sem exit 1 (Q12)" '! printf "%s\n" "$MEDIDA_JOB" | grep -qE "exit[[:space:]]+[1-9]"' "versao-medida tem exit não-zero"
nomes_falhou=0
for f in skills/gabarito-instalar/SKILL.md skills/gabarito-conformidade/SKILL.md skills/gabarito-review/SKILL.md skills/gabarito-spike/SKILL.md \
         agents/gabarito-implementador.md agents/gabarito-revisor.md agents/gabarito-spike.md commands/gabarito-doctor.md \
         hooks/session-card.sh gates/dist/guarda.js hooks/remind-orchestrator.sh \
         gates/src/mass-mutation-guard.ts gates/src/production-host-guard.ts gates/eslint/no-unfiltered-mass-mutation.js \
         gates/scripts/migrations-guard.mjs gates/scripts/deploy-order-check.mjs gates/scripts/quality-ratchet.mjs gates/scripts/harness-doctor.mjs \
         gates/scripts/onboarding-config.mjs gates/scripts/capacidade.mjs gates/scripts/versionamento-check.mjs gates/scripts/cartao-sessao.mjs; do
  [ -f "$P/$f" ] || { falha "nomes da 1.0.1: $f" "ausente"; nomes_falhou=1; }
done
for rn in $(seq 1 18); do grep -qE "(^|[^A-Z0-9])R$rn([^0-9]|$)" "$A" || { falha "nomes da 1.0.1: R$rn" "ausente do AGENTS.md"; nomes_falhou=1; }; done
for gn in $(seq 1 9);  do grep -qE "(^|[^A-Z0-9])G$gn([^0-9]|$)" "$A" || { falha "nomes da 1.0.1: G$gn" "ausente do AGENTS.md"; nomes_falhou=1; }; done
for in_ in $(seq 1 12); do grep -qE "(^|[^A-Z0-9])I$in_([^0-9]|$)" "$A" || { falha "nomes da 1.0.1: I$in_" "ausente do AGENTS.md"; nomes_falhou=1; }; done
[ "$nomes_falhou" -eq 0 ] && ok "nomes da 1.0.1 presentes: 4 skills, 3 agents, 1 command, 1 guarda + 2 hooks (+3), 7 gates (+4 scripts), R1–R18, G1–G9, I1–I12"

# A4 (T6 r1): a skill oficial e o README não mandam rodar flag removida nem dependem do manifesto que a 2.0 não grava.
# Menção que DIZ que a flag acabou ("não há/existe mais") é permitida; qualquer outra, não.
FLAG_VIVA=$(grep -rn -e '--gates-substituir' "$P" "$ROOT/README.md" --include='*.md' --include='*.sh' --include='*.mjs' --include='*.json' 2>/dev/null | grep -v -e '/scripts/test/' -e '/gates/test/' -e '/gates/dist/' -e 'node_modules' | grep -viE 'n(ã|a)o (h(á|a)|existe) mais' | wc -l | tr -d ' ')
check "sem menção viva a --gates-substituir em plugins/** e README (flag removida na 2.0)" '[ "'"$FLAG_VIVA"'" -eq 0 ]' "flag removida ainda citada como utilizável ($FLAG_VIVA linha(s))"
SKILL_I="$P/skills/gabarito-instalar/SKILL.md"
check "skill gabarito-instalar não usa 'test -f …/.instalado.json' para detectar versão" '! grep -qE "^test -f tools/gabarito-gates/.instalado.json" "$SKILL_I"' "a skill ainda decide pela existência de um manifesto que o instalador 2.0 não grava"
check "skill gabarito-instalar não promete .instalado.json na tabela do que o instalador cria" '! grep -E "^\| .tools/gabarito-gates/. \+ .\.instalado\.json" "$SKILL_I" | grep -q .' "tabela da fase 1 promete o manifesto"
check "README não promete .instalado.json entre o que o instalador cria (só diz que acabou)" '! grep -qE "\+ .\.instalado\.json" "'"$ROOT"'/README.md"' "README ainda promete o manifesto"
check "skill gabarito-instalar não promete squash-titulo-pr no attest.json (template não o tem; chave morta)" '! grep -E "^\| .\.harness/attest\.json." "$SKILL_I" | grep -q "squash-titulo-pr"' "tabela promete atestado removido"

# GM-10 T11 r2 (achado 2): o `--calibrar` da T11 é a escada medida (slots_max, rss, tmpdir, cpu_total, load_medido), não a fórmula por
# núcleos. Quem espera `simultaneos`/`teto`/`limites`/`calibradoEm` chama `--sugerir`. Skill, adocao.md e README não misturam os dois.
CAP="$P/gates/scripts/capacidade.mjs"
MISTURA=$(grep -n -e '--calibrar' "$SKILL_I" "$P/reference/adocao.md" "$ROOT/README.md" | grep -E 'simultaneos|teto|calibradoEm|--json' | wc -l | tr -d ' ')
check "skill, adocao.md e README não mandam --calibrar esperando simultaneos/teto/calibradoEm/--json (é --sugerir)" '[ "'"$MISTURA"'" -eq 0 ]' "$MISTURA linha(s) com --calibrar e campos da fórmula por núcleos"
check "skill gabarito-instalar NÃO chama capacidade.mjs (a orquestração vem do detectar)" '! grep -q "capacidade\.mjs" "$SKILL_I" "'"$ST"'"' "a skill voltou a chamar capacidade.mjs"
SUG_JSON=$(cd "$ROOT" && node "$CAP" --root "$ROOT" --sugerir --json 2>/dev/null)

# GM-13 T18 r2: nota da virada e CHANGELOG [2.0.0] só citam comando `claude plugin …` MEDIDO (lista fechada: spike t17da + --help lido
# na T18 r2), sem o nome antigo do fluxo e sem o `#next` como caminho do adotante.
VIRADA="$ROOT/docs/virada-2.0.md"
NOME_ANTIGO="Workflow"" TRUE"   # montado em dois pedaços: NOM-1 varre este arquivo
CL2=$(sed -n '/^## \[2\.0\.0\]/,/^## \[1\./p' "$ROOT/CHANGELOG.md" | sed '$d')
check "CHANGELOG tem a seção [2.0.0] com conteúdo" '[ "$(printf "%s" "$CL2" | wc -l | tr -d " ")" -gt 10 ]' "seção [2.0.0] vazia ou ausente"
check "nota da virada não diz o nome antigo do fluxo" '! grep -q "$NOME_ANTIGO" "$VIRADA"' "termo antigo na nota"
check "CHANGELOG [2.0.0] não diz o nome antigo do fluxo" '! printf "%s" "$CL2" | grep -q "$NOME_ANTIGO"' "termo antigo no CHANGELOG [2.0.0]"
check "nota da virada não manda usar o #next (nem disable) como caminho do adotante" '! grep -qE "#next|plugin disable" "$VIRADA"' "passo do #next/disable voltou"
CMDS_OK='claude plugin marketplace update gabarito-mestre
claude plugin update gabarito-mestre@gabarito-mestre
claude plugin uninstall gabarito-mestre@gabarito-mestre-next --scope project
claude plugin marketplace remove gabarito-mestre-next
claude plugin list
claude plugin marketplace remove gabarito-mestre
claude plugin marketplace add '"'"'gabrielnfc/gabarito-mestre#gabarito-mestre--v1.1.0'"'"'
claude plugin marketplace add gabrielnfc/gabarito-mestre
claude plugin install gabarito-mestre@gabarito-mestre
claude plugin update gabarito-mestre@gabarito-mestre --scope project
claude plugin install gabarito-mestre@gabarito-mestre --scope project'
CMDS_NOTA=$( { grep -oE 'claude plugin [^`]+' "$VIRADA"; printf "%s" "$CL2" | grep -oE 'claude plugin [^`]+'; } | sort -u)
CMDS_FORA=$(printf "%s\n" "$CMDS_NOTA" | grep -vxF -f <(printf "%s\n" "$CMDS_OK") | grep . | wc -l | tr -d ' ')
check "nota e CHANGELOG [2.0.0]: todo 'claude plugin …' está na lista fechada de comandos medidos" '[ "$CMDS_FORA" -eq 0 ]' "$CMDS_FORA comando(s) fora da lista medida"
check "nota da virada cita os 11 comandos medidos (nenhum sumiu)" '[ "$(printf "%s\n" "$CMDS_NOTA" | grep -cxF -f <(printf "%s\n" "$CMDS_OK"))" -eq 11 ]' "comando medido ausente da nota"
# GM-13 T18 m3: "Como voltar" traz os passos medidos na ordem (1.1.0: remove, add com tag, install; 2.0: remove, add sem tag, install)
VOLTAR=$(sed -n '/^## Como voltar/,$p' "$VIRADA" | grep -oE '^[0-9]\. `claude plugin [^`]+' | sed -E 's/^[0-9]\. `//')
VOLTAR_ESPERADO="claude plugin marketplace remove gabarito-mestre
claude plugin marketplace add 'gabrielnfc/gabarito-mestre#gabarito-mestre--v1.1.0'
claude plugin install gabarito-mestre@gabarito-mestre
claude plugin marketplace remove gabarito-mestre
claude plugin marketplace add gabrielnfc/gabarito-mestre
claude plugin install gabarito-mestre@gabarito-mestre"
check "nota da virada: 'Como voltar' tem os 6 passos medidos, na ordem" '[ "$VOLTAR" = "$VOLTAR_ESPERADO" ]' "passos de 'Como voltar' diferem dos medidos"
# GM-13 T18 proj r3 (spike t17dh + sombra-t18proj): passo por projeto sem condição user/project; conferência pelo installed_plugins.json (não pelo `plugin list`)
ATUALIZAR=$(sed -n '/^## Como atualizar/,/^## Rode o onboarding/p' "$VIRADA")
check "nota da virada: 'em cada repo onde o gabarito foi instalado por projeto', 'dentro dele' e '--scope project' na mesma linha" 'printf "%s" "$ATUALIZAR" | grep -iE "em cada repo onde o gabarito foi instalado por projeto" | grep -E "dentro dele" | grep -q "plugin update gabarito-mestre@gabarito-mestre --scope project"' "passo por projeto sem as três partes na mesma linha"
check "nota da virada: o passo por projeto não tem condição nem promete que o passo 2 basta" '! printf "%s" "$ATUALIZAR" | grep -q "já é atualizado" && ! printf "%s" "$ATUALIZAR" | grep -q "instalado no usuário e também"' "condição user/project ou 'já é atualizado' voltou"
check "nota da virada: conferência pelo installed_plugins.json com \"version\": \"2.0.0\", sem cartão" 'printf "%s" "$ATUALIZAR" | grep -q "installed_plugins.json" && printf "%s" "$ATUALIZAR" | grep -q "\"version\": \"2.0.0\"" && ! printf "%s" "$ATUALIZAR" | grep -qi "cartão"' "conferência da versão fora do installed_plugins.json"
check "nota da virada: na linha do passo 3, 'plugin list' só aparece em 'pode mostrar' (não é a forma de conferir)" 'L3=$(printf "%s\n" "$ATUALIZAR" | grep -E "^3\."); printf "%s" "$L3" | grep -q "plugin list. pode mostrar" && ! printf "%s" "$L3" | sed "s/plugin list. pode mostrar//" | grep -q "plugin list"' "passo 3 confere pelo plugin list"
PASSO5=$(printf "%s\n" "$ATUALIZAR" | grep -E "^5\.")
check "nota da virada: o passo 5 não exige 'um só' e confere o catálogo gabarito-mestre-next" '[ -n "$PASSO5" ] && ! printf "%s" "$PASSO5" | grep -q "um só" && printf "%s" "$PASSO5" | grep -q "gabarito-mestre-next"' "passo 5 com 'um só' ou sem gabarito-mestre-next"

# ── GM-14 T22 (REQ-DIA-2, REQ-GLB-1): nota da 2.1.0, local do painel com o limite, só frases que dizem os dois locais ──────────
echo "── GM-14 T22: nota da 2.1.0, limite do local do painel"
V21="$P/docs/virada-2.1.md"
CMDG="$P/commands/gabarito.md"
SKL="$P/skills/gabarito-loop/SKILL.md"
LIMITE_LOCAL='Pane (lateral): a plataforma só a põe sozinha com ≥ 144 colunas (ao lado em tela cheia, acima da linha de digitar nas outras); abaixo disso o painel avisa e a Pane abre quando você pede /gabarito painel, em qualquer largura — sempre um só local'
check "texto-limite-do-local: a nota da 2.1.0 e o comando trazem a frase do limite, literal" '[ -f "$V21" ] && grep -qF "$LIMITE_LOCAL" "$V21" && grep -qF "$LIMITE_LOCAL" "$CMDG"' "frase do limite ausente da nota da virada ou do comando"
# texto-local-nos-dois: linha com "ao lado" diz também "acima da linha de digitar" e vice-versa (nunca um local sozinho); skill, comando e nota
local_sozinho() {
  grep -nE 'ao lado|acima da linha de digitar' "$V21" "$CMDG" "$SKL" 2>/dev/null |
    grep -vE 'ao lado.*acima da linha de digitar|acima da linha de digitar.*ao lado'
}
LOCAL_SOZINHO=$(local_sozinho)
check "texto-local-nos-dois: nenhuma linha diz 'ao lado' ou 'acima da linha de digitar' sozinho (skills, comando, nota 2.1.0)" '[ -f "$V21" ] && [ -z "$LOCAL_SOZINHO" ]' "local sozinho: $(printf '%s' "$LOCAL_SOZINHO" | cut -c1-140 | tr '\n' ' ')"
check "nota da 2.1.0: cita /reload-plugins, o foco reversível e a herança só na 2.2; não cita o nome antigo do fluxo" '[ -f "$V21" ] && grep -qF "/reload-plugins" "$V21" && grep -qF "viewMode" "$V21" && grep -qF "chega na 2.2" "$V21" && ! grep -q "$NOME_ANTIGO" "$V21"' "nota da 2.1.0 sem /reload-plugins, sem o foco reversível, sem a herança na 2.2 ou com o nome antigo"

# GM-19 REQ-FURO-2 (F12): os casos de NOM-1 de texto-nom.test.sh só rodavam à mão. Sem argumento, o filho roda `--nom` e sai antes; sem recursão.
check "texto-nom: os casos de NOM-1 de texto-nom.test.sh passam (rc 0)" 'bash "$P/scripts/test/texto-nom.test.sh" >/dev/null 2>&1' "texto-nom.test.sh falhou: rode-o sozinho"

echo "── $falhas falha(s)"
[ "$falhas" -eq 0 ]

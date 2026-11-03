#!/usr/bin/env bash
# gabarito-mestre · regras-subagent.sh — implementa a Q27 (regras obrigatórias injetadas em todo subagent, GM-9).
# SubagentStart, sem matcher, timeout 5. Devolve `hookSpecificOutput.additionalContext` com
# `reference/regras-subagent.md` do plugin + `<raiz>/.harness/regras-subagent.md` (se existir), ≤ 2.000 caracteres
# somados (trunca em limite de caractere e avisa no próprio texto). <raiz> = CLAUDE_PROJECT_DIR (raiz da sessão, Q14:
# nunca o cwd, que em worktree de subagent segue o worktree), fallback gabarito_repo_root. Lido da árvore local, não de
# `origin`: a regra é instrução, nenhum veredito da guarda depende dela (D2 não se aplica).
# O arquivo do projeto só vale se for arquivo regular, NÃO symlink, com `.harness` também fora de symlink (o texto vai
# ao modelo: symlink para `.env` seria exfiltração). Leitura limitada em bytes; nada é executado nem expandido (sem eval).
# Nunca bloqueia: qualquer falha é FAIL-OPEN DECLARADO (stderr, exit 0, sem stdout) — o subagent segue sem as regras.
set -u
. "$(dirname "$0")/_common.sh"
cat >/dev/null 2>&1 || true   # drena o stdin (JSON de SubagentStart); não é lido

ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then ROOT=$(gabarito_repo_root); fi
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PADRAO="$PLUGIN_ROOT/reference/regras-subagent.md"

if ! command -v node >/dev/null 2>&1; then
  echo "gabarito-mestre: node ausente — regras de subagent não injetadas (fail-open declarado, G9)" >&2
  exit 0
fi
if [ ! -f "$PADRAO" ]; then
  echo "gabarito-mestre: $PADRAO ausente — regras de subagent não injetadas (fail-open declarado, G9)" >&2
  exit 0
fi

SAIDA=$(node -e '
const fs = require("fs"), path = require("path");
const TETO = 2000, LER = 16384;
const [padraoArq, raiz] = process.argv.slice(1);
const padrao = fs.readFileSync(padraoArq, "utf8").trimEnd();
let projeto = "";
try {
  const dir = path.join(raiz, ".harness");
  const arq = path.join(dir, "regras-subagent.md");
  const dl = fs.lstatSync(dir);
  const st = fs.lstatSync(arq);
  // .harness e o arquivo: nada de symlink
  if (!dl.isSymbolicLink() && dl.isDirectory() && st.isFile() && !st.isSymbolicLink()) {
    const fd = fs.openSync(arq, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    try {
      const buf = Buffer.alloc(LER);
      const n = fs.readSync(fd, buf, 0, LER, 0);
      projeto = buf.subarray(0, n).toString("utf8").replace(/\uFFFD+$/, "").trim();
    } finally { fs.closeSync(fd); }
  }
} catch (e) { projeto = ""; }
let texto = padrao;
if (projeto) texto += "\n\nRegras do projeto (.harness/regras-subagent.md):\n" + projeto;
const aviso = "\n[texto truncado em " + TETO + " caracteres pelo hook regras-subagent]";
const cps = Array.from(texto);
if (cps.length > TETO) texto = cps.slice(0, TETO - Array.from(aviso).length).join("").trimEnd() + aviso;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: texto } }) + "\n");
' "$PADRAO" "$ROOT" 2>/dev/null)
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "gabarito-mestre: regras-subagent saiu com $STATUS — regras de subagent não injetadas (fail-open declarado, G9)" >&2
  exit 0
fi
case "$SAIDA" in
  '{'*'}') printf '%s\n' "$SAIDA" ;;
  '') ;;
  *) echo "gabarito-mestre: regras-subagent devolveu saída que não é JSON — regras não injetadas (fail-open declarado, G9)" >&2 ;;
esac
exit 0

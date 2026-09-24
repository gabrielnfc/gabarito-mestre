# Gabarito Mestre 1.1.0 — Fase 3: Hooks (T12–T16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a camada de hooks da 1.1.0: `_common.sh` generalizado (escape hatch por nome de variável, raiz do repo, leitura de `harness.config.json`), o guard de versionamento R20 (`guard-versioning.sh`), o cartão de sessão (`session-card.sh`), o lembrete R21 por prompt (`remind-orchestrator.sh`) e o `hooks.json` que os registra — tudo em bash 3.2, testado por `guards.test.mjs` contra os scripts reais, sem quebrar o comportamento medido dos dois guards atuais.

**Architecture:** Hooks bash finos chamam os scripts Node da Fase 2 (`cartao-sessao.mjs`, `capacidade.mjs`) e leem `harness.config.json` por `jq → node → python3`. Quem decide conteúdo é Node; o hook resolve raiz, delimita, embala JSON e decide bloquear/passar. `guard-versioning.sh` é a exceção: valida sozinho, por `grep -E`/`sed -E`/`awk`, porque precisa responder em ≤ 10 s sem subir Node. Fail-open declarado em toda ausência de config, parser ou script.

**Tech Stack:** bash 3.2 (macOS) e bash 5 (ubuntu, CI) — sem `mapfile`, sem `declare -A`, sem `${var,,}`; `grep -E`, `sed -E`, `awk` (BSD e GNU); Node ≥ 22.18 só para os testes (`node --test`) e para os scripts chamados. Zero dependências.

**Branch:** `enabler/GM-3-hooks` (a partir de `main` com a Fase 2 integrada). **Ledger:** `docs/ledgers/GM-3.md`. **Commits:** Conventional Commits com escopo `GM-3` (`feat(GM-3): …`).

**Fontes que o executor lê antes de cada task:**
- Plano-mestre `docs/superpowers/plans/2026-09-24-workflow-true-1.1.0.md` — "Contrato de interfaces" (Config, Scripts, **Hooks — nomes, eventos, saída**), "Global Constraints", "Review Focus" 1 e 2.
- Spec `docs/superpowers/specs/2026-09-24-workflow-true-design.md` — REQ-VER-2 (l.151–153), REQ-ORQ-3 (l.187–188), REQ-ORQ-4 (l.190–191), fatos M5 (l.17) e M11 (l.23).
- Código: `plugins/gabarito-mestre/hooks/_common.sh`, `guard-destructive.sh`, `guard-production.sh`, `hooks.json`, `test/guards.test.mjs`, `test/corpus/*.txt`; `README.md` do repo, seção "Hooks — o que bloqueiam, e os números" (formato de bloqueio em três camadas: frase → o que fazer → regra citada; escape hatch medido M5).

---

## Pré-condições de rollout

- [ ] Fase 2 integrada em `main`: existem `plugins/gabarito-mestre/gates/scripts/cartao-sessao.mjs` (T9) e `capacidade.mjs` (T6) com as CLIs do contrato (`--root`, `--plugin-root`, `--json`). Os testes desta fase usam scripts **falsos** em tmpdir e não dependem deles, mas o smoke opcional de T14 os usa quando presentes.
- [ ] `git checkout -b enabler/GM-3-hooks` a partir de `main`. Este repositório **não** é onboarded (não há `harness.config.json` na raiz): o `guard-versioning.sh` fica fail-open aqui e a convenção é seguida à mão.
- [ ] `docs/ledgers/GM-3.md` criado com o cabeçalho **novo** de `plugins/gabarito-mestre/reference/referencia.md §2.3` (formato da Fase 4, T18): primeira linha `# Ledger — PBI: GM-3 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-3-hooks.md   Branch: enabler/GM-3-hooks @ <sha>   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md`, seguida de `## LER PRIMEIRO — <AAAA-MM-DD>` (≤ 5 linhas), `## Pre-flight — pares produz × consome`, `## Progresso`, `## CORTE DA SESSÃO (com motivo)`, `## FECHO — PR mergeada`.
- [ ] `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs` verde antes de tocar em qualquer arquivo (linha de base: 148 testes na 1.0.1 — anote a contagem real no ledger).
- [ ] Nenhuma task faz `git push`, PR ou merge (R1).

## Contrato desta fase (extrato do plano-mestre — nomes são estes)

| Hook | Evento / matcher | Lê | Saída | timeout |
|---|---|---|---|---|
| `guard-versioning.sh` | `PreToolUse` · `Bash` | `GABARITO_CMD` **cru** (não usa `gabarito_scan_text`) | `gabarito_deny` (exit 2) ou nada | 10 |
| `session-card.sh` | `SessionStart` · `startup\|resume\|clear\|compact` | cwd → raiz | `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<cartão>"}}` | 30 |
| `remind-orchestrator.sh` | `UserPromptSubmit` (sem matcher) | config | idem com `"hookEventName":"UserPromptSubmit"`, só se `lembretePorPrompt: true`; **nunca** exit 2 | 5 |

`_common.sh` novo: `gabarito_escape_hatch <ROTULO> <VAR>` · `gabarito_repo_root` · `gabarito_config_get <caminho.pontuado> [raiz]` · `gabarito_ere <regex-js>` (tradução `\d`/`\w` para ERE — decisão desta fase, ver "Decisões") · `gabarito_strip_write_heredocs` (metade awk de `gabarito_scan_text`, agora função própria; `scan_text` = `strip_write_heredocs | sed`, comportamento idêntico). Os dois guards atuais passam a chamar `gabarito_escape_hatch "R2 · …" GABARITO_ALLOW_DESTRUCTIVE` / `"R3 · …" GABARITO_ALLOW_PRODUCTION` e **continuam aceitando uma pela outra** (comportamento medido, README "Escape hatch"); `GABARITO_ALLOW_VERSIONING` libera só o R20 e nada libera o R20 além dela.

Chaves de config lidas nesta fase (`<raiz>/harness.config.json`; defaults do plano-mestre quando faltam):

| Chave | Usada por | Default |
|---|---|---|
| `versionamento.resolvidoEm` | guard-versioning (gatilho: ausente → fail-open) | — |
| `versionamento.branchPadrao` | guard-versioning | `^(feat\|fix\|enabler\|debt\|spike\|task\|perf\|refactor)/[A-Z]+-\d+(-[a-z0-9-]+)?$\|^(chore\|docs\|ci\|build\|test)/[a-z0-9-]+$` |
| `versionamento.branchWorktree` | guard-versioning | `^wt/[A-Z]+-\d+-\d+$` |
| `versionamento.tiposComEscopoDePbi` | guard-versioning | `feat fix enabler debt spike task perf refactor` |
| `versionamento.tiposLivres` | guard-versioning | `chore docs ci build test release revert` |
| `fluxo.idPadrao` | guard-versioning | `^[A-Z]+-\d+$` |
| `orquestracao.lembretePorPrompt` | remind-orchestrator | ausente = desligado |
| `orquestracao.paralelismo.simultaneos` | remind-orchestrator (fallback de `slots`) | `2` |

## Constraints bash 3.2 (valem para todo script desta fase)

- Sem `mapfile`/`readarray`, sem `declare -A`, sem `${var,,}`/`${var^^}`, sem `[[ =~ ]]` com grupos capturados (BASH_REMATCH existe em 3.2, mas o padrão do repo é `grep -E`/`sed -E`/`awk` — siga o padrão).
- Expansão indireta só por `eval "x=\${$nome-}"` com `$nome` validado por `case` (identificador `[A-Z0-9_]`), nunca `${!nome}` sem validar.
- `sed -E` e `grep -E` sem `\d`, `\s`, `\b`: use `[0-9]`, `[[:space:]]`. Regex vindo do JSON passa por `gabarito_ere`.
- `awk` sem `gensub`, sem `RS` regex, sem arrays de arrays; `match()` + `RSTART`/`RLENGTH` e `substr` são o kit.
- Todo caminho de erro termina em `exit 0` com aviso `(fail-open declarado, G9)` em stderr — exceto `gabarito_deny`, que é o único `exit 2` permitido, e só em `guard-versioning.sh`.
- Nenhum hook escreve arquivo. Nenhum hook imprime segredo (o config não tem token; o cartão vem do Node).

## Estrutura de arquivos (criar · modificar)

```
plugins/gabarito-mestre/hooks/
  _common.sh                       MOD    (T12)  escape hatch por nome · repo_root · config_get · ere
  guard-destructive.sh             MOD    (T12)  chamada do hatch com GABARITO_ALLOW_DESTRUCTIVE (1 linha)
  guard-production.sh              MOD    (T12)  chamada do hatch com GABARITO_ALLOW_PRODUCTION (1 linha)
  guard-versioning.sh              CRIAR  (T13)
  session-card.sh                  CRIAR  (T14)
  remind-orchestrator.sh           CRIAR  (T15)
  hooks.json                       MOD    (T16)
  test/corpus/versionamento.txt    CRIAR  (T13)
  test/guards.test.mjs             MOD    (T12, T13, T14, T15, T16)
docs/ledgers/GM-3.md               CRIAR  (pré-condição) · MOD a cada task
```

`hooks.json` e `guards.test.mjs` são contenda: T13, T14 e T15 tocam `guards.test.mjs` em blocos disjuntos (cada uma acrescenta seus `describe` ao fim do arquivo), mas rodam **em série** nesta ordem para não gerar conflito de merge; T16 roda sozinha por último.

## Convenções de teste (`guards.test.mjs`)

- O arquivo roda os scripts **reais** com `spawnSync('bash', [script], { input: JSON })`. Nada é mockado no bash; o que se falsifica é o **script Node** que o hook chama (via `CLAUDE_PLUGIN_ROOT` apontando para um tmpdir com `gates/scripts/cartao-sessao.mjs` falso) e o **repo** (tmpdir com `harness.config.json` e `git init`).
- Corpora em `test/corpus/*.txt`: uma entrada por linha; linhas vazias e `#` ignoradas. `legitimos.txt`/`destrutivos.txt`/`producao.txt` não têm veredito na linha (o `describe` decide). **`versionamento.txt` é diferente**: cada linha começa com o veredito `PASSA`, `BLOQUEIA` ou `HATCH`, seguido de espaços e do comando; a sequência literal `\n` dentro do comando vira quebra de linha (o separador multilinha deste corpus — hoje o arquivo de testes diz "comandos multi-linha ficam nos casos inline", ou seja, não havia separador; este é o primeiro).
- macOS: `os.tmpdir()` devolve `/var/…`, que é symlink de `/private/var/…`; `git rev-parse --show-toplevel` e `pwd` devolvem o caminho físico. Toda fixture passa por `realpathSync` antes de comparar.
- Cada `describe` novo é autocontido (cria suas fixtures); nenhum teste depende da ordem.

## Mutações prescritas da fase (o revisor executa cada uma; cada uma tem de derrubar a suíte)

| # | Mutação | Teste que cai |
|---|---|---|
| M5 | em `gabarito_escape_hatch`, trocar o `case` que restringe o par por `vars="GABARITO_ALLOW_DESTRUCTIVE GABARITO_ALLOW_PRODUCTION GABARITO_ALLOW_VERSIONING"` | "GABARITO_ALLOW_VERSIONING NÃO libera R2 nem R3" e corpus `BLOQUEIA … GABARITO_ALLOW_DESTRUCTIVE=… git commit` |
| M6 | em `guard-versioning.sh`, no awk do heredoc, trocar `found == 1 { … print; exit }` por imprimir a própria linha do `git commit` | corpus: os dois `$(cat <<'EOF'` e os dois `-F -` |
| M7 | remover `case "$ATUAL" in main\|master) exit 0 ;; esac` | "branch main e master: commit não é validado" |
| M8 | remover o `exit 0` do bloco `if [ -z "$RESOLVIDO" ]` | "sem harness.config.json: fail-open declarado" |
| M9 | em `session-card.sh`, remover `\| head -n 40` | "≤ 40 linhas mesmo se o script devolver 60" |
| M10 | em `remind-orchestrator.sh`, trocar o `exit 0` após `[ "$LEMBRETE" = "true" ] \|\|` por `exit 2` | "lembretePorPrompt false: exit 0, stdout vazio" |
| M11 | em `hooks.json`, apagar o `matcher` de `SessionStart` | "SessionStart tem session-card com matcher startup\|resume\|clear\|compact" |
| M12 | em `guard-versioning.sh`, trocar `gabarito_strip_write_heredocs` por `cat` na linha do `SCAN` | corpus `PASSA cat >> notas.md <<'EOF' … git checkout -b feature-login` |
| M13 | em `guard-versioning.sh`, trocar `POS_LINHA`/`POS_TEXTO` por `""` (git em qualquer posição) | corpus `PASSA echo 'git commit -m "wip"'` e "comando sem git commit/…: exit 0" |

(M1–M4 já existem no cabeçalho do arquivo de testes e continuam valendo.)

## Gate da fase (contagem verificável)

- 3 hooks novos + `_common.sh` com 3 funções novas e 1 dividida (`grep -c '^gabarito_[a-z_]*() {' _common.sh` sobe de 6 para 9: entram `gabarito_repo_root`, `gabarito_config_get`, `gabarito_ere`; `gabarito_strip_write_heredocs` deixa de ser alias e vira a metade awk de `gabarito_scan_text`).
- `guards.test.mjs` verde no macOS (bash 3.2) e no ubuntu (CI `hooks — corpora`).
- `versionamento.txt`: ≥ 30 entradas, ≥ 12 `PASSA`, ≥ 12 `BLOQUEIA`, ≥ 4 com `worktree`, ≥ 2 `HATCH` — o teste "corpus: contagens do gate" mede e falha abaixo disso. Entrega deste plano: 63 entradas (35 `PASSA` · 26 `BLOQUEIA` · 2 `HATCH`; 7 com `worktree`).
- `claude plugin validate ./plugins/gabarito-mestre --strict` passa.
- Ledger `GM-3.md` com a contagem de testes antes/depois de cada task e o resultado das 7 mutações.

---

## T12 — `_common.sh`: escape hatch por nome, `gabarito_repo_root`, `gabarito_config_get`, `gabarito_ere`

**Fecha:** VER-2 (hatch), pré-requisito de T13/T14/T15. **Spec:** REQ-VER-2 ("hatches não cruzam — `gabarito_escape_hatch` generalizado para receber o nome da variável"), M11.

**Files:**
- Modify: `plugins/gabarito-mestre/hooks/_common.sh`
- Modify: `plugins/gabarito-mestre/hooks/guard-destructive.sh` (linha 67)
- Modify: `plugins/gabarito-mestre/hooks/guard-production.sh` (linha 58)
- Modify: `plugins/gabarito-mestre/hooks/test/guards.test.mjs` (helpers + 2 `describe`)

**Interfaces:**

```bash
gabarito_escape_hatch <ROTULO> [<VAR>]   # 0 = liberado (imprime {"systemMessage":…} + aviso stderr); 1 = não
#   <VAR> ∈ {GABARITO_ALLOW_DESTRUCTIVE, GABARITO_ALLOW_PRODUCTION} → aceita as duas (par medido)
#   <VAR> = qualquer outro identificador → aceita só ela (inline: só ela como prefixo)
#   sem <VAR> → o par (assinatura 1.0.1)
gabarito_repo_root                        # stdout: git toplevel, ou $PWD; sempre 0
gabarito_config_get <caminho> [raiz]      # stdout: escalar cru | array um por linha | objeto JSON | vazio; sempre 0
gabarito_ere <regex>                      # stdout: regex com \d→[0-9], \w→[A-Za-z0-9_]
```

- [ ] **Passo 1 — testes (VERMELHO).** Em `guards.test.mjs`, troque o bloco de imports e o `run()` atual por este (mantém `run(script, command, env)` com a mesma assinatura; acrescenta `runAt`, `runCommon`, `fixtureRepo`, `cleanEnv`):

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..');
const PLUGIN = join(HOOKS, '..');

const HATCH_VARS = ['GABARITO_ALLOW_DESTRUCTIVE', 'GABARITO_ALLOW_PRODUCTION', 'GABARITO_ALLOW_VERSIONING'];
function cleanEnv(env = {}) {
  const e = { ...process.env };
  for (const k of [...HATCH_VARS, 'GABARITO_PROD_PATTERNS', 'GABARITO_PROD_PATTERNS_EXTRA', 'CLAUDE_PLUGIN_ROOT']) delete e[k];
  return { ...e, ...env };
}
function run(script, command, env = {}) {
  const r = spawnSync('bash', [join(HOOKS, script)], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Como run(), mas com cwd (o hook resolve a raiz a partir dele) e evento configurável.
function runAt(script, command, { cwd, env = {}, event = 'PreToolUse' } = {}) {
  const payload = event === 'PreToolUse'
    ? { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }
    : { hook_event_name: event, session_id: 'teste', cwd };
  const r = spawnSync('bash', [join(HOOKS, script)], { input: JSON.stringify(payload), encoding: 'utf8', cwd, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Executa um trecho bash com _common.sh carregado (testa as funções sem passar por um hook).
function runCommon(snippet, { cwd = HOOKS, env = {} } = {}) {
  const r = spawnSync('bash', ['-c', `. "${join(HOOKS, '_common.sh')}"; ${snippet}`], { encoding: 'utf8', cwd, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Repo de fixture: tmpdir físico (macOS: /var → /private/var), apps/api/ para o caso monorepo,
// git init + branch órfã nomeada (symbolic-ref funciona sem commit), harness.config.json opcional.
function fixtureRepo({ git = true, branch = 'feat/PBI-1-x', config = null, files = {} } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-hooks-')));
  mkdirSync(join(dir, 'apps', 'api'), { recursive: true });
  if (git) {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir });
  }
  if (config !== null) writeFileSync(join(dir, 'harness.config.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  for (const [rel, txt] of Object.entries(files)) writeFileSync(join(dir, rel), txt);
  return dir;
}
const corpus = (f) =>
  readFileSync(join(here, 'corpus', f), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const blocked = (r) => r.code === 2;
```

  E acrescente ao **fim** do arquivo:

```js
describe('_common.sh — escape hatch por nome (T12)', () => {
  const ok = 'autorizado por gabriel em 2026-09-24 — teste do par medido';
  test('GABARITO_ALLOW_PRODUCTION libera o R2 e GABARITO_ALLOW_DESTRUCTIVE libera o R3 (par medido, README "Escape hatch")', () => {
    assert.equal(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_PRODUCTION: ok }).code, 0);
    assert.equal(run('guard-production.sh', 'curl "$API_PROD_URL/x"', { GABARITO_ALLOW_DESTRUCTIVE: ok }).code, 0);
  });
  test('GABARITO_ALLOW_VERSIONING NÃO libera R2 nem R3 (hatches não cruzam fora do par)', () => {
    assert.equal(blocked(run('guard-destructive.sh', 'rm -rf build', { GABARITO_ALLOW_VERSIONING: ok })), true);
    assert.equal(blocked(run('guard-production.sh', 'curl "$API_PROD_URL/x"', { GABARITO_ALLOW_VERSIONING: ok })), true);
  });
  test('chamada direta: VAR nomeada libera só ela (env e inline); nome inválido não entra no eval', () => {
    const snippet = 'GABARITO_CMD="git commit -m x"; gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING; echo "rc=$?"';
    assert.match(runCommon(snippet, { env: { GABARITO_ALLOW_VERSIONING: ok } }).stdout, /rc=0/);
    assert.match(runCommon(snippet, { env: { GABARITO_ALLOW_DESTRUCTIVE: ok } }).stdout, /rc=1/);
    const inline = `GABARITO_CMD='GABARITO_ALLOW_VERSIONING="${ok}" git commit -m x'; gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING; echo "rc=$?"`;
    assert.match(runCommon(inline).stdout, /rc=0/);
    const cruzado = `GABARITO_CMD='GABARITO_ALLOW_DESTRUCTIVE="${ok}" git commit -m x'; gabarito_escape_hatch "R20" GABARITO_ALLOW_VERSIONING; echo "rc=$?"`;
    assert.match(runCommon(cruzado).stdout, /rc=1/);
    const injecao = 'GABARITO_CMD="x"; gabarito_escape_hatch "R20" "X; echo INJETADO"; echo "rc=$?"';
    const r = runCommon(injecao, { env: { GABARITO_ALLOW_VERSIONING: ok } });
    assert.match(r.stdout, /rc=1/);
    assert.doesNotMatch(r.stdout, /INJETADO/);
  });
  test('assinatura 1.0.1 (um argumento) continua valendo para o par', () => {
    assert.match(runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R2"; echo "rc=$?"', { env: { GABARITO_ALLOW_PRODUCTION: ok } }).stdout, /rc=0/);
    assert.match(runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R2"; echo "rc=$?"', { env: { GABARITO_ALLOW_VERSIONING: ok } }).stdout, /rc=1/);
  });
  test('rótulo e origem aparecem no systemMessage', () => {
    const r = runCommon('GABARITO_CMD="x"; gabarito_escape_hatch "R20 · cabeçalho" GABARITO_ALLOW_VERSIONING', { env: { GABARITO_ALLOW_VERSIONING: ok } });
    const j = JSON.parse(r.stdout);
    assert.match(j.systemMessage, /R20 · cabeçalho, via env/);
    assert.match(j.systemMessage, /teste do par medido/);
  });
});

describe('_common.sh — gabarito_repo_root, gabarito_config_get, gabarito_ere (T12)', () => {
  test('raiz: subpasta de repo git → toplevel; sem .git → cwd (Review Focus 2)', () => {
    const d = fixtureRepo();
    assert.equal(runCommon('gabarito_repo_root', { cwd: join(d, 'apps', 'api') }).stdout, d);
    const s = fixtureRepo({ git: false });
    assert.equal(runCommon('gabarito_repo_root', { cwd: join(s, 'apps', 'api') }).stdout, join(s, 'apps', 'api'));
  });
  test('config_get: escalar, booleano, número, array (um por linha), objeto (JSON), ausente, sem arquivo, JSON inválido', () => {
    const d = fixtureRepo({ config: {
      versionamento: { resolvidoEm: '2026-09-24', tiposLivres: ['chore', 'docs'] },
      orquestracao: { lembretePorPrompt: true, paralelismo: { simultaneos: 2, limites: { loadPorCoreMax: 1.5 } } },
    } });
    const get = (p, cwd = d) => runCommon(`gabarito_config_get ${p}`, { cwd }).stdout;
    assert.equal(get('versionamento.resolvidoEm').trim(), '2026-09-24');
    assert.equal(get('orquestracao.lembretePorPrompt').trim(), 'true');
    assert.equal(get('orquestracao.paralelismo.simultaneos').trim(), '2');
    assert.deepEqual(get('versionamento.tiposLivres').trim().split('\n'), ['chore', 'docs']);
    assert.deepEqual(JSON.parse(get('orquestracao.paralelismo.limites')), { loadPorCoreMax: 1.5 });
    assert.equal(get('nao.existe'), '');
    assert.equal(get('versionamento.resolvidoEm.x'), '');
    assert.equal(get('versionamento.resolvidoEm', fixtureRepo({ git: false })), '');
    const inv = fixtureRepo({ config: '{"versionamento": {' });
    const r = runCommon('gabarito_config_get versionamento.resolvidoEm; echo "rc=$?"', { cwd: inv });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'rc=0\n');
  });
  test('config_get lê da raiz do git mesmo chamado em apps/api; raiz explícita como 2º argumento', () => {
    const d = fixtureRepo({ config: { fluxo: { idPadrao: '^[A-Z]+-\\d+$' } } });
    assert.equal(runCommon('gabarito_config_get fluxo.idPadrao', { cwd: join(d, 'apps', 'api') }).stdout.trim(), '^[A-Z]+-\\d+$');
    assert.equal(runCommon(`gabarito_config_get fluxo.idPadrao "${d}"`, { cwd: '/' }).stdout.trim(), '^[A-Z]+-\\d+$');
  });
  test('ere: \\d e \\w viram classes POSIX; o resto fica', () => {
    assert.equal(runCommon("gabarito_ere '^[A-Z]+-\\d+$'").stdout, '^[A-Z]+-[0-9]+$');
    assert.equal(runCommon("gabarito_ere '^wt/\\w+-\\d+-\\d+$'").stdout, '^wt/[A-Za-z0-9_]+-[0-9]+-[0-9]+$');
  });
});
```

- [ ] **Passo 2 — rodar e ver VERMELHO.** `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)|not ok"`. Esperado: os 148 antigos passam; falham "chamada direta: VAR nomeada…" (`rc=1` onde se espera `rc=0` — o hatch atual não conhece `GABARITO_ALLOW_VERSIONING`), "rótulo e origem…" (stdout vazio), e todos os de `gabarito_repo_root`/`gabarito_config_get`/`gabarito_ere` (`bash: gabarito_repo_root: command not found`, exit 127). Anote a contagem `fail` no ledger.

- [ ] **Passo 3 — implementar.** Substitua `plugins/gabarito-mestre/hooks/_common.sh` **inteiro** por este arquivo. O que muda em relação à 1.0.1: `gabarito_escape_hatch` ganha o 2º argumento; entram `gabarito_repo_root`, `gabarito_config_get`, `gabarito_ere`; `gabarito_scan_text` é dividida em `gabarito_strip_write_heredocs` (só o awk dos heredocs de escrita — T13 usa) + `gabarito_scan_text` (awk | sed, o que os dois guards já usavam) — **sem mudança de comportamento** para R2/R3, e é a suíte de 148 testes que prova. `gabarito_read_command`, `gabarito_json_escape` e `gabarito_deny` são idênticos:

```bash
#!/usr/bin/env bash
# Funções comuns aos hooks do gabarito-mestre. Compatível com bash 3.2 (macOS).
# Não é hook: é carregado por `source` pelos hooks.

# Lê o JSON do stdin e devolve `.tool_input.command` em GABARITO_CMD.
# Ordem de parser: jq (≈5 ms) → node → python3. Sem nenhum deles, FAIL-OPEN DECLARADO (G9):
# avisa em stderr e deixa passar — sem parser não há como inspecionar, e bloquear
# TODO comando Bash faria o usuário desligar o plugin inteiro (e perder o resto).
# JSON malformado ou sem `.tool_input.command` também é fail-open DECLARADO: avisa em stderr.
gabarito_read_command() {
  local input
  input=$(cat)
  if command -v jq >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
  elif command -v node >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const c=j&&j.tool_input&&j.tool_input.command;process.stdout.write(typeof c==="string"?c:"")}catch(e){process.stdout.write("")}})')
  elif command -v python3 >/dev/null 2>&1; then
    GABARITO_CMD=$(printf '%s' "$input" | python3 -c 'import sys,json
try:
  c=json.load(sys.stdin).get("tool_input",{}).get("command","")
  sys.stdout.write(c if isinstance(c,str) else "")
except Exception:
  pass')
  else
    echo "gabarito-mestre: sem parser JSON (jq/node/python3) — guarda DESATIVADA neste comando (fail-open declarado, G9)" >&2
    exit 0
  fi
  if [ -z "$GABARITO_CMD" ]; then
    echo "gabarito-mestre: stdin sem .tool_input.command (JSON vazio ou malformado) — nada a inspecionar (fail-open declarado, G9)" >&2
    exit 0
  fi
}

# Escapa uma string para dentro de um literal JSON: \ " e controles (tab, newline, etc.).
gabarito_json_escape() {
  printf '%s' "$1" | LC_ALL=C awk '
    BEGIN { ORS = "" }
    {
      if (NR > 1) printf "\\n"
      s = $0
      gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\t/, "\\t", s); gsub(/\r/, "\\r", s)
      gsub(/[[:cntrl:]]/, " ", s)
      printf "%s", s
    }'
}

# Escape hatch nominal e grepável. Assinatura: gabarito_escape_hatch <ROTULO> [<VAR>]
#   gabarito_escape_hatch "R2 · rm recursivo" GABARITO_ALLOW_DESTRUCTIVE
#   gabarito_escape_hatch "R20 · cabeçalho" GABARITO_ALLOW_VERSIONING
# <VAR> é o nome da variável que libera ESTE hook. Compatibilidade medida (README "Escape hatch"):
# GABARITO_ALLOW_DESTRUCTIVE e GABARITO_ALLOW_PRODUCTION aceitam uma pela outra — SÓ entre essas duas.
# Qualquer outra variável (ex.: GABARITO_ALLOW_VERSIONING) libera só o seu hook: hatches não cruzam.
# Sem <VAR> (chamada antiga com um argumento) vale o par DESTRUCTIVE/PRODUCTION.
# Vale (1) no ambiente do processo do Claude Code, ou (2) como PREFIXO do próprio comando —
# só no INÍCIO do comando, para que comentário ou `echo` no meio não libere:
#   GABARITO_ALLOW_DESTRUCTIVE='expurgo de build autorizado por gabriel 2026-09-05' <comando>
# O motivo precisa ter ≥ 8 caracteres e ≥ 2 palavras — "lol" não é motivo. Vazio NÃO libera.
# Devolve 0 (liberado) e imprime o aviso; devolve 1 se não há liberação.
gabarito_escape_hatch() {
  local rotulo="$1"
  local vars="${2-}"
  case "$vars" in
    ""|GABARITO_ALLOW_DESTRUCTIVE|GABARITO_ALLOW_PRODUCTION) vars="GABARITO_ALLOW_DESTRUCTIVE GABARITO_ALLOW_PRODUCTION" ;;
  esac
  local motivo="" v origem="env"
  for v in $vars; do
    case "$v" in
      *[!A-Z0-9_]*|"") continue ;;   # só identificador entra no eval
    esac
    [ -z "$motivo" ] && eval "motivo=\${$v-}"
  done
  if [ -z "$motivo" ]; then
    local alt
    alt=$(printf '%s' "$vars" | tr ' ' '|')
    motivo=$(printf '%s' "$GABARITO_CMD" | head -n1 | sed -nE "s/^[[:space:]]*(${alt})=(\"([^\"]*)\"|'([^']*)'|([^[:space:]]*)).*/\3\4\5/p")
    origem="inline"
  fi
  motivo=$(printf '%s' "$motivo" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  [ -z "$motivo" ] && return 1
  local palavras
  palavras=$(printf '%s' "$motivo" | wc -w | tr -d ' ')
  if [ "${#motivo}" -lt 8 ] || [ "$palavras" -lt 2 ]; then
    echo "gabarito-mestre: escape hatch IGNORADO ($rotulo) — motivo curto demais (mínimo 8 caracteres e 2 palavras): '$motivo'" >&2
    return 1
  fi
  local esc
  esc=$(gabarito_json_escape "$motivo")
  echo "gabarito-mestre: ESCAPE HATCH usado ($rotulo, via $origem) — motivo: $motivo" >&2
  printf '{"systemMessage":"⚠ gabarito-mestre: escape hatch usado (%s, via %s). Motivo declarado: %s"}\n' "$rotulo" "$origem" "$esc"
  return 0
}

# Raiz do repositório: `git rev-parse --show-toplevel` (sessão aberta em subpasta de monorepo resolve
# para a raiz); sem git ou fora de repo, o diretório atual. Nunca falha, nunca imprime erro.
gabarito_repo_root() {
  local r
  r=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$r" ]; then printf '%s' "$r"; else printf '%s' "$(pwd -P)"; fi
}

# Lê um valor de `<raiz>/harness.config.json` por caminho pontuado: gabarito_config_get versionamento.resolvidoEm [raiz]
# Saída: escalar cru (string/número/true/false); array → um elemento por linha; objeto → JSON compacto;
# ausente, null, arquivo ausente ou JSON inválido → vazio (quem chama decide o fail-open).
# Parser: jq → node → python3, como gabarito_read_command. Sem parser: vazio.
gabarito_config_get() {
  local caminho="$1" raiz="${2-}" arq
  [ -z "$raiz" ] && raiz=$(gabarito_repo_root)
  arq="$raiz/harness.config.json"
  [ -f "$arq" ] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg p "$caminho" 'getpath($p | split(".")) | if . == null then empty elif type == "array" then .[] elif type == "object" then tojson else tostring end' "$arq" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e 'const [f,p]=process.argv.slice(1);let j;try{j=JSON.parse(require("fs").readFileSync(f,"utf8"))}catch(e){process.exit(0)}let v=j;for(const k of p.split(".")){if(v==null||typeof v!=="object"){v=undefined;break}v=v[k]}if(v==null)process.exit(0);if(Array.isArray(v))process.stdout.write(v.map(String).join("\n")+"\n");else if(typeof v==="object")process.stdout.write(JSON.stringify(v)+"\n");else process.stdout.write(String(v)+"\n")' "$arq" "$caminho" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,json
f,p=sys.argv[1],sys.argv[2]
try: j=json.load(open(f))
except Exception: sys.exit(0)
v=j
for k in p.split("."):
  v=v.get(k) if isinstance(v,dict) else None
  if v is None: sys.exit(0)
if isinstance(v,bool): print("true" if v else "false")
elif isinstance(v,list): print("\n".join(str(x) for x in v))
elif isinstance(v,dict): print(json.dumps(v))
else: print(v)' "$arq" "$caminho" 2>/dev/null
  fi
  return 0
}

# Traduz um regex vindo do JSON (estilo JavaScript: \d, \w) para ERE do grep -E do sistema (BSD e GNU).
gabarito_ere() {
  printf '%s' "$1" | sed -E 's/\\d/[0-9]/g; s/\\w/[A-Za-z0-9_]/g'
}

# Bloqueia: JSON no stdout (lido pelo Claude Code mesmo com exit 2) + motivo no stderr + exit 2.
gabarito_deny() {
  local reason="$1"
  local esc
  esc=$(gabarito_json_escape "$reason")
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  echo "$reason" >&2
  exit 2
}

# ── Normalização do texto varrido: MENÇÃO ≠ EXECUÇÃO ────────────────────────────────────
# 1. Remove o corpo de heredocs que só ESCREVEM ARQUIVO (`cat > x <<'EOF'`, `cat >> x <<'EOF'`,
#    `tee x <<'EOF'`) — anotação em progress.md que cita `rm -rf` não é `rm -rf` (falso positivo real,
#    medido em 7.037 comandos). SÓ quando o terminador é CITADO ('EOF'/"EOF"): em heredoc sem aspas
#    o bash expande `$(…)`, `` `…` `` e `${…}` na hora da escrita, então essas linhas são mantidas.
#    Qualquer outro heredoc (psql <<SQL, bash <<EOF, python3 - <<PY, `cat <<EOF | bash`) é mantido.
# 2. Remove segmentos de comando que só LEEM ou REGISTRAM texto: grep/rg/ag, git grep/log/commit -m,
#    sed. `grep "DROP TABLE"` e `git commit -m "fix: prod.example.com"` são menção, não acesso.
#    O corte é no próximo `|`, `;` ou `&` — o que vem depois (`| xargs rm -rf`) continua varrido.
# LIMITE DECLARADO: script escrito por heredoc/Write e executado no comando seguinte é invisível a
# este grep — para isso existem as guardas de runtime (G3/G7) e o review adversarial.
# Só a etapa 1 (heredocs de escrita), sem remover grep/sed/commit: é o que guard-versioning.sh usa,
# porque lá `git commit -m` É o objeto inspecionado — mas anotação em heredoc citando um commit não é commit.
gabarito_strip_write_heredocs() {
  awk '
    BEGIN { skip = 0; quoted = 0 }
    skip == 1 {
      t = $0; sub(/^\t+/, "", t)
      if (t == term) { skip = 0; next }
      if (quoted == 0 && ($0 ~ /\$\(/ || $0 ~ /`/ || $0 ~ /\$\{/)) { print; next }
      next
    }
    {
      if ($0 ~ /^[[:space:]]*(cat[[:space:]]*>>?[[:space:]]*[^|;&<]*<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*$|cat[[:space:]]+<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*>>?[[:space:]]*[^|;&<]*$|tee([[:space:]]+-a)?[[:space:]]+[^|;&<]*<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?[[:space:]]*$)/) {
        t = $0; sub(/^.*<<-?[[:space:]]*/, "", t); sub(/[[:space:]]*>.*$/, "", t)
        quoted = (t ~ /^["'"'"']/) ? 1 : 0
        gsub(/["'"'"']/, "", t); term = t; skip = 1; print; next
      }
      print
    }'
}

# Etapas 1 + 2: o que guard-destructive.sh e guard-production.sh varrem.
gabarito_scan_text() {
  gabarito_strip_write_heredocs | LC_ALL=C sed -E 's/(^|[|;&])[[:space:]]*(git[[:space:]]+(grep|log|commit)|grep|egrep|fgrep|rg|ag|sed|echo|printf)([[:space:]]+[^|;&]*)?/\1 /g'
}
```

  Nos guards, uma linha cada:

  - `guard-destructive.sh` linha 67: `if gabarito_escape_hatch "R2 · $familia"; then exit 0; fi` → `if gabarito_escape_hatch "R2 · $familia" GABARITO_ALLOW_DESTRUCTIVE; then exit 0; fi`
  - `guard-production.sh` linha 58: `if gabarito_escape_hatch "R3 · $hit"; then exit 0; fi` → `if gabarito_escape_hatch "R3 · $hit" GABARITO_ALLOW_PRODUCTION; then exit 0; fi`

  Notas de implementação (por que está assim):
  - `getpath(["a","b"])` do jq devolve `null` sem erro para caminho ausente; `if . == null then empty` cobre `null` explícito e ausente. `tostring` de `true` é `"true"` — é o que `remind-orchestrator.sh` compara.
  - O `case *[!A-Z0-9_]*` impede que um rótulo com `;` chegue ao `eval` (teste "nome inválido não entra no eval").
  - `gabarito_repo_root` usa `git rev-parse` do **cwd do hook**; o Claude Code roda o hook no cwd da sessão, que é o que se quer.

- [ ] **Passo 4 — rodar e ver VERDE.** `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `fail 0`. Confirme à mão que os 148 antigos continuam: `grep -c "not ok" <(node --test … 2>&1)` = 0.

- [ ] **Passo 5 — fallback de parser (verificação manual, registrada no ledger).** Monte um PATH sem `jq` e sem `node` e confira que `python3` responde:

```bash
S=$(mktemp -d); for b in /bin/bash /usr/bin/sed /usr/bin/awk /usr/bin/grep /usr/bin/head /usr/bin/tr /usr/bin/wc /usr/bin/git /bin/pwd /bin/cat /usr/bin/printf "$(command -v python3)"; do ln -s "$b" "$S/$(basename "$b")"; done
D=$(mktemp -d); printf '%s' '{"versionamento":{"resolvidoEm":"2026-09-24","tiposLivres":["chore","docs"]}}' > "$D/harness.config.json"
(cd "$D" && PATH="$S" bash -c '. "'"$PWD"'/plugins/gabarito-mestre/hooks/_common.sh"; gabarito_config_get versionamento.tiposLivres')
```
  Esperado: `chore` e `docs` em duas linhas. Repita acrescentando `node` ao `$S` e removendo `python3` → mesmo resultado (caminho node). Escreva no ledger "fallback jq→node→python3: 3/3 medidos".

- [ ] **Passo 6 — commit.** `git add plugins/gabarito-mestre/hooks/_common.sh plugins/gabarito-mestre/hooks/guard-destructive.sh plugins/gabarito-mestre/hooks/guard-production.sh plugins/gabarito-mestre/hooks/test/guards.test.mjs docs/ledgers/GM-3.md && git commit -m "feat(GM-3): _common.sh — escape hatch por nome, repo_root, config_get, ere"`.

---

## T13 — `guard-versioning.sh` + `test/corpus/versionamento.txt` + testes

**Fecha:** VER-2. **Spec:** REQ-VER-2 (l.151–153) — Given `git commit -m "arrumei"` → exit 2 citando R20 e mostrando `feat(PBI-123): …`; Given `git worktree add -b wt/PBI-123-1 ../wt1` → passa. **Review Focus 1** (heredoc: valida a 1ª linha do corpo) e **2** (monorepo em subpasta). **Depende de T12.**

**Files:**
- Create: `plugins/gabarito-mestre/hooks/guard-versioning.sh`
- Create: `plugins/gabarito-mestre/hooks/test/corpus/versionamento.txt`
- Modify: `plugins/gabarito-mestre/hooks/test/guards.test.mjs` (1 `describe` ao fim + cabeçalho de mutações)

**Interfaces:**

```
stdin  : JSON PreToolUse/Bash ({ tool_input: { command }, cwd })
env    : GABARITO_ALLOW_VERSIONING (hatch; só ela) · CLAUDE_PLUGIN_ROOT não é usado
lê     : <raiz>/harness.config.json (versionamento.*, fluxo.idPadrao) · <cwd>/<arquivo> ou <raiz>/<arquivo> para -F
stdout : nada (passa) · {"hookSpecificOutput":{…"permissionDecision":"deny"…}} (bloqueia) · {"systemMessage":…} (hatch)
exit   : 0 · 2 (só por gabarito_deny)
```

Formas de `git commit` cobertas (do plano-mestre, "Hooks — nomes, eventos, saída"): `-m "x"`, `-m 'x'`, `--message="x"`, `-am "x"`, `-m "a" -m "b"` (valida só o primeiro), `-m "$(cat <<'EOF' … EOF)"` (valida a 1ª linha do corpo), `-F <arquivo>` / `--file=<arquivo>` (1ª linha do arquivo; relativo ao cwd e depois à raiz; ausente → fail-open com aviso), `-F -` com heredoc (1ª linha do corpo). Não intercepta: `--amend` sem `-m`/`-F`, `git commit` sem mensagem, qualquer commit em `main`/`master`. Formas de branch: `git checkout -b|-B <n>`, `git switch -c|-C|--create <n>`, `git branch <n>` (sem `-d|-D|-m|-M|-a|-r|-v|--list|…`), `git worktree add … -b|-B <n>` (o `-b` pode vir antes ou depois do diretório). `<n>` casa `branchPadrao` **ou** `branchWorktree`.

Cabeçalho aceito: `^([a-z]+)(\(([^)]*)\))?!?: (.+)$` — tipo minúsculo, escopo opcional entre parênteses, `!` opcional, dois-pontos **e espaço**, assunto não vazio. Regras: tipo ∈ `tiposComEscopoDePbi` → escopo obrigatório casando `idPadrao`; tipo ∈ `tiposLivres` → escopo livre ou ausente; tipo fora das duas listas → reprova (`hotfix` reprova: hotfix é `fix(<PBI de Bug>)`).

- [ ] **Passo 1 — corpus.** Crie `plugins/gabarito-mestre/hooks/test/corpus/versionamento.txt` exatamente assim (63 entradas; veredito + espaços + comando; `\n` literal = quebra de linha):

```
# Corpus do guard-versioning.sh (R20). Uma entrada por linha: <VEREDITO> <espaços> <comando>.
# VEREDITO: PASSA (exit 0, stdout vazio) · BLOQUEIA (exit 2, motivo cita R20) · HATCH (exit 0 e stdout com systemMessage).
# A sequência literal \n dentro do comando vira quebra de linha (separador de entrada multilinha deste corpus).
# Linhas vazias e `#` são ignoradas. Roda num repo de fixture com harness.config.json (versionamento.resolvidoEm
# presente), branch feat/PBI-1-x e os arquivos msg-ok.txt / msg-ruim.txt na raiz.

# ── legítimas (≥ 12) ──
PASSA    git commit -m "feat(PBI-12): login por magic link"
PASSA    git commit -m 'fix(PBI-7): timeout do webhook'
PASSA    git commit --message="docs: atualiza README"
PASSA    git commit -am "chore: bump deps"
PASSA    git commit -m "feat(PBI-1): assunto" -m "corpo longo sem formato"
PASSA    git add -A && git commit -q -m "enabler(GM-3): hooks de versionamento" && git rev-parse --short HEAD
PASSA    git commit -m "$(cat <<'EOF'\nfeat(PBI-123): assunto do heredoc\n\ncorpo com detalhes\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF\n)"
PASSA    git commit -F - <<'MSG'\nchore(deps): via -F -\n\ncorpo\nMSG
PASSA    git commit -F msg-ok.txt
PASSA    git commit --amend --no-edit
PASSA    git commit
PASSA    git commit -m "feat(PBI-12)!: quebra de contrato da API"
PASSA    git checkout -b feat/PBI-12-magic-link
PASSA    git checkout -q -b docs/claude-sso-porteiro origin/main && git branch --show-current
PASSA    git switch -c chore/bump-deps
PASSA    git branch enabler/GM-3-hooks
PASSA    git branch -d feat/PBI-12-x
PASSA    git branch --list 'feat/*'
PASSA    git checkout main && git pull
PASSA    git log --oneline -5 && git status --short
PASSA    git commit -m "revert: desfaz feat(PBI-3)"

# ── inválidas (≥ 12) ──
BLOQUEIA    git commit -m "arrumei"
BLOQUEIA    git commit -m "fix: sem escopo de PBI"
BLOQUEIA    git commit -m "feat(pbi-12): minúsculas"
BLOQUEIA    git commit -m "hotfix(PBI-1): tipo inexistente"
BLOQUEIA    git commit --message="Feat(PBI-1): maiúscula no tipo"
BLOQUEIA    git commit -am "wip"
BLOQUEIA    git commit -m "corpo primeiro" -m "feat(PBI-1): só no segundo"
BLOQUEIA    git add . && git commit -m "arrumei" && git push
BLOQUEIA    git commit -m "$(cat <<'EOF'\narrumei tudo\n\nfeat(PBI-1): na segunda linha não vale\nEOF\n)"
BLOQUEIA    git commit -F - <<'EOF'\nmudanças\nEOF
BLOQUEIA    git commit -F msg-ruim.txt
BLOQUEIA    git commit --amend -m "arrumei de novo"
BLOQUEIA    git commit -m "feat(PBI-12):sem espaço"
BLOQUEIA    git checkout -b hotfix/PBI-1
BLOQUEIA    git checkout -b chore/PBI-1
BLOQUEIA    git switch --create feat/pbi-12
BLOQUEIA    git branch feature-login
BLOQUEIA    git checkout -B main-2

# ── worktree (≥ 4) ──
PASSA    git worktree add -b wt/PBI-123-1 ../wt1
PASSA    git worktree add ../wt2 -b wt/PBI-12-2 main
PASSA    git worktree add -B wt/PBI-7-3 ../wt3
PASSA    git worktree add --detach ../wt-solto
PASSA    git worktree list && git worktree prune
BLOQUEIA    git worktree add -b wt/PBI-12 ../wt-sem-indice
BLOQUEIA    git worktree add -b feature/x ../wt-x

# ── fail-open por -F ausente ──
PASSA    git commit -F nao-existe.txt

# ── escape hatch (≥ 2): HATCH = exit 0 E stdout com systemMessage; cruzamento e motivo curto NÃO liberam ──
HATCH    GABARITO_ALLOW_VERSIONING="autorizado por gabriel em 2026-09-24 — importação de histórico legado" git commit -m "arrumei"
HATCH    GABARITO_ALLOW_VERSIONING='autorizado por gabriel em 2026-09-24 — branch de experimento' git checkout -b experimento-x
BLOQUEIA    GABARITO_ALLOW_DESTRUCTIVE="autorizado por gabriel em 2026-09-24 — hatch de outro hook" git commit -m "arrumei"
BLOQUEIA    GABARITO_ALLOW_VERSIONING="lol" git commit -m "arrumei"
BLOQUEIA    git commit -m "arrumei" # GABARITO_ALLOW_VERSIONING="autorizado por gabriel em 2026-09-24 — no fim não vale"

# ── mais legítimas ──
PASSA    git commit -m "test: cobre o heredoc multilinha"
PASSA    git commit -m "ci: matriz macos e ubuntu"
PASSA    git switch -C fix/PBI-9-timeout
PASSA    git -C apps/api commit -m "refactor(PBI-4): extrai cliente http"
PASSA    git commit --amend

# ── menção ≠ commit: git fora de posição de comando e heredoc de anotação passam ──
PASSA    echo 'git commit -m "wip"'
PASSA    cat >> notas.md <<'EOF'\n- depois: git commit -m "arrumei"\ngit checkout -b feature-login\nEOF\ngit status
PASSA    grep -rn "git commit -m" docs/ | head
BLOQUEIA    cat >> notas.md <<'EOF'\nnota\nEOF\ngit commit -m "arrumei"
BLOQUEIA    x=$(git commit -m "arrumei") && echo "$x"
BLOQUEIA    cd apps/api && git checkout -b feature-login
```

- [ ] **Passo 2 — testes (VERMELHO).** No cabeçalho de `guards.test.mjs`, acrescente às mutações prescritas:

```js
 *  M5  aceitar GABARITO_ALLOW_VERSIONING no par DESTRUCTIVE/PRODUCTION (_common.sh)   → "VERSIONING NÃO libera R2 nem R3"
 *  M6  guard-versioning: imprimir a linha `git commit` em vez da 1ª linha do heredoc   → corpus PASSA/BLOQUEIA com <<'EOF'
 *  M7  guard-versioning: remover o `case main|master`                                  → "branch main e master"
 *  M8  guard-versioning: remover o exit 0 do fail-open sem resolvidoEm                 → "sem harness.config.json: fail-open"
 *  M12 guard-versioning: trocar gabarito_strip_write_heredocs por cat no SCAN          → corpus PASSA cat >> notas.md <<'EOF' …
 *  M13 guard-versioning: esvaziar POS_LINHA/POS_TEXTO (git em qualquer posição)        → corpus PASSA echo 'git commit -m "wip"'
```

  E ao fim do arquivo:

```js
const CONFIG_VERSIONAMENTO = {
  fluxo: { idPadrao: '^[A-Z]+-\\d+$', resolvidoEm: '2026-09-24' },
  versionamento: {
    modelo: 'trunk',
    branchPadrao: '^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$',
    branchWorktree: '^wt/[A-Z]+-\\d+-\\d+$',
    commit: 'conventional',
    tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'],
    tiposLivres: ['chore', 'docs', 'ci', 'build', 'test', 'release', 'revert'],
    tag: '^v\\d+\\.\\d+\\.\\d+$',
    changelog: 'CHANGELOG.md',
    resolvidoEm: '2026-09-24',
  },
};
const corpusVersionamento = () =>
  readFileSync(join(here, 'corpus', 'versionamento.txt'), 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^(PASSA|BLOQUEIA|HATCH)[ \t]+(.+)$/);
      assert.ok(m, `versionamento.txt: linha sem veredito: ${l}`);
      return { veredito: m[1], cmd: m[2].replace(/\\n/g, '\n') };
    });

describe('guard-versioning.sh — R20 (T13)', () => {
  const root = fixtureRepo({
    branch: 'feat/PBI-1-x',
    config: CONFIG_VERSIONAMENTO,
    files: { 'msg-ok.txt': 'feat(PBI-9): via arquivo\n\ncorpo\n', 'msg-ruim.txt': 'mudei coisas\n' },
  });
  const entradas = corpusVersionamento();

  test('corpus: contagens do gate da Fase 3 (≥ 30 · ≥ 12 PASSA · ≥ 12 BLOQUEIA · ≥ 4 worktree · ≥ 2 HATCH)', () => {
    const n = (v) => entradas.filter((e) => e.veredito === v).length;
    assert.ok(entradas.length >= 30, `entradas=${entradas.length}`);
    assert.ok(n('PASSA') >= 12, `PASSA=${n('PASSA')}`);
    assert.ok(n('BLOQUEIA') >= 12, `BLOQUEIA=${n('BLOQUEIA')}`);
    assert.ok(entradas.filter((e) => /worktree/.test(e.cmd)).length >= 4, 'worktree');
    assert.ok(n('HATCH') >= 2, `HATCH=${n('HATCH')}`);
  });

  for (const { veredito, cmd } of entradas) {
    test(`${veredito}: ${cmd.replace(/\n/g, '⏎').slice(0, 90)}`, () => {
      const r = runAt('guard-versioning.sh', cmd, { cwd: root });
      if (veredito === 'BLOQUEIA') {
        assert.equal(r.code, 2, r.stderr);
        const j = JSON.parse(r.stdout);
        assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
        assert.match(j.hookSpecificOutput.permissionDecisionReason, /regra R20/);
      } else if (veredito === 'HATCH') {
        assert.equal(r.code, 0, r.stderr);
        assert.match(JSON.parse(r.stdout).systemMessage, /R20/);
        assert.match(r.stderr, /ESCAPE HATCH/);
      } else {
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stdout, '');
      }
    });
  }

  test('bloqueio em três camadas: frase · o que fazer · regra citada, com a forma correta e o nome do hatch', () => {
    const r = runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root });
    const motivo = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(motivo, /^Versionamento bloqueado pela regra R20 \(cabeçalho 'arrumei' não é Conventional Commits\)\./);
    assert.match(motivo, /Reescreva a primeira linha da mensagem \(fonte: -m\)/);
    assert.match(motivo, /ex\.: feat\(PBI-123\): assunto/);
    assert.match(motivo, /Ver AGENTS\.md §3 \(R20\) e referencia\.md §10/);
    assert.match(motivo, /GABARITO_ALLOW_VERSIONING="autorizado por <quem> em <data> — <motivo>"/);
    assert.match(r.stderr, /regra R20/);
  });

  test('motivos específicos: sem escopo · escopo fora do idPadrao · tipo desconhecido · branch fora do padrão', () => {
    const motivo = (cmd) => JSON.parse(runAt('guard-versioning.sh', cmd, { cwd: root }).stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(motivo('git commit -m "fix: x"'), /tipo 'fix' exige o ID do PBI como escopo/);
    assert.match(motivo('git commit -m "fix(pbi-1): x"'), /escopo 'pbi-1' não casa o padrão de ID \^\[A-Z\]\+-\\d\+\$/);
    assert.match(motivo('git commit -m "hotfix(PBI-1): x"'), /tipo 'hotfix' não existe na convenção/);
    assert.match(motivo('git checkout -b hotfix/PBI-1'), /nome de branch 'hotfix\/PBI-1' fora do padrão/);
  });

  test('sem harness.config.json: fail-open declarado — corpus legítimo e corpus de versionamento passam inteiros', () => {
    const solto = fixtureRepo({ git: false });
    for (const cmd of corpus('legitimos.txt')) assert.equal(runAt('guard-versioning.sh', cmd, { cwd: solto }).code, 0, cmd);
    for (const { cmd } of entradas) assert.equal(runAt('guard-versioning.sh', cmd, { cwd: solto }).code, 0, cmd);
    assert.match(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: solto }).stderr, /fail-open declarado/);
  });

  test('config sem versionamento.resolvidoEm (onboarding incompleto) também é fail-open', () => {
    const semResolvido = fixtureRepo({ config: { versionamento: { branchPadrao: '^x$' } } });
    const r = runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: semResolvido });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /versionamento\.resolvidoEm/);
  });

  test('comando sem git commit/checkout/switch/branch/worktree: exit 0, sem stdout, sem stderr (não lê config)', () => {
    for (const cmd of ['npm test', 'git status', 'git log --oneline', 'git push origin HEAD', 'echo "git commit -m x"']) {
      const r = runAt('guard-versioning.sh', cmd, { cwd: root });
      assert.equal(r.code, 0, cmd);
      assert.equal(r.stdout, '', cmd);
    }
  });

  test('branch main e master: commit não é validado; criação de branch continua validada', () => {
    for (const b of ['main', 'master']) {
      const d = fixtureRepo({ branch: b, config: CONFIG_VERSIONAMENTO });
      assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: d }).code, 0, b);
      assert.equal(runAt('guard-versioning.sh', 'git checkout -b hotfix/PBI-1', { cwd: d }).code, 2, b);
    }
  });

  test('monorepo (Review Focus 2): sessão em apps/api lê o config da raiz; -F relativo resolve pelo cwd e depois pela raiz', () => {
    const sub = join(root, 'apps', 'api');
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: sub }).code, 2);
    writeFileSync(join(sub, 'local.txt'), 'wip\n');
    assert.equal(runAt('guard-versioning.sh', 'git commit -F local.txt', { cwd: sub }).code, 2);
    assert.equal(runAt('guard-versioning.sh', 'git commit -F msg-ok.txt', { cwd: sub }).code, 0);
    assert.equal(runAt('guard-versioning.sh', `git commit --file="${join(root, 'msg-ruim.txt')}"`, { cwd: sub }).code, 2);
    const r = runAt('guard-versioning.sh', 'git commit -F nao-existe.txt', { cwd: sub });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /fail-open declarado/);
  });

  test('heredoc (Review Focus 1): valida a 1ª linha do corpo, não a linha `git commit`', () => {
    const ok = 'git commit -m "$(cat <<\'EOF\'\nfeat(PBI-5): assunto\n\ncorpo\nEOF\n)"';
    assert.equal(runAt('guard-versioning.sh', ok, { cwd: root }).code, 0);
    const r = runAt('guard-versioning.sh', ok.replace('feat(PBI-5): assunto', 'arrumei'), { cwd: root });
    assert.equal(r.code, 2);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /cabeçalho 'arrumei'.*\(fonte: heredoc\)/);
  });

  test('a convenção vem do config, não do script: hotfix passa a valer quando está em tiposComEscopoDePbi', () => {
    // tiposLivres: ['docs'] e não [] — lista vazia no JSON conta como ausente e cai nos defaults (nota do script)
    const custom = fixtureRepo({ config: { ...CONFIG_VERSIONAMENTO, versionamento: { ...CONFIG_VERSIONAMENTO.versionamento, tiposComEscopoDePbi: ['hotfix'], tiposLivres: ['docs'] } } });
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "hotfix(PBI-1): x"', { cwd: custom }).code, 0);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "feat(PBI-1): x"', { cwd: custom }).code, 2);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "chore: x"', { cwd: custom }).code, 2);
  });

  test('hatch por env libera e avisa; DESTRUCTIVE/PRODUCTION por env não liberam o R20', () => {
    const ok = 'autorizado por gabriel em 2026-09-24 — commit de importação';
    const r = runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root, env: { GABARITO_ALLOW_VERSIONING: ok } });
    assert.equal(r.code, 0);
    assert.match(JSON.parse(r.stdout).systemMessage, /R20 · cabeçalho 'arrumei'.*via env/);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root, env: { GABARITO_ALLOW_DESTRUCTIVE: ok } }).code, 2);
    assert.equal(runAt('guard-versioning.sh', 'git commit -m "arrumei"', { cwd: root, env: { GABARITO_ALLOW_PRODUCTION: ok } }).code, 2);
  });

  test('stdin vazio ou malformado: fail-open declarado', () => {
    for (const input of ['', '{"x":']) {
      const r = spawnSync('bash', [join(HOOKS, 'guard-versioning.sh')], { input, encoding: 'utf8', cwd: root, env: cleanEnv() });
      assert.equal(r.status, 0);
      assert.match(r.stderr, /fail-open/);
    }
  });
});
```

- [ ] **Passo 3 — rodar e ver VERMELHO.** Esperado: todos os testes do `describe` novo falham com `bash: …/guard-versioning.sh: No such file or directory` (exit 127 ≠ 0 e ≠ 2); "corpus: contagens do gate" passa (só lê o arquivo). Anote no ledger.

- [ ] **Passo 4 — implementar.** Crie `plugins/gabarito-mestre/hooks/guard-versioning.sh` com este conteúdo (mesmo modo de arquivo dos guards atuais — `ls -l hooks/guard-*.sh`):

```bash
#!/usr/bin/env bash
# gabarito-mestre · guard-versioning.sh — implementa a R20 (versionamento é gate, não convenção).
# PreToolUse/Bash. Lê JSON no stdin; bloqueia com JSON + exit 2; permite com exit 0 sem saída.
#
# Lê GABARITO_CMD CRU — NÃO passa por gabarito_scan_text, que remove `git commit -m` de propósito (menção ≠
# execução vale para R2/R3; aqui o commit É o objeto inspecionado). Duas exceções, medidas no R2 como falso
# positivo: (i) corpo de heredoc que só escreve arquivo (`cat >> notas.md <<'EOF'`) é removido antes
# (gabarito_strip_write_heredocs); (ii) `git` só conta em POSIÇÃO DE COMANDO — início de linha/segmento, após
# ; & | ( ` $( — com atribuições de env antes (é assim que o hatch inline chega). `echo "git commit -m x"` passa.
#
# O que valida (config `versionamento` de <raiz>/harness.config.json; raiz = git toplevel → cwd):
#   1 criação de branch   git checkout -b|-B <n> · git switch -c|-C|--create <n> · git branch <n> (sem
#                         -d/-D/-m/-M/--list/-a/-r/-v…) · git worktree add … -b|-B <n>
#                         <n> tem de casar `branchPadrao` OU `branchWorktree`.
#   2 cabeçalho de commit git commit -m "x" · -m 'x' · --message=x · -am "x" · -m "a" -m "b" (só o 1º) ·
#                         -m "$(cat <<'EOF' … EOF)" (1ª linha do corpo) · -F - <<'EOF' (1ª linha do corpo) ·
#                         -F <arquivo> / --file=<arquivo> (1ª linha do arquivo; relativo ao cwd, depois à raiz;
#                         ausente → fail-open com aviso).
#                         Cabeçalho = `tipo(escopo): assunto` ou `tipo: assunto` (`!` antes de `:` aceito).
#                         tipo ∈ tiposComEscopoDePbi → escopo obrigatório casando `fluxo.idPadrao`;
#                         tipo ∈ tiposLivres → escopo livre ou ausente; outro tipo → reprova.
# NÃO intercepta: `--amend` sem -m/-F, `git commit` sem mensagem (interativo), commit em `main`/`master`
# (o merge/squash do orquestrador é validado pelo título da PR — attest `squash-titulo-pr`).
# FAIL-OPEN DECLARADO (G9): sem `versionamento.resolvidoEm` (repo sem onboarding) → aviso em stderr, exit 0.
# Escape hatch: GABARITO_ALLOW_VERSIONING="motivo" (env ou prefixo NO INÍCIO do comando); ≥8 chars e ≥2 palavras.
# Hatches não cruzam: GABARITO_ALLOW_DESTRUCTIVE/PRODUCTION NÃO liberam este hook.
set -u
. "$(dirname "$0")/_common.sh"
gabarito_read_command

# Texto varrido: comando cru menos corpos de heredoc-de-escrita (anotação não é commit).
SCAN=$(printf '%s' "$GABARITO_CMD" | gabarito_strip_write_heredocs)

# Posição de comando (mesma ideia do guard-destructive): início, ou após ; & | ( ` $( — com atribuições antes.
NL=$'\n'
ASSIGN='([A-Za-z_][A-Za-z0-9_]*=("([^"\\]|\\.)*"|'"'"'[^'"'"']*'"'"'|\$\([^)]*\)|[^[:space:]]*)[[:space:]]+)*'
GITOPTS='git([[:space:]]+-[A-Za-z-]+([[:space:]=][^[:space:]]+)?)*[[:space:]]+'
POS_LINHA="(^|[;&|(\`]|\\\$\\()[[:space:]]*${ASSIGN}"           # grep/sed: linha a linha, ^ é início de linha
POS_TEXTO="(^|[;&|(\`${NL}]|\\\$\\()[[:space:]]*${ASSIGN}"      # awk sobre o texto inteiro: newline entra no colchete
GITP_L="${POS_LINHA}${GITOPTS}"    # grupos: 1 posição · 2-4 atribuições · 5-6 opções do git → o próximo grupo é \7
GITP_T="${POS_TEXTO}${GITOPTS}"

# Pré-filtro barato: sem `git` em posição de comando seguido de commit/checkout/switch/branch/worktree, nada a fazer.
printf '%s\n' "$SCAN" | LC_ALL=C grep -Eq "${GITP_L}(commit|checkout|switch|branch|worktree)([[:space:]]|$)" || exit 0

ROOT=$(gabarito_repo_root)
RESOLVIDO=$(gabarito_config_get versionamento.resolvidoEm "$ROOT")
if [ -z "$RESOLVIDO" ]; then
  echo "gabarito-mestre: harness.config.json sem versionamento.resolvidoEm — R20 não aplicada neste repo; rode gabarito-instalar (fail-open declarado, G9)" >&2
  exit 0
fi

# ── Config com defaults (contrato do plano-mestre); lista vazia no JSON conta como ausente ─────
BRANCH_RE=$(gabarito_config_get versionamento.branchPadrao "$ROOT")
[ -z "$BRANCH_RE" ] && BRANCH_RE='^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$'
WT_RE=$(gabarito_config_get versionamento.branchWorktree "$ROOT")
[ -z "$WT_RE" ] && WT_RE='^wt/[A-Z]+-\d+-\d+$'
ID_RE=$(gabarito_config_get fluxo.idPadrao "$ROOT")
[ -z "$ID_RE" ] && ID_RE='^[A-Z]+-\d+$'
TIPOS_PBI=$(gabarito_config_get versionamento.tiposComEscopoDePbi "$ROOT" | tr '\n' ' ')
[ -z "${TIPOS_PBI// /}" ] && TIPOS_PBI="feat fix enabler debt spike task perf refactor"
TIPOS_LIVRES=$(gabarito_config_get versionamento.tiposLivres "$ROOT" | tr '\n' ' ')
[ -z "${TIPOS_LIVRES// /}" ] && TIPOS_LIVRES="chore docs ci build test release revert"
BRANCH_ERE=$(gabarito_ere "$BRANCH_RE"); WT_ERE=$(gabarito_ere "$WT_RE"); ID_ERE=$(gabarito_ere "$ID_RE")
EXEMPLO_PBI="$(printf '%s' "$TIPOS_PBI" | awk '{print $1}')(PBI-123): assunto"
EXEMPLO_LIVRE="$(printf '%s' "$TIPOS_LIVRES" | awk '{print $1}'): assunto"
LISTA_PBI=$(printf '%s' "$TIPOS_PBI" | sed -E 's/[[:space:]]+$//; s/[[:space:]]+/, /g')
LISTA_LIVRES=$(printf '%s' "$TIPOS_LIVRES" | sed -E 's/[[:space:]]+$//; s/[[:space:]]+/, /g')

em_lista() { # em_lista <item> <lista separada por espaço>
  local i; for i in $2; do [ "$i" = "$1" ] && return 0; done; return 1
}

bloquear() { # bloquear <frase> <o que fazer> — três camadas: frase · o que fazer · regra citada
  local frase="$1" oque="$2"
  if gabarito_escape_hatch "R20 · $frase" GABARITO_ALLOW_VERSIONING; then exit 0; fi
  gabarito_deny "Versionamento bloqueado pela regra R20 ($frase). $oque Formas aceitas — branch: <tipo>/<PBI>-<slug> (ex.: feat/PBI-123-login) ou <livre>/<slug> (ex.: chore/bump-deps) ou wt/<PBI>-<n>; commit: tipo(escopo): assunto (ex.: $EXEMPLO_PBI) — tipos com escopo de PBI: $LISTA_PBI; tipos livres (escopo opcional, ex.: $EXEMPLO_LIVRE): $LISTA_LIVRES. Ver AGENTS.md §3 (R20) e referencia.md §10. Só com autorização do usuário: repita com GABARITO_ALLOW_VERSIONING=\"autorizado por <quem> em <data> — <motivo>\" no início do comando."
}

# ── 1. Criação de branch (um nome por segmento; segmentos separados por ; | & e newline) ──────
BRANCH_FLAGS='[[:space:]](-[a-zA-Z]*[dDmMarvc][a-zA-Z]*|--list|--delete|--move|--copy|--show-current|--contains|--no-contains|--merged|--no-merged|--set-upstream-to(=[^[:space:]]+)?|--unset-upstream|--edit-description|--track|--no-track|--all|--remotes|--verbose|--points-at|--sort(=[^[:space:]]+)?|--format(=[^[:space:]]+)?)([[:space:]]|$)'
NOMES=$(printf '%s\n' "$SCAN" | tr ';|&' '\n\n\n' | while IFS= read -r seg; do
  n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}checkout([[:space:]]+-[A-Za-z-]+)*[[:space:]]+(-b|-B)[[:space:]]+([^[:space:]]+).*/\9/p")
  [ -z "$n" ] && n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}switch([[:space:]]+-[A-Za-z-]+)*[[:space:]]+(-c|-C|--create)[[:space:]]+([^[:space:]]+).*/\9/p")
  [ -z "$n" ] && n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}worktree[[:space:]]+add([[:space:]]+[^[:space:]]+)*[[:space:]]+(-b|-B)[[:space:]]+([^[:space:]]+).*/\9/p")
  if [ -z "$n" ] && ! printf '%s' "$seg" | LC_ALL=C grep -Eq "$BRANCH_FLAGS"; then
    n=$(printf '%s' "$seg" | sed -nE "s/.*${GITP_L}branch[[:space:]]+([^-[:space:]][^[:space:]]*).*/\7/p")
  fi
  [ -n "$n" ] && printf '%s\n' "$n"
done)
for nome in $NOMES; do
  if ! printf '%s' "$nome" | LC_ALL=C grep -Eq "$BRANCH_ERE" && ! printf '%s' "$nome" | LC_ALL=C grep -Eq "$WT_ERE"; then
    bloquear "nome de branch '$nome' fora do padrão" "Crie a branch com o tipo do PBI e o ID do card (branchPadrao: $BRANCH_RE) ou como worktree de implementador (branchWorktree: $WT_RE)."
  fi
done

# ── 2. Cabeçalho do commit ───────────────────────────────────────────────────────────────
# Recorta o texto a partir do primeiro `git … commit` em posição de comando; sem ele, não há commit a validar.
COMMIT_TXT=$(printf '%s\n' "$SCAN" | GITP="$GITP_T" awk '
  { s = s (NR > 1 ? "\n" : "") $0 }
  END { if (match(s, ENVIRON["GITP"] "commit([[:space:]]|$)")) print substr(s, RSTART) }')
[ -z "$COMMIT_TXT" ] && exit 0

ATUAL=$(git -C "$ROOT" symbolic-ref --short -q HEAD 2>/dev/null || git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)
case "$ATUAL" in main|master) exit 0 ;; esac

CAB=""; FONTE=""
# (a) heredoc na linha do commit: -m "$(cat <<'EOF' … )" ou -F - <<'EOF' → 1ª linha do corpo
CAB=$(printf '%s\n' "$COMMIT_TXT" | awk -v gitp="$GITOPTS" '
  found == 0 && $0 ~ (gitp "commit") && /<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?/ { found = 1; next }
  found == 1 { sub(/^\t+/, ""); print; exit }')
[ -n "$CAB" ] && FONTE="heredoc"
# (b) -F <arquivo> / --file=<arquivo> (que não seja "-")
if [ -z "$CAB" ]; then
  ARQ=$(printf '%s\n' "$COMMIT_TXT" | tr '\n' ' ' | sed -nE "s/.*${GITOPTS}commit[^;&|]*[[:space:]](-F|--file)[[:space:]=]+(\"([^\"]*)\"|'([^']*)'|([^[:space:];&|]+)).*/\5\6\7/p")
  if [ -n "$ARQ" ] && [ "$ARQ" != "-" ]; then
    case "$ARQ" in /*) CAND="$ARQ" ;; *) CAND="$PWD/$ARQ"; [ -f "$CAND" ] || CAND="$ROOT/$ARQ" ;; esac
    if [ -f "$CAND" ]; then
      CAB=$(head -n1 "$CAND"); FONTE="arquivo $ARQ"
    else
      echo "gabarito-mestre: git commit -F '$ARQ' — arquivo não encontrado a partir de $PWD nem de $ROOT; cabeçalho não inspecionado (fail-open declarado, G9)" >&2
      exit 0
    fi
  fi
fi
# (c) -m / --message= / -am / -m duplo → primeiro argumento após o PRIMEIRO flag de mensagem, 1ª linha
if [ -z "$CAB" ]; then
  CAB=$(printf '%s\n' "$COMMIT_TXT" | awk -v gitp="$GITOPTS" '
    { s = s (NR > 1 ? "\n" : "") $0 }
    END {
      if (!match(s, gitp "commit")) exit
      s = substr(s, RSTART + RLENGTH)
      if (!match(s, /(^|[[:space:]])(-[a-zA-Z]*m|--message)([[:space:]]+|=)/)) exit
      s = substr(s, RSTART + RLENGTH)
      c = substr(s, 1, 1)
      if (c == "\"") {
        out = ""; i = 2
        while (i <= length(s)) {
          ch = substr(s, i, 1)
          if (ch == "\\" && i < length(s)) { out = out substr(s, i + 1, 1); i += 2; continue }
          if (ch == "\"") break
          out = out ch; i++
        }
      } else if (c == "'"'"'") {
        out = substr(s, 2); sub(/'"'"'.*/, "", out)
      } else {
        out = s; sub(/[[:space:];&|].*/, "", out)
      }
      sub(/\n.*/, "", out)
      print out
    }')
  [ -n "$CAB" ] && FONTE="-m"
fi
[ -z "$CAB" ] && exit 0   # --amend sem -m, commit interativo, mensagem vazia: não é deste hook

TIPO=$(printf '%s' "$CAB" | sed -nE 's/^([a-z]+)(\(([^)]*)\))?!?: (.+)$/\1/p')
ESCOPO=$(printf '%s' "$CAB" | sed -nE 's/^([a-z]+)(\(([^)]*)\))?!?: (.+)$/\3/p')
if [ -z "$TIPO" ]; then
  bloquear "cabeçalho '$CAB' não é Conventional Commits" "Reescreva a primeira linha da mensagem (fonte: $FONTE) como tipo(escopo): assunto, com espaço depois dos dois-pontos."
fi
if em_lista "$TIPO" "$TIPOS_PBI"; then
  if [ -z "$ESCOPO" ]; then
    bloquear "tipo '$TIPO' exige o ID do PBI como escopo" "Escreva $TIPO(<PBI>): assunto, com <PBI> casando $ID_RE (ex.: $TIPO(PBI-123): assunto). Sem PBI, use um tipo livre ($LISTA_LIVRES) se couber."
  fi
  if ! printf '%s' "$ESCOPO" | LC_ALL=C grep -Eq "$ID_ERE"; then
    bloquear "escopo '$ESCOPO' não casa o padrão de ID $ID_RE" "Use o ID do card exatamente como na ferramenta (maiúsculas, hífen, número), ex.: $TIPO(PBI-123): assunto."
  fi
elif ! em_lista "$TIPO" "$TIPOS_LIVRES"; then
  bloquear "tipo '$TIPO' não existe na convenção" "Use um tipo com escopo de PBI ($LISTA_PBI) ou um tipo livre ($LISTA_LIVRES). Hotfix é fix(<PBI de Bug>): assunto."
fi
exit 0
```

  Notas de implementação:
  - O pré-filtro `GITCMD` sai antes de ler config: `npm test` custa ~15 ms; `git commit` completo ~40 ms (medido no macOS com jq). Timeout de 10 s tem folga de 200×.
  - `-F` relativo: primeiro `$PWD/<arquivo>` (a spec diz "relativo ao cwd do payload"; o hook roda no cwd da sessão), depois `<raiz>/<arquivo>` (plano-mestre). Absoluto vale como está.
  - `git symbolic-ref --short -q HEAD` funciona em branch órfã (repo sem commit); `rev-parse --abbrev-ref` é o fallback para HEAD destacado (devolve `HEAD`, que não é `main` — commit em HEAD destacado é validado).
  - O awk (c) acha o **primeiro** `-m` depois de `commit` (`match` é leftmost) — por isso `-m "corpo primeiro" -m "feat(PBI-1): …"` reprova e `-m "feat(PBI-1): a" -m "corpo"` passa.
  - `bloquear` chama o hatch **antes** do deny com o rótulo específico (`R20 · cabeçalho 'arrumei' …`), então o `systemMessage` do hatch diz o que foi liberado.

- [ ] **Passo 5 — rodar e ver VERDE.** `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `fail 0`. Depois, prova rápida de mão (registrar no ledger o exit e a primeira linha do stderr):

```bash
D=$(mktemp -d); cd "$D"; git init -q; git symbolic-ref HEAD refs/heads/feat/PBI-1-x
node -e 'require("fs").writeFileSync("harness.config.json", JSON.stringify({fluxo:{idPadrao:"^[A-Z]+-\\d+$"},versionamento:{resolvidoEm:"2026-09-24"}}))'
printf '%s' '{"tool_input":{"command":"git commit -m \"arrumei\""}}' | bash <repo>/plugins/gabarito-mestre/hooks/guard-versioning.sh; echo "exit=$?"
```
  Esperado: JSON `deny` no stdout, motivo no stderr, `exit=2`.

- [ ] **Passo 6 — commit.** `git add plugins/gabarito-mestre/hooks/guard-versioning.sh plugins/gabarito-mestre/hooks/test/corpus/versionamento.txt plugins/gabarito-mestre/hooks/test/guards.test.mjs docs/ledgers/GM-3.md && git commit -m "feat(GM-3): guard-versioning.sh (R20) + corpus versionamento.txt"`.

---

## T14 — `session-card.sh` + testes

**Fecha:** ORQ-3 (lado do hook). **Spec:** REQ-ORQ-3 (l.187–188). **Review Focus 2** (subpasta de monorepo → raiz). **Depende de T12.** O conteúdo do cartão é responsabilidade de `cartao-sessao.mjs` (T9); este hook não repete nenhuma regra dele.

**Files:**
- Create: `plugins/gabarito-mestre/hooks/session-card.sh`
- Modify: `plugins/gabarito-mestre/hooks/test/guards.test.mjs` (helper `fakePluginRoot` + 1 `describe`)

**Interfaces:**

```
stdin  : JSON SessionStart (drenado; não lido)
env    : CLAUDE_PLUGIN_ROOT (raiz do plugin; fallback: pai de hooks/)
chama  : node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/cartao-sessao.mjs" --root <raiz> --plugin-root "$CLAUDE_PLUGIN_ROOT"
stdout : {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<≤ 40 linhas>"}} ou nada
exit   : sempre 0
```

- [ ] **Passo 1 — testes (VERMELHO).** Cabeçalho de mutações: `*  M9  session-card: remover "| head -n 40"  → "≤ 40 linhas mesmo se o script devolver 60"`. Ao fim de `guards.test.mjs`:

```js
// Plugin falso: só o que os hooks chamam. ${root}/${plugin} no cartão viram os argumentos recebidos.
function fakePluginRoot({
  cartao = ['GABARITO · cartão FAKE', 'root=${root}', 'plugin=${plugin}', 'linha com "aspas", \\ barra\te tab'],
  cartaoExit = 0,
  semCartao = false,
  capacidade = '{"slots":3,"motivo":"load ok"}',
  capacidadeExit = 0,
  semCapacidade = false,
} = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gm-plugin-')));
  mkdirSync(join(dir, 'gates', 'scripts'), { recursive: true });
  if (!semCartao) {
    writeFileSync(join(dir, 'gates', 'scripts', 'cartao-sessao.mjs'), `
const a = process.argv.slice(2);
const root = a[a.indexOf('--root') + 1]; const plugin = a[a.indexOf('--plugin-root') + 1];
const linhas = ${JSON.stringify(cartao)}.map((l) => l.replace('\${root}', root).replace('\${plugin}', plugin));
process.stdout.write(linhas.join('\\n') + '\\n');
process.exit(${cartaoExit});
`);
  }
  if (!semCapacidade) {
    writeFileSync(join(dir, 'gates', 'scripts', 'capacidade.mjs'), `process.stdout.write(${JSON.stringify(capacidade)}); process.exit(${capacidadeExit});`);
  }
  return dir;
}
const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput;

describe('session-card.sh — ORQ-3 (T14)', () => {
  test('injeta additionalContext em SessionStart; --root é o toplevel do git mesmo em apps/api; --plugin-root é CLAUDE_PLUGIN_ROOT', () => {
    const plugin = fakePluginRoot();
    const repo = fixtureRepo();
    const r = runAt('session-card.sh', '', { cwd: join(repo, 'apps', 'api'), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const h = ctx(r);
    assert.equal(h.hookEventName, 'SessionStart');
    assert.match(h.additionalContext, /^GABARITO · cartão FAKE\n/);
    assert.ok(h.additionalContext.includes(`root=${repo}\n`), h.additionalContext);
    assert.ok(h.additionalContext.includes(`plugin=${plugin}\n`), h.additionalContext);
  });
  test('sem .git: --root é o cwd (Review Focus 2)', () => {
    const plugin = fakePluginRoot();
    const solto = fixtureRepo({ git: false });
    const r = runAt('session-card.sh', '', { cwd: join(solto, 'apps', 'api'), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    assert.ok(ctx(r).additionalContext.includes(`root=${join(solto, 'apps', 'api')}\n`));
  });
  test('JSON válido com aspas, barra invertida e tab no cartão', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot() }, event: 'SessionStart' });
    assert.ok(ctx(r).additionalContext.includes('linha com "aspas", \\ barra\te tab'));
  });
  test('≤ 40 linhas mesmo se o script devolver 60', () => {
    const plugin = fakePluginRoot({ cartao: Array.from({ length: 60 }, (_, i) => `linha ${i + 1}`) });
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'SessionStart' });
    const linhas = ctx(r).additionalContext.split('\n');
    assert.equal(linhas.length, 40);
    assert.equal(linhas[39], 'linha 40');
  });
  test('script sai com 1 → exit 0, stdout vazio, fail-open declarado em stderr', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ cartaoExit: 1 }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cartao-sessao\.mjs saiu com 1.*fail-open declarado/);
  });
  test('CLAUDE_PLUGIN_ROOT sem gates/scripts/cartao-sessao.mjs → exit 0, fail-open declarado', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ semCartao: true }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /cartao-sessao\.mjs ausente.*fail-open declarado/);
  });
  test('cartão vazio (só espaço) → exit 0 sem saída', () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo(), env: { CLAUDE_PLUGIN_ROOT: fakePluginRoot({ cartao: ['', '  '] }) }, event: 'SessionStart' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('stdin vazio (sem JSON) não quebra', () => {
    const r = spawnSync('bash', [join(HOOKS, 'session-card.sh')], { input: '', encoding: 'utf8', cwd: fixtureRepo(), env: cleanEnv({ CLAUDE_PLUGIN_ROOT: fakePluginRoot() }) });
    assert.equal(r.status, 0);
    assert.equal(ctx({ stdout: r.stdout }).hookEventName, 'SessionStart');
  });
  const REAL = join(PLUGIN, 'gates', 'scripts', 'cartao-sessao.mjs');
  test('smoke com o cartao-sessao.mjs real: repo sem onboarding → uma linha "sem onboarding"', { skip: !existsSync(REAL) && 'T9 ainda não integrada' }, () => {
    const r = runAt('session-card.sh', '', { cwd: fixtureRepo({ config: {} }), env: { CLAUDE_PLUGIN_ROOT: PLUGIN }, event: 'SessionStart' });
    assert.equal(r.code, 0, r.stderr);
    const texto = ctx(r).additionalContext;
    assert.match(texto, /sem onboarding/);
    assert.equal(texto.split('\n').length, 1);
  });
});
```

- [ ] **Passo 2 — rodar e ver VERMELHO.** Esperado: todos os testes do `describe` falham com `No such file or directory` (exit 127); o smoke fica `skipped` se T9 não estiver integrada (se estiver, falha também).

- [ ] **Passo 3 — implementar.** Crie `plugins/gabarito-mestre/hooks/session-card.sh`:

```bash
#!/usr/bin/env bash
# gabarito-mestre · session-card.sh — implementa a ORQ-3 (cartão de sessão, ≤ 40 linhas).
# SessionStart (startup|resume|clear|compact). Não lê tool_input: o payload de SessionStart não tem comando.
# Roda `gates/scripts/cartao-sessao.mjs` do plugin com a raiz do repo (git toplevel → cwd) e injeta o texto em
# `hookSpecificOutput.additionalContext`. Nunca bloqueia: qualquer falha é FAIL-OPEN DECLARADO (stderr, exit 0).
# Quem decide o conteúdo (onboarding ausente → uma linha; PBI/Epic; slots; doctor…) é o script Node (T9);
# este hook só resolve raiz e plugin-root, delimita 40 linhas e embala o JSON.
set -u
. "$(dirname "$0")/_common.sh"
cat >/dev/null 2>&1 || true   # drena o stdin (JSON de SessionStart) sem depender dele

ROOT=$(gabarito_repo_root)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SCRIPT="$PLUGIN_ROOT/gates/scripts/cartao-sessao.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "gabarito-mestre: node ausente — cartão de sessão não gerado (fail-open declarado, G9)" >&2
  exit 0
fi
if [ ! -f "$SCRIPT" ]; then
  echo "gabarito-mestre: $SCRIPT ausente — cartão de sessão não gerado (fail-open declarado, G9)" >&2
  exit 0
fi

CARTAO=$(node "$SCRIPT" --root "$ROOT" --plugin-root "$PLUGIN_ROOT")
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "gabarito-mestre: cartao-sessao.mjs saiu com $STATUS — cartão não injetado (fail-open declarado, G9)" >&2
  exit 0
fi
CARTAO=$(printf '%s\n' "$CARTAO" | head -n 40)
[ -z "${CARTAO//[[:space:]]/}" ] && exit 0

ESC=$(gabarito_json_escape "$CARTAO")
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESC"
exit 0
```

  Notas: o stderr do script Node passa direto para o stderr do hook (o Claude Code mostra em `--debug`); não é capturado. `head -n 40` é cinto e suspensório — `montarCartao` já garante ≤ 40 (contrato T9), mas o hook não confia nisso (mutação M9).

- [ ] **Passo 4 — rodar e ver VERDE.** `fail 0`. Prova de mão no próprio repo do plugin (que não é onboarded): `cd <repo> && printf '{"hook_event_name":"SessionStart"}' | CLAUDE_PLUGIN_ROOT=$PWD/plugins/gabarito-mestre bash plugins/gabarito-mestre/hooks/session-card.sh` → uma linha `GABARITO: harness sem onboarding …` dentro do JSON (se T9 integrada) ou aviso de fail-open (se não). Registre no ledger qual dos dois.

- [ ] **Passo 5 — commit.** `git add plugins/gabarito-mestre/hooks/session-card.sh plugins/gabarito-mestre/hooks/test/guards.test.mjs docs/ledgers/GM-3.md && git commit -m "feat(GM-3): session-card.sh (SessionStart, cartão ≤ 40 linhas)"`.

---

## T15 — `remind-orchestrator.sh` + testes

**Fecha:** ORQ-4. **Spec:** REQ-ORQ-4 (l.190–191) — só quando `lembretePorPrompt: true`; uma linha `R21: despache, não implemente · slots: n`; **nunca** exit 2; default desligado. **Depende de T12.**

**Files:**
- Create: `plugins/gabarito-mestre/hooks/remind-orchestrator.sh`
- Modify: `plugins/gabarito-mestre/hooks/test/guards.test.mjs` (1 `describe`)

**Interfaces:**

```
stdin  : JSON UserPromptSubmit (drenado; o prompt não é lido)
env    : CLAUDE_PLUGIN_ROOT
lê     : <raiz>/harness.config.json (orquestracao.lembretePorPrompt, orquestracao.paralelismo.simultaneos)
chama  : node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/capacidade.mjs" --root <raiz> --json  (campo `slots`)
stdout : {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"R21: despache, não implemente · slots: <n>[ (config)]"}} ou nada
exit   : sempre 0
```

- [ ] **Passo 1 — testes (VERMELHO).** Cabeçalho de mutações: `*  M10 remind-orchestrator: trocar o exit 0 de "lembrete desligado" por exit 2  → "lembretePorPrompt false" e "nunca exit 2"`. Ao fim de `guards.test.mjs`:

```js
describe('remind-orchestrator.sh — ORQ-4 (T15)', () => {
  const ligado = { orquestracao: { lembretePorPrompt: true, paralelismo: { simultaneos: 2, teto: 4 } } };
  const remind = (cwd, plugin) => runAt('remind-orchestrator.sh', '', { cwd, env: { CLAUDE_PLUGIN_ROOT: plugin }, event: 'UserPromptSubmit' });

  test('lembretePorPrompt true: uma linha R21 com slots vindos de capacidade.mjs', () => {
    const r = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '{"slots":3,"motivo":"load ok"}' }));
    assert.equal(r.code, 0, r.stderr);
    const h = ctx(r);
    assert.equal(h.hookEventName, 'UserPromptSubmit');
    assert.equal(h.additionalContext, 'R21: despache, não implemente · slots: 3');
  });
  test('lembretePorPrompt false: exit 0, stdout vazio', () => {
    const r = remind(fixtureRepo({ config: { orquestracao: { lembretePorPrompt: false } } }), fakePluginRoot());
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
  test('config sem a chave: desligado, fail-open declarado em stderr; sem harness.config.json: silêncio total', () => {
    const r1 = remind(fixtureRepo({ config: { fluxo: {} } }), fakePluginRoot());
    assert.equal(r1.code, 0); assert.equal(r1.stdout, ''); assert.match(r1.stderr, /lembretePorPrompt.*fail-open declarado/);
    const r2 = remind(fixtureRepo(), fakePluginRoot());
    assert.equal(r2.code, 0); assert.equal(r2.stdout, ''); assert.equal(r2.stderr, '');
  });
  test('capacidade.mjs falha ou falta: slots vêm de paralelismo.simultaneos marcados "(config)"', () => {
    const r1 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: '', capacidadeExit: 1 }));
    assert.equal(ctx(r1).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r2 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ semCapacidade: true }));
    assert.equal(ctx(r2).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
    const r3 = remind(fixtureRepo({ config: ligado }), fakePluginRoot({ capacidade: 'não é json' }));
    assert.equal(ctx(r3).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  test('sem simultaneos no config e sem capacidade: default 2 (config)', () => {
    const r = remind(fixtureRepo({ config: { orquestracao: { lembretePorPrompt: true } } }), fakePluginRoot({ semCapacidade: true }));
    assert.equal(ctx(r).additionalContext, 'R21: despache, não implemente · slots: 2 (config)');
  });
  test('nunca exit 2: JSON inválido, stdin vazio, plugin root inexistente', () => {
    const casos = [
      remind(fixtureRepo({ config: '{"orquestracao": {' }), fakePluginRoot()),
      remind(fixtureRepo({ config: ligado }), '/caminho/que/nao/existe'),
      { code: spawnSync('bash', [join(HOOKS, 'remind-orchestrator.sh')], { input: '', encoding: 'utf8', cwd: fixtureRepo({ config: ligado }), env: cleanEnv({ CLAUDE_PLUGIN_ROOT: fakePluginRoot() }) }).status },
    ];
    for (const r of casos) assert.equal(r.code, 0);
  });
  test('monorepo: lembrete ligado na raiz vale em apps/api', () => {
    const repo = fixtureRepo({ config: ligado });
    const r = remind(join(repo, 'apps', 'api'), fakePluginRoot());
    assert.match(ctx(r).additionalContext, /^R21: despache/);
  });
});
```

- [ ] **Passo 2 — rodar e ver VERMELHO.** Esperado: `No such file or directory` em todos (o teste "nunca exit 2" passa por acidente com exit 127 ≠ 2 — não: ele exige `0`, então falha também).

- [ ] **Passo 3 — implementar.** Crie `plugins/gabarito-mestre/hooks/remind-orchestrator.sh`:

```bash
#!/usr/bin/env bash
# gabarito-mestre · remind-orchestrator.sh — implementa a ORQ-4 (lembrete R21 por prompt).
# UserPromptSubmit, timeout 5. Só age quando `orquestracao.lembretePorPrompt: true` em <raiz>/harness.config.json
# (default desligado). Injeta UMA linha em additionalContext: "R21: despache, não implemente · slots: <n>".
# <n> vem de `gates/scripts/capacidade.mjs --json` (campo `slots`); se o script falhar ou faltar, usa
# `orquestracao.paralelismo.simultaneos` do config marcado "(config)". NUNCA sai com 2: este hook não bloqueia prompt.
set -u
. "$(dirname "$0")/_common.sh"
cat >/dev/null 2>&1 || true   # drena o stdin (JSON de UserPromptSubmit); o prompt em si não é lido

ROOT=$(gabarito_repo_root)
if [ ! -f "$ROOT/harness.config.json" ]; then
  exit 0   # repo sem harness: silêncio — ORQ-4 é opt-in, não há o que declarar a cada prompt
fi
LEMBRETE=$(gabarito_config_get orquestracao.lembretePorPrompt "$ROOT")
if [ -z "$LEMBRETE" ]; then
  echo "gabarito-mestre: harness.config.json sem orquestracao.lembretePorPrompt — lembrete R21 desligado (fail-open declarado, G9)" >&2
  exit 0
fi
[ "$LEMBRETE" = "true" ] || exit 0

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CAP="$PLUGIN_ROOT/gates/scripts/capacidade.mjs"
SLOTS=""; FONTE=""
if command -v node >/dev/null 2>&1 && [ -f "$CAP" ]; then
  SAIDA=$(node "$CAP" --root "$ROOT" --json 2>/dev/null) || SAIDA=""
  if [ -n "$SAIDA" ]; then
    SLOTS=$(printf '%s' "$SAIDA" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const s=j&&j.slots;process.stdout.write(Number.isInteger(s)?String(s):"")}catch(e){process.stdout.write("")}})' 2>/dev/null)
  fi
fi
if [ -z "$SLOTS" ]; then
  SLOTS=$(gabarito_config_get orquestracao.paralelismo.simultaneos "$ROOT")
  [ -z "$SLOTS" ] && SLOTS=2
  FONTE=" (config)"
fi

LINHA="R21: despache, não implemente · slots: ${SLOTS}${FONTE}"
ESC=$(gabarito_json_escape "$LINHA")
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$ESC"
exit 0
```

  Notas: `capacidade.mjs --json` mede load/memória/disco em dezenas de ms (contrato T6, "sempre 0"); como o hook roda a **cada prompt**, o custo é pago só por quem ligou `lembretePorPrompt`. O parse do `slots` usa `node -e` porque, se chegou ali, `node` existe. Não há `set -e` de propósito: nenhum erro pode virar exit ≠ 0.

- [ ] **Passo 4 — rodar e ver VERDE.** `fail 0`. Prova de mão: num tmpdir com `{"orquestracao":{"lembretePorPrompt":true}}`, `printf '{}' | CLAUDE_PLUGIN_ROOT=<repo>/plugins/gabarito-mestre bash <repo>/plugins/gabarito-mestre/hooks/remind-orchestrator.sh` → linha R21 com `slots` medido por `capacidade.mjs` real (T6) ou `2 (config)` se ausente. Registre no ledger.

- [ ] **Passo 5 — commit.** `git add plugins/gabarito-mestre/hooks/remind-orchestrator.sh plugins/gabarito-mestre/hooks/test/guards.test.mjs docs/ledgers/GM-3.md && git commit -m "feat(GM-3): remind-orchestrator.sh (UserPromptSubmit, R21 opt-in)"`.

---

## T16 — `hooks.json` com os três hooks novos + `claude plugin validate --strict`

**Fecha:** ORQ-3/4, VER-2 (registro). **Depende de T13, T14, T15.** Roda sozinha: `hooks.json` é contenda.

**Files:**
- Modify: `plugins/gabarito-mestre/hooks/hooks.json`
- Modify: `plugins/gabarito-mestre/hooks/test/guards.test.mjs` (1 `describe`)

**Interfaces:** `hooks.json` é lido pelo Claude Code ao carregar o plugin; `plugin.json` **não** ganha chave `hooks` (M-README: "Duplicate hooks file detected" quebra o load — Global Constraints). `SessionStart` com `matcher` de origem; `UserPromptSubmit` sem `matcher` (o evento não tem). `PreToolUse` mantém a ordem: destructive, production, versioning.

- [ ] **Passo 1 — teste (VERMELHO).** Cabeçalho de mutações: `*  M11 hooks.json: apagar o matcher de SessionStart  → "SessionStart tem session-card com matcher"`. Ao fim de `guards.test.mjs`:

```js
describe('hooks.json — registro dos hooks (T16)', () => {
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const cmds = (grupo) => grupo.hooks.map((h) => h.command);

  test('PreToolUse/Bash: os três guards, nesta ordem, timeout 10, shell bash', () => {
    assert.equal(cfg.PreToolUse.length, 1);
    const g = cfg.PreToolUse[0];
    assert.equal(g.matcher, 'Bash');
    assert.deepEqual(cmds(g), [
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-destructive.sh"',
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-production.sh"',
      'bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard-versioning.sh"',
    ]);
    for (const h of g.hooks) { assert.equal(h.type, 'command'); assert.equal(h.shell, 'bash'); assert.equal(h.timeout, 10); }
  });
  test('SessionStart tem session-card com matcher startup|resume|clear|compact e timeout 30', () => {
    assert.equal(cfg.SessionStart.length, 1);
    const g = cfg.SessionStart[0];
    assert.equal(g.matcher, 'startup|resume|clear|compact');
    assert.deepEqual(cmds(g), ['bash "${CLAUDE_PLUGIN_ROOT}/hooks/session-card.sh"']);
    assert.equal(g.hooks[0].timeout, 30);
  });
  test('UserPromptSubmit tem remind-orchestrator sem matcher e timeout 5', () => {
    assert.equal(cfg.UserPromptSubmit.length, 1);
    const g = cfg.UserPromptSubmit[0];
    assert.equal(g.matcher, undefined);
    assert.deepEqual(cmds(g), ['bash "${CLAUDE_PLUGIN_ROOT}/hooks/remind-orchestrator.sh"']);
    assert.equal(g.hooks[0].timeout, 5);
  });
  test('todo comando aponta para um script existente em hooks/ com shebang bash', () => {
    for (const grupos of Object.values(cfg)) for (const g of grupos) for (const h of g.hooks) {
      const m = h.command.match(/^bash "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([a-z-]+\.sh)"$/);
      assert.ok(m, h.command);
      const p = join(HOOKS, m[1]);
      assert.ok(existsSync(p), p);
      assert.match(readFileSync(p, 'utf8').split('\n')[0], /^#!\/usr\/bin\/env bash$/);
    }
  });
  test('plugin.json não declara "hooks" (chave duplicada quebra o load)', () => {
    const pj = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(pj.hooks, undefined);
  });
});
```

- [ ] **Passo 2 — rodar e ver VERMELHO.** Falham "PreToolUse/Bash: os três guards" (só há dois), "SessionStart…" (`cfg.SessionStart` é `undefined` → TypeError) e "UserPromptSubmit…". Os outros dois passam.

- [ ] **Passo 3 — implementar.** Substitua `plugins/gabarito-mestre/hooks/hooks.json` por:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/guard-destructive.sh\"",
            "shell": "bash",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/guard-production.sh\"",
            "shell": "bash",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/guard-versioning.sh\"",
            "shell": "bash",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-card.sh\"",
            "shell": "bash",
            "timeout": 30
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/remind-orchestrator.sh\"",
            "shell": "bash",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- [ ] **Passo 4 — rodar e ver VERDE.** `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"` → `fail 0`. Depois:

```bash
claude plugin validate ./plugins/gabarito-mestre --strict
```
  Esperado: sem erro, sem aviso sobre hooks. Se avisar sobre `matcher` em `UserPromptSubmit` ou sobre chaves desconhecidas, a saída é achado (b) para o ledger — não "conserte" mudando o evento.

- [ ] **Passo 5 — carga real do plugin (medição, registrada no ledger).** Numa sessão de Claude Code com o marketplace local apontando para este checkout (`claude plugin marketplace add <repo>` → `claude plugin install gabarito-mestre@<marketplace>`; se já instalado, `claude plugin update`), rode `claude plugin list` e confira que `gabarito-mestre` carrega **sem** `Duplicate hooks file detected`; abra uma sessão em um repo descartável com `harness.config.json` completo (saída do onboarding T5) e confirme: (1) o cartão aparece no contexto inicial (`/context` ou `--debug`), (2) `git commit -m "arrumei"` é bloqueado com a mensagem R20, (3) com `lembretePorPrompt: true` a linha R21 aparece após um prompt. Escreva no ledger os três resultados com data. Sem sessão disponível: escreva "NÃO MEDIDO — carga real pendente" (não invente).

- [ ] **Passo 6 — commit.** `git add plugins/gabarito-mestre/hooks/hooks.json plugins/gabarito-mestre/hooks/test/guards.test.mjs docs/ledgers/GM-3.md && git commit -m "feat(GM-3): hooks.json registra guard-versioning, session-card e remind-orchestrator"`.

---

## Fecho da fase (orquestrador, com ok do usuário)

- [ ] `node --test plugins/gabarito-mestre/hooks/test/guards.test.mjs` verde; contagem final de testes anotada no ledger ao lado da contagem inicial.
- [ ] Revisor (`gabarito-revisor`, instância diferente da que implementou) executa M5–M11 e registra o veredito por mutação; qualquer mutação sobrevivente é BLOCKER.
- [ ] `claude plugin validate ./plugins/gabarito-mestre --strict` passa.
- [ ] Gate contado: `grep -cE '^(PASSA|BLOQUEIA|HATCH)' plugins/gabarito-mestre/hooks/test/corpus/versionamento.txt` ≥ 30; `grep -cE '^PASSA' …` ≥ 12; `grep -cE '^BLOQUEIA' …` ≥ 12; `grep -cE '^(PASSA|BLOQUEIA)[ ]+.*worktree' …` ≥ 4; `grep -cE '^HATCH' …` ≥ 2.
- [ ] `README.md` do repo **não** é tocado nesta fase — a seção "Hooks" ainda diz "Dois `PreToolUse` sobre `Bash`"; T25 (Fase 6) a atualiza com os três hooks novos, o hatch `GABARITO_ALLOW_VERSIONING` e a nota "hatches não cruzam fora do par". Anote no ledger como pendência para T25.
- [ ] PR `enabler/GM-3-hooks → main` com título `enabler(GM-3): hooks de versionamento, cartão de sessão e lembrete R21`; corpo com a tabela de mutações e os números do gate. A Fase 4 só começa depois do merge.

## Decisões tomadas neste plano (fora do plano-mestre; o executor não reabre)

1. **Formato do corpus `versionamento.txt`:** `<VEREDITO> <espaços> <comando>` com `\n` literal como separador multilinha. Não existia separador multilinha em `guards.test.mjs` (o cabeçalho diz que casos multilinha ficam inline); este é o primeiro corpus com veredito por linha porque legítimas e inválidas convivem no mesmo arquivo.
2. **`-F <arquivo>` relativo:** resolve por `$PWD` primeiro (spec: "relativo ao cwd do payload") e por `<raiz>` depois (plano-mestre); absoluto vale como está; ausente → fail-open com aviso.
3. **`gabarito_ere`:** regex do JSON usa `\d` (estilo JavaScript, como `versionamento-check.mjs` o consome); BSD `grep -E` não entende `\d`, então o hook traduz `\d`→`[0-9]` e `\w`→`[A-Za-z0-9_]` antes de usar. Sem isso, `branchPadrao` do contrato nunca casaria no macOS.
4. **`remind-orchestrator.sh` sem `harness.config.json`:** silêncio total (exit 0, sem stderr) — ORQ-4 é opt-in e avisar a cada prompt num repo sem harness seria ruído; com config **sem** a chave, avisa "fail-open declarado" (Global Constraints). `slots` vem de `capacidade.mjs`; fallback `simultaneos` do config marcado `(config)`.
5. **Branch atual por `git symbolic-ref --short -q HEAD`** (fallback `rev-parse --abbrev-ref`): funciona em branch órfã (fixtures sem commit) e devolve `HEAD` em detached — commit em HEAD destacado é validado, não isento.
6. **"Cru" não é "cego": menção ≠ commit.** O hook não usa `gabarito_scan_text` (que apaga `git commit -m`), mas (i) remove corpos de heredoc que só escrevem arquivo (`gabarito_strip_write_heredocs`, a metade awk de `scan_text`, agora função própria) e (ii) só reconhece `git` em **posição de comando** (início de linha/segmento, após `; & | ( \` $(`, com atribuições de env antes — é assim que o hatch inline chega). Motivo: `echo 'git commit -m "wip"'` e `cat >> notas.md <<'EOF'` com um `git commit -m` no corpo são exatamente a classe dos 3 falsos positivos medidos no R2 em 7.037 comandos. Limite declarado: `cat > msg.txt <<'EOF' … EOF; git commit -F msg.txt` num só comando cai no fail-open de "-F ausente" (o arquivo ainda não existe quando o hook roda).

## Emendas (2026-09-24, revisão cruzada)

- #16: pré-condição do ledger `GM-3.md` no cabeçalho novo de `referencia.md §2.3` (Fase 4, T18): `PBI: GM-3 · Epic: (b) — repo do plugin, sem onboarding`, `## LER PRIMEIRO — <data>`, Pre-flight, Progresso, CORTE, FECHO.

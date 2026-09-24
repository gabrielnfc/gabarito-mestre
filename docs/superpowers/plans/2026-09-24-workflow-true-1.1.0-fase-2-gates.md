# Gabarito Mestre 1.1.0 — Fase 2: gates (T5–T11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar os quatro scripts novos dos gates (`onboarding-config.mjs`, `capacidade.mjs`, `versionamento-check.mjs`, `cartao-sessao.mjs`), as 8 checagens novas e o `--cache` do doctor, o `instalar.sh` com `--atualizar` / `--gates-substituir` / `--codeowners` + `.instalado.json` + emenda do `.gitignore`, e o `gates/package.json` 1.1.0 — tudo com teste que reprova sem a implementação.

**Architecture:** Scripts Node ESM zero-dependência em `plugins/gabarito-mestre/gates/scripts/`, cada um com `main()` fino sobre funções puras exportadas; medidas e relógio injetados por env/opts para teste; **fail-open declarado** (stderr com `fail-open declarado (G9)`, exit 0, sem stack trace) sempre que `harness.config.json` está ausente, vazio, inválido ou sem a seção que o script precisa. `run()` do doctor continua puro; escrita de cache só em `main()` com `--cache`. `instalar.sh` continua bash 3.2 e só toca `tools/gabarito-gates/` por `--gates-substituir` com hash conferido (ADR-TIM-1).

**Tech Stack:** Node ≥ 22.18 (`node:test`, `node:assert/strict`, `node:fs`, `node:os`, `node:child_process`, `fs.statfsSync`, `os.availableParallelism`), bash 3.2 + `shasum -a 256` (fallback `sha256sum`), `git` (fixtures de T7/T9 são repositórios reais em `tmpdir`).

**Branch:** `enabler/GM-2-gates` a partir de `main` (com a Fase 1 integrada). **Ledger:** `docs/ledgers/GM-2.md`. **Commits:** Conventional Commits com escopo `GM-2` — `feat(GM-2): …` para implementação, `test(GM-2): …` para o passo vermelho.

**Plano-mestre (contrato):** `docs/superpowers/plans/2026-09-24-workflow-true-1.1.0.md` — seção "Contrato de interfaces" é LEI: nomes de CLI, exports, formatos de cache, formato do cartão, checagens do doctor, flags do `instalar.sh`, fórmula de calibração. **Spec:** `docs/superpowers/specs/2026-09-24-workflow-true-design.md` — REQ-ONB-5/6/7, PAR-1, VER-3, DOC-1, DOC-2, CTX-1, ORQ-3, ORQ-5, ORQ-6, FLX-8, TIM-2, ADR-TIM-1, tabela "Testes e gates".

**Ordem e paralelismo (do grafo do mestre):** T5, T6, T7 em paralelo (arquivos disjuntos) → T8 (importa `versionamento-check.mjs`) → T9 (importa `capacidade.mjs` e executa o doctor) → T10 em paralelo com qualquer um (não toca `gates/`) → T11 por último e sozinho (`gates/package.json` é contenda).

**Fatos medidos ao escrever este plano (a):**
- Doctor 1.0.1: 19 checagens; `run(root, overrides)` faz `JSON.parse` direto do `harness.config.json` (JSON inválido hoje derruba com stack trace — T8 conserta).
- Uma fixture 1.0.1 com todos os gates de nível 1 e 2 (`src/db.ts` com `$extends(massMutationGuard())`, `strictUndefinedChecks`, `assertNotProduction`; `.gitignore` com `.env`; `.env.example` vazio; 3 atestados; `docs/specs/`, `docs/plans/`, `docs/backlog.md`; `docs/harness/ledger.md`; PR template com `requisito migration teardown`; `docs/harness/prompts.md`; workflow com `unit integration quality migrations-guard`; `scripts/migrations-guard.mjs` com `DESTRUCTIVE_PATTERN`) mede **nível 2** no doctor atual — é a fixture base de T8.
- `ps -axo pid,ppid,%cpu,rss` no macOS em locale pt-BR imprime `%CPU` com **vírgula** (`0,5`); `capacidade.mjs` roda `ps` com `LC_ALL=C` **e** aceita vírgula ao parsear.
- `vm_stat` imprime `page size of 16384 bytes` e linhas `Pages free: 5125.` (ponto no fim).
- `fs.statfsSync` e `os.availableParallelism` existem no Node 24 (e desde 18.15/18.14).
- `%cpu` de `ps` é média desde o início do processo (não instantânea) — aceito como aproximação; é o que a spec pede.
- **Todo o código deste plano foi extraído dos blocos abaixo e executado numa cópia descartável do plugin** (scratchpad, sem tocar o repo): `npm test` nos gates = **199 testes `.mjs` + 27 `.ts` = 226 verdes, 0 falhas**; `instalar.test.sh` = **38 ok, 0 falhas** (bash 3.2.57, macOS). A contagem oficial continua sendo a medida em T11.4 no repo.

---

## Pré-condições

- [ ] Fase 1 integrada em `main` (`reference/fluxo.md` com 7 seções, `templates/fluxo/*.md`, `reference/ferramentas-mcp.json`, `docs/backlog.md`).
- [ ] `git checkout -b enabler/GM-2-gates main`.
- [ ] `docs/ledgers/GM-2.md` criado com o cabeçalho **novo** de `referencia.md §2.3` (formato da Fase 4, T18): primeira linha `# Ledger — PBI: GM-2 · Epic: (b) — repo do plugin, sem onboarding   Plano: docs/superpowers/plans/2026-09-24-workflow-true-1.1.0-fase-2-gates.md   Branch: enabler/GM-2-gates @ <sha>   Spec (autoridade): docs/superpowers/specs/2026-09-24-workflow-true-design.md`, e a seção `## LER PRIMEIRO — <AAAA-MM-DD>` (≤ 5 linhas) apontando para este plano; depois `## Pre-flight — pares produz × consome`, `## Progresso`, `## CORTE DA SESSÃO (com motivo)`, `## FECHO — PR mergeada`.
- [ ] Suíte atual verde antes de qualquer mudança: `cd plugins/gabarito-mestre/gates && npm test` — anote a contagem no ledger (é a base da "contagem medida" do gate de fase).
- [ ] Nenhuma task faz `git push`, PR ou merge (R1).

---

## T5 — `onboarding-config.mjs` (REQ-ONB-7, REQ-ONB-5)

**Files**
- Criar: `plugins/gabarito-mestre/gates/scripts/onboarding-config.mjs`
- Criar: `plugins/gabarito-mestre/gates/test/onboarding-config.test.mjs`

**Interfaces**
- Consumes: `<root>/harness.config.json` (pode não existir, estar vazio ou inválido); `<root>/.claude/settings.json` (idem); `git rev-parse --show-toplevel` (fallback cwd).
- Produces (CLI): `node onboarding-config.mjs [--root <dir>] --set <fluxo|versionamento|orquestracao|contexto> '<json>' [--dry-run]` · `node onboarding-config.mjs [--root <dir>] --settings '<json>' [--dry-run]`. Exit **0** ok (inclusive fail-open), **1** JSON inválido no argumento ou seção desconhecida. Stdout: `[ONB-7] harness.config.json atualizado` + uma linha por chave do diff (`+ fluxo.ferramenta = "clickup"` / `~ fluxo.escrita: false → true`).
- Produces (ESM): `mergeDeep(base, patch)` — objetos: recursivo; arrays: substitui; `undefined`: ignora; nunca remove · `aplicar(root, secao, patch, { dryRun }) → { antes, depois, diff: string[] }` · `aplicarSettings(root, patch, { dryRun }) → { antes, depois, diff }` (mesmo mecanismo sobre `.claude/settings.json`) · `diffChaves(antes, depois) → string[]` · `escreverAtomico(caminho, obj)` · `lerJson(caminho)` (lança `ArquivoInvalido` em JSON inválido; `{}` para ausente/vazio) · `raizDoRepo(cwd)` · `SECOES`, `CONFIG_FILE`, `SETTINGS_FILE`, `ArquivoInvalido`.
- Fail-open: arquivo-alvo com JSON inválido → **não escreve por cima**, stderr `[ONB-7] <arquivo>: JSON inválido (…) — não escrevo por cima de arquivo que não consigo ler (fail-open declarado (G9))`, exit 0. Ausente ou vazio → tratado como `{}` e criado.

**Mutações prescritas (cabeçalho do teste):** M1 `mergeDeep` substitui objeto em vez de fundir (apaga chave desconhecida) · M2 arrays fundidos por índice em vez de substituídos · M3 `--dry-run` grava mesmo assim · M4 grava por cima de `harness.config.json` inválido · M5 `undefined` no patch apaga a chave.

**Steps**

- [ ] **T5.1 — Teste vermelho.** Crie `plugins/gabarito-mestre/gates/test/onboarding-config.test.mjs`:

```js
/**
 * Testes do ONB-7 — onboarding-config.
 *
 * O que está em jogo é R2 sobre a config do usuário: o script grava seções novas em
 * `harness.config.json` e emenda `.claude/settings.json` SEM remover nada que já estava lá.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  mergeDeep substitui objeto em vez de fundir (apaga chave desconhecida)
 *  M2  arrays fundidos por índice em vez de substituídos
 *  M3  --dry-run grava mesmo assim
 *  M4  grava por cima de harness.config.json com JSON inválido
 *  M5  `undefined` no patch apaga a chave
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeDeep, aplicar, aplicarSettings, diffChaves, lerJson, ArquivoInvalido, SECOES } from '../scripts/onboarding-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'onboarding-config.mjs');

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'onb-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const cli = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const lerCfg = (dir) => JSON.parse(readFileSync(join(dir, 'harness.config.json'), 'utf8'));

const TEMPLATE = JSON.stringify(
  {
    _comment: 'TEMPLATE — ajuste ao seu repo.',
    docsDir: 'docs',
    quality: { baselineFile: '.quality/baseline.json', duplication: { report: '.quality/jscpd.json', ceiling: 2 } },
    deployOrder: [{ label: 'staging', deploy: ['SVC_WORKER', 'SVC_API'] }],
  },
  null,
  2,
);

describe('mergeDeep — chave a chave, nunca remove', () => {
  test('objetos fundem recursivamente e chave desconhecida sobrevive', () => {
    const out = mergeDeep({ a: { x: 1, y: 2 }, z: 9 }, { a: { y: 3 } });
    assert.deepEqual(out, { a: { x: 1, y: 3 }, z: 9 });
  });
  test('arrays são SUBSTITUÍDOS, não fundidos por índice', () => {
    assert.deepEqual(mergeDeep({ l: [1, 2, 3] }, { l: [9] }), { l: [9] });
  });
  test('undefined no patch é ignorado; null é valor', () => {
    assert.deepEqual(mergeDeep({ a: 1, b: 2 }, { a: undefined, b: null }), { a: 1, b: null });
  });
  test('não muta a base', () => {
    const base = { a: { x: 1 } };
    mergeDeep(base, { a: { y: 2 } });
    assert.deepEqual(base, { a: { x: 1 } });
  });
  test('patch que não é objeto devolve cópia da base', () => {
    assert.deepEqual(mergeDeep({ a: 1 }, 'x'), { a: 1 });
    assert.deepEqual(mergeDeep(null, { a: 1 }), { a: 1 });
  });
});

describe('aplicar — harness.config.json', () => {
  test('grava a seção nova, preserva _comment, deployOrder e a ordem das chaves', () => {
    const dir = repo({ 'harness.config.json': TEMPLATE });
    const r = aplicar(dir, 'fluxo', { ferramenta: 'clickup', idPadrao: '^[A-Z]+-\\d+$' });
    const cfg = lerCfg(dir);
    assert.equal(cfg._comment, 'TEMPLATE — ajuste ao seu repo.');
    assert.deepEqual(cfg.deployOrder, JSON.parse(TEMPLATE).deployOrder);
    assert.deepEqual(cfg.fluxo, { ferramenta: 'clickup', idPadrao: '^[A-Z]+-\\d+$' });
    assert.deepEqual(Object.keys(cfg).slice(0, 4), ['_comment', 'docsDir', 'quality', 'deployOrder']);
    assert.deepEqual(r.diff, ['+ fluxo = {"ferramenta":"clickup","idPadrao":"^[A-Z]+-\\\\d+$"}']);
  });
  test('segunda gravação funde e o diff mostra só o que mudou', () => {
    const dir = repo({ 'harness.config.json': TEMPLATE });
    aplicar(dir, 'fluxo', { ferramenta: 'clickup', escrita: false, mapeamento: { FL3: 'Space' } });
    const r = aplicar(dir, 'fluxo', { escrita: true, mapeamento: { FL2: 'Folder' } });
    assert.deepEqual(lerCfg(dir).fluxo, { ferramenta: 'clickup', escrita: true, mapeamento: { FL3: 'Space', FL2: 'Folder' } });
    assert.deepEqual(r.diff, ['~ fluxo.escrita: false → true', '+ fluxo.mapeamento.FL2 = "Folder"']);
  });
  test('config ausente: cria o arquivo; config vazia (0 bytes): trata como {}', () => {
    const a = repo();
    aplicar(a, 'contexto', { nucleoMaxBytes: 17291 });
    assert.deepEqual(lerCfg(a), { contexto: { nucleoMaxBytes: 17291 } });
    const b = repo({ 'harness.config.json': '' });
    aplicar(b, 'contexto', { apendiceMaxBytes: 4096 });
    assert.deepEqual(lerCfg(b), { contexto: { apendiceMaxBytes: 4096 } });
  });
  test('config inválida: lança ArquivoInvalido e NÃO escreve por cima', () => {
    const dir = repo({ 'harness.config.json': '{"docsDir": ' });
    assert.throws(() => aplicar(dir, 'fluxo', { ferramenta: 'arquivos' }), ArquivoInvalido);
    assert.equal(readFileSync(join(dir, 'harness.config.json'), 'utf8'), '{"docsDir": ');
  });
  test('seção desconhecida é RangeError; as quatro do contrato existem', () => {
    assert.deepEqual(SECOES, ['fluxo', 'versionamento', 'orquestracao', 'contexto']);
    assert.throws(() => aplicar(repo(), 'quality', {}), RangeError);
  });
  test('escrita atômica: nenhum .tmp sobra e o arquivo termina em newline', () => {
    const dir = repo({ 'harness.config.json': TEMPLATE });
    aplicar(dir, 'versionamento', { modelo: 'trunk' });
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), []);
    assert.ok(readFileSync(join(dir, 'harness.config.json'), 'utf8').endsWith('}\n'));
  });
  test('dryRun devolve o diff e não grava', () => {
    const dir = repo({ 'harness.config.json': TEMPLATE });
    const r = aplicar(dir, 'fluxo', { ferramenta: 'jira' }, { dryRun: true });
    assert.equal(r.diff.length, 1);
    assert.equal(lerCfg(dir).fluxo, undefined);
  });
});

describe('aplicarSettings — .claude/settings.json (REQ-ONB-5)', () => {
  test('permissions permanece idêntico e model é adicionado', () => {
    const original = { permissions: { allow: ['Bash(npm test:*)', 'Read'], deny: ['Bash(rm:*)'] }, hooks: {} };
    const dir = repo({ '.claude/settings.json': JSON.stringify(original, null, 2) });
    const r = aplicarSettings(dir, { model: 'fable', enabledPlugins: { 'gabarito-mestre@gabarito-mestre': true } });
    const depois = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8'));
    assert.deepEqual(depois.permissions, original.permissions);
    assert.deepEqual(Object.keys(depois), ['permissions', 'hooks', 'model', 'enabledPlugins']);
    assert.equal(depois.model, 'fable');
    assert.deepEqual(r.diff, ['+ model = "fable"', '+ enabledPlugins = {"gabarito-mestre@gabarito-mestre":true}']);
  });
  test('settings ausente: cria .claude/ e o arquivo', () => {
    const dir = repo();
    aplicarSettings(dir, { model: 'opus' });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8')), { model: 'opus' });
  });
});

describe('diffChaves e lerJson', () => {
  test('diff lista + para chave nova e ~ para mudança, com caminho pontilhado', () => {
    assert.deepEqual(diffChaves({ a: { b: 1 } }, { a: { b: 2, c: [1] } }), ['~ a.b: 1 → 2', '+ a.c = [1]']);
  });
  test('lerJson: ausente → {}, vazio → {}, inválido → ArquivoInvalido', () => {
    const dir = repo({ 'vazio.json': '   ', 'ruim.json': '{' });
    assert.deepEqual(lerJson(join(dir, 'nao-existe.json')), {});
    assert.deepEqual(lerJson(join(dir, 'vazio.json')), {});
    assert.throws(() => lerJson(join(dir, 'ruim.json')), ArquivoInvalido);
  });
});

describe('CLI', () => {
  test('--set fluxo grava e imprime o diff; exit 0', () => {
    const dir = repo({ 'harness.config.json': TEMPLATE });
    const r = cli(['--root', dir, '--set', 'fluxo', '{"ferramenta":"arquivos","resolvidoEm":"2026-09-24"}'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /harness\.config\.json atualizado/);
    assert.match(r.stdout, /\+ fluxo = /);
    assert.equal(lerCfg(dir).fluxo.resolvidoEm, '2026-09-24');
    assert.equal(lerCfg(dir).deployOrder.length, 1);
  });
  test('--dry-run não grava', () => {
    const dir = repo({ 'harness.config.json': TEMPLATE });
    const r = cli(['--root', dir, '--set', 'fluxo', '{"ferramenta":"arquivos"}', '--dry-run'], dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /dry-run/);
    assert.equal(lerCfg(dir).fluxo, undefined);
  });
  test('JSON inválido no argumento: exit 1, sem stack trace', () => {
    const dir = repo();
    const r = cli(['--root', dir, '--set', 'fluxo', '{ferramenta'], dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /JSON inválido/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('seção desconhecida: exit 1', () => {
    const dir = repo();
    assert.equal(cli(['--root', dir, '--set', 'quality', '{}'], dir).status, 1);
  });
  test('harness.config.json inválido: fail-open declarado, exit 0, arquivo intocado', () => {
    const dir = repo({ 'harness.config.json': '{"a":' });
    const r = cli(['--root', dir, '--set', 'fluxo', '{"ferramenta":"arquivos"}'], dir);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
    assert.equal(readFileSync(join(dir, 'harness.config.json'), 'utf8'), '{"a":');
  });
  test('--settings emenda .claude/settings.json', () => {
    const dir = repo({ '.claude/settings.json': '{"permissions":{"allow":["Read"]}}' });
    const r = cli(['--root', dir, '--settings', '{"model":"fable"}'], dir);
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8'));
    assert.deepEqual(s, { permissions: { allow: ['Read'] }, model: 'fable' });
  });
  test('sem --root, usa a raiz do git ou o cwd (fixture solta sem .git)', () => {
    const dir = repo({ 'harness.config.json': '{}' });
    const r = cli(['--set', 'contexto', '{"nucleoMaxBytes":17291}'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, 'harness.config.json')));
    assert.equal(lerCfg(dir).contexto.nucleoMaxBytes, 17291);
  });
  test('sem --set nem --settings: exit 1 com uso', () => {
    assert.equal(cli(['--root', repo()], tmpdir()).status, 1);
  });
});
```

- [ ] **T5.2 — Ver VERMELHO:** `cd plugins/gabarito-mestre/gates && node --test test/onboarding-config.test.mjs` — falha em `ERR_MODULE_NOT_FOUND` (o script não existe). Commit: `test(GM-2): onboarding-config — merge chave a chave, atomicidade, fail-open`.

- [ ] **T5.3 — Implementação.** Crie `plugins/gabarito-mestre/gates/scripts/onboarding-config.mjs`:

```js
#!/usr/bin/env node
/**
 * ONB-7 — onboarding-config.
 *
 * O template de `harness.config.json` NÃO traz `fluxo`, `versionamento`, `orquestracao`
 * nem `contexto`: quem grava é este script, chamado pela skill `gabarito-instalar`.
 * Merge chave a chave (objetos recursivos, arrays substituídos), nunca remove, preserva
 * `_comment` e chaves desconhecidas, escreve atomicamente (tmp + rename) e imprime o diff.
 * O mesmo mecanismo emenda `.claude/settings.json` (`--settings`), que é arquivo do
 * usuário: `permissions` e o resto ficam como estavam (R2). Arquivo-alvo com JSON
 * inválido NUNCA é sobrescrito: fail-open declarado (G9), exit 0.
 *
 * USO
 *   node onboarding-config.mjs --set fluxo '{"ferramenta":"clickup"}'
 *   node onboarding-config.mjs --root /repo --set orquestracao '{…}' --dry-run
 *   node onboarding-config.mjs --settings '{"model":"fable"}'
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SECOES = ['fluxo', 'versionamento', 'orquestracao', 'contexto'];
export const CONFIG_FILE = 'harness.config.json';
export const SETTINGS_FILE = '.claude/settings.json';

export class ArquivoInvalido extends Error {}

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Objetos: recursivo. Arrays: substitui. `undefined`: ignora. Nunca remove. Não muta a base. */
export function mergeDeep(base, patch) {
  const out = ehObjeto(base) ? { ...base } : {};
  if (!ehObjeto(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (ehObjeto(v)) out[k] = mergeDeep(ehObjeto(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

/** Ausente ou vazio → {}. JSON inválido → ArquivoInvalido (quem chama decide não escrever). */
export function lerJson(caminho) {
  if (!existsSync(caminho)) return {};
  const texto = readFileSync(caminho, 'utf8');
  if (texto.trim() === '') return {};
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw new ArquivoInvalido(`${caminho}: JSON inválido (${String(e.message).split('\n')[0]})`);
  }
}

/** tmp no mesmo diretório + rename: ou o arquivo inteiro novo, ou o antigo intacto. */
export function escreverAtomico(caminho, obj) {
  mkdirSync(dirname(caminho), { recursive: true });
  const tmp = `${caminho}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, caminho);
}

/** `+ a.b = <json>` para chave nova · `~ a.b: <antes> → <depois>` para mudança. Nada de `-`: o merge não remove. */
export function diffChaves(antes, depois, prefixo = '') {
  const linhas = [];
  for (const k of Object.keys(depois ?? {})) {
    const a = ehObjeto(antes) ? antes[k] : undefined;
    const d = depois[k];
    const cam = prefixo ? `${prefixo}.${k}` : k;
    if (ehObjeto(d) && ehObjeto(a)) linhas.push(...diffChaves(a, d, cam));
    else if (a === undefined) linhas.push(`+ ${cam} = ${JSON.stringify(d)}`);
    else if (JSON.stringify(a) !== JSON.stringify(d)) linhas.push(`~ ${cam}: ${JSON.stringify(a)} → ${JSON.stringify(d)}`);
  }
  return linhas;
}

function aplicarEm(arquivo, patch, { dryRun = false } = {}) {
  const antes = lerJson(arquivo);
  const depois = mergeDeep(antes, patch);
  const diff = diffChaves(antes, depois);
  if (!dryRun && (diff.length || !existsSync(arquivo))) escreverAtomico(arquivo, depois);
  return { antes, depois, diff };
}

export function aplicar(root, secao, patch, opts = {}) {
  if (!SECOES.includes(secao)) throw new RangeError(`seção desconhecida: ${secao} (use ${SECOES.join('|')})`);
  return aplicarEm(join(root, CONFIG_FILE), { [secao]: patch }, opts);
}

export function aplicarSettings(root, patch, opts = {}) {
  return aplicarEm(join(root, SETTINGS_FILE), patch, opts);
}

export function raizDoRepo(cwd = process.cwd()) {
  try {
    const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return r || cwd;
  } catch {
    return cwd;
  }
}

function main(argv) {
  const arg = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const root = arg('root') ? resolve(arg('root')) : raizDoRepo();
  const dryRun = argv.includes('--dry-run');
  const iSet = argv.indexOf('--set');
  const settings = arg('settings');
  if (iSet === -1 && settings === undefined) {
    console.error("uso: onboarding-config.mjs [--root <dir>] --set <fluxo|versionamento|orquestracao|contexto> '<json>' | --settings '<json>' [--dry-run]");
    process.exit(1);
  }
  const bruto = iSet !== -1 ? argv[iSet + 2] : settings;
  let patch;
  try {
    patch = JSON.parse(bruto ?? '');
  } catch (e) {
    console.error(`[ONB-7] JSON inválido no argumento: ${String(e.message).split('\n')[0]}`);
    process.exit(1);
  }
  if (!ehObjeto(patch)) {
    console.error('[ONB-7] o patch precisa ser um objeto JSON');
    process.exit(1);
  }
  const alvo = iSet !== -1 ? CONFIG_FILE : SETTINGS_FILE;
  let r;
  try {
    r = iSet !== -1 ? aplicar(root, argv[iSet + 1], patch, { dryRun }) : aplicarSettings(root, patch, { dryRun });
  } catch (e) {
    if (e instanceof ArquivoInvalido) {
      console.error(`[ONB-7] ${e.message} — não escrevo por cima de arquivo que não consigo ler (fail-open declarado (G9))`);
      process.exit(0);
    }
    if (e instanceof RangeError) {
      console.error(`[ONB-7] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  console.log(dryRun ? `[ONB-7] dry-run — ${alvo} não foi escrito` : r.diff.length ? `[ONB-7] ${alvo} atualizado` : `[ONB-7] ${alvo} sem mudanças`);
  for (const l of r.diff) console.log(`  ${l}`);
  process.exit(0);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
```

- [ ] **T5.4 — Ver VERDE:** `cd plugins/gabarito-mestre/gates && node --test test/onboarding-config.test.mjs` — todos passam. Rode também `npm test` para garantir que nada da 1.0.1 quebrou.
- [ ] **T5.5 — Mutação rápida (obrigatória antes do commit):** troque `if (v === undefined) continue;` por `if (v === undefined) { delete out[k]; continue; }` e rode — o teste "undefined no patch é ignorado" tem de cair. Reverta.
- [ ] **T5.6 — Commit:** `feat(GM-2): onboarding-config.mjs — --set/--settings com merge chave a chave e escrita atômica`. Ledger: linha `T5 · onboarding-config · <n> testes verdes`.

---
## T6 — `capacidade.mjs` (REQ-PAR-1, REQ-ONB-6)

**Files**
- Criar: `plugins/gabarito-mestre/gates/scripts/capacidade.mjs`
- Criar: `plugins/gabarito-mestre/gates/test/capacidade.test.mjs`

**Interfaces**
- Consumes: `harness.config.json` → `orquestracao.paralelismo` (ausente → `DEFAULTS` + stderr `defaults (orquestracao ausente)`; inválido → defaults + `fail-open declarado (G9)`); `vm_stat` (macOS) ou `/proc/meminfo` (Linux); `fs.statfsSync(root)`; `LC_ALL=C ps -axo pid,ppid,%cpu,rss`; env `GABARITO_CAP_CORES`, `GABARITO_CAP_LOAD1`, `GABARITO_CAP_MEM_MB`, `GABARITO_CAP_DISCO_GB`, `GABARITO_CAP_PESADOS` (medidas injetadas), `GABARITO_PID_RAIZ` (default `process.ppid`), `GABARITO_PARALELISMO` (override de sessão).
- Produces (CLI): `node capacidade.mjs [--root <dir>] [--json] [--calibrar]`. Sem flag: `slots: <n> (<motivo>)`. `--json`: `{ slots, motivo, medidas }`. `--calibrar`: `{ simultaneos, teto, limites, calibradoEm }`. **Sempre exit 0**; erro inesperado → `slots: 1 (erro: … — fail-open declarado (G9))`.
- Produces (ESM): `medir(env = process.env, dir = process.cwd()) → Medidas` com `Medidas = { cores, load1, memDisponivelMB, discoLivreGB, pesados, plataforma }` · `calcularSlots(paralelismo, medidas, env = process.env) → { slots, motivo, medidas }` · `calibrar(medidas, hoje = new Date()) → { simultaneos, teto, limites, calibradoEm }` · `contarPesados(psSaida, pidRaiz) → number` · `parseVmStat(texto) → MB` · `parseMeminfo(texto) → MB` · `lerParalelismo(root) → { paralelismo, aviso }` · `DEFAULTS`, `CPU_PESADO_PCT = 20`, `RSS_PESADO_MB = 500`.
- Regra de `slots`: `simultaneos` (ou `GABARITO_PARALELISMO`, ainda ≤ `teto`) reduzido por cada limitante violado: load/core > `loadPorCoreMax` → 1; mem < `memDisponivelMinMB` → 1; disco < `discoLivreMinGB` → 1; `pesados > 0` → `max(1, teto − pesados)`. Resultado `min(simultaneos, teto, permitido)`, **nunca < 1**; `motivo` é o nome do limitante mais restritivo (ou `simultaneos` / `GABARITO_PARALELISMO=<n>` / `teto`).
- Calibração (contrato): `simultaneos = clamp(floor(cores / 4), 1, 3)`; `teto = clamp(floor(cores / 2), 2, 8)`; `limites` = defaults.

**Mutações prescritas:** M1 permitir `slots < 1` (remover o piso) · M2 ignorar `teto` (`GABARITO_PARALELISMO=9` passa 9) · M3 contar a árvore do Claude (`GABARITO_PID_RAIZ`) como pesada · M4 `calibrar` sem clamp (64 cores → 16/32) · M5 `%cpu` com vírgula lido como 0 (remover o `replace(',', '.')`).

**Steps**

- [ ] **T6.1 — Teste vermelho.** Crie `plugins/gabarito-mestre/gates/test/capacidade.test.mjs`:

```js
/**
 * Testes do PAR-1 — capacidade.
 *
 * O paralelismo é medido, não presumido: `slots` cai quando a máquina está carregada e
 * NUNCA fica abaixo de 1; `GABARITO_PARALELISMO` sobe `simultaneos` mas não passa do `teto`;
 * a árvore do próprio Claude Code não conta como processo pesado.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  permitir slots < 1 (remover o piso `Math.max(1, …)`)
 *  M2  ignorar o teto (GABARITO_PARALELISMO=9 devolve 9)
 *  M3  contar a árvore de GABARITO_PID_RAIZ como pesada
 *  M4  calibrar sem clamp (64 cores → simultaneos 16, teto 32)
 *  M5  ler `%cpu` com vírgula como 0 (remover o replace(',', '.'))
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  medir, calcularSlots, calibrar, contarPesados, parseVmStat, parseMeminfo, lerParalelismo, DEFAULTS,
} from '../scripts/capacidade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'capacidade.mjs');

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const cli = (args, cwd, env = {}) => {
  const limpo = { ...process.env };
  for (const k of Object.keys(limpo)) if (k.startsWith('GABARITO_')) delete limpo[k];
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...limpo, ...env } });
};

/** Máquina folgada: 8 cores, load baixo, memória e disco sobrando, nenhum pesado. */
const folgada = { cores: 8, load1: 1, memDisponivelMB: 8192, discoLivreGB: 50, pesados: 0, plataforma: 'test' };
const env = (extra = {}) => ({ ...extra });

describe('medir — injeção por env', () => {
  test('cada medida é substituída pela env correspondente', () => {
    const m = medir(
      { GABARITO_CAP_CORES: '12', GABARITO_CAP_LOAD1: '3.5', GABARITO_CAP_MEM_MB: '1024', GABARITO_CAP_DISCO_GB: '3', GABARITO_CAP_PESADOS: '2' },
      tmpdir(),
    );
    assert.deepEqual({ ...m, plataforma: undefined }, { cores: 12, load1: 3.5, memDisponivelMB: 1024, discoLivreGB: 3, pesados: 2, plataforma: undefined });
    assert.equal(typeof m.plataforma, 'string');
  });
  test('sem env, mede de verdade e devolve números (ou null onde a plataforma não expõe)', () => {
    const m = medir({}, tmpdir());
    assert.ok(Number.isInteger(m.cores) && m.cores >= 1);
    assert.ok(typeof m.load1 === 'number');
    for (const k of ['memDisponivelMB', 'discoLivreGB', 'pesados']) assert.ok(m[k] === null || Number.isFinite(m[k]), k);
  });
});

describe('calcularSlots — a regra que a spec pede', () => {
  test('máquina folgada: slots = simultaneos, motivo "simultaneos"', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, folgada, env());
    assert.equal(r.slots, 2);
    assert.equal(r.motivo, 'simultaneos');
    assert.equal(r.medidas, folgada);
  });
  test('load/core 2.0 com limite 1.5 → slots 1 e motivo cita load', () => {
    const r = calcularSlots({ simultaneos: 3, teto: 4 }, { ...folgada, load1: 16 }, env());
    assert.equal(r.slots, 1);
    assert.match(r.motivo, /load 2\.00\/core > 1\.5/);
  });
  test('memória e disco abaixo do mínimo → 1, motivo cita o que faltou', () => {
    assert.match(calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, memDisponivelMB: 1000 }, env()).motivo, /mem 1000 MB < 2048/);
    assert.match(calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, discoLivreGB: 2 }, env()).motivo, /disco 2 GB < 5/);
  });
  test('processos pesados reduzem a partir do teto: teto 4, 3 pesados → 1', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, pesados: 3 }, env());
    assert.equal(r.slots, 1);
    assert.match(r.motivo, /3 processo\(s\) pesado\(s\)/);
  });
  test('pesados que não restringem não mudam o motivo (teto 4, 1 pesado, simultaneos 2 → 2)', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, pesados: 1 }, env());
    assert.equal(r.slots, 2);
    assert.equal(r.motivo, 'simultaneos');
  });
  test('GABARITO_PARALELISMO=9 com teto 4 → slots ≤ 4 e motivo cita o override e o teto', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, folgada, env({ GABARITO_PARALELISMO: '9' }));
    assert.equal(r.slots, 4);
    assert.match(r.motivo, /GABARITO_PARALELISMO=9/);
    assert.match(r.motivo, /teto 4/);
  });
  test('GABARITO_PARALELISMO=3 dentro do teto vale 3', () => {
    assert.equal(calcularSlots({ simultaneos: 1, teto: 4 }, folgada, env({ GABARITO_PARALELISMO: '3' })).slots, 3);
  });
  test('nunca < 1: simultaneos 0, teto 0, pesados 99, load absurdo → 1', () => {
    assert.equal(calcularSlots({ simultaneos: 0, teto: 4 }, folgada, env()).slots, 1);
    assert.equal(calcularSlots({ simultaneos: 2, teto: 0 }, folgada, env()).slots, 1);
    assert.equal(calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, pesados: 99, load1: 999 }, env()).slots, 1);
    assert.equal(calcularSlots({ simultaneos: 2, teto: 4 }, folgada, env({ GABARITO_PARALELISMO: '0' })).slots, 1);
  });
  test('sem paralelismo (null): usa DEFAULTS 2/4 e limites default', () => {
    const r = calcularSlots(null, folgada, env());
    assert.equal(r.slots, DEFAULTS.simultaneos);
    assert.equal(calcularSlots(undefined, { ...folgada, memDisponivelMB: DEFAULTS.limites.memDisponivelMinMB - 1 }, env()).slots, 1);
  });
  test('limites parciais completam com defaults', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4, limites: { loadPorCoreMax: 5 } }, { ...folgada, load1: 16 }, env());
    assert.equal(r.slots, 2, 'load 2.0/core com limite 5 não restringe');
  });
  test('medidas null (plataforma sem leitura) não restringem', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, memDisponivelMB: null, discoLivreGB: null, pesados: null }, env());
    assert.equal(r.slots, 2);
  });
});

describe('contarPesados — exclui a árvore do Claude Code', () => {
  const ps = [
    '  PID  PPID  %CPU    RSS',
    '    1     0   0.1   9000',
    '  100     1   0.5  50000', // raiz do Claude (pai do hook)
    '  200   100  85.0 900000', // node do hook — filho da raiz: excluído
    '  300   200  95.0  10000', // neto: excluído
    '  400     1  45.0  10000', // suíte de outro terminal: pesado por CPU
    '  500     1   0.2 600000', // dev server: pesado por RSS (600 MB)
    '  600     1   2.0  30000', // leve
    '  700   400   0.0 512001', // pesado por RSS (> 500 MB), fora da árvore
  ].join('\n');
  test('conta 3 pesados fora da árvore de 100 e ignora 200/300', () => {
    assert.equal(contarPesados(ps, 100), 3);
  });
  test('raiz inexistente: nada é excluído → 5', () => {
    assert.equal(contarPesados(ps, 99999), 5);
  });
  test('%cpu com vírgula (locale pt-BR) é lido como decimal, não como 0', () => {
    const psBr = '  PID  PPID  %CPU    RSS\n  400     1  45,0  10000\n  600     1   2,0  30000\n';
    assert.equal(contarPesados(psBr, 99999), 1);
  });
  test('saída vazia ou lixo → 0', () => {
    assert.equal(contarPesados('', 1), 0);
    assert.equal(contarPesados('ps: erro\n', 1), 0);
  });
});

describe('parsers de memória', () => {
  test('vm_stat: (free + inactive + speculative) × page size, em MB', () => {
    const texto = [
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                                     5125.',
      'Pages active:                                 346179.',
      'Pages inactive:                               344461.',
      'Pages speculative:                               704.',
      'Pages wired down:                             179284.',
    ].join('\n');
    assert.equal(parseVmStat(texto), Math.round(((5125 + 344461 + 704) * 16384) / 1_048_576));
  });
  test('meminfo: MemAvailable em kB → MB', () => {
    assert.equal(parseMeminfo('MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    8388608 kB\n'), 8192);
  });
  test('texto sem os campos → 0 (e não NaN)', () => {
    assert.equal(parseVmStat('nada'), 0);
    assert.equal(parseMeminfo('nada'), 0);
  });
});

describe('calibrar — fórmula do contrato', () => {
  test('8 cores → 2/4; 2 cores → 1/2; 64 cores → 3/8; 1 core → 1/2', () => {
    assert.deepEqual([calibrar({ cores: 8 }).simultaneos, calibrar({ cores: 8 }).teto], [2, 4]);
    assert.deepEqual([calibrar({ cores: 2 }).simultaneos, calibrar({ cores: 2 }).teto], [1, 2]);
    assert.deepEqual([calibrar({ cores: 64 }).simultaneos, calibrar({ cores: 64 }).teto], [3, 8]);
    assert.deepEqual([calibrar({ cores: 1 }).simultaneos, calibrar({ cores: 1 }).teto], [1, 2]);
  });
  test('limites são os defaults e calibradoEm é a data injetada', () => {
    const c = calibrar({ cores: 8 }, new Date('2026-09-24T15:00:00Z'));
    assert.deepEqual(c.limites, { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 });
    assert.equal(c.calibradoEm, '2026-09-24');
  });
});

describe('lerParalelismo — config ausente/vazia/inválida/sem seção', () => {
  test('ausente → defaults com aviso "orquestracao ausente"', () => {
    const r = lerParalelismo(repo());
    assert.equal(r.paralelismo, null);
    assert.match(r.aviso, /defaults \(orquestracao ausente/);
  });
  test('vazia (0 bytes) → defaults com aviso', () => {
    assert.match(lerParalelismo(repo({ 'harness.config.json': '' })).aviso, /orquestracao ausente/);
  });
  test('inválida → defaults, aviso cita fail-open declarado (G9)', () => {
    const r = lerParalelismo(repo({ 'harness.config.json': '{"orquestracao": ' }));
    assert.equal(r.paralelismo, null);
    assert.match(r.aviso, /fail-open declarado \(G9\)/);
  });
  test('com seção → devolve o objeto e sem aviso', () => {
    const r = lerParalelismo(repo({ 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: { simultaneos: 3, teto: 6 } } }) }));
    assert.deepEqual(r.paralelismo, { simultaneos: 3, teto: 6 });
    assert.equal(r.aviso, null);
  });
});

describe('CLI — sempre exit 0', () => {
  const medidasEnv = { GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '1', GABARITO_CAP_MEM_MB: '8192', GABARITO_CAP_DISCO_GB: '50', GABARITO_CAP_PESADOS: '0' };
  test('--json com config: { slots, motivo, medidas } e exit 0', () => {
    const dir = repo({ 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: { simultaneos: 3, teto: 4 } } }) });
    const r = cli(['--root', dir, '--json'], dir, medidasEnv);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.slots, 3);
    assert.equal(j.motivo, 'simultaneos');
    assert.equal(j.medidas.cores, 8);
    assert.equal(r.stderr, '');
  });
  test('sem config: defaults, aviso em stderr, exit 0, sem stack trace', () => {
    const dir = repo();
    const r = cli(['--root', dir], dir, medidasEnv);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^slots: 2 \(simultaneos\)/);
    assert.match(r.stderr, /defaults \(orquestracao ausente/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('config inválida: fail-open declarado, exit 0', () => {
    const dir = repo({ 'harness.config.json': '{' });
    const r = cli(['--root', dir], dir, medidasEnv);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.match(r.stdout, /^slots: 2/);
  });
  test('GABARITO_PARALELISMO=9 no CLI respeita o teto', () => {
    const dir = repo({ 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: { simultaneos: 2, teto: 4 } } }) });
    const j = JSON.parse(cli(['--root', dir, '--json'], dir, { ...medidasEnv, GABARITO_PARALELISMO: '9' }).stdout);
    assert.equal(j.slots, 4);
  });
  test('--calibrar imprime JSON com a fórmula', () => {
    const r = cli(['--calibrar'], tmpdir(), { GABARITO_CAP_CORES: '8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.simultaneos, 2);
    assert.equal(j.teto, 4);
    assert.match(j.calibradoEm, /^\d{4}-\d{2}-\d{2}$/);
  });
  test('fixture solta sem .git e sem --root: usa o cwd e não quebra', () => {
    const dir = repo();
    const r = cli([], dir, medidasEnv);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^slots: \d+/);
  });
});
```

- [ ] **T6.2 — Ver VERMELHO:** `cd plugins/gabarito-mestre/gates && node --test test/capacidade.test.mjs` — `ERR_MODULE_NOT_FOUND`. Commit: `test(GM-2): capacidade — slots medidos, piso 1, teto, árvore do Claude excluída`.

- [ ] **T6.3 — Implementação.** Crie `plugins/gabarito-mestre/gates/scripts/capacidade.mjs`:

```js
#!/usr/bin/env node
/**
 * PAR-1 — capacidade.
 *
 * Paralelismo não é número de agentes: é o que a máquina aguenta de processos pesados ao
 * mesmo tempo (ADR-PAR-1). Este script mede cores, load 1 min, memória DISPONÍVEL
 * (macOS: vm_stat free+inactive+speculative · Linux: /proc/meminfo MemAvailable), disco
 * livre na raiz e processos pesados vivos (CPU > 20 % ou RSS > 500 MB) — excluindo a
 * árvore do próprio Claude Code (GABARITO_PID_RAIZ, default: pai deste processo) — e
 * devolve `{ slots, motivo, medidas }`: slots = min(simultaneos, teto, permitido), nunca < 1.
 * Toda medida é injetável por env (GABARITO_CAP_*); GABARITO_PARALELISMO substitui
 * `simultaneos` na sessão, ainda ≤ teto. Sem `orquestracao` na config: defaults + aviso.
 * Sempre sai 0 — quem decide é o orquestrador, e um erro aqui vira `slots: 1`.
 *
 * USO
 *   node capacidade.mjs                 # "slots: 2 (simultaneos)"
 *   node capacidade.mjs --json          # { slots, motivo, medidas }
 *   node capacidade.mjs --calibrar      # valores sugeridos para orquestracao.paralelismo
 */

import { readFileSync, existsSync, statfsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { availableParallelism, loadavg, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  modo: 'auto',
  simultaneos: 2,
  teto: 4,
  limites: { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 },
  arquivosDeContenda: ['package-lock.json', 'prisma/', 'src/index.ts', 'docs/fluxo/'],
  isolamentoWorktree: { porta: '3000+n', dbSchema: 'wt_{n}', namespace: 'wt-{n}' },
  rodadasAntesDeEscalar: 2,
  calibradoEm: '',
};
export const CPU_PESADO_PCT = 20;
export const RSS_PESADO_MB = 500;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Número finito ou null. Aceita vírgula decimal (ps em locale pt-BR imprime `0,5`). */
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ────────────────────────────────────────────────────────────── parsers (puros)

export function parseVmStat(texto) {
  const tam = Number(/page size of (\d+) bytes/.exec(texto)?.[1] ?? 4096);
  const pg = (nome) => Number(new RegExp(`${nome}:\\s+(\\d+)`).exec(texto)?.[1] ?? 0);
  const paginas = pg('Pages free') + pg('Pages inactive') + pg('Pages speculative');
  return Math.round((paginas * tam) / 1_048_576);
}

export function parseMeminfo(texto) {
  const kb = Number(/MemAvailable:\s+(\d+)\s*kB/.exec(texto)?.[1] ?? 0);
  return Math.round(kb / 1024);
}

/** Saída de `ps -axo pid,ppid,%cpu,rss` (RSS em KB). Exclui `pidRaiz` e todos os descendentes. */
export function contarPesados(psSaida, pidRaiz) {
  const procs = [];
  for (const linha of String(psSaida ?? '').split('\n')) {
    const c = linha.trim().split(/\s+/);
    if (c.length < 4) continue;
    const pid = num(c[0]);
    const ppid = num(c[1]);
    const cpu = num(c[2]);
    const rssKB = num(c[3]);
    if (pid === null || ppid === null || cpu === null || rssKB === null) continue;
    procs.push({ pid, ppid, cpu, rssMB: rssKB / 1024 });
  }
  const filhos = new Map();
  for (const p of procs) {
    if (!filhos.has(p.ppid)) filhos.set(p.ppid, []);
    filhos.get(p.ppid).push(p.pid);
  }
  const excluidos = new Set();
  const fila = [Number(pidRaiz)];
  while (fila.length) {
    const p = fila.pop();
    if (excluidos.has(p)) continue;
    excluidos.add(p);
    for (const f of filhos.get(p) ?? []) fila.push(f);
  }
  return procs.filter((p) => !excluidos.has(p.pid) && (p.cpu > CPU_PESADO_PCT || p.rssMB > RSS_PESADO_MB)).length;
}

// ────────────────────────────────────────────────────────────── medição real

function memDisponivelMB() {
  try {
    if (platform() === 'darwin') return parseVmStat(execFileSync('vm_stat', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    if (platform() === 'linux') return parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
  } catch {
    /* cai no null: plataforma sem leitura não restringe */
  }
  return null;
}

function discoLivreGB(dir) {
  try {
    const s = statfsSync(dir);
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1e9);
  } catch {
    return null;
  }
}

function pesadosVivos(pidRaiz) {
  try {
    const saida = execFileSync('ps', ['-axo', 'pid,ppid,%cpu,rss'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    });
    return contarPesados(saida, pidRaiz);
  } catch {
    return null;
  }
}

export function medir(env = process.env, dir = process.cwd()) {
  return {
    cores: num(env.GABARITO_CAP_CORES) ?? availableParallelism(),
    load1: num(env.GABARITO_CAP_LOAD1) ?? Number(loadavg()[0].toFixed(2)),
    memDisponivelMB: num(env.GABARITO_CAP_MEM_MB) ?? memDisponivelMB(),
    discoLivreGB: num(env.GABARITO_CAP_DISCO_GB) ?? discoLivreGB(dir),
    pesados: num(env.GABARITO_CAP_PESADOS) ?? pesadosVivos(num(env.GABARITO_PID_RAIZ) ?? process.ppid),
    plataforma: platform(),
  };
}

// ────────────────────────────────────────────────────────────── regra

export function calcularSlots(paralelismo, medidas, env = process.env) {
  const p = paralelismo && typeof paralelismo === 'object' ? paralelismo : {};
  const limites = { ...DEFAULTS.limites, ...(p.limites ?? {}) };
  const teto = Math.floor(num(p.teto) ?? DEFAULTS.teto);
  let simultaneos = Math.floor(num(p.simultaneos) ?? DEFAULTS.simultaneos);
  let motivo = 'simultaneos';

  const override = num(env.GABARITO_PARALELISMO);
  if (override !== null) {
    simultaneos = Math.floor(override);
    motivo = `GABARITO_PARALELISMO=${override}`;
  }
  if (simultaneos > teto) {
    simultaneos = teto;
    motivo = `${motivo} acima do teto ${teto}`;
  }

  const m = medidas ?? {};
  const limitantes = [];
  if (m.cores && m.load1 !== null && m.load1 !== undefined && m.load1 / m.cores > limites.loadPorCoreMax) {
    limitantes.push({ permitido: 1, motivo: `load ${(m.load1 / m.cores).toFixed(2)}/core > ${limites.loadPorCoreMax}` });
  }
  if (m.memDisponivelMB !== null && m.memDisponivelMB !== undefined && m.memDisponivelMB < limites.memDisponivelMinMB) {
    limitantes.push({ permitido: 1, motivo: `mem ${m.memDisponivelMB} MB < ${limites.memDisponivelMinMB}` });
  }
  if (m.discoLivreGB !== null && m.discoLivreGB !== undefined && m.discoLivreGB < limites.discoLivreMinGB) {
    limitantes.push({ permitido: 1, motivo: `disco ${m.discoLivreGB} GB < ${limites.discoLivreMinGB}` });
  }
  if (m.pesados) {
    limitantes.push({ permitido: Math.max(1, teto - m.pesados), motivo: `${m.pesados} processo(s) pesado(s)` });
  }

  let slots = simultaneos;
  for (const l of limitantes) {
    if (l.permitido < slots) {
      slots = l.permitido;
      motivo = l.motivo;
    }
  }
  if (slots < 1) {
    slots = 1;
    motivo = `${motivo} — mínimo 1`;
  }
  return { slots, motivo, medidas: m };
}

export function calibrar(medidas, hoje = new Date()) {
  const cores = Math.max(1, Math.floor(num(medidas?.cores) ?? 1));
  return {
    simultaneos: clamp(Math.floor(cores / 4), 1, 3),
    teto: clamp(Math.floor(cores / 2), 2, 8),
    limites: { ...DEFAULTS.limites },
    calibradoEm: hoje.toISOString().slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────── config

export function lerParalelismo(root) {
  const f = join(root, 'harness.config.json');
  if (!existsSync(f)) return { paralelismo: null, aviso: 'defaults (orquestracao ausente: harness.config.json não existe)' };
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(f, 'utf8') || '{}');
  } catch (e) {
    return { paralelismo: null, aviso: `harness.config.json inválido (${String(e.message).split('\n')[0]}) — defaults; fail-open declarado (G9)` };
  }
  const p = cfg?.orquestracao?.paralelismo;
  return p && typeof p === 'object' ? { paralelismo: p, aviso: null } : { paralelismo: null, aviso: 'defaults (orquestracao ausente)' };
}

export function raizDoRepo(cwd = process.cwd()) {
  try {
    const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return r || cwd;
  } catch {
    return cwd;
  }
}

function main(argv) {
  const arg = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  try {
    const root = arg('root') ? resolve(arg('root')) : raizDoRepo();
    const medidas = medir(process.env, root);
    if (argv.includes('--calibrar')) {
      process.stdout.write(`${JSON.stringify(calibrar(medidas), null, 2)}\n`);
      process.exit(0);
    }
    const { paralelismo, aviso } = lerParalelismo(root);
    if (aviso) console.error(`[PAR-1] ${aviso}`);
    const r = calcularSlots(paralelismo, medidas, process.env);
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    else process.stdout.write(`slots: ${r.slots} (${r.motivo})\n`);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    console.error(`[PAR-1] erro ao medir: ${msg} (fail-open declarado (G9))`);
    process.stdout.write(argv.includes('--json') ? `${JSON.stringify({ slots: 1, motivo: `erro: ${msg}`, medidas: null })}\n` : `slots: 1 (erro: ${msg} — fail-open declarado (G9))\n`);
  }
  process.exit(0);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
```

- [ ] **T6.4 — Ver VERDE:** `node --test test/capacidade.test.mjs`. Depois `npm test`.
- [ ] **T6.5 — Mutação rápida:** apague o bloco `if (slots < 1) {…}` — o teste "nunca < 1" cai. Apague `if (simultaneos > teto) {…}` — "GABARITO_PARALELISMO=9" cai. Reverta os dois.
- [ ] **T6.6 — Medição real (registrar no ledger, (a)):** `node scripts/capacidade.mjs --json` na sua máquina; anote `medidas` e `slots`. Se `pesados` vier `null`, é a plataforma sem `ps` — anote também.
- [ ] **T6.7 — Commit:** `feat(GM-2): capacidade.mjs — slots medidos com piso 1, teto e exclusão da árvore do Claude`.

---
## T7 — `versionamento-check.mjs` (REQ-VER-3)

**Files**
- Criar: `plugins/gabarito-mestre/gates/scripts/versionamento-check.mjs`
- Criar: `plugins/gabarito-mestre/gates/test/versionamento-check.test.mjs`

**Interfaces**
- Consumes: `harness.config.json` → `versionamento` (precisa de `resolvidoEm`; senão fail-open) e `fluxo.idPadrao` (default `^[A-Z]+-\d+$`); `git log --format=%H%x00%P%x00%s` (`<base>..HEAD` com `--base`; senão `--first-parent -n<max> HEAD`); `git rev-parse --abbrev-ref HEAD` quando `--branch` não é dado.
- Produces (CLI): `node versionamento-check.mjs [--root <dir>] [--base <ref>] [--branch <nome>] [--max 20] [--json]`. Exit **0** ok · **1** achado · **0** fail-open sem config (stderr `[R20] … — fail-open declarado (G9)`). Achados em stderr no formato `::error::[R20] <sha7> <motivo>` (o CI do usuário lê como anotação).
- Produces (ESM): `parseCabecalho(msg) → { tipo, escopo, assunto } | null` (só a primeira linha; aceita `!` de breaking) · `validarCommit(msg, cfg) → { ok, motivo }` · `validarBranch(nome, cfg) → { ok, motivo }` (`main`/`master` → ok, `branchPadrao` **ou** `branchWorktree`) · `checar(root, { base, branch, max, cfg }) → { ok, achados: [{ sha, motivo }], commits?, failOpen?, aviso? }` (ignora commits com 2+ pais; `sha: 'branch'` para achado de nome de branch; sem git legível → `ok: true` + `aviso`) · `listarCommits(root, { base, max })` · `lerConfig(root) → { cfg, failOpen }` · `DEFAULTS`, `BRANCHES_PADRAO`.
- `cfg` de `validarCommit`/`validarBranch` = seção `versionamento` + `idPadrao` (tudo com default).

**Mutações prescritas:** M1 contar commits de merge (não pular `pais.length >= 2`) · M2 aceitar `fix:` sem escopo · M3 `validarBranch` case-insensitive (`feat/pbi-12` passa) · M4 fail-closed sem config (exit 1) · M5 validar só o primeiro commit do intervalo.

**Steps**

- [ ] **T7.1 — Teste vermelho.** Crie `plugins/gabarito-mestre/gates/test/versionamento-check.test.mjs`:

```js
/**
 * Testes do VER-3 — versionamento-check.
 *
 * R20 vira gate aqui: o histórico de primeiro pai e o nome da branch são conferidos contra
 * a config gravada pelo onboarding. Merge commit do orquestrador (2 pais) é IGNORADO;
 * sem `versionamento.resolvidoEm` é fail-open declarado, nunca bloqueio.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  contar commits de merge (não pular `pais.length >= 2`)
 *  M2  aceitar `fix:` sem escopo
 *  M3  validarBranch case-insensitive (`feat/pbi-12` passa)
 *  M4  fail-closed sem config (exit 1)
 *  M5  validar só o primeiro commit do intervalo
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCabecalho, validarCommit, validarBranch, checar, listarCommits, lerConfig, DEFAULTS } from '../scripts/versionamento-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'versionamento-check.mjs');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (dir, ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ver-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const CONFIG = JSON.stringify({ fluxo: { idPadrao: '^[A-Z]+-\\d+$' }, versionamento: { resolvidoEm: '2026-09-24' } });

/** Repo real: main com `feat(PBI-1): a`, merge --no-ff de `feat/PBI-2-x` (que tem `docs: b`). HEAD em main. */
function repoGit(config = CONFIG) {
  const dir = repo(config === null ? {} : { 'harness.config.json': config });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-1): a');
  git(dir, 'checkout', '-q', '-b', 'feat/PBI-2-x');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'docs: b');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', "Merge branch 'feat/PBI-2-x'", 'feat/PBI-2-x');
  return dir;
}
const cli = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: GIT_ENV });

describe('parseCabecalho', () => {
  test('tipo(escopo): assunto · tipo: assunto · tipo!: assunto · só a primeira linha', () => {
    assert.deepEqual(parseCabecalho('feat(PBI-12): adiciona x'), { tipo: 'feat', escopo: 'PBI-12', assunto: 'adiciona x' });
    assert.deepEqual(parseCabecalho('docs: b'), { tipo: 'docs', escopo: null, assunto: 'b' });
    assert.deepEqual(parseCabecalho('feat(PBI-1)!: quebra\n\ncorpo'), { tipo: 'feat', escopo: 'PBI-1', assunto: 'quebra' });
  });
  test('inválidos → null', () => {
    for (const m of ['arrumei', 'Feat(PBI-1): x', 'feat(PBI-1):x', 'feat (PBI-1): x', 'feat(): x', '', null]) assert.equal(parseCabecalho(m), null, String(m));
  });
});

describe('validarCommit', () => {
  const cfg = { ...DEFAULTS, idPadrao: '^[A-Z]+-\\d+$' };
  test('tipos com escopo de PBI exigem escopo que casa idPadrao', () => {
    assert.equal(validarCommit('feat(PBI-1): a', cfg).ok, true);
    assert.equal(validarCommit('fix(GM-2): a', cfg).ok, true);
    const semEscopo = validarCommit('fix: c', cfg);
    assert.equal(semEscopo.ok, false);
    assert.match(semEscopo.motivo, /exige escopo/);
    assert.match(validarCommit('feat(pbi-1): a', cfg).motivo, /não casa idPadrao/);
    assert.match(validarCommit('feat(api): a', cfg).motivo, /não casa idPadrao/);
  });
  test('tipos livres aceitam escopo livre ou ausente', () => {
    assert.equal(validarCommit('docs: b', cfg).ok, true);
    assert.equal(validarCommit('chore(deps): bump', cfg).ok, true);
    assert.equal(validarCommit('chore(fluxo): EPIC-7 → em_execucao', cfg).ok, true);
  });
  test('tipo desconhecido e cabeçalho fora do formato reprovam com motivo', () => {
    assert.match(validarCommit('hotfix(PBI-1): x', cfg).motivo, /desconhecido/);
    assert.match(validarCommit('arrumei', cfg).motivo, /tipo\(escopo\): assunto/);
  });
  test('idPadrao vem da config: com `^GM-\\d+$`, PBI-1 reprova', () => {
    assert.equal(validarCommit('feat(PBI-1): a', { ...cfg, idPadrao: '^GM-\\d+$' }).ok, false);
  });
});

describe('validarBranch — os exemplos do contrato', () => {
  test('passam: feat/PBI-12-x, chore/bump-deps, wt/PBI-12-1, main, master, enabler/GM-2-gates', () => {
    for (const b of ['feat/PBI-12-x', 'chore/bump-deps', 'wt/PBI-12-1', 'main', 'master', 'enabler/GM-2-gates', 'feat/PBI-12']) {
      assert.equal(validarBranch(b, DEFAULTS).ok, true, b);
    }
  });
  test('reprovam: hotfix/PBI-1, chore/PBI-1, feat/pbi-12, wt/PBI-12, FEAT/PBI-1-x', () => {
    for (const b of ['hotfix/PBI-1', 'chore/PBI-1', 'feat/pbi-12', 'wt/PBI-12', 'FEAT/PBI-1-x', '']) {
      const r = validarBranch(b, DEFAULTS);
      assert.equal(r.ok, false, b);
      assert.match(r.motivo, /branchPadrao nem branchWorktree/);
    }
  });
});

describe('checar — histórico real com merge commit', () => {
  test('feat(PBI-1), merge --no-ff, docs: b → passa (merge ignorado)', () => {
    const dir = repoGit();
    const r = checar(dir, { max: 20 });
    assert.equal(r.ok, true, JSON.stringify(r.achados));
    assert.deepEqual(r.achados, []);
    assert.equal(r.commits, 2, 'first-parent de main: merge + feat(PBI-1)');
  });
  test('listarCommits marca o merge com 2 pais', () => {
    const dir = repoGit();
    const cs = listarCommits(dir, { max: 20 });
    assert.equal(cs[0].pais.length, 2);
    assert.equal(cs[1].assunto, 'feat(PBI-1): a');
  });
  test('commit `fix: c` (escopo obrigatório ausente) reprova com sha e motivo', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: c');
    const r = checar(dir, { max: 20 });
    assert.equal(r.ok, false);
    assert.equal(r.achados.length, 1);
    assert.match(r.achados[0].sha, /^[0-9a-f]{7}$/);
    assert.match(r.achados[0].motivo, /exige escopo/);
    assert.match(r.achados[0].motivo, /"fix: c"/);
  });
  test('vários commits ruins → vários achados (não só o primeiro)', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: c');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'arrumei');
    assert.equal(checar(dir, { max: 20 }).achados.length, 2);
  });
  test('--base main em branch feat/PBI-3-y: só os commits da branch entram; branch válida', () => {
    const dir = repoGit();
    git(dir, 'checkout', '-q', '-b', 'feat/PBI-3-y');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-3): y');
    const ok = checar(dir, { base: 'main' });
    assert.equal(ok.ok, true, JSON.stringify(ok.achados));
    assert.equal(ok.commits, 1);
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: sem escopo');
    assert.equal(checar(dir, { base: 'main' }).achados.length, 1);
  });
  test('branch fora do padrão gera achado `branch` mesmo com commits ok', () => {
    const dir = repoGit();
    git(dir, 'checkout', '-q', '-b', 'feat/pbi-4-z');
    const r = checar(dir, { max: 20 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.achados.map((a) => a.sha), ['branch']);
    assert.equal(checar(dir, { max: 20, branch: 'feat/PBI-4-z' }).ok, true, '--branch explícito substitui a branch do git');
  });
  test('max limita o intervalo de primeiro pai', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'arrumei');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-9): novo');
    assert.equal(checar(dir, { max: 1 }).ok, true, 'só o último commit entra');
    assert.equal(checar(dir, { max: 2 }).ok, false);
  });
  test('cfg injetado substitui a leitura do arquivo', () => {
    const dir = repoGit(null);
    const r = checar(dir, { max: 20, cfg: { resolvidoEm: '2026-09-24', idPadrao: '^PBI-\\d+$' } });
    assert.equal(r.ok, true);
    assert.equal(r.failOpen, undefined);
  });
});

describe('checar — fail-open declarado (Review Focus 3)', () => {
  test('config ausente → ok:true com failOpen', () => {
    const r = checar(repoGit(null), { max: 20 });
    assert.equal(r.ok, true);
    assert.match(r.failOpen, /ausente/);
  });
  test('config vazia ou sem versionamento.resolvidoEm → failOpen', () => {
    assert.match(checar(repoGit(''), { max: 20 }).failOpen, /resolvidoEm ausente/);
    assert.match(checar(repoGit('{"versionamento":{"modelo":"trunk"}}'), { max: 20 }).failOpen, /resolvidoEm ausente/);
  });
  test('config inválida → failOpen citando JSON inválido, sem lançar', () => {
    const r = checar(repoGit('{"versionamento": '), { max: 20 });
    assert.equal(r.ok, true);
    assert.match(r.failOpen, /inválido/);
  });
  test('fixture solta sem .git → ok:true com aviso "sem git"', () => {
    const r = checar(repo({ 'harness.config.json': CONFIG }), { max: 20 });
    assert.equal(r.ok, true);
    assert.match(r.aviso, /sem git/);
  });
  test('lerConfig funde DEFAULTS + versionamento + fluxo.idPadrao', () => {
    const { cfg } = lerConfig(repo({ 'harness.config.json': JSON.stringify({ fluxo: { idPadrao: '^GM-\\d+$' }, versionamento: { resolvidoEm: '2026-09-24', changelog: 'HISTORY.md' } }) }));
    assert.equal(cfg.idPadrao, '^GM-\\d+$');
    assert.equal(cfg.changelog, 'HISTORY.md');
    assert.equal(cfg.branchPadrao, DEFAULTS.branchPadrao);
  });
});

describe('CLI', () => {
  test('histórico ok → exit 0 e resumo', () => {
    const dir = repoGit();
    const r = cli(['--root', dir, '--max', '20'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[R20\] ok — 2 commit\(s\)/);
  });
  test('achado → exit 1 com ::error:: por achado; --json devolve o objeto', () => {
    const dir = repoGit();
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix: c');
    const r = cli(['--root', dir], dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::\[R20\] [0-9a-f]{7} /);
    const j = JSON.parse(cli(['--root', dir, '--json'], dir).stdout);
    assert.equal(j.ok, false);
    assert.equal(j.achados.length, 1);
  });
  test('--base e --branch como no CI', () => {
    const dir = repoGit();
    git(dir, 'checkout', '-q', '-b', 'feat/PBI-3-y');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'feat(PBI-3): y');
    assert.equal(cli(['--root', dir, '--base', 'main', '--branch', 'feat/PBI-3-y'], dir).status, 0);
    assert.equal(cli(['--root', dir, '--base', 'main', '--branch', 'hotfix/PBI-3'], dir).status, 1);
  });
  test('sem config: exit 0, stderr "fail-open declarado (G9)", sem stack trace', () => {
    const dir = repoGit(null);
    const r = cli(['--root', dir], dir);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('config inválida: exit 0 e fail-open', () => {
    const r = cli(['--root', repoGit('{'), ], tmpdir());
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
  });
  test('sem --root: raiz via git toplevel a partir de subpasta', () => {
    const dir = repoGit();
    mkdirSync(join(dir, 'apps', 'api'), { recursive: true });
    const r = cli([], join(dir, 'apps', 'api'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[R20\] ok/);
  });
});
```

- [ ] **T7.2 — Ver VERMELHO:** `cd plugins/gabarito-mestre/gates && node --test test/versionamento-check.test.mjs` — `ERR_MODULE_NOT_FOUND`. Commit: `test(GM-2): versionamento-check — merge ignorado, escopo obrigatório, branch, fail-open`.

- [ ] **T7.3 — Implementação.** Crie `plugins/gabarito-mestre/gates/scripts/versionamento-check.mjs`:

```js
#!/usr/bin/env node
/**
 * VER-3 — versionamento-check.
 *
 * Versionamento é gate, não convenção (R20): este script confere o histórico (`base..HEAD`
 * no CI; últimos N commits de primeiro pai no doctor) contra Conventional Commits com
 * escopo do PBI, e o nome da branch contra `branchPadrao` ou `branchWorktree`.
 * Commits com 2+ pais (merge do orquestrador) são IGNORADOS — o título do squash é
 * atestado (`squash-titulo-pr`), não varrido. Sem `versionamento.resolvidoEm` na config:
 * fail-open declarado (G9), sai 0 — repo sem onboarding não é travado.
 *
 * USO
 *   node versionamento-check.mjs --base origin/main --branch "$GITHUB_HEAD_REF"   # CI (fetch-depth: 0)
 *   node versionamento-check.mjs --max 20 --json                                  # doctor / local
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  modelo: 'trunk',
  branchPadrao: '^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$',
  branchWorktree: '^wt/[A-Z]+-\\d+-\\d+$',
  commit: 'conventional',
  tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'],
  tiposLivres: ['chore', 'docs', 'ci', 'build', 'test', 'release', 'revert'],
  tag: '^v\\d+\\.\\d+\\.\\d+$',
  changelog: 'CHANGELOG.md',
  idPadrao: '^[A-Z]+-\\d+$',
};
export const BRANCHES_PADRAO = new Set(['main', 'master']);

// ────────────────────────────────────────────────────────────── puras

export function parseCabecalho(msg) {
  const linha = String(msg ?? '').split(/\r?\n/)[0].trim();
  const m = /^([a-z]+)(?:\(([^()\s]+)\))?(!)?: (\S.*)$/.exec(linha);
  return m ? { tipo: m[1], escopo: m[2] ?? null, assunto: m[4] } : null;
}

export function validarCommit(msg, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const h = parseCabecalho(msg);
  if (!h) return { ok: false, motivo: 'cabeçalho não é `tipo(escopo): assunto`' };
  if (c.tiposComEscopoDePbi.includes(h.tipo)) {
    if (!h.escopo) return { ok: false, motivo: `tipo \`${h.tipo}\` exige escopo com o ID do PBI (ex.: ${h.tipo}(PBI-12): …)` };
    if (!new RegExp(c.idPadrao).test(h.escopo)) return { ok: false, motivo: `escopo \`${h.escopo}\` não casa idPadrao ${c.idPadrao}` };
    return { ok: true, motivo: null };
  }
  if (c.tiposLivres.includes(h.tipo)) return { ok: true, motivo: null };
  return { ok: false, motivo: `tipo \`${h.tipo}\` desconhecido (use ${[...c.tiposComEscopoDePbi, ...c.tiposLivres].join('|')})` };
}

export function validarBranch(nome, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  const n = String(nome ?? '').trim();
  if (BRANCHES_PADRAO.has(n)) return { ok: true, motivo: 'branch padrão' };
  if (new RegExp(c.branchPadrao).test(n)) return { ok: true, motivo: null };
  if (new RegExp(c.branchWorktree).test(n)) return { ok: true, motivo: 'worktree' };
  return { ok: false, motivo: `branch \`${n}\` não casa branchPadrao nem branchWorktree` };
}

// ────────────────────────────────────────────────────────────── config e git

export function lerConfig(root) {
  const f = join(root, 'harness.config.json');
  if (!existsSync(f)) return { cfg: null, failOpen: 'harness.config.json ausente' };
  let raw;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8') || '{}');
  } catch (e) {
    return { cfg: null, failOpen: `harness.config.json inválido (${String(e.message).split('\n')[0]})` };
  }
  const v = raw?.versionamento;
  if (!v || typeof v !== 'object' || !v.resolvidoEm) return { cfg: null, failOpen: 'versionamento.resolvidoEm ausente (repo sem onboarding)' };
  return { cfg: { ...DEFAULTS, ...v, idPadrao: raw?.fluxo?.idPadrao ?? DEFAULTS.idPadrao }, failOpen: null };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
}

/** `%H%x00%P%x00%s`: sha, pais separados por espaço, assunto. NUL evita colisão com `|` ou `;` em assuntos. */
export function listarCommits(root, { base, max = 20 } = {}) {
  const args = ['log', '--format=%H%x00%P%x00%s'];
  if (base) args.push(`${base}..HEAD`);
  else args.push('--first-parent', `-n${max}`, 'HEAD');
  return git(args, root)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, pais, assunto] = l.split('\0');
      return { sha, pais: pais ? pais.split(' ').filter(Boolean) : [], assunto: assunto ?? '' };
    });
}

export function checar(root, opts = {}) {
  const { cfg, failOpen } = opts.cfg ? { cfg: { ...DEFAULTS, ...opts.cfg }, failOpen: null } : lerConfig(root);
  if (failOpen) return { ok: true, achados: [], failOpen };
  let commits;
  try {
    commits = listarCommits(root, opts);
  } catch (e) {
    return { ok: true, achados: [], aviso: `sem git legível em ${root} (${String(e?.message ?? e).split('\n')[0]})` };
  }
  const achados = [];
  for (const c of commits) {
    if (c.pais.length >= 2) continue; // merge do orquestrador: o squash é atestado, não varrido
    const r = validarCommit(c.assunto, cfg);
    if (!r.ok) achados.push({ sha: c.sha.slice(0, 7), motivo: `${r.motivo} — "${c.assunto}"` });
  }
  let branch = opts.branch;
  if (!branch) {
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    } catch {
      branch = null;
    }
  }
  if (branch && branch !== 'HEAD') {
    const r = validarBranch(branch, cfg);
    if (!r.ok) achados.push({ sha: 'branch', motivo: r.motivo });
  }
  return { ok: achados.length === 0, achados, commits: commits.length, branch: branch ?? null };
}

export function raizDoRepo(cwd = process.cwd()) {
  try {
    const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return r || cwd;
  } catch {
    return cwd;
  }
}

function main(argv) {
  const arg = (nome, fallback) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const root = arg('root') ? resolve(arg('root')) : raizDoRepo();
  const max = Number(arg('max', 20)) || 20;
  const r = checar(root, { base: arg('base'), branch: arg('branch'), max });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    process.exit(r.failOpen ? 0 : r.ok ? 0 : 1);
  }
  if (r.failOpen) {
    console.error(`[R20] ${r.failOpen} — fail-open declarado (G9)`);
    process.exit(0);
  }
  if (r.aviso) console.error(`[R20] ${r.aviso} — nada conferido`);
  for (const a of r.achados) console.error(`::error::[R20] ${a.sha} ${a.motivo}`);
  if (r.ok) console.log(`[R20] ok — ${r.commits} commit(s) conferido(s)${r.branch ? `, branch ${r.branch}` : ''}`);
  else console.error(`[R20] ${r.achados.length} achado(s). Formato: tipo(PBI-n): assunto · branch tipo/PBI-n-slug ou wt/PBI-n-i. Ver docs/harness/referencia.md §10.`);
  process.exit(r.ok ? 0 : 1);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
```

- [ ] **T7.4 — Ver VERDE:** `node --test test/versionamento-check.test.mjs`; depois `npm test`.
- [ ] **T7.5 — Mutação rápida:** comente `if (c.pais.length >= 2) continue;` — "merge ignorado" cai. Troque `if (!h.escopo) return …` por nada — "fix: c" cai. Reverta.
- [ ] **T7.6 — Commit:** `feat(GM-2): versionamento-check.mjs — R20 sobre histórico de primeiro pai e nome da branch`.

---
## T8 — doctor: 8 checagens novas, `--cache`, `tamanhoAgents`, config inválida sem crash (REQ-DOC-1, DOC-2, CTX-1, ORQ-5, FLX-2)

**Files**
- Modificar: `plugins/gabarito-mestre/gates/scripts/harness-doctor.mjs`
- Modificar: `plugins/gabarito-mestre/gates/test/harness-doctor.test.mjs`
- Depende de: T7 (`./versionamento-check.mjs` é importado).

**Interfaces**
- Consumes: tudo que já consome + `harness.config.json` seções `fluxo`, `versionamento`, `orquestracao`, `contexto` (top-level, via o `{ ...DEFAULTS, ...fileCfg }` que já existe) + `checar(root, { max: 20 })` de `./versionamento-check.mjs` + `git tag --list` (sem git → `--`) + `.harness/attest.json` chave nova `iniciativa-resolvida`.
- Produces (CLI): `node harness-doctor.mjs [--json] [--explain] [--cache]`. `--cache` grava `<raiz>/.harness/doctor-cache.json` = `{ "nivel": <alcancado>, "declarado": <n|null>, "em": "<ISO 8601>" }` **antes** de decidir o exit (o cartão precisa do cache mesmo quando o repo mente). Raiz = `git rev-parse --show-toplevel` com fallback cwd. Exit como hoje (`mentindo ? 1 : 0`).
- Produces (ESM): `run(root, overrides)` puro (nunca escreve) → acrescenta `novasFaltando: string[]`, `avisos: string[]`, `configInvalido: boolean` · `CHECKS` + 8 entradas · `parseDeclaredLevel` (inalterado) · `tamanhoAgents(texto) → { nucleo, apendice }` (bytes UTF-8 reais; corte no **primeiro** cabeçalho de linha que **começa** com `## Apêndice`, incluindo a quebra de linha anterior no núcleo; sem Apêndice → `apendice: 0`) · `NOVAS_1_1_0` (ids das 8 checagens).
- Checagens novas (contrato, `id` · nível · found quando): `fluxo-configurado` n2 · `iniciativa-resolvida` n2 attest · `versionamento` n2 · `changelog` n2 · `tag-semver` n2 opcional · `agents-tamanho` n2 · `paralelismo-calibrado` n3 · `modelo-resolvido` **`level: 'warn'`** (não entra no cálculo do nível; renderizado numa seção "Avisos").
- Saída extra em `render` quando `mentindo && novasFaltando.length`: `checagens novas da 1.1.0: rode o onboarding ou declare o nível medido`. Config inválida: `AVISO: harness.config.json inválido — checagens de config ficam FALTA (fail-open declarado (G9))`, sem stack trace.

**Mutações prescritas (acrescentar ao cabeçalho existente):** M4 `>` por `>=` em `agents-tamanho` (17.291 passa a FALTA) · M5 rebaixar uma checagem nova para `level: 1` (fixture 1.0.1 nível 1 cai para 0) · M6 `modelo-resolvido` com `level: 2` (vencido derruba o nível) · M7 cortar só em `## Apêndice\n` exato (`## Apêndice — Projeto` deixa de ser corte) · M8 `run()` gravando o cache (viola pureza) · M9 `JSON.parse` sem try/catch em `run()` (config inválida vira stack trace).

**Steps**

- [ ] **T8.0 — Conferir os nomes da 1.0.1 antes de escrever.** O código desta task assume que `ix.root`, `ATTEST_TTL_DAYS`, `cfg.agentsFile` e a função de atestado existem em `harness-doctor.mjs` 1.0.1 **com esses nomes**. Grep exato: `grep -n "ix.root\|ATTEST_TTL_DAYS\|agentsFile\|createIndex" plugins/gabarito-mestre/gates/scripts/harness-doctor.mjs`. Se `ix.root` faltar, acrescente `root` ao objeto devolvido por `createIndex` (T8.2) antes de qualquer checagem nova usá-lo; se outro nome divergir, use o nome real do arquivo e registre a diferença no ledger — não renomeie o que a 1.0.1 já exporta.
- [ ] **T8.1 — Teste vermelho.** Em `plugins/gabarito-mestre/gates/test/harness-doctor.test.mjs`: (a) acrescente M4–M9 ao cabeçalho; (b) troque o import por `import { run, parseDeclaredLevel, CHECKS, tamanhoAgents, NOVAS_1_1_0 } from '../scripts/harness-doctor.mjs';` e acrescente `import { spawnSync, execFileSync } from 'node:child_process'; import { existsSync, readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url';`; (c) ajuste o teste "repo vazio" para `assert.equal(out.resultados.filter((r) => r.found && r.id !== 'agents-tamanho').length, 0, 'agents-tamanho passa por construção num AGENTS.md mínimo')`; (d) no teste de integridade, aceite `[1, 2, 3, 'warn'].includes(c.level)`; (e) acrescente ao final:

```js
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'harness-doctor.mjs');
const ok = { confirmado: true, por: 'g', em: hoje };
const diasAtras = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Repo 1.0.1 que o doctor 1.0.1 mede como nível 2 (fato (a) medido ao escrever o plano). */
const fixtureNivel2_101 = (declarado) => ({
  'AGENTS.md': agents(declarado),
  'src/db.ts': 'base.$extends(massMutationGuard()); strictUndefinedChecks; assertNotProduction();',
  'test/a.spec.ts': 'await db.x.' + 'deleteMany({ where: { id } });',
  '.gitignore': '.env\n',
  '.env.example': 'API_TOKEN=\n',
  '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'ruleset-obrigatorio': ok }),
  'docs/specs/a.md': '', 'docs/plans/a.md': '', 'docs/backlog.md': '', 'docs/harness/ledger.md': '',
  '.github/PULL_REQUEST_TEMPLATE.md': 'requisito migration teardown',
  'docs/harness/prompts.md': '',
  '.github/workflows/ci.yml': 'jobs: unit integration quality migrations-guard',
  'scripts/migrations-guard.mjs': 'DESTRUCTIVE_PATTERN',
});
/** O mesmo repo depois do onboarding 1.1.0 (fases 2 e 3) + CHANGELOG + atestado da Iniciativa. */
const fixtureNivel2_110 = (declarado, extraCfg = {}) => ({
  ...fixtureNivel2_101(declarado),
  'harness.config.json': JSON.stringify({
    fluxo: { ferramenta: 'arquivos', resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' },
    versionamento: { resolvidoEm: hoje, changelog: 'CHANGELOG.md' },
    ...extraCfg,
  }),
  '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'ruleset-obrigatorio': ok, 'iniciativa-resolvida': ok }),
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
});
/** AGENTS.md cujo núcleo tem EXATAMENTE `bytesNucleo` bytes (o `\n` antes do Apêndice conta no núcleo). */
function agentsComNucleo(bytesNucleo, apendice = '## Apêndice — Projeto\n\nIniciativa: INI-1\n') {
  const cabeca = '# AGENTS.md\n\n**Nível de adoção declarado: `2`**\n\n';
  return `${cabeca}${'x'.repeat(bytesNucleo - Buffer.byteLength(cabeca) - 1)}\n${apendice}`;
}
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('doctor 1.1.0 — tamanhoAgents (CTX-1, Review Focus 4)', () => {
  test('corta no primeiro cabeçalho que COMEÇA com "## Apêndice" — inclusive "## Apêndice — Projeto"', () => {
    const t = 'núcleo\n\n## Apêndice — Projeto\ncorpo\n## Apêndice\noutro';
    const { nucleo, apendice } = tamanhoAgents(t);
    assert.equal(nucleo, Buffer.byteLength('núcleo\n\n'));
    assert.equal(apendice, Buffer.byteLength('## Apêndice — Projeto\ncorpo\n## Apêndice\noutro'));
  });
  test('CRLF conta bytes reais e "\\r\\n## Apêndice" ainda é cabeçalho de linha', () => {
    const t = 'a\r\nb\r\n## Apêndice — x\r\ny';
    assert.deepEqual(tamanhoAgents(t), { nucleo: Buffer.byteLength('a\r\nb\r\n'), apendice: Buffer.byteLength('## Apêndice — x\r\ny') });
  });
  test('"## Apêndice" no meio de uma linha ou "### Apêndice" não cortam; sem Apêndice → apendice 0', () => {
    assert.equal(tamanhoAgents('x ## Apêndice y\n### Apêndice\n').apendice, 0);
    assert.deepEqual(tamanhoAgents(''), { nucleo: 0, apendice: 0 });
    assert.deepEqual(tamanhoAgents(null), { nucleo: 0, apendice: 0 });
  });
  test('acentos contam em UTF-8 (bytes, não caracteres)', () => {
    assert.equal(tamanhoAgents('ação').nucleo, 6);
  });
  test('fixture 17.291 → ok · 17.292 → FALTA (as duas juntas matam `>`→`>=`)', () => {
    assert.equal(tamanhoAgents(agentsComNucleo(17291)).nucleo, 17291, 'sanidade do helper');
    const passa = run(repo({ 'AGENTS.md': agentsComNucleo(17291) }));
    assert.equal(passa.resultados.find((r) => r.id === 'agents-tamanho').found, true);
    const falta = run(repo({ 'AGENTS.md': agentsComNucleo(17292) }));
    assert.equal(falta.resultados.find((r) => r.id === 'agents-tamanho').found, false);
    assert.match(falta.resultados.find((r) => r.id === 'agents-tamanho').evidence, /núcleo 17292\/17291/);
  });
  test('Apêndice acima de apendiceMaxBytes é FALTA mesmo com núcleo ok; tetos vêm de contexto.*', () => {
    const grande = run(repo({ 'AGENTS.md': agentsComNucleo(1000, `## Apêndice\n${'y'.repeat(4097)}`) }));
    assert.equal(grande.resultados.find((r) => r.id === 'agents-tamanho').found, false);
    const teto = run(repo({ 'AGENTS.md': agentsComNucleo(1000, `## Apêndice\n${'y'.repeat(4097)}`), 'harness.config.json': JSON.stringify({ contexto: { nucleoMaxBytes: 17291, apendiceMaxBytes: 8192 } }) }));
    assert.equal(teto.resultados.find((r) => r.id === 'agents-tamanho').found, true);
  });
});

describe('doctor 1.1.0 — fixtures 1.0.1 e 1.1.0 (DOC-1)', () => {
  test('a fixture 1.0.1 de nível 2 mede nível 1 no doctor 1.1.0 e lista as checagens novas', () => {
    const out = run(repo(fixtureNivel2_101(2)));
    assert.equal(out.alcancado, 1);
    assert.equal(out.mentindo, true);
    for (const id of ['fluxo-configurado', 'iniciativa-resolvida', 'versionamento', 'changelog']) assert.ok(out.novasFaltando.includes(id), id);
  });
  test('repo 1.0.1 em nível 1 continua nível 1 (nenhuma checagem nova é de nível 1)', () => {
    const fx = fixtureNivel2_101(1);
    delete fx['docs/backlog.md'];
    const out = run(repo(fx));
    assert.equal(out.alcancado, 1);
    assert.equal(out.mentindo, false);
    for (const c of CHECKS.filter((c) => NOVAS_1_1_0.includes(c.id))) assert.notEqual(c.level, 1, `${c.id} não pode ser nível 1`);
  });
  test('depois do onboarding (fixture 1.1.0) o nível volta a 2', () => {
    const out = run(repo(fixtureNivel2_110(2)));
    assert.equal(out.alcancado, 2, JSON.stringify(out.novasFaltando));
    assert.equal(out.mentindo, false);
    assert.deepEqual(out.novasFaltando, ['paralelismo-calibrado'], 'só a checagem de nível 3 segue faltando (onboarding fase 4 não rodou)');
  });
  test('fluxo-configurado exige resolvidoEm no formato AAAA-MM-DD', () => {
    const bom = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ fluxo: { resolvidoEm: '2026-09-24' } }) }));
    assert.equal(bom.resultados.find((r) => r.id === 'fluxo-configurado').found, true);
    const ruim = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ fluxo: { resolvidoEm: 'ontem' } }) }));
    assert.equal(ruim.resultados.find((r) => r.id === 'fluxo-configurado').found, false);
  });
  test('iniciativa-resolvida é atestado com TTL 180 d', () => {
    const vencido = run(repo({ 'AGENTS.md': agents(0), '.harness/attest.json': JSON.stringify({ 'iniciativa-resolvida': { ...ok, em: diasAtras(200) } }) }));
    const r = vencido.resultados.find((x) => x.id === 'iniciativa-resolvida');
    assert.equal(r.kind, 'attest');
    assert.equal(r.found, false);
    assert.match(r.evidence, /vencido/);
  });
  test('changelog: exige o arquivo de versionamento.changelog com "## [Unreleased]" ou "## Unreleased"', () => {
    const cfg = JSON.stringify({ versionamento: { changelog: 'HISTORY.md' } });
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## Unreleased\n' })).resultados.find((r) => r.id === 'changelog').found, true);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## 1.0.0\n' })).resultados.find((r) => r.id === 'changelog').found, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'CHANGELOG.md': '## [Unreleased]\n' })).resultados.find((r) => r.id === 'changelog').found, true, 'default CHANGELOG.md');
  });
  test('versionamento: sem git é ok com aviso; com histórico ruim é FALTA', () => {
    const semGit = run(repo(fixtureNivel2_110(2))).resultados.find((r) => r.id === 'versionamento');
    assert.equal(semGit.found, true);
    assert.match(semGit.warn, /histórico não conferido/);
    const dir = repo(fixtureNivel2_110(2));
    git(dir, 'init', '-q');
    git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'arrumei');
    const comGit = run(dir).resultados.find((r) => r.id === 'versionamento');
    assert.equal(comGit.found, false);
    assert.match(comGit.evidence, /arrumei/);
  });
  test('tag-semver é opcional: sem git "--", com tag v1.2.3 found', () => {
    const semGit = run(repo({ 'AGENTS.md': agents(0) })).resultados.find((r) => r.id === 'tag-semver');
    assert.equal(semGit.opcional, true);
    assert.equal(semGit.found, false);
    assert.equal(semGit.evidence, '--');
    const dir = repo({ 'AGENTS.md': agents(0) });
    git(dir, 'init', '-q');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
    git(dir, 'tag', 'v1.2.3');
    assert.equal(run(dir).resultados.find((r) => r.id === 'tag-semver').found, true);
  });
  test('paralelismo-calibrado (n3): calibradoEm ≤ 180 d e teto ≥ simultaneos ≥ 1', () => {
    const cfg = (p) => JSON.stringify({ orquestracao: { paralelismo: p } });
    const id = 'paralelismo-calibrado';
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg({ simultaneos: 2, teto: 4, calibradoEm: hoje }) })).resultados.find((r) => r.id === id).found, true);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg({ simultaneos: 2, teto: 4, calibradoEm: diasAtras(181) }) })).resultados.find((r) => r.id === id).found, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg({ simultaneos: 5, teto: 4, calibradoEm: hoje }) })).resultados.find((r) => r.id === id).found, false);
    assert.equal(CHECKS.find((c) => c.id === id).level, 3);
  });
});

describe('doctor 1.1.0 — modelo-resolvido é warn, não FALTA (ORQ-5)', () => {
  test('vencido há 91 dias: aviso presente e nível INALTERADO', () => {
    const out = run(repo(fixtureNivel2_110(2, { orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } })));
    assert.equal(out.alcancado, 2);
    assert.equal(CHECKS.find((c) => c.id === 'modelo-resolvido').level, 'warn');
    assert.ok(out.avisos.some((a) => a.startsWith('modelo-resolvido')), JSON.stringify(out.avisos));
    assert.match(out.resultados.find((r) => r.id === 'modelo-resolvido').evidence, /VENCIDO/);
  });
  test('dentro da validade: sem aviso', () => {
    const out = run(repo(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(10), validadeDias: 90 } } })));
    assert.deepEqual(out.avisos, []);
  });
});

describe('doctor 1.1.0 — config ausente/vazia/inválida (Review Focus 3)', () => {
  test('harness.config.json inválido: run() não lança; fluxo-configurado é FALTA; configInvalido = true', () => {
    const out = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': '{"fluxo": ' }));
    assert.equal(out.configInvalido, true);
    assert.equal(out.resultados.find((r) => r.id === 'fluxo-configurado').found, false);
  });
  test('vazio (0 bytes) e sem arquivo: idem, sem lançar', () => {
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': '' })).configInvalido, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0) })).resultados.find((r) => r.id === 'fluxo-configurado').found, false);
  });
  test('CLI com config inválida: exit 0, AVISO fail-open, sem stack trace', () => {
    const dir = repo({ 'AGENTS.md': agents(0), 'harness.config.json': '{' });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
});

describe('doctor 1.1.0 — cache (DOC-2)', () => {
  test('run() é puro: não cria .harness/doctor-cache.json', () => {
    const dir = repo({ 'AGENTS.md': agents(0) });
    run(dir);
    assert.equal(existsSync(join(dir, '.harness', 'doctor-cache.json')), false);
  });
  test('--cache grava { nivel, declarado, em } mesmo quando o repo mente (exit 1)', () => {
    const dir = repo(fixtureNivel2_101(2));
    const r = spawnSync(process.execPath, [SCRIPT, '--json', '--cache'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    const c = JSON.parse(readFileSync(join(dir, '.harness', 'doctor-cache.json'), 'utf8'));
    assert.equal(c.nivel, 1);
    assert.equal(c.declarado, 2);
    assert.ok(!Number.isNaN(Date.parse(c.em)));
    assert.deepEqual(Object.keys(c), ['nivel', 'declarado', 'em']);
  });
  test('sem --cache não grava', () => {
    const dir = repo({ 'AGENTS.md': agents(0) });
    spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(existsSync(join(dir, '.harness', 'doctor-cache.json')), false);
  });
});

describe('doctor 1.1.0 — render', () => {
  test('repo 1.0.1 declarando 2: exit 1 e a linha "checagens novas da 1.1.0"', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--explain'], { cwd: repo(fixtureNivel2_101(2)), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /checagens novas da 1\.1\.0: rode o onboarding ou declare o nível medido/);
    assert.match(r.stdout, /FALTA .*fluxo configurado/);
    assert.match(r.stdout, /→ rode gabarito-instalar/);
  });
  test('modelo vencido aparece como "warn" numa seção de avisos e não altera o exit', () => {
    const dir = repo(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } }));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /── Avisos/);
    assert.match(r.stdout, / warn .*modelo do orquestrador/);
  });
  test('as 8 checagens novas existem, com id/regra/nível/rótulo/conserto', () => {
    assert.equal(NOVAS_1_1_0.length, 8);
    for (const id of NOVAS_1_1_0) assert.ok(CHECKS.find((c) => c.id === id), id);
  });
});
```

- [ ] **T8.2 — Ver VERMELHO:** `node --test test/harness-doctor.test.mjs` — falha no import de `tamanhoAgents`/`NOVAS_1_1_0`. Commit: `test(GM-2): doctor — 8 checagens novas, tamanhoAgents com CRLF e "## Apêndice —", cache, config inválida`.

- [ ] **T8.3 — Implementação (edits em `harness-doctor.mjs`).**

(a) Cabeçalho JSDoc: acrescente ao bloco USO a linha `*   node harness-doctor.mjs --cache    # grava .harness/doctor-cache.json { nivel, declarado, em } (lido pelo cartão de sessão)` e, antes de USO, o parágrafo: ` * 1.1.0: oito checagens novas (fluxo, Iniciativa atestada, versionamento, changelog, tag, tamanho do AGENTS.md, paralelismo calibrado) e um aviso (modelo resolvido, que NÃO entra no nível). Config inválida é fail-open declarado: checagens de config ficam FALTA, nunca stack trace.`

(b) Imports — substitua as três linhas de import por:

```js
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checar } from './versionamento-check.mjs';
```

(c) Logo após `attestOk` (antes de `// ── checagens`), acrescente:

```js
// ────────────────────────────────────────────────────────────── 1.1.0 — auxiliares

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const diasDesde = (data) => {
  const d = (Date.now() - Date.parse(data)) / 86_400_000;
  return Number.isNaN(d) ? null : d;
};

/** ids das checagens novas da 1.1.0 — a linha "rode o onboarding" só aparece por causa delas. */
export const NOVAS_1_1_0 = [
  'fluxo-configurado', 'iniciativa-resolvida', 'versionamento', 'changelog',
  'tag-semver', 'agents-tamanho', 'paralelismo-calibrado', 'modelo-resolvido',
];

/**
 * Bytes UTF-8 do núcleo (tudo antes do PRIMEIRO cabeçalho de linha que começa com `## Apêndice`,
 * inclusive a quebra de linha anterior) e do Apêndice. CRLF conta bytes reais. Sem Apêndice: 0.
 */
export function tamanhoAgents(texto) {
  const t = String(texto ?? '');
  const m = /(^|\r?\n)## Apêndice/.exec(t);
  const corte = m ? m.index + m[1].length : t.length;
  return { nucleo: Buffer.byteLength(t.slice(0, corte), 'utf8'), apendice: Buffer.byteLength(t.slice(corte), 'utf8') };
}
```

(d) No array `CHECKS`, **depois** de `ruleset-obrigatorio` (fim do nível 2) insira:

```js
  // ── Nível 2 — 1.1.0 (Workflow TRUE, versionamento, contexto)
  {
    id: 'fluxo-configurado',
    rule: 'R19 / FLX-2',
    level: 2,
    kind: 'scan',
    label: 'fluxo configurado (onboarding da fase 2 concluído)',
    fix: 'rode gabarito-instalar — a fase 2 grava fluxo.resolvidoEm em harness.config.json',
    detect: (ix, cfg) => {
      const em = cfg.fluxo?.resolvidoEm;
      if (typeof em === 'string' && ISO_DATA.test(em)) return { found: true, evidence: `fluxo.resolvidoEm = ${em}` };
      return { found: false, evidence: cfg.configInvalido ? 'harness.config.json inválido' : 'sem fluxo.resolvidoEm (AAAA-MM-DD)' };
    },
  },
  {
    id: 'iniciativa-resolvida',
    rule: 'R19 / FLX-1',
    level: 2,
    kind: 'attest',
    label: 'Iniciativa confirmada na ferramenta — existe ≠ ativa (I10)',
    fix: 'confirme a Iniciativa no onboarding e ateste iniciativa-resolvida em .harness/attest.json',
  },
  {
    id: 'versionamento',
    rule: 'R20 / VER-3',
    level: 2,
    kind: 'scan',
    label: 'versionamento configurado e histórico recente conforme (20 commits de primeiro pai)',
    fix: 'rode gabarito-instalar (fase 3) e corrija os commits apontados por versionamento-check.mjs',
    detect: (ix, cfg) => {
      const em = cfg.versionamento?.resolvidoEm;
      if (!em) return { found: false, evidence: cfg.configInvalido ? 'harness.config.json inválido' : 'sem versionamento.resolvidoEm' };
      const r = checar(ix.root, { max: 20 });
      if (r.failOpen) return { found: false, evidence: r.failOpen };
      if (r.aviso) return { found: true, evidence: `resolvido em ${em}`, warn: `${r.aviso} — histórico não conferido` };
      if (r.ok) return { found: true, evidence: `resolvido em ${em} · ${r.commits} commit(s) conformes` };
      return { found: false, evidence: `${r.achados.length} achado(s): ${r.achados.slice(0, 2).map((a) => `${a.sha} ${a.motivo}`).join('; ')}` };
    },
  },
  {
    id: 'changelog',
    rule: 'R20',
    level: 2,
    kind: 'scan',
    label: 'CHANGELOG com seção Unreleased (Keep a Changelog)',
    fix: 'crie o CHANGELOG.md com `## [Unreleased]` — a PR escreve a linha dela lá',
    detect: (ix, cfg) => {
      const f = cfg.versionamento?.changelog ?? 'CHANGELOG.md';
      if (!ix.has(f)) return { found: false, evidence: `${f} ausente` };
      return /^## \[?Unreleased\]?/m.test(ix.read(f)) ? { found: true, evidence: f } : { found: false, evidence: `${f} sem seção Unreleased` };
    },
  },
  {
    id: 'tag-semver',
    rule: 'R20',
    level: 2,
    kind: 'scan',
    opcional: true,
    label: 'ao menos uma tag SemVer (opcional em repo sem release)',
    fix: 'marque a release: git tag v1.0.0 — opcional até a primeira release',
    detect: (ix, cfg) => {
      let tags;
      try {
        tags = execFileSync('git', ['tag', '--list'], { cwd: ix.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
      } catch {
        return { found: false, evidence: '--' };
      }
      const re = new RegExp(cfg.versionamento?.tag ?? '^v\\d+\\.\\d+\\.\\d+$');
      const t = tags.find((x) => re.test(x));
      return t ? { found: true, evidence: t } : { found: false, evidence: 'nenhuma tag SemVer' };
    },
  },
  {
    id: 'agents-tamanho',
    rule: 'CTX-1',
    level: 2,
    kind: 'scan',
    label: 'AGENTS.md dentro do teto — núcleo e Apêndice medidos em bytes',
    fix: 'migre texto do núcleo para docs/harness/referencia.md — regra não some, texto migra (ADR-CTX-1)',
    detect: (ix, cfg) => {
      if (!ix.has(cfg.agentsFile)) return { found: false, evidence: `${cfg.agentsFile} ausente` };
      const { nucleo, apendice } = tamanhoAgents(ix.read(cfg.agentsFile));
      const maxN = Number(cfg.contexto?.nucleoMaxBytes ?? 17291);
      const maxA = Number(cfg.contexto?.apendiceMaxBytes ?? 4096);
      const evidence = `núcleo ${nucleo}/${maxN} B · apêndice ${apendice}/${maxA} B`;
      return { found: nucleo <= maxN && apendice <= maxA, evidence };
    },
  },
```

e, **depois** de `doctor-no-ci` (fim do nível 3), insira:

```js
  {
    id: 'paralelismo-calibrado',
    rule: 'R21 / PAR-1',
    level: 3,
    kind: 'scan',
    label: 'paralelismo calibrado nesta máquina (≤ 180 d, teto ≥ simultaneos ≥ 1)',
    fix: 'rode capacidade.mjs --calibrar e grave orquestracao.paralelismo via onboarding-config.mjs',
    detect: (ix, cfg) => {
      const p = cfg.orquestracao?.paralelismo;
      if (!p?.calibradoEm) return { found: false, evidence: 'sem orquestracao.paralelismo.calibradoEm' };
      const d = diasDesde(p.calibradoEm);
      if (d === null || d > ATTEST_TTL_DAYS) return { found: false, evidence: `calibração vencida ou inválida (${p.calibradoEm})` };
      const s = Number(p.simultaneos);
      const t = Number(p.teto);
      return t >= s && s >= 1
        ? { found: true, evidence: `simultaneos ${s} · teto ${t} · calibrado ${p.calibradoEm}` }
        : { found: false, evidence: `teto ${t} ≥ simultaneos ${s} ≥ 1 não vale` };
    },
  },

  // ── Avisos — não entram no nível (ORQ-5)
  {
    id: 'modelo-resolvido',
    rule: 'R21 / ORQ-5',
    level: 'warn',
    kind: 'scan',
    label: 'modelo do orquestrador resolvido há menos de validadeDias',
    fix: 'revalide o modelo com gabarito-instalar (fase 4) — é aviso: não muda o nível nem quebra o CI',
    detect: (ix, cfg) => {
      const m = cfg.orquestracao?.modelo;
      if (!m?.resolvidoEm) return { found: false, evidence: 'sem orquestracao.modelo.resolvidoEm' };
      const d = diasDesde(m.resolvidoEm);
      const v = Number(m.validadeDias ?? 90);
      if (d === null) return { found: false, evidence: `resolvidoEm inválido (${m.resolvidoEm})` };
      return d <= v
        ? { found: true, evidence: `${m.alias || '?'} resolvido em ${m.resolvidoEm} (${Math.round(v - d)} d restantes)` }
        : { found: false, evidence: `VENCIDO há ${Math.round(d - v)} d (${m.alias || '?'}, resolvido em ${m.resolvidoEm}) — revalide` };
    },
  },
```

(e) Substitua `run()` inteiro por:

```js
export function run(root = process.cwd(), overrides = {}) {
  const cfgFile = join(root, 'harness.config.json');
  let fileCfg = {};
  let configInvalido = false;
  if (existsSync(cfgFile)) {
    try {
      const lido = JSON.parse(readFileSync(cfgFile, 'utf8') || '{}');
      if (lido && typeof lido === 'object' && !Array.isArray(lido)) fileCfg = lido;
      else configInvalido = true;
    } catch {
      configInvalido = true; // fail-open declarado: checagens de config ficam FALTA, nunca stack trace
    }
  }
  const cfg = { ...DEFAULTS, ...fileCfg, ...overrides, configInvalido };

  const ix = createIndex(root, cfg);
  const attest = loadAttest(ix, cfg);

  const resultados = CHECKS.map((c) => {
    if (c.kind === 'attest') {
      const a = attestOk(attest, c.id);
      if (!a) return { ...c, found: false, evidence: 'sem atestado em .harness/attest.json' };
      if (a.stale)
        return { ...c, found: false, evidence: `atestado vencido (${a.dias} dias, por ${a.por})` };
      return { ...c, found: true, evidence: `atestado por ${a.por} em ${a.em}` };
    }
    const r = c.detect(ix, cfg) ?? { found: false };
    return { ...c, ...r };
  });

  // Nível alcançado = maior N em que TODA checagem obrigatória de nível <= N passou.
  // `level: 'warn'` nunca é igual a 1, 2 ou 3: avisos não entram na conta por construção.
  let alcancado = 0;
  for (const nivel of [1, 2, 3]) {
    const obrigatorias = resultados.filter((r) => r.level === nivel && !r.opcional);
    if (obrigatorias.every((r) => r.found)) alcancado = nivel;
    else break;
  }

  const agents = ix.has(cfg.agentsFile) ? ix.read(cfg.agentsFile) : null;
  const declarado = parseDeclaredLevel(agents);

  const novasFaltando = resultados
    .filter((r) => NOVAS_1_1_0.includes(r.id) && r.level !== 'warn' && !r.opcional && !r.found)
    .map((r) => r.id);
  const avisos = resultados.filter((r) => r.level === 'warn' && !r.found).map((r) => `${r.id}: ${r.evidence ?? ''}`);

  return {
    resultados,
    alcancado,
    declarado,
    mentindo: declarado !== null && declarado > alcancado,
    semAgents: agents === null,
    semDeclaracao: agents !== null && declarado === null,
    novasFaltando,
    avisos,
    configInvalido,
  };
}
```

(f) Substitua `render()` inteiro por:

```js
function render(out, explain) {
  const linhas = [];
  linhas.push('harness-doctor — evidência de gates neste repositório', '');
  for (const nivel of [1, 2, 3]) {
    const rotulo = { 1: 'segurança', 2: 'processo', 3: 'completo' }[nivel];
    linhas.push(`── Nível ${nivel} — ${rotulo}`);
    for (const r of out.resultados.filter((x) => x.level === nivel)) {
      const marca = r.found ? '  ok ' : r.opcional ? '  -- ' : ' FALTA';
      const tipo = r.kind === 'attest' ? ' (atestado)' : '';
      linhas.push(`${marca} ${r.rule.padEnd(10)} ${r.label}${tipo}`);
      if (r.evidence) linhas.push(`        ↳ ${r.evidence}`);
      if (r.warn) linhas.push(`        ⚠ ${r.warn}`);
      if (explain && !r.found) linhas.push(`        → ${r.fix}`);
    }
    linhas.push('');
  }
  const avisos = out.resultados.filter((x) => x.level === 'warn');
  if (avisos.length) {
    linhas.push('── Avisos (não contam no nível)');
    for (const r of avisos) {
      linhas.push(`${r.found ? '  ok ' : ' warn'} ${r.rule.padEnd(10)} ${r.label}`);
      if (r.evidence) linhas.push(`        ↳ ${r.evidence}`);
      if (explain && !r.found) linhas.push(`        → ${r.fix}`);
    }
    linhas.push('');
  }
  linhas.push(`Nível alcançado: ${out.alcancado}   ·   declarado no AGENTS.md: ${out.declarado ?? '(não declarado)'}`);
  if (out.configInvalido) linhas.push('AVISO: harness.config.json inválido — checagens de config ficam FALTA (fail-open declarado (G9)).');
  if (out.semAgents) linhas.push('AVISO: AGENTS.md não encontrado na raiz.');
  else if (out.semDeclaracao) linhas.push('AVISO: o §0.2 não declara nível. Preencha — é a honestidade do documento sobre si mesmo.');
  if (out.mentindo) {
    linhas.push(
      '',
      `ERRO: o AGENTS.md declara nível ${out.declarado} e os gates sustentam ${out.alcancado}.`,
      'Um nível inflado é exatamente a mentira que o §0.2 existe para pegar.',
      'Conserto: implemente os gates que faltam, OU baixe o nível declarado.',
    );
    if (out.novasFaltando.length) linhas.push('checagens novas da 1.1.0: rode o onboarding ou declare o nível medido');
  }
  return linhas.join('\n');
}
```

(g) Substitua `main()` por:

```js
function raizDoRepo(cwd = process.cwd()) {
  try {
    const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return r || cwd;
  } catch {
    return cwd;
  }
}

/** Única escrita do doctor. `run()` continua puro; o cartão de sessão lê este arquivo (DOC-2, TTL 24 h). */
function gravarCache(root, out) {
  const f = join(root, '.harness', 'doctor-cache.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify({ nivel: out.alcancado, declarado: out.declarado, em: new Date().toISOString() }, null, 2)}\n`);
}

function main(argv) {
  const root = raizDoRepo();
  const out = run(root);
  if (argv.includes('--cache')) gravarCache(root, out); // antes do exit: o cartão precisa do cache mesmo quando o repo mente
  if (argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        { ...out, resultados: out.resultados.map(({ detect, ...r }) => r) },
        null,
        2,
      ),
    );
    process.exit(out.mentindo ? 1 : 0);
  }
  console.log(render(out, argv.includes('--explain')));
  process.exit(out.mentindo ? 1 : 0);
}
```

- [ ] **T8.4 — Ver VERDE:** `node --test test/harness-doctor.test.mjs`; depois `npm test` (a suíte 1.0.1 inteira continua verde — os únicos testes antigos tocados são "repo vazio" e "integridade").
- [ ] **T8.5 — Doctor sobre o próprio repositório do plugin (job `doctor-self` do CI):** `node plugins/gabarito-mestre/gates/scripts/harness-doctor.mjs --json` na raiz do repo → nenhuma evidência `found` com `gabarito-mestre/` no `evidence` (as checagens novas leem config e git, não varrem `reference/`; `versionamento` aqui é FALTA porque este repo não tem `versionamento.resolvidoEm` — esperado, fail-open).
- [ ] **T8.6 — Mutação rápida:** em `agents-tamanho` troque `nucleo <= maxN` por `nucleo < maxN` — o teste 17.291 cai. Troque `level: 'warn'` de `modelo-resolvido` por `level: 2` — "nível INALTERADO" cai. Reverta.
- [ ] **T8.7 — Commit:** `feat(GM-2): doctor — 8 checagens da 1.1.0, --cache, tamanhoAgents e fail-open em config inválida`.

---
## T9 — `cartao-sessao.mjs` (REQ-ORQ-3, ORQ-6, FLX-8, DOC-2, PAR-2/PAR-5 leitura)

**Files**
- Criar: `plugins/gabarito-mestre/gates/scripts/cartao-sessao.mjs`
- Criar: `plugins/gabarito-mestre/gates/test/cartao-sessao.test.mjs`
- Depende de: T6 (`./capacidade.mjs`) e T8 (executa `harness-doctor.mjs --json --cache`).

**Interfaces**
- Consumes: raiz via `git rev-parse --show-toplevel` (fallback cwd) · `harness.config.json` (`fluxo.resolvidoEm` obrigatório; senão uma linha) · `git rev-parse --abbrev-ref HEAD` / `--short=7 HEAD` / `git worktree list --porcelain` · `.harness/fluxo-cache.json` (`{ "<PBI>": { epic, iniciativa, titulo, em } }`) · `docs/fluxo/pbis/<PBI>.md` (frontmatter `epic:` / `iniciativa:`, só com `fluxo.ferramenta: "arquivos"`) · `<ledgerDir>/<PBI>.md` (linhas `MOVIMENTO FL2 <EPIC> <de>→<para> <data>`, `BLOQUEADA <data> … — dono: <quem>`, `DISPATCH Task <N> slots=<n> worktree wt/<PBI>-<n>`, `## LER PRIMEIRO`) · `.harness/doctor-cache.json` (TTL 24 h; ausente/vencido → `node <pluginRoot>/gates/scripts/harness-doctor.mjs --json --cache` com `cwd = raiz`, timeout 20 s) · `medir`/`calcularSlots` de `./capacidade.mjs` · `tools/gabarito-gates/package.json` × `<pluginRoot>/.claude-plugin/plugin.json` · `~/.claude/plugins/installed_plugins.json` (override `GABARITO_INSTALLED_PLUGINS` / `opts.installedPlugins`).
- Produces (CLI): `node cartao-sessao.mjs [--root <dir>] [--plugin-root <dir>] [--json] [--agora <ISO>]`. Stdout: as linhas do cartão (≤ 40) ou `{ linhas, ctx }` com `--json`. **Sempre exit 0.** Sem `fluxo.resolvidoEm` (config ausente/vazia/inválida/sem seção): exatamente **uma** linha `GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)`; config inválida também avisa em stderr. Erro inesperado: uma linha `GABARITO: cartão indisponível — fail-open declarado (G9)`.
- Produces (ESM): `montarCartao(ctx) → string[]` (≤ 40, formato fixo do contrato) · `inferirPbi(branch, cfg) → { pbi, n } | null` (`wt/<PBI>-<n>` → `{ pbi, n }`; `<tipo>/<PBI>[-slug]` só quando `tipo ∈ versionamento.tiposComEscopoDePbi` **e** `<PBI>` casa `fluxo.idPadrao` case-sensitive; senão `null`) · `coletar(cwd, pluginRoot, opts) → ctx` · `lerLedger(texto) → { ultimaData, epicEstado, avisos, dispatches, linhaLerPrimeiro }` · `lerFrontmatter(texto)` · `resolverRaiz(cwd)` · `MAX_LINHAS = 40`, `CACHE_DOCTOR_H = 24`, `DEFAULTS`, `LINHA_SEM_ONBOARDING`.
- `ctx` (contrato + campos de apoio): `{ agora, root, semOnboarding, configInvalido, config, orquestracaoAusente, branch, sha, pbi, n, epic, iniciativa, fonteVinculo, epicEstado, avisosLedger, emVoo, worktrees, capacidade: { slots, motivo, medidas }, doctor: { nivel, declarado, em, fonte }, envelhecidos: [{ pbi, dias }], ledger: { caminho, linhaLerPrimeiro } | null, versoes: { instalada, plugin }, superpowers }`.
- Definições fechadas nesta task: **em voo** = chaves de `.harness/fluxo-cache.json` que casam `idPadrao` (ORQ-6: é a única fonte offline de PBI aberto); **envelhecido** = PBI em voo cuja última linha datada (`MOVIMENTO`/`BLOQUEADA`) no ledger — ou, sem ledger datado, o `em` do cache — tem mais de `fluxo.envelhecimentoDias` dias; **avisos de ledger** (só do PBI da branch): `BLOQUEADA` sem `dono:` (PAR-5) e `DISPATCH` sem `slots=` → `N dispatch sem medição (slots=)` (PAR-2).

**Mutações prescritas:** M1 omitir a linha `PBI:` · M2 uma linha por envelhecido (ultrapassa 40) · M3 ignorar o TTL de 24 h do cache do doctor (nunca recalcular) · M4 `inferirPbi` case-insensitive (`feat/pbi-12-x` vira PBI) · M5 ignorar `envelhecimentoDias` (todo PBI em voo é envelhecido) · M6 fail-closed sem config (exit ≠ 0 ou mais de uma linha) · M7 (duas partes) **M7a** omitir a linha MOVIMENTO no fixture → cartão deixa de mostrar `estado em_execucao`; **M7b** trocar o regex de MOVIMENTO por `(\S+)→(\S+)` (ou remover `normalizarEstado`) → a grafia `Preparado→Em execução` deixa de virar `em_execucao` e o teste "aceita as duas grafias" cai.

**Steps**

- [ ] **T9.1 — Teste vermelho.** Crie `plugins/gabarito-mestre/gates/test/cartao-sessao.test.mjs`:

```js
/**
 * Testes do ORQ-3 — cartão de sessão.
 *
 * O cartão é a camada 1 de contexto: ≤ 40 linhas que o orquestrador lê antes de despachar.
 * Ele NUNCA inventa — PBI só quando a branch casa idPadrao, Epic só do cache/arquivo, o resto
 * marcado (b). Sem onboarding é UMA linha e exit 0. Cache do doctor vale 24 h.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  omitir a linha `PBI:`
 *  M2  uma linha por envelhecido (cartão passa de 40 linhas)
 *  M3  ignorar o TTL de 24 h do cache do doctor
 *  M4  inferirPbi case-insensitive (`feat/pbi-12-x` vira PBI)
 *  M5  ignorar envelhecimentoDias
 *  M6  fail-closed sem config (exit ≠ 0 ou mais de uma linha)
 *  M7a ler o estado do Epic sem a linha MOVIMENTO (fixture sem MOVIMENTO deixaria de mostrar `estado`)
 *  M7b regex de MOVIMENTO estrito `(\S+)→(\S+)` ou sem normalizarEstado (`Preparado→Em execução` deixa de virar em_execucao)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  montarCartao, inferirPbi, coletar, lerLedger, lerFrontmatter, normalizarEstado, MAX_LINHAS, LINHA_SEM_ONBOARDING, DEFAULTS,
} from '../scripts/cartao-sessao.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'cartao-sessao.mjs');

/**
 * "Plugin real" montado em tmpdir: `.claude-plugin/plugin.json` + `gates/scripts/` com cópias do doctor e do
 * versionamento-check de `here/../scripts`. NÃO usar `resolve(here, '..', '..')`: na cópia instalada em
 * `tools/gabarito-gates/` essa raiz não é o plugin (não tem `.claude-plugin/`) e `npm test` quebraria lá.
 */
let PLUGIN_REAL;
function montarPluginReal() {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-real-'));
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'gabarito-mestre', version: '1.1.0' }));
  mkdirSync(join(dir, 'gates', 'scripts'), { recursive: true });
  for (const f of ['harness-doctor.mjs', 'versionamento-check.mjs']) copyFileSync(join(here, '..', 'scripts', f), join(dir, 'gates', 'scripts', f));
  return dir;
}

// Medidas injetadas: o cartão não deve depender de `ps`/`vm_stat` da máquina de teste.
before(() => {
  Object.assign(process.env, { GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '1', GABARITO_CAP_MEM_MB: '8192', GABARITO_CAP_DISCO_GB: '50', GABARITO_CAP_PESADOS: '0' });
  delete process.env.GABARITO_PARALELISMO;
  PLUGIN_REAL = montarPluginReal();
});

const AGORA = '2026-09-24T12:00:00Z';
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cartao-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const CONFIG = (extra = {}) =>
  JSON.stringify({
    fluxo: { ferramenta: 'arquivos', resolvidoEm: '2026-09-20', idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3, iniciativa: { id: 'INI-1' }, ...(extra.fluxo ?? {}) },
    versionamento: { resolvidoEm: '2026-09-20' },
    orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: '2026-09-01', validadeDias: 90 }, paralelismo: { simultaneos: 2, teto: 4 }, ...(extra.orquestracao ?? {}) },
  });
/** Repo git real em `branch`, com config onboarded. */
function repoGit(arquivos = {}, branch = 'feat/PBI-123-x') {
  const dir = repo({ 'harness.config.json': CONFIG(), ...arquivos });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
  if (branch !== 'main') git(dir, 'checkout', '-q', '-b', branch);
  return dir;
}
/** Plugin falso: só o plugin.json — sem doctor, o cartão marca "indisponível" e o teste fica rápido. */
const pluginFalso = (versao = '1.1.0') => repo({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'gabarito-mestre', version: versao }) });
const cache = (obj) => ({ '.harness/fluxo-cache.json': JSON.stringify(obj) });
const CACHE_123 = cache({ 'PBI-123': { epic: 'EPIC-7', iniciativa: 'INI-1', titulo: 'x', em: '2026-09-20' } });
const LEDGER_123 = ['# Ledger PBI-123', '', '## LER PRIMEIRO', 'contexto', '', 'MOVIMENTO FL2 EPIC-7 preparado→em_execucao 2026-09-21', 'DISPATCH Task 1 slots=2 worktree wt/PBI-123-1'].join('\n');
const opts = (o = {}) => ({ agora: AGORA, installedPlugins: '/nao/existe.json', ...o });
const linha = (linhas, prefixo) => linhas.find((l) => l.startsWith(prefixo));

describe('inferirPbi (Review Focus 5)', () => {
  const cfg = { fluxo: { idPadrao: '^[A-Z]+-\\d+$' }, versionamento: { tiposComEscopoDePbi: ['feat', 'fix', 'enabler'] } };
  test('feat/PBI-123-x → PBI-123; enabler/GM-2-gates → GM-2; feat/PBI-12 → PBI-12', () => {
    assert.deepEqual(inferirPbi('feat/PBI-123-x', cfg), { pbi: 'PBI-123', n: null });
    assert.deepEqual(inferirPbi('enabler/GM-2-gates', cfg), { pbi: 'GM-2', n: null });
    assert.deepEqual(inferirPbi('feat/PBI-12', cfg), { pbi: 'PBI-12', n: null });
  });
  test('wt/PBI-7-2 → PBI-7 com índice 2', () => {
    assert.deepEqual(inferirPbi('wt/PBI-7-2', cfg), { pbi: 'PBI-7', n: 2 });
    assert.deepEqual(inferirPbi('wt/PBI-12-1', cfg), { pbi: 'PBI-12', n: 1 });
  });
  test('sem PBI: main, chore/GM-3-x (tipo livre), feat/pbi-12-x (minúsculas), wt/pbi-7-2, hotfix/PBI-1, vazio', () => {
    for (const b of ['main', 'master', 'chore/GM-3-x', 'feat/pbi-12-x', 'wt/pbi-7-2', 'hotfix/PBI-1', 'feat/x', '', null]) assert.equal(inferirPbi(b, cfg), null, String(b));
  });
  test('idPadrao da config manda: com ^GM-\\d+$, feat/PBI-1-x não infere', () => {
    assert.equal(inferirPbi('feat/PBI-1-x', { ...cfg, fluxo: { idPadrao: '^GM-\\d+$' } }), null);
  });
  test('sem cfg usa DEFAULTS', () => {
    assert.deepEqual(inferirPbi('fix/PBI-9-y'), { pbi: 'PBI-9', n: null });
    assert.ok(DEFAULTS.versionamento.tiposComEscopoDePbi.includes('fix'));
  });
});

describe('lerLedger e lerFrontmatter', () => {
  test('MOVIMENTO, BLOQUEADA, DISPATCH e LER PRIMEIRO', () => {
    const l = lerLedger(['## LER PRIMEIRO', 'x', 'MOVIMENTO FL2 EPIC-7 preparado→em_execucao 2026-09-21', 'BLOQUEADA 2026-09-23 API fora — dono: gabriel', 'DISPATCH Task 1 slots=2 worktree wt/PBI-1-1', 'DISPATCH Task 2 worktree wt/PBI-1-2'].join('\n'));
    assert.equal(l.linhaLerPrimeiro, 1);
    assert.equal(l.ultimaData, '2026-09-23');
    assert.deepEqual(l.epicEstado, { epic: 'EPIC-7', para: 'em_execucao' });
    assert.equal(l.dispatches, 2);
    assert.deepEqual(l.avisos, ['1 dispatch sem medição (slots=)']);
  });
  test('MOVIMENTO aceita as duas grafias e normaliza para a chave (M7): "Em execução" → em_execucao; "Em validação " → em_validacao', () => {
    const coluna = lerLedger('MOVIMENTO FL2 EPIC-7 Preparado→Em execução 2026-09-21\n');
    assert.deepEqual(coluna.epicEstado, { epic: 'EPIC-7', para: 'em_execucao' });
    assert.equal(coluna.ultimaData, '2026-09-21');
    const chave = lerLedger('MOVIMENTO FL2 EPIC-7 em_execucao→em_validacao 2026-09-22\n');
    assert.deepEqual(chave.epicEstado, { epic: 'EPIC-7', para: 'em_validacao' });
    assert.deepEqual(lerLedger('MOVIMENTO FL2 EPIC-7 Em execução→Em validação  2026-09-23  \n').epicEstado, { epic: 'EPIC-7', para: 'em_validacao' });
    assert.equal(lerLedger('MOVIMENTO FL2 EPIC-7 preparado→em_execucao\n').epicEstado, null, 'sem data não é MOVIMENTO válido');
    assert.equal(normalizarEstado(' Em execução '), 'em_execucao');
    assert.equal(normalizarEstado('Concluído'), 'concluido', 'diacríticos caem: nome de coluna vira chave de fluxo.status.FL2');
    assert.deepEqual(lerLedger('MOVIMENTO FL2 EPIC-7 Em validação→Concluído 2026-09-24\n').epicEstado, { epic: 'EPIC-7', para: 'concluido' });
  });
  test('BLOQUEADA sem dono gera aviso (PAR-5); sem linhas datadas ultimaData é null', () => {
    const l = lerLedger('BLOQUEADA 2026-09-23 esperando review\n');
    assert.match(l.avisos[0], /BLOQUEADA sem dono \(l\.1\)/);
    assert.equal(lerLedger('# nada\n').ultimaData, null);
  });
  test('frontmatter YAML simples: epic e iniciativa', () => {
    assert.deepEqual(lerFrontmatter('---\nid: PBI-5\nepic: EPIC-2\niniciativa: "INI-1"\n---\n# corpo'), { id: 'PBI-5', epic: 'EPIC-2', iniciativa: 'INI-1' });
    assert.deepEqual(lerFrontmatter('# sem frontmatter'), {});
  });
});

describe('montarCartao — formato fixo e ≤ 40 linhas', () => {
  const ctxBase = () => ({
    agora: Date.parse(AGORA),
    semOnboarding: false,
    config: JSON.parse(CONFIG()),
    branch: 'feat/PBI-123-x', sha: 'abc1234',
    pbi: 'PBI-123', n: null, epic: 'EPIC-7', iniciativa: 'INI-1', fonteVinculo: 'cache 2026-09-20',
    epicEstado: { epic: 'EPIC-7', para: 'em_execucao' }, avisosLedger: [],
    emVoo: 2, worktrees: 1, capacidade: { slots: 2, motivo: 'simultaneos', medidas: {} },
    doctor: { nivel: 1, declarado: 1, em: '2026-09-24T10:00:00Z', fonte: 'cache 2 h' },
    envelhecidos: [{ pbi: 'PBI-9', dias: 4 }],
    ledger: { caminho: 'docs/ledgers/PBI-123.md', linhaLerPrimeiro: 3 },
    versoes: { instalada: '1.1.0', plugin: '1.1.0' },
    superpowers: 'presente (c)',
  });
  test('as 11 linhas do contrato, na ordem', () => {
    const L = montarCartao(ctxBase());
    assert.ok(L.length <= MAX_LINHAS);
    assert.equal(L[0], 'GABARITO · cartão de sessão · 2026-09-24 12:00');
    assert.equal(L[1], 'Modelo: mais-potente · alias fable · resolvido 2026-09-01 (66 d restantes)');
    assert.equal(L[2], 'Branch: feat/PBI-123-x @ abc1234');
    assert.equal(L[3], 'PBI: PBI-123 · Epic: EPIC-7 · estado em_execucao · Iniciativa: INI-1 (fonte: cache 2026-09-20)');
    assert.equal(L[4], 'Em voo: 2 PBI · worktrees vivos: 1 · slots: 2 (simultaneos)');
    assert.equal(L[5], 'Doctor: nível 1 medido · declarado 1 (cache 2 h)');
    assert.equal(L[6], 'Envelhecidos: PBI-9 4d');
    assert.equal(L[7], 'Ledger: docs/ledgers/PBI-123.md — LER PRIMEIRO l.3');
    assert.equal(L[8], 'Harness: instalado 1.1.0 · plugin 1.1.0');
    assert.equal(L[9], 'Plugins: superpowers presente (c)');
    assert.equal(L.at(-1), 'R21: despache, não implemente. Velocidade nunca compra concorrência.');
  });
  test('modelo vencido → "VENCIDO — revalide com gabarito-instalar"; sem resolvidoEm → (b)', () => {
    const c = ctxBase();
    c.config.orquestracao.modelo.resolvidoEm = '2026-06-01';
    assert.match(linha(montarCartao(c), 'Modelo:'), /VENCIDO — revalide com gabarito-instalar/);
    c.config.orquestracao.modelo.resolvidoEm = '';
    assert.match(linha(montarCartao(c), 'Modelo:'), /\(b\) não resolvido/);
  });
  test('sem PBI → "PBI: (b) não inferido"; PBI sem Epic → "--vincular"; worktree mostra o índice', () => {
    const semPbi = { ...ctxBase(), pbi: null, epic: null, ledger: null };
    assert.equal(linha(montarCartao(semPbi), 'PBI:'), 'PBI: (b) não inferido — branch fora de branchPadrao/branchWorktree');
    assert.equal(linha(montarCartao(semPbi), 'Ledger:'), 'Ledger: sem ledger');
    const semEpic = { ...ctxBase(), epic: null, iniciativa: null, fonteVinculo: '(b) não resolvido — gabarito-instalar --vincular PBI-123', epicEstado: null };
    assert.equal(linha(montarCartao(semEpic), 'PBI:'), 'PBI: PBI-123 · Epic: (b) não resolvido — gabarito-instalar --vincular PBI-123');
    assert.match(linha(montarCartao({ ...ctxBase(), n: 2 }), 'PBI:'), /^PBI: PBI-123 \(worktree 2\) · Epic: EPIC-7/);
  });
  test('sem estado de Epic (ledger sem MOVIMENTO) a linha não traz "estado"', () => {
    assert.doesNotMatch(linha(montarCartao({ ...ctxBase(), epicEstado: null }), 'PBI:'), /estado/);
  });
  test('versões diferentes → "rode instalar.sh --atualizar"; doctor indisponível; envelhecidos vazio → "—"', () => {
    const c = { ...ctxBase(), versoes: { instalada: '1.0.0', plugin: '1.1.0' }, doctor: { nivel: null, declarado: null, em: null, fonte: 'indisponível' }, envelhecidos: [] };
    const L = montarCartao(c);
    assert.equal(linha(L, 'Harness:'), 'Harness: instalado 1.0.0 · plugin 1.1.0 · rode instalar.sh --atualizar');
    assert.equal(linha(L, 'Doctor:'), 'Doctor: indisponível');
    assert.equal(linha(L, 'Envelhecidos:'), 'Envelhecidos: —');
  });
  test('60 envelhecidos e 10 avisos continuam em ≤ 40 linhas (uma linha cada, com "+n")', () => {
    const c = { ...ctxBase(), envelhecidos: Array.from({ length: 60 }, (_, i) => ({ pbi: `PBI-${i}`, dias: i + 4 })), avisosLedger: Array.from({ length: 10 }, (_, i) => `aviso ${i}`) };
    const L = montarCartao(c);
    assert.ok(L.length <= MAX_LINHAS, `${L.length} linhas`);
    assert.match(linha(L, 'Envelhecidos:'), / \+52$/);
    assert.match(linha(L, 'Avisos:'), /aviso 0 · aviso 1 · aviso 2/);
  });
  test('sem onboarding → exatamente a linha de fail-open', () => {
    assert.deepEqual(montarCartao({ semOnboarding: true }), [LINHA_SEM_ONBOARDING]);
    assert.match(LINHA_SEM_ONBOARDING, /fail-open declarado, G9/);
  });
});

describe('coletar — repo git real', () => {
  test('branch feat/PBI-123-x + cache → PBI, Epic, Iniciativa, ledger, estado do Epic (ORQ-3 G/W/T)', () => {
    const dir = repoGit({ ...CACHE_123, 'docs/ledgers/PBI-123.md': LEDGER_123 });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.semOnboarding, false);
    assert.equal(ctx.branch, 'feat/PBI-123-x');
    assert.match(ctx.sha, /^[0-9a-f]{7}$/);
    assert.equal(ctx.pbi, 'PBI-123');
    assert.equal(ctx.epic, 'EPIC-7');
    assert.equal(ctx.iniciativa, 'INI-1');
    assert.equal(ctx.fonteVinculo, 'cache 2026-09-20');
    assert.deepEqual(ctx.ledger, { caminho: 'docs/ledgers/PBI-123.md', linhaLerPrimeiro: 3 });
    assert.deepEqual(ctx.epicEstado, { epic: 'EPIC-7', para: 'em_execucao' });
    assert.equal(ctx.emVoo, 1);
    assert.equal(ctx.worktrees, 0);
    assert.equal(ctx.capacidade.slots, 2);
    const L = montarCartao(ctx);
    assert.ok(L.length <= 40);
    assert.match(linha(L, 'PBI:'), /^PBI: PBI-123 · Epic: EPIC-7 · estado em_execucao/);
  });
  test('sessão aberta em subpasta de monorepo resolve a raiz pelo git (Review Focus 2)', () => {
    const dir = repoGit(CACHE_123);
    mkdirSync(join(dir, 'apps', 'api'), { recursive: true });
    const ctx = coletar(join(dir, 'apps', 'api'), pluginFalso(), opts());
    assert.equal(realpathSync(ctx.root), realpathSync(dir));
    assert.equal(ctx.pbi, 'PBI-123');
    assert.equal(ctx.epic, 'EPIC-7');
  });
  test('fixture solta sem .git usa o cwd e não quebra', () => {
    const dir = repo({ 'harness.config.json': CONFIG() });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(realpathSync(ctx.root), realpathSync(dir));
    assert.equal(ctx.branch, '(sem git)');
    assert.equal(ctx.pbi, null);
    assert.equal(ctx.worktrees, null);
    assert.equal(linha(montarCartao(ctx), 'PBI:'), 'PBI: (b) não inferido — branch fora de branchPadrao/branchWorktree');
  });
  test('branches sem PBI: main, chore/GM-3-x, feat/pbi-12-x → "(b) não inferido"; wt/PBI-7-2 → PBI-7 (worktree 2)', () => {
    for (const b of ['main', 'chore/GM-3-x', 'feat/pbi-12-x']) {
      const ctx = coletar(repoGit({}, b), pluginFalso(), opts());
      assert.equal(ctx.pbi, null, b);
      assert.match(linha(montarCartao(ctx), 'PBI:'), /^PBI: \(b\) não inferido/, b);
    }
    const wt = coletar(repoGit(cache({ 'PBI-7': { epic: 'EPIC-1', iniciativa: 'INI-1', titulo: 't', em: '2026-09-23' } }), 'wt/PBI-7-2'), pluginFalso(), opts());
    assert.deepEqual([wt.pbi, wt.n], ['PBI-7', 2]);
    assert.match(linha(montarCartao(wt), 'PBI:'), /^PBI: PBI-7 \(worktree 2\) · Epic: EPIC-1/);
  });
  test('sem cache, ferramenta arquivos: Epic vem do frontmatter de docs/fluxo/pbis/<PBI>.md (fonte: arquivo)', () => {
    const dir = repoGit({ 'docs/fluxo/pbis/PBI-123.md': '---\nid: PBI-123\nepic: EPIC-2\n---\n# PBI' });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.epic, 'EPIC-2');
    assert.equal(ctx.iniciativa, 'INI-1', 'iniciativa padrão da config quando nem o PBI nem o Epic trazem');
    assert.equal(ctx.fonteVinculo, 'arquivo');
  });
  test('ferramenta arquivos: Iniciativa vem de docs/fluxo/epics/<epic>.md antes do fallback da config; frontmatter do PBI ainda sobrepõe (D4)', () => {
    const epicCard = '---\nid: EPIC-2\niniciativa: INI-9\nstatus: Em execução\n---\n# Epic';
    const dir = repoGit({ 'docs/fluxo/pbis/PBI-123.md': '---\nid: PBI-123\nepic: EPIC-2\n---\n# PBI', 'docs/fluxo/epics/EPIC-2.md': epicCard });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.epic, 'EPIC-2');
    assert.equal(ctx.iniciativa, 'INI-9', 'lida do Epic, não do fluxo.iniciativa.id (INI-1)');
    const dirOverride = repoGit({ 'docs/fluxo/pbis/PBI-123.md': '---\nid: PBI-123\nepic: EPIC-2\niniciativa: INI-5\n---\n# PBI', 'docs/fluxo/epics/EPIC-2.md': epicCard });
    assert.equal(coletar(dirOverride, pluginFalso(), opts()).iniciativa, 'INI-5', 'override no PBI vence o Epic');
  });
  test('sem cache e sem arquivo: "(b) não resolvido — gabarito-instalar --vincular PBI-123"', () => {
    const ctx = coletar(repoGit(), pluginFalso(), opts());
    assert.equal(ctx.epic, null);
    assert.equal(linha(montarCartao(ctx), 'PBI:'), 'PBI: PBI-123 · Epic: (b) não resolvido — gabarito-instalar --vincular PBI-123');
  });
  test('envelhecidos (FLX-8): BLOQUEADA há 4 dias lista "PBI-1 4d"; envelhecimentoDias 10 não lista', () => {
    const arquivos = {
      ...cache({ 'PBI-1': { epic: 'E', iniciativa: 'I', titulo: 'a', em: '2026-09-10' }, 'PBI-2': { epic: 'E', iniciativa: 'I', titulo: 'b', em: '2026-09-23' } }),
      'docs/ledgers/PBI-1.md': 'BLOQUEADA 2026-09-20 aguardando API — dono: gabriel\n',
    };
    const ctx = coletar(repoGit(arquivos, 'main'), pluginFalso(), opts());
    assert.deepEqual(ctx.envelhecidos, [{ pbi: 'PBI-1', dias: 4 }]);
    assert.equal(ctx.emVoo, 2);
    assert.equal(linha(montarCartao(ctx), 'Envelhecidos:'), 'Envelhecidos: PBI-1 4d');
    const dir10 = repoGit({ ...arquivos, 'harness.config.json': CONFIG({ fluxo: { envelhecimentoDias: 10 } }) }, 'main');
    assert.deepEqual(coletar(dir10, pluginFalso(), opts()).envelhecidos, []);
  });
  test('PBI em voo sem ledger envelhece pelo `em` do cache', () => {
    const ctx = coletar(repoGit(cache({ 'PBI-3': { epic: 'E', iniciativa: 'I', titulo: 'c', em: '2026-09-01' } }), 'main'), pluginFalso(), opts());
    assert.deepEqual(ctx.envelhecidos, [{ pbi: 'PBI-3', dias: 23 }]);
  });
  test('avisos de ledger do PBI da branch: BLOQUEADA sem dono (PAR-5) e DISPATCH sem slots= (PAR-2)', () => {
    const dir = repoGit({ ...CACHE_123, 'docs/ledgers/PBI-123.md': 'BLOQUEADA 2026-09-23 review reprovado 2x\nDISPATCH Task 1 worktree wt/PBI-123-1\nDISPATCH Task 2 slots=2 worktree wt/PBI-123-2\n' });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.avisosLedger.length, 2);
    const av = linha(montarCartao(ctx), 'Avisos:');
    assert.match(av, /BLOQUEADA sem dono/);
    assert.match(av, /1 dispatch sem medição/);
  });
  test('versões: tools/gabarito-gates 1.0.0 × plugin 1.1.0 → "rode instalar.sh --atualizar"', () => {
    const dir = repoGit({ 'tools/gabarito-gates/package.json': '{"version":"1.0.0"}' });
    const ctx = coletar(dir, pluginFalso('1.1.0'), opts());
    assert.deepEqual(ctx.versoes, { instalada: '1.0.0', plugin: '1.1.0' });
    assert.match(linha(montarCartao(ctx), 'Harness:'), /rode instalar\.sh --atualizar/);
  });
  test('config sem `orquestracao`: cartão diz "Config: defaults (orquestracao ausente)"; com a seção, a linha não existe', () => {
    const semOrq = JSON.stringify({ fluxo: JSON.parse(CONFIG()).fluxo, versionamento: { resolvidoEm: '2026-09-20' } });
    const ctx = coletar(repoGit({ 'harness.config.json': semOrq }), pluginFalso(), opts());
    assert.equal(ctx.orquestracaoAusente, true);
    assert.equal(ctx.capacidade.slots >= 1, true, 'defaults de capacidade continuam valendo');
    assert.equal(linha(montarCartao(ctx), 'Config:'), 'Config: defaults (orquestracao ausente) — gabarito-instalar (fase 4)');
    const com = coletar(repoGit(), pluginFalso(), opts());
    assert.equal(com.orquestracaoAusente, false);
    assert.equal(linha(montarCartao(com), 'Config:'), undefined);
  });
  test('superpowers: presente (c) / ausente (c) / desconhecido, marcado (c) porque vem de arquivo local', () => {
    const com = repo({ 'ip.json': JSON.stringify({ version: 2, plugins: { 'superpowers@claude-plugins-official': [{ scope: 'user' }] } }) });
    const sem = repo({ 'ip.json': JSON.stringify({ version: 2, plugins: { 'outro@x': [] } }) });
    assert.equal(coletar(repoGit(), pluginFalso(), opts({ installedPlugins: join(com, 'ip.json') })).superpowers, 'presente (c)');
    assert.equal(coletar(repoGit(), pluginFalso(), opts({ installedPlugins: join(sem, 'ip.json') })).superpowers, 'ausente (c)');
    assert.equal(coletar(repoGit(), pluginFalso(), opts({ installedPlugins: '/nao/existe.json' })).superpowers, 'desconhecido');
  });
});

describe('coletar — cache do doctor (DOC-2, TTL 24 h)', () => {
  // PLUGIN_REAL é o tmpdir montado no `before` (plugin.json + cópias do doctor e do versionamento-check):
  // o teste passa igual em plugins/gabarito-mestre/gates/ e na cópia instalada em tools/gabarito-gates/.
  const cacheDoctor = (horas) => ({ '.harness/doctor-cache.json': JSON.stringify({ nivel: 1, declarado: 1, em: new Date(Date.now() - horas * 3_600_000).toISOString() }) });
  const optsReais = () => ({ agora: new Date().toISOString(), installedPlugins: '/nao/existe.json' });
  test('o plugin de teste tem doctor e versionamento-check copiados de here/../scripts', () => {
    assert.ok(existsSync(join(PLUGIN_REAL, '.claude-plugin', 'plugin.json')));
    assert.ok(existsSync(join(PLUGIN_REAL, 'gates', 'scripts', 'harness-doctor.mjs')));
    assert.ok(existsSync(join(PLUGIN_REAL, 'gates', 'scripts', 'versionamento-check.mjs')));
  });
  test('cache de 1 h: usado, arquivo intocado, fonte "cache 1 h"', () => {
    const dir = repoGit(cacheDoctor(1));
    const antes = readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8');
    const ctx = coletar(dir, PLUGIN_REAL, optsReais());
    assert.equal(ctx.doctor.nivel, 1);
    assert.equal(ctx.doctor.fonte, 'cache 1 h');
    assert.equal(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'), antes);
  });
  test('cache de 25 h: o doctor do plugin roda com --cache e o arquivo é reescrito (fonte "recalculado agora")', () => {
    const dir = repoGit(cacheDoctor(25));
    const antes = JSON.parse(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'));
    const ctx = coletar(dir, PLUGIN_REAL, optsReais());
    const depois = JSON.parse(readFileSync(join(dir, '.harness/doctor-cache.json'), 'utf8'));
    assert.ok(Date.parse(depois.em) > Date.parse(antes.em), 'em foi renovado');
    assert.equal(ctx.doctor.fonte, 'recalculado agora');
    assert.equal(typeof ctx.doctor.nivel, 'number');
  });
  test('cache ausente: roda o doctor (a cópia em PLUGIN_REAL/gates/scripts) e cria o arquivo', () => {
    const dir = repoGit();
    const ctx = coletar(dir, PLUGIN_REAL, optsReais());
    assert.ok(existsSync(join(dir, '.harness/doctor-cache.json')));
    assert.equal(ctx.doctor.fonte, 'recalculado agora');
  });
  test('cache ausente e plugin sem doctor: "indisponível", sem lançar', () => {
    const ctx = coletar(repoGit(), pluginFalso(), opts());
    assert.deepEqual(ctx.doctor, { nivel: null, declarado: null, em: null, fonte: 'indisponível' });
  });
});

describe('coletar/CLI — config ausente/vazia/inválida/sem fluxo (Review Focus 3)', () => {
  const cli = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GABARITO_INSTALLED_PLUGINS: '/nao/existe.json' } });
  test('config ausente → semOnboarding; CLI imprime UMA linha e sai 0', () => {
    const dir = repo();
    assert.equal(coletar(dir, pluginFalso(), opts()).semOnboarding, true);
    const r = cli(['--root', dir, '--plugin-root', pluginFalso()], dir);
    assert.equal(r.status, 0);
    assert.deepEqual(r.stdout.trimEnd().split('\n'), [LINHA_SEM_ONBOARDING]);
  });
  test('config vazia, sem fluxo, ou fluxo sem resolvidoEm → uma linha', () => {
    for (const c of ['', '{}', '{"fluxo":{"ferramenta":"arquivos"}}', '{"versionamento":{"resolvidoEm":"2026-09-20"}}']) {
      const dir = repo({ 'harness.config.json': c });
      const r = cli(['--root', dir, '--plugin-root', pluginFalso()], dir);
      assert.equal(r.status, 0, c);
      assert.equal(r.stdout.trimEnd(), LINHA_SEM_ONBOARDING, c);
    }
  });
  test('config inválida → uma linha, stderr com fail-open, exit 0, sem stack trace', () => {
    const dir = repo({ 'harness.config.json': '{"fluxo": ' });
    const ctx = coletar(dir, pluginFalso(), opts());
    assert.equal(ctx.semOnboarding, true);
    assert.equal(ctx.configInvalido, true);
    const r = cli(['--root', dir, '--plugin-root', pluginFalso()], dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trimEnd(), LINHA_SEM_ONBOARDING);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('--json devolve { linhas, ctx } e --agora fixa o relógio', () => {
    const dir = repoGit({ ...CACHE_123 });
    const r = cli(['--root', dir, '--plugin-root', pluginFalso(), '--json', '--agora', AGORA], dir);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.linhas[0], 'GABARITO · cartão de sessão · 2026-09-24 12:00');
    assert.equal(j.ctx.pbi, 'PBI-123');
    assert.ok(j.linhas.length <= 40);
  });
  test('sem --root, a partir de subpasta: raiz pelo git; texto do cartão com PBI', () => {
    const dir = repoGit({ ...CACHE_123 });
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    const r = cli(['--plugin-root', pluginFalso(), '--agora', AGORA], join(dir, 'apps', 'web'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^PBI: PBI-123 · Epic: EPIC-7/m);
  });
});
```

- [ ] **T9.2 — Ver VERMELHO:** `node --test test/cartao-sessao.test.mjs` — `ERR_MODULE_NOT_FOUND`. Commit: `test(GM-2): cartão de sessão — ≤ 40 linhas, PBI só por idPadrao, cache 24 h, fail-open`.

- [ ] **T9.3 — Implementação.** Crie `plugins/gabarito-mestre/gates/scripts/cartao-sessao.mjs`:

```js
#!/usr/bin/env node
/**
 * ORQ-3 — cartão de sessão.
 *
 * Camada 1 de contexto: o que o orquestrador precisa saber ao abrir a sessão, em ≤ 40 linhas —
 * modelo resolvido e validade, branch/PBI/Epic/Iniciativa (cache offline ORQ-6 ou arquivo),
 * PBIs em voo, worktrees vivos, slots medidos (PAR-1), nível do doctor em cache (DOC-2, 24 h),
 * PBIs envelhecidos (FLX-8), ponteiro LER PRIMEIRO do ledger, versão instalada × plugin e
 * presença do superpowers (c). NUNCA inventa: PBI só quando a branch casa idPadrao; o resto
 * vem marcado (b). Sem `fluxo.resolvidoEm`: uma linha, fail-open declarado (G9). Sempre sai 0 —
 * cartão que derruba a sessão é pior que cartão ausente.
 *
 * USO
 *   node cartao-sessao.mjs                                                       # texto do cartão
 *   node cartao-sessao.mjs --root <dir> --plugin-root <dir> --json --agora <ISO> # teste
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { medir, calcularSlots } from './capacidade.mjs';

export const MAX_LINHAS = 40;
export const CACHE_DOCTOR_H = 24;
export const DOCTOR_TIMEOUT_MS = 20_000; // o hook tem 30 s
export const LINHA_SEM_ONBOARDING = 'GABARITO: harness sem onboarding — rode gabarito-instalar (fail-open declarado, G9)';
export const LINHA_INDISPONIVEL = 'GABARITO: cartão indisponível — fail-open declarado (G9)';
export const DEFAULTS = {
  fluxo: { ferramenta: 'arquivos', idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3 },
  versionamento: { tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'] },
  orquestracao: { modelo: { politica: 'mais-potente', alias: '', resolvidoEm: '', validadeDias: 90 } },
};

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** null = ausente · undefined = JSON inválido (quem chama decide o que fazer com cada um). */
const lerJson = (f) => {
  if (!existsSync(f)) return null;
  try {
    const t = readFileSync(f, 'utf8');
    return t.trim() === '' ? {} : JSON.parse(t);
  } catch {
    return undefined;
  }
};
const dias = (agora, iso) => {
  const d = (agora - Date.parse(iso)) / 86_400_000;
  return Number.isNaN(d) ? null : d;
};

export function resolverRaiz(cwd = process.cwd()) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd) || cwd;
  } catch {
    return cwd;
  }
}

// ────────────────────────────────────────────────────────────── puras

export function inferirPbi(branch, cfg = DEFAULTS) {
  const idRe = new RegExp(cfg?.fluxo?.idPadrao ?? DEFAULTS.fluxo.idPadrao);
  const tipos = cfg?.versionamento?.tiposComEscopoDePbi ?? DEFAULTS.versionamento.tiposComEscopoDePbi;
  const b = String(branch ?? '');
  const wt = /^wt\/(.+)-(\d+)$/.exec(b);
  if (wt && idRe.test(wt[1])) return { pbi: wt[1], n: Number(wt[2]) };
  const m = /^([a-z]+)\/([A-Za-z]+-\d+)(?:-|$)/.exec(b);
  if (m && tipos.includes(m[1]) && idRe.test(m[2])) return { pbi: m[2], n: null };
  return null;
}

/** Frontmatter YAML de uma chave por linha (`chave: valor`), sem aninhamento — é o que os templates de card usam. */
export function lerFrontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(texto ?? ''));
  const out = {};
  if (!m) return out;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(l);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Estado de MOVIMENTO → chave de `fluxo.status.FL2`. A grafia canônica (plano-mestre, "Ledger") é a chave
 * (`em_execucao`); um ledger escrito à mão com o nome de coluna (`Em execução`, `Concluído`) é normalizado, não rejeitado:
 * trim + minúsculas + diacríticos removidos (NFD, faixa U+0300–U+036F) + espaço→`_`. `Concluído` → `concluido`.
 */
export function normalizarEstado(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

/** Linhas que os scripts leem no ledger (contrato): MOVIMENTO · BLOQUEADA · DISPATCH · ## LER PRIMEIRO. */
export function lerLedger(texto) {
  const datas = [];
  const avisos = [];
  let epicEstado = null;
  let dispatches = 0;
  let semSlots = 0;
  let linhaLerPrimeiro = null;
  String(texto ?? '').split(/\r?\n/).forEach((l, i) => {
    let m;
    // Tolerante: `<de>`/`<para>` podem ter espaço (`Em execução`); normalizarEstado devolve a chave.
    if ((m = /^MOVIMENTO FL2 (\S+) (.+?)→(.+?) (\d{4}-\d{2}-\d{2})\s*$/.exec(l))) {
      datas.push(m[4]);
      epicEstado = { epic: m[1], para: normalizarEstado(m[3]) };
    } else if ((m = /^BLOQUEADA (\d{4}-\d{2}-\d{2})(.*)$/.exec(l))) {
      datas.push(m[1]);
      if (!/dono:\s*\S/.test(m[2])) avisos.push(`BLOQUEADA sem dono (l.${i + 1})`);
    } else if ((m = /^DISPATCH Task \S+(.*)$/.exec(l))) {
      dispatches += 1;
      if (!/\bslots=\d+/.test(m[1])) semSlots += 1;
    } else if (/^## LER PRIMEIRO/.test(l) && linhaLerPrimeiro === null) {
      linhaLerPrimeiro = i + 1;
    }
  });
  if (semSlots) avisos.push(`${semSlots} dispatch sem medição (slots=)`);
  return { ultimaData: datas.sort().at(-1) ?? null, epicEstado, avisos, dispatches, linhaLerPrimeiro };
}

// ────────────────────────────────────────────────────────────── coleta

function contarWorktrees(root) {
  try {
    return Math.max(0, git(['worktree', 'list', '--porcelain'], root).split('\n').filter((l) => l.startsWith('worktree ')).length - 1);
  } catch {
    return null;
  }
}

function estadoSuperpowers(arquivo) {
  const j = lerJson(arquivo);
  if (!j || typeof j !== 'object' || !j.plugins || typeof j.plugins !== 'object') return 'desconhecido';
  return Object.keys(j.plugins).some((k) => k.startsWith('superpowers@')) ? 'presente (c)' : 'ausente (c)';
}

/** Cache do doctor (DOC-2). Ausente ou > 24 h → roda o doctor DO PLUGIN com --cache, dentro do timeout do hook. */
function doctorEmCache(root, pluginRoot, agora) {
  const f = join(root, '.harness', 'doctor-cache.json');
  const ler = () => {
    const c = lerJson(f);
    return c && typeof c === 'object' && c.em ? c : null;
  };
  let c = ler();
  const idadeH = c ? (agora - Date.parse(c.em)) / 3_600_000 : null;
  if (c && idadeH !== null && idadeH >= 0 && idadeH <= CACHE_DOCTOR_H) {
    return { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: `cache ${Math.round(idadeH)} h` };
  }
  const script = join(pluginRoot, 'gates', 'scripts', 'harness-doctor.mjs');
  const indisponivel = { nivel: null, declarado: null, em: null, fonte: 'indisponível' };
  if (!existsSync(script)) return c ? { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: 'cache vencido (doctor do plugin não encontrado)' } : indisponivel;
  try {
    execFileSync(process.execPath, [script, '--json', '--cache'], { cwd: root, stdio: 'ignore', timeout: DOCTOR_TIMEOUT_MS });
  } catch {
    /* exit 1 = repo mente; o cache foi gravado antes do exit. Timeout ou crash: cai no `ler()` abaixo. */
  }
  c = ler();
  return c ? { nivel: c.nivel ?? null, declarado: c.declarado ?? null, em: c.em, fonte: 'recalculado agora' } : indisponivel;
}

export function coletar(cwd, pluginRoot, opts = {}) {
  const agora = opts.agora ? Date.parse(opts.agora) : Date.now();
  const root = resolverRaiz(cwd);
  const raw = lerJson(join(root, 'harness.config.json'));
  const base = { agora, root, semOnboarding: false, configInvalido: raw === undefined };
  const fluxoOk = raw && typeof raw === 'object' && raw.fluxo && typeof raw.fluxo === 'object' && typeof raw.fluxo.resolvidoEm === 'string' && raw.fluxo.resolvidoEm;
  if (!fluxoOk) return { ...base, semOnboarding: true };

  const config = {
    fluxo: { ...DEFAULTS.fluxo, ...raw.fluxo },
    versionamento: { ...DEFAULTS.versionamento, ...(raw.versionamento ?? {}) },
    orquestracao: { ...DEFAULTS.orquestracao, ...(raw.orquestracao ?? {}), modelo: { ...DEFAULTS.orquestracao.modelo, ...(raw.orquestracao?.modelo ?? {}) } },
  };
  // O cartão diz quando está operando com defaults (mesma frase que capacidade.mjs põe no stderr).
  const orquestracaoAusente = !(raw.orquestracao && typeof raw.orquestracao === 'object');
  const idRe = new RegExp(config.fluxo.idPadrao);

  let branch;
  let sha;
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    sha = git(['rev-parse', '--short=7', 'HEAD'], root);
  } catch {
    branch = '(sem git)';
    sha = '-------';
  }
  const inf = inferirPbi(branch, config);

  const cacheLido = lerJson(join(root, '.harness', 'fluxo-cache.json'));
  const cache = cacheLido && typeof cacheLido === 'object' ? cacheLido : {};
  let epic = null;
  let iniciativa = null;
  let fonteVinculo = null;
  if (inf) {
    const c = cache[inf.pbi];
    if (c && c.epic) {
      epic = c.epic;
      iniciativa = c.iniciativa ?? config.fluxo.iniciativa?.id ?? null;
      fonteVinculo = `cache ${c.em ?? '?'}`;
    } else if (config.fluxo.ferramenta === 'arquivos') {
      const card = join(root, 'docs', 'fluxo', 'pbis', `${inf.pbi}.md`);
      if (existsSync(card)) {
        const fm = lerFrontmatter(readFileSync(card, 'utf8'));
        if (fm.epic) {
          epic = fm.epic;
          // Iniciativa: frontmatter do PBI (override, D4) → `iniciativa:` do Epic em docs/fluxo/epics/<epic>.md → config.
          let doEpic = null;
          const cardEpic = join(root, 'docs', 'fluxo', 'epics', `${fm.epic}.md`);
          if (existsSync(cardEpic)) doEpic = lerFrontmatter(readFileSync(cardEpic, 'utf8')).iniciativa || null;
          iniciativa = fm.iniciativa ?? doEpic ?? config.fluxo.iniciativa?.id ?? null;
          fonteVinculo = 'arquivo';
        }
      }
    }
    if (!epic) fonteVinculo = `(b) não resolvido — gabarito-instalar --vincular ${inf.pbi}`;
  }

  const lerLedgerDe = (pbi) => {
    const rel = join(config.fluxo.ledgerDir, `${pbi}.md`);
    const f = join(root, rel);
    return existsSync(f) ? { caminho: rel, ...lerLedger(readFileSync(f, 'utf8')) } : null;
  };
  const ledger = inf ? lerLedgerDe(inf.pbi) : null;

  const emVoo = Object.keys(cache).filter((k) => idRe.test(k));
  const envelhecidos = [];
  for (const pbi of emVoo) {
    const l = lerLedgerDe(pbi);
    const ref = l?.ultimaData ?? cache[pbi]?.em;
    const d = ref ? dias(agora, ref) : null;
    if (d !== null && d > Number(config.fluxo.envelhecimentoDias)) envelhecidos.push({ pbi, dias: Math.floor(d) });
  }

  const medidas = medir(process.env, root);
  const capacidade = calcularSlots(raw.orquestracao?.paralelismo, medidas, process.env);
  const doctor = doctorEmCache(root, pluginRoot, agora);
  const instalada = lerJson(join(root, 'tools', 'gabarito-gates', 'package.json'))?.version ?? null;
  const plugin = lerJson(join(pluginRoot, '.claude-plugin', 'plugin.json'))?.version ?? null;
  const installed = opts.installedPlugins ?? process.env.GABARITO_INSTALLED_PLUGINS ?? join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

  return {
    ...base,
    config,
    orquestracaoAusente,
    branch,
    sha,
    pbi: inf?.pbi ?? null,
    n: inf?.n ?? null,
    epic,
    iniciativa,
    fonteVinculo,
    epicEstado: ledger?.epicEstado ?? null,
    avisosLedger: ledger?.avisos ?? [],
    emVoo: emVoo.length,
    worktrees: contarWorktrees(root),
    capacidade,
    doctor,
    envelhecidos,
    ledger: ledger ? { caminho: ledger.caminho, linhaLerPrimeiro: ledger.linhaLerPrimeiro } : null,
    versoes: { instalada, plugin },
    superpowers: estadoSuperpowers(installed),
  };
}

// ────────────────────────────────────────────────────────────── cartão

export function montarCartao(ctx) {
  if (!ctx || ctx.semOnboarding) return [LINHA_SEM_ONBOARDING];
  const L = [];
  L.push(`GABARITO · cartão de sessão · ${new Date(ctx.agora).toISOString().slice(0, 16).replace('T', ' ')}`);

  const m = ctx.config.orquestracao.modelo;
  if (m.resolvidoEm) {
    const d = dias(ctx.agora, m.resolvidoEm);
    const restantes = d === null ? null : Math.floor(Number(m.validadeDias ?? 90) - d);
    const estado = restantes !== null && restantes >= 0 ? `${restantes} d restantes` : 'VENCIDO — revalide com gabarito-instalar';
    L.push(`Modelo: ${m.politica} · alias ${m.alias || '?'} · resolvido ${m.resolvidoEm} (${estado})`);
  } else {
    L.push('Modelo: (b) não resolvido — gabarito-instalar (fase 4)');
  }

  L.push(`Branch: ${ctx.branch} @ ${ctx.sha}`);

  if (ctx.pbi) {
    const idx = ctx.n !== null && ctx.n !== undefined ? ` (worktree ${ctx.n})` : '';
    if (ctx.epic) {
      const estado = ctx.epicEstado ? ` · estado ${ctx.epicEstado.para}` : '';
      L.push(`PBI: ${ctx.pbi}${idx} · Epic: ${ctx.epic}${estado} · Iniciativa: ${ctx.iniciativa ?? '(b) não resolvida'} (fonte: ${ctx.fonteVinculo})`);
    } else {
      L.push(`PBI: ${ctx.pbi}${idx} · Epic: ${ctx.fonteVinculo}`);
    }
  } else {
    L.push('PBI: (b) não inferido — branch fora de branchPadrao/branchWorktree');
  }

  L.push(`Em voo: ${ctx.emVoo} PBI · worktrees vivos: ${ctx.worktrees ?? '?'} · slots: ${ctx.capacidade.slots} (${ctx.capacidade.motivo})`);

  const dr = ctx.doctor;
  L.push(dr.nivel === null || dr.nivel === undefined ? `Doctor: ${dr.fonte}` : `Doctor: nível ${dr.nivel} medido · declarado ${dr.declarado ?? '(não declarado)'} (${dr.fonte})`);

  const env = ctx.envelhecidos ?? [];
  L.push(env.length ? `Envelhecidos: ${env.slice(0, 8).map((e) => `${e.pbi} ${e.dias}d`).join(', ')}${env.length > 8 ? ` +${env.length - 8}` : ''}` : 'Envelhecidos: —');

  L.push(ctx.ledger ? `Ledger: ${ctx.ledger.caminho}${ctx.ledger.linhaLerPrimeiro ? ` — LER PRIMEIRO l.${ctx.ledger.linhaLerPrimeiro}` : ''}` : 'Ledger: sem ledger');

  const { instalada, plugin } = ctx.versoes;
  L.push(`Harness: instalado ${instalada ?? '?'} · plugin ${plugin ?? '?'}${instalada && plugin && instalada !== plugin ? ' · rode instalar.sh --atualizar' : ''}`);
  L.push(`Plugins: superpowers ${ctx.superpowers}`);

  // Sem `orquestracao` na config o cartão não fica mudo: diz que está em defaults (mesma frase de capacidade.mjs).
  if (ctx.orquestracaoAusente) L.push('Config: defaults (orquestracao ausente) — gabarito-instalar (fase 4)');

  if (ctx.avisosLedger?.length) L.push(`Avisos: ${ctx.avisosLedger.slice(0, 3).join(' · ')}${ctx.avisosLedger.length > 3 ? ` +${ctx.avisosLedger.length - 3}` : ''}`);

  L.push('R21: despache, não implemente. Velocidade nunca compra concorrência.');
  return L.slice(0, MAX_LINHAS);
}

function main(argv) {
  const arg = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const pluginRoot = arg('plugin-root') ? resolve(arg('plugin-root')) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let ctx;
  let linhas;
  try {
    ctx = coletar(arg('root') ? resolve(arg('root')) : process.cwd(), pluginRoot, { agora: arg('agora') });
    if (ctx.configInvalido) console.error('[ORQ-3] harness.config.json inválido — cartão mínimo (fail-open declarado (G9))');
    linhas = montarCartao(ctx);
  } catch (e) {
    console.error(`[ORQ-3] cartão indisponível: ${String(e?.message ?? e).split('\n')[0]} (fail-open declarado (G9))`);
    ctx = { erro: true };
    linhas = [LINHA_INDISPONIVEL];
  }
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({ linhas, ctx }, null, 2)}\n`);
  else process.stdout.write(`${linhas.join('\n')}\n`);
  process.exit(0);
}

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
```

- [ ] **T9.4 — Ver VERDE:** `node --test test/cartao-sessao.test.mjs`; depois `npm test`. Os três testes de cache do doctor rodam o doctor real sobre a fixture (≈ 100–300 ms cada) — se passarem de 5 s, anote no ledger.
- [ ] **T9.5 — Medição real (a):** `node scripts/cartao-sessao.mjs --root <um repo seu onboarded ou este>` — conte as linhas (`| wc -l`) e anote no ledger; neste repo (sem onboarding) a saída é a linha única.
- [ ] **T9.6 — Mutação rápida:** troque `idadeH <= CACHE_DOCTOR_H` por `true` — "cache de 25 h" cai. Troque `new RegExp(cfg?.fluxo?.idPadrao …)` por `new RegExp(…, 'i')` — "feat/pbi-12-x" cai. Reverta.
- [ ] **T9.7 — Commit:** `feat(GM-2): cartao-sessao.mjs — cartão ≤ 40 linhas com PBI inferido, cache do doctor e envelhecidos`.

---
## T10 — `instalar.sh --atualizar / --gates-substituir / --codeowners` + `.instalado.json` + `.gitignore` + `instalar.test.sh` (REQ-TIM-2, DOC-2, TIM-1, ADR-TIM-1)

**Files**
- Modificar: `plugins/gabarito-mestre/scripts/instalar.sh` (reescrita completa abaixo — mantém tudo que a 1.0.1 faz)
- Criar: `plugins/gabarito-mestre/scripts/test/instalar.test.sh`
- Não toca `gates/` nem `hooks/` — pode rodar em paralelo com T5–T9.

**Interfaces**
- CLI: `instalar.sh [dir] [--atualizar] [--gates-substituir] [--codeowners] [--help]`. Flags em qualquer posição; `dir` default `$PWD`. `--gates-substituir` sem `--atualizar` → mensagem e **exit 2**. Flag desconhecida → exit 2.
- Sem flag (comportamento 1.0.1 **mais**): grava `tools/gabarito-gates/.instalado.json`, emenda `.gitignore`; roda o doctor ao fim (se `node` existe) — e um doctor que sai 1 **não** derruba o instalador (bug latente do `set -e` na 1.0.1, consertado aqui).
- `--atualizar`: para `reference/*` já existentes no destino (`AGENTS.md`, `docs/harness/*.md`): idêntico → `igual`; diferente → `<destino>.novo` + `diff --stat` (via `git diff --no-index --stat`; sem git, contagem de linhas com `diff`); ausente → cria. Avisa `R19–R21 agora são do harness; regras de projeto passam a R30+`. **Doctor não roda.** Templates (`harness.config.json`, `attest.json`, `gabarito.yml`, `CLAUDE.md`) continuam "mantido" — são do usuário.
- `--gates-substituir` (exige `--atualizar`): para cada arquivo de `gates/`: ausente → cria; idêntico → nada; diferente **e** hash do disco == hash em `.instalado.json` → `cp dst dst.bak; cp src dst` ("substituído"); diferente e hash divergente **ou ausente do manifesto** → `<dst>.novo` ("recusado — editado localmente"). Sem `--gates-substituir`, `--atualizar` só imprime `difere … (use --gates-substituir)`.
- `.instalado.json` = `{ "versao": "<gates/package.json version>", "em": "<ISO>", "arquivos": { "<rel a tools/gabarito-gates/>": "<sha256 hex>" } }`. Regra: entrada gravada **só** para arquivos que o instalador escreveu (nesta execução: hash novo; em execuções anteriores: hash antigo mantido); arquivo "mantido" que nunca passou pelo instalador **não** entra (e portanto é tratado como editado pelo `--gates-substituir`). Hash via `shasum -a 256` (fallback `sha256sum`). Escrita por tmp + `mv`.
- `.gitignore`: garante as 4 linhas exatas `.harness/doctor-cache.json`, `.harness/fluxo-cache.json`, `*.novo`, `*.bak` (`grep -qxF`), cria o arquivo se não existe, nunca remove, respeita arquivo sem `\n` final.
- `--codeowners`: cria `.github/CODEOWNERS` (se ausente) só com o esqueleto comentado "Áreas e donos (TIM-1)"; quem preenche é a fase 2 do onboarding (agente). Existente → mantido.
- bash 3.2: sem `mapfile`, sem `declare -A`, sem `${var,,}`; `$'\n'` e `local` são bash ≥ 2 e valem.

**Mutações prescritas (cabeçalho do `instalar.test.sh`):** M1 sobrescrever `AGENTS.md` em `--atualizar` · M2 ignorar o hash em `--gates-substituir` (substituir o editado) · M3 duplicar linha no `.gitignore` na segunda execução · M4 rodar o doctor em `--atualizar` · M5 aceitar `--gates-substituir` sem `--atualizar` · M6 gravar no manifesto o hash de arquivo "mantido" que o instalador não escreveu.

**Steps**

- [ ] **T10.1 — Teste vermelho.** Crie `plugins/gabarito-mestre/scripts/test/instalar.test.sh` (`chmod +x`):

```bash
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
set -eu
AQUI="$(cd "$(dirname "$0")" && pwd)"
INSTALAR="$AQUI/../instalar.sh"
PLUGIN="$(cd "$AQUI/../.." && pwd)"
passou=0; falhou=0
ok()    { passou=$((passou+1)); echo "  ok    $1"; }
falha() { falhou=$((falhou+1)); echo "  FALHA $1" >&2; }
check() { if eval "$2"; then ok "$1"; else falha "$1"; fi; }   # check "<nome>" '<expressão bash>'
sha()   { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
novo_repo() { mktemp -d "${TMPDIR:-/tmp}/instalar-XXXXXX"; }
GATES="tools/gabarito-gates"
MANIF="$GATES/.instalado.json"
hash_no_manifesto() { sed -nE "s|^[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"([0-9a-f]{64})\".*|\1|p" "$1/$MANIF" | head -n1; }

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

echo "── $passou ok, $falhou falha(s)"
[ "$falhou" -eq 0 ]
```

- [ ] **T10.2 — Ver VERMELHO:** `bash plugins/gabarito-mestre/scripts/test/instalar.test.sh` — cenário 1 falha em `.instalado.json existe`, `.gitignore com as 4 linhas`; cenário 4 falha (sem `.novo`, doctor roda); cenário 6 falha (flags aceitas como `dir`). Commit: `test(GM-2): instalar.test.sh — .novo, .instalado.json com hash, .gitignore, flags`.

- [ ] **T10.3 — Implementação.** Substitua `plugins/gabarito-mestre/scripts/instalar.sh` por:

```bash
#!/usr/bin/env bash
# gabarito-mestre · instalar.sh — instala ou atualiza o harness no repositório alvo. bash 3.2 (macOS).
# uso: instalar.sh [dir] [--atualizar] [--gates-substituir] [--codeowners]
#   (sem flag)          instala o que falta. NUNCA sobrescreve nem apaga (R2). Grava
#                       tools/gabarito-gates/.instalado.json (hashes do que ESTE script escreveu) e
#                       emenda o .gitignore. Nível de adoção fica `____`; o doctor mede ao fim.
#   --atualizar         reference/* já existentes → <destino>.novo + diff --stat (nunca sobrescreve);
#                       avisa R19→R30+. O doctor NÃO roda (os .novo ainda serão aplicados à mão).
#   --gates-substituir  (exige --atualizar) tools/gabarito-gates/ arquivo a arquivo, com .bak; RECUSA
#                       (→ .novo) o que foi editado localmente: hash ≠ .instalado.json. Única exceção
#                       ao "nunca sobrescreve" (ADR-TIM-1).
#   --codeowners        cria .github/CODEOWNERS (se ausente) com o esqueleto "Áreas e donos" (TIM-1).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEST=""; ATUALIZAR=0; GATES_SUBSTITUIR=0; CODEOWNERS=0
for a in "$@"; do
  case "$a" in
    --atualizar) ATUALIZAR=1 ;;
    --gates-substituir) GATES_SUBSTITUIR=1 ;;
    --codeowners) CODEOWNERS=1 ;;
    --help|-h) sed -n '2,13p' "$0"; exit 0 ;;
    --*) echo "instalar.sh: flag desconhecida: $a (use --atualizar, --gates-substituir, --codeowners)" >&2; exit 2 ;;
    *) DEST="$a" ;;
  esac
done
if [ "$GATES_SUBSTITUIR" -eq 1 ] && [ "$ATUALIZAR" -eq 0 ]; then
  echo "instalar.sh: --gates-substituir exige --atualizar (ADR-TIM-1: substituir gates é um passo da atualização)" >&2; exit 2
fi
DEST="${DEST:-$PWD}"; DEST="$(cd "$DEST" && pwd)"
GATES_DIR="tools/gabarito-gates"
MANIFESTO="$DEST/$GATES_DIR/.instalado.json"
criados=0; mantidos=0; novos=0; iguais=0; substituidos=0; recusados=0
ESCRITOS=""   # relativos a tools/gabarito-gates/, um por linha: o que ESTA execução escreveu

# ── utilitários ────────────────────────────────────────────────────────────────────────────
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
versao_gates() { sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$ROOT/gates/package.json" | head -n1; }
# hash gravado no manifesto para <rel>, ou vazio (ausente do manifesto = nunca passou pelo instalador).
hash_manifesto() {
  [ -f "$MANIFESTO" ] || return 0
  local chave; chave="$(printf '%s' "$1" | sed 's/[.[\*^$]/\\&/g')"
  sed -nE "s|^[[:space:]]*\"$chave\"[[:space:]]*:[[:space:]]*\"([0-9a-f]{64})\".*|\1|p" "$MANIFESTO" | head -n1
}
escrito_nesta_execucao() { printf '%s' "$ESCRITOS" | grep -qxF -- "$1"; }
diff_stat() { # diff_stat <antigo> <novo> — uma linha de resumo, indentada
  if command -v git >/dev/null 2>&1; then
    git diff --no-index --stat -- "$1" "$2" 2>/dev/null | tail -n1 | sed 's/^/           /' || true
  else
    printf '           %s linha(s) diferem\n' "$(diff "$1" "$2" | grep -c '^[<>]' || true)"
  fi
}

# ── instaladores ───────────────────────────────────────────────────────────────────────────
put() { # put <origem-rel-ao-plugin> <destino-rel>  — nunca sobrescreve
  local src="$ROOT/$1" dst="$DEST/$2"
  if [ -e "$dst" ]; then echo "  mantido  $2 (já existia — não sobrescrevo)"; mantidos=$((mantidos+1)); return; fi
  mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; echo "  criado   $2"; criados=$((criados+1))
}
put_ref() { # put_ref <origem> <destino-rel> — referência do harness: --atualizar gera .novo + diff --stat
  local src="$ROOT/$1" dst="$DEST/$2"
  [ -e "$src" ] || return 0
  if [ ! -e "$dst" ]; then put "$1" "$2"; return; fi
  if [ "$ATUALIZAR" -eq 0 ]; then echo "  mantido  $2 (já existia — não sobrescrevo)"; mantidos=$((mantidos+1)); return; fi
  if cmp -s "$src" "$dst"; then echo "  igual    $2"; iguais=$((iguais+1)); rm -f "$dst.novo"; return; fi
  cp "$src" "$dst.novo"; echo "  novo     $2.novo (aplique à mão; $2 intocado)"; diff_stat "$dst" "$dst.novo"; novos=$((novos+1))
}
put_gate() { # put_gate <rel-dentro-de-gates> — ADR-TIM-1
  local rel="$1" src="$ROOT/gates/$1" dst="$DEST/$GATES_DIR/$1" disco gravado
  if [ ! -e "$dst" ]; then put "gates/$rel" "$GATES_DIR/$rel"; ESCRITOS="$ESCRITOS$rel"$'\n'; return; fi
  if cmp -s "$src" "$dst"; then # idêntico: nada a fazer; sem entrada no manifesto continua "nunca passou pelo instalador"
    if [ "$ATUALIZAR" -eq 1 ]; then iguais=$((iguais+1)); else mantidos=$((mantidos+1)); fi
    return
  fi
  if [ "$GATES_SUBSTITUIR" -eq 0 ]; then
    if [ "$ATUALIZAR" -eq 1 ]; then echo "  difere   $GATES_DIR/$rel (use --atualizar --gates-substituir)"; else echo "  mantido  $GATES_DIR/$rel (já existia — não sobrescrevo)"; fi
    mantidos=$((mantidos+1)); return
  fi
  disco="$(sha256 "$dst")"; gravado="$(hash_manifesto "$rel")"
  if [ -n "$gravado" ] && [ "$gravado" = "$disco" ]; then
    cp "$dst" "$dst.bak"; cp "$src" "$dst"; ESCRITOS="$ESCRITOS$rel"$'\n'
    echo "  substituído $GATES_DIR/$rel (.bak guardado)"; substituidos=$((substituidos+1))
  else
    cp "$src" "$dst.novo"
    echo "  recusado $GATES_DIR/$rel — editado localmente (hash ≠ .instalado.json); gravei $rel.novo"; recusados=$((recusados+1))
  fi
}
escrever_manifesto() { # entradas: escritos nesta execução (hash novo) + entradas antigas ainda válidas
  local tmp="$MANIFESTO.tmp" primeiro=1 rel h
  mkdir -p "$(dirname "$MANIFESTO")"
  {
    printf '{\n  "versao": "%s",\n  "em": "%s",\n  "arquivos": {\n' "$(versao_gates)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      if escrito_nesta_execucao "$rel"; then h="$(sha256 "$DEST/$GATES_DIR/$rel")"; else h="$(hash_manifesto "$rel")"; fi
      [ -n "$h" ] || continue
      if [ "$primeiro" -eq 1 ]; then primeiro=0; else printf ',\n'; fi
      printf '    "%s": "%s"' "$rel" "$h"
    done < <(cd "$ROOT/gates" && find . -type f -not -path '*/node_modules/*' -not -name .DS_Store | sed 's|^\./||' | sort)
    printf '\n  }\n}\n'
  } > "$tmp"
  mv "$tmp" "$MANIFESTO"
}
emendar_gitignore() { # garante 4 linhas exatas; nunca remove; respeita arquivo sem \n final
  local gi="$DEST/.gitignore" l add=0
  [ -e "$gi" ] || : > "$gi"
  for l in '.harness/doctor-cache.json' '.harness/fluxo-cache.json' '*.novo' '*.bak'; do
    if ! grep -qxF -- "$l" "$gi"; then
      if [ -s "$gi" ] && [ -n "$(tail -c1 "$gi")" ]; then printf '\n' >> "$gi"; fi
      printf '%s\n' "$l" >> "$gi"; add=$((add+1))
    fi
  done
  if [ "$add" -gt 0 ]; then echo "  emendado .gitignore (+$add linha(s); nada removido)"; else echo "  mantido  .gitignore (já ignora o estado do harness)"; fi
}

# ── execução ───────────────────────────────────────────────────────────────────────────────
if [ "$ATUALIZAR" -eq 1 ]; then echo "gabarito-mestre → atualizando em $DEST"; else echo "gabarito-mestre → instalando em $DEST"; fi
put_ref reference/AGENTS.md         AGENTS.md
put_ref reference/referencia.md     docs/harness/referencia.md
put_ref reference/gates.md          docs/harness/gates.md
put_ref reference/adocao.md         docs/harness/adocao.md
put_ref reference/prompts.md        docs/harness/prompts.md
put_ref reference/fluxo.md          docs/harness/fluxo.md
put templates/harness.config.json harness.config.json
put templates/attest.json       .harness/attest.json
put templates/gabarito.yml      .github/workflows/gabarito.yml
# CLAUDE.md: só a linha de import. Se existir, garante a linha sem apagar nada.
if [ -e "$DEST/CLAUDE.md" ]; then
  if grep -qE '^@AGENTS\.md\s*$' "$DEST/CLAUDE.md"; then echo "  mantido  CLAUDE.md (já importa AGENTS.md)"; mantidos=$((mantidos+1))
  else printf '\n@AGENTS.md\n' >> "$DEST/CLAUDE.md"; echo "  emendado CLAUDE.md (+ linha @AGENTS.md; nada removido)"; criados=$((criados+1)); fi
else put templates/CLAUDE.md CLAUDE.md; fi
# gates → tools/gabarito-gates (arquivo a arquivo)
while IFS= read -r f; do put_gate "${f#"$ROOT/gates/"}"; done < <(find "$ROOT/gates" -type f -not -path '*/node_modules/*' -not -name .DS_Store | sort)
escrever_manifesto
emendar_gitignore
if [ "$CODEOWNERS" -eq 1 ]; then
  if [ -e "$DEST/.github/CODEOWNERS" ]; then echo "  mantido  .github/CODEOWNERS"; mantidos=$((mantidos+1)); else
    mkdir -p "$DEST/.github"
    printf '# Áreas e donos (TIM-1) — preenchido pelo onboarding (gabarito-instalar, fase 2). Uma linha por área:\n# <caminho/>  @<dono>\n' > "$DEST/.github/CODEOWNERS"
    echo "  criado   .github/CODEOWNERS (esqueleto)"; criados=$((criados+1)); fi
fi

echo "── $criados criado(s), $mantidos mantido(s), $iguais igual(is), $novos .novo, $substituidos substituído(s), $recusados recusado(s). Nenhum arquivo apagado ou sobrescrito fora de $GATES_DIR (e lá só com .bak e hash conferido)."
if [ "$ATUALIZAR" -eq 1 ]; then
  echo "── R19–R21 agora são do harness (fluxo · versionamento · orquestração); regras de projeto passam a R30+ — renumere no Apêndice ao aplicar o AGENTS.md.novo."
  echo "── Aplique os .novo à mão (diff acima) e rode o doctor depois: node $GATES_DIR/scripts/harness-doctor.mjs --explain"
  exit 0
fi
echo "── Nível de adoção NÃO foi declarado (fica \`____\` no AGENTS.md §0.2). Meça com o doctor:"
echo
if ! command -v node >/dev/null 2>&1; then
  echo "AVISO: node não encontrado — o doctor não rodou. Instale Node ≥ 22.18 e rode: node $GATES_DIR/scripts/harness-doctor.mjs --explain"
else
  if (cd "$DEST" && node "$GATES_DIR/scripts/harness-doctor.mjs" --explain); then rc=0; else rc=$?; fi
  [ "$rc" -ne 0 ] && echo "doctor saiu com código $rc (nível declarado maior que o medido, ou erro acima)."
fi
echo
echo "── Próximos passos: (1) preencher o Apêndice do AGENTS.md · (2) declarar no §0.2 o nível que o doctor MEDIU · (3) calibrar antes de ligar gates (docs/harness/adocao.md §3) · (4) rodar gabarito-instalar para o onboarding de fluxo, versionamento e orquestração"
```

Observação sobre `put_gate` com arquivo idêntico: arquivo igual ao do plugin mas que nunca passou pelo instalador **não** ganha entrada no manifesto (regra "ausente = editado", leitura conservadora de ADR-TIM-1) — numa atualização futura ele vira `.novo`, nunca sobrescrita silenciosa.

- [ ] **T10.4 — Ver VERDE:** `bash plugins/gabarito-mestre/scripts/test/instalar.test.sh` → `── N ok, 0 falha(s)`. Rode também com `bash --version | head -1` anotado no ledger (3.2.57 no macOS).
- [ ] **T10.5 — Suíte antiga intacta:** `cd plugins/gabarito-mestre/hooks && node --test test/guards.test.mjs` (o instalador não toca hooks, mas o CI roda tudo).
- [ ] **T10.6 — Mutação rápida:** em `put_ref`, troque `cp "$src" "$dst.novo"` por `cp "$src" "$dst"` — cenário 4 "AGENTS.md intocado" cai. Em `put_gate`, troque `[ "$gravado" = "$disco" ]` por `true` — cenário 5 "doctor editado localmente NÃO foi tocado" cai. Reverta.
- [ ] **T10.7 — Instalação real num diretório descartável (a):** `bash plugins/gabarito-mestre/scripts/instalar.sh "$(mktemp -d)"` e depois `--atualizar` no mesmo diretório; cole no ledger as duas linhas de resumo `── …`.
- [ ] **T10.8 — Commit:** `feat(GM-2): instalar.sh — --atualizar (.novo + diff), --gates-substituir com hash e .bak, .instalado.json, .gitignore, --codeowners`.

---
## T11 — `gates/package.json` 1.1.0 + `bin` novos + suíte inteira medida (REQ-PKG-1 parcial)

**Files**
- Modificar: `plugins/gabarito-mestre/gates/package.json`
- Criar: `plugins/gabarito-mestre/gates/test/package.test.mjs`
- Modificar: `docs/ledgers/GM-2.md` (contagem medida)
- **Serial e por último**: `gates/package.json` é contenda; T5–T10 precisam estar integradas antes.

**Interfaces**
- Produces: `package.json` com `"version": "1.1.0"`, `bin` acrescido de `harness-onboarding-config`, `harness-capacidade`, `harness-versionamento-check`, `harness-cartao-sessao`, script `"versionamento": "node scripts/versionamento-check.mjs --base origin/main"`, `dependencies: {}` inalterado. `npm test` continua `node --test test/*.test.mjs` (o glob já pega os cinco testes novos) + `test:ts`.
- O `version` de `plugin.json`/`marketplace.json` só vira 1.1.0 em T25 — aqui o teste **não** compara com eles.

**Mutações prescritas (cabeçalho do teste):** M1 voltar `version` a `1.0.0` · M2 apontar um `bin` para arquivo inexistente · M3 acrescentar uma dependência.

**Steps**

- [ ] **T11.1 — Teste vermelho.** Crie `plugins/gabarito-mestre/gates/test/package.test.mjs`:

```js
/**
 * Testes do pacote dos gates — o que o instalador copia e o que o `bin` promete.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  voltar `version` a 1.0.0
 *  M2  apontar um `bin` para arquivo inexistente
 *  M3  acrescentar uma dependência (zero dependência é contrato)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(GATES, 'package.json'), 'utf8'));

describe('gates/package.json 1.1.0', () => {
  test('version é 1.1.0 (PKG-1: alinhado ao plugin na fase 6)', () => {
    assert.equal(pkg.version, '1.1.0');
  });
  test('todo bin aponta para um script existente e os quatro novos estão lá', () => {
    for (const [nome, rel] of Object.entries(pkg.bin)) assert.ok(existsSync(join(GATES, rel)), `${nome} → ${rel}`);
    for (const nome of ['harness-onboarding-config', 'harness-capacidade', 'harness-versionamento-check', 'harness-cartao-sessao', 'harness-doctor']) {
      assert.ok(pkg.bin[nome], nome);
    }
  });
  test('zero dependências e Node ≥ 22.18', () => {
    assert.deepEqual(pkg.dependencies, {});
    assert.deepEqual(pkg.devDependencies, {});
    assert.equal(pkg.engines.node, '>=22.18');
  });
  test('npm test cobre todos os .test.mjs (glob) e existe o script versionamento', () => {
    assert.match(pkg.scripts['test:mjs'], /test\/\*\.test\.mjs/);
    assert.match(pkg.scripts.versionamento, /versionamento-check\.mjs/);
  });
  test('todo script novo tem o cabeçalho JSDoc com USO (mesmo estilo do doctor)', () => {
    for (const f of ['onboarding-config.mjs', 'capacidade.mjs', 'versionamento-check.mjs', 'cartao-sessao.mjs']) {
      const t = readFileSync(join(GATES, 'scripts', f), 'utf8');
      assert.ok(t.startsWith('#!/usr/bin/env node\n/**'), `${f} sem shebang + JSDoc`);
      assert.match(t, /\n \* USO\n/, `${f} sem bloco USO`);
      assert.match(t, /fail-open declarado \(G9\)/, `${f} sem fail-open declarado`);
    }
  });
});
```

- [ ] **T11.2 — Ver VERMELHO:** `node --test test/package.test.mjs` — falha em `version é 1.1.0` e nos `bin` novos. Commit: `test(GM-2): package.json — version 1.1.0, bin novos, zero dependências`.

- [ ] **T11.3 — Implementação.** Substitua `plugins/gabarito-mestre/gates/package.json` por:

```json
{
  "name": "gabarito-gates",
  "version": "1.1.0",
  "description": "Gates executáveis do Gabarito Mestre — as regras que a máquina lembra, para que ninguém precise.",
  "type": "module",
  "license": "MIT",
  "engines": {
    "node": ">=22.18"
  },
  "exports": {
    "./mass-mutation-guard": "./src/mass-mutation-guard.ts",
    "./production-host-guard": "./src/production-host-guard.ts",
    "./eslint": "./eslint/no-unfiltered-mass-mutation.js"
  },
  "bin": {
    "harness-doctor": "./scripts/harness-doctor.mjs",
    "harness-migrations-guard": "./scripts/migrations-guard.mjs",
    "harness-deploy-order": "./scripts/deploy-order-check.mjs",
    "harness-quality": "./scripts/quality-ratchet.mjs",
    "harness-onboarding-config": "./scripts/onboarding-config.mjs",
    "harness-capacidade": "./scripts/capacidade.mjs",
    "harness-versionamento-check": "./scripts/versionamento-check.mjs",
    "harness-cartao-sessao": "./scripts/cartao-sessao.mjs"
  },
  "scripts": {
    "test": "npm run test:mjs && npm run test:ts",
    "test:mjs": "node --test test/*.test.mjs",
    "test:ts": "node --experimental-strip-types --test test/*.test.ts",
    "doctor": "node scripts/harness-doctor.mjs --explain",
    "quality": "node scripts/quality-ratchet.mjs",
    "versionamento": "node scripts/versionamento-check.mjs --base origin/main",
    "capacidade": "node scripts/capacidade.mjs --json"
  },
  "files": [
    "src",
    "scripts",
    "eslint",
    "README.md"
  ],
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **T11.4 — Ver VERDE e MEDIR:** `cd plugins/gabarito-mestre/gates && npm test 2>&1 | tail -n 12` — anote `# tests`, `# pass`, `# fail` da parte `.mjs` e da parte `.ts`; some. Escreva no ledger `docs/ledgers/GM-2.md`: `T11 · npm test · <N> testes (.mjs <a> + .ts <b>) · 0 falhas · <data>`. Rode também `bash scripts/test/instalar.test.sh` e `node --test hooks/test/guards.test.mjs` (a partir de `plugins/gabarito-mestre/`) e anote as três contagens. **Essa contagem é a que o README recebe em T25 — medida, não estimada.**
- [ ] **T11.5 — `chmod +x`** nos quatro scripts novos (`bin` exige executável): `chmod +x plugins/gabarito-mestre/gates/scripts/{onboarding-config,capacidade,versionamento-check,cartao-sessao}.mjs` e confira `git diff --stat` mostra `mode change 100644 => 100755`.
- [ ] **T11.6 — Instalação de ponta a ponta (a):** `bash plugins/gabarito-mestre/scripts/instalar.sh "$(mktemp -d)"` — confirme que os quatro scripts novos aparecem como `criado tools/gabarito-gates/scripts/…` e que o doctor 1.1.0 rodou ao fim mostrando as `FALTA` novas com `→` (não é `--explain`? é: o instalador chama `--explain`).
- [ ] **T11.7 — Commit:** `feat(GM-2): gates/package.json 1.1.0 — bin dos scripts novos e scripts npm`.

---

## Gate de fase (contagem verificável — do plano-mestre)

- [ ] 4 scripts novos em `gates/scripts/`: `ls plugins/gabarito-mestre/gates/scripts/*.mjs | wc -l` = **8** (4 antigos + 4 novos).
- [ ] Doctor com 8 checagens novas: `node -e "import('./plugins/gabarito-mestre/gates/scripts/harness-doctor.mjs').then(m=>console.log(m.NOVAS_1_1_0.length, m.CHECKS.length))"` → `8 27`.
- [ ] `instalar.sh` com 3 flags: `grep -c -- '--atualizar\|--gates-substituir\|--codeowners' plugins/gabarito-mestre/scripts/instalar.sh` ≥ 3.
- [ ] `npm test` verde com contagem **medida e escrita no ledger** (T11.4); `instalar.test.sh` verde; `guards.test.mjs` verde (inalterado nesta fase).
- [ ] `node plugins/gabarito-mestre/gates/scripts/harness-doctor.mjs --json` na raiz deste repo: nenhuma evidência `found` com `gabarito-mestre/` (job `doctor-self`).
- [ ] Review adversarial (`gabarito-review`) por task com as mutações prescritas do cabeçalho de cada teste; veredito no ledger.
- [ ] PR `enabler/GM-2-gates → main` aberta pelo orquestrador com ok do usuário (R1), título `enabler(GM-2): gates da 1.1.0 — onboarding-config, capacidade, versionamento-check, doctor, cartão, instalar.sh`.

## Decisões tomadas neste plano (registrar no ledger como (b) até o review confirmar)

1. `modelo-resolvido` usa `level: 'warn'` (string) em `CHECKS`; o cálculo de nível filtra por `=== 1|2|3`, então o aviso fica fora por construção; `render` ganha a seção "Avisos (não contam no nível)"; o teste de integridade aceita `'warn'`.
2. `onboarding-config.mjs` com arquivo-alvo **inválido** não escreve e sai **0** (regra de fail-open do mestre), com stderr explícito — a skill `gabarito-instalar` deve ler o stderr e parar; exit 1 fica reservado a erro de argumento (contrato "1 JSON inválido").
3. `inferirPbi` só infere de `<tipo>/<PBI>…` quando `tipo ∈ versionamento.tiposComEscopoDePbi`; `chore/GM-3-x` (tipo livre) fica "(b) não inferido" mesmo com `GM-3` casando `idPadrao` — é o que o Review Focus 5 lista como "branch sem PBI".
4. "PBIs em voo" = chaves do `.harness/fluxo-cache.json` (ORQ-6, única fonte offline); "envelhecido" = em voo sem `MOVIMENTO`/`BLOQUEADA` datada há mais de `envelhecimentoDias` (sem ledger datado, usa o `em` do cache). Frontmatter de `docs/fluxo/pbis/<PBI>.md` lido com chaves `epic:`/`iniciativa:` — **T3 (fase 1) deve usar esses nomes**; se usou outros, ajustar `lerFrontmatter` em T9 antes do commit.
5. `capacidade.mjs`: processos pesados reduzem a partir do **teto** (`permitido = max(1, teto − pesados)`); `ps` roda com `LC_ALL=C` e o parser aceita vírgula decimal (medido: macOS pt-BR imprime `0,5`). Erro inesperado na medição vira `slots: 1`, exit 0.
6. `.instalado.json` registra **só** arquivos que o instalador escreveu (criados ou substituídos); arquivos "mantidos" de uma instalação 1.0.1 (anterior ao manifesto) ficam fora e são tratados como editados por `--gates-substituir` → `.novo`. É a leitura conservadora de ADR-TIM-1: em dúvida, não sobrescreve.
7. O doctor passa a resolver a raiz por `git rev-parse --show-toplevel` (fallback cwd) em `main()`; `run(root)` não muda de assinatura.
8. **VER-3, limite declarado (b):** `versionamento-check.mjs` (e a checagem `versionamento` do doctor) confere o **first-parent de `HEAD`** (`git log --first-parent`), não `main` + a branch atual — a branch em que o doctor roda é a que é medida; commits de merge trazidos de outras branches não são inspecionados. Aceito como está; T25 registra no README (seção "Versionamento") como limite declarado, ao lado dos limites dos hooks (G9).

## Emendas (2026-09-24, revisão cruzada)

- #2: grafia canônica de `MOVIMENTO` (chaves de `fluxo.status.FL2`) nos fixtures e no `lerLedger` de T9; M7b cobre a normalização do nome de coluna.
- #3: `PLUGIN_REAL` — testes que dependem do plugin real apontam para cópia em tmpdir, nunca para a árvore do repo.
- #5: frontmatter `epics/<epic>.md` (`iniciativa:`) lido pelo cartão para resolver a Iniciativa do PBI via Epic (decisão 4).
- #16: pré-condição do ledger `GM-2.md` no cabeçalho novo de `referencia.md §2.3` (`PBI: GM-2 · Epic: (b) — repo do plugin, sem onboarding`, `## LER PRIMEIRO — <data>`).
- #17: T8 ganha o passo **T8.0** — grep exato de `ix.root`, `ATTEST_TTL_DAYS`, `agentsFile`, `createIndex` em `harness-doctor.mjs` 1.0.1 antes de escrever; se `ix.root` faltar, acrescentar em `createIndex`.
- #19: cartão de sessão — teste da linha `Config: defaults (orquestracao ausente) — gabarito-instalar (fase 4)` (só sem a seção `orquestracao`).
- VER-3 (b): decisão 8 registra que o doctor/`versionamento-check` conferem o first-parent de `HEAD`, não `main` + branch atual — aceito; T25 registra no README como limite declarado.
- Nova 4: `normalizarEstado` remove diacríticos (`.normalize('NFD').replace(/[̀-ͯ]/g,'')`) além de trim + minúsculas + espaço→`_`; caso de teste `Concluído`→`concluido` (e `MOVIMENTO … Em validação→Concluído`).

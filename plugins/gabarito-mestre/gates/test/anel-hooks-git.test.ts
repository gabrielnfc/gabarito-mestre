/**
 * GM-22 T1 — hooks do git e push sem hooks no anel de integridade (REQ-HKS-1, REQ-HKS-2).
 *
 * MUTAÇÕES PRESCRITAS:
 *  MH1-a tirar `.githooks` de AREAS_DIR ⇒ `anel-githooks-escrita-pede`, `anel-githooks-bash-pede` caem
 *  MH1-b tirar `.husky` de AREAS_DIR ⇒ os mesmos (caso `.husky`) caem
 *  MH1-c comparar com caixa exata ⇒ cai o caso `.GitHooks`
 *  MH2-a casar só `--no-verify` exato ⇒ cai `--no-veri`
 *  MH2-b aplicar só ao orquestrador ⇒ cai o caso do subagente
 *  MH2-c tirar a regra das variáveis ⇒ `push-sem-hooks-por-variavel-pede` cai
 *  MH2-e ignorar atribuições de `env`/`sudo` (pularFlags) ⇒ caem os casos `env GIT_CONFIG_*`
 *  MH2-f mover a regra para depois do ramo push ⇒ cai o caso de remote não-origin
 *  Fato medido (git 2.50.1): `push --no-veri` PULA o hook, como `--no-verify`; `--no-ve` é recusado (ambíguo). Prefixo `--no-veri` está certo.
 *  MH2-dprocurar no `cru` em vez dos tokens ⇒ cai `git commit -m "--no-verify"` (push-comum-segue-livre)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidir } from '../src/decidir.ts';
import type { ConfigGuarda, Contexto, EntradaHook } from '../src/tipos.ts';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'test', 'corpus');
const CONFIG: ConfigGuarda = JSON.parse(readFileSync(join(CORPUS, '_ambientes.json'), 'utf8'));
const CTX: Contexto = { branchAtual: 'feat/GM-1-x', refLinkado: null, remoteUrl: 'git@github.com:org/app.git', raiz: '/repo', pluginRoot: '/plugin' };

function rodar(tool: string, input: Record<string, unknown>, papel: 'orq' | 'sub', autonomia = false) {
  const e: EntradaHook = { tool_name: tool, tool_input: input, permission_mode: 'default', session_id: 's', cwd: '/repo', ...(papel === 'sub' ? { agent_id: 'a1', agent_type: 'general-purpose' } : {}) };
  return decidir(e, CONFIG, CTX, autonomia);
}
const bash = (command: string, papel: 'orq' | 'sub', autonomia = false) => rodar('Bash', { command }, papel, autonomia);

/**
 * Pede ao orquestrador, nega ao subagente, em integridade, com o alvo dado. O orquestrador é conferido sem autonomia: com ela,
 * `decidir` ainda cala integridade até a T3 (GM-22); o subagente é conferido nos 2 estados.
 */
function afirmaIntegridade(tool: string, input: Record<string, unknown>, alvo?: string) {
  const o = rodar(tool, input, 'orq', false);
  assert.equal(o.faixa, 'ask', `orq ${JSON.stringify(input)}`);
  assert.equal(o.permissionDecision, 'ask');
  assert.equal(o.classificacao.anel, 'integridade', JSON.stringify(input));
  if (alvo !== undefined) assert.equal(o.classificacao.alvo, alvo);
  for (const aut of [false, true]) {
    const s = rodar(tool, input, 'sub', aut);
    assert.equal(s.faixa, 'deny', `sub ${JSON.stringify(input)} aut=${aut}`);
    assert.equal(s.permissionDecision, 'deny');
    assert.equal(s.classificacao.anel, 'integridade');
    if (alvo !== undefined) assert.equal(s.classificacao.alvo, alvo);
  }
}

const CAMINHOS_HOOK = [
  '.githooks/pre-push',
  '.githooks/commit-msg',
  '.husky/pre-push',
  '/repo/.githooks/pre-push',
  '/repo/.husky/pre-push',
  '/repo/.harness/worktrees/T1/.githooks/pre-push',
  '.GitHooks/pre-push',
  '.HUSKY/pre-push',
];

describe('REQ-HKS-1 diretórios de hooks do git', () => {
  test('anel-githooks-escrita-pede', () => {
    for (const p of CAMINHOS_HOOK) {
      afirmaIntegridade('Edit', { file_path: p, old_string: 'a', new_string: 'b' });
      afirmaIntegridade('Write', { file_path: p, content: 'x' });
      afirmaIntegridade('NotebookEdit', { notebook_path: p, new_source: 'x' });
    }
  });
  test('anel-githooks-bash-pede', () => {
    for (const c of ['echo x > .githooks/pre-push', 'rm -rf .githooks', 'chmod -x .husky/pre-push', 'cp a .githooks/pre-push', 'echo x >> .husky/pre-push', 'mv a .GitHooks/pre-push']) {
      afirmaIntegridade('Bash', { command: c });
    }
  });
  test('anel-githooks-leitura-livre', () => {
    for (const p of ['.githooks/pre-push', '.husky/pre-push']) {
      for (const papel of ['orq', 'sub'] as const) {
        const d = rodar('Read', { file_path: p }, papel);
        assert.equal(d.classificacao.anel, null, `Read ${p} ${papel}`);
        const b = bash(`cat ${p}`, papel);
        assert.equal(b.classificacao.anel, null, `cat ${p} ${papel}`);
        assert.equal(b.faixa, 'silencio');
      }
    }
  });
  test('outra pasta vizinha não vira anel', () => {
    for (const p of ['githooks/pre-push', 'docs/.githooks-notes.md', 'src/husky.ts']) {
      assert.equal(rodar('Edit', { file_path: p, old_string: 'a', new_string: 'b' }, 'sub').classificacao.anel, null, p);
    }
  });
});

describe('REQ-HKS-2 push sem hooks', () => {
  test('push-sem-hooks-pede', () => {
    for (const c of [
      'git push --no-verify origin feat/x',
      'git push origin feat/x --no-verify',
      'git push --no-veri origin feat/x',
      'git push --no-verif origin feat/x',
      'git push -u --no-verify origin feat/x',
    ]) afirmaIntegridade('Bash', { command: c }, '.git/hooks');
  });
  test('push-sem-hooks-por-variavel-pede', () => {
    for (const c of [
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin feat/x',
      "GIT_CONFIG_PARAMETERS=\"'core.hookspath=/dev/null'\" git commit -m x",
      'GIT_CONFIG_COUNT=1 git push origin feat/x',
      'GIT_CONFIG_KEY_3=core.hooksPath git status',
      'GIT_CONFIG_VALUE_12=/dev/null git log',
      // r1 MAJOR-1: as atribuições depois de `env`/`sudo` também contam (mesmo ataque, vizinho trivial)
      'env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin feat/x',
      'sudo GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push origin feat/x',
      "env -i GIT_CONFIG_PARAMETERS=\"'core.hookspath=/dev/null'\" git commit -m x",
    ]) afirmaIntegridade('Bash', { command: c }, '.git/hooks');
  });
  test('env sem variável de config segue livre', () => {
    for (const papel of ['orq', 'sub'] as const) {
      const d = bash('env GIT_CONFIG_GLOBAL=/dev/null git push origin feat/x', papel);
      assert.equal(d.classificacao.anel, null, papel);
    }
  });
  // r1 MINOR-3: a regra vem ANTES do ramo `push`; senão remote não-origin mudaria o alvo para refs/remotes.
  test('ordem: push sem hooks com remote não-origin mantém alvo .git/hooks', () => {
    afirmaIntegridade('Bash', { command: ['git', 'push', '--no-verify', 'upstream', 'feat/x'].join(' ') }, '.git/hooks');
  });
  test('push-comum-segue-livre', () => {
    for (const c of ['git push origin feat/x', 'git push --verbose origin feat/x', 'git commit -m "--no-verify"', 'git log --grep=no-verify', 'GIT_CONFIG_GLOBAL=/dev/null git status']) {
      for (const papel of ['orq', 'sub'] as const) {
        const d = bash(c, papel);
        assert.equal(d.classificacao.anel, null, `${c} ${papel}`);
        assert.equal(d.faixa, 'silencio', `${c} ${papel}`);
      }
    }
  });
});

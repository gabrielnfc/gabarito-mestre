/**
 * GM-22 T2 (REQ-PUB-1, DT1, DT3): o classificador marca `publicar` só nas 3 formas fechadas (fail-closed).
 * `publicar` ainda não muda nenhuma decisão (T3).
 *
 * MUTAÇÕES PRESCRITAS:
 *  MP1-a  allowlist de flags do push ignorada (qualquer flag) ⇒ `publicar-negativos` (--force, -o, --all, --delete) falha
 *  MP1-b  refspec com `+`/`:` inicial aceito ⇒ `publicar-negativos` (+main, :main) falha
 *  MP1-c  `Classificacao.publicar` = algum segmento prod (em vez de todos) ⇒ `publicar-misto` falha
 *  MP1-d  `vercel` com qualquer subcomando (sem checar a lista) ⇒ `publicar-negativos` (env pull, logs) falha
 *  MR2    (r1) `publicar = true` no push implícito ⇒ `publicar-push-implicito-flag-fora` falha
 *  MR3    (r1) ignorar global do git antes do push, ou `-R`/`--repo` no gh ⇒ `publicar-outro-repo` falha
 *  MP1-f  (própria) tirar `candidatos prod === 1` ⇒ `publicar-mesmo-segmento-com-alvo-terceiro-e-false` falha
 *  MR4    (r2) tirar a checagem de prefixo de ambiente (`semPrefixo` inteiro; a linha de `atribs` sozinha é coberta pelo 1º token) ⇒ `publicar-familia-ambiente` falha
 *  MV1    (c2r1) vercel aceitar flag de alvo (`--cwd`/`--scope`/`--token`/`-A`/`-Q`/`-t`/`-S`/`--local-config`, `--x v` ou `--x=v`) ⇒ `publicar-familia-vercel-flags` falha
 *  MV2    (c2r1) vercel aceitar posicional de caminho/URL/id inválido ⇒ `publicar-familia-vercel-posicional` falha
 *  MV3    (c2r1) push aceitar 2+ refspecs ⇒ `publicar-refspec-unico` falha
 *  MR5    (r2) gh aceitar URL / owner/repo#n (não só número puro) ⇒ `publicar-familia-gh-alvo` falha
 *  MR6    (r2) gh aceitar flag fora da lista fechada ⇒ `publicar-familia-gh-flags` falha
 *  MP1-e  (própria) remoto fora de origin aceito ⇒ `publicar-negativos` (remoto outro) falha
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classificar } from '../src/classificar-alvo.ts';
import type { ConfigGuarda, Contexto, EntradaHook } from '../src/tipos.ts';

const CFG = {
  ambientes: {
    teste: { hosts: ['localhost'], bancos: ['localhost'] },
    prod: { hosts: ['api.exemplo.com'], bancos: ['db.prod.exemplo.com'], mcps: ['mcp__banco_prod__'], projetos: ['refprod'], variaveis: ['PROD_DB'], branches: ['main'] },
  },
  permitidos: [],
} as unknown as ConfigGuarda;

function ctx(branchAtual: string): Contexto {
  return { branchAtual, refLinkado: null, remoteUrl: 'git@github.com:org/app.git', raiz: '/repo', pluginRoot: '/plugin' };
}
function bash(comando: string, branch = 'feat/x') {
  const e: EntradaHook = { tool_name: 'Bash', tool_input: { command: comando }, permission_mode: 'default', session_id: 's', cwd: '/repo' };
  return classificar(e, CFG, ctx(branch));
}

describe('classificar-publicar-formas', () => {
  const positivos: Array<[string, string]> = [
    ['git push origin main', 'feat/x'],
    ['git push -u origin main', 'feat/x'],
    ['git push', 'main'],
    ['gh pr merge 5', 'main'],
    ['vercel --prod', 'feat/x'],
    ['vercel deploy --prod', 'feat/x'],
    ['vercel promote x', 'feat/x'],
    ['vc --prod', 'feat/x'],
    ['vercel redeploy x --prod', 'feat/x'],
    ['vercel rollback', 'feat/x'],
    ...['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose', '--follow-tags', '--atomic', '--porcelain', '-n', '--dry-run'].map((f): [string, string] => [`git push ${f} origin main`, 'feat/x']),
  ];
  for (const [cmd, branch] of positivos) {
    test(`positivo: ${cmd} (${branch})`, () => {
      const c = bash(cmd, branch);
      assert.equal(c.publicar, true);
      assert.equal(c.ambiente, 'prod');
      assert.equal(c.segmentosProd.length, 1);
    });
  }

  const negativos: Array<[string, string]> = [
    ['git push --force origin main', 'feat/x'],
    ['git push origin +main', 'feat/x'],
    ['git push origin :main', 'feat/x'],
    ['git push --delete origin main', 'feat/x'],
    ['git push --all origin', 'feat/x'],
    ['git push -o x origin main', 'feat/x'],
    ['git push outro main', 'feat/x'],
    ['vercel env pull --prod', 'feat/x'],
    ['vercel logs --prod', 'feat/x'],
    ['supabase db push --project-ref refprod', 'feat/x'],
    ['psql -h db.prod.exemplo.com -c "select 1"', 'feat/x'],
    ['git push origin feat/x', 'feat/x'],
    ['git status', 'main'],
  ];
  test('publicar-familia-ambiente: qualquer prefixo (VAR=, env, sudo) antes do comando é false, ambiente segue prod', () => {
    const casos: Array<[string, string]> = [
      ['GIT_DIR=../outro/.git git push origin main', 'feat/x'],
      ['GIT_WORK_TREE=../outro git push origin main', 'feat/x'],
      ['FOO=1 git push origin main', 'feat/x'],
      ['FOO=1 git push', 'main'],
      ['env GIT_DIR=../outro/.git git push origin main', 'feat/x'],
      ['env FOO=1 git push origin main', 'feat/x'],
      ['sudo GIT_DIR=../outro/.git git push origin main', 'feat/x'],
      ['GH_REPO=org/terceiro gh pr merge 5', 'main'],
      ['env GH_REPO=org/terceiro gh pr merge 5', 'main'],
      ['FOO=1 vercel --prod', 'feat/x'],
      ['env VERCEL_ORG_ID=x vercel --prod', 'feat/x'],
      ['VERCEL_PROJECT_ID=x vc deploy --prod', 'feat/x'],
    ];
    for (const [cmd, branch] of casos) {
      const c = bash(cmd, branch);
      assert.equal(c.publicar, false, cmd);
      assert.equal(c.ambiente, 'prod', cmd);
    }
  });

  test('publicar-familia-vercel-flags: flag de alvo (com espaço E com =) e flag fora da lista são false; ambiente segue prod', () => {
    const flags = ['--cwd', '--scope', '--token', '--local-config', '--global-config', '-A', '-Q', '-t', '-S', '--team', '--project'];
    const casos: string[] = [];
    for (const f of flags) {
      casos.push(`vercel ${f} ../outro --prod`, `vercel --prod ${f} ../outro`, `vercel deploy ${f} outro --prod`, `vercel ${f}=outro --prod`, `vercel deploy --prod ${f}=outro`);
    }
    casos.push('vercel --prod --force', 'vercel --prod --target=production', 'vercel --prod=true', 'vercel --prod --prebuilt');
    for (const cmd of casos) {
      const c = bash(cmd);
      assert.equal(c.publicar, false, cmd);
      assert.equal(c.ambiente, 'prod', cmd);
    }
  });

  test('publicar-familia-vercel-posicional: caminho, URL, subcomando alheio e posicional em deploy são false', () => {
    for (const cmd of [
      'vercel ../outro --prod',
      'vercel ./app --prod',
      'vercel deploy ../outro --prod',
      'vercel deploy outro --prod',
      'vercel deploy https://outro.vercel.app --prod',
      'vercel promote https://outro.vercel.app',
      'vercel promote ../outro',
      'vercel promote a b',
      'vercel redeploy outro.vercel.app --prod',
      'vercel rollback https://outro.vercel.app',
      'vercel env pull --prod',
    ]) {
      assert.equal(bash(cmd).publicar, false, cmd);
    }
  });

  test('publicar-vercel-lista-aceita: a lista fechada aceita só estas formas', () => {
    for (const cmd of ['vercel --prod', 'vc --prod', 'vercel deploy --prod', 'vercel --prod --yes', 'vercel deploy --prod -y', 'vercel --production', 'vercel promote dpl_abc123', 'vercel redeploy dpl_abc --prod', 'vercel rollback dpl_abc']) {
      assert.equal(bash(cmd).publicar, true, cmd);
    }
  });

  test('publicar-refspec-unico: push com 2+ refspecs (tag junto) é false; 1 refspec prod segue true', () => {
    for (const cmd of ['git push origin main v1', 'git push origin main feat/y', 'git push origin HEAD main']) assert.equal(bash(cmd).publicar, false, cmd);
    assert.equal(bash('git push origin main').publicar, true);
  });

  test('publicar-familia-gh-alvo: URL, owner/repo#n, -R colado e globais são false', () => {
    for (const cmd of [
      'gh pr merge https://github.com/org/terceiro/pull/5',
      'gh pr merge org/terceiro#5',
      'gh pr merge 5 https://github.com/org/terceiro/pull/6',
      'gh pr merge -Rorg/x 5',
      'gh pr merge 5 -Rorg/x',
      'gh pr merge 5 --repo=org/x',
      'gh pr merge feature-branch',
    ]) {
      const c = bash(cmd, 'main');
      assert.equal(c.publicar, false, cmd);
      assert.equal(c.ambiente, 'prod', cmd);
    }
    // Flag global antes de `pr`: o leitor não acha `pr merge` (ambiente não é prod); publicar segue false.
    for (const cmd of ['gh -R org/x pr merge 5', 'gh --repo org/x pr merge 5']) assert.equal(bash(cmd, 'main').publicar, false, cmd);
  });

  test('publicar-familia-gh-flags: só a lista fechada de flags sem efeito de alvo', () => {
    for (const f of ['--merge', '-m', '--squash', '-s', '--rebase', '-r', '--auto', '--delete-branch', '-d']) {
      assert.equal(bash(`gh pr merge 5 ${f}`, 'main').publicar, true, f);
    }
    assert.equal(bash('gh pr merge 5 --squash --delete-branch', 'main').publicar, true);
    assert.equal(bash('gh pr merge --squash', 'main').publicar, true);
    for (const f of ['--admin', '--body x', '-b x', '--subject x', '-t x', '--body-file f', '--match-head-commit abc', '--disable-auto', '--unknown']) {
      assert.equal(bash(`gh pr merge 5 ${f}`, 'main').publicar, false, f);
    }
    assert.equal(bash('gh pr merge 5 6', 'main').publicar, false);
  });

  test('publicar-negativos', () => {
    for (const [cmd, branch] of negativos) assert.equal(bash(cmd, branch).publicar, false, cmd);
  });

  test('publicar-push-implicito-flag-fora: branch atual main, flag fora da lista', () => {
    for (const f of ['--force', '-f', '--tags', '-o x', '--force-with-lease', '--delete']) {
      const c = bash(`git push ${f}`, 'main');
      assert.equal(c.publicar, false, f);
      assert.equal(c.ambiente, 'prod', f);
    }
    assert.equal(bash('git push origin', 'main').publicar, true);
  });

  test('publicar-outro-repo: globais do git antes do push e gh -R/--repo são false', () => {
    for (const cmd of [
      'git -C ../outro push origin main',
      'git -C ../outro push',
      'git --git-dir=../outro/.git push origin main',
      'git --git-dir ../outro/.git push',
      'git --work-tree=../outro push origin main',
      'gh pr merge -R org/terceiro 5',
      'gh pr merge 5 --repo org/terceiro --admin',
      'gh pr merge 5 --repo=org/terceiro',
    ]) {
      const c = bash(cmd, 'main');
      assert.equal(c.publicar, false, cmd);
      assert.equal(c.ambiente, 'prod', cmd);
    }
    assert.equal(bash('git push origin main', 'main').publicar, true);
    assert.equal(bash('gh pr merge 5', 'main').publicar, true);
  });

  test('negativos prod mantêm ambiente e segmentosProd (nenhuma decisão muda)', () => {
    for (const cmd of ['git push --force origin main', 'vercel env pull --prod', 'psql -h db.prod.exemplo.com -c "select 1"']) {
      assert.equal(bash(cmd).segmentosProd.length, 1, cmd);
      assert.equal(bash(cmd).ambiente, 'prod', cmd);
    }
  });

  test('publicar-misto: publicar + terceiro no mesmo comando é false', () => {
    const c = bash('git push origin main && psql -h db.prod.exemplo.com -c "select 1"');
    assert.equal(c.segmentosProd.length, 2);
    assert.equal(c.publicar, false);
  });

  test('publicar-mesmo-segmento-com-alvo-terceiro-e-false', () => {
    const c = bash('vercel deploy --prod $PROD_DB');
    assert.equal(c.ambiente, 'prod');
    assert.equal(c.publicar, false);
  });

  test('publicar-dois-publicares segue true', () => {
    assert.equal(bash('git push origin main && vercel --prod').publicar, true);
  });

  test('publicar-mcp-e-ferramenta-de-arquivo', () => {
    const m: EntradaHook = { tool_name: 'mcp__banco_prod__execute_sql', tool_input: { query: 'select 1' }, session_id: 's' };
    const c = classificar(m, CFG, ctx('feat/x'));
    assert.equal(c.ambiente, 'prod');
    assert.equal(c.publicar, false);
    const ed: EntradaHook = { tool_name: 'Edit', tool_input: { file_path: '/repo/a.ts' }, session_id: 's', cwd: '/repo' };
    assert.equal(classificar(ed, CFG, ctx('main')).publicar, false);
  });

  test('publicar-anel: anel força false', () => {
    const c = bash('git push origin main && echo x > harness.config.json');
    assert.equal(c.anel, 'integridade');
    assert.equal(c.publicar, false);
  });

  test('publicar-sem-config: false', () => {
    const e: EntradaHook = { tool_name: 'Bash', tool_input: { command: 'git push origin main' }, session_id: 's', cwd: '/repo' };
    assert.equal(classificar(e, null, ctx('main')).publicar, false);
  });
});

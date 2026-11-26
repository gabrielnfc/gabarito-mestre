/**
 * GM-22 T2 (REQ-PUB-1, DT1, DT3): o classificador marca `publicar` só nas 3 formas fechadas (fail-closed).
 * `publicar` ainda não muda nenhuma decisão (T3).
 *
 * MUTAÇÕES PRESCRITAS:
 *  MP1-a  allowlist de flags do push ignorada (qualquer flag) ⇒ `publicar-negativos` (--force, -o, --all, --delete) falha
 *  MP1-b  refspec com `+`/`:` inicial aceito ⇒ `publicar-negativos` (+main, :main) falha
 *  MP1-c  `vercel` com qualquer subcomando (sem checar a lista) ⇒ `publicar-negativos` (env pull, logs) falha
 *  MP1-d  `Classificacao.publicar` = algum segmento prod (em vez de todos) ⇒ `publicar-misto` falha
 *  MP1-f  (própria) tirar `candidatos prod === 1` ⇒ `publicar-mesmo-segmento-com-alvo-terceiro-e-false` falha
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
  test('publicar-negativos', () => {
    for (const [cmd, branch] of negativos) assert.equal(bash(cmd, branch).publicar, false, cmd);
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

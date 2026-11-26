/**
 * GM-22 T2 (REQ-PUB-1, DT1, DT3): o classificador marca `publicar` só nas 3 formas fechadas (fail-closed).
 * `publicar` ainda não muda nenhuma decisão (T3).
 *
 * c4: `publicar` passa por um portão positivo único (`portaoPublicar`), ANTES das 3 formas: 1 segmento, texto cru só de `[A-Za-z0-9 ._/@:,=-]`,
 * sem builtin de ambiente/`VAR=` e 1ª palavra = o próprio comando. A lista de negação por construção de shell (CONSTRUCAO_OCULTA, semPrefixo por forma,
 * `candidatos prod === 1`, `a !== ''` do vercel) saiu: o portão a torna inalcançável (sem `$`, aspas ou crase não há destino/argumento oculto).
 * `publicar-matriz-portao` GERA família × forma (produto) e exige false em todas; a decisão do dono (`npm test && git push …` pergunta) é uma das famílias.
 *
 * MUTAÇÕES (todas executadas na c4; cada uma derruba o teste citado):
 *  MG-char   tirar o portão de caracteres (`CARACTERES_PUBLICAR` sempre true) ⇒ `publicar-matriz-portao` falha (crase, `$`, aspas, glob, `~`, `{}`, não-ASCII, `+`…)
 *  MG-seg    tirar a regra de 1 segmento: sozinha só lança em comando vazio (`segmentos[0]` indefinido); no resto SOBREVIVE, porque o portão de caracteres já barra `;`, `&`, `|` e quebra de linha. Com `;&|\n` também liberados no portão, `publicar-matriz-portao` (família `;`) e `publicar-dois-publicares` falham: as duas regras se cobrem de propósito
 *  MG-builtin tirar a lista de builtin: SOBREVIVE sozinha (`primeiro === s.cmd` já barra `export`, `env`, `sudo`…); tirando as duas, `publicar-familia-ambiente` e a família `prefixo de comando` falham
 *  MG-atrib  tirar `s.atribs.length > 0`: SOBREVIVE sozinha (1ª palavra `FOO=1` ≠ comando); tirando também `primeiro === s.cmd`, `publicar-familia-ambiente` falha
 *  MG-prim   tirar `primeiro === s.cmd` ⇒ `publicar-matriz-portao` falha (`nice`, `timeout`, `/usr/bin/git`, `FOO=1`)
 *  MP1-a  allowlist de flags do push ignorada (qualquer flag) ⇒ `publicar-negativos` (--force, -o, --all, --delete) falha
 *  MP1-b  refspec com `:` inicial aceito ⇒ `publicar-negativos` (:main) falha (`+main` também cai no portão de caracteres, `:main` é o caso que só a regra do refspec barra)
 *  MP1-c  removida na c4: com 1 segmento garantido pelo portão, "todos os segmentos prod" ≡ "o segmento"; `publicar-misto` e `publicar-dois-publicares` cobrem a regra de 1 segmento (MG-seg+sep)
 *  MP1-d  `vercel` com qualquer subcomando (sem checar a lista) ⇒ `publicar-negativos` (env pull, logs) falha
 *  MP1-e  remoto fora de origin aceito ⇒ `publicar-negativos` (remoto outro) falha
 *  MV1    vercel aceitar flag de alvo (`--cwd`/`--scope`/`--token`/`-A`/`-Q`/`-t`/`-S`, `--x v` ou `--x=v`) ⇒ `publicar-familia-vercel-flags` falha
 *  MV2    vercel aceitar posicional de caminho/URL/id inválido ⇒ `publicar-familia-vercel-posicional` falha
 *  MV3    push aceitar 2+ refspecs ⇒ `publicar-refspec-unico` falha
 *  MV4    argumento vazio do vercel (`vercel --prod ""`): barrado pelo portão (aspas), caso na matriz e em `publicar-vercel-arg-vazio`; a checagem `a !== ''` foi removida por inalcançável
 *  M-url  gh aceitar URL / owner/repo#n (não só número puro) ⇒ `publicar-familia-gh-alvo` falha
 *  M-flag gh aceitar flag fora da lista fechada ⇒ `publicar-familia-gh-flags` falha
 *  MR2    `publicar = true` no push implícito ⇒ `publicar-push-implicito-flag-fora` falha
 *  MOID   tirar a recusa do OID nulo no refspec ⇒ `publicar-oid-nulo` falha (40 e 64 zeros: o git trata origem nula como DELEÇÃO da ref remota); aceitar só 40 zeros ⇒ o caso de 64 falha
 *  EQUIV  `publicar: false` no retorno do anel (classificar-alvo.ts) e `&& escolhido.ambiente === 'prod'` em `p.publicar`: EQUIVALENTES. Não existe comando de 1 segmento que seja anel e passe o portão positivo (testado: `.harness/PAUSAR:main`, `harness.config.json:main` não são anel), e `publicar` só liga junto com um candidato prod. O `false` do anel é cinto de segurança; `publicar-anel` (2 segmentos) é barrado pelo portão de 1 segmento
 *  MR3    ignorar global do git antes do push, ou `-R`/`--repo` no gh ⇒ `publicar-outro-repo` falha
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
      // valor termina em `/<cmd>`: o 1º token (`primeiro.split('/').pop()`) passaria; só a checagem de `atribs` barra
      ['GH_REPO=org/gh gh pr merge 5', 'main'],
      ['GIT_DIR=../outro/git git push origin main', 'main'],
      ['VERCEL_ORG_ID=x/vercel vercel --prod', 'feat/x'],
      ['X=/usr/bin/git git push origin main', 'main'],
    ];
    for (const [cmd, branch] of casos) {
      const c = bash(cmd, branch);
      assert.equal(c.publicar, false, cmd);
      assert.equal(c.ambiente, 'prod', cmd);
    }
  });

  test('publicar-vercel-arg-vazio: argumento vazio em vercel é false, ambiente segue prod', () => {
    const c = bash('vercel --prod ""');
    assert.equal(c.publicar, false);
    assert.equal(c.ambiente, 'prod');
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

  test('publicar-oid-nulo: origem de refspec só de zeros é deleção, não publicar', () => {
    for (const z of ['0000', '0'.repeat(40), '0'.repeat(64)]) {
      for (const [dest, branch] of [['main', 'feat/x'], ['main', 'main'], ['refs/heads/main', 'feat/x']]) {
        const c = bash(`git push origin ${z}:${dest}`, branch);
        assert.equal(c.publicar, false, `${z}:${dest}`);
        assert.equal(c.destrutivo, true, `${z}:${dest}`);
      }
    }
    for (const r of ['HEAD:main', 'main:main', 'feat/x:main', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678:main', '0abc:main'])
      assert.equal(bash(`git push origin ${r}`).publicar, true, r);
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

  // c4: a checagem `candidatos prod === 1` saiu (inalcançável: 2 candidatos prod num segmento exigem `$` de variável prod ou host em comando de rede,
  // e o portão barra `$`); o caso que a justificava segue false, agora só pelo portão de caracteres (mutação MG-char o derruba).
  test('publicar-isola-alvo-prod-unico: push com refspec cujo destino vem de variável prod é false', () => {
    const c = bash('git push origin $PROD_DB:main');
    assert.equal(c.ambiente, 'prod');
    assert.equal(c.publicar, false);
  });

  // Decisão do dono (c4): comando com mais de 1 segmento volta a perguntar, mesmo com 2 publicares.
  test('publicar-dois-publicares: 2 segmentos é false', () => {
    assert.equal(bash('git push origin main && vercel --prod').publicar, false);
  });

  test('publicar-mcp-e-ferramenta-de-arquivo', () => {
    const m: EntradaHook = { tool_name: 'mcp__banco_prod__execute_sql', tool_input: { query: 'select 1' }, session_id: 's' };
    const c = classificar(m, CFG, ctx('feat/x'));
    assert.equal(c.ambiente, 'prod');
    assert.equal(c.publicar, false);
    const ed: EntradaHook = { tool_name: 'Edit', tool_input: { file_path: '/repo/a.ts' }, session_id: 's', cwd: '/repo' };
    assert.equal(classificar(ed, CFG, ctx('main')).publicar, false);
  });

  // c3r1: a forma fechada só vale se o comando INTEIRO é lido inteiro; substituição injeta argumento que o leitor não vê.
  test('publicar-substituicao-recusa: os 6 casos da sonda c3r1 e variantes são false', () => {
    const casos: Array<[string, string]> = [
      ['git push origin main `echo --force`', 'feat/x'],
      ['gh pr merge 5 `echo --admin`', 'main'],
      ['gh pr merge `echo 5 -R o/r`', 'main'],
      ['vercel --prod `echo --scope=x`', 'feat/x'],
      ['vercel promote `echo https://outro.vercel.app`', 'feat/x'],
      ['vercel --prod ; `echo vercel --scope x --prod`', 'feat/x'],
      ['git push origin main `true`', 'feat/x'],
      ['git push origin main"`echo -f`"', 'feat/x'],
    ];
    for (const [cmd, br] of casos) assert.equal(bash(cmd, br).publicar, false, cmd);
  });

  test('publicar-construcao-por-construcao: cada construção que o leitor não vê inteira recusa a forma, em qualquer segmento', () => {
    const construcoes = [
      '`echo x`', '$(echo x)', '<(echo x)', '>(cat)', '<<EOF\nx\nEOF', '<<<x', 'eval x', 'source x', '. x', 'xargs echo', 'bash -c x', 'sh -c x',
    ];
    for (const k of construcoes) {
      const c = k.replace(/\\n/g, '\n');
      for (const [base, br] of [['git push origin main', 'feat/x'], ['gh pr merge 5 --squash', 'main'], ['vercel --prod', 'feat/x']]) {
        assert.equal(bash(`${base} ${c}`, br).publicar, false, `${base} ${c}`);
        assert.equal(bash(`${c} ; ${base}`, br).publicar, false, `${c} ; ${base}`);
        assert.equal(bash(`${base} && ${c}`, br).publicar, false, `${base} && ${c}`);
      }
    }
  });

  test('publicar-controles-positivos: 1 segmento só de caracteres da lista segue true', () => {
    assert.equal(bash('git push origin main').publicar, true);
    assert.equal(bash('npm test && git push origin main').publicar, false);
    assert.equal(bash('gh pr merge 5 --squash', 'main').publicar, true);
    assert.equal(bash('vercel --prod').publicar, true);
  });

  test('publicar-dt1-positivos', () => {
    for (const [cmd, br] of [['git push origin main', 'feat/x'], ['git push -u origin main', 'feat/x'], ['gh pr merge 5 --squash --delete-branch', 'main'], ['vercel --prod', 'feat/x'], ['vercel promote dpl_abc', 'feat/x']]) {
      assert.equal(bash(cmd, br).publicar, true, cmd);
    }
  });

  // Matriz GERADA: família (o que o leitor não vê inteiro, ou que muda o alvo) × forma (3 formas fechadas). Todas as células são false.
  const FORMAS: Array<[string, string]> = [['git push origin main', 'feat/x'], ['gh pr merge 5 --squash', 'main'], ['vercel --prod', 'feat/x']];
  const FAMILIAS: Array<[string, (b: string) => string[]]> = [
    ['crase', (b) => [`${b} \`echo x\``, `\`echo x\` ; ${b}`]],
    ['$(', (b) => [`${b} $(echo x)`, `$(echo x) ; ${b}`]],
    ['$X', (b) => [`${b} $X`, `X=--force ; ${b} $X`]],
    ['${X}', (b) => [`${b} \${X}`, `${b} x\${X}`]],
    ['"$X"', (b) => [`${b} "$X"`, `${b} "x"`]],
    ["'x'", (b) => [`${b} 'x'`, `${b} ''`, `${b} ""`]],
    ['<(', (b) => [`${b} <(echo x)`, `${b} >(cat)`]],
    ['\\eval', (b) => [`\\eval x ; ${b}`, `\\eval "${b}"`]],
    ["e''val", (b) => [`e''val x ; ${b}`, `ev""al x ; ${b}`]],
    ['export/declare/set -a/atribuição anterior', (b) => [`export A=1 ; ${b}`, `declare A=1 ; ${b}`, `set -a ; ${b}`, `A=1 ; ${b}`, `unset A ; ${b}`, `alias git=x ; ${b}`, `local A=1 ; ${b}`, `readonly A=1 ; ${b}`, `typeset A=1 ; ${b}`]],
    ['function f {}', (b) => [`function f { :; } ; ${b}`, `f(){ :; } ; ${b}`, `f() { git push --force; } ; ${b}`]],
    ['+HEAD:main', (b) => [`${b} +HEAD:main`, `${b} +x`, `X=+HEAD ; ${b} $X:main`]],
    ['&&', (b) => [`npm test && ${b}`, `${b} && npm test`, `${b} && ${b}`, `${b} || echo x`]],
    [';', (b) => [`${b} ; echo x`, `echo x ; ${b}`]],
    ['|', (b) => [`${b} | cat`, `echo x | ${b}`, `${b} & echo x`, `${b}\necho x`, `${b}\r`, `${b}\tfoo`]],
    ['glob', (b) => [`${b} *`, `${b} ?`, `${b} [a]`, `${b} m*`]],
    ['~', (b) => [`${b} ~`, `${b} ~/x`]],
    ['{a,b}', (b) => [`${b} {a,b}`, `${b} x{a,b}`]],
    ['não-ASCII', (b) => [`${b} é`, `${b} \u2011f`, `${b} \u00a0x`]],
    ['redirecionamento/heredoc', (b) => [`${b} > x`, `${b} < x`, `${b} <<EOF`, `${b} <<<x`, `${b} 2>&1`]],
    ['prefixo de comando', (b) => [`FOO=1 ${b}`, `env FOO=1 ${b}`, `sudo ${b}`, `nice ${b}`, `timeout 5 ${b}`, `nohup ${b}`, `time ${b}`, `command ${b}`, `exec ${b}`, `builtin ${b}`, `eval ${b}`, `source ${b}`, `. ${b}`, `xargs ${b}`, `sh -c ${b}`, `bash -c ${b}`]],
    ['caminho do binário', (b) => [`/usr/bin/${b}`, `./${b}`, `../outro/${b}`]],
  ];
  for (const [fam, gera] of FAMILIAS) {
    test(`publicar-matriz-portao: família ${fam} × 3 formas é false`, () => {
      for (const [base, br] of FORMAS) for (const cmd of gera(base)) assert.equal(bash(cmd, br).publicar, false, JSON.stringify(cmd));
    });
  }
  test('publicar-matriz-portao: tamanho gerado', () => {
    let n = 0;
    for (const [, gera] of FAMILIAS) for (const [base] of FORMAS) n += gera(base).length;
    assert.ok(n >= 240, `matriz com ${n} células`);
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

/**
 * Testes de gates/lib — o que antes existia em 8 cópias nos scripts.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  ehEntrypoint sem realpath      ⇒ `ehEntrypoint-symlink` falha
 *  M2  lerJson lançando em inválido   ⇒ `lerJson-invalido-undefined` falha
 *  M3  apagar o import de um script   ⇒ a suíte dele falha (entrypoint-guard / testes do script)
 *  M4  git show origin/HEAD:… (nome curto) ⇒ `permitidos-forjado-branch-homonima` falha
 *  M5  ler a árvore local em vez da ref   ⇒ `lerguarda-origin-vence` falha
 *  M6  preservar `permitidos` local       ⇒ `lerguarda-ausente-local-permitidos-vazio` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { lerJson, lerGuarda } from '../lib/config.mjs';
import { raizPorFs, inferirPbi, PADROES } from '../lib/git.mjs';
import { hojeISO, diasEntre } from '../lib/datas.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

describe('lib/cli', () => {
  test('arg-valor', () => {
    assert.equal(arg(['--root', '/x', '--json'], 'root'), '/x');
  });
  test('arg-ausente-fallback', () => {
    assert.equal(arg(['--json'], 'root'), undefined);
    assert.equal(arg(['--json'], 'max', 20), 20);
    assert.equal(arg(['--max'], 'max', 20), 20); // flag sem valor também cai no fallback
  });
  test('ehEntrypoint-symlink', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-lib-ep-'));
    const real = join(tmp, 'real.mjs');
    writeFileSync(
      real,
      `import { ehEntrypoint } from ${JSON.stringify(join(AQUI, '..', 'lib', 'cli.mjs'))};\n` +
        `process.stdout.write(ehEntrypoint(import.meta.url) ? 'SIM' : 'NAO');\n`,
    );
    const link = join(tmp, 'link.mjs');
    symlinkSync(real, link);
    const r = spawnSync(process.execPath, [link], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(r.stdout, 'SIM', `via symlink esperava SIM: ${r.stdout}${r.stderr}`);
  });
  test('ehEntrypoint-importado-false', () => {
    // este arquivo é o entrypoint do node --test filho, não o módulo consultado
    assert.equal(ehEntrypoint('file:///nao/e/o/entrypoint.mjs'), false);
  });
});

describe('lib/config', () => {
  test('lerJson-ausente-null', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-lib-cfg-'));
    assert.equal(lerJson(join(tmp, 'nao-existe.json')), null);
  });
  test('lerJson-invalido-undefined', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-lib-cfg-'));
    const f = join(tmp, 'ruim.json');
    writeFileSync(f, '{ nao é json');
    assert.equal(lerJson(f), undefined);
  });
  test('lerJson-valido-e-vazio', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-lib-cfg-'));
    writeFileSync(join(tmp, 'ok.json'), '{"a":1}');
    writeFileSync(join(tmp, 'vazio.json'), '  \n');
    assert.deepEqual(lerJson(join(tmp, 'ok.json')), { a: 1 });
    assert.deepEqual(lerJson(join(tmp, 'vazio.json')), {});
  });
});

describe('lib/git', () => {
  test('raizPorFs-worktree', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-lib-git-'));
    mkdirSync(join(tmp, 'sub', 'fundo'), { recursive: true });
    writeFileSync(join(tmp, '.git'), 'gitdir: /algum/lugar/.git/worktrees/wt\n'); // worktree: .git é ARQUIVO
    assert.equal(raizPorFs(join(tmp, 'sub', 'fundo')), tmp);
  });
  test('raizPorFs-fora-null', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-lib-git-'));
    // tmpdir do SO não está dentro de um repo; se estiver, o teste não prova nada
    const dentro = raizPorFs(tmp);
    assert.equal(dentro, null);
  });
  test('inferirPbi-wt', () => {
    assert.deepEqual(inferirPbi('wt/GM-9-3'), { pbi: 'GM-9', n: 3 });
    assert.deepEqual(inferirPbi('feat/GM-9-slug'), { pbi: 'GM-9', n: null });
    assert.equal(inferirPbi('main'), null);
  });
  test('PADROES é a fonte única: inclui refactor e é o que o cartão usa', async () => {
    assert.ok(PADROES.tiposComEscopoDePbi.includes('refactor'));
    const { DEFAULTS } = await import('../scripts/cartao-sessao.mjs');
    assert.equal(DEFAULTS.versionamento.tiposComEscopoDePbi, PADROES.tiposComEscopoDePbi);
    assert.equal(DEFAULTS.fluxo.idPadrao, PADROES.idPadrao);
  });
});

describe('lib/datas', () => {
  test('hojeISO é a data LOCAL, não UTC', () => {
    const d = new Date(2026, 10, 2, 23, 30); // 2 nov 2026 23:30 local
    assert.equal(hojeISO(d), '2026-11-02');
  });
  test('diasEntre', () => {
    assert.equal(diasEntre('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z'), 2);
    assert.ok(Number.isNaN(diasEntre('lixo', '2026-11-03')));
  });
});

describe('lib/config lerGuarda', () => {
  const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const novo = () => {
    const d = mkdtempSync(join(tmpdir(), 'gm-guarda-'));
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'user.email', 't@t');
    sh(d, 'config', 'user.name', 't');
    sh(d, 'config', 'commit.gpgsign', 'false');
    return d;
  };
  /** Repo com um commit (config `origin` ou só x.txt); `refs/remotes/origin/HEAD` → esse commit; `local` sobrescreve a árvore. */
  function repo({ origin, local }) {
    const d = novo();
    if (origin !== undefined) writeFileSync(join(d, 'harness.config.json'), JSON.stringify(origin));
    else writeFileSync(join(d, 'x.txt'), 'x');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-qm', 'base');
    sh(d, 'update-ref', 'refs/remotes/origin/main', sh(d, 'rev-parse', 'HEAD'));
    sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    if (local !== undefined) writeFileSync(join(d, 'harness.config.json'), JSON.stringify(local));
    return d;
  }
  const cfg = (permitidos, branchPadrao = 'main') => ({
    versionamento: { branchPadrao },
    guarda: { producao: { permitidos }, ambientes: { prod: { hosts: ['db.alvo.test'] } } },
  });

  test('lerguarda-origin-vence', () => {
    const d = repo({ origin: cfg(['vercel ls *']), local: cfg(['*']) });
    const g = lerGuarda(d);
    assert.equal(g.fonte, 'origin');
    assert.deepEqual(g.config.producao.permitidos, ['vercel ls *']);
    assert.deepEqual(g.config.ambientes.prod.hosts, ['db.alvo.test']);
  });

  test('permitidos-forjado-branch-homonima', () => {
    const d = repo({ origin: cfg([]) });
    // subagent forja: branch homônima `origin/HEAD` num commit com permitidos "*"
    writeFileSync(join(d, 'harness.config.json'), JSON.stringify(cfg(['*'], 'forjada')));
    sh(d, 'add', '-A');
    sh(d, 'commit', '-qm', 'forja');
    sh(d, 'branch', 'origin/HEAD', 'HEAD');
    // premissa medida (Q4): o nome curto resolve para a branch forjada
    assert.equal(sh(d, 'rev-parse', 'origin/HEAD'), sh(d, 'rev-parse', 'HEAD'));
    const g = lerGuarda(d);
    assert.equal(g.fonte, 'origin');
    assert.deepEqual(g.config.producao.permitidos, []);
    assert.equal(g.branchPadrao, 'main');
  });

  test('lerguarda-ausente-local-permitidos-vazio', () => {
    // sem origin/HEAD
    const d = novo();
    writeFileSync(join(d, 'harness.config.json'), JSON.stringify(cfg(['*'])));
    const g = lerGuarda(d);
    assert.equal(g.fonte, 'local');
    assert.deepEqual(g.config.producao.permitidos, []);
    assert.deepEqual(g.config.ambientes.prod.hosts, ['db.alvo.test']);
    assert.equal(g.divergente, false);
    // origin/HEAD existe, mas o arquivo não existe na ref
    const g2 = lerGuarda(repo({ origin: undefined, local: cfg(['*']) }));
    assert.equal(g2.fonte, 'local');
    assert.deepEqual(g2.config.producao.permitidos, []);
    // nada em lugar nenhum
    assert.deepEqual(lerGuarda(novo()), { config: null, fonte: 'local', divergente: false, branchPadrao: null });
  });

  test('lerguarda-branchpadrao-da-ref', () => {
    const g = lerGuarda(repo({ origin: cfg([], 'trunk'), local: cfg([], 'forjada') }));
    assert.equal(g.branchPadrao, 'trunk');
    assert.deepEqual(g.config.ambientes.prod.branches, ['trunk']); // default = branchPadrao da MESMA ref
  });

  test('lerguarda-divergente', () => {
    assert.equal(lerGuarda(repo({ origin: cfg(['a']), local: cfg(['a']) })).divergente, false);
    assert.equal(lerGuarda(repo({ origin: cfg(['a']), local: cfg(['a', 'b']) })).divergente, true);
  });
});

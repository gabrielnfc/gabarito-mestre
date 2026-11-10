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
 * GM-11 T1:
 *  M-C1 lerConfigOrigin com `git show origin/HEAD:…` (nome curto) ⇒ `config-origin-homonima-forjada` falha
 *  M-C2 lerConfigOrigin aceitar JSON array ⇒ `config-origin-ausente-x-invalida` falha
 *  M-C3 lerConfigOrigin com JSON ilegível virando config vazia ⇒ `config-origin-ausente-x-invalida` falha
 *  M-C4 sem origin, cair na árvore local como `fonte: 'origin'` ⇒ `config-origin-sem-origin-ignora-local` falha
 *  M-C5..M-C12 (r3) cair no local/HEAD/índice com origin ausente ou corrompido, ou mesclar o local sob origin válido ⇒ `config-origin-nunca-le-local-matriz` falha
 *  (o `try` externo de lerConfigOrigin é defesa em profundidade: lerRawOrigin nunca lança, tirá-lo é mutante equivalente)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { lerJson, lerGuarda, lerConfigOrigin, MODELOS_PADRAO, ORDEM_MODELO, PERFIS_MODELO, resolverModelo } from '../lib/config.mjs';
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
    assert.deepEqual(g.config.permitidos, ['vercel ls *']);
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
    assert.deepEqual(g.config.permitidos, []);
    assert.equal(g.branchPadrao, 'main');
  });

  test('lerguarda-ausente-local-permitidos-vazio', () => {
    // sem origin/HEAD
    const d = novo();
    writeFileSync(join(d, 'harness.config.json'), JSON.stringify(cfg(['*'])));
    const g = lerGuarda(d);
    assert.equal(g.fonte, 'local');
    assert.deepEqual(g.config.permitidos, []);
    assert.deepEqual(g.config.ambientes.prod.hosts, ['db.alvo.test']);
    assert.equal(g.divergente, false);
    // origin/HEAD existe, mas o arquivo não existe na ref
    const g2 = lerGuarda(repo({ origin: undefined, local: cfg(['*']) }));
    assert.equal(g2.fonte, 'local');
    assert.deepEqual(g2.config.permitidos, []);
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

describe('lib/config lerGuarda — forja', () => {
  const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const novo = () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'gm-guarda-')));
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'user.email', 't@t');
    sh(d, 'config', 'user.name', 't');
    sh(d, 'config', 'commit.gpgsign', 'false');
    return d;
  };
  const cfg = (permitidos, bp = 'main') => ({
    versionamento: { branchPadrao: bp },
    guarda: { producao: { permitidos }, ambientes: { prod: { hosts: ['db.alvo.test'] } } },
  });
  const grava = (d, obj) => writeFileSync(join(d, 'harness.config.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
  const commita = (d, msg) => {
    sh(d, 'add', '-A');
    sh(d, 'commit', '-qm', msg);
    return sh(d, 'rev-parse', 'HEAD');
  };
  /** origin real (symref → origin/main) com `origin`; devolve o repo e o SHA real. */
  function comOrigin(origin) {
    const d = novo();
    grava(d, origin);
    const base = commita(d, 'base');
    sh(d, 'update-ref', 'refs/remotes/origin/main', base);
    sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    return { d, base };
  }
  const forja = (d) => {
    grava(d, cfg(['*'], 'forjada'));
    return commita(d, 'forja');
  };
  const vazio = (g) => {
    assert.equal(g.fonte, 'local');
    assert.deepEqual(g.config.permitidos, []);
  };

  test('lerguarda-branch-nome-longo-sem-head', () => {
    const { d } = comOrigin(cfg([]));
    sh(d, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'); // remoto buscado, sem HEAD
    forja(d);
    sh(d, 'branch', 'refs/remotes/origin/HEAD', 'HEAD'); // vira refs/heads/refs/remotes/origin/HEAD
    vazio(lerGuarda(d));
  });

  test('lerguarda-tag-nome-longo-sem-head', () => {
    const { d } = comOrigin(cfg([]));
    sh(d, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    forja(d);
    sh(d, 'tag', 'refs/remotes/origin/HEAD', 'HEAD');
    vazio(lerGuarda(d));
  });

  test('lerguarda-symref-pendurado', () => {
    const { d } = comOrigin(cfg([]));
    sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/naoexiste');
    forja(d);
    sh(d, 'branch', 'refs/remotes/origin/HEAD', 'HEAD');
    vazio(lerGuarda(d));
  });

  test('lerguarda-replace-blob', () => {
    const { d } = comOrigin(cfg([]));
    const blobReal = sh(d, 'rev-parse', 'refs/remotes/origin/HEAD:harness.config.json');
    const blobForjado = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: d, input: JSON.stringify(cfg(['*'])), encoding: 'utf8' }).trim();
    sh(d, 'replace', blobReal, blobForjado);
    assert.deepEqual(JSON.parse(sh(d, 'show', 'refs/remotes/origin/HEAD:harness.config.json')).guarda.producao.permitidos, ['*']); // a forja funciona no git puro
    const g = lerGuarda(d);
    assert.equal(g.fonte, 'origin');
    assert.deepEqual(g.config.permitidos, []);
  });

  test('lerguarda-replace-commit', () => {
    const { d, base } = comOrigin(cfg([]));
    const f = forja(d);
    sh(d, 'replace', base, f);
    const g = lerGuarda(d);
    assert.equal(g.fonte, 'origin');
    assert.deepEqual(g.config.permitidos, []);
    assert.equal(g.branchPadrao, 'main');
  });

  test('lerguarda-git-dir-no-ambiente', () => {
    const { d } = comOrigin(cfg(['real']));
    const outro = novo();
    grava(outro, cfg(['*'], 'forjada'));
    commita(outro, 'forja');
    sh(outro, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    sh(outro, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const antes = { ...process.env };
    process.env.GIT_DIR = join(outro, '.git');
    process.env.GIT_WORK_TREE = outro;
    process.env.GIT_OBJECT_DIRECTORY = join(outro, '.git', 'objects');
    try {
      const g = lerGuarda(d);
      assert.equal(g.fonte, 'origin');
      assert.deepEqual(g.config.permitidos, ['real']);
      assert.equal(g.branchPadrao, 'main');
    } finally {
      for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY']) {
        if (antes[k] === undefined) delete process.env[k];
        else process.env[k] = antes[k];
      }
    }
  });

  test('lerguarda-forma-config-guarda', () => {
    const { d } = comOrigin(cfg(['a *']));
    const g = lerGuarda(d);
    assert.deepEqual(Object.keys(g.config).sort(), ['ambientes', 'permitidos']); // ConfigGuarda (src/tipos.ts)
    assert.ok(Array.isArray(g.config.permitidos) && g.config.permitidos.every((p) => typeof p === 'string'));
    assert.equal(g.config.producao, undefined);
    // fonte local: `permitidos` zerado em QUALQUER aninhamento
    const l = novo();
    grava(l, { guarda: { permitidos: ['*'], producao: { permitidos: ['*'] }, ambientes: { prod: { permitidos: ['*'], hosts: ['db.alvo.test'] } } } });
    const gl = lerGuarda(l);
    vazio(gl);
    assert.ok(!JSON.stringify(gl.config).includes('"*"'));
    assert.deepEqual(gl.config.ambientes.prod.hosts, ['db.alvo.test']);
  });

  test('lerguarda-json-invalido-na-ref', () => {
    const { d } = comOrigin('{ isto nao e json');
    grava(d, cfg(['*']));
    const g = lerGuarda(d);
    vazio(g);
    assert.deepEqual(g.config.ambientes.prod.hosts, ['db.alvo.test']); // veio do local, sem permitidos
  });

  test('lerguarda-divergente-ambientes', () => {
    const a = cfg(['x']);
    const b = cfg(['x']);
    b.guarda.ambientes.prod.hosts = ['outro.alvo.test'];
    const { d } = comOrigin(a);
    grava(d, b);
    assert.equal(lerGuarda(d).divergente, true);
    grava(d, a);
    assert.equal(lerGuarda(d).divergente, false);
  });

  test('lerguarda-custo', () => {
    const { d } = comOrigin(cfg([]));
    const t = [];
    for (let i = 0; i < 20; i++) {
      const t0 = process.hrtime.bigint();
      lerGuarda(d);
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    t.sort((x, y) => x - y);
    assert.ok(t[19] < 500, `p95 ${t[18]}ms`); // sanidade; o número vai no relatório
  });
});

describe('lib/config lerConfigOrigin (GM-11 T1)', () => {
  const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const novo = () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'gm-cfgorigin-')));
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, 'config', 'user.email', 't@t');
    sh(d, 'config', 'user.name', 't');
    sh(d, 'config', 'commit.gpgsign', 'false');
    return d;
  };
  /** `conteudo` (texto cru) vira o `harness.config.json` do commit apontado por `refs/remotes/origin/HEAD`; `undefined` = o arquivo não existe na ref. */
  function repo(conteudo, local) {
    const d = novo();
    if (conteudo !== undefined) writeFileSync(join(d, 'harness.config.json'), conteudo);
    else writeFileSync(join(d, 'x.txt'), 'x');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-qm', 'base');
    sh(d, 'update-ref', 'refs/remotes/origin/main', sh(d, 'rev-parse', 'HEAD'));
    sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    if (local !== undefined) writeFileSync(join(d, 'harness.config.json'), local);
    return d;
  }

  test('config-origin-ausente-x-invalida: sem remoto, sem arquivo na ref, blob não JSON, array e escalar dão nenhuma, com motivos distintos; nunca lança', () => {
    const semRemoto = lerConfigOrigin(novo());
    assert.deepEqual([semRemoto.cfg, semRemoto.fonte], [null, 'nenhuma']);
    const semArquivo = lerConfigOrigin(repo(undefined));
    assert.deepEqual([semArquivo.cfg, semArquivo.fonte], [null, 'nenhuma']);
    const invalidos = ['{"entrega":', 'não é json', '[1,2]', '[]', 'null', '"texto"', '42', 'true', ''].map((t) => lerConfigOrigin(repo(t)));
    for (const r of invalidos) assert.deepEqual([r.cfg, r.fonte], [null, 'nenhuma']);
    // `invalida`: ausente (sem remoto, sem arquivo na ref) = false; corrompido (JSON ilegível, array, escalar, vazio) = true
    assert.equal(semRemoto.invalida, false);
    assert.equal(semArquivo.invalida, false);
    for (const r of invalidos) assert.equal(r.invalida, true);
    // ausente e corrompido não são a mesma coisa
    assert.notEqual(semRemoto.motivo, invalidos[0].motivo);
    assert.notEqual(semArquivo.motivo, invalidos[0].motivo);
    assert.notEqual(semRemoto.motivo, semArquivo.motivo);
    for (const r of [semRemoto, semArquivo, ...invalidos]) assert.match(r.motivo, /\S/);
    // entrada que não é diretório: não lança
    for (const raiz of ['/caminho/que/nao/existe/gm-cfgorigin', '', undefined, null, 5, {}]) {
      let r;
      assert.doesNotThrow(() => { r = lerConfigOrigin(raiz); }, String(raiz));
      assert.deepEqual([r.cfg, r.fonte, r.invalida], [null, 'nenhuma', false]);
    }
  });

  test('config-origin-raiz-nao-string-ignora-cwd: raiz undefined/null/vazia/número/objeto nunca lê o origin/HEAD do cwd do processo (o teste não depende do checkout que o roda)', () => {
    // cwd do processo = repo de teste COM origin/HEAD e config válida: se a raiz inválida caísse no cwd, viria `fonte: 'origin'`
    const cwd = repo(JSON.stringify({ entrega: { politica: 'continua' } }));
    const script = `import { lerConfigOrigin } from ${JSON.stringify(join(AQUI, '..', 'lib', 'config.mjs'))};
      const r = [undefined, null, '', 5, {}].map((x) => { const o = lerConfigOrigin(x); return [o.cfg, o.fonte, o.invalida]; });
      process.stdout.write(JSON.stringify(r));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', timeout: 15_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [[null, 'nenhuma', false], [null, 'nenhuma', false], [null, 'nenhuma', false], [null, 'nenhuma', false], [null, 'nenhuma', false]]);
    // controle: a mesma chamada com a raiz do repo lê a ref (o repo de teste não é vazio por engano)
    assert.equal(lerConfigOrigin(cwd).fonte, 'origin');
  });

  test('config-origin-sem-origin-ignora-local:com harness.config.json local presente, sem origin nunca lê a árvore local (sem remoto, sem arquivo na ref, symref pendurado)', () => {
    const local = JSON.stringify({ entrega: { politica: 'continua', comandos: { deploy: 'rm -rf x' } } });
    const semRemoto = novo();
    writeFileSync(join(semRemoto, 'harness.config.json'), local);
    const semArquivo = repo(undefined, local);
    const pendurado = novo();
    writeFileSync(join(pendurado, 'x.txt'), 'x');
    writeFileSync(join(pendurado, 'harness.config.json'), local);
    sh(pendurado, 'add', '-A');
    sh(pendurado, 'commit', '-qm', 'base');
    sh(pendurado, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/inexistente');
    for (const d of [semRemoto, semArquivo, pendurado]) {
      assert.ok(JSON.parse(readFileSync(join(d, 'harness.config.json'), 'utf8')).entrega, 'premissa: o arquivo local existe');
      const r = lerConfigOrigin(d);
      assert.deepEqual([r.cfg, r.fonte, r.invalida], [null, 'nenhuma', false]);
    }
  });

  test('config-origin-nunca-le-local-matriz: origin {sem remoto, symref pendurado, sem arquivo, corrompido, válido} x local bom na árvore, no índice e num commit novo em HEAD; só origin conta', () => {
    const L = { entrega: { politica: 'continua', comandos: { deploy: 'x' } }, sombra: { julga_emendas: true } };
    const textoL = JSON.stringify(L);
    /** Commit antigo (apontado por origin, se houver) e depois um commit NOVO em HEAD com L; a árvore e o índice ficam com L. */
    function celula(estado) {
      const d = novo();
      let comOrigin = true;
      if (estado.tipo === 'sem-remoto') comOrigin = false;
      else {
        if (estado.conteudo !== undefined) writeFileSync(join(d, 'harness.config.json'), estado.conteudo);
        else writeFileSync(join(d, 'x.txt'), 'x');
        sh(d, 'add', '-A');
        sh(d, 'commit', '-qm', 'origin');
        if (estado.tipo === 'pendurado') sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/inexistente');
        else {
          sh(d, 'update-ref', 'refs/remotes/origin/main', sh(d, 'rev-parse', 'HEAD'));
          sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
        }
      }
      writeFileSync(join(d, 'harness.config.json'), textoL);
      sh(d, 'add', '-A');
      sh(d, 'commit', '-qm', 'local novo');
      // premissas: o local bom está na árvore, no índice e em HEAD, e é diferente do que origin aponta
      assert.deepEqual(JSON.parse(readFileSync(join(d, 'harness.config.json'), 'utf8')), L, 'premissa: árvore parseia como L');
      assert.deepEqual(JSON.parse(sh(d, 'show', ':harness.config.json')), L, 'premissa: índice parseia como L');
      assert.deepEqual(JSON.parse(sh(d, 'show', 'HEAD:harness.config.json')), L, 'premissa: HEAD parseia como L');
      if (comOrigin && estado.tipo !== 'pendurado') {
        assert.notEqual(sh(d, 'rev-parse', 'HEAD'), sh(d, 'rev-parse', 'refs/remotes/origin/HEAD'), 'premissa: HEAD é um commit novo, depois de origin');
      }
      return d;
    }
    const linhas = [
      { nome: 'sem remoto', tipo: 'sem-remoto', ausente: true },
      { nome: 'symref pendurado', tipo: 'pendurado', conteudo: undefined, ausente: true },
      { nome: 'ref sem o arquivo', tipo: 'ref', conteudo: undefined, ausente: true },
      ...['{"entrega":', 'não é json', '[1,2]', '[]', 'null', '"texto"', '42', 'true', ''].map((t) => ({ nome: `corrompido ${JSON.stringify(t)}`, tipo: 'ref', conteudo: t, ausente: false })),
      { nome: 'válido {}', tipo: 'ref', conteudo: '{}', valido: {} },
      { nome: 'válido sem entrega', tipo: 'ref', conteudo: '{"sombra":{"teto":9}}', valido: { sombra: { teto: 9 } } },
    ];
    for (const linha of linhas) {
      const r = lerConfigOrigin(celula(linha));
      if (linha.valido) {
        assert.equal(r.fonte, 'origin', linha.nome);
        assert.deepEqual(r.cfg, linha.valido, `${linha.nome}: cfg é só o JSON de origin`);
        assert.equal(r.invalida, false, linha.nome);
        assert.equal(r.motivo, null, linha.nome);
        assert.equal(r.cfg.entrega, undefined, `${linha.nome}: nenhuma chave de L (entrega)`);
        assert.equal(r.cfg.sombra?.julga_emendas, undefined, `${linha.nome}: nenhuma chave de L (julga_emendas)`);
      } else {
        assert.deepEqual([r.cfg, r.fonte, r.invalida], [null, 'nenhuma', !linha.ausente], linha.nome);
        assert.match(r.motivo, /\S/, linha.nome);
      }
    }
  });

  test('config-origin-le-a-ref: objeto da ref vence a árvore local e traz o motivo nulo', () => {
    const d = repo(JSON.stringify({ entrega: { politica: 'continua' }, sombra: { teto: 9 } }), JSON.stringify({ entrega: { politica: 'janela' } }));
    const r = lerConfigOrigin(d);
    assert.equal(r.fonte, 'origin');
    assert.equal(r.motivo, null);
    assert.equal(r.invalida, false);
    assert.deepEqual(r.cfg, { entrega: { politica: 'continua' }, sombra: { teto: 9 } });
    assert.deepEqual(lerConfigOrigin(repo('{}')).cfg, {}, 'objeto vazio é config válida');
  });

  test('config-origin-homonima-forjada: branch `origin/HEAD` forjada não vale; vale a ref completa (mesma resolução de lerGuarda)', () => {
    const d = repo(JSON.stringify({ entrega: { politica: 'sob_demanda' } }));
    writeFileSync(join(d, 'harness.config.json'), JSON.stringify({ entrega: { politica: 'continua' } }));
    sh(d, 'add', '-A');
    sh(d, 'commit', '-qm', 'forja');
    sh(d, 'branch', 'origin/HEAD', 'HEAD');
    assert.equal(sh(d, 'rev-parse', 'origin/HEAD'), sh(d, 'rev-parse', 'HEAD'), 'premissa: o nome curto resolve para a branch forjada');
    const r = lerConfigOrigin(d);
    assert.equal(r.fonte, 'origin');
    assert.deepEqual(r.cfg, { entrega: { politica: 'sob_demanda' } });
    // e é a mesma ref que lerGuarda lê
    assert.equal(lerGuarda(d).fonte, 'origin');
  });

  test('config-origin-symref-pendurado: origin/HEAD apontando para ref inexistente dá nenhuma', () => {
    const d = novo();
    writeFileSync(join(d, 'x.txt'), 'x');
    sh(d, 'add', '-A');
    sh(d, 'commit', '-qm', 'base');
    sh(d, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/inexistente');
    const r = lerConfigOrigin(d);
    assert.deepEqual([r.cfg, r.fonte, r.invalida], [null, 'nenhuma', false]);
  });

  test('modelos-padrao-e-ordem: perfil por papel e ordem haiku < sonnet < opus < fable', () => {
    assert.deepEqual(MODELOS_PADRAO, {
      implementador: { modelo: 'sonnet', esforco: 'high' }, revisor: { modelo: 'opus' }, sombra: { modelo: 'opus' },
      revisor_final: { modelo: 'fable' }, spike: { modelo: 'opus' }, basico: { modelo: 'haiku' },
    });
    assert.deepEqual(ORDEM_MODELO, { haiku: 0, sonnet: 1, opus: 2, fable: 3 });
    assert.equal(Object.isFrozen(MODELOS_PADRAO) && Object.isFrozen(ORDEM_MODELO), true);
    for (const p of Object.values(MODELOS_PADRAO)) assert.equal(Object.isFrozen(p), true);
  });
});

describe('T4b perfis de modelo (E5a, Sombra r3): PERFIS_MODELO e resolverModelo', () => {
  const PAPEIS = ['implementador', 'revisor', 'sombra', 'revisor_final', 'spike', 'basico'];

  test('perfis-tabelas: economia, padrao (= MODELOS_PADRAO) e qualidade, congeladas, com os valores da Sombra r3', () => {
    assert.deepEqual(PERFIS_MODELO.economia, {
      implementador: { modelo: 'sonnet', esforco: 'medium' }, revisor: { modelo: 'sonnet' }, sombra: { modelo: 'opus' },
      revisor_final: { modelo: 'opus' }, spike: { modelo: 'sonnet' }, basico: { modelo: 'haiku' },
    });
    assert.equal(PERFIS_MODELO.padrao, MODELOS_PADRAO);
    assert.deepEqual(PERFIS_MODELO.qualidade, {
      implementador: { modelo: 'opus', esforco: 'high' }, revisor: { modelo: 'opus' }, sombra: { modelo: 'opus' },
      revisor_final: { modelo: 'fable' }, spike: { modelo: 'opus' }, basico: { modelo: 'sonnet' },
    });
    assert.deepEqual(Object.keys(PERFIS_MODELO), ['economia', 'padrao', 'qualidade']);
    for (const t of Object.values(PERFIS_MODELO)) {
      assert.equal(Object.isFrozen(t), true);
      for (const v of Object.values(t)) assert.equal(Object.isFrozen(v), true);
    }
  });

  test('economia-revisor-final-opus: Fable só no review final, e só em qualidade/padrao; economia resolve cada papel pela tabela', () => {
    assert.deepEqual(resolverModelo({ perfil: 'economia' }, 'revisor_final'), { modelo: 'opus', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'economia' }, 'implementador'), { modelo: 'sonnet', esforco: 'medium', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'economia' }, 'revisor'), { modelo: 'sonnet', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'economia' }, 'spike'), { modelo: 'sonnet', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'economia' }, 'sombra'), { modelo: 'opus', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'economia' }, 'basico'), { modelo: 'haiku', fonte: 'perfil' });
    for (const perfil of ['economia', 'padrao', 'qualidade']) {
      for (const papel of PAPEIS) {
        const fable = resolverModelo({ perfil }, papel).modelo === 'fable';
        assert.equal(fable, papel === 'revisor_final' && perfil !== 'economia', `${perfil}/${papel}`);
      }
    }
  });

  test('qualidade-basico-sonnet: qualidade resolve cada papel pela tabela', () => {
    assert.deepEqual(resolverModelo({ perfil: 'qualidade' }, 'basico'), { modelo: 'sonnet', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'qualidade' }, 'implementador'), { modelo: 'opus', esforco: 'high', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'qualidade' }, 'revisor_final'), { modelo: 'fable', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'qualidade' }, 'spike'), { modelo: 'opus', fonte: 'perfil' });
  });

  test('explicito-vence-perfil: orquestracao.modelos.<papel> ganha da tabela; os outros papéis seguem o perfil; família normalizada', () => {
    const o = { perfil: 'economia', modelos: { revisor: 'opus', implementador: { modelo: 'Claude-Haiku-5-5', esforco: 'low' } } };
    assert.deepEqual(resolverModelo(o, 'revisor'), { modelo: 'opus', fonte: 'explicito' });
    assert.deepEqual(resolverModelo(o, 'implementador'), { modelo: 'haiku', esforco: 'low', fonte: 'explicito' });
    assert.deepEqual(resolverModelo(o, 'spike'), { modelo: 'sonnet', fonte: 'perfil' });
    assert.deepEqual(resolverModelo({ perfil: 'qualidade', modelos: { revisor_final: 'sonnet' } }, 'revisor_final'), { modelo: 'sonnet', fonte: 'explicito' });
  });

  test('explicito-torto-cai-no-perfil-com-aviso: entrada que não se entende vale o perfil (não o padrão) e avisa', () => {
    for (const e of ['gpt-4', 42, { esforco: 'low' }, null, ['x']]) {
      const r = resolverModelo({ perfil: 'economia', modelos: { revisor: e } }, 'revisor');
      assert.deepEqual([r.modelo, r.fonte], ['sonnet', 'perfil'], JSON.stringify(e));
      assert.match(r.aviso, /orquestracao\.modelos\.revisor .*usei o do perfil economia \(sonnet\)/, JSON.stringify(e));
    }
    const r = resolverModelo({ modelos: ['x'] }, 'revisor');
    assert.deepEqual([r.modelo, r.fonte], ['opus', 'padrao']);
    assert.match(r.aviso, /orquestracao\.modelos inválido \(não é um objeto\); usei o padrão opus/);
  });

  test('perfil-ausente-padrao: sem orquestracao, sem perfil ou perfil padrao ⇒ MODELOS_PADRAO, sem aviso', () => {
    for (const o of [undefined, {}, { modelos: {} }, { perfil: 'padrao' }]) {
      for (const papel of PAPEIS) {
        const r = resolverModelo(o, papel);
        assert.deepEqual(r, { ...MODELOS_PADRAO[papel], fonte: 'padrao' }, `${JSON.stringify(o)}/${papel}`);
        assert.equal('aviso' in r, false);
      }
    }
  });

  test('perfil-invalido-aviso: inválido (≠ ausente) vale o padrão e avisa; orquestracao que não é objeto também', () => {
    for (const perfil of ['luxo', '', 'Economia', 7, null, ['economia'], {}]) {
      const r = resolverModelo({ perfil }, 'revisor_final');
      assert.deepEqual([r.modelo, r.fonte], ['fable', 'padrao'], JSON.stringify(perfil));
      assert.match(r.aviso, /orquestracao\.perfil inválido .*economia, padrao ou qualidade; usei o padrão fable/, JSON.stringify(perfil));
    }
    for (const o of [null, 'x', 7, ['a']]) {
      const r = resolverModelo(o, 'implementador');
      assert.deepEqual([r.modelo, r.esforco, r.fonte], ['sonnet', 'high', 'padrao']);
      assert.match(r.aviso, /`orquestracao` em harness\.config\.json não é um objeto/);
    }
    // perfil inválido + explícito válido: aviso completo (sem "usei " solto), modelo explícito vale
    const t = resolverModelo({ perfil: 'xyz', modelos: { revisor: 'opus' } }, 'revisor');
    assert.deepEqual([t.modelo, t.fonte], ['opus', 'explicito']);
    assert.equal(t.aviso, 'orquestracao.perfil inválido ("xyz"): esperado economia, padrao ou qualidade; usei o explícito opus');
    // perfil inválido não impede o explícito de valer
    assert.deepEqual(resolverModelo({ perfil: 'luxo', modelos: { revisor: 'haiku' } }, 'revisor').modelo, 'haiku');
  });

  test('resolver-papel-desconhecido-lanca: papel fora da tabela não vira padrão calado', () => {
    assert.throws(() => resolverModelo({}, 'correcao'), /papel desconhecido/);
    assert.throws(() => resolverModelo({}, 'toString'), /papel desconhecido/);
  });
});

/** Testes do harness-doctor — T6 R1. Cabeçalho (mutações prescritas) e helpers em _doctor-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../scripts/harness-doctor.mjs';
import * as doctor from '../scripts/harness-doctor.mjs';
import { repo, agents, hoje, SCRIPT, ok, fixtureNivel2_110, git, repoComGit, camada, resumo } from './_doctor-helpers.mjs';

describe('T6 doctor — R1: arquivo ignorado/apagado não é evidência em NENHUM leitor (config, atestado, AGENTS.md, CHANGELOG, ci.yml, .gitignore, .env.example)', () => {
  // `.env.example` só muda o veredito quando tem segredo preenchido (visível ⇒ FALTA; ausente ⇒ sem exemplo, ok)
  const fx = (f) => (f === '.env.example' ? { ...fixtureNivel2_110(2, { perfil: 'repo-sem-app' }), '.env.example': 'API_TOKEN=preenchido\n' } : fixtureNivel2_110(2, { perfil: 'repo-sem-app' }));
  const ARQUIVOS = ['harness.config.json', '.harness/attest.json', 'AGENTS.md', 'CHANGELOG.md', '.github/workflows/ci.yml', '.gitignore', '.env.example'];
  const sem = (arquivos, f) => Object.fromEntries(Object.entries(arquivos).filter(([k]) => k !== f));
  const MODOS = {
    'gitignore': (dir, f) => writeFileSync(join(dir, '.gitignore'), `${readFileSync(join(dir, '.gitignore'), 'utf8')}${f}\n`),
    'info/exclude': (dir, f) => writeFileSync(join(dir, '.git', 'info', 'exclude'), `${f}\n`),
    'core.excludesFile': (dir, f) => {
      const ex = join(mkdtempSync(join(tmpdir(), 'doctor-exfile-')), 'ignore');
      writeFileSync(ex, `${f}\n`);
      git(dir, 'config', 'core.excludesFile', ex);
    },
    'rastreado e apagado do disco': (dir, f) => {
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'chore: tudo');
      unlinkSync(join(dir, f));
    },
  };
  for (const f of ARQUIVOS) {
    for (const [modo, aplica] of Object.entries(MODOS)) {
      if (f === '.gitignore' && modo === 'gitignore') continue;
      test(`doctor-ignorado-vale-ausente: ${f} via ${modo} ⇒ o doctor mede como se o arquivo não existisse (o clone do commit)`, () => {
        const dir = repoComGit(fx(f));
        aplica(dir, f);
        const ausente = repoComGit(sem(fx(f), f));
        assert.equal(resumo(run(dir)), resumo(run(ausente)));
      });
    }
  }

  test('doctor-ignorado-vale-ausente: o controle muda o resultado (arquivo visível ≠ ausente), então a igualdade acima não é vacuidade', () => {
    for (const f of ARQUIVOS) {
      assert.notEqual(resumo(run(repoComGit(fx(f)))), resumo(run(repoComGit(sem(fx(f), f)))), f);
    }
  });

  test('doctor-config-ignorada-perfil: harness.config.json ignorado com perfil repo-sem-app ⇒ nível 0 e perfil null (o clone vê isto)', () => {
    const base = { 'AGENTS.md': agents(0), 'src/db.ts': 'assertNotProduction();', '.env.example': 'X=1\n', '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok }) };
    const cfg = JSON.stringify({ perfil: 'repo-sem-app' });
    const visivel = run(repoComGit({ ...base, '.gitignore': '.env\n', 'harness.config.json': cfg }));
    assert.equal(visivel.alcancado, 1, 'controle: a config visível vale');
    const ign = run(repoComGit({ ...base, '.gitignore': '.env\nharness.config.json\n', 'harness.config.json': cfg }));
    assert.equal(ign.alcancado, 0);
    assert.equal(ign.perfil, null);
    assert.equal(ign.configInvalido, false, 'ignorado é ausente, não inválido');
  });

  test('doctor-config-ignorada-perfil: config ignorada com attestFile redirecionado não move o atestado de lugar', () => {
    const arquivos = { 'AGENTS.md': agents(0), '.gitignore': '.env\nharness.config.json\n', 'src/db.ts': 'assertNotProduction();', '.env.example': 'X=1\n', 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app', attestFile: 'docs/a.json' }), 'docs/a.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok }) };
    assert.equal(run(repoComGit(arquivos)).alcancado, 0);
  });

  test('doctor-config-ignorada-perfil: repo sem nenhum commit também ignora a config ignorada', () => {
    const dir = repo({ 'AGENTS.md': agents(0), '.gitignore': 'harness.config.json\n', 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }) });
    git(dir, 'init', '-q');
    assert.equal(run(dir).perfil, null);
  });

  test('doctor-config-ignorada-perfil: fora de git o disco é a verdade (não há o que ignorar)', () => {
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }) })).perfil, 'repo-sem-app');
  });

  test('doctor-git-ilegivel: git presente mas ls-files falha ⇒ NADA vale como evidência (não reabre o disco)', () => {
    const dir = repoComGit(fx('AGENTS.md'));
    writeFileSync(join(dir, '.git', 'index'), 'lixo que não é um índice');
    assert.throws(() => git(dir, 'ls-files'), /index|signature|fatal/i, 'premissa: o git de fato falha');
    const out = run(dir);
    assert.equal(out.semAgents, false, 'o arquivo existe: git ilegível não é arquivo ausente');
    assert.equal(out.gitIlegivel, true);
    assert.equal(out.perfil, null);
    assert.equal(out.alcancado, 0);
    assert.equal(out.resultados.find((r) => r.id === 'branch-protegida').found, false);
  });

  // R2-1: git ilegível não desliga o gate do nível declarado. A declaração vem do disco (não é evidência: só pode endurecer).
  const cli = (dir, env = {}) => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  const dirIlegivel = (como, nivel = 3) => {
    const dir = repoComGit({ 'AGENTS.md': agents(nivel) });
    if (como === 'indice') writeFileSync(join(dir, '.git', 'index'), 'lixo');
    if (como === 'head') writeFileSync(join(dir, '.git', 'HEAD'), 'lixo');
    return dir;
  };
  for (const como of ['indice', 'head']) {
    test(`doctor-git-ilegivel-gate (${como}): declarado 3, medido 0 ⇒ rc 1, sem dizer que o AGENTS.md não existe`, () => {
      const dir = dirIlegivel(como);
      const out = run(dir);
      assert.equal(out.declarado, 3);
      assert.equal(out.alcancado, 0);
      assert.equal(out.mentindo, true);
      assert.equal(out.semAgents, false);
      const r = cli(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /declara nível 3 e os gates sustentam 0/);
      assert.doesNotMatch(r.stdout, /não encontrado/);
      assert.match(r.stdout, /git ileg/i, 'a saída diz que o git não pôde ser lido');
    });
  }

  test('doctor-git-ilegivel-gate (git fora do PATH): rc 1 e mensagem de git', () => {
    const dir = dirIlegivel('nenhum');
    const r = cli(dir, { PATH: dirname(process.execPath) });
    assert.equal(r.status, 1, r.stdout);
    assert.doesNotMatch(r.stdout, /não encontrado/);
    assert.match(r.stdout, /git ileg/i);
  });

  test('doctor-git-ilegivel-gate (.git apontando para lugar nenhum): rc 1', () => {
    const dir = repo({ 'AGENTS.md': agents(3) });
    writeFileSync(join(dir, '.git'), 'gitdir: /nao/existe/aqui\n');
    const r = cli(dir);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /git ileg/i);
  });

  test('doctor-git-ilegivel-gate (GIT_DIR inválido herdado): o doctor o ignora, git legível, nível medido normal', () => {
    const dir = dirIlegivel('nenhum', 0);
    const r = cli(dir, { GIT_DIR: '/nao/existe' });
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /git ileg/i);
  });

  test('doctor-git-ilegivel-gate: declarado 0 com git ilegível ⇒ rc 0, mas avisa do git', () => {
    const dir = dirIlegivel('indice', 0);
    const r = cli(dir);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /git ileg/i);
  });

  test('doctor-git-ilegivel-gate: git legível não mudou — AGENTS.md ignorado continua ausente (R1)', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(3), '.gitignore': 'AGENTS.md\n' });
    const out = run(dir);
    assert.equal(out.gitIlegivel, false);
    assert.equal(out.semAgents, true);
    assert.equal(out.mentindo, false);
  });

  test('doctor-git-ilegivel-gate: sem commit e fora de git não são "ilegível"', () => {
    const novo = repo({ 'AGENTS.md': agents(0) });
    git(novo, 'init', '-q');
    assert.equal(run(novo).gitIlegivel, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0) })).gitIlegivel, false);
  });

  test('doctor-config-ignorada-versionamento: o histórico é conferido com a config VISÍVEL; a ignorada não afrouxa tiposLivres', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(0), '.gitignore': 'harness.config.json\n', 'harness.config.json': JSON.stringify({ versionamento: { resolvidoEm: hoje, tiposLivres: ['bagunca', 'chore'] } }) });
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'bagunca: nada a ver com conventional');
    const r = run(dir, { versionamento: { resolvidoEm: hoje } }).resultados.find((x) => x.id === 'versionamento');
    assert.equal(r.found, false, r.evidence);
  });

  test('doctor-tag-semver-ignora-git-dir-herdado (M4): GIT_DIR de outro repo não troca as tags', () => {
    const outro = repoComGit({ 'AGENTS.md': agents(0) });
    git(outro, 'tag', 'v9.9.9');
    const dir = repoComGit({ 'AGENTS.md': agents(0) });
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: join(outro, '.git') } });
    assert.equal(JSON.parse(r.stdout).resultados.find((x) => x.id === 'tag-semver').found, false);
  });

  test('doctor-rastreado-vale-a-arvore: rastreado vale mesmo ignorado depois (git add -f), assume-unchanged e modificado só na árvore leem o disco', () => {
    const cfg = JSON.stringify({ perfil: 'repo-sem-app' });
    const rastreado = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, '.gitignore': 'harness.config.json\n' });
    git(rastreado, 'add', '-f', 'harness.config.json');
    git(rastreado, 'commit', '-q', '-m', 'chore: config');
    assert.equal(run(rastreado).perfil, 'repo-sem-app', 'rastreado com -f: o clone também a tem');
    git(rastreado, 'update-index', '--assume-unchanged', 'harness.config.json');
    assert.equal(run(rastreado).perfil, 'repo-sem-app', 'assume-unchanged segue rastreado');
    const modificado = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': '{}' });
    git(modificado, 'add', '-A');
    git(modificado, 'commit', '-q', '-m', 'chore: config');
    writeFileSync(join(modificado, 'harness.config.json'), cfg);
    const out = run(modificado);
    assert.equal(out.perfil, 'repo-sem-app', 'veredito: a árvore é o que se mede, como em AGENTS.md e atestado modificados');
    assert.equal(out.camada.divergente, false);
  });
});

// ────────────────────────────────────────────────────────────── contrato T6 × T7 (Q20): o hook REAL grava, o doctor REAL lê

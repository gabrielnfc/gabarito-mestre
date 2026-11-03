/** Testes do harness-doctor — T6 run(). Cabeçalho (mutações prescritas) e helpers em _doctor-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, CHECKS } from '../scripts/harness-doctor.mjs';
import * as doctor from '../scripts/harness-doctor.mjs';
import { repo, agents, hoje, SCRIPT, ok, fixtureNivel2_110, git, repoComGit, CFG_GUARDA, camada, arq, repoComOrigin } from './_doctor-helpers.mjs';

describe('T6 doctor — run(): camada, ambientes, perfil, avisos', () => {
  test('doctor-lista-ambientes: só ambiente com declaração real entra; prod sintetizado por branchPadrao não conta', () => {
    const dir = repo({ 'harness.config.json': JSON.stringify({ versionamento: { branchPadrao: 'main' }, guarda: { ambientes: { teste: { hosts: ['127.0.0.1'] }, homolog: { projetos: ['ref-h'] }, prod: {} } } }) });
    const out = run(dir);
    assert.deepEqual(out.camada.ambientes, ['teste', 'homolog']);
    assert.equal(out.camada.estado, 'configurada');
  });

  test('doctor-sem-secao-guarda-avisa: sem guarda.ambientes ⇒ aviso, camada nenhuma, nível intacto', () => {
    const fx = fixtureNivel2_110(2);
    const sem = run(repoComGit(fx));
    assert.equal(sem.camada.estado, 'nenhuma');
    assert.ok(sem.avisos.some((a) => /^guarda-ambientes: .*guarda\.ambientes/.test(a)), JSON.stringify(sem.avisos));
    const com = run(repoComGit({ ...fx, 'harness.config.json': JSON.stringify({ ...JSON.parse(fx['harness.config.json']), ...CFG_GUARDA }) }));
    assert.ok(!com.avisos.some((a) => /^guarda-ambientes/.test(a)));
    assert.equal(sem.alcancado, com.alcancado, 'o aviso não mexe no nível');
    assert.equal(CHECKS.find((c) => c.id === 'guarda-ambientes').level, 'warn');
  });

  test('doctor-aviso-divergente: árvore ≠ origin/HEAD vira aviso', () => {
    const dir = repoComOrigin({ origem: CFG_GUARDA, local: { guarda: { ambientes: { teste: { hosts: ['x'] } } } } });
    assert.ok(run(dir).avisos.some((a) => /^guarda-divergente/.test(a)));
  });

  test('doctor-repo-sem-app: perfil explícito ⇒ G3 e teardown n/a (found, na); segurança restante segue valendo', () => {
    const dir = repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }) });
    const out = run(dir);
    const por = Object.fromEntries(out.resultados.map((r) => [r.id, r]));
    for (const id of ['G3-mass-mutation', 'G3-strict-undefined', 'teardown-por-id']) {
      assert.equal(por[id].found, true, id);
      assert.equal(por[id].na, true, id);
      assert.match(por[id].evidence, /n\/a/, id);
    }
    for (const id of ['R3-prod-guard', 'secrets-fora-do-repo', 'branch-protegida', 'backup-verificado']) {
      assert.equal(por[id].found, false, `${id} NÃO pode ser rebaixado pelo perfil`);
      assert.notEqual(por[id].na, true, id);
    }
    assert.equal(out.perfil, 'repo-sem-app');
    const sem = run(repo({ 'AGENTS.md': agents(0) }));
    assert.equal(sem.resultados.find((r) => r.id === 'G3-mass-mutation').na, undefined);
    assert.equal(sem.perfil, null);
  });

  test('doctor-repo-sem-app: valor de perfil inexistente ou com outra caixa não rebaixa nada', () => {
    for (const perfil of ['REPO-SEM-APP', 'repo-sem-app ', 'app', ['repo-sem-app'], true]) {
      const out = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil }) }));
      assert.equal(out.resultados.find((r) => r.id === 'G3-mass-mutation').found, false, JSON.stringify(perfil));
      assert.equal(out.perfil, null);
    }
  });

  test('doctor-repo-sem-app: com os atestados e o resto de segurança, perfil leva o repo ao nível 1', () => {
    const dir = repo({
      'AGENTS.md': agents(0),
      'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }),
      'src/db.ts': 'assertNotProduction();',
      '.gitignore': '.env\n',
      '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok }),
    });
    assert.equal(run(dir).alcancado, 1);
  });

  describe('A2 — arquivo ignorado pelo git não é evidência em NENHUM caminho (has, atestado, changelog, AGENTS.md)', () => {
    const base = { 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }), 'src/db.ts': 'assertNotProduction();', '.env.example': 'X=1\n' };
    const atestados = JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok });

    test('doctor-ignorado-nao-e-evidencia: atestado em .harness/ ignorado não sobe o nível (clone do mesmo commit também seria 0)', () => {
      const visivel = repoComGit({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.harness/attest.json': atestados });
      assert.equal(run(visivel).alcancado, 1, 'controle: o mesmo atestado versionável vale');
      const ignorado = repoComGit({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n.harness/\n', '.harness/attest.json': atestados });
      const out = run(ignorado);
      assert.equal(out.alcancado, 0);
      assert.equal(out.resultados.find((r) => r.id === 'branch-protegida').found, false);
    });

    test('doctor-ignorado-nao-e-evidencia: atestado ignorado por .git/info/exclude também não vale', () => {
      const dir = repoComGit({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.harness/attest.json': atestados });
      writeFileSync(join(dir, '.git', 'info', 'exclude'), '.harness/attest.json\n');
      assert.equal(run(dir).alcancado, 0);
    });

    test('doctor-ignorado-nao-e-evidencia: CHANGELOG.md ignorado não é evidência do changelog', () => {
      const ch = (gi) => run(repoComGit({ 'AGENTS.md': agents(0), '.gitignore': gi, 'CHANGELOG.md': '## [Unreleased]\n' })).resultados.find((r) => r.id === 'changelog');
      assert.equal(ch('').found, true, 'controle');
      assert.equal(ch('CHANGELOG.md\n').found, false);
    });

    test('doctor-ignorado-nao-e-evidencia: AGENTS.md ignorado não alimenta o nível declarado nem o tamanho', () => {
      const dir = repoComGit({ 'AGENTS.md': agents(2), '.gitignore': 'AGENTS.md\n' });
      const out = run(dir);
      assert.equal(out.declarado, null);
      assert.equal(out.resultados.find((r) => r.id === 'agents-tamanho').found, false);
      assert.equal(run(repoComGit({ 'AGENTS.md': agents(2) })).declarado, 2, 'controle');
    });

    test('doctor-ignorado-nao-e-evidencia: repo sem nenhum commit conta arquivos novos (não ignorados) como evidência', () => {
      const dir = repo({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.harness/attest.json': atestados });
      git(dir, 'init', '-q');
      assert.equal(run(dir).alcancado, 1);
    });
  });

  test('g8-md-nao-evidencia: menção em .md não prova a guarda; script de código prova', () => {
    const g8 = (arquivos) => run(repo({ 'AGENTS.md': agents(0), ...arquivos })).resultados.find((r) => r.id === 'G8-migrations-guard');
    assert.equal(g8({ 'README.md': 'rode migrations-guard.mjs e DESTRUCTIVE_PATTERN no CI' }).found, false);
    assert.equal(g8({ 'docs/harness/gates.md': 'migrations-guard' }).found, false);
    assert.equal(g8({ 'scripts/migrations-guard.mjs': 'DESTRUCTIVE_PATTERN' }).found, true);
  });

  test('doctor-varre-git-ls-files: arquivo ignorado pelo git não é evidência; rastreado e não-ASCII com espaço é', () => {
    const ignorado = repoComGit({ 'AGENTS.md': agents(0), '.gitignore': 'src/guard.ts\n', 'src/guard.ts': 'assertNotProduction()' });
    assert.equal(run(ignorado).resultados.find((r) => r.id === 'R3-prod-guard').found, false, 'ignorado');
    const naoIgnorado = repoComGit({ 'AGENTS.md': agents(0), 'src/ação do guarda.ts': 'assertNotProduction()' });
    const r3 = run(naoIgnorado).resultados.find((r) => r.id === 'R3-prod-guard');
    assert.equal(r3.found, true);
    assert.equal(r3.evidence, 'src/ação do guarda.ts');
    const commitado = repoComGit({ 'AGENTS.md': agents(0), 'src/b c.ts': 'assertNotProduction()' });
    git(commitado, 'add', '-A');
    git(commitado, 'commit', '-q', '-m', 'chore: add');
    assert.equal(run(commitado).resultados.find((r) => r.id === 'R3-prod-guard').evidence, 'src/b c.ts');
  });

  test('doctor-varre-git-ls-files: fora de repo git a varredura de disco segue valendo (fallback)', () => {
    const r3 = run(repo({ 'AGENTS.md': agents(0), 'src/guard.ts': 'assertNotProduction()' })).resultados.find((r) => r.id === 'R3-prod-guard');
    assert.equal(r3.found, true);
  });

  test('doctor-varre-git-ls-files: diretório dentro de OUTRO repo (não é a raiz) cai na varredura de disco', () => {
    const pai = repoComGit({ '.gitignore': 'sub/\n' });
    const sub = join(pai, 'sub');
    arq(sub, 'AGENTS.md', agents(0));
    arq(sub, 'src/guard.ts', 'assertNotProduction()');
    assert.equal(run(sub).resultados.find((r) => r.id === 'R3-prod-guard').found, true);
  });

  test('doctor-chaves-mortas: config e atestado com chaves removidas viram aviso listando cada uma', () => {
    const dir = repo({
      'AGENTS.md': agents(0),
      'harness.config.json': JSON.stringify({ migrationsDir: 'prisma/migrations', versionamento: { modelo: 'trunk', commit: 'conventional' }, orquestracao: { sempreSubagente: true, modelo: { alias: 'x' }, paralelismo: { modo: 'auto' } } }),
      '.harness/attest.json': JSON.stringify({ 'squash-titulo-pr': ok }),
    });
    const out = run(dir);
    const a = out.avisos.find((x) => x.startsWith('chaves-mortas'));
    assert.ok(a, JSON.stringify(out.avisos));
    for (const k of ['migrationsDir', 'versionamento.modelo', 'versionamento.commit', 'orquestracao.sempreSubagente', 'orquestracao.paralelismo.modo', 'attest.squash-titulo-pr']) assert.ok(a.includes(k), `${k} em: ${a}`);
    assert.ok(!a.includes('orquestracao.modelo'), 'orquestracao.modelo está VIVA');
    assert.ok(!run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ orquestracao: { modelo: { alias: 'x' } } }) })).avisos.some((x) => x.startsWith('chaves-mortas')));
  });

  test('doctor-chaves-mortas: o doctor deixou de ter migrationsDir como default', () => {
    assert.equal(readFileSync(SCRIPT, 'utf8').includes("migrationsDir: 'prisma/migrations'"), false);
  });

  test('diasdesde-numerico-invalido (herdado T1a MINOR B): calibradoEm numérico no JSON é inválido, não "hoje"', () => {
    const cfg = { orquestracao: { paralelismo: { simultaneos: 2, teto: 4, calibradoEm: Date.now() } } };
    const r = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify(cfg) })).resultados.find((x) => x.id === 'paralelismo-calibrado');
    assert.equal(r.found, false);
    assert.match(r.evidence, /inválida/);
    const m = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ orquestracao: { modelo: { alias: 'x', resolvidoEm: Date.now(), validadeDias: 90 } } }) })).resultados.find((x) => x.id === 'modelo-resolvido');
    assert.equal(m.found, false);
    assert.match(m.evidence, /inválido/);
  });
});

// ────────────────────────────────────────────────────────────── T6 rodada 2 — R1: a mesma regra do A2 em TODO leitor


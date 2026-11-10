/** Testes do harness-doctor — doctor 1.1.0. Cabeçalho (mutações prescritas) e helpers em _doctor-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, CHECKS, tamanhoAgents, NOVAS_1_1_0 } from '../scripts/harness-doctor.mjs';
import * as doctor from '../scripts/harness-doctor.mjs';
import * as onboarding from '../scripts/onboarding-config.mjs';
const DENY_GUARDA = onboarding.DENY_GUARDA ?? [];
import { repo, agents, hoje, SCRIPT, ok, diasAtras, fixtureNivel2_101, fixtureNivel2_110, agentsComNucleo, git, repoComGit, camada } from './_doctor-helpers.mjs';

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
    const out = run(repoComGit(fixtureNivel2_110(2)));
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
  test('atestado com `em` numérico segue inválido (diasEntre da lib não aceita número como data)', () => {
    const r = run(repo({ 'AGENTS.md': agents(0), '.harness/attest.json': JSON.stringify({ 'iniciativa-resolvida': { ...ok, em: Date.now() } }) })).resultados.find((x) => x.id === 'iniciativa-resolvida');
    assert.equal(r.found, false);
  });
  test('changelog: exige o arquivo de versionamento.changelog com "## [Unreleased]" ou "## Unreleased"', () => {
    const cfg = JSON.stringify({ versionamento: { changelog: 'HISTORY.md' } });
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## Unreleased\n' })).resultados.find((r) => r.id === 'changelog').found, true);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## 1.0.0\n' })).resultados.find((r) => r.id === 'changelog').found, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'CHANGELOG.md': '## [Unreleased]\n' })).resultados.find((r) => r.id === 'changelog').found, true, 'default CHANGELOG.md');
  });
  test('versionamento: sem git legível é FALTA (F2-R7/G9: indisponível nunca vale como validado); com histórico ruim também é FALTA', () => {
    const semGit = run(repo(fixtureNivel2_110(2))).resultados.find((r) => r.id === 'versionamento');
    assert.equal(semGit.found, false);
    assert.equal(semGit.warn, undefined);
    assert.match(semGit.evidence, /histórico não conferido/);
    assert.match(semGit.evidence, /sem git legível/);
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
    assert.match(CHECKS.find((c) => c.id === id).fix, /gabarito-instalar \(trocar orquestracao\)/, 'o fix aponta a skill (FX3: nenhum comando para colar)');
    assert.doesNotMatch(CHECKS.find((c) => c.id === id).fix, /--sugerir/);
    assert.doesNotMatch(CHECKS.find((c) => c.id === id).fix, /--calibrar/);
  });
});

describe('doctor 1.1.0 — modelo-resolvido é warn, não FALTA (ORQ-5)', () => {
  test('vencido há 91 dias: aviso presente e nível INALTERADO', () => {
    const out = run(repoComGit(fixtureNivel2_110(2, { orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } })));
    assert.equal(out.alcancado, 2);
    assert.equal(CHECKS.find((c) => c.id === 'modelo-resolvido').level, 'warn');
    assert.ok(out.avisos.some((a) => a.startsWith('modelo-resolvido')), JSON.stringify(out.avisos));
    assert.match(out.resultados.find((r) => r.id === 'modelo-resolvido').evidence, /VENCIDO/);
  });
  test('dentro da validade: sem aviso', () => {
    const out = run(repo(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(10), validadeDias: 90 } } })));
    // T6: sem guarda.ambientes o doctor avisa (guarda-ambientes); aqui só interessa que o MODELO não avisa
    assert.deepEqual(out.avisos.filter((a) => a.startsWith('modelo-resolvido')), []);
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
  test('M5: gravarCache é atômico (tmp + rename) — nenhum .tmp sobra em .harness/', () => {
    const dir = repo({ 'AGENTS.md': agents(0) });
    const r = spawnSync(process.execPath, [SCRIPT, '--json', '--cache'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, '.harness', 'doctor-cache.json')));
    const arquivos = readdirSync(join(dir, '.harness'));
    assert.deepEqual(arquivos.filter((f) => f.includes('.tmp')), [], JSON.stringify(arquivos));
  });
});

describe('doctor 1.1.0 — render', () => {
  test('repo 1.0.1 declarando 2: exit 1 e a linha "checagens novas da 1.1.0"', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--explain'], { cwd: repo(fixtureNivel2_101(2)), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /checagens novas da 1\.1\.0: rode o onboarding ou declare o nível medido/);
    assert.match(r.stdout, /FALTA .*fluxo configurado/);
    assert.match(r.stdout, /→ peça ao Claude gabarito-instalar/);
  });
  test('modelo vencido aparece como "warn" numa seção de avisos e não altera o exit', () => {
    const dir = repoComGit(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } }));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /── Avisos/);
    assert.match(r.stdout, / warn .*modelo do orquestrador/);
  });
  test('as 8 checagens novas existem, com id/regra/nível/rótulo/conserto', () => {
    assert.equal(NOVAS_1_1_0.length, 8);
    for (const id of NOVAS_1_1_0) assert.ok(CHECKS.find((c) => c.id === id), id);
  });
  test('repo saudável 1.1.0 (declarado ≤ alcançado): a linha "checagens novas" NÃO aparece (M10)', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: repoComGit(fixtureNivel2_110(2)), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /checagens novas da 1\.1\.0/);
  });
  test('mentindo só por checagem ANTIGA (novasFaltando vazio): a linha "checagens novas" NÃO aparece (M10)', () => {
    // fixture 1.1.0 completa (fluxo, versionamento, changelog, iniciativa, agents-tamanho e
    // paralelismo-calibrado todos OK) mas sem o atestado ANTIGO 'ruleset-obrigatorio' — o
    // nível cai (declarado 3 > alcançado 1) só por causa de uma checagem da 1.0.1.
    const fx = fixtureNivel2_110(3, { orquestracao: { paralelismo: { simultaneos: 2, teto: 4, calibradoEm: hoje } } });
    fx['.harness/attest.json'] = JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'iniciativa-resolvida': ok });
    const dir = repoComGit(fx);
    const out = run(dir);
    assert.equal(out.mentindo, true, JSON.stringify({ declarado: out.declarado, alcancado: out.alcancado }));
    assert.deepEqual(out.novasFaltando, [], JSON.stringify(out.novasFaltando));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /checagens novas da 1\.1\.0/);
  });
});

// ────────────────────────────────────────────────────────────── T6 — camada de guarda, perfil, git ls-files

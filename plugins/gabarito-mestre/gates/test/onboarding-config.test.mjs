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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, realpathSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeDeep, aplicar, aplicarSettings, diffChaves, lerJson, ArquivoInvalido, SECOES, escreverAtomico, raizDoRepo } from '../scripts/onboarding-config.mjs';

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
  test('undefined aninhado é ignorado; chave original persiste', () => {
    assert.deepEqual(mergeDeep({ a: { x: 1, y: 2 } }, { a: { x: undefined } }), { a: { x: 1, y: 2 } });
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

describe('escreverAtomico — atomicidade via tmp+rename', () => {
  test('tmp+rename substitui symlink sem seguir; arquivo alvo intacto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'));
    const realFile = join(dir, 'real.json');
    const destLink = join(dir, 'dest.json');
    const original = '{"original":true}\n';

    // Arquivo real com conteúdo X
    writeFileSync(realFile, original);

    // Symlink apontando para o arquivo real
    symlinkSync(realFile, destLink);

    // Escrever através do symlink com escreverAtomico
    escreverAtomico(destLink, { new: 'data' });

    // Com tmp+rename (correto): symlink é SUBSTITUÍDO por arquivo regular,
    // e o arquivo real continua intacto (porque rename não segue symlink)
    assert.equal(lstatSync(destLink).isSymbolicLink(), false, 'dest deve ser arquivo regular, não symlink');
    assert.equal(readFileSync(realFile, 'utf8'), original, 'arquivo real deve estar intacto byte a byte');

    // Com escrita direta (mutação): writeFileSync segue o symlink e sobrescreve
    // o arquivo real, fazendo este teste falhar.
  });
});

describe('raizDoRepo — encontrar raiz do repositório via git', () => {
  test('raizDoRepo retorna raiz do repo quando chamado de subdiretório com .git', () => {
    const repo_dir = mkdtempSync(join(tmpdir(), 'git-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo_dir });

    const subdir = join(repo_dir, 'src', 'nested');
    mkdirSync(subdir, { recursive: true });

    const raiz = raizDoRepo(subdir);
    // No macOS, tmpdir() pode retornar /private/..., mas git resolve symlinks. Compare realpaths.
    assert.equal(realpathSync(raiz), realpathSync(repo_dir));
  });

  test('CLI sem --root grava em <raiz>/harness.config.json quando chamado de subdiretório', () => {
    const repo_dir = mkdtempSync(join(tmpdir(), 'git-cli-'));
    execFileSync('git', ['init', '-q'], { cwd: repo_dir });

    const subdir = join(repo_dir, 'src', 'nested');
    mkdirSync(subdir, { recursive: true });

    const r = cli(['--set', 'contexto', '{"teste":true}'], subdir);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    // Arquivo deve estar na raiz do repo, não em subdir
    // No macOS, repo_dir pode ter /private/, então temos que comparar de forma mais flexível
    const configPathRepo = join(resolve(repo_dir), 'harness.config.json');
    const configPathSub = join(resolve(subdir), 'harness.config.json');
    assert.ok(existsSync(configPathRepo), `config não encontrado em ${configPathRepo}`);
    assert.ok(!existsSync(configPathSub));

    const cfg = JSON.parse(readFileSync(configPathRepo, 'utf8'));
    assert.equal(cfg.contexto.teste, true);
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
  test('F2-R8: harness.config.json inválido — o STDOUT (não só o stderr) ganha a linha "NÃO escrito"; exit 0 continua', () => {
    const dir = repo({ 'harness.config.json': '{"a":' });
    const r = cli(['--root', dir, '--set', 'fluxo', '{"ferramenta":"arquivos"}'], dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[ONB-7\] harness\.config\.json NÃO escrito — JSON inválido \(fail-open declarado, G9\)/);
    assert.doesNotMatch(r.stdout, /atualizado/, 'a linha de sucesso não aparece quando não escreveu nada');
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

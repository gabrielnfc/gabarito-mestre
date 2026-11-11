/**
 * Testes do pacote dos gates — o que o instalador copia e o que o `bin` promete.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  voltar `version` a 1.0.0
 *  M2  apontar um `bin` para arquivo inexistente
 *  M3  acrescentar uma dependência (zero dependência é contrato)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(GATES, 'package.json'), 'utf8'));

// Só é "repo do plugin" se a raiz tiver plugins/gabarito-mestre/.claude-plugin/plugin.json. Na cópia instalada
// (tools/gabarito-gates) o pai pode ter um marketplace.json alheio: não basta existir o arquivo.
const ehRepoDoPlugin = (raiz) => existsSync(join(raiz, 'plugins', 'gabarito-mestre', '.claude-plugin', 'plugin.json'));
const RAIZ = join(GATES, '..', '..', '..');
const PLUGIN_JSON = join(RAIZ, 'plugins', 'gabarito-mestre', '.claude-plugin', 'plugin.json');
const MKT_JSON = join(RAIZ, '.claude-plugin', 'marketplace.json');
const MEDIDO = join(RAIZ, 'plugins', 'gabarito-mestre', 'medido-em.json');
const fora = ehRepoDoPlugin(RAIZ) ? false : 'fora do repo do plugin';
const noPlugin = fora, noMkt = fora;
const ler = (p) => JSON.parse(readFileSync(p, 'utf8'));
const HATCH = ['GABARITO', 'ALLOW'].join('_');

describe('ehRepoDoPlugin — cópia instalada sob um pai com marketplace.json alheio', () => {
  test('pai/.claude-plugin/marketplace.json sem plugins/gabarito-mestre não é repo do plugin', () => {
    const pai = mkdtempSync(join(tmpdir(), 'gm-pkg-'));
    mkdirSync(join(pai, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pai, '.claude-plugin', 'marketplace.json'), '{"name":"alheio"}');
    assert.equal(ehRepoDoPlugin(pai), false);
    mkdirSync(join(pai, 'plugins', 'gabarito-mestre', '.claude-plugin'), { recursive: true });
    writeFileSync(join(pai, 'plugins', 'gabarito-mestre', '.claude-plugin', 'plugin.json'), '{}');
    assert.equal(ehRepoDoPlugin(pai), true);
  });
});

describe('gates/package.json 1.1.0', () => {
  test('version é 2.0.0 (virada: estável, sem sufixo de pré-versão)', () => {
    assert.equal(pkg.version, '2.0.0');
    assert.doesNotMatch(pkg.version, /alpha|beta|rc|-/);
  });
  test('sem-alpha: plugin.json e gates não carregam sufixo de pré-versão', { skip: noPlugin }, () => {
    for (const v of [ler(PLUGIN_JSON).version, pkg.version]) assert.match(v, /^\d+\.\d+\.\d+$/, `versão com sufixo: ${v}`);
  });
  test('versao-manifestos: plugin.json, gates, marketplace (se trouxer versão) e CHANGELOG dizem a mesma versão', { skip: fora }, () => {
    const v = ler(PLUGIN_JSON).version;
    assert.equal(v, pkg.version);
    for (const p of ler(MKT_JSON).plugins) if (p.version !== undefined) assert.equal(p.version, v, `marketplace: ${p.name}`);
    const changelog = readFileSync(join(RAIZ, 'CHANGELOG.md'), 'utf8');
    const primeira = /^## \[(\d[^\]]*)\]/m.exec(changelog.replace(/^## \[Unreleased\][\s\S]*?(?=^## \[\d)/m, ''));
    assert.equal(primeira?.[1], v, 'a 1ª seção versionada do CHANGELOG é a do plugin');
  });
  test('skill gabarito-loop: frontmatter, ponteiro ao CLI, sem cópia de spec nem hatch', { skip: fora }, () => {
    const f = join(RAIZ, 'plugins', 'gabarito-mestre', 'skills', 'gabarito-loop', 'SKILL.md');
    const t = readFileSync(f, 'utf8');
    assert.match(t, /^---\nname: gabarito-loop\ndescription: .{40,}\n(allowed-tools: .+\n)?---\n/);
    assert.match(t, /gates\/scripts\/loop\.mjs/);
    assert.doesNotMatch(t, /^\*\*REQ-/m, 'definição de requisito é da spec; a skill só aponta');
    assert.equal(t.includes(HATCH), false);
  });
  test('skill-loop-cita-descricao-devolver-painel: (a) description do Agent, (b) devolver, (c) texto do painel no Ciclo (REQ-PNL-10)', { skip: fora }, () => {
    const t = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'skills', 'gabarito-loop', 'SKILL.md'), 'utf8');
    assert.ok(t.includes(' A `description` do `Agent` é a `descricao` do item, sem mudar.'), '(a) ausente');
    assert.ok(t.includes(' Antes de parar, `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/entrega.mjs" devolver --motivo <t>` (grava `entrega.devolvida`; o painel mostra o comando ao dono).'), '(b) ausente');
    assert.ok(t.includes('\nStatus ao dono: comece por `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/painel.mjs" texto --preset executivo --largura 80`.\n'), '(c) ausente');
    const loop = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'gates', 'scripts', 'loop.mjs'), 'utf8');
    assert.ok(loop.includes('descricao: `${item.task} ${item.papel}`'), 'descricao do item mudou: a skill (a) aponta para ela');
    const ent = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'gates', 'scripts', 'entrega.mjs'), 'utf8');
    assert.ok(ent.includes('devolver --motivo <texto>'), 'uso de entrega.mjs sem devolver');
    // Comportamento: o subcomando que a skill (b) cita é aceito pelo CLI (não cai em 'uso'); o erro de entrega não inferida é o esperado num repo sem branch de entrega.
    const repo = mkdtempSync(join(tmpdir(), 'skill-devolver-'));
    assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
    const r = spawnSync(process.execPath, [join(GATES, 'scripts', 'entrega.mjs'), 'devolver', '--motivo', 'teste'], { cwd: repo, encoding: 'utf8' });
    assert.notEqual(JSON.parse(r.stdout.trim().split('\n').pop()).erro, 'uso', r.stdout);
  });
  test('skill-loop-ate-95-linhas: teto de 95 linhas (GM-13 T15, contado aqui; o teto de 80 do doctor segue em harness-doctor-loop)', { skip: fora }, () => {
    const t = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'skills', 'gabarito-loop', 'SKILL.md'), 'utf8');
    const linhas = t.split('\n').length - 1;
    assert.ok(linhas <= 95, `${linhas} linhas`);
  });
  test('agente gabarito-spike: lista fechada do que cria e config isolada (A5, A6)', { skip: fora }, () => {
    const t = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'agents', 'gabarito-spike.md'), 'utf8');
    assert.match(t, /Pode criar \(lista fechada\)/);
    assert.match(t, /Config isolada/);
    assert.match(t, /CLAUDE_CONFIG_DIR/);
    assert.match(t, /Nunca grave em `~\/\.claude`/);
    assert.equal(t.includes(HATCH), false);
  });
  test('mod-test.sh: verde só com o teste do mod carregado e nenhuma falha de verdade (claude falso no PATH)', { skip: fora }, () => {
    const script = join(RAIZ, 'plugins', 'gabarito-mestre', 'scripts', 'test', 'mod-test.sh');
    const roda = (saida) => {
      const bin = mkdtempSync(join(tmpdir(), 'mod-test-bin-'));
      writeFileSync(join(bin, 'claude'), `#!/bin/bash\ncat <<'FIM'\n${saida}\nFIM\nexit 1\n`, { mode: 0o755 });
      return spawnSync('bash', [script], { cwd: bin, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }).status;
    };
    const naoCarrega = '(fail) the file did not load';
    assert.equal(roda(`(pass) x [1ms]\n${naoCarrega}\n${naoCarrega}`), 0, 'só os *.test.ts de gates/ não carregam: é o esperado');
    assert.equal(roda(naoCarrega), 1, 'zero teste carregado nunca é verde');
    assert.equal(roda(''), 1, 'saída vazia nunca é verde');
    assert.equal(roda(`(pass) x [1ms]\nmod/test/gabarito.test.ts: cannot load`), 1, 'o arquivo do mod não carregou');
    assert.equal(roda(`(pass) x [1ms]\n(fail) y [2ms]`), 1, 'teste do mod falhando');
  });
  test('commands/gabarito.md: pausar|retomar sem mod, avisa que a guarda pergunta, sem hatch', { skip: fora }, () => {
    const t = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'commands', 'gabarito.md'), 'utf8');
    assert.match(t, /^---\ndescription: .+\nargument-hint: pausar\|retomar\n/);
    assert.match(t, /\.harness\/PAUSAR/);
    assert.match(t, /`ask`/);
    assert.equal(t.includes(HATCH), false);
  });
  test('gabarito-comando-usa-cli: o comando consulta pausa.mjs; sem `test -e`, sem caminho relativo, limite da raiz em prosa', { skip: fora }, () => {
    const t = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'commands', 'gabarito.md'), 'utf8');
    assert.match(t, /^allowed-tools: Read, Bash\(node:\*\)$/m);
    assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/pausa\.mjs"/);
    assert.equal(t.includes('test -e'), false, 'a conferência relativa ao cwd volta ao falso "pausado"');
    assert.doesNotMatch(t, /(?:>|\brm|-p) '?\.\/?\.harness/, 'comando com caminho relativo para .harness');
    assert.match(t, /<alvo>\/\.harness\/PAUSAR/);
    assert.match(t, /se `alvo` não é o repositório desta sessão, pare e diga/i);
    assert.match(t, /reconsult/);
    assert.equal(existsSync(join(GATES, 'scripts', 'pausa.mjs')), true);
  });
  test('version do plugin.json igual à dos gates', { skip: noPlugin }, () => {
    assert.equal(ler(PLUGIN_JSON).version, pkg.version);
  });
  test('marketplace-name: na virada o catálogo se chama gabarito-mestre (quem atualiza usa gabarito-mestre@gabarito-mestre)', { skip: noMkt }, () => {
    assert.equal(ler(MKT_JSON).name, 'gabarito-mestre');
  });
  test('versão só no plugin.json (doc oficial); entrada do marketplace não duplica', { skip: noMkt }, () => {
    assert.equal(ler(MKT_JSON).plugins[0].version, undefined);
  });
  test('medido-em.json (raiz do plugin, fora de gates/) registra a versão do Claude Code do spike (Q12)', { skip: fora }, () => {
    const m = ler(MEDIDO);
    assert.match(m.claudeCode, /^\d+\.\d+\.\d+$/);
  });
  test('todo bin aponta para um script existente e os quatro novos estão lá', () => {
    for (const [nome, rel] of Object.entries(pkg.bin)) assert.ok(existsSync(join(GATES, rel)), `${nome} → ${rel}`);
    for (const nome of ['harness-onboarding-config', 'harness-capacidade', 'harness-versionamento-check', 'harness-cartao-sessao', 'harness-doctor']) {
      assert.ok(pkg.bin[nome], nome);
    }
  });
  test('files publica lib/ (os scripts importam ../lib/*)', () => {
    assert.ok(pkg.files.includes('lib'), `files sem lib: ${JSON.stringify(pkg.files)}`);
    assert.ok(existsSync(join(GATES, 'lib', 'cli.mjs')));
  });
  test('zero dependências e Node ≥ 22.18', () => {
    assert.deepEqual(pkg.dependencies, {});
    assert.deepEqual(pkg.devDependencies, {});
    assert.equal(pkg.engines.node, '>=22.18');
  });
  test('npm test cobre todos os .test.mjs (glob) e existe o script versionamento', () => {
    assert.match(pkg.scripts['test:mjs'], /test\/\*\.test\.mjs/);
    assert.match(pkg.scripts.versionamento, /versionamento-check\.mjs/);
  });
  test('todo script novo tem o cabeçalho JSDoc com USO (mesmo estilo do doctor)', () => {
    for (const f of ['onboarding-config.mjs', 'capacidade.mjs', 'versionamento-check.mjs', 'cartao-sessao.mjs']) {
      const t = readFileSync(join(GATES, 'scripts', f), 'utf8');
      assert.ok(t.startsWith('#!/usr/bin/env node\n/**'), `${f} sem shebang + JSDoc`);
      assert.match(t, /\n \* USO\n/, `${f} sem bloco USO`);
      assert.match(t, /fail-open declarado \(G9\)/, `${f} sem fail-open declarado`);
    }
  });
});

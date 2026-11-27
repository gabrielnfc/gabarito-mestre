/**
 * Testes do pacote dos gates — o que o instalador copia e o que o `bin` promete.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  voltar `version` a 1.0.0
 *  M2  apontar um `bin` para arquivo inexistente
 *  M3  acrescentar uma dependência (zero dependência é contrato)
 *  MF1-a remover a regra do cabeçalho em mod-test.sh · MF1-b aceitar qualquer `/test/` · MF1-c aceitar falha sem cabeçalho (GM-19: caem em mod-test-outro-arquivo-nao-carrega)
 *  MF2-a apagar a chamada de texto-nom em texto.test.sh · MF2-b engolir o rc (GM-19: caem em texto-nom-e-chamado-pelo-texto)
 *  MF3-a tirar o glob `.ts` · MF3-b plantar test/sub/x.test.mjs · MF3-c plantar teste em e2e/ (GM-19: caem em npm-test-cobre-todo-arquivo-de-teste)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
  test('version é 2.3.1 (o hotfix estável; tag e release só o dono publica, next ⇒ main)', () => {
    assert.equal(pkg.version, '2.3.1');
  });
  test('versao-formato: plugin.json e gates dizem a mesma versão SemVer, com no máximo o sufixo alpha.N', { skip: noPlugin }, () => {
    for (const v of [ler(PLUGIN_JSON).version, pkg.version]) assert.match(v, /^\d+\.\d+\.\d+(-alpha\.\d+)?$/, `versão fora do formato: ${v}`);
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
    const ent = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'gates', 'scripts', 'entrega.mjs'), 'utf8');
    assert.ok(ent.includes('devolver --motivo <texto>'), 'uso de entrega.mjs sem devolver');
    // Comportamento: o subcomando que a skill (b) cita é aceito pelo CLI (não cai em 'uso'); o erro de entrega não inferida é o esperado num repo sem branch de entrega.
    const repo = mkdtempSync(join(tmpdir(), 'skill-devolver-'));
    assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
    const r = spawnSync(process.execPath, [join(GATES, 'scripts', 'entrega.mjs'), 'devolver', '--motivo', 'teste'], { cwd: repo, encoding: 'utf8' });
    assert.notEqual(JSON.parse(r.stdout.trim().split('\n').pop()).erro, 'uso', r.stdout);
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
    const gatesTs = `gates/test/aprendizado.test.ts:\n${naoCarrega}\n  gates/test/aprendizado.test.ts: cannot import node:test\n\ngates/test/depende.test.ts:\n${naoCarrega}`;
    assert.equal(roda(`(pass) x [1ms]\n${gatesTs}`), 0, 'só os *.test.ts de gates/test não carregam: é o esperado');
    assert.equal(roda(naoCarrega), 1, 'zero teste carregado nunca é verde');
    assert.equal(roda(''), 1, 'saída vazia nunca é verde');
    assert.equal(roda(`(pass) x [1ms]\nmod/test/gabarito.test.ts: cannot load`), 1, 'o arquivo do mod não carregou');
    assert.equal(roda(`(pass) x [1ms]\n(fail) y [2ms]`), 1, 'teste do mod falhando');
  });
  test('mod-test-outro-arquivo-nao-carrega: arquivo do mod que não carrega, ou falha sem cabeçalho, reprova (REQ-FURO-1)', { skip: fora }, () => {
    const script = join(RAIZ, 'plugins', 'gabarito-mestre', 'scripts', 'test', 'mod-test.sh');
    const roda = (saida) => {
      const bin = mkdtempSync(join(tmpdir(), 'mod-test-bin-'));
      writeFileSync(join(bin, 'claude'), `#!/bin/bash\ncat <<'FIM'\n${saida}\nFIM\nexit 1\n`, { mode: 0o755 });
      return spawnSync('bash', [script], { cwd: bin, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }).status;
    };
    const naoCarrega = '(fail) the file did not load';
    const gatesTs = `gates/test/depende.test.ts:\n${naoCarrega}\n  gates/test/depende.test.ts: cannot import node:test`;
    const gabaritoOk = 'mod/test/gabarito.test.ts:\n(pass) x [1ms]';
    assert.equal(roda(`${gatesTs}\n\nmod/test/chat.test.ts:\n${naoCarrega}\n  mod/test/chat.test.ts: cannot import "../x.mjs"\n\n${gabaritoOk}`), 1, 'chat do mod sem carregar, depois dos gates (formato real de F11)');
    assert.equal(roda(`${gabaritoOk}\n\nmod/test/chat.test.ts:\n${naoCarrega}`), 1, 'chat do mod sem carregar, depois do gabarito');
    assert.equal(roda(`${gabaritoOk}\n${naoCarrega}`), 1, 'falha de carga sem cabeçalho de arquivo nunca é de gates');
    assert.equal(roda(`${naoCarrega}\n${gabaritoOk}`), 1, 'falha de carga na 1ª linha, sem cabeçalho');
    assert.equal(roda(`${gatesTs}\n\nhooks/test/x.test.ts:\n${naoCarrega}\n\n${gabaritoOk}`), 1, 'cabeçalho de outra pasta (hooks/test), depois dos gates: reprova (MF-P4)');
    assert.equal(roda(`${gabaritoOk}\n\nhooks/test/x.test.ts:\n${naoCarrega}`), 1, 'cabeçalho de outra pasta, sozinho depois do gabarito');
    assert.equal(roda(`${gabaritoOk}\n\nmod/novo.test.ts:\n${naoCarrega}`), 1, 'pedaço novo do mod (spec:116) que não carrega');
    assert.equal(roda(`${gatesTs}\n\n${gabaritoOk}`), 0, 'só os de gates/test sem carregar segue verde');
  });
  test('texto-nom-e-chamado-pelo-texto: texto.test.sh roda texto-nom.test.sh sem argumento e propaga o rc (REQ-FURO-2)', { skip: fora }, () => {
    const t = readFileSync(join(RAIZ, 'plugins', 'gabarito-mestre', 'scripts', 'test', 'texto.test.sh'), 'utf8');
    const linhas = t.split('\n');
    const chamada = linhas.filter((l) => l.includes('texto-nom.test.sh') && l.startsWith('check '));
    assert.deepEqual(chamada, [`check "texto-nom: os casos de NOM-1 de texto-nom.test.sh passam (rc 0)" 'bash "$P/scripts/test/texto-nom.test.sh" >/dev/null 2>&1' "texto-nom.test.sh falhou: rode-o sozinho"`], 'uma só linha check, com a chamada e o rc, sem engolir');
    const resumo = linhas.findIndex((l) => l.startsWith('echo "── $falhas falha(s)"'));
    assert.ok(resumo > 0 && linhas.indexOf(chamada[0]) < resumo, 'a chamada vem antes do resumo final');
    assert.ok(linhas.indexOf(chamada[0]) > linhas.findIndex((l) => l.includes('"${1:-}" = "--fase"')), 'depois dos retornos antecipados de --nom e --fase: sem recursão');
  });
  test('npm-test-cobre-todo-arquivo-de-teste: scripts.test é o de hoje e nenhuma subpasta tem teste fora dos globs (REQ-FURO-3)', () => {
    assert.equal(pkg.scripts.test, 'node --experimental-strip-types --test test/*.test.mjs test/*.test.ts');
    const achados = [];
    const anda = (dir, rel) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) anda(join(dir, e.name), r);
        else if (rel && /\.test\.(mjs|ts)$/.test(e.name)) achados.push(r);
      }
    };
    anda(join(GATES, 'test'), '');
    assert.deepEqual(achados, ['e2e/repo-exemplo/test/base.test.mjs'], 'só a fixture de F13 fica numa subpasta; o resto não roda no npm test');
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

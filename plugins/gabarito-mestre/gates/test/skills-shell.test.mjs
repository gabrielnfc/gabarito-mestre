/**
 * Skill sem comando em variável (GM-10, REQ-LOOP-3, D-1).
 * Em zsh, `$VAR` com argumentos não separa palavras: `L="node --version"; $L` dá exit 127.
 * Texto de skill, agente, comando, reference e template usa o comando inteiro.
 *
 * MUTAÇÕES PRESCRITAS (JSON em .superpowers/sdd/2026-11-03-e2-loop/task-29-mut.json):
 *  M1  volta `LOOP=` e `$LOOP proxima` ⇒ `skills-sem-comando-em-variavel` falha
 *  M2  só `$LOOP reabrir` na linha 48 ⇒ `skills-sem-comando-em-variavel` falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function md(dir, recursivo) {
  const base = join(PLUGIN, dir);
  if (!existsSync(base)) return [];
  const out = [];
  const anda = (d) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome);
      if (statSync(p).isDirectory()) { if (recursivo) anda(p); }
      else if (dir === 'templates' || nome.endsWith('.md')) out.push(p);
    }
  };
  anda(base);
  return out;
}

const ARQUIVOS = [
  ...md('skills', true), ...md('agents', false), ...md('commands', false),
  ...md('reference', false), ...md('templates', true),
];

const ATRIBUICAO = /^\s*[A-Z_]{2,}="?[a-z]+ /;
const USO = /\$[A-Z_]{2,} +[a-z<-]/;

test('skills-sem-comando-em-variavel', () => {
  assert.ok(ARQUIVOS.length > 0, 'nenhum arquivo varrido');
  const achados = [];
  for (const f of ARQUIVOS) {
    readFileSync(f, 'utf8').split('\n').forEach((linha, i) => {
      if (ATRIBUICAO.test(linha) || USO.test(linha)) achados.push(`${relative(PLUGIN, f)}:${i + 1}: ${linha.trim()}`);
    });
  }
  assert.deepEqual(achados, [], `comando em variável (zsh não separa $VAR):\n${achados.join('\n')}`);
});

test('regex-pega-o-que-deve-e-poupa-o-legitimo', () => {
  for (const ruim of ['LOOP="node x.mjs"', '$LOOP proxima --vivos 1', '$LOOP reabrir <task>', '  CMD=node foo']) {
    assert.ok(ATRIBUICAO.test(ruim) || USO.test(ruim), ruim);
  }
  for (const bom of ['cd "$TMPDIR" && ls', 'TMPDIR=/x/y', 'export PORT=3000', 'use $HOME/bin', '${CLAUDE_PLUGIN_ROOT}/x']) {
    assert.ok(!ATRIBUICAO.test(bom) && !USO.test(bom), bom);
  }
});

// ---- Costura (P9): o comando da skill roda de verdade no shell, com a raiz do plugin com espaço no caminho.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const FONTES = ['skills/gabarito-loop/SKILL.md', 'commands/gabarito.md'];
const CMD_LOOP = /node "?\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs"?[^`\n]*/g;

/** Todo `node ${CLAUDE_PLUGIN_ROOT}/gates/scripts/<x>.mjs` das fontes: o caminho precisa estar entre aspas. */
function extrairComandosLoop() {
  const out = [];
  for (const rel of FONTES) {
    for (const m of readFileSync(join(PLUGIN, rel), 'utf8').matchAll(CMD_LOOP)) {
      const cmd = m[0].replace(/\s+#.*$/, '').replace(/<n>/g, '1').replace(/<task>/g, 'T1').trim();
      out.push({ rel, cmd });
    }
  }
  return out;
}

function shellsDisponiveis() {
  return ['bash', 'zsh'].filter((sh) => spawnSync(sh, ['-c', 'exit 0']).status === 0);
}

test('comando-da-skill-roda-de-verdade-em-bash-e-zsh', () => {
  const cmds = extrairComandosLoop();
  assert.ok(cmds.length >= 2, `extração achou ${cmds.length} comando(s) do loop.mjs; esperado >= 2`);
  const subs = cmds.map((c) => c.cmd.match(/loop\.mjs"?\s+(\S+)/)?.[1]);
  assert.ok(subs.includes('proxima') && subs.includes('reabrir'), `subcomandos achados: ${subs}`);
  const shells = shellsDisponiveis();
  assert.ok(shells.includes('bash'), 'bash ausente');
  const base = mkdtempSync(join(tmpdir(), 'skills-shell-'));
  const raiz = join(base, 'raiz com espaco');
  mkdirSync(raiz);
  symlinkSync(PLUGIN, join(raiz, 'plugin'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  for (const sh of shells) {
    for (const { rel, cmd } of cmds) {
      const r = spawnSync(sh, ['-c', cmd], {
        cwd: repo, encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(raiz, 'plugin') },
      });
      const ctx = `${sh} ${rel}: ${cmd}\nrc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
      assert.notEqual(r.status, 127, `comando não encontrado\n${ctx}`);
      assert.ok(!/Cannot find module/.test(r.stderr), `script não achado\n${ctx}`);
      let j;
      try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { assert.fail(`saída sem JSON\n${ctx}`); }
      assert.equal(typeof j.ok, 'boolean', ctx);
      assert.notEqual(j.erro, 'uso', `subcomando caiu em uso\n${ctx}`);
    }
  }
});

// ---- Costura (P9, GM-12 T13): o comando do painel que a skill manda rodar no topo do status resolve e executa.
test('comando-do-painel-da-skill-roda-em-bash-e-zsh', () => {
  const cmd = readFileSync(join(PLUGIN, 'skills/gabarito-loop/SKILL.md'), 'utf8')
    .match(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/painel\.mjs" texto[^`\n]*/)?.[0];
  assert.ok(cmd, 'a skill não cita `painel.mjs texto`');
  const base = mkdtempSync(join(tmpdir(), 'skills-painel-'));
  const raiz = join(base, 'raiz com espaco');
  mkdirSync(raiz);
  symlinkSync(PLUGIN, join(raiz, 'plugin'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  for (const sh of shellsDisponiveis()) {
    const r = spawnSync(sh, ['-c', cmd], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(raiz, 'plugin') },
    });
    const ctx = `${sh}: ${cmd}\nrc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
    assert.notEqual(r.status, 127, `comando não encontrado\n${ctx}`);
    assert.ok(!/Cannot find module/.test(r.stderr), `script não achado\n${ctx}`);
    // Sem entrega inferida o CLI responde JSON com erro; o que não pode é cair em uso (flag mal formada).
    const ultima = r.stdout.trim().split('\n').pop() ?? '';
    if (ultima.startsWith('{')) assert.notEqual(JSON.parse(ultima).erro, 'uso', `flag caiu em uso\n${ctx}`);
  }
});

/**
 * T21 (GM-10, D4): lista de leitores de git para o subagente. A guarda real (`dist/guarda.js`) por stdin, com `agent_id`,
 * cwd no principal e `cd` na worktree. Os 9 leitores passam; `tag`, `worktree`, `merge-tree`, `update-ref` seguem negados;
 * a forma de escrita `--output=<arquivo>` de `rev-list` e `diff-tree` (medida no git 2.50.1) é negada.
 * Costura (P9): `git worktree add` real → guarda por stdin com `cd <worktree> && git <leitor>` → o git roda e responde.
 *
 * MUTAÇÕES (task-21-mut.json, sobre dist/aneis.js): G1 liberar `tag` e `worktree` · G2 sem a negação de `--output` ·
 * G3 tirar `name-rev` da lista · G4 abreviação de `--output` deixa de ser negada.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, montar, rodarBruto, sessaoNova } from './_adaptador-helpers.mjs';

const SUB = { agent_id: 'a1', agent_type: 'gabarito-mestre:gabarito-implementador' };
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });

function cenario() {
  const R = montar();
  const WT = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-leitores-'))), 'wt');
  limpar.push(R, join(WT, '..'));
  git(R, 'worktree', 'add', '-q', '-b', 'wt/GM-99-T1', WT);
  git(R, 'tag', 'v0');
  return { R, WT };
}

function hook(R, cwd, command, sub = true) {
  const entrada = { tool_name: 'Bash', tool_input: { command }, permission_mode: 'default', session_id: sessaoNova(), cwd, hook_event_name: 'PreToolUse', ...(sub ? SUB : {}) };
  const r = rodarBruto(JSON.stringify(entrada), { repo: R, cwd });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

const LEITORES = [
  'ls-tree HEAD', 'cat-file -p HEAD', 'rev-list HEAD', 'show-ref', 'for-each-ref', 'describe --always',
  'diff-tree --no-commit-id --name-only -r HEAD', 'shortlog -s HEAD', 'name-rev HEAD',
];

describe('T21: leitores de git passam para o subagente', () => {
  const { R, WT } = cenario();
  for (const cmd of LEITORES) {
    test(`leitor-${cmd.split(' ')[0]}: cwd no principal, cd na worktree e -C`, () => {
      for (const [rotulo, cwd, linha] of [['principal', R, `git ${cmd}`], ['cd wt', R, `cd ${WT} && git ${cmd}`], ['-C wt', R, `git -C ${WT} ${cmd}`], ['cwd wt', WT, `git ${cmd}`]]) {
        const r = hook(R, cwd, linha);
        assert.equal(r.decisao, undefined, `${rotulo}: ${linha} => ${r.decisao} ${r.motivo}`);
      }
    });
  }

  test('costura: a guarda libera e o git de verdade responde na worktree', () => {
    const linha = `cd ${WT} && git cat-file -t HEAD`;
    assert.equal(hook(R, R, linha).decisao, undefined);
    const r = spawnSync('git', ['cat-file', '-t', 'HEAD'], { cwd: WT, encoding: 'utf8' });
    assert.equal(r.stdout.trim(), 'commit');
  });

  test('cat-file em caminho de .git e git -C <principal>/.git: nem regride nem libera leitura do segredo', () => {
    // Sem regressão: o veredito é o mesmo de `git show` / `git log` nas mesmas formas (já na lista).
    for (const [leitor, referencia] of [['cat-file -p', 'show'], ['rev-list', 'log']]) {
      for (const alvo of [`${R}/.git/HEAD`, `${R}/.git/config`]) {
        const novo = hook(R, R, `git ${leitor} ${alvo}`).decisao;
        const velho = hook(R, R, `git ${referencia} ${alvo}`).decisao;
        assert.equal(novo, velho, `${leitor} ${alvo} diverge de ${referencia}`);
      }
      const novo = hook(R, R, `git -C ${R}/.git ${leitor} HEAD`).decisao;
      const velho = hook(R, R, `git -C ${R}/.git ${referencia} HEAD`).decisao;
      assert.equal(novo, velho, `-C .git: ${leitor} diverge de ${referencia}`);
    }
    assert.equal(hook(R, R, 'git cat-file -p HEAD:.env').decisao, hook(R, R, 'git show HEAD:.env').decisao);
  });

  test('o orquestrador segue como antes: leitor passa em silêncio', () => {
    for (const cmd of LEITORES) assert.equal(hook(R, R, `git ${cmd}`, false).decisao, undefined, cmd);
  });
});

describe('T21: o que segue negado ao subagente', () => {
  const { R, WT } = cenario();
  const NEGADOS = [
    'tag v1', 'tag -d v0', 'worktree add ../x', 'worktree remove x', 'merge-tree HEAD HEAD HEAD', 'update-ref refs/heads/x HEAD',
    'rev-list --output=z HEAD', 'rev-list --output z HEAD', 'diff-tree --output=z HEAD HEAD', 'diff-tree -r --output z HEAD HEAD',
    'rev-list --out=z HEAD', 'rev-list --outpu=z HEAD',
  ];
  for (const cmd of NEGADOS) {
    test(`negado: git ${cmd}`, () => {
      for (const [cwd, linha] of [[R, `git ${cmd}`], [R, `cd ${WT} && git ${cmd}`]]) {
        const r = hook(R, cwd, linha);
        assert.equal(r.decisao, 'deny', `${linha} => ${r.decisao}`);
      }
    });
  }

  test('--output-indicator-new é opção de cor, não escrita: o diff-tree passa', () => {
    const r = hook(R, R, 'git diff-tree --output-indicator-new=+ -r HEAD HEAD');
    assert.equal(r.decisao, undefined, r.motivo);
  });

  test('o arquivo de --output não é criado (a guarda barra antes do git rodar)', () => {
    const r = hook(R, R, `git rev-list --output=${R}/saida.txt HEAD`);
    assert.equal(r.decisao, 'deny');
  });
});

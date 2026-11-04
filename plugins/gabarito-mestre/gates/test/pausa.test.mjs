/**
 * `scripts/pausa.mjs` (GM-10, REQ-POU-2): CLI só de leitura que diz ao comando `/gabarito pausar|retomar` o estado da pausa
 * e o `alvo` onde gravar, com as MESMAS funções da guarda (`dist/guarda.js`). Medido: `CLAUDE_PROJECT_DIR` não chega ao Bash,
 * então o CLI parte do cwd; a guarda real é a prova de que os dois concordam.
 *
 * MUTAÇÕES PRESCRITAS (task-12-r2-mut.json):
 *  M7  CLI usa `process.cwd()` em vez da raiz do repo ⇒ `pausa-mesma-raiz` falha
 *  M8  `alvo` = raiz do cwd em vez do principal ⇒ `pausa-mesma-raiz` falha (worktree)
 *  M9  CLI ignora `ilegivel` ⇒ `pausa-ilegivel` falha
 *  M10 sem raiz, rc 0 ⇒ `pausa-fora-de-repo` falha
 *  M11 `existentes` só com `alvo` ⇒ `pausa-so-na-worktree` falha
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, rodar } from './_adaptador-helpers.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pausa.mjs');

/** Roda o CLI como o Bash da sessão o roda: sem `CLAUDE_PROJECT_DIR`. */
function cli(cwd) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [CLI], { cwd, env, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* sem JSON */ }
  return { rc: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

/** Repo (com ou sem espaço no caminho) + worktree de task + subdiretórios. */
function cenario({ espaco }) {
  const pai = realpathSync(mkdtempSync(join(tmpdir(), 'gm-pausa-')));
  const repo = join(pai, espaco ? 'meu repo' : 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  const wt = join(pai, espaco ? 'minha wt' : 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-1', wt);
  for (const raiz of [repo, wt]) mkdirSync(join(raiz, 'sub', 'dir'), { recursive: true });
  return { pai, repo, wt };
}
const pausar = (raiz) => {
  mkdirSync(join(raiz, '.harness'), { recursive: true });
  writeFileSync(join(raiz, '.harness', 'PAUSAR'), 'pausado\n');
};
const arvore = (raiz) => readdirSync(raiz, { recursive: true }).sort().join('\n');

describe('pausa.mjs', () => {
  for (const espaco of [false, true]) {
    test(`pausa-mesma-raiz: alvo é o principal e o CLI concorda com a guarda real, de qualquer cwd (espaço no caminho: ${espaco})`, () => {
      const { repo, wt } = cenario({ espaco });
      for (const cwd of [repo, join(repo, 'sub', 'dir'), wt, join(wt, 'sub', 'dir')]) {
        const antes = cli(cwd);
        assert.equal(antes.rc, 0, `${cwd}: ${antes.stderr}`);
        assert.deepEqual(antes.json, { pausado: false, ilegivel: false, alvo: repo, existentes: [] }, cwd);
      }
      pausar(repo);
      for (const cwd of [repo, join(repo, 'sub', 'dir'), wt, join(wt, 'sub', 'dir')]) {
        const depois = cli(cwd);
        assert.equal(depois.json.pausado, true, cwd);
        assert.equal(depois.json.alvo, repo, cwd);
        assert.deepEqual(depois.json.existentes, [repo], cwd);
        const guarda = rodar(repo, 'Agent', { description: 'x', prompt: 'y' }, { cwd });
        assert.equal(guarda.decisao, 'deny', `a guarda nega em ${cwd}: o CLI não pode dizer outra coisa`);
      }
    });
  }

  test('pausa-so-na-worktree: arquivo só na worktree, cwd nela: existentes lista a worktree e alvo continua o principal', () => {
    const { repo, wt } = cenario({ espaco: false });
    pausar(wt);
    const r = cli(wt);
    assert.equal(r.json.pausado, true);
    assert.equal(r.json.alvo, repo);
    assert.deepEqual(r.json.existentes, [wt]);
  });

  test('pausa-ilegivel: ponteiro da worktree ilegível ⇒ pausado, ilegivel, sem alvo (nunca libera)', () => {
    const { wt } = cenario({ espaco: false });
    chmodSync(join(wt, '.git'), 0o000);
    try {
      const r = cli(wt);
      assert.equal(r.rc, 0, r.stderr);
      assert.deepEqual(r.json, { pausado: true, ilegivel: true, alvo: null, existentes: [] });
    } finally {
      chmodSync(join(wt, '.git'), 0o644);
    }
  });

  test('pausa-diretorio: .harness/PAUSAR que é diretório conta como pausado', () => {
    const { repo } = cenario({ espaco: false });
    mkdirSync(join(repo, '.harness', 'PAUSAR'), { recursive: true });
    const r = cli(repo);
    assert.equal(r.json.pausado, true);
    assert.deepEqual(r.json.existentes, [repo]);
  });

  test('pausa-fora-de-repo: sem repositório, rc 2 e nada de alvo (nunca rc 0)', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-pausa-fora-')));
    const r = cli(fora);
    assert.equal(r.rc, 2, r.stderr);
    assert.deepEqual(r.json, { pausado: false, ilegivel: false, alvo: null, existentes: [] });
  });

  test('pausa-so-le: o CLI não grava nem remove nada, nos dois estados', () => {
    const { pai, repo } = cenario({ espaco: false });
    const antes = arvore(pai);
    assert.notEqual(cli(repo).json, null, 'o CLI rodou');
    assert.equal(arvore(pai), antes, 'não pausado: nada criado');
    pausar(repo);
    const comPausa = arvore(pai);
    assert.equal(cli(repo).json.pausado, true);
    assert.equal(arvore(pai), comPausa, 'pausado: nada removido');
    assert.equal(readFileSync(join(repo, '.harness', 'PAUSAR'), 'utf8'), 'pausado\n');
    assert.equal(existsSync(join(repo, '.harness', 'PAUSAR')), true);
  });

  test('pausa-sem-verbo-de-escrita: o fonte não importa nem chama escrita ou remoção', () => {
    const fonte = readFileSync(CLI, 'utf8');
    assert.doesNotMatch(fonte, /writeFile|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|copyFile|rmdirSync|symlinkSync|openSync/);
  });

  test('pausa-falha-nunca-sucesso: guarda.js ausente ⇒ erro, sem JSON de sucesso', () => {
    const pai = realpathSync(mkdtempSync(join(tmpdir(), 'gm-pausa-sem-dist-')));
    mkdirSync(join(pai, 'scripts'));
    writeFileSync(join(pai, 'scripts', 'pausa.mjs'), readFileSync(CLI, 'utf8'));
    const r = spawnSync(process.execPath, [join(pai, 'scripts', 'pausa.mjs')], { cwd: pai, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, 2);
    assert.equal(r.stdout.trim(), '');
  });
});

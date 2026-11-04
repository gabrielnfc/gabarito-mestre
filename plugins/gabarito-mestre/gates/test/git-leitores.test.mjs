/**
 * T21 (GM-10, D4): lista de leitores de git para o subagente. A guarda real (`dist/guarda.js`) por stdin, com `agent_id`,
 * cwd no principal e `cd` na worktree. Os 9 leitores passam; `tag`, `worktree`, `merge-tree`, `update-ref` seguem negados;
 * `--output=<arquivo>` em QUALQUER `git` (escreve e trunca em log, diff, show, blame, shortlog, rev-list, diff-tree… no git 2.50.1;
 * o git não aceita abreviação) cai no anel: `deny` para o subagente, `ask` para o orquestrador. `--attr-source` e `--shallow-file`
 * consomem valor e não podem enganar a leitura do subcomando.
 * Costura (P9): `git worktree add` real → guarda por stdin com `cd <worktree> && git <leitor>` → o git roda e responde.
 *
 * T24 (GM-10, sombra-t13e.md "(b)"): `worktree` só com `list` em 1º e `hash-object` sem `-…w` nem `--stdin-*` passam para o subagente (leitura);
 * toda forma de escrita da tabela segue negada, nos 2 cwd. Mutações da T24 em task-24-mut.json.
 *
 * MUTAÇÕES (task-21-r2-mut.json, sobre dist/aneis.js): M1 a M9, G1 liberar `tag` e `worktree`, G3 tirar `name-rev` da lista.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
    'tag v1', 'tag -d v0', 'merge-tree HEAD HEAD HEAD', 'update-ref refs/heads/x HEAD',
    'rev-list --output=z HEAD', 'rev-list --output z HEAD', 'diff-tree --output=z HEAD HEAD', 'diff-tree -r --output z HEAD HEAD',
    'shortlog --output=z HEAD', 'shortlog --output z HEAD',
    'log --output=.env', 'log --output .env', 'log -m --output=.env', 'log -1 --format= --output=.env',
    'diff --output=z', 'show --output=z', 'blame --output=z README.md', 'stash show --output=z', 'cherry-pick --output=z',
    'log --output=.github/workflows/ci.yml', 'log --output=.git/config', 'log --output=.harness/PAUSAR',
    '--no-pager log --output=z', '-c a.b=c log --output=z', 'log "--output=z"', 'log --out"put"=z', 'log --output=$X',
    '--attr-source log tag v9', '--attr-source=HEAD tag v9', '--attr-source log update-ref refs/heads/f HEAD',
    '--attr-source log config user.name x', '--attr-source log push --force origin main', '--attr-source log remote set-url origin x',
    '--shallow-file log tag v9', '--shallow-file log push --force origin main',
  ];
  for (const cmd of NEGADOS) {
    test(`negado: git ${cmd}`, () => {
      for (const [cwd, linha] of [[R, `git ${cmd}`], [R, `cd ${WT} && git ${cmd}`]]) {
        const r = hook(R, cwd, linha);
        assert.equal(r.decisao, 'deny', `${linha} => ${r.decisao}`);
      }
    });
  }

  test('a guarda nega --output antes de o git rodar (deny, e a forma de escrita do git não é chamada)', () => {
    const r = hook(R, R, `git rev-list --output=${R}/saida.txt HEAD`);
    assert.equal(r.decisao, 'deny');
  });
});

describe('T21: --output e globais com valor, o orquestrador', () => {
  const { R } = cenario();
  const PEDE = [
    'rev-list --output=z HEAD', 'shortlog --output z HEAD', 'log --output=.env', 'log -m --output=.env', 'archive --output=z HEAD',
    '--attr-source log config user.name x', '--attr-source log remote set-url origin x', '--shallow-file log update-ref refs/heads/f HEAD',
  ];
  for (const cmd of PEDE) {
    test(`orquestrador pede: git ${cmd}`, () => {
      assert.equal(hook(R, R, `git ${cmd}`, false).decisao, 'ask');
    });
  }
});

describe('T21: leitura legítima segue em silêncio nos dois papéis', () => {
  const { R } = cenario();
  const SILENCIO = [
    'log -1 --oneline', 'log --grep=--output', 'log -S--output -1', 'log -- .env', 'commit -m "--output segue negado"',
    '--no-pager log -1', '--version', '--help', '--no-optional-locks status', '--attr-source HEAD log -1', '--attr-source=HEAD log -1',
    '--shallow-file x status', 'diff --output-indicator-new=+ HEAD', 'log --output-indicator-old=- -p -1',
  ];
  for (const cmd of SILENCIO) {
    test(`silêncio: git ${cmd}`, () => {
      for (const sub of [true, false]) {
        const r = hook(R, R, `git ${cmd}`, sub);
        assert.equal(r.decisao, undefined, `${sub ? 'subagente' : 'orquestrador'}: ${cmd} => ${r.decisao} ${r.motivo}`);
      }
    });
  }

  test('--output-indicator-new é opção de cor, não escrita: o diff-tree passa', () => {
    const r = hook(R, R, 'git diff-tree --output-indicator-new=+ -r HEAD HEAD');
    assert.equal(r.decisao, undefined, r.motivo);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T24: leitura por forma. Linha da tabela de sombra-t13e.md: [comando, subagente, orquestrador]. 'p' = passa em silêncio.
const P = 'p', D = 'deny', A = 'ask';
const TABELA_T24 = [
  ['git worktree list', P, P], ['git worktree list --porcelain', P, P], ['git worktree list -v', P, P],
  ['git worktree list --porcelain -z', P, P], ['git worktree list --expire 1.day.ago', P, P], ['git worktree list add x', P, P],
  ['git worktree list --output=z.txt', D, A], ['git worktree list .env', D, A],
  ['git worktree', D, P], ['git worktree -h', D, P], ['git worktree --x list', D, P],
  ['git worktree add ../novoW', D, P], ['git worktree add -b n ../novoW', D, P], ['git worktree remove ../W2', D, P],
  ['git worktree move ../W2 ../W3', D, P], ['git worktree prune', D, P], ['git worktree prune -n', D, P],
  ['git worktree lock ../W2', D, P], ['git worktree repair', D, P],
  // sem medição na tabela (Sombra, Testes 2): `list` fora da 1ª posição não vale
  ['git worktree add list', D, P], ['git worktree remove list', D, P],
  ['git hash-object b.txt', P, P], ['git hash-object -t blob b.txt', P, P], ['git hash-object -tblob b.txt', P, P],
  ['git hash-object --no-filters b.txt', P, P], ['git hash-object --path=a.txt b.txt', P, P], ['git hash-object --stdin < b.txt', P, P],
  ['git hash-object --write b.txt', P, P],
  ['git hash-object -- -w', D, P], ['git hash-object -w b.txt', D, P], ['git hash-object -wt blob b.txt', D, P],
  ['git hash-object -t blob -w b.txt', D, P], ['git hash-object b.txt -w', D, P], ['git hash-object --stdin -w < b.txt', D, P],
  ['git hash-object -w --stdin-paths < paths.txt', D, P], ['git hash-object "-w" b.txt', D, P], ['git hash-object \\-w b.txt', D, P],
  ['git hash-object --output=z.txt b.txt', D, A],
  ['git hash-object .env', D, A], ['git hash-object --path=.env b.txt', D, A], ['git hash-object --stdin < .env', D, A],
  ['git hash-object --stdin-paths < paths.txt', D, P], ['echo .env | git hash-object --stdin-paths', D, P], ['echo .env | git hash-object --stdin-p', D, P],
  // limites declarados (Q14): indireção e `-c filter.*`; já valem para `git add`, permitido
  ['F=-w; git hash-object $F b.txt', P, P], ['git hash-object $(echo -w) b.txt', P, P], ['git hash-object `echo -w` b.txt', P, P],
  ['git -c filter.x.clean="touch pwn" hash-object a.txt', P, P],
];

describe('T24: worktree list e hash-object sem gravar (tabela da Sombra), nos 2 cwd e com -C', () => {
  const { R, WT } = cenario();
  const quando = (v) => (v === P ? undefined : v);
  for (const [cmd, sub, orq] of TABELA_T24) {
    test(`T24 ${cmd}`, () => {
      const formas = [['principal', R, cmd], ['cd wt', R, `cd ${WT} && ${cmd}`], ['cwd wt', WT, cmd]];
      // `-C` só onde o git vem em 1º lugar na linha.
      if (cmd.startsWith('git ')) formas.push(['-C wt', R, `git -C ${WT} ${cmd.slice(4)}`]);
      for (const [rotulo, cwd, linha] of formas) {
        assert.equal(hook(R, cwd, linha).decisao, quando(sub), `subagente, ${rotulo}: ${linha}`);
        assert.equal(hook(R, cwd, linha, false).decisao, quando(orq), `orquestrador, ${rotulo}: ${linha}`);
      }
    });
  }
});

describe('T24: costura real, a guarda libera e o git responde sem mexer em .git; a forma negada escreve', () => {
  const { R, WT } = cenario();
  /** Hash de todo arquivo em .git, menos o `index` (o git atualiza o stat cache ao ler). */
  function foto(raiz) {
    const out = {};
    const ande = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const c = join(d, e.name);
        if (e.isDirectory()) ande(c);
        else if (c !== join(raiz, 'index')) out[c.slice(raiz.length)] = `${statSync(c).size}:${readFileSync(c).toString('base64')}`;
      }
    };
    ande(raiz);
    return out;
  }
  const rodar = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

  test('worktree list e hash-object: liberados, respondem, .git igual', () => {
    writeFileSync(join(R, 'b.txt'), 'conteudo novo da T24\n');
    const antes = foto(join(R, '.git'));
    for (const [linha, args] of [[`cd ${WT} && git worktree list`, ['worktree', 'list']], [`git hash-object b.txt`, ['hash-object', 'b.txt']]]) {
      assert.equal(hook(R, R, linha).decisao, undefined, linha);
      const r = rodar(R, ...args);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.trim().length > 0, `${linha} respondeu`);
    }
    assert.deepEqual(foto(join(R, '.git')), antes, 'ler não gravou nada em .git');
  });

  test('hash-object -w grava em .git (a forma negada escreve) e a guarda a nega', () => {
    writeFileSync(join(R, 'c.txt'), 'outro conteudo da T24\n');
    assert.equal(hook(R, R, 'git hash-object -w c.txt').decisao, 'deny');
    const antes = foto(join(R, '.git'));
    const r = rodar(R, 'hash-object', '-w', 'c.txt');
    assert.equal(r.status, 0, r.stderr);
    assert.notDeepEqual(foto(join(R, '.git')), antes, '-w muda .git');
  });
});

/**
 * REQ-LOOP-3 e REQ-LOOP-2 pela borda: `loop.mjs` (worktree por task, integração com gate, próxima ação).
 * Repositório git temporário por caso; nada fixo do repo do plugin. Banco e git com falha injetada por ferramenta falsa.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte): task-6-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync, chmodSync, readdirSync, appendFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { marcaPronto } from '../scripts/db-template.mjs';
import { slotsDaCapacidade } from '../scripts/loop.mjs';
import * as diario from '../dist/diario.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'loop.mjs');
const GITIGNORE_RAIZ = join(AQUI, '..', '..', '..', '..', '.gitignore');
const GIT_REAL = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

const FAKE_PSQL = String.raw`
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const argv = process.argv.slice(2);
const sql = argv[argv.indexOf('-c') + 1];
appendFileSync(process.env.FAKE_LOG, sql + '\n');
const ESTADO = process.env.FAKE_STATE;
const st = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { dbs: {} };
const salvar = () => writeFileSync(ESTADO, JSON.stringify(st));
const erro = (m, c = 1) => { process.stderr.write(m + '\n'); process.exit(c); };
if (process.env.FAKE_FAIL && new RegExp(process.env.FAKE_FAIL).test(sql)) erro('ERROR: falha injetada');
const un = (s) => s.replaceAll('""', '"').replaceAll("''", "'");
let m;
if ((m = /^SELECT 'E:' \|\| coalesce\(shobj_description\(oid, 'pg_database'\), ''\) FROM pg_database WHERE datname = '((?:[^']|'')*)'$/.exec(sql))) {
  const d = st.dbs[un(m[1])];
  process.stdout.write(d ? 'E:' + (d.comment ?? '') + '\n' : '');
} else if ((m = /^CREATE DATABASE "((?:[^"]|"")*)"(?: TEMPLATE "((?:[^"]|"")*)")?$/.exec(sql))) {
  const nome = un(m[1]);
  if (st.dbs[nome]) erro('ERROR: already exists');
  st.dbs[nome] = {}; salvar();
} else if ((m = /^COMMENT ON DATABASE "((?:[^"]|"")*)" IS '((?:[^']|'')*)'$/.exec(sql))) {
  const d = st.dbs[un(m[1])]; if (!d) erro('ERROR: does not exist');
  d.comment = un(m[2]); salvar();
} else if ((m = /^DROP DATABASE IF EXISTS "((?:[^"]|"")*)" WITH \(FORCE\)$/.exec(sql))) {
  delete st.dbs[un(m[1])]; salvar();
} else erro('fake: SQL desconhecido: ' + sql, 3);
`;

const GIT_ENVOLTORIO = `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [ -n "$GIT_FALHAR" ] && [[ "$*" == *"$GIT_FALHAR"* ]]; then echo "falha injetada" >&2; exit 1; fi
exec "${GIT_REAL}" "$@"
`;

const raizes = [];
const novoTmp = (prefixo) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
  raizes.push(d);
  return d;
};
after(() => {
  for (const d of raizes) {
    try { chmodSync(join(d, '.harness', 'entregas', 'GM-10'), 0o755); } catch { /* nada */ }
  }
});

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gOk = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

const CONFIG_PADRAO = { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } };
const planoDe = (tasks, entrega = 'GM-10') => ({ entrega, tasks });
const PLANO_PADRAO = planoDe([
  { id: 'T1', deps: [], arquivos: ['src/t1.txt'] },
  { id: 'T2', deps: ['T1'], arquivos: ['src/t2.txt'] },
  { id: 'T3', deps: [], arquivos: ['src/t3.txt'] },
]);

// Capacidade FALSA e medidas da máquina por variável: o teste nunca depende da máquina que o roda (REQ-SLOT-1).
const HOST_TESTE = 'host-teste';
const CAPACIDADE_PADRAO = { hostname: HOST_TESTE, slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 };
const MEDIDAS_PADRAO = { GABARITO_CAP_HOSTNAME: HOST_TESTE, GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };

function ambiente({ branch = 'enabler/GM-10-loop', config = CONFIG_PADRAO, plano = PLANO_PADRAO, gitignore = true, capacidade = CAPACIDADE_PADRAO } = {}) {
  const dir = novoTmp('loop-cli-');
  g(dir, 'init', '-q', '-b', branch);
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.txt'), 'ORIG\n');
  writeFileSync(join(dir, 'harness.config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  if (gitignore) writeFileSync(join(dir, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  if (plano !== null) writeFileSync(join(entregas, 'plano.json'), typeof plano === 'string' ? plano : JSON.stringify(plano));
  const ferramentas = novoTmp('loop-ferr-');
  const bin = join(ferramentas, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), GIT_ENVOLTORIO, { mode: 0o755 });
  const psqlDir = join(ferramentas, 'pg');
  mkdirSync(psqlDir);
  writeFileSync(join(psqlDir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(psqlDir, 'psql'), FAKE_PSQL);
  const gitLog = join(ferramentas, 'git.log');
  const psqlLog = join(ferramentas, 'psql.log');
  const estado = join(ferramentas, 'estado.json');
  writeFileSync(gitLog, '');
  writeFileSync(psqlLog, '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_LOG: gitLog, FAKE_LOG: psqlLog, FAKE_STATE: estado, ...MEDIDAS_PADRAO };
  for (const k of Object.keys(env)) if (/^(PG|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR))/i.test(k) || k === 'GABARITO_POUSO_X') delete env[k];
  // estado local, fora do git (como o .gitignore do repo faz com .harness/capacidade.json): não suja a árvore dos gates
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '.harness/capacidade.json\n');
  if (capacidade !== null) writeFileSync(join(dir, '.harness', 'capacidade.json'), typeof capacidade === 'string' ? capacidade : JSON.stringify(capacidade));
  delete env.GIT_FALHAR;
  let seq = 0;
  const amb = {
    dir, entregas, env, gitLog, psqlLog, estado, psql: join(psqlDir, 'psql'),
    wt: (t) => join(dir, '.harness', 'worktrees', t),
    cli(args, { cwd = dir, extra = {} } = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
      return { rc: r.status, j, out: r.stdout, err: r.stderr };
    },
    eventos: () => diario.ler(entregas),
    tipos: () => diario.ler(entregas).map((e) => e.tipo),
    semear(lista) {
      for (const [tipo, dados] of lista) {
        seq += 1;
        const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
        const r = diario.append(entregas, 'loop', { ts, autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    commitNaWt(t, arquivo, conteudo = 'x\n', msg = 'feat(GM-10): trabalho') {
      const w = join(dir, '.harness', 'worktrees', t);
      mkdirSync(dirname(join(w, arquivo)), { recursive: true });
      writeFileSync(join(w, arquivo), conteudo);
      g(w, 'add', arquivo);
      g(w, 'commit', '-q', '-m', msg);
    },
    /** abrir → iniciar → commit → concluir → revisor → APROVADO. Devolve a worktree. */
    aprovar(t, arquivo = `src/${t.toLowerCase()}.txt`, extras = []) {
      for (const a of [['abrir', t], ['iniciar', t, 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
      amb.commitNaWt(t, arquivo);
      for (const [f, conteudo] of extras) amb.commitNaWt(t, f, conteudo);
      for (const a of [['concluir', t], ['iniciar', t, 'revisor'], ['veredito', t, 'APROVADO', '1', '0', '0']]) {
        const r = amb.cli(a);
        assert.equal(r.rc, 0, `${a.join(' ')} ${r.out}`);
      }
      return amb.wt(t);
    },
    comBanco(extra = {}) {
      writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({
        ...CONFIG_PADRAO, db: { psql: [process.execPath, join(psqlDir, 'psql')], template: 'gm_tpl', ...extra },
      }));
      g(dir, 'add', 'harness.config.json');
      g(dir, 'commit', '-q', '-m', 'chore: db');
      writeFileSync(estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment: marcaPronto('S1'), template: true } } }));
    },
    bancos: () => (existsSync(estado) ? Object.keys(JSON.parse(readFileSync(estado, 'utf8')).dbs) : []),
    sqls: () => readFileSync(psqlLog, 'utf8').split('\n').filter(Boolean),
    gitChamadas: () => readFileSync(gitLog, 'utf8').split('\n').filter(Boolean),
    branches: () => g(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n'),
    topo: (ref = 'HEAD') => g(dir, 'rev-parse', ref).trim(),
  };
  return amb;
}

const semEfeito = (amb) => ({ branches: amb.branches().join(','), topo: amb.topo(), eventos: amb.eventos().length, wts: existsSync(join(amb.dir, '.harness', 'worktrees')) ? readdirSync(join(amb.dir, '.harness', 'worktrees')).join(',') : '' });

describe('.gitignore da raiz', () => {
  test('gitignore-da-raiz-ignora-worktrees', () => {
    const linhas = readFileSync(GITIGNORE_RAIZ, 'utf8').split('\n').map((l) => l.trim());
    assert.ok(linhas.includes('.harness/worktrees/'));
  });
});

describe('abrir', () => {
  test('abrir-cria-branch-e-worktree', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.branch, 'wt/GM-10-T1');
    assert.equal(realpathSync(r.j.worktree), realpathSync(amb.wt('T1')));
    assert.equal(r.j.banco, 'n/a');
    assert.ok(amb.branches().includes('wt/GM-10-T1'));
    assert.equal(g(amb.wt('T1'), 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'wt/GM-10-T1');
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), amb.topo());
    assert.equal(amb.eventos().length, 0, 'abrir não grava evento');
  });

  test('abrir-exporta-tmpdir-e-nao-suja-git-status', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    assert.equal(realpathSync(r.j.tmpdir), realpathSync(tmp));
    assert.equal(realpathSync(r.j.env.TMPDIR), realpathSync(tmp));
    assert.ok(existsSync(tmp));
    writeFileSync(join(tmp, 'lixo.bin'), 'x');
    mkdirSync(join(tmp, 'sub'));
    writeFileSync(join(tmp, 'sub', 'y'), 'y');
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '', 'TMPDIR não pode sujar o status');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '', 'nem o da raiz principal');
  });

  test('abrir-branch-existente-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'branch', 'wt/GM-10-T1');
    const antes = semEfeito(amb);
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /branch_existe/);
    assert.deepEqual(semEfeito(amb), antes);
  });

  test('abrir-branch-existente-com-outra-caixa-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'branch', 'wt/gm-10-t1');
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /branch_existe/);
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('abrir-worktree-existente-recusa', () => {
    const amb = ambiente();
    mkdirSync(amb.wt('T1'), { recursive: true });
    writeFileSync(join(amb.wt('T1'), 'meu.txt'), 'importa');
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /worktree_existe/);
    assert.equal(readFileSync(join(amb.wt('T1'), 'meu.txt'), 'utf8'), 'importa');
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
  });

  test('abrir-worktree-com-outra-caixa-recusa', () => {
    const amb = ambiente();
    mkdirSync(join(amb.dir, '.harness', 'worktrees', 't1'), { recursive: true });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /worktree_existe/);
  });

  test('abrir-sem-commit-no-principal-detached-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'checkout', '-q', '--detach');
    const r = amb.cli(['abrir', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /principal_sem_branch/);
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
  });

  test('abrir-de-dentro-de-uma-worktree-acha-a-raiz-principal', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    const r = amb.cli(['abrir', 'T3'], { cwd: amb.wt('T1') });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.wt('T3'), '.git')));
    assert.ok(!existsSync(join(amb.wt('T1'), '.harness', 'worktrees')), 'nada aninhado na worktree');
    const p = amb.cli(['proxima'], { cwd: amb.wt('T1') });
    assert.equal(p.rc, 0, p.out + p.err);
  });

  test('abrir-fora-de-repo-da-json-e-rc-1', () => {
    const fora = novoTmp('loop-fora-');
    const r = spawnSync(process.execPath, [SCRIPT, 'abrir', 'T1', '--entrega', 'GM-10'], { cwd: fora, encoding: 'utf8', env: ambiente().env });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).ok, false);
  });
});

describe('ids e plano', () => {
  const RUINS = ['../x', 'a/b', '-x', 'a b', '', '..', '.', 'T1;rm', 'T1\n', '--entrega', 'a\\b', 'T1.lock'];

  test('id-ruim-recusa-antes-de-qualquer-efeito', () => {
    const amb = ambiente();
    const antes = semEfeito(amb);
    const antesGit = amb.gitChamadas().length;
    for (const cmd of ['abrir', 'iniciar', 'concluir', 'integrar', 'fechar', 'reabrir', 'veredito']) {
      for (const id of RUINS) {
        const args = cmd === 'iniciar' ? [cmd, id, 'implementador'] : cmd === 'veredito' ? [cmd, id, 'APROVADO', '1', '0', '0'] : [cmd, id];
        const r = amb.cli(args);
        assert.notEqual(r.rc, 0, `${cmd} ${JSON.stringify(id)}`);
        assert.equal(r.j?.ok, false, `${cmd} ${JSON.stringify(id)}: ${r.out}`);
      }
    }
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(amb.gitChamadas().length, antesGit, 'nenhum git rodou: a forma é conferida antes de tocar o repositório');
  });

  test('entrega-ruim-recusa', () => {
    const amb = ambiente();
    for (const e of ['../x', '-x', 'a b', 'gm-10', 'GM-10/x', 'GM10']) {
      const r = amb.cli(['abrir', 'T1', '--entrega', e]);
      assert.equal(r.rc, 1, e);
      assert.equal(r.j.ok, false);
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('entrega-inferida-da-branch', () => {
    const amb = ambiente({ branch: 'enabler/GM-10-loop' });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out + r.err);
  });

  test('entrega-sem-id-na-branch-e-sem-flag-recusa', () => {
    const amb = ambiente({ branch: 'principal' });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /entrega/);
    assert.equal(amb.cli(['proxima', '--entrega', 'GM-10']).rc, 0);
  });

  test('plano-ids-colidem-por-caixa-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['a'] }, { id: 't1', deps: [], arquivos: ['b'] }]) });
    for (const a of [['abrir', 'T1'], ['proxima']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.match(r.j.erro, /plano_invalido/);
      assert.match(r.j.mensagem, /colidem.*caixa/);
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('plano-ids-colidem-no-banco-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T-1', deps: [], arquivos: ['a'] }, { id: 'T1', deps: [], arquivos: ['b'] }]) });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /plano_invalido/);
  });

  test('plano-com-id-de-forma-ruim-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: '../x', deps: [], arquivos: ['a'] }]) });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /plano_invalido/);
  });

  test('plano-com-entrega-diferente-da-pasta-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['a'] }], 'GM-99') });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /plano_invalido/);
  });

  test('proxima-sem-plano-mensagem', () => {
    const amb = ambiente({ plano: null });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'plano_ausente');
    assert.match(r.j.mensagem, /plano\.json/);
  });

  test('plano-corrompido-nao-vira-acao', () => {
    for (const bruto of ['{nao e json', '[]', '{"entrega":"GM-10","tasks":"x"}', '']) {
      const amb = ambiente({ plano: bruto });
      for (const a of [['proxima'], ['abrir', 'T1'], ['integrar', 'T1']]) {
        const r = amb.cli(a);
        assert.equal(r.rc, 1, `${bruto} ${a.join(' ')}`);
        assert.equal(r.j.erro, 'plano_invalido');
      }
    }
  });

  test('task-fora-do-plano-recusa', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T9'], ['integrar', 'T9'], ['iniciar', 'T9', 'implementador'], ['fechar', 'T9']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.equal(r.j.erro, 'task_fora_do_plano');
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('arquivos-com-glob-recusa-antes-do-efeito', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/*.txt'] }]) });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'plano_invalido');
    assert.equal(semEfeito(amb).wts, '');
  });

  test('arquivos-vazio-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: [] }]) });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'plano_invalido');
  });

  test('arquivos-diretorio-vira-escopo-de-diretorio', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/dir'] }]) });
    amb.aprovar('T1', 'src/dir/x.txt');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.dir, 'src/dir/x.txt')));
  });

  test('arquivos-diretorio-nao-aprova-arquivo-de-fora', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/dir'] }]) });
    amb.aprovar('T1', 'src/dir/x.txt', [['src/outro.txt', 'x\n']]);
    const antes = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /fora do escopo/);
    assert.equal(amb.topo(), antes);
  });
});

describe('comandos que gravam', () => {
  test('iniciar-grava-task-iniciada', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos();
    assert.equal(e.length, 1);
    assert.equal(e[0].tipo, 'task.iniciada');
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador' });
    assert.equal(e[0].agente, 'orquestrador');
  });

  test('iniciar-papel-invalido-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    for (const p of ['dono', 'root', '', 'Implementador']) {
      const r = amb.cli(['iniciar', 'T1', p]);
      assert.equal(r.rc, 1, p);
    }
    assert.equal(amb.eventos().length, 0);
  });

  test('iniciar-sem-worktree-recusa', () => {
    const amb = ambiente();
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_ausente');
    assert.equal(amb.eventos().length, 0);
  });

  test('iniciar-em-estado-que-a-tabela-nao-aceita-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.equal(amb.eventos().length, 1);
  });

  test('concluir-grava-task-concluida-e-recusa-fora-de-ordem', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    assert.equal(amb.cli(['concluir', 'T1']).rc, 1, 'pendente não conclui');
    assert.equal(amb.eventos().length, 0);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const r = amb.cli(['concluir', 'T1']);
    assert.equal(r.rc, 0);
    assert.equal(amb.tipos().at(-1), 'task.concluida');
  });

  test('veredito-grava-review-veredito', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const v = amb.eventos().at(-1);
    assert.equal(v.tipo, 'review.veredito');
    assert.deepEqual(v.dados, { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
  });

  test('veredito-argumentos-invalidos-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.cli(['concluir', 'T1']);
    const antes = amb.eventos().length;
    const ruins = [
      ['TALVEZ', '1', '0', '0'], ['aprovado', '1', '0', '0'], ['APROVADO', '0', '0', '0'], ['APROVADO', '-1', '0', '0'],
      ['APROVADO', 'x', '0', '0'], ['APROVADO', '1', '-1', '0'], ['APROVADO', '1', '0', '-3'], ['APROVADO', '1', 'a', '0'],
      ['APROVADO', '1.5', '0', '0'], ['APROVADO', '01', '0', '0'], ['APROVADO', '1', '0'], ['APROVADO', '1', '0', '0', '9'],
      ['APROVADO', '1e3', '0', '0'], ['APROVADO', '', '0', '0'], ['APROVADO', ' 1', '0', '0'],
    ];
    for (const a of ruins) {
      const r = amb.cli(['veredito', 'T1', ...a]);
      assert.notEqual(r.rc, 0, a.join(' '));
      assert.equal(r.j?.ok, false, a.join(' '));
    }
    assert.equal(amb.eventos().length, antes);
  });

  test('veredito-aprovado-com-achado-recusa-sem-gravar', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.cli(['concluir', 'T1']);
    const antes = amb.eventos().length;
    const r = amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.match(r.j.mensagem, /veredito\.aprovado\.com_achado em concluida/);
    assert.equal(amb.eventos().length, antes);
  });

  test('veredito-com-rodada-fora-de-sequencia-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.cli(['concluir', 'T1']);
    const r = amb.cli(['veredito', 'T1', 'REPROVADO', '2', '1', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
  });

  test('evento-atrasado-depois-do-dono-nao-invalida-o-diario', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 1, major: 0 }],
      ['task.iniciada', { task: 'T1', papel: 'correcao' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
      ['task.reaberta', { task: 'T1', origem: 'dono' }],
    ]);
    const antes = amb.eventos().length;
    for (const a of [['concluir', 'T1'], ['veredito', 'T1', 'APROVADO', '1', '0', '0'], ['veredito', 'T1', 'REPROVADO', '2', '0', '1']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.equal(r.j.erro, 'transicao_invalida');
      assert.match(r.j.mensagem, / em pendente|fora de sequência/);
    }
    assert.equal(amb.eventos().length, antes, 'nada gravado');
    const p = amb.cli(['proxima']);
    assert.equal(p.rc, 0, p.out);
    assert.notEqual(p.j.acao.motivo, 'diario_invalido');
    assert.equal(p.j.acao.tipo, 'despachar');
  });

  test('reabrir-so-grava-origem-retomada', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const r = amb.cli(['reabrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'task.reaberta');
    assert.deepEqual(e.dados, { task: 'T1', origem: 'retomada' });
  });

  test('reabrir-nao-tem-argumento-que-produza-dono', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const antes = amb.eventos().length;
    for (const a of [['--origem', 'dono'], ['--origem=dono'], ['dono'], ['--dono'], ['origem', 'dono'], ['--origem', 'retomada']]) {
      const r = amb.cli(['reabrir', 'T1', ...a]);
      assert.equal(r.rc, 2, a.join(' '));
    }
    assert.equal(amb.eventos().length, antes);
    const t = amb.eventos().filter((e) => e.dados?.origem === 'dono');
    assert.equal(t.length, 0);
  });

  test('parar-grava-loop-parar-e-recusa-motivo-invalido', () => {
    const amb = ambiente();
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'loop.parar');
    assert.deepEqual(e.dados, { motivo: 'nao_conseguiu' });
    for (const m of ['', 'porque sim', 'rm -rf /', '../x']) assert.equal(amb.cli(['parar', m]).rc, 1, m);
    assert.equal(amb.eventos().length, 1);
  });

  test('parar-grava-mesmo-com-diario-invalido', () => {
    const amb = ambiente();
    amb.semear([['task.concluida', { task: 'T1' }]]);
    const r = amb.cli(['parar', 'diario_invalido']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.tipos().at(-1), 'loop.parar');
  });

  test('grava-recusa-diario-ilegivel', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const f = join(amb.entregas, 'events.loop.jsonl');
    appendFileSync(f, 'isto nao e json\n');
    const antes = readFileSync(f, 'utf8');
    const r = amb.cli(['concluir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel');
    assert.equal(readFileSync(f, 'utf8'), antes);
  });

  test('grava-recusa-diario-ja-invalido-de-outra-task', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.semear([['task.concluida', { task: 'T3' }]]);
    const antes = amb.eventos().length;
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_invalido');
    assert.equal(amb.eventos().length, antes);
  });

  test('gravacao-que-falha-nao-vira-sucesso', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    chmodSync(amb.entregas, 0o555);
    const r = amb.cli(['concluir', 'T1']);
    chmodSync(amb.entregas, 0o755);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'evento_nao_gravado');
  });
});

describe('integrar', () => {
  test('integrar-ff', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.equal(r.j.fechada, true);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')), 'o trabalho entrou na branch do PBI');
    assert.equal(amb.topo(), amb.topo('wt/GM-10-T1'));
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: amb.topo() });
    assert.ok(!existsSync(w), 'worktree removida');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '');
  });

  test('integrar-de-dentro-de-outra-worktree-acha-a-raiz-principal', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    assert.equal(amb.cli(['abrir', 'T3']).rc, 0);
    const r = amb.cli(['integrar', 'T1'], { cwd: amb.wt('T3') });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('integrar-rebaseia-sobre-a-branch-do-pbi', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(g(amb.dir, 'log', '--format=%s', '-3').trim().split('\n').join('|'), 'feat(GM-10): trabalho|chore: avanca|chore: base');
  });

  test('integrar-recusa-sem-podeintegrar', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/t1.txt');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'nao_integravel');
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('integrar-recusa-dependente-com-dep-nao-integrada', () => {
    const amb = ambiente();
    amb.aprovar('T2');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T2']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'nao_integravel');
    assert.deepEqual(semEfeito(amb), antes);
  });

  test('integrar-recusa-com-diario-invalido-ou-ilegivel', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    appendFileSync(join(amb.entregas, 'events.loop.jsonl'), '{lixo\n');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel');
    assert.deepEqual(semEfeito(amb), antes);
  });

  test('integrar-recusa-worktree-suja', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    writeFileSync(join(w, 'src/t1.txt'), 'editado e nao commitado\n');
    writeFileSync(join(w, 'novo.txt'), 'x');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(readFileSync(join(w, 'novo.txt'), 'utf8'), 'x');
    assert.ok(!amb.gitChamadas().some((l) => /rebase|merge/.test(l)), 'nem rebase nem merge');
  });

  test('integrar-conflito-rebase-relata-e-nao-integra', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/a.txt'] }]) });
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/a.txt', 'TASK\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) amb.cli(a);
    writeFileSync(join(amb.dir, 'src/a.txt'), 'MAIN\n');
    g(amb.dir, 'commit', '-q', '-am', 'chore: main mexe');
    const topoMain = amb.topo();
    const topoTask = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'rebase_conflito');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.abortado, true);
    assert.equal(amb.topo(), topoMain, 'a branch do PBI não andou');
    assert.equal(amb.topo('wt/GM-10-T1'), topoTask, 'a branch da task voltou ao que era');
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '');
    assert.ok(!existsSync(join(g(amb.wt('T1'), 'rev-parse', '--git-dir').trim(), 'rebase-merge')));
    assert.ok(!amb.tipos().includes('task.integrada'));
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('integrar-conflito-com-abort-que-falha-diz-sem-apagar', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/a.txt'] }]) });
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/a.txt', 'TASK\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) amb.cli(a);
    writeFileSync(join(amb.dir, 'src/a.txt'), 'MAIN\n');
    g(amb.dir, 'commit', '-q', '-am', 'chore: main mexe');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'rebase --abort' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'rebase_conflito');
    assert.equal(r.j.abortado, false);
    assert.match(r.j.mensagem, /abort/i);
    assert.ok(existsSync(amb.wt('T1')), 'nada foi apagado');
  });

  test('integrar-recusa-gate-vermelho', () => {
    const amb = ambiente({ config: { gates: { suites: ['test ! -f src/t1.txt'] } } });
    amb.aprovar('T1');
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
    const topoMain = amb.topo();
    const revisadoAntes = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.equal(amb.topo(), topoMain, 'sem merge');
    assert.ok(!amb.tipos().includes('task.integrada'), 'sem evento');
    assert.equal(amb.topo('wt/GM-10-T1'), revisadoAntes, 'a branch voltou ao commit revisado');
    assert.ok(existsSync(amb.wt('T1')));
    assert.ok(!amb.gitChamadas().some((l) => / merge /.test(l)));
  });

  test('integrar-gate-sem-suite-reprova', () => {
    const amb = ambiente({ config: {} });
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-gate-com-config-ilegivel-reprova', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt', 'harness.config.json'] }]) });
    amb.aprovar('T1', 'src/t1.txt', [['harness.config.json', '{nao json']]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /harness\.config\.json ilegível/);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-gate-reprova-arquivo-fora-do-escopo', () => {
    const amb = ambiente();
    amb.aprovar('T1', 'src/t1.txt', [['src/intruso.txt', 'x\n']]);
    const topo = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /fora do escopo.*intruso/);
    assert.equal(amb.topo(), topo);
  });

  test('integrar-gate-recebe-tmpdir-da-worktree', () => {
    const amb = ambiente({ config: { gates: { suites: ['test "$(basename "$TMPDIR")" = .tmp-gabarito && test "$(basename "$(dirname "$TMPDIR")")" = T1 && echo "# pass 1"'] } } });
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
  });

  test('integrar-gate-usa-mutacoes-e-teste-afetado-do-plano', () => {
    const amb = ambiente({
      config: { gates: { suites: ["echo '# pass 1'"] } },
      plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], teste_afetado: 'test -f src/t1.txt && echo "# pass 1"', mutacoes: 'mut.json' }]),
    });
    writeFileSync(join(amb.dir, 'mut.json'), JSON.stringify([{ nome: 'viva', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'true' }]));
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /mutação viva VIVA/);
    assert.match(r.j.relato.join('\n'), /teste_afetado verde/);
  });

  test('integrar-mutacoes-fora-da-raiz-recusa', () => {
    // O arquivo de fora é VÁLIDO e traz uma mutação viva: sem a recusa, o gate o leria e reprovaria por outro motivo.
    const fora = join(novoTmp('loop-mut-'), 'fora.json');
    writeFileSync(fora, JSON.stringify([{ nome: 'viva', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'true' }]));
    const amb = ambiente();
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify(planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], mutacoes: `../${fora.split('/').slice(-2).join('/')}` }])));
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'mutacoes_invalidas');
    assert.match(r.j.mensagem, /fora da raiz/);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-merge-ff-falha-sem-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'merge --ff-only' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'merge_falhou');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.ok(!amb.tipos().includes('task.integrada'));
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('integrar-evento-falha-diz-que-o-merge-entrou-e-nao-fecha', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    chmodSync(amb.entregas, 0o555);
    const r = amb.cli(['integrar', 'T1']);
    chmodSync(amb.entregas, 0o755);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'evento_nao_gravado');
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, false);
    assert.match(r.j.mensagem, /merge/);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')), 'o merge entrou');
    assert.ok(existsSync(amb.wt('T1')), 'fechar não foi chamado');
    assert.ok(!amb.gitChamadas().some((l) => /worktree remove/.test(l)));
  });

  test('integrar-fechar-falha-relata-merge-e-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'fechar_falhou');
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
  });

  test('integrar-libera-dependente-na-sequencia', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    amb.aprovar('T2');
    assert.equal(amb.cli(['integrar', 'T2']).rc, 0);
    assert.ok(existsSync(join(amb.dir, 'src/t2.txt')));
    amb.aprovar('T3');
    assert.equal(amb.cli(['integrar', 'T3']).rc, 0);
    const p = amb.cli(['proxima']);
    assert.equal(p.j.acao.tipo, 'concluir');
  });
});

describe('fechar', () => {
  test('fechar-sujo-relata', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'meu-trabalho.txt'), 'nao perca');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.match(r.j.mensagem, /meu-trabalho/);
    assert.equal(readFileSync(join(w, 'meu-trabalho.txt'), 'utf8'), 'nao perca');
    assert.ok(existsSync(w));
    assert.ok(!amb.sqls().some((s) => /^DROP/.test(s)), 'o banco não foi solto');
  });

  test('fechar-tmpdir-limpo', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    mkdirSync(join(tmp, 'fundo'));
    writeFileSync(join(tmp, 'fundo', 'x.bin'), Buffer.alloc(1024));
    writeFileSync(join(tmp, 'y'), 'y');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.ok(!existsSync(amb.wt('T1')), '0 bytes sobram');
    assert.ok(!g(amb.dir, 'worktree', 'list', '--porcelain').includes('T1'));
  });

  test('fechar-nao-usa-force', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    assert.equal(amb.cli(['fechar', 'T1']).rc, 0);
    const rem = amb.gitChamadas().filter((l) => /worktree remove/.test(l));
    assert.equal(rem.length, 1);
    assert.ok(!/(^| )(-f|--force)( |$)/.test(rem[0]), rem[0]);
  });

  test('fechar-tmpdir-symlink-para-fora-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const fora = novoTmp('loop-fora-');
    writeFileSync(join(fora, 'precioso.txt'), 'vivo');
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    spawnSync('rm', ['-r', tmp]);
    symlinkSync(fora, tmp);
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'tmpdir_invalido');
    assert.equal(readFileSync(join(fora, 'precioso.txt'), 'utf8'), 'vivo');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-tmpdir-que-nao-e-diretorio-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    spawnSync('rm', ['-r', tmp]);
    writeFileSync(tmp, 'arquivo');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'tmpdir_invalido');
    assert.ok(existsSync(tmp));
  });

  test('fechar-nao-segue-symlink-interno', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const fora = novoTmp('loop-fora-');
    writeFileSync(join(fora, 'precioso.txt'), 'vivo');
    symlinkSync(fora, join(amb.wt('T1'), '.tmp-gabarito', 'atalho'));
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(readFileSync(join(fora, 'precioso.txt'), 'utf8'), 'vivo');
  });

  test('fechar-worktree-ausente-rc-1', () => {
    const amb = ambiente();
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_ausente');
  });

  test('fechar-remove-falhando-rc-1', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['fechar', 'T1'], { extra: { GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'remove_falhou');
    assert.ok(existsSync(amb.wt('T1')));
  });
});

describe('banco', () => {
  test('abrir-clona-e-fechar-solta', () => {
    const amb = ambiente();
    amb.comBanco();
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.banco, 'gm_gm10_t1');
    assert.ok(amb.bancos().includes('gm_gm10_t1'));
    const f = amb.cli(['fechar', 'T1']);
    assert.equal(f.rc, 0, f.out + f.err);
    assert.ok(!amb.bancos().includes('gm_gm10_t1'));
    assert.equal(f.j.banco, 'solto');
  });

  test('integrar-solta-o-banco-ao-fechar', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.aprovar('T1');
    assert.ok(amb.bancos().includes('gm_gm10_t1'));
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(!amb.bancos().includes('gm_gm10_t1'));
  });

  test('abrir-sem-db-declarado-segue-n-a', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0);
    assert.equal(r.j.banco, 'n/a');
    assert.equal(amb.sqls().length, 0);
  });

  test('abrir-com-db-invalido-recusa-antes-de-criar', () => {
    const amb = ambiente();
    amb.comBanco({ host: 'prod.exemplo.com' });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'db_invalido');
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('abrir-com-clone-falhando-desfaz-a-worktree', () => {
    const amb = ambiente();
    amb.comBanco();
    const r = amb.cli(['abrir', 'T1'], { extra: { FAKE_FAIL: '^CREATE DATABASE "gm_' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'banco_falhou');
    assert.equal(r.j.desfeito, true);
    assert.ok(!existsSync(amb.wt('T1')));
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!g(amb.dir, 'worktree', 'list', '--porcelain').includes('T1'));
  });

  test('abrir-com-clone-falhando-e-desfazer-falhando-relata-a-branch', () => {
    const amb = ambiente();
    amb.comBanco();
    const r = amb.cli(['abrir', 'T1'], { extra: { FAKE_FAIL: '^CREATE DATABASE "gm_', GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'banco_falhou');
    assert.equal(r.j.desfeito, false);
    assert.equal(r.j.branch, 'wt/GM-10-T1');
    assert.match(r.j.mensagem, /wt\/GM-10-T1/);
  });

  test('fechar-banco-soltar-falha-mantem-worktree', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['fechar', 'T1'], { extra: { FAKE_FAIL: '^DROP DATABASE' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'banco_nao_solto');
    assert.ok(existsSync(amb.wt('T1')));
    assert.ok(amb.bancos().includes('gm_gm10_t1'));
  });
});

describe('proxima', () => {
  test('proxima-json', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.deepEqual(r.j.acao, { tipo: 'despachar', itens: [{ task: 'T1', papel: 'implementador' }, { task: 'T3', papel: 'implementador' }] });
    assert.deepEqual(r.j.sinais, { slots: 2, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false });
    assert.equal(r.j.aviso, undefined);
    assert.equal(r.out.trim().split('\n').length, 1, 'uma linha de JSON');
  });

  test('proxima-config-slots-ausente-vale-a-medicao-sem-aviso-de-config', () => {
    for (const loop of [undefined, {}]) {
      const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, ...(loop === undefined ? {} : { loop }) } });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 0, JSON.stringify(loop) + r.out);
      assert.equal(r.j.sinais.slots, 2, JSON.stringify(loop));
      assert.equal(r.j.aviso, undefined, JSON.stringify(r.j.aviso));
    }
  });

  test('proxima-config-slots-invalido-um-slot-com-aviso (nunca sobe a medição)', () => {
    for (const loop of [{ slots: 0 }, { slots: -1 }, { slots: 'dois' }, { slots: 2.5 }, { slots: null }, 'x', null]) {
      const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, loop } });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 0, JSON.stringify(loop) + r.out);
      assert.equal(r.j.sinais.slots, 1, JSON.stringify(loop));
      assert.equal(r.j.acao.itens.length, 1);
      assert.ok(r.j.aviso.some((a) => /loop\.slots/.test(a)), JSON.stringify(loop));
    }
  });

  test('proxima-sem-config-vale-a-medicao-com-aviso-de-config', () => {
    const amb = ambiente();
    spawnSync('rm', [join(amb.dir, 'harness.config.json')]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.j.sinais.slots, 2, 'a medição não depende do config');
    assert.ok(r.j.aviso.some((a) => /harness\.config\.json ausente/.test(a)));
  });

  test('proxima-config-corrompida-rc-1', () => {
    const amb = ambiente({ config: '{nao json' });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'config_invalida');
  });

  test('proxima-vivos-ausente-vira-zero-com-aviso', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0);
    assert.equal(r.j.sinais.vivos, 0);
    assert.ok(r.j.aviso.some((a) => /vivos/.test(a)));
  });

  test('proxima-vivos-ocupam-slots', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima', '--vivos', '2']);
    assert.equal(r.rc, 0);
    assert.equal(r.j.acao.tipo, 'esperar');
    const um = amb.cli(['proxima', '--vivos', '1']);
    assert.equal(um.j.acao.itens.length, 1);
  });

  test('proxima-vivos-invalido-rc-1', () => {
    const amb = ambiente();
    for (const v of ['-1', 'x', '1.5', '', '1e2']) {
      const r = amb.cli(['proxima', '--vivos', v]);
      assert.equal(r.rc, 1, v);
      assert.equal(r.j.erro, 'argumento_invalido');
    }
  });

  test('proxima-pausar-na-raiz-principal-e-na-worktree', () => {
    const amb = ambiente();
    mkdirSync(join(amb.dir, '.harness'), { recursive: true });
    writeFileSync(join(amb.dir, '.harness', 'PAUSAR'), '');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'pausado' });
    assert.equal(r.j.sinais.pausado, true);
    spawnSync('rm', [join(amb.dir, '.harness', 'PAUSAR')]);
    assert.equal(amb.cli(['proxima', '--vivos', '0']).j.sinais.pausado, false);
    amb.cli(['abrir', 'T1']);
    mkdirSync(join(amb.wt('T1'), '.harness'), { recursive: true });
    writeFileSync(join(amb.wt('T1'), '.harness', 'PAUSAR'), '');
    const w = amb.cli(['proxima', '--vivos', '0'], { cwd: amb.wt('T1') });
    assert.equal(w.j.sinais.pausado, true);
  });

  test('proxima-diario-ilegivel-rc-1-nunca-concluir', () => {
    const casos = {
      'linha que nao e json': (f) => appendFileSync(f, 'lixo\n'),
      'cadeia de hash quebrada': (f) => {
        const linhas = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        linhas[1].hash_anterior = 'f'.repeat(64);
        writeFileSync(f, `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`);
      },
      'linha que nao e objeto': (f) => appendFileSync(f, '42\n'),
    };
    for (const [nome, estraga] of Object.entries(casos)) {
      const amb = ambiente();
      amb.semear([
        ['task.iniciada', { task: 'T1', papel: 'implementador' }],
        ['task.concluida', { task: 'T1' }],
        ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
        ['task.integrada', { task: 'T1' }],
      ]);
      estraga(join(amb.entregas, 'events.loop.jsonl'));
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 1, nome);
      assert.equal(r.j.ok, false, nome);
      assert.equal(r.j.erro, 'diario_ilegivel', nome);
      assert.notEqual(r.j.acao?.tipo, 'concluir');
    }
  });

  test('proxima-diario-que-nao-e-arquivo-regular-rc-1', () => {
    const amb = ambiente();
    mkdirSync(join(amb.entregas, 'events.x.jsonl'));
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel');
  });

  test('proxima-diario-fora-da-tabela-rc-1', () => {
    const amb = ambiente();
    amb.semear([['task.concluida', { task: 'T1' }]]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_invalido');
    assert.deepEqual(r.j.acao, { tipo: 'parar', motivo: 'diario_invalido' });
  });

  const QUATRO = planoDe(['T1', 'T2', 'T3', 'T4'].map((id) => ({ id, deps: [], arquivos: [`src/${id.toLowerCase()}.txt`] })));
  const semLoopSlots = { gates: { suites: ["echo '# pass 1'"] } };

  test('proxima-slots-medidos: slots vêm de capacidade.mjs --medido, não do config', () => {
    const amb = ambiente({ plano: QUATRO, config: semLoopSlots, capacidade: { ...CAPACIDADE_PADRAO, slots_max: 3 } });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.sinais.slots, 3);
    assert.equal(r.j.acao.itens.length, 3);
    assert.equal(r.j.aviso, undefined);
    // memória medida abaixo do necessário reduz: a medição da máquina vale, não só o arquivo
    const mem = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_CAP_MEM_MB: '2300' } });
    assert.equal(mem.j.sinais.slots, 1, 'quociente de memória: (2300 − reserva)/500 < 2');
    // carga acima da medida reduz
    const carga = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_CAP_LOAD1: '6' } });
    assert.equal(carga.j.sinais.slots, 1, 'floor(3 × 1 / 6) = 0 → 1');
    // costura (P9): redução de 3 para 2 slots passa por capacidade.mjs --medido real e chega em `aviso` do proxima
    const dois = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_CAP_MEM_MB: '3200' } });
    assert.equal(dois.j.sinais.slots, 2, '(3200 − 2048)/500 = 2');
    assert.ok(Array.isArray(dois.j.aviso), JSON.stringify(dois.j.aviso));
    assert.ok(dois.j.aviso.some((a) => /^slots: 2, mem: /.test(a)), JSON.stringify(dois.j.aviso));
    assert.ok(carga.j.aviso.some((a) => /^slots: 1, carga: /.test(a)), JSON.stringify(carga.j.aviso));
  });

  test('proxima-sem-calibracao-1-slot: arquivo ausente, corrompido, de outra máquina ou inválido ⇒ 1 slot e aviso', () => {
    const casos = {
      ausente: null,
      corrompido: '{nao json',
      'de outro hostname': { ...CAPACIDADE_PADRAO, hostname: 'outra-maquina', slots_max: 9 },
      'slots_max zero': { ...CAPACIDADE_PADRAO, slots_max: 0 },
      'campo medido zero': { ...CAPACIDADE_PADRAO, rss_pico_mb: 0, slots_max: 9 },
      'campo medido ausente': { hostname: HOST_TESTE, slots_max: 9 },
      'array': [],
    };
    for (const [nome, capacidade] of Object.entries(casos)) {
      const amb = ambiente({ plano: QUATRO, config: { ...semLoopSlots, loop: { slots: 4 } }, capacidade });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 0, `${nome}: ${r.out}${r.err}`);
      assert.equal(r.j.sinais.slots, 1, nome);
      assert.equal(r.j.acao.itens.length, 1, nome);
      assert.ok(r.j.aviso.some((a) => /slots/.test(a) && /calibr/.test(a)), `${nome}: ${JSON.stringify(r.j.aviso)}`);
    }
  });

  test('proxima-sem-calibracao-1-slot: medição da máquina falhando ou saída inválida do comando ⇒ 1 slot e aviso, nunca slots_max', () => {
    const rodar = (saida) => () => saida;
    const um = (r, rx) => { assert.equal(r.slots, 1); assert.match(r.aviso, rx); };
    um(slotsDaCapacidade('/x', rodar({ status: 1, stdout: '{"slots":9}', stderr: 'boom' })), /rc 1/);
    um(slotsDaCapacidade('/x', rodar({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' })), /SIGTERM|sinal/);
    um(slotsDaCapacidade('/x', rodar({ status: null, error: new Error('ENOENT'), stdout: '', stderr: '' })), /ENOENT/);
    um(slotsDaCapacidade('/x', rodar({ status: 0, stdout: 'isto não é json', stderr: '' })), /JSON/);
    for (const slots of [0, -1, 2.5, '9', null, undefined, Infinity, 1e21]) {
      um(slotsDaCapacidade('/x', rodar({ status: 0, stdout: JSON.stringify({ slots }), stderr: '' })), /slots/);
    }
    um(slotsDaCapacidade('/x', rodar({ status: 0, stdout: '[3]', stderr: '' })), /JSON|objeto/);
    // saída boa: o número medido passa, com o aviso do próprio capacidade.mjs quando houver
    assert.deepEqual(slotsDaCapacidade('/x', rodar({ status: 0, stdout: JSON.stringify({ slots: 3, motivo: 'slots_max 3' }), stderr: '' })), { slots: 3, aviso: null });
    assert.equal(slotsDaCapacidade('/x', rodar({ status: 0, stdout: JSON.stringify({ slots: 1, aviso: 'sem calibração' }), stderr: '' })).aviso, 'slots: sem calibração');
  });

  test('proxima-reducao-traz-motivo: motivo que não é slots_max (memória, disco, carga) aparece em aviso, somado ao aviso existente', () => {
    const rodar = (obj) => () => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });
    const carga = 'carga: load1 47.3 > 28.76 medido com 3 slot(s)';
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 1, motivo: carga })).aviso, `slots: 1, ${carga}`);
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 2, motivo: 'mem 900 MB < 2048' })).aviso, 'slots: 2, mem 900 MB < 2048');
    // aviso já existente não se perde
    const dois = slotsDaCapacidade('/x', rodar({ slots: 1, motivo: carga, aviso: 'sem calibração' })).aviso;
    assert.match(dois, /sem calibração/);
    assert.match(dois, /carga: load1 47\.3/);
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 1, motivo: carga })).slots, 1);
  });

  test('proxima-sem-reducao-sem-aviso: motivo slots_max (sem redução) não gera aviso', () => {
    const rodar = (obj) => () => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });
    assert.deepEqual(slotsDaCapacidade('/x', rodar({ slots: 3, motivo: 'slots_max 3' })), { slots: 3, aviso: null });
    assert.deepEqual(slotsDaCapacidade('/x', rodar({ slots: 3, motivo: 'slots_max' })), { slots: 3, aviso: null });
  });

  test('proxima-motivo-ausente: motivo ausente ou não texto não lança nem muda slots; sem aviso inventado', () => {
    const rodar = (obj) => () => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });
    for (const motivo of [undefined, null, 5, {}, [], true, '']) {
      const r = slotsDaCapacidade('/x', rodar(motivo === undefined ? { slots: 3 } : { slots: 3, motivo }));
      assert.deepEqual(r, { slots: 3, aviso: null }, JSON.stringify(motivo));
    }
    // aviso próprio sobrevive a motivo inválido
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 1, aviso: 'sem calibração', motivo: 7 })).aviso, 'slots: sem calibração');
  });

  test('proxima-config-so-reduz: loop.slots menor reduz; maior nunca vence a medição', () => {
    const base = { plano: QUATRO, capacidade: { ...CAPACIDADE_PADRAO, slots_max: 3 } };
    const menor = ambiente({ ...base, config: { ...semLoopSlots, loop: { slots: 1 } } }).cli(['proxima', '--vivos', '0']);
    assert.equal(menor.j.sinais.slots, 1);
    assert.equal(menor.j.aviso, undefined);
    for (const alto of [3, 4, 99, 1e9]) {
      const r = ambiente({ ...base, config: { ...semLoopSlots, loop: { slots: alto } } }).cli(['proxima', '--vivos', '0']);
      assert.equal(r.j.sinais.slots, 3, `loop.slots ${alto}`);
    }
    // loop.slots alto com calibração ausente continua 1 slot
    const sem = ambiente({ ...base, capacidade: null, config: { ...semLoopSlots, loop: { slots: 99 } } }).cli(['proxima', '--vivos', '0']);
    assert.equal(sem.j.sinais.slots, 1);
  });

  test('proxima-concluir-com-tudo-integrado', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['a'] }]) });
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
      ['task.integrada', { task: 'T1' }],
    ]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.acao, { tipo: 'concluir' });
  });

  test('proxima-integrar-quando-ha-aprovada', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(r.j.acao, { tipo: 'integrar', tasks: ['T1'] });
  });

  test('proxima-tokens-do-diario-e-teto-do-config', () => {
    const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2, tetoTokens: 1000 } } });
    amb.semear([
      ['custo.medicao', { input_tokens: 100, output_tokens: 200, cache_read: 99999, cache_creation: 50 }],
      ['custo.medicao', { input_tokens: 10, output_tokens: 20, cache_read: 0, cache_creation: 0 }],
    ]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.j.sinais.tokens, 380);
    assert.equal(r.j.sinais.tetoTokens, 1000);
    assert.equal(r.j.acao.tipo, 'despachar');
    amb.semear([['custo.medicao', { input_tokens: 700, output_tokens: 0, cache_read: 0, cache_creation: 0 }]]);
    const parou = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(parou.j.acao, { tipo: 'parar', motivo: 'teto_tokens' });
  });

  test('proxima-teto-de-tokens-invalido-rc-1', () => {
    for (const teto of [0, -5, 'muito', 1.5, null]) {
      const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2, tetoTokens: teto } } });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 1, JSON.stringify(teto));
      assert.equal(r.j.erro, 'config_invalida');
    }
  });

  test('proxima-medicao-corrompida-rc-1', () => {
    const amb = ambiente();
    amb.semear([['custo.medicao', { input_tokens: 'muitos', output_tokens: 1 }]]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_invalido');
  });

  test('proxima-x-vem-do-ambiente', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: '1' } }).j.sinais.x, 1);
    assert.equal(amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: 'abc' } }).j.sinais.x, 50);
  });
});

describe('contrato de falha', () => {
  test('comando-desconhecido-e-argumento-sobrando-sao-uso', () => {
    const amb = ambiente();
    for (const a of [[], ['voar'], ['abrir'], ['abrir', 'T1', 'T2'], ['abrir', 'T1', '--nada'], ['proxima', 'x'], ['parar'], ['parar', 'a', 'b'], ['iniciar', 'T1'], ['abrir', 'T1', '--entrega']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 2, JSON.stringify(a));
      assert.equal(r.j?.ok, false, JSON.stringify(a));
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('saida-sempre-json-em-stdout-sem-excecao-crua', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T9'], ['integrar', 'T1'], ['fechar', 'T1'], ['proxima', '--vivos', 'x'], ['voar']]) {
      const r = amb.cli(a);
      assert.ok(r.j && typeof r.j.ok === 'boolean', a.join(' ') + r.out + r.err);
      assert.ok(!/at .*loop\.mjs|node:internal/.test(r.err), r.err);
    }
  });
});

// ─────────────────────────────────────────────────────────────── rodada 2: o que o gate aprovou é o que entra
describe('integrar entra só o commit aprovado', () => {
  const nada = (amb, antes, r, erro) => {
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, erro, r.out);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(!amb.tipos().includes('task.integrada'));
  };

  test('abrir-grava-base', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(g(amb.dir, 'config', '--get', 'branch.wt/GM-10-T1.gabaritoBase').trim(), 'enabler/GM-10-loop');
  });

  test('concluir-grava-sha', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const concl = amb.eventos().find((e) => e.tipo === 'task.concluida');
    assert.equal(concl.dados.sha, amb.topo('wt/GM-10-T1'));
    assert.match(concl.dados.sha, /^[0-9a-f]{40}$/);
  });

  test('integrada-grava-sha', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const ev = amb.eventos().at(-1);
    assert.equal(ev.tipo, 'task.integrada');
    assert.equal(ev.dados.sha, amb.topo());
    assert.ok(amb.gitChamadas().some((l) => new RegExp(`merge --ff-only ${ev.dados.sha}$`).test(l)), 'merge por sha, não por nome de ref');
  });

  test('integrar-commit-fora-do-gate-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    amb.commitNaWt('T1', 'FORA.txt', 'fora do escopo\n', 'lixo sem padrao');
    g(w, 'checkout', '-q', '-b', 'limpa', 'HEAD~1');
    amb.commitNaWt('T1', 'src/t1.txt', 'limpo\n');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'head_divergente');
    assert.ok(!existsSync(join(amb.dir, 'FORA.txt')));
  });

  test('integrar-head-solto-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    g(w, 'checkout', '-q', '--detach');
    amb.commitNaWt('T1', 'src/solto.txt');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'head_divergente');
    assert.ok(!existsSync(join(amb.dir, 'src/solto.txt')));
  });

  test('integrar-outra-branch-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    g(w, 'checkout', '-q', '-b', 'outra');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'head_divergente');
  });

  test('integrar-principal-em-outra-base-recusa', () => {
    for (const outra of ['main', 'GM-99-outro']) {
      const amb = ambiente();
      amb.aprovar('T1');
      g(amb.dir, 'checkout', '-q', '-b', outra);
      const antes = semEfeito(amb);
      nada(amb, antes, amb.cli(['integrar', 'T1', '--entrega', 'GM-10']), 'base_divergente');
      assert.equal(amb.topo('enabler/GM-10-loop'), amb.topo(outra));
    }
  });

  test('integrar-sem-base-gravada-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    g(amb.dir, 'config', '--unset', 'branch.wt/GM-10-T1.gabaritoBase');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    nada(amb, antes, r, 'base_divergente');
    assert.match(r.j.mensagem, /não está gravada/);
  });

  test('integrar-commit-apos-veredito-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'depois\n', 'feat(GM-10): depois do veredito');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'commit_nao_revisado');
  });

  test('integrar-concluida-sem-sha-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
    ]);
    amb.commitNaWt('T1', 'src/t1.txt');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'commit_nao_revisado');
  });

  test('integrar-merge-sem-efeito-recusa-sem-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"merge --ff-only"* ]]; then echo "Already up to date."; exit 0; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'merge_sem_efeito');
  });
});

describe('fechar não perde nada (rodada 2)', () => {
  const comIgnorado = () => {
    const amb = ambiente();
    amb.comBanco();
    appendFileSync(join(amb.dir, '.gitignore'), '*.local\n');
    g(amb.dir, 'add', '.gitignore');
    g(amb.dir, 'commit', '-q', '-m', 'chore: ignora local');
    return amb;
  };

  test('fechar-ignorado-remove-e-relata', () => {
    const amb = comIgnorado();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'x.local'), 'regeneravel');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.ignorados_removidos, ['x.local']);
    assert.ok(!existsSync(w), 'a worktree saiu');
    assert.ok(amb.sqls().some((s) => /^DROP/.test(s)), 'o banco foi solto');
  });

  test('fechar-nao-rastreado-recusa', () => {
    const amb = comIgnorado();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'x.local'), 'regeneravel');
    writeFileSync(join(w, 'unico.txt'), 'trabalho unico');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.match(r.j.mensagem, /unico\.txt/);
    assert.equal(readFileSync(join(w, 'unico.txt'), 'utf8'), 'trabalho unico');
    assert.equal(readFileSync(join(w, 'x.local'), 'utf8'), 'regeneravel');
    assert.ok(!amb.sqls().some((s) => /^DROP/.test(s)), 'o banco não foi solto');
  });

  test('fechar-showuntracked-no-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'config', 'status.showUntrackedFiles', 'no');
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'unico.txt'), 'trabalho unico');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.equal(readFileSync(join(w, 'unico.txt'), 'utf8'), 'trabalho unico');
  });

  test('fechar-remove-sem-efeito-rc1', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"worktree remove"* ]]; then exit 0; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'remove_falhou');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-head-solto-recusa', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    g(w, 'checkout', '-q', '--detach');
    amb.commitNaWt('T1', 'src/solto.txt');
    const sha = g(w, 'rev-parse', 'HEAD').trim();
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'head_solto');
    assert.ok(existsSync(w));
    assert.equal(g(w, 'rev-parse', 'HEAD').trim(), sha);
    assert.ok(existsSync(join(w, '.tmp-gabarito')));
    assert.ok(!amb.sqls().some((s) => /^DROP/.test(s)), 'o banco não foi solto');
  });
});

describe('integrar tudo ou nada (rodada 3)', () => {
  const FLAG = () => join(novoTmp('loop-flag-'), 'verde');
  const avancaBase = (amb) => {
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
  };
  const gateVerdeSe = (flag) => ({ gates: { suites: [`test -f ${flag} && echo '# pass 1'`] } });

  test('integrar-gate-vermelho-volta-ao-revisado', () => {
    const flag = FLAG();
    const amb = ambiente({ config: gateVerdeSe(flag) });
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const topoMain = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.voltou, true);
    assert.match(r.j.mensagem, /voltou ao commit revisado/);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado, 'a branch');
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado, 'a worktree');
    assert.equal(g(amb.wt('T1'), 'status', '--porcelain').trim(), '');
    assert.equal(amb.topo(), topoMain);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-conflito-volta-ao-revisado', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/a.txt'] }]) });
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/a.txt', 'TASK\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) amb.cli(a);
    const revisado = amb.topo('wt/GM-10-T1');
    writeFileSync(join(amb.dir, 'src/a.txt'), 'MAIN\n');
    g(amb.dir, 'commit', '-q', '-am', 'chore: main mexe');
    for (let i = 0; i < 2; i += 1) {
      const r = amb.cli(['integrar', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'rebase_conflito', `tentativa ${i + 1}: ${r.out}`);
      assert.equal(r.j.voltou, true);
      assert.equal(amb.topo('wt/GM-10-T1'), revisado);
      assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado);
    }
  });

  test('integrar-apos-falha-repete-sem-commit-nao-revisado', () => {
    const flag = FLAG();
    const amb = ambiente({ config: gateVerdeSe(flag) });
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'gate_reprovado', r1.out);
    writeFileSync(flag, 'ok');
    const r2 = amb.cli(['integrar', 'T1']);
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.equal(r2.j.merge, true);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
  });

  test('integrar-volta-falha-relata', () => {
    const flag = FLAG();
    const amb = ambiente({ config: gateVerdeSe(flag) });
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'reset --keep' } });
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'gate_reprovado', 'a causa original não se perde');
    assert.equal(r.j.voltou, false);
    assert.match(r.j.mensagem, /gate reprovado/);
    assert.match(r.j.mensagem, /volta .* FALHOU/);
    assert.notEqual(amb.topo('wt/GM-10-T1'), revisado, 'ficou onde o rebase deixou, sem apagar');
    assert.ok(existsSync(amb.wt('T1')));
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-com-ignorado-rc0', () => {
    const amb = ambiente();
    appendFileSync(join(amb.dir, '.gitignore'), 'node_modules/\n*.local\n');
    g(amb.dir, 'add', '.gitignore');
    g(amb.dir, 'commit', '-q', '-m', 'chore: ignora');
    amb.aprovar('T1');
    const w = amb.wt('T1');
    mkdirSync(join(w, 'node_modules'));
    writeFileSync(join(w, 'node_modules', 'x.js'), 'x');
    writeFileSync(join(w, 'y.local'), 'y');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.ok(!existsSync(w));
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
    assert.deepEqual(r.j.ignorados_removidos, ['node_modules/', 'y.local']);
  });

  test('integrar-showuntracked-no-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    g(amb.dir, 'config', 'status.showUntrackedFiles', 'no');
    writeFileSync(join(amb.wt('T1'), 'unico.txt'), 'trabalho unico');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.equal(r.j.merge, false);
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(readFileSync(join(amb.wt('T1'), 'unico.txt'), 'utf8'), 'trabalho unico');
  });

  test('integrar-merge-nao-confirmado-nao-volta', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const bin = amb.env.PATH.split(':')[0];
    const cont = join(dirname(bin), 'cont');
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"merge --ff-only"* ]]; then touch "${cont}"; fi
if [ -f "${cont}" ] && [[ "$*" == *"rev-parse refs/heads/enabler/GM-10-loop"* ]]; then echo "falha injetada" >&2; exit 1; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'merge_nao_confirmado');
    assert.equal(r.j.merge, null);
    assert.notEqual(amb.topo('wt/GM-10-T1'), revisado, 'o merge pode ter entrado: a branch não volta');
    assert.doesNotMatch(r.j.mensagem, /voltou/);
  });
});

describe('ci', () => {
  test('ci-grava-resultado', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['ci', 'verde']).rc, 0);
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    const ev = amb.eventos().filter((e) => e.tipo === 'ci.resultado');
    assert.deepEqual(ev.map((e) => e.dados), [{ verde: true }, { verde: false }]);
    const antes = amb.eventos().length;
    for (const a of [['ci', 'azul'], ['ci', 'VERDE'], ['ci', '']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.equal(r.j.ok, false);
    }
    assert.equal(amb.eventos().length, antes);
  });

  test('ci-vermelho-2x-para', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    assert.notEqual(amb.cli(['proxima', '--vivos', '0']).j.acao.motivo, 'ci_vermelho');
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.acao, { tipo: 'parar', motivo: 'ci_vermelho' });
  });
});

// ─────────────────────────────────────────────────────────────── rodada 4: a volta decide pelo estado e não perde commit
describe('devolver preserva commit e relata ignorados', () => {
  const alcancavel = (amb, msg) => g(amb.dir, 'log', '--branches', '--format=%s', `--grep=${msg}`).trim().split('\n').filter(Boolean);
  const comSuite = (cmd) => ambiente({ config: { ...CONFIG_PADRAO, gates: { suites: [cmd] } } });
  const avancaBase = (amb) => {
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
  };
  const PRESERVADO = /^wt-preservado\/GM-10-T1-[0-9a-f]{12}$/;

  test('head-mudou-preserva-commit', () => {
    const amb = comSuite("git commit -q --allow-empty -m mexe; echo '# pass 1'");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'head_mudou');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.equal(r.j.voltou, true);
    assert.match(r.j.preservado, PRESERVADO);
    assert.equal(amb.topo(r.j.preservado), r.j.topo);
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', r.j.preservado).trim(), 'mexe');
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe']);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado);
    assert.ok(r.j.mensagem.includes(r.j.preservado), 'a mensagem cita onde o commit está');
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('gate-reprovado-com-commit-preserva', () => {
    const amb = comSuite('git commit -q --allow-empty -m mexe; exit 1');
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.voltou, true);
    assert.match(r.j.preservado, PRESERVADO);
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe']);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
  });

  test('head-alheio-nao-toca', () => {
    const amb = comSuite("git checkout -q -b alheia; git commit -q --allow-empty -m trabalho-alheio; exit 1");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado');
    const w = amb.wt('T1');
    assert.equal(g(w, 'symbolic-ref', 'HEAD').trim(), 'refs/heads/alheia', 'o HEAD não foi tocado');
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', 'alheia').trim(), 'trabalho-alheio', 'a branch alheia não foi movida');
    assert.deepEqual(alcancavel(amb, 'trabalho-alheio'), ['trabalho-alheio']);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.equal(r.j.voltou, false);
    assert.ok(!amb.branches().some((b) => b.startsWith('wt-preservado/')), 'o rebaseado que o gate avaliou não é commit novo');
    assert.equal(r.j.branch_voltou, true);
    assert.equal(r.j.head_em, 'refs/heads/alheia');
    assert.match(r.j.mensagem, /NÃO foi tocado/);
    assert.match(r.j.mensagem, /git checkout wt\/GM-10-T1/);
  });

  test('head-alheio-com-suite-verde-nao-toca', () => {
    const amb = comSuite("git checkout -q -b alheia; git commit -q --allow-empty -m trabalho-alheio; echo '# pass 1'");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'head_mudou');
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', 'alheia').trim(), 'trabalho-alheio');
    assert.equal(g(amb.wt('T1'), 'symbolic-ref', 'HEAD').trim(), 'refs/heads/alheia');
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.equal(r.j.branch_voltou, true);
  });

  test('head-solto-com-commit-nao-toca', () => {
    const amb = comSuite("git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.branch_voltou, true);
    assert.equal(r.j.head_em, 'solto');
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.notEqual(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado, 'o HEAD solto fica onde estava');
  });

  test('commit-so-na-primeira-tentativa-fica-preservado', () => {
    const flag = join(novoTmp('loop-flag-'), 'ja');
    const amb = comSuite(`if [ ! -f ${flag} ]; then touch ${flag}; git commit -q --allow-empty -m mexe; fi; echo '# pass 1'`);
    amb.aprovar('T1');
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'head_mudou', r1.out);
    const r2 = amb.cli(['integrar', 'T1']);
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe'], 'o commit sobrevive à integração da retentativa');
    assert.ok(amb.branches().includes(r1.j.preservado));
  });

  test('preservar-falha-nao-move-nada', () => {
    const amb = comSuite('git commit -q --allow-empty -m mexe; exit 1');
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'branch wt-preservado' } });
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.voltou, false);
    assert.equal(r.j.preservado, undefined);
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe'], 'o commit segue alcançável por branch');
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', 'wt/GM-10-T1').trim(), 'mexe');
    assert.match(r.j.mensagem, /não consegui preservar/);
    assert.ok(!amb.branches().some((b) => b.startsWith('wt-preservado/')));
  });

  // HEAD solto: nenhuma branch segura o que ele aponta, então o commit vai para `wt-preservado/*` antes da volta (sombra-t6c.md).
  const umaVez = (cmd, depois = "echo '# pass 1'") => { const f = join(novoTmp('loop-flag-'), 'ja'); return `if [ ! -f ${f} ]; then touch ${f}; ${cmd}; else ${depois}; fi`; };
  /** Segue a saída que a mensagem indica (checkout da branch), repete `integrar` e prova o alcance depois de expirar reflog e coletar lixo. */
  const seguirSaida = (amb, msg) => {
    const co = spawnSync('git', ['checkout', 'wt/GM-10-T1'], { cwd: amb.wt('T1'), encoding: 'utf8' });
    assert.equal(co.status, 0, co.stderr);
    const r2 = amb.cli(['integrar', 'T1']);
    const wtExiste = existsSync(amb.wt('T1'));
    g(amb.dir, 'reflog', 'expire', '--expire=now', '--all');
    g(amb.dir, 'gc', '-q', '--prune=now');
    return { r2, wtExiste, al: alcancavel(amb, msg) };
  };

  test('head-solto-segue-a-saida-sem-perder', () => {
    const amb = comSuite(umaVez('git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'gate_reprovado', r1.out);
    assert.equal(r1.j.voltou, false);
    assert.equal(r1.j.branch_voltou, true);
    assert.equal(r1.j.head_em, 'solto');
    assert.match(r1.j.preservado_solto, PRESERVADO);
    assert.equal(amb.topo(r1.j.preservado_solto), r1.j.topo_solto);
    assert.ok(r1.j.mensagem.includes(r1.j.preservado_solto), 'a mensagem cita a branch que segura o commit');
    assert.match(r1.j.mensagem, /git checkout wt\/GM-10-T1/);
    const { r2, wtExiste, al } = seguirSaida(amb, 'solto');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.equal(wtExiste, false, 'a worktree foi removida');
    assert.deepEqual(al, ['solto'], 'o commit do HEAD solto segue alcançável por --branches');

    // verde, mesma regra: o `head_mudou` também preserva
    const amb2 = comSuite(umaVez("git checkout -q --detach; git commit -q --allow-empty -m solto; echo '# pass 1'"));
    amb2.aprovar('T1');
    avancaBase(amb2);
    const v1 = amb2.cli(['integrar', 'T1']);
    assert.equal(v1.j.erro, 'head_mudou', v1.out);
    assert.match(v1.j.preservado_solto, PRESERVADO);
    const v = seguirSaida(amb2, 'solto');
    assert.equal(v.r2.rc, 0, v.r2.out + v.r2.err);
    assert.deepEqual(v.al, ['solto']);
  });

  test('head-solto-e-branch-preserva-os-dois', () => {
    const amb = comSuite(umaVez('git commit -q --allow-empty -m nabranch; git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.match(r1.j.preservado, PRESERVADO);
    assert.match(r1.j.preservado_solto, PRESERVADO);
    assert.notEqual(r1.j.preservado, r1.j.preservado_solto);
    const { r2, al } = seguirSaida(amb, 'solto');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(al, ['solto']);
    assert.deepEqual(alcancavel(amb, 'nabranch'), ['nabranch'], 'o commit que ficou na branch também sobrevive');
  });

  test('head-solto-no-topo-uma-branch', () => {
    const amb = comSuite(umaVez('git commit -q --allow-empty -m nabranch; git checkout -q --detach; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.match(r1.j.preservado, PRESERVADO);
    assert.equal(r1.j.preservado_solto, undefined, 'mesmo sha da branch: 1 branch só');
    assert.equal(amb.branches().filter((b) => b.startsWith('wt-preservado/')).length, 1);
    const { r2, al } = seguirSaida(amb, 'nabranch');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(al, ['nabranch']);
  });

  test('head-solto-sem-commit-nao-preserva', () => {
    const amb = comSuite(umaVez('git checkout -q --detach; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.head_em, 'solto');
    assert.equal(r1.j.preservado_solto, undefined);
    const { r2 } = seguirSaida(amb, 'naoexiste');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.ok(!amb.branches().some((b) => b.startsWith('wt-preservado/')));
  });

  test('head-solto-preservar-falha-nao-manda-checkout', () => {
    const amb = comSuite(umaVez('git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1'));
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'branch wt-preservado' } });
    assert.equal(r1.rc, 1, r1.out + r1.err);
    assert.equal(r1.j.voltou, false);
    assert.equal(r1.j.head_em, undefined);
    assert.equal(r1.j.preservado_solto, undefined);
    assert.match(r1.j.mensagem, /não consegui preservar/);
    assert.match(r1.j.mensagem, /confira à mão/);
    assert.ok(!/git checkout/.test(r1.j.mensagem), 'sem a saída que abandonaria o commit');
    assert.equal(g(amb.wt('T1'), 'log', '-1', '--format=%s', 'HEAD').trim(), 'solto', 'o HEAD segue no commit');
    assert.equal(r1.j.branch_voltou, undefined, 'a branch não foi movida');
    assert.notEqual(amb.topo('wt/GM-10-T1'), revisado, 'segue no commit rebaseado, não voltou');
    const r2 = amb.cli(['integrar', 'T1']);
    assert.equal(r2.j.erro, 'head_divergente');
  });

  test('head-solto-hook-pre-rebase-preserva', () => {
    const amb = comSuite("echo '# pass 1'");
    amb.aprovar('T1');
    avancaBase(amb);
    const flag = join(novoTmp('loop-flag-'), 'ja');
    const hp = join(amb.dir, g(amb.dir, 'rev-parse', '--git-path', 'hooks').trim(), 'pre-rebase');
    mkdirSync(dirname(hp), { recursive: true });
    writeFileSync(hp, `#!/bin/sh\nif [ ! -f ${flag} ]; then touch ${flag}; git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1; fi\nexit 0\n`);
    chmodSync(hp, 0o755);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'rebase_falhou', r1.out);
    assert.match(r1.j.preservado_solto, PRESERVADO);
    const { r2, al } = seguirSaida(amb, 'solto');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(al, ['solto']);
  });

  test('integrar-relata-ignorados', () => {
    const amb = ambiente();
    appendFileSync(join(amb.dir, '.gitignore'), '*.local\n');
    g(amb.dir, 'add', '.gitignore');
    g(amb.dir, 'commit', '-q', '-m', 'chore: ignora');
    amb.aprovar('T1');
    writeFileSync(join(amb.wt('T1'), 'y.local'), 'y');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.ignorados_removidos, ['y.local']);
  });

  test('integrar-sem-ignorados-relata-lista-vazia', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.ignorados_removidos, []);
  });

  test('rebase-com-contexto-mudado-integra', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt', 'src/a.txt'] }]) });
    const linhas = (n8) => ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', n8, 'l9', 'l10'].join('\n') + '\n';
    writeFileSync(join(amb.dir, 'src/a.txt'), linhas('l8'));
    g(amb.dir, 'add', 'src/a.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: dez linhas');
    amb.aprovar('T1', 'src/t1.txt', [['src/a.txt', linhas('l8').replace('l10', 'L10-T1')]]);
    writeFileSync(join(amb.dir, 'src/a.txt'), linhas('L8-BASE'));
    g(amb.dir, 'add', 'src/a.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: base mexe no contexto');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(readFileSync(join(amb.dir, 'src/a.txt'), 'utf8'), linhas('L8-BASE').replace('l10', 'L10-T1'));
  });
});

// ─────────────────────────────────────────────────────────────── T20 (GM-10, spec r8): a memória sobrevive ao /clear
// Depois do /clear o modelo não sabe se já abriu, em que rodada está nem onde ficaram os achados: o CLI é a única memória.

describe('T20: abrir idempotente, achados do revisor e spec', () => {
  const achadosDe = (amb, t, r) => join(amb.wt(t), '.tmp-gabarito', `review-r${r}.md`);
  /** abrir → impl → commit → concluir → revisor, parado antes do veredito. */
  const ateRevisor = (amb, t = 'T1') => {
    for (const a of [['abrir', t], ['iniciar', t, 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`);
    for (const a of [['concluir', t], ['iniciar', t, 'revisor']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
  };
  const reprovarR1 = (amb, t = 'T1') => {
    ateRevisor(amb, t);
    writeFileSync(achadosDe(amb, t, 1), '- MAJOR 1: falta teste de X (src/t1.txt:1)\n');
    const r = amb.cli(['veredito', t, 'REPROVADO', '1', '0', '1']);
    assert.equal(r.rc, 0, r.out + r.err);
  };

  test('abrir-duas-vezes-ok: o mesmo retorno com ja_aberta, sem tocar no trabalho', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.equal(a.j.ja_aberta, undefined, 'a 1ª abertura não é ja_aberta');
    amb.commitNaWt('T1', 'src/t1.txt');
    const antes = semEfeito(amb);
    const topoWt = g(amb.wt('T1'), 'rev-parse', 'HEAD');
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.equal(b.j.ok, true);
    assert.equal(b.j.ja_aberta, true);
    for (const k of ['task', 'branch', 'base', 'worktree', 'tmpdir', 'banco']) assert.deepEqual(b.j[k], a.j[k], k);
    assert.deepEqual(b.j.env, a.j.env);
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD'), topoWt);
    assert.ok(existsSync(join(b.j.tmpdir, '.gitignore')), 'o tmpdir segue pronto');
  });

  test('abrir-duas-vezes-recria-o-tmpdir-que-sumiu', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    rmSync(a.j.tmpdir, { recursive: true });
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.ok(existsSync(join(a.j.tmpdir, '.gitignore')));
  });

  test('abrir-branch-sem-worktree-recusa: branch sem worktree, e pasta que o git não registra', () => {
    const amb = ambiente();
    g(amb.dir, 'branch', 'wt/GM-10-T1');
    let r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'branch_existe');
    // pasta comum no lugar da worktree, com o principal NA branch da task: `symbolic-ref` dentro dela devolveria a branch certa
    // (o git sobe até o principal), então só o registro de worktrees distingue.
    g(amb.dir, 'checkout', '-q', 'wt/GM-10-T1');
    g(amb.dir, 'config', 'branch.wt/GM-10-T1.gabaritoBase', 'enabler/GM-10-loop'); // só o registro de worktrees pode recusar
    mkdirSync(amb.wt('T1'), { recursive: true });
    writeFileSync(join(amb.wt('T1'), 'meu.txt'), 'importa');
    const antes = semEfeito(amb);
    r = amb.cli(['abrir', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'branch_existe');
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(readFileSync(join(amb.wt('T1'), 'meu.txt'), 'utf8'), 'importa');
  });

  test('abrir-outro-head-recusa: worktree registrada com HEAD solto ou em outra branch', () => {
    for (const mexer of [(w) => g(w, 'checkout', '-q', '--detach'), (w) => g(w, 'checkout', '-q', '-b', 'outra')]) {
      const amb = ambiente();
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      mexer(amb.wt('T1'));
      const antes = semEfeito(amb);
      const headAntes = g(amb.wt('T1'), 'rev-parse', '--abbrev-ref', 'HEAD');
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'branch_existe');
      assert.deepEqual(semEfeito(amb), antes);
      assert.equal(g(amb.wt('T1'), 'rev-parse', '--abbrev-ref', 'HEAD'), headAntes, 'nada foi tocado');
    }
  });

  test('veredito-reprovado-sem-achados-recusa: ok:false achados_ausentes e nada gravado', () => {
    const amb = ambiente();
    ateRevisor(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'achados_ausentes');
    assert.match(r.j.mensagem, /review-r1\.md/);
    assert.equal(amb.eventos().length, antes);
    assert.ok(!(amb.cli(['proxima']).j.acao.itens ?? []).some((i) => i.papel === 'correcao'), 'o estado segue em revisão: nenhum despacho de correção');
  });

  test('veredito-reprovado-achados-vazio-recusa: arquivo vazio ou só espaço, diretório e symlink', () => {
    const amb = ambiente();
    ateRevisor(amb);
    const antes = amb.eventos().length;
    const arq = achadosDe(amb, 'T1', 1);
    for (const prep of [
      () => writeFileSync(arq, ''),
      () => writeFileSync(arq, ' \n\t\n'),
      () => { rmSync(arq); mkdirSync(arq); },
      () => { rmSync(arq, { recursive: true }); writeFileSync(join(amb.dir, 'fora.md'), 'achado'); symlinkSync(join(amb.dir, 'fora.md'), arq); },
    ]) {
      prep();
      const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'achados_ausentes');
      assert.equal(amb.eventos().length, antes);
    }
  });

  test('veredito-reprovado-com-achados-grava', () => {
    const amb = ambiente();
    reprovarR1(amb);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 });
  });

  test('veredito-aprovado-sem-arquivo-passa: APROVADO não exige achados', () => {
    const amb = ambiente();
    ateRevisor(amb);
    assert.ok(!existsSync(achadosDe(amb, 'T1', 1)));
    const r = amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.tipos().at(-1), 'review.veredito');
  });

  test('veredito-reprovado-sem-worktree-recusa: worktree_ausente, nada gravado', () => {
    const amb = ambiente();
    ateRevisor(amb);
    const antes = amb.eventos().length;
    g(amb.dir, 'worktree', 'remove', '--force', amb.wt('T1'));
    const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_ausente');
    assert.equal(amb.eventos().length, antes);
  });

  test('proxima-correcao-traz-achados: o caminho do arquivo da rodada, depois do /clear só com o CLI', () => {
    const amb = ambiente();
    reprovarR1(amb);
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    const item = p.j.acao.itens.find((i) => i.task === 'T1');
    assert.equal(item.papel, 'correcao');
    assert.equal(realpathSync(item.achados), realpathSync(achadosDe(amb, 'T1', 1)));
    assert.match(readFileSync(item.achados, 'utf8'), /MAJOR 1/);
    for (const i of p.j.acao.itens.filter((x) => x.papel !== 'correcao')) assert.equal(i.achados, undefined, 'só correção traz achados');
  });

  test('proxima-correcao-sem-arquivo-nao-finge: achados nulo e aviso', () => {
    const amb = ambiente();
    reprovarR1(amb);
    rmSync(achadosDe(amb, 'T1', 1));
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    assert.equal(p.j.acao.itens.find((i) => i.task === 'T1').achados, null);
    assert.ok((p.j.aviso ?? []).some((a) => /achados.*T1/.test(a)), JSON.stringify(p.j.aviso));
  });

  test('veredito-rodada-errada-diz-esperada: a mensagem traz a rodada que o diário espera', () => {
    const amb = ambiente();
    ateRevisor(amb);
    let r = amb.cli(['veredito', 'T1', 'APROVADO', '3', '0', '0']);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.match(r.j.mensagem, /rodada esperada: 1\b/);
    assert.match(r.j.mensagem, /fora de sequência/);
    // a causa mais fundamental vem primeiro: REPROVADO de rodada errada e sem achados diz a rodada, não os achados
    r = amb.cli(['veredito', 'T1', 'REPROVADO', '3', '0', '1']);
    assert.equal(r.j.erro, 'transicao_invalida');
    // depois de uma reprovação a esperada é a 2
    writeFileSync(achadosDe(amb, 'T1', 1), 'achado\n');
    assert.equal(amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']).rc, 0);
    for (const a of [['iniciar', 'T1', 'correcao']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt', 'v2\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor']]) assert.equal(amb.cli(a).rc, 0);
    r = amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.match(r.j.mensagem, /rodada esperada: 2\b/);
  });

  test('proxima-traz-spec: o ponteiro da spec vem do topo do plano, em todo item (caminho com espaço incluso)', () => {
    const amb = ambiente({
      plano: { ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T3', deps: [], arquivos: ['src/t3.txt'] }]), spec: 'docs/minha spec.md:10-20' },
    });
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    for (const i of p.j.acao.itens) assert.equal(i.spec, 'docs/minha spec.md:10-20', i.task);
  });

  test('proxima-sem-spec-no-plano: item sem spec', () => {
    const p = ambiente().cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    for (const i of p.j.acao.itens) assert.equal('spec' in i, false);
  });

  test('proxima-correcao-traz-spec-e-achados: a correção depois do /clear tem os dois', () => {
    const amb = ambiente({ plano: { ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]), spec: 'docs/spec.md:10-20' } });
    reprovarR1(amb);
    const item = amb.cli(['proxima', '--vivos', '0']).j.acao.itens[0];
    assert.equal(item.papel, 'correcao');
    assert.equal(item.spec, 'docs/spec.md:10-20');
    assert.ok(typeof item.achados === 'string' && existsSync(item.achados));
  });

  test('plano-spec-invalida-recusa: vazia, não texto, ou dentro de tasks[] (com motivo)', () => {
    const casos = [
      [{ ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]), spec: 7 }, /spec/],
      [{ ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]), spec: '' }, /spec/],
      [planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], spec: 'docs/spec.md' }]), /task T1.*spec/],
    ];
    for (const [plano, re] of casos) {
      const p = ambiente({ plano }).cli(['proxima']);
      assert.equal(p.rc, 1, p.out);
      assert.equal(p.j.erro, 'plano_invalido');
      assert.match(p.j.mensagem, re);
    }
  });

  test('abrir-duas-vezes-devolve-o-banco: o mesmo nome, sem clone novo (REQ-LOOP-3)', () => {
    const amb = ambiente();
    amb.comBanco();
    const a = amb.cli(['abrir', 'T1']);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.notEqual(a.j.banco, 'n/a');
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.equal(b.j.ja_aberta, true);
    assert.equal(b.j.banco, a.j.banco);
  });

  describe('symlink em .tmp-gabarito (falha fecha, nada fora da worktree)', () => {
    const fora = (_amb, nome) => novoTmp(`loop-fora-${nome}-`);
    test('veredito-recusa-tmp-symlink-para-fora: nada gravado', () => {
      const amb = ambiente();
      ateRevisor(amb);
      const tmp = join(amb.wt('T1'), '.tmp-gabarito');
      const alvo = fora(amb, 'v');
      writeFileSync(join(alvo, 'review-r1.md'), '- MAJOR 1: x\n');
      rmSync(tmp, { recursive: true });
      symlinkSync(alvo, tmp);
      const antes = amb.eventos().length;
      const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.ok, false);
      assert.equal(r.j.erro, 'achados_ausentes');
      assert.equal(amb.eventos().length, antes);
    });
    test('abrir-repetido-recusa-tmp-symlink-sem-escrever-fora', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const alvo = fora(amb, 'a');
      rmSync(a.j.tmpdir, { recursive: true });
      symlinkSync(alvo, a.j.tmpdir);
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
      assert.deepEqual(readdirSync(alvo), [], 'nada escrito fora da worktree');
    });
    test('abrir-repetido-recusa-gitignore-symlink: o alvo do link não é tocado', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const alvo = join(fora(amb, 'g'), 'alvo.txt');
      writeFileSync(alvo, 'intacto');
      rmSync(join(a.j.tmpdir, '.gitignore'));
      symlinkSync(alvo, join(a.j.tmpdir, '.gitignore'));
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
      assert.equal(readFileSync(alvo, 'utf8'), 'intacto');
    });
    test('abrir-repetido-recusa-tmp-arquivo-comum', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      rmSync(a.j.tmpdir, { recursive: true });
      writeFileSync(a.j.tmpdir, 'x');
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
    });
    test('vizinhos-seguem-passando: diretório real e arquivo comum; symlink dentro da worktree recusa', () => {
      const amb = ambiente();
      reprovarR1(amb); // diretório real, arquivo comum: veredito passou (rc 0 no helper)
      const amb2 = ambiente();
      ateRevisor(amb2);
      const tmp = join(amb2.wt('T1'), '.tmp-gabarito');
      const dentro = join(amb2.wt('T1'), 'dentro');
      mkdirSync(dentro);
      writeFileSync(join(dentro, 'review-r1.md'), '- MAJOR 1: x\n');
      rmSync(tmp, { recursive: true });
      symlinkSync(dentro, tmp);
      const r = amb2.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'achados_ausentes');
    });
  });

  test('achados-ignorado-e-fechar-remove: o arquivo não suja o git e sai com a worktree', () => {
    const amb = ambiente();
    reprovarR1(amb);
    const arq = achadosDe(amb, 'T1', 1);
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '', 'ignorado pelo próprio .tmp-gabarito/.gitignore');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(!existsSync(arq));
    assert.ok(!existsSync(amb.wt('T1')));
  });
});

/**
 * REQ-LOOP-3 e REQ-LOOP-2 pela borda: `loop.mjs` (worktree por task, integração com gate, próxima ação).
 * Repositório git temporário por caso; nada fixo do repo do plugin. Banco e git com falha injetada por ferramenta falsa.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte): task-6-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { raizSegura } from './_raiz-segura.mjs';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, lstatSync, statSync, symlinkSync, chmodSync, readdirSync, appendFileSync, rmSync, renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { marcaPronto } from '../scripts/db-template.mjs';
import { contexto, hashDaLiberacao, integrarComGate, liberarTeto, slotsDaCapacidade } from '../scripts/loop.mjs';
import { idDaBranch, trilhaDe } from '../dist/trilha.js';
import { casarAgente } from '../dist/painel-equipe.js';
import { estadoDe as estadoNucleo, ordenar as ordenarNucleo } from '../dist/loop.js';
import * as diario from '../dist/diario.js';
import { pendenciasAprendizado } from '../dist/pendencias.js';
import { fecharPendenciasNoDiario } from './_adaptador-helpers.mjs';

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
  const d = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), prefixo))));
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
  const tmpSistema = novoTmp('loop-sys-'); // o TMPDIR da task nasce aqui (D2): nada vaza para o do usuário
  const env = { ...process.env, TMPDIR: tmpSistema, PATH: `${bin}:${process.env.PATH}`, GIT_LOG: gitLog, FAKE_LOG: psqlLog, FAKE_STATE: estado, ...MEDIDAS_PADRAO };
  for (const k of Object.keys(env)) if (/^(PG|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR))/i.test(k) || k === 'GABARITO_POUSO_X') delete env[k];
  // estado local, fora do git (como o .gitignore do repo faz com .harness/capacidade.json): não suja a árvore dos gates
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '.harness/capacidade.json\n');
  if (capacidade !== null) writeFileSync(join(dir, '.harness', 'capacidade.json'), typeof capacidade === 'string' ? capacidade : JSON.stringify(capacidade));
  delete env.GIT_FALHAR;
  let seq = 0;
  const amb = {
    dir, entregas, env, tmpSistema, gitLog, psqlLog, estado, psql: join(psqlDir, 'psql'),
    wt: (t) => join(dir, '.harness', 'worktrees', t),
    cli(args, { cwd = dir, extra = {} } = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
      return { rc: r.status, j, out: r.stdout, err: r.stderr };
    },
    eventos: () => diario.ler(entregas),
    tipos: () => diario.ler(entregas).map((e) => e.tipo),
    /** REQ-APR-2 muda a ordem: fecha o que `pendenciasAprendizado` do `dist/` devolve (MAJOR, fechamento, parar) para o teste seguir ao que ele prova. Plano ilegível: nada a fechar. */
    fechar() {
      let plano;
      try { plano = JSON.parse(readFileSync(join(entregas, 'plano.json'), 'utf8')); } catch { return 0; }
      return fecharPendenciasNoDiario(entregas, plano);
    },
    semear(lista) {
      for (const [tipo, dados] of lista) {
        seq += 1;
        const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
        const r = diario.append(entregas, 'loop', { ts, autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
      amb.fechar();
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

/** Nome da pasta do TMPDIR da task: sha256 do caminho da worktree, 16 hex, no tmpdir do sistema (o contrato de D2). */
const tmpDaTask = (amb, t) => join(amb.tmpSistema, `gabarito-${createHash('sha256').update(amb.wt(t)).digest('hex').slice(0, 16)}`);

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

  test('abrir-tmpdir-fora-da-worktree: exporta, não suja o git e não fica sob a árvore da task', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    const tmp = r.j.tmpdir;
    assert.equal(realpathSync(r.j.env.TMPDIR), realpathSync(tmp));
    assert.equal(realpathSync(dirname(tmp)), realpathSync(amb.tmpSistema), 'nasce no tmpdir do sistema');
    assert.equal(tmp, tmpDaTask(amb, 'T1'));
    assert.ok(!realpathSync(tmp).startsWith(`${realpathSync(amb.dir)}/`), 'fora do repositório e da worktree');
    assert.equal(statSync(tmp).mode & 0o777, 0o700);
    assert.ok(existsSync(join(amb.wt('T1'), '.tmp-gabarito')), 'os achados do revisor seguem em .tmp-gabarito');
    writeFileSync(join(tmp, 'lixo.bin'), 'x');
    mkdirSync(join(tmp, 'sub'));
    writeFileSync(join(tmp, 'sub', 'y'), 'y');
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '', 'TMPDIR não pode sujar o status');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '', 'nem o da raiz principal');
  });

  test('abrir-duas-vezes-mesmo-tmpdir: estável por worktree; outra task, outra pasta', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.j.ja_aberta, true);
    assert.equal(b.j.tmpdir, a.j.tmpdir);
    const c = amb.cli(['abrir', 'T3']);
    assert.notEqual(c.j.tmpdir, a.j.tmpdir, 'por worktree, nunca um só para o repositório');
    // dois repositórios, mesma task: caminhos de worktree diferentes, pastas diferentes
    const amb2 = ambiente();
    const d = amb2.cli(['abrir', 'T1'], { extra: { TMPDIR: amb.tmpSistema } }); // mesmo tmpdir do sistema
    assert.equal(d.rc, 0, d.out + d.err);
    assert.notEqual(d.j.tmpdir, a.j.tmpdir);
    assert.ok(existsSync(a.j.tmpdir) && existsSync(c.j.tmpdir) && existsSync(d.j.tmpdir));
  });

  test('abrir-tmpdir-symlink-recusa: nada escrito no alvo, branch e worktree desfeitas', () => {
    const amb = ambiente();
    const alvo = novoTmp('loop-fora-');
    writeFileSync(join(alvo, 'precioso.txt'), 'vivo');
    symlinkSync(alvo, tmpDaTask(amb, 'T1')); // a pasta esperada é um link para fora
    const antes = semEfeito(amb);
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'tmpdir_falhou');
    assert.equal(r.j.desfeito, true, r.out);
    assert.deepEqual(readdirSync(alvo), ['precioso.txt'], 'nada escrito no alvo do link');
    assert.equal(readFileSync(join(alvo, 'precioso.txt'), 'utf8'), 'vivo');
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!existsSync(amb.wt('T1')));
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(lstatSync(tmpDaTask(amb, 'T1')).isSymbolicLink(), 'o link, que não era nosso, não foi apagado');
  });

  test('abrir-tmpdir-falha-desfaz: arquivo no lugar da pasta; worktree, branch e banco desfeitos', () => {
    const amb = ambiente();
    amb.comBanco();
    writeFileSync(tmpDaTask(amb, 'T1'), 'sou um arquivo');
    const bancosAntes = amb.bancos().join(',');
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.desfeito, true, r.out);
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!existsSync(amb.wt('T1')));
    assert.equal(amb.bancos().join(','), bancosAntes, 'o banco clonado nesta abertura foi solto');
    assert.equal(readFileSync(tmpDaTask(amb, 'T1'), 'utf8'), 'sou um arquivo', 'o que não era nosso não foi apagado');
    // 2ª tentativa depois de arrumar: abre normalmente (nada ficou pelo caminho)
    rmSync(tmpDaTask(amb, 'T1'));
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
  });

  test('abrir-tmpdir-falha-desfaz-pasta-criada: falha depois de criar a pasta apaga a que criou', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1'], { extra: { GIT_FALHAR: 'gabaritoBase' } }); // o último passo do abrir falha
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.desfeito, true, r.out);
    assert.deepEqual(readdirSync(amb.tmpSistema), [], 'a pasta criada nesta abertura foi apagada');
    assert.ok(!existsSync(amb.wt('T1')));
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
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
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador', modelo: 'sonnet' });
    assert.equal(e[0].agente, 'orquestrador');
  });

  test('iniciar-modelo-flag-vence-config', () => {
    // config manda opus; o flag manda haiku; o diário grava o do flag (e a forma do evento fica a mesma)
    const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { modelos: { implementador: 'opus' } } } });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador', '--modelo', 'haiku']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos();
    assert.equal(e.length, 1);
    assert.equal(e[0].tipo, 'task.iniciada');
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador', modelo: 'haiku' });
    // todos os valores da lista valem
    for (const m of ['sonnet', 'opus', 'fable']) {
      const a = ambiente();
      a.cli(['abrir', 'T1']);
      assert.equal(a.cli(['iniciar', 'T1', 'implementador', '--modelo', m]).rc, 0, m);
      assert.equal(a.eventos()[0].dados.modelo, m);
    }
  });

  test('iniciar-sem-flag-igual-2-0-0', () => {
    // sem --modelo, o modelo é o do config (opus), como a 2.0.0; nenhum campo a mais no evento
    const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { modelos: { implementador: 'opus' } } } });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos();
    assert.equal(e.length, 1);
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador', modelo: 'opus' });
    assert.deepEqual(Object.keys(e[0].dados), ['task', 'papel', 'modelo']);
  });

  test('iniciar-modelo-fora-da-lista-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    for (const m of ['gpt', 'Opus', 'claude-opus-5-5', '', 'spike']) {
      const r = amb.cli(['iniciar', 'T1', 'implementador', '--modelo', m]);
      assert.equal(r.rc, 1, `"${m}": ${r.out}${r.err}`);
      assert.equal(r.j.erro, 'argumento_invalido', `${m}: recusa na borda, antes de tocar o diário`);
      assert.match(r.j.mensagem, /haiku \| sonnet \| opus \| fable/, m);
      assert.match(r.j.mensagem, /nada foi gravado/, m);
    }
    assert.equal(amb.eventos().length, 0, 'nada gravado no diário');
    // o recusado não deixa estado: o iniciar válido seguinte grava o 1º e único evento
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador', '--modelo', 'opus']).rc, 0);
    assert.equal(amb.eventos().length, 1);
  });

  test('iniciar-spike-recusa-com-frase', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'spike']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.match(r.j.mensagem, /implementador/);
    assert.doesNotMatch(r.j.mensagem, /fora da lista/, 'frase própria, não a lista genérica');
    assert.equal(amb.eventos().length, 0, 'nada gravado no diário');
    // com --modelo também recusa, e o papel valido ao lado segue aceito
    assert.equal(amb.cli(['iniciar', 'T1', 'spike', '--modelo', 'opus']).rc, 1);
    assert.equal(amb.eventos().length, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
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
    assert.deepEqual(v.dados, { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0, sha: amb.topo('wt/GM-10-T1') });
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
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: amb.topo(), mutacoes: { total: 0, mortas: 0 } });
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

  test('integrar-gate-recebe-tmpdir-externo: fora da worktree, o mesmo do abrir, e fechar o apaga', () => {
    const marca = join(novoTmp('loop-marca-'), 'tmpdir.txt');
    const amb = ambiente({ config: { gates: { suites: [`case "$TMPDIR" in */.harness/worktrees/*|*/.tmp-gabarito) exit 1;; esac; test "$(basename "$TMPDIR" | cut -c1-9)" = gabarito- && echo "$TMPDIR" > ${marca} && echo "# pass 1"`] } } });
    const wt = amb.aprovar('T1');
    const dir = readdirSync(amb.tmpSistema).filter((n) => /^gabarito-/.test(n));
    assert.equal(dir.length, 1);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(readFileSync(marca, 'utf8').trim(), join(amb.tmpSistema, dir[0]), 'o gate rodou com o TMPDIR do abrir');
    assert.ok(!existsSync(wt));
    assert.deepEqual(readdirSync(amb.tmpSistema).filter((n) => /^gabarito-/.test(n)), [], 'fechar, chamado pelo integrar, apagou a pasta (nome sem aninhar)');
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
    amb.fechar(); // REQ-APR-2 muda a ordem: tudo integrado abre o fechamento antes do `concluir`
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

  test('fechar-apaga-tmpdir-externo: com conteúdo fundo; 0 bytes sobram fora da worktree', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    assert.equal(a.j.tmpdir, tmpDaTask(amb, 'T1'));
    mkdirSync(join(a.j.tmpdir, 'fundo'));
    writeFileSync(join(a.j.tmpdir, 'fundo', 'x.bin'), Buffer.alloc(2048));
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(!existsSync(a.j.tmpdir));
    assert.ok(!existsSync(amb.wt('T1')));
    assert.deepEqual(readdirSync(amb.tmpSistema), [], 'nada sobra no tmpdir do sistema');
  });

  test('fechar-suja-mantem-tmpdir: worktree suja recusa, mantém a pasta e não cria nenhuma', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    writeFileSync(join(a.j.tmpdir, 'meu.bin'), 'x');
    writeFileSync(join(amb.wt('T1'), 'sujo.txt'), 'nao commitado');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.equal(readFileSync(join(a.j.tmpdir, 'meu.bin'), 'utf8'), 'x', 'a pasta fica como estava');
    assert.deepEqual(readdirSync(amb.tmpSistema), [a.j.tmpdir.split('/').at(-1)]);
    // worktree sem pasta externa: fechar suja não cria uma (nome calculado, sem mkdir)
    rmSync(a.j.tmpdir, { recursive: true });
    const r2 = amb.cli(['fechar', 'T1']);
    assert.equal(r2.j.erro, 'worktree_suja');
    assert.deepEqual(readdirSync(amb.tmpSistema), []);
  });

  test('fechar-tmpdir-externo-dono-alheio-recusa: a pasta não é nossa, nada é apagado e a worktree fica', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    writeFileSync(join(a.j.tmpdir, 'dele.bin'), 'x');
    const pre = join(novoTmp('loop-pre-'), 'outro-dono.mjs');
    writeFileSync(pre, 'process.getuid = () => process.geteuid() + 1;\n'); // o dono da pasta passa a parecer outro
    const extra = { NODE_OPTIONS: `--import ${pre}` };
    for (const cmd of ['fechar', 'abrir']) {
      const r = amb.cli([cmd, 'T1'], { extra });
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
    }
    assert.equal(readFileSync(join(a.j.tmpdir, 'dele.bin'), 'utf8'), 'x');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-tmpdir-externo-symlink-recusa: o alvo e a worktree ficam', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    const alvo = novoTmp('loop-fora-');
    writeFileSync(join(alvo, 'precioso.txt'), 'vivo');
    assert.equal(a.j.tmpdir, tmpDaTask(amb, 'T1'));
    rmSync(a.j.tmpdir, { recursive: true });
    symlinkSync(alvo, a.j.tmpdir);
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'tmpdir_invalido');
    assert.equal(readFileSync(join(alvo, 'precioso.txt'), 'utf8'), 'vivo');
    assert.ok(existsSync(amb.wt('T1')));
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
    // E3 (T10): todo item leva `modelo`, `decisoes` e `emendas` (vazias sem Sombra nem emenda); E5a (T8): e `aprendizados` (vazio sem aprendizado D na árvore)
    const item = (task) => ({ task, papel: 'implementador', descricao: `${task} implementador`, modelo: { modelo: 'sonnet', esforco: 'high' }, decisoes: [], emendas: [], aprendizados: [] });
    assert.deepEqual(r.j.acao, { tipo: 'despachar', itens: [item('T1'), item('T3')] });
    assert.deepEqual(r.j.sinais, { slots: 2, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: true });
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
    assert.ok(!('ja_na_base' in ev.dados), 'caminho normal (FIEL-9 d): sem a chave ja_na_base');
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

/**
 * GM-14 T32 (Emenda 3, FIEL-9 a–e): o commit aprovado já está na base (C2). `integrar` grava `task.integrada {ja_na_base: true}` sem rebase, gate nem merge,
 * fecha a worktree e diz no `aviso:` o que cobriu o sha. Mutações M-F9a..j, l, m: task-32-mut.json da entrega GM-14.
 */
describe('integrar com o sha aprovado já na base (FIEL-9)', () => {
  const BASE = 'enabler/GM-10-loop';
  const BRANCH = 'wt/GM-10-T1';
  /** C2: o commit da task entrou direto na base (fast-forward da base até ele). */
  const baseAte = (amb, ref) => g(amb.dir, 'merge', '-q', '--ff-only', ref);
  const commitNaBase = (amb, arq = 'src/base.txt') => {
    writeFileSync(join(amb.dir, arq), 'base\n');
    g(amb.dir, 'add', arq);
    g(amb.dir, 'commit', '-q', '-m', 'chore: base anda');
  };
  const aviso = (task, sha, cobertura) => `aviso: ${task} já estava na base (${sha.slice(0, 12)} é ancestral de ${BASE}): integrada sem merge, sem rebase e sem gate; ${cobertura}`;
  const COB_PROXIMO = 'nenhum gate rodou sobre ele ainda; o próximo integrar roda sobre ele';
  const COB_CI = 'nenhum gate rodou sobre ele e não há outro integrar: a CI do pedido de revisão é a 1ª verificação, e o merge espera ela verde';
  const COB_GATE = (t) => `o gate da integração de ${t} já rodou sobre ele`;
  /** Nenhuma chamada de git que move branch ou base (o `merge-base --is-ancestor` não conta). */
  const semMover = (amb) => {
    const movem = amb.gitChamadas().filter((l) => /(^|\s)(rebase|merge|reset|update-ref|cherry-pick)(\s|$)/.test(l));
    assert.deepEqual(movem, [], 'o caminho já na base não faz rebase nem merge');
  };
  const nadaCli = (amb, antes, r, erro) => {
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, erro, r.out);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(!amb.tipos().includes('task.integrada'));
  };

  test('ja-na-base-integra-sem-merge', async () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const baseAntes = amb.topo(BASE);
    let chamado = false;
    const r = await integrarComGate(amb.dir, 'T1', { avaliar: async () => { chamado = true; throw new Error('o gate não roda no caminho já na base'); } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(chamado, false, 'o gate não foi chamado');
    assert.equal(r.task, 'T1');
    assert.equal(r.branch, BRANCH);
    assert.equal(r.base, BASE);
    assert.equal(r.merge, false);
    assert.equal(r.ja_na_base, true);
    assert.equal(r.evento, true);
    assert.equal(r.fechada, true);
    assert.equal(r.banco, 'n/a');
    assert.deepEqual(r.ignorados_removidos, []);
    assert.ok(!('mutacoes' in r), 'sem mutações: o gate não rodou');
    assert.deepEqual(r.relato, [aviso('T1', aprovado, COB_PROXIMO)]);
    const ev = amb.eventos().at(-1);
    assert.equal(ev.tipo, 'task.integrada');
    assert.deepEqual(ev.dados, { task: 'T1', sha: aprovado, ja_na_base: true });
    assert.equal(amb.topo(BASE), baseAntes, 'a base não se move');
    assert.equal(amb.topo(BRANCH), aprovado, 'a branch não se move');
    assert.ok(!existsSync(w), 'worktree fechada');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '');
  });

  test('ja-na-base-com-base-a-frente', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    commitNaBase(amb);
    const baseAntes = amb.topo(BASE);
    assert.notEqual(baseAntes, aprovado);
    writeFileSync(amb.gitLog, '');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.ja_na_base, true);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true }, 'grava o sha aprovado, não o HEAD da base');
    assert.equal(amb.topo(BASE), baseAntes);
    assert.equal(amb.topo(BRANCH), aprovado);
    semMover(amb);
    assert.ok(amb.gitChamadas().some((l) => l.endsWith(`merge-base --is-ancestor ${aprovado} refs/heads/${BASE}`)), 'o aprovado é o ancestral testado, a base o descendente');
  });

  test('ja-na-base-aviso-sem-gate-ainda', () => {
    // integração anterior cujo sha NÃO tem o aprovado como ancestral não cobre: cobertura (ii), com T2 ainda por integrar
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    amb.aprovar('T3');
    assert.equal(amb.cli(['integrar', 'T3']).rc, 0);
    g(amb.dir, 'merge', '-q', '--no-ff', '-m', 'chore: T1 entra direto na base', aprovado);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_PROXIMO)]);
    // integração anterior que só "já estava na base" também não cobre: o gate não rodou nela
    const b = ambiente();
    b.aprovar('T1');
    const aprovadoB = b.topo(BRANCH);
    baseAte(b, aprovadoB);
    b.semear([
      ['task.iniciada', { task: 'T3', papel: 'implementador' }],
      ['task.concluida', { task: 'T3', sha: aprovadoB }],
      ['review.veredito', { task: 'T3', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
      ['task.integrada', { task: 'T3', sha: aprovadoB, ja_na_base: true }],
    ]);
    const rb = b.cli(['integrar', 'T1']);
    assert.equal(rb.rc, 0, rb.out + rb.err);
    assert.deepEqual(rb.j.relato, [aviso('T1', aprovadoB, COB_PROXIMO)]);
  });

  test('ja-na-base-aviso-cita-integracao-que-cobriu', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    amb.aprovar('T3');
    const r3 = amb.cli(['integrar', 'T3']);
    assert.equal(r3.rc, 0, r3.out + r3.err);
    assert.equal(r3.j.merge, true, 'T3 integrou com gate sobre a base que já tem o aprovado de T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_GATE('T3'))]);
  });

  test('ja-na-base-ultima-task-cita-ci', () => {
    // única task fora de `integrada`: não há próximo integrar; a cobertura (iii) cita a CI do pedido de revisão
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_CI)]);
    // com outra task já integrada (com gate, antes do aprovado entrar) e nenhuma restante: ainda (iii)
    const b = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T3', deps: [], arquivos: ['src/t3.txt'] }]) });
    b.aprovar('T1');
    const aprovadoB = b.topo(BRANCH);
    b.aprovar('T3');
    assert.equal(b.cli(['integrar', 'T3']).rc, 0);
    g(b.dir, 'merge', '-q', '--no-ff', '-m', 'chore: T1 entra direto na base', aprovadoB);
    const rb = b.cli(['integrar', 'T1']);
    assert.equal(rb.rc, 0, rb.out + rb.err);
    assert.deepEqual(rb.j.relato, [aviso('T1', aprovadoB, COB_CI)]);
  });

  test('ja-na-base-mesmo-alvo-nas-tres-guardas', () => {
    // Correção 1: `alvo` é lido 1 vez do último task.concluida. Depois da 1ª leitura da branch, todo `rev-parse` da branch, da base ou de HEAD
    // devolve um sha falso: se o caminho (b) relesse qualquer um, o gravado mudaria.
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
case "$*" in
  *"rev-parse refs/heads/${BRANCH}"|*"rev-parse refs/heads/${BASE}"|*"rev-parse HEAD")
    if [ -f "$GIT_LOG.marca" ]; then echo ${'f'.repeat(40)}; exit 0; fi
    if [[ "$*" == *"rev-parse refs/heads/${BRANCH}" ]]; then touch "$GIT_LOG.marca"; fi ;;
esac
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(`${amb.gitLog}.marca`), 'a branch foi lida em (a5)');
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true });
    assert.ok(r.j.relato[0].includes(`(${aprovado.slice(0, 12)} é ancestral`), r.j.relato[0]);
    assert.ok(amb.gitChamadas().some((l) => l.endsWith(`merge-base --is-ancestor ${aprovado} refs/heads/${BASE}`)), '(a6) testa o mesmo alvo');
  });

  test('ja-na-base-head-alem-do-aprovado-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    amb.commitNaWt('T1', 'src/t1.txt', 'depois\n', 'feat(GM-10): depois do veredito');
    const topoBranch = amb.topo(BRANCH);
    const antes = semEfeito(amb);
    nadaCli(amb, antes, amb.cli(['integrar', 'T1']), 'commit_nao_revisado');
    assert.equal(amb.topo(BRANCH), topoBranch, 'branch intocada');
  });

  test('ja-na-base-worktree-suja-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    baseAte(amb, amb.topo(BRANCH));
    writeFileSync(join(w, 'novo.txt'), 'x');
    const antes = semEfeito(amb);
    nadaCli(amb, antes, amb.cli(['integrar', 'T1']), 'worktree_suja');
    assert.equal(readFileSync(join(w, 'novo.txt'), 'utf8'), 'x');
  });

  test('ja-na-base-sem-aprovado-recusa', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    baseAte(amb, amb.topo(BRANCH));
    const antes = semEfeito(amb);
    nadaCli(amb, antes, amb.cli(['integrar', 'T1']), 'nao_integravel');
  });

  test('ancestral-indeterminado-recusa', async () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    for (const codigo of [128, null, 2, -1]) {
      const antes = semEfeito(amb);
      const args = [];
      let gate = false;
      const r = await integrarComGate(amb.dir, 'T1', {
        ancestral: (...a) => { args.push(a); return codigo; },
        avaliar: async () => { gate = true; return { reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 0, semContagem: 0 }; },
      });
      assert.equal(r.ok, false, `${codigo} ${JSON.stringify(r)}`);
      assert.equal(r.erro, 'ancestral_indeterminado', String(codigo));
      assert.equal(r.merge, false);
      assert.equal(r.evento, false);
      assert.equal(gate, false, 'nem o caminho normal');
      assert.deepEqual(args, [[amb.dir, aprovado, `refs/heads/${BASE}`]]);
      assert.deepEqual(semEfeito(amb), antes);
      assert.equal(amb.topo(BRANCH), aprovado, 'branch intocada');
      assert.ok(existsSync(w));
      assert.ok(!amb.tipos().includes('task.integrada'));
    }
  });

  test('nao-ancestral-segue-caminho-normal', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    commitNaBase(amb);
    writeFileSync(amb.gitLog, '');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.ok(!('ja_na_base' in r.j));
    assert.ok(!r.j.relato.some((l) => /já estava na base/.test(l)), JSON.stringify(r.j.relato));
    const ev = amb.eventos().at(-1);
    assert.deepEqual(ev.dados, { task: 'T1', sha: amb.topo(BASE), mutacoes: { total: 0, mortas: 0 } });
    assert.ok(amb.gitChamadas().some((l) => / rebase refs\/heads\//.test(l)), 'rebase do caminho normal');
    assert.ok(amb.gitChamadas().some((l) => / merge --ff-only /.test(l)), 'merge do caminho normal');
  });

  /** abrir → iniciar → concluir SEM commit → revisor → APROVADO: o sha aprovado é a própria base do `abrir`. */
  const aprovarSemCommit = (amb, t) => {
    for (const a of [['abrir', t], ['iniciar', t, 'implementador'], ['concluir', t], ['iniciar', t, 'revisor'], ['veredito', t, 'APROVADO', '1', '0', '0']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 0, `${a.join(' ')} ${r.out}`);
    }
    return amb.wt(t);
  };

  test('abrir-grava-o-sha-da-base', () => {
    const amb = ambiente();
    const topo = amb.topo(BASE);
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(g(amb.dir, 'config', '--get', `branch.${BRANCH}.gabaritoBase`).trim(), BASE, 'gabaritoBase guarda o NOME da base');
    assert.equal(g(amb.dir, 'config', '--get', `branch.${BRANCH}.gabaritoBaseSha`).trim(), topo, 'gabaritoBaseSha guarda o sha da base no abrir');
  });

  test('ja-na-base-sem-commit-proprio-recusa', () => {
    // Emenda 2: sem commit próprio desde a base do `abrir`, o caminho (b) não vale; recusa como antes (A3: 0 commits contra a base)
    for (const baseAnda of [true, false]) {
      const amb = ambiente();
      const w = aprovarSemCommit(amb, 'T1');
      const aprovado = amb.topo(BRANCH);
      if (baseAnda) commitNaBase(amb);
      assert.equal(spawnSync(GIT_REAL, ['-C', amb.dir, 'merge-base', '--is-ancestor', aprovado, BASE]).status, 0, 'o aprovado é ancestral da base');
      const topoBase = amb.topo(BASE);
      const r = amb.cli(['integrar', 'T1']);
      assert.equal(r.rc, 1, `${baseAnda} ${r.out}${r.err}`);
      assert.equal(r.j.erro, 'gate_reprovado', r.out);
      assert.ok(r.j.relato.some((l) => /0 commits contra a base/.test(l)), JSON.stringify(r.j.relato));
      assert.equal(r.j.merge, false);
      assert.equal(r.j.evento, false);
      assert.ok(!('ja_na_base' in r.j));
      assert.ok(!amb.tipos().includes('task.integrada'), 'sem task.integrada gravada');
      assert.equal(amb.topo(BASE), topoBase, 'base intocada');
      assert.equal(amb.topo(BRANCH), aprovado, 'a branch voltou ao commit revisado');
      assert.ok(existsSync(w));
    }
  });

  test('ja-na-base-sem-sha-da-base-gravado-segue-caminho-normal', () => {
    // worktree aberta sem `gabaritoBaseSha` (versão anterior do abrir): não há prova de commit próprio, segue o caminho de antes
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    commitNaBase(amb);
    g(amb.dir, 'config', '--unset', `branch.${BRANCH}.gabaritoBaseSha`);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado', r.out);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  /**
   * Emenda 3: a TOPOLOGIA EXATA da T0 real. O commit da task entrou na base ANTES do `abrir`: a branch nasce NELE ("Created from <sha>"),
   * sem commit próprio, e a base anda depois. Só um `desvio` da MESMA task citando o sha aprovado libera o caminho (b); sem ele, recusa (A3).
   */
  const PLANO_DESVIO = planoDe([
    { id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] },
    { id: 'T2', deps: [], arquivos: ['src/t2.txt'], reqs: ['REQ-A-2'] },
  ]);
  const topologiaT0 = ({ semShaGravado = false } = {}) => {
    const amb = ambiente({ plano: PLANO_DESVIO });
    writeFileSync(join(amb.dir, 'src/t1.txt'), 't0 commitada direto na base\n');
    g(amb.dir, 'add', 'src/t1.txt');
    g(amb.dir, 'commit', '-q', '-m', 'docs(GM-10): T0 direto na base');
    const aprovado = amb.topo(BASE);
    const w = aprovarSemCommit(amb, 'T1');
    commitNaBase(amb);
    // fatos do git medidos, não presumidos: a branch nasceu no aprovado, sem commit próprio, e ele é ancestral da base
    assert.equal(amb.topo(BRANCH), aprovado);
    assert.match(g(amb.dir, 'reflog', 'show', '--format=%gs', BRANCH).trim().split('\n').at(-1), new RegExp(`^branch: Created from ${aprovado}$`));
    assert.equal(g(amb.dir, 'merge-base', BRANCH, BASE).trim(), aprovado);
    assert.equal(g(amb.dir, 'rev-list', '--count', `${aprovado}..${BRANCH}`).trim(), '0');
    assert.equal(spawnSync(GIT_REAL, ['-C', amb.dir, 'merge-base', '--is-ancestor', aprovado, BASE]).status, 0);
    if (semShaGravado) g(amb.dir, 'config', '--unset', `branch.${BRANCH}.gabaritoBaseSha`);
    return { amb, w, aprovado };
  };
  const desvio = (amb, task, req, evidencia, arquivos = '') => {
    const r = amb.cli(['desvio', task, '--req', req, '--evidencia', evidencia, '--arquivos', arquivos, '--causa', 'tecnica']);
    assert.equal(r.rc, 0, r.out + r.err);
  };
  const recusaZeroCommits = (amb, w, aprovado) => {
    const topoBase = amb.topo(BASE);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado', r.out);
    assert.ok(r.j.relato.some((l) => /0 commits contra a base/.test(l)), JSON.stringify(r.j.relato));
    assert.equal(r.j.evento, false);
    assert.ok(!('ja_na_base' in r.j));
    assert.ok(!amb.tipos().includes('task.integrada'), 'nada gravado');
    assert.equal(amb.topo(BASE), topoBase, 'base intocada');
    assert.equal(amb.topo(BRANCH), aprovado, 'a branch voltou ao commit revisado');
    assert.ok(existsSync(w));
  };
  const integraPorB = (amb, w, aprovado) => {
    const topoBase = amb.topo(BASE);
    writeFileSync(amb.gitLog, '');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.ja_na_base, true);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true });
    assert.equal(amb.topo(BASE), topoBase, 'a base não se move');
    assert.ok(!existsSync(w), 'worktree fechada');
    semMover(amb);
  };

  test('t0-sem-desvio-recusa-zero-commits', () => {
    for (const semShaGravado of [false, true]) {
      const { amb, w, aprovado } = topologiaT0({ semShaGravado });
      recusaZeroCommits(amb, w, aprovado);
    }
  });

  test('t0-desvio-da-task-citando-o-sha-integra-por-b', () => {
    for (const semShaGravado of [false, true]) {
      // sha completo em `evidencia`; com e sem `gabaritoBaseSha` (abrir antigo)
      const { amb, w, aprovado } = topologiaT0({ semShaGravado });
      desvio(amb, 'T1', 'REQ-A-1', `T0 commitada na base antes do abrir: ${aprovado}`);
      integraPorB(amb, w, aprovado);
    }
  });

  test('t0-desvio-cita-sha-curto-inequivoco-integra-por-b', () => {
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T1', 'REQ-A-1', `T0 na base (${aprovado.slice(0, 7)}), reflog Created from`);
    integraPorB(amb, w, aprovado);
  });

  test('t0-desvio-cita-sha-em-arquivos-integra-por-b', () => {
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T1', 'REQ-A-1', 'T0 commitada na base antes do abrir', `src/t1.txt,${aprovado.slice(0, 12)}`);
    integraPorB(amb, w, aprovado);
  });

  test('t0-desvio-de-outra-task-citando-o-sha-recusa', () => {
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T2', 'REQ-A-2', `T0 commitada na base antes do abrir: ${aprovado}`, aprovado);
    recusaZeroCommits(amb, w, aprovado);
  });

  test('t0-evento-de-outro-tipo-da-mesma-task-citando-o-sha-recusa', () => {
    // a exceção é SÓ do `desvio`: proposta de emenda (a rejeitada; a aceita reabriria a aprovação) da MESMA task, citando o sha em evidencia e em arquivos, não libera (b)
    const { amb, w, aprovado } = topologiaT0();
    const dados = PROPOSTA({ task: 'T1', evidencia: `T0 na base: ${aprovado}`, arquivos: [aprovado] });
    escreve(amb, 'emendas', 'emenda.proposta', dados, '2026-02-01T00:00:01.000Z');
    escreve(amb, 'dono', 'emenda.rejeitada', { proposta_seq: 1, origem: 'dono' }, '2026-02-01T00:00:02.000Z');
    recusaZeroCommits(amb, w, aprovado);
  });

  test('t0-desvio-da-task-citando-outro-sha-recusa', () => {
    const { amb, w, aprovado } = topologiaT0();
    const outro = amb.topo(BASE);
    assert.notEqual(outro, aprovado);
    desvio(amb, 'T1', 'REQ-A-1', `outro commit: ${outro}`, outro.slice(0, 12));
    recusaZeroCommits(amb, w, aprovado);
  });

  test('t0-desvio-cita-sha-curto-demais-ou-ambiguo-recusa', () => {
    // 6 hex não cita; prefixo que o git não resolve só para o aprovado (ambíguo) não cita; sha com 1 hex a mais (41) não cita; maiúsculas não são o texto exato
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T1', 'REQ-A-1', `curto ${aprovado.slice(0, 6)} longo ${aprovado}0 caixa ${aprovado.toUpperCase()} colado x${aprovado.slice(0, 8)}`);
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"rev-parse --verify --quiet --end-of-options ${aprovado.slice(0, 7)}" ]]; then exit 128; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    desvio(amb, 'T1', 'REQ-A-1', `ambíguo ${aprovado.slice(0, 7)}`);
    recusaZeroCommits(amb, w, aprovado);
  });

  test('ja-na-base-commit-proprio-indeterminado-recusa', async () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const baseAbrir = g(amb.dir, 'config', '--get', `branch.${BRANCH}.gabaritoBaseSha`).trim();
    for (const codigo of [128, null]) {
      const antes = semEfeito(amb);
      const args = [];
      let gate = false;
      const r = await integrarComGate(amb.dir, 'T1', {
        ancestral: (...a) => { args.push(a); return args.length === 1 ? 0 : codigo; },
        avaliar: async () => { gate = true; return { reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 0, semContagem: 0 }; },
      });
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.equal(r.erro, 'ancestral_indeterminado', String(codigo));
      assert.equal(r.merge, false);
      assert.equal(r.evento, false);
      assert.equal(gate, false);
      assert.deepEqual(args, [[amb.dir, aprovado, `refs/heads/${BASE}`], [amb.dir, aprovado, baseAbrir]]);
      assert.deepEqual(semEfeito(amb), antes);
      assert.ok(existsSync(w));
    }
  });

  test('ja-na-base-erro-do-git-na-cobertura-nao-cobriu', () => {
    // FIEL-9 (b4): `merge-base --is-ancestor` que falha na cobertura conta como "não cobriu", nunca como cobertura
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    amb.aprovar('T3');
    assert.equal(amb.cli(['integrar', 'T3']).rc, 0);
    const shaT3 = amb.eventos().at(-1).dados.sha;
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"merge-base --is-ancestor ${aprovado} ${shaT3}" ]]; then echo "fatal: injetado" >&2; exit 128; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(amb.gitChamadas().some((l) => l.endsWith(`merge-base --is-ancestor ${aprovado} ${shaT3}`)), 'a cobertura testou a integração de T3');
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_PROXIMO)]);
  });

  test('ja-na-base-cobertura-cita-a-primeira-integracao-do-diario', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T3', deps: [], arquivos: ['src/t3.txt'] }, { id: 'T4', deps: [], arquivos: ['src/t4.txt'] }]) });
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    for (const t of ['T3', 'T4']) {
      amb.aprovar(t);
      const ri = amb.cli(['integrar', t]);
      assert.equal(ri.rc, 0, ri.out + ri.err);
      assert.equal(ri.j.merge, true, `${t} integrou com gate`);
    }
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_GATE('T3'))]);
  });

  test('ja-na-base-evento-nao-gravado-nao-fecha', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const topoBase = amb.topo(BASE);
    chmodSync(amb.entregas, 0o555);
    let r;
    try { r = amb.cli(['integrar', 'T1']); } finally { chmodSync(amb.entregas, 0o755); }
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'evento_nao_gravado');
    assert.equal(r.j.merge, false, 'nada foi movido');
    assert.equal(r.j.evento, false);
    assert.match(r.j.mensagem, /já estava na base/);
    assert.ok(!amb.tipos().includes('task.integrada'));
    assert.ok(existsSync(w), 'fechar não foi chamado');
    assert.ok(!amb.gitChamadas().some((l) => /worktree remove/.test(l)));
    assert.equal(amb.topo(BASE), topoBase);
    assert.equal(amb.topo(BRANCH), aprovado);
  });

  test('ja-na-base-fechar-falha-relata-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'fechar_falhou');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, true);
    assert.match(r.j.mensagem, /já estava na base/);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true });
  });

  test('proxima-apos-ja-na-base', () => {
    // com pendente: antes integrar, depois despachar a dependente
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: ['T1'], arquivos: ['src/t2.txt'] }]) });
    amb.aprovar('T1');
    baseAte(amb, amb.topo(BRANCH));
    amb.fechar();
    const antes = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(antes.rc, 0, antes.out);
    assert.deepEqual(antes.j.acao, { tipo: 'integrar', tasks: ['T1'] });
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    amb.fechar();
    const depois = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(depois.rc, 0, depois.out);
    assert.equal(depois.j.acao.tipo, 'despachar', JSON.stringify(depois.j.acao));
    assert.deepEqual(depois.j.acao.itens.map((i) => i.task), ['T2']);
    // sem pendente: depois concluir
    const b = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });
    b.aprovar('T1');
    baseAte(b, b.topo(BRANCH));
    b.fechar();
    assert.equal(b.cli(['proxima', '--vivos', '0']).j.acao.tipo, 'integrar');
    assert.equal(b.cli(['integrar', 'T1']).rc, 0);
    b.fechar();
    const fim = b.cli(['proxima', '--vivos', '0']);
    assert.equal(fim.j.acao.tipo, 'concluir', JSON.stringify(fim.j.acao));
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
    amb.fechar(); // REQ-APR-2 muda a ordem: o MAJOR do REPROVADO abre pendência antes da correção
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
    assert.ok(existsSync(join(b.j.worktree, '.tmp-gabarito', '.gitignore')), 'o .tmp-gabarito segue pronto');
    assert.ok(existsSync(b.j.tmpdir), 'o TMPDIR da task segue pronto');
  });

  test('abrir-duas-vezes-recria-o-tmpdir-que-sumiu', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    rmSync(a.j.tmpdir, { recursive: true });
    rmSync(join(a.j.worktree, '.tmp-gabarito'), { recursive: true });
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.ok(existsSync(a.j.tmpdir));
    assert.ok(existsSync(join(a.j.worktree, '.tmp-gabarito', '.gitignore')));
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
      const ach = join(a.j.worktree, '.tmp-gabarito');
      const alvo = fora(amb, 'a');
      rmSync(ach, { recursive: true });
      symlinkSync(alvo, ach);
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
      assert.deepEqual(readdirSync(alvo), [], 'nada escrito fora da worktree');
    });
    test('abrir-repetido-recusa-gitignore-symlink: o alvo do link não é tocado', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const ach = join(a.j.worktree, '.tmp-gabarito');
      const alvo = join(fora(amb, 'g'), 'alvo.txt');
      writeFileSync(alvo, 'intacto');
      rmSync(join(ach, '.gitignore'));
      symlinkSync(alvo, join(ach, '.gitignore'));
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
      assert.equal(readFileSync(alvo, 'utf8'), 'intacto');
    });
    test('abrir-repetido-recusa-tmp-arquivo-comum', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const ach = join(a.j.worktree, '.tmp-gabarito');
      rmSync(ach, { recursive: true });
      writeFileSync(ach, 'x');
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

  test('achados-seguem-em-tmp-gabarito: o veredito lê da worktree, o TMPDIR da task é outro', () => {
    const amb = ambiente();
    reprovarR1(amb);
    const arq = achadosDe(amb, 'T1', 1);
    assert.equal(arq, join(amb.wt('T1'), '.tmp-gabarito', 'review-r1.md'));
    assert.ok(existsSync(arq));
    const p = amb.cli(['proxima']);
    assert.match(JSON.stringify(p.j), /\.tmp-gabarito\/review-r1\.md/);
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

// ═══════════════════════════════════════════════════════════════ GM-11 T10: proxima com Sombra e emendas, CLI de emenda, desvio, ci
// MUTAÇÕES PRESCRITAS: task-10-mut.json da entrega (.superpowers/sdd/2026-11-09-e3-sombra/).

const H = (c) => c.repeat(64);
const PLANO_REQ = {
  entrega: 'GM-10',
  spec: 'docs/spec.md',
  tasks: [
    { id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] },
    { id: 'T2', deps: [], arquivos: ['src/t2.txt'], reqs: ['REQ-B-1'] },
    { id: 'T3', deps: ['T1'], arquivos: ['src/t3.txt'], reqs: ['REQ-C-1'] },
  ],
};
const PLANO_AJUSTE = {
  entrega: 'GM-10',
  tasks: [
    { id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] },
    { id: 'T5', deps: ['T1'], arquivos: ['src/t5.txt'], reqs: ['REQ-A-1'] },
  ],
};
const IMPL_E = (t) => [['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: 'a'.repeat(40) }]];
const APROVA_E = (t) => ['review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }];
const INTEGRA_E = (t) => ['task.integrada', { task: t, sha: 'a'.repeat(40) }];
const REPROVA_E = (t) => ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }];
const PROPOSTA = (extra = {}) => ({ req: 'REQ-A-1', diff: '+ regra nova', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio', ...extra });

/** Relógio que só cresce, em segundos a partir de 2026-02-01: o que vai de uma sessão para outra respeita a ordem de escrita. */
const relogioDe = () => { let n = 0; return () => new Date(Date.UTC(2026, 1, 1, 0, 0, ++n)).toISOString(); };
function escreve(amb, sessao, tipo, dados, ts) {
  const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
  assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
}
/** `lista` = [[sessao?, tipo, dados]] ; sem sessão ⇒ `loop`. */
function grava(amb, rel, lista) {
  for (const it of lista) {
    const [sessao, tipo, dados] = it.length === 3 ? it : ['loop', ...it];
    escreve(amb, sessao, tipo, dados, rel());
  }
  amb.fechar(); // REQ-APR-2 muda a ordem
}
const bytesDoDiario = (amb) => Object.fromEntries(readdirSync(amb.entregas).filter((n) => n.startsWith('events.')).sort().map((n) => [n, readFileSync(join(amb.entregas, n), 'utf8')]));
const ambReq = (opts = {}) => {
  const amb = ambiente({ plano: PLANO_REQ, ...opts });
  mkdirSync(join(amb.dir, 'docs'), { recursive: true });
  writeFileSync(join(amb.dir, 'docs', 'spec.md'), '# Spec\n\n**REQ-A-1** regra A.\n\n**REQ-B-1** regra B.\n\n**REQ-C-1** regra C.\n');
  return amb;
};

/** `refs/remotes/origin/HEAD` com `harness.config.json` = `cfg` (texto ou objeto), por plumbing: a árvore local não muda. */
function comOrigin(amb, cfg) {
  const texto = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
  const feito = (args, input) => {
    const r = spawnSync('git', ['-C', amb.dir, ...args], { encoding: 'utf8', input });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const blob = feito(['hash-object', '-w', '--stdin'], texto);
  const arvore = feito(['mktree'], `100644 blob ${blob}\tharness.config.json\n`);
  const commit = feito(['commit-tree', arvore, '-m', 'origin'], undefined);
  feito(['update-ref', 'refs/remotes/origin/main', commit]);
  feito(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
}
const diffEm = (amb, texto = '--- a\n+++ b\n+ regra\n', nome = 'd.diff') => {
  const f = join(amb.tmpSistema, nome);
  writeFileSync(f, texto);
  return f;
};
const proporArgs = (amb, extra = {}, { diff } = {}) => {
  const f = { req: 'REQ-A-1', diff: diff ?? diffEm(amb), fato: 'fato', alternativa: 'alt', evidencia: 'evid', causa: 'regra_negocio', ...extra };
  return ['emenda', 'propor', ...Object.entries(f).flatMap(([k, v]) => (v === undefined ? [] : [`--${k}`, v]))];
};
const emendasDoDiario = (amb) => diario.ler(amb.entregas).filter((e) => e.sessao === 'emendas');

describe('E3 T10: proxima, modelo, decisões, emendas e avisos', () => {
  test('parar-motivos-da-e3-aceitos: smoke, rollback e janela_ausente gravam loop.parar', () => {
    for (const motivo of ['smoke', 'rollback', 'janela_ausente']) {
      const amb = ambiente();
      const r = amb.cli(['parar', motivo]);
      assert.equal(r.rc, 0, `${motivo}: ${r.out}`);
      assert.deepEqual(amb.eventos().at(-1).dados, { motivo });
    }
  });

  test('proxima-item-traz-modelo: implementador e correção usam o implementador, revisor o revisor', () => {
    const amb = ambiente();
    const imp = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.ok(imp.length >= 1 && imp.every((i) => i.papel === 'implementador'));
    for (const i of imp) assert.deepEqual(i.modelo, { modelo: 'sonnet', esforco: 'high' });
    const rev = ambiente();
    rev.semear(IMPL_E('T1'));
    const ri = rev.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'revisor');
    assert.deepEqual(ri.modelo, { modelo: 'opus' });
    const cor = ambiente();
    cor.semear([...IMPL_E('T1'), REPROVA_E('T1')]);
    const ci = cor.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'correcao');
    assert.deepEqual(ci.modelo, { modelo: 'sonnet', esforco: 'high' });
  });

  test('proxima-modelo-config-vence-padrao e proxima-modelo-normaliza-id-completo', () => {
    const cfg = { ...CONFIG_PADRAO, orquestracao: { modelos: { implementador: { modelo: 'Claude-Haiku-5-5', esforco: 'low' }, revisor: 'claude-opus-5-5' } } };
    const amb = ambiente({ config: cfg });
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(p.j.acao.itens[0].modelo, { modelo: 'haiku', esforco: 'low' });
    assert.ok(!(p.j.aviso ?? []).some((a) => /modelo/i.test(a)), JSON.stringify(p.j.aviso));
    amb.semear(IMPL_E('T1'));
    const ri = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'revisor');
    assert.deepEqual(ri.modelo, { modelo: 'opus' });
  });

  test('proxima-modelo-desconhecido-padrao-com-aviso: família desconhecida, entrada torta e `modelos` que não é objeto', () => {
    const casos = [
      [{ revisor: 'gpt-4' }, /revisor/],
      [{ revisor: 42 }, /revisor/],
      [{ revisor: { esforco: 'low' } }, /revisor/],
      [['x'], /modelos/],
    ];
    for (const [modelos, aviso] of casos) {
      const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { modelos } } });
      amb.semear(IMPL_E('T1'));
      const p = amb.cli(['proxima', '--vivos', '0']);
      assert.deepEqual(p.j.acao.itens.find((i) => i.papel === 'revisor').modelo, { modelo: 'opus' }, JSON.stringify(modelos));
      assert.ok(p.j.aviso.some((a) => aviso.test(a) && /modelo/i.test(a)), `${JSON.stringify(modelos)} ⇒ ${JSON.stringify(p.j.aviso)}`);
    }
  });

  test('proxima-item-modelo-do-perfil: o perfil escolhe a família do item; o explícito vence; perfil inválido avisa e vale o padrão', () => {
    const itens = (orq) => {
      const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: orq } });
      amb.semear([...IMPL_E('T1'), ...IMPL_E('T3')]);
      const p = amb.cli(['proxima', '--vivos', '0']);
      return { p, rev: p.j.acao.itens.find((i) => i.papel === 'revisor'), amb };
    };
    const e = itens({ perfil: 'economia' });
    assert.deepEqual(e.rev.modelo, { modelo: 'sonnet' });
    assert.ok(!(e.p.j.aviso ?? []).some((a) => /modelo/i.test(a)), JSON.stringify(e.p.j.aviso));
    assert.deepEqual(itens({ perfil: 'qualidade' }).rev.modelo, { modelo: 'opus' });
    const imp = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { perfil: 'economia' } } }).cli(['proxima', '--vivos', '0']).j.acao.itens[0];
    assert.deepEqual(imp.modelo, { modelo: 'sonnet', esforco: 'medium' });
    const q = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { perfil: 'qualidade' } } }).cli(['proxima', '--vivos', '0']).j.acao.itens[0];
    assert.deepEqual(q.modelo, { modelo: 'opus', esforco: 'high' });
    assert.deepEqual(itens({ perfil: 'economia', modelos: { revisor: 'haiku' } }).rev.modelo, { modelo: 'haiku' });
    const inv = itens({ perfil: 'luxo' });
    assert.deepEqual(inv.rev.modelo, { modelo: 'opus' });
    assert.ok(inv.p.j.aviso.some((a) => /modelo do papel revisor: orquestracao\.perfil inválido/.test(a)), JSON.stringify(inv.p.j.aviso));
    assert.equal(inv.p.j.acao.itens.filter((i) => i.papel === 'revisor').length, 2, 'dois itens do mesmo papel');
    assert.equal(inv.p.j.aviso.filter((a) => /modelo do papel revisor: .*perfil inválido/.test(a)).length, 1, 'o aviso não se repete por item do mesmo papel');
  });

  test('item-implementador-traz-decisoes-do-req, item-traz-decisao-ancora-task e item-decisao-arquivo-absoluto', () => {
    const amb = ambReq();
    const rel = relogioDe();
    const dec = (h, ancora, resp) => ['decisao.sombra', { pergunta_hash: h, ...ancora, resposta: resp, arquivo: `.harness/entregas/GM-10/sombra/${h}.x.resposta.md`, pergunta_enviesada: false, fontes: ['spec'] }];
    grava(amb, rel, [
      ['sombra.consulta', { pergunta_hash: H('1'), req: 'REQ-A-1' }], dec(H('1'), { req: 'REQ-A-1' }, 'resposta do req A'),
      ['sombra.consulta', { pergunta_hash: H('2'), task: 'T1' }], dec(H('2'), { task: 'T1' }, 'resposta da task T1'),
      ['sombra.consulta', { pergunta_hash: H('3'), req: 'REQ-B-1' }], dec(H('3'), { req: 'REQ-B-1' }, 'resposta do req B'),
      ['sombra.consulta', { pergunta_hash: H('4'), task: 'T2' }], dec(H('4'), { task: 'T2' }, 'resposta da task T2'),
    ]);
    const antesBytes = bytesDoDiario(amb);
    const itens = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.deepEqual(bytesDoDiario(amb), antesBytes, 'proxima não grava nada em nenhuma linha');
    const t1 = itens.find((i) => i.task === 'T1');
    const t2 = itens.find((i) => i.task === 'T2');
    assert.deepEqual(t1.decisoes.map((d) => [d.hash, d.ancora, d.resposta]), [[H('2'), 'task:T1', 'resposta da task T1'], [H('1'), 'REQ-A-1', 'resposta do req A']]);
    assert.deepEqual(t2.decisoes.map((d) => d.resposta), ['resposta da task T2', 'resposta do req B']);
    assert.equal(t1.decisoes[0].arquivo, join(amb.dir, '.harness', 'entregas', 'GM-10', 'sombra', `${H('2')}.x.resposta.md`));
    assert.ok(isAbsolute(t1.decisoes[1].arquivo));
  });

  test('item-decisao-fora-da-raiz-omitida: decisão com `arquivo` que resolve fora da raiz do repositório não vira caminho do item', () => {
    const amb = ambReq();
    const dec = (h, arquivo, resp) => ['decisao.sombra', { pergunta_hash: h, req: 'REQ-A-1', resposta: resp, arquivo, pergunta_enviesada: false, fontes: ['spec'] }];
    grava(amb, relogioDe(), [
      ['sombra.consulta', { pergunta_hash: H('1'), req: 'REQ-A-1' }], dec(H('1'), '../../x.resposta.md', 'fora por ..'),
      ['sombra.consulta', { pergunta_hash: H('2'), req: 'REQ-A-1' }], dec(H('2'), '.harness/entregas/GM-10/sombra/dentro.resposta.md', 'dentro'),
    ]);
    const t1 = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1');
    assert.deepEqual(t1.decisoes.map((d) => d.resposta), ['dentro'], JSON.stringify(t1.decisoes));
    for (const d of t1.decisoes) assert.ok(d.arquivo.startsWith(amb.dir), d.arquivo);
  });

  test('item-omite-decisao-anterior-a-emenda: só a consulta posterior à última emenda do REQ da âncora entra', () => {
    const amb = ambReq();
    const rel = relogioDe();
    const dec = (h, ancora, resp) => ['decisao.sombra', { pergunta_hash: h, ...ancora, resposta: resp, arquivo: `.harness/entregas/GM-10/sombra/${h}.x.resposta.md`, pergunta_enviesada: false, fontes: ['spec'] }];
    grava(amb, rel, [
      ['sombra.consulta', { pergunta_hash: H('1'), req: 'REQ-A-1' }], dec(H('1'), { req: 'REQ-A-1' }, 'velha do req A'),
      ['sombra.consulta', { pergunta_hash: H('2'), task: 'T1' }], dec(H('2'), { task: 'T1' }, 'velha da task T1'),
      ['sombra.consulta', { pergunta_hash: H('3'), req: 'REQ-B-1' }], dec(H('3'), { req: 'REQ-B-1' }, 'req B, outro REQ'),
      ['emendas', 'emenda.proposta', PROPOSTA()],
      ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }],
      ['sombra.consulta', { pergunta_hash: H('5'), req: 'REQ-A-1' }], dec(H('5'), { req: 'REQ-A-1' }, 'nova do req A'),
      ['sombra.consulta', { pergunta_hash: H('6'), task: 'T1' }], dec(H('6'), { task: 'T1' }, 'nova da task T1'),
    ]);
    const itens = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.deepEqual(itens.find((i) => i.task === 'T1').decisoes.map((d) => d.resposta), ['nova da task T1', 'nova do req A']);
    assert.deepEqual(itens.find((i) => i.task === 'T2').decisoes.map((d) => d.resposta), ['req B, outro REQ'], 'a emenda de REQ-A-1 não tira a decisão de REQ-B-1');
  });

  test('item-implementador-traz-emendas-aprovadas, item-correcao-traz-emendas-aprovadas e revisor-item-traz-emendas-aprovadas', () => {
    const base = [
      ['emendas', 'emenda.proposta', PROPOSTA({ diff: '+ A um' })],
      ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }],
      ['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1', diff: '+ B um' })],
      ['dono', 'spec.emendada', { proposta_seq: 2, origem: 'dono' }],
      ['emendas', 'emenda.proposta', PROPOSTA({ diff: '+ A dois' })],
      ['dono', 'spec.emendada', { proposta_seq: 3, origem: 'dono' }],
      ['emendas', 'emenda.proposta', PROPOSTA({ diff: '+ A rejeitada' })],
      ['dono', 'emenda.rejeitada', { proposta_seq: 4, origem: 'dono' }],
    ];
    const casos = [
      ['implementador', []],
      ['revisor', IMPL_E('T1')],
      ['correcao', [...IMPL_E('T1'), REPROVA_E('T1')]],
    ];
    for (const [papel, estado] of casos) {
      const amb = ambReq();
      const rel = relogioDe();
      grava(amb, rel, [...estado, ...base]);
      const item = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1');
      assert.equal(item.papel, papel);
      assert.deepEqual(item.emendas, [{ proposta_seq: 1, req: 'REQ-A-1', diff: '+ A um' }, { proposta_seq: 3, req: 'REQ-A-1', diff: '+ A dois' }], papel);
    }
  });

  test('proxima-aviso-acima-do-teto: 26 não avisa (teto padrão), 27 avisa com o número e o teto', () => {
    const amb = ambiente();
    const rel = relogioDe();
    const consultas = (n, de = 0) => Array.from({ length: n }, (_, i) => ['sombra.consulta', { pergunta_hash: (de + i + 1).toString(16).padStart(64, '0'), req: 'REQ-A-1' }]);
    grava(amb, rel, consultas(26));
    const p26 = amb.cli(['proxima', '--vivos', '0']).j;
    assert.ok(!(p26.aviso ?? []).some((a) => /Sombra/.test(a)), JSON.stringify(p26.aviso));
    grava(amb, rel, consultas(1, 26));
    const p27 = amb.cli(['proxima', '--vivos', '0']).j;
    assert.ok(p27.aviso.includes('Atenção: 27 consultas à Sombra, teto 26'), JSON.stringify(p27.aviso));
  });

  test('proxima-teto-de-origin: 5 vale; "30", 0 e 1.5 caem em 26 com aviso; origin corrompida cai em 26 com aviso do motivo', () => {
    const consultas = (n) => Array.from({ length: n }, (_, i) => ['sombra.consulta', { pergunta_hash: (i + 1).toString(16).padStart(64, '0'), req: 'REQ-A-1' }]);
    const a5 = ambiente();
    comOrigin(a5, { sombra: { teto: 5 } });
    grava(a5, relogioDe(), consultas(6));
    assert.ok(a5.cli(['proxima', '--vivos', '0']).j.aviso.includes('Atenção: 6 consultas à Sombra, teto 5'));
    for (const teto of ['30', 0, 1.5]) {
      const amb = ambiente();
      comOrigin(amb, { sombra: { teto } });
      grava(amb, relogioDe(), consultas(27));
      const j = amb.cli(['proxima', '--vivos', '0']).j;
      assert.ok(j.aviso.includes('Atenção: 27 consultas à Sombra, teto 26'), `${teto}: ${JSON.stringify(j.aviso)}`);
      assert.ok(j.aviso.some((x) => /sombra\.teto/.test(x)), `${teto}: aviso do teto inválido ${JSON.stringify(j.aviso)}`);
    }
    const ruim = ambiente();
    comOrigin(ruim, '{nao json');
    const j = ruim.cli(['proxima', '--vivos', '0']).j;
    assert.equal(j.ok, true);
    assert.ok(j.aviso.some((x) => /config de origin inv.lida: .*JSON ileg.vel/.test(x)), JSON.stringify(j.aviso));
    const ausente = ambiente().cli(['proxima', '--vivos', '0']).j;
    assert.ok(!(ausente.aviso ?? []).some((x) => /origin/.test(x)), 'sem origin não é erro');
  });

  test('proxima-origin-invalida-aviso: a política de entrega inválida de origin degrada e é avisada', () => {
    const amb = ambiente();
    comOrigin(amb, { entrega: { politica: 'sempre' } });
    const j = amb.cli(['proxima', '--vivos', '0']).j;
    assert.equal(j.ok, true);
    assert.ok(j.aviso.some((x) => /entrega\.politica/.test(x)), JSON.stringify(j.aviso));
  });

  test('proxima-politica-afrouxada-falha: plano continua com origin janela ⇒ ok:false politica_afrouxada, rc 1, sem ação', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: false, politica: 'continua' } };
    const amb = ambiente({ plano });
    comOrigin(amb, { entrega: { politica: 'janela', janela: { dias: [1], inicio: '09:00', fim: '10:00', fuso: 'UTC' } } });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'politica_afrouxada');
    assert.match(r.j.mensagem, /continua/);
    assert.equal(r.j.acao, undefined);
    assert.equal(amb.eventos().length, 0, 'nada gravado');
  });

  test('proxima-afrouxada-com-autonomia-confronta: origin janela COM autonomia, plano continua ⇒ politica_afrouxada pelo confronto (não pelo rebaixamento)', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: false, politica: 'continua' } };
    const amb = ambiente({ plano });
    comOrigin(amb, { entrega: { politica: 'janela', autonomia: true, janela: { dias: [1], inicio: '09:00', fim: '10:00', fuso: 'UTC' } } });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'politica_afrouxada');
    assert.match(r.j.mensagem, /"continua", mais frouxo que o config \("janela"\)/);
    assert.doesNotMatch(r.j.mensagem, /sem entrega\.autonomia/, 'sem rebaixamento a mensagem não cita autonomia');
  });

  test('proxima-autonomia-politica-efetiva-no-loop: origin continua SEM autonomia + exige_prod ⇒ parar{janela_ausente}; COM autonomia true ⇒ não para (costura loop ⇒ politicaEfetiva ⇒ proximaAcao 4b)', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: true } };
    for (const entrega of [{ politica: 'continua' }, { politica: 'continua', autonomia: false }]) {
      const sem = ambiente({ plano });
      comOrigin(sem, { entrega });
      const j = sem.cli(['proxima', '--vivos', '0']).j;
      assert.deepEqual(j.acao, { tipo: 'parar', motivo: 'janela_ausente' }, JSON.stringify(entrega));
    }
    const com = ambiente({ plano });
    comOrigin(com, { entrega: { politica: 'continua', autonomia: true } });
    const j = com.cli(['proxima', '--vivos', '0']).j;
    assert.equal(j.ok, true);
    assert.notDeepEqual(j.acao, { tipo: 'parar', motivo: 'janela_ausente' }, 'autonomia true mantém a continua declarada');
    assert.equal(j.acao.tipo, 'despachar', JSON.stringify(j.acao));
  });

  test('proxima-janela-ausente: exige_prod e política sob_demanda ⇒ parar{janela_ausente}; o motivo é gravável por `parar`', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: true } };
    const amb = ambiente({ plano });
    const j = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual(j.acao, { tipo: 'parar', motivo: 'janela_ausente' });
    assert.equal(amb.cli(['parar', 'janela_ausente']).rc, 0);
    const abre = ambiente({ plano: { ...PLANO_PADRAO, politica_entrega: { exige_prod: true, politica: 'janela' } } });
    comOrigin(abre, { entrega: { politica: 'continua', autonomia: true } }); // o plano aperta continua → janela, mas não traz a janela
    const r = abre.cli(['proxima', '--vivos', '0']);
    assert.equal(r.j.erro, 'janela_ausente', 'janela pedida sem janela declarada recusa com a causa');
    assert.equal(r.rc, 1);
  });

  const AVISO_EMENDA = (j, re) => (j.aviso ?? []).filter((a) => re.test(a));

  test('proxima-aviso-emenda-em-integrada: emenda posterior à integração de task com o REQ avisa, citando a task e o seq', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]]);
    const j = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual(AVISO_EMENDA(j, /emendado/), ['Atenção: REQ-A-1 emendado (#1) depois de T1 integrada/aprovada: acrescente task de ajuste']);
  });

  test('proxima-aviso-emenda-apos-aprovacao: task só aprovada (não integrada) também avisa (P1b D6-4)', () => {
    const amb = ambiente({ plano: { entrega: 'GM-10', tasks: [PLANO_AJUSTE.tasks[0]] } });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]]);
    assert.equal(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /REQ-A-1 emendado \(#1\) depois de T1/).length, 1);
  });

  test('proxima-aviso-emenda-antes-da-integracao-calado: emenda anterior à integração não avisa', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }], APROVA_E('T1'), INTEGRA_E('T1')]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/), []);
  });

  test('proxima-aviso-emenda-aprovada-antes-integrada-depois: a referência é o último APROVADO; integrar depois da emenda sem revisão nova não cala', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }], INTEGRA_E('T1')]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/), ['Atenção: REQ-A-1 emendado (#1) depois de T1 integrada/aprovada: acrescente task de ajuste']);
  });

  test('proxima-aviso-cala-so-com-ajuste-revisado: outra task integrada depois do julgamento mas aprovada antes dele não cala', () => {
    const amb = ambiente({ plano: PLANO_AJUSTE });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...IMPL_E('T5'), APROVA_E('T5'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }], INTEGRA_E('T5')]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/).map((a) => /depois de (T\d)/.exec(a)[1]), ['T1', 'T5']);
  });

  test('proxima-aviso-cala-com-task-de-ajuste: outra task com o REQ pendente, ou integrada depois do julgamento, cala; integrada antes avisa as duas', () => {
    const emenda = [['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]];
    const pendente = ambiente({ plano: PLANO_AJUSTE });
    grava(pendente, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...emenda]);
    assert.deepEqual(AVISO_EMENDA(pendente.cli(['proxima', '--vivos', '0']).j, /emendado/), [], 'T5 (mesmo REQ) ainda pendente: o ajuste está a caminho');
    const emCurso = ambiente({ plano: PLANO_AJUSTE });
    grava(emCurso, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...emenda, ...IMPL_E('T5')]);
    assert.deepEqual(AVISO_EMENDA(emCurso.cli(['proxima', '--vivos', '0']).j, /emendado/), [], 'T5 em curso também cala');
    const depois = ambiente({ plano: PLANO_AJUSTE });
    grava(depois, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...emenda, ...IMPL_E('T5'), APROVA_E('T5'), INTEGRA_E('T5')]);
    assert.deepEqual(AVISO_EMENDA(depois.cli(['proxima', '--vivos', '0']).j, /emendado/), [], 'T5 integrada depois do julgamento: ajuste feito');
    const antes = ambiente({ plano: PLANO_AJUSTE });
    grava(antes, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...IMPL_E('T5'), APROVA_E('T5'), INTEGRA_E('T5'), ...emenda]);
    assert.deepEqual(AVISO_EMENDA(antes.cli(['proxima', '--vivos', '0']).j, /emendado/).map((a) => /depois de (T\d)/.exec(a)[1]), ['T1', 'T5']);
  });
});

describe('E3 T10: emenda propor, emenda julgar, desvio, descoberta e ci', () => {
  test('propor-grava-na-sessao-emendas e devolve {proposta_seq, req, task?, congeladas}', () => {
    const amb = ambReq();
    const r = amb.cli(proporArgs(amb, { task: 'T1' }));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.proposta_seq, 1);
    assert.equal(r.j.req, 'REQ-A-1');
    assert.equal(r.j.task, 'T1');
    assert.deepEqual([...r.j.congeladas].sort(), ['T1', 'T3'], 'T1 pelo REQ e T3 por depender dela; T2 fica de fora');
    const e = emendasDoDiario(amb);
    assert.equal(e.length, 1);
    assert.equal(e[0].tipo, 'emenda.proposta');
    assert.deepEqual(e[0].dados, { req: 'REQ-A-1', task: 'T1', diff: '--- a\n+++ b\n+ regra\n', fato: 'fato', alternativa: 'alt', evidencia: 'evid', causa: 'regra_negocio' });
    assert.equal(amb.eventos().filter((x) => x.sessao !== 'emendas').length, 0);
    const sem = ambReq();
    assert.equal(sem.cli(proporArgs(sem)).j.task, undefined, 'sem --task, sem `task` na saída');
    assert.ok(!('task' in emendasDoDiario(sem)[0].dados));
  });

  test('propor-igual-duas-vezes: cada chamada devolve o seq da própria linha, mesmo com dados idênticos', () => {
    const amb = ambReq();
    const args = proporArgs(amb);
    assert.equal(amb.cli(args).j.proposta_seq, 1);
    assert.equal(amb.cli(args).j.proposta_seq, 2);
    assert.deepEqual(emendasDoDiario(amb).map((e) => e.seq), [1, 2]);
  });

  test('propor-ignora-flag-sessao: --sessao x grava em events.emendas.jsonl (SP D1)', () => {
    const amb = ambReq();
    const r = amb.cli([...proporArgs(amb), '--sessao', 'x']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.entregas, 'events.emendas.jsonl')));
    assert.ok(!existsSync(join(amb.entregas, 'events.x.jsonl')));
    assert.equal(emendasDoDiario(amb)[0].sessao, 'emendas');
  });

  test('propor-devolve-seq-do-arquivo: com proposta concorrente injetada antes do append, o seq é o da linha gravada', async () => {
    const { proporEmenda } = await import('../scripts/loop.mjs');
    const amb = ambReq();
    const flags = { req: 'REQ-A-1', diff: diffEm(amb), fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio' };
    const injeta = () => escreve(amb, 'emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1', diff: 'outra' }), '2026-03-01T00:00:00.000Z');
    const r = proporEmenda(amb.dir, flags, { antes: injeta });
    const doArquivo = emendasDoDiario(amb).find((e) => e.dados.diff === '--- a\n+++ b\n+ regra\n');
    assert.equal(doArquivo.seq, 2, 'a injetada tomou o seq 1');
    assert.equal(r.proposta_seq, doArquivo.seq);
  });

  test('propor-recusa-de-uso: flag obrigatória ausente, desconhecida ou repetida ⇒ rc 2 sem gravar', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const falta of ['req', 'diff', 'fato', 'alternativa', 'evidencia', 'causa']) {
      const r = amb.cli(proporArgs(amb, { [falta]: undefined }));
      assert.equal(r.rc, 2, `${falta}: ${r.out}`);
      assert.equal(r.j.erro, 'uso');
    }
    assert.equal(amb.cli([...proporArgs(amb), '--nada', 'x']).rc, 2);
    assert.equal(amb.cli([...proporArgs(amb), '--fato', 'outra']).rc, 2);
    assert.equal(amb.cli(['emenda']).rc, 2);
    assert.equal(amb.cli(['emenda', 'propor', 'sobra', ...proporArgs(amb).slice(2)]).rc, 2);
    assert.equal(amb.cli(['emenda', 'revogar', '1']).rc, 2);
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('propor-argumento-invalido: req, task e causa fora da forma ⇒ rc 1 sem gravar; diff vazio também', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const extra of [{ req: 'req-a-1' }, { req: 'REQ-A-1x' }, { task: '../T1' }, { causa: 'preguica' }]) {
      const r = amb.cli(proporArgs(amb, extra));
      assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify(extra));
      assert.equal(r.rc, 1);
    }
    const vazio = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, ' \n\t\n', 'vazio.diff') }));
    assert.equal(vazio.j.erro, 'argumento_invalido');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('propor-diff-ausente-x-ilegivel: arquivo inexistente e diretório são erros distintos', () => {
    const amb = ambReq();
    const ausente = amb.cli(proporArgs(amb, {}, { diff: join(amb.tmpSistema, 'nao-existe.diff') }));
    assert.equal(ausente.j.erro, 'diff_ausente');
    const dir = join(amb.tmpSistema, 'um-dir');
    mkdirSync(dir);
    const ilegivel = amb.cli(proporArgs(amb, {}, { diff: dir }));
    assert.equal(ilegivel.j.erro, 'diff_ilegivel');
    assert.equal(ausente.rc, 1);
    assert.equal(emendasDoDiario(amb).length, 0);
  });

  test('propor-diff-longo-recusa-antes-do-diario: 4.001 caracteres ⇒ diff_longo, 0 bytes em todo events.*; 4.000 passa', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, 'x'.repeat(4001), 'longo.diff') }));
    assert.equal(r.j.erro, 'diff_longo');
    assert.equal(r.rc, 1);
    assert.deepEqual(bytesDoDiario(amb), antes, '0 bytes em todo events.*.jsonl');
    assert.ok(!amb.tipos().includes('diario.recusa'));
    const ok = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, 'x'.repeat(4000), 'limite.diff') }));
    assert.equal(ok.rc, 0, ok.out);
  });

  test('propor-texto-longo-nada-gravado: fato, alternativa ou evidencia > 2.000 e arquivos > 50 ⇒ proposta_longa, sem diario.recusa', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const campo of ['fato', 'alternativa', 'evidencia']) {
      const r = amb.cli(proporArgs(amb, { [campo]: 'y'.repeat(2001) }));
      assert.equal(r.j.erro, 'proposta_longa', campo);
    }
    const muitos = Array.from({ length: 51 }, (_, i) => `src/f${i}.txt`).join(',');
    const r = amb.cli(proporArgs(amb, { task: 'T1', arquivos: muitos }));
    assert.equal(r.j.erro, 'proposta_longa');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.ok(!amb.tipos().includes('diario.recusa'));
    const limite = amb.cli(proporArgs(amb, { fato: 'y'.repeat(2000) }));
    assert.equal(limite.rc, 0, limite.out);
  });

  test('propor-segredo-nada-gravado: canário em qualquer campo de texto ⇒ segredo_na_proposta, 0 bytes, e a mensagem não ecoa o segredo', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    const segredo = `ghp_${'a1'.repeat(18)}`;
    const alvos = [{ fato: segredo }, { alternativa: segredo }, { evidencia: segredo }];
    for (const extra of alvos) {
      const r = amb.cli(proporArgs(amb, extra));
      assert.equal(r.j.erro, 'segredo_na_proposta', JSON.stringify(Object.keys(extra)));
      assert.ok(!r.out.includes(segredo), 'o segredo não é ecoado');
    }
    const noDiff = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, `+ token ${segredo}\n`, 'seg.diff') }));
    assert.equal(noDiff.j.erro, 'segredo_na_proposta');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.ok(!amb.tipos().includes('diario.recusa'));
  });

  test('propor-arquivos-item-vazio-recusa e propor-arquivos-sem-task: o vazio não some em silêncio', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const lista of ['a,,b', 'a,', ',a']) {
      const r = amb.cli(proporArgs(amb, { task: 'T1', arquivos: lista }));
      assert.equal(r.j.erro, 'caminho_invalido', lista);
      assert.match(r.j.mensagem, /caminho inv.lido/);
    }
    const semTask = amb.cli(proporArgs(amb, { arquivos: 'src/x.txt' }));
    assert.equal(semTask.j.ok, false);
    assert.match(semTask.j.mensagem, /arquivos exigem task/);
    const fora = amb.cli(proporArgs(amb, { task: 'T1', arquivos: '../fora.txt' }));
    assert.match(fora.j.mensagem, /caminho inv.lido: \.\.\/fora\.txt/);
    assert.deepEqual(bytesDoDiario(amb), antes);
    const ok = amb.cli(proporArgs(amb, { task: 'T1', arquivos: './src/x.txt,src/y.txt' }));
    assert.equal(ok.rc, 0, ok.out);
    assert.deepEqual(emendasDoDiario(amb)[0].dados.arquivos, ['./src/x.txt', 'src/y.txt']);
  });

  test('propor-colide-sem-dep-recusa: arquivo de outra task sem dependência ⇒ recusa com a task e nada gravado', () => {
    const amb = ambReq();
    const r = amb.cli(proporArgs(amb, { task: 'T1', arquivos: 'src/t2.txt' }));
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.match(r.j.mensagem, /arquivo src\/t2\.txt colide com T2 sem dependência/);
    assert.equal(emendasDoDiario(amb).length, 0);
    const dep = amb.cli(proporArgs(amb, { task: 'T3', req: 'REQ-C-1', arquivos: 'src/t1.txt' }));
    assert.equal(dep.rc, 0, 'T3 depende de T1: o arquivo dela não colide');
  });

  test('propor-req-desconhecido-recusa: sem --task, REQ fora de toda task e da spec; REQ na spec ou em task vale', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(proporArgs(amb, { req: 'REQ-ZZ-9' }));
    assert.equal(r.j.erro, 'req_desconhecido');
    assert.equal(r.rc, 1);
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.cli(proporArgs(amb, { req: 'REQ-A-1' })).rc, 0, 'REQ de task');
    writeFileSync(join(amb.dir, 'docs', 'spec.md'), '# Spec\n\n**REQ-A-1** a.\n\n**REQ-ZZ-9** só na spec.\n');
    assert.equal(amb.cli(proporArgs(amb, { req: 'REQ-ZZ-9' })).rc, 0, 'REQ só na spec');
    const semSpec = ambiente({ plano: { ...PLANO_REQ, spec: undefined } });
    assert.equal(semSpec.cli(proporArgs(semSpec, { req: 'REQ-ZZ-9' })).j.erro, 'req_desconhecido', 'sem spec não há como provar o REQ');
  });

  test('propor-plano-e-diario-ruins: plano ausente, diário ilegível e diário fora da tabela ⇒ recusa sem gravar', () => {
    const semPlano = ambiente({ plano: null });
    assert.equal(semPlano.cli(proporArgs(semPlano)).j.erro, 'plano_ausente');
    const amb = ambReq();
    writeFileSync(join(amb.entregas, 'events.loop.jsonl'), 'lixo\n');
    assert.equal(amb.cli(proporArgs(amb)).j.erro, 'diario_ilegivel');
    const torto = ambReq();
    torto.semear([['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }]]);
    assert.equal(torto.cli(proporArgs(torto)).j.erro, 'diario_invalido');
    assert.equal(emendasDoDiario(torto).length, 0);
  });

  const comJulga = (amb) => comOrigin(amb, { sombra: { julga_emendas: true } });
  const propor = (amb, extra) => assert.equal(amb.cli(proporArgs(amb, extra)).rc, 0);

  test('julgar-sombra-sem-flag-recusa: sem origin e com origin sem a chave, nada gravado', () => {
    const amb = ambReq();
    propor(amb);
    const antes = bytesDoDiario(amb);
    for (const preparar of [() => {}, () => comOrigin(amb, { sombra: { teto: 9 } }), () => comOrigin(amb, { sombra: { julga_emendas: 'true' } })]) {
      preparar();
      const r = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'julga_emendas_desligado');
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
  });

  test('julgar-sombra-flag-so-local-recusa: julga_emendas true só no config local não vale', () => {
    const amb = ambReq({ config: { ...CONFIG_PADRAO, sombra: { julga_emendas: true } } });
    propor(amb);
    comOrigin(amb, { entrega: {} });
    const antes = bytesDoDiario(amb);
    const r = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
    assert.equal(r.j.erro, 'julga_emendas_desligado');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('julgar-origin-invalida-recusa: JSON ilegível em origin ⇒ recusa citando o motivo', () => {
    const amb = ambReq();
    propor(amb);
    comOrigin(amb, '{quebrado');
    const r = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
    assert.equal(r.j.erro, 'julga_emendas_desligado');
    assert.match(r.j.mensagem, /JSON ileg.vel/);
  });

  test('julgar-sombra-com-flag-origin: grava spec.emendada origem sombra, relida; rejeitar grava emenda.rejeitada; a 2ª vez ⇒ proposta já julgada', () => {
    const amb = ambReq();
    comJulga(amb);
    propor(amb);
    propor(amb, { req: 'REQ-B-1' });
    const a = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.deepEqual([a.j.seq, a.j.req, a.j.tipo, a.j.origem], [1, 'REQ-A-1', 'spec.emendada', 'sombra']);
    const julg = amb.eventos().filter((e) => e.tipo === 'spec.emendada');
    assert.deepEqual(julg.map((e) => [e.sessao, e.dados]), [['loop', { proposta_seq: 1, origem: 'sombra' }]]);
    const rj = amb.cli(['emenda', 'julgar', '2', 'rejeitar', '--sessao', 'sombra-j']);
    assert.equal(rj.rc, 0, rj.out);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'emenda.rejeitada').map((e) => [e.sessao, e.dados]), [['sombra-j', { proposta_seq: 2, origem: 'sombra' }]]);
    const dois = amb.cli(['emenda', 'julgar', '1', 'rejeitar']);
    assert.equal(dois.j.erro, 'ja_julgada');
    assert.match(dois.j.mensagem, /proposta já julgada/);
    assert.equal(amb.eventos().filter((e) => e.tipo === 'emenda.rejeitada').length, 1);
    const ne = amb.cli(['emenda', 'julgar', '9', 'aprovar']);
    assert.equal(ne.j.erro, 'proposta_inexistente');
    assert.equal(amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1').emendas[0].proposta_seq, 1, 'costura: o julgamento descongela e chega ao item');
  });

  test('julgar-seq-forma-invalida: 0, 03, -1, 3.0 e decisão fora do enum ⇒ argumento_invalido sem gravar', () => {
    const amb = ambReq();
    comJulga(amb);
    propor(amb);
    const antes = bytesDoDiario(amb);
    for (const args of [['0', 'aprovar'], ['03', 'aprovar'], ['-1', 'aprovar'], ['3.0', 'aprovar'], ['1234567890', 'aprovar'], ['1', 'Aprovar'], ['1', 'ok']]) {
      const r = amb.cli(['emenda', 'julgar', ...args]);
      assert.equal(r.j?.erro, 'argumento_invalido', args.join(' '));
    }
    assert.equal(amb.cli(['emenda', 'julgar', '1']).rc, 2);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar', '--origem', 'dono']).rc, 2, 'nenhum argumento produz origem dono');
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar', '--req', 'REQ-A-1']).rc, 2, 'flags de propor não valem em julgar');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('desvio-grava: task, req, evidencia, arquivos normalizados e causa no diário (sessão loop, ou --sessao)', () => {
    const amb = ambReq();
    const r = amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'a API não pagina', '--arquivos', './src/t1.txt,src/x.txt', '--causa', 'tecnica']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'desvio');
    assert.equal(e.sessao, 'loop');
    assert.deepEqual(e.dados, { task: 'T1', req: 'REQ-A-1', evidencia: 'a API não pagina', arquivos: ['src/t1.txt', 'src/x.txt'], causa: 'tecnica' });
    const s = amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'x', '--arquivos', '', '--causa', 'regra_negocio', '--sessao', 'outra']);
    assert.equal(s.rc, 0, s.out);
    assert.deepEqual(amb.eventos().at(-1).dados.arquivos, [], 'lista vazia explícita vale');
    assert.equal(amb.eventos().at(-1).sessao, 'outra');
  });

  test('desvio-sem-evidencia-recusa: flag ausente é uso (rc 2); evidência vazia, causa e arquivos inválidos são recusa sem gravar', () => {
    const amb = ambReq();
    const base = ['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'ev', '--arquivos', 'src/t1.txt', '--causa', 'tecnica'];
    const sem = (flag) => { const i = base.indexOf(`--${flag}`); return [...base.slice(0, i), ...base.slice(i + 2)]; };
    for (const f of ['req', 'evidencia', 'arquivos', 'causa']) assert.equal(amb.cli(sem(f)).rc, 2, f);
    const troca = (flag, v) => { const i = base.indexOf(`--${flag}`); return [...base.slice(0, i + 1), v, ...base.slice(i + 2)]; };
    assert.equal(amb.cli(troca('evidencia', '  ')).j.erro, 'argumento_invalido');
    assert.equal(amb.cli(troca('causa', 'preguica')).j.erro, 'argumento_invalido');
    assert.equal(amb.cli(troca('arquivos', '/abs/x')).j.erro, 'caminho_invalido');
    assert.equal(amb.cli(troca('arquivos', 'a,,b')).j.erro, 'caminho_invalido');
    assert.equal(amb.cli(troca('evidencia', 'y'.repeat(2001))).j.erro, 'proposta_longa');
    assert.equal(amb.cli(troca('evidencia', `ghp_${'a1'.repeat(18)}`)).j.erro, 'segredo_na_proposta');
    assert.equal(amb.eventos().length, 0);
  });

  test('desvio-task-fora-do-plano e desvio-req-fora-da-task: task sem o REQ (ou sem `reqs`) recusa', () => {
    const amb = ambReq();
    const base = (t, req) => ['desvio', t, '--req', req, '--evidencia', 'ev', '--arquivos', '', '--causa', 'tecnica'];
    assert.equal(amb.cli(base('T9', 'REQ-A-1')).j.erro, 'task_fora_do_plano');
    assert.equal(amb.cli(base('T1', 'REQ-B-1')).j.erro, 'req_fora_da_task');
    const sem = ambiente();
    assert.equal(sem.cli(base('T1', 'REQ-A-1')).j.erro, 'req_fora_da_task', 'task sem `reqs`');
    assert.equal(amb.eventos().length + sem.eventos().length, 0);
  });

  test('descoberta-grava e descoberta-recusa: evidencia e causa; canário e limite como em propor', () => {
    const amb = ambReq();
    const r = amb.cli(['descoberta', '--evidencia', 'tabela sem índice', '--causa', 'tecnica']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.eventos().at(-1), { ...amb.eventos().at(-1), tipo: 'descoberta', dados: { evidencia: 'tabela sem índice', causa: 'tecnica' } });
    assert.equal(amb.cli(['descoberta', '--evidencia', 'x']).rc, 2);
    assert.equal(amb.cli(['descoberta', '--evidencia', 'x', '--causa', 'nada']).j.erro, 'argumento_invalido');
    assert.equal(amb.cli(['descoberta', '--evidencia', 'z'.repeat(2001), '--causa', 'tecnica']).j.erro, 'proposta_longa');
    assert.equal(amb.cli(['descoberta', '--evidencia', `ghp_${'a1'.repeat(18)}`, '--causa', 'tecnica']).j.erro, 'segredo_na_proposta');
    assert.equal(amb.eventos().length, 1);
  });

  test('ci-alvo-homolog: --alvo homolog grava {verde, alvo}; sem a flag, só {verde}', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['ci', 'verde', '--alvo', 'homolog']).rc, 0);
    assert.deepEqual(amb.eventos().at(-1).dados, { verde: true, alvo: 'homolog' });
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    assert.deepEqual(amb.eventos().at(-1).dados, { verde: false });
  });

  test('ci-alvo-fora-recusa: prod, Homolog e vazio ⇒ argumento_invalido sem gravar', () => {
    const amb = ambiente();
    for (const alvo of ['prod', 'Homolog', 'homolog ', '']) {
      const r = amb.cli(['ci', 'vermelho', '--alvo', alvo]);
      assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify(alvo));
      assert.equal(r.rc, 1);
    }
    assert.equal(amb.eventos().length, 0);
  });
});

describe('GM-15 T11: a 3ª proposta é da Sombra (REQ-EME-3 B)', () => {
  const comJulga = (amb) => comOrigin(amb, { sombra: { julga_emendas: true } });
  /** 2 propostas do orquestrador na mesma âncora, as duas rejeitadas pela Sombra. */
  function comDuasRejeitadas(extra = {}) {
    const amb = ambReq();
    comJulga(amb);
    for (const seq of ['1', '2']) {
      assert.equal(amb.cli(proporArgs(amb, extra)).rc, 0);
      assert.equal(amb.cli(['emenda', 'julgar', seq, 'rejeitar']).rc, 0);
    }
    return amb;
  }

  test('t11-terceira-proposta-do-orquestrador-recusa: nada gravado; outra âncora segue livre', () => {
    const amb = comDuasRejeitadas();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(proporArgs(amb));
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'proposta_recusada');
    assert.match(r.j.mensagem, /terceira proposta do orquestrador/);
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.cli(proporArgs(amb, { req: 'REQ-B-1' })).rc, 0, 'outro REQ é outra âncora');
  });

  test('segunda-rejeicao-sombra-redige: --origem sombra grava a proposta com origem sombra e o texto que a Sombra redigiu', () => {
    const amb = comDuasRejeitadas();
    const r = amb.cli([...proporArgs(amb, { fato: 'fato da Sombra', alternativa: 'alt da Sombra' }), '--origem', 'sombra']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.proposta_seq, 3);
    const e = emendasDoDiario(amb).filter((x) => x.tipo === 'emenda.proposta');
    assert.equal(e.length, 3);
    assert.deepEqual([e[2].dados.origem, e[2].dados.fato, e[2].dados.alternativa], ['sombra', 'fato da Sombra', 'alt da Sombra']);
    assert.equal(e[0].dados.origem, undefined, 'a do orquestrador não leva origem');
  });

  test('t11-origem-sombra-antes-da-2a-rejeicao-recusa', () => {
    const amb = ambReq();
    comJulga(amb);
    assert.equal(amb.cli(proporArgs(amb)).rc, 0);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'rejeitar']).rc, 0);
    const antes = bytesDoDiario(amb);
    const r = amb.cli([...proporArgs(amb), '--origem', 'sombra']);
    assert.equal(r.j.erro, 'proposta_recusada');
    assert.match(r.j.mensagem, /2ª rejeição/);
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('t11-origem-sombra-exige-julga-emendas-em-origin', () => {
    const amb = comDuasRejeitadas();
    comOrigin(amb, { sombra: { julga_emendas: false } });
    const antes = bytesDoDiario(amb);
    const r = amb.cli([...proporArgs(amb), '--origem', 'sombra']);
    assert.equal(r.j.erro, 'julga_emendas_desligado');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('t11-origem-dono-ou-outra-recusa-rc2: nenhum argumento produz dono', () => {
    const amb = comDuasRejeitadas();
    const antes = bytesDoDiario(amb);
    for (const v of ['dono', 'retomada', '']) {
      const r = amb.cli([...proporArgs(amb), '--origem', v]);
      assert.equal(r.rc, 2, `${v}: ${r.out}`);
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
  });
});

describe('E3 T10: integrar com o escopo das emendas', () => {
  const PLANO_INT = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] }] };

  test('integrar-escopo-com-emenda-aprovada-passa-gate: o gate real aceita o arquivo da emenda e reprova sem ela', () => {
    const semEmenda = ambiente({ plano: PLANO_INT });
    semEmenda.aprovar('T1', 'src/t1.txt', [['src/extra.txt', 'extra\n']]);
    const rep = semEmenda.cli(['integrar', 'T1']);
    assert.equal(rep.j.erro, 'gate_reprovado', rep.out);
    assert.deepEqual(rep.j.merge, false);

    const amb = ambiente({ plano: PLANO_INT });
    comOrigin(amb, { sombra: { julga_emendas: true } });
    amb.aprovar('T1', 'src/t1.txt', [['src/extra.txt', 'extra\n']]);
    const p = amb.cli(proporArgs(amb, { task: 'T1', arquivos: 'src/extra.txt' }));
    assert.equal(p.rc, 0, p.out);
    const aberta = amb.cli(['integrar', 'T1']);
    assert.equal(aberta.j.erro, 'nao_integravel', 'proposta aberta congela a integração');
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar']).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.ok(existsSync(join(amb.dir, 'src/extra.txt')));
  });

  test('integrar-escopo-da-emenda-rejeitada-ou-de-outra-task-nao-vale', () => {
    const amb = ambiente({ plano: { entrega: 'GM-10', tasks: [...PLANO_INT.tasks, { id: 'T2', deps: [], arquivos: ['src/t2.txt'], reqs: ['REQ-B-1'] }] } });
    comOrigin(amb, { sombra: { julga_emendas: true } });
    amb.aprovar('T1', 'src/t1.txt', [['src/extra.txt', 'extra\n']]);
    assert.equal(amb.cli(proporArgs(amb, { task: 'T2', req: 'REQ-B-1', arquivos: 'src/extra.txt' })).rc, 0);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar']).rc, 0);
    assert.equal(amb.cli(['integrar', 'T1']).j.erro, 'gate_reprovado', 'a emenda de T2 não alarga o escopo de T1');
  });

  test('integrar-sem-emenda-files-igual-e2: `./arquivo` e diretório do plano seguem valendo como na E2', () => {
    const plano = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['./src/t1.txt', 'src/dir'] }] };
    const amb = ambiente({ plano });
    amb.aprovar('T1', 'src/t1.txt', [['src/dir/fundo/a.txt', 'a\n']]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const fora = ambiente({ plano });
    fora.aprovar('T1', 'src/t1.txt', [['src/dirfora.txt', 'a\n']]);
    assert.equal(fora.cli(['integrar', 'T1']).j.erro, 'gate_reprovado', 'diretório não aprova arquivo de nome parecido');
  });
});

// ═══════════════════════════════════════════════════════════════ GM-11 T16: integrar relata desvios no verde
describe('E3 T16: integrar repassa desvio e aviso do gate no verde', () => {
  const FORMA = /^(desvio|aviso): /;
  const desviar = (amb, extra = []) => amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'e', '--arquivos', 'a.ts', '--causa', 'tecnica', ...extra]);

  test('integrar-verde-relata-desvio: desvio gravado pelo CLI real, gate real verde, integrar devolve a linha', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    const d = desviar(amb);
    assert.equal(d.rc, 0, d.out + d.err);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.equal(r.j.fechada, true);
    assert.deepEqual(r.j.relato, ['desvio: REQ-A-1 a.ts (tecnica)']);
    for (const l of r.j.relato) assert.match(l, FORMA);
  });

  test('integrar-verde-sem-desvio-relato-vazio: o campo existe e vale []; nada de ok/veredito vaza', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(Array.isArray(r.j.relato), 'relato sempre presente');
    assert.equal(r.j.relato.length, 0);
    assert.doesNotMatch(r.out, /ok {5}|GATE VERDE/, 'linhas ok e veredito não vazam na saída');
  });

  test('integrar-verde-so-linhas-desvio-e-aviso: desvio de outra task não entra; a ordem original vale', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    assert.equal(desviar(amb).rc, 0);
    assert.equal(amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'e2', '--arquivos', 'b.ts', '--causa', 'regra_negocio']).rc, 0);
    assert.equal(amb.cli(['desvio', 'T2', '--req', 'REQ-B-1', '--evidencia', 'e', '--arquivos', 'z.ts', '--causa', 'tecnica']).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, ['desvio: REQ-A-1 a.ts (tecnica)', 'desvio: REQ-A-1 b.ts (regra_negocio)']);
  });

  test('integrar-verde-repassa-aviso-de-diario-nao-lido: lacuna de seq que o integrar tolera, o gate avisa', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    writeFileSync(join(amb.entregas, 'events.outra.jsonl'), JSON.stringify({ seq: 7, hash_anterior: null, ts: '2026-01-01T00:00:00.000Z', autor: 't@t', sessao: 'outra', agente: 'x', tipo: 'nota', dados: {} }) + '\n');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.relato.length, 1);
    assert.match(r.j.relato[0], /^aviso: desvios não lidos \(lacuna de seq na linha 1 de events\.outra\.jsonl\)$/);
  });

  test('integrar-reprovado-mantem-relato-completo-e-rc: ramo gate_reprovado inalterado', () => {
    const amb = ambReq({ config: { gates: { suites: ['test ! -f src/t1.txt'] } } });
    amb.aprovar('T1');
    assert.equal(desviar(amb).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.merge, false);
    assert.ok(r.j.relato.some((l) => /^FALHA /.test(l)), 'FALHA continua no relato');
    assert.ok(r.j.relato.some((l) => /^ok {5}/.test(l)), 'o relato completo (com ok) segue na reprovação');
    assert.ok(r.j.relato.includes('desvio: REQ-A-1 a.ts (tecnica)'));
  });
});

describe('E4 T7: dados do painel no loop (iniciar, integrar, proxima)', () => {
  const comConfig = (orq) => ambiente({ config: { ...CONFIG_PADRAO, orquestracao: orq } });
  const iniciada = (amb) => amb.eventos().filter((e) => e.tipo === 'task.iniciada').at(-1);
  const integradaDe = (amb) => amb.eventos().find((e) => e.tipo === 'task.integrada');

  test('iniciar-forma-posicional-mantida: `--papel` do plano antigo é uso rc 2, nada gravado', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', '--papel', 'implementador']);
    assert.equal(r.rc, 2);
    assert.equal(r.j.erro, 'uso');
    assert.equal(amb.eventos().length, 0);
  });

  test('iniciar-grava-modelo-padrao: sem `orquestracao`, o modelo é o padrão do papel e a saída traz o mesmo valor', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet');
    assert.equal(r.j.evento.modelo, 'sonnet');
    assert.equal(r.j.aviso, undefined, 'config válida sem `orquestracao` não avisa');
    amb.cli(['concluir', 'T1']);
    const v = amb.cli(['iniciar', 'T1', 'revisor']);
    assert.equal(v.rc, 0, v.out + v.err);
    assert.equal(iniciada(amb).dados.modelo, 'opus');
    assert.equal(v.j.evento.modelo, 'opus');
  });

  test('iniciar-grava-modelo-do-perfil: task.iniciada e a saída trazem a família do perfil (costura config real -> evento)', () => {
    const amb = comConfig({ perfil: 'economia' });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet');
    amb.cli(['concluir', 'T1']);
    const v = amb.cli(['iniciar', 'T1', 'revisor']);
    assert.equal(v.rc, 0, v.out + v.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet', 'economia: revisor de task em sonnet');
    assert.equal(v.j.evento.modelo, 'sonnet');
  });

  test('iniciar-correcao-usa-chave-implementador e iniciar-revisor-usa-chave-revisor: a família vem da chave do papel', () => {
    const amb = comConfig({ modelos: { implementador: 'opus', revisor: 'haiku' } });
    amb.semear([...IMPL_E('T1'), ['task.iniciada', { task: 'T1', papel: 'revisor' }], REPROVA_E('T1')]);
    amb.cli(['abrir', 'T1']);
    const c = amb.cli(['iniciar', 'T1', 'correcao']);
    assert.equal(c.rc, 0, c.out + c.err);
    assert.equal(iniciada(amb).dados.modelo, 'opus', 'correcao usa a chave implementador');
    assert.equal(c.j.evento.modelo, 'opus');
    amb.semear([['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }]]);
    const v = amb.cli(['iniciar', 'T1', 'revisor']);
    assert.equal(v.rc, 0, v.out + v.err);
    assert.equal(iniciada(amb).dados.modelo, 'haiku', 'revisor usa a chave revisor, nunca a do implementador');
    assert.equal(v.j.evento.modelo, 'haiku');
  });

  test('iniciar-config-objeto-e-id-completo: `{modelo}` e id completo viram a família', () => {
    const amb = comConfig({ modelos: { implementador: { modelo: 'claude-opus-5-5', esforco: 'low' } } });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'opus');
    assert.equal(r.j.aviso, undefined);
  });

  test('iniciar-chave-invalida-padrao-com-aviso: o que o item levou ao Agent é o padrão', () => {
    for (const valor of [42, 'gpt', {}]) {
      const amb = comConfig({ modelos: { implementador: valor } });
      amb.cli(['abrir', 'T1']);
      const r = amb.cli(['iniciar', 'T1', 'implementador']);
      assert.equal(r.rc, 0, r.out + r.err);
      assert.equal(iniciada(amb).dados.modelo, 'sonnet', JSON.stringify(valor));
      assert.equal(r.j.aviso.length, 1);
      assert.match(r.j.aviso[0], /modelo do papel implementador/);
    }
  });

  test('iniciar-config-corrompida-sem-modelo-com-aviso: ausente e corrompido são casos distintos, cada um com o seu lado', () => {
    // corrompida (JSON quebrado e raiz que não é objeto): evento sem a chave `modelo`, aviso, rc 0
    for (const texto of ['{', '[1]', 'null']) {
      const amb = ambiente();
      amb.cli(['abrir', 'T1']);
      writeFileSync(join(amb.dir, 'harness.config.json'), texto);
      const r = amb.cli(['iniciar', 'T1', 'implementador']);
      assert.equal(r.rc, 0, `${texto}: ${r.out}`);
      assert.equal(Object.hasOwn(iniciada(amb).dados, 'modelo'), false, `${texto}: nenhum modelo é inventado`);
      assert.deepEqual(iniciada(amb).dados, { task: 'T1', papel: 'implementador' });
      assert.equal(Object.hasOwn(r.j.evento, 'modelo'), false);
      assert.equal(r.j.aviso.length, 1);
      assert.match(r.j.aviso[0], /^config_invalida: .*; task\.iniciada sem modelo$/);
    }
    // ausente: o padrão, com o aviso de ausência
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    rmSync(join(amb.dir, 'harness.config.json'));
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet');
    assert.deepEqual(r.j.aviso, ['harness.config.json ausente']);
  });

  test('iniciar-recusa-antes-da-config: com a config corrompida o motivo da recusa não muda', () => {
    const corrompe = (amb) => writeFileSync(join(amb.dir, 'harness.config.json'), '{');
    const a = ambiente();
    corrompe(a);
    assert.equal(a.cli(['iniciar', 'T9', 'implementador']).j.erro, 'task_fora_do_plano');
    const b = ambiente();
    corrompe(b);
    assert.equal(b.cli(['iniciar', 'T1', 'implementador']).j.erro, 'worktree_ausente');
    const c = ambiente();
    c.cli(['abrir', 'T1']);
    assert.equal(c.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    corrompe(c);
    const t = c.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(t.j.erro, 'transicao_invalida');
    assert.equal(c.eventos().length, 1, 'a recusa não grava nada');
  });

  const GATE_MUT = [
    { nome: 'lenta', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'sleep 0.4; test "$(cat src/t1.txt)" = x' },
    { nome: 'rapida', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'if grep -q x src/t1.txt; then sleep 0.4; fi; grep -q x src/t1.txt' }, // sem mutação leva 0,4 s; mutada morre na hora (limiar relativo ao MESMO comando)
  ];
  const ambMut = (lista) => {
    const amb = ambiente({
      config: { gates: { suites: ["echo '# pass 1'"] } },
      plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], ...(lista === undefined ? {} : { mutacoes: 'mut.json' }) }]),
    });
    if (lista !== undefined) writeFileSync(join(amb.dir, 'mut.json'), JSON.stringify(lista));
    amb.aprovar('T1');
    return amb;
  };

  test('integrar-mutacoes-na-saida: gate real, uma morta devagar e uma em tempo ~zero (ALERTA, não conta) ⇒ {2,1} no diário e na saída', () => {
    const amb = ambMut(GATE_MUT);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.mutacoes, { total: 2, mortas: 1 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 2, mortas: 1 });
    assert.equal(integradaDe(amb).dados.sha, amb.topo());
  });

  test('integrar-mutacoes-todas-mortas: total e mortas lidos (2 e 2)', () => {
    const amb = ambMut([GATE_MUT[0], { ...GATE_MUT[0], nome: 'lenta2' }]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.mutacoes, { total: 2, mortas: 2 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 2, mortas: 2 });
  });

  test('integrar-sem-mutacoes-zero: sem `mutacoes` no plano o gate mediu zero, valor presente e não ausente', () => {
    const amb = ambMut(undefined);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.mutacoes, { total: 0, mortas: 0 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 0, mortas: 0 });
  });

  test('integrar-mutacao-viva-reprova-sem-evento: nenhum task.integrada, base inalterada', () => {
    const amb = ambMut([{ nome: 'viva', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'true' }]);
    const base = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(integradaDe(amb), undefined);
    assert.equal(amb.topo(), base);
  });

  test('integrar-forma-mutacoes-antes-do-merge: mortas > total ⇒ gate_erro, sem merge nem evento, base inalterada', async () => {
    const amb = ambMut(undefined);
    const base = amb.topo();
    const avaliarTorto = async () => ({ reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 3, semContagem: 0 });
    const r = await integrarComGate(amb.dir, 'T1', { avaliar: avaliarTorto });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'gate_erro');
    assert.match(r.mensagem, /mutacoes.*mortas ≤ total/);
    assert.equal(r.merge, false);
    assert.equal(r.evento, false);
    assert.equal(amb.topo(), base, 'o merge não aconteceu');
    assert.equal(integradaDe(amb), undefined);
    assert.ok(existsSync(amb.wt('T1')), 'a worktree continua');
  });

  test('integrar-com-avaliador-injetado-bom: o mesmo caminho com mortas == total grava e mescla (o teste acima não passa por outro motivo)', async () => {
    const amb = ambMut(undefined);
    const ok = async () => ({ reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 0, semContagem: 0 });
    const r = await integrarComGate(amb.dir, 'T1', { avaliar: ok });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.mutacoes, { total: 0, mortas: 0 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 0, mortas: 0 });
  });

  test('proxima-descricao-casa-com-casarAgente (P9): os três papéis, pelo CLI real e o `dist/painel-equipe.js`', () => {
    const amb = ambiente();
    const plano = JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8'));
    const impl = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.ok(impl.length >= 1);
    for (const i of impl) {
      assert.equal(i.descricao, `${i.task} implementador`);
      assert.deepEqual(casarAgente(i.descricao, plano), { task: i.task, papel: 'implementador' });
    }
    const rev = ambiente();
    rev.semear(IMPL_E('T1'));
    const ri = rev.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'revisor');
    assert.equal(ri.descricao, 'T1 revisor');
    assert.deepEqual(casarAgente(ri.descricao, plano), { task: 'T1', papel: 'revisor' });
    const cor = ambiente();
    cor.semear([...IMPL_E('T1'), REPROVA_E('T1')]);
    const ci = cor.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'correcao');
    assert.equal(ci.descricao, 'T1 correcao');
    assert.deepEqual(casarAgente(ci.descricao, plano), { task: 'T1', papel: 'correcao' });
  });

  test('subcomandos-e5-sem-stub: pousar (T12, REQ-POU-3) já não responde nao_implementado; grava só sessao.pouso e não cria registro.md (registro é da T11)', () => {
    const amb = ambiente();
    const antes = amb.tipos();
    const r = amb.cli(['pousar']);
    assert.notEqual(r.j?.erro, 'nao_implementado', `${r.out}${r.err}`);
    assert.equal(r.rc, 0, `${r.out}${r.err}`);
    assert.deepEqual(amb.tipos(), [...antes, 'sessao.pouso']);
    assert.equal(existsSync(join(amb.entregas, 'registro.md')), false);
  });
});

// ─────────────────────────────────────────────────────────────── E5a T8: aprendizados no despacho (REQ-APR-3)

describe('E5a T8: proxima leva os aprendizados D do papel no item despachar', () => {
  const EV1 = ['descoberta', { evidencia: 'fato medido', causa: 'tecnica' }];
  const D = (regra, entra_em, extra = {}) => ['aprendizado', { tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra, entra_em, ...extra }];
  const M = (regra, entra_em) => ['aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: {}, regra, entra_em }];
  const itemDe = (r, task, papel) => r.j.acao.itens.find((i) => i.task === task && i.papel === papel);

  test('proxima-item-revisor-sem-implementador: o revisor leva só `brief:revisor`; o implementador, só `brief:implementador`', () => {
    const amb = ambiente();
    amb.semear([EV1, D('so-implementador', ['brief:implementador']), D('so-revisor', ['brief:revisor']), D('os-dois', ['brief:implementador', 'brief:revisor'])]);
    const impl = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(impl.rc, 0, impl.out + impl.err);
    assert.deepEqual(itemDe(impl, 'T1', 'implementador').aprendizados, ['os-dois', 'so-implementador'], 'mais recente primeiro; nada de brief:revisor');
    assert.deepEqual(itemDe(impl, 'T3', 'implementador').aprendizados, ['os-dois', 'so-implementador']);
    const rev = ambiente();
    rev.semear([...IMPL_E('T1'), ['descoberta', { evidencia: 'e', causa: 'tecnica' }], D('so-implementador', ['brief:implementador'], { evidencia: { eventos: [{ sessao: 'loop', seq: 3 }] } }),
      D('so-revisor', ['brief:revisor'], { evidencia: { eventos: [{ sessao: 'loop', seq: 3 }] } })]);
    const r = rev.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(itemDe(r, 'T1', 'revisor').aprendizados, ['so-revisor']);
  });

  test('item-correcao-so-brief-correcao: `brief:revisor` e `brief:implementador` não entram na correção; `brief:correcao` entra', () => {
    const amb = ambiente();
    amb.semear([...IMPL_E('T1'), REPROVA_E('T1'), ['descoberta', { evidencia: 'e', causa: 'tecnica' }],
      D('do-revisor', ['brief:revisor'], { evidencia: { eventos: [{ sessao: 'loop', seq: 4 }] } }),
      D('do-implementador', ['brief:implementador'], { evidencia: { eventos: [{ sessao: 'loop', seq: 4 }] } }),
      D('da-correcao', ['brief:correcao'], { evidencia: { eventos: [{ sessao: 'loop', seq: 4 }] } })]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    const cor = itemDe(r, 'T1', 'correcao');
    assert.ok(cor, 'há item de correção');
    assert.deepEqual(cor.aprendizados, ['da-correcao']);
  });

  test('proxima-m-nunca-no-item: M com brief:implementador não aparece (M-APR3a)', () => {
    const amb = ambiente();
    amb.semear([EV1, M('so-hipotese', ['brief:implementador', 'instantaneo']), D('medida', ['brief:implementador'])]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['medida']);
    assert.equal(JSON.stringify(r.j).includes('so-hipotese'), false, 'M não vaza em nenhum campo');
  });

  test('proxima-aprendizados-de-outra-entrega-entram: o D da GM-3 chega ao brief da GM-10 (a árvore inteira)', () => {
    const amb = ambiente();
    const d3 = join(amb.dir, '.harness', 'entregas', 'GM-3');
    mkdirSync(d3, { recursive: true });
    for (const [tipo, dados] of [EV1, D('regra da GM-3', ['brief:implementador'])]) {
      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 5)).toISOString();
      assert.ok(diario.append(d3, 'loop', { ts, autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados }).ok);
    }
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['regra da GM-3']);
    assert.equal(r.j.aviso, undefined);
  });

  test('proxima-outra-entrega-corrompida-aviso: rc 0, os D das legíveis seguem e o aviso cita a pasta (nunca "0" calado nem rc 1)', () => {
    const amb = ambiente();
    amb.semear([EV1, D('da-gm-10', ['brief:implementador'])]);
    const torta = join(amb.dir, '.harness', 'entregas', 'GM-1');
    mkdirSync(torta, { recursive: true });
    writeFileSync(join(torta, 'events.loop.jsonl'), 'isto nao e json\n');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['da-gm-10']);
    assert.equal(r.j.aviso.filter((a) => /GM-1 ilegível/.test(a)).length, 1, 'um aviso só, não um por item');
  });

  test('proxima-diario-da-entrega-ilegivel-para-antes: o item nunca sai com aprendizados vazios por causa do diário torto', () => {
    const amb = ambiente();
    writeFileSync(join(amb.entregas, 'events.loop.jsonl'), 'isto nao e json\n');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel', r.out);
  });

  test('proxima-sem-aprendizado-no-diario-ausente: árvore sem a pasta das outras entregas ⇒ `aprendizados: []` e nenhum aviso', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima', '--vivos', '0']);
    for (const i of r.j.acao.itens) assert.deepEqual(i.aprendizados, []);
    assert.equal(r.j.aviso, undefined);
  });

  test('aprendizado-cli-chega-no-brief (P9, costura pelo adaptador real): `aprendizado` grava e o `proxima` do mesmo CLI entrega a regra ao implementador', () => {
    const amb = ambiente();
    amb.semear([EV1]);
    const g1 = amb.cli(['aprendizado', 'E', 'D', '--regra', 'rode o gate antes de concluir', '--entra-em', 'brief:implementador,brief:revisor', '--eventos', 'loop:1']);
    assert.equal(g1.rc, 0, g1.out + g1.err);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['rode o gate antes de concluir']);
    const l = amb.cli(['aprendizados', '--para', 'brief:revisor']);
    assert.deepEqual(l.j.aprendizados.map((a) => a.regra), ['rode o gate antes de concluir']);
  });

  test('nada-fecha-e-proxima-segue: com a mensagem do dono a pendência abre na projeção e o `proxima` segue despachando (GM-14 FIEL-2 b); `aprendizado nada` fecha a pendência', () => {
    const amb = ambiente();
    assert.ok(diario.append(amb.entregas, 'dono', { ts: '2026-01-01T00:00:01.000Z', autor: 't@t', sessao: 'dono', agente: 'orquestrador', tipo: 'dono.mensagem', dados: { sha256: 'b'.repeat(64), chars: 4 } }).ok);
    const antes = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(antes.j.acao.tipo, 'despachar', antes.out);
    const abertas = () => pendenciasAprendizado(JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8')), diario.ler(amb.entregas));
    assert.deepEqual(abertas(), [{ sessao: 'dono', seq: 1, tipo: 'dono' }]);
    const nada = amb.cli(['aprendizado', 'nada', '--gatilho', 'dono:1', '--motivo', 'mensagem sem regra a tirar']);
    assert.equal(nada.rc, 0, nada.out + nada.err);
    const depois = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(depois.j.acao.tipo, 'despachar', depois.out);
    assert.deepEqual(abertas(), []);
  });
});

// ─────────────────────────────────────────────────────────────── GM-14 T1: fiação dos subcomandos novos (stubs)

describe('GM-14: subcomandos novos ainda sem implementação', () => {
  const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
  const ONBOARDING = join(AQUI, '..', 'scripts', 'onboarding.mjs');
  /** Fotografia do que o subcomando poderia gravar: toda a árvore fora de `.git` (caminho, tamanho e sha256) e o `git status`. */
  const foto = (dir) => {
    const lista = [];
    const andar = (d) => {
      for (const n of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, n.name);
        if (n.name === '.git') continue;
        if (n.isDirectory()) { lista.push(`${p}/`); andar(p); } else lista.push(`${p} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
      }
    };
    andar(dir);
    return { arvore: lista.sort(), status: g(dir, 'status', '--porcelain', '--untracked-files=all') };
  };
  const rodarNode = (amb, script, args) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout, err: r.stderr };
  };

  test('subcomandos-gm14-stub-nao-implementado: onboarding herdar|foco ⇒ rc 1, erro nao_implementado, nada gravado', () => {
    const amb = ambiente();
    const casos = [
      // `painel.mjs medir` saiu daqui na T11: tem teste próprio em painel-medir.test.mjs.
      ['onboarding.mjs herdar', () => rodarNode(amb, ONBOARDING, ['herdar', '--root', amb.dir])],
      ['onboarding.mjs herdar --gravar', () => rodarNode(amb, ONBOARDING, ['herdar', '--root', amb.dir, '--gravar'])],
    ];
    for (const [nome, rodar] of casos) {
      const antes = foto(amb.dir);
      const r = rodar();
      assert.equal(r.rc, 1, `${nome}: ${r.out}${r.err}`);
      assert.ok(r.j !== null, `${nome}: saída não é 1 linha JSON: ${r.out}`);
      assert.equal(r.j.ok, false, nome);
      assert.equal(r.j.erro, 'nao_implementado', `${nome}: ${r.out}`);
      assert.deepEqual(foto(amb.dir), antes, `${nome}: gravou algo`);
    }
    assert.equal(amb.eventos().length, 0);
  });

  test('subcomandos-gm14-vizinhos: subcomando desconhecido segue uso (rc 2) nos três CLIs', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['anota']).rc, 2);
    assert.equal(amb.cli(['anotar']).rc, 2, 'anotar sem --tipo/--texto é uso');
    assert.equal(rodarNode(amb, PAINEL, ['medi']).rc, 2);
    assert.equal(rodarNode(amb, ONBOARDING, ['herda']).rc, 2);
  });
});

// ─────────────────────────────────────────────── GM-14 T31 (Emenda 2, FIEL-8 b, c): reentrega com motivo pela borda
// P1 da Sombra (.superpowers/sdd/2026-11-11-proxima/t31-sombra-p1.md): cada transição e cada ataque com teste nomeado. Mutações: task-31-mut.json.
describe('reentrega (concluir --motivo)', () => {
  const BASE = 'enabler/GM-10-loop';
  const MOTIVOS_R = ['gate', 'sombra', 'dono'];
  /** Bytes de todo o diário da entrega: recusa = nada gravado, byte a byte. */
  const fotoDiario = (amb) => readdirSync(amb.entregas).filter((f) => f.endsWith('.jsonl')).sort().map((f) => `${f}\n${readFileSync(join(amb.entregas, f), 'utf8')}`).join('\n');
  const estadoT = (amb, t) => {
    const ord = ordenarNucleo(amb.eventos());
    assert.ok(ord.ok);
    return estadoNucleo(ord.eventos.filter((e) => ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'].includes(e.tipo) && e.dados?.task === t));
  };
  const vereditos = (amb) => amb.eventos().filter((e) => e.tipo === 'review.veredito').length;
  /** Evento de outra sessão com `ts` escolhido: o relógio de outra máquina (ou de antes do /clear) no diário. */
  const doFuturo = (amb, sessao, lista) => {
    lista.forEach(([tipo, dados], i) => {
      const ts = new Date(Date.UTC(2099, 0, 1, 0, 0, i + 1)).toISOString();
      const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
      assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
    });
  };
  const recusa = (amb, args, erro, msg) => {
    const antes = fotoDiario(amb);
    const r = amb.cli(args);
    assert.equal(r.rc, 1, `${args.join(' ')} ${r.out}${r.err}`);
    assert.equal(r.j?.ok, false);
    assert.equal(r.j.erro, erro, r.out);
    if (msg) assert.match(r.j.mensagem, msg);
    assert.equal(fotoDiario(amb), antes, `${args.join(' ')}: nada gravado`);
    return r;
  };

  test('reentrega-aprovada-grava-motivo-e-volta-a-concluida (b2, b7, P15): lê tipo, task, sha, motivo e rodada; 0 veredito novo', () => {
    for (const m of MOTIVOS_R) {
      const amb = ambiente();
      amb.aprovar('T1');
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 });
      const nVer = vereditos(amb);
      amb.commitNaWt('T1', 'src/t1.txt', 'y\n', 'fix(GM-10): depois do gate');
      const sha = amb.topo('wt/GM-10-T1');
      const r = amb.cli(['concluir', 'T1', '--motivo', m]);
      assert.equal(r.rc, 0, r.out + r.err);
      const e = amb.eventos().at(-1);
      assert.equal(e.tipo, 'task.concluida');
      assert.deepEqual(e.dados, { task: 'T1', sha, motivo: m });
      assert.equal(e.dados.motivo, m);
      assert.equal(e.dados.sha, sha);
      assert.equal(e.dados.task, 'T1');
      assert.deepEqual(r.j.evento, { tipo: 'task.concluida', task: 'T1', sha, motivo: m });
      assert.equal(vereditos(amb), nVer, 'a reentrega não grava review.veredito');
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'concluida', rodada: 0 }, 'rodada − 1: o APROVADO anulado não conta');
    }
  });

  test('reentrega-concluida-mantem-rodada (b1, b7): não gasta rodada nem grava veredito; o veredito seguinte é a rodada 1', () => {
    for (const m of MOTIVOS_R) {
      const amb = ambiente();
      for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
      amb.commitNaWt('T1', 'src/t1.txt');
      assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
      amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
      const r = amb.cli(['concluir', 'T1', '--motivo', m]);
      assert.equal(r.rc, 0, r.out);
      assert.equal(vereditos(amb), 0);
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'concluida', rodada: 0 });
      assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
      assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    }
  });

  test('reentrega-motivo-invalido-recusa-antes-de-ler (b6, ataque 3): rc 1 argumento_invalido, nada lido nem gravado; sem valor é uso', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    for (const m of ['x', 'GATE', '', ' gate', 'dono ']) recusa(amb, ['concluir', 'T1', '--motivo', m], 'argumento_invalido', /--motivo/);
    const semPlano = ambiente({ plano: null });
    const r = semPlano.cli(['concluir', 'T1', '--motivo', 'x']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'argumento_invalido', 'forma antes do plano e do diário');
    const u = amb.cli(['concluir', 'T1', '--motivo']);
    assert.equal(u.rc, 2);
    assert.equal(u.j.erro, 'uso');
    assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 });
  });

  test('reentrega-mesmo-sha-recusa (b5, ataque 4): aprovada e concluida + R com o sha do último task.concluida => sha_igual', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    for (const m of MOTIVOS_R) recusa(amb, ['concluir', 'T1', '--motivo', m], 'sha_igual', /sha/);
    assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 }, 'segue aprovada, rodada intacta');
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', 'gate']).rc, 0);
    recusa(amb, ['concluir', 'T1', '--motivo', 'sombra'], 'sha_igual');
    assert.deepEqual(estadoT(amb, 'T1'), { estado: 'concluida', rodada: 0 });
  });

  test('concluir-sem-motivo-mesmo-sha-recusa (4.i): correção sem commit novo não tem o que revisar', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    writeFileSync(join(amb.wt('T1'), '.tmp-gabarito', 'review-r1.md'), '- MAJOR 1: x\n');
    assert.equal(amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'correcao']).rc, 0);
    recusa(amb, ['concluir', 'T1'], 'sha_igual');
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
  });

  test('concluir-sem-motivo-em-concluida-e-aprovada-cita-motivo (b4, ataque 13)', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    recusa(amb, ['concluir', 'T1'], 'transicao_invalida', /--motivo <gate\|sombra\|dono>/);
    const apr = ambiente();
    apr.aprovar('T1');
    apr.commitNaWt('T1', 'src/t1.txt', 'y\n');
    recusa(apr, ['concluir', 'T1'], 'transicao_invalida', /--motivo <gate\|sombra\|dono>/);
  });

  // b3 (ataque 12): um teste por estado, nos 3 motivos; sha sempre novo, para só a tabela decidir.
  const VELHO = 'b'.repeat(40);
  const PREFIXOS = {
    pendente: [],
    implementando: [['task.iniciada', { task: 'T1', papel: 'implementador' }]],
    em_revisao: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['task.iniciada', { task: 'T1', papel: 'revisor' }]],
    reprovada: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }]],
    corrigindo: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }]],
    no_teto: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }], ['task.concluida', { task: 'T1', sha: 'c'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }]],
  };
  const DICAS = { em_revisao: /espere o veredito/, reprovada: /caminho é a correção/, no_teto: /só o dono tira/ };
  for (const [estado, prefixo] of Object.entries(PREFIXOS)) {
    test(`reentrega-em-${estado}-recusa (b3): transicao_invalida, nada gravado, estado igual`, () => {
      const amb = ambiente();
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      if (prefixo.length > 0) amb.semear(prefixo);
      amb.commitNaWt('T1', 'src/t1.txt', 'novo\n');
      const antes = estadoT(amb, 'T1');
      assert.equal(antes.estado, estado);
      for (const m of MOTIVOS_R) recusa(amb, ['concluir', 'T1', '--motivo', m], 'transicao_invalida', DICAS[estado] ?? /concluida\.reentrega em /);
      assert.deepEqual(estadoT(amb, 'T1'), antes, estado === 'no_teto' ? 'a reentrega não tira do teto' : 'estado igual');
    });
  }

  test('reentrega-em-integrada-recusa (ataque 2): worktree fechada => worktree_ausente, nada gravado, nunca reabre', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    for (const m of MOTIVOS_R) recusa(amb, ['concluir', 'T1', '--motivo', m], 'worktree_ausente');
    assert.equal(estadoT(amb, 'T1').estado, 'integrada');
  });

  test('reentrega-costura-integrar (c, P9, ataque 5): aprovada => R => integrar recusa sem APROVADO novo; revisor + APROVADO da rodada anulada => integra o sha da R', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'reentregue\n');
    const shaR = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', 'gate']).rc, 0);
    const antes = semEfeito(amb);
    const n = amb.cli(['integrar', 'T1']);
    assert.equal(n.rc, 1, n.out);
    assert.equal(n.j.erro, 'nao_integravel');
    assert.deepEqual(semEfeito(amb), antes, 'sem merge nem evento');
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.j.acao.tipo, 'despachar', p.out);
    assert.deepEqual(p.j.acao.itens.map((i) => [i.task, i.papel]).filter(([t]) => t === 'T1'), [['T1', 'revisor']], 'a R não pula review');
    recusa(amb, ['veredito', 'T1', 'APROVADO', '2', '0', '0'], 'transicao_invalida', /rodada esperada: 1/);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    recusa(amb, ['veredito', 'T1', 'APROVADO', '2', '0', '0'], 'transicao_invalida', /rodada esperada: 1/);
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
    assert.equal(amb.eventos().at(-1).dados.sha, shaR);
    assert.equal(readFileSync(join(amb.dir, 'src/t1.txt'), 'utf8'), 'reentregue\n', 'o commit da reentrega entrou');
  });

  test('reentrega-revisor-ve-diff-inteiro (b8, ataque 14): diff <base>...<sha da R> e reentrega; sem R, diff sem reentrega; sem base, diff null e aviso', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const shaP = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    const semR = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(semR.diff, `${BASE}...${shaP}`);
    assert.ok(!Object.hasOwn(semR, 'reentrega'), JSON.stringify(semR));
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    const shaR = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', 'sombra']).rc, 0);
    const comR = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(comR.diff, `${BASE}...${shaR}`, 'diff inteiro desde a base, nunca <sha anterior>..<sha novo>');
    assert.ok(!comR.diff.includes(shaP));
    assert.equal(comR.reentrega, 'sombra');
    const solto = ambiente();
    solto.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }]]);
    const p = solto.cli(['proxima', '--vivos', '0']);
    const it = p.j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(it.diff, null, 'sem base gravada não inventa diff');
    assert.ok((p.j.aviso ?? []).some((a) => /T1/.test(a) && /gabaritoBase/.test(a)), JSON.stringify(p.j.aviso));
  });

  // ── Emenda 12 (anexos C a5, FIEL-8 c): o sha que o revisor viu vai no `iniciar revisor` e o APROVADO o copia; `integrar` compara.
  const em = (amb, sessao, ts, tipo, dados) => {
    const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
    assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
  };
  const T = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, s)).toISOString();

  test('iniciar-revisor-grava-sha-do-ultimo-concluida: o mesmo do diff despachado; sem sha no concluida (2.0.0), recusa', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    const item = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'task.iniciada');
    assert.equal(e.dados.papel, 'revisor');
    assert.equal(e.dados.sha, sha);
    assert.equal(item.diff, `${BASE}...${e.dados.sha}`, 'o sha do iniciar é o <sha> do diff');
    const velho = ambiente();
    assert.equal(velho.cli(['abrir', 'T1']).rc, 0);
    velho.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1' }]]);
    recusa(velho, ['iniciar', 'T1', 'revisor'], 'forma_invalida', /sha/);
  });

  test('veredito-sha-diferente-do-head-recusa: commit depois do iniciar revisor => APROVADO recusado, nada gravado', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt', 'sem revisão\n');
    recusa(amb, ['veredito', 'T1', 'APROVADO', '1', '0', '0'], 'sha_diferente', /HEAD/);
    assert.equal(estadoT(amb, 'T1').estado, 'em_revisao');
  });

  test('veredito-aprovado-sem-sha-recusado-na-gravacao: iniciar revisor da 2.0.0 (sem sha) não recebe APROVADO (fail-closed)', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha = amb.topo('wt/GM-10-T1');
    amb.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha }], ['task.iniciada', { task: 'T1', papel: 'revisor' }]]);
    recusa(amb, ['veredito', 'T1', 'APROVADO', '1', '0', '0'], 'forma_invalida', /`sha` ausente/);
    assert.equal(estadoT(amb, 'T1').estado, 'em_revisao');
  });

  test('veredito-usa-sha-do-iniciar-com-reentrega-de-relogio-atras: R de outra sessão cai antes do iniciar; o APROVADO copia o sha do iniciar e recusa', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha1 = amb.topo('wt/GM-10-T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'reentregue\n');
    const sha2 = amb.topo('wt/GM-10-T1');
    em(amb, 'A', T(1), 'task.iniciada', { task: 'T1', papel: 'implementador' });
    em(amb, 'A', T(2), 'task.concluida', { task: 'T1', sha: sha1 });
    em(amb, 'C', T(4), 'task.iniciada', { task: 'T1', papel: 'revisor', sha: sha1 });
    em(amb, 'B', T(3), 'task.concluida', { task: 'T1', sha: sha2, motivo: 'gate' }); // relógio atrás: na ordem, antes do iniciar
    amb.fechar();
    assert.equal(estadoT(amb, 'T1').estado, 'em_revisao');
    recusa(amb, ['veredito', 'T1', 'APROVADO', '1', '0', '0'], 'sha_diferente', new RegExp(sha1.slice(0, 12)));
  });

  test('integrar-recusa-aprovado-de-outro-sha: R com relógio atrás cai antes do APROVADO; o APROVADO é de outro sha => commit_nao_revisado', () => {
    for (const empate of [false, true]) {
      const amb = ambiente();
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      amb.commitNaWt('T1', 'src/t1.txt');
      const sha1 = amb.topo('wt/GM-10-T1');
      amb.commitNaWt('T1', 'src/t1.txt', 'reentregue\n');
      const sha2 = amb.topo('wt/GM-10-T1');
      em(amb, 'A', T(1), 'task.iniciada', { task: 'T1', papel: 'implementador' });
      em(amb, 'A', T(2), 'task.concluida', { task: 'T1', sha: sha1 });
      em(amb, 'A', T(4), 'task.iniciada', { task: 'T1', papel: 'revisor', sha: sha1 });
      em(amb, 'A', T(5), 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0, sha: sha1 });
      // ts empatado com o iniciar: `ordenar` desempata pela sessão ('A' < 'B'), e a R ainda cairia depois; por isso o empate é com o concluida.
      em(amb, 'B', empate ? T(2) : T(3), 'task.concluida', { task: 'T1', sha: sha2, motivo: 'gate' });
      amb.fechar();
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 }, 'a ordem torta projeta aprovada');
      const antes = semEfeito(amb);
      const r = amb.cli(['integrar', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'commit_nao_revisado', r.out);
      assert.deepEqual(semEfeito(amb), antes, 'nada gravado, nada integrado');
    }
  });

  test('veredito-sem-sha-2-0-0-segue-ordem: diário da 2.0.0 (iniciar e APROVADO sem sha) integra pela guarda de ordem', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha = amb.topo('wt/GM-10-T1');
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha }],
      ['task.iniciada', { task: 'T1', papel: 'revisor' }], ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
    ]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
  });

});

// ─────────────────────────────────────────────────────────────── T15 (REQ-TRI-1): uma regra de ID

test('id-da-branch-igual-nos-dois-usos: contexto do loop e trilhaDe dão o mesmo ID nas mesmas 6 branches, com o idPadrao de origin', () => {
  const amb = ambiente({ plano: null });
  const doLoop = () => {
    try { return contexto(amb.dir, {}).entrega; } catch (e) { assert.equal(e.erro, 'entrega_nao_inferida', e.message); return null; }
  };
  const daTrilha = (branch, idPadrao) => trilhaDe({ branch, idPadrao, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [] }, []).candidato;
  const casos = (idPadrao, esperado) => {
    const branches = Object.keys(esperado);
    assert.equal(branches.length, 6);
    for (const b of branches) {
      assert.equal(gOk(amb.dir, 'checkout', '-q', '-B', b).status, 0, b);
      const loop = doLoop();
      assert.equal(loop, esperado[b], `loop em ${b}`);
      assert.equal(daTrilha(b, idPadrao), loop, `trilha em ${b}`);
      assert.equal(idDaBranch(b, idPadrao), loop, `idDaBranch em ${b}`);
    }
  };
  // sem origin: o padrão; "feat/x-GM-10" e "GM-10x" casam a regex antiga solta e não casam a regra única
  casos('^[A-Z]+-\\d+$', {
    'enabler/GM-10-loop': 'GM-10', 'wt/GM-10-T1': 'GM-10', 'GM-10': 'GM-10', 'feat/x-GM-10': null, 'main': null, 'feat/GM-10x-a': null,
  });
  // com origin: o idPadrao de fluxo.idPadrao vale no loop também
  comOrigin(amb, { fluxo: { idPadrao: 'ABC-\\d+' } });
  casos('ABC-\\d+', {
    'enabler/ABC-7-loop': 'ABC-7', 'wt/ABC-7-T1': 'ABC-7', 'ABC-7': 'ABC-7', 'enabler/GM-10-loop': null, 'main': null, 'feat/x-ABC-7': null,
  });
  // origin corrompida cai no padrão (como a guarda e o painel), sem lançar outra coisa
  comOrigin(amb, '{');
  assert.equal(gOk(amb.dir, 'checkout', '-q', '-B', 'enabler/GM-10-loop').status, 0);
  assert.equal(doLoop(), 'GM-10');
  // --entrega explícito segue vencendo a branch
  assert.equal(contexto(amb.dir, { entrega: 'GM-77' }).entrega, 'GM-77');
});

test('id-padrao-de-origin-invalido-ou-longo: regex inválida e > 200 caracteres caem no padrão, sem lançar; 200 exatos valem', () => {
  const amb = ambiente({ plano: null });
  const doLoop = () => {
    try { return contexto(amb.dir, {}).entrega; } catch (e) { assert.equal(e.erro, 'entrega_nao_inferida', e.message); return null; }
  };
  const em = (branch) => { assert.equal(gOk(amb.dir, 'checkout', '-q', '-B', branch).status, 0, branch); return doLoop(); };
  // regex inválida ⇒ padrão: GM-10 é inferido e nada lança
  comOrigin(amb, { fluxo: { idPadrao: 'ABC-(\\d+' } });
  assert.equal(em('enabler/GM-10-loop'), 'GM-10');
  assert.equal(em('enabler/ABC-7-loop'), 'ABC-7');
  // 201 caracteres (válida, mas longa) ⇒ padrão: GM-10 vale (a longa não o casaria)
  const longa = `ABC-\\d+|${'Z'.repeat(201 - 'ABC-\\d+|'.length)}`;
  assert.equal(longa.length, 201);
  comOrigin(amb, { fluxo: { idPadrao: longa } });
  assert.equal(em('enabler/GM-10-loop'), 'GM-10');
  // 200 exatos valem: a mesma regex encurtada em 1 é a de origin (GM-10 não casa mais)
  comOrigin(amb, { fluxo: { idPadrao: longa.slice(0, 200) } });
  assert.equal(em('enabler/GM-10-loop'), null);
  assert.equal(em('enabler/ABC-7-loop'), 'ABC-7');
});

test('aprovar-sem-plano-pelo-cli-real (P9): o comando do dono, sem plano.json, grava pelo hook real e o loop segue sem plano', () => {
  const amb = ambiente({ plano: null });
  mkdirSync(join(amb.dir, 'docs', 'superpowers', 'specs'), { recursive: true });
  const texto = '# Spec\n\nPBI: GM-10\n\n## A\n';
  writeFileSync(join(amb.dir, 'docs', 'superpowers', 'specs', 's.md'), texto);
  const hook = join(AQUI, '..', 'scripts', 'aprovar-spec.mjs');
  const entrada = { session_id: 'S-dono', cwd: amb.dir, hook_event_name: 'UserPromptExpansion', command_name: 'gabarito-mestre:aprovar', command_args: '', command_source: 'plugin' };
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(entrada), encoding: 'utf8', cwd: amb.dir, env: amb.env });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout.trim());
  assert.notEqual(j.decision, 'block', r.stdout);
  const ev = amb.eventos().filter((e) => e.tipo === 'spec.aprovada');
  assert.deepEqual(ev.map((e) => e.dados), [{ spec: 'docs/superpowers/specs/s.md', sha256: createHash('sha256').update(texto).digest('hex') }]);
  // o loop sem plano continua dizendo plano_ausente (aprovar não inventa plano)
  const p = amb.cli(['proxima', '--vivos', '0']);
  assert.equal(p.j?.erro, 'plano_ausente', p.out);
});

// ═══════════════════════════════════════════════════════════════ GM-14 T36: a Sombra libera o teto 1 vez por task (FIEL-15, emenda 13)
// Ataques obrigatórios: furos 1–10 da Sombra e44cd3ef. Cada recusa relê o diário (bytes iguais) e confere que os achados ficaram no lugar.

describe('T36: a Sombra libera o teto', () => {
  const SOMBRA = join(AQUI, '..', 'scripts', 'sombra.mjs');
  const sombra = (amb, args) => {
    const r = spawnSync(process.execPath, [SOMBRA, ...args], { cwd: amb.dir, encoding: 'utf8', env: amb.env });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout + r.stderr };
  };
  const comLibera = (amb, sombraCfg = { libera_teto: true }) => comOrigin(amb, { sombra: sombraCfg });
  const ok = (amb, args) => { const r = amb.cli(args); assert.equal(r.rc, 0, `${args.join(' ')}: ${r.out}${r.err}`); return r; };
  const achado = (amb, t, n) => { mkdirSync(join(amb.wt(t), '.tmp-gabarito'), { recursive: true }); writeFileSync(join(amb.wt(t), '.tmp-gabarito', `review-r${n}.md`), `achado r${n}\n`); };
  /** Pelo CLI real: abrir, implementar, REPROVADO r1, corrigir, (antesDoTeto), REPROVADO r2 com achado ⇒ no_teto. */
  function aoTeto(amb, t = 'T1', antesDoTeto = () => {}) {
    ok(amb, ['abrir', t]);
    ok(amb, ['iniciar', t, 'implementador']);
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`, 'a\n');
    ok(amb, ['concluir', t]);
    ok(amb, ['iniciar', t, 'revisor']);
    achado(amb, t, 1);
    ok(amb, ['veredito', t, 'REPROVADO', '1', '1', '0']);
    ok(amb, ['iniciar', t, 'correcao']);
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`, 'b\n');
    ok(amb, ['concluir', t]);
    ok(amb, ['iniciar', t, 'revisor']);
    antesDoTeto();
    achado(amb, t, 2);
    ok(amb, ['veredito', t, 'REPROVADO', '2', '1', '0']);
  }
  const estadoT = (amb, t = 'T1') => {
    const o = ordenarNucleo(amb.eventos());
    assert.ok(o.ok);
    return estadoNucleo(o.eventos.filter((e) => ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'].includes(e.tipo) && e.dados?.task === t));
  };
  const respostaJson = (amb, obj, nome = `r-${Math.random().toString(16).slice(2)}.json`) => {
    const f = join(amb.tmpSistema, nome);
    writeFileSync(f, JSON.stringify(obj));
    return f;
  };
  const BOA = { resposta: 'libera mais um ciclo', texto: 'a spec sustenta mais uma rodada', pergunta_enviesada: false, fontes: ['docs/spec.md:3'] };
  /** Pergunta de liberação + decisão pelo CLI real da Sombra. Devolve o hash. */
  function sombraDecide(amb, t = 'T1', extra = { libera: true }) {
    const p = sombra(amb, ['perguntar', '--task', t, '--libera-teto']);
    assert.equal(p.rc, 0, p.out);
    const r = sombra(amb, ['registrar', p.j.hash, respostaJson(amb, { ...BOA, ...extra })]);
    assert.equal(r.rc, 0, r.out);
    return p.j.hash;
  }
  const liberar = (amb, t, h, extra = []) => amb.cli(['liberar', t, '--origem', 'sombra', '--hash', h, ...extra]);
  const achadosNoLugar = (amb, t = 'T1') => existsSync(join(amb.wt(t), '.tmp-gabarito', 'review-r2.md'));
  /** Recusa com o código, rc 1, 1 frase e NADA gravado (diário relido byte a byte) nem achado movido. */
  function recusa(amb, t, h, erro, extra = []) {
    const antes = bytesDoDiario(amb);
    const r = liberar(amb, t, h, extra);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, erro, r.out);
    assert.equal(typeof r.j.mensagem, 'string');
    assert.match(r.j.mensagem, /nada foi gravado/i);
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    return r;
  }
  /** Evento escrito à mão (forja) com `ts` deslocado do agora; a sessão decide a ordem. */
  const forja = (amb, sessao, tipo, dados, deslocMs = 0) => {
    const r = diario.append(amb.entregas, sessao, { ts: new Date(Date.now() + deslocMs).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
    assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
  };
  /** Arquivos que `registrar` grava (brief e resposta), sem passar pelo CLI. */
  const arquivosDaDecisao = (amb, h, texto = 'texto') => {
    mkdirSync(join(amb.entregas, 'sombra'), { recursive: true });
    writeFileSync(join(amb.entregas, 'sombra', `${h}.md`), 'brief\n');
    const nome = `${h}.${createHash('sha256').update(texto).digest('hex').slice(0, 12)}.resposta.md`;
    writeFileSync(join(amb.entregas, 'sombra', nome), texto);
    return `.harness/entregas/GM-10/sombra/${nome}`;
  };
  /** O hash de liberação que `liberar` recalcula HOJE: emendas, rodadas do ciclo e sha de cada achado (T39 r1). Não depende do caminho da raiz. */
  const hashT = (amb, t = 'T1') => hashDaLiberacao(JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8')), amb.eventos(), t, amb.dir);

  test('t36-p9-cli-real: no_teto ⇒ registrar libera:true ⇒ liberar --origem sombra ⇒ pendente r0 ⇒ registro e painel listam ⇒ 2ª recusa teto_sombra_esgotado', async () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    const h = sombraDecide(amb);
    const dec = amb.eventos().filter((e) => e.tipo === 'decisao.sombra');
    assert.equal(dec.length, 1);
    assert.equal(dec[0].dados.libera, true, 'o campo libera chega ao diário');
    assert.equal(dec[0].dados.task, 'T1');
    assert.equal(dec[0].dados.pergunta_hash, h);
    assert.equal(h, hashT(amb), 'a pergunta de liberação tem o hash que o loop recalcula');
    const antes = amb.eventos().length;
    const r = liberar(amb, 'T1', h);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual([r.j.ok, r.j.task, r.j.entrega, r.j.estado, r.j.origem, r.j.hash], [true, 'T1', 'GM-10', 'pendente', 'sombra', h]);
    const novos = amb.eventos().slice(antes);
    assert.equal(novos.length, 1, 'um evento só');
    assert.equal(novos[0].tipo, 'task.reaberta');
    assert.deepEqual(novos[0].dados, { task: 'T1', origem: 'sombra', hash: h });
    assert.equal(novos[0].sessao, 'loop');
    assert.deepEqual(estadoT(amb), { estado: 'pendente', rodada: 0 });
    // os achados do ciclo que terminou no teto saem do caminho (como na liberação do dono)
    assert.equal(achadosNoLugar(amb), false);
    assert.ok(existsSync(join(amb.wt('T1'), '.tmp-gabarito', 'ciclo-1', 'review-r2.md')));
    // registro (o que o Stop de concluir e o registro.md mostram ao dono) e RECENTE do painel
    const { montarRegistro } = await import('../dist/registro.js');
    assert.match(montarRegistro('GM-10', amb.eventos(), null), /· task T1 · a Sombra liberou a T1 · decisão [0-9a-f]{12}/);
    const { fraseHistorico } = await import('../dist/painel-texto.js');
    const ctx = { nomes: new Map(), lider: 'L', sabio: 'S', porAgente: new Map(), fuso: 'UTC', agoraMs: Date.now(), textoParar: () => null };
    assert.equal(fraseHistorico(novos[0], ctx)?.texto, 'a Sombra liberou a T1');
    // 2ª tentativa: sempre do dono
    const dois = recusa(amb, 'T1', h, 'teto_sombra_esgotado');
    assert.match(dois.j.mensagem, /dono/);
    assert.match(dois.j.mensagem, /gabarito-mestre:liberar/);
  });

  test('t36-sem-flag: sem origin, origin sem a chave, chave que não é true, só no config local e origin ilegível ⇒ libera_teto_desligado', () => {
    const amb = ambReq({ config: { ...CONFIG_PADRAO, sombra: { libera_teto: true } } });
    aoTeto(amb);
    const h = sombraDecide(amb);
    for (const preparar of [() => {}, () => comOrigin(amb, { sombra: { teto: 9 } }), () => comOrigin(amb, { sombra: { libera_teto: 'true' } }),
      () => comOrigin(amb, { sombra: { julga_emendas: true } }), () => comOrigin(amb, { sombra: null }), () => comOrigin(amb, '{quebrado')]) {
      preparar();
      const r = recusa(amb, 'T1', h, 'libera_teto_desligado');
      assert.match(r.j.mensagem, /origin\/HEAD/);
      assert.ok(achadosNoLugar(amb), 'achados no lugar');
    }
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    // controle: o mesmo diário com o flag em origin libera
    comLibera(amb);
    assert.equal(liberar(amb, 'T1', h).rc, 0);
  });

  test('t36-sem-flag-comportamento-identico (FIEL-15 d): decisão sem `libera` grava os mesmos campos de antes; o dono libera como sempre', () => {
    const amb = ambReq();
    aoTeto(amb);
    const p = sombra(amb, ['perguntar', '--task', 'T1', '--pergunta', 'a forma vale?']);
    const reg = sombra(amb, ['registrar', p.j.hash, respostaJson(amb, BOA)]);
    assert.equal(reg.rc, 0, reg.out);
    const d = amb.eventos().filter((e) => e.tipo === 'decisao.sombra').at(-1).dados;
    assert.deepEqual(Object.keys(d).sort(), ['arquivo', 'fontes', 'pergunta_enviesada', 'pergunta_hash', 'resposta', 'task']);
    const r = liberarTeto(amb.dir, 'T1', 'S-dono');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.reaberta').map((e) => e.dados), [{ task: 'T1', origem: 'dono' }]);
  });

  test('t36-fora-do-teto: pendente, implementando e reprovada ⇒ fora_do_teto', () => {
    const amb = ambReq();
    comLibera(amb);
    const h0 = hashT(amb);
    recusa(amb, 'T1', h0, 'fora_do_teto');
    ok(amb, ['abrir', 'T1']);
    ok(amb, ['iniciar', 'T1', 'implementador']);
    // T39 r1: fora do teto `perguntar --libera-teto` já recusa; a decisão só chega aqui forjada
    const p = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    assert.equal(p.j?.erro, 'fora_do_teto', p.out);
    const h = hashT(amb);
    forja(amb, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    recusa(amb, 'T1', h, 'fora_do_teto');
    const antes = bytesDoDiario(amb);
    assert.equal(liberar(amb, 'T9', h).j.erro, 'task_fora_do_plano');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('t36-uso: só --origem sombra; --hash e --origem obrigatórios; nenhum argumento produz dono; hash fora da forma ⇒ hash_invalido', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = sombraDecide(amb);
    const antes = bytesDoDiario(amb);
    for (const a of [['liberar', 'T1', '--origem', 'dono', '--hash', h], ['liberar', 'T1', '--origem', 'retomada', '--hash', h], ['liberar', 'T1', '--hash', h],
      ['liberar', 'T1', '--origem', 'sombra'], ['liberar', '--origem', 'sombra', '--hash', h], ['liberar', 'T1', '--origem', 'sombra', '--hash', h, '--dono', 'x']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 2, `${a.join(' ')}: ${r.out}`);
      assert.equal(r.j.ok, false);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
    for (const ruim of ['xyz', h.toUpperCase(), h.slice(1), `${h}0`]) recusa(amb, 'T1', ruim, 'hash_invalido');
    assert.equal(amb.eventos().filter((e) => e.tipo === 'task.reaberta').length, 0);
  });

  test('t36-furo-1-3: só `decisao.sombra` vigente da PERGUNTA de liberação da task; outra pergunta ou de outra task ⇒ hash_invalido', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    // outra pergunta da mesma task (sem libera): qualquer decisão da task NÃO serve
    const p = sombra(amb, ['perguntar', '--task', 'T1', '--pergunta', 'o teste cobre?']);
    assert.equal(sombra(amb, ['registrar', p.j.hash, respostaJson(amb, BOA)]).rc, 0);
    assert.match(recusa(amb, 'T1', p.j.hash, 'hash_invalido').j.mensagem, /pergunta de liberação/);
    // pergunta de liberação de OUTRA task, com libera true (forjada: a T2 não está no teto, e `perguntar --libera-teto` recusa fora dele, T39 r1)
    assert.equal(sombra(amb, ['perguntar', '--task', 'T2', '--libera-teto']).j?.erro, 'fora_do_teto');
    const h2 = hashT(amb, 'T2');
    forja(amb, 'forja', 'sombra.consulta', { pergunta_hash: h2, task: 'T2' });
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h2, task: 'T2', resposta: 'r', arquivo: arquivosDaDecisao(amb, h2), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    recusa(amb, 'T1', h2, 'hash_invalido');
    // a pergunta certa sem decisão ainda
    const aberta = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    assert.equal(aberta.j.hash, hashT(amb));
    assert.match(recusa(amb, 'T1', aberta.j.hash, 'hash_invalido').j.mensagem, /decisão/);
    // sem libera e com libera false: motivo próprio (T39, emenda 16), testes liberar-libera-*-sombra-nao-liberou
  });

  // GM-14 T39 (emenda 16): `libera` ausente ou falso na decisão vigente é a Sombra dizendo não, com motivo próprio (rc 1, nada gravado)
  for (const [nome, extra] of [['liberar-libera-false-sombra-nao-liberou', { libera: false }], ['liberar-libera-ausente-sombra-nao-liberou', {}]]) {
    test(nome, () => {
      const amb = ambReq();
      comLibera(amb);
      aoTeto(amb);
      const h = sombraDecide(amb, 'T1', extra);
      const r = recusa(amb, 'T1', h, 'sombra_nao_liberou');
      assert.match(r.j.mensagem, extra.libera === false ? /libera false/ : /libera ausente/);
      assert.ok(achadosNoLugar(amb), 'achados no lugar');
      assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    });
  }

  test('emenda-dia2-nova-muda-hash', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = sombraDecide(amb);
    assert.equal(h, hashT(amb));
    // emenda aprovada de REQ-DIA-2 (onde a FIEL-15 mora; a T1 não lista o REQ) depois da decisão: muda o hash, a decisão velha não libera
    escreve(amb, 'emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-DIA-2', diff: '+ FIEL-15 nova' }), new Date().toISOString());
    const seq = amb.eventos().filter((e) => e.tipo === 'emenda.proposta').at(-1).seq;
    escreve(amb, 'dono', 'spec.emendada', { proposta_seq: seq, origem: 'dono' }, new Date().toISOString());
    const novo = hashT(amb);
    assert.notEqual(novo, h, 'emenda de REQ-DIA-2 versiona o hash da liberação');
    assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /pergunta de liberação/);
    // a pergunta de hoje (sombra.mjs) tem o hash novo que o loop recalcula, e libera
    assert.equal(sombraDecide(amb), novo);
    assert.equal(liberar(amb, 'T1', novo).rc, 0);
    // controle: emenda de REQ fora da task e fora de REQ-DIA-2 não muda o hash
    const amb2 = ambReq();
    aoTeto(amb2);
    const h2 = hashT(amb2);
    escreve(amb2, 'emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-Z-9' }), new Date().toISOString());
    escreve(amb2, 'dono', 'spec.emendada', { proposta_seq: amb2.eventos().filter((e) => e.tipo === 'emenda.proposta').at(-1).seq, origem: 'dono' }, new Date().toISOString());
    assert.equal(hashT(amb2), h2);
  });

  // T39 r1 (MAJOR 1): a decisão vale para o insumo que a Sombra leu; achado reescrito ou veredito novo depois dela ⇒ `liberar` recusa
  test('liberar-recusa-decisao-sobre-insumo-velho', () => {
    for (const mudar of [
      (amb) => writeFileSync(join(amb.wt('T1'), '.tmp-gabarito', 'review-r2.md'), 'achado r2 REESCRITO\n'),
      (amb) => {
        forja(amb, 'loop', 'review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 3, blocker: 1, major: 0 });
        achado(amb, 'T1', 3);
      },
    ]) {
      const amb = ambReq();
      comLibera(amb);
      aoTeto(amb);
      const velho = sombraDecide(amb);
      mudar(amb);
      assert.notEqual(hashT(amb), velho, 'insumo novo, hash novo');
      assert.match(recusa(amb, 'T1', velho, 'hash_invalido').j.mensagem, /achados de hoje/);
      assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
      // perguntar de novo dá o hash de hoje, brief novo com o insumo novo, e a decisão dele libera
      const p = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
      assert.equal(p.j.hash, hashT(amb));
      assert.notEqual(p.j.hash, velho);
      const brief = readFileSync(join(amb.dir, p.j.brief), 'utf8');
      assert.ok(/REESCRITO/.test(brief) || /### Rodada 3 [^\n]*ÚLTIMA RODADA/.test(brief), brief.slice(-600));
      const novo = sombraDecide(amb);
      assert.equal(novo, p.j.hash);
      const r = liberar(amb, 'T1', novo);
      assert.equal(r.rc, 0, r.out);
    }
  });

  test('t36-furo-1: fora_da_regra true não libera', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = hashT(amb);
    forja(amb, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fora_da_regra: true, emenda_seq: 1, libera: true });
    assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /fora da regra/);
    // controle: a mesma forja sem fora_da_regra libera (o que recusou foi o campo)
    const amb2 = ambReq();
    comLibera(amb2);
    aoTeto(amb2);
    forja(amb2, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    forja(amb2, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb2, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    assert.equal(liberar(amb2, 'T1', h).rc, 0);
  });

  test('t36-furo-2: brief ausente, resposta ausente ou adulterada, decisão sem consulta ⇒ hash_invalido', () => {
    const casos = {
      brief: (amb, h) => renameSync(join(amb.entregas, 'sombra', `${h}.md`), join(amb.entregas, 'sombra', `${h}.md.fora`)),
      resposta: (amb, h) => { const n = readdirSync(join(amb.entregas, 'sombra')).find((x) => x.startsWith(`${h}.`) && x.endsWith('.resposta.md')); renameSync(join(amb.entregas, 'sombra', n), join(amb.entregas, 'sombra', `${n}.fora`)); },
      adulterada: (amb, h) => { const n = readdirSync(join(amb.entregas, 'sombra')).find((x) => x.startsWith(`${h}.`) && x.endsWith('.resposta.md')); writeFileSync(join(amb.entregas, 'sombra', n), 'outro texto'); },
    };
    for (const [nome, estragar] of Object.entries(casos)) {
      const amb = ambReq();
      comLibera(amb);
      aoTeto(amb);
      const h = sombraDecide(amb);
      estragar(amb, h);
      assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /arquivo|brief|resposta/, nome);
    }
    // decisão forjada sem `sombra.consulta` da pergunta
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = hashT(amb);
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /consulta/);
    // arquivo da decisão que aponta para outro lugar
    const amb3 = ambReq();
    comLibera(amb3);
    aoTeto(amb3);
    forja(amb3, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    arquivosDaDecisao(amb3, h);
    forja(amb3, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: 'docs/spec.md', pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    recusa(amb3, 'T1', h, 'hash_invalido');
  });

  test('t36-furo-4: decisão anterior ao teto pela ORDEM do diário (não pelo ts cru) não vale', () => {
    // (a) antes do 2º REPROVADO a pergunta real nem existe (T39 r1: `perguntar --libera-teto` exige no_teto)
    const amb = ambReq();
    comLibera(amb);
    let p;
    aoTeto(amb, 'T1', () => { p = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']); });
    assert.equal(p.j?.erro, 'fora_do_teto', p.out);
    assert.equal(amb.eventos().filter((e) => e.tipo === 'sombra.consulta').length, 0);
    // (b) mesma sessão do veredito, seq menor e ts 1 h À FRENTE: pelo ts cru seria "depois"; pela ordem do diário é antes.
    // O hash é o que a task terá no teto (o de `amb`, mesmo ciclo e mesmos achados: o hash não depende do caminho da raiz)
    const amb2 = ambReq();
    comLibera(amb2);
    const h2 = hashT(amb);
    aoTeto(amb2, 'T1', () => {
      forja(amb2, 'loop', 'sombra.consulta', { pergunta_hash: h2, task: 'T1' }, 3_600_000);
      forja(amb2, 'loop', 'decisao.sombra', { pergunta_hash: h2, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb2, h2), pergunta_enviesada: false, fontes: ['s:1'], libera: true }, 3_600_000);
    });
    const o = ordenarNucleo(amb2.eventos());
    assert.ok(o.ok);
    const pos = (f) => o.eventos.findIndex(f);
    assert.ok(pos((e) => e.tipo === 'decisao.sombra') < pos((e) => e.tipo === 'review.veredito' && e.dados.rodada === 2), 'controle: na ordem, a decisão vem antes');
    assert.ok(Date.parse(o.eventos[pos((e) => e.tipo === 'decisao.sombra')].ts) > Date.parse(o.eventos[pos((e) => e.tipo === 'review.veredito' && e.dados.rodada === 2)].ts), 'controle: pelo ts, depois');
    assert.match(recusa(amb2, 'T1', h2, 'hash_invalido').j.mensagem, /antes do teto/);
  });

  test('t36-furo-4-relogio: liberação que cairia antes do teto na ordem real ⇒ relogio_do_diario, nada gravado', () => {
    const amb = ambReq();
    comLibera(amb);
    // o teto inteiro numa sessão com relógio 1 h à frente: a liberação de agora cairia antes dele
    ok(amb, ['abrir', 'T1']);
    const fut = (tipo, dados, n) => forja(amb, 'futuro', tipo, dados, 3_600_000 + n * 1000);
    [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }],
      ['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
    ].forEach(([tipo, dados], i) => fut(tipo, dados, i));
    achado(amb, 'T1', 2);
    const h = hashT(amb); // T39 r1: o hash leva o insumo do teto (rodadas e achados), então vem depois deles
    [['sombra.consulta', { pergunta_hash: h, task: 'T1' }],
      ['decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true }],
    ].forEach(([tipo, dados], i) => fut(tipo, dados, 6 + i));
    amb.fechar();
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    recusa(amb, 'T1', h, 'relogio_do_diario');
    assert.ok(achadosNoLugar(amb), 'a recusa deixa os achados onde estão');
  });

  test('t36-furo-5: decisão substituída não vale; vale a vigente', () => {
    // libera true substituída por libera false ⇒ recusa
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = sombraDecide(amb);
    const a = amb.eventos().filter((e) => e.tipo === 'decisao.sombra').at(-1);
    const sub = sombra(amb, ['registrar', h, respostaJson(amb, { ...BOA, texto: 'mudei de ideia', libera: false, substitui: { sessao: a.sessao, seq: a.seq } })]);
    assert.equal(sub.rc, 0, sub.out);
    assert.match(recusa(amb, 'T1', h, 'sombra_nao_liberou').j.mensagem, /libera/);
    // libera false substituída por libera true ⇒ libera
    const amb2 = ambReq();
    comLibera(amb2);
    aoTeto(amb2);
    const h2 = sombraDecide(amb2, 'T1', { libera: false });
    const b = amb2.eventos().filter((e) => e.tipo === 'decisao.sombra').at(-1);
    assert.equal(sombra(amb2, ['registrar', h2, respostaJson(amb2, { ...BOA, texto: 'agora sim', libera: true, substitui: { sessao: b.sessao, seq: b.seq } })]).rc, 0);
    const r = liberar(amb2, 'T1', h2);
    assert.equal(r.rc, 0, r.out);
  });

  test('t36-furo-6: a Sombra só dá a 1ª liberação; depois do dono, mesmo no teto de novo, teto_sombra_esgotado; depois da Sombra, o dono libera', () => {
    const amb = ambReq();
    comLibera(amb);
    ok(amb, ['abrir', 'T1']);
    const ciclo = [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }],
      ['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }]];
    amb.semear([...ciclo, ['task.reaberta', { task: 'T1', origem: 'dono' }], ...ciclo]);
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    const h = sombraDecide(amb);
    assert.match(recusa(amb, 'T1', h, 'teto_sombra_esgotado').j.mensagem, /dono/);
    // a liberação da Sombra é aceita pela tabela e o dono tira do teto depois dela
    const amb2 = ambReq();
    ok(amb2, ['abrir', 'T1']);
    amb2.semear([...ciclo, ['task.reaberta', { task: 'T1', origem: 'sombra', hash: 'e'.repeat(64) }], ...ciclo]);
    assert.deepEqual(estadoT(amb2), { estado: 'no_teto', rodada: 2 });
    comLibera(amb2);
    recusa(amb2, 'T1', sombraDecide(amb2), 'teto_sombra_esgotado');
    const d = liberarTeto(amb2.dir, 'T1', 'S-dono');
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.deepEqual(estadoT(amb2), { estado: 'pendente', rodada: 0 });
  });

  test('t36-registrar-libera: não booleano ⇒ resposta_invalida; libera:true fora da pergunta de liberação ⇒ libera_fora_da_liberacao; nada gravado', () => {
    const amb = ambReq();
    aoTeto(amb);
    const lib = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    const outra = sombra(amb, ['perguntar', '--task', 'T1', '--pergunta', 'outra?']);
    const doReq = sombra(amb, ['perguntar', '--req', 'REQ-A-1', '--pergunta', 'e o req?']);
    const arquivos = () => readdirSync(join(amb.entregas, 'sombra')).sort();
    const antes = [bytesDoDiario(amb), arquivos()];
    for (const v of ['true', 1, null]) {
      const r = sombra(amb, ['registrar', lib.j.hash, respostaJson(amb, { ...BOA, libera: v })]);
      assert.equal(r.j.erro, 'resposta_invalida', r.out);
      assert.match(r.j.mensagem, /libera/);
    }
    for (const hh of [outra.j.hash, doReq.j.hash]) {
      const r = sombra(amb, ['registrar', hh, respostaJson(amb, { ...BOA, libera: true })]);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'libera_fora_da_liberacao', r.out);
    }
    assert.deepEqual([bytesDoDiario(amb), arquivos()], antes, 'nada gravado: diário e arquivos iguais');
    // `--libera-teto` exige --task e não aceita --pergunta
    for (const a of [['perguntar', '--req', 'REQ-A-1', '--libera-teto'], ['perguntar', '--task', 'T1', '--libera-teto', '--pergunta', 'x?'], ['perguntar', '--libera-teto']]) {
      assert.equal(sombra(amb, a).rc, 2, a.join(' '));
    }
  });

  test('t36-dono-inalterado: com o flag ligado e decisão da Sombra presente, o caminho do dono grava origem dono e só ele', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    sombraDecide(amb);
    const r = liberarTeto(amb.dir, 'T1', 'S-dono');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.reaberta').map((e) => [e.sessao, e.dados]), [['S-dono', { task: 'T1', origem: 'dono' }]]);
  });
});

// ─────────────────────────────────────────────────────────────── GM-14 T38: spec do checkout da sessão (DP-3 aj. 4 e 5)

describe('GM-14 T38: a spec se lê do checkout da sessão; o diário fica na principal', () => {
  const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
  const SPEC_A = 'docs/superpowers/specs/gm10-a.md';
  const SPEC_B = 'docs/superpowers/specs/gm10-b.md';
  const TEXTO_WT = '# GM-10 da worktree\n\nPBI: GM-10\n\n## Uma\n';
  const TEXTO_PRINCIPAL = '# GM-10 da principal\n\nPBI: GM-10\n\n## Outra\n';
  const sha = (t) => createHash('sha256').update(Buffer.from(t)).digest('hex');
  const AGUARDANDO = 'spec aguardando aprovação';
  /** Worktree REAL (`git worktree add`) na branch da entrega; a principal fica em `main`, sem ID. */
  function comWorktree(plano, extra = {}) {
    const amb = ambiente({ branch: 'main', plano, ...extra });
    const wt = join(amb.dir, '.harness', 'worktrees', 'S1');
    g(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-S1', wt);
    const escrever = (raiz, caminho, texto) => { mkdirSync(dirname(join(raiz, caminho)), { recursive: true }); writeFileSync(join(raiz, caminho), texto); };
    return { amb, wt: realpathSync(wt), escrever };
  }
  const painelEstado = (amb, cwd) => {
    const r = spawnSync(process.execPath, [PAINEL, 'estado'], { cwd, encoding: 'utf8', env: amb.env, input: '' });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    assert.equal(j?.ok, true, `painel estado: ${r.stdout}${r.stderr}`);
    return j;
  };
  const shaDoMedir = async (amb, cwd) => {
    const { medir } = await import('../scripts/painel-medir.mjs');
    const rodar = (cmd, args, o) => (cmd === 'git' ? spawnSync('git', args, { cwd: o.cwd, encoding: 'utf8' }) : { status: 1, stdout: '', stderr: 'sem gh' });
    medir(cwd, { rodar, agentes: { session_id: 'S-medir', agentes: [] }, agora: () => Date.parse('2026-11-12T20:00:00Z') });
    return amb.eventos().filter((e) => e.tipo === 'fato.medido' && e.dados.chave === 'spec').map((e) => [e.dados.valor.caminho, e.dados.valor.sha256]);
  };

  const TODO_PAINEL = 'painel.mjs:328 lê da raiz principal, correção na T18 (depende da T38)';

  test('spec-na-worktree-da-sessao-com-plano: aprovarSpec, lerSpecs e medir dão o MESMO sha da spec da worktree; diário só na principal', async () => {
    const { aprovarSpec, lerSpecs } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A });
    escrever(wt, SPEC_A, TEXTO_WT);
    escrever(amb.dir, SPEC_A, TEXTO_PRINCIPAL); // a principal tem OUTRA versão: ler dela daria outro sha
    const r = aprovarSpec(wt, 'S-dono');
    assert.deepEqual(r, { ok: true, spec: SPEC_A, sha256: sha(TEXTO_WT), entrega: 'GM-10' });
    const a = amb.eventos().filter((e) => e.tipo === 'spec.aprovada');
    assert.deepEqual(a.map((e) => e.dados), [{ spec: SPEC_A, sha256: sha(TEXTO_WT) }], 'no diário da principal');
    assert.equal(existsSync(join(wt, '.harness', 'entregas')), false, 'a worktree não ganhou diário');
    // lerSpecs do checkout da sessão: o mesmo sha
    assert.deepEqual(lerSpecs(wt).map((s) => [s.caminho, s.sha256]), [[SPEC_A, sha(TEXTO_WT)]]);
    // medir (painel-medir) lê o mesmo arquivo do mesmo checkout: mesmo sha
    assert.deepEqual(await shaDoMedir(amb, wt), [[SPEC_A, sha(TEXTO_WT)]]);
    // garantias intactas com plano: 2ª vez ⇒ ja_aprovada; mudança entre o hash e o append ⇒ spec_mudou
    assert.equal(aprovarSpec(wt, 'S-dono').erro, 'ja_aprovada');
    escrever(wt, SPEC_A, `${TEXTO_WT}mais\n`);
    const mudou = aprovarSpec(wt, 'S-dono', { antes: () => escrever(wt, SPEC_A, `${TEXTO_WT}outra\n`) });
    assert.equal(mudou.erro, 'spec_mudou', JSON.stringify(mudou));
    assert.equal(amb.eventos().filter((e) => e.tipo === 'spec.aprovada').length, 1);
  });

  test('spec-na-worktree-da-sessao-com-plano-painel: o painel estado da sessão vê a aprovação do sha da worktree', { todo: TODO_PAINEL }, async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A });
    escrever(wt, SPEC_A, TEXTO_WT);
    escrever(amb.dir, SPEC_A, TEXTO_PRINCIPAL);
    assert.equal(aprovarSpec(wt, 'S-dono').ok, true);
    const depois = painelEstado(amb, wt);
    assert.equal(JSON.stringify(depois.estado).includes(AGUARDANDO), false, JSON.stringify(depois.estado));
  });

  test('req-na-spec-le-do-checkout-da-sessao: REQ só na spec da worktree ⇒ proposta aceita; REQ só na da principal ⇒ req_desconhecido (T38, DP-3 aj. 4)', () => {
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A });
    escrever(wt, SPEC_A, `${TEXTO_WT}\n**REQ-ZZ-1** só na worktree.\n`);
    escrever(amb.dir, SPEC_A, `${TEXTO_PRINCIPAL}\n**REQ-YY-1** só na principal.\n`);
    const doWt = amb.cli(proporArgs(amb, { req: 'REQ-ZZ-1' }), { cwd: wt });
    assert.equal(doWt.rc, 0, doWt.out + doWt.err);
    assert.equal(emendasDoDiario(amb).filter((e) => e.tipo === 'emenda.proposta').length, 1, 'gravou na principal');
    const daPrincipal = amb.cli(proporArgs(amb, { req: 'REQ-YY-1' }), { cwd: wt });
    assert.notEqual(daPrincipal.rc, 0, daPrincipal.out);
    assert.equal(daPrincipal.j?.erro, 'req_desconhecido', daPrincipal.out + daPrincipal.err);
    assert.equal(emendasDoDiario(amb).filter((e) => e.tipo === 'emenda.proposta').length, 1, 'nada gravado na recusa');
  });

  test('registro-sha-do-checkout-da-sessao: `registro` rodado de dentro da worktree grava o sha da spec da WORKTREE, não o da principal (T38, DP-3 aj. 4)', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A }, { gitignore: false }); // o registro se commita: o diário não pode estar ignorado
    escrever(wt, SPEC_A, TEXTO_WT);
    escrever(amb.dir, SPEC_A, TEXTO_PRINCIPAL);
    assert.equal(aprovarSpec(wt, 'S-dono').ok, true); // aprova o sha da worktree: o registro tem de CONFERIR com ele
    const r = amb.cli(['registro'], { cwd: wt });
    assert.equal(r.rc, 0, r.out + r.err);
    const t = readFileSync(join(amb.entregas, 'registro.md'), 'utf8');
    assert.ok(t.includes(`sha256 atual da spec: ${sha(TEXTO_WT)} (confere com a última aprovação)`), t);
    assert.equal(t.includes(sha(TEXTO_PRINCIPAL)), false, 'o sha da principal não entra');
  });

  test('plano-spec-diferente-da-aprovada: aprovada sem plano (a.md) e o plano nasce com b.md ⇒ b.md falta aprovar (aprovarSpec grava, nunca ja_aprovada); com a.md ⇒ ja_aprovada', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const textoB = '# GM-10 b\n\nsem cabeçalho de PBI, outro texto\n';
    const { amb, wt, escrever } = comWorktree(null);
    escrever(wt, SPEC_A, TEXTO_WT);
    assert.deepEqual(aprovarSpec(wt, 'S-dono'), { ok: true, spec: SPEC_A, sha256: sha(TEXTO_WT), entrega: 'GM-10' });
    escrever(wt, SPEC_B, textoB);
    // plano com a.md: o mesmo arquivo aprovado não se aprova de novo
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_A }));
    assert.equal(aprovarSpec(wt, 'S-dono').erro, 'ja_aprovada');
    // plano com b.md: não herda o ✓ de a.md; a aprovação grava o sha de b.md
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_B }));
    assert.deepEqual(aprovarSpec(wt, 'S-dono'), { ok: true, spec: SPEC_B, sha256: sha(textoB), entrega: 'GM-10' });
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'spec.aprovada').map((e) => e.dados), [
      { spec: SPEC_A, sha256: sha(TEXTO_WT) }, { spec: SPEC_B, sha256: sha(textoB) },
    ]);
  });

  test('plano-spec-diferente-da-aprovada-painel: o painel mostra b.md aguardando aprovação; com a.md não', { todo: TODO_PAINEL }, async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree(null);
    escrever(wt, SPEC_A, TEXTO_WT);
    assert.equal(aprovarSpec(wt, 'S-dono').ok, true);
    escrever(wt, SPEC_B, '# GM-10 b\n\noutro texto\n');
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_B }));
    assert.ok(JSON.stringify(painelEstado(amb, wt).estado).includes(AGUARDANDO));
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_A }));
    assert.equal(JSON.stringify(painelEstado(amb, wt).estado).includes(AGUARDANDO), false);
  });
});

describe('GM-14 T34: pouso é regra do produto (FIEL-14 a, b, c, e, f)', () => {
  const PAINEL_CLI = join(AQUI, '..', 'scripts', 'painel.mjs');
  const CONTEXTO = (amb, sessao) => join(amb.dir, '.harness', 'contexto', `${sessao}.json`);
  const gravarCtx = (amb, sessao, obj, texto = null) => {
    mkdirSync(join(amb.dir, '.harness', 'contexto'), { recursive: true });
    writeFileSync(CONTEXTO(amb, sessao), texto ?? JSON.stringify(obj));
  };
  const agora = (deslocMs = 0) => new Date(Date.now() + deslocMs).toISOString();
  /** Evento de OUTRA sessão com `ts` posterior ao último do diário (o clear/startup do `SessionStart`). */
  const inicioDe = (amb, sessao, origem) => {
    const ultimo = Math.max(...amb.eventos().map((e) => Date.parse(e.ts)));
    const ts = new Date(ultimo + 5000).toISOString();
    const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo: 'sessao.inicio', dados: { origem } });
    assert.ok(r.ok, JSON.stringify(r));
  };
  const painel = (amb) => {
    const r = spawnSync(process.execPath, [PAINEL_CLI, 'estado'], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    return JSON.stringify(j.estado.depende ?? []);
  };
  const ONBOARDING = { ...CONFIG_PADRAO, fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } }; // repo com onboarding: a FIEL-14 (e) vale inteira
  const plano1 = (config = ONBOARDING) => ambiente({ config, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });

  test('pousar-a-partir-de-x-com-contexto-da-sessao: 55 % da sessão S1 ⇒ proxima --sessao S1 devolve pousar e mostra o percent', () => {
    const amb = plano1();
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'pousar');
    assert.equal(r.j.sinais.percent, 55);
    // abaixo de x: despacha
    gravarCtx(amb, 'S1', { percent: 20, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar');
  });

  test('contexto-de-outra-sessao-nao-conta: o arquivo da S2 não pousa a S1; sem --sessao o percent é nulo', () => {
    const amb = plano1();
    gravarCtx(amb, 'S2', { percent: 90, fonte: 'mod', em: agora() });
    const a = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(a.j.sinais.percent, null);
    assert.equal(a.j.acao.tipo, 'despachar');
    const b = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(b.j.sinais.percent, null);
    assert.equal(b.j.acao.tipo, 'despachar');
  });

  test('contexto-velho-ou-corrompido-e-nulo: > 120 s, futuro, JSON torto, percent fora da forma, em ausente ⇒ nulo e despacha', () => {
    const amb = plano1();
    const ruins = [
      [{ percent: 90, fonte: 'mod', em: agora(-121_000) }, null],
      [{ percent: 90, fonte: 'mod', em: agora(60_000) }, null],
      [null, '{nao é json'],
      [{ percent: '90', fonte: 'mod', em: agora() }, null],
      [{ percent: 150, fonte: 'mod', em: agora() }, null],
      [{ percent: 90, fonte: 'mod' }, null],
      [{ percent: 90, fonte: 'mod', em: 'ontem' }, null],
      [[90], null],
    ];
    for (const [obj, texto] of ruins) {
      gravarCtx(amb, 'S1', obj, texto);
      const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
      assert.equal(r.rc, 0, r.out + r.err);
      assert.equal(r.j.sinais.percent, null, JSON.stringify(obj ?? texto));
      assert.equal(r.j.acao.tipo, 'despachar');
    }
    // 120 s exatos ainda vale (controle da fronteira)
    gravarCtx(amb, 'S1', { percent: 90, fonte: 'mod', em: agora(-100_000) });
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'pousar');
  });

  test('contexto-do-mod-chega-ao-proxima (P9): gravarContexto real da T20 grava 55 % e o loop.mjs proxima --sessao real devolve pousar', async () => {
    const { gravarContexto } = await import('../../mod/painel.mjs');
    const amb = plano1();
    const g1 = gravarContexto({ sessao: 'S1', percent: 55, fonte: 'mod', emMs: Date.now() });
    assert.ok(g1);
    const rodou = spawnSync(g1.argv[0], g1.argv.slice(1), { cwd: amb.dir, input: g1.stdin, encoding: 'utf8', env: amb.env });
    assert.equal(rodou.status, 0, rodou.stderr);
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.j.acao.tipo, 'pousar', r.out);
    assert.equal(r.j.sinais.percent, 55);
  });

  test('pousar-grava-sessao-do-claude: --sessao S1 vira o campo sessao do evento; sem --sessao fica "loop"', () => {
    const amb = plano1();
    const r = amb.cli(['pousar', '--sessao', 'S1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const pousos = amb.eventos().filter((e) => e.tipo === 'sessao.pouso');
    assert.deepEqual(pousos.map((e) => e.sessao), ['S1']);
    assert.equal(amb.cli(['pousar']).rc, 0);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'sessao.pouso').map((e) => e.sessao).sort(), ['S1', 'loop']);
  });

  test('pouso-pendente-nao-despacha-nem-revisor, com-vivos-espera, sem-vivos-repete-sem-segunda-retomada: pelo CLI real', () => {
    const amb = plano1();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar', 'controle: sem pouso, o revisor é despachado');
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    // GM-15 T35 (r.12, D-P13): sem leitura de contexto o pouso gravado não é pedido de /clear; o revisor segue (o pendente medido com revisor é o T59 abaixo)
    const sem = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.deepEqual(sem.j.acao.itens?.map((i) => `${i.task} ${i.papel}`), ['T1 revisor'], JSON.stringify(sem.j.acao));
    // a skill repete o pousar (D-W3): novo sessao.pouso, nenhuma sessao.retomada gravada pelo CLI
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const tipos = amb.tipos();
    assert.equal(tipos.filter((t) => t === 'sessao.pouso').length, 2);
    assert.equal(tipos.filter((t) => t === 'sessao.retomada').length, 0);
  });

  test('T59-impasse-revisor-pendente (emenda 67), pelo CLI real: veredito de T1, pouso, T1 integrada, T2 concluída (revisor pendente) e a sessão em 61 % ⇒ proxima 0 vivos pousar, com vivos esperar; nunca o revisor', () => {
    const amb = ambiente({ config: ONBOARDING, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }]) });
    amb.aprovar('T1');
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    for (const a of [['abrir', 'T2'], ['iniciar', 'T2', 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
    amb.commitNaWt('T2', 'src/t2.txt');
    assert.equal(amb.cli(['concluir', 'T2']).rc, 0);
    gravarCtx(amb, 'S1', { percent: 61, fonte: 'mod', em: agora() });
    const sem = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(sem.rc, 0, sem.out + sem.err);
    assert.deepEqual(sem.j.acao, { tipo: 'pousar' });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '1']).j.acao, { tipo: 'esperar', motivo: 'pouso_pendente' });
    // controle: a sessão nova (abaixo de X) já pode despachar o revisor
    gravarCtx(amb, 'S1', { percent: 5, fonte: 'mod', em: agora() });
    inicioDe(amb, 'S2', 'clear');
    const nova = amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao;
    assert.equal(nova.tipo, 'despachar');
    assert.deepEqual(nova.itens.map((i) => `${i.task} ${i.papel}`), ['T2 revisor']);
  });

  test('pouso-atravessa-cli-proxima-depende-painel (P9): pousar S1 ⇒ proxima sem despacho ⇒ painel real com "limpar a conversa" ⇒ clear de S2 tira ⇒ despacha; startup de S2 não tira', () => {
    // GM-15 T35 (r.12, D-P13): o pedido de /clear é medido (fronteira + leitura própria da sessão)
    const amb = plano1();
    amb.aprovar('T1');
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
    inicioDe(amb, 'S2', 'startup');
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
    inicioDe(amb, 'S2', 'clear');
    gravarCtx(amb, 'S2', { percent: 5, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao, { tipo: 'integrar', tasks: ['T1'] });
    assert.doesNotMatch(painelDa(amb, 'S2'), /limpar a conversa/);
  });

  const semConfig = (amb) => { spawnSync('rm', [join(amb.dir, 'harness.config.json')]); return amb; }; // sem config em lugar nenhum (a guarda vê onboarding em qualquer config válida)
  test('proxima-sem-onboarding-nao-trava-pelo-pouso (FIEL-14 h; GM-15 T23, critério da guarda): sem config o pouso gravado não trava proxima nem o painel; com onboarding trava (controle)', () => {
    const amb = semConfig(plano1());
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'despachar', JSON.stringify(r.j.acao));
    assert.doesNotMatch(painel(amb), /limpar a conversa/);
    // controle (GM-15 T35, r.12): com onboarding, fronteira e a leitura própria em 55 % trava
    const com = plano1();
    com.aprovar('T1');
    gravarCtx(com, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(com.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.deepEqual(com.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(com, 'S1'), /limpar a conversa/);
  });

  test('pouso-onboarding-criterio-da-guarda (FIEL-14 h; GM-15 T23): config só em origin/HEAD (sem a local) ⇒ pendente; sem config em lugar nenhum ⇒ não pendente', () => {
    // GM-15 T35 (r.12, D-P13): o critério de onboarding só valia para a regra sem medição, que deixou de pedir /clear: sem leitura, nem com a
    // config de origin o pouso gravado trava
    const amb = semConfig(plano1());
    comOrigin(amb, ONBOARDING);
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar');
    assert.doesNotMatch(painel(amb), /limpar a conversa/);
    const nenhum = semConfig(plano1());
    assert.equal(nenhum.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.equal(nenhum.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar');
    assert.doesNotMatch(painel(nenhum), /limpar a conversa/);
  });

  test('pouso-onboarding-criterio-unico: loop.mjs e painel.mjs importam temOnboarding de cartao-sessao.mjs e não têm critério próprio', () => {
    for (const f of ['loop.mjs', 'painel.mjs']) {
      const fonte = readFileSync(join(AQUI, '..', 'scripts', f), 'utf8');
      assert.match(fonte, /import \{[^}]*\btemOnboarding\b[^}]*\} from '\.\/cartao-sessao\.mjs'/, f);
      assert.doesNotMatch(fonte, /resolvidoEm/, `${f} não pode ler o critério de onboarding por conta própria`);
    }
  });

  // GM-15 T35 (D-G11 b, e)
  const respostaDoDono = (amb, pergunta, rotulo) => {
    const ultimo = Math.max(...amb.eventos().map((e) => Date.parse(e.ts)));
    const r = diario.append(amb.entregas, 'dono', { ts: new Date(ultimo + 1000).toISOString(), autor: 't@t', sessao: 'dono', agente: 'orquestrador', tipo: 'dono.resposta', dados: { pergunta, rotulo } }); // forma do adiamento (formas.ts)
    assert.ok(r.ok, JSON.stringify(r));
  };
  const painelDa = (amb, sessao) => {
    const r = spawnSync(process.execPath, [PAINEL_CLI, 'estado', '--sessao', sessao], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    return JSON.stringify(j.estado.depende ?? []);
  };
  test('sem-medicao-nao-pede-pouso (r.12, D-P13), pelo CLI real: pouso gravado com onboarding e SEM leitura de contexto ⇒ proxima despacha e o painel não pede limpar', () => {
    const amb = plano1();
    amb.aprovar('T1'); // a fronteira (review.veredito) que o pouso exige
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.sinais.percent, null);
    assert.deepEqual(r.j.acao, { tipo: 'integrar', tasks: ['T1'] });
    assert.doesNotMatch(painel(amb), /limpar a conversa/);
    // controle: medida em 55 % (teto 50) a mesma sessão pousa e o painel dela pede limpar
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
  });

  test('clear-agora-nao-no-teto-nao-solta-o-loop (r.9, C4): "agora não" no teto tira o pedido do painel, mas proxima segue em esperar (nunca despacha nem integra); +10 p.p. volta a pousar', () => {
    const amb = plano1();
    amb.aprovar('T1');
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.match(painelDa(amb, 'S1'), /agora não \(loop parado\)/);
    const pouso = amb.eventos().filter((e) => e.tipo === 'sessao.pouso').pop();
    respostaDoDono(amb, `${pouso.sessao}:${pouso.seq}`, 'agora não (loop parado, contexto em 55 %)');
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'pouso_adiado' });
    assert.doesNotMatch(painelDa(amb, 'S1'), /limpar a conversa/);
    gravarCtx(amb, 'S1', { percent: 65, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
  });

  test('clear-agora-nao-no-teto-nao-despacha-revisor (r.9, C4; review r1 MAJOR-1): adiado no teto com task concluída à espera do revisor ⇒ proxima espera, nunca despacha o revisor', () => {
    const amb = ambiente({ config: ONBOARDING, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }]) });
    amb.aprovar('T1');
    for (const a of [['abrir', 'T2'], ['iniciar', 'T2', 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
    amb.commitNaWt('T2', 'src/t2.txt');
    assert.equal(amb.cli(['concluir', 'T2']).rc, 0);
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const pouso = amb.eventos().filter((e) => e.tipo === 'sessao.pouso').pop();
    respostaDoDono(amb, `${pouso.sessao}:${pouso.seq}`, 'agora não (loop parado, contexto em 55 %)');
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'pouso_adiado' });
    // controle: sem o pedido (leitura baixa) o mesmo diário despacha o revisor da T2
    gravarCtx(amb, 'S1', { percent: 20, fonte: 'mod', em: agora() });
    const baixa = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao;
    assert.ok(baixa.tipo === 'integrar' || (baixa.tipo === 'despachar' && baixa.itens.some((i) => i.task === 'T2' && i.papel === 'revisor')), JSON.stringify(baixa));
  });

  test('pousar-manual-nao-consome-com-mod (T53, emenda 52 a; I1 por sessão): o pousar do dono grava o evento mas só a PRÓPRIA leitura da sessão decide; nenhuma outra a libera ou prende', () => {
    const amb = plano1();
    amb.aprovar('T1'); // GM-15 T35 (r.12): o pedido medido exige a fronteira
    gravarCtx(amb, 'S1', { percent: 61, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0); // grava, não recusa (a skill sem mod o usa)
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
    // a S2 (sessão paralela ou nova), baixa, decide pela PRÓPRIA leitura: despacha; a S1 segue pendente
    gravarCtx(amb, 'S2', { percent: 20, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao.tipo, 'integrar');
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    // leitura que não vale (fonte transcript) não é leitura própria: percent nulo e, desde a GM-15 T35 (r.12, D-P13), sem pedido de /clear
    gravarCtx(amb, 'S3', { percent: 20, fonte: 'transcript', em: agora() });
    assert.equal(amb.cli(['proxima', '--sessao', 'S3', '--vivos', '0']).j.acao.tipo, 'integrar');
    // o /clear do dono (sessao.inicio) com a leitura da S2 alta: só a S2 decide por si, e alta ela pousa
    inicioDe(amb, 'S2', 'clear');
    gravarCtx(amb, 'S2', { percent: 61, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao, { tipo: 'pousar' });
  });

  test('ponte-real-ler-devolve-agora (T53): a ponte que o mod executa devolve `agora` (a hora do node que escreve o ts do diário); a ponte `contexto` não existe mais', async () => {
    const { codigoPonte } = await import('../dist/pouso.js');
    const { pathToFileURL } = await import('node:url');
    const amb = plano1();
    const url = pathToFileURL(join(AQUI, '..', 'dist', 'diario.js')).href;
    const rodar = (pedido) => spawnSync(process.execPath, ['--input-type=module', '-e', codigoPonte(url)], { cwd: amb.dir, input: JSON.stringify(pedido), encoding: 'utf8' });
    const antes = Date.now();
    const j = JSON.parse(rodar({ op: 'ler', dir: amb.entregas, cwd: amb.dir }).stdout);
    assert.equal(j.ok, true);
    assert.ok(Array.isArray(j.eventos));
    assert.ok(j.agora >= antes && j.agora <= Date.now(), `agora fora da hora de parede: ${j.agora}`);
    const k = JSON.parse(rodar({ op: 'contexto', cwd: amb.dir, raiz: amb.dir, sessoes: ['S1'] }).stdout);
    assert.equal(k.ok, false); // nenhuma sessão lê o contexto de outra pela ponte
  });

  test('instalar-ignora-contexto: o .gitignore da raiz ignora .harness/contexto/', () => {
    const linhas = readFileSync(GITIGNORE_RAIZ, 'utf8').split('\n').map((l) => l.trim());
    assert.ok(linhas.includes('.harness/contexto/'));
  });
});

// ─────────────────────────────────────────────────────────────── T48 (emenda 43, FIEL-1 b/c, asserção 8): entrega publicada não recebe sessao.*, task.*, loop.parar

describe('entrega publicada: nada de sessao.*, guarda.*, task.* nem loop.parar (T48)', () => {
  const PR = (numero, estado) => ['fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'enabler/GM-10-loop' } }];
  const publicar = (amb) => amb.semear([PR(7, 'mergeado')]);
  const PLUGIN_RAIZ = join(AQUI, '..', '..');
  const configOnboarding = { ...CONFIG_PADRAO, fluxo: { resolvidoEm: '2026-11-13T00:00:00Z' } };
  const semId = (amb) => join(amb.dir, '.harness', 'entregas', '_sem-id');
  const tiposDe = (dir) => (existsSync(dir) ? diario.ler(dir).map((e) => e.tipo) : []);

  test('publicada-nao-recebe-loop.parar: parar recusa com entrega_publicada e nada é gravado', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'entrega_publicada');
    assert.equal(amb.eventos().length, antes);
    assert.deepEqual(tiposDe(semId(amb)), []);
  });

  test('publicada-nao-recebe-task.iniciada: iniciar recusa com entrega_publicada', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-recebe-task.concluida: concluir recusa com entrega_publicada', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['concluir', 'T1']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-recebe-review.veredito e task.integrada: veredito e integrar recusam com entrega_publicada', async () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    publicar(amb);
    const antes = amb.eventos().length;
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).j?.erro, 'entrega_publicada');
    assert.equal(amb.eventos().length, antes);
    const integ = amb.cli(['integrar', 'T1']);
    assert.equal(integ.j?.erro, 'entrega_publicada', integ.out + integ.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-recebe-sessao.pouso: pousar recusa com entrega_publicada', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['pousar', '--sessao', 'S1']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('identificada-continua-gravando (vizinho): sem PR medido, ou com PR aberto depois do mergeado, parar, iniciar e pousar gravam', () => {
    for (const prs of [[], [PR(7, 'mergeado'), PR(8, 'aberto')]]) {
      const amb = ambiente();
      if (prs.length > 0) amb.semear(prs);
      const pouso = amb.cli(['pousar']); // só na fronteira: antes de qualquer task em voo
      assert.equal(pouso.rc, 0, pouso.out + pouso.err);
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0, JSON.stringify(prs));
      assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
      assert.deepEqual(amb.tipos().filter((t) => t === 'task.iniciada' || t === 'sessao.pouso' || t === 'loop.parar'), ['sessao.pouso', 'task.iniciada', 'loop.parar']);
    }
  });

  test('identificada-continua-gravando (vizinho): PR mergeado sem 2º fato (sem plano.json) não é publicada; parar grava', () => {
    const amb = ambiente({ plano: null });
    amb.semear([PR(7, 'mergeado')]);
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
    assert.ok(amb.tipos().includes('loop.parar'));
  });

  test('publicada-nao-recebe-sessao.inicio: o SessionStart grava sessao.inicio e guarda.heartbeat em _sem-id; a entrega fica intacta', async () => {
    const { montarSaidaHook } = await import('../scripts/cartao-sessao.mjs');
    const amb = ambiente({ config: configOnboarding });
    publicar(amb);
    const antes = amb.eventos().length;
    const r = await montarSaidaHook({ cwd: amb.dir, pluginRoot: PLUGIN_RAIZ, agora: '2026-11-13T12:00:00Z', entradaTexto: JSON.stringify({ session_id: 'SPUB', source: 'startup' }) });
    assert.deepEqual(r.falhas, []);
    assert.equal(amb.eventos().length, antes);
    assert.deepEqual(tiposDe(semId(amb)), ['sessao.inicio', 'guarda.heartbeat']);
  });

  test('identificada-continua-gravando (vizinho): o SessionStart de entrega em curso grava sessao.inicio e guarda.heartbeat na entrega', async () => {
    const { montarSaidaHook } = await import('../scripts/cartao-sessao.mjs');
    const amb = ambiente({ config: configOnboarding });
    const antes = amb.eventos().length;
    const r = await montarSaidaHook({ cwd: amb.dir, pluginRoot: PLUGIN_RAIZ, agora: '2026-11-13T12:00:00Z', entradaTexto: JSON.stringify({ session_id: 'SCUR', source: 'startup' }) });
    assert.deepEqual(r.falhas, []);
    assert.deepEqual(amb.tipos().slice(antes), ['sessao.inicio', 'guarda.heartbeat']);
    assert.deepEqual(tiposDe(semId(amb)), []);
  });

  test('publicada-nao-abre-fifo-nem-symlink: events.*.jsonl que não é arquivo regular ⇒ false, sem travar a leitura', () => {
    const amb = ambiente();
    publicar(amb);
    const fifo = join(amb.entregas, 'events.fifo.jsonl');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { entregaPublicada } from ${JSON.stringify(join(AQUI, '..', 'dist', 'guarda.js'))}; process.stdout.write(String(entregaPublicada(${JSON.stringify(amb.dir)}, 'GM-10', null)));`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 0, `travou ou falhou: ${r.signal ?? ''} ${r.stderr}`);
    assert.equal(r.stdout, 'false');
    rmSync(fifo);
    symlinkSync('/etc/hosts', join(amb.entregas, 'events.link.jsonl'));
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', `import { entregaPublicada } from ${JSON.stringify(join(AQUI, '..', 'dist', 'guarda.js'))}; process.stdout.write(String(entregaPublicada(${JSON.stringify(amb.dir)}, 'GM-10', null)));`], { encoding: 'utf8', timeout: 5000 }).stdout, 'false');
  });

  /** O dono respondeu à pergunta (b) da conversa `sessao`: o 1º `fato.medido` dela é a âncora; `dono.resposta` liga a entrega (FIEL-1 b, REQ-TRI-1). */
  const ligarPeloDono = (amb, sessao, rotulo = 'GM-10') => {
    const w = (tipo, dados, ts) => assert.equal(diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados }).ok, true);
    w('fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-10-loop' } }, '2026-11-13T10:00:00.000Z');
    const ancora = `${sessao}:${diario.ler(amb.entregas).find((e) => e.sessao === sessao).seq}`;
    w('dono.resposta', { pergunta: ancora, opcao: 1, rotulo }, '2026-11-13T10:00:01.000Z');
  };

  test('ligada-pelo-dono-loop-nao-trava (MAJOR-1, spec:90): depois de dono.resposta, parar/iniciar/concluir/veredito/integrar gravam sem --sessao; sessão não ligada segue recusada', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    publicar(amb);
    assert.equal(amb.cli(['concluir', 'T1']).j?.erro, 'entrega_publicada', 'controle: sem ligação, publicada');
    ligarPeloDono(amb, 'SDONO');
    const r1 = amb.cli(['concluir', 'T1']);
    assert.equal(r1.rc, 0, r1.out + r1.err);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    const integ = amb.cli(['integrar', 'T1']);
    assert.equal(integ.rc, 0, integ.out + integ.err);
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
    assert.equal(amb.cli(['parar', 'nao_conseguiu', '--sessao', 'SDONO']).rc, 0);
    assert.ok(amb.tipos().includes('task.integrada'));
    // vizinho perigoso: sessão EXPLÍCITA que o dono não ligou continua recusada (o filtro que libera não fura a guarda)
    assert.equal(amb.cli(['parar', 'nao_conseguiu', '--sessao', 'OUTRA']).j?.erro, 'entrega_publicada');
    // vizinho perigoso: a resposta do dono liga OUTRA entrega ⇒ esta segue publicada
    const amb2 = ambiente();
    publicar(amb2);
    ligarPeloDono(amb2, 'SDONO', 'GM-77');
    assert.equal(amb2.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  /** Grava um `fato.medido pr` com `ts` explícito, na sessão `sessao` (a medição por outra conversa). */
  const medirPR = (amb, sessao, numero, estado, ts) => assert.equal(diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'enabler/GM-10-loop' } } }).ok, true);

  test('ligada-sobrevive-a-remedicao (MAJOR-1 r1, caso J): outra sessão medindo de novo o MESMO PR mergeado não derruba a ligação; PR NOVO mergeado sim', () => {
    const amb = ambiente();
    publicar(amb);
    ligarPeloDono(amb, 'S1');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0, 'controle: ligada');
    medirPR(amb, 'S2', 7, 'mergeado', '2026-11-13T11:00:00.000Z');
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 0, `re-medição do mesmo PR derrubou a ligação: ${r.out}${r.err}`);
    medirPR(amb, 'S3', 7, 'mergeado', '2026-11-13T11:30:00.000Z');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
    // PR NOVO mergeado depois da ligação ⇒ republicação: exige nova resposta do dono
    medirPR(amb, 'S2', 8, 'mergeado', '2026-11-13T12:00:00.000Z');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
    // e a re-medição do #8 por outra sessão não o "renova"
    medirPR(amb, 'S3', 8, 'mergeado', '2026-11-13T13:00:00.000Z');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  test('ligada-pr-nao-mergeado-nao-move-o-corte (MINOR-1 r1): fato.medido pr NÃO mergeado (fechado sem merge) posterior à ligação não derruba a ligação', () => {
    const amb = ambiente();
    publicar(amb);
    ligarPeloDono(amb, 'S1');
    // 'fechado' de número menor: a trilha segue "publicada" (último = #7 mergeado, nenhum aberto), então só o corte distingue
    medirPR(amb, 'S2', 6, 'fechado', '2026-11-13T11:00:00.000Z');
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.cli(['parar', 'nao_conseguiu', '--sessao', 'OUTRA']).j?.erro, 'entrega_publicada', 'controle: publicada de fato');
  });

  test('ligada-ts-empatado (MINOR-2 r1): resposta do dono com o MESMO ts do merge não é posterior ⇒ recusa', () => {
    const amb = ambiente();
    ligarPeloDono(amb, 'S1');
    medirPR(amb, 'S2', 7, 'mergeado', '2026-11-13T10:00:01.000Z');
    amb.fechar();
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  test('liberarTeto-recusa-em-publicada (MINOR-1): a liberação do dono não grava em entrega publicada', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = liberarTeto(amb.dir, 'T1', 'S-dono');
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'entrega_publicada', JSON.stringify(r));
    assert.equal(amb.eventos().length, antes);
    assert.deepEqual(tiposDe(semId(amb)), []);
  });

  test('liberar-sombra-recusa-em-publicada (MINOR-1): liberar --origem sombra recusa antes de qualquer leitura da decisão e nada é gravado', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['liberar', 'T1', '--origem', 'sombra', '--hash', 'abcdef123456']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('encerrada-ligada-pelo-dono-loop-recusa (GM-15 T3, REQ-ENT-1 c): entrega.encerrada + dono.resposta ⇒ sem --sessao e com --sessao da ligada, parar recusa e nada é gravado', () => {
    const amb = ambiente();
    amb.semear([['entrega.encerrada', { entrega: 'GM-10', pr: 7, via: 'head', mergeado_em: '2026-11-13T09:00:00.000Z' }]]);
    ligarPeloDono(amb, 'SDONO');
    const antes = amb.eventos().length;
    for (const extra of [[], ['--sessao', 'SDONO']]) {
      const r = amb.cli(['parar', 'nao_conseguiu', ...extra]);
      assert.equal(r.rc, 1, r.out + r.err);
      assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    }
    assert.equal(amb.eventos().length, antes);
  });

  test('regra-unica: entregaPublicada é a trilha (os 7 casos da trilha; os gravadores não têm critério próprio', async () => {
    const { entregaPublicada } = await import('../dist/guarda.js');
    const casos = [
      ['mergeado+plano', [PR(7, 'mergeado')], true, true],
      ['sem PR+plano', [], true, false],
      ['mergeado e aberto', [PR(7, 'mergeado'), PR(8, 'aberto')], true, false],
      ['aberto e depois mergeado 8, 7 aberto', [PR(7, 'aberto'), PR(8, 'mergeado')], true, false],
      ['dois mergeados', [PR(7, 'mergeado'), PR(8, 'mergeado')], true, true],
      ['mergeado sem 2º fato', [PR(7, 'mergeado')], false, false],
      ['fechado', [PR(7, 'fechado')], true, false],
    ];
    for (const [nome, prs, plano, esperado] of casos) {
      const amb = ambiente({ plano: plano ? PLANO_PADRAO : null });
      if (prs.length > 0) amb.semear(prs);
      assert.equal(entregaPublicada(amb.dir, 'GM-10', null), esperado, nome);
    }
    // o diário que liga a sessão por `dono.resposta` tira a entrega de "publicada" (REQ-TRI-1), como na trilha
    const amb = ambiente();
    amb.semear([PR(7, 'mergeado')]);
    assert.equal(entregaPublicada(amb.dir, 'GM-10', 'S1'), true);
    assert.equal(entregaPublicada(amb.dir, 'GM-99', 'S1'), false, 'entrega sem diário não é publicada');
    assert.equal(entregaPublicada(amb.dir, '../x', 'S1'), false, 'id fora da forma não é publicada');
    // nenhum gravador carrega critério próprio: a consulta é a função única de dist/guarda.js
    for (const arq of ['loop.mjs', 'stop-loop.mjs', 'cartao-sessao.mjs']) {
      const fonte = readFileSync(join(AQUI, '..', 'scripts', arq), 'utf8');
      assert.match(fonte, /entregaPublicada\(/, arq);
      assert.doesNotMatch(fonte, /trilhaDe\(|estado === 'mergeado'|estado: 'mergeado'/, `${arq} tem critério próprio de publicada`);
    }
    // o medir não decide "publicada" (decisão do dono, emenda 38: o fato.medido fica na entrega); também não carrega critério próprio
    assert.doesNotMatch(readFileSync(join(AQUI, '..', 'scripts', 'painel-medir.mjs'), 'utf8'), /trilhaDe\(|estado === 'mergeado'|estado: 'mergeado'/, 'painel-medir.mjs tem critério próprio de publicada');
    // o comportamento (não só a fonte) está em painel-medir.test.mjs: a função e o loop.mjs no mesmo diário (spec, ledger, plano, ligação por dono.resposta)
    assert.match(readFileSync(join(AQUI, '..', 'src', 'guarda.ts'), 'utf8'), /export function entregaPublicada/);
  });
});

// ─────────────────────────────────────────────────────────────── GM-14 T54: emenda aplicada no texto da spec (emenda 54)

describe('GM-14 T54: `emenda aplicar <seq>` grava spec.aplicada com os sha do diário e do disco', () => {
  const sha = (t) => createHash('sha256').update(Buffer.from(t)).digest('hex');
  const SPEC = 'docs/spec.md';
  /** Entrega com spec aprovada (A), duas emendas propostas e aprovadas pelo dono (#1 e #2). */
  async function pronto({ aprovadas = [1, 2] } = {}) {
    const { aprovarSpec, julgarEmendaDono } = await import('../scripts/loop.mjs');
    const amb = ambReq();
    const texto0 = readFileSync(join(amb.dir, SPEC), 'utf8');
    assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
    for (let i = 0; i < 2; i++) assert.equal(amb.cli(proporArgs(amb)).rc, 0);
    for (const n of aprovadas) assert.equal(julgarEmendaDono(amb.dir, n, 'aprovar', 'S-dono').ok, true);
    const editar = (texto) => writeFileSync(join(amb.dir, SPEC), texto);
    return { amb, texto0, editar, aplicadas: () => amb.eventos().filter((e) => e.tipo === 'spec.aplicada') };
  }
  const painelAguarda = async (amb) => {
    const { projetarPainel } = await import('../dist/painel.js');
    const plano = JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8'));
    const entrada = {
      decisaoEntrega: null, pausado: false, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
      pacote: { nome: 'P', lider: 'L', sabio: 'S', nomes: ['A', 'B', 'C', 'D'] }, notificacao: null, agoraMs: Date.now(), fuso: 'UTC', titulo: null,
      politica: { politica: 'continua', dias: null }, base: 'main', entregaId: 'GM-10', modeloSessao: null, specSha: sha(readFileSync(join(amb.dir, SPEC), 'utf8')), tetoSombra: 26,
    };
    return projetarPainel(plano, amb.eventos(), entrada).depende.some((d) => d.motivo === 'spec aguardando aprovação');
  };

  test('aplicada-limpa-depende: aplicar grava {seq, spec, antes, depois}; o painel deixa de pedir aprovação; edição sem emenda segue pedindo', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\nlinha da emenda 1\n`);
    assert.equal(await painelAguarda(amb), true, 'antes de aplicar a edição pede aprovação');
    const r = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(aplicadas().map((e) => e.dados), [{ seq: 1, spec: SPEC, sha256_antes: sha(texto0), sha256_depois: sha(`${texto0}\nlinha da emenda 1\n`) }]);
    assert.equal(r.j.sha256_antes, sha(texto0));
    assert.equal(await painelAguarda(amb), false, 'a cadeia aceita o sha novo');
    // edição fora de emenda aplicada continua pedindo a aprovação do dono
    editar(`${texto0}\nlinha da emenda 1\nedição solta\n`);
    assert.equal(await painelAguarda(amb), true);
  });

  test('aplicar-nenhum-sha-por-argumento: flags de sha são uso (rc 2) e nada é gravado; o sha_depois é o do disco', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\nx\n`);
    const antes = bytesDoDiario(amb);
    for (const flag of ['--sha256', '--sha256-depois', '--sha256_depois', '--sha256_antes', '--sha']) {
      const r = amb.cli(['emenda', 'aplicar', '1', flag, 'f'.repeat(64)]);
      assert.equal(r.rc, 2, `${flag}: ${r.out}`);
      assert.equal(r.j.erro, 'uso');
    }
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    assert.equal(aplicadas()[0].dados.sha256_depois, sha(`${texto0}\nx\n`));
  });

  test('aplicar-sem-aprovada-recusa: sem spec.aprovada, emenda aberta, rejeitada, inexistente ou seq torta recusam sem gravar', async () => {
    const { aprovarSpec, julgarEmendaDono } = await import('../scripts/loop.mjs');
    // sem spec aprovada (emenda aprovada, spec nunca aprovada)
    const sem = ambReq();
    assert.equal(sem.cli(proporArgs(sem)).rc, 0);
    assert.equal(julgarEmendaDono(sem.dir, 1, 'aprovar', 'S-dono').ok, true);
    writeFileSync(join(sem.dir, SPEC), 'outro\n');
    const antesSem = bytesDoDiario(sem);
    const rSem = sem.cli(['emenda', 'aplicar', '1']);
    assert.equal(rSem.rc, 1, rSem.out);
    assert.equal(rSem.j.erro, 'spec_sem_aprovacao');
    assert.deepEqual(bytesDoDiario(sem), antesSem);
    // emenda aberta, rejeitada, inexistente
    const amb = ambReq();
    assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
    assert.equal(amb.cli(proporArgs(amb)).rc, 0); // #1 aberta
    assert.equal(amb.cli(proporArgs(amb)).rc, 0); // #2 rejeitada
    assert.equal(julgarEmendaDono(amb.dir, 2, 'rejeitar', 'S-dono').ok, true);
    writeFileSync(join(amb.dir, SPEC), 'editada\n');
    const antes = bytesDoDiario(amb);
    for (const seq of ['1', '2', '9']) {
      const r = amb.cli(['emenda', 'aplicar', seq]);
      assert.equal(r.rc, 1, `seq ${seq}: ${r.out}`);
      assert.equal(r.j.erro, 'emenda_nao_aprovada', `seq ${seq}`);
    }
    for (const torta of ['0', '-1', 'x', '01', '1.5']) assert.equal(amb.cli(['emenda', 'aplicar', torta]).rc, 1, torta);
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
  });

  test('aplicar-duas-vezes-recusa: a mesma seq só aplica uma vez, mesmo com a spec editada de novo', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\numa\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    editar(`${texto0}\numa\nduas\n`);
    const antes = bytesDoDiario(amb);
    const r = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'ja_aplicada');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(aplicadas().length, 1);
  });

  test('aplicar-arquivo-igual-a-ponta-recusa: spec igual ao último sha aceito não tem o que aplicar; uma edição que cobre duas seqs aplica uma só (a outra recusa)', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    const antes0 = bytesDoDiario(amb);
    const r0 = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r0.j.erro, 'nada_a_aplicar', r0.out);
    assert.deepEqual(bytesDoDiario(amb), antes0);
    // forma declarada: 1 aplicar por seq, cadeia sem ambiguidade; a edição das duas emendas se aplica na 1ª seq, a 2ª fica "nada a aplicar" até outra edição
    editar(`${texto0}\nemenda 1 e emenda 2\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    const r2 = amb.cli(['emenda', 'aplicar', '2']);
    assert.equal(r2.j.erro, 'nada_a_aplicar', r2.out);
    assert.equal(aplicadas().length, 1);
  });

  test('aplicar-encadeia-e-aprovada-nova-reinicia: a #2 parte do sha da #1; uma aprovação nova do dono reinicia a cadeia', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, texto0, editar, aplicadas } = await pronto();
    const t1 = `${texto0}\num\n`;
    const t2 = `${t1}\ndois\n`;
    editar(t1);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    editar(t2);
    assert.equal(amb.cli(['emenda', 'aplicar', '2']).rc, 0);
    assert.deepEqual(aplicadas().map((e) => [e.dados.seq, e.dados.sha256_antes, e.dados.sha256_depois]), [[1, sha(texto0), sha(t1)], [2, sha(t1), sha(t2)]]);
    // aprovação nova com edição solta: reinicia a cadeia (a ponta é a nova aprovação)
    const t3 = `${t2}\nsolta\n`;
    editar(t3);
    assert.equal(await painelAguarda(amb), true);
    assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
    assert.equal(await painelAguarda(amb), false);
  });

  test('cadeia-quebrada-recusa: aprovação nova entre a leitura e a gravação (ponta mudou) ⇒ cadeia_quebrada, nada gravado; spec editada no meio ⇒ spec_mudou', async () => {
    const { aplicarEmenda } = await import('../scripts/loop.mjs');
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\num\n`);
    const antes = bytesDoDiario(amb);
    const injeta = () => escreve(amb, 'S-dono', 'spec.aprovada', { spec: SPEC, sha256: 'e'.repeat(64) }, new Date(Date.now() + 5000).toISOString());
    const r = aplicarEmenda(amb.dir, 1, { antes: injeta });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.erro, 'cadeia_quebrada');
    assert.equal(aplicadas().length, 0);
    assert.notDeepEqual(bytesDoDiario(amb), antes, 'só a aprovação injetada entrou');
    // spec editada entre o cálculo do sha e a gravação
    const r2 = aplicarEmenda(amb.dir, 1, { antes: () => editar(`${texto0}\noutra coisa\n`) });
    assert.equal(r2.ok, false);
    assert.ok(['spec_mudou', 'cadeia_quebrada'].includes(r2.erro), r2.erro);
    assert.equal(aplicadas().length, 0);
  });

  test('aplicar-grava-a-spec-aprovada-de-origem: o caminho vem da aprovação, não do plano; spec ilegível/ausente recusa', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    // o plano passa a apontar para outra spec: o `spec` da aplicada segue o da aprovação de origem
    mkdirSync(join(amb.dir, 'docs'), { recursive: true });
    writeFileSync(join(amb.dir, 'docs', 'outra.md'), 'outra\n');
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_REQ, spec: 'docs/outra.md' }));
    editar(`${texto0}\num\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    assert.equal(aplicadas()[0].dados.spec, SPEC);
    rmSync(join(amb.dir, SPEC));
    const r = amb.cli(['emenda', 'aplicar', '2']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'spec_ausente');
  });

  test('aprovarSpec-segue-shaAceito: (1) A, aplicada A⇒B, spec volta a A; (2) A, depois B, spec volta a A: aprovar grava e o painel limpa', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    // (1)
    const um = await pronto();
    um.editar(`${um.texto0}\nB\n`);
    assert.equal(um.amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    um.editar(um.texto0);
    assert.equal(await painelAguarda(um.amb), true);
    assert.equal(aprovarSpec(um.amb.dir, 'S-dono').ok, true);
    assert.equal(await painelAguarda(um.amb), false);
    // (2)
    const dois = await pronto();
    dois.editar(`${dois.texto0}\nB\n`);
    assert.equal(aprovarSpec(dois.amb.dir, 'S-dono').ok, true);
    dois.editar(dois.texto0);
    assert.equal(await painelAguarda(dois.amb), true);
    assert.equal(aprovarSpec(dois.amb.dir, 'S-dono').ok, true);
    assert.equal(await painelAguarda(dois.amb), false);
    assert.equal(aprovarSpec(dois.amb.dir, 'S-dono').erro, 'ja_aprovada', 'o aceito agora é A: aprovar de novo recusa');
  });

  test('regra-unica-estatica-cli: o loop.mjs importa a regra de emenda.js e não compara sha de spec por conta própria', () => {
    const t = readFileSync(join(AQUI, '..', 'scripts', 'loop.mjs'), 'utf8');
    assert.match(t, /import \{[^}]*\bvalidarAplicacao\b[^}]*\} from '\.\.\/dist\/emenda\.js'/);
    assert.match(t, /validarAplicacao\(/);
    // aprovarSpec: o `ja_aprovada` vem de shaAceito, não de varredura própria por spec.aprovada com o sha atual
    const apr = t.slice(t.indexOf('export function aprovarSpec'), t.indexOf('/** `parar` é o registro'));
    assert.match(apr, /shaAceito\(eventos, atual\.sha256\)/);
    assert.doesNotMatch(apr, /if \(antesN > 0\)/);
  });
});

// ═══════════════════════════════════════════════════════════════ GM-15 T6: adiar, cortar e reabrir pela Sombra (REQ-ENT-2, condição 1)
// MUTAÇÕES PRESCRITAS: M6a --origem dono aceito em adiar · M6b idem em cortar · M6c idem em reabrir · M6d Sombra sem --fonte aceita · M6e reabrir --origem sombra sem julga_emendas.

describe('GM-15 T6: adiar, cortar e reabrir (a Sombra, com fonte; o dono só pelo hook)', () => {
  const COM_JULGA = { sombra: { julga_emendas: true } };
  const fora = (cmd, t, extra = {}) => [cmd, t, ...Object.entries({ motivo: 'adiada por teste', origem: 'sombra', fonte: 'decisao.sombra 1', ...extra }).flatMap(([k, v]) => (v === undefined ? [] : [`--${k}`, v]))];
  const foraDoDiario = (amb) => amb.eventos().filter((e) => e.tipo === 'task.fora');
  const estadoDe = (amb, t) => {
    const ord = ordenarNucleo(amb.eventos());
    return estadoNucleo(ord.eventos.filter((e) => e.dados?.task === t && /^(task|review)\./.test(e.tipo)));
  };
  const ambJulga = () => { const amb = ambReq(); comOrigin(amb, COM_JULGA); return amb; };

  test('cortar-com-dependente-recusa: T3 depende de T1 e não está fora ⇒ recusa listando T3; nada gravado; fora o dependente, passa', () => {
    const amb = ambJulga();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(fora('cortar', 'T1'));
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'dependentes_nao_fora');
    assert.deepEqual(r.j.dependentes, ['T3']);
    assert.match(r.j.mensagem, /T3/);
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.cli(fora('adiar', 'T1')).j.erro, 'dependentes_nao_fora', 'adiar recusa igual');
    // o dependente sai primeiro (adiada): agora T1 pode ser cortada
    assert.equal(amb.cli(fora('adiar', 'T3')).rc, 0);
    const ok = amb.cli(fora('cortar', 'T1'));
    assert.equal(ok.rc, 0, ok.out);
    assert.equal(estadoDe(amb, 'T1').estado, 'cortada');
    assert.equal(estadoDe(amb, 'T3').estado, 'adiada');
  });

  test('cortar-sombra-sem-fonte-recusa: sem --fonte (ou com fonte vazia) é uso e não grava', () => {
    const amb = ambJulga();
    const antes = bytesDoDiario(amb);
    for (const cmd of ['cortar', 'adiar']) {
      const r = amb.cli(fora(cmd, 'T2', { fonte: undefined }));
      assert.equal(r.rc, 2, cmd);
      assert.match(r.j.mensagem, /fonte/);
      assert.notEqual(amb.cli(fora(cmd, 'T2', { fonte: '  ' })).rc, 0, `${cmd} fonte em branco`);
      assert.equal(amb.cli(fora(cmd, 'T2', { motivo: undefined })).rc, 2, `${cmd} sem motivo`);
      assert.equal(amb.cli(fora(cmd, 'T2', { origem: undefined })).rc, 2, `${cmd} sem origem`);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('cortar-sombra-sem-julga-emendas-recusa: sem a opção em origin/HEAD (ausente, falsa, string ou só no config local) a Sombra não corta nem adia', () => {
    for (const preparar of [() => ({ amb: ambReq() }), () => ({ amb: (() => { const a = ambReq(); comOrigin(a, { sombra: { julga_emendas: 'true' } }); return a; })() }),
      () => ({ amb: ambReq({ config: { ...CONFIG_PADRAO, sombra: { julga_emendas: true } } }) })]) {
      const { amb } = preparar();
      const antes = bytesDoDiario(amb);
      for (const cmd of ['cortar', 'adiar']) {
        const r = amb.cli(fora(cmd, 'T2'));
        assert.equal(r.rc, 1, `${cmd} ${r.out}`);
        assert.equal(r.j.erro, 'julga_emendas_desligado');
      }
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
  });

  test('adiar-sombra-grava-task-fora: grava task.fora com task, como, motivo, origem e fonte; a task sai do alvo', () => {
    const amb = ambJulga();
    const r = amb.cli(fora('adiar', 'T2', { motivo: 'fica para a 2.1.1', fonte: 'decisao.sombra 7' }));
    assert.equal(r.rc, 0, r.out);
    const e = foraDoDiario(amb);
    assert.equal(e.length, 1);
    assert.deepEqual(e[0].dados, { task: 'T2', como: 'adiada', motivo: 'fica para a 2.1.1', origem: 'sombra', fonte: 'decisao.sombra 7' });
    assert.equal(estadoDe(amb, 'T2').estado, 'adiada');
    const c = amb.cli(fora('cortar', 'T2'));
    assert.equal(c.rc, 1, 'terminal: adiada não vira cortada sem reabrir');
    assert.equal(c.j.erro, 'task_nao_pode_sair');
    // cortar grava como: cortada
    assert.equal(amb.cli(fora('cortar', 'T3', { motivo: 'sem valor' })).rc, 0);
    assert.equal(foraDoDiario(amb).at(-1).dados.como, 'cortada');
  });

  test('fora-em-voo-e-integrada-recusa: agente em voo ou task integrada não sai do alvo; nada gravado', () => {
    const amb = ambJulga();
    amb.semear([['task.iniciada', { task: 'T2', papel: 'implementador' }], ...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1')].filter((x, i) => i !== 1 || true));
    const antes = bytesDoDiario(amb);
    for (const t of ['T2', 'T1']) {
      const r = amb.cli(fora('adiar', t));
      assert.equal(r.rc, 1, `${t} ${r.out}`);
      assert.equal(r.j.erro, 'task_nao_pode_sair');
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('reabrir-sombra-exige-julga-e-fonte: de fora volta a pendente rodada 0 só com origem sombra, julga_emendas em origin e --fonte', () => {
    const amb = ambReq();
    amb.semear([['task.fora', { task: 'T2', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    const sem = amb.cli(['reabrir', 'T2', '--origem', 'sombra']);
    assert.equal(sem.rc, 2, 'sem --fonte');
    assert.match(sem.j.mensagem, /fonte/);
    const semJulga = amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'decisao.sombra 9']);
    assert.equal(semJulga.rc, 1);
    assert.equal(semJulga.j.erro, 'julga_emendas_desligado');
    assert.deepEqual(bytesDoDiario(amb), antes);
    comOrigin(amb, COM_JULGA);
    const ok = amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'decisao.sombra 9']);
    assert.equal(ok.rc, 0, ok.out);
    const e = amb.eventos().filter((x) => x.tipo === 'task.reaberta').at(-1);
    assert.deepEqual(e.dados, { task: 'T2', origem: 'sombra', fonte: 'decisao.sombra 9', de: 'fora' });
    assert.deepEqual(estadoDe(amb, 'T2'), { estado: 'pendente', rodada: 0 });
  });

  test('reabrir-sombra-de-task-nao-fora-recusa: reabrir --origem sombra numa task que não está fora não grava', () => {
    const amb = ambJulga();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'f']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('reabrir-sem-origem-segue-retomada: o reabrir da 2.0 não muda (origem retomada, sem fonte nem de)', () => {
    const amb = ambReq();
    amb.semear([...IMPL_E('T2')]);
    const r = amb.cli(['reabrir', 'T2']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.reaberta').at(-1).dados, { task: 'T2', origem: 'retomada' });
    assert.equal(amb.cli(['reabrir', 'T2', '--origem', 'retomada']).rc, 2, 'retomada é o padrão sem flag, não um valor');
    assert.equal(amb.cli(['reabrir', 'T2', '--fonte', 'x']).rc, 2, '--fonte sem --origem sombra é uso');
  });

  test('cli-origem-dono-recusa: --origem dono em adiar, cortar e reabrir é uso (rc 2) e o diário fica byte a byte igual', () => {
    const amb = ambJulga();
    amb.semear([['task.fora', { task: 'T2', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    for (const a of [fora('adiar', 'T3', { origem: 'dono' }), fora('cortar', 'T3', { origem: 'dono' }), ['reabrir', 'T2', '--origem', 'dono', '--fonte', 'f'], ['reabrir', 'T2', '--origem', 'dono'],
      fora('adiar', 'T3', { origem: 'qualquer' }), ['reabrir', 'T2', '--origem', 'qualquer', '--fonte', 'f']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 2, a.join(' '));
      assert.equal(r.j.erro, 'uso');
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('cli-nenhum-subcomando-grava-dono: varre todo ESPEC com --origem dono; nenhum grava evento de origem dono', async () => {
    const { ESPEC_DO_CLI } = await import('../scripts/loop.mjs');
    const cmds = Object.keys(ESPEC_DO_CLI);
    assert.ok(cmds.includes('adiar') && cmds.includes('cortar') && cmds.includes('reabrir') && cmds.includes('liberar'));
    const amb = ambJulga();
    amb.semear([['task.fora', { task: 'T2', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    for (const cmd of cmds) {
      const esp = ESPEC_DO_CLI[cmd];
      const pos = Array.from({ length: esp.pos ?? 0 }, () => 'T2');
      const flags = (esp.obrig ?? []).filter((f) => f !== 'origem').flatMap((f) => [`--${f}`, 'x']);
      const r = amb.cli([cmd, ...pos, ...flags, '--origem', 'dono', '--fonte', 'x', '--hash', 'a'.repeat(64)].filter((_, i, v) => (esp.flags.includes('fonte') || v[i] !== '--fonte' && v[i - 1] !== '--fonte') && (esp.flags.includes('hash') || v[i] !== '--hash' && v[i - 1] !== '--hash')));
      assert.equal(r.rc, 2, `${cmd}: ${r.out}`);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.eventos().some((e) => e.dados?.origem === 'dono'), false);
  });

  test('fora-dono-e-reabrir-dono-so-em-processo: foraDono e reabrirDono gravam origem dono, recusam dependente e ficam fora de ESPEC', async () => {
    const { foraDono, reabrirDono, ESPEC_DO_CLI } = await import('../scripts/loop.mjs');
    assert.equal(Object.keys(ESPEC_DO_CLI).some((k) => /dono/i.test(k)), false);
    const amb = ambReq(); // sem julga_emendas: o dono não depende dele
    const recusa = foraDono(amb.dir, 'T1', 'cortada', 'sem valor', 'S-dono');
    assert.equal(recusa.ok, false);
    assert.equal(recusa.erro, 'dependentes_nao_fora');
    assert.deepEqual(recusa.dependentes, ['T3']);
    assert.equal(foraDono(amb.dir, 'T3', 'adiada', 'fica para depois', 'S-dono').ok, true);
    const e = foraDoDiario(amb).at(-1);
    assert.deepEqual(e.dados, { task: 'T3', como: 'adiada', motivo: 'fica para depois', origem: 'dono' });
    assert.equal(e.sessao, 'S-dono');
    assert.equal(foraDono(amb.dir, 'T9', 'adiada', 'm', 'S-dono').erro, 'task_fora_do_plano');
    assert.equal(foraDono(amb.dir, 'T2', 'talvez', 'm', 'S-dono').erro, 'argumento_invalido');
    assert.equal(reabrirDono(amb.dir, 'T2', 'S-dono').ok, false, 'T2 não está fora');
    const r = reabrirDono(amb.dir, 'T3', 'S-dono');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(amb.eventos().filter((x) => x.tipo === 'task.reaberta').at(-1).dados, { task: 'T3', origem: 'dono', fonte: 'comando do dono', de: 'fora' });
    assert.deepEqual(estadoDe(amb, 'T3'), { estado: 'pendente', rodada: 0 });
  });

  test('lista-de-tipos-de-task-e-a-do-nucleo: o loop.mjs importa TIPOS_DE_TASK de dist/loop.js e não repete a lista', () => {
    const t = readFileSync(join(AQUI, '..', 'scripts', 'loop.mjs'), 'utf8');
    assert.match(t, /import \{[^}]*\bTIPOS_DE_TASK\b[^}]*\} from '\.\.\/dist\/loop\.js'/);
    assert.doesNotMatch(t, /^const TIPOS_DE_TASK = \[/m);
    assert.match(t, /foraPermitido\(/);
  });

  test('adiar-conta-no-estado-da-task: depois do adiar o proxima já não despacha a task e a reabertura a devolve', () => {
    const amb = ambJulga();
    assert.equal(amb.cli(fora('adiar', 'T2')).rc, 0);
    const p = amb.cli(['proxima']);
    assert.equal(p.rc, 0, p.out);
    assert.doesNotMatch(JSON.stringify(p.j), /"task":"T2"/);
    assert.equal(amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'f']).rc, 0);
    assert.match(JSON.stringify(amb.cli(['proxima']).j), /T2/);
  });
});

describe('GM-15 T35 (r.10, C5): o orquestrador fecha só a própria pendência', () => {
  const ambT = () => ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });
  const gravar = (amb, sessao, agente, tipo, dados) => {
    const ultimo = Math.max(0, ...amb.eventos().map((e) => Date.parse(e.ts)));
    const r = diario.append(amb.entregas, sessao, { ts: new Date(Math.max(ultimo + 1000, Date.now())).toISOString(), autor: 't@t', sessao, agente, tipo, dados });
    assert.ok(r.ok, JSON.stringify(r));
    const e = amb.eventos().filter((x) => x.sessao === sessao).pop();
    return `${e.sessao}:${e.seq}`;
  };
  const respostas = (amb) => amb.eventos().filter((e) => e.tipo === 'dono.resposta');

  test('orquestrador-fecha-propria-pendencia: nota pendencia do orquestrador (antiga) ⇒ anotar --fechar grava "feito" e ela fecha; 2ª vez recusa', () => {
    const amb = ambT();
    const id = gravar(amb, 'loop', 'orquestrador', 'nota', { tipo: 'pendencia', texto: 'lembrar de medir o bench' });
    const r = amb.cli(['anotar', '--fechar', id]);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(respostas(amb).map((e) => e.dados), [{ pergunta: id, opcao: 1, rotulo: 'feito' }]);
    const de_novo = amb.cli(['anotar', '--fechar', id]);
    assert.equal(de_novo.rc, 1);
    assert.equal(de_novo.j.erro, 'nao_e_pendencia_aberta_do_orquestrador');
    assert.equal(respostas(amb).length, 1);
  });

  test('proxima-nao-espera-adiada (r.14, C4): dúvida do dono adiada ("agora não") não trava: proxima despacha o que é permitido', () => {
    // Guarda de REGRESSÃO (review r1 MINOR-1): o núcleo de `proxima` não lê perguntas nem respostas do dono, então não há sítio de mutação "esperar
    // item adiado" hoje. A prova é estrutural (abaixo) e por controle: com a dúvida ABERTA a ação é a mesma. Se alguém fizer o núcleo ler perguntas,
    // a asserção estrutural cai e este teste passa a exigir que o adiado não trave.
    const amb = ambT();
    const id = gravar(amb, 'loop', 'orquestrador', 'nota', { tipo: 'duvida', texto: 'qual caminho?', opcoes: ['a', 'b'] });
    const aberta = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(aberta.rc, 0, aberta.out + aberta.err);
    gravar(amb, 'dono', 'orquestrador', 'dono.resposta', { pergunta: id, rotulo: 'agora não' });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'despachar', JSON.stringify(r.j.acao));
    assert.deepEqual(r.j.acao.itens.map((i) => `${i.task} ${i.papel}`), ['T1 implementador']);
    assert.deepEqual(r.j.acao, aberta.j.acao, 'dúvida aberta ou adiada: a mesma ação');
    for (const f of ['loop.ts', 'pendencias.ts']) {
      const fonte = readFileSync(join(AQUI, '..', 'src', f), 'utf8');
      assert.doesNotMatch(fonte, /from '\.\/(perguntas|depende)\.ts'|'dono\.resposta'|tipo === 'nota'/, `${f}: o núcleo de proxima passou a ler perguntas; o adiado não pode travar (r.14)`);
    }
  });

  test('orquestrador-nao-fecha-item-do-dono: pendência de outro autor, dúvida, emenda, pouso e id inexistente recusam sem gravar', () => {
    const amb = ambT();
    const ids = [
      gravar(amb, 'loop', 'dono', 'nota', { tipo: 'pendencia', texto: 'renovar o domínio' }),
      gravar(amb, 'loop', 'orquestrador', 'nota', { tipo: 'duvida', texto: 'qual?', opcoes: ['a', 'b'] }),
      gravar(amb, 'S1', 'orquestrador', 'sessao.pouso', { percent: 55, x: 50, via: 'dono' }),
      'loop:999',
    ];
    for (const id of ids) {
      const r = amb.cli(['anotar', '--fechar', id]);
      assert.equal(r.rc, 1, `${id}: ${r.out}`);
      assert.equal(r.j.erro, 'nao_e_pendencia_aberta_do_orquestrador', id);
    }
    assert.equal(respostas(amb).length, 0);
    assert.equal(amb.cli(['anotar', '--fechar', 'nao-e-id']).rc, 2, 'id fora da forma é uso');
    assert.equal(amb.cli(['anotar', '--fechar', 'loop:1', '--tipo', 'pendencia']).rc, 2, '--fechar não se mistura com --tipo/--texto');
  });
});

// ═══════════════════════════════════════════════════════════════ GM-15 T13: o lote do dono no `proxima` (REQ-AUT-1) e Sombra sem fonte ⇒ dono (REQ-ENT-2)
// MUTAÇÕES: M13a omitir `next ⇒ main` no fim ⇒ lote-do-dono-unico-cli · M13b DEPENDE com lista diferente do proxima ⇒ lote-igual-no-depende-cli
// · M13c a config de origin não chega ao lote (lê local) ⇒ lote-le-origin · M13d recusa sem fonte sem item do dono ⇒ sem-fonte-vira-item-do-dono.
describe('GM-15 T13: lote do dono no proxima', () => {
  const NO_TETO_E = (t) => [
    ['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: 'a'.repeat(40) }],
    ['task.iniciada', { task: t, papel: 'revisor' }], ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }],
    ['task.iniciada', { task: t, papel: 'correcao' }], ['task.concluida', { task: t, sha: 'b'.repeat(40) }],
    ['task.iniciada', { task: t, papel: 'revisor' }], ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
  ];
  const DESLIGADA = { entrega: { base: 'next', autonomia: false }, sombra: { julga_emendas: false, libera_teto: false } };
  const MOTIVOS_4 = ['decidir a T2: chegou ao limite de revisões', 'decidir a emenda 1', 'atualizar o plugin: o diário tem evento de uma versão mais nova', 'no fim da entrega: levar next para main'];
  const montar = (cfgOrigin, { config } = {}) => {
    const amb = ambReq(config ? { config } : {});
    if (cfgOrigin !== null) comOrigin(amb, cfgOrigin);
    amb.semear([...NO_TETO_E('T2'), ['evento.do.futuro', { x: 1 }]]);
    // a proposta é do REQ da T2 (já no teto): T1 segue livre e o núcleo despacha
    grava(amb, relogioDe(), [['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1' })]]);
    return amb;
  };

  test('lote-do-dono-unico-cli: os 4 previsíveis num proxima só, na ordem, com os comandos; a ação do núcleo segue (T1 despacha)', () => {
    const amb = montar(DESLIGADA);
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.lote.map((i) => i.motivo), MOTIVOS_4);
    assert.equal(r.j.lote[0].acoes[0].comando, '/gabarito-mestre:liberar T2');
    assert.equal(r.j.lote.at(-1).motivo, 'no fim da entrega: levar next para main', 'next ⇒ main é o último');
    assert.deepEqual(r.j.acao.itens?.map((i) => i.task), ['T1'], `o lote não para o loop: ${JSON.stringify(r.j.acao)}`);
  });

  test('lote-le-origin: a Sombra ligada e a autonomia de entrega em origin/HEAD esvaziam o lote (fica só o plugin atrás); o config local não conta', () => {
    const lig = montar({ entrega: { base: 'next', autonomia: true }, sombra: { julga_emendas: true, libera_teto: true } }).cli(['proxima']);
    assert.equal(lig.rc, 0, lig.out);
    assert.deepEqual(lig.j.lote.map((i) => i.motivo), ['atualizar o plugin: o diário tem evento de uma versão mais nova']);
    const soLocal = montar(null, { config: { ...CONFIG_PADRAO, entrega: { base: 'next', autonomia: true }, sombra: { julga_emendas: true, libera_teto: true } } }).cli(['proxima']);
    assert.deepEqual(soLocal.j.lote.map((i) => i.motivo), ['decidir a T2: chegou ao limite de revisões', 'decidir a emenda 1', 'atualizar o plugin: o diário tem evento de uma versão mais nova'],
      'sem origin: Sombra desligada e base main (sem next ⇒ main)');
  });

  test('lote-vazio-sem-item-cli: sem nada previsível o proxima devolve lote vazio', () => {
    const amb = ambReq();
    comOrigin(amb, { entrega: { base: 'main' } });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.lote, []);
  });

  test('lote-igual-no-depende-cli: o DEPENDE montado com o lote do proxima tem os mesmos itens, na mesma ordem', async () => {
    const { dependeDe } = await import('../dist/depende.js');
    const amb = montar(DESLIGADA);
    const r = amb.cli(['proxima']);
    const dep = dependeDe({ entrega: 'GM-10', identificada: true, marcas: [], mudouDepois: false }, amb.eventos(), [], { falhou: [] }, false, { branch: null, idPadrao: '[A-Z]+-\\d+' }, r.j.lote);
    const i = dep.findIndex((x) => x.motivo === r.j.lote[0].motivo);
    assert.deepEqual(dep.slice(i, i + r.j.lote.length), r.j.lote);
    assert.equal(dep.length, r.j.lote.length, 'nada mais neste diário');
  });

  test('sem-fonte-vira-item-do-dono: adiar, cortar e reabrir pela Sombra sem --fonte recusam (rc 2, nada gravado) e devolvem o item do dono com o comando humano', () => {
    const amb = ambReq();
    comOrigin(amb, { sombra: { julga_emendas: true } });
    amb.semear([['task.fora', { task: 'T3', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    for (const [args, cmd] of [[['adiar', 'T2', '--motivo', 'm', '--origem', 'sombra'], 'adiar'], [['cortar', 'T2', '--motivo', 'm', '--origem', 'sombra'], 'cortar'],
      [['reabrir', 'T3', '--origem', 'sombra'], 'reabrir'], [['adiar', 'T2', '--motivo', 'm', '--origem', 'sombra', '--fonte', '  '], 'adiar']]) {
      const r = amb.cli(args);
      assert.notEqual(r.rc, 0, args.join(' '));
      assert.match(r.j.mensagem, /fonte/);
      assert.equal(r.j.item_do_dono.nivel, 'dono', args.join(' '));
      assert.deepEqual(r.j.item_do_dono.acoes, [{ rotulo: cmd, comando: `/gabarito-mestre:${cmd} ${args[1]}` }]);
    }
    assert.equal(amb.cli(['adiar', 'T2', '--motivo', 'm', '--origem', 'sombra']).rc, 2, 'segue uso');
    assert.equal(amb.cli(['adiar', 'T2', '--motivo', 'm']).j.item_do_dono, undefined, 'sem --origem sombra não é a Sombra: só uso');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });
});

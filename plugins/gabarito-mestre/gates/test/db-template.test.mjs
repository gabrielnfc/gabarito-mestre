/**
 * REQ-DB-1 — banco por worktree (db-template.mjs).
 *
 * `db.psql` aponta para um psql FALSO que grava o argv exato de cada chamada e simula só o que o
 * script emite (CREATE/DROP/ALTER/COMMENT/SELECT em pg_database). SQL fora do que o script conhece
 * sai 3: mudar a forma do SQL sem o teste acompanhar derruba a suíte. O Postgres de verdade é provado
 * fora da suíte (relatório da task).
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte): task-4-mut.json.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  nomeBanco, nomeTemporario, marcaClone, marcaPronto, validarDb, bancosVivos, ident, HOSTS_LOCAIS,
} from '../scripts/db-template.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'db-template.mjs');

const FAKE_PSQL = String.raw`
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const argv = process.argv.slice(2);
const ESTADO = process.env.FAKE_STATE, LOG = process.env.FAKE_LOG;
appendFileSync(LOG, JSON.stringify({ quem: 'psql', argv, title: process.title, pg: Object.keys(process.env).filter((k) => /^PG/i.test(k)) }) + '\n');
const sql = argv[argv.indexOf('-c') + 1];
const st = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { dbs: { postgres: {}, template0: {}, template1: {} } };
const salvar = () => writeFileSync(ESTADO, JSON.stringify(st));
const erro = (m, c = 1) => { process.stderr.write(m + '\n'); process.exit(c); };
if (process.env.FAKE_FAIL && new RegExp(process.env.FAKE_FAIL).test(sql)) erro('ERROR: falha injetada');
const Q = '"((?:[^"]|"")*)"', L = "'((?:[^']|'')*)'";
const un = (s) => s.replaceAll('""', '"').replaceAll("''", "'");
let m;
if ((m = new RegExp("^SELECT 'E:' \\|\\| coalesce\\(shobj_description\\(oid, 'pg_database'\\), ''\\) FROM pg_database WHERE datname = " + L + "$").exec(sql))) {
  const d = st.dbs[un(m[1])];
  process.stdout.write(d ? 'E:' + (d.comment ?? '') + '\n' : '');
} else if (sql === 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user') {
  process.stdout.write((process.env.FAKE_SUPER === '1' ? 't' : 'f') + '\n');
} else if ((m = new RegExp('^CREATE DATABASE ' + Q + '(?: TEMPLATE ' + Q + ')?$').exec(sql))) {
  const nome = un(m[1]), tpl = m[2] === undefined ? null : un(m[2]);
  if (st.dbs[nome]) erro('ERROR: database "' + nome + '" already exists');
  if (tpl) {
    if (!st.dbs[tpl]) erro('ERROR: template database "' + tpl + '" does not exist');
    if (process.env.FAKE_SUPER !== '1' && !st.dbs[tpl].template) erro('ERROR: permission denied to copy database "' + tpl + '"');
    if (st.dbs[tpl].sessoes) erro('ERROR: source database "' + tpl + '" is being accessed by other users');
  }
  st.dbs[nome] = {}; salvar();
} else if ((m = new RegExp('^COMMENT ON DATABASE ' + Q + ' IS ' + L + '$').exec(sql))) {
  const d = st.dbs[un(m[1])]; if (!d) erro('ERROR: database does not exist');
  d.comment = un(m[2]); salvar();
} else if ((m = new RegExp('^ALTER DATABASE ' + Q + ' WITH ALLOW_CONNECTIONS (true|false)$').exec(sql))) {
  const d = st.dbs[un(m[1])]; if (!d) erro('ERROR: database does not exist');
  d.allow = m[2] === 'true'; salvar();
} else if ((m = new RegExp('^ALTER DATABASE ' + Q + ' WITH IS_TEMPLATE (true|false)$').exec(sql))) {
  const d = st.dbs[un(m[1])]; if (!d) erro('ERROR: database does not exist');
  d.template = m[2] === 'true'; salvar();
} else if ((m = new RegExp('^DROP DATABASE IF EXISTS ' + Q + ' WITH \\(FORCE\\)$').exec(sql))) {
  const nome = un(m[1]); const d = st.dbs[nome];
  if (d) { if (d.template) erro('ERROR: cannot drop a template database'); delete st.dbs[nome]; salvar(); }
} else if ((m = new RegExp('^ALTER DATABASE ' + Q + ' RENAME TO ' + Q + '$').exec(sql))) {
  const de = un(m[1]), para = un(m[2]);
  if (process.env.FAKE_RACE && !st.dbs[para]) { st.dbs[para] = { comment: JSON.parse(process.env.FAKE_RACE).comment, allow: false, template: true }; salvar(); }
  if (!st.dbs[de]) erro('ERROR: database does not exist');
  if (st.dbs[para]) erro('ERROR: database "' + para + '" already exists');
  st.dbs[para] = st.dbs[de]; delete st.dbs[de]; salvar();
} else if ((m = new RegExp("^SELECT datname FROM pg_database WHERE datname LIKE " + L + " ESCAPE '\\\\'(?: AND shobj_description\\(oid, 'pg_database'\\) LIKE " + L + " ESCAPE '\\\\')? ORDER BY datname$").exec(sql))) {
  const like = (pad) => {
    let re = '^';
    for (let i = 0; i < pad.length; i++) {
      const c = pad[i];
      if (c === '\\') { re += pad[++i].replace(/[.*+?^$()|[\]{}\\]/g, '\\$&'); }
      else if (c === '%') re += '.*'; else if (c === '_') re += '.';
      else re += c.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
    }
    return new RegExp(re + '$');
  };
  const r1 = like(un(m[1])), r2 = m[2] === undefined ? null : like(un(m[2]));
  const nomes = Object.keys(st.dbs).filter((n) => r1.test(n) && (!r2 || r2.test(st.dbs[n].comment ?? ''))).sort();
  const extra = process.env.FAKE_EXTRA ? JSON.parse(process.env.FAKE_EXTRA) : [];
  process.stdout.write([...nomes, ...extra].join('\n') + '\n');
} else erro('fake: SQL desconhecido: ' + sql, 3);
`;

const FAKE_MIGRAR = String.raw`
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ quem: 'migrar', argv: process.argv.slice(2), env: process.env.GABARITO_DB, pg: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^PG/i.test(k))) }) + '\n');
if (process.argv[3] === 'falha') { process.stderr.write('ERROR: migração quebrou\nLINE 1: SELECT x\n                ^\n'); process.exit(1); }
`;

/** Projeto temporário com fake psql (`bin/psql`: o basename é o que a validação exige), fake migrar e config. */
function projeto(db = {}, { semDb = false, git = false, semConfig = false, config } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbt-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'package.json'), '{"type":"module"}');
  const psql = join(bin, 'psql'), migrar = join(dir, 'fake-migrar.mjs');
  writeFileSync(psql, FAKE_PSQL);
  writeFileSync(migrar, FAKE_MIGRAR);
  const cfg = semDb ? {} : { db: { psql: [process.execPath, psql], template: 'gm_tpl', migrar: [process.execPath, migrar, '{db}'], ...db } };
  if (!semConfig) writeFileSync(join(dir, 'harness.config.json'), config ?? JSON.stringify(cfg));
  const estado = join(dir, 'estado.json'), log = join(dir, 'log.jsonl');
  writeFileSync(log, '');
  const env = { ...process.env, FAKE_STATE: estado, FAKE_LOG: log };
  delete env['GABARITO' + '_ALLOW'];
  for (const k of Object.keys(env)) if (/^PG/i.test(k)) delete env[k];
  if (git) { gitEm(dir)('init', '-q', '-b', 'main'); gitEm(dir)('commit', '-q', '--allow-empty', '-m', 'x'); }
  const rodar = (args, extra = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...env, ...extra } });
  const prep = (sessao = 'S1', extra = {}) => rodar(['preparar', '--sessao', sessao], extra);
  const chamadas = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const sqls = () => chamadas().filter((c) => c.quem === 'psql').map((c) => c.argv[c.argv.indexOf('-c') + 1]);
  const bancos = () => (existsSync(estado) ? JSON.parse(readFileSync(estado, 'utf8')).dbs : null);
  const temporarios = () => sqls().map((q) => /^CREATE DATABASE "(gm_prep_[^"]+)"$/.exec(q)?.[1]).filter(Boolean);
  return { dir, rodar, prep, chamadas, sqls, bancos, temporarios, estado, migrarJs: migrar, psqlJs: psql, env };
}

const gitEm = (cwd) => (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const SO_SISTEMA = ['postgres', 'template0', 'template1'];

describe('nome do banco', () => {
  test('nome-banco-normaliza', () => {
    assert.equal(nomeBanco('GM-10', 'T-1'), 'gm_gm10_t1');
    assert.equal(nomeBanco('GM-10', 'T1'), 'gm_gm10_t1'); // contrato do plano; quem separa é a marca gravada no banco
    assert.equal(nomeBanco('gm10', 'T_1'), 'gm_gm10_t1');
    const longo = nomeBanco('E'.repeat(70), 'T'.repeat(70));
    assert.ok(Buffer.byteLength(longo) <= 63, longo);
    assert.match(longo, /^gm_[a-z0-9]+_[a-z0-9]+$/);
  });

  test('nome-banco-longo-nao-colide-pelo-fim', () => {
    const a = nomeBanco('GM-10', 'x'.repeat(69) + 'a');
    const b = nomeBanco('GM-10', 'x'.repeat(69) + 'b');
    assert.notEqual(a, b);
    const c = nomeBanco('e'.repeat(60) + 'a', 't1');
    const d = nomeBanco('e'.repeat(60) + 'b', 't1');
    assert.notEqual(c, d);
    for (const n of [a, b, c, d]) assert.ok(Buffer.byteLength(n) <= 63);
  });

  test('nome-banco-id-hostil-nao-escapa', () => {
    const n = nomeBanco('GM-10', 'a"; DROP DATABASE x; --');
    assert.match(n, /^gm_gm10_[a-z0-9]+$/);
    assert.equal(ident('a"b'), '"a""b"');
  });

  test('nome-banco-id-vazio-ou-nao-texto-lanca', () => {
    for (const ruim of ['', '---', '  ', 42, null, undefined]) assert.throws(() => nomeBanco('GM-10', ruim), /inválido/);
    assert.throws(() => nomeBanco('', 't1'), /inválido/);
  });

  test('marca-do-clone-separa-t-1-de-t1-e-entregas-irmas', () => {
    assert.notEqual(marcaClone('GM-10', 'T-1'), marcaClone('GM-10', 'T1'));
    assert.equal(marcaClone('GM-10', 'T1'), marcaClone('GM-10', 'T1'));
    assert.notEqual(marcaClone('GM-1', '0T'), marcaClone('GM-10', 'T')); // separador não deixa fundir os ids
    assert.notEqual(marcaClone('GM10', 'T1'), marcaClone('GM-10', 'T1')); // entrega exata, não normalizada
  });

  test('marca-pronta-carrega-a-sessao-em-hash', () => {
    assert.notEqual(marcaPronto('S1'), marcaPronto('S2'));
    assert.equal(marcaPronto('S1'), marcaPronto('S1'));
    assert.match(marcaPronto("x'; DROP DATABASE y; --"), /^gm-e2:template:pronto:[0-9a-f]{16}$/);
  });
});

describe('validação de config', () => {
  const base = { psql: ['docker', 'exec', 'c', 'psql'], template: 'gm_tpl', migrar: ['x'] };

  test('recusa-template-postgres', () => {
    for (const t of ['postgres', 'POSTGRES', 'Template0', 'TEMPLATE1', ' postgres ', 'template1']) {
      const v = validarDb({ db: { ...base, template: t } });
      assert.equal(v.ok, false, t);
      assert.match(v.erro, /banco do sistema/);
    }
    assert.equal(validarDb({ db: base }).ok, true);
  });

  test('recusa-template-com-prefixo-de-preparo', () => {
    for (const t of ['gm_prep_1_abcdef012345', 'GM_PREP_x']) {
      const v = validarDb({ db: { ...base, template: t } });
      assert.equal(v.ok, false, t);
      assert.match(v.erro, /reservado/);
    }
  });

  test('recusa-host-remoto', () => {
    for (const h of ['db.prod.exemplo.com', 'localhost.evil.com', '127.0.0.1.nip.io', 'evil.com/127.0.0.1', '127.0.0.1 ', 'LOCALHOST', '0.0.0.0', '', 7, null, ['localhost']]) {
      assert.equal(validarDb({ db: { ...base, host: h } }).ok, false, `[${h}]`);
    }
    for (const h of HOSTS_LOCAIS) assert.equal(validarDb({ db: { ...base, host: h } }).ok, true, h);
  });

  test('porta-so-numero-de-porta', () => {
    for (const ok of [5432, '54399', 65535, 1]) assert.equal(validarDb({ db: { ...base, porta: ok } }).ok, true, String(ok));
    for (const ruim of ['abc', '5432;', '', 0, 65536, -1, 1.5, true, null, '1e3', ' 5432', [5432]]) {
      const v = validarDb({ db: { ...base, porta: ruim } });
      assert.equal(v.ok, false, `[${ruim}]`);
      assert.match(v.erro, /db\.porta/);
    }
  });

  test('admin-so-nome-simples', () => {
    for (const ruim of ['host=remoto.invalid dbname=postgres', 'postgresql://remoto.invalid/postgres', 'a b', 'a-b', '', '-x', 'a=b', 'postgres;']) {
      const v = validarDb({ db: { ...base, admin: ruim } });
      assert.equal(v.ok, false, `[${ruim}]`);
      assert.match(v.erro, /db\.admin/);
    }
    assert.equal(validarDb({ db: { ...base, admin: 'meu_admin1' } }).ok, true);
    assert.equal(validarDb({ db: base }).db.admin, 'postgres');
  });

  test('nada-depois-do-psql-o-que-vem-antes-e-involucro', () => {
    const recusados = [
      ['psql', '-h', 'remoto.invalid'], ['psql', '-d', 'host=remoto.invalid dbname=x'], ['psql', '--host=remoto.invalid'],
      ['psql', 'postgresql://remoto.invalid/x'], ['/usr/bin/psql', '-hremoto.invalid'], ['psql', '-Xh', 'remoto.invalid'],
      ['docker', 'exec', 'c', 'psql', '-h', 'remoto.invalid'], ['docker', 'exec', 'c', 'psql', '-U', 'postgres'],
      ['psql', 'host=remoto.invalid'], ['psql', '--hos', 'remoto.invalid'], ['psql', 'psql'],
    ];
    for (const psql of recusados) {
      const v = validarDb({ db: { ...base, psql } });
      assert.equal(v.ok, false, psql.join(' '));
      assert.match(v.erro, /db\.psql/);
    }
    const aceitos = [['psql'], ['/usr/bin/psql'], ['/opt/pg 16/bin/psql'], ['docker', 'exec', 'c', 'psql'], ['docker', 'exec', '-u', 'postgres', 'gm-e2-pg', '/usr/bin/psql']];
    for (const psql of aceitos) assert.equal(validarDb({ db: { ...base, psql } }).ok, true, psql.join(' '));
  });

  test('sem-executavel-psql-no-argv-recusa', () => {
    for (const psql of [['docker', 'exec', 'c', 'pg'], ['psqlx'], ['/usr/bin/psql2'], ['xpsql']]) {
      const v = validarDb({ db: { ...base, psql } });
      assert.equal(v.ok, false, psql.join(' '));
      assert.match(v.erro, /db\.psql/);
    }
  });

  test('config-malformada-e-recusada-com-motivo', () => {
    assert.match(validarDb({ db: [] }).erro, /objeto/);
    assert.match(validarDb({ db: null }).erro, /objeto/);
    assert.match(validarDb({ db: { ...base, psql: 'psql' } }).erro, /db\.psql/);
    assert.match(validarDb({ db: { ...base, psql: [] } }).erro, /db\.psql/);
    assert.match(validarDb({ db: { ...base, template: '' } }).erro, /db\.template/);
    assert.match(validarDb({ db: { ...base, migrar: 'x' } }).erro, /db\.migrar/);
    for (const cfg of [null, [], 'x', 3, undefined]) assert.match(validarDb(cfg).erro, /config/, String(cfg));
  });

  test('sem-db-na', () => {
    assert.deepEqual(validarDb({}), { ok: true, na: true });
    assert.deepEqual(validarDb({ outro: 1 }), { ok: true, na: true });
    const p = projeto({}, { semDb: true });
    const r = p.rodar(['preparar', '--sessao', 'S1']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'n/a');
    assert.equal(p.chamadas().length, 0);
  });
});

describe('config ilegível nunca vira n/a', () => {
  const casos = {
    'json-truncado': ['{"db": {"psql": [', /inválido/],
    'raiz-array': ['[]', /objeto/],
    'raiz-null': ['null', /objeto/],
    'raiz-texto': ['"db"', /objeto/],
    'vazio': ['', /inválido/],
    'db-null': ['{"db": null}', /db/],
  };
  for (const [nome, [texto, motivo]] of Object.entries(casos)) {
    test(`config-${nome}-sai-1-com-a-causa`, () => {
      const p = projeto({}, { config: texto });
      for (const args of [['preparar', '--sessao', 'S1'], ['clonar', 'T1', '--entrega', 'GM-10'], ['orfaos', '--entrega', 'GM-10'], ['soltar', 'T1', '--entrega', 'GM-10'], ['soltar-template']]) {
        const r = p.rodar(args);
        assert.equal(r.status, 1, `${args[0]}: ${r.stdout}`);
        assert.notEqual(r.stdout.trim(), 'n/a');
        assert.match(r.stderr, motivo);
      }
      assert.equal(p.chamadas().length, 0);
    });
  }

  test('config-ausente-sai-1', () => {
    const p = projeto({}, { semConfig: true });
    const r = p.rodar(['preparar', '--sessao', 'S1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ausente/);
    assert.notEqual(r.stdout.trim(), 'n/a');
  });

  test('config-ilegivel-diretorio-sai-1', () => {
    const p = projeto({}, { semConfig: true });
    mkdirSync(join(p.dir, 'harness.config.json'));
    const r = p.rodar(['preparar', '--sessao', 'S1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ilegível/);
  });
});

describe('conexão montada pelo plugin', () => {
  const PG_AMBIENTE = { PGHOST: 'remoto.invalid', PGPORT: '1', PGDATABASE: 'outro', PGSERVICE: 'svc_remoto', PGHOSTADDR: '203.0.113.9', PGPASSWORD: 'segredo', PGOPTIONS: '-c x=1', PGSERVICEFILE: '/x', PGUSER: 'alguem' };

  test('psql-recebe-h-e-p-do-plugin-antes-do-banco', () => {
    const p = projeto({ host: '127.0.0.1', porta: 54399 });
    assert.equal(p.prep().status, 0);
    for (const c of p.chamadas().filter((x) => x.quem === 'psql')) {
      const a = c.argv;
      assert.equal(a[a.indexOf('-h') + 1], '127.0.0.1');
      assert.equal(a[a.indexOf('-p') + 1], '54399');
      assert.equal(a.filter((x) => x === '-h').length, 1);
      assert.ok(a.indexOf('-h') < a.indexOf('-d'));
    }
  });

  test('sem-host-na-config-o-plugin-fixa-localhost-e-nao-passa-p', () => {
    const p = projeto();
    assert.equal(p.prep().status, 0);
    const a = p.chamadas().find((x) => x.quem === 'psql').argv;
    assert.equal(a[a.indexOf('-h') + 1], 'localhost');
    assert.ok(!a.includes('-p'));
    assert.equal(a[a.indexOf('-d') + 1], 'postgres');
  });

  test('admin-vai-em-d-como-nome-simples', () => {
    const p = projeto({ admin: 'meu_admin' });
    assert.equal(p.prep().status, 0);
    const a = p.chamadas().find((x) => x.quem === 'psql').argv;
    assert.equal(a[a.indexOf('-d') + 1], 'meu_admin');
  });

  test('ambiente-do-psql-sem-nenhuma-PG', () => {
    const p = projeto();
    assert.equal(p.prep('S1', PG_AMBIENTE).status, 0);
    for (const c of p.chamadas().filter((x) => x.quem === 'psql')) assert.deepEqual(c.pg, []);
  });

  test('migrar-roda-com-PGHOST-PGPORT-PGDATABASE-forcados', () => {
    const p = projeto({ host: '::1', porta: '54399' });
    assert.equal(p.prep('S1', PG_AMBIENTE).status, 0);
    const m = p.chamadas().find((c) => c.quem === 'migrar');
    const tmp = p.temporarios()[0];
    assert.equal(m.pg.PGHOST, '::1');
    assert.equal(m.pg.PGPORT, '54399');
    assert.equal(m.pg.PGDATABASE, tmp);
    assert.equal(m.env, tmp);
    assert.equal(m.pg.PGSERVICE, undefined);
    assert.equal(m.pg.PGHOSTADDR, undefined);
    assert.equal(m.pg.PGOPTIONS, undefined);
    assert.equal(m.pg.PGPASSWORD, 'segredo', 'credencial do usuário segue');
    assert.equal(m.pg.PGUSER, 'alguem');
  });

  test('migrar-sem-porta-na-config-forca-5432', () => {
    const p = projeto();
    assert.equal(p.prep('S1', { PGPORT: '1' }).status, 0);
    const m = p.chamadas().find((c) => c.quem === 'migrar');
    assert.equal(m.pg.PGPORT, '5432');
    assert.equal(m.pg.PGHOST, 'localhost');
  });

  test('psql-por-argv-sem-shell', () => {
    // metacaracteres de shell no invólucro chegam literais ao processo (sem sh -c)
    const q = projeto();
    const cfg = { db: { psql: [process.execPath, '--title=$(echo pwn);`id`', q.psqlJs], template: 'gm_tpl', migrar: [process.execPath, q.migrarJs, '{db}'] } };
    writeFileSync(join(q.dir, 'harness.config.json'), JSON.stringify(cfg));
    const r = q.prep();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(q.chamadas().find((c) => c.quem === 'psql').title, '$(echo pwn);`id`');
  });

  test('recusa-host-remoto-no-cli-sem-chamar-psql', () => {
    const p = projeto({ host: '127.0.0.1.nip.io' });
    const r = p.prep();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /host .* recusado/);
    assert.equal(p.chamadas().length, 0);
  });

  test('argumento-depois-do-psql-no-cli-sem-chamar-psql', () => {
    const p = projeto();
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs, '-h', 'remoto.invalid'], template: 'gm_tpl', migrar: ['x'] } }));
    const r = p.prep();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /db\.psql/);
    assert.equal(p.chamadas().length, 0);
  });
});

describe('preparar', () => {
  test('recusa-template-postgres-no-cli-sem-chamar-psql', () => {
    const p = projeto({ template: 'Postgres' });
    const r = p.prep();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /banco do sistema/);
    assert.equal(p.chamadas().length, 0);
  });

  test('sem-sessao-recusa-sem-chamar-psql', () => {
    const p = projeto();
    for (const args of [['preparar'], ['preparar', '--sessao'], ['preparar', '--sessao', ''], ['preparar', '--sessao', '--entrega', 'GM-10'], ['preparar', '--entrega', 'GM-10']]) {
      const r = p.rodar(args);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(r.stderr, /--sessao/);
    }
    assert.equal(p.chamadas().length, 0);
  });

  test('sessao-hostil-nunca-entra-no-sql-crua', () => {
    const p = projeto();
    const hostil = "x'; DROP DATABASE gm_tpl; --";
    const r = p.prep(hostil);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!p.sqls().some((s) => s.includes('DROP DATABASE gm_tpl') || s.includes(hostil)));
    assert.equal(p.bancos().gm_tpl.comment, marcaPronto(hostil));
  });

  test('montagem-atomica-migra-em-temporario-e-renomeia-no-fim', () => {
    const p = projeto();
    const r = p.prep();
    assert.equal(r.status, 0, r.stderr);
    const [tmp, ...outros] = p.temporarios();
    assert.match(tmp, /^gm_prep_[0-9a-f]+_[0-9a-f]{12}$/);
    assert.ok(Buffer.byteLength(tmp) <= 63);
    assert.equal(outros.length, 0);
    const ordem = p.chamadas().map((c) => (c.quem === 'migrar' ? 'MIGRAR' : c.argv[c.argv.indexOf('-c') + 1]));
    const i = (x) => ordem.findIndex((s) => (typeof x === 'string' ? s === x : x.test(s)));
    assert.ok(i(`CREATE DATABASE ${ident(tmp)}`) > -1 && i('MIGRAR') > i(`CREATE DATABASE ${ident(tmp)}`), 'migra depois de criar o temporário');
    assert.ok(i(`ALTER DATABASE ${ident(tmp)} WITH ALLOW_CONNECTIONS false`) > i('MIGRAR'), 'fecha conexões depois de migrar');
    assert.ok(i(`ALTER DATABASE ${ident(tmp)} WITH IS_TEMPLATE true`) > i(/ALLOW_CONNECTIONS false/), 'papel sem superusuário ⇒ IS_TEMPLATE');
    assert.ok(i(`COMMENT ON DATABASE ${ident(tmp)} IS '${marcaPronto('S1')}'`) > i(/IS_TEMPLATE true/), 'marca pronto depois de tudo');
    assert.ok(i(`ALTER DATABASE ${ident(tmp)} RENAME TO "gm_tpl"`) > i(/COMMENT ON DATABASE/), 'rename por último');
    assert.ok(!ordem.some((s) => /CREATE DATABASE "gm_tpl"/.test(s)), 'o nome final nunca é criado direto');
    assert.ok(!ordem.some((s) => /preparando/.test(s)), 'sem marca preparando');
    assert.ok(!ordem.some((s) => /DATABASE "postgres"/.test(s)), 'nunca mexe em postgres');
    assert.deepEqual(Object.keys(p.bancos()).sort(), ['gm_tpl', ...SO_SISTEMA]);
    assert.deepEqual(p.bancos().gm_tpl, { comment: marcaPronto('S1'), allow: false, template: true });
    assert.equal(JSON.parse(r.stdout).reaproveitado, false);
  });

  test('nome-do-temporario-leva-o-pid-do-dono-e-e-unico-por-chamada', () => {
    const a = nomeTemporario(), b = nomeTemporario();
    assert.notEqual(a, b);
    for (const n of [a, b]) assert.match(n, new RegExp(`^gm_prep_${process.pid.toString(16)}_[0-9a-f]{12}$`));
    const p = projeto();
    const r = p.prep();
    assert.ok(p.temporarios()[0].startsWith(`gm_prep_${r.pid.toString(16)}_`), 'o pid no nome é o do processo que prepara');
  });

  test('migrar-recebe-o-temporario-por-argv-e-env', () => {
    const p = projeto();
    p.prep();
    const m = p.chamadas().find((c) => c.quem === 'migrar');
    assert.deepEqual(m.argv, [p.temporarios()[0]]);
    assert.equal(m.env, p.temporarios()[0]);
  });

  test('superusuario-nao-marca-is-template', () => {
    const p = projeto();
    const r = p.prep('S1', { FAKE_SUPER: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!p.sqls().some((s) => /IS_TEMPLATE/.test(s)));
    assert.equal(p.bancos().gm_tpl.allow, false);
  });

  test('migrar-falha-solta-o-proprio-temporario-nao-marca-pronto-e-nao-clona', () => {
    const p = projeto();
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs], template: 'gm_tpl', migrar: [process.execPath, p.migrarJs, '{db}', 'falha'] } }));
    const r = p.prep();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /db\.migrar falhou \(ERROR: migração quebrou\)/);
    assert.match(r.stderr, /NÃO foi publicado/);
    assert.deepEqual(Object.keys(p.bancos()).sort(), SO_SISTEMA, 'nem template nem temporário sobram');
    assert.ok(!p.sqls().some((s) => /ALLOW_CONNECTIONS|IS_TEMPLATE true|template:pronto|RENAME/.test(s)));
    const c = p.rodar(['clonar', 'T1', '--entrega', 'GM-10']);
    assert.equal(c.status, 1);
    assert.match(c.stderr, /não está pronto/);
    assert.ok(!p.sqls().some((s) => /^CREATE DATABASE "gm_gm10_t1"/.test(s)));
  });

  test('falha-depois-do-migrar-tambem-solta-o-temporario', () => {
    const p = projeto();
    const r = p.prep('S1', { FAKE_FAIL: 'ALLOW_CONNECTIONS false' });
    assert.equal(r.status, 1);
    assert.deepEqual(Object.keys(p.bancos()).sort(), SO_SISTEMA);
    const q = projeto();
    const f = q.prep('S1', { FAKE_FAIL: 'COMMENT ON DATABASE' }); // depois de IS_TEMPLATE true: tem de desmarcar antes do drop
    assert.equal(f.status, 1);
    assert.deepEqual(Object.keys(q.bancos()).sort(), SO_SISTEMA);
    assert.ok(q.sqls().some((s) => /IS_TEMPLATE false/.test(s)));
  });

  test('sem-migrar-declarado-falha-claro-sem-criar-nada', () => {
    const p = projeto();
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs], template: 'gm_tpl' } }));
    const r = p.prep();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /db\.migrar ausente/);
    assert.ok(!p.sqls().some((s) => /^CREATE/.test(s)), 'nada foi criado');
  });

  test('mesma-sessao-reaproveita-sem-migrar-outra-vez', () => {
    const p = projeto();
    p.prep('S1');
    const r = p.prep('S1');
    assert.equal(r.status, 0);
    assert.equal(p.chamadas().filter((c) => c.quem === 'migrar').length, 1);
    assert.equal(JSON.parse(r.stdout).reaproveitado, true);
  });

  test('outra-sessao-recria-com-o-novo-so-depois-de-pronto', () => {
    const p = projeto();
    p.prep('S1');
    const r = p.prep('S2');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(p.chamadas().filter((c) => c.quem === 'migrar').length, 2);
    assert.equal(JSON.parse(r.stdout).reaproveitado, false);
    assert.equal(p.bancos().gm_tpl.comment, marcaPronto('S2'));
    assert.deepEqual(Object.keys(p.bancos()).sort(), ['gm_tpl', ...SO_SISTEMA]);
    const ordem = p.sqls();
    const tmp2 = p.temporarios()[1];
    const iMigrado = ordem.lastIndexOf(`ALTER DATABASE ${ident(tmp2)} WITH ALLOW_CONNECTIONS false`);
    const iDesmarca = ordem.indexOf('ALTER DATABASE "gm_tpl" WITH IS_TEMPLATE false');
    const iDrop = ordem.indexOf('DROP DATABASE IF EXISTS "gm_tpl" WITH (FORCE)');
    const iRename = ordem.indexOf(`ALTER DATABASE ${ident(tmp2)} RENAME TO "gm_tpl"`);
    assert.ok(iMigrado > -1 && iDesmarca > iMigrado && iDrop > iDesmarca && iRename > iDrop, 'o velho só cai com o novo já pronto');
  });

  test('antigo-nao-cai-se-o-novo-falha', () => {
    const p = projeto();
    p.prep('S1');
    const r = p.prep('S2', { FAKE_FAIL: 'ALLOW_CONNECTIONS false' });
    assert.equal(r.status, 1);
    assert.equal(p.bancos().gm_tpl.comment, marcaPronto('S1'), 'o template antigo continua inteiro');
    assert.deepEqual(Object.keys(p.bancos()).sort(), ['gm_tpl', ...SO_SISTEMA]);
  });

  test('drop-do-antigo-falha-solta-o-proprio-temporario-e-mantem-o-antigo', () => {
    const p = projeto();
    p.prep('S1');
    const r = p.prep('S2', { FAKE_FAIL: '^DROP DATABASE IF EXISTS "gm_tpl"' });
    assert.equal(r.status, 1);
    assert.equal(p.bancos().gm_tpl.comment, marcaPronto('S1'));
    assert.deepEqual(Object.keys(p.bancos()).sort(), ['gm_tpl', ...SO_SISTEMA]);
  });

  test('perde-o-rename-para-a-mesma-sessao-solta-o-proprio-e-reaproveita-o-vencedor', () => {
    const p = projeto();
    const r = p.prep('S1', { FAKE_RACE: JSON.stringify({ comment: marcaPronto('S1') }) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).reaproveitado, true);
    const [tmp] = p.temporarios();
    assert.ok(p.sqls().includes(`DROP DATABASE IF EXISTS ${ident(tmp)} WITH (FORCE)`), 'solta o próprio temporário');
    assert.deepEqual(Object.keys(p.bancos()).sort(), ['gm_tpl', ...SO_SISTEMA]);
    assert.equal(p.bancos().gm_tpl.comment, marcaPronto('S1'));
    assert.ok(!p.sqls().some((s) => /"gm_tpl"/.test(s) && /DROP|IS_TEMPLATE/.test(s)), 'o banco do vencedor não é tocado');
  });

  test('perde-o-rename-para-outra-marca-falha-sem-tocar-no-que-la-esta', () => {
    for (const comment of [marcaPronto('S0'), 'meu banco', '']) {
      const p = projeto();
      const r = p.prep('S1', { FAKE_RACE: JSON.stringify({ comment }) });
      assert.equal(r.status, 1, comment);
      assert.match(r.stderr, /gm_tpl/);
      const [tmp] = p.temporarios();
      assert.ok(p.sqls().includes(`DROP DATABASE IF EXISTS ${ident(tmp)} WITH (FORCE)`));
      assert.equal(p.bancos().gm_tpl.comment, comment);
      assert.ok(!p.sqls().some((s) => /"gm_tpl"/.test(s) && /DROP|IS_TEMPLATE/.test(s)));
    }
  });

  test('nunca-solta-preparo-de-outro-processo', () => {
    const p = projeto();
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_prep_ffff_aaaaaaaaaaaa: { comment: marcaPronto('S1') } } }));
    const r = p.prep('S1');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(p.bancos().gm_prep_ffff_aaaaaaaaaaaa, 'o preparo alheio continua');
    assert.ok(!p.sqls().some((s) => s.includes('gm_prep_ffff')));
  });

  test('dois-preparos-tem-temporarios-distintos', () => {
    const a = projeto(), b = projeto();
    a.prep(); b.prep();
    assert.notEqual(a.temporarios()[0], b.temporarios()[0]);
  });

  test('banco-alheio-com-o-nome-do-template-e-recusado', () => {
    const p = projeto();
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment: 'meu banco' } } }));
    const r = p.prep();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não foi criado pelo Gabarito/);
    assert.ok(!p.sqls().some((s) => /DROP|CREATE/.test(s)));
  });
});

describe('clonar e soltar', () => {
  const pronto = () => { const p = projeto(); const r = p.prep(); assert.equal(r.status, 0, r.stderr); return p; };

  test('clonar-usa-template', () => {
    const p = pronto();
    const r = p.rodar(['clonar', 'T-1', '--entrega', 'GM-10']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { banco: 'gm_gm10_t1' });
    assert.ok(p.sqls().includes('CREATE DATABASE "gm_gm10_t1" TEMPLATE "gm_tpl"'));
    assert.equal(p.bancos().gm_gm10_t1.comment, marcaClone('GM-10', 'T-1'));
  });

  test('clonar-de-novo-o-mesmo-nome-recusa-sem-sobrescrever', () => {
    const p = pronto();
    p.rodar(['clonar', 'T-1', '--entrega', 'GM-10']);
    const r = p.rodar(['clonar', 'T1', '--entrega', 'GM-10']); // mesmo nome normalizado, outra task
    assert.equal(r.status, 1);
    assert.match(r.stderr, /já existe/);
    assert.equal(p.bancos().gm_gm10_t1.comment, marcaClone('GM-10', 'T-1'));
  });

  test('clonar-sem-preparar-recusa', () => {
    const p = projeto();
    const r = p.rodar(['clonar', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não está pronto/);
    assert.ok(!p.sqls().some((s) => /^CREATE/.test(s)));
  });

  test('clonar-nao-aceita-banco-sem-marca-de-pronto-nem-preparo-em-curso', () => {
    for (const comment of ['', 'meu', 'gm-e2:template:preparando', 'gm-e2:template:pronto', 'gm-e2:template:pronto:zzzz']) {
      const p = projeto();
      writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment, template: true } } }));
      const r = p.rodar(['clonar', 'T1', '--entrega', 'GM-10']);
      assert.equal(r.status, 1, comment);
      assert.ok(!p.sqls().some((s) => /^CREATE/.test(s)), comment);
    }
  });

  test('clonar-id-hostil-vai-citado-em-um-unico-argv', () => {
    const p = pronto();
    const r = p.rodar(['clonar', 'a"; DROP DATABASE gm_tpl; --', '--entrega', 'GM-10']);
    assert.equal(r.status, 0, r.stderr);
    const create = p.chamadas().filter((c) => c.quem === 'psql').map((c) => c.argv).find((a) => /CREATE DATABASE "gm_gm10_/.test(a[a.indexOf('-c') + 1]));
    assert.equal(create[create.indexOf('-c') + 1], 'CREATE DATABASE "gm_gm10_adropdatabasegmtpl" TEMPLATE "gm_tpl"');
    assert.ok(!p.sqls().some((s) => /DROP DATABASE IF EXISTS "gm_gm10/.test(s)));
    assert.ok(p.bancos().gm_tpl, 'template intacto');
  });

  test('template-com-aspas-vai-como-identificador-citado', () => {
    const p = projeto({ template: 'tpl"; DROP DATABASE x; --' });
    const r = p.prep();
    assert.equal(r.status, 0, r.stderr);
    assert.ok(p.sqls().includes(`ALTER DATABASE ${ident(p.temporarios()[0])} RENAME TO "tpl""; DROP DATABASE x; --"`));
    assert.deepEqual(Object.keys(p.bancos()).sort(), [...SO_SISTEMA, 'tpl"; DROP DATABASE x; --'].sort());
  });

  test('soltar-force', () => {
    const p = pronto();
    p.rodar(['clonar', 'T1', '--entrega', 'GM-10']);
    const r = p.rodar(['soltar', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(p.sqls().includes('DROP DATABASE IF EXISTS "gm_gm10_t1" WITH (FORCE)'));
    assert.equal(p.bancos().gm_gm10_t1, undefined);
    assert.ok(p.bancos().gm_tpl, 'template fica');
  });

  test('soltar-idempotente', () => {
    const p = pronto();
    const um = p.rodar(['soltar', 'T9', '--entrega', 'GM-10']);
    const dois = p.rodar(['soltar', 'T9', '--entrega', 'GM-10']);
    assert.equal(um.status, 0);
    assert.equal(dois.status, 0);
    assert.equal(JSON.parse(dois.stdout).estado, 'ausente');
    p.rodar(['clonar', 'T1', '--entrega', 'GM-10']);
    assert.equal(p.rodar(['soltar', 'T1', '--entrega', 'GM-10']).status, 0);
    assert.equal(p.rodar(['soltar', 'T1', '--entrega', 'GM-10']).status, 0);
  });

  test('soltar-recusa-banco-de-outra-task-com-o-mesmo-nome', () => {
    const p = pronto();
    p.rodar(['clonar', 'T-1', '--entrega', 'GM-10']);
    const r = p.rodar(['soltar', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não pertence/);
    assert.ok(p.bancos().gm_gm10_t1, 'banco da T-1 continua');
    assert.ok(!p.sqls().some((s) => /^DROP/.test(s)));
  });

  test('soltar-recusa-banco-sem-marca', () => {
    const p = pronto();
    const e = JSON.parse(readFileSync(p.estado, 'utf8'));
    e.dbs.gm_gm10_t1 = { comment: '' };
    writeFileSync(p.estado, JSON.stringify(e));
    const r = p.rodar(['soltar', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.status, 1);
    assert.ok(p.bancos().gm_gm10_t1);
  });

  test('soltar-template-desmarca-antes-do-drop', () => {
    const p = pronto();
    assert.equal(p.bancos().gm_tpl.template, true);
    const r = p.rodar(['soltar-template']);
    assert.equal(r.status, 0, r.stderr);
    const s = p.sqls();
    const alter = s.indexOf('ALTER DATABASE "gm_tpl" WITH IS_TEMPLATE false');
    const drop = s.indexOf('DROP DATABASE IF EXISTS "gm_tpl" WITH (FORCE)');
    assert.ok(alter > -1 && drop > alter);
    assert.equal(p.bancos().gm_tpl, undefined);
    assert.equal(p.rodar(['soltar-template']).status, 0, 'idempotente');
  });

  test('soltar-template-recusa-banco-alheio', () => {
    const p = projeto();
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment: 'meu' } } }));
    const r = p.rodar(['soltar-template']);
    assert.equal(r.status, 1);
    assert.ok(p.bancos().gm_tpl);
  });

  test('uso-invalido-sai-2', () => {
    const p = projeto();
    assert.equal(p.rodar(['nada']).status, 2);
    assert.equal(p.rodar([]).status, 2);
    assert.equal(p.rodar(['clonar', 'T1']).status, 2);
    assert.equal(p.rodar(['soltar', '--entrega', 'GM-10']).status, 2);
    assert.equal(p.rodar(['orfaos']).status, 2);
    assert.equal(p.chamadas().length, 0);
  });
});

describe('órfãos', () => {
  /** `spec`: nome simples (sem marca) ou `[nome, entrega, task]` (com a marca de clone que o script grava). */
  const comBancos = (spec, opts = { git: true }) => {
    const p = projeto({}, opts);
    const dbs = { postgres: {}, template1: {} };
    for (const x of spec) {
      if (typeof x === 'string') dbs[x] = {};
      else dbs[x[0]] = { comment: marcaClone(x[1], x[2]) };
    }
    writeFileSync(p.estado, JSON.stringify({ dbs }));
    return p;
  };
  const lista = (p, entrega, extra) => JSON.parse(p.rodar(['orfaos', '--entrega', entrega], extra).stdout).orfaos;

  test('orfao-com-escape-nao-pega-gmaster', () => {
    const p = comBancos([['gm_e2_a', 'e2', 'a'], ['gm_e2_b', 'e2', 'b'], ['gmaster', 'e2', 'a'], ['gmxe2xzzz', 'e2', 'a'], ['gm_e2x_c', 'e2', 'c'], ['gm_outra_a', 'outra', 'a']]);
    const r = p.rodar(['orfaos', '--entrega', 'e2']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).orfaos, ['gm_e2_a', 'gm_e2_b']);
    assert.ok(p.sqls().some((s) => s.includes("LIKE 'gm\\_e2\\_%' ESCAPE '\\'")), p.sqls().join('\n'));
  });

  test('orfao-exige-a-marca-de-clone-da-entrega', () => {
    const p = comBancos([['gm_e2_ok', 'e2', 'ok'], 'gm_e2_semmarca']);
    const e = JSON.parse(readFileSync(p.estado, 'utf8'));
    e.dbs.gm_e2_alheio = { comment: 'meu banco' };
    e.dbs.gm_e2_pronto = { comment: marcaPronto('S1') };
    writeFileSync(p.estado, JSON.stringify(e));
    assert.deepEqual(lista(p, 'e2'), ['gm_e2_ok']);
  });

  test('orfao-entrega-exata-GM10-nao-pega-GM-10', () => {
    const p = comBancos([['gm_gm10_t1', 'GM-10', 'T1']]);
    assert.deepEqual(lista(p, 'GM10'), []);
    assert.deepEqual(lista(p, 'gm10'), []);
    assert.deepEqual(lista(p, 'GM-10'), ['gm_gm10_t1']);
  });

  test('orfao-valida-a-lista-que-veio-do-banco', () => {
    const p = comBancos([['gm_e2_ok', 'e2', 'ok']]);
    const hostis = ['gm_e2_x"; DROP DATABASE y;--', 'gm_e2_a_b', 'gm_e2_', 'gmaster', 'GM_E2_ok', 'gm_e2_' + 'a'.repeat(60), 'gm_e2_ok'];
    const r = p.rodar(['orfaos', '--entrega', 'e2'], { FAKE_EXTRA: JSON.stringify(hostis) });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).orfaos, ['gm_e2_ok', 'gm_e2_ok']);
    assert.ok(!p.sqls().some((s) => /^(DROP|ALTER|CREATE)/.test(s)), 'listar não altera nada');
  });

  test('orfao-nao-lista-o-template-mesmo-com-nome-no-padrao', () => {
    const p = comBancos([['gm_e2_a', 'e2', 'a']]);
    const e = JSON.parse(readFileSync(p.estado, 'utf8'));
    e.dbs.gm_e2_tpl = { comment: marcaPronto('S1'), template: true };
    writeFileSync(p.estado, JSON.stringify(e));
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs], template: 'gm_e2_tpl', migrar: ['x'] } }));
    assert.deepEqual(lista(p, 'e2'), ['gm_e2_a']);
  });

  test('orfao-worktree-viva-por-caminho-fica-mesmo-em-rebase-detached', () => {
    const p = comBancos([['gm_gm10_t1', 'GM-10', 'T-1'], ['gm_gm10_t2', 'GM-10', 'T2'], ['gm_gm10_t3', 'GM-10', 'T3']]);
    gitEm(p.dir)('worktree', 'add', '-q', '--detach', join(p.dir, '.harness', 'worktrees', 'T-1')); // sem branch, como num rebase parado
    assert.deepEqual(lista(p, 'GM-10'), ['gm_gm10_t2', 'gm_gm10_t3']);
  });

  test('orfao-worktree-fora-de-harness-worktrees-nao-protege', () => {
    const p = comBancos([['gm_gm10_t1', 'GM-10', 'T1']]);
    gitEm(p.dir)('worktree', 'add', '-q', '-b', 'wt/GM-10-T1', join(p.dir, 'outro-lugar', 'T1'));
    assert.deepEqual(lista(p, 'GM-10'), ['gm_gm10_t1']);
  });

  test('orfao-git-falhando-e-erro-nunca-lista-vazia', () => {
    const p = comBancos([['gm_gm10_t1', 'GM-10', 'T1']], { git: false });
    const r = p.rodar(['orfaos', '--entrega', 'GM-10']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /git worktree list falhou/);
    assert.equal(r.stdout.trim(), '');
  });

  test('bancos-vivos-so-conta-worktree-existente-sob-harness-worktrees', () => {
    const porcelain = [
      'worktree /r\nHEAD aaa\nbranch refs/heads/main',
      'worktree /r/.harness/worktrees/T1\nHEAD bbb\nbranch refs/heads/wt/GM-10-T1',
      'worktree /r/.harness/worktrees/T2\nHEAD ccc\ndetached',
      'worktree /r/.harness/worktrees/T3\nHEAD ddd\nbranch refs/heads/wt/GM-10-T3\nprunable gitdir file points to non-existent location',
      'worktree /r/.harness/worktrees/T4\nHEAD eee\nbranch refs/heads/qualquer',
      'worktree /r/.harness/worktrees/T5/fundo\nHEAD fff\ndetached',
      'worktree /r/wt/T6\nHEAD ggg\nbranch refs/heads/wt/GM-10-T6',
      'worktree /r/.harness/worktrees/sumiu\nHEAD hhh\ndetached',
      'worktree /outro/.harness/worktrees/T7\nHEAD iii\ndetached',
    ].join('\n\n');
    const vivos = bancosVivos('GM-10', porcelain, (c) => !c.endsWith('/sumiu'));
    assert.deepEqual([...vivos].sort(), ['gm_gm10_t1', 'gm_gm10_t2', 'gm_gm10_t4']);
  });

  test('bancos-vivos-porcelain-vazio-ou-sem-principal-lanca', () => {
    for (const ruim of ['', '\n', 'HEAD aaa\nbranch refs/heads/main']) assert.throws(() => bancosVivos('GM-10', ruim), /worktree/);
  });

  test('temporario-sem-dono-aparece-pelo-padrao-e-o-vivo-fica', () => {
    const morto = spawnSync(process.execPath, ['-e', '0']).pid;
    const vivoNome = `gm_prep_${process.pid.toString(16)}_aaaaaaaaaaaa`;
    const mortoNome = `gm_prep_${morto.toString(16)}_bbbbbbbbbbbb`;
    const p = comBancos([]);
    const e = JSON.parse(readFileSync(p.estado, 'utf8'));
    e.dbs[vivoNome] = {}; e.dbs[mortoNome] = {}; e.dbs.gm_prep_lixo = {};
    writeFileSync(p.estado, JSON.stringify(e));
    const out = JSON.parse(p.rodar(['orfaos', '--entrega', 'e2']).stdout);
    assert.deepEqual(out.temporarios, [mortoNome]);
    assert.ok(!p.sqls().some((s) => /^(DROP|ALTER|CREATE)/.test(s)), 'listar não altera nada');
  });
});

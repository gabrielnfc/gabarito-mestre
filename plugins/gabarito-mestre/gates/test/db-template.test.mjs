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
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  nomeBanco, marcaClone, validarDb, bancosVivos, ident, HOSTS_LOCAIS,
} from '../scripts/db-template.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'db-template.mjs');

const FAKE_PSQL = String.raw`
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const argv = process.argv.slice(2);
const ESTADO = process.env.FAKE_STATE, LOG = process.env.FAKE_LOG;
appendFileSync(LOG, JSON.stringify({ quem: 'psql', argv }) + '\n');
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
} else if ((m = new RegExp("^SELECT datname FROM pg_database WHERE datname LIKE " + L + " ESCAPE '\\\\' ORDER BY datname$").exec(sql))) {
  const pad = un(m[1]); let re = '^';
  for (let i = 0; i < pad.length; i++) {
    const c = pad[i];
    if (c === '\\') { re += pad[++i].replace(/[.*+?^$()|[\]{}\\]/g, '\\$&'); }
    else if (c === '%') re += '.*'; else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
  }
  const nomes = Object.keys(st.dbs).filter((n) => new RegExp(re + '$').test(n)).sort();
  const extra = process.env.FAKE_EXTRA ? JSON.parse(process.env.FAKE_EXTRA) : [];
  process.stdout.write([...nomes, ...extra].join('\n') + '\n');
} else erro('fake: SQL desconhecido: ' + sql, 3);
`;

const FAKE_MIGRAR = String.raw`
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ quem: 'migrar', argv: process.argv.slice(2), env: process.env.GABARITO_DB }) + '\n');
if (process.argv[3] === 'falha') { process.stderr.write('ERROR: migração quebrou\nLINE 1: SELECT x\n                ^\n'); process.exit(1); }
`;

/** Projeto temporário (sem git) com fake psql, fake migrar e config. */
function projeto(db = {}, { semDb = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbt-'));
  const psql = join(dir, 'fake-psql.mjs'), migrar = join(dir, 'fake-migrar.mjs');
  writeFileSync(psql, FAKE_PSQL);
  writeFileSync(migrar, FAKE_MIGRAR);
  const cfg = semDb ? {} : { db: { psql: [process.execPath, psql, '-U', 'postgres'], template: 'gm_tpl', migrar: [process.execPath, migrar, '{db}'], ...db } };
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg));
  const estado = join(dir, 'estado.json'), log = join(dir, 'log.jsonl');
  writeFileSync(log, '');
  const env = { ...process.env, FAKE_STATE: estado, FAKE_LOG: log };
  delete env['GABARITO' + '_ALLOW'];
  const rodar = (args, extra = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env: { ...env, ...extra } });
  const chamadas = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const sqls = () => chamadas().filter((c) => c.quem === 'psql').map((c) => c.argv[c.argv.indexOf('-c') + 1]);
  const bancos = () => (existsSync(estado) ? JSON.parse(readFileSync(estado, 'utf8')).dbs : null);
  return { dir, rodar, chamadas, sqls, bancos, estado, migrarJs: migrar, psqlJs: psql };
}

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

  test('marca-do-clone-separa-t-1-de-t1', () => {
    assert.notEqual(marcaClone('GM-10', 'T-1'), marcaClone('GM-10', 'T1'));
    assert.equal(marcaClone('GM-10', 'T1'), marcaClone('GM-10', 'T1'));
    assert.notEqual(marcaClone('GM-1', '0T'), marcaClone('GM-10', 'T')); // separador não deixa fundir os ids
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

  test('recusa-host-remoto', () => {
    for (const h of ['db.prod.exemplo.com', 'localhost.evil.com', '127.0.0.1.nip.io', 'evil.com/127.0.0.1', '127.0.0.1 ', 'LOCALHOST', '0.0.0.0', '']) {
      assert.equal(validarDb({ db: { ...base, host: h } }).ok, false, `[${h}]`);
    }
    for (const h of HOSTS_LOCAIS) assert.equal(validarDb({ db: { ...base, host: h } }).ok, true, h);
  });

  test('recusa-host-remoto-no-argv-do-psql', () => {
    const remotos = [
      ['psql', '-h', 'evil.com'], ['psql', '--host', 'evil.com'], ['psql', '--host=evil.com'], ['psql', '-hevil.com'],
      ['psql', 'postgres://u:p@evil.com:5432/db'], ['psql', 'postgresql://evil.com/db'], ['psql', 'postgres://u@localhost.evil.com/db'],
    ];
    for (const psql of remotos) assert.equal(validarDb({ db: { ...base, psql } }).ok, false, psql.join(' '));
    const locais = [['psql', '-h', '127.0.0.1'], ['psql', '--host=localhost'], ['psql', 'postgres://u@[::1]:5432/db'], ['psql', '-h', '::1']];
    for (const psql of locais) assert.equal(validarDb({ db: { ...base, psql } }).ok, true, psql.join(' '));
  });

  test('config-malformada-e-recusada-com-motivo', () => {
    assert.match(validarDb({ db: [] }).erro, /objeto/);
    assert.match(validarDb({ db: { ...base, psql: 'psql' } }).erro, /db\.psql/);
    assert.match(validarDb({ db: { ...base, psql: [] } }).erro, /db\.psql/);
    assert.match(validarDb({ db: { ...base, template: '' } }).erro, /db\.template/);
    assert.match(validarDb({ db: { ...base, migrar: 'x' } }).erro, /db\.migrar/);
  });

  test('sem-db-na', () => {
    assert.deepEqual(validarDb({}), { ok: true, na: true });
    assert.deepEqual(validarDb(null), { ok: true, na: true });
    const p = projeto({}, { semDb: true });
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'n/a');
    assert.equal(p.chamadas().length, 0);
  });
});

describe('preparar', () => {
  test('recusa-template-postgres-no-cli-sem-chamar-psql', () => {
    const p = projeto({ template: 'Postgres' });
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /banco do sistema/);
    assert.equal(p.chamadas().length, 0);
  });

  test('recusa-host-remoto-no-cli-sem-chamar-psql', () => {
    const p = projeto({ host: '127.0.0.1.nip.io' });
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /host .* recusado/);
    assert.equal(p.chamadas().length, 0);
  });

  test('template-sem-conexao-apos-preparar', () => {
    const p = projeto();
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 0, r.stderr);
    const ordem = p.chamadas().map((c) => (c.quem === 'migrar' ? 'MIGRAR' : c.argv[c.argv.indexOf('-c') + 1]));
    const i = (re) => ordem.findIndex((s) => (typeof re === 'string' ? s === re : re.test(s)));
    assert.ok(i('MIGRAR') > i(/^CREATE DATABASE "gm_tpl"$/) && i('MIGRAR') > -1, 'migra depois de criar');
    assert.ok(i(/ALLOW_CONNECTIONS false/) > i('MIGRAR'), 'fecha conexões depois de migrar');
    assert.ok(i(/IS_TEMPLATE true/) > i(/ALLOW_CONNECTIONS false/), 'papel sem superusuário ⇒ IS_TEMPLATE');
    assert.ok(i(/COMMENT ON DATABASE "gm_tpl" IS 'gm-e2:template:pronto'/) > i(/IS_TEMPLATE true/), 'marca pronto por último');
    assert.deepEqual(p.bancos().gm_tpl, { comment: 'gm-e2:template:pronto', allow: false, template: true });
    assert.ok(!ordem.some((s) => /DATABASE "postgres"/.test(s)), 'nunca mexe em postgres');
  });

  test('superusuario-nao-marca-is-template', () => {
    const p = projeto();
    const r = p.rodar(['preparar'], { FAKE_SUPER: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!p.sqls().some((s) => /IS_TEMPLATE/.test(s)));
    assert.equal(p.bancos().gm_tpl.allow, false);
  });

  test('migrar-recebe-o-template-por-argv-e-env', () => {
    const p = projeto();
    p.rodar(['preparar']);
    const m = p.chamadas().find((c) => c.quem === 'migrar');
    assert.deepEqual(m.argv, ['gm_tpl']);
    assert.equal(m.env, 'gm_tpl');
  });

  test('migrar-falha-nao-marca-pronto-e-nao-clona', () => {
    const p = projeto();
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs], template: 'gm_tpl', migrar: [process.execPath, p.migrarJs, '{db}', 'falha'] } }));
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /db\.migrar falhou \(ERROR: migração quebrou\)/);
    assert.match(r.stderr, /NÃO foi marcado como pronto/);
    assert.equal(p.bancos().gm_tpl.comment, 'gm-e2:template:preparando');
    assert.ok(!p.sqls().some((s) => /ALLOW_CONNECTIONS|IS_TEMPLATE|template:pronto/.test(s)));
    const c = p.rodar(['clonar', 'T1', '--entrega', 'GM-10']);
    assert.equal(c.status, 1);
    assert.match(c.stderr, /não está pronto/);
    assert.ok(!p.sqls().some((s) => /^CREATE DATABASE "gm_gm10_t1"/.test(s)));
  });

  test('sem-migrar-declarado-falha-claro', () => {
    const p = projeto();
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs], template: 'gm_tpl' } }));
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /db\.migrar ausente/);
    assert.notEqual(p.bancos()?.gm_tpl?.comment, 'gm-e2:template:pronto');
  });

  test('preparar-de-novo-reaproveita-sem-migrar-outra-vez', () => {
    const p = projeto();
    p.rodar(['preparar']);
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 0);
    assert.equal(p.chamadas().filter((c) => c.quem === 'migrar').length, 1);
    assert.equal(JSON.parse(r.stdout).reaproveitado, true);
  });

  test('banco-alheio-com-o-nome-do-template-e-recusado', () => {
    const p = projeto();
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment: 'meu banco' } } }));
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não foi criado pelo Gabarito/);
    assert.ok(!p.sqls().some((s) => /DROP|CREATE/.test(s)));
  });

  test('sobra-de-preparo-interrompido-e-refeita', () => {
    const p = projeto();
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_tpl: { comment: 'gm-e2:template:preparando' } } }));
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(p.sqls().some((s) => s === 'DROP DATABASE IF EXISTS "gm_tpl" WITH (FORCE)'));
    assert.equal(p.bancos().gm_tpl.comment, 'gm-e2:template:pronto');
  });
});

describe('clonar e soltar', () => {
  const pronto = () => { const p = projeto(); const r = p.rodar(['preparar']); assert.equal(r.status, 0, r.stderr); return p; };

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

  test('clonar-id-hostil-vai-citado-em-um-unico-argv', () => {
    const p = pronto();
    const r = p.rodar(['clonar', 'a"; DROP DATABASE gm_tpl; --', '--entrega', 'GM-10']);
    assert.equal(r.status, 0, r.stderr);
    const create = p.chamadas().filter((c) => c.quem === 'psql').map((c) => c.argv).find((a) => /CREATE DATABASE "gm_gm10_/.test(a[a.indexOf('-c') + 1]));
    assert.equal(create[create.indexOf('-c') + 1], 'CREATE DATABASE "gm_gm10_adropdatabasegmtpl" TEMPLATE "gm_tpl"');
    assert.ok(!p.sqls().some((s) => /DROP/.test(s)));
    assert.ok(p.bancos().gm_tpl, 'template intacto');
  });

  test('template-com-aspas-vai-como-identificador-citado', () => {
    const p = projeto({ template: 'tpl"; DROP DATABASE x; --' });
    const r = p.rodar(['preparar']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(p.sqls().includes('CREATE DATABASE "tpl""; DROP DATABASE x; --"'));
    assert.deepEqual(Object.keys(p.bancos()).sort(), ['postgres', 'template0', 'template1', 'tpl"; DROP DATABASE x; --']);
  });

  test('psql-por-argv-sem-shell', () => {
    // argumento com metacaracteres de shell chega literal ao processo (sem sh -c)
    const q = projeto();
    writeFileSync(join(q.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, q.psqlJs, '-U', '$(echo pwn);`id`'], template: 'gm_tpl', migrar: [process.execPath, q.migrarJs, '{db}'] } }));
    const r = q.rodar(['preparar']);
    assert.equal(r.status, 0, r.stderr);
    const a = q.chamadas().find((c) => c.quem === 'psql').argv;
    assert.equal(a[a.indexOf('-U') + 1], '$(echo pwn);`id`');
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
  const comBancos = (nomes) => {
    const p = projeto();
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, template1: {}, ...Object.fromEntries(nomes.map((n) => [n, {}])) } }));
    return p;
  };

  test('orfao-com-escape-nao-pega-gmaster', () => {
    const p = comBancos(['gm_e2_a', 'gm_e2_b', 'gmaster', 'gmxe2xzzz', 'gm_e2x_c', 'gm_outra_a']);
    const r = p.rodar(['orfaos', '--entrega', 'e2']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).orfaos, ['gm_e2_a', 'gm_e2_b']);
    assert.ok(p.sqls().some((s) => s.includes("LIKE 'gm\\_e2\\_%' ESCAPE '\\'")), p.sqls().join('\n'));
  });

  test('orfao-valida-a-lista-que-veio-do-banco', () => {
    const p = comBancos(['gm_e2_ok']);
    const hostis = ['gm_e2_x"; DROP DATABASE y;--', 'gm_e2_a_b', 'gm_e2_', 'gmaster', 'GM_E2_ok', 'gm_e2_' + 'a'.repeat(60), 'gm_e2_ok'];
    const r = p.rodar(['orfaos', '--entrega', 'e2'], { FAKE_EXTRA: JSON.stringify(hostis) });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).orfaos, ['gm_e2_ok', 'gm_e2_ok']);
    assert.ok(!p.sqls().some((s) => /^(DROP|ALTER|CREATE)/.test(s)), 'listar não altera nada');
  });

  test('orfao-nao-lista-o-proprio-template', () => {
    const p = comBancos(['gm_e2_tpl', 'gm_e2_a']);
    writeFileSync(join(p.dir, 'harness.config.json'), JSON.stringify({ db: { psql: [process.execPath, p.psqlJs], template: 'gm_e2_tpl', migrar: ['x'] } }));
    assert.deepEqual(JSON.parse(p.rodar(['orfaos', '--entrega', 'e2']).stdout).orfaos, ['gm_e2_a']);
  });

  test('orfao-worktree-viva-fica', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'dbt-git-'));
    const git = (...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'x');
    const p = projeto();
    writeFileSync(join(raiz, 'harness.config.json'), readFileSync(join(p.dir, 'harness.config.json')));
    git('worktree', 'add', '-q', '-b', 'wt/GM-10-T-1', join(raiz, 'wt1'));
    writeFileSync(p.estado, JSON.stringify({ dbs: { postgres: {}, gm_gm10_t1: {}, gm_gm10_t2: {}, gm_gm10_t3: {} } }));
    const env = { ...process.env, FAKE_STATE: p.estado, FAKE_LOG: join(p.dir, 'log.jsonl') };
    const r = spawnSync(process.execPath, [SCRIPT, 'orfaos', '--entrega', 'GM-10'], { cwd: raiz, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).orfaos, ['gm_gm10_t2', 'gm_gm10_t3']);
  });

  test('bancos-vivos-so-conta-worktree-existente-da-entrega', () => {
    const porcelain = [
      'worktree /r\nHEAD aaa\nbranch refs/heads/main',
      'worktree /r/wt/a\nHEAD bbb\nbranch refs/heads/wt/GM-10-T1',
      'worktree /r/wt/b\nHEAD ccc\nbranch refs/heads/wt/GM-10-T2\nprunable gitdir file points to non-existent location',
      'worktree /r/wt/c\nHEAD ddd\nbranch refs/heads/wt/GM-11-T3',
      'worktree /r/wt/d\nHEAD eee\ndetached',
      'worktree /sumiu\nHEAD fff\nbranch refs/heads/wt/GM-10-T4',
    ].join('\n\n');
    const vivos = bancosVivos('GM-10', porcelain, (c) => c !== '/sumiu');
    assert.deepEqual([...vivos], ['gm_gm10_t1']);
  });
});

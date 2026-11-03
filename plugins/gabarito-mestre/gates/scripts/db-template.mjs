#!/usr/bin/env node
/**
 * REQ-DB-1 — banco por worktree, clonado de um template próprio.
 *
 * O template é um banco só do Gabarito (nunca `postgres`), migrado e com seed uma vez, e fechado
 * a conexões depois de pronto: clonar de um template com sessão aberta falha em ~5 s (S9/P2).
 * Cada worktree ganha `gm_<entrega>_<task>`, clonado dele.
 *
 * Tudo vai ao banco por `db.psql` (argv de config; `docker exec <contêiner> psql -U …` é só um valor),
 * sem shell. Nome de banco entra no SQL sempre como identificador citado; nada de id cru.
 *
 * Config (harness.config.json):
 *   db: { psql: string[], template: string, migrar: string[], host?: string, admin?: string }
 *   `migrar` roda uma vez no template; `{db}` em qualquer argumento e `GABARITO_DB` no ambiente = nome do template.
 *   Sem `db` ⇒ imprime `n/a` e sai 0.
 *
 * USO
 *   db-template.mjs preparar
 *   db-template.mjs clonar <task> --entrega <id>
 *   db-template.mjs soltar <task> --entrega <id>
 *   db-template.mjs soltar-template
 *   db-template.mjs orfaos --entrega <id>
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { lerConfig } from '../lib/config.mjs';
import { raizDoRepo } from '../lib/git.mjs';

export const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '::1'];
export const TEMPLATES_PROIBIDOS = ['postgres', 'template0', 'template1'];
const LIMITE_BYTES = 63;
const MAX_ENTREGA = 24;
const MAX_TASK = 35; // 3 ("gm_") + 24 + 1 ("_") + 35 = 63
const MARCA_PREPARANDO = 'gm-e2:template:preparando';
const MARCA_PRONTO = 'gm-e2:template:pronto';

// ─────────────────────────────────────────────────────────────── nomes (puros)

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Um id vira `[a-z0-9]+`; acima do máximo, corta e cola 8 hex do id ORIGINAL (nomes longos não colidem pelo fim). */
function segmento(id, max, rotulo) {
  if (typeof id !== 'string') throw new Error(`${rotulo} inválido: esperado texto`);
  const norm = id.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm === '') throw new Error(`${rotulo} inválido: "${id}" não tem letra nem dígito`);
  return norm.length <= max ? norm : norm.slice(0, max - 8) + sha(id).slice(0, 8);
}

export const segmentoEntrega = (entrega) => segmento(entrega, MAX_ENTREGA, 'entrega');

/**
 * `gm_<entrega>_<task>`, ids em minúsculas `[a-z0-9]`, sem `_` dentro do id, ≤ 63 bytes.
 * `T-1` e `T1` dão o mesmo nome por contrato do plano; quem separa as duas é a marca gravada no banco
 * (`marcaClone`), e `soltar` recusa o que não é seu.
 */
export function nomeBanco(entrega, task) {
  const nome = `gm_${segmentoEntrega(entrega)}_${segmento(task, MAX_TASK, 'task')}`;
  if (Buffer.byteLength(nome) > LIMITE_BYTES) throw new Error(`nome de banco acima de ${LIMITE_BYTES} bytes`);
  return nome;
}

/** Identidade do clone: o par de ids ORIGINAIS, em hash (id cru nunca entra no SQL). */
export const marcaClone = (entrega, task) => `gm-e2:clone:${sha(`${entrega}\0${task}`).slice(0, 16)}`;

/** Identificador SQL citado. */
export const ident = (nome) => `"${String(nome).replaceAll('"', '""')}"`;
const literal = (txt) => `'${String(txt).replaceAll("'", "''")}'`;
const escLike = (txt) => txt.replace(/[\\%_]/g, (c) => `\\${c}`);

// ─────────────────────────────────────────────────────────────── config

/** `{ ok: true, na: true }` sem `db`; `{ ok: false, erro }` se inválido; `{ ok: true, db }` normalizado. */
export function validarDb(cfg) {
  const db = cfg?.db;
  if (db === undefined || db === null) return { ok: true, na: true };
  if (typeof db !== 'object' || Array.isArray(db)) return { ok: false, erro: 'db: esperado objeto' };
  const argv = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '');
  if (!argv(db.psql)) return { ok: false, erro: 'db.psql: esperado lista de argumentos (ex.: ["docker","exec","<contêiner>","psql","-U","postgres"])' };
  if (typeof db.template !== 'string' || db.template.trim() === '') return { ok: false, erro: 'db.template: nome do banco-template ausente' };
  if (TEMPLATES_PROIBIDOS.includes(db.template.trim().toLowerCase())) {
    return { ok: false, erro: `db.template: "${db.template}" é banco do sistema; o template tem de ser um banco só do Gabarito` };
  }
  if (/[\u0000-\u001f]/.test(db.template) || Buffer.byteLength(db.template) > LIMITE_BYTES) {
    return { ok: false, erro: 'db.template: nome inválido (controle ou acima de 63 bytes)' };
  }
  if (db.migrar !== undefined && !argv(db.migrar)) return { ok: false, erro: 'db.migrar: esperado lista de argumentos' };
  if (db.host !== undefined && typeof db.host !== 'string') return { ok: false, erro: 'db.host: esperado texto' };
  const admin = db.admin ?? 'postgres';
  if (typeof admin !== 'string' || admin === '') return { ok: false, erro: 'db.admin: esperado nome de banco' };
  for (const h of hostsDe(db)) {
    if (!HOSTS_LOCAIS.includes(h)) return { ok: false, erro: `host "${h}" recusado: só localhost, 127.0.0.1 ou ::1 (igualdade exata)` };
  }
  return { ok: true, db: { ...db, admin } };
}

/** Hosts que o psql vai usar: `db.host` e o que o argv declara (`-h`, `-hX`, `--host X`, `--host=X`, URL). */
function hostsDe(db) {
  const hosts = [];
  if (typeof db.host === 'string') hosts.push(db.host);
  const a = db.psql ?? [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-h' || x === '--host') { if (a[i + 1] !== undefined) hosts.push(a[i + 1]); }
    else if (x.startsWith('--host=')) hosts.push(x.slice(7));
    else if (/^-h./.test(x)) hosts.push(x.slice(2));
    else {
      const u = /^postgres(?:ql)?:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]*)/i.exec(x);
      if (u) hosts.push(u[1].replace(/^\[|\]$/g, ''));
    }
  }
  return hosts;
}

// ─────────────────────────────────────────────────────────────── execução (argv, nunca shell)

class ErroDb extends Error {}

/** Roda um comando SQL por `db.psql`. Cada chamada é UM comando (CREATE DATABASE não corre em transação). */
function criarSql(db, run = spawnSync) {
  const base = db.psql.slice(1);
  return function sql(comando) {
    const r = run(db.psql[0], [...base, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db.admin, '-c', comando], {
      encoding: 'utf8', timeout: 120_000,
    });
    if (r.error || r.status !== 0) {
      const motivo = (r.error?.message ?? r.stderr ?? '').toString().trim().split('\n')[0] || `saída ${r.status}`;
      throw new ErroDb(`psql falhou: ${motivo}`);
    }
    return (r.stdout ?? '').toString().trim();
  };
}

/** `null` se o banco não existe; senão o comentário (pode ser ''). */
function comentarioDe(sql, nome) {
  const out = sql(`SELECT 'E:' || coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = ${literal(nome)}`);
  return out.startsWith('E:') ? out.slice(2) : null;
}

const marcar = (sql, nome, marca) => sql(`COMMENT ON DATABASE ${ident(nome)} IS ${literal(marca)}`);

// ─────────────────────────────────────────────────────────────── operações

export function preparar(db, { sql = criarSql(db), migrar = rodarMigrar } = {}) {
  const t = db.template;
  const atual = comentarioDe(sql, t);
  if (atual === MARCA_PRONTO) return { estado: 'pronto', template: t, reaproveitado: true };
  if (atual !== null && atual !== MARCA_PREPARANDO) {
    throw new ErroDb(`o banco "${t}" já existe e não foi criado pelo Gabarito; recusado (escolha outro db.template)`);
  }
  if (atual === MARCA_PREPARANDO) sql(`DROP DATABASE IF EXISTS ${ident(t)} WITH (FORCE)`); // sobra de preparo interrompido, marca é nossa
  sql(`CREATE DATABASE ${ident(t)}`);
  marcar(sql, t, MARCA_PREPARANDO);
  if (!db.migrar) throw new ErroDb('db.migrar ausente: sem migração o template nasce vazio; declare o comando (com seed)');
  migrar(db, t);
  sql(`ALTER DATABASE ${ident(t)} WITH ALLOW_CONNECTIONS false`);
  if (sql('SELECT rolsuper FROM pg_roles WHERE rolname = current_user') !== 't') {
    sql(`ALTER DATABASE ${ident(t)} WITH IS_TEMPLATE true`);
  }
  marcar(sql, t, MARCA_PRONTO); // só depois de tudo: falha antes disso não deixa template "pronto"
  return { estado: 'pronto', template: t, reaproveitado: false };
}

function rodarMigrar(db, template) {
  const argv = db.migrar.map((a) => a.replaceAll('{db}', template));
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, GABARITO_DB: template } });
  if (r.error || r.status !== 0) {
    const motivo = (r.error?.message ?? r.stderr ?? '').toString().trim().split('\n')[0] || `saída ${r.status}`;
    throw new ErroDb(`db.migrar falhou (${motivo}); template "${template}" NÃO foi marcado como pronto e nenhum clone será feito`);
  }
}

export function clonar(db, entrega, task, { sql = criarSql(db) } = {}) {
  const nome = nomeBanco(entrega, task);
  if (comentarioDe(sql, db.template) !== MARCA_PRONTO) {
    throw new ErroDb(`template "${db.template}" não está pronto; rode "preparar" antes de clonar`);
  }
  if (comentarioDe(sql, nome) !== null) throw new ErroDb(`o banco "${nome}" já existe; recusado (outra task com o mesmo nome normalizado, ou clone anterior não solto)`);
  sql(`CREATE DATABASE ${ident(nome)} TEMPLATE ${ident(db.template)}`);
  marcar(sql, nome, marcaClone(entrega, task));
  return { banco: nome };
}

export function soltar(db, entrega, task, { sql = criarSql(db) } = {}) {
  const nome = nomeBanco(entrega, task);
  const marca = comentarioDe(sql, nome);
  if (marca === null) return { banco: nome, estado: 'ausente' };
  if (marca !== marcaClone(entrega, task)) {
    throw new ErroDb(`o banco "${nome}" não pertence a ${entrega}/${task} (colisão de nome ou banco alheio); não foi solto`);
  }
  sql(`DROP DATABASE IF EXISTS ${ident(nome)} WITH (FORCE)`);
  return { banco: nome, estado: 'solto' };
}

/** Template: desmarca `IS_TEMPLATE` antes do drop (senão "cannot drop a template database"). Só se a marca é nossa. */
export function soltarTemplate(db, { sql = criarSql(db) } = {}) {
  const t = db.template;
  const marca = comentarioDe(sql, t);
  if (marca === null) return { template: t, estado: 'ausente' };
  if (marca !== MARCA_PRONTO && marca !== MARCA_PREPARANDO) throw new ErroDb(`o banco "${t}" não foi criado pelo Gabarito; não foi solto`);
  sql(`ALTER DATABASE ${ident(t)} WITH IS_TEMPLATE false`);
  sql(`DROP DATABASE IF EXISTS ${ident(t)} WITH (FORCE)`);
  return { template: t, estado: 'solto' };
}

/** Nomes de banco das worktrees vivas da entrega (branch `wt/<entrega>-<task>`, diretório existente, não prunable). */
export function bancosVivos(entrega, porcelain, existe = existsSync) {
  const vivos = new Set();
  const prefixo = `wt/${entrega}-`;
  for (const bloco of porcelain.split(/\n\n+/)) {
    const linhas = bloco.split('\n');
    const caminho = linhas.find((l) => l.startsWith('worktree '))?.slice(9);
    const branch = linhas.find((l) => l.startsWith('branch refs/heads/'))?.slice(18);
    if (!caminho || !branch || !branch.startsWith(prefixo) || linhas.some((l) => l.startsWith('prunable')) || !existe(caminho)) continue;
    try { vivos.add(nomeBanco(entrega, branch.slice(prefixo.length))); } catch { /* task ilegível: não vira "viva" */ }
  }
  return vivos;
}

/** Órfão = `gm_<entrega>_<task>` exato, sem worktree viva. Conexão aberta NÃO é prova de uso (S9/P4). */
export function orfaos(db, entrega, vivos, { sql = criarSql(db) } = {}) {
  const e = segmentoEntrega(entrega);
  const padrao = new RegExp(`^gm_${e}_[a-z0-9]+$`);
  const out = sql(`SELECT datname FROM pg_database WHERE datname LIKE ${literal(`${escLike(`gm_${e}_`)}%`)} ESCAPE '\\' ORDER BY datname`);
  return out.split('\n').map((l) => l.trim())
    .filter((n) => padrao.test(n) && Buffer.byteLength(n) <= LIMITE_BYTES && n !== db.template && !vivos.has(n));
}

// ─────────────────────────────────────────────────────────────── CLI

function main(argv) {
  const cmd = argv[0];
  const uso = 'uso: db-template.mjs preparar | clonar <task> --entrega <id> | soltar <task> --entrega <id> | soltar-template | orfaos --entrega <id>';
  if (!['preparar', 'clonar', 'soltar', 'soltar-template', 'orfaos'].includes(cmd)) {
    process.stderr.write(`${uso}\n`);
    return 2;
  }
  const raiz = raizDoRepo();
  const { cfg } = lerConfig(raiz);
  const v = validarDb(cfg);
  if (!v.ok) { process.stderr.write(`db-template: ${v.erro}\n`); return 1; }
  if (v.na) { process.stdout.write('n/a\n'); return 0; }
  const entrega = arg(argv, 'entrega', undefined);
  const task = cmd === 'clonar' || cmd === 'soltar' ? argv[1] : undefined;
  if ((cmd === 'clonar' || cmd === 'soltar') && (!task || task.startsWith('--') || !entrega)) { process.stderr.write(`${uso}\n`); return 2; }
  if (cmd === 'orfaos' && !entrega) { process.stderr.write(`${uso}\n`); return 2; }
  try {
    let saida;
    if (cmd === 'preparar') saida = preparar(v.db);
    else if (cmd === 'clonar') saida = clonar(v.db, entrega, task);
    else if (cmd === 'soltar') saida = soltar(v.db, entrega, task);
    else if (cmd === 'soltar-template') saida = soltarTemplate(v.db);
    else {
      const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: raiz, encoding: 'utf8' });
      saida = { orfaos: orfaos(v.db, entrega, bancosVivos(entrega, r.status === 0 ? r.stdout : '')) };
    }
    process.stdout.write(`${JSON.stringify(saida)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`db-template: ${e.message}\n`);
    return 1;
  }
}

if (ehEntrypoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));

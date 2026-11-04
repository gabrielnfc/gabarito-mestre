#!/usr/bin/env node
/**
 * REQ-DB-1 — banco por worktree, clonado de um template próprio.
 *
 * O template é um banco só do Gabarito (nunca `postgres`), migrado e com seed uma vez, e fechado
 * a conexões depois de pronto: clonar de um template com sessão aberta falha em ~5 s (S9/P2).
 * Cada worktree ganha `gm_<entrega>_<task>`, clonado dele.
 *
 * Tudo vai ao banco por `db.psql` (argv de config, sem shell). Quem monta a conexão é o PLUGIN, não a config:
 * `db.psql` termina no executável `psql` (o que vem antes é invólucro, ex.: `docker exec -u postgres c psql`);
 * host (`-h`), porta (`-p`) e banco (`-d`) são acrescentados aqui, e o ambiente do psql não leva nenhuma `PG*`.
 * Nome de banco entra no SQL sempre como identificador citado; nada de id cru.
 *
 * Config (harness.config.json):
 *   db: { psql: string[], template: string, migrar: string[], host?: localhost|127.0.0.1|::1, porta?: 1..65535, admin?: [A-Za-z0-9_]+ }
 *   `migrar` é comando do usuário: roda uma vez no template TEMPORÁRIO, com `PGHOST`, `PGPORT`, `PGDATABASE` forçados,
 *   `{db}` em qualquer argumento e `GABARITO_DB` no ambiente = nome do banco a migrar. (Limite declarado: se o comando
 *   ignora essas variáveis, o plugin não o impede.)
 *   Config ausente, ilegível ou inválida ⇒ erro com a causa; `n/a` (sai 0) só com config válida SEM `db`.
 *
 * Preparo atômico: migra em `gm_prep_<pid>_<rand>` e só então `ALTER DATABASE … RENAME` para o nome final; quem perde
 * o rename solta o PRÓPRIO temporário e reaproveita o vencedor. Template carrega a sessão na marca: outra sessão ⇒ recria.
 *
 * USO
 *   db-template.mjs preparar --sessao <id>
 *   db-template.mjs clonar <task> --entrega <id>
 *   db-template.mjs soltar <task> --entrega <id>
 *   db-template.mjs soltar-template
 *   db-template.mjs orfaos --entrega <id>
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { raizDoRepo } from '../lib/git.mjs';

export const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '::1'];
export const TEMPLATES_PROIBIDOS = ['postgres', 'template0', 'template1'];
const LIMITE_BYTES = 63;
const MAX_ENTREGA = 24;
const MAX_TASK = 35; // 3 ("gm_") + 24 + 1 ("_") + 35 = 63
const PREFIXO_TEMP = 'gm_prep_'; // reservado: nenhum `db.template` pode começar assim (é o nome de um preparo em curso)
const ER_PRONTO = /^gm-e2:template:pronto:[0-9a-f]{16}$/;

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


/**
 * Identidade do clone, gravada no banco: `gm-e2:clone:<hash da entrega ORIGINAL>:<hash da task ORIGINAL>`.
 * É por ela (não pelo nome normalizado) que `orfaos` acha os clones de UMA entrega e `soltar` reconhece o que é seu:
 * `GM10` não pega `GM-10`, `T-1` não solta o banco de `T1`. Id cru nunca entra no SQL.
 */
export const prefixoMarcaClone = (entrega) => `gm-e2:clone:${sha(entrega).slice(0, 16)}:`;
export const marcaClone = (entrega, task) => `${prefixoMarcaClone(entrega)}${sha(task).slice(0, 16)}`;

/** Template pronto: a marca carrega a SESSÃO (em hash). Outra sessão ⇒ o template é de outra migração e é refeito. */
export const marcaPronto = (sessao) => `gm-e2:template:pronto:${sha(String(sessao)).slice(0, 16)}`;
const ehPronto = (comentario) => comentario !== null && ER_PRONTO.test(comentario);

/** Identificador SQL citado. */
export const ident = (nome) => `"${String(nome).replaceAll('"', '""')}"`;
const literal = (txt) => `'${String(txt).replaceAll("'", "''")}'`;
const escLike = (txt) => txt.replace(/[\\%_]/g, (c) => `\\${c}`);

// ─────────────────────────────────────────────────────────────── config

/** `{ ok: true, na: true }` só com config válida SEM `db`; `{ ok: false, erro }` se inválido; `{ ok: true, db }` normalizado. */
export function validarDb(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, erro: 'config: esperado objeto JSON na raiz de harness.config.json' };
  const db = cfg.db;
  if (db === undefined) return { ok: true, na: true };
  if (db === null || typeof db !== 'object' || Array.isArray(db)) return { ok: false, erro: 'db: esperado objeto' };
  const argv = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '');
  if (!argv(db.psql)) return { ok: false, erro: 'db.psql: esperado lista de argumentos terminada em psql (ex.: ["docker","exec","-u","postgres","<contêiner>","psql"])' };
  // O plugin monta a conexão. O que vem ANTES do psql é invólucro; depois dele não pode vir nada (nem -h, -d, -U, URL, conninfo).
  const iPsql = db.psql.findIndex((x) => basename(x.replaceAll('\\', '/')) === 'psql');
  if (iPsql === -1) return { ok: false, erro: 'db.psql: nenhum argumento é o executável psql' };
  if (iPsql !== db.psql.length - 1) {
    return { ok: false, erro: 'db.psql: nada pode vir depois do psql; host, porta e banco são montados pelo plugin (db.host, db.porta, db.admin)' };
  }
  if (typeof db.template !== 'string' || db.template.trim() === '') return { ok: false, erro: 'db.template: nome do banco-template ausente' };
  if (TEMPLATES_PROIBIDOS.includes(db.template.trim().toLowerCase())) {
    return { ok: false, erro: `db.template: "${db.template}" é banco do sistema; o template tem de ser um banco só do Gabarito` };
  }
  if (db.template.trim().toLowerCase().startsWith(PREFIXO_TEMP)) {
    return { ok: false, erro: `db.template: o prefixo "${PREFIXO_TEMP}" é reservado ao preparo em curso` };
  }
  if (/[\u0000-\u001f]/.test(db.template) || Buffer.byteLength(db.template) > LIMITE_BYTES) {
    return { ok: false, erro: 'db.template: nome inválido (controle ou acima de 63 bytes)' };
  }
  if (db.migrar !== undefined && !argv(db.migrar)) return { ok: false, erro: 'db.migrar: esperado lista de argumentos' };
  const host = db.host === undefined ? 'localhost' : db.host;
  if (typeof host !== 'string' || !HOSTS_LOCAIS.includes(host)) {
    return { ok: false, erro: `host "${String(host)}" recusado: só localhost, 127.0.0.1 ou ::1 (igualdade exata)` };
  }
  let porta;
  if (db.porta !== undefined) {
    const forma = (typeof db.porta === 'number' && Number.isInteger(db.porta)) || (typeof db.porta === 'string' && /^[0-9]{1,5}$/.test(db.porta));
    const n = forma ? Number(db.porta) : NaN;
    if (!(n >= 1 && n <= 65535)) return { ok: false, erro: 'db.porta: esperado número de porta entre 1 e 65535' };
    porta = String(n);
  }
  const admin = db.admin === undefined ? 'postgres' : db.admin;
  if (typeof admin !== 'string' || !/^[A-Za-z0-9_]+$/.test(admin)) return { ok: false, erro: 'db.admin: esperado nome simples de banco ([A-Za-z0-9_]+)' };
  return { ok: true, db: { ...db, host, porta, admin } };
}

/** Cópia do ambiente SEM nenhuma `PG*` (PGHOST, PGSERVICE, PGHOSTADDR… redirecionam a conexão), salvo as de `manter`. */
function ambienteSemPg(origem = process.env, manter = []) {
  const env = {};
  for (const [k, v] of Object.entries(origem)) if (!k.toUpperCase().startsWith('PG') || manter.includes(k)) env[k] = v;
  return env;
}

// ─────────────────────────────────────────────────────────────── execução (argv, nunca shell)

class ErroDb extends Error {}

/** Roda um comando SQL por `db.psql` + `-h`/`-p`/`-d` do plugin. Cada chamada é UM comando (CREATE DATABASE não corre em transação). */
function criarSql(db, run = spawnSync) {
  const [exe, ...involuco] = db.psql;
  const conexao = ['-h', db.host, ...(db.porta ? ['-p', db.porta] : [])];
  const env = ambienteSemPg();
  return function sql(comando) {
    const r = run(exe, [...involuco, ...conexao, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db.admin, '-c', comando], {
      encoding: 'utf8', timeout: 120_000, env,
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
  if (out === '') return null; // nenhuma linha: o banco não existe
  if (out.startsWith('E:')) return out.slice(2);
  throw new ErroDb(`saída do psql fora da forma ao ler "${nome}" (esperava "E:<comentário>" ou nada; veio: ${JSON.stringify(out.slice(0, 80))}); nada foi alterado`);
}

const marcar = (sql, nome, marca) => sql(`COMMENT ON DATABASE ${ident(nome)} IS ${literal(marca)}`);

/** Solta um template (desmarca `IS_TEMPLATE` antes; senão "cannot drop a template database"). Só se o chamador já provou que é dele. */
function soltarBanco(sql, nome) {
  try { sql(`ALTER DATABASE ${ident(nome)} WITH IS_TEMPLATE false`); } catch { /* ainda não era template, ou já sumiu: o DROP abaixo decide */ }
  sql(`DROP DATABASE IF EXISTS ${ident(nome)} WITH (FORCE)`);
}

export const nomeTemporario = () => `${PREFIXO_TEMP}${process.pid.toString(16)}_${randomBytes(6).toString('hex')}`;

// ─────────────────────────────────────────────────────────────── operações

/**
 * Preparo atômico. O template final só passa a existir inteiro: migra em `gm_prep_<pid>_<rand>` (nome único por processo),
 * fecha conexões, marca a sessão e só então `RENAME` para `db.template`. Quem perde o rename solta o PRÓPRIO temporário e
 * reaproveita o vencedor (se a marca é a da sua sessão); nunca toca em banco de outro processo em preparo.
 */
export function preparar(db, sessao, { sql = criarSql(db), migrar = rodarMigrar, nomeTemp = nomeTemporario } = {}) {
  const t = db.template;
  const alvo = marcaPronto(sessao);
  if (!db.migrar) throw new ErroDb('db.migrar ausente: sem migração o template nasce vazio; declare o comando (com seed)');
  const atual = comentarioDe(sql, t);
  if (atual === alvo) return { estado: 'pronto', template: t, reaproveitado: true };
  if (atual !== null && !ehPronto(atual)) {
    throw new ErroDb(`o banco "${t}" já existe e não foi criado pelo Gabarito; recusado (escolha outro db.template)`);
  }
  const tmp = nomeTemp();
  let reaproveitado = false;
  sql(`CREATE DATABASE ${ident(tmp)}`);
  try {
    migrar(db, tmp);
    sql(`ALTER DATABASE ${ident(tmp)} WITH ALLOW_CONNECTIONS false`);
    if (sql('SELECT rolsuper FROM pg_roles WHERE rolname = current_user') !== 't') {
      sql(`ALTER DATABASE ${ident(tmp)} WITH IS_TEMPLATE true`);
    }
    marcar(sql, tmp, alvo); // só depois de tudo: falha antes disso não deixa nada "pronto"
    let presente = atual;
    if (presente !== null) presente = substituirAntigo(sql, t, alvo); // template de OUTRA sessão: sai só agora, com o novo já pronto
    if (presente === alvo) {
      reaproveitado = true; // outro processo da mesma sessão publicou antes
    } else {
      try {
        sql(`ALTER DATABASE ${ident(tmp)} RENAME TO ${ident(t)}`);
      } catch (e) {
        if (comentarioDe(sql, t) === alvo) reaproveitado = true; // perdi o rename para o mesmo preparo
        else throw new ErroDb(`não foi possível publicar o template "${t}" (${e.message}); o que está lá não é desta sessão e não foi tocado`);
      }
    }
  } catch (e) {
    try { soltarBanco(sql, tmp); } catch (e2) { e.message += ` | e o temporário "${tmp}" não pôde ser solto: ${e2.message}`; }
    throw e;
  }
  if (reaproveitado) soltarBanco(sql, tmp); // o temporário é MEU; o vencedor fica como está
  return { estado: 'pronto', template: t, reaproveitado };
}

/** Remove o template de outra sessão. Devolve a marca que ficou lá (`null` = livre; `alvo` = outro processo já publicou o novo). */
function substituirAntigo(sql, t, alvo) {
  const agora = comentarioDe(sql, t);
  if (agora === null || agora === alvo) return agora;
  if (!ehPronto(agora)) throw new ErroDb(`o banco "${t}" mudou de dono durante o preparo e não foi criado pelo Gabarito; recusado`);
  try {
    soltarBanco(sql, t);
  } catch (e) {
    const c = comentarioDe(sql, t);
    if (c === null || c === alvo) return c; // outro processo removeu/publicou entre a leitura e o drop
    throw e;
  }
  return null;
}

function rodarMigrar(db, banco) {
  const argv = db.migrar.map((a) => a.replaceAll('{db}', banco));
  const env = { ...ambienteSemPg(process.env, ['PGUSER', 'PGPASSWORD']), GABARITO_DB: banco, PGHOST: db.host, PGPORT: db.porta ?? '5432', PGDATABASE: banco };
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env });
  if (r.error || r.status !== 0) {
    const motivo = (r.error?.message ?? r.stderr ?? '').toString().trim().split('\n')[0] || `saída ${r.status}`;
    throw new ErroDb(`db.migrar falhou (${motivo}); o template temporário "${banco}" NÃO foi publicado e nenhum clone será feito`);
  }
}

export function clonar(db, entrega, task, { sql = criarSql(db) } = {}) {
  const nome = nomeBanco(entrega, task);
  if (!ehPronto(comentarioDe(sql, db.template))) {
    throw new ErroDb(`template "${db.template}" não está pronto; rode "preparar --sessao <id>" antes de clonar`);
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

/** Template: desmarca `IS_TEMPLATE` antes do drop. Só se a marca é nossa. */
export function soltarTemplate(db, { sql = criarSql(db) } = {}) {
  const t = db.template;
  const marca = comentarioDe(sql, t);
  if (marca === null) return { template: t, estado: 'ausente' };
  if (!ehPronto(marca)) throw new ErroDb(`o banco "${t}" não foi criado pelo Gabarito; não foi solto`);
  soltarBanco(sql, t);
  return { template: t, estado: 'solto' };
}

/**
 * Nomes de banco das worktrees vivas: as de `<principal>/.harness/worktrees/<task>` que existem e não estão prunable.
 * Por CAMINHO, não por branch (um rebase parado deixa a worktree em `detached`). A entrega não está no caminho: uma
 * worktree viva de mesma task em outra entrega também protege (erra para o lado de não listar). `principal` = 1º bloco.
 */
export function bancosVivos(entrega, porcelain, existe = existsSync) {
  const blocos = porcelain.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const caminhoDe = (b) => b.split('\n').find((l) => l.startsWith('worktree '))?.slice(9);
  const principal = blocos.length > 0 ? caminhoDe(blocos[0]) : undefined;
  if (!principal) throw new ErroDb('saída de "git worktree list --porcelain" sem a worktree principal; não dá para saber quais estão vivas');
  const pasta = join(principal, '.harness', 'worktrees');
  const vivos = new Set();
  for (const bloco of blocos.slice(1)) {
    const caminho = caminhoDe(bloco);
    if (!caminho || bloco.split('\n').some((l) => l.startsWith('prunable')) || !existe(caminho)) continue;
    if (caminho !== join(pasta, basename(caminho))) continue;
    try { vivos.add(nomeBanco(entrega, basename(caminho))); } catch { /* task ilegível: não vira "viva" */ }
  }
  return vivos;
}

/** Órfão = clone MARCADO da entrega exata (`marcaClone`), `gm_<entrega>_<task>` exato, sem worktree viva. Conexão aberta NÃO é prova de uso (S9/P4). */
export function orfaos(db, entrega, vivos, { sql = criarSql(db) } = {}) {
  const e = segmentoEntrega(entrega);
  const padrao = new RegExp(`^gm_${e}_[a-z0-9]+$`);
  const out = sql(
    `SELECT datname FROM pg_database WHERE datname LIKE ${literal(`${escLike(`gm_${e}_`)}%`)} ESCAPE '\\'`
    + ` AND shobj_description(oid, 'pg_database') LIKE ${literal(`${escLike(prefixoMarcaClone(entrega))}%`)} ESCAPE '\\' ORDER BY datname`,
  );
  return out.split('\n').map((l) => l.trim())
    .filter((n) => padrao.test(n) && Buffer.byteLength(n) <= LIMITE_BYTES && !vivos.has(n));
}

const pidVivo = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/** Temporário de preparo cujo dono (pid no nome) não existe mais. Só lista; quem agir sobre a lista decide (R2). */
export function temporariosSemDono(db, { sql = criarSql(db), vivo = pidVivo } = {}) {
  const out = sql(`SELECT datname FROM pg_database WHERE datname LIKE ${literal(`${escLike(PREFIXO_TEMP)}%`)} ESCAPE '\\' ORDER BY datname`);
  return out.split('\n').map((l) => l.trim()).filter((n) => {
    const m = /^gm_prep_([0-9a-f]+)_[0-9a-f]{12}$/.exec(n);
    return m !== null && Buffer.byteLength(n) <= LIMITE_BYTES && !vivo(parseInt(m[1], 16));
  });
}

// ─────────────────────────────────────────────────────────────── CLI

/** Config estrita: ausente, ilegível ou JSON inválido nunca vira `n/a`. */
function lerConfigEstrita(raiz) {
  const f = join(raiz, 'harness.config.json');
  let texto;
  try {
    texto = readFileSync(f, 'utf8');
  } catch (e) {
    return { erro: e.code === 'ENOENT' ? `harness.config.json ausente em ${raiz}` : `harness.config.json ilegível (${e.code ?? e.message})` };
  }
  try {
    return { cfg: JSON.parse(texto) };
  } catch (e) {
    return { erro: `harness.config.json inválido (${String(e.message).split('\n')[0]})` };
  }
}

function worktreesVivas(raiz) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: raiz, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const motivo = (r.error?.message ?? r.stderr ?? '').toString().trim().split('\n')[0] || `saída ${r.status}`;
    throw new ErroDb(`git worktree list falhou (${motivo}); sem isso não dá para saber quais worktrees estão vivas`);
  }
  return r.stdout;
}

function main(argv) {
  const cmd = argv[0];
  const uso = 'uso: db-template.mjs preparar --sessao <id> | clonar <task> --entrega <id> | soltar <task> --entrega <id> | soltar-template | orfaos --entrega <id>';
  if (!['preparar', 'clonar', 'soltar', 'soltar-template', 'orfaos'].includes(cmd)) {
    process.stderr.write(`${uso}\n`);
    return 2;
  }
  const entrega = arg(argv, 'entrega', undefined);
  const sessao = arg(argv, 'sessao', undefined);
  const task = cmd === 'clonar' || cmd === 'soltar' ? argv[1] : undefined;
  if ((cmd === 'clonar' || cmd === 'soltar') && (!task || task.startsWith('--') || !entrega)) { process.stderr.write(`${uso}\n`); return 2; }
  if (cmd === 'orfaos' && !entrega) { process.stderr.write(`${uso}\n`); return 2; }
  if (cmd === 'preparar' && (!sessao || sessao.startsWith('--'))) { process.stderr.write(`db-template: preparar exige --sessao <id> (o template vale por sessão)\n${uso}\n`); return 2; }
  const raiz = raizDoRepo();
  const lida = lerConfigEstrita(raiz);
  if (lida.erro) { process.stderr.write(`db-template: ${lida.erro}\n`); return 1; }
  const v = validarDb(lida.cfg);
  if (!v.ok) { process.stderr.write(`db-template: ${v.erro}\n`); return 1; }
  if (v.na) { process.stdout.write('n/a\n'); return 0; }
  try {
    let saida;
    if (cmd === 'preparar') saida = preparar(v.db, sessao);
    else if (cmd === 'clonar') saida = clonar(v.db, entrega, task);
    else if (cmd === 'soltar') saida = soltar(v.db, entrega, task);
    else if (cmd === 'soltar-template') saida = soltarTemplate(v.db);
    else saida = { orfaos: orfaos(v.db, entrega, bancosVivos(entrega, worktreesVivas(raiz))), temporarios: temporariosSemDono(v.db) };
    process.stdout.write(`${JSON.stringify(saida)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`db-template: ${e.message}\n`);
    return 1;
  }
}

if (ehEntrypoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));

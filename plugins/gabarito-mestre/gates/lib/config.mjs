/** Leitura de JSON e de harness.config.json. Zero dependência. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';

/** null = ausente · undefined = JSON inválido/ilegível · {} = arquivo vazio (quem chama decide o que fazer com cada um). */
export function lerJson(caminho) {
  if (!existsSync(caminho)) return null;
  try {
    const t = readFileSync(caminho, 'utf8');
    return t.trim() === '' ? {} : JSON.parse(t);
  } catch {
    return undefined;
  }
}

/**
 * `harness.config.json` da raiz, sobre `defaults` (merge raso). Ausente/inválido → `cfg: null` + `failOpen`
 * com o motivo (fail-open declarado, G9); nunca lança.
 */
export function lerConfig(raiz, defaults = {}) {
  const f = join(raiz, 'harness.config.json');
  if (!existsSync(f)) return { cfg: null, failOpen: 'harness.config.json ausente' };
  let raw;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8') || '{}');
  } catch (e) {
    return { cfg: null, failOpen: `harness.config.json inválido (${String(e.message).split('\n')[0]})` };
  }
  return { cfg: { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) }, failOpen: null };
}

/** Ref remota fixa. Resolvida por casamento EXATO (`for-each-ref`), nunca por `git show <nome>`: o DWIM do git cairia em `refs/heads/…`/`refs/tags/…` homônimos (forjáveis por `git branch|tag`). */
const REF_ORIGIN = 'refs/remotes/origin/HEAD';

/** Variáveis que redirecionam o git para outro repositório/objetos — nunca herdadas pela leitura da guarda. */
const GIT_ENV_PROIBIDO = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
];

/** `git --no-replace-objects <args>` (ignora `refs/replace`), ambiente sem redirecionamento; lança em erro. */
function gitSeguro(args, cwd) {
  const env = { ...process.env };
  for (const k of GIT_ENV_PROIBIDO) delete env[k];
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** Cópia de `v` sem nenhuma chave `permitidos` em qualquer aninhamento (fonte local não concede permissão). */
function semPermitidos(v) {
  if (Array.isArray(v)) return v.map(semPermitidos);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'permitidos').map(([k, x]) => [k, semPermitidos(x)]));
  }
  return v;
}

/** `harness.config.json` parseado → { config: ConfigGuarda, branchPadrao } (ou null). `permitidos` vem só de `guarda.producao.permitidos`. */
function paraGuarda(raw, { zerarPermitidos }) {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw.guarda && typeof raw.guarda === 'object' ? raw.guarda : {};
  const branchPadrao = typeof raw.versionamento?.branchPadrao === 'string' ? raw.versionamento.branchPadrao : null;
  let ambientes = g.ambientes && typeof g.ambientes === 'object' ? g.ambientes : {};
  if (zerarPermitidos) ambientes = semPermitidos(ambientes);
  ambientes = { ...ambientes };
  if (branchPadrao || ambientes.prod) {
    // default de `branches` do ambiente de produção = branchPadrao da MESMA fonte
    const atual = ambientes.prod && typeof ambientes.prod === 'object' && !Array.isArray(ambientes.prod) ? ambientes.prod : {};
    ambientes.prod = { ...atual, branches: Array.isArray(atual.branches) ? atual.branches : branchPadrao ? [branchPadrao] : [] };
  }
  const lista = g.producao?.permitidos;
  const permitidos = zerarPermitidos || !Array.isArray(lista) ? [] : lista.filter((p) => typeof p === 'string');
  return { config: { ambientes, permitidos }, branchPadrao };
}

/**
 * Config da guarda lida de `refs/remotes/origin/HEAD:harness.config.json` (D2) — duas chamadas de git:
 * (1) objeto da ref por casamento exato; (2) blob pelo SHA. Sem remoto / symref pendurado / arquivo ausente
 * ou inválido na ref ⇒ `fonte: 'local'`, `permitidos` vazio. `divergente`: `guarda` local ≠ a da ref (deep equal).
 */
export function lerGuarda(raiz) {
  const local = lerJson(join(raiz, 'harness.config.json'));
  const localRaw = local && typeof local === 'object' ? local : null;
  let origin = null;
  try {
    const linhas = gitSeguro(['for-each-ref', '--format=%(refname) %(objectname)', REF_ORIGIN], raiz)
      .split('\n')
      .filter(Boolean);
    const [nome, sha] = (linhas[0] ?? '').split(' ');
    if (linhas.length === 1 && nome === REF_ORIGIN && /^[0-9a-f]{40,64}$/.test(sha ?? '')) {
      const raw = JSON.parse(gitSeguro(['show', `${sha}:harness.config.json`], raiz));
      if (raw && typeof raw === 'object') origin = raw;
    }
  } catch {
    origin = null;
  }
  if (origin) {
    const { config, branchPadrao } = paraGuarda(origin, { zerarPermitidos: false });
    const divergente = !isDeepStrictEqual(localRaw?.guarda ?? null, origin.guarda ?? null);
    return { config, fonte: 'origin', divergente, branchPadrao };
  }
  const l = paraGuarda(localRaw, { zerarPermitidos: true });
  return { config: l?.config ?? null, fonte: 'local', divergente: false, branchPadrao: l?.branchPadrao ?? null };
}

/** `permissions.deny` da 2ª camada da guarda (REQ-GRD-5). Sem `./` (profundidade qualquer) e nunca `Write(…)`. */
export const DENY_GUARDA = [
  'Read(.env*)',
  'Read(!.env.example)',
  'Edit(.env*)',
  'Read(**/*.pem)',
  'Edit(**/*.pem)',
  'Read(**/*.key)',
  'Edit(**/*.key)',
];

/** Chaves de `harness.config.json` que nenhum gate lê mais (REQ-INF-2). `attest.squash-titulo-pr` é tratada à parte (é atestado). */
export const CHAVES_MORTAS = [
  'migrationsDir',
  'versionamento.modelo',
  'versionamento.commit',
  'orquestracao.sempreSubagente',
  'orquestracao.paralelismo.modo',
];

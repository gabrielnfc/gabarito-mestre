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
 * `harness.config.json` de `refs/remotes/origin/HEAD` parseado, ou `raw: null` com o `motivo` — duas chamadas de git: (1) objeto da ref por casamento
 * exato; (2) blob pelo SHA. Fonte única da resolução de `REF_ORIGIN` (D2): `lerGuarda` e `lerConfigOrigin` passam por aqui, nenhuma lê a ref por conta
 * própria. Nunca lança. `raw` é o que o JSON for (objeto ou array): quem chama decide o que aceita.
 */
function lerRawOrigin(raiz) {
  let sha;
  try {
    const linhas = gitSeguro(['for-each-ref', '--format=%(refname) %(objectname)', REF_ORIGIN], raiz)
      .split('\n')
      .filter(Boolean);
    const [nome, objeto] = (linhas[0] ?? '').split(' ');
    if (linhas.length !== 1 || nome !== REF_ORIGIN || !/^[0-9a-f]{40,64}$/.test(objeto ?? '')) return { raw: null, invalida: false, motivo: 'sem refs/remotes/origin/HEAD' };
    sha = objeto;
  } catch {
    return { raw: null, invalida: false, motivo: 'sem refs/remotes/origin/HEAD' };
  }
  let blob;
  try {
    blob = gitSeguro(['show', `${sha}:harness.config.json`], raiz);
  } catch {
    return { raw: null, invalida: false, motivo: 'harness.config.json ausente em origin/HEAD' };
  }
  try {
    const raw = JSON.parse(blob);
    return raw && typeof raw === 'object'
      ? { raw, invalida: false, motivo: null }
      : { raw: null, invalida: true, motivo: 'harness.config.json de origin/HEAD inválido (não é objeto JSON)' };
  } catch {
    return { raw: null, invalida: true, motivo: 'harness.config.json de origin/HEAD inválido (JSON ilegível)' };
  }
}

/**
 * Config da guarda lida de `refs/remotes/origin/HEAD:harness.config.json` (D2). Sem remoto / symref pendurado / arquivo ausente
 * ou inválido na ref ⇒ `fonte: 'local'`, `permitidos` vazio. `divergente`: `guarda` local ≠ a da ref (deep equal).
 */
export function lerGuarda(raiz) {
  const local = lerJson(join(raiz, 'harness.config.json'));
  const localRaw = local && typeof local === 'object' ? local : null;
  const { raw: origin } = lerRawOrigin(raiz);
  if (origin) {
    const { config, branchPadrao } = paraGuarda(origin, { zerarPermitidos: false });
    const divergente = !isDeepStrictEqual(localRaw?.guarda ?? null, origin.guarda ?? null);
    return { config, fonte: 'origin', divergente, branchPadrao };
  }
  const l = paraGuarda(localRaw, { zerarPermitidos: true });
  return { config: l?.config ?? null, fonte: 'local', divergente: false, branchPadrao: l?.branchPadrao ?? null };
}

/**
 * `harness.config.json` de `refs/remotes/origin/HEAD` por inteiro (E3: `entrega.*`, `sombra.*`), mesma resolução de `lerGuarda`: ref de nome completo,
 * nunca a árvore local nem uma branch homônima. Nunca lança. `{ cfg, fonte: 'origin', motivo: null }` só com objeto JSON; senão `{ cfg: null, fonte: 'nenhuma',
 * motivo }` com motivos distintos para ausente (sem remoto, sem ref, sem arquivo) e corrompido (JSON ilegível, array, escalar): ausente não vira corrompido.
 * Quem lê `fonte: 'nenhuma'` aplica o default seguro (`sob_demanda`, sem comandos); nada vira sucesso por faltar config.
 */
export function lerConfigOrigin(raiz) {
  try {
    const { raw, invalida, motivo } = lerRawOrigin(raiz);
    if (raw === null) return { cfg: null, fonte: 'nenhuma', invalida, motivo };
    if (Array.isArray(raw)) return { cfg: null, fonte: 'nenhuma', invalida: true, motivo: 'harness.config.json de origin/HEAD inválido (array, esperado objeto)' };
    return { cfg: raw, fonte: 'origin', invalida: false, motivo: null };
  } catch (e) {
    return { cfg: null, fonte: 'nenhuma', invalida: true, motivo: `origin/HEAD ilegível (${e instanceof Error ? e.message.split('\n')[0] : 'erro desconhecido'})` };
  }
}

/** Perfil de modelo por papel (REQ-MOD-1). O doctor avisa abaixo do recomendado; nunca bloqueia. */
export const MODELOS_PADRAO = Object.freeze({
  implementador: Object.freeze({ modelo: 'sonnet', esforco: 'high' }),
  revisor: Object.freeze({ modelo: 'opus' }),
  sombra: Object.freeze({ modelo: 'opus' }),
  revisor_final: Object.freeze({ modelo: 'fable' }),
  spike: Object.freeze({ modelo: 'opus' }),
  basico: Object.freeze({ modelo: 'haiku' }),
});

/** Ordem das famílias de modelo; o esforço não entra na comparação (Sombra D5). */
export const ORDEM_MODELO = Object.freeze({ haiku: 0, sonnet: 1, opus: 2, fable: 3 });

const congela = (t) => Object.freeze(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Object.freeze({ ...v })])));

/**
 * Perfis de modelo (E5a, Sombra r3): `orquestracao.perfil` escolhe a tabela por papel. `padrao` é `MODELOS_PADRAO`; Fable só no review final em todo perfil
 * (`qualidade`). `orquestracao.modelos.<papel>` explícito vence o perfil (`resolverModelo`).
 */
export const PERFIS_MODELO = Object.freeze({
  economia: congela({
    implementador: { modelo: 'sonnet', esforco: 'medium' },
    revisor: { modelo: 'sonnet' },
    sombra: { modelo: 'opus' },
    revisor_final: { modelo: 'opus' },
    spike: { modelo: 'sonnet' },
    basico: { modelo: 'haiku' },
  }),
  padrao: MODELOS_PADRAO,
  qualidade: congela({
    implementador: { modelo: 'opus', esforco: 'high' },
    revisor: { modelo: 'opus' },
    sombra: { modelo: 'opus' },
    revisor_final: { modelo: 'fable' },
    spike: { modelo: 'opus' },
    basico: { modelo: 'sonnet' },
  }),
});

/**
 * Modelo de um papel: `orquestracao.modelos.<papel>` (texto ou `{modelo, esforco?}`; família = 1ª de haiku|sonnet|opus|fable contida no nome em caixa baixa)
 * > tabela do `orquestracao.perfil` > `MODELOS_PADRAO`. `fonte`: `explicito`, `perfil` (economia|qualidade) ou `padrao`. Ausente ≠ corrompido: `orquestracao`,
 * `perfil` ou `modelos` ausentes ⇒ padrão sem aviso; presentes e que não se entendem ⇒ o valor do perfil (ou padrão) com `aviso`. Papel fora da tabela lança.
 */
export function resolverModelo(orquestracao, papel) {
  if (!Object.hasOwn(MODELOS_PADRAO, papel)) throw new TypeError(`papel desconhecido: ${JSON.stringify(papel)}`);
  const familias = Object.keys(ORDEM_MODELO);
  const avisos = [];
  let perfil = 'padrao';
  const orq = orquestracao;
  const orqOk = orq !== null && typeof orq === 'object' && !Array.isArray(orq);
  if (orq !== undefined && !orqOk) avisos.push('`orquestracao` em harness.config.json não é um objeto');
  if (orqOk && Object.hasOwn(orq, 'perfil')) {
    if (typeof orq.perfil === 'string' && Object.hasOwn(PERFIS_MODELO, orq.perfil)) perfil = orq.perfil;
    else avisos.push(`orquestracao.perfil inválido (${JSON.stringify(orq.perfil)}): esperado economia, padrao ou qualidade`);
  }
  const base = () => {
    const t = PERFIS_MODELO[perfil][papel];
    const fonte = perfil === 'padrao' ? 'padrao' : 'perfil';
    return { modelo: t.modelo, ...(t.esforco !== undefined ? { esforco: t.esforco } : {}), fonte, nome: perfil === 'padrao' ? `o padrão ${t.modelo}` : `o do perfil ${perfil} (${t.modelo})` };
  };
  const saida = (r) => {
    const { nome, ...resto } = r;
    const aviso = avisos.length ? avisos.map((a) => (a.includes('usei') ? a : `${a}; usei ${nome}`)).join('; ') : undefined;
    return { ...resto, ...(aviso !== undefined ? { aviso } : {}) };
  };
  const cai = (m) => { avisos.push(m); return saida(base()); };
  if (!orqOk) return saida(base());
  const modelos = orq.modelos;
  if (modelos === undefined) return saida(base());
  if (modelos === null || typeof modelos !== 'object' || Array.isArray(modelos)) return cai('orquestracao.modelos inválido (não é um objeto)');
  if (!Object.hasOwn(modelos, papel)) return saida(base());
  const e = modelos[papel];
  let nome;
  let esforco;
  if (typeof e === 'string') nome = e;
  else if (e !== null && typeof e === 'object' && !Array.isArray(e) && typeof e.modelo === 'string' && (e.esforco === undefined || (typeof e.esforco === 'string' && e.esforco !== ''))) {
    nome = e.modelo;
    esforco = e.esforco;
  } else return cai(`orquestracao.modelos.${papel} inválido (esperado texto ou {modelo, esforco?})`);
  const familia = familias.find((f) => nome.toLowerCase().includes(f));
  if (familia === undefined) return cai(`orquestracao.modelos.${papel} ${JSON.stringify(nome)} não é haiku, sonnet, opus nem fable`);
  return saida({ modelo: familia, ...(esforco !== undefined ? { esforco } : {}), fonte: 'explicito', nome: '' });
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

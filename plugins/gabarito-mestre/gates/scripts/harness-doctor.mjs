#!/usr/bin/env node
/**
 * GATE §0.2 — harness-doctor.
 *
 * Este é o gate que fecha a contradição central do harness: um documento que diz
 * "convenção escrita não sobrevive à pressa" (I12) e é inteiramente convenção escrita.
 *
 * O doctor varre o repositório procurando EVIDÊNCIA de cada gate, calcula o nível de
 * adoção REAL, lê o nível DECLARADO no `AGENTS.md §0.2` e **reprova quando o declarado
 * é maior que o alcançado**. É o que impede o documento de mentir sobre si mesmo.
 *
 * Ele não julga qualidade — julga existência. Um gate presente e mal escrito passa
 * aqui e é pego no review. O que ele mata é o nível inflado.
 *
 * Checagens que NENHUMA varredura pode provar (proteção de branch, backup testado)
 * vivem em `.harness/attest.json`: atestado nominal, com data e autor. Atestado é (c),
 * não (a) — mas datado e revisável vale muito mais que presumido.
 *
 * 1.1.0: oito checagens novas (fluxo, Iniciativa atestada, versionamento, changelog, tag,
 * tamanho do AGENTS.md, paralelismo calibrado) e um aviso (modelo resolvido, que NÃO entra
 * no nível). Config inválida é fail-open declarado: checagens de config ficam FALTA, nunca
 * stack trace.
 *
 * USO
 *   node harness-doctor.mjs            # tabela + veredito, sai !=0 se o nível mentir
 *   node harness-doctor.mjs --json     # saída para máquina
 *   node harness-doctor.mjs --explain  # inclui como consertar cada item faltante
 *   node harness-doctor.mjs --cache    # grava .harness/doctor-cache.json { nivel, declarado, em } (lido pelo cartão de sessão)
 *
 * 2.0 (E1): reporta a CAMADA DE GUARDA (ativa · configurada · permissions.deny · nenhuma), com a fonte da
 * config (origin|local) e se a árvore diverge do origin/HEAD; lista os ambientes declarados; entende o
 * perfil `repo-sem-app` (só G3 e teardown viram n/a); varre por `git ls-files` (arquivo ignorado não é
 * evidência); G8 não aceita `.md`; avisa chaves removidas. Nada disso muda o nível além do perfil.
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, renameSync, lstatSync, openSync, fstatSync, readSync, closeSync, constants as fsConstants } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { ehEntrypoint } from '../lib/cli.mjs';
import { lerGuarda, DENY_GUARDA, CHAVES_MORTAS, MODELOS_PADRAO, ORDEM_MODELO } from '../lib/config.mjs';
import { diasEntre } from '../lib/datas.mjs';
import { execFileSync } from 'node:child_process';
import { checar, DEFAULTS as VERSIONAMENTO_DEFAULTS } from './versionamento-check.mjs';
import { validarDb } from './db-template.mjs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo',
  '.cache', 'out', 'vendor', '__pycache__', '.venv',
]);

const DEFAULTS = {
  agentsFile: 'AGENTS.md',
  docsDir: 'docs',
  ciDir: '.github/workflows',
  attestFile: '.harness/attest.json',
  sourceExts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  /**
   * Caminhos invisíveis para a varredura de EVIDÊNCIA.
   *
   * O doctor precisa se excluir: o arquivo que define as checagens contém, por
   * construção, o texto de todos os padrões que ele procura — e sem esta exclusão ele
   * se detecta como evidência de gates que o repositório não tem. Foi um falso
   * positivo real, achado rodando o doctor sobre o próprio repositório do harness.
   *
   * Os TESTES dos gates também: uma suíte que exercita a guarda não prova que a guarda
   * está LIGADA no client da aplicação.
   */
  excludePaths: [
    'harness-gates/',
    // O pacote de gates inteiro, em qualquer local de instalação: `src/` e `eslint/` contêm
    // por construção os nomes que as checagens procuram (massMutationGuard, assertNotProduction…),
    // e a presença da BIBLIOTECA não prova que ela está LIGADA na aplicação.
    'gabarito-gates/', 'gabarito-mestre/gates/', 'gabarito-mestre/reference/',
    // RULING F3-R8: os hooks do plugin e seus testes citam commit, versão, produção etc.
    // por construção (é o vocabulário do próprio harness) — presença ali não prova nada
    // sobre a APLICAÇÃO que instalou o harness.
    'gabarito-mestre/hooks/',
    // RULING F4-R10: templates do plugin são o que ele INSTALA no repo do usuário; a
    // presença deles no próprio plugin não prova nada sobre a aplicação que os adotou.
    'gabarito-mestre/templates/',
  ],
};

// ────────────────────────────────────────────────────────────── varredura

function walk(root, onFile) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        onFile(join(dir, e.name));
      }
    }
  }
}

/** Sem redirecionamento herdado: GIT_DIR & cia apontariam o git para outro repositório. */
function envGit() {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  return env;
}

/**
 * Arquivos que o git enxerga (rastreados + novos não ignorados), relativos à raiz — ou null (sem git, ou `root` não é
 * a raiz do repo: aí o disco é a verdade e a varredura cai para o `walk`). Com `.git` presente mas o git ilegível
 * (índice corrompido, rc ≠ 0) devolve [] — nada vale como evidência; reabrir o disco reabriria o A2.
 * `-z`: caminho com espaço ou não ASCII chega cru, sem aspas.
 */
function arquivosDoGit(root) {
  try {
    const opts = { cwd: root, encoding: 'utf8', env: envGit(), stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 };
    if (execFileSync('git', ['rev-parse', '--show-prefix'], opts).trim() !== '') return null;
    const lista = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], opts).split('\0').filter(Boolean);
    return [...new Set(lista)].filter((r) => {
      if (r.split('/').some((seg) => SKIP_DIRS.has(seg))) return false;
      try {
        return lstatSync(join(root, r)).isFile(); // symlink e submódulo ficam de fora, como no walk
      } catch {
        return false; // rastreado mas apagado do disco
      }
    });
  } catch {
    // marca `ilegivel`: o chamador distingue "não sei" de "não existe" (R2-1)
    return existsSync(join(root, '.git')) ? Object.assign([], { ilegivel: true }) : null;
  }
}

/** toplevel do repo de `cwd` — com `GIT_DIR` & cia do ambiente (hook do git, CI) limpos, ou o próprio `cwd`. */
function raizSemGitDirHerdado(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', env: envGit(), stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd;
  } catch {
    return cwd;
  }
}

/** O que conta como evidência neste repo: a lista do git, ou a varredura do disco quando não há git. */
function arquivosVisiveis(root) {
  const doGit = arquivosDoGit(root);
  if (doGit) return doGit;
  const files = [];
  walk(root, (f) => files.push(f));
  return files.map((f) => relative(root, f).split(sep).join('/'));
}

function createIndex(root, cfg, rel0 = arquivosVisiveis(root)) {
  // Evidência = o que o git enxerga (ou o disco, sem git). `has` e `read` obedecem ao MESMO conjunto, sem o filtro de
  // excludePaths: arquivo ignorado (.gitignore, .git/info/exclude) não existe para o doctor, em nenhum caminho.
  const visiveis = new Set(rel0);
  const excluir = cfg.excludePaths ?? [];
  const rel = rel0.filter((r) => !excluir.some((p) => r.includes(p)));
  const cache = new Map();

  const read = (r) => {
    if (!cache.has(r)) {
      if (!visiveis.has(r)) {
        cache.set(r, '');
        return '';
      }
      try {
        cache.set(r, readFileSync(join(root, r), 'utf8'));
      } catch {
        cache.set(r, '');
      }
    }
    return cache.get(r);
  };

  let guarda; // lerGuarda custa 2 spawns de git: uma vez por run()
  const lerGuardaUmaVez = () => (guarda ??= lerGuarda(root));

  const isSource = (r) => cfg.sourceExts.some((ext) => r.endsWith(ext));
  const isTest = (r) => /(\.|\/)(spec|test)\.[cm]?[jt]sx?$/.test(r) || r.includes('/test/') || r.includes('/__tests__/');

  return {
    root,
    files: rel,
    read,
    has: (r) => visiveis.has(r),
    guarda: lerGuardaUmaVez,
    /** Procura um padrão nos arquivos que casam o filtro. Devolve o primeiro caminho, ou null. */
    grep(pattern, filter = isSource) {
      const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      for (const r of rel) {
        if (!filter(r)) continue;
        if (re.test(read(r))) return r;
      }
      return null;
    },
    grepAll(pattern, filter = isSource) {
      const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      return rel.filter((r) => filter(r) && re.test(read(r)));
    },
    isSource,
    isTest,
  };
}

// ────────────────────────────────────────────────────────────── atestados

function loadAttest(ix, cfg) {
  if (!ix.has(cfg.attestFile)) return {};
  try {
    return JSON.parse(ix.read(cfg.attestFile));
  } catch {
    return {};
  }
}

/** Atestado vale por 180 dias — depois disso vira "não sei", que é "não". */
const ATTEST_TTL_DAYS = 180;

function attestOk(attest, id) {
  const a = attest[id];
  if (!a || a.confirmado !== true || !a.em || !a.por) return null;
  const dias = diasEntre(String(a.em), Date.now()); // String: `em` numérico no JSON continua inválido (Date.parse(String) → NaN)
  if (Number.isNaN(dias)) return null;
  if (dias > ATTEST_TTL_DAYS) return { stale: true, ...a, dias: Math.round(dias) };
  return { stale: false, ...a, dias: Math.round(dias) };
}

// ────────────────────────────────────────────────────────────── 1.1.0 — auxiliares

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const diasDesde = (data) => {
  const d = diasEntre(String(data), Date.now());
  return Number.isNaN(d) ? null : d;
};

/** ids das checagens novas da 1.1.0 — a linha "rode o onboarding" só aparece por causa delas. */
export const NOVAS_1_1_0 = [
  'fluxo-configurado', 'iniciativa-resolvida', 'versionamento', 'changelog',
  'tag-semver', 'agents-tamanho', 'paralelismo-calibrado', 'modelo-resolvido',
];

/**
 * Bytes UTF-8 do núcleo (tudo antes do PRIMEIRO cabeçalho de linha que começa com `## Apêndice`,
 * inclusive a quebra de linha anterior) e do Apêndice. CRLF conta bytes reais. Sem Apêndice: 0.
 */
export function tamanhoAgents(texto) {
  const t = String(texto ?? '');
  const m = /(^|\r?\n)## Apêndice/.exec(t);
  const corte = m ? m.index + m[1].length : t.length;
  return { nucleo: Buffer.byteLength(t.slice(0, corte), 'utf8'), apendice: Buffer.byteLength(t.slice(corte), 'utf8') };
}

// ────────────────────────────────────────────────────────────── checagens

/**
 * level 1 = segurança · 2 = processo · 3 = completo
 * kind  'scan'   → provado por varredura (a)
 *       'attest' → atestado nominal e datado (c)
 */
export const CHECKS = [
  // ── Nível 1 — segurança
  {
    id: 'G3-mass-mutation',
    rule: 'R2 / G3',
    level: 1,
    kind: 'scan',
    label: 'guarda de mutação em massa instalada',
    fix: 'instale massMutationGuard() no client de banco e cubra com teste que reproduza o filtro vazio',
    detect: (ix) => {
      const f = ix.grep(/massMutationGuard|hasEffectiveFilter/);
      const wired = ix.grep(/\$extends\s*\(\s*[\s\S]{0,80}massMutationGuard/);
      if (!f) return { found: false };
      return { found: true, evidence: wired ?? f, warn: wired ? null : 'guarda existe mas não achei o ponto onde ela é ligada ao client' };
    },
  },
  {
    id: 'G3-strict-undefined',
    rule: 'R2 / G3',
    level: 1,
    kind: 'scan',
    label: 'checagem estrita de `undefined` no client de banco',
    fix: 'ligue a checagem estrita de undefined do seu ORM (a guarda de runtime sozinha é uma barreira só)',
    detect: (ix) => {
      const f = ix.grep(/strictUndefinedChecks|findUndefinedPath/);
      return f ? { found: true, evidence: f } : { found: false };
    },
  },
  {
    id: 'teardown-por-id',
    rule: 'R2 / R12',
    level: 1,
    kind: 'scan',
    label: 'nenhum teardown com filtro vazio nos testes',
    fix: 'todo teardown restringe ao que a própria suíte criou, com `if (!id) return`',
    detect: (ix) => {
      // Verde por vacuidade é verde mentindo (§9.5): um repo SEM testes não pode
      // alegar teardown seguro — ele não tem teardown nenhum para ser seguro.
      const testes = ix.files.filter(ix.isTest);
      if (testes.length === 0) {
        return { found: false, evidence: 'nenhum arquivo de teste — nada a atestar' };
      }
      const suspeitos = ix
        .grepAll(
          /(deleteMany|updateMany)\s*\(\s*\)|(deleteMany|updateMany)\s*\(\s*\{\s*\}\s*\)|where:\s*\{\s*\}/,
          ix.isTest,
        )
        .filter((r) => !/allowFullScan/.test(ix.read(r)));
      return suspeitos.length === 0
        ? { found: true, evidence: `${testes.length} arquivo(s) de teste, nenhum filtro vazio` }
        : { found: false, evidence: `${suspeitos.length} arquivo(s): ${suspeitos.slice(0, 3).join(', ')}` };
    },
  },
  {
    id: 'R3-prod-guard',
    rule: 'R3',
    level: 1,
    kind: 'scan',
    label: 'trava que impede a suíte de apontar para produção',
    fix: 'chame assertNotProduction() nos entrypoints do runner de testes',
    detect: (ix) => {
      const f = ix.grep(/assertNotProduction|ProductionAccessBlocked/);
      return f ? { found: true, evidence: f } : { found: false };
    },
  },
  {
    id: 'secrets-fora-do-repo',
    rule: 'R3',
    level: 1,
    kind: 'scan',
    label: 'segredo fora do repo (.env ignorado, exemplo com valores vazios)',
    fix: 'adicione .env ao .gitignore e deixe o .env.example com todos os valores de segredo vazios',
    detect: (ix) => {
      const gi = ix.has('.gitignore') ? ix.read('.gitignore') : '';
      const ignora = /^\s*\.env\b/m.test(gi) || /^\s*\*\.env/m.test(gi);
      const exemplo = ix.files.find((r) => /(^|\/)\.env\.example$/.test(r));
      if (!ignora) return { found: false, evidence: '.env não está no .gitignore' };
      if (!exemplo) return { found: true, evidence: '.gitignore ok', warn: 'sem .env.example' };
      const preenchido = ix
        .read(exemplo)
        .split('\n')
        .find((l) => /(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)\s*=\s*\S/i.test(l) && !/=\s*(""|''|<|\$\{)/.test(l));
      return preenchido
        ? { found: false, evidence: `${exemplo} tem valor de segredo preenchido` }
        : { found: true, evidence: `${exemplo} com valores vazios` };
    },
  },
  {
    id: 'branch-protegida',
    rule: 'R1',
    level: 1,
    kind: 'attest',
    label: 'branch protegida — nada entra sem PR',
    fix: 'ative a proteção de branch e ateste em .harness/attest.json',
  },
  {
    id: 'backup-verificado',
    rule: 'R2',
    level: 1,
    kind: 'attest',
    label: 'backup verificado por read-back (censo de linhas, não só o arquivo)',
    fix: 'gere um backup, conte linhas no arquivo gerado e ateste em .harness/attest.json',
  },

  // ── Nível 2 — processo
  {
    id: 'docs-estrutura',
    rule: 'R17',
    level: 2,
    kind: 'scan',
    label: 'specs, plans e backlog versionados',
    fix: 'crie docs/specs/, docs/plans/ e docs/backlog.md',
    detect: (ix, cfg) => {
      const specs = ix.files.some((r) => r.startsWith(`${cfg.docsDir}/`) && /\/specs?\//.test(r));
      const plans = ix.files.some((r) => r.startsWith(`${cfg.docsDir}/`) && /\/plan(s|os)?\//.test(r));
      const backlog = ix.files.some((r) => /backlog\.md$/i.test(r));
      const faltando = [!specs && 'specs', !plans && 'plans', !backlog && 'backlog.md'].filter(Boolean);
      return faltando.length
        ? { found: false, evidence: `faltando: ${faltando.join(', ')}` }
        : { found: true, evidence: `${cfg.docsDir}/` };
    },
  },
  {
    id: 'ledger-versionado',
    rule: '§2.3',
    level: 2,
    kind: 'scan',
    label: 'ledger de execução versionado (não gitignored)',
    fix: 'versione o ledger — ledger gitignored morre com a máquina',
    detect: (ix) => {
      const l = ix.files.find((r) => /(progress|ledger)\.md$/i.test(r));
      if (!l) return { found: false, evidence: 'nenhum ledger encontrado' };
      const gi = ix.has('.gitignore') ? ix.read('.gitignore') : '';
      const ignorado = l.split('/').some((seg) => new RegExp(`^\\s*${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?\\s*$`, 'm').test(gi));
      return ignorado ? { found: false, evidence: `${l} parece gitignored` } : { found: true, evidence: l };
    },
  },
  {
    id: 'pr-template',
    rule: '§3.4',
    level: 2,
    kind: 'scan',
    label: 'template de PR com os itens obrigatórios',
    fix: 'crie o template com: requisito que fecha · migration compatível · plano de volta · janela de deploy · teardown',
    detect: (ix) => {
      const t = ix.files.find((r) => /pull_request_template\.md$/i.test(r) || /PULL_REQUEST_TEMPLATE/i.test(r));
      if (!t) return { found: false };
      const c = ix.read(t).toLowerCase();
      const itens = ['migration', 'requisito', 'teardown'];
      const faltando = itens.filter((i) => !c.includes(i));
      return faltando.length
        ? { found: true, evidence: t, warn: `sem menção a: ${faltando.join(', ')}` }
        : { found: true, evidence: t };
    },
  },
  {
    id: 'prompts-versionados',
    rule: '§6',
    level: 2,
    kind: 'scan',
    label: 'prompts de papel versionados',
    fix: 'versione os prompts — eles carregam regra de segurança e não podem viver em scratchpad',
    detect: (ix) => {
      const f = ix.files.find((r) => /prompts?\.md$/i.test(r) && /harness|agents?/i.test(r));
      return f ? { found: true, evidence: f } : { found: false };
    },
  },
  {
    id: 'ci-jobs',
    rule: '§10',
    level: 2,
    kind: 'scan',
    label: 'CI com unit, integração e qualidade',
    fix: 'declare os jobs no pipeline e marque-os obrigatórios no ruleset',
    detect: (ix, cfg) => {
      const wf = ix.files.filter((r) => r.startsWith(cfg.ciDir) && /\.ya?ml$/.test(r));
      if (!wf.length) return { found: false, evidence: 'nenhum workflow' };
      const todo = wf.map((r) => ix.read(r)).join('\n').toLowerCase();
      const faltando = ['unit', 'integration', 'quality'].filter((j) => !todo.includes(j));
      return faltando.length
        ? { found: false, evidence: `sem job: ${faltando.join(', ')}` }
        : { found: true, evidence: `${wf.length} workflow(s)` };
    },
  },
  {
    id: 'G8-migrations-guard',
    rule: 'G8',
    level: 2,
    kind: 'scan',
    label: 'guarda de migrations ligada no CI',
    fix: 'rode migrations-guard.mjs num job obrigatório de PR',
    detect: (ix, cfg) => {
      // Só código é evidência: um `.md` que MENCIONA a guarda não a instala (T6, REQ-INF-2).
      const script = ix.grep(/DESTRUCTIVE_PATTERN|migrations-guard/, (r) => ix.isSource(r));
      const ci = ix.files
        .filter((r) => r.startsWith(cfg.ciDir))
        .find((r) => /migrations-guard|migrations_guard/.test(ix.read(r)));
      if (!script) return { found: false };
      return ci ? { found: true, evidence: ci } : { found: true, evidence: script, warn: 'guarda existe mas não achei no CI' };
    },
  },
  {
    id: 'ruleset-obrigatorio',
    rule: '§10',
    level: 2,
    kind: 'attest',
    label: 'jobs marcados obrigatórios no ruleset da branch',
    fix: 'marque os checks como obrigatórios e ateste em .harness/attest.json',
  },

  // ── Nível 2 — 1.1.0 (Workflow TRUE, versionamento, contexto)
  {
    id: 'fluxo-configurado',
    rule: 'R19 / FLX-2',
    level: 2,
    kind: 'scan',
    label: 'fluxo configurado (onboarding da fase 2 concluído)',
    fix: 'rode gabarito-instalar — a fase 2 grava fluxo.resolvidoEm em harness.config.json',
    detect: (ix, cfg) => {
      const em = cfg.fluxo?.resolvidoEm;
      if (typeof em === 'string' && ISO_DATA.test(em)) return { found: true, evidence: `fluxo.resolvidoEm = ${em}` };
      return { found: false, evidence: cfg.configInvalido ? 'harness.config.json inválido' : 'sem fluxo.resolvidoEm (AAAA-MM-DD)' };
    },
  },
  {
    id: 'iniciativa-resolvida',
    rule: 'R19 / FLX-1',
    level: 2,
    kind: 'attest',
    label: 'Iniciativa confirmada na ferramenta — existe ≠ ativa (I10)',
    fix: 'confirme a Iniciativa no onboarding e ateste iniciativa-resolvida em .harness/attest.json',
  },
  {
    id: 'versionamento',
    rule: 'R20 / VER-3',
    level: 2,
    kind: 'scan',
    label: 'versionamento configurado e histórico recente conforme (20 commits de primeiro pai)',
    fix: 'rode gabarito-instalar (fase 3) e corrija os commits apontados por versionamento-check.mjs',
    detect: (ix, cfg) => {
      const em = cfg.versionamento?.resolvidoEm;
      if (!em) return { found: false, evidence: cfg.configInvalido ? 'harness.config.json inválido' : 'sem versionamento.resolvidoEm' };
      // A config já veio do índice (visível ao git): `checar` não a relê do disco, onde poderia estar ignorada.
      const r = checar(ix.root, { max: 20, cfg: { ...cfg.versionamento, idPadrao: cfg.fluxo?.idPadrao ?? VERSIONAMENTO_DEFAULTS.idPadrao } });
      if (r.failOpen) return { found: false, evidence: r.failOpen };
      // F2-R7/G9: validação indisponível (git ilegível) nunca vale como validado — FALTA, não passa com aviso.
      if (r.aviso) return { found: false, evidence: `histórico não conferido (sem git legível)` };
      if (r.ok) return { found: true, evidence: `resolvido em ${em} · ${r.commits} commit(s) conformes` };
      return { found: false, evidence: `${r.achados.length} achado(s): ${r.achados.slice(0, 2).map((a) => `${a.sha} ${a.motivo}`).join('; ')}` };
    },
  },
  {
    id: 'changelog',
    rule: 'R20',
    level: 2,
    kind: 'scan',
    label: 'CHANGELOG com seção Unreleased (Keep a Changelog)',
    fix: 'crie o CHANGELOG.md com `## [Unreleased]` — a PR escreve a linha dela lá',
    detect: (ix, cfg) => {
      const f = cfg.versionamento?.changelog ?? 'CHANGELOG.md';
      if (!ix.has(f)) return { found: false, evidence: `${f} ausente` };
      return /^## \[?Unreleased\]?/m.test(ix.read(f)) ? { found: true, evidence: f } : { found: false, evidence: `${f} sem seção Unreleased` };
    },
  },
  {
    id: 'tag-semver',
    rule: 'R20',
    level: 2,
    kind: 'scan',
    opcional: true,
    label: 'ao menos uma tag SemVer (opcional em repo sem release)',
    fix: 'marque a release: git tag v1.0.0 — opcional até a primeira release',
    detect: (ix, cfg) => {
      let tags;
      try {
        tags = execFileSync('git', ['tag', '--list'], { cwd: ix.root, encoding: 'utf8', env: envGit(), stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
      } catch {
        return { found: false, evidence: '--' };
      }
      const re = new RegExp(cfg.versionamento?.tag ?? '^v\\d+\\.\\d+\\.\\d+$');
      const t = tags.find((x) => re.test(x));
      return t ? { found: true, evidence: t } : { found: false, evidence: 'nenhuma tag SemVer' };
    },
  },
  {
    id: 'agents-tamanho',
    rule: 'CTX-1',
    level: 2,
    kind: 'scan',
    label: 'AGENTS.md dentro do teto — núcleo e Apêndice medidos em bytes',
    fix: 'migre texto do núcleo para docs/harness/referencia.md — regra não some, texto migra (ADR-CTX-1)',
    detect: (ix, cfg) => {
      if (!ix.has(cfg.agentsFile)) return { found: false, evidence: `${cfg.agentsFile} ausente` };
      const { nucleo, apendice } = tamanhoAgents(ix.read(cfg.agentsFile));
      const maxN = Number(cfg.contexto?.nucleoMaxBytes ?? 17291);
      const maxA = Number(cfg.contexto?.apendiceMaxBytes ?? 4096);
      const evidence = `núcleo ${nucleo}/${maxN} B · apêndice ${apendice}/${maxA} B`;
      return { found: nucleo <= maxN && apendice <= maxA, evidence };
    },
  },

  // ── Nível 3 — completo
  {
    id: 'ordem-de-subida',
    rule: '§10',
    level: 3,
    kind: 'scan',
    label: 'ordem de subida travada por teste',
    fix: 'teste que falha se o pipeline inverter a ordem — não um teste que confere se o comentário existe',
    detect: (ix) => {
      const f = ix.grep(/deploy-?order|ordem de subida/i, (r) => ix.isSource(r));
      if (!f) return { found: false };
      const conteudo = ix.read(f);
      const soComentario = /assert\w*\.?match\([^)]*\/[^/]*(worker|consumidor)[^/]*\/i?\s*\)/i.test(conteudo)
        && !/for\s|sequence|indexOf/.test(conteudo);
      return soComentario
        ? { found: true, evidence: f, warn: 'o teste parece conferir só um comentário — isso é teatro documentado' }
        : { found: true, evidence: f };
    },
  },
  {
    id: 'ratchet',
    rule: 'R4 / §9.2',
    level: 3,
    kind: 'scan',
    label: 'ratchet de qualidade com baseline commitado',
    fix: 'baseline commitado + guarda fail-closed do universo de cobertura',
    detect: (ix, cfg) => {
      const b = ix.files.find((r) => /baseline\.json$/.test(r));
      if (!b) return { found: false, evidence: 'sem baseline commitado' };
      const noCi = ix.files
        .filter((r) => r.startsWith(cfg.ciDir))
        .some((r) => /quality|ratchet/i.test(ix.read(r)));
      return noCi
        ? { found: true, evidence: b }
        : { found: true, evidence: b, warn: 'baseline existe mas o ratchet não roda no CI' };
    },
  },
  {
    id: 'health-commit',
    rule: '§10',
    level: 3,
    kind: 'scan',
    label: 'endpoint de saúde devolve commit e versão',
    fix: 'exponha commit + versão no /health e meça no smoke pós-deploy',
    detect: (ix) => {
      const f = ix.grep(/health[\s\S]{0,400}commit|commit[\s\S]{0,200}version/i);
      return f ? { found: true, evidence: f } : { found: false };
    },
  },
  {
    id: 'rls-congelada',
    rule: '§11',
    level: 3,
    kind: 'scan',
    label: 'estado de RLS congelado por teste, com sweep dinâmico',
    fix: 'teste que pergunta ao catálogo quais tabelas existem AGORA e falha se alguma estiver desprotegida',
    detect: (ix) => {
      const f = ix.grep(/relrowsecurity|row level security|information_schema\.tables/i, (r) => ix.isSource(r));
      return f ? { found: true, evidence: f } : { found: false, evidence: 'inaplicável se o projeto não usa RLS' };
    },
    opcional: true,
  },
  {
    id: 'doctor-no-ci',
    rule: '§0.2',
    level: 3,
    kind: 'scan',
    label: 'o próprio doctor roda no CI',
    fix: 'rode harness-doctor num job obrigatório — senão o nível declarado envelhece sozinho',
    detect: (ix, cfg) => {
      const f = ix.files.filter((r) => r.startsWith(cfg.ciDir)).find((r) => /harness-doctor/.test(ix.read(r)));
      return f ? { found: true, evidence: f } : { found: false };
    },
  },
  {
    id: 'paralelismo-calibrado',
    rule: 'R21 / PAR-1',
    level: 3,
    kind: 'scan',
    label: 'paralelismo calibrado nesta máquina (≤ 180 d, teto ≥ simultaneos ≥ 1)',
    fix: 'rode capacidade.mjs --sugerir e grave orquestracao.paralelismo via onboarding-config.mjs',
    detect: (ix, cfg) => {
      const p = cfg.orquestracao?.paralelismo;
      if (!p?.calibradoEm) return { found: false, evidence: 'sem orquestracao.paralelismo.calibradoEm' };
      const d = diasDesde(p.calibradoEm);
      if (d === null || d > ATTEST_TTL_DAYS) return { found: false, evidence: `calibração vencida ou inválida (${p.calibradoEm})` };
      const s = Number(p.simultaneos);
      const t = Number(p.teto);
      return t >= s && s >= 1
        ? { found: true, evidence: `simultaneos ${s} · teto ${t} · calibrado ${p.calibradoEm}` }
        : { found: false, evidence: `teto ${t} ≥ simultaneos ${s} ≥ 1 não vale` };
    },
  },

  // ── Avisos — não entram no nível (ORQ-5)
  {
    id: 'modelo-resolvido',
    rule: 'R21 / ORQ-5',
    level: 'warn',
    kind: 'scan',
    label: 'modelo do orquestrador resolvido há menos de validadeDias',
    fix: 'revalide o modelo com gabarito-instalar (fase 4) — é aviso: não muda o nível nem quebra o CI',
    detect: (ix, cfg) => {
      const m = cfg.orquestracao?.modelo;
      if (!m?.resolvidoEm) return { found: false, evidence: 'sem orquestracao.modelo.resolvidoEm' };
      const d = diasDesde(m.resolvidoEm);
      const v = Number(m.validadeDias ?? 90);
      if (d === null) return { found: false, evidence: `resolvidoEm inválido (${m.resolvidoEm})` };
      return d <= v
        ? { found: true, evidence: `${m.alias || '?'} resolvido em ${m.resolvidoEm} (${Math.round(v - d)} d restantes)` }
        : { found: false, evidence: `VENCIDO há ${Math.round(d - v)} d (${m.alias || '?'}, resolvido em ${m.resolvidoEm}) — revalide` };
    },
  },
  {
    id: 'modelos-por-papel',
    rule: 'REQ-MOD-1',
    level: 'warn',
    kind: 'scan',
    label: 'modelo de cada papel em orquestracao.modelos não está abaixo do recomendado',
    fix: 'ajuste orquestracao.modelos em harness.config.json (haiku < sonnet < opus < fable) — é aviso: não muda o nível nem quebra o CI',
    detect: (ix, cfg) => {
      if (cfg.configInvalido) return { found: false, evidence: 'harness.config.json inválido: não li orquestracao.modelos' };
      const orq = cfg.orquestracao;
      if (orq === undefined) return { found: true, evidence: 'sem orquestracao.modelos: valem os padrões da visão' };
      if (orq === null || typeof orq !== 'object' || Array.isArray(orq)) return { found: false, evidence: 'orquestracao inválido (não é um objeto)' };
      const modelos = orq.modelos;
      if (modelos === undefined) return { found: true, evidence: 'sem orquestracao.modelos: valem os padrões da visão' };
      if (modelos === null || typeof modelos !== 'object' || Array.isArray(modelos)) return { found: false, evidence: 'orquestracao.modelos inválido (não é um objeto)' };
      const avisos = [];
      for (const [papel, e] of Object.entries(modelos)) {
        if (!Object.hasOwn(MODELOS_PADRAO, papel)) { avisos.push(`${papel}: papel desconhecido (sem modelo recomendado)`); continue; }
        const nome = typeof e === 'string' ? e : e !== null && typeof e === 'object' && !Array.isArray(e) && typeof e.modelo === 'string' ? e.modelo : undefined;
        const familia = nome === undefined ? undefined : Object.keys(ORDEM_MODELO).find((f) => nome.toLowerCase().includes(f));
        if (familia === undefined) { avisos.push(`${papel}: desconhecido (${JSON.stringify(nome ?? e)}): não é haiku, sonnet, opus nem fable`); continue; }
        const recomendado = MODELOS_PADRAO[papel].modelo;
        if (ORDEM_MODELO[familia] < ORDEM_MODELO[recomendado]) avisos.push(`${papel}: declarado ${familia} < recomendado ${recomendado}`);
      }
      return avisos.length
        ? { found: false, evidence: avisos.join('; ') }
        : { found: true, evidence: Object.keys(modelos).length ? 'nenhum papel abaixo do recomendado' : 'orquestracao.modelos vazio: valem os padrões da visão' };
    },
  },
  {
    id: 'guarda-ambientes',
    rule: 'GRD-1',
    level: 'warn',
    kind: 'scan',
    label: 'ambientes da guarda declarados (guarda.ambientes)',
    fix: 'declare guarda.ambientes.{teste,homolog,prod} em harness.config.json (hosts, projetos, bancos, mcps, variaveis) — é aviso: sem eles só os anéis de segredo e integridade agem, e nada é negado por ambiente',
    detect: (ix) => {
      const nomes = ambientesDeclarados(ix.guarda().config);
      return nomes.length
        ? { found: true, evidence: nomes.join(', ') }
        : { found: false, evidence: 'sem guarda.ambientes: só os anéis de segredo e integridade agem; nada é negado por ambiente' };
    },
  },
  {
    id: 'guarda-divergente',
    rule: 'GRD-1 / D2',
    level: 'warn',
    kind: 'scan',
    label: 'config da guarda da árvore igual à de origin/HEAD',
    fix: 'a guarda lê origin/HEAD, não a árvore: mescle a mudança de guarda.* na branch padrão — até lá a árvore local é ignorada',
    detect: (ix) => {
      const g = ix.guarda();
      return g.divergente
        ? { found: false, evidence: 'guarda.* da árvore ≠ origin/HEAD — vale a do origin' }
        : { found: true, evidence: g.fonte === 'origin' ? 'iguais' : 'sem origin/HEAD (config local; permitidos ignorado)' };
    },
  },
  {
    id: 'chaves-mortas',
    rule: 'INF-2',
    level: 'warn',
    kind: 'scan',
    label: 'sem chaves de config removidas na 2.0',
    fix: 'apague as chaves listadas de harness.config.json e .harness/attest.json — nenhum gate as lê mais',
    detect: (ix, cfg) => {
      const achadas = [];
      for (const caminho of CHAVES_MORTAS) {
        let v = cfg;
        for (const parte of caminho.split('.')) v = v && typeof v === 'object' && !Array.isArray(v) ? v[parte] : undefined;
        if (v !== undefined) achadas.push(caminho);
      }
      if (cfg.attestFile && ix.has(cfg.attestFile)) {
        try {
          const a = JSON.parse(ix.read(cfg.attestFile));
          if (a && typeof a === 'object' && 'squash-titulo-pr' in a) achadas.push('attest.squash-titulo-pr');
        } catch {
          /* atestado ilegível já é FALTA nos atestados */
        }
      }
      return achadas.length ? { found: false, evidence: `${achadas.join(', ')} — removida(s) na 2.0` } : { found: true, evidence: 'nenhuma' };
    },
  },
];

// ────────────────────────────────────────────────────────────── camada de guarda (REQ-INF-2)

/**
 * `ativa` descreve ESTA árvore, então só aceita evidência que não viaja pelo git: o marcador local
 * `.harness/heartbeat.json` (gitignored), gravado pelo SessionStart junto com a linha `guarda.heartbeat` do diário,
 * e CRUZADO com essa linha (mesmo `sessao` e `ts`). O diário é versionado (REQ-DIA-1): um clone o recebe de outro
 * autor, e por si só ele nunca dá `ativa` — vira anotação em `configurada` (sombra-heartbeat.md).
 */
const HEARTBEAT_ATIVA_H = 24;
/** O diário de outro autor/máquina some da anotação depois de 7 dias. */
const HEARTBEAT_DIARIO_H = 168;
/** Relógios diferem: até 5 min à frente ainda é "agora"; além disso o ts é forjado ou quebrado. */
const HEARTBEAT_SKEW_MS = 5 * 60_000;
const MARCADOR_ARQUIVO = '.harness/heartbeat.json';
const MARCADOR_MAX_BYTES = 64 * 1024;
/** Teto de leitura de UM diário: acima disso o arquivo não é lido (sem estourar memória). */
const DIARIO_MAX_BYTES = 32 * 1024 * 1024;
/** Anotação: só a cauda do jsonl, dos arquivos mais recentes. */
const HEARTBEAT_CAUDA_BYTES = 1024 * 1024;
const HEARTBEAT_MAX_ENTREGAS = 5000;
const HEARTBEAT_MAX_ARQUIVOS = 50;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** O único caminho que o marcador pode apontar: diário de uma entrega, relativo, sem `..`, sem barra extra. */
const ARQUIVO_DIARIO = /^\.harness\/entregas\/([^/\\]+)\/(events\.[^/\\]+\.jsonl)$/;
const ehDirReal = (p) => {
  try {
    return lstatSync(p).isDirectory(); // lstat: um symlink para diretório NÃO é diretório
  } catch {
    return false;
  }
};

/**
 * Lê um arquivo REGULAR (nunca symlink, nunca FIFO) por inteiro, ou só a cauda de `cauda` bytes (sem a 1ª linha, que
 * pode estar cortada). null = ilegível, não regular ou maior que `max`. `O_NONBLOCK`: abrir um FIFO não bloqueia.
 */
function lerSeguro(arquivo, { max, cauda } = {}) {
  let fd;
  try {
    fd = openSync(arquivo, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    if (max !== undefined && st.size > max) return null;
    const inicio = cauda === undefined ? 0 : Math.max(0, st.size - cauda);
    const buf = Buffer.alloc(st.size - inicio);
    let lidos = 0;
    while (lidos < buf.length) {
      const n = readSync(fd, buf, lidos, buf.length - lidos, inicio + lidos);
      if (n === 0) break;
      lidos += n;
    }
    const texto = buf.subarray(0, lidos).toString('utf8');
    if (inicio === 0) return texto;
    const nl = texto.indexOf('\n');
    return nl === -1 ? '' : texto.slice(nl + 1);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const tsValido = (ts, agora) => {
  if (typeof ts !== 'string' || !ISO_TS.test(ts)) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) || t > agora + HEARTBEAT_SKEW_MS ? null : t; // futuro: forjado ou relógio quebrado
};

/** O git rastreia este caminho? (sem git ou fora de repo: não.) Marcador versionado por engano não é local. */
function rastreado(raiz, rel) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', rel], { cwd: raiz, encoding: 'utf8', env: envGit(), stdio: ['ignore', 'pipe', 'ignore'] });
    return out.length > 0;
  } catch {
    return false;
  }
}

/** Linhas de um diário parseadas como eventos `guarda.heartbeat` (objeto, `tipo` exato). */
function* heartbeatsDe(texto) {
  for (const linha of texto.split('\n')) {
    if (!linha.includes('guarda.heartbeat')) continue;
    let ev;
    try {
      ev = JSON.parse(linha);
    } catch {
      continue; // linha truncada
    }
    if (ev && typeof ev === 'object' && !Array.isArray(ev) && ev.tipo === 'guarda.heartbeat') yield ev;
  }
}

/**
 * Horas desde o heartbeat LOCAL desta árvore: marcador `.harness/heartbeat.json` válido, não rastreado, cujo `arquivo`
 * (só ele é aberto) tem a linha `guarda.heartbeat` de mesmo `sessao` e `ts`. null = sem evidência local.
 */
function horasDesdeHeartbeatLocal(raiz, agora) {
  return heartbeatLocalDe(raiz, agora)?.ha ?? null;
}

/** O mesmo, devolvendo também a `sessao` do marcador (o que liga o mod a esta árvore). null = sem evidência local. */
function heartbeatLocalDe(raiz, agora) {
  const harness = join(raiz, '.harness');
  if (!ehDirReal(harness)) return null;
  const texto = lerSeguro(join(raiz, MARCADOR_ARQUIVO), { max: MARCADOR_MAX_BYTES });
  if (texto === null) return null;
  let m;
  try {
    m = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const t = tsValido(m.ts, agora);
  if (t === null || typeof m.sessao !== 'string' || typeof m.arquivo !== 'string') return null;
  const alvo = ARQUIVO_DIARIO.exec(m.arquivo);
  if (!alvo || alvo[1] === '.' || alvo[1] === '..') return null;
  if (!ehDirReal(join(harness, 'entregas')) || !ehDirReal(join(harness, 'entregas', alvo[1]))) return null;
  if (rastreado(raiz, MARCADOR_ARQUIVO)) return null; // versionado por engano: viaja pelo git, não prova esta árvore
  const diario = lerSeguro(join(raiz, m.arquivo), { max: DIARIO_MAX_BYTES });
  if (diario === null) return null;
  for (const ev of heartbeatsDe(diario)) {
    if (ev.sessao === m.sessao && ev.ts === m.ts) return { ha: Math.max(0, (agora - t) / 3_600_000), sessao: m.sessao };
  }
  return null;
}

// ────────────────────────────────────────────────────────────── loop com mod (REQ-LOOP-2)

const SESSAO_SEGURA = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * O mod do Gabarito carregou NESTA árvore e NESTA sessão? Prova positiva, sem a qual a resposta é `{ mod: false }`:
 * o marcador local do heartbeat (gitignored, não rastreado, cruzado com o diário) dá a `sessao` desta árvore, e algum
 * `.harness/entregas/<id>/events.<sessao>.jsonl` tem um `custo.medicao` de `agente: 'orquestrador'` DESSA sessão, de
 * ≤ 24 h e não do futuro. Só o mod grava esse evento (sem mod o orquestrador fica sem medição, REQ-OBS-1). O mod existir no
 * repo, um plano.json, um heartbeat da guarda ou um diário de outro autor não provam nada (I10). Limite declarado: o diário
 * é arquivo local e um processo com escrita nele o forja; a barreira é o anel de integridade da guarda, não este doctor.
 */
export function modDoLoop(raiz, agora = Date.now()) {
  const agoraMs = agora instanceof Date ? agora.getTime() : Number(agora);
  const hb = heartbeatLocalDe(raiz, agoraMs);
  if (hb === null || !SESSAO_SEGURA.test(hb.sessao) || hb.sessao === '.' || hb.sessao === '..') return { mod: false };
  const base = join(raiz, '.harness', 'entregas');
  if (!ehDirReal(join(raiz, '.harness')) || !ehDirReal(base)) return { mod: false };
  let entregas;
  try {
    entregas = readdirSync(base).slice(0, HEARTBEAT_MAX_ENTREGAS);
  } catch {
    return { mod: false };
  }
  let melhor = null;
  for (const id of entregas) {
    const dir = join(base, id);
    if (!ehDirReal(dir)) continue;
    const texto = lerSeguro(join(dir, `events.${hb.sessao}.jsonl`), { cauda: HEARTBEAT_CAUDA_BYTES });
    if (texto === null) continue;
    for (const linha of texto.split('\n')) {
      if (!linha.includes('custo.medicao')) continue;
      let ev;
      try {
        ev = JSON.parse(linha);
      } catch {
        continue; // linha truncada
      }
      if (!ev || typeof ev !== 'object' || Array.isArray(ev) || ev.tipo !== 'custo.medicao' || ev.agente !== 'orquestrador' || ev.sessao !== hb.sessao) continue;
      const t = tsValido(ev.ts, agoraMs);
      if (t === null || (agoraMs - t) / 3_600_000 > HEARTBEAT_ATIVA_H) continue;
      if (melhor === null || t > melhor) melhor = t;
    }
  }
  return melhor === null ? { mod: false } : { mod: true, ha: Math.max(0, (agoraMs - melhor) / 3_600_000) };
}

/** `db` do harness.config.json: `declarado` (válido) · `n/a` (sem bloco) · `inválido` (bloco que o loop recusaria) · `indisponível` (config ilegível). */
function estadoDb(fileCfg, configInvalido) {
  if (configInvalido) return { estado: 'indisponível', erro: 'harness.config.json inválido' };
  const v = validarDb(fileCfg);
  if (!v.ok) return { estado: 'inválido', erro: v.erro };
  return v.na ? { estado: 'n/a' } : { estado: 'declarado' };
}

/** O heartbeat mais recente dos diários `.harness/entregas/<id>/events.*.jsonl` (qualquer autor), ou null. Só anotação. */
function heartbeatDoDiario(raiz, agora) {
  const harness = join(raiz, '.harness');
  const base = join(harness, 'entregas');
  if (!ehDirReal(harness) || !ehDirReal(base)) return null;
  let entregas;
  try {
    entregas = readdirSync(base).slice(0, HEARTBEAT_MAX_ENTREGAS);
  } catch {
    return null;
  }
  // Os events.*.jsonl mais recentemente escritos primeiro: ler só os N mais novos limita o custo com milhares de entregas.
  const candidatos = [];
  for (const id of entregas) {
    const dir = join(base, id);
    if (!ehDirReal(dir)) continue;
    let nomes;
    try {
      nomes = readdirSync(dir).filter((n) => /^events\..+\.jsonl$/.test(n));
    } catch {
      continue;
    }
    for (const nome of nomes) {
      try {
        // O tipo NÃO é filtrado aqui: quem recusa symlink e não-arquivo é `lerSeguro` (O_NOFOLLOW + fstat), numa defesa só.
        candidatos.push({ arquivo: join(dir, nome), mtime: lstatSync(join(dir, nome)).mtimeMs });
      } catch {
        /* sumiu entre o readdir e o lstat */
      }
    }
  }
  candidatos.sort((a, b) => b.mtime - a.mtime);
  let melhor = null;
  for (const { arquivo } of candidatos.slice(0, HEARTBEAT_MAX_ARQUIVOS)) {
    const texto = lerSeguro(arquivo, { cauda: HEARTBEAT_CAUDA_BYTES });
    if (texto === null) continue;
    for (const ev of heartbeatsDe(texto)) {
      const t = tsValido(ev.ts, agora);
      if (t !== null && (melhor === null || t > melhor.t)) melhor = { t, autor: typeof ev.autor === 'string' ? ev.autor : 'desconhecido' };
    }
  }
  if (melhor === null) return null;
  const ha = Math.max(0, (agora - melhor.t) / 3_600_000);
  return ha > HEARTBEAT_DIARIO_H ? null : { ha, autor: melhor.autor };
}

/** Quantas entradas da lista da guarda `.claude/settings.json` do repo já tem em `permissions.deny`. */
function entradasDeny(raiz) {
  const f = join(raiz, '.claude', 'settings.json');
  try {
    const st = lstatSync(f);
    if (!st.isFile() || st.size > 1024 * 1024) return 0;
    const deny = JSON.parse(readFileSync(f, 'utf8'))?.permissions?.deny;
    return Array.isArray(deny) ? DENY_GUARDA.filter((e) => deny.includes(e)).length : 0; // a camada é a lista INTEIRA (ver camadaDe)
  } catch {
    return 0;
  }
}

const BLOCOS_AMBIENTE = ['hosts', 'projetos', 'bancos', 'mcps', 'variaveis'];
/** Ambientes com declaração real. `branches` sozinho não conta: `lerGuarda` o sintetiza de `branchPadrao`. */
function ambientesDeclarados(config) {
  const amb = config?.ambientes && typeof config.ambientes === 'object' ? config.ambientes : {};
  return ['teste', 'homolog', 'prod'].filter((n) => {
    const a = amb[n];
    return a && typeof a === 'object' && BLOCOS_AMBIENTE.some((b) => Array.isArray(a[b]) && a[b].length > 0);
  });
}

function camadaDe(raiz, agoraMs, g) {
  const ha = horasDesdeHeartbeatLocal(raiz, agoraMs);
  const ambientes = ambientesDeclarados(g.config);
  let estado = 'nenhuma';
  if (ha !== null && ha <= HEARTBEAT_ATIVA_H) estado = 'ativa';
  else if (ambientes.length) estado = 'configurada';
  else if (entradasDeny(raiz) === DENY_GUARDA.length) estado = 'permissions.deny'; // as 7: uma entrada solta não é a 2ª camada
  // 'mod' (guarda por mod, sem hook) fica no contrato, mas nenhum sinal em disco o prova: nunca é devolvido.
  // O diário versionado (de qualquer autor) só informa; não decide o estado. Com marcador local válido não precisa de anotação.
  const diario = estado === 'ativa' ? null : heartbeatDoDiario(raiz, agoraMs);
  return { estado, heartbeatHa: ha, fonte: g.config ? g.fonte : null, divergente: g.divergente, ambientes, diario };
}

/**
 * Camada de guarda deste repo (REQ-INF-2): `ativa` (heartbeat LOCAL — marcador gitignored cruzado com o diário — há ≤ 24 h) · `configurada`
 * (guarda.ambientes declarados) · `permissions.deny` (só a 2ª camada do instalador) · `nenhuma`.
 * `fonte`/`divergente` vêm de `lerGuarda` (origin/HEAD vale; árvore divergente só é reportada).
 */
export function camadaGuarda(raiz, agora = Date.now()) {
  const { estado, heartbeatHa, fonte, divergente, diario } = camadaDe(raiz, agora instanceof Date ? agora.getTime() : Number(agora), lerGuarda(raiz));
  return { estado, heartbeatHa, fonte, divergente, diario };
}

// ────────────────────────────────────────────────────────────── nível

/** Perfil de repo sem aplicação (plugin, biblioteca de docs): G3 e teardown não se aplicam. */
const PERFIL_SEM_APP = 'repo-sem-app';
const PERFIL_NA = ['G3-mass-mutation', 'G3-strict-undefined', 'teardown-por-id'];

export function parseDeclaredLevel(agentsMd) {
  const m = /Nível de adoção declarado:\s*`?\s*([0-3])\s*`?/i.exec(agentsMd ?? '');
  return m ? Number(m[1]) : null;
}

export function run(root = process.cwd(), overrides = {}) {
  const cfgFile = join(root, 'harness.config.json');
  let fileCfg = {};
  let configInvalido = false;
  // A config decide perfil, atestado e checagens: vale o mesmo que o resto da evidência. Ignorada pelo git (ou rastreada e
  // apagada) = ausente, como seria no clone do commit. A camada de guarda a lê por outro caminho (lerGuarda), de propósito.
  const visiveis = arquivosVisiveis(root);
  if (visiveis.includes('harness.config.json') && existsSync(cfgFile)) {
    try {
      const lido = JSON.parse(readFileSync(cfgFile, 'utf8') || '{}');
      if (lido && typeof lido === 'object' && !Array.isArray(lido)) fileCfg = lido;
      else configInvalido = true;
    } catch {
      configInvalido = true; // fail-open declarado: checagens de config ficam FALTA, nunca stack trace
    }
  }
  const cfg = { ...DEFAULTS, ...fileCfg, ...overrides, configInvalido };

  const ix = createIndex(root, cfg, visiveis);
  const attest = loadAttest(ix, cfg);

  // Perfil explícito (casamento exato): repo sem aplicação não tem client de banco nem teardown a proteger.
  // SÓ essas três checagens viram n/a — R3, segredo e atestados seguem valendo (perfil não rebaixa segurança).
  const perfil = cfg.perfil === PERFIL_SEM_APP ? PERFIL_SEM_APP : null;

  const resultados = CHECKS.map((c) => {
    if (perfil === PERFIL_SEM_APP && PERFIL_NA.includes(c.id)) {
      return { ...c, found: true, na: true, evidence: `n/a — perfil ${perfil} (sem aplicação nem banco)` };
    }
    if (c.kind === 'attest') {
      const a = attestOk(attest, c.id);
      if (!a) return { ...c, found: false, evidence: 'sem atestado em .harness/attest.json' };
      if (a.stale)
        return { ...c, found: false, evidence: `atestado vencido (${a.dias} dias, por ${a.por})` };
      return { ...c, found: true, evidence: `atestado por ${a.por} em ${a.em}` };
    }
    const r = c.detect(ix, cfg) ?? { found: false };
    return { ...c, ...r };
  });

  // Nível alcançado = maior N em que TODA checagem obrigatória de nível <= N passou.
  // `level: 'warn'` nunca é igual a 1, 2 ou 3: avisos não entram na conta por construção.
  let alcancado = 0;
  for (const nivel of [1, 2, 3]) {
    const obrigatorias = resultados.filter((r) => r.level === nivel && !r.opcional);
    if (obrigatorias.every((r) => r.found)) alcancado = nivel;
    else break;
  }

  // Git ilegível: nada vale como evidência, mas a DECLARAÇÃO do AGENTS.md vem do disco — ela só pode endurecer o gate
  // (declarado > medido ⇒ rc 1), nunca contar como evidência. Com o git legível, ignorado/apagado segue ausente (R1).
  const gitIlegivel = visiveis.ilegivel === true;
  let agents = ix.has(cfg.agentsFile) ? ix.read(cfg.agentsFile) : null;
  if (agents === null && gitIlegivel) {
    try {
      agents = readFileSync(join(root, cfg.agentsFile), 'utf8');
    } catch {
      agents = null;
    }
  }
  const declarado = parseDeclaredLevel(agents);

  const novasFaltando = resultados
    .filter((r) => NOVAS_1_1_0.includes(r.id) && r.level !== 'warn' && !r.opcional && !r.found)
    .map((r) => r.id);
  const avisos = resultados.filter((r) => r.level === 'warn' && !r.found).map((r) => `${r.id}: ${r.evidence ?? ''}`);

  const camada = camadaDe(root, Date.now(), ix.guarda());

  return {
    resultados,
    camada,
    loop: modDoLoop(root),
    db: estadoDb(fileCfg, configInvalido),
    perfil,
    alcancado,
    declarado,
    mentindo: declarado !== null && declarado > alcancado,
    semAgents: agents === null,
    gitIlegivel,
    semDeclaracao: agents !== null && declarado === null,
    novasFaltando,
    avisos,
    configInvalido,
  };
}

// ────────────────────────────────────────────────────────────── saída

function render(out, explain) {
  const linhas = [];
  linhas.push('harness-doctor — evidência de gates neste repositório', '');
  for (const nivel of [1, 2, 3]) {
    const rotulo = { 1: 'segurança', 2: 'processo', 3: 'completo' }[nivel];
    linhas.push(`── Nível ${nivel} — ${rotulo}`);
    for (const r of out.resultados.filter((x) => x.level === nivel)) {
      const marca = r.na ? ' n/a ' : r.found ? '  ok ' : r.opcional ? '  -- ' : ' FALTA';
      const tipo = r.kind === 'attest' ? ' (atestado)' : '';
      linhas.push(`${marca} ${r.rule.padEnd(10)} ${r.label}${tipo}`);
      if (r.evidence) linhas.push(`        ↳ ${r.evidence}`);
      if (r.warn) linhas.push(`        ⚠ ${r.warn}`);
      if (explain && !r.found) linhas.push(`        → ${r.fix}`);
    }
    linhas.push('');
  }
  const avisos = out.resultados.filter((x) => x.level === 'warn');
  if (avisos.length) {
    linhas.push('── Avisos (não contam no nível)');
    for (const r of avisos) {
      linhas.push(`${r.found ? '  ok ' : ' warn'} ${r.rule.padEnd(10)} ${r.label}`);
      if (r.evidence) linhas.push(`        ↳ ${r.evidence}`);
      if (explain && !r.found) linhas.push(`        → ${r.fix}`);
    }
    linhas.push('');
  }
  const c = out.camada;
  const quente = c.heartbeatHa === null ? '' : ` (heartbeat há ${Math.round(c.heartbeatHa)} h)`;
  linhas.push(`Camada de guarda: ${c.estado}${c.estado === 'ativa' ? quente : ''}${c.estado !== 'ativa' && c.heartbeatHa !== null ? ` · último heartbeat local há ${Math.round(c.heartbeatHa)} h` : ''}${c.estado !== 'ativa' && c.diario ? ` · diário com heartbeat há ${Math.round(c.diario.ha)} h (${c.diario.autor})` : ''}${c.fonte ? ` · fonte ${c.fonte}` : ''}${c.divergente ? ' · DIVERGENTE (árvore ≠ origin/HEAD; vale o origin)' : ''}`);
  linhas.push(`Ambientes declarados: ${c.ambientes.length ? c.ambientes.join(', ') : '(nenhum)'}`);
  if (out.perfil) linhas.push(`Perfil: ${out.perfil}`);
  linhas.push(out.loop.mod ? `loop: mod ativo (custo.medicao do orquestrador há ${Math.round(out.loop.ha)} h)` : 'loop: sem mod (sem pouso automático)');
  linhas.push(out.db.estado === 'declarado' || out.db.estado === 'n/a' ? `db: ${out.db.estado}` : `db: ${out.db.estado} (${out.db.erro})`);
  linhas.push('');
  linhas.push(`Nível alcançado: ${out.alcancado}   ·   declarado no AGENTS.md: ${out.declarado ?? '(não declarado)'}`);
  if (out.configInvalido) linhas.push('AVISO: harness.config.json inválido — checagens de config ficam FALTA (fail-open declarado (G9)).');
  if (out.gitIlegivel) linhas.push('AVISO: git ilegível neste ambiente (dono diferente, índice corrompido, git fora do PATH…): nenhum arquivo vale como evidência; o nível declarado vem do disco.');
  if (out.semAgents) linhas.push('AVISO: AGENTS.md não encontrado na raiz.');
  else if (out.semDeclaracao) linhas.push('AVISO: o §0.2 não declara nível. Preencha — é a honestidade do documento sobre si mesmo.');
  if (out.mentindo) {
    linhas.push(
      '',
      `ERRO: o AGENTS.md declara nível ${out.declarado} e os gates sustentam ${out.alcancado}.`,
      'Um nível inflado é exatamente a mentira que o §0.2 existe para pegar.',
      'Conserto: implemente os gates que faltam, OU baixe o nível declarado.',
    );
    if (out.novasFaltando.length) linhas.push('checagens novas da 1.1.0: rode o onboarding ou declare o nível medido');
  }
  return linhas.join('\n');
}


/** Única escrita do doctor. `run()` continua puro; o cartão de sessão lê este arquivo (DOC-2, TTL 24 h). */
function gravarCache(root, out) {
  const f = join(root, '.harness', 'doctor-cache.json');
  mkdirSync(dirname(f), { recursive: true });
  // M5: tmp + rename — leitor concorrente (o cartão de sessão) nunca vê um arquivo pela metade.
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ nivel: out.alcancado, declarado: out.declarado, em: new Date().toISOString() }, null, 2)}\n`);
  renameSync(tmp, f);
}

function main(argv) {
  const root = raizSemGitDirHerdado();
  const out = run(root);
  if (argv.includes('--cache')) gravarCache(root, out); // antes do exit: o cartão precisa do cache mesmo quando o repo mente
  if (argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        { ...out, resultados: out.resultados.map(({ detect, ...r }) => r) },
        null,
        2,
      ),
    );
    process.exit(out.mentindo ? 1 : 0);
  }
  console.log(render(out, argv.includes('--explain')));
  process.exit(out.mentindo ? 1 : 0);
}

if (ehEntrypoint(import.meta.url)) main(process.argv.slice(2));

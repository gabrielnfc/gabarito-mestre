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
 * USO
 *   node harness-doctor.mjs            # tabela + veredito, sai !=0 se o nível mentir
 *   node harness-doctor.mjs --json     # saída para máquina
 *   node harness-doctor.mjs --explain  # inclui como consertar cada item faltante
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo',
  '.cache', 'out', 'vendor', '__pycache__', '.venv',
]);

const DEFAULTS = {
  agentsFile: 'AGENTS.md',
  docsDir: 'docs',
  migrationsDir: 'prisma/migrations',
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

function createIndex(root, cfg) {
  const files = [];
  walk(root, (f) => files.push(f));
  const excluir = cfg.excludePaths ?? [];
  const rel = files
    .map((f) => relative(root, f).split(sep).join('/'))
    .filter((r) => !excluir.some((p) => r.includes(p)));
  const cache = new Map();

  const read = (r) => {
    if (!cache.has(r)) {
      try {
        cache.set(r, readFileSync(join(root, r), 'utf8'));
      } catch {
        cache.set(r, '');
      }
    }
    return cache.get(r);
  };

  const isSource = (r) => cfg.sourceExts.some((ext) => r.endsWith(ext));
  const isTest = (r) => /(\.|\/)(spec|test)\.[cm]?[jt]sx?$/.test(r) || r.includes('/test/') || r.includes('/__tests__/');

  return {
    root,
    files: rel,
    read,
    has: (r) => existsSync(join(root, r)),
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
  const dias = (Date.now() - Date.parse(a.em)) / 86_400_000;
  if (Number.isNaN(dias)) return null;
  if (dias > ATTEST_TTL_DAYS) return { stale: true, ...a, dias: Math.round(dias) };
  return { stale: false, ...a, dias: Math.round(dias) };
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
      const script = ix.grep(/DESTRUCTIVE_PATTERN|migrations-guard/, (r) => ix.isSource(r) || r.endsWith('.md'));
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
];

// ────────────────────────────────────────────────────────────── nível

export function parseDeclaredLevel(agentsMd) {
  const m = /Nível de adoção declarado:\s*`?\s*([0-3])\s*`?/i.exec(agentsMd ?? '');
  return m ? Number(m[1]) : null;
}

export function run(root = process.cwd(), overrides = {}) {
  const cfgFile = join(root, 'harness.config.json');
  const fileCfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {};
  const cfg = { ...DEFAULTS, ...fileCfg, ...overrides };

  const ix = createIndex(root, cfg);
  const attest = loadAttest(ix, cfg);

  const resultados = CHECKS.map((c) => {
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
  let alcancado = 0;
  for (const nivel of [1, 2, 3]) {
    const obrigatorias = resultados.filter((r) => r.level === nivel && !r.opcional);
    if (obrigatorias.every((r) => r.found)) alcancado = nivel;
    else break;
  }

  const agents = ix.has(cfg.agentsFile) ? ix.read(cfg.agentsFile) : null;
  const declarado = parseDeclaredLevel(agents);

  return {
    resultados,
    alcancado,
    declarado,
    mentindo: declarado !== null && declarado > alcancado,
    semAgents: agents === null,
    semDeclaracao: agents !== null && declarado === null,
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
      const marca = r.found ? '  ok ' : r.opcional ? '  -- ' : ' FALTA';
      const tipo = r.kind === 'attest' ? ' (atestado)' : '';
      linhas.push(`${marca} ${r.rule.padEnd(10)} ${r.label}${tipo}`);
      if (r.evidence) linhas.push(`        ↳ ${r.evidence}`);
      if (r.warn) linhas.push(`        ⚠ ${r.warn}`);
      if (explain && !r.found) linhas.push(`        → ${r.fix}`);
    }
    linhas.push('');
  }
  linhas.push(`Nível alcançado: ${out.alcancado}   ·   declarado no AGENTS.md: ${out.declarado ?? '(não declarado)'}`);
  if (out.semAgents) linhas.push('AVISO: AGENTS.md não encontrado na raiz.');
  else if (out.semDeclaracao) linhas.push('AVISO: o §0.2 não declara nível. Preencha — é a honestidade do documento sobre si mesmo.');
  if (out.mentindo) {
    linhas.push(
      '',
      `ERRO: o AGENTS.md declara nível ${out.declarado} e os gates sustentam ${out.alcancado}.`,
      'Um nível inflado é exatamente a mentira que o §0.2 existe para pegar.',
      'Conserto: implemente os gates que faltam, OU baixe o nível declarado.',
    );
  }
  return linhas.join('\n');
}

function main(argv) {
  const out = run(process.cwd());
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

// Entrypoint robusto a espaço/acento no caminho: `file://` cru falha com %20 e o script sairia 0 em silêncio.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));

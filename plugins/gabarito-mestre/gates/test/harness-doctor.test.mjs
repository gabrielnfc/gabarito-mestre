/**
 * Testes do GATE §0.2 — harness-doctor.
 *
 * O teste central é `repo que MENTE o nível reprova`: é ele que fecha a contradição
 * do harness. Sem esse comportamento, o §0.2 é só mais uma tabela que ninguém confere.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  calcular o nível como "maioria das checagens" em vez de "todas"
 *  M2  ignorar o TTL do atestado (atestado vencido passa a valer para sempre)
 *  M3  não reprovar quando declarado > alcançado
 *  M4  `>` por `>=` em `agents-tamanho` (17.291 passa a FALTA)
 *  M5  rebaixar uma checagem nova para `level: 1` (fixture 1.0.1 nível 1 cai para 0)
 *  M6  `modelo-resolvido` com `level: 2` (vencido derruba o nível)
 *  M7  cortar só em `## Apêndice\n` exato (`## Apêndice — Projeto` deixa de ser corte)
 *  M8  `run()` gravando o cache (viola pureza)
 *  M9  `JSON.parse` sem try/catch em `run()` (config inválida vira stack trace)
 *  M10 linha "checagens novas" impressa incondicionalmente — deve derrubar
 *  M12 T6: `fonte` da camada ignorada (sempre null) ⇒ doctor-camada-divergente
 *  M13 T6: G8 aceitando `.md` como evidência ⇒ g8-md-nao-evidencia
 *  M14 T6: heartbeat com ts futuro aceito ⇒ doctor-camada-heartbeat-futuro
 *  M15 T6: seguir symlink em events.*.jsonl ⇒ doctor-camada-heartbeat-symlink
 *  M16 T6: voltar a varrer o disco (sem git ls-files) ⇒ doctor-varre-git-ls-files
 *  M17 T6: perfil repo-sem-app também marcando R3-prod-guard n/a ⇒ doctor-repo-sem-app
 *  M18 T6: remover o String() de diasDesde ⇒ diasdesde-numerico-invalido
 *  M11 F4-R10: alargar a entrada de excludePaths de 'gabarito-mestre/templates/' para 'templates/'
 *      (a exclusão passa a valer para QUALQUER caminho que contenha "templates/", não só o do plugin)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, symlinkSync, realpathSync, utimesSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, parseDeclaredLevel, CHECKS, tamanhoAgents, NOVAS_1_1_0 } from '../scripts/harness-doctor.mjs';
import * as doctor from '../scripts/harness-doctor.mjs'; // camadaGuarda via namespace: o RED falha por teste, não pelo import
import * as onboarding from '../scripts/onboarding-config.mjs';
const DENY_GUARDA = onboarding.DENY_GUARDA ?? [];

function repo(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}

const agents = (nivel) => `# AGENTS.md\n\n**Nível de adoção declarado: \`${nivel}\`**\n`;
const hoje = new Date().toISOString().slice(0, 10);

describe('doctor — leitura do nível declarado', () => {
  test('extrai o nível do §0.2 em suas variações de escrita', () => {
    assert.equal(parseDeclaredLevel('**Nível de adoção declarado: `2`**'), 2);
    assert.equal(parseDeclaredLevel('Nível de adoção declarado: 3'), 3);
    assert.equal(parseDeclaredLevel('nada aqui'), null);
  });
});

describe('doctor — o que ele mede', () => {
  test('repo vazio: nível 0 e nenhuma checagem encontrada', () => {
    const out = run(repo({ 'AGENTS.md': agents(0) }));
    assert.equal(out.alcancado, 0);
    // avisos (level 'warn': chaves-mortas, guarda-divergente) passam por construção num repo vazio — não são gates
    assert.equal(out.resultados.filter((r) => r.found && r.level !== 'warn' && r.id !== 'agents-tamanho').length, 0, 'agents-tamanho passa por construção num AGENTS.md mínimo');
  });

  test('detecta a guarda de mutação em massa e aponta onde ela é LIGADA', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'src/db.ts': `import { massMutationGuard } from './guard';\nexport const db = base.$extends(massMutationGuard());`,
      }),
    );
    const g3 = out.resultados.find((r) => r.id === 'G3-mass-mutation');
    assert.equal(g3.found, true);
    assert.equal(g3.evidence, 'src/db.ts');
    assert.equal(g3.warn, null, 'achou o ponto de ligação: não deve avisar');
  });

  test('guarda presente mas não ligada ao client vira AVISO, não aprovação silenciosa', () => {
    const out = run(
      repo({ 'AGENTS.md': agents(0), 'src/guard.ts': 'export function massMutationGuard() {}' }),
    );
    const g3 = out.resultados.find((r) => r.id === 'G3-mass-mutation');
    assert.equal(g3.found, true);
    assert.match(g3.warn, /não achei o ponto onde ela é ligada/);
  });

  test('teardown com filtro vazio no teste é FALTA — e allowFullScan isenta', () => {
    const comFalha = run(
      repo({ 'AGENTS.md': agents(0), 'test/a.spec.ts': 'await db.customers.deleteMany({});' }),
    );
    assert.equal(comFalha.resultados.find((r) => r.id === 'teardown-por-id').found, false);

    const isento = run(
      repo({
        'AGENTS.md': agents(0),
        'test/a.spec.ts': "await db.customers.deleteMany(allowFullScan('fixture efêmero', {}));",
      }),
    );
    assert.equal(isento.resultados.find((r) => r.id === 'teardown-por-id').found, true);
  });

  test('segredo preenchido no .env.example é FALTA', () => {
    const ruim = run(
      repo({
        'AGENTS.md': agents(0),
        '.gitignore': '.env\n',
        '.env.example': 'API_TOKEN=abc123\n',
      }),
    );
    assert.equal(ruim.resultados.find((r) => r.id === 'secrets-fora-do-repo').found, false);

    const bom = run(
      repo({ 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.env.example': 'API_TOKEN=\n' }),
    );
    assert.equal(bom.resultados.find((r) => r.id === 'secrets-fora-do-repo').found, true);
  });
});

describe('doctor — atestados', () => {
  test('atestado válido conta; sem atestado, não', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        '.harness/attest.json': JSON.stringify({
          'branch-protegida': { confirmado: true, por: 'gabriel', em: hoje },
        }),
      }),
    );
    assert.equal(out.resultados.find((r) => r.id === 'branch-protegida').found, true);
    assert.equal(out.resultados.find((r) => r.id === 'backup-verificado').found, false);
  });

  test('atestado VENCIDO não conta — "não sei" é "não"', () => {
    const velho = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        '.harness/attest.json': JSON.stringify({
          'branch-protegida': { confirmado: true, por: 'gabriel', em: velho },
        }),
      }),
    );
    const r = out.resultados.find((x) => x.id === 'branch-protegida');
    assert.equal(r.found, false);
    assert.match(r.evidence, /vencido/);
  });
});

describe('doctor — o veredito que fecha a contradição', () => {
  test('repo que MENTE o nível REPROVA', () => {
    const out = run(repo({ 'AGENTS.md': agents(3) })); // nada implementado, declara 3
    assert.equal(out.alcancado, 0);
    assert.equal(out.declarado, 3);
    assert.equal(out.mentindo, true);
  });

  test('repo honesto no nível 0 passa', () => {
    const out = run(repo({ 'AGENTS.md': agents(0) }));
    assert.equal(out.mentindo, false);
  });

  test('AGENTS.md sem declaração é sinalizado, não ignorado', () => {
    const out = run(repo({ 'AGENTS.md': '# AGENTS.md\nsem nível aqui' }));
    assert.equal(out.semDeclaracao, true);
  });

  test('nível exige TODAS as checagens obrigatórias do nível — não a maioria', () => {
    const quaseNivel1 = {
      'AGENTS.md': agents(1),
      'src/db.ts': 'base.$extends(massMutationGuard())',
      'src/x.ts': 'strictUndefinedChecks; assertNotProduction();',
      '.gitignore': '.env\n',
      '.harness/attest.json': JSON.stringify({
        'branch-protegida': { confirmado: true, por: 'g', em: hoje },
        // falta 'backup-verificado' — uma só, e o nível não sobe
      }),
    };
    const out = run(repo(quaseNivel1));
    assert.equal(out.alcancado, 0);
    assert.equal(out.mentindo, true);
  });
});

describe('doctor — não se detecta a si mesmo', () => {
  test('o arquivo que DEFINE as checagens não conta como evidência delas', () => {
    // Falso positivo real: o doctor contém o texto de todos os padrões que procura,
    // e sem a exclusão ele se detectava como prova de gates que o repo não tem.
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'tools/gabarito-gates/scripts/harness-doctor.mjs':
          'relrowsecurity health commit version massMutationGuard assertNotProduction',
      }),
    );
    for (const id of ['G3-mass-mutation', 'R3-prod-guard', 'health-commit', 'rls-congelada']) {
      assert.equal(out.resultados.find((r) => r.id === id).found, false, id);
    }
  });

  test('o teste de um gate não prova que o gate está LIGADO na aplicação', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'tools/gabarito-gates/test/x.test.mjs': 'massMutationGuard() strictUndefinedChecks',
      }),
    );
    assert.equal(out.resultados.find((r) => r.id === 'G3-mass-mutation').found, false);
  });

  test('RULING F3-R8: teste dos hooks do plugin não conta como evidência de health-commit', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'plugins/gabarito-mestre/hooks/test/x.test.mjs': 'commit hash and app version exposed here',
      }),
    );
    assert.equal(out.resultados.find((r) => r.id === 'health-commit').found, false);
  });

  test('RULING F3-R8: controle — o mesmo texto na aplicação conta como evidência', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'src/health.ts': 'commit hash and app version exposed here',
      }),
    );
    const r = out.resultados.find((r) => r.id === 'health-commit');
    assert.equal(r.found, true);
    assert.equal(r.evidence, 'src/health.ts');
  });

  test('RULING F4-R10: template que o plugin INSTALA não conta como evidência de pr-template', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'plugins/gabarito-mestre/templates/PULL_REQUEST_TEMPLATE.md': 'migration requisito teardown',
      }),
    );
    assert.equal(out.resultados.find((r) => r.id === 'pr-template').found, false);
  });

  test('RULING F4-R10: controle — o mesmo template na aplicação conta como evidência', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        '.github/PULL_REQUEST_TEMPLATE.md': 'migration requisito teardown',
      }),
    );
    const r = out.resultados.find((r) => r.id === 'pr-template');
    assert.equal(r.found, true);
    assert.equal(r.evidence, '.github/PULL_REQUEST_TEMPLATE.md');
  });

  // B9 (T25b, handoff §B.9): a exclusão tem de ficar ANCORADA em 'gabarito-mestre/templates/' — não em
  // 'templates/' puro. Um template FORA do plugin, num caminho que também contém a palavra "templates/"
  // (aqui: apps/templates/), não pode virar invisível para a varredura de evidência (M11).
  test('B9: template fora do plugin em caminho "apps/templates/" CONTA como evidência (exclusão não pode alargar para "templates/" nu)', () => {
    const out = run(
      repo({
        'AGENTS.md': agents(0),
        'apps/templates/PULL_REQUEST_TEMPLATE.md': 'migration requisito teardown',
      }),
    );
    const r = out.resultados.find((r) => r.id === 'pr-template');
    assert.equal(r.found, true);
    assert.equal(r.evidence, 'apps/templates/PULL_REQUEST_TEMPLATE.md');
  });
});

describe('doctor — integridade do registro', () => {
  test('toda checagem tem id, regra, nível, rótulo e conserto', () => {
    for (const c of CHECKS) {
      assert.ok(c.id && c.rule && c.label && c.fix, `checagem incompleta: ${c.id}`);
      assert.ok([1, 2, 3, 'warn'].includes(c.level), `nível inválido em ${c.id}`);
      assert.ok(['scan', 'attest'].includes(c.kind), `tipo inválido em ${c.id}`);
      if (c.kind === 'scan') assert.equal(typeof c.detect, 'function', `${c.id} sem detect`);
    }
  });

  test('ids são únicos', () => {
    const ids = CHECKS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'harness-doctor.mjs');
const ok = { confirmado: true, por: 'g', em: hoje };
const diasAtras = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Repo 1.0.1 que o doctor 1.0.1 mede como nível 2 (fato (a) medido ao escrever o plano). */
const fixtureNivel2_101 = (declarado) => ({
  'AGENTS.md': agents(declarado),
  'src/db.ts': 'base.$extends(massMutationGuard()); strictUndefinedChecks; assertNotProduction();',
  'test/a.spec.ts': 'await db.x.' + 'deleteMany({ where: { id } });',
  '.gitignore': '.env\n',
  '.env.example': 'API_TOKEN=\n',
  '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'ruleset-obrigatorio': ok }),
  'docs/specs/a.md': '', 'docs/plans/a.md': '', 'docs/backlog.md': '', 'docs/harness/ledger.md': '',
  '.github/PULL_REQUEST_TEMPLATE.md': 'requisito migration teardown',
  'docs/harness/prompts.md': '',
  '.github/workflows/ci.yml': 'jobs: unit integration quality migrations-guard',
  'scripts/migrations-guard.mjs': 'DESTRUCTIVE_PATTERN',
});
/** O mesmo repo depois do onboarding 1.1.0 (fases 2 e 3) + CHANGELOG + atestado da Iniciativa. */
const fixtureNivel2_110 = (declarado, extraCfg = {}) => ({
  ...fixtureNivel2_101(declarado),
  'harness.config.json': JSON.stringify({
    fluxo: { ferramenta: 'arquivos', resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' },
    versionamento: { resolvidoEm: hoje, changelog: 'CHANGELOG.md' },
    ...extraCfg,
  }),
  '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'ruleset-obrigatorio': ok, 'iniciativa-resolvida': ok }),
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
});
/** AGENTS.md cujo núcleo tem EXATAMENTE `bytesNucleo` bytes (o `\n` antes do Apêndice conta no núcleo). */
function agentsComNucleo(bytesNucleo, apendice = '## Apêndice — Projeto\n\nIniciativa: INI-1\n') {
  const cabeca = '# AGENTS.md\n\n**Nível de adoção declarado: `2`**\n\n';
  return `${cabeca}${'x'.repeat(bytesNucleo - Buffer.byteLength(cabeca) - 1)}\n${apendice}`;
}
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/**
 * F2-R7: `versionamento` só passa com git LEGÍVEL e histórico conforme — um repo sem `.git`
 * não conta mais como "ok com aviso" (G9). Fixtures que precisam alcançar nível 2/3 via
 * `versionamento` usam este helper: `main` (BRANCHES_PADRAO) + um commit `chore:` (tiposLivres).
 */
function repoComGit(arquivos) {
  const dir = repo(arquivos);
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: fixture inicial');
  return dir;
}

describe('doctor 1.1.0 — tamanhoAgents (CTX-1, Review Focus 4)', () => {
  test('corta no primeiro cabeçalho que COMEÇA com "## Apêndice" — inclusive "## Apêndice — Projeto"', () => {
    const t = 'núcleo\n\n## Apêndice — Projeto\ncorpo\n## Apêndice\noutro';
    const { nucleo, apendice } = tamanhoAgents(t);
    assert.equal(nucleo, Buffer.byteLength('núcleo\n\n'));
    assert.equal(apendice, Buffer.byteLength('## Apêndice — Projeto\ncorpo\n## Apêndice\noutro'));
  });
  test('CRLF conta bytes reais e "\\r\\n## Apêndice" ainda é cabeçalho de linha', () => {
    const t = 'a\r\nb\r\n## Apêndice — x\r\ny';
    assert.deepEqual(tamanhoAgents(t), { nucleo: Buffer.byteLength('a\r\nb\r\n'), apendice: Buffer.byteLength('## Apêndice — x\r\ny') });
  });
  test('"## Apêndice" no meio de uma linha ou "### Apêndice" não cortam; sem Apêndice → apendice 0', () => {
    assert.equal(tamanhoAgents('x ## Apêndice y\n### Apêndice\n').apendice, 0);
    assert.deepEqual(tamanhoAgents(''), { nucleo: 0, apendice: 0 });
    assert.deepEqual(tamanhoAgents(null), { nucleo: 0, apendice: 0 });
  });
  test('acentos contam em UTF-8 (bytes, não caracteres)', () => {
    assert.equal(tamanhoAgents('ação').nucleo, 6);
  });
  test('fixture 17.291 → ok · 17.292 → FALTA (as duas juntas matam `>`→`>=`)', () => {
    assert.equal(tamanhoAgents(agentsComNucleo(17291)).nucleo, 17291, 'sanidade do helper');
    const passa = run(repo({ 'AGENTS.md': agentsComNucleo(17291) }));
    assert.equal(passa.resultados.find((r) => r.id === 'agents-tamanho').found, true);
    const falta = run(repo({ 'AGENTS.md': agentsComNucleo(17292) }));
    assert.equal(falta.resultados.find((r) => r.id === 'agents-tamanho').found, false);
    assert.match(falta.resultados.find((r) => r.id === 'agents-tamanho').evidence, /núcleo 17292\/17291/);
  });
  test('Apêndice acima de apendiceMaxBytes é FALTA mesmo com núcleo ok; tetos vêm de contexto.*', () => {
    const grande = run(repo({ 'AGENTS.md': agentsComNucleo(1000, `## Apêndice\n${'y'.repeat(4097)}`) }));
    assert.equal(grande.resultados.find((r) => r.id === 'agents-tamanho').found, false);
    const teto = run(repo({ 'AGENTS.md': agentsComNucleo(1000, `## Apêndice\n${'y'.repeat(4097)}`), 'harness.config.json': JSON.stringify({ contexto: { nucleoMaxBytes: 17291, apendiceMaxBytes: 8192 } }) }));
    assert.equal(teto.resultados.find((r) => r.id === 'agents-tamanho').found, true);
  });
});

describe('doctor 1.1.0 — fixtures 1.0.1 e 1.1.0 (DOC-1)', () => {
  test('a fixture 1.0.1 de nível 2 mede nível 1 no doctor 1.1.0 e lista as checagens novas', () => {
    const out = run(repo(fixtureNivel2_101(2)));
    assert.equal(out.alcancado, 1);
    assert.equal(out.mentindo, true);
    for (const id of ['fluxo-configurado', 'iniciativa-resolvida', 'versionamento', 'changelog']) assert.ok(out.novasFaltando.includes(id), id);
  });
  test('repo 1.0.1 em nível 1 continua nível 1 (nenhuma checagem nova é de nível 1)', () => {
    const fx = fixtureNivel2_101(1);
    delete fx['docs/backlog.md'];
    const out = run(repo(fx));
    assert.equal(out.alcancado, 1);
    assert.equal(out.mentindo, false);
    for (const c of CHECKS.filter((c) => NOVAS_1_1_0.includes(c.id))) assert.notEqual(c.level, 1, `${c.id} não pode ser nível 1`);
  });
  test('depois do onboarding (fixture 1.1.0) o nível volta a 2', () => {
    const out = run(repoComGit(fixtureNivel2_110(2)));
    assert.equal(out.alcancado, 2, JSON.stringify(out.novasFaltando));
    assert.equal(out.mentindo, false);
    assert.deepEqual(out.novasFaltando, ['paralelismo-calibrado'], 'só a checagem de nível 3 segue faltando (onboarding fase 4 não rodou)');
  });
  test('fluxo-configurado exige resolvidoEm no formato AAAA-MM-DD', () => {
    const bom = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ fluxo: { resolvidoEm: '2026-09-24' } }) }));
    assert.equal(bom.resultados.find((r) => r.id === 'fluxo-configurado').found, true);
    const ruim = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ fluxo: { resolvidoEm: 'ontem' } }) }));
    assert.equal(ruim.resultados.find((r) => r.id === 'fluxo-configurado').found, false);
  });
  test('iniciativa-resolvida é atestado com TTL 180 d', () => {
    const vencido = run(repo({ 'AGENTS.md': agents(0), '.harness/attest.json': JSON.stringify({ 'iniciativa-resolvida': { ...ok, em: diasAtras(200) } }) }));
    const r = vencido.resultados.find((x) => x.id === 'iniciativa-resolvida');
    assert.equal(r.kind, 'attest');
    assert.equal(r.found, false);
    assert.match(r.evidence, /vencido/);
  });
  test('atestado com `em` numérico segue inválido (diasEntre da lib não aceita número como data)', () => {
    const r = run(repo({ 'AGENTS.md': agents(0), '.harness/attest.json': JSON.stringify({ 'iniciativa-resolvida': { ...ok, em: Date.now() } }) })).resultados.find((x) => x.id === 'iniciativa-resolvida');
    assert.equal(r.found, false);
  });
  test('changelog: exige o arquivo de versionamento.changelog com "## [Unreleased]" ou "## Unreleased"', () => {
    const cfg = JSON.stringify({ versionamento: { changelog: 'HISTORY.md' } });
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## Unreleased\n' })).resultados.find((r) => r.id === 'changelog').found, true);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## 1.0.0\n' })).resultados.find((r) => r.id === 'changelog').found, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'CHANGELOG.md': '## [Unreleased]\n' })).resultados.find((r) => r.id === 'changelog').found, true, 'default CHANGELOG.md');
  });
  test('versionamento: sem git legível é FALTA (F2-R7/G9: indisponível nunca vale como validado); com histórico ruim também é FALTA', () => {
    const semGit = run(repo(fixtureNivel2_110(2))).resultados.find((r) => r.id === 'versionamento');
    assert.equal(semGit.found, false);
    assert.equal(semGit.warn, undefined);
    assert.match(semGit.evidence, /histórico não conferido/);
    assert.match(semGit.evidence, /sem git legível/);
    const dir = repo(fixtureNivel2_110(2));
    git(dir, 'init', '-q');
    git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'arrumei');
    const comGit = run(dir).resultados.find((r) => r.id === 'versionamento');
    assert.equal(comGit.found, false);
    assert.match(comGit.evidence, /arrumei/);
  });
  test('tag-semver é opcional: sem git "--", com tag v1.2.3 found', () => {
    const semGit = run(repo({ 'AGENTS.md': agents(0) })).resultados.find((r) => r.id === 'tag-semver');
    assert.equal(semGit.opcional, true);
    assert.equal(semGit.found, false);
    assert.equal(semGit.evidence, '--');
    const dir = repo({ 'AGENTS.md': agents(0) });
    git(dir, 'init', '-q');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: init');
    git(dir, 'tag', 'v1.2.3');
    assert.equal(run(dir).resultados.find((r) => r.id === 'tag-semver').found, true);
  });
  test('paralelismo-calibrado (n3): calibradoEm ≤ 180 d e teto ≥ simultaneos ≥ 1', () => {
    const cfg = (p) => JSON.stringify({ orquestracao: { paralelismo: p } });
    const id = 'paralelismo-calibrado';
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg({ simultaneos: 2, teto: 4, calibradoEm: hoje }) })).resultados.find((r) => r.id === id).found, true);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg({ simultaneos: 2, teto: 4, calibradoEm: diasAtras(181) }) })).resultados.find((r) => r.id === id).found, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg({ simultaneos: 5, teto: 4, calibradoEm: hoje }) })).resultados.find((r) => r.id === id).found, false);
    assert.equal(CHECKS.find((c) => c.id === id).level, 3);
  });
});

describe('doctor 1.1.0 — modelo-resolvido é warn, não FALTA (ORQ-5)', () => {
  test('vencido há 91 dias: aviso presente e nível INALTERADO', () => {
    const out = run(repoComGit(fixtureNivel2_110(2, { orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } })));
    assert.equal(out.alcancado, 2);
    assert.equal(CHECKS.find((c) => c.id === 'modelo-resolvido').level, 'warn');
    assert.ok(out.avisos.some((a) => a.startsWith('modelo-resolvido')), JSON.stringify(out.avisos));
    assert.match(out.resultados.find((r) => r.id === 'modelo-resolvido').evidence, /VENCIDO/);
  });
  test('dentro da validade: sem aviso', () => {
    const out = run(repo(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(10), validadeDias: 90 } } })));
    // T6: sem guarda.ambientes o doctor avisa (guarda-ambientes); aqui só interessa que o MODELO não avisa
    assert.deepEqual(out.avisos.filter((a) => a.startsWith('modelo-resolvido')), []);
  });
});

describe('doctor 1.1.0 — config ausente/vazia/inválida (Review Focus 3)', () => {
  test('harness.config.json inválido: run() não lança; fluxo-configurado é FALTA; configInvalido = true', () => {
    const out = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': '{"fluxo": ' }));
    assert.equal(out.configInvalido, true);
    assert.equal(out.resultados.find((r) => r.id === 'fluxo-configurado').found, false);
  });
  test('vazio (0 bytes) e sem arquivo: idem, sem lançar', () => {
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': '' })).configInvalido, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0) })).resultados.find((r) => r.id === 'fluxo-configurado').found, false);
  });
  test('CLI com config inválida: exit 0, AVISO fail-open, sem stack trace', () => {
    const dir = repo({ 'AGENTS.md': agents(0), 'harness.config.json': '{' });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /fail-open declarado \(G9\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
});

describe('doctor 1.1.0 — cache (DOC-2)', () => {
  test('run() é puro: não cria .harness/doctor-cache.json', () => {
    const dir = repo({ 'AGENTS.md': agents(0) });
    run(dir);
    assert.equal(existsSync(join(dir, '.harness', 'doctor-cache.json')), false);
  });
  test('--cache grava { nivel, declarado, em } mesmo quando o repo mente (exit 1)', () => {
    const dir = repo(fixtureNivel2_101(2));
    const r = spawnSync(process.execPath, [SCRIPT, '--json', '--cache'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    const c = JSON.parse(readFileSync(join(dir, '.harness', 'doctor-cache.json'), 'utf8'));
    assert.equal(c.nivel, 1);
    assert.equal(c.declarado, 2);
    assert.ok(!Number.isNaN(Date.parse(c.em)));
    assert.deepEqual(Object.keys(c), ['nivel', 'declarado', 'em']);
  });
  test('sem --cache não grava', () => {
    const dir = repo({ 'AGENTS.md': agents(0) });
    spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(existsSync(join(dir, '.harness', 'doctor-cache.json')), false);
  });
  test('M5: gravarCache é atômico (tmp + rename) — nenhum .tmp sobra em .harness/', () => {
    const dir = repo({ 'AGENTS.md': agents(0) });
    const r = spawnSync(process.execPath, [SCRIPT, '--json', '--cache'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, '.harness', 'doctor-cache.json')));
    const arquivos = readdirSync(join(dir, '.harness'));
    assert.deepEqual(arquivos.filter((f) => f.includes('.tmp')), [], JSON.stringify(arquivos));
  });
});

describe('doctor 1.1.0 — render', () => {
  test('repo 1.0.1 declarando 2: exit 1 e a linha "checagens novas da 1.1.0"', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--explain'], { cwd: repo(fixtureNivel2_101(2)), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /checagens novas da 1\.1\.0: rode o onboarding ou declare o nível medido/);
    assert.match(r.stdout, /FALTA .*fluxo configurado/);
    assert.match(r.stdout, /→ rode gabarito-instalar/);
  });
  test('modelo vencido aparece como "warn" numa seção de avisos e não altera o exit', () => {
    const dir = repoComGit(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } }));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /── Avisos/);
    assert.match(r.stdout, / warn .*modelo do orquestrador/);
  });
  test('as 8 checagens novas existem, com id/regra/nível/rótulo/conserto', () => {
    assert.equal(NOVAS_1_1_0.length, 8);
    for (const id of NOVAS_1_1_0) assert.ok(CHECKS.find((c) => c.id === id), id);
  });
  test('repo saudável 1.1.0 (declarado ≤ alcançado): a linha "checagens novas" NÃO aparece (M10)', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: repoComGit(fixtureNivel2_110(2)), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /checagens novas da 1\.1\.0/);
  });
  test('mentindo só por checagem ANTIGA (novasFaltando vazio): a linha "checagens novas" NÃO aparece (M10)', () => {
    // fixture 1.1.0 completa (fluxo, versionamento, changelog, iniciativa, agents-tamanho e
    // paralelismo-calibrado todos OK) mas sem o atestado ANTIGO 'ruleset-obrigatorio' — o
    // nível cai (declarado 3 > alcançado 1) só por causa de uma checagem da 1.0.1.
    const fx = fixtureNivel2_110(3, { orquestracao: { paralelismo: { simultaneos: 2, teto: 4, calibradoEm: hoje } } });
    fx['.harness/attest.json'] = JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'iniciativa-resolvida': ok });
    const dir = repoComGit(fx);
    const out = run(dir);
    assert.equal(out.mentindo, true, JSON.stringify({ declarado: out.declarado, alcancado: out.alcancado }));
    assert.deepEqual(out.novasFaltando, [], JSON.stringify(out.novasFaltando));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /checagens novas da 1\.1\.0/);
  });
});

// ────────────────────────────────────────────────────────────── T6 — camada de guarda, perfil, git ls-files

const AGORA = Date.parse('2026-11-02T12:00:00.000Z');
const horasAtras = (h) => new Date(AGORA - h * 3_600_000).toISOString();
const hb = (ts, extra = {}) => JSON.stringify({ seq: 1, ts, autor: 'a@b.c', sessao: 's1', agente: 'orquestrador', tipo: 'guarda.heartbeat', dados: { fonte: 'local' }, hash_anterior: null, ...extra });
const CFG_GUARDA = { guarda: { ambientes: { teste: { hosts: ['127.0.0.1'] }, prod: { hosts: ['api.exemplo.com'] } } } };
const camada = (dir) => doctor.camadaGuarda(dir, AGORA);
const arq = (dir, rel, texto) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), texto); };

/** repo git com `origin` (bare) e origin/HEAD; `origem` vai commitada, `local` sobrescreve a árvore. */
function repoComOrigin({ origem, local }) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-origin-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(origem));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: inicio');
  const bare = mkdtempSync(join(tmpdir(), 'doctor-bare-'));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  if (local !== undefined) writeFileSync(join(dir, 'harness.config.json'), typeof local === 'string' ? local : JSON.stringify(local));
  return dir;
}

const ARQ_DIARIO = '.harness/entregas/GM-9/events.s1.jsonl';
/** Heartbeat local completo: a linha no diário desta árvore + o marcador (gitignored) que a aponta. Devolve o ts. */
function heartbeatLocal(dir, horas, { sessao = 's1', arquivo = ARQ_DIARIO, linhas = [], marcador = {} } = {}) {
  const ts = horasAtras(horas);
  arq(dir, arquivo, `${[...linhas, hb(ts, { sessao })].join('\n')}\n`);
  arq(dir, '.harness/heartbeat.json', JSON.stringify({ ts, sessao, arquivo, autor: 'a@b.c', fonte: 'local', divergente: false, ...marcador }));
  return ts;
}

describe('T6 doctor — camada de guarda (REQ-INF-2)', () => {
  const cfg = { 'harness.config.json': JSON.stringify(CFG_GUARDA) };

  test('doctor-camada-ativa: marcador local + linha do diário há 2 h ⇒ ativa, heartbeatHa 2, fonte local', () => {
    const dir = repo({ ...cfg });
    heartbeatLocal(dir, 2);
    const c = camada(dir);
    assert.equal(c.estado, 'ativa');
    assert.equal(c.heartbeatHa, 2);
    assert.equal(c.fonte, 'local');
    assert.equal(c.divergente, false);
  });

  test('doctor-camada-ativa: vale o ts do MARCADOR, não outro heartbeat qualquer do mesmo arquivo', () => {
    const dir = repo({ ...cfg });
    heartbeatLocal(dir, 3, { linhas: [hb(horasAtras(9)), hb(horasAtras(1), { sessao: 'outra' })] });
    assert.equal(camada(dir).heartbeatHa, 3);
  });

  test('doctor-heartbeat-janela-24h: 24 h exatas ainda é ativa; 25 h é configurada com o heartbeatHa local', () => {
    const exato = repo({ ...cfg });
    heartbeatLocal(exato, 24);
    assert.equal(camada(exato).estado, 'ativa');
    const velho = repo({ ...cfg });
    heartbeatLocal(velho, 25);
    assert.equal(camada(velho).estado, 'configurada');
    assert.equal(camada(velho).heartbeatHa, 25);
    const dias = repo({ ...cfg });
    heartbeatLocal(dias, 24 * 8);
    assert.equal(camada(dias).estado, 'configurada');
    const sem = repo({ ...cfg });
    assert.equal(camada(sem).estado, 'configurada');
    assert.equal(camada(sem).heartbeatHa, null);
  });

  test('doctor-heartbeat-clonado-nao-ativa: diário versionado de outro autor há 20 h, sem marcador ⇒ configurada, com anotação', () => {
    const dir = repo({ ...cfg, [ARQ_DIARIO]: `${hb(horasAtras(20), { autor: 'outro@exemplo.com' })}\n` });
    const c = camada(dir);
    assert.equal(c.estado, 'configurada');
    assert.equal(c.heartbeatHa, null);
    assert.deepEqual(c.diario, { ha: 20, autor: 'outro@exemplo.com' });
    const antigo = repo({ ...cfg, [ARQ_DIARIO]: `${hb(horasAtras(24 * 8))}\n` });
    assert.equal(camada(antigo).diario, null, 'a anotação vale até 7 d');
  });

  test('doctor-heartbeat-clonado-nao-ativa: clone git real do repo com heartbeat commitado NÃO herda a camada ativa', () => {
    const origem = repoComGit({ ...cfg });
    heartbeatLocal(origem, 1, { marcador: {} });
    assert.equal(camada(origem).estado, 'ativa');
    git(origem, 'add', '-f', ARQ_DIARIO, 'harness.config.json');
    git(origem, 'commit', '-q', '-m', 'chore: diario');
    const clone = join(mkdtempSync(join(tmpdir(), 'doctor-clone-')), 'c');
    execFileSync('git', ['clone', '-q', origem, clone], { stdio: 'ignore' });
    const c = camada(clone);
    assert.equal(c.estado, 'configurada');
    assert.equal(c.heartbeatHa, null);
    assert.equal(c.diario.ha, 1);
  });

  test('doctor-marcador-sem-evento: marcador sem a linha correspondente no diário (arquivo, sessao ou ts) não vale', () => {
    const semArquivo = repo({ ...cfg });
    arq(semArquivo, '.harness/heartbeat.json', JSON.stringify({ ts: horasAtras(1), sessao: 's1', arquivo: ARQ_DIARIO }));
    assert.equal(camada(semArquivo).estado, 'configurada', 'arquivo apontado não existe');
    const outraSessao = repo({ ...cfg });
    heartbeatLocal(outraSessao, 1, { marcador: { sessao: 'zzz' } });
    assert.equal(camada(outraSessao).estado, 'configurada', 'sessao diferente');
    const outroTs = repo({ ...cfg });
    heartbeatLocal(outroTs, 1, { marcador: { ts: horasAtras(0.5) } });
    assert.equal(camada(outroTs).estado, 'configurada', 'ts diferente');
    const outroTipo = repo({ ...cfg });
    arq(outroTipo, ARQ_DIARIO, `${JSON.stringify({ tipo: 'sessao.inicio', sessao: 's1', ts: horasAtras(1) })}\n`);
    arq(outroTipo, '.harness/heartbeat.json', JSON.stringify({ ts: horasAtras(1), sessao: 's1', arquivo: ARQ_DIARIO }));
    assert.equal(camada(outroTipo).estado, 'configurada', 'outro tipo de evento com mesmo ts e sessao');
  });

  test('doctor-camada-configurada: sem heartbeat nenhum com ambientes declarados ⇒ configurada', () => {
    const sem = repo({ ...cfg });
    assert.equal(camada(sem).estado, 'configurada');
    assert.equal(camada(sem).heartbeatHa, null);
  });

  test('doctor-camada-divergente: árvore ≠ origin/HEAD ⇒ fonte origin, divergente true (a config do origin é a que vale)', () => {
    const dir = repoComOrigin({ origem: CFG_GUARDA, local: { guarda: { ambientes: { teste: { hosts: ['outro.local'] } } } } });
    const c = camada(dir);
    assert.equal(c.fonte, 'origin');
    assert.equal(c.divergente, true);
    assert.equal(c.estado, 'configurada');
    const igual = repoComOrigin({ origem: CFG_GUARDA, local: CFG_GUARDA });
    assert.equal(camada(igual).fonte, 'origin');
    assert.equal(camada(igual).divergente, false);
  });

  test('doctor-camada-config-local-invalida-origin-valida: lê o origin, marca divergente, não lança', () => {
    const dir = repoComOrigin({ origem: CFG_GUARDA, local: '{ isto não é json' });
    const c = camada(dir);
    assert.equal(c.fonte, 'origin');
    assert.equal(c.divergente, true);
    assert.equal(c.estado, 'configurada');
  });

  test('doctor-camada-nenhuma: sem config, sem deny, sem heartbeat ⇒ nenhuma, fonte null', () => {
    const c = camada(repo({ 'README.md': 'x' }));
    assert.deepEqual(c, { estado: 'nenhuma', heartbeatHa: null, fonte: null, divergente: false, diario: null });
  });

  test('doctor-camada-sem-git: dir sem .git nem origin ⇒ fonte local, sem exceção', () => {
    const c = camada(repo({ 'harness.config.json': JSON.stringify(CFG_GUARDA) }));
    assert.equal(c.fonte, 'local');
    assert.equal(c.divergente, false);
  });

  test('doctor-camada-worktree: cada árvore lê o PRÓPRIO marcador; o heartbeat de uma não ativa a outra', () => {
    const principal = repoComGit({ 'harness.config.json': JSON.stringify(CFG_GUARDA) });
    git(principal, 'add', 'harness.config.json');
    git(principal, 'commit', '-q', '-m', 'chore: config');
    const wt = join(mkdtempSync(join(tmpdir(), 'doctor-wt-')), 'wt');
    git(principal, 'worktree', 'add', '-q', '-b', 'wt/GM-9-1', wt);
    heartbeatLocal(wt, 1);
    assert.equal(camada(wt).estado, 'ativa');
    assert.equal(camada(principal).estado, 'configurada', 'o principal não enxerga o marcador do worktree');
    const principal2 = repoComGit({ 'harness.config.json': JSON.stringify(CFG_GUARDA) });
    git(principal2, 'add', 'harness.config.json');
    git(principal2, 'commit', '-q', '-m', 'chore: config');
    const wt2 = join(mkdtempSync(join(tmpdir(), 'doctor-wt-')), 'wt');
    git(principal2, 'worktree', 'add', '-q', '-b', 'wt/GM-9-2', wt2);
    heartbeatLocal(principal2, 2);
    assert.equal(camada(principal2).estado, 'ativa');
    assert.equal(camada(wt2).estado, 'configurada', 'o worktree não herda o marcador do principal');
  });

  test('doctor-camada-permissions-deny: .claude/settings.json com a lista do instalador ⇒ permissions.deny', () => {
    const dir = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: DENY_GUARDA } }) });
    assert.equal(camada(dir).estado, 'permissions.deny');
    const alheio = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(ls:*)'] } }) });
    assert.equal(camada(alheio).estado, 'nenhuma', 'deny próprio, sem nenhuma entrada da guarda, não é a camada');
    const quebrado = repo({ '.claude/settings.json': '{ // comentário\n}' });
    assert.equal(camada(quebrado).estado, 'nenhuma');
  });

  test('doctor-camada-permissions-deny-parcial (M7): UMA entrada da lista não é a camada; as 7 são', () => {
    const uma = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Read(.env*)'] } }) });
    assert.equal(camada(uma).estado, 'nenhuma');
    const seis = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: DENY_GUARDA.slice(1) } }) });
    assert.equal(camada(seis).estado, 'nenhuma');
    const todas = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(ls:*)', ...DENY_GUARDA] } }) });
    assert.equal(camada(todas).estado, 'permissions.deny', 'lista própria somada às 7');
  });

  test('doctor-ignora-git-dir-herdado (M10-O4): GIT_DIR/GIT_WORK_TREE do ambiente não fazem o doctor listar OUTRO repositório', () => {
    const outro = repoComGit({ 'x.txt': 'x' });
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'src/guard.ts': 'assertNotProduction()' });
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: join(outro, '.git'), GIT_WORK_TREE: outro } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).resultados.find((x) => x.id === 'R3-prod-guard').found, true);
  });

  test('doctor-camada-prioridade: ativa > configurada > permissions.deny', () => {
    const base = { '.claude/settings.json': JSON.stringify({ permissions: { deny: DENY_GUARDA } }) };
    assert.equal(camada(repo({ ...base, 'harness.config.json': JSON.stringify(CFG_GUARDA) })).estado, 'configurada');
    const ativa = repo({ ...base });
    heartbeatLocal(ativa, 1);
    assert.equal(camada(ativa).estado, 'ativa');
  });

  describe('ataques ao marcador (formato, caminho, tipo de arquivo, tamanho, git)', () => {
    const valido = (extra = {}) => ({ ts: horasAtras(1), sessao: 's1', arquivo: ARQ_DIARIO, ...extra });
    const comMarcador = (marcador, diario = `${hb(horasAtras(1))}\n`) => {
      const dir = repo({ ...cfg, [ARQ_DIARIO]: diario });
      arq(dir, '.harness/heartbeat.json', typeof marcador === 'string' ? marcador : JSON.stringify(marcador));
      return dir;
    };

    test('doctor-marcador-valido-base: o marcador mínimo do helper vale (controle dos ataques)', () => {
      assert.equal(camada(comMarcador(valido())).estado, 'ativa');
    });

    test('doctor-marcador-formato: JSON inválido, não-objeto, vazio e campos de tipo errado não valem', () => {
      for (const m of ['{ lixo', '', 'null', '[]', '"s"', '42', JSON.stringify(valido({ ts: 12345 })), JSON.stringify(valido({ sessao: 1 })), JSON.stringify(valido({ arquivo: ['x'] })), JSON.stringify({ sessao: 's1', arquivo: ARQ_DIARIO })]) {
        assert.equal(camada(comMarcador(m)).estado, 'configurada', m);
      }
    });

    test('doctor-marcador-ts: inválido, ausente, vazio e futuro (> 5 min) não valem; até 5 min à frente vale como 0 h', () => {
      for (const ts of ['ontem', '', '2026', '1', null]) {
        const dir = comMarcador(valido({ ts }), `${hb(ts)}\n`);
        assert.equal(camada(dir).estado, 'configurada', `ts=${JSON.stringify(ts)}`);
      }
      const futuro = new Date(AGORA + 3_600_000).toISOString();
      assert.equal(camada(comMarcador(valido({ ts: futuro }), `${hb(futuro)}\n`)).estado, 'configurada');
      const skew = new Date(AGORA + 60_000).toISOString();
      const c = camada(comMarcador(valido({ ts: skew }), `${hb(skew)}\n`));
      assert.equal(c.estado, 'ativa');
      assert.equal(c.heartbeatHa, 0);
    });

    test('doctor-marcador-arquivo-caminho: só .harness/entregas/<id>/events.*.jsonl; ../, absoluto, subpasta e outro nome não valem', () => {
      const fora = mkdtempSync(join(tmpdir(), 'doctor-fora-'));
      writeFileSync(join(fora, 'events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      for (const arquivo of ['../x/events.s1.jsonl', '.harness/entregas/../entregas/GM-9/events.s1.jsonl', '.harness/entregas/../../events.s1.jsonl', '.harness/entregas/../events.s1.jsonl', '.harness/entregas/./events.s1.jsonl', join(fora, 'events.s1.jsonl'), '/etc/passwd', '.harness/entregas/GM-9/outro.jsonl', '.harness/entregas/GM-9/sub/events.s1.jsonl', '.harness/events.s1.jsonl', '.harness/entregas/GM-9/events.s1.jsonl/', '.harness\\entregas\\GM-9\\events.s1.jsonl', '']) {
        const dir = repo({ ...cfg });
        arq(dir, '.harness/entregas/GM-9/outro.jsonl', `${hb(horasAtras(1))}\n`);
        arq(dir, '.harness/entregas/GM-9/sub/events.s1.jsonl', `${hb(horasAtras(1))}\n`);
        arq(dir, '.harness/events.s1.jsonl', `${hb(horasAtras(1))}\n`);
        arq(dir, ARQ_DIARIO, `${hb(horasAtras(1))}\n`);
        arq(dir, '.harness/heartbeat.json', JSON.stringify(valido({ arquivo })));
        assert.equal(camada(dir).estado, 'configurada', arquivo);
      }
    });

    test('doctor-marcador-nome-especial: id de entrega com espaço e não ASCII vale', () => {
      const dir = repo({ ...cfg });
      heartbeatLocal(dir, 1, { arquivo: '.harness/entregas/GM ação 9/events.s 1.jsonl', sessao: 's 1' });
      assert.equal(camada(dir).estado, 'ativa');
    });

    test('doctor-marcador-symlink: marcador, diário, entregas/<id> e entregas como symlink não valem', () => {
      const fora = mkdtempSync(join(tmpdir(), 'doctor-fora-'));
      const m = JSON.stringify(valido());
      writeFileSync(join(fora, 'm.json'), m);
      const a = repo({ ...cfg, [ARQ_DIARIO]: `${hb(horasAtras(1))}\n` });
      symlinkSync(join(fora, 'm.json'), join(a, '.harness/heartbeat.json'));
      assert.equal(camada(a).estado, 'configurada', 'marcador symlink');
      const b = repo({ ...cfg });
      writeFileSync(join(fora, 'ev.jsonl'), `${hb(horasAtras(1))}\n`);
      mkdirSync(join(b, '.harness/entregas/GM-9'), { recursive: true });
      symlinkSync(join(fora, 'ev.jsonl'), join(b, ARQ_DIARIO));
      arq(b, '.harness/heartbeat.json', m);
      assert.equal(camada(b).estado, 'configurada', 'diário symlink');
      const c = repo({ ...cfg });
      mkdirSync(join(c, '.harness/entregas'), { recursive: true });
      mkdirSync(join(fora, 'GM-9'));
      writeFileSync(join(fora, 'GM-9/events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      symlinkSync(join(fora, 'GM-9'), join(c, '.harness/entregas/GM-9'));
      arq(c, '.harness/heartbeat.json', m);
      assert.equal(camada(c).estado, 'configurada', 'diretório symlink');
      const d = repo({ ...cfg });
      mkdirSync(join(fora, 'e2/GM-9'), { recursive: true });
      writeFileSync(join(fora, 'e2/GM-9/events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      mkdirSync(join(d, '.harness'), { recursive: true });
      symlinkSync(join(fora, 'e2'), join(d, '.harness/entregas'));
      arq(d, '.harness/heartbeat.json', m);
      assert.equal(camada(d).estado, 'configurada', 'entregas symlink');
    });

    test('doctor-marcador-fifo: FIFO no lugar do marcador ou do diário não trava o doctor nem vale', () => {
      for (const alvo of ['.harness/heartbeat.json', ARQ_DIARIO]) {
        const dir = repo({ ...cfg });
        if (alvo === '.harness/heartbeat.json') arq(dir, ARQ_DIARIO, `${hb(horasAtras(1))}\n`);
        else arq(dir, '.harness/heartbeat.json', JSON.stringify(valido()));
        mkdirSync(dirname(join(dir, alvo)), { recursive: true });
        const mk = spawnSync('mkfifo', [join(dir, alvo)]);
        if (mk.status !== 0) return; // sem mkfifo na plataforma
        const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
        assert.equal(r.status, 0, `${alvo}: ${r.error?.message ?? r.stderr}`);
        assert.notEqual(JSON.parse(r.stdout).camada.estado, 'ativa', alvo);
      }
    });

    test('doctor-marcador-gigante: marcador > 64 KiB não vale, sem exceção; diário grande com a linha no meio vale', () => {
      const dir = comMarcador(JSON.stringify(valido({ lixo: 'x'.repeat(200 * 1024) })));
      assert.equal(camada(dir).estado, 'configurada');
      const lixo = `${JSON.stringify({ tipo: 'outro', ts: horasAtras(1), x: 'y'.repeat(80) })}\n`;
      const grande = repo({ ...cfg });
      heartbeatLocal(grande, 6, { linhas: [lixo.repeat(Math.ceil((2 * 1024 * 1024) / lixo.length))] });
      arq(grande, ARQ_DIARIO, readFileSync(join(grande, ARQ_DIARIO), 'utf8') + lixo.repeat(Math.ceil((2 * 1024 * 1024) / lixo.length)));
      assert.equal(camada(grande).estado, 'ativa', 'mais de 1 MiB de eventos depois do heartbeat não o esconde (M1)');
    });

    test('doctor-marcador-rastreado-nao-vale: marcador versionado por engano (git add -f) não dá ativa', () => {
      const dir = repoComGit({ ...cfg, '.gitignore': '.harness/heartbeat.json\n' });
      heartbeatLocal(dir, 1);
      assert.equal(camada(dir).estado, 'ativa', 'controle: ignorado e local vale');
      git(dir, 'add', '-f', '.harness/heartbeat.json', ARQ_DIARIO);
      assert.equal(camada(dir).estado, 'configurada');
      assert.equal(camada(dir).diario.ha, 1);
    });

    test('doctor-marcador-copiado-de-outra-arvore: marcador sem o diário correspondente nesta árvore não vale', () => {
      const origem = repo({ ...cfg });
      heartbeatLocal(origem, 1);
      const destino = repo({ ...cfg });
      arq(destino, '.harness/heartbeat.json', readFileSync(join(origem, '.harness/heartbeat.json'), 'utf8'));
      assert.equal(camada(destino).estado, 'configurada');
    });
  });

  describe('anotação do diário versionado (ts, linhas, tamanho, symlink, FIFO)', () => {
    const comLinhas = (linhas) => repo({ ...cfg, [ARQ_DIARIO]: linhas.join('\n') });

    test('doctor-camada-heartbeat-ts-invalido: "ontem", número, vazio e data sem hora não geram anotação', () => {
      for (const ts of ['ontem', 12345, '', '2026', '1', null]) {
        const c = camada(comLinhas([hb(ts)]));
        assert.equal(c.estado, 'configurada', `ts=${JSON.stringify(ts)}`);
        assert.equal(c.diario, null, `ts=${JSON.stringify(ts)}`);
      }
      assert.equal(camada(comLinhas([JSON.stringify({ tipo: 'guarda.heartbeat', dados: { fonte: 'local' } })])).diario, null);
    });

    test('doctor-camada-heartbeat-futuro: ts além de 5 min no futuro não vale; dentro da tolerância é 0 h', () => {
      assert.equal(camada(comLinhas([hb(new Date(AGORA + 3_600_000).toISOString())])).diario, null);
      assert.equal(camada(comLinhas([hb(new Date(AGORA + 60_000).toISOString())])).diario.ha, 0);
    });

    test('doctor-camada-heartbeat-linhas-ruins: null, string, array, truncada e outro tipo são ignorados; a boa vale', () => {
      const c = camada(comLinhas(['null', '"str"', '[]', '42', '{"tipo":"guarda.heartbeat","ts":"2026-11-02T1', JSON.stringify({ tipo: 'sessao.inicio', ts: horasAtras(1) }), JSON.stringify({ tipo: 'outro', ts: horasAtras(1), dados: 'guarda.heartbeat' }), hb(horasAtras(4))]));
      assert.equal(c.estado, 'configurada');
      assert.equal(c.diario.ha, 4);
      assert.equal(camada(comLinhas(['null', 'lixo'])).diario, null);
    });

    test('doctor-camada-heartbeat-arquivo-enorme: heartbeat no fim de 4 MiB vale; uma linha gigante sem quebra não gera nada', () => {
      const lixo = `${JSON.stringify({ tipo: 'outro', ts: horasAtras(1), x: 'y'.repeat(80) })}\n`;
      const dir = repo({ ...cfg });
      arq(dir, ARQ_DIARIO, lixo.repeat(Math.ceil((4 * 1024 * 1024) / lixo.length)) + `${hb(horasAtras(6))}\n`);
      assert.equal(camada(dir).diario.ha, 6);
      const dir2 = repo({ ...cfg });
      arq(dir2, ARQ_DIARIO, 'z'.repeat(5 * 1024 * 1024));
      assert.equal(camada(dir2).diario, null);
    });

    test('doctor-camada-heartbeat-muitas-entregas: com 120 entregas velhas, o arquivo mais recentemente escrito é o que anota', () => {
      const dir = repo({ ...cfg });
      const velho = new Date(AGORA - 30 * 86_400_000);
      for (let i = 0; i < 120; i++) {
        arq(dir, `.harness/entregas/GM-${i}/events.s${i}.jsonl`, `${hb(horasAtras(24 * 3))}\n`);
        utimesSync(join(dir, `.harness/entregas/GM-${i}/events.s${i}.jsonl`), velho, velho);
      }
      arq(dir, '.harness/entregas/GM-999/events.nova.jsonl', `${hb(horasAtras(2))}\n`);
      utimesSync(join(dir, '.harness/entregas/GM-999/events.nova.jsonl'), new Date(AGORA), new Date(AGORA));
      assert.equal(camada(dir).diario.ha, 2);
    });

    test('doctor-camada-heartbeat-nome: só events.*.jsonl diretamente em entregas/<id>/ anota', () => {
      const dir = repo({ ...cfg, '.harness/entregas/GM-9/outro.jsonl': `${hb(horasAtras(1))}\n`, '.harness/entregas/GM-9/sub/events.s1.jsonl': `${hb(horasAtras(1))}\n`, '.harness/events.s1.jsonl': `${hb(horasAtras(1))}\n` });
      assert.equal(camada(dir).diario, null);
    });

    test('doctor-camada-heartbeat-symlink: events.*.jsonl, entregas/<id> e entregas como symlink não anotam', () => {
      const fora = mkdtempSync(join(tmpdir(), 'doctor-fora-'));
      writeFileSync(join(fora, 'ev.jsonl'), `${hb(horasAtras(1))}\n`);
      const a = repo({ ...cfg });
      mkdirSync(join(a, '.harness/entregas/GM-9'), { recursive: true });
      symlinkSync(join(fora, 'ev.jsonl'), join(a, ARQ_DIARIO));
      assert.equal(camada(a).diario, null, 'arquivo symlink');
      const c = repo({ ...cfg });
      mkdirSync(join(c, '.harness'), { recursive: true });
      symlinkSync(fora, join(c, '.harness/entregas'));
      mkdirSync(join(fora, 'GM-7'));
      writeFileSync(join(fora, 'GM-7/events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      assert.equal(camada(c).diario, null, 'entregas symlink');
    });
  });
});

describe('T6 doctor — run(): camada, ambientes, perfil, avisos', () => {
  test('doctor-lista-ambientes: só ambiente com declaração real entra; prod sintetizado por branchPadrao não conta', () => {
    const dir = repo({ 'harness.config.json': JSON.stringify({ versionamento: { branchPadrao: 'main' }, guarda: { ambientes: { teste: { hosts: ['127.0.0.1'] }, homolog: { projetos: ['ref-h'] }, prod: {} } } }) });
    const out = run(dir);
    assert.deepEqual(out.camada.ambientes, ['teste', 'homolog']);
    assert.equal(out.camada.estado, 'configurada');
  });

  test('doctor-sem-secao-guarda-avisa: sem guarda.ambientes ⇒ aviso, camada nenhuma, nível intacto', () => {
    const fx = fixtureNivel2_110(2);
    const sem = run(repoComGit(fx));
    assert.equal(sem.camada.estado, 'nenhuma');
    assert.ok(sem.avisos.some((a) => /^guarda-ambientes: .*guarda\.ambientes/.test(a)), JSON.stringify(sem.avisos));
    const com = run(repoComGit({ ...fx, 'harness.config.json': JSON.stringify({ ...JSON.parse(fx['harness.config.json']), ...CFG_GUARDA }) }));
    assert.ok(!com.avisos.some((a) => /^guarda-ambientes/.test(a)));
    assert.equal(sem.alcancado, com.alcancado, 'o aviso não mexe no nível');
    assert.equal(CHECKS.find((c) => c.id === 'guarda-ambientes').level, 'warn');
  });

  test('doctor-aviso-divergente: árvore ≠ origin/HEAD vira aviso', () => {
    const dir = repoComOrigin({ origem: CFG_GUARDA, local: { guarda: { ambientes: { teste: { hosts: ['x'] } } } } });
    assert.ok(run(dir).avisos.some((a) => /^guarda-divergente/.test(a)));
  });

  test('doctor-repo-sem-app: perfil explícito ⇒ G3 e teardown n/a (found, na); segurança restante segue valendo', () => {
    const dir = repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }) });
    const out = run(dir);
    const por = Object.fromEntries(out.resultados.map((r) => [r.id, r]));
    for (const id of ['G3-mass-mutation', 'G3-strict-undefined', 'teardown-por-id']) {
      assert.equal(por[id].found, true, id);
      assert.equal(por[id].na, true, id);
      assert.match(por[id].evidence, /n\/a/, id);
    }
    for (const id of ['R3-prod-guard', 'secrets-fora-do-repo', 'branch-protegida', 'backup-verificado']) {
      assert.equal(por[id].found, false, `${id} NÃO pode ser rebaixado pelo perfil`);
      assert.notEqual(por[id].na, true, id);
    }
    assert.equal(out.perfil, 'repo-sem-app');
    const sem = run(repo({ 'AGENTS.md': agents(0) }));
    assert.equal(sem.resultados.find((r) => r.id === 'G3-mass-mutation').na, undefined);
    assert.equal(sem.perfil, null);
  });

  test('doctor-repo-sem-app: valor de perfil inexistente ou com outra caixa não rebaixa nada', () => {
    for (const perfil of ['REPO-SEM-APP', 'repo-sem-app ', 'app', ['repo-sem-app'], true]) {
      const out = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil }) }));
      assert.equal(out.resultados.find((r) => r.id === 'G3-mass-mutation').found, false, JSON.stringify(perfil));
      assert.equal(out.perfil, null);
    }
  });

  test('doctor-repo-sem-app: com os atestados e o resto de segurança, perfil leva o repo ao nível 1', () => {
    const dir = repo({
      'AGENTS.md': agents(0),
      'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }),
      'src/db.ts': 'assertNotProduction();',
      '.gitignore': '.env\n',
      '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok }),
    });
    assert.equal(run(dir).alcancado, 1);
  });

  describe('A2 — arquivo ignorado pelo git não é evidência em NENHUM caminho (has, atestado, changelog, AGENTS.md)', () => {
    const base = { 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }), 'src/db.ts': 'assertNotProduction();', '.env.example': 'X=1\n' };
    const atestados = JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok });

    test('doctor-ignorado-nao-e-evidencia: atestado em .harness/ ignorado não sobe o nível (clone do mesmo commit também seria 0)', () => {
      const visivel = repoComGit({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.harness/attest.json': atestados });
      assert.equal(run(visivel).alcancado, 1, 'controle: o mesmo atestado versionável vale');
      const ignorado = repoComGit({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n.harness/\n', '.harness/attest.json': atestados });
      const out = run(ignorado);
      assert.equal(out.alcancado, 0);
      assert.equal(out.resultados.find((r) => r.id === 'branch-protegida').found, false);
    });

    test('doctor-ignorado-nao-e-evidencia: atestado ignorado por .git/info/exclude também não vale', () => {
      const dir = repoComGit({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.harness/attest.json': atestados });
      writeFileSync(join(dir, '.git', 'info', 'exclude'), '.harness/attest.json\n');
      assert.equal(run(dir).alcancado, 0);
    });

    test('doctor-ignorado-nao-e-evidencia: CHANGELOG.md ignorado não é evidência do changelog', () => {
      const ch = (gi) => run(repoComGit({ 'AGENTS.md': agents(0), '.gitignore': gi, 'CHANGELOG.md': '## [Unreleased]\n' })).resultados.find((r) => r.id === 'changelog');
      assert.equal(ch('').found, true, 'controle');
      assert.equal(ch('CHANGELOG.md\n').found, false);
    });

    test('doctor-ignorado-nao-e-evidencia: AGENTS.md ignorado não alimenta o nível declarado nem o tamanho', () => {
      const dir = repoComGit({ 'AGENTS.md': agents(2), '.gitignore': 'AGENTS.md\n' });
      const out = run(dir);
      assert.equal(out.declarado, null);
      assert.equal(out.resultados.find((r) => r.id === 'agents-tamanho').found, false);
      assert.equal(run(repoComGit({ 'AGENTS.md': agents(2) })).declarado, 2, 'controle');
    });

    test('doctor-ignorado-nao-e-evidencia: repo sem nenhum commit conta arquivos novos (não ignorados) como evidência', () => {
      const dir = repo({ ...base, 'AGENTS.md': agents(0), '.gitignore': '.env\n', '.harness/attest.json': atestados });
      git(dir, 'init', '-q');
      assert.equal(run(dir).alcancado, 1);
    });
  });

  test('g8-md-nao-evidencia: menção em .md não prova a guarda; script de código prova', () => {
    const g8 = (arquivos) => run(repo({ 'AGENTS.md': agents(0), ...arquivos })).resultados.find((r) => r.id === 'G8-migrations-guard');
    assert.equal(g8({ 'README.md': 'rode migrations-guard.mjs e DESTRUCTIVE_PATTERN no CI' }).found, false);
    assert.equal(g8({ 'docs/harness/gates.md': 'migrations-guard' }).found, false);
    assert.equal(g8({ 'scripts/migrations-guard.mjs': 'DESTRUCTIVE_PATTERN' }).found, true);
  });

  test('doctor-varre-git-ls-files: arquivo ignorado pelo git não é evidência; rastreado e não-ASCII com espaço é', () => {
    const ignorado = repoComGit({ 'AGENTS.md': agents(0), '.gitignore': 'src/guard.ts\n', 'src/guard.ts': 'assertNotProduction()' });
    assert.equal(run(ignorado).resultados.find((r) => r.id === 'R3-prod-guard').found, false, 'ignorado');
    const naoIgnorado = repoComGit({ 'AGENTS.md': agents(0), 'src/ação do guarda.ts': 'assertNotProduction()' });
    const r3 = run(naoIgnorado).resultados.find((r) => r.id === 'R3-prod-guard');
    assert.equal(r3.found, true);
    assert.equal(r3.evidence, 'src/ação do guarda.ts');
    const commitado = repoComGit({ 'AGENTS.md': agents(0), 'src/b c.ts': 'assertNotProduction()' });
    git(commitado, 'add', '-A');
    git(commitado, 'commit', '-q', '-m', 'chore: add');
    assert.equal(run(commitado).resultados.find((r) => r.id === 'R3-prod-guard').evidence, 'src/b c.ts');
  });

  test('doctor-varre-git-ls-files: fora de repo git a varredura de disco segue valendo (fallback)', () => {
    const r3 = run(repo({ 'AGENTS.md': agents(0), 'src/guard.ts': 'assertNotProduction()' })).resultados.find((r) => r.id === 'R3-prod-guard');
    assert.equal(r3.found, true);
  });

  test('doctor-varre-git-ls-files: diretório dentro de OUTRO repo (não é a raiz) cai na varredura de disco', () => {
    const pai = repoComGit({ '.gitignore': 'sub/\n' });
    const sub = join(pai, 'sub');
    arq(sub, 'AGENTS.md', agents(0));
    arq(sub, 'src/guard.ts', 'assertNotProduction()');
    assert.equal(run(sub).resultados.find((r) => r.id === 'R3-prod-guard').found, true);
  });

  test('doctor-chaves-mortas: config e atestado com chaves removidas viram aviso listando cada uma', () => {
    const dir = repo({
      'AGENTS.md': agents(0),
      'harness.config.json': JSON.stringify({ migrationsDir: 'prisma/migrations', versionamento: { modelo: 'trunk', commit: 'conventional' }, orquestracao: { sempreSubagente: true, modelo: { alias: 'x' }, paralelismo: { modo: 'auto' } } }),
      '.harness/attest.json': JSON.stringify({ 'squash-titulo-pr': ok }),
    });
    const out = run(dir);
    const a = out.avisos.find((x) => x.startsWith('chaves-mortas'));
    assert.ok(a, JSON.stringify(out.avisos));
    for (const k of ['migrationsDir', 'versionamento.modelo', 'versionamento.commit', 'orquestracao.sempreSubagente', 'orquestracao.paralelismo.modo', 'attest.squash-titulo-pr']) assert.ok(a.includes(k), `${k} em: ${a}`);
    assert.ok(!a.includes('orquestracao.modelo'), 'orquestracao.modelo está VIVA');
    assert.ok(!run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ orquestracao: { modelo: { alias: 'x' } } }) })).avisos.some((x) => x.startsWith('chaves-mortas')));
  });

  test('doctor-chaves-mortas: o doctor deixou de ter migrationsDir como default', () => {
    assert.equal(readFileSync(SCRIPT, 'utf8').includes("migrationsDir: 'prisma/migrations'"), false);
  });

  test('diasdesde-numerico-invalido (herdado T1a MINOR B): calibradoEm numérico no JSON é inválido, não "hoje"', () => {
    const cfg = { orquestracao: { paralelismo: { simultaneos: 2, teto: 4, calibradoEm: Date.now() } } };
    const r = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify(cfg) })).resultados.find((x) => x.id === 'paralelismo-calibrado');
    assert.equal(r.found, false);
    assert.match(r.evidence, /inválida/);
    const m = run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ orquestracao: { modelo: { alias: 'x', resolvidoEm: Date.now(), validadeDias: 90 } } }) })).resultados.find((x) => x.id === 'modelo-resolvido');
    assert.equal(m.found, false);
    assert.match(m.evidence, /inválido/);
  });
});

// ────────────────────────────────────────────────────────────── T6 rodada 2 — R1: a mesma regra do A2 em TODO leitor

/** O que o nível/veredito do doctor enxerga (sem a camada, que descreve ESTA árvore por desenho). */
const resumo = (o) => JSON.stringify({ n: o.alcancado, p: o.perfil, d: o.declarado, sa: o.semAgents, ci: o.configInvalido, nf: o.novasFaltando, f: o.resultados.map((r) => [r.id, r.found, r.na === true]), a: o.avisos.filter((x) => !/^guarda-/.test(x)) });

describe('T6 doctor — R1: arquivo ignorado/apagado não é evidência em NENHUM leitor (config, atestado, AGENTS.md, CHANGELOG, ci.yml, .gitignore, .env.example)', () => {
  // `.env.example` só muda o veredito quando tem segredo preenchido (visível ⇒ FALTA; ausente ⇒ sem exemplo, ok)
  const fx = (f) => (f === '.env.example' ? { ...fixtureNivel2_110(2, { perfil: 'repo-sem-app' }), '.env.example': 'API_TOKEN=preenchido\n' } : fixtureNivel2_110(2, { perfil: 'repo-sem-app' }));
  const ARQUIVOS = ['harness.config.json', '.harness/attest.json', 'AGENTS.md', 'CHANGELOG.md', '.github/workflows/ci.yml', '.gitignore', '.env.example'];
  const sem = (arquivos, f) => Object.fromEntries(Object.entries(arquivos).filter(([k]) => k !== f));
  const MODOS = {
    'gitignore': (dir, f) => writeFileSync(join(dir, '.gitignore'), `${readFileSync(join(dir, '.gitignore'), 'utf8')}${f}\n`),
    'info/exclude': (dir, f) => writeFileSync(join(dir, '.git', 'info', 'exclude'), `${f}\n`),
    'core.excludesFile': (dir, f) => {
      const ex = join(mkdtempSync(join(tmpdir(), 'doctor-exfile-')), 'ignore');
      writeFileSync(ex, `${f}\n`);
      git(dir, 'config', 'core.excludesFile', ex);
    },
    'rastreado e apagado do disco': (dir, f) => {
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'chore: tudo');
      unlinkSync(join(dir, f));
    },
  };
  for (const f of ARQUIVOS) {
    for (const [modo, aplica] of Object.entries(MODOS)) {
      if (f === '.gitignore' && modo === 'gitignore') continue;
      test(`doctor-ignorado-vale-ausente: ${f} via ${modo} ⇒ o doctor mede como se o arquivo não existisse (o clone do commit)`, () => {
        const dir = repoComGit(fx(f));
        aplica(dir, f);
        const ausente = repoComGit(sem(fx(f), f));
        assert.equal(resumo(run(dir)), resumo(run(ausente)));
      });
    }
  }

  test('doctor-ignorado-vale-ausente: o controle muda o resultado (arquivo visível ≠ ausente), então a igualdade acima não é vacuidade', () => {
    for (const f of ARQUIVOS) {
      assert.notEqual(resumo(run(repoComGit(fx(f)))), resumo(run(repoComGit(sem(fx(f), f)))), f);
    }
  });

  test('doctor-config-ignorada-perfil: harness.config.json ignorado com perfil repo-sem-app ⇒ nível 0 e perfil null (o clone vê isto)', () => {
    const base = { 'AGENTS.md': agents(0), 'src/db.ts': 'assertNotProduction();', '.env.example': 'X=1\n', '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok }) };
    const cfg = JSON.stringify({ perfil: 'repo-sem-app' });
    const visivel = run(repoComGit({ ...base, '.gitignore': '.env\n', 'harness.config.json': cfg }));
    assert.equal(visivel.alcancado, 1, 'controle: a config visível vale');
    const ign = run(repoComGit({ ...base, '.gitignore': '.env\nharness.config.json\n', 'harness.config.json': cfg }));
    assert.equal(ign.alcancado, 0);
    assert.equal(ign.perfil, null);
    assert.equal(ign.configInvalido, false, 'ignorado é ausente, não inválido');
  });

  test('doctor-config-ignorada-perfil: config ignorada com attestFile redirecionado não move o atestado de lugar', () => {
    const arquivos = { 'AGENTS.md': agents(0), '.gitignore': '.env\nharness.config.json\n', 'src/db.ts': 'assertNotProduction();', '.env.example': 'X=1\n', 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app', attestFile: 'docs/a.json' }), 'docs/a.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok }) };
    assert.equal(run(repoComGit(arquivos)).alcancado, 0);
  });

  test('doctor-config-ignorada-perfil: repo sem nenhum commit também ignora a config ignorada', () => {
    const dir = repo({ 'AGENTS.md': agents(0), '.gitignore': 'harness.config.json\n', 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }) });
    git(dir, 'init', '-q');
    assert.equal(run(dir).perfil, null);
  });

  test('doctor-config-ignorada-perfil: fora de git o disco é a verdade (não há o que ignorar)', () => {
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app' }) })).perfil, 'repo-sem-app');
  });

  test('doctor-git-ilegivel: git presente mas ls-files falha ⇒ NADA vale como evidência (não reabre o disco)', () => {
    const dir = repoComGit(fx('AGENTS.md'));
    writeFileSync(join(dir, '.git', 'index'), 'lixo que não é um índice');
    assert.throws(() => git(dir, 'ls-files'), /index|signature|fatal/i, 'premissa: o git de fato falha');
    const out = run(dir);
    assert.equal(out.semAgents, true);
    assert.equal(out.perfil, null);
    assert.equal(out.alcancado, 0);
    assert.equal(out.resultados.find((r) => r.id === 'branch-protegida').found, false);
  });

  test('doctor-config-ignorada-versionamento: o histórico é conferido com a config VISÍVEL; a ignorada não afrouxa tiposLivres', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(0), '.gitignore': 'harness.config.json\n', 'harness.config.json': JSON.stringify({ versionamento: { resolvidoEm: hoje, tiposLivres: ['bagunca', 'chore'] } }) });
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'bagunca: nada a ver com conventional');
    const r = run(dir, { versionamento: { resolvidoEm: hoje } }).resultados.find((x) => x.id === 'versionamento');
    assert.equal(r.found, false, r.evidence);
  });

  test('doctor-tag-semver-ignora-git-dir-herdado (M4): GIT_DIR de outro repo não troca as tags', () => {
    const outro = repoComGit({ 'AGENTS.md': agents(0) });
    git(outro, 'tag', 'v9.9.9');
    const dir = repoComGit({ 'AGENTS.md': agents(0) });
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: join(outro, '.git') } });
    assert.equal(JSON.parse(r.stdout).resultados.find((x) => x.id === 'tag-semver').found, false);
  });

  test('doctor-rastreado-vale-a-arvore: rastreado vale mesmo ignorado depois (git add -f), assume-unchanged e modificado só na árvore leem o disco', () => {
    const cfg = JSON.stringify({ perfil: 'repo-sem-app' });
    const rastreado = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, '.gitignore': 'harness.config.json\n' });
    git(rastreado, 'add', '-f', 'harness.config.json');
    git(rastreado, 'commit', '-q', '-m', 'chore: config');
    assert.equal(run(rastreado).perfil, 'repo-sem-app', 'rastreado com -f: o clone também a tem');
    git(rastreado, 'update-index', '--assume-unchanged', 'harness.config.json');
    assert.equal(run(rastreado).perfil, 'repo-sem-app', 'assume-unchanged segue rastreado');
    const modificado = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': '{}' });
    git(modificado, 'add', '-A');
    git(modificado, 'commit', '-q', '-m', 'chore: config');
    writeFileSync(join(modificado, 'harness.config.json'), cfg);
    const out = run(modificado);
    assert.equal(out.perfil, 'repo-sem-app', 'veredito: a árvore é o que se mede, como em AGENTS.md e atestado modificados');
    assert.equal(out.camada.divergente, false);
  });
});

describe('T6 doctor — CLI', () => {
  test('doctor-json-expoe-camada-e-perfil: --json traz camada {estado,heartbeatHa,fonte,divergente,ambientes} e perfil', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app', ...CFG_GUARDA }) });
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(j.camada).sort(), ['ambientes', 'diario', 'divergente', 'estado', 'fonte', 'heartbeatHa']);
    assert.equal(j.camada.estado, 'configurada');
    assert.deepEqual(j.camada.ambientes, ['teste', 'prod']);
    assert.equal(j.perfil, 'repo-sem-app');
  });

  test('doctor-render-camada-diario: diário de outro autor aparece como anotação em configurada, nunca como ativa', () => {
    const ts = new Date(Date.now() - 20 * 3_600_000).toISOString();
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify(CFG_GUARDA), [ARQ_DIARIO]: `${hb(ts, { autor: 'colega@x' })}\n` });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /Camada de guarda: configurada .*diário com heartbeat há 20 h \(colega@x/);
    assert.doesNotMatch(r.stdout, /Camada de guarda: ativa/);
  });

  test('doctor-render-camada: texto mostra camada, fonte, ambientes e perfil; n/a aparece como n/a, não como ok', () => {
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'harness.config.json': JSON.stringify({ perfil: 'repo-sem-app', ...CFG_GUARDA }) });
    const ts = new Date(Date.now() - 2 * 3_600_000).toISOString();
    arq(dir, ARQ_DIARIO, `${hb(ts)}\n`);
    arq(dir, '.harness/heartbeat.json', JSON.stringify({ ts, sessao: 's1', arquivo: ARQ_DIARIO }));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /Camada de guarda: ativa \(heartbeat há 2 h\) · fonte local/);
    assert.match(r.stdout, /Ambientes declarados: teste, prod/);
    assert.match(r.stdout, /Perfil: repo-sem-app/);
    assert.match(r.stdout, / n\/a .*guarda de mutação em massa/);
  });
});

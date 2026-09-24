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
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, parseDeclaredLevel, CHECKS, tamanhoAgents, NOVAS_1_1_0 } from '../scripts/harness-doctor.mjs';

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
    assert.equal(out.resultados.filter((r) => r.found && r.id !== 'agents-tamanho').length, 0, 'agents-tamanho passa por construção num AGENTS.md mínimo');
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
    const out = run(repo(fixtureNivel2_110(2)));
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
  test('changelog: exige o arquivo de versionamento.changelog com "## [Unreleased]" ou "## Unreleased"', () => {
    const cfg = JSON.stringify({ versionamento: { changelog: 'HISTORY.md' } });
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## Unreleased\n' })).resultados.find((r) => r.id === 'changelog').found, true);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'harness.config.json': cfg, 'HISTORY.md': '## 1.0.0\n' })).resultados.find((r) => r.id === 'changelog').found, false);
    assert.equal(run(repo({ 'AGENTS.md': agents(0), 'CHANGELOG.md': '## [Unreleased]\n' })).resultados.find((r) => r.id === 'changelog').found, true, 'default CHANGELOG.md');
  });
  test('versionamento: sem git é ok com aviso; com histórico ruim é FALTA', () => {
    const semGit = run(repo(fixtureNivel2_110(2))).resultados.find((r) => r.id === 'versionamento');
    assert.equal(semGit.found, true);
    assert.match(semGit.warn, /histórico não conferido/);
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
    const out = run(repo(fixtureNivel2_110(2, { orquestracao: { modelo: { politica: 'mais-potente', alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } })));
    assert.equal(out.alcancado, 2);
    assert.equal(CHECKS.find((c) => c.id === 'modelo-resolvido').level, 'warn');
    assert.ok(out.avisos.some((a) => a.startsWith('modelo-resolvido')), JSON.stringify(out.avisos));
    assert.match(out.resultados.find((r) => r.id === 'modelo-resolvido').evidence, /VENCIDO/);
  });
  test('dentro da validade: sem aviso', () => {
    const out = run(repo(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(10), validadeDias: 90 } } })));
    assert.deepEqual(out.avisos, []);
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
    const dir = repo(fixtureNivel2_110(2, { orquestracao: { modelo: { alias: 'fable', resolvidoEm: diasAtras(91), validadeDias: 90 } } }));
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
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: repo(fixtureNivel2_110(2)), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /checagens novas da 1\.1\.0/);
  });
  test('mentindo só por checagem ANTIGA (novasFaltando vazio): a linha "checagens novas" NÃO aparece (M10)', () => {
    // fixture 1.1.0 completa (fluxo, versionamento, changelog, iniciativa, agents-tamanho e
    // paralelismo-calibrado todos OK) mas sem o atestado ANTIGO 'ruleset-obrigatorio' — o
    // nível cai (declarado 3 > alcançado 1) só por causa de uma checagem da 1.0.1.
    const fx = fixtureNivel2_110(3, { orquestracao: { paralelismo: { simultaneos: 2, teto: 4, calibradoEm: hoje } } });
    fx['.harness/attest.json'] = JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'iniciativa-resolvida': ok });
    const dir = repo(fx);
    const out = run(dir);
    assert.equal(out.mentindo, true, JSON.stringify({ declarado: out.declarado, alcancado: out.alcancado }));
    assert.deepEqual(out.novasFaltando, [], JSON.stringify(out.novasFaltando));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /checagens novas da 1\.1\.0/);
  });
});

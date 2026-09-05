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
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run, parseDeclaredLevel, CHECKS } from '../scripts/harness-doctor.mjs';

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
    assert.equal(out.resultados.filter((r) => r.found).length, 0);
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
      assert.ok([1, 2, 3].includes(c.level), `nível inválido em ${c.id}`);
      assert.ok(['scan', 'attest'].includes(c.kind), `tipo inválido em ${c.id}`);
      if (c.kind === 'scan') assert.equal(typeof c.detect, 'function', `${c.id} sem detect`);
    }
  });

  test('ids são únicos', () => {
    const ids = CHECKS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

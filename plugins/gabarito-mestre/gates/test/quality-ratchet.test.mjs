/**
 * Testes do GATE — ratchet de qualidade.
 *
 * O teste central é `denominador que encolhe REPROVA, mesmo com a porcentagem subindo`:
 * é a forma clássica de um ratchet mentir, e a razão de a contagem de arquivos viver
 * no baseline.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  remover a checagem de contagem de arquivos
 *  M2  deixar `--accept` gravar baseline com erro de lint presente
 *  M3  tratar relatório ausente como ok
 *  M4  aplicar a tolerância também para cima (aceitar queda maior)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run, avaliar, lerCobertura, lerViolacoes, TOLERANCE } from '../scripts/quality-ratchet.mjs';

function repo(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'ratchet-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  }
  return dir;
}

/** coverage-summary.json com N arquivos e as métricas dadas */
const cobertura = (pct, nFiles) => {
  const o = { total: {} };
  for (const m of ['lines', 'statements', 'functions', 'branches']) o.total[m] = { pct };
  for (let i = 0; i < nFiles; i += 1) o[`/src/f${i}.ts`] = {};
  return o;
};

const CFG = {
  quality: {
    baselineFile: '.quality/baseline.json',
    coverage: { api: 'coverage/coverage-summary.json' },
    duplication: { report: 'coverage/jscpd.json', ceiling: 2 },
    violations: { report: 'coverage/eslint.json' },
  },
};

const jscpd = (pct) => ({ statistics: { total: { percentage: pct } } });
const eslint = (errors, warnings) => [{ errorCount: errors, warningCount: warnings }];

describe('ratchet — leitura', () => {
  test('extrai percentuais E a contagem de arquivos', () => {
    const c = lerCobertura(cobertura(80, 12));
    assert.equal(c.lines, 80);
    assert.equal(c.files, 12);
  });

  test('soma erros e avisos de todos os arquivos', () => {
    assert.deepEqual(lerViolacoes([{ errorCount: 1, warningCount: 2 }, { errorCount: 0, warningCount: 3 }]), {
      errors: 1,
      warnings: 5,
    });
  });
});

describe('ratchet — o denominador', () => {
  const base = { coverage: { api: { lines: 80, statements: 80, functions: 80, branches: 80, files: 10 } } };

  test('REPROVA quando o universo medido encolhe, MESMO com a cobertura subindo', () => {
    // É assim que o ratchet mente: um arquivo sai da conta e a % sobe sozinha.
    const atual = { coverage: { api: { lines: 95, statements: 95, functions: 95, branches: 95, files: 6 } }, ausentes: [] };
    const r = avaliar(atual, base, {});
    assert.equal(r.ok, false);
    assert.match(r.falhas[0].razao, /ENCOLHEU \(10 → 6/);
    assert.match(r.falhas[0].razao, /verde mentindo/);
  });

  test('universo crescendo com cobertura estável passa', () => {
    const atual = { coverage: { api: { lines: 80, statements: 80, functions: 80, branches: 80, files: 14 } }, ausentes: [] };
    assert.equal(avaliar(atual, base, {}).ok, true);
  });
});

describe('ratchet — tolerância', () => {
  const base = { coverage: { api: { lines: 80, statements: 80, functions: 80, branches: 80, files: 10 } } };
  const atualCom = (pct) => ({ coverage: { api: { lines: pct, statements: 80, functions: 80, branches: 80, files: 10 } }, ausentes: [] });

  test(`queda dentro da tolerância (${TOLERANCE}pp) passa`, () => {
    assert.equal(avaliar(atualCom(80 - TOLERANCE), base, {}).ok, true);
  });

  test('queda além da tolerância reprova', () => {
    const r = avaliar(atualCom(80 - TOLERANCE - 0.01), base, {});
    assert.equal(r.ok, false);
    assert.match(r.falhas[0].razao, /lines/);
  });

  test('pacote do baseline que sumiu da medição reprova — lane órfã fura a rede', () => {
    const r = avaliar({ coverage: {}, ausentes: [] }, base, {});
    assert.equal(r.ok, false);
    assert.match(r.falhas[0].razao, /não foi medido agora/);
  });
});

describe('ratchet — duplicação e violações', () => {
  test('duplicação acima do teto reprova, e o teto não tem aceite', () => {
    const r = avaliar({ coverage: {}, duplication: 3.5, ausentes: [] }, { coverage: {} }, { duplication: { ceiling: 2 } });
    assert.equal(r.ok, false);
    assert.match(r.falhas[0].razao, /Teto é teto/);
  });

  test('erro de lint reprova sempre', () => {
    const r = avaliar({ coverage: {}, violations: { errors: 1, warnings: 0 }, ausentes: [] }, { coverage: {} }, {});
    assert.equal(r.ok, false);
    assert.match(r.falhas[0].razao, /inclusive com --accept/);
  });

  test('avisos são ratchet: subir reprova, manter passa', () => {
    const base = { coverage: {}, violations: { warnings: 5 } };
    assert.equal(avaliar({ coverage: {}, violations: { errors: 0, warnings: 6 }, ausentes: [] }, base, {}).ok, false);
    assert.equal(avaliar({ coverage: {}, violations: { errors: 0, warnings: 5 }, ausentes: [] }, base, {}).ok, true);
  });
});

describe('ratchet — relatório ausente', () => {
  test('ausência de medição NÃO é aprovação', () => {
    const r = avaliar({ coverage: {}, ausentes: ['cobertura de "api"'], ausente: true }, { coverage: {} }, {});
    assert.equal(r.ok, false);
    assert.match(r.falhas[0].razao, /não é aprovação/);
  });
});

describe('ratchet — ciclo completo em disco', () => {
  const arquivos = (pct, files, errs = 0, warns = 3) => ({
    'harness.config.json': CFG,
    'coverage/coverage-summary.json': cobertura(pct, files),
    'coverage/jscpd.json': jscpd(0.8),
    'coverage/eslint.json': eslint(errs, warns),
  });

  test('sem baseline: reprova e manda fazer bootstrap', () => {
    const out = run(repo(arquivos(80, 10)));
    assert.equal(out.ok, false);
    assert.match(out.falhas[0].razao, /--bootstrap/);
  });

  test('bootstrap cria o baseline; segunda vez recusa', () => {
    const dir = repo(arquivos(80, 10));
    const b1 = run(dir, { bootstrap: true });
    assert.equal(b1.ok, true);
    mkdirSync(dirname(b1.escrever.path), { recursive: true });
    writeFileSync(b1.escrever.path, JSON.stringify(b1.escrever.conteudo));
    assert.equal(existsSync(join(dir, '.quality/baseline.json')), true);
    assert.equal(run(dir, { bootstrap: true }).ok, false);
  });

  test('--accept com erro de lint é RECUSADO — run vermelho nunca grava baseline', () => {
    const dir = repo({ ...arquivos(80, 10, 2), '.quality/baseline.json': { coverage: {} } });
    const out = run(dir, { accept: true });
    assert.equal(out.ok, false);
    assert.match(out.falhas[0].razao, /RECUSADO/);
    assert.equal(out.escrever, undefined, 'não pode nem preparar a escrita');
  });

  test('--accept limpo grava o baseline com errors zerado', () => {
    const dir = repo({ ...arquivos(72, 8, 0, 4), '.quality/baseline.json': { coverage: { api: { lines: 80, files: 10 } } } });
    const out = run(dir, { accept: true });
    assert.equal(out.ok, true);
    assert.equal(out.escrever.conteudo.coverage.api.files, 8);
    assert.equal(out.escrever.conteudo.violations.errors, 0);
    assert.equal(out.escrever.conteudo.violations.warnings, 4);
  });

  test('avaliação verde de ponta a ponta', () => {
    const dir = repo({
      ...arquivos(85, 12),
      '.quality/baseline.json': {
        coverage: { api: { lines: 80, statements: 80, functions: 80, branches: 80, files: 10 } },
        violations: { errors: 0, warnings: 3 },
      },
    });
    const out = run(dir);
    assert.equal(out.ok, true, JSON.stringify(out.falhas));
  });
});

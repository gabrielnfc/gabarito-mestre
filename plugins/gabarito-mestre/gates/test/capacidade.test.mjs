/**
 * Testes do PAR-1 — capacidade.
 *
 * O paralelismo é medido, não presumido: `slots` cai quando a máquina está carregada e
 * NUNCA fica abaixo de 1; `GABARITO_PARALELISMO` sobe `simultaneos` mas não passa do `teto`;
 * a árvore do próprio Claude Code não conta como processo pesado.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte):
 *  M1  permitir slots < 1 (remover o piso `Math.max(1, …)`)
 *  M2  ignorar o teto (GABARITO_PARALELISMO=9 devolve 9)
 *  M3  contar a árvore de GABARITO_PID_RAIZ como pesada
 *  M4  calibrar sem clamp (64 cores → simultaneos 16, teto 32)
 *  M5  ler `%cpu` com vírgula como 0 (remover o replace(',', '.'))
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  medir, calcularSlots, calibrar, contarPesados, parseVmStat, parseMeminfo, lerParalelismo, DEFAULTS,
} from '../scripts/capacidade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '..', 'scripts', 'capacidade.mjs');

function repo(arquivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}
const cli = (args, cwd, env = {}) => {
  const limpo = { ...process.env };
  for (const k of Object.keys(limpo)) if (k.startsWith('GABARITO_')) delete limpo[k];
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...limpo, ...env } });
};

/** Máquina folgada: 8 cores, load baixo, memória e disco sobrando, nenhum pesado. */
const folgada = { cores: 8, load1: 1, memDisponivelMB: 8192, discoLivreGB: 50, pesados: 0, plataforma: 'test' };
const env = (extra = {}) => ({ ...extra });

describe('medir — injeção por env', () => {
  test('cada medida é substituída pela env correspondente', () => {
    const m = medir(
      { GABARITO_CAP_CORES: '12', GABARITO_CAP_LOAD1: '3.5', GABARITO_CAP_MEM_MB: '1024', GABARITO_CAP_DISCO_GB: '3', GABARITO_CAP_PESADOS: '2' },
      tmpdir(),
    );
    assert.deepEqual({ ...m, plataforma: undefined }, { cores: 12, load1: 3.5, memDisponivelMB: 1024, discoLivreGB: 3, pesados: 2, plataforma: undefined });
    assert.equal(typeof m.plataforma, 'string');
  });
  test('sem env, mede de verdade e devolve números (ou null onde a plataforma não expõe)', () => {
    const m = medir({}, tmpdir());
    assert.ok(Number.isInteger(m.cores) && m.cores >= 1);
    assert.ok(typeof m.load1 === 'number');
    for (const k of ['memDisponivelMB', 'discoLivreGB', 'pesados']) assert.ok(m[k] === null || Number.isFinite(m[k]), k);
  });
});

describe('calcularSlots — a regra que a spec pede', () => {
  test('máquina folgada: slots = simultaneos, motivo "simultaneos"', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, folgada, env());
    assert.equal(r.slots, 2);
    assert.equal(r.motivo, 'simultaneos');
    assert.equal(r.medidas, folgada);
  });
  test('load/core 2.0 com limite 1.5 → slots 1 e motivo cita load', () => {
    const r = calcularSlots({ simultaneos: 3, teto: 4 }, { ...folgada, load1: 16 }, env());
    assert.equal(r.slots, 1);
    assert.match(r.motivo, /load 2\.00\/core > 1\.5/);
  });
  test('memória e disco abaixo do mínimo → 1, motivo cita o que faltou', () => {
    assert.match(calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, memDisponivelMB: 1000 }, env()).motivo, /mem 1000 MB < 2048/);
    assert.match(calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, discoLivreGB: 2 }, env()).motivo, /disco 2 GB < 5/);
  });
  test('processos pesados reduzem a partir do teto: teto 4, 3 pesados → 1', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, pesados: 3 }, env());
    assert.equal(r.slots, 1);
    assert.match(r.motivo, /3 processo\(s\) pesado\(s\)/);
  });
  test('pesados que não restringem não mudam o motivo (teto 4, 1 pesado, simultaneos 2 → 2)', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, pesados: 1 }, env());
    assert.equal(r.slots, 2);
    assert.equal(r.motivo, 'simultaneos');
  });
  test('GABARITO_PARALELISMO=9 com teto 4 → slots ≤ 4 e motivo cita o override e o teto', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, folgada, env({ GABARITO_PARALELISMO: '9' }));
    assert.equal(r.slots, 4);
    assert.match(r.motivo, /GABARITO_PARALELISMO=9/);
    assert.match(r.motivo, /teto 4/);
  });
  test('GABARITO_PARALELISMO=3 dentro do teto vale 3', () => {
    assert.equal(calcularSlots({ simultaneos: 1, teto: 4 }, folgada, env({ GABARITO_PARALELISMO: '3' })).slots, 3);
  });
  test('nunca < 1: simultaneos 0, teto 0, pesados 99, load absurdo → 1', () => {
    assert.equal(calcularSlots({ simultaneos: 0, teto: 4 }, folgada, env()).slots, 1);
    assert.equal(calcularSlots({ simultaneos: 2, teto: 0 }, folgada, env()).slots, 1);
    assert.equal(calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, pesados: 99, load1: 999 }, env()).slots, 1);
    assert.equal(calcularSlots({ simultaneos: 2, teto: 4 }, folgada, env({ GABARITO_PARALELISMO: '0' })).slots, 1);
  });
  test('sem paralelismo (null): usa DEFAULTS 2/4 e limites default', () => {
    const r = calcularSlots(null, folgada, env());
    assert.equal(r.slots, DEFAULTS.simultaneos);
    assert.equal(calcularSlots(undefined, { ...folgada, memDisponivelMB: DEFAULTS.limites.memDisponivelMinMB - 1 }, env()).slots, 1);
  });
  test('limites parciais completam com defaults', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4, limites: { loadPorCoreMax: 5 } }, { ...folgada, load1: 16 }, env());
    assert.equal(r.slots, 2, 'load 2.0/core com limite 5 não restringe');
  });
  test('medidas null (plataforma sem leitura) não restringem', () => {
    const r = calcularSlots({ simultaneos: 2, teto: 4 }, { ...folgada, memDisponivelMB: null, discoLivreGB: null, pesados: null }, env());
    assert.equal(r.slots, 2);
  });
});

describe('contarPesados — exclui a árvore do Claude Code', () => {
  const ps = [
    '  PID  PPID  %CPU    RSS',
    '    1     0   0.1   9000',
    '  100     1   0.5  50000', // raiz do Claude (pai do hook)
    '  200   100  85.0 900000', // node do hook — filho da raiz: excluído
    '  300   200  95.0  10000', // neto: excluído
    '  400     1  45.0  10000', // suíte de outro terminal: pesado por CPU
    '  500     1   0.2 600000', // dev server: pesado por RSS (600 MB)
    '  600     1   2.0  30000', // leve
    '  700   400   0.0 512001', // pesado por RSS (> 500 MB), fora da árvore
  ].join('\n');
  test('conta 3 pesados fora da árvore de 100 e ignora 200/300', () => {
    assert.equal(contarPesados(ps, 100), 3);
  });
  test('raiz inexistente: nada é excluído → 5', () => {
    assert.equal(contarPesados(ps, 99999), 5);
  });
  test('%cpu com vírgula (locale pt-BR) é lido como decimal, não como 0', () => {
    const psBr = '  PID  PPID  %CPU    RSS\n  400     1  45,0  10000\n  600     1   2,0  30000\n';
    assert.equal(contarPesados(psBr, 99999), 1);
  });
  test('saída vazia ou lixo → 0', () => {
    assert.equal(contarPesados('', 1), 0);
    assert.equal(contarPesados('ps: erro\n', 1), 0);
  });
});

describe('parsers de memória', () => {
  test('vm_stat: (free + inactive + speculative) × page size, em MB', () => {
    const texto = [
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                                     5125.',
      'Pages active:                                 346179.',
      'Pages inactive:                               344461.',
      'Pages speculative:                               704.',
      'Pages wired down:                             179284.',
    ].join('\n');
    assert.equal(parseVmStat(texto), Math.round(((5125 + 344461 + 704) * 16384) / 1_048_576));
  });
  test('meminfo: MemAvailable em kB → MB', () => {
    assert.equal(parseMeminfo('MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    8388608 kB\n'), 8192);
  });
  test('texto sem os campos → 0 (e não NaN)', () => {
    assert.equal(parseVmStat('nada'), 0);
    assert.equal(parseMeminfo('nada'), 0);
  });
});

describe('calibrar — fórmula do contrato', () => {
  test('8 cores → 2/4; 2 cores → 1/2; 64 cores → 3/8; 1 core → 1/2', () => {
    assert.deepEqual([calibrar({ cores: 8 }).simultaneos, calibrar({ cores: 8 }).teto], [2, 4]);
    assert.deepEqual([calibrar({ cores: 2 }).simultaneos, calibrar({ cores: 2 }).teto], [1, 2]);
    assert.deepEqual([calibrar({ cores: 64 }).simultaneos, calibrar({ cores: 64 }).teto], [3, 8]);
    assert.deepEqual([calibrar({ cores: 1 }).simultaneos, calibrar({ cores: 1 }).teto], [1, 2]);
  });
  test('limites são os defaults e calibradoEm é a data injetada', () => {
    const c = calibrar({ cores: 8 }, new Date('2026-09-24T15:00:00Z'));
    assert.deepEqual(c.limites, { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 });
    assert.equal(c.calibradoEm, '2026-09-24');
  });
  test('F2-R10: calibradoEm usa data LOCAL da máquina, não UTC — instante que cruza o dia', () => {
    const tzAntigo = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    try {
      // 2026-09-24T23:30:00-03:00 == 2026-09-25T02:30:00Z: em UTC já seria "amanhã".
      const c = calibrar({ cores: 8 }, new Date('2026-09-24T23:30:00-03:00'));
      assert.equal(c.calibradoEm, '2026-09-24');
    } finally {
      if (tzAntigo === undefined) delete process.env.TZ; else process.env.TZ = tzAntigo;
    }
  });
});

describe('lerParalelismo — config ausente/vazia/inválida/sem seção', () => {
  test('ausente → defaults com aviso "orquestracao ausente"', () => {
    const r = lerParalelismo(repo());
    assert.equal(r.paralelismo, null);
    assert.match(r.aviso, /defaults \(orquestracao ausente/);
  });
  test('vazia (0 bytes) → defaults com aviso', () => {
    assert.match(lerParalelismo(repo({ 'harness.config.json': '' })).aviso, /orquestracao ausente/);
  });
  test('inválida → defaults, aviso cita fail-open declarado (G9)', () => {
    const r = lerParalelismo(repo({ 'harness.config.json': '{"orquestracao": ' }));
    assert.equal(r.paralelismo, null);
    assert.match(r.aviso, /fail-open declarado \(G9\)/);
  });
  test('com seção → devolve o objeto e sem aviso', () => {
    const r = lerParalelismo(repo({ 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: { simultaneos: 3, teto: 6 } } }) }));
    assert.deepEqual(r.paralelismo, { simultaneos: 3, teto: 6 });
    assert.equal(r.aviso, null);
  });
});

describe('CLI — sempre exit 0', () => {
  const medidasEnv = { GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '1', GABARITO_CAP_MEM_MB: '8192', GABARITO_CAP_DISCO_GB: '50', GABARITO_CAP_PESADOS: '0' };
  test('--json com config: { slots, motivo, medidas } e exit 0', () => {
    const dir = repo({ 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: { simultaneos: 3, teto: 4 } } }) });
    const r = cli(['--root', dir, '--json'], dir, medidasEnv);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.slots, 3);
    assert.equal(j.motivo, 'simultaneos');
    assert.equal(j.medidas.cores, 8);
    assert.equal(r.stderr, '');
  });
  test('sem config: defaults, aviso em stderr, exit 0, sem stack trace', () => {
    const dir = repo();
    const r = cli(['--root', dir], dir, medidasEnv);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^slots: 2 \(simultaneos\)/);
    assert.match(r.stderr, /defaults \(orquestracao ausente/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });
  test('config inválida: fail-open declarado, exit 0', () => {
    const dir = repo({ 'harness.config.json': '{' });
    const r = cli(['--root', dir], dir, medidasEnv);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open declarado \(G9\)/);
    assert.match(r.stdout, /^slots: 2/);
  });
  test('GABARITO_PARALELISMO=9 no CLI respeita o teto', () => {
    const dir = repo({ 'harness.config.json': JSON.stringify({ orquestracao: { paralelismo: { simultaneos: 2, teto: 4 } } }) });
    const j = JSON.parse(cli(['--root', dir, '--json'], dir, { ...medidasEnv, GABARITO_PARALELISMO: '9' }).stdout);
    assert.equal(j.slots, 4);
  });
  test('--calibrar imprime JSON com a fórmula', () => {
    const r = cli(['--calibrar'], tmpdir(), { GABARITO_CAP_CORES: '8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.simultaneos, 2);
    assert.equal(j.teto, 4);
    assert.match(j.calibradoEm, /^\d{4}-\d{2}-\d{2}$/);
  });
  test('fixture solta sem .git e sem --root: usa o cwd e não quebra', () => {
    const dir = repo();
    const r = cli([], dir, medidasEnv);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^slots: \d+/);
  });
});

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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  medir, calcularSlots, calibrar, contarPesados, parseVmStat, parseMeminfo, lerParalelismo, DEFAULTS,
  MARGEM_QUEDA, lerCapacidade, slotsMedidos, escada, gravarAtomico, rodarSlots, calibrarCapacidade,
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
  test('--sugerir imprime JSON com a fórmula (era --calibrar antes da T11)', () => {
    const r = cli(['--sugerir'], tmpdir(), { GABARITO_CAP_CORES: '8' });
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

// ───────────────────────────────────────────────────── T11 · REQ-SLOT-1 · capacidade medida

/** Suítes falsas: nunca rodam a suíte real. `limite.mjs <compartilhado> <K> <ms> <modo>` conta quantos slots vivem juntos. */
const FAKE = `
import { mkdirSync, rmSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const [, , comp, K, ms, modo, registro] = process.argv;
const k = Number(K); const base = Number(ms);
mkdirSync(comp, { recursive: true });
const eu = join(comp, String(process.pid));
mkdirSync(eu);
writeFileSync(join(process.env.TMPDIR, 'sobra.bin'), Buffer.alloc(300_000, 1));
const lixo = Buffer.alloc(30_000_000, 1);
if (registro) appendFileSync(registro, process.env.TMPDIR + '\\n');
await new Promise((r) => setTimeout(r, base / 2));
const vivos = readdirSync(comp).length;
const estouro = vivos > k;
await new Promise((r) => setTimeout(r, estouro && modo === 'lento' ? base * 2 : base / 2));
rmSync(eu, { recursive: true });
if (lixo.length === 0) process.exit(9);
process.exit(estouro && modo === 'falha' ? 1 : 0);
`;
const fake = (dir, { k, ms = 700, modo = 'falha', registro = '' }) => {
  const f = join(dir, 'limite.mjs');
  writeFileSync(f, FAKE);
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(f)} ${JSON.stringify(join(dir, 'vivos'))} ${k} ${ms} ${modo} ${registro ? JSON.stringify(registro) : ''}`;
};
const filhoDe = (...a) => mkdtempSync(join(tmpdir(), a.join('') || 'cap11-'));
const bom = { slots_max: 3, rss_pico_mb: 1000, tmpdir_mb: 100, cpu_total: 6, load_medido: 12, hostname: 'maq-a' };
const medidasOk = { cores: 16, load1: 0, memDisponivelMB: 20000, discoLivreGB: 200, pesados: 0, plataforma: 'test' };
const comArquivo = (conteudo) => {
  const dir = repo();
  mkdirSync(join(dir, '.harness'));
  writeFileSync(join(dir, '.harness', 'capacidade.json'), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return dir;
};

describe('T11 escada — para na 1ª falha ou na 1ª queda de vazão', () => {
  test('load_medido 0 no degrau: medição inválida, para antes dele (nunca vira medida)', async () => {
    const r = await escada(async (n) => ({ ok: true, vazao: n * 2, rss_pico_mb: 100, tmpdir_mb: 10, cpu_total: 3, load_medido: n === 2 ? 0 : 5 }), { maxN: 4 });
    assert.equal(r.slots_max, 1);
    assert.match(r.parou, /load_medido/);
  });
  const ponto = (n, extra = {}) => ({ ok: true, vazao: n * 2, rss_pico_mb: 100 + n, tmpdir_mb: 10 + n, cpu_total: n + 0.5, load_medido: n + 4, ...extra });
  test('calibra-para-na-falha: falha em N=3 → slots_max 2, medidas do N=2, não sobe', async () => {
    const vistos = [];
    const r = await escada(async (n) => { vistos.push(n); return n === 3 ? { ok: false, causa: 'suíte falhou' } : ponto(n); }, { maxN: 8 });
    assert.deepEqual(vistos, [1, 2, 3]);
    assert.equal(r.slots_max, 2);
    assert.equal(r.rss_pico_mb, 102);
    assert.equal(r.tmpdir_mb, 12);
    assert.equal(r.cpu_total, 2.5);
    assert.equal(r.load_medido, 6, 'carga do degrau que passou, não a do que falhou');
    assert.equal(r.erro, null);
    assert.match(r.parou, /^falha — N=3: suíte falhou/);
  });
  test('calibra-para-na-queda: vazão cai em N=4 → slots_max 3 e não roda N=5', async () => {
    const vistos = [];
    const vaz = { 1: 4, 2: 6.2, 3: 7.9, 4: 6.8, 5: 9 };
    const r = await escada(async (n) => { vistos.push(n); return ponto(n, { vazao: vaz[n] }); }, { maxN: 8 });
    assert.deepEqual(vistos, [1, 2, 3, 4]);
    assert.equal(r.slots_max, 3);
  });
  test('vazão igual não é queda: sobe até maxN', async () => {
    const r = await escada(async (n) => ponto(n, { vazao: 5 }), { maxN: 5 });
    assert.equal(r.slots_max, 5);
  });
  test('margem: ruído dentro de MARGEM_QUEDA continua; um pouco além para (S10: 7,9→6,8 = −13,9 %)', async () => {
    assert.ok(MARGEM_QUEDA > 0.022 && MARGEM_QUEDA < 0.139, `margem ${MARGEM_QUEDA} fora da faixa medida (ruído 2,2 % < margem < queda 13,9 %)`);
    const dentro = await escada(async (n) => ponto(n, { vazao: n === 1 ? 10 : 10 * (1 - MARGEM_QUEDA * 0.9) }), { maxN: 2 });
    assert.equal(dentro.slots_max, 2);
    const fora = await escada(async (n) => ponto(n, { vazao: n === 1 ? 10 : 10 * (1 - MARGEM_QUEDA * 1.1) }), { maxN: 2 });
    assert.equal(fora.slots_max, 1);
  });
  test('falha em N=1: sem slots_max, com erro', async () => {
    const r = await escada(async () => ({ ok: false, causa: 'quebrou' }), { maxN: 8 });
    assert.equal(r.slots_max, 0);
    assert.match(r.erro, /N=1: quebrou/);
  });
  test('vazão exatamente igual não é queda nem com margem 0', async () => {
    const r = await escada(async (n) => ponto(n, { vazao: 5 }), { maxN: 4, margem: 0 });
    assert.equal(r.slots_max, 4);
  });
  for (const [nome, defeito] of [['rss 0', { rss_pico_mb: 0 }], ['tmpdir ausente', { tmpdir_mb: undefined }], ['cpu NaN', { cpu_total: NaN }], ['vazão 0', { vazao: 0 }]]) {
    test(`medição inválida (${nome}) em N=1 não vira capacidade: slots_max 0 e erro`, async () => {
      const r = await escada(async (n) => ponto(n, defeito), { maxN: 4 });
      assert.equal(r.slots_max, 0);
      assert.match(r.erro, /medição/);
    });
  }
  test('medição inválida em N=2 para em 1 (nunca assume o N inválido)', async () => {
    const r = await escada(async (n) => (n === 2 ? ponto(n, { rss_pico_mb: 0 }) : ponto(n)), { maxN: 4 });
    assert.equal(r.slots_max, 1);
  });
  test('medirN que lança vira erro, nunca sucesso', async () => {
    const r = await escada(async () => { throw new Error('ps sumiu'); }, { maxN: 4 });
    assert.equal(r.slots_max, 0);
    assert.match(r.erro, /ps sumiu/);
  });
});

describe('T11 runtime — lerCapacidade e slotsMedidos', () => {
  test('sem-arquivo-1-slot-aviso', () => {
    const dir = repo();
    const l = lerCapacidade(dir, 'maq-a');
    assert.equal(l.dados, null);
    assert.match(l.aviso, /sem calibração|não existe/);
    const r = slotsMedidos(l, medidasOk);
    assert.equal(r.slots, 1);
    assert.match(r.aviso, /--calibrar/);
  });
  test('outro-hostname-1-slot', () => {
    const l = lerCapacidade(comArquivo(bom), 'maq-b');
    assert.equal(l.dados, null);
    assert.match(l.aviso, /maq-a/);
    assert.match(l.aviso, /maq-b/);
    assert.equal(slotsMedidos(l, medidasOk).slots, 1);
  });
  test('JSON corrompido: 1 slot, aviso com a causa', () => {
    const l = lerCapacidade(comArquivo('{"slots_max": 3,'), 'maq-a');
    assert.equal(l.dados, null);
    assert.match(l.aviso, /JSON/);
    const r = slotsMedidos(l, medidasOk);
    assert.equal(r.slots, 1);
    assert.ok(r.aviso);
  });
  for (const [campo, valor] of [
    ['slots_max', 0], ['slots_max', -2], ['slots_max', 2.5], ['slots_max', '3'], ['slots_max', undefined],
    ['rss_pico_mb', 0], ['rss_pico_mb', undefined], ['rss_pico_mb', -1], ['rss_pico_mb', 'x'],
    ['tmpdir_mb', 0], ['tmpdir_mb', undefined], ['tmpdir_mb', null],
    ['cpu_total', 0], ['cpu_total', undefined], ['cpu_total', null], ['cpu_total', -1], ['cpu_total', 1e999],
    ['load_medido', 0], ['load_medido', undefined], ['load_medido', null], ['load_medido', -1], ['load_medido', 1e999],
    ['hostname', ''], ['hostname', undefined],
  ]) {
    test(`campo inválido (${campo} = ${String(valor)}): 1 slot, aviso cita o campo — zero/ausente não é infinito`, () => {
      const obj = { ...bom, [campo]: valor };
      const l = lerCapacidade(comArquivo(JSON.stringify(obj)), 'maq-a');
      assert.equal(l.dados, null, 'dado inválido não vira dado');
      assert.match(l.aviso, new RegExp(campo));
      assert.equal(slotsMedidos(l, medidasOk).slots, 1);
    });
  }
  test('cores 0 ou medida negativa é medição falhando: 1 slot com aviso', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 5 }), 'maq-a');
    for (const [k, v] of [['cores', 0], ['load1', -1], ['memDisponivelMB', -5], ['discoLivreGB', -1]]) {
      const r = slotsMedidos(l, { ...medidasOk, [k]: v });
      assert.equal(r.slots, 1, k);
      assert.match(r.aviso, new RegExp(k));
    }
  });
  test('JSON que não é objeto (array, null, número) → 1 slot, aviso', () => {
    for (const c of ['[]', 'null', '7']) {
      const l = lerCapacidade(comArquivo(c), 'maq-a');
      assert.equal(l.dados, null, c);
      assert.ok(l.aviso, c);
    }
  });
  test('calibrado e folgado: slots = slots_max, sem aviso', () => {
    const l = lerCapacidade(comArquivo(bom), 'maq-a');
    assert.equal(l.aviso, null);
    const r = slotsMedidos(l, medidasOk);
    assert.equal(r.slots, 3);
    assert.equal(r.aviso, null);
    assert.match(r.motivo, /slots_max/);
  });
  test('memoria-reduz: floor((mem − reserva)/rss) manda; reserva vem do config, default declarado', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 6 }), 'maq-a');
    // default 2048 de reserva: (4200 − 2048)/1000 = 2,15 → 2
    const r = slotsMedidos(l, { ...medidasOk, memDisponivelMB: 4200 });
    assert.equal(r.slots, 2);
    assert.match(r.motivo, /mem/);
    // reserva do config: (4200 − 500)/1000 = 3,7 → 3
    assert.equal(slotsMedidos(l, { ...medidasOk, memDisponivelMB: 4200 }, { memDisponivelMinMB: 500 }).slots, 3);
  });
  test('disco-reduz: floor((disco − reserva)/tmpdir)', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 6, tmpdir_mb: 1000 }), 'maq-a');
    // default 5 GB: (7 GB − 5 GB)=2048 MB / 1000 = 2
    const r = slotsMedidos(l, { ...medidasOk, discoLivreGB: 7 });
    assert.equal(r.slots, 2);
    assert.match(r.motivo, /disco/);
  });
  test('carga-reduz: só acima da carga medida, proporcional; igual não toca; núcleos não entram', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 4, cpu_total: 15.79, load_medido: 12 }), 'maq-a');
    assert.equal(slotsMedidos(l, { ...medidasOk, load1: 0 }).slots, 4);
    assert.equal(slotsMedidos(l, { ...medidasOk, load1: 12 }).slots, 4, 'igual à medida: sem redução');
    assert.equal(slotsMedidos(l, { ...medidasOk, load1: 12.01 }).slots, 3, 'acima: despacho novo espera');
    assert.equal(slotsMedidos(l, { ...medidasOk, load1: 24 }).slots, 2, 'dobro → metade');
    const r = slotsMedidos(l, { ...medidasOk, load1: 96 });
    assert.equal(r.slots, 1);
    assert.match(r.motivo, /carga/);
    assert.equal(slotsMedidos(l, { ...medidasOk, cores: 2, load1: 12 }).slots, 4, 'menos núcleos não muda: a grandeza é load1 × load1');
  });
  test('carga da medição sem slot rodando não reduz (cpu_total alto não entra na conta, achado 1)', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 2, cpu_total: 14.14, load_medido: 9 }), 'maq-a');
    assert.equal(slotsMedidos(l, { ...medidasOk, load1: 6 }).slots, 2);
  });
  test('slots próprios já estão na medida: load1 igual ao do degrau com slots_max vivos mantém slots_max', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 3, load_medido: 25 }), 'maq-a');
    assert.equal(slotsMedidos(l, { ...medidasOk, load1: 25 }).slots, 3);
  });
  test('arquivo sem load_medido (calibração antiga): 1 slot e aviso para recalibrar', () => {
    const { load_medido: _, ...antigo } = bom;
    const l = lerCapacidade(comArquivo(antigo), 'maq-a');
    const r = slotsMedidos(l, medidasOk);
    assert.equal(r.slots, 1);
    assert.match(r.aviso, /load_medido.*--calibrar/);
  });
  test('nunca-menos-que-1: tudo estourado → 1', () => {
    const l = lerCapacidade(comArquivo(bom), 'maq-a');
    const r = slotsMedidos(l, { cores: 4, load1: 99, memDisponivelMB: 10, discoLivreGB: 0, pesados: 0 });
    assert.equal(r.slots, 1);
  });
  test('slots nunca passa de slots_max, mesmo com muita folga', () => {
    const l = lerCapacidade(comArquivo({ ...bom, slots_max: 2 }), 'maq-a');
    assert.equal(slotsMedidos(l, { ...medidasOk, memDisponivelMB: 1e9, discoLivreGB: 1e9, cores: 1024 }).slots, 2);
  });
  for (const falta of ['memDisponivelMB', 'discoLivreGB', 'load1', 'cores']) {
    for (const v of [null, undefined, NaN]) {
      test(`medição de ${falta} falhando (${String(v)}): 1 slot com aviso, nunca slots_max`, () => {
        const l = lerCapacidade(comArquivo({ ...bom, slots_max: 5 }), 'maq-a');
        const r = slotsMedidos(l, { ...medidasOk, [falta]: v });
        assert.equal(r.slots, 1);
        assert.match(r.aviso, new RegExp(falta));
      });
    }
  }
  test('sem-numero-fixo: a saída acompanha os números do arquivo e da máquina (modelo independente)', () => {
    for (const [slots_max, rss, tmp, cpu, cores, load, mem, disco, lm] of [
      [9, 700, 40, 3, 8, 1, 9000, 60, 20], [5, 2500, 300, 12, 32, 10, 30000, 20, 4], [7, 300, 10, 2, 4, 0, 5000, 500, 3], [3, 123, 77, 5, 10, 7, 4000, 9, 5],
    ]) {
      const l = lerCapacidade(comArquivo({ hostname: 'maq-a', slots_max, rss_pico_mb: rss, tmpdir_mb: tmp, cpu_total: cpu, load_medido: lm }), 'maq-a');
      const m = { cores, load1: load, memDisponivelMB: mem, discoLivreGB: disco, pesados: 0 };
      const porCarga = load > lm ? Math.floor((slots_max * lm) / load) : slots_max;
      const esperado = Math.max(1, Math.min(slots_max, Math.floor((mem - DEFAULTS.limites.memDisponivelMinMB) / rss), Math.floor((disco * 1024 - DEFAULTS.limites.discoLivreMinGB * 1024) / tmp), porCarga));
      assert.equal(slotsMedidos(l, m).slots, esperado, JSON.stringify({ slots_max, rss, tmp, cpu, cores, load, mem, disco }));
    }
    const fonte = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(fonte, /\b(1650|1636|1551|1373|16384|49152|7\.9)\b/, 'número do MacBook em constante');
  });
});

describe('T11 gravação atômica', () => {
  test('grava por temporário + rename: sem sobra, conteúdo íntegro, arquivo anterior substituído inteiro', () => {
    const dir = comArquivo(bom);
    const alvo = join(dir, '.harness', 'capacidade.json');
    const inoAntes = statSync(alvo).ino;
    gravarAtomico(alvo, { ...bom, slots_max: 4 });
    assert.notEqual(statSync(alvo).ino, inoAntes, 'rename troca o arquivo inteiro; escrever por cima mantém o inode e deixa meio-gravado se morrer');
    assert.equal(JSON.parse(readFileSync(alvo, 'utf8')).slots_max, 4);
    assert.deepEqual(readdirSync(join(dir, '.harness')), ['capacidade.json']);
  });
  test('falha ao gravar: lança, anterior intacto, sem temporário', () => {
    const dir = comArquivo(bom);
    const alvo = join(dir, '.harness', 'capacidade.json');
    const antes = readFileSync(alvo, 'utf8');
    const biga = { toJSON() { throw new Error('boom'); } };
    assert.throws(() => gravarAtomico(alvo, biga), /boom/);
    assert.equal(readFileSync(alvo, 'utf8'), antes);
    assert.deepEqual(readdirSync(join(dir, '.harness')), ['capacidade.json']);
  });
});

describe('T11 rodarSlots e calibrarCapacidade — suíte fake, processos reais', () => {
  test('TMPDIR próprio por slot, removido ao fim: 0 bytes sobrando; mede rss, tmpdir e cpu > 0', async () => {
    const base = filhoDe('base-');
    const aux = filhoDe('aux-');
    const registro = join(aux, 'tmpdirs.txt');
    const r = await rodarSlots(3, { suite: fake(aux, { k: 9, ms: 700, registro }), cwd: aux, base });
    assert.equal(r.falhas, 0);
    const dirs = readFileSync(registro, 'utf8').trim().split('\n');
    assert.equal(new Set(dirs).size, 3, 'cada slot com seu TMPDIR');
    for (const d of dirs) assert.equal(dirs.filter((x) => x === d).length, 1);
    assert.deepEqual(readdirSync(base), [], '0 bytes sobrando');
    assert.ok(r.rss_pico_mb > 0, `rss ${r.rss_pico_mb}`);
    assert.ok(r.tmpdir_mb > 0, `tmpdir ${r.tmpdir_mb}`);
    assert.ok(r.cpu_total > 0, `cpu ${r.cpu_total}`);
    assert.ok(r.load_medido >= 0);
    assert.ok(r.vazao > 0);
    assert.equal(r.vazao, (3 * 60_000) / r.mediana_ms, 'vazão = N slots por mediana da parede do slot, em slots/min');
  });
  test('load_medido é a mediana das amostras do degrau: pico isolado não vira medida', async () => {
    const base = filhoDe('base-');
    const aux = filhoDe('aux-');
    let i = 0;
    const r = await rodarSlots(1, { suite: fake(aux, { k: 9, ms: 700 }), cwd: aux, base, lerLoad: () => (i++ === 0 ? 100 : 5) });
    assert.equal(r.load_medido, 5);
  });
  test('slot que falha é contado; TMPDIR ainda removido', async () => {
    const base = filhoDe('base-');
    const aux = filhoDe('aux-');
    const r = await rodarSlots(3, { suite: fake(aux, { k: 1, ms: 600, modo: 'falha' }), cwd: aux, base });
    assert.equal(r.falhas, 3);
    assert.deepEqual(readdirSync(base), []);
  });
  test('e2e calibra-para-na-falha: suíte falha com 3 vivos → slots_max 2, arquivo gravado com hostname e medidas', async () => {
    const root = repo();
    const aux = filhoDe('aux-');
    const base = filhoDe('base-');
    const r = await calibrarCapacidade(root, { suite: fake(aux, { k: 2, ms: 600, modo: 'falha' }), cwd: aux, hostname: 'maq-z', maxN: 5, base, lerLoad: () => 7 });
    assert.equal(r.rc, 0, r.causa);
    const g = JSON.parse(readFileSync(join(root, '.harness', 'capacidade.json'), 'utf8'));
    assert.equal(g.slots_max, 2);
    assert.equal(g.hostname, 'maq-z');
    assert.equal(g.load_medido, 7, 'lerLoad injetado por parâmetro chega ao arquivo');
    for (const k of ['rss_pico_mb', 'tmpdir_mb', 'cpu_total', 'load_medido']) assert.ok(g[k] > 0, k);
    assert.deepEqual(readdirSync(base), []);
    assert.deepEqual(readdirSync(join(root, '.harness')), ['capacidade.json']);
  });
  test('e2e calibra-para-na-queda: sem falha, mas N=3 demora 3× → slots_max 2', async () => {
    const root = repo();
    const aux = filhoDe('aux-');
    const r = await calibrarCapacidade(root, { suite: fake(aux, { k: 2, ms: 600, modo: 'lento' }), cwd: aux, hostname: 'maq-z', maxN: 5, base: filhoDe('base-'), lerLoad: () => 7 });
    assert.equal(r.rc, 0, r.causa);
    assert.equal(JSON.parse(readFileSync(join(root, '.harness', 'capacidade.json'), 'utf8')).slots_max, 2);
  });
  test('suite-falha-em-N1: rc 1, arquivo anterior byte a byte intacto, sem slots_max alto', async () => {
    const root = comArquivo({ ...bom, slots_max: 7 });
    const antes = readFileSync(join(root, '.harness', 'capacidade.json'), 'utf8');
    const aux = filhoDe('aux-');
    const base = filhoDe('base-');
    const r = await calibrarCapacidade(root, { suite: fake(aux, { k: 0, ms: 600, modo: 'falha' }), cwd: aux, hostname: 'maq-a', maxN: 5, base });
    assert.equal(r.rc, 1);
    assert.match(r.causa, /N=1/);
    assert.equal(readFileSync(join(root, '.harness', 'capacidade.json'), 'utf8'), antes);
    assert.deepEqual(readdirSync(join(root, '.harness')), ['capacidade.json']);
    assert.deepEqual(readdirSync(base), []);
  });
  test('loadavg sempre 0 (plataforma sem load): rc 1, nada gravado, causa cita load_medido', async () => {
    const root = repo();
    const aux = filhoDe('aux-');
    const r = await calibrarCapacidade(root, { suite: fake(aux, { k: 9, ms: 600 }), cwd: aux, hostname: 'maq-a', maxN: 3, base: filhoDe('base-'), lerLoad: () => 0 });
    assert.equal(r.rc, 1);
    assert.match(r.causa, /load_medido/);
    assert.equal(existsSync(join(root, '.harness', 'capacidade.json')), false);
  });
  test('suíte inexistente (ferramenta falhando): rc 1, nada gravado', async () => {
    const root = repo();
    const r = await calibrarCapacidade(root, { suite: 'comando-que-nao-existe-t11', cwd: root, hostname: 'maq-a', maxN: 3, base: filhoDe('base-') });
    assert.equal(r.rc, 1);
    assert.equal(existsSync(join(root, '.harness', 'capacidade.json')), false);
  });
  test('calibração interrompida (SIGTERM no meio): anterior intacto, sem temporário, TMPDIR limpo', async () => {
    const root = comArquivo({ ...bom, slots_max: 7 });
    const antes = readFileSync(join(root, '.harness', 'capacidade.json'), 'utf8');
    const aux = filhoDe('aux-');
    const base = filhoDe('base-');
    const suite = fake(aux, { k: 9, ms: 4000, modo: 'falha' });
    const filho = spawn(process.execPath, [SCRIPT, '--calibrar', '--root', root, '--suite', suite, '--cwd', aux], { env: { ...process.env, GABARITO_CAP_HOSTNAME: 'maq-a', GABARITO_CAL_TMP: base }, stdio: 'ignore' });
    const fim = new Promise((res) => filho.on('close', (code, sig) => res({ code, sig })));
    await new Promise((r) => setTimeout(r, 1500));
    filho.kill('SIGTERM');
    const { code, sig } = await fim;
    assert.ok(code !== 0 || sig, 'não pode sair 0 interrompido');
    assert.equal(readFileSync(join(root, '.harness', 'capacidade.json'), 'utf8'), antes);
    assert.deepEqual(readdirSync(join(root, '.harness')), ['capacidade.json']);
    assert.deepEqual(readdirSync(base), [], 'TMPDIR dos slots removido');
  });
  test('CLI e2e: calibrar sai do aviso; --medido lê o arquivo calibrado (load injetado por parâmetro, não pela máquina)', async () => {
    const root = repo();
    const aux = filhoDe('aux-');
    const base = filhoDe('base-');
    const env2 = { GABARITO_CAP_HOSTNAME: 'maq-cli', GABARITO_CAL_TMP: base, GABARITO_CAP_CORES: '4096', GABARITO_CAP_LOAD1: '0', GABARITO_CAP_MEM_MB: '90000', GABARITO_CAP_DISCO_GB: '900', GABARITO_CAP_PESADOS: '0' };
    const antes = cli(['--medido', '--root', root], root, env2);
    assert.equal(antes.status, 0);
    assert.match(antes.stdout, /^slots: 1/);
    assert.match(antes.stderr, /--calibrar/);
    const cal = await calibrarCapacidade(root, { suite: fake(aux, { k: 2, ms: 600 }), cwd: aux, hostname: 'maq-cli', maxN: 5, base, lerLoad: () => 7 });
    assert.equal(cal.rc, 0, cal.causa);
    const depois = cli(['--medido', '--json', '--root', root], root, env2);
    assert.equal(depois.status, 0, depois.stderr);
    assert.equal(depois.stderr, '');
    const j = JSON.parse(depois.stdout);
    assert.equal(j.slots, 2);
    assert.equal(j.aviso, null);
  });
  test('CLI: --calibrar com suíte quebrada sai 1 e não grava', () => {
    const root = repo();
    const r = cli(['--calibrar', '--root', root, '--suite', 'exit 3'], root, { GABARITO_CAP_HOSTNAME: 'm', GABARITO_CAL_TMP: filhoDe('base-') });
    assert.equal(r.status, 1);
    assert.equal(existsSync(join(root, '.harness', 'capacidade.json')), false);
  });
});

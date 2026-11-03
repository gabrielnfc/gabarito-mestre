/**
 * Diário mínimo (REQ-DIA-1) — gates/src/diario.ts.
 *
 * Contrato de arquivo assumido por estes testes (spec E1, REQ-DIA-1):
 *  - `append(dir, sessao, ev)` grava em `<dir>/events.<sessao>.jsonl`;
 *  - o lock é `<dir>/events.<sessao>.jsonl.lock` (criado com `wx`); lock com mtime > 2 s é quebrado;
 *  - `hash_anterior` = sha256 (hex) do texto da linha anterior, sem o `\n`.
 * Os valores "secretos" abaixo são sintéticos e montados por concatenação.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  remover o canário ⇒ `diario-recusa-segredo` falha
 *  M2  recusa silenciosa (não gravar `diario.recusa`) ⇒ `diario-recusa-grava-evento` falha
 *  M3  quebrar a cadeia (hash_anterior fixo) ⇒ `diario-cadeia` e `diario-concorrente` falham
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, chmodSync, readdirSync, symlinkSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { append, ler, projetar, recusaCanario, dirEntrega } from '../src/diario.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIARIO_TS = join(AQUI, '..', 'src', 'diario.ts');

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const tmp = (): string => mkdtempSync(join(tmpdir(), 'gm-diario-'));
const ev = (tipo: TipoEvento = 'guarda.deny', dados: Record<string, unknown> = {}): Omit<Evento, 'seq' | 'hash_anterior'> => ({
  ts: '2026-11-02T12:00:00.000Z',
  autor: 'dev@exemplo.com',
  sessao: 's1',
  agente: 'orquestrador',
  tipo,
  dados,
});
const linhas = (arquivo: string): string[] => readFileSync(arquivo, 'utf8').split('\n').filter((l) => l !== '');

// Um valor sintético por alternativa do canário (REQ-DIA-1).
const SEGREDOS: Record<string, string> = {
  'ghp': 'ghp_' + 'A'.repeat(24),
  'gho': 'gho_' + 'B'.repeat(24),
  'gh[sur]': 'ghs_' + 'G'.repeat(36),
  'github_pat': 'github_' + 'pat_' + 'H'.repeat(22) + '_' + 'I'.repeat(59),
  'AKIA': 'AKIA' + 'ABCDEFGHIJKL',
  'ASIA': 'ASIA' + 'ABCDEFGHIJKL',
  'BEGIN': '-----' + 'BEGIN PRIVATE KEY-----',
  'sk-prefixado': 'sk-' + 'ant-' + 'api03-' + 'J'.repeat(93) + 'AA',
  'sk': 'sk-' + 'c'.repeat(20),
  'xox': 'xoxb-' + '1234567890',
  'url-credencial': 'postgres://u:' + 's3nh4@db.exemplo.com/x',
  'Bearer': 'Bearer ' + 'd'.repeat(20),
  'jwt': 'eyJ' + 'e'.repeat(20) + '.eyJ' + 'f'.repeat(20),
};

describe('canário', () => {
  test('canario-nao-recusa-task: task-list, risk-matrix e prod-disk-01 passam', () => {
    // `risk-abcdefghijklmnopqrst.ts` contém `sk-` + 16 ou mais caracteres, sem borda de palavra antes do `sk`.
    for (const texto of ['docs/task-list.md', 'risk-matrix.ts', 'prod-disk-01', 'risk-abcdefghijklmnopqrst.ts']) {
      assert.equal(recusaCanario(JSON.stringify({ dados: { alvo: texto } })), null, texto);
      assert.equal(recusaCanario(texto), null, texto);
    }
  });

  test('diario-recusa-segredo: 13 padrões, um valor por alternativa ⇒ recusa com o nome do padrão', () => {
    assert.equal(Object.keys(SEGREDOS).length, 13);
    for (const [nome, valor] of Object.entries(SEGREDOS)) {
      assert.equal(recusaCanario(JSON.stringify({ dados: { alvo: valor } })), nome, `padrão ${nome}`);
    }
  });

  test('canario-quatro-formatos: sk-ant, sk-proj, github_pat, ghs/ghu/ghr, inclusive truncados a 55 caracteres', () => {
    const formatos: Record<string, string> = {
      'sk-ant-api03': 'sk-' + 'ant-api03-' + 'K'.repeat(93) + 'AA',
      'sk-ant-admin01': 'sk-' + 'ant-admin01-' + 'K'.repeat(93) + 'AA',
      'sk-proj': 'sk-' + 'proj-' + 'L_-'.repeat(30),
      'sk-svcacct': 'sk-' + 'svcacct-' + 'M'.repeat(58),
      'github_pat': 'github_' + 'pat_' + 'N'.repeat(22) + '_' + 'O'.repeat(59),
      'ghs': 'ghs_' + 'P'.repeat(36),
      'ghu': 'ghu_' + 'Q'.repeat(36),
      'ghr': 'ghr_' + 'R'.repeat(36),
    };
    for (const [nome, valor] of Object.entries(formatos)) {
      assert.notEqual(recusaCanario(valor), null, nome);
      assert.notEqual(recusaCanario(valor.slice(0, 55)), null, `${nome} truncado a 55`);
      assert.notEqual(recusaCanario(`x ${valor} y`), null, `${nome} no meio do texto`);
    }
  });

  test('canario-nao-recusa-novos: nomes e docs plausíveis dos três padrões novos passam', () => {
    for (const texto of [
      'docs/github_pat_rotation_runbook_2026.md',
      'github_pat_ tokens têm prefixo próprio',
      'highs_abcdefghijklmnopqrstuvwxyz',
      'laughs_ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'docs/ghs_runbook.md',
      'sk-ant-api03-',
      'usa sk-ant-api03-xxxx no .env',
      'the task-sk-ant-ipode',
      'risk-proj-' + 'abcdefghijklmnopqrstuvwxyzabcdefghij',
    ]) {
      assert.equal(recusaCanario(texto), null, texto);
      assert.equal(recusaCanario(JSON.stringify({ dados: { alvo: texto } })), null, texto);
    }
  });

  test('canario-linha-16kb-adversarial: 16 KB de quase-casamentos termina rápido e não recusa', () => {
    const entradas = ['sk-proj-' + 'a'.repeat(31) + ' ', 'github_pat_' + 'a'.repeat(39) + ' ', 'ghs_' + 'a'.repeat(19) + ' ', 'sk-', 's', 'g', '_', '-'];
    for (const u of entradas) {
      const linha = u.repeat(Math.ceil(16384 / u.length)).slice(0, 16384);
      const t0 = process.hrtime.bigint();
      const r = recusaCanario(linha);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.equal(r, null, u.slice(0, 20));
      assert.ok(ms < 60, `${u.slice(0, 20)}: ${ms} ms`);
    }
  });
});

describe('append', () => {
  test('diario-recusa-nao-silenciosa: cada formato novo grava diario.recusa com padrao não vazio e sem o valor', () => {
    for (const nome of ['gh[sur]', 'github_pat', 'sk-prefixado']) {
      const dir = tmp();
      const r = append(dir, 's1', ev('guarda.deny', { alvo: SEGREDOS[nome] }));
      assert.deepEqual(r, { ok: true, gravado: 'recusa' }, nome);
      const bruto = readFileSync(join(dir, 'events.s1.jsonl'), 'utf8');
      assert.equal(bruto.includes(SEGREDOS[nome]), false, `${nome} vazou`);
      const [e] = ler(dir);
      assert.equal(e.tipo, 'diario.recusa');
      assert.equal(e.dados.padrao, nome);
    }
  });

  test('diario-recusa-grava-evento: grava diario.recusa {tipo,padrao}, sem dados e sem o segredo', () => {
    const dir = tmp();
    const segredo = SEGREDOS.ghp;
    const r = append(dir, 's1', ev('guarda.deny', { alvo: segredo }));
    assert.deepEqual(r, { ok: true, gravado: 'recusa' });
    const bruto = readFileSync(join(dir, 'events.s1.jsonl'), 'utf8');
    assert.equal(bruto.includes(segredo), false, 'o segredo foi para o arquivo');
    const eventos = ler(dir);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].tipo, 'diario.recusa');
    assert.deepEqual(Object.keys(eventos[0].dados).sort(), ['padrao', 'tipo']);
    assert.equal(eventos[0].dados.tipo, 'guarda.deny');
    assert.equal(typeof eventos[0].dados.padrao, 'string');
  });

  test('diario-roundtrip: ler devolve os campos gravados; seq e hash_anterior são calculados', () => {
    const dir = tmp();
    const original = ev('producao.acesso', { alvo: 'db.prod.exemplo.com', ambiente: 'prod', acao: 'leitura', n: 1 });
    assert.deepEqual(append(dir, 's1', original), { ok: true, gravado: 'evento' });
    const [primeiro] = ler(dir);
    assert.deepEqual(primeiro, { ...original, seq: 1, hash_anterior: null });
    assert.deepEqual(append(dir, 's1', { ...original, tipo: 'guarda.deny', dados: { alvo: 'x' } }), { ok: true, gravado: 'evento' });
    const es = ler(dir);
    assert.equal(es.length, 2);
    assert.equal(es[1].tipo, 'guarda.deny');
    assert.deepEqual(es[1].dados, { alvo: 'x' });
    assert.equal(es[1].autor, original.autor);
    assert.equal(es[1].sessao, original.sessao);
    assert.equal(es[1].agente, original.agente);
    assert.equal(es[1].ts, original.ts);
    assert.equal(es[1].seq, 2);
    assert.equal(es[1].hash_anterior, sha(linhas(join(dir, 'events.s1.jsonl'))[0]));
  });

  test('diario-cadeia: seq 1,2,3; hash_anterior = sha256 da linha anterior; o 1º é null', () => {
    const dir = tmp();
    for (let i = 0; i < 3; i++) assert.deepEqual(append(dir, 's1', ev()), { ok: true, gravado: 'evento' });
    const ls = linhas(join(dir, 'events.s1.jsonl'));
    assert.equal(ls.length, 3);
    const es = ls.map((l) => JSON.parse(l) as Evento);
    assert.deepEqual(es.map((e) => e.seq), [1, 2, 3]);
    assert.equal(es[0].hash_anterior, null);
    assert.equal(es[1].hash_anterior, sha(ls[0]));
    assert.equal(es[2].hash_anterior, sha(ls[1]));
  });

  test('diario-lock-orfao: lock com mtime -3 s é quebrado; lock -1 s ⇒ espera', () => {
    const orfao = tmp();
    const lockOrfao = join(orfao, 'events.s1.jsonl.lock');
    writeFileSync(lockOrfao, '');
    const t3 = (Date.now() - 3000) / 1000;
    utimesSync(lockOrfao, t3, t3);
    const a0 = Date.now();
    assert.deepEqual(append(orfao, 's1', ev()), { ok: true, gravado: 'evento' });
    assert.ok(Date.now() - a0 < 800, 'lock órfão deveria ser quebrado sem esperar');

    const fresco = tmp();
    const lockFresco = join(fresco, 'events.s1.jsonl.lock');
    writeFileSync(lockFresco, '');
    const t1 = (Date.now() - 1000) / 1000;
    utimesSync(lockFresco, t1, t1);
    const b0 = Date.now();
    const r = append(fresco, 's1', ev());
    assert.ok(Date.now() - b0 >= 500, 'lock de 1 s deveria fazer o append esperar');
    assert.deepEqual(r, { ok: true, gravado: 'evento' });
  });

  test('diario-cria-caminho: diretório aninhado inexistente é criado (mkdir recursivo)', () => {
    const base = tmp();
    const dir = join(base, '.harness', 'entregas', 'GM-9');
    assert.deepEqual(append(dir, 's1', ev()), { ok: true, gravado: 'evento' });
    assert.equal(ler(dir).length, 1);
  });

  test('diario-indisponivel-segue: diretório existente somente leitura ⇒ {ok:false} sem lançar', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root ignora permissão de diretório (skip declarado)');
    const dir = tmp();
    chmodSync(dir, 0o555);
    try {
      let r: ReturnType<typeof append> | undefined;
      assert.doesNotThrow(() => { r = append(dir, 's1', ev()); });
      assert.equal(r?.ok, false);
      if (r && !r.ok) assert.equal(typeof r.erro, 'string');
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  test('diario-concorrente: 2 processos x 50 appends ⇒ 100 linhas e cadeia íntegra', async () => {
    const dir = tmp();
    const codigo = `
      import { append } from ${JSON.stringify(DIARIO_TS)};
      for (let i = 0; i < 50; i++) {
        const r = append(${JSON.stringify(dir)}, 's1', { ts: '2026-11-02T12:00:00.000Z', autor: 'a', sessao: 's1', agente: 'orquestrador', tipo: 'guarda.deny', dados: { i } });
        if (!r.ok) { console.error(r.erro); process.exit(2); }
      }`;
    const rodar = (): Promise<{ status: number | null; stderr: string }> =>
      new Promise((resolve) => {
        const p = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', codigo], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        p.stderr.on('data', (d) => { stderr += d; });
        p.on('close', (status) => resolve({ status, stderr }));
      });
    const [a, b] = await Promise.all([rodar(), rodar()]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    const ls = linhas(join(dir, 'events.s1.jsonl'));
    assert.equal(ls.length, 100);
    ls.forEach((l, i) => {
      const e = JSON.parse(l) as Evento;
      assert.equal(e.seq, i + 1);
      assert.equal(e.hash_anterior, i === 0 ? null : sha(ls[i - 1]));
    });
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.lock')), [], 'lock vazou');
  });
});

describe('projeção e caminho', () => {
  test('instantaneo-6000: 10 mil eventos ⇒ instantaneo.length <= 6000', () => {
    const eventos: Evento[] = Array.from({ length: 10000 }, (_, i) => ({
      seq: i + 1,
      ts: '2026-11-02T12:00:00.000Z',
      autor: 'dev@exemplo.com',
      sessao: 's1',
      agente: i % 2 ? 'orquestrador' : 'subagent:abc',
      tipo: (i % 3 ? 'guarda.deny' : 'producao.acesso') as TipoEvento,
      dados: { alvo: `host-${i}.exemplo.com`, ambiente: 'prod', acao: 'leitura' },
      hash_anterior: null,
    }));
    const p = projetar(eventos);
    assert.ok(p.instantaneo.length > 0);
    assert.ok(p.instantaneo.length <= 6000, `instantaneo com ${p.instantaneo.length} caracteres`);
    assert.equal(typeof p.resumo, 'object');
  });

  // O instantâneo cita o `dados.alvo` de cada evento, um evento por linha (cabeçalho e rodapé são livres);
  // os marcadores `alvo` abaixo terminam em `-fim` para detectar corte no meio de uma linha.
  const evP = (n: number, ts: string, sessao: string, tipo: TipoEvento): Evento => ({
    seq: n, ts, autor: 'dev@exemplo.com', sessao, agente: 'orquestrador', tipo,
    dados: { alvo: `m${n}-fim` }, hash_anterior: null,
  });

  test('projetar-resumo: conta por tipo com valores exatos', () => {
    const es = [
      evP(1, '2026-11-02T10:00:00.000Z', 's1', 'producao.acesso'),
      evP(2, '2026-11-02T10:01:00.000Z', 's1', 'guarda.deny'),
      evP(3, '2026-11-02T10:02:00.000Z', 's1', 'producao.acesso'),
      evP(4, '2026-11-02T10:03:00.000Z', 's1', 'producao.acesso'),
      evP(5, '2026-11-02T10:04:00.000Z', 's1', 'operacao.destrutiva'),
    ];
    assert.deepEqual(projetar(es).resumo, { 'producao.acesso': 3, 'guarda.deny': 1, 'operacao.destrutiva': 1 });
    assert.deepEqual(projetar([]).resumo, {});
  });

  test('projetar-ordem: eventos mais recentes (ts) aparecem antes, independente da ordem de entrada', () => {
    const es = [
      evP(1, '2026-11-02T10:00:00.000Z', 's1', 'guarda.deny'),
      evP(2, '2026-11-02T10:05:00.000Z', 'sA', 'guarda.deny'),
      evP(3, '2026-11-02T10:02:00.000Z', 's1', 'guarda.deny'),
      evP(4, '2026-11-02T10:05:00.000Z', 'sB', 'guarda.deny'),
    ];
    const s = projetar(es).instantaneo;
    const pos = (n: number): number => s.indexOf(`m${n}-fim`);
    for (const n of [1, 2, 3, 4]) assert.ok(pos(n) >= 0, `m${n} ausente do instantâneo`);
    // Só a ordem de ocorrência dos `alvo` importa; o desempate por sessao não tem direção exigida.
    assert.ok(Math.max(pos(2), pos(4)) < pos(3), '10:05 (qualquer sessão) antes de 10:02');
    assert.ok(pos(3) < pos(1), '10:02 antes de 10:00');
  });

  test('projetar-corte-em-linha-inteira: o corte em 6000 cai na fronteira de linha (cabeçalho e rodapé permitidos)', () => {
    const es = Array.from({ length: 10000 }, (_, i) =>
      evP(i + 1, new Date(Date.UTC(2026, 10, 2, 0, 0, 0) + i * 1000).toISOString(), 's1', 'producao.acesso'));
    const s = projetar(es).instantaneo;
    assert.ok(s.length <= 6000, `instantaneo com ${s.length} caracteres`);
    const marcadores = s.match(/\bm\d+(?:-f(?:i(?:m)?)?)?/g) ?? [];
    assert.ok(marcadores.length > 10, 'instantâneo deveria listar vários eventos');
    for (const m of marcadores) assert.match(m, /^m\d+-fim$/, `marcador cortado no meio: ${m}`);
    // mais recente primeiro, sem buracos: m10000, m9999, m9998, ...
    marcadores.forEach((m, i) => assert.equal(m, `m${10000 - i}-fim`, `posição ${i}`));
    // no máximo um marcador por linha, e nada de resto de linha (ts, tipo) depois do último `-fim` do corte
    for (const linha of s.split('\n')) {
      assert.ok((linha.match(/\bm\d+(?:-f(?:i(?:m)?)?)?/g) ?? []).length <= 1, `mais de um evento na linha: ${linha.slice(0, 80)}`);
    }
    const resto = s.slice(s.lastIndexOf('-fim') + 4);
    assert.doesNotMatch(resto, /\d{4}-\d|producao/, 'resto de linha cortada após o último evento');
  });

  test('dirEntrega-sem-id: null ⇒ _sem-id; com id ⇒ o id', () => {
    assert.equal(dirEntrega('/r', null), join('/r', '.harness', 'entregas', '_sem-id'));
    assert.equal(dirEntrega('/r', 'GM-9'), join('/r', '.harness', 'entregas', 'GM-9'));
  });
});

// ---- Rodada de correção 1 (review T3) ----

/** Roda um `append` em processo filho (um laço infinito não trava o runner); mata em `limiteMs`. */
const filhoAppend = (dir: string, opts = '', limiteMs = 8000): Promise<{ saiu: boolean; saida: string }> =>
  new Promise((resolve) => {
    const codigo = `
      import { append } from ${JSON.stringify(DIARIO_TS)};
      const a = Date.now();
      const r = append(${JSON.stringify(dir)}, 's1', { ts: 't', autor: 'a', sessao: 's1', agente: 'o', tipo: 'guarda.deny', dados: {} }${opts});
      console.log(JSON.stringify({ ms: Date.now() - a, r }));`;
    const p = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', codigo], { stdio: ['ignore', 'pipe', 'ignore'] });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), limiteMs);
    p.on('close', (c) => { clearTimeout(t); resolve({ saiu: c === 0, saida }); });
  });

describe('lock robusto', () => {
  test('lock-symlink-pendente: termina com {ok:false}, sem laço', async () => {
    const dir = tmp();
    symlinkSync(join(dir, 'nao-existe'), join(dir, 'events.s1.jsonl.lock'));
    const r = await filhoAppend(dir);
    assert.equal(r.saiu, true, 'append não terminou (laço infinito)');
    const o = JSON.parse(r.saida);
    assert.equal(o.r.ok, false);
    assert.ok(o.ms < 1500, `lock inválido deveria falhar na hora, levou ${o.ms} ms`);
  });

  test('lock-diretorio: {ok:false}, sem laço', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'events.s1.jsonl.lock'));
    const r = await filhoAppend(dir);
    assert.equal(r.saiu, true);
    const o = JSON.parse(r.saida);
    assert.equal(o.r.ok, false);
    assert.ok(o.ms < 1500, `levou ${o.ms} ms`);
  });

  test('lock-prazo: lock que nunca envelhece ⇒ {ok:false} em ~3 s, abaixo do timeout de 5 s do hook', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'events.s1.jsonl.lock'), 'outro');
    // `agora` devolve sempre o mtime do lock ⇒ idade 0 ⇒ nunca órfão
    const mtime = statSync(join(dir, 'events.s1.jsonl.lock')).mtimeMs;
    const r = await filhoAppend(dir, `, { agora: () => ${mtime} }`, 7000);
    assert.equal(r.saiu, true, 'append passou de 7 s');
    const o = JSON.parse(r.saida);
    assert.equal(o.r.ok, false);
    assert.ok(o.ms >= 2500 && o.ms < 4500, `esperou ${o.ms} ms`);
  });

  test('lock-mtime-futuro: conta como órfão e é quebrado', () => {
    const dir = tmp();
    const lock = join(dir, 'events.s1.jsonl.lock');
    writeFileSync(lock, '');
    const fut = Date.now() / 1000 + 86400;
    utimesSync(lock, fut, fut);
    const a = Date.now();
    assert.deepEqual(append(dir, 's1', ev()), { ok: true, gravado: 'evento' });
    assert.ok(Date.now() - a < 800);
  });

  test('lock-so-do-dono: lock tomado por outro durante o append não é apagado', () => {
    const dir = tmp();
    const lock = join(dir, 'events.s1.jsonl.lock');
    const dados = { toJSON: () => { if (existsSync(lock)) writeFileSync(lock, 'token-de-outro'); return { x: 1 }; } };
    assert.deepEqual(append(dir, 's1', ev('guarda.deny', dados as unknown as Record<string, unknown>)), { ok: true, gravado: 'evento' });
    assert.equal(readFileSync(lock, 'utf8'), 'token-de-outro');
  });
});

describe('canário completo', () => {
  test('canario-tamanho: 300 KB ⇒ recusa em < 50 ms, sem regex e sem o conteúdo', () => {
    const dir = tmp();
    const grande = 'eyJ'.repeat(100000);
    const t0 = performance.now();
    const r = append(dir, 's1', ev('guarda.deny', { alvo: grande }));
    const ms = performance.now() - t0;
    assert.deepEqual(r, { ok: true, gravado: 'recusa' });
    assert.ok(ms < 50, `levou ${ms.toFixed(0)} ms`);
    const [e] = ler(dir);
    assert.equal(e.tipo, 'diario.recusa');
    assert.deepEqual(e.dados, { tipo: 'guarda.deny', padrao: 'tamanho' });
    assert.ok(readFileSync(join(dir, 'events.s1.jsonl'), 'utf8').length < 1000);
  });

  for (const c of ['ts', 'autor', 'agente', 'tipo', 'sessao'] as const) {
    test(`canario-por-campo: segredo em ${c} não vai literal ao arquivo`, () => {
      const dir = tmp();
      const segredo = SEGREDOS.ghp;
      const base = ev();
      const r = append(dir, 's1', { ...base, [c]: segredo } as typeof base);
      assert.deepEqual(r, { ok: true, gravado: 'recusa' });
      const bruto = readFileSync(join(dir, 'events.s1.jsonl'), 'utf8');
      assert.equal(bruto.includes(segredo), false, `segredo em ${c} vazou`);
      const [e] = ler(dir);
      assert.equal(e.tipo, 'diario.recusa');
      if (c === 'tipo') assert.equal(e.dados.tipo, '[redigido]');
      else assert.equal((e as unknown as Record<string, unknown>)[c], '[redigido]');
    });
  }

  test('canario-folha-desserializada: Bearer com quebra e chave com segredo recusam; URL com @ em outro campo não', () => {
    const d1 = tmp();
    assert.deepEqual(append(d1, 's1', ev('guarda.deny', { h: 'Bearer\n' + 'd'.repeat(20) })), { ok: true, gravado: 'recusa' });
    const d2 = tmp();
    assert.deepEqual(append(d2, 's1', ev('guarda.deny', { [SEGREDOS.ghp]: 1 })), { ok: true, gravado: 'recusa' });
    const d3 = tmp();
    assert.deepEqual(append(d3, 's1', ev('guarda.deny', { alvo: 'https://db.exemplo.com', via: 'a@b.c' })), { ok: true, gravado: 'evento' });
  });
});

describe('sessão e caminho', () => {
  test('sessao-invalida: traversal, quebra de linha, vazio e nulo ⇒ {ok:false}, nada escrito', () => {
    const base = tmp();
    const dir = join(base, 'a', 'b');
    for (const s of ['../../fora', 'x/../../../fora2', 'a/b', '', 'q\nz', 'nul\0x', 'a'.repeat(129)]) {
      const r = append(dir, s, ev());
      assert.equal(r.ok, false, JSON.stringify(s));
    }
    assert.deepEqual(readdirSync(base), [], 'algo foi escrito');
  });

  test('dirEntrega-pbi-invalido: fora de ^[A-Z]+-\\d+$ ⇒ _sem-id', () => {
    for (const p of ['../../../etc', 'GM-9/../..', '/abs', 'a/b', '..', 'gm-9', 'GM-']) {
      assert.equal(dirEntrega('/r', p), join('/r', '.harness', 'entregas', '_sem-id'), p);
    }
  });

  test('diario-symlink: events.<sessao>.jsonl symlink ⇒ {ok:false} e o alvo intacto', () => {
    const dir = tmp();
    const alvo = join(dir, 'alvo.txt');
    writeFileSync(alvo, 'orig\n');
    symlinkSync(alvo, join(dir, 'events.s1.jsonl'));
    assert.equal(append(dir, 's1', ev()).ok, false);
    assert.equal(readFileSync(alvo, 'utf8'), 'orig\n');
  });
});

describe('reparo, tolerância e projeção', () => {
  test('linha truncada: o evento seguinte começa em linha própria; seq cai para a contagem; ler ignora a truncada', () => {
    const dir = tmp();
    assert.equal(append(dir, 's1', ev()).ok, true);
    assert.equal(append(dir, 's1', ev()).ok, true);
    const f = join(dir, 'events.s1.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8') + '{"seq":3,"ts":"2026');
    assert.equal(append(dir, 's1', ev()).ok, true);
    const ls = readFileSync(f, 'utf8').split('\n');
    assert.equal(ls.length, 5);
    assert.equal(ls[2], '{"seq":3,"ts":"2026');
    const novo = JSON.parse(ls[3]) as Evento;
    assert.equal(novo.seq, 4);
    assert.equal(novo.hash_anterior, sha('{"seq":3,"ts":"2026'));
    assert.deepEqual(ler(dir).map((e) => e.seq), [1, 2, 4]);
  });

  test('ler-tolerante: linhas null, lixo e seq não numérico não derrubam', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'events.s1.jsonl'), 'null\nlixo\n{"seq":"abc","tipo":"guarda.deny","ts":"t","sessao":"s1","dados":{}}\n');
    assert.equal(ler(dir).length, 1);
    assert.equal(append(dir, 's1', ev()).ok, true);
    assert.doesNotThrow(() => projetar([null as unknown as Evento, ...ler(dir)]));
  });

  test('projetar-alvo-gigante: alvo é cortado e não esconde os demais; quebra de linha vira espaço', () => {
    const mk = (n: number, alvo: string): Evento => ({ seq: n, ts: `2026-11-02T10:0${n}:00.000Z`, autor: 'a', sessao: 's1', agente: 'o', tipo: 'guarda.deny', dados: { alvo }, hash_anterior: null });
    const s = projetar([mk(1, 'primeiro-fim'), mk(2, 'x'.repeat(7000)), mk(3, 'a\nb\r\nc-fim')]).instantaneo;
    assert.ok(s.includes('primeiro-fim'), 'o alvo gigante escondeu o evento antigo');
    assert.equal(s.includes('x'.repeat(301)), false);
    assert.ok(s.includes('a b c-fim'));
    assert.ok(s.length <= 6000);
  });

  test('projetar-desempate: mesmo ts, sessões diferentes ⇒ saída independe da ordem de entrada', () => {
    const mk = (sessao: string, alvo: string): Evento => ({ seq: 1, ts: '2026-11-02T10:00:00.000Z', autor: 'a', sessao, agente: 'o', tipo: 'guarda.deny', dados: { alvo }, hash_anterior: null });
    const es = [mk('sA', 'A-fim'), mk('sB', 'B-fim'), mk('sC', 'C-fim')];
    assert.equal(projetar(es).instantaneo, projetar([...es].reverse()).instantaneo);
  });

  test('projetar-resumo-total: o resumo conta todos os eventos, não só os que cabem', () => {
    const es: Evento[] = Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, ts: `2026-11-02T10:00:${String(i % 60).padStart(2, '0')}.000Z`, autor: 'a', sessao: 's1', agente: 'o', tipo: 'guarda.deny', dados: { alvo: 'h'.repeat(100) }, hash_anterior: null }));
    assert.deepEqual(projetar(es).resumo, { 'guarda.deny': 500 });
  });
});

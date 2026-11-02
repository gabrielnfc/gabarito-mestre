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
import { mkdtempSync, writeFileSync, readFileSync, utimesSync, chmodSync, readdirSync } from 'node:fs';
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
  'AKIA': 'AKIA' + 'ABCDEFGHIJKL',
  'ASIA': 'ASIA' + 'ABCDEFGHIJKL',
  'BEGIN': '-----' + 'BEGIN PRIVATE KEY-----',
  'sk': 'sk-' + 'c'.repeat(20),
  'xox': 'xoxb-' + '1234567890',
  'url-credencial': 'postgres://u:' + 's3nh4@db.exemplo.com/x',
  'Bearer': 'Bearer ' + 'd'.repeat(20),
  'jwt': 'eyJ' + 'e'.repeat(20) + '.eyJ' + 'f'.repeat(20),
};

describe('canário', () => {
  test('canario-nao-recusa-task: task-list, risk-matrix e prod-disk-01 passam', () => {
    for (const texto of ['docs/task-list.md', 'risk-matrix.ts', 'prod-disk-01']) {
      assert.equal(recusaCanario(JSON.stringify({ dados: { alvo: texto } })), null, texto);
      assert.equal(recusaCanario(texto), null, texto);
    }
  });

  test('diario-recusa-segredo: um valor por padrão ⇒ não-null', () => {
    for (const [nome, valor] of Object.entries(SEGREDOS)) {
      assert.notEqual(recusaCanario(JSON.stringify({ dados: { alvo: valor } })), null, `padrão ${nome}`);
    }
  });
});

describe('append', () => {
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

  test('diario-indisponivel-segue: dir somente leitura ⇒ {ok:false} sem lançar', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root ignora permissão de diretório');
    const base = tmp();
    chmodSync(base, 0o555);
    try {
      const r = append(join(base, 'entregas', 'x'), 's1', ev());
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(typeof r.erro, 'string');
    } finally {
      chmodSync(base, 0o755);
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

  test('dirEntrega-sem-id: null ⇒ _sem-id; com id ⇒ o id', () => {
    assert.equal(dirEntrega('/r', null), join('/r', '.harness', 'entregas', '_sem-id'));
    assert.equal(dirEntrega('/r', 'GM-9'), join('/r', '.harness', 'entregas', 'GM-9'));
  });
});

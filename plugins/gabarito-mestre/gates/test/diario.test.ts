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
import { append, ler, lerEstrito, projetar, recusaCanario, dirEntrega } from '../src/diario.ts';
import { estadoDe } from '../src/loop.ts';
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
  test('instantaneo-3200: 10 mil eventos ⇒ instantaneo.length <= 3200', () => {
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
    assert.ok(p.instantaneo.length <= 3200, `instantaneo com ${p.instantaneo.length} caracteres`);
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

  test('projetar-corte-em-linha-inteira: o corte em 3200 cai na fronteira de linha (cabeçalho e rodapé permitidos)', () => {
    const es = Array.from({ length: 10000 }, (_, i) =>
      evP(i + 1, new Date(Date.UTC(2026, 10, 2, 0, 0, 0) + i * 1000).toISOString(), 's1', 'producao.acesso'));
    const s = projetar(es).instantaneo;
    assert.ok(s.length <= 3200, `instantaneo com ${s.length} caracteres`);
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
    assert.ok(s.length <= 3200);
  });

  test('projetar-desempate: mesmo ts, sessões diferentes ⇒ saída independe da ordem de entrada', () => {
    const mk = (sessao: string, alvo: string): Evento => ({ seq: 1, ts: '2026-11-02T10:00:00.000Z', autor: 'a', sessao, agente: 'o', tipo: 'guarda.deny', dados: { alvo }, hash_anterior: null });
    const es = [mk('sA', 'A-fim'), mk('sB', 'B-fim'), mk('sC', 'C-fim')];
    assert.equal(projetar(es).instantaneo, projetar([...es].reverse()).instantaneo);
  });

  // ETA (REQ-OBS-1): mediana de duração das tasks aprovadas; < 3 medições ⇒ "sem dados".
  const T0 = Date.UTC(2026, 10, 3, 10, 0, 0);
  const iso = (s: number): string => new Date(T0 + s * 1000).toISOString();
  const evT = (n: number, s: number | string, tipo: TipoEvento, dados: Record<string, unknown>): Evento => ({
    seq: n, ts: typeof s === 'number' ? iso(s) : s, autor: 'a', sessao: 's1', agente: 'o', tipo, dados, hash_anterior: null,
  });
  const ini = (n: number, s: number | string, task: string, papel = 'implementador'): Evento => evT(n, s, 'task.iniciada', { task, papel });
  const ver = (n: number, s: number | string, task: string, veredito = 'APROVADO', rodada = 1, major = 0): Evento =>
    evT(n, s, 'review.veredito', { task, veredito, blocker: 0, major, rodada });
  const conc = (n: number, s: number | string, task: string): Evento => evT(n, s, 'task.concluida', { task });
  const reab = (n: number, s: number | string, task: string, origem: 'dono' | 'retomada'): Evento => evT(n, s, 'task.reaberta', { task, origem });
  /** implementador, concluida, revisor, veredito: o ciclo mínimo que a T2 aceita; só `tsIni` e `tsVer` importam à ETA. */
  const ciclo = (b: number, task: string, tsIni: number | string, tsVer: number | string, veredito = 'APROVADO'): Evento[] => [
    ini(b * 10, tsIni, task), conc(b * 10 + 1, tsIni, task), ini(b * 10 + 2, tsIni, task, 'revisor'), ver(b * 10 + 3, tsVer, task, veredito),
  ];
  const aprovada = (base: number, task: string, dur: number): Evento[] => ciclo(base, task, base * 1000, base * 1000 + dur);
  /** A T2 tem de aceitar a sequência e parar no estado esperado: o teste não inventa sequência ilegal. */
  const legalNaT2 = (es: Evento[], task: string, esperado: string): void => {
    const r = estadoDe(es.filter((e) => (e.dados as { task?: string }).task === task));
    assert.deepEqual('invalido' in r ? r : r.estado, esperado);
  };

  test('eta-sem-dados-com-2: duas medições ⇒ eta null e linha "ETA: sem dados"', () => {
    const es = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 200)];
    const p = projetar(es);
    assert.equal(p.eta, null);
    assert.ok(p.instantaneo.split('\n').includes('ETA: sem dados'));
  });

  test('eta-sem-dados-com-2: zero eventos também diz sem dados', () => {
    const p = projetar([]);
    assert.equal(p.eta, null);
    assert.ok(p.instantaneo.split('\n').includes('ETA: sem dados'));
  });

  test('eta-mediana-com-3: ímpar pega o do meio; par, a média dos dois do meio', () => {
    const impar = projetar([...aprovada(1, 'T1', 300), ...aprovada(3, 'T2', 100), ...aprovada(5, 'T3', 200)]);
    assert.deepEqual(impar.eta, { medianaS: 200, n: 3 });
    assert.ok(impar.instantaneo.split('\n').includes('ETA: 3 tasks, mediana 200 s'));
    const par = projetar([...aprovada(1, 'T1', 10), ...aprovada(3, 'T2', 20), ...aprovada(5, 'T3', 40), ...aprovada(7, 'T4', 1000)]);
    assert.deepEqual(par.eta, { medianaS: 30, n: 4 });
  });

  test('eta-ignora-reprovada: veredito REPROVADO sozinho não é medição', () => {
    const base = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 100), ...ciclo(5, 'T3', 5000, 5400, 'REPROVADO')];
    legalNaT2(base, 'T3', 'reprovada');
    assert.equal(projetar(base).eta, null);
  });

  test('eta-rodadas-somam: REPROVADO + nova rodada APROVADA entram como UMA medição de 150 + 50 s', () => {
    const es = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 300),
      ...ciclo(5, 'T3', 5000, 5150, 'REPROVADO'),
      ini(60, 6000, 'T3', 'correcao'), conc(61, 6000, 'T3'), ini(62, 6000, 'T3', 'revisor'), ver(63, 6050, 'T3', 'APROVADO', 2)];
    legalNaT2(es, 'T3', 'aprovada');
    assert.deepEqual(projetar(es).eta, { medianaS: 200, n: 3 });
  });

  const seqT2 = (b: number, task: string, d: { r1: number; corr: number; r2: number }): Evento[] => [
    ini(b, b * 1000, task), evT(b + 1, b * 1000 + 50, 'task.concluida', { task }), ini(b + 2, b * 1000 + 60, task, 'revisor'),
    ver(b + 3, b * 1000 + d.r1, task, 'REPROVADO'), ini(b + 4, b * 1000 + d.r1 + 10, task, 'correcao'),
    evT(b + 5, b * 1000 + d.r1 + 10 + d.corr, 'task.concluida', { task }), ini(b + 6, b * 1000 + d.r1 + d.corr + 20, task, 'revisor'),
    ver(b + 7, b * 1000 + d.r1 + d.corr + 20 + d.r2, task, 'APROVADO', 2),
  ];

  test('eta-rodada-2-conta: sequência real da T2 (impl, revisor, REPROVADO, correcao, revisor, APROVADO) entra na ETA', () => {
    const es = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 100), ...seqT2(100, 'T3', { r1: 400, corr: 100, r2: 60 })];
    assert.deepEqual(projetar(es).eta?.n, 3);
  });

  test('eta-duracao-soma-rodadas: rodada 1 (início até REPROVADO) + rodada 2 (correcao até APROVADO)', () => {
    const es = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 100), ...seqT2(100, 'T3', { r1: 400, corr: 100, r2: 60 })];
    // 400 + (100 + 10 + 60) = 570; mediana de [100, 100, 570] = 100; com 4 tasks a mediana expõe a soma
    const p = projetar([...es, ...aprovada(200, 'T4', 300)]);
    assert.deepEqual(p.eta, { medianaS: 200, n: 4 });
    assert.deepEqual(projetar([...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 900), ...seqT2(100, 'T3', { r1: 400, corr: 100, r2: 60 })]).eta, { medianaS: 570, n: 3 });
  });

  test('eta-so-implementador: iniciada de revisor ou correção não abre a contagem', () => {
    const es = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 100),
      ini(5, 5000, 'T3', 'revisor'), ver(6, 5500, 'T3')];
    assert.equal(projetar(es).eta, null);
  });

  test('eta-descarta-ts-invalido-e-duracao-negativa', () => {
    const base = [...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 100)];
    assert.equal(projetar([...base, ...ciclo(5, 'T3', '0-ontem', 5100)]).eta, null, 'ts inválido no início');
    assert.equal(projetar([...base, ...ciclo(5, 'T3', 5000, 'nao-e-data')]).eta, null, 'ts inválido no fim');
    // ordem textual diz "depois", o instante real diz "antes" (fusos diferentes): duração negativa
    const antes = [...base, ...ciclo(5, 'T3', '2026-11-03T20:00:00.000Z', '2026-11-03T21:00:00.000+05:00')];
    assert.equal(projetar(antes).eta, null, 'duração negativa');
  });

  // Rodada 3 (Sombra Q-ETA): a ETA segue a transição da T2; cada sequência abaixo é conferida na T2 antes de medir.
  const base2 = (a: number, b: number): Evento[] => [...aprovada(1, 'T1', a), ...aprovada(3, 'T2', b)];

  test('eta-s1-revisao-retomada-conta: em_revisao + retomada volta a concluida e a task conta desde o 1º início', () => {
    const t3 = [ini(50, 10000, 'T3'), conc(51, 10100, 'T3'), ini(52, 10200, 'T3', 'revisor'), reab(53, 10300, 'T3', 'retomada'),
      ini(54, 10400, 'T3', 'revisor'), ver(55, 11000, 'T3')];
    legalNaT2(t3, 'T3', 'aprovada');
    assert.deepEqual(projetar([...base2(500, 2000), ...t3]).eta, { medianaS: 1000, n: 3 });
  });

  test('eta-s2-correcao-retomada-soma-r1: correção abandonada é descartada e a rodada 1 continua somada', () => {
    const t3 = [...ciclo(5, 'T3', 10000, 10400, 'REPROVADO'),
      ini(60, 10410, 'T3', 'correcao'), reab(61, 10700, 'T3', 'retomada'),
      ini(62, 12000, 'T3', 'correcao'), conc(63, 12010, 'T3'), ini(64, 12020, 'T3', 'revisor'), ver(65, 12100, 'T3', 'APROVADO', 2)];
    legalNaT2(t3, 'T3', 'aprovada');
    // 400 (r1) + 100 (correção refeita) = 500; os 290 s abandonados não entram
    assert.deepEqual(projetar([...base2(100, 900), ...t3]).eta, { medianaS: 500, n: 3 });
  });

  test('eta-s3-s4-s6-sem-transicao-contam: reabertura que não muda o estado na T2 não tira a task da amostra', () => {
    const b = base2(300, 900);
    const s3 = [ini(50, 10000, 'T3'), conc(51, 10010, 'T3'), reab(52, 10100, 'T3', 'retomada'), ini(53, 10200, 'T3', 'revisor'), ver(54, 10600, 'T3')];
    legalNaT2(s3, 'T3', 'aprovada');
    assert.deepEqual(projetar([...b, ...s3]).eta, { medianaS: 600, n: 3 }, 'S3 concluida + retomada');
    for (const [nome, origem] of [['S4 reprovada + retomada', 'retomada'], ['S6 reprovada + dono', 'dono']] as const) {
      const t3 = [...ciclo(5, 'T3', 10000, 10400, 'REPROVADO'), reab(60, 10450, 'T3', origem),
        ini(61, 10500, 'T3', 'correcao'), conc(62, 10510, 'T3'), ini(63, 10520, 'T3', 'revisor'), ver(64, 10700, 'T3', 'APROVADO', 2)];
      legalNaT2(t3, 'T3', 'aprovada');
      assert.deepEqual(projetar([...b, ...t3]).eta, { medianaS: 600, n: 3 }, nome);
    }
  });

  test('eta-s5-tentativa-abandonada-descartada: implementando + retomada recomeça do zero; só a tentativa que aprovou conta', () => {
    const t3 = [ini(50, 10000, 'T3'), reab(51, 10300, 'T3', 'retomada'), ...ciclo(6, 'T3', 11000, 11100)];
    legalNaT2(t3, 'T3', 'aprovada');
    assert.deepEqual(projetar([...base2(50, 1000), ...t3]).eta, { medianaS: 100, n: 3 });
  });

  test('eta-s7-dono-zera: no_teto + dono volta a pendente e recomeça a soma, rodadas velhas não entram', () => {
    const t3 = [...ciclo(5, 'T3', 10000, 10400, 'REPROVADO'),
      ini(60, 10410, 'T3', 'correcao'), conc(61, 10420, 'T3'), ini(62, 10430, 'T3', 'revisor'), ver(63, 10900, 'T3', 'REPROVADO', 2, 1),
      reab(64, 12000, 'T3', 'dono'),
      ini(65, 13000, 'T3'), conc(66, 13010, 'T3'), ini(67, 13020, 'T3', 'revisor'), ver(68, 13100, 'T3', 'APROVADO', 1)];
    legalNaT2(t3, 'T3', 'aprovada');
    assert.deepEqual(projetar([...base2(50, 1000), ...t3]).eta, { medianaS: 100, n: 3 });
  });

  test('eta-ts-fora-de-ordem-nao-some: veredito com ts anterior ao início perde só o intervalo, não a task', () => {
    const t3 = [...ciclo(5, 'T3', '2026-11-03T20:00:00.000Z', '2026-11-03T19:00:00.000Z', 'REPROVADO'),
      ini(60, 30000, 'T3', 'correcao'), conc(61, 30010, 'T3'), ini(62, 30020, 'T3', 'revisor'), ver(63, 30300, 'T3', 'APROVADO', 2)];
    legalNaT2(t3, 'T3', 'aprovada');
    let p!: ReturnType<typeof projetar>;
    assert.doesNotThrow(() => { p = projetar([...base2(100, 900), ...t3]); });
    assert.deepEqual(p.eta, { medianaS: 300, n: 3 });
  });

  test('eta-sequencia-invalida-fora: sequência que a T2 rejeita deixa a task fora da amostra, sem número inventado', () => {
    const t3 = [ini(50, 10000, 'T3'), ver(51, 10500, 'T3')]; // veredito sem revisão: a T2 rejeita
    assert.ok('invalido' in estadoDe(t3), 'a T2 tem de rejeitar esta sequência');
    assert.equal(projetar([...base2(100, 200), ...t3]).eta, null);
    // aprovada e depois um evento ilegal: a T2 rejeita a task inteira, a medição já feita não sobrevive
    const depois = [...aprovada(5, 'T3', 100), ini(60, 20000, 'T3', 'revisor')];
    assert.ok('invalido' in estadoDe(depois), 'a T2 tem de rejeitar esta sequência');
    assert.equal(projetar([...base2(100, 200), ...depois]).eta, null);
  });

  test('eta-ordem-de-entrada-embaralhada: a ETA ordena por seq como a T2, não pela ordem em que os eventos chegam', () => {
    const t3 = [ini(50, 10000, 'T3'), conc(51, 10010, 'T3'), ini(52, 10020, 'T3', 'revisor'), ver(53, 10700, 'T3')];
    legalNaT2(t3, 'T3', 'aprovada');
    assert.deepEqual(projetar([...base2(100, 900), ...[...t3].reverse()]).eta, { medianaS: 700, n: 3 });
  });

  test('eta-dados-malformado-nao-lanca: dados não objeto e eventos nulos são ignorados', () => {
    const lixo = [
      null as unknown as Evento,
      { ...ini(1, 0, 'T1'), dados: 'texto' as unknown as Record<string, unknown> },
      { ...ver(2, 10, 'T1'), dados: null as unknown as Record<string, unknown> },
      { ...ver(3, 10, 'T1'), dados: [1] as unknown as Record<string, unknown> },
      evT(4, 5, 'task.iniciada', {}),
    ];
    let p!: ReturnType<typeof projetar>;
    assert.doesNotThrow(() => { p = projetar(lixo); });
    assert.equal(p.eta, null);
  });

  test('instantaneo-eta-reservada: com orçamento esgotado a linha de ETA continua inteira e dentro de 3.200', () => {
    const es: Evento[] = [
      ...aprovada(1, 'T1', 100), ...aprovada(3, 'T2', 200), ...aprovada(5, 'T3', 300),
      ...Array.from({ length: 3000 }, (_, i) => evT(100 + i, 10000 + i, 'guarda.deny', { alvo: `m${i}-fim` })),
    ];
    const s = projetar(es).instantaneo;
    assert.ok(s.length <= 3200, `instantaneo com ${s.length}`);
    assert.ok(s.split('\n').includes('ETA: 3 tasks, mediana 200 s'));
    assert.match(s, /anterior\(es\) omitido\(s\)/);
  });

  test('instantaneo-nao-corta-surrogate: emoji e acento no alvo não deixam surrogate solto, e o limite é por length', () => {
    const mk = (n: number, alvo: string): Evento => ({ seq: n, ts: `2026-11-02T10:0${n}:00.000Z`, autor: 'a', sessao: 's1', agente: 'o', tipo: 'guarda.deny', dados: { alvo }, hash_anterior: null });
    // 299 'á' + emoji (2 unidades): o corte em 300 cairia entre as metades
    const alvo = 'á'.repeat(299) + '😀' + 'fim';
    const s = projetar([mk(1, alvo)]).instantaneo;
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(s), false, 'surrogate alto solto');
    assert.equal(/(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s), false, 'surrogate baixo solto');
    const muitos = Array.from({ length: 2000 }, (_, i) => mk(i + 1, '😀'.repeat(150)));
    muitos.forEach((e, i) => { e.ts = new Date(T0 + i * 1000).toISOString(); });
    const t = projetar(muitos).instantaneo;
    assert.ok(t.length <= 3200, `instantaneo com ${t.length}`);
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(t), false);
  });

  test('projetar-resumo-total: o resumo conta todos os eventos, não só os que cabem', () => {
    const es: Evento[] = Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, ts: `2026-11-02T10:00:${String(i % 60).padStart(2, '0')}.000Z`, autor: 'a', sessao: 's1', agente: 'o', tipo: 'guarda.deny', dados: { alvo: 'h'.repeat(100) }, hash_anterior: null }));
    assert.deepEqual(projetar(es).resumo, { 'guarda.deny': 500 });
  });
});

describe('lerEstrito (GM-10 T9 r2: leitura sem tolerância para decidir pouso)', () => {
  const grava = (dir: string, n: number, sessao = 's1') => { for (let i = 0; i < n; i++) assert.equal(append(dir, sessao, ev()).ok, true); };

  test('estrito-integro: devolve os mesmos eventos de ler', () => {
    const dir = tmp();
    grava(dir, 3);
    const r = lerEstrito(dir);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.eventos, ler(dir));
  });
  test('estrito-pasta-vazia-ok: sem arquivo de evento não há o que contestar', () => {
    const dir = tmp();
    assert.deepEqual(lerEstrito(dir), { ok: true, eventos: [] });
  });
  test('estrito-pasta-inexistente: falha com motivo', () => {
    const r = lerEstrito(join(tmp(), 'nao-existe'));
    assert.equal(r.ok, false);
  });
  test('estrito-linha-truncada: JSON cortado no fim falha', () => {
    const dir = tmp();
    grava(dir, 2);
    const f = join(dir, 'events.s1.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8') + '{"seq":3,"ts":"2026');
    assert.equal(lerEstrito(dir).ok, false);
  });
  test('estrito-linha-lixo-ou-null: não é objeto de evento', () => {
    for (const lixo of ['null', 'lixo', '[]', '3']) {
      const dir = tmp();
      grava(dir, 1);
      const f = join(dir, 'events.s1.jsonl');
      writeFileSync(f, readFileSync(f, 'utf8') + lixo + '\n');
      assert.equal(lerEstrito(dir).ok, false, lixo);
    }
  });
  test('estrito-lacuna-de-seq: 1, 2, 4 falha mesmo com hash coerente', () => {
    const dir = tmp();
    grava(dir, 3);
    const f = join(dir, 'events.s1.jsonl');
    const ls = readFileSync(f, 'utf8').split('\n');
    const o = JSON.parse(ls[2]);
    o.seq = 4;
    ls[2] = JSON.stringify(o);
    writeFileSync(f, ls.join('\n'));
    assert.equal(lerEstrito(dir).ok, false);
  });
  test('estrito-seq-nao-numerico: falha', () => {
    const dir = tmp();
    grava(dir, 2);
    const f = join(dir, 'events.s1.jsonl');
    const ls = readFileSync(f, 'utf8').split('\n');
    const o = JSON.parse(ls[1]);
    o.seq = '2';
    ls[1] = JSON.stringify(o);
    writeFileSync(f, ls.join('\n'));
    assert.equal(lerEstrito(dir).ok, false);
  });
  test('estrito-hash-que-nao-confere: falha', () => {
    const dir = tmp();
    grava(dir, 3);
    const f = join(dir, 'events.s1.jsonl');
    const ls = readFileSync(f, 'utf8').split('\n');
    const o = JSON.parse(ls[1]);
    o.hash_anterior = 'f'.repeat(64);
    ls[1] = JSON.stringify(o);
    writeFileSync(f, ls.join('\n'));
    assert.equal(lerEstrito(dir).ok, false);
  });
  test('estrito-primeiro-com-hash: o primeiro evento tem hash_anterior nulo', () => {
    const dir = tmp();
    grava(dir, 1);
    const f = join(dir, 'events.s1.jsonl');
    const o = JSON.parse(readFileSync(f, 'utf8').trim());
    o.hash_anterior = 'a'.repeat(64);
    writeFileSync(f, JSON.stringify(o) + '\n');
    assert.equal(lerEstrito(dir).ok, false);
  });
  test('estrito-arquivo-ilegivel: chmod 000 falha, não pula o arquivo', { skip: process.getuid?.() === 0 }, () => {
    const dir = tmp();
    grava(dir, 1, 's1');
    grava(dir, 1, 's2');
    const f = join(dir, 'events.s2.jsonl');
    chmodSync(f, 0o000);
    try {
      assert.equal(lerEstrito(dir).ok, false);
      assert.equal(ler(dir).length, 1); // a leitura tolerante continua pulando: é por isso que ela não decide pouso
    } finally {
      chmodSync(f, 0o644);
    }
  });
  test('estrito-varias-sessoes: cada arquivo tem a própria cadeia', () => {
    const dir = tmp();
    grava(dir, 2, 's1');
    grava(dir, 2, 's2');
    const r = lerEstrito(dir);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.eventos.length, 4);
  });
  test('estrito-depois-de-recuperacao-de-linha-truncada: a cadeia aceita o que ler descarta? não: continua inválida', () => {
    const dir = tmp();
    grava(dir, 2);
    const f = join(dir, 'events.s1.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8') + '{"seq":3,"ts":"2026');
    grava(dir, 1);
    assert.deepEqual(ler(dir).map((e) => e.seq), [1, 2, 4]);
    assert.equal(lerEstrito(dir).ok, false);
  });
});

// GM-11 T5: `append` valida a forma de `dados` por tipo antes do canário; forma inválida não toca o arquivo.
describe('append: forma de dados por tipo (GM-11 T5)', () => {
  const invalida = (): Omit<Evento, 'seq' | 'hash_anterior'> => ev('emenda.proposta', { req: 'REQ-A-1' });

  test('append-forma-invalida-nada-gravado: emenda.proposta sem campos ⇒ forma_invalida, sem arquivo nem lock', () => {
    const dir = tmp();
    const r = append(dir, 's1', invalida());
    assert.equal(r.ok, false);
    assert.match((r as { erro: string }).erro, /^forma_invalida: emenda\.proposta: /);
    assert.equal(existsSync(join(dir, 'events.s1.jsonl')), false, 'arquivo criado');
    assert.equal(existsSync(join(dir, 'events.s1.jsonl.lock')), false, 'lock ficou');
  });

  test('append-forma-valida-grava: desvio com forma completa grava o evento', () => {
    const dir = tmp();
    const r = append(dir, 's1', ev('desvio', { task: 'T1', req: 'REQ-A-1', evidencia: 'teste x', arquivos: [], causa: 'tecnica' }));
    assert.deepEqual(r, { ok: true, gravado: 'evento' });
    assert.equal(ler(dir)[0].tipo, 'desvio');
  });

  test('append-tipo-antigo-segue: tipo da E1/E2 sem regra e ci.resultado com dados não objeto seguem gravados', () => {
    const dir = tmp();
    assert.deepEqual(append(dir, 's1', ev('guarda.deny', { alvo: 'x' })), { ok: true, gravado: 'evento' });
    assert.deepEqual(append(dir, 's1', ev('ci.resultado', 'texto' as unknown as Record<string, unknown>)), { ok: true, gravado: 'evento' });
    assert.equal(ler(dir).length, 2);
  });

  test('append-forma-antes-do-canario: forma inválida com segredo nos dados ⇒ forma_invalida, não diario.recusa', () => {
    const dir = tmp();
    const r = append(dir, 's1', ev('emenda.proposta', { req: 'REQ-A-1', diff: SEGREDOS.ghp }));
    assert.equal(r.ok, false);
    assert.match((r as { erro: string }).erro, /^forma_invalida: /);
    assert.equal(existsSync(join(dir, 'events.s1.jsonl')), false);
  });

  test('append-dados-ausente-x-corrompido: ausente e corrompido dão erros distintos, 0 bytes', () => {
    const dir = tmp();
    const semDados = { ...ev('desvio'), dados: undefined } as unknown as Omit<Evento, 'seq' | 'hash_anterior'>;
    const corrompido = ev('desvio', 'texto' as unknown as Record<string, unknown>);
    const a = append(dir, 's1', semDados) as { ok: false; erro: string };
    const b = append(dir, 's1', corrompido) as { ok: false; erro: string };
    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
    assert.notEqual(a.erro, b.erro);
    assert.match(a.erro, /dados ausente/);
    assert.match(b.erro, /dados corrompido/);
    assert.equal(existsSync(join(dir, 'events.s1.jsonl')), false);
  });

  test('append-pelo-dist: dist/diario.js recusa o mesmo caso sem tocar o arquivo', async () => {
    const dist = await import(join(AQUI, '..', 'dist', 'diario.js'));
    const dir = tmp();
    const r = dist.append(dir, 's1', invalida());
    assert.equal(r.ok, false);
    assert.match(r.erro, /^forma_invalida: emenda\.proposta: /);
    assert.equal(existsSync(join(dir, 'events.s1.jsonl')), false);
  });

  test('append-forma-nao-toma-o-lock: lock alheio fresco ⇒ volta na hora e o lock fica intacto', () => {
    const dir = tmp();
    const lock = join(dir, 'events.s1.jsonl.lock');
    writeFileSync(lock, 'outro-dono');
    const t0 = Date.now();
    const r = append(dir, 's1', invalida());
    const ms = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.match((r as { erro: string }).erro, /^forma_invalida: /);
    assert.ok(ms < 500, `esperou o lock: ${ms} ms`);
    assert.equal(readFileSync(lock, 'utf8'), 'outro-dono', 'lock alheio tocado');
    assert.equal(existsSync(join(dir, 'events.s1.jsonl')), false);
  });

  test('append-forma-nao-quebra-lock-velho: lock alheio velho continua lá', () => {
    const dir = tmp();
    const lock = join(dir, 'events.s1.jsonl.lock');
    writeFileSync(lock, 'outro-dono');
    const r = append(dir, 's1', invalida(), { agora: () => Date.now() + 60_000 });
    assert.equal(r.ok, false);
    assert.match((r as { erro: string }).erro, /^forma_invalida: /);
    assert.equal(readFileSync(lock, 'utf8'), 'outro-dono', 'lock alheio apagado');
  });

  test('append-forma-lock-alheio-pelo-dist: o mesmo pelo dist', async () => {
    const dist = await import(join(AQUI, '..', 'dist', 'diario.js'));
    const dir = tmp();
    const lock = join(dir, 'events.s1.jsonl.lock');
    writeFileSync(lock, 'outro-dono');
    const t0 = Date.now();
    const r = dist.append(dir, 's1', invalida());
    assert.equal(r.ok, false);
    assert.ok(Date.now() - t0 < 500, 'dist esperou o lock');
    assert.equal(readFileSync(lock, 'utf8'), 'outro-dono');
  });

  test('append-erro-sem-segredo: o valor secreto no motivo vira [redigido]', () => {
    const dir = tmp();
    const r = append(dir, 's1', ev('emenda.proposta', { req: SEGREDOS.ghp, diff: 'x' })) as { ok: false; erro: string };
    assert.equal(r.ok, false);
    assert.match(r.erro, /^forma_invalida: /);
    assert.ok(!r.erro.includes(SEGREDOS.ghp), 'segredo voltou no erro');
    assert.ok(r.erro.includes('[redigido]'));
  });

  test('append-erro-cortado: valor longo abaixo de LINHA_MAX ⇒ erro com exatamente 300 caracteres', () => {
    const dir = tmp();
    const r = append(dir, 's1', ev('desvio', { task: 'T1', req: 'x'.repeat(1000) })) as { ok: false; erro: string };
    assert.equal(r.ok, false);
    assert.match(r.erro, /^forma_invalida: desvio: campo `req` inválido: "x{100}/);
    assert.equal(r.erro.length, 300);
  });

  const TOK = 'abcdefghijklmnopqrstuvwxyz';
  type Erro = { ok: false; erro: string };
  const semSegredo = (r: unknown, seg: string, nome: string): void => {
    const e = r as Erro;
    assert.equal(e.ok, false, nome);
    assert.equal(e.erro, 'forma_invalida: [redigido]', nome);
    assert.ok(!e.erro.includes(seg), `${nome}: segredo voltou`);
  };

  test('r3-erro-200kb-sem-regex: dados acima de LINHA_MAX ⇒ redigido, sem regex, sem tocar arquivo', () => {
    for (const req of ['://a:'.repeat(40000), 'x'.repeat(200000), 'Bearer\n' + TOK + 'x'.repeat(200000)]) {
      const dir = tmp();
      const t0 = Date.now();
      const r = append(dir, 's1', ev('desvio', { task: 'T1', req })) as Erro;
      const ms = Date.now() - t0;
      assert.ok(ms < 500, `regex sobre texto sem limite: ${ms} ms`);
      assert.equal(r.erro, 'forma_invalida: [redigido]');
      assert.ok(!r.erro.includes(TOK));
      assert.equal(existsSync(join(dir, 'events.s1.jsonl')), false);
    }
    const r = append(tmp(), 's1', ev('desvio', { task: 'T1', req: 'x', evidencia: '://a:'.repeat(40000) })) as Erro;
    assert.equal(r.erro, 'forma_invalida: [redigido]');
  });

  test('r3-erro-segredo-escapado: controle antes do segredo não escapa do canário (valor e chave)', () => {
    const casos: [string, Record<string, unknown>, string][] = [
      ['Bearer\\n', { req: 'Bearer\n' + TOK }, TOK],
      ['\\tAKIA', { req: '\tAKIAABCDEFGHIJKLMNOP' }, 'AKIAABCDEFGHIJKLMNOP'],
      ['\\nsk-', { req: '\nsk-' + TOK }, 'sk-' + TOK],
      ['\\rghs_', { req: '\rghs_' + TOK }, 'ghs_' + TOK],
      ['\\u0001sk-', { req: '\u0001sk-' + TOK }, 'sk-' + TOK],
      ['chave Bearer\\n', { req: { ['Bearer\n' + TOK]: 1 } }, TOK],
    ];
    for (const [nome, dados, seg] of casos) semSegredo(append(tmp(), 's1', ev('emenda.proposta', dados)), seg, nome);
    semSegredo(append(tmp(), 's1', ev('sombra.consulta', { pergunta_hash: 'a'.repeat(64), req: 'Bearer\t' + TOK })), TOK, 'consulta');
  });

  test('r3-erro-segredo-entre-folhas: url-credencial formada no eco, inclusive cruzando o corte', () => {
    semSegredo(append(tmp(), 's1', ev('emenda.proposta', { req: ['://a', ':segredo@'] })), 'segredo', 'curto');
    semSegredo(append(tmp(), 's1', ev('emenda.proposta', { req: ['y'.repeat(200), '://hostlongo', ':' + 'p'.repeat(60) + '@'] })), 'pppp', 'no corte');
  });

  test('r3-erro-segredo-no-corte: token que cruza o caractere 300 não sai pela metade', () => {
    semSegredo(append(tmp(), 's1', ev('emenda.proposta', { req: 'y'.repeat(229) + 'ghp_' + TOK + 'ABCD' })), 'ghp_abcdefghijk', 'ghp');
  });

  test('r3-erro-nunca-lanca: dados que JSON.stringify não serializa ⇒ forma_invalida redigida', () => {
    const r = append(tmp(), 's1', ev('emenda.proposta', { req: 'REQ-A-1', diff: 1n } as unknown as Record<string, unknown>)) as Erro;
    assert.equal(r.erro, 'forma_invalida: [redigido]');
  });

  test('r3-erro-diagnostico-preservado: sem segredo e curto, o motivo volta inteiro', () => {
    const r = append(tmp(), 's1', ev('emenda.proposta', { req: 'REQ-a-1', diff: 'x' })) as Erro;
    assert.equal(r.erro, 'forma_invalida: emenda.proposta: campo `req` inválido: "REQ-a-1" não casa REQ-<ÁREA>-<n>');
  });

  test('r3-erro-pelo-dist: escape e 200 KB pelo dist', async () => {
    const dist = await import(join(AQUI, '..', 'dist', 'diario.js'));
    semSegredo(dist.append(tmp(), 's1', ev('emenda.proposta', { req: 'Bearer\n' + TOK })), TOK, 'dist escape');
    const t0 = Date.now();
    const r = dist.append(tmp(), 's1', ev('desvio', { task: 'T1', req: '://a:'.repeat(40000) }));
    assert.ok(Date.now() - t0 < 500, 'dist roda regex sem limite');
    assert.equal(r.erro, 'forma_invalida: [redigido]');
  });
});

describe('instantâneo com decisões da Sombra (GM-11 T11)', () => {
  const hx = (i: number): string => createHash('sha256').update(`h${i}`).digest('hex');
  const iso = (i: number): string => new Date(Date.UTC(2026, 10, 9, 10, 0, 0) + i * 1000).toISOString();
  const evD = (seq: number, ts: string, sessao: string, tipo: TipoEvento, dados: unknown): Evento =>
    ({ seq, ts, autor: 'a', sessao, agente: 'o', tipo, dados: dados as Record<string, unknown>, hash_anterior: null });
  const decD = (seq: number, hash: string, resposta: string, extra: Record<string, unknown> = {}, sessao = 's1', ts = iso(seq)): Evento =>
    evD(seq, ts, sessao, 'decisao.sombra', { pergunta_hash: hash, req: 'REQ-A-1', resposta, arquivo: `sombra/${hash}.resposta.md`, pergunta_enviesada: false, fontes: ['spec:1'], ...extra });
  const guarda = (seq: number, alvo: string, sessao = 's1'): Evento => evD(seq, iso(seq), sessao, 'guarda.deny', { alvo });
  const trinta = (): Evento[] => Array.from({ length: 30 }, (_, i) => decD(i + 1, hx(i), 'r'.repeat(200)));
  const linhasDe = (s: string): string[] => s.split('\n');
  /** Do cabeçalho `Decisões da Sombra (` até o rodapé `... k decisão(ões) fora` (ou até a última linha de decisão). */
  const bloco = (s: string): string => {
    const l = linhasDe(s);
    const i = l.findIndex((x) => x.startsWith('Decisões da Sombra'));
    if (i < 0) return '';
    let f = i + 1;
    while (f < l.length && /^\S+ [0-9a-f]{8} /.test(l[f]) && !l[f].startsWith('20')) f++;
    if (l[f]?.startsWith('... ') && /decisão\(ões\) fora$/.test(l[f])) f++;
    return l.slice(i, f).join('\n');
  };

  test('instantaneo-sem-decisao-igual-e2: texto idêntico ao da E2 e objeto só com `decisoes: 0` a mais', () => {
    const es = [guarda(1, 'a-fim'), guarda(2, 'b-fim')];
    const p = projetar(es);
    assert.equal(p.instantaneo, `Diário: 2 evento(s)\nETA: sem dados\n${iso(2)} guarda.deny b-fim\n${iso(1)} guarda.deny a-fim`);
    assert.deepEqual(p, { instantaneo: p.instantaneo, resumo: { 'guarda.deny': 2 }, eta: null, decisoes: 0 });
    assert.deepEqual(projetar([]), { instantaneo: 'Diário: 0 evento(s)\nETA: sem dados', resumo: {}, eta: null, decisoes: 0 });
  });

  test('instantaneo-decisoes-ate-1600: 30 decisões de 200 caracteres, rodapé do pior caso reservado', () => {
    const p = projetar(trinta());
    const b = bloco(p.instantaneo);
    const cab = 'Decisões da Sombra (30):';
    const linha = `REQ-A-1 ${hx(0).slice(0, 8)} ${'r'.repeat(160)}`;
    const reserva = cab.length + 1 + '... 30 decisão(ões) fora'.length + 1;
    const cabem = Math.floor((1600 - reserva) / (linha.length + 1));
    assert.ok(b.length <= 1600, `bloco com ${b.length}`);
    assert.equal(linhasDe(b).length, cabem + 2, 'cabeçalho + linhas + rodapé');
    assert.equal(linhasDe(b)[0], cab);
    assert.equal(linhasDe(b).at(-1), `... ${30 - cabem} decisão(ões) fora`);
    assert.equal(p.decisoes, 30);
  });

  test('instantaneo-rodape-reservado: 9 linhas de 174 cabem sem o rodapé (1.591) e passam de 1.600 com ele; só 8 entram', () => {
    const es = Array.from({ length: 30 }, (_, i) => decD(i + 1, hx(i), 'r'.repeat(156)));
    const b = bloco(projetar(es).instantaneo);
    assert.equal(linhasDe(b).length - 2, 8);
    assert.equal(linhasDe(b).at(-1), '... 22 decisão(ões) fora');
    assert.ok(b.length <= 1600, `bloco com ${b.length}`);
  });

  test('instantaneo-total-3200: 30 decisões + 500 eventos ⇒ ≤ 3.200 e eventos recentes seguem aparecendo', () => {
    const es = [...trinta(), ...Array.from({ length: 500 }, (_, i) => guarda(100 + i, `ev${100 + i}-fim`))];
    const p = projetar(es);
    assert.ok(p.instantaneo.length <= 3200, `total ${p.instantaneo.length}`);
    assert.ok(p.instantaneo.includes('ev599-fim'), 'evento mais recente sumiu');
    assert.ok(p.instantaneo.length > 3000, 'o orçamento dos eventos devia ser usado');
    assert.equal(p.decisoes, 30);
    assert.equal(linhasDe(p.instantaneo)[2].startsWith('Decisões da Sombra (30):'), true, 'bloco logo depois do ETA');
  });

  test('instantaneo-resposta-160: o corte de 160 é na resposta, não na linha', () => {
    const l = linhasDe(projetar([decD(1, hx(1), 'x'.repeat(500))]).instantaneo);
    assert.equal(l[3], `REQ-A-1 ${hx(1).slice(0, 8)} ${'x'.repeat(160)}`);
    assert.equal(l.length, 5, 'cabeçalho, ETA, bloco (2 linhas) e o evento da decisão');
  });

  test('instantaneo-conta-fora: mais recente primeiro e rodapé com a contagem exata', () => {
    const es = Array.from({ length: 10 }, (_, i) => decD(i + 1, hx(i), `resp-${i}-` + 'z'.repeat(190)));
    const l = linhasDe(projetar(es).instantaneo);
    assert.equal(l[2], 'Decisões da Sombra (10):');
    assert.ok(l[3].includes(` ${hx(9).slice(0, 8)} resp-9-`), 'a 1ª linha é a mais recente');
    assert.ok(l[4].includes(` ${hx(8).slice(0, 8)} resp-8-`));
    assert.equal(l[3 + 8], '... 2 decisão(ões) fora');
  });

  test('instantaneo-ordem-ts-sessao-seq: empate de ts desempata por sessao e depois por seq, do maior ao menor', () => {
    const ts = iso(5);
    const es = [decD(1, hx(1), 'a-s', {}, 'sA', ts), decD(1, hx(2), 'b-s', {}, 'sB', ts), decD(2, hx(3), 'c-s', {}, 'sB', ts)];
    const l = linhasDe(projetar(es).instantaneo).slice(3, 6);
    assert.deepEqual(l.map((x) => x.split(' ')[2]), ['c-s', 'b-s', 'a-s']);
  });

  test('instantaneo-ordem-ts-vence-sessao: o ts manda; sessão maior com ts mais antigo vem depois', () => {
    const es = [decD(1, hx(1), 'antiga', {}, 'sB', iso(1)), decD(1, hx(2), 'recente', {}, 'sA', iso(9))];
    assert.deepEqual(linhasDe(projetar(es).instantaneo).slice(3, 5).map((x) => x.split(' ')[2]), ['recente', 'antiga']);
  });

  test('instantaneo-decisoes-vigentes-nao-eventos: duas decisões do mesmo hash contam 1, vence a mais recente', () => {
    const es = [decD(1, hx(1), 'velha'), decD(2, hx(1), 'nova'), decD(3, hx(2), 'outra')];
    const p = projetar(es);
    assert.equal(p.decisoes, 2);
    const l = linhasDe(p.instantaneo);
    assert.equal(l[2], 'Decisões da Sombra (2):');
    assert.equal(l.filter((x) => x.includes(hx(1).slice(0, 8))).length, 1);
    assert.equal(l.some((x) => x.endsWith(' velha')), false);
    assert.ok(l.some((x) => x.endsWith(' nova')));
    assert.equal(projetar([decD(1, hx(1), 'velha'), decD(2, hx(1), 'nova')]).decisoes, 1);
  });

  test('instantaneo-decisao-corrompida-ignorada: forma inválida não conta e não aparece; ausente x corrompido são casos distintos', () => {
    const ruins = [
      evD(1, iso(1), 's1', 'decisao.sombra', undefined),
      evD(2, iso(2), 's1', 'decisao.sombra', 'x'),
      decD(3, hx(3), 'r'.repeat(1001)),
    ];
    const p = projetar(ruins);
    assert.equal(p.decisoes, 0);
    assert.equal(p.instantaneo.includes('Decisões da Sombra'), false);
    const mista = projetar([...ruins, decD(4, hx(4), 'boa')]);
    assert.equal(mista.decisoes, 1);
    assert.ok(linhasDe(mista.instantaneo).includes('Decisões da Sombra (1):'));
    // corrompido (fora de ordem) ≠ ausente
    const fora = projetar([decD(1, hx(1), 'a'), guarda(1, 'dup')]);
    assert.notEqual(fora.instantaneo.includes('diário fora de ordem'), projetar([decD(1, hx(1), 'a'), guarda(2, 'ok')]).instantaneo.includes('diário fora de ordem'));
  });

  test('instantaneo-diario-fora-de-ordem-avisa: seq repetido, ts ilegível ou sessão ausente ⇒ linha única e decisoes 0', () => {
    const casos: [string, Evento[]][] = [
      ['seq repetido de outro tipo', [decD(1, hx(1), 'a'), guarda(1, 'dup')]],
      ['ts ilegível', [decD(1, hx(1), 'a'), evD(2, 'ontem', 's1', 'guarda.deny', { alvo: 'x' })]],
      ['sem sessão', [decD(1, hx(1), 'a'), { ...guarda(2, 'x'), sessao: undefined as unknown as string }]],
    ];
    for (const [nome, es] of casos) {
      const p = projetar(es);
      const l = linhasDe(p.instantaneo);
      assert.equal(l[2], 'Decisões da Sombra: diário fora de ordem', nome);
      assert.equal(p.decisoes, 0, nome);
      assert.equal(p.instantaneo.includes('Decisões da Sombra ('), false, nome);
    }
  });

  test('instantaneo-entrada-embaralhada-igual: mesma saída em qualquer ordem de entrada', () => {
    const es = [
      decD(1, hx(1), 'um', {}, 'sA', iso(1)), decD(2, hx(2), 'dois', {}, 'sA', iso(2)), decD(1, hx(3), 'tres', {}, 'sB', iso(3)),
      guarda(3, 'g1-fim', 'sA'), guarda(2, 'g2-fim', 'sB'),
    ];
    const ref = projetar(es);
    assert.equal(ref.decisoes, 3);
    for (const v of [[...es].reverse(), [es[2], es[4], es[0], es[3], es[1]], [es[1], es[0], es[3], es[2], es[4]]]) {
      const p = projetar(v);
      assert.equal(p.instantaneo, ref.instantaneo);
      assert.equal(p.decisoes, 3);
    }
  });

  test('instantaneo-quebra-unicode-vira-espaco: controle, DEL, U+2028 e U+2029 viram espaço, linha única', () => {
    const r = 'a\nb\rc\td\u0000e\u007ff g h\u001fi\r\n\r\nj';
    const l = linhasDe(projetar([decD(1, hx(1), r)]).instantaneo);
    assert.equal(l.length, 5, 'cabeçalho, ETA, bloco (2 linhas) e o evento da decisão: nenhuma quebra extra');
    assert.equal(l[3], `REQ-A-1 ${hx(1).slice(0, 8)} a b c d e f g h i j`);
  });

  test('instantaneo-corte-sem-meio-par: corte em 160 caindo num emoji não deixa meio par', () => {
    const r = 'x'.repeat(159) + '😀' + 'yyy';
    const l = linhasDe(projetar([decD(1, hx(1), r)]).instantaneo);
    assert.equal(l[3], `REQ-A-1 ${hx(1).slice(0, 8)} ${'x'.repeat(159)}`);
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(l[3]), false);
    const inteiro = projetar([decD(1, hx(1), 'x'.repeat(158) + '😀')]).instantaneo;
    assert.ok(inteiro.includes('x'.repeat(158) + '😀'), 'par inteiro dentro de 160 fica');
  });

  test('instantaneo-ancora-longa-cortada: âncora de 500 caracteres vira 64; âncora de task usa o prefixo task:', () => {
    const req = 'REQ-' + 'A'.repeat(500) + '-1';
    const l = linhasDe(projetar([decD(1, hx(1), 'ok', { req })]).instantaneo);
    assert.equal(l[3], `${req.slice(0, 64)} ${hx(1).slice(0, 8)} ok`);
    const t = decD(2, hx(2), 'tk', { task: 'T3', req: undefined });
    delete (t.dados as Record<string, unknown>).req;
    assert.equal(linhasDe(projetar([t]).instantaneo)[3], `task:T3 ${hx(2).slice(0, 8)} tk`);
  });

  test('instantaneo-mostra-decisao-gravada: decisão gravada pelo append real do dist aparece na projeção do dist', async () => {
    // `sombra.mjs registrar` (T7) ainda não existe neste ramo: o append real do dist grava o mesmo evento `decisao.sombra`.
    const dist = await import(join(AQUI, '..', 'dist', 'diario.js'));
    const dir = tmp();
    const r = dist.append(dir, 's1', { ts: iso(1), autor: 'a', sessao: 's1', agente: 'orquestrador', tipo: 'decisao.sombra',
      dados: { pergunta_hash: hx(7), req: 'REQ-A-1', resposta: 'sim, com a emenda', arquivo: `sombra/${hx(7)}.resposta.md`, pergunta_enviesada: false, fontes: ['spec:1'] } });
    assert.equal(r.ok, true);
    const p = dist.projetar(dist.ler(dir));
    assert.equal(p.decisoes, 1);
    assert.ok(p.instantaneo.split('\n').includes(`REQ-A-1 ${hx(7).slice(0, 8)} sim, com a emenda`));
  });

  test('instantaneo-pouso-aceita-pior-caso: textoRetomada do dist não devolve null com 30 decisões e 500 eventos', async () => {
    const dist = await import(join(AQUI, '..', 'dist', 'diario.js'));
    const pouso = await import(join(AQUI, '..', 'dist', 'pouso.js'));
    const dir = tmp();
    for (let i = 0; i < 30; i++) {
      const r = dist.append(dir, 's1', { ts: iso(i), autor: 'a', sessao: 's1', agente: 'orquestrador', tipo: 'decisao.sombra',
        dados: { pergunta_hash: hx(i), req: 'REQ-A-1', resposta: 'r'.repeat(200), arquivo: `sombra/${hx(i)}.resposta.md`, pergunta_enviesada: false, fontes: ['spec:1'] } });
      assert.equal(r.ok, true);
    }
    for (let i = 0; i < 500; i++) assert.equal(dist.append(dir, 's1', { ts: iso(100 + i), autor: 'a', sessao: 's1', agente: 'orquestrador', tipo: 'guarda.deny', dados: { alvo: `host-${i}.exemplo.com` } }).ok, true);
    const p = dist.projetar(dist.ler(dir));
    assert.equal(p.decisoes, 30);
    assert.ok(p.instantaneo.length <= 3200);
    const t = pouso.textoRetomada(p.instantaneo);
    assert.notEqual(t, null);
    assert.ok(t.includes('Decisões da Sombra (30):'));
  });
});

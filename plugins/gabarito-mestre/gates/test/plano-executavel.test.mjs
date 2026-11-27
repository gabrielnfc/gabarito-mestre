// GM-21 T3 (REQ-MIG-1, DT4): conferirExecutavel e a régua de suíte do gate. O CLI real está em loop-cli-5.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conferirExecutavel, escopo } from '../scripts/plano-executavel.mjs';
import { normalizarSuites } from '../scripts/gate-task.mjs';

const raizNova = () => {
  const r = mkdtempSync(join(tmpdir(), 'plano-exec-'));
  mkdirSync(join(r, 'src'));
  return r;
};
const CFG = { gates: { suites: ['npm test'] } };
const MUT_OK = [{ nome: 'm1', arquivo: 'src/a.txt', de: 'a', para: 'b', teste: 'npm test' }];
const plano = (task) => ({ entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/a.txt'], ...task }] });
const conferir = (raiz, task, extra = {}) => conferirExecutavel({ raiz, plano: plano(task), eventos: [], cfg: CFG, ...extra });
const motivos = (r) => r.problemas.map((p) => `${p.task ?? 'config'}|${p.campo}|${p.motivo}`);

describe('conferirExecutavel (pura sobre o disco)', () => {
  test('exporta normalizarSuites: a régua de suíte do gate, a mesma do conferir', () => {
    assert.equal(typeof normalizarSuites, 'function');
    assert.deepEqual(normalizarSuites(['npm test']).suites.map((s) => s.cmd), ['npm test']);
  });

  test('plano-sem-mutacoes-nem-teste-afetado-passa', () => {
    const r = conferir(raizNova(), {});
    assert.deepEqual(r.problemas, []);
    assert.equal(r.ok, true);
  });

  test('mutacoes-caminho-valido-passa: lista com cwd opcional em texto', () => {
    const raiz = raizNova();
    writeFileSync(join(raiz, 'mut.json'), JSON.stringify([{ ...MUT_OK[0], cwd: 'sub' }]));
    assert.deepEqual(conferir(raiz, { mutacoes: 'mut.json' }).problemas, []);
  });

  test('mutacoes-recusadas: texto livre, inexistente, fora da raiz, JSON inválido, vazia, sem para, cwd não texto, raiz da pasta', () => {
    const raiz = raizNova();
    writeFileSync(join(raiz, 'torto.json'), '{nao');
    writeFileSync(join(raiz, 'vazia.json'), '[]');
    writeFileSync(join(raiz, 'objeto.json'), '{}');
    writeFileSync(join(raiz, 'sem-para.json'), JSON.stringify([{ nome: 'm', arquivo: 'src/a.txt', de: 'a', teste: 't' }]));
    writeFileSync(join(raiz, 'cwd-num.json'), JSON.stringify([{ ...MUT_OK[0], cwd: 3 }]));
    const casos = {
      'mutar a função X e ver o teste cair': 'mutacoes_texto_livre',
      'nao-existe.json': 'mutacoes_inexistente',
      '../fora.json': 'mutacoes_fora_da_raiz',
      '/etc/hosts': 'mutacoes_fora_da_raiz',
      'torto.json': 'mutacoes_json',
      'vazia.json': 'mutacoes_vazia',
      'objeto.json': 'mutacoes_vazia',
      'sem-para.json': 'mutacoes_item',
      'cwd-num.json': 'mutacoes_item',
      src: 'mutacoes_nao_arquivo',
    };
    for (const [valor, rotulo] of Object.entries(casos)) {
      const r = conferir(raiz, { mutacoes: valor });
      assert.equal(r.ok, false, valor);
      assert.equal(r.problemas.length, 1, `${valor}: ${motivos(r)}`);
      assert.equal(r.problemas[0].task, 'T1');
      assert.equal(r.problemas[0].campo, 'mutacoes');
      assert.equal(r.problemas[0].codigo, rotulo, `${valor}: ${r.problemas[0].motivo}`);
    }
  });

  test('mutacoes-nao-texto: número, lista, vazio', () => {
    for (const v of [3, ['a.json'], '']) {
      const r = conferir(raizNova(), { mutacoes: v });
      assert.deepEqual(r.problemas.map((p) => p.codigo), ['mutacoes_tipo'], JSON.stringify(v));
    }
  });

  test('mutacoes-item-arquivo-fora-do-escopo: o motivo cita o item e o arquivo', () => {
    const raiz = raizNova();
    writeFileSync(join(raiz, 'mut.json'), JSON.stringify([MUT_OK[0], { ...MUT_OK[0], nome: 'm2', arquivo: 'src/outro.txt' }]));
    const r = conferir(raiz, { mutacoes: 'mut.json' });
    assert.equal(r.problemas.length, 1);
    assert.equal(r.problemas[0].codigo, 'mutacoes_escopo');
    assert.match(r.problemas[0].motivo, /m2.*src\/outro\.txt/);
  });

  test('mutacoes-item-cada-campo-texto: nome, arquivo, de e teste ausentes ou não texto, cada um um problema', () => {
    const raiz = raizNova();
    for (const campo of ['nome', 'arquivo', 'de', 'teste', 'para']) {
      writeFileSync(join(raiz, 'm.json'), JSON.stringify([{ ...MUT_OK[0], [campo]: 7 }]));
      const r = conferir(raiz, { mutacoes: 'm.json' });
      assert.ok(r.problemas.some((p) => p.codigo === 'mutacoes_item' && p.motivo.includes(campo)), `${campo}: ${motivos(r)}`);
    }
  });

  test('teste-afetado-caminho-sem-exec-recusa: arquivo existente sem bit de execução, com a sugestão fixa', () => {
    const raiz = raizNova();
    mkdirSync(join(raiz, 'tests'));
    writeFileSync(join(raiz, 'tests/a.test.ts'), 'x');
    const r = conferir(raiz, { teste_afetado: 'tests/a.test.ts' });
    assert.deepEqual(r.problemas.map((p) => [p.task, p.campo, p.codigo]), [['T1', 'teste_afetado', 'teste_afetado_caminho']]);
    assert.ok(r.problemas[0].motivo.includes('use o comando, ex.: "npx vitest run tests/a.test.ts"'), r.problemas[0].motivo);
  });

  test('teste-afetado-comando-ou-executavel-passa: comando de shell, caminho inexistente e arquivo com bit de execução', () => {
    const raiz = raizNova();
    writeFileSync(join(raiz, 'roda.sh'), '#!/bin/sh\n');
    chmodSync(join(raiz, 'roda.sh'), 0o755);
    for (const v of ['npx vitest run tests/a.test.ts', 'tests/nao-existe.test.ts', 'roda.sh']) {
      assert.deepEqual(conferir(raiz, { teste_afetado: v }).problemas, [], v);
    }
  });

  test('teste-afetado-nao-texto-ou-vazio: recusa', () => {
    for (const v of [5, '', '   ', ['npm test']]) {
      assert.deepEqual(conferir(raizNova(), { teste_afetado: v }).problemas.map((p) => p.codigo), ['teste_afetado_tipo'], JSON.stringify(v));
    }
  });

  test('suites-em-texto-aceitas: texto e objeto com cmd passam; é a régua do gate (normalizarSuites)', () => {
    const raiz = raizNova();
    for (const suites of [['npm test'], [{ nome: 'unit', cmd: 'npm test', cwd: 'x', serial: true }], ['a', { cmd: 'b' }]]) {
      assert.deepEqual(conferirExecutavel({ raiz, plano: plano({}), eventos: [], cfg: { gates: { suites } } }).problemas, [], JSON.stringify(suites));
    }
  });

  test('suites-recusadas-pela-regua-do-gate: ausente, vazia, sem cmd, objeto sem cmd (MINOR-2 da T2), não lista, config nula', () => {
    const raiz = raizNova();
    const casos = [[undefined, 'gates_suites_ausente'], [[], 'gates_suites_vazia'], [[{ nome: 'x' }], 'gates_suites_item'],
      [[{ nome: 'u', cmd: '  ' }], 'gates_suites_item'], [['ok', { nome: 'y' }], 'gates_suites_item'], ['npm test', 'gates_suites_item']];
    for (const [suites, codigo] of casos) {
      const r = conferirExecutavel({ raiz, plano: plano({}), eventos: [], cfg: suites === undefined ? { gates: {} } : { gates: { suites } } });
      assert.ok(r.problemas.length >= 1 && r.problemas.every((p) => p.task === null && p.campo === 'gates.suites'), `${JSON.stringify(suites)}: ${motivos(r)}`);
      assert.equal(r.problemas[0].codigo, codigo, JSON.stringify(suites));
    }
    const nula = conferirExecutavel({ raiz, plano: plano({}), eventos: [], cfg: null });
    assert.equal(nula.problemas[0].codigo, 'gates_suites_ausente');
  });

  test('config-vale-para-toda-task: cada task conferida lista o problema da config', () => {
    const raiz = raizNova();
    const p = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }, { id: 'T2', deps: [], arquivos: ['b'] }] };
    const r = conferirExecutavel({ raiz, plano: p, eventos: [], cfg: {} });
    assert.deepEqual(Object.keys(r.porTask).sort(), ['T1', 'T2']);
    for (const t of ['T1', 'T2']) assert.equal(r.porTask[t].some((x) => x.campo === 'gates.suites'), true);
  });

  test('escopo-por-emenda-e-diretorio (puro): diretório casa por prefixo; arquivo exato não casa irmão com mesmo prefixo', () => {
    const raiz = raizNova();
    const p = plano({ arquivos: ['src', 'doc/x.md'], mutacoes: 'm.json' });
    writeFileSync(join(raiz, 'm.json'), JSON.stringify([{ ...MUT_OK[0], arquivo: 'src/fundo/a.txt' }, { ...MUT_OK[0], nome: 'm2', arquivo: 'doc/x.md' }]));
    assert.deepEqual(conferirExecutavel({ raiz, plano: p, eventos: [], cfg: CFG }).problemas, []);
    writeFileSync(join(raiz, 'm.json'), JSON.stringify([{ ...MUT_OK[0], arquivo: 'doc/x.mdx' }]));
    assert.equal(conferirExecutavel({ raiz, plano: p, eventos: [], cfg: CFG }).problemas[0].codigo, 'mutacoes_escopo');
    assert.deepEqual(escopo(raiz, ['src', 'doc/x.md', 'novo']), ['src/', 'doc/x.md', 'novo']);
  });

  test('conferir-ignora-integrada-e-fora: só as tasks não integradas nem fora são conferidas', () => {
    const raiz = raizNova();
    const p = { entrega: 'GM-10', tasks: ['T1', 'T2', 'T3', 'T4'].map((id) => ({ id, deps: [], arquivos: ['src/a.txt'], mutacoes: 'texto livre' })) };
    const ev = (seq, tipo, dados) => ({ seq, ts: new Date(Date.UTC(2026, 1, 1, 0, 0, seq)).toISOString(), autor: 't', sessao: 'loop', agente: 'orquestrador', tipo, dados });
    const sha = 'a'.repeat(40);
    const eventos = [
      ev(1, 'task.iniciada', { task: 'T1', papel: 'implementador' }), ev(2, 'task.concluida', { task: 'T1', sha }),
      ev(3, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }), ev(4, 'task.integrada', { task: 'T1', sha }),
      ev(5, 'task.fora', { task: 'T2', como: 'cortada', motivo: 'x', origem: 'dono' }), ev(6, 'task.fora', { task: 'T3', como: 'adiada', motivo: 'x', origem: 'dono' }),
    ];
    const r = conferirExecutavel({ raiz, plano: p, eventos, cfg: CFG });
    assert.deepEqual(Object.keys(r.porTask), ['T4']);
    assert.deepEqual([...new Set(r.problemas.map((x) => x.task))], ['T4']);
  });

  test('mutacoes-symlink-para-fora-recusa: o caminho relativo que resolve para fora da raiz pelo symlink', () => {
    const raiz = raizNova();
    const fora = mkdtempSync(join(tmpdir(), 'plano-exec-fora-'));
    writeFileSync(join(fora, 'm.json'), JSON.stringify(MUT_OK));
    symlinkSync(join(fora, 'm.json'), join(raiz, 'link.json'));
    assert.equal(conferir(raiz, { mutacoes: 'link.json' }).problemas[0].codigo, 'mutacoes_fora_da_raiz');
  });
});

/**
 * T21 (GM-14, REQ-ONB-2, local do painel): `onboarding-painel.mjs` (`ofertaLocal`, `gravarLocal`) e o CLI `onboarding.mjs painel`.
 *
 * Tudo em mkdtemp. Texto da oferta: o simples de spec:70 (decisão Sombra 91a18fea), sem palavra do glossário proibido.
 * Costura (P9): `cli-oferta-e-grava-pelo-despachante` atravessa onboarding.mjs → onboarding-painel.mjs.
 *
 * MUTAÇÕES (task-21-mut.json): M-T21b grava sem merge, M-T21c padrão `acima`, M-T21d oferta sem a frase do limite e as do arquivo.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ofertaLocal, gravarLocal } from '../scripts/onboarding-painel.mjs';
import { Falha } from '../scripts/onboarding-foco.mjs';
import { acharProibidos } from '../lib/glossario.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });
const novoDir = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'gm-painel-'))); limpar.push(d); return d; };
const CFG = 'harness.config.json';
const gravarCfg = (raiz, texto) => writeFileSync(join(raiz, CFG), texto);
const lerCfg = (raiz) => JSON.parse(readFileSync(join(raiz, CFG), 'utf8'));
const FRASE_LIMITE = 'a plataforma só o põe sozinho com 144 colunas ou mais (ao lado da conversa em tela cheia, acima da linha de digitar nas outras); abaixo disso o painel avisa e ele abre quando você pede /gabarito painel, em qualquer largura';
const cli = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { rc: r.status, saida: JSON.parse(r.stdout) };
};

describe('oferta (só lê)', () => {
  test('local-oferta-padrao-lateral: duas opções, padrão lateral, "ao lado" primeiro', () => {
    const o = ofertaLocal(novoDir());
    assert.equal(o.oferecer, true);
    assert.equal(o.default, 'lateral');
    assert.deepEqual(o.opcoes.map((x) => x.valor), ['lateral', 'acima']);
    assert.match(o.opcoes[0].rotulo, /^ao lado da conversa/);
    assert.match(o.opcoes[0].rotulo, /padrão/);
    assert.equal(o.opcoes[1].rotulo, 'acima da linha de digitar');
    for (const x of o.opcoes) assert.ok(x.rotulo.length <= 60, x.rotulo);
  });

  test('oferta-local-com-limite: o texto traz as palavras de spec:70, a pergunta e as duas opções', () => {
    const o = ofertaLocal(novoDir());
    assert.ok(o.texto.includes(FRASE_LIMITE), o.texto);
    assert.match(o.texto, /^Onde quer o painel\?/);
    assert.ok(o.texto.includes('ao lado da conversa') && o.texto.includes('acima da linha de digitar'), o.texto);
    assert.match(o.texto, /padrão/);
    assert.ok(o.texto.length <= 320, `${o.texto.length}`);
  });

  test('oferta-sem-termo-tecnico: nenhum texto oferecido tem palavra proibida, nem a frase técnica da T21', () => {
    const o = ofertaLocal(novoDir());
    for (const t of [o.texto, ...o.opcoes.map((x) => x.rotulo)]) {
      assert.deepEqual(acharProibidos(t), [], t);
      assert.doesNotMatch(t, /Pane|≥|\bPR\b/);
    }
  });

  test('oferta-nao-grava: nada muda na árvore, com config ausente ou existente', () => {
    const a = novoDir();
    ofertaLocal(a);
    assert.deepEqual(readdirSync(a), []);
    const b = novoDir();
    gravarCfg(b, '{"x": 1}\n');
    ofertaLocal(b);
    assert.equal(readFileSync(join(b, CFG), 'utf8'), '{"x": 1}\n');
  });

  test('local-ja-gravado-nao-oferece: lateral e acima, cada um com o motivo', () => {
    for (const v of ['lateral', 'acima']) {
      const d = novoDir();
      gravarCfg(d, JSON.stringify({ painel: { local: v } }));
      const o = ofertaLocal(d);
      assert.equal(o.oferecer, false, v);
      assert.equal(o.motivo, 'ja_gravado');
      assert.equal(o.atual, v);
    }
  });

  test('painel-sem-local-ou-local-estranho-oferece: painel existe mas sem local válido', () => {
    for (const painel of [{}, { local: 'esquerda' }, { local: null }, { outra: 1 }]) {
      const d = novoDir();
      gravarCfg(d, JSON.stringify({ painel }));
      assert.equal(ofertaLocal(d).oferecer, true, JSON.stringify(painel));
    }
  });

  test('config-ausente-x-corrompido (oferta): ausente oferece; corrompido não oferece e diz por quê', () => {
    assert.equal(ofertaLocal(novoDir()).oferecer, true);
    for (const ruim of ['{', '[]', '"x"', '{"a":1,}', '']) {
      const d = novoDir();
      gravarCfg(d, ruim);
      const o = ofertaLocal(d);
      if (ruim === '') { assert.equal(o.oferecer, true, 'vazio ⇒ nada a perder'); continue; }
      assert.equal(o.oferecer, false, ruim);
      assert.equal(o.motivo, 'config_corrompido', ruim);
    }
  });
});

describe('gravar', () => {
  test('local-grava-por-merge: só painel.local muda; demais chaves e a indentação ficam iguais', () => {
    const d = novoDir();
    const antes = '{\n\t"nome": "x",\n\t"entrega": { "base": "main", "n": [1, 2] },\n\t"painel": { "largura": 120 }\n}\n';
    gravarCfg(d, antes);
    const r = gravarLocal(d, 'acima');
    assert.equal(r.ok, true);
    assert.equal(r.local, 'acima');
    assert.equal(r.mudou, true);
    const depois = lerCfg(d);
    assert.deepEqual(depois, { nome: 'x', entrega: { base: 'main', n: [1, 2] }, painel: { largura: 120, local: 'acima' } });
    assert.deepEqual(Object.keys(depois), ['nome', 'entrega', 'painel']);
    assert.equal(readFileSync(join(d, CFG), 'utf8'), '{\n\t"nome": "x",\n\t"entrega": {\n\t\t"base": "main",\n\t\t"n": [\n\t\t\t1,\n\t\t\t2\n\t\t]\n\t},\n\t"painel": {\n\t\t"largura": 120,\n\t\t"local": "acima"\n\t}\n}\n');
  });

  test('local-grava-lateral-sem-painel: cria a seção; config ausente cria o arquivo só com painel.local', () => {
    const a = novoDir();
    gravarCfg(a, '{"x":1}');
    gravarLocal(a, 'lateral');
    assert.deepEqual(lerCfg(a), { x: 1, painel: { local: 'lateral' } });
    const b = novoDir();
    const r = gravarLocal(b, 'lateral');
    assert.equal(r.ok, true);
    assert.deepEqual(lerCfg(b), { painel: { local: 'lateral' } });
    assert.deepEqual(readdirSync(b), [CFG], 'sem tmp esquecido');
  });

  test('local-igual-nao-reescreve: mesmo valor ⇒ mudou:false e bytes intactos', () => {
    const d = novoDir();
    const txt = '{"painel":{"local":"acima"},   "z":1}';
    gravarCfg(d, txt);
    const r = gravarLocal(d, 'acima');
    assert.equal(r.mudou, false);
    assert.equal(readFileSync(join(d, CFG), 'utf8'), txt);
  });

  test('local-invalido-recusa: valor fora da lista não grava nada', () => {
    for (const ruim of ['', 'esquerda', 'LATERAL', 'Acima', null, undefined, 1, ['lateral']]) {
      const d = novoDir();
      gravarCfg(d, '{"x":1}');
      assert.throws(() => gravarLocal(d, ruim), (e) => e instanceof Falha && e.erro === 'local_invalido', String(ruim));
      assert.equal(readFileSync(join(d, CFG), 'utf8'), '{"x":1}');
    }
  });

  test('config-ausente-x-corrompido (grava): corrompido recusa sem gravar; painel que não é objeto também', () => {
    for (const ruim of ['{', '[]', '{"a":1,}', '{"painel": 3}', '{"painel": []}', '{"painel": null}']) {
      const d = novoDir();
      gravarCfg(d, ruim);
      assert.throws(() => gravarLocal(d, 'acima'), (e) => e instanceof Falha && e.erro === 'config_corrompido', ruim);
      assert.equal(readFileSync(join(d, CFG), 'utf8'), ruim, 'bytes intactos');
      assert.deepEqual(readdirSync(d), [CFG], 'sem tmp');
    }
  });

  test('frase-e-como-trocar: confirma o local escolhido e cita "/gabarito painel" sem palavra proibida', () => {
    const r = gravarLocal(novoDir(), 'acima');
    assert.match(r.frase, /acima da linha de digitar/);
    assert.match(r.frase, /\/gabarito painel/);
    assert.deepEqual(acharProibidos(r.frase), []);
    const l = gravarLocal(novoDir(), 'lateral');
    assert.match(l.frase, /ao lado da conversa/);
    assert.doesNotMatch(l.frase, /acima da linha de digitar/, 'a frase do lateral não fala do outro local');
  });
});

describe('CLI (despacho)', () => {
  test('cli-oferta-e-grava-pelo-despachante: sem --local só oferece; com --local grava; já gravado ⇒ não oferece', () => {
    const d = novoDir();
    gravarCfg(d, '{"x":1}\n');
    const o = cli(['painel', '--root', d]);
    assert.equal(o.rc, 0);
    assert.equal(o.saida.ok, true);
    assert.equal(o.saida.oferecer, true);
    assert.equal(o.saida.default, 'lateral');
    assert.equal(readFileSync(join(d, CFG), 'utf8'), '{"x":1}\n', 'oferta não grava');
    const g = cli(['painel', '--root', d, '--local', 'acima']);
    assert.equal(g.rc, 0);
    assert.equal(g.saida.local, 'acima');
    assert.deepEqual(lerCfg(d), { x: 1, painel: { local: 'acima' } });
    assert.equal(cli(['painel', '--root', d]).saida.oferecer, false);
  });

  test('cli-invalido-e-corrompido: --local fora da lista, sem valor, ou config corrompido ⇒ ok:false, rc 1, nada gravado', () => {
    const d = novoDir();
    gravarCfg(d, '{"x":1}');
    for (const args of [['--local', 'meio'], ['--local'], ['--local', '']]) {
      const r = cli(['painel', '--root', d, ...args]);
      assert.equal(r.rc, 1, args.join(' '));
      assert.equal(r.saida.ok, false);
      assert.equal(r.saida.erro, 'local_invalido');
    }
    assert.equal(readFileSync(join(d, CFG), 'utf8'), '{"x":1}');
    const c = novoDir();
    gravarCfg(c, '{');
    const r = cli(['painel', '--root', c, '--local', 'acima']);
    assert.equal(r.rc, 1);
    assert.equal(r.saida.erro, 'config_corrompido');
    assert.equal(readFileSync(join(c, CFG), 'utf8'), '{');
  });

  test('cli-uso-cita-painel: o texto de uso conhece o subcomando', () => {
    const r = spawnSync(process.execPath, [CLI, 'nada'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /painel --root <d> \[--local lateral\|acima\]/);
    assert.equal(existsSync(CLI), true);
  });
});

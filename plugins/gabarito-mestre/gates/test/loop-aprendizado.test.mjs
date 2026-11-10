/**
 * `loop.mjs aprendizado` e `aprendizados` pela borda (GM-13 T8, REQ-APR-1, REQ-APR-2, REQ-APR-3): CLI real, repositório git temporário por caso.
 * Ordem do CLI (Sombra P1-c): uso (rc 2) → conversão (`argumento_invalido`) → canário (`segredo_no_aprendizado`, antes de qualquer leitura:
 * `append` com canário GRAVA `diario.recusa`) → forma → `ls-files` literal → leitura da árvore → `gravar(…, antes)`.
 * Contrato de falha: ausente (diário sem eventos, árvore sem a pasta) ≠ corrompido (linha torta, cadeia quebrada).
 *
 * MUTAÇÕES PRESCRITAS (task-8-mut.json): M-APR1b pula `ls-files` · M-T8a canário depois do `gravar` · M-T8b sem `--literal-pathspecs`
 * · M-T8c `nada` aceita evento existente · M-APR3a (em loop-cli.test.mjs) M no brief · M-APR1c (formas) D sem evidência.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { PAPEIS } from '../dist/formas.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'loop.mjs');
const FONTE_LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
const FONTE_APR = join(AQUI, '..', 'scripts', 'loop-aprendizado.mjs');

const raizes = [];
after(() => { for (const d of raizes) rmSync(d, { recursive: true, force: true }); });
const novoTmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'loop-apr-'))); raizes.push(d); return d; };
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const PLANO = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }] };
const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
const SHA = 'a'.repeat(64);

/** Repositório com a branch de PBI, `README.md` e `gates/src/x.ts` versionados e `plano.json` da GM-10. */
function ambiente({ branch = 'enabler/GM-10-loop', plano = PLANO } = {}) {
  const dir = novoTmp();
  g(dir, 'init', '-q', '-b', branch);
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'gates', 'src'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'x\n');
  writeFileSync(join(dir, 'gates', 'src', 'x.ts'), 'x\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  if (plano !== null) writeFileSync(join(entregas, 'plano.json'), typeof plano === 'string' ? plano : JSON.stringify(plano));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)/.test(k)) delete env[k];
  let n = 0;
  const amb = {
    dir, entregas, arvore: join(dir, '.harness', 'entregas'),
    cli(args, { cwd = dir } = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
      return { rc: r.status, j, out: r.stdout, err: r.stderr };
    },
    eventos: () => diario.ler(entregas),
    tipos: () => diario.ler(entregas).map((e) => e.tipo),
    /** Todas as linhas de todos os jsonl da entrega (inclui `diario.recusa`, que `diario.ler` também devolve). */
    linhas: () => readdirSync(entregas).filter((f) => /^events\..+\.jsonl$/.test(f)).flatMap((f) => readFileSync(join(entregas, f), 'utf8').split('\n').filter(Boolean)),
    semear(lista, { dirEntrega = entregas, sessao = 'loop' } = {}) {
      for (const [tipo, dados, s = sessao] of lista) {
        n += 1;
        const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
        const r = diario.append(dirEntrega, s, { ts, autor: 't@t', sessao: s, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    /** Entrega vizinha na árvore (`GM-<n>`), com diário legível. */
    vizinha(id, lista) {
      const d = join(dir, '.harness', 'entregas', id);
      mkdirSync(d, { recursive: true });
      amb.semear(lista, { dirEntrega: d });
      return d;
    },
    /** Entrega vizinha com diário torto (linha que não é JSON). */
    vizinhaTorta(id) {
      const d = join(dir, '.harness', 'entregas', id);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'events.loop.jsonl'), 'isto nao e json\n');
      return d;
    },
  };
  return amb;
}

const CI = ['ci.resultado', { verde: true }];
const PARAR = ['loop.parar', { motivo: 'ci_vermelho' }];
const DONO = ['dono.mensagem', { sha256: SHA, chars: 3 }, 'dono'];
const BASE = ['E', 'D', '--regra', 'rode o build antes do teste', '--entra-em', 'instantaneo', '--eventos', 'loop:1'];
const apr = (...extra) => ['aprendizado', ...BASE, ...extra];
const semEfeito = (amb) => amb.linhas().join('\n');

describe('aprendizado: grava', () => {
  test('aprendizado-d-com-evento-grava: o que foi digitado é o que fica no diário (lido campo a campo)', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const r = amb.cli(['aprendizado', 'A', 'D', '--regra', 'confira o gate antes de integrar', '--entra-em', 'instantaneo,brief:revisor', '--eventos', 'loop:1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    const e = amb.eventos().find((x) => x.tipo === 'aprendizado');
    assert.ok(e, 'gravou');
    assert.deepEqual(e.dados, {
      tipo: 'A', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] },
      regra: 'confira o gate antes de integrar', entra_em: ['instantaneo', 'brief:revisor'],
    });
    assert.equal(e.sessao, 'loop');
    assert.equal(e.seq, 2);
    assert.equal(r.j.evento.regra, 'confira o gate antes de integrar');
    assert.equal(r.j.evento.tipo_evento, 'aprendizado');
  });

  test('aprendizado-m-sem-evidencia-grava: M não precisa de evidência (evidencia {})', () => {
    const amb = ambiente();
    const r = amb.cli(['aprendizado', 'E', 'M', '--regra', 'suspeita sem medida', '--entra-em', 'spec']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().find((x) => x.tipo === 'aprendizado');
    assert.equal(e.dados.status, 'M');
    assert.deepEqual(e.dados.evidencia, {});
    assert.equal(e.dados.gatilho, null);
    assert.deepEqual(e.dados.entra_em, ['spec']);
  });

  test('aprendizado-gatilho-sessao-seq-e-sessao-propria: --gatilho, --sessao, --eventos com 2 itens e --substitui', () => {
    const amb = ambiente();
    amb.semear([CI, PARAR]);
    const antes = amb.cli(['aprendizado', 'E', 'D', '--regra', 'primeira', '--entra-em', 'spec', '--eventos', 'loop:1']);
    assert.equal(antes.rc, 0, antes.out);
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'segunda', '--entra-em', 'brief:implementador,spec', '--gatilho', 'loop:2', '--eventos', 'loop:1,loop:2',
      '--substitui', 'loop:3', '--sessao', 'aprendiz']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().find((x) => x.tipo === 'aprendizado' && x.sessao === 'aprendiz');
    assert.ok(e, 'gravou na sessão pedida');
    assert.equal(e.seq, 1);
    assert.deepEqual(e.dados.gatilho, { sessao: 'loop', seq: 2 });
    assert.deepEqual(e.dados.evidencia.eventos, [{ sessao: 'loop', seq: 1 }, { sessao: 'loop', seq: 2 }]);
    assert.deepEqual(e.dados.substitui, { sessao: 'loop', seq: 3 });
    assert.deepEqual(e.dados.entra_em, ['brief:implementador', 'spec']);
  });

  test('aprendizado-substitui-com-entrega: GM-11/loop:2 aponta para a outra entrega e lê o valor', () => {
    const amb = ambiente();
    amb.semear([CI]);
    amb.vizinha('GM-11', [CI, ['aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: {}, regra: 'velha', entra_em: ['spec'] }]]);
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'nova', '--entra-em', 'spec', '--eventos', 'loop:1', '--substitui', 'GM-11/loop:2']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().find((x) => x.tipo === 'aprendizado');
    assert.deepEqual(e.dados.substitui, { sessao: 'loop', seq: 2, entrega: 'GM-11' });
    const l = amb.cli(['aprendizados']);
    assert.deepEqual(l.j.aprendizados.map((a) => a.regra), ['nova'], 'o substituído sai da vigência');
  });

  test('aprendizado-medicao-fonte-versionada-grava: --fonte README.md --numero 3 (e 2,5; -1)', () => {
    const amb = ambiente();
    for (const [num, esperado] of [['3', 3], ['2.5', 2.5], ['-1', -1], ['0', 0]]) {
      const r = amb.cli(['aprendizado', 'A', 'D', '--regra', `mede ${num}`, '--entra-em', 'spec', '--fonte', 'README.md', '--numero', num]);
      assert.equal(r.rc, 0, `${num}: ${r.out}`);
      const e = amb.eventos().filter((x) => x.tipo === 'aprendizado').at(-1);
      assert.deepEqual(e.dados.evidencia, { medicao: { fonte: 'README.md', numero: esperado } }, num);
    }
  });

  test('aprendizado-fonte-so-no-indice-passa: `git add` sem commit já é versionado (conhecido do índice)', () => {
    const amb = ambiente();
    writeFileSync(join(amb.dir, 'novo.md'), 'n\n');
    g(amb.dir, 'add', 'novo.md');
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', 'novo.md', '--numero', '1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.tipos().includes('aprendizado'), true);
  });

  test('aprendizado-fonte-evento-pula-ls-files: evento:<s>:<q> existente grava sem arquivo', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', 'evento:loop:1', '--numero', '7']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.eventos().find((x) => x.tipo === 'aprendizado').dados.evidencia, { medicao: { fonte: 'evento:loop:1', numero: 7 } });
  });

  test('aprendizado-diario-ausente-x-ilegivel (1/2, ausente): sem eventos grava e cria o arquivo; com gatilho é gatilho_inexistente; `nada` é pendencia_inexistente', () => {
    const amb = ambiente();
    assert.deepEqual(readdirSync(amb.entregas), ['plano.json']);
    const g1 = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--gatilho', 'loop:1']);
    assert.equal(g1.j.erro, 'gatilho_inexistente', g1.out);
    const g2 = amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:1', '--motivo', 'nada a aprender']);
    assert.equal(g2.j.erro, 'pendencia_inexistente', g2.out);
    assert.deepEqual(readdirSync(amb.entregas), ['plano.json'], 'as duas recusas não criaram arquivo');
    const ok = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec']);
    assert.equal(ok.rc, 0, ok.out);
    assert.deepEqual(amb.tipos(), ['aprendizado']);
  });

  test('aprendizado-diario-ausente-x-ilegivel (2/2, ilegível): linha torta recusa com diario_ilegivel e o arquivo fica byte a byte', () => {
    const amb = ambiente();
    const arq = join(amb.entregas, 'events.loop.jsonl');
    writeFileSync(arq, 'isto nao e json\n');
    const r = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel', r.out);
    assert.equal(readFileSync(arq, 'utf8'), 'isto nao e json\n');
    const l = amb.cli(['aprendizados']);
    assert.equal(l.rc, 0, l.out);
    assert.deepEqual(l.j.aprendizados, []);
    assert.equal(l.j.avisos.length, 1);
    assert.match(l.j.avisos[0], /GM-10 ilegível/);
  });

  test('aprendizado-outra-entrega-ilegivel-grava: a árvore torta de outra entrega não impede gravar (só `substitui` para ela impede)', () => {
    const amb = ambiente();
    amb.vizinhaTorta('GM-1');
    const r = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.tipos(), ['aprendizado']);
  });
});

describe('aprendizado: uso (rc 2) e argumentos (argumento_invalido)', () => {
  const USO = [
    [['aprendizado'], 'sem posicionais'],
    [['aprendizado', 'E'], 'um posicional só'],
    [['aprendizado', 'X', 'D', '--regra', 'x', '--entra-em', 'spec'], 'tipo fora de E|A'],
    [['aprendizado', 'E', 'X', '--regra', 'x', '--entra-em', 'spec'], 'status fora de D|M'],
    [['aprendizado', 'E', 'M', '--entra-em', 'spec'], 'falta --regra'],
    [['aprendizado', 'E', 'M', '--regra', 'x'], 'falta --entra-em'],
    [['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--motivo', 'm'], '--motivo no E|A'],
    [['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--fonte', 'README.md'], '--fonte sem --numero'],
    [['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--numero', '1'], '--numero sem --fonte'],
    [['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--regra', 'y'], '--regra repetida'],
    [['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--desconhecida', 'y'], 'flag desconhecida'],
    [['aprendizado', 'nada', '--gatilho', 'loop:1'], 'nada sem --motivo'],
    [['aprendizado', 'nada', '--motivo', 'm'], 'nada sem --gatilho'],
    [['aprendizado', 'nada', '--gatilho', 'loop:1', '--motivo', 'm', '--regra', 'r'], 'nada com --regra'],
    [['aprendizado', 'nada', '--gatilho', 'loop:1', '--motivo', 'm', '--eventos', 'loop:1'], 'nada com --eventos'],
    [['aprendizado', 'nada', 'D', '--gatilho', 'loop:1', '--motivo', 'm'], 'nada com posicional a mais'],
    [['aprendizados', 'E'], 'aprendizados com posicional'],
    [['aprendizados', '--entrega', 'GM-10'], 'aprendizados não aceita --entrega'],
    [['aprendizados', '--para'], '--para sem valor'],
  ];
  for (const [args, rotulo] of USO) {
    test(`uso-rc2: ${rotulo}`, () => {
      const amb = ambiente();
      amb.semear([CI]);
      const antes = semEfeito(amb);
      const r = amb.cli(args);
      assert.equal(r.rc, 2, `${args.join(' ')}: ${r.out}`);
      assert.equal(r.j.ok, false);
      assert.equal(r.j.erro, 'uso');
      assert.equal(semEfeito(amb), antes, 'nada gravado');
    });
  }

  const INVALIDOS = [
    [['--gatilho', 'loop'], 'gatilho sem ":"'],
    [['--gatilho', 'loop:0'], 'seq 0'],
    [['--gatilho', 'loop:abc'], 'seq texto'],
    [['--gatilho', 'loop:01'], 'seq com zero à esquerda'],
    [['--gatilho', ':1'], 'sessão vazia'],
    [['--gatilho', 'lo op:1'], 'sessão com espaço'],
    [['--eventos', 'loop:1,'], 'lista com item vazio no fim'],
    [['--eventos', ',loop:1'], 'lista com item vazio no começo'],
    [['--eventos', ''], 'lista vazia'],
    [['--eventos', 'loop'], 'item sem seq'],
    [['--substitui', '../GM-1/loop:1'], 'entrega ../GM-1'],
    [['--substitui', 'gm-1/loop:1'], 'entrega em minúscula'],
    [['--substitui', '/loop:1'], 'entrega vazia'],
    [['--substitui', 'loop'], 'substitui sem seq'],
  ];
  for (const [extra, rotulo] of INVALIDOS) {
    test(`argumento-invalido: ${rotulo}`, () => {
      const amb = ambiente();
      amb.semear([CI]);
      const antes = semEfeito(amb);
      const r = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', ...extra]);
      assert.equal(r.rc, 1, `${extra.join(' ')}: ${r.out}`);
      assert.equal(r.j.erro, 'argumento_invalido', r.out);
      assert.equal(semEfeito(amb), antes);
    });
  }

  test('numero-vazio-e-hex-recusa: "" não vira 0, " 12 " não vira 12, 0x10 não vira 16; NaN, Infinity, 1e3, 01, "+1" e "1." também', () => {
    const amb = ambiente();
    const antes = semEfeito(amb);
    for (const n of ['', ' 12 ', '0x10', 'NaN', 'Infinity', '1e3', '01', '+1', '1.', '.5', 'abc', '12abc', '0b1']) {
      const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', 'README.md', '--numero', n]);
      assert.equal(r.j.erro, 'argumento_invalido', `--numero ${JSON.stringify(n)}: ${r.out}`);
      assert.equal(r.rc, 1);
    }
    assert.equal(semEfeito(amb), antes, 'nada gravado');
  });

  test('numero-vazio-sem-fonte-tambem-recusa-uso: --numero sem --fonte é uso, antes de olhar o valor', () => {
    const amb = ambiente();
    const r = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', 'spec', '--numero', '']);
    assert.equal(r.rc, 2, r.out);
    assert.equal(r.j.erro, 'uso');
  });
});

describe('aprendizado: forma (T1) e entra-em sem trim', () => {
  test('entra-em-com-espaco-recusa: "instantaneo, brief:revisor" não vira trim silencioso', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const antes = semEfeito(amb);
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'instantaneo, brief:revisor', '--eventos', 'loop:1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'forma_invalida', r.out);
    assert.match(r.j.mensagem, /entra_em/);
    assert.equal(semEfeito(amb), antes);
    const vazio = amb.cli(['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', '']);
    assert.equal(vazio.j.erro, 'forma_invalida', vazio.out);
  });

  test('aprendizado-d-sem-evidencia-grave-como-m: D sem --eventos nem medição recusa e a mensagem manda gravar como M', () => {
    const amb = ambiente();
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'instantaneo']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'forma_invalida');
    assert.match(r.j.mensagem, /grave como M/);
    assert.deepEqual(amb.tipos(), []);
  });

  test('aprendizado-brief-sombra-recusa: brief:sombra e brief: fora de PAPEIS recusam (forma_invalida)', () => {
    const amb = ambiente();
    amb.semear([CI]);
    for (const destino of ['brief:sombra', 'brief:', 'brief:revisor,brief:revisor', 'outro']) {
      const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', destino, '--eventos', 'loop:1']);
      assert.equal(r.j.erro, 'forma_invalida', `${destino}: ${r.out}`);
    }
    assert.deepEqual(amb.tipos(), ['ci.resultado']);
  });

  test('aprendizado-regra-301-recusa: 300 caracteres grava, 301 recusa', () => {
    const amb = ambiente();
    const ok = amb.cli(['aprendizado', 'E', 'M', '--regra', 'a'.repeat(300), '--entra-em', 'spec']);
    assert.equal(ok.rc, 0, ok.out);
    const ruim = amb.cli(['aprendizado', 'E', 'M', '--regra', 'a'.repeat(301), '--entra-em', 'spec']);
    assert.equal(ruim.j.erro, 'forma_invalida', ruim.out);
    assert.equal(amb.tipos().length, 1);
  });

  test('aprendizado-fonte-absoluta-e-ponto-ponto-recusam: forma antes do ls-files', () => {
    const amb = ambiente();
    for (const f of ['/etc/passwd', '../README.md', 'a//b']) {
      const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', f, '--numero', '1']);
      assert.equal(r.j.erro, 'forma_invalida', `${f}: ${r.out}`);
    }
  });
});

describe('aprendizado: ls-files literal (REQ-APR-1)', () => {
  const comFonte = (amb, fonte) => amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', fonte, '--numero', '1']);

  test('aprendizado-fonte-nao-versionada-recusa: arquivo criado e não adicionado', () => {
    const amb = ambiente();
    writeFileSync(join(amb.dir, 'solto.md'), 's\n');
    const r = comFonte(amb, 'solto.md');
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'fonte_nao_versionada', r.out);
    assert.match(r.j.mensagem, /grave como M/);
    assert.deepEqual(amb.tipos(), []);
  });

  test('aprendizado-fonte-inexistente-recusa', () => {
    const amb = ambiente();
    const r = comFonte(amb, 'nao/existe.md');
    assert.equal(r.j.erro, 'fonte_nao_versionada', r.out);
    assert.match(r.j.mensagem, /grave como M/);
    assert.deepEqual(amb.tipos(), []);
  });

  test('fonte-glob-recusa: `*.md` não casa como pathspec mesmo com README.md versionado; `?`, `[a]` e `:(top)x` também', () => {
    const amb = ambiente();
    for (const f of ['*.md', 'READM?.md', 'README.[m]d', 'gates/*/x.ts']) {
      const r = comFonte(amb, f);
      assert.equal(r.j.erro, 'fonte_nao_versionada', `${f}: ${r.out}`);
    }
    assert.deepEqual(amb.tipos(), []);
  });

  test('fonte-com-nome-literalmente-glob-passa: arquivo versionado chamado `*.md` é aceito como ele mesmo (pathspec literal), com README.md ao lado', () => {
    const amb = ambiente();
    writeFileSync(join(amb.dir, '*.md'), 'g\n');
    g(amb.dir, 'add', '--', '*.md');
    const r = comFonte(amb, '*.md');
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.eventos().find((x) => x.tipo === 'aprendizado').dados.evidencia, { medicao: { fonte: '*.md', numero: 1 } });
  });

  test('fonte-diretorio-recusa: diretório versionado (gates/src) não é arquivo', () => {
    const amb = ambiente();
    for (const f of ['gates/src', 'gates']) {
      const r = comFonte(amb, f);
      assert.equal(r.j.erro, 'fonte_nao_versionada', `${f}: ${r.out}`);
    }
    assert.deepEqual(amb.tipos(), []);
    assert.equal(comFonte(amb, 'gates/src/x.ts').rc, 0, 'o arquivo dentro dele passa');
  });

  test('fonte-lida-da-raiz-principal-de-qualquer-worktree: cwd num subdiretório e numa worktree de outra branch', () => {
    const amb = ambiente();
    const wt = join(novoTmp(), 'wt');
    g(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-T1', wt);
    writeFileSync(join(amb.dir, 'so-na-principal.md'), 'p\n');
    g(amb.dir, 'add', 'so-na-principal.md');
    // na worktree o arquivo não existe, mas a fonte é conferida na raiz principal (índice dela)
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', 'so-na-principal.md', '--numero', '1', '--entrega', 'GM-10'], { cwd: wt });
    assert.equal(r.rc, 0, r.out + r.err);
    const sub = amb.cli(['aprendizado', 'E', 'D', '--regra', 'y', '--entra-em', 'spec', '--fonte', 'README.md', '--numero', '2'], { cwd: join(amb.dir, 'gates', 'src') });
    assert.equal(sub.rc, 0, sub.out + sub.err);
  });
});

describe('aprendizado: referências (validarAprendizado no antes)', () => {
  test('gatilho-evento-e-fonte-inexistentes: o código é o prefixo do motivo', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const antes = semEfeito(amb);
    const gat = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--eventos', 'loop:1', '--gatilho', 'loop:99']);
    assert.equal(gat.j.erro, 'gatilho_inexistente', gat.out);
    const evt = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--eventos', 'loop:99']);
    assert.equal(evt.j.erro, 'evento_inexistente', evt.out);
    const fonte = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', 'evento:loop:99', '--numero', '1']);
    assert.equal(fonte.j.erro, 'evento_inexistente', fonte.out);
    const outra = amb.cli(['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--eventos', 'outra:1']);
    assert.equal(outra.j.erro, 'evento_inexistente', 'a identidade é o par (sessao, seq), nunca seq sozinho');
    assert.equal(semEfeito(amb), antes);
  });

  test('substitui-inexistente-e-auto-referencia: alvo que não existe, ou o próprio seq que seria gravado, recusa (nada de ciclo de 1)', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const antes = semEfeito(amb);
    const r1 = amb.cli(apr('--substitui', 'loop:99'));
    assert.equal(r1.j.erro, 'substitui_inexistente', r1.out);
    const proximo = amb.eventos().filter((e) => e.sessao === 'loop').length + 1;
    const r2 = amb.cli(apr('--substitui', `loop:${proximo}`));
    assert.equal(r2.j.erro, 'substitui_inexistente', r2.out);
    const r3 = amb.cli(apr('--substitui', 'loop:1'));
    assert.equal(r3.j.erro, 'substitui_inexistente', 'o alvo existe mas não é um aprendizado');
    assert.equal(semEfeito(amb), antes);
  });

  test('substitui-entrega-ilegivel-diario-ilegivel: GM-1 torta ⇒ diario_ilegivel citando a pasta, não substitui_inexistente; GM-2 ausente ⇒ substitui_inexistente', () => {
    const amb = ambiente();
    amb.semear([CI]);
    amb.vizinhaTorta('GM-1');
    const antes = semEfeito(amb);
    const r = amb.cli(apr('--substitui', 'GM-1/loop:1'));
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel', r.out);
    assert.match(r.j.mensagem, /GM-1\b/);
    const ausente = amb.cli(apr('--substitui', 'GM-2/loop:1'));
    assert.equal(ausente.j.erro, 'substitui_inexistente', ausente.out);
    assert.equal(semEfeito(amb), antes);
  });

  test('substitui-entrega-corrente-explicita: GM-10/loop:2 vale como loop:2', () => {
    const amb = ambiente();
    amb.semear([CI]);
    assert.equal(amb.cli(apr()).rc, 0);
    const ok = amb.cli(['aprendizado', 'E', 'D', '--regra', 'segunda', '--entra-em', 'spec', '--eventos', 'loop:1', '--substitui', 'GM-10/loop:2']);
    assert.equal(ok.rc, 0, ok.out);
    assert.deepEqual(amb.eventos().at(-1).dados.substitui, { sessao: 'loop', seq: 2, entrega: 'GM-10' });
  });
});

describe('aprendizado nada: só com pendência aberta (D-5)', () => {
  test('nada-fecha-pendencia-aberta-grava: aprendizado.nada {gatilho, motivo} e nada mais', () => {
    const amb = ambiente();
    amb.semear([CI, PARAR]);
    const r = amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:2', '--motivo', 'nada a aprender com a parada']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'aprendizado.nada');
    assert.deepEqual(e.dados, { gatilho: { sessao: 'loop', seq: 2 }, motivo: 'nada a aprender com a parada' });
    assert.equal(r.j.evento.motivo, 'nada a aprender com a parada');
    assert.equal(r.j.evento.tipo_evento, 'aprendizado.nada');
  });

  test('nada-sem-pendencia-recusa: evento que existe mas não é pendência não vale', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const antes = semEfeito(amb);
    const r = amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:1', '--motivo', 'm']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'pendencia_inexistente', r.out);
    const longe = amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:99', '--motivo', 'm']);
    assert.equal(longe.j.erro, 'pendencia_inexistente', longe.out);
    assert.equal(semEfeito(amb), antes);
  });

  test('nada-gatilho-ja-fechado-recusa: fechado por `nada` ou por aprendizado, não reabre nem repete', () => {
    const amb = ambiente();
    amb.semear([CI, PARAR]);
    assert.equal(amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:2', '--motivo', 'm']).rc, 0);
    const antes = semEfeito(amb);
    const de_novo = amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:2', '--motivo', 'm2']);
    assert.equal(de_novo.j.erro, 'pendencia_inexistente', de_novo.out);
    // fechado por aprendizado
    const amb2 = ambiente();
    amb2.semear([CI, PARAR]);
    assert.equal(amb2.cli(apr('--gatilho', 'loop:2')).rc, 0);
    const antes2 = semEfeito(amb2);
    const r = amb2.cli(['aprendizado', 'nada', '--gatilho', 'loop:2', '--motivo', 'm']);
    assert.equal(r.j.erro, 'pendencia_inexistente', r.out);
    assert.equal(semEfeito(amb), antes);
    assert.equal(semEfeito(amb2), antes2);
  });

  test('nada-dono-anterior-a-ancora-recusa: a pendência dono é ancorada na mensagem mais recente; a anterior não é pendência', () => {
    const amb = ambiente();
    amb.semear([DONO, DONO, DONO]);
    const antes = semEfeito(amb);
    const velha = amb.cli(['aprendizado', 'nada', '--gatilho', 'dono:2', '--motivo', 'm']);
    assert.equal(velha.j.erro, 'pendencia_inexistente', velha.out);
    assert.equal(semEfeito(amb), antes);
    const ancora = amb.cli(['aprendizado', 'nada', '--gatilho', 'dono:3', '--motivo', 'm']);
    assert.equal(ancora.rc, 0, ancora.out);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'aprendizado.nada').at(-1).dados.gatilho, { sessao: 'dono', seq: 3 });
  });
});

describe('aprendizado nada: identidade da pendência', () => {
  test('nada-identidade-e-o-par-sessao-seq: `dono:2` não vale só porque `loop:2` (parar) é pendência de mesmo seq', () => {
    const amb = ambiente();
    amb.semear([CI, PARAR]);
    amb.semear([['loop.parar', { motivo: 'ci_vermelho' }, 'outra']], {});
    const antes = semEfeito(amb);
    const r = amb.cli(['aprendizado', 'nada', '--gatilho', 'dono:2', '--motivo', 'm']);
    assert.equal(r.j.erro, 'pendencia_inexistente', r.out);
    assert.equal(semEfeito(amb), antes);
    const certo = amb.cli(['aprendizado', 'nada', '--gatilho', 'outra:1', '--motivo', 'm']);
    assert.equal(certo.rc, 0, certo.out);
  });
});

describe('aprendizado: canário antes de qualquer gravação (D-P1c-6)', () => {
  test('regra-canario-recusa + tipos iguais: segredo na regra ⇒ segredo_no_aprendizado, e NENHUMA linha nova em nenhum jsonl (nem diario.recusa)', () => {
    const amb = ambiente();
    amb.semear([CI]);
    const antes = semEfeito(amb);
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', `token ${TOKEN}`, '--entra-em', 'spec', '--eventos', 'loop:1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'segredo_no_aprendizado', r.out);
    assert.match(r.j.mensagem, /regra/);
    assert.match(r.j.mensagem, /nada foi gravado/);
    assert.equal(r.out.includes(TOKEN), false, 'a mensagem cita o campo e o padrão, nunca o valor');
    assert.equal(semEfeito(amb), antes);
    assert.equal(amb.tipos().includes('diario.recusa'), false);
  });

  test('canario em motivo, fonte, entra-em e gatilho: cada campo recusa sem gravar', () => {
    const amb = ambiente();
    amb.semear([CI, PARAR]);
    const antes = semEfeito(amb);
    const casos = [
      [['aprendizado', 'nada', '--gatilho', 'loop:2', '--motivo', `senha ${TOKEN}`], /motivo/],
      [['aprendizado', 'E', 'D', '--regra', 'x', '--entra-em', 'spec', '--fonte', `docs/${TOKEN}.md`, '--numero', '1'], /fonte/],
      [['aprendizado', 'E', 'M', '--regra', 'x', '--entra-em', `spec,${TOKEN}`], /entra-em/],
    ];
    for (const [args, campo] of casos) {
      const r = amb.cli(args);
      assert.equal(r.j.erro, 'segredo_no_aprendizado', `${args.join(' ')}: ${r.out}`);
      assert.match(r.j.mensagem, campo);
      assert.equal(r.out.includes(TOKEN), false);
    }
    assert.equal(semEfeito(amb), antes);
  });

  test('canario-antes-da-forma-e-do-ls-files: com forma inválida E segredo, vale o segredo (nada leu a árvore nem o git)', () => {
    const amb = ambiente();
    const r = amb.cli(['aprendizado', 'E', 'D', '--regra', `x ${TOKEN}`, '--entra-em', 'brief:sombra', '--fonte', 'nao/existe.md', '--numero', '1']);
    assert.equal(r.j.erro, 'segredo_no_aprendizado', r.out);
  });
});

describe('aprendizados: lista D vigentes da árvore, sem exigir entrega nem plano (D-P1c-5)', () => {
  const D = (regra, entra_em, extra = {}) => ['aprendizado', { tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra, entra_em, ...extra }];
  const M = (regra, entra_em) => ['aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: {}, regra, entra_em }];

  test('aprendizados-sem-entrega-na-branch: branch main, sem plano, sem pasta da entrega ⇒ rc 0 com a lista da árvore', () => {
    const amb = ambiente({ branch: 'main', plano: null });
    amb.vizinha('GM-3', [CI, D('regra da GM-3', ['instantaneo', 'brief:revisor'])]);
    const r = amb.cli(['aprendizados']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.deepEqual(r.j.avisos, []);
    assert.equal(r.j.aprendizados.length, 1);
    const a = r.j.aprendizados[0];
    assert.equal(a.entrega, 'GM-3');
    assert.equal(a.sessao, 'loop');
    assert.equal(a.seq, 2);
    assert.equal(a.tipo, 'E');
    assert.equal(a.regra, 'regra da GM-3');
    assert.deepEqual(a.entra_em, ['instantaneo', 'brief:revisor']);
    assert.equal(a.ts, diario.ler(join(amb.arvore, 'GM-3')).find((e) => e.tipo === 'aprendizado').ts);
    assert.deepEqual(Object.keys(a).sort(), ['entra_em', 'entrega', 'regra', 'seq', 'sessao', 'tipo', 'ts']);
  });

  test('aprendizados-sem-plano-rc0 e plano corrompido rc0: o caminho nem abre a entrega (não há plano_ausente nem plano_invalido)', () => {
    const semPlano = ambiente({ plano: null });
    semPlano.vizinha('GM-3', [CI, D('x', ['spec'])]);
    const a = semPlano.cli(['aprendizados']);
    assert.equal(a.rc, 0, a.out);
    assert.equal(a.j.aprendizados.length, 1);
    const torto = ambiente({ plano: '{ isto nao e json' });
    torto.vizinha('GM-3', [CI, D('y', ['spec'])]);
    const b = torto.cli(['aprendizados']);
    assert.equal(b.rc, 0, b.out);
    assert.deepEqual(b.j.aprendizados.map((x) => x.regra), ['y']);
  });

  test('aprendizados-arvore-ausente-x-corrompida: sem .harness/entregas ⇒ listas vazias, sem aviso; com pasta torta ⇒ aviso citando a pasta e a lista das legíveis', () => {
    const vazio = ambiente({ plano: null });
    rmSync(join(vazio.dir, '.harness'), { recursive: true, force: true });
    const a = vazio.cli(['aprendizados']);
    assert.equal(a.rc, 0, a.out);
    assert.deepEqual(a.j.aprendizados, []);
    assert.deepEqual(a.j.avisos, []);
    const amb = ambiente();
    amb.semear([CI, D('legivel', ['spec'])]);
    amb.vizinhaTorta('GM-1');
    const r = amb.cli(['aprendizados']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.aprendizados.map((x) => x.regra), ['legivel']);
    assert.equal(r.j.avisos.length, 1);
    assert.match(r.j.avisos[0], /GM-1 ilegível/);
  });

  test('aprendizados-m-nunca-sai e --para filtra por destino exato', () => {
    const amb = ambiente();
    amb.semear([
      CI, D('so-instantaneo', ['instantaneo']), D('so-revisor', ['brief:revisor']), D('impl-e-spec', ['brief:implementador', 'spec']),
      M('m-no-revisor', ['brief:revisor', 'instantaneo']),
    ]);
    const todos = amb.cli(['aprendizados']);
    assert.deepEqual(todos.j.aprendizados.map((a) => a.regra).sort(), ['impl-e-spec', 'so-instantaneo', 'so-revisor']);
    const rev = amb.cli(['aprendizados', '--para', 'brief:revisor']);
    assert.deepEqual(rev.j.aprendizados.map((a) => a.regra), ['so-revisor']);
    const inst = amb.cli(['aprendizados', '--para', 'instantaneo']);
    assert.deepEqual(inst.j.aprendizados.map((a) => a.regra), ['so-instantaneo']);
    const spec = amb.cli(['aprendizados', '--para', 'spec']);
    assert.deepEqual(spec.j.aprendizados.map((a) => a.regra), ['impl-e-spec']);
    const corr = amb.cli(['aprendizados', '--para', 'brief:correcao']);
    assert.deepEqual(corr.j.aprendizados, []);
  });

  test('aprendizados-ordem-e-substituido: mais recente primeiro; o alvo de substitui sai', () => {
    const amb = ambiente();
    amb.semear([CI, D('antiga', ['spec']), D('meio', ['spec']), D('nova', ['spec'], { substitui: { sessao: 'loop', seq: 2 } })]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(r.j.aprendizados.map((a) => a.regra), ['nova', 'meio']);
  });

  test('aprendizados-para-invalido-recusa: fora de instantaneo|spec|brief:<PAPEIS> ⇒ argumento_invalido (não lista nada)', () => {
    const amb = ambiente();
    amb.semear([CI, D('x', ['spec'])]);
    for (const p of ['sombra', 'brief:sombra', 'brief:', 'Instantaneo', '', 'brief:revisor,spec', 'brief:implementador ']) {
      const r = amb.cli(['aprendizados', '--para', p]);
      assert.equal(r.rc, 1, `--para ${JSON.stringify(p)}: ${r.out}`);
      assert.equal(r.j.erro, 'argumento_invalido');
    }
  });

  test('aprendizados-de-qualquer-cwd: de uma worktree irmã lê a árvore da raiz principal', () => {
    const amb = ambiente();
    amb.semear([CI, D('da-principal', ['spec'])]);
    const wt = join(novoTmp(), 'wt');
    g(amb.dir, 'worktree', 'add', '-q', '-b', 'sem-id-na-branch', wt);
    const r = amb.cli(['aprendizados'], { cwd: wt });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.aprendizados.map((a) => a.regra), ['da-principal']);
  });

  test('aprendizados-fora-de-repo-falha: não é repositório ⇒ fora_de_repo (rc 1), nunca lista vazia', () => {
    const amb = ambiente();
    const r = amb.cli(['aprendizados'], { cwd: novoTmp() });
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'fora_de_repo');
  });
});

describe('estrutura (preso por teste)', () => {
  test('PAPEIS de loop.mjs é a mesma lista de formas.ts (fonte única do dist), na mesma ordem', () => {
    const m = /^const PAPEIS = \[([^\]]*)\];$/m.exec(readFileSync(FONTE_LOOP, 'utf8'));
    assert.ok(m, 'achou a declaração de PAPEIS em loop.mjs');
    const lista = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(lista, [...PAPEIS]);
  });

  test('aprendizado-nao-le-o-diario-por-fora: a validação roda só dentro do `antes`, com os eventos que o gravar leu (sem 2ª leitura)', () => {
    const todo = readFileSync(FONTE_APR, 'utf8');
    // T11: `registro` lê o diário de propósito (subcomando só de leitura). A regra vale para TODO o arquivo MENOS o corpo de `registro`:
    // helper chamado por `aprendizado` (ex.: `versionada`) que lesse o diário por fora também é pego.
    const ini = todo.indexOf('export function registro(');
    assert.ok(ini >= 0, 'achou o corpo de `registro`');
    const proximo = todo.indexOf('\nexport ', ini + 1);
    const fonte = todo.slice(0, ini) + (proximo < 0 ? '' : todo.slice(proximo));
    assert.ok(fonte.includes('export function aprendizado(') && fonte.includes('function versionada('), 'o recorte ainda contém `aprendizado` e os helpers');
    assert.equal(/lerDiarioEstrito\s*\(/.test(fonte), false, 'nenhuma leitura própria do diário da entrega');
    assert.equal((fonte.match(/validarAprendizado\(/g) ?? []).length, 1, 'uma só chamada de validarAprendizado');
    assert.match(fonte, /antes\s*=\s*\(candidato,\s*eventos\)|\(candidato,\s*eventos\)\s*=>/);
  });
});

// ─────────────────────────────────────────────────────────────── T11: registro (REQ-REG-1)

describe('registro: CLI grava registro.md determinístico (REQ-REG-1)', () => {
  const sha256 = (b) => createHash('sha256').update(b).digest('hex');
  const arquivosDe = (amb) => readdirSync(amb.entregas).sort();
  const DESC = ['descoberta', { evidencia: 'A5 é medido', causa: 'tecnica' }];
  /** Linhas cruas encadeadas (o `append` recusa o que o registro tem de enfrentar: segredo e seq fora de ordem). */
  const cru = (amb, eventos) => {
    let anterior = null;
    const linhas = eventos.map((e) => {
      const l = JSON.stringify({ autor: 't@t', agente: 'orquestrador', sessao: 'loop', hash_anterior: anterior === null ? null : sha256(anterior), ...e });
      anterior = l;
      return l;
    });
    writeFileSync(join(amb.entregas, 'events.loop.jsonl'), `${linhas.join('\n')}\n`);
  };

  test('registro-cli-grava-e-relê: {ok, arquivo, sha256}; o arquivo no disco tem esse sha e o texto do diário; 2 rodadas, mesmo byte; sem tmp', () => {
    const amb = ambiente();
    amb.semear([CI, DESC]);
    const r1 = amb.cli(['registro']);
    assert.equal(r1.rc, 0, r1.out + r1.err);
    assert.equal(r1.j.ok, true);
    assert.equal(r1.j.arquivo, '.harness/entregas/GM-10/registro.md');
    const bytes1 = readFileSync(join(amb.entregas, 'registro.md'));
    assert.equal(r1.j.sha256, sha256(bytes1));
    assert.match(bytes1.toString('utf8'), /^# Registro de decisões — GM-10\n/);
    assert.match(bytes1.toString('utf8'), /- loop:2 · tecnica · A5 é medido/);
    const r2 = amb.cli(['registro']);
    assert.equal(r2.j.sha256, r1.j.sha256);
    assert.deepEqual(readFileSync(join(amb.entregas, 'registro.md')), bytes1);
    assert.deepEqual(arquivosDe(amb).filter((f) => f.includes('tmp') || f.startsWith('.registro')), [], 'nenhum temporário sobrou');
    assert.deepEqual(amb.tipos(), ['ci.resultado', 'descoberta'], 'registro não grava evento no diário');
  });

  test('registro-costura-aprendizado-real (P9): `aprendizado` real grava, `registro` real lista em Aprendizados D, e o M só em M', () => {
    const amb = ambiente();
    amb.semear([CI]);
    assert.equal(amb.cli(['aprendizado', 'A', 'D', '--regra', 'rode o build antes', '--entra-em', 'instantaneo', '--eventos', 'loop:1']).rc, 0);
    assert.equal(amb.cli(['aprendizado', 'E', 'M', '--regra', 'suspeita sem medida', '--entra-em', 'spec']).rc, 0);
    const r = amb.cli(['registro']);
    assert.equal(r.rc, 0, r.out + r.err);
    const t = readFileSync(join(amb.entregas, 'registro.md'), 'utf8');
    const d = t.split('## Aprendizados D\n')[1].split('## Aprendizados M')[0];
    const m = t.split('## Aprendizados M\n')[1];
    assert.match(d, /- loop:2 · A · rode o build antes · entra em: instantaneo · sem medição · eventos: loop:1/);
    assert.doesNotMatch(d, /suspeita/);
    assert.match(m, /- loop:3 · E · suspeita sem medida/);
  });

  test('registro-diario-ausente-x-ilegivel: ausente ⇒ seções `- nenhum` e grava; torto, cadeia quebrada ou fora de ordem ⇒ diario_ilegivel, nada gravado e o registro antigo fica', () => {
    const ausente = ambiente();
    const ok = ausente.cli(['registro']);
    assert.equal(ok.rc, 0, ok.out + ok.err);
    const t = readFileSync(join(ausente.entregas, 'registro.md'), 'utf8');
    assert.equal([...t.matchAll(/^- nenhum$/gm)].length, 8);

    const ts = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    const casos = {
      torto: (amb) => writeFileSync(join(amb.entregas, 'events.loop.jsonl'), 'isto nao e json\n'),
      'cadeia-quebrada': (amb) => writeFileSync(join(amb.entregas, 'events.loop.jsonl'), `${JSON.stringify({ seq: 1, ts: ts(1), sessao: 'loop', tipo: 'ci.resultado', dados: { verde: true }, hash_anterior: SHA })}\n`),
      'fora-de-ordem': (amb) => cru(amb, [
        { seq: 2, ts: ts(2), tipo: 'descoberta', dados: { evidencia: 'a', causa: 'tecnica' } },
        { seq: 1, ts: ts(1), tipo: 'descoberta', dados: { evidencia: 'b', causa: 'tecnica' } },
      ]),
      'evento-fora-da-forma': (amb) => cru(amb, [{ seq: 1, ts: ts(1), tipo: 'desvio', dados: { task: 'T1' } }]),
    };
    for (const [nome, monta] of Object.entries(casos)) {
      const amb = ambiente();
      writeFileSync(join(amb.entregas, 'registro.md'), 'VELHO\n');
      monta(amb);
      const antes = arquivosDe(amb);
      const r = amb.cli(['registro']);
      assert.equal(r.rc, 1, `${nome}: ${r.out}${r.err}`);
      assert.equal(r.j.ok, false, nome);
      assert.equal(r.j.erro, 'diario_ilegivel', `${nome}: ${r.out}`);
      assert.equal(readFileSync(join(amb.entregas, 'registro.md'), 'utf8'), 'VELHO\n', `${nome}: o registro antigo não é tocado`);
      assert.deepEqual(arquivosDe(amb), antes, `${nome}: nem tmp sobrando`);
    }
  });

  test('registro-segredo-no-diario-nao-grava: canário no texto renderizado ⇒ segredo_no_registro, nada gravado', () => {
    const amb = ambiente();
    cru(amb, [{ seq: 1, ts: new Date(Date.UTC(2026, 0, 1)).toISOString(), tipo: 'descoberta', dados: { evidencia: `achei ${TOKEN}`, causa: 'tecnica' } }]);
    const antes = arquivosDe(amb);
    const r = amb.cli(['registro']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'segredo_no_registro');
    assert.equal(r.out.includes(TOKEN), false, 'o segredo não volta na saída');
    assert.deepEqual(arquivosDe(amb), antes);
  });

  test('registro-segredo-partido-pelo-corte: token que o corte de 240 partiria é recusado pelo CLI, em cada campo de texto que entra no registro', () => {
    const ts = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    const H = 'b'.repeat(64);
    const crua = (n, tipo, dados, sessao = 'loop') => ({ seq: 1, ts: ts(n), sessao, tipo, dados });
    const BASES = {
      aprovacao: crua(1, 'spec.aprovada', { spec: 'docs/spec.md', sha256: SHA }),
      sombra: crua(1, 'decisao.sombra', { pergunta_hash: H, req: 'REQ-REG-1', resposta: 'r', arquivo: 'a.md', pergunta_enviesada: false, fontes: ['a.md'], medicao: 'm' }),
      sombraTask: crua(1, 'decisao.sombra', { pergunta_hash: H, task: 'T9', resposta: 'r', arquivo: 'a.md', pergunta_enviesada: false, fontes: ['a.md'] }),
      emenda: crua(1, 'emenda.proposta', { req: 'REQ-APR-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', task: 'T4' }, 'emendas'),
      teto: crua(1, 'task.reaberta', { task: 'T7', origem: 'dono' }),
      desvio: crua(1, 'desvio', { task: 'T3', req: 'REQ-DIA-1', evidencia: 'e', arquivos: ['a.ts'], causa: 'tecnica' }),
      descoberta: crua(1, 'descoberta', { evidencia: 'e', causa: 'tecnica' }),
      aprendizado: crua(1, 'aprendizado', { tipo: 'A', status: 'D', gatilho: null, evidencia: { medicao: { fonte: 'docs/m.md', numero: 1 } }, regra: 'r', entra_em: ['spec'] }),
    };
    const CAMPOS = [
      ['aprovacao', ['spec'], 200], ['sombra', ['resposta'], 240], ['sombra', ['fontes', 0], 200], ['sombra', ['medicao'], 200], ['sombraTask', ['task'], 64],
      ['emenda', ['fato'], 240], ['emenda', ['diff'], 240], ['emenda', ['task'], 64], ['teto', ['task'], 64],
      ['desvio', ['evidencia'], 240], ['desvio', ['arquivos', 0], 200], ['desvio', ['task'], 64], ['descoberta', ['evidencia'], 240], ['aprendizado', ['regra'], 240],
    ];
    for (const [chave, caminho, max] of CAMPOS) {
      const nome = `${chave}.${caminho.join('.')}`;
      const evento = structuredClone(BASES[chave]);
      // o token começa antes da fronteira do corte e termina depois dela: o texto cortado ficaria com ghp_ + menos de 20 caracteres
      let alvo = evento.dados;
      for (const k of caminho.slice(0, -1)) alvo = alvo[k];
      const pos = max - 'ghp_'.length - 19;
      alvo[caminho[caminho.length - 1]] = `${'x'.repeat(pos - 1)} ${TOKEN}`;
      const amb = ambiente();
      const linha = JSON.stringify({ autor: 't@t', agente: 'orquestrador', hash_anterior: null, ...evento });
      writeFileSync(join(amb.entregas, `events.${evento.sessao}.jsonl`), `${linha}\n`);
      writeFileSync(join(amb.entregas, 'registro.md'), 'VELHO\n');
      const antes = arquivosDe(amb);
      const r = amb.cli(['registro']);
      assert.equal(r.rc, 1, `${nome}: ${r.out}${r.err}`);
      assert.equal(r.j.erro, 'segredo_no_registro', `${nome}: ${r.out}`);
      assert.equal(r.out.includes('ghp_'), false, `${nome}: nem parte do segredo volta na saída`);
      assert.equal(readFileSync(join(amb.entregas, 'registro.md'), 'utf8'), 'VELHO\n', `${nome}: registro antigo intacto`);
      assert.deepEqual(arquivosDe(amb), antes, `${nome}: nem tmp sobrando`);
    }
  });

  test('registro-segredo-no-corte-sem-o-canario-final: o texto gerado NÃO casa o canário (só o campo inteiro casa) e o CLI recusa mesmo assim', () => {
    const amb = ambiente();
    cru(amb, [{ seq: 1, ts: new Date(Date.UTC(2026, 0, 1)).toISOString(), tipo: 'descoberta', dados: { evidencia: `${'x'.repeat(216)} ${TOKEN}`, causa: 'tecnica' } }]);
    assert.equal(diario.recusaCanario(`${'x'.repeat(216)} ${TOKEN}`.slice(0, 240)), null, 'premissa: o corte esconde o token do canário');
    const r = amb.cli(['registro']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'segredo_no_registro');
    assert.equal(existsSync(join(amb.entregas, 'registro.md')), false);
  });

  test('registro-segredo-em-lista-e-em-evento-posterior: o token no 2º evento e no 2º item de lista é achado; o que só o texto gerado revelaria (NUL vira espaço) também', () => {
    const ts = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    const ok = { seq: 1, ts: ts(1), tipo: 'descoberta', dados: { evidencia: 'limpa', causa: 'tecnica' } };
    const casos = {
      'evento-posterior': [ok, { seq: 2, ts: ts(2), tipo: 'descoberta', dados: { evidencia: `${'x'.repeat(216)} ${TOKEN}`, causa: 'tecnica' } }],
      'lista-2o-item': [ok, { seq: 2, ts: ts(2), tipo: 'desvio', dados: { task: 'T1', req: 'REQ-DIA-1', evidencia: 'e', arquivos: ['a.ts', `${'y'.repeat(190)} ${TOKEN}`], causa: 'tecnica' } }],
      'so-o-texto-gerado': [{ seq: 1, ts: ts(1), tipo: 'descoberta', dados: { evidencia: `Bearer\u0000${'A'.repeat(20)}`, causa: 'tecnica' } }],
    };
    for (const [nome, eventos] of Object.entries(casos)) {
      const amb = ambiente();
      cru(amb, eventos);
      const r = amb.cli(['registro']);
      assert.equal(r.rc, 1, `${nome}: ${r.out}${r.err}`);
      assert.equal(r.j.erro, 'segredo_no_registro', `${nome}: ${r.out}`);
      assert.equal(existsSync(join(amb.entregas, 'registro.md')), false, nome);
    }
  });

  test('registro-corte-por-ponto-de-codigo-no-cli: emoji na fronteira dos 240 sai inteiro no registro.md gravado', () => {
    const amb = ambiente();
    cru(amb, [{ seq: 1, ts: new Date(Date.UTC(2026, 0, 1)).toISOString(), tipo: 'descoberta', dados: { evidencia: `${'x'.repeat(239)}😀yyy`, causa: 'tecnica' } }]);
    const r = amb.cli(['registro']);
    assert.equal(r.rc, 0, r.out + r.err);
    const t = readFileSync(join(amb.entregas, 'registro.md'), 'utf8');
    assert.ok(t.includes(`${'x'.repeat(239)}😀…\n`));
    assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(t), false, 'sem surrogate solto');
  });

  test('registro-falha-na-escrita-sem-tmp: registro.md que é diretório ⇒ registro_nao_gravado, nenhum tmp sobra e o destino não é tocado', () => {
    const amb = ambiente();
    amb.semear([CI, DESC]);
    mkdirSync(join(amb.entregas, 'registro.md'));
    const antes = arquivosDe(amb);
    const r = amb.cli(['registro']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'registro_nao_gravado');
    assert.deepEqual(arquivosDe(amb), antes, 'nem tmp sobrando');
    assert.deepEqual(arquivosDe(amb).filter((f) => f.includes('tmp')), []);
  });

  test('registro-spec-atual-vem-do-disco: o sha da spec do plano entra (confere × difere) pelo CLI real', () => {
    const amb = ambiente({ plano: { ...PLANO, spec: 'README.md' } });
    amb.semear([['spec.aprovada', { spec: 'README.md', sha256: sha256('x\n') }]]);
    assert.equal(amb.cli(['registro']).rc, 0);
    const ler = () => readFileSync(join(amb.entregas, 'registro.md'), 'utf8');
    assert.match(ler(), new RegExp(`- sha256 atual da spec: ${sha256('x\n')} \\(confere com a última aprovação\\)`));
    writeFileSync(join(amb.dir, 'README.md'), 'y\n');
    assert.equal(amb.cli(['registro']).rc, 0);
    assert.match(ler(), new RegExp(`- sha256 atual da spec: ${sha256('y\n')} \\(difere da última aprovação\\)`));
  });

  test('registro-tmp-no-mesmo-diretorio-e-rename: a fonte escreve em dirEntrega e troca por renameSync (preso por teste)', () => {
    const todo = readFileSync(FONTE_APR, 'utf8');
    const corpo = todo.slice(todo.indexOf('export function registro('));
    assert.match(corpo, /const tmp = join\(c\.dirEntrega,/);
    assert.match(corpo, /renameSync\(tmp, destino\)/);
    assert.equal(/Date\.now|toLocale|new Date\(/.test(corpo), false, 'sem relógio nem localidade');
  });

  test('registro-uso: posicional sobrando é recusado e nada é gravado', () => {
    const amb = ambiente();
    const r = amb.cli(['registro', 'extra']);
    assert.notEqual(r.rc, 0, r.out + r.err);
    assert.equal(existsSync(join(amb.entregas, 'registro.md')), false);
  });
});

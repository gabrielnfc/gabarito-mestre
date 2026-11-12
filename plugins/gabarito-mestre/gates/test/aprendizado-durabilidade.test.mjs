/**
 * Aprendizado sobrevive a update e a clone (GM-14 T33, REQ-APR-5; D-E4, F-A1; P1 da Sombra 7f716152).
 * T = árvore `.harness/entregas/<ID>/events.*.jsonl`; X = `.harness/aprendizados.jsonl` (extrato versionado); chave = (entrega, sessao, seq).
 * Leitura: `diario.lerAprendizados` é o leitor único e junta T e X pela chave (diário vence; diverge ⇒ aviso; só em X ⇒ entra).
 * Escrita: `loop.mjs aprendizado` regrava X da JUNÇÃO depois do append (tmp + rename); `aprendizados --exportar` regrava sem gravar evento.
 * Provisórios (sem regra na spec, nome termina em `-provisorio`): (i) X corrompido não é regravado; (ii) linha de forma recusada fica fora
 * sozinha (e é preservada na regravação); (iii) entrega ilegível em T: as chaves dela em X entram e o aviso de ilegível continua.
 *
 * MUTAÇÕES PRESCRITAS (task-33-mut.json): M-A1 regravação lê só a árvore · M-A2 diverge sem aviso · M-A3 aviso diverge conta como ilegível
 * · M-A4 junção por entrega · M-A5 exportar sem ordenar · e as demais do arquivo.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync, existsSync, cpSync, appendFileSync,
  chmodSync, symlinkSync, lstatSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { aprendizadosVigentes } from '../dist/aprendizado.js';
import * as doctor from '../scripts/harness-doctor.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'loop.mjs');
const FIXTURE = join(AQUI, 'fixtures', 'aprendizados-2.0.0');

const raizes = [];
after(() => {
  for (const d of raizes) {
    try { chmodSync(join(d, '.harness'), 0o755); } catch { /* nada */ }
    rmSync(d, { recursive: true, force: true });
  }
});
const novoTmp = (p = 'apr-dur-') => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); raizes.push(d); return d; };
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha = (s) => createHash('sha256').update(s).digest('hex');

const CONFIG = { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } };
const PLANO = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }] };
const HOST = 'host-teste';
const CAPACIDADE = { hostname: HOST, slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 };
const MEDIDAS = { GABARITO_CAP_HOSTNAME: HOST, GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };
const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(4).slice(0, 36)}`;
const RODAPE = (n) => `... ${n} aprendizado(s) fora (os mais antigos; lista inteira em loop.mjs aprendizados)`;

let relogio = 0;
const tsNovo = () => { relogio += 1; return new Date(Date.UTC(2026, 5, 1, 0, 0, 0) + relogio * 1000).toISOString(); };
const tsVelho = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

const dadosD = (regra, entra_em = ['instantaneo'], extra = {}) => ({ tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra, entra_em, ...extra });
const dadosM = (regra, entra_em = ['instantaneo']) => ({ tipo: 'E', status: 'M', gatilho: null, evidencia: {}, regra, entra_em });
/** Evento na ordem de chaves que `append` grava (seq, ts, autor, sessao, agente, tipo, dados, hash_anterior). */
const evento = (seq, dados, { sessao = 'loop', ts = tsVelho(seq), tipo = 'aprendizado', hash_anterior = null } = {}) =>
  ({ seq, ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados, hash_anterior });
const linhaX = (entrega, ev) => JSON.stringify({ entrega, evento: ev });

/** Repositório git com branch de PBI, config, capacidade falsa e `plano.json` da GM-10. `fixture` copia a árvore gravada pelo 2.0.0. */
function ambiente({ fixture = false, plano = PLANO } = {}) {
  const dir = novoTmp();
  g(dir, 'init', '-q', '-b', 'enabler/GM-10-durabilidade');
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(CONFIG));
  writeFileSync(join(dir, '.gitignore'), '.harness/worktrees/\n');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  if (fixture) cpSync(join(FIXTURE, '.harness'), join(dir, '.harness'), { recursive: true });
  else if (plano !== null) writeFileSync(join(entregas, 'plano.json'), JSON.stringify(plano));
  appendFileSync(join(dir, '.git', 'info', 'exclude'), '.harness/capacidade.json\n');
  writeFileSync(join(dir, '.harness', 'capacidade.json'), JSON.stringify(CAPACIDADE));
  const tmpSistema = novoTmp('apr-dur-sys-');
  const env = { ...process.env, TMPDIR: tmpSistema, ...MEDIDAS };
  for (const k of Object.keys(env)) if (/^(PG|GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR))/i.test(k) || k === 'GABARITO_POUSO_X') delete env[k];
  const amb = {
    dir, entregas, arvore: join(dir, '.harness', 'entregas'), extrato: join(dir, '.harness', 'aprendizados.jsonl'),
    cli(args, { timeout, cwd = dir } = {}) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env, ...(timeout ? { timeout } : {}) });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
      return { rc: r.status, j, out: r.stdout, err: r.stderr, sinal: r.signal };
    },
    semear(lista, { entrega = 'GM-10', sessao = 'loop' } = {}) {
      const d = join(amb.arvore, entrega);
      mkdirSync(d, { recursive: true });
      for (const [tipo, dados] of lista) {
        const r = diario.append(d, sessao, { ts: tsNovo(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    /** Diário escrito à mão com cadeia válida (seq 1, 2, … e hash_anterior): o que o `append` recusaria (canário) mas um diário antigo pode ter. */
    diarioManual(entrega, sessao, lista) {
      const d = join(amb.arvore, entrega);
      mkdirSync(d, { recursive: true });
      let anterior = null;
      const linhas = lista.map(([tipo, dados], i) => {
        const l = JSON.stringify(evento(i + 1, dados, { sessao, tipo, ts: tsNovo(), hash_anterior: anterior === null ? null : sha(anterior) }));
        anterior = l;
        return l;
      });
      writeFileSync(join(d, `events.${sessao}.jsonl`), `${linhas.join('\n')}\n`);
    },
    escreverX(linhas) { writeFileSync(amb.extrato, linhas.map((l) => `${l}\n`).join('')); },
    lerX: () => readFileSync(amb.extrato, 'utf8'),
    linhasX: () => readFileSync(amb.extrato, 'utf8').split('\n').filter(Boolean),
    /** Todos os bytes de todos os diários da árvore: prova "sem gravar evento". */
    diarios() {
      const out = {};
      for (const e of readdirSync(amb.arvore)) {
        const p = join(amb.arvore, e);
        try { for (const f of readdirSync(p)) if (/^events\..+\.jsonl$/.test(f)) out[`${e}/${f}`] = readFileSync(join(p, f), 'utf8'); } catch { /* não é pasta */ }
      }
      return out;
    },
    regras: (r) => r.j.aprendizados.map((a) => a.regra),
  };
  return amb;
}

const DESCOBERTA = ['descoberta', { evidencia: 'fato medido', causa: 'tecnica' }];
const aprCli = (regra, entra = 'instantaneo') => ['aprendizado', 'E', 'D', '--regra', regra, '--entra-em', entra, '--eventos', 'loop:1'];
const itemDe = (r, task, papel) => r.j.acao.itens.find((i) => i.task === task && i.papel === papel);

/** Bloco de aprendizados do instantâneo: do cabeçalho ao rodapé novo (inclusive) ou à 1ª linha de evento. */
function blocoApr(texto) {
  const l = texto.split('\n');
  const i = l.findIndex((x) => x.startsWith('Aprendizados ('));
  if (i < 0) return [];
  let f = i + 1;
  while (f < l.length && !/^20\d\d-/.test(l[f]) && !(l[f].startsWith('... ') && !l[f].includes('aprendizado(s) fora'))) f++;
  return l.slice(i, f);
}

/** Cópia de um repositório só pelo que o git versiona (`git ls-files`): o clone novo de outra máquina. */
function clonePorLsFiles(origem) {
  const dir = novoTmp('apr-clone-');
  for (const f of g(origem, 'ls-files', '-z').split('\0').filter(Boolean)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), readFileSync(join(origem, f)));
  }
  g(dir, 'init', '-q', '-b', 'enabler/GM-10-durabilidade');
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'chore: clone');
  return dir;
}

// ─────────────────────────────────────────────────────────────── escrita (REQ-APR-5 a)

describe('extrato: escrita', () => {
  test('extrato-regravado-apos-aprendizado: depois do append, X tem uma linha {entrega, evento} com o evento byte a byte igual ao do diário', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    const r = amb.cli(aprCli('rode o build antes do teste'));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.extrato, { ok: true, linhas: 1, fora: 0, avisos: [] });
    const diarioBruto = readFileSync(join(amb.entregas, 'events.loop.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(amb.lerX(), `{"entrega":"GM-10","evento":${diarioBruto[1]}}\n`);
    const r2 = amb.cli(aprCli('confira o gate antes de integrar'));
    assert.equal(r2.rc, 0, r2.out + r2.err);
    const bruto2 = readFileSync(join(amb.entregas, 'events.loop.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(amb.linhasX(), [`{"entrega":"GM-10","evento":${bruto2[1]}}`, `{"entrega":"GM-10","evento":${bruto2[2]}}`]);
    assert.equal(r2.j.aviso, undefined, 'sucesso sem aviso');
  });

  test('aprendizado-de-worktree-grava-extrato-na-raiz: rodado de dentro de uma worktree, o extrato vai para a raiz principal, junto do diário', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    const wt = join(amb.dir, '.harness', 'worktrees', 'T1');
    g(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-T1', wt);
    const r = amb.cli([...aprCli('da worktree'), '--entrega', 'GM-10'], { cwd: wt });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.linhasX().map((l) => JSON.parse(l).evento.dados.regra), ['da worktree']);
    assert.equal(existsSync(join(wt, '.harness', 'aprendizados.jsonl')), false);
    const l = amb.cli(['aprendizados'], { cwd: wt });
    assert.deepEqual(amb.regras(l), ['da worktree']);
  });

  test('aprendizado-nada-nao-regrava: `aprendizado nada` não é aprendizado e não cria X', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    amb.cli(['aprendizado', 'nada', '--gatilho', 'loop:1', '--motivo', 'nada a registrar']);
    assert.equal(existsSync(amb.extrato), false);
  });

  test('exportar-idempotente: 2 execuções ⇒ mesmos bytes; nenhum evento gravado; ordem (entrega, sessao, seq)', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('b-loop-2')], ['aprendizado', dadosD('b-loop-3')]]);
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('a-sessao-x')]], { sessao: 'x' });
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('gm-9')]], { entrega: 'GM-9' });
    const antes = amb.diarios();
    const r1 = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r1.rc, 0, r1.out + r1.err);
    assert.deepEqual(r1.j.extrato, { ok: true, linhas: 4, fora: 0, avisos: [] });
    const b1 = amb.lerX();
    const r2 = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r2.rc, 0);
    assert.equal(amb.lerX(), b1);
    assert.deepEqual(amb.diarios(), antes, 'exportar não grava evento');
    const chaves = amb.linhasX().map((l) => { const o = JSON.parse(l); return `${o.entrega}/${o.evento.sessao}:${o.evento.seq}`; });
    assert.deepEqual(chaves, ['GM-10/loop:2', 'GM-10/loop:3', 'GM-10/x:2', 'GM-9/loop:2']);
    assert.equal(r1.j.aprendizados, undefined, 'exportar não lista');
  });

  test('exportar-nao-depende-do-readdir: X desordenado, entrega só em X e sessão nova ⇒ saída ordenada por (entrega, sessao, seq) e estável', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('t-zz')]], { sessao: 'zz' });
    // só na árvore, sem linha em X: o nome do arquivo ordena `events.a.b.jsonl` antes de `events.a.jsonl`; a chave ordena `a` antes de `a.b`
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('gm11-ab')]], { entrega: 'GM-11', sessao: 'a.b' });
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('gm11-a')]], { entrega: 'GM-11', sessao: 'a' });
    amb.escreverX([
      linhaX('GM-2', evento(4, dadosD('gm2-4'))),
      linhaX('GM-10', evento(9, dadosD('gm10-aa-9'), { sessao: 'aa' })),
      linhaX('GM-10', evento(10, dadosD('gm10-aa-10'), { sessao: 'aa' })),
      linhaX('GM-10', evento(3, dadosD('gm10-aa-3'), { sessao: 'aa' })),
      linhaX('GM-2', evento(2, dadosD('gm2-2'))),
    ]);
    const r = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r.rc, 0, r.out + r.err);
    const chaves = amb.linhasX().map((l) => { const o = JSON.parse(l); return `${o.entrega}/${o.evento.sessao}:${o.evento.seq}`; });
    assert.deepEqual(chaves, ['GM-10/aa:3', 'GM-10/aa:9', 'GM-10/aa:10', 'GM-10/zz:2', 'GM-11/a:2', 'GM-11/a.b:2', 'GM-2/loop:2', 'GM-2/loop:4']);
    const b1 = amb.lerX();
    assert.equal(amb.cli(['aprendizados', '--exportar']).rc, 0);
    assert.equal(amb.lerX(), b1);
  });

  test('extrato-com-token-fica-fora: evento com segredo no diário fica fora de X com aviso; o diário continua com ele; X à mão com token é recusado na leitura', () => {
    const amb = ambiente();
    amb.diarioManual('GM-10', 'loop', [DESCOBERTA, ['aprendizado', dadosD(`limpa`)], ['aprendizado', dadosD(`vazou ${TOKEN}`)]]);
    const antes = amb.diarios();
    const r = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.extrato.linhas, 1);
    assert.equal(r.j.extrato.fora, 1);
    assert.deepEqual(r.j.extrato.avisos, ['aprendizados: extrato sem GM-10/loop:3 (canário ghp); o evento segue no diário']);
    assert.ok(!amb.lerX().includes(TOKEN));
    assert.deepEqual(amb.diarios(), antes);
    const so = ambiente();
    so.escreverX([linhaX('GM-7', evento(2, dadosD(`vazou ${TOKEN}`))), linhaX('GM-7', evento(3, dadosD('ok-7')))]);
    const l = so.cli(['aprendizados']);
    assert.deepEqual(so.regras(l), ['ok-7']);
    assert.deepEqual(l.j.avisos, ['aprendizados: extrato linha 1 fora (canário ghp)']);
    assert.ok(!l.out.includes(TOKEN));
  });

  test('falha-entre-append-e-rename: .harness sem escrita ⇒ evento no diário, X antigo intacto, aviso e rc 0 (nunca sucesso calado)', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    assert.equal(amb.cli(aprCli('primeira')).rc, 0);
    const xAntes = amb.lerX();
    const nAntes = diario.ler(amb.entregas).length;
    chmodSync(join(amb.dir, '.harness'), 0o555);
    let r;
    try { r = amb.cli(aprCli('segunda')); } finally { chmodSync(join(amb.dir, '.harness'), 0o755); }
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(diario.ler(amb.entregas).length, nAntes + 1);
    assert.equal(diario.ler(amb.entregas).at(-1).dados.regra, 'segunda');
    assert.equal(amb.lerX(), xAntes);
    assert.equal(r.j.extrato.ok, false);
    assert.match(r.j.extrato.motivo, /^extrato não regravado \(EACCES\)$/);
    assert.deepEqual(r.j.aviso, ['extrato não regravado (EACCES); o evento está no diário: rode loop.mjs aprendizados --exportar']);
    assert.deepEqual(readdirSync(join(amb.dir, '.harness')).filter((f) => f.endsWith('.tmp')), [], 'sem tmp esquecido');
    // seguindo o aviso: o exportar põe no extrato o evento que ficou só no diário
    assert.equal(amb.cli(['aprendizados', '--exportar']).rc, 0);
    assert.deepEqual(amb.linhasX().map((l) => JSON.parse(l).evento.dados.regra), ['primeira', 'segunda']);
  });

  test('exportar-recusa-com-para: --exportar e --para juntos é uso (rc 2), nada gravado', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('x')]]);
    const r = amb.cli(['aprendizados', '--exportar', '--para', 'instantaneo']);
    assert.equal(r.rc, 2, r.out + r.err);
    assert.equal(existsSync(amb.extrato), false);
  });
});

// ─────────────────────────────────────────────────────────────── leitura (REQ-APR-5 b)

describe('extrato: leitura pela junção', () => {
  test('extrato-ausente-igual-2-0-0: sem X, a árvore gravada pelo 2.0.0 dá os mesmos vigentes, sem aviso novo, e nada é criado', () => {
    const amb = ambiente({ fixture: true });
    const r = amb.cli(['aprendizados']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.regras(r), ['ausente nao e corrompido', 'revisor roda as mutacoes antes do veredito', 'implementador roda o build antes do teste']);
    assert.deepEqual(r.j.avisos, []);
    assert.equal(existsSync(amb.extrato), false);
  });

  test('extrato-ausente-mantem-avisos-da-arvore: entrega ilegível ⇒ só o aviso da árvore', () => {
    const amb = ambiente({ fixture: true });
    mkdirSync(join(amb.arvore, 'GM-4'));
    writeFileSync(join(amb.arvore, 'GM-4', 'events.loop.jsonl'), 'torto\n');
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(r.j.avisos, ['aprendizados: GM-4 ilegível (linha 1 ilegível em events.loop.jsonl)']);
  });

  test('chave-em-t-e-x-igual-entra-uma-vez: conteúdo igual ⇒ uma vez, sem aviso', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    amb.cli(aprCli('uma so'));
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(amb.regras(r), ['uma so']);
    assert.deepEqual(r.j.avisos, []);
    const { porEntrega } = diario.lerAprendizados(amb.arvore);
    assert.equal(porEntrega.get('GM-10').filter((e) => e.tipo === 'aprendizado').length, 1);
  });

  test('extrato-diverge-vale-diario-e-avisa: mesma chave, conteúdo diferente ⇒ vale o diário e sai "extrato diverge"', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('original')]]);
    const doDiario = diario.ler(amb.entregas)[1];
    amb.escreverX([linhaX('GM-10', { ...doDiario, dados: { ...doDiario.dados, regra: 'adulterada' } })]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(amb.regras(r), ['original']);
    assert.deepEqual(r.j.avisos, ['aprendizados: extrato diverge do diário em GM-10/loop:2; vale o diário']);
  });

  test('chave-so-em-t-entra-sem-aviso: evento que não foi exportado entra, sem aviso', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('ja-exportado')]]);
    assert.equal(amb.cli(['aprendizados', '--exportar']).rc, 0);
    amb.semear([['aprendizado', dadosD('so-no-diario')]]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(amb.regras(r), ['so-no-diario', 'ja-exportado']);
    assert.deepEqual(r.j.avisos, []);
  });

  test('extrato-chave-por-evento-nao-por-entrega: pasta com só plano.json e X cheio ⇒ tudo de X entra; entrega com diário ganha a chave que só X tem', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('do-diario')]]);
    mkdirSync(join(amb.arvore, 'GM-7'));
    writeFileSync(join(amb.arvore, 'GM-7', 'plano.json'), JSON.stringify({ entrega: 'GM-7', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }] }));
    amb.escreverX([
      linhaX('GM-7', evento(2, dadosD('gm7-a'))), linhaX('GM-7', evento(3, dadosD('gm7-b'))), linhaX('GM-7', evento(4, dadosD('gm7-c'))),
      linhaX('GM-10', evento(7, dadosD('gm10-so-em-x'), { sessao: 'outra' })),
    ]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(new Set(amb.regras(r)), new Set(['do-diario', 'gm7-a', 'gm7-b', 'gm7-c', 'gm10-so-em-x']));
    assert.equal(r.j.aprendizados.length, 5);
    assert.deepEqual(r.j.avisos, []);
  });

  test('extrato-corrompido-avisa: linha que não é JSON ou fim truncado ⇒ aviso e só a árvore', () => {
    for (const [bruto, motivo] of [['isto nao e json\n', 'linha 1 não é JSON'], [`${linhaX('GM-7', evento(2, dadosD('x')))}\n{"entrega":"GM-7"`, 'última linha sem quebra (gravação interrompida)']]) {
      const amb = ambiente();
      amb.semear([DESCOBERTA, ['aprendizado', dadosD('da-arvore')]]);
      writeFileSync(amb.extrato, bruto);
      const r = amb.cli(['aprendizados']);
      assert.equal(r.rc, 0, r.out + r.err);
      assert.deepEqual(amb.regras(r), ['da-arvore']);
      assert.deepEqual(r.j.avisos, [`aprendizados: extrato corrompido (${motivo}); lido só o diário`]);
    }
  });

  test('extrato-symlink-ou-fifo-recusado: X symlink ou FIFO ⇒ corrompido, não trava, não segue o link e não é regravado', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('da-arvore')]]);
    const alvo = join(novoTmp(), 'alvo.jsonl');
    writeFileSync(alvo, `${linhaX('GM-7', evento(2, dadosD('pelo-link')))}\n`);
    symlinkSync(alvo, amb.extrato);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(amb.regras(r), ['da-arvore']);
    assert.deepEqual(r.j.avisos, ['aprendizados: extrato corrompido (não é arquivo regular); lido só o diário']);
    const e = amb.cli(['aprendizados', '--exportar']);
    assert.equal(e.rc, 1);
    assert.equal(e.j.erro, 'extrato_corrompido');
    assert.ok(lstatSync(amb.extrato).isSymbolicLink());
    assert.equal(readFileSync(alvo, 'utf8'), `${linhaX('GM-7', evento(2, dadosD('pelo-link')))}\n`);
    const fifo = ambiente();
    fifo.semear([DESCOBERTA, ['aprendizado', dadosD('da-arvore')]]);
    execFileSync('mkfifo', [fifo.extrato]);
    const f = fifo.cli(['aprendizados'], { timeout: 8000 });
    assert.equal(f.sinal, null, 'não travou');
    assert.deepEqual(fifo.regras(f), ['da-arvore']);
    assert.deepEqual(f.j.avisos, ['aprendizados: extrato corrompido (não é arquivo regular); lido só o diário']);
  });

  test('extrato-tipo-nao-aprendizado-nao-entra: task.integrada forjada em X não entra na árvore (o doctor não a veria como integrada)', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    amb.escreverX([linhaX('GM-10', evento(9, { task: 'T1' }, { tipo: 'task.integrada' })), linhaX('GM-10', evento(10, dadosD('valida')))]);
    const { porEntrega, avisos } = diario.lerAprendizados(amb.arvore);
    assert.deepEqual(porEntrega.get('GM-10').map((e) => `${e.tipo}:${e.seq}`), ['descoberta:1', 'aprendizado:10']);
    assert.deepEqual(avisos, ['aprendizados: extrato linha 1 fora (tipo não é aprendizado)']);
  });

  test('extrato-entrega-fora-da-forma-recusada: ../x, minúscula, _sem-id e chave extra ⇒ cada linha fora com aviso; nenhuma vira entrega', () => {
    const amb = ambiente({ plano: null });
    amb.escreverX([
      linhaX('../x', evento(2, dadosD('a'))), linhaX('gm-1', evento(2, dadosD('b'))), linhaX('_sem-id', evento(2, dadosD('c'))),
      JSON.stringify({ entrega: 'GM-1', evento: evento(2, dadosD('d')), extra: 1 }), linhaX('GM-1', evento(3, dadosD('e'))),
    ]);
    const { porEntrega, avisos } = diario.lerAprendizados(amb.arvore);
    assert.deepEqual([...porEntrega.keys()], ['GM-1', 'GM-10']);
    assert.deepEqual(porEntrega.get('GM-1').map((e) => e.dados.regra), ['e']);
    assert.deepEqual(avisos, [
      'aprendizados: extrato linha 1 fora (entrega fora da forma)', 'aprendizados: extrato linha 2 fora (entrega fora da forma)',
      'aprendizados: extrato linha 3 fora (entrega fora da forma)', 'aprendizados: extrato linha 4 fora (esperado {entrega, evento})',
    ]);
  });

  test('substitui-cruzado: só-X substitui um de T e um de T substitui um só-X; vigentes certos', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('a-em-t')], ['aprendizado', dadosD('c-em-t-substitui-d', ['instantaneo'], { substitui: { entrega: 'GM-3', sessao: 'loop', seq: 5 } })]]);
    amb.escreverX([
      linhaX('GM-2', evento(4, dadosD('b-em-x-substitui-a', ['instantaneo'], { substitui: { entrega: 'GM-10', sessao: 'loop', seq: 2 } }))),
      linhaX('GM-3', evento(5, dadosD('d-em-x'))),
    ]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(new Set(amb.regras(r)), new Set(['c-em-t-substitui-d', 'b-em-x-substitui-a']));
    assert.deepEqual(r.j.avisos, []);
  });

  test('juntados-em-ordem-sessao-seq: por entrega, os eventos ficam em (sessao, seq) depois da junção', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('l2')], ['aprendizado', dadosD('l3')]]);
    amb.escreverX([
      linhaX('GM-10', evento(2, dadosD('zz2'), { sessao: 'zzz' })), linhaX('GM-10', evento(10, dadosD('l10'))), linhaX('GM-10', evento(1, dadosD('aa1'), { sessao: 'aaa' })),
    ]);
    const { porEntrega } = diario.lerAprendizados(amb.arvore);
    assert.deepEqual(porEntrega.get('GM-10').map((e) => `${e.sessao}:${e.seq}`), ['aaa:1', 'loop:1', 'loop:2', 'loop:3', 'loop:10', 'zzz:2']);
  });

  test('versao-anterior-forma-aceita-entra-igual: linhas de X com os eventos gravados pelo 2.0.0 entram iguais (clone sem diário)', () => {
    const fonte = ambiente({ fixture: true });
    const eventos = diario.ler(join(fonte.arvore, 'GM-10'));
    const amb = ambiente();
    amb.escreverX(eventos.filter((e) => e.tipo === 'aprendizado').map((e) => linhaX('GM-10', e)));
    const { porEntrega, avisos } = diario.lerAprendizados(amb.arvore);
    assert.deepEqual(avisos, []);
    assert.deepEqual(porEntrega.get('GM-10'), eventos.filter((e) => e.tipo === 'aprendizado'));
    assert.deepEqual(aprendizadosVigentes(porEntrega).map((a) => a.regra), aprendizadosVigentes(new Map([['GM-10', eventos]])).map((a) => a.regra));
  });

  test('dados-julgados-como-no-diario: D sem regra em X fica fora dos vigentes como ficaria no diário (sem aviso de linha); D de papel removido segue na árvore', () => {
    const amb = ambiente({ plano: null });
    const semRegra = { tipo: 'E', status: 'D', gatilho: null, evidencia: {}, entra_em: ['instantaneo'] };
    const papelVelho = dadosD('papel-que-saiu', ['brief:papel-que-saiu']);
    amb.escreverX([linhaX('GM-7', evento(2, semRegra)), linhaX('GM-7', evento(3, papelVelho)), linhaX('GM-7', evento(4, dadosD('ok')))]);
    const { porEntrega, avisos } = diario.lerAprendizados(amb.arvore);
    assert.deepEqual(avisos, []);
    assert.equal(porEntrega.get('GM-7').length, 3, 'a árvore junta tem as 3; quem julga a forma de dados é o leitor');
    assert.deepEqual(aprendizadosVigentes(porEntrega).map((a) => a.regra), ['ok']);
  });

  test('ler-com-extrato-explicito: a opção `extrato` troca o arquivo lido (o padrão é <raiz>/.harness/aprendizados.jsonl)', () => {
    const amb = ambiente({ plano: null });
    const outro = join(novoTmp(), 'x.jsonl');
    writeFileSync(outro, `${linhaX('GM-5', evento(2, dadosD('de-outro')))}\n`);
    assert.deepEqual(diario.lerAprendizados(amb.arvore).porEntrega.get('GM-5'), undefined);
    assert.equal(diario.lerAprendizados(amb.arvore, { extrato: outro }).porEntrega.get('GM-5')[0].dados.regra, 'de-outro');
  });
});

// ─────────────────────────────────────────────────────────────── clone e troca de versão (P9: CLI real)

describe('extrato: clone novo e versão anterior', () => {
  test('clone-novo-le-do-extrato: cópia por git ls-files (sem diário) ⇒ mesmos vigentes, em todo destino', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    for (const [regra, entra] of [['do-implementador', 'brief:implementador'], ['do-revisor', 'brief:revisor'], ['do-instantaneo', 'instantaneo,spec']]) assert.equal(amb.cli(aprCli(regra, entra)).rc, 0);
    g(amb.dir, 'add', '--', '.harness/aprendizados.jsonl', '.harness/entregas/GM-10/plano.json');
    g(amb.dir, 'commit', '-q', '-m', 'docs: extrato');
    const clone = clonePorLsFiles(amb.dir);
    assert.deepEqual(readdirSync(join(clone, '.harness', 'entregas', 'GM-10')), ['plano.json']);
    const cli = (cwd, args) => JSON.parse(spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' }).stdout);
    for (const para of [[], ['--para', 'brief:implementador'], ['--para', 'brief:revisor'], ['--para', 'instantaneo'], ['--para', 'spec']]) {
      const a = cli(amb.dir, ['aprendizados', ...para]);
      const b = cli(clone, ['aprendizados', ...para]);
      assert.deepEqual(b.aprendizados, a.aprendizados, para.join(' '));
      assert.deepEqual(b.avisos, []);
    }
    assert.equal(cli(clone, ['aprendizados']).aprendizados.length, 3);
  });

  test('clone-novo-depois-aprendizado-nao-perde: no clone, aprendizado novo regrava X sem apagar as chaves que só existiam em X', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    assert.equal(amb.cli(aprCli('antiga-1')).rc, 0);
    assert.equal(amb.cli(aprCli('antiga-2')).rc, 0);
    // clone: a pasta da entrega existe (plano.json versionado) e o diário novo nasce vazio
    const clone = ambiente();
    writeFileSync(clone.extrato, amb.lerX());
    clone.semear([DESCOBERTA], { sessao: 'nova' });
    const r = clone.cli(['aprendizado', 'E', 'D', '--regra', 'nova', '--entra-em', 'instantaneo', '--eventos', 'nova:1', '--sessao', 'nova']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.extrato.linhas, 3);
    const chaves = clone.linhasX().map((l) => { const o = JSON.parse(l); return `${o.evento.sessao}:${o.evento.seq}:${o.evento.dados.regra}`; });
    assert.deepEqual(chaves, ['loop:2:antiga-1', 'loop:3:antiga-2', 'nova:2:nova']);
    assert.deepEqual(new Set(clone.regras(clone.cli(['aprendizados']))), new Set(['antiga-1', 'antiga-2', 'nova']));
  });

  test('versao-anterior-chega-ao-brief-do-papel (P9): árvore do 2.0.0 ⇒ proxima real leva ao implementador só o D dele, ao revisor só o dele, M a ninguém; o mesmo pelo extrato num clone', () => {
    const amb = ambiente({ fixture: true });
    const impl = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(impl.rc, 0, impl.out + impl.err);
    assert.deepEqual(itemDe(impl, 'T1', 'implementador').aprendizados, ['implementador roda o build antes do teste']);
    assert.ok(!JSON.stringify(impl.j).includes('hipotese sem medida'), 'M a ninguém');
    assert.ok(!JSON.stringify(impl.j).includes('regra antiga do implementador'), 'o substituído sai');
    assert.equal(amb.cli(['aprendizados', '--exportar']).rc, 0);
    const xDaVersaoAnterior = amb.lerX();
    amb.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }]]);
    const rev = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(rev.rc, 0, rev.out + rev.err);
    assert.deepEqual(itemDe(rev, 'T1', 'revisor').aprendizados, ['revisor roda as mutacoes antes do veredito']);
    assert.ok(!JSON.stringify(rev.j).includes('hipotese sem medida'));
    // outra máquina: só o extrato (versionado) e o plano
    const clone = ambiente({ fixture: false });
    writeFileSync(clone.extrato, xDaVersaoAnterior);
    writeFileSync(join(clone.entregas, 'plano.json'), readFileSync(join(FIXTURE, '.harness', 'entregas', 'GM-10', 'plano.json')));
    const ci = clone.cli(['proxima', '--vivos', '0']);
    assert.equal(ci.rc, 0, ci.out + ci.err);
    assert.deepEqual(itemDe(ci, 'T1', 'implementador').aprendizados, ['implementador roda o build antes do teste']);
    assert.ok(!JSON.stringify(ci.j).includes('hipotese sem medida'));
    assert.ok(!JSON.stringify(ci.j).includes('revisor roda as mutacoes'));
  });

  test('brief-sem-teto: 40 D de 300 caracteres do implementador (metade só em X) chegam todos ao item do proxima', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ...Array.from({ length: 20 }, (_, i) => ['aprendizado', dadosD(`t${String(i).padStart(2, '0')}${'x'.repeat(297)}`, ['brief:implementador'])])]);
    amb.escreverX(Array.from({ length: 20 }, (_, i) => linhaX('GM-9', evento(i + 2, dadosD(`x${String(i).padStart(2, '0')}${'y'.repeat(297)}`, ['brief:implementador'])))));
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    const lista = itemDe(r, 'T1', 'implementador').aprendizados;
    assert.equal(lista.length, 40);
    assert.ok(lista.join('').length > 800 * 10);
    assert.equal(lista.filter((l) => l.startsWith('x')).length, 20);
  });
});

// ─────────────────────────────────────────────────────────────── instantâneo e doctor (REQ-APR-5 c)

describe('extrato: instantâneo e doctor', () => {
  const legados = (n) => Array.from({ length: n }, (_, i) => linhaX('GM-9', evento(i + 2, dadosD(`legado-${String(i).padStart(2, '0')} ${'l'.repeat(30)}`), { ts: tsVelho(i + 2) })));

  test('instantaneo-corte-avisa-mais-antigos: 28 legados (X) + 10 novos (T) > 800 ⇒ novos primeiro, os mais antigos fora com o rodapé novo', () => {
    const amb = ambiente();
    amb.escreverX(legados(28));
    amb.semear([DESCOBERTA, ...Array.from({ length: 10 }, (_, i) => ['aprendizado', dadosD(`novo-${String(i).padStart(2, '0')} ${'n'.repeat(30)}`)])]);
    const r = amb.cli(['pousar']);
    assert.equal(r.rc, 0, r.out + r.err);
    const b = blocoApr(r.j.instantaneo);
    assert.equal(b[0], 'Aprendizados (38):');
    const linhas = b.slice(1, -1);
    assert.deepEqual(linhas.slice(0, 10).map((l) => l.slice(2, 9)), ['novo-09', 'novo-08', 'novo-07', 'novo-06', 'novo-05', 'novo-04', 'novo-03', 'novo-02', 'novo-01', 'novo-00']);
    assert.equal(linhas[10].slice(2, 11), 'legado-27', 'o legado mais recente vem logo depois dos novos');
    assert.equal(b.at(-1), RODAPE(38 - linhas.length));
    assert.ok(b.join('\n').length <= 800, String(b.join('\n').length));
    assert.ok(linhas.length < 38);
  });

  test('reserva-do-rodape-novo: 20 D de 35 caracteres ⇒ o rodapé novo do pior caso está reservado (18 linhas, não 19) e o bloco fica ≤ 800', () => {
    const { instantaneo } = diario.projetar([], { aprendizados: Array.from({ length: 20 }, (_, i) => ({ tipo: 'E', status: 'D', gatilho: null, evidencia: {}, regra: 'r'.repeat(35), entra_em: ['instantaneo'], entrega: 'GM-1', sessao: 'loop', seq: i + 1, ts: tsVelho(i + 1) })) });
    const b = blocoApr(instantaneo);
    assert.equal(b.length, 1 + 18 + 1);
    assert.equal(b.at(-1), RODAPE(2));
    assert.ok(b.join('\n').length <= 800, String(b.join('\n').length));
  });

  test('aviso-diverge-nao-conta-como-ilegivel: só divergência ⇒ linha do extrato, nunca "ilegível"; com 1 ilegível + divergência ⇒ 1 entrega ilegível', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('original')]]);
    const doDiario = diario.ler(amb.entregas)[1];
    amb.escreverX([linhaX('GM-10', { ...doDiario, dados: { ...doDiario.dados, regra: 'adulterada' } })]);
    const r = amb.cli(['pousar']);
    assert.equal(r.rc, 0, r.out + r.err);
    const b = blocoApr(r.j.instantaneo);
    assert.deepEqual(b, ['Aprendizados (1):', 'Aprendizados: extrato com 1 aviso(s); veja loop.mjs aprendizados', 'E original']);
    const amb2 = ambiente();
    amb2.semear([DESCOBERTA, ['aprendizado', dadosD('original')]]);
    const d2 = diario.ler(amb2.entregas)[1];
    amb2.escreverX([linhaX('GM-10', { ...d2, dados: { ...d2.dados, regra: 'adulterada' } })]);
    mkdirSync(join(amb2.arvore, 'GM-4'));
    writeFileSync(join(amb2.arvore, 'GM-4', 'events.loop.jsonl'), 'torto\n');
    const b2 = blocoApr(amb2.cli(['pousar']).j.instantaneo);
    assert.deepEqual(b2.slice(0, 3), ['Aprendizados (1):', 'Aprendizados: 1 entrega(s) ilegível(is); veja loop.mjs aprendizados', 'Aprendizados: extrato com 1 aviso(s); veja loop.mjs aprendizados']);
  });

  test('doctor-aprendizados-no-instantaneo: linha "aprendizados: N no instantâneo de M" com N do corte real (texto e --json)', () => {
    const doc = (dir, ...a) => spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'harness-doctor.mjs'), ...a], { cwd: dir, encoding: 'utf8' }).stdout;
    const poucos = ambiente();
    poucos.semear([DESCOBERTA, ['aprendizado', dadosD('a')], ['aprendizado', dadosD('b')], ['aprendizado', dadosD('so-brief', ['brief:revisor'])], ['aprendizado', dadosM('m')]]);
    assert.deepEqual(doctor.run(poucos.dir).aprendizados, { n: 2, m: 2 });
    assert.match(doc(poucos.dir), /^aprendizados: 2 no instantâneo de 2$/m);
    const muitos = ambiente();
    muitos.escreverX(legados(28));
    muitos.semear([DESCOBERTA, ...Array.from({ length: 10 }, (_, i) => ['aprendizado', dadosD(`novo-${i} ${'n'.repeat(30)}`)])]);
    const r = muitos.cli(['pousar']);
    const mostradas = blocoApr(r.j.instantaneo).filter((l) => /^[EA] /.test(l)).length;
    assert.ok(mostradas > 0 && mostradas < 38, String(mostradas));
    assert.deepEqual(doctor.run(muitos.dir).aprendizados, { n: mostradas, m: 38 });
    assert.match(doc(muitos.dir), new RegExp(`^aprendizados: ${mostradas} no instantâneo de 38$`, 'm'));
    assert.deepEqual(JSON.parse(doc(muitos.dir, '--json')).aprendizados, { n: mostradas, m: 38 });
    const vazio = ambiente({ plano: null });
    assert.match(doc(vazio.dir), /^aprendizados: 0 no instantâneo de 0$/m);
  });
});

// ─────────────────────────────────────────────────────────────── provisórios (sem regra na spec; vão ao dono)

describe('extrato: a escrita não cala aviso nem guarda token (r2)', () => {
  const ILEGIVEL_GM8 = 'aprendizados: GM-8 ilegível (linha 1 ilegível em events.loop.jsonl)';
  const gm8Ilegivel = (amb) => { mkdirSync(join(amb.arvore, 'GM-8')); writeFileSync(join(amb.arvore, 'GM-8', 'events.loop.jsonl'), 'torto\n'); };

  test('exportar-propaga-entrega-ilegivel: GM-8 ilegível ⇒ exporta o que leu, rc 0, aviso no extrato e no topo (nunca "ok, avisos: []")', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA, ['aprendizado', dadosD('gm10-lido')]]);
    gm8Ilegivel(amb);
    const r = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.extrato, { ok: true, linhas: 1, fora: 0, avisos: [ILEGIVEL_GM8] });
    assert.deepEqual(r.j.aviso, [ILEGIVEL_GM8]);
    assert.deepEqual(amb.linhasX().map((l) => JSON.parse(l).evento.dados.regra), ['gm10-lido']);
  });

  test('aprendizado-propaga-entrega-ilegivel: GM-8 ilegível ⇒ o aprendizado em GM-10 grava, regrava X e mostra o aviso no extrato e no topo', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    gm8Ilegivel(amb);
    const r = amb.cli(aprCli('gm10-novo'));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.extrato, { ok: true, linhas: 1, fora: 0, avisos: [ILEGIVEL_GM8] });
    assert.deepEqual(r.j.aviso, [ILEGIVEL_GM8]);
    assert.deepEqual(amb.linhasX().map((l) => JSON.parse(l).evento.dados.regra), ['gm10-novo']);
  });

  for (const via of ['aprendizado', 'exportar']) {
    test(`extrato-token-a-mao-sai-na-regravacao-${via}: linha de X escrita à mão com token sai do extrato regravado, com aviso; a linha limpa fica`, () => {
      const amb = ambiente();
      amb.semear([DESCOBERTA]);
      const limpa = linhaX('GM-7', evento(3, dadosD('ok-7')));
      amb.escreverX([linhaX('GM-7', evento(2, dadosD(`vazou ${TOKEN}`))), limpa]);
      const r = amb.cli(via === 'aprendizado' ? aprCli('nova') : ['aprendizados', '--exportar']);
      assert.equal(r.rc, 0, r.out + r.err);
      const AVISO = 'aprendizados: extrato linha 1 fora (canário ghp)';
      assert.deepEqual(r.j.extrato.avisos, [AVISO]);
      assert.deepEqual(r.j.aviso, [AVISO]);
      assert.ok(!amb.lerX().includes(TOKEN), 'o token saiu do extrato');
      assert.ok(!r.out.includes(TOKEN));
      assert.ok(amb.linhasX().includes(limpa), 'a linha limpa fica, byte a byte');
      assert.equal(amb.linhasX().length, via === 'aprendizado' ? 2 : 1);
    });
  }

  test('exportar-sem-nada-nao-cria-x: repositório sem aprendizado e sem X ⇒ rc 0, linhas 0, sem aviso e nenhum X vazio criado', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    const r = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.extrato, { ok: true, linhas: 0, fora: 0, avisos: [] });
    assert.equal(r.j.aviso, undefined);
    assert.equal(existsSync(amb.extrato), false);
  });

  test('exportar-evento-da-arvore-de-forma-recusada-avisa: aprendizado do diário com dados em texto ⇒ fora de X, conta em `fora` e avisa', () => {
    const amb = ambiente();
    amb.diarioManual('GM-10', 'loop', [DESCOBERTA, ['aprendizado', 'dados em texto'], ['aprendizado', dadosD('boa')]]);
    const r = amb.cli(['aprendizados', '--exportar']);
    assert.equal(r.rc, 0, r.out + r.err);
    const AVISO = 'aprendizados: extrato sem GM-10/loop:2 (dados não é objeto: não versionada)';
    assert.deepEqual(r.j.extrato, { ok: true, linhas: 1, fora: 1, avisos: [AVISO] });
    assert.deepEqual(r.j.aviso, [AVISO]);
    assert.deepEqual(amb.linhasX().map((l) => JSON.parse(l).evento.dados.regra), ['boa']);
  });
});

describe('extrato: provisórios conservadores', () => {
  test('extrato-corrompido-nao-regravado-provisorio: X corrompido ⇒ aprendizado grava no diário e não sobrescreve X; exportar recusa', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    writeFileSync(amb.extrato, 'isto nao e json\n');
    const r = amb.cli(aprCli('vai-ao-diario'));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(diario.ler(amb.entregas).at(-1).dados.regra, 'vai-ao-diario');
    assert.equal(amb.lerX(), 'isto nao e json\n');
    assert.deepEqual(r.j.extrato, { ok: false, motivo: 'extrato corrompido, não regravado', avisos: ['aprendizados: extrato corrompido (linha 1 não é JSON); lido só o diário'] });
    assert.deepEqual(r.j.aviso, ['extrato corrompido, não regravado; o evento está no diário: confira .harness/aprendizados.jsonl (loop.mjs aprendizados diz o motivo) e, corrigido, rode loop.mjs aprendizados --exportar']);
    const e = amb.cli(['aprendizados', '--exportar']);
    assert.equal(e.rc, 1);
    assert.equal(e.j.erro, 'extrato_corrompido');
    assert.equal(amb.lerX(), 'isto nao e json\n');
    // seguindo o aviso: com o extrato corrigido (aqui, vazio), o exportar traz o evento que ficou só no diário
    writeFileSync(amb.extrato, '');
    const depois = amb.cli(['aprendizados', '--exportar']);
    assert.equal(depois.rc, 0, depois.out + depois.err);
    assert.deepEqual(amb.linhasX().map((l) => JSON.parse(l).evento.dados.regra), ['vai-ao-diario']);
  });

  test('linha-forma-recusada-so-ela-fora-provisorio: JSON válido de forma recusada ⇒ só ela fica fora, com aviso; as demais valem; a regravação a preserva', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    const torta = linhaX('GM-7', evento(3, 'dados em texto'));
    amb.escreverX([linhaX('GM-7', evento(2, dadosD('antes'))), torta, linhaX('GM-7', evento(4, dadosD('depois')))]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(new Set(amb.regras(r)), new Set(['antes', 'depois']));
    assert.deepEqual(r.j.avisos, ['aprendizados: extrato linha 2 fora (dados não é objeto)']);
    const w = amb.cli(aprCli('nova'));
    assert.equal(w.rc, 0, w.out + w.err);
    const x = amb.linhasX();
    assert.equal(x.at(-1), torta, 'a linha recusada é preservada no fim, byte a byte');
    assert.equal(x.length, 4);
    const b = amb.lerX();
    assert.equal(amb.cli(['aprendizados', '--exportar']).rc, 0);
    assert.equal(amb.lerX(), b, 'idempotente com a linha preservada');
  });

  test('entrega-ilegivel-chaves-do-extrato-entram-provisorio: GM-8 ilegível em T ⇒ as chaves dela em X entram, o aviso continua e a regravação as mantém', () => {
    const amb = ambiente();
    amb.semear([DESCOBERTA]);
    mkdirSync(join(amb.arvore, 'GM-8'));
    writeFileSync(join(amb.arvore, 'GM-8', 'events.loop.jsonl'), 'torto\n');
    amb.escreverX([linhaX('GM-8', evento(2, dadosD('gm8-do-extrato')))]);
    const r = amb.cli(['aprendizados']);
    assert.deepEqual(amb.regras(r), ['gm8-do-extrato']);
    assert.deepEqual(r.j.avisos, ['aprendizados: GM-8 ilegível (linha 1 ilegível em events.loop.jsonl)']);
    assert.equal(amb.cli(aprCli('nova')).rc, 0);
    assert.ok(amb.linhasX().some((l) => JSON.parse(l).entrega === 'GM-8'));
  });
});

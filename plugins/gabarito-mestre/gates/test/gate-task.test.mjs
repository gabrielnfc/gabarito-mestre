/**
 * Testes do gate de task (REQ-LOOP-4). Repositório git temporário por caso; nada fixo do repo do plugin.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte): ver task-3-mut.json da entrega.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avaliar } from '../scripts/gate-task.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '../scripts/gate-task.mjs');
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

function repo({ branch = 'wt/GM-10-3' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-task-'));
  g(dir, 'init', '-q', '-b', 'main');
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.txt'), 'ORIG\n');
  g(dir, 'add', 'src/a.txt');
  g(dir, 'commit', '-q', '-m', 'chore: base');
  const base = g(dir, 'rev-parse', 'HEAD').trim();
  if (branch) g(dir, 'checkout', '-q', '-b', branch);
  return { dir, base };
}
function commit(dir, arquivo, conteudo, msg = 'feat(GM-10): x') {
  mkdirSync(dirname(join(dir, arquivo)), { recursive: true });
  writeFileSync(join(dir, arquivo), conteudo);
  g(dir, 'add', arquivo);
  g(dir, 'commit', '-q', '-m', msg);
}
const texto = (r) => r.relato.join('\n');
const verde = { suites: [{ nome: 'ok', cmd: 'exit 0' }] };

describe('gate-task', () => {
  test('gate-0-commits: sem commits contra a base reprova', async () => {
    const { dir, base } = repo();
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /0 commits/);
  });

  test('gate-verde: commit no padrão, árvore limpa, suíte verde', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.equal(r.reprova, 0, texto(r));
  });

  test('gate-arvore-suja', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    writeFileSync(join(dir, 'solto.txt'), 'x');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /árvore suja/);
  });

  test('gate-commit-fora-padrao: escopo do card vem da branch', async () => {
    const { dir, base } = repo({ branch: 'wt/ABC-7-2' });
    commit(dir, 'src/b.txt', 'b\n', 'feat(GM-10): card errado');
    commit(dir, 'src/c.txt', 'c\n', 'conserto qualquer');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /commit fora do padrão(?=.*card errado)(?=.*conserto qualquer)/s);
  });

  test('gate-card-pela-branch e --card', async () => {
    const a = repo({ branch: 'wt/ABC-7-2' });
    commit(a.dir, 'src/b.txt', 'b\n', 'feat(ABC-7): ok');
    assert.equal((await avaliar({ wt: a.dir, base: a.base, ...verde })).reprova, 0);
    const b = repo({ branch: 'principal' });
    commit(b.dir, 'src/b.txt', 'b\n', 'feat(XYZ-3): ok');
    const sem = await avaliar({ wt: b.dir, base: b.base, ...verde });
    assert.ok(sem.reprova > 0);
    assert.match(texto(sem), /sem card/);
    assert.equal((await avaliar({ wt: b.dir, base: b.base, card: 'XYZ-3', ...verde })).reprova, 0);
  });

  test('gate-base-inexistente: reprova com mensagem, sem stack', async () => {
    const { dir } = repo();
    const r = await avaliar({ wt: dir, base: 'nao-existe-xyz', ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /base inexistente/);
    assert.doesNotMatch(texto(r), /\bat \w+.*\(.*:\d+:\d+\)/);
  });

  test('gate-fora-do-escopo: prefixo, diretório só com barra final', async () => {
    const { dir, base } = repo();
    commit(dir, 'src-outro/x.txt', 'x\n');
    const r = await avaliar({ wt: dir, base, files: ['src/'], ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /fora do escopo: src-outro\/x\.txt/);
    const r2 = await avaliar({ wt: dir, base, files: ['src'], ...verde });
    assert.match(texto(r2), /fora do escopo/, 'sem barra final, src não é diretório');
    const r3 = await avaliar({ wt: dir, base, files: ['src-outro/'], ...verde });
    assert.equal(r3.reprova, 0, texto(r3));
    const r4 = await avaliar({ wt: dir, base, files: ['src-outro/x.txt'], ...verde });
    assert.equal(r4.reprova, 0, texto(r4));
  });

  test('gate-arquivo-proibido: lista vem da config/opts', async () => {
    const { dir, base } = repo();
    commit(dir, 'privado/y.txt', 'y\n');
    assert.equal((await avaliar({ wt: dir, base, ...verde })).reprova, 0);
    const r = await avaliar({ wt: dir, base, proibidos: ['^privado/'], ...verde });
    assert.match(texto(r), /arquivo proibido.*privado\/y\.txt/);
  });

  test('gate-segredo: linha adicionada fora de teste reprova; em teste só lista', async () => {
    const seg = 'tok = ghp_' + 'a'.repeat(30) + '\n';
    const a = repo();
    commit(a.dir, 'src/s.txt', seg);
    const ra = await avaliar({ wt: a.dir, base: a.base, ...verde });
    assert.ok(ra.reprova > 0);
    assert.match(texto(ra), /possível segredo/);
    const b = repo();
    commit(b.dir, 'test/s.test.txt', seg);
    const rb = await avaliar({ wt: b.dir, base: b.base, ...verde });
    assert.equal(rb.reprova, 0, texto(rb));
    assert.match(texto(rb), /revisor confere/);
    const c = repo();
    commit(c.dir, 'test/s.test.txt', 'nada\n');
    commit(c.dir, 'src/s.txt', seg, 'feat(GM-10): segredo fora, teste junto');
    const rc = await avaliar({ wt: c.dir, base: c.base, ...verde });
    assert.ok(rc.reprova > 0, 'teste no mesmo diff não perdoa segredo em arquivo de produto');
  });

  test('gate-hatch-e-allow: GABARITO_ALLOW aumentar e allow adicionado reprovam', async () => {
    const a = repo();
    commit(a.dir, 'src/h.txt', 'GABARITO_ALLOW=1\n');
    assert.match(texto(await avaliar({ wt: a.dir, base: a.base, ...verde })), /GABARITO_ALLOW aumentou/);
    const b = repo();
    commit(b.dir, 'src/p.txt', 'permissionDecision: "allow"\n');
    assert.match(texto(await avaliar({ wt: b.dir, base: b.base, ...verde })), /allow adicionado/);
  });

  test('gate-suite-vermelha e suíte pela config gates.suites', async () => {
    const { dir, base } = repo();
    writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ gates: { suites: ['exit 3'] } }));
    g(dir, 'add', 'harness.config.json');
    g(dir, 'commit', '-q', '-m', 'chore: config');
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /rc=3/);
    const r2 = await avaliar({ wt: dir, base, suites: [{ nome: 'ok', cmd: 'exit 0' }] });
    assert.equal(r2.reprova, 0, 'suítes de opts vencem a config');
  });

  test('gate-sem-suite: aviso visível, não silêncio', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base });
    assert.match(texto(r), /AVISO.*nenhuma suíte/);
  });

  test('gate-red-por-nome-so-da-task (A2)', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const falha = (nome) => ({ nome: 's', cmd: `echo '✖ ${nome} (1.2ms)'; echo 'ℹ fail 1'; exit 1` });
    const conhecido = await avaliar({ wt: dir, base, red: ['teste-esperado'], suites: [falha('teste-esperado')] });
    assert.equal(conhecido.reprova, 0, texto(conhecido));
    assert.match(texto(conhecido), /só RED conhecido/);
    const outro = await avaliar({ wt: dir, base, red: ['teste-esperado'], suites: [falha('teste-de-outra-task')] });
    assert.ok(outro.reprova > 0);
    assert.match(texto(outro), /teste-de-outra-task/);
    const semLista = await avaliar({ wt: dir, base, suites: [falha('teste-esperado')] });
    assert.ok(semLista.reprova > 0);
  });

  test('gate-red-saida-sem-nome nunca vira RED conhecido', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, red: ['teste-esperado'], suites: [{ nome: 's', cmd: 'echo quebrou; exit 1' }] });
    assert.ok(r.reprova > 0);
    const parcial = await avaliar({
      wt: dir, base, red: ['teste-esperado'],
      suites: [{ nome: 's', cmd: "echo '✖ teste-esperado (1ms)'; echo 'ℹ fail 2'; exit 1" }],
    });
    assert.ok(parcial.reprova > 0, 'fail 2 com 1 nome reconhecido: sobra falha sem nome');
  });

  const mut = (extra = {}) => ({
    nome: 'm1', arquivo: 'src/a.txt', de: 'ORIG', para: 'MUT', teste: 'grep -q ORIG src/a.txt', ...extra,
  });
  // `sleep` garante duração acima do limiar de tempo zero.
  const lento = 'sleep 0.15; grep -q ORIG src/a.txt';

  test('gate-mutacao-morta', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ teste: lento })], ...verde });
    assert.equal(r.reprova, 0, texto(r));
    assert.match(texto(r), /mutação m1 morta/);
  });

  test('gate-mutacao-viva reprova', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ teste: 'sleep 0.15; exit 0' })], ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /mutação m1 VIVA/);
  });

  test('gate-teste-ja-falha-sem-mutacao (E19): morte falsa não conta', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ teste: 'sleep 0.15; exit 1' })], ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /já falha sem mutação/);
    assert.doesNotMatch(texto(r), /m1 morta/);
  });

  test('gate-tempo-zero-alerta: alerta visível, não veredito', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut()], ...verde });
    assert.match(texto(r), /ALERTA.*m1.*tempo/);
    assert.doesNotMatch(texto(r), /m1 morta/);
    assert.doesNotMatch(texto(r), /m1 VIVA/);
    assert.equal(r.reprova, 0);
    assert.equal(r.alertas, 1);
  });

  test('gate-mutacao-trecho-repetido: reprova sem mutar', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/r.txt', 'AA\nAA\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ arquivo: 'src/r.txt', de: 'AA', teste: lento })], ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /aparece 2 vezes/);
    assert.equal(readFileSync(join(dir, 'src/r.txt'), 'utf8'), 'AA\nAA\n');
  });

  test('gate-mutacao-trecho-ausente e mutação sem efeito reprovam', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const a = await avaliar({ wt: dir, base, mutacoes: [mut({ de: 'NAOEXISTE', teste: lento })], ...verde });
    assert.match(texto(a), /trecho não encontrado/);
    const b = await avaliar({ wt: dir, base, mutacoes: [mut({ para: 'ORIG', teste: lento })], ...verde });
    assert.match(texto(b), /não altera/);
  });

  test('gate-mutacao-fora-da-worktree reprova', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ arquivo: '../fora.txt', teste: lento })], ...verde });
    assert.match(texto(r), /fora da worktree/);
  });

  test('gate-restaura-arvore: teste lança na rodada mutada, arquivo volta', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    let chamadas = 0;
    const rodar = async (nome, cmd, cwd) => {
      if (/^m1/.test(nome) && chamadas++ > 0) throw new Error('explodiu');
      if (/sem mutação/.test(nome)) return { nome, rc: 0, out: '', ms: 500 };
      return { nome, rc: 0, out: '', ms: 5 };
    };
    await assert.rejects(avaliar({ wt: dir, base, mutacoes: [mut()], rodar, ...verde }), /explodiu/);
    assert.equal(readFileSync(join(dir, 'src/a.txt'), 'utf8'), 'ORIG\n');
    assert.equal(g(dir, 'status', '--short').trim(), '');
  });

  test('gate-restaura-arvore: após mutações a árvore segue limpa e relata', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ teste: lento })], ...verde });
    assert.match(texto(r), /árvore restaurada/);
    assert.equal(g(dir, 'status', '--short').trim(), '');
  });
});

describe('gate-task CLI', () => {
  test('--help-less: sem argumentos sai 2 com uso; reprovado sai 1; verde sai 0', () => {
    const sem = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    assert.equal(sem.status, 2);
    assert.match(sem.stderr, /uso:/i);
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const ok = spawnSync(process.execPath, [CLI, dir, base, '--suite', 'exit 0', '--suite', 'true'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /GATE VERDE/);
    const ruim = spawnSync(process.execPath, [CLI, dir, base, '--suite', 'exit 1'], { encoding: 'utf8' });
    assert.equal(ruim.status, 1);
    assert.match(ruim.stdout, /GATE REPROVADO/);
  });

  test('CLI lê --red, --files e --mut de arquivo', () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const aux = mkdtempSync(join(tmpdir(), 'gate-aux-'));
    writeFileSync(join(aux, 'red.txt'), 'teste-esperado\n');
    writeFileSync(join(aux, 'files.txt'), 'src/\n');
    writeFileSync(join(aux, 'mut.json'), JSON.stringify([{ nome: 'm', arquivo: 'src/a.txt', de: 'ORIG', para: 'X', teste: 'sleep 0.15; grep -q ORIG src/a.txt' }]));
    const r = spawnSync(process.execPath, [CLI, dir, base, '--red', join(aux, 'red.txt'), '--files', join(aux, 'files.txt'), '--mut', join(aux, 'mut.json'),
      '--suite', "echo '✖ teste-esperado (1ms)'; echo 'ℹ fail 1'; exit 1"], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /mutação m morta/);
  });
});

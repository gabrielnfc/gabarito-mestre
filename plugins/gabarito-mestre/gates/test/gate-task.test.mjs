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
import { avaliar, falhas, desviosDaTask } from '../scripts/gate-task.mjs';
import { append } from '../dist/diario.js';

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
const hatch = ['GABARITO', 'ALLOW'].join('_');
const texto = (r) => r.relato.join('\n');
// Suíte verde só com prova positiva: rc 0 e ao menos 1 teste contado na saída.
const conta = (n = 3) => `echo 'ℹ tests ${n}'; echo 'ℹ pass ${n}'; echo 'ℹ fail 0'`;
const verde = { suites: [{ nome: 'ok', cmd: conta() }] };
const vermelhoCru = (nome, { total = 1, quebras = 1, rc = 1, extra = '' } = {}) => ({
  nome: 's', cmd: `echo '✖ ${nome} (1.2ms)'; echo 'ℹ tests ${total}'; echo 'ℹ fail ${quebras}'; ${extra}exit ${rc}`,
});
// Com --red a suíte é comando simples (gate exige): o corpo composto vai para um script fora do repo.
const script = (cmd) => {
  const f = join(mkdtempSync(join(tmpdir(), 'gate-task-sh-')), 'suite.sh');
  writeFileSync(f, `${cmd}\n`);
  return `bash ${f}`;
};
const vermelho = (nome, o) => ({ nome: 's', cmd: script(vermelhoCru(nome, o).cmd) });
const nWorktrees = (dir) => g(dir, 'worktree', 'list').trim().split('\n').length;

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

  test('gate-status-ignora-config-local: status.showUntrackedFiles=no não esconde arquivo novo', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    g(dir, 'config', 'status.showUntrackedFiles', 'no');
    writeFileSync(join(dir, 'solto.txt'), 'x');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.ok(r.reprova > 0, texto(r));
    assert.match(texto(r), /árvore suja/);
  });

  test('gate-status-ignorado: ignorado nunca reprova (existente nem novo de mutação) e é relatado', async () => {
    const { dir, base } = repo();
    commit(dir, '.gitignore', 'oculto.txt\n*.cache\n');
    writeFileSync(join(dir, 'oculto.txt'), 'x');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.equal(r.reprova, 0, texto(r));
    assert.match(texto(r), /AVISO +1 ignorado\(s\) na worktree: oculto\.txt/);
    const rodar = async (nome) => {
      if (nome === 'm1') writeFileSync(join(dir, 'novo.cache'), 'x');
      return { nome, rc: nome === 'm1' ? 1 : 0, out: nome === 'ok' ? 'ℹ tests 3\nℹ pass 3\nℹ fail 0' : '', ms: 500 };
    };
    const r2 = await avaliar({ wt: dir, base, mutacoes: [mut()], rodar, ...verde });
    assert.equal(r2.reprova, 0, texto(r2));
    assert.match(texto(r2), /AVISO +1 ignorado\(s\) gerado\(s\) no gate: novo\.cache/);
  });

  test('gate-status-tmpdir-do-loop: .tmp-gabarito/ (achados do revisor na worktree, ignora a si mesmo) não aparece; outro ignorado é relatado', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    mkdirSync(join(dir, '.tmp-gabarito'));
    writeFileSync(join(dir, '.tmp-gabarito', '.gitignore'), '*\n');
    writeFileSync(join(dir, '.tmp-gabarito', 'x'), 'x');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.equal(r.reprova, 0, texto(r));
    mkdirSync(join(dir, '.tmp-outro'));
    writeFileSync(join(dir, '.tmp-outro', '.gitignore'), '*\n');
    assert.doesNotMatch(texto(r), /tmp-gabarito/);
    const r2 = await avaliar({ wt: dir, base, ...verde });
    assert.match(texto(r2), /AVISO +1 ignorado\(s\) na worktree: \.tmp-outro\//);
    assert.doesNotMatch(texto(r2), /tmp-gabarito/);
  });

  test('gate-status-final-mesma-forma: mutação que deixa arquivo novo reprova mesmo com showUntrackedFiles=no', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    g(dir, 'config', 'status.showUntrackedFiles', 'no');
    // o teste da mutação cria um arquivo novo na worktree: a checagem final de árvore restaurada tem que vê-lo
    const rodar = async (nome) => {
      if (nome === 'm1') writeFileSync(join(dir, 'lixo-da-mutacao.txt'), 'x');
      return { nome, rc: nome === 'm1' ? 1 : 0, out: '', ms: 500 };
    };
    const r = await avaliar({ wt: dir, base, mutacoes: [mut()], rodar, ...verde });
    assert.match(texto(r), /FALHA +mutação deixou árvore alterada/, texto(r));
  });

  // Estados 3 a 12 da tabela Q1 da Sombra (sombra-t12.md). O teste da mutação "morre" com sleep: o gate exige ms >= 100.
  const conta3 = conta();
  const morre = (corpo = '') => `grep -q c src/b.txt && { ${corpo}sleep 0.4; exit 1; }; exit 0`;
  const comMut = (cmdTeste) => ({ mutacoes: [{ nome: 'm1', arquivo: 'src/b.txt', de: 'b', para: 'c', teste: cmdTeste }] });
  const caso = (ignore = '') => {
    const r = repo();
    if (ignore) commit(r.dir, '.gitignore', ignore);
    commit(r.dir, 'src/b.txt', 'b\n');
    return r;
  };

  test('gate-suite-gera-ignorado: ignorado gerado pela suíte não reprova, é relatado (caso A)', async () => {
    const { dir, base } = caso('__pycache__/\n');
    const suites = [{ nome: 's', cmd: `mkdir -p __pycache__; echo x > __pycache__/l.pyc; ${conta3}` }];
    const r = await avaliar({ wt: dir, base, suites, ...comMut(morre()) });
    assert.equal(r.reprova, 0, texto(r));
    assert.match(texto(r), /AVISO +1 ignorado\(s\) gerado\(s\) no gate: __pycache__\//);
  });

  test('gate-falha-gera-ignorado: ignorado que só nasce quando o teste da mutação falha não reprova (caso B)', async () => {
    const { dir, base } = caso('test-results/\n');
    const r = await avaliar({ wt: dir, base, ...verde, ...comMut(morre('mkdir -p test-results; echo x > test-results/f; ')) });
    assert.equal(r.reprova, 0, texto(r));
    assert.match(texto(r), /AVISO +1 ignorado\(s\) gerado\(s\) no gate: test-results\//);
  });

  test('gate-mutacao-apaga-ignorado: mutação que apaga ignorado existente não reprova (caso I)', async () => {
    const { dir, base } = caso('dist/\n');
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'x.js'), '1');
    const r = await avaliar({ wt: dir, base, ...verde, ...comMut(morre('rm dist/x.js; ')) });
    assert.equal(r.reprova, 0, texto(r));
  });

  test('gate-falha-suite-e-ignorado: suíte que falha reprova pela suíte, com o AVISO do ignorado (caso J)', async () => {
    const { dir, base } = caso('cov/\n');
    const r = await avaliar({ wt: dir, base, suites: [{ nome: 's', cmd: 'mkdir -p cov; echo x > cov/l; exit 1' }] });
    assert.ok(r.reprova > 0, texto(r));
    assert.match(texto(r), /FALHA +s rc=1/);
    assert.match(texto(r), /AVISO +1 ignorado\(s\) gerado\(s\) no gate: cov\//);
  });

  test('gate-suite-altera-arvore: suíte que cria não ignorado ou altera rastreado reprova, com ou sem mutação (casos C, D, E)', async () => {
    for (const [cmd, esperado] of [['echo x > coverage.out', /\?\? coverage\.out/], ['echo y >> src/b.txt', /M src\/b\.txt/]]) {
      const { dir, base } = caso();
      const suites = [{ nome: 's', cmd: `${cmd}; ${conta3}` }];
      const r = await avaliar({ wt: dir, base, suites });
      assert.ok(r.reprova > 0, texto(r));
      assert.match(texto(r), /FALHA +suíte alterou a árvore/);
      assert.match(texto(r), esperado);
    }
    const { dir, base } = caso();
    const suites = [{ nome: 's', cmd: `echo x > coverage.out; ${conta3}` }];
    const r = await avaliar({ wt: dir, base, suites, ...comMut(morre()) });
    assert.equal(r.reprova, 1, `culpa só a suíte, não a mutação:\n${texto(r)}`);
    assert.match(texto(r), /FALHA +suíte alterou a árvore/);
    assert.doesNotMatch(texto(r), /mutação deixou árvore alterada/);
  });

  test('gate-status-branch-config: status.branch=true não inventa sujeira (caso H)', async () => {
    const { dir, base } = caso();
    g(dir, 'config', 'status.branch', 'true');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.equal(r.reprova, 0, texto(r));
    assert.match(texto(r), /ok +árvore limpa/);
  });

  test('gate-mutacao-deixa-nao-rastreado: teste da mutação que deixa arquivo novo reprova, nomeando a mutação (caso F)', async () => {
    const { dir, base } = caso();
    const r = await avaliar({ wt: dir, base, ...verde, ...comMut(morre('echo x > sobra.txt; ')) });
    assert.match(texto(r), /FALHA +mutação deixou árvore alterada/, texto(r));
  });

  test('gate-git-falha-nunca-verde: git status que falha depois das suítes lança, nunca devolve verde (caso K)', async () => {
    const { dir, base } = caso();
    const suites = [{ nome: 's', cmd: `mv .git .gitX; ${conta3}` }];
    await assert.rejects(() => avaliar({ wt: dir, base, suites }));
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

  test(`gate-hatch-e-allow: ${hatch} aumentar e allow adicionado reprovam`, async () => {
    const a = repo();
    commit(a.dir, 'src/h.txt', `${hatch}=1\n`);
    assert.match(texto(await avaliar({ wt: a.dir, base: a.base, ...verde })), new RegExp(`${hatch} aumentou`));
    const b = repo();
    commit(b.dir, 'src/p.txt', `permissionDecision: "${'al' + 'low'}"\n`);
    assert.match(texto(await avaliar({ wt: b.dir, base: b.base, ...verde })), /^FALHA +allow adicionado$/m);
    const c = repo();
    commit(c.dir, 'src/q.txt', 'nada\n');
    const rc = await avaliar({ wt: c.dir, base: c.base, ...verde });
    assert.match(texto(rc), /^ok +sem allow adicionado$/m);
    assert.doesNotMatch(texto(rc), /^FALHA +allow/m);
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
    const r2 = await avaliar({ wt: dir, base, ...verde });
    assert.equal(r2.reprova, 0, 'suítes de opts vencem a config');
  });

  test('gate-sem-suite: reprova, nada rodou não é verde', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /FALHA +nenhuma suíte/);
    assert.doesNotMatch(texto(r), /AVISO.*nenhuma suíte/);
  });

  test('gate-red-por-nome-so-da-task (A2)', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const falha = (nome) => vermelho(nome);
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
      suites: [vermelho('teste-esperado', { total: 2, quebras: 2 })],
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
  // ---- Rodada 2: VERDE exige prova positiva ----

  test('suíte: rc 0 sem teste contado não é verde (true, echo sem prefixo, tests 0, glob vazio)', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    for (const cmd of ['true', '', 'echo tests 5', "echo 'ℹ tests 0'; echo 'ℹ pass 0'", "node --test 'nao/existe/*.test.mjs'"]) {
      const r = await avaliar({ wt: dir, base, suites: [{ nome: 's', cmd }] });
      assert.ok(r.reprova > 0, `deveria reprovar: ${JSON.stringify(cmd)}\n${texto(r)}`);
      assert.doesNotMatch(texto(r), /ok +s verde/);
    }
  });

  test('suíte: marcador sem contagem é explícito, relatado e contado à parte', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, suites: [{ nome: 'bash', cmd: 'echo tests 5', semContagem: true }] });
    assert.equal(r.reprova, 0, texto(r));
    assert.match(texto(r), /sem contagem de testes, marcador declarado/);
    assert.equal(r.semContagem, 1);
    assert.equal(r.testes, 0);
    const falso = await avaliar({ wt: dir, base, suites: [{ nome: 'bash', cmd: 'exit 1', semContagem: true }] });
    assert.ok(falso.reprova > 0, 'marcador não perdoa rc diferente de zero');
  });

  test('suíte: pipe sem pipefail não esconde falha (false | true)', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const a = await avaliar({ wt: dir, base, suites: [{ nome: 'p', cmd: 'false | true', semContagem: true }] });
    assert.ok(a.reprova > 0, texto(a));
    const b = await avaliar({ wt: dir, base, suites: [{ nome: 'p', cmd: `(${vermelhoCru('novo-quebrado').cmd}) | tail -5` }] });
    assert.ok(b.reprova > 0, texto(b));
  });

  test('suíte: rc 0 com a saída declarando fail N reprova', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const rodar = async (nome) => ({ nome, rc: 0, out: '✖ x (1ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\n', ms: 5 });
    const r = await avaliar({ wt: dir, base, rodar, suites: ['qualquer'] });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /rc=0 mas a saída declara fail 1/);
  });

  test('RED: rc por sinal ou diferente de 1 nunca é RED conhecido', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const red = ['esperado'];
    const porSinal = await avaliar({ wt: dir, base, red, suites: [vermelho('esperado', { extra: 'kill -9 $$; ' })] });
    assert.ok(porSinal.reprova > 0, texto(porSinal));
    assert.doesNotMatch(texto(porSinal), /só RED conhecido/);
    assert.match(texto(porSinal), /rc anormal ou morte por sinal/);
    const rc137 = await avaliar({ wt: dir, base, red, suites: [vermelho('esperado', { rc: 137 })] });
    assert.ok(rc137.reprova > 0, texto(rc137));
    assert.match(texto(rc137), /rc anormal ou morte por sinal/);
    const rc2 = await avaliar({ wt: dir, base, red, suites: [vermelho('esperado', { rc: 2 })] });
    assert.ok(rc2.reprova > 0, 'node --test sai 1; rc 2 é outro erro (runner, sintaxe)');
    assert.doesNotMatch(texto(rc2), /só RED conhecido/);
    assert.doesNotMatch(texto(rc2), /rc anormal/, 'rc 2 é normal, só não é o 1 do runner');
  });

  test('RED: sem resumo, ou com falha extra sem nome (outro runner), nunca entra', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const red = ['esperado'];
    const semResumo = await avaliar({ wt: dir, base, red, suites: [{ nome: 's', cmd: "echo '✖ esperado (1ms)'; exit 1" }] });
    assert.ok(semResumo.reprova > 0, texto(semResumo));
    const doisRunners = await avaliar({
      wt: dir, base, red,
      suites: [{ nome: 's', cmd: script(`${vermelhoCru('esperado', { rc: 0 }).cmd}; echo 'ℹ tests 1'; echo 'ℹ fail 1'; echo boom-sintaxe; exit 1`) }],
    });
    assert.ok(doisRunners.reprova > 0, texto(doisRunners));
    assert.doesNotMatch(texto(doisRunners), /só RED conhecido/);
  });

  describe('RED conhecido só com suíte simples', () => {
    const resumo = "echo '✖ esperado (1ms)'; echo 'ℹ tests 1'; echo 'ℹ fail 1'";
    const causa = /FALHA\s+suíte s: com --red, a suíte precisa ser comando simples/;
    const rodaCom = async (cmd, red = ['esperado']) => {
      const { dir, base } = repo();
      commit(dir, 'src/b.txt', 'b\n');
      return avaliar({ wt: dir, base, red, suites: [{ nome: 's', cmd }] });
    };
    test('red-suite-and-reprova', async () => {
      const r = await rodaCom(`node -e "process.exit(0)" && ${resumo}; exit 1`);
      assert.ok(r.reprova > 0, texto(r));
      assert.match(texto(r), causa);
      assert.doesNotMatch(texto(r), /só RED conhecido/);
    });
    test('red-suite-ponto-virgula-reprova', async () => {
      const r = await rodaCom(`${resumo}; exit 1`);
      assert.match(texto(r), causa);
      assert.doesNotMatch(texto(r), /só RED conhecido/);
    });
    test('red-suite-pipe-reprova', async () => {
      const r = await rodaCom('echo x | cat');
      assert.match(texto(r), causa);
      const ou = await rodaCom('false || true');
      assert.match(texto(ou), causa);
      const sub = await rodaCom('echo $(echo x)');
      assert.match(texto(sub), causa);
      const crase = await rodaCom('echo `echo x`');
      assert.match(texto(crase), causa);
      const fundo = await rodaCom('echo x &');
      assert.match(texto(fundo), causa);
      const quebra = await rodaCom('echo x\necho y');
      assert.match(texto(quebra), causa);
    });
    test('red-suite-simples-segue', async () => {
      const { dir, base } = repo();
      commit(dir, 'src/b.txt', 'b\n');
      writeFileSync(join(dir, 'red.sh'), `${resumo}\nexit 1\n`);
      const r = await avaliar({ wt: dir, base, red: ['esperado'], suites: [{ nome: 's', cmd: 'bash red.sh' }] });
      assert.doesNotMatch(texto(r), causa);
      assert.match(texto(r), /só RED conhecido: 1/);
    });
    test('sem-red-suite-composta-segue', async () => {
      const r = await rodaCom(conta(), []);
      assert.doesNotMatch(texto(r), causa);
      assert.match(texto(r), /verde: 3 teste/);
      const semOpcao = await rodaCom(conta(), null);
      assert.doesNotMatch(texto(semOpcao), causa);
    });
  });

  test('falhas(): nomes vêm da seção "failing tests" quando existe (suíte pai não conta)', () => {
    const out = ['  ✖ filho-ruim (0.2ms)', '✖ pai (0.6ms)', 'ℹ tests 2', 'ℹ fail 1', '', '✖ failing tests:', '', '✖ filho-ruim (0.2ms)', '  Error: x'].join('\n');
    const f = falhas(out);
    assert.deepEqual(f.nomes, ['filho-ruim']);
    assert.equal(f.declaradas, 1);
    assert.equal(falhas('ℹ fail 1\nℹ fail 2').declaradas, 3, 'resumos de vários runners somam');
    assert.equal(falhas('nada').declaradas, null);
  });

  test('A4: nome em --red só vale se falha na base, medido em worktree detached removida', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const so = (marca) => ({
      nome: 's', cmd: script(`if [ -f ${marca} ]; then echo '✖ teste-esperado (1ms)'; echo 'ℹ tests 1'; echo 'ℹ fail 1'; exit 1; else echo 'ℹ tests 1'; echo 'ℹ pass 1'; fi`),
    });
    // src/b.txt só existe no HEAD: o teste passa na base, "RED" é alegação sem medição
    const falso = await avaliar({ wt: dir, base, red: ['teste-esperado'], suites: [so('src/b.txt')] });
    assert.ok(falso.reprova > 0, texto(falso));
    assert.match(texto(falso), /teste-esperado.*não falha na base/);
    // src/a.txt existe na base e no HEAD: falha nos dois, RED real
    const real = await avaliar({ wt: dir, base, red: ['teste-esperado'], suites: [so('src/a.txt')] });
    assert.equal(real.reprova, 0, texto(real));
    assert.match(texto(real), /medido na base/);
    assert.equal(nWorktrees(dir), 1, 'worktree temporária removida');
  });

  test('A4: sem --red não cria worktree; com --red e base inexistente reprova sem worktree', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const cwds = [];
    const rodar = async (nome, cmd, cwd) => { cwds.push(cwd); return { nome, rc: 0, out: 'ℹ tests 1\nℹ pass 1\n', ms: 5 }; };
    const r = await avaliar({ wt: dir, base, rodar, suites: ['x'] });
    assert.equal(r.reprova, 0, texto(r));
    assert.deepEqual(cwds, [dir]);
    const b = await avaliar({ wt: dir, base: 'nao-existe-xyz', red: ['a'], ...verde });
    assert.match(texto(b), /base inexistente/);
    assert.equal(nWorktrees(dir), 1);
  });

  test('A4: erro durante a medição ainda remove a worktree (finally)', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const rodar = async (nome) => {
      if (/@base/.test(nome)) throw new Error('explodiu-base');
      return { nome, rc: 1, out: '✖ esperado (1ms)\nℹ tests 1\nℹ fail 1\n', ms: 5 };
    };
    await assert.rejects(avaliar({ wt: dir, base, red: ['esperado'], rodar, suites: ['x'] }), /explodiu-base/);
    assert.equal(nWorktrees(dir), 1);
  });

  test('A4: worktree que não sai sem --force fica e é relatada, não forçada', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const suja = { nome: 's', cmd: script(`touch lixo-da-suite; ${vermelhoCru('esperado').cmd}`) };
    const r = await avaliar({ wt: dir, base, red: ['esperado'], suites: [suja] });
    assert.match(texto(r), /ALERTA.*worktree temporária restante/);
    assert.ok(r.alertas >= 1);
    assert.equal(nWorktrees(dir), 2, 'sem --force a worktree com arquivo novo permanece');
  });

  test('escopo: rename conta os dois lados (origem fora do escopo; origem proibida)', async () => {
    const a = repo();
    mkdirSync(join(a.dir, 'outro'));
    g(a.dir, 'mv', 'src/a.txt', 'outro/a2.txt');
    g(a.dir, 'commit', '-q', '-m', 'feat(GM-10): move');
    const ra = await avaliar({ wt: a.dir, base: a.base, files: ['outro/'], ...verde });
    assert.ok(ra.reprova > 0, texto(ra));
    assert.match(texto(ra), /fora do escopo: .*src\/a\.txt/);
    const b = repo();
    mkdirSync(join(b.dir, 'novo'));
    g(b.dir, 'mv', 'src/a.txt', 'novo/a.txt');
    g(b.dir, 'commit', '-q', '-m', 'feat(GM-10): move');
    const rb = await avaliar({ wt: b.dir, base: b.base, proibidos: ['^src/'], ...verde });
    assert.match(texto(rb), /arquivo proibido.*src\/a\.txt/);
  });

  test('escopo: lista vazia reprova; sem lista é aviso, não ok', async () => {
    const { dir, base } = repo();
    commit(dir, 'outro/x.txt', 'x\n');
    const vazia = await avaliar({ wt: dir, base, files: [], ...verde });
    assert.ok(vazia.reprova > 0);
    assert.match(texto(vazia), /escopo vazio/);
    const sem = await avaliar({ wt: dir, base, ...verde });
    assert.match(texto(sem), /AVISO.*escopo não verificado/);
    assert.doesNotMatch(texto(sem), /ok .*dentro do escopo/);
  });

  test('config corrompida reprova com a causa; ausente é config vazia', async () => {
    const { dir, base } = repo();
    writeFileSync(join(dir, 'harness.config.json'), '{"gates":{"suites":["exit 1"],}}');
    g(dir, 'add', 'harness.config.json');
    g(dir, 'commit', '-q', '-m', 'chore: config quebrada');
    const r = await avaliar({ wt: dir, base, ...verde });
    assert.ok(r.reprova > 0);
    assert.match(texto(r), /harness\.config\.json ilegível/);
    const ok = repo();
    commit(ok.dir, 'src/b.txt', 'b\n');
    assert.equal((await avaliar({ wt: ok.dir, base: ok.base, ...verde })).reprova, 0);
  });

  test('mutações mal formadas reprovam (objeto, vazia, sem para)', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const obj = await avaliar({ wt: dir, base, mutacoes: { nome: 'x' }, ...verde });
    assert.match(texto(obj), /mutações deve ser uma lista/);
    const vazia = await avaliar({ wt: dir, base, mutacoes: [], ...verde });
    assert.match(texto(vazia), /mutações deve ser uma lista/);
    const semPara = await avaliar({ wt: dir, base, mutacoes: [mut({ para: undefined, teste: lento })], ...verde });
    assert.ok(semPara.reprova > 0);
    assert.match(texto(semPara), /mutação m1.*"para"/);
  });

  test('linha final: contagem do que rodou; nada executado não é limpo', async () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const r = await avaliar({ wt: dir, base, mutacoes: [mut({ teste: lento })], suites: [{ nome: 'a', cmd: conta(4) }, { nome: 'b', cmd: conta(2) }] });
    assert.equal(r.reprova, 0, texto(r));
    assert.deepEqual([r.suites, r.testes, r.mutacoes], [2, 6, 1]);
  });

});

describe('gate-task CLI', () => {
  test('--help-less: sem argumentos sai 2 com uso; reprovado sai 1; verde sai 0', () => {
    const sem = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    assert.equal(sem.status, 2);
    assert.match(sem.stderr, /uso:/i);
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const ok = spawnSync(process.execPath, [CLI, dir, base, '--suite', conta(2), '--suite', conta(1)], { encoding: 'utf8' });
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
      '--suite', vermelho('teste-esperado').cmd], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /mutação m morta/);
  });

  // ---- Rodada 2: argumentos ----
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
  const reprovou = (r, causa) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /GATE REPROVADO/);
    assert.match(r.stdout, causa);
    assert.doesNotMatch(r.stdout, /GATE VERDE/);
    assert.doesNotMatch(r.stdout + r.stderr, /\bat .*:\d+:\d+/, 'sem stack');
  };

  test('CLI: argumento inválido reprova com a causa, nada roda', () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const aux = mkdtempSync(join(tmpdir(), 'gate-aux-'));
    const f = (nome, txt) => { writeFileSync(join(aux, nome), txt); return join(aux, nome); };
    const boa = ['--suite', conta()];
    reprovou(cli(dir, base, '--suit', 'exit 1'), /argumento desconhecido: --suit/);
    reprovou(cli(dir, base, ...boa, '--suite'), /--suite sem valor/);
    reprovou(cli(dir, base, '--suite', '--files', f('a.txt', 'src/\n')), /--suite sem valor/);
    reprovou(cli(dir, base, ...boa, 'solto'), /argumento desconhecido: solto/);
    reprovou(cli(dir, base, ...boa, '--files', f('vazio.txt', '')), /--files.*sem entradas/);
    reprovou(cli(dir, base, ...boa, '--files', f('coment.txt', '# só comentário\n\n')), /--files.*sem entradas/);
    reprovou(cli(dir, base, ...boa, '--files', join(aux, 'nao-existe.txt')), /--files.*não consegui ler/);
    reprovou(cli(dir, base, ...boa, '--red', f('red-vazio.txt', '\n')), /--red.*sem entradas/);
    reprovou(cli(dir, base, ...boa, '--mut', f('obj.json', '{"nome":"x"}')), /--mut.*lista/);
    reprovou(cli(dir, base, ...boa, '--mut', f('vazia.json', '[]')), /--mut.*lista/);
    reprovou(cli(dir, base, ...boa, '--mut', f('ruim.json', '[{')), /--mut.*JSON/);
    reprovou(cli(dir, base, ...boa, '--mut', join(aux, 'nao-existe.json')), /--mut.*não consegui ler/);
    reprovou(cli(dir, base, ...boa, '--card', 'A-1', '--card', 'B-2'), /--card repetido/);
  });

  test('CLI: linha final conta o que rodou; marcador aparece', () => {
    const { dir, base } = repo();
    commit(dir, 'src/b.txt', 'b\n');
    const a = cli(dir, base, '--suite', conta(3));
    assert.equal(a.status, 0, a.stdout);
    assert.match(a.stdout, /GATE VERDE \(1 suítes, 3 testes, 0 mutações\)/);
    const b = cli(dir, base, '--suite-sem-contagem', 'echo tests 5');
    assert.equal(b.status, 0, b.stdout);
    assert.match(b.stdout, /GATE VERDE \(1 suítes, 0 testes, 0 mutações\) com 1 suíte\(s\) sem contagem/);
    const c = cli(dir, base);
    reprovou(c, /nenhuma suíte/);
    const d = cli(dir, base, '--suite', 'true');
    reprovou(d, /nenhum teste contado/);
  });
});

// ------------------------------------------------------------------------------------- GM-11 T13: desvios no relato

/** Checkout principal + worktree `wt/<entrega>-<task>` num caminho COM ESPAÇO; o diário fica na raiz principal. */
function comWorktree({ branch = 'wt/GM-10-3', commits = true } = {}) {
  const { dir: principal, base } = repo({ branch: null });
  const wt = join(mkdtempSync(join(tmpdir(), 'gate task ')), 'minha wt');
  g(principal, 'worktree', 'add', '-q', '-b', branch, wt);
  if (commits) commit(wt, 'src/b.txt', 'b\n');
  return { principal, wt, base };
}
const dirEntrega = (principal, entrega = 'GM-10') => join(principal, '.harness', 'entregas', entrega);
let relogioDesvio = Date.parse('2026-11-09T10:00:00Z');
const gravar = (dir, tipo, dados, sessao = 's1') => assert.ok(append(dir, sessao, {
  ts: new Date((relogioDesvio += 1000)).toISOString(), autor: 'a', sessao, agente: 'implementador', tipo, dados,
}).ok, tipo);
const cli = (wt, base, ...a) => spawnSync(process.execPath, [CLI, wt, base, ...a], { encoding: 'utf8' });
const desvio = (o = {}) => ({ task: '3', req: 'REQ-A-1', evidencia: 'e', arquivos: ['src/b.txt', 'src/c.txt'], causa: 'tecnica', ...o });

describe('gate-task: desvios (GM-11 T13)', () => {
  test('gate-relata-desvio: uma linha por desvio, com req, arquivos e causa lidos do diário', async () => {
    const { principal, wt, base } = comWorktree();
    gravar(dirEntrega(principal), 'desvio', desvio());
    gravar(dirEntrega(principal), 'desvio', desvio({ req: 'REQ-B-7', arquivos: [], causa: 'regra_negocio' }));
    assert.deepEqual(desviosDaTask(wt).desvios.map((d) => d.req), ['REQ-A-1', 'REQ-B-7']);
    const r = await avaliar({ wt, base, ...verde });
    const linhas = r.relato.filter((l) => l.startsWith('desvio:'));
    assert.deepEqual(linhas, ['desvio: REQ-A-1 src/b.txt, src/c.txt (tecnica)', 'desvio: REQ-B-7 (regra_negocio)']);
    assert.ok(!texto(r).includes('desvios não lidos'));
  });

  test('gate-relata-desvio: só os da task desta branch (3 não é 13) e só os da entrega da branch', async () => {
    const { principal, wt, base } = comWorktree({ branch: 'wt/GM-10-3' });
    gravar(dirEntrega(principal), 'desvio', desvio({ task: '13', req: 'REQ-X-1' }));
    gravar(dirEntrega(principal), 'desvio', desvio({ task: '3', req: 'REQ-OK-1' }));
    gravar(dirEntrega(principal, 'GM-11'), 'desvio', desvio({ task: '3', req: 'REQ-OUTRA-1' }));
    gravar(dirEntrega(principal), 'task.iniciada', { task: '3', papel: 'implementador' }, 's2');
    const { desvios } = desviosDaTask(wt);
    assert.deepEqual(desvios.map((d) => d.req), ['REQ-OK-1']);
    const r = await avaliar({ wt, base, ...verde });
    assert.equal(r.relato.filter((l) => l.startsWith('desvio:')).length, 1);
  });

  test('gate-relata-desvio: entrega com hífen no nome e task com hífen (wt/GM-10-T-3) separam no primeiro número', () => {
    const { principal, wt } = comWorktree({ branch: 'wt/GM-10-T-3' });
    gravar(dirEntrega(principal), 'desvio', desvio({ task: 'T-3' }));
    assert.equal(desviosDaTask(wt).desvios.length, 1);
  });

  test('gate-desvio-nao-reprova: com desvio o veredito e a linha final são os mesmos', async () => {
    const sem = comWorktree();
    const com = comWorktree();
    gravar(dirEntrega(com.principal), 'desvio', desvio());
    const a = await avaliar({ wt: sem.wt, base: sem.base, ...verde });
    const b = await avaliar({ wt: com.wt, base: com.base, ...verde });
    assert.equal(a.reprova, 0, texto(a));
    assert.equal(b.reprova, 0, texto(b));
    assert.equal(b.alertas, a.alertas);
    assert.deepEqual([b.suites, b.testes, b.mutacoes], [a.suites, a.testes, a.mutacoes]);
    const cA = cli(sem.wt, sem.base, '--suite', conta(3));
    const cB = cli(com.wt, com.base, '--suite', conta(3));
    assert.equal(cB.status, 0, cB.stdout);
    assert.match(cB.stdout, /desvio: REQ-A-1/);
    // saída do gate inalterada: a mesma linha `GATE VERDE (...)`, sem menção a desvio
    const final = (o) => /GATE VERDE \(.*?\)/.exec(o.stdout)[0];
    assert.equal(final(cB), final(cA));
    assert.equal(final(cB), 'GATE VERDE (1 suítes, 3 testes, 0 mutações)');
  });

  test('gate-sem-diario-x-diario-ilegivel: sem pasta nenhuma linha; cadeia quebrada ou linha torta avisa e nunca vira "0 desvios"', async () => {
    const { principal, wt, base } = comWorktree();
    // ausente
    assert.deepEqual(desviosDaTask(wt), { desvios: [] });
    const r0 = await avaliar({ wt, base, ...verde });
    assert.deepEqual(r0.relato.filter((l) => /desvio/i.test(l)), []);
    // pasta existe e é diário válido sem desvio: também nenhuma linha
    gravar(dirEntrega(principal), 'task.iniciada', { task: '3', papel: 'implementador' });
    assert.deepEqual(desviosDaTask(wt), { desvios: [] });
    // corrompido: cadeia quebrada (a 2ª linha não aponta para o hash da 1ª)
    gravar(dirEntrega(principal), 'desvio', desvio());
    const arq = join(dirEntrega(principal), 'events.s1.jsonl');
    const [l1, l2] = readFileSync(arq, 'utf8').trim().split('\n');
    writeFileSync(arq, `${l1}\n${l2.replace(/"hash_anterior":"[0-9a-f]+"/, '"hash_anterior":"0000"')}\n`);
    const q = desviosDaTask(wt);
    assert.equal(q.desvios, undefined);
    assert.match(q.aviso, /^desvios não lidos \(hash_anterior não confere/);
    const r1 = await avaliar({ wt, base, ...verde });
    assert.ok(r1.relato.some((l) => /^aviso: desvios não lidos \(hash_anterior não confere/.test(l)), texto(r1));
    assert.ok(!r1.relato.some((l) => /0 desvios/.test(l)));
    assert.equal(r1.reprova, 0, 'aviso de leitura não reprova');
    // corrompido: linha que não é JSON
    writeFileSync(arq, 'isto nao e json\n');
    assert.match(desviosDaTask(wt).aviso, /^desvios não lidos \(linha 1 ilegível em events\.s1\.jsonl\)$/);
  });

  test('gate-sem-diario-x-diario-ilegivel: entrega que é arquivo (ENOTDIR na leitura) avisa, não some', () => {
    const { principal, wt } = comWorktree();
    mkdirSync(join(principal, '.harness', 'entregas'), { recursive: true });
    writeFileSync(dirEntrega(principal), 'sou arquivo');
    const q = desviosDaTask(wt);
    assert.equal(q.desvios, undefined);
    assert.match(q.aviso, /^desvios não lidos \(/);
  });

  test('gate-sem-diario-x-diario-ilegivel: .harness que é arquivo (ENOTDIR no stat) avisa, não vira "sem pasta"', () => {
    const { principal, wt } = comWorktree();
    writeFileSync(join(principal, '.harness'), 'sou arquivo');
    const q = desviosDaTask(wt);
    assert.equal(q.desvios, undefined);
    assert.match(q.aviso, /^desvios não lidos \(diário da entrega GM-10: ENOTDIR\)$/);
  });

  test('gate-relata-desvio: arquivo com quebra de linha não forja linha de veredito', async () => {
    const { principal, wt, base } = comWorktree();
    gravar(dirEntrega(principal), 'desvio', desvio({ arquivos: ['a\nGATE VERDE (9 suítes, 9 testes, 9 mutações)'] }));
    const r = await avaliar({ wt, base, ...verde });
    assert.equal(r.relato.filter((l) => l.startsWith('GATE')).length, 0);
    assert.ok(!r.relato.join('\n').split('\n').some((l) => l.startsWith('GATE VERDE (9')), 'a linha forjada não abre linha própria');
    assert.deepEqual(r.relato.filter((l) => l.startsWith('desvio:')), ['desvio: REQ-A-1 a GATE VERDE (9 suítes, 9 testes, 9 mutações) (tecnica)']);
  });

  test('gate-fora-de-worktree-de-task-silencio: branch fora do padrão nunca lê nem avisa', async () => {
    for (const branch of ['feature/GM-10-x', 'wt/gm-10-3', 'wt/GM-10', 'wt/GM-10-', 'wt/10-3', 'enabler/GM-10-3']) {
      const { principal, wt, base } = comWorktree({ branch });
      gravar(dirEntrega(principal), 'desvio', desvio());
      writeFileSync(join(dirEntrega(principal), 'events.s9.jsonl'), 'lixo\n'); // diário corrompido: ainda assim silêncio
      assert.deepEqual(desviosDaTask(wt), { desvios: [] }, branch);
      const r = await avaliar({ wt, base, card: 'GM-10', ...verde });
      assert.deepEqual(r.relato.filter((l) => /desvio/i.test(l)), [], branch);
    }
    // fora de repositório git
    assert.deepEqual(desviosDaTask(mkdtempSync(join(tmpdir(), 'sem-git-'))), { desvios: [] });
  });

  test('worktree x checkout principal: a branch de task no próprio checkout principal lê a mesma pasta', () => {
    const { dir, base } = repo({ branch: 'wt/GM-10-3' });
    assert.ok(base);
    gravar(join(dir, '.harness', 'entregas', 'GM-10'), 'desvio', desvio({ req: 'REQ-P-1' }));
    assert.deepEqual(desviosDaTask(dir).desvios.map((d) => d.req), ['REQ-P-1']);
  });

  test('costura: o CLI real, dentro da worktree com espaço no caminho, imprime a linha de desvio', () => {
    const { principal, wt, base } = comWorktree();
    gravar(dirEntrega(principal), 'desvio', desvio({ causa: 'regra_negocio', arquivos: ['src/b.txt'] }));
    const c = cli(wt, base, '--suite', conta(3));
    assert.equal(c.status, 0, c.stdout);
    assert.match(c.stdout, /^desvio: REQ-A-1 src\/b\.txt \(regra_negocio\)$/m);
  });
});

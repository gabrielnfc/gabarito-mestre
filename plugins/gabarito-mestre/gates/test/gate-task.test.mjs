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
import { avaliar, falhas } from '../scripts/gate-task.mjs';

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

// GM-19 T1: parte 1 de loop-cli.test.mjs, dividida por faixa de linha sem mudar nenhum teste.
// O corpo e o de bfa322ad por faixa; ver REQ-SEG-1 da spec da GM-19.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, lstatSync, statSync, symlinkSync, chmodSync, readdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { slotsDaCapacidade } from '../scripts/loop.mjs';
import * as diario from '../dist/diario.js';
import { SCRIPT, GITIGNORE_RAIZ, novoTmp, g, CONFIG_PADRAO, planoDe, HOST_TESTE, CAPACIDADE_PADRAO, ambiente, tmpDaTask, semEfeito, grava } from './_loop-cli-helpers.mjs';
// --- corpo movido ---
describe('.gitignore da raiz', () => {
  test('gitignore-da-raiz-ignora-worktrees', () => {
    const linhas = readFileSync(GITIGNORE_RAIZ, 'utf8').split('\n').map((l) => l.trim());
    assert.ok(linhas.includes('.harness/worktrees/'));
  });
});

describe('abrir', () => {
  test('abrir-cria-branch-e-worktree', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.branch, 'wt/GM-10-T1');
    assert.equal(realpathSync(r.j.worktree), realpathSync(amb.wt('T1')));
    assert.equal(r.j.banco, 'n/a');
    assert.ok(amb.branches().includes('wt/GM-10-T1'));
    assert.equal(g(amb.wt('T1'), 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'wt/GM-10-T1');
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), amb.topo());
    assert.equal(amb.eventos().length, 0, 'abrir não grava evento');
  });

  test('abrir-tmpdir-fora-da-worktree: exporta, não suja o git e não fica sob a árvore da task', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    const tmp = r.j.tmpdir;
    assert.equal(realpathSync(r.j.env.TMPDIR), realpathSync(tmp));
    assert.equal(realpathSync(dirname(tmp)), realpathSync(amb.tmpSistema), 'nasce no tmpdir do sistema');
    assert.equal(tmp, tmpDaTask(amb, 'T1'));
    assert.ok(!realpathSync(tmp).startsWith(`${realpathSync(amb.dir)}/`), 'fora do repositório e da worktree');
    assert.equal(statSync(tmp).mode & 0o777, 0o700);
    assert.ok(existsSync(join(amb.wt('T1'), '.tmp-gabarito')), 'os achados do revisor seguem em .tmp-gabarito');
    writeFileSync(join(tmp, 'lixo.bin'), 'x');
    mkdirSync(join(tmp, 'sub'));
    writeFileSync(join(tmp, 'sub', 'y'), 'y');
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '', 'TMPDIR não pode sujar o status');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '', 'nem o da raiz principal');
  });

  test('abrir-duas-vezes-mesmo-tmpdir: estável por worktree; outra task, outra pasta', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.j.ja_aberta, true);
    assert.equal(b.j.tmpdir, a.j.tmpdir);
    const c = amb.cli(['abrir', 'T3']);
    assert.notEqual(c.j.tmpdir, a.j.tmpdir, 'por worktree, nunca um só para o repositório');
    // dois repositórios, mesma task: caminhos de worktree diferentes, pastas diferentes
    const amb2 = ambiente();
    const d = amb2.cli(['abrir', 'T1'], { extra: { TMPDIR: amb.tmpSistema } }); // mesmo tmpdir do sistema
    assert.equal(d.rc, 0, d.out + d.err);
    assert.notEqual(d.j.tmpdir, a.j.tmpdir);
    assert.ok(existsSync(a.j.tmpdir) && existsSync(c.j.tmpdir) && existsSync(d.j.tmpdir));
  });

  test('abrir-tmpdir-symlink-recusa: nada escrito no alvo, branch e worktree desfeitas', () => {
    const amb = ambiente();
    const alvo = novoTmp('loop-fora-');
    writeFileSync(join(alvo, 'precioso.txt'), 'vivo');
    symlinkSync(alvo, tmpDaTask(amb, 'T1')); // a pasta esperada é um link para fora
    const antes = semEfeito(amb);
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'tmpdir_falhou');
    assert.equal(r.j.desfeito, true, r.out);
    assert.deepEqual(readdirSync(alvo), ['precioso.txt'], 'nada escrito no alvo do link');
    assert.equal(readFileSync(join(alvo, 'precioso.txt'), 'utf8'), 'vivo');
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!existsSync(amb.wt('T1')));
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(lstatSync(tmpDaTask(amb, 'T1')).isSymbolicLink(), 'o link, que não era nosso, não foi apagado');
  });

  test('abrir-tmpdir-falha-desfaz: arquivo no lugar da pasta; worktree, branch e banco desfeitos', () => {
    const amb = ambiente();
    amb.comBanco();
    writeFileSync(tmpDaTask(amb, 'T1'), 'sou um arquivo');
    const bancosAntes = amb.bancos().join(',');
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.desfeito, true, r.out);
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!existsSync(amb.wt('T1')));
    assert.equal(amb.bancos().join(','), bancosAntes, 'o banco clonado nesta abertura foi solto');
    assert.equal(readFileSync(tmpDaTask(amb, 'T1'), 'utf8'), 'sou um arquivo', 'o que não era nosso não foi apagado');
    // 2ª tentativa depois de arrumar: abre normalmente (nada ficou pelo caminho)
    rmSync(tmpDaTask(amb, 'T1'));
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
  });

  test('abrir-tmpdir-falha-desfaz-pasta-criada: falha depois de criar a pasta apaga a que criou', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1'], { extra: { GIT_FALHAR: 'gabaritoBase' } }); // o último passo do abrir falha
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.desfeito, true, r.out);
    assert.deepEqual(readdirSync(amb.tmpSistema), [], 'a pasta criada nesta abertura foi apagada');
    assert.ok(!existsSync(amb.wt('T1')));
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
  });

  test('abrir-branch-existente-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'branch', 'wt/GM-10-T1');
    const antes = semEfeito(amb);
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /branch_existe/);
    assert.deepEqual(semEfeito(amb), antes);
  });

  test('abrir-branch-existente-com-outra-caixa-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'branch', 'wt/gm-10-t1');
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /branch_existe/);
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('abrir-worktree-existente-recusa', () => {
    const amb = ambiente();
    mkdirSync(amb.wt('T1'), { recursive: true });
    writeFileSync(join(amb.wt('T1'), 'meu.txt'), 'importa');
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /worktree_existe/);
    assert.equal(readFileSync(join(amb.wt('T1'), 'meu.txt'), 'utf8'), 'importa');
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
  });

  test('abrir-worktree-com-outra-caixa-recusa', () => {
    const amb = ambiente();
    mkdirSync(join(amb.dir, '.harness', 'worktrees', 't1'), { recursive: true });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /worktree_existe/);
  });

  test('abrir-sem-commit-no-principal-detached-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'checkout', '-q', '--detach');
    const r = amb.cli(['abrir', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /principal_sem_branch/);
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
  });

  test('abrir-de-dentro-de-uma-worktree-acha-a-raiz-principal', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    const r = amb.cli(['abrir', 'T3'], { cwd: amb.wt('T1') });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.wt('T3'), '.git')));
    assert.ok(!existsSync(join(amb.wt('T1'), '.harness', 'worktrees')), 'nada aninhado na worktree');
    const p = amb.cli(['proxima'], { cwd: amb.wt('T1') });
    assert.equal(p.rc, 0, p.out + p.err);
  });

  test('abrir-fora-de-repo-da-json-e-rc-1', () => {
    const fora = novoTmp('loop-fora-');
    const r = spawnSync(process.execPath, [SCRIPT, 'abrir', 'T1', '--entrega', 'GM-10'], { cwd: fora, encoding: 'utf8', env: ambiente().env });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).ok, false);
  });
});

describe('ids e plano', () => {
  const RUINS = ['../x', 'a/b', '-x', 'a b', '', '..', '.', 'T1;rm', 'T1\n', '--entrega', 'a\\b', 'T1.lock'];

  test('id-ruim-recusa-antes-de-qualquer-efeito', () => {
    const amb = ambiente();
    const antes = semEfeito(amb);
    const antesGit = amb.gitChamadas().length;
    for (const cmd of ['abrir', 'iniciar', 'concluir', 'integrar', 'fechar', 'reabrir', 'veredito']) {
      for (const id of RUINS) {
        const args = cmd === 'iniciar' ? [cmd, id, 'implementador'] : cmd === 'veredito' ? [cmd, id, 'APROVADO', '1', '0', '0'] : [cmd, id];
        const r = amb.cli(args);
        assert.notEqual(r.rc, 0, `${cmd} ${JSON.stringify(id)}`);
        assert.equal(r.j?.ok, false, `${cmd} ${JSON.stringify(id)}: ${r.out}`);
      }
    }
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(amb.gitChamadas().length, antesGit, 'nenhum git rodou: a forma é conferida antes de tocar o repositório');
  });

  test('entrega-ruim-recusa', () => {
    const amb = ambiente();
    for (const e of ['../x', '-x', 'a b', 'gm-10', 'GM-10/x', 'GM10']) {
      const r = amb.cli(['abrir', 'T1', '--entrega', e]);
      assert.equal(r.rc, 1, e);
      assert.equal(r.j.ok, false);
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('entrega-inferida-da-branch', () => {
    const amb = ambiente({ branch: 'enabler/GM-10-loop' });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out + r.err);
  });

  test('entrega-sem-id-na-branch-e-sem-flag-recusa', () => {
    const amb = ambiente({ branch: 'principal' });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /entrega/);
    assert.equal(amb.cli(['proxima', '--entrega', 'GM-10']).rc, 0);
  });

  test('plano-ids-colidem-por-caixa-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['a'] }, { id: 't1', deps: [], arquivos: ['b'] }]) });
    for (const a of [['abrir', 'T1'], ['proxima']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.match(r.j.erro, /plano_invalido/);
      assert.match(r.j.mensagem, /colidem.*caixa/);
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('plano-ids-colidem-no-banco-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T-1', deps: [], arquivos: ['a'] }, { id: 'T1', deps: [], arquivos: ['b'] }]) });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /plano_invalido/);
  });

  test('plano-com-id-de-forma-ruim-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: '../x', deps: [], arquivos: ['a'] }]) });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /plano_invalido/);
  });

  test('plano-com-entrega-diferente-da-pasta-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['a'] }], 'GM-99') });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.match(r.j.erro, /plano_invalido/);
  });

  test('proxima-sem-plano-mensagem', () => {
    const amb = ambiente({ plano: null });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'plano_ausente');
    assert.match(r.j.mensagem, /plano\.json/);
  });

  test('plano-corrompido-nao-vira-acao', () => {
    for (const bruto of ['{nao e json', '[]', '{"entrega":"GM-10","tasks":"x"}', '']) {
      const amb = ambiente({ plano: bruto });
      for (const a of [['proxima'], ['abrir', 'T1'], ['integrar', 'T1']]) {
        const r = amb.cli(a);
        assert.equal(r.rc, 1, `${bruto} ${a.join(' ')}`);
        assert.equal(r.j.erro, 'plano_invalido');
      }
    }
  });

  test('task-fora-do-plano-recusa', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T9'], ['integrar', 'T9'], ['iniciar', 'T9', 'implementador'], ['fechar', 'T9']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.equal(r.j.erro, 'task_fora_do_plano');
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('arquivos-com-glob-recusa-antes-do-efeito', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/*.txt'] }]) });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'plano_invalido');
    assert.equal(semEfeito(amb).wts, '');
  });

  test('arquivos-vazio-recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: [] }]) });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'plano_invalido');
  });

  test('arquivos-diretorio-vira-escopo-de-diretorio', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/dir'] }]) });
    amb.aprovar('T1', 'src/dir/x.txt');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.dir, 'src/dir/x.txt')));
  });

  test('arquivos-diretorio-nao-aprova-arquivo-de-fora', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/dir'] }]) });
    amb.aprovar('T1', 'src/dir/x.txt', [['src/outro.txt', 'x\n']]);
    const antes = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /fora do escopo/);
    assert.equal(amb.topo(), antes);
  });
});

describe('comandos que gravam', () => {
  test('iniciar-grava-task-iniciada', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos();
    assert.equal(e.length, 1);
    assert.equal(e[0].tipo, 'task.iniciada');
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador', modelo: 'sonnet' });
    assert.equal(e[0].agente, 'orquestrador');
  });

  test('iniciar-modelo-flag-vence-config', () => {
    // config manda opus; o flag manda haiku; o diário grava o do flag (e a forma do evento fica a mesma)
    const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { modelos: { implementador: 'opus' } } } });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador', '--modelo', 'haiku']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos();
    assert.equal(e.length, 1);
    assert.equal(e[0].tipo, 'task.iniciada');
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador', modelo: 'haiku' });
    // todos os valores da lista valem
    for (const m of ['sonnet', 'opus', 'fable']) {
      const a = ambiente();
      a.cli(['abrir', 'T1']);
      assert.equal(a.cli(['iniciar', 'T1', 'implementador', '--modelo', m]).rc, 0, m);
      assert.equal(a.eventos()[0].dados.modelo, m);
    }
  });

  test('iniciar-sem-flag-igual-2-0-0', () => {
    // sem --modelo, o modelo é o do config (opus), como a 2.0.0; nenhum campo a mais no evento
    const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { modelos: { implementador: 'opus' } } } });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos();
    assert.equal(e.length, 1);
    assert.deepEqual(e[0].dados, { task: 'T1', papel: 'implementador', modelo: 'opus' });
    assert.deepEqual(Object.keys(e[0].dados), ['task', 'papel', 'modelo']);
  });

  test('iniciar-modelo-fora-da-lista-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    for (const m of ['gpt', 'Opus', 'claude-opus-5-5', '', 'spike']) {
      const r = amb.cli(['iniciar', 'T1', 'implementador', '--modelo', m]);
      assert.equal(r.rc, 1, `"${m}": ${r.out}${r.err}`);
      assert.equal(r.j.erro, 'argumento_invalido', `${m}: recusa na borda, antes de tocar o diário`);
      assert.match(r.j.mensagem, /haiku \| sonnet \| opus \| fable/, m);
      assert.match(r.j.mensagem, /nada foi gravado/, m);
    }
    assert.equal(amb.eventos().length, 0, 'nada gravado no diário');
    // o recusado não deixa estado: o iniciar válido seguinte grava o 1º e único evento
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador', '--modelo', 'opus']).rc, 0);
    assert.equal(amb.eventos().length, 1);
  });

  test('iniciar-spike-recusa-com-frase', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'spike']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.match(r.j.mensagem, /implementador/);
    assert.doesNotMatch(r.j.mensagem, /fora da lista/, 'frase própria, não a lista genérica');
    assert.equal(amb.eventos().length, 0, 'nada gravado no diário');
    // com --modelo também recusa, e o papel valido ao lado segue aceito
    assert.equal(amb.cli(['iniciar', 'T1', 'spike', '--modelo', 'opus']).rc, 1);
    assert.equal(amb.eventos().length, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
  });

  test('iniciar-papel-invalido-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    for (const p of ['dono', 'root', '', 'Implementador']) {
      const r = amb.cli(['iniciar', 'T1', p]);
      assert.equal(r.rc, 1, p);
    }
    assert.equal(amb.eventos().length, 0);
  });

  test('iniciar-sem-worktree-recusa', () => {
    const amb = ambiente();
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_ausente');
    assert.equal(amb.eventos().length, 0);
  });

  test('iniciar-em-estado-que-a-tabela-nao-aceita-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.equal(amb.eventos().length, 1);
  });

  test('concluir-grava-task-concluida-e-recusa-fora-de-ordem', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    assert.equal(amb.cli(['concluir', 'T1']).rc, 1, 'pendente não conclui');
    assert.equal(amb.eventos().length, 0);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const r = amb.cli(['concluir', 'T1']);
    assert.equal(r.rc, 0);
    assert.equal(amb.tipos().at(-1), 'task.concluida');
  });

  test('veredito-grava-review-veredito', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const v = amb.eventos().at(-1);
    assert.equal(v.tipo, 'review.veredito');
    assert.deepEqual(v.dados, { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0, sha: amb.topo('wt/GM-10-T1') });
  });

  test('veredito-argumentos-invalidos-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.cli(['concluir', 'T1']);
    const antes = amb.eventos().length;
    const ruins = [
      ['TALVEZ', '1', '0', '0'], ['aprovado', '1', '0', '0'], ['APROVADO', '0', '0', '0'], ['APROVADO', '-1', '0', '0'],
      ['APROVADO', 'x', '0', '0'], ['APROVADO', '1', '-1', '0'], ['APROVADO', '1', '0', '-3'], ['APROVADO', '1', 'a', '0'],
      ['APROVADO', '1.5', '0', '0'], ['APROVADO', '01', '0', '0'], ['APROVADO', '1', '0'], ['APROVADO', '1', '0', '0', '9'],
      ['APROVADO', '1e3', '0', '0'], ['APROVADO', '', '0', '0'], ['APROVADO', ' 1', '0', '0'],
    ];
    for (const a of ruins) {
      const r = amb.cli(['veredito', 'T1', ...a]);
      assert.notEqual(r.rc, 0, a.join(' '));
      assert.equal(r.j?.ok, false, a.join(' '));
    }
    assert.equal(amb.eventos().length, antes);
  });

  test('veredito-aprovado-com-achado-recusa-sem-gravar', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.cli(['concluir', 'T1']);
    const antes = amb.eventos().length;
    const r = amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.match(r.j.mensagem, /veredito\.aprovado\.com_achado em concluida/);
    assert.equal(amb.eventos().length, antes);
  });

  test('veredito-com-rodada-fora-de-sequencia-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.cli(['concluir', 'T1']);
    const r = amb.cli(['veredito', 'T1', 'REPROVADO', '2', '1', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
  });

  test('evento-atrasado-depois-do-dono-nao-invalida-o-diario', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 1, major: 0 }],
      ['task.iniciada', { task: 'T1', papel: 'correcao' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
      ['task.reaberta', { task: 'T1', origem: 'dono' }],
    ]);
    const antes = amb.eventos().length;
    for (const a of [['concluir', 'T1'], ['veredito', 'T1', 'APROVADO', '1', '0', '0'], ['veredito', 'T1', 'REPROVADO', '2', '0', '1']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.equal(r.j.erro, 'transicao_invalida');
      assert.match(r.j.mensagem, / em pendente|fora de sequência/);
    }
    assert.equal(amb.eventos().length, antes, 'nada gravado');
    const p = amb.cli(['proxima']);
    assert.equal(p.rc, 0, p.out);
    assert.notEqual(p.j.acao.motivo, 'diario_invalido');
    assert.equal(p.j.acao.tipo, 'despachar');
  });

  test('reabrir-so-grava-origem-retomada', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const r = amb.cli(['reabrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'task.reaberta');
    assert.deepEqual(e.dados, { task: 'T1', origem: 'retomada' });
  });

  test('reabrir-nao-tem-argumento-que-produza-dono', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const antes = amb.eventos().length;
    for (const a of [['--origem', 'dono'], ['--origem=dono'], ['dono'], ['--dono'], ['origem', 'dono'], ['--origem', 'retomada']]) {
      const r = amb.cli(['reabrir', 'T1', ...a]);
      assert.equal(r.rc, 2, a.join(' '));
    }
    assert.equal(amb.eventos().length, antes);
    const t = amb.eventos().filter((e) => e.dados?.origem === 'dono');
    assert.equal(t.length, 0);
  });

  test('parar-grava-loop-parar-e-recusa-motivo-invalido', () => {
    const amb = ambiente();
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'loop.parar');
    assert.deepEqual(e.dados, { motivo: 'nao_conseguiu' });
    for (const m of ['', 'porque sim', 'rm -rf /', '../x']) assert.equal(amb.cli(['parar', m]).rc, 1, m);
    assert.equal(amb.eventos().length, 1);
  });

  test('parar-grava-mesmo-com-diario-invalido', () => {
    const amb = ambiente();
    amb.semear([['task.concluida', { task: 'T1' }]]);
    const r = amb.cli(['parar', 'diario_invalido']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.tipos().at(-1), 'loop.parar');
  });

  test('grava-recusa-diario-ilegivel', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    const f = join(amb.entregas, 'events.loop.jsonl');
    appendFileSync(f, 'isto nao e json\n');
    const antes = readFileSync(f, 'utf8');
    const r = amb.cli(['concluir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel');
    assert.equal(readFileSync(f, 'utf8'), antes);
  });

  test('grava-recusa-diario-ja-invalido-de-outra-task', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.semear([['task.concluida', { task: 'T3' }]]);
    const antes = amb.eventos().length;
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_invalido');
    assert.equal(amb.eventos().length, antes);
  });

  test('gravacao-que-falha-nao-vira-sucesso', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    chmodSync(amb.entregas, 0o555);
    const r = amb.cli(['concluir', 'T1']);
    chmodSync(amb.entregas, 0o755);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'evento_nao_gravado');
  });
});

describe('integrar', () => {
  test('integrar-ff', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.equal(r.j.fechada, true);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')), 'o trabalho entrou na branch do PBI');
    assert.equal(amb.topo(), amb.topo('wt/GM-10-T1'));
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: amb.topo(), mutacoes: { total: 0, mortas: 0 } });
    assert.ok(!existsSync(w), 'worktree removida');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '');
  });

  test('integrar-de-dentro-de-outra-worktree-acha-a-raiz-principal', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    assert.equal(amb.cli(['abrir', 'T3']).rc, 0);
    const r = amb.cli(['integrar', 'T1'], { cwd: amb.wt('T3') });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('integrar-rebaseia-sobre-a-branch-do-pbi', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(g(amb.dir, 'log', '--format=%s', '-3').trim().split('\n').join('|'), 'feat(GM-10): trabalho|chore: avanca|chore: base');
  });

  test('integrar-recusa-sem-podeintegrar', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/t1.txt');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'nao_integravel');
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('integrar-recusa-dependente-com-dep-nao-integrada', () => {
    const amb = ambiente();
    amb.aprovar('T2');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T2']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'nao_integravel');
    assert.deepEqual(semEfeito(amb), antes);
  });

  test('integrar-recusa-com-diario-invalido-ou-ilegivel', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    appendFileSync(join(amb.entregas, 'events.loop.jsonl'), '{lixo\n');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel');
    assert.deepEqual(semEfeito(amb), antes);
  });

  test('integrar-recusa-worktree-suja', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    writeFileSync(join(w, 'src/t1.txt'), 'editado e nao commitado\n');
    writeFileSync(join(w, 'novo.txt'), 'x');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(readFileSync(join(w, 'novo.txt'), 'utf8'), 'x');
    assert.ok(!amb.gitChamadas().some((l) => /rebase|merge/.test(l)), 'nem rebase nem merge');
  });

  test('integrar-conflito-rebase-relata-e-nao-integra', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/a.txt'] }]) });
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/a.txt', 'TASK\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) amb.cli(a);
    writeFileSync(join(amb.dir, 'src/a.txt'), 'MAIN\n');
    g(amb.dir, 'commit', '-q', '-am', 'chore: main mexe');
    const topoMain = amb.topo();
    const topoTask = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'rebase_conflito');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.abortado, true);
    assert.equal(amb.topo(), topoMain, 'a branch do PBI não andou');
    assert.equal(amb.topo('wt/GM-10-T1'), topoTask, 'a branch da task voltou ao que era');
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '');
    assert.ok(!existsSync(join(g(amb.wt('T1'), 'rev-parse', '--git-dir').trim(), 'rebase-merge')));
    assert.ok(!amb.tipos().includes('task.integrada'));
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('integrar-conflito-com-abort-que-falha-diz-sem-apagar', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/a.txt'] }]) });
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/a.txt', 'TASK\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) amb.cli(a);
    writeFileSync(join(amb.dir, 'src/a.txt'), 'MAIN\n');
    g(amb.dir, 'commit', '-q', '-am', 'chore: main mexe');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'rebase --abort' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'rebase_conflito');
    assert.equal(r.j.abortado, false);
    assert.match(r.j.mensagem, /abort/i);
    assert.ok(existsSync(amb.wt('T1')), 'nada foi apagado');
  });

  test('integrar-recusa-gate-vermelho', () => {
    const amb = ambiente({ config: { gates: { suites: ['test ! -f src/t1.txt'] } } });
    amb.aprovar('T1');
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
    const topoMain = amb.topo();
    const revisadoAntes = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.equal(amb.topo(), topoMain, 'sem merge');
    assert.ok(!amb.tipos().includes('task.integrada'), 'sem evento');
    assert.equal(amb.topo('wt/GM-10-T1'), revisadoAntes, 'a branch voltou ao commit revisado');
    assert.ok(existsSync(amb.wt('T1')));
    assert.ok(!amb.gitChamadas().some((l) => / merge /.test(l)));
  });

  test('abrir-sem-suite-recusa (GM-21 T3, irmão de integrar-gate-sem-suite-reprova): config {} ⇒ abrir recusa plano_nao_executavel e nada é criado', () => {
    const amb = ambiente({ config: {} });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'plano_nao_executavel');
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('integrar-gate-sem-suite-reprova', () => {
    // GM-21 T3 (emenda 8): o abrir agora recusa config sem suíte; a worktree nasce com config válida e a base perde as suítes antes do integrar (o rebase leva a config {} à worktree)
    const amb = ambiente();
    amb.aprovar('T1');
    writeFileSync(join(amb.dir, 'harness.config.json'), '{}');
    g(amb.dir, 'add', 'harness.config.json');
    g(amb.dir, 'commit', '-q', '-m', 'chore: sem suites');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-gate-com-config-ilegivel-reprova', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt', 'harness.config.json'] }]) });
    amb.aprovar('T1', 'src/t1.txt', [['harness.config.json', '{nao json']]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /harness\.config\.json ilegível/);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-gate-reprova-arquivo-fora-do-escopo', () => {
    const amb = ambiente();
    amb.aprovar('T1', 'src/t1.txt', [['src/intruso.txt', 'x\n']]);
    const topo = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /fora do escopo.*intruso/);
    assert.equal(amb.topo(), topo);
  });

  test('integrar-gate-recebe-tmpdir-externo: fora da worktree, o mesmo do abrir, e fechar o apaga', () => {
    const marca = join(novoTmp('loop-marca-'), 'tmpdir.txt');
    const amb = ambiente({ config: { gates: { suites: [`case "$TMPDIR" in */.harness/worktrees/*|*/.tmp-gabarito) exit 1;; esac; test "$(basename "$TMPDIR" | cut -c1-9)" = gabarito- && echo "$TMPDIR" > ${marca} && echo "# pass 1"`] } } });
    const wt = amb.aprovar('T1');
    const dir = readdirSync(amb.tmpSistema).filter((n) => /^gabarito-/.test(n));
    assert.equal(dir.length, 1);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(readFileSync(marca, 'utf8').trim(), join(amb.tmpSistema, dir[0]), 'o gate rodou com o TMPDIR do abrir');
    assert.ok(!existsSync(wt));
    assert.deepEqual(readdirSync(amb.tmpSistema).filter((n) => /^gabarito-/.test(n)), [], 'fechar, chamado pelo integrar, apagou a pasta (nome sem aninhar)');
  });

  test('integrar-gate-usa-mutacoes-e-teste-afetado-do-plano', () => {
    const amb = ambiente({
      config: { gates: { suites: ["echo '# pass 1'"] } },
      plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], teste_afetado: 'test -f src/t1.txt && echo "# pass 1"', mutacoes: 'mut.json' }]),
    });
    writeFileSync(join(amb.dir, 'mut.json'), JSON.stringify([{ nome: 'viva', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'true' }]));
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.match(r.j.relato.join('\n'), /mutação viva VIVA/);
    assert.match(r.j.relato.join('\n'), /teste_afetado verde/);
  });

  test('integrar-mutacoes-fora-da-raiz-recusa', () => {
    // O arquivo de fora é VÁLIDO e traz uma mutação viva: sem a recusa, o gate o leria e reprovaria por outro motivo.
    const fora = join(novoTmp('loop-mut-'), 'fora.json');
    writeFileSync(fora, JSON.stringify([{ nome: 'viva', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'true' }]));
    const amb = ambiente();
    const mutacoes = `../${fora.split('/').slice(-2).join('/')}`;
    // GM-21 T3 (emenda 8): o abrir recusa mutacoes fora da raiz (irmão abaixo); a worktree nasce com o plano válido e o plano muda antes do integrar
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify(planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], mutacoes }])));
    const ab = amb.cli(['abrir', 'T1']);
    assert.equal(ab.j.erro, 'plano_nao_executavel', ab.out);
    assert.match(ab.j.mensagem, /fora da raiz/);
    assert.ok(!existsSync(amb.wt('T1')));
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify(planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }])));
    amb.aprovar('T1');
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify(planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], mutacoes }])));
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'mutacoes_invalidas');
    assert.match(r.j.mensagem, /fora da raiz/);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-merge-ff-falha-sem-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'merge --ff-only' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'merge_falhou');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.ok(!amb.tipos().includes('task.integrada'));
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('integrar-evento-falha-diz-que-o-merge-entrou-e-nao-fecha', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    chmodSync(amb.entregas, 0o555);
    const r = amb.cli(['integrar', 'T1']);
    chmodSync(amb.entregas, 0o755);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'evento_nao_gravado');
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, false);
    assert.match(r.j.mensagem, /merge/);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')), 'o merge entrou');
    assert.ok(existsSync(amb.wt('T1')), 'fechar não foi chamado');
    assert.ok(!amb.gitChamadas().some((l) => /worktree remove/.test(l)));
  });

  test('integrar-fechar-falha-relata-merge-e-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'fechar_falhou');
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
  });

  test('integrar-libera-dependente-na-sequencia', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    amb.aprovar('T2');
    assert.equal(amb.cli(['integrar', 'T2']).rc, 0);
    assert.ok(existsSync(join(amb.dir, 'src/t2.txt')));
    amb.aprovar('T3');
    assert.equal(amb.cli(['integrar', 'T3']).rc, 0);
    amb.fechar(); // REQ-APR-2 muda a ordem: tudo integrado abre o fechamento antes do `concluir`
    const p = amb.cli(['proxima']);
    assert.equal(p.j.acao.tipo, 'concluir');
  });
});

describe('fechar', () => {
  test('fechar-sujo-relata', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'meu-trabalho.txt'), 'nao perca');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.match(r.j.mensagem, /meu-trabalho/);
    assert.equal(readFileSync(join(w, 'meu-trabalho.txt'), 'utf8'), 'nao perca');
    assert.ok(existsSync(w));
    assert.ok(!amb.sqls().some((s) => /^DROP/.test(s)), 'o banco não foi solto');
  });

  test('fechar-tmpdir-limpo', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    mkdirSync(join(tmp, 'fundo'));
    writeFileSync(join(tmp, 'fundo', 'x.bin'), Buffer.alloc(1024));
    writeFileSync(join(tmp, 'y'), 'y');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.ok(!existsSync(amb.wt('T1')), '0 bytes sobram');
    assert.ok(!g(amb.dir, 'worktree', 'list', '--porcelain').includes('T1'));
  });

  test('fechar-apaga-tmpdir-externo: com conteúdo fundo; 0 bytes sobram fora da worktree', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    assert.equal(a.j.tmpdir, tmpDaTask(amb, 'T1'));
    mkdirSync(join(a.j.tmpdir, 'fundo'));
    writeFileSync(join(a.j.tmpdir, 'fundo', 'x.bin'), Buffer.alloc(2048));
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(!existsSync(a.j.tmpdir));
    assert.ok(!existsSync(amb.wt('T1')));
    assert.deepEqual(readdirSync(amb.tmpSistema), [], 'nada sobra no tmpdir do sistema');
  });

  test('fechar-suja-mantem-tmpdir: worktree suja recusa, mantém a pasta e não cria nenhuma', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    writeFileSync(join(a.j.tmpdir, 'meu.bin'), 'x');
    writeFileSync(join(amb.wt('T1'), 'sujo.txt'), 'nao commitado');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.equal(readFileSync(join(a.j.tmpdir, 'meu.bin'), 'utf8'), 'x', 'a pasta fica como estava');
    assert.deepEqual(readdirSync(amb.tmpSistema), [a.j.tmpdir.split('/').at(-1)]);
    // worktree sem pasta externa: fechar suja não cria uma (nome calculado, sem mkdir)
    rmSync(a.j.tmpdir, { recursive: true });
    const r2 = amb.cli(['fechar', 'T1']);
    assert.equal(r2.j.erro, 'worktree_suja');
    assert.deepEqual(readdirSync(amb.tmpSistema), []);
  });

  test('fechar-tmpdir-externo-dono-alheio-recusa: a pasta não é nossa, nada é apagado e a worktree fica', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    writeFileSync(join(a.j.tmpdir, 'dele.bin'), 'x');
    const pre = join(novoTmp('loop-pre-'), 'outro-dono.mjs');
    writeFileSync(pre, 'process.getuid = () => process.geteuid() + 1;\n'); // o dono da pasta passa a parecer outro
    const extra = { NODE_OPTIONS: `--import ${pre}` };
    for (const cmd of ['fechar', 'abrir']) {
      const r = amb.cli([cmd, 'T1'], { extra });
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
    }
    assert.equal(readFileSync(join(a.j.tmpdir, 'dele.bin'), 'utf8'), 'x');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-tmpdir-externo-symlink-recusa: o alvo e a worktree ficam', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    const alvo = novoTmp('loop-fora-');
    writeFileSync(join(alvo, 'precioso.txt'), 'vivo');
    assert.equal(a.j.tmpdir, tmpDaTask(amb, 'T1'));
    rmSync(a.j.tmpdir, { recursive: true });
    symlinkSync(alvo, a.j.tmpdir);
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'tmpdir_invalido');
    assert.equal(readFileSync(join(alvo, 'precioso.txt'), 'utf8'), 'vivo');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-nao-usa-force', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    assert.equal(amb.cli(['fechar', 'T1']).rc, 0);
    const rem = amb.gitChamadas().filter((l) => /worktree remove/.test(l));
    assert.equal(rem.length, 1);
    assert.ok(!/(^| )(-f|--force)( |$)/.test(rem[0]), rem[0]);
  });

  test('fechar-tmpdir-symlink-para-fora-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const fora = novoTmp('loop-fora-');
    writeFileSync(join(fora, 'precioso.txt'), 'vivo');
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    spawnSync('rm', ['-r', tmp]);
    symlinkSync(fora, tmp);
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'tmpdir_invalido');
    assert.equal(readFileSync(join(fora, 'precioso.txt'), 'utf8'), 'vivo');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-tmpdir-que-nao-e-diretorio-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const tmp = join(amb.wt('T1'), '.tmp-gabarito');
    spawnSync('rm', ['-r', tmp]);
    writeFileSync(tmp, 'arquivo');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'tmpdir_invalido');
    assert.ok(existsSync(tmp));
  });

  test('fechar-nao-segue-symlink-interno', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const fora = novoTmp('loop-fora-');
    writeFileSync(join(fora, 'precioso.txt'), 'vivo');
    symlinkSync(fora, join(amb.wt('T1'), '.tmp-gabarito', 'atalho'));
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(readFileSync(join(fora, 'precioso.txt'), 'utf8'), 'vivo');
  });

  test('fechar-worktree-ausente-rc-1', () => {
    const amb = ambiente();
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_ausente');
  });

  test('fechar-remove-falhando-rc-1', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['fechar', 'T1'], { extra: { GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'remove_falhou');
    assert.ok(existsSync(amb.wt('T1')));
  });
});

describe('banco', () => {
  test('abrir-clona-e-fechar-solta', () => {
    const amb = ambiente();
    amb.comBanco();
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.banco, 'gm_gm10_t1');
    assert.ok(amb.bancos().includes('gm_gm10_t1'));
    const f = amb.cli(['fechar', 'T1']);
    assert.equal(f.rc, 0, f.out + f.err);
    assert.ok(!amb.bancos().includes('gm_gm10_t1'));
    assert.equal(f.j.banco, 'solto');
  });

  test('integrar-solta-o-banco-ao-fechar', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.aprovar('T1');
    assert.ok(amb.bancos().includes('gm_gm10_t1'));
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(!amb.bancos().includes('gm_gm10_t1'));
  });

  test('abrir-sem-db-declarado-segue-n-a', () => {
    const amb = ambiente();
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0);
    assert.equal(r.j.banco, 'n/a');
    assert.equal(amb.sqls().length, 0);
  });

  test('abrir-com-db-invalido-recusa-antes-de-criar', () => {
    const amb = ambiente();
    amb.comBanco({ host: 'prod.exemplo.com' });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'db_invalido');
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!existsSync(amb.wt('T1')));
  });

  test('abrir-com-clone-falhando-desfaz-a-worktree', () => {
    const amb = ambiente();
    amb.comBanco();
    const r = amb.cli(['abrir', 'T1'], { extra: { FAKE_FAIL: '^CREATE DATABASE "gm_' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'banco_falhou');
    assert.equal(r.j.desfeito, true);
    assert.ok(!existsSync(amb.wt('T1')));
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.ok(!g(amb.dir, 'worktree', 'list', '--porcelain').includes('T1'));
  });

  test('abrir-com-clone-falhando-e-desfazer-falhando-relata-a-branch', () => {
    const amb = ambiente();
    amb.comBanco();
    const r = amb.cli(['abrir', 'T1'], { extra: { FAKE_FAIL: '^CREATE DATABASE "gm_', GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'banco_falhou');
    assert.equal(r.j.desfeito, false);
    assert.equal(r.j.branch, 'wt/GM-10-T1');
    assert.match(r.j.mensagem, /wt\/GM-10-T1/);
  });

  test('fechar-banco-soltar-falha-mantem-worktree', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['fechar', 'T1'], { extra: { FAKE_FAIL: '^DROP DATABASE' } });
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'banco_nao_solto');
    assert.ok(existsSync(amb.wt('T1')));
    assert.ok(amb.bancos().includes('gm_gm10_t1'));
  });
});

describe('proxima', () => {
  test('proxima-json', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    // E3 (T10): todo item leva `modelo`, `decisoes` e `emendas` (vazias sem Sombra nem emenda); E5a (T8): e `aprendizados` (vazio sem aprendizado D na árvore)
    const item = (task) => ({ task, papel: 'implementador', descricao: `${task} implementador`, modelo: { modelo: 'sonnet', esforco: 'high' }, decisoes: [], emendas: [], aprendizados: [] });
    assert.deepEqual(r.j.acao, { tipo: 'despachar', itens: [item('T1'), item('T3')] });
    assert.deepEqual(r.j.sinais, { slots: 2, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: true });
    assert.equal(r.j.aviso, undefined);
    assert.equal(r.out.trim().split('\n').length, 1, 'uma linha de JSON');
  });

  test('proxima-config-slots-ausente-vale-a-medicao-sem-aviso-de-config', () => {
    for (const loop of [undefined, {}]) {
      const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, ...(loop === undefined ? {} : { loop }) } });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 0, JSON.stringify(loop) + r.out);
      assert.equal(r.j.sinais.slots, 2, JSON.stringify(loop));
      assert.equal(r.j.aviso, undefined, JSON.stringify(r.j.aviso));
    }
  });

  test('proxima-config-slots-invalido-um-slot-com-aviso (nunca sobe a medição)', () => {
    for (const loop of [{ slots: 0 }, { slots: -1 }, { slots: 'dois' }, { slots: 2.5 }, { slots: null }, 'x', null]) {
      const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, loop } });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 0, JSON.stringify(loop) + r.out);
      assert.equal(r.j.sinais.slots, 1, JSON.stringify(loop));
      assert.equal(r.j.acao.itens.length, 1);
      assert.ok(r.j.aviso.some((a) => /loop\.slots/.test(a)), JSON.stringify(loop));
    }
  });

  test('proxima-sem-config-vale-a-medicao-com-aviso-de-config', () => {
    const amb = ambiente();
    spawnSync('rm', [join(amb.dir, 'harness.config.json')]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.j.sinais.slots, 2, 'a medição não depende do config');
    assert.ok(r.j.aviso.some((a) => /harness\.config\.json ausente/.test(a)));
  });

  test('proxima-config-corrompida-rc-1', () => {
    const amb = ambiente({ config: '{nao json' });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'config_invalida');
  });

  test('proxima-vivos-ausente-vira-zero-com-aviso', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0);
    assert.equal(r.j.sinais.vivos, 0);
    assert.ok(r.j.aviso.some((a) => /vivos/.test(a)));
  });

  test('proxima-vivos-ocupam-slots', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima', '--vivos', '2']);
    assert.equal(r.rc, 0);
    assert.equal(r.j.acao.tipo, 'esperar');
    const um = amb.cli(['proxima', '--vivos', '1']);
    assert.equal(um.j.acao.itens.length, 1);
  });

  test('proxima-vivos-invalido-rc-1', () => {
    const amb = ambiente();
    for (const v of ['-1', 'x', '1.5', '', '1e2']) {
      const r = amb.cli(['proxima', '--vivos', v]);
      assert.equal(r.rc, 1, v);
      assert.equal(r.j.erro, 'argumento_invalido');
    }
  });

  test('proxima-pausar-na-raiz-principal-e-na-worktree', () => {
    const amb = ambiente();
    mkdirSync(join(amb.dir, '.harness'), { recursive: true });
    writeFileSync(join(amb.dir, '.harness', 'PAUSAR'), '');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'pausado' });
    assert.equal(r.j.sinais.pausado, true);
    spawnSync('rm', [join(amb.dir, '.harness', 'PAUSAR')]);
    assert.equal(amb.cli(['proxima', '--vivos', '0']).j.sinais.pausado, false);
    amb.cli(['abrir', 'T1']);
    mkdirSync(join(amb.wt('T1'), '.harness'), { recursive: true });
    writeFileSync(join(amb.wt('T1'), '.harness', 'PAUSAR'), '');
    const w = amb.cli(['proxima', '--vivos', '0'], { cwd: amb.wt('T1') });
    assert.equal(w.j.sinais.pausado, true);
  });

  test('proxima-diario-ilegivel-rc-1-nunca-concluir', () => {
    const casos = {
      'linha que nao e json': (f) => appendFileSync(f, 'lixo\n'),
      'cadeia de hash quebrada': (f) => {
        const linhas = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        linhas[1].hash_anterior = 'f'.repeat(64);
        writeFileSync(f, `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`);
      },
      'linha que nao e objeto': (f) => appendFileSync(f, '42\n'),
    };
    for (const [nome, estraga] of Object.entries(casos)) {
      const amb = ambiente();
      amb.semear([
        ['task.iniciada', { task: 'T1', papel: 'implementador' }],
        ['task.concluida', { task: 'T1' }],
        ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
        ['task.integrada', { task: 'T1' }],
      ]);
      estraga(join(amb.entregas, 'events.loop.jsonl'));
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 1, nome);
      assert.equal(r.j.ok, false, nome);
      assert.equal(r.j.erro, 'diario_ilegivel', nome);
      assert.notEqual(r.j.acao?.tipo, 'concluir');
    }
  });

  test('proxima-diario-que-nao-e-arquivo-regular-rc-1', () => {
    const amb = ambiente();
    mkdirSync(join(amb.entregas, 'events.x.jsonl'));
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel');
  });

  test('proxima-diario-fora-da-tabela-rc-1', () => {
    const amb = ambiente();
    amb.semear([['task.concluida', { task: 'T1' }]]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_invalido');
    assert.deepEqual(r.j.acao, { tipo: 'parar', motivo: 'diario_invalido' });
  });

  const QUATRO = planoDe(['T1', 'T2', 'T3', 'T4'].map((id) => ({ id, deps: [], arquivos: [`src/${id.toLowerCase()}.txt`] })));
  const semLoopSlots = { gates: { suites: ["echo '# pass 1'"] } };

  test('proxima-slots-medidos: slots vêm de capacidade.mjs --medido, não do config', () => {
    const amb = ambiente({ plano: QUATRO, config: semLoopSlots, capacidade: { ...CAPACIDADE_PADRAO, slots_max: 3 } });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.sinais.slots, 3);
    assert.equal(r.j.acao.itens.length, 3);
    assert.equal(r.j.aviso, undefined);
    // memória medida abaixo do necessário reduz: a medição da máquina vale, não só o arquivo
    const mem = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_CAP_MEM_MB: '2300' } });
    assert.equal(mem.j.sinais.slots, 1, 'quociente de memória: (2300 − reserva)/500 < 2');
    // carga acima da medida reduz
    const carga = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_CAP_LOAD1: '6' } });
    assert.equal(carga.j.sinais.slots, 1, 'floor(3 × 1 / 6) = 0 → 1');
    // costura (P9): redução de 3 para 2 slots passa por capacidade.mjs --medido real e chega em `aviso` do proxima
    const dois = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_CAP_MEM_MB: '3200' } });
    assert.equal(dois.j.sinais.slots, 2, '(3200 − 2048)/500 = 2');
    assert.ok(Array.isArray(dois.j.aviso), JSON.stringify(dois.j.aviso));
    assert.ok(dois.j.aviso.some((a) => /^slots: 2, mem: /.test(a)), JSON.stringify(dois.j.aviso));
    assert.ok(carga.j.aviso.some((a) => /^slots: 1, carga: /.test(a)), JSON.stringify(carga.j.aviso));
  });

  test('proxima-sem-calibracao-1-slot: arquivo ausente, corrompido, de outra máquina ou inválido ⇒ 1 slot e aviso', () => {
    const casos = {
      ausente: null,
      corrompido: '{nao json',
      'de outro hostname': { ...CAPACIDADE_PADRAO, hostname: 'outra-maquina', slots_max: 9 },
      'slots_max zero': { ...CAPACIDADE_PADRAO, slots_max: 0 },
      'campo medido zero': { ...CAPACIDADE_PADRAO, rss_pico_mb: 0, slots_max: 9 },
      'campo medido ausente': { hostname: HOST_TESTE, slots_max: 9 },
      'array': [],
    };
    for (const [nome, capacidade] of Object.entries(casos)) {
      const amb = ambiente({ plano: QUATRO, config: { ...semLoopSlots, loop: { slots: 4 } }, capacidade });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 0, `${nome}: ${r.out}${r.err}`);
      assert.equal(r.j.sinais.slots, 1, nome);
      assert.equal(r.j.acao.itens.length, 1, nome);
      assert.ok(r.j.aviso.some((a) => /slots/.test(a) && /calibr/.test(a)), `${nome}: ${JSON.stringify(r.j.aviso)}`);
    }
  });

  test('proxima-sem-calibracao-1-slot: medição da máquina falhando ou saída inválida do comando ⇒ 1 slot e aviso, nunca slots_max', () => {
    const rodar = (saida) => () => saida;
    const um = (r, rx) => { assert.equal(r.slots, 1); assert.match(r.aviso, rx); };
    um(slotsDaCapacidade('/x', rodar({ status: 1, stdout: '{"slots":9}', stderr: 'boom' })), /rc 1/);
    um(slotsDaCapacidade('/x', rodar({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' })), /SIGTERM|sinal/);
    um(slotsDaCapacidade('/x', rodar({ status: null, error: new Error('ENOENT'), stdout: '', stderr: '' })), /ENOENT/);
    um(slotsDaCapacidade('/x', rodar({ status: 0, stdout: 'isto não é json', stderr: '' })), /JSON/);
    for (const slots of [0, -1, 2.5, '9', null, undefined, Infinity, 1e21]) {
      um(slotsDaCapacidade('/x', rodar({ status: 0, stdout: JSON.stringify({ slots }), stderr: '' })), /slots/);
    }
    um(slotsDaCapacidade('/x', rodar({ status: 0, stdout: '[3]', stderr: '' })), /JSON|objeto/);
    // saída boa: o número medido passa, com o aviso do próprio capacidade.mjs quando houver
    assert.deepEqual(slotsDaCapacidade('/x', rodar({ status: 0, stdout: JSON.stringify({ slots: 3, motivo: 'slots_max 3' }), stderr: '' })), { slots: 3, aviso: null });
    assert.equal(slotsDaCapacidade('/x', rodar({ status: 0, stdout: JSON.stringify({ slots: 1, aviso: 'sem calibração' }), stderr: '' })).aviso, 'slots: sem calibração');
  });

  test('proxima-reducao-traz-motivo: motivo que não é slots_max (memória, disco, carga) aparece em aviso, somado ao aviso existente', () => {
    const rodar = (obj) => () => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });
    const carga = 'carga: load1 47.3 > 28.76 medido com 3 slot(s)';
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 1, motivo: carga })).aviso, `slots: 1, ${carga}`);
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 2, motivo: 'mem 900 MB < 2048' })).aviso, 'slots: 2, mem 900 MB < 2048');
    // aviso já existente não se perde
    const dois = slotsDaCapacidade('/x', rodar({ slots: 1, motivo: carga, aviso: 'sem calibração' })).aviso;
    assert.match(dois, /sem calibração/);
    assert.match(dois, /carga: load1 47\.3/);
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 1, motivo: carga })).slots, 1);
  });

  test('proxima-sem-reducao-sem-aviso: motivo slots_max (sem redução) não gera aviso', () => {
    const rodar = (obj) => () => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });
    assert.deepEqual(slotsDaCapacidade('/x', rodar({ slots: 3, motivo: 'slots_max 3' })), { slots: 3, aviso: null });
    assert.deepEqual(slotsDaCapacidade('/x', rodar({ slots: 3, motivo: 'slots_max' })), { slots: 3, aviso: null });
  });

  test('proxima-motivo-ausente: motivo ausente ou não texto não lança nem muda slots; sem aviso inventado', () => {
    const rodar = (obj) => () => ({ status: 0, stdout: JSON.stringify(obj), stderr: '' });
    for (const motivo of [undefined, null, 5, {}, [], true, '']) {
      const r = slotsDaCapacidade('/x', rodar(motivo === undefined ? { slots: 3 } : { slots: 3, motivo }));
      assert.deepEqual(r, { slots: 3, aviso: null }, JSON.stringify(motivo));
    }
    // aviso próprio sobrevive a motivo inválido
    assert.equal(slotsDaCapacidade('/x', rodar({ slots: 1, aviso: 'sem calibração', motivo: 7 })).aviso, 'slots: sem calibração');
  });

  test('proxima-config-so-reduz: loop.slots menor reduz; maior nunca vence a medição', () => {
    const base = { plano: QUATRO, capacidade: { ...CAPACIDADE_PADRAO, slots_max: 3 } };
    const menor = ambiente({ ...base, config: { ...semLoopSlots, loop: { slots: 1 } } }).cli(['proxima', '--vivos', '0']);
    assert.equal(menor.j.sinais.slots, 1);
    assert.equal(menor.j.aviso, undefined);
    for (const alto of [3, 4, 99, 1e9]) {
      const r = ambiente({ ...base, config: { ...semLoopSlots, loop: { slots: alto } } }).cli(['proxima', '--vivos', '0']);
      assert.equal(r.j.sinais.slots, 3, `loop.slots ${alto}`);
    }
    // loop.slots alto com calibração ausente continua 1 slot
    const sem = ambiente({ ...base, capacidade: null, config: { ...semLoopSlots, loop: { slots: 99 } } }).cli(['proxima', '--vivos', '0']);
    assert.equal(sem.j.sinais.slots, 1);
  });

  test('proxima-concluir-com-tudo-integrado', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['a'] }]) });
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
      ['task.integrada', { task: 'T1' }],
    ]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.acao, { tipo: 'concluir' });
  });

  test('proxima-integrar-quando-ha-aprovada', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(r.j.acao, { tipo: 'integrar', tasks: ['T1'] });
  });

  test('proxima-tokens-do-diario-e-teto-do-config', () => {
    const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2, tetoTokens: 1000 } } });
    amb.semear([
      ['custo.medicao', { input_tokens: 100, output_tokens: 200, cache_read: 99999, cache_creation: 50 }],
      ['custo.medicao', { input_tokens: 10, output_tokens: 20, cache_read: 0, cache_creation: 0 }],
    ]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.j.sinais.tokens, 380);
    assert.equal(r.j.sinais.tetoTokens, 1000);
    assert.equal(r.j.acao.tipo, 'despachar');
    amb.semear([['custo.medicao', { input_tokens: 700, output_tokens: 0, cache_read: 0, cache_creation: 0 }]]);
    const parou = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(parou.j.acao, { tipo: 'parar', motivo: 'teto_tokens' });
  });

  test('proxima-teto-de-tokens-invalido-rc-1', () => {
    for (const teto of [0, -5, 'muito', 1.5, null]) {
      const amb = ambiente({ config: { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2, tetoTokens: teto } } });
      const r = amb.cli(['proxima', '--vivos', '0']);
      assert.equal(r.rc, 1, JSON.stringify(teto));
      assert.equal(r.j.erro, 'config_invalida');
    }
  });

  test('proxima-medicao-corrompida-rc-1', () => {
    const amb = ambiente();
    amb.semear([['custo.medicao', { input_tokens: 'muitos', output_tokens: 1 }]]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_invalido');
  });

  test('proxima-x-decimal (GM-15 T34, emenda 7 r.2): GABARITO_POUSO_X decimal vale como no Stop e no mod (lerX); fora de (0, 100] ⇒ 50 com aviso', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: '37.5' } }).j.sinais.x, 37.5);
    assert.equal(amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: ' 0.5 ' } }).j.sinais.x, 0.5);
    for (const ruim of ['0', '100.5', '1e2', '-3', '50%']) {
      const r = amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: ruim } });
      assert.equal(r.j.sinais.x, 50, ruim);
      assert.ok((r.j.aviso ?? []).some((a) => /GABARITO_POUSO_X inválido/.test(a)), `${ruim}: ${JSON.stringify(r.j.aviso)}`);
    }
  });

  test('proxima-x-vem-do-ambiente', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: '1' } }).j.sinais.x, 1);
    assert.equal(amb.cli(['proxima', '--vivos', '0'], { extra: { GABARITO_POUSO_X: 'abc' } }).j.sinais.x, 50);
  });
});


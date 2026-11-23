// GM-19 T1: parte 2 de loop-cli.test.mjs, dividida por faixa de linha sem mudar nenhum teste.
// O corpo e o de bfa322ad por faixa; ver REQ-SEG-1 da spec da GM-19.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contexto, integrarComGate } from '../scripts/loop.mjs';
import * as diario from '../dist/diario.js';
import { GIT_REAL, novoTmp, g, CONFIG_PADRAO, planoDe, ambiente, semEfeito, PROPOSTA, escreve, grava } from './_loop-cli-helpers.mjs';
// --- corpo movido ---
describe('contrato de falha', () => {
  test('comando-desconhecido-e-argumento-sobrando-sao-uso', () => {
    const amb = ambiente();
    for (const a of [[], ['voar'], ['abrir'], ['abrir', 'T1', 'T2'], ['abrir', 'T1', '--nada'], ['proxima', 'x'], ['parar'], ['parar', 'a', 'b'], ['iniciar', 'T1'], ['abrir', 'T1', '--entrega']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 2, JSON.stringify(a));
      assert.equal(r.j?.ok, false, JSON.stringify(a));
    }
    assert.equal(semEfeito(amb).wts, '');
  });

  test('saida-sempre-json-em-stdout-sem-excecao-crua', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T9'], ['integrar', 'T1'], ['fechar', 'T1'], ['proxima', '--vivos', 'x'], ['voar']]) {
      const r = amb.cli(a);
      assert.ok(r.j && typeof r.j.ok === 'boolean', a.join(' ') + r.out + r.err);
      assert.ok(!/at .*loop\.mjs|node:internal/.test(r.err), r.err);
    }
  });
});

// ─────────────────────────────────────────────────────────────── rodada 2: o que o gate aprovou é o que entra
describe('integrar entra só o commit aprovado', () => {
  const nada = (amb, antes, r, erro) => {
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, erro, r.out);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(!amb.tipos().includes('task.integrada'));
  };

  test('abrir-recusa-branch-de-outra-entrega (GM-15 T34, emenda 7 r.4): base fora da entrega ⇒ base_fora_da_entrega, nada criado', () => {
    // sem --entrega, a branch de outra entrega infere a outra entrega (plano_ausente, recusa antes); a regra pega o `--entrega` apontando para uma e a base em outra
    for (const [branch, extra] of [['scratch', ['--entrega', 'GM-10']], ['enabler/GM-11-outra', ['--entrega', 'GM-10']]]) {
      const amb = ambiente();
      g(amb.dir, 'checkout', '-q', '-b', branch);
      const antes = semEfeito(amb);
      const r = amb.cli(['abrir', 'T1', ...extra]);
      assert.equal(r.rc, 1, r.out + r.err);
      assert.equal(r.j.erro, 'base_fora_da_entrega', `${branch} ${extra}`);
      assert.deepEqual(semEfeito(amb), antes, 'abrir não criou branch nem worktree');
    }
  });

  test('abrir-na-branch-da-entrega-segue (a recusa não pega a base certa)', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    g(amb.dir, 'checkout', '-q', '-b', 'enabler/GM-10-outra-faceta');
    assert.equal(amb.cli(['abrir', 'T2']).rc, 0, 'branch que também resolve para GM-10 é da entrega');
  });

  test('fechar-sem-commit-apaga-branch (GM-15 T34, emenda 7 r.5): worktree sem commit próprio ⇒ a branch sai (git branch -d) e reabrir não dá branch_existe', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.branch_removida, true);
    assert.ok(!amb.branches().includes('wt/GM-10-T1'));
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0, 'reabrir depois de fechar sem trabalho');
    assert.ok(!amb.gitChamadas().some((l) => /branch.*(-D|--force)/.test(l)), 'nunca com force');
  });

  test('fechar-com-commit-mantem (GM-15 T34, emenda 7 r.5): commit próprio ⇒ a branch fica e o retorno diz', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.branch_removida, false);
    assert.match(r.j.branch_motivo, /commit/);
    assert.ok(amb.branches().includes('wt/GM-10-T1'));
  });

  test('abrir-grava-base', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(g(amb.dir, 'config', '--get', 'branch.wt/GM-10-T1.gabaritoBase').trim(), 'enabler/GM-10-loop');
  });

  test('concluir-grava-sha', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const concl = amb.eventos().find((e) => e.tipo === 'task.concluida');
    assert.equal(concl.dados.sha, amb.topo('wt/GM-10-T1'));
    assert.match(concl.dados.sha, /^[0-9a-f]{40}$/);
  });

  test('integrada-grava-sha', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const ev = amb.eventos().at(-1);
    assert.equal(ev.tipo, 'task.integrada');
    assert.equal(ev.dados.sha, amb.topo());
    assert.ok(!('ja_na_base' in ev.dados), 'caminho normal (FIEL-9 d): sem a chave ja_na_base');
    assert.ok(amb.gitChamadas().some((l) => new RegExp(`merge --ff-only ${ev.dados.sha}$`).test(l)), 'merge por sha, não por nome de ref');
  });

  test('integrar-commit-fora-do-gate-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    amb.commitNaWt('T1', 'FORA.txt', 'fora do escopo\n', 'lixo sem padrao');
    g(w, 'checkout', '-q', '-b', 'limpa', 'HEAD~1');
    amb.commitNaWt('T1', 'src/t1.txt', 'limpo\n');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'head_divergente');
    assert.ok(!existsSync(join(amb.dir, 'FORA.txt')));
  });

  test('integrar-head-solto-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    g(w, 'checkout', '-q', '--detach');
    amb.commitNaWt('T1', 'src/solto.txt');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'head_divergente');
    assert.ok(!existsSync(join(amb.dir, 'src/solto.txt')));
  });

  test('integrar-outra-branch-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    g(w, 'checkout', '-q', '-b', 'outra');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'head_divergente');
  });

  test('integrar-principal-em-outra-base-recusa', () => {
    for (const outra of ['main', 'GM-99-outro']) {
      const amb = ambiente();
      amb.aprovar('T1');
      g(amb.dir, 'checkout', '-q', '-b', outra);
      const antes = semEfeito(amb);
      nada(amb, antes, amb.cli(['integrar', 'T1', '--entrega', 'GM-10']), 'base_divergente');
      assert.equal(amb.topo('enabler/GM-10-loop'), amb.topo(outra));
    }
  });

  test('integrar-sem-base-gravada-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    g(amb.dir, 'config', '--unset', 'branch.wt/GM-10-T1.gabaritoBase');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    nada(amb, antes, r, 'base_divergente');
    assert.match(r.j.mensagem, /não está gravada/);
  });

  test('integrar-commit-apos-veredito-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'depois\n', 'feat(GM-10): depois do veredito');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'commit_nao_revisado');
  });

  test('integrar-concluida-sem-sha-recusa', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }],
      ['task.concluida', { task: 'T1' }],
      ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
    ]);
    amb.commitNaWt('T1', 'src/t1.txt');
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'commit_nao_revisado');
  });

  test('integrar-merge-sem-efeito-recusa-sem-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"merge --ff-only"* ]]; then echo "Already up to date."; exit 0; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const antes = semEfeito(amb);
    nada(amb, antes, amb.cli(['integrar', 'T1']), 'merge_sem_efeito');
  });
});

/**
 * GM-14 T32 (Emenda 3, FIEL-9 a–e): o commit aprovado já está na base (C2). `integrar` grava `task.integrada {ja_na_base: true}` sem rebase, gate nem merge,
 * fecha a worktree e diz no `aviso:` o que cobriu o sha. Mutações M-F9a..j, l, m: task-32-mut.json da entrega GM-14.
 */
describe('integrar com o sha aprovado já na base (FIEL-9)', () => {
  const BASE = 'enabler/GM-10-loop';
  const BRANCH = 'wt/GM-10-T1';
  /** C2: o commit da task entrou direto na base (fast-forward da base até ele). */
  const baseAte = (amb, ref) => g(amb.dir, 'merge', '-q', '--ff-only', ref);
  const commitNaBase = (amb, arq = 'src/base.txt') => {
    writeFileSync(join(amb.dir, arq), 'base\n');
    g(amb.dir, 'add', arq);
    g(amb.dir, 'commit', '-q', '-m', 'chore: base anda');
  };
  const aviso = (task, sha, cobertura) => `aviso: ${task} já estava na base (${sha.slice(0, 12)} é ancestral de ${BASE}): integrada sem merge, sem rebase e sem gate; ${cobertura}`;
  const COB_PROXIMO = 'nenhum gate rodou sobre ele ainda; o próximo integrar roda sobre ele';
  const COB_CI = 'nenhum gate rodou sobre ele e não há outro integrar: a CI do pedido de revisão é a 1ª verificação, e o merge espera ela verde';
  const COB_GATE = (t) => `o gate da integração de ${t} já rodou sobre ele`;
  /** Nenhuma chamada de git que move branch ou base (o `merge-base --is-ancestor` não conta). */
  const semMover = (amb) => {
    const movem = amb.gitChamadas().filter((l) => /(^|\s)(rebase|merge|reset|update-ref|cherry-pick)(\s|$)/.test(l));
    assert.deepEqual(movem, [], 'o caminho já na base não faz rebase nem merge');
  };
  const nadaCli = (amb, antes, r, erro) => {
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, erro, r.out);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.deepEqual(semEfeito(amb), antes);
    assert.ok(!amb.tipos().includes('task.integrada'));
  };

  test('ja-na-base-integra-sem-merge', async () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const baseAntes = amb.topo(BASE);
    let chamado = false;
    const r = await integrarComGate(amb.dir, 'T1', { avaliar: async () => { chamado = true; throw new Error('o gate não roda no caminho já na base'); } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(chamado, false, 'o gate não foi chamado');
    assert.equal(r.task, 'T1');
    assert.equal(r.branch, BRANCH);
    assert.equal(r.base, BASE);
    assert.equal(r.merge, false);
    assert.equal(r.ja_na_base, true);
    assert.equal(r.evento, true);
    assert.equal(r.fechada, true);
    assert.equal(r.banco, 'n/a');
    assert.deepEqual(r.ignorados_removidos, []);
    assert.ok(!('mutacoes' in r), 'sem mutações: o gate não rodou');
    assert.deepEqual(r.relato, [aviso('T1', aprovado, COB_PROXIMO)]);
    const ev = amb.eventos().at(-1);
    assert.equal(ev.tipo, 'task.integrada');
    assert.deepEqual(ev.dados, { task: 'T1', sha: aprovado, ja_na_base: true });
    assert.equal(amb.topo(BASE), baseAntes, 'a base não se move');
    assert.equal(amb.topo(BRANCH), aprovado, 'a branch não se move');
    assert.ok(!existsSync(w), 'worktree fechada');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '');
  });

  test('ja-na-base-com-base-a-frente', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    commitNaBase(amb);
    const baseAntes = amb.topo(BASE);
    assert.notEqual(baseAntes, aprovado);
    writeFileSync(amb.gitLog, '');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.ja_na_base, true);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true }, 'grava o sha aprovado, não o HEAD da base');
    assert.equal(amb.topo(BASE), baseAntes);
    assert.equal(amb.topo(BRANCH), aprovado);
    semMover(amb);
    assert.ok(amb.gitChamadas().some((l) => l.endsWith(`merge-base --is-ancestor ${aprovado} refs/heads/${BASE}`)), 'o aprovado é o ancestral testado, a base o descendente');
  });

  test('ja-na-base-aviso-sem-gate-ainda', () => {
    // integração anterior cujo sha NÃO tem o aprovado como ancestral não cobre: cobertura (ii), com T2 ainda por integrar
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    amb.aprovar('T3');
    assert.equal(amb.cli(['integrar', 'T3']).rc, 0);
    g(amb.dir, 'merge', '-q', '--no-ff', '-m', 'chore: T1 entra direto na base', aprovado);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_PROXIMO)]);
    // integração anterior que só "já estava na base" também não cobre: o gate não rodou nela
    const b = ambiente();
    b.aprovar('T1');
    const aprovadoB = b.topo(BRANCH);
    baseAte(b, aprovadoB);
    b.semear([
      ['task.iniciada', { task: 'T3', papel: 'implementador' }],
      ['task.concluida', { task: 'T3', sha: aprovadoB }],
      ['review.veredito', { task: 'T3', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
      ['task.integrada', { task: 'T3', sha: aprovadoB, ja_na_base: true }],
    ]);
    const rb = b.cli(['integrar', 'T1']);
    assert.equal(rb.rc, 0, rb.out + rb.err);
    assert.deepEqual(rb.j.relato, [aviso('T1', aprovadoB, COB_PROXIMO)]);
  });

  test('ja-na-base-aviso-cita-integracao-que-cobriu', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    amb.aprovar('T3');
    const r3 = amb.cli(['integrar', 'T3']);
    assert.equal(r3.rc, 0, r3.out + r3.err);
    assert.equal(r3.j.merge, true, 'T3 integrou com gate sobre a base que já tem o aprovado de T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_GATE('T3'))]);
  });

  test('ja-na-base-ultima-task-cita-ci', () => {
    // única task fora de `integrada`: não há próximo integrar; a cobertura (iii) cita a CI do pedido de revisão
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_CI)]);
    // com outra task já integrada (com gate, antes do aprovado entrar) e nenhuma restante: ainda (iii)
    const b = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T3', deps: [], arquivos: ['src/t3.txt'] }]) });
    b.aprovar('T1');
    const aprovadoB = b.topo(BRANCH);
    b.aprovar('T3');
    assert.equal(b.cli(['integrar', 'T3']).rc, 0);
    g(b.dir, 'merge', '-q', '--no-ff', '-m', 'chore: T1 entra direto na base', aprovadoB);
    const rb = b.cli(['integrar', 'T1']);
    assert.equal(rb.rc, 0, rb.out + rb.err);
    assert.deepEqual(rb.j.relato, [aviso('T1', aprovadoB, COB_CI)]);
  });

  test('ja-na-base-mesmo-alvo-nas-tres-guardas', () => {
    // Correção 1: `alvo` é lido 1 vez do último task.concluida. Depois da 1ª leitura da branch, todo `rev-parse` da branch, da base ou de HEAD
    // devolve um sha falso: se o caminho (b) relesse qualquer um, o gravado mudaria.
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
case "$*" in
  *"rev-parse refs/heads/${BRANCH}"|*"rev-parse refs/heads/${BASE}"|*"rev-parse HEAD")
    if [ -f "$GIT_LOG.marca" ]; then echo ${'f'.repeat(40)}; exit 0; fi
    if [[ "$*" == *"rev-parse refs/heads/${BRANCH}" ]]; then touch "$GIT_LOG.marca"; fi ;;
esac
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(`${amb.gitLog}.marca`), 'a branch foi lida em (a5)');
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true });
    assert.ok(r.j.relato[0].includes(`(${aprovado.slice(0, 12)} é ancestral`), r.j.relato[0]);
    assert.ok(amb.gitChamadas().some((l) => l.endsWith(`merge-base --is-ancestor ${aprovado} refs/heads/${BASE}`)), '(a6) testa o mesmo alvo');
  });

  test('ja-na-base-head-alem-do-aprovado-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    amb.commitNaWt('T1', 'src/t1.txt', 'depois\n', 'feat(GM-10): depois do veredito');
    const topoBranch = amb.topo(BRANCH);
    const antes = semEfeito(amb);
    nadaCli(amb, antes, amb.cli(['integrar', 'T1']), 'commit_nao_revisado');
    assert.equal(amb.topo(BRANCH), topoBranch, 'branch intocada');
  });

  test('ja-na-base-worktree-suja-recusa', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    baseAte(amb, amb.topo(BRANCH));
    writeFileSync(join(w, 'novo.txt'), 'x');
    const antes = semEfeito(amb);
    nadaCli(amb, antes, amb.cli(['integrar', 'T1']), 'worktree_suja');
    assert.equal(readFileSync(join(w, 'novo.txt'), 'utf8'), 'x');
  });

  test('ja-na-base-sem-aprovado-recusa', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    baseAte(amb, amb.topo(BRANCH));
    const antes = semEfeito(amb);
    nadaCli(amb, antes, amb.cli(['integrar', 'T1']), 'nao_integravel');
  });

  test('ancestral-indeterminado-recusa', async () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    for (const codigo of [128, null, 2, -1]) {
      const antes = semEfeito(amb);
      const args = [];
      let gate = false;
      const r = await integrarComGate(amb.dir, 'T1', {
        ancestral: (...a) => { args.push(a); return codigo; },
        avaliar: async () => { gate = true; return { reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 0, semContagem: 0 }; },
      });
      assert.equal(r.ok, false, `${codigo} ${JSON.stringify(r)}`);
      assert.equal(r.erro, 'ancestral_indeterminado', String(codigo));
      assert.equal(r.merge, false);
      assert.equal(r.evento, false);
      assert.equal(gate, false, 'nem o caminho normal');
      assert.deepEqual(args, [[amb.dir, aprovado, `refs/heads/${BASE}`]]);
      assert.deepEqual(semEfeito(amb), antes);
      assert.equal(amb.topo(BRANCH), aprovado, 'branch intocada');
      assert.ok(existsSync(w));
      assert.ok(!amb.tipos().includes('task.integrada'));
    }
  });

  test('nao-ancestral-segue-caminho-normal', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    commitNaBase(amb);
    writeFileSync(amb.gitLog, '');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.ok(!('ja_na_base' in r.j));
    assert.ok(!r.j.relato.some((l) => /já estava na base/.test(l)), JSON.stringify(r.j.relato));
    const ev = amb.eventos().at(-1);
    assert.deepEqual(ev.dados, { task: 'T1', sha: amb.topo(BASE), mutacoes: { total: 0, mortas: 0 } });
    assert.ok(amb.gitChamadas().some((l) => / rebase refs\/heads\//.test(l)), 'rebase do caminho normal');
    assert.ok(amb.gitChamadas().some((l) => / merge --ff-only /.test(l)), 'merge do caminho normal');
  });

  /** abrir → iniciar → concluir SEM commit → revisor → APROVADO: o sha aprovado é a própria base do `abrir`. */
  const aprovarSemCommit = (amb, t) => {
    for (const a of [['abrir', t], ['iniciar', t, 'implementador'], ['concluir', t], ['iniciar', t, 'revisor'], ['veredito', t, 'APROVADO', '1', '0', '0']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 0, `${a.join(' ')} ${r.out}`);
    }
    return amb.wt(t);
  };

  test('abrir-grava-o-sha-da-base', () => {
    const amb = ambiente();
    const topo = amb.topo(BASE);
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(g(amb.dir, 'config', '--get', `branch.${BRANCH}.gabaritoBase`).trim(), BASE, 'gabaritoBase guarda o NOME da base');
    assert.equal(g(amb.dir, 'config', '--get', `branch.${BRANCH}.gabaritoBaseSha`).trim(), topo, 'gabaritoBaseSha guarda o sha da base no abrir');
  });

  test('ja-na-base-sem-commit-proprio-recusa', () => {
    // Emenda 2: sem commit próprio desde a base do `abrir`, o caminho (b) não vale; recusa como antes (A3: 0 commits contra a base)
    for (const baseAnda of [true, false]) {
      const amb = ambiente();
      const w = aprovarSemCommit(amb, 'T1');
      const aprovado = amb.topo(BRANCH);
      if (baseAnda) commitNaBase(amb);
      assert.equal(spawnSync(GIT_REAL, ['-C', amb.dir, 'merge-base', '--is-ancestor', aprovado, BASE]).status, 0, 'o aprovado é ancestral da base');
      const topoBase = amb.topo(BASE);
      const r = amb.cli(['integrar', 'T1']);
      assert.equal(r.rc, 1, `${baseAnda} ${r.out}${r.err}`);
      assert.equal(r.j.erro, 'gate_reprovado', r.out);
      assert.ok(r.j.relato.some((l) => /0 commits contra a base/.test(l)), JSON.stringify(r.j.relato));
      assert.equal(r.j.merge, false);
      assert.equal(r.j.evento, false);
      assert.ok(!('ja_na_base' in r.j));
      assert.ok(!amb.tipos().includes('task.integrada'), 'sem task.integrada gravada');
      assert.equal(amb.topo(BASE), topoBase, 'base intocada');
      assert.equal(amb.topo(BRANCH), aprovado, 'a branch voltou ao commit revisado');
      assert.ok(existsSync(w));
    }
  });

  test('ja-na-base-sem-sha-da-base-gravado-segue-caminho-normal', () => {
    // worktree aberta sem `gabaritoBaseSha` (versão anterior do abrir): não há prova de commit próprio, segue o caminho de antes
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    commitNaBase(amb);
    g(amb.dir, 'config', '--unset', `branch.${BRANCH}.gabaritoBaseSha`);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado', r.out);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  /**
   * Emenda 3: a TOPOLOGIA EXATA da T0 real. O commit da task entrou na base ANTES do `abrir`: a branch nasce NELE ("Created from <sha>"),
   * sem commit próprio, e a base anda depois. Só um `desvio` da MESMA task citando o sha aprovado libera o caminho (b); sem ele, recusa (A3).
   */
  const PLANO_DESVIO = planoDe([
    { id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] },
    { id: 'T2', deps: [], arquivos: ['src/t2.txt'], reqs: ['REQ-A-2'] },
  ]);
  const topologiaT0 = ({ semShaGravado = false } = {}) => {
    const amb = ambiente({ plano: PLANO_DESVIO });
    writeFileSync(join(amb.dir, 'src/t1.txt'), 't0 commitada direto na base\n');
    g(amb.dir, 'add', 'src/t1.txt');
    g(amb.dir, 'commit', '-q', '-m', 'docs(GM-10): T0 direto na base');
    const aprovado = amb.topo(BASE);
    const w = aprovarSemCommit(amb, 'T1');
    commitNaBase(amb);
    // fatos do git medidos, não presumidos: a branch nasceu no aprovado, sem commit próprio, e ele é ancestral da base
    assert.equal(amb.topo(BRANCH), aprovado);
    assert.match(g(amb.dir, 'reflog', 'show', '--format=%gs', BRANCH).trim().split('\n').at(-1), new RegExp(`^branch: Created from ${aprovado}$`));
    assert.equal(g(amb.dir, 'merge-base', BRANCH, BASE).trim(), aprovado);
    assert.equal(g(amb.dir, 'rev-list', '--count', `${aprovado}..${BRANCH}`).trim(), '0');
    assert.equal(spawnSync(GIT_REAL, ['-C', amb.dir, 'merge-base', '--is-ancestor', aprovado, BASE]).status, 0);
    if (semShaGravado) g(amb.dir, 'config', '--unset', `branch.${BRANCH}.gabaritoBaseSha`);
    return { amb, w, aprovado };
  };
  const desvio = (amb, task, req, evidencia, arquivos = '') => {
    const r = amb.cli(['desvio', task, '--req', req, '--evidencia', evidencia, '--arquivos', arquivos, '--causa', 'tecnica']);
    assert.equal(r.rc, 0, r.out + r.err);
  };
  const recusaZeroCommits = (amb, w, aprovado) => {
    const topoBase = amb.topo(BASE);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado', r.out);
    assert.ok(r.j.relato.some((l) => /0 commits contra a base/.test(l)), JSON.stringify(r.j.relato));
    assert.equal(r.j.evento, false);
    assert.ok(!('ja_na_base' in r.j));
    assert.ok(!amb.tipos().includes('task.integrada'), 'nada gravado');
    assert.equal(amb.topo(BASE), topoBase, 'base intocada');
    assert.equal(amb.topo(BRANCH), aprovado, 'a branch voltou ao commit revisado');
    assert.ok(existsSync(w));
  };
  const integraPorB = (amb, w, aprovado) => {
    const topoBase = amb.topo(BASE);
    writeFileSync(amb.gitLog, '');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.merge, false);
    assert.equal(r.j.ja_na_base, true);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true });
    assert.equal(amb.topo(BASE), topoBase, 'a base não se move');
    assert.ok(!existsSync(w), 'worktree fechada');
    semMover(amb);
  };

  test('t0-sem-desvio-recusa-zero-commits', () => {
    for (const semShaGravado of [false, true]) {
      const { amb, w, aprovado } = topologiaT0({ semShaGravado });
      recusaZeroCommits(amb, w, aprovado);
    }
  });

  test('t0-desvio-da-task-citando-o-sha-integra-por-b', () => {
    for (const semShaGravado of [false, true]) {
      // sha completo em `evidencia`; com e sem `gabaritoBaseSha` (abrir antigo)
      const { amb, w, aprovado } = topologiaT0({ semShaGravado });
      desvio(amb, 'T1', 'REQ-A-1', `T0 commitada na base antes do abrir: ${aprovado}`);
      integraPorB(amb, w, aprovado);
    }
  });

  test('t0-desvio-cita-sha-curto-inequivoco-integra-por-b', () => {
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T1', 'REQ-A-1', `T0 na base (${aprovado.slice(0, 7)}), reflog Created from`);
    integraPorB(amb, w, aprovado);
  });

  test('t0-desvio-cita-sha-em-arquivos-integra-por-b', () => {
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T1', 'REQ-A-1', 'T0 commitada na base antes do abrir', `src/t1.txt,${aprovado.slice(0, 12)}`);
    integraPorB(amb, w, aprovado);
  });

  test('t0-desvio-de-outra-task-citando-o-sha-recusa', () => {
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T2', 'REQ-A-2', `T0 commitada na base antes do abrir: ${aprovado}`, aprovado);
    recusaZeroCommits(amb, w, aprovado);
  });

  test('t0-evento-de-outro-tipo-da-mesma-task-citando-o-sha-recusa', () => {
    // a exceção é SÓ do `desvio`: proposta de emenda (a rejeitada; a aceita reabriria a aprovação) da MESMA task, citando o sha em evidencia e em arquivos, não libera (b)
    const { amb, w, aprovado } = topologiaT0();
    const dados = PROPOSTA({ task: 'T1', evidencia: `T0 na base: ${aprovado}`, arquivos: [aprovado] });
    escreve(amb, 'emendas', 'emenda.proposta', dados, '2026-02-01T00:00:01.000Z');
    escreve(amb, 'dono', 'emenda.rejeitada', { proposta_seq: 1, origem: 'dono' }, '2026-02-01T00:00:02.000Z');
    recusaZeroCommits(amb, w, aprovado);
  });

  test('t0-desvio-da-task-citando-outro-sha-recusa', () => {
    const { amb, w, aprovado } = topologiaT0();
    const outro = amb.topo(BASE);
    assert.notEqual(outro, aprovado);
    desvio(amb, 'T1', 'REQ-A-1', `outro commit: ${outro}`, outro.slice(0, 12));
    recusaZeroCommits(amb, w, aprovado);
  });

  test('t0-desvio-cita-sha-curto-demais-ou-ambiguo-recusa', () => {
    // 6 hex não cita; prefixo que o git não resolve só para o aprovado (ambíguo) não cita; sha com 1 hex a mais (41) não cita; maiúsculas não são o texto exato
    const { amb, w, aprovado } = topologiaT0();
    desvio(amb, 'T1', 'REQ-A-1', `curto ${aprovado.slice(0, 6)} longo ${aprovado}0 caixa ${aprovado.toUpperCase()} colado x${aprovado.slice(0, 8)}`);
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"rev-parse --verify --quiet --end-of-options ${aprovado.slice(0, 7)}" ]]; then exit 128; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    desvio(amb, 'T1', 'REQ-A-1', `ambíguo ${aprovado.slice(0, 7)}`);
    recusaZeroCommits(amb, w, aprovado);
  });

  test('ja-na-base-commit-proprio-indeterminado-recusa', async () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const baseAbrir = g(amb.dir, 'config', '--get', `branch.${BRANCH}.gabaritoBaseSha`).trim();
    for (const codigo of [128, null]) {
      const antes = semEfeito(amb);
      const args = [];
      let gate = false;
      const r = await integrarComGate(amb.dir, 'T1', {
        ancestral: (...a) => { args.push(a); return args.length === 1 ? 0 : codigo; },
        avaliar: async () => { gate = true; return { reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 0, semContagem: 0 }; },
      });
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.equal(r.erro, 'ancestral_indeterminado', String(codigo));
      assert.equal(r.merge, false);
      assert.equal(r.evento, false);
      assert.equal(gate, false);
      assert.deepEqual(args, [[amb.dir, aprovado, `refs/heads/${BASE}`], [amb.dir, aprovado, baseAbrir]]);
      assert.deepEqual(semEfeito(amb), antes);
      assert.ok(existsSync(w));
    }
  });

  test('ja-na-base-erro-do-git-na-cobertura-nao-cobriu', () => {
    // FIEL-9 (b4): `merge-base --is-ancestor` que falha na cobertura conta como "não cobriu", nunca como cobertura
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    amb.aprovar('T3');
    assert.equal(amb.cli(['integrar', 'T3']).rc, 0);
    const shaT3 = amb.eventos().at(-1).dados.sha;
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"merge-base --is-ancestor ${aprovado} ${shaT3}" ]]; then echo "fatal: injetado" >&2; exit 128; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(amb.gitChamadas().some((l) => l.endsWith(`merge-base --is-ancestor ${aprovado} ${shaT3}`)), 'a cobertura testou a integração de T3');
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_PROXIMO)]);
  });

  test('ja-na-base-cobertura-cita-a-primeira-integracao-do-diario', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T3', deps: [], arquivos: ['src/t3.txt'] }, { id: 'T4', deps: [], arquivos: ['src/t4.txt'] }]) });
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    for (const t of ['T3', 'T4']) {
      amb.aprovar(t);
      const ri = amb.cli(['integrar', t]);
      assert.equal(ri.rc, 0, ri.out + ri.err);
      assert.equal(ri.j.merge, true, `${t} integrou com gate`);
    }
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, [aviso('T1', aprovado, COB_GATE('T3'))]);
  });

  test('ja-na-base-evento-nao-gravado-nao-fecha', () => {
    const amb = ambiente();
    const w = amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const topoBase = amb.topo(BASE);
    chmodSync(amb.entregas, 0o555);
    let r;
    try { r = amb.cli(['integrar', 'T1']); } finally { chmodSync(amb.entregas, 0o755); }
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'evento_nao_gravado');
    assert.equal(r.j.merge, false, 'nada foi movido');
    assert.equal(r.j.evento, false);
    assert.match(r.j.mensagem, /já estava na base/);
    assert.ok(!amb.tipos().includes('task.integrada'));
    assert.ok(existsSync(w), 'fechar não foi chamado');
    assert.ok(!amb.gitChamadas().some((l) => /worktree remove/.test(l)));
    assert.equal(amb.topo(BASE), topoBase);
    assert.equal(amb.topo(BRANCH), aprovado);
  });

  test('ja-na-base-fechar-falha-relata-evento', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const aprovado = amb.topo(BRANCH);
    baseAte(amb, aprovado);
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'worktree remove' } });
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'fechar_falhou');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, true);
    assert.match(r.j.mensagem, /já estava na base/);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', sha: aprovado, ja_na_base: true });
  });

  test('proxima-apos-ja-na-base', () => {
    // com pendente: antes integrar, depois despachar a dependente
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: ['T1'], arquivos: ['src/t2.txt'] }]) });
    amb.aprovar('T1');
    baseAte(amb, amb.topo(BRANCH));
    amb.fechar();
    const antes = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(antes.rc, 0, antes.out);
    assert.deepEqual(antes.j.acao, { tipo: 'integrar', tasks: ['T1'] });
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    amb.fechar();
    const depois = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(depois.rc, 0, depois.out);
    assert.equal(depois.j.acao.tipo, 'despachar', JSON.stringify(depois.j.acao));
    assert.deepEqual(depois.j.acao.itens.map((i) => i.task), ['T2']);
    // sem pendente: depois concluir
    const b = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });
    b.aprovar('T1');
    baseAte(b, b.topo(BRANCH));
    b.fechar();
    assert.equal(b.cli(['proxima', '--vivos', '0']).j.acao.tipo, 'integrar');
    assert.equal(b.cli(['integrar', 'T1']).rc, 0);
    b.fechar();
    const fim = b.cli(['proxima', '--vivos', '0']);
    assert.equal(fim.j.acao.tipo, 'concluir', JSON.stringify(fim.j.acao));
  });
});

describe('fechar não perde nada (rodada 2)', () => {
  const comIgnorado = () => {
    const amb = ambiente();
    amb.comBanco();
    appendFileSync(join(amb.dir, '.gitignore'), '*.local\n');
    g(amb.dir, 'add', '.gitignore');
    g(amb.dir, 'commit', '-q', '-m', 'chore: ignora local');
    return amb;
  };

  test('fechar-ignorado-remove-e-relata', () => {
    const amb = comIgnorado();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'x.local'), 'regeneravel');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.ignorados_removidos, ['x.local']);
    assert.ok(!existsSync(w), 'a worktree saiu');
    assert.ok(amb.sqls().some((s) => /^DROP/.test(s)), 'o banco foi solto');
  });

  test('fechar-nao-rastreado-recusa', () => {
    const amb = comIgnorado();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'x.local'), 'regeneravel');
    writeFileSync(join(w, 'unico.txt'), 'trabalho unico');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.match(r.j.mensagem, /unico\.txt/);
    assert.equal(readFileSync(join(w, 'unico.txt'), 'utf8'), 'trabalho unico');
    assert.equal(readFileSync(join(w, 'x.local'), 'utf8'), 'regeneravel');
    assert.ok(!amb.sqls().some((s) => /^DROP/.test(s)), 'o banco não foi solto');
  });

  test('fechar-showuntracked-no-recusa', () => {
    const amb = ambiente();
    g(amb.dir, 'config', 'status.showUntrackedFiles', 'no');
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    writeFileSync(join(w, 'unico.txt'), 'trabalho unico');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.equal(readFileSync(join(w, 'unico.txt'), 'utf8'), 'trabalho unico');
  });

  test('fechar-remove-sem-efeito-rc1', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const bin = amb.env.PATH.split(':')[0];
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"worktree remove"* ]]; then exit 0; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'remove_falhou');
    assert.ok(existsSync(amb.wt('T1')));
  });

  test('fechar-head-solto-recusa', () => {
    const amb = ambiente();
    amb.comBanco();
    amb.cli(['abrir', 'T1']);
    const w = amb.wt('T1');
    g(w, 'checkout', '-q', '--detach');
    amb.commitNaWt('T1', 'src/solto.txt');
    const sha = g(w, 'rev-parse', 'HEAD').trim();
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'head_solto');
    assert.ok(existsSync(w));
    assert.equal(g(w, 'rev-parse', 'HEAD').trim(), sha);
    assert.ok(existsSync(join(w, '.tmp-gabarito')));
    assert.ok(!amb.sqls().some((s) => /^DROP/.test(s)), 'o banco não foi solto');
  });
});

describe('integrar tudo ou nada (rodada 3)', () => {
  const FLAG = () => join(novoTmp('loop-flag-'), 'verde');
  const avancaBase = (amb) => {
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
  };
  const gateVerdeSe = (flag) => ({ gates: { suites: [`test -f ${flag} && echo '# pass 1'`] } });

  test('integrar-gate-vermelho-volta-ao-revisado', () => {
    const flag = FLAG();
    const amb = ambiente({ config: gateVerdeSe(flag) });
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const topoMain = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.voltou, true);
    assert.match(r.j.mensagem, /voltou ao commit revisado/);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado, 'a branch');
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado, 'a worktree');
    assert.equal(g(amb.wt('T1'), 'status', '--porcelain').trim(), '');
    assert.equal(amb.topo(), topoMain);
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-conflito-volta-ao-revisado', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/a.txt'] }]) });
    amb.cli(['abrir', 'T1']);
    amb.cli(['iniciar', 'T1', 'implementador']);
    amb.commitNaWt('T1', 'src/a.txt', 'TASK\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor'], ['veredito', 'T1', 'APROVADO', '1', '0', '0']]) amb.cli(a);
    const revisado = amb.topo('wt/GM-10-T1');
    writeFileSync(join(amb.dir, 'src/a.txt'), 'MAIN\n');
    g(amb.dir, 'commit', '-q', '-am', 'chore: main mexe');
    for (let i = 0; i < 2; i += 1) {
      const r = amb.cli(['integrar', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'rebase_conflito', `tentativa ${i + 1}: ${r.out}`);
      assert.equal(r.j.voltou, true);
      assert.equal(amb.topo('wt/GM-10-T1'), revisado);
      assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado);
    }
  });

  test('integrar-apos-falha-repete-sem-commit-nao-revisado', () => {
    const flag = FLAG();
    const amb = ambiente({ config: gateVerdeSe(flag) });
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'gate_reprovado', r1.out);
    writeFileSync(flag, 'ok');
    const r2 = amb.cli(['integrar', 'T1']);
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.equal(r2.j.merge, true);
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
  });

  test('integrar-volta-falha-relata', () => {
    const flag = FLAG();
    const amb = ambiente({ config: gateVerdeSe(flag) });
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'reset --keep' } });
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'gate_reprovado', 'a causa original não se perde');
    assert.equal(r.j.voltou, false);
    assert.match(r.j.mensagem, /gate reprovado/);
    assert.match(r.j.mensagem, /volta .* FALHOU/);
    assert.notEqual(amb.topo('wt/GM-10-T1'), revisado, 'ficou onde o rebase deixou, sem apagar');
    assert.ok(existsSync(amb.wt('T1')));
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('integrar-com-ignorado-rc0', () => {
    const amb = ambiente();
    appendFileSync(join(amb.dir, '.gitignore'), 'node_modules/\n*.local\n');
    g(amb.dir, 'add', '.gitignore');
    g(amb.dir, 'commit', '-q', '-m', 'chore: ignora');
    amb.aprovar('T1');
    const w = amb.wt('T1');
    mkdirSync(join(w, 'node_modules'));
    writeFileSync(join(w, 'node_modules', 'x.js'), 'x');
    writeFileSync(join(w, 'y.local'), 'y');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.ok(!existsSync(w));
    assert.ok(existsSync(join(amb.dir, 'src/t1.txt')));
    assert.deepEqual(r.j.ignorados_removidos, ['node_modules/', 'y.local']);
  });

  test('integrar-showuntracked-no-recusa', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    g(amb.dir, 'config', 'status.showUntrackedFiles', 'no');
    writeFileSync(join(amb.wt('T1'), 'unico.txt'), 'trabalho unico');
    const antes = semEfeito(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'worktree_suja');
    assert.equal(r.j.merge, false);
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(readFileSync(join(amb.wt('T1'), 'unico.txt'), 'utf8'), 'trabalho unico');
  });

  test('integrar-merge-nao-confirmado-nao-volta', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const bin = amb.env.PATH.split(':')[0];
    const cont = join(dirname(bin), 'cont');
    writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "$GIT_LOG"
if [[ "$*" == *"merge --ff-only"* ]]; then touch "${cont}"; fi
if [ -f "${cont}" ] && [[ "$*" == *"rev-parse refs/heads/enabler/GM-10-loop"* ]]; then echo "falha injetada" >&2; exit 1; fi
exec "${GIT_REAL}" "$@"
`, { mode: 0o755 });
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'merge_nao_confirmado');
    assert.equal(r.j.merge, null);
    assert.notEqual(amb.topo('wt/GM-10-T1'), revisado, 'o merge pode ter entrado: a branch não volta');
    assert.doesNotMatch(r.j.mensagem, /voltou/);
  });
});

describe('ci', () => {
  test('ci-grava-resultado', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['ci', 'verde']).rc, 0);
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    const ev = amb.eventos().filter((e) => e.tipo === 'ci.resultado');
    assert.deepEqual(ev.map((e) => e.dados), [{ verde: true }, { verde: false }]);
    const antes = amb.eventos().length;
    for (const a of [['ci', 'azul'], ['ci', 'VERDE'], ['ci', '']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 1, a.join(' '));
      assert.equal(r.j.ok, false);
    }
    assert.equal(amb.eventos().length, antes);
  });

  test('ci-vermelho-2x-para', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    assert.notEqual(amb.cli(['proxima', '--vivos', '0']).j.acao.motivo, 'ci_vermelho');
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.acao, { tipo: 'parar', motivo: 'ci_vermelho' });
  });
});

// ─────────────────────────────────────────────────────────────── rodada 4: a volta decide pelo estado e não perde commit
describe('devolver preserva commit e relata ignorados', () => {
  const alcancavel = (amb, msg) => g(amb.dir, 'log', '--branches', '--format=%s', `--grep=${msg}`).trim().split('\n').filter(Boolean);
  const comSuite = (cmd) => ambiente({ config: { ...CONFIG_PADRAO, gates: { suites: [cmd] } } });
  const avancaBase = (amb) => {
    writeFileSync(join(amb.dir, 'src/b.txt'), 'b\n');
    g(amb.dir, 'add', 'src/b.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: avanca');
  };
  const PRESERVADO = /^wt-preservado\/GM-10-T1-[0-9a-f]{12}$/;

  test('head-mudou-preserva-commit', () => {
    const amb = comSuite("git commit -q --allow-empty -m mexe; echo '# pass 1'");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'head_mudou');
    assert.equal(r.j.merge, false);
    assert.equal(r.j.evento, false);
    assert.equal(r.j.voltou, true);
    assert.match(r.j.preservado, PRESERVADO);
    assert.equal(amb.topo(r.j.preservado), r.j.topo);
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', r.j.preservado).trim(), 'mexe');
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe']);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado);
    assert.ok(r.j.mensagem.includes(r.j.preservado), 'a mensagem cita onde o commit está');
    assert.ok(!amb.tipos().includes('task.integrada'));
  });

  test('gate-reprovado-com-commit-preserva', () => {
    const amb = comSuite('git commit -q --allow-empty -m mexe; exit 1');
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.voltou, true);
    assert.match(r.j.preservado, PRESERVADO);
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe']);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
  });

  test('head-alheio-nao-toca', () => {
    const amb = comSuite("git checkout -q -b alheia; git commit -q --allow-empty -m trabalho-alheio; exit 1");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'gate_reprovado');
    const w = amb.wt('T1');
    assert.equal(g(w, 'symbolic-ref', 'HEAD').trim(), 'refs/heads/alheia', 'o HEAD não foi tocado');
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', 'alheia').trim(), 'trabalho-alheio', 'a branch alheia não foi movida');
    assert.deepEqual(alcancavel(amb, 'trabalho-alheio'), ['trabalho-alheio']);
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.equal(r.j.voltou, false);
    assert.ok(!amb.branches().some((b) => b.startsWith('wt-preservado/')), 'o rebaseado que o gate avaliou não é commit novo');
    assert.equal(r.j.branch_voltou, true);
    assert.equal(r.j.head_em, 'refs/heads/alheia');
    assert.match(r.j.mensagem, /NÃO foi tocado/);
    assert.match(r.j.mensagem, /git checkout wt\/GM-10-T1/);
  });

  test('head-alheio-com-suite-verde-nao-toca', () => {
    const amb = comSuite("git checkout -q -b alheia; git commit -q --allow-empty -m trabalho-alheio; echo '# pass 1'");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'head_mudou');
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', 'alheia').trim(), 'trabalho-alheio');
    assert.equal(g(amb.wt('T1'), 'symbolic-ref', 'HEAD').trim(), 'refs/heads/alheia');
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.equal(r.j.branch_voltou, true);
  });

  test('head-solto-com-commit-nao-toca', () => {
    const amb = comSuite("git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1");
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.branch_voltou, true);
    assert.equal(r.j.head_em, 'solto');
    assert.equal(amb.topo('wt/GM-10-T1'), revisado);
    assert.notEqual(g(amb.wt('T1'), 'rev-parse', 'HEAD').trim(), revisado, 'o HEAD solto fica onde estava');
  });

  test('commit-so-na-primeira-tentativa-fica-preservado', () => {
    const flag = join(novoTmp('loop-flag-'), 'ja');
    const amb = comSuite(`if [ ! -f ${flag} ]; then touch ${flag}; git commit -q --allow-empty -m mexe; fi; echo '# pass 1'`);
    amb.aprovar('T1');
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'head_mudou', r1.out);
    const r2 = amb.cli(['integrar', 'T1']);
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe'], 'o commit sobrevive à integração da retentativa');
    assert.ok(amb.branches().includes(r1.j.preservado));
  });

  test('preservar-falha-nao-move-nada', () => {
    const amb = comSuite('git commit -q --allow-empty -m mexe; exit 1');
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'branch wt-preservado' } });
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.voltou, false);
    assert.equal(r.j.preservado, undefined);
    assert.deepEqual(alcancavel(amb, 'mexe'), ['mexe'], 'o commit segue alcançável por branch');
    assert.equal(g(amb.dir, 'log', '-1', '--format=%s', 'wt/GM-10-T1').trim(), 'mexe');
    assert.match(r.j.mensagem, /não consegui preservar/);
    assert.ok(!amb.branches().some((b) => b.startsWith('wt-preservado/')));
  });

  // HEAD solto: nenhuma branch segura o que ele aponta, então o commit vai para `wt-preservado/*` antes da volta (sombra-t6c.md).
  const umaVez = (cmd, depois = "echo '# pass 1'") => { const f = join(novoTmp('loop-flag-'), 'ja'); return `if [ ! -f ${f} ]; then touch ${f}; ${cmd}; else ${depois}; fi`; };
  /** Segue a saída que a mensagem indica (checkout da branch), repete `integrar` e prova o alcance depois de expirar reflog e coletar lixo. */
  const seguirSaida = (amb, msg) => {
    const co = spawnSync('git', ['checkout', 'wt/GM-10-T1'], { cwd: amb.wt('T1'), encoding: 'utf8' });
    assert.equal(co.status, 0, co.stderr);
    const r2 = amb.cli(['integrar', 'T1']);
    const wtExiste = existsSync(amb.wt('T1'));
    g(amb.dir, 'reflog', 'expire', '--expire=now', '--all');
    g(amb.dir, 'gc', '-q', '--prune=now');
    return { r2, wtExiste, al: alcancavel(amb, msg) };
  };

  test('head-solto-segue-a-saida-sem-perder', () => {
    const amb = comSuite(umaVez('git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'gate_reprovado', r1.out);
    assert.equal(r1.j.voltou, false);
    assert.equal(r1.j.branch_voltou, true);
    assert.equal(r1.j.head_em, 'solto');
    assert.match(r1.j.preservado_solto, PRESERVADO);
    assert.equal(amb.topo(r1.j.preservado_solto), r1.j.topo_solto);
    assert.ok(r1.j.mensagem.includes(r1.j.preservado_solto), 'a mensagem cita a branch que segura o commit');
    assert.match(r1.j.mensagem, /git checkout wt\/GM-10-T1/);
    const { r2, wtExiste, al } = seguirSaida(amb, 'solto');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.equal(wtExiste, false, 'a worktree foi removida');
    assert.deepEqual(al, ['solto'], 'o commit do HEAD solto segue alcançável por --branches');

    // verde, mesma regra: o `head_mudou` também preserva
    const amb2 = comSuite(umaVez("git checkout -q --detach; git commit -q --allow-empty -m solto; echo '# pass 1'"));
    amb2.aprovar('T1');
    avancaBase(amb2);
    const v1 = amb2.cli(['integrar', 'T1']);
    assert.equal(v1.j.erro, 'head_mudou', v1.out);
    assert.match(v1.j.preservado_solto, PRESERVADO);
    const v = seguirSaida(amb2, 'solto');
    assert.equal(v.r2.rc, 0, v.r2.out + v.r2.err);
    assert.deepEqual(v.al, ['solto']);
  });

  test('head-solto-e-branch-preserva-os-dois', () => {
    const amb = comSuite(umaVez('git commit -q --allow-empty -m nabranch; git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.match(r1.j.preservado, PRESERVADO);
    assert.match(r1.j.preservado_solto, PRESERVADO);
    assert.notEqual(r1.j.preservado, r1.j.preservado_solto);
    const { r2, al } = seguirSaida(amb, 'solto');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(al, ['solto']);
    assert.deepEqual(alcancavel(amb, 'nabranch'), ['nabranch'], 'o commit que ficou na branch também sobrevive');
  });

  test('head-solto-no-topo-uma-branch', () => {
    const amb = comSuite(umaVez('git commit -q --allow-empty -m nabranch; git checkout -q --detach; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.match(r1.j.preservado, PRESERVADO);
    assert.equal(r1.j.preservado_solto, undefined, 'mesmo sha da branch: 1 branch só');
    assert.equal(amb.branches().filter((b) => b.startsWith('wt-preservado/')).length, 1);
    const { r2, al } = seguirSaida(amb, 'nabranch');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(al, ['nabranch']);
  });

  test('head-solto-sem-commit-nao-preserva', () => {
    const amb = comSuite(umaVez('git checkout -q --detach; exit 1'));
    amb.aprovar('T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.head_em, 'solto');
    assert.equal(r1.j.preservado_solto, undefined);
    const { r2 } = seguirSaida(amb, 'naoexiste');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.ok(!amb.branches().some((b) => b.startsWith('wt-preservado/')));
  });

  test('head-solto-preservar-falha-nao-manda-checkout', () => {
    const amb = comSuite(umaVez('git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1'));
    amb.aprovar('T1');
    const revisado = amb.topo('wt/GM-10-T1');
    avancaBase(amb);
    const r1 = amb.cli(['integrar', 'T1'], { extra: { GIT_FALHAR: 'branch wt-preservado' } });
    assert.equal(r1.rc, 1, r1.out + r1.err);
    assert.equal(r1.j.voltou, false);
    assert.equal(r1.j.head_em, undefined);
    assert.equal(r1.j.preservado_solto, undefined);
    assert.match(r1.j.mensagem, /não consegui preservar/);
    assert.match(r1.j.mensagem, /confira à mão/);
    assert.ok(!/git checkout/.test(r1.j.mensagem), 'sem a saída que abandonaria o commit');
    assert.equal(g(amb.wt('T1'), 'log', '-1', '--format=%s', 'HEAD').trim(), 'solto', 'o HEAD segue no commit');
    assert.equal(r1.j.branch_voltou, undefined, 'a branch não foi movida');
    assert.notEqual(amb.topo('wt/GM-10-T1'), revisado, 'segue no commit rebaseado, não voltou');
    const r2 = amb.cli(['integrar', 'T1']);
    assert.equal(r2.j.erro, 'head_divergente');
  });

  test('head-solto-hook-pre-rebase-preserva', () => {
    const amb = comSuite("echo '# pass 1'");
    amb.aprovar('T1');
    avancaBase(amb);
    const flag = join(novoTmp('loop-flag-'), 'ja');
    const hp = join(amb.dir, g(amb.dir, 'rev-parse', '--git-path', 'hooks').trim(), 'pre-rebase');
    mkdirSync(dirname(hp), { recursive: true });
    writeFileSync(hp, `#!/bin/sh\nif [ ! -f ${flag} ]; then touch ${flag}; git checkout -q --detach; git commit -q --allow-empty -m solto; exit 1; fi\nexit 0\n`);
    chmodSync(hp, 0o755);
    const r1 = amb.cli(['integrar', 'T1']);
    assert.equal(r1.j.erro, 'rebase_falhou', r1.out);
    assert.match(r1.j.preservado_solto, PRESERVADO);
    const { r2, al } = seguirSaida(amb, 'solto');
    assert.equal(r2.rc, 0, r2.out + r2.err);
    assert.deepEqual(al, ['solto']);
  });

  test('integrar-relata-ignorados', () => {
    const amb = ambiente();
    appendFileSync(join(amb.dir, '.gitignore'), '*.local\n');
    g(amb.dir, 'add', '.gitignore');
    g(amb.dir, 'commit', '-q', '-m', 'chore: ignora');
    amb.aprovar('T1');
    writeFileSync(join(amb.wt('T1'), 'y.local'), 'y');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.ignorados_removidos, ['y.local']);
  });

  test('integrar-sem-ignorados-relata-lista-vazia', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.ignorados_removidos, []);
  });

  test('rebase-com-contexto-mudado-integra', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt', 'src/a.txt'] }]) });
    const linhas = (n8) => ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', n8, 'l9', 'l10'].join('\n') + '\n';
    writeFileSync(join(amb.dir, 'src/a.txt'), linhas('l8'));
    g(amb.dir, 'add', 'src/a.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: dez linhas');
    amb.aprovar('T1', 'src/t1.txt', [['src/a.txt', linhas('l8').replace('l10', 'L10-T1')]]);
    writeFileSync(join(amb.dir, 'src/a.txt'), linhas('L8-BASE'));
    g(amb.dir, 'add', 'src/a.txt');
    g(amb.dir, 'commit', '-q', '-m', 'chore: base mexe no contexto');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(readFileSync(join(amb.dir, 'src/a.txt'), 'utf8'), linhas('L8-BASE').replace('l10', 'L10-T1'));
  });
});

// ─────────────────────────────────────────────────────────────── T20 (GM-10, spec r8): a memória sobrevive ao /clear
// Depois do /clear o modelo não sabe se já abriu, em que rodada está nem onde ficaram os achados: o CLI é a única memória.


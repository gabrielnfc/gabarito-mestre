// GM-19 T1: parte 3 de loop-cli.test.mjs, dividida por faixa de linha sem mudar nenhum teste.
// O corpo e o de bfa322ad por faixa; ver REQ-SEG-1 da spec da GM-19.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contexto, integrarComGate } from '../scripts/loop.mjs';
import { idDaBranch, trilhaDe } from '../dist/trilha.js';
import { casarAgente } from '../dist/painel-equipe.js';
import { estadoDe as estadoNucleo, ordenar as ordenarNucleo } from '../dist/loop.js';
import * as diario from '../dist/diario.js';
import { pendenciasAprendizado } from '../dist/pendencias.js';
import { AQUI, novoTmp, g, gOk, CONFIG_PADRAO, planoDe, PLANO_PADRAO, ambiente, semEfeito, H, PLANO_REQ, PLANO_AJUSTE, IMPL_E, APROVA_E, INTEGRA_E, REPROVA_E, PROPOSTA, relogioDe, escreve, grava, bytesDoDiario, ambReq, comOrigin, diffEm, proporArgs, emendasDoDiario } from './_loop-cli-helpers.mjs';
// --- corpo movido ---
describe('T20: abrir idempotente, achados do revisor e spec', () => {
  const achadosDe = (amb, t, r) => join(amb.wt(t), '.tmp-gabarito', `review-r${r}.md`);
  /** abrir → impl → commit → concluir → revisor, parado antes do veredito. */
  const ateRevisor = (amb, t = 'T1') => {
    for (const a of [['abrir', t], ['iniciar', t, 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`);
    for (const a of [['concluir', t], ['iniciar', t, 'revisor']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
  };
  const reprovarR1 = (amb, t = 'T1') => {
    ateRevisor(amb, t);
    writeFileSync(achadosDe(amb, t, 1), '- MAJOR 1: falta teste de X (src/t1.txt:1)\n');
    const r = amb.cli(['veredito', t, 'REPROVADO', '1', '0', '1']);
    assert.equal(r.rc, 0, r.out + r.err);
    amb.fechar(); // REQ-APR-2 muda a ordem: o MAJOR do REPROVADO abre pendência antes da correção
  };

  test('abrir-duas-vezes-ok: o mesmo retorno com ja_aberta, sem tocar no trabalho', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.equal(a.j.ja_aberta, undefined, 'a 1ª abertura não é ja_aberta');
    amb.commitNaWt('T1', 'src/t1.txt');
    const antes = semEfeito(amb);
    const topoWt = g(amb.wt('T1'), 'rev-parse', 'HEAD');
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.equal(b.j.ok, true);
    assert.equal(b.j.ja_aberta, true);
    for (const k of ['task', 'branch', 'base', 'worktree', 'tmpdir', 'banco']) assert.deepEqual(b.j[k], a.j[k], k);
    assert.deepEqual(b.j.env, a.j.env);
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(g(amb.wt('T1'), 'rev-parse', 'HEAD'), topoWt);
    assert.ok(existsSync(join(b.j.worktree, '.tmp-gabarito', '.gitignore')), 'o .tmp-gabarito segue pronto');
    assert.ok(existsSync(b.j.tmpdir), 'o TMPDIR da task segue pronto');
  });

  test('abrir-duas-vezes-recria-o-tmpdir-que-sumiu', () => {
    const amb = ambiente();
    const a = amb.cli(['abrir', 'T1']);
    rmSync(a.j.tmpdir, { recursive: true });
    rmSync(join(a.j.worktree, '.tmp-gabarito'), { recursive: true });
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.ok(existsSync(a.j.tmpdir));
    assert.ok(existsSync(join(a.j.worktree, '.tmp-gabarito', '.gitignore')));
  });

  test('abrir-branch-sem-worktree-recusa: branch sem worktree, e pasta que o git não registra', () => {
    const amb = ambiente();
    g(amb.dir, 'branch', 'wt/GM-10-T1');
    let r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'branch_existe');
    // pasta comum no lugar da worktree, com o principal NA branch da task: `symbolic-ref` dentro dela devolveria a branch certa
    // (o git sobe até o principal), então só o registro de worktrees distingue.
    g(amb.dir, 'checkout', '-q', 'wt/GM-10-T1');
    g(amb.dir, 'config', 'branch.wt/GM-10-T1.gabaritoBase', 'enabler/GM-10-loop'); // só o registro de worktrees pode recusar
    mkdirSync(amb.wt('T1'), { recursive: true });
    writeFileSync(join(amb.wt('T1'), 'meu.txt'), 'importa');
    const antes = semEfeito(amb);
    r = amb.cli(['abrir', 'T1', '--entrega', 'GM-10']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'branch_existe');
    assert.deepEqual(semEfeito(amb), antes);
    assert.equal(readFileSync(join(amb.wt('T1'), 'meu.txt'), 'utf8'), 'importa');
  });

  test('abrir-outro-head-recusa: worktree registrada com HEAD solto ou em outra branch', () => {
    for (const mexer of [(w) => g(w, 'checkout', '-q', '--detach'), (w) => g(w, 'checkout', '-q', '-b', 'outra')]) {
      const amb = ambiente();
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      mexer(amb.wt('T1'));
      const antes = semEfeito(amb);
      const headAntes = g(amb.wt('T1'), 'rev-parse', '--abbrev-ref', 'HEAD');
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'branch_existe');
      assert.deepEqual(semEfeito(amb), antes);
      assert.equal(g(amb.wt('T1'), 'rev-parse', '--abbrev-ref', 'HEAD'), headAntes, 'nada foi tocado');
    }
  });

  test('veredito-reprovado-sem-achados-recusa: ok:false achados_ausentes e nada gravado', () => {
    const amb = ambiente();
    ateRevisor(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'achados_ausentes');
    assert.match(r.j.mensagem, /review-r1\.md/);
    assert.equal(amb.eventos().length, antes);
    assert.ok(!(amb.cli(['proxima']).j.acao.itens ?? []).some((i) => i.papel === 'correcao'), 'o estado segue em revisão: nenhum despacho de correção');
  });

  test('veredito-reprovado-achados-vazio-recusa: arquivo vazio ou só espaço, diretório e symlink', () => {
    const amb = ambiente();
    ateRevisor(amb);
    const antes = amb.eventos().length;
    const arq = achadosDe(amb, 'T1', 1);
    for (const prep of [
      () => writeFileSync(arq, ''),
      () => writeFileSync(arq, ' \n\t\n'),
      () => { rmSync(arq); mkdirSync(arq); },
      () => { rmSync(arq, { recursive: true }); writeFileSync(join(amb.dir, 'fora.md'), 'achado'); symlinkSync(join(amb.dir, 'fora.md'), arq); },
    ]) {
      prep();
      const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'achados_ausentes');
      assert.equal(amb.eventos().length, antes);
    }
  });

  test('veredito-reprovado-com-achados-grava', () => {
    const amb = ambiente();
    reprovarR1(amb);
    assert.deepEqual(amb.eventos().at(-1).dados, { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 });
  });

  test('veredito-aprovado-sem-arquivo-passa: APROVADO não exige achados', () => {
    const amb = ambiente();
    ateRevisor(amb);
    assert.ok(!existsSync(achadosDe(amb, 'T1', 1)));
    const r = amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.tipos().at(-1), 'review.veredito');
  });

  test('veredito-reprovado-sem-worktree-recusa: worktree_ausente, nada gravado', () => {
    const amb = ambiente();
    ateRevisor(amb);
    const antes = amb.eventos().length;
    g(amb.dir, 'worktree', 'remove', '--force', amb.wt('T1'));
    const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'worktree_ausente');
    assert.equal(amb.eventos().length, antes);
  });

  test('proxima-correcao-traz-achados: o caminho do arquivo da rodada, depois do /clear só com o CLI', () => {
    const amb = ambiente();
    reprovarR1(amb);
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    const item = p.j.acao.itens.find((i) => i.task === 'T1');
    assert.equal(item.papel, 'correcao');
    assert.equal(realpathSync(item.achados), realpathSync(achadosDe(amb, 'T1', 1)));
    assert.match(readFileSync(item.achados, 'utf8'), /MAJOR 1/);
    for (const i of p.j.acao.itens.filter((x) => x.papel !== 'correcao')) assert.equal(i.achados, undefined, 'só correção traz achados');
  });

  test('proxima-correcao-sem-arquivo-nao-finge: achados nulo e aviso', () => {
    const amb = ambiente();
    reprovarR1(amb);
    rmSync(achadosDe(amb, 'T1', 1));
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    assert.equal(p.j.acao.itens.find((i) => i.task === 'T1').achados, null);
    assert.ok((p.j.aviso ?? []).some((a) => /achados.*T1/.test(a)), JSON.stringify(p.j.aviso));
  });

  test('veredito-rodada-errada-diz-esperada: a mensagem traz a rodada que o diário espera', () => {
    const amb = ambiente();
    ateRevisor(amb);
    let r = amb.cli(['veredito', 'T1', 'APROVADO', '3', '0', '0']);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.match(r.j.mensagem, /rodada esperada: 1\b/);
    assert.match(r.j.mensagem, /fora de sequência/);
    // a causa mais fundamental vem primeiro: REPROVADO de rodada errada e sem achados diz a rodada, não os achados
    r = amb.cli(['veredito', 'T1', 'REPROVADO', '3', '0', '1']);
    assert.equal(r.j.erro, 'transicao_invalida');
    // depois de uma reprovação a esperada é a 2
    writeFileSync(achadosDe(amb, 'T1', 1), 'achado\n');
    assert.equal(amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']).rc, 0);
    for (const a of [['iniciar', 'T1', 'correcao']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt', 'v2\n');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor']]) assert.equal(amb.cli(a).rc, 0);
    r = amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.match(r.j.mensagem, /rodada esperada: 2\b/);
  });

  test('proxima-traz-spec: o ponteiro da spec vem do topo do plano, em todo item (caminho com espaço incluso)', () => {
    const amb = ambiente({
      plano: { ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T3', deps: [], arquivos: ['src/t3.txt'] }]), spec: 'docs/minha spec.md:10-20' },
    });
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    for (const i of p.j.acao.itens) assert.equal(i.spec, 'docs/minha spec.md:10-20', i.task);
  });

  test('proxima-sem-spec-no-plano: item sem spec', () => {
    const p = ambiente().cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    for (const i of p.j.acao.itens) assert.equal('spec' in i, false);
  });

  test('proxima-correcao-traz-spec-e-achados: a correção depois do /clear tem os dois', () => {
    const amb = ambiente({ plano: { ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]), spec: 'docs/spec.md:10-20' } });
    reprovarR1(amb);
    const item = amb.cli(['proxima', '--vivos', '0']).j.acao.itens[0];
    assert.equal(item.papel, 'correcao');
    assert.equal(item.spec, 'docs/spec.md:10-20');
    assert.ok(typeof item.achados === 'string' && existsSync(item.achados));
  });

  test('plano-spec-invalida-recusa: vazia, não texto, ou dentro de tasks[] (com motivo)', () => {
    const casos = [
      [{ ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]), spec: 7 }, /spec/],
      [{ ...planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]), spec: '' }, /spec/],
      [planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], spec: 'docs/spec.md' }]), /task T1.*spec/],
    ];
    for (const [plano, re] of casos) {
      const p = ambiente({ plano }).cli(['proxima']);
      assert.equal(p.rc, 1, p.out);
      assert.equal(p.j.erro, 'plano_invalido');
      assert.match(p.j.mensagem, re);
    }
  });

  test('abrir-duas-vezes-devolve-o-banco: o mesmo nome, sem clone novo (REQ-LOOP-3)', () => {
    const amb = ambiente();
    amb.comBanco();
    const a = amb.cli(['abrir', 'T1']);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.notEqual(a.j.banco, 'n/a');
    const b = amb.cli(['abrir', 'T1']);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.equal(b.j.ja_aberta, true);
    assert.equal(b.j.banco, a.j.banco);
  });

  describe('symlink em .tmp-gabarito (falha fecha, nada fora da worktree)', () => {
    const fora = (_amb, nome) => novoTmp(`loop-fora-${nome}-`);
    test('veredito-recusa-tmp-symlink-para-fora: nada gravado', () => {
      const amb = ambiente();
      ateRevisor(amb);
      const tmp = join(amb.wt('T1'), '.tmp-gabarito');
      const alvo = fora(amb, 'v');
      writeFileSync(join(alvo, 'review-r1.md'), '- MAJOR 1: x\n');
      rmSync(tmp, { recursive: true });
      symlinkSync(alvo, tmp);
      const antes = amb.eventos().length;
      const r = amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.ok, false);
      assert.equal(r.j.erro, 'achados_ausentes');
      assert.equal(amb.eventos().length, antes);
    });
    test('abrir-repetido-recusa-tmp-symlink-sem-escrever-fora', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const ach = join(a.j.worktree, '.tmp-gabarito');
      const alvo = fora(amb, 'a');
      rmSync(ach, { recursive: true });
      symlinkSync(alvo, ach);
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
      assert.deepEqual(readdirSync(alvo), [], 'nada escrito fora da worktree');
    });
    test('abrir-repetido-recusa-gitignore-symlink: o alvo do link não é tocado', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const ach = join(a.j.worktree, '.tmp-gabarito');
      const alvo = join(fora(amb, 'g'), 'alvo.txt');
      writeFileSync(alvo, 'intacto');
      rmSync(join(ach, '.gitignore'));
      symlinkSync(alvo, join(ach, '.gitignore'));
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
      assert.equal(readFileSync(alvo, 'utf8'), 'intacto');
    });
    test('abrir-repetido-recusa-tmp-arquivo-comum', () => {
      const amb = ambiente();
      const a = amb.cli(['abrir', 'T1']);
      const ach = join(a.j.worktree, '.tmp-gabarito');
      rmSync(ach, { recursive: true });
      writeFileSync(ach, 'x');
      const r = amb.cli(['abrir', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'tmpdir_invalido');
    });
    test('vizinhos-seguem-passando: diretório real e arquivo comum; symlink dentro da worktree recusa', () => {
      const amb = ambiente();
      reprovarR1(amb); // diretório real, arquivo comum: veredito passou (rc 0 no helper)
      const amb2 = ambiente();
      ateRevisor(amb2);
      const tmp = join(amb2.wt('T1'), '.tmp-gabarito');
      const dentro = join(amb2.wt('T1'), 'dentro');
      mkdirSync(dentro);
      writeFileSync(join(dentro, 'review-r1.md'), '- MAJOR 1: x\n');
      rmSync(tmp, { recursive: true });
      symlinkSync(dentro, tmp);
      const r = amb2.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'achados_ausentes');
    });
  });

  test('achados-seguem-em-tmp-gabarito: o veredito lê da worktree, o TMPDIR da task é outro', () => {
    const amb = ambiente();
    reprovarR1(amb);
    const arq = achadosDe(amb, 'T1', 1);
    assert.equal(arq, join(amb.wt('T1'), '.tmp-gabarito', 'review-r1.md'));
    assert.ok(existsSync(arq));
    const p = amb.cli(['proxima']);
    assert.match(JSON.stringify(p.j), /\.tmp-gabarito\/review-r1\.md/);
  });

  test('achados-ignorado-e-fechar-remove: o arquivo não suja o git e sai com a worktree', () => {
    const amb = ambiente();
    reprovarR1(amb);
    const arq = achadosDe(amb, 'T1', 1);
    assert.equal(g(amb.wt('T1'), 'status', '--short').trim(), '', 'ignorado pelo próprio .tmp-gabarito/.gitignore');
    assert.equal(g(amb.dir, 'status', '--short').trim(), '');
    const r = amb.cli(['fechar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(!existsSync(arq));
    assert.ok(!existsSync(amb.wt('T1')));
  });
});

// ═══════════════════════════════════════════════════════════════ GM-11 T10: proxima com Sombra e emendas, CLI de emenda, desvio, ci
// MUTAÇÕES PRESCRITAS: task-10-mut.json da entrega (.superpowers/sdd/2026-11-09-e3-sombra/).


describe('E3 T10: proxima, modelo, decisões, emendas e avisos', () => {
  test('parar-motivos-da-e3-aceitos: smoke, rollback e janela_ausente gravam loop.parar', () => {
    for (const motivo of ['smoke', 'rollback', 'janela_ausente']) {
      const amb = ambiente();
      const r = amb.cli(['parar', motivo]);
      assert.equal(r.rc, 0, `${motivo}: ${r.out}`);
      assert.deepEqual(amb.eventos().at(-1).dados, { motivo });
    }
  });

  test('proxima-item-traz-modelo: implementador e correção usam o implementador, revisor o revisor', () => {
    const amb = ambiente();
    const imp = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.ok(imp.length >= 1 && imp.every((i) => i.papel === 'implementador'));
    for (const i of imp) assert.deepEqual(i.modelo, { modelo: 'sonnet', esforco: 'high' });
    const rev = ambiente();
    rev.semear(IMPL_E('T1'));
    const ri = rev.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'revisor');
    assert.deepEqual(ri.modelo, { modelo: 'opus' });
    const cor = ambiente();
    cor.semear([...IMPL_E('T1'), REPROVA_E('T1')]);
    const ci = cor.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'correcao');
    assert.deepEqual(ci.modelo, { modelo: 'sonnet', esforco: 'high' });
  });

  test('proxima-modelo-config-vence-padrao e proxima-modelo-normaliza-id-completo', () => {
    const cfg = { ...CONFIG_PADRAO, orquestracao: { modelos: { implementador: { modelo: 'Claude-Haiku-5-5', esforco: 'low' }, revisor: 'claude-opus-5-5' } } };
    const amb = ambiente({ config: cfg });
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(p.j.acao.itens[0].modelo, { modelo: 'haiku', esforco: 'low' });
    assert.ok(!(p.j.aviso ?? []).some((a) => /modelo/i.test(a)), JSON.stringify(p.j.aviso));
    amb.semear(IMPL_E('T1'));
    const ri = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'revisor');
    assert.deepEqual(ri.modelo, { modelo: 'opus' });
  });

  test('proxima-modelo-desconhecido-padrao-com-aviso: família desconhecida, entrada torta e `modelos` que não é objeto', () => {
    const casos = [
      [{ revisor: 'gpt-4' }, /revisor/],
      [{ revisor: 42 }, /revisor/],
      [{ revisor: { esforco: 'low' } }, /revisor/],
      [['x'], /modelos/],
    ];
    for (const [modelos, aviso] of casos) {
      const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { modelos } } });
      amb.semear(IMPL_E('T1'));
      const p = amb.cli(['proxima', '--vivos', '0']);
      assert.deepEqual(p.j.acao.itens.find((i) => i.papel === 'revisor').modelo, { modelo: 'opus' }, JSON.stringify(modelos));
      assert.ok(p.j.aviso.some((a) => aviso.test(a) && /modelo/i.test(a)), `${JSON.stringify(modelos)} ⇒ ${JSON.stringify(p.j.aviso)}`);
    }
  });

  test('proxima-item-modelo-do-perfil: o perfil escolhe a família do item; o explícito vence; perfil inválido avisa e vale o padrão', () => {
    const itens = (orq) => {
      const amb = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: orq } });
      amb.semear([...IMPL_E('T1'), ...IMPL_E('T3')]);
      const p = amb.cli(['proxima', '--vivos', '0']);
      return { p, rev: p.j.acao.itens.find((i) => i.papel === 'revisor'), amb };
    };
    const e = itens({ perfil: 'economia' });
    assert.deepEqual(e.rev.modelo, { modelo: 'sonnet' });
    assert.ok(!(e.p.j.aviso ?? []).some((a) => /modelo/i.test(a)), JSON.stringify(e.p.j.aviso));
    assert.deepEqual(itens({ perfil: 'qualidade' }).rev.modelo, { modelo: 'opus' });
    const imp = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { perfil: 'economia' } } }).cli(['proxima', '--vivos', '0']).j.acao.itens[0];
    assert.deepEqual(imp.modelo, { modelo: 'sonnet', esforco: 'medium' });
    const q = ambiente({ config: { ...CONFIG_PADRAO, orquestracao: { perfil: 'qualidade' } } }).cli(['proxima', '--vivos', '0']).j.acao.itens[0];
    assert.deepEqual(q.modelo, { modelo: 'opus', esforco: 'high' });
    assert.deepEqual(itens({ perfil: 'economia', modelos: { revisor: 'haiku' } }).rev.modelo, { modelo: 'haiku' });
    const inv = itens({ perfil: 'luxo' });
    assert.deepEqual(inv.rev.modelo, { modelo: 'opus' });
    assert.ok(inv.p.j.aviso.some((a) => /modelo do papel revisor: orquestracao\.perfil inválido/.test(a)), JSON.stringify(inv.p.j.aviso));
    assert.equal(inv.p.j.acao.itens.filter((i) => i.papel === 'revisor').length, 2, 'dois itens do mesmo papel');
    assert.equal(inv.p.j.aviso.filter((a) => /modelo do papel revisor: .*perfil inválido/.test(a)).length, 1, 'o aviso não se repete por item do mesmo papel');
  });

  test('item-implementador-traz-decisoes-do-req, item-traz-decisao-ancora-task e item-decisao-arquivo-absoluto', () => {
    const amb = ambReq();
    const rel = relogioDe();
    const dec = (h, ancora, resp) => ['decisao.sombra', { pergunta_hash: h, ...ancora, resposta: resp, arquivo: `.harness/entregas/GM-10/sombra/${h}.x.resposta.md`, pergunta_enviesada: false, fontes: ['spec'] }];
    grava(amb, rel, [
      ['sombra.consulta', { pergunta_hash: H('1'), req: 'REQ-A-1' }], dec(H('1'), { req: 'REQ-A-1' }, 'resposta do req A'),
      ['sombra.consulta', { pergunta_hash: H('2'), task: 'T1' }], dec(H('2'), { task: 'T1' }, 'resposta da task T1'),
      ['sombra.consulta', { pergunta_hash: H('3'), req: 'REQ-B-1' }], dec(H('3'), { req: 'REQ-B-1' }, 'resposta do req B'),
      ['sombra.consulta', { pergunta_hash: H('4'), task: 'T2' }], dec(H('4'), { task: 'T2' }, 'resposta da task T2'),
    ]);
    const antesBytes = bytesDoDiario(amb);
    const itens = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.deepEqual(bytesDoDiario(amb), antesBytes, 'proxima não grava nada em nenhuma linha');
    const t1 = itens.find((i) => i.task === 'T1');
    const t2 = itens.find((i) => i.task === 'T2');
    assert.deepEqual(t1.decisoes.map((d) => [d.hash, d.ancora, d.resposta]), [[H('2'), 'task:T1', 'resposta da task T1'], [H('1'), 'REQ-A-1', 'resposta do req A']]);
    assert.deepEqual(t2.decisoes.map((d) => d.resposta), ['resposta da task T2', 'resposta do req B']);
    assert.equal(t1.decisoes[0].arquivo, join(amb.dir, '.harness', 'entregas', 'GM-10', 'sombra', `${H('2')}.x.resposta.md`));
    assert.ok(isAbsolute(t1.decisoes[1].arquivo));
  });

  test('item-decisao-fora-da-raiz-omitida: decisão com `arquivo` que resolve fora da raiz do repositório não vira caminho do item', () => {
    const amb = ambReq();
    const dec = (h, arquivo, resp) => ['decisao.sombra', { pergunta_hash: h, req: 'REQ-A-1', resposta: resp, arquivo, pergunta_enviesada: false, fontes: ['spec'] }];
    grava(amb, relogioDe(), [
      ['sombra.consulta', { pergunta_hash: H('1'), req: 'REQ-A-1' }], dec(H('1'), '../../x.resposta.md', 'fora por ..'),
      ['sombra.consulta', { pergunta_hash: H('2'), req: 'REQ-A-1' }], dec(H('2'), '.harness/entregas/GM-10/sombra/dentro.resposta.md', 'dentro'),
    ]);
    const t1 = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1');
    assert.deepEqual(t1.decisoes.map((d) => d.resposta), ['dentro'], JSON.stringify(t1.decisoes));
    for (const d of t1.decisoes) assert.ok(d.arquivo.startsWith(amb.dir), d.arquivo);
  });

  test('item-omite-decisao-anterior-a-emenda: só a consulta posterior à última emenda do REQ da âncora entra', () => {
    const amb = ambReq();
    const rel = relogioDe();
    const dec = (h, ancora, resp) => ['decisao.sombra', { pergunta_hash: h, ...ancora, resposta: resp, arquivo: `.harness/entregas/GM-10/sombra/${h}.x.resposta.md`, pergunta_enviesada: false, fontes: ['spec'] }];
    grava(amb, rel, [
      ['sombra.consulta', { pergunta_hash: H('1'), req: 'REQ-A-1' }], dec(H('1'), { req: 'REQ-A-1' }, 'velha do req A'),
      ['sombra.consulta', { pergunta_hash: H('2'), task: 'T1' }], dec(H('2'), { task: 'T1' }, 'velha da task T1'),
      ['sombra.consulta', { pergunta_hash: H('3'), req: 'REQ-B-1' }], dec(H('3'), { req: 'REQ-B-1' }, 'req B, outro REQ'),
      ['emendas', 'emenda.proposta', PROPOSTA()],
      ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }],
      ['sombra.consulta', { pergunta_hash: H('5'), req: 'REQ-A-1' }], dec(H('5'), { req: 'REQ-A-1' }, 'nova do req A'),
      ['sombra.consulta', { pergunta_hash: H('6'), task: 'T1' }], dec(H('6'), { task: 'T1' }, 'nova da task T1'),
    ]);
    const itens = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.deepEqual(itens.find((i) => i.task === 'T1').decisoes.map((d) => d.resposta), ['nova da task T1', 'nova do req A']);
    assert.deepEqual(itens.find((i) => i.task === 'T2').decisoes.map((d) => d.resposta), ['req B, outro REQ'], 'a emenda de REQ-A-1 não tira a decisão de REQ-B-1');
  });

  test('item-implementador-traz-emendas-aprovadas, item-correcao-traz-emendas-aprovadas e revisor-item-traz-emendas-aprovadas', () => {
    const base = [
      ['emendas', 'emenda.proposta', PROPOSTA({ diff: '+ A um' })],
      ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }],
      ['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1', diff: '+ B um' })],
      ['dono', 'spec.emendada', { proposta_seq: 2, origem: 'dono' }],
      ['emendas', 'emenda.proposta', PROPOSTA({ diff: '+ A dois' })],
      ['dono', 'spec.emendada', { proposta_seq: 3, origem: 'dono' }],
      ['emendas', 'emenda.proposta', PROPOSTA({ diff: '+ A rejeitada' })],
      ['dono', 'emenda.rejeitada', { proposta_seq: 4, origem: 'dono' }],
    ];
    const casos = [
      ['implementador', []],
      ['revisor', IMPL_E('T1')],
      ['correcao', [...IMPL_E('T1'), REPROVA_E('T1')]],
    ];
    for (const [papel, estado] of casos) {
      const amb = ambReq();
      const rel = relogioDe();
      grava(amb, rel, [...estado, ...base]);
      const item = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1');
      assert.equal(item.papel, papel);
      assert.deepEqual(item.emendas, [{ proposta_seq: 1, req: 'REQ-A-1', diff: '+ A um' }, { proposta_seq: 3, req: 'REQ-A-1', diff: '+ A dois' }], papel);
    }
  });

  test('proxima-sem-teto-de-consultas (GM-15 T36, emenda 22 l.5): 27 consultas à Sombra não avisam, `sombra.teto` de origin (válido, "30", 0, 1.5) é ignorado sem aviso; origin corrompida segue avisada pelo motivo', () => {
    const consultas = (n) => Array.from({ length: n }, (_, i) => ['sombra.consulta', { pergunta_hash: (i + 1).toString(16).padStart(64, '0'), req: 'REQ-A-1' }]);
    const sem = ambiente();
    grava(sem, relogioDe(), consultas(27));
    assert.ok(!(sem.cli(['proxima', '--vivos', '0']).j.aviso ?? []).some((a) => /Sombra|teto/.test(a)));
    for (const teto of [5, '30', 0, 1.5]) {
      const amb = ambiente();
      comOrigin(amb, { sombra: { teto } });
      grava(amb, relogioDe(), consultas(27));
      const j = amb.cli(['proxima', '--vivos', '0']).j;
      assert.ok(!(j.aviso ?? []).some((x) => /teto|consultas à Sombra/.test(x)), `${teto}: ${JSON.stringify(j.aviso)}`);
    }
    const ruim = ambiente();
    comOrigin(ruim, '{nao json');
    const j = ruim.cli(['proxima', '--vivos', '0']).j;
    assert.equal(j.ok, true);
    assert.ok(j.aviso.some((x) => /config de origin inv.lida: .*JSON ileg.vel/.test(x)), JSON.stringify(j.aviso));
    const ausente = ambiente().cli(['proxima', '--vivos', '0']).j;
    assert.ok(!(ausente.aviso ?? []).some((x) => /origin/.test(x)), 'sem origin não é erro');
  });

  test('proxima-origin-invalida-aviso: a política de entrega inválida de origin degrada e é avisada', () => {
    const amb = ambiente();
    comOrigin(amb, { entrega: { politica: 'sempre' } });
    const j = amb.cli(['proxima', '--vivos', '0']).j;
    assert.equal(j.ok, true);
    assert.ok(j.aviso.some((x) => /entrega\.politica/.test(x)), JSON.stringify(j.aviso));
  });

  test('proxima-politica-afrouxada-falha: plano continua com origin janela ⇒ ok:false politica_afrouxada, rc 1, sem ação', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: false, politica: 'continua' } };
    const amb = ambiente({ plano });
    comOrigin(amb, { entrega: { politica: 'janela', janela: { dias: [1], inicio: '09:00', fim: '10:00', fuso: 'UTC' } } });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'politica_afrouxada');
    assert.match(r.j.mensagem, /continua/);
    assert.equal(r.j.acao, undefined);
    assert.equal(amb.eventos().length, 0, 'nada gravado');
  });

  test('proxima-afrouxada-com-autonomia-confronta: origin janela COM autonomia, plano continua ⇒ politica_afrouxada pelo confronto (não pelo rebaixamento)', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: false, politica: 'continua' } };
    const amb = ambiente({ plano });
    comOrigin(amb, { entrega: { politica: 'janela', autonomia: true, janela: { dias: [1], inicio: '09:00', fim: '10:00', fuso: 'UTC' } } });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'politica_afrouxada');
    assert.match(r.j.mensagem, /"continua", mais frouxo que o config \("janela"\)/);
    assert.doesNotMatch(r.j.mensagem, /sem entrega\.autonomia/, 'sem rebaixamento a mensagem não cita autonomia');
  });

  test('proxima-autonomia-politica-efetiva-no-loop: origin continua SEM autonomia + exige_prod ⇒ parar{janela_ausente}; COM autonomia true ⇒ não para (costura loop ⇒ politicaEfetiva ⇒ proximaAcao 4b)', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: true } };
    for (const entrega of [{ politica: 'continua' }, { politica: 'continua', autonomia: false }]) {
      const sem = ambiente({ plano });
      comOrigin(sem, { entrega });
      const j = sem.cli(['proxima', '--vivos', '0']).j;
      assert.deepEqual(j.acao, { tipo: 'parar', motivo: 'janela_ausente' }, JSON.stringify(entrega));
    }
    const com = ambiente({ plano });
    comOrigin(com, { entrega: { politica: 'continua', autonomia: true } });
    const j = com.cli(['proxima', '--vivos', '0']).j;
    assert.equal(j.ok, true);
    assert.notDeepEqual(j.acao, { tipo: 'parar', motivo: 'janela_ausente' }, 'autonomia true mantém a continua declarada');
    assert.equal(j.acao.tipo, 'despachar', JSON.stringify(j.acao));
  });

  test('proxima-janela-ausente: exige_prod e política sob_demanda ⇒ parar{janela_ausente}; o motivo é gravável por `parar`', () => {
    const plano = { ...PLANO_PADRAO, politica_entrega: { exige_prod: true } };
    const amb = ambiente({ plano });
    const j = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual(j.acao, { tipo: 'parar', motivo: 'janela_ausente' });
    assert.equal(amb.cli(['parar', 'janela_ausente']).rc, 0);
    const abre = ambiente({ plano: { ...PLANO_PADRAO, politica_entrega: { exige_prod: true, politica: 'janela' } } });
    comOrigin(abre, { entrega: { politica: 'continua', autonomia: true } }); // o plano aperta continua → janela, mas não traz a janela
    const r = abre.cli(['proxima', '--vivos', '0']);
    assert.equal(r.j.erro, 'janela_ausente', 'janela pedida sem janela declarada recusa com a causa');
    assert.equal(r.rc, 1);
  });

  const AVISO_EMENDA = (j, re) => (j.aviso ?? []).filter((a) => re.test(a));

  test('proxima-aviso-emenda-em-integrada: emenda posterior à integração de task com o REQ avisa, citando a task e o seq', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]]);
    const j = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual(AVISO_EMENDA(j, /emendado/), ['Atenção: REQ-A-1 emendado (#1) depois de T1 integrada/aprovada: acrescente task de ajuste']);
  });

  test('t36-aviso-emenda-regra-unica-corrida (achado herdado da T34): Sombra rejeita, 2ª Sombra aprova, dono aprova ⇒ o julgamento que vale é o do dono e o aviso o enxerga (CLI real, fecharJulgamentos)', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()],
      ['sombra', 'emenda.rejeitada', { proposta_seq: 1, origem: 'sombra' }], ['sombra', 'spec.emendada', { proposta_seq: 1, origem: 'sombra' }], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/), ['Atenção: REQ-A-1 emendado (#1) depois de T1 integrada/aprovada: acrescente task de ajuste']);
  });

  test('proxima-aviso-emenda-apos-aprovacao: task só aprovada (não integrada) também avisa (P1b D6-4)', () => {
    const amb = ambiente({ plano: { entrega: 'GM-10', tasks: [PLANO_AJUSTE.tasks[0]] } });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]]);
    assert.equal(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /REQ-A-1 emendado \(#1\) depois de T1/).length, 1);
  });

  test('proxima-aviso-emenda-antes-da-integracao-calado: emenda anterior à integração não avisa', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }], APROVA_E('T1'), INTEGRA_E('T1')]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/), []);
  });

  test('proxima-aviso-emenda-aprovada-antes-integrada-depois: a referência é o último APROVADO; integrar depois da emenda sem revisão nova não cala', () => {
    const amb = ambiente({ plano: PLANO_REQ });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }], INTEGRA_E('T1')]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/), ['Atenção: REQ-A-1 emendado (#1) depois de T1 integrada/aprovada: acrescente task de ajuste']);
  });

  test('proxima-aviso-cala-so-com-ajuste-revisado: outra task integrada depois do julgamento mas aprovada antes dele não cala', () => {
    const amb = ambiente({ plano: PLANO_AJUSTE });
    grava(amb, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...IMPL_E('T5'), APROVA_E('T5'), ['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }], INTEGRA_E('T5')]);
    assert.deepEqual(AVISO_EMENDA(amb.cli(['proxima', '--vivos', '0']).j, /emendado/).map((a) => /depois de (T\d)/.exec(a)[1]), ['T1', 'T5']);
  });

  test('proxima-aviso-cala-com-task-de-ajuste: outra task com o REQ pendente, ou integrada depois do julgamento, cala; integrada antes avisa as duas', () => {
    const emenda = [['emendas', 'emenda.proposta', PROPOSTA()], ['dono', 'spec.emendada', { proposta_seq: 1, origem: 'dono' }]];
    const pendente = ambiente({ plano: PLANO_AJUSTE });
    grava(pendente, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...emenda]);
    assert.deepEqual(AVISO_EMENDA(pendente.cli(['proxima', '--vivos', '0']).j, /emendado/), [], 'T5 (mesmo REQ) ainda pendente: o ajuste está a caminho');
    const emCurso = ambiente({ plano: PLANO_AJUSTE });
    grava(emCurso, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...emenda, ...IMPL_E('T5')]);
    assert.deepEqual(AVISO_EMENDA(emCurso.cli(['proxima', '--vivos', '0']).j, /emendado/), [], 'T5 em curso também cala');
    const depois = ambiente({ plano: PLANO_AJUSTE });
    grava(depois, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...emenda, ...IMPL_E('T5'), APROVA_E('T5'), INTEGRA_E('T5')]);
    assert.deepEqual(AVISO_EMENDA(depois.cli(['proxima', '--vivos', '0']).j, /emendado/), [], 'T5 integrada depois do julgamento: ajuste feito');
    const antes = ambiente({ plano: PLANO_AJUSTE });
    grava(antes, relogioDe(), [...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ...IMPL_E('T5'), APROVA_E('T5'), INTEGRA_E('T5'), ...emenda]);
    assert.deepEqual(AVISO_EMENDA(antes.cli(['proxima', '--vivos', '0']).j, /emendado/).map((a) => /depois de (T\d)/.exec(a)[1]), ['T1', 'T5']);
  });
});

describe('E3 T10: emenda propor, emenda julgar, desvio, descoberta e ci', () => {
  test('propor-grava-na-sessao-emendas e devolve {proposta_seq, req, task?, congeladas}', () => {
    const amb = ambReq();
    const r = amb.cli(proporArgs(amb, { task: 'T1' }));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.proposta_seq, 1);
    assert.equal(r.j.req, 'REQ-A-1');
    assert.equal(r.j.task, 'T1');
    assert.deepEqual([...r.j.congeladas].sort(), ['T1', 'T3'], 'T1 pelo REQ e T3 por depender dela; T2 fica de fora');
    const e = emendasDoDiario(amb);
    assert.equal(e.length, 1);
    assert.equal(e[0].tipo, 'emenda.proposta');
    assert.deepEqual(e[0].dados, { req: 'REQ-A-1', task: 'T1', diff: '--- a\n+++ b\n+ regra\n', fato: 'fato', alternativa: 'alt', evidencia: 'evid', causa: 'regra_negocio' });
    assert.equal(amb.eventos().filter((x) => x.sessao !== 'emendas').length, 0);
    const sem = ambReq();
    assert.equal(sem.cli(proporArgs(sem)).j.task, undefined, 'sem --task, sem `task` na saída');
    assert.ok(!('task' in emendasDoDiario(sem)[0].dados));
  });

  test('propor-igual-duas-vezes: cada chamada devolve o seq da própria linha, mesmo com dados idênticos', () => {
    const amb = ambReq();
    const args = proporArgs(amb);
    assert.equal(amb.cli(args).j.proposta_seq, 1);
    assert.equal(amb.cli(args).j.proposta_seq, 2);
    assert.deepEqual(emendasDoDiario(amb).map((e) => e.seq), [1, 2]);
  });

  test('propor-ignora-flag-sessao: --sessao x grava em events.emendas.jsonl (SP D1)', () => {
    const amb = ambReq();
    const r = amb.cli([...proporArgs(amb), '--sessao', 'x']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(existsSync(join(amb.entregas, 'events.emendas.jsonl')));
    assert.ok(!existsSync(join(amb.entregas, 'events.x.jsonl')));
    assert.equal(emendasDoDiario(amb)[0].sessao, 'emendas');
  });

  test('propor-devolve-seq-do-arquivo: com proposta concorrente injetada antes do append, o seq é o da linha gravada', async () => {
    const { proporEmenda } = await import('../scripts/loop.mjs');
    const amb = ambReq();
    const flags = { req: 'REQ-A-1', diff: diffEm(amb), fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio' };
    const injeta = () => escreve(amb, 'emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1', diff: 'outra' }), '2026-03-01T00:00:00.000Z');
    const r = proporEmenda(amb.dir, flags, { antes: injeta });
    const doArquivo = emendasDoDiario(amb).find((e) => e.dados.diff === '--- a\n+++ b\n+ regra\n');
    assert.equal(doArquivo.seq, 2, 'a injetada tomou o seq 1');
    assert.equal(r.proposta_seq, doArquivo.seq);
  });

  test('propor-recusa-de-uso: flag obrigatória ausente, desconhecida ou repetida ⇒ rc 2 sem gravar', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const falta of ['req', 'diff', 'fato', 'alternativa', 'evidencia', 'causa']) {
      const r = amb.cli(proporArgs(amb, { [falta]: undefined }));
      assert.equal(r.rc, 2, `${falta}: ${r.out}`);
      assert.equal(r.j.erro, 'uso');
    }
    assert.equal(amb.cli([...proporArgs(amb), '--nada', 'x']).rc, 2);
    assert.equal(amb.cli([...proporArgs(amb), '--fato', 'outra']).rc, 2);
    assert.equal(amb.cli(['emenda']).rc, 2);
    assert.equal(amb.cli(['emenda', 'propor', 'sobra', ...proporArgs(amb).slice(2)]).rc, 2);
    assert.equal(amb.cli(['emenda', 'revogar', '1']).rc, 2);
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('propor-argumento-invalido: req, task e causa fora da forma ⇒ rc 1 sem gravar; diff vazio também', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const extra of [{ req: 'req-a-1' }, { req: 'REQ-A-1x' }, { task: '../T1' }, { causa: 'preguica' }]) {
      const r = amb.cli(proporArgs(amb, extra));
      assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify(extra));
      assert.equal(r.rc, 1);
    }
    const vazio = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, ' \n\t\n', 'vazio.diff') }));
    assert.equal(vazio.j.erro, 'argumento_invalido');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('propor-diff-ausente-x-ilegivel: arquivo inexistente e diretório são erros distintos', () => {
    const amb = ambReq();
    const ausente = amb.cli(proporArgs(amb, {}, { diff: join(amb.tmpSistema, 'nao-existe.diff') }));
    assert.equal(ausente.j.erro, 'diff_ausente');
    const dir = join(amb.tmpSistema, 'um-dir');
    mkdirSync(dir);
    const ilegivel = amb.cli(proporArgs(amb, {}, { diff: dir }));
    assert.equal(ilegivel.j.erro, 'diff_ilegivel');
    assert.equal(ausente.rc, 1);
    assert.equal(emendasDoDiario(amb).length, 0);
  });

  test('propor-diff-longo-recusa-antes-do-diario: 4.001 caracteres ⇒ diff_longo, 0 bytes em todo events.*; 4.000 passa', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, 'x'.repeat(4001), 'longo.diff') }));
    assert.equal(r.j.erro, 'diff_longo');
    assert.equal(r.rc, 1);
    assert.deepEqual(bytesDoDiario(amb), antes, '0 bytes em todo events.*.jsonl');
    assert.ok(!amb.tipos().includes('diario.recusa'));
    const ok = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, 'x'.repeat(4000), 'limite.diff') }));
    assert.equal(ok.rc, 0, ok.out);
  });

  test('propor-texto-longo-nada-gravado: fato, alternativa ou evidencia > 2.000 e arquivos > 50 ⇒ proposta_longa, sem diario.recusa', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const campo of ['fato', 'alternativa', 'evidencia']) {
      const r = amb.cli(proporArgs(amb, { [campo]: 'y'.repeat(2001) }));
      assert.equal(r.j.erro, 'proposta_longa', campo);
    }
    const muitos = Array.from({ length: 51 }, (_, i) => `src/f${i}.txt`).join(',');
    const r = amb.cli(proporArgs(amb, { task: 'T1', arquivos: muitos }));
    assert.equal(r.j.erro, 'proposta_longa');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.ok(!amb.tipos().includes('diario.recusa'));
    const limite = amb.cli(proporArgs(amb, { fato: 'y'.repeat(2000) }));
    assert.equal(limite.rc, 0, limite.out);
  });

  test('propor-segredo-nada-gravado: canário em qualquer campo de texto ⇒ segredo_na_proposta, 0 bytes, e a mensagem não ecoa o segredo', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    const segredo = `ghp_${'a1'.repeat(18)}`;
    const alvos = [{ fato: segredo }, { alternativa: segredo }, { evidencia: segredo }];
    for (const extra of alvos) {
      const r = amb.cli(proporArgs(amb, extra));
      assert.equal(r.j.erro, 'segredo_na_proposta', JSON.stringify(Object.keys(extra)));
      assert.ok(!r.out.includes(segredo), 'o segredo não é ecoado');
    }
    const noDiff = amb.cli(proporArgs(amb, {}, { diff: diffEm(amb, `+ token ${segredo}\n`, 'seg.diff') }));
    assert.equal(noDiff.j.erro, 'segredo_na_proposta');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.ok(!amb.tipos().includes('diario.recusa'));
  });

  test('propor-arquivos-item-vazio-recusa e propor-arquivos-sem-task: o vazio não some em silêncio', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    for (const lista of ['a,,b', 'a,', ',a']) {
      const r = amb.cli(proporArgs(amb, { task: 'T1', arquivos: lista }));
      assert.equal(r.j.erro, 'caminho_invalido', lista);
      assert.match(r.j.mensagem, /caminho inv.lido/);
    }
    const semTask = amb.cli(proporArgs(amb, { arquivos: 'src/x.txt' }));
    assert.equal(semTask.j.ok, false);
    assert.match(semTask.j.mensagem, /arquivos exigem task/);
    const fora = amb.cli(proporArgs(amb, { task: 'T1', arquivos: '../fora.txt' }));
    assert.match(fora.j.mensagem, /caminho inv.lido: \.\.\/fora\.txt/);
    assert.deepEqual(bytesDoDiario(amb), antes);
    const ok = amb.cli(proporArgs(amb, { task: 'T1', arquivos: './src/x.txt,src/y.txt' }));
    assert.equal(ok.rc, 0, ok.out);
    assert.deepEqual(emendasDoDiario(amb)[0].dados.arquivos, ['./src/x.txt', 'src/y.txt']);
  });

  test('propor-colide-sem-dep-recusa: arquivo de outra task sem dependência ⇒ recusa com a task e nada gravado', () => {
    const amb = ambReq();
    const r = amb.cli(proporArgs(amb, { task: 'T1', arquivos: 'src/t2.txt' }));
    assert.equal(r.rc, 1);
    assert.equal(r.j.ok, false);
    assert.match(r.j.mensagem, /arquivo src\/t2\.txt colide com T2 sem dependência/);
    assert.equal(emendasDoDiario(amb).length, 0);
    const dep = amb.cli(proporArgs(amb, { task: 'T3', req: 'REQ-C-1', arquivos: 'src/t1.txt' }));
    assert.equal(dep.rc, 0, 'T3 depende de T1: o arquivo dela não colide');
  });

  test('propor-req-desconhecido-recusa: sem --task, REQ fora de toda task e da spec; REQ na spec ou em task vale', () => {
    const amb = ambReq();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(proporArgs(amb, { req: 'REQ-ZZ-9' }));
    assert.equal(r.j.erro, 'req_desconhecido');
    assert.equal(r.rc, 1);
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.cli(proporArgs(amb, { req: 'REQ-A-1' })).rc, 0, 'REQ de task');
    writeFileSync(join(amb.dir, 'docs', 'spec.md'), '# Spec\n\n**REQ-A-1** a.\n\n**REQ-ZZ-9** só na spec.\n');
    assert.equal(amb.cli(proporArgs(amb, { req: 'REQ-ZZ-9' })).rc, 0, 'REQ só na spec');
    const semSpec = ambiente({ plano: { ...PLANO_REQ, spec: undefined } });
    assert.equal(semSpec.cli(proporArgs(semSpec, { req: 'REQ-ZZ-9' })).j.erro, 'req_desconhecido', 'sem spec não há como provar o REQ');
  });

  test('propor-plano-e-diario-ruins: plano ausente, diário ilegível e diário fora da tabela ⇒ recusa sem gravar', () => {
    const semPlano = ambiente({ plano: null });
    assert.equal(semPlano.cli(proporArgs(semPlano)).j.erro, 'plano_ausente');
    const amb = ambReq();
    writeFileSync(join(amb.entregas, 'events.loop.jsonl'), 'lixo\n');
    assert.equal(amb.cli(proporArgs(amb)).j.erro, 'diario_ilegivel');
    const torto = ambReq();
    torto.semear([['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }]]);
    assert.equal(torto.cli(proporArgs(torto)).j.erro, 'diario_invalido');
    assert.equal(emendasDoDiario(torto).length, 0);
  });

  const comJulga = (amb) => comOrigin(amb, { sombra: { julga_emendas: true } });
  const propor = (amb, extra) => assert.equal(amb.cli(proporArgs(amb, extra)).rc, 0);

  test('julgar-sombra-sem-flag-recusa: sem origin e com origin sem a chave, nada gravado', () => {
    const amb = ambReq();
    propor(amb);
    const antes = bytesDoDiario(amb);
    for (const preparar of [() => {}, () => comOrigin(amb, { sombra: { teto: 9 } }), () => comOrigin(amb, { sombra: { julga_emendas: 'true' } })]) {
      preparar();
      const r = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'julga_emendas_desligado');
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
  });

  test('julgar-sombra-flag-so-local-recusa: julga_emendas true só no config local não vale', () => {
    const amb = ambReq({ config: { ...CONFIG_PADRAO, sombra: { julga_emendas: true } } });
    propor(amb);
    comOrigin(amb, { entrega: {} });
    const antes = bytesDoDiario(amb);
    const r = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
    assert.equal(r.j.erro, 'julga_emendas_desligado');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('julgar-origin-invalida-recusa: JSON ilegível em origin ⇒ recusa citando o motivo', () => {
    const amb = ambReq();
    propor(amb);
    comOrigin(amb, '{quebrado');
    const r = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
    assert.equal(r.j.erro, 'julga_emendas_desligado');
    assert.match(r.j.mensagem, /JSON ileg.vel/);
  });

  test('julgar-sombra-com-flag-origin: grava spec.emendada origem sombra, relida; rejeitar grava emenda.rejeitada; a 2ª vez ⇒ proposta já julgada', () => {
    const amb = ambReq();
    comJulga(amb);
    propor(amb);
    propor(amb, { req: 'REQ-B-1' });
    const a = amb.cli(['emenda', 'julgar', '1', 'aprovar']);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.deepEqual([a.j.seq, a.j.req, a.j.tipo, a.j.origem], [1, 'REQ-A-1', 'spec.emendada', 'sombra']);
    const julg = amb.eventos().filter((e) => e.tipo === 'spec.emendada');
    assert.deepEqual(julg.map((e) => [e.sessao, e.dados]), [['loop', { proposta_seq: 1, origem: 'sombra' }]]);
    const rj = amb.cli(['emenda', 'julgar', '2', 'rejeitar', '--sessao', 'sombra-j']);
    assert.equal(rj.rc, 0, rj.out);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'emenda.rejeitada').map((e) => [e.sessao, e.dados]), [['sombra-j', { proposta_seq: 2, origem: 'sombra' }]]);
    const dois = amb.cli(['emenda', 'julgar', '1', 'rejeitar']);
    assert.equal(dois.j.erro, 'ja_julgada');
    assert.match(dois.j.mensagem, /proposta já julgada/);
    assert.equal(amb.eventos().filter((e) => e.tipo === 'emenda.rejeitada').length, 1);
    const ne = amb.cli(['emenda', 'julgar', '9', 'aprovar']);
    assert.equal(ne.j.erro, 'proposta_inexistente');
    assert.equal(amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1').emendas[0].proposta_seq, 1, 'costura: o julgamento descongela e chega ao item');
  });

  test('julgar-sombra-nao-reverte-a-propria-rejeicao (GM-15 T34, D-G15): só o dono reverte; a Sombra julgando de novo (aprovar ou rejeitar) ⇒ ja_julgada, nada gravado', () => {
    const amb = ambReq();
    comOrigin(amb, { sombra: { julga_emendas: true } });
    grava(amb, relogioDe(), [['emendas', 'emenda.proposta', PROPOSTA({ origem: 'sombra', req: 'REQ-B-1' })]]);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'rejeitar', '--sessao', 'sombra-j']).rc, 0);
    const antes = bytesDoDiario(amb);
    for (const d of ['aprovar', 'rejeitar']) {
      const r = amb.cli(['emenda', 'julgar', '1', d, '--sessao', 'sombra-j']);
      assert.notEqual(r.rc, 0, d);
      assert.equal(r.j.erro, 'ja_julgada', d);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('julgar-seq-forma-invalida: 0, 03, -1, 3.0 e decisão fora do enum ⇒ argumento_invalido sem gravar', () => {
    const amb = ambReq();
    comJulga(amb);
    propor(amb);
    const antes = bytesDoDiario(amb);
    for (const args of [['0', 'aprovar'], ['03', 'aprovar'], ['-1', 'aprovar'], ['3.0', 'aprovar'], ['1234567890', 'aprovar'], ['1', 'Aprovar'], ['1', 'ok']]) {
      const r = amb.cli(['emenda', 'julgar', ...args]);
      assert.equal(r.j?.erro, 'argumento_invalido', args.join(' '));
    }
    assert.equal(amb.cli(['emenda', 'julgar', '1']).rc, 2);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar', '--origem', 'dono']).rc, 2, 'nenhum argumento produz origem dono');
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar', '--req', 'REQ-A-1']).rc, 2, 'flags de propor não valem em julgar');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('desvio-grava: task, req, evidencia, arquivos normalizados e causa no diário (sessão loop, ou --sessao)', () => {
    const amb = ambReq();
    const r = amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'a API não pagina', '--arquivos', './src/t1.txt,src/x.txt', '--causa', 'tecnica']);
    assert.equal(r.rc, 0, r.out + r.err);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'desvio');
    assert.equal(e.sessao, 'loop');
    assert.deepEqual(e.dados, { task: 'T1', req: 'REQ-A-1', evidencia: 'a API não pagina', arquivos: ['src/t1.txt', 'src/x.txt'], causa: 'tecnica' });
    const s = amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'x', '--arquivos', '', '--causa', 'regra_negocio', '--sessao', 'outra']);
    assert.equal(s.rc, 0, s.out);
    assert.deepEqual(amb.eventos().at(-1).dados.arquivos, [], 'lista vazia explícita vale');
    assert.equal(amb.eventos().at(-1).sessao, 'outra');
  });

  test('desvio-sem-evidencia-recusa: flag ausente é uso (rc 2); evidência vazia, causa e arquivos inválidos são recusa sem gravar', () => {
    const amb = ambReq();
    const base = ['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'ev', '--arquivos', 'src/t1.txt', '--causa', 'tecnica'];
    const sem = (flag) => { const i = base.indexOf(`--${flag}`); return [...base.slice(0, i), ...base.slice(i + 2)]; };
    for (const f of ['req', 'evidencia', 'arquivos', 'causa']) assert.equal(amb.cli(sem(f)).rc, 2, f);
    const troca = (flag, v) => { const i = base.indexOf(`--${flag}`); return [...base.slice(0, i + 1), v, ...base.slice(i + 2)]; };
    assert.equal(amb.cli(troca('evidencia', '  ')).j.erro, 'argumento_invalido');
    assert.equal(amb.cli(troca('causa', 'preguica')).j.erro, 'argumento_invalido');
    assert.equal(amb.cli(troca('arquivos', '/abs/x')).j.erro, 'caminho_invalido');
    assert.equal(amb.cli(troca('arquivos', 'a,,b')).j.erro, 'caminho_invalido');
    assert.equal(amb.cli(troca('evidencia', 'y'.repeat(2001))).j.erro, 'proposta_longa');
    assert.equal(amb.cli(troca('evidencia', `ghp_${'a1'.repeat(18)}`)).j.erro, 'segredo_na_proposta');
    assert.equal(amb.eventos().length, 0);
  });

  test('desvio-task-fora-do-plano e desvio-req-fora-da-task: task sem o REQ (ou sem `reqs`) recusa', () => {
    const amb = ambReq();
    const base = (t, req) => ['desvio', t, '--req', req, '--evidencia', 'ev', '--arquivos', '', '--causa', 'tecnica'];
    assert.equal(amb.cli(base('T9', 'REQ-A-1')).j.erro, 'task_fora_do_plano');
    assert.equal(amb.cli(base('T1', 'REQ-B-1')).j.erro, 'req_fora_da_task');
    const sem = ambiente();
    assert.equal(sem.cli(base('T1', 'REQ-A-1')).j.erro, 'req_fora_da_task', 'task sem `reqs`');
    assert.equal(amb.eventos().length + sem.eventos().length, 0);
  });

  test('descoberta-grava e descoberta-recusa: evidencia e causa; canário e limite como em propor', () => {
    const amb = ambReq();
    const r = amb.cli(['descoberta', '--evidencia', 'tabela sem índice', '--causa', 'tecnica']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(amb.eventos().at(-1), { ...amb.eventos().at(-1), tipo: 'descoberta', dados: { evidencia: 'tabela sem índice', causa: 'tecnica' } });
    assert.equal(amb.cli(['descoberta', '--evidencia', 'x']).rc, 2);
    assert.equal(amb.cli(['descoberta', '--evidencia', 'x', '--causa', 'nada']).j.erro, 'argumento_invalido');
    assert.equal(amb.cli(['descoberta', '--evidencia', 'z'.repeat(2001), '--causa', 'tecnica']).j.erro, 'proposta_longa');
    assert.equal(amb.cli(['descoberta', '--evidencia', `ghp_${'a1'.repeat(18)}`, '--causa', 'tecnica']).j.erro, 'segredo_na_proposta');
    assert.equal(amb.eventos().length, 1);
  });

  test('ci-alvo-homolog: --alvo homolog grava {verde, alvo}; sem a flag, só {verde}', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['ci', 'verde', '--alvo', 'homolog']).rc, 0);
    assert.deepEqual(amb.eventos().at(-1).dados, { verde: true, alvo: 'homolog' });
    assert.equal(amb.cli(['ci', 'vermelho']).rc, 0);
    assert.deepEqual(amb.eventos().at(-1).dados, { verde: false });
  });

  test('ci-alvo-fora-recusa: prod, Homolog e vazio ⇒ argumento_invalido sem gravar', () => {
    const amb = ambiente();
    for (const alvo of ['prod', 'Homolog', 'homolog ', '']) {
      const r = amb.cli(['ci', 'vermelho', '--alvo', alvo]);
      assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify(alvo));
      assert.equal(r.rc, 1);
    }
    assert.equal(amb.eventos().length, 0);
  });
});

describe('GM-15 T11: a 3ª proposta é da Sombra (REQ-EME-3 B)', () => {
  const comJulga = (amb) => comOrigin(amb, { sombra: { julga_emendas: true } });
  /** 2 propostas do orquestrador na mesma âncora, as duas rejeitadas pela Sombra. */
  function comDuasRejeitadas(extra = {}) {
    const amb = ambReq();
    comJulga(amb);
    for (const seq of ['1', '2']) {
      assert.equal(amb.cli(proporArgs(amb, extra)).rc, 0);
      assert.equal(amb.cli(['emenda', 'julgar', seq, 'rejeitar']).rc, 0);
    }
    return amb;
  }

  test('t11-terceira-proposta-do-orquestrador-recusa: nada gravado; outra âncora segue livre', () => {
    const amb = comDuasRejeitadas();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(proporArgs(amb));
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'proposta_recusada');
    assert.match(r.j.mensagem, /terceira proposta do orquestrador/);
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.cli(proporArgs(amb, { req: 'REQ-B-1' })).rc, 0, 'outro REQ é outra âncora');
  });

  test('segunda-rejeicao-sombra-redige: --origem sombra grava a proposta com origem sombra e o texto que a Sombra redigiu', () => {
    const amb = comDuasRejeitadas();
    const r = amb.cli([...proporArgs(amb, { fato: 'fato da Sombra', alternativa: 'alt da Sombra' }), '--origem', 'sombra']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.proposta_seq, 3);
    const e = emendasDoDiario(amb).filter((x) => x.tipo === 'emenda.proposta');
    assert.equal(e.length, 3);
    assert.deepEqual([e[2].dados.origem, e[2].dados.fato, e[2].dados.alternativa], ['sombra', 'fato da Sombra', 'alt da Sombra']);
    assert.equal(e[0].dados.origem, undefined, 'a do orquestrador não leva origem');
  });

  test('t11-origem-sombra-antes-da-2a-rejeicao-recusa', () => {
    const amb = ambReq();
    comJulga(amb);
    assert.equal(amb.cli(proporArgs(amb)).rc, 0);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'rejeitar']).rc, 0);
    const antes = bytesDoDiario(amb);
    const r = amb.cli([...proporArgs(amb), '--origem', 'sombra']);
    assert.equal(r.j.erro, 'proposta_recusada');
    assert.match(r.j.mensagem, /2ª rejeição/);
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('t11-origem-sombra-exige-julga-emendas-em-origin', () => {
    const amb = comDuasRejeitadas();
    comOrigin(amb, { sombra: { julga_emendas: false } });
    const antes = bytesDoDiario(amb);
    const r = amb.cli([...proporArgs(amb), '--origem', 'sombra']);
    assert.equal(r.j.erro, 'julga_emendas_desligado');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('t11-origem-dono-ou-outra-recusa-rc2: nenhum argumento produz dono', () => {
    const amb = comDuasRejeitadas();
    const antes = bytesDoDiario(amb);
    for (const v of ['dono', 'retomada', '']) {
      const r = amb.cli([...proporArgs(amb), '--origem', v]);
      assert.equal(r.rc, 2, `${v}: ${r.out}`);
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
  });
});

describe('E3 T10: integrar com o escopo das emendas', () => {
  const PLANO_INT = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'] }] };

  test('integrar-escopo-com-emenda-aprovada-passa-gate: o gate real aceita o arquivo da emenda e reprova sem ela', () => {
    const semEmenda = ambiente({ plano: PLANO_INT });
    semEmenda.aprovar('T1', 'src/t1.txt', [['src/extra.txt', 'extra\n']]);
    const rep = semEmenda.cli(['integrar', 'T1']);
    assert.equal(rep.j.erro, 'gate_reprovado', rep.out);
    assert.deepEqual(rep.j.merge, false);

    const amb = ambiente({ plano: PLANO_INT });
    comOrigin(amb, { sombra: { julga_emendas: true } });
    amb.aprovar('T1', 'src/t1.txt', [['src/extra.txt', 'extra\n']]);
    const p = amb.cli(proporArgs(amb, { task: 'T1', arquivos: 'src/extra.txt' }));
    assert.equal(p.rc, 0, p.out);
    const aberta = amb.cli(['integrar', 'T1']);
    assert.equal(aberta.j.erro, 'nao_integravel', 'proposta aberta congela a integração');
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar']).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.ok(existsSync(join(amb.dir, 'src/extra.txt')));
  });

  test('integrar-escopo-da-emenda-rejeitada-ou-de-outra-task-nao-vale', () => {
    const amb = ambiente({ plano: { entrega: 'GM-10', tasks: [...PLANO_INT.tasks, { id: 'T2', deps: [], arquivos: ['src/t2.txt'], reqs: ['REQ-B-1'] }] } });
    comOrigin(amb, { sombra: { julga_emendas: true } });
    amb.aprovar('T1', 'src/t1.txt', [['src/extra.txt', 'extra\n']]);
    assert.equal(amb.cli(proporArgs(amb, { task: 'T2', req: 'REQ-B-1', arquivos: 'src/extra.txt' })).rc, 0);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar']).rc, 0);
    assert.equal(amb.cli(['integrar', 'T1']).j.erro, 'gate_reprovado', 'a emenda de T2 não alarga o escopo de T1');
  });

  test('integrar-sem-emenda-files-igual-e2: `./arquivo` e diretório do plano seguem valendo como na E2', () => {
    const plano = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['./src/t1.txt', 'src/dir'] }] };
    const amb = ambiente({ plano });
    amb.aprovar('T1', 'src/t1.txt', [['src/dir/fundo/a.txt', 'a\n']]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const fora = ambiente({ plano });
    fora.aprovar('T1', 'src/t1.txt', [['src/dirfora.txt', 'a\n']]);
    assert.equal(fora.cli(['integrar', 'T1']).j.erro, 'gate_reprovado', 'diretório não aprova arquivo de nome parecido');
  });
});

// ═══════════════════════════════════════════════════════════════ GM-11 T16: integrar relata desvios no verde
describe('E3 T16: integrar repassa desvio e aviso do gate no verde', () => {
  const FORMA = /^(desvio|aviso): /;
  const desviar = (amb, extra = []) => amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'e', '--arquivos', 'a.ts', '--causa', 'tecnica', ...extra]);

  test('integrar-verde-relata-desvio: desvio gravado pelo CLI real, gate real verde, integrar devolve a linha', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    const d = desviar(amb);
    assert.equal(d.rc, 0, d.out + d.err);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.evento, true);
    assert.equal(r.j.fechada, true);
    assert.deepEqual(r.j.relato, ['desvio: REQ-A-1 a.ts (tecnica)']);
    for (const l of r.j.relato) assert.match(l, FORMA);
  });

  test('integrar-verde-sem-desvio-relato-vazio: o campo existe e vale []; nada de ok/veredito vaza', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.ok(Array.isArray(r.j.relato), 'relato sempre presente');
    assert.equal(r.j.relato.length, 0);
    assert.doesNotMatch(r.out, /ok {5}|GATE VERDE/, 'linhas ok e veredito não vazam na saída');
  });

  test('integrar-verde-so-linhas-desvio-e-aviso: desvio de outra task não entra; a ordem original vale', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    assert.equal(desviar(amb).rc, 0);
    assert.equal(amb.cli(['desvio', 'T1', '--req', 'REQ-A-1', '--evidencia', 'e2', '--arquivos', 'b.ts', '--causa', 'regra_negocio']).rc, 0);
    assert.equal(amb.cli(['desvio', 'T2', '--req', 'REQ-B-1', '--evidencia', 'e', '--arquivos', 'z.ts', '--causa', 'tecnica']).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.relato, ['desvio: REQ-A-1 a.ts (tecnica)', 'desvio: REQ-A-1 b.ts (regra_negocio)']);
  });

  test('integrar-verde-repassa-aviso-de-diario-nao-lido: lacuna de seq que o integrar tolera, o gate avisa', () => {
    const amb = ambReq();
    amb.aprovar('T1');
    writeFileSync(join(amb.entregas, 'events.outra.jsonl'), JSON.stringify({ seq: 7, hash_anterior: null, ts: '2026-01-01T00:00:00.000Z', autor: 't@t', sessao: 'outra', agente: 'x', tipo: 'nota', dados: {} }) + '\n');
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.merge, true);
    assert.equal(r.j.relato.length, 1);
    assert.match(r.j.relato[0], /^aviso: desvios não lidos \(lacuna de seq na linha 1 de events\.outra\.jsonl\)$/);
  });

  test('integrar-reprovado-mantem-relato-completo-e-rc: ramo gate_reprovado inalterado', () => {
    const amb = ambReq({ config: { gates: { suites: ['test ! -f src/t1.txt'] } } });
    amb.aprovar('T1');
    assert.equal(desviar(amb).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(r.j.merge, false);
    assert.ok(r.j.relato.some((l) => /^FALHA /.test(l)), 'FALHA continua no relato');
    assert.ok(r.j.relato.some((l) => /^ok {5}/.test(l)), 'o relato completo (com ok) segue na reprovação');
    assert.ok(r.j.relato.includes('desvio: REQ-A-1 a.ts (tecnica)'));
  });
});

describe('E4 T7: dados do painel no loop (iniciar, integrar, proxima)', () => {
  const comConfig = (orq) => ambiente({ config: { ...CONFIG_PADRAO, orquestracao: orq } });
  const iniciada = (amb) => amb.eventos().filter((e) => e.tipo === 'task.iniciada').at(-1);
  const integradaDe = (amb) => amb.eventos().find((e) => e.tipo === 'task.integrada');

  test('iniciar-forma-posicional-mantida: `--papel` do plano antigo é uso rc 2, nada gravado', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', '--papel', 'implementador']);
    assert.equal(r.rc, 2);
    assert.equal(r.j.erro, 'uso');
    assert.equal(amb.eventos().length, 0);
  });

  test('iniciar-grava-modelo-padrao: sem `orquestracao`, o modelo é o padrão do papel e a saída traz o mesmo valor', () => {
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet');
    assert.equal(r.j.evento.modelo, 'sonnet');
    assert.equal(r.j.aviso, undefined, 'config válida sem `orquestracao` não avisa');
    amb.cli(['concluir', 'T1']);
    const v = amb.cli(['iniciar', 'T1', 'revisor']);
    assert.equal(v.rc, 0, v.out + v.err);
    assert.equal(iniciada(amb).dados.modelo, 'opus');
    assert.equal(v.j.evento.modelo, 'opus');
  });

  test('iniciar-grava-modelo-do-perfil: task.iniciada e a saída trazem a família do perfil (costura config real -> evento)', () => {
    const amb = comConfig({ perfil: 'economia' });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet');
    amb.cli(['concluir', 'T1']);
    const v = amb.cli(['iniciar', 'T1', 'revisor']);
    assert.equal(v.rc, 0, v.out + v.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet', 'economia: revisor de task em sonnet');
    assert.equal(v.j.evento.modelo, 'sonnet');
  });

  test('iniciar-correcao-usa-chave-implementador e iniciar-revisor-usa-chave-revisor: a família vem da chave do papel', () => {
    const amb = comConfig({ modelos: { implementador: 'opus', revisor: 'haiku' } });
    amb.semear([...IMPL_E('T1'), ['task.iniciada', { task: 'T1', papel: 'revisor' }], REPROVA_E('T1')]);
    amb.cli(['abrir', 'T1']);
    const c = amb.cli(['iniciar', 'T1', 'correcao']);
    assert.equal(c.rc, 0, c.out + c.err);
    assert.equal(iniciada(amb).dados.modelo, 'opus', 'correcao usa a chave implementador');
    assert.equal(c.j.evento.modelo, 'opus');
    amb.semear([['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }]]);
    const v = amb.cli(['iniciar', 'T1', 'revisor']);
    assert.equal(v.rc, 0, v.out + v.err);
    assert.equal(iniciada(amb).dados.modelo, 'haiku', 'revisor usa a chave revisor, nunca a do implementador');
    assert.equal(v.j.evento.modelo, 'haiku');
  });

  test('iniciar-config-objeto-e-id-completo: `{modelo}` e id completo viram a família', () => {
    const amb = comConfig({ modelos: { implementador: { modelo: 'claude-opus-5-5', esforco: 'low' } } });
    amb.cli(['abrir', 'T1']);
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'opus');
    assert.equal(r.j.aviso, undefined);
  });

  test('iniciar-chave-invalida-padrao-com-aviso: o que o item levou ao Agent é o padrão', () => {
    for (const valor of [42, 'gpt', {}]) {
      const amb = comConfig({ modelos: { implementador: valor } });
      amb.cli(['abrir', 'T1']);
      const r = amb.cli(['iniciar', 'T1', 'implementador']);
      assert.equal(r.rc, 0, r.out + r.err);
      assert.equal(iniciada(amb).dados.modelo, 'sonnet', JSON.stringify(valor));
      assert.equal(r.j.aviso.length, 1);
      assert.match(r.j.aviso[0], /modelo do papel implementador/);
    }
  });

  test('iniciar-config-corrompida-sem-modelo-com-aviso: ausente e corrompido são casos distintos, cada um com o seu lado', () => {
    // corrompida (JSON quebrado e raiz que não é objeto): evento sem a chave `modelo`, aviso, rc 0
    for (const texto of ['{', '[1]', 'null']) {
      const amb = ambiente();
      amb.cli(['abrir', 'T1']);
      writeFileSync(join(amb.dir, 'harness.config.json'), texto);
      const r = amb.cli(['iniciar', 'T1', 'implementador']);
      assert.equal(r.rc, 0, `${texto}: ${r.out}`);
      assert.equal(Object.hasOwn(iniciada(amb).dados, 'modelo'), false, `${texto}: nenhum modelo é inventado`);
      assert.deepEqual(iniciada(amb).dados, { task: 'T1', papel: 'implementador' });
      assert.equal(Object.hasOwn(r.j.evento, 'modelo'), false);
      assert.equal(r.j.aviso.length, 1);
      assert.match(r.j.aviso[0], /^config_invalida: .*; task\.iniciada sem modelo$/);
    }
    // ausente: o padrão, com o aviso de ausência
    const amb = ambiente();
    amb.cli(['abrir', 'T1']);
    rmSync(join(amb.dir, 'harness.config.json'));
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(iniciada(amb).dados.modelo, 'sonnet');
    assert.deepEqual(r.j.aviso, ['harness.config.json ausente']);
  });

  test('iniciar-recusa-antes-da-config: com a config corrompida o motivo da recusa não muda', () => {
    const corrompe = (amb) => writeFileSync(join(amb.dir, 'harness.config.json'), '{');
    const a = ambiente();
    corrompe(a);
    assert.equal(a.cli(['iniciar', 'T9', 'implementador']).j.erro, 'task_fora_do_plano');
    const b = ambiente();
    corrompe(b);
    assert.equal(b.cli(['iniciar', 'T1', 'implementador']).j.erro, 'worktree_ausente');
    const c = ambiente();
    c.cli(['abrir', 'T1']);
    assert.equal(c.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    corrompe(c);
    const t = c.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(t.j.erro, 'transicao_invalida');
    assert.equal(c.eventos().length, 1, 'a recusa não grava nada');
  });

  const GATE_MUT = [
    { nome: 'lenta', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'sleep 0.4; test "$(cat src/t1.txt)" = x' },
    { nome: 'rapida', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'if grep -q x src/t1.txt; then sleep 0.4; fi; grep -q x src/t1.txt' }, // sem mutação leva 0,4 s; mutada morre na hora (limiar relativo ao MESMO comando)
  ];
  const ambMut = (lista) => {
    const amb = ambiente({
      config: { gates: { suites: ["echo '# pass 1'"] } },
      plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], ...(lista === undefined ? {} : { mutacoes: 'mut.json' }) }]),
    });
    if (lista !== undefined) writeFileSync(join(amb.dir, 'mut.json'), JSON.stringify(lista));
    amb.aprovar('T1');
    return amb;
  };

  test('integrar-mutacoes-na-saida: gate real, uma morta devagar e uma em tempo ~zero (ALERTA, não conta) ⇒ {2,1} no diário e na saída', () => {
    const amb = ambMut(GATE_MUT);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.mutacoes, { total: 2, mortas: 1 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 2, mortas: 1 });
    assert.equal(integradaDe(amb).dados.sha, amb.topo());
  });

  test('integrar-mutacoes-todas-mortas: total e mortas lidos (2 e 2)', () => {
    const amb = ambMut([GATE_MUT[0], { ...GATE_MUT[0], nome: 'lenta2' }]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.mutacoes, { total: 2, mortas: 2 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 2, mortas: 2 });
  });

  test('integrar-sem-mutacoes-zero: sem `mutacoes` no plano o gate mediu zero, valor presente e não ausente', () => {
    const amb = ambMut(undefined);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.mutacoes, { total: 0, mortas: 0 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 0, mortas: 0 });
  });

  test('integrar-mutacao-viva-reprova-sem-evento: nenhum task.integrada, base inalterada', () => {
    const amb = ambMut([{ nome: 'viva', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'true' }]);
    const base = amb.topo();
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.j.erro, 'gate_reprovado');
    assert.equal(integradaDe(amb), undefined);
    assert.equal(amb.topo(), base);
  });

  test('integrar-forma-mutacoes-antes-do-merge: mortas > total ⇒ gate_erro, sem merge nem evento, base inalterada', async () => {
    const amb = ambMut(undefined);
    const base = amb.topo();
    const avaliarTorto = async () => ({ reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 3, semContagem: 0 });
    const r = await integrarComGate(amb.dir, 'T1', { avaliar: avaliarTorto });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'gate_erro');
    assert.match(r.mensagem, /mutacoes.*mortas ≤ total/);
    assert.equal(r.merge, false);
    assert.equal(r.evento, false);
    assert.equal(amb.topo(), base, 'o merge não aconteceu');
    assert.equal(integradaDe(amb), undefined);
    assert.ok(existsSync(amb.wt('T1')), 'a worktree continua');
  });

  test('integrar-com-avaliador-injetado-bom: o mesmo caminho com mortas == total grava e mescla (o teste acima não passa por outro motivo)', async () => {
    const amb = ambMut(undefined);
    const ok = async () => ({ reprova: 0, alertas: 0, relato: [], suites: 1, testes: 1, mutacoes: 0, semContagem: 0 });
    const r = await integrarComGate(amb.dir, 'T1', { avaliar: ok });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.mutacoes, { total: 0, mortas: 0 });
    assert.deepEqual(integradaDe(amb).dados.mutacoes, { total: 0, mortas: 0 });
  });

  test('proxima-descricao-casa-com-casarAgente (P9): os três papéis, pelo CLI real e o `dist/painel-equipe.js`', () => {
    const amb = ambiente();
    const plano = JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8'));
    const impl = amb.cli(['proxima', '--vivos', '0']).j.acao.itens;
    assert.ok(impl.length >= 1);
    for (const i of impl) {
      assert.equal(i.descricao, `${i.task} implementador`);
      assert.deepEqual(casarAgente(i.descricao, plano), { task: i.task, papel: 'implementador' });
    }
    const rev = ambiente();
    rev.semear(IMPL_E('T1'));
    const ri = rev.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'revisor');
    assert.equal(ri.descricao, 'T1 revisor');
    assert.deepEqual(casarAgente(ri.descricao, plano), { task: 'T1', papel: 'revisor' });
    const cor = ambiente();
    cor.semear([...IMPL_E('T1'), REPROVA_E('T1')]);
    const ci = cor.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.papel === 'correcao');
    assert.equal(ci.descricao, 'T1 correcao');
    assert.deepEqual(casarAgente(ci.descricao, plano), { task: 'T1', papel: 'correcao' });
  });

  test('subcomandos-e5-sem-stub: pousar (T12, REQ-POU-3) já não responde nao_implementado; grava só sessao.pouso e não cria registro.md (registro é da T11)', () => {
    const amb = ambiente();
    const antes = amb.tipos();
    const r = amb.cli(['pousar']);
    assert.notEqual(r.j?.erro, 'nao_implementado', `${r.out}${r.err}`);
    assert.equal(r.rc, 0, `${r.out}${r.err}`);
    assert.deepEqual(amb.tipos(), [...antes, 'sessao.pouso']);
    assert.equal(existsSync(join(amb.entregas, 'registro.md')), false);
  });
});

// ─────────────────────────────────────────────────────────────── E5a T8: aprendizados no despacho (REQ-APR-3)

describe('E5a T8: proxima leva os aprendizados D do papel no item despachar', () => {
  const EV1 = ['descoberta', { evidencia: 'fato medido', causa: 'tecnica' }];
  const D = (regra, entra_em, extra = {}) => ['aprendizado', { tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra, entra_em, ...extra }];
  const M = (regra, entra_em) => ['aprendizado', { tipo: 'E', status: 'M', gatilho: null, evidencia: {}, regra, entra_em }];
  const itemDe = (r, task, papel) => r.j.acao.itens.find((i) => i.task === task && i.papel === papel);

  test('proxima-item-revisor-sem-implementador: o revisor leva só `brief:revisor`; o implementador, só `brief:implementador`', () => {
    const amb = ambiente();
    amb.semear([EV1, D('so-implementador', ['brief:implementador']), D('so-revisor', ['brief:revisor']), D('os-dois', ['brief:implementador', 'brief:revisor'])]);
    const impl = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(impl.rc, 0, impl.out + impl.err);
    assert.deepEqual(itemDe(impl, 'T1', 'implementador').aprendizados, ['os-dois', 'so-implementador'], 'mais recente primeiro; nada de brief:revisor');
    assert.deepEqual(itemDe(impl, 'T3', 'implementador').aprendizados, ['os-dois', 'so-implementador']);
    const rev = ambiente();
    rev.semear([...IMPL_E('T1'), ['descoberta', { evidencia: 'e', causa: 'tecnica' }], D('so-implementador', ['brief:implementador'], { evidencia: { eventos: [{ sessao: 'loop', seq: 3 }] } }),
      D('so-revisor', ['brief:revisor'], { evidencia: { eventos: [{ sessao: 'loop', seq: 3 }] } })]);
    const r = rev.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(itemDe(r, 'T1', 'revisor').aprendizados, ['so-revisor']);
  });

  test('item-correcao-so-brief-correcao: `brief:revisor` e `brief:implementador` não entram na correção; `brief:correcao` entra', () => {
    const amb = ambiente();
    amb.semear([...IMPL_E('T1'), REPROVA_E('T1'), ['descoberta', { evidencia: 'e', causa: 'tecnica' }],
      D('do-revisor', ['brief:revisor'], { evidencia: { eventos: [{ sessao: 'loop', seq: 4 }] } }),
      D('do-implementador', ['brief:implementador'], { evidencia: { eventos: [{ sessao: 'loop', seq: 4 }] } }),
      D('da-correcao', ['brief:correcao'], { evidencia: { eventos: [{ sessao: 'loop', seq: 4 }] } })]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    const cor = itemDe(r, 'T1', 'correcao');
    assert.ok(cor, 'há item de correção');
    assert.deepEqual(cor.aprendizados, ['da-correcao']);
  });

  test('proxima-m-nunca-no-item: M com brief:implementador não aparece (M-APR3a)', () => {
    const amb = ambiente();
    amb.semear([EV1, M('so-hipotese', ['brief:implementador', 'instantaneo']), D('medida', ['brief:implementador'])]);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['medida']);
    assert.equal(JSON.stringify(r.j).includes('so-hipotese'), false, 'M não vaza em nenhum campo');
  });

  test('proxima-aprendizados-de-outra-entrega-entram: o D da GM-3 chega ao brief da GM-10 (a árvore inteira)', () => {
    const amb = ambiente();
    const d3 = join(amb.dir, '.harness', 'entregas', 'GM-3');
    mkdirSync(d3, { recursive: true });
    for (const [tipo, dados] of [EV1, D('regra da GM-3', ['brief:implementador'])]) {
      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 5)).toISOString();
      assert.ok(diario.append(d3, 'loop', { ts, autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados }).ok);
    }
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['regra da GM-3']);
    assert.equal(r.j.aviso, undefined);
  });

  test('proxima-outra-entrega-corrompida-aviso: rc 0, os D das legíveis seguem e o aviso cita a pasta (nunca "0" calado nem rc 1)', () => {
    const amb = ambiente();
    amb.semear([EV1, D('da-gm-10', ['brief:implementador'])]);
    const torta = join(amb.dir, '.harness', 'entregas', 'GM-1');
    mkdirSync(torta, { recursive: true });
    writeFileSync(join(torta, 'events.loop.jsonl'), 'isto nao e json\n');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['da-gm-10']);
    assert.equal(r.j.aviso.filter((a) => /GM-1 ilegível/.test(a)).length, 1, 'um aviso só, não um por item');
  });

  test('proxima-diario-da-entrega-ilegivel-para-antes: o item nunca sai com aprendizados vazios por causa do diário torto', () => {
    const amb = ambiente();
    writeFileSync(join(amb.entregas, 'events.loop.jsonl'), 'isto nao e json\n');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'diario_ilegivel', r.out);
  });

  test('proxima-sem-aprendizado-no-diario-ausente: árvore sem a pasta das outras entregas ⇒ `aprendizados: []` e nenhum aviso', () => {
    const amb = ambiente();
    const r = amb.cli(['proxima', '--vivos', '0']);
    for (const i of r.j.acao.itens) assert.deepEqual(i.aprendizados, []);
    assert.equal(r.j.aviso, undefined);
  });

  test('aprendizado-cli-chega-no-brief (P9, costura pelo adaptador real): `aprendizado` grava e o `proxima` do mesmo CLI entrega a regra ao implementador', () => {
    const amb = ambiente();
    amb.semear([EV1]);
    const g1 = amb.cli(['aprendizado', 'E', 'D', '--regra', 'rode o gate antes de concluir', '--entra-em', 'brief:implementador,brief:revisor', '--eventos', 'loop:1']);
    assert.equal(g1.rc, 0, g1.out + g1.err);
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(itemDe(r, 'T1', 'implementador').aprendizados, ['rode o gate antes de concluir']);
    const l = amb.cli(['aprendizados', '--para', 'brief:revisor']);
    assert.deepEqual(l.j.aprendizados.map((a) => a.regra), ['rode o gate antes de concluir']);
  });

  test('nada-fecha-e-proxima-segue: com a mensagem do dono a pendência abre na projeção e o `proxima` segue despachando (GM-14 FIEL-2 b); `aprendizado nada` fecha a pendência', () => {
    const amb = ambiente();
    assert.ok(diario.append(amb.entregas, 'dono', { ts: '2026-01-01T00:00:01.000Z', autor: 't@t', sessao: 'dono', agente: 'orquestrador', tipo: 'dono.mensagem', dados: { sha256: 'b'.repeat(64), chars: 4 } }).ok);
    const antes = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(antes.j.acao.tipo, 'despachar', antes.out);
    const abertas = () => pendenciasAprendizado(JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8')), diario.ler(amb.entregas));
    assert.deepEqual(abertas(), [{ sessao: 'dono', seq: 1, tipo: 'dono' }]);
    const nada = amb.cli(['aprendizado', 'nada', '--gatilho', 'dono:1', '--motivo', 'mensagem sem regra a tirar']);
    assert.equal(nada.rc, 0, nada.out + nada.err);
    const depois = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(depois.j.acao.tipo, 'despachar', depois.out);
    assert.deepEqual(abertas(), []);
  });
});

// ─────────────────────────────────────────────────────────────── GM-14 T1: fiação dos subcomandos novos (stubs)

describe('GM-14: subcomandos novos ainda sem implementação', () => {
  const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
  const ONBOARDING = join(AQUI, '..', 'scripts', 'onboarding.mjs');
  /** Fotografia do que o subcomando poderia gravar: toda a árvore fora de `.git` (caminho, tamanho e sha256) e o `git status`. */
  const foto = (dir) => {
    const lista = [];
    const andar = (d) => {
      for (const n of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, n.name);
        if (n.name === '.git') continue;
        if (n.isDirectory()) { lista.push(`${p}/`); andar(p); } else lista.push(`${p} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
      }
    };
    andar(dir);
    return { arvore: lista.sort(), status: g(dir, 'status', '--porcelain', '--untracked-files=all') };
  };
  const rodarNode = (amb, script, args) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout, err: r.stderr };
  };

  test('subcomandos-gm14-stub-nao-implementado: onboarding herdar|foco ⇒ rc 1, erro nao_implementado, nada gravado', () => {
    const amb = ambiente();
    const casos = [
      // `painel.mjs medir` saiu daqui na T11: tem teste próprio em painel-medir.test.mjs.
      ['onboarding.mjs herdar', () => rodarNode(amb, ONBOARDING, ['herdar', '--root', amb.dir])],
      ['onboarding.mjs herdar --gravar', () => rodarNode(amb, ONBOARDING, ['herdar', '--root', amb.dir, '--gravar'])],
    ];
    for (const [nome, rodar] of casos) {
      const antes = foto(amb.dir);
      const r = rodar();
      assert.equal(r.rc, 1, `${nome}: ${r.out}${r.err}`);
      assert.ok(r.j !== null, `${nome}: saída não é 1 linha JSON: ${r.out}`);
      assert.equal(r.j.ok, false, nome);
      assert.equal(r.j.erro, 'nao_implementado', `${nome}: ${r.out}`);
      assert.deepEqual(foto(amb.dir), antes, `${nome}: gravou algo`);
    }
    assert.equal(amb.eventos().length, 0);
  });

  test('subcomandos-gm14-vizinhos: subcomando desconhecido segue uso (rc 2) nos três CLIs', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['anota']).rc, 2);
    assert.equal(amb.cli(['anotar']).rc, 2, 'anotar sem --tipo/--texto é uso');
    assert.equal(rodarNode(amb, PAINEL, ['medi']).rc, 2);
    assert.equal(rodarNode(amb, ONBOARDING, ['herda']).rc, 2);
  });
});

// ─────────────────────────────────────────────── GM-14 T31 (Emenda 2, FIEL-8 b, c): reentrega com motivo pela borda
// P1 da Sombra (.superpowers/sdd/2026-11-11-proxima/t31-sombra-p1.md): cada transição e cada ataque com teste nomeado. Mutações: task-31-mut.json.
describe('reentrega (concluir --motivo)', () => {
  const BASE = 'enabler/GM-10-loop';
  const MOTIVOS_R = ['gate', 'sombra', 'dono'];
  /** Bytes de todo o diário da entrega: recusa = nada gravado, byte a byte. */
  const fotoDiario = (amb) => readdirSync(amb.entregas).filter((f) => f.endsWith('.jsonl')).sort().map((f) => `${f}\n${readFileSync(join(amb.entregas, f), 'utf8')}`).join('\n');
  const estadoT = (amb, t) => {
    const ord = ordenarNucleo(amb.eventos());
    assert.ok(ord.ok);
    return estadoNucleo(ord.eventos.filter((e) => ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'].includes(e.tipo) && e.dados?.task === t));
  };
  const vereditos = (amb) => amb.eventos().filter((e) => e.tipo === 'review.veredito').length;
  /** Evento de outra sessão com `ts` escolhido: o relógio de outra máquina (ou de antes do /clear) no diário. */
  const doFuturo = (amb, sessao, lista) => {
    lista.forEach(([tipo, dados], i) => {
      const ts = new Date(Date.UTC(2099, 0, 1, 0, 0, i + 1)).toISOString();
      const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
      assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
    });
  };
  const recusa = (amb, args, erro, msg) => {
    const antes = fotoDiario(amb);
    const r = amb.cli(args);
    assert.equal(r.rc, 1, `${args.join(' ')} ${r.out}${r.err}`);
    assert.equal(r.j?.ok, false);
    assert.equal(r.j.erro, erro, r.out);
    if (msg) assert.match(r.j.mensagem, msg);
    assert.equal(fotoDiario(amb), antes, `${args.join(' ')}: nada gravado`);
    return r;
  };

  test('reentrega-aprovada-grava-motivo-e-volta-a-concluida (b2, b7, P15): lê tipo, task, sha, motivo e rodada; 0 veredito novo', () => {
    for (const m of MOTIVOS_R) {
      const amb = ambiente();
      amb.aprovar('T1');
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 });
      const nVer = vereditos(amb);
      amb.commitNaWt('T1', 'src/t1.txt', 'y\n', 'fix(GM-10): depois do gate');
      const sha = amb.topo('wt/GM-10-T1');
      const r = amb.cli(['concluir', 'T1', '--motivo', m]);
      assert.equal(r.rc, 0, r.out + r.err);
      const e = amb.eventos().at(-1);
      assert.equal(e.tipo, 'task.concluida');
      assert.deepEqual(e.dados, { task: 'T1', sha, motivo: m });
      assert.equal(e.dados.motivo, m);
      assert.equal(e.dados.sha, sha);
      assert.equal(e.dados.task, 'T1');
      assert.deepEqual(r.j.evento, { tipo: 'task.concluida', task: 'T1', sha, motivo: m });
      assert.equal(vereditos(amb), nVer, 'a reentrega não grava review.veredito');
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'concluida', rodada: 0 }, 'rodada − 1: o APROVADO anulado não conta');
    }
  });

  test('reentrega-concluida-mantem-rodada (b1, b7): não gasta rodada nem grava veredito; o veredito seguinte é a rodada 1', () => {
    for (const m of MOTIVOS_R) {
      const amb = ambiente();
      for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
      amb.commitNaWt('T1', 'src/t1.txt');
      assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
      amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
      const r = amb.cli(['concluir', 'T1', '--motivo', m]);
      assert.equal(r.rc, 0, r.out);
      assert.equal(vereditos(amb), 0);
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'concluida', rodada: 0 });
      assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
      assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    }
  });

  test('reentrega-motivo-invalido-recusa-antes-de-ler (b6, ataque 3): rc 1 argumento_invalido, nada lido nem gravado; sem valor é uso', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    for (const m of ['x', 'GATE', '', ' gate', 'dono ']) recusa(amb, ['concluir', 'T1', '--motivo', m], 'argumento_invalido', /--motivo/);
    const semPlano = ambiente({ plano: null });
    const r = semPlano.cli(['concluir', 'T1', '--motivo', 'x']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'argumento_invalido', 'forma antes do plano e do diário');
    const u = amb.cli(['concluir', 'T1', '--motivo']);
    assert.equal(u.rc, 2);
    assert.equal(u.j.erro, 'uso');
    assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 });
  });

  test('reentrega-mesmo-sha-recusa (b5, ataque 4): aprovada e concluida + R com o sha do último task.concluida => sha_igual', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    for (const m of MOTIVOS_R) recusa(amb, ['concluir', 'T1', '--motivo', m], 'sha_igual', /sha/);
    assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 }, 'segue aprovada, rodada intacta');
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', 'gate']).rc, 0);
    recusa(amb, ['concluir', 'T1', '--motivo', 'sombra'], 'sha_igual');
    assert.deepEqual(estadoT(amb, 'T1'), { estado: 'concluida', rodada: 0 });
  });

  test('concluir-sem-motivo-mesmo-sha-recusa (4.i): correção sem commit novo não tem o que revisar', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    writeFileSync(join(amb.wt('T1'), '.tmp-gabarito', 'review-r1.md'), '- MAJOR 1: x\n');
    assert.equal(amb.cli(['veredito', 'T1', 'REPROVADO', '1', '0', '1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'correcao']).rc, 0);
    recusa(amb, ['concluir', 'T1'], 'sha_igual');
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
  });

  test('concluir-sem-motivo-em-concluida-e-aprovada-cita-motivo (b4, ataque 13)', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    recusa(amb, ['concluir', 'T1'], 'transicao_invalida', /--motivo <gate\|sombra\|dono>/);
    const apr = ambiente();
    apr.aprovar('T1');
    apr.commitNaWt('T1', 'src/t1.txt', 'y\n');
    recusa(apr, ['concluir', 'T1'], 'transicao_invalida', /--motivo <gate\|sombra\|dono>/);
  });

  // b3 (ataque 12): um teste por estado, nos 3 motivos; sha sempre novo, para só a tabela decidir.
  const VELHO = 'b'.repeat(40);
  const PREFIXOS = {
    pendente: [],
    implementando: [['task.iniciada', { task: 'T1', papel: 'implementador' }]],
    em_revisao: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['task.iniciada', { task: 'T1', papel: 'revisor' }]],
    reprovada: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }]],
    corrigindo: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }]],
    no_teto: [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }], ['task.concluida', { task: 'T1', sha: 'c'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }]],
  };
  const DICAS = { em_revisao: /espere o veredito/, reprovada: /caminho é a correção/, no_teto: /só o dono tira/ };
  for (const [estado, prefixo] of Object.entries(PREFIXOS)) {
    test(`reentrega-em-${estado}-recusa (b3): transicao_invalida, nada gravado, estado igual`, () => {
      const amb = ambiente();
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      if (prefixo.length > 0) amb.semear(prefixo);
      amb.commitNaWt('T1', 'src/t1.txt', 'novo\n');
      const antes = estadoT(amb, 'T1');
      assert.equal(antes.estado, estado);
      for (const m of MOTIVOS_R) recusa(amb, ['concluir', 'T1', '--motivo', m], 'transicao_invalida', DICAS[estado] ?? /concluida\.reentrega em /);
      assert.deepEqual(estadoT(amb, 'T1'), antes, estado === 'no_teto' ? 'a reentrega não tira do teto' : 'estado igual');
    });
  }

  test('reentrega-em-integrada-recusa (ataque 2): worktree fechada => worktree_ausente, nada gravado, nunca reabre', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    for (const m of MOTIVOS_R) recusa(amb, ['concluir', 'T1', '--motivo', m], 'worktree_ausente');
    assert.equal(estadoT(amb, 'T1').estado, 'integrada');
  });

  test('reentrega-costura-integrar (c, P9, ataque 5): aprovada => R => integrar recusa sem APROVADO novo; revisor + APROVADO da rodada anulada => integra o sha da R', () => {
    const amb = ambiente();
    amb.aprovar('T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'reentregue\n');
    const shaR = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', 'gate']).rc, 0);
    const antes = semEfeito(amb);
    const n = amb.cli(['integrar', 'T1']);
    assert.equal(n.rc, 1, n.out);
    assert.equal(n.j.erro, 'nao_integravel');
    assert.deepEqual(semEfeito(amb), antes, 'sem merge nem evento');
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.j.acao.tipo, 'despachar', p.out);
    assert.deepEqual(p.j.acao.itens.map((i) => [i.task, i.papel]).filter(([t]) => t === 'T1'), [['T1', 'revisor']], 'a R não pula review');
    recusa(amb, ['veredito', 'T1', 'APROVADO', '2', '0', '0'], 'transicao_invalida', /rodada esperada: 1/);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    recusa(amb, ['veredito', 'T1', 'APROVADO', '2', '0', '0'], 'transicao_invalida', /rodada esperada: 1/);
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
    assert.equal(amb.eventos().at(-1).dados.sha, shaR);
    assert.equal(readFileSync(join(amb.dir, 'src/t1.txt'), 'utf8'), 'reentregue\n', 'o commit da reentrega entrou');
  });

  test('reentrega-revisor-ve-diff-inteiro (b8, ataque 14): diff <base>...<sha da R> e reentrega; sem R, diff sem reentrega; sem base, diff null e aviso', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const shaP = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    const semR = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(semR.diff, `${BASE}...${shaP}`);
    assert.ok(!Object.hasOwn(semR, 'reentrega'), JSON.stringify(semR));
    amb.commitNaWt('T1', 'src/t1.txt', 'y\n');
    const shaR = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', 'sombra']).rc, 0);
    const comR = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(comR.diff, `${BASE}...${shaR}`, 'diff inteiro desde a base, nunca <sha anterior>..<sha novo>');
    assert.ok(!comR.diff.includes(shaP));
    assert.equal(comR.reentrega, 'sombra');
    const solto = ambiente();
    solto.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: VELHO }]]);
    const p = solto.cli(['proxima', '--vivos', '0']);
    const it = p.j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(it.diff, null, 'sem base gravada não inventa diff');
    assert.ok((p.j.aviso ?? []).some((a) => /T1/.test(a) && /gabaritoBase/.test(a)), JSON.stringify(p.j.aviso));
  });

  // ── Emenda 12 (anexos C a5, FIEL-8 c): o sha que o revisor viu vai no `iniciar revisor` e o APROVADO o copia; `integrar` compara.
  const em = (amb, sessao, ts, tipo, dados) => {
    const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
    assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
  };
  const T = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, s)).toISOString();

  test('iniciar-revisor-grava-sha-do-ultimo-concluida: o mesmo do diff despachado; sem sha no concluida (2.0.0), recusa', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha = amb.topo('wt/GM-10-T1');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    const item = amb.cli(['proxima', '--vivos', '0']).j.acao.itens.find((i) => i.task === 'T1' && i.papel === 'revisor');
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    const e = amb.eventos().at(-1);
    assert.equal(e.tipo, 'task.iniciada');
    assert.equal(e.dados.papel, 'revisor');
    assert.equal(e.dados.sha, sha);
    assert.equal(item.diff, `${BASE}...${e.dados.sha}`, 'o sha do iniciar é o <sha> do diff');
    const velho = ambiente();
    assert.equal(velho.cli(['abrir', 'T1']).rc, 0);
    velho.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1' }]]);
    recusa(velho, ['iniciar', 'T1', 'revisor'], 'forma_invalida', /sha/);
  });

  test('veredito-sha-diferente-do-head-recusa: commit depois do iniciar revisor => APROVADO recusado, nada gravado', () => {
    const amb = ambiente();
    for (const a of [['abrir', 'T1'], ['iniciar', 'T1', 'implementador']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    for (const a of [['concluir', 'T1'], ['iniciar', 'T1', 'revisor']]) assert.equal(amb.cli(a).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt', 'sem revisão\n');
    recusa(amb, ['veredito', 'T1', 'APROVADO', '1', '0', '0'], 'sha_diferente', /HEAD/);
    assert.equal(estadoT(amb, 'T1').estado, 'em_revisao');
  });

  test('veredito-aprovado-sem-sha-recusado-na-gravacao: iniciar revisor da 2.0.0 (sem sha) não recebe APROVADO (fail-closed)', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha = amb.topo('wt/GM-10-T1');
    amb.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha }], ['task.iniciada', { task: 'T1', papel: 'revisor' }]]);
    recusa(amb, ['veredito', 'T1', 'APROVADO', '1', '0', '0'], 'forma_invalida', /`sha` ausente/);
    assert.equal(estadoT(amb, 'T1').estado, 'em_revisao');
  });

  test('veredito-usa-sha-do-iniciar-com-reentrega-de-relogio-atras: R de outra sessão cai antes do iniciar; o APROVADO copia o sha do iniciar e recusa', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha1 = amb.topo('wt/GM-10-T1');
    amb.commitNaWt('T1', 'src/t1.txt', 'reentregue\n');
    const sha2 = amb.topo('wt/GM-10-T1');
    em(amb, 'A', T(1), 'task.iniciada', { task: 'T1', papel: 'implementador' });
    em(amb, 'A', T(2), 'task.concluida', { task: 'T1', sha: sha1 });
    em(amb, 'C', T(4), 'task.iniciada', { task: 'T1', papel: 'revisor', sha: sha1 });
    em(amb, 'B', T(3), 'task.concluida', { task: 'T1', sha: sha2, motivo: 'gate' }); // relógio atrás: na ordem, antes do iniciar
    amb.fechar();
    assert.equal(estadoT(amb, 'T1').estado, 'em_revisao');
    recusa(amb, ['veredito', 'T1', 'APROVADO', '1', '0', '0'], 'sha_diferente', new RegExp(sha1.slice(0, 12)));
  });

  test('integrar-recusa-aprovado-de-outro-sha: R com relógio atrás cai antes do APROVADO; o APROVADO é de outro sha => commit_nao_revisado', () => {
    for (const empate of [false, true]) {
      const amb = ambiente();
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      amb.commitNaWt('T1', 'src/t1.txt');
      const sha1 = amb.topo('wt/GM-10-T1');
      amb.commitNaWt('T1', 'src/t1.txt', 'reentregue\n');
      const sha2 = amb.topo('wt/GM-10-T1');
      em(amb, 'A', T(1), 'task.iniciada', { task: 'T1', papel: 'implementador' });
      em(amb, 'A', T(2), 'task.concluida', { task: 'T1', sha: sha1 });
      em(amb, 'A', T(4), 'task.iniciada', { task: 'T1', papel: 'revisor', sha: sha1 });
      em(amb, 'A', T(5), 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0, sha: sha1 });
      // ts empatado com o iniciar: `ordenar` desempata pela sessão ('A' < 'B'), e a R ainda cairia depois; por isso o empate é com o concluida.
      em(amb, 'B', empate ? T(2) : T(3), 'task.concluida', { task: 'T1', sha: sha2, motivo: 'gate' });
      amb.fechar();
      assert.deepEqual(estadoT(amb, 'T1'), { estado: 'aprovada', rodada: 1 }, 'a ordem torta projeta aprovada');
      const antes = semEfeito(amb);
      const r = amb.cli(['integrar', 'T1']);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'commit_nao_revisado', r.out);
      assert.deepEqual(semEfeito(amb), antes, 'nada gravado, nada integrado');
    }
  });

  test('veredito-sem-sha-2-0-0-segue-ordem: diário da 2.0.0 (iniciar e APROVADO sem sha) integra pela guarda de ordem', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const sha = amb.topo('wt/GM-10-T1');
    amb.semear([
      ['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha }],
      ['task.iniciada', { task: 'T1', papel: 'revisor' }], ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }],
    ]);
    const r = amb.cli(['integrar', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.eventos().at(-1).tipo, 'task.integrada');
  });

});

// ─────────────────────────────────────────────────────────────── T15 (REQ-TRI-1): uma regra de ID

test('id-da-branch-igual-nos-dois-usos: contexto do loop e trilhaDe dão o mesmo ID nas mesmas 6 branches, com o idPadrao de origin', () => {
  const amb = ambiente({ plano: null });
  const doLoop = () => {
    try { return contexto(amb.dir, {}).entrega; } catch (e) { assert.equal(e.erro, 'entrega_nao_inferida', e.message); return null; }
  };
  const daTrilha = (branch, idPadrao) => trilhaDe({ branch, idPadrao, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [] }, []).candidato;
  const casos = (idPadrao, esperado) => {
    const branches = Object.keys(esperado);
    assert.equal(branches.length, 6);
    for (const b of branches) {
      assert.equal(gOk(amb.dir, 'checkout', '-q', '-B', b).status, 0, b);
      const loop = doLoop();
      assert.equal(loop, esperado[b], `loop em ${b}`);
      assert.equal(daTrilha(b, idPadrao), loop, `trilha em ${b}`);
      assert.equal(idDaBranch(b, idPadrao), loop, `idDaBranch em ${b}`);
    }
  };
  // sem origin: o padrão; "feat/x-GM-10" e "GM-10x" casam a regex antiga solta e não casam a regra única
  casos('^[A-Z]+-\\d+$', {
    'enabler/GM-10-loop': 'GM-10', 'wt/GM-10-T1': 'GM-10', 'GM-10': 'GM-10', 'feat/x-GM-10': null, 'main': null, 'feat/GM-10x-a': null,
  });
  // com origin: o idPadrao de fluxo.idPadrao vale no loop também
  comOrigin(amb, { fluxo: { idPadrao: 'ABC-\\d+' } });
  casos('ABC-\\d+', {
    'enabler/ABC-7-loop': 'ABC-7', 'wt/ABC-7-T1': 'ABC-7', 'ABC-7': 'ABC-7', 'enabler/GM-10-loop': null, 'main': null, 'feat/x-ABC-7': null,
  });
  // origin corrompida cai no padrão (como a guarda e o painel), sem lançar outra coisa
  comOrigin(amb, '{');
  assert.equal(gOk(amb.dir, 'checkout', '-q', '-B', 'enabler/GM-10-loop').status, 0);
  assert.equal(doLoop(), 'GM-10');
  // --entrega explícito segue vencendo a branch
  assert.equal(contexto(amb.dir, { entrega: 'GM-77' }).entrega, 'GM-77');
});

test('id-padrao-de-origin-invalido-ou-longo: regex inválida e > 200 caracteres caem no padrão, sem lançar; 200 exatos valem', () => {
  const amb = ambiente({ plano: null });
  const doLoop = () => {
    try { return contexto(amb.dir, {}).entrega; } catch (e) { assert.equal(e.erro, 'entrega_nao_inferida', e.message); return null; }
  };
  const em = (branch) => { assert.equal(gOk(amb.dir, 'checkout', '-q', '-B', branch).status, 0, branch); return doLoop(); };
  // regex inválida ⇒ padrão: GM-10 é inferido e nada lança
  comOrigin(amb, { fluxo: { idPadrao: 'ABC-(\\d+' } });
  assert.equal(em('enabler/GM-10-loop'), 'GM-10');
  assert.equal(em('enabler/ABC-7-loop'), 'ABC-7');
  // 201 caracteres (válida, mas longa) ⇒ padrão: GM-10 vale (a longa não o casaria)
  const longa = `ABC-\\d+|${'Z'.repeat(201 - 'ABC-\\d+|'.length)}`;
  assert.equal(longa.length, 201);
  comOrigin(amb, { fluxo: { idPadrao: longa } });
  assert.equal(em('enabler/GM-10-loop'), 'GM-10');
  // 200 exatos valem: a mesma regex encurtada em 1 é a de origin (GM-10 não casa mais)
  comOrigin(amb, { fluxo: { idPadrao: longa.slice(0, 200) } });
  assert.equal(em('enabler/GM-10-loop'), null);
  assert.equal(em('enabler/ABC-7-loop'), 'ABC-7');
});

test('aprovar-sem-plano-pelo-cli-real (P9): o comando do dono, sem plano.json, grava pelo hook real e o loop segue sem plano', () => {
  const amb = ambiente({ plano: null });
  mkdirSync(join(amb.dir, 'docs', 'superpowers', 'specs'), { recursive: true });
  const texto = '# Spec\n\nPBI: GM-10\n\n## A\n';
  writeFileSync(join(amb.dir, 'docs', 'superpowers', 'specs', 's.md'), texto);
  const hook = join(AQUI, '..', 'scripts', 'aprovar-spec.mjs');
  const entrada = { session_id: 'S-dono', cwd: amb.dir, hook_event_name: 'UserPromptExpansion', command_name: 'gabarito-mestre:aprovar', command_args: '', command_source: 'plugin' };
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(entrada), encoding: 'utf8', cwd: amb.dir, env: amb.env });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout.trim());
  assert.notEqual(j.decision, 'block', r.stdout);
  const ev = amb.eventos().filter((e) => e.tipo === 'spec.aprovada');
  assert.deepEqual(ev.map((e) => e.dados), [{ spec: 'docs/superpowers/specs/s.md', sha256: createHash('sha256').update(texto).digest('hex') }]);
  // o loop sem plano continua dizendo plano_ausente (aprovar não inventa plano)
  const p = amb.cli(['proxima', '--vivos', '0']);
  assert.equal(p.j?.erro, 'plano_ausente', p.out);
});

// ═══════════════════════════════════════════════════════════════ GM-14 T36: a Sombra libera o teto 1 vez por task (FIEL-15, emenda 13)
// Ataques obrigatórios: furos 1–10 da Sombra e44cd3ef. Cada recusa relê o diário (bytes iguais) e confere que os achados ficaram no lugar.


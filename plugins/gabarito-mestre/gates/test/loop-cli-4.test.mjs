// GM-19 T1: parte 4 de loop-cli.test.mjs, dividida por faixa de linha sem mudar nenhum teste.
// O corpo e o de bfa322ad por faixa; ver REQ-SEG-1 da spec da GM-19.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hashDaLiberacao, liberarTeto } from '../scripts/loop.mjs';
import { estadoDe as estadoNucleo, ordenar as ordenarNucleo } from '../dist/loop.js';
import * as diario from '../dist/diario.js';
import { AQUI, g, CONFIG_PADRAO, planoDe, PLANO_PADRAO, ambiente, PROPOSTA, escreve, grava, bytesDoDiario, ambReq, comOrigin, proporArgs, emendasDoDiario } from './_loop-cli-helpers.mjs';
// --- corpo movido ---
describe('T36: a Sombra libera o teto', () => {
  const SOMBRA = join(AQUI, '..', 'scripts', 'sombra.mjs');
  const sombra = (amb, args) => {
    const r = spawnSync(process.execPath, [SOMBRA, ...args], { cwd: amb.dir, encoding: 'utf8', env: amb.env });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout + r.stderr };
  };
  const comLibera = (amb, sombraCfg = { libera_teto: true }) => comOrigin(amb, { sombra: sombraCfg });
  const ok = (amb, args) => { const r = amb.cli(args); assert.equal(r.rc, 0, `${args.join(' ')}: ${r.out}${r.err}`); return r; };
  const achado = (amb, t, n) => { mkdirSync(join(amb.wt(t), '.tmp-gabarito'), { recursive: true }); writeFileSync(join(amb.wt(t), '.tmp-gabarito', `review-r${n}.md`), `achado r${n}\n`); };
  /** Pelo CLI real: abrir, implementar, REPROVADO r1, corrigir, (antesDoTeto), REPROVADO r2 com achado ⇒ no_teto. */
  function aoTeto(amb, t = 'T1', antesDoTeto = () => {}) {
    ok(amb, ['abrir', t]);
    ok(amb, ['iniciar', t, 'implementador']);
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`, 'a\n');
    ok(amb, ['concluir', t]);
    ok(amb, ['iniciar', t, 'revisor']);
    achado(amb, t, 1);
    ok(amb, ['veredito', t, 'REPROVADO', '1', '1', '0']);
    ok(amb, ['iniciar', t, 'correcao']);
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`, 'b\n');
    ok(amb, ['concluir', t]);
    ok(amb, ['iniciar', t, 'revisor']);
    antesDoTeto();
    achado(amb, t, 2);
    ok(amb, ['veredito', t, 'REPROVADO', '2', '1', '0']);
  }
  const estadoT = (amb, t = 'T1') => {
    const o = ordenarNucleo(amb.eventos());
    assert.ok(o.ok);
    return estadoNucleo(o.eventos.filter((e) => ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'].includes(e.tipo) && e.dados?.task === t));
  };
  const respostaJson = (amb, obj, nome = `r-${Math.random().toString(16).slice(2)}.json`) => {
    const f = join(amb.tmpSistema, nome);
    writeFileSync(f, JSON.stringify(obj));
    return f;
  };
  const BOA = { resposta: 'libera mais um ciclo', texto: 'a spec sustenta mais uma rodada', pergunta_enviesada: false, fontes: ['docs/spec.md:3'] };
  /** Pergunta de liberação + decisão pelo CLI real da Sombra. Devolve o hash. */
  function sombraDecide(amb, t = 'T1', extra = { libera: true }) {
    const p = sombra(amb, ['perguntar', '--task', t, '--libera-teto']);
    assert.equal(p.rc, 0, p.out);
    const r = sombra(amb, ['registrar', p.j.hash, respostaJson(amb, { ...BOA, ...extra })]);
    assert.equal(r.rc, 0, r.out);
    return p.j.hash;
  }
  const liberar = (amb, t, h, extra = []) => amb.cli(['liberar', t, '--origem', 'sombra', '--hash', h, ...extra]);
  const achadosNoLugar = (amb, t = 'T1') => existsSync(join(amb.wt(t), '.tmp-gabarito', 'review-r2.md'));
  /** Recusa com o código, rc 1, 1 frase e NADA gravado (diário relido byte a byte) nem achado movido. */
  function recusa(amb, t, h, erro, extra = []) {
    const antes = bytesDoDiario(amb);
    const r = liberar(amb, t, h, extra);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, erro, r.out);
    assert.equal(typeof r.j.mensagem, 'string');
    assert.match(r.j.mensagem, /nada foi gravado/i);
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    return r;
  }
  /** Evento escrito à mão (forja) com `ts` deslocado do agora; a sessão decide a ordem. */
  const forja = (amb, sessao, tipo, dados, deslocMs = 0) => {
    const r = diario.append(amb.entregas, sessao, { ts: new Date(Date.now() + deslocMs).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
    assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
  };
  /** Arquivos que `registrar` grava (brief e resposta), sem passar pelo CLI. */
  const arquivosDaDecisao = (amb, h, texto = 'texto') => {
    mkdirSync(join(amb.entregas, 'sombra'), { recursive: true });
    writeFileSync(join(amb.entregas, 'sombra', `${h}.md`), 'brief\n');
    const nome = `${h}.${createHash('sha256').update(texto).digest('hex').slice(0, 12)}.resposta.md`;
    writeFileSync(join(amb.entregas, 'sombra', nome), texto);
    return `.harness/entregas/GM-10/sombra/${nome}`;
  };
  /** O hash de liberação que `liberar` recalcula HOJE: emendas, rodadas do ciclo e sha de cada achado (T39 r1). Não depende do caminho da raiz. */
  const hashT = (amb, t = 'T1') => hashDaLiberacao(JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8')), amb.eventos(), t, amb.dir);

  test('t36-p9-cli-real: no_teto ⇒ registrar libera:true ⇒ liberar --origem sombra ⇒ pendente r0 ⇒ registro e painel listam ⇒ o mesmo hash depois ⇒ fora_do_teto', async () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    const h = sombraDecide(amb);
    const dec = amb.eventos().filter((e) => e.tipo === 'decisao.sombra');
    assert.equal(dec.length, 1);
    assert.equal(dec[0].dados.libera, true, 'o campo libera chega ao diário');
    assert.equal(dec[0].dados.task, 'T1');
    assert.equal(dec[0].dados.pergunta_hash, h);
    assert.equal(h, hashT(amb), 'a pergunta de liberação tem o hash que o loop recalcula');
    const antes = amb.eventos().length;
    const r = liberar(amb, 'T1', h);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual([r.j.ok, r.j.task, r.j.entrega, r.j.estado, r.j.origem, r.j.hash], [true, 'T1', 'GM-10', 'pendente', 'sombra', h]);
    const novos = amb.eventos().slice(antes);
    assert.equal(novos.length, 1, 'um evento só');
    assert.equal(novos[0].tipo, 'task.reaberta');
    assert.deepEqual(novos[0].dados, { task: 'T1', origem: 'sombra', hash: h });
    assert.equal(novos[0].sessao, 'loop');
    assert.deepEqual(estadoT(amb), { estado: 'pendente', rodada: 0 });
    // os achados do ciclo que terminou no teto saem do caminho (como na liberação do dono)
    assert.equal(achadosNoLugar(amb), false);
    assert.ok(existsSync(join(amb.wt('T1'), '.tmp-gabarito', 'ciclo-1', 'review-r2.md')));
    // registro (o que o Stop de concluir e o registro.md mostram ao dono) e RECENTE do painel
    const { montarRegistro } = await import('../dist/registro.js');
    assert.match(montarRegistro('GM-10', amb.eventos(), null), /· task T1 · a Sombra liberou a T1 · decisão [0-9a-f]{12}/);
    const { fraseHistorico } = await import('../dist/painel-texto.js');
    const ctx = { nomes: new Map(), lider: 'L', sabio: 'S', porAgente: new Map(), fuso: 'UTC', agoraMs: Date.now(), textoParar: () => null };
    assert.equal(fraseHistorico(novos[0], ctx)?.texto, 'a Sombra liberou a T1');
    // GM-15 T36 (D-G17): sem limite numérico; o mesmo hash num diário já fora do teto é `fora_do_teto` (não existe mais `teto_sombra_esgotado`)
    recusa(amb, 'T1', h, 'fora_do_teto');
  });

  test('t36-sem-flag: sem origin, origin sem a chave, chave que não é true, só no config local e origin ilegível ⇒ libera_teto_desligado', () => {
    const amb = ambReq({ config: { ...CONFIG_PADRAO, sombra: { libera_teto: true } } });
    aoTeto(amb);
    const h = sombraDecide(amb);
    for (const preparar of [() => {}, () => comOrigin(amb, { sombra: { teto: 9 } }), () => comOrigin(amb, { sombra: { libera_teto: 'true' } }),
      () => comOrigin(amb, { sombra: { julga_emendas: true } }), () => comOrigin(amb, { sombra: null }), () => comOrigin(amb, '{quebrado')]) {
      preparar();
      const r = recusa(amb, 'T1', h, 'libera_teto_desligado');
      assert.match(r.j.mensagem, /origin\/HEAD/);
      assert.ok(achadosNoLugar(amb), 'achados no lugar');
    }
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    // controle: o mesmo diário com o flag em origin libera
    comLibera(amb);
    assert.equal(liberar(amb, 'T1', h).rc, 0);
  });

  test('t36-sem-flag-comportamento-identico (FIEL-15 d): decisão sem `libera` grava os mesmos campos de antes; o dono libera como sempre', () => {
    const amb = ambReq();
    aoTeto(amb);
    const p = sombra(amb, ['perguntar', '--task', 'T1', '--pergunta', 'a forma vale?']);
    const reg = sombra(amb, ['registrar', p.j.hash, respostaJson(amb, BOA)]);
    assert.equal(reg.rc, 0, reg.out);
    const d = amb.eventos().filter((e) => e.tipo === 'decisao.sombra').at(-1).dados;
    assert.deepEqual(Object.keys(d).sort(), ['arquivo', 'fontes', 'pergunta_enviesada', 'pergunta_hash', 'resposta', 'task']);
    const r = liberarTeto(amb.dir, 'T1', 'S-dono');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.reaberta').map((e) => e.dados), [{ task: 'T1', origem: 'dono' }]);
  });

  test('t36-fora-do-teto: pendente, implementando e reprovada ⇒ fora_do_teto', () => {
    const amb = ambReq();
    comLibera(amb);
    const h0 = hashT(amb);
    recusa(amb, 'T1', h0, 'fora_do_teto');
    ok(amb, ['abrir', 'T1']);
    ok(amb, ['iniciar', 'T1', 'implementador']);
    // T39 r1: fora do teto `perguntar --libera-teto` já recusa; a decisão só chega aqui forjada
    const p = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    assert.equal(p.j?.erro, 'fora_do_teto', p.out);
    const h = hashT(amb);
    forja(amb, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    recusa(amb, 'T1', h, 'fora_do_teto');
    const antes = bytesDoDiario(amb);
    assert.equal(liberar(amb, 'T9', h).j.erro, 'task_fora_do_plano');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('t36-uso: só --origem sombra; --hash e --origem obrigatórios; nenhum argumento produz dono; hash fora da forma ⇒ hash_invalido', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = sombraDecide(amb);
    const antes = bytesDoDiario(amb);
    for (const a of [['liberar', 'T1', '--origem', 'dono', '--hash', h], ['liberar', 'T1', '--origem', 'retomada', '--hash', h], ['liberar', 'T1', '--hash', h],
      ['liberar', 'T1', '--origem', 'sombra'], ['liberar', '--origem', 'sombra', '--hash', h], ['liberar', 'T1', '--origem', 'sombra', '--hash', h, '--dono', 'x']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 2, `${a.join(' ')}: ${r.out}`);
      assert.equal(r.j.ok, false);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
    for (const ruim of ['xyz', h.toUpperCase(), h.slice(1), `${h}0`]) recusa(amb, 'T1', ruim, 'hash_invalido');
    assert.equal(amb.eventos().filter((e) => e.tipo === 'task.reaberta').length, 0);
  });

  test('t36-furo-1-3: só `decisao.sombra` vigente da PERGUNTA de liberação da task; outra pergunta ou de outra task ⇒ hash_invalido', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    // outra pergunta da mesma task (sem libera): qualquer decisão da task NÃO serve
    const p = sombra(amb, ['perguntar', '--task', 'T1', '--pergunta', 'o teste cobre?']);
    assert.equal(sombra(amb, ['registrar', p.j.hash, respostaJson(amb, BOA)]).rc, 0);
    assert.match(recusa(amb, 'T1', p.j.hash, 'hash_invalido').j.mensagem, /pergunta de liberação/);
    // pergunta de liberação de OUTRA task, com libera true (forjada: a T2 não está no teto, e `perguntar --libera-teto` recusa fora dele, T39 r1)
    assert.equal(sombra(amb, ['perguntar', '--task', 'T2', '--libera-teto']).j?.erro, 'fora_do_teto');
    const h2 = hashT(amb, 'T2');
    forja(amb, 'forja', 'sombra.consulta', { pergunta_hash: h2, task: 'T2' });
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h2, task: 'T2', resposta: 'r', arquivo: arquivosDaDecisao(amb, h2), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    recusa(amb, 'T1', h2, 'hash_invalido');
    // a pergunta certa sem decisão ainda
    const aberta = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    assert.equal(aberta.j.hash, hashT(amb));
    assert.match(recusa(amb, 'T1', aberta.j.hash, 'hash_invalido').j.mensagem, /decisão/);
    // sem libera e com libera false: motivo próprio (T39, emenda 16), testes liberar-libera-*-sombra-nao-liberou
  });

  // GM-14 T39 (emenda 16): `libera` ausente ou falso na decisão vigente é a Sombra dizendo não, com motivo próprio (rc 1, nada gravado)
  for (const [nome, extra] of [['liberar-libera-false-sombra-nao-liberou', { libera: false }], ['liberar-libera-ausente-sombra-nao-liberou', {}]]) {
    test(nome, () => {
      const amb = ambReq();
      comLibera(amb);
      aoTeto(amb);
      const h = sombraDecide(amb, 'T1', extra);
      const r = recusa(amb, 'T1', h, 'sombra_nao_liberou');
      assert.match(r.j.mensagem, extra.libera === false ? /libera false/ : /libera ausente/);
      assert.ok(achadosNoLugar(amb), 'achados no lugar');
      assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    });
  }

  test('emenda-dia2-nova-muda-hash', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = sombraDecide(amb);
    assert.equal(h, hashT(amb));
    // emenda aprovada de REQ-DIA-2 (onde a FIEL-15 mora; a T1 não lista o REQ) depois da decisão: muda o hash, a decisão velha não libera
    escreve(amb, 'emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-DIA-2', diff: '+ FIEL-15 nova' }), new Date().toISOString());
    const seq = amb.eventos().filter((e) => e.tipo === 'emenda.proposta').at(-1).seq;
    escreve(amb, 'dono', 'spec.emendada', { proposta_seq: seq, origem: 'dono' }, new Date().toISOString());
    const novo = hashT(amb);
    assert.notEqual(novo, h, 'emenda de REQ-DIA-2 versiona o hash da liberação');
    assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /pergunta de liberação/);
    // a pergunta de hoje (sombra.mjs) tem o hash novo que o loop recalcula, e libera
    assert.equal(sombraDecide(amb), novo);
    assert.equal(liberar(amb, 'T1', novo).rc, 0);
    // controle: emenda de REQ fora da task e fora de REQ-DIA-2 não muda o hash
    const amb2 = ambReq();
    aoTeto(amb2);
    const h2 = hashT(amb2);
    escreve(amb2, 'emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-Z-9' }), new Date().toISOString());
    escreve(amb2, 'dono', 'spec.emendada', { proposta_seq: amb2.eventos().filter((e) => e.tipo === 'emenda.proposta').at(-1).seq, origem: 'dono' }, new Date().toISOString());
    assert.equal(hashT(amb2), h2);
  });

  // T39 r1 (MAJOR 1): a decisão vale para o insumo que a Sombra leu; achado reescrito ou veredito novo depois dela ⇒ `liberar` recusa
  test('liberar-recusa-decisao-sobre-insumo-velho', () => {
    for (const mudar of [
      (amb) => writeFileSync(join(amb.wt('T1'), '.tmp-gabarito', 'review-r2.md'), 'achado r2 REESCRITO\n'),
      (amb) => {
        forja(amb, 'loop', 'review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 3, blocker: 1, major: 0 });
        achado(amb, 'T1', 3);
      },
    ]) {
      const amb = ambReq();
      comLibera(amb);
      aoTeto(amb);
      const velho = sombraDecide(amb);
      mudar(amb);
      assert.notEqual(hashT(amb), velho, 'insumo novo, hash novo');
      assert.match(recusa(amb, 'T1', velho, 'hash_invalido').j.mensagem, /achados de hoje/);
      assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
      // perguntar de novo dá o hash de hoje, brief novo com o insumo novo, e a decisão dele libera
      const p = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
      assert.equal(p.j.hash, hashT(amb));
      assert.notEqual(p.j.hash, velho);
      const brief = readFileSync(join(amb.dir, p.j.brief), 'utf8');
      assert.ok(/REESCRITO/.test(brief) || /### Rodada 3 [^\n]*ÚLTIMA RODADA/.test(brief), brief.slice(-600));
      const novo = sombraDecide(amb);
      assert.equal(novo, p.j.hash);
      const r = liberar(amb, 'T1', novo);
      assert.equal(r.rc, 0, r.out);
    }
  });

  test('t36-furo-1: fora_da_regra true não libera', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = hashT(amb);
    forja(amb, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fora_da_regra: true, emenda_seq: 1, libera: true });
    assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /fora da regra/);
    // controle: a mesma forja sem fora_da_regra libera (o que recusou foi o campo)
    const amb2 = ambReq();
    comLibera(amb2);
    aoTeto(amb2);
    forja(amb2, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    forja(amb2, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb2, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    assert.equal(liberar(amb2, 'T1', h).rc, 0);
  });

  test('t36-furo-2: brief ausente, resposta ausente ou adulterada, decisão sem consulta ⇒ hash_invalido', () => {
    const casos = {
      brief: (amb, h) => renameSync(join(amb.entregas, 'sombra', `${h}.md`), join(amb.entregas, 'sombra', `${h}.md.fora`)),
      resposta: (amb, h) => { const n = readdirSync(join(amb.entregas, 'sombra')).find((x) => x.startsWith(`${h}.`) && x.endsWith('.resposta.md')); renameSync(join(amb.entregas, 'sombra', n), join(amb.entregas, 'sombra', `${n}.fora`)); },
      adulterada: (amb, h) => { const n = readdirSync(join(amb.entregas, 'sombra')).find((x) => x.startsWith(`${h}.`) && x.endsWith('.resposta.md')); writeFileSync(join(amb.entregas, 'sombra', n), 'outro texto'); },
    };
    for (const [nome, estragar] of Object.entries(casos)) {
      const amb = ambReq();
      comLibera(amb);
      aoTeto(amb);
      const h = sombraDecide(amb);
      estragar(amb, h);
      assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /arquivo|brief|resposta/, nome);
    }
    // decisão forjada sem `sombra.consulta` da pergunta
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = hashT(amb);
    forja(amb, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    assert.match(recusa(amb, 'T1', h, 'hash_invalido').j.mensagem, /consulta/);
    // arquivo da decisão que aponta para outro lugar
    const amb3 = ambReq();
    comLibera(amb3);
    aoTeto(amb3);
    forja(amb3, 'forja', 'sombra.consulta', { pergunta_hash: h, task: 'T1' });
    arquivosDaDecisao(amb3, h);
    forja(amb3, 'forja', 'decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: 'docs/spec.md', pergunta_enviesada: false, fontes: ['s:1'], libera: true });
    recusa(amb3, 'T1', h, 'hash_invalido');
  });

  test('t36-furo-4: decisão anterior ao teto pela ORDEM do diário (não pelo ts cru) não vale', () => {
    // (a) antes do 2º REPROVADO a pergunta real nem existe (T39 r1: `perguntar --libera-teto` exige no_teto)
    const amb = ambReq();
    comLibera(amb);
    let p;
    aoTeto(amb, 'T1', () => { p = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']); });
    assert.equal(p.j?.erro, 'fora_do_teto', p.out);
    assert.equal(amb.eventos().filter((e) => e.tipo === 'sombra.consulta').length, 0);
    // (b) mesma sessão do veredito, seq menor e ts 1 h À FRENTE: pelo ts cru seria "depois"; pela ordem do diário é antes.
    // O hash é o que a task terá no teto (o de `amb`, mesmo ciclo e mesmos achados: o hash não depende do caminho da raiz)
    const amb2 = ambReq();
    comLibera(amb2);
    const h2 = hashT(amb);
    aoTeto(amb2, 'T1', () => {
      forja(amb2, 'loop', 'sombra.consulta', { pergunta_hash: h2, task: 'T1' }, 3_600_000);
      forja(amb2, 'loop', 'decisao.sombra', { pergunta_hash: h2, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb2, h2), pergunta_enviesada: false, fontes: ['s:1'], libera: true }, 3_600_000);
    });
    const o = ordenarNucleo(amb2.eventos());
    assert.ok(o.ok);
    const pos = (f) => o.eventos.findIndex(f);
    assert.ok(pos((e) => e.tipo === 'decisao.sombra') < pos((e) => e.tipo === 'review.veredito' && e.dados.rodada === 2), 'controle: na ordem, a decisão vem antes');
    assert.ok(Date.parse(o.eventos[pos((e) => e.tipo === 'decisao.sombra')].ts) > Date.parse(o.eventos[pos((e) => e.tipo === 'review.veredito' && e.dados.rodada === 2)].ts), 'controle: pelo ts, depois');
    assert.match(recusa(amb2, 'T1', h2, 'hash_invalido').j.mensagem, /antes do teto/);
  });

  test('t36-furo-4-relogio: liberação que cairia antes do teto na ordem real ⇒ relogio_do_diario, nada gravado', () => {
    const amb = ambReq();
    comLibera(amb);
    // o teto inteiro numa sessão com relógio 1 h à frente: a liberação de agora cairia antes dele
    ok(amb, ['abrir', 'T1']);
    const fut = (tipo, dados, n) => forja(amb, 'futuro', tipo, dados, 3_600_000 + n * 1000);
    [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }],
      ['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
    ].forEach(([tipo, dados], i) => fut(tipo, dados, i));
    achado(amb, 'T1', 2);
    const h = hashT(amb); // T39 r1: o hash leva o insumo do teto (rodadas e achados), então vem depois deles
    [['sombra.consulta', { pergunta_hash: h, task: 'T1' }],
      ['decisao.sombra', { pergunta_hash: h, task: 'T1', resposta: 'r', arquivo: arquivosDaDecisao(amb, h), pergunta_enviesada: false, fontes: ['s:1'], libera: true }],
    ].forEach(([tipo, dados], i) => fut(tipo, dados, 6 + i));
    amb.fechar();
    assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
    recusa(amb, 'T1', h, 'relogio_do_diario');
    assert.ok(achadosNoLugar(amb), 'a recusa deixa os achados onde estão');
  });

  test('t36-furo-5: decisão substituída não vale; vale a vigente', () => {
    // libera true substituída por libera false ⇒ recusa
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    const h = sombraDecide(amb);
    const a = amb.eventos().filter((e) => e.tipo === 'decisao.sombra').at(-1);
    const sub = sombra(amb, ['registrar', h, respostaJson(amb, { ...BOA, texto: 'mudei de ideia', libera: false, substitui: { sessao: a.sessao, seq: a.seq } })]);
    assert.equal(sub.rc, 0, sub.out);
    assert.match(recusa(amb, 'T1', h, 'sombra_nao_liberou').j.mensagem, /libera/);
    // libera false substituída por libera true ⇒ libera
    const amb2 = ambReq();
    comLibera(amb2);
    aoTeto(amb2);
    const h2 = sombraDecide(amb2, 'T1', { libera: false });
    const b = amb2.eventos().filter((e) => e.tipo === 'decisao.sombra').at(-1);
    assert.equal(sombra(amb2, ['registrar', h2, respostaJson(amb2, { ...BOA, texto: 'agora sim', libera: true, substitui: { sessao: b.sessao, seq: b.seq } })]).rc, 0);
    const r = liberar(amb2, 'T1', h2);
    assert.equal(r.rc, 0, r.out);
  });

  test('t36-furo-6 (GM-15 T36, D-G17): sem limite numérico: depois da liberação do dono OU da Sombra, no teto de novo a Sombra libera de novo (sem progresso medido ⇒ só com abordagem_nova)', () => {
    const ciclo = [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
      ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T1', papel: 'correcao' }],
      ['task.concluida', { task: 'T1', sha: 'b'.repeat(40) }], ['review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }]];
    for (const origem of ['dono', 'sombra']) {
      const amb = ambReq();
      comLibera(amb);
      ok(amb, ['abrir', 'T1']);
      amb.semear([...ciclo, ['task.reaberta', origem === 'dono' ? { task: 'T1', origem } : { task: 'T1', origem, hash: 'e'.repeat(64) }], ...ciclo]);
      assert.deepEqual(estadoT(amb), { estado: 'no_teto', rodada: 2 });
      const h = sombraDecide(amb);
      // reviews ausentes dos 2 últimos ciclos ⇒ sem progresso medido ⇒ só com abordagem
      assert.match(recusa(amb, 'T1', h, 'sem_progresso_sem_abordagem').j.mensagem, /abordagem/, origem);
      const r = liberar(amb, 'T1', h, ['--abordagem-nova', 'dividir a task em duas']);
      assert.equal(r.rc, 0, r.out);
      assert.deepEqual(estadoT(amb), { estado: 'pendente', rodada: 0 });
    }
  });

  test('t36-registrar-libera: não booleano ⇒ resposta_invalida; libera:true fora da pergunta de liberação ⇒ libera_fora_da_liberacao; nada gravado', () => {
    const amb = ambReq();
    aoTeto(amb);
    const lib = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    const outra = sombra(amb, ['perguntar', '--task', 'T1', '--pergunta', 'outra?']);
    const doReq = sombra(amb, ['perguntar', '--req', 'REQ-A-1', '--pergunta', 'e o req?']);
    const arquivos = () => readdirSync(join(amb.entregas, 'sombra')).sort();
    const antes = [bytesDoDiario(amb), arquivos()];
    for (const v of ['true', 1, null]) {
      const r = sombra(amb, ['registrar', lib.j.hash, respostaJson(amb, { ...BOA, libera: v })]);
      assert.equal(r.j.erro, 'resposta_invalida', r.out);
      assert.match(r.j.mensagem, /libera/);
    }
    for (const hh of [outra.j.hash, doReq.j.hash]) {
      const r = sombra(amb, ['registrar', hh, respostaJson(amb, { ...BOA, libera: true })]);
      assert.equal(r.rc, 1, r.out);
      assert.equal(r.j.erro, 'libera_fora_da_liberacao', r.out);
    }
    assert.deepEqual([bytesDoDiario(amb), arquivos()], antes, 'nada gravado: diário e arquivos iguais');
    // `--libera-teto` exige --task e não aceita --pergunta
    for (const a of [['perguntar', '--req', 'REQ-A-1', '--libera-teto'], ['perguntar', '--task', 'T1', '--libera-teto', '--pergunta', 'x?'], ['perguntar', '--libera-teto']]) {
      assert.equal(sombra(amb, a).rc, 2, a.join(' '));
    }
  });

  test('t36-dono-inalterado: com o flag ligado e decisão da Sombra presente, o caminho do dono grava origem dono e só ele', () => {
    const amb = ambReq();
    comLibera(amb);
    aoTeto(amb);
    sombraDecide(amb);
    const r = liberarTeto(amb.dir, 'T1', 'S-dono');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.reaberta').map((e) => [e.sessao, e.dados]), [['S-dono', { task: 'T1', origem: 'dono' }]]);
  });

  // ── GM-15 T36 (emendas 22 e 24): progresso medido, abordagem nova, freios e orçamento ───────────────────────────────────────────────────────
  const REV = (...ls) => ls.map((n) => `${n.startsWith('BLOCKER') ? '' : 'MAJOR '}${n}`).join('\n') + '\n';
  const trecho = (n, arq = 'src/t1.txt') => `${arq}:${n} achado`;
  let _c = 0;
  /** Um ciclo inteiro pelo CLI até o teto, com o texto dos reviews r1 e r2 dados; a 1ª vez abre a task. */
  function ciclo(amb, texto1, texto2 = texto1, t = 'T1') {
    _c += 1;
    if (estadoT(amb, t).estado === 'pendente' && !amb.eventos().some((e) => e.dados?.task === t && e.tipo === 'task.iniciada')) ok(amb, ['abrir', t]);
    ok(amb, ['iniciar', t, 'implementador']);
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`, `v${_c}a\n`);
    ok(amb, ['concluir', t]);
    ok(amb, ['iniciar', t, 'revisor']);
    mkdirSync(join(amb.wt(t), '.tmp-gabarito'), { recursive: true });
    writeFileSync(join(amb.wt(t), '.tmp-gabarito', 'review-r1.md'), texto1);
    ok(amb, ['veredito', t, 'REPROVADO', '1', '1', '0']);
    ok(amb, ['iniciar', t, 'correcao']);
    amb.commitNaWt(t, `src/${t.toLowerCase()}.txt`, `v${_c}b\n`);
    ok(amb, ['concluir', t]);
    ok(amb, ['iniciar', t, 'revisor']);
    writeFileSync(join(amb.wt(t), '.tmp-gabarito', 'review-r2.md'), texto2);
    ok(amb, ['veredito', t, 'REPROVADO', '2', '1', '0']);
    assert.equal(estadoT(amb, t).estado, 'no_teto');
  }
  const reaberta = (amb) => amb.eventos().filter((e) => e.tipo === 'task.reaberta').map((e) => e.dados);

  test('t36-sombra-libera-sem-limite-com-progresso: 6 ciclos seguidos, cada um com achados em outro trecho e total não maior ⇒ 6 liberações da Sombra, nenhuma recusa por contagem', () => {
    const amb = ambReq();
    comLibera(amb);
    for (let k = 1; k <= 6; k++) {
      ciclo(amb, REV(trecho(1000 * k)), REV(trecho(1000 * k + 500)));
      const h = sombraDecide(amb);
      const r = liberar(amb, 'T1', h);
      assert.equal(r.rc, 0, `ciclo ${k}: ${r.out}`);
    }
    assert.equal(reaberta(amb).filter((d) => d.origem === 'sombra').length, 6);
    assert.ok(reaberta(amb).every((d) => d.abordagem_nova === undefined), 'com progresso não pede abordagem');
  });

  test('t36-progresso-caminho-absoluto-igual-ao-relativo (r1 MINOR-6): o mesmo achado citado absoluto (worktree da raiz) num ciclo e relativo no outro NÃO é progresso, pelo CLI real', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100, `${amb.dir}/.harness/worktrees/T1/src/t1.txt`)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb)]); // 1º teto: dispensado
    ciclo(amb, REV(trecho(100)));
    const r = recusa(amb, 'T1', sombraDecide(amb), 'sem_progresso_sem_abordagem');
    assert.match(r.j.mensagem, /src\/t1\.txt:100/);
  });

  test('t36-sem-progresso-exige-abordagem: o mesmo achado (±10 linhas) 2 ciclos seguidos ⇒ sem_progresso_sem_abordagem, nada gravado; com --abordagem-nova grava no task.reaberta', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb)]); // 1º teto: dispensado
    ciclo(amb, REV(trecho(105)));
    const h = sombraDecide(amb);
    const r = recusa(amb, 'T1', h, 'sem_progresso_sem_abordagem');
    assert.match(r.j.mensagem, /src\/t1\.txt:105/, 'a mensagem diz o achado que reapareceu');
    assert.ok(achadosNoLugar(amb), 'os achados ficaram no lugar');
    const ok2 = liberar(amb, 'T1', h, ['--abordagem-nova', 'dividir a task em duas']);
    assert.equal(ok2.rc, 0, ok2.out);
    assert.deepEqual(reaberta(amb).at(-1), { task: 'T1', origem: 'sombra', hash: h, abordagem_nova: 'dividir a task em duas' });
    assert.deepEqual(ok2.j.abordagem_nova, 'dividir a task em duas');
  });

  test('t36-abordagem-nova-forma: vazia, só espaços, com quebra de linha ou acima de 500 caracteres ⇒ argumento_invalido (rc 2), nada gravado', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)));
    const h = sombraDecide(amb);
    for (const ruim of ['', '   ', 'a\nb', 'x'.repeat(501)]) {
      const antes = bytesDoDiario(amb);
      const r = liberar(amb, 'T1', h, ['--abordagem-nova', ruim]);
      assert.equal(r.rc, 2, JSON.stringify(ruim));
      assert.equal(r.j.erro, 'argumento_invalido');
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
    assert.equal(liberar(amb, 'T1', h, ['--abordagem-nova', 'x'.repeat(500)]).rc, 0, '500 é o limite que passa');
  });

  test('t36-primeiro-teto-dispensa-progresso: no 1º teto da task a liberação vale sem abordagem mesmo com review ilegível', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, 'texto sem achado legível\n');
    const r = liberar(amb, 'T1', sombraDecide(amb));
    assert.equal(r.rc, 0, r.out);
  });

  test('t36-progresso-review-ausente-conta-sem: o review do ciclo anterior ausente (ciclo-N apagado), vazio ou ilegível ⇒ sem progresso ⇒ exige abordagem (falha não vira sucesso)', () => {
    for (const ruim of ['ausente', 'vazio', 'ilegivel']) {
      const amb = ambReq();
      comLibera(amb);
      ciclo(amb, REV(trecho(100)));
      ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb)]);
      const dirCiclo = join(amb.wt('T1'), '.tmp-gabarito', 'ciclo-1');
      if (ruim === 'ausente') rmSync(dirCiclo, { recursive: true });
      else for (const n of ['review-r1.md', 'review-r2.md']) writeFileSync(join(dirCiclo, n), ruim === 'vazio' ? '  \n' : 'sem severidade nenhuma\n');
      ciclo(amb, REV(trecho(9000)));
      const r = recusa(amb, 'T1', sombraDecide(amb), 'sem_progresso_sem_abordagem');
      assert.match(r.j.mensagem, /ausente|vazio|legível/, ruim);
    }
    // controle: o ciclo anterior legível e em outro trecho ⇒ progresso
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb)]);
    ciclo(amb, REV(trecho(9000)));
    assert.equal(liberar(amb, 'T1', sombraDecide(amb)).rc, 0);
  });

  test('t36-progresso-compara-ultimas-rodadas-dos-2-ultimos-ciclos: vale o review de MAIOR rodada de cada ciclo e o ciclo anterior IMEDIATO (não o 1º): r2 novo e ciclo-2 diferente do ciclo-1 ⇒ progresso mesmo com r1 igual', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)), REV(trecho(7000)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb)]);
    ciclo(amb, REV(trecho(100)), REV(trecho(9000))); // r1 repete o anterior, a r2 (a última) é outro trecho
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb)]);
    // 3º ciclo: a última rodada repete a do ciclo-2 (9000), mas não a do ciclo-1 (7000) ⇒ sem progresso (o anterior é o imediato)
    ciclo(amb, REV(trecho(50)), REV(trecho(9000)));
    recusa(amb, 'T1', sombraDecide(amb), 'sem_progresso_sem_abordagem');
  });

  test('t36-duas-abordagens-sem-convergir-vai-ao-dono: 2 liberações com abordagem_nova e o 3º teto ⇒ abordagens_esgotadas (mesmo com decisão íntegra e abordagem), 1 linha no lote; só o dono solta', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb), '--abordagem-nova', 'A']);
    ciclo(amb, REV(trecho(100)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb), '--abordagem-nova', 'B']);
    ciclo(amb, REV(trecho(100)));
    const h = sombraDecide(amb);
    const r = recusa(amb, 'T1', h, 'abordagens_esgotadas', ['--abordagem-nova', 'C']);
    assert.match(r.j.mensagem, /gabarito-mestre:liberar T1/);
    const lote = amb.cli(['proxima', '--vivos', '0']).j.lote;
    assert.equal(lote.filter((i) => /T1/.test(i.motivo) && /abordagens/.test(i.motivo)).length, 1, JSON.stringify(lote));
    assert.equal(liberarTeto(amb.dir, 'T1', 'S-dono').ok, true);
  });

  test('t36-liberacao-do-dono-nao-conta-no-freio: 1 abordagem da Sombra + liberação do dono + 2ª abordagem ⇒ aceita (o dono não conta) e só o teto seguinte esgota (o dono não zera)', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb), '--abordagem-nova', 'A']);
    ciclo(amb, REV(trecho(100)));
    assert.equal(liberarTeto(amb.dir, 'T1', 'S-dono').ok, true);
    ciclo(amb, REV(trecho(100)));
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', sombraDecide(amb), '--abordagem-nova', 'B']);
    ciclo(amb, REV(trecho(100)));
    recusa(amb, 'T1', sombraDecide(amb), 'abordagens_esgotadas', ['--abordagem-nova', 'C']);
  });

  test('t36-hash-de-ciclo-anterior-recusa: 2º teto com o MESMO review ⇒ o `perguntar --libera-teto` REAL (com cache) devolve pergunta NOVA, sem cache; a decisão do ciclo anterior (hash velho) não libera (r1 MAJOR-1)', () => {
    const amb = ambReq();
    comLibera(amb);
    ciclo(amb, REV(trecho(100)));
    const h1 = sombraDecide(amb);
    ok(amb, ['liberar', 'T1', '--origem', 'sombra', '--hash', h1]);
    ciclo(amb, REV(trecho(100)));
    // a Sombra é perguntada pelo CLI real, como o orquestrador faz: nada de `registrar` direto antes
    const p2 = sombra(amb, ['perguntar', '--task', 'T1', '--libera-teto']);
    assert.equal(p2.rc, 0, p2.out);
    assert.notEqual(p2.j.cache, true, `o ciclo novo não pode vir do cache do anterior: ${p2.out}`);
    assert.notEqual(p2.j.hash, h1, 'o nº do ciclo entra no hash: review idêntico, pergunta nova');
    assert.ok(p2.j.prompt, 'prompt para a Sombra');
    // a decisão do ciclo anterior (hash velho) não libera o teto de agora
    const r = recusa(amb, 'T1', h1, 'hash_invalido');
    assert.match(r.j.mensagem, /não é o hash/);
    const rg = sombra(amb, ['registrar', p2.j.hash, respostaJson(amb, { ...BOA, libera: true })]);
    assert.equal(rg.rc, 0, rg.out);
    assert.equal(liberar(amb, 'T1', p2.j.hash, ['--abordagem-nova', 'dividir']).rc, 0);
  });

  // ── orçamento 3× (emenda 24 m.2) e a oferta do `proxima` (emenda 22 l.4): diário semeado com 1 s por evento (relógio de `semear`, relativo ao evento) ──────────────
  const SHA = (n) => String(n).repeat(40).slice(0, 40);
  const integrada = (t) => [['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: SHA(1) }], ['task.iniciada', { task: t, papel: 'revisor' }],
    ['review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }], ['task.integrada', { task: t, sha: SHA(2) }]]; // implementador 1 s + revisor 1 s = 2 s
  /** T3 no teto com `parado` eventos de enchimento entre o início e a conclusão do implementador (cada um custa 1 s) */
  const t3NoTeto = (parado) => [['task.iniciada', { task: 'T3', papel: 'implementador' }], ...Array.from({ length: parado }, () => ['ci.resultado', { verde: true }]), ['task.concluida', { task: 'T3', sha: SHA(3) }],
    ['task.iniciada', { task: 'T3', papel: 'revisor' }], ['review.veredito', { task: 'T3', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }], ['task.iniciada', { task: 'T3', papel: 'correcao' }],
    ['task.concluida', { task: 'T3', sha: SHA(4) }], ['task.iniciada', { task: 'T3', papel: 'revisor' }], ['review.veredito', { task: 'T3', veredito: 'REPROVADO', rodada: 2, major: 1, blocker: 0 }]];
  const ambOrcamento = (parado) => {
    const amb = ambReq();
    comLibera(amb);
    amb.semear([...integrada('T1'), ...integrada('T2'), ...t3NoTeto(parado)]);
    assert.equal(estadoT(amb, 'T3').estado, 'no_teto');
    return amb;
  };

  test('t36-orcamento-3x-vai-ao-dono: T3 gasta mais de 3× a mediana (2 s ⇒ limite 6 s) ⇒ liberar recusa orcamento_estourado mesmo com decisão íntegra; proxima não oferece a pergunta e o lote tem 1 linha', () => {
    const amb = ambOrcamento(8); // implementador 10 s + 1 + 1 + 1 = 13 s
    const h = sombraDecide(amb, 'T3');
    const r = recusa(amb, 'T3', h, 'orcamento_estourado');
    assert.match(r.j.mensagem, /mediana/);
    const p = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual([p.acao.tipo, p.acao.motivo, p.acao.task, p.acao.liberacao.oferecer, p.acao.liberacao.motivo], ['parar', 'teto_rodadas', 'T3', false, 'orcamento_estourado']);
    assert.equal(p.lote.filter((i) => /T3/.test(i.motivo) && /gastou/.test(i.motivo)).length, 1, JSON.stringify(p.lote));
    assert.ok(p.lote.find((i) => /T3/.test(i.motivo)).acoes.some((a) => a.comando === '/gabarito-mestre:liberar T3'));
  });

  test('t36-orcamento-dentro-do-limite-oferece: T3 abaixo de 3× a mediana ⇒ proxima oferece a pergunta (liberacao.oferecer true), o lote não tem a T2 e liberar passa', () => {
    const amb = ambOrcamento(0); // implementador 1 s + 1 + 1 + 1 = 4 s < 6 s
    const p = amb.cli(['proxima', '--vivos', '0']).j;
    assert.equal(p.acao.liberacao.oferecer, true);
    assert.equal(p.acao.liberacao.dispensado, true);
    assert.equal(p.lote.filter((i) => /T3/.test(i.motivo)).length, 0);
    assert.equal(liberar(amb, 'T3', sombraDecide(amb, 'T3')).rc, 0);
  });

  /** O DEPENDE do painel REAL (`painel.mjs estado`) no mesmo diário que o `proxima` leu (P9: a regra de "quem decide" vale nas duas camadas). */
  const dependePainel = (amb) => {
    const r = spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'painel.mjs'), 'estado'], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    return j.estado.depende ?? [];
  };
  const itemDoTeto = (itens) => itens.filter((i) => /teto de rodadas|limite de revis/.test(i.motivo) || i.acoes.some((a) => a.comando === '/gabarito-mestre:liberar T3'));

  test('t36-painel-e-proxima-concordam-quem-decide (r1 MAJOR-2): a Sombra decide (oferta ativa, sem freio) ⇒ o DEPENDE do painel real NÃO mostra o teto nem o botão liberar; com freio ou flag desligada os dois mostram o item do dono', () => {
    // sem freio: proxima oferece a Sombra, lote vazio ⇒ painel sem item do teto
    const amb = ambOrcamento(0);
    const p = amb.cli(['proxima', '--vivos', '0']).j;
    assert.equal(p.acao.liberacao.oferecer, true);
    assert.equal(p.lote.length, 0, JSON.stringify(p.lote));
    assert.deepEqual(itemDoTeto(dependePainel(amb)), [], JSON.stringify(dependePainel(amb)));
    // o PAROU gravado (o mod regrava `loop.parar teto_rodadas`) também não vira item do dono quando a Sombra decide
    assert.equal(amb.cli(['parar', 'teto_rodadas']).rc, 0);
    assert.deepEqual(itemDoTeto(dependePainel(amb)), [], JSON.stringify(dependePainel(amb)));
    // com freio (orçamento 3x): proxima não oferece, o lote tem o item ⇒ o painel mostra o do dono, 1 só, com o botão
    const fr = ambOrcamento(8);
    const pf = fr.cli(['proxima', '--vivos', '0']).j;
    assert.equal(pf.acao.liberacao.oferecer, false);
    assert.equal(fr.cli(['parar', 'teto_rodadas']).rc, 0);
    const itens = itemDoTeto(dependePainel(fr));
    assert.equal(itens.length, 1, JSON.stringify(dependePainel(fr)));
    assert.ok(itens[0].acoes.some((a) => a.comando === '/gabarito-mestre:liberar T3'));
    // flag desligada: idem
    const off = ambiente();
    off.semear([...integrada('T1'), ...integrada('T2'), ...t3NoTeto(0)]);
    assert.equal(off.cli(['proxima', '--vivos', '0']).j.acao.liberacao.oferecer, false);
    assert.equal(itemDoTeto(dependePainel(off)).length, 1, JSON.stringify(dependePainel(off)));
  });

  test('t36-proxima-flag-desligada-nao-oferece: sem sombra.libera_teto em origin ⇒ liberacao.oferecer false (libera_teto_desligado) e a task no lote do dono', () => {
    const amb = ambiente();
    amb.semear([...integrada('T1'), ...integrada('T2'), ...t3NoTeto(0)]);
    const p = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual([p.acao.liberacao.oferecer, p.acao.liberacao.motivo], [false, 'libera_teto_desligado']);
    assert.equal(p.lote.filter((i) => /T3/.test(i.motivo)).length, 1);
  });

  test('t36-orcamento-sem-mediana-avisa: nenhuma task integrada ⇒ sem freio por orçamento (a liberação segue) e aviso no proxima', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T3', deps: [], arquivos: ['src/t2.txt'] }]) });
    comLibera(amb);
    amb.semear(t3NoTeto(500));
    const p = amb.cli(['proxima', '--vivos', '0']).j;
    assert.ok((p.aviso ?? []).some((a) => /sem mediana/.test(a)), JSON.stringify(p.aviso));
    assert.equal(p.acao.liberacao.oferecer, true, 'sem mediana não freia');
  });

});

// ─────────────────────────────────────────────────────────────── GM-14 T38: spec do checkout da sessão (DP-3 aj. 4 e 5)

describe('GM-14 T38: a spec se lê do checkout da sessão; o diário fica na principal', () => {
  const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
  const SPEC_A = 'docs/superpowers/specs/gm10-a.md';
  const SPEC_B = 'docs/superpowers/specs/gm10-b.md';
  const TEXTO_WT = '# GM-10 da worktree\n\nPBI: GM-10\n\n## Uma\n';
  const TEXTO_PRINCIPAL = '# GM-10 da principal\n\nPBI: GM-10\n\n## Outra\n';
  const sha = (t) => createHash('sha256').update(Buffer.from(t)).digest('hex');
  const AGUARDANDO = 'spec aguardando aprovação';
  /** Worktree REAL (`git worktree add`) na branch da entrega; a principal fica em `main`, sem ID. */
  function comWorktree(plano, extra = {}) {
    const amb = ambiente({ branch: 'main', plano, ...extra });
    const wt = join(amb.dir, '.harness', 'worktrees', 'S1');
    g(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-S1', wt);
    const escrever = (raiz, caminho, texto) => { mkdirSync(dirname(join(raiz, caminho)), { recursive: true }); writeFileSync(join(raiz, caminho), texto); };
    return { amb, wt: realpathSync(wt), escrever };
  }
  const painelEstado = (amb, cwd) => {
    const r = spawnSync(process.execPath, [PAINEL, 'estado'], { cwd, encoding: 'utf8', env: amb.env, input: '' });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    assert.equal(j?.ok, true, `painel estado: ${r.stdout}${r.stderr}`);
    return j;
  };
  const shaDoMedir = async (amb, cwd) => {
    const { medir } = await import('../scripts/painel-medir.mjs');
    const rodar = (cmd, args, o) => (cmd === 'git' ? spawnSync('git', args, { cwd: o.cwd, encoding: 'utf8' }) : { status: 1, stdout: '', stderr: 'sem gh' });
    medir(cwd, { rodar, agentes: { session_id: 'S-medir', agentes: [] }, agora: () => Date.parse('2026-11-12T20:00:00Z') });
    return amb.eventos().filter((e) => e.tipo === 'fato.medido' && e.dados.chave === 'spec').map((e) => [e.dados.valor.caminho, e.dados.valor.sha256]);
  };

  const TODO_PAINEL = 'painel.mjs:328 lê da raiz principal, correção na T18 (depende da T38)';

  test('spec-na-worktree-da-sessao-com-plano: aprovarSpec, lerSpecs e medir dão o MESMO sha da spec da worktree; diário só na principal', async () => {
    const { aprovarSpec, lerSpecs } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A });
    escrever(wt, SPEC_A, TEXTO_WT);
    escrever(amb.dir, SPEC_A, TEXTO_PRINCIPAL); // a principal tem OUTRA versão: ler dela daria outro sha
    const r = aprovarSpec(wt, 'S-dono');
    assert.deepEqual(r, { ok: true, spec: SPEC_A, sha256: sha(TEXTO_WT), entrega: 'GM-10' });
    const a = amb.eventos().filter((e) => e.tipo === 'spec.aprovada');
    assert.deepEqual(a.map((e) => e.dados), [{ spec: SPEC_A, sha256: sha(TEXTO_WT) }], 'no diário da principal');
    assert.equal(existsSync(join(wt, '.harness', 'entregas')), false, 'a worktree não ganhou diário');
    // lerSpecs do checkout da sessão: o mesmo sha
    assert.deepEqual(lerSpecs(wt).map((s) => [s.caminho, s.sha256]), [[SPEC_A, sha(TEXTO_WT)]]);
    // medir (painel-medir) lê o mesmo arquivo do mesmo checkout: mesmo sha
    assert.deepEqual(await shaDoMedir(amb, wt), [[SPEC_A, sha(TEXTO_WT)]]);
    // garantias intactas com plano: 2ª vez ⇒ ja_aprovada; mudança entre o hash e o append ⇒ spec_mudou
    assert.equal(aprovarSpec(wt, 'S-dono').erro, 'ja_aprovada');
    escrever(wt, SPEC_A, `${TEXTO_WT}mais\n`);
    const mudou = aprovarSpec(wt, 'S-dono', { antes: () => escrever(wt, SPEC_A, `${TEXTO_WT}outra\n`) });
    assert.equal(mudou.erro, 'spec_mudou', JSON.stringify(mudou));
    assert.equal(amb.eventos().filter((e) => e.tipo === 'spec.aprovada').length, 1);
  });

  test('spec-na-worktree-da-sessao-com-plano-painel: o painel estado da sessão vê a aprovação do sha da worktree', { todo: TODO_PAINEL }, async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A });
    escrever(wt, SPEC_A, TEXTO_WT);
    escrever(amb.dir, SPEC_A, TEXTO_PRINCIPAL);
    assert.equal(aprovarSpec(wt, 'S-dono').ok, true);
    const depois = painelEstado(amb, wt);
    assert.equal(JSON.stringify(depois.estado).includes(AGUARDANDO), false, JSON.stringify(depois.estado));
  });

  test('req-na-spec-le-do-checkout-da-sessao: REQ só na spec da worktree ⇒ proposta aceita; REQ só na da principal ⇒ req_desconhecido (T38, DP-3 aj. 4)', () => {
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A });
    escrever(wt, SPEC_A, `${TEXTO_WT}\n**REQ-ZZ-1** só na worktree.\n`);
    escrever(amb.dir, SPEC_A, `${TEXTO_PRINCIPAL}\n**REQ-YY-1** só na principal.\n`);
    const doWt = amb.cli(proporArgs(amb, { req: 'REQ-ZZ-1' }), { cwd: wt });
    assert.equal(doWt.rc, 0, doWt.out + doWt.err);
    assert.equal(emendasDoDiario(amb).filter((e) => e.tipo === 'emenda.proposta').length, 1, 'gravou na principal');
    const daPrincipal = amb.cli(proporArgs(amb, { req: 'REQ-YY-1' }), { cwd: wt });
    assert.notEqual(daPrincipal.rc, 0, daPrincipal.out);
    assert.equal(daPrincipal.j?.erro, 'req_desconhecido', daPrincipal.out + daPrincipal.err);
    assert.equal(emendasDoDiario(amb).filter((e) => e.tipo === 'emenda.proposta').length, 1, 'nada gravado na recusa');
  });

  test('registro-sha-do-checkout-da-sessao: `registro` rodado de dentro da worktree grava o sha da spec da WORKTREE, não o da principal (T38, DP-3 aj. 4)', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree({ ...PLANO_PADRAO, spec: SPEC_A }, { gitignore: false }); // o registro se commita: o diário não pode estar ignorado
    escrever(wt, SPEC_A, TEXTO_WT);
    escrever(amb.dir, SPEC_A, TEXTO_PRINCIPAL);
    assert.equal(aprovarSpec(wt, 'S-dono').ok, true); // aprova o sha da worktree: o registro tem de CONFERIR com ele
    const r = amb.cli(['registro'], { cwd: wt });
    assert.equal(r.rc, 0, r.out + r.err);
    const t = readFileSync(join(amb.entregas, 'registro.md'), 'utf8');
    assert.ok(t.includes(`sha256 atual da spec: ${sha(TEXTO_WT)} (confere com a última aprovação)`), t);
    assert.equal(t.includes(sha(TEXTO_PRINCIPAL)), false, 'o sha da principal não entra');
  });

  test('plano-spec-diferente-da-aprovada: aprovada sem plano (a.md) e o plano nasce com b.md ⇒ b.md falta aprovar (aprovarSpec grava, nunca ja_aprovada); com a.md ⇒ ja_aprovada', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const textoB = '# GM-10 b\n\nsem cabeçalho de PBI, outro texto\n';
    const { amb, wt, escrever } = comWorktree(null);
    escrever(wt, SPEC_A, TEXTO_WT);
    assert.deepEqual(aprovarSpec(wt, 'S-dono'), { ok: true, spec: SPEC_A, sha256: sha(TEXTO_WT), entrega: 'GM-10' });
    escrever(wt, SPEC_B, textoB);
    // plano com a.md: o mesmo arquivo aprovado não se aprova de novo
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_A }));
    assert.equal(aprovarSpec(wt, 'S-dono').erro, 'ja_aprovada');
    // plano com b.md: não herda o ✓ de a.md; a aprovação grava o sha de b.md
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_B }));
    assert.deepEqual(aprovarSpec(wt, 'S-dono'), { ok: true, spec: SPEC_B, sha256: sha(textoB), entrega: 'GM-10' });
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'spec.aprovada').map((e) => e.dados), [
      { spec: SPEC_A, sha256: sha(TEXTO_WT) }, { spec: SPEC_B, sha256: sha(textoB) },
    ]);
  });

  test('plano-spec-diferente-da-aprovada-painel: o painel mostra b.md aguardando aprovação; com a.md não', { todo: TODO_PAINEL }, async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, wt, escrever } = comWorktree(null);
    escrever(wt, SPEC_A, TEXTO_WT);
    assert.equal(aprovarSpec(wt, 'S-dono').ok, true);
    escrever(wt, SPEC_B, '# GM-10 b\n\noutro texto\n');
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_B }));
    assert.ok(JSON.stringify(painelEstado(amb, wt).estado).includes(AGUARDANDO));
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_PADRAO, spec: SPEC_A }));
    assert.equal(JSON.stringify(painelEstado(amb, wt).estado).includes(AGUARDANDO), false);
  });
});


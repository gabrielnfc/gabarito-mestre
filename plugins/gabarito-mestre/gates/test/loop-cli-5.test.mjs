// GM-19 T1: parte 5 de loop-cli.test.mjs, dividida por faixa de linha sem mudar nenhum teste.
// O corpo e o de bfa322ad por faixa; ver REQ-SEG-1 da spec da GM-19.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contexto, liberarTeto } from '../scripts/loop.mjs';
import { trilhaDe } from '../dist/trilha.js';
import { estadoDe as estadoNucleo, ordenar as ordenarNucleo } from '../dist/loop.js';
import { coberturaDoOrquestrador } from '../dist/painel-equipe.js';
import * as diario from '../dist/diario.js';
import { g, AQUI, GITIGNORE_RAIZ, VERSAO_PLUGIN, CONFIG_PADRAO, planoDe, PLANO_PADRAO, ambiente, PLANO_REQ, IMPL_E, APROVA_E, INTEGRA_E, PROPOSTA, relogioDe, escreve, grava, bytesDoDiario, ambReq, comOrigin, proporArgs } from './_loop-cli-helpers.mjs';
// --- corpo movido ---
describe('GM-14 T34: pouso é regra do produto (FIEL-14 a, b, c, e, f)', () => {
  const PAINEL_CLI = join(AQUI, '..', 'scripts', 'painel.mjs');
  const CONTEXTO = (amb, sessao) => join(amb.dir, '.harness', 'contexto', `${sessao}.json`);
  const gravarCtx = (amb, sessao, obj, texto = null) => {
    mkdirSync(join(amb.dir, '.harness', 'contexto'), { recursive: true });
    writeFileSync(CONTEXTO(amb, sessao), texto ?? JSON.stringify(obj));
  };
  const agora = (deslocMs = 0) => new Date(Date.now() + deslocMs).toISOString();
  /** Evento de OUTRA sessão com `ts` posterior ao último do diário (o clear/startup do `SessionStart`). */
  const inicioDe = (amb, sessao, origem) => {
    const ultimo = Math.max(...amb.eventos().map((e) => Date.parse(e.ts)));
    const ts = new Date(ultimo + 5000).toISOString();
    const r = diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo: 'sessao.inicio', dados: { origem } });
    assert.ok(r.ok, JSON.stringify(r));
  };
  const painel = (amb) => {
    const r = spawnSync(process.execPath, [PAINEL_CLI, 'estado'], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    return JSON.stringify(j.estado.depende ?? []);
  };
  const ONBOARDING = { ...CONFIG_PADRAO, fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } }; // repo com onboarding: a FIEL-14 (e) vale inteira
  const plano1 = (config = ONBOARDING) => ambiente({ config, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });

  test('pousar-a-partir-de-x-com-contexto-da-sessao: 55 % da sessão S1 ⇒ proxima --sessao S1 devolve pousar e mostra o percent', () => {
    const amb = plano1();
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'pousar');
    assert.equal(r.j.sinais.percent, 55);
    // abaixo de x: despacha
    gravarCtx(amb, 'S1', { percent: 20, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar');
  });

  test('contexto-de-outra-sessao-nao-conta: o arquivo da S2 não pousa a S1; sem --sessao o percent é nulo', () => {
    const amb = plano1();
    gravarCtx(amb, 'S2', { percent: 90, fonte: 'mod', em: agora() });
    const a = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(a.j.sinais.percent, null);
    assert.equal(a.j.acao.tipo, 'despachar');
    const b = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(b.j.sinais.percent, null);
    assert.equal(b.j.acao.tipo, 'despachar');
  });

  test('contexto-velho-ou-corrompido-e-nulo: > 120 s, futuro, JSON torto, percent fora da forma, em ausente ⇒ nulo e despacha', () => {
    const amb = plano1();
    const ruins = [
      [{ percent: 90, fonte: 'mod', em: agora(-121_000) }, null],
      [{ percent: 90, fonte: 'mod', em: agora(60_000) }, null],
      [null, '{nao é json'],
      [{ percent: '90', fonte: 'mod', em: agora() }, null],
      [{ percent: 150, fonte: 'mod', em: agora() }, null],
      [{ percent: 90, fonte: 'mod' }, null],
      [{ percent: 90, fonte: 'mod', em: 'ontem' }, null],
      [[90], null],
    ];
    for (const [obj, texto] of ruins) {
      gravarCtx(amb, 'S1', obj, texto);
      const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
      assert.equal(r.rc, 0, r.out + r.err);
      assert.equal(r.j.sinais.percent, null, JSON.stringify(obj ?? texto));
      assert.equal(r.j.acao.tipo, 'despachar');
    }
    // 120 s exatos ainda vale (controle da fronteira)
    gravarCtx(amb, 'S1', { percent: 90, fonte: 'mod', em: agora(-100_000) });
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'pousar');
  });

  test('contexto-do-mod-chega-ao-proxima (P9): gravarContexto real da T20 grava 55 % e o loop.mjs proxima --sessao real devolve pousar', async () => {
    const { gravarContexto } = await import('../../mod/painel.mjs');
    const amb = plano1();
    const g1 = gravarContexto({ sessao: 'S1', percent: 55, fonte: 'mod', emMs: Date.now() });
    assert.ok(g1);
    const rodou = spawnSync(g1.argv[0], g1.argv.slice(1), { cwd: amb.dir, input: g1.stdin, encoding: 'utf8', env: amb.env });
    assert.equal(rodou.status, 0, rodou.stderr);
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.j.acao.tipo, 'pousar', r.out);
    assert.equal(r.j.sinais.percent, 55);
  });

  test('pousar-grava-sessao-do-claude: --sessao S1 vira o campo sessao do evento; sem --sessao fica "loop"', () => {
    const amb = plano1();
    const r = amb.cli(['pousar', '--sessao', 'S1']);
    assert.equal(r.rc, 0, r.out + r.err);
    const pousos = amb.eventos().filter((e) => e.tipo === 'sessao.pouso');
    assert.deepEqual(pousos.map((e) => e.sessao), ['S1']);
    assert.equal(amb.cli(['pousar']).rc, 0);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'sessao.pouso').map((e) => e.sessao).sort(), ['S1', 'loop']);
  });

  test('pouso-pendente-nao-despacha-nem-revisor, com-vivos-espera, sem-vivos-repete-sem-segunda-retomada: pelo CLI real', () => {
    const amb = plano1();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar', 'controle: sem pouso, o revisor é despachado');
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    // GM-15 T35 (r.12, D-P13): sem leitura de contexto o pouso gravado não é pedido de /clear; o revisor segue (o pendente medido com revisor é o T59 abaixo)
    const sem = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.deepEqual(sem.j.acao.itens?.map((i) => `${i.task} ${i.papel}`), ['T1 revisor'], JSON.stringify(sem.j.acao));
    // a skill repete o pousar (D-W3): novo sessao.pouso, nenhuma sessao.retomada gravada pelo CLI
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const tipos = amb.tipos();
    assert.equal(tipos.filter((t) => t === 'sessao.pouso').length, 2);
    assert.equal(tipos.filter((t) => t === 'sessao.retomada').length, 0);
  });

  test('T59-impasse-revisor-pendente (emenda 67), pelo CLI real: veredito de T1, pouso, T1 integrada, T2 concluída (revisor pendente) e a sessão em 61 % ⇒ proxima 0 vivos pousar, com vivos esperar; nunca o revisor', () => {
    const amb = ambiente({ config: ONBOARDING, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }]) });
    amb.aprovar('T1');
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    for (const a of [['abrir', 'T2'], ['iniciar', 'T2', 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
    amb.commitNaWt('T2', 'src/t2.txt');
    assert.equal(amb.cli(['concluir', 'T2']).rc, 0);
    gravarCtx(amb, 'S1', { percent: 61, fonte: 'mod', em: agora() });
    const sem = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(sem.rc, 0, sem.out + sem.err);
    assert.deepEqual(sem.j.acao, { tipo: 'pousar' });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '1']).j.acao, { tipo: 'esperar', motivo: 'pouso_pendente' });
    // controle: a sessão nova (abaixo de X) já pode despachar o revisor
    gravarCtx(amb, 'S1', { percent: 5, fonte: 'mod', em: agora() });
    inicioDe(amb, 'S2', 'clear');
    const nova = amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao;
    assert.equal(nova.tipo, 'despachar');
    assert.deepEqual(nova.itens.map((i) => `${i.task} ${i.papel}`), ['T2 revisor']);
  });

  test('pouso-atravessa-cli-proxima-depende-painel (P9): pousar S1 ⇒ proxima sem despacho ⇒ painel real com "limpar a conversa" ⇒ clear de S2 tira ⇒ despacha; startup de S2 não tira', () => {
    // GM-15 T35 (r.12, D-P13): o pedido de /clear é medido (fronteira + leitura própria da sessão)
    const amb = plano1();
    amb.aprovar('T1');
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
    inicioDe(amb, 'S2', 'startup');
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
    inicioDe(amb, 'S2', 'clear');
    gravarCtx(amb, 'S2', { percent: 5, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao, { tipo: 'integrar', tasks: ['T1'] });
    assert.doesNotMatch(painelDa(amb, 'S2'), /limpar a conversa/);
  });

  const semConfig = (amb) => { spawnSync('rm', [join(amb.dir, 'harness.config.json')]); return amb; }; // sem config em lugar nenhum (a guarda vê onboarding em qualquer config válida)
  test('proxima-sem-onboarding-nao-trava-pelo-pouso (FIEL-14 h; GM-15 T23, critério da guarda): sem config o pouso gravado não trava proxima nem o painel; com onboarding trava (controle)', () => {
    const amb = semConfig(plano1());
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'despachar', JSON.stringify(r.j.acao));
    assert.doesNotMatch(painel(amb), /limpar a conversa/);
    // controle (GM-15 T35, r.12): com onboarding, fronteira e a leitura própria em 55 % trava
    const com = plano1();
    com.aprovar('T1');
    gravarCtx(com, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(com.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.deepEqual(com.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(com, 'S1'), /limpar a conversa/);
  });

  test('pouso-onboarding-criterio-da-guarda (FIEL-14 h; GM-15 T23): config só em origin/HEAD (sem a local) ⇒ pendente; sem config em lugar nenhum ⇒ não pendente', () => {
    // GM-15 T35 (r.12, D-P13): o critério de onboarding só valia para a regra sem medição, que deixou de pedir /clear: sem leitura, nem com a
    // config de origin o pouso gravado trava
    const amb = semConfig(plano1());
    comOrigin(amb, ONBOARDING);
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.equal(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar');
    assert.doesNotMatch(painel(amb), /limpar a conversa/);
    const nenhum = semConfig(plano1());
    assert.equal(nenhum.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.equal(nenhum.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao.tipo, 'despachar');
    assert.doesNotMatch(painel(nenhum), /limpar a conversa/);
  });

  test('pouso-onboarding-criterio-unico: loop.mjs e painel.mjs importam temOnboarding de cartao-sessao.mjs e não têm critério próprio', () => {
    for (const f of ['loop.mjs', 'painel.mjs']) {
      const fonte = readFileSync(join(AQUI, '..', 'scripts', f), 'utf8');
      assert.match(fonte, /import \{[^}]*\btemOnboarding\b[^}]*\} from '\.\/cartao-sessao\.mjs'/, f);
      assert.doesNotMatch(fonte, /resolvidoEm/, `${f} não pode ler o critério de onboarding por conta própria`);
    }
  });

  // GM-15 T35 (D-G11 b, e)
  const respostaDoDono = (amb, pergunta, rotulo) => {
    const ultimo = Math.max(...amb.eventos().map((e) => Date.parse(e.ts)));
    const r = diario.append(amb.entregas, 'dono', { ts: new Date(ultimo + 1000).toISOString(), autor: 't@t', sessao: 'dono', agente: 'orquestrador', tipo: 'dono.resposta', dados: { pergunta, rotulo } }); // forma do adiamento (formas.ts)
    assert.ok(r.ok, JSON.stringify(r));
  };
  const painelDa = (amb, sessao) => {
    const r = spawnSync(process.execPath, [PAINEL_CLI, 'estado', '--sessao', sessao], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    return JSON.stringify(j.estado.depende ?? []);
  };
  test('sem-medicao-nao-pede-pouso (r.12, D-P13), pelo CLI real: pouso gravado com onboarding e SEM leitura de contexto ⇒ proxima despacha e o painel não pede limpar', () => {
    const amb = plano1();
    amb.aprovar('T1'); // a fronteira (review.veredito) que o pouso exige
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.sinais.percent, null);
    assert.deepEqual(r.j.acao, { tipo: 'integrar', tasks: ['T1'] });
    assert.doesNotMatch(painel(amb), /limpar a conversa/);
    // controle: medida em 55 % (teto 50) a mesma sessão pousa e o painel dela pede limpar
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
  });

  test('clear-agora-nao-no-teto-nao-solta-o-loop (r.9, C4): "agora não" no teto tira o pedido do painel, mas proxima segue em esperar (nunca despacha nem integra); +10 p.p. volta a pousar', () => {
    const amb = plano1();
    amb.aprovar('T1');
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    assert.match(painelDa(amb, 'S1'), /agora não \(loop parado\)/);
    const pouso = amb.eventos().filter((e) => e.tipo === 'sessao.pouso').pop();
    respostaDoDono(amb, `${pouso.sessao}:${pouso.seq}`, 'agora não (loop parado, contexto em 55 %)');
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'pouso_adiado' });
    assert.doesNotMatch(painelDa(amb, 'S1'), /limpar a conversa/);
    gravarCtx(amb, 'S1', { percent: 65, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
  });

  test('clear-agora-nao-no-teto-nao-despacha-revisor (r.9, C4; review r1 MAJOR-1): adiado no teto com task concluída à espera do revisor ⇒ proxima espera, nunca despacha o revisor', () => {
    const amb = ambiente({ config: ONBOARDING, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }]) });
    amb.aprovar('T1');
    for (const a of [['abrir', 'T2'], ['iniciar', 'T2', 'implementador']]) assert.equal(amb.cli(a).rc, 0, a.join(' '));
    amb.commitNaWt('T2', 'src/t2.txt');
    assert.equal(amb.cli(['concluir', 'T2']).rc, 0);
    gravarCtx(amb, 'S1', { percent: 55, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0);
    const pouso = amb.eventos().filter((e) => e.tipo === 'sessao.pouso').pop();
    respostaDoDono(amb, `${pouso.sessao}:${pouso.seq}`, 'agora não (loop parado, contexto em 55 %)');
    const r = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'pouso_adiado' });
    // controle: sem o pedido (leitura baixa) o mesmo diário despacha o revisor da T2
    gravarCtx(amb, 'S1', { percent: 20, fonte: 'mod', em: agora() });
    const baixa = amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao;
    assert.ok(baixa.tipo === 'integrar' || (baixa.tipo === 'despachar' && baixa.itens.some((i) => i.task === 'T2' && i.papel === 'revisor')), JSON.stringify(baixa));
  });

  test('pousar-manual-nao-consome-com-mod (T53, emenda 52 a; I1 por sessão): o pousar do dono grava o evento mas só a PRÓPRIA leitura da sessão decide; nenhuma outra a libera ou prende', () => {
    const amb = plano1();
    amb.aprovar('T1'); // GM-15 T35 (r.12): o pedido medido exige a fronteira
    gravarCtx(amb, 'S1', { percent: 61, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['pousar', '--sessao', 'S1']).rc, 0); // grava, não recusa (a skill sem mod o usa)
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    assert.match(painelDa(amb, 'S1'), /limpar a conversa/);
    // a S2 (sessão paralela ou nova), baixa, decide pela PRÓPRIA leitura: despacha; a S1 segue pendente
    gravarCtx(amb, 'S2', { percent: 20, fonte: 'mod', em: agora() });
    assert.equal(amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao.tipo, 'integrar');
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S1', '--vivos', '0']).j.acao, { tipo: 'pousar' });
    // leitura que não vale (fonte transcript) não é leitura própria: percent nulo e, desde a GM-15 T35 (r.12, D-P13), sem pedido de /clear
    gravarCtx(amb, 'S3', { percent: 20, fonte: 'transcript', em: agora() });
    assert.equal(amb.cli(['proxima', '--sessao', 'S3', '--vivos', '0']).j.acao.tipo, 'integrar');
    // o /clear do dono (sessao.inicio) com a leitura da S2 alta: só a S2 decide por si, e alta ela pousa
    inicioDe(amb, 'S2', 'clear');
    gravarCtx(amb, 'S2', { percent: 61, fonte: 'mod', em: agora() });
    assert.deepEqual(amb.cli(['proxima', '--sessao', 'S2', '--vivos', '0']).j.acao, { tipo: 'pousar' });
  });

  test('ponte-real-ler-devolve-agora (T53): a ponte que o mod executa devolve `agora` (a hora do node que escreve o ts do diário); a ponte `contexto` não existe mais', async () => {
    const { codigoPonte } = await import('../dist/pouso.js');
    const { pathToFileURL } = await import('node:url');
    const amb = plano1();
    const url = pathToFileURL(join(AQUI, '..', 'dist', 'diario.js')).href;
    const rodar = (pedido) => spawnSync(process.execPath, ['--input-type=module', '-e', codigoPonte(url)], { cwd: amb.dir, input: JSON.stringify(pedido), encoding: 'utf8' });
    const antes = Date.now();
    const j = JSON.parse(rodar({ op: 'ler', dir: amb.entregas, cwd: amb.dir }).stdout);
    assert.equal(j.ok, true);
    assert.ok(Array.isArray(j.eventos));
    assert.ok(j.agora >= antes && j.agora <= Date.now(), `agora fora da hora de parede: ${j.agora}`);
    const k = JSON.parse(rodar({ op: 'contexto', cwd: amb.dir, raiz: amb.dir, sessoes: ['S1'] }).stdout);
    assert.equal(k.ok, false); // nenhuma sessão lê o contexto de outra pela ponte
  });

  test('instalar-ignora-contexto: o .gitignore da raiz ignora .harness/contexto/', () => {
    const linhas = readFileSync(GITIGNORE_RAIZ, 'utf8').split('\n').map((l) => l.trim());
    assert.ok(linhas.includes('.harness/contexto/'));
  });
});

// ─────────────────────────────────────────────────────────────── T48 (emenda 43, FIEL-1 b/c, asserção 8): entrega publicada não recebe sessao.*, task.*, loop.parar

describe('entrega publicada: nada de sessao.*, guarda.*, task.* nem loop.parar (T48)', () => {
  const PR = (numero, estado) => ['fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'enabler/GM-10-loop' } }];
  // GM-21 DT1: "publicada" = PR mergeado E plano sem task aberta; os testes desta suíte (T48) são sobre as CONSEQUÊNCIAS de publicada, então o plano que simulam é o fechado (`tasks: []`).
  // O critério com task aberta tem os casos próprios (`publicada-nao-com-plano-aberto`, `regra-unica`).
  const planoFechado = (amb) => writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify(planoDe([])));
  const publicar = (amb) => { planoFechado(amb); amb.semear([PR(7, 'mergeado')]); };
  const PLUGIN_RAIZ = join(AQUI, '..', '..');
  const configOnboarding = { ...CONFIG_PADRAO, fluxo: { resolvidoEm: '2026-11-13T00:00:00Z' } };
  const semId = (amb) => join(amb.dir, '.harness', 'entregas', '_sem-id');
  const tiposDe = (dir) => (existsSync(dir) ? diario.ler(dir).map((e) => e.tipo) : []);

  test('publicada-nao-recebe-loop.parar: parar recusa com entrega_publicada e nada é gravado', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'entrega_publicada');
    assert.equal(amb.eventos().length, antes);
    assert.deepEqual(tiposDe(semId(amb)), []);
  });

  test('publicada-nao-recebe-task.iniciada: iniciar recusa com entrega_publicada', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['iniciar', 'T1', 'implementador']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-recebe-task.concluida: concluir recusa com entrega_publicada', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['concluir', 'T1']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-recebe-review.veredito e task.integrada: veredito e integrar recusam com entrega_publicada', async () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    publicar(amb);
    const antes = amb.eventos().length;
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).j?.erro, 'entrega_publicada');
    assert.equal(amb.eventos().length, antes);
    const integ = amb.cli(['integrar', 'T1']);
    assert.equal(integ.j?.erro, 'entrega_publicada', integ.out + integ.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-recebe-sessao.pouso: pousar recusa com entrega_publicada', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['pousar', '--sessao', 'S1']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('publicada-nao-com-plano-aberto (GM-21 T1, REQ-ENC-1, P9): PR do plano mergeado e T2 aberta ⇒ iniciar T2 não recusa com entrega_publicada e grava; plano fechado (T2 cortada) ⇒ recusa', () => {
    const amb = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }]) });
    // T1 integrada pelo ciclo real do loop; T2 só aberta (worktree), o PR do plano (#10, via titulo, base main) já mergeado depois da integração
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    assert.equal(amb.cli(['concluir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    assert.equal(amb.cli(['integrar', 'T1']).rc, 0);
    assert.equal(amb.cli(['abrir', 'T2']).rc, 0);
    const pr10 = ['fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero: 10, estado: 'mergeado', branch: 'docs/GM-10-plano', base: 'main', via: 'titulo' } }];
    amb.semear([pr10]);
    // o diário relido: nenhum entrega.encerrada e a regra única (a da trilha) não dá a entrega por publicada
    assert.equal(amb.tipos().includes('entrega.encerrada'), false);
    const r = amb.cli(['iniciar', 'T2', 'implementador']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.notEqual(r.j?.erro, 'entrega_publicada');
    assert.ok(amb.tipos().filter((t) => t === 'task.iniciada').length >= 2, 'a task.iniciada de T2 foi gravada');
    // controle (troca de valor): com T2 cortada o mesmo PR publica e o loop recusa
    const amb2 = ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', deps: [], arquivos: ['src/t2.txt'] }]) });
    amb2.semear([['task.fora', { task: 'T1', como: 'cortada', motivo: 'fora do corte', origem: 'dono' }], ['task.fora', { task: 'T2', como: 'cortada', motivo: 'fora do corte', origem: 'dono' }], pr10]);
    assert.equal(amb2.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  test('identificada-continua-gravando (vizinho): sem PR medido, ou com PR aberto depois do mergeado, parar, iniciar e pousar gravam', () => {
    for (const prs of [[], [PR(7, 'mergeado'), PR(8, 'aberto')]]) {
      const amb = ambiente();
      if (prs.length > 0) amb.semear(prs);
      const pouso = amb.cli(['pousar']); // só na fronteira: antes de qualquer task em voo
      assert.equal(pouso.rc, 0, pouso.out + pouso.err);
      assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
      assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0, JSON.stringify(prs));
      assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
      assert.deepEqual(amb.tipos().filter((t) => t === 'task.iniciada' || t === 'sessao.pouso' || t === 'loop.parar'), ['sessao.pouso', 'task.iniciada', 'loop.parar']);
    }
  });

  test('identificada-continua-gravando (vizinho): PR mergeado sem 2º fato (sem plano.json) não é publicada; parar grava', () => {
    const amb = ambiente({ plano: null });
    amb.semear([PR(7, 'mergeado')]);
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
    assert.ok(amb.tipos().includes('loop.parar'));
  });

  test('publicada-nao-recebe-sessao.inicio: o SessionStart grava sessao.inicio e guarda.heartbeat em _sem-id; a entrega fica intacta', async () => {
    const { montarSaidaHook } = await import('../scripts/cartao-sessao.mjs');
    const amb = ambiente({ config: configOnboarding });
    publicar(amb);
    const antes = amb.eventos().length;
    const r = await montarSaidaHook({ cwd: amb.dir, pluginRoot: PLUGIN_RAIZ, agora: '2026-11-13T12:00:00Z', entradaTexto: JSON.stringify({ session_id: 'SPUB', source: 'startup' }) });
    assert.deepEqual(r.falhas, []);
    assert.equal(amb.eventos().length, antes);
    assert.deepEqual(tiposDe(semId(amb)), ['sessao.inicio', 'guarda.heartbeat']);
  });

  test('identificada-continua-gravando (vizinho): o SessionStart de entrega em curso grava sessao.inicio e guarda.heartbeat na entrega', async () => {
    const { montarSaidaHook } = await import('../scripts/cartao-sessao.mjs');
    const amb = ambiente({ config: configOnboarding });
    const antes = amb.eventos().length;
    const r = await montarSaidaHook({ cwd: amb.dir, pluginRoot: PLUGIN_RAIZ, agora: '2026-11-13T12:00:00Z', entradaTexto: JSON.stringify({ session_id: 'SCUR', source: 'startup' }) });
    assert.deepEqual(r.falhas, []);
    assert.deepEqual(amb.tipos().slice(antes), ['sessao.inicio', 'guarda.heartbeat']);
    assert.deepEqual(tiposDe(semId(amb)), []);
  });

  test('publicada-nao-abre-fifo-nem-symlink: events.*.jsonl que não é arquivo regular ⇒ false, sem travar a leitura', () => {
    const amb = ambiente();
    publicar(amb);
    const fifo = join(amb.entregas, 'events.fifo.jsonl');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { entregaPublicada } from ${JSON.stringify(join(AQUI, '..', 'dist', 'guarda.js'))}; process.stdout.write(String(entregaPublicada(${JSON.stringify(amb.dir)}, 'GM-10', null)));`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 0, `travou ou falhou: ${r.signal ?? ''} ${r.stderr}`);
    assert.equal(r.stdout, 'false');
    rmSync(fifo);
    symlinkSync('/etc/hosts', join(amb.entregas, 'events.link.jsonl'));
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', `import { entregaPublicada } from ${JSON.stringify(join(AQUI, '..', 'dist', 'guarda.js'))}; process.stdout.write(String(entregaPublicada(${JSON.stringify(amb.dir)}, 'GM-10', null)));`], { encoding: 'utf8', timeout: 5000 }).stdout, 'false');
  });

  /** O dono respondeu à pergunta (b) da conversa `sessao`: o 1º `fato.medido` dela é a âncora; `dono.resposta` liga a entrega (FIEL-1 b, REQ-TRI-1). */
  const ligarPeloDono = (amb, sessao, rotulo = 'GM-10') => {
    const w = (tipo, dados, ts) => assert.equal(diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados }).ok, true);
    w('fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-10-loop' } }, '2026-11-13T10:00:00.000Z');
    const ancora = `${sessao}:${diario.ler(amb.entregas).find((e) => e.sessao === sessao).seq}`;
    w('dono.resposta', { pergunta: ancora, opcao: 1, rotulo }, '2026-11-13T10:00:01.000Z');
  };

  test('ligada-pelo-dono-loop-nao-trava (MAJOR-1, spec:90): depois de dono.resposta, parar/iniciar/concluir/veredito/integrar gravam sem --sessao; sessão não ligada segue recusada', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['abrir', 'T1']).rc, 0);
    assert.equal(amb.cli(['iniciar', 'T1', 'implementador']).rc, 0);
    amb.commitNaWt('T1', 'src/t1.txt');
    const planoAberto = readFileSync(join(amb.entregas, 'plano.json'), 'utf8');
    publicar(amb);
    assert.equal(amb.cli(['concluir', 'T1']).j?.erro, 'entrega_publicada', 'controle: sem ligação, publicada');
    writeFileSync(join(amb.entregas, 'plano.json'), planoAberto); // o dono religa a sessão: o loop volta a ver as tasks (a ligação é o que o destrava)
    ligarPeloDono(amb, 'SDONO');
    const r1 = amb.cli(['concluir', 'T1']);
    assert.equal(r1.rc, 0, r1.out + r1.err);
    assert.equal(amb.cli(['iniciar', 'T1', 'revisor']).rc, 0);
    assert.equal(amb.cli(['veredito', 'T1', 'APROVADO', '1', '0', '0']).rc, 0);
    const integ = amb.cli(['integrar', 'T1']);
    assert.equal(integ.rc, 0, integ.out + integ.err);
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
    assert.equal(amb.cli(['parar', 'nao_conseguiu', '--sessao', 'SDONO']).rc, 0);
    assert.ok(amb.tipos().includes('task.integrada'));
    // vizinho perigoso: sessão EXPLÍCITA que o dono não ligou continua recusada (o filtro que libera não fura a guarda); T2 e T3 saem do plano para ele voltar a ser fechado
    planoFechado(amb);
    assert.equal(amb.cli(['parar', 'nao_conseguiu', '--sessao', 'OUTRA']).j?.erro, 'entrega_publicada');
    // vizinho perigoso: a resposta do dono liga OUTRA entrega ⇒ esta segue publicada
    const amb2 = ambiente();
    publicar(amb2);
    ligarPeloDono(amb2, 'SDONO', 'GM-77');
    assert.equal(amb2.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  /** Grava um `fato.medido pr` com `ts` explícito, na sessão `sessao` (a medição por outra conversa). */
  const medirPR = (amb, sessao, numero, estado, ts) => assert.equal(diario.append(amb.entregas, sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'enabler/GM-10-loop' } } }).ok, true);

  test('ligada-sobrevive-a-remedicao (MAJOR-1 r1, caso J): outra sessão medindo de novo o MESMO PR mergeado não derruba a ligação; PR NOVO mergeado sim', () => {
    const amb = ambiente();
    publicar(amb);
    ligarPeloDono(amb, 'S1');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0, 'controle: ligada');
    medirPR(amb, 'S2', 7, 'mergeado', '2026-11-13T11:00:00.000Z');
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 0, `re-medição do mesmo PR derrubou a ligação: ${r.out}${r.err}`);
    medirPR(amb, 'S3', 7, 'mergeado', '2026-11-13T11:30:00.000Z');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).rc, 0);
    // PR NOVO mergeado depois da ligação ⇒ republicação: exige nova resposta do dono
    medirPR(amb, 'S2', 8, 'mergeado', '2026-11-13T12:00:00.000Z');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
    // e a re-medição do #8 por outra sessão não o "renova"
    medirPR(amb, 'S3', 8, 'mergeado', '2026-11-13T13:00:00.000Z');
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  test('ligada-pr-nao-mergeado-nao-move-o-corte (MINOR-1 r1): fato.medido pr NÃO mergeado (fechado sem merge) posterior à ligação não derruba a ligação', () => {
    const amb = ambiente();
    publicar(amb);
    ligarPeloDono(amb, 'S1');
    // 'fechado' de número menor: a trilha segue "publicada" (último = #7 mergeado, nenhum aberto), então só o corte distingue
    medirPR(amb, 'S2', 6, 'fechado', '2026-11-13T11:00:00.000Z');
    const r = amb.cli(['parar', 'nao_conseguiu']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(amb.cli(['parar', 'nao_conseguiu', '--sessao', 'OUTRA']).j?.erro, 'entrega_publicada', 'controle: publicada de fato');
  });

  test('ligada-ts-empatado (MINOR-2 r1): resposta do dono com o MESMO ts do merge não é posterior ⇒ recusa', () => {
    const amb = ambiente();
    planoFechado(amb);
    ligarPeloDono(amb, 'S1');
    medirPR(amb, 'S2', 7, 'mergeado', '2026-11-13T10:00:01.000Z');
    amb.fechar();
    assert.equal(amb.cli(['parar', 'nao_conseguiu']).j?.erro, 'entrega_publicada');
  });

  test('liberarTeto-recusa-em-publicada (MINOR-1): a liberação do dono não grava em entrega publicada', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = liberarTeto(amb.dir, 'T1', 'S-dono');
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'entrega_publicada', JSON.stringify(r));
    assert.equal(amb.eventos().length, antes);
    assert.deepEqual(tiposDe(semId(amb)), []);
  });

  test('liberar-sombra-recusa-em-publicada (MINOR-1): liberar --origem sombra recusa antes de qualquer leitura da decisão e nada é gravado', () => {
    const amb = ambiente();
    publicar(amb);
    const antes = amb.eventos().length;
    const r = amb.cli(['liberar', 'T1', '--origem', 'sombra', '--hash', 'abcdef123456']);
    assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    assert.equal(amb.eventos().length, antes);
  });

  test('encerrada-ligada-pelo-dono-loop-recusa (GM-15 T3, REQ-ENT-1 c): entrega.encerrada + dono.resposta ⇒ sem --sessao e com --sessao da ligada, parar recusa e nada é gravado', () => {
    const amb = ambiente();
    amb.semear([['entrega.encerrada', { entrega: 'GM-10', pr: 7, via: 'head', mergeado_em: '2026-11-13T09:00:00.000Z' }]]);
    ligarPeloDono(amb, 'SDONO');
    const antes = amb.eventos().length;
    for (const extra of [[], ['--sessao', 'SDONO']]) {
      const r = amb.cli(['parar', 'nao_conseguiu', ...extra]);
      assert.equal(r.rc, 1, r.out + r.err);
      assert.equal(r.j?.erro, 'entrega_publicada', r.out + r.err);
    }
    assert.equal(amb.eventos().length, antes);
  });

  test('regra-unica: entregaPublicada é a trilha (os 7 casos da trilha; os gravadores não têm critério próprio', async () => {
    const { entregaPublicada } = await import('../dist/guarda.js');
    const casos = [
      ['mergeado+plano', [PR(7, 'mergeado')], true, true],
      ['sem PR+plano', [], true, false],
      ['mergeado e aberto', [PR(7, 'mergeado'), PR(8, 'aberto')], true, false],
      ['aberto e depois mergeado 8, 7 aberto', [PR(7, 'aberto'), PR(8, 'mergeado')], true, false],
      ['dois mergeados', [PR(7, 'mergeado'), PR(8, 'mergeado')], true, true],
      ['mergeado sem 2º fato', [PR(7, 'mergeado')], false, false],
      ['fechado', [PR(7, 'fechado')], true, false],
    ];
    for (const [nome, prs, plano, esperado] of casos) {
      const amb = ambiente({ plano: plano ? planoDe([]) : null });
      if (prs.length > 0) amb.semear(prs);
      assert.equal(entregaPublicada(amb.dir, 'GM-10', null), esperado, nome);
    }
    // o diário que liga a sessão por `dono.resposta` tira a entrega de "publicada" (REQ-TRI-1), como na trilha
    const amb = ambiente();
    planoFechado(amb);
    amb.semear([PR(7, 'mergeado')]);
    assert.equal(entregaPublicada(amb.dir, 'GM-10', 'S1'), true);
    assert.equal(entregaPublicada(amb.dir, 'GM-99', 'S1'), false, 'entrega sem diário não é publicada');
    assert.equal(entregaPublicada(amb.dir, '../x', 'S1'), false, 'id fora da forma não é publicada');
    // nenhum gravador carrega critério próprio: a consulta é a função única de dist/guarda.js
    for (const arq of ['loop.mjs', 'stop-loop.mjs', 'cartao-sessao.mjs']) {
      const fonte = readFileSync(join(AQUI, '..', 'scripts', arq), 'utf8');
      assert.match(fonte, /entregaPublicada\(/, arq);
      assert.doesNotMatch(fonte, /trilhaDe\(|estado === 'mergeado'|estado: 'mergeado'/, `${arq} tem critério próprio de publicada`);
    }
    // o medir não decide "publicada" (decisão do dono, emenda 38: o fato.medido fica na entrega); também não carrega critério próprio
    assert.doesNotMatch(readFileSync(join(AQUI, '..', 'scripts', 'painel-medir.mjs'), 'utf8'), /trilhaDe\(|estado === 'mergeado'|estado: 'mergeado'/, 'painel-medir.mjs tem critério próprio de publicada');
    // o comportamento (não só a fonte) está em painel-medir.test.mjs: a função e o loop.mjs no mesmo diário (spec, ledger, plano, ligação por dono.resposta)
    assert.match(readFileSync(join(AQUI, '..', 'src', 'guarda.ts'), 'utf8'), /export function entregaPublicada/);
  });
});

// ─────────────────────────────────────────────────────────────── GM-14 T54: emenda aplicada no texto da spec (emenda 54)

describe('GM-14 T54: `emenda aplicar <seq>` grava spec.aplicada com os sha do diário e do disco', () => {
  const sha = (t) => createHash('sha256').update(Buffer.from(t)).digest('hex');
  const SPEC = 'docs/spec.md';
  /** Entrega com spec aprovada (A), duas emendas propostas e aprovadas pelo dono (#1 e #2). */
  async function pronto({ aprovadas = [1, 2] } = {}) {
    const { aprovarSpec, julgarEmendaDono } = await import('../scripts/loop.mjs');
    const amb = ambReq();
    const texto0 = readFileSync(join(amb.dir, SPEC), 'utf8');
    assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
    for (let i = 0; i < 2; i++) assert.equal(amb.cli(proporArgs(amb)).rc, 0);
    for (const n of aprovadas) assert.equal(julgarEmendaDono(amb.dir, n, 'aprovar', 'S-dono').ok, true);
    const editar = (texto) => writeFileSync(join(amb.dir, SPEC), texto);
    return { amb, texto0, editar, aplicadas: () => amb.eventos().filter((e) => e.tipo === 'spec.aplicada') };
  }
  const painelAguarda = async (amb) => {
    const { projetarPainel } = await import('../dist/painel.js');
    const plano = JSON.parse(readFileSync(join(amb.entregas, 'plano.json'), 'utf8'));
    const entrada = {
      decisaoEntrega: null, pausado: false, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
      pacote: { nome: 'P', lider: 'L', sabio: 'S', nomes: ['A', 'B', 'C', 'D'] }, notificacao: null, agoraMs: Date.now(), fuso: 'UTC', titulo: null,
      politica: { politica: 'continua', dias: null }, base: 'main', entregaId: 'GM-10', modeloSessao: null, specSha: sha(readFileSync(join(amb.dir, SPEC), 'utf8')),
    };
    return projetarPainel(plano, amb.eventos(), entrada).depende.some((d) => d.motivo === 'spec aguardando aprovação');
  };

  test('aplicada-limpa-depende: aplicar grava {seq, spec, antes, depois}; o painel deixa de pedir aprovação; edição sem emenda segue pedindo', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\nlinha da emenda 1\n`);
    assert.equal(await painelAguarda(amb), true, 'antes de aplicar a edição pede aprovação');
    const r = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(aplicadas().map((e) => e.dados), [{ seq: 1, spec: SPEC, sha256_antes: sha(texto0), sha256_depois: sha(`${texto0}\nlinha da emenda 1\n`) }]);
    assert.equal(r.j.sha256_antes, sha(texto0));
    assert.equal(await painelAguarda(amb), false, 'a cadeia aceita o sha novo');
    // edição fora de emenda aplicada continua pedindo a aprovação do dono
    editar(`${texto0}\nlinha da emenda 1\nedição solta\n`);
    assert.equal(await painelAguarda(amb), true);
  });

  test('aplicar-nenhum-sha-por-argumento: flags de sha são uso (rc 2) e nada é gravado; o sha_depois é o do disco', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\nx\n`);
    const antes = bytesDoDiario(amb);
    for (const flag of ['--sha256', '--sha256-depois', '--sha256_depois', '--sha256_antes', '--sha']) {
      const r = amb.cli(['emenda', 'aplicar', '1', flag, 'f'.repeat(64)]);
      assert.equal(r.rc, 2, `${flag}: ${r.out}`);
      assert.equal(r.j.erro, 'uso');
    }
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    assert.equal(aplicadas()[0].dados.sha256_depois, sha(`${texto0}\nx\n`));
  });

  test('aplicar-sem-aprovada-recusa: sem spec.aprovada, emenda aberta, rejeitada, inexistente ou seq torta recusam sem gravar', async () => {
    const { aprovarSpec, julgarEmendaDono } = await import('../scripts/loop.mjs');
    // sem spec aprovada (emenda aprovada, spec nunca aprovada)
    const sem = ambReq();
    assert.equal(sem.cli(proporArgs(sem)).rc, 0);
    assert.equal(julgarEmendaDono(sem.dir, 1, 'aprovar', 'S-dono').ok, true);
    writeFileSync(join(sem.dir, SPEC), 'outro\n');
    const antesSem = bytesDoDiario(sem);
    const rSem = sem.cli(['emenda', 'aplicar', '1']);
    assert.equal(rSem.rc, 1, rSem.out);
    assert.equal(rSem.j.erro, 'spec_sem_aprovacao');
    assert.deepEqual(bytesDoDiario(sem), antesSem);
    // emenda aberta, rejeitada, inexistente
    const amb = ambReq();
    assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
    assert.equal(amb.cli(proporArgs(amb)).rc, 0); // #1 aberta
    assert.equal(amb.cli(proporArgs(amb)).rc, 0); // #2 rejeitada
    assert.equal(julgarEmendaDono(amb.dir, 2, 'rejeitar', 'S-dono').ok, true);
    writeFileSync(join(amb.dir, SPEC), 'editada\n');
    const antes = bytesDoDiario(amb);
    for (const seq of ['1', '2', '9']) {
      const r = amb.cli(['emenda', 'aplicar', seq]);
      assert.equal(r.rc, 1, `seq ${seq}: ${r.out}`);
      assert.equal(r.j.erro, 'emenda_nao_aprovada', `seq ${seq}`);
    }
    for (const torta of ['0', '-1', 'x', '01', '1.5']) assert.equal(amb.cli(['emenda', 'aplicar', torta]).rc, 1, torta);
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
  });

  test('aplicar-duas-vezes-recusa: a mesma seq só aplica uma vez, mesmo com a spec editada de novo', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\numa\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    editar(`${texto0}\numa\nduas\n`);
    const antes = bytesDoDiario(amb);
    const r = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'ja_aplicada');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(aplicadas().length, 1);
  });

  test('aplicar-arquivo-igual-a-ponta-recusa: spec igual ao último sha aceito não tem o que aplicar; uma edição que cobre duas seqs aplica uma só (a outra recusa)', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    const antes0 = bytesDoDiario(amb);
    const r0 = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r0.j.erro, 'nada_a_aplicar', r0.out);
    assert.deepEqual(bytesDoDiario(amb), antes0);
    // forma declarada: 1 aplicar por seq, cadeia sem ambiguidade; a edição das duas emendas se aplica na 1ª seq, a 2ª fica "nada a aplicar" até outra edição
    editar(`${texto0}\nemenda 1 e emenda 2\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    const r2 = amb.cli(['emenda', 'aplicar', '2']);
    assert.equal(r2.j.erro, 'nada_a_aplicar', r2.out);
    assert.equal(aplicadas().length, 1);
  });

  test('aplicar-encadeia-e-aprovada-nova-reinicia: a #2 parte do sha da #1; uma aprovação nova do dono reinicia a cadeia', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    const { amb, texto0, editar, aplicadas } = await pronto();
    const t1 = `${texto0}\num\n`;
    const t2 = `${t1}\ndois\n`;
    editar(t1);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    editar(t2);
    assert.equal(amb.cli(['emenda', 'aplicar', '2']).rc, 0);
    assert.deepEqual(aplicadas().map((e) => [e.dados.seq, e.dados.sha256_antes, e.dados.sha256_depois]), [[1, sha(texto0), sha(t1)], [2, sha(t1), sha(t2)]]);
    // aprovação nova com edição solta: reinicia a cadeia (a ponta é a nova aprovação)
    const t3 = `${t2}\nsolta\n`;
    editar(t3);
    assert.equal(await painelAguarda(amb), true);
    assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
    assert.equal(await painelAguarda(amb), false);
  });

  test('cadeia-quebrada-recusa: aprovação nova entre a leitura e a gravação (ponta mudou) ⇒ cadeia_quebrada, nada gravado; spec editada no meio ⇒ spec_mudou', async () => {
    const { aplicarEmenda } = await import('../scripts/loop.mjs');
    const { amb, texto0, editar, aplicadas } = await pronto();
    editar(`${texto0}\num\n`);
    const antes = bytesDoDiario(amb);
    const injeta = () => escreve(amb, 'S-dono', 'spec.aprovada', { spec: SPEC, sha256: 'e'.repeat(64) }, new Date(Date.now() + 5000).toISOString());
    const r = aplicarEmenda(amb.dir, 1, { antes: injeta });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.erro, 'cadeia_quebrada');
    assert.equal(aplicadas().length, 0);
    assert.notDeepEqual(bytesDoDiario(amb), antes, 'só a aprovação injetada entrou');
    // spec editada entre o cálculo do sha e a gravação
    const r2 = aplicarEmenda(amb.dir, 1, { antes: () => editar(`${texto0}\noutra coisa\n`) });
    assert.equal(r2.ok, false);
    assert.ok(['spec_mudou', 'cadeia_quebrada'].includes(r2.erro), r2.erro);
    assert.equal(aplicadas().length, 0);
  });

  test('aplicar-grava-a-spec-aprovada-de-origem: o caminho vem da aprovação, não do plano; spec ilegível/ausente recusa', async () => {
    const { amb, texto0, editar, aplicadas } = await pronto();
    // o plano passa a apontar para outra spec: o `spec` da aplicada segue o da aprovação de origem
    mkdirSync(join(amb.dir, 'docs'), { recursive: true });
    writeFileSync(join(amb.dir, 'docs', 'outra.md'), 'outra\n');
    writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify({ ...PLANO_REQ, spec: 'docs/outra.md' }));
    editar(`${texto0}\num\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    assert.equal(aplicadas()[0].dados.spec, SPEC);
    rmSync(join(amb.dir, SPEC));
    const r = amb.cli(['emenda', 'aplicar', '2']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'spec_ausente');
  });

  test('aprovarSpec-segue-shaAceito: (1) A, aplicada A⇒B, spec volta a A; (2) A, depois B, spec volta a A: aprovar grava e o painel limpa', async () => {
    const { aprovarSpec } = await import('../scripts/loop.mjs');
    // (1)
    const um = await pronto();
    um.editar(`${um.texto0}\nB\n`);
    assert.equal(um.amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    um.editar(um.texto0);
    assert.equal(await painelAguarda(um.amb), true);
    assert.equal(aprovarSpec(um.amb.dir, 'S-dono').ok, true);
    assert.equal(await painelAguarda(um.amb), false);
    // (2)
    const dois = await pronto();
    dois.editar(`${dois.texto0}\nB\n`);
    assert.equal(aprovarSpec(dois.amb.dir, 'S-dono').ok, true);
    dois.editar(dois.texto0);
    assert.equal(await painelAguarda(dois.amb), true);
    assert.equal(aprovarSpec(dois.amb.dir, 'S-dono').ok, true);
    assert.equal(await painelAguarda(dois.amb), false);
    assert.equal(aprovarSpec(dois.amb.dir, 'S-dono').erro, 'ja_aprovada', 'o aceito agora é A: aprovar de novo recusa');
  });

  test('regra-unica-estatica-cli: o loop.mjs importa a regra de emenda.js e não compara sha de spec por conta própria', () => {
    const t = readFileSync(join(AQUI, '..', 'scripts', 'loop.mjs'), 'utf8');
    assert.match(t, /import \{[^}]*\bvalidarAplicacao\b[^}]*\} from '\.\.\/dist\/emenda\.js'/);
    assert.match(t, /validarAplicacao\(/);
    // aprovarSpec: o `ja_aprovada` vem de shaAceito, não de varredura própria por spec.aprovada com o sha atual
    const apr = t.slice(t.indexOf('export function aprovarSpec'), t.indexOf('/** `parar` é o registro'));
    assert.match(apr, /shaAceito\(eventos, atual\.sha256\)/);
    assert.doesNotMatch(apr, /if \(antesN > 0\)/);
  });

  // ── GM-15 T36 r1 MAJOR-3 (emenda 25 m.4): o dono reverte emenda JÁ aplicada ─────────────────────────────────────────────────────────────────────────────────────
  const PAINEL_T36 = join(AQUI, '..', 'scripts', 'painel.mjs');
  /** Aprovação da SOMBRA forjada (sessão própria, `ts` à frente do diário) e a reversão do dono pelo comando real. */
  async function aplicadaERevertida() {
    const { julgarEmendaDono } = await import('../scripts/loop.mjs');
    const { amb, texto0, editar, aplicadas } = await pronto({ aprovadas: [] });
    const forja = (sessao, tipo, dados, desloc) => {
      const r = diario.append(amb.entregas, sessao, { ts: new Date(Date.now() + desloc).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
      assert.ok(r.ok, JSON.stringify(r));
    };
    forja('sombra-j', 'spec.emendada', { proposta_seq: 1, origem: 'sombra' }, 1000);
    const texto1 = `${texto0}\ntexto da emenda 1\n`;
    editar(texto1);
    const ap = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(ap.rc, 0, ap.out + ap.err);
    const rev = julgarEmendaDono(amb.dir, 1, 'rejeitar', 'S-dono');
    assert.equal(rev.ok, true, JSON.stringify(rev));
    return { amb, texto0, texto1, editar, aplicadas };
  }
  const avisoDesfazer = (amb) => (amb.cli(['proxima', '--vivos', '0']).j.aviso ?? []).filter((a) => /desfazer na spec/.test(a));

  test('divergente-aviso-ao-orquestrador-fora-do-depende: reversão do dono depois de aplicada ⇒ o `proxima` avisa o ORQUESTRADOR (texto + comando); o lote e o DEPENDE do painel real não têm item; o desfazer calou o aviso', async () => {
    const { amb, texto0, editar } = await aplicadaERevertida();
    const p = amb.cli(['proxima', '--vivos', '0']).j;
    assert.deepEqual((p.aviso ?? []).filter((a) => /desfazer na spec/.test(a)), ['desfazer na spec o texto da emenda 1 (revertida pelo dono) e rodar `emenda aplicar 1`']);
    assert.equal(JSON.stringify(p.lote).includes('emenda 1'), false, `o lote do dono não leva a divergência: ${JSON.stringify(p.lote)}`);
    const r = spawnSync(process.execPath, [PAINEL_T36, 'estado'], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    assert.equal(JSON.stringify(j.estado.depende).includes('revertida'), false, JSON.stringify(j.estado.depende));
    assert.equal(JSON.stringify(j.estado.depende).includes('emenda 1'), false);
    // desfeito o texto e gravado o desfazer, o aviso some
    editar(texto0.replace(/\n$/, '') + '\nsem a emenda 1\n');
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    assert.deepEqual(avisoDesfazer(amb), []);
  });

  test('emenda-aplicar-desfaz-revertida: `emenda aplicar <seq>` da emenda revertida grava spec.aplicada com reverte:true; arquivo igual à ponta ou ao sha da emenda ⇒ nada_a_aplicar; 2ª vez ⇒ ja_aplicada', async () => {
    const { amb, texto0, texto1, editar, aplicadas } = await aplicadaERevertida();
    const antes = bytesDoDiario(amb);
    const nada = amb.cli(['emenda', 'aplicar', '1']); // o texto da emenda 1 segue no arquivo
    assert.equal(nada.rc, 1, nada.out);
    assert.equal(nada.j.erro, 'nada_a_aplicar');
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    editar(texto0);
    const d = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(d.rc, 0, d.out + d.err);
    assert.deepEqual(aplicadas().map((e) => e.dados).at(-1), { seq: 1, spec: SPEC, sha256_antes: sha(texto1), sha256_depois: sha(texto0), reverte: true });
    editar(`${texto0}\noutra\n`);
    const de_novo = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(de_novo.j.erro, 'ja_aplicada');
  });

  test('emenda-aplicar-voltar-ao-sha-da-emenda-nao-desfaz: com a ponta já adiante, o arquivo que volta ao sha que a emenda 1 deixou ⇒ nada_a_aplicar (reverte exige sha novo)', async () => {
    const { amb, texto1, editar } = await aplicadaERevertida();
    const { julgarEmendaDono } = await import('../scripts/loop.mjs');
    // a emenda 2 (dono) aplicada depois: a ponta sai de B
    assert.equal(julgarEmendaDono(amb.dir, 2, 'aprovar', 'S-dono').ok, true);
    editar(`${texto1}\ntexto da emenda 2\n`);
    assert.equal(amb.cli(['emenda', 'aplicar', '2']).rc, 0);
    editar(texto1); // volta ao sha que a emenda 1 deixou: não desfez nada
    const r = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'nada_a_aplicar');
  });

  async function duasAplicadasERevertidas() {
    const { julgarEmendaDono } = await import('../scripts/loop.mjs');
    const base = await aplicadaERevertida();
    const { amb, texto0, texto1, editar } = base;
    // a emenda 2: aprovada pela Sombra, aplicada e revertida pelo dono, com o texto dela em cima do da 1
    const r2 = diario.append(amb.entregas, 'sombra-j2', { ts: new Date(Date.now() + 2000).toISOString(), autor: 't@t', sessao: 'sombra-j2', agente: 'orquestrador', tipo: 'spec.emendada', dados: { proposta_seq: 2, origem: 'sombra' } });
    assert.ok(r2.ok, JSON.stringify(r2));
    const texto2 = `${texto1}\ntexto da emenda 2\n`;
    editar(texto2);
    assert.equal(amb.cli(['emenda', 'aplicar', '2']).rc, 0);
    assert.equal(julgarEmendaDono(amb.dir, 2, 'rejeitar', 'S-dono').ok, true);
    return { ...base, texto2 };
  }
  const SO_1 = 'desfazer na spec o texto da emenda 1 (revertida pelo dono) e rodar `emenda aplicar 1`';
  const SO_2 = 'desfazer na spec o texto da emenda 2 (revertida pelo dono) e rodar `emenda aplicar 2`';

  test('emenda-aplicar-segundo-desfazer-sem-edicao-recusa (c2 r1 MAJOR-1, emenda 25 m.4): tirou só o texto da 1, `aplicar 1` ok; `aplicar 2` SEM editar ⇒ nada_a_aplicar, nada gravado, arquivo intacto, o aviso e o "?" do painel seguem citando a emenda 2', async () => {
    const { amb, texto0, texto2, editar, aplicadas } = await duasAplicadasERevertidas();
    // controle: nada editado ⇒ `aplicar 1` recusa
    const antes0 = bytesDoDiario(amb);
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).j.erro, 'nada_a_aplicar');
    assert.deepEqual(bytesDoDiario(amb), antes0);
    assert.deepEqual(avisoDesfazer(amb), [SO_1], 'limite declarado: com 2 divergências só a 1ª é citada');
    const soUm = `${texto0}\ntexto da emenda 2\n`; // o texto da 1 saiu; o da 2 segue na spec
    editar(soUm);
    const a1 = amb.cli(['emenda', 'aplicar', '1']);
    assert.equal(a1.rc, 0, a1.out + a1.err);
    assert.equal(aplicadas().length, 3, 'as aplicações 1 e 2 + o desfazer da 1');
    const antes = bytesDoDiario(amb);
    const a2 = amb.cli(['emenda', 'aplicar', '2']); // sem editar
    assert.equal(a2.rc, 1, a2.out);
    assert.equal(a2.j.erro, 'nada_a_aplicar');
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    assert.equal(readFileSync(join(amb.dir, SPEC), 'utf8'), soUm, 'o arquivo segue com o texto da emenda 2');
    assert.deepEqual(avisoDesfazer(amb), [SO_2], 'a divergência da 2 segue visível');
    const r = spawnSync(process.execPath, [PAINEL_T36, 'estado'], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    assert.match(r.stdout, /emenda 2/, 'o painel segue citando a emenda 2');
    assert.ok(texto2.length > 0);
  });

  test('emenda-aplicar-duas-desfeitas-em-sequencia (c2 r1 MAJOR-1): edita, `aplicar 1`, edita, `aplicar 2` ⇒ fecha as duas; o arquivo e o diário finais conferem; `aplicar 2` depois de `aplicar 1` com a MESMA edição recusa (limite declarado)', async () => {
    const { amb, texto0, texto1, editar, aplicadas } = await duasAplicadasERevertidas();
    editar(`${texto0}\ntexto da emenda 2\n`); // só o texto da 1
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    editar(texto0); // agora o texto da 2
    const a2 = amb.cli(['emenda', 'aplicar', '2']);
    assert.equal(a2.rc, 0, a2.out + a2.err);
    const ult = aplicadas().map((e) => e.dados);
    assert.deepEqual(ult.at(-1), { seq: 2, spec: SPEC, sha256_antes: sha(`${texto0}\ntexto da emenda 2\n`), sha256_depois: sha(texto0), reverte: true });
    assert.equal(ult.at(-2).reverte, true);
    assert.ok(ult.every((d) => d.reverte !== true || d.sha256_antes !== d.sha256_depois), 'nunca um desfazer com antes == depois');
    assert.equal(readFileSync(join(amb.dir, SPEC), 'utf8'), texto0);
    assert.deepEqual(avisoDesfazer(amb), []);
    assert.ok(texto1.length > 0);
  });

  test('emenda-aplicar-desfazer-exige-mudanca-em-todos (c2 r1 MAJOR-1): os 2 textos desfeitos numa edição só ⇒ `aplicar 1` grava e `aplicar 2` recusa nada_a_aplicar (limite declarado: 1 emenda por edição)', async () => {
    const { amb, texto0, editar } = await duasAplicadasERevertidas();
    editar(texto0); // os dois textos de uma vez
    assert.equal(amb.cli(['emenda', 'aplicar', '1']).rc, 0);
    const antes = bytesDoDiario(amb);
    const a2 = amb.cli(['emenda', 'aplicar', '2']);
    assert.equal(a2.rc, 1, a2.out);
    assert.equal(a2.j.erro, 'nada_a_aplicar');
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.deepEqual(avisoDesfazer(amb), [SO_2]);
  });

});

// ═══════════════════════════════════════════════════════════════ GM-15 T6: adiar, cortar e reabrir pela Sombra (REQ-ENT-2, condição 1)
// MUTAÇÕES PRESCRITAS: M6a --origem dono aceito em adiar · M6b idem em cortar · M6c idem em reabrir · M6d Sombra sem --fonte aceita · M6e reabrir --origem sombra sem julga_emendas.

describe('GM-15 T6: adiar, cortar e reabrir (a Sombra, com fonte; o dono só pelo hook)', () => {
  const COM_JULGA = { sombra: { julga_emendas: true } };
  const fora = (cmd, t, extra = {}) => [cmd, t, ...Object.entries({ motivo: 'adiada por teste', origem: 'sombra', fonte: 'decisao.sombra 1', ...extra }).flatMap(([k, v]) => (v === undefined ? [] : [`--${k}`, v]))];
  const foraDoDiario = (amb) => amb.eventos().filter((e) => e.tipo === 'task.fora');
  const estadoDe = (amb, t) => {
    const ord = ordenarNucleo(amb.eventos());
    return estadoNucleo(ord.eventos.filter((e) => e.dados?.task === t && /^(task|review)\./.test(e.tipo)));
  };
  const ambJulga = () => { const amb = ambReq(); comOrigin(amb, COM_JULGA); return amb; };

  test('cortar-com-dependente-recusa: T3 depende de T1 e não está fora ⇒ recusa listando T3; nada gravado; fora o dependente, passa', () => {
    const amb = ambJulga();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(fora('cortar', 'T1'));
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'dependentes_nao_fora');
    assert.deepEqual(r.j.dependentes, ['T3']);
    assert.match(r.j.mensagem, /T3/);
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.cli(fora('adiar', 'T1')).j.erro, 'dependentes_nao_fora', 'adiar recusa igual');
    // o dependente sai primeiro (adiada): agora T1 pode ser cortada
    assert.equal(amb.cli(fora('adiar', 'T3')).rc, 0);
    const ok = amb.cli(fora('cortar', 'T1'));
    assert.equal(ok.rc, 0, ok.out);
    assert.equal(estadoDe(amb, 'T1').estado, 'cortada');
    assert.equal(estadoDe(amb, 'T3').estado, 'adiada');
  });

  test('cortar-sombra-sem-fonte-recusa: sem --fonte (ou com fonte vazia) é uso e não grava', () => {
    const amb = ambJulga();
    const antes = bytesDoDiario(amb);
    for (const cmd of ['cortar', 'adiar']) {
      const r = amb.cli(fora(cmd, 'T2', { fonte: undefined }));
      assert.equal(r.rc, 2, cmd);
      assert.match(r.j.mensagem, /fonte/);
      assert.notEqual(amb.cli(fora(cmd, 'T2', { fonte: '  ' })).rc, 0, `${cmd} fonte em branco`);
      assert.equal(amb.cli(fora(cmd, 'T2', { motivo: undefined })).rc, 2, `${cmd} sem motivo`);
      assert.equal(amb.cli(fora(cmd, 'T2', { origem: undefined })).rc, 2, `${cmd} sem origem`);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('cortar-sombra-sem-julga-emendas-recusa: sem a opção em origin/HEAD (ausente, falsa, string ou só no config local) a Sombra não corta nem adia', () => {
    for (const preparar of [() => ({ amb: ambReq() }), () => ({ amb: (() => { const a = ambReq(); comOrigin(a, { sombra: { julga_emendas: 'true' } }); return a; })() }),
      () => ({ amb: ambReq({ config: { ...CONFIG_PADRAO, sombra: { julga_emendas: true } } }) })]) {
      const { amb } = preparar();
      const antes = bytesDoDiario(amb);
      for (const cmd of ['cortar', 'adiar']) {
        const r = amb.cli(fora(cmd, 'T2'));
        assert.equal(r.rc, 1, `${cmd} ${r.out}`);
        assert.equal(r.j.erro, 'julga_emendas_desligado');
      }
      assert.deepEqual(bytesDoDiario(amb), antes);
    }
  });

  test('adiar-sombra-grava-task-fora: grava task.fora com task, como, motivo, origem e fonte; a task sai do alvo', () => {
    const amb = ambJulga();
    const r = amb.cli(fora('adiar', 'T2', { motivo: 'fica para a 2.1.1', fonte: 'decisao.sombra 7' }));
    assert.equal(r.rc, 0, r.out);
    const e = foraDoDiario(amb);
    assert.equal(e.length, 1);
    assert.deepEqual(e[0].dados, { task: 'T2', como: 'adiada', motivo: 'fica para a 2.1.1', origem: 'sombra', fonte: 'decisao.sombra 7' });
    assert.equal(estadoDe(amb, 'T2').estado, 'adiada');
    const c = amb.cli(fora('cortar', 'T2'));
    assert.equal(c.rc, 1, 'terminal: adiada não vira cortada sem reabrir');
    assert.equal(c.j.erro, 'task_nao_pode_sair');
    // cortar grava como: cortada
    assert.equal(amb.cli(fora('cortar', 'T3', { motivo: 'sem valor' })).rc, 0);
    assert.equal(foraDoDiario(amb).at(-1).dados.como, 'cortada');
  });

  test('fora-em-voo-e-integrada-recusa: agente em voo ou task integrada não sai do alvo; nada gravado', () => {
    const amb = ambJulga();
    amb.semear([['task.iniciada', { task: 'T2', papel: 'implementador' }], ...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1')].filter((x, i) => i !== 1 || true));
    const antes = bytesDoDiario(amb);
    for (const t of ['T2', 'T1']) {
      const r = amb.cli(fora('adiar', t));
      assert.equal(r.rc, 1, `${t} ${r.out}`);
      assert.equal(r.j.erro, 'task_nao_pode_sair');
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('reabrir-sombra-exige-julga-e-fonte: de fora volta a pendente rodada 0 só com origem sombra, julga_emendas em origin e --fonte', () => {
    const amb = ambReq();
    amb.semear([['task.fora', { task: 'T2', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    const sem = amb.cli(['reabrir', 'T2', '--origem', 'sombra']);
    assert.equal(sem.rc, 2, 'sem --fonte');
    assert.match(sem.j.mensagem, /fonte/);
    const semJulga = amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'decisao.sombra 9']);
    assert.equal(semJulga.rc, 1);
    assert.equal(semJulga.j.erro, 'julga_emendas_desligado');
    assert.deepEqual(bytesDoDiario(amb), antes);
    comOrigin(amb, COM_JULGA);
    const ok = amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'decisao.sombra 9']);
    assert.equal(ok.rc, 0, ok.out);
    const e = amb.eventos().filter((x) => x.tipo === 'task.reaberta').at(-1);
    assert.deepEqual(e.dados, { task: 'T2', origem: 'sombra', fonte: 'decisao.sombra 9', de: 'fora' });
    assert.deepEqual(estadoDe(amb, 'T2'), { estado: 'pendente', rodada: 0 });
  });

  test('reabrir-sombra-de-task-nao-fora-recusa: reabrir --origem sombra numa task que não está fora não grava', () => {
    const amb = ambJulga();
    const antes = bytesDoDiario(amb);
    const r = amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'f']);
    assert.equal(r.rc, 1);
    assert.equal(r.j.erro, 'transicao_invalida');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('reabrir-sem-origem-segue-retomada: o reabrir da 2.0 não muda (origem retomada, sem fonte nem de)', () => {
    const amb = ambReq();
    amb.semear([...IMPL_E('T2')]);
    const r = amb.cli(['reabrir', 'T2']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(amb.eventos().filter((e) => e.tipo === 'task.reaberta').at(-1).dados, { task: 'T2', origem: 'retomada' });
    assert.equal(amb.cli(['reabrir', 'T2', '--origem', 'retomada']).rc, 2, 'retomada é o padrão sem flag, não um valor');
    assert.equal(amb.cli(['reabrir', 'T2', '--fonte', 'x']).rc, 2, '--fonte sem --origem sombra é uso');
  });

  test('cli-origem-dono-recusa: --origem dono em adiar, cortar e reabrir é uso (rc 2) e o diário fica byte a byte igual', () => {
    const amb = ambJulga();
    amb.semear([['task.fora', { task: 'T2', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    for (const a of [fora('adiar', 'T3', { origem: 'dono' }), fora('cortar', 'T3', { origem: 'dono' }), ['reabrir', 'T2', '--origem', 'dono', '--fonte', 'f'], ['reabrir', 'T2', '--origem', 'dono'],
      fora('adiar', 'T3', { origem: 'qualquer' }), ['reabrir', 'T2', '--origem', 'qualquer', '--fonte', 'f']]) {
      const r = amb.cli(a);
      assert.equal(r.rc, 2, a.join(' '));
      assert.equal(r.j.erro, 'uso');
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('cli-nenhum-subcomando-grava-dono: varre todo ESPEC com --origem dono; nenhum grava evento de origem dono', async () => {
    const { ESPEC_DO_CLI } = await import('../scripts/loop.mjs');
    const cmds = Object.keys(ESPEC_DO_CLI);
    assert.ok(cmds.includes('adiar') && cmds.includes('cortar') && cmds.includes('reabrir') && cmds.includes('liberar'));
    const amb = ambJulga();
    amb.semear([['task.fora', { task: 'T2', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    for (const cmd of cmds) {
      const esp = ESPEC_DO_CLI[cmd];
      const pos = Array.from({ length: esp.pos ?? 0 }, () => 'T2');
      const flags = (esp.obrig ?? []).filter((f) => f !== 'origem').flatMap((f) => [`--${f}`, 'x']);
      const r = amb.cli([cmd, ...pos, ...flags, '--origem', 'dono', '--fonte', 'x', '--hash', 'a'.repeat(64)].filter((_, i, v) => (esp.flags.includes('fonte') || v[i] !== '--fonte' && v[i - 1] !== '--fonte') && (esp.flags.includes('hash') || v[i] !== '--hash' && v[i - 1] !== '--hash')));
      assert.equal(r.rc, 2, `${cmd}: ${r.out}`);
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
    assert.equal(amb.eventos().some((e) => e.dados?.origem === 'dono'), false);
  });

  test('fora-dono-e-reabrir-dono-so-em-processo: foraDono e reabrirDono gravam origem dono, recusam dependente e ficam fora de ESPEC', async () => {
    const { foraDono, reabrirDono, ESPEC_DO_CLI } = await import('../scripts/loop.mjs');
    assert.equal(Object.keys(ESPEC_DO_CLI).some((k) => /dono/i.test(k)), false);
    const amb = ambReq(); // sem julga_emendas: o dono não depende dele
    const recusa = foraDono(amb.dir, 'T1', 'cortada', 'sem valor', 'S-dono');
    assert.equal(recusa.ok, false);
    assert.equal(recusa.erro, 'dependentes_nao_fora');
    assert.deepEqual(recusa.dependentes, ['T3']);
    assert.equal(foraDono(amb.dir, 'T3', 'adiada', 'fica para depois', 'S-dono').ok, true);
    const e = foraDoDiario(amb).at(-1);
    assert.deepEqual(e.dados, { task: 'T3', como: 'adiada', motivo: 'fica para depois', origem: 'dono' });
    assert.equal(e.sessao, 'S-dono');
    assert.equal(foraDono(amb.dir, 'T9', 'adiada', 'm', 'S-dono').erro, 'task_fora_do_plano');
    assert.equal(foraDono(amb.dir, 'T2', 'talvez', 'm', 'S-dono').erro, 'argumento_invalido');
    assert.equal(reabrirDono(amb.dir, 'T2', 'S-dono').ok, false, 'T2 não está fora');
    const r = reabrirDono(amb.dir, 'T3', 'S-dono');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(amb.eventos().filter((x) => x.tipo === 'task.reaberta').at(-1).dados, { task: 'T3', origem: 'dono', fonte: 'comando do dono', de: 'fora' });
    assert.deepEqual(estadoDe(amb, 'T3'), { estado: 'pendente', rodada: 0 });
  });

  test('lista-de-tipos-de-task-e-a-do-nucleo: o loop.mjs importa TIPOS_DE_TASK de dist/loop.js e não repete a lista', () => {
    const t = readFileSync(join(AQUI, '..', 'scripts', 'loop.mjs'), 'utf8');
    assert.match(t, /import \{[^}]*\bTIPOS_DE_TASK\b[^}]*\} from '\.\.\/dist\/loop\.js'/);
    assert.doesNotMatch(t, /^const TIPOS_DE_TASK = \[/m);
    assert.match(t, /foraPermitido\(/);
  });

  test('adiar-conta-no-estado-da-task: depois do adiar o proxima já não despacha a task e a reabertura a devolve', () => {
    const amb = ambJulga();
    assert.equal(amb.cli(fora('adiar', 'T2')).rc, 0);
    const p = amb.cli(['proxima']);
    assert.equal(p.rc, 0, p.out);
    assert.doesNotMatch(JSON.stringify(p.j), /"task":"T2"/);
    assert.equal(amb.cli(['reabrir', 'T2', '--origem', 'sombra', '--fonte', 'f']).rc, 0);
    assert.match(JSON.stringify(amb.cli(['proxima']).j), /T2/);
  });
});

describe('GM-15 T35 (r.10, C5): o orquestrador fecha só a própria pendência', () => {
  const ambT = () => ambiente({ plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'] }]) });
  const gravar = (amb, sessao, agente, tipo, dados) => {
    const ultimo = Math.max(0, ...amb.eventos().map((e) => Date.parse(e.ts)));
    const r = diario.append(amb.entregas, sessao, { ts: new Date(Math.max(ultimo + 1000, Date.now())).toISOString(), autor: 't@t', sessao, agente, tipo, dados });
    assert.ok(r.ok, JSON.stringify(r));
    const e = amb.eventos().filter((x) => x.sessao === sessao).pop();
    return `${e.sessao}:${e.seq}`;
  };
  const respostas = (amb) => amb.eventos().filter((e) => e.tipo === 'dono.resposta');

  test('orquestrador-fecha-propria-pendencia: nota pendencia do orquestrador (antiga) ⇒ anotar --fechar grava "feito" e ela fecha; 2ª vez recusa', () => {
    const amb = ambT();
    const id = gravar(amb, 'loop', 'orquestrador', 'nota', { tipo: 'pendencia', texto: 'lembrar de medir o bench' });
    const r = amb.cli(['anotar', '--fechar', id]);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(respostas(amb).map((e) => e.dados), [{ pergunta: id, opcao: 1, rotulo: 'feito' }]);
    const de_novo = amb.cli(['anotar', '--fechar', id]);
    assert.equal(de_novo.rc, 1);
    assert.equal(de_novo.j.erro, 'nao_e_pendencia_aberta_do_orquestrador');
    assert.equal(respostas(amb).length, 1);
  });

  test('proxima-nao-espera-adiada (r.14, C4): dúvida do dono adiada ("agora não") não trava: proxima despacha o que é permitido', () => {
    // Guarda de REGRESSÃO (review r1 MINOR-1): o núcleo de `proxima` não lê perguntas nem respostas do dono, então não há sítio de mutação "esperar
    // item adiado" hoje. A prova é estrutural (abaixo) e por controle: com a dúvida ABERTA a ação é a mesma. Se alguém fizer o núcleo ler perguntas,
    // a asserção estrutural cai e este teste passa a exigir que o adiado não trave.
    const amb = ambT();
    const id = gravar(amb, 'loop', 'orquestrador', 'nota', { tipo: 'duvida', texto: 'qual caminho?', opcoes: ['a', 'b'] });
    const aberta = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(aberta.rc, 0, aberta.out + aberta.err);
    gravar(amb, 'dono', 'orquestrador', 'dono.resposta', { pergunta: id, rotulo: 'agora não' });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'despachar', JSON.stringify(r.j.acao));
    assert.deepEqual(r.j.acao.itens.map((i) => `${i.task} ${i.papel}`), ['T1 implementador']);
    assert.deepEqual(r.j.acao, aberta.j.acao, 'dúvida aberta ou adiada: a mesma ação');
    for (const f of ['loop.ts', 'pendencias.ts']) {
      const fonte = readFileSync(join(AQUI, '..', 'src', f), 'utf8');
      assert.doesNotMatch(fonte, /from '\.\/(perguntas|depende)\.ts'|'dono\.resposta'|tipo === 'nota'/, `${f}: o núcleo de proxima passou a ler perguntas; o adiado não pode travar (r.14)`);
    }
  });

  test('orquestrador-nao-fecha-item-do-dono: pendência de outro autor, dúvida, emenda, pouso e id inexistente recusam sem gravar', () => {
    const amb = ambT();
    const ids = [
      gravar(amb, 'loop', 'dono', 'nota', { tipo: 'pendencia', texto: 'renovar o domínio' }),
      gravar(amb, 'loop', 'orquestrador', 'nota', { tipo: 'duvida', texto: 'qual?', opcoes: ['a', 'b'] }),
      gravar(amb, 'S1', 'orquestrador', 'sessao.pouso', { percent: 55, x: 50, via: 'dono' }),
      'loop:999',
    ];
    for (const id of ids) {
      const r = amb.cli(['anotar', '--fechar', id]);
      assert.equal(r.rc, 1, `${id}: ${r.out}`);
      assert.equal(r.j.erro, 'nao_e_pendencia_aberta_do_orquestrador', id);
    }
    assert.equal(respostas(amb).length, 0);
    assert.equal(amb.cli(['anotar', '--fechar', 'nao-e-id']).rc, 2, 'id fora da forma é uso');
    assert.equal(amb.cli(['anotar', '--fechar', 'loop:1', '--tipo', 'pendencia']).rc, 2, '--fechar não se mistura com --tipo/--texto');
  });
});

// ═══════════════════════════════════════════════════════════════ GM-15 T13: o lote do dono no `proxima` (REQ-AUT-1) e Sombra sem fonte ⇒ dono (REQ-ENT-2)
// MUTAÇÕES: M13a omitir `next ⇒ main` no fim ⇒ lote-do-dono-unico-cli · M13b DEPENDE com lista diferente do proxima ⇒ lote-igual-no-depende-cli
// · M13c a config de origin não chega ao lote (lê local) ⇒ lote-le-origin · M13d recusa sem fonte sem item do dono ⇒ sem-fonte-vira-item-do-dono.
describe('GM-15 T13: lote do dono no proxima', () => {
  const NO_TETO_E = (t) => [
    ['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: 'a'.repeat(40) }],
    ['task.iniciada', { task: t, papel: 'revisor' }], ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }],
    ['task.iniciada', { task: t, papel: 'correcao' }], ['task.concluida', { task: t, sha: 'b'.repeat(40) }],
    ['task.iniciada', { task: t, papel: 'revisor' }], ['review.veredito', { task: t, veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }],
  ];
  const DESLIGADA = { entrega: { base: 'next', autonomia: false }, sombra: { julga_emendas: false, libera_teto: false } };
  const MOTIVOS_4 = ['decidir a T2: chegou ao limite de revisões', 'decidir a emenda 1', `atualizar o plugin (instalado: ${VERSAO_PLUGIN}): o diário tem evento de uma versão mais nova`, 'no fim da entrega: levar next para main'];
  const montar = (cfgOrigin, { config } = {}) => {
    const amb = ambReq(config ? { config } : {});
    if (cfgOrigin !== null) comOrigin(amb, cfgOrigin);
    amb.semear([...NO_TETO_E('T2'), ['evento.do.futuro', { x: 1 }]]);
    // a proposta é do REQ da T2 (já no teto): T1 segue livre e o núcleo despacha
    grava(amb, relogioDe(), [['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1' })]]);
    return amb;
  };

  test('lote-do-dono-unico-cli: os 4 previsíveis num proxima só, na ordem, com os comandos; a ação do núcleo segue (T1 despacha)', () => {
    const amb = montar(DESLIGADA);
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.lote.map((i) => i.motivo), MOTIVOS_4);
    assert.equal(r.j.lote[0].acoes[0].comando, '/gabarito-mestre:liberar T2');
    assert.equal(r.j.lote.at(-1).motivo, 'no fim da entrega: levar next para main', 'next ⇒ main é o último');
    assert.deepEqual(r.j.acao.itens?.map((i) => i.task), ['T1'], `o lote não para o loop: ${JSON.stringify(r.j.acao)}`);
  });

  test('lote-le-origin: a Sombra ligada e a autonomia de entrega em origin/HEAD esvaziam o lote (fica só o plugin atrás); o config local não conta', () => {
    const lig = montar({ entrega: { base: 'next', autonomia: true }, sombra: { julga_emendas: true, libera_teto: true } }).cli(['proxima']);
    assert.equal(lig.rc, 0, lig.out);
    assert.deepEqual(lig.j.lote.map((i) => i.motivo), [`atualizar o plugin (instalado: ${VERSAO_PLUGIN}): o diário tem evento de uma versão mais nova`]);
    const soLocal = montar(null, { config: { ...CONFIG_PADRAO, entrega: { base: 'next', autonomia: true }, sombra: { julga_emendas: true, libera_teto: true } } }).cli(['proxima']);
    assert.deepEqual(soLocal.j.lote.map((i) => i.motivo), ['decidir a T2: chegou ao limite de revisões', 'decidir a emenda 1', `atualizar o plugin (instalado: ${VERSAO_PLUGIN}): o diário tem evento de uma versão mais nova`],
      'sem origin: Sombra desligada e base main (sem next ⇒ main)');
  });

  test('lote-redacao-da-sombra-rejeitada (GM-15 T34, backlog T26 MINOR-1, REQ-EME-3 B): a redação da Sombra rejeitada por quem não é o dono entra no lote do proxima; a do orquestrador, a aberta e a rejeitada pelo dono não', () => {
    const amb = ambReq();
    comOrigin(amb, { entrega: { base: 'main' } });
    grava(amb, relogioDe(), [
      ['emendas', 'emenda.proposta', PROPOSTA({ origem: 'sombra', req: 'REQ-B-1' })], // seq 1: redação da Sombra
      ['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-C-1' })], // seq 2: do orquestrador
      ['sombra', 'emenda.rejeitada', { proposta_seq: 1, origem: 'sombra' }],
      ['dono', 'emenda.rejeitada', { proposta_seq: 2, origem: 'dono' }],
    ]);
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.lote.map((i) => i.motivo), ['decidir a redação da Sombra rejeitada (emenda 1, REQ-B-1): a Sombra não repropõe nessa âncora']);
    assert.equal(r.j.lote[0].nivel, 'dono');
    const amb2 = ambReq();
    comOrigin(amb2, { entrega: { base: 'main' } });
    grava(amb2, relogioDe(), [['emendas', 'emenda.proposta', PROPOSTA({ origem: 'sombra', req: 'REQ-B-1' })]]);
    assert.deepEqual(amb2.cli(['proxima']).j.lote.map((i) => i.motivo), ['decidir a emenda 1'], 'aberta: a emenda comum');
  });

  test('lote-redacao-sai-so-por-decisao-do-dono-ou-fim (review r1 MAJOR-3, r2 MAJOR-1): só a rejeição do próprio dono e a entrega encerrada tiram o item; proposta do orquestrador (qualquer REQ, antes ou depois) e nova redação da Sombra não', () => {
    const base = () => {
      const amb = ambReq();
      comOrigin(amb, { entrega: { base: 'main' } });
      return amb;
    };
    const rej = [['emendas', 'emenda.proposta', PROPOSTA({ origem: 'sombra', req: 'REQ-B-1' })], ['sombra', 'emenda.rejeitada', { proposta_seq: 1, origem: 'sombra' }]];
    const itens = (amb) => amb.cli(['proxima']).j.lote.filter((i) => /redação da Sombra/.test(i.motivo)).length;
    let amb = base(); grava(amb, relogioDe(), rej);
    assert.equal(itens(amb), 1, 'controle: o item existe');
    amb = base(); grava(amb, relogioDe(), [rej[0], ['dono', 'emenda.rejeitada', { proposta_seq: 1, origem: 'dono' }]]);
    assert.equal(itens(amb), 0, 'rejeitada pelo próprio dono');
    amb = base(); grava(amb, relogioDe(), [...rej, ['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1', diff: '+ texto do orquestrador' })]]);
    assert.equal(itens(amb), 1, 'proposta posterior do orquestrador, mesmo REQ, não tira o item');
    amb = base(); grava(amb, relogioDe(), [...rej, ['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-C-1' })]]);
    assert.equal(itens(amb), 1, 'proposta de outro REQ não tira');
    amb = base(); grava(amb, relogioDe(), [...rej, ['emendas', 'emenda.proposta', PROPOSTA({ req: 'REQ-B-1', origem: 'sombra' })]]);
    assert.equal(itens(amb), 1, 'nova redação da Sombra não tira');
    amb = base(); grava(amb, relogioDe(), rej);
    amb.semear([['entrega.encerrada', { entrega: 'GM-10', pr: 7, via: 'head', mergeado_em: '2026-11-13T09:00:00.000Z' }]]);
    assert.equal(itens(amb), 0, 'entrega encerrada');
  });

  test('lote-redacao-emenda-propor-do-orquestrador-nao-tira (r2 MAJOR-1), pelo CLI real: com o item no lote, `emenda propor` do orquestrador com outra âncora passa (rc 0) e o item continua', () => {
    const amb = ambReq();
    comOrigin(amb, { entrega: { base: 'main' } });
    grava(amb, relogioDe(), [['emendas', 'emenda.proposta', PROPOSTA({ origem: 'sombra', req: 'REQ-B-1' })], ['sombra', 'emenda.rejeitada', { proposta_seq: 1, origem: 'sombra' }]]);
    const itens = () => amb.cli(['proxima']).j.lote.filter((i) => /redação da Sombra/.test(i.motivo)).length;
    assert.equal(itens(), 1, 'controle');
    const r = amb.cli(proporArgs(amb, { req: 'REQ-B-1', task: 'T2' }));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(itens(), 1, 'a proposta do orquestrador não decide pelo dono');
  });

  test('lote-redacao-igual-no-painel-e-no-proxima (GM-15 T34): o mesmo diário com redação da Sombra rejeitada dá o mesmo lote no painel real (estado.depende) e no proxima', () => {
    const amb = ambReq();
    comOrigin(amb, { entrega: { base: 'main' } });
    grava(amb, relogioDe(), [
      ['emendas', 'emenda.proposta', PROPOSTA({ origem: 'sombra', req: 'REQ-B-1' })],
      ['sombra', 'emenda.rejeitada', { proposta_seq: 1, origem: 'sombra' }],
    ]);
    const lote = amb.cli(['proxima']).j.lote;
    assert.equal(lote.length, 1, JSON.stringify(lote));
    const r = spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'painel.mjs'), 'estado'], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    const motivos = (j.estado.depende ?? []).map((i) => i.motivo);
    // o painel soma o que é só dele (spec aguardando, ligar o loop); o lote do proxima entra inteiro, na mesma ordem, contíguo
    const k = motivos.indexOf(lote[0].motivo);
    assert.ok(k >= 0, JSON.stringify(motivos));
    assert.deepEqual(motivos.slice(k, k + lote.length), lote.map((i) => i.motivo), 'o DEPENDE do painel traz o lote do proxima');
  });

  test('lote-vazio-sem-item-cli: sem nada previsível o proxima devolve lote vazio', () => {
    const amb = ambReq();
    comOrigin(amb, { entrega: { base: 'main' } });
    const r = amb.cli(['proxima']);
    assert.equal(r.rc, 0, r.out);
    assert.deepEqual(r.j.lote, []);
  });

  test('lote-igual-no-depende-cli: o DEPENDE montado com o lote do proxima tem os mesmos itens, na mesma ordem', async () => {
    const { dependeDe } = await import('../dist/depende.js');
    const amb = montar(DESLIGADA);
    const r = amb.cli(['proxima']);
    const dep = dependeDe({ entrega: 'GM-10', identificada: true, marcas: [], mudouDepois: false }, amb.eventos(), [], { falhou: [] }, false, { branch: null, idPadrao: '[A-Z]+-\\d+' }, r.j.lote);
    const i = dep.findIndex((x) => x.motivo === r.j.lote[0].motivo);
    assert.deepEqual(dep.slice(i, i + r.j.lote.length), r.j.lote);
    assert.equal(dep.length, r.j.lote.length, 'nada mais neste diário');
  });

  test('sem-fonte-vira-item-do-dono: adiar, cortar e reabrir pela Sombra sem --fonte recusam (rc 2, nada gravado) e devolvem o item do dono com o comando humano', () => {
    const amb = ambReq();
    comOrigin(amb, { sombra: { julga_emendas: true } });
    amb.semear([['task.fora', { task: 'T3', como: 'adiada', motivo: 'm', origem: 'sombra', fonte: 'f' }]]);
    const antes = bytesDoDiario(amb);
    for (const [args, cmd] of [[['adiar', 'T2', '--motivo', 'm', '--origem', 'sombra'], 'adiar'], [['cortar', 'T2', '--motivo', 'm', '--origem', 'sombra'], 'cortar'],
      [['reabrir', 'T3', '--origem', 'sombra'], 'reabrir'], [['adiar', 'T2', '--motivo', 'm', '--origem', 'sombra', '--fonte', '  '], 'adiar']]) {
      const r = amb.cli(args);
      assert.notEqual(r.rc, 0, args.join(' '));
      assert.match(r.j.mensagem, /fonte/);
      assert.equal(r.j.item_do_dono.nivel, 'dono', args.join(' '));
      assert.deepEqual(r.j.item_do_dono.acoes, [{ rotulo: cmd, comando: `/gabarito-mestre:${cmd} ${args[1]}` }]);
    }
    assert.equal(amb.cli(['adiar', 'T2', '--motivo', 'm', '--origem', 'sombra']).rc, 2, 'segue uso');
    assert.equal(amb.cli(['adiar', 'T2', '--motivo', 'm']).j.item_do_dono, undefined, 'sem --origem sombra não é a Sombra: só uso');
    assert.deepEqual(bytesDoDiario(amb), antes);
  });
});

describe('GM-20 REQ-EXE-1: iniciar --executor orquestrador (D-G44, DT10 a DT12)', () => {
  const MOTIVO = 'task de contrato do painel; o subagent não tem a regra';
  const exe = (t, motivo = MOTIVO, papel = 'implementador') => ['iniciar', t, papel, '--executor', 'orquestrador', '--motivo', motivo];
  const comWt = (...ts) => { const amb = ambReq(); for (const t of ts) assert.equal(amb.cli(['abrir', t]).rc, 0, t); return amb; };

  test('iniciar-executor-orquestrador-grava (ME1-a): 1 task.iniciada {papel, executor, motivo}, rc 0 pelo CLI real; o motivo é texto livre (fora da lista do `concluir`)', () => {
    const amb = comWt('T1');
    const antes = amb.eventos().length;
    const r = amb.cli(exe('T1'));
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    const novos = amb.eventos().slice(antes);
    assert.equal(novos.length, 1, 'um evento só, nenhum `desvio` extra (DT10)');
    assert.equal(novos[0].tipo, 'task.iniciada');
    assert.equal(novos[0].dados.task, 'T1');
    assert.equal(novos[0].dados.papel, 'implementador');
    assert.equal(novos[0].dados.executor, 'orquestrador');
    assert.equal(novos[0].dados.motivo, MOTIVO);
    assert.equal(amb.tipos().includes('desvio'), false);
    // o `concluir` segue com a lista fechada de motivos da reentrega
    assert.equal(amb.cli(['concluir', 'T1', '--motivo', MOTIVO]).rc, 1);
  });

  test('iniciar-executor-sem-motivo-recusa (ME1-a): sem --motivo, vazio ou só espaço ⇒ argumento_invalido, rc 1, diário igual; --motivo sem --executor também', () => {
    const amb = comWt('T1');
    const antes = bytesDoDiario(amb);
    for (const args of [['iniciar', 'T1', 'implementador', '--executor', 'orquestrador'], exe('T1', ''), exe('T1', '   '), exe('T1', '\t'),
      ['iniciar', 'T1', 'implementador', '--motivo', 'sem executor']]) {
      const r = amb.cli(args);
      assert.equal(r.rc, 1, JSON.stringify(args) + r.out);
      assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify(args));
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('iniciar-executor-revisor-recusa (ME1-b): outro valor de --executor, e papel revisor ou correcao ⇒ argumento_invalido, rc 1, nada gravado', () => {
    const amb = comWt('T1');
    amb.semear([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }]]);
    const antes = bytesDoDiario(amb);
    for (const args of [exe('T1', MOTIVO, 'revisor'), exe('T1', MOTIVO, 'correcao'),
      ['iniciar', 'T1', 'implementador', '--executor', 'humano', '--motivo', 'm'], ['iniciar', 'T1', 'implementador', '--executor', 'Orquestrador', '--motivo', 'm'],
      ['iniciar', 'T1', 'implementador', '--executor', '', '--motivo', 'm']]) {
      const r = amb.cli(args);
      assert.equal(r.rc, 1, JSON.stringify(args) + r.out);
      assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify(args));
    }
    assert.deepEqual(bytesDoDiario(amb), antes);
  });

  test('iniciar-executor-um-por-vez (ME1-c): outra task da entrega com executor em voo ⇒ executor_ocupado, rc 1; sem executor passa; a cobertura que acaba libera; outra entrega não conta', () => {
    const amb = comWt('T1', 'T2');
    assert.equal(amb.cli(exe('T1')).rc, 0);
    const antes = bytesDoDiario(amb);
    const r = amb.cli(exe('T2', 'outra'));
    assert.equal(r.rc, 1, r.out);
    assert.equal(r.j.erro, 'executor_ocupado');
    assert.deepEqual(bytesDoDiario(amb), antes, 'nada gravado');
    // a mesma task em voo não é "outra": a tabela diz o resto (transicao_invalida, não executor_ocupado)
    assert.notEqual(amb.cli(exe('T1', 'de novo')).j.erro, 'executor_ocupado');
    // outra entrega com task do orquestrador em voo não bloqueia esta
    const outra = join(amb.dir, '.harness', 'entregas', 'GM-11');
    mkdirSync(outra, { recursive: true });
    const w = diario.append(outra, 'loop', { ts: '2026-01-01T00:00:01.000Z', autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo: 'task.iniciada', dados: { task: 'T9', papel: 'implementador', executor: 'orquestrador', motivo: 'm' } });
    assert.ok(w.ok, JSON.stringify(w));
    // task com agente comum não bloqueia, e a que sai de implementando libera
    assert.equal(amb.cli(['iniciar', 'T2', 'implementador']).rc, 0, 'sem --executor segue valendo');
    assert.equal(amb.cli(['reabrir', 'T1']).rc, 0);
    assert.equal(amb.cli(exe('T1', 'depois da reabertura')).rc, 0, 'a cobertura acabou com a reabertura (vale o último)');
  });

  test('iniciar-executor-cli-e-painel-mesma-regra (adaptador real): o CLI que recusa o 2º e o painel que mostra o desvio leem a mesma função; o ATENÇÃO sai desenhado', () => {
    const amb = comWt('T1', 'T2');
    assert.equal(amb.cli(exe('T1')).rc, 0);
    assert.equal(amb.cli(exe('T2', 'x')).j.erro, 'executor_ocupado');
    const ord = ordenarNucleo(amb.eventos());
    assert.deepEqual([...coberturaDoOrquestrador(ord.eventos)], [['T1', MOTIVO]]);
    const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
    const roda = (args) => spawnSync(process.execPath, [PAINEL, ...args], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const e = roda(['estado']);
    const estado = JSON.parse(e.stdout.trim()).estado;
    assert.ok(estado.atencao.includes(`T1 com o orquestrador: ${MOTIVO}`), JSON.stringify(estado.atencao));
    assert.equal(estado.plano.tasks.find((x) => x.id === 'T1').nome, 'orquestrador');
    const txt = roda(['texto', '--largura', '140']);
    assert.equal(txt.status, 0, txt.stderr);
    assert.match(txt.stdout, /T1 com o orquestrador: task de contrato do painel/);
    assert.equal(/T1 sem agente trabalhando/.test(txt.stdout), false);
  });

  test('iniciar-executor-ocupado-e-painel-concluida (adaptador real, D-G44): a task em `concluida` ainda ocupa o slot no CLI e o painel mostra a mesma linha, no estado e no texto', () => {
    const amb = comWt('T1', 'T2');
    assert.equal(amb.cli(exe('T1')).rc, 0);
    amb.semear([['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }]]);
    const r = amb.cli(exe('T2', 'outra'));
    assert.equal(r.j.erro, 'executor_ocupado', r.out);
    const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
    const roda = (args) => spawnSync(process.execPath, [PAINEL, ...args], { cwd: amb.dir, encoding: 'utf8', env: amb.env, input: '' });
    const estado = JSON.parse(roda(['estado']).stdout.trim()).estado;
    assert.ok(estado.atencao.includes(`T1 com o orquestrador: ${MOTIVO}`), JSON.stringify(estado.atencao));
    const txt = roda(['texto', '--largura', '140']);
    assert.equal(txt.status, 0, txt.stderr);
    assert.match(txt.stdout, /T1 com o orquestrador: task de contrato do painel/);
  });

  test('iniciar-executor-compativel-com-o-diario-lido-antes: o evento tem só campos opcionais novos, `task`/`papel` intactos (o leitor 2.2.2 casa por papel)', () => {
    const amb = comWt('T1');
    assert.equal(amb.cli(exe('T1')).rc, 0);
    const e = amb.eventos().find((x) => x.tipo === 'task.iniciada');
    assert.deepEqual(Object.keys(e.dados).sort().filter((k) => !['modelo', 'executor', 'motivo'].includes(k)), ['papel', 'task']);
    assert.equal(estadoNucleo(ordenarNucleo(amb.eventos()).eventos.filter((x) => x.dados?.task === 'T1')).estado, 'implementando');
  });
});

describe('GM-21 T3: plano executável conferido antes do abrir e do proxima (REQ-MIG-1, DT4; CLI real, P9)', () => {
  const MUT = [{ nome: 'm1', arquivo: 'src/t1.txt', de: 'a', para: 'b', teste: 'npm test' }];
  const ladoDe = (amb) => ({
    branches: g(amb.dir, 'branch', '--list', 'wt/*').trim(),
    worktrees: existsSync(join(amb.dir, '.harness', 'worktrees')) ? readdirSync(join(amb.dir, '.harness', 'worktrees')) : [],
  });
  const comTask = (extra = {}, config = CONFIG_PADRAO) => {
    const amb = ambiente({ config, plano: planoDe([{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], ...extra }]) });
    return amb;
  };
  const recusou = (amb, r, task, campo) => {
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.ok, false);
    assert.equal(r.j.erro, 'plano_nao_executavel', r.out);
    assert.deepEqual(ladoDe(amb), { branches: '', worktrees: [] }, 'nenhuma worktree nem branch');
    assert.ok(r.j.problemas.some((p) => p.task === task && p.campo === campo), JSON.stringify(r.j.problemas));
    for (const p of r.j.problemas) assert.ok(r.j.mensagem.includes(p.motivo) || r.out.includes(p.motivo), p.motivo);
    assert.ok(r.j.mensagem.includes(task ?? 'gates.suites'), r.j.mensagem);
  };

  test('abrir-recusa-mutacoes-texto-livre: a forma da l.122 do backlog; a mensagem cita task, campo e motivo; nada criado', () => {
    const amb = comTask({ mutacoes: 'mutar a função X e ver o teste cair' });
    const r = amb.cli(['abrir', 'T1']);
    recusou(amb, r, 'T1', 'mutacoes');
    assert.equal(r.j.problemas.length, 1);
    assert.match(r.j.mensagem, /T1/);
    assert.match(r.j.mensagem, /mutacoes/);
    assert.match(r.j.mensagem, /caminho/);
  });

  test('abrir-recusa-teste-afetado-caminho: arquivo existente sem bit de execução ⇒ recusa com o exemplo fixo; nada criado', () => {
    const amb = comTask({ teste_afetado: 'src/t1.test.ts' });
    writeFileSync(join(amb.dir, 'src/t1.test.ts'), 'x');
    const r = amb.cli(['abrir', 'T1']);
    recusou(amb, r, 'T1', 'teste_afetado');
    assert.ok(r.j.mensagem.includes('use o comando, ex.: "npx vitest run src/t1.test.ts"'), r.j.mensagem);
  });

  test('abrir-recusa-sem-suites: config sem gates.suites, lista vazia ou item sem cmd ⇒ recusa citando a config; nada criado', () => {
    for (const config of [{ loop: { slots: 2 } }, { gates: { suites: [] } }, { gates: { suites: [{ nome: 'x' }] } }]) {
      const amb = comTask({}, config);
      const r = amb.cli(['abrir', 'T1']);
      recusou(amb, r, null, 'gates.suites');
    }
  });

  test('abrir-plano-valido-igual: o formato da GM-16 (mutacoes em JSON com cwd, teste_afetado em comando) abre como antes', () => {
    const amb = comTask({ mutacoes: 'mut.json', teste_afetado: 'npx vitest run src/t1.test.ts' });
    writeFileSync(join(amb.dir, 'mut.json'), JSON.stringify([{ ...MUT[0], cwd: '.' }]));
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.task, 'T1');
    assert.ok(existsSync(join(amb.dir, '.harness', 'worktrees', 'T1')));
    assert.equal(r.j.problemas, undefined);
  });

  test('suites-em-texto-aceitas: gates.suites com texto puro não recusa (a régua é a do gate)', () => {
    const amb = comTask({}, { gates: { suites: ["echo '# pass 1'", { cmd: "echo '# pass 1'", nome: 'b' }] } });
    const r = amb.cli(['abrir', 'T1']);
    assert.equal(r.rc, 0, r.out + r.err);
  });

  test('escopo-por-emenda-e-diretorio: arquivo da mutação dentro de diretório de `arquivos` ou do escopo ampliado por emenda aplicada não recusa; fora de ambos recusa', () => {
    // diretório listado
    const dir = comTask({ arquivos: ['src'], mutacoes: 'mut.json' });
    writeFileSync(join(dir.dir, 'mut.json'), JSON.stringify([{ ...MUT[0], arquivo: 'src/fundo/x.txt' }]));
    assert.equal(dir.cli(['abrir', 'T1']).rc, 0);
    // fora do escopo sem emenda
    const PLANO_INT = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['src/t1.txt'], reqs: ['REQ-A-1'], mutacoes: 'mut.json' }] };
    const sem = ambiente({ plano: PLANO_INT });
    writeFileSync(join(sem.dir, 'mut.json'), JSON.stringify([{ ...MUT[0], arquivo: 'src/extra.txt' }]));
    const rec = sem.cli(['abrir', 'T1']);
    recusou(sem, rec, 'T1', 'mutacoes');
    assert.match(rec.j.mensagem, /src\/extra\.txt/);
    // com emenda aprovada que traz o arquivo
    const amb = ambiente({ plano: PLANO_INT });
    writeFileSync(join(amb.dir, 'mut.json'), JSON.stringify([{ ...MUT[0], arquivo: 'src/extra.txt' }]));
    comOrigin(amb, { sombra: { julga_emendas: true }, gates: { suites: ["echo '# pass 1'"] } });
    assert.equal(amb.cli(proporArgs(amb, { task: 'T1', arquivos: 'src/extra.txt' })).rc, 0);
    assert.equal(amb.cli(['emenda', 'julgar', '1', 'aprovar']).rc, 0);
    const ok = amb.cli(['abrir', 'T1']);
    assert.equal(ok.rc, 0, ok.out + ok.err);
  });

  test('conferir-ignora-integrada: task integrada ou fora com campo inválido não recusa o abrir da outra nem entra no aviso', () => {
    const amb = ambiente({ plano: planoDe([
      { id: 'T1', deps: [], arquivos: ['src/t1.txt'], mutacoes: 'texto livre' },
      { id: 'T2', deps: [], arquivos: ['src/t2.txt'], mutacoes: 'texto livre' },
      { id: 'T3', deps: [], arquivos: ['src/t3.txt'] },
    ]) });
    amb.semear([...IMPL_E('T1'), APROVA_E('T1'), INTEGRA_E('T1'), ['task.fora', { task: 'T2', como: 'cortada', motivo: 'x', origem: 'dono' }]]);
    const p = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(p.rc, 0, p.out + p.err);
    assert.deepEqual(p.j.acao.itens.map((i) => i.task), ['T3']);
    assert.equal(JSON.stringify(p.j.aviso ?? []).includes('plano_nao_executavel') || JSON.stringify(p.j.aviso ?? []).includes('mutacoes'), false, JSON.stringify(p.j.aviso));
    assert.equal(amb.cli(['abrir', 'T3']).rc, 0);
  });

  test('proxima-tira-invalida: 1 task inválida e outra válida ⇒ itens só com a válida; o aviso traz os problemas da inválida', () => {
    const amb = ambiente({ plano: planoDe([
      { id: 'T1', deps: [], arquivos: ['src/t1.txt'], mutacoes: 'mutar X' },
      { id: 'T2', deps: [], arquivos: ['src/t2.txt'] },
    ]) });
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.acao.tipo, 'despachar');
    assert.deepEqual(r.j.acao.itens.map((i) => i.task), ['T2']);
    const aviso = r.j.aviso.filter((a) => a.includes('T1') && a.includes('mutacoes'));
    assert.equal(aviso.length, 1, JSON.stringify(r.j.aviso));
    assert.equal(r.j.aviso.some((a) => a.includes('T2') && /mutacoes|teste_afetado/.test(a)), false);
  });

  test('proxima-todas-invalidas-espera: toda task com problema (ou a config) ⇒ esperar plano_nao_executavel, com o aviso de cada uma', () => {
    const amb = ambiente({ plano: planoDe([
      { id: 'T1', deps: [], arquivos: ['src/t1.txt'], mutacoes: 'mutar X' },
      { id: 'T2', deps: [], arquivos: ['src/t2.txt'], teste_afetado: 'src/a.sh' },
    ]) });
    writeFileSync(join(amb.dir, 'src/a.sh'), 'x');
    const r = amb.cli(['proxima', '--vivos', '0']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(r.j.acao, { tipo: 'esperar', motivo: 'plano_nao_executavel' });
    assert.ok(r.j.aviso.some((a) => a.includes('T1') && a.includes('mutacoes')), JSON.stringify(r.j.aviso));
    assert.ok(r.j.aviso.some((a) => a.includes('T2') && a.includes('teste_afetado')), JSON.stringify(r.j.aviso));
    const semCfg = comTask({}, { loop: { slots: 2 } }); // config presente, sem gates.suites
    const c = semCfg.cli(['proxima', '--vivos', '0']);
    assert.deepEqual(c.j.acao, { tipo: 'esperar', motivo: 'plano_nao_executavel' });
    assert.ok(c.j.aviso.some((a) => a.includes('gates.suites')), JSON.stringify(c.j.aviso));
  });
});

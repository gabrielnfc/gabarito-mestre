/**
 * GM-15 T33 (emendas 5 e 12; REQ-POU-3): o painel decide o pouso pendente pela MESMA medição do `loop.mjs proxima` (`medicaoDoPouso`, fresca até 120 s,
 * a sessão vigente) e o pouso fecha também por retomada medida (g.18). A regra é uma só (`pouso-pendente.ts`); aqui se prova que o painel a chama com a
 * medição e que a entrega do painel sai da mesma regra do loop (`idDaBranch` + `idPadraoDe`).
 * Mutações: tirar `medicao` da chamada do painel; ignorar a medição na retomada; tirar a comparação com X; PADROES.idPadrao no lugar de `idPadraoDe`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { projetarPainel } from '../dist/painel.js';
import { pousoPendente, sessoesDeRetomada } from '../dist/pouso-pendente.js';
import { estadoDoPainel, main } from '../scripts/painel.mjs';
import { medicaoDoPouso } from '../scripts/loop.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
const AGORA = Date.parse('2026-11-15T22:00:00Z');
const iso = (seg) => new Date(AGORA + seg * 1000).toISOString();

// ───────────────────────────── núcleo puro: diário e medição à mão
const ev = (seg, tipo, dados = {}, sessao = 'sA', seq = 1) => ({ seq, ts: iso(seg), autor: 't', sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null });
/** A fronteira de T1 (veredito) e o pouso dela, na sessão `sA`; tudo antes de AGORA. */
const base = () => [
  ev(-900, 'task.iniciada', { task: 'T1', papel: 'implementador' }, 'sA', 1), ev(-890, 'task.concluida', { task: 'T1', sha: 'a'.repeat(40) }, 'sA', 2),
  ev(-880, 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }, 'sA', 3),
  ev(-870, 'task.integrada', { task: 'T1', sha: 'b'.repeat(40), mutacoes: { total: 3, mortas: 3 } }, 'sA', 4),
  ev(-860, 'sessao.pouso', { percent: 60, x: 50 }, 'sA', 5),
];
const leitura = (sessao, percent, segAntes = 10, fonte = 'mod') => ({ sessao, percent, fonte, emMs: AGORA - segAntes * 1000 });
const medicao = (sessaoAtual, leituras, x = 50) => ({ x, agoraMs: AGORA, sessaoAtual, leituras });

test('pouso-fecha-por-retomada-medida: retomada de outra sessão, depois do pouso, com contexto medido abaixo de X ⇒ não pendente', () => {
  const eventos = [...base(), ev(-300, 'sessao.retomada', { via: 'mod', chars: 10 }, 'sB', 1)];
  const r = pousoPendente(eventos, true, medicao('sC', [leitura('sB', 9)]));
  assert.equal(r.pendente, false);
});

test('pouso-fecha-por-retomada-medida: sessao.inicio de origem startup/resume de outra sessão também fecha, com a mesma medição', () => {
  const eventos = [...base(), ev(-300, 'sessao.inicio', { origem: 'resume' }, 'sB', 1)];
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 9)])).pendente, false);
  assert.equal(pousoPendente(eventos, true, undefined).pendente, true);
});

test('pouso-retomada-sem-medicao-pendente: retomada sem leitura da sessão nova (ausente, velha ou de outra fonte) não fecha', () => {
  const eventos = [...base(), ev(-300, 'sessao.retomada', { via: 'mod', chars: 10 }, 'sB', 1)];
  assert.equal(pousoPendente(eventos, true, undefined).pendente, true, 'sem medição nenhuma');
  assert.equal(pousoPendente(eventos, true, medicao('sC', [])).pendente, true, 'sem leitura da sessão nova');
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 9, 300)])).pendente, true, 'leitura de 300 s não é fresca');
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 9, 10, 'hook')])).pendente, true, 'só a fonte mod conta');
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sX', 9)])).pendente, true, 'leitura de uma sessão que não retomou não fecha');
});

test('pouso-retomada-mesma-sessao-pendente: retomada da MESMA sessão que pousou não fecha, nem com contexto baixo', () => {
  const eventos = [...base(), ev(-300, 'sessao.retomada', { via: 'mod', chars: 10 }, 'sA', 6)];
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sA', 9)])).pendente, true);
});

test('pouso-retomada-acima-x-pendente: retomada com o contexto medido em X ou acima segue pendente (a comparação com X vale)', () => {
  const eventos = [...base(), ev(-300, 'sessao.retomada', { via: 'mod', chars: 10 }, 'sB', 1)];
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 50)])).pendente, true, 'em X');
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 71)])).pendente, true, 'acima de X');
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 49.5)])).pendente, false, 'abaixo de X (decimal)');
});

test('pouso-retomada-anterior-ao-pouso-nao-fecha: a retomada de ANTES do pouso não o fecha', () => {
  const eventos = [ev(-950, 'sessao.retomada', { via: 'mod', chars: 10 }, 'sB', 1), ...base()];
  assert.equal(pousoPendente(eventos, true, medicao('sC', [leitura('sB', 9)])).pendente, true);
});

test('pouso-inicio-clear-sem-leitura-fecha: sessao.inicio{clear} de outra sessão segue fechando sem leitura nenhuma (regra sem mod intocada)', () => {
  const eventos = [...base(), ev(-300, 'sessao.inicio', { origem: 'clear' }, 'sB', 1)];
  assert.equal(pousoPendente(eventos, true, undefined).pendente, false);
  assert.equal(pousoPendente(eventos, true, medicao('sC', [])).pendente, false);
  assert.equal(pousoPendente(base(), true, undefined).pendente, true, 'sem o clear segue pendente');
});

test('sessoes-de-retomada: só sessões diferentes da que pousou, depois do pouso, sem repetir', () => {
  const eventos = [...base(), ev(-300, 'sessao.retomada', {}, 'sB', 1), ev(-200, 'sessao.inicio', { origem: 'startup' }, 'sB', 2), ev(-100, 'sessao.inicio', { origem: 'clear' }, 'sD', 1),
    ev(-90, 'sessao.retomada', {}, 'sA', 6)];
  assert.deepEqual(sessoesDeRetomada(eventos), ['sB']);
  assert.deepEqual(sessoesDeRetomada(null), []);
});

// ───────────────────────────── a projeção do painel
const FATOS = { branch: 'enabler/GM-15-fluidez', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: ['T1', 'T2'] }, ledger: false, gh: 'ok', ultimas: [], sessao: 'sP' };
const PLANO = { entrega: 'GM-15', tasks: [{ id: 'T1', deps: [], arquivos: [] }, { id: 'T2', deps: ['T1'], arquivos: [] }] };
const entrada = (extra = {}) => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: 40, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
  pacote: { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['ARAGORN', 'LEGOLAS', 'GIMLI', 'FRODO'] }, notificacao: null, agoraMs: AGORA, fuso: 'UTC', titulo: null,
  politica: { politica: 'continua', dias: null }, entregaId: 'GM-15', modeloSessao: null, specSha: null, tetoSombra: 26, fatos: FATOS, onboarding: true, ...extra,
});
const limpar = (s) => s.depende.some((i) => i.motivo === 'limpar a conversa');

test('painel-pouso-leitura-propria-abaixo-x-sem-item: pouso no diário + leitura própria de 19 % (fresca) ⇒ sem "limpar a conversa"', () => {
  const s = projetarPainel(PLANO, base(), entrada({ medicaoPouso: medicao('sP', [leitura('sP', 19)]) }));
  assert.equal(limpar(s), false);
  assert.equal(s.pousoPendente.pendente, false);
});

test('painel-pouso-leitura-acima-x-com-item: pouso no diário + leitura própria em X ou acima ⇒ com "limpar a conversa"', () => {
  for (const p of [50, 62]) {
    const s = projetarPainel(PLANO, base(), entrada({ medicaoPouso: medicao('sP', [leitura('sP', p)]) }));
    assert.equal(limpar(s), true, `percent ${p}`);
    assert.equal(s.pousoPendente.pendente, true);
  }
});

test('painel-pouso-sem-leitura-regra-sem-mod: sem leitura própria a regra é a de hoje (pouso sem clear ⇒ item; com clear ⇒ sem)', () => {
  assert.equal(limpar(projetarPainel(PLANO, base(), entrada())), true, 'sem medicaoPouso');
  assert.equal(limpar(projetarPainel(PLANO, base(), entrada({ medicaoPouso: medicao('sP', []) }))), true, 'medição sem leitura');
  assert.equal(limpar(projetarPainel(PLANO, base(), entrada({ medicaoPouso: medicao('sP', [leitura('sP', 19, 500)]) }))), true, 'leitura velha');
  const comClear = [...base(), ev(-300, 'sessao.inicio', { origem: 'clear' }, 'sB', 1)];
  assert.equal(limpar(projetarPainel(PLANO, comClear, entrada())), false, 'o /clear fecha');
});

test('painel-retomada-medida: a retomada com a leitura da sessão nova abaixo de X tira o item do painel', () => {
  const eventos = [...base(), ev(-300, 'sessao.retomada', { via: 'mod', chars: 10 }, 'sB', 1)];
  assert.equal(limpar(projetarPainel(PLANO, eventos, entrada({ medicaoPouso: medicao('sP', [leitura('sB', 9)]) }))), false);
  assert.equal(limpar(projetarPainel(PLANO, eventos, entrada({ medicaoPouso: medicao('sP', []) }))), true);
});

// ───────────────────────────── pelo CLI: o mesmo diário e a mesma leitura dão a mesma resposta que `proxima`
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function repo({ branch = 'feat/GM-77-painel', entrega = 'GM-77', origem, eventos = [] } = {}) {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'painel pouso ')));
  const r = join(raiz, 'repo com espaço');
  mkdirSync(r);
  g(r, 'init', '-q', '-b', branch);
  g(r, 'config', 'user.email', 't@t.test');
  g(r, 'config', 'user.name', 't');
  g(r, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(r, 'README.md'), 'x\n');
  if (origem !== undefined) writeFileSync(join(r, 'harness.config.json'), JSON.stringify(origem));
  g(r, 'add', '.');
  g(r, 'commit', '-q', '-m', 'inicio');
  if (origem !== undefined) {
    const bare = join(raiz, 'origin.git');
    mkdirSync(bare);
    g(bare, 'init', '-q', '--bare', '-b', branch);
    g(r, 'remote', 'add', 'origin', bare);
    g(r, 'push', '-q', 'origin', branch);
    g(r, 'remote', 'set-head', 'origin', branch);
  }
  const dir = join(r, '.harness', 'entregas', entrega);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plano.json'), JSON.stringify({ entrega, tasks: [{ id: 'T1', titulo: 'Primeira', deps: [], arquivos: ['a.txt'] }, { id: 'T2', titulo: 'Segunda', deps: ['T1'], arquivos: ['b.txt'] }] }));
  let seq = 0;
  for (const [tipo, dados, sessao = 'sA'] of eventos) {
    seq += 1;
    const ap = diario.append(dir, sessao, { ts: new Date(Date.now() - 600_000 + seq * 1000).toISOString(), autor: 't@t.test', sessao, agente: 'orquestrador', tipo, dados });
    assert.ok(ap.ok, JSON.stringify(ap));
  }
  return { raiz, r, dir };
}
const FRONTEIRA = [
  ['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
  ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }], ['task.integrada', { task: 'T1', sha: 'b'.repeat(40), mutacoes: { total: 3, mortas: 3 } }],
  ['sessao.pouso', { percent: 60, x: 50 }],
];
const gravaContexto = (r, sessao, percent) => {
  mkdirSync(join(r, '.harness', 'contexto'), { recursive: true });
  writeFileSync(join(r, '.harness', 'contexto', `${sessao}.json`), JSON.stringify({ percent, fonte: 'mod', em: new Date().toISOString() }));
};
const proxima = (r, sessao) => {
  const p = spawnSync(process.execPath, [LOOP, 'proxima', '--entrega', 'GM-77', '--sessao', sessao], { cwd: r, encoding: 'utf8', timeout: 60_000, env: { ...process.env, GABARITO_POUSO_X: '50' } });
  return JSON.parse(p.stdout.split('\n').filter(Boolean).pop());
};

test('painel-e-proxima-mesma-resposta: o mesmo diário e a mesma leitura dão o mesmo pendente no painel (CLI) e no `proxima`', () => {
  const origem = { fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } };
  for (const [percent, pendente] of [[19, false], [61, true]]) {
    const { r } = repo({ origem, eventos: FRONTEIRA });
    gravaContexto(r, 'sessao-p', percent);
    const a = proxima(r, 'sessao-p');
    assert.equal(a.acao.tipo === 'pousar', pendente, `proxima com ${percent} %: ${JSON.stringify(a.acao)}`);
    const est = estadoDoPainel(r, { agoraMs: Date.now(), agentes: { session_id: 'sessao-p', agentes: [], sessao: {} } });
    assert.equal(est.ok, true, JSON.stringify(est));
    assert.equal(est.estado.pousoPendente.pendente, pendente, `painel com ${percent} %`);
    assert.equal(est.estado.depende.some((i) => i.motivo === 'limpar a conversa'), pendente);
  }
});

test('painel-medicao-pela-flag-sessao: `painel.mjs estado --sessao <id>` usa a leitura dessa sessão (sem o stdin do mod)', () => {
  const origem = { fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } };
  const { r } = repo({ origem, eventos: FRONTEIRA });
  gravaContexto(r, 'sessao-p', 19);
  const saidas = [];
  const rc = main(['estado', '--sessao', 'sessao-p'], r, { saida: (t) => saidas.push(t), aviso: () => {}, agoraMs: Date.now(), stdin: () => { throw new Error('stdin lido'); } });
  assert.equal(rc, 0, saidas.join(''));
  assert.equal(JSON.parse(saidas.join('')).estado.pousoPendente.pendente, false);
  const rc2 = main(['estado'], r, { saida: (t) => saidas.push(t), aviso: () => {}, agoraMs: Date.now(), stdin: () => { throw new Error('stdin lido'); } });
  assert.equal(rc2, 0);
  assert.equal(JSON.parse(saidas.slice(1).join('')).estado.pousoPendente.pendente, true, 'sem --sessao e sem stdin ⇒ regra sem mod');
  assert.equal(main(['estado', '--sessao', '../x'], r, { saida: () => {}, aviso: () => {} }), 2, 'forma inválida é uso errado');
});

test('painel-retomada-medida-cli: leitura gravada sob o id da sessão que retomou fecha o pouso no painel', () => {
  const origem = { fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } };
  const { r } = repo({ origem, eventos: [...FRONTEIRA, ['sessao.retomada', { via: 'mod', chars: 5 }, 'sessao-nova']] });
  const pedir = () => estadoDoPainel(r, { agoraMs: Date.now(), agentes: { session_id: 'sessao-velha', agentes: [], sessao: {} } });
  assert.equal(pedir().estado.pousoPendente.pendente, true, 'sem leitura da sessão nova');
  gravaContexto(r, 'sessao-nova', 9);
  assert.equal(pedir().estado.pousoPendente.pendente, false, 'com a leitura sob o id novo');
  gravaContexto(r, 'sessao-nova', 77);
  assert.equal(pedir().estado.pousoPendente.pendente, true, 'a leitura acima de X não fecha');
});

test('painel-texto-entrega-da-branch-enabler: enabler/GM-15-fluidez ⇒ a entrega GM-15, não "entrega não identificada"', () => {
  const { r } = repo({ branch: 'enabler/GM-15-fluidez', entrega: 'GM-15', origem: { fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } }, eventos: [['task.iniciada', { task: 'T1', papel: 'implementador' }]] });
  const saidas = [];
  const rc = main(['texto', '--largura', '100'], r, { saida: (t) => saidas.push(t), aviso: () => {}, agoraMs: Date.now() });
  assert.equal(rc, 0, saidas.join(''));
  const t = saidas.join('');
  assert.match(t, /GABARITO · GM-15/);
  assert.doesNotMatch(t, /entrega não identificada/);
});

test('idPadrao-da-origem-no-painel: fluxo.idPadrao de origin/HEAD decide a entrega do painel (a regra do loop), com e sem a chave', () => {
  const sem = repo({ branch: 'feat/GM-5-x', entrega: 'GM-5', origem: { fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } } });
  assert.equal(estadoDoPainel(sem.r, { agoraMs: Date.now() }).estado.id, 'GM-5', 'sem a chave vale o padrão');
  const com = repo({ branch: 'feat/GM-5-x', entrega: 'GM-5', origem: { fluxo: { idPadrao: 'QQ-\\d+', resolvidoEm: '2026-11-01T00:00:00Z' } } });
  const est = estadoDoPainel(com.r, { agoraMs: Date.now() });
  assert.equal(est.ok, true, JSON.stringify(est));
  assert.notEqual(est.estado.id, 'GM-5', 'com fluxo.idPadrao próprio a branch GM-5 não é a entrega');
});

test('fonte-unica-idPadraoDe: painel.mjs e painel-medir.mjs importam idPadraoDe de lib/config.mjs e não têm cópia nem PADROES.idPadrao', () => {
  for (const arq of ['painel.mjs', 'painel-medir.mjs']) {
    const src = readFileSync(join(AQUI, '..', 'scripts', arq), 'utf8');
    assert.match(src, /import \{[^}]*\bidPadraoDe\b[^}]*\} from '\.\.\/lib\/config\.mjs'/, `${arq} importa a fonte única`);
    assert.doesNotMatch(src, /function idPadraoDe/, `${arq} sem cópia própria`);
    assert.doesNotMatch(src, /PADROES\.idPadrao|ID_PADRAO\b/, `${arq} sem o padrão fixo`);
  }
});

test('medicaoDoPouso-e-a-do-loop: o painel a importa de loop.mjs (não monta a leitura por conta)', () => {
  const src = readFileSync(join(AQUI, '..', 'scripts', 'painel.mjs'), 'utf8');
  assert.match(src, /medicaoDoPouso/);
  assert.equal(typeof medicaoDoPouso, 'function');
});

// ───────────────────────────── g.17: o pacote de nomes da CLI é o da sessão
import { gravarContexto } from '../../mod/painel.mjs';

/** Roda o script que o mod manda o `$.process.run` executar (o `node -e` de verdade), no repo `r`. */
const gravaPeloMod = (r, dados) => {
  const g = gravarContexto(dados);
  assert.ok(g !== null);
  const p = spawnSync(g.argv[0], g.argv.slice(1), { cwd: r, input: g.stdin, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
};
const origemOnb = { fluxo: { resolvidoEm: '2026-11-01T00:00:00Z' } };

test('cli-pacote-da-sessao: o mod grava o pacote vigente no contexto da sessão e `painel.mjs` o usa (--sessao e o session_id do stdin), sem pacote cai em terra-media', () => {
  const { r } = repo({ origem: origemOnb, eventos: [['task.iniciada', { task: 'T1', papel: 'implementador' }]] });
  gravaPeloMod(r, { sessao: 'sessao-p', percent: 19, fonte: 'mod', emMs: Date.now(), pacote: 'hogwarts' });
  const arq = JSON.parse(readFileSync(join(r, '.harness', 'contexto', 'sessao-p.json'), 'utf8'));
  assert.equal(arq.pacote, 'hogwarts');
  assert.equal(arq.percent, 19);
  const pelaFlag = estadoDoPainel(r, { agoraMs: Date.now(), sessao: 'sessao-p' });
  assert.equal(pelaFlag.estado.pacote, 'Hogwarts');
  const pelaMod = estadoDoPainel(r, { agoraMs: Date.now(), agentes: { session_id: 'sessao-p', agentes: [], sessao: {} } });
  assert.equal(pelaMod.estado.pacote, 'Hogwarts');
  const semSessao = estadoDoPainel(r, { agoraMs: Date.now() });
  assert.equal(semSessao.estado.pacote, 'Hogwarts', 'sem sessão dada: a leitura recente do mod é a vigente');
  const flag = estadoDoPainel(r, { agoraMs: Date.now(), sessao: 'sessao-p', pacote: 'galaxia' });
  assert.notEqual(flag.estado.pacote, 'Hogwarts', 'a flag --pacote vence a leitura gravada');
  const stdin = estadoDoPainel(r, { agoraMs: Date.now(), agentes: { session_id: 'sessao-p', agentes: [], sessao: { pacote: 'herois' } } });
  assert.notEqual(stdin.estado.pacote, 'Hogwarts', 'o pacote do stdin do mod vence a leitura gravada');
});

test('cli-pacote-da-sessao: leitura sem pacote, pacote fora da forma ou velha de 1 h não decide; fica a fábrica (terra-media)', () => {
  const { r } = repo({ origem: origemOnb, eventos: [['task.iniciada', { task: 'T1', papel: 'implementador' }]] });
  gravaPeloMod(r, { sessao: 'sessao-p', percent: 19, fonte: 'mod', emMs: Date.now() });
  assert.equal(estadoDoPainel(r, { agoraMs: Date.now(), sessao: 'sessao-p' }).estado.pacote, 'Terra Média');
  gravaPeloMod(r, { sessao: 'sessao-p', percent: 19, fonte: 'mod', emMs: Date.now(), pacote: '../x' });
  assert.equal(estadoDoPainel(r, { agoraMs: Date.now(), sessao: 'sessao-p' }).estado.pacote, 'Terra Média');
  gravaPeloMod(r, { sessao: 'sessao-v', percent: 19, fonte: 'mod', emMs: Date.now() - 3_600_000, pacote: 'hogwarts' });
  assert.equal(estadoDoPainel(r, { agoraMs: Date.now() }).estado.pacote, 'Terra Média', 'sem --sessao a leitura de 1 h atrás não vale');
  assert.equal(estadoDoPainel(r, { agoraMs: Date.now(), sessao: 'sessao-v' }).estado.pacote, 'Hogwarts', 'pedindo a sessão pelo id, o pacote dela vale');
});

// ───────────────────────────── g.11/g.15 pela borda: o `comando` do shell de fundo chega à narração
test('narracao-integrando-pela-cli: o `comando` do segundoPlano do mod passa pelo validador do stdin e a narração diz "integrando T1"', () => {
  const { r } = repo({ origem: origemOnb, eventos: [['task.iniciada', { task: 'T2', papel: 'implementador' }]] });
  const sp = (extra) => ({ session_id: 'sessao-p', agentes: [], sessao: {}, segundoPlano: [{ id: 'bg1', dono: 'orquestrador', texto: 'rodando', desde: 1, ...extra }] });
  const ok = estadoDoPainel(r, { agoraMs: Date.now(), agentes: sp({ comando: 'cd /r && node scripts/loop.mjs integrar T1 | tail' }) });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.match(ok.estado.equipe.lider.narrativa, /integrando T1\b/);
  const sem = estadoDoPainel(r, { agoraMs: Date.now(), agentes: sp({ comando: 'ls' }) });
  assert.doesNotMatch(sem.estado.equipe.lider.narrativa, /integrando/);
  const ruim = estadoDoPainel(r, { agoraMs: Date.now(), agentes: sp({ comando: 7 }) });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.erro, 'stdin_invalido');
});

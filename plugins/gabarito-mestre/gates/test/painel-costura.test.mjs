/**
 * Costura do mod do painel (E4, T10, P9): `mod/painel.mjs` (funções puras) + o CLI REAL `painel.mjs estado --agentes` + o `dist/` do núcleo.
 * O mod em si (hooks, Pane, faixa, relógio, aviso) tem seus testes em `mod/test/gabarito.test.ts` (`claude plugin test`); aqui o que só o node prova:
 * a cadeia `API crua → montarPedido → CLI → interpretarSaida → linhasDaPane/faixaDe` e as funções puras campo a campo (P15).
 *
 * MUTAÇÕES PRESCRITAS: task-10-mut.json da entrega.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { renderPainel } from '../dist/painel.js';
import {
  caminhoDoTranscript, chaveMod, classeDaFalha, comandoParaPrompt, faixaCortada, faixaDe, inserirComTeto, interpretarSaida, linhasDaPane, montarPedido, PACOTES_FABRICA,
  prefsValidas, PREFS_PADRAO, TETO_TRANSCRIPTS, textoDaFalha, textoDoAviso, umaLinha, USO_GABARITO,
} from '../../mod/painel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'painel.mjs');
const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
const FIXTURE = join(AQUI, 'fixtures', 'transcript-agente.jsonl');
const ROOT = '/opt/gabarito mestre';
const novoTmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const texto = (linhas) => linhas.map((l) => l.map((s) => s.texto).join('')).join('\n');
const cores = (linhas) => new Set(linhas.flatMap((l) => l.map((s) => s.cor ?? null)));

// ─── a costura (P9): costura-mod-cli-ctx-e-parou ───
describe('costura mod → CLI real → mod', () => {
  const montarRepo = () => {
    const base = novoTmp('painel mod costura ');
    const repo = join(base, 'repo');
    mkdirSync(repo);
    g(repo, 'init', '-q', '-b', 'feat/GM-12-costura');
    g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't'); g(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), 'x\n');
    g(repo, 'add', '-A');
    g(repo, 'commit', '-q', '-m', 'chore: base');
    const dir = join(repo, '.harness', 'entregas', 'GM-12');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plano.json'), JSON.stringify({
      entrega: 'GM-12',
      tasks: [{ id: 'T1', titulo: 'Primeira', deps: [], arquivos: ['src/t1.txt'] }, { id: 'T2', titulo: 'Segunda', deps: ['T1'], arquivos: ['src/t2.txt'] }],
    }));
    let seq = 0;
    const ev = (tipo, dados) => {
      seq += 1;
      const r = diario.append(dir, 'loop', { ts: new Date(Date.UTC(2026, 10, 9, 12, 0, seq)).toISOString(), autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados });
      assert.ok(r.ok, `preparo: ${tipo}: ${JSON.stringify(r)}`);
    };
    return { base, repo, dir, ev };
  };
  const cli = (repo, stdin) => {
    const r = spawnSync(process.execPath, [CLI, 'estado', '--agentes'], { cwd: repo, encoding: 'utf8', input: stdin, timeout: 60_000 });
    return { exitCode: r.status, stdout: r.stdout, isStdoutTruncated: false };
  };

  test('costura-mod-cli-ctx-e-parou (P9): ctx da fixture (92.762 ⇒ 93k), nenhuma linha 5h, e com loop.parar a faixa ■ PAROU com botão de liberar T2', () => {
    const m = montarRepo();
    // saídas CRUAS da API do motor: usage só com `seven_day`; lista de agentes; mapa de transcripts do mod
    const usage = { startedAt: 0, context: { window: 200000, percent: 46, tokens: 92762 }, rateLimits: [{ kind: 'seven_day', percentUsed: 9, resetsAt: '2026-11-15T18:00:00.000Z' }] };
    const agentes = [{ id: 'aANON1', type: 'implementador', description: 'T2 implementador', status: 'running' }];
    const sub = join(m.base, 'sessao', 'subagents');
    mkdirSync(sub, { recursive: true });
    copyFileSync(FIXTURE, join(sub, 'agent-aANON1.jsonl'));
    const pedido = montarPedido({ usage, agentes, x: 50, notificacao: null, pacote: null, transcripts: { aANON1: join(sub, 'agent-aANON1.jsonl') } });

    for (const [tipo, dados] of [['task.iniciada', { task: 'T1', papel: 'implementador' }], ['task.concluida', { task: 'T1', sha: 'a'.repeat(40) }],
      ['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }], ['task.integrada', { task: 'T1', sha: 'b'.repeat(40) }],
      ['task.iniciada', { task: 'T2', papel: 'implementador' }]]) m.ev(tipo, dados);

    // (A) em voo
    const a = interpretarSaida(cli(m.repo, JSON.stringify(pedido)));
    assert.equal(a.classe, 'ok', JSON.stringify(a));
    const prefs = { preset: 'esquadrao', tema: 'mono', narracao: true, ligado: true };
    const txt = texto(linhasDaPane(a.estado, prefs, 80));
    assert.match(txt, /ctx 93k/, `o ctx da fixture (ctxTok 92.762) aparece como \`fmtTok\` o escreve, 93k (arredonda; o plano diz 92k):\n${txt}`);
    assert.doesNotMatch(txt, /\b5h\b/, 'rateLimits sem five_hour ⇒ nenhuma linha 5h');
    assert.match(txt, /7d/, 'seven_day (9) chega ao líder');
    assert.equal(faixaDe(a.estado, true, null), null, 'nada pendente e Pane visível: sem faixa');

    // (B) o loop PARA pelo CLI real do loop, com T2 no teto
    for (const [tipo, dados] of [['task.concluida', { task: 'T2', sha: 'c'.repeat(40) }],
      ['review.veredito', { task: 'T2', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 }], ['task.iniciada', { task: 'T2', papel: 'correcao' }],
      ['task.concluida', { task: 'T2', sha: 'd'.repeat(40) }], ['review.veredito', { task: 'T2', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 }]]) m.ev(tipo, dados);
    const p = spawnSync(process.execPath, [LOOP, 'parar', 'teto_rodadas'], { cwd: m.repo, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    const b = interpretarSaida(cli(m.repo, JSON.stringify(pedido)));
    assert.equal(b.classe, 'ok', JSON.stringify(b));
    const f = faixaDe(b.estado, false, null, { root: ROOT });
    assert.match(f.texto, /^■ PAROU .+teto de rodadas de review em T2/);
    assert.equal(f.cor, 'error');
    assert.equal(f.comando, '/gabarito-mestre:liberar T2');
    assert.equal(f.rotulo, 'aprovar');
    assert.equal(chaveMod(b.estado), `GM-12|${b.estado.parar.chave}`);
    assert.match(texto(linhasDaPane(b.estado, prefs, 80)), /PAROU/);
  });

  test('CLI sem loop: erro `plano_ausente` do CLI real vira classe `sem_loop`', () => {
    const base = novoTmp('painel mod sem loop ');
    const repo = join(base, 'repo');
    mkdirSync(repo);
    g(repo, 'init', '-q', '-b', 'feat/GM-12-x');
    g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't');
    const r = interpretarSaida(cli(repo, JSON.stringify(montarPedido({ usage: null, agentes: [], x: 50, notificacao: null, pacote: null, transcripts: {} }))));
    assert.equal(r.classe, 'sem_loop', JSON.stringify(r));
  });
});

// ─── montarPedido: cada campo lido (P15) ───
describe('montarPedido', () => {
  const USO = { context: { window: 200000, percent: 37, tokens: 74000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 11 }, { kind: 'seven_day', percentUsed: 9 }] };
  const base = (o = {}) => montarPedido({ usage: USO, agentes: [], x: 35, notificacao: null, pacote: null, transcripts: {}, ...o });

  test('x-e-limites-no-stdin: percent, tokens, window, h5, d7 e x; cada um trocado muda o pedido', () => {
    assert.deepEqual(base().sessao, { percent: 37, tokens: 74000, window: 200000, h5: 11, d7: 9, x: 35, notificacao: null, pacote: null });
    assert.equal(base({ usage: { ...USO, context: { window: 1, percent: 2, tokens: 3 } } }).sessao.percent, 2);
    assert.equal(base({ usage: { ...USO, context: { window: 1, percent: 2, tokens: 3 } } }).sessao.tokens, 3);
    assert.equal(base({ usage: { ...USO, context: { window: 1, percent: 2, tokens: 3 } } }).sessao.window, 1);
    assert.equal(base({ usage: { ...USO, rateLimits: [{ kind: 'five_hour', percentUsed: 80 }, { kind: 'seven_day', percentUsed: 9 }] } }).sessao.h5, 80);
    assert.equal(base({ usage: { ...USO, rateLimits: [{ kind: 'five_hour', percentUsed: 11 }, { kind: 'seven_day', percentUsed: 64 }] } }).sessao.d7, 64);
    assert.equal(base({ x: 20 }).sessao.x, 20);
    assert.deepEqual(base({ notificacao: { ts: '2026-11-09T17:00:00.000Z' } }).sessao.notificacao, { ts: '2026-11-09T17:00:00.000Z' });
    assert.deepEqual(base({ notificacao: { motivo: 'no-channel' } }).sessao.notificacao, { motivo: 'no-channel' });
    assert.equal(base({ pacote: 'galaxia' }).sessao.pacote, 'galaxia');
  });

  test('h5/d7 ausentes ⇒ null, nunca 0; não finito ⇒ null; sem usage ⇒ tudo null', () => {
    const so7 = base({ usage: { ...USO, rateLimits: [{ kind: 'seven_day', percentUsed: 9 }] } }).sessao;
    assert.equal(so7.h5, null);
    assert.equal(so7.d7, 9);
    assert.equal(base({ usage: { ...USO, rateLimits: [] } }).sessao.d7, null);
    assert.equal(base({ usage: { ...USO, rateLimits: 'x' } }).sessao.h5, null);
    assert.equal(base({ usage: { ...USO, rateLimits: [{ kind: 'five_hour', percentUsed: 'muito' }] } }).sessao.h5, null);
    assert.equal(base({ usage: { context: { percent: Number.NaN, tokens: Infinity, window: '200' } } }).sessao.percent, null);
    assert.equal(base({ usage: { context: { percent: Number.NaN, tokens: Infinity, window: '200' } } }).sessao.tokens, null);
    assert.equal(base({ usage: { context: { percent: Number.NaN, tokens: Infinity, window: '200' } } }).sessao.window, null);
    for (const u of [null, undefined, 'x', 3]) assert.deepEqual(base({ usage: u }).sessao, { percent: null, tokens: null, window: null, h5: null, d7: null, x: 35, notificacao: null, pacote: null });
  });

  test('sem `modelo` no pedido (D-M3): a sessão só tem as 8 chaves', () => {
    assert.deepEqual(Object.keys(base().sessao).sort(), ['d7', 'h5', 'notificacao', 'pacote', 'percent', 'tokens', 'window', 'x']);
    assert.deepEqual(Object.keys(base()).sort(), ['agentes', 'sessao']);
  });

  test('agentes: campos mapeados, transcript do mapa por id, só objetos com id; lista inválida ⇒ null (nunca [])', () => {
    const lista = [{ id: 'a1', type: 'implementador', description: 'T2 implementador', status: 'running', parentId: 'zz' }, null, 'x', { id: 7 }, { id: 'a2', type: 'revisor', description: 'T2 revisor', status: 'idle' }];
    const p = base({ agentes: lista, transcripts: { a1: '/s/subagents/agent-a1.jsonl' } });
    assert.deepEqual(p.agentes, [
      { id: 'a1', type: 'implementador', description: 'T2 implementador', status: 'running', transcript: '/s/subagents/agent-a1.jsonl' },
      { id: 'a2', type: 'revisor', description: 'T2 revisor', status: 'idle', transcript: null },
    ]);
    assert.deepEqual(base({ agentes: [] }).agentes, []);
    for (const ruim of [null, undefined, 'não é lista', { id: 'a' }, 3]) assert.equal(base({ agentes: ruim }).agentes, null, `agentes ${JSON.stringify(ruim)} ⇒ null`);
    const herdado = base({ agentes: [{ id: 'constructor', type: 't', description: 'd', status: 's' }, { id: '__proto__', type: 't', description: 'd', status: 's' }], transcripts: {} });
    assert.deepEqual(herdado.agentes.map((a) => a.transcript), [null, null], 'chave herdada do protótipo não é caminho');
    assert.equal(base({ agentes: [{ id: 'a1', type: 1, description: 2, status: 3 }] }).agentes[0].type, '');
  });
});

// ─── interpretarSaida e classeDaFalha ───
describe('interpretarSaida / classeDaFalha / textoDaFalha', () => {
  const ESTADO = { id: 'GM-12', plano: { tasks: [], feitas: 0, total: 0 } };
  const sai = (stdout, exitCode = 0, extra = {}) => ({ exitCode, stdout, isStdoutTruncated: false, ...extra });

  test('ok só com exitCode 0 e ok:true; os avisos e o estado voltam lidos', () => {
    const r = interpretarSaida(sai(`${JSON.stringify({ ok: true, estado: ESTADO, avisos: ['a', 'b'] })}\n`));
    assert.equal(r.classe, 'ok');
    assert.equal(r.estado.id, 'GM-12');
    assert.deepEqual(r.avisos, ['a', 'b']);
    assert.equal(interpretarSaida(sai(JSON.stringify({ ok: true, estado: ESTADO }), 1)).classe, 'ilegivel', 'rc ≠ 0 com ok:true é incoerente');
    assert.equal(interpretarSaida(sai(JSON.stringify({ ok: true, estado: { sem: 'id' }, avisos: [] }))).classe, 'ilegivel', 'estado sem forma');
    assert.equal(interpretarSaida(sai(JSON.stringify({ ok: true, avisos: [] }))).classe, 'ilegivel', 'sem estado');
  });

  test('sem loop: os 3 códigos; qualquer outro erro é `erro` com código e mensagem', () => {
    for (const erro of ['plano_ausente', 'entrega_nao_inferida', 'fora_de_repo']) {
      assert.equal(interpretarSaida(sai(JSON.stringify({ ok: false, erro, mensagem: 'm' }), 1)).classe, 'sem_loop', erro);
    }
    const r = interpretarSaida(sai(JSON.stringify({ ok: false, erro: 'diario_em_escrita', mensagem: 'tente de novo' }), 1));
    assert.deepEqual([r.classe, r.erro, r.mensagem], ['erro', 'diario_em_escrita', 'tente de novo']);
    assert.equal(interpretarSaida(sai(JSON.stringify({ ok: false, erro: 'uso', mensagem: 'x' }), 2)).classe, 'erro');
  });

  test('ilegível: não JSON, JSON não objeto, vazio e stdout truncado (mesmo com JSON válido)', () => {
    for (const s of ['', 'não é json', '[1]', 'null', '"x"', '{"ok":"talvez"}', '{"ok":false}']) assert.equal(interpretarSaida(sai(s)).classe, 'ilegivel', JSON.stringify(s));
    assert.equal(interpretarSaida(sai(JSON.stringify({ ok: true, estado: ESTADO, avisos: [] }), 0, { isStdoutTruncated: true })).classe, 'ilegivel');
    assert.equal(interpretarSaida(undefined).classe, 'ilegivel');
    assert.equal(interpretarSaida(null).classe, 'ilegivel');
  });

  test('classeDaFalha: ≥ 5000 ms decorridos ⇒ timeout; antes ⇒ nao_iniciou', () => {
    assert.equal(classeDaFalha(5000), 'timeout');
    assert.equal(classeDaFalha(12000), 'timeout');
    assert.equal(classeDaFalha(4999), 'nao_iniciou');
    assert.equal(classeDaFalha(0), 'nao_iniciou');
    assert.equal(classeDaFalha(Number.NaN), 'nao_iniciou');
  });

  test('textoDaFalha: uma linha por classe, distintas entre si, mensagem cortada, sem controle', () => {
    const t = {
      timeout: textoDaFalha({ classe: 'timeout' }),
      nao: textoDaFalha({ classe: 'nao_iniciou' }),
      ileg: textoDaFalha({ classe: 'ilegivel' }),
      erro: textoDaFalha({ classe: 'erro', erro: 'diario_em_escrita', mensagem: 'x'.repeat(500) }),
    };
    assert.equal(t.timeout, 'painel: leitura passou de 5 s');
    assert.equal(t.nao, 'painel: node não iniciou');
    assert.equal(t.ileg, 'painel: resposta ilegível');
    assert.match(t.erro, /^painel: diario_em_escrita: x+…?$/);
    assert.ok(t.erro.length <= 160, `mensagem cortada: ${t.erro.length}`);
    assert.equal(new Set(Object.values(t)).size, 4);
    assert.doesNotMatch(textoDaFalha({ classe: 'erro', erro: 'e', mensagem: 'a\x1b[2Jb\nc' }), /[\x00-\x1f]/);
  });
});

// ─── chaveMod / comandoParaPrompt / textoDoAviso ───
describe('chaveMod, comandoParaPrompt, textoDoAviso', () => {
  const parou = (chave, id = 'GM-12') => ({ id, parar: { chave, texto: 'teto de rodadas de review em T2', hora: '14:05', acoes: [] } });

  test('chave-com-id-da-entrega: `<id>|<chave>`; sem Parar ⇒ null', () => {
    assert.equal(chaveMod(parou('parar:s1:7')), 'GM-12|parar:s1:7');
    assert.notEqual(chaveMod(parou('computado:diario_invalido', 'GM-12')), chaveMod(parou('computado:diario_invalido', 'GM-13')));
    assert.equal(chaveMod({ id: 'GM-12', parar: null }), null);
    assert.equal(chaveMod(null), null);
    assert.equal(chaveMod({ id: 'GM-12' }), null);
  });

  test('botao-comando-node-com-raiz: `/…` igual; `node <plugin>/…` ⇒ `! node "<raiz>/…"`; raiz ruim ⇒ null', () => {
    assert.equal(comandoParaPrompt('/gabarito-mestre:liberar T2', ROOT), '/gabarito-mestre:liberar T2');
    assert.equal(comandoParaPrompt('/gabarito-mestre:liberar T2', null), '/gabarito-mestre:liberar T2', '`/…` não depende da raiz');
    assert.equal(comandoParaPrompt('node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-12', ROOT), `! node "${ROOT}/gates/scripts/entrega.mjs" executar --entrega GM-12`);
    for (const ruim of ['/opt/a"b', '/opt/a\nb', '/opt/a\x00b', '/opt/a$b', '/opt/a`b', '/opt/a\\b', '', null, undefined, 3]) {
      assert.equal(comandoParaPrompt('node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-12', ruim), null, `raiz ${JSON.stringify(ruim)}`);
    }
    for (const ruim of [null, undefined, '', 'rm -rf /', 'node /etc/x', 'bash <plugin>/x', '/ok\nruim', 'node <plugin>/a.mjs; rm x', 'node <plugin>/a.mjs $(x)', 3]) {
      assert.equal(comandoParaPrompt(ruim, ROOT), null, `comando ${JSON.stringify(ruim)}`);
    }
  });

  test('textoDoAviso: `gabarito: PAROU <id> · <texto da tabela>`', () => {
    assert.equal(textoDoAviso(parou('c')), 'gabarito: PAROU GM-12 · teto de rodadas de review em T2');
    assert.equal(textoDoAviso({ id: 'GM-9', parar: { texto: 'diário fora da tabela de transições' } }), 'gabarito: PAROU GM-9 · diário fora da tabela de transições');
  });
});

// ─── faixaDe / linhasDaPane / faixaCortada ───
const acao = (rotulo, comando) => ({ rotulo, comando });
const est = (o = {}) => ({
  id: 'GM-12', titulo: 'E4 Painel', pacote: 'Terra Média',
  plano: { tasks: [{ id: 'T1', titulo: 'a', estado: 'integrada', glifo: '✓', deps: [] }, { id: 'T2', titulo: 'b', estado: 'pendente', glifo: '○', deps: ['T1'] }], feitas: 1, total: 2, pct: 50, eta: { hora: '17:42', restanteS: 3600, maisMenosS: 600, n: 3 }, rodadaMedia: null, medianaS: null },
  equipe: { lider: { nome: 'GANDALF', modelo: 'opus', ctx: 36, x: 50, tok: 412000, h5: null, d7: 18, narrativa: 'esperando o loop' }, agentes: [], vivos: 0, revisoresAguardando: [], sombra: { nome: 'ELROND', modelo: 'opus', decisoes: 0, ultima: null } },
  parado: false, parar: null, depende: [], atencao: [], historico: [], ocultos: 0,
  rodape: { ci: { verde: null, execucoesHoje: 0 }, prod: { leituras: 0, alteracoes: 0 }, politica: 'continua' },
  notificacao: null, qualidade: { rodadaMedia: null, mortas: null },
  ...o,
});
const PAROU = () => est({ parado: true, parar: { motivo: 'teto_rodadas', texto: 'teto de rodadas de review em T2', acoes: [acao('aprovar', '/gabarito-mestre:liberar T2'), acao('recusar', null)], hora: '14:05', chave: 'parar:s1:7', emVoo: [], alteracoes: 0 } });
const DEP = (...itens) => est({ depende: itens.map(([motivo, acoes]) => ({ nivel: 'dono', motivo, acoes })) });

describe('faixaDe', () => {
  test('PAROU: texto com hora e motivo, cor error, botão da 1ª ação COM comando; qualquer Pane', () => {
    for (const pane of [true, false]) {
      const f = faixaDe(PAROU(), pane, null, { root: ROOT });
      assert.deepEqual([f.texto, f.cor, f.comando, f.rotulo], ['■ PAROU 14:05 teto de rodadas de review em T2', 'error', '/gabarito-mestre:liberar T2', 'aprovar']);
    }
    const e = PAROU();
    e.parar.acoes = [acao('veja', null), acao('depois', '/x:y 1')];
    assert.equal(faixaDe(e, true, null, {}).comando, '/x:y 1', 'pula ação sem comando');
    e.parar.acoes = [acao('veja', null)];
    const f = faixaDe(e, true, null, {});
    assert.deepEqual([f.cor, f.comando, f.rotulo], ['error', null, null], 'sem comando ⇒ sem botão, o PAROU fica');
    e.parar.acoes = [acao('executar', 'node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-12')];
    assert.equal(faixaDe(e, true, null, { root: '/a"b' }).comando, null, 'raiz inválida ⇒ sem botão (D-M4)');
    assert.equal(faixaDe(e, true, null, { root: ROOT }).comando, `! node "${ROOT}/gates/scripts/entrega.mjs" executar --entrega GM-12`);
  });

  test('PAROU com falha de leitura: continua `error` (um Parar visto não some por falha)', () => {
    assert.equal(faixaDe(PAROU(), false, { classe: 'timeout' }, {}).cor, 'error');
    assert.match(faixaDe(PAROU(), false, { classe: 'timeout' }, {}).texto, /^■ PAROU/);
  });

  test('depende de você: motivo do 1º, (+N) dos outros donos, warning, botão do 1º', () => {
    const f = faixaDe(DEP(['emenda #7 em REQ-PNL-4', [acao('aprovar', '/gabarito-mestre:emenda aprovar 7')]], ['loop pausado', [acao('retomar', '/gabarito retomar')]]), true, null, {});
    assert.deepEqual([f.texto, f.cor, f.comando, f.rotulo], ['depende de você: emenda #7 em REQ-PNL-4 (+1)', 'warning', '/gabarito-mestre:emenda aprovar 7', 'aprovar']);
    const um = faixaDe(DEP(['loop pausado', [acao('retomar', '/gabarito retomar')]]), true, null, {});
    assert.equal(um.texto, 'depende de você: loop pausado');
    const tres = faixaDe(DEP(['a', []], ['b', []], ['c', []]), true, null, {});
    assert.equal(tres.texto, 'depende de você: a (+2)');
    assert.deepEqual([tres.comando, tres.rotulo], [null, null]);
    const so = est({ depende: [{ nivel: 'parar', motivo: 'x', acoes: [] }] });
    assert.notEqual(faixaDe(so, true, null, {})?.cor, 'warning', 'item `parar` não é "depende de você"');
  });

  test('nada pendente: Pane visível ⇒ null; Pane fechada ⇒ `<id> N/M · ETA hh:mm` inactive (sem ETA ⇒ `<id> N/M`)', () => {
    assert.equal(faixaDe(est(), true, null, {}), null);
    const f = faixaDe(est(), false, null, {});
    assert.deepEqual([f.texto, f.cor, f.comando], ['GM-12 1/2 · ETA 17:42', 'inactive', null]);
    assert.equal(faixaDe(est({ plano: { ...est().plano, eta: null, feitas: 5, total: 9 } }), false, null, {}).texto, 'GM-12 5/9');
    assert.equal(faixaDe(est({ id: 'PBI-7' }), false, null, {}).texto, 'PBI-7 1/2 · ETA 17:42');
  });

  test('sem estado: falha ⇒ `painel: <falha curta>` warning só com a Pane fechada; sem falha ⇒ null', () => {
    assert.equal(faixaDe(null, false, null, {}), null);
    assert.equal(faixaDe(null, true, { classe: 'ilegivel' }, {}), null);
    const f = faixaDe(null, false, { classe: 'ilegivel' }, {});
    assert.deepEqual([f.texto, f.cor], ['painel: resposta ilegível', 'warning']);
  });

  test('prefs.ligado === false: só a linha de PAROU; o resto passa (Parar nunca em silêncio)', () => {
    assert.equal(faixaDe(PAROU(), true, null, { ligado: false }).cor, 'error');
    assert.equal(faixaDe(DEP(['x', []]), false, null, { ligado: false }), null);
    assert.equal(faixaDe(est(), false, null, { ligado: false }), null);
    assert.equal(faixaDe(DEP(['x', []]), false, null, { ligado: true }).cor, 'warning');
  });

  test('sem ESC no texto da faixa (limpar)', () => {
    const e = PAROU();
    e.parar.texto = 'x\x1b[2Jy\x07z';
    assert.doesNotMatch(faixaDe(e, true, null, {}).texto, /[\x00-\x1f\x7f]/);
    assert.doesNotMatch(faixaDe(est({ id: 'A\x1b[2J' }), false, null, {}).texto, /[\x00-\x1f\x7f]/);
  });
});

describe('faixaCortada', () => {
  test('texto cortado a bodyColumns − colunas(botão) − 1; botão nunca cortado; sem botão, a largura toda', () => {
    const longo = { texto: 'depende de você: ' + 'x'.repeat(100), cor: 'warning', comando: '/a:b', rotulo: 'aprovar' };
    const r = faixaCortada(longo, 60);
    assert.ok(r.texto.length + r.rotulo.length + 2 + 1 <= 60 + 1, `${r.texto.length}`);
    assert.equal(r.rotulo, 'aprovar');
    assert.ok(r.texto.length < longo.texto.length);
    const semBotao = faixaCortada({ ...longo, comando: null, rotulo: null }, 60);
    assert.equal(semBotao.texto.length, 60);
    assert.equal(faixaCortada({ texto: 'curto', cor: 'inactive', comando: null, rotulo: null }, 60).texto, 'curto');
    assert.ok(faixaCortada(longo, 1).texto.length >= 1 && faixaCortada(longo, 0).texto.length >= 1, 'largura inválida ⇒ pelo menos 1 coluna');
  });
});

describe('linhasDaPane', () => {
  const prefs = (o = {}) => ({ preset: 'esquadrao', tema: 'color', narracao: true, ligado: true, ...o });

  test('é o renderPainel do dist na largura pedida (o mod não projeta nada)', () => {
    const l = linhasDaPane(PAROU(), prefs(), 80);
    assert.match(texto(l), /PAROU/);
    assert.ok(l.every((x) => x.every((s) => typeof s.texto === 'string')));
    assert.notDeepEqual(linhasDaPane(PAROU(), prefs({ preset: 'executivo' }), 80).map((x) => x.map((s) => s.texto).join('')), l.map((x) => x.map((s) => s.texto).join('')), 'preset muda o desenho');
    const largura = linhasDaPane(PAROU(), prefs(), 60);
    assert.ok(largura.every((x) => x.reduce((n, s) => n + [...s.texto].length, 0) <= 60), 'respeita a largura');
  });

  test('mono: nenhum segmento com cor; color: com cor', () => {
    assert.deepEqual([...cores(linhasDaPane(PAROU(), prefs({ tema: 'mono' }), 80))], [null]);
    assert.ok(cores(linhasDaPane(PAROU(), prefs({ tema: 'color' }), 80)).has('error'));
  });

  test('largura inválida (0, negativa, NaN) vira 1: nunca lança, nunca devolve vazio sem aviso', () => {
    for (const larg of [0, -5, Number.NaN, undefined]) {
      const l = linhasDaPane(PAROU(), prefs(), larg);
      assert.ok(Array.isArray(l) && l.length > 0, `largura ${larg}`);
      assert.deepEqual(l.map((x) => x.map((s) => s.texto).join('')), linhasDaPane(PAROU(), prefs(), 1).map((x) => x.map((s) => s.texto).join('')), `largura ${larg} = largura 1`);
      assert.ok(linhasDaPane(PAROU(), prefs(), 3).map((x) => x.map((s) => s.texto).join('')).join('') !== l.map((x) => x.map((s) => s.texto).join('')).join(''), 'largura 1 ≠ largura 3');
    }
  });

  test('falha com estado anterior: linha de erro `warning` no topo; o resto `inactive`, menos os segmentos `error` do PAROU', () => {
    const l = linhasDaPane(PAROU(), prefs(), 80, { falha: { classe: 'timeout' } });
    assert.deepEqual(l[0], [{ texto: 'painel: leitura passou de 5 s', cor: 'warning' }]);
    const resto = l.slice(1).flat();
    assert.ok(resto.some((s) => s.cor === 'error'), 'o PAROU mantém `error`');
    assert.ok(resto.every((s) => s.cor === 'error' || s.cor === 'inactive'), `só error/inactive: ${[...new Set(resto.map((s) => s.cor))]}`);
    assert.ok(resto.filter((s) => s.cor === 'inactive').length > 3);
    const semParar = linhasDaPane(est(), prefs(), 80, { falha: { classe: 'ilegivel' } });
    assert.ok(semParar.slice(1).flat().every((s) => s.cor === 'inactive'), 'sem Parar: tudo inactive');
    assert.ok(!cores(semParar).has('error'));
    assert.ok(!semParar[0].some((s) => s.cor === 'error'), 'a linha de erro é warning (D6 reserva `error` ao Parar)');
  });

  test('falha sem estado anterior: só a linha de erro; sem loop: `sem loop nesta branch` inactive; nada ainda: lendo', () => {
    assert.deepEqual(linhasDaPane(null, prefs(), 80, { falha: { classe: 'nao_iniciou' } }), [[{ texto: 'painel: node não iniciou', cor: 'warning' }]]);
    assert.deepEqual(linhasDaPane(null, prefs(), 80, { semLoop: true }), [[{ texto: 'sem loop nesta branch', cor: 'inactive' }]]);
    assert.deepEqual(linhasDaPane(null, prefs({ tema: 'mono' }), 80, { semLoop: true }), [[{ texto: 'sem loop nesta branch' }]]);
    assert.match(texto(linhasDaPane(null, prefs(), 80, {})), /lendo/);
  });

  test('avisos: 1 linha `warning` no alto, `(+N)` com mais de um; a de erro vem antes', () => {
    const um = linhasDaPane(est(), prefs(), 80, { avisos: ['spec: ausente'] });
    assert.deepEqual(um[0], [{ texto: 'painel: aviso: spec: ausente', cor: 'warning' }]);
    const tres = linhasDaPane(est(), prefs(), 80, { avisos: ['a', 'b', 'c'] });
    assert.equal(tres[0][0].texto, 'painel: aviso: a (+2)');
    const ambos = linhasDaPane(est(), prefs(), 80, { avisos: ['a'], falha: { classe: 'timeout' } });
    assert.equal(ambos[0][0].texto, 'painel: leitura passou de 5 s');
    assert.equal(ambos[1][0].texto, 'painel: aviso: a');
    assert.equal(linhasDaPane(est(), prefs(), 80, { avisos: [] }).length, linhasDaPane(est(), prefs(), 80).length, 'sem avisos, sem linha extra');
  });

  test('sem-esc-no-text: ESC e controles nunca chegam ao texto (limpar), nem nas linhas de erro', () => {
    const e = est({ titulo: 'x\x1b[2Jy' });
    e.equipe.lider.narrativa = 'n\x1b[31mn';
    const l = linhasDaPane(e, prefs(), 80, { falha: { classe: 'erro', erro: 'e', mensagem: 'm\x1b[2J' }, avisos: ['a\x1b[2J'] });
    assert.doesNotMatch(texto(l), /[\x00-\x09\x0b-\x1f\x7f]/);
  });

  test('o limpar da Pane é defesa em profundidade: o renderPainel do dist já devolve texto sem controle (prova da mutação equivalente)', () => {
    const e = est({ titulo: 'x\x1b[2Jy' });
    e.equipe.lider.narrativa = 'n\x1b[31mn\x07';
    for (const preset of ['esquadrao', 'executivo']) {
      const cru = renderPainel(e, { preset, tema: 'color', narracao: true, largura: 80 });
      assert.doesNotMatch(cru.map((l) => l.map((s) => s.texto).join('')).join('\n'), /[\x00-\x09\x0b-\x1f\x7f]/, preset);
    }
  });

  test('estado torto ⇒ `painel: não consegui desenhar` em warning (nunca lança)', () => {
    const l = linhasDaPane({ id: 'x' }, prefs(), 80);
    assert.deepEqual(l, [[{ texto: 'painel: não consegui desenhar', cor: 'warning' }]]);
    assert.deepEqual(linhasDaPane({ id: 'x' }, prefs({ tema: 'mono' }), 80), [[{ texto: 'painel: não consegui desenhar' }]]);
  });
});

// ─── T11: comando, sorteio e transcripts (o que só o node prova) ───
describe('T11: pacotes de fábrica e funções puras do comando', () => {
  test('pacotes-fabrica-igual-ao-diretorio: PACOTES_FABRICA = mod/temas/nomes/*.json', () => {
    const dir = readdirSync(join(AQUI, '..', '..', 'mod', 'temas', 'nomes')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    assert.deepEqual([...PACOTES_FABRICA].sort(), dir);
  });

  test('caminhoDoTranscript: forma exata e recusa de dado torto', () => {
    const ok = { agent_id: 'ag-1', session_id: 'abc-123', transcript_path: '/h/proj/abc-123.jsonl' };
    assert.equal(caminhoDoTranscript(ok), '/h/proj/abc-123/subagents/agent-ag-1.jsonl');
    assert.equal(caminhoDoTranscript({ ...ok, transcript_path: '/x.jsonl' }), '/abc-123/subagents/agent-ag-1.jsonl');
    for (const torto of [{ agent_id: '../../x' }, { agent_id: 'a/b' }, { agent_id: '' }, { agent_id: 'x'.repeat(129) }, { agent_id: 5 }, { session_id: '../s' }, { session_id: 'a.b' }, { session_id: 's'.repeat(129) },
      { session_id: undefined }, { transcript_path: 'rel/x' }, { transcript_path: '' }, { transcript_path: null }, { transcript_path: 3 }, { transcript_path: undefined }]) {
      assert.equal(caminhoDoTranscript({ ...ok, ...torto }), null, JSON.stringify(torto));
    }
    assert.equal(caminhoDoTranscript(null), null);
    assert.equal(caminhoDoTranscript('x'), null);
    assert.equal(caminhoDoTranscript({ ...ok, agent_id: 'a.b_c-D9' }), '/h/proj/abc-123/subagents/agent-a.b_c-D9.jsonl');
  });

  test('inserirComTeto: teto de 64, sai o mais antigo, reinserir mantém a posição', () => {
    assert.equal(TETO_TRANSCRIPTS, 64);
    const m = new Map();
    for (let i = 0; i < 70; i++) inserirComTeto(m, `a${i}`, `/c${i}`);
    assert.equal(m.size, 64);
    assert.deepEqual([...m.keys()].slice(0, 2), ['a6', 'a7']);
    assert.equal([...m.keys()].at(-1), 'a69');
    inserirComTeto(m, 'a6', '/novo');
    assert.equal(m.get('a6'), '/novo');
    assert.equal([...m.keys()][0], 'a6');
    assert.equal(m.size, 64);
    const p = new Map([['x', '1'], ['y', '2']]);
    inserirComTeto(p, 'z', '3', 2);
    assert.deepEqual([...p.keys()], ['y', 'z']);
  });

  test('prefsValidas: ausente, corrompido e campo a campo', () => {
    assert.deepEqual(prefsValidas(undefined), { prefs: PREFS_PADRAO, estado: 'ausente' });
    for (const ruim of [7, 'x', null, [], true]) assert.deepEqual(prefsValidas(ruim), { prefs: PREFS_PADRAO, estado: 'corrompido' }, String(ruim));
    assert.deepEqual(prefsValidas({}), { prefs: PREFS_PADRAO, estado: 'ok' });
    const cheio = { preset: 'executivo', tema: 'mono', narracao: false, ligado: false, pacote: 'herois' };
    assert.deepEqual(prefsValidas(cheio), { prefs: cheio, estado: 'ok' });
    assert.deepEqual(prefsValidas({ ...cheio, preset: 'xx' }).prefs, { ...cheio, preset: 'esquadrao' });
    assert.deepEqual(prefsValidas({ ...cheio, tema: 'xx' }).prefs, { ...cheio, tema: 'color' });
    assert.deepEqual(prefsValidas({ ...cheio, narracao: 'sim' }).prefs, { ...cheio, narracao: true });
    assert.deepEqual(prefsValidas({ ...cheio, ligado: 0 }).prefs, { ...cheio, ligado: true });
    assert.deepEqual(prefsValidas({ ...cheio, pacote: '../x' }).prefs, { ...cheio, pacote: null });
    assert.deepEqual(prefsValidas({ ...cheio, pacote: 9 }).prefs, { ...cheio, pacote: null });
  });

  test('umaLinha: sem controle nem quebra, ≤ 200 colunas', () => {
    assert.equal(umaLinha('a\nb').includes('\n'), false);
    assert.equal(/[\r\n\x1b\u2028\u2029]/.test(umaLinha('x\r\ny\u2028z\x1b[2Jw')), false);
    assert.ok([...umaLinha('z'.repeat(500))].length <= 200);
    assert.equal(umaLinha('painel: color'), 'painel: color');
  });

  test('USO_GABARITO: ajuda do adotante, cada opção explicada, ≤ 14 linhas de ≤ 80 colunas, sem jargão interno', () => {
    const linhas = USO_GABARITO.split('\n');
    assert.ok(linhas.length <= 14, `linhas: ${linhas.length}`);
    for (const l of linhas) assert.ok([...l].length <= 80, `larga (${[...l].length}): ${l}`);
    const achar = (re) => linhas.find((l) => re.test(l)) ?? assert.fail(`sem linha ${re}`);
    assert.match(linhas[0], /^Uso: o painel abre sozinho ao lado quando uma entrega começa\.$/);
    assert.match(achar(/^\/gabarito painel {12}/), /abre o painel ou o traz de volta/);
    assert.match(USO_GABARITO, /esquadrao {2}detalhado: plano, equipe \(contexto e tokens\n {28}de cada agente\) e histórico/);
    assert.match(achar(/painel executivo/), /executivo {2}resumido/);
    assert.match(achar(/painel color/), /color {6}com cores {2}\(ou: mono, sem cores\)/);
    assert.match(achar(/narracao/), /narracao on\|off {3}liga ou desliga a narração/);
    assert.match(achar(/nomes/), /nomes <pacote> {4}troca os nomes da equipe/);
    assert.match(achar(/painel ligar/), /volta a abrir sozinho/);
    assert.match(achar(/painel desligar/), /não abre mais sozinho \(os avisos continuam\)/);
    assert.match(achar(/\/gabarito pausar/), /para o trabalho automático da entrega/);
    assert.match(achar(/\/gabarito retomar/), /continua de onde parou/);
    assert.doesNotMatch(USO_GABARITO, new RegExp(['Pane', '\\bmod\\b', 'preset', 'Sombra', 'Workflow' + ' TRUE', 'loop'].join('|'), 'i'));
  });
});

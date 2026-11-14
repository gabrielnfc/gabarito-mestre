/**
 * GM-14 T24: o runner do aceite A1 e a guarda das falas. Em `npm test`; o runner em si (`e2e/conversa-2026-11-11/rodar-a1.mjs`, `a1.exp`) fica FORA: abre
 * o TUI real. Aqui só o que é puro ou local: a forma de `pontos.json` (nunca a fala do dono), a guarda das falas em `git ls-files`, o "sem roteiro" que
 * diz por quê, a matriz de 8 células com o `placement` esperado e cada uma das asserções do A1 (uma evidência boa passa; a mesma, estragada num campo, reprova).
 *
 * O ESPERADO VEM DA SPEC (Aceite A1, matriz r4): 12 asserções por execução (a 8 tem 6), `placement` `dock` só em 180×50 tela cheia, `inline` nas outras 3 `lateral`,
 * 0 Pane em `acima`; passa = 8/8. As falas do roteiro (`.superpowers/`, fora do git) NUNCA são copiadas para cá: os casos de guarda usam roteiro sintético.
 * MUTAÇÃO PRESCRITA: M21 (apagar a guarda das falas) ⇒ `guarda-falas-em-ls-files` e `runner-guarda-barra-fala-versionada` reprovam.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSERCOES, LINHA_DECISAO, MATRIZ, resumoDoAgora, MIN_FALA, PONTOS_ARQ, ROTEIRO_REL, TOTAL_PONTOS, acoesDe, avaliarExecucao, avaliarMatriz, coletar, dialogosDoExpLog, entradaDoSnapshot, falasDoRoteiro, guardaFalas, idDaCelula,
  itensDeProxima, placementEsperado, pluginCarregou, resolverSuperpowers, ambienteDaExecucao, SUPERPOWERS_VERSAO, matriz, configDaConta, pastaDeTranscripts, propsDe, publicadaPeloProduto, raizPrincipal, renderizar, semearEntregaPublicada, sha256, validarPontos, verificarRoteiro,
} from './e2e/conversa-2026-11-11/rodar-a1.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(AQUI, 'e2e', 'conversa-2026-11-11', 'rodar-a1.mjs');
const TMPS = [];
after(() => { for (const d of TMPS) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'conversa-pontos-')); TMPS.push(d); return d; };
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Roteiro sintético no formato do real (tabela `| # | hora | mensagem | ponto? | por quê |`); as falas são inventadas aqui. */
const FALA_A = 'esta fala sintética tem mais de vinte caracteres';
const FALA_B = 'outra fala sintética de teste, também longa';
const ROTEIRO = [
  '# Roteiro sintético', '',
  '| # | hora | mensagem | ponto? | por quê |', '|---|---|---|---|---|',
  `| 1 | 07:38:21 | ${FALA_A} | MUDANÇA DE ASSUNTO | teste |`,
  '| 2 | 07:40:15 | ok | — | teste |',
  `| 3 | 08:01:44 | ${FALA_B} | DECISÃO | teste |`, '',
].join('\n');
const pontosValidos = () => ({
  roteiroSha256: 'a'.repeat(64),
  pontos: Array.from({ length: TOTAL_PONTOS }, (_, i) => ({ msg: i + 1, sha256: 'b'.repeat(64), chars: 10 + i, esperado: { fase: null, progresso: '', depende: [], origens: [] } })),
});

describe('forma de pontos.json: o texto do dono nunca entra', () => {
  test('pontos-so-chaves-permitidas', () => {
    assert.deepEqual(validarPontos(pontosValidos()), []);
    const real = JSON.parse(readFileSync(PONTOS_ARQ, 'utf8'));
    assert.deepEqual(validarPontos(real), [], 'o pontos.json do repositório tem só as chaves permitidas');
    for (const chave of ['fala', 'texto']) {
      const ponto = pontosValidos(); ponto.pontos[3][chave] = 'x';
      assert.match(validarPontos(ponto).join(';'), new RegExp(`pontos\\[3\\]: chaves .*${chave}`), `chave ${chave} em ponto`);
      const esp = pontosValidos(); esp.pontos[5].esperado[chave] = 'x';
      assert.match(validarPontos(esp).join(';'), new RegExp(`pontos\\[5\\]\\.esperado: chaves .*${chave}`), `chave ${chave} em esperado`);
    }
    const raiz = pontosValidos(); raiz.fala = 'x';
    assert.match(validarPontos(raiz).join(';'), /chaves da raiz/);
    const falta = pontosValidos(); delete falta.pontos[0].chars;
    assert.match(validarPontos(falta).join(';'), /pontos\[0\]: chaves/, 'chave a menos também reprova');
  });

  test('pontos-sha-e-chars-na-forma', () => {
    const casos = [
      ['sha256 curto', (p) => { p.pontos[0].sha256 = 'abc'; }, /pontos\[0\]\.sha256/],
      ['sha256 maiúsculo', (p) => { p.pontos[1].sha256 = 'B'.repeat(64); }, /pontos\[1\]\.sha256/],
      ['chars zero', (p) => { p.pontos[2].chars = 0; }, /pontos\[2\]\.chars/],
      ['chars fracionário', (p) => { p.pontos[2].chars = 1.5; }, /pontos\[2\]\.chars/],
      ['msg texto (a fala no lugar do número)', (p) => { p.pontos[4].msg = 'uma fala qualquer do dono'; }, /pontos\[4\]\.msg/],
      ['msg repetido', (p) => { p.pontos[6].msg = 1; }, /msg repetido/],
      ['roteiroSha256 inválido', (p) => { p.roteiroSha256 = 'zz'; }, /roteiroSha256/],
      ['fase 8', (p) => { p.pontos[7].esperado.fase = 8; }, /fase/],
      ['depende com não texto', (p) => { p.pontos[8].esperado.depende = [1]; }, /depende/],
      ['origens não lista', (p) => { p.pontos[9].esperado.origens = 'x'; }, /origens/],
      ['25 pontos', (p) => { p.pontos.pop(); }, /25 pontos/],
    ];
    for (const [nome, estraga, re] of casos) {
      const p = pontosValidos(); estraga(p);
      assert.match(validarPontos(p).join(';'), re, nome);
    }
    const real = JSON.parse(readFileSync(PONTOS_ARQ, 'utf8'));
    assert.equal(real.pontos.length, TOTAL_PONTOS);
    assert.match(real.roteiroSha256, /^[0-9a-f]{64}$/);
  });

  test('pontos-nao-repete-fala-do-roteiro (quando o roteiro local existe)', (t) => {
    const arq = join(raizPrincipal(AQUI), ROTEIRO_REL);
    if (!existsSync(arq)) return t.skip('roteiro local ausente: a guarda do runner o exige antes de rodar');
    const conteudo = readFileSync(arq, 'utf8');
    const real = JSON.parse(readFileSync(PONTOS_ARQ, 'utf8'));
    const strings = JSON.stringify(real).split('"').filter((s) => [...s].length >= MIN_FALA);
    assert.deepEqual(strings.filter((s) => conteudo.includes(s)), [], 'nenhuma string de pontos.json com ≥ 20 caracteres está no roteiro');
    assert.equal(real.roteiroSha256, sha256(conteudo), 'o sha256 do roteiro bate com o do arquivo local');
    const falas = falasDoRoteiro(conteudo);
    assert.equal(falas.length, 62);
    for (const p of real.pontos) {
      const f = falas.find((x) => x.n === p.msg);
      assert.ok(f, `msg ${p.msg} existe no roteiro`);
      assert.equal(p.sha256, sha256(f.texto), `sha256 do ponto ${p.msg}`);
      assert.equal(p.chars, [...f.texto].length, `chars do ponto ${p.msg}`);
      assert.notEqual(f.rotulo, '—', `o ponto ${p.msg} é ponto de controle`);
    }
  });
});

describe('guarda das falas', () => {
  test('roteiro-sintetico-no-formato-real', () => {
    const f = falasDoRoteiro(ROTEIRO);
    assert.deepEqual(f.map((x) => [x.n, x.rotulo, x.texto]), [[1, 'MUDANÇA DE ASSUNTO', FALA_A], [2, '—', 'ok'], [3, 'DECISÃO', FALA_B]]);
  });

  test('guarda-falas-em-ls-files', () => {
    const repo = tmp();
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.md'), 'nada aqui\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'base');
    const falas = falasDoRoteiro(ROTEIRO);
    const limpo = guardaFalas(repo, falas);
    assert.equal(limpo.ok, true, 'sem fala plantada, passa');
    assert.deepEqual(limpo.achados, []);
    assert.equal(limpo.conferidas, 2, 'só as falas com ≥ 20 caracteres entram (a 2 tem 2)');
    // 1 fala plantada num arquivo versionado
    writeFileSync(join(repo, 'doc.md'), `texto\n${FALA_B}\nfim\n`);
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'planta');
    const sujo = guardaFalas(repo, falas);
    assert.equal(sujo.ok, false);
    assert.deepEqual(sujo.achados, [{ arquivo: 'doc.md', n: 3 }]);
    // fala curta (< 20) no arquivo não conta
    writeFileSync(join(repo, 'curta.md'), 'ok\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'curta');
    assert.equal(guardaFalas(repo, falas).achados.length, 1);
    // arquivo NÃO versionado com a fala não conta (a guarda é de `git ls-files`)
    const outro = tmp();
    git(outro, 'init', '-q', '-b', 'main');
    writeFileSync(join(outro, 'x.md'), 'x\n'); git(outro, 'add', '-A'); git(outro, 'commit', '-q', '-m', 'b');
    writeFileSync(join(outro, 'solto.md'), FALA_A);
    assert.equal(guardaFalas(outro, falas).ok, true, 'fala só em arquivo não rastreado não é achado');
  });

  test('runner-guarda-barra-fala-versionada: o CLI recusa e diz onde (M21)', () => {
    // o runner real, sobre a worktree real, com um roteiro sintético cujo sha é o de pontos.json: o roteiro precisa bater com o sha gravado,
    // então o caso usa um pontos.json sintético apontado por `--pontos`.
    const pasta = tmp();
    const roteiro = join(pasta, 'roteiro.md');
    writeFileSync(roteiro, ROTEIRO);
    const pontos = pontosValidos(); pontos.roteiroSha256 = sha256(ROTEIRO);
    const arqPontos = join(pasta, 'pontos.json');
    writeFileSync(arqPontos, JSON.stringify(pontos));
    const repo = join(pasta, 'repo');
    execFileSync('mkdir', [repo]);
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'doc.md'), FALA_A); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'planta');
    const r = spawnSync(process.execPath, [RUNNER, '--guarda', '--roteiro', roteiro, '--pontos', arqPontos, '--raiz', repo], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /falas do roteiro em arquivos versionados: doc\.md#1/);
    // sem a fala versionada, a guarda passa e o CLI diz o que conferiu
    writeFileSync(join(repo, 'doc.md'), 'limpo\n'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'limpa');
    const ok = spawnSync(process.execPath, [RUNNER, '--guarda', '--roteiro', roteiro, '--pontos', arqPontos, '--raiz', repo], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /guarda das falas: 0 achados \(2 falas/);
  });

  test('runner-sem-roteiro-diz-por-que', () => {
    const pasta = tmp();
    const arqPontos = join(pasta, 'pontos.json');
    const pontos = pontosValidos(); pontos.roteiroSha256 = sha256(ROTEIRO);
    writeFileSync(arqPontos, JSON.stringify(pontos));
    // `--guarda` (nunca `--matriz`): se uma mutação do runner deixar a verificação passar, o teste não abre sessão real do Claude Code
    // ausente
    const ausente = spawnSync(process.execPath, [RUNNER, '--guarda', '--roteiro', join(pasta, 'nao-existe.md'), '--pontos', arqPontos], { encoding: 'utf8' });
    assert.equal(ausente.status, 1);
    assert.match(ausente.stderr, /A1 não roda: roteiro ausente: .*nao-existe\.md/);
    // sha diferente
    const outro = join(pasta, 'outro.md');
    writeFileSync(outro, `${ROTEIRO}\n| 4 | 09:00:00 | uma linha a mais no roteiro | — | x |\n`);
    const diff = spawnSync(process.execPath, [RUNNER, '--guarda', '--roteiro', outro, '--pontos', arqPontos], { encoding: 'utf8' });
    assert.equal(diff.status, 1);
    assert.match(diff.stderr, /A1 não roda: roteiro com sha256 diferente do de pontos\.json/);
    // as duas pelas funções puras
    assert.equal(verificarRoteiro(join(pasta, 'x'), 'a'.repeat(64)).ok, false);
    assert.equal(verificarRoteiro(outro, sha256(ROTEIRO)).ok, false);
    assert.equal(verificarRoteiro(join(pasta, 'roteiro.md'), 'a'.repeat(64)).motivo.startsWith('roteiro ausente'), true);
    writeFileSync(join(pasta, 'roteiro.md'), ROTEIRO);
    const bom = verificarRoteiro(join(pasta, 'roteiro.md'), sha256(ROTEIRO));
    assert.equal(bom.ok, true);
    assert.equal(bom.falas.length, 3);
    // uso sem modo
    const semModo = spawnSync(process.execPath, [RUNNER], { encoding: 'utf8' });
    assert.equal(semModo.status, 2);
  });

  test('guarda-roda-no-repo-real: nenhuma fala do roteiro local em git ls-files (quando o roteiro existe)', (t) => {
    const raiz = raizPrincipal(AQUI);
    const arq = join(raiz, ROTEIRO_REL);
    if (!existsSync(arq)) return t.skip('roteiro local ausente');
    const g = guardaFalas(execFileSync('git', ['-C', AQUI, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), falasDoRoteiro(readFileSync(arq, 'utf8')));
    assert.deepEqual(g.achados, []);
    assert.ok(g.conferidas >= 20, `${g.conferidas} falas conferidas`);
  });
});

describe('matriz do A1: 8 execuções, passa = 8/8', () => {
  test('oito-celulas-distintas-local-tamanho-tela-cheia', () => {
    assert.equal(MATRIZ.length, 8);
    assert.equal(new Set(MATRIZ.map(idDaCelula)).size, 8);
    for (const local of ['lateral', 'acima']) for (const tam of [[80, 24], [180, 50]]) for (const cheia of [true, false]) {
      assert.equal(MATRIZ.filter((c) => c.local === local && c.cols === tam[0] && c.rows === tam[1] && c.cheia === cheia).length, 1, `${local} ${tam} ${cheia}`);
    }
  });

  test('placement-da-pane-por-celula (spec: dock só em 180x50 cheia; inline nas outras 3 lateral; 0 Pane em acima)', () => {
    const por = Object.fromEntries(MATRIZ.map((c) => [idDaCelula(c), placementEsperado(c)]));
    assert.deepEqual(por, {
      'lateral-80x24-cheia': 'inline', 'lateral-80x24-normal': 'inline', 'lateral-180x50-cheia': 'dock', 'lateral-180x50-normal': 'inline',
      'acima-80x24-cheia': null, 'acima-80x24-normal': null, 'acima-180x50-cheia': null, 'acima-180x50-normal': null,
    });
  });

  test('avaliarMatriz-7-de-8-nao-passa-e-celula-ausente-conta-falha', () => {
    const todas = MATRIZ.map((c) => ({ celula: idDaCelula(c), passa: true, resultados: [] }));
    assert.deepEqual([avaliarMatriz(todas).passou, avaliarMatriz(todas).ok], [8, true]);
    const sete = clone(todas); sete[3].passa = false; sete[3].resultados = [{ id: 'x', ok: false }];
    const r7 = avaliarMatriz(sete);
    assert.deepEqual([r7.passou, r7.ok], [7, false]);
    assert.equal(r7.linhas[3].motivo, 'x');
    const faltando = avaliarMatriz(todas.slice(0, 7));
    assert.deepEqual([faltando.passou, faltando.ok], [7, false], 'combinação não desenhada/não executada conta como falha');
    assert.equal(faltando.linhas[7].motivo, 'não executada');
  });
});

// ─── asserções do A1: evidência boa passa; a mesma, estragada num campo, reprova ───

const QUADRO_CHEIO = [
  'GABARITO · GM-13', 'depende de você: aprovar a spec · 1 sim · 2 não', 'PRONTO ▰▰▱▱ 2 de 4 integradas',
  'AGORA · Gandalf · contexto 40 %', '  Frodo · T3 · lendo 2 arquivos', 'ATENÇÃO · T3 parou',
  'RECENTE · 10:00 ✓ Gandalf integrou T1 (automático)', '  09:50 ● ELROND decidiu: escopo da T2 (anotado pelo orquestrador)',
];
const evBoa = (celula = { local: 'lateral', cols: 180, rows: 50, cheia: true }) => ({
  celula,
  quadros: [{ linhas: QUADRO_CHEIO, itensDepende: 1 }],
  integradas: ['T1', 'T2'],
  eventos: [
    { tipo: 'task.iniciada', dados: { task: 'T3', papel: 'implementador' } },
    { tipo: 'task.iniciada', dados: { task: 'T3', papel: 'revisor' } },
    { tipo: 'review.veredito', dados: { task: 'T3', veredito: 'APROVADO' } },
    { tipo: 'dono.mensagem', dados: { sha256: 'a'.repeat(64), chars: 30 } },
    { tipo: 'decisao.sombra', dados: { resposta: 'escopo da T2' } },
  ],
  digitadas: ['a'.repeat(64)],
  transcript: { chamadas: [{ nome: 'Agent', negada: false, turnoDeStatus: true }, { nome: 'Write', entrada: { file_path: '/r/src/a.mjs' } }], textos: ['pronto, segue o plano'] },
  perguntas: [{ ponto: 1, rotulo: 'MUDANÇA DE ASSUNTO', abriuPergunta: true, botoes: true }, { ponto: 2, rotulo: 'DECISÃO', abriuPergunta: false, botoes: false }],
  despachos: [{ papel: 'implementador', prompt: 'brief ... regra A ... regra B', aprendizados: ['regra A', 'regra B'] }],
  entregasPublicadas: ['GM-13'], gravacoes: { 'GM-13': { antes: 5, depois: 5 }, '_sem-id': { antes: 0, depois: 9 } },
  quadrosSemProps: 0,
  vivos: [{ ativos: 0, linhasAgente: 0, detalhes: [] }, { ativos: 1, linhasAgente: 1, detalhes: [{ nome: 'Frodo', descricao: 'implementa T3', task: 'T3', acao: 'lendo 2 arquivos' }] }],
  pouso: { percent: 50, limparNoDepende: true, pushes: 1, despachosDepois: 0 },
  panes: [{ placement: placementEsperado(celula) ?? 'x' }].filter(() => placementEsperado(celula) !== null),
  panesObservadas: true,
  placementsDebug: celula.local === 'acima' ? [] : [{ colunas: celula.cols, estado: 'placed' }],
});

describe('asserções do A1 sobre a evidência de uma execução', () => {
  test('doze-assercoes-da-spec-dezessete-ids (a 8 tem 6)', () => {
    assert.equal(ASSERCOES.length, 17);
    assert.deepEqual([...new Set(ASSERCOES.map((a) => a.ref.replace(/ Emenda 1$/, '')))].sort(), ['A1 (1)', 'A1 (10)', 'A1 (11)', 'A1 (12)', 'A1 (2)', 'A1 (3)', 'A1 (4)', 'A1 (5)', 'A1 (6)', 'A1 (7)', 'A1 (8)', 'A1 (9)']);
    assert.equal(ASSERCOES.filter((a) => a.ref === 'A1 (8) Emenda 1').length, 6);
  });

  test('evidencia-boa-passa-nas-8-celulas', () => {
    for (const c of MATRIZ) {
      const ev = evBoa(c);
      // 80×24: o RECENTE sai, mas a decisão da Sombra fica reservada em 1 linha (T42, emenda 32) e o AGORA compacta em `N agentes:` quando precisa (emenda 37)
      if (c.cols === 80) ev.quadros = [{ linhas: [...QUADRO_CHEIO.slice(0, 5), QUADRO_CHEIO[7].replace(/^ {2}/, 'RECENTE · ')], itensDepende: 1 }];
      const r = avaliarExecucao(ev);
      assert.deepEqual(r.resultados.filter((x) => !x.ok).map((x) => x.id), [], idDaCelula(c));
      assert.equal(r.passa, true);
    }
  });

  const estraga = {
    '1-depende-no-topo': (ev) => { ev.quadros[0].linhas = [QUADRO_CHEIO[0], QUADRO_CHEIO[2], QUADRO_CHEIO[1], ...QUADRO_CHEIO.slice(3)]; },
    '2-blocos-e-corte': (ev) => { ev.quadros[0].linhas = QUADRO_CHEIO.filter((l) => !/^PRONTO/.test(l)); },
    '3-sem-task-integrada': (ev) => { ev.quadros[0].linhas = [...QUADRO_CHEIO.slice(0, 5), 'ATENÇÃO · T1 parou', ...QUADRO_CHEIO.slice(6)]; },
    '4-agora-ativos': (ev) => { ev.vivos[1].detalhes.push({ nome: 'Frodo', descricao: 'd', task: 'T4', acao: '(registrado)' }); },
    '5-sem-emoji': (ev) => { ev.transcript.textos.push('feito ✅'); },
    '6-assunto-vira-pergunta': (ev) => { ev.perguntas[0].botoes = false; },
    '7-sem-edit-em-harness-nem-status-a-mao': (ev) => { ev.transcript.chamadas.push({ nome: 'Edit', entrada: { file_path: '/r/.harness/entregas/GM-13/plano.json' } }); },
    '8a-dono-mensagem-sem-duplicata': (ev) => { ev.eventos.push({ tipo: 'dono.mensagem', dados: { sha256: 'a'.repeat(64), chars: 30 } }); },
    '8b-agent-nao-negado-em-status': (ev) => { ev.transcript.chamadas[0].negada = true; },
    '8c-nada-em-entrega-publicada': (ev) => { ev.gravacoes['GM-13'].depois = 6; },
    '8d-vivo-com-nome-descricao-task': (ev) => { ev.vivos[1].detalhes[0].descricao = ''; },
    '8e-vivos-igual-linhas-de-agente': (ev) => { ev.vivos[1].linhasAgente = 2; },
    '8f-sombra-decisao-visivel': (ev) => { ev.quadros[0].linhas = QUADRO_CHEIO.filter((l) => !/decidiu:/.test(l)); },
    '9-veredito-com-revisor-antes': (ev) => { ev.eventos.splice(1, 1); },
    '10-despachos-com-aprendizados': (ev) => { ev.despachos[0].prompt = 'brief sem as regras'; },
    '11-pouso-a-50': (ev) => { ev.pouso.despachosDepois = 1; },
    '12-placement-da-pane': (ev) => { ev.panes = [{ placement: 'inline' }]; },
  };

  for (const a of ASSERCOES) {
    test(`asserção ${a.id}: boa passa, estragada reprova (e só ela)`, () => {
      const boa = evBoa();
      assert.equal(a.avaliar(boa).ok, true, `boa: ${a.avaliar(boa).detalhe}`);
      const mau = evBoa();
      assert.ok(estraga[a.id], `há como estragar ${a.id}`);
      estraga[a.id](mau);
      const r = a.avaliar(mau);
      assert.equal(r.ok, false, `estragada: ${r.detalhe}`);
      assert.equal(typeof r.detalhe, 'string');
    });
  }

  test('cada-estrago-reprova-a-execucao-pelo-id-certo', () => {
    for (const a of ASSERCOES) {
      const mau = evBoa(); estraga[a.id](mau);
      const r = avaliarExecucao(mau);
      assert.equal(r.passa, false, a.id);
      assert.ok(r.resultados.find((x) => x.id === a.id && !x.ok), `${a.id} reprovada`);
    }
  });

  test('placement-incoerente-reprova-nas-quatro-lateral-e-pane-em-acima', () => {
    const casos = [
      [{ local: 'lateral', cols: 180, rows: 50, cheia: true }, [{ placement: 'inline' }], false],
      [{ local: 'lateral', cols: 180, rows: 50, cheia: false }, [{ placement: 'dock' }], false],
      [{ local: 'lateral', cols: 80, rows: 24, cheia: true }, [{ placement: 'dock' }], false],
      [{ local: 'lateral', cols: 80, rows: 24, cheia: false }, [{ placement: 'inline' }], true],
      [{ local: 'lateral', cols: 80, rows: 24, cheia: false }, [], false],
      [{ local: 'lateral', cols: 180, rows: 50, cheia: true }, [{ placement: 'dock' }, { placement: 'dock' }], false],
      [{ local: 'acima', cols: 180, rows: 50, cheia: true }, [{ placement: 'dock' }], false],
      [{ local: 'acima', cols: 180, rows: 50, cheia: true }, [], true],
    ];
    const a12 = ASSERCOES.find((a) => a.id === '12-placement-da-pane');
    for (const [c, panes, esperado] of casos) {
      const ev = evBoa(c); ev.panes = panes;
      assert.equal(a12.avaliar(ev).ok, esperado, `${idDaCelula(c)} ${JSON.stringify(panes)}`);
    }
  });

  test('evidencia-malformada-reprova-nunca-passa-em-silencio', () => {
    const r = avaliarExecucao({ celula: { local: 'lateral', cols: 80, rows: 24, cheia: false } });
    assert.equal(r.passa, false);
    assert.ok(r.resultados.every((x) => x.ok === false), 'toda asserção reprova sem evidência');
    assert.match(r.resultados[0].detalhe, /evidência malformada/);
  });

  test('8f-80x24-segue-estrita: sem a linha reservada da decisão da Sombra a execução reprova', () => {
    const ev = evBoa({ local: 'lateral', cols: 80, rows: 24, cheia: false });
    ev.quadros = [{ linhas: QUADRO_CHEIO.slice(0, 5), itensDepende: 1 }];
    assert.equal(ASSERCOES.find((a) => a.id === '8f-sombra-decisao-visivel').avaliar(ev).ok, false);
  });

  test('2-80x24-recente-so-como-a-decisao-reservada: 2 linhas de RECENTE ou RECENTE que não é decisão reprovam', () => {
    const a2 = ASSERCOES.find((a) => a.id === '2-blocos-e-corte');
    const c = { local: 'lateral', cols: 80, rows: 24, cheia: false };
    const dec = QUADRO_CHEIO[7].replace(/^ {2}/, 'RECENTE · ');
    const q = (linhas) => { const ev = evBoa(c); ev.quadros = [{ linhas, itensDepende: 1 }]; return a2.avaliar(ev).ok; };
    assert.equal(q([...QUADRO_CHEIO.slice(0, 5), dec]), true);
    assert.equal(q([...QUADRO_CHEIO.slice(0, 5), dec, '  09:40 ✓ Sam integrou T0 (automático)']), false, '2 linhas de RECENTE');
    assert.equal(q([...QUADRO_CHEIO.slice(0, 5), QUADRO_CHEIO[6]]), false, 'RECENTE que não é a decisão');
  });

  describe('forma compacta do AGORA (T42, emenda 37): `N agentes:` com a reserva da Sombra', () => {
    const det = [{ nome: 'Frodo', descricao: 'implementa T3', task: 'T3', acao: 'lendo 2 arquivos' }, { nome: 'Sam', descricao: 'revisa T2', task: 'T2', acao: 'revisando' }, { nome: 'Merry', descricao: 'corrige T4', task: 'T4', acao: 'editando' }];
    const compacto = (resumo) => { const ev = evBoa(); ev.vivos = [{ ativos: 3, linhasAgente: 3, detalhes: det, resumo }]; return ev; };
    const boa = { n: 3, itens: [{ rotulo: 'Frodo', task: 'T3' }, { rotulo: 'Sam', task: 'T2' }, { rotulo: 'Merry', task: 'T4' }], truncada: false };
    const ids = ['4-agora-ativos', '8d-vivo-com-nome-descricao-task', '8e-vivos-igual-linhas-de-agente'];
    const r = (ev, id) => ASSERCOES.find((a) => a.id === id).avaliar(ev);

    test('resumoDoAgora-le-o-que-o-produto-desenha', () => {
      assert.deepEqual(resumoDoAgora(['AGORA · Gandalf · contexto 40 %', '  3 agentes: Frodo T3 · Sam T2 · Merry T4']), boa);
      assert.deepEqual(resumoDoAgora(['  3 agentes: Frodo T3 · Sam T2 …']), { n: 3, itens: [{ rotulo: 'Frodo', task: 'T3' }, { rotulo: 'Sam', task: 'T2' }], truncada: true });
      assert.equal(resumoDoAgora(['AGORA · Gandalf · contexto 40 %', '  Frodo · T3 · lendo 2 arquivos']), null);
      assert.equal(resumoDoAgora(null), null);
    });

    test('compacto-bom-passa-em-4-8d-8e (a ação e a descrição saem, declarado)', () => {
      const ev = compacto(boa);
      ev.vivos[0].detalhes = det.map((d) => ({ ...d, acao: null, descricao: '' }));
      for (const id of ids) assert.equal(r(ev, id).ok, true, `${id}: ${r(ev, id).detalhe}`);
    });

    test('compacto-truncado-confere-so-os-visiveis-e-N-segue-vivos', () => {
      const ev = compacto({ n: 3, itens: boa.itens.slice(0, 2), truncada: true });
      for (const id of ids) assert.equal(r(ev, id).ok, true, `${id}: ${r(ev, id).detalhe}`);
    });

    test('mutacao N≠vivos: a 8e reprova', () => {
      assert.equal(r(compacto({ ...boa, n: 2 }), ids[2]).ok, false);
    });

    test('rotulo ou task trocados no resumo: 4 e 8d reprovam', () => {
      for (const resumo of [{ ...boa, itens: [{ rotulo: 'Gimli', task: 'T3' }, ...boa.itens.slice(1)] }, { ...boa, itens: [{ rotulo: 'Frodo', task: 'T9' }, ...boa.itens.slice(1)] }]) {
        const ev = compacto(resumo);
        assert.equal(r(ev, ids[0]).ok, false);
        assert.equal(r(ev, ids[1]).ok, false);
      }
    });

    test('segundo plano no fim do resumo (Teste) não é conferido como agente', () => {
      const ev = compacto({ ...boa, itens: [...boa.itens, { rotulo: 'Teste', task: 'orquestrador' }] });
      for (const id of ids) assert.equal(r(ev, id).ok, true, `${id}: ${r(ev, id).detalhe}`);
    });

    test('coleta-liga-o-resumo-do-quadro-renderizado-ao-ponto', async () => {
      const ev = await coleta({});
      assert.equal(ev.vivos[0].resumo, null, 'a lateral cheia do roteiro de teste não compacta');
    });
  });

  test('1-item-de-depende-cortado-do-topo-reprova', () => {
    const ev = evBoa(); ev.quadros = [{ linhas: QUADRO_CHEIO.filter((l) => !/^depende/.test(l)), itensDepende: 1 }];
    assert.equal(ASSERCOES.find((a) => a.id === '1-depende-no-topo').avaliar(ev).ok, false);
  });

  test('2-recente-acima-do-teto-ou-sem-origem-reprova', () => {
    const a2 = ASSERCOES.find((a) => a.id === '2-blocos-e-corte');
    const acima = evBoa({ local: 'acima', cols: 180, rows: 50, cheia: true });
    acima.quadros = [{ linhas: [...QUADRO_CHEIO, '  09:40 ✓ Sam integrou T0 (automático)'], itensDepende: 1 }];
    assert.equal(a2.avaliar(acima).ok, false, '3 linhas de RECENTE em acima (teto 2)');
    const lateral = evBoa(); lateral.quadros = [{ linhas: [...QUADRO_CHEIO.slice(0, 7), '  09:50 ● ELROND decidiu: escopo da T2'], itensDepende: 1 }];
    assert.equal(a2.avaliar(lateral).ok, false, 'RECENTE sem origem');
    const oitenta = evBoa({ local: 'lateral', cols: 80, rows: 24, cheia: false });
    oitenta.quadros = [{ linhas: [QUADRO_CHEIO[0], QUADRO_CHEIO[1], QUADRO_CHEIO[3]], itensDepende: 1 }];
    assert.equal(a2.avaliar(oitenta).ok, false, '80×24 sem o bloco PRONTO');
  });

  test('10-sem-despacho-nenhum-reprova (não é vácuo)', () => {
    const ev = evBoa(); ev.despachos = [];
    assert.equal(ASSERCOES.find((a) => a.id === '10-despachos-com-aprendizados').avaliar(ev).ok, false);
  });
});

// ─── a guarda: fronteira dos 20 caracteres e arquivos que ela não lê ───

describe('guarda das falas: fronteira e ignorados', () => {
  const comTamanho = (n) => 'x'.repeat(n);
  const roteiroCom = (txt) => falasDoRoteiro(`| # | h | m | p | q |\n| 1 | 07:38:21 | ${txt} | DECISÃO | t |\n`);

  test('fronteira-de-20-caracteres (P1: >= virar > ⇒ este teste reprova)', () => {
    const repo = tmp();
    git(repo, 'init', '-q', '-b', 'main');
    const f19 = comTamanho(19); const f20 = comTamanho(20);
    writeFileSync(join(repo, 'a.md'), `${f19}\n`); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'a');
    assert.equal(guardaFalas(repo, roteiroCom(f19)).conferidas, 0, '19 caracteres: não entra na guarda');
    assert.equal(guardaFalas(repo, roteiroCom(f19)).ok, true);
    writeFileSync(join(repo, 'b.md'), `${f20}\n`); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'b');
    const g = guardaFalas(repo, roteiroCom(f20));
    assert.equal(g.conferidas, 1, '20 caracteres: entra');
    assert.equal(g.ok, false, '20 caracteres versionados são achado');
    assert.equal(guardaFalas(repo, roteiroCom('é'.repeat(20))).conferidas, 1, 'conta caracteres, não bytes');
  });

  test('arquivo-binario-ou-grande-conta-em-ignorados-e-o-cli-diz', () => {
    const pasta = tmp();
    const repo = join(pasta, 'repo'); mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'bin.dat'), Buffer.concat([Buffer.from([0]), Buffer.from(FALA_A)]));
    writeFileSync(join(repo, 'grande.txt'), Buffer.alloc(4 * 1024 * 1024 + 1, 97));
    writeFileSync(join(repo, 'ok.md'), 'limpo\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'x');
    const g = guardaFalas(repo, falasDoRoteiro(ROTEIRO));
    assert.equal(g.ignorados, 2);
    assert.equal(g.ok, true, 'o binário não é lido: a guarda segue ok, mas o número de ignorados aparece');
    const roteiro = join(pasta, 'r.md'); writeFileSync(roteiro, ROTEIRO);
    const pontos = pontosValidos(); pontos.roteiroSha256 = sha256(ROTEIRO);
    const arqPontos = join(pasta, 'p.json'); writeFileSync(arqPontos, JSON.stringify(pontos));
    const r = spawnSync(process.execPath, [RUNNER, '--guarda', '--roteiro', roteiro, '--pontos', arqPontos, '--raiz', repo], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 ignorados por binário ou > 4 MB, não conferidos/);
  });
});

// ─── a coleta: formato real (estado do produto, `proxima` do produto, transcript, diário, observador) ───

const FERR = await import(new URL('../dist/ferramentas.js', import.meta.url));
const ESTADO_REAL = JSON.parse(readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'gh-fixture', 'estado-real.json'), 'utf8'));
const REGRA = 'Regra de semente do A1: confirme o escopo de arquivos antes de escrever.';
/** Saída REAL de `loop.mjs proxima` numa cópia semeada do A1 (medida na T24 r2): item `{task, papel, ..., aprendizados}`. */
const PROXIMA_REAL = '{"ok":true,"acao":{"tipo":"despachar","itens":[{"task":"T1","papel":"implementador","spec":"docs/superpowers/specs/x.md","descricao":"T1 implementador","modelo":{"modelo":"sonnet","esforco":"high"},"decisoes":[],"emendas":[],"aprendizados":["' + REGRA + '"]}]},"sinais":{"slots":1,"percent":null,"x":50,"pausado":false,"vivos":0,"tokens":null,"tetoTokens":null,"podePousar":true},"aviso":[]}';
const FALA_STATUS = 'como estamos agora com tudo isso por aqui, ja terminou?';
const ROTEIRO_COLETA = [
  '| # | hora | mensagem | ponto? | por quê |', '|---|---|---|---|---|',
  `| 1 | 07:38:21 | ${FALA_A} | MUDANÇA DE ASSUNTO | teste |`,
  `| 4 | 09:00:00 | ${FALA_STATUS} | — | pergunta de status |`, '',
].join('\n');
const AGENTE = { id: 'a1b2c3d4e5f60718', type: 'gabarito-mestre:gabarito-implementador', description: 'T24 corrige', status: 'running', transcript: null };
const jl = (arq, linhas) => writeFileSync(arq, `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`);

/** Monta rundir + repo + transcripts no formato que o `a1.exp`, o observador e o Claude Code produzem; `v` estraga um campo por vez. */
function montarExecucao(v = {}) {
  const base = tmp();
  const rundir = join(base, 'run'); const repo = join(base, 'repo'); const pasta = join(base, 'transcripts');
  for (const d of [join(rundir, 'obs'), join(rundir, 'estados'), join(repo, '.harness', 'entregas', 'GM-13'), join(repo, '.harness', 'entregas', '_sem-id'), pasta]) mkdirSync(d, { recursive: true });
  writeFileSync(join(rundir, 'inicio.iso'), '2026-11-13T10:00:00.000Z\n');
  writeFileSync(join(rundir, 'sends.log'), `1 digitar ${sha256(FALA_A)}\n2 digitar ${sha256(FALA_STATUS)}\n`);
  // F19: a entrega da branch já publicada (PR #14 mergeado + release, `fato.medido` do produto, `ts` antes do início); as mensagens do dono desta execução vão para `_sem-id` (FIEL-1 b)
  let seq = 0;
  const pr = (numero, estado, ts) => ({ sessao: 'semente', seq: ++seq, ts, tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'enabler/GM-13-a1' } } });
  jl(join(repo, '.harness', 'entregas', 'GM-13', 'events.semente.jsonl'), [
    ...(v.soDuranteExecucao === true ? [] : v.semPublicada === true ? [pr(14, 'aberto', '2026-11-10T12:00:00.000Z')] : [pr(14, 'mergeado', '2026-11-10T12:00:00.000Z')]),
    { sessao: 'semente', seq: ++seq, ts: '2026-11-10T12:00:01.000Z', tipo: 'fato.medido', dados: { chave: 'release', fonte: 'gh', valor: { tag: 'v2.0.0' } } },
    ...(v.mergeadaDuranteExecucao === true ? [pr(15, 'mergeado', '2026-11-13T10:06:00.000Z')] : []),
    ...(v.gravouNaPublicada === true ? [{ sessao: 'semente', seq: ++seq, ts: '2026-11-13T10:05:00.000Z', tipo: 'dono.mensagem', dados: { sha256: sha256(FALA_A), chars: 47 } }] : []),
  ]);
  // o que o painel grava na 1ª medição de cada sessão (painel-medir.mjs): `fato.medido` de branch, spec, plano, pr e release, depois do início
  const medidos = ['branch', 'spec', 'plano', 'pr', 'release'].map((chave, i) => ({ sessao: 'painel-s1', seq: i + 1, ts: `2026-11-13T10:04:0${i}.000Z`, autor: 'painel', agente: 'painel', tipo: 'fato.medido', dados: { chave, fonte: 'gh', valor: chave === 'pr' ? { numero: 14, estado: 'mergeado', branch: 'enabler/GM-13-a1' } : { medido: true } } }));
  if (v.painelMediuNaPublicada === true) jl(join(repo, '.harness', 'entregas', 'GM-13', 'events.painel-s1.jsonl'), medidos);
  if (v.painelMediuEmSemId === true) jl(join(repo, '.harness', 'entregas', '_sem-id', 'events.painel-s1.jsonl'), medidos);
  jl(join(repo, '.harness', 'entregas', '_sem-id', 'events.loop.jsonl'), [{ seq: 1, ts: '2026-11-13T10:02:00.000Z', tipo: 'dono.mensagem', dados: { sha256: sha256(FALA_A), chars: 47 } }]);
  jl(join(rundir, 'obs', 'a1.jsonl'), [
    { t: 1, ev: 'estado', agentes: v.semAgentes === true ? [] : [{ id: AGENTE.id, type: AGENTE.type, status: 'running', description: AGENTE.description }], panes: [{ id: 'gabarito-painel', placement: v.placement ?? 'dock' }], nomes: null },
    { t: 2, ev: 'render', comp: 'Pane', bodyRows: 12, bodyColumns: 60 },
  ]);
  if (v.semDebug !== true) writeFileSync(join(rundir, 'debug.log'), '2026-11-14T04:43:26.718Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, 180 columns): placed\n');
  const props = v.semProps === true ? {} : { Pane: { bodyRows: 12, bodyColumns: 60 } };
  writeFileSync(join(rundir, 'estados', '01.json'), `${JSON.stringify({ n: 1, props, agentes: v.semAgentes === true ? [] : [AGENTE], estado: ESTADO_REAL })}\n`);
  const prompt = v.promptSemRegra === true ? 'brief sem regra nenhuma' : `brief do implementador. ${REGRA}`;
  jl(join(pasta, 's1.jsonl'), [
    { type: 'user', timestamp: '2026-11-13T10:03:00.000Z', message: { role: 'user', content: FALA_STATUS } },
    ...(v.semProxima === true ? [] : [
      { type: 'assistant', timestamp: '2026-11-13T10:03:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'node /x/gates/scripts/loop.mjs proxima' } }] } },
      { type: 'user', timestamp: '2026-11-13T10:03:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: [{ type: 'text', text: PROXIMA_REAL }] }] } },
    ]),
    { type: 'assistant', timestamp: '2026-11-13T10:03:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'despachando' }, { type: 'tool_use', id: 'g1', name: 'Agent', input: { subagent_type: 'gabarito-mestre:gabarito-implementador', prompt } }] } },
    { type: 'user', timestamp: '2026-11-13T10:03:04.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'g1', is_error: v.negada !== false, content: 'resultado' }] } },
  ]);
  return { rundir, repo, pasta };
}
const CELULA = { local: 'lateral', cols: 180, rows: 50, cheia: true };
const roteiroColeta = () => ({ falas: falasDoRoteiro(ROTEIRO_COLETA) });
const coleta = (v, celula = CELULA) => { const m = montarExecucao(v); return coletar(m.rundir, m.repo, celula, roteiroColeta(), { pasta: m.pasta, total: 1 }); };
const resultado = (ev, id) => avaliarExecucao(ev).resultados.find((r) => r.id === id);

describe('coletar: a evidência vem do que a execução produziu (P3: negada fixa; P4: panes fixas)', () => {
  test('coleta-le-negada-turno-de-status-despachos-panes-e-vivos', async () => {
    const ev = await coleta({});
    const agent = ev.transcript.chamadas.find((c) => c.nome === 'Agent');
    assert.equal(agent.negada, true, 'o tool_result com is_error vira negada (P3: `negada: false` fixo ⇒ reprova aqui)');
    assert.equal(agent.turnoDeStatus, true, 'a fala digitada antes é a pergunta de status do roteiro');
    assert.deepEqual(ev.despachos.map((d) => d.aprendizados), [[REGRA]], 'aprendizados do proxima real, por papel');
    assert.deepEqual(ev.panes, [{ id: 'gabarito-painel', placement: 'dock' }], 'panes do observador (P4: `panes: []` fixo ⇒ reprova aqui)');
    assert.deepEqual(ev.digitadas, [sha256(FALA_A), sha256(FALA_STATUS)]);
    assert.deepEqual(ev.entregasPublicadas, ['GM-13']);
    assert.deepEqual(ev.gravacoes['GM-13'], { antes: 2, depois: 2 });
    assert.deepEqual(ev.gravacoes['_sem-id'], { antes: 0, depois: 1 });
    assert.equal(ev.quadrosSemProps, 0);
    assert.ok(ev.quadros[0].linhas.length >= 1 && ev.quadros[0].linhas.length <= 12, `quadro da lateral dentro do bodyRows 12 (${ev.quadros[0].linhas.length})`);
    assert.deepEqual(ev.vivos, [{ ativos: 1, linhasAgente: 1, detalhes: [{ nome: 'SAM', descricao: 'T24 corrige', task: 'T24', acao: 'lendo 2 arquivos' }], resumo: null }]);
  });

  test('8b-reprova-com-Agent-negado-em-turno-de-status-vindo-da-coleta', async () => {
    assert.equal(resultado(await coleta({ negada: true }), '8b-agent-nao-negado-em-status').ok, false);
    assert.equal(resultado(await coleta({ negada: false }), '8b-agent-nao-negado-em-status').ok, true);
  });

  test('8b-sem-Agent-em-turno-de-status-nao-mediu-nada-e-reprova', async () => {
    const m = montarExecucao({ negada: false });
    writeFileSync(join(m.rundir, 'sends.log'), `1 digitar ${sha256(FALA_A)}\n`);
    const linhas = readFileSync(join(m.pasta, 's1.jsonl'), 'utf8').replace(JSON.stringify(FALA_STATUS), JSON.stringify(FALA_A));
    writeFileSync(join(m.pasta, 's1.jsonl'), linhas);
    const ev = await coletar(m.rundir, m.repo, CELULA, roteiroColeta(), { pasta: m.pasta, total: 1 });
    assert.equal(ev.transcript.chamadas.find((c) => c.nome === 'Agent').turnoDeStatus, false);
    assert.equal(resultado(ev, '8b-agent-nao-negado-em-status').ok, false);
  });

  test('10-reprova-com-prompt-sem-a-regra-e-sem-proxima-observado', async () => {
    assert.equal(resultado(await coleta({}), '10-despachos-com-aprendizados').ok, true);
    assert.equal(resultado(await coleta({ promptSemRegra: true }), '10-despachos-com-aprendizados').ok, false, 'a regra do proxima falta no prompt');
    const sem = await coleta({ semProxima: true });
    assert.deepEqual(sem.despachos[0].aprendizados, []);
    assert.equal(resultado(sem, '10-despachos-com-aprendizados').ok, false, 'sem aprendizado observado a asserção não mediu nada');
  });

  test('8c-ignora-o-fato-medido-do-painel-na-publicada-e-reprova-o-resto (REQ-DIA-1, emenda 38)', async () => {
    const id = '8c-nada-em-entrega-publicada';
    const painel = await coleta({ painelMediuNaPublicada: true });
    assert.deepEqual(painel.entregasPublicadas, ['GM-13'], 'a publicada continua publicada: o que o painel mede depois do início não a muda');
    assert.deepEqual(painel.gravacoes['GM-13'], { antes: 2, depois: 2 }, 'fato.medido autor painel não conta');
    assert.equal(resultado(painel, id).ok, true, 'o painel gravar fato.medido no diário da branch publicada passa');
    const semId = await coleta({ painelMediuEmSemId: true });
    assert.deepEqual(semId.gravacoes['GM-13'], { antes: 2, depois: 2 });
    assert.equal(resultado(semId, id).ok, true);
    const msg = await coleta({ gravouNaPublicada: true, painelMediuNaPublicada: true });
    assert.deepEqual(msg.gravacoes['GM-13'], { antes: 2, depois: 3 }, 'dono.mensagem conta mesmo com o fato.medido do painel junto');
    assert.equal(resultado(msg, id).ok, false, 'dono.mensagem na publicada reprova');
  });

  test('8c-reprova-com-gravacao-na-publicada-e-sem-publicada-nenhuma', async () => {
    assert.equal(resultado(await coleta({}), '8c-nada-em-entrega-publicada').ok, true);
    const grav = await coleta({ gravouNaPublicada: true });
    assert.deepEqual(grav.gravacoes['GM-13'], { antes: 2, depois: 3 });
    assert.equal(resultado(grav, '8c-nada-em-entrega-publicada').ok, false);
    const nenhuma = await coleta({ semPublicada: true });
    assert.deepEqual(nenhuma.entregasPublicadas, [], 'PR aberto: pelo critério do produto não está publicada');
    assert.equal(resultado(nenhuma, '8c-nada-em-entrega-publicada').ok, false, 'sem entrega publicada vigiada a asserção não mediu nada');
  });

  test('publicada-e-o-criterio-do-produto-medido-antes-do-inicio (O2: o que a execução mede não conta)', async () => {
    const durante = await coleta({ mergeadaDuranteExecucao: true });
    assert.deepEqual(durante.entregasPublicadas, ['GM-13'], 'o PR #15 mergeado durante a execução não muda o que estava publicado');
    const so = await coleta({ soDuranteExecucao: true, mergeadaDuranteExecucao: true });
    assert.deepEqual(so.entregasPublicadas, [], 'um PR mergeado medido DURANTE a execução não torna a entrega publicada (filtro `ts <= inicio`)');
    let n = 0;
    const ev = (numero, estado, ts) => ({ sessao: 's', seq: ++n, ts, tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'b' } } });
    const Z = '2026-11-13T00:00:00.000Z';
    const T = (h) => `2026-11-12T0${h}:00:00.000Z`;
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1))], Z), true);
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1)), ev(15, 'aberto', T(2))], Z), false, 'PR aberto ⇒ não publicada (critério do produto)');
    assert.equal(await publicadaPeloProduto([ev(14, 'aberto', T(1)), ev(15, 'mergeado', T(2))], Z), false, 'último mergeado MAS com outro PR aberto ⇒ não publicada (FIEL-1 b: nenhum aberto)');
    assert.equal(await publicadaPeloProduto([{ sessao: 's', seq: 1, ts: T(1), tipo: 'entrega.fim', dados: { ok: true } }], Z), false, 'entrega.fim não é o critério do produto');
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1))], T(0)), false, 'medido depois do início não conta');
    assert.equal(await publicadaPeloProduto([], Z), false);
  });

  test('semente-da-publicada-e-identificada-pelo-produto (F19: branch da cópia ⇒ GM-13, PR #14 mergeado)', async () => {
    const { idDaBranch } = await import('../dist/trilha.js');
    const estado = JSON.parse(readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'gh-fixture', 'estado.json'), 'utf8'));
    assert.equal(idDaBranch(estado.branch, '[A-Z]+-\\d+'), 'GM-13', 'a branch da cópia é a que o produto identifica como GM-13');
    assert.deepEqual(estado.pr, [{ number: 14, state: 'MERGED' }], 'o gh de fixture reproduz o PR #14 mergeado, nenhum aberto');
    const base = tmp(); const dir = join(base, '.harness', 'entregas', 'GM-13');
    semearEntregaPublicada(base);
    const { lerEstrito } = await import('../dist/diario.js');
    const lido = lerEstrito(dir);
    const eventos = lido.eventos ?? lido;
    assert.equal(await publicadaPeloProduto(eventos, '2026-11-13T00:00:00.000Z'), true, 'a semente que o runner grava é publicada pelo critério do produto');
    assert.equal(existsSync(join(base, '.harness', 'entregas', 'GM-12-semente')), false);
  });

  test('snapshot-que-falhou-ou-contagem-diferente-do-censo-reprova-a-execucao (M3)', async () => {
    const m = montarExecucao({});
    await assert.rejects(coletar(m.rundir, m.repo, CELULA, roteiroColeta(), { pasta: m.pasta }), /1 snapshots \(esperado 26\)/, 'o padrão é o censo do roteiro');
    await assert.rejects(coletar(m.rundir, m.repo, CELULA, roteiroColeta(), { pasta: m.pasta, total: 2 }), /1 snapshots \(esperado 2\)/);
    writeFileSync(join(m.rundir, 'snapshot-falhou.log'), 'snapshot 7: erro\n');
    await assert.rejects(coletar(m.rundir, m.repo, CELULA, roteiroColeta(), { pasta: m.pasta, total: 1 }), /snapshot falhou: snapshot 7/);
    assert.match(readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8'), /snapshot-falhou\.log/, 'o a1.exp grava a falha do snapshot');
  });

  test('LINHA_DECISAO-ancorada: so a linha que o produto desenha, nao "decidiu" solto', () => {
    assert.equal(LINHA_DECISAO.test('RECENTE · 10:00 ● ELROND decidiu: escopo da T2'), true);
    assert.equal(LINHA_DECISAO.test('  09:50 ● ELROND decidiu: escopo da T2'), true);
    for (const l of ['ATENÇÃO · 2 consultas à Sombra sem decisão registrada, ninguém decidiu: ainda', 'o dono decidiu: seguir', 'RECENTE · 10:00 ✓ ELROND decidiu: x', 'RECENTE · 10:00 ● decidiu: x', 'texto 10:00 ● ELROND decidiu: x', 'RECENTE · 10:00 ● ELROND decidiu x'])
      assert.equal(LINHA_DECISAO.test(l), false, l);
  });

  test('8f-mede-a-decisao-que-o-produto-desenha-e-nao-a-palavra-Sombra (render real)', async () => {
    const real = await renderizar(ESTADO_REAL, { Pane: { bodyRows: 50, bodyColumns: 180 } }, { local: 'lateral' });
    assert.ok(real.some((l) => /^RECENTE · \d\d:\d\d ● \S+ decidiu: /.test(l)), 'o produto desenha "<sabio> decidiu: …" no RECENTE');
    assert.ok(real.some((l) => /^ATENÇÃO · \d+ consultas? à Sombra sem decisão registrada/.test(l)), 'e a ATENÇÃO com a palavra Sombra, que não é decisão');
    const decisao = { tipo: 'decisao.sombra', dados: { resposta: 'escopo da T2' } };
    const avalia = (linhas, eventos) => ASSERCOES.find((a) => a.id === '8f-sombra-decisao-visivel').avaliar({ eventos, quadros: [{ linhas, itensDepende: 0 }] });
    assert.equal(avalia(real, [decisao]).ok, true, 'decisão visível no render real');
    const soAtencao = real.filter((l) => !/ decidiu: /.test(l));
    assert.ok(soAtencao.some((l) => /Sombra/.test(l)));
    assert.equal(avalia(soAtencao, [decisao]).ok, false, 'só a ATENÇÃO com a palavra Sombra NÃO conta (decisão ausente)');
    const avaliaSem = avalia(real, []);
    assert.equal(avaliaSem.ok, false, 'decisoes === 0 ⇒ não medida ⇒ falha');
    assert.match(avaliaSem.detalhe, /não medida/);
  });

  test('1-e-2-sem-props-da-superficie-reprovam-como-nao-medidas', async () => {
    const ev = await coleta({ semProps: true });
    assert.equal(ev.quadrosSemProps, 1);
    assert.deepEqual(ev.quadros, []);
    for (const id of ['1-depende-no-topo', '2-blocos-e-corte']) assert.match(resultado(ev, id).detalhe, /não medida/);
  });

  test('4-8d-8e-sem-vivo-observado-reprovam-em-vez-de-passar-no-vacuo', async () => {
    const ev = await coleta({ semAgentes: true });
    assert.deepEqual(ev.vivos.map((p) => p.ativos), [0]);
    for (const id of ['4-agora-ativos', '8d-vivo-com-nome-descricao-task', '8e-vivos-igual-linhas-de-agente']) {
      const r = resultado(ev, id);
      assert.equal(r.ok, false, id);
      assert.match(r.detalhe, /nenhum agente vivo observado/);
    }
  });

  test('4-8d-8e-avaliam-todos-os-pontos-e-nao-so-o-ultimo', () => {
    const ev = evBoa();
    ev.vivos = [{ ativos: 2, linhasAgente: 1, detalhes: [{ nome: 'A', descricao: 'd', task: 'T1', acao: 'x' }] }, { ativos: 0, linhasAgente: 0, detalhes: [] }];
    assert.equal(resultado(ev, '8e-vivos-igual-linhas-de-agente').ok, false, 'o ponto 1 diverge mesmo com o último vazio');
    ev.vivos = [{ ativos: 1, linhasAgente: 1, detalhes: [{ nome: 'A', descricao: '', task: 'T1', acao: 'x' }] }, { ativos: 0, linhasAgente: 0, detalhes: [] }];
    assert.equal(resultado(ev, '8d-vivo-com-nome-descricao-task').ok, false);
    ev.vivos = [{ ativos: 1, linhasAgente: 1, detalhes: [{ nome: 'A', descricao: 'd', task: 'T1', acao: null }] }, { ativos: 0, linhasAgente: 0, detalhes: [] }];
    assert.equal(resultado(ev, '4-agora-ativos').ok, false);
  });

  test('placement-lido-do-observador-reprova-quando-incoerente-com-a-celula', async () => {
    assert.equal(resultado(await coleta({ placement: 'dock' }), '12-placement-da-pane').ok, true);
    assert.equal(resultado(await coleta({ placement: 'inline' }), '12-placement-da-pane').ok, false);
  });

  test('diario-ilegivel-e-snapshot-fora-da-forma-lancam', async () => {
    const m = montarExecucao({});
    writeFileSync(join(m.repo, '.harness', 'entregas', 'GM-13', 'events.x.jsonl'), 'não é json\n');
    await assert.rejects(coletar(m.rundir, m.repo, CELULA, roteiroColeta(), { pasta: m.pasta }), /diário ilegível/);
    const n = montarExecucao({});
    writeFileSync(join(n.rundir, 'estados', '02.json'), '{"n":2}\n');
    await assert.rejects(coletar(n.rundir, n.repo, CELULA, roteiroColeta(), { pasta: n.pasta }), /snapshot fora da forma/);
  });
});

describe('renderizar: o quadro vem das funções do mod com as props observadas', () => {
  test('lateral-usa-bodyRows-e-acima-usa-maxRows-e-viewport', async () => {
    const curto = await renderizar(ESTADO_REAL, { Pane: { bodyRows: 3, bodyColumns: 60 } }, { local: 'lateral' });
    const longo = await renderizar(ESTADO_REAL, { Pane: { bodyRows: 40, bodyColumns: 60 } }, { local: 'lateral' });
    assert.ok(curto.length <= 3, `bodyRows 3 ⇒ ${curto.length} linhas`);
    assert.ok(longo.length > curto.length, 'a altura da lateral VARIA com bodyRows (o orçamento 7 fixo do runner antigo não variava)');
    const acimaPouco = await renderizar(ESTADO_REAL, { AbovePrompt: { maxRows: 3, rows: 50, bodyColumns: 100 } }, { local: 'acima' });
    const acimaMuito = await renderizar(ESTADO_REAL, { AbovePrompt: { maxRows: 30, rows: 50, bodyColumns: 100 } }, { local: 'acima' });
    assert.ok(acimaPouco.length <= 3);
    assert.ok(acimaMuito.length > acimaPouco.length, 'maxRows muda a altura em acima');
    assert.equal(await renderizar(ESTADO_REAL, {}, { local: 'lateral' }), null, 'sem render observado: null, nunca inventado');
    assert.equal(await renderizar(ESTADO_REAL, { Pane: { bodyRows: 3, bodyColumns: 60 } }, { local: 'acima' }), null, 'a superfície errada não conta');
  });
});

describe('stdin do snapshot no contrato do mod (nomes, acoes, encerrados)', () => {
  const obs = [
    { t: 1, ev: 'estado', agentes: [{ id: AGENTE.id, type: AGENTE.type, status: 'running', description: 'd' }, { id: 'b1b2c3d4e5f60718', type: 'x', status: 'completed', description: 'd2' }], panes: [{ id: 'p', placement: 'dock' }], nomes: { [AGENTE.id]: { nome: 'SAM', vistoEm: 5 }, ffffffffffffffff: { nome: 'FORA', vistoEm: 1 } } },
    { t: 10, ev: 'tool', agentId: AGENTE.id, tool: 'Read', subagent_type: 'implementador', description: null },
    { t: 11, ev: 'tool', agentId: AGENTE.id, tool: 'Read', subagent_type: 'implementador', description: null },
    { t: 12, ev: 'tool', agentId: 'b1b2c3d4e5f60718', tool: 'Read', subagent_type: 'x', description: null },
    { t: 13, ev: 'render', comp: 'AbovePrompt', maxRows: 9, rows: 50, bodyColumns: 100, hasSurvey: false },
    { t: 14, ev: 'render', comp: 'AbovePrompt', maxRows: 11, rows: 50, bodyColumns: 100, hasSurvey: false },
  ];
  test('nomes-acoes-encerrados-como-o-mod-envia', () => {
    const { entrada } = entradaDoSnapshot(obs, FERR);
    assert.deepEqual(Object.keys(entrada.nomes), [AGENTE.id], 'só nomes de agentes da lista');
    assert.equal(entrada.nomes[AGENTE.id].nome, 'SAM');
    assert.deepEqual(entrada.encerrados, ['b1b2c3d4e5f60718']);
    assert.deepEqual(Object.keys(entrada.acoes), [AGENTE.id], 'agente terminal perde a ação');
    assert.equal(entrada.acoes[AGENTE.id].fonte, 'tool');
    assert.match(entrada.acoes[AGENTE.id].texto, /2/, 'duas leituras seguidas contam 2 (como o `anotarAcao` do mod)');
    assert.deepEqual(entrada.segundoPlano, []);
    assert.equal(acoesDe([], [], FERR) !== null, true);
  });
  test('o-validador-do-produto-aceita-o-stdin-do-snapshot', async () => {
    const { validarStdinAgentes } = await import('../dist/painel-equipe.js');
    const { entrada } = entradaDoSnapshot(obs, FERR);
    const v = validarStdinAgentes(entrada);
    assert.equal(v.ok, true, v.erro);
    assert.equal(v.valor.nomes[AGENTE.id].nome, 'SAM');
    assert.deepEqual(v.valor.encerrados, ['b1b2c3d4e5f60718']);
  });
  test('props-da-ultima-renderizacao-por-superficie', () => {
    assert.deepEqual(propsDe(obs), { AbovePrompt: { maxRows: 11, rows: 50, bodyColumns: 100, hasSurvey: false } });
  });
  test('itens-do-proxima-real-e-saida-que-nao-e-json', () => {
    assert.deepEqual(itensDeProxima(PROXIMA_REAL), [{ papel: 'implementador', aprendizados: [REGRA] }]);
    assert.deepEqual(itensDeProxima('Error: x'), []);
  });
});

describe('ambiente da execução real (T44, emenda 39): plugin carregado e diálogo de imports recusado', () => {
  const OUTRO = 'Plugin loading errors: Dependency "superpowers@claude-plugins-official" is not installed — run `claude plugin install superpowers@claude-plugins-official`';
  const CARGA = '[DEBUG] Loaded inline plugin from path: gabarito-mestre';
  const ATIVO = '[DEBUG] Checking plugin gabarito-mestre: skillsPath=exists, skillsPaths=0 paths';
  const INDISP = '[DEBUG] Plugin not available for MCP: gabarito-mestre@inline - error type: dependency-unsatisfied';
  // medido: debug.log REAL de sessão com gabarito-mestre DESABILITADO (dependência superpowers ausente) e de sessão sã (t17), reduzidos às linhas de plugin
  const DESABILITADO = `[DEBUG] Found 9 plugins (7 enabled, 2 disabled)\n${OUTRO}\n[DEBUG] Checking plugin observador-a1: skillsPath=none, skillsPaths=0 paths\n${CARGA}\n${INDISP}\n[DEBUG] Loaded plugins - Enabled: 7, Disabled: 2, Commands: 0, Agents: 0, Errors: 1\n`;
  const SAO = `[DEBUG] Found 9 plugins (8 enabled, 1 disabled)\n${ATIVO}\n${CARGA}\n[DEBUG] Loaded plugins - Enabled: 8, Disabled: 1, Commands: 2, Agents: 4, Errors: 0\n`;
  test('plugin-desabilitado-por-dependencia-REPROVA (BLOCKER r1: "Loaded inline plugin" é descoberta, não ativação)', () => {
    assert.equal(pluginCarregou(DESABILITADO).ok, false);
    assert.equal(pluginCarregou(DESABILITADO).carregado, false);
    assert.equal(pluginCarregou(`${CARGA}\n${INDISP}\n`).ok, false, 'só a descoberta + indisponível');
    assert.equal(pluginCarregou(`${CARGA}\n`).ok, false, 'só "Loaded inline plugin" não basta');
    assert.equal(pluginCarregou(`${ATIVO}\n${INDISP}\n`).ok, false, 'indisponível do gabarito-mestre reprova mesmo com skill registrada');
  });
  test('plugin-ativo-aprova-so-com-sinal-positivo-dele (skill/hook do gabarito-mestre registrado)', () => {
    assert.equal(pluginCarregou(SAO).ok, true);
    assert.equal(pluginCarregou(`${ATIVO}\n`).ok, true);
    assert.equal(pluginCarregou('[DEBUG] Checking plugin observador-a1: skillsPath=none, skillsPaths=0 paths\n').ok, false, 'outro plugin ativo não prova o nosso');
    assert.equal(pluginCarregou('[DEBUG] Checking plugin gabarito-mestre-x: skillsPath=exists\n').ok, false, 'nome só casa gabarito-mestre exato');
  });
  test('dependencia-de-OUTRO-plugin-nao-reprova-o-plugin-ativo (falso positivo da T25; P15: o grep antigo reprovava)', () => {
    const log = `${ATIVO}\n${OUTRO}\n${OUTRO}\n`;
    assert.equal(pluginCarregou(log).ok, true);
    assert.equal(/dependency-unsatisfied|is not installed/.test(log), true, 'o grep antigo casaria este log (é o defeito D2)');
    assert.equal(pluginCarregou(`${OUTRO}\n`).ok, false, 'sem sinal do nosso plugin: não carregou (não vale "sem erro")');
    assert.equal(pluginCarregou('').ok, false);
  });
  test('erro-de-dependencia-do-gabarito-mestre-reprova (formatos "is not installed" e "Plugin not available")', () => {
    assert.equal(pluginCarregou(`${ATIVO}\nPlugin loading errors: Dependency "x@y" of gabarito-mestre is not installed\n`).ok, false);
    assert.equal(pluginCarregou(`${ATIVO}\n[DEBUG] Plugin not available: gabarito-mestre@inline - error type: dependency-unsatisfied\n`).ok, false);
  });
  test('debug.log-real-da-celula-medida-reprova-e-o-da-t17-aprova (fixture de medição; pula se o artefato local não existe)', (t) => {
    const raiz = raizPrincipal(AQUI);
    const ruim = join(raiz, '.claude-tmp', 'a1', '1794616398575', 'lateral-180x50-cheia', 'debug.log');
    const bom = join(raiz, '.claude-tmp', 't17', 'a1-1', 'debug.log');
    if (!existsSync(ruim) || !existsSync(bom)) { t.skip('artefatos .claude-tmp ausentes'); return; }
    assert.equal(pluginCarregou(readFileSync(ruim, 'utf8')).ok, false);
    assert.equal(pluginCarregou(readFileSync(bom, 'utf8')).ok, true);
  });
  test('cli-plugin-devolve-rc-0-ou-1 (o a1.exp decide por ele; o observador não entra na decisão)', () => {
    const d = mkdtempSync(join(tmpdir(), 'a1-plugin-')); TMPS.push(d);
    writeFileSync(join(d, 'debug.log'), SAO);
    writeFileSync(join(d, 'ruim.log'), DESABILITADO);
    writeFileSync(join(d, 'obs.jsonl'), '{"x":1}\n');
    const rodar = (log) => spawnSync(process.execPath, [RUNNER, 'plugin', join(d, log), join(d, 'obs.jsonl')], { encoding: 'utf8' }).status;
    assert.equal(rodar('debug.log'), 0);
    assert.equal(rodar('ruim.log'), 1, 'observador gravou, plugin desabilitado: reprova');
    assert.equal(rodar('inexistente.log'), 1);
  });
  test('dialogo-de-imports-registrado-na-evidencia', () => {
    assert.deepEqual(dialogosDoExpLog('1 inicio cols=180 rows=50\n2 DIALOGO-IMPORTS-EXTERNOS recusado\n'), { importsExternos: 'apareceu-e-foi-recusado' });
    assert.deepEqual(dialogosDoExpLog('1 inicio\n'), { importsExternos: 'nao-apareceu' });
  });
  test('ambiente-do-coletar-vem-do-exp.log (M6/M7: lê o campo, troca o valor e falha)', async () => {
    const m = montarExecucao({});
    writeFileSync(join(m.rundir, 'exp.log'), '1 DIALOGO-IMPORTS-EXTERNOS recusado\n');
    assert.deepEqual((await coleta0(m)).ambiente, { importsExternos: 'apareceu-e-foi-recusado' });
    assert.deepEqual((await coleta0(montarExecucao({}))).ambiente, { importsExternos: 'nao-apareceu' });
  });
  test('a1.exp-na-simulacao-do-dialogo: recusa com Enter UMA vez, e texto de conversa parecido NÃO dispara (D1; P14)', (t) => {
    if (spawnSync('expect', ['-v'], { encoding: 'utf8' }).error) { t.skip('expect ausente'); return; }
    const exp = readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8');
    const procs = exp.slice(exp.indexOf('proc sends'), exp.indexOf('proc nota') + exp.slice(exp.indexOf('proc nota')).indexOf('\n') + 1)
      + exp.slice(exp.indexOf('set imports_tratado'), exp.indexOf('# turno acabou'));
    const simular = (saida) => {
      const d = mkdtempSync(join(tmpdir(), 'a1-dlg-')); TMPS.push(d);
      const filho = `printf '%s' '${saida}'; IFS= read -r x; echo recebido > ${d}/enter; sleep 1`;
      writeFileSync(join(d, 'sim.exp'), `set rundir ${d}\n${procs}\nspawn sh -c {${filho}}\ndrenar 6\nexit 0\n`);
      const r = spawnSync('expect', ['-f', join(d, 'sim.exp')], { encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 0, r.stderr);
      return { enter: existsSync(join(d, 'enter')), log: existsSync(join(d, 'exp.log')) ? readFileSync(join(d, 'exp.log'), 'utf8') : '' };
    };
    // diálogo real: texto com cursor-positioning (ESC[nG) entre as palavras
    const dlg = simular('Allow\\033[7Gexternal\\033[16GCLAUDE.md\\033[26Gfile\\033[31Gimports?\\n  1. Yes\\n> 2. No, disable external imports\\n');
    assert.equal(dlg.enter, true, 'diálogo apareceu: o Enter foi enviado');
    assert.equal((dlg.log.match(/DIALOGO-IMPORTS-EXTERNOS recusado/g) ?? []).length, 1, 'registrado e recusado uma vez só');
    // conversa que fala de imports externos, sem o diálogo: nada é enviado nem registrado
    const conv = simular('I would avoid external dependencies and imports in this file.\\nexternal imports are fine here\\n');
    assert.equal(conv.enter, false, 'sem diálogo, nenhum Enter avulso');
    assert.doesNotMatch(conv.log, /DIALOGO-IMPORTS/, 'sem diálogo, nada registrado como recusado');
  });
  test('a1.exp-responde-o-dialogo-recusando-e-usa-o-sinal-do-runner (P14: sem a resposta a TUI para; P15: grep antigo)', () => {
    const exp = readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8');
    const proc = exp.slice(exp.indexOf('proc recusarImports'), exp.indexOf('proc drenar'));
    assert.match(proc, /send "\\r"/, 'recusa = Enter no foco que nasce em "No, disable external imports"');
    assert.doesNotMatch(proc, /\\033\\\[B/, 'seta para baixo ACEITARIA os imports (o foco já nasce em No)');
    assert.doesNotMatch(exp, /grep -c -E "dependency-unsatisfied/, 'checagem antiga de plugin removida');
    assert.match(exp, /exec \$node \$runner plugin /);
  });
});

describe('superpowers fixo (T46, emenda 41): dependência declarada carregada por --plugin-dir de versão FIXA', () => {
  const MATRIZ_SRC = () => { const src = readFileSync(RUNNER, 'utf8'); return src.slice(src.indexOf('async function matriz'), src.indexOf('// ─── ambiente da execução')); };
  const fabricar = (versoes, { nome = 'superpowers', marketplace = 'claude-plugins-official' } = {}) => {
    const d = mkdtempSync(join(tmpdir(), 'a1-sp-')); TMPS.push(d);
    for (const v of versoes) {
      mkdirSync(join(d, 'plugins', 'cache', marketplace, nome, v, '.claude-plugin'), { recursive: true });
      writeFileSync(join(d, 'plugins', 'cache', marketplace, nome, v, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: nome, version: v }));
    }
    return d;
  };
  test('versao-fixa-declarada-no-runner (7.0.2) e sem caminho de usuário fixo no runner nem no a1.exp (condição 2 da Sombra)', () => {
    assert.equal(SUPERPOWERS_VERSAO, '7.0.2');
    for (const f of [RUNNER, join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp')]) assert.doesNotMatch(readFileSync(f, 'utf8'), /\/Users\/|\/home\/[a-z]/, `${f}: caminho absoluto de usuário`);
  });
  test('resolve-pelo-diretorio-de-configuracao-da-conta-e-pela-dependencia-do-plugin.json (condição 1 e 2)', () => {
    const conta = fabricar(['7.0.0', '7.0.2']);
    const r = resolverSuperpowers({ config: conta });
    assert.equal(r.ok, true);
    assert.deepEqual({ nome: r.nome, versao: r.versao }, { nome: 'superpowers', versao: '7.0.2' });
    assert.equal(r.caminho, join(conta, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '7.0.2'));
    // a fonte do nome e do marketplace é a dependência do plugin.json, não uma constante do runner
    const pj = join(conta, 'plugin.json');
    writeFileSync(pj, JSON.stringify({ dependencies: [{ name: 'superpowers', marketplace: 'mkt-x' }] }));
    const o = resolverSuperpowers({ config: fabricar(['7.0.2'], { marketplace: 'mkt-x' }), pluginJson: pj });
    assert.equal(o.ok, true); assert.match(o.caminho, /cache\/mkt-x\/superpowers\/7\.0\.2$/, 'marketplace vem do plugin.json');
    assert.equal(resolverSuperpowers({ config: fabricar(['7.0.2']), pluginJson: pj }).ok, false, 'marketplace do plugin.json diferente do cache: ausente');
    // o plugin.json real do produto declara o superpowers
    assert.equal(resolverSuperpowers({ config: fabricar([]) }).causa, 'dependencia_ausente: superpowers@7.0.2');
  });
  test('config-vem-de-CLAUDE_CONFIG_DIR-com-o-padrao-do-claude-code', () => {
    const conta = fabricar(['7.0.2']);
    const sub = (env) => spawnSync(process.execPath, [RUNNER, 'superpowers'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    const a = sub({ CLAUDE_CONFIG_DIR: conta });
    assert.equal(a.status, 0, a.stderr); assert.equal(JSON.parse(a.stdout).caminho, join(conta, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '7.0.2'));
    const b = sub({ CLAUDE_CONFIG_DIR: fabricar([]) });
    assert.equal(b.status, 1, 'conta sem a versão fixa: rc 1');
  });
  test('dependencia-ausente-para-com-causa: versão fixa ausente NÃO cai para outra versão do cache', () => {
    const conta = fabricar(['7.0.0', '7.1.0']); // há outras versões, não a fixa
    const r = resolverSuperpowers({ config: conta });
    assert.equal(r.ok, false);
    assert.equal(r.causa, 'dependencia_ausente: superpowers@7.0.2');
    assert.equal(r.caminho, undefined, 'sem caminho: nada a carregar');
    // diretório da versão existe mas vazio (sem plugin.json): também ausente
    const vazio = mkdtempSync(join(tmpdir(), 'a1-sp-')); TMPS.push(vazio);
    mkdirSync(join(vazio, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '7.0.2'), { recursive: true });
    assert.equal(resolverSuperpowers({ config: vazio }).ok, false);
    // a versão registrada no manifesto precisa ser a fixa
    const torto = fabricar([]); mkdirSync(join(torto, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '7.0.2', '.claude-plugin'), { recursive: true });
    writeFileSync(join(torto, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '7.0.2', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'superpowers', version: '9.9.9' }));
    assert.equal(resolverSuperpowers({ config: torto }).ok, false, 'manifesto de outra versão não vale');
  });
  test('matriz-com-superpowers-ausente-para-a-celula-e-NAO-conta-passa (comportamento, sem abrir o expect)', async () => {
    const vazia = fabricar([]);
    const raiz = mkdtempSync(join(tmpdir(), 'a1-mz-')); TMPS.push(raiz);
    const antes = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = vazia;
    const tmpAntes = process.env.TMPDIR; process.env.TMPDIR = tmp();
    let m;
    const errOrig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try { m = await matriz('/inexistente-nao-copiar', raiz, { falas: [] }, idDaCelula(MATRIZ[0])); } finally { process.stderr.write = errOrig; process.env.TMPDIR = tmpAntes; if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = antes; }
    const r = JSON.parse(readFileSync(join(m.base, idDaCelula(MATRIZ[0]), 'resultado.json'), 'utf8'));
    assert.equal(r.passa, false);
    assert.equal(r.resultados[0].id, 'dependencia');
    assert.equal(r.resultados[0].ok, false);
    assert.equal(r.ambiente.superpowers.dependencia_ausente, 'superpowers@7.0.2');
    assert.equal(existsSync(join(m.base, idDaCelula(MATRIZ[0]), 'repo', 'plugins')), false, 'a cópia do produto nem foi preparada');
    assert.equal(m.rel.passou, 0, 'a célula parada não entra no 8/8');
    assert.equal(m.rel.ok, false);
  });
  test('manifesto-de-outro-nome-no-diretorio-da-versao-fixa-nao-vale', () => {
    const c = fabricar([]);
    const dir = join(c, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '7.0.2', '.claude-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: 'outro-plugin', version: '7.0.2' }));
    assert.equal(resolverSuperpowers({ config: c }).ok, false, 'nome diferente da dependência declarada: ausente');
  });
  test('plugin.json-sem-a-dependencia-declarada-falha-com-causa-propria (sem valor fixo silencioso, condição 1)', () => {
    const conta = fabricar(['7.0.2']); // o cache TEM a versão fixa: só a declaração falta
    for (const conteudo of [{ name: 'x' }, { dependencies: [] }, { dependencies: [{ name: 'outro', marketplace: 'm' }] }]) {
      const pj = join(conta, 'sem-dep.json'); writeFileSync(pj, JSON.stringify(conteudo));
      const r = resolverSuperpowers({ config: conta, pluginJson: pj });
      assert.equal(r.ok, false, JSON.stringify(conteudo));
      assert.match(r.causa, /^dependencia_nao_declarada: superpowers/);
      assert.equal(r.caminho, undefined);
    }
  });
  test('a-regra-CLAUDE_CONFIG_DIR-vive-numa-funcao-so (configDaConta usada por pastaDeTranscripts)', () => {
    const conta = fabricar([]); const antes = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = conta;
    try {
      assert.equal(configDaConta(), conta);
      assert.ok(pastaDeTranscripts(AQUI).startsWith(join(conta, 'projects') + '/'), 'transcripts sob a conta');
    } finally { if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = antes; }
    assert.equal((readFileSync(RUNNER, 'utf8').match(/CLAUDE_CONFIG_DIR \?\?/g) ?? []).length, 1, 'a regra aparece uma vez no runner');
  });
  test('o-claude-carrega-o-superpowers-como-plugin-explicito-e-nunca-liga-setting-sources-user (argv montado pelo runner)', () => {
    const argv = R.argvDoClaude({ observador: '/t/o', plugin: '/t/p', superpowers: '/t/sp', debugLog: '/t/d' });
    assert.ok(argv.some((a, i) => argv[i - 1] === '--plugin-dir' && a === '/t/sp'));
    assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'project,local', 'sem ligar o setting-sources user (D1)');
  });
  test('matriz-passa-o-superpowers-resolvido-ao-claude (argv da célula)', async () => {
    const e = ambienteMatriz();
    await rodarMatriz(e, { so: idDaCelula(MATRIZ[0]) });
    assert.ok(e.chamadas[0].argv.some((a, i) => e.chamadas[0].argv[i - 1] === '--plugin-dir' && a === '/t/sp'));
  });
  test('ambiente-registra-superpowers (nome, versão e caminho no resultado.json; troca o valor e falha)', async () => {
    const sp = { ok: true, nome: 'superpowers', versao: '7.0.2', caminho: '/x/y' };
    assert.deepEqual(ambienteDaExecucao('1 inicio\n2 DIALOGO-IMPORTS-EXTERNOS recusado\n', sp), { importsExternos: 'apareceu-e-foi-recusado', superpowers: { nome: 'superpowers', versao: '7.0.2', caminho: '/x/y' } });
    assert.deepEqual(ambienteDaExecucao('', { ...sp, versao: '7.0.0', caminho: '/z' }).superpowers, { nome: 'superpowers', versao: '7.0.0', caminho: '/z' });
    assert.deepEqual(ambienteDaExecucao('', { ok: false, causa: 'dependencia_ausente: superpowers@7.0.2' }).superpowers, { dependencia_ausente: 'superpowers@7.0.2' });
    assert.deepEqual(ambienteDaExecucao('', { ok: false, causa: 'dependencia_nao_declarada: superpowers no plugin.json do produto' }).superpowers, { dependencia_nao_declarada: 'superpowers no plugin.json do produto' });
    const e = ambienteMatriz({ expLog: '1 DIALOGO-IMPORTS-EXTERNOS recusado\n' });
    const m = await rodarMatriz(e, { so: idDaCelula(MATRIZ[0]) });
    const r = JSON.parse(readFileSync(join(m.base, idDaCelula(MATRIZ[0]), 'resultado.json'), 'utf8'));
    assert.deepEqual(r.ambiente, { importsExternos: 'apareceu-e-foi-recusado', superpowers: { nome: 'superpowers', versao: '7.0.2', caminho: '/t/sp' } });
  });
});

// ─── T49 (emenda 43): runner do A1 isolado e confiável. Testes de COMPORTAMENTO (nada de regex sobre o fonte do runner) ───

const R = await import(new URL('./e2e/conversa-2026-11-11/rodar-a1.mjs', import.meta.url));
const tmpGit = () => { const d = tmp(); git(d, 'init', '-q', '-b', 'main'); writeFileSync(join(d, 'a.txt'), 'a'); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'i'); return d; };
const calar = async (fn) => { const orig = process.stderr.write.bind(process.stderr); process.stderr.write = () => true; try { return await fn(); } finally { process.stderr.write = orig; } };

describe('T49 (b) observador: grava o 1º render depois do session.start e não deduplica contra render descartado', () => {
  /** Carrega o `register.mjs` REAL escrito por `escreverObservador` com uma plataforma de mentira: `on` guarda handlers, `$` registra o que seria escrito. */
  async function plataforma() {
    const d = tmp(); R.escreverObservador(join(d, 'obs'));
    const mod = await import(`${join(d, 'obs', 'register.mjs')}?${Math.random()}`);
    const h = {}; mod.register((ev, a, b) => { const [filtro, fn] = typeof a === 'function' ? [null, a] : [a, b]; (h[ev + (filtro?.component ? `:${filtro.component}` : '')] ??= []).push(fn); });
    const arquivos = {}; let relogio = null; let panes = []; let t = 0;
    const $ = { env: { get: async () => '/obs' }, clock: { now: async () => ++t, every: (_ms, f) => { relogio = f; } }, fs: { write: async (p, c) => { arquivos[p] = c; } }, agent: { list: async () => [] }, ui: { panes: async () => panes }, store: { get: async () => null } };
    const next = async () => {};
    const dispara = async (ev, e = {}) => { for (const f of h[ev] ?? []) await f($, e, next); await new Promise((r) => setTimeout(r, 5)); };
    const linhas = () => (arquivos['/obs/a1.jsonl'] ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { dispara, linhas, tick: async () => { await relogio(); await new Promise((r) => setTimeout(r, 5)); }, setPanes: (p) => { panes = p; } };
  }
  const PROPS = { props: { scroll: { bodyRows: 40 }, bodyColumns: 60 } };

  test('render-antes-do-session.start-nao-trava-o-seguinte: o 1º render depois do start é gravado mesmo igual ao descartado', async () => {
    const p = await plataforma();
    await p.dispara('ui.render:Pane', PROPS); // chega antes de o observador saber onde gravar
    await p.dispara('session.start', {});
    await p.dispara('ui.render:Pane', PROPS);
    const panes = p.linhas().filter((l) => l.ev === 'render' && l.comp === 'Pane');
    assert.ok(panes.length >= 1, 'o render depois do session.start foi gravado');
    assert.deepEqual(panes[0], { t: panes[0].t, ev: 'render', comp: 'Pane', bodyRows: 40, bodyColumns: 60 });
  });
  test('render-so-depois-do-start-tambem-e-gravado', async () => {
    const p = await plataforma();
    await p.dispara('session.start', {});
    await p.dispara('ui.render:Pane', PROPS);
    assert.equal(p.linhas().filter((l) => l.comp === 'Pane').length, 1);
  });
  test('render-igual-ao-ULTIMO-GRAVADO-nao-repete (a deduplicação legítima segue); props diferentes gravam', async () => {
    const p = await plataforma();
    await p.dispara('session.start', {});
    await p.dispara('ui.render:Pane', PROPS); await p.dispara('ui.render:Pane', PROPS);
    assert.equal(p.linhas().filter((l) => l.comp === 'Pane').length, 1);
    await p.dispara('ui.render:Pane', { props: { scroll: { bodyRows: 39 }, bodyColumns: 60 } });
    assert.equal(p.linhas().filter((l) => l.comp === 'Pane').length, 2);
  });
  test('panes-lidas-pela-plataforma-vao-ao-registro-com-o-que-ela-expõe', async () => {
    const p = await plataforma();
    await p.dispara('session.start', {});
    p.setPanes([{ id: 'gabarito-painel', placement: 'dock', outro: 3, aninhado: { x: 1 } }]);
    await p.tick();
    const e = p.linhas().filter((l) => l.ev === 'estado').at(-1);
    assert.equal(e.panes[0].placement, 'dock');
    assert.equal(e.panes[0].id, 'gabarito-painel');
    assert.equal(e.panes[0].raw.outro, 3, 'campos escalares da Pane ficam registrados para diagnóstico');
    assert.equal(e.panes[0].raw.aninhado, undefined);
  });
  test('placement-do-debug.log (fonte que a plataforma expõe): "ui.open … placed" e "waits unplaced"', () => {
    const log = [
      '2026-11-14T04:43:26.718Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, 180 columns): placed',
      '2026-11-14T03:00:22.683Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, 80 columns): waits unplaced (unasked below 110 columns (80 now): placed when ...)',
      '2026-11-14T03:00:23.683Z [DEBUG] ui.open outro-plugin outra-pane (unasked, 180 columns): placed',
    ].join('\n');
    assert.deepEqual(R.placementsDoDebugLog(log), [{ colunas: 180, estado: 'placed' }, { colunas: 80, estado: 'unplaced' }]);
    assert.deepEqual(R.placementsDoDebugLog('nada aqui'), []);
  });
});

/** Executor de mentira: grava o que recebeu e devolve o que o teste manda. */
function ambienteMatriz(fn0 = async () => ({ status: 0, abortada: null }), { expLog = null } = {}) {
  const fn = typeof fn0 === 'function' ? fn0 : async () => ({ status: 0, abortada: null }); if (typeof fn0 === 'object') expLog = fn0.expLog ?? null;
  const fonte = tmpGit(); const raiz = tmpGit(); const base = tmp();
  const chamadas = []; const ativos = { n: 0, max: 0 };
  const deps = {
    preparar: (f, destino) => { mkdirSync(destino, { recursive: true }); return { bin: join(destino, '..', 'bin') }; },
    copiarPlugin: (destino) => { mkdirSync(destino, { recursive: true }); },
    executar: async (a) => { if (expLog !== null) writeFileSync(join(a.rundir, 'exp.log'), expLog); chamadas.push(a); ativos.n += 1; ativos.max = Math.max(ativos.max, ativos.n); try { return await fn(a, fonte); } finally { ativos.n -= 1; } },
    avaliar: async (rundir, repo, celula) => ({ celula: idDaCelula(celula), passa: true, resultados: [] }),
    superpowers: () => ({ ok: true, nome: 'superpowers', versao: '7.0.2', caminho: '/t/sp' }),
  };
  return { fonte, raiz, base, chamadas, ativos, deps };
}
const rodarMatriz = (e, opcoes = {}) => { const antes = process.env.TMPDIR; process.env.TMPDIR = e.base; return calar(() => R.matriz(e.fonte, e.raiz, { falas: [] }, opcoes.so ?? null, { deps: e.deps, ...opcoes })).finally(() => { process.env.TMPDIR = antes; }); };


describe('T49 (a) isolamento: célula e plugin fora do repo real; o repo real fica intocado ou a célula é inválida', () => {
  test('foto-do-repo-pega-status-refs-e-worktrees; diferenças dizem qual', () => {
    const r = tmpGit(); const a = R.fotoDoRepo(r);
    assert.deepEqual(R.diferencasDeFotos(a, R.fotoDoRepo(r)), []);
    writeFileSync(join(r, 'novo.txt'), 'x');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r)).join(';'), /status/);
    rmSync(join(r, 'novo.txt'));
    git(r, 'branch', 'outra');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r)).join(';'), /refs/);
    git(r, 'branch', '-q', '-D', 'outra');
    const wt = join(tmp(), 'wt'); git(r, 'worktree', 'add', '-q', '-b', 'w', wt);
    const d = R.diferencasDeFotos(a, R.fotoDoRepo(r));
    assert.match(d.join(';'), /worktrees/);
  });
  test('worktrees-de-outros-implementadores-nao-invalidam: refs wt/* e o HEAD de worktree mudando são ignorados; ref de outro nome e worktree novo/removido não', () => {
    const r = tmpGit(); const wt = join(tmp(), 'wt'); git(r, 'worktree', 'add', '-q', '-b', 'wt/GM-14-T99', wt);
    const a = R.fotoDoRepo(r);
    writeFileSync(join(wt, 'x.txt'), 'x'); git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'outro implementador');
    assert.deepEqual(R.diferencasDeFotos(a, R.fotoDoRepo(r)), [], 'commit em wt/* de outro implementador não é do conductor');
    git(r, 'branch', 'enabler/x');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r)).join(';'), /refs/, 'ref fora de wt/* continua vigiada');
    git(r, 'branch', '-q', '-D', 'enabler/x');
    git(r, 'worktree', 'add', '-q', '-b', 'wt/outra', join(tmp(), 'wt2'));
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r)).join(';'), /worktrees/, 'worktree novo continua vigiado');
  });
  test('estado-vivo-do-orquestrador-em-.harness-e-.claude-tmp-nao-invalida; arquivo de código novo no repo real sim', () => {
    const r = tmpGit(); const a = R.fotoDoRepo(r);
    mkdirSync(join(r, '.harness', 'entregas', 'GM-14', 'sombra'), { recursive: true }); mkdirSync(join(r, '.claude-tmp'), { recursive: true });
    writeFileSync(join(r, '.harness', 'entregas', 'GM-14', 'sombra', 'h.md'), 'x'); writeFileSync(join(r, '.claude-tmp', 'y'), 'y');
    assert.deepEqual(R.diferencasDeFotos(a, R.fotoDoRepo(r)), []);
    writeFileSync(join(r, 'src.js'), 'z');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r)).join(';'), /status.*src\.js/);
    const b = R.fotoDoRepo(r, { ignorarStatus: [] }); writeFileSync(join(r, '.harness', 'novo'), 'n');
    assert.match(R.diferencasDeFotos(b, R.fotoDoRepo(r, { ignorarStatus: [] })).join(';'), /status/, 'sem ignorados, .harness conta');
  });
  test('ignorarRefs-e-configuravel-e-a-celula-fica-invalida-so-pelo-que-nao-e-ignorado', () => {
    const r = tmpGit(); const a = R.fotoDoRepo(r, { ignorarRefs: [] });
    git(r, 'branch', 'wt/z');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r, { ignorarRefs: [] })).join(';'), /refs/, 'sem ignorados, wt/* conta');
  });
  test('foto-de-quem-nao-e-repo-lanca (a prova nunca passa no escuro)', () => {
    assert.throws(() => R.fotoDoRepo(tmp()));
  });
  test('dentroDe-e-vazamentos', () => {
    assert.equal(R.dentroDe('/a/b', '/a/b/c'), true);
    assert.equal(R.dentroDe('/a/b', '/a/b'), true);
    assert.equal(R.dentroDe('/a/b', '/a/bc'), false);
    assert.deepEqual(R.vazamentos(['--plugin-dir', '/real/x/plugin', '/tmp/ok'], ['/real/x']), ['/real/x/plugin']);
    assert.deepEqual(R.vazamentos(['/tmp/ok'], ['/real/x']), []);
  });
  test('copiarPlugin-copia-o-plugin-para-fora-sem-node_modules', () => {
    const d = join(tmp(), 'plugin'); R.copiarPlugin(d);
    assert.ok(existsSync(join(d, '.claude-plugin', 'plugin.json')));
    assert.ok(existsSync(join(d, 'gates', 'dist')));
    assert.equal(existsSync(join(d, 'gates', 'node_modules')), false);
    assert.ok(!R.dentroDe(R.PLUGIN, d));
  });
  test('argvDoClaude: plugins vêm da cópia, modelo é Sonnet, nenhum caminho do repo real (M: condutor haiku)', () => {
    const argv = R.argvDoClaude({ observador: '/t/obs', plugin: '/t/plugin', superpowers: '/t/sp', debugLog: '/t/debug.log' });
    assert.equal(R.MODELO_CONDUTOR, 'claude-sonnet-5-5');
    assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5');
    assert.doesNotMatch(argv.join(' '), /haiku/);
    assert.deepEqual(argv.filter((_, i) => argv[i - 1] === '--plugin-dir'), ['/t/obs', '/t/plugin', '/t/sp']);
    assert.ok(argv.includes('--strict-mcp-config') && argv.includes('--debug-file'));
    assert.deepEqual(R.vazamentos(argv, [R.raizDoRepoReal()]), []);
  });
  test('a1.exp-nao-fixa-modelo-e-le-os-argumentos-do-runner', () => {
    const exp = readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8');
    assert.doesNotMatch(exp, /haiku/);
    assert.match(exp, /claude\.args/);
  });

  test('celula-e-plugin-ficam-FORA-do-checkout-real (sob TMPDIR) e o argv do claude não tem caminho real (M: célula no checkout real)', async () => {
    const e = ambienteMatriz();
    await rodarMatriz(e, { so: idDaCelula(MATRIZ[0]) });
    assert.equal(e.chamadas.length, 1);
    const c = e.chamadas[0];
    for (const p of [c.rundir, c.repo, c.plugin]) { assert.ok(!R.dentroDe(e.fonte, p) && !R.dentroDe(e.raiz, p), `${p} fora do repo real`); assert.ok(R.dentroDe(e.base, p), `${p} sob o TMPDIR`); }
    assert.deepEqual(R.vazamentos([c.rundir, c.repo, ...c.argv], [e.fonte, e.raiz]), []);
    assert.ok(c.argv.includes(c.plugin), 'o --plugin-dir do produto é a cópia');
  });
  test('repo-real-alterado-durante-a-celula-INVALIDA-a-celula-com-causa-e-a-matriz-para (M: sem a prova)', async () => {
    const e = ambienteMatriz(async (a, fonte) => { writeFileSync(join(fonte, 'vazou.txt'), 'x'); return { status: 0, abortada: null }; });
    const m = await rodarMatriz(e);
    assert.equal(e.chamadas.length, 1, 'a matriz para: as outras 7 não rodam');
    const r = JSON.parse(readFileSync(join(m.base, idDaCelula(MATRIZ[0]), 'resultado.json'), 'utf8'));
    assert.equal(r.passa, false);
    assert.equal(r.resultados[0].id, 'isolamento');
    assert.match(r.resultados[0].detalhe, /status/);
    assert.equal(m.rel.ok, false); assert.equal(m.rel.passou, 0);
    assert.match(m.abortada, /isolamento|repo real/);
  });
  test('ref-que-o-orquestrador-move-pode-ser-ignorada-por-opção (--ignorar-ref); sem a opção a mesma mexida invalida', async () => {
    const mexe = async (a, fonte) => { git(fonte, 'commit', '-q', '--allow-empty', '-m', 'integração do orquestrador'); return { status: 0, abortada: null }; };
    const com = ambienteMatriz(mexe); const m1 = await rodarMatriz(com, { so: idDaCelula(MATRIZ[0]), ignorarRefs: [/^refs\/heads\/main$/] });
    assert.equal(m1.rel.passou, 1, 'ref ignorada não invalida'); assert.equal(m1.abortada, null);
    const sem = ambienteMatriz(mexe); const m2 = await rodarMatriz(sem, { so: idDaCelula(MATRIZ[0]) });
    assert.equal(m2.rel.passou, 0); assert.match(m2.abortada, /isolamento/);
  });
  test('repo-real-intocado-nao-invalida', async () => {
    const e = ambienteMatriz();
    const m = await rodarMatriz(e, { so: idDaCelula(MATRIZ[0]) });
    assert.equal(m.rel.passou, 1);
    assert.equal(m.abortada, null);
  });
  test('invariante-violada-aborta-na-hora-e-a-matriz-nao-roda-as-demais (plugin não ativo, 0 render)', async () => {
    const e = ambienteMatriz(async () => ({ status: 3, abortada: 'plugin gabarito-mestre não ativo' }));
    const m = await rodarMatriz(e);
    assert.equal(e.chamadas.length, 1);
    assert.equal(m.rel.passou, 0);
    assert.equal(m.rel.linhas.filter((l) => l.motivo === 'não executada').length, 7);
    assert.match(m.abortada, /plugin/);
    const r = JSON.parse(readFileSync(join(m.base, idDaCelula(MATRIZ[0]), 'resultado.json'), 'utf8'));
    assert.equal(r.passa, false); assert.equal(r.resultados[0].id, 'invariante');
  });
  test('falas-com-caminho-do-repo-real-recusam-a-matriz', async () => {
    const e = ambienteMatriz();
    await assert.rejects(() => calar(() => { const a = process.env.TMPDIR; process.env.TMPDIR = e.base; return R.matriz(e.fonte, e.raiz, { falas: [{ n: 1, texto: `abra ${e.fonte}/x`, rotulo: '—' }] }, null, { deps: e.deps }).finally(() => { process.env.TMPDIR = a; }); }), /caminho do repo real/);
    assert.equal(e.chamadas.length, 0);
  });
  test('paralelo-ignorado-reprova: --paralelo 2 roda 2 ao mesmo tempo e o padrão roda 1 (M: paralelo ignorado)', async () => {
    const lento = async () => { await new Promise((r) => setTimeout(r, 40)); return { status: 0, abortada: null }; };
    const um = ambienteMatriz(lento); await rodarMatriz(um);
    assert.equal(um.ativos.max, 1, 'padrão: 1'); assert.equal(um.chamadas.length, 8);
    const dois = ambienteMatriz(lento); const m = await rodarMatriz(dois, { paralelo: 2 });
    assert.equal(dois.ativos.max, 2); assert.equal(dois.chamadas.length, 8);
    assert.equal(m.rel.passou, 8);
  });
  test('ordem-de-gravacao: com paralelo, a célula rápida grava o resultado antes de a lenta terminar', async () => {
    const quando = {};
    const e = ambienteMatriz(async (a) => {
      if (a.celula === idDaCelula(MATRIZ[0])) { await new Promise((r) => setTimeout(r, 300)); return { status: 0, abortada: null }; }
      if (a.celula === idDaCelula(MATRIZ[1])) return { status: 0, abortada: null };
      for (let i = 0; i < 50 && !existsSync(join(a.rundir, '..', idDaCelula(MATRIZ[1]), 'resultado.json')); i += 1) await new Promise((r) => setTimeout(r, 20));
      quando[a.celula] = existsSync(join(a.rundir, '..', idDaCelula(MATRIZ[1]), 'resultado.json')) && !existsSync(join(a.rundir, '..', idDaCelula(MATRIZ[0]), 'resultado.json'));
      return { status: 0, abortada: null };
    });
    await rodarMatriz(e, { paralelo: 2 });
    assert.ok(Object.values(quando).some(Boolean), 'o resultado da 2ª existia no disco com a 1ª ainda rodando');
  });
});

describe('T49 execução do expect: vigia o repo real e para na hora', () => {
  const fakeExpect = (segundos) => { const d = tmp(); const f = join(d, 'expect'); writeFileSync(f, `#!/bin/sh\nexec sleep ${segundos}\n`); execFileSync('chmod', ['+x', f]); return f; };
  test('repo-real-mexido-no-meio-mata-o-expect-e-devolve-a-causa (M: aborto removido ⇒ espera os 30 s)', async () => {
    const fonte = tmpGit(); const rundir = tmp();
    const t0 = Date.now();
    setTimeout(() => writeFileSync(join(fonte, 'vazou.txt'), 'x'), 300);
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: fakeExpect(30), intervalo: 100 });
    assert.ok(Date.now() - t0 < 10000, `parou em ${Date.now() - t0} ms`);
    assert.match(r.abortada, /repo real/);
    assert.match(readFileSync(join(rundir, 'abortar.txt'), 'utf8'), /repo real/);
  });
  test('sem-mexida-espera-o-expect-acabar-sem-abortar', async () => {
    const fonte = tmpGit(); const rundir = tmp();
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: fakeExpect(1), intervalo: 100 });
    assert.equal(r.abortada, null); assert.equal(r.status, 0);
  });
  test('abortar.txt-escrito-pelo-a1.exp-ou-pelo-snapshot-mata-o-expect-na-hora', async () => {
    const fonte = tmpGit(); const rundir = tmp(); const t0 = Date.now();
    setTimeout(() => writeFileSync(join(rundir, 'abortar.txt'), '0 render observado no 1º snapshot\n'), 300);
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: fakeExpect(30), intervalo: 100 });
    assert.ok(Date.now() - t0 < 10000);
    assert.match(r.abortada, /0 render/);
  });
  test('status-do-a1.exp: NAO_PROVADO_PLUGIN e LOGIN abortam; CONCLUIDO não', () => {
    assert.match(R.causaDoStatus('NAO_PROVADO_PLUGIN'), /plugin/i);
    assert.match(R.causaDoStatus('NAO_PROVADO_LOGIN\n'), /login/i);
    assert.equal(R.causaDoStatus('CONCLUIDO'), null);
    assert.equal(R.causaDoStatus(''), null);
  });
  test('1º-snapshot-sem-render-da-superficie-esperada-aborta (lateral exige Pane; acima exige AbovePrompt)', () => {
    const pane = { ev: 'render', comp: 'Pane', bodyRows: 3 }; const acima = { ev: 'render', comp: 'AbovePrompt', maxRows: 3 };
    assert.match(R.invariantePrimeiroSnapshot([], { local: 'lateral' }), /0 render/);
    assert.match(R.invariantePrimeiroSnapshot([acima], { local: 'lateral' }), /Pane/, 'AbovePrompt não vale para lateral');
    assert.equal(R.invariantePrimeiroSnapshot([pane], { local: 'lateral' }), null);
    assert.equal(R.invariantePrimeiroSnapshot([acima], { local: 'acima' }), null);
    assert.match(R.invariantePrimeiroSnapshot([pane], { local: 'acima' }), /AbovePrompt/);
  });
  test('cli-snapshot-sem-render-no-1º-ponto-escreve-abortar.txt-e-nao-calcula-o-estado', () => {
    const rundir = tmp(); mkdirSync(join(rundir, 'obs'), { recursive: true });
    writeFileSync(join(rundir, 'celula.json'), JSON.stringify({ local: 'lateral', cols: 180, rows: 50, cheia: true }));
    writeFileSync(join(rundir, 'obs', 'a1.jsonl'), '');
    const r = spawnSync(process.execPath, [RUNNER, 'snapshot', tmp(), rundir, '1'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(rundir, 'abortar.txt'), 'utf8'), /0 render/);
    assert.equal(existsSync(join(rundir, 'estados', '01.json')), false);
  });
});

describe('T49 (c) evidência vazia é "não medida" e REPROVA (nunca passa em vácuo)', () => {
  const a = (id) => ASSERCOES.find((x) => x.id === id);
  const naoMedida = (id, mexe) => { const ev = evBoa(); mexe(ev); const r = a(id).avaliar(ev); assert.equal(r.ok, false, `${id}: ${r.detalhe}`); assert.match(r.detalhe, /não medida/, id); };
  test('boa-evidencia-segue-passando-com-o-novo-formato', () => { assert.equal(avaliarExecucao(evBoa()).passa, true); });
  test('12: sem leitura de panes pela plataforma (acima e lateral) é não medida', () => {
    naoMedida('12-placement-da-pane', (ev) => { ev.panesObservadas = false; });
    naoMedida('12-placement-da-pane', (ev) => { ev.celula = { local: 'acima', cols: 180, rows: 50, cheia: true }; ev.panes = []; ev.panesObservadas = false; });
  });
  test('12: lateral sem "placed" no debug.log é não medida; placed sem placement lido reprova dizendo qual fonte faltou', () => {
    naoMedida('12-placement-da-pane', (ev) => { ev.placementsDebug = []; });
    const ev = evBoa(); ev.panes = [];
    const r = a('12-placement-da-pane').avaliar(ev); assert.equal(r.ok, false); assert.match(r.detalhe, /placed/);
  });
  test('12: lateral onde a plataforma disse "unplaced" reprova (é o defeito que a T50 trata, não vácuo)', () => {
    const ev = evBoa(); ev.placementsDebug = [{ colunas: 80, estado: 'unplaced' }];
    const r = a('12-placement-da-pane').avaliar(ev); assert.equal(r.ok, false); assert.match(r.detalhe, /unplaced/);
  });
  test('12: acima com ui.open no debug.log reprova (nunca os dois)', () => {
    const ev = evBoa({ local: 'acima', cols: 180, rows: 50, cheia: true }); ev.placementsDebug = [{ colunas: 180, estado: 'placed' }];
    assert.equal(a('12-placement-da-pane').avaliar(ev).ok, false);
  });
  test('9: sem nenhum veredito é não medida', () => { naoMedida('9-veredito-com-revisor-antes', (ev) => { ev.eventos = ev.eventos.filter((e) => e.tipo !== 'review.veredito'); }); });
  test('3: sem task integrada nem quadro é não medida', () => {
    naoMedida('3-sem-task-integrada', (ev) => { ev.integradas = []; });
    naoMedida('3-sem-task-integrada', (ev) => { ev.quadros = []; });
  });
  test('8a: sem dono.mensagem gravada nem digitada é não medida', () => {
    naoMedida('8a-dono-mensagem-sem-duplicata', (ev) => { ev.eventos = ev.eventos.filter((e) => e.tipo !== 'dono.mensagem'); });
    naoMedida('8a-dono-mensagem-sem-duplicata', (ev) => { ev.digitadas = []; });
  });
  test('7: sem nenhuma chamada no transcript é não medida', () => { naoMedida('7-sem-edit-em-harness-nem-status-a-mao', (ev) => { ev.transcript.chamadas = []; ev.transcript.textos = []; }); });
  test('as-demais-sem-evidência-reprovam-e-a-execução-reprova (nenhuma isenção, nenhuma contagem à parte)', () => {
    const vazio = evBoa();
    Object.assign(vazio, { quadros: [], integradas: [], eventos: [], digitadas: [], transcript: { chamadas: [], textos: [] }, perguntas: [], despachos: [], entregasPublicadas: [], vivos: [], panes: [], panesObservadas: false, placementsDebug: [], pouso: { percent: 0, limparNoDepende: false, pushes: 0, despachosDepois: 0 } });
    const r = avaliarExecucao(vazio);
    assert.equal(r.passa, false);
    assert.deepEqual(r.resultados.filter((x) => x.ok).map((x) => x.id), [], 'nenhuma asserção passa sobre evidência vazia');
  });
});

describe('T49 avaliar offline: a mesma avaliação da execução, sobre uma execução já gravada', () => {
  test('avaliarRundir-iguala-coletar+avaliarExecucao (online e offline não divergem)', async () => {
    const m = montarExecucao({});
    const celula = { local: 'lateral', cols: 180, rows: 50, cheia: true };
    const off = await R.avaliarRundir(m.rundir, { repo: m.repo, celula, roteiro: roteiroColeta(), pasta: m.pasta, total: 1 });
    const on = avaliarExecucao(await coletar(m.rundir, m.repo, celula, roteiroColeta(), { pasta: m.pasta, total: 1 }));
    assert.deepEqual(off, on);
    // sem nenhum `estado` do observador (panes nunca lidas) a asserção 12 é "não medida" nos dois caminhos
    const m2 = montarExecucao({}); writeFileSync(join(m2.rundir, 'obs', 'a1.jsonl'), `${JSON.stringify({ t: 2, ev: 'render', comp: 'Pane', bodyRows: 12, bodyColumns: 60 })}\n`);
    const off2 = await R.avaliarRundir(m2.rundir, { repo: m2.repo, celula, roteiro: roteiroColeta(), pasta: m2.pasta, total: 1 });
    assert.deepEqual(off2, avaliarExecucao(await coletar(m2.rundir, m2.repo, celula, roteiroColeta(), { pasta: m2.pasta, total: 1 })));
    assert.match(off2.resultados.find((x) => x.id === '12-placement-da-pane').detalhe, /não medida/);
  });
  test('abortar.txt-escrito-e-expect-que-ja-saiu-tambem-aborta', async () => {
    const fonte = tmpGit(); const rundir = tmp();
    const f = join(tmp(), 'expect'); writeFileSync(f, `#!/bin/sh\necho "0 render observado" > ${rundir}/abortar.txt\nexit 0\n`); execFileSync('chmod', ['+x', f]);
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: f, intervalo: 5000 });
    assert.match(r.abortada, /0 render/);
  });
  test('celula-vem-do-nome-da-pasta-ou-do-celula.json', () => {
    assert.deepEqual(R.celulaDoRundir('/x/lateral-180x50-cheia'), { local: 'lateral', cols: 180, rows: 50, cheia: true });
    assert.deepEqual(R.celulaDoRundir('/x/acima-80x24-normal'), { local: 'acima', cols: 80, rows: 24, cheia: false });
    assert.equal(R.celulaDoRundir('/x/qualquer'), null);
  });
  test('o-debug.log-da-execução-entra-na-evidência-de-placement', async () => {
    const m = montarExecucao({});
    writeFileSync(join(m.rundir, 'debug.log'), '2026-11-14T04:43:26.718Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, 180 columns): placed\n');
    const ev = await coleta0(m);
    assert.deepEqual(ev.placementsDebug, [{ colunas: 180, estado: 'placed' }]);
    assert.equal(ev.panesObservadas, true);
    const sem = montarExecucao({ semDebug: true }); const ev2 = await coleta0(sem);
    assert.deepEqual(ev2.placementsDebug, []);
  });
  test('regressão-offline-nas-8-execuções-gravadas-da-T25 (a correção (c) derruba o vácuo e nada passa a aprovar; pula se o artefato local não existe)', async (t) => {
    const dir = join(R.raizDoRepoReal(), '.claude-tmp', 'a1', '1794625214308');
    const roteiroArq = join(R.raizDoRepoReal(), ROTEIRO_REL);
    if (!existsSync(dir) || !existsSync(roteiroArq)) { t.skip('execuções gravadas ou roteiro ausentes'); return; }
    const roteiro = R.verificarRoteiro(roteiroArq, JSON.parse(readFileSync(PONTOS_ARQ, 'utf8')).roteiroSha256);
    if (!roteiro.ok) { t.skip(roteiro.motivo); return; }
    for (const c of MATRIZ) {
      const id = idDaCelula(c);
      const antigo = JSON.parse(readFileSync(join(dir, id, 'resultado.json'), 'utf8'));
      const novo = await R.avaliarRundir(join(dir, id), { roteiro });
      const ok = (r) => new Set(r.resultados.filter((x) => x.ok).map((x) => x.id));
      assert.deepEqual([...ok(novo)].filter((x) => !ok(antigo).has(x)), [], `${id}: nada passa a aprovar`);
      for (const vacuo of ['3-sem-task-integrada', '8a-dono-mensagem-sem-duplicata']) assert.equal(novo.resultados.find((x) => x.id === vacuo).ok, false, `${id}: ${vacuo} era vácuo`);
      assert.equal(novo.passa, false);
    }
  });
});
async function coleta0(m) { return coletar(m.rundir, m.repo, { local: 'lateral', cols: 180, rows: 50, cheia: true }, roteiroColeta(), { pasta: m.pasta, total: 1 }); }

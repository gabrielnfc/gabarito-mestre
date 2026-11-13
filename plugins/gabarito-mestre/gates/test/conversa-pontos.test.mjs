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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSERCOES, MATRIZ, MIN_FALA, PONTOS_ARQ, ROTEIRO_REL, TOTAL_PONTOS, avaliarExecucao, avaliarMatriz, falasDoRoteiro, guardaFalas, idDaCelula,
  placementEsperado, raizPrincipal, sha256, validarPontos, verificarRoteiro,
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
  'RECENTE · 10:00 ✓ Gandalf integrou T1 (automático)', '  09:50 ✓ Sombra decidiu o escopo da T2 (automático)',
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
    { tipo: 'decisao.sombra', dados: {} },
  ],
  digitadas: ['a'.repeat(64)],
  transcript: { chamadas: [{ nome: 'Agent', negada: false, turnoDeStatus: true }, { nome: 'Write', entrada: { file_path: '/r/src/a.mjs' } }], textos: ['pronto, segue o plano'] },
  perguntas: [{ ponto: 1, rotulo: 'MUDANÇA DE ASSUNTO', abriuPergunta: true, botoes: true }, { ponto: 2, rotulo: 'DECISÃO', abriuPergunta: false, botoes: false }],
  despachos: [{ papel: 'implementador', prompt: 'brief ... regra A ... regra B', aprendizados: ['regra A', 'regra B'] }],
  entregasPublicadas: ['GM-12'], gravacoes: { 'GM-12': { antes: 5, depois: 5 }, 'GM-13': { antes: 0, depois: 9 } },
  vivos: { ativos: 1, linhasAgente: 1, detalhes: [{ nome: 'Frodo', descricao: 'implementa T3', task: 'T3', acao: 'lendo 2 arquivos' }] },
  pouso: { percent: 50, limparNoDepende: true, pushes: 1, despachosDepois: 0 },
  panes: [{ placement: placementEsperado(celula) ?? 'x' }].filter(() => placementEsperado(celula) !== null),
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
      // 80×24: sem RECENTE (primeiro a sair) e blocos 1–3 presentes
      // (sem decisão da Sombra registrada: a que existe mora no RECENTE, que em 80×24 é o primeiro a sair; ver `8f-80x24-...` abaixo)
      if (c.cols === 80) { ev.quadros = [{ linhas: QUADRO_CHEIO.slice(0, 5), itensDepende: 1 }]; ev.eventos = ev.eventos.filter((e) => e.tipo !== 'decisao.sombra'); }
      const r = avaliarExecucao(ev);
      assert.deepEqual(r.resultados.filter((x) => !x.ok), [], idDaCelula(c));
      assert.equal(r.passa, true);
    }
  });

  const estraga = {
    '1-depende-no-topo': (ev) => { ev.quadros[0].linhas = [QUADRO_CHEIO[0], QUADRO_CHEIO[2], QUADRO_CHEIO[1], ...QUADRO_CHEIO.slice(3)]; },
    '2-blocos-e-corte': (ev) => { ev.quadros[0].linhas = QUADRO_CHEIO.filter((l) => !/^PRONTO/.test(l)); },
    '3-sem-task-integrada': (ev) => { ev.quadros[0].linhas = [...QUADRO_CHEIO.slice(0, 5), 'ATENÇÃO · T1 parou', ...QUADRO_CHEIO.slice(6)]; },
    '4-agora-ativos': (ev) => { ev.vivos.detalhes.push({ nome: 'Frodo', descricao: 'd', task: 'T4', acao: '(registrado)' }); },
    '5-sem-emoji': (ev) => { ev.transcript.textos.push('feito ✅'); },
    '6-assunto-vira-pergunta': (ev) => { ev.perguntas[0].botoes = false; },
    '7-sem-edit-em-harness-nem-status-a-mao': (ev) => { ev.transcript.chamadas.push({ nome: 'Edit', entrada: { file_path: '/r/.harness/entregas/GM-13/plano.json' } }); },
    '8a-dono-mensagem-sem-duplicata': (ev) => { ev.eventos.push({ tipo: 'dono.mensagem', dados: { sha256: 'a'.repeat(64), chars: 30 } }); },
    '8b-agent-nao-negado-em-status': (ev) => { ev.transcript.chamadas[0].negada = true; },
    '8c-nada-em-entrega-publicada': (ev) => { ev.gravacoes['GM-12'].depois = 6; },
    '8d-vivo-com-nome-descricao-task': (ev) => { ev.vivos.detalhes[0].descricao = ''; },
    '8e-vivos-igual-linhas-de-agente': (ev) => { ev.vivos.linhasAgente = 2; },
    '8f-sombra-decisao-visivel': (ev) => { ev.quadros[0].linhas = QUADRO_CHEIO.filter((l) => !/Sombra/.test(l)); },
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

  test('8f-80x24-tensao-da-spec: decisão da Sombra mora no RECENTE e o RECENTE sai primeiro; a asserção segue estrita', () => {
    const ev = evBoa({ local: 'lateral', cols: 80, rows: 24, cheia: false });
    ev.quadros = [{ linhas: QUADRO_CHEIO.slice(0, 5), itensDepende: 1 }];
    assert.equal(ASSERCOES.find((a) => a.id === '8f-sombra-decisao-visivel').avaliar(ev).ok, false);
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
    const lateral = evBoa(); lateral.quadros = [{ linhas: [...QUADRO_CHEIO.slice(0, 7), '  09:50 ✓ Sombra decidiu o escopo da T2'], itensDepende: 1 }];
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

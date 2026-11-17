/**
 * GM-14 T24: o runner do aceite A1 e a guarda das falas. Em `npm test`; o runner em si (`e2e/conversa-2026-11-11/rodar-a1.mjs`, `a1.exp`) fica FORA: abre
 * o TUI real. Aqui só o que é puro ou local: a forma de `pontos.json` (nunca a fala do dono), a guarda das falas em `git ls-files`, o "sem roteiro" que
 * diz por quê, a matriz de 8 células com o `placement` esperado e cada uma das asserções do A1 (uma evidência boa passa; a mesma, estragada num campo, reprova).
 *
 * O ESPERADO VEM DA SPEC (Aceite A1, matriz r4): 12 asserções por execução (a 8 tem 6), `placement` `dock` só em 180×50 tela cheia, `inline` nas outras 3 `lateral`,
 * 0 Pane em `acima`; passa = 8/8. As falas do roteiro (`.superpowers/`, fora do git) NUNCA são copiadas para cá: os casos de guarda usam roteiro sintético.
 * MUTAÇÃO PRESCRITA: M21 (apagar a guarda das falas) ⇒ `guarda-falas-em-ls-files` e `runner-guarda-barra-fala-versionada` reprovam.

 * LIMITE DECLARADO (T52 r1, MINOR-2): os testes sobre tela real (`placement-lido-de-tela-gravada-real`, `replay-reconstruido-…26/26`, `lateral-80x24-normal sem lixo`) leem `.claude-tmp/a1/1794625214308`
 * (não versionável: o tty.raw leva as falas) e PULAM no CI; lá só roda a cobertura sintética.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { raizSegura } from './_raiz-segura.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ASSERCOES, LINHA_DECISAO, MATRIZ, resumoDoAgora, MIN_FALA, PONTOS_ARQ, ROTEIRO_REL, TOTAL_PONTOS, acoesDe, avaliarExecucao, avaliarMatriz, coletar, dialogosDoExpLog, permissaoDoExpLog, validarFalas1a1, entradaDoSnapshot, falasDoRoteiro, guardaFalas, idDaCelula,
  itensDeProxima, placementEsperado, pluginCarregou, resolverSuperpowers, ambienteDaExecucao, SUPERPOWERS_VERSAO, matriz, configDaConta, pastaDeTranscripts, propsDe, publicadaPeloProduto, raizPrincipal, renderizar, semearEntregaPublicada, ENTREGA_ATIVA, ENTREGA_PUBLICADA, prepararCopia, BASE_SHA, sha256, validarPontos, verificarRoteiro,
} from './e2e/conversa-2026-11-11/rodar-a1.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(AQUI, 'e2e', 'conversa-2026-11-11', 'rodar-a1.mjs');
const TMPS = [];
after(() => { for (const d of TMPS) rmSync(d, { recursive: true, force: true }); });
// T58 (emenda 66): variável de ambiente ausente se restaura APAGANDO, nunca atribuindo `undefined` (vira a string "undefined").
const restaurarEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
const comEnv = (k, valor, fn) => {
  const antes = process.env[k]; process.env[k] = valor;
  let r; try { r = fn(); } catch (e) { restaurarEnv(k, antes); throw e; }
  return r && typeof r.then === 'function' ? r.finally(() => restaurarEnv(k, antes)) : (restaurarEnv(k, antes), r);
};
const temExpect = (t) => { if (spawnSync('expect', ['-v'], { encoding: 'utf8' }).error) { t.skip('expect ausente'); return false; } return true; };
const tmp = () => { const d = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'conversa-pontos-')))); // real: sem TMPDIR o macOS cai em /tmp (symlink de /private/tmp)
  TMPS.push(d); return d; };
test('T58: restaurar variável de ambiente ausente a deixa AUSENTE (nunca a string "undefined"); com valor, devolve o valor', () => {
  const salvo = process.env.TMPDIR;
  try {
    delete process.env.TMPDIR;
    restaurarEnv('TMPDIR', undefined); // não pode gravar 'undefined'
    assert.equal('TMPDIR' in process.env, false, 'TMPDIR continua ausente');
    comEnv('TMPDIR', '/x-t58', () => assert.equal(process.env.TMPDIR, '/x-t58'));
    assert.equal('TMPDIR' in process.env, false, 'comEnv com TMPDIR ausente devolve ausente');
    process.env.TMPDIR = '/orig-t58';
    comEnv('TMPDIR', '/x-t58', () => {});
    assert.equal(process.env.TMPDIR, '/orig-t58', 'comEnv com valor devolve o valor');
    assert.equal(tmpdir() !== 'undefined', true);
  } finally { restaurarEnv('TMPDIR', salvo); }
});
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
/** A sessão curta boa (T52): o que `lerSessaoCurta` devolve quando a tela, a resposta (b), o pedido do dono e o debug.log estão como a spec manda para a combinação. */
const curtaBoa = (celula) => {
  const esperado = placementEsperado(celula); const pedido = R.precisaPedido(celula);
  const quadro = (placement, aviso) => ({ placement, bodyRows: placement === null ? null : 12, bodyColumns: placement === null ? null : 60, interior: [], aviso, parou: false, perguntaAberta: false });
  const sem = { estado: null, n: null };
  return {
    fonte: 'tela', quadros: 40, marcos: ['inicio', 'b-respondida', ...(pedido ? ['pedido', 'depois-do-pedido'] : [])],
    respostaB: { estado: 'respondida', pergunta: 'sess:3', resposta: 3 }, pedido, pedidoFeito: pedido,
    antes: quadro(pedido ? null : esperado, pedido ? { estado: 'inteiro', n: 144 } : sem), depois: quadro(esperado, sem),
    debug: esperado === null ? [] : [...(pedido ? [{ colunas: celula.cols, estado: 'unplaced', unasked: true, limiar: 144 }] : []), { colunas: celula.cols, estado: 'placed' }],
    abovePrompt: celula.local === 'acima' ? { maxRows: 7, rows: celula.rows, bodyColumns: celula.cols - 5 } : null,
  };
};
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
  entregasPublicadas: ['GM-12'], gravacoes: { 'GM-12': { antes: 5, depois: 5 }, 'GM-13': { antes: 0, depois: 9 } },
  quadrosSemProps: 0,
  vivos: [{ ativos: 0, linhasAgente: 0, detalhes: [] }, { ativos: 1, linhasAgente: 1, detalhes: [{ nome: 'Frodo', descricao: 'implementa T3', task: 'T3', acao: 'lendo 2 arquivos' }] }],
  pouso: { percent: 50, limparNoDepende: true, pushes: 1, despachosDepois: 0 },
  sessaoCurta: curtaBoa(celula),
  debugLogAtivo: true,
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
    '8c-nada-em-entrega-publicada': (ev) => { ev.gravacoes['GM-12'].depois = 6; },
    '8d-vivo-com-nome-descricao-task': (ev) => { ev.vivos[1].detalhes[0].descricao = ''; },
    '8e-vivos-igual-linhas-de-agente': (ev) => { ev.vivos[1].linhasAgente = 2; },
    '8f-sombra-decisao-visivel': (ev) => { ev.quadros[0].linhas = QUADRO_CHEIO.filter((l) => !/decidiu:/.test(l)); },
    '9-veredito-com-revisor-antes': (ev) => { ev.eventos.splice(1, 1); },
    '10-despachos-com-aprendizados': (ev) => { ev.despachos[0].prompt = 'brief sem as regras'; },
    '11-pouso-a-50': (ev) => { ev.pouso.despachosDepois = 1; },
    '12-placement-da-pane': (ev) => { ev.sessaoCurta.depois.placement = 'inline'; },
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

  test('placement-incoerente-reprova-nas-quatro-lateral-e-pane-em-acima (lido da TELA da sessão curta)', () => {
    const casos = [
      [{ local: 'lateral', cols: 180, rows: 50, cheia: true }, (sc) => { sc.depois.placement = 'inline'; }, false],
      [{ local: 'lateral', cols: 180, rows: 50, cheia: false }, (sc) => { sc.depois.placement = 'dock'; }, false],
      [{ local: 'lateral', cols: 80, rows: 24, cheia: true }, (sc) => { sc.depois.placement = 'dock'; }, false],
      [{ local: 'lateral', cols: 80, rows: 24, cheia: false }, () => {}, true],
      [{ local: 'lateral', cols: 80, rows: 24, cheia: false }, (sc) => { sc.depois.placement = null; }, false],
      [{ local: 'acima', cols: 180, rows: 50, cheia: true }, (sc) => { sc.depois.placement = 'dock'; }, false],
      [{ local: 'acima', cols: 180, rows: 50, cheia: true }, () => {}, true],
    ];
    const a12 = ASSERCOES.find((a) => a.id === '12-placement-da-pane');
    for (const [c, mexe, esperado] of casos) {
      const ev = evBoa(c); mexe(ev.sessaoCurta);
      assert.equal(a12.avaliar(ev).ok, esperado, `${idDaCelula(c)} ${a12.avaliar(ev).detalhe}`);
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
  for (const d of [join(rundir, 'obs'), join(rundir, 'estados'), join(repo, '.harness', 'entregas', 'GM-12'), join(repo, '.harness', 'entregas', 'GM-13'), pasta]) mkdirSync(d, { recursive: true });
  writeFileSync(join(rundir, 'inicio.iso'), '2026-11-13T10:00:00.000Z\n');
  writeFileSync(join(rundir, 'sends.log'), `1 digitar ${sha256(FALA_A)}\n2 digitar ${sha256(FALA_STATUS)}\n`);
  // T55 (emenda 61): a conversa roda na GM-13 ATIVA (as mensagens do dono vão para ela); a publicada vigiada é OUTRA (GM-12: PR mergeado + release, `fato.medido` do produto, `ts` antes do início)
  let seq = 0;
  const pr = (numero, estado, ts) => ({ sessao: 'semente', seq: ++seq, ts, tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'enabler/GM-12-a1' } } });
  jl(join(repo, '.harness', 'entregas', 'GM-12', 'events.semente.jsonl'), [
    ...(v.soDuranteExecucao === true ? [] : v.semPublicada === true ? [pr(14, 'aberto', '2026-11-10T12:00:00.000Z')] : [pr(14, 'mergeado', '2026-11-10T12:00:00.000Z')]),
    { sessao: 'semente', seq: ++seq, ts: '2026-11-10T12:00:01.000Z', tipo: 'fato.medido', dados: { chave: 'release', fonte: 'gh', valor: { tag: 'v2.0.0' } } },
    ...(v.mergeadaDuranteExecucao === true ? [pr(15, 'mergeado', '2026-11-13T10:06:00.000Z')] : []),
    ...(v.gravouNaPublicada === true ? [{ sessao: 'semente', seq: ++seq, ts: '2026-11-13T10:05:00.000Z', tipo: 'dono.mensagem', dados: { sha256: sha256(FALA_A), chars: 47 } }] : []),
  ]);
  // o que o painel grava na 1ª medição de cada sessão (painel-medir.mjs): `fato.medido` de branch, spec, plano, pr e release, depois do início
  const medidos = ['branch', 'spec', 'plano', 'pr', 'release'].map((chave, i) => ({ sessao: 'painel-s1', seq: i + 1, ts: `2026-11-13T10:04:0${i}.000Z`, autor: 'painel', agente: 'painel', tipo: 'fato.medido', dados: { chave, fonte: 'gh', valor: chave === 'pr' ? { numero: 14, estado: 'mergeado', branch: 'enabler/GM-12-a1' } : { medido: true } } }));
  if (v.painelMediuNaPublicada === true) jl(join(repo, '.harness', 'entregas', 'GM-12', 'events.painel-s1.jsonl'), medidos);
  if (v.painelMediuNaAtiva === true) jl(join(repo, '.harness', 'entregas', 'GM-13', 'events.painel-s1.jsonl'), medidos);
  jl(join(repo, '.harness', 'entregas', 'GM-13', 'events.loop.jsonl'), [{ seq: 1, ts: '2026-11-13T10:02:00.000Z', tipo: 'dono.mensagem', dados: { sha256: sha256(FALA_A), chars: 47 } }]);
  jl(join(rundir, 'obs', 'a1.jsonl'), [
    { t: 1, ev: 'estado', agentes: v.semAgentes === true ? [] : [{ id: AGENTE.id, type: AGENTE.type, status: 'running', description: AGENTE.description }], panes: [{ id: 'gabarito-painel', placement: v.placement ?? 'dock' }], nomes: null },
    { t: 2, ev: 'render', comp: 'Pane', bodyRows: 12, bodyColumns: 60 },
  ]);
  if (v.semDebug !== true) writeFileSync(join(rundir, 'debug.log'), '2026-11-14T04:40:00.000Z [DEBUG] Checking plugin gabarito-mestre: enabled\n2026-11-14T04:43:26.718Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, 180 columns): placed\n');
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
    assert.equal(ev.sessaoCurta, null, 'a conversa não é sessão curta: a asserção 12 vem da tela da curta (T52), nunca do observador');
    assert.deepEqual(ev.digitadas, [sha256(FALA_A), sha256(FALA_STATUS)]);
    assert.deepEqual(ev.entregasPublicadas, ['GM-12'], 'só a OUTRA entrega é publicada; a da conversa (GM-13) fica ativa e nunca é vigiada');
    assert.deepEqual(ev.gravacoes['GM-12'], { antes: 2, depois: 2 });
    assert.deepEqual(ev.gravacoes['GM-13'], { antes: 0, depois: 1 }, 'a fala do dono grava na ativa');
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
    assert.deepEqual(painel.entregasPublicadas, ['GM-12'], 'a publicada continua publicada: o que o painel mede depois do início não a muda');
    assert.deepEqual(painel.gravacoes['GM-12'], { antes: 2, depois: 2 }, 'fato.medido autor painel não conta');
    assert.equal(resultado(painel, id).ok, true, 'o painel gravar fato.medido no diário da publicada passa');
    const naAtiva = await coleta({ painelMediuNaAtiva: true });
    assert.deepEqual(naAtiva.gravacoes['GM-12'], { antes: 2, depois: 2 });
    assert.equal(resultado(naAtiva, id).ok, true);
    const msg = await coleta({ gravouNaPublicada: true, painelMediuNaPublicada: true });
    assert.deepEqual(msg.gravacoes['GM-12'], { antes: 2, depois: 3 }, 'dono.mensagem conta mesmo com o fato.medido do painel junto');
    assert.equal(resultado(msg, id).ok, false, 'dono.mensagem na publicada reprova');
  });

  test('8c-vigia-OUTRA-entrega-publicada-e-a-ativa-gravada-nao-reprova (T55, emenda 61)', async () => {
    const id = '8c-nada-em-entrega-publicada';
    const ev = await coleta({});
    assert.deepEqual(ev.entregasPublicadas, [ENTREGA_PUBLICADA]);
    assert.ok(!ev.entregasPublicadas.includes(ENTREGA_ATIVA), 'a entrega da conversa não é a vigiada');
    assert.notEqual(ENTREGA_PUBLICADA, ENTREGA_ATIVA);
    assert.ok(ev.gravacoes[ENTREGA_ATIVA].depois > ev.gravacoes[ENTREGA_ATIVA].antes, 'a ativa foi gravada (dono.mensagem) e isso é o esperado');
    assert.equal(resultado(ev, id).ok, true, 'gravar na ativa não reprova a 8c');
    const g = await coleta({ gravouNaPublicada: true });
    assert.equal(resultado(g, id).ok, false, 'gravar na publicada vigiada reprova');
  });

  test('8c-reprova-com-gravacao-na-publicada-e-sem-publicada-nenhuma', async () => {
    assert.equal(resultado(await coleta({}), '8c-nada-em-entrega-publicada').ok, true);
    const grav = await coleta({ gravouNaPublicada: true });
    assert.deepEqual(grav.gravacoes['GM-12'], { antes: 2, depois: 3 });
    assert.equal(resultado(grav, '8c-nada-em-entrega-publicada').ok, false);
    const nenhuma = await coleta({ semPublicada: true });
    assert.deepEqual(nenhuma.entregasPublicadas, [], 'PR aberto: pelo critério do produto não está publicada');
    assert.equal(resultado(nenhuma, '8c-nada-em-entrega-publicada').ok, false, '0 publicada vigiada: a asserção não mediu nada e reprova');
  });

  test('publicada-e-o-criterio-do-produto-medido-antes-do-inicio (O2: o que a execução mede não conta)', async () => {
    const durante = await coleta({ mergeadaDuranteExecucao: true });
    assert.deepEqual(durante.entregasPublicadas, ['GM-12'], 'o PR #15 mergeado durante a execução não muda o que estava publicado');
    const so = await coleta({ soDuranteExecucao: true, mergeadaDuranteExecucao: true });
    assert.deepEqual(so.entregasPublicadas, [], 'um PR mergeado medido DURANTE a execução não torna a entrega publicada (filtro `ts <= inicio`)');
    let n = 0;
    const ev = (numero, estado, ts, branch) => ({ sessao: 's', seq: ++n, ts, tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: branch ?? `enabler/${ENTREGA_PUBLICADA}-a1` } } });
    const Z = '2026-11-13T00:00:00.000Z';
    const T = (h) => `2026-11-12T0${h}:00:00.000Z`;
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1))], Z), true);
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1)), ev(15, 'aberto', T(2))], Z), false, 'PR aberto ⇒ não publicada (critério do produto)');
    assert.equal(await publicadaPeloProduto([ev(14, 'aberto', T(1)), ev(15, 'mergeado', T(2))], Z), false, 'último mergeado MAS com outro PR aberto ⇒ não publicada (FIEL-1 b: nenhum aberto)');
    assert.equal(await publicadaPeloProduto([{ sessao: 's', seq: 1, ts: T(1), tipo: 'entrega.fim', dados: { ok: true } }], Z), false, 'entrega.fim não é o critério do produto');
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1))], T(0)), false, 'medido depois do início não conta');
    // REQ-ENT-1 (a): o fato sem `via` cujo head não casa o ID sai da entrega (descarte por head); o fixture antigo com head `b` era publicada só porque `prs()` não descartava
    assert.equal(await publicadaPeloProduto([ev(14, 'mergeado', T(1), 'enabler/GM-99-x')], Z), false, 'head de outra entrega não publica esta');
    assert.equal(await publicadaPeloProduto([], Z), false);
  });

  test('semente-publica-OUTRA-entrega-e-deixa-a-da-conversa-ativa (T55, emenda 61: id e branch próprios, gh sem PR na branch da conversa)', async () => {
    const { idDaBranch, trilhaDe } = await import('../dist/trilha.js');
    const estado = JSON.parse(readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'gh-fixture', 'estado.json'), 'utf8'));
    assert.equal(idDaBranch(estado.branch, '[A-Z]+-\\d+'), ENTREGA_ATIVA, 'a branch da cópia é a que o produto identifica como a da conversa (pontos.json:9-12 pressupõe a GM-13 ativa)');
    assert.deepEqual(estado.pr, [], 'o gh de fixture não devolve PR (nem mergeado) para a branch da conversa');
    assert.deepEqual(estado.release, []);
    const base = tmp();
    semearEntregaPublicada(base);
    const { lerEstrito } = await import('../dist/diario.js');
    const lido = (id) => { const dir = join(base, '.harness', 'entregas', id); if (!existsSync(dir)) return []; const l = lerEstrito(dir); return l.eventos ?? l; };
    const FUT = '2099-01-01T00:00:00.000Z';
    assert.equal(await publicadaPeloProduto(lido(ENTREGA_PUBLICADA), FUT, ENTREGA_PUBLICADA), true, 'a semente é publicada pelo critério do produto, com id e branch próprios');
    assert.equal(lido(ENTREGA_ATIVA).length, 0, 'a entrega da conversa não recebe NENHUM evento da semente');
    assert.equal(await publicadaPeloProduto(lido(ENTREGA_ATIVA), FUT, ENTREGA_ATIVA), false, 'a da conversa não é publicada');
    assert.ok(lido(ENTREGA_PUBLICADA).every((e) => e.dados?.chave !== 'pr' || e.dados.valor.branch === `enabler/${ENTREGA_PUBLICADA}-a1`), 'o PR semeado é da branch da publicada vigiada, nunca da conversa');
    const t = trilhaDe({ branch: estado.branch, idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: ['T1'] }, ledger: false, gh: 'ok', ultimas: [] }, lido(ENTREGA_ATIVA));
    assert.equal(t.identificada, true, 'sessão da conversa identificada: fala do dono grava, loop e despacho valem');
    assert.equal(t.entrega, ENTREGA_ATIVA);
    assert.throws(() => semearEntregaPublicada(tmp(), ENTREGA_ATIVA), /id próprio/, 'a semente nunca publica a entrega da conversa');
    assert.throws(() => semearEntregaPublicada(tmp(), 'invalido'), /id próprio/);
  });

  // T55 (emenda 61), provas (i)(ii) com o produto de verdade: cópia real da A1 (clone na base), ponte do mod (`codigoPonte`), `painel.mjs`, `loop.mjs`; sem sessão do Claude. Sem a base no clone, pula (não passa em vazio).
  const baseDisponivel = (() => { try { execFileSync('git', ['cat-file', '-e', `${BASE_SHA}^{commit}`], { cwd: raizPrincipal(), stdio: 'ignore' }); return true; } catch { return false; } })();
  test('copia-real-da-A1: a conversa roda na ativa (fala grava, painel = pontos.json msg 1) e a publicada vigiada nada recebe; a semente antiga reproduz a causa', { skip: baseDisponivel ? false : `base ${BASE_SHA} ausente no clone` }, async () => {
    const { codigoPonte } = await import('../dist/pouso.js');
    const { lerEstrito, append } = await import('../dist/diario.js');
    const PL = join(AQUI, '..');
    const raiz = tmp(); const destino = join(raiz, 'repo');
    const { bin, gh } = prepararCopia(raizPrincipal(), destino, { local: 'lateral', cols: 180, rows: 50, cheia: true });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_FIXTURE: gh };
    const url = pathToFileURL(join(PL, 'dist', 'diario.js')).href;
    const ponte = (p) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', codigoPonte(url)], { cwd: destino, input: JSON.stringify(p), encoding: 'utf8', env }).stdout);
    const lerTudo = (id) => { const l = lerEstrito(join(destino, '.harness', 'entregas', id)); return l.eventos ?? l; };
    const n = (id, tipo) => lerTudo(id).filter((e) => e.tipo === tipo).length;
    const sh = (script, args, input) => spawnSync(process.execPath, [join(PL, 'scripts', script), ...args], { cwd: destino, input, encoding: 'utf8', env });
    const FUT = '2099-01-01T00:00:00.000Z';
    const antesPub = lerTudo(ENTREGA_PUBLICADA).length;
    // (ii) fixture nova
    const dir = ponte({ op: 'dir', cwd: destino });
    assert.deepEqual([dir.identificada, dir.entrega], [true, ENTREGA_ATIVA], 'a conversa é identificada na GM-13');
    assert.equal(ponte({ op: 'mensagem', dir: dir.dir, cwd: destino, texto: 'fala do dono' }).ok, true);
    assert.equal(n(ENTREGA_ATIVA, 'dono.mensagem'), 1, 'a fala grava dono.mensagem na ativa');
    assert.equal(n(ENTREGA_PUBLICADA, 'dono.mensagem'), 0);
    const med = JSON.parse(sh('painel.mjs', ['medir', '--agentes'], JSON.stringify({ session_id: 'painel-s1', sessao: { session_id: 'painel-s1', percent: null }, agentes: [] })).stdout);
    assert.equal(med.ok, true);
    // GM-15 T19: esta cópia não é sobre o loop; arma o sinal da sessão (forma do mod: gabarito.mjs `interpretarSinalLoop`) para o painel não avisar "ligar o loop"
    mkdirSync(join(destino, '.harness', 'contexto'), { recursive: true });
    writeFileSync(join(destino, '.harness', 'contexto', 'loop-dinamico.painel-s1.json'), JSON.stringify({ estado: 'armado', intervalo: 0, dinamico: 1, sessao: 'painel-s1', em: new Date().toISOString() }) + '\n');
    const est = JSON.parse(sh('painel.mjs', ['estado', '--sessao', 'painel-s1']).stdout).estado;
    const pt = JSON.parse(readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'pontos.json'), 'utf8')).pontos[0].esperado;
    assert.equal(est.id, ENTREGA_ATIVA);
    assert.equal(est.trilha.fase, pt.fase);
    assert.equal(est.trilha.progresso, pt.progresso);
    assert.deepEqual(est.depende.map((d) => d.motivo.replace(/^depende de você: /, '')), pt.depende, 'o painel bate com pontos.json msg 1');
    assert.equal(JSON.parse(sh('loop.mjs', ['proxima', '--sessao', 'S-t55']).stdout).acao.tipo, 'despachar', 'o loop devolve trabalho na ativa');
    assert.equal(lerTudo(ENTREGA_PUBLICADA).length, antesPub, 'a publicada vigiada fica com 0 eventos novos (nem o fato.medido do painel vai para ela)');
    assert.equal(await publicadaPeloProduto(lerTudo(ENTREGA_PUBLICADA), FUT, ENTREGA_PUBLICADA), true);
    assert.equal(await publicadaPeloProduto(lerTudo(ENTREGA_ATIVA), FUT, ENTREGA_ATIVA), false);
    // (i) a causa: a ativa com PR mergeado no diário (a semente antiga) ⇒ sessão sem entrega
    const r = append(join(destino, '.harness', 'entregas', ENTREGA_ATIVA), 'semente-antiga', { ts: '2026-11-10T12:00:00.000Z', autor: 'a1@example.invalid', sessao: 'semente-antiga', agente: 'painel', tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero: 14, estado: 'mergeado', branch: 'enabler/GM-13-a1' } } });
    assert.equal(r.ok, true);
    assert.equal(ponte({ op: 'dir', cwd: destino }).identificada, false, 'semente antiga: GM-13 publicada ⇒ conversa sem entrega (FIEL-1 b), a fala não grava');
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
    assert.equal(LINHA_DECISAO.test('09:50 ● ELROND decidiu: escopo da T2 (anotado pelo orquestrador)'), true, 'GM-15 T29: o histórico do E4 começa na coluna 0');
    for (const l of ['ATENÇÃO · 2 consultas à Sombra sem decisão registrada, ninguém decidiu: ainda', 'o dono decidiu: seguir', 'RECENTE · 10:00 ✓ ELROND decidiu: x', 'RECENTE · 10:00 ● decidiu: x', 'texto 10:00 ● ELROND decidiu: x', 'RECENTE · 10:00 ● ELROND decidiu x'])
      assert.equal(LINHA_DECISAO.test(l), false, l);
  });

  test('8f-mede-a-decisao-que-o-produto-desenha-e-nao-a-palavra-Sombra (render real)', async () => {
    const real = await renderizar(ESTADO_REAL, { Pane: { bodyRows: 50, bodyColumns: 180 } }, { local: 'lateral' });
    // GM-15 T29 (D-G1c): o RECENTE é o histórico `hh:mm` do E4 e a ATENÇÃO é `◆ ATENÇÃO  …`
    assert.ok(real.some((l) => /^\d\d:\d\d ● \S+ decidiu: /.test(l)), 'o produto desenha "<sabio> decidiu: …" no RECENTE');
    assert.ok(real.some((l) => /^◆ ATENÇÃO {2}\d+ consultas? à Sombra sem decisão registrada/.test(l)), 'e a ATENÇÃO com a palavra Sombra, que não é decisão');
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

  test('conversa-sem-sessao-curta-nao-mede-o-placement (o observador não vê a Pane de outro plugin)', async () => {
    const r = resultado(await coleta({ placement: 'dock' }), '12-placement-da-pane');
    assert.equal(r.ok, false); assert.match(r.detalhe, /sem sessão curta.*não medida/);
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
      + exp.slice(exp.indexOf('set esc 1'), exp.indexOf('proc marco')) + exp.slice(exp.indexOf('proc marco'), exp.indexOf('proc sends'))
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
    try { m = await matriz('/inexistente-nao-copiar', raiz, { falas: [] }, idDaCelula(MATRIZ[0])); } finally { process.stderr.write = errOrig; restaurarEnv('TMPDIR', tmpAntes); restaurarEnv('CLAUDE_CONFIG_DIR', antes); }
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
    } finally { restaurarEnv('CLAUDE_CONFIG_DIR', antes); }
    assert.equal((readFileSync(RUNNER, 'utf8').match(/CLAUDE_CONFIG_DIR \?\?/g) ?? []).length, 1, 'a regra aparece uma vez no runner');
  });
  test('o-claude-carrega-o-superpowers-como-plugin-explicito-e-nunca-liga-setting-sources-user (argv montado pelo runner)', () => {
    const argv = R.argvDoClaude({ observador: '/t/o', plugin: '/t/p', superpowers: '/t/sp', debugLog: '/t/d', settings: '/t/s.json' });
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
    assert.deepEqual(r.ambiente, { importsExternos: 'apareceu-e-foi-recusado', permissao: { apareceu: false, recusadas: 0, naoFechou: false }, superpowers: { nome: 'superpowers', versao: '7.0.2', caminho: '/t/sp' } });
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
    assert.deepEqual(R.placementsDoDebugLog(log), [{ colunas: 180, estado: 'placed', unasked: true }, { colunas: 80, estado: 'unplaced', unasked: true, limiar: 110 }]);
    assert.deepEqual(R.placementsDoDebugLog('2026-11-14T05:00:00.000Z [DEBUG] ui.open gabarito-mestre gabarito-painel (asked, 80 columns): placed'), [{ colunas: 80, estado: 'placed' }], 'abertura a pedido do dono não é "unasked"');
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
const rodarMatriz = (e, opcoes = {}) => comEnv('TMPDIR', e.base, () => calar(() => R.matriz(e.fonte, e.raiz, { falas: [] }, opcoes.so ?? null, { deps: e.deps, ...opcoes })));


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
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r)).join(';'), /worktrees/, 'worktree novo fora de .harness/worktrees continua vigiado');
    // worktrees do loop (`.harness/worktrees/<id>`) nascem e morrem com o orquestrador: não são a célula
    const antes2 = R.fotoDoRepo(r);
    git(r, 'worktree', 'add', '-q', '-b', 'wt/T1', join(r, '.harness', 'worktrees', 'T1'));
    assert.deepEqual(R.diferencasDeFotos(antes2, R.fotoDoRepo(r)), []);
  });
  test('estado-vivo-do-orquestrador-nao-invalida (eventos com a identidade dele, sombra); arquivo de código novo e outro arquivo do .harness invalidam', () => {
    const r = tmpGit(); const a = R.fotoDoRepo(r, { marca: 'a1-zzz' });
    mkdirSync(join(r, '.harness', 'entregas', 'GM-14', 'sombra'), { recursive: true });
    writeFileSync(join(r, '.harness', 'entregas', 'GM-14', 'sombra', 'h.md'), 'x');
    writeFileSync(join(r, '.harness', 'entregas', 'GM-14', 'events.orq.jsonl'), '{"autor":"dono@x","sessao":"s"}\n');
    assert.deepEqual(R.diferencasDeFotos(a, R.fotoDoRepo(r, { marca: 'a1-zzz' })), []);
    writeFileSync(join(r, 'src.js'), 'z');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r, { marca: 'a1-zzz' })).join(';'), /status.*src\.js/);
    rmSync(join(r, 'src.js'));
    writeFileSync(join(r, '.harness', 'novo'), 'n');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r, { marca: 'a1-zzz' })).join(';'), /status.*\.harness\/novo/, '.harness fora da lista do orquestrador conta');
  });
  test('BLOCKER r1: o rastro do loop da CÉLULA no repo real invalida (identidade da célula em eventos, commits, branch e worktree); o do orquestrador não', () => {
    const marca = 'a1-abc123'; const envCelula = R.ambienteGitDaCelula(marca);
    const gitC = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envCelula } });
    const foto = (r) => R.fotoDoRepo(r, { marca });
    // (1) evento da célula (identidade no conteúdo), em arquivo novo no diretório que o orquestrador também usa
    let r = tmpGit(); let a = foto(r);
    mkdirSync(join(r, '.harness', 'entregas', 'GM-14'), { recursive: true });
    writeFileSync(join(r, '.harness', 'entregas', 'GM-14', 'events.sessao-nova.jsonl'), `{"autor":"${R.emailDaCelula(marca)}","sessao":"nova"}\n`);
    assert.match(R.diferencasDeFotos(a, foto(r)).join(';'), /marcas/, 'evento da célula');
    // (2) a célula acrescenta a um arquivo de eventos que JÁ existia (mesma linha de status): a varredura vê o conteúdo
    r = tmpGit(); mkdirSync(join(r, '.harness', 'entregas', 'GM-14'), { recursive: true });
    const ev = join(r, '.harness', 'entregas', 'GM-14', 'events.dono.jsonl'); writeFileSync(ev, '{"autor":"dono@x"}\n'); a = foto(r);
    writeFileSync(ev, `{"autor":"dono@x"}\n{"autor":"${R.emailDaCelula(marca)}"}\n`);
    assert.match(R.diferencasDeFotos(a, foto(r)).join(';'), /marcas/, 'append em arquivo existente');
    // (3) worktree em .harness/worktrees + branch wt/* criados pela célula, só `worktree add` (sem commit)
    r = tmpGit(); a = foto(r);
    gitC(r, 'worktree', 'add', '-q', '-b', 'wt/GM-14-T1', join(r, '.harness', 'worktrees', 'T1'));
    assert.match(R.diferencasDeFotos(a, foto(r)).join(';'), /marcas/, 'worktree add da célula');
    // (4) commit da célula num wt/* que já existia (o ref wt/* é ignorado cru; o autor não)
    r = tmpGit(); git(r, 'branch', 'wt/x'); const wt = join(r, '.harness', 'worktrees', 'T2'); git(r, 'worktree', 'add', '-q', wt, 'wt/x'); a = foto(r);
    writeFileSync(join(wt, 'f.txt'), 'f'); gitC(wt, 'add', '-A'); gitC(wt, 'commit', '-q', '-m', 'da celula');
    assert.match(R.diferencasDeFotos(a, foto(r)).join(';'), /marcas/, 'commit da célula em wt/*');
    // (5) o MESMO rastro com a identidade do orquestrador (sem a da célula) é ignorado
    r = tmpGit(); a = foto(r);
    git(r, 'worktree', 'add', '-q', '-b', 'wt/GM-14-T3', join(r, '.harness', 'worktrees', 'T3'));
    git(join(r, '.harness', 'worktrees', 'T3'), 'commit', '-q', '--allow-empty', '-m', 'implementador do loop');
    mkdirSync(join(r, '.harness', 'entregas', 'GM-14'), { recursive: true });
    writeFileSync(join(r, '.harness', 'entregas', 'GM-14', 'events.outro.jsonl'), '{"autor":"dono@x"}\n');
    assert.deepEqual(R.diferencasDeFotos(a, foto(r)), []);
  });
  test('r2 MAJOR: branch wt/* criado pela célula sem commit e sem worktree: só o reflog --all o vê', () => {
    const marca = 'a1-r2reflog'; const envCelula = R.ambienteGitDaCelula(marca);
    const gitC = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envCelula } });
    const foto = (r) => R.fotoDoRepo(r, { marca });
    // (1) branch wt/* criado pela célula, sem commit e sem worktree
    const r = tmpGit(); const a = foto(r);
    gitC(r, 'branch', 'wt/GM-14-T77');
    const d = R.diferencasDeFotos(a, foto(r)).join(';');
    assert.match(d, /marcas.*reflog: wt\/GM-14-T77/, 'branch sem commit nem worktree');
  });
  test('r2 MAJOR: worktree add + worktree remove mantendo o branch deixa só o reflog do branch, e a varredura o vê', () => {
    const marca = 'a1-r2reflog'; const envCelula = R.ambienteGitDaCelula(marca);
    const gitC = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envCelula } });
    const foto = (r) => R.fotoDoRepo(r, { marca });
    let d;
    const r = tmpGit(); const a = foto(r);
    const wt = join(r, '.harness', 'worktrees', 'T78');
    gitC(r, 'worktree', 'add', '-q', '-b', 'wt/GM-14-T78', wt); gitC(r, 'worktree', 'remove', '--force', wt);
    d = R.diferencasDeFotos(a, foto(r)).join(';');
    assert.match(d, /marcas.*reflog: wt\/GM-14-T78/, 'worktree removido, branch mantido');
  });
  test('ambienteGitDaCelula: o user.email visto pelo git da célula é a identidade dela (commits e eventos `autor` a herdam) mesmo num repo com outra', () => {
    const r = tmpGit(); git(r, 'config', 'user.email', 'dono@real');
    const out = execFileSync('git', ['-C', r, 'config', 'user.email'], { encoding: 'utf8', env: { ...process.env, ...R.ambienteGitDaCelula('a1-k') } }).trim();
    assert.equal(out, R.emailDaCelula('a1-k'));
    assert.notEqual(R.emailDaCelula('a1-k'), R.emailDaCelula('a1-j'));
  });
  test('executarExpect-com-marca: a célula que mexe no repo real com o git herdado do ambiente aborta pela marca (o texto do comando não importa)', { timeout: 20000 }, async () => {
    const fonte = tmpGit(); const rundir = tmp();
    const f = join(tmp(), 'expect'); writeFileSync(f, `#!/bin/sh\ngit -C ${fonte} worktree add -q -b wt/GM-14-T9 ${fonte}/.harness/worktrees/T9\nsleep 5\n`); execFileSync('chmod', ['+x', f]);
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: f, intervalo: 200, fotoOpc: { marca: 'a1-e2e' }, marca: 'a1-e2e' });
    assert.match(r.abortada, /repo real alterado.*marcas/);
  });
  test('a lista de ignorados do orquestrador NAO e configuravel (r1 MINOR 4): ignorarRefs/ignorarStatus passados são ignorados e a flag --ignorar-ref não existe', () => {
    const r = tmpGit(); const a = R.fotoDoRepo(r, { ignorarRefs: [/./], ignorarStatus: [/./] });
    git(r, 'branch', 'enabler/z'); writeFileSync(join(r, 'src.js'), 'z');
    assert.match(R.diferencasDeFotos(a, R.fotoDoRepo(r, { ignorarRefs: [/./], ignorarStatus: [/./] })).join(';'), /refs.*status|status.*refs/);
    assert.doesNotMatch(readFileSync(RUNNER, 'utf8'), /--ignorar-ref|ignorarRefs/);
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
    const argv = R.argvDoClaude({ observador: '/t/obs', plugin: '/t/plugin', superpowers: '/t/sp', debugLog: '/t/debug.log', settings: '/t/settings.json' });
    assert.equal(R.MODELO_CONDUTOR, 'claude-sonnet-5-5');
    assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5');
    assert.doesNotMatch(argv.join(' '), /haiku/);
    assert.deepEqual(argv.filter((_, i) => argv[i - 1] === '--plugin-dir'), ['/t/obs', '/t/plugin', '/t/sp']);
    assert.ok(argv.includes('--strict-mcp-config') && argv.includes('--debug-file'));
    assert.deepEqual(R.vazamentos(argv, [R.raizDoRepoReal()]), []);
  });
  test('negacao-do-repo-real (a célula explora o disco e achou o repo real na 1ª tentativa): regras de Bash/Read/Edit para o caminho absoluto e para o relativo ao HOME; só famílias que a plataforma casa (r1 MINOR 3)', () => {
    const regras = R.regrasDeNegacao(['/home/u/projetos/real'], '/home/u');
    for (const ferr of ['Bash', 'Read', 'Edit']) assert.ok(regras.some((r) => r.startsWith(`${ferr}(`)), ferr);
    for (const morta of ['Write', 'Glob', 'Grep']) assert.ok(!regras.some((r) => r.startsWith(`${morta}(`)), `${morta}(...) nunca é casada pela plataforma`);
    assert.ok(regras.includes('Bash(*/home/u/projetos/real*)'));
    assert.ok(regras.includes('Bash(*projetos/real*)'), 'a forma ~/… também');
    assert.ok(regras.includes('Read(//home/u/projetos/real/**)'));
    assert.ok(!regras.some((r) => r.includes('*home/u/projetos/outro')));
    assert.deepEqual(R.regrasDeNegacao(['/fora/do/home'], '/home/u').filter((r) => r.startsWith('Bash(')), ['Bash(*/fora/do/home*)']);
  });
  test('cache-do-superpowers-protegido-contra-escrita (r1 MINOR 5): Edit negado no caminho dele, sem negar a leitura', () => {
    const regras = R.regrasDeNegacao(['/home/u/real'], '/home/u', ['/cache/sp/7.0.2']);
    assert.ok(regras.includes('Edit(//cache/sp/7.0.2/**)'));
    assert.ok(!regras.some((r) => r.startsWith('Read(') && r.includes('/cache/sp')));
  });
  test('settings-da-celula-nega-escrita-no-superpowers', async () => {
    const e = ambienteMatriz(); await rodarMatriz(e, { so: idDaCelula(MATRIZ[0]) });
    const c = e.chamadas[0]; const regras = JSON.parse(readFileSync(c.argv[c.argv.indexOf('--settings') + 1], 'utf8')).permissions.deny;
    assert.ok(regras.includes('Edit(//t/sp/**)'));
  });
  test('argv-leva-o-settings-com-as-regras-e-o-argv-nao-tem-caminho-real (as regras ficam no arquivo, não na linha de comando)', async () => {
    const e = ambienteMatriz();
    await rodarMatriz(e, { so: idDaCelula(MATRIZ[0]) });
    const c = e.chamadas[0];
    const sj = c.argv[c.argv.indexOf('--settings') + 1];
    assert.ok(R.dentroDe(c.rundir, sj));
    const regras = JSON.parse(readFileSync(sj, 'utf8')).permissions.deny;
    assert.ok(regras.some((r) => r.includes(e.fonte)) || regras.some((r) => r.includes(e.raiz)), 'o caminho real está nas regras');
    assert.deepEqual(R.vazamentos(c.argv, [e.fonte, e.raiz]), []);
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
  test('ref-nao-wt-movida-invalida-sem-opcao-de-ignorar; commit do orquestrador em wt/* não; worktree com a identidade da CÉLULA sim (BLOCKER r1)', async () => {
    const mexe = async (a, fonte) => { git(fonte, 'commit', '-q', '--allow-empty', '-m', 'integração do orquestrador'); return { status: 0, abortada: null }; };
    const sem = ambienteMatriz(mexe); const m2 = await rodarMatriz(sem, { so: idDaCelula(MATRIZ[0]), ignorarRefs: [/./] });
    assert.equal(m2.rel.passou, 0); assert.match(m2.abortada, /isolamento/);
    const orq = ambienteMatriz(async (a, fonte) => { git(fonte, 'branch', 'wt/outro'); return { status: 0, abortada: null }; });
    const m3 = await rodarMatriz(orq, { so: idDaCelula(MATRIZ[0]) });
    assert.equal(m3.rel.passou, 1); assert.equal(m3.abortada, null);
    const cel = ambienteMatriz(async (a, fonte) => {
      assert.match(a.marca, /^a1-/);
      execFileSync('git', ['-C', fonte, '-c', 'commit.gpgsign=false', 'worktree', 'add', '-q', '-b', 'wt/GM-14-T1', join(fonte, '.harness', 'worktrees', 'T1')], { env: { ...process.env, ...R.ambienteGitDaCelula(a.marca) }, stdio: 'ignore' });
      return { status: 0, abortada: null };
    });
    const m4 = await rodarMatriz(cel, { so: idDaCelula(MATRIZ[0]) });
    assert.equal(m4.rel.passou, 0); assert.match(m4.abortada, /isolamento/);
    const r = JSON.parse(readFileSync(join(m4.base, idDaCelula(MATRIZ[0]), 'resultado.json'), 'utf8'));
    assert.match(r.resultados[0].detalhe, /marcas/);
  });
  test('--so aceita lista separada por vírgula (duas células para medir o paralelo)', async () => {
    const e = ambienteMatriz(); const ids = [idDaCelula(MATRIZ[4]), idDaCelula(MATRIZ[5])];
    const m = await rodarMatriz(e, { so: ids.join(','), paralelo: 2 });
    assert.deepEqual(e.chamadas.map((c) => c.celula).sort(), ids.sort());
    assert.equal(m.rel.passou, 2);
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
    await assert.rejects(() => calar(() => comEnv('TMPDIR', e.base, () => R.matriz(e.fonte, e.raiz, { falas: [{ n: 1, texto: `abra ${e.fonte}/x`, rotulo: '—' }] }, null, { deps: e.deps }))), /caminho do repo real/);
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
  test('repo-real-mexido-no-meio-mata-o-expect-e-devolve-a-causa (M: aborto removido ⇒ espera os 30 s)', { timeout: 20000 }, async () => {
    const fonte = tmpGit(); const rundir = tmp();
    const t0 = Date.now();
    setTimeout(() => writeFileSync(join(fonte, 'vazou.txt'), 'x'), 300);
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: fakeExpect(30), intervalo: 100 });
    assert.ok(Date.now() - t0 < 10000, `parou em ${Date.now() - t0} ms`);
    assert.match(r.abortada, /repo real/);
    assert.match(readFileSync(join(rundir, 'abortar.txt'), 'utf8'), /repo real/);
  });
  test('sem-mexida-espera-o-expect-acabar-sem-abortar', { timeout: 20000 }, async () => {
    const fonte = tmpGit(); const rundir = tmp();
    const r = await R.executarExpect({ rundir, args: [], reais: [fonte], expect: fakeExpect(1), intervalo: 100 });
    assert.equal(r.abortada, null); assert.equal(r.status, 0);
  });
  test('abortar.txt-escrito-pelo-a1.exp-ou-pelo-snapshot-mata-o-expect-na-hora', { timeout: 20000 }, async () => {
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
  test('1º-snapshot-sem-render-da-superficie-esperada-aborta (acima exige AbovePrompt; lateral exige algum render: a Pane de outro plugin o observador não vê)', () => {
    const pane = { ev: 'render', comp: 'Pane', bodyRows: 3 }; const acima = { ev: 'render', comp: 'AbovePrompt', maxRows: 3 };
    assert.match(R.invariantePrimeiroSnapshot([], { local: 'lateral' }), /0 render/);
    assert.match(R.invariantePrimeiroSnapshot([], { local: 'acima' }), /0 render/);
    assert.equal(R.invariantePrimeiroSnapshot([acima], { local: 'lateral' }), null, 'lateral: o AbovePrompt da plataforma basta (a Pane vem da tela)');
    assert.equal(R.invariantePrimeiroSnapshot([acima], { local: 'acima' }), null);
    assert.match(R.invariantePrimeiroSnapshot([pane], { local: 'acima' }), /AbovePrompt/);
  });
  test('cli-superficie-roda-ANTES-da-1ª-fala: sem render rc 1 e abortar.txt; com render rc 0', () => {
    const mk = (linhas) => { const d = tmp(); mkdirSync(join(d, 'obs'), { recursive: true }); writeFileSync(join(d, 'celula.json'), JSON.stringify({ local: 'lateral', cols: 180, rows: 50, cheia: true })); writeFileSync(join(d, 'obs', 'a1.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n')); return d; };
    const ruim = mk([]);
    assert.equal(spawnSync(process.execPath, [RUNNER, 'superficie', ruim], { encoding: 'utf8', timeout: 20_000 }).status, 1);
    assert.match(readFileSync(join(ruim, 'abortar.txt'), 'utf8'), /0 render/);
    const boa = mk([{ ev: 'render', comp: 'AbovePrompt', maxRows: 3 }]);
    assert.equal(spawnSync(process.execPath, [RUNNER, 'superficie', boa], { encoding: 'utf8', timeout: 20_000 }).status, 0);
    assert.equal(existsSync(join(boa, 'abortar.txt')), false);
  });
  test('a1.exp-chama-superficie-antes-de-digitar', () => {
    const exp = readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8');
    assert.ok(exp.indexOf('$runner superficie') > 0 && exp.indexOf('$runner superficie') < exp.indexOf('digitar $sha $texto'));
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
  test('12: sem sessão curta, sem quadro legível na tela ou sem debug.log é não medida (evidência vazia reprova)', () => {
    naoMedida('12-placement-da-pane', (ev) => { ev.sessaoCurta = null; });
    naoMedida('12-placement-da-pane', (ev) => { ev.sessaoCurta.quadros = 0; });
    naoMedida('12-placement-da-pane', (ev) => { ev.sessaoCurta.antes = null; });
    naoMedida('12-placement-da-pane', (ev) => { ev.sessaoCurta.depois = null; });
    naoMedida('12-placement-da-pane', (ev) => { ev.debugLogAtivo = false; });
    naoMedida('12-placement-da-pane', (ev) => { ev.celula = { local: 'acima', cols: 180, rows: 50, cheia: true }; ev.sessaoCurta = curtaBoa(ev.celula); ev.debugLogAtivo = false; });
  });
  test('12: debug.log que diz "placed" sem a tela ter caixa reprova (o debug.log só confirma; nunca é a fonte de dock/inline)', () => {
    const ev = evBoa(); ev.sessaoCurta.depois = { ...ev.sessaoCurta.depois, placement: null };
    const r = a('12-placement-da-pane').avaliar(ev); assert.equal(r.ok, false); assert.match(r.detalhe, /tela/);
  });
  test('12: lateral abaixo do limiar sem "placed" no debug.log depois do pedido reprova; com "unplaced" sem pedido também', () => {
    const base = { local: 'lateral', cols: 80, rows: 24, cheia: false };
    const ev = evBoa(base); ev.sessaoCurta.debug = ev.sessaoCurta.debug.filter((d) => d.estado !== 'placed');
    assert.equal(a('12-placement-da-pane').avaliar(ev).ok, false);
    const ev2 = evBoa(); ev2.sessaoCurta.debug = [{ colunas: 180, estado: 'unplaced', unasked: true }, { colunas: 180, estado: 'placed' }];
    assert.equal(a('12-placement-da-pane').avaliar(ev2).ok, false, '≥ limiar: a plataforma disse unplaced, não é o desenhado');
  });
  test('12: acima com ui.open no debug.log reprova (nunca os dois)', () => {
    const ev = evBoa({ local: 'acima', cols: 180, rows: 50, cheia: true }); ev.sessaoCurta.debug = [{ colunas: 180, estado: 'placed' }];
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
    Object.assign(vazio, { quadros: [], integradas: [], eventos: [], digitadas: [], transcript: { chamadas: [], textos: [] }, perguntas: [], despachos: [], entregasPublicadas: [], vivos: [], sessaoCurta: null, debugLogAtivo: false, placementsDebug: [], pouso: { percent: 0, limparNoDepende: false, pushes: 0, despachosDepois: 0 } });
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
  test('abortar.txt-escrito-e-expect-que-ja-saiu-tambem-aborta', { timeout: 20000 }, async () => {
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
    assert.deepEqual(ev.placementsDebug, [{ colunas: 180, estado: 'placed', unasked: true }]);
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

// ─── T52: A1 por conversa, replay e sessão curta (emendas 44, 45, 49, 50) ───

const ESC = '\x1b';
const marcoOsc = (n) => `${ESC}]1337;gabarito-marco=${n}\x07`;
/** Um quadro de tela: limpa, posiciona cada linha e fecha a janela síncrona (o que o TUI real faz a cada atualização). */
const quadroRaw = (linhas) => `${ESC}[2J${linhas.map((l, i) => `${ESC}[${i + 1};1H${l}`).join('')}${ESC}[?2026l`;
const bordaDireita = (l, cols) => `${l}${' '.repeat(Math.max(0, cols - [...l].length))}`;
const AVISO_80 = 'painel lateral precisa de 144 colunas: /gabarito painel para abrir';
// o que o produto desenha (faixaUmaLinha: pergunta sem prefixo) com os botões da plataforma ao lado (tty real)
const PERGUNTA_B = 'Esta conversa é da entrega  [ 1 GM-13 ] [ 2 uma nova ] [ 3 conversa avulsa ]';
const PAROU_REAL = '■ PAROU 01:44 3 paradas sem progresso';

/** Tela 80×24 sem Pane (abaixo do limiar): conversa em cima, a linha única do AbovePrompt, a régua e o prompt embaixo. */
const telaSemPane = (linhaUnica, rows = 24, cols = 80) => {
  const L = Array.from({ length: rows }, () => '');
  L[2] = '❯ pedido sintético do teste'; L[4] = '⏺ resposta sintética do teste';
  if (linhaUnica !== null) L[rows - 4] = linhaUnica;
  L[rows - 3] = '─'.repeat(cols); L[rows - 2] = '❯'; L[rows - 1] = '─'.repeat(cols);
  return L;
};
/** Tela com a Pane `inline`: caixa de cantos arredondados acima da régua. */
const telaInline = (interior, rows = 24, cols = 80) => {
  const L = telaSemPane(null, rows, cols);
  const topo = rows - 4 - interior.length - 1;
  L[topo] = `╭${'─'.repeat(cols - 4)}✕─╮`;
  interior.forEach((t, i) => { L[topo + 1 + i] = `│ ${t.padEnd(cols - 4)} │`; });
  L[topo + 1 + interior.length] = `╰${'─'.repeat(cols - 2)}╯`;
  return L;
};
/** Tela com a Pane `dock`: coluna de `│` contínua ao lado da conversa, "GABARITO ·" colado nela e o ✕ no alto. */
const telaDock = (rows = 50, cols = 180, sep = 99) => {
  const lado = ['', 'GABARITO · entrega não identificada', 'PAROU 01:44 · 3 paradas sem progresso', 'FASE 1 de 7', 'AGORA · LEIA · contexto 12 %'];
  const L = Array.from({ length: rows }, (_, r) => `${bordaDireita(r === 3 ? '⏺ conversa' : '', sep)}│${r === 0 ? `${' '.repeat(cols - sep - 3)}✕` : (lado[r] ?? '')}`);
  L[rows - 4] = '─'.repeat(cols); L[rows - 3] = '❯'; L[rows - 2] = '─'.repeat(cols); L[rows - 1] = '  ⏵⏵ auto mode on';
  return L.slice(0, rows);
};

describe('T52 (emenda 49 a) a TELA: emulador VT sobre o tty.raw', () => {
  test('quadro-por-janela-sincrona e marco-OSC-ancora-o-estagio', () => {
    const raw = quadroRaw(['primeiro']) + marcoOsc('b-respondida') + quadroRaw(['segundo']) + marcoOsc('pedido');
    const q = R.emularTela(raw, 4, 20);
    assert.deepEqual(q.map((x) => x.marco), [null, 'b-respondida', 'b-respondida', 'pedido']);
    assert.equal(q.find((x) => x.linhas[0] === 'primeiro').marco, null);
    assert.equal(q.filter((x) => x.marco === 'b-respondida').at(-1).linhas[0], 'segundo', 'o último quadro do estágio é o que o dono via ao fim dele');
    assert.equal(q.at(-1).linhas[0], 'segundo');
  });
  test('cursor-apagar-e-rolagem: o que o emulador desenha é o que a tela mostra', () => {
    const q = R.emularTela(`${ESC}[2J${ESC}[2;5Hola${ESC}[1;1Hx${ESC}[2;5H${ESC}[K${ESC}[3;1Hfim${ESC}[?2026l`, 4, 20).at(-1);
    assert.deepEqual(q.linhas, ['x', '', 'fim', '']);
    const rolou = R.emularTela(`${ESC}[1;1Ha${ESC}[2;1Hb${ESC}[3;1Hc${ESC}[1S${ESC}[?2026l`, 3, 5).at(-1);
    assert.deepEqual(rolou.linhas, ['b', 'c', '']);
  });
  test('caixa-do-painel: inline, dock e sem caixa (acima: a faixa começa na coluna 0) — placement e bodyRows lidos da tela', () => {
    const inline = R.caixaDoPainel(telaInline(['GABARITO · entrega', 'AGORA · LEIA'], 24, 80), 80);
    assert.deepEqual([inline.placement, inline.bodyRows, inline.bodyColumns, inline.interior], ['inline', 2, 76, ['GABARITO · entrega', 'AGORA · LEIA']]);
    const dock = R.caixaDoPainel(telaDock(50, 180, 99), 180);
    assert.deepEqual([dock.placement, dock.bodyColumns], ['dock', 80]);
    assert.ok(dock.bodyRows >= 40, `a dock mede a altura da coluna de │ (${dock.bodyRows})`);
    const faixa = R.caixaDoPainel(['GABARITO · entrega', 'FASE 1 de 7', ...telaSemPane(null).slice(2)], 80);
    assert.equal(faixa.placement, null, 'a faixa do AbovePrompt (acima) não é Pane');
    assert.equal(R.caixaDoPainel(telaSemPane(AVISO_80), 80).placement, null);
    const outraCaixa = telaInline(['qualquer outra caixa'], 24, 80);
    assert.equal(R.caixaDoPainel(outraCaixa, 80).placement, null, 'caixa sem o "GABARITO ·" não é a Pane do painel');
  });
  test('placement-lido-de-tela-gravada-real (a matriz 1794625214308): dock, inline e sem caixa', (t) => {
    const dir = join(R.raizDoRepoReal(), '.claude-tmp', 'a1', '1794625214308');
    if (!existsSync(dir)) { t.skip('execuções gravadas ausentes'); return; }
    const ultimo = (id, rows, cols) => R.emularTela(readFileSync(join(dir, id, 'tty.raw'), 'utf8'), rows, cols).at(-1);
    assert.equal(R.caixaDoPainel(ultimo('lateral-180x50-cheia', 50, 180).linhas, 180).placement, 'dock');
    assert.equal(R.caixaDoPainel(ultimo('lateral-180x50-normal', 50, 180).linhas, 180).placement, 'inline');
    assert.equal(R.caixaDoPainel(ultimo('lateral-80x24-normal', 24, 80).linhas, 80).placement, null, '80 colunas: a plataforma não colocou a Pane');
    assert.equal(R.caixaDoPainel(ultimo('acima-80x24-cheia', 24, 80).linhas, 80).placement, null, 'acima: 0 Pane');
  });
  test('aviso-na-tela: inteiro com o N do reason, cortado ("painel …") e ausente', () => {
    assert.deepEqual(R.avisoNaTela(['x', `${AVISO_80} [-]`]), { estado: 'inteiro', n: 144 });
    assert.deepEqual(R.avisoNaTela(['painel lateral precisa de mais colunas: /gabarito painel para abrir']), { estado: 'inteiro', n: null });
    assert.equal(R.avisoNaTela(['painel …']).estado, 'cortado');
    assert.equal(R.avisoNaTela(['painel lateral precisa de 144 colunas: /gabarito …']).estado, 'cortado', 'a frase que não fecha é cortada');
    assert.equal(R.avisoNaTela(['nada disso']).estado, null);
  });
  test('comando-de-resposta-da-pergunta-b (o runner responde como o dono): id e opção da própria pergunta, nunca inventados', () => {
    assert.equal(R.comandoDeResposta({ id: 'sess:3', opcoes: ['GM-13', 'uma nova', 'conversa avulsa'] }), '/gabarito-mestre:responder sess:3 3');
    assert.equal(R.comandoDeResposta(null), null);
    assert.equal(R.comandoDeResposta({ id: 'sess:3', opcoes: ['a', 'b'] }), null, 'resposta fixa fora das opções não é digitada');
    assert.equal(R.comandoDeResposta({ id: '', opcoes: ['a', 'b', 'c'] }), null);
  });
});

/** Uma sessão curta GRAVADA: tty.raw com marcos, debug.log, curta.json e resposta-b.json. `v` estraga um campo. */
function montarCurta(v = {}) {
  const celula = v.celula ?? { local: 'lateral', cols: 80, rows: 24, cheia: false };
  const rundir = tmp(); mkdirSync(join(rundir, 'obs'), { recursive: true });
  const pedido = v.pedido ?? R.precisaPedido(celula);
  writeFileSync(join(rundir, 'celula.json'), JSON.stringify(celula));
  writeFileSync(join(rundir, 'curta.json'), JSON.stringify({ pedido, respostaB: 3 }));
  if (v.semRespostaB !== true) writeFileSync(join(rundir, 'resposta-b.json'), JSON.stringify(v.respostaB ?? { estado: 'respondida', pergunta: 'sess:3', resposta: 3 }));
  const { rows, cols } = celula;
  // estágio 1: pergunta (b) aberta; a linha única mostra a pergunta e o aviso SAI CORTADO (emenda 50)
  let raw = marcoOsc('inicio') + quadroRaw(telaSemPane(v.antesDaB ?? `${PERGUNTA_B} painel …`, rows, cols));
  // estágio 2: (b) respondida; o aviso tem de estar INTEIRO na linha única, antes do pedido
  raw += marcoOsc('b-respondida');
  raw += quadroRaw(v.telaDepoisDaB ?? telaSemPane(v.depoisDaB === undefined ? `${AVISO_80} [-]` : v.depoisDaB, rows, cols));
  if (pedido && v.semPedido !== true) {
    raw += marcoOsc('pedido') + quadroRaw(telaSemPane(null, rows, cols));
    raw += marcoOsc('depois-do-pedido') + quadroRaw(v.telaDepoisDoPedido ?? telaInline(['GABARITO · entrega', 'AGORA · LEIA'], rows, cols));
  }
  writeFileSync(join(rundir, 'tty.raw'), raw);
  const debug = ['2026-11-14T04:40:00.000Z [DEBUG] Checking plugin gabarito-mestre: enabled'];
  if (v.semUnasked !== true && pedido) debug.push(`2026-11-14T04:40:10.000Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, ${cols} columns): waits unplaced (unasked below ${v.limiar ?? 144} columns (${cols} now): placed when the person opens it, or when the terminal is widened to ${v.limiar ?? 144} columns)`);
  if (v.semPlaced !== true && celula.local === 'lateral') debug.push(`2026-11-14T04:41:00.000Z [DEBUG] ui.open gabarito-mestre gabarito-painel (${pedido ? 'asked' : 'unasked'}, ${cols} columns): placed`);
  writeFileSync(join(rundir, 'debug.log'), `${debug.join('\n')}\n`);
  writeFileSync(join(rundir, 'obs', 'a1.jsonl'), `${JSON.stringify({ t: 1, ev: 'render', comp: 'AbovePrompt', maxRows: 7, rows, bodyColumns: cols - 5, hasSurvey: false })}\n`);
  return { rundir, celula };
}
const r12 = (m) => R.avaliarCurta(m.rundir, m.celula).resultados.find((x) => x.id === '12-placement-da-pane');

describe('T52 (emendas 49 b e 50) asserção 12 lida da TELA da sessão curta: aviso inteiro DEPOIS da (b) respondida, pedido do dono, Pane colocada', () => {
  test('sessao-boa-80x24: (b) respondida, aviso inteiro antes do pedido, pedido, Pane inline na tela', () => {
    const m = montarCurta();
    const r = r12(m);
    assert.equal(r.ok, true, r.detalhe);
    const sc = R.lerSessaoCurta(m.rundir, m.celula);
    assert.deepEqual([sc.fonte, sc.antes.aviso, sc.antes.placement, sc.depois.placement, sc.pedidoFeito], ['tela', { estado: 'inteiro', n: 144 }, null, 'inline', true]);
    assert.deepEqual(sc.marcos, ['inicio', 'b-respondida', 'pedido', 'depois-do-pedido']);
    assert.equal(sc.respostaB.estado, 'respondida', 'a resposta do runner fica gravada na evidência');
  });
  test('aviso-CORTADO-depois-da-(b)-reprova (mutação: aceita aviso cortado)', () => {
    const r = r12(montarCurta({ depoisDaB: 'painel … [-]' }));
    assert.equal(r.ok, false); assert.match(r.detalhe, /cortado/);
  });
  test('aviso-inteiro-so-ANTES-da-(b)-respondida-nao-vale (a medida é depois da resposta)', () => {
    const r = r12(montarCurta({ antesDaB: `${AVISO_80}`, depoisDaB: 'painel … [-]' }));
    assert.equal(r.ok, false); assert.match(r.detalhe, /cortado/);
  });
  test('aviso-AUSENTE-antes-do-pedido-reprova (mutação: aviso não exigido)', () => {
    const r = r12(montarCurta({ depoisDaB: '' }));
    assert.equal(r.ok, false); assert.match(r.detalhe, /aviso ausente/);
  });
  test('pergunta-(b)-ainda-aberta-ou-PAROU-que-nao-sai-e-evidencia-vazia-e-reprova', () => {
    const aberta = r12(montarCurta({ depoisDaB: `${PERGUNTA_B} ${AVISO_80}` }));
    assert.equal(aberta.ok, false); assert.match(aberta.detalhe, /pergunta \(b\) continua aberta.*evidência vazia/);
    const parou = r12(montarCurta({ depoisDaB: `${PAROU_REAL} · ${AVISO_80}` }));
    assert.equal(parou.ok, false); assert.match(parou.detalhe, /PAROU aberto que não saiu.*evidência vazia/);
  });
  test('pedido-do-dono-ausente-reprova (mutação: pedido do dono ausente); sem a Pane na tela depois do pedido também', () => {
    const sem = r12(montarCurta({ semPedido: true }));
    assert.equal(sem.ok, false); assert.match(sem.detalhe, /pedido do dono/);
    const vazia = r12(montarCurta({ telaDepoisDoPedido: telaSemPane(null) }));
    assert.equal(vazia.ok, false); assert.match(vazia.detalhe, /depois do pedido.*lido na tela null/);
  });
  test('Pane-ja-colocada-antes-do-pedido-reprova (a tabela medida diz não colocada abaixo do limiar)', () => {
    const r = r12(montarCurta({ telaDepoisDaB: telaInline([`GABARITO · entrega`, AVISO_80]) }));
    assert.equal(r.ok, false); assert.match(r.detalhe, /já colocada antes do pedido/);
  });
  test('N-do-aviso-vem-do-reason-da-plataforma: aviso com número diferente do limiar do debug.log reprova (nunca número fixo)', () => {
    const r = r12(montarCurta({ limiar: 150 }));
    assert.equal(r.ok, false); assert.match(r.detalhe, /144 colunas mas o reason da plataforma diz 150/);
    assert.equal(r12(montarCurta({ limiar: 144 })).ok, true);
  });
  test('resposta-da-(b)-ausente-da-evidencia-ou-debug.log-sem-unasked-reprova', () => {
    const sem = r12(montarCurta({ semRespostaB: true }));
    assert.equal(sem.ok, false); assert.match(sem.detalhe, /resposta do runner à pergunta \(b\) não está gravada/);
    const naoAbriu = r12(montarCurta({ respostaB: { estado: 'nao-abriu', pergunta: null, resposta: null } }));
    assert.equal(naoAbriu.ok, true, 'a (b) que não abriu fica registrada e não bloqueia');
    const semUn = r12(montarCurta({ semUnasked: true }));
    assert.equal(semUn.ok, false); assert.match(semUn.detalhe, /unasked/);
  });
  test('180x50-sem-pedido: dock (cheia) e inline (normal) lidos da tela; sem Pane na tela reprova mesmo com "placed" no debug.log', () => {
    const cheia = { local: 'lateral', cols: 180, rows: 50, cheia: true };
    assert.equal(r12(montarCurta({ celula: cheia, telaDepoisDaB: telaDock(), pedido: false })).ok, true);
    assert.equal(r12(montarCurta({ celula: cheia, telaDepoisDaB: telaInline(['GABARITO · e'], 50, 180), pedido: false })).ok, false, 'inline onde a tabela manda dock');
    const semCaixa = r12(montarCurta({ celula: cheia, telaDepoisDaB: telaSemPane(null, 50, 180), pedido: false }));
    assert.equal(semCaixa.ok, false, 'placement lido só do debug.log (sem dock/inline na tela) reprova (mutação: debug.log como fonte)');
    const normal = { local: 'lateral', cols: 180, rows: 50, cheia: false };
    assert.equal(r12(montarCurta({ celula: normal, telaDepoisDaB: telaInline(['GABARITO · e'], 50, 180), pedido: false })).ok, true);
  });
  test('acima: 0 Pane na tela e nenhum ui.open; a geometria da curta vem do AbovePrompt', () => {
    const acima = { local: 'acima', cols: 80, rows: 24, cheia: false };
    const m = montarCurta({ celula: acima, pedido: false, depoisDaB: '' });
    assert.equal(r12(m).ok, true);
    assert.deepEqual(R.avaliarCurta(m.rundir, acima).geometria, { AbovePrompt: { maxRows: 7, rows: 24, bodyColumns: 75 } });
    assert.equal(r12(montarCurta({ celula: acima, pedido: false, depoisDaB: '', telaDepoisDaB: telaInline(['GABARITO · e']) })).ok, false, 'Pane na tela em acima (nunca os dois)');
  });
  test('geometria-da-curta-lateral: bodyRows e bodyColumns lidos da caixa na tela depois do pedido', () => {
    const m = montarCurta();
    assert.deepEqual(R.avaliarCurta(m.rundir, m.celula).geometria, { Pane: { bodyRows: 2, bodyColumns: 76 } });
    assert.equal(R.geometriaDaCurta(null, m.celula), null);
    const sem = montarCurta({ telaDepoisDoPedido: telaSemPane(null) });
    assert.equal(R.avaliarCurta(sem.rundir, sem.celula).geometria, null, 'sem caixa na tela, sem geometria (o replay não inventa)');
  });
});

describe('T52 (emenda 49 b) o a1.exp da sessão curta: marcos no tty.raw, (b) respondida, pedido só abaixo do limiar', () => {
  /** Roda o a1.exp REAL em modo curta com um `claude` e um `node` de mentira (fora do repo; tempos escalados por A1_ESCALA_TEMPO). */
  function rodarCurta({ pedido, comando, parou = '' }) {
    const rundir = tmp(); const repo = join(rundir, 'repo'); const bin = join(rundir, 'bin'); mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
    writeFileSync(join(rundir, 'celula.json'), JSON.stringify({ local: 'lateral', cols: 80, rows: 24, cheia: false }));
    writeFileSync(join(rundir, 'curta.json'), JSON.stringify({ pedido, respostaB: 3 }));
    writeFileSync(join(rundir, 'claude.args'), '--model\nx\n');
    writeFileSync(join(rundir, 'debug.log'), 'Checking plugin gabarito-mestre: enabled\n');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nmkdir -p "$OBS_DIR"\necho \'{"t":1,"ev":"render","comp":"AbovePrompt","maxRows":3,"rows":24,"bodyColumns":75}\' > "$OBS_DIR/a1.jsonl"\nwhile IFS= read -r l; do printf "%s\\n" "$l" >> "$RUNDIR_FAKE/recebido.txt"; case "$l" in /exit*) exit 0;; esac; done\n');
    const node = join(rundir, 'node-falso'); writeFileSync(node, '#!/bin/sh\ncase "$2" in resposta-b) [ -n "$FAKE_CMD" ] && echo "$FAKE_CMD"; exit 0;; parou) [ -n "$FAKE_PAROU" ] && exit 1; exit 0;; *) exit 0;; esac\n');
    for (const f of [join(bin, 'claude'), node]) chmodSync(f, 0o755);
    const r = spawnSync('expect', ['-f', join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), rundir, repo, bin, node, 'runner', 'curta'], { encoding: 'utf8', timeout: 90_000, env: { ...process.env, A1_ESCALA_TEMPO: '0.1', RUNDIR_FAKE: rundir, FAKE_CMD: comando, FAKE_PAROU: parou } });
    const recebido = existsSync(join(rundir, 'recebido.txt')) ? readFileSync(join(rundir, 'recebido.txt'), 'utf8').split('\n').filter(Boolean) : [];
    return { r, rundir, recebido, expLog: existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8') : '', marcos: R.emularTela(readFileSync(join(rundir, 'tty.raw'), 'utf8'), 24, 80).map((q) => q.marco).filter((m, i, a) => m !== null && m !== a[i - 1]) };
  }
  test('abaixo-do-limiar: responde a (b) com o comando do runner, marca os estágios em ordem e digita /gabarito painel', { timeout: 100_000 }, (t) => {
    if (!temExpect(t)) return;
    const c = rodarCurta({ pedido: true, comando: '/gabarito-mestre:responder sess:3 3' });
    assert.equal(c.r.status, 0, `${c.r.stdout}${c.r.stderr}`);
    assert.deepEqual(c.marcos, ['inicio', 'b-respondida', 'pedido', 'depois-do-pedido']);
    const iResp = c.recebido.findIndex((l) => l.includes('/gabarito-mestre:responder sess:3 3'));
    const iPed = c.recebido.findIndex((l) => l.trim() === '/gabarito painel');
    assert.ok(iResp >= 0, `a resposta da (b) foi digitada: ${JSON.stringify(c.recebido)}`);
    assert.ok(iPed > iResp, 'o pedido do dono vem DEPOIS de a (b) ser respondida');
  });
  test('MAJOR-3 a1.exp espera o PAROU sair: PAROU que não sai para a célula ANTES do pedido (evidência vazia)', { timeout: 150_000 }, (t) => {
    if (!temExpect(t)) return;
    const c = (() => { try { return rodarCurta({ pedido: true, comando: '', parou: '1' }); } catch (e) { return { erro: e }; } })();
    assert.equal(c.erro, undefined, String(c.erro));
    assert.match(c.expLog, /PAROU-NAO-SAIU/);
    assert.equal(c.marcos.includes('pedido'), false);
    assert.equal(c.marcos.includes('b-respondida'), false);
    assert.equal(R.causaDoStatus('PAROU_NAO_SAIU').includes('evidência vazia'), true);
  });
  test('sem-pedido-e-sem-pergunta: nada é digitado além do /exit; os marcos de pedido não existem', { timeout: 100_000 }, (t) => {
    if (!temExpect(t)) return;
    const c = rodarCurta({ pedido: false, comando: '' });
    assert.equal(c.r.status, 0, `${c.r.stdout}${c.r.stderr}`);
    assert.deepEqual(c.marcos, ['inicio', 'b-respondida']);
    assert.deepEqual(c.recebido.filter((l) => !l.startsWith('/exit')), [], 'nem resposta nem /gabarito painel');
  });
});

describe('T52 (emenda 45) replay: os 4 controles medidos, relógio injetável, só o desenho', () => {
  const UUID1 = '3ae9ccd6-f878-4f59-ac78-6406f260d71f'; const UUID2 = 'a8ce0882-155a-491c-8676-a96438f52d1d';
  /** Repo de conversa mínimo: diário de 2 sessões (uuid) e um diário de loop; eventos em instantes conhecidos. */
  function repoDeConversa({ sessoes = [[UUID1, '2026-11-14T05:00:00.000Z']] } = {}) {
    const rundir = tmp(); const repo = join(rundir, 'repo');
    const dir = join(repo, '.harness', 'entregas', 'GM-13'); mkdirSync(dir, { recursive: true }); mkdirSync(join(rundir, 'obs'), { recursive: true }); mkdirSync(join(rundir, 'bin'), { recursive: true });
    for (const [id, ts] of sessoes) writeFileSync(join(dir, `events.${id}.jsonl`), `${JSON.stringify({ seq: 1, ts, tipo: 'sessao.inicio', dados: {} })}\n${JSON.stringify({ seq: 2, ts: new Date(Date.parse(ts) + 60_000).toISOString(), tipo: 'dono.mensagem', dados: { sha256: 'a'.repeat(64) } })}\n`);
    writeFileSync(join(repo, 'README.md'), 'x'); writeFileSync(join(rundir, 'gh.json'), '{}');
    return { rundir, repo };
  }
  const geometria = { AbovePrompt: { maxRows: 7, rows: 24, bodyColumns: 75 } };
  const celulaAcima = { local: 'acima', cols: 80, rows: 24, cheia: true };
  const conversaDe = (m) => R.lerConversa(m.rundir, { home: tmp() });
  const comContexto = () => { const e = clone(ESTADO_REAL); e.agora.orquestrador.contexto = 19; return e; };

  test('sessao-real-e-pacote-fixo: a sessão vem do diário (uuid), o pacote é o sorteado dela e encadeia com o /clear', async () => {
    const m = repoDeConversa({ sessoes: [[UUID1, '2026-11-14T05:00:00.000Z'], [UUID2, '2026-11-14T06:00:00.000Z']] });
    assert.equal(R.sessaoRealDe(m.repo, Date.parse('2026-11-14T05:30:00.000Z')), UUID1);
    assert.equal(R.sessaoRealDe(m.repo, Date.parse('2026-11-14T06:30:00.000Z')), UUID2, 'depois do /clear vale a sessão nova');
    assert.equal(R.sessaoRealDe(m.repo, Date.parse('2026-11-14T04:00:00.000Z')), null, 'antes da 1ª sessão não há sessão real (nunca "S-a1")');
    const p1 = await R.pacoteDaConversa(m.repo, UUID1); const p2 = await R.pacoteDaConversa(m.repo, UUID2);
    assert.match(p1, /^[a-z0-9-]{1,32}$/);
    assert.notEqual(p2, p1, 'o sorteio da 2ª sessão exclui o pacote da anterior (anterior)');
    assert.equal(await R.pacoteDaConversa(m.repo, UUID1), p1, 'determinístico');
    assert.equal(await R.pacoteDaConversa(m.repo, 'S-a1'), null);
  });
  test('replay-ingenuo-reprova: entrada com session_id "S-a1" (ou fora do diário) e pacote ausente são recusados', () => {
    assert.deepEqual(R.validarEntradaDoReplay({ session_id: UUID1 }, { sessoes: [UUID1], pacote: 'herois' }), []);
    assert.match(R.validarEntradaDoReplay({ session_id: 'S-a1' }, { pacote: 'herois' }).join(';'), /replay ingênuo/);
    assert.match(R.validarEntradaDoReplay({ session_id: UUID2 }, { sessoes: [UUID1], pacote: 'herois' }).join(';'), /sem diário/);
    assert.match(R.validarEntradaDoReplay({ session_id: UUID1 }, { sessoes: [UUID1], pacote: null }).join(';'), /pacote/);
    assert.match(R.validarEntradaDoReplay(null).join(';'), /não é objeto/);
  });
  test('replayDoPonto-recusa-conversa-sem-sessao-real (replay ingênuo reprova) e usa session_id real, pacote fixo e o relógio injetado', async () => {
    const m = repoDeConversa();
    const t = Date.parse('2026-11-14T05:10:00.000Z'); const visto = [];
    const deps = { estado: async (a) => { visto.push(a); return comContexto(); } };
    const r = await R.replayDoPonto({ conversa: conversaDe(m), snap: { t, n: 1, estado: {} }, geometria, celula: celulaAcima, destino: join(tmp(), 'w'), deps });
    assert.equal(visto[0].entrada.session_id, UUID1, 'session_id REAL da conversa');
    assert.equal(visto[0].agoraMs, t, 'relógio injetado: o instante gravado do snapshot, nunca o de agora');
    assert.equal(visto[0].pacote, await R.pacoteDaConversa(m.repo, UUID1));
    assert.ok(r.linhas.length > 0);
    // o mesmo estado com 2 relógios: o relógio chega ao produto e a saída mascarada não depende dele
    const dois = await R.replayDoPonto({ conversa: conversaDe(m), snap: { t: t + 3_600_000, n: 1, estado: {} }, geometria, celula: celulaAcima, destino: join(tmp(), 'w2'), deps });
    assert.equal(visto[1].agoraMs, t + 3_600_000);
    assert.deepEqual(dois.linhas, r.linhas);
    // antes de qualquer sessão: replay ingênuo recusado
    await assert.rejects(() => R.replayDoPonto({ conversa: conversaDe(m), snap: { t: Date.parse('2026-11-14T04:00:00.000Z'), n: 1, estado: {} }, geometria, celula: celulaAcima, destino: join(tmp(), 'w3'), deps }), /replay recusado.*session_id/);
  });
  test('contexto-%-fora-do-replay: o quadro nunca leva "contexto <n> %" (só existe ao vivo; mutação: contexto incluído)', async () => {
    const m = repoDeConversa();
    const r = await R.replayDoPonto({ conversa: conversaDe(m), snap: { t: Date.parse('2026-11-14T05:10:00.000Z'), n: 1, estado: {} }, geometria, celula: celulaAcima, destino: join(tmp(), 'w'), deps: { estado: async () => comContexto() } });
    assert.ok(r.linhas.some((l) => /ctx N %/.test(l)), 'a linha do contexto (EQUIPE do E4, GM-15 T29) segue lá, com o valor mascarado');
    assert.deepEqual(R.camposAoVivoNoQuadro(['│  ctx ███░░ 19% · pouso em 50%   tok ?', '├─ ● SAM  T3  ctx ███░ 30%  60k · 2m  a']).length, 2, 'o detector acha o contexto do E4 que escapou');
    assert.equal(R.mascararAoVivo('│  ctx █████░░░░ 70% · pouso em 50% · hora de pousar   tok 412k'), '│  ctx N % · pouso em 50%  tok 412k');
    assert.equal(R.mascararAoVivo('│  ctx ? · pouso em 50%   tok ?'), '│  ctx N % · pouso em 50%  tok ?');
    assert.equal(R.mascararAoVivo('GANDALF ctx ███░ ~55% (estimado) · hora de pousar   tok ?'), 'GANDALF ctx N %  tok ?');
    assert.equal(R.mascararAoVivo('├─ ● SAM · haiku  T3  ctx ███░░░░░░░ 30%  60k · 2h20  implementando (registrado)'), '├─ ● SAM · haiku  T3  ctx N %  D  implementando (registrado)');
    assert.equal(R.mascararAoVivo('└─ ● SAM  T3  ctx 93k  6m  lendo 2 arquivos'), '└─ ● SAM  T3  ctx N %  D  lendo 2 arquivos');
    assert.equal(R.mascararAoVivo('  ● T4  Tarefa  implementando  GIMLI    2h20'), '  ● T4  Tarefa  implementando  GIMLI  D');
    assert.deepEqual(R.camposAoVivoNoQuadro(r.linhas), []);
    assert.deepEqual(R.camposAoVivoNoQuadro(['AGORA · GANDALF · contexto 19 %']), ['AGORA · GANDALF · contexto 19 %'], 'o detector acha o contexto que escapou');
    assert.equal(R.mascararAoVivo('AGORA · GANDALF · contexto 19 %'), 'AGORA · GANDALF · contexto N %');
    assert.equal(R.mascararAoVivo('AGORA · GANDALF · contexto ?'), 'AGORA · GANDALF · contexto N %');
    assert.equal(R.mascararAoVivo('  SAM · T24 · lendo 2 arquivos · 3m 20s'), '  SAM · T24 · lendo 2 arquivos · D');
    assert.equal(R.mascararAoVivo('AGORA · GANDALF · contexto 70 % · hora de pousar'), 'AGORA · GANDALF · contexto N %');
  });
  test('diario-no-instante: o esqueleto do repo corta os eventos com ts depois do snapshot e liga o resto', () => {
    const m = repoDeConversa();
    const w = R.reconstruirRepo(m.repo, join(tmp(), 'esqueleto'), Date.parse('2026-11-14T05:00:30.000Z'));
    const eventos = readFileSync(join(w, '.harness', 'entregas', 'GM-13', `events.${UUID1}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(eventos.map((e) => e.tipo), ['sessao.inicio'], 'o dono.mensagem de 05:01 ainda não existia às 05:00:30');
    assert.equal(readFileSync(join(w, 'README.md'), 'utf8'), 'x', 'o resto do repo é o mesmo (symlink)');
    const tudo = R.reconstruirRepo(m.repo, join(tmp(), 'esqueleto2'), Date.parse('2026-11-14T07:00:00.000Z'));
    assert.equal(readFileSync(join(tudo, '.harness', 'entregas', 'GM-13', `events.${UUID1}.jsonl`), 'utf8').split('\n').filter(Boolean).length, 2);
  });
  test('placement-por-replay-recusado e comportamento-por-replay-recusado: só o desenho (1, 2) se mede por replay', () => {
    assert.throws(() => R.avaliarPorReplay({ n: 3, quadros: [], quadrosSemProps: 0, celula: celulaAcima }, ['12-placement-da-pane']), /replay recusado para 12-placement-da-pane/);
    assert.throws(() => R.avaliarPorReplay({ n: 3, quadros: [], quadrosSemProps: 0, celula: celulaAcima }, ['3-sem-task-integrada']), /só o desenho/);
    const ev = { n: 1, celula: { local: 'acima', cols: 180, rows: 50, cheia: true }, quadros: [{ linhas: QUADRO_CHEIO, itensDepende: 1 }], quadrosSemProps: 0 };
    assert.deepEqual(R.avaliarPorReplay(ev).map((x) => [x.id, x.ok]), [['1-depende-no-topo', true], ['2-blocos-e-corte', true]]);
    assert.equal(R.avaliarPorReplay({ ...ev, n: 0 }).every((x) => x.ok === false), true, 'replay sem nenhum ponto é evidência vazia e reprova');
    assert.equal(R.avaliarPorReplay({ ...ev, quadrosSemProps: 1 }).some((x) => x.ok === false), true, 'geometria que a curta não mediu é "não medida"');
  });
  test('replayDaConversa-sem-geometria-da-curta-nao-mede (não inventa props) e lança com campo ao vivo no quadro', async () => {
    const m = repoDeConversa(); mkdirSync(join(m.rundir, 'estados'), { recursive: true });
    writeFileSync(join(m.rundir, 'estados', '01.json'), JSON.stringify({ n: 1, t: Date.parse('2026-11-14T05:10:00.000Z'), props: {}, agentes: [], estado: {} }));
    const deps = { estado: async () => comContexto() };
    const sem = await R.replayDaConversa({ conversa: conversaDe(m), celula: celulaAcima, geometria: null, destino: join(tmp(), 'r'), deps });
    assert.deepEqual([sem.n, sem.quadros.length, sem.quadrosSemProps], [1, 0, 1]);
    const com = await R.replayDaConversa({ conversa: conversaDe(m), celula: celulaAcima, geometria, destino: join(tmp(), 'r2'), deps });
    assert.deepEqual([com.n, com.quadros.length, com.quadrosSemProps], [1, 1, 0]);
    assert.ok(com.quadros[0].itensDepende >= 0);
  });
  test('replay-reconstruido-bate-na-estrutura-com-a-tela-real: 26/26 em 80x24 (matriz gravada 1794625214308; pula se ausente)', { timeout: 120_000, todo: 'gravação do desenho de 5 blocos (pré-D-G1b); regravar no aceite final T27' }, async (t) => {
    const dir = join(R.raizDoRepoReal(), '.claude-tmp', 'a1', '1794625214308', 'acima-80x24-cheia');
    if (!existsSync(dir)) { t.skip('matriz gravada ausente'); return; }
    const conversa = R.lerConversa(dir, { home: tmp() });
    const reais = R.blocosDaFaixaNaTela(R.emularTela(readFileSync(join(dir, 'tty.raw'), 'utf8'), 24, 80), 24);
    const snaps = readdirSync(join(dir, 'estados')).sort().map((f) => ({ ...JSON.parse(readFileSync(join(dir, 'estados', f), 'utf8')), t: statSync(join(dir, 'estados', f)).mtimeMs, f }));
    let bate = 0;
    const destino = tmp();
    for (const s of snaps) {
      const r = await R.replayDoPonto({ conversa, snap: s, geometria: { AbovePrompt: s.props.AbovePrompt }, celula: { local: 'acima', cols: 80, rows: 24, cheia: true }, destino: join(destino, s.f) });
      if (reais.some((b) => R.estruturaDe(b) === R.estruturaDe(r.linhas) && b.length === r.linhas.length)) bate += 1;
    }
    assert.equal(snaps.length, 26);
    assert.equal(bate, 26, `estrutura igual a algum quadro real em ${bate}/26`);
    // replay ingênuo (session_id "S-a1" do runner antigo) NÃO bate: o controle 1 é o que faz o replay valer
    const ingenuo = await R.replayDoPonto({ conversa, snap: snaps[0], geometria: { AbovePrompt: snaps[0].props.AbovePrompt }, celula: { local: 'acima', cols: 80, rows: 24, cheia: true }, destino: join(destino, 'ing'), deps: { estado: (a) => R.estadoEmProcesso({ ...a, entrada: { ...a.entrada, session_id: 'S-a1' } }) } });
    assert.notEqual(R.estruturaDe(ingenuo.linhas), R.estruturaDe((await R.replayDoPonto({ conversa, snap: snaps[0], geometria: { AbovePrompt: snaps[0].props.AbovePrompt }, celula: { local: 'acima', cols: 80, rows: 24, cheia: true }, destino: join(destino, 'bom') })).linhas));
  });
});

describe('T52 (emenda 45) a matriz por conversa: 8 curtas + 2 conversas + replay; passa = 8/8; parada cedo', () => {
  const resultadosOk = (ids) => ids.map((id) => ({ id, ref: id, ok: true, detalhe: 'ok' }));
  const idsDe = (g) => R.GRUPOS[g];
  /** Base gravada de mentira: as 2 conversas e as 8 curtas existem como pastas; as fontes de avaliação são injetadas. */
  function baseGravada({ semCurta = null, semConversa = null } = {}) {
    const base = tmp();
    for (const c of MATRIZ) if (idDaCelula(c) !== semCurta) mkdirSync(join(base, `curta-${idDaCelula(c)}`), { recursive: true });
    for (const id of R.CONVERSAS) if (id !== semConversa) mkdirSync(join(base, id), { recursive: true });
    return base;
  }
  const depsBoas = (extra = {}) => ({
    conversa: async () => ({ resultados: resultadosOk(idsDe('comportamento')) }),
    curta: async () => ({ resultados: resultadosOk(idsDe('placement')), geometria: { AbovePrompt: { maxRows: 7, rows: 24, bodyColumns: 75 } } }),
    replay: async ({ celula }) => ({ celula, n: 26, quadros: [], quadrosSemProps: 0 }),
    ...extra,
  });
  const avaliarDesenhoOk = (orig) => orig;
  test('as-conversas-sao-uma-por-local-em-180x50-cheia', () => {
    assert.deepEqual(R.CONVERSAS, ['lateral-180x50-cheia', 'acima-180x50-cheia']);
    assert.equal(R.conversaDoLocal('acima'), 'acima-180x50-cheia');
  });
  test('grupos: desenho = 1 e 2; placement = 12; comportamento = o resto; juntos são as 17 e não se repetem', () => {
    assert.deepEqual(R.GRUPOS.desenho, ['1-depende-no-topo', '2-blocos-e-corte']);
    assert.deepEqual(R.GRUPOS.placement, ['12-placement-da-pane']);
    const juntos = [...R.GRUPOS.desenho, ...R.GRUPOS.placement, ...R.GRUPOS.comportamento];
    assert.equal(new Set(juntos).size, 17); assert.deepEqual([...juntos].sort(), [...R.GRUPOS.todas].sort());
    assert.throws(() => avaliarExecucao(evBoa(), 'nenhum'), /grupo de asserções desconhecido/);
    const so = avaliarExecucao(evBoa(), 'comportamento');
    assert.deepEqual(so.resultados.map((x) => x.id), R.GRUPOS.comportamento);
  });
  test('8/8: as 3 fontes por combinação (comportamento da conversa do local, desenho por replay, placement pela curta)', async () => {
    const base = baseGravada();
    const g = await R.avaliarGravada(base, { falas: [] }, { deps: { ...depsBoas(), replay: async ({ celula }) => ({ celula, n: 1, quadros: [{ linhas: QUADRO_CHEIO, itensDepende: 1 }], quadrosSemProps: 0 }) } });
    assert.equal(g.rel.total, 8);
    assert.deepEqual(g.rel.linhas.filter((l) => !l.passa).map((l) => `${l.celula}:${l.motivo}`), [], 'nenhuma combinação reprova');
    assert.equal(g.rel.ok, true);
    assert.equal(g.execucoes[0].resultados.length, 17, 'cada combinação junta as 17 asserções (12 + 1/2 + comportamento)');
  });
  test('curta-ausente-ou-conversa-ausente-reprova-a-combinação (evidência vazia = reprova; nunca 8/8 por omissão)', async () => {
    const semCurta = await R.avaliarGravada(baseGravada({ semCurta: 'lateral-80x24-normal' }), { falas: [] }, { deps: depsBoas() });
    assert.equal(semCurta.rel.ok, false);
    assert.match(semCurta.rel.linhas.find((l) => l.celula === 'lateral-80x24-normal').motivo, /12-placement/);
    const semConv = await R.avaliarGravada(baseGravada({ semConversa: 'acima-180x50-cheia' }), { falas: [] }, { deps: depsBoas() });
    assert.equal(semConv.rel.passou <= 4, true, 'as 4 combinações de acima não têm a conversa do local');
    assert.match(semConv.execucoes.find((x) => x.celula.startsWith('acima')).resultados.find((r) => !r.ok).detalhe, /não executada|conversa/);
  });
  test('replay-que-lanca-ou-asserção-de-comportamento-que-falha-reprova-só-a-combinação-dela', async () => {
    const g = await R.avaliarGravada(baseGravada(), { falas: [] }, { deps: depsBoas({ replay: async ({ celula }) => { if (celula.local === 'acima' && celula.cols === 80) throw new Error('replay recusado: session_id'); return { celula, n: 1, quadros: [{ linhas: QUADRO_CHEIO, itensDepende: 1 }], quadrosSemProps: 0 }; } }) });
    assert.deepEqual(g.rel.linhas.filter((l) => !l.passa).map((l) => l.celula).sort(), ['acima-80x24-cheia', 'acima-80x24-normal']);
    assert.match(g.execucoes.find((x) => x.celula === 'acima-80x24-cheia').resultados.find((r) => r.id === '2-blocos-e-corte').detalhe, /replay: replay recusado/);
    const g2 = await R.avaliarGravada(baseGravada(), { falas: [] }, { deps: depsBoas({ replay: async ({ celula }) => ({ celula, n: 1, quadros: [{ linhas: QUADRO_CHEIO, itensDepende: 1 }], quadrosSemProps: 0 }), conversa: async (rundir) => ({ resultados: resultadosOk(idsDe('comportamento')).map((r) => (rundir.endsWith('lateral-180x50-cheia') && r.id === '9-veredito-com-revisor-antes' ? { ...r, ok: false } : r)) }) }) });
    assert.equal(g2.rel.linhas.filter((l) => l.celula.startsWith('lateral') && !l.passa).length, 4, 'a falha da conversa lateral reprova as 4 combinações lateral');
    assert.equal(g2.rel.linhas.filter((l) => l.celula.startsWith('acima') && !l.passa).length, 0);
    void avaliarDesenhoOk;
  });
  test('matrizA1-parada-cedo: sessão curta reprovada ou invariante violada NÃO abre as conversas; tudo passa ⇒ as 2 conversas em paralelo', async () => {
    const chamadas = [];
    const mat = (res) => async (fonte, raiz, roteiro, so, opc) => { chamadas.push({ so, modo: opc.modo ?? 'conversa', grupo: opc.grupo ?? null, paralelo: opc.paralelo }); return res(opc); };
    const base = { rel: { passou: 8, total: 8, ok: true, linhas: [] } };
    const avalia = async () => base;
    const bad = await R.matrizA1('f', 'r', { falas: [] }, { deps: { matriz: mat((o) => ({ execucoes: [{ celula: 'lateral-80x24-normal', passa: false }], abortada: null })), avaliarGravada: avalia } });
    assert.deepEqual(chamadas.map((c) => c.modo), ['curta'], 'curta reprovada: 1 chamada só');
    assert.match(bad.abortada, /sessão curta reprovada em lateral-80x24-normal/);
    chamadas.length = 0;
    const inv = await R.matrizA1('f', 'r', { falas: [] }, { deps: { matriz: mat(() => ({ execucoes: [], abortada: 'invariante violada na célula x' })), avaliarGravada: avalia } });
    assert.deepEqual(chamadas.map((c) => c.modo), ['curta']); assert.match(inv.abortada, /invariante violada/);
    chamadas.length = 0;
    const ok = await R.matrizA1('f', 'r', { falas: [] }, { deps: { matriz: mat(() => ({ execucoes: [{ celula: 'a', passa: true }], abortada: null })), avaliarGravada: avalia } });
    assert.deepEqual(chamadas.map((c) => [c.modo, c.so, c.grupo]), [['curta', null, null], ['conversa', R.CONVERSAS.join(','), 'comportamento']]);
    assert.equal(ok.abortada, null); assert.equal(ok.rel.ok, true);
    chamadas.length = 0;
    await R.matrizA1('f', 'r', { falas: [] }, { semConversas: true, deps: { matriz: mat(() => ({ execucoes: [{ celula: 'a', passa: true }], abortada: null })), avaliarGravada: avalia } });
    assert.deepEqual(chamadas.map((c) => c.modo), ['curta'], '--sem-conversas: só o placement barato');
    chamadas.length = 0;
    const conv = await R.matrizA1('f', 'r', { falas: [] }, { deps: { matriz: mat((o) => ({ execucoes: [{ celula: 'a', passa: true }], abortada: o.modo === 'curta' ? null : 'repo real alterado' })), avaliarGravada: avalia } });
    assert.match(conv.abortada, /^conversa: repo real alterado/);
  });
  test('matriz-modo-curta: a pasta é curta-<id>, o curta.json diz se há pedido e o a1.exp recebe "curta"', async () => {
    const e = ambienteMatriz(); e.deps.avaliarCurta = async (rundir, celula) => ({ celula: idDaCelula(celula), passa: true, resultados: [] });
    const m = await rodarMatriz(e, { modo: 'curta', paralelo: 2 });
    assert.equal(e.chamadas.length, 8);
    for (const a of e.chamadas) {
      assert.ok(a.rundir.includes('/curta-'), a.rundir);
      assert.equal(a.args.at(-1), 'curta');
      const c = JSON.parse(readFileSync(join(a.rundir, 'curta.json'), 'utf8'));
      const celula = JSON.parse(readFileSync(join(a.rundir, 'celula.json'), 'utf8'));
      assert.equal(c.pedido, celula.local === 'lateral' && celula.cols === 80, `${a.rundir}: pedido só abaixo do limiar na lateral`);
    }
    assert.equal(m.execucoes.length, 8);
    const conv = ambienteMatriz();
    await rodarMatriz(conv, { so: 'lateral-180x50-cheia' });
    assert.equal(conv.chamadas[0].args.includes('curta'), false, 'a conversa não é curta');
  });
  test('lerSessaoCurta-sem-curta.json (uma conversa) é null', () => {
    const d = tmp(); assert.equal(R.lerSessaoCurta(d, { local: 'lateral', cols: 80, rows: 24, cheia: false }), null);
  });
});

describe('T52 r1: correções da revisão (rolagem do VT, Pane da conversa lateral, detectores reais, ações no instante)', () => {
  test('MAJOR-2 emulador rola a tela com LF e quebra automática na última linha', () => {
    assert.deepEqual(R.emularTela('a\r\nb\r\nc\r\nd', 3, 5).at(-1).linhas, ['b', 'c', 'd']);
    assert.deepEqual(R.emularTela('abcdefgh', 2, 3).at(-1).linhas, ['def', 'gh'], 'a quebra automática na última linha também rola');
  });
  test('MAJOR-2 tela real lateral-80x24-normal: nenhum quadro com lixo colado na linha do PAROU (pula sem a gravação)', (t) => {
    const dir = join(R.raizDoRepoReal(), '.claude-tmp', 'a1', '1794625214308', 'lateral-80x24-normal');
    if (!existsSync(dir)) { t.skip('gravação ausente: no CI só a cobertura sintética (limite declarado)'); return; }
    const q = R.emularTela(readFileSync(join(dir, 'tty.raw'), 'utf8'), 24, 80);
    const sujos = q.filter((f) => f.linhas.some((l) => /■ PAROU \d\d:\d\d.*\S{3,}■ PAROU/.test(l) || /■ PAROU.*\n/.test(l)));
    assert.equal(sujos.length, 0);
  });
  test('MAJOR-3 detectores casam com o texto real do produto: "■ PAROU hh:mm" e a pergunta com botões [ 1 … ]', () => {
    assert.match(`${PAROU_REAL} · ${AVISO_80}`, R.PAROU_NA_LINHA);
    assert.doesNotMatch('PAROU 01:44 · 3 paradas', R.PAROU_NA_LINHA, 'forma inventada não vale');
    assert.match(PERGUNTA_B, R.PERGUNTA_NA_LINHA);
    assert.doesNotMatch('depende de você: Esta conversa', R.PERGUNTA_NA_LINHA);
  });
  test('MINOR-1 reason sem número exige "mais colunas" (n null); qualquer N fixo reprova', () => {
    const m = montarCurta({ semUnasked: true }); // monta o debug.log à mão
    writeFileSync(join(m.rundir, 'debug.log'), 'Checking plugin gabarito-mestre: enabled\n2026-11-14T04:40:10.000Z [DEBUG] ui.open gabarito-mestre gabarito-painel (unasked, 80 columns): waits unplaced (unasked: placed when the person opens it)\n2026-11-14T04:41:00.000Z [DEBUG] ui.open gabarito-mestre gabarito-painel (asked, 80 columns): placed\n');
    assert.equal(r12(m).ok, false); assert.match(r12(m).detalhe, /mais colunas/);
    const ok = montarCurta({ semUnasked: true, depoisDaB: 'painel lateral precisa de mais colunas: /gabarito painel para abrir' });
    writeFileSync(join(ok.rundir, 'debug.log'), readFileSync(join(m.rundir, 'debug.log')));
    assert.equal(r12(ok).ok, true, r12(ok).detalhe);
  });
  test('MAJOR-1 a conversa lateral lê a Pane da TELA no marco snap-<n>: marco errado, sem marco ou Pane undefined deixam o ponto "sem props"', async () => {
    const mk = (marco) => { const m = montarExecucao({ semProps: true }); writeFileSync(join(m.rundir, 'tty.raw'), marcoOsc(marco) + quadroRaw(telaDock(50, 180))); return m; };
    const ev = await coleta0(mk('snap-1'));
    assert.equal(ev.quadrosSemProps, 0, 'Pane lida da tela');
    assert.equal(ev.quadros.length, 1);
    assert.ok(ev.quadros[0].linhas.length > 0);
    assert.equal((await coleta0(mk('snapX-1'))).quadrosSemProps, 1, 'marco errado: não mede');
    const sem = montarExecucao({ semProps: true }); writeFileSync(join(sem.rundir, 'tty.raw'), quadroRaw(telaDock(50, 180)));
    assert.equal((await coleta0(sem)).quadrosSemProps, 1, 'snapshot sem marco: não mede');
    const semTela = montarExecucao({ semProps: true });
    assert.equal((await coleta0(semTela)).quadrosSemProps, 1, 'sem tty.raw: não mede');
  });
  test('MAJOR-1 a1.exp (conversa) grava o marco snap-<n> no tty.raw antes do snapshot', { timeout: 100_000 }, (t) => {
    if (spawnSync('expect', ['-v'], { encoding: 'utf8' }).error) { t.skip('expect ausente'); return; }
    const rundir = tmp(); const repo = join(rundir, 'repo'); const bin = join(rundir, 'bin'); mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true });
    writeFileSync(join(rundir, 'celula.json'), JSON.stringify({ local: 'lateral', cols: 80, rows: 24, cheia: false }));
    writeFileSync(join(rundir, 'claude.args'), '--model\nx\n'); writeFileSync(join(rundir, 'debug.log'), 'Checking plugin gabarito-mestre: enabled\n');
    writeFileSync(join(rundir, 'falas.tsv'), `7\tMUDANÇA DE ASSUNTO\t${'a'.repeat(64)}\tfala sintética\n`);
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nmkdir -p "$OBS_DIR"\necho \'{"t":1,"ev":"render","comp":"AbovePrompt","maxRows":3,"rows":24,"bodyColumns":75}\' > "$OBS_DIR/a1.jsonl"\nwhile IFS= read -r l; do case "$l" in /exit*) exit 0;; esac; done\n');
    const node = join(rundir, 'node-falso'); writeFileSync(node, '#!/bin/sh\nexit 0\n'); for (const f of [join(bin, 'claude'), node]) chmodSync(f, 0o755);
    const r = spawnSync('expect', ['-f', join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), rundir, repo, bin, node, 'runner'], { encoding: 'utf8', timeout: 90_000, env: { ...process.env, A1_ESCALA_TEMPO: '0.1' } });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.ok(R.emularTela(readFileSync(join(rundir, 'tty.raw'), 'utf8'), 24, 80).some((q) => q.marco === 'snap-7'), 'marco snap-7 no tty.raw');
  });
  test('MAJOR-4 controle 4 do replay: as ações do observador são cortadas no instante do snapshot', async () => {
    const UUID = '3ae9ccd6-f878-4f59-ac78-6406f260d71f'; const T0 = Date.parse('2026-11-14T05:10:00.000Z');
    const rundir = tmp(); const repo = join(rundir, 'repo'); const dir = join(repo, '.harness', 'entregas', 'GM-13'); mkdirSync(dir, { recursive: true }); mkdirSync(join(rundir, 'bin'), { recursive: true }); mkdirSync(join(rundir, 'obs'), { recursive: true });
    writeFileSync(join(dir, `events.${UUID}.jsonl`), `${JSON.stringify({ seq: 1, ts: '2026-11-14T05:00:00.000Z', tipo: 'sessao.inicio', dados: {} })}\n`);
    writeFileSync(join(rundir, 'gh.json'), '{}');
    const obs = [
      { t: T0 - 5000, ev: 'estado', agentes: [{ id: 'ag1', type: 'gabarito-mestre:gabarito-implementador', status: 'running', description: 'T1 implementador' }], nomes: null },
      { t: T0 - 1000, ev: 'tool', agentId: 'ag1', tool: 'Read' },
      { t: T0 + 4000, ev: 'tool', agentId: 'ag1', tool: 'Edit' },
    ];
    jl(join(rundir, 'obs', 'a1.jsonl'), obs);
    let visto = null;
    await R.replayDoPonto({ conversa: R.lerConversa(rundir, { home: tmp() }), snap: { t: T0, n: 1, estado: {} }, geometria: { AbovePrompt: { maxRows: 7, rows: 24, bodyColumns: 75 } }, celula: { local: 'acima', cols: 80, rows: 24, cheia: true }, destino: join(tmp(), 'w'), deps: { estado: async (a) => { visto = a.entrada; return clone(ESTADO_REAL); } } });
    assert.equal(visto.acoes.ag1.em, T0 - 1000, 'a última ação até o instante é a do Read; o Edit (T0+4s) ainda não aconteceu');
    assert.notEqual(visto.acoes.ag1.em, T0 + 4000);
  });
});

describe('T57 (emenda 63): o runner não digita fala sobre diálogo de permissão e a célula só vale com fala ↔ dono.mensagem 1:1', () => {
  // roteiro sintético de 8 falas; pontos.json sintético só para as de ponto (1, 2, 3, 5, 8: como o real), as outras (4, 6, 7) valem pelo roteiro
  const TEXTOS = Array.from({ length: 8 }, (_, i) => `fala sintética número ${i + 1} do roteiro de teste, com acento: ação`);
  const FALAS = TEXTOS.map((texto, i) => ({ n: i + 1, rotulo: [1, 2, 3, 5, 8].includes(i + 1) ? 'DECISÃO' : '—', texto }));
  const PONTOS = { pontos: FALAS.filter((f) => f.rotulo !== '—').map((f) => ({ msg: f.n, sha256: sha256(f.texto), chars: f.texto.length })) };
  const ev = (f, extra = {}) => ({ tipo: 'dono.mensagem', ts: '2026-11-14T10:00:05.000Z', dados: { sha256: sha256(f.texto), chars: f.texto.length }, ...extra });
  const SENDS = (ns) => `${ns.map((n, i) => `${1000 + i} digitar ${sha256(TEXTOS[n - 1])}`).join('\n')}\n`;
  const validar = (v) => validarFalas1a1({ eventos: [], sends: '', falas: FALAS, pontos: PONTOS, inicio: '2026-11-14T10:00:00.000Z', ...v });

  test('sessao-gravada-6-de-8: 8 falas digitadas e 6 dono.mensagem (a 6 e a 7 viraram resposta do diálogo) ⇒ célula INVÁLIDA com a causa de cada fala perdida', () => {
    const r = validar({ sends: SENDS([1, 2, 3, 4, 5, 6, 7, 8]), eventos: [1, 2, 3, 4, 5, 8].map((n) => ev(FALAS[n - 1])) });
    assert.equal(r.ok, false);
    assert.match(r.causa, /fala 6 perdida: digitada 1x \(esperado 1 registro\(s\)\), 0 dono\.mensagem/);
    assert.match(r.causa, /fala 7 perdida/);
    assert.doesNotMatch(r.causa, /fala [12345]|fala 8/, 'só as perdidas entram na causa');
    assert.equal(r.digitadas, 8);
  });
  test('fixture-8-de-8: cada fala digitada tem 1 dono.mensagem com sha256 e chars de pontos.json (ou do roteiro, nas sem ponto) ⇒ válida', () => {
    const r = validar({ sends: SENDS([1, 2, 3, 4, 5, 6, 7, 8]), eventos: FALAS.map((f) => ev(f)) });
    assert.deepEqual({ ok: r.ok, causa: r.causa, digitadas: r.digitadas }, { ok: true, causa: null, digitadas: 8 });
  });
  test('fala-dupla-chars-trocado-e-vacuo-reprovam-com-causa-propria (nunca aprovação em vácuo)', () => {
    const dupla = validar({ sends: SENDS([1, 2]), eventos: [ev(FALAS[0]), ev(FALAS[0]), ev(FALAS[1])] });
    assert.match(dupla.causa, /fala 1 dupla: digitada 1x \(esperado 1 registro\(s\)\), 2 dono\.mensagem/);
    const chars = validar({ sends: SENDS([1]), eventos: [{ ...ev(FALAS[0]), dados: { sha256: sha256(FALAS[0].texto), chars: 999 } }] });
    assert.match(chars.causa, /fala 1: dono\.mensagem com chars 999 diferente do esperado/);
    const trocado = validarFalas1a1({ eventos: [ev(FALAS[0])], sends: SENDS([1]), falas: FALAS, pontos: { pontos: [{ msg: 1, sha256: sha256(FALAS[0].texto), chars: 7 }] }, inicio: '' });
    assert.match(trocado.causa, /chars .* diferente do esperado 7/, 'o esperado do ponto vem de pontos.json, não do texto');
    assert.match(validar({ sends: '', eventos: [ev(FALAS[0])] }).causa, /nenhuma fala do roteiro digitada: não medida/);
    assert.match(validar({ sends: '1 trust\n2 exit\n' }).causa, /nenhuma fala do roteiro digitada/);
  });
  test('acao-do-runner-fora-do-roteiro-nao-conta-como-fala: resposta-b e /gabarito painel têm dono.mensagem e ficam à parte', () => {
    const resposta = { tipo: 'dono.mensagem', ts: '2026-11-14T10:00:07.000Z', dados: { sha256: sha256('/gabarito retomar'), chars: 17 } };
    const painel = { tipo: 'dono.mensagem', ts: '2026-11-14T10:00:08.000Z', dados: { sha256: sha256('/gabarito painel'), chars: 16 } };
    const sends = `${SENDS([1, 2])}2000 digitar resposta-b\n2001 recusar-permissao\n2002 digitar pedido-do-dono\n2003 exit\n`;
    const r = validar({ sends, eventos: [ev(FALAS[0]), resposta, ev(FALAS[1]), painel] });
    assert.equal(r.ok, true, r.causa);
    assert.equal(r.digitadas, 2, 'só as falas do roteiro');
    assert.deepEqual(r.acoesDoRunner, ['digitar resposta-b', 'recusar-permissao', 'digitar pedido-do-dono', 'exit']);
  });
  test('mesmo-texto-em-menos-de-120s-e-UMA-mensagem-para-o-produto (medido na sessão real: falas 4 e 7 iguais, 90 s entre elas, 1 dono.mensagem)', () => {
    const igual = { n: 9, rotulo: '—', texto: TEXTOS[0] };
    const sha = sha256(TEXTOS[0]);
    const com = (t2, qtos) => validarFalas1a1({ eventos: Array.from({ length: qtos }, () => ev(FALAS[0])), sends: `1000 digitar ${sha}\n${t2} digitar ${sha}\n`, falas: [FALAS[0], igual], pontos: { pontos: [] }, inicio: '' });
    assert.equal(com(1090, 1).ok, true, '90 s depois: o produto grava 1 vez e o validador espera 1');
    assert.match(com(1090, 2).causa, /dupla: digitada 2x \(esperado 1 registro/, '90 s depois e 2 registros: dupla');
    assert.match(com(1130, 1).causa, /perdida: digitada 2x \(esperado 2 registro/, '130 s depois: a janela passou, o produto grava de novo; 1 registro é perda');
    assert.equal(com(1130, 2).ok, true);
  });
  test('tres-digitacoes-do-mesmo-texto: a janela de 120 s conta do ÚLTIMO REGISTRO, não da última digitação (como o produto, mod/gabarito.mjs:646-655)', () => {
    const sha = sha256(TEXTOS[0]);
    const tres = (gravadas) => validarFalas1a1({ eventos: Array.from({ length: gravadas }, () => ev(FALAS[0])), sends: `1000 digitar ${sha}\n1100 digitar ${sha}\n1200 digitar ${sha}\n`, falas: [FALAS[0], { n: 9, rotulo: '—', texto: TEXTOS[0] }, { n: 10, rotulo: '—', texto: TEXTOS[0] }], pontos: { pontos: [] }, inicio: '' });
    // t=1000 registra; t=1100 (100 s depois do registro) é a mesma mensagem; t=1200 (200 s depois do registro, 100 s depois da digitação anterior) registra de novo ⇒ 2 registros
    assert.equal(tres(2).ok, true, tres(2).causa);
    assert.match(tres(1).causa, /fala 10 perdida: digitada 3x \(esperado 2 registro\(s\)\), 1 dono\.mensagem/);
    assert.match(tres(3).causa, /dupla: digitada 3x \(esperado 2 registro/);
  });
  test('falas-de-texto-igual: a perda é atribuída à fala certa (a 4ª ou a 7ª), não a "a última com o mesmo sha"', () => {
    const t4 = TEXTOS[3];
    const falas = FALAS.map((f) => (f.n === 7 ? { ...f, texto: t4 } : f));
    const sha = sha256(t4);
    const r = (t2, qtos) => validarFalas1a1({ eventos: Array.from({ length: qtos }, () => ev({ texto: t4 })), sends: `1000 digitar ${sha}\n${t2} digitar ${sha}\n`, falas, pontos: PONTOS, inicio: '' });
    assert.match(r(1130, 1).causa, /fala 7 perdida/, '2 registros esperados, o 1º (fala 4) existe: falta a 7');
    assert.doesNotMatch(r(1130, 1).causa, /fala 4/);
    assert.match(r(1130, 0).causa, /fala 4 perdida/, 'nenhum registro: falta já a 4');
    assert.match(r(1090, 0).causa, /fala 4 perdida/);
  });
  test('chars-sem-ponto-como-o-PRODUTO-grava: texto.length (UTF-16), não pontos de código', () => {
    const texto = 'fala com emoji \u{1F600} e ação';
    assert.notEqual(texto.length, [...texto].length);
    const f = { n: 4, rotulo: '—', texto };
    const com = (chars) => validarFalas1a1({ eventos: [{ tipo: 'dono.mensagem', ts: '2026-11-14T10:00:05.000Z', dados: { sha256: sha256(texto), chars } }], sends: `1000 digitar ${sha256(texto)}\n`, falas: [f], pontos: { pontos: [] }, inicio: '' });
    assert.equal(com(texto.length).ok, true);
    assert.match(com([...texto].length).causa, /chars .* diferente do esperado/);
  });
  test('dono.mensagem-anterior-ao-inicio-nao-e-da-conversa (a semente da cópia)', () => {
    const r = validar({ sends: SENDS([1]), eventos: [ev(FALAS[0], { ts: '2026-11-14T09:00:00.000Z' })] });
    assert.match(r.causa, /fala 1 perdida/);
  });
  test('sha256-e-chars-do-dono.mensagem-que-o-PRODUTO-grava-igualam-os-de-pontos.json (a ponte real, não a conta do teste)', async () => {
    const { codigoPonte } = await import(pathToFileURL(join(AQUI, '..', 'dist', 'pouso.js')).href);
    const url = pathToFileURL(join(AQUI, '..', 'dist', 'diario.js')).href;
    const gravar = (dir, texto) => {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigoPonte(url)], { input: JSON.stringify({ op: 'mensagem', dir, cwd: dir, texto }), encoding: 'utf8' });
      assert.equal(JSON.parse(r.stdout).ok, true, r.stderr);
    };
    const dir = join(tmp(), 'ent'); mkdirSync(dir, { recursive: true });
    for (const f of FALAS) gravar(dir, f.texto);
    const gravados = readdirSync(dir).filter((x) => x.endsWith('.jsonl')).flatMap((x) => readFileSync(join(dir, x), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    assert.equal(gravados.length, 8);
    for (const p of PONTOS.pontos) {
      const g = gravados.find((e) => e.dados.sha256 === p.sha256);
      assert.ok(g, `msg ${p.msg}: o produto gravou o sha256 de pontos.json`);
      assert.equal(g.dados.chars, p.chars, `msg ${p.msg}: chars do produto = chars de pontos.json`);
    }
    // e o validador aceita exatamente o que o produto gravou (diário real do produto como evidência)
    const r = validar({ sends: SENDS([1, 2, 3, 4, 5, 6, 7, 8]), eventos: gravados.map((e) => ({ ...e, ts: '2026-11-14T10:00:05.000Z' })) });
    assert.equal(r.ok, true, r.causa);
  });
  test('roteiro-real-vs-pontos.json: o produto grava os MESMOS sha256 e chars de cada ponto (pula sem o roteiro local)', async (t) => {
    const raiz = raizPrincipal(AQUI);
    const pts = JSON.parse(readFileSync(PONTOS_ARQ, 'utf8'));
    const rot = verificarRoteiro(join(raiz, ROTEIRO_REL), pts.roteiroSha256);
    if (!rot.ok) { t.skip('roteiro local ausente'); return; }
    const { codigoPonte } = await import(pathToFileURL(join(AQUI, '..', 'dist', 'pouso.js')).href);
    const url = pathToFileURL(join(AQUI, '..', 'dist', 'diario.js')).href;
    const dir = join(tmp(), 'ent'); mkdirSync(dir, { recursive: true });
    for (const f of rot.falas) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigoPonte(url)], { input: JSON.stringify({ op: 'mensagem', dir, cwd: dir, texto: f.texto }), encoding: 'utf8' });
      assert.equal(JSON.parse(r.stdout).ok, true);
    }
    const gravados = readdirSync(dir).filter((x) => x.endsWith('.jsonl')).flatMap((x) => readFileSync(join(dir, x), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    for (const p of pts.pontos) {
      const g = gravados.find((e) => e.dados.sha256 === p.sha256);
      assert.ok(g, `msg ${p.msg}: sha256 do produto = pontos.json`);
      assert.equal(g.dados.chars, p.chars, `msg ${p.msg}: chars do produto = pontos.json`);
    }
  });
  test('avaliarRundir-com-pontos: célula inválida com id próprio quando falta dono.mensagem; válida (e com as ações do runner à parte) quando há 1:1', async () => {
    const m = montarExecucao({});
    const celula = { local: 'lateral', cols: 180, rows: 50, cheia: true };
    const roteiro = roteiroColeta();
    const textoA = roteiro.falas.find((f) => sha256(f.texto) === sha256(FALA_A)).texto;
    const dono = (texto, ts) => ({ seq: 1, ts, tipo: 'dono.mensagem', dados: { sha256: sha256(texto), chars: texto.length } });
    writeFileSync(join(m.rundir, 'sends.log'), `1 digitar ${sha256(FALA_A)}\n2 digitar ${sha256(FALA_STATUS)}\n3 digitar resposta-b\n`);
    const gravar = (linhas) => jl(join(m.repo, '.harness', 'entregas', 'GM-13', 'events.loop.jsonl'), linhas);
    gravar([dono(textoA, '2026-11-13T10:02:00.000Z')]);
    const ruim = await R.avaliarRundir(m.rundir, { repo: m.repo, celula, roteiro, pasta: m.pasta, total: 1, pontos: { pontos: [] } });
    assert.equal(ruim.passa, false);
    assert.deepEqual(ruim.resultados.map((x) => x.id), ['falas-1a1']);
    assert.match(ruim.resultados[0].detalhe, /célula inválida: fala \d+ perdida/);
    gravar([dono(textoA, '2026-11-13T10:02:00.000Z'), dono(FALA_STATUS, '2026-11-13T10:03:00.000Z'), dono('resposta do runner', '2026-11-13T10:03:30.000Z')]);
    const boa = await R.avaliarRundir(m.rundir, { repo: m.repo, celula, roteiro, pasta: m.pasta, total: 1, pontos: { pontos: [] } });
    assert.ok(boa.resultados.length > 1 && boa.resultados.every((x) => x.id !== 'falas-1a1'), 'as asserções normais seguem');
    assert.deepEqual(boa.falas, { digitadas: 2, acoesDoRunner: ['digitar resposta-b'] });
  });
  test('causa-do-status-e-permissao-no-exp.log', () => {
    assert.match(R.causaDoStatus('DIALOGO_NAO_FECHOU\n'), /diálogo de permissão que não fechou/);
    assert.deepEqual(permissaoDoExpLog('1 inicio\n'), { apareceu: false, recusadas: 0, naoFechou: false });
    assert.deepEqual(permissaoDoExpLog('1 PERGUNTA-DE-PERMISSAO na tela\n2 PERMISSAO-RECUSADA 1\n'), { apareceu: true, recusadas: 1, naoFechou: false });
    assert.equal(permissaoDoExpLog('PERMISSAO-NAO-FECHOU').naoFechou, true);
  });

  test('avaliarRundir: diálogo de permissão que apareceu e o runner NÃO recusou (0 recusas) ou que não fechou ⇒ célula inválida com id próprio, mesmo com fala 1:1 aparente', async () => {
    const m = montarExecucao({});
    const celula = { local: 'lateral', cols: 180, rows: 50, cheia: true };
    const roteiro = roteiroColeta();
    const textoA = roteiro.falas.find((f) => sha256(f.texto) === sha256(FALA_A)).texto;
    writeFileSync(join(m.rundir, 'sends.log'), `1 digitar ${sha256(FALA_A)}\n`);
    jl(join(m.repo, '.harness', 'entregas', 'GM-13', 'events.loop.jsonl'), [{ seq: 1, ts: '2026-11-13T10:02:00.000Z', tipo: 'dono.mensagem', dados: { sha256: sha256(textoA), chars: textoA.length } }]);
    const av = (expLog) => { writeFileSync(join(m.rundir, 'exp.log'), expLog); return R.avaliarRundir(m.rundir, { repo: m.repo, celula, roteiro, pasta: m.pasta, total: 1, pontos: { pontos: [] } }); };
    const semRecusa = await av('1 PERGUNTA-DE-PERMISSAO na tela\n');
    assert.equal(semRecusa.passa, false);
    assert.deepEqual(semRecusa.resultados.map((x) => x.id), ['permissao-1a1']);
    assert.match(semRecusa.resultados[0].detalhe, /apareceu e o runner não o recusou/);
    const naoFechou = await av('1 PERGUNTA-DE-PERMISSAO na tela\n2 PERMISSAO-RECUSADA 1\n3 PERMISSAO-NAO-FECHOU\n');
    assert.match(naoFechou.resultados[0].detalhe, /não fechou/);
    const ok = await av('1 PERGUNTA-DE-PERMISSAO na tela\n2 PERMISSAO-RECUSADA 1\n');
    assert.ok(ok.resultados.every((x) => x.id !== 'permissao-1a1'), 'recusado e fechado: a célula segue para as asserções normais');
    assert.ok((await av('1 inicio\n')).resultados.every((x) => x.id !== 'permissao-1a1'), 'sem diálogo: nada a invalidar');
  });

  describe('a1.exp com um "claude" de mentira que abre o diálogo de permissão (comportamento: o que o terminal recebe)', () => {
    // o diálogo SIMULADO (espaços literais e os dois sinais). O diálogo REAL vem de fixtures/permissao-tty-real.json: o tty.raw gravado da A1 1794703098821, com movimentos de cursor entre as palavras
    const DIALOGO = "Hook PreToolUse:Bash requires confirmation for this command:\\n  integridade em .git/config exige confirmacao humana\\nDo you want to proceed?\\n> 1. Yes\\n  2. No\\nEsc\\033[1Cto\\033[1Ccancel\\n\\033]9;Claude needs your permission\\007\\n";
    const REAL = JSON.parse(readFileSync(join(AQUI, 'fixtures', 'permissao-tty-real.json'), 'utf8'));
    const procsDoExp = () => {
      const exp = readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8');
      return exp.slice(exp.indexOf('# escala dos tempos'), exp.indexOf('\ncd $repo'));
    };
    const falasDoExp = () => {
      const exp = readFileSync(join(AQUI, 'e2e', 'conversa-2026-11-11', 'a1.exp'), 'utf8');
      return exp.slice(exp.indexOf('set arq [open $rundir/falas.tsv r]'));
    };
    // o comando de shell que desenha o diálogo `qual`: texto simulado, o diálogo real (em 3 pedaços, partindo as sequências no meio), o real sem o `Esc to cancel`, só o aviso OSC, ou só o `Esc to cancel`
    const mostrar = (d, qual, pedacos = 3) => {
      const wr = (n, txt) => { writeFileSync(join(d, n), txt); return join(d, n); };
      if (qual === 'simulado') return `printf '${DIALOGO}'`;
      if (qual === 'osc') return `printf '\\033]9;Claude needs your permission\\007'`;
      if (qual === 'esc-solto') return "printf 'Esc to cancel\\n'";
      if (qual === 'trust-real' || qual === 'saida-real') {
        const txt = qual === 'trust-real' ? REAL.trustReal.bytes : REAL.saidaTarefasReal.bytes;
        const a = Math.floor(txt.length / 3);
        return [txt.slice(0, a + 1), txt.slice(a + 1, 2 * a + 7), txt.slice(2 * a + 7)].map((x, i) => `cat ${wr(`pedaco${qual}${i}`, x)}`).join('; sleep 0.2; ');
      }
      if (qual === 'parecido') return "printf 'Do you want to proceed with the refactor?\\n'";
      const txt = qual === 'real' ? REAL.comEscToCancel : REAL.semEscToCancel;
      const a = Math.floor(txt.length / 3);
      const partes = pedacos === 1 ? [txt] : [txt.slice(0, a + 1), txt.slice(a + 1, 2 * a + 7), txt.slice(2 * a + 7)];
      return partes.map((x, i) => `cat ${wr(`pedaco${qual}${i}`, x)}`).join('; sleep 0.2; ');
    };
    const ler = (d, n) => (existsSync(join(d, n)) ? readFileSync(join(d, n), 'utf8') : '');
    const saida = (d) => ({ teclas: ler(d, 'teclas'), fala: ler(d, 'fala').trim(), exp: ler(d, 'exp.log'), sends: ler(d, 'sends.log'), status: ler(d, 'exp.status').trim(), snap: ler(d, 'snap.log') });
    const novo = () => { const d = mkdtempSync(join(tmpdir(), 'a1-perm-')); TMPS.push(d); return d; };
    // espera (até 30 s, sem depender da carga da máquina) a marca que o "claude" de mentira imprime DEPOIS de desenhar o diálogo; tudo que chega passa pela `ler` real
    const ATE = ['proc ate {marca} {', '  set timeout 30; set acc ""', '  while {1} {', '    expect {', '      -re {.+} { ler $expect_out(0,string); append acc $expect_out(0,string); if {[string first $marca $acc] >= 0} { return 1 } }', '      timeout { return 0 }', '      eof { return 0 }', '    }', '  }', '}'].join('\n');
    const rodarExp = (d, corpo) => {
      writeFileSync(join(d, 'sim.exp'), `set rundir ${d}\nset env(A1_ESCALA_TEMPO) 0.25\n${procsDoExp()}\n${ATE}\n${corpo}\n`);
      const r = spawnSync('expect', ['-f', join(d, 'sim.exp')], { encoding: 'utf8', timeout: 90000 });
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    };
    // o "claude" do 1º teste: mostra o diálogo; o 1º byte decide: ESC fecha; qualquer outro é RESPOSTA ao diálogo (o defeito). `fecha=false`: ESC ignorado e o diálogo reaparece a cada tecla
    const rodar = (t, { dialogo = 'simulado', fecha = true, fala = 'FALA DO ROTEIRO UMA VEZ SO' } = {}) => {
      if (!temExpect(t)) return null;
      const d = novo();
      const mostra = dialogo === 'nenhum' ? "printf 'Do you want to proceed with the refactor?\\n'" : mostrar(d, dialogo);
      const filho = [
        mostra,
        'echo MARCAPRONTO',
        'IFS= read -rsn1 k',
        `if [ "$k" = "$(printf '\\033')" ]; then echo esc >> ${d}/teclas; k=''; ${fecha ? "printf 'tela limpa\\n'" : mostra}; else echo "$k" >> ${d}/teclas; fi`,
        ...(fecha ? [] : ['IFS= read -rsn1 k; echo "$k" >> ' + d + '/teclas; ' + mostra, 'IFS= read -rsn1 k; echo "$k" >> ' + d + '/teclas; ' + mostra, 'IFS= read -rsn1 k; echo "$k" >> ' + d + '/teclas; ' + mostra]),
        `IFS= read -r l; echo "$k$l" >> ${d}/fala`,
        'sleep 1',
      ].join('; ');
      writeFileSync(join(d, 'sim.sh'), `#!/bin/bash\n${filho}\n`); chmodSync(join(d, 'sim.sh'), 0o755);
      // a `sair` é a REAL do a1.exp (não há override): o que o runner faz ao terminar é parte do que se mede
      rodarExp(d, `spawn ${d}/sim.sh\nlog_user 0\nate MARCAPRONTO\ndigitar ${sha256(fala)} {${fala}}\nocioso\nif {$dialogo_aberto} { sair CONCLUIDO }\nexit 0`);
      return saida(d);
    };
    test('dialogo-aberto: Esc primeiro (recusa), registro na evidência, e a MESMA fala digitada depois, uma vez só', (t) => {
      const r = rodar(t); if (r === null) return;
      assert.match(r.teclas, /^esc\n/, 'o primeiro byte que o diálogo recebe é a recusa (Esc), nunca a fala');
      assert.equal(r.fala, 'FALA DO ROTEIRO UMA VEZ SO', 'a fala chegou ao prompt inteira, depois do diálogo fechar');
      assert.equal((r.exp.match(/PERMISSAO-RECUSADA/g) ?? []).length, 1);
      assert.match(r.exp, /PERGUNTA-DE-PERMISSAO na tela/);
      assert.equal(r.sends.split('\n').filter((l) => /recusar-permissao/.test(l)).length, 1);
      assert.equal(r.sends.split('\n').filter((l) => new RegExp(`digitar ${sha256('FALA DO ROTEIRO UMA VEZ SO')}$`).test(l)).length, 1, 'digitada uma vez só');
      assert.ok(r.sends.indexOf('recusar-permissao') < r.sends.indexOf('digitar '), 'recusa antes da fala');
      assert.deepEqual(permissaoDoExpLog(r.exp), { apareceu: true, recusadas: 1, naoFechou: false });
    });
    // MAJOR 1 (r1): no terminal REAL o texto vem com cursor (`Do\\e[5Gyou\\e[9Gwant...`). Cada um destes diálogos tem de abrir e ser recusado ANTES da fala, com UM sinal só
    for (const [qual, quem] of [
      ['real', 'o diálogo REAL gravado (tty.raw), sem o aviso OSC, em 3 pedaços partidos no meio de sequências: só o texto normalizado o detecta'],
      ['real-sem-esc', 'o diálogo REAL sem a linha "Esc to cancel": só `Do you want to proceed` + opções (1. Yes) o detecta, depois de normalizar o cursor'],
      ['osc', 'só o aviso OSC "Claude needs your permission" (sem texto de diálogo)'],
    ]) {
      test(`dialogo-detectado-por-UM-sinal [${qual}]: ${quem}`, (t) => {
        const r = rodar(t, { dialogo: qual });
        if (r === null) return;
        assert.match(r.teclas, /^esc\n/, 'o primeiro byte é Esc: a fala não foi digitada sobre o diálogo');
        assert.equal(r.fala, 'FALA DO ROTEIRO UMA VEZ SO');
        assert.equal((r.exp.match(/PERMISSAO-RECUSADA/g) ?? []).length, 1);
        assert.ok(r.sends.indexOf('recusar-permissao') < r.sends.indexOf('digitar '), 'recusa antes da fala');
      });
    }
    // MAJOR 1 (r2): `Esc to cancel` é o rodapé de OUTROS diálogos (trust, saída com tarefas em background). Só o sinal próprio do ask de permissão abre. Mutação: reintroduzir o ramo solto `Esc to cancel` ⇒ estes testes morrem
    for (const [qual, quem] of [
      ['trust-real', 'o diálogo de TRUST REAL (bytes do início do tty.raw 1794703689498, rodapé "Enter to confirm · Esc to cancel")'],
      ['saida-real', 'o diálogo de SAÍDA com tarefas em background REAL (mesmo rodapé)'],
      ['esc-solto', '"Esc to cancel" sozinho'],
    ]) {
      test(`sem-sinal-proprio-nao-abre-dialogo [${qual}]: ${quem}: nenhum Esc, nenhuma recusa, a fala é digitada`, (t) => {
        const r = rodar(t, { dialogo: qual });
        if (r === null) return;
        assert.doesNotMatch(r.teclas, /esc/, 'nenhum Esc antes da fala');
        assert.equal(r.fala, 'FALA DO ROTEIRO UMA VEZ SO');
        assert.doesNotMatch(r.exp, /PERMISSAO-RECUSADA|PERGUNTA-DE-PERMISSAO/);
        assert.deepEqual(permissaoDoExpLog(r.exp), { apareceu: false, recusadas: 0, naoFechou: false });
      });
    }
    // a `ler` REAL do a1.exp, direto (sem processo filho), em pedaços de vários tamanhos; o recusarImports vira contador (o real manda Enter a um spawn)
    const lerTcl = (d, pedacos) => {
      const arqs = pedacos.map((x, i) => { writeFileSync(join(d, `p${i}`), x); return join(d, `p${i}`); });
      const corpo = [`set imp 0`, `proc recusarImports {} { global imp; incr imp }`, `proc nota {s} { puts "NOTA $s" }`,
        `foreach a {${arqs.join(' ')}} { set f [open $a r]; fconfigure $f -translation binary -encoding utf-8; set txt [read $f]; close $f; ler $txt }`,
        `puts "ABERTO=$dialogo_aberto IMPORTS=$imp"`].join('\n');
      writeFileSync(join(d, 'ler.exp'), `set rundir ${d}\n${procsDoExp()}\n${corpo}\n`);
      const r = spawnSync('expect', ['-f', join(d, 'ler.exp')], { encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      return r.stdout;
    };
    const fatias = (txt, n) => { const o = []; for (let i = 0; i < txt.length; i += n) o.push(txt.slice(i, i + n)); return o; };
    for (const tam of [7, 100, 100000]) {
      test(`ler-direto [pedaços de ${tam}]: trust e saída reais ⇒ 0 detecções; o diálogo real de permissão ⇒ detecta`, (t) => {
        if (!temExpect(t)) return;
        const d = novo();
        assert.match(lerTcl(d, fatias(REAL.trustReal.bytes, tam)), /ABERTO=0/);
        assert.match(lerTcl(d, fatias(REAL.saidaTarefasReal.bytes, tam)), /ABERTO=0/);
        assert.match(lerTcl(d, fatias(REAL.trustReal.bytes + REAL.saidaTarefasReal.bytes, tam)), /ABERTO=0/);
        assert.match(lerTcl(d, fatias(REAL.comEscToCancel, tam)), /ABERTO=1/);
        // `Do you want to proceed` + rodapé "Esc to cancel", mas SEM as opções 1. Yes: não é o ask de permissão (mutação: aceitar `Esc to cancel` no lugar da opção)
        assert.match(lerTcl(d, fatias('Do you want to proceed?\n  Enter to confirm \u00b7 Esc to cancel\n', tam)), /ABERTO=0/);
        // o trust ANTES do ask real não esconde o ask
        assert.match(lerTcl(d, fatias(REAL.trustReal.bytes + REAL.semEscToCancel, tam)), /ABERTO=1/);
      });
    }
    // MINOR 2 (r2): o ramo de imports fazia `return` antes do teste de permissão
    test('imports-e-permissao-no-mesmo-pedaco: recusa os imports E abre o diálogo de permissão (nenhum dos dois se perde)', (t) => {
      if (!temExpect(t)) return;
      const d = novo();
      const imports = 'Allow external CLAUDE.md file imports?\n';
      const so = lerTcl(d, [imports + REAL.osc]);
      assert.match(so, /ABERTO=1 IMPORTS=1/);
      assert.match(lerTcl(d, [imports + REAL.semEscToCancel]), /ABERTO=1 IMPORTS=1/);
      assert.match(lerTcl(d, [imports]), /ABERTO=0 IMPORTS=1/, 'só os imports: não é permissão');
      assert.match(lerTcl(d, [REAL.osc, imports]), /ABERTO=1 IMPORTS=1/, 'permissão antes, imports depois, em leituras separadas');
    });
    test('dialogo-que-nao-fecha: a célula para com causa própria, a fala NÃO é digitada e a saída NÃO manda /exit nem Enter (usa a `sair` real)', (t) => {
      const r = rodar(t, { fecha: false }); if (r === null) return;
      assert.equal(r.status, 'DIALOGO_NAO_FECHOU');
      assert.match(r.exp, /PERMISSAO-NAO-FECHOU/);
      assert.match(r.exp, /SAIDA-SEM-TECLA/);
      assert.equal(r.fala, '', 'nenhuma fala chegou ao claude');
      assert.doesNotMatch(r.teclas, /FALA/, 'nem uma tecla da fala');
      assert.doesNotMatch(r.sends, new RegExp(`digitar ${sha256('FALA DO ROTEIRO UMA VEZ SO')}`));
      // MAJOR 2 (r1): com o foco em "Yes", `/exit` + Enter aprovaria o ask. Só Esc chegou ao diálogo
      const linhas = r.teclas.split('\n').slice(0, -1);
      assert.ok(linhas.length > 0 && linhas.every((l) => l === 'esc' || l === '\x1b'), `só Esc: ${JSON.stringify(linhas)}`);
      assert.doesNotMatch(r.sends, / exit$/m, 'não registra o envio de /exit');
      assert.match(r.sends, / kill$/m);
    });
    test('sem-dialogo (texto de conversa parecido, sem Esc to cancel nem aviso): nenhum Esc e a fala é digitada', (t) => {
      const r = rodar(t, { dialogo: 'nenhum' }); if (r === null) return;
      assert.doesNotMatch(r.teclas, /esc/, 'nenhum Esc avulso');
      assert.equal(r.fala, 'FALA DO ROTEIRO UMA VEZ SO');
      assert.doesNotMatch(r.exp, /PERMISSAO-RECUSADA/);
    });
    // o "claude" da saída: recebe a ÚLTIMA fala e DEPOIS abre o diálogo; tudo que chega é registrado (ESC ⇒ "esc", Enter ⇒ "ENTER"); com `fecha=false` o Esc reabre o diálogo
    const rodarSair = (t, { fecha }) => {
      if (!temExpect(t)) return null;
      const d = novo();
      const mostra = mostrar(d, 'real', 1);
      const filho = [
        `IFS= read -r l; echo "$l" >> ${d}/fala`,
        mostra,
        'echo MARCAPRONTO',
        `while IFS= read -rsn1 -t 40 k; do if [ -z "$k" ]; then echo ENTER >> ${d}/teclas; break; elif [ "$k" = "$(printf '\\033')" ]; then echo esc >> ${d}/teclas; ${fecha ? "printf 'tela limpa\\n'" : mostra}; else echo "$k" >> ${d}/teclas; fi; done`,
      ].join('\n');
      writeFileSync(join(d, 'sim.sh'), `#!/bin/bash\n${filho}\n`); chmodSync(join(d, 'sim.sh'), 0o755);
      rodarExp(d, `spawn ${d}/sim.sh\nlog_user 0\ndrenar 2\ndigitar ${sha256('ULTIMA FALA')} {ULTIMA FALA}\nate MARCAPRONTO\nocioso\ndrenar 20\nsair CONCLUIDO`);
      return saida(d);
    };
    test('saida-com-dialogo-aberto-depois-da-ultima-fala-que-NAO-fecha: nunca /exit nem Enter; kill; célula DIALOGO_NAO_FECHOU', (t) => {
      const r = rodarSair(t, { fecha: false }); if (r === null) return;
      assert.equal(r.fala, 'ULTIMA FALA');
      assert.equal(r.status, 'DIALOGO_NAO_FECHOU');
      const linhas = r.teclas.split('\n').slice(0, -1);
      assert.ok(linhas.length > 0 && linhas.every((l) => l === 'esc'), `só Esc, sem /exit nem Enter: ${JSON.stringify(linhas)}`);
      assert.match(r.exp, /SAIDA-SEM-TECLA/);
      assert.deepEqual(permissaoDoExpLog(r.exp).naoFechou, true);
    });
    test('saida-com-dialogo-aberto-depois-da-ultima-fala-que-FECHA: Esc primeiro, e só então /exit + Enter; status CONCLUIDO', (t) => {
      const r = rodarSair(t, { fecha: true }); if (r === null) return;
      assert.equal(r.status, 'CONCLUIDO');
      assert.deepEqual(r.teclas.split('\n').slice(0, -1), ['esc', '/', 'e', 'x', 'i', 't', 'ENTER'], 'a recusa (Esc) vem ANTES do /exit');
      assert.equal(permissaoDoExpLog(r.exp).recusadas, 1);
    });
    test('livre-de-dialogo-pos-turno: o diálogo aberto DURANTE o turno é recusado ANTES do snapshot (o snapshot não é tirado com o diálogo aberto)', (t) => {
      if (!temExpect(t)) return;
      const d = novo();
      const mostra = mostrar(d, 'real', 1);
      writeFileSync(join(d, 'falas.tsv'), `1\tDECISÃO\t${sha256('PRIMEIRA')}\tPRIMEIRA\n2\tDECISÃO\t${sha256('SEGUNDA')}\tSEGUNDA\n`);
      const filho = [
        `IFS= read -r l; echo "$l" >> ${d}/fala`,
        mostra,
        `IFS= read -rsn1 k; echo esc >> ${d}/teclas; printf 'tela limpa\\n'`,
        `IFS= read -r l; echo "$l" >> ${d}/fala`,
        `while IFS= read -rsn1 -t 40 k; do if [ -z "$k" ]; then break; fi; done`,
      ].join('\n');
      writeFileSync(join(d, 'sim.sh'), `#!/bin/bash\n${filho}\n`); chmodSync(join(d, 'sim.sh'), 0o755);
      // o snapshot de mentira registra se o diálogo estava aberto no instante dele (a global do a1.exp)
      rodarExp(d, `proc snapshot {n} { global dialogo_aberto rundir; set f [open $rundir/snap.log a]; puts $f "snap $n aberto=$dialogo_aberto"; close $f }\nset node x; set runner x; set repo $rundir\nspawn ${d}/sim.sh\nlog_user 0\ndrenar 2\n${falasDoExp()}`);
      const r = saida(d);
      assert.match(r.snap, /^snap 1 aberto=0\nsnap 2 aberto=0\n$/, `snapshots com o diálogo fechado: ${JSON.stringify(r.snap)}`);
      assert.equal(r.fala.split('\n').join('|'), 'PRIMEIRA|SEGUNDA');
      assert.equal(r.status, 'CONCLUIDO');
    });
  });
});

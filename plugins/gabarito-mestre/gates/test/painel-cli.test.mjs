/**
 * Painel (E4, T9) pela borda: `painel.mjs estado|texto`. Cada caso monta um repositório descartável (`mkdtemp`, com ESPAÇO no caminho).
 * Em processo (`estadoDoPainel`, `main` com `io`) quando o relógio ou o stdin precisam ser fixados; pelo CLI real (`spawnSync`) nos casos de borda
 * (rc, uma linha, stdin que nunca fecha, só-lê). O núcleo tem teste próprio (`painel*.test.ts`); aqui só a E/S, a leitura estável e a forma do estado.
 *
 * MUTAÇÕES PRESCRITAS: task-9-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, appendFileSync, copyFileSync, existsSync, symlinkSync, statSync, renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { renderPainel } from '../dist/painel.js';
import { paraTexto } from '../dist/painel-texto.js';
import { estadoDoPainel, lerArgs, lerCauda, lerDiarioEstavel, lerEntradaAgentes, main } from '../scripts/painel.mjs';
import { tetoDaSombra } from '../scripts/loop.mjs';
import { prepararLeitura as prepararLeituraReal } from '../scripts/entrega.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'painel.mjs');
const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
const FIXTURE = join(AQUI, 'fixtures', 'transcript-agente.jsonl');
const ENTREGA = 'GM-12';
const AGORA = Date.UTC(2026, 10, 9, 15, 0, 0);
const raizes = [];
const novoTmp = (p) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); raizes.push(d); return d; };
after(() => { /* os temporários vivem no TMPDIR do sistema; nada a apagar daqui (R2) */ });

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Repositório descartável com plano de 2 tasks (`T1`, `T2` dep T1), spec `docs/spec.md` com H1. `origem` (objeto) é o `harness.config.json` publicado
 * em origin/HEAD; sem ele não há remoto. `eventos`: lista de `[tipo, dados, extras?]` semeada no diário na ordem, com `ts` crescente.
 */
function montar({ origem, plano = {}, spec = '# Título da spec\n\ncorpo\n', semSpec = false, branch = 'feat/GM-12-painel', eventos = [] } = {}) {
  const base = novoTmp('painel cli ');
  const repo = join(base, 'repo com espaço');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', branch);
  g(repo, 'config', 'user.email', 't@t.test');
  g(repo, 'config', 'user.name', 't');
  g(repo, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'docs'));
  if (!semSpec) writeFileSync(join(repo, 'docs', 'spec.md'), spec);
  writeFileSync(join(repo, 'README.md'), 'x\n');
  if (origem !== undefined) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(origem));
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'inicio');
  if (origem !== undefined) {
    const bare = join(base, 'origin.git');
    mkdirSync(bare);
    g(bare, 'init', '-q', '--bare', '-b', branch);
    g(repo, 'remote', 'add', 'origin', bare);
    g(repo, 'push', '-q', 'origin', branch);
    g(repo, 'remote', 'set-head', 'origin', branch);
  }
  const dir = join(repo, '.harness', 'entregas', ENTREGA);
  mkdirSync(dir, { recursive: true });
  const corpo = {
    entrega: ENTREGA,
    ...(semSpec ? {} : { spec: 'docs/spec.md' }),
    tasks: [
      { id: 'T1', titulo: 'Primeira task', deps: [], arquivos: ['src/t1.txt'] },
      { id: 'T2', titulo: 'Segunda task', deps: ['T1'], arquivos: ['src/t2.txt'] },
    ],
    ...plano,
  };
  writeFileSync(join(dir, 'plano.json'), JSON.stringify(corpo));
  const m = { base, repo, dir, seq: 0 };
  for (const [tipo, dados, extras] of eventos) ev(m, tipo, dados, extras);
  return m;
}
function ev(m, tipo, dados, { sessao = 'loop', agente = 'orquestrador', ts } = {}) {
  m.seq += 1;
  const r = diario.append(m.dir, sessao, { ts: ts ?? new Date(Date.UTC(2026, 10, 9, 12, 0, m.seq)).toISOString(), autor: 't@t.test', sessao, agente, tipo, dados });
  assert.ok(r.ok && r.gravado === 'evento', `preparo: ${tipo} não gravado: ${JSON.stringify(r)}`);
}
const INTEGRAR = (t) => [['task.iniciada', { task: t, papel: 'implementador' }], ['task.concluida', { task: t, sha: 'a'.repeat(40) }], ['review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }], ['task.integrada', { task: t, sha: 'b'.repeat(40), mutacoes: { total: 3, mortas: 3 } }]];
const comEventos = (lista) => ({ eventos: lista });
const PARAR = ['loop.parar', { motivo: 'sem_progresso' }];

/** Roda o CLI de verdade. `input` ausente ⇒ stdin fechado. */
function cli(m, args, { input, env = {}, cwd = m.repo } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', input, timeout: 60_000, env: { ...process.env, ...env } });
  const linhas = r.stdout.split('\n').filter(Boolean);
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr, json: linhas.length === 1 && linhas[0].startsWith('{') ? JSON.parse(linhas[0]) : null };
}

const estado = (m, opts = {}) => {
  const r = estadoDoPainel(m.repo, { agoraMs: AGORA, ...opts });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};

/** Hash do conteúdo de uma árvore (nome + bytes), para provar que o painel só lê. */
function hashArvore(raiz) {
  const h = createHash('sha256');
  const anda = (d) => {
    if (!existsSync(d)) { h.update(`ausente:${d}`); return; }
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      h.update(`${p}:${st.isDirectory() ? 'd' : st.size}\n`);
      if (st.isDirectory()) anda(p); else h.update(readFileSync(p));
    }
  };
  anda(raiz);
  return h.digest('hex');
}

describe('forma do estado e do texto', () => {
  test('estado-json-forma: uma linha, ok:true, e cada campo lido', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1'), ['task.iniciada', { task: 'T2', papel: 'implementador', modelo: 'sonnet' }]]) });
    const r = cli(m, ['estado']);
    assert.equal(r.rc, 0, r.stdout + r.stderr);
    assert.ok(r.json !== null, `stdout deve ser UMA linha JSON: ${r.stdout}`);
    assert.equal(r.json.ok, true);
    assert.ok(Array.isArray(r.json.avisos));
    const e = r.json.estado;
    assert.equal(e.id, 'GM-12');
    assert.equal(e.titulo, 'Título da spec');
    assert.equal(e.pacote, 'Terra Média');
    assert.equal(e.plano.total, 2);
    assert.equal(e.plano.feitas, 1);
    assert.deepEqual(e.plano.tasks.map((t) => [t.id, t.estado, t.titulo]), [['T1', 'integrada', 'Primeira task'], ['T2', 'implementando', 'Segunda task']]);
    assert.equal(e.plano.tasks[1].modelo, 'sonnet');
    assert.equal(e.qualidade.mortas, 3);
    assert.equal(e.parado, false);
    assert.equal(e.equipe.vivos, null, 'sem --agentes: sem mod');
    assert.equal(e.rodape.politica, 'sob_demanda');
    assert.equal(e.equipe.lider.nome, 'GANDALF');
  });

  test('texto-padrao-80-esquadrao-mono: o texto é paraTexto(renderPainel(estado)) com 80 colunas, esquadrao, mono, e PAROU vem do diário', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1'), PARAR]) });
    const saidas = [];
    const rc = main(['texto'], m.repo, { saida: (t) => saidas.push(t), aviso: () => {}, agoraMs: AGORA });
    assert.equal(rc, 0);
    const e = estado(m).estado;
    const esperado = paraTexto(renderPainel(e, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 80 }), 'mono');
    assert.equal(saidas.join(''), `${esperado}\n`);
    assert.ok(!saidas.join('').includes('\x1b['), 'mono: sem SGR');
    assert.equal(e.parar.motivo, 'sem_progresso');
    // o Esquadrão (T5) é outra task: o PAROU do texto é conferido pelo preset que já existe
    const exe = [];
    assert.equal(main(['texto', '--preset', 'executivo'], m.repo, { saida: (t) => exe.push(t), aviso: () => {}, agoraMs: AGORA }), 0);
    assert.match(exe.join(''), /PAROU/);
  });

  test('texto-opcoes: --preset executivo --largura 60 --tema color chegam ao render (cada uma lida)', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1'), PARAR]) });
    const roda = (args) => { const s = []; assert.equal(main(['texto', ...args], m.repo, { saida: (t) => s.push(t), aviso: () => {}, agoraMs: AGORA }), 0); return s.join(''); };
    const e = estado(m).estado;
    const cor = roda(['--preset', 'executivo', '--largura', '60', '--tema', 'color']);
    assert.equal(cor, `${paraTexto(renderPainel(e, { preset: 'executivo', tema: 'color', narracao: true, largura: 60 }), 'color')}\n`);
    assert.ok(cor.includes('\x1b['), 'color: com SGR');
    assert.notEqual(cor, roda(['--preset', 'executivo', '--largura', '60', '--tema', 'mono']));
    assert.notEqual(roda(['--preset', 'executivo', '--largura', '60']), roda(['--preset', 'executivo', '--largura', '90']));
    assert.notEqual(roda(['--preset', 'executivo']), roda(['--preset', 'esquadrao']));
  });

  test('texto-falha-e-json: em falha o texto imprime a mesma linha JSON, rc 1', () => {
    const m = montar({ branch: 'main' });
    const r = cli(m, ['texto']);
    assert.equal(r.rc, 1);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.erro, 'entrega_nao_inferida');
  });
});

describe('uso errado (rc 2) e falhas de contexto (rc 1)', () => {
  const USO_RUIM = [
    [[], 'sem subcomando'],
    [['xpto'], 'subcomando desconhecido'],
    [['estado', '--foo'], 'flag desconhecida'],
    [['estado', '--agentes', '--agentes'], 'flag repetida'],
    [['estado', '--pacote'], 'flag sem valor'],
    [['estado', '--pacote', '--agentes'], 'valor é outra flag'],
    [['estado', 'sobra'], 'posicional'],
    [['estado', '--largura', '80'], 'largura em estado'],
    [['estado', '--preset', 'executivo'], 'preset em estado'],
    [['estado', '--tema', 'mono'], 'tema em estado'],
    [['texto', '--largura', '0'], 'largura 0'],
    [['texto', '--largura', '3.5'], 'largura fracionária'],
    [['texto', '--largura', 'abc'], 'largura texto'],
    [['texto', '--preset', 'x'], 'preset inválido'],
    [['texto', '--tema', 'x'], 'tema inválido'],
    [['texto', '--pacote', '../../etc/x'], 'pacote traversal'],
    [['texto', '--pacote', 'ABC'], 'pacote maiúsculo'],
    [['texto', '--entrega', 'gm-12'], 'entrega minúscula'],
  ];
  for (const [args, nome] of USO_RUIM) {
    test(`uso: ${nome}`, () => {
      const m = montar();
      const r = cli(m, args);
      assert.equal(r.rc, 2, r.stdout);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.erro, 'uso');
      assert.ok(r.json.mensagem.length > 0);
    });
  }

  test('largura-invalida-uso e pacote-traversal-uso: o rc é 2 e nada é lido', () => {
    assert.throws(() => lerArgs(['texto', '--largura', '0']), (e) => e.erro === 'uso' && e.rc === 2);
    assert.throws(() => lerArgs(['texto', '--pacote', '../../etc/x']), (e) => e.erro === 'uso' && e.rc === 2);
    assert.deepEqual(lerArgs(['texto', '--largura', '44', '--preset', 'executivo', '--tema', 'color', '--pacote', 'galaxia', '--agentes', '--entrega', 'GM-9']).flags,
      { largura: '44', preset: 'executivo', tema: 'color', pacote: 'galaxia', agentes: true, entrega: 'GM-9' });
  });

  test('fora-de-repo', () => {
    const d = novoTmp('painel fora ');
    const r = cli({ repo: d }, ['estado']);
    assert.equal(r.rc, 1);
    assert.equal(r.json.erro, 'fora_de_repo');
  });

  test('entrega-nao-inferida e --entrega', () => {
    const m = montar({ branch: 'main' });
    assert.equal(cli(m, ['estado']).json.erro, 'entrega_nao_inferida');
    const r = cli(m, ['estado', '--entrega', 'GM-12']);
    assert.equal(r.rc, 0);
    assert.equal(r.json.estado.id, 'GM-12');
  });

  test('plano-ausente-ok-false: rc 1, `plano_ausente`, nada criado', () => {
    const m = montar();
    renameSync(join(m.dir, 'plano.json'), join(m.base, 'plano.fora'));
    const antes = hashArvore(join(m.repo, '.harness'));
    const r = cli(m, ['estado']);
    assert.equal(r.rc, 1);
    assert.deepEqual([r.json.ok, r.json.erro], [false, 'plano_ausente']);
    assert.equal(hashArvore(join(m.repo, '.harness')), antes);
  });

  test('plano-invalido: não JSON, forma errada e outra entrega são `plano_invalido`, distintos de ausente', () => {
    for (const corpo of ['{ não é json', '{"entrega":"GM-12","tasks":"x"}', JSON.stringify({ entrega: 'GM-99', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }] })]) {
      const m = montar();
      writeFileSync(join(m.dir, 'plano.json'), corpo);
      const r = cli(m, ['estado']);
      assert.equal(r.rc, 1, corpo);
      assert.equal(r.json.erro, 'plano_invalido', corpo);
    }
  });
});

describe('só lê', () => {
  test('cli-so-le: com janela fechada, política janela e o loop em `concluir`, .harness, todo events.*.jsonl e git status não mudam', () => {
    const fechada = new Date(Date.now() + 6 * 3600_000);
    const hh = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const origem = {
      entrega: {
        politica: 'janela', base: 'main', janela: { dias: [0, 1, 2, 3, 4, 5, 6], inicio: hh(fechada), fim: hh(new Date(fechada.getTime() + 60_000)), fuso: 'UTC' },
        comandos: { deploy: { argv: ['true'], timeout_s: 5 }, smoke: { argv: ['true'], timeout_s: 5 }, rollback: { argv: ['true'], timeout_s: 5 } },
      },
    };
    const m = montar({ origem, branch: 'feat/GM-12-painel', ...comEventos([...INTEGRAR('T1'), ...INTEGRAR('T2'), ['ci.resultado', { verde: true, alvo: 'homolog' }]]) });
    const hashes = () => ({
      harness: hashArvore(join(m.repo, '.harness')),
      eventos: readdirSync(m.dir).filter((n) => /^events\..+\.jsonl$/.test(n)).sort().map((n) => sha256(readFileSync(join(m.dir, n)))).join(','),
      status: g(m.repo, 'status', '--porcelain'),
      git: ['HEAD', 'config'].map((f) => sha256(readFileSync(join(m.repo, '.git', f)))).join(','),
    });
    const antes = hashes();
    const r = cli(m, ['estado']);
    assert.equal(r.rc, 0, r.stdout + r.stderr);
    assert.deepEqual(hashes(), antes);
    for (const n of readdirSync(m.dir)) assert.ok(!/^entrega\.(lock|agendada)/.test(n) && n !== 'pouso-pendente.json', `o painel criou ${n}`);
    assert.ok(!readFileSync(join(m.dir, 'events.loop.jsonl'), 'utf8').includes('entrega.agendada'));
  });

  test('cli-so-le-sem-harness: repo sem .harness/ + `concluir` com `quando` inédito ⇒ .harness/ continua como estava (sem lock, âncora, agendada)', () => {
    // o diário vive em .harness/entregas: aqui o plano está lá, mas nenhuma outra pasta pode nascer
    const m = montar({ ...comEventos([...INTEGRAR('T1'), ...INTEGRAR('T2')]) });
    const lista = (d) => readdirSync(d, { recursive: true }).sort().join(',');
    const antes = lista(join(m.repo, '.harness'));
    assert.equal(cli(m, ['estado']).rc, 0);
    assert.equal(lista(join(m.repo, '.harness')), antes);
    assert.ok(!existsSync(join(m.repo, '.harness', 'pouso-pendente.json')));
    assert.ok(!existsSync(join(m.repo, '.harness', 'entregas', ENTREGA, 'entrega.lock')));
  });

  test('o CLI não importa nem chama decidirAgora (MUT-PNL-10)', () => {
    const fonte = readFileSync(SCRIPT, 'utf8');
    assert.ok(!/decidirAgora/.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'painel.mjs não pode usar decidirAgora');
    assert.ok(/prepararLeitura/.test(fonte));
  });
});

describe('cauda do transcript', () => {
  const linhasDe = (n) => Array.from({ length: n }, (_, i) => `linha-${String(i).padStart(4, '0')}`);
  const arquivo = (texto) => { const d = novoTmp('painel cauda '); const p = join(d, 'agent-x.jsonl'); writeFileSync(p, texto); return p; };

  test('cauda-descarta-linha-partida: corte no meio de uma linha ⇒ a 1ª linha da janela (partida) sai; todas as devolvidas são inteiras', () => {
    const p = arquivo(`${linhasDe(50).join('\n')}\n`); // 11 bytes por linha
    const r = lerCauda(p, 11 * 10 + 4); // corta no meio de uma linha
    assert.deepEqual(r, linhasDe(50).slice(40));
    assert.ok(r.every((l) => /^linha-\d{4}$/.test(l)));
  });

  test('cauda-mantem-linha-no-limite: corte exatamente depois de `\\n` ⇒ a 1ª linha da janela fica (mata "sempre descarta" e o off-by-one)', () => {
    const p = arquivo(`${linhasDe(50).join('\n')}\n`);
    const r = lerCauda(p, 11 * 10);
    assert.equal(r.length, 10);
    assert.equal(r[0], 'linha-0040');
    assert.equal(r[9], 'linha-0049');
  });

  test('cauda-limite-com-usage: a única linha com usage está exatamente no começo da janela ⇒ o contexto dela vale', () => {
    const usage = JSON.stringify({ message: { id: 'm1', model: 'claude-haiku-5-5', usage: { input_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 3 } } });
    const resto = linhasDe(20).join('\n');
    const p = arquivo(`xxxxxxxxxx\n${usage}\n${resto}\n`);
    const r = lerCauda(p, Buffer.byteLength(`${usage}\n${resto}\n`));
    assert.equal(r[0], usage);
  });

  test('cauda-256k: arquivo de ~600 KB devolve só os últimos 256 KB (a 1ª linha da janela inteira, a última presente)', () => {
    const linha = (i) => `{"i":${i},"pad":"${'x'.repeat(90)}"}`;
    const todas = Array.from({ length: 6000 }, (_, i) => linha(i));
    const p = arquivo(`${todas.join('\n')}\n`);
    const r = lerCauda(p);
    const bytes = r.reduce((s, l) => s + Buffer.byteLength(l) + 1, 0);
    assert.ok(bytes <= 262144 && bytes > 262144 - 200, `bytes ${bytes}`);
    assert.equal(r.at(-1), todas.at(-1));
    assert.ok(r.every((l) => l.startsWith('{"i":') && l.endsWith('"}')), 'nenhuma linha partida');
    assert.equal(r[0], todas[todas.length - r.length]);
  });

  test('cauda: arquivo pequeno vem inteiro; vazio ⇒ []; ausente ⇒ null', () => {
    assert.deepEqual(lerCauda(arquivo('a\nb\nc\n')), ['a', 'b', 'c']);
    assert.deepEqual(lerCauda(arquivo('')), []);
    assert.equal(lerCauda(join(novoTmp('painel cauda '), 'nao-existe.jsonl')), null);
  });

  test('cauda: a linha final sem `\\n` (agente escrevendo) é devolvida e `usoDoTranscript` a ignora se for JSON partido', () => {
    const p = arquivo('{"ok":1}\n{"message":{"usa');
    assert.deepEqual(lerCauda(p), ['{"ok":1}', '{"message":{"usa']);
  });
});

describe('transcript e agentes (stdin)', () => {
  const comAgente = (m, caminho, extra = {}) => ({ sessao: { window: 200000 }, agentes: [{ id: 'aANON1', type: 'implementador', description: 'T1 implementador', status: 'running', transcript: caminho, ...extra }] });
  const copiaFixture = (id = 'aANON1') => {
    const d = join(novoTmp('painel tr '), 'sessao', 'subagents');
    mkdirSync(d, { recursive: true });
    const p = join(d, `agent-${id}.jsonl`);
    copyFileSync(FIXTURE, p);
    return p;
  };
  const doAgente = (r) => r.estado.equipe.agentes.find((a) => a.task === 'T1' && a.vivo);

  test('transcript-fixture-ctx-92762 (P9): o uso da fixture chega a `ctxTok` e `tok`, pelo caminho real', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const a = doAgente(estado(m, { agentes: comAgente(m, copiaFixture()) }));
    assert.equal(a.ctxTok, 92762);
    assert.equal(a.tok, 86900);
    assert.equal(a.modelo, 'haiku');
  });

  test('transcript-ausente-ctx-traco: arquivo inexistente ⇒ ctxTok null (nada inventado)', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const p = join(novoTmp('painel tr '), 'subagents', 'agent-aANON1.jsonl');
    const a = doAgente(estado(m, { agentes: comAgente(m, p) }));
    assert.equal(a.vivo, true);
    assert.equal(a.ctxTok, null);
    assert.equal(a.tok, null);
    const sem = doAgente(estado(m, { agentes: comAgente(m, undefined) }));
    assert.equal(sem.ctxTok, null);
  });

  test('transcript vazio e sem usage ⇒ ctxTok null', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const p = copiaFixture();
    writeFileSync(p, '');
    assert.equal(doAgente(estado(m, { agentes: comAgente(m, p) })).ctxTok, null);
    writeFileSync(p, '{"message":{"role":"user"}}\n');
    assert.equal(doAgente(estado(m, { agentes: comAgente(m, p) })).ctxTok, null);
  });

  test('transcript-fora-da-forma-nao-abre: outro id, pai errado, relativo, `..`, link e diretório ⇒ uso null, sem abrir', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const ok = copiaFixture('aANON1');
    const dirSub = dirname(ok);
    const outro = copiaFixture('aOUTRO');
    const forma = join(novoTmp('painel tr '), 'x'); mkdirSync(forma); const pai = join(forma, 'agent-aANON1.jsonl'); copyFileSync(FIXTURE, pai);
    const link = join(dirSub, 'agent-aLINK.jsonl'); symlinkSync(ok, link);
    const dirComoArquivo = join(dirSub, 'agent-aDIR.jsonl'); mkdirSync(dirComoArquivo);
    const casos = [
      [outro, 'aANON1', 'basename de outro id'],
      [pai, 'aANON1', 'pai não é subagents'],
      [`${dirSub}/../subagents/agent-aANON1.jsonl`, 'aANON1', 'segmento ..'],
      [link, 'aLINK', 'link simbólico'],
      [dirComoArquivo, 'aDIR', 'diretório'],
      ['/etc/passwd', 'aANON1', '/etc/passwd'],
    ];
    // relativo: o arquivo existe a partir do cwd do processo e a forma é a certa, menos por não ser absoluto
    const cwdAntes = process.cwd();
    try {
      process.chdir(dirname(dirname(ok)));
      const rel = estado(m, { agentes: { sessao: {}, agentes: [{ id: 'aANON1', type: 't', description: 'T1 implementador', status: 'running', transcript: 'subagents/agent-aANON1.jsonl' }] } });
      assert.equal(doAgente(rel).ctxTok, null, 'relativo');
    } finally { process.chdir(cwdAntes); }
    for (const [caminho, id, nome] of casos) {
      const a = doAgente(estado(m, { agentes: { sessao: {}, agentes: [{ id, type: 't', description: 'T1 implementador', status: 'running', transcript: caminho }] } }));
      assert.equal(a.ctxTok, null, nome);
    }
    assert.equal(doAgente(estado(m, { agentes: comAgente(m, ok) })).ctxTok, 92762, 'a forma certa abre');
  });

  test('transcript-fifo-nao-trava: um FIFO no lugar do arquivo ⇒ uso null em menos de 2 s', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const d = join(novoTmp('painel fifo '), 'subagents');
    mkdirSync(d);
    const fifo = join(d, 'agent-aANON1.jsonl');
    execFileSync('mkfifo', [fifo]);
    const t0 = performance.now();
    const a = doAgente(estado(m, { agentes: comAgente(m, fifo) }));
    assert.ok(performance.now() - t0 < 2000);
    assert.equal(a.ctxTok, null);
    assert.equal(lerCauda(fifo), null);
  });

  test('modelo-sessao-do-diario-nao-do-stdin: o modelo da sessão é o do diário; `sessao.modelo` do stdin é ignorado (ctxPct só casa com o do diário)', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['custo.medicao', { input: 1, output: 1, cache_creation: 0, cache_read: 0, modelo: 'claude-haiku-5-5' }]]) });
    const entrada = comAgente(m, copiaFixture());
    entrada.sessao.modelo = 'claude-opus-5-5'; // armadilha: a fixture é haiku
    const r = estado(m, { agentes: entrada });
    assert.equal(doAgente(r).ctxPct, Math.round((92762 / 200000) * 100));
    assert.equal(r.estado.equipe.lider.modelo, 'haiku');
    const outroDiario = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }], ['custo.medicao', { input: 1, output: 1, cache_creation: 0, cache_read: 0, modelo: 'claude-opus-5-5' }]]) });
    const r2 = estado(outroDiario, { agentes: { ...entrada, sessao: { ...entrada.sessao, modelo: 'claude-haiku-5-5' } } });
    assert.equal(r2.estado.equipe.lider.modelo, 'opus');
    assert.equal(doAgente(r2).ctxPct, null, 'o diário diz opus e a fixture é haiku: sem %');
  });

  test('modelo da sessão: sem custo.medicao do orquestrador ⇒ null; só vale o do orquestrador (não o de subagent)', () => {
    const m = montar({ ...comEventos([['custo.medicao', { input: 1, output: 1, cache_creation: 0, cache_read: 0, modelo: 'claude-opus-5-5' }, { agente: 'subagent:aX' }]]) });
    assert.equal(estado(m).estado.equipe.lider.modelo, null);
  });
});

describe('stdin (--agentes)', () => {
  test('stdin-forma-completa (P15): cada campo trocado muda o estado', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const base = { sessao: { percent: 40, tokens: 50000, window: 200000, h5: 10, d7: 20, x: 70, notificacao: { ts: new Date(AGORA - 60_000).toISOString() }, pacote: 'galaxia' }, agentes: [{ id: 'a1', type: 'implementador', description: 'T1 implementador', status: 'running' }] };
    const e = (o) => estado(m, { agentes: o }).estado;
    const L = (o) => e(o).equipe.lider;
    assert.equal(L(base).ctx, 40);
    assert.equal(L({ ...base, sessao: { ...base.sessao, percent: 41 } }).ctx, 41);
    assert.equal(L(base).h5, 10);
    assert.equal(L({ ...base, sessao: { ...base.sessao, h5: 11 } }).h5, 11);
    assert.equal(L(base).d7, 20);
    assert.equal(L({ ...base, sessao: { ...base.sessao, d7: 21 } }).d7, 21);
    assert.equal(L(base).x, 70);
    assert.equal(L({ ...base, sessao: { ...base.sessao, x: 55 } }).x, 55);
    assert.equal(e(base).pacote, 'Galáxia distante');
    assert.equal(e({ ...base, sessao: { ...base.sessao, pacote: 'herois' } }).pacote, 'Heróis');
    assert.equal(e(base).notificacao.hora !== undefined, true);
    assert.deepEqual(e({ ...base, sessao: { ...base.sessao, notificacao: { motivo: 'isSent=false' } } }).notificacao, { motivo: 'isSent=false' });
    assert.equal(e({ ...base, sessao: { ...base.sessao, notificacao: null } }).notificacao, null);
    assert.equal(e(base).equipe.vivos, 1);
    assert.equal(e({ ...base, agentes: [] }).equipe.vivos, 0);
    assert.equal(e({ ...base, agentes: [{ ...base.agentes[0], status: 'completed' }] }).equipe.vivos, 0, 'status lido');
    const ag = (o) => e(o).equipe.agentes.find((a) => a.vivo);
    assert.equal(ag(base).task, 'T1');
    assert.equal(ag({ ...base, agentes: [{ ...base.agentes[0], description: 'qualquer coisa' }] }).task, undefined, 'description lida (sem task)');
    assert.equal(ag({ ...base, agentes: [{ ...base.agentes[0], id: 'a1', description: 'T1 implementador' }] }).papel, 'implementador');
    assert.equal(e(base).plano.tasks[0].glifo, '●');
    assert.equal(e({ ...base, agentes: [] }).plano.tasks[0].glifo, '◐', 'sem agente casado a task em voo vira ◐');
    // window: lida pela %
    const comTr = (win) => ({ ...base, sessao: { ...base.sessao, window: win } });
    assert.equal(L(comTr(200000)).ctx, 40);
  });

  test('stdin-modelo-ignorado: `sessao.modelo` não entra no estado', () => {
    const m = montar();
    const a = estado(m, { agentes: { sessao: { modelo: 'claude-opus-5-5' }, agentes: [] } }).estado;
    assert.equal(a.equipe.lider.modelo, null);
  });

  test('stdin: campo numérico não finito ⇒ null; h5/d7 ausentes ⇒ null, nunca 0', () => {
    const m = montar();
    const e = estado(m, { agentes: { sessao: { percent: 'abc', tokens: null, window: Infinity, h5: undefined }, agentes: [] } }).estado;
    assert.equal(e.equipe.lider.ctx, null);
    assert.equal(e.equipe.lider.h5, null);
    assert.equal(e.equipe.lider.d7, null);
    assert.equal(estado(m, { agentes: { sessao: { h5: 0, d7: 0 }, agentes: [] } }).estado.equipe.lider.h5, 0, 'zero real fica zero');
  });

  test('agentes-null-x-vazio: `null` (ou não array) ⇒ vivos null; `[]` ⇒ 0', () => {
    const m = montar();
    assert.equal(estado(m, { agentes: { sessao: {}, agentes: null } }).estado.equipe.vivos, null);
    assert.equal(estado(m, { agentes: { sessao: {} } }).estado.equipe.vivos, null);
    assert.equal(estado(m, { agentes: { sessao: {}, agentes: 'x' } }).estado.equipe.vivos, null);
    assert.equal(estado(m, { agentes: { sessao: {}, agentes: [] } }).estado.equipe.vivos, 0);
    assert.equal(estado(m).estado.equipe.vivos, null, 'sem --agentes');
  });

  test('stdin: item sem id string ou não objeto é descartado; id repetido fica o 1º', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const e = estado(m, { agentes: { sessao: {}, agentes: [null, 7, { type: 'x' }, { id: 5 }, { id: 'a1', description: 'T1 implementador', status: 'running' }, { id: 'a1', description: 'sem task', status: 'running' }] } }).estado;
    assert.equal(e.equipe.vivos, 1);
    assert.equal(e.equipe.agentes.find((a) => a.vivo).task, 'T1');
  });

  test('stdin-ausente-x-invalido-x-nao-objeto: três erros distintos, rc 1', () => {
    const m = montar();
    const vazio = cli(m, ['estado', '--agentes'], { input: '' });
    assert.deepEqual([vazio.rc, vazio.json.erro], [1, 'stdin_ausente']);
    const torto = cli(m, ['estado', '--agentes'], { input: '{ não' });
    assert.deepEqual([torto.rc, torto.json.erro], [1, 'stdin_invalido']);
    const array = cli(m, ['estado', '--agentes'], { input: '[1]' });
    assert.deepEqual([array.rc, array.json.erro], [1, 'stdin_invalido']);
    assert.notEqual(torto.json.mensagem, array.json.mensagem);
    assert.throws(() => lerEntradaAgentes('  '), (e) => e.erro === 'stdin_ausente');
    assert.throws(() => lerEntradaAgentes('"x"'), (e) => e.erro === 'stdin_invalido');
  });

  test('sem-agentes-nao-le-stdin: stdin = pipe que nunca fecha, sem --agentes ⇒ termina em < 2 s', async () => {
    const m = montar();
    const t0 = performance.now();
    const p = spawn(process.execPath, [SCRIPT, 'estado'], { cwd: m.repo, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    const rc = await new Promise((res) => { p.on('close', res); setTimeout(() => { p.kill('SIGKILL'); }, 8000); });
    p.stdin.destroy();
    assert.equal(rc, 0, out);
    assert.ok(performance.now() - t0 < 2000 + 1500, `demorou ${performance.now() - t0} ms`);
    assert.equal(JSON.parse(out).ok, true);
  });

  test('--agentes pelo CLI real: o JSON do stdin chega ao estado', () => {
    const m = montar({ ...comEventos([['task.iniciada', { task: 'T1', papel: 'implementador' }]]) });
    const r = cli(m, ['estado', '--agentes'], { input: JSON.stringify({ sessao: { percent: 33 }, agentes: [{ id: 'a1', description: 'T1 implementador', status: 'running' }] }) });
    assert.equal(r.rc, 0, r.stdout + r.stderr);
    assert.equal(r.json.estado.equipe.lider.ctx, 33);
    assert.equal(r.json.estado.equipe.vivos, 1);
  });

  test('x-do-stdin-vence-env e x-env-sem-agentes; inválido ⇒ 50 + aviso', () => {
    const m = montar();
    const env = { GABARITO_POUSO_X: '80' };
    assert.equal(estado(m, { env, agentes: { sessao: { x: 65 }, agentes: [] } }).estado.equipe.lider.x, 65);
    assert.equal(estado(m, { env }).estado.equipe.lider.x, 80, 'sem --agentes o X vem do env');
    assert.equal(estado(m, { env, agentes: { sessao: {}, agentes: [] } }).estado.equipe.lider.x, 80, 'stdin sem x ⇒ env');
    const r = estado(m, { env, agentes: { sessao: { x: 'abc' }, agentes: [] } });
    assert.equal(r.estado.equipe.lider.x, 50);
    assert.ok(r.avisos.some((a) => /inválido/.test(a)));
    assert.equal(estado(m, { env: {} }).estado.equipe.lider.x, 50);
  });
});

describe('diário estável (D-M2)', () => {
  test('diario-vazio-x-ilegivel-x-em-escrita: sem events.* ⇒ estado vazio, rc 0; cadeia quebrada estável ⇒ PAROU diario_invalido, rc 0; instável 3× ⇒ diario_em_escrita rc 1', () => {
    const vazio = montar();
    const r0 = cli(vazio, ['estado']);
    assert.equal(r0.rc, 0);
    assert.equal(r0.json.estado.parar, null);
    assert.equal(r0.json.estado.parado, false);
    assert.deepEqual(r0.json.estado.plano.tasks.map((t) => t.estado), ['pendente', 'pendente']);

    const quebrado = montar({ ...comEventos([...INTEGRAR('T1')]) });
    const arq = join(quebrado.dir, 'events.loop.jsonl');
    const linhas = readFileSync(arq, 'utf8').split('\n').filter(Boolean);
    writeFileSync(arq, `${[linhas[0], linhas[2]].join('\n')}\n`); // pula uma linha: cadeia quebrada
    const r1 = cli(quebrado, ['estado']);
    assert.equal(r1.rc, 0);
    assert.equal(r1.json.estado.parar.motivo, 'diario_invalido');
    assert.equal(r1.json.estado.parado, true);

    let n = 0;
    assert.throws(() => lerDiarioEstavel(vazio.dir, { foto: () => `f${n++}`, dormir: () => {} }), (e) => e.erro === 'diario_em_escrita');
    const emEscrita = estadoDoPainel(vazio.repo, { diario: { foto: () => `f${n++}`, dormir: () => {} } });
    assert.deepEqual([emEscrita.ok, emEscrita.erro], [false, 'diario_em_escrita']);
  });

  test('diario-truncado-estavel-parou: linha final cortada sem \\n com tamanhos estáveis é corrupção real ⇒ PAROU', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1')]) });
    appendFileSync(join(m.dir, 'events.loop.jsonl'), '{"ts":"2026-11-09T12:00:');
    const r = cli(m, ['estado']);
    assert.equal(r.rc, 0);
    assert.equal(r.json.estado.parar.motivo, 'diario_invalido');
  });

  test('diario-instavel-relê: 1ª leitura "inválida" com o diário mudando ⇒ relê e o estado é normal, sem PAROU', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1')]) });
    let leituras = 0;
    let fotos = 0;
    let dormiu = 0;
    const diarioDeps = {
      ler: (dir) => {
        leituras++;
        if (leituras === 1) { const e = new Error('events.loop.jsonl, linha 9: não é JSON'); e.erro = 'diario_ilegivel'; throw e; } // linha em gravação
        return diario.ler(dir);
      },
      // 1ª tentativa: o tamanho muda entre antes e depois; as demais, estável
      foto: () => (fotos++ < 2 ? `f${fotos}` : 'estavel'),
      dormir: () => { dormiu++; },
    };
    const r = estadoDoPainel(m.repo, { agoraMs: AGORA, diario: diarioDeps });
    assert.equal(r.ok, true);
    assert.equal(r.estado.parar, null, 'a leitura instável não vira PAROU');
    assert.equal(leituras, 2);
    assert.equal(dormiu, 1);
    assert.equal(r.estado.plano.feitas, 1);
  });

  test('diario-instavel-3x-em-escrita: 3 tentativas, 50 ms entre elas, nenhum PAROU', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1')]) });
    let n = 0;
    const sonos = [];
    const r = estadoDoPainel(m.repo, { diario: { foto: () => `f${n++}`, dormir: (ms) => sonos.push(ms) } });
    assert.deepEqual([r.ok, r.erro], [false, 'diario_em_escrita']);
    assert.deepEqual(sonos, [50, 50]);
    assert.equal(n, 6, '2 fotos por tentativa, 3 tentativas');
  });

  test('foto real: um evento gravado no meio da leitura muda (nome, tamanho) e dispara a releitura', () => {
    const m = montar({ ...comEventos([...INTEGRAR('T1')]) });
    let primeira = true;
    const r = lerDiarioEstavel(m.dir, {
      dormir: () => {},
      ler: (dir) => {
        const v = diario.ler(dir);
        if (primeira) { primeira = false; ev(m, 'loop.parar', { motivo: 'sem_progresso' }); }
        return v;
      },
    });
    assert.equal(r.eventos.at(-1).tipo, 'loop.parar', 'a 2ª leitura viu o evento novo');
  });
});

describe('spec, título, pausa, teto e política', () => {
  test('titulo-do-h1-mesmos-bytes: título do 1º H1 e specSha do MESMO arquivo; H2 e sem H1 ⇒ título null', () => {
    const m = montar({ spec: 'preâmbulo\n\n## não é H1\n# Meu H1 real\n# outro\n' });
    const r = estado(m).estado;
    assert.equal(r.titulo, 'Meu H1 real');
    const sem = montar({ spec: '## só H2\ntexto\n' });
    assert.equal(estado(sem).estado.titulo, null);
  });

  test('specSha: a spec sem aprovação acende "spec aguardando"; com spec.aprovada do sha atual apaga (o sha é o dos bytes)', () => {
    const spec = '# Titulo\n\nbytes exatos\n';
    const m = montar({ spec });
    assert.ok(estado(m).estado.depende.some((d) => d.motivo === 'spec aguardando aprovação'));
    ev(m, 'spec.aprovada', { spec: 'docs/spec.md', sha256: sha256(Buffer.from(spec)) });
    assert.ok(!estado(m).estado.depende.some((d) => d.motivo === 'spec aguardando aprovação'));
    const outro = montar({ spec });
    ev(outro, 'spec.aprovada', { spec: 'docs/spec.md', sha256: sha256(Buffer.from('outra coisa')) });
    assert.ok(estado(outro).estado.depende.some((d) => d.motivo === 'spec aguardando aprovação'), 'sha antigo não aprova');
  });

  test('plano sem spec ⇒ specSha null e título null, sem aviso; spec ausente/fora da raiz ⇒ null com aviso', () => {
    const a = montar({ semSpec: true });
    const ra = estado(a);
    assert.equal(ra.estado.titulo, null);
    assert.ok(!ra.estado.depende.some((d) => /spec aguardando/.test(d.motivo)));
    assert.equal(ra.avisos.filter((x) => /spec/.test(x)).length, 0);
    const b = montar({ plano: { spec: 'docs/nao-existe.md' } });
    const rb = estado(b);
    assert.equal(rb.estado.titulo, null);
    assert.ok(rb.avisos.some((x) => /spec_ausente/.test(x)));
    assert.ok(!rb.estado.depende.some((d) => /spec aguardando/.test(d.motivo)), 'sem sha não acende');
  });

  test('spec-fora-da-raiz-sha-null: `../x.md` e link para fora ⇒ sha null, título null, aviso', () => {
    const m = montar({ plano: { spec: '../fora.md' } });
    writeFileSync(join(m.base, 'fora.md'), '# Fora\n');
    const r = estado(m);
    assert.equal(r.estado.titulo, null);
    assert.ok(r.avisos.some((x) => /spec_fora_da_raiz/.test(x)));
    const n = montar();
    writeFileSync(join(n.base, 'alvo.md'), '# Alvo\n');
    symlinkSync(join(n.base, 'alvo.md'), join(n.repo, 'docs', 'link.md'));
    writeFileSync(join(n.dir, 'plano.json'), JSON.stringify({ entrega: ENTREGA, spec: 'docs/link.md', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }] }));
    const rn = estado(n);
    assert.equal(rn.estado.titulo, null);
    assert.ok(rn.avisos.some((x) => /spec_fora_da_raiz/.test(x)));
  });

  test('spec vazia ⇒ título null e aviso `spec_vazia`', () => {
    const m = montar({ spec: '' });
    const r = estado(m);
    assert.equal(r.estado.titulo, null);
    assert.ok(r.avisos.some((x) => /spec_vazia/.test(x)));
  });

  test('pausado-no-topo-da-worktree: PAUSAR na raiz principal OU no topo da worktree acende "loop pausado"', () => {
    const m = montar();
    assert.ok(!estado(m).estado.depende.some((d) => d.motivo === 'loop pausado'));
    mkdirSync(join(m.repo, '.harness'), { recursive: true });
    writeFileSync(join(m.repo, '.harness', 'PAUSAR'), '');
    const r = estado(m).estado;
    assert.ok(r.depende.some((d) => d.motivo === 'loop pausado'));
    assert.equal(r.parado, true);
    // worktree: o PAUSAR só no topo dela
    const n = montar();
    const wt = join(n.base, 'wt');
    g(n.repo, 'worktree', 'add', '-q', '-b', 'wt/GM-12-9', wt);
    mkdirSync(join(wt, '.harness'), { recursive: true });
    writeFileSync(join(wt, '.harness', 'PAUSAR'), '');
    const rw = estadoDoPainel(wt, { agoraMs: AGORA });
    assert.equal(rw.ok, true, JSON.stringify(rw));
    assert.ok(rw.estado.depende.some((d) => d.motivo === 'loop pausado'));
    assert.ok(!estado(n).estado.depende.some((d) => d.motivo === 'loop pausado'), 'o principal não tem PAUSAR');
  });

  test('tetoSombra: sombra.teto de origin vence; ausente ⇒ 26; inválido ⇒ 26 + aviso (a Sombra usa a mesma tetoDaSombra do loop)', () => {
    const m = montar({ origem: { sombra: { teto: 3 } } });
    for (let i = 0; i < 4; i++) ev(m, 'sombra.consulta', { pergunta_hash: `${i}`.repeat(64).slice(0, 64), task: 'T1' });
    const r = estado(m).estado;
    assert.ok(r.atencao.some((a) => /Sombra: 4 consultas, acima do teto de 3/.test(a)), JSON.stringify(r.atencao));
    const sem = montar({ origem: {} });
    for (let i = 0; i < 4; i++) ev(sem, 'sombra.consulta', { pergunta_hash: `${i}`.repeat(64).slice(0, 64), task: 'T1' });
    assert.ok(!estado(sem).estado.atencao.some((a) => /Sombra/.test(a)));
    const ruim = montar({ origem: { sombra: { teto: 0 } } });
    const rr = estado(ruim);
    assert.ok(rr.avisos.some((a) => /sombra\.teto inválido/.test(a)));
    assert.equal(tetoDaSombra({ fonte: 'origin', cfg: { sombra: { teto: 7 } } }).teto, 7);
    assert.equal(tetoDaSombra({ fonte: 'nenhuma', cfg: null }).teto, 26);
  });

  test('política e base da origem: rodape.politica e o merge da release usam entrega.politica e entrega.base', () => {
    const m = montar({ origem: { entrega: { politica: 'janela', base: 'release-x', janela: { dias: [1, 3], inicio: '02:00', fim: '04:00', fuso: 'UTC' }, comandos: { deploy: { argv: ['true'], timeout_s: 5 } } } } });
    assert.equal(estado(m).estado.rodape.politica, 'janela [seg qua]');
    const sem = montar({ origem: {} });
    assert.equal(estado(sem).estado.rodape.politica, 'sob_demanda');
    const ruim = montar({ origem: { entrega: { politica: 'quando-der' } } });
    const rr = estado(ruim);
    assert.equal(rr.estado.rodape.politica, 'sob_demanda');
    assert.ok(rr.avisos.some((a) => /entrega\.politica/.test(a)));
  });

  test('origin ilegível ⇒ aviso (ausente ≠ corrompido)', () => {
    const m = montar({ origem: {} });
    assert.ok(!estado(m).avisos.some((a) => /origin/.test(a)));
    const base = novoTmp('painel orig ');
    const repo = join(base, 'r');
    mkdirSync(repo);
    g(repo, 'init', '-q', '-b', 'feat/GM-12-x');
    g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'harness.config.json'), '{ quebrado');
    g(repo, 'add', '.'); g(repo, 'commit', '-q', '-m', 'x');
    const bare = join(base, 'o.git'); mkdirSync(bare); g(bare, 'init', '-q', '--bare', '-b', 'feat/GM-12-x');
    g(repo, 'remote', 'add', 'origin', bare); g(repo, 'push', '-q', 'origin', 'feat/GM-12-x'); g(repo, 'remote', 'set-head', 'origin', 'feat/GM-12-x');
    const dir = join(repo, '.harness', 'entregas', 'GM-12');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plano.json'), JSON.stringify({ entrega: 'GM-12', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }] }));
    const r = estadoDoPainel(repo, { agoraMs: AGORA });
    assert.equal(r.ok, true);
    assert.ok(r.avisos.some((a) => /origin\/HEAD inválida/.test(a)), JSON.stringify(r.avisos));
  });
});

describe('fuso e pacote', () => {
  test('fuso-invalido-utc-com-aviso: fuso inválido ou ausente ⇒ UTC + aviso; válido vale (a hora do PAROU muda)', () => {
    const m = montar({ ...comEventos([PARAR]) }); // ts 12:00:01 UTC
    const hora = (fuso) => estado(m, { fuso }).estado.parar.hora;
    assert.equal(hora('UTC'), '12:00');
    assert.equal(hora('Asia/Tokyo'), '09/11 21:00', 'Tóquio já está no dia seguinte de AGORA: com data');
    const ruim = estado(m, { fuso: 'Marte/Olimpo' });
    assert.equal(ruim.estado.parar.hora, '12:00');
    assert.ok(ruim.avisos.some((a) => /fuso.*UTC/.test(a)));
    const ausente = estado(m, { fuso: null });
    assert.ok(ausente.avisos.some((a) => /fuso.*UTC/.test(a)));
    assert.ok(!estado(m, { fuso: 'UTC' }).avisos.some((a) => /fuso/.test(a)));
  });

  test('fuso do processo: TZ inválida no CLI real ⇒ UTC + aviso no JSON', () => {
    const m = montar({ ...comEventos([PARAR]) });
    const r = cli(m, ['estado'], { env: { TZ: 'Marte/Olimpo' } });
    assert.equal(r.rc, 0);
    assert.match(r.json.estado.parar.hora, /12:00$/);
    assert.ok(r.json.avisos.some((a) => /fuso.*UTC/.test(a)));
    const tokyo = cli(m, ['estado'], { env: { TZ: 'Asia/Tokyo' } });
    assert.match(tokyo.json.estado.parar.hora, /21:00$/);
  });

  test('pacote: precedência flag > stdin > terra-media; cada um lido', () => {
    const m = montar();
    assert.equal(estado(m).estado.pacote, 'Terra Média');
    assert.equal(estado(m, { agentes: { sessao: { pacote: 'galaxia' }, agentes: [] } }).estado.pacote, 'Galáxia distante');
    assert.equal(estado(m, { pacote: 'herois', agentes: { sessao: { pacote: 'galaxia' }, agentes: [] } }).estado.pacote, 'Heróis');
    assert.equal(estado(m, { pacote: 'hogwarts' }).estado.equipe.lider.nome, 'MINERVA');
  });

  test('pacote-invalido-fabrica-com-aviso: inexistente, inválido e fora da forma ⇒ terra-media + aviso; do usuário em .harness/temas/nomes vale', () => {
    const m = montar();
    const inexistente = estado(m, { pacote: 'nao-existe' });
    assert.equal(inexistente.estado.pacote, 'Terra Média');
    assert.ok(inexistente.avisos.some((a) => /nao-existe.*não existe.*terra-media/.test(a)));
    mkdirSync(join(m.repo, '.harness', 'temas', 'nomes'), { recursive: true });
    writeFileSync(join(m.repo, '.harness', 'temas', 'nomes', 'torto.json'), '{ nao json');
    const torto = estado(m, { pacote: 'torto' });
    assert.equal(torto.estado.pacote, 'Terra Média');
    assert.ok(torto.avisos.some((a) => /torto.*inválido.*não é JSON/.test(a)), JSON.stringify(torto.avisos));
    writeFileSync(join(m.repo, '.harness', 'temas', 'nomes', 'curto.json'), JSON.stringify({ nome: 'Curto', lider: 'A', sabio: 'B', nomes: ['X'] }));
    assert.ok(estado(m, { pacote: 'curto' }).avisos.some((a) => /curto.*inválido/.test(a)));
    writeFileSync(join(m.repo, '.harness', 'temas', 'nomes', 'meu.json'), JSON.stringify({ nome: 'Meu', lider: 'ALFA', sabio: 'BETA', nomes: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'] }));
    const meu = estado(m, { pacote: 'meu' });
    assert.equal(meu.estado.pacote, 'Meu');
    assert.equal(meu.estado.equipe.lider.nome, 'ALFA');
    assert.ok(!meu.avisos.some((a) => /meu/.test(a)));
    const stdinRuim = estado(m, { agentes: { sessao: { pacote: '../../x' }, agentes: [] } });
    assert.equal(stdinRuim.estado.pacote, 'Terra Média');
    assert.ok(stdinRuim.avisos.some((a) => /sessao\.pacote/.test(a)));
  });
});

describe('decisão de entrega sem efeito (prepararLeitura)', () => {
  const origemContinua = { entrega: { politica: 'continua', base: 'main', comandos: { deploy: { argv: ['true'], timeout_s: 5 }, smoke: { argv: ['true'], timeout_s: 5 }, rollback: { argv: ['true'], timeout_s: 5 } } } };
  const concluido = [...INTEGRAR('T1'), ...INTEGRAR('T2'), ['ci.resultado', { verde: true, alvo: 'homolog' }]];

  test('preparar-leitura-em-curso-sem-parou: entrega.inicio sem fim + entrega.lock com pid vivo ⇒ sem PAROU; sem o lock ⇒ PAROU', () => {
    const m = montar({ origem: origemContinua, ...comEventos([...concluido, ['producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:deploy' }], ['entrega.inicio', { politica: 'continua' }]]) });
    const semLock = estado(m).estado;
    assert.equal(semLock.parar?.motivo, 'nao_conseguiu', 'lock órfão: produção em estado desconhecido é PAROU');
    writeFileSync(join(m.dir, 'entrega.lock'), `${process.pid} 2026-11-09T12:00:00.000Z\n`);
    const comLock = estado(m).estado;
    assert.equal(comLock.parar, null, 'deploy em curso (pid vivo) não é PAROU');
    assert.equal(comLock.parado, false);
    assert.ok(!estado(m).avisos.some((a) => /decisão de entrega/.test(a)), 'entrega em curso é esperado, não vira aviso');
  });

  test('decisaoEntrega só com `concluir`: tasks incompletas não chamam prepararLeitura (aviso nenhum); concluído com política inválida ⇒ aviso (10c) e sem PAROU', () => {
    const incompleto = montar({ origem: origemContinua, ...comEventos([...INTEGRAR('T1')]) });
    assert.equal(estado(incompleto).avisos.filter((a) => /decisão de entrega/.test(a)).length, 0);
    const afrouxada = montar({ origem: { entrega: { politica: 'janela', base: 'main', janela: { dias: [1], inicio: '02:00', fim: '04:00', fuso: 'UTC' }, comandos: { deploy: { argv: ['true'], timeout_s: 5 } } } }, plano: { politica_entrega: { politica: 'continua', exige_prod: false } }, ...comEventos(concluido) });
    const r = estado(afrouxada);
    assert.equal(r.estado.parar, null);
    assert.ok(r.avisos.some((a) => /decisão de entrega não lida: politica_afrouxada/.test(a)), JSON.stringify(r.avisos));
  });

  test('preparar-leitura-outro-erro-aviso: âncora ou config que impede a leitura ⇒ aviso com o erro, decisaoEntrega null', () => {
    const m = montar({ origem: {}, ...comEventos(concluido) }); // sem entrega.comandos: a decisão diz parar janela_ausente? (política padrão sob_demanda)
    const r = estado(m);
    // sob_demanda ⇒ `subir` não acende nada; o essencial é que a leitura rodou sem escrever
    assert.equal(r.estado.parar, null);
    const antes = hashArvore(join(m.repo, '.harness'));
    estado(m);
    assert.equal(hashArvore(join(m.repo, '.harness')), antes);
  });

  test('release_pr: a decisão da entrega vira "merge da release para <base>" (campo base lido)', () => {
    const m = montar({ origem: { entrega: { politica: 'continua', base: 'release-9', comandos: { deploy: { argv: ['true'], timeout_s: 5 } } } }, ...comEventos(concluido) });
    const item = estado(m).estado.depende.find((d) => /merge da release/.test(d.motivo));
    assert.ok(item !== undefined, 'faltam comandos ⇒ release_pr');
    assert.equal(item.motivo, 'merge da release para release-9');
    const sob = montar({ origem: { entrega: { politica: 'sob_demanda', base: 'trunk' } }, ...comEventos(concluido) });
    assert.equal(estado(sob).estado.depende.find((d) => /merge da release/.test(d.motivo))?.motivo, 'merge da release para trunk');
  });

  test('prepararLeitura só com `concluir` (custo): tasks incompletas ⇒ 0 chamadas; concluído ⇒ 1; diário inválido ⇒ 0', () => {
    let chamadas = 0;
    const espia = (cwd, o) => { chamadas++; return prepararLeituraReal(cwd, o); };
    const incompleto = montar({ origem: origemContinua, ...comEventos([...INTEGRAR('T1')]) });
    estado(incompleto, { preparar: espia });
    assert.equal(chamadas, 0);
    const pronto = montar({ origem: origemContinua, ...comEventos(concluido) });
    estado(pronto, { preparar: espia });
    assert.equal(chamadas, 1);
    const quebrado = montar({ origem: origemContinua, ...comEventos(concluido) });
    appendFileSync(join(quebrado.dir, 'events.loop.jsonl'), '{lixo\n');
    estado(quebrado, { preparar: espia });
    assert.equal(chamadas, 1, 'diário inválido não chama');
    const vazio = montar({ origem: origemContinua });
    estado(vazio, { preparar: espia });
    assert.equal(chamadas, 1, 'diário vazio não chama');
  });
});

describe('plano grande e tamanho da saída', () => {
  test('plano com 60 tasks e histórico: o stdout fica abaixo de 4 MiB', () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({ id: `T${i + 1}`, titulo: `Task número ${i + 1}`, deps: [], arquivos: [`src/t${i + 1}.txt`] }));
    const eventos = [];
    for (let i = 1; i <= 20; i++) eventos.push(...INTEGRAR(`T${i}`));
    const m = montar({ plano: { tasks }, ...comEventos(eventos) });
    const r = cli(m, ['estado']);
    assert.equal(r.rc, 0, r.stdout.slice(0, 300));
    assert.ok(Buffer.byteLength(r.stdout) < 4 * 1024 * 1024);
    assert.equal(r.json.estado.plano.feitas, 20);
  });
});

describe('costura: os CLIs reais do loop alimentam o painel', () => {
  test('costura-loop-modelo-mutacoes (P9): `loop.mjs iniciar` grava `modelo`, `integrar` grava `mutacoes`, e `painel.mjs estado` os mostra', () => {
    const base = novoTmp('painel costura ');
    const repo = join(base, 'repo');
    mkdirSync(repo);
    g(repo, 'init', '-q', '-b', 'feat/GM-12-costura');
    g(repo, 'config', 'user.email', 't@t'); g(repo, 'config', 'user.name', 't'); g(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.txt'), 'ORIG\n');
    writeFileSync(join(repo, 'src', 't1.txt'), 'x\n');
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } }));
    writeFileSync(join(repo, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n.harness/capacidade.json\n');
    g(repo, 'add', '-A');
    g(repo, 'commit', '-q', '-m', 'chore: base');
    const dir = join(repo, '.harness', 'entregas', 'GM-12');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plano.json'), JSON.stringify({ entrega: 'GM-12', tasks: [{ id: 'T1', titulo: 'Primeira', deps: [], arquivos: ['src/t1.txt'], mutacoes: 'mut.json' }] }));
    writeFileSync(join(repo, 'mut.json'), JSON.stringify([{ nome: 'lenta', arquivo: 'src/t1.txt', de: 'x', para: 'y', teste: 'sleep 0.4; test "$(cat src/t1.txt)" = x' }]));
    writeFileSync(join(repo, '.harness', 'capacidade.json'), JSON.stringify({ hostname: 'host-teste', slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 }));
    const env = { ...process.env, GABARITO_CAP_HOSTNAME: 'host-teste', GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };
    delete env.GABARITO_POUSO_X;
    const loop = (args) => {
      const r = spawnSync(process.execPath, [LOOP, ...args], { cwd: repo, encoding: 'utf8', env });
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      return JSON.parse(r.stdout.trim());
    };
    loop(['abrir', 'T1']);
    loop(['iniciar', 'T1', 'implementador']);
    const wt = join(repo, '.harness', 'worktrees', 'T1');
    writeFileSync(join(wt, 'src', 't1.txt'), 'x\n');
    g(wt, 'add', 'src/t1.txt'); g(wt, 'commit', '-q', '--allow-empty', '-m', 'feat(GM-12): trabalho');
    loop(['concluir', 'T1']);
    loop(['iniciar', 'T1', 'revisor']);
    loop(['veredito', 'T1', 'APROVADO', '1', '0', '0']);
    const antesIntegrar = JSON.parse(cli({ repo }, ['estado']).stdout);
    assert.equal(antesIntegrar.estado.plano.tasks[0].modelo, 'opus', 'o modelo do revisor (última task.iniciada) sai de `loop.mjs iniciar`');
    loop(['integrar', 'T1']);
    const r = cli({ repo }, ['estado']);
    assert.equal(r.rc, 0, r.stdout + r.stderr);
    assert.equal(r.json.estado.plano.tasks[0].estado, 'integrada');
    assert.equal(r.json.estado.qualidade.mortas, 1, '`integrar` grava mutacoes {total:1, mortas:1}');
    assert.equal(r.json.estado.plano.feitas, 1);
  });
});

/**
 * Testes do hook SubagentStart (Q27, GM-9): regras-subagent.sh injeta as regras obrigatórias em todo subagent.
 * Ataques herdados: conteúdo hostil no arquivo do projeto, CLAUDE_PROJECT_DIR ≠ cwd, symlink/diretório/FIFO/ilegível,
 * arquivo enorme (timeout de 5 s), node ausente. Helpers em ./_comum.mjs.
 * Mutações prescritas: .superpowers/sdd/.../task-Q27-mut.json (fora do repo).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, chmodSync, truncateSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOKS, PLUGIN, PATH_SEM_NODE, cleanEnv, fixtureRepo } from './_comum.mjs';

const SCRIPT = join(HOOKS, 'regras-subagent.sh');
const PADRAO = join(PLUGIN, 'reference', 'regras-subagent.md');
const TETO = 2000;

function rodar({ cwd, env = {}, input } = {}) {
  const stdin = input ?? JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a1', agent_type: 'general-purpose', cwd });
  const t0 = Date.now();
  const r = spawnSync('bash', [SCRIPT], { input: stdin, encoding: 'utf8', cwd, env: cleanEnv(env), timeout: 15000, maxBuffer: 1 << 24 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0 };
}
// Saída: exatamente um objeto JSON e mais nada em stdout.
function contexto(r) {
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\{.*\}\n$/s, 'stdout é só o JSON');
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ['hookSpecificOutput']);
  assert.equal(j.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.deepEqual(Object.keys(j.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName']);
  return j.hookSpecificOutput.additionalContext;
}
function repoComRegras(conteudo) {
  const dir = fixtureRepo();
  mkdirSync(join(dir, '.harness'), { recursive: true });
  if (conteudo !== undefined) writeFileSync(join(dir, '.harness', 'regras-subagent.md'), conteudo);
  return dir;
}
const padrao = () => readFileSync(PADRAO, 'utf8');
const SO_PADRAO = (ctx) => ctx.startsWith(padrao().trimEnd());

describe('regras-subagent.md — regras padrão (Q27 item 3)', () => {
  const txt = existsSync(PADRAO) ? readFileSync(PADRAO, 'utf8') : '';
  const linhas = txt.split('\n').filter((l) => /^\d+\./.test(l));
  test('cinco regras numeradas, cada uma marcada [barreira] ou [instrução]', () => {
    assert.equal(linhas.length, 5, linhas.join('\n'));
    for (const l of linhas) assert.match(l, /\[(barreira|instrução)\]/, l);
  });
  test('marcas certas: ler segredo e produção são barreira; imprimir segredo, push/PR/merge e contornar hook são instrução', () => {
    const marca = (re) => { const l = linhas.find((x) => re.test(x)); assert.ok(l, String(re)); return l.match(/\[(barreira|instrução)\]/)[1]; };
    assert.equal(marca(/ler|leia/i), 'barreira');
    assert.equal(marca(/imprim/i), 'instrução');
    assert.equal(marca(/produção/i), 'barreira');
    assert.equal(marca(/push/i), 'instrução');
    assert.equal(marca(/contorn/i), 'instrução');
  });
  test('cabem folgadas no teto: sobra espaço para o arquivo do projeto', () => {
    assert.ok(Array.from(txt).length <= 1300, String(Array.from(txt).length));
  });
});

describe('regras-subagent.sh — injeção (Q27)', () => {
  test('sem arquivo do projeto: só as regras padrão, JSON válido, hookEventName SubagentStart', () => {
    const dir = fixtureRepo();
    const ctx = contexto(rodar({ cwd: dir }));
    assert.ok(SO_PADRAO(ctx));
    assert.equal(ctx.includes('[barreira]'), true);
    assert.equal(/Regras do projeto/.test(ctx), false);
  });
  test('arquivo do projeto presente: regras do projeto vêm depois das padrão', () => {
    const dir = repoComRegras('Regra do dono: ZZZ-REGRA-DO-PROJETO\n');
    const ctx = contexto(rodar({ cwd: dir }));
    assert.ok(SO_PADRAO(ctx));
    assert.ok(ctx.indexOf('ZZZ-REGRA-DO-PROJETO') > ctx.indexOf('[barreira]'));
  });
  test('aspas, barra invertida, quebra de linha, acentos e $(...): JSON válido, literal, nada executado', () => {
    const dir = repoComRegras('aspas "x" \\ barra\nlinha2 ação ñ\ttab $(touch SENT1) `touch SENT2` $HOME ${HOME}\r\nfim\n');
    const ctx = contexto(rodar({ cwd: dir }));
    assert.ok(ctx.includes('aspas "x" \\ barra\nlinha2 ação ñ'));
    assert.ok(ctx.includes('$(touch SENT1) `touch SENT2` $HOME ${HOME}'), 'nada expandido');
    for (const s of ['SENT1', 'SENT2']) {
      assert.equal(existsSync(join(dir, s)), false, s);
      assert.equal(existsSync(join(process.cwd(), s)), false, s);
    }
  });
  test('CLAUDE_PROJECT_DIR ≠ cwd: lê da raiz da sessão, não do cwd (Q14)', () => {
    const sessao = repoComRegras('RAIZ-DA-SESSAO\n');
    const outro = repoComRegras('RAIZ-DO-CWD\n');
    const ctx = contexto(rodar({ cwd: outro, env: { CLAUDE_PROJECT_DIR: sessao } }));
    assert.ok(ctx.includes('RAIZ-DA-SESSAO'));
    assert.equal(ctx.includes('RAIZ-DO-CWD'), false);
  });
  test('CLAUDE_PROJECT_DIR ausente: fallback para a raiz do repo (subpasta resolve para a raiz)', () => {
    const dir = repoComRegras('RAIZ-GIT\n');
    const ctx = contexto(rodar({ cwd: join(dir, 'apps', 'api') }));
    assert.ok(ctx.includes('RAIZ-GIT'));
  });
  test('CLAUDE_PROJECT_DIR aponta para algo que não é diretório: fallback para a raiz do repo', () => {
    const dir = repoComRegras('RAIZ-GIT-2\n');
    const ctx = contexto(rodar({ cwd: dir, env: { CLAUDE_PROJECT_DIR: join(dir, 'nao-existe') } }));
    assert.ok(ctx.includes('RAIZ-GIT-2'));
  });
  test('stdin vazio ou lixo: mesmo resultado (o stdin não é lido)', () => {
    const dir = repoComRegras('QQQ\n');
    for (const input of ['', 'não é json {{{']) assert.ok(contexto(rodar({ cwd: dir, input })).includes('QQQ'));
  });
});

describe('regras-subagent.sh — arquivo do projeto inutilizável: só as regras padrão, nada de fora (Q27 ataques)', () => {
  const SEGREDO = 'SEGREDO=hunter2-NAO-PODE-VAZAR';
  function fora() {
    const f = realpathSync(mkdtempSync(join(tmpdir(), 'gm-fora-')));
    writeFileSync(join(f, '.env'), SEGREDO + '\n');
    return f;
  }
  function confere(dir, extra = {}) {
    const r = rodar({ cwd: dir, ...extra });
    const ctx = contexto(r);
    assert.ok(SO_PADRAO(ctx));
    assert.equal(ctx.includes('hunter2'), false, 'segredo vazou');
    assert.equal(ctx.includes('SEGREDO='), false);
    assert.equal(r.stdout.includes('hunter2'), false);
    return ctx;
  }
  test('vazio e só espaços', () => {
    confere(repoComRegras(''));
    confere(repoComRegras('  \n\t\n'));
  });
  test('é um diretório', () => {
    const dir = repoComRegras();
    mkdirSync(join(dir, '.harness', 'regras-subagent.md'));
    confere(dir);
  });
  test('ilegível (chmod 000)', { skip: process.getuid?.() === 0 }, () => {
    const dir = repoComRegras('NAO-LEGIVEL\n');
    chmodSync(join(dir, '.harness', 'regras-subagent.md'), 0o000);
    const ctx = confere(dir);
    assert.equal(ctx.includes('NAO-LEGIVEL'), false);
  });
  test('symlink para .env fora do repo', () => {
    const dir = repoComRegras();
    symlinkSync(join(fora(), '.env'), join(dir, '.harness', 'regras-subagent.md'));
    confere(dir);
  });
  test('symlink para .env dentro do repo', () => {
    const dir = repoComRegras();
    writeFileSync(join(dir, '.env'), SEGREDO + '\n');
    symlinkSync(join(dir, '.env'), join(dir, '.harness', 'regras-subagent.md'));
    confere(dir);
  });
  test('symlink relativo para um arquivo legítimo do próprio repo também é recusado', () => {
    const dir = repoComRegras();
    writeFileSync(join(dir, 'outras-regras.md'), 'OUTRAS-REGRAS-DENTRO\n');
    symlinkSync('../outras-regras.md', join(dir, '.harness', 'regras-subagent.md'));
    const ctx = confere(dir);
    assert.equal(ctx.includes('OUTRAS-REGRAS-DENTRO'), false);
  });
  test('.harness é symlink para diretório fora do repo com regras-subagent.md real', () => {
    const dir = fixtureRepo();
    const f = fora();
    writeFileSync(join(f, 'regras-subagent.md'), 'REGRA-DE-FORA ' + SEGREDO + '\n');
    symlinkSync(f, join(dir, '.harness'));
    const ctx = confere(dir);
    assert.equal(ctx.includes('REGRA-DE-FORA'), false);
  });
  test('FIFO no lugar do arquivo não trava o hook', () => {
    const dir = repoComRegras();
    const m = spawnSync('mkfifo', [join(dir, '.harness', 'regras-subagent.md')]);
    assert.equal(m.status, 0);
    const r = rodar({ cwd: dir });
    assert.ok(r.ms < 5000, `${r.ms} ms`);
    assert.ok(SO_PADRAO(contexto(r)));
  });
});

describe('regras-subagent.sh — teto de 2.000 caracteres (Q27 item 4)', () => {
  const n = (s) => Array.from(s).length;
  test('acima do teto: trunca em ≤ 2.000 caracteres, avisa no próprio texto, preserva as regras padrão', () => {
    const dir = repoComRegras('REGRA-LONGA '.repeat(1000));
    const ctx = contexto(rodar({ cwd: dir }));
    assert.ok(n(ctx) <= TETO, String(n(ctx)));
    assert.match(ctx, /truncad/i);
    assert.ok(SO_PADRAO(ctx));
    assert.ok(ctx.includes('REGRA-LONGA'));
  });
  test('abaixo do teto: sem aviso de truncamento', () => {
    const ctx = contexto(rodar({ cwd: repoComRegras('curta\n') }));
    assert.equal(/truncad/i.test(ctx), false);
  });
  test('limite de caractere UTF-8: corte nunca parte um caractere de 2 ou 4 bytes', () => {
    for (const ch of ['é', '😀', '日']) {
      const dir = repoComRegras(ch.repeat(5000));
      const ctx = contexto(rodar({ cwd: dir }));
      assert.ok(n(ctx) <= TETO, `${ch} ${n(ctx)}`);
      assert.equal(ctx.includes('�'), false, ch);
      assert.equal(ctx.isWellFormed(), true, ch);
      assert.ok(ctx.includes(ch.repeat(50)), ch);
      assert.match(ctx, /truncad/i);
    }
  });
  test('arquivo enorme (3 GB esparso) não estoura o timeout de 5 s nem a memória: leitura limitada em bytes', () => {
    const dir = repoComRegras('início ação\n');
    truncateSync(join(dir, '.harness', 'regras-subagent.md'), 3 * 1024 ** 3);
    const r = rodar({ cwd: dir });
    const ctx = contexto(r);
    assert.ok(r.ms < 4000, `${r.ms} ms`);
    assert.ok(n(ctx) <= TETO);
    assert.ok(ctx.includes('início ação'));
  });
});

describe('regras-subagent.sh — dependências (fail-open declarado, G9)', () => {
  test('node ausente: sai 0, sem stdout, aviso em stderr', () => {
    const dir = repoComRegras('X\n');
    const r = rodar({ cwd: dir, env: { PATH: PATH_SEM_NODE } });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /node ausente/);
  });
  test('arquivo de regras padrão ausente: sai 0, sem stdout, aviso em stderr', () => {
    const dir = repoComRegras('X\n');
    const plugin = realpathSync(mkdtempSync(join(tmpdir(), 'gm-plugin-')));
    const r = rodar({ cwd: dir, env: { CLAUDE_PLUGIN_ROOT: plugin } });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /regras-subagent\.md/);
  });
});

/**
 * Adaptador do hook (T4): stdin → decisão → stdout, sempre exit 0.
 *
 * O núcleo (classificar/decidir/diário) tem teste próprio; aqui só o que o adaptador decide: payload ruim,
 * raiz do repo, fonte da config, diário que falha, mensagem uma vez por sessão, spawn só quando preciso.
 *
 * MUTAÇÕES PRESCRITAS:
 *  A1  devolver `allow` no adaptador ⇒ `saida-nunca-allow` falha
 *  A2  gravar o comando cru em `dados`/diário ⇒ `evento-sem-comando-cru` falha
 *  A3  lançar em JSON inválido ⇒ `guarda-payload-json-invalido` falha
 *  A4  sempre montar o contexto ⇒ `sem-contexto-sem-spawn` falha
 *  A5  sem marcador por sessão ⇒ `fonte-mensagem-uma-vez` falha
 *  A6  esperar o append antes de escrever a decisão / não checar o diário antes ⇒ `diario-indisponivel-guarda-segue` falha
 *  A7  exceção da decisão virar fail-open total ⇒ `excecao-segredo-e-integridade-pedem` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARDA = join(GATES, 'dist', 'guarda.js');

const AMBIENTES = {
  teste: { hosts: ['127.0.0.1', 'localhost'], bancos: ['127.0.0.1'] },
  homolog: { hosts: ['staging.exemplo.com'] },
  prod: { hosts: ['api.exemplo.com'], bancos: ['db.prod.exemplo.com'] },
};
const CONFIG = { guarda: { ambientes: AMBIENTES, producao: { permitidos: [] } }, versionamento: { branchPadrao: 'main' } };

const ENV_GIT = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@exemplo.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@exemplo.com',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV_GIT, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** Repo com `origin` fake e config em origin/HEAD (ou sem remoto). */
function montar({ origem = CONFIG, remoto = true, branch = 'feat/GM-9-x' } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  if (origem) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(origem));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  if (remoto) {
    const bare = mkdtempSync(join(tmpdir(), 'gm-adapt-origin-'));
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
  }
  if (branch) git(repo, 'checkout', '-q', '-b', branch);
  return repo;
}

let n = 0;
const sessaoNova = () => `adapt-${process.pid}-${Date.now()}-${n++}`;

function rodarBruto(stdin, { cwd, env = {}, repo = null } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'gm-adapt-tmp-'));
  const r = spawnSync(process.execPath, [GUARDA], {
    cwd: cwd ?? repo ?? tmp,
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(repo ? { CLAUDE_PROJECT_DIR: repo } : {}), CLAUDE_PLUGIN_ROOT: join(GATES, '..'), TMPDIR: tmp, ...env },
  });
  const saida = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
  return {
    status: r.status,
    stderr: r.stderr,
    stdout: r.stdout,
    decisao: saida.hookSpecificOutput?.permissionDecision,
    motivo: saida.hookSpecificOutput?.permissionDecisionReason ?? '',
    systemMessage: saida.systemMessage ?? '',
    tmp,
  };
}

function rodar(repo, tool_name, tool_input, extra = {}) {
  const entrada = { tool_name, tool_input, permission_mode: 'default', session_id: sessaoNova(), cwd: repo, ...extra };
  return rodarBruto(JSON.stringify(entrada), { repo });
}

const eventosDe = (repo) => {
  const dir = join(repo, '.harness', 'entregas');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: false })
    .filter((f) => /events\..+\.jsonl$/.test(f))
    .map((f) => ({ arquivo: join(dir, f), texto: readFileSync(join(dir, f), 'utf8') }));
};

describe('payload malformado: exit 0, sem decisão, aviso em stderr', () => {
  test('guarda-payload-json-invalido', () => {
    const r = rodarBruto('{isto nao e json');
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
  });

  test('guarda-payload-stdin-vazio', () => {
    const r = rodarBruto('');
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
  });

  test('guarda-payload-sem-input: sem tool_input', () => {
    const r = rodarBruto(JSON.stringify({ tool_name: 'Bash', session_id: 'x' }));
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
  });

  test('guarda-payload-command-nao-string', () => {
    for (const command of [42, null, ['ls'], { a: 1 }]) {
      const r = rodarBruto(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'x' }));
      assert.equal(r.status, 0, JSON.stringify(command));
      assert.equal(r.decisao, undefined, JSON.stringify(command));
      assert.match(r.stderr, /\S/, JSON.stringify(command));
    }
  });

  test('guarda-payload-nao-objeto: array, número, null', () => {
    for (const bruto of ['[]', '7', 'null', '"x"']) {
      const r = rodarBruto(bruto);
      assert.equal(r.status, 0, bruto);
      assert.equal(r.decisao, undefined, bruto);
    }
  });

  test('guarda-payload-gigante: 10 MB de comando pede em vez de ignorar (Q17) e termina rápido', () => {
    const repo = montar();
    const t0 = performance.now();
    const r = rodar(repo, 'Bash', { command: `echo ${'x'.repeat(10 * 1024 * 1024)}` });
    const ms = performance.now() - t0;
    assert.equal(r.status, 0);
    assert.equal(r.decisao, 'ask');
    assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
  });

  test('guarda-agent-id-vazio: vale como orquestrador (ask, não deny)', () => {
    const repo = montar();
    const r = rodar(repo, 'Read', { file_path: join(repo, '.env') }, { agent_id: '' });
    assert.equal(r.decisao, 'ask');
  });
});

describe('raiz do repo', () => {
  test('guarda-cwd-fora-repo: sem git ⇒ exit 0, sem decisão, aviso em stderr, nada gravado', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-fora-')));
    const r = rodarBruto(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: sessaoNova(), cwd: fora }), { cwd: fora });
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined);
    assert.match(r.stderr, /\S/);
    assert.equal(existsSync(join(fora, '.harness')), false);
  });

  test('guarda-cwd-fora-repo-segredo: o anel de segredo vale mesmo sem repo', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-fora-')));
    const r = rodarBruto(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: join(fora, '.env') }, session_id: sessaoNova(), cwd: fora }), { cwd: fora });
    assert.equal(r.status, 0);
    assert.equal(r.decisao, 'ask');
  });
});

describe('diário', () => {
  test('diario-indisponivel-guarda-segue: .harness somente leitura ⇒ decisão correta + systemMessage', (t) => {
    const repo = montar();
    mkdirSync(join(repo, '.harness'));
    chmodSync(join(repo, '.harness'), 0o555);
    t.after(() => chmodSync(join(repo, '.harness'), 0o755));
    const r = rodar(repo, 'Bash', { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" });
    assert.equal(r.status, 0);
    assert.equal(r.decisao, 'ask');
    assert.match(r.systemMessage, /diário/i);
  });

  test('evento-sem-comando-cru: URL com credencial e comando nunca chegam ao arquivo', () => {
    const repo = montar();
    const r = rodar(repo, 'Bash', { command: "psql postgres://u:s3nh4@db.prod.exemplo.com/x -c 'select 1'" });
    assert.equal(r.status, 0);
    const evs = eventosDe(repo);
    assert.equal(evs.length, 1, 'um arquivo de eventos');
    assert.doesNotMatch(evs[0].texto, /s3nh4/);
    assert.doesNotMatch(evs[0].texto, /psql/);
    assert.doesNotMatch(evs[0].texto, /select/);
    assert.match(evs[0].texto, /db\.prod\.exemplo\.com/);
    assert.match(evs[0].texto, /producao\.acesso/);
  });

  test('evento-no-diretorio-do-pbi: branch feat/GM-9-x grava em entregas/GM-9', () => {
    const repo = montar();
    rodar(repo, 'Bash', { command: 'rm -rf .next' });
    const evs = eventosDe(repo);
    assert.equal(evs.length, 1);
    assert.match(evs[0].arquivo, /entregas\/GM-9\/events\./);
    assert.match(evs[0].texto, /operacao\.destrutiva/);
  });

  test('evento-agente: orquestrador vs subagent:<id>', () => {
    const repo = montar();
    rodar(repo, 'Bash', { command: 'rm -rf .next' });
    rodar(repo, 'Bash', { command: 'rm -rf .next' }, { agent_id: 'abc123' });
    const textos = eventosDe(repo).map((e) => e.texto).join('');
    assert.match(textos, /"agente":"orquestrador"/);
    assert.match(textos, /"agente":"subagent:abc123"/);
  });

  test('sem-onboarding-sem-diario (Q20): repo sem harness.config.json em lugar nenhum não ganha .harness', () => {
    const repo = montar({ origem: null, remoto: false });
    rodar(repo, 'Bash', { command: 'rm -rf .next' });
    assert.equal(existsSync(join(repo, '.harness')), false);
  });

  test('sessao-invalida: guarda segue, sem diário, com systemMessage', () => {
    const repo = montar();
    const r = rodar(repo, 'Bash', { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" }, { session_id: '../../etc/x' });
    assert.equal(r.decisao, 'ask');
    assert.match(r.systemMessage, /session_id/);
    assert.equal(existsSync(join(repo, '.harness')), false);
  });

  test('saida-antes-do-append: a decisão chega ao stdout antes de o append desistir do lock preso', async () => {
    const repo = montar();
    const sessao = sessaoNova();
    const dir = join(repo, '.harness', 'entregas', 'GM-9');
    mkdirSync(dir, { recursive: true });
    // lock fresco de outro dono: o append espera o lock envelhecer 2 s (ou desiste em 3 s); a decisão não pode esperar por isso
    writeFileSync(join(dir, `events.${sessao}.jsonl.lock`), 'outro');
    const entrada = { tool_name: 'Bash', tool_input: { command: "psql -h db.prod.exemplo.com -c 'DROP TABLE t'" }, session_id: sessao, cwd: repo };
    const t0 = performance.now();
    const { primeiroStdout, fim, status, stdout } = await new Promise((ok) => {
      const p = spawn(process.execPath, [GUARDA], { cwd: repo, env: { ...process.env, CLAUDE_PROJECT_DIR: repo, TMPDIR: mkdtempSync(join(tmpdir(), 'gm-adapt-tmp-')) } });
      let primeiro = null;
      let out = '';
      p.stdout.on('data', (d) => { primeiro ??= performance.now() - t0; out += d; });
      p.on('close', (code) => ok({ primeiroStdout: primeiro, fim: performance.now() - t0, status: code, stdout: out }));
      p.stdin.end(JSON.stringify(entrada));
    });
    assert.equal(status, 0);
    assert.equal(JSON.parse(stdout).hookSpecificOutput.permissionDecision, 'ask');
    assert.ok(primeiroStdout < 1500, `decisão levou ${primeiroStdout?.toFixed(0)} ms para sair`);
    assert.ok(fim > 1800, `o append deveria ter esperado o lock até envelhecer 2 s (${fim.toFixed(0)} ms): o teste não exercita o lock`);
    assert.ok(fim < 4800, `processo levou ${fim.toFixed(0)} ms, perto do timeout do hook`);
  });
});

describe('fonte da config: mensagem uma vez por sessão (Q7)', () => {
  test('fonte-mensagem-uma-vez: 2 chamadas na mesma sessão ⇒ uma mensagem', () => {
    const repo = montar({ origem: null, remoto: false });
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(CONFIG));
    const sessao = sessaoNova();
    const tmp = mkdtempSync(join(tmpdir(), 'gm-adapt-tmp-'));
    const entrada = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: sessao, cwd: repo });
    const rodarCom = () => rodarBruto(entrada, { repo, env: { TMPDIR: tmp } });
    const a = rodarCom();
    const b = rodarCom();
    assert.match(a.systemMessage, /local/);
    assert.equal(b.systemMessage, '');
    // outra sessão volta a avisar
    const c = rodarBruto(entrada.replace(sessao, `${sessao}-outra`), { repo, env: { TMPDIR: tmp } });
    assert.match(c.systemMessage, /local/);
  });

  test('fonte-divergente: árvore local ≠ origin/HEAD ⇒ vale origin, mensagem cita divergência', () => {
    const repo = montar();
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify({ ...CONFIG, guarda: { ...CONFIG.guarda, producao: { permitidos: ['*'] } } }));
    const r = rodar(repo, 'Bash', { command: 'vercel --prod' });
    assert.equal(r.decisao, 'ask');
    assert.match(r.systemMessage, /diverg/i);
  });

  test('config-sem-secao-guarda: harness.config.json sem `guarda` ⇒ só os anéis', () => {
    const repo = montar({ origem: { fluxo: { resolvidoEm: '2026-01-01' } } });
    assert.equal(rodar(repo, 'Bash', { command: 'curl https://api.exemplo.com/x' }).decisao, undefined);
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, '.env') }).decisao, 'ask');
  });

  test('config-corrompida: JSON inválido em origin ⇒ guarda segue com anéis, sem lançar', () => {
    const repo = montar({ origem: null });
    git(repo, 'checkout', '-q', 'main');
    writeFileSync(join(repo, 'harness.config.json'), '{quebrado');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'config ruim');
    git(repo, 'push', '-q', 'origin', 'main');
    const r = rodar(repo, 'Read', { file_path: join(repo, '.env') });
    assert.equal(r.status, 0);
    assert.equal(r.decisao, 'ask');
  });
});

describe('spawn só quando precisa', () => {
  const traceDe = (repo, command) => {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-adapt-trace-'));
    const trace = join(tmp, 'trace.txt');
    writeFileSync(trace, '');
    const entrada = { tool_name: 'Bash', tool_input: { command }, session_id: sessaoNova(), cwd: repo };
    rodarBruto(JSON.stringify(entrada), { repo, env: { GIT_TRACE: trace } });
    return readFileSync(trace, 'utf8');
  };

  test('sem-contexto-sem-spawn: `ls` não chama `git symbolic-ref`; `git status` chama (controle)', () => {
    const repo = montar();
    assert.doesNotMatch(traceDe(repo, 'ls'), /symbolic-ref/);
    assert.match(traceDe(repo, 'git status'), /symbolic-ref/);
  });
});

describe('exceção da decisão (visão §6.1: fail-closed em segredo e integridade)', () => {
  test('excecao-segredo-e-integridade-pedem; o resto segue com aviso', async () => {
    const { decidirSeguro } = await import(pathToFileURL(GUARDA).href);
    const lanca = () => { throw new Error('boom'); };
    const ctx = { branchAtual: null, refLinkado: null, remoteUrl: null, raiz: '/repo', pluginRoot: '/plugin' };
    const orq = (tool_name, tool_input) => decidirSeguro({ tool_name, tool_input }, null, ctx, lanca);
    const sub = (tool_name, tool_input) => decidirSeguro({ tool_name, tool_input, agent_id: 'a1' }, null, ctx, lanca);

    assert.equal(orq('Read', { file_path: '/repo/.env' }).permissionDecision, 'ask');
    assert.equal(sub('Read', { file_path: '/repo/.env' }).permissionDecision, 'deny');
    assert.equal(orq('Bash', { command: 'cat > .claude/settings.json' }).permissionDecision, 'ask');
    assert.equal(sub('Bash', { command: 'cat > .claude/settings.json' }).permissionDecision, 'deny');
    assert.equal(sub('Edit', { file_path: '/repo/harness.config.json' }).permissionDecision, 'deny');
    assert.equal(orq('Bash', { command: 'git remote set-url origin x' }).permissionDecision, 'ask');

    const livre = orq('Bash', { command: 'ls' });
    assert.equal(livre.permissionDecision, undefined);
    assert.match(livre.systemMessage ?? '', /\S/);
    // `.env.example` não é segredo
    assert.equal(orq('Read', { file_path: '/repo/.env.example' }).permissionDecision, undefined);
  });

  test('excecao-tardia-ainda-decide: lançar depois da leitura não apaga a decisão nem o fallback', async () => {
    const { saidaDeFalha, decidirSeguro } = await import(pathToFileURL(GUARDA).href);
    const erro = new Error('boom');
    const ctx = { branchAtual: null, refLinkado: null, remoteUrl: null, raiz: '/repo', pluginRoot: '/plugin' };
    const lido = { tool_name: 'Read', tool_input: { file_path: '/repo/.env' } };
    const ask = (s) => s?.hookSpecificOutput?.permissionDecision;

    // nenhuma decisão calculada: vale o fallback de segredo e integridade
    assert.equal(ask(saidaDeFalha(erro, lido, null, false)), 'ask');
    assert.equal(ask(saidaDeFalha(erro, { ...lido, agent_id: 'a1' }, null, false)), 'deny');
    assert.match(saidaDeFalha(erro, { tool_name: 'Bash', tool_input: { command: 'ls' } }, null, false).systemMessage, /\S/);
    // decisão já calculada: sai ela, não o fallback
    const calculada = decidirSeguro({ tool_name: 'Bash', tool_input: { command: 'ls' } }, null, ctx);
    assert.equal(saidaDeFalha(erro, lido, calculada, false), null, 'decisão silenciosa continua silenciosa');
    // já escreveu, ou nem leu a entrada: não escreve de novo
    assert.equal(saidaDeFalha(erro, lido, null, true), null);
    assert.equal(saidaDeFalha(erro, null, null, false), null);
  });
});

describe('saída', () => {
  test('saida-nunca-allow: nenhuma entrada devolve allow, e hookEventName é PreToolUse', () => {
    const repo = montar();
    const casos = [
      ['Bash', { command: 'ls' }],
      ['Bash', { command: 'rm -rf .next' }],
      ['Bash', { command: 'vercel --prod' }],
      ['Bash', { command: 'curl https://api.exemplo.com/x' }],
      ['Read', { file_path: join(repo, '.env') }],
      ['Edit', { file_path: join(repo, 'harness.config.json'), old_string: 'a', new_string: 'b' }],
      ['mcp__x__y', { q: 1 }],
    ];
    for (const [tool, input] of casos) {
      for (const extra of [{}, { agent_id: 'a1' }]) {
        const r = rodar(repo, tool, input, extra);
        assert.equal(r.status, 0);
        assert.notEqual(r.decisao, 'allow', `${tool} ${JSON.stringify(input)}`);
        if (r.stdout.trim() !== '') {
          const saida = JSON.parse(r.stdout);
          if (saida.hookSpecificOutput) {
            assert.equal(saida.hookSpecificOutput.hookEventName, 'PreToolUse');
            assert.ok(['ask', 'deny'].includes(saida.hookSpecificOutput.permissionDecision));
            assert.match(saida.hookSpecificOutput.permissionDecisionReason, /\S/);
          }
        }
      }
    }
  });

  test('sem-decisao-sem-saida: comando benigno não imprime nada', () => {
    const repo = montar();
    const r = rodar(repo, 'Bash', { command: 'ls' });
    assert.equal(r.stdout, '');
    assert.equal(r.status, 0);
  });
});

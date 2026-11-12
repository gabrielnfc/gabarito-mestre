/** Adaptador do hook (T4) — diário e fonte da config. Cabeçalho (mutações prescritas) e helpers em _adaptador-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUARDA, CONFIG, git, montar, sessaoNova, rodarBruto, rodar, eventosDe } from './_adaptador-helpers.mjs';

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
    assert.match(evs[0].texto, /guarda\.ask/);
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
      const p = spawn(process.execPath, [GUARDA], { cwd: repo, env: { ...process.env, CLAUDE_PROJECT_DIR: repo, HOME: mkdtempSync(join(tmpdir(), 'gm-home-')), TMPDIR: mkdtempSync(join(tmpdir(), 'gm-adapt-tmp-')) } });
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

  test('fonte-divergente-origin-sem-guarda: origin sem `guarda`, árvore local com ⇒ nada de ambiente, e UMA mensagem por sessão', () => {
    const repo = montar({ origem: { versionamento: { branchPadrao: 'main' } } });
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(CONFIG));
    const sessao = sessaoNova();
    const tmp = mkdtempSync(join(tmpdir(), 'gm-adapt-tmp-'));
    const entrada = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'vercel --prod' }, session_id: sessao, cwd: repo });
    const rodarCom = (e = entrada) => rodarBruto(e, { repo, env: { TMPDIR: tmp } });
    const a = rodarCom();
    assert.equal(a.decisao, undefined, 'a árvore local não vale: prod não é declarada em origin');
    assert.match(a.systemMessage, /origin\/HEAD/);
    assert.match(a.systemMessage, /anéis|anel/);
    assert.equal(rodarCom().systemMessage, '', 'segunda chamada da sessão não repete');
    assert.match(rodarCom(entrada.replace(sessao, `${sessao}-outra`)).systemMessage, /origin\/HEAD/);
  });

  test('origin-sem-guarda-local-sem-guarda: nada diverge de verdade ⇒ sem mensagem', () => {
    const repo = montar({ origem: { versionamento: { branchPadrao: 'main' } } });
    const r = rodar(repo, 'Bash', { command: 'vercel --prod' });
    assert.equal(r.decisao, undefined);
    assert.equal(r.systemMessage, '');
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

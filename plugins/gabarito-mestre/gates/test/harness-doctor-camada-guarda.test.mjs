/** Testes do harness-doctor — T6 camada de guarda. Cabeçalho (mutações prescritas) e helpers em _doctor-helpers.mjs. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import * as doctor from '../scripts/harness-doctor.mjs';
import * as onboarding from '../scripts/onboarding-config.mjs';
const DENY_GUARDA = onboarding.DENY_GUARDA ?? [];
import { repo, agents, SCRIPT, git, repoComGit, AGORA, horasAtras, hb, CFG_GUARDA, camada, arq, repoComOrigin, ARQ_DIARIO, heartbeatLocal } from './_doctor-helpers.mjs';

describe('T6 doctor — camada de guarda (REQ-INF-2)', () => {
  const cfg = { 'harness.config.json': JSON.stringify(CFG_GUARDA) };

  test('doctor-camada-ativa: marcador local + linha do diário há 2 h ⇒ ativa, heartbeatHa 2, fonte local', () => {
    const dir = repo({ ...cfg });
    heartbeatLocal(dir, 2);
    const c = camada(dir);
    assert.equal(c.estado, 'ativa');
    assert.equal(c.heartbeatHa, 2);
    assert.equal(c.fonte, 'local');
    assert.equal(c.divergente, false);
  });

  test('doctor-camada-ativa: vale o ts do MARCADOR, não outro heartbeat qualquer do mesmo arquivo', () => {
    const dir = repo({ ...cfg });
    heartbeatLocal(dir, 3, { linhas: [hb(horasAtras(9)), hb(horasAtras(1), { sessao: 'outra' })] });
    assert.equal(camada(dir).heartbeatHa, 3);
  });

  test('doctor-heartbeat-25h: 24 h exatas ainda é ativa; 25 h é configurada com o heartbeatHa local', () => {
    const exato = repo({ ...cfg });
    heartbeatLocal(exato, 24);
    assert.equal(camada(exato).estado, 'ativa');
    const velho = repo({ ...cfg });
    heartbeatLocal(velho, 25);
    assert.equal(camada(velho).estado, 'configurada');
    assert.equal(camada(velho).heartbeatHa, 25);
    const dias = repo({ ...cfg });
    heartbeatLocal(dias, 24 * 8);
    assert.equal(camada(dias).estado, 'configurada');
    const sem = repo({ ...cfg });
    assert.equal(camada(sem).estado, 'configurada');
    assert.equal(camada(sem).heartbeatHa, null);
  });

  test('doctor-heartbeat-clonado-nao-ativa: diário versionado de outro autor há 20 h, sem marcador ⇒ configurada, com anotação', () => {
    const dir = repo({ ...cfg, [ARQ_DIARIO]: `${hb(horasAtras(20), { autor: 'outro@exemplo.com' })}\n` });
    const c = camada(dir);
    assert.equal(c.estado, 'configurada');
    assert.equal(c.heartbeatHa, null);
    assert.deepEqual(c.diario, { ha: 20, autor: 'outro@exemplo.com' });
    const antigo = repo({ ...cfg, [ARQ_DIARIO]: `${hb(horasAtras(24 * 8))}\n` });
    assert.equal(camada(antigo).diario, null, 'a anotação vale até 7 d');
  });

  test('doctor-heartbeat-clonado-nao-ativa: clone git real do repo com heartbeat commitado NÃO herda a camada ativa', () => {
    const origem = repoComGit({ ...cfg });
    heartbeatLocal(origem, 1, { marcador: {} });
    assert.equal(camada(origem).estado, 'ativa');
    git(origem, 'add', '-f', ARQ_DIARIO, 'harness.config.json');
    git(origem, 'commit', '-q', '-m', 'chore: diario');
    const clone = join(mkdtempSync(join(tmpdir(), 'doctor-clone-')), 'c');
    execFileSync('git', ['clone', '-q', origem, clone], { stdio: 'ignore' });
    const c = camada(clone);
    assert.equal(c.estado, 'configurada');
    assert.equal(c.heartbeatHa, null);
    assert.equal(c.diario.ha, 1);
  });

  test('doctor-marcador-sem-evento: marcador sem a linha correspondente no diário (arquivo, sessao ou ts) não vale', () => {
    const semArquivo = repo({ ...cfg });
    arq(semArquivo, '.harness/heartbeat.json', JSON.stringify({ ts: horasAtras(1), sessao: 's1', arquivo: ARQ_DIARIO }));
    assert.equal(camada(semArquivo).estado, 'configurada', 'arquivo apontado não existe');
    const outraSessao = repo({ ...cfg });
    heartbeatLocal(outraSessao, 1, { marcador: { sessao: 'zzz' } });
    assert.equal(camada(outraSessao).estado, 'configurada', 'sessao diferente');
    const outroTs = repo({ ...cfg });
    heartbeatLocal(outroTs, 1, { marcador: { ts: horasAtras(0.5) } });
    assert.equal(camada(outroTs).estado, 'configurada', 'ts diferente');
    const outroTipo = repo({ ...cfg });
    arq(outroTipo, ARQ_DIARIO, `${JSON.stringify({ tipo: 'sessao.inicio', sessao: 's1', ts: horasAtras(1) })}\n`);
    arq(outroTipo, '.harness/heartbeat.json', JSON.stringify({ ts: horasAtras(1), sessao: 's1', arquivo: ARQ_DIARIO }));
    assert.equal(camada(outroTipo).estado, 'configurada', 'outro tipo de evento com mesmo ts e sessao');
  });

  test('doctor-camada-configurada: sem heartbeat nenhum com ambientes declarados ⇒ configurada', () => {
    const sem = repo({ ...cfg });
    assert.equal(camada(sem).estado, 'configurada');
    assert.equal(camada(sem).heartbeatHa, null);
  });

  test('doctor-camada-divergente: árvore ≠ origin/HEAD ⇒ fonte origin, divergente true (a config do origin é a que vale)', () => {
    const dir = repoComOrigin({ origem: CFG_GUARDA, local: { guarda: { ambientes: { teste: { hosts: ['outro.local'] } } } } });
    const c = camada(dir);
    assert.equal(c.fonte, 'origin');
    assert.equal(c.divergente, true);
    assert.equal(c.estado, 'configurada');
    const igual = repoComOrigin({ origem: CFG_GUARDA, local: CFG_GUARDA });
    assert.equal(camada(igual).fonte, 'origin');
    assert.equal(camada(igual).divergente, false);
  });

  test('doctor-camada-config-local-invalida-origin-valida: lê o origin, marca divergente, não lança', () => {
    const dir = repoComOrigin({ origem: CFG_GUARDA, local: '{ isto não é json' });
    const c = camada(dir);
    assert.equal(c.fonte, 'origin');
    assert.equal(c.divergente, true);
    assert.equal(c.estado, 'configurada');
  });

  test('doctor-camada-nenhuma: sem config, sem deny, sem heartbeat ⇒ nenhuma, fonte null', () => {
    const c = camada(repo({ 'README.md': 'x' }));
    assert.deepEqual(c, { estado: 'nenhuma', heartbeatHa: null, fonte: null, divergente: false, diario: null });
  });

  test('doctor-camada-sem-git: dir sem .git nem origin ⇒ fonte local, sem exceção', () => {
    const c = camada(repo({ 'harness.config.json': JSON.stringify(CFG_GUARDA) }));
    assert.equal(c.fonte, 'local');
    assert.equal(c.divergente, false);
  });

  test('doctor-camada-worktree: cada árvore lê o PRÓPRIO marcador; o heartbeat de uma não ativa a outra', () => {
    const principal = repoComGit({ 'harness.config.json': JSON.stringify(CFG_GUARDA) });
    git(principal, 'add', 'harness.config.json');
    git(principal, 'commit', '-q', '-m', 'chore: config');
    const wt = join(mkdtempSync(join(tmpdir(), 'doctor-wt-')), 'wt');
    git(principal, 'worktree', 'add', '-q', '-b', 'wt/GM-9-1', wt);
    heartbeatLocal(wt, 1);
    assert.equal(camada(wt).estado, 'ativa');
    assert.equal(camada(principal).estado, 'configurada', 'o principal não enxerga o marcador do worktree');
    const principal2 = repoComGit({ 'harness.config.json': JSON.stringify(CFG_GUARDA) });
    git(principal2, 'add', 'harness.config.json');
    git(principal2, 'commit', '-q', '-m', 'chore: config');
    const wt2 = join(mkdtempSync(join(tmpdir(), 'doctor-wt-')), 'wt');
    git(principal2, 'worktree', 'add', '-q', '-b', 'wt/GM-9-2', wt2);
    heartbeatLocal(principal2, 2);
    assert.equal(camada(principal2).estado, 'ativa');
    assert.equal(camada(wt2).estado, 'configurada', 'o worktree não herda o marcador do principal');
  });

  test('doctor-camada-permissions-deny: .claude/settings.json com a lista do instalador ⇒ permissions.deny', () => {
    const dir = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: DENY_GUARDA } }) });
    assert.equal(camada(dir).estado, 'permissions.deny');
    const alheio = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(ls:*)'] } }) });
    assert.equal(camada(alheio).estado, 'nenhuma', 'deny próprio, sem nenhuma entrada da guarda, não é a camada');
    const quebrado = repo({ '.claude/settings.json': '{ // comentário\n}' });
    assert.equal(camada(quebrado).estado, 'nenhuma');
  });

  test('doctor-camada-permissions-deny-parcial (M7): UMA entrada da lista não é a camada; as 7 são', () => {
    const uma = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Read(.env*)'] } }) });
    assert.equal(camada(uma).estado, 'nenhuma');
    const seis = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: DENY_GUARDA.slice(1) } }) });
    assert.equal(camada(seis).estado, 'nenhuma');
    const todas = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(ls:*)', ...DENY_GUARDA] } }) });
    assert.equal(camada(todas).estado, 'permissions.deny', 'lista própria somada às 7');
  });

  test('doctor-ignora-git-dir-herdado (M10-O4): GIT_DIR/GIT_WORK_TREE do ambiente não fazem o doctor listar OUTRO repositório', () => {
    const outro = repoComGit({ 'x.txt': 'x' });
    const dir = repoComGit({ 'AGENTS.md': agents(0), 'src/guard.ts': 'assertNotProduction()' });
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: join(outro, '.git'), GIT_WORK_TREE: outro } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).resultados.find((x) => x.id === 'R3-prod-guard').found, true);
  });

  test('doctor-camada-prioridade: ativa > configurada > permissions.deny', () => {
    const base = { '.claude/settings.json': JSON.stringify({ permissions: { deny: DENY_GUARDA } }) };
    assert.equal(camada(repo({ ...base, 'harness.config.json': JSON.stringify(CFG_GUARDA) })).estado, 'configurada');
    const ativa = repo({ ...base });
    heartbeatLocal(ativa, 1);
    assert.equal(camada(ativa).estado, 'ativa');
  });

  describe('ataques ao marcador (formato, caminho, tipo de arquivo, tamanho, git)', () => {
    const valido = (extra = {}) => ({ ts: horasAtras(1), sessao: 's1', arquivo: ARQ_DIARIO, ...extra });
    const comMarcador = (marcador, diario = `${hb(horasAtras(1))}\n`) => {
      const dir = repo({ ...cfg, [ARQ_DIARIO]: diario });
      arq(dir, '.harness/heartbeat.json', typeof marcador === 'string' ? marcador : JSON.stringify(marcador));
      return dir;
    };

    test('doctor-marcador-valido-base: o marcador mínimo do helper vale (controle dos ataques)', () => {
      assert.equal(camada(comMarcador(valido())).estado, 'ativa');
    });

    test('doctor-marcador-formato: JSON inválido, não-objeto, vazio e campos de tipo errado não valem', () => {
      for (const m of ['{ lixo', '', 'null', '[]', '"s"', '42', JSON.stringify(valido({ ts: 12345 })), JSON.stringify(valido({ sessao: 1 })), JSON.stringify(valido({ arquivo: ['x'] })), JSON.stringify({ sessao: 's1', arquivo: ARQ_DIARIO })]) {
        assert.equal(camada(comMarcador(m)).estado, 'configurada', m);
      }
    });

    test('doctor-marcador-ts: inválido, ausente, vazio e futuro (> 5 min) não valem; até 5 min à frente vale como 0 h', () => {
      for (const ts of ['ontem', '', '2026', '1', null]) {
        const dir = comMarcador(valido({ ts }), `${hb(ts)}\n`);
        assert.equal(camada(dir).estado, 'configurada', `ts=${JSON.stringify(ts)}`);
      }
      const futuro = new Date(AGORA + 3_600_000).toISOString();
      assert.equal(camada(comMarcador(valido({ ts: futuro }), `${hb(futuro)}\n`)).estado, 'configurada');
      const skew = new Date(AGORA + 60_000).toISOString();
      const c = camada(comMarcador(valido({ ts: skew }), `${hb(skew)}\n`));
      assert.equal(c.estado, 'ativa');
      assert.equal(c.heartbeatHa, 0);
    });

    test('doctor-marcador-arquivo-caminho: só .harness/entregas/<id>/events.*.jsonl; ../, absoluto, subpasta e outro nome não valem', () => {
      const fora = mkdtempSync(join(tmpdir(), 'doctor-fora-'));
      writeFileSync(join(fora, 'events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      for (const arquivo of ['../x/events.s1.jsonl', '.harness/entregas/../entregas/GM-9/events.s1.jsonl', '.harness/entregas/../../events.s1.jsonl', '.harness/entregas/../events.s1.jsonl', '.harness/entregas/./events.s1.jsonl', join(fora, 'events.s1.jsonl'), '/etc/passwd', '.harness/entregas/GM-9/outro.jsonl', '.harness/entregas/GM-9/sub/events.s1.jsonl', '.harness/events.s1.jsonl', '.harness/entregas/GM-9/events.s1.jsonl/', '.harness\\entregas\\GM-9\\events.s1.jsonl', '']) {
        const dir = repo({ ...cfg });
        arq(dir, '.harness/entregas/GM-9/outro.jsonl', `${hb(horasAtras(1))}\n`);
        arq(dir, '.harness/entregas/GM-9/sub/events.s1.jsonl', `${hb(horasAtras(1))}\n`);
        arq(dir, '.harness/events.s1.jsonl', `${hb(horasAtras(1))}\n`);
        arq(dir, ARQ_DIARIO, `${hb(horasAtras(1))}\n`);
        arq(dir, '.harness/heartbeat.json', JSON.stringify(valido({ arquivo })));
        assert.equal(camada(dir).estado, 'configurada', arquivo);
      }
    });

    test('doctor-marcador-nome-especial: id de entrega com espaço e não ASCII vale', () => {
      const dir = repo({ ...cfg });
      heartbeatLocal(dir, 1, { arquivo: '.harness/entregas/GM ação 9/events.s 1.jsonl', sessao: 's 1' });
      assert.equal(camada(dir).estado, 'ativa');
    });

    test('doctor-marcador-symlink: marcador, diário, entregas/<id> e entregas como symlink não valem', () => {
      const fora = mkdtempSync(join(tmpdir(), 'doctor-fora-'));
      const m = JSON.stringify(valido());
      writeFileSync(join(fora, 'm.json'), m);
      const a = repo({ ...cfg, [ARQ_DIARIO]: `${hb(horasAtras(1))}\n` });
      symlinkSync(join(fora, 'm.json'), join(a, '.harness/heartbeat.json'));
      assert.equal(camada(a).estado, 'configurada', 'marcador symlink');
      const b = repo({ ...cfg });
      writeFileSync(join(fora, 'ev.jsonl'), `${hb(horasAtras(1))}\n`);
      mkdirSync(join(b, '.harness/entregas/GM-9'), { recursive: true });
      symlinkSync(join(fora, 'ev.jsonl'), join(b, ARQ_DIARIO));
      arq(b, '.harness/heartbeat.json', m);
      assert.equal(camada(b).estado, 'configurada', 'diário symlink');
      const c = repo({ ...cfg });
      mkdirSync(join(c, '.harness/entregas'), { recursive: true });
      mkdirSync(join(fora, 'GM-9'));
      writeFileSync(join(fora, 'GM-9/events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      symlinkSync(join(fora, 'GM-9'), join(c, '.harness/entregas/GM-9'));
      arq(c, '.harness/heartbeat.json', m);
      assert.equal(camada(c).estado, 'configurada', 'diretório symlink');
      const d = repo({ ...cfg });
      mkdirSync(join(fora, 'e2/GM-9'), { recursive: true });
      writeFileSync(join(fora, 'e2/GM-9/events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      mkdirSync(join(d, '.harness'), { recursive: true });
      symlinkSync(join(fora, 'e2'), join(d, '.harness/entregas'));
      arq(d, '.harness/heartbeat.json', m);
      assert.equal(camada(d).estado, 'configurada', 'entregas symlink');
    });

    test('doctor-marcador-fifo: FIFO no lugar do marcador ou do diário não trava o doctor nem vale', () => {
      for (const alvo of ['.harness/heartbeat.json', ARQ_DIARIO]) {
        const dir = repo({ ...cfg });
        if (alvo === '.harness/heartbeat.json') arq(dir, ARQ_DIARIO, `${hb(horasAtras(1))}\n`);
        else arq(dir, '.harness/heartbeat.json', JSON.stringify(valido()));
        mkdirSync(dirname(join(dir, alvo)), { recursive: true });
        const mk = spawnSync('mkfifo', [join(dir, alvo)]);
        if (mk.status !== 0) return; // sem mkfifo na plataforma
        const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
        assert.equal(r.status, 0, `${alvo}: ${r.error?.message ?? r.stderr}`);
        assert.notEqual(JSON.parse(r.stdout).camada.estado, 'ativa', alvo);
      }
    });

    test('doctor-marcador-gigante: marcador > 64 KiB não vale, sem exceção; diário grande com a linha no meio vale', () => {
      const dir = comMarcador(JSON.stringify(valido({ lixo: 'x'.repeat(200 * 1024) })));
      assert.equal(camada(dir).estado, 'configurada');
      const lixo = `${JSON.stringify({ tipo: 'outro', ts: horasAtras(1), x: 'y'.repeat(80) })}\n`;
      const grande = repo({ ...cfg });
      heartbeatLocal(grande, 6, { linhas: [lixo.repeat(Math.ceil((2 * 1024 * 1024) / lixo.length))] });
      arq(grande, ARQ_DIARIO, readFileSync(join(grande, ARQ_DIARIO), 'utf8') + lixo.repeat(Math.ceil((2 * 1024 * 1024) / lixo.length)));
      assert.equal(camada(grande).estado, 'ativa', 'mais de 1 MiB de eventos depois do heartbeat não o esconde (M1)');
    });

    test('doctor-marcador-rastreado-nao-vale: marcador versionado por engano (git add -f) não dá ativa', () => {
      const dir = repoComGit({ ...cfg, '.gitignore': '.harness/heartbeat.json\n' });
      heartbeatLocal(dir, 1);
      assert.equal(camada(dir).estado, 'ativa', 'controle: ignorado e local vale');
      git(dir, 'add', '-f', '.harness/heartbeat.json', ARQ_DIARIO);
      assert.equal(camada(dir).estado, 'configurada');
      assert.equal(camada(dir).diario.ha, 1);
    });

    test('doctor-marcador-copiado-de-outra-arvore: marcador sem o diário correspondente nesta árvore não vale', () => {
      const origem = repo({ ...cfg });
      heartbeatLocal(origem, 1);
      const destino = repo({ ...cfg });
      arq(destino, '.harness/heartbeat.json', readFileSync(join(origem, '.harness/heartbeat.json'), 'utf8'));
      assert.equal(camada(destino).estado, 'configurada');
    });
  });

  describe('anotação do diário versionado (ts, linhas, tamanho, symlink, FIFO)', () => {
    const comLinhas = (linhas) => repo({ ...cfg, [ARQ_DIARIO]: linhas.join('\n') });

    test('doctor-camada-heartbeat-ts-invalido: "ontem", número, vazio e data sem hora não geram anotação', () => {
      for (const ts of ['ontem', 12345, '', '2026', '1', null]) {
        const c = camada(comLinhas([hb(ts)]));
        assert.equal(c.estado, 'configurada', `ts=${JSON.stringify(ts)}`);
        assert.equal(c.diario, null, `ts=${JSON.stringify(ts)}`);
      }
      assert.equal(camada(comLinhas([JSON.stringify({ tipo: 'guarda.heartbeat', dados: { fonte: 'local' } })])).diario, null);
    });

    test('doctor-camada-heartbeat-futuro: ts além de 5 min no futuro não vale; dentro da tolerância é 0 h', () => {
      assert.equal(camada(comLinhas([hb(new Date(AGORA + 3_600_000).toISOString())])).diario, null);
      assert.equal(camada(comLinhas([hb(new Date(AGORA + 60_000).toISOString())])).diario.ha, 0);
    });

    test('doctor-camada-heartbeat-linhas-ruins: null, string, array, truncada e outro tipo são ignorados; a boa vale', () => {
      const c = camada(comLinhas(['null', '"str"', '[]', '42', '{"tipo":"guarda.heartbeat","ts":"2026-11-02T1', JSON.stringify({ tipo: 'sessao.inicio', ts: horasAtras(1) }), JSON.stringify({ tipo: 'outro', ts: horasAtras(1), dados: 'guarda.heartbeat' }), hb(horasAtras(4))]));
      assert.equal(c.estado, 'configurada');
      assert.equal(c.diario.ha, 4);
      assert.equal(camada(comLinhas(['null', 'lixo'])).diario, null);
    });

    test('doctor-camada-heartbeat-arquivo-enorme: heartbeat no fim de 4 MiB vale; uma linha gigante sem quebra não gera nada', () => {
      const lixo = `${JSON.stringify({ tipo: 'outro', ts: horasAtras(1), x: 'y'.repeat(80) })}\n`;
      const dir = repo({ ...cfg });
      arq(dir, ARQ_DIARIO, lixo.repeat(Math.ceil((4 * 1024 * 1024) / lixo.length)) + `${hb(horasAtras(6))}\n`);
      assert.equal(camada(dir).diario.ha, 6);
      const dir2 = repo({ ...cfg });
      arq(dir2, ARQ_DIARIO, 'z'.repeat(5 * 1024 * 1024));
      assert.equal(camada(dir2).diario, null);
    });

    test('doctor-camada-heartbeat-muitas-entregas: com 120 entregas velhas, o arquivo mais recentemente escrito é o que anota', () => {
      const dir = repo({ ...cfg });
      const velho = new Date(AGORA - 30 * 86_400_000);
      for (let i = 0; i < 120; i++) {
        arq(dir, `.harness/entregas/GM-${i}/events.s${i}.jsonl`, `${hb(horasAtras(24 * 3))}\n`);
        utimesSync(join(dir, `.harness/entregas/GM-${i}/events.s${i}.jsonl`), velho, velho);
      }
      arq(dir, '.harness/entregas/GM-999/events.nova.jsonl', `${hb(horasAtras(2))}\n`);
      utimesSync(join(dir, '.harness/entregas/GM-999/events.nova.jsonl'), new Date(AGORA), new Date(AGORA));
      assert.equal(camada(dir).diario.ha, 2);
    });

    test('doctor-camada-heartbeat-nome: só events.*.jsonl diretamente em entregas/<id>/ anota', () => {
      const dir = repo({ ...cfg, '.harness/entregas/GM-9/outro.jsonl': `${hb(horasAtras(1))}\n`, '.harness/entregas/GM-9/sub/events.s1.jsonl': `${hb(horasAtras(1))}\n`, '.harness/events.s1.jsonl': `${hb(horasAtras(1))}\n` });
      assert.equal(camada(dir).diario, null);
    });

    test('doctor-camada-heartbeat-symlink: events.*.jsonl, entregas/<id> e entregas como symlink não anotam', () => {
      const fora = mkdtempSync(join(tmpdir(), 'doctor-fora-'));
      writeFileSync(join(fora, 'ev.jsonl'), `${hb(horasAtras(1))}\n`);
      const a = repo({ ...cfg });
      mkdirSync(join(a, '.harness/entregas/GM-9'), { recursive: true });
      symlinkSync(join(fora, 'ev.jsonl'), join(a, ARQ_DIARIO));
      assert.equal(camada(a).diario, null, 'arquivo symlink');
      const c = repo({ ...cfg });
      mkdirSync(join(c, '.harness'), { recursive: true });
      symlinkSync(fora, join(c, '.harness/entregas'));
      mkdirSync(join(fora, 'GM-7'));
      writeFileSync(join(fora, 'GM-7/events.s1.jsonl'), `${hb(horasAtras(1))}\n`);
      assert.equal(camada(c).diario, null, 'entregas symlink');
    });
  });
});

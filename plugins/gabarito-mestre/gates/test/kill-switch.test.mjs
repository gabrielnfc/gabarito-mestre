/**
 * Kill switch (GM-10, REQ-POU-2): `.harness/PAUSAR` na raiz da sessão, da cwd ou do checkout principal.
 *
 * MUTAÇÕES PRESCRITAS (JSON em .superpowers/sdd/2026-11-03-e2-loop/task-7-mut.json):
 *  K1  não tratar `Agent` ⇒ `pausar-nega-agent-orquestrador` falha
 *  K2  não tratar `Task` ⇒ `pausar-nega-agent-orquestrador` falha
 *  K3  negar o orquestrador em qualquer ferramenta ⇒ `pausar-orquestrador-le` falha
 *  K4  não negar subagent em ferramenta comum ⇒ `pausar-nega-tudo-subagent` falha
 *  K5  `existsSync` (symlink quebrado = ausente) ⇒ `pausar-existencia-vale` falha
 *  K6  ignorar o checkout principal ⇒ `pausar-worktree-obedece-principal` falha
 *  K7  mensagem diferente ⇒ `mensagem-nao-ensina-bypass` falha
 *  K8  erro de stat libera ⇒ `pausar-erro-de-stat-nao-libera` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, montar, rodar, eventosDe } from './_adaptador-helpers.mjs';

const MSG = 'pausado: /gabarito retomar';
const SUB = { agent_id: 'a1', agent_type: 'implementador' };

function pausar(repo, como = 'arquivo') {
  mkdirSync(join(repo, '.harness'), { recursive: true });
  const alvo = join(repo, '.harness', 'PAUSAR');
  if (como === 'arquivo') writeFileSync(alvo, '');
  else if (como === 'texto') writeFileSync(alvo, 'qualquer coisa\n');
  else if (como === 'diretorio') mkdirSync(alvo);
  else if (como === 'symlink-quebrado') symlinkSync(join(repo, 'nao-existe'), alvo);
  return alvo;
}

describe('pausado: Agent e subagent', () => {
  test('pausar-nega-agent-orquestrador: Agent e Task, a todos', () => {
    const repo = montar();
    pausar(repo);
    for (const tool of ['Agent', 'Task']) {
      for (const extra of [{}, SUB]) {
        const r = rodar(repo, tool, { description: 'x', prompt: 'y', subagent_type: 'revisor' }, extra);
        assert.equal(r.status, 0);
        assert.equal(r.decisao, 'deny', `${tool} ${JSON.stringify(extra)}`);
        assert.equal(r.motivo, MSG);
      }
    }
  });

  test('pausar-nega-tudo-subagent: nenhuma ferramenta, inclusive Read e MCP', () => {
    const repo = montar();
    pausar(repo);
    const casos = [
      ['Read', { file_path: join(repo, 'README.md') }],
      ['Write', { file_path: join(repo, 'a.txt'), content: 'x' }],
      ['Edit', { file_path: join(repo, 'README.md'), old_string: 'x', new_string: 'y' }],
      ['Bash', { command: 'ls' }],
      ['Grep', { pattern: 'x' }],
      ['Glob', { pattern: '*' }],
      ['mcp__servidor__ferramenta', { a: 1 }],
      ['SubagentHandback', { message: 'pronto' }],
    ];
    for (const [tool, input] of casos) {
      const r = rodar(repo, tool, input, SUB);
      assert.equal(r.decisao, 'deny', tool);
      assert.equal(r.motivo, MSG, tool);
    }
  });

  test('pausar-orquestrador-le: o orquestrador lê e edita sob pausa, e a guarda normal segue valendo', () => {
    const repo = montar();
    pausar(repo);
    for (const [tool, input] of [
      ['Read', { file_path: join(repo, 'README.md') }],
      ['Edit', { file_path: join(repo, 'README.md'), old_string: 'x', new_string: 'y' }],
      ['Write', { file_path: join(repo, 'a.txt'), content: 'x' }],
      ['Bash', { command: 'ls' }],
      ['mcp__servidor__ferramenta', { a: 1 }],
    ]) {
      const r = rodar(repo, tool, input);
      assert.equal(r.decisao, undefined, tool);
      assert.equal(r.stdout, '', tool);
    }
    const segredo = rodar(repo, 'Read', { file_path: join(repo, '.env') });
    assert.equal(segredo.decisao, 'ask');
    assert.notEqual(segredo.motivo, MSG);
  });

  test('sem-pausar-silencio: sem o arquivo nada muda, Agent inclusive', () => {
    const repo = montar();
    for (const [tool, input, extra] of [
      ['Agent', { description: 'x', prompt: 'y' }, {}],
      ['Task', { description: 'x', prompt: 'y' }, {}],
      ['Read', { file_path: join(repo, 'README.md') }, SUB],
      ['Bash', { command: 'ls' }, SUB],
    ]) {
      const r = rodar(repo, tool, input, extra);
      assert.equal(r.decisao, undefined, tool);
      assert.equal(r.stdout, '', tool);
    }
    assert.deepEqual(eventosDe(repo), []);
  });
});

describe('o deny por arquivo vale sempre', () => {
  test('pausar-sem-config-sem-remoto: config ausente, sem guarda.*, sem remoto', () => {
    for (const opcoes of [{ origem: null, remoto: false }, { origem: {}, remoto: false }, { origem: { versionamento: { branchPadrao: 'main' } }, remoto: true }]) {
      const repo = montar(opcoes);
      pausar(repo);
      const r = rodar(repo, 'Agent', { description: 'x', prompt: 'y' });
      assert.equal(r.decisao, 'deny', JSON.stringify(opcoes));
      assert.equal(r.motivo, MSG);
      assert.equal(rodar(repo, 'Read', { file_path: join(repo, 'README.md') }, SUB).decisao, 'deny');
    }
  });

  test('pausar-diario-indisponivel-nega: diário fora do ar não libera', () => {
    const repo = montar();
    pausar(repo);
    writeFileSync(join(repo, '.harness', 'entregas'), 'arquivo onde deveria haver diretório');
    const r = rodar(repo, 'Agent', { description: 'x', prompt: 'y' });
    assert.equal(r.decisao, 'deny');
    assert.equal(r.motivo, MSG);
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, 'README.md') }, SUB).decisao, 'deny');
  });

  test('pausar-registra-evento: loop.pausa {negado: tool}, sem conteúdo da chamada', () => {
    const repo = montar();
    pausar(repo);
    const r = rodar(repo, 'Agent', { description: 'descricao-sentinela', prompt: 'prompt-sentinela' });
    assert.equal(r.decisao, 'deny');
    const evs = eventosDe(repo);
    assert.equal(evs.length, 1);
    const linha = JSON.parse(evs[0].texto.trim().split('\n').pop());
    assert.equal(linha.tipo, 'loop.pausa');
    assert.deepEqual(linha.dados, { negado: 'Agent' });
    assert.equal(linha.agente, 'orquestrador');
    assert.doesNotMatch(evs[0].texto, /sentinela/);

    const s = rodar(repo, 'Read', { file_path: join(repo, 'README.md') }, SUB);
    assert.equal(s.decisao, 'deny');
    const todos = eventosDe(repo).map((e) => e.texto).join('');
    assert.match(todos, /"agente":"subagent:a1"/);
    assert.match(todos, /"negado":"Read"/);
  });
});

describe('o que conta como PAUSAR', () => {
  test('pausar-existencia-vale: vazio, com texto, diretório e symlink quebrado', () => {
    for (const como of ['arquivo', 'texto', 'diretorio', 'symlink-quebrado']) {
      const repo = montar();
      pausar(repo, como);
      const r = rodar(repo, 'Agent', { description: 'x', prompt: 'y' });
      assert.equal(r.decisao, 'deny', como);
      assert.equal(r.motivo, MSG, como);
    }
  });

  test('pausar-erro-de-stat-nao-libera: .harness ilegível não vira "sem pausa"', { skip: process.getuid?.() === 0 }, () => {
    const repo = montar();
    pausar(repo);
    chmodSync(join(repo, '.harness'), 0o000);
    try {
      const r = rodar(repo, 'Agent', { description: 'x', prompt: 'y' });
      assert.equal(r.status, 0);
      assert.equal(r.decisao, 'deny');
      assert.equal(r.motivo, MSG);
    } finally {
      chmodSync(join(repo, '.harness'), 0o755);
    }
  });
});

describe('raiz', () => {
  test('pausar-cwd-em-subdiretorio: sem CLAUDE_PROJECT_DIR, cwd dentro do repo', () => {
    const repo = montar();
    pausar(repo);
    const sub = join(repo, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const r = rodar(repo, 'Agent', { description: 'x', prompt: 'y' }, { cwd: sub }, { repo: null, cwd: sub });
    assert.equal(r.decisao, 'deny');
    assert.equal(r.motivo, MSG);
    assert.equal(rodar(repo, 'Read', { file_path: join(sub, 'x') }, { ...SUB, cwd: sub }, { repo: null, cwd: sub }).decisao, 'deny');
  });

  test('pausar-worktree-obedece-principal: PAUSAR só no checkout principal vale na worktree de task', () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-1', wt);
    pausar(repo);
    // sessão da worktree (CLAUDE_PROJECT_DIR = worktree), cwd na worktree e num subdiretório dela
    mkdirSync(join(wt, 'sub'));
    for (const cwd of [wt, join(wt, 'sub')]) {
      const r = rodar(wt, 'Read', { file_path: join(wt, 'README.md') }, { ...SUB, cwd });
      assert.equal(r.decisao, 'deny', cwd);
      assert.equal(r.motivo, MSG);
    }
    // sessão do principal, cwd na worktree (o agente entrou nela)
    const r2 = rodar(repo, 'Read', { file_path: join(wt, 'README.md') }, { ...SUB, cwd: wt });
    assert.equal(r2.decisao, 'deny');
    // o orquestrador na worktree ainda lê
    assert.equal(rodar(wt, 'Read', { file_path: join(wt, 'README.md') }).decisao, undefined);
  });

  test('pausar-worktree-propria: PAUSAR só na worktree vale nela e não no principal', () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-2', wt);
    pausar(wt);
    assert.equal(rodar(wt, 'Read', { file_path: join(wt, 'README.md') }, SUB).decisao, 'deny');
    assert.equal(rodar(repo, 'Read', { file_path: join(repo, 'README.md') }, SUB).decisao, undefined);
  });
});

describe('integridade e mensagem', () => {
  test('pausar-remocao-pelo-modelo-e-integridade: rm, mv e redirecionamento sobre PAUSAR', () => {
    const repo = montar();
    pausar(repo);
    for (const command of ['rm .harness/PAUSAR', 'mv .harness/PAUSAR /tmp/x', 'rm -f ./.harness/PAUSAR', ': > .harness/PAUSAR', `rm ${join(repo, '.harness', 'PAUSAR')}`]) {
      const o = rodar(repo, 'Bash', { command });
      assert.equal(o.decisao, 'ask', command);
      assert.match(o.motivo, /integridade/, command);
    }
    // sem a pausa ativa, o anel sozinho nega o subagent
    const livre = montar();
    for (const command of ['rm .harness/PAUSAR', 'mv .harness/PAUSAR /tmp/x', ': > .harness/PAUSAR']) {
      const s = rodar(livre, 'Bash', { command }, SUB);
      assert.equal(s.decisao, 'deny', command);
      assert.match(s.motivo, /integridade/, command);
    }
    // com a pausa ativa, o subagent leva a mensagem da pausa
    assert.equal(rodar(repo, 'Bash', { command: 'rm .harness/PAUSAR' }, SUB).decisao, 'deny');
  });

  // LACUNA RELATADA (fora do escopo da T7: aneis.ts): o anel resolve caminho absoluto só contra a raiz da cwd; o PAUSAR do
  // principal, visto da worktree, fica fora dela. `todo` registra a lacuna sem quebrar a suíte.
  test('pausar-remocao-pelo-principal-a-partir-da-worktree: caminho absoluto até o PAUSAR do principal', { todo: 'anel de integridade não cobre o checkout principal visto da worktree' }, () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-3', wt);
    pausar(repo);
    const o = rodar(wt, 'Bash', { command: `rm ${join(repo, '.harness', 'PAUSAR')}` });
    assert.equal(o.decisao, 'ask');
  });

  test('mensagem-nao-ensina-bypass: texto exato, sem systemMessage e sem caminho', () => {
    const repo = montar();
    pausar(repo);
    for (const [tool, extra] of [['Agent', {}], ['Read', SUB]]) {
      const r = rodar(repo, tool, { file_path: join(repo, 'README.md'), description: 'x', prompt: 'y' }, extra);
      assert.equal(r.motivo, MSG);
      assert.equal(r.systemMessage, '');
      const saida = JSON.parse(r.stdout);
      assert.deepEqual(Object.keys(saida), ['hookSpecificOutput']);
      assert.doesNotMatch(r.stdout, /PAUSAR|rm |apag|remov|touch|HARNESS|bypass|ignor/i);
    }
  });

  test('pausar-nao-cai-no-diario-do-modelo: sem ler PAUSAR (conteúdo não vira instrução)', () => {
    const repo = montar();
    pausar(repo, 'texto');
    const r = rodar(repo, 'Agent', { description: 'x', prompt: 'y' });
    assert.equal(r.motivo, MSG);
    assert.equal(readFileSync(join(repo, '.harness', 'PAUSAR'), 'utf8'), 'qualquer coisa\n');
  });
});

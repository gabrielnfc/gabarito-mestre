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
 *  W1  matcher de hooks.json sem `.*` ⇒ `matcher-cobre-glob` falha
 *  W2  handback negado sob pausa ⇒ `handback-passa-sob-pausa` falha
 *  W3  anel sem o `.harness/PAUSAR` absoluto ⇒ `pausar-absoluto-worktree-pede` falha
 *  R1  `raizesDePausa` sem o principal ⇒ os `pausar-*-principal-da-worktree-pede` falham
 *  R2  comparação do arquivo/diretório com caixa ⇒ `pausar-remover-arquivo-caixa-worktree-pede` falha
 *  R3  `ancestralDeIntegridade` sem `raizes` ⇒ `pausar-remover-raiz-principal-da-worktree-pede` falha
 *  R4  anel de `.harness` só na raiz do cwd ⇒ `pausar-remover-dir-principal-da-worktree-pede` falha
 *  R5  `raizPrincipal` com erro de leitura devolve null ⇒ `pausar-ponteiro-ilegivel-nao-libera` falha
 *  R6  `pausado` e o anel com listas de raízes diferentes ⇒ `pausar-pausa-e-anel-mesmas-raizes` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, git, montar, rodar, eventosDe } from './_adaptador-helpers.mjs';

const HOOKS = JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'hooks', 'hooks.json'), 'utf8'));
/** Quantos hooks de PreToolUse da guarda disparam para a ferramenta, pelo matcher real de hooks.json (anchorado como o Claude Code). */
function disparos(tool) {
  return HOOKS.hooks.PreToolUse.filter((g) => new RegExp(`^(?:${g.matcher})$`).test(tool) && g.hooks.some((h) => /guarda\.js/.test(h.command))).length;
}

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
      ['NotebookEdit', { notebook_path: join(repo, 'a.ipynb') }],
      ['WebFetch', { url: 'https://exemplo.com' }],
      ['FerramentaQueNaoExiste', {}],
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

describe('raiz da sessão e raiz do cwd valem cada uma (R1, R2)', () => {
  test('pausar-raiz-sessao-e-raiz-cwd: pausa só na sessão ou só no cwd nega', () => {
    const a = montar();
    const b = montar();
    pausar(a);
    assert.equal(rodar(a, 'Read', { file_path: join(b, 'README.md') }, { ...SUB, cwd: b }, { repo: a, cwd: b }).decisao, 'deny');
    assert.equal(rodar(b, 'Read', { file_path: join(a, 'README.md') }, { ...SUB, cwd: a }, { repo: b, cwd: a }).decisao, 'deny');
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

  test('pausar-absoluto-worktree-pede: caminho absoluto até o PAUSAR do principal, visto da worktree (Edit, Write e Bash)', () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-3', wt);
    const alvo = pausar(repo);
    for (const command of [`rm ${alvo}`, `mv ${alvo} /tmp/x`, `: > ${alvo}`]) {
      const o = rodar(wt, 'Bash', { command });
      assert.equal(o.decisao, 'ask', command);
    }
    for (const tool of ['Edit', 'Write']) {
      const o = rodar(wt, tool, { file_path: alvo, content: '', old_string: 'a', new_string: 'b' });
      assert.equal(o.decisao, 'ask', tool);
      assert.match(o.motivo, /integridade/, tool);
    }
  });

  test('pausar-cd-rm-pede: cd até o principal e rm relativo', () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-4', wt);
    pausar(repo);
    for (const command of [`cd ${repo} && rm .harness/PAUSAR`, `cd ${repo}; rm -f ./.harness/PAUSAR`]) {
      const o = rodar(wt, 'Bash', { command });
      assert.equal(o.decisao, 'ask', command);
      assert.match(o.motivo, /integridade/, command);
    }
  });

  test('subagent-pausar-absoluto-nega: o subagent leva deny no caminho absoluto, sem pausa ativa', () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-9-5', wt);
    const alvo = join(repo, '.harness', 'PAUSAR');
    assert.equal(rodar(wt, 'Bash', { command: `rm ${alvo}` }, SUB).decisao, 'deny');
    assert.equal(rodar(wt, 'Write', { file_path: alvo, content: '' }, SUB).decisao, 'deny');
  });

  test('pausar-ler-silencio: sem rede por texto (R4), ler o arquivo pelo Bash não pede; o anel de segredo segue valendo', () => {
    const repo = montar();
    pausar(repo);
    assert.equal(rodar(repo, 'Bash', { command: 'cat .harness/PAUSAR' }).decisao, undefined);
    assert.match(rodar(repo, 'Bash', { command: 'cat .env .harness/PAUSAR' }).motivo, /segredo/);
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

describe('o matcher de hooks.json cobre toda ferramenta', () => {
  test('matcher-cobre-glob: Glob, NotebookEdit, Skill, SendMessage e as demais disparam a guarda uma vez', () => {
    for (const tool of ['Glob', 'NotebookEdit', 'Skill', 'SendMessage', 'TodoWrite', 'ToolSearch', 'Monitor', 'TaskStop', 'EnterWorktree', 'Bash', 'Edit', 'Agent', 'mcp__x__y']) {
      assert.equal(disparos(tool), 1, tool);
    }
  });

  test('matcher-cobre-webfetch: WebFetch e WebSearch disparam, e o subagent leva deny sob pausa', () => {
    const repo = montar();
    pausar(repo);
    for (const tool of ['WebFetch', 'WebSearch']) {
      assert.equal(disparos(tool), 1, tool);
      const r = rodar(repo, tool, { url: 'https://exemplo.com', query: 'x' }, SUB);
      assert.equal(r.decisao, 'deny', tool);
      assert.equal(r.motivo, MSG, tool);
    }
  });

  test('handback-passa-sob-pausa: SubagentHandback dispara o hook e passa em silêncio; só o nome exato', () => {
    const repo = montar();
    pausar(repo);
    assert.equal(disparos('SubagentHandback'), 1);
    const r = rodar(repo, 'SubagentHandback', { message: 'pronto' }, SUB);
    assert.equal(r.decisao, undefined);
    assert.equal(r.stdout, '');
    for (const nome of ['subagenthandback', 'SubagentHandback2', 'XSubagentHandback']) {
      assert.equal(rodar(repo, nome, { message: 'x' }, SUB).decisao, 'deny', nome);
    }
  });

  test('ferramenta-desconhecida-negada-sob-pausa: subagent, qualquer nome; o orquestrador segue livre', () => {
    const repo = montar();
    pausar(repo);
    for (const tool of ['Glob', 'Skill', 'SendMessage', 'FerramentaDoFuturo']) {
      assert.equal(rodar(repo, tool, {}, SUB).decisao, 'deny', tool);
      assert.equal(rodar(repo, tool, {}).decisao, undefined, tool);
    }
  });

  test('sem-pausa-glob-silencio: sem o arquivo, ferramenta fora da lista sai em silêncio e sem diário', () => {
    const repo = montar();
    for (const [tool, input] of [['Glob', { pattern: '.env*' }], ['WebFetch', { url: 'https://api.exemplo.com' }], ['NotebookEdit', { notebook_path: join(repo, '.env') }], ['Skill', {}]]) {
      for (const extra of [{}, SUB]) {
        const r = rodar(repo, tool, input, extra);
        assert.equal(r.decisao, undefined, tool);
        assert.equal(r.stdout, '', tool);
      }
    }
    assert.deepEqual(eventosDe(repo), []);
  });

  test('sem-pausa-mcp-classifica: MCP de produção segue classificado pelo matcher `.*` (não cai no silêncio)', () => {
    const repo = montar({ origem: { ...CONFIG, guarda: { ...CONFIG.guarda, ambientes: { ...CONFIG.guarda.ambientes, prod: { ...CONFIG.guarda.ambientes.prod, mcps: ['mcp__prodsrv'] } } } } });
    const r = rodar(repo, 'mcp__prodsrv__execute_sql', { query: 'delete from t' });
    assert.equal(r.decisao, 'ask');
    assert.equal(rodar(repo, 'mcp__prodsrv__execute_sql', { query: 'delete from t' }, SUB).decisao, 'deny');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T7 rodada 3 (Sombra): o anel protege nas mesmas raízes em que a pausa é lida.

/** Principal com PAUSAR e uma worktree de task sem ele. `M` = principal visto da worktree. */
function cenario(nome) {
  const repo = montar();
  const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-r3-'))), 'wt');
  git(repo, 'worktree', 'add', '-q', '-b', `wt/${nome}`, wt);
  pausar(repo);
  return { repo, wt, M: repo };
}

describe('anel do PAUSAR nas mesmas raízes da pausa', () => {
  test('pausar-remover-arquivo-caixa-worktree-pede: o arquivo, qualquer caixa, remoção e escrita', () => {
    const { wt, M } = cenario('GM-R3-1');
    const cmds = [
      `rm ${M}/.harness/pausar`, `rm ${M}/.HARNESS/PAUSAR`, `rm ${M}/.Harness/Pausar`, `unlink ${M}/.harness/pausar`, `shred ${M}/.harness/pausar`,
      `mv ${M}/.harness/pausar /tmp/x`, `mv /tmp/x ${M}/.harness/pausar`, `mv /tmp/x ${M}/.HARNESS/PAUSAR`,
      `: > ${M}/.harness/pausar`, `echo x | tee ${M}/.harness/pausar`, `sed -i s/a/b/ ${M}/.harness/pausar`, `truncate -s 0 ${M}/.harness/pausar`,
      `chmod 000 ${M}/.harness/pausar`, `ln -sf /tmp/x ${M}/.harness/pausar`, `touch ${M}/.harness/pausar`,
    ];
    for (const command of cmds) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
      assert.equal(rodar(wt, 'Bash', { command }, SUB).decisao, 'deny', command);
    }
    for (const tool of ['Edit', 'Write']) {
      for (const file_path of [`${M}/.harness/pausar`, `${M}/.HARNESS/PAUSAR`]) {
        assert.equal(rodar(wt, tool, { file_path, content: '', old_string: 'a', new_string: 'b' }).decisao, 'ask', `${tool} ${file_path}`);
      }
    }
  });

  test('pausar-remover-dir-principal-da-worktree-pede: o diretório .harness do principal', () => {
    const { wt, M } = cenario('GM-R3-2');
    for (const command of [`rm -r ${M}/.harness`, `rm -rf ${M}/.harness/`, `rm -rf ${M}/.HARNESS`, `rmdir ${M}/.harness`, `mv ${M}/.harness /tmp/x`, `mv ${M}/.Harness /tmp/x`]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
      assert.equal(rodar(wt, 'Bash', { command }, SUB).decisao, 'deny', command);
    }
  });

  test('pausar-mover-dir-principal-da-worktree-pede: mv do diretório e da raiz, fonte', () => {
    const { wt, M } = cenario('GM-R3-3');
    for (const command of [`mv ${M}/.harness /tmp/y`, `mv ${M} /tmp/y`]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
    }
  });

  test('pausar-remover-raiz-principal-da-worktree-pede: a própria raiz do principal', () => {
    const { wt, M } = cenario('GM-R3-4');
    for (const command of [`rm -rf ${M}`, `rm -rf ${M}/`, `mv ${M} /tmp/y`]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
      assert.equal(rodar(wt, 'Bash', { command }, SUB).decisao, 'deny', command);
    }
  });

  test('pausar-cd-harness-rm-caixa-pede: cd literal até o principal e rm relativo, qualquer caixa', () => {
    const { wt, M } = cenario('GM-R3-5');
    for (const command of [
      `cd ${M} && rm .harness/PAUSAR`, `cd ${M} && rm .harness/pausar`, `cd ${M}/.harness && rm PAUSAR`, `cd ${M}/.harness; rm pausar`,
      `cd ${M}; rm -r .harness`, `cd ${M}; rm -rf .HARNESS`, `cd ${M}/.harness && mv pausar /tmp/x`,
    ]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
    }
  });

  test('pausar-formas-literais-pedem: ./, //, x/../, aspas, barra, bash -c, git -C', () => {
    const { wt, M } = cenario('GM-R3-6');
    for (const command of [
      `rm ${M}/./.harness/pausar`, `rm ${M}//.harness//pausar`, `rm ${M}/x/../.harness/pausar`, `rm "${M}/.harness/pausar"`, `rm '${M}/.harness/pausar'`,
      `rm ${M}/.harn\\ess/pausar`, `bash -c 'rm ${M}/.harness/pausar'`, `git -C ${M} rm -f .harness/pausar`, `rm -rf ${M}/./.harness`, `rm -rf ${M}/x/..`,
    ]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
    }
  });

  test('pausar-tabela-r2: os 7 comandos do achado 1, a partir da worktree com PAUSAR só no principal', () => {
    const { wt, M } = cenario('GM-R3-7');
    for (const command of [
      `rm ${M}/.harness/pausar`, `mv ${M}/.harness/pausar /tmp/x`, `cd ${M} && rm .harness/pausar`, `cd ${M}/.harness; rm pausar`,
      `rm ${M}/.HARNESS/PAUSAR`, `mv ${M}/.harness /tmp/x`, `rm -r ${M}/.harness`,
    ]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
    }
  });

  test('pausar-cwd-qualquer: da raiz principal, de subdiretório e de .harness o mesmo conjunto vale', () => {
    const { repo, wt, M } = cenario('GM-R3-8');
    mkdirSync(join(wt, 'sub'));
    for (const cwd of [repo, join(repo, '.harness'), wt, join(wt, 'sub')]) {
      for (const command of [`rm ${M}/.harness/pausar`, `rm -r ${M}/.harness`, `rm -rf ${M}`]) {
        assert.equal(rodar(repo, 'Bash', { command }, { cwd }).decisao, 'ask', `${cwd} ${command}`);
      }
    }
  });

  test('pausar-pausa-e-anel-mesmas-raizes: a raiz da sessão também protege (sessão e cwd em raízes diferentes)', () => {
    const { repo, wt } = cenario('GM-R3-9');
    const outro = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-r3o-'))), 'wt2');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-R3-9b', outro);
    // sessão = wt2 (worktree), cwd = wt; o principal é comum às duas
    assert.equal(rodar(outro, 'Bash', { command: `rm -r ${repo}/.harness` }, { cwd: wt }).decisao, 'ask');
    // sessão = wt, cwd num repo qualquer sem pausa: a raiz da sessão (e seu principal) ainda protege
    const fora = montar();
    assert.equal(rodar(wt, 'Bash', { command: `rm -r ${repo}/.harness` }, { cwd: fora }).decisao, 'ask');
    assert.equal(rodar(wt, 'Bash', { command: `rm -rf ${wt}` }, { cwd: fora }).decisao, 'ask');
  });

  test('pausar-harness-de-outro-repo-silencio: .harness fora das raízes de pausa não pede', () => {
    const { wt } = cenario('GM-R3-10');
    const outro = montar();
    for (const command of [`rm -rf ${outro}/.harness`, `rm -rf /tmp/x/.harness`, `rm -rf ${outro}`]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, undefined, command);
    }
  });

  test('pausar-limite-declarado: variável, glob, interpretador, find, pushd, git clean ficam como estão (Q26 item 4)', () => {
    const { wt, M } = cenario('GM-R3-11');
    for (const command of [
      `F=${M}/.harness/pausar; rm $F`, `rm ${M}/.harness/*`, `cd ${M}/.harness; rm -f *`, `python3 -c "import os; os.remove('${M}/.harness/pausar')"`,
      `node -e "require('fs').unlinkSync('${M}/.harness/pausar')"`, `find ${M}/.harness -delete`, `pushd ${M}/.harness && rm PAUSAR`, `git -C ${M} clean -fdx`,
    ]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, undefined, `limite: ${command}`);
    }
  });

  test('pausar-sem-pausa-silencio: sem PAUSAR em lugar nenhum a regra é a da E1', () => {
    const repo = montar();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-r3s-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-R3-12', wt);
    assert.equal(rodar(wt, 'Bash', { command: 'ls' }).decisao, undefined);
    assert.equal(rodar(wt, 'Bash', { command: 'rm -r .harness' }).decisao, 'ask');
  });
});

describe('R4: git mv|rm de .harness no anel, sem rede por texto', () => {
  test('git-mv-harness-no-anel: o diretório, o arquivo e a raiz, em qualquer grafia', () => {
    const { wt, M } = cenario('GM-R4-1');
    for (const command of [
      `git -C ${M} mv .harness z`, `cd ${M} && git mv .harness z`, `git mv ${M}/.harness z`, `git mv ${M}/.HARNESS z`, `git -C ${M} mv .HARNESS z`,
      `git mv ${M}/.harness/pausar z`, `git -C ${M} mv .harness/PAUSAR z`, `git mv x ${M}/.harness/pausar`, `git mv ${M} z`, `git -C ${M} mv .harness/ z`,
    ]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
      assert.equal(rodar(wt, 'Bash', { command }, SUB).decisao, 'deny', command);
    }
    assert.equal(rodar(M, 'Bash', { command: 'git mv .harness z' }).decisao, 'ask');
  });

  test('git-rm-harness-no-anel: o diretório e o arquivo, com -r, --cached, -f e -C', () => {
    const { wt, M } = cenario('GM-R4-2');
    for (const command of [
      `git -C ${M} rm -r .harness`, `git rm -r --cached ${M}/.harness`, `git -C ${M}/.harness rm -f PAUSAR`, `git -C ${M} rm .harness//pausar`,
      `git rm -rf ${M}/.HARNESS`, `git -C ${M} rm -f .harness/PAUSAR`, `git rm ${M}/.harness/pausar`, `git -C ${M} rm -r .harness/`,
    ]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
      assert.equal(rodar(wt, 'Bash', { command }, SUB).decisao, 'deny', command);
    }
  });

  test('git-C-principal-no-anel: -C muda a base dos caminhos relativos, também encadeado', () => {
    const { wt, M } = cenario('GM-R4-3');
    for (const command of [`git -C ${M} mv .harness z`, `git -C ${M} -C .harness rm PAUSAR`, `git -C ${M}/sub -C .. rm -r .harness`, `git -C ${M} -c core.x=1 rm -r .harness`]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', command);
    }
    // -C para outro repo não é raiz de pausa: silêncio
    const outro = montar();
    assert.equal(rodar(wt, 'Bash', { command: `git -C ${outro} mv .harness z` }).decisao, undefined);
  });

  test('commit-citando-pausar-nao-pede: só citar o caminho não é alvo, orquestrador e subagent', () => {
    const { wt } = cenario('GM-R4-4');
    for (const command of ['git commit -m "doc: .harness/PAUSAR para o loop"', 'git log --grep=.harness/PAUSAR', "git commit -m 'apaga .harness/PAUSAR da doc'"]) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, undefined, command);
    }
    const livre = montar();
    assert.equal(rodar(livre, 'Bash', { command: 'git commit -m "doc: .harness/PAUSAR"' }, SUB).decisao, undefined);
  });

  test('echo-citando-pausar-nao-pede: echo e grep com o caminho no texto', () => {
    const { wt } = cenario('GM-R4-5');
    for (const command of ['echo .harness/PAUSAR', 'echo "rm .harness/PAUSAR"', 'grep -r ".harness/PAUSAR" docs']) {
      assert.equal(rodar(wt, 'Bash', { command }).decisao, undefined, command);
    }
    const livre = montar();
    assert.equal(rodar(livre, 'Bash', { command: 'echo .harness/PAUSAR' }, SUB).decisao, undefined);
  });

  test('rm-pausar-segue-no-anel: toda remoção literal segue pelo anel, relativa e absoluta', () => {
    const { repo, wt, M } = cenario('GM-R4-6');
    for (const command of [
      'rm .harness/PAUSAR', 'rm -f .harness/pausar', 'unlink .harness/PAUSAR', 'mv .harness/PAUSAR /tmp/x', 'rm -r .harness', `rm ${M}/.harness/PAUSAR`,
      `cd ${M} && rm .harness/PAUSAR`, 'git rm -f .harness/PAUSAR', `bash -c 'rm ${M}/.harness/PAUSAR'`, 'rm ./.harness/PAUSAR', ': > .harness/PAUSAR',
    ]) {
      assert.equal(rodar(repo, 'Bash', { command }).decisao, 'ask', `principal: ${command}`);
      assert.equal(rodar(wt, 'Bash', { command }).decisao, 'ask', `worktree: ${command}`);
      assert.equal(rodar(wt, 'Bash', { command }, SUB).decisao, 'deny', `sub: ${command}`);
    }
  });
});

describe('contrato de falha: erro nunca libera', () => {
  test('pausar-ponteiro-ilegivel-nao-libera: .git da worktree ilegível com PAUSAR no principal ⇒ pausa vale', () => {
    const { wt } = cenario('GM-R3-13');
    chmodSync(join(wt, '.git'), 0o000);
    try {
      assert.equal(rodar(wt, 'Read', { file_path: join(wt, 'README.md') }, SUB).decisao, 'deny');
      assert.equal(rodar(wt, 'Agent', { description: 'x', prompt: 'y' }).decisao, 'deny');
    } finally {
      chmodSync(join(wt, '.git'), 0o644);
    }
  });

  test('pausar-raiz-nao-resolve-nao-libera: sem repo algum, o arquivo pelo nome continua protegido', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-kill-fora-')));
    assert.equal(rodar(null, 'Bash', { command: `rm ${fora}/.harness/pausar` }, { cwd: fora }, { repo: null, cwd: fora }).decisao, 'ask');
  });
});

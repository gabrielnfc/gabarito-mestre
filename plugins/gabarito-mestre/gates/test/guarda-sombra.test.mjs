/**
 * Guarda da Sombra e da entrega (GM-11 T12, REQ-SOM-4, REQ-ENT-2): hook real (`dist/guarda.js`) em repo git temporário.
 * Costura (P9): `guarda-aceita-prompt-devolvido-por-perguntar` roda `sombra.mjs perguntar` real e entrega o `prompt` devolvido à guarda.
 *
 * MUTAÇÕES PRESCRITAS: task-12-mut.json da entrega (comparar por prefixo; entrega pela branch; raiz do cwd; casar só no início; só Bash;
 * checagem depois de `classificavel`; sem caixa baixa; sem tirar aspas; "toda consulta"; ignorar model; `allow` no conferido; regex sem `i`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { montar, git, rodar, rodarBruto } from './_adaptador-helpers.mjs';
import { promptSombra } from '../dist/sombra.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'sombra.mjs');
const TIPO = 'gabarito-mestre:gabarito-sombra';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const SPEC = ['# Spec', '', '**REQ-A-1 Limite.** texto do REQ A1', ''].join('\n');
const PLANO = (entrega) => ({ entrega, spec: 'docs/spec.md', tasks: [{ id: 'T1', deps: [], arquivos: ['a.txt'], reqs: ['REQ-A-1'] }] });

/** Repo na branch GM-10 com spec e plano das entregas GM-10 e GM-77. */
function novo({ branch = 'feat/GM-10-x' } = {}) {
  const repo = montar({ branch });
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'spec.md'), SPEC);
  for (const e of ['GM-10', 'GM-77']) {
    mkdirSync(join(repo, '.harness', 'entregas', e), { recursive: true });
    writeFileSync(join(repo, '.harness', 'entregas', e, 'plano.json'), JSON.stringify(PLANO(e)));
  }
  return repo;
}

const sombraCli = (cwd, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.stdout.trim().split('\n').length, 1, `uma linha de JSON: ${r.stdout} / ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const perguntar = (cwd, pergunta = 'qual o limite?', extra = []) => {
  const o = sombraCli(cwd, ['perguntar', '--req', 'REQ-A-1', '--pergunta', pergunta, ...extra]);
  assert.equal(o.ok, true, JSON.stringify(o));
  return o;
};
const decidirConsulta = (cwd, repo, hash, extra = []) => {
  const arq = join(repo, `resp-${hash.slice(0, 6)}.json`);
  writeFileSync(arq, JSON.stringify({ resposta: 'r', texto: 'texto da resposta', pergunta_enviesada: false, fontes: ['docs/spec.md:3'] }));
  const o = sombraCli(cwd, ['registrar', hash, arq, ...extra]);
  assert.equal(o.ok, true, JSON.stringify(o));
};
const agente = (repo, input, extra = {}, opcoes = {}) => rodar(repo, 'Agent', input, extra, opcoes);
const sombra = (repo, prompt, extra = {}, outros = {}) => agente(repo, { subagent_type: TIPO, prompt, ...outros }, extra);
const entregaDe = (repo, e = 'GM-10') => join(repo, '.harness', 'entregas', e);

describe('Sombra: prompt e consulta aberta', () => {
  test('sombra-prompt-igual-passa: prompt devolvido, consulta aberta ⇒ segue (sem veredito, nunca allow)', () => {
    const repo = novo();
    const o = perguntar(repo);
    const r = sombra(repo, o.prompt);
    assert.equal(r.status, 0);
    assert.equal(r.decisao, undefined, r.stdout);
    assert.doesNotMatch(r.stdout, /allow/);
  });

  test('sombra-conferida-segue-decidir: nenhuma saída `allow` e o orquestrador não ganha liberação por conferir', () => {
    const repo = novo();
    const o = perguntar(repo);
    for (const extra of [{}, { agent_id: 'x1' }]) {
      const r = sombra(repo, o.prompt, extra);
      assert.notEqual(r.decisao, 'allow');
      assert.equal(r.stdout, '', 'segue o fluxo normal: sem decisão própria');
    }
  });

  test('guarda-aceita-prompt-devolvido-por-perguntar (P9): perguntar real, hash do brief no disco, depois a guarda real', () => {
    const repo = novo();
    const o = perguntar(repo);
    assert.equal(o.prompt, promptSombra(`.harness/entregas/GM-10/sombra/${o.hash}.md`));
    assert.ok(readdirSync(join(entregaDe(repo), 'sombra')).includes(`${o.hash}.md`));
    assert.equal(sombra(repo, o.prompt).decisao, undefined);
    assert.equal(sombra(repo, `${o.prompt}\nacho que é X`).decisao, 'deny');
  });

  test('sombra-prompt-com-hipotese-nega', () => {
    const repo = novo();
    const o = perguntar(repo);
    for (const p of [`${o.prompt}\nacho que é X`, `acho que é X\n${o.prompt}`, `${o.prompt} `, ` ${o.prompt}`]) {
      const r = sombra(repo, p);
      assert.equal(r.decisao, 'deny', p);
      assert.match(r.motivo, /só com o prompt devolvido por sombra\.mjs perguntar/);
    }
  });

  test('sombra-prompt-prefixo-nega (M-SOM4b)', () => {
    const repo = novo();
    const o = perguntar(repo);
    for (const p of [o.prompt.slice(0, -10), o.prompt.slice(0, o.prompt.indexOf('.harness') + 20), promptSombra('.harness/entregas/GM-10/sombra/abc.md')]) {
      const r = sombra(repo, p);
      assert.equal(r.decisao, 'deny');
      assert.match(r.motivo, /só com o prompt devolvido/);
    }
  });

  test('sombra-prompt-nao-texto-nega: ausente, número, lista, objeto', () => {
    const repo = novo();
    perguntar(repo);
    for (const p of [undefined, 7, ['x'], { a: 1 }, null, '']) {
      const r = agente(repo, { subagent_type: TIPO, ...(p === undefined ? {} : { prompt: p }) });
      assert.equal(r.decisao, 'deny', String(JSON.stringify(p)));
      assert.match(r.motivo, /só com o prompt devolvido/);
    }
  });

  test('sombra-prompt-caminho-fora-do-molde-nega: entrega minúscula, hash curto, .. no caminho', () => {
    const repo = novo();
    const o = perguntar(repo);
    for (const c of [`.harness/entregas/gm-10/sombra/${o.hash}.md`, `.harness/entregas/GM-10/sombra/${o.hash.slice(1)}.md`, `.harness/entregas/GM-10/../GM-10/sombra/${o.hash}.md`, `.harness/entregas/GM-10/sombra/${o.hash.toUpperCase()}.md`]) {
      assert.equal(sombra(repo, promptSombra(c)).decisao, 'deny', c);
    }
  });

  test('sombra-sem-consulta-aberta-nega: hash nunca consultado, com pasta da entrega existente', () => {
    const repo = novo();
    perguntar(repo, 'outra pergunta');
    const r = sombra(repo, promptSombra(`.harness/entregas/GM-10/sombra/${sha256('nunca')}.md`));
    assert.equal(r.decisao, 'deny');
    assert.match(r.motivo, /sem consulta aberta/);
  });

  test('sombra-consulta-ja-decidida-nega', () => {
    const repo = novo();
    const o = perguntar(repo);
    assert.equal(sombra(repo, o.prompt).decisao, undefined);
    decidirConsulta(repo, repo, o.hash);
    const r = sombra(repo, o.prompt);
    assert.equal(r.decisao, 'deny');
    assert.match(r.motivo, /sem consulta aberta/);
  });

  test('sombra-diario-ausente-x-ilegivel-x-fora-de-ordem: três motivos distintos', () => {
    const hash = sha256('qualquer');
    const caminho = (e) => `.harness/entregas/${e}/sombra/${hash}.md`;
    // ausente: pasta da entrega não existe
    const a = novo();
    const ra = sombra(a, promptSombra(caminho('GM-99')));
    assert.equal(ra.decisao, 'deny');
    assert.match(ra.motivo, /sem consulta aberta/);
    assert.doesNotMatch(ra.motivo, /ilegível|fora de ordem/);
    // ilegível: cadeia de hash quebrada
    const i = novo();
    const oi = perguntar(i);
    const arq = join(entregaDe(i), readdirSync(entregaDe(i)).find((n) => /^events\..+\.jsonl$/.test(n)));
    writeFileSync(arq, `${JSON.stringify({ seq: 1, ts: '2026-11-09T10:00:00.000Z', sessao: 'loop', tipo: 'x', dados: {}, hash_anterior: 'adulterado' })}\n`);
    const ri = sombra(i, oi.prompt);
    assert.equal(ri.decisao, 'deny');
    assert.match(ri.motivo, /diário ilegível/);
    assert.doesNotMatch(ri.motivo, /sem consulta aberta|fora de ordem/);
    // fora de ordem: cadeia íntegra, mas a mesma sessão repete `seq` em dois arquivos
    const f = novo();
    const of = perguntar(f);
    const l = JSON.stringify({ seq: 1, ts: '2026-11-09T10:00:00.000Z', autor: 'x', sessao: 'loop', agente: 'o', tipo: 'ci.resultado', dados: { verde: true }, hash_anterior: null });
    const l2 = JSON.stringify({ seq: 1, ts: '2026-11-09T10:00:00.000Z', autor: 'x', sessao: 'loop', agente: 'o', tipo: 'ci.resultado', dados: { verde: true }, hash_anterior: null });
    writeFileSync(join(entregaDe(f), 'events.loop.jsonl'), `${l}\n`);
    writeFileSync(join(entregaDe(f), 'events.loop2.jsonl'), `${l2}\n`);
    const rf = sombra(f, of.prompt);
    assert.equal(rf.decisao, 'deny');
    assert.match(rf.motivo, /diário fora de ordem/);
    assert.doesNotMatch(rf.motivo, /sem consulta aberta|ilegível/);
  });

  test('sombra-diario-pasta-nao-listavel-e-ilegivel: pasta sem permissão de leitura não vira "ausente"', (t) => {
    const repo = novo();
    const o = perguntar(repo);
    chmodSync(entregaDe(repo), 0o000);
    t.after(() => chmodSync(entregaDe(repo), 0o755));
    const r = sombra(repo, o.prompt);
    assert.equal(r.decisao, 'deny');
    assert.match(r.motivo, /diário ilegível/);
  });

  test('sombra-tipo-com-prefixo-e-caixa: casa `Gabarito-Mestre:GABARITO-SOMBRA`, não casa `gabarito-sombra-x` nem `my-gabarito-sombra`', () => {
    const repo = novo();
    const errado = promptSombra('x');
    assert.equal(agente(repo, { subagent_type: 'Gabarito-Mestre:GABARITO-SOMBRA', prompt: errado }).decisao, 'deny');
    assert.equal(agente(repo, { subagent_type: 'gabarito-sombra', prompt: errado }).decisao, 'deny');
    assert.equal(agente(repo, { subagent_type: 'a:b:gabarito-sombra', prompt: errado }).decisao, 'deny');
    for (const t of ['gabarito-sombra-x', 'my-gabarito-sombra', 'gabarito-sombra:x', 'xgabarito-sombra']) {
      assert.equal(agente(repo, { subagent_type: t, prompt: errado }).decisao, undefined, t);
    }
    assert.equal(agente(repo, { prompt: errado }).decisao, undefined, 'sem subagent_type');
    assert.equal(agente(repo, { subagent_type: 7, prompt: errado }).decisao, undefined, 'subagent_type que não é texto');
    assert.equal(agente(repo, { subagent_type: ['gabarito-sombra'], prompt: errado }).decisao, undefined, 'lista com um texto não é texto');
  });

  test('outro-agente-nao-confere: general-purpose com o brief e a hipótese passa (limite declarado)', () => {
    const repo = novo();
    const r = agente(repo, { subagent_type: 'general-purpose', prompt: 'leia o brief e eu acho que é X' });
    assert.equal(r.decisao, undefined);
    assert.equal(r.stdout, '');
  });

  test('sombra-sem-repositorio-nega: cwd fora de repo git não tem diário ⇒ sem consulta aberta (e sem exceção)', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'gm-sombra-fora-')));
    const r = rodarBruto(JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: TIPO, prompt: promptSombra(`.harness/entregas/GM-10/sombra/${sha256('a')}.md`) }, session_id: 'fora-1', cwd: fora }), { cwd: fora });
    assert.equal(r.decisao, 'deny');
    assert.match(r.motivo, /sem consulta aberta/);
  });

  test('tool Task também confere', () => {
    const repo = novo();
    const r = rodar(repo, 'Task', { subagent_type: TIPO, prompt: 'qualquer coisa' });
    assert.equal(r.decisao, 'deny');
  });

  test('sombra-entrega-do-caminho-nao-da-branch (C14, P9): `--entrega GM-77` com a branch em GM-10', () => {
    const repo = novo();
    const o = perguntar(repo, 'qual o limite?', ['--entrega', 'GM-77']);
    assert.match(o.brief, /entregas\/GM-77\//);
    assert.equal(sombra(repo, o.prompt).decisao, undefined);
    // a consulta existe só em GM-77: o mesmo hash lido no diário de GM-10 (a branch) é "sem consulta"
    const noutra = promptSombra(`.harness/entregas/GM-10/sombra/${o.hash}.md`);
    assert.equal(sombra(repo, noutra).decisao, 'deny');
  });

  test('sombra-de-worktree-usa-principal (C14): sessão aberta numa worktree de task lê o diário do principal', () => {
    const repo = novo();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-sombra-wt-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-10-1', wt);
    const o = perguntar(wt, 'qual o limite?', ['--entrega', 'GM-10']);
    assert.equal(sombra(repo, o.prompt).decisao, undefined, 'sessão no principal');
    const r = rodar(wt, 'Agent', { subagent_type: TIPO, prompt: o.prompt });
    assert.equal(r.decisao, undefined, `sessão na worktree: ${r.motivo}`);
    assert.equal(rodar(wt, 'Agent', { subagent_type: TIPO, prompt: `${o.prompt}x` }).decisao, 'deny');
  });

  test('sombra-worktree-ponteiro-ilegivel-nega (S3): a pausa (commondir ilegível) vem antes e nega; S3 é a rede de baixo', () => {
    const repo = novo();
    const o = perguntar(repo);
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'gm-sombra-wt2-'))), 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt/GM-10-2', wt);
    const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSyncTexto(join(wt, '.git')))[1];
    chmodSync(join(gitdir, 'commondir'), 0o000);
    try {
      const r = rodar(wt, 'Agent', { subagent_type: TIPO, prompt: o.prompt });
      assert.equal(r.decisao, 'deny');
      assert.match(r.motivo, /pausado/);
    } finally {
      chmodSync(join(gitdir, 'commondir'), 0o644);
    }
  });

  test('sombra-idpadrao-proprio-passa: `fluxo.idPadrao` que não é [A-Z]+-\\d+ não muda a leitura (a guarda não usa idDaEntrega)', () => {
    const cfg = { guarda: { ambientes: { teste: { hosts: ['127.0.0.1'] } }, producao: { permitidos: [] } }, versionamento: { branchPadrao: 'main' }, fluxo: { idPadrao: 'ABC#(\\d+)' } };
    const repo = montar({ origem: cfg, branch: 'feat/ABC#55-x' });
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'spec.md'), SPEC);
    mkdirSync(join(repo, '.harness', 'entregas', 'GM-10'), { recursive: true });
    writeFileSync(join(repo, '.harness', 'entregas', 'GM-10', 'plano.json'), JSON.stringify(PLANO('GM-10')));
    const o = perguntar(repo, 'qual o limite?', ['--entrega', 'GM-10']);
    assert.equal(sombra(repo, o.prompt).decisao, undefined);
  });

  test('sombra-model-haiku-nega (C19)', () => {
    const repo = novo();
    const o = perguntar(repo);
    for (const m of ['haiku', 'claude-3-5-sonnet-latest', 'SONNET', 'desconhecido', 7]) {
      const r = sombra(repo, o.prompt, {}, { model: m });
      assert.equal(r.decisao, 'deny', String(m));
      assert.match(r.motivo, /Sombra só em Opus/);
    }
  });

  test('sombra-model-opus-passa: opus, claude-opus-4-1, fable ou sem model', () => {
    const repo = novo();
    const o = perguntar(repo);
    for (const m of ['opus', 'claude-opus-4-1', 'Opus', 'fable', undefined]) {
      const r = sombra(repo, o.prompt, {}, m === undefined ? {} : { model: m });
      assert.equal(r.decisao, undefined, String(m));
    }
  });

  test('pausa-vence-sombra: sob PAUSAR o prompt certo é negado pela pausa', () => {
    const repo = novo();
    const o = perguntar(repo);
    mkdirSync(join(repo, '.harness'), { recursive: true });
    writeFileSync(join(repo, '.harness', 'PAUSAR'), '');
    const r = sombra(repo, o.prompt);
    assert.equal(r.decisao, 'deny');
    assert.match(r.motivo, /pausado/);
  });
});

describe('entrega só pelo orquestrador (C15, C16, C17)', () => {
  const sub = { agent_id: 'sub1' };
  const nega = (repo, tool, input, extra = sub) => {
    const r = rodar(repo, tool, input, extra);
    assert.equal(r.decisao, 'deny', `${tool} ${JSON.stringify(input)}: ${r.stdout}`);
    assert.match(r.motivo, /entrega só pelo orquestrador/);
  };
  const segue = (repo, tool, input, extra = sub) => {
    const r = rodar(repo, tool, input, extra);
    assert.doesNotMatch(r.motivo, /entrega só pelo orquestrador/, JSON.stringify(input));
    return r;
  };

  test('subagent-entrega-mjs-caixa-nega', () => {
    nega(montar(), 'Bash', { command: 'node scripts/ENTREGA.MJS executar' });
  });

  test('subagent-entrega-mjs-qualquer-posicao: rtk, ;, xargs', () => {
    const repo = montar();
    for (const command of ['rtk node x/entrega.mjs', 'echo a; node entrega.mjs', 'ls | xargs node entrega.mjs', 'cd x && ./entrega.mjs']) nega(repo, 'Bash', { command });
  });

  test('subagent-monitor-entrega-mjs-nega (C15): Monitor não é classificável e saía calado', () => {
    nega(montar(), 'Monitor', { command: 'node x/entrega.mjs executar' });
  });

  test('subagent-ferramenta-desconhecida-com-command-nega', () => {
    const repo = montar();
    nega(repo, 'PowerShell', { command: 'node entrega.mjs' });
    nega(repo, 'FerramentaNova', { command: 'node entrega.mjs', outro: 1 });
  });

  test('subagent-aspas-e-barra-negam (C16)', () => {
    const repo = montar();
    for (const command of ['node ent"rega".mjs', "node ent'rega'.mjs", 'node entrega.mj\\s', 'node ent`rega`.mjs']) nega(repo, 'Bash', { command });
  });

  test('subagent-glob-e-montado-passam-declarado (C16): limite do cabeçalho', () => {
    const repo = montar();
    segue(repo, 'Bash', { command: 'node scripts/entr*.mjs' });
    segue(repo, 'Bash', { command: "node -e \"require('./'+'entrega'+'.mjs')\"" });
    segue(repo, 'Bash', { command: 'node $X' });
  });

  test('subagent-git-diff-entrega-mjs-nega-declarado (C17): falso positivo aceito', () => {
    nega(montar(), 'Bash', { command: 'git diff -- gates/scripts/entrega.mjs' });
  });

  test('subagent-read-entrega-mjs-segue: Read/Edit/Grep com o caminho não têm `command`', () => {
    const repo = montar();
    for (const [tool, input] of [['Read', { file_path: 'gates/scripts/entrega.mjs' }], ['Grep', { pattern: 'x', path: 'gates/scripts/entrega.mjs' }], ['Edit', { file_path: 'gates/scripts/entrega.mjs', old_string: 'a', new_string: 'b' }]]) {
      assert.doesNotMatch(rodar(repo, tool, input, sub).motivo, /entrega só pelo orquestrador/, tool);
    }
  });

  test('command que não é texto segue (E1)', () => {
    const repo = montar();
    for (const command of [7, ['entrega.mjs'], { a: 'entrega.mjs' }]) {
      const r = rodar(repo, 'Monitor', { command }, sub);
      assert.doesNotMatch(r.motivo, /entrega só pelo orquestrador/);
      assert.equal(r.stdout, '', `segue calado, sem cair no último recurso: ${r.stdout}`);
    }
  });

  test('orquestrador-entrega-mjs-segue: sem agent_id ou com agent_id vazio, a guarda normal', () => {
    const repo = montar();
    for (const extra of [{}, { agent_id: '' }]) {
      const r = rodar(repo, 'Bash', { command: 'node x/entrega.mjs executar' }, extra);
      assert.doesNotMatch(r.motivo, /entrega só pelo orquestrador/);
    }
    assert.doesNotMatch(rodar(montar(), 'Monitor', { command: 'node entrega.mjs' }).motivo, /entrega só pelo orquestrador/);
  });

  test('comando benigno de subagent segue', () => {
    assert.doesNotMatch(rodar(montar(), 'Bash', { command: 'ls' }, sub).motivo, /entrega só pelo orquestrador/);
  });

  test('pausa vence a entrega: mensagem de pausa, não a da entrega', () => {
    const repo = montar();
    mkdirSync(join(repo, '.harness'), { recursive: true });
    writeFileSync(join(repo, '.harness', 'PAUSAR'), '');
    const r = rodar(repo, 'Bash', { command: 'node entrega.mjs' }, sub);
    assert.match(r.motivo, /pausado/);
  });

  test('entrega: subagent que pede a Sombra é checado pela Sombra, a entrega vem antes só com `command`', () => {
    const repo = novo();
    const o = perguntar(repo);
    const r = sombra(repo, o.prompt, sub);
    assert.equal(r.decisao, undefined);
  });
});

import { readFileSync } from 'node:fs';
function readFileSyncTexto(p) { return readFileSync(p, 'utf8'); }

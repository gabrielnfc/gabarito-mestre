/**
 * `avaliar.mjs relatorio 0` (GM-10 T13 r6): o critério é "guarda.deny do implementador EM CAMINHO DE TRABALHO = 0" (sombra-t13e.md, (a)).
 *  - todo implementador conta, não só o 1º (`denyImpl` olhava `impl[0]`);
 *  - `alvo .git` (leitura de lista negada pela guarda, T24) vira `deny_leitura_de_lista` e não reprova.
 * MUTAÇÕES: M1 voltar a olhar só `impl[0]` ⇒ `deny-do-2o-implementador-reprova`; M2 contar `alvo .git` como falha ⇒ `deny-git-do-implementador-so-relata`;
 * M3 ignorar o `alvo` e nunca falhar ⇒ `deny-do-2o-implementador-reprova`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(AQUI, '..', '..');
const AVALIAR = join(AQUI, 'e2e', 'avaliar.mjs');
const IMPL = 'gabarito-mestre:gabarito-implementador';
const S = '33333333-0000-4000-8000-000000000003';
const A = 'aaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbb';

async function corrida(denys) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'aval0-'));
  const repo = join(base, 'repo');
  const run = join(base, 'run');
  const dir = join(repo, '.harness', 'entregas', 'GM-99');
  mkdirSync(dir, { recursive: true });
  mkdirSync(run, { recursive: true });
  const d = await import(pathToFileURL(join(PLUGIN, 'gates', 'dist', 'diario.js')).href);
  const ev = (agente, tipo, dados) => d.append(dir, S, { ts: new Date().toISOString(), autor: 'a@b.c', sessao: S, agente, tipo, dados });
  ev('orquestrador', 'sessao.pouso', { percent: 5, x: 1 });
  ev('orquestrador', 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
  ev('orquestrador', 'task.concluida', { task: 'T1', sha: 'a'.repeat(40) });
  for (const [ag, alvo] of denys) ev(`subagent:${ag}`, 'guarda.deny', { acao: 'escrita', alvo, anel: 'integridade' });
  const pre = (agent) => JSON.stringify({ ev: 'PreToolUse', agent, agent_type: IMPL, cwd: repo, project_dir: repo });
  writeFileSync(join(run, 'classic.jsonl'), `${pre(A)}\n${pre(B)}\n`);
  const r = spawnSync('node', [AVALIAR, 'relatorio', '0', repo, run, PLUGIN], { encoding: 'utf8' });
  return JSON.parse(r.stdout);
}

test('deny-do-2o-implementador-reprova: o deny de um implementador que não é o 1º conta', async () => {
  const o = await corrida([[B, 'src/b.mjs']]);
  assert.equal(o.implementadores_distintos, 2);
  assert.equal(o.deny_implementador, 1);
  assert.ok(o.falhas.includes('guarda.deny do implementador em caminho de trabalho > 0'));
});

test('deny-git-do-implementador-so-relata: alvo .git é leitura de lista, relatada e sem reprovar', async () => {
  const o = await corrida([[A, '.git'], [B, '.git']]);
  assert.equal(o.deny_implementador, 0);
  assert.equal(o.deny_leitura_de_lista, 2);
  assert.ok(!o.falhas.includes('guarda.deny do implementador em caminho de trabalho > 0'));
});

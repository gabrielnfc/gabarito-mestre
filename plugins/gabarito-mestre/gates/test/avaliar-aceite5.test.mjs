/**
 * `avaliar.mjs relatorio 5` (GM-10 T13 r7, D2): o `TMPDIR` da task nasce DENTRO do `TMPDIR` do shell (`<ext>/gabarito-<hash>`), FORA da worktree.
 * O instrumento mede `ext` SEM a pasta da task (senão reprova por instrumento) e já não exige `.tmp-gabarito` (REQ-LOOP-2 só guarda os achados).
 * CLI de mentira (`loop.mjs` de plugin falso): `abrir`/`fechar` com 4 comportamentos. O comando de teste grava 5 KB no `TMPDIR` que recebeu.
 * MUTAÇÕES: M1 medir `ext` com a pasta da task ⇒ `pasta-estavel-com-conteudo-verde` (REPROVADO por instrumento; nos outros casos a pasta nasce vazia e a mutação é equivalente); M2 tirar o critério "fora da worktree" ⇒
 * `dentro-da-worktree-reprova`; M3 tirar "pasta da task some" ⇒ `fechar-sem-apagar-reprova`; M4 tirar "ext sem a da task igual" ⇒ `resto-em-ext-reprova`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AVALIAR = join(dirname(fileURLToPath(import.meta.url)), 'e2e', 'avaliar.mjs');

const CLI = `
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [cmd] = process.argv.slice(2);
const modo = process.env.STUB_MODO;
const wt = join(process.cwd(), '.harness', 'worktrees', 'T1');
const tmp = modo === 'dentro' ? join(wt, '.tmp-gabarito') : join(process.env.TMPDIR, 'gabarito-stub');
if (cmd === 'abrir') {
  mkdirSync(wt, { recursive: true }); mkdirSync(tmp, { recursive: true });
  if (modo === 'reuso') writeFileSync(join(tmp, 'anterior.bin'), 'y'.repeat(8192)); // pasta estável por worktree: um \`abrir\` repetido a devolve com o que já tinha
  console.log(JSON.stringify({ ok: true, worktree: wt, tmpdir: tmp, env: { TMPDIR: tmp } }));
} else {
  if (modo !== 'nao-apaga') rmSync(tmp, { recursive: true, force: true });
  if (modo === 'resto') writeFileSync(join(process.env.TMPDIR, 'sobra.bin'), 'x'.repeat(8192));
  rmSync(wt, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true }));
}
`;

function rodar(modo) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'aval5-'));
  const plugin = join(base, 'plugin');
  mkdirSync(join(plugin, 'gates', 'scripts'), { recursive: true });
  writeFileSync(join(plugin, 'gates', 'scripts', 'loop.mjs'), CLI);
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });
  const run = join(base, 'run');
  mkdirSync(run, { recursive: true });
  // `ext` = `<run>/tmp-externo` é o TMPDIR do shell; a CLI de mentira o lê do ambiente herdado.
  const r = spawnSync('node', [AVALIAR, 'relatorio', '5', repo, run, plugin, '.', 'node', '-e', "require('fs').writeFileSync(process.env.TMPDIR + '/dado.bin', 'x'.repeat(5000))"], { encoding: 'utf8', env: { ...process.env, STUB_MODO: modo } });
  return { rc: r.status, rel: JSON.parse(r.stdout) };
}

test('fora-da-worktree-verde: TMPDIR da task dentro de ext, fora da worktree, apagado no fechar', () => {
  const { rc, rel } = rodar('fora');
  assert.equal(rel.veredito_final, 'VERDE', JSON.stringify(rel.falhas));
  assert.equal(rc, 0);
  assert.equal(rel.tmpdir_fora_da_worktree, true);
  assert.equal(rel.tmpdir_dentro_do_tmpdir_do_shell, true);
  assert.equal(rel.tmpdir_da_task_existe_depois, false);
});

test('dentro-da-worktree-reprova: TMPDIR da task em <worktree>/.tmp-gabarito', () => {
  const { rc, rel } = rodar('dentro');
  assert.equal(rel.veredito_final, 'REPROVADO');
  assert.notEqual(rc, 0);
  assert.ok(rel.falhas.some((f) => /dentro da worktree/.test(f)), JSON.stringify(rel.falhas));
});

test('fechar-sem-apagar-reprova: a pasta da task continua depois do fechar', () => {
  const { rel } = rodar('nao-apaga');
  assert.equal(rel.veredito_final, 'REPROVADO');
  assert.ok(rel.falhas.some((f) => /existe depois do fechar/.test(f)), JSON.stringify(rel.falhas));
});

test('resto-em-ext-reprova: sobra fora da pasta da task em ext é vazamento', () => {
  const { rel } = rodar('resto');
  assert.equal(rel.veredito_final, 'REPROVADO');
  assert.ok(rel.falhas.some((f) => /pasta externa/.test(f)), JSON.stringify(rel.falhas));
});

test('pasta-estavel-com-conteudo-verde: a pasta da task já tinha conteúdo ao abrir (nome estável por worktree) e o fechar a apaga', () => {
  const { rel } = rodar('reuso');
  assert.equal(rel.veredito_final, 'VERDE', JSON.stringify(rel.falhas));
  assert.equal(rel.externa_sem_a_pasta_da_task_kb_antes, rel.externa_sem_a_pasta_da_task_kb_depois);
});

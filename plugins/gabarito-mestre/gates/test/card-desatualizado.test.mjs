/**
 * GM-20 T11 (REQ-CRD-1, D-G46), cláusula negativa pelo CLI real: `painel.mjs estado` e `painel.mjs texto` NUNCA escrevem no card.
 * Fixture comum (`painel-fixtures/adotado.mjs`) montada em disco FORA do repositório (TMPDIR). O lado `herdar --gravar` é de
 * `herdar-nao-escreve-card` (T10, `onboarding-herdar.test.mjs`).
 * MUTAÇÃO: MC1-d inserir `writeFileSync` no caminho do card dentro de `painel.mjs` ⇒ cai aqui.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { montarNoDisco } from './painel-fixtures/adotado.mjs';

const PAINEL = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'painel.mjs');
const criados = [];
process.on('exit', () => { for (const d of criados) rmSync(d, { recursive: true, force: true }); });

const rodar = (dir, ...args) => {
  const r = spawnSync(process.execPath, [PAINEL, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { rc: r.status, out: r.stdout, err: r.stderr };
};

test('card-desatualizado-nunca-escreve-card: bytes, mtime e lista da pasta de cards iguais antes e depois de painel estado e texto', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'cardesat-'));
  criados.push(dir, `${dir}-origin.git`);
  await montarNoDisco(dir);
  const foto = () => readdirSync(join(dir, 'cards')).sort().map((n) => ({ n, txt: readFileSync(join(dir, 'cards', n), 'utf8'), mtime: statSync(join(dir, 'cards', n)).mtimeMs }));
  const antes = foto();
  const card7 = antes.find((c) => c.n === 'PBI-7.md');
  assert.ok(card7 !== undefined && /status: Em execução/.test(card7.txt), 'o card de PBI-7 está desatualizado na fixture');
  const est = rodar(dir, 'estado');
  assert.equal(est.rc, 0, est.out + est.err);
  const l7 = JSON.parse(est.out).estado.projeto.linhas.find((l) => l.id === 'PBI-7');
  assert.equal(l7.cardDesatualizado, 'Em execução', 'o painel viu o card desatualizado (o teste exercita o caminho certo)');
  const txt = rodar(dir, 'texto', '--largura', '100');
  assert.equal(txt.rc, 0, txt.out + txt.err);
  assert.match(txt.out, /PBI-7 .*\(card desatualizado\)/);
  assert.deepEqual(foto(), antes, 'bytes, mtime e lista iguais');
});

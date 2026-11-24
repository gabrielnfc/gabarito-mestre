/**
 * GM-20 T10 (REQ-ADO-1..3, DT16, DT17): `onboarding.mjs herdar`, o passo de adoção do `--atualizar`.
 * `herdar` só LÊ; `herdar --gravar` grava só `fluxo.planosLegados` e `fluxo.status.terminais` (pelo escritor do `gravar`); nenhum card é escrito (D-G46).
 * Fixture comum (`painel-fixtures/adotado.mjs`, só lida) montada em disco FORA do repositório (TMPDIR). Tudo roda pelo CLI real.
 *
 * MUTAÇÕES PRESCRITAS (plano GM-20, T10 step 3):
 *  MA1-a  contar card concluído COM plano.json           => herdar-detecta-adocao
 *  MA1-b  herdar escreve qualquer arquivo                 => herdar-so-le
 *  MA1-c  status terminal em statusFora                   => herdar-detecta-adocao (variante com terminais)
 *  MA2-a  --gravar grava outra chave                      => herdar-grava-so-2-chaves
 *  MA2-b  --dry-run grava                                 => herdar-dry-run-nao-grava
 *  MA3-a  tirar o passo da skill                          => skill-instalar-passo-adocao (onboarding-skill.test.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { montarNoDisco } from './painel-fixtures/adotado.mjs';
import { projetoDoRepo } from '../scripts/painel.mjs';
import { ehFeito } from '../dist/projeto.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ONBOARDING = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const PADRAO = 'docs/superpowers/plans/*-{PBI}-*.md';
const criados = [];

const novoDir = (rotulo) => {
  const d = mkdtempSync(join(realpathSync(tmpdir()), `herdar-${rotulo}-`));
  criados.push(d, `${d}-origin.git`);
  return d;
};
const limpar = () => { for (const d of criados) rmSync(d, { recursive: true, force: true }); };
process.on('exit', limpar);

async function projeto(rotulo, opcoes) {
  const dir = novoDir(rotulo);
  await montarNoDisco(dir, opcoes);
  return dir;
}

const herdar = (dir, ...extra) => {
  const r = spawnSync(process.execPath, [ONBOARDING, 'herdar', '--root', dir, ...extra], { encoding: 'utf8', input: '' });
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};

/** Foto de tudo fora de `.git`: caminho, bytes (texto) e mtime. */
function foto(dir) {
  const out = {};
  const andar = (rel) => {
    for (const n of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (n.name === '.git') continue;
      const r = rel === '' ? n.name : `${rel}/${n.name}`;
      if (n.isDirectory()) { out[`${r}/`] = null; andar(r); } else out[r] = { txt: readFileSync(join(dir, r), 'utf8'), mtime: statSync(join(dir, r)).mtimeMs };
    }
  };
  andar('');
  return out;
}
const cfgDe = (dir) => JSON.parse(readFileSync(join(dir, 'harness.config.json'), 'utf8'));
const card = (id, status) => `---\nid: "${id}"\ntipo: US\nstatus: ${status}\natualizadoEm: "2026-11-12"\n---\n# ${id}\nFL1 · User Story. Plano: a escrever.\n`;

test('herdar-detecta-adocao: fixture comum devolve os 4 grupos; card concluído COM plano.json não conta; terminal não é statusFora', async () => {
  const dir = await projeto('detecta');
  // PBI-11 e PBI-12: status fora do FL1 e fora dos terminais; PBI-13: concluído COM plano.json (MA1-a)
  writeFileSync(join(dir, 'cards', 'PBI-11.md'), card('PBI-11', 'Aguardando cliente'));
  writeFileSync(join(dir, 'cards', 'PBI-12.md'), card('PBI-12', 'Aguardando cliente'));
  writeFileSync(join(dir, 'cards', 'PBI-13.md'), card('PBI-13', 'Concluído'));
  mkdirSync(join(dir, '.harness', 'entregas', 'PBI-13'), { recursive: true });
  writeFileSync(join(dir, '.harness', 'entregas', 'PBI-13', 'plano.json'), JSON.stringify({ entrega: 'PBI-13', tasks: [{ id: 'T1', deps: [], arquivos: [] }] }));
  const r = herdar(dir);
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.ok, true);
  assert.equal(r.j.oferecer, true);
  assert.deepEqual(r.j.entreguesSemPlano, ['PBI-1', 'PBI-2', 'PBI-3']);
  assert.deepEqual(r.j.planosLegados, { padrao: PADRAO, casados: 1, sem: 6, ambiguos: 0 });
  assert.deepEqual(r.j.statusFora, [{ status: 'Aguardando cliente', n: 2 }]);
  assert.deepEqual(r.j.cardsDesatualizados, [{ id: 'PBI-7', status: 'Em execução' }]);
});

test('herdar-detecta-adocao: terminais da config tiram o status de statusFora (MA1-c); o padrão fica de fora na fixture', async () => {
  const dir = await projeto('terminais', { terminais: ['Aguardando cliente', 'Superado', 'Cancelado'] });
  writeFileSync(join(dir, 'cards', 'PBI-11.md'), card('PBI-11', 'Aguardando cliente'));
  writeFileSync(join(dir, 'cards', 'PBI-12.md'), card('PBI-12', 'Bloqueado'));
  const r = herdar(dir);
  assert.deepEqual(r.j.statusFora, [{ status: 'Bloqueado', n: 1 }]);
  const sem = herdar(await projeto('padrao'));
  assert.deepEqual(sem.j.statusFora, [], 'Superado e Cancelado são terminais padrão');
});

test('herdar-detecta-adocao: 2 planos antigos para o mesmo PBI contam como ambíguo; o padrão que não casa nada não é oferecido', async () => {
  const dir = await projeto('ambiguo');
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-11-03-PBI-3-outro.md'), '# outro\n\n### Task 1: x\n');
  const r = herdar(dir);
  assert.deepEqual(r.j.planosLegados, { padrao: PADRAO, casados: 0, sem: 4, ambiguos: 1 });
  const vazio = novoDir('sem-plano-antigo');
  mkdirSync(join(vazio, 'cards'), { recursive: true });
  writeFileSync(join(vazio, 'cards', 'PBI-1.md'), card('PBI-1', 'Preparado'));
  writeFileSync(join(vazio, 'harness.config.json'), JSON.stringify({ fluxo: { mapeamento: { FL1: 'cards/' } } }));
  assert.equal(herdar(vazio).j.planosLegados.padrao, null);
});

test('herdar-sem-adocao-nao-oferece: projeto sem nada disso devolve oferecer:false; config ilegível falha fechado, rc 1', async () => {
  const dir = novoDir('sem-adocao');
  mkdirSync(join(dir, 'cards'), { recursive: true });
  writeFileSync(join(dir, 'cards', 'PBI-1.md'), card('PBI-1', 'Preparado'));
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ fluxo: { mapeamento: { FL1: 'cards/' } } }));
  const r = herdar(dir);
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.oferecer, false);
  assert.deepEqual([r.j.entreguesSemPlano, r.j.statusFora, r.j.cardsDesatualizados], [[], [], []]);
  assert.equal(r.j.planosLegados.padrao, null);
  writeFileSync(join(dir, 'harness.config.json'), '{ não é json');
  const ruim = herdar(dir);
  assert.equal(ruim.rc, 1);
  assert.equal(ruim.j.erro, 'config_invalida');
});

test('herdar-so-le: bytes, mtime e lista de arquivos iguais antes e depois, com e sem adoção', async () => {
  const dir = await projeto('so-le');
  const antes = foto(dir);
  const r = herdar(dir);
  assert.equal(r.j.oferecer, true);
  assert.deepEqual(foto(dir), antes);
});

test('herdar-grava-so-2-chaves: --gravar muda só fluxo.planosLegados e fluxo.status.terminais; o resto da config e os arquivos ficam', async () => {
  const dir = await projeto('grava');
  const cfg = cfgDe(dir);
  cfg.fluxo.status = { FL1: { concluido: 'Concluído' } };
  cfg.painel = { projeto: { opcoesComoContagem: true } };
  cfg.outra = { chave: 1 };
  writeFileSync(join(dir, 'harness.config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  const antes = foto(dir);
  const r = herdar(dir, '--gravar', '--planos-legados', PADRAO, '--terminais', 'Aguardando cliente, Bloqueado');
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.ok, true);
  assert.ok(r.j.diff.some((l) => l.includes('fluxo.planosLegados')), JSON.stringify(r.j.diff));
  assert.ok(r.j.diff.some((l) => l.includes('fluxo.status.terminais')), JSON.stringify(r.j.diff));
  assert.equal(r.j.diff.length, 2, JSON.stringify(r.j.diff));
  const depois = cfgDe(dir);
  const esperada = structuredClone(cfg);
  esperada.fluxo.planosLegados = [PADRAO];
  esperada.fluxo.status.terminais = ['Aguardando cliente', 'Bloqueado'];
  assert.deepEqual(depois, esperada);
  const fim = foto(dir);
  for (const k of Object.keys(antes)) if (k !== 'harness.config.json') assert.deepEqual(fim[k], antes[k], k);
  assert.deepEqual(Object.keys(fim).sort(), Object.keys(antes).sort());
  // só uma das chaves: a outra não é tocada
  const so1 = await projeto('grava-1');
  const r1 = herdar(so1, '--gravar', '--terminais', 'Bloqueado');
  assert.equal(r1.j.diff.length, 1);
  assert.equal(cfgDe(so1).fluxo.planosLegados, undefined);
});

test('herdar-dry-run-nao-grava: --dry-run mostra o diff e deixa a config intacta; padrão inválido ou sem chave ⇒ argumento_invalido, nada gravado', async () => {
  const dir = await projeto('dry');
  const antes = foto(dir);
  const r = herdar(dir, '--gravar', '--dry-run', '--planos-legados', PADRAO, '--terminais', 'Bloqueado');
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.dryRun, true);
  assert.equal(r.j.diff.length, 2);
  assert.deepEqual(foto(dir), antes);
  for (const args of [
    ['--planos-legados', '../fora/*-{PBI}-*.md'],
    ['--planos-legados', 'docs/{PBI}/*.md'],
    ['--planos-legados', PADRAO, '--terminais', ' , '],
    [],
  ]) {
    const x = herdar(dir, '--gravar', ...args);
    assert.equal(x.rc, 1, `${args.join(' ')}: ${x.out}`);
    assert.equal(x.j.erro, 'argumento_invalido', x.out);
    assert.deepEqual(foto(dir), antes, args.join(' '));
  }
  const ilegivel = novoDir('gravar-sem-config');
  const s = herdar(ilegivel, '--gravar', '--terminais', 'X');
  assert.equal(s.j.erro, 'config_invalida', 'gravar sem config não cria o arquivo');
  assert.deepEqual(readdirSync(ilegivel), []);
});

test('herdar-nao-escreve-card: bytes, mtime e lista da pasta de cards iguais antes e depois de herdar --gravar (D-G46)', async () => {
  const dir = await projeto('card');
  const lerCards = () => {
    const nomes = readdirSync(join(dir, 'cards')).sort();
    return nomes.map((n) => ({ n, txt: readFileSync(join(dir, 'cards', n), 'utf8'), mtime: statSync(join(dir, 'cards', n)).mtimeMs }));
  };
  const antes = lerCards();
  assert.ok(antes.some((c) => c.n === 'PBI-7.md'), 'o card desatualizado está na pasta');
  const r = herdar(dir, '--gravar', '--planos-legados', PADRAO, '--terminais', 'Bloqueado');
  assert.equal(r.rc, 0, r.out + r.err);
  assert.deepEqual(r.j.cardsDesatualizados, [{ id: 'PBI-7', status: 'Em execução' }], 'o desatualizado continua só listado');
  assert.deepEqual(lerCards(), antes);
});

test('herdar-e-painel-mesma-contagem: cardsDesatualizados de herdar = linhas feitas do painel cujo card não é feito (P9)', async () => {
  const dir = await projeto('p9');
  const r = herdar(dir);
  const cfg = cfgDe(dir);
  const estado = projetoDoRepo({ atual: dir, cfg, idPadrao: '^PBI-\\d+$', agoraMs: Date.parse('2026-11-20T12:00:00Z'), fuso: 'UTC', deps: { worktreeList: () => ({ ok: false, motivo: 'teste' }) } });
  const doPainel = estado.linhas.filter((l) => l.feito && !ehFeito(l.status, cfg.fluxo.status?.FL1)).map((l) => l.id).sort();
  assert.deepEqual(r.j.cardsDesatualizados.map((c) => c.id).sort(), doPainel);
  assert.equal(doPainel.length, 1);
  // PBI-8 (card velho + CI verde, SEM encerrada) não é desatualizado nem no painel nem no herdar
  assert.ok(!doPainel.includes('PBI-8'));
});

test('herdar-liga-cli: a flag real --gravar sem as 2 flags passa pelo despachante (exit code da ligação CLI→função)', async () => {
  const dir = await projeto('liga');
  assert.equal(herdar(dir, '--gravar').rc, 1);
  assert.equal(herdar(dir).rc, 0);
});

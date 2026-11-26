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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('herdar-e-painel-mesma-contagem-desatualizados: cardsDesatualizados do herdar = ids com cardDesatualizado no painel, e o status é o mesmo (P9)', async () => {
  const dir = await projeto('p9b');
  const r = herdar(dir);
  const cfg = cfgDe(dir);
  const estado = projetoDoRepo({ atual: dir, cfg, idPadrao: '^PBI-\\d+$', agoraMs: Date.parse('2026-11-20T12:00:00Z'), fuso: 'UTC', deps: { worktreeList: () => ({ ok: false, motivo: 'teste' }) } });
  const doPainel = estado.linhas.filter((l) => l.cardDesatualizado !== null && l.cardDesatualizado !== undefined).map((l) => ({ id: l.id, status: l.cardDesatualizado })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(r.j.cardsDesatualizados, doPainel);
  assert.deepEqual(doPainel, [{ id: 'PBI-7', status: 'Em execução' }]);
});

// ── GM-20 T11 r1: paridade herdar = painel nas bordas (ordem dos eventos, terminal, opção, sem status), pelo CLI real do herdar ──
const AGORA_P9 = Date.parse('2026-11-20T12:00:00Z');
const painelDe = (dir) => projetoDoRepo({ atual: dir, cfg: cfgDe(dir), idPadrao: '^PBI-\\d+$', agoraMs: AGORA_P9, fuso: 'UTC', deps: { worktreeList: () => ({ ok: false, motivo: 'teste' }) } });
const desatDoPainel = (dir) => painelDe(dir).linhas.filter((l) => l.cardDesatualizado !== null && l.cardDesatualizado !== undefined).map((l) => ({ id: l.id, status: l.cardDesatualizado })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
/** Grava um evento pelo `append` real do diário, depois do último da entrega. */
async function anexar(dir, id, tipo, dados, minDepois = 1) {
  const { append, lerEstrito } = await import('../dist/diario.js');
  const pasta = join(dir, '.harness', 'entregas', id);
  const le = lerEstrito(pasta);
  const ult = le.ok && le.eventos.length > 0 ? le.eventos[le.eventos.length - 1] : null;
  const ts = new Date((ult ? Date.parse(ult.ts) : Date.parse('2026-11-08T12:00:00Z')) + minDepois * 60000).toISOString();
  const r = append(pasta, 'p9-borda', { ts, autor: 'fixture', agente: 'orquestrador', tipo, dados: { entrega: id, ...dados }, sessao: 'p9-borda' });
  assert.ok(r.ok, `append ${tipo}: ${r.erro}`);
}
const gravarCard = (dir, id, status) => writeFileSync(join(dir, 'cards', `${id}.md`), `---\nid: "${id}"\ntipo: US\n${status === null ? '' : `status: ${status}\n`}atualizadoEm: "2026-11-12"\n---\n# ${id}\nFL1 · User Story. Plano: a escrever.\n`);
const encerrar = (dir, id) => anexar(dir, id, 'entrega.encerrada', { pr: 1, via: 'head', mergeado_em: '2026-11-08T13:00:00.000Z' });

test('herdar-e-painel-borda-reaberta: encerrada seguida de reaberta não é desatualizado, nem no herdar nem no painel (P9, ordem vem do núcleo)', async () => {
  const dir = await projeto('p9-reab');
  assert.deepEqual(desatDoPainel(dir).map((c) => c.id), ['PBI-7'], 'contexto: antes da reaberta o PBI-7 é desatualizado');
  await anexar(dir, 'PBI-7', 'entrega.reaberta', { em: '2026-11-08T14:00:00.000Z' });
  assert.deepEqual(desatDoPainel(dir), []);
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, []);
});

test('herdar-e-painel-borda-terminal: card Cancelado só com encerrada não é desatualizado em nenhuma camada (P9)', async () => {
  const dir = await projeto('p9-term');
  gravarCard(dir, 'PBI-30', 'Cancelado');
  await encerrar(dir, 'PBI-30');
  assert.ok(!painelDe(dir).linhas.some((l) => l.id === 'PBI-30'), 'contexto: o painel não tem linha do terminal sem medição');
  const r = herdar(dir);
  assert.deepEqual(r.j.cardsDesatualizados, desatDoPainel(dir));
  assert.ok(!r.j.cardsDesatualizados.some((c) => c.id === 'PBI-30'));
});

test('herdar-e-painel-borda-opcao: card Bloqueado com opcoesComoContagem e só encerrada não é desatualizado em nenhuma camada (P9)', async () => {
  const dir = await projeto('p9-opc');
  const cfg = cfgDe(dir);
  cfg.painel = { ...(cfg.painel ?? {}), projeto: { opcoesComoContagem: true } };
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  gravarCard(dir, 'PBI-31', 'Bloqueado');
  await encerrar(dir, 'PBI-31');
  assert.ok(!painelDe(dir).linhas.some((l) => l.id === 'PBI-31'), 'contexto: o painel trata Bloqueado como opção (sem linha)');
  const r = herdar(dir);
  assert.deepEqual(r.j.cardsDesatualizados, desatDoPainel(dir));
  assert.ok(!r.j.cardsDesatualizados.some((c) => c.id === 'PBI-31'));
});

test('herdar-e-painel-borda-sem-status: card sem status e encerrada tem o mesmo status nas 2 camadas (P9)', async () => {
  const dir = await projeto('p9-sem');
  gravarCard(dir, 'PBI-32', null);
  await encerrar(dir, 'PBI-32');
  const doPainel = desatDoPainel(dir);
  assert.deepEqual(doPainel.find((c) => c.id === 'PBI-32'), { id: 'PBI-32', status: '(sem status)' }, 'contexto: o painel diz (sem status)');
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

test('herdar-e-painel-borda-sem-card: entrega encerrada sem card não é desatualizada nas 2 camadas (P9, REQ-CRD-1)', async () => {
  const dir = await projeto('p9-semcard');
  const pasta = join(dir, '.harness', 'entregas', 'PBI-7');
  const enc = readFileSync(join(pasta, readdirSync(pasta).find((f) => f.startsWith('events.'))), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.tipo === 'entrega.encerrada');
  assert.ok(enc, 'contexto: a fixture tem uma encerrada para copiar');
  mkdirSync(join(dir, '.harness', 'entregas', 'PBI-40'), { recursive: true });
  writeFileSync(join(dir, '.harness', 'entregas', 'PBI-40', 'events.p9-semcard.jsonl'), `${JSON.stringify({ ...enc, seq: 1, hash_anterior: null, dados: { ...enc.dados, entrega: 'PBI-40' } })}\n`);
  assert.ok(!existsSync(join(dir, 'cards', 'PBI-40.md')), 'contexto: PBI-40 não tem card');
  const l = painelDe(dir).linhas.find((x) => x.id === 'PBI-40');
  assert.ok(l, 'contexto: o painel tem a linha do PBI-40');
  assert.equal(l.feito, true);
  assert.ok(l.cardDesatualizado === null || l.cardDesatualizado === undefined);
  assert.ok(!desatDoPainel(dir).some((c) => c.id === 'PBI-40'));
  assert.ok(!herdar(dir).j.cardsDesatualizados.some((c) => c.id === 'PBI-40'));
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, desatDoPainel(dir));
});

test('herdar-e-painel-borda-concluido-personalizado: card no concluído personalizado do FL1 com encerrada não é desatualizado nas 2 camadas (P9)', async () => {
  const dir = await projeto('p9-concl');
  const cfg = cfgDe(dir);
  cfg.fluxo.status = { ...(cfg.fluxo.status ?? {}), FL1: { concluido: 'Entregue ao cliente' } };
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  assert.equal(cfgDe(dir).fluxo.status.FL1.concluido, 'Entregue ao cliente', 'contexto: o concluído é o personalizado');
  gravarCard(dir, 'PBI-41', 'Entregue ao cliente');
  await encerrar(dir, 'PBI-41');
  const l = painelDe(dir).linhas.find((x) => x.id === 'PBI-41');
  assert.ok(l, 'contexto: o painel tem a linha do PBI-41');
  assert.equal(l.status, 'Entregue ao cliente');
  assert.equal(l.feito, true);
  assert.ok(!desatDoPainel(dir).some((c) => c.id === 'PBI-41'));
  assert.ok(!herdar(dir).j.cardsDesatualizados.some((c) => c.id === 'PBI-41'));
});

// ── GM-20 T11 r2: injeções do herdar no projetoDoRepo (atual, cfg, idPadrao, worktreeList, agoraMs/fuso) com 1 paridade cada; o painel aqui é o CLI real (git real) ──
const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
const desatDoPainelCli = (dir) => {
  const t = spawnSync(process.execPath, [PAINEL, 'estado'], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(t.stdout).estado.projeto.linhas.filter((x) => x.cardDesatualizado !== null && x.cardDesatualizado !== undefined).map((x) => ({ id: x.id, status: x.cardDesatualizado })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
};
const encerradaDaFixture = (dir) => {
  const pasta = join(dir, '.harness', 'entregas', 'PBI-7');
  return readFileSync(join(pasta, readdirSync(pasta).find((f) => f.startsWith('events.'))), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.tipo === 'entrega.encerrada');
};
const escreverEncerrada = (pasta, id, enc, nome) => {
  mkdirSync(join(pasta, '.harness', 'entregas', id), { recursive: true });
  writeFileSync(join(pasta, '.harness', 'entregas', id, nome), `${JSON.stringify({ ...enc, seq: 1, hash_anterior: null, dados: { ...enc.dados, entrega: id } })}\n`);
};

test('herdar-e-painel-borda-worktree: encerrada só no diário de uma worktree real entra no herdar e no painel (P9, injeção worktreeList)', async () => {
  const dir = await projeto('p9-wt');
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'teste@exemplo.invalid'], { cwd: dir });
  const wt = `${dir}-wt`;
  criados.push(wt);
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt41', wt], { cwd: dir, stdio: 'ignore' });
  gravarCard(dir, 'PBI-41', 'Em execução');
  escreverEncerrada(wt, 'PBI-41', encerradaDaFixture(dir), 'events.p9-wt.jsonl');
  assert.ok(!existsSync(join(dir, '.harness', 'entregas', 'PBI-41')), 'contexto: a encerrada do PBI-41 não está na raiz');
  assert.ok(existsSync(join(wt, '.harness', 'entregas', 'PBI-41', 'events.p9-wt.jsonl')), 'contexto: está na worktree');
  assert.ok(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).includes(realpathSync(wt)), 'contexto: o git conhece a worktree');
  const doPainel = desatDoPainelCli(dir);
  assert.deepEqual(doPainel.map((c) => c.id), ['PBI-7', 'PBI-41']);
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

const commitarConfig = (dir) => {
  const g = (...a) => execFileSync('git', ['-c', 'user.name=F', '-c', 'user.email=f@e.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'ignore' });
  g('add', 'harness.config.json'); g('commit', '-qm', 'idp'); g('push', '-q', 'origin', 'main'); g('fetch', '-q', 'origin');
};

test('herdar-e-painel-borda-idpadrao: idPadrao da config vale nas 2 camadas (P9, injeção idPadrao)', async () => {
  const dir = await projeto('p9-idp');
  const cfg = cfgDe(dir);
  cfg.fluxo.idPadrao = '^[A-Z0-9]+-\\d+$';
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  commitarConfig(dir); // origin = local: o herdar e o painel leem o idPadrao da origin/HEAD
  assert.ok(!new RegExp('^[A-Z]+-\\d+$').test('X2-1'), 'contexto: o padrão default não casa X2-1');
  gravarCard(dir, 'X2-1', 'Em execução');
  escreverEncerrada(dir, 'X2-1', encerradaDaFixture(dir), 'events.p9-idp.jsonl');
  // o painel real lê a config da origin (commitada); aqui a mesma config chega por projetoDoRepo com o idPadrao dela
  const doPainel = projetoDoRepo({ atual: dir, cfg: cfgDe(dir), idPadrao: cfgDe(dir).fluxo.idPadrao, agoraMs: AGORA_P9, fuso: 'UTC', deps: { worktreeList: () => ({ ok: false, motivo: 'teste' }) } }).linhas.filter((l) => l.cardDesatualizado !== null && l.cardDesatualizado !== undefined).map((l) => ({ id: l.id, status: l.cardDesatualizado })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  assert.ok(doPainel.some((c) => c.id === 'X2-1'), 'contexto: o painel lista X2-1');
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

test('herdar-e-painel-borda-concluido-normalizado: card em "concluido" (sem acento) com encerrada não é desatualizado nas 2 camadas (P9, ehFeito normaliza)', async () => {
  const dir = await projeto('p9-conc-norm');
  gravarCard(dir, 'PBI-41', 'concluido');
  await encerrar(dir, 'PBI-41');
  assert.ok(ehFeito('concluido', cfgDe(dir).fluxo.status?.FL1), 'contexto: ehFeito aceita a forma sem acento');
  const l = painelDe(dir).linhas.find((x) => x.id === 'PBI-41');
  assert.ok(l, 'contexto: o painel tem a linha do PBI-41');
  assert.equal(l.status, 'concluido');
  assert.equal(l.feito, true);
  assert.ok(!desatDoPainel(dir).some((c) => c.id === 'PBI-41'));
  assert.ok(!herdar(dir).j.cardsDesatualizados.some((c) => c.id === 'PBI-41'));
});

// ── GM-20 T11 r3: matriz por argumento de projetoDoRepo no herdar (onboarding-herdar.mjs:148) ──
// atual → raiz · cfg → config da raiz · idPadrao → cfg.fluxo.idPadrao · deps.worktreeList → listaDeWorktrees(raiz, rodar) · agoraMs/fuso: FORA da matriz
// (o revisor mediu que agoraMs e fuso não mudam a lista de desatualizados; os 2 vão fixos em Date.now() e 'UTC').
const { herdar: herdarFn } = await import('../scripts/onboarding-herdar.mjs');
const idsDe = (lista) => lista.map((c) => c.id);

test('herdar-e-painel-degradado-sem-git: sem .git só `atual` leva à raiz; herdar e painel listam PBI-7 (P9, argumento atual, X-RAIZ-FIXA)', async () => {
  const dir = await projeto('p9-semgit');
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  assert.ok(!existsSync(join(dir, '.git')), 'contexto: a fixture não tem .git');
  assert.notEqual(realpathSync(process.cwd()), realpathSync(dir), 'contexto: o cwd do teste não é a raiz da fixture');
  assert.equal(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).status !== 0, true, 'contexto: o git falha nessa raiz');
  const doPainel = desatDoPainel(dir);
  assert.deepEqual(idsDe(doPainel), ['PBI-7'], 'contexto: o painel (atual: dir, git falho) lista PBI-7');
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

test('herdar-e-painel-degradado-rodar-rc1: rodar com rc≠0 cai na raiz e herdar = painel com worktreeList ok:false (P9, argumento deps.worktreeList)', async () => {
  const dir = await projeto('p9-rc1');
  const chamadas = [];
  const rodar = (cmd, args) => { chamadas.push([cmd, ...args].join(' ')); return { rc: 1, stdout: '', stderr: 'fatal' }; };
  const r = herdarFn(dir, { rodar });
  assert.ok(chamadas.some((c) => c === 'git worktree list --porcelain'), 'contexto: o herdar chamou o git pelo rodar injetado');
  const doPainel = desatDoPainel(dir);
  assert.deepEqual(idsDe(doPainel), ['PBI-7']);
  assert.deepEqual(r.cardsDesatualizados, doPainel);
});

test('herdar-e-painel-terminais-da-config: terminais personalizado na cfg vale nas 2 camadas e é o único fator (P9, argumento cfg)', async () => {
  const dir = await projeto('p9-termcfg');
  gravarCard(dir, 'PBI-50', 'Aguardando cliente');
  await encerrar(dir, 'PBI-50');
  assert.deepEqual(idsDe(desatDoPainel(dir)).sort(), ['PBI-50', 'PBI-7'], 'contexto: com a config padrão PBI-50 é desatualizado');
  const cfg = cfgDe(dir);
  cfg.fluxo.status = { ...(cfg.fluxo.status ?? {}), terminais: ['Aguardando cliente'] };
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  assert.deepEqual(cfgDe(dir).fluxo.status.terminais, ['Aguardando cliente'], 'contexto: o terminal é o personalizado');
  const doPainel = desatDoPainel(dir);
  assert.deepEqual(idsDe(doPainel), ['PBI-7'], 'contexto: o painel já não lista PBI-50');
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

// ── GM-20 T11 ciclo 3: o idPadrao que o herdar injeta passa pela MESMA normalização do painel (idPadraoDe); paridade com o CLI real do painel ──
async function idPadraoNaOrigin(rotulo, valor) {
  const dir = await projeto(rotulo);
  const cfg = cfgDe(dir);
  cfg.fluxo.idPadrao = valor;
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  commitarConfig(dir);
  gravarCard(dir, 'pbi-9', 'Em execução');
  escreverEncerrada(dir, 'pbi-9', encerradaDaFixture(dir), 'events.p9-idp-norm.jsonl');
  return dir;
}

test('herdar-e-painel-idpadrao-vazio: idPadrao "" vale o default nas 2 camadas, pbi-9 fora (P9, normalização única)', async () => {
  const dir = await idPadraoNaOrigin('p9-idp-vazio', '');
  const doPainel = desatDoPainelCli(dir);
  assert.deepEqual(idsDe(doPainel), ['PBI-7'], 'contexto: o painel real cai no default');
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

test('herdar-e-painel-idpadrao-longo: idPadrao com mais de 200 caracteres vale o default nas 2 camadas (P9, normalização única)', async () => {
  const longo = `^(?:${'x|'.repeat(100)}[a-z]+-\\d+|[A-Z]+-\\d+)$`;
  assert.ok(longo.length > 200, 'contexto: passa de 200');
  const dir = await idPadraoNaOrigin('p9-idp-longo', longo);
  const doPainel = desatDoPainelCli(dir);
  assert.deepEqual(idsDe(doPainel), ['PBI-7'], 'contexto: o painel real cai no default');
  assert.deepEqual(herdar(dir).j.cardsDesatualizados, doPainel);
});

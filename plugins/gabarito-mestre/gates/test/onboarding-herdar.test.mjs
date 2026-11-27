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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { montarNoDisco } from './painel-fixtures/adotado.mjs';
import { projetoDoRepo } from '../scripts/painel.mjs';
import { ehColunaFl1, ehFeito, ehTerminal } from '../dist/projeto.js';

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
  esperada.fluxo.status.terminais = ['Superado', 'Cancelado', 'Descartado', 'Aguardando cliente', 'Bloqueado']; // review final r1 MAJOR-2: acrescenta ao padrão
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

// ── GM-20 T11 ciclo 4: a detecção inteira (entreguesSemPlano, planosLegados, statusFora) usa o idPadrao normalizado; o herdar não conta o que o painel real não mostra ──
const idsDoPainelCli = (dir) => {
  const t = spawnSync(process.execPath, [PAINEL, 'estado'], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(t.stdout).estado.projeto.linhas.map((x) => x.id);
};
async function pbi10ConcluidoSemPlano(rotulo, valor) {
  const dir = await idPadraoNaOrigin(rotulo, valor);
  gravarCard(dir, 'pbi-10', 'Concluído');
  return dir;
}

test('herdar-e-painel-idpadrao-vazio-sem-plano: pbi-10 Concluído sem plano.json não é contado pelo herdar quando o painel não o mostra (P9)', async () => {
  const dir = await pbi10ConcluidoSemPlano('p9-sp-vazio', '');
  assert.ok(!idsDoPainelCli(dir).includes('pbi-10'), 'contexto: o painel real não mostra pbi-10');
  const j = herdar(dir).j;
  assert.ok(!j.entreguesSemPlano.includes('pbi-10'), `herdar contou pbi-10: ${JSON.stringify(j.entreguesSemPlano)}`);
});

test('herdar-e-painel-idpadrao-longo-sem-plano: idem com idPadrao de mais de 200 caracteres (P9)', async () => {
  const longo = `^(?:${'x|'.repeat(100)}[a-z]+-\\d+|[A-Z]+-\\d+)$`;
  const dir = await pbi10ConcluidoSemPlano('p9-sp-longo', longo);
  assert.ok(!idsDoPainelCli(dir).includes('pbi-10'), 'contexto: o painel real não mostra pbi-10');
  const j = herdar(dir).j;
  assert.ok(!j.entreguesSemPlano.includes('pbi-10'), `herdar contou pbi-10: ${JSON.stringify(j.entreguesSemPlano)}`);
});

// ── GM-20 T11 ciclo 4 r1: statusFora e planosLegados também saem da lista filtrada pelo idPadrao normalizado; paridade com o painel CLI real ──
// opcoesComoContagem:true; pbi-11 "Aguardando cliente", pbi-12 "Em execução" e xPBI-1 (quase-acerto: só casa o padrão sem ^ e $) ficam fora do painel
async function foraDoPadrao(rotulo, valor) {
  const dir = await projeto(rotulo);
  const cfg = cfgDe(dir);
  cfg.fluxo.idPadrao = valor;
  cfg.painel = { ...(cfg.painel ?? {}), projeto: { ...(cfg.painel?.projeto ?? {}), opcoesComoContagem: true } };
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  commitarConfig(dir);
  const antes = herdar(dir).j;
  gravarCard(dir, 'pbi-11', 'Aguardando cliente');
  gravarCard(dir, 'pbi-12', 'Em execução');
  gravarCard(dir, 'xPBI-1', 'Aguardando cliente');
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-01-01-pbi-12-x.md'), '# plano\n'); // plano legado de card fora do padrão: não pode virar `casados`
  const t = spawnSync(process.execPath, [PAINEL, 'estado'], { cwd: dir, encoding: 'utf8' });
  const projetoPainel = JSON.parse(t.stdout).estado.projeto;
  const ids = projetoPainel.linhas.map((x) => x.id);
  for (const id of ['pbi-11', 'pbi-12', 'xPBI-1']) assert.ok(!ids.includes(id), `contexto: o painel real não mostra ${id}`);
  assert.equal(projetoPainel.totais.opcoes, 0, 'contexto: o painel real não conta opção fora do padrão');
  return { dir, antes, depois: herdar(dir).j };
}
const longoRe = `^(?:${'x|'.repeat(100)}[a-z]+-\\d+|[A-Z]+-\\d+)$`;
for (const [nome, valor] of [['vazio', ''], ['longo', longoRe]]) {
  test(`herdar-e-painel-idpadrao-${nome}-status-fora: card fora do padrão normalizado não entra em statusFora (P9)`, async () => {
    const { antes, depois } = await foraDoPadrao(`p9-sf-${nome}`, valor);
    assert.deepEqual(antes.statusFora, [], 'contexto: sem os cards de fora a fixture não tem statusFora');
    assert.deepEqual(depois.statusFora, [], `herdar contou card que o painel não mostra: ${JSON.stringify(depois.statusFora)}`);
  });
  test(`herdar-e-painel-idpadrao-${nome}-planos-legados: card fora do padrão normalizado, sem ponteiro e sem plano.json, não muda planosLegados.sem (P9)`, async () => {
    const { antes, depois } = await foraDoPadrao(`p9-pl-${nome}`, valor);
    assert.equal(depois.planosLegados.sem, antes.planosLegados.sem, `herdar contou card que o painel não mostra: ${JSON.stringify(depois.planosLegados)}`);
    assert.deepEqual(depois.planosLegados, antes.planosLegados);
  });
}

// ── GM-20 T11 ciclo 5: P9 do PIPELINE do herdar (árvores, .md, leitura segura, dedup por id, terminal, ordem, plano.json, contagem) contra o painel CLI real ──
// 1 fixture com git real (raiz + worktree) e 3 casos de dedup do PBI-50 (raiz mais nova, worktree mais nova, empate); a derivação do painel vem das linhas do CLI.
const cardEm = (id, status, dia) => `---\nid: "${id}"\ntipo: US\nstatus: ${status}\natualizadoEm: "${dia}"\n---\n# ${id}\nFL1 · User Story. Plano: a escrever.\n`;
const doPainelDerivado = (dir) => {
  const t = spawnSync(process.execPath, [PAINEL, 'estado'], { cwd: dir, encoding: 'utf8' });
  const linhas = JSON.parse(t.stdout).estado.projeto.linhas;
  const fl1 = cfgDe(dir).fluxo.status?.FL1;
  const cont = new Map();
  for (const l of linhas) {
    const s = (l.status ?? '').trim();
    if (s === '' || ehColunaFl1(s, fl1) || ehTerminal(s)) continue;
    cont.set(s, (cont.get(s) ?? 0) + 1);
  }
  return {
    ids: linhas.map((l) => l.id),
    entreguesSemPlano: linhas.filter((l) => ehFeito(l.status, fl1) && l.plano !== 'json').map((l) => l.id),
    statusFora: [...cont].map(([status, n]) => ({ status, n })).sort((x, y) => y.n - x.n || x.status.localeCompare(y.status)),
  };
};
const CASOS_DEDUP = [
  ['raiz-mais-nova', { raiz: ['Concluído', '2026-11-20'], wt: ['Aguardando cliente', '2026-11-01'] }],
  ['worktree-mais-nova', { raiz: ['Aguardando cliente', '2026-11-01'], wt: ['Concluído', '2026-11-20'] }],
  ['empate-fica-a-raiz', { raiz: ['Concluído', '2026-11-12'], wt: ['Aguardando cliente', '2026-11-12'] }],
];
for (const [nome, { raiz, wt: naWt }] of CASOS_DEDUP) {
  test(`herdar-e-painel-pipeline-${nome}: card duplicado raiz x worktree real e o resto do pipeline dão o mesmo entreguesSemPlano e statusFora do painel CLI (P9)`, async () => {
    const dir = await projeto(`p9-pipe-${nome}`);
    execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'teste@exemplo.invalid'], { cwd: dir });
    const wt = `${dir}-wt`;
    criados.push(wt);
    execFileSync('git', ['worktree', 'add', '-q', '-b', `wt-${nome}`, wt], { cwd: dir, stdio: 'ignore' });
    const grava = (base, id, st, dia) => writeFileSync(join(base, 'cards', `${id}.md`), cardEm(id, st, dia));
    const cfg = cfgDe(dir); // quadro FL1 personalizado: "Entregue" é o concluído da config
    cfg.fluxo.status = { FL1: { preparado: 'Preparado', em_execucao: 'Em execução', revisao: 'Revisão e teste', pronto: 'Pronto para liberar', concluido: 'Entregue' } };
    writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
    grava(dir, 'PBI-48', 'Entregue', '2026-11-12'); // feito só pela config: entra em entreguesSemPlano, nunca em statusFora
    grava(dir, 'PBI-47', 'Pausado', '2026-11-12'); // n=1, empata com "Aguardando cliente": desempate alfabético
    grava(dir, 'PBI-58', 'Em revisão', '2026-11-12'); // "Em revisão" n=3 (com PBI-51 e PBI-59): maior contagem primeiro
    grava(dir, 'PBI-59', 'Em revisão', '2026-11-12');
    grava(dir, 'PBI-50', ...raiz);
    grava(wt, 'PBI-50', ...naWt);
    grava(wt, 'PBI-51', 'Em revisão', '2026-11-12'); // só na worktree (etapa: leitura das árvores)
    grava(dir, 'PBI-52', 'Aguardando cliente', '2026-11-12');
    grava(dir, 'PBI-100', 'Concluído', '2026-11-12'); // ordem numérica: PBI-60 (só na worktree) vem antes de PBI-100
    grava(wt, 'PBI-60', 'Concluído', '2026-11-12');
    grava(dir, 'PBI-57', 'Cancelado', '2026-11-12'); // terminal: nem entreguesSemPlano nem statusFora
    writeFileSync(join(dir, 'cards', 'PBI-53.txt'), cardEm('PBI-53', 'Concluído', '2026-11-12')); // não é .md
    mkdirSync(join(dir, 'outros'), { recursive: true });
    writeFileSync(join(dir, 'outros', 'PBI-54-real.md'), cardEm('PBI-54', 'Concluído', '2026-11-12'));
    symlinkSync('../outros/PBI-54-real.md', join(dir, 'cards', 'PBI-54.md')); // symlink: a leitura segura recusa
    writeFileSync(join(dir, 'cards', 'PBI-55.md'), `${cardEm('PBI-55', 'Concluído', '2026-11-12')}${'x'.repeat(1024 * 1024 + 16)}\n`); // passa de 1 MiB: recusado
    grava(dir, 'PBI-56', 'Concluído', '2026-11-12'); // plano.json só na worktree: não é "sem plano"
    mkdirSync(join(wt, '.harness', 'entregas', 'PBI-56'), { recursive: true });
    writeFileSync(join(wt, '.harness', 'entregas', 'PBI-56', 'plano.json'), JSON.stringify({ entrega: 'PBI-56', tasks: [{ id: 'T1', deps: [], arquivos: [] }] }));
    const doPainel = doPainelDerivado(dir);
    for (const id of ['PBI-51', 'PBI-60', 'PBI-100', 'PBI-50', 'PBI-56']) assert.ok(doPainel.ids.includes(id), `contexto: o painel real mostra ${id}`);
    for (const id of ['PBI-53', 'PBI-54', 'PBI-55', 'PBI-57']) assert.ok(!doPainel.ids.includes(id), `contexto: o painel real não mostra ${id}`);
    assert.ok(!doPainel.entreguesSemPlano.includes('PBI-56'), 'contexto: o painel vê o plano.json da worktree (plano json)');
    assert.ok(doPainel.entreguesSemPlano.indexOf('PBI-60') < doPainel.entreguesSemPlano.indexOf('PBI-100'), 'contexto: ordem numérica no painel');
    const j = herdar(dir).j;
    assert.deepEqual(j.entreguesSemPlano, doPainel.entreguesSemPlano);
    assert.deepEqual(j.statusFora, doPainel.statusFora);
  });
}

// ── GM-20 review final r1 MAJOR-2: aceitar a oferta do passo 6b ACRESCENTA ao conjunto vigente (padrão + config) e grava o 1º termo, o que `ehTerminal` casa ──
test('herdar-aceitar-terminais-acrescenta: --gravar --terminais com o statusFora não reabre Superado/Cancelado e o texto longo casa (fixture rf-terminais)', async () => {
  const dir = await projeto('aceitar-term');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=F', '-c', 'user.email=f@e.invalid', ...a]);
  writeFileSync(join(dir, 'cards', 'PBI-11.md'), '---\nid: "PBI-11"\ntipo: US\nstatus: Arquivado — sem verba\natualizadoEm: "2026-10-21"\n---\n# Coisa arquivada\nPlano: a escrever.\n');
  g('add', '.'); g('commit', '-qm', 'card'); g('push', '-q', 'origin', 'main');
  const painel = () => {
    const r = spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'painel.mjs'), 'estado', '--entrega', 'PBI-5'], { cwd: dir, encoding: 'utf8' });
    const p = JSON.parse(r.stdout.trim().split('\n').at(-1)).estado.projeto;
    return { pbis: p.totais.pbis, terminais: p.totais.terminais, abertos: p.linhas.filter((l) => !l.feito).map((l) => l.id) };
  };
  const antes = painel();
  assert.equal(antes.pbis, 9, JSON.stringify(antes));
  assert.ok(antes.abertos.includes('PBI-11'), 'contexto: o arquivado conta como aberto');
  const h = herdar(dir).j;
  assert.deepEqual(h.statusFora, [{ status: 'Arquivado — sem verba', n: 1 }]);
  const gr = herdar(dir, '--gravar', '--terminais', h.statusFora.map((s) => s.status).join(','));
  assert.equal(gr.rc, 0, gr.out + gr.err);
  assert.deepEqual(cfgDe(dir).fluxo.status.terminais, ['Superado', 'Cancelado', 'Descartado', 'Arquivado'], 'padrão + o 1º termo do escolhido');
  assert.deepEqual(gr.j.statusFora, [], 'nada volta a ficar fora');
  g('commit', '-qam', 'cfg'); g('push', '-q', 'origin', 'main');
  const depois = painel();
  assert.equal(depois.pbis, 8, JSON.stringify(depois));
  assert.equal(depois.terminais, 3);
  for (const id of ['PBI-4', 'PBI-10', 'PBI-11']) assert.ok(!depois.abertos.includes(id), `${id} segue fora: ${JSON.stringify(depois)}`);
  // 2ª aceitação com o que já é terminal: nada muda
  assert.deepEqual(herdar(dir, '--gravar', '--terminais', 'arquivado, Superado').j.diff, []);
});

// ───────────────────────────────────────────────── GM-21 T6 (REQ-HER-2, DT9): `herdar --tasks`, CLI real, gh falso
// Mutações: MH2-a gravar as válidas quando há recusada ⇒ herdar-tasks-recusa-tudo-ou-nada · MH2-b aceitar task do plano ⇒ idem (task-no-plano) ·
// MH2-c não conferir ancestral ⇒ idem (commit-fora-do-historico) · MH2-d PR sem gh aceito ⇒ idem (gh-ausente) · sem a idempotência ⇒ herdar-tasks-idempotente.
const g = (dir, ...a) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'user.useConfigOnly=true', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();

/** `gh` falso: `pr view 10` ⇒ MERGED, `pr view 11` ⇒ OPEN, o resto ⇒ rc 1. Só existe no PATH do subprocesso. */
function ghFalso() {
  const d = novoDir('gh');
  mkdirSync(d, { recursive: true });
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(d, 'git'));
  writeFileSync(join(d, 'gh'), '#!/bin/sh\n[ "$1 $2" = "pr view" ] || exit 2\ncase "$3" in 10) echo \'{"state":"MERGED"}\';; 11) echo \'{"state":"OPEN"}\';; *) echo "nao encontrado" >&2; exit 1;; esac\n', { mode: 0o755 });
  return d;
}
/** PATH só com o `git` (symlink): o `gh` não existe. */
function semGh() {
  const d = novoDir('sem-gh');
  mkdirSync(d, { recursive: true });
  symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(d, 'git'));
  return d;
}

/** Fixture adotado (PBI-7 tem `plano.json` T1..T2) + `docs/ledger.md` de 50 linhas versionado. Devolve o dir e o sha do HEAD. */
async function repoTasks(rotulo) {
  const dir = await projeto(rotulo);
  writeFileSync(join(dir, 'docs', 'ledger.md'), `${Array.from({ length: 50 }, (_, i) => `linha ${i + 1}`).join('\n')}\n`);
  g(dir, 'add', 'docs/ledger.md');
  g(dir, 'commit', '-q', '-m', 'ledger');
  return { dir, sha: g(dir, 'rev-parse', 'HEAD') };
}
const lista = (dir, itens) => { const f = join(dir, '..', `lista-${dir.split('/').pop()}.json`); writeFileSync(f, JSON.stringify(itens)); criados.push(f); return f; };
const tasks = (dir, itens, { path = ghFalso(), extra = [] } = {}) => {
  const r = spawnSync(process.execPath, [ONBOARDING, 'herdar', '--tasks', '--entrega', 'PBI-7', '--arquivo', lista(dir, itens), '--root', dir, ...extra], { encoding: 'utf8', input: '', env: { PATH: `${path}:${dirname(process.execPath)}`, HOME: dir } });
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};
const DIARIO_HERDAR = (dir) => join(dir, '.harness', 'entregas', 'PBI-7', 'events.herdar.jsonl');
const tres = (sha) => [{ task: 'T3', origem: `commit:${sha}` }, { task: 'T4', origem: 'pr:10' }, { task: 'T5', origem: 'ledger:docs/ledger.md:42' }];
const linhasHerdar = (dir) => (existsSync(DIARIO_HERDAR(dir)) ? readFileSync(DIARIO_HERDAR(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('herdar-tasks-le-sem-gravar: sem --gravar a saída lista as 3 como ok e nada muda em disco (bytes, mtime, arquivos)', async () => {
  const { dir, sha } = await repoTasks('t-le');
  const antes = foto(dir);
  const r = tasks(dir, tres(sha));
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.ok, true);
  assert.deepEqual(r.j.tasks.map((t) => [t.task, t.estado]), [['T3', 'ok'], ['T4', 'ok'], ['T5', 'ok']]);
  assert.equal(r.j.gravado, false);
  assert.deepEqual(foto(dir), antes);
  assert.equal(existsSync(DIARIO_HERDAR(dir)), false);
});

test('herdar-tasks-grava-3: --gravar grava 3 task.herdada em events.herdar.jsonl, encadeados, com a origem e o sha por extenso', async () => {
  const { dir, sha } = await repoTasks('t-grava');
  const curto = g(dir, 'rev-parse', '--short', 'HEAD');
  const itens = tres(curto);
  itens[1] = { task: 'T4', origem: 'pr:10', titulo: 'Sincronização' };
  const r = tasks(dir, itens, { extra: ['--gravar'] });
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.gravado, true);
  assert.equal(r.j.gravadas, 3);
  const ev = linhasHerdar(dir);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((e) => e.seq), [1, 2, 3]);
  assert.equal(ev[0].hash_anterior, null);
  assert.match(ev[1].hash_anterior, /^[0-9a-f]{64}$/);
  assert.match(ev[2].hash_anterior, /^[0-9a-f]{64}$/);
  assert.notEqual(ev[1].hash_anterior, ev[2].hash_anterior);
  assert.ok(ev.every((e) => e.tipo === 'task.herdada' && e.sessao === 'herdar'));
  assert.deepEqual(ev.map((e) => e.dados), [
    { task: 'T3', origem: { tipo: 'commit', ref: sha } },
    { task: 'T4', origem: { tipo: 'pr', ref: '10' }, titulo: 'Sincronização' },
    { task: 'T5', origem: { tipo: 'ledger', ref: 'docs/ledger.md:42' } },
  ]);
  const { lerEstrito } = await import('../dist/diario.js');
  assert.equal(lerEstrito(join(dir, '.harness', 'entregas', 'PBI-7')).ok, true, 'o diário da entrega segue íntegro com a herança');
});

test('herdar-tasks-dry-run: --gravar --dry-run só mostra', async () => {
  const { dir, sha } = await repoTasks('t-dry');
  const antes = foto(dir);
  const r = tasks(dir, tres(sha), { extra: ['--gravar', '--dry-run'] });
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.dryRun, true);
  assert.equal(r.j.gravado, false);
  assert.deepEqual(r.j.tasks.map((t) => t.estado), ['ok', 'ok', 'ok']);
  assert.deepEqual(foto(dir), antes);
});

/** Um caso por motivo de recusa: a entrada ruim sai `recusada` com motivo e, com --gravar, NADA é gravado, nem a válida ao lado (tudo ou nada). */
async function recusa(rotulo, itemRuim, motivo, { path } = {}) {
  const { dir, sha } = await repoTasks(`t-rec-${rotulo}`);
  const bom = { task: 'T4', origem: 'pr:10' };
  const itens = [bom, typeof itemRuim === 'function' ? itemRuim({ dir, sha }) : itemRuim];
  const antes = foto(dir);
  const r = tasks(dir, itens, { extra: ['--gravar'], path });
  assert.equal(r.rc, 1, r.out + r.err);
  assert.equal(r.j.ok, false);
  assert.equal(r.j.gravado, false);
  const rec = r.j.tasks.filter((t) => t.estado === 'recusada');
  assert.equal(rec.length, 1, JSON.stringify(r.j.tasks));
  assert.match(rec[0].motivo, motivo);
  assert.equal(r.j.tasks.find((t) => t.task === 'T4').estado, 'ok', 'a válida ao lado segue ok na saída, mas não é gravada');
  assert.equal(existsSync(DIARIO_HERDAR(dir)), false, 'tudo ou nada: nada gravado');
  assert.deepEqual(foto(dir), antes);
}
test('herdar-tasks-recusa-tudo-ou-nada: commit inexistente', () => recusa('commit-inexistente', { task: 'T3', origem: `commit:${'0'.repeat(40)}` }, /não existe/));
test('herdar-tasks-recusa-tudo-ou-nada: commit fora do histórico de HEAD', () => recusa('commit-fora', ({ dir }) => {
  const orfao = g(dir, 'commit-tree', 'HEAD^{tree}', '-m', 'solto');
  return { task: 'T3', origem: `commit:${orfao}` };
}, /ancestral|hist/));
test('herdar-tasks-recusa-tudo-ou-nada: commit com forma inválida (não é hex)', () => recusa('commit-forma', { task: 'T3', origem: 'commit:--all' }, /sha inválido/));
test('herdar-tasks-recusa-tudo-ou-nada: PR aberto (OPEN)', () => recusa('pr-aberto', { task: 'T3', origem: 'pr:11' }, /MERGED|merge/));
test('herdar-tasks-recusa-tudo-ou-nada: PR que o gh não acha', () => recusa('pr-some', { task: 'T3', origem: 'pr:99' }, /gh não leu/));
test('herdar-tasks-recusa-tudo-ou-nada: gh ausente recusa o PR (falha fechada)', async () => {
  const { dir } = await repoTasks('t-sem-gh');
  const r = tasks(dir, [{ task: 'T3', origem: 'pr:10' }], { extra: ['--gravar'], path: semGh() });
  assert.equal(r.rc, 1, r.out + r.err);
  assert.equal(r.j.tasks[0].estado, 'recusada');
  assert.match(r.j.tasks[0].motivo, /gh/);
  assert.equal(existsSync(DIARIO_HERDAR(dir)), false);
});
test('herdar-tasks-recusa-tudo-ou-nada: ledger sem linha', () => recusa('ledger-sem-linha', { task: 'T3', origem: 'ledger:docs/ledger.md' }, /esperado ledger/));
test('herdar-tasks-recusa-tudo-ou-nada: ledger com linha além do fim', () => recusa('ledger-linha', { task: 'T3', origem: 'ledger:docs/ledger.md:51' }, /além do fim/));
test('herdar-tasks-recusa-tudo-ou-nada: ledger com arquivo fora da raiz', () => recusa('ledger-fora', { task: 'T3', origem: 'ledger:../fora.md:1' }, /fora da raiz/));
test('herdar-tasks-recusa-tudo-ou-nada: ledger com arquivo não versionado', () => recusa('ledger-sem-git', ({ dir }) => {
  writeFileSync(join(dir, 'docs', 'solto.md'), 'a\nb\n');
  return { task: 'T3', origem: 'ledger:docs/solto.md:1' };
}, /não versionado/));
test('herdar-tasks-recusa-tudo-ou-nada: task que está no plano.json da entrega (o loop mede)', () => recusa('task-no-plano', { task: 'T1', origem: 'pr:10' }, /plano/));
test('herdar-tasks-recusa-tudo-ou-nada: task repetida na lista', () => recusa('task-repetida', { task: 'T4', origem: 'pr:10' }, /repetid/));
test('herdar-tasks-recusa-tudo-ou-nada: origem com tipo desconhecido', () => recusa('origem-tipo', { task: 'T3', origem: 'branch:feat/x' }, /origem/));
test('herdar-tasks-recusa-tudo-ou-nada: id de task fora da forma', () => recusa('task-id', { task: '../T3', origem: 'pr:10' }, /task/));

test('herdar-tasks-idempotente: a 2ª rodada com a mesma lista não grava nada (ja_herdada); lista com 1 nova grava só a nova', async () => {
  const { dir, sha } = await repoTasks('t-idem');
  const um = tasks(dir, tres(sha).slice(0, 2), { extra: ['--gravar'] });
  assert.equal(um.j.gravadas, 2, um.out + um.err);
  const antes = readFileSync(DIARIO_HERDAR(dir), 'utf8');
  const dois = tasks(dir, tres(sha).slice(0, 2), { extra: ['--gravar'] });
  assert.equal(dois.rc, 0, dois.out + dois.err);
  assert.deepEqual(dois.j.tasks.map((t) => t.estado), ['ja_herdada', 'ja_herdada']);
  assert.equal(dois.j.gravado, false);
  assert.equal(dois.j.gravadas, 0);
  assert.equal(readFileSync(DIARIO_HERDAR(dir), 'utf8'), antes);
  const tres3 = tasks(dir, tres(sha), { extra: ['--gravar'] });
  assert.deepEqual(tres3.j.tasks.map((t) => t.estado), ['ja_herdada', 'ja_herdada', 'ok']);
  assert.equal(tres3.j.gravadas, 1);
  assert.deepEqual(linhasHerdar(dir).map((e) => [e.seq, e.dados.task]), [[1, 'T3'], [2, 'T4'], [3, 'T5']]);
});

test('herdar-tasks-idempotente: task já herdada com origem recusável hoje (PR reaberto) segue ja_herdada, não recusada', async () => {
  const { dir, sha } = await repoTasks('t-idem-recusa');
  tasks(dir, tres(sha).slice(0, 2), { extra: ['--gravar'] });
  const r = tasks(dir, [{ task: 'T4', origem: 'pr:11' }], { extra: ['--gravar'] });
  assert.equal(r.rc, 0, r.out + r.err);
  assert.equal(r.j.tasks[0].estado, 'ja_herdada');
});

test('herdar-tasks-nao-toca-plano: plano.json, config, cards e o diário de task ficam byte a byte; só events.herdar.jsonl nasce', async () => {
  const { dir, sha } = await repoTasks('t-plano');
  const antes = foto(dir);
  const r = tasks(dir, tres(sha), { extra: ['--gravar'] });
  assert.equal(r.rc, 0, r.out + r.err);
  const depois = foto(dir);
  const novos = Object.keys(depois).filter((k) => !(k in antes));
  assert.deepEqual(novos, ['.harness/entregas/PBI-7/events.herdar.jsonl']);
  for (const k of Object.keys(antes)) assert.deepEqual(depois[k], antes[k], k);
  assert.equal(readFileSync(join(dir, '.harness', 'entregas', 'PBI-7', 'plano.json'), 'utf8'), antes['.harness/entregas/PBI-7/plano.json'].txt);
});

test('herdar-tasks-uso: --tasks sem --entrega ou sem --arquivo, entrega fora da forma, arquivo ilegível ou lista fora da forma ⇒ rc 1 argumento_invalido, nada gravado', async () => {
  const { dir } = await repoTasks('t-uso');
  const roda = (...a) => {
    const r = spawnSync(process.execPath, [ONBOARDING, 'herdar', '--tasks', '--root', dir, ...a], { encoding: 'utf8', input: '', env: { PATH: `${ghFalso()}:${dirname(process.execPath)}`, HOME: dir } });
    return { rc: r.status, j: JSON.parse(r.stdout.trim()) };
  };
  const arq = lista(dir, [{ task: 'T3', origem: 'pr:10' }]);
  for (const a of [['--arquivo', arq], ['--entrega', 'PBI-7'], ['--entrega', 'pbi-7', '--arquivo', arq], ['--entrega', 'PBI-7', '--arquivo', join(dir, 'nao-existe.json')],
    ['--entrega', 'PBI-7', '--arquivo', lista(dir, { task: 'T3' })], ['--entrega', 'PBI-7', '--arquivo', lista(dir, [{ task: 'T3', origem: 'pr:10', x: 1 }])], ['--entrega', 'PBI-7', '--arquivo', lista(dir, [])]]) {
    const r = roda(...a, '--gravar');
    assert.equal(r.rc, 1, JSON.stringify(a));
    assert.equal(r.j.erro, 'argumento_invalido', JSON.stringify([a, r.j]));
    assert.match(r.j.motivo, /--entrega|--arquivo|item|lista/, JSON.stringify([a, r.j]));
  }
  assert.equal(existsSync(DIARIO_HERDAR(dir)), false);
});

test('herdar-sem-tasks-segue-igual: sem --tasks o herdar de adoção responde como antes (sem o campo tasks) e --tasks ignora a detecção', async () => {
  const dir = await projeto('t-regressao');
  const r = herdar(dir);
  assert.equal(r.j.tasks, undefined);
  assert.equal(r.j.oferecer, true);
});

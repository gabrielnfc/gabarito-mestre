/**
 * `painel.mjs medir` (GM-14 T11, REQ-DIA-1): único que grava `fato.medido`, e só quando o valor muda.
 * Cada caso sobe um repositório git descartável (com ESPAÇO no caminho) e um `gh` falso no PATH (fixtures/gh/gh, modo em GH_MODO).
 * O núcleo é chamado em processo (`medir`); o CLI real tem o seu caso no fim.
 *
 * MUTAÇÕES PRESCRITAS: task-11-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { append, ler } from '../dist/diario.js';
import { trilhaDe } from '../dist/trilha.js';
import { medir } from '../scripts/painel-medir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FAKE_GH = join(AQUI, 'fixtures', 'gh');
const SID = 'sessao-1';
const raizes = [];
after(() => { /* temporários ficam em TMPDIR (gitignored); nada é apagado (R2) */ });

const GIT_ENV = { ...process.env, HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'user.useConfigOnly=true', ...args], { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

/** Repo descartável na `branch` (`null` ⇒ HEAD solto). */
function repo(branch = 'enabler/GM-14-clareza') {
  const d = join(realpathSync(mkdtempSync(join(tmpdir(), 'medir teste '))), 'r');
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'commit', '-q', '--allow-empty', '-m', 'ini');
  if (branch === null) git(d, 'checkout', '-q', '--detach');
  else if (branch !== 'main') git(d, 'checkout', '-q', '-b', branch);
  raizes.push(d);
  return d;
}

/** `rodar` que usa o `gh` falso (ou nenhum) e o git real. */
function rodarCom(modo, { log } = {}) {
  const vazio = mkdtempSync(join(tmpdir(), 'sem gh '));
  return (cmd, args, { cwd, timeoutMs }) => {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    if (cmd === 'gh') {
      env.PATH = modo === 'ausente' ? vazio : `${FAKE_GH}:${process.env.PATH}`;
      env.GH_MODO = modo;
      if (log) env.GH_LOG = log;
    }
    return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env, stdio: ['ignore', 'pipe', 'pipe'] });
  };
}

const entrada = (agentes = [], sessao = SID) => ({ session_id: sessao, agentes });
const rodarMedir = (d, modo = 'ok', extra = {}) => medir(d, { rodar: rodarCom(modo, extra.log ? { log: extra.log } : {}), agentes: entrada(extra.agentes ?? []), timeoutMs: extra.timeoutMs ?? 5000, agora: extra.agora ?? (() => Date.parse('2026-11-11T20:00:00Z')), ...extra.resto });

const dirDe = (d, id = 'GM-14') => join(d, '.harness', 'entregas', id);
const fatos = (d, id = 'GM-14', chave) => ler(dirDe(d, id)).filter((e) => e.tipo === 'fato.medido' && (chave === undefined || e.dados.chave === chave));
const SHA = /^[0-9a-f]{64}$/;

function spec(d, nome, cabecalho, corpo = '## Seção\n') {
  mkdirSync(join(d, 'docs', 'superpowers', 'specs'), { recursive: true });
  writeFileSync(join(d, 'docs', 'superpowers', 'specs', nome), `# Título da ${nome}\n\n${cabecalho}\n\n${corpo}`);
}

describe('medir: fatos e dedupe', () => {
  test('tres-medicoes-iguais-um-evento', () => {
    const d = repo();
    spec(d, 'a.md', 'Iniciativa: x · PBI: GM-14 (Enabler) · Data: hoje', '## S1\n## S2\n');
    mkdirSync(dirDe(d), { recursive: true });
    writeFileSync(join(dirDe(d), 'plano.json'), JSON.stringify({ tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }] }));
    const r1 = rodarMedir(d);
    assert.deepEqual(r1, { ok: true, gravados: ['branch', 'spec', 'plano', 'pr', 'pr', 'release'], falhas: [] });
    const r2 = rodarMedir(d);
    const r3 = rodarMedir(d);
    assert.deepEqual([r2.gravados, r3.gravados, r2.ok, r3.ok], [[], [], true, true]);
    const ev = fatos(d);
    assert.equal(ev.length, 6);
    const v = (c, n = 0) => fatos(d, 'GM-14', c)[n].dados;
    assert.deepEqual(v('branch'), { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } });
    assert.equal(v('spec').fonte, 'arquivo');
    assert.equal(v('spec').valor.caminho, 'docs/superpowers/specs/a.md');
    assert.match(v('spec').valor.sha256, SHA);
    assert.equal(v('spec').valor.secoes, 2);
    assert.deepEqual(v('plano'), { chave: 'plano', fonte: 'arquivo', valor: { tasks: 3 } });
    assert.deepEqual(v('pr', 0).valor, { numero: 7, estado: 'mergeado', branch: 'enabler/GM-14-clareza' });
    assert.deepEqual(v('pr', 1).valor, { numero: 8, estado: 'aberto', branch: 'enabler/GM-14-clareza' });
    assert.equal(v('pr').fonte, 'gh');
    assert.deepEqual(v('release'), { chave: 'release', fonte: 'gh', valor: { tag: 'v2.0.0' } });
    for (const e of ev) { assert.equal(e.sessao, SID); assert.equal(e.autor, 'painel'); }
    assert.ok(existsSync(join(dirDe(d), `events.${SID}.jsonl`)));
  });

  test('pr-muda-estado-grava (e o outro PR, de outro numero, nao some)', () => {
    const d = repo();
    rodarMedir(d, 'pr-aberto');
    assert.equal(fatos(d, 'GM-14', 'pr').length, 1);
    const r = rodarMedir(d, 'ok');
    assert.deepEqual(r.gravados, ['pr', 'pr']); // 7 virou mergeado (muda) e 8 é novo
    const prs = fatos(d, 'GM-14', 'pr').map((e) => `${e.dados.valor.numero}:${e.dados.valor.estado}`);
    assert.deepEqual(prs, ['7:aberto', '7:mergeado', '8:aberto']);
    assert.deepEqual(rodarMedir(d, 'ok').gravados, []);
  });

  test('spec-editada-grava-de-novo, igual nao grava; sha e secoes acompanham o conteudo', () => {
    const d = repo();
    spec(d, 'a.md', 'PBI: GM-14', '## S1\n');
    rodarMedir(d);
    spec(d, 'a.md', 'PBI: GM-14', '## S1\n## S2\n## S3\n');
    const r = rodarMedir(d);
    assert.deepEqual(r.gravados, ['spec']);
    const s = fatos(d, 'GM-14', 'spec');
    assert.equal(s.length, 2);
    assert.notEqual(s[0].dados.valor.sha256, s[1].dados.valor.sha256);
    assert.deepEqual([s[0].dados.valor.secoes, s[1].dados.valor.secoes], [1, 3]);
  });

  test('branch-muda-grava', () => {
    const d = repo('enabler/GM-14-a');
    rodarMedir(d);
    git(d, 'checkout', '-q', '-b', 'enabler/GM-14-b');
    assert.deepEqual(rodarMedir(d).gravados, ['branch', 'pr', 'pr']); // o PR carrega a branch: valor novo, evento novo
    assert.deepEqual(fatos(d, 'GM-14', 'branch').map((e) => e.dados.valor.nome), ['enabler/GM-14-a', 'enabler/GM-14-b']);
  });

  test('agentes: so {id, papel, estado}; descricao e transcript nunca vao ao diario; so grava quando muda; lista nula nao grava', () => {
    const d = repo();
    const ag = [{ id: 'a1', type: 'implementador', status: 'running', description: 'SEGREDO-DE-DESCRICAO', transcript: '/x/y.jsonl' }];
    assert.deepEqual(rodarMedir(d, 'ok', { agentes: ag }).gravados.filter((c) => c === 'agente'), ['agente']);
    assert.deepEqual(fatos(d, 'GM-14', 'agente')[0].dados, { chave: 'agente', fonte: 'mod', valor: { id: 'a1', papel: 'implementador', estado: 'running' } });
    assert.equal(readdirSync(dirDe(d)).map((n) => readFileSync(join(dirDe(d), n), 'utf8')).join('').includes('SEGREDO-DE-DESCRICAO'), false);
    assert.deepEqual(rodarMedir(d, 'ok', { agentes: ag }).gravados, []);
    ag[0].status = 'completed';
    assert.deepEqual(rodarMedir(d, 'ok', { agentes: ag }).gravados, ['agente']);
    const nula = medir(d, { rodar: rodarCom('ok'), agentes: { session_id: SID, agentes: null } });
    assert.deepEqual([nula.ok, nula.gravados], [true, []]);
    const ruim = rodarMedir(d, 'ok', { agentes: [{ id: '', type: 'x', status: 'y' }, null, { id: 'b', type: 'revisor', status: 'running' }] });
    assert.deepEqual([ruim.ok, ruim.falhas.filter((f) => f === 'agente_invalido').length, ruim.gravados], [false, 2, ['agente']]);
  });

  test('campo-extra-recusa-no-append: a forma de fato.medido recusa campo a mais e o diario fica sem ele', () => {
    const d = repo();
    rodarMedir(d);
    const antes = ler(dirDe(d)).length;
    const r = append(dirDe(d), SID, { ts: '2026-11-11T20:00:00.000Z', autor: 'painel', sessao: SID, agente: 'painel', tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero: 9, estado: 'aberto', branch: 'b', titulo: 'x' } } });
    assert.equal(r.ok, false);
    assert.match(r.erro, /forma_invalida/);
    assert.equal(ler(dirDe(d)).length, antes);
  });
});

describe('medir: gh falha (nada gravado, motivo distinto, estado em painel-medir.json)', () => {
  const estadoGh = (d) => JSON.parse(readFileSync(join(d, '.harness', 'painel-medir.json'), 'utf8'));

  for (const [modo, motivo] of [['ausente', 'gh_ausente'], ['dorme', 'gh_timeout'], ['rc4', 'gh_sem_login'], ['rc1', /^gh_falhou: pr list rc 1$/], ['parcial', /^gh_json_invalido: pr list$/], ['lixo', /^gh_json_invalido: pr list$/], ['estado-novo', /^gh_json_invalido: pr list$/]]) {
    test(`gh-ausente-x-timeout: modo ${modo} => 0 evento pr/release, gh falhou, ok false`, () => {
      const d = repo();
      const t0 = Date.now();
      const r = rodarMedir(d, modo, { timeoutMs: 300 });
      assert.ok(Date.now() - t0 < 5000, 'o timeout de gh vale (nao espera os 10 s do gh falso)');
      assert.equal(r.ok, false);
      assert.deepEqual(r.gravados, ['branch']); // fato de git entra; o de gh nao
      assert.equal(r.falhas.length, 1);
      if (typeof motivo === 'string') assert.equal(r.falhas[0], motivo); else assert.match(r.falhas[0], motivo);
      assert.equal(fatos(d, 'GM-14', 'pr').length, 0);
      assert.equal(fatos(d, 'GM-14', 'release').length, 0);
      assert.equal(estadoGh(d)['GM-14'].gh, 'falhou');
    });
  }

  test('gh-parcial: pr ok e release falha => nenhum fato de gh (tudo ou nada), nem o pr que veio ok', () => {
    const d = repo();
    const r = rodarMedir(d, 'release-rc1');
    assert.deepEqual([r.ok, r.gravados, r.falhas], [false, ['branch'], ['gh_falhou: release list rc 1']]);
    assert.equal(fatos(d, 'GM-14', 'pr').length, 0);
    assert.equal(estadoGh(d)['GM-14'].gh, 'falhou');
  });

  test('os 3 motivos (ausente, sem login, timeout) sao distintos entre si', () => {
    const m = ['ausente', 'rc4', 'dorme'].map((modo) => rodarMedir(repo(), modo, { timeoutMs: 300 }).falhas[0]);
    assert.equal(new Set(m).size, 3);
  });

  test('gh ok depois de falhar: grava e o estado volta a ok; medir nao apaga a entrega dos outros', () => {
    const d = repo();
    rodarMedir(d, 'rc1');
    assert.equal(estadoGh(d)['GM-14'].gh, 'falhou');
    const outra = repo('fix/AB-2-x');
    assert.equal(outra === d, false);
    const r = rodarMedir(d, 'ok');
    assert.equal(r.ok, true);
    const e = estadoGh(d);
    assert.deepEqual(e['GM-14'], { gh: 'ok', em: '2026-11-11T20:00:00.000Z' });
    // 2 entregas no MESMO repositorio: a chave e por entrega, uma nao pisa na outra
    git(d, 'checkout', '-q', '-b', 'fix/AB-2-x');
    rodarMedir(d, 'rc1');
    const e2 = estadoGh(d);
    assert.equal(e2['GM-14'].gh, 'ok');
    assert.equal(e2['AB-2'].gh, 'falhou');
  });

  test('painel-medir.json corrompido recomeca (cache, nao fonte) e nao quebra a medicao', () => {
    const d = repo();
    mkdirSync(join(d, '.harness'), { recursive: true });
    writeFileSync(join(d, '.harness', 'painel-medir.json'), '{ nao e json');
    const r = rodarMedir(d, 'ok');
    assert.equal(r.ok, true);
    assert.equal(estadoGh(d)['GM-14'].gh, 'ok');
  });

  test('gh recebe timeout de 5 s por padrao e o argumento do parametro quando dado', () => {
    const d = repo();
    const vistos = [];
    const base = rodarCom('ok');
    const rodar = (c, a, o) => { if (c === 'gh') vistos.push(o.timeoutMs); return base(c, a, o); };
    medir(d, { rodar, agentes: entrada() });
    medir(d, { rodar, agentes: entrada(), timeoutMs: 1234 });
    assert.deepEqual(vistos, [5000, 5000, 1234, 1234]);
  });

  test('gh rc 0 com JSON parcial nao vira PR vazio: falha, e o PR gravado antes continua unico', () => {
    const d = repo();
    rodarMedir(d, 'pr-aberto');
    const antes = fatos(d, 'GM-14', 'pr').length;
    const r = rodarMedir(d, 'parcial');
    assert.equal(r.ok, false);
    assert.equal(fatos(d, 'GM-14', 'pr').length, antes);
  });

  test('estado do PR sem distincao de caixa (merged, MERGED)', () => {
    const d = repo();
    assert.equal(rodarMedir(d, 'estado-minusculo').ok, true);
    assert.equal(fatos(d, 'GM-14', 'pr')[0].dados.valor.estado, 'mergeado');
  });
});

describe('medir: entrega, sessao e diario', () => {
  test('sem-id-vai-a-sem-id: branch sem ID grava so branch (e release) em _sem-id e nao consulta PR', () => {
    const d = repo('main');
    const log = join(d, '..', 'gh.log');
    const r = rodarMedir(d, 'ok', { log });
    assert.deepEqual(r.gravados, ['branch', 'release']);
    assert.equal(fatos(d, '_sem-id').length, 2);
    assert.equal(existsSync(dirDe(d, 'GM-14')), false);
    const chamadas = readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(chamadas.map((c) => c.split(' ').slice(0, 2).join(' ')), ['release list']);
    assert.equal(JSON.parse(readFileSync(join(d, '.harness', 'painel-medir.json'), 'utf8'))['_sem-id'].gh, 'ok');
  });

  test('HEAD destacado: sem branch, sem pr, sem falha, em _sem-id', () => {
    const d = repo(null);
    const r = rodarMedir(d);
    assert.deepEqual([r.ok, r.gravados], [true, ['release']]);
    assert.equal(fatos(d, '_sem-id', 'branch').length, 0);
  });

  test('a mesma regra de ID da trilha: 7 branches (ID no meio do nome nao identifica) vao ao diario do ID que a trilha identifica (ou _sem-id)', () => {
    const casos = [['enabler/GM-14-clareza', 'GM-14'], ['feat/AB-7', 'AB-7'], ['GM-3-x', 'GM-3'], ['hotfix/semid', '_sem-id'], ['fix-algo', '_sem-id'], ['feat/refactor-GM-5-x', '_sem-id'], ['main', '_sem-id']];
    for (const [branch, id] of casos) {
      const d = repo(branch);
      rodarMedir(d);
      assert.equal(fatos(d, id, 'branch').length, 1, branch);
      assert.deepEqual(readdirSync(join(d, '.harness', 'entregas')), [id], branch);
      const t = trilhaDe({ branch, idPadrao: '[A-Z]+-\\d+', specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [] }, []);
      assert.equal(t.candidato ?? '_sem-id', id, branch);
    }
  });

  test('sem session_id nada e gravado (DP-2: a ancora de (b) e por sessao)', () => {
    const d = repo();
    for (const resto of [{ agentes: undefined }, { agentes: { agentes: [] } }, { agentes: { session_id: 7 } }, { agentes: { session_id: '' } }]) {
      const r = medir(d, { rodar: rodarCom('ok'), ...resto });
      assert.deepEqual([r.ok, r.gravados, r.falhas], [false, [], ['sem_sessao']]);
    }
    assert.equal(existsSync(join(d, '.harness')), false);
  });

  test('session_id invalido (../x) nao grava', () => {
    const d = repo();
    const r = medir(d, { rodar: rodarCom('ok'), agentes: { session_id: '../x', agentes: [] } });
    assert.deepEqual([r.ok, r.gravados, r.falhas], [false, [], ['sessao_invalida']]);
    assert.equal(existsSync(join(d, '.harness')), false);
  });

  test('sessao do stdin: o evento e o arquivo levam o session_id do mod (sessao.session_id tambem)', () => {
    const d = repo();
    medir(d, { rodar: rodarCom('ok'), agentes: { sessao: { session_id: 'via-sessao' }, agentes: [] } });
    assert.ok(existsSync(join(dirDe(d), 'events.via-sessao.jsonl')));
    assert.equal(fatos(d)[0].sessao, 'via-sessao');
  });

  test('--agentes=true le o stdin (funcao); vazio e nao JSON dao falhas distintas e nada e gravado', () => {
    const d = repo();
    const r = medir(d, { rodar: rodarCom('ok'), agentes: true, stdin: () => JSON.stringify(entrada()) });
    assert.equal(r.ok, true);
    const vazio = medir(d, { rodar: rodarCom('ok'), agentes: true, stdin: () => '  ' });
    const lixo = medir(d, { rodar: rodarCom('ok'), agentes: true, stdin: () => 'x{' });
    const arr = medir(d, { rodar: rodarCom('ok'), agentes: true, stdin: () => '[]' });
    assert.deepEqual([vazio.falhas, lixo.falhas, arr.falhas], [['stdin_ausente'], ['stdin_invalido'], ['stdin_invalido']]);
  });

  test('medir-diario-ausente-x-corrompido: ausente grava a 1a medicao; corrompido falha e nao grava nada', () => {
    const d = repo();
    assert.equal(existsSync(dirDe(d)), false);
    assert.equal(rodarMedir(d).ok, true);
    const arq = join(dirDe(d), `events.${SID}.jsonl`);
    const bom = readFileSync(arq, 'utf8');
    writeFileSync(arq, `${bom.trimEnd()}\nlinha-corrompida\n`);
    const antes = readdirSync(dirDe(d)).map((n) => readFileSync(join(dirDe(d), n), 'utf8'));
    spec(d, 'a.md', 'PBI: GM-14');
    const r = rodarMedir(d);
    assert.equal(r.ok, false);
    assert.deepEqual(r.gravados, []);
    assert.match(r.falhas[0], /^diario_corrompido: /);
    assert.deepEqual(readdirSync(dirDe(d)).map((n) => readFileSync(join(dirDe(d), n), 'utf8')), antes);
    assert.equal(existsSync(join(d, '.harness', 'painel-medir.json')), true); // o estado do gh da medicao anterior segue la
  });

  test('fora de repositorio git: falha, nada gravado', () => {
    const d = mkdtempSync(join(tmpdir(), 'sem repo '));
    const r = rodarMedir(d);
    assert.equal(r.ok, false);
    assert.deepEqual(r.gravados, []);
    assert.equal(existsSync(join(d, '.harness')), false);
  });
});

describe('medir: specs e plano da entrega', () => {
  test('spec so pelo cabecalho: PBI no corpo, de outro ID ou sem PBI nao contam; ID colado em outro nao casa', () => {
    const d = repo();
    spec(d, 'certa.md', 'Iniciativa: x · PBI: GM-14 (Enabler) · Data: y');
    spec(d, 'corpo.md', 'Sem cabecalho de PBI', '## Seção\nPBI: GM-14 citado no corpo\n');
    spec(d, 'outra.md', 'PBI: GM-99');
    spec(d, 'colado.md', 'PBI: GM-144');
    spec(d, 'sem.md', 'nada aqui');
    spec(d, 'minuscula.md', 'pbi: GM-14');
    rodarMedir(d);
    assert.deepEqual(fatos(d, 'GM-14', 'spec').map((e) => e.dados.valor.caminho), ['docs/superpowers/specs/certa.md']);
  });

  test('duas specs do mesmo PBI: as duas sao medidas (a trilha decide a ambiguidade)', () => {
    const d = repo();
    spec(d, 'a.md', 'PBI: GM-14');
    spec(d, 'b.md', 'PBI: GM-14');
    assert.deepEqual(rodarMedir(d).gravados.filter((c) => c === 'spec'), ['spec', 'spec']);
  });

  test('spec lida do checkout da sessao (worktree), diario na raiz principal (DP-3 ajuste 4)', () => {
    const d = repo('main');
    spec(d, 'a.md', 'PBI: GM-14', '## So na principal\n');
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'spec');
    const wt = join(dirname(d), 'wt');
    git(d, 'worktree', 'add', '-q', '-b', 'wt/GM-14-T11', wt);
    spec(wt, 'a.md', 'PBI: GM-14', '## A\n## B\n');
    const r = medir(wt, { rodar: rodarCom('ok'), agentes: entrada() });
    assert.equal(r.ok, true);
    assert.equal(existsSync(join(wt, '.harness')), false, 'nada em .harness da worktree');
    const s = fatos(d, 'GM-14', 'spec');
    assert.equal(s.length, 1);
    assert.equal(s[0].dados.valor.secoes, 2); // a spec da worktree, nao a da principal (1)
    assert.equal(fatos(d, 'GM-14', 'branch')[0].dados.valor.nome, 'wt/GM-14-T11');
  });

  test('plano: ausente nao e falha; ilegivel e forma errada sao falha e nao gravam', () => {
    const d = repo();
    assert.equal(rodarMedir(d).ok, true);
    mkdirSync(dirDe(d), { recursive: true });
    writeFileSync(join(dirDe(d), 'plano.json'), '{ quebrado');
    const r = rodarMedir(d);
    assert.deepEqual([r.ok, r.falhas, fatos(d, 'GM-14', 'plano').length], [false, ['plano_ilegivel'], 0]);
    writeFileSync(join(dirDe(d), 'plano.json'), JSON.stringify({ tasks: 'x' }));
    assert.deepEqual(rodarMedir(d).falhas, ['plano_ilegivel']);
    writeFileSync(join(dirDe(d), 'plano.json'), JSON.stringify({ tasks: [{}, {}] }));
    assert.deepEqual(rodarMedir(d).gravados, ['plano']);
    assert.equal(fatos(d, 'GM-14', 'plano')[0].dados.valor.tasks, 2);
  });
});

describe('medir: pelo painel.mjs (CLI real)', () => {
  const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
  const cli = (d, args, input) => spawnSync(process.execPath, [PAINEL, ...args], { cwd: d, input, encoding: 'utf8', env: { ...process.env, PATH: `${FAKE_GH}:${process.env.PATH}`, GH_MODO: 'ok' } });

  test('painel.mjs medir --agentes le o stdin e grava; sem --agentes nao ha sessao e rc 1; uma linha de JSON', () => {
    const d = repo();
    const r = cli(d, ['medir', '--agentes'], JSON.stringify(entrada()));
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out, { ok: true, gravados: ['branch', 'pr', 'pr', 'release'], falhas: [] });
    const r2 = cli(d, ['medir'], '');
    assert.equal(r2.status, 1);
    assert.deepEqual(JSON.parse(r2.stdout).falhas, ['sem_sessao']);
    assert.equal(r2.stdout.trim().split('\n').length, 1);
  });

  test('stdin vazio ou nao JSON com --agentes: rc 1, motivo distinto, nada gravado', () => {
    const d = repo();
    assert.deepEqual(JSON.parse(cli(d, ['medir', '--agentes'], '').stdout).falhas, ['stdin_ausente']);
    assert.deepEqual(JSON.parse(cli(d, ['medir', '--agentes'], 'x{').stdout).falhas, ['stdin_invalido']);
    assert.equal(existsSync(join(d, '.harness')), false);
  });
});

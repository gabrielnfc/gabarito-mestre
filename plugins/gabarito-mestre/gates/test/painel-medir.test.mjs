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
import { append, ler, lerEstrito, lerAprendizados, exportarAprendizados, padraoDeRecusa } from '../dist/diario.js';
import { trilhaDe, ancoraDaPerguntaB } from '../dist/trilha.js';
import { marcaDeProgresso, jaParou } from '../dist/pouso.js';
import { medir } from '../scripts/painel-medir.mjs';
import { estadoDoPainel } from '../scripts/painel.mjs';

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

describe('medir: dedupe por sessao (BLOCKER r1) e recusa do canario (MAJOR r1, REQ-DIA-1 emenda)', () => {
  test('nova-sessao-em-main-grava-e-tem-ancora-b: a 1a medicao de cada sessao grava; repetir na mesma sessao nao', () => {
    const d = repo('main');
    const A = rodarMedir(d);
    assert.deepEqual(A.gravados, ['branch', 'release']);
    const B = medir(d, { rodar: rodarCom('ok'), agentes: entrada([], 'sessao-2'), agora: () => Date.parse('2026-11-11T20:05:00Z') });
    assert.deepEqual(B.gravados, ['branch', 'release']);
    const B2 = medir(d, { rodar: rodarCom('ok'), agentes: entrada([], 'sessao-2'), agora: () => Date.parse('2026-11-11T20:06:00Z') });
    assert.deepEqual(B2.gravados, []);
    const ev = ler(dirDe(d, '_sem-id'));
    assert.equal(ancoraDaPerguntaB(ev, SID), `${SID}:1`);
    assert.equal(ancoraDaPerguntaB(ev, 'sessao-2'), 'sessao-2:1');
    assert.equal(ev.filter((e) => e.sessao === 'sessao-2' && e.tipo === 'fato.medido').length, 2);
  });

  const CANARIO_A = 'feat/GM-14-AKIAABCDEFGHIJKLMNOP';
  const CANARIO_B = 'feat/GM-14-ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const recusas = (d) => ler(dirDe(d)).filter((e) => e.tipo === 'diario.recusa');

  test('recusa-uma-vez-por-sessao-por-motivo: 3 medicoes com o mesmo canario => 1 recusa; motivo novo => nova recusa; falha segue ok:false', () => {
    const d = repo(CANARIO_A);
    const falhas = [];
    for (let i = 0; i < 3; i++) falhas.push(rodarMedir(d, 'pr-vazio').falhas);
    assert.deepEqual(falhas, [['recusado: branch'], ['recusado: branch'], ['recusado: branch']]);
    assert.equal(recusas(d).length, 1);
    assert.deepEqual(recusas(d)[0].dados, { tipo: 'fato.medido', padrao: 'AKIA' });
    assert.equal(recusas(d)[0].sessao, SID);
    // outro motivo na MESMA sessão => nova recusa
    git(d, 'checkout', '-q', '-b', CANARIO_B);
    rodarMedir(d, 'pr-vazio');
    rodarMedir(d, 'pr-vazio');
    assert.deepEqual(recusas(d).map((e) => e.dados.padrao), ['AKIA', 'ghp']);
    // sessão nova, mesmo motivo => 1 recusa dela
    medir(d, { rodar: rodarCom('pr-vazio'), agentes: entrada([], 'sessao-2'), agora: () => Date.parse('2026-11-11T21:00:00Z') });
    medir(d, { rodar: rodarCom('pr-vazio'), agentes: entrada([], 'sessao-2'), agora: () => Date.parse('2026-11-11T21:01:00Z') });
    assert.deepEqual(recusas(d).map((e) => `${e.sessao}:${e.dados.padrao}`), [`${SID}:AKIA`, `${SID}:ghp`, 'sessao-2:ghp']);
  });

  test('recusa-na-mesma-medicao: branch e 2 PRs (mesmo canario) numa so medicao => 1 recusa, e a falha de cada fato recusado segue', () => {
    const d = repo(CANARIO_A);
    const r = rodarMedir(d, 'ok');
    assert.deepEqual(r.falhas, ['recusado: branch', 'recusado: pr', 'recusado: pr']);
    assert.equal(recusas(d).length, 1);
    assert.deepEqual(fatos(d, 'GM-14', 'release').length, 1);
  });

  test('recusa-por-tamanho: linha acima de 16 KiB (agente com id enorme) => 1 recusa "tamanho" por sessao, nao uma por medicao', () => {
    const d = repo();
    const ags = [{ id: 'x'.repeat(20000), type: 'impl', status: 'running' }];
    for (let i = 0; i < 3; i++) rodarMedir(d, 'ok', { agentes: ags });
    assert.deepEqual(recusas(d).map((e) => e.dados.padrao), ['tamanho']);
  });

  test('recusa-duas-camadas: o padrao que a medicao usa e o que o append aplica (mesma funcao); id de 5000 chars (sonda r2) e mais 3 tamanhos => no maximo 1 recusa por sessao e igual ao veredito do append', () => {
    assert.equal(typeof padraoDeRecusa, 'function');
    for (const n of [100, 5000, 16000, 20000]) {
      const d = repo();
      const ags = [{ id: 'x'.repeat(n), type: 'impl', status: 'running' }];
      for (let i = 0; i < 3; i++) rodarMedir(d, 'ok', { agentes: ags });
      // o mesmo evento direto no append (sessão própria): o veredito do append é o que a medição precisa prever
      const ev = { ts: '2026-11-11T20:00:00.000Z', autor: 'painel', sessao: 'gemea', agente: 'painel', tipo: 'fato.medido', dados: { chave: 'agente', fonte: 'mod', valor: { id: 'x'.repeat(n), papel: 'impl', estado: 'running' } } };
      const g = join(d, 'gemea');
      const r = append(g, 'gemea', ev);
      assert.equal(r.ok, true);
      const recusou = r.gravado === 'recusa';
      assert.equal(padraoDeRecusa(ev) !== null, recusou, `n=${n}`);
      const rec = recusas(d).filter((e) => e.sessao === SID);
      assert.equal(rec.length, recusou ? 1 : 0, `n=${n}: recusas da medição`);
    }
  });

  test('recusa-nao-e-progresso: a marca de progresso nao muda com recusas, e jaParou nao se desfaz', () => {
    const d = repo(CANARIO_A);
    rodarMedir(d, 'pr-vazio');
    const antes = marcaDeProgresso(ler(dirDe(d)));
    for (let i = 0; i < 3; i++) rodarMedir(d, 'pr-vazio');
    git(d, 'checkout', '-q', '-b', CANARIO_B);
    rodarMedir(d, 'pr-vazio');
    const ev = ler(dirDe(d));
    assert.ok(ev.some((e) => e.tipo === 'diario.recusa'));
    assert.equal(marcaDeProgresso(ev), antes);
    assert.equal(marcaDeProgresso(ev), 0);
    const parar = append(dirDe(d), 'loop', { ts: '2026-11-11T20:10:00.000Z', autor: 'loop', sessao: 'loop', agente: 'loop', tipo: 'loop.parar', dados: { motivo: 'teto_rodadas' } });
    assert.equal(parar.ok, true, parar.erro);
    rodarMedir(d, 'pr-vazio');
    assert.equal(jaParou(ler(dirDe(d))), true);
  });
});

describe('medir -> consumidores reais (P9): CLI grava, trilhaDe e pouso leem o que foi gravado', () => {
  const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
  const cli = (d, input) => spawnSync(process.execPath, [PAINEL, 'medir', '--agentes'], { cwd: d, input, encoding: 'utf8', env: { ...process.env, PATH: `${FAKE_GH}:${process.env.PATH}`, GH_MODO: 'pr-aberto' } });

  test('cli-medir-alimenta-trilha-e-ancora: PR aberto medido vira "aberto" na trilha; marca de progresso fica 0; ancora (b) da sessao nova vem do medir', () => {
    const d = repo();
    assert.equal(cli(d, JSON.stringify(entrada([], 'sessao-1'))).status, 0);
    assert.equal(cli(d, JSON.stringify(entrada([], 'sessao-2'))).status, 0);
    const ev = ler(dirDe(d));
    const t = trilhaDe({ branch: 'enabler/GM-14-clareza', idPadrao: '[A-Z]+-\\d+', specs: [], plano: null, ledger: false, gh: 'ok', ultimas: [], sessao: 'sessao-2' }, ev);
    assert.equal(t.identificada, false); // sem spec/plano a trilha não se afirma; o PR medido só entra com 2º fato (regra da trilha)
    assert.equal(ancoraDaPerguntaB(ev, 'sessao-2'), `sessao-2:${ev.find((e) => e.sessao === 'sessao-2').seq}`);
    assert.equal(marcaDeProgresso(ev), 0);
    // com um plano medido (2º fato) a trilha usa o PR que o medir gravou: aberto => fase PR não é ✓
    mkdirSync(dirDe(d), { recursive: true });
    writeFileSync(join(dirDe(d), 'plano.json'), JSON.stringify({ tasks: [{ id: 'T1' }] }));
    assert.equal(cli(d, JSON.stringify(entrada([], 'sessao-3'))).status, 0);
    const ev2 = ler(dirDe(d));
    const t2 = trilhaDe({ branch: 'enabler/GM-14-clareza', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: ['T1'] }, ledger: false, gh: 'ok', ultimas: [], sessao: 'sessao-3' }, ev2);
    assert.equal(t2.identificada, true);
    assert.equal(t2.entrega, 'GM-14');
    assert.equal(t2.marcas[5], '○'); // PR aberto (não mergeado) medido pelo CLI: a fase PR não está concluída
    assert.equal(jaParou(ev2), false);
  });

  test('medicao-e-aprendizado-no-mesmo-diario: fato.medido e diario.recusa do medir real + aprendizado => extrato so com aprendizado, sem aviso, leitura estrita ok', () => {
    const d = repo();
    const recusas = () => ler(dirDe(d)).filter((e) => e.tipo === 'diario.recusa');
    // caminho real da medição: fato.medido (branch) e o agente enorme vira 1 diario.recusa 'tamanho'
    rodarMedir(d, 'ok', { agentes: [{ id: 'x'.repeat(20000), type: 'impl', status: 'running' }] });
    rodarMedir(d, 'ok', { agentes: [{ id: 'x'.repeat(20000), type: 'impl', status: 'running' }] });
    assert.ok(fatos(d).length >= 1, 'a medição gravou fato.medido');
    assert.deepEqual(recusas().map((e) => e.dados.padrao), ['tamanho']);
    const dados = { tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra: 'regra medicao e aprendizado', entra_em: ['instantaneo'] };
    const r = append(dirDe(d), 'loop', { ts: '2026-11-11T20:05:00.000Z', autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo: 'aprendizado', dados });
    assert.equal(r.ok, true, r.erro);
    assert.equal(r.gravado, 'evento');
    assert.deepEqual([...new Set(ler(dirDe(d)).map((e) => e.tipo))].sort(), ['aprendizado', 'diario.recusa', 'fato.medido']);
    const le = lerAprendizados(join(d, '.harness', 'entregas'));
    assert.deepEqual(le.avisos, []);
    assert.ok(le.porEntrega.get('GM-14').some((e) => e.tipo === 'aprendizado'));
    assert.deepEqual(exportarAprendizados(d), { ok: true, linhas: 1, fora: 0, avisos: [] });
    const texto = readFileSync(join(d, '.harness', 'aprendizados.jsonl'), 'utf8');
    const extrato = texto.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(extrato.map((l) => l.evento.tipo), ['aprendizado']);
    assert.equal(extrato[0].entrega, 'GM-14');
    assert.ok(!texto.includes('xxxxxxxxxx'));
    assert.equal(lerEstrito(dirDe(d)).ok, true);
  });
});

describe('medir: tetos e validacao de release (R1, R2, R4 do revisor)', () => {
  test('release-tag-nao-texto: tagName 123 => falha, nenhum fato de gh', () => {
    const d = repo();
    const r = rodarMedir(d, 'release-tag-invalida');
    assert.deepEqual(r.falhas, ['gh_json_invalido: release list']);
    assert.equal(fatos(d, 'GM-14', 'release').length + fatos(d, 'GM-14', 'pr').length, 0);
  });
  test('teto-de-agentes: 60 agentes => 50 gravados', () => {
    const d = repo();
    const ags = Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, type: 'implementador', status: 'running' }));
    rodarMedir(d, 'ok', { agentes: ags });
    assert.equal(fatos(d, 'GM-14', 'agente').length, 50);
  });
  test('teto-de-spec: spec com mais de 1 MiB falha (spec_grande) e nao e lida', () => {
    const d = repo();
    spec(d, 'grande.md', 'PBI: GM-14', `## S\n${'x'.repeat(1024 * 1024 + 1)}\n`);
    const r = rodarMedir(d);
    assert.ok(r.falhas.includes('spec_grande: grande.md'), JSON.stringify(r.falhas));
    assert.equal(fatos(d, 'GM-14', 'spec').length, 0);
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

describe('medir: entrega publicada segue gravando fato.medido na branch (T43, emenda 38, FIEL-1 b/c, REQ-DIA-1)', () => {
  // a âncora da pergunta (b) é o 1º fato.medido da sessão, lido só do diário da branch: mandá-lo a _sem-id impede a pergunta de abrir
  const medirAs = (d, sessao, modo, minuto) => medir(d, { rodar: rodarCom(modo), agentes: entrada([], sessao), timeoutMs: 5000, agora: () => Date.parse('2026-11-11T20:00:00Z') + minuto * 60000 });
  const comLedger = () => { const d = repo(); mkdirSync(join(d, 'docs', 'ledgers'), { recursive: true }); writeFileSync(join(d, 'docs', 'ledgers', 'GM-14.md'), '# GM-14\n'); return d; };

  test('medir-em-publicada-grava-na-branch: PR mergeado e nenhum aberto => fato.medido na entrega da branch, nada em _sem-id', () => {
    const d = comLedger();
    assert.equal(medirAs(d, 'sessao-1', 'pr-aberto', 1).ok, true);
    assert.equal(medirAs(d, 'sessao-1', 'estado-minusculo', 2).ok, true);
    const antes = fatos(d, 'GM-14').length;
    assert.equal(medirAs(d, 'sessao-2', 'estado-minusculo', 3).ok, true);
    assert.equal(fatos(d, 'GM-14', 'pr').at(-1).dados.valor.estado, 'mergeado');
    assert.ok(fatos(d, 'GM-14').length > antes, 'a sessão nova grava na entrega mesmo com ela publicada');
    assert.equal(existsSync(dirDe(d, '_sem-id')), false);
  });

  test('pergunta-b-abre-apos-publicacao: sessão nova depois do merge => estadoDoPainel com a pergunta (b) aberta', () => {
    const d = comLedger();
    assert.equal(medirAs(d, 'sessao-1', 'pr-aberto', 1).ok, true);
    assert.equal(medirAs(d, 'sessao-1', 'estado-minusculo', 2).ok, true);
    assert.equal(medirAs(d, 'sessao-2', 'estado-minusculo', 3).ok, true);
    const r = estadoDoPainel(d, { agentes: entrada([], 'sessao-2'), fuso: 'UTC' });
    assert.equal(r.ok, true);
    assert.match(JSON.stringify(r), /Esta conversa é da entrega|De que entrega é esta conversa/);
  });
});

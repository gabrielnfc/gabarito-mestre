/**
 * `painel.mjs medir` (GM-14 T11, REQ-DIA-1): único que grava `fato.medido`, e só quando o valor muda.
 * Cada caso sobe um repositório git descartável (com ESPAÇO no caminho) e um `gh` falso no PATH (fixtures/gh/gh, modo em GH_MODO).
 * O núcleo é chamado em processo (`medir`); o CLI real tem o seu caso no fim.
 *
 * MUTAÇÕES PRESCRITAS: task-11-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { raizSegura, raizesDeCheckout } from './_raiz-segura.mjs';
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { append, ler, lerEstrito, lerAprendizados, exportarAprendizados, padraoDeRecusa } from '../dist/diario.js';
import { trilhaDe, ancoraDaPerguntaB, encerramentoDe } from '../dist/trilha.js';
import { marcaDeProgresso, jaParou } from '../dist/pouso.js';
import { medir } from '../scripts/painel-medir.mjs';
import { estadoDoPainel } from '../scripts/painel.mjs';
import { pedidoOnboarding } from '../../mod/painel.mjs';
import { entregaPublicada, SESSAO_QUALQUER } from '../dist/guarda.js';
import { loteDoDono } from '../dist/depende.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FAKE_GH = join(AQUI, 'fixtures', 'gh');
const SID = 'sessao-1';
const raizes = [];
after(() => { /* temporários ficam em TMPDIR (gitignored); nada é apagado (R2) */ });

const GIT_ENV = { ...process.env, HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'user.useConfigOnly=true', ...args], { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

/** Repo descartável na `branch` (`null` ⇒ HEAD solto). `onboarding: false` ⇒ sem `harness.config.json` (T60: o painel só lê). */
function repo(branch = 'enabler/GM-14-clareza', opts = {}) {
  return repoEm(realpathSync(mkdtempSync(join(tmpdir(), 'medir teste '))), branch, opts);
}
/** Mesmo repo descartável numa base dada: a base passa por `raizSegura` ANTES de qualquer escrita (T24, origem S2). */
function repoEm(base, branch = 'enabler/GM-14-clareza', { onboarding = true } = {}) {
  const d = join(raizSegura(base), 'r');
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'commit', '-q', '--allow-empty', '-m', 'ini');
  if (onboarding) { writeFileSync(join(d, 'harness.config.json'), '{}\n'); git(d, 'add', 'harness.config.json'); git(d, 'commit', '-q', '-m', 'onboarding'); }
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

describe('medir: só com onboarding (T60, REQ-DIA-1, emenda 68)', () => {
  const arvore = (d) => (existsSync(join(d, '.harness')) ? readdirSync(join(d, '.harness'), { recursive: true }) : []);

  test('sem-onboarding-zero-escrita-e-zero-gh: turnos e 60 s depois, nada em .harness/ e gh nunca chamado', () => {
    const d = repo('enabler/GM-14-clareza', { onboarding: false });
    spec(d, 'a.md', 'PBI: GM-14', '## S1\n');
    const log = join(mkdtempSync(join(tmpdir(), 'gh log ')), 'gh.log');
    let agora = Date.parse('2026-11-11T20:00:00Z');
    for (let i = 0; i < 3; i++) {
      const r = rodarMedir(d, 'ok', { log, agentes: [{ id: 'a1', type: 'implementador', status: 'running' }], agora: () => agora });
      assert.deepEqual(r, { ok: true, gravados: [], falhas: [] });
      agora += 30000; // 3 medições em 60 s simulados
    }
    assert.deepEqual(arvore(d), []);
    assert.equal(existsSync(log), false);
  });

  test('sem-onboarding-id-nulo (_sem-id): branch sem ID também não grava nem chama gh', () => {
    const d = repo('feature/sem-id', { onboarding: false });
    const log = join(mkdtempSync(join(tmpdir(), 'gh log ')), 'gh.log');
    assert.deepEqual(rodarMedir(d, 'ok', { log }), { ok: true, gravados: [], falhas: [] });
    assert.deepEqual(arvore(d), []);
    assert.equal(existsSync(log), false);
  });

  test('ponte-real (mod): o argv de pedidoOnboarding roda temOnboarding da guarda; sem config ⇒ false, com ⇒ true; entrada torta ⇒ null', () => {
    const raizPlugin = join(AQUI, '..', '..');
    const ler = (dir) => {
      const p = pedidoOnboarding(dir, raizPlugin);
      const r = spawnSync(p.argv[0], p.argv.slice(1), { input: p.stdin, encoding: 'utf8', cwd: dir });
      return r.status === 0 ? JSON.parse(r.stdout) : null;
    };
    const d = repo('enabler/GM-14-clareza', { onboarding: false });
    assert.deepEqual(ler(d), { ok: true, onboarding: false });
    writeFileSync(join(d, 'harness.config.json'), '{}\n');
    assert.deepEqual(ler(d), { ok: true, onboarding: true });
    assert.equal(pedidoOnboarding('', raizPlugin), null);
    assert.equal(pedidoOnboarding(d, ''), null);
    const fora = mkdtempSync(join(tmpdir(), 'fora de repo '));
    assert.deepEqual(ler(fora), { ok: true, onboarding: false });
  });

  test('estado-sem-onboarding-nunca-sem-loop (cond. 4): repo git sem harness.config.json ⇒ o estado lê, não devolve sem_loop/plano_ausente, e não cria .harness/', () => {
    const d = repo('enabler/GM-14-clareza', { onboarding: false });
    const r = estadoDoPainel(d, { agentes: entrada([], 'sessao-9'), fuso: 'UTC' });
    assert.equal(r.ok, true);
    assert.doesNotMatch(JSON.stringify(r), /sem_loop|plano_ausente|entrega_nao_inferida/);
    assert.deepEqual(r.estado.fontesFalhas, []); // fonte não consultada (gh) NÃO conta como "não lida" no DEPENDE (medido, cond. 3)
    assert.equal(r.estado.pronto, null);
    assert.deepEqual(arvore(d), []);
  });

  test('com-onboarding: o comportamento atual (grava e chama gh)', () => {
    const d = repo();
    const log = join(mkdtempSync(join(tmpdir(), 'gh log ')), 'gh.log');
    const r = rodarMedir(d, 'ok', { log });
    assert.equal(r.ok, true);
    assert.ok(r.gravados.includes('branch') && r.gravados.includes('pr'));
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 3); // pr list (head) + pr list (título, T4) + release list
    assert.ok(existsSync(join(d, '.harness', 'painel-medir.json')));
  });

  test('onboarding-so-em-origin-HEAD (config no remoto, nenhuma local): mesmo critério da guarda ⇒ grava', () => {
    const d = repo('enabler/GM-14-clareza', { onboarding: false });
    const o = mkdtempSync(join(tmpdir(), 'origem '));
    git(o, 'init', '-q', '-b', 'main');
    writeFileSync(join(o, 'harness.config.json'), '{}\n');
    git(o, 'add', '.'); git(o, 'commit', '-q', '-m', 'cfg');
    git(d, 'remote', 'add', 'origin', o); git(d, 'fetch', '-q', 'origin'); git(d, 'remote', 'set-head', 'origin', 'main');
    assert.ok(rodarMedir(d, 'ok').gravados.includes('branch'));
  });
});

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
    assert.deepEqual(vistos, [5000, 5000, 5000, 1234, 1234, 1234]); // head, título (T4) e release por medição
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

// ─────────────────────────────────────────────────────────────── T48 emenda 47: UMA regra de "publicada", medir e gravadores no mesmo diário

describe('regra única de publicada: a função e o loop.mjs concordam no mesmo diário; o medir segue na entrega (T48, emenda 47 × decisão do dono, emenda 38)', () => {
  const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
  const SEMENTE = 'semente';
  const w = (d, sessao, tipo, dados, ts) => assert.equal(append(dirDe(d), sessao, { ts, autor: 't@t', sessao, agente: 'orquestrador', tipo, dados }).ok, true);
  const PR = (d, estado = 'mergeado') => w(d, SEMENTE, 'fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero: 7, estado, branch: 'enabler/GM-14-clareza' } }, '2026-11-12T10:00:00.000Z');
  const SPEC = (d) => w(d, SEMENTE, 'fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/a.md', sha256: 'a'.repeat(64), secoes: 2 } }, '2026-11-12T10:00:01.000Z');
  const PLANO = (d) => { mkdirSync(dirDe(d), { recursive: true }); writeFileSync(join(dirDe(d), 'plano.json'), JSON.stringify({ tasks: [{ id: 'T1' }] })); };
  const LEDGER = (d) => { mkdirSync(join(d, 'docs', 'ledgers'), { recursive: true }); writeFileSync(join(d, 'docs', 'ledgers', 'GM-14.md'), '# ledger\n'); };
  const LIGAR = (d, sessao) => {
    w(d, sessao, 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } }, '2026-11-13T10:00:00.000Z');
    const ancora = `${sessao}:${ler(dirDe(d)).find((e) => e.sessao === sessao).seq}`;
    w(d, sessao, 'dono.resposta', { pergunta: ancora, opcao: 1, rotulo: 'GM-14' }, '2026-11-13T10:00:01.000Z');
  };

  const casos = [
    ['2º fato por spec (fato.medido spec no diário)', (d) => { PR(d); SPEC(d); }, 'S9', true],
    ['2º fato por ledger', (d) => { PR(d); LEDGER(d); }, 'S9', true],
    ['2º fato por plano.json', (d) => { PR(d); PLANO(d); }, 'S9', true],
    ['branch sozinha, sem 2º fato', (d) => { PR(d); }, 'S9', false],
    ['PR aberto depois do mergeado', (d) => { PR(d); w(d, SEMENTE, 'fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero: 8, estado: 'aberto', branch: 'enabler/GM-14-clareza' } }, '2026-11-12T10:00:02.000Z'); PLANO(d); }, 'S9', false],
    ['dono ligou ESTA conversa por dono.resposta', (d) => { PR(d); PLANO(d); LIGAR(d, 'S9'); }, 'S9', false],
    ['dono ligou OUTRA conversa', (d) => { PR(d); PLANO(d); LIGAR(d, 'S1'); }, 'S9', true],
  ];
  const _semId = (d) => join(d, '.harness', 'entregas', '_sem-id');
  const doSessao = (dir, sessao) => (existsSync(dir) ? ler(dir).filter((e) => e.sessao === sessao) : []);

  for (const [nome, montar, sessao, publicada] of casos) {
    for (const gh of ['rc1', 'pr-vazio']) { // gh falhando agora (FIEL-1 c: vale o último pr do diário) e gh que não traz PR novo
      test(`${nome} [gh ${gh}] ⇒ publicada=${publicada}: entregaPublicada e loop.mjs concordam; medir fica na entrega`, () => {
        const d = repo();
        montar(d);
        const antes = ler(dirDe(d)).length;
        assert.equal(entregaPublicada(d, 'GM-14', sessao), publicada, 'a função única');
        const m = medir(d, { rodar: rodarCom(gh), agentes: entrada([], sessao), timeoutMs: 5000, agora: () => Date.parse('2026-11-14T10:00:00Z') });
        assert.ok(m.gravados.length > 0, JSON.stringify(m)); // algo novo a gravar (a falha do gh em rc1 é esperada)
        // o medir NÃO consulta a regra de publicada: por decisão do dono (emenda 38) o fato.medido do painel fica no diário da entrega, é dele a âncora da pergunta (b)
        assert.equal(doSessao(dirDe(d), sessao).filter((e) => e.tipo === 'fato.medido' && e.autor === 'painel').length > 0, true, 'o medir grava na entrega, publicada ou não');
        assert.equal(existsSync(_semId(d)), false, 'o medir nunca manda a _sem-id');
        // o loop.mjs (parar, sessão explícita) consulta a MESMA função
        const p = spawnSync(process.execPath, [LOOP, 'parar', 'nao_conseguiu', '--sessao', sessao], { cwd: d, encoding: 'utf8', env: GIT_ENV });
        const j = JSON.parse(p.stdout.trim());
        assert.equal(j.erro === 'entrega_publicada', publicada, p.stdout + p.stderr);
        if (!publicada) assert.equal(j.ok, true, p.stdout);
      });
    }
  }

  test('loop.mjs sem --sessao: o dono ligou uma conversa ⇒ o loop não trava (SESSAO_QUALQUER); sem ligação ⇒ publicada', () => {
    const d = repo();
    PR(d); PLANO(d);
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), true);
    LIGAR(d, 'S1');
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), false);
    assert.equal(entregaPublicada(d, 'GM-14', 'S1'), false);
    assert.equal(entregaPublicada(d, 'GM-14', 'S2'), true);
  });

  // MAJOR-1 r2 (decisão da Sombra, 3ª rodada): o "qualquer sessão" só vale com a ligação POSTERIOR ao último PR mergeado da entrega.
  const PRn = (d, numero, ts) => w(d, SEMENTE, 'fato.medido', { chave: 'pr', fonte: 'gh', valor: { numero, estado: 'mergeado', branch: 'enabler/GM-14-clareza' } }, ts);
  const LIGARem = (d, sessao, t0) => {
    w(d, sessao, 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } }, t0);
    const ancora = `${sessao}:${ler(dirDe(d)).find((e) => e.sessao === sessao).seq}`;
    w(d, sessao, 'dono.resposta', { pergunta: ancora, opcao: 1, rotulo: 'GM-14' }, new Date(Date.parse(t0) + 1000).toISOString());
  };
  const parar = (d) => JSON.parse(spawnSync(process.execPath, [LOOP, 'parar', 'nao_conseguiu'], { cwd: d, encoding: 'utf8', env: GIT_ENV }).stdout.trim());

  test('E (MAJOR-1 r2): ligação ANTERIOR ao PR mergeado não destrava o curinga; loop.mjs sem --sessao recusa e não grava', () => {
    const d = repo();
    LIGARem(d, 'S1', '2026-11-11T10:00:00.000Z'); // ligada antes da publicação
    PRn(d, 7, '2026-11-12T10:00:00.000Z'); PLANO(d);
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), true);
    const antes = ler(dirDe(d)).length;
    assert.equal(parar(d).erro, 'entrega_publicada');
    assert.equal(ler(dirDe(d)).length, antes, 'nada gravado na entrega publicada');
    // vizinho: a mesma ligação, agora posterior ao merge, destrava (o caso que já passava)
    LIGARem(d, 'S2', '2026-11-13T10:00:00.000Z');
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), false);
    assert.equal(parar(d).ok, true);
  });

  test('F (MAJOR-1 r2): republicação (PR novo mergeado depois de S1 ligada) recusa até nova resposta; sessão explícita e outra entrega seguem como antes', () => {
    const d = repo();
    PRn(d, 7, '2026-11-12T10:00:00.000Z'); PLANO(d);
    LIGARem(d, 'S1', '2026-11-13T10:00:00.000Z');
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), false, 'controle: ligação posterior destrava');
    PRn(d, 8, '2026-11-14T09:00:00.000Z'); // republicação
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), true);
    assert.equal(parar(d).erro, 'entrega_publicada');
    assert.equal(entregaPublicada(d, 'GM-14', 'S1'), false, '--sessao explícita de quem o dono ligou segue valendo');
    LIGARem(d, 'S3', '2026-11-14T10:00:00.000Z'); // nova resposta depois do novo merge
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), false);
    assert.equal(entregaPublicada(d, 'GM-77', SESSAO_QUALQUER), false, 'outra entrega sem diário não é publicada');
  });
});

test('teste-de-origem-s2-usa-raiz-segura: repo() só cria repositório em base que não é a do checkout nem está dentro dela', () => {
  const d = repo();
  assert.equal(raizSegura(dirname(d)), dirname(d), 'o caminho normal (mkdtemp) passa');
  const [co] = raizesDeCheckout();
  // bases do checkout: a raiz, um subdiretório existente (cwd do npm test) e um inexistente — nada é criado antes da recusa
  for (const base of [co, process.cwd(), join(co, '.claude-tmp', 'base-s2-inexistente')]) {
    assert.throws(() => repoEm(base), /do checkout/, `repoEm(${base})`);
    assert.equal(existsSync(join(base, 'r')), false, 'recusou antes de escrever');
  }
});

// ── GM-15 T4 (REQ-ENT-1 a, c; R2-1): o medir grava o encerramento ────────────────────────────────────────────────────────────────────────────
// `gh` de fixture (fixtures/gh-encerramento/gh) com os PRs #7, #8, #16, #17, #22 e #23 como no GitHub. MUTAÇÕES: M4a não remedir o `aberto` · M4b gravar em
// `_sem-id` · M4c `mergeado_em` do relógio local · M4d base `next` aceita na busca por título · M4e fato sem `base` encerrando (EQUIVALENTE no adaptador: `podeEncerrar`, trilha.ts:174, recusa a base ≠ da entrega; só a T3 a mata) · M4f `via` perdido ·
// X1 sem `casaTitulo` na busca por título · X3 sem `casaTitulo` no `pr view` · X5 título casa qualquer ocorrência do ID (não só o prefixo).
describe('medir: grava o encerramento da entrega (REQ-ENT-1 a, c)', () => {
  const GH_ENC = join(AQUI, 'fixtures', 'gh-encerramento');
  const SID2 = 'sessao-2';
  /** `gh` da fixture de encerramento; `extra` = PRs a mais (GH_PRS_EXTRA), `modo` = GH_MODO, `log` = GH_LOG. */
  const rodarEnc = ({ extra, modo, log } = {}) => (cmd, args, { cwd, timeoutMs }) => {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    if (cmd === 'gh') {
      env.PATH = `${GH_ENC}:${process.env.PATH}`;
      if (extra) env.GH_PRS_EXTRA = JSON.stringify(extra);
      if (modo) env.GH_MODO = modo;
      if (log) env.GH_LOG = log;
    }
    return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const medirEnc = (d, { sessao = SID, agora = '2026-11-16T09:00:00Z', ...gh } = {}) => medir(d, { rodar: rodarEnc(gh), agentes: entrada([], sessao), timeoutMs: 5000, agora: () => Date.parse(agora) });
  const encerradas = (d, id) => (existsSync(dirDe(d, id)) ? ler(dirDe(d, id)).filter((e) => e.tipo === 'entrega.encerrada') : []);
  const novoLog = () => join(mkdtempSync(join(tmpdir(), 'gh enc log ')), 'gh.log');
  /** Planta um `fato.medido` antigo no diário da entrega `id` (sessão `sessao`). */
  const planta = (d, id, chave, valor, ts, sessao = 'antiga') => {
    const r = append(dirDe(d, id), sessao, { ts, autor: 'painel', sessao, agente: 'painel', tipo: 'fato.medido', dados: { chave, fonte: chave === 'branch' ? 'git' : 'gh', valor } });
    assert.equal(r.ok, true);
  };

  /** Planta o `plano.json` da entrega apontando para uma spec cujo cabeçalho declara `Versão: <v>`. */
  const comVersaoAlvo = (d, id, versao) => {
    mkdirSync(join(d, 'docs', 'superpowers', 'specs'), { recursive: true });
    writeFileSync(join(d, 'docs', 'superpowers', 'specs', `${id}.md`), `# Spec ${id}\n\nIniciativa: x · PBI: ${id} · Versão: ${versao} · Data: 2026-11-15\n`);
    mkdirSync(dirDe(d, id), { recursive: true });
    writeFileSync(join(dirDe(d, id), 'plano.json'), JSON.stringify({ entrega: id, spec: `docs/superpowers/specs/${id}.md`, tasks: [] }));
  };
  const prVirada = (numero, titulo, head = 'chore/GM-15-virada') => ({ number: numero, state: 'MERGED', baseRefName: 'main', headRefName: head, title: titulo, mergedAt: '2026-11-16T08:00:00Z' });

  test('virada-alpha-nao-encerra (GM-15 T34, r.13p): PR estilo #24 (base main, título com 2.1.0-alpha.2) grava o fato pr e NÃO grava entrega.encerrada', () => {
    const d = repo('enabler/GM-15-fluidez');
    const r = medirEnc(d, { extra: [prVirada(24, 'enabler(GM-15): virada 2.1.0-alpha.2 (next ⇒ main)')] });
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.ok(fatos(d, 'GM-15', 'pr').some((e) => e.dados.valor.numero === 24 && e.dados.valor.base === 'main'), 'o fato pr do #24 é gravado');
    assert.equal(encerradas(d, 'GM-15').length, 0);
  });

  test('virada-alpha-nao-publica-em-nenhum-leitor (GM-15 T34, review r1 MAJOR-1): após o PR de virada alpha o medir, entregaPublicada e o loop.mjs real concordam: aberta', () => {
    const d = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d, 'GM-15', '2.1.1'); // plano.json presente (a regra antiga de publicada exige plano)
    const antes = entregaPublicada(d, 'GM-15', SESSAO_QUALQUER);
    assert.equal(medirEnc(d, { extra: [prVirada(24, 'enabler(GM-15): virada 2.1.0-alpha.2 (next ⇒ main)')] }).ok, true);
    assert.equal(encerradas(d, 'GM-15').length, 0, 'medir');
    assert.equal(entregaPublicada(d, 'GM-15', null), false, 'entregaPublicada (sem sessão)');
    assert.equal(entregaPublicada(d, 'GM-15', SESSAO_QUALQUER), false, `entregaPublicada (qualquer sessão; antes do PR: ${antes})`);
    // o loop.mjs real, com comandos que a publicada VEDA (iniciar e concluir; `anotar` não é vedado e não provaria nada): após a alpha não recusa por entrega_publicada
    const loop = (dir, ...args) => spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'loop.mjs'), ...args, '--sessao', 'S-r1'], { cwd: dir, encoding: 'utf8' });
    for (const args of [['iniciar', 'T1', 'implementador'], ['concluir', 'T1']]) assert.doesNotMatch(loop(d, ...args).stdout, /entrega_publicada/, `${args[0]}: o loop.mjs real não recusa como publicada após a alpha`);
    // controle: a virada final publica
    const d2 = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d2, 'GM-15', '2.1.1');
    assert.equal(medirEnc(d2, { extra: [prVirada(24, 'enabler(GM-15): virada 2.1.1 (next ⇒ main)')] }).ok, true);
    assert.equal(entregaPublicada(d2, 'GM-15', SESSAO_QUALQUER), true, 'a virada final publica');
    for (const args of [['iniciar', 'T1', 'implementador'], ['concluir', 'T1']]) assert.match(loop(d2, ...args).stdout, /entrega_publicada/, `${args[0]}: após a virada final o loop.mjs real recusa`);
    // controle: a spec declara a pré-versão como alvo e o PR é dela ⇒ publica (a guarda usa a versão-alvo como o medir)
    const d3 = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d3, 'GM-15', '2.1.0-alpha.2');
    assert.equal(medirEnc(d3, { extra: [prVirada(24, 'enabler(GM-15): virada 2.1.0-alpha.2 (next ⇒ main)')] }).ok, true);
    assert.equal(entregaPublicada(d3, 'GM-15', SESSAO_QUALQUER), true, 'alvo = a pré-versão');
  });

  test('guarda-usa-a-versao-alvo (GM-15 T34, MAJOR-1): fato pr de virada alpha SEM entrega.encerrada: publica só se a versão-alvo da spec é a própria pré-versão', () => {
    const fatoAlpha = (d) => planta(d, 'GM-15', 'pr', { numero: 24, estado: 'mergeado', branch: 'chore/GM-15-virada', base: 'main', via: 'titulo', pre_versao: '2.1.0-alpha.2' }, '2026-11-16T08:00:00.000Z');
    const d = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d, 'GM-15', '2.1.1');
    fatoAlpha(d);
    assert.equal(entregaPublicada(d, 'GM-15', SESSAO_QUALQUER), false, 'alvo 2.1.1: a alpha não publica');
    const d2 = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d2, 'GM-15', '2.1.0-alpha.2');
    fatoAlpha(d2);
    assert.equal(entregaPublicada(d2, 'GM-15', SESSAO_QUALQUER), true, 'alvo = a pré-versão: publica');
  });

  test('virada-final-encerra (GM-15 T34, r.13p): o mesmo PR com 2.1.0 (sem sufixo) encerra', () => {
    const d = repo('enabler/GM-15-fluidez');
    assert.equal(medirEnc(d, { extra: [prVirada(24, 'enabler(GM-15): virada 2.1.0 (next ⇒ main)')] }).ok, true);
    assert.deepEqual(encerradas(d, 'GM-15').map((e) => e.dados.pr), [24]);
  });

  test('virada-pre-versao-no-head-e-em-beta-rc (r.13p): o sufixo no head ou -beta/-rc também não encerra; título sem versão segue encerrando', () => {
    for (const [titulo, head] of [['enabler(GM-15): virada', 'release/GM-15-2.1.0-rc.1'], ['enabler(GM-15): virada 2.1.0-beta.3', 'chore/GM-15-virada']]) {
      const d = repo('enabler/GM-15-fluidez');
      assert.equal(medirEnc(d, { extra: [prVirada(24, titulo, head)] }).ok, true);
      assert.equal(encerradas(d, 'GM-15').length, 0, `${titulo} | ${head}`);
    }
    const d = repo('enabler/GM-15-fluidez');
    assert.equal(medirEnc(d, { extra: [prVirada(24, 'enabler(GM-15): virada (next ⇒ main)')] }).ok, true);
    assert.equal(encerradas(d, 'GM-15').length, 1, 'sem versão no título: a regra atual (encerra)');
  });

  test('virada-alvo-e-a-pre-versao (r.13p, ressalva da Sombra): a versão-alvo da spec é 2.1.0-alpha.2 e o PR é dela ⇒ encerra; PR de outra pré-versão não', () => {
    const d = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d, 'GM-15', '2.1.0-alpha.2');
    assert.equal(medirEnc(d, { extra: [prVirada(24, 'enabler(GM-15): virada 2.1.0-alpha.2 (next ⇒ main)')] }).ok, true);
    assert.deepEqual(encerradas(d, 'GM-15').map((e) => e.dados.pr), [24]);
    const d2 = repo('enabler/GM-15-fluidez');
    comVersaoAlvo(d2, 'GM-15', '2.1.0-alpha.2');
    assert.equal(medirEnc(d2, { extra: [prVirada(25, 'enabler(GM-15): virada 2.1.0-alpha.1 (next ⇒ main)')] }).ok, true);
    assert.equal(encerradas(d2, 'GM-15').length, 0);
  });

  test('medir-encerra-entrega-de-outra-branch: sessão em enabler/GM-15-…, a GM-14 (última conhecida) encerra pelo #22; o #17 (base next) não', () => {
    const d = repo('enabler/GM-15-fluidez');
    planta(d, 'GM-14', 'branch', { nome: 'enabler/GM-14-clareza' }, '2026-11-15T10:00:00.000Z');
    planta(d, 'GM-14', 'pr', { numero: 17, estado: 'aberto', branch: 'enabler/GM-14-clareza' }, '2026-11-15T10:01:00.000Z');
    // GM-15 T34 (r.13p): FIXTURE que declara a versão-alvo 2.1.0-alpha.1 para o #22 (alpha.1) encerrar. A spec REAL da GM-14 não tem linha `Versão:` (alvo null): no repo real o #22 NÃO encerra mais a GM-14.
    comVersaoAlvo(d, 'GM-14', '2.1.0-alpha.1');
    const r = medirEnc(d);
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    const enc = encerradas(d, 'GM-14');
    assert.equal(enc.length, 1);
    assert.deepEqual(enc[0].dados, { entrega: 'GM-14', pr: 22, via: 'titulo', mergeado_em: '2026-11-15T12:00:00Z' });
    assert.equal(enc[0].autor, 'painel');
    // o #17 foi remedido por número: mergeado na next, head da própria entrega, e NÃO encerrou
    const f17 = fatos(d, 'GM-14', 'pr').filter((e) => e.dados.valor.numero === 17).at(-1).dados.valor;
    assert.deepEqual(f17, { numero: 17, estado: 'mergeado', branch: 'enabler/GM-14-clareza', base: 'next', via: 'head', pre_versao: '2.1.0-alpha.1' });
    assert.equal(encerradas(d, 'GM-15').length, 0, 'a entrega da branch (GM-15) não encerra: o #23 é da next');
    // P9 (review T3 r1): o que a leitura entende do diário que o `medir` gravou
    const lido = lerEstrito(dirDe(d, 'GM-14'));
    assert.equal(lido.ok, true);
    const e = encerramentoDe(lido.eventos, 'GM-14');
    assert.equal(e.encerrada, true);
    assert.deepEqual(e.primeira, { pr: 22, via: 'titulo', mergeado_em: '2026-11-15T12:00:00Z' });
    assert.equal(entregaPublicada(d, 'GM-14', SESSAO_QUALQUER), true);
    assert.equal(entregaPublicada(d, 'GM-15', SESSAO_QUALQUER), false);
  });

  test('titulo-sem-id-no-head-encerra: PR estilo #16 (ID só no título, head next, base main) encerra pelo adaptador, via titulo, com o fato pr gravado', () => {
    const d = repo('enabler/GM-13-dois-zero');
    const r = medirEnc(d);
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    const enc = encerradas(d, 'GM-13');
    assert.equal(enc.length, 1);
    assert.deepEqual(enc[0].dados, { entrega: 'GM-13', pr: 16, via: 'titulo', mergeado_em: '2026-11-11T18:00:00Z' });
    assert.deepEqual(fatos(d, 'GM-13', 'pr').at(-1).dados.valor, { numero: 16, estado: 'mergeado', branch: 'next', base: 'main', via: 'titulo' });
  });

  test('encerra-por-head: PR mergeado na main com o head da entrega encerra com via head', () => {
    const d = repo('enabler/GM-20-x');
    const extra = [{ number: 31, state: 'MERGED', baseRefName: 'main', headRefName: 'enabler/GM-20-x', title: 'sem o id', mergedAt: '2026-11-16T08:00:00Z' }];
    assert.equal(medirEnc(d, { extra }).ok, true);
    assert.deepEqual(encerradas(d, 'GM-20').map((e) => e.dados), [{ entrega: 'GM-20', pr: 31, via: 'head', mergeado_em: '2026-11-16T08:00:00Z' }]);
  });

  test('base-next-nao-encerra: o #23 (head da GM-15, base next) e um PR só com o ID no título e base next nunca encerram', () => {
    const d = repo('hotfix/GM-15-alpha2');
    const extra = [{ number: 24, state: 'MERGED', baseRefName: 'next', headRefName: 'outra-coisa', title: 'GM-15 também no título', mergedAt: '2026-11-16T07:00:00Z' }];
    const r = medirEnc(d, { extra });
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.equal(encerradas(d, 'GM-15').length, 0);
    const f = fatos(d, 'GM-15', 'pr').map((e) => e.dados.valor);
    assert.deepEqual(f.map((v) => v.numero), [23], 'o #24 (base next) nem entra pela busca por título');
    assert.equal(f[0].base, 'next');
  });

  test('mergeado-legado-sem-base-nao-encerra: gh que não devolve base (o #7 do F3) grava o fato sem base nem via e não encerra', () => {
    const d = repo();
    const r = rodarMedir(d, 'ok'); // fixtures/gh: PR #7 MERGED só com number e state
    assert.equal(r.ok, true);
    const v = fatos(d, 'GM-14', 'pr').find((e) => e.dados.valor.numero === 7).dados.valor;
    assert.deepEqual(v, { numero: 7, estado: 'mergeado', branch: 'enabler/GM-14-clareza' });
    assert.equal(encerradas(d, 'GM-14').length, 0);
  });

  test('pr-velho-remedido: #8 aberto no diário e fora da lista do head ⇒ gh pr view 8 ⇒ MERGED com head de outra entrega ⇒ sai da entrega (sem via)', () => {
    const d = repo('enabler/GM-14-clareza');
    planta(d, 'GM-14', 'pr', { numero: 8, estado: 'aberto', branch: 'enabler/GM-14-clareza' }, '2026-11-14T10:00:00.000Z');
    const log = novoLog();
    const r = medirEnc(d, { log });
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.ok(readFileSync(log, 'utf8').split('\n').some((l) => /^pr view 8 /.test(l)), 'remediu o #8 por número');
    const v = fatos(d, 'GM-14', 'pr').filter((e) => e.dados.valor.numero === 8).at(-1).dados.valor;
    assert.deepEqual(v, { numero: 8, estado: 'mergeado', branch: 'enabler/GM-9-fundacao', base: 'next' });
    assert.equal(v.via, undefined, 'head de outra entrega, título sem o ID: sem via, `prs()` o descarta da GM-14');
  });

  test('encerrada-em-dir-entrega-nunca-sem-id: em main (sem ID) a GM-14 encerra no diário da GM-14; _sem-id nunca recebe entrega.encerrada', () => {
    const d = repo('main');
    planta(d, 'GM-14', 'branch', { nome: 'enabler/GM-14-clareza' }, '2026-11-15T10:00:00.000Z');
    comVersaoAlvo(d, 'GM-14', '2.1.0-alpha.1'); // fixture com versão-alvo declarada (a spec real da GM-14 não tem `Versão:`; GM-15 T34 r.13p)
    const r = medirEnc(d);
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.equal(encerradas(d, 'GM-14').length, 1);
    assert.equal(encerradas(d, '_sem-id').length, 0);
    assert.equal(readdirSync(join(d, '.harness', 'entregas')).filter((n) => !/^GM-/.test(n)).every((n) => encerradas(d, n).length === 0), true);
  });

  test('mergeado-em-vem-do-gh: o mergeado_em gravado é o mergedAt da fixture, nunca o relógio local', () => {
    const d = repo('enabler/GM-13-dois-zero');
    assert.equal(medirEnc(d, { agora: '2031-01-02T03:04:05Z' }).ok, true);
    assert.equal(encerradas(d, 'GM-13')[0].dados.mergeado_em, '2026-11-11T18:00:00Z');
    assert.notEqual(encerradas(d, 'GM-13')[0].dados.mergeado_em, '2031-01-02T03:04:05.000Z');
  });

  test('gh-falha-nada-gravado: rc 1, gh ausente e mergedAt inválido não gravam entrega.encerrada nem fato de gh; ok false e gh falhou', () => {
    const d = repo('enabler/GM-13-dois-zero');
    const estadoGh = (dd) => JSON.parse(readFileSync(join(dd, '.harness', 'painel-medir.json'), 'utf8'));
    const r = medirEnc(d, { modo: 'rc1' });
    assert.equal(r.ok, false);
    assert.match(r.falhas[0], /^gh_falhou: pr list rc 1$/);
    const d2 = repo('enabler/GM-13-dois-zero');
    const r2 = medir(d2, { rodar: rodarCom('ausente'), agentes: entrada(), timeoutMs: 300 });
    assert.equal(r2.ok, false);
    assert.equal(r2.falhas[0], 'gh_ausente');
    const d3 = repo('enabler/GM-20-x');
    const extra = [{ number: 33, state: 'MERGED', baseRefName: 'main', headRefName: 'enabler/GM-20-x', title: 'x', mergedAt: 'ontem' }];
    const r3 = medirEnc(d3, { extra });
    assert.equal(r3.ok, false);
    assert.match(r3.falhas[0], /^gh_json_invalido/);
    for (const [dd, id] of [[d, 'GM-13'], [d2, 'GM-13'], [d3, 'GM-20']]) {
      assert.equal(encerradas(dd, id).length, 0);
      assert.equal(fatos(dd, id, 'pr').length + fatos(dd, id, 'release').length, 0);
      assert.equal(estadoGh(dd)[id].gh, 'falhou');
    }
  });

  test('medir-duas-sessoes-duplicata-tolerada: a 2ª sessão não duplica; se duas gravaram, a leitura vale a 1ª e um medir seguinte segue ok sem 3ª', () => {
    const d = repo('enabler/GM-13-dois-zero');
    assert.equal(medirEnc(d, { sessao: SID }).ok, true);
    assert.equal(medirEnc(d, { sessao: SID2 }).ok, true);
    assert.equal(encerradas(d, 'GM-13').length, 1, 'a 2ª sessão leu o encerramento e não grava outro');
    // corrida real: a 2ª sessão leu o diário antes da 1ª gravar ⇒ 2 eventos; a projeção usa o 1º
    const dados = { entrega: 'GM-13', pr: 16, via: 'titulo', mergeado_em: '2026-11-11T18:00:00Z' };
    assert.equal(append(dirDe(d, 'GM-13'), 'sessao-3', { ts: '2026-11-16T09:00:01.000Z', autor: 'painel', sessao: 'sessao-3', agente: 'painel', tipo: 'entrega.encerrada', dados }).ok, true);
    assert.equal(encerradas(d, 'GM-13').length, 2);
    const e = encerramentoDe(lerEstrito(dirDe(d, 'GM-13')).eventos, 'GM-13');
    assert.equal(e.encerrada, true);
    assert.equal(e.primeira.pr, 16);
    assert.equal(medirEnc(d, { sessao: 'sessao-4' }).ok, true);
    assert.equal(encerradas(d, 'GM-13').length, 2, 'nenhum medir grava a 3ª');
  });

  test('reaberta-nao-reencerra-pelo-mesmo-pr / reaberta-reencerra-com-pr-novo: depois da reabertura, o #22 remedido não encerra; um PR novo mergeado depois encerra', () => {
    const d = repo('main');
    planta(d, 'GM-14', 'branch', { nome: 'enabler/GM-14-clareza' }, '2026-11-15T10:00:00.000Z');
    comVersaoAlvo(d, 'GM-14', '2.1.0-alpha.1'); // fixture com versão-alvo declarada (a spec real da GM-14 não tem `Versão:`; GM-15 T34 r.13p)
    assert.equal(medirEnc(d).ok, true);
    assert.equal(encerradas(d, 'GM-14').length, 1);
    assert.equal(append(dirDe(d, 'GM-14'), 'dono', { ts: '2026-11-15T13:00:00.000Z', autor: 'dono', sessao: 'dono', agente: 'dono', tipo: 'entrega.reaberta', dados: { entrega: 'GM-14', em: '2026-11-15T13:00:00.000Z' } }).ok, true);
    assert.equal(encerramentoDe(lerEstrito(dirDe(d, 'GM-14')).eventos, 'GM-14').encerrada, false, 'reaberta');
    assert.equal(medirEnc(d, { sessao: SID2 }).ok, true);
    assert.equal(encerradas(d, 'GM-14').length, 1, 'o mesmo #22 não encerra de novo');
    const extra = [{ number: 30, state: 'MERGED', baseRefName: 'main', headRefName: 'next', title: 'release(GM-14): 2.1.0', mergedAt: '2026-11-16T08:00:00Z' }];
    assert.equal(medirEnc(d, { sessao: 'sessao-3', extra }).ok, true);
    assert.equal(encerradas(d, 'GM-14').length, 2);
    const e = encerramentoDe(lerEstrito(dirDe(d, 'GM-14')).eventos, 'GM-14');
    assert.equal(e.encerrada, true);
    assert.equal(e.primeira.pr, 30);
  });

  test('titulo-fronteira-do-id: a GM-1 não é encerrada pelo #16 "release(GM-13)", nem na busca por título nem no pr view (X1, X3)', () => {
    const d = repo('enabler/GM-1-x');
    planta(d, 'GM-1', 'pr', { numero: 16, estado: 'aberto', branch: 'next' }, '2026-11-10T10:00:00.000Z'); // o diário o dá como aberto ⇒ pr view 16
    const log = novoLog();
    const r = medirEnc(d, { log });
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.ok(readFileSync(log, 'utf8').split('\n').some((l) => /^pr view 16 /.test(l)), 'remediu o #16 por número');
    assert.equal(encerradas(d, 'GM-1').length, 0);
    const v = fatos(d, 'GM-1', 'pr').filter((e) => e.dados.valor.numero === 16).at(-1)?.dados.valor;
    assert.equal(v?.via, undefined, 'sem via: o #16 não é da GM-1');
  });

  test('titulo-cita-outra-entrega: o #40 "release(GM-31): corrige regressão da GM-30" encerra a GM-31 e NÃO a GM-30 (X5)', () => {
    const d = repo('enabler/GM-31-x');
    planta(d, 'GM-30', 'branch', { nome: 'enabler/GM-30-y' }, '2026-11-15T10:00:00.000Z');
    const extra = [{ number: 40, state: 'MERGED', baseRefName: 'main', headRefName: 'next', title: 'release(GM-31): corrige regressão da GM-30', mergedAt: '2026-11-16T08:00:00Z' }];
    const r = medirEnc(d, { extra });
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.deepEqual(encerradas(d, 'GM-31').map((e) => e.dados.pr), [40]);
    assert.equal(encerradas(d, 'GM-30').length, 0);
  });

  test('titulo-ambiguo-sem-prefixo: dois IDs e nenhum prefixo não encerram ninguém; um único ID sem prefixo encerra', () => {
    const d = repo('enabler/GM-31-x');
    planta(d, 'GM-30', 'branch', { nome: 'enabler/GM-30-y' }, '2026-11-15T10:00:00.000Z');
    const extra = [{ number: 41, state: 'MERGED', baseRefName: 'main', headRefName: 'next', title: 'corrige a GM-30 e a GM-31', mergedAt: '2026-11-16T08:00:00Z' }];
    assert.equal(medirEnc(d, { extra }).ok, true);
    assert.equal(encerradas(d, 'GM-31').length + encerradas(d, 'GM-30').length, 0);
    const d2 = repo('enabler/GM-32-x');
    const extra2 = [{ number: 42, state: 'MERGED', baseRefName: 'main', headRefName: 'next', title: 'entra a GM-32 na main', mergedAt: '2026-11-16T08:00:00Z' }];
    assert.equal(medirEnc(d2, { extra: extra2 }).ok, true);
    assert.deepEqual(encerradas(d2, 'GM-32').map((e) => e.dados.pr), [42]);
  });
});

// ── GM-20 T6 (REQ-CRD-2): o medir encerra pela base configurada da entrega ───────────────────────────────────────────────────────────────────
// `gh` falso da fixture de encerramento + PRs a mais (GH_PRS_EXTRA). MUTAÇÕES: MC2-a literal `main` de volta em painel-medir.mjs (:374, :346, :348, :356) ·
// MC2-b aceitar qualquer base · MC2-c base lida do checkout em vez de `resolverBaseEntrega` (origin vence o HEAD).
describe('medir: encerra pela base configurada da entrega (REQ-CRD-2)', () => {
  const GH_ENC = join(AQUI, 'fixtures', 'gh-encerramento');
  const rodarB = (extra) => (cmd, args, { cwd, timeoutMs }) => {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    if (cmd === 'gh') { env.PATH = `${GH_ENC}:${process.env.PATH}`; env.GH_PRS_EXTRA = JSON.stringify(extra); }
    return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env, stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const medirB = (d, extra) => medir(d, { rodar: rodarB(extra), agentes: entrada([]), timeoutMs: 5000, agora: () => Date.parse('2026-11-24T09:00:00Z') });
  const encerradasB = (d, id) => (existsSync(dirDe(d, id)) ? ler(dirDe(d, id)).filter((e) => e.tipo === 'entrega.encerrada') : []);
  /** Commita no HEAD um `harness.config.json` que declara `entrega.base`. */
  const baseNoHead = (d, base) => { writeFileSync(join(d, 'harness.config.json'), `${JSON.stringify({ entrega: { base } })}\n`); git(d, 'add', 'harness.config.json'); git(d, 'commit', '-q', '-m', 'base'); };
  const pr = (numero, base, extra = {}) => ({ number: numero, state: 'MERGED', baseRefName: base, headRefName: 'enabler/GM-30-x', title: 'enabler(GM-30): x', mergedAt: '2026-11-23T08:00:00Z', ...extra });
  const BR = 'enabler/GM-30-x';

  test('medir-encerra-pela-base-da-entrega: base next mergeado encerra (via head), com o PR gravado', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    assert.equal(medirB(d, [pr(31, 'next')]).ok, true);
    assert.deepEqual(encerradasB(d, 'GM-30').map((e) => [e.dados.pr, e.dados.via]), [[31, 'head']]);
  });

  test('base next: PR mergeado em main (a virada) não encerra por ele, e o fato pr segue gravado com a base', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    assert.equal(medirB(d, [pr(32, 'main')]).ok, true);
    assert.equal(encerradasB(d, 'GM-30').length, 0);
    assert.ok(fatos(d, 'GM-30', 'pr').some((e) => e.dados.valor.numero === 32 && e.dados.valor.base === 'main'));
  });

  test('base next, via título (head de outra branch): busca `--base next` e encerra; PR de título em main não', () => {
    const d = repo('enabler/GM-30-outra'); baseNoHead(d, 'next');
    const log = join(mkdtempSync(join(tmpdir(), 'base log ')), 'gh.log');
    const gh = rodarB([pr(33, 'next', { headRefName: 'next', title: 'release(GM-30): x' }), pr(34, 'main', { headRefName: 'next', title: 'release(GM-30): y' })]);
    const r = medir(d, { rodar: (c, a, o) => { if (c === 'gh') appendFileSync(log, `${a.join(' ')}\n`); return gh(c, a, o); }, agentes: entrada([]), timeoutMs: 5000, agora: () => Date.parse('2026-11-24T09:00:00Z') });
    assert.equal(r.ok, true, JSON.stringify(r.falhas));
    assert.deepEqual(encerradasB(d, 'GM-30').map((e) => e.dados.pr), [33]);
    const busca = readFileSync(log, 'utf8').split('\n').find((l) => l.includes('--search'));
    assert.match(busca, /--base next /);
  });

  test('sem config de base: a base é main, como hoje (main encerra, next não)', () => {
    const d = repo(BR);
    assert.equal(medirB(d, [pr(35, 'main')]).ok, true);
    assert.deepEqual(encerradasB(d, 'GM-30').map((e) => e.dados.pr), [35]);
    const d2 = repo(BR);
    assert.equal(medirB(d2, [pr(36, 'next')]).ok, true);
    assert.equal(encerradasB(d2, 'GM-30').length, 0);
  });

  test('PR mergeado na base sem mergedAt é descartado (gh_json_invalido, nada gravado) na base configurada; em outra base não falha', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    const r = medirB(d, [pr(37, 'next', { mergedAt: null })]);
    assert.ok(r.falhas.some((f) => f.startsWith('gh_json_invalido')), JSON.stringify(r.falhas));
    assert.equal(encerradasB(d, 'GM-30').length, 0);
    assert.equal(fatos(d, 'GM-30', 'pr').length, 0);
    const d2 = repo(BR); baseNoHead(d2, 'next');
    const r2 = medirB(d2, [pr(38, 'main', { mergedAt: null })]);
    assert.equal(r2.falhas.some((f) => f.startsWith('gh_json_invalido')), false, 'a regra do `mergedAt` é da base da entrega, não de main');
  });

  test('remedição por número (o diário dá o PR como aberto; a busca por título não o acha): base next casa por título e encerra; base main não', () => {
    const semBusca = (extra) => { const gh = rodarB(extra); return (c, a, o) => (c === 'gh' && a.includes('--search') ? { status: 0, stdout: '[]', stderr: '' } : gh(c, a, o)); };
    const aberto = (d) => { const r = append(dirDe(d, 'GM-30'), 'antiga', { ts: '2026-11-22T00:00:00.000Z', autor: 'painel', sessao: 'antiga', agente: 'painel', tipo: 'fato.medido', dados: { chave: 'pr', fonte: 'gh', valor: { numero: 41, estado: 'aberto', branch: 'next' } } }); assert.equal(r.ok, true); };
    const viaNumero = (base) => ({ number: 41, state: 'MERGED', baseRefName: base, headRefName: 'next', title: 'release(GM-30): z', mergedAt: '2026-11-23T08:00:00Z' });
    const rodaEm = (d, extra) => medir(d, { rodar: semBusca(extra), agentes: entrada([]), timeoutMs: 5000, agora: () => Date.parse('2026-11-24T09:00:00Z') });
    const d = repo('enabler/GM-30-outra'); baseNoHead(d, 'next'); aberto(d);
    assert.equal(rodaEm(d, [viaNumero('next')]).ok, true);
    assert.deepEqual(encerradasB(d, 'GM-30').map((e) => [e.dados.pr, e.dados.via]), [[41, 'titulo']]);
    const d2 = repo('enabler/GM-30-outra'); baseNoHead(d2, 'next'); aberto(d2);
    assert.equal(rodaEm(d2, [viaNumero('main')]).ok, true);
    assert.equal(encerradasB(d2, 'GM-30').length, 0);
  });

  test('a exceção de virada de pré-versão segue valendo com a base configurada (MC2-f: tirar ehViradaDePreVersao da coleta ⇒ cai)', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    assert.equal(medirB(d, [pr(43, 'next', { title: 'release(GM-30): 2.3.0-alpha.1' })]).ok, true);
    assert.equal(encerradasB(d, 'GM-30').length, 0, 'PR de pré-versão na base next não encerra');
    assert.ok(fatos(d, 'GM-30', 'pr').some((e) => e.dados.valor.numero === 43 && e.dados.valor.pre_versao === '2.3.0-alpha.1'));
    const d2 = repo(BR); baseNoHead(d2, 'next');
    assert.equal(medirB(d2, [pr(44, 'next')]).ok, true);
    assert.deepEqual(encerradasB(d2, 'GM-30').map((e) => e.dados.pr), [44], 'controle: o mesmo PR sem pré-versão encerra');
  });

  test('o aviso da base (origin sem entrega.base, HEAD declara) sai em `avisos`, sem derrubar ok; sem aviso, o campo não existe', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    const r = medirB(d, [pr(42, 'next')]);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.avisos) && r.avisos.some((a) => a.includes('origin/HEAD sem entrega.base')), JSON.stringify(r.avisos));
    assert.equal(medirB(repo(BR), []).avisos, undefined);
  });

  test('base divergente origin x HEAD segue resolverBaseEntrega: origin (next) vence o HEAD (main)', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    const bare = join(raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'base origin ')))), 'o.git');
    git(d, 'init', '-q', '--bare', '-b', 'main', bare);
    git(d, 'remote', 'add', 'origin', bare);
    git(d, 'push', '-q', 'origin', 'HEAD:main'); // a origin declara next
    baseNoHead(d, 'main'); // o HEAD local declara main (não publicado)
    git(d, 'fetch', '-q', 'origin');
    git(d, 'remote', 'set-head', 'origin', 'main');
    assert.equal(medirB(d, [pr(39, 'main'), pr(40, 'next', { mergedAt: '2026-11-23T09:00:00Z' })]).ok, true);
    assert.deepEqual(encerradasB(d, 'GM-30').map((e) => e.dados.pr), [40]);
  });
});

// ── GM-20 T6 (D-G47): o medir grava o sha da encerrada e o PR em main que o contém ──────────────────────────────────────────────────────────
// MUTAÇÕES: MC2-h `sha` fora da encerrada ⇒ cai · MC2-i `contem` fora do fato ⇒ cai · MC2-j busca da virada sem o sha da encerrada (qualquer PR em main) ⇒ cai o caso "outro PR".
describe('medir: virada da base para main (D-G47, REQ-CRD-2)', () => {
  const GH_ENC = join(AQUI, 'fixtures', 'gh-encerramento');
  const SHA = 'a4fc50d7'.padEnd(40, '0');
  const BR = 'enabler/GM-30-x';
  const pr = (numero, base, extra = {}) => ({ number: numero, state: 'MERGED', baseRefName: base, headRefName: 'enabler/GM-30-x', title: 'enabler(GM-30): x', mergedAt: '2026-11-23T08:00:00Z', ...extra });
  /** `gh` que responde `--search <sha>` com GH_VIRADA (o fixture só busca por título) e delega o resto ao gh falso da encerrada. */
  const dirGh = () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh virada '));
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2); const i = a.indexOf('--search');
if (i >= 0 && /^[0-9a-f]{40}$/.test(a[i + 1] ?? '')) { require('node:fs').appendFileSync(process.env.GH_LOG_VIRADA, a.join(' ') + '\\n'); process.stdout.write(process.env.GH_VIRADA ?? '[]'); process.exit(0); }
const r = require('node:child_process').spawnSync(process.env.GH_REAL, a, { stdio: 'inherit', env: process.env }); process.exit(r.status ?? 1);
`, { mode: 0o755 });
    return dir;
  };
  const ambiente = (extra, virada) => {
    const log = join(mkdtempSync(join(tmpdir(), 'gh log ')), 'v.log');
    return { PATH: `${dirGh()}:${process.env.PATH}`, GH_REAL: join(GH_ENC, 'gh'), GH_PRS_EXTRA: JSON.stringify(extra), GH_VIRADA: JSON.stringify(virada), GH_LOG_VIRADA: log, log };
  };
  const baseNoHead = (d, base) => { writeFileSync(join(d, 'harness.config.json'), `${JSON.stringify({ entrega: { base } })}\n`); git(d, 'add', 'harness.config.json'); git(d, 'commit', '-q', '-m', 'base'); };
  const rodar = (amb) => (cmd, args, { cwd, timeoutMs }) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...amb }, stdio: ['ignore', 'pipe', 'pipe'] });
  const medirV = (d, amb) => medir(d, { rodar: rodar(amb), agentes: entrada([]), timeoutMs: 5000, agora: () => Date.parse('2026-11-24T09:00:00Z') });
  const dirG = (d) => join(d, '.harness', 'entregas', 'GM-30');
  const encerradas = (d) => ler(dirG(d)).filter((e) => e.tipo === 'entrega.encerrada');
  const prsMedidos = (d) => ler(dirG(d)).filter((e) => e.tipo === 'fato.medido' && e.dados.chave === 'pr').map((e) => e.dados.valor);
  const PLANO = { entrega: 'GM-30', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }] };
  const CFG = { liberaTeto: false, julgaEmendas: false, autonomiaEntrega: false, base: 'next' };
  const lote = (d) => loteDoDono(PLANO, ler(dirG(d)), CFG).map((i) => i.motivo);
  const VIRADA_MOTIVO = 'no fim da entrega: levar next para main';

  test('a encerrada grava o sha do commit de merge quando o gh o dá; sem `mergeCommit`, sem o campo', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    assert.equal(medirV(d, ambiente([pr(31, 'next', { mergeCommit: { oid: SHA } })], [])).ok, true);
    assert.deepEqual(encerradas(d).map((e) => e.dados.sha), [SHA]);
    const d2 = repo(BR); baseNoHead(d2, 'next');
    assert.equal(medirV(d2, ambiente([pr(31, 'next')], [])).ok, true);
    assert.equal(encerradas(d2).length, 1);
    assert.equal('sha' in encerradas(d2)[0].dados, false);
    const d3 = repo(BR); baseNoHead(d3, 'next');
    assert.equal(medirV(d3, ambiente([pr(31, 'next', { mergeCommit: { oid: 'xyz' } })], [])).ok, true, 'oid ilegível não falha a medição');
    assert.equal('sha' in encerradas(d3)[0].dados, false);
  });

  test('encerrada com sha, base next: o medir busca o PR em main pelo sha e grava o fato pr com `contem`; o lembrete da virada sai SÓ então', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    const amb1 = ambiente([pr(31, 'next', { mergeCommit: { oid: SHA } })], []);
    assert.equal(medirV(d, amb1).ok, true);
    assert.deepEqual(lote(d), [VIRADA_MOTIVO], 'encerrada e ainda sem a virada');
    // 2ª medição: a busca por sha acha o PR da virada
    const virada = [pr(50, 'main', { headRefName: 'next', title: 'release: 2.3.0 (next → main)', mergedAt: '2026-11-24T08:00:00Z' })];
    const amb2 = ambiente([pr(31, 'next', { mergeCommit: { oid: SHA } })], virada);
    assert.equal(medirV(d, amb2).ok, true);
    assert.match(readFileSync(amb2.log, 'utf8'), new RegExp(`--base main --state merged --search ${SHA}`));
    assert.deepEqual(prsMedidos(d).filter((v) => v.numero === 50).map((v) => [v.base, v.estado, v.contem]), [['main', 'mergeado', SHA]]);
    assert.deepEqual(lote(d), []);
  });

  test('PR em main que a busca não devolve (não contém o sha) não tira o lembrete, mesmo medido pelo head (MC2-j)', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    assert.equal(medirV(d, ambiente([pr(31, 'next', { mergeCommit: { oid: SHA } })], [])).ok, true);
    const outro = pr(51, 'main'); // achado pelo head da entrega, sem relação de commit com a encerrada
    assert.equal(medirV(d, ambiente([pr(31, 'next', { mergeCommit: { oid: SHA } }), outro], [])).ok, true);
    assert.ok(prsMedidos(d).some((v) => v.numero === 51 && v.base === 'main'), 'o PR de título está medido');
    assert.equal(prsMedidos(d).some((v) => 'contem' in v), false);
    assert.deepEqual(lote(d), [VIRADA_MOTIVO]);
  });

  test('base main (ou sem sha na encerrada): nenhuma busca por sha', () => {
    const d = repo(BR);
    const amb = ambiente([pr(35, 'main', { mergeCommit: { oid: SHA } })], []);
    assert.equal(medirV(d, amb).ok, true);
    assert.equal(medirV(d, amb).ok, true);
    assert.equal(existsSync(amb.log), false, 'base main não busca a virada');
    const d2 = repo(BR); baseNoHead(d2, 'next');
    const amb2 = ambiente([pr(31, 'next')], []);
    assert.equal(medirV(d2, amb2).ok, true);
    assert.equal(medirV(d2, amb2).ok, true);
    assert.equal(existsSync(amb2.log), false, 'encerrada sem sha não busca');
  });

  test('P9 pelo painel.mjs real: medir x2 grava a encerrada com sha e o fato da virada, e o `loteDoDono` lê o diário gravado', () => {
    const d = repo(BR); baseNoHead(d, 'next');
    const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
    const cli = (amb) => spawnSync(process.execPath, [PAINEL, 'medir', '--agentes'], { cwd: d, input: JSON.stringify(entrada([])), encoding: 'utf8', env: { ...process.env, ...amb } });
    const enc = pr(31, 'next', { mergeCommit: { oid: SHA } });
    assert.equal(cli(ambiente([enc], [])).status, 0);
    assert.deepEqual(encerradas(d).map((e) => e.dados.sha), [SHA]);
    assert.deepEqual(lote(d), [VIRADA_MOTIVO]);
    assert.equal(cli(ambiente([enc], [pr(50, 'main', { headRefName: 'next', title: 'release', mergedAt: '2026-11-24T08:00:00Z' })])).status, 0);
    assert.equal(lerEstrito(dirG(d)).ok, true, 'o diário gravado passa na leitura estrita (formas)');
    assert.deepEqual(lote(d), []);
  });
});

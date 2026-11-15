/**
 * Fonte da config da guarda (D2) — spawn de dist/guarda.js em repo temporário com `origin` fake.
 *
 * A config da guarda vem de `refs/remotes/origin/HEAD:harness.config.json` (nome completo, Q4),
 * nunca da árvore local. Todos os cenários são do orquestrador (sem `agent_id`).
 * "Sem decisão" = processo sai 0 e não há `permissionDecision` na saída.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  ler a config da árvore local ⇒ `permitidos-forjado` falha
 *  M2  ler `branchPadrao` da árvore local ⇒ `branchpadrao-local-ignorado` falha
 *  M3  devolver `allow` em qualquer cenário ⇒ `saida-nunca-allow` falha
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARDA = join(GATES, 'dist', 'guarda.js');

const AMBIENTES = {
  teste: { hosts: ['127.0.0.1', 'localhost'], bancos: ['127.0.0.1'] },
  homolog: { hosts: ['staging.exemplo.com'], projetos: ['ref-homolog'] },
  prod: { hosts: ['api.exemplo.com'], projetos: ['ref-prod'], bancos: ['db.prod.exemplo.com'] },
};

const config = ({ permitidos = [], branchPadrao = 'main' } = {}) => ({
  guarda: { ambientes: AMBIENTES, producao: { permitidos } },
  versionamento: { branchPadrao },
});

const ENV_GIT = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@exemplo.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@exemplo.com',
};

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV_GIT, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/**
 * origem: config em origin/HEAD (null = arquivo ausente na ref); local: config na árvore (null = ausente);
 * remoto: existe `origin`; setHead: `refs/remotes/origin/HEAD` resolvível.
 */
function montar({ origem = null, local = null, remoto = true, setHead = true, branch = null }) {
  const repo = mkdtempSync(join(tmpdir(), 'gm-fonte-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  if (origem) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(origem));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  if (remoto) {
    const bare = mkdtempSync(join(tmpdir(), 'gm-fonte-origin-'));
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', 'origin', 'main');
    if (setHead) git(repo, 'remote', 'set-head', 'origin', 'main');
  }
  if (branch) git(repo, 'checkout', '-q', '-b', branch);
  if (local) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(local));
  return repo;
}

function rodarGuarda(repo, command) {
  const entrada = {
    tool_name: 'Bash',
    tool_input: { command },
    permission_mode: 'default',
    session_id: `fonte-${Math.random().toString(36).slice(2)}`,
    cwd: repo,
  };
  const r = spawnSync(process.execPath, [GUARDA], {
    cwd: repo,
    input: JSON.stringify(entrada),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: join(GATES, '..') },
  });
  assert.equal(r.status, 0, `guarda saiu ${r.status}: ${r.stderr}`);
  const saida = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
  return { decisao: saida.hookSpecificOutput?.permissionDecision, systemMessage: saida.systemMessage ?? '', saida };
}

const CENARIOS = {
  'permitidos-forjado': () =>
    rodarGuarda(montar({ origem: config(), local: config({ permitidos: ['*'] }) }), 'vercel --prod'),
  'permitidos-origin-vale': () =>
    rodarGuarda(montar({ origem: config({ permitidos: ['vercel --prod'] }) }), 'vercel --prod'),
  'branchpadrao-local-ignorado': () =>
    rodarGuarda(montar({ origem: config({ branchPadrao: 'main' }), local: config({ branchPadrao: 'x' }) }), 'git push'),
  'branchpadrao-trunk': () =>
    rodarGuarda(montar({ origem: config({ branchPadrao: 'trunk' }), branch: 'trunk' }), 'git push'),
  'origin-head-ausente': () =>
    rodarGuarda(montar({ local: config({ permitidos: ['*'] }), setHead: false }), 'vercel --prod'),
  'sem-remoto-sem-config': () => rodarGuarda(montar({ remoto: false }), 'vercel --prod'),
};

describe('fonte da config (D2)', () => {
  test('permitidos-forjado: origin sem permitidos, árvore local com ["*"] ⇒ ask', () => {
    assert.equal(CENARIOS['permitidos-forjado']().decisao, 'ask');
  });

  test('permitidos-origin-vale: permitidos em origin/HEAD casa ⇒ sem decisão', () => {
    assert.equal(CENARIOS['permitidos-origin-vale']().decisao, undefined);
  });

  test('branchpadrao-local-ignorado: branchPadrao local "x", origin "main"; git push em main ⇒ ask', () => {
    assert.equal(CENARIOS['branchpadrao-local-ignorado']().decisao, 'ask');
  });

  test('branchpadrao-trunk: origin com branchPadrao "trunk"; git push em trunk ⇒ ask (nada de "main" fixo)', () => {
    assert.equal(CENARIOS['branchpadrao-trunk']().decisao, 'ask');
  });

  test('origin-head-ausente: sem origin/HEAD, local com permitidos ["*"] ⇒ ask e systemMessage cita "local"', () => {
    const r = CENARIOS['origin-head-ausente']();
    assert.equal(r.decisao, 'ask');
    assert.match(r.systemMessage, /local/);
  });

  test('sem-remoto-sem-config: sem remoto nem config ⇒ sem decisão', () => {
    assert.equal(CENARIOS['sem-remoto-sem-config']().decisao, undefined);
  });

  test('saida-nunca-allow: nenhum dos seis cenários devolve allow', () => {
    for (const [nome, rodar] of Object.entries(CENARIOS)) {
      assert.notEqual(rodar().decisao, 'allow', nome);
    }
  });
});

// ------------------------------------------------------------------------------------- T48 (emenda 43, FIEL-1 b/c): entrega publicada não recebe guarda.*

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';

/** Repo com onboarding (config em origin/HEAD), na branch do ID `GM-10`, com `plano.json` e o diário da entrega (2º fato + PRs dados). */
function entrega({ prs = [], plano = true, branch = 'enabler/GM-10-loop' } = {}) {
  const repo = montar({ origem: config(), branch });
  const dir = join(repo, '.harness', 'entregas', 'GM-10');
  mkdirSync(dir, { recursive: true });
  if (plano) writeFileSync(join(dir, 'plano.json'), JSON.stringify({ entrega: 'GM-10', tasks: [] }));
  const linhas = prs.map(([numero, estado], i) => JSON.stringify({
    seq: i + 1, ts: `2026-11-13T10:00:0${i}.000Z`, autor: 't', sessao: 'semente', agente: 'orquestrador', tipo: 'fato.medido', hash_anterior: null,
    dados: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch } },
  }));
  if (linhas.length > 0) writeFileSync(join(dir, 'events.semente.jsonl'), `${linhas.join('\n')}\n`);
  return repo;
}
const tiposEm = (repo, id) => {
  const dir = join(repo, '.harness', 'entregas', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^events\..+\.jsonl$/.test(n) && !n.includes('semente'))
    .flatMap((n) => readFileSync(join(dir, n), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).tipo));
};

describe('entrega publicada não recebe guarda.* (T48)', () => {
  test('publicada-nao-recebe-guarda.ask: ask em produção grava em _sem-id; a entrega publicada fica intacta', () => {
    const repo = entrega({ prs: [[7, 'mergeado']] });
    assert.equal(rodarGuarda(repo, 'vercel --prod').decisao, 'ask');
    assert.deepEqual(tiposEm(repo, 'GM-10'), []);
    assert.deepEqual(tiposEm(repo, '_sem-id'), ['guarda.ask']);
  });

  test('publicada-nao-recebe-operacao.destrutiva: rm -rf grava em _sem-id', () => {
    const repo = entrega({ prs: [[7, 'mergeado']] });
    rodarGuarda(repo, 'rm -rf .next dist');
    assert.deepEqual(tiposEm(repo, 'GM-10'), []);
    assert.deepEqual(tiposEm(repo, '_sem-id'), ['operacao.destrutiva']);
  });

  test('identificada-continua-gravando (vizinho): PR mergeado e outro aberto ⇒ o guarda.ask entra na entrega', () => {
    const repo = entrega({ prs: [[7, 'mergeado'], [8, 'aberto']] });
    rodarGuarda(repo, 'vercel --prod');
    assert.deepEqual(tiposEm(repo, 'GM-10'), ['guarda.ask']);
    assert.deepEqual(tiposEm(repo, '_sem-id'), []);
  });

  test('identificada-continua-gravando (vizinho): sem nenhum PR medido ⇒ entrega em curso recebe', () => {
    const repo = entrega({ prs: [] });
    rodarGuarda(repo, 'vercel --prod');
    assert.deepEqual(tiposEm(repo, 'GM-10'), ['guarda.ask']);
  });

  test('vizinho: PR mergeado SEM 2º fato (sem plano.json) não é publicada; o diário da branch segue recebendo (âncora da pergunta b)', () => {
    const repo = entrega({ prs: [[7, 'mergeado']], plano: false });
    rodarGuarda(repo, 'vercel --prod');
    assert.deepEqual(tiposEm(repo, 'GM-10'), ['guarda.ask']);
  });

  test('combinação das guardas: publicada continua pedindo (ask) em produção; o destino do registro não muda a decisão', () => {
    const publicada = rodarGuarda(entrega({ prs: [[7, 'mergeado']] }), 'vercel --prod');
    const curso = rodarGuarda(entrega({ prs: [] }), 'vercel --prod');
    assert.equal(publicada.decisao, 'ask');
    assert.deepEqual(publicada.saida, curso.saida);
  });
});

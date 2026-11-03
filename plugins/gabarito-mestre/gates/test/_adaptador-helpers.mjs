/**
 * Adaptador do hook (T4): stdin → decisão → stdout, sempre exit 0.
 *
 * O núcleo (classificar/decidir/diário) tem teste próprio; aqui só o que o adaptador decide: payload ruim,
 * raiz do repo, fonte da config, diário que falha, mensagem uma vez por sessão, spawn só quando preciso.
 *
 * MUTAÇÕES PRESCRITAS:
 *  A1  devolver `allow` no adaptador ⇒ `saida-nunca-allow` falha
 *  A2  gravar o comando cru em `dados`/diário ⇒ `evento-sem-comando-cru` falha
 *  A3  lançar em JSON inválido ⇒ `guarda-payload-json-invalido` falha
 *  A4  sempre montar o contexto ⇒ `sem-contexto-sem-spawn` falha
 *  A5  sem marcador por sessão ⇒ `fonte-mensagem-uma-vez` falha
 *  A6  esperar o append antes de escrever a decisão / não checar o diário antes ⇒ `diario-indisponivel-guarda-segue` falha
 *  A7  exceção (Q21) voltar ao fallback por regex em vez de pedir em toda chamada ⇒ `excecao-antes-da-decisao-orq` falha com `vercel --prod`
 *  A8  `jaEscreveu = true` antes do `writeSync` ⇒ `excecao-na-serializacao-ainda-pede` falha
 *  A9  `raizSessao` = raiz do cwd (Q14) ⇒ `config-da-raiz-da-sessao-nao-do-cwd` falha
 *  A10 `systemMessage` só quando `guarda.config !== null` (F3) ⇒ `fonte-divergente-origin-sem-guarda` falha
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Helpers compartilhados pelos arquivos guarda-adaptador*.test.mjs (movidos sem reescrever).
export const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GUARDA = join(GATES, 'dist', 'guarda.js');

export const AMBIENTES = {
  teste: { hosts: ['127.0.0.1', 'localhost'], bancos: ['127.0.0.1'] },
  homolog: { hosts: ['staging.exemplo.com'] },
  prod: { hosts: ['api.exemplo.com'], bancos: ['db.prod.exemplo.com'] },
};
export const CONFIG = { guarda: { ambientes: AMBIENTES, producao: { permitidos: [] } }, versionamento: { branchPadrao: 'main' } };

export const ENV_GIT = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@exemplo.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@exemplo.com',
};

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV_GIT, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** Repo com `origin` fake e config em origin/HEAD (ou sem remoto). */
export function montar({ origem = CONFIG, remoto = true, branch = 'feat/GM-9-x' } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'gm-adapt-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  if (origem) writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(origem));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  if (remoto) {
    const bare = mkdtempSync(join(tmpdir(), 'gm-adapt-origin-'));
    git(bare, 'init', '-q', '--bare', '-b', 'main');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
  }
  if (branch) git(repo, 'checkout', '-q', '-b', branch);
  return repo;
}

let n = 0;
export const sessaoNova = () => `adapt-${process.pid}-${Date.now()}-${n++}`;

export function rodarBruto(stdin, { cwd, env = {}, repo = null, bin = GUARDA } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'gm-adapt-tmp-'));
  const r = spawnSync(process.execPath, [bin], {
    cwd: cwd ?? repo ?? tmp,
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(repo ? { CLAUDE_PROJECT_DIR: repo } : {}), CLAUDE_PLUGIN_ROOT: join(GATES, '..'), TMPDIR: tmp, ...env },
  });
  const saida = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
  return {
    status: r.status,
    stderr: r.stderr,
    stdout: r.stdout,
    decisao: saida.hookSpecificOutput?.permissionDecision,
    motivo: saida.hookSpecificOutput?.permissionDecisionReason ?? '',
    systemMessage: saida.systemMessage ?? '',
    tmp,
  };
}

export function rodar(repo, tool_name, tool_input, extra = {}, opcoes = {}) {
  const entrada = { tool_name, tool_input, permission_mode: 'default', session_id: sessaoNova(), cwd: repo, ...extra };
  return rodarBruto(JSON.stringify(entrada), { repo, ...opcoes });
}

export const eventosDe = (repo) => {
  const dir = join(repo, '.harness', 'entregas');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: false })
    .filter((f) => /events\..+\.jsonl$/.test(f))
    .map((f) => ({ arquivo: join(dir, f), texto: readFileSync(join(dir, f), 'utf8') }));
};


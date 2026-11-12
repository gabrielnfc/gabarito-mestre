/**
 * Corpus da guarda, ponta a ponta: 10 casos do corpus por `gates/dist/guarda.js` real (processo novo, stdin com o
 * JSON que o Claude Code envia, repo temporário com `origin`), sem importar `decidir`. O corpus completo (220) já
 * roda em-processo em `gates/test/corpus-guarda.test.ts`; aqui prova-se que o adaptador não muda o veredito.
 *
 * MUTAÇÕES PRESCRITAS:
 *  E1  adaptador devolver `allow` ⇒ `orq-prod-escrita` falha
 *  E2  adaptador ignorar `agent_id` ⇒ `subagent-prod-escrita` falha
 *  E3  adaptador não passar a config de origin/HEAD ⇒ `url-credencial-reduzida` e `orq-prod-escrita` falham
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN, here } from './_comum.mjs';

const GUARDA = join(PLUGIN, 'gates', 'dist', 'guarda.js');
const CORPUS = join(here, 'corpus');

const CASOS = [
  'teste-sem-decisao',
  'destrutivo-rm-local',
  'destrutivo-homolog',
  'url-credencial-reduzida',
  'orq-prod-escrita',
  'subagent-prod-escrita',
  'segredo-env-sub',
  'segredo-env-orq',
  'integridade-config-sub-bash',
  'integridade-remote-set-head-sub',
];

const todos = ['guarda-bash', 'guarda-caminho', 'guarda-integridade', 'guarda-mcp']
  .flatMap((a) => readFileSync(join(CORPUS, `${a}.jsonl`), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));

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
}

function repoDoCorpus() {
  const { ambientes, permitidos } = JSON.parse(readFileSync(join(CORPUS, '_ambientes.json'), 'utf8'));
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'gm-e2e-repo-')));
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'harness.config.json'), JSON.stringify({ guarda: { ambientes, producao: { permitidos } }, versionamento: { branchPadrao: 'main' } }));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicio');
  const bare = mkdtempSync(join(tmpdir(), 'gm-e2e-origin-'));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'feat/GM-1-x');
  return repo;
}

function eventos(repo) {
  const dir = join(repo, '.harness', 'entregas');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((f) => /events\..+\.jsonl$/.test(f))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

describe('corpus ponta a ponta (dist/guarda.js real)', () => {
  assert.equal(CASOS.length, 10);
  for (const nome of CASOS) {
    test(nome, () => {
      const c = todos.find((x) => x.nome === nome);
      assert.ok(c, `caso ${nome} sumiu do corpus`);
      const repo = repoDoCorpus();
      const tmp = mkdtempSync(join(tmpdir(), 'gm-e2e-tmp-'));
      const payload = {
        session_id: `e2e-${nome}`,
        transcript_path: '/dev/null',
        cwd: repo,
        permission_mode: c.modo ?? 'default',
        hook_event_name: 'PreToolUse',
        tool_name: c.tool,
        tool_input: c.input,
        tool_use_id: 'toolu_e2e',
        ...(c.agente === 'sub' ? { agent_id: 'agent-e2e', agent_type: 'general-purpose' } : {}),
      };
      const r = spawnSync(process.execPath, [GUARDA], {
        cwd: repo,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: PLUGIN, TMPDIR: tmp, HOME: mkdtempSync(join(tmp, 'home-')) },
      });
      assert.equal(r.status, 0, r.stderr);
      const saida = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
      const decisao = saida.hookSpecificOutput?.permissionDecision;
      const faixa = c.esperado.faixa;
      assert.equal(decisao, faixa === 'ask' || faixa === 'deny' ? faixa : undefined, `${nome}: ${r.stdout}`);
      assert.notEqual(decisao, 'allow');
      if (c.esperado.motivoContem) assert.match(saida.hookSpecificOutput.permissionDecisionReason, new RegExp(c.esperado.motivoContem));
      if (faixa === 'mostrar') assert.match(saida.systemMessage ?? '', /\S/);
      if (faixa === 'silencio' || faixa === 'log') assert.equal(saida.systemMessage, undefined);

      const evs = eventos(repo);
      if (faixa === 'silencio') assert.equal(evs.length, 0, 'silêncio não grava');
      else assert.equal(evs.at(-1)?.tipo, c.esperado.evento ?? (faixa === 'mostrar' ? 'producao.acesso' : `guarda.${faixa}`), `evento de ${nome}`);
      // o diário nunca guarda o comando nem a credencial
      const bruto = JSON.stringify(evs);
      assert.doesNotMatch(bruto, /s3nh4/);
      const comando = typeof c.input.command === 'string' ? c.input.command : null;
      if (comando && comando.includes(' ')) assert.equal(bruto.includes(comando), false, 'comando cru no diário');
    });
  }
});

/**
 * Testes do GATE §0.2 — harness-doctor.
 *
 * O teste central é `repo que MENTE o nível reprova`: é ele que fecha a contradição
 * do harness. Sem esse comportamento, o §0.2 é só mais uma tabela que ninguém confere.
 *
 * MUTAÇÕES PRESCRITAS:
 *  M1  calcular o nível como "maioria das checagens" em vez de "todas"
 *  M2  ignorar o TTL do atestado (atestado vencido passa a valer para sempre)
 *  M3  não reprovar quando declarado > alcançado
 *  M4  `>` por `>=` em `agents-tamanho` (17.291 passa a FALTA)
 *  M5  rebaixar uma checagem nova para `level: 1` (fixture 1.0.1 nível 1 cai para 0)
 *  M6  `modelo-resolvido` com `level: 2` (vencido derruba o nível)
 *  M7  cortar só em `## Apêndice\n` exato (`## Apêndice — Projeto` deixa de ser corte)
 *  M8  `run()` gravando o cache (viola pureza)
 *  M9  `JSON.parse` sem try/catch em `run()` (config inválida vira stack trace)
 *  M10 linha "checagens novas" impressa incondicionalmente — deve derrubar
 *  M12 T6: `fonte` da camada ignorada (sempre null) ⇒ doctor-camada-divergente
 *  M13 T6: G8 aceitando `.md` como evidência ⇒ g8-md-nao-evidencia
 *  M14 T6: heartbeat com ts futuro aceito ⇒ doctor-camada-heartbeat-futuro
 *  M15 T6: seguir symlink em events.*.jsonl ⇒ doctor-camada-heartbeat-symlink
 *  M16 T6: voltar a varrer o disco (sem git ls-files) ⇒ doctor-varre-git-ls-files
 *  M17 T6: perfil repo-sem-app também marcando R3-prod-guard n/a ⇒ doctor-repo-sem-app
 *  M18 T6: remover o String() de diasDesde ⇒ diasdesde-numerico-invalido
 *  M11 F4-R10: alargar a entrada de excludePaths de 'gabarito-mestre/templates/' para 'templates/'
 *      (a exclusão passa a valer para QUALQUER caminho que contenha "templates/", não só o do plugin)
 */


import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as doctor from '../scripts/harness-doctor.mjs';

// Helpers compartilhados pelos arquivos harness-doctor-*.test.mjs (movidos sem reescrever).

export function repo(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-'));
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, caminho);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  return dir;
}

export const agents = (nivel) => `# AGENTS.md\n\n**Nível de adoção declarado: \`${nivel}\`**\n`;
export const hoje = new Date().toISOString().slice(0, 10);


export const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'harness-doctor.mjs');
export const ok = { confirmado: true, por: 'g', em: hoje };
export const diasAtras = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Repo 1.0.1 que o doctor 1.0.1 mede como nível 2 (fato (a) medido ao escrever o plano). */
export const fixtureNivel2_101 = (declarado) => ({
  'AGENTS.md': agents(declarado),
  'src/db.ts': 'base.$extends(massMutationGuard()); strictUndefinedChecks; assertNotProduction();',
  'test/a.spec.ts': 'await db.x.' + 'deleteMany({ where: { id } });',
  '.gitignore': '.env\n',
  '.env.example': 'API_TOKEN=\n',
  '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'ruleset-obrigatorio': ok }),
  'docs/specs/a.md': '', 'docs/plans/a.md': '', 'docs/backlog.md': '', 'docs/harness/ledger.md': '',
  '.github/PULL_REQUEST_TEMPLATE.md': 'requisito migration teardown',
  'docs/harness/prompts.md': '',
  '.github/workflows/ci.yml': 'jobs: unit integration quality migrations-guard',
  'scripts/migrations-guard.mjs': 'DESTRUCTIVE_PATTERN',
});
/** O mesmo repo depois do onboarding 1.1.0 (fases 2 e 3) + CHANGELOG + atestado da Iniciativa. */
export const fixtureNivel2_110 = (declarado, extraCfg = {}) => ({
  ...fixtureNivel2_101(declarado),
  'harness.config.json': JSON.stringify({
    fluxo: { ferramenta: 'arquivos', resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' },
    versionamento: { resolvidoEm: hoje, changelog: 'CHANGELOG.md' },
    ...extraCfg,
  }),
  '.harness/attest.json': JSON.stringify({ 'branch-protegida': ok, 'backup-verificado': ok, 'ruleset-obrigatorio': ok, 'iniciativa-resolvida': ok }),
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
});
/** AGENTS.md cujo núcleo tem EXATAMENTE `bytesNucleo` bytes (o `\n` antes do Apêndice conta no núcleo). */
export function agentsComNucleo(bytesNucleo, apendice = '## Apêndice — Projeto\n\nIniciativa: INI-1\n') {
  const cabeca = '# AGENTS.md\n\n**Nível de adoção declarado: `2`**\n\n';
  return `${cabeca}${'x'.repeat(bytesNucleo - Buffer.byteLength(cabeca) - 1)}\n${apendice}`;
}
export const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.dev', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.dev', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
export const git = (dir, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/**
 * F2-R7: `versionamento` só passa com git LEGÍVEL e histórico conforme — um repo sem `.git`
 * não conta mais como "ok com aviso" (G9). Fixtures que precisam alcançar nível 2/3 via
 * `versionamento` usam este helper: `main` (BRANCHES_PADRAO) + um commit `chore:` (tiposLivres).
 */
export function repoComGit(arquivos) {
  const dir = repo(arquivos);
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: fixture inicial');
  return dir;
}


export const AGORA = Date.parse('2026-11-02T12:00:00.000Z');
export const horasAtras = (h) => new Date(AGORA - h * 3_600_000).toISOString();
export const hb = (ts, extra = {}) => JSON.stringify({ seq: 1, ts, autor: 'a@b.c', sessao: 's1', agente: 'orquestrador', tipo: 'guarda.heartbeat', dados: { fonte: 'local' }, hash_anterior: null, ...extra });
export const CFG_GUARDA = { guarda: { ambientes: { teste: { hosts: ['127.0.0.1'] }, prod: { hosts: ['api.exemplo.com'] } } } };
export const camada = (dir) => doctor.camadaGuarda(dir, AGORA);
export const arq = (dir, rel, texto) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), texto); };

/** repo git com `origin` (bare) e origin/HEAD; `origem` vai commitada, `local` sobrescreve a árvore. */
export function repoComOrigin({ origem, local }) {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-origin-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(origem));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: inicio');
  const bare = mkdtempSync(join(tmpdir(), 'doctor-bare-'));
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  if (local !== undefined) writeFileSync(join(dir, 'harness.config.json'), typeof local === 'string' ? local : JSON.stringify(local));
  return dir;
}

export const ARQ_DIARIO = '.harness/entregas/GM-9/events.s1.jsonl';
/** Heartbeat local completo: a linha no diário desta árvore + o marcador (gitignored) que a aponta. Devolve o ts. */
export function heartbeatLocal(dir, horas, { sessao = 's1', arquivo = ARQ_DIARIO, linhas = [], marcador = {} } = {}) {
  const ts = horasAtras(horas);
  arq(dir, arquivo, `${[...linhas, hb(ts, { sessao })].join('\n')}\n`);
  arq(dir, '.harness/heartbeat.json', JSON.stringify({ ts, sessao, arquivo, autor: 'a@b.c', fonte: 'local', divergente: false, ...marcador }));
  return ts;
}

export const resumo = (o) => JSON.stringify({ n: o.alcancado, p: o.perfil, d: o.declarado, sa: o.semAgents, ci: o.configInvalido, nf: o.novasFaltando, f: o.resultados.map((r) => [r.id, r.found, r.na === true]), a: o.avisos.filter((x) => !/^guarda-/.test(x)) });

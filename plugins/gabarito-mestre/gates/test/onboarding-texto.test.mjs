/**
 * T7 (GM-14, REQ-ONB-2, texto): o onboarding para quem nunca programou. Só o texto muda; ids, valores, defaults, ordem e
 * teto de 5 ficam idênticos à 2.0.0 (golden gerado ANTES da mudança, sem os campos de texto).
 *
 * Fixtures: `completa` e `monorepo` (repositório real em mkdtemp, remoto bare) e a 1.1.x (config antiga, sem entrega nem perfil).
 * Costura (P9): o CLI `detectar` atravessa `rodarReal` → `claude` falso (PATH) → repositório real → detectar → perguntas → previaSimples.
 * Regenerar o golden: `GERAR_GOLDEN=1 node --test test/onboarding-texto.test.mjs` (só com o texto ainda da 2.0.0).
 *
 * MUTAÇÕES (task-7-mut.json, sobre scripts/onboarding.mjs e lib/glossario.mjs): M-T7a, M-T7b e as do arquivo.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, realpathSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { coletarFatos, detectar, perguntas, previa, rodarReal, MAX_PERGUNTAS, ORDEM_ITENS } from '../scripts/onboarding.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const FIX = join(AQUI, 'fixtures', 'onboarding');
const GOLDEN = join(FIX, 'golden-perguntas-2.0.0.json');
const HOJE = '2025-06-30';
const FUSO = 'America/Sao_Paulo';
const CLICKUP = 'claude.ai ClickUp: https://mcp.clickup.com/mcp - ✔ Connected\n';
const SEM_MCP = 'No MCP servers configured.\n';
const CFG_11 = JSON.stringify({ fluxo: { ferramenta: 'arquivos', resolvidoEm: '2025-01-01' }, orquestracao: { modelo: { alias: 'opus', politica: 'mais-potente', validadeDias: 90, resolvidoEm: '2025-01-01' } } });
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });
const novoDir = (prefixo = 'gm-t7-') => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo))); limpar.push(d); return d; };
const quando = (dia) => ({ GIT_AUTHOR_DATE: `${dia}T12:00:00Z`, GIT_COMMITTER_DATE: `${dia}T12:00:00Z` });
const G = (dir, args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
});

/** Versiona `d` (commit inicial datado fora da janela); com `remoto`, cria um bare e deixa `origin/HEAD` ⇒ `trunk`. */
function versionar(d, trunk, { remoto = true } = {}) {
  G(d, ['init', '-q', '-b', trunk]);
  G(d, ['add', '-A']);
  G(d, ['commit', '-q', '--allow-empty', '-m', 'init'], quando('2025-01-01'));
  if (remoto) {
    const bare = novoDir('gm-t7-bare-');
    G(bare, ['init', '-q', '--bare', '-b', trunk]);
    G(d, ['remote', 'add', 'origin', bare]);
    G(d, ['push', '-q', 'origin', trunk]);
    G(d, ['remote', 'set-head', 'origin', trunk]);
  }
  return d;
}
function deFixture(nome, trunk) {
  const d = novoDir();
  cpSync(join(FIX, nome), d, { recursive: true });
  return versionar(d, trunk);
}
function comArquivos(arquivos, trunk, opcoes) {
  const d = novoDir();
  for (const [c, t] of Object.entries(arquivos)) { mkdirSync(dirname(join(d, c)), { recursive: true }); writeFileSync(join(d, c), t); }
  return versionar(d, trunk, opcoes);
}

const rodarCom = (claude) => (cmd, args, opts) => (cmd === 'claude' ? { rc: 0, stdout: claude, stderr: '', motivo: null } : rodarReal(cmd, args, opts));
const fatosDe = (raiz, claude) => coletarFatos(raiz, { rodar: rodarCom(claude), hoje: HOJE });

/** As 3 fixtures do plano: completa (tudo detectado), monorepo (condicionais) e a 1.1.x (config antiga). */
const CASOS = {
  completa: () => ({ raiz: deFixture('completa', 'trunk'), claude: CLICKUP }),
  monorepo: () => ({ raiz: deFixture('monorepo', 'main'), claude: SEM_MCP }),
  '1.1.x': () => ({ raiz: comArquivos({ 'package.json': '{"name":"a"}', 'harness.config.json': CFG_11 }, 'main', { remoto: false }), claude: SEM_MCP }),
};
/** Itens montados à mão: os 5 abertos de uma vez (o teto de 5 perguntas corta o resto). */
const ITENS_ABERTOS = [
  { item: 'tipo_repo', estado: 'ambiguo', valor: 'app', fonte: 'x', candidatos: ['app', 'repo-sem-app'] },
  { item: 'ambientes', estado: 'ambiguo', valor: 'prod', fonte: 'x', candidatos: ['prod', 'staging'] },
  { item: 'planejamento', estado: 'ambiguo', valor: 'linear', fonte: 'x', candidatos: ['linear', 'clickup'] },
  { item: 'versionamento', estado: 'ambiguo', valor: 'main', fonte: 'x', candidatos: ['main', 'develop'] },
  { item: 'orquestracao', estado: 'nao_detectado', valor: null, fonte: 'x', candidatos: [] },
];

const semTexto = (ps) => ps.map((p) => ({ id: p.id, default: p.default, valores: p.opcoes.map((o) => o.valor) }));
function montarCasos() {
  const saida = {};
  for (const [nome, monta] of Object.entries(CASOS)) {
    const { raiz, claude } = monta();
    const fatos = fatosDe(raiz, claude);
    saida[nome] = semTexto(perguntas(detectar(fatos), fatos.configExistente));
  }
  saida['todos-abertos-teto'] = semTexto(perguntas(ITENS_ABERTOS, null));
  return saida;
}

describe('golden', () => {
  test('golden-perguntas-sem-texto-igual-2-0-0', () => {
    const agora = montarCasos();
    if (process.env.GERAR_GOLDEN === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(agora, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    // ids, valores (na ordem, default primeiro), defaults e o teto de 5: tudo da 2.0.0, nada de texto
    assert.deepEqual(agora, golden);
    assert.equal(golden['todos-abertos-teto'].length, MAX_PERGUNTAS);
    assert.deepEqual(golden['todos-abertos-teto'].map((p) => p.id), ['politica', 'autonomia', 'perfil', 'tipo_repo', 'ambientes']);
    assert.deepEqual(golden.completa.map((p) => p.id), ['politica', 'autonomia', 'perfil']);
  });
});

/**
 * FX4 (GM-13, E5a): defeitos D1-D3 achados pelo aceite com adotante simulado (T17b).
 * Costura (P9): CLI `detectar`/`gravar` reais (claude falso no PATH, git real) e `harness-doctor --json` real sobre o repo gravado.
 * MUTAÇÕES: task-fx4-mut.json (MUT-fx4-*).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { previa } from '../scripts/onboarding.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const DOCTOR = join(AQUI, '..', 'scripts', 'harness-doctor.mjs');
const HOJE = '2025-06-30';
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });
const novoDir = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'gm-fx4-'))); limpar.push(d); return d; };
const G = (dir, args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] });

function repo({ arquivos = {}, git = true, branch = 'main' } = {}) {
  const d = novoDir();
  for (const [c, t] of Object.entries(arquivos)) { mkdirSync(dirname(join(d, c)), { recursive: true }); writeFileSync(join(d, c), t); }
  if (git) { G(d, ['init', '-q', '-b', branch]); G(d, ['add', '-A']); G(d, ['commit', '-q', '--allow-empty', '-m', 'chore: init']); }
  return d;
}
const bin = () => { const b = novoDir(); writeFileSync(join(b, 'claude'), '#!/bin/sh\necho "outro: cmd - ✔ Connected"\n'); chmodSync(join(b, 'claude'), 0o755); return b; };
const ENV = () => ({ ...process.env, PATH: `${bin()}:${process.env.PATH}` });
const detectar = (raiz, env) => { const r = spawnSync(process.execPath, [CLI, 'detectar', '--root', raiz, '--hoje', HOJE, '--fuso', 'UTC'], { encoding: 'utf8', env }); return JSON.parse(r.stdout); };
const gravar = (raiz, det, env) => {
  const resp = { _previa: det.itens };
  for (const p of det.perguntas) resp[p.id] = p.opcoes[0].valor;
  const f = join(novoDir(), 'resp.json');
  writeFileSync(f, JSON.stringify(resp));
  return JSON.parse(spawnSync(process.execPath, [CLI, 'gravar', '--root', raiz, '--respostas', f, '--hoje', HOJE, '--fuso', 'UTC'], { encoding: 'utf8', env }).stdout);
};
const doctor = (raiz) => JSON.parse(spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: raiz, encoding: 'utf8' }).stdout);
const PKG_MONO = JSON.stringify({ name: 'm', workspaces: ['packages/*'] });
const CFG_11 = JSON.stringify({ fluxo: { ferramenta: 'arquivos', resolvidoEm: '2025-01-01' }, orquestracao: { modelo: { alias: 'opus', politica: 'mais-potente', validadeDias: 90, resolvidoEm: '2025-01-01' } } });

const casos = {
  monorepo: () => repo({ arquivos: { 'package.json': PKG_MONO } }),
  'repo 1.1.x': () => repo({ arquivos: { 'package.json': '{"name":"a"}', 'harness.config.json': CFG_11 } }),
  'sem remoto': () => repo({ arquivos: { 'package.json': '{"name":"a"}' } }),
  'sem git': () => repo({ arquivos: { 'package.json': PKG_MONO }, git: false }),
};

for (const [nome, monta] of Object.entries(casos)) {
  test(`D1 ${nome}: toda pergunta tem >= 2 opcoes e o total e <= 5; item sem opcao vira fato na previa`, () => {
    const raiz = monta();
    const det = detectar(raiz, ENV());
    assert.equal(det.ok, true);
    assert.ok(det.perguntas.length >= 3 && det.perguntas.length <= 5, `total ${det.perguntas.length}`);
    for (const p of det.perguntas) assert.ok(p.opcoes.length >= 2, `${p.id} com ${p.opcoes.length} opcao`);
    const sem = det.itens.filter((i) => i.estado === 'nao_detectado' && !det.perguntas.some((p) => p.id === i.item));
    for (const i of sem) {
      const linha = det.previa.split('\n').find((l) => l.startsWith(`- ${i.item}:`) && !l.includes('(fonte'));
      assert.ok(linha && /sem opção|acima do teto/.test(linha) && !/pergunto/.test(linha), `${i.item}: ${linha}`);
      if (i.candidatos.length === 0 && i.item !== 'planejamento') assert.match(linha, /sem opção/, `${i.item} sem candidato não é teto: ${linha}`);
    }
  });
}

test('D1 monorepo sem CI nem conector: itens sem opcao ficam nao_detectado na config (nada gravado sem perguntar)', () => {
  const raiz = casos.monorepo();
  const env = ENV();
  const det = detectar(raiz, env);
  const g = gravar(raiz, det, env);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.ok(g.naoDetectado.includes('ambientes'));
});

test('D2 sem remoto: versionamento sai resolvido do onboarding e o doctor nao marca FALTA nem manda colar comando', () => {
  const raiz = casos['sem remoto']();
  const env = ENV();
  const det = detectar(raiz, env);
  const p = det.perguntas.find((x) => x.id === 'versionamento');
  assert.ok(p, 'versionamento precisa ser perguntado com opcoes');
  assert.equal(p.opcoes[0].valor, 'main');
  const g = gravar(raiz, det, env);
  assert.equal(g.ok, true, JSON.stringify(g));
  const cfg = JSON.parse(readFileSync(join(raiz, 'harness.config.json'), 'utf8'));
  assert.match(cfg.versionamento.resolvidoEm, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cfg.entrega.base, 'main');
  const v = doctor(raiz).resultados.find((r) => r.id === 'versionamento');
  assert.equal(v.found, true, JSON.stringify(v));
  assert.ok(!g.naoDetectado.includes('versionamento'));
});

test('D2 versionamento nao resolvido: o fix do doctor nao pede para rodar comando', () => {
  const raiz = repo({ arquivos: { 'package.json': '{"name":"a"}' }, git: false });
  const v = doctor(raiz).resultados.find((r) => r.id === 'versionamento');
  assert.equal(v.found, false);
  assert.doesNotMatch(`${v.fix} ${v.label} ${v.evidence}`, /\b(rode|execute|node|bash|npm|npx|git)\b|\.mjs|\.sh/i);
  assert.match(v.fix, /trocar versionamento/);
});

test('D3 iniciativa-resolvida: o fix cita o caminho real (trocar iniciativa) e nao manda rodar nada', () => {
  const raiz = casos['sem remoto']();
  const r = doctor(raiz).resultados.find((x) => x.id === 'iniciativa-resolvida');
  assert.equal(r.found, false);
  assert.match(r.fix, /trocar iniciativa/);
  assert.doesNotMatch(r.fix, /confirme a Iniciativa no onboarding|\b(rode|node|bash|git)\b/i);
});

// ── item 5 (Sombra, MINOR): a prévia mostra a troca do alias do orquestrador
const itensMin = [{ item: 'tipo_repo', estado: 'detectado', valor: 'app', fonte: 'x', candidatos: [] }];
const perg = (perfil) => [
  { id: 'politica', opcoes: [], default: 'sob_demanda' }, { id: 'autonomia', opcoes: [], default: false }, { id: 'perfil', opcoes: [], default: perfil },
];
test('previa-mostra-troca-de-alias: config 1.1.x com alias opus + perfil padrao => linha com antigo, novo e perfil; alias igual => ausente', () => {
  const cfg = (alias) => ({ orquestracao: { modelo: { alias } } });
  const com = previa(itensMin, perg('padrao'), { fuso: 'UTC', existente: cfg('opus') });
  assert.match(com, /modelo do orquestrador: opus ⇒ fable \(vem do perfil padrao; para manter opus: perfil economia ou modelos\.revisor_final\)/);
  const igual = previa(itensMin, perg('padrao'), { fuso: 'UTC', existente: cfg('fable') });
  assert.doesNotMatch(igual, /modelo do orquestrador/);
  const economia = previa(itensMin, perg('economia'), { fuso: 'UTC', existente: cfg('opus') });
  assert.doesNotMatch(economia, /modelo do orquestrador/);
  const sem = previa(itensMin, perg('padrao'), { fuso: 'UTC' });
  assert.doesNotMatch(sem, /modelo do orquestrador/);
});

test('SKILL passo 4: item de 1 opcao nao e perguntado nem reformulado; pergunta com < 2 opcoes aborta', () => {
  const skill = readFileSync(join(AQUI, '..', '..', 'skills', 'gabarito-instalar', 'SKILL.md'), 'utf8');
  assert.match(skill, /Item com uma opção só nunca chega em `perguntas`[^\n]*não o pergunte, não o reformule e não o conte/);
  assert.match(skill, /Toda pergunta do script tem 2 ou mais opções/);
});

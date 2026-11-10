/**
 * T6a (GM-13, E5a, ONB-1): coleta e detecção do onboarding.
 *
 * Fixtures guardam SÓ arquivos; o git (init, remoto bare, `remote set-head`, commits datados) é montado em mkdtemp,
 * nunca commitado dentro do repo (repo aninhado). `hoje` é fixo no passado e os commits levam datas explícitas: a
 * janela de 60 d nunca depende do relógio. `claude mcp list` é sempre injetado (`rodar`): o resultado real depende da
 * conta e da rede. Costura (P9): o CLI `detectar` atravessa `rodarReal` → `claude` (falso, no PATH) → git real →
 * coletarFatos → detectar.
 *
 * MUTAÇÕES (task-6a-mut.json, sobre scripts/onboarding.mjs): M-ONB2, M-ONB8 … M-ONB14 e as do arquivo.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, realpathSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir, homedir, availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { ORDEM_ITENS, coletarFatos, detectar, rodarReal, lerWorkflow, TIMEOUT_MCP_MS, perguntas, previa, configDasRespostas, gravar, MOTIVO_BRANCHPADRAO } from '../scripts/onboarding.mjs';
import { coletar as coletarCartao } from '../scripts/cartao-sessao.mjs';
import { lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { PERFIS_MODELO } from '../lib/config.mjs';
import * as capacidade from '../scripts/capacidade.mjs';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const FIX = join(AQUI, 'fixtures', 'onboarding');
const HOJE = '2025-06-30'; // janela: 2025-05-01T00:00:00Z em diante
const CLICKUP = 'claude.ai ClickUp: https://mcp.clickup.com/mcp - ✔ Connected\n';
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });

const novoDir = (prefixo = 'gm-onb-') => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
  limpar.push(d);
  return d;
};

/** Escreve `arquivos` ({caminho: texto}) numa pasta nova (sem git). */
function raizCom(arquivos = {}) {
  const d = novoDir();
  for (const [c, t] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(d, c)), { recursive: true });
    writeFileSync(join(d, c), t);
  }
  return d;
}

const ok = (stdout) => ({ rc: 0, stdout, stderr: '', motivo: null });
/** `rodar` com o `claude` falso; todo o resto (git) é real. */
const rodarCom = (claude, extra) => (cmd, args, opts) => {
  if (extra) {
    const r = extra(cmd, args, opts);
    if (r) return r;
  }
  if (cmd === 'claude') return typeof claude === 'function' ? claude(args, opts) : typeof claude === 'string' ? ok(claude) : claude;
  return rodarReal(cmd, args, opts);
};
const fatosDe = (raiz, { claude = CLICKUP, hoje = HOJE, extra } = {}) => coletarFatos(raiz, { rodar: rodarCom(claude, extra), hoje });
const itensDe = (raiz, opts) => Object.fromEntries(detectar(fatosDe(raiz, opts)).map((i) => [i.item, i]));

// ────────────────────────────────────────────────────────────── git em mkdtemp

const quando = (dia, hora = '12:00:00') => ({ GIT_AUTHOR_DATE: `${dia}T${hora}Z`, GIT_COMMITTER_DATE: `${dia}T${hora}Z` });
function G(dir, args, env = {}) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
let contador = 0;

/** Repo com remoto bare, trunk `trunk`, `origin/HEAD` ⇒ trunk. Commit inicial em 2025-01-01 (fora da janela). */
function montarRepo(dir, trunk = 'main') {
  G(dir, ['init', '-q', '-b', trunk]);
  G(dir, ['add', '-A']);
  G(dir, ['commit', '-q', '--allow-empty', '-m', 'init'], quando('2025-01-01'));
  const bare = novoDir('gm-onb-bare-');
  G(bare, ['init', '-q', '--bare', '-b', trunk]);
  G(dir, ['remote', 'add', 'origin', bare]);
  G(dir, ['push', '-q', 'origin', trunk]);
  G(dir, ['remote', 'set-head', 'origin', trunk]);
  return dir;
}
/** Nova branch remota a partir de `de`. */
function criarBase(dir, nome, de) {
  G(dir, ['checkout', '-q', '-b', nome, de]);
  G(dir, ['push', '-q', 'origin', nome]);
}
/** Merge de PR (--no-ff) em `base`, na `data`. */
function mergear(dir, base, data) {
  contador += 1;
  const ramo = `f${contador}`;
  G(dir, ['checkout', '-q', '-b', ramo, base]);
  writeFileSync(join(dir, `${ramo}.txt`), ramo);
  G(dir, ['add', '-A']);
  G(dir, ['commit', '-q', '-m', `feat: ${ramo}`], quando(data));
  G(dir, ['checkout', '-q', base]);
  G(dir, ['merge', '-q', '--no-ff', '-m', `Merge ${ramo}`, ramo], quando(data));
  G(dir, ['push', '-q', 'origin', base]);
}
/** Commit simples (1 pai) em `base`, com `assunto`. */
function commitar(dir, base, assunto, data, hora = '12:00:00') {
  contador += 1;
  G(dir, ['checkout', '-q', base]);
  writeFileSync(join(dir, `c${contador}.txt`), assunto);
  G(dir, ['add', '-A']);
  G(dir, ['commit', '-q', '-m', assunto], quando(data, hora));
  G(dir, ['push', '-q', 'origin', base]);
}
function fixtureComGit(nome, trunk = 'main') {
  const d = novoDir();
  cpSync(join(FIX, nome), d, { recursive: true });
  return montarRepo(d, trunk);
}
const repoVazio = (trunk = 'main') => montarRepo(raizCom({ 'package.json': '{"name":"x"}' }), trunk);

// ────────────────────────────────────────────────────────────── fixtures completa e monorepo

describe('fixtures', () => {
  test('fixture-completa-tudo-detectado', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const itens = detectar(fatosDe(raiz));
    assert.deepEqual(itens.map((i) => i.item), ORDEM_ITENS);
    for (const i of itens) {
      assert.equal(i.estado, 'detectado', `${i.item}: ${i.motivo ?? ''}`);
      assert.ok(i.fonte.length > 0, `${i.item} sem fonte`);
      assert.deepEqual(i.candidatos, []);
    }
    const por = Object.fromEntries(itens.map((i) => [i.item, i]));
    assert.equal(por.tipo_repo.valor, 'app');
    assert.deepEqual(por.ambientes.valor, { producao: 'production', outros: ['staging'] });
    assert.deepEqual(por.planejamento.valor, { ferramenta: 'clickup', mcp: 'claude.ai ClickUp' });
    assert.equal(por.versionamento.valor, 'trunk');
    assert.deepEqual(por.orquestracao.valor, { simultaneos: 2, teto: 4 });
    // .env.example: só o NOME da chave; o valor nunca aparece
    const tudo = JSON.stringify({ fatos: fatosDe(raiz), itens });
    assert.ok(!tudo.includes('SEGREDO-NAO-LER') && !tudo.includes('postgres://'), 'valor do .env.example vazou');
  });

  test('fixture-monorepo-tres-nao-resolvidos', () => {
    const raiz = fixtureComGit('monorepo', 'main');
    const itens = Object.fromEntries(detectar(fatosDe(raiz, { claude: 'No MCP servers configured.\n' })).map((i) => [i.item, i]));
    assert.deepEqual(Object.values(itens).map((i) => i.estado), ['ambiguo', 'nao_detectado', 'nao_detectado', 'detectado', 'detectado']);
    assert.equal(itens.tipo_repo.valor, 'app');
    assert.deepEqual(itens.tipo_repo.candidatos, ['app', 'repo-sem-app']);
    assert.match(itens.tipo_repo.fonte, /workspaces/);
    assert.match(itens.tipo_repo.fonte, /turbo\.json/);
    assert.equal(itens.ambientes.motivo, 'CI sem deploy');
    assert.equal(itens.planejamento.motivo, 'sem conector de planejamento');
    assert.equal(itens.versionamento.valor, 'main');
  });
});

// ────────────────────────────────────────────────────────────── claude mcp list

describe('coletar claude mcp list', () => {
  test('coletar-mcp-falha-x-saida-torta', () => {
    const casos = [
      [{ rc: 1, stdout: '', stderr: 'boom', motivo: null }, 'claude mcp list falhou (rc 1)'],
      [{ rc: null, stdout: '', stderr: '', motivo: 'timeout' }, 'claude mcp list falhou (timeout)'],
      [{ rc: null, stdout: '', stderr: '', motivo: 'ausente' }, 'claude mcp list falhou (ausente)'],
      [ok('isto nao e a lista de servidores\noutra linha qualquer\n'), 'saída ilegível'],
      [ok(''), 'saída ilegível'],
    ];
    const motivos = new Set();
    for (const [claude, motivo] of casos) {
      const f = fatosDe(raizCom(), { claude });
      assert.equal(f.mcps, null, motivo);
      assert.equal(f.motivos.mcps, motivo);
      motivos.add(f.motivos.mcps);
      const p = detectar(f).find((i) => i.item === 'planejamento');
      assert.equal(p.estado, 'nao_detectado');
      assert.equal(p.motivo, motivo);
      assert.equal(p.valor, null);
    }
    assert.equal(motivos.size, casos.length - 1, 'ausente, timeout, rc e saída torta têm motivos distintos (saída vazia e torta são ambas ilegíveis)');
  });

  test('coletar-sem-servidores-lista-vazia', () => {
    const f = fatosDe(raizCom(), { claude: 'No MCP servers configured. Use `claude mcp add` to add a server.\n' });
    assert.deepEqual(f.mcps, []);
    assert.equal(f.motivos.mcps, undefined);
    const p = detectar(f).find((i) => i.item === 'planejamento');
    assert.equal(p.motivo, 'sem conector de planejamento');
  });

  test('coletar-mcp-nao-conectado-nao-conta', () => {
    const saida = [
      'Checking MCP server health...',
      '',
      'claude.ai ClickUp: https://mcp.clickup.com/mcp - ✔ Connected',
      'claude.ai Notion: https://mcp.notion.com/mcp - ⚠ Needs authentication',
      'plugin:design:linear: https://mcp.linear.app/mcp - ✗ Failed to connect',
      'plugin_design_atlassian: https://mcp.atlassian.com/v1/sse - ✗ Not Connected',
      '',
    ].join('\n');
    const f = fatosDe(raizCom(), { claude: saida });
    assert.deepEqual(f.mcps, ['claude.ai ClickUp']);
    const p = detectar(f).find((i) => i.item === 'planejamento');
    assert.equal(p.estado, 'detectado');
    assert.deepEqual(p.valor, { ferramenta: 'clickup', mcp: 'claude.ai ClickUp' });
  });

  test('fonte-sem-url-de-mcp', () => {
    const saida = [
      'claude.ai ClickUp: https://mcp.clickup.com/mcp?token=SEGREDO123 - ✔ Connected',
      'supabase: npx -y @supabase/mcp --access-token=SEGREDO456 - ✔ Connected',
      '',
    ].join('\n');
    const f = fatosDe(raizCom(), { claude: saida });
    assert.deepEqual(f.mcps, ['claude.ai ClickUp', 'supabase']);
    const tudo = JSON.stringify({ f, itens: detectar(f) });
    for (const proibido of ['SEGREDO123', 'SEGREDO456', 'https://', 'mcp.clickup.com', '--access-token']) {
      assert.ok(!tudo.includes(proibido), `vazou ${proibido}`);
    }
  });

  test('coletar-claude-roda-em-pasta-vazia-com-timeout', () => {
    const raiz = raizCom({ '.mcp.json': '{"mcpServers":{"x":{"command":"nao-sobe"}}}', 'package.json': '{"name":"y"}' });
    let visto = null;
    const claude = (args, opts) => {
      visto = { args, cwd: opts.cwd, timeoutMs: opts.timeoutMs, conteudo: readdirSync(opts.cwd) };
      return ok(CLICKUP);
    };
    fatosDe(raiz, { claude });
    assert.deepEqual(visto.args, ['mcp', 'list']);
    assert.notEqual(visto.cwd, raiz);
    assert.deepEqual(visto.conteudo, [], 'o claude roda numa pasta vazia, nunca no repo (o health check sobe os MCP do .mcp.json)');
    assert.equal(visto.timeoutMs, 30_000);
    assert.equal(TIMEOUT_MCP_MS, 30_000);
    assert.ok(!existsSync(visto.cwd), 'a pasta temporária é removida');
  });

  test('rodarReal-ausente-timeout-e-ok', () => {
    assert.equal(rodarReal('comando-que-nao-existe-gm-onb', []).motivo, 'ausente');
    const t = rodarReal('sleep', ['5'], { timeoutMs: 150 });
    assert.equal(t.motivo, 'timeout');
    assert.equal(t.rc, null);
    const g = rodarReal('git', ['--version']);
    assert.equal(g.rc, 0);
    assert.equal(g.motivo, null);
    assert.match(g.stdout, /git version/);
  });
});

// ────────────────────────────────────────────────────────────── arquivos: ausente × corrompido

describe('ausente x corrompido', () => {
  test('package-json-ausente-x-corrompido', () => {
    const ausente = fatosDe(raizCom());
    const torto = fatosDe(raizCom({ 'package.json': '{ nao e json' }));
    assert.equal(ausente.packageJson, null);
    assert.equal(torto.packageJson, null);
    assert.equal(ausente.motivos.packageJson, 'sem package.json');
    assert.equal(torto.motivos.packageJson, 'package.json ilegível');
    for (const f of [ausente, torto]) {
      const t = detectar(f)[0];
      assert.equal(t.estado, 'ambiguo');
      assert.equal(t.valor, 'app');
      assert.deepEqual(t.candidatos, ['app', 'repo-sem-app']);
    }
    assert.equal(detectar(ausente)[0].motivo, 'sem package.json');
    assert.equal(detectar(torto)[0].motivo, 'package.json ilegível');
  });

  test('mcp-json-ausente-x-corrompido', () => {
    const ausente = fatosDe(raizCom());
    const torto = fatosDe(raizCom({ '.mcp.json': '{' }));
    assert.deepEqual(ausente.mcpRepo, []);
    assert.equal(torto.mcpRepo, null);
    assert.equal(torto.motivos.mcpRepo, '.mcp.json ilegível');
    assert.equal(ausente.motivos.mcpRepo, undefined);
    const p = detectar(torto).find((i) => i.item === 'planejamento');
    assert.equal(p.estado, 'detectado', 'o planejamento segue só com os conectores');
    assert.equal(p.valor.ferramenta, 'clickup');
    const doRepo = fatosDe(raizCom({ '.mcp.json': '{"mcpServers":{"plugin_design_notion":{}}}' }), { claude: 'No MCP servers configured.\n' });
    assert.deepEqual(doRepo.mcpRepo, ['plugin_design_notion']);
    assert.deepEqual(detectar(doRepo).find((i) => i.item === 'planejamento').valor, { ferramenta: 'notion', mcp: 'plugin_design_notion' });
  });

  test('config-corrompida-marca-tres-itens-e-detectar-falha', () => {
    const raiz = raizCom({ 'harness.config.json': '{', 'package.json': '{"name":"x"}' });
    const f = fatosDe(raiz);
    assert.equal(typeof f.configExistente.erro, 'string');
    const por = Object.fromEntries(detectar(f).map((i) => [i.item, i]));
    for (const k of ['planejamento', 'versionamento', 'orquestracao']) {
      assert.equal(por[k].estado, 'nao_detectado', k);
      assert.equal(por[k].motivo, 'harness.config.json ilegível', k);
    }
    const ausente = fatosDe(raizCom());
    assert.equal(ausente.configExistente, null, 'ausente é diferente de corrompido');
  });

  test('config-corrompida-detectar-falha', () => {
    const bin = novoDir('gm-onb-bin-');
    const marca = join(bin, 'chamou');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho x > '${marca}'\necho 'claude.ai ClickUp: https://x.test - ✔ Connected'\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const raiz = raizCom({ 'harness.config.json': '{ torto' });
    const r = spawnSync(process.execPath, [CLI, 'detectar', '--root', raiz, '--hoje', HOJE], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 1, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.equal(saida.ok, false);
    assert.equal(saida.erro, 'config_invalida');
    assert.match(saida.motivo, /harness\.config\.json ilegível/);
    assert.ok(!existsSync(marca), 'sem coletar nada mais: o claude nem roda');
    assert.equal(readFileSync(join(raiz, 'harness.config.json'), 'utf8'), '{ torto', 'nada escrito');
  });

  test('tipo-repo-perfil-da-config', () => {
    const raiz = raizCom({ 'harness.config.json': '{\n  "perfil": "repo-sem-app"\n}', 'package.json': '{"name":"x","workspaces":["a"]}' });
    const t = detectar(fatosDe(raiz))[0];
    assert.equal(t.estado, 'detectado');
    assert.equal(t.valor, 'repo-sem-app');
    assert.match(t.fonte, /harness\.config\.json:2/);
    assert.deepEqual(t.candidatos, []);
  });
});

// ────────────────────────────────────────────────────────────── ambientes

const WF_PROD = 'name: deploy-producao\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    environment: deploy-producao\n    runs-on: x\n';
const WF_STG = 'name: deploy-staging\non:\n  push:\n    # só a staging\n    branches: [staging]\n  workflow_dispatch:\njobs:\n  deploy:\n    runs-on: x\n';
const wf = (nome, texto) => ({ [`.github/workflows/${nome}`]: texto });

describe('ambientes', () => {
  test('ambientes-deploy-sem-environment', () => {
    const raiz = raizCom({ ...wf('deploy-producao.yml', WF_PROD), ...wf('deploy-staging.yml', WF_STG) });
    const a = itensDe(raiz).ambientes;
    assert.equal(a.estado, 'detectado');
    assert.deepEqual(a.valor, { producao: 'deploy-producao', outros: ['staging'] });
    assert.match(a.fonte, /deploy-producao\.yml:7/);
    assert.match(a.fonte, /deploy-staging\.yml:5/);
  });

  test('ambientes-ci-sem-deploy-nao-detectado', () => {
    const ci = 'name: CI\non:\n  push:\n    branches: [main]\njobs:\n  t:\n    runs-on: x\n';
    const a = itensDe(raizCom(wf('ci.yml', ci))).ambientes;
    assert.equal(a.estado, 'nao_detectado');
    assert.equal(a.motivo, 'CI sem deploy');
    assert.equal(a.valor, null);
    const sem = itensDe(raizCom()).ambientes;
    assert.equal(sem.estado, 'nao_detectado');
    assert.equal(sem.motivo, 'sem CI');
  });

  test('ambientes-mesmo-environment-dois-jobs', () => {
    const dois = 'name: deploy\non: push\njobs:\n  api:\n    environment: production\n    runs-on: x\n  web:\n    environment: production\n    runs-on: x\n';
    const a = itensDe(raizCom({ ...wf('deploy.yml', dois), ...wf('outro.yml', 'name: o\non: push\njobs:\n  j:\n    environment: production\n') })).ambientes;
    assert.equal(a.estado, 'detectado');
    assert.deepEqual(a.valor, { producao: 'production', outros: [] });
  });

  test('ambientes-env-example-nao-cria-segunda-producao', () => {
    const base = { ...wf('deploy.yml', 'name: deploy\non: push\njobs:\n  j:\n    environment: production\n') };
    const com = itensDe(raizCom({ ...base, '.env.example': 'PROD_DB_URL=x\nPRODUCTION_KEY=y\n' })).ambientes;
    assert.equal(com.estado, 'detectado');
    assert.deepEqual(com.valor, { producao: 'production', outros: [] });
    // classe que o CI não tem: soma, uma vez (STG_ e STAGING_ são a mesma classe)
    const soma = itensDe(raizCom({ ...base, '.env.example': 'STAGING_URL=x\nSTG_KEY=y\nHML_X=z\n' })).ambientes;
    assert.deepEqual(soma.valor, { producao: 'production', outros: ['staging', 'homolog'] });
    // classe que o CI já tem (staging por branch): não duplica
    const ja = itensDe(raizCom({ ...base, ...wf('deploy-staging.yml', WF_STG), '.env.example': 'STAGING_URL=x\n' })).ambientes;
    assert.deepEqual(ja.valor, { producao: 'production', outros: ['staging'] });
    // sem CI, ou CI sem deploy: o .env não muda o estado
    assert.equal(itensDe(raizCom({ '.env.example': 'PROD_X=1\n' })).ambientes.motivo, 'sem CI');
    const ci = wf('ci.yml', 'name: CI\non: push\njobs:\n  t:\n    runs-on: x\n');
    assert.equal(itensDe(raizCom({ ...ci, '.env.example': 'PROD_X=1\nSTAGING_X=1\n' })).ambientes.motivo, 'CI sem deploy');
  });

  test('ambientes-environment-objeto-e-expressao', () => {
    const texto = [
      'name: multi',
      'on: workflow_dispatch',
      'jobs:',
      '  a:',
      '    environment:',
      '      name: production',
      '      url: https://x.test',
      '    runs-on: x',
      '  b:',
      '    environment: "staging"   # comentário',
      '    runs-on: x',
      '  c:',
      '    environment: ${{ inputs.alvo }}',
      '    runs-on: x',
      '  d:',
      '    # environment: qa',
      '    runs-on: x',
      '  e:',
      '    environment: { name: homolog, url: https://h.test }',
      '    runs-on: x',
      '',
    ].join('\n');
    const w = lerWorkflow(texto, 'x.yml');
    assert.deepEqual(w.envs.map((e) => e.nome), ['production', 'staging', 'homolog']);
    assert.deepEqual(w.envs.map((e) => e.fonte), ['x.yml:6', 'x.yml:10', 'x.yml:19']);
    assert.deepEqual(w.ignorados, ['x.yml:13']);
    const a = itensDe(raizCom(wf('multi.yml', texto))).ambientes;
    assert.deepEqual(a.valor, { producao: 'production', outros: ['staging', 'homolog'] });
    assert.match(a.fonte, /multi\.yml:13 \(expressão/);
    assert.ok(!a.fonte.includes('qa'), 'linha comentada nunca conta');
  });

  test('ambientes-branches-em-lista-de-fluxo-e-em-bloco', () => {
    const bloco = 'name: deploy-hml\non:\n  push:\n    branches:\n      - hml   # só a hml\n  pull_request:\n    branches: [outra]\n';
    const fluxo = 'name: deploy-edge\non:\n  push:\n    branches: ["a", \'b\']\n';
    const semBranches = 'name: deploy-nada\non: push\n';
    assert.deepEqual(lerWorkflow(bloco, 'b.yml').branches, ['hml']);
    assert.equal(lerWorkflow(bloco, 'b.yml').branchesLinha, 4);
    assert.deepEqual(lerWorkflow(fluxo, 'f.yml').branches, ['a', 'b']);
    assert.deepEqual(lerWorkflow(semBranches, 's.yml').branches, []);
    const prod = wf('p.yml', 'name: p\non: push\njobs:\n  j:\n    environment: production\n');
    const a = itensDe(raizCom({ ...prod, ...wf('deploy-hml.yml', bloco), ...wf('deploy-edge.yml', fluxo), ...wf('deploy-nada.yml', semBranches) })).ambientes;
    // 1 branch ⇒ o branch; 2 ⇒ o name: sem "deploy-"; sem branches ⇒ não é candidato
    assert.deepEqual(a.valor, { producao: 'production', outros: ['edge', 'hml'] });
  });

  test('ambientes-workflow-ilegivel-fica-fora-e-a-fonte-cita', () => {
    const raiz = raizCom({ ...wf('ok.yml', 'name: o\non: push\njobs:\n  j:\n    environment: production\n') });
    mkdirSync(join(raiz, '.github', 'workflows', 'quebrado.yml')); // existe e não lê
    const f = fatosDe(raiz);
    assert.deepEqual(f.workflowsIlegiveis, ['.github/workflows/quebrado.yml']);
    const a = detectar(f).find((i) => i.item === 'ambientes');
    assert.equal(a.estado, 'detectado');
    assert.match(a.fonte, /quebrado\.yml ilegível/);
    // só ilegível ⇒ não detectado, citando o arquivo
    const so = raizCom();
    mkdirSync(join(so, '.github', 'workflows', 'so.yml'), { recursive: true });
    const n = itensDe(so).ambientes;
    assert.equal(n.estado, 'nao_detectado');
    assert.match(n.fonte, /so\.yml ilegível/);
  });

  test('ambientes-sem-producao-ou-duas-producoes-ambiguo', () => {
    const zero = itensDe(raizCom({ ...wf('deploy-staging.yml', WF_STG) })).ambientes;
    assert.equal(zero.estado, 'ambiguo');
    assert.deepEqual(zero.candidatos, ['staging']);
    assert.equal(zero.valor, 'staging');
    const duas = itensDe(raizCom({ ...wf('a.yml', 'name: a\non: push\njobs:\n  j:\n    environment: production\n'), ...wf('b.yml', 'name: b\non: push\njobs:\n  j:\n    environment: prod-eu\n'), ...wf('c.yml', 'name: c\non: push\njobs:\n  j:\n    environment: staging\n') })).ambientes;
    assert.equal(duas.estado, 'ambiguo');
    assert.deepEqual(duas.candidatos, ['production', 'prod-eu']);
    assert.equal(duas.valor, 'production');
  });
});

// ────────────────────────────────────────────────────────────── planejamento

describe('planejamento', () => {
  test('planejamento-config-vence-conectores', () => {
    const raiz = raizCom({ 'harness.config.json': '{\n  "fluxo": {\n    "ferramenta": "jira",\n    "mcp": "plugin_design_atlassian"\n  }\n}' });
    const p = itensDe(raiz).planejamento;
    assert.equal(p.estado, 'detectado');
    assert.deepEqual(p.valor, { ferramenta: 'jira', mcp: 'plugin_design_atlassian' });
    assert.match(p.fonte, /harness\.config\.json:3 \(fluxo\.ferramenta\)/);
    // sem fluxo.mcp: o conector que casa, ou null
    const sem = itensDe(raizCom({ 'harness.config.json': '{"fluxo":{"ferramenta":"clickup"}}' })).planejamento;
    assert.deepEqual(sem.valor, { ferramenta: 'clickup', mcp: 'claude.ai ClickUp' });
    const nenhum = itensDe(raizCom({ 'harness.config.json': '{"fluxo":{"ferramenta":"jira"}}' })).planejamento;
    assert.deepEqual(nenhum.valor, { ferramenta: 'jira', mcp: null });
  });

  test('planejamento-ferramenta-vazia-ou-invalida-segue-para-conectores', () => {
    for (const v of ['""', '3', 'null', '"  "']) {
      const p = itensDe(raizCom({ 'harness.config.json': `{"fluxo":{"ferramenta":${v}}}` })).planejamento;
      assert.equal(p.estado, 'detectado', v);
      assert.equal(p.valor.ferramenta, 'clickup', v);
      assert.match(p.fonte, /fluxo\.ferramenta vazio ou inválido/, v);
    }
  });

  test('planejamento-duas-ferramentas-ambiguo', () => {
    const duas = `${CLICKUP}claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected\n`;
    const p = itensDe(raizCom(), { claude: duas }).planejamento;
    assert.equal(p.estado, 'ambiguo');
    assert.deepEqual(p.candidatos, ['clickup', 'notion'], 'ordem do ferramentas-mcp.json');
    assert.equal(p.valor, 'clickup');
    // o servidor do .mcp.json do repo é o default
    const repo = raizCom({ '.mcp.json': '{"mcpServers":{"notion-repo":{}}}' });
    const q = itensDe(repo, { claude: duas }).planejamento;
    assert.equal(q.estado, 'ambiguo');
    assert.equal(q.valor, 'notion');
    assert.deepEqual(q.candidatos, ['notion', 'clickup']);
  });

  test('planejamento-mcps-nulo-com-ferramenta-no-repo-nao-detectado', () => {
    const repo = raizCom({ '.mcp.json': '{"mcpServers":{"linear":{}}}' });
    const p = itensDe(repo, { claude: { rc: 1, stdout: '', stderr: '', motivo: null } }).planejamento;
    assert.equal(p.estado, 'nao_detectado');
    assert.equal(p.motivo, 'claude mcp list falhou (rc 1)');
    assert.deepEqual(p.candidatos, ['linear']);
    assert.equal(p.valor, null);
  });
});

// ────────────────────────────────────────────────────────────── versionamento (git real em mkdtemp)

describe('versionamento', () => {
  test('versionamento-base-integracao-ambiguo', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'main', '2025-06-10');
    for (const d of ['2025-06-05', '2025-06-12', '2025-06-20']) mergear(raiz, 'staging', d);
    const f = fatosDe(raiz);
    assert.deepEqual(f.integracao, { main: 1, staging: 3 });
    const v = detectar(f)[3];
    assert.equal(v.estado, 'ambiguo');
    assert.deepEqual(v.candidatos, ['staging', 'main']);
    assert.equal(v.valor, 'staging');
    assert.match(v.fonte, /origin\/staging 3, origin\/main 1/);
    assert.ok(v.candidatos.every((c) => !c.startsWith('origin/')) && !v.valor.startsWith('origin/'), 'valor e candidatos sem origin/');
  });

  test('versionamento-so-head-detectado', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main'); // nasce antes dos merges da main: não herda
    mergear(raiz, 'main', '2025-06-10');
    mergear(raiz, 'main', '2025-06-11');
    const f = fatosDe(raiz);
    assert.deepEqual(f.integracao, { main: 2, staging: 0 });
    const v = detectar(f)[3];
    assert.equal(v.estado, 'detectado');
    assert.equal(v.valor, 'main');
    assert.match(v.fonte, /origin\/main 2/);
  });

  test('versionamento-feature-nao-e-candidata', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'feat/muitos', 'main');
    for (const d of ['2025-06-01', '2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05']) mergear(raiz, 'feat/muitos', d);
    mergear(raiz, 'main', '2025-06-10');
    const f = fatosDe(raiz);
    assert.deepEqual(Object.keys(f.integracao), ['main']);
    const v = detectar(f)[3];
    assert.equal(v.estado, 'detectado');
    assert.equal(v.valor, 'main');
  });

  test('versionamento-head-e-integracao-mesma-ref', () => {
    const raiz = repoVazio('next');
    mergear(raiz, 'next', '2025-06-10');
    const f = fatosDe(raiz);
    assert.equal(f.originHead, 'next');
    assert.deepEqual(Object.keys(f.integracao), ['next'], 'contado uma vez');
    const v = detectar(f)[3];
    assert.equal(v.estado, 'detectado');
    assert.equal(v.valor, 'next');
    assert.deepEqual(v.candidatos, []);
  });

  test('versionamento-empate-com-head-ambiguo-e-head-primeiro', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'main', '2025-06-10');
    mergear(raiz, 'staging', '2025-06-11');
    const v = detectar(fatosDe(raiz))[3];
    assert.equal(v.estado, 'ambiguo');
    assert.deepEqual(v.candidatos, ['main', 'staging']);
    assert.equal(v.valor, 'main');
  });

  test('versionamento-sem-merges-detecta-head', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main');
    const v = detectar(fatosDe(raiz))[3];
    assert.equal(v.estado, 'detectado');
    assert.equal(v.valor, 'main');
    assert.match(v.fonte, /sem merges em 60 d/);
  });

  test('versionamento-janela-de-60-dias-e-squash', () => {
    const raiz = repoVazio('main');
    commitar(raiz, 'main', 'feat: fora da janela (#1)', '2025-04-30', '23:59:00'); // 61 d antes: fora
    commitar(raiz, 'main', 'feat: dentro (#2)', '2025-05-01', '12:00:00'); // 60 d antes: dentro
    commitar(raiz, 'main', 'chore: sem numero', '2025-06-01');
    commitar(raiz, 'main', 'fix: numero no meio (#3) e mais texto', '2025-06-02');
    mergear(raiz, 'main', '2025-06-03');
    const f = fatosDe(raiz);
    assert.equal(f.integracao.main, 2, 'só o squash (#2) e o merge de 2 pais; (#N) fora do fim e commit simples não contam');
    // hoje manda: um dia depois a janela perde o (#2)
    assert.equal(fatosDe(raiz, { hoje: '2025-07-02' }).integracao.main, 1);
  });

  test('versionamento-git-log-falha-nao-detectado', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'staging', '2025-06-10');
    const falha = (cmd, args) => (cmd === 'git' && args.includes('log') ? { rc: 128, stdout: '', stderr: 'fatal', motivo: null } : null);
    const f = fatosDe(raiz, { extra: falha });
    assert.equal(f.integracao, null);
    assert.equal(f.originHead, 'main');
    const v = detectar(f)[3];
    assert.equal(v.estado, 'nao_detectado');
    assert.equal(v.motivo, 'git log falhou');
    assert.equal(v.valor, null);
    // falha só no candidato de integração: ainda assim nada de "detectado HEAD" com dado parcial
    const so2 = (cmd, args) => (cmd === 'git' && args.includes('log') && args.at(-1).endsWith('/staging') ? { rc: 1, stdout: '', stderr: '', motivo: null } : null);
    assert.equal(detectar(fatosDe(raiz, { extra: so2 }))[3].estado, 'nao_detectado');
  });

  test('versionamento-sem-git-x-sem-origin-head', () => {
    const semGit = fatosDe(raizCom());
    assert.equal(semGit.originHead, null);
    assert.equal(semGit.motivos.originHead, 'sem git');
    const raiz = raizCom({ 'package.json': '{"name":"x"}' });
    G(raiz, ['init', '-q', '-b', 'main']);
    const semOrigin = fatosDe(raiz);
    assert.equal(semOrigin.originHead, null);
    assert.equal(semOrigin.motivos.originHead, 'sem origin/HEAD');
    assert.equal(detectar(semGit)[3].motivo, 'sem git');
    assert.equal(detectar(semOrigin)[3].motivo, 'sem origin/HEAD');
    assert.equal(detectar(semOrigin)[3].estado, 'nao_detectado');
  });

  test('branchpadrao-nome-de-branch-nao-resolve', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'staging', '2025-06-10');
    mergear(raiz, 'main', '2025-06-11');
    mergear(raiz, 'main', '2025-06-12');
    writeFileSync(join(raiz, 'harness.config.json'), '{\n  "versionamento": {\n    "branchPadrao": "main"\n  }\n}');
    const v = detectar(fatosDe(raiz))[3];
    assert.equal(v.estado, 'nao_detectado');
    assert.equal(v.valor, null);
    assert.match(v.motivo, /branchPadrao é nome de branch \(guarda\), não regex \(R20\)/);
    assert.deepEqual(v.candidatos, ['main', 'staging'], 'os candidatos de base ainda são calculados');
    assert.match(v.fonte, /harness\.config\.json:3/);
  });

  test('branchpadrao-regex-real-preservado', () => {
    const raiz = repoVazio('main');
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'staging', '2025-06-10');
    mergear(raiz, 'staging', '2025-06-11');
    mergear(raiz, 'main', '2025-06-12');
    const config = '{\n  "versionamento": {\n    "branchPadrao": "^(feat|fix)/[0-9a-z]{9,11}-.+$"\n  }\n}\n';
    writeFileSync(join(raiz, 'harness.config.json'), config);
    const v = detectar(fatosDe(raiz))[3];
    assert.equal(v.estado, 'ambiguo', 'o estado vem da base, não do branchPadrao com regex');
    assert.equal(v.valor, 'staging');
    assert.equal(readFileSync(join(raiz, 'harness.config.json'), 'utf8'), config, 'a regex do dono não é reescrita');
    // regex que o teste por amostra feat/ABC-1-1-x reprovaria, e regex que casa: o mesmo estado
    writeFileSync(join(raiz, 'harness.config.json'), '{"versionamento":{"branchPadrao":"^feat/[A-Z]+-\\\\d+-\\\\d+-.+$"}}');
    assert.equal(detectar(fatosDe(raiz))[3].estado, 'ambiguo');
    const so = repoVazio('main');
    writeFileSync(join(so, 'harness.config.json'), config);
    assert.equal(detectar(fatosDe(so))[3].estado, 'detectado');
  });

  test('hoje-invalido-lanca', () => {
    for (const h of ['ontem', '2025-13-40', '', 20250630]) assert.throws(() => coletarFatos(raizCom(), { rodar: rodarCom(CLICKUP), hoje: h }), RangeError, String(h));
  });
});

// ────────────────────────────────────────────────────────────── orquestração

describe('orquestracao', () => {
  test('orquestracao-config-detectada-com-linha', () => {
    const cfg = '{\n  "orquestracao": {\n    "paralelismo": {\n      "modo": "auto",\n      "simultaneos": 3,\n      "teto": 8\n    }\n  }\n}';
    const o = itensDe(raizCom({ 'harness.config.json': cfg })).orquestracao;
    assert.equal(o.estado, 'detectado');
    assert.deepEqual(o.valor, { simultaneos: 3, teto: 8 });
    assert.match(o.fonte, /simultaneos config:5/);
    assert.match(o.fonte, /teto config:6/);
  });

  test('orquestracao-ignora-carga', () => {
    const antes = { p: process.env.GABARITO_CAP_PESADOS, l: process.env.GABARITO_CAP_LOAD1, c: process.env.GABARITO_CAP_CORES };
    process.env.GABARITO_CAP_PESADOS = '10';
    process.env.GABARITO_CAP_LOAD1 = '60';
    process.env.GABARITO_CAP_CORES = '2';
    try {
      const o = itensDe(raizCom()).orquestracao;
      assert.equal(o.estado, 'detectado');
      assert.deepEqual(o.valor, { simultaneos: 2, teto: 4 });
      assert.equal(o.fonte, 'DEFAULTS de capacidade.mjs (sem config)');
      const sem = itensDe(raizCom({ 'harness.config.json': '{"perfil":"app"}' })).orquestracao;
      assert.deepEqual(sem.valor, { simultaneos: 2, teto: 4 });
      assert.equal(sem.fonte, 'DEFAULTS de capacidade.mjs (sem orquestracao.paralelismo)');
    } finally {
      for (const [k, v] of [['GABARITO_CAP_PESADOS', antes.p], ['GABARITO_CAP_LOAD1', antes.l], ['GABARITO_CAP_CORES', antes.c]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  // T6a MINOR-1 (review): a detecção usa a MESMA régua do runtime (`calcularSlots`), caso a caso.
  test('orquestracao-mesma-regua-do-calcularSlots', () => {
    const casos = [
      // [simultaneos, teto (JSON), simultaneos efetivo, teto efetivo]
      ['"3"', '8', 3, 8],
      ['0.5', '4', 1, 4],
      ['-1', '4', 1, 4],
      ['10', '4', 4, 4],
      ['3.9', '8', 3, 8],
      ['"abc"', '8', 2, 8],
      ['true', '8', 2, 8],
      ['null', '8', 2, 8],
      ['2', '"5"', 2, 5],
      ['2', '0.5', 1, 1],
      ['2', 'null', 2, 4],
    ];
    for (const [s, t, esperadoS, esperadoT] of casos) {
      const cfg = `{"orquestracao":{"paralelismo":{"simultaneos":${s},"teto":${t}}}}`;
      const o = itensDe(raizCom({ 'harness.config.json': cfg })).orquestracao;
      assert.deepEqual(o.valor, { simultaneos: esperadoS, teto: esperadoT }, `${s}/${t}`);
      const runtime = capacidade.calcularSlots(JSON.parse(cfg).orquestracao.paralelismo, {}, {});
      assert.equal(o.valor.simultaneos, runtime.slots, `${s}/${t}: igual ao calcularSlots`);
    }
  });

  test('orquestracao-fonte-diz-o-efetivo', () => {
    const cfg = '{\n  "orquestracao": {\n    "paralelismo": {\n      "simultaneos": 10,\n      "teto": 4\n    }\n  }\n}';
    assert.equal(itensDe(raizCom({ 'harness.config.json': cfg })).orquestracao.fonte, 'simultaneos config:4 (efetivo 4); teto config:5');
    const so = '{\n  "orquestracao": {\n    "paralelismo": {\n      "teto": 8\n    }\n  }\n}';
    const o = itensDe(raizCom({ 'harness.config.json': so })).orquestracao;
    assert.deepEqual(o.valor, { simultaneos: 2, teto: 8 });
    assert.equal(o.fonte, 'simultaneos DEFAULTS; teto config:4');
  });
});

// ────────────────────────────────────────────────────────────── costura: CLI → rodarReal → claude → git → detectar

describe('costura', () => {
  test('cli-detectar-atravessa-adaptador-real', () => {
    const bin = novoDir('gm-onb-bin-');
    const log = join(bin, 'argv');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\npwd > '${log}'\necho "$@" >> '${log}'\necho 'claude.ai ClickUp: https://x.test/mcp?t=SEGREDO - ✔ Connected'\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const raiz = fixtureComGit('completa', 'trunk');
    const r = spawnSync(process.execPath, [CLI, 'detectar', '--root', raiz, '--hoje', HOJE], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.equal(saida.ok, true);
    assert.deepEqual(saida.itens.map((i) => i.item), ORDEM_ITENS);
    assert.deepEqual(saida.itens.map((i) => i.estado), Array(5).fill('detectado'));
    assert.deepEqual(saida.itens[2].valor, { ferramenta: 'clickup', mcp: 'claude.ai ClickUp' });
    assert.equal(saida.itens[3].valor, 'trunk');
    assert.ok(!r.stdout.includes('SEGREDO'));
    const [cwd, args] = readFileSync(log, 'utf8').split('\n');
    assert.equal(args, 'mcp list');
    assert.match(cwd, /gm-onb-mcp-/);
    assert.ok(!cwd.startsWith(raiz), 'o claude real do adaptador roda fora do repo');
    const cmd = spawnSync(process.execPath, [CLI, 'nada'], { encoding: 'utf8' });
    assert.equal(cmd.status, 2);
    const ruim = spawnSync(process.execPath, [CLI, 'detectar', '--root', raiz, '--hoje', 'ontem'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(ruim.status, 1);
    assert.equal(JSON.parse(ruim.stdout).ok, false);
  });
});

// ────────────────────────────────────────────────────────────── T6b: perguntas, prévia e gravação

const FIXAS = { politica: 'sob_demanda', autonomia: false, perfil: 'padrao' };
const SEM_MCP = 'No MCP servers configured.\n';
const FUSO = 'America/Sao_Paulo';
const cfgDe = (raiz) => JSON.parse(readFileSync(join(raiz, 'harness.config.json'), 'utf8'));
const textoCfg = (raiz) => readFileSync(join(raiz, 'harness.config.json'), 'utf8');
const temCfg = (raiz) => existsSync(join(raiz, 'harness.config.json'));
const repoCom = (arquivos, trunk = 'main') => montarRepo(raizCom(arquivos), trunk);
const comConfig = (raiz, cfg) => {
  writeFileSync(join(raiz, 'harness.config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg, null, 2));
  return raiz;
};
const arquivoResp = (conteudo) => {
  const f = join(novoDir('gm-onb-resp-'), 'respostas.json');
  if (conteudo !== undefined) writeFileSync(f, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return f;
};
/** `gravar` pelo núcleo, com o `claude` falso e o git real. */
const gravarCom = (raiz, respostas, { claude = CLICKUP, previaClaude = claude, hoje = HOJE, fuso = FUSO, dryRun = false, bruto, semPrevia = false } = {}) => {
  // `_previa` = `itens` de `detectar` como o dono os viu (o `claude` da prévia pode diferir do do gravar).
  const com = semPrevia || respostas === null ? respostas : { ...respostas, _previa: JSON.parse(JSON.stringify(detectar(fatosDe(raiz, { claude: previaClaude })))) };
  return gravar(raiz, arquivoResp(bruto ?? com), { rodar: rodarCom(claude), hoje, fuso, dryRun });
};
const itensLista = (raiz, opts) => detectar(fatosDe(raiz, opts));
const idsDe = (ps) => ps.map((p) => p.id);
const existenteDe = (raiz, opts) => fatosDe(raiz, opts).configExistente;

describe('perguntas', () => {
  test('fixa-ordem-e-defaults', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const ps = perguntas(itensLista(raiz), existenteDe(raiz));
    assert.deepEqual(idsDe(ps), ['politica', 'autonomia', 'perfil']);
    assert.deepEqual(ps.map((p) => p.default), [FIXAS.politica, FIXAS.autonomia, FIXAS.perfil]);
    // D-T14-1: o default vem primeiro; as demais opções ficam na ordem original
    assert.deepEqual(ps[0].opcoes.map((o) => o.valor), ['sob_demanda', 'continua', 'janela']);
    assert.deepEqual(ps[1].opcoes.map((o) => o.valor), [false, true]);
    assert.deepEqual(ps[2].opcoes.map((o) => o.valor), ['padrao', 'economia', 'qualidade']);
    for (const p of ps) {
      assert.ok(p.texto.length > 0 && p.opcoes.every((o) => o.rotulo.length > 0), p.id);
      assert.ok(p.opcoes.some((o) => o.valor === p.default), `${p.id}: o default é uma das opções`);
      assert.equal('aviso' in p, false, `${p.id}: config ausente não gera aviso`);
    }
    assert.match(ps[0].texto, /Política de entrega/);
    assert.match(ps[1].texto, /Autonomia em produção/);
    assert.match(ps[2].texto, /Perfil de modelos/);
    assert.match(ps[0].opcoes.find((o) => o.valor === 'sob_demanda').rotulo, /PR de release/);
    assert.match(ps[0].opcoes.find((o) => o.valor === 'janela').rotulo, /janela de horário/);
    assert.match(ps[1].opcoes.find((o) => o.valor === true).rotulo, /^sim/);
    // o rótulo de cada perfil vem de PERFIS_MODELO, não de outra tabela
    for (const o of ps[2].opcoes) assert.ok(o.rotulo.includes(PERFIS_MODELO[o.valor].revisor_final.modelo), o.rotulo);
  });

  test('perguntas-default-primeiro', () => {
    // Enter no AskUserQuestion escolhe a 1ª opção: ela TEM de ser o default (autonomia `sim` liberaria deploy sem pedido)
    const raiz = fixtureComGit('completa', 'trunk');
    const sem = perguntas(itensLista(raiz), existenteDe(raiz));
    assert.deepEqual(sem.map((p) => p.opcoes[0].valor), ['sob_demanda', false, 'padrao']);
    for (const p of sem) assert.equal(p.opcoes[0].valor, p.default, p.id);
    const cont = perguntas(itensLista(raiz), { entrega: { politica: 'continua' }, orquestracao: { perfil: 'qualidade' } });
    assert.deepEqual(cont.map((p) => p.opcoes[0].valor), ['continua', true, 'qualidade']);
    assert.deepEqual(cont[0].opcoes.map((o) => o.valor), ['continua', 'janela', 'sob_demanda'], 'o resto na ordem original');
    // condicionais: o default também vai primeiro
    const wf = (nome) => `name: deploy-${nome}\non:\n  push:\n    branches: [main]\njobs:\n  d:\n    environment: ${nome}\n`;
    const r2 = repoCom({ 'package.json': '{"name":"x"}', '.github/workflows/a.yml': wf('staging'), '.github/workflows/b.yml': wf('homolog') });
    const amb = perguntas(itensLista(r2), { onboarding: { fatos: { ambientes: { producao: 'homolog', outros: ['staging'] } } } }).find((q) => q.id === 'ambientes');
    assert.deepEqual(amb.opcoes.map((o) => o.valor), ['homolog', 'staging']);
    assert.equal(amb.default, 'homolog');
  });

  test('trocar-preserva-resposta-condicional', () => {
    // versionamento ambíguo: 2ª execução (trocar perfil) não pode voltar a `candidatos[0]` e regravar entrega.base
    const raiz = repoCom({ 'package.json': '{"name":"x"}', '.github/workflows/d.yml': 'name: deploy-producao\non:\n  push:\n    branches: [main]\njobs:\n  d:\n    environment: producao\n' });
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'main', '2025-06-10');
    for (const d of ['2025-06-05', '2025-06-12', '2025-06-20']) mergear(raiz, 'staging', d);
    assert.equal(perguntas(itensLista(raiz), null).find((q) => q.id === 'versionamento').default, 'staging', 'sem resposta gravada: candidatos[0]');
    assert.equal(gravarCom(raiz, { ...FIXAS, versionamento: 'main' }).ok, true);
    assert.equal(cfgDe(raiz).entrega.base, 'main');
    const ps = perguntas(itensLista(raiz), existenteDe(raiz));
    const v = ps.find((q) => q.id === 'versionamento');
    assert.equal(v.default, 'main', 'o valor gravado vira o default');
    assert.equal(v.opcoes[0].valor, 'main');
    const resp = Object.fromEntries(ps.map((p) => [p.id, p.default]));
    const r = gravarCom(raiz, { ...resp, perfil: 'qualidade' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(cfgDe(raiz).entrega.base, 'main', 'trocar perfil não regrava entrega.base');
    assert.equal(cfgDe(raiz).orquestracao.perfil, 'qualidade');
    // valor gravado que não está entre os candidatos não vence a detecção
    assert.equal(perguntas(itensLista(raiz), { entrega: { base: 'inexistente' } }).find((q) => q.id === 'versionamento').default, 'staging');
    // ambientes
    const wf = (nome) => `name: deploy-${nome}\non:\n  push:\n    branches: [main]\njobs:\n  d:\n    environment: ${nome}\n`;
    const r2 = repoCom({ 'package.json': '{"name":"x"}', '.github/workflows/a.yml': wf('staging'), '.github/workflows/b.yml': wf('homolog') });
    assert.equal(gravarCom(r2, { ...FIXAS, ambientes: 'homolog' }).ok, true);
    const a = perguntas(itensLista(r2), existenteDe(r2)).find((q) => q.id === 'ambientes');
    assert.equal(a.default, 'homolog');
    // tipo_repo: monorepo respondido `app` volta `app`; sem onboarding gravado, nada muda
    const mono = fixtureComGit('monorepo', 'main');
    const tipo = (cfg) => perguntas(itensLista(mono, { claude: SEM_MCP }), cfg).find((q) => q.id === 'tipo_repo');
    assert.equal(tipo({ onboarding: { resolvidoEm: HOJE } }).default, 'app');
    assert.equal(tipo(null).default, 'app');
  });

  test('trocar-respeita-nao-detectado', () => {
    // MAJOR-1 (r2): "deixar não detectado" (null) é resposta. "trocar perfil" com os demais no default não a desfaz.
    const opts = { claude: SEM_MCP };
    const raiz = repoCom({ 'package.json': '{"name":"x"}' });
    const ps0 = perguntas(itensLista(raiz, opts), null);
    const defaults0 = Object.fromEntries(ps0.map((p) => [p.id, p.default]));
    const antes = ps0.find((q) => q.id === 'planejamento');
    assert.deepEqual(antes.opcoes.map((o) => o.valor), ['arquivos', null], 'sem resposta gravada: arquivos primeiro');
    assert.equal(antes.default, 'arquivos');
    const r1 = gravarCom(raiz, { ...defaults0, planejamento: null }, opts);
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.ok(cfgDe(raiz).onboarding.naoDetectado.includes('planejamento'), 'a recusa fica em onboarding.naoDetectado');
    assert.equal(cfgDe(raiz).fluxo?.ferramenta, undefined, 'recusado: nada gravado em fluxo.ferramenta');
    const ps = perguntas(itensLista(raiz, opts), existenteDe(raiz, opts));
    const pl = ps.find((q) => q.id === 'planejamento');
    assert.equal(pl.default, null, 'o default é a recusa anterior');
    assert.equal(pl.opcoes[0].valor, null, 'default primeiro: Enter mantém a recusa');
    assert.deepEqual(pl.opcoes.map((o) => o.valor), [null, 'arquivos']);
    const resp = Object.fromEntries(ps.map((p) => [p.id, p.default]));
    const r2 = gravarCom(raiz, { ...resp, perfil: 'qualidade' }, opts);
    assert.equal(r2.ok, true, JSON.stringify(r2));
    const c = cfgDe(raiz);
    assert.equal(c.orquestracao.perfil, 'qualidade', 'trocar perfil gravou o perfil');
    assert.equal(c.fluxo?.ferramenta, undefined, 'trocar perfil não regrava fluxo.ferramenta');
    assert.ok(c.onboarding.naoDetectado.includes('planejamento'), 'planejamento continua não detectado');
    assert.ok(r2.naoDetectado.includes('planejamento'));
    // quem tinha escolhido `arquivos` continua com `arquivos`; só a recusa vira null
    const raiz2 = repoCom({ 'package.json': '{"name":"x"}' });
    assert.equal(gravarCom(raiz2, { ...defaults0, planejamento: 'arquivos' }, opts).ok, true);
    const pl2 = perguntas(itensLista(raiz2, opts), existenteDe(raiz2, opts)).find((q) => q.id === 'planejamento');
    assert.equal(pl2?.default ?? 'arquivos', 'arquivos');
    // naoDetectado só de OUTRO item não muda o default de planejamento
    assert.equal(perguntas(itensLista(repoCom({ 'package.json': '{"name":"x"}' }), opts), { onboarding: { naoDetectado: ['ambientes'] } }).find((q) => q.id === 'planejamento').default, 'arquivos');
  });

  test('default-de-config-110', () => {
    const ps = perguntas(itensLista(repoVazio()), { entrega: { politica: 'janela' }, orquestracao: { perfil: 'qualidade' } });
    assert.deepEqual(ps.slice(0, 3).map((p) => p.default), ['janela', true, 'qualidade']);
    const ps2 = perguntas(itensLista(repoVazio()), { entrega: { politica: 'continua', autonomia: true }, orquestracao: { perfil: 'economia' } });
    assert.deepEqual(ps2.slice(0, 3).map((p) => p.default), ['continua', true, 'economia']);
  });

  test('autonomia-default-sim-com-continua-legada', () => {
    const it = itensLista(repoVazio());
    const aut = (entrega) => perguntas(it, { entrega })[1].default;
    assert.equal(aut({ politica: 'continua' }), true, 'continua legada sem autonomia ⇒ sim');
    assert.equal(aut({ politica: 'janela' }), true, 'janela legada sem autonomia ⇒ sim');
    assert.equal(aut({ politica: 'continua', autonomia: false }), false, 'o não explícito vale');
    assert.equal(aut({ politica: 'sob_demanda' }), false);
    assert.equal(aut({ politica: 'sob_demanda', autonomia: true }), true);
    assert.equal(aut(undefined), false);
  });

  test('rotulo-nao-com-continua', () => {
    const it = itensLista(repoVazio());
    const nao = (entrega) => perguntas(it, { entrega })[1].opcoes.find((o) => o.valor === false).rotulo;
    const FRASE = 'a entrega vira sob demanda: PR de release, você faz merge e deploy';
    assert.equal(nao({ politica: 'continua' }), FRASE);
    assert.equal(nao({ politica: 'janela' }), FRASE);
    assert.notEqual(nao({ politica: 'sob_demanda' }), FRASE);
    assert.notEqual(nao(undefined), FRASE);
  });

  test('default-invalido-na-config-cai-no-produto', () => {
    const it = itensLista(repoVazio());
    const ruim = { entrega: { politica: 'rapida', autonomia: 'sim' }, orquestracao: { perfil: 'turbo' } };
    const ps = perguntas(it, ruim);
    assert.deepEqual(ps.slice(0, 3).map((p) => p.default), ['sob_demanda', false, 'padrao']);
    assert.match(ps[0].aviso, /config tinha "rapida" inválido/);
    assert.match(ps[1].aviso, /config tinha "sim" inválido/);
    assert.match(ps[2].aviso, /config tinha "turbo" inválido/);
    const p = previa(it, ps, { fuso: FUSO });
    for (const v of ['"rapida"', '"sim"', '"turbo"']) assert.ok(p.includes(`config tinha ${v} inválido`), `a prévia cita ${v}`);
    // config sã: nenhum aviso em lugar nenhum
    const sa = perguntas(it, { entrega: { politica: 'continua', autonomia: true }, orquestracao: { perfil: 'qualidade' } });
    assert.ok(sa.every((q) => !('aviso' in q)));
    assert.ok(!previa(it, sa, { fuso: FUSO }).includes('inválido'));
  });

  test('config-corrompida-nao-vira-default-silencioso', () => {
    const it = itensLista(repoVazio());
    // `{erro}` é o formato de configExistente corrompido: perguntas não tira default de dado ilegível
    assert.deepEqual(perguntas(it, { erro: 'x' }).slice(0, 3).map((p) => p.default), ['sob_demanda', false, 'padrao']);
    assert.deepEqual(perguntas(it, null).slice(0, 3).map((p) => p.default), ['sob_demanda', false, 'padrao']);
  });

  test('fixture-completa-tudo-detectado-3-perguntas', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    comConfig(raiz, { perfil: 'app', $schema: 'x' });
    const ps = perguntas(itensLista(raiz), existenteDe(raiz));
    assert.equal(ps.length, 3, 'tudo detectado: só as 3 fixas');
    const r = gravarCom(raiz, FIXAS);
    assert.equal(r.ok, true, JSON.stringify(r));
    const cfg = cfgDe(raiz);
    assert.equal(cfg.entrega.base, 'trunk');
    assert.equal(cfg.versionamento.branchPadrao, undefined, 'D-1: branchPadrao nunca é escrito');
    assert.equal('branchPadrao' in cfg.versionamento, false);
    assert.equal(cfg.versionamento.resolvidoEm, HOJE);
    assert.deepEqual(cfg.entrega, { politica: 'sob_demanda', autonomia: false, base: 'trunk' });
    assert.equal(cfg.perfil, 'app', 'chaves do dono ficam');
    assert.equal(cfg.orquestracao.perfil, 'padrao', 'grava a escolhida, inclusive padrao (o doctor compara com o escolhido)');
    assert.equal(cfg.$schema, 'x');
    assert.deepEqual(r.naoDetectado, []);
    assert.equal('dryRun' in r, false);
    assert.deepEqual(cfg.fluxo, { ferramenta: 'clickup', mcp: 'claude.ai ClickUp', resolvidoEm: HOJE });
  });

  test('fixture-monorepo-5-perguntas', () => {
    const raiz = fixtureComGit('monorepo', 'main');
    const it = itensLista(raiz, { claude: SEM_MCP });
    const ps = perguntas(it, existenteDe(raiz, { claude: SEM_MCP }));
    assert.deepEqual(idsDe(ps), ['politica', 'autonomia', 'perfil', 'tipo_repo', 'ambientes']);
    assert.equal(ps.length, 5, 'teto 5');
    const tipo = ps[3];
    assert.deepEqual(tipo.opcoes.map((o) => o.valor), ['app', 'repo-sem-app']);
    assert.equal(tipo.default, 'app');
    const fonteTipo = it.find((i) => i.item === 'tipo_repo').fonte;
    assert.ok(tipo.texto.startsWith('tipo_repo:') && tipo.texto.includes(fonteTipo), tipo.texto);
    assert.deepEqual(tipo.opcoes.map((o) => o.rotulo), ['app', 'repo-sem-app']);
    const r = gravarCom(raiz, { ...FIXAS, tipo_repo: 'app', ambientes: null }, { claude: SEM_MCP });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.naoDetectado, ['ambientes', 'planejamento'], 'o 3º fato (planejamento) fica não detectado');
    const cfg = cfgDe(raiz);
    assert.equal(cfg.fluxo.ferramenta, undefined, 'sem valor gravado para o 3º fato');
    assert.deepEqual(cfg.fluxo, { resolvidoEm: HOJE });
    assert.deepEqual(cfg.onboarding.naoDetectado, ['ambientes', 'planejamento']);
    assert.equal('fatos' in cfg.onboarding, false, 'ambientes não resolvido não vira fato');
    assert.equal('perfil' in cfg, false);
  });

  test('pergunta-nao-detectado-sem-candidato', () => {
    const raiz = repoVazio('main'); // sem CI e sem conector
    const it = itensLista(raiz, { claude: SEM_MCP });
    const ps = perguntas(it, null);
    assert.deepEqual(idsDe(ps), ['politica', 'autonomia', 'perfil', 'ambientes', 'planejamento']);
    const amb = ps[3];
    assert.deepEqual(amb.opcoes, [{ valor: null, rotulo: 'deixar não detectado (trocar ambientes depois)' }]);
    assert.equal(amb.default, null);
    const pla = ps[4];
    assert.deepEqual(pla.opcoes.map((o) => o.valor), ['arquivos', null], 'planejamento sem candidato ⇒ arquivos (regra da 1.1)');
    assert.equal(pla.opcoes[1].rotulo, 'deixar não detectado (trocar planejamento depois)');
    assert.equal(pla.default, 'arquivos');
    // resposta `null` ⇒ naoDetectado e nada gravado; 'arquivos' ⇒ fluxo.ferramenta
    const a = gravarCom(raiz, { ...FIXAS, ambientes: null, planejamento: null }, { claude: SEM_MCP });
    assert.deepEqual(a.naoDetectado, ['ambientes', 'planejamento']);
    assert.equal(cfgDe(raiz).fluxo.ferramenta, undefined);
    const b = gravarCom(raiz, { ...FIXAS, ambientes: null, planejamento: 'arquivos' }, { claude: SEM_MCP });
    assert.deepEqual(b.naoDetectado, ['ambientes']);
    assert.equal(cfgDe(raiz).fluxo.ferramenta, 'arquivos');
  });

  test('planejamento-nao-detectado-com-candidatos-do-repo', () => {
    // `claude mcp list` falhou, mas o .mcp.json do repo sabe a ferramenta: candidatos = ela + null
    const raiz = repoCom({ 'package.json': '{"name":"x"}', '.mcp.json': '{"mcpServers":{"linear":{"command":"x"}}}', '.github/workflows/d.yml': 'name: deploy\non:\n  push:\n    branches: [main]\n' });
    const it = itensLista(raiz, { claude: { rc: 1, stdout: '', stderr: '', motivo: null } });
    const p = perguntas(it, null).find((q) => q.id === 'planejamento');
    assert.deepEqual(p.opcoes.map((o) => o.valor), ['linear', null]);
    assert.equal(p.default, 'linear');
  });
});

describe('previa', () => {
  test('previa-todo-item-tem-fonte', () => {
    for (const [nome, trunk, claude] of [['completa', 'trunk', CLICKUP], ['monorepo', 'main', SEM_MCP]]) {
      const raiz = fixtureComGit(nome, trunk);
      const it = itensLista(raiz, { claude });
      const texto = previa(it, perguntas(it, null), { fuso: FUSO });
      const linhas = texto.split('\n');
      for (const i of it) {
        const linha = linhas.find((l) => l.startsWith(`- ${i.item}:`));
        assert.ok(linha, `${nome}/${i.item}: sem linha`);
        assert.ok(linha.includes(i.fonte), `${nome}/${i.item}: a linha não cita a fonte (${i.fonte})`);
        assert.ok(linha.includes(i.estado), `${nome}/${i.item}: a linha não diz o estado`);
      }
      assert.ok(texto.startsWith('detectei:'));
      assert.match(texto, /trocar <item>|trocar tipo_repo/);
    }
  });

  test('previa-ambientes-e-informativo', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const it = itensLista(raiz);
    const linha = previa(it, perguntas(it, null), { fuso: FUSO }).split('\n').find((l) => l.startsWith('- ambientes:'));
    assert.ok(linha.includes('ambientes: informativo; a guarda usa guarda.ambientes'), linha);
    const outra = previa(it, perguntas(it, null), { fuso: FUSO }).split('\n').find((l) => l.startsWith('- tipo_repo:'));
    assert.ok(!outra.includes('informativo'));
  });

  test('previa-mostra-efetiva', () => {
    const it = itensLista(repoVazio());
    const com = previa(it, perguntas(it, { entrega: { politica: 'continua', autonomia: false } }), { fuso: FUSO });
    assert.match(com, /política efetiva: sob_demanda/);
    assert.match(com, /continua/);
    const igual = previa(it, perguntas(it, { entrega: { politica: 'continua', autonomia: true } }), { fuso: FUSO });
    assert.ok(!igual.includes('política efetiva'), 'sem divergência, sem a linha');
    const nada = previa(it, perguntas(it, null), { fuso: FUSO });
    assert.ok(!nada.includes('política efetiva'));
    // as 3 decisões com default, e a janela padrão com o fuso recebido
    assert.match(nada, /política de entrega: sob_demanda/);
    assert.match(nada, /autonomia em produção: não/);
    assert.match(nada, /perfil de modelos: padrao/);
    assert.ok(nada.includes(FUSO) && nada.includes('09:00') && nada.includes('17:00'));
  });

  test('previa-fato-acima-do-teto-fica-nao-detectado', () => {
    const raiz = fixtureComGit('monorepo', 'main');
    const it = itensLista(raiz, { claude: SEM_MCP });
    const texto = previa(it, perguntas(it, null), { fuso: FUSO });
    assert.match(texto, /- planejamento: .*fica nao_detectado \(acima do teto de 5 perguntas\)/);
    assert.ok(!/- ambientes: .*acima do teto/.test(texto));
  });
});

describe('gravar', () => {
  test('gravar-dry-run-nao-escreve', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const antes = readdirSync(raiz).sort();
    const r = gravarCom(raiz, FIXAS, { dryRun: true });
    assert.equal(r.ok, true);
    assert.ok(r.diff.length > 0 && r.diff.join('\n').includes('"base":"trunk"'), 'o diff mostra o que gravaria');
    assert.equal(r.dryRun, true);
    assert.equal(temCfg(raiz), false, '0 bytes escritos');
    assert.deepEqual(readdirSync(raiz).sort(), antes);
    // com config existente, os bytes ficam iguais
    comConfig(raiz, '{"fluxo": {"x":   1}}\n');
    const b = textoCfg(raiz);
    gravarCom(raiz, FIXAS, { dryRun: true });
    assert.equal(textoCfg(raiz), b);
  });

  test('gravar-resolvidoEm-uma-execucao', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const r = gravarCom(raiz, { ...FIXAS, perfil: 'economia' }, { hoje: '2025-06-30' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const cfg = cfgDe(raiz);
    const datas = [cfg.fluxo.resolvidoEm, cfg.versionamento.resolvidoEm, cfg.orquestracao.modelo.resolvidoEm, cfg.onboarding.resolvidoEm];
    assert.deepEqual(datas, Array(4).fill('2025-06-30'));
    assert.equal(cfg.orquestracao.modelo.alias, 'opus', 'revisor_final do perfil economia');
    assert.equal(cfg.orquestracao.modelo.politica, 'mais-potente');
    assert.equal(cfg.orquestracao.modelo.validadeDias, 90);
    assert.equal(cfg.orquestracao.perfil, 'economia');
    // outra data ⇒ as 4 mudam juntas
    const r2 = gravarCom(raiz, { ...FIXAS, perfil: 'qualidade' }, { hoje: '2025-07-01' });
    assert.equal(r2.ok, true);
    const c2 = cfgDe(raiz);
    assert.deepEqual([c2.fluxo.resolvidoEm, c2.versionamento.resolvidoEm, c2.orquestracao.modelo.resolvidoEm, c2.onboarding.resolvidoEm], Array(4).fill('2025-07-01'));
    assert.equal(c2.orquestracao.modelo.alias, 'fable');
  });

  test('gravar-alias-explicito-e-modelo-existente-ficam', () => {
    const raiz = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { modelos: { revisor_final: 'claude-opus-9' }, modelo: { politica: 'fixo', validadeDias: 30 } } });
    const r = gravarCom(raiz, { ...FIXAS, perfil: 'qualidade' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const m = cfgDe(raiz).orquestracao;
    assert.equal(m.modelo.alias, 'opus', 'o explícito vence o perfil (resolverModelo)');
    assert.equal(m.modelo.politica, 'fixo');
    assert.equal(m.modelo.validadeDias, 30);
    assert.deepEqual(m.modelos, { revisor_final: 'claude-opus-9' });
  });

  test('gravar-cartao-sai-do-sem-onboarding', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const plugin = raizCom({ '.claude-plugin/plugin.json': '{"name":"gabarito-mestre","version":"2.0.0"}' });
    const opts = { agora: '2025-06-30T12:00:00Z', installedPlugins: join(novoDir(), 'instalados.json') };
    assert.equal(coletarCartao(raiz, plugin, opts).semOnboarding, true, 'antes do gravar, sem onboarding');
    const r = gravarCom(raiz, FIXAS);
    assert.equal(r.ok, true, JSON.stringify(r));
    const depois = coletarCartao(raiz, plugin, opts);
    assert.equal(depois.semOnboarding, false);
    assert.equal(depois.config.fluxo.ferramenta, 'clickup');
  });

  test('gravar-nunca-toca-guarda', () => {
    const guarda = { ambientes: { prod: { branches: ['main'], rotulo: 'x' } }, outra: [1, 2] };
    const raiz = comConfig(fixtureComGit('completa', 'trunk'), { guarda, perfil: 'app' });
    const antes = JSON.stringify(cfgDe(raiz).guarda);
    const r = gravarCom(raiz, FIXAS);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(JSON.stringify(cfgDe(raiz).guarda), antes, 'guarda igual pelo objeto');
    assert.deepEqual(cfgDe(raiz).onboarding.fatos.ambientes, { producao: 'production', outros: ['staging'] }, 'ambientes só informativo');
    // sem guarda no config, nenhuma é criada
    const so = fixtureComGit('completa', 'trunk');
    gravarCom(so, FIXAS);
    assert.equal('guarda' in cfgDe(so), false);
    assert.ok(!JSON.stringify(cfgDe(so)).includes('guarda'));
  });

  test('gravar-perfil-so-repo-sem-app', () => {
    const raiz = fixtureComGit('monorepo', 'main');
    const r = gravarCom(raiz, { ...FIXAS, tipo_repo: 'repo-sem-app', ambientes: null }, { claude: SEM_MCP });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(cfgDe(raiz).perfil, 'repo-sem-app');
    assert.ok(!r.naoDetectado.includes('tipo_repo'));
  });

  test('gravar-app-nao-grava-perfil', () => {
    const raiz = fixtureComGit('monorepo', 'main');
    const r = gravarCom(raiz, { ...FIXAS, tipo_repo: 'app', ambientes: null }, { claude: SEM_MCP });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal('perfil' in cfgDe(raiz), false, 'nada na raiz para `app`');
    assert.ok(!r.naoDetectado.includes('tipo_repo'));
    // tipo_repo detectado como app (sem monorepo) também não grava
    const so = fixtureComGit('completa', 'trunk');
    gravarCom(so, FIXAS);
    assert.equal('perfil' in cfgDe(so), false);
  });

  test('gravar-respostas-ausente-x-corrompidas', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const ausente = gravar(raiz, join(novoDir(), 'nao-existe.json'), { rodar: rodarCom(CLICKUP), hoje: HOJE, fuso: FUSO });
    assert.deepEqual([ausente.ok, ausente.erro], [false, 'respostas_ausentes']);
    const semFlag = gravar(raiz, undefined, { rodar: rodarCom(CLICKUP), hoje: HOJE, fuso: FUSO });
    assert.equal(semFlag.erro, 'respostas_ausentes');
    for (const torto of ['', 'não é json', '[1,2]', '"x"', 'null', '42', '{"politica":']) {
      const r = gravarCom(raiz, null, { bruto: torto });
      assert.deepEqual([r.ok, r.erro], [false, 'respostas_invalidas'], JSON.stringify(torto));
    }
    assert.notEqual(ausente.erro, 'respostas_invalidas');
    assert.ok(typeof ausente.motivo === 'string' && typeof gravarCom(raiz, null, { bruto: '[1]' }).motivo === 'string');
    assert.equal(temCfg(raiz), false, 'nada escrito em nenhum caso');
  });

  test('gravar-respostas-fora-das-opcoes', () => {
    const raiz = fixtureComGit('monorepo', 'main');
    const boas = { ...FIXAS, tipo_repo: 'app', ambientes: null };
    const ruins = [
      { politica: 'rapida' }, { politica: null }, { politica: 1 }, { perfil: 'turbo' }, { perfil: 'Padrao' },
      { autonomia: 'sim' }, { autonomia: 'não' }, { autonomia: 'true' }, { autonomia: 'false' }, { autonomia: 1 }, { autonomia: null }, { tipo_repo: 'outro' }, { ambientes: 'production' },
    ];
    for (const r of ruins) {
      const out = gravarCom(raiz, { ...boas, ...r }, { claude: SEM_MCP });
      assert.deepEqual([out.ok, out.erro], [false, 'resposta_fora_das_opcoes'], JSON.stringify(r));
      assert.ok(out.motivo.includes(Object.keys(r)[0]), 'o motivo cita a pergunta');
    }
    assert.equal(temCfg(raiz), false);
    assert.equal(gravarCom(raiz, boas, { claude: SEM_MCP }).ok, true, 'as boas passam');
  });

  test('gravar-deteccao-mudou-nao-escreve', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    // (1) resposta para fato detectado
    const a = gravarCom(raiz, { ...FIXAS, versionamento: 'main' });
    assert.deepEqual([a.ok, a.erro], [false, 'deteccao_mudou']);
    assert.match(a.motivo, /versionamento/);
    const b = gravarCom(raiz, { ...FIXAS, planejamento: 'jira' });
    assert.equal(b.erro, 'deteccao_mudou');
    // (2) `claude mcp list` falha só no gravar: o planejamento passa a ser pergunta e falta a resposta
    const c = gravarCom(raiz, FIXAS, { claude: { rc: 1, stdout: '', stderr: '', motivo: null } });
    assert.deepEqual([c.ok, c.erro], [false, 'deteccao_mudou']);
    assert.match(c.motivo, /planejamento/);
    assert.equal(temCfg(raiz), false, 'nada escrito');
    // (3) pergunta sem resposta (fixa e condicional)
    const mono = fixtureComGit('monorepo', 'main');
    const d = gravarCom(mono, { ...FIXAS, tipo_repo: 'app' }, { claude: SEM_MCP });
    assert.deepEqual([d.ok, d.erro], [false, 'deteccao_mudou']);
    assert.match(d.motivo, /ambientes/);
    const { perfil: _, ...semPerfil } = FIXAS;
    const e = gravarCom(raiz, semPerfil);
    assert.equal(e.erro, 'deteccao_mudou');
    assert.match(e.motivo, /perfil/);
    assert.equal(temCfg(mono), false);
  });

  test('gravar-deteccao-mudou-acima-do-teto-nao-escreve', () => {
    // monorepo: tipo_repo ambiguo + ambientes nao_detectado; com ClickUp o planejamento é detectado (o 3º fato aberto, se falhar, cai acima do teto)
    const falha = { rc: 1, stdout: '', stderr: '', motivo: null };
    const raiz = fixtureComGit('monorepo', 'main');
    const previaPs = perguntas(itensLista(raiz), existenteDe(raiz));
    assert.deepEqual(idsDe(previaPs), ['politica', 'autonomia', 'perfil', 'tipo_repo', 'ambientes']);
    assert.equal(itensDe(raiz).planejamento.estado, 'detectado', 'a prévia viu o clickup');
    const r = gravarCom(raiz, { ...FIXAS, tipo_repo: 'app', ambientes: null }, { claude: falha, previaClaude: CLICKUP });
    // as perguntas são as mesmas (planejamento caiu acima do teto), mas o fato mudou
    assert.deepEqual(idsDe(perguntas(itensLista(raiz, { claude: falha }), existenteDe(raiz))), idsDe(previaPs));
    assert.deepEqual([r.ok, r.erro], [false, 'deteccao_mudou']);
    assert.match(r.motivo, /planejamento/);
    assert.equal(temCfg(raiz), false, 'nada escrito');
    // controle: a mesma resposta com a prévia igual grava (o claude que falha no gravar é o único defeito)
    const igual = gravarCom(raiz, { ...FIXAS, tipo_repo: 'app', ambientes: null }, { claude: falha, previaClaude: falha });
    assert.equal(igual.ok, true);
    // outros fatos: versionamento detectado que vira outro valor acima do teto, e valor (não só estado) que muda
    const outro = fixtureComGit('monorepo', 'main');
    const v = gravarCom(outro, { ...FIXAS, tipo_repo: 'app', ambientes: null }, { claude: SEM_MCP, previaClaude: CLICKUP });
    assert.deepEqual([v.ok, v.erro], [false, 'deteccao_mudou']);
    assert.equal(temCfg(outro), false);
  });

  test('gravar-deteccao-mudou-valor-abaixo-do-teto', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    // mesmo estado (detectado), outro valor: o planejamento era clickup, agora é outro MCP
    const outro = 'claude.ai Linear: https://mcp.linear.app/mcp - ✔ Connected\n';
    assert.equal(itensDe(raiz, { claude: outro }).planejamento.estado, 'detectado');
    assert.notDeepEqual(itensDe(raiz, { claude: outro }).planejamento.valor, itensDe(raiz).planejamento.valor);
    const r = gravarCom(raiz, FIXAS, { claude: outro, previaClaude: CLICKUP });
    assert.deepEqual([r.ok, r.erro], [false, 'deteccao_mudou']);
    assert.match(r.motivo, /planejamento/);
    assert.equal(temCfg(raiz), false);
    // mesmo valor, outro estado (a prévia dizia ambiguo, hoje é detectado): também é mudança
    const viu = JSON.parse(JSON.stringify(detectar(fatosDe(raiz))));
    viu.find((i) => i.item === 'versionamento').estado = 'ambiguo';
    const e = gravarCom(raiz, { ...FIXAS, _previa: viu }, { semPrevia: true });
    assert.deepEqual([e.ok, e.erro], [false, 'deteccao_mudou']);
    assert.match(e.motivo, /versionamento/);
    // prévia ausente ou torta: falha fechado, distinta
    const sem = gravarCom(raiz, FIXAS, { semPrevia: true });
    assert.deepEqual([sem.ok, sem.erro], [false, 'previa_ausente']);
    const torta = gravarCom(raiz, { ...FIXAS, _previa: [1] }, { semPrevia: true });
    assert.deepEqual([torta.ok, torta.erro], [false, 'respostas_invalidas']);
    assert.equal(temCfg(raiz), false);
  });

  test('gravar-escreve-1-vez-por-arquivo', () => {
    // conta as escritas de verdade: 1 write do tmp + 1 rename para o destino (S: "1 escrita por arquivo, tmp + rename")
    const fs = require('node:fs');
    const { syncBuiltinESMExports } = require('node:module');
    const escritas = [];
    const renames = [];
    const w = fs.writeFileSync;
    const rn = fs.renameSync;
    const raiz = fixtureComGit('completa', 'trunk');
    const respostas = arquivoResp({ ...FIXAS, _previa: JSON.parse(JSON.stringify(detectar(fatosDe(raiz)))) });
    fs.writeFileSync = (c, ...r) => { if (String(c).startsWith(raiz)) escritas.push(String(c)); return w(c, ...r); };
    fs.renameSync = (a, b) => { if (String(a).startsWith(raiz)) renames.push([String(a), String(b)]); return rn(a, b); };
    syncBuiltinESMExports();
    let r;
    try {
      r = gravar(raiz, respostas, { rodar: rodarCom(CLICKUP), hoje: HOJE, fuso: FUSO });
    } finally {
      fs.writeFileSync = w;
      fs.renameSync = rn;
      syncBuiltinESMExports();
    }
    assert.equal(r.ok, true);
    assert.equal(escritas.length, 1, `1 escrita, houve: ${escritas.join(' | ')}`);
    assert.equal(renames.length, 1);
    assert.equal(renames[0][1], join(raiz, 'harness.config.json'));
    assert.equal(escritas[0], renames[0][0], 'o rename promove o tmp escrito');
    assert.ok(!existsSync(renames[0][0]), 'tmp não sobra');
    assert.equal(cfgDe(raiz).entrega.politica, 'sob_demanda');
  });

  test('detectar-orquestracao-ignora-env-do-ambiente', () => {
    // GABARITO_PARALELISMO no shell do dono nunca vira o "valor da config" na prévia
    const cfg = '{"orquestracao":{"paralelismo":{"simultaneos":3,"teto":6}}}';
    const antes = process.env.GABARITO_PARALELISMO;
    process.env.GABARITO_PARALELISMO = '1';
    try {
      const o = itensDe(raizCom({ 'harness.config.json': cfg })).orquestracao;
      assert.deepEqual(o.valor, { simultaneos: 3, teto: 6 });
      assert.equal(capacidade.calcularSlots({ simultaneos: 3, teto: 6 }, {}).slots, 1, 'controle: o runtime com o env do ambiente daria 1');
    } finally {
      if (antes === undefined) delete process.env.GABARITO_PARALELISMO;
      else process.env.GABARITO_PARALELISMO = antes;
    }
  });

  test('gravar-config-corrompida-nao-escreve', () => {
    for (const ruim of ['{"entrega":', '[]', '"x"', '{"a":1}}']) {
      const raiz = comConfig(fixtureComGit('completa', 'trunk'), ruim);
      const antes = textoCfg(raiz);
      const r = gravarCom(raiz, FIXAS);
      assert.deepEqual([r.ok, r.erro], [false, 'config_invalida'], ruim);
      assert.match(r.motivo, /harness\.config\.json ilegível/);
      assert.equal(textoCfg(raiz), antes, 'byte a byte igual');
    }
  });

  test('gravar-acima-do-teto-nao-grava-base', () => {
    // monorepo (tipo_repo ambíguo), sem CI útil e sem conector, e versionamento ambíguo (staging 3 × main 1)
    const raiz = fixtureComGit('monorepo', 'main');
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'main', '2025-06-10');
    for (const d of ['2025-06-05', '2025-06-12', '2025-06-20']) mergear(raiz, 'staging', d);
    const it = itensLista(raiz, { claude: SEM_MCP });
    assert.deepEqual(it.map((i) => i.estado), ['ambiguo', 'nao_detectado', 'nao_detectado', 'ambiguo', 'detectado']);
    assert.deepEqual(idsDe(perguntas(it, null)), ['politica', 'autonomia', 'perfil', 'tipo_repo', 'ambientes']);
    const r = gravarCom(raiz, { ...FIXAS, tipo_repo: 'app', ambientes: null }, { claude: SEM_MCP });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.naoDetectado, ['ambientes', 'planejamento', 'versionamento']);
    const cfg = cfgDe(raiz);
    assert.equal('base' in cfg.entrega, false, 'nem o default (staging) é gravado acima do teto');
    assert.equal('versionamento' in cfg, false);
    assert.equal(cfg.fluxo.ferramenta, undefined);
  });

  test('gravar-versionamento-ambiguo-resposta-vira-base', () => {
    const raiz = repoCom({ 'package.json': '{"name":"x"}', '.github/workflows/d.yml': 'name: deploy-producao\non:\n  push:\n    branches: [main]\njobs:\n  d:\n    environment: producao\n' });
    criarBase(raiz, 'staging', 'main');
    mergear(raiz, 'main', '2025-06-10');
    for (const d of ['2025-06-05', '2025-06-12', '2025-06-20']) mergear(raiz, 'staging', d);
    const ps = perguntas(itensLista(raiz), null);
    assert.deepEqual(idsDe(ps), ['politica', 'autonomia', 'perfil', 'versionamento']);
    assert.deepEqual(ps[3].opcoes.map((o) => o.valor), ['staging', 'main'], 'ambíguo: candidatos, sem opção null');
    assert.equal(ps[3].default, 'staging');
    const r = gravarCom(raiz, { ...FIXAS, versionamento: 'main' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(cfgDe(raiz).entrega.base, 'main');
    assert.equal(cfgDe(raiz).versionamento.resolvidoEm, HOJE);
    assert.deepEqual(r.naoDetectado, []);
  });

  test('gravar-nao-detectado-lista-vazia-explicita', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const a = gravarCom(raiz, { ...FIXAS, planejamento: null }, { claude: SEM_MCP });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.deepEqual(cfgDe(raiz).onboarding.naoDetectado, ['planejamento']);
    const b = gravarCom(raiz, FIXAS); // agora o ClickUp aparece: tudo detectado
    assert.equal(b.ok, true, JSON.stringify(b));
    assert.deepEqual(b.naoDetectado, []);
    assert.ok('naoDetectado' in cfgDe(raiz).onboarding, 'a chave existe');
    assert.deepEqual(cfgDe(raiz).onboarding.naoDetectado, [], 'a lista velha some');
  });

  test('branchpadrao-literal-resposta-so-base', () => {
    const raiz = comConfig(fixtureComGit('completa', 'trunk'), { versionamento: { branchPadrao: 'trunk' } });
    const it = itensLista(raiz);
    assert.equal(it[3].estado, 'nao_detectado');
    assert.equal(it[3].motivo, MOTIVO_BRANCHPADRAO);
    const ps = perguntas(it, existenteDe(raiz));
    assert.deepEqual(idsDe(ps), ['politica', 'autonomia', 'perfil', 'versionamento'], 'perguntado como não detectado');
    assert.deepEqual(ps[3].opcoes.map((o) => o.valor), ['trunk', null]);
    const r = gravarCom(raiz, { ...FIXAS, versionamento: 'trunk' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const cfg = cfgDe(raiz);
    assert.equal(cfg.entrega.base, 'trunk', 'a resposta grava entrega.base');
    assert.equal('resolvidoEm' in cfg.versionamento, false, 'nunca versionamento.resolvidoEm');
    assert.equal(cfg.versionamento.branchPadrao, 'trunk', 'o branchPadrao do dono fica');
    assert.deepEqual(r.naoDetectado, ['versionamento'], 'o item segue não detectado');
    // resposta `null`: nada de base
    const raiz2 = comConfig(fixtureComGit('completa', 'trunk'), { versionamento: { branchPadrao: 'trunk' } });
    const r2 = gravarCom(raiz2, { ...FIXAS, versionamento: null });
    assert.equal(r2.ok, true);
    assert.equal('base' in cfgDe(raiz2).entrega, false);
    assert.deepEqual(r2.naoDetectado, ['versionamento']);
  });

  test('gravar-preserva-branchpadrao-regex', () => {
    const regex = '^feat/[a-z0-9]{9,11}-\\d+-.+$';
    const raiz = comConfig(fixtureComGit('completa', 'trunk'), { versionamento: { branchPadrao: regex, tiposComEscopoDePbi: ['feat'] } });
    const r = gravarCom(raiz, FIXAS);
    assert.equal(r.ok, true, JSON.stringify(r));
    const v = cfgDe(raiz).versionamento;
    assert.equal(v.branchPadrao, regex, 'a regex do dono não é reescrita');
    assert.deepEqual(v.tiposComEscopoDePbi, ['feat']);
    assert.equal(v.resolvidoEm, HOJE);
    assert.equal(cfgDe(raiz).entrega.base, 'trunk');
  });

  test('gravar-versionamento-sem-chave-morta', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const r = gravarCom(raiz, FIXAS);
    assert.equal(r.ok, true);
    assert.deepEqual(r.removidas, [], 'nenhuma chave morta enviada ao aplicar');
    assert.deepEqual(Object.keys(cfgDe(raiz).versionamento), ['resolvidoEm']);
    assert.ok(!r.diff.some((l) => l.includes('versionamento.modelo')));
  });

  test('gravar-ambientes-ambiguo-resposta-vira-fato-informativo', () => {
    const wf = (nome) => `name: deploy-${nome}\non:\n  push:\n    branches: [main]\njobs:\n  d:\n    environment: ${nome}\n`;
    const raiz = repoCom({ 'package.json': '{"name":"x"}', '.github/workflows/a.yml': wf('staging'), '.github/workflows/b.yml': wf('homolog') });
    const it = itensLista(raiz);
    assert.equal(it[1].estado, 'ambiguo');
    const ps = perguntas(it, null);
    const p = ps.find((q) => q.id === 'ambientes');
    assert.deepEqual(p.opcoes.map((o) => o.valor), ['staging', 'homolog']);
    assert.equal(p.default, 'staging');
    const r = gravarCom(raiz, { ...FIXAS, ambientes: 'homolog' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(cfgDe(raiz).onboarding.fatos, { ambientes: { producao: 'homolog', outros: ['staging'] } });
    assert.ok(!r.naoDetectado.includes('ambientes'));
    assert.equal('guarda' in cfgDe(raiz), false);
  });

  test('gravar-planejamento-ambiguo-resposta-vira-ferramenta', () => {
    const raiz = repoCom({ 'package.json': '{"name":"x"}', '.mcp.json': '{"mcpServers":{"linear":{"command":"x"}}}' });
    const it = itensLista(raiz); // ClickUp na conta + Linear no repo
    assert.equal(it[2].estado, 'ambiguo');
    const p = perguntas(it, null).find((q) => q.id === 'planejamento');
    assert.deepEqual(p.opcoes.map((o) => o.valor), ['linear', 'clickup'], 'default = o do .mcp.json do repo');
    assert.equal(p.default, 'linear');
    const r = gravarCom(raiz, { ...FIXAS, ambientes: null, planejamento: 'clickup' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(cfgDe(raiz).fluxo, { resolvidoEm: HOJE, ferramenta: 'clickup' });
    assert.ok(!r.naoDetectado.includes('planejamento'));
  });

  test('gravar-planejamento-da-config-sem-mcp-nao-grava-mcp-vazio', () => {
    const raiz = comConfig(fixtureComGit('completa', 'trunk'), { fluxo: { ferramenta: 'jira' } });
    const r = gravarCom(raiz, FIXAS, { claude: SEM_MCP });
    assert.equal(r.ok, true, JSON.stringify(r));
    const f = cfgDe(raiz).fluxo;
    assert.equal(f.ferramenta, 'jira');
    assert.equal('mcp' in f, false, 'sem servidor conhecido, nenhum fluxo.mcp (nem null)');
    assert.equal(f.resolvidoEm, HOJE);
  });

  test('gravar-escrita-falha-nao-vira-sucesso', { skip: process.getuid?.() === 0 ? 'root escreve em pasta read-only' : false }, () => {
    const raiz = fixtureComGit('completa', 'trunk');
    chmodSync(raiz, 0o555);
    try {
      const r = gravarCom(raiz, FIXAS);
      assert.deepEqual([r.ok, r.erro], [false, 'falha']);
      assert.ok(r.motivo.length > 0);
      assert.equal('diff' in r, false);
    } finally {
      chmodSync(raiz, 0o755);
    }
    assert.equal(temCfg(raiz), false, 'nada escrito');
    assert.deepEqual(readdirSync(raiz).filter((f) => f.includes('.tmp')), []);
  });

  test('gravar-orquestracao-defaults-nao-fixa', () => {
    // FX3 (GM-13): o default 2/4 continua não congelado, mas o gravar CALIBRA por núcleos (capacidade.calibrar) e carimba `calibradoEm`:
    // é o que faz o PAR-1 do doctor passar sem o usuário colar comando. 16 núcleos ⇒ 3/8; 4 núcleos ⇒ 1/2 (a conta é a de --sugerir).
    const antes = process.env.GABARITO_CAP_CORES;
    try {
      process.env.GABARITO_CAP_CORES = '16';
      const raiz = fixtureComGit('completa', 'trunk');
      const r = gravarCom(raiz, FIXAS);
      assert.equal(r.ok, true);
      const par = cfgDe(raiz).orquestracao.paralelismo;
      assert.deepEqual([par.simultaneos, par.teto, par.calibradoEm], [3, 8, HOJE]);
      assert.notDeepEqual([par.simultaneos, par.teto], [2, 4], 'não é o default 2/4 congelado');
      process.env.GABARITO_CAP_CORES = '4';
      const raiz4 = fixtureComGit('completa', 'trunk');
      assert.equal(gravarCom(raiz4, FIXAS).ok, true);
      assert.deepEqual([cfgDe(raiz4).orquestracao.paralelismo.simultaneos, cfgDe(raiz4).orquestracao.paralelismo.teto], [1, 2]);
      // com paralelismo do dono sem data, fica como está (nunca vira "calibrado" sem medição)
      const raiz2 = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { simultaneos: 3, teto: 6, modo: 'auto' } } });
      const r2 = gravarCom(raiz2, FIXAS);
      assert.equal(r2.ok, true);
      assert.deepEqual(cfgDe(raiz2).orquestracao.paralelismo, { simultaneos: 3, teto: 6, modo: 'auto' });
      // calibração em dia fica como está
      const emDia = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { simultaneos: 1, teto: 5, calibradoEm: '2025-01-01' } } });
      assert.equal(gravarCom(emDia, FIXAS).ok, true);
      assert.deepEqual(cfgDe(emDia).orquestracao.paralelismo, { simultaneos: 1, teto: 5, calibradoEm: '2025-01-01' });
      // FX3 r2 (MAJOR-1): vencida (181 d), futura e inválida do dono NUNCA são sobrescritas por um `gravar` comum (onboarding repetido, trocar perfil):
      // valores E `limites` ficam; só o doctor avisa. A sonda do revisor: 1/2 vencido + trocar perfil ⇒ 1/2 e limites intactos.
      const limites = { loadPorCoreMax: 0.8, memDisponivelMinMB: 8192, discoLivreMinGB: 20 };
      for (const cal of ['2024-12-31', '2099-01-01', 'ontem', '2026-02-30']) {
        const dono = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { simultaneos: 1, teto: 2, limites, calibradoEm: cal } } });
        assert.equal(gravarCom(dono, { ...FIXAS, perfil: 'economia' }).ok, true);
        assert.deepEqual(cfgDe(dono).orquestracao.paralelismo, { simultaneos: 1, teto: 2, limites, calibradoEm: cal }, `calibradoEm ${cal}: o gravar comum não toca no paralelismo do dono`);
        assert.equal(cfgDe(dono).orquestracao.perfil, 'economia', 'o perfil trocou');
      }
      // em dia mas teto < simultaneos também fica (o doctor avisa; só `trocar orquestracao` conserta)
      const inv = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { simultaneos: 5, teto: 4, calibradoEm: '2025-06-01' } } });
      assert.equal(gravarCom(inv, FIXAS).ok, true);
      assert.deepEqual(cfgDe(inv).orquestracao.paralelismo, { simultaneos: 5, teto: 4, calibradoEm: '2025-06-01' });
      // só um dos campos à mão (teto sem simultaneos, sem data): é do dono, `gravar` comum não toca (MINOR-4 R2)
      const soTeto = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { teto: 6 } } });
      assert.equal(gravarCom(soTeto, FIXAS).ok, true);
      assert.deepEqual(cfgDe(soTeto).orquestracao.paralelismo, { teto: 6 });
      // calibrado hoje e em dia: um `gravar` comum não refaz (R3)
      const hojeOk = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { simultaneos: 1, teto: 3, calibradoEm: HOJE } } });
      assert.equal(gravarCom(hojeOk, FIXAS).ok, true);
      assert.deepEqual(cfgDe(hojeOk).orquestracao.paralelismo, { simultaneos: 1, teto: 3, calibradoEm: HOJE });
      // só `arquivosDeContenda` (sem nenhum campo de calibração) conta como ausente: calibra e preserva a lista
      const so = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { arquivosDeContenda: ['x.lock'] } } });
      assert.equal(gravarCom(so, FIXAS).ok, true);
      assert.deepEqual([cfgDe(so).orquestracao.paralelismo.teto, cfgDe(so).orquestracao.paralelismo.calibradoEm, cfgDe(so).orquestracao.paralelismo.arquivosDeContenda], [2, HOJE, ['x.lock']]); // 4 núcleos ⇒ teto 2
      // núcleos reais sem GABARITO_CAP_CORES (MINOR-4 R1): a conta usa os do SO
      delete process.env.GABARITO_CAP_CORES;
      const real = fixtureComGit('completa', 'trunk');
      assert.equal(gravarCom(real, FIXAS).ok, true);
      const nuc = availableParallelism();
      assert.deepEqual([cfgDe(real).orquestracao.paralelismo.simultaneos, cfgDe(real).orquestracao.paralelismo.teto], [Math.min(3, Math.max(1, Math.floor(nuc / 4))), Math.min(8, Math.max(2, Math.floor(nuc / 2)))]);
    } finally {
      if (antes === undefined) delete process.env.GABARITO_CAP_CORES; else process.env.GABARITO_CAP_CORES = antes;
    }
  });

  test('trocar-orquestracao-recalibra-com-previa (FX3 r2)', () => {
    const antes = process.env.GABARITO_CAP_CORES;
    try {
      process.env.GABARITO_CAP_CORES = '16';
      const limites = { loadPorCoreMax: 0.8, memDisponivelMinMB: 8192, discoLivreMinGB: 20 };
      const estados = {
        vencido: { simultaneos: 1, teto: 2, limites, calibradoEm: '2024-12-31' },
        invalido: { simultaneos: 1, teto: 2, limites, calibradoEm: 'ontem' },
        futuro: { simultaneos: 1, teto: 2, limites, calibradoEm: '2099-01-01' },
        'teto<simultaneos': { simultaneos: 5, teto: 4, limites, calibradoEm: '2025-06-01' },
        'a mão': { simultaneos: 1, teto: 2, limites },
      };
      for (const [nome, par] of Object.entries(estados)) {
        const raiz = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: { ...par, arquivosDeContenda: ['x.lock'] } } });
        // a prévia (CLI real) mostra antes ⇒ depois e não escreve
        const cli = spawnSync(process.execPath, [join(AQUI, '../scripts/onboarding.mjs'), 'detectar', '--recalibrar', '--root', raiz, '--hoje', HOJE], { encoding: 'utf8', env: { ...process.env, GABARITO_CAP_CORES: '16' } });
        const j = JSON.parse(cli.stdout);
        assert.deepEqual(j.recalibrar.antes, JSON.parse(JSON.stringify({ simultaneos: par.simultaneos, teto: par.teto, limites, calibradoEm: par.calibradoEm })), nome);
        assert.deepEqual([j.recalibrar.depois.simultaneos, j.recalibrar.depois.teto, j.recalibrar.depois.calibradoEm, j.recalibrar.cores], [3, 8, HOJE, 16]);
        assert.match(j.previa, /calibração do paralelismo:\n- recalibrar o paralelismo desta máquina \(16 núcleos\):/);
        assert.ok(j.previa.includes(`simultaneos ${par.simultaneos}, teto ${par.teto}, limites carga 0.8/memória 8192 MB/disco 20 GB ⇒ simultaneos 3, teto 8, limites carga 1.5/memória 2048 MB/disco 5 GB`), j.previa);
        assert.equal(cfgDe(raiz).orquestracao.paralelismo.simultaneos, par.simultaneos, 'a prévia não grava');
        // sem o ok (`_recalibrar`) nada muda; com ele, recalibra e mantém o resto do paralelismo
        assert.equal(gravarCom(raiz, FIXAS).ok, true);
        assert.deepEqual(cfgDe(raiz).orquestracao.paralelismo.limites, limites, `${nome}: sem confirmação, limites intactos`);
        assert.equal(gravarCom(raiz, FIXAS, { dryRun: true }).ok, true);
        assert.equal(gravarCom(raiz, { ...FIXAS, _recalibrar: true }).ok, true);
        const par2 = cfgDe(raiz).orquestracao.paralelismo;
        assert.deepEqual([par2.simultaneos, par2.teto, par2.calibradoEm, par2.limites, par2.arquivosDeContenda], [3, 8, HOJE, { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 }, ['x.lock']], nome);
      }
      // `_recalibrar` só vale `true`
      const raiz = fixtureComGit('completa', 'trunk');
      for (const ruim of [false, 'sim', 1, null]) {
        const r = gravarCom(raiz, { ...FIXAS, _recalibrar: ruim });
        assert.equal(r.ok, false);
        assert.equal(r.erro, 'respostas_invalidas');
      }
      // onboarding de 1ª vez: a prévia já diz o que será gravado
      const nova = spawnSync(process.execPath, [join(AQUI, '../scripts/onboarding.mjs'), 'detectar', '--root', raiz, '--hoje', HOJE], { encoding: 'utf8', env: { ...process.env, GABARITO_CAP_CORES: '16' } });
      assert.match(JSON.parse(nova.stdout).previa, /o paralelismo será calibrado para esta máquina \(16 núcleos\): simultaneos 3, teto 8/);
      // com paralelismo do dono, o `detectar` comum não promete calibração
      const dono = comConfig(fixtureComGit('completa', 'trunk'), { orquestracao: { paralelismo: estados.vencido } });
      const c2 = spawnSync(process.execPath, [join(AQUI, '../scripts/onboarding.mjs'), 'detectar', '--root', dono, '--hoje', HOJE], { encoding: 'utf8' });
      assert.doesNotMatch(JSON.parse(c2.stdout).previa, /calibra/);
    } finally {
      if (antes === undefined) delete process.env.GABARITO_CAP_CORES; else process.env.GABARITO_CAP_CORES = antes;
    }
  });

  test('gravar-efetiva-quando-difere', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const a = gravarCom(raiz, { politica: 'continua', autonomia: false, perfil: 'padrao' });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.efetiva, 'sob_demanda');
    assert.equal(cfgDe(raiz).entrega.politica, 'continua', 'grava a escolhida');
    assert.equal(cfgDe(raiz).entrega.autonomia, false);
    // a efetiva vem da função do produto sobre o config gravado
    const ef = politicaEfetiva(lerConfigEntrega(cfgDe(raiz)));
    assert.equal(ef.politica, a.efetiva);
    const b = gravarCom(raiz, { politica: 'continua', autonomia: true, perfil: 'padrao' });
    assert.equal('efetiva' in b, false, 'igual à escolhida: sem efetiva');
    const c = gravarCom(raiz, { politica: 'sob_demanda', autonomia: true, perfil: 'padrao' });
    assert.equal('efetiva' in c, false);
    const d = gravarCom(raiz, { politica: 'janela', autonomia: false, perfil: 'padrao' }, { dryRun: true });
    assert.equal(d.efetiva, 'sob_demanda', 'dry-run também diz a efetiva');
  });

  test('janela-padrao-valida', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const r = gravarCom(raiz, { politica: 'janela', autonomia: true, perfil: 'padrao' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const cfg = cfgDe(raiz);
    assert.deepEqual(cfg.entrega.janela, { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '17:00', fuso: FUSO });
    assert.equal(cfg.entrega.autonomia, true);
    assert.equal(typeof cfg.entrega.autonomia, 'boolean');
    const lido = lerConfigEntrega(cfg);
    assert.deepEqual(lido.erros, []);
    assert.equal(lido.politica, 'janela');
    assert.deepEqual(lido.janela, cfg.entrega.janela);
    assert.equal(r.efetiva, undefined);
    // janela do dono não é trocada; política que não é janela não grava janela
    const dono = { dias: [6], inicio: '02:00', fim: '04:00', fuso: 'UTC' };
    const raiz2 = comConfig(fixtureComGit('completa', 'trunk'), { entrega: { janela: dono } });
    gravarCom(raiz2, { politica: 'janela', autonomia: true, perfil: 'padrao' });
    assert.deepEqual(cfgDe(raiz2).entrega.janela, dono);
    const raiz3 = fixtureComGit('completa', 'trunk');
    gravarCom(raiz3, { politica: 'continua', autonomia: true, perfil: 'padrao' });
    assert.equal('janela' in cfgDe(raiz3).entrega, false);
    // janela do dono inválida com política janela: troca pela padrão (senão a entrega cairia em sob_demanda)
    const raiz4 = comConfig(fixtureComGit('completa', 'trunk'), { entrega: { janela: { dias: [] } } });
    gravarCom(raiz4, { politica: 'janela', autonomia: true, perfil: 'padrao' });
    assert.deepEqual(lerConfigEntrega(cfgDe(raiz4)).erros, []);
  });

  test('configDasRespostas-pura-nao-escreve-nem-muta', () => {
    const raiz = fixtureComGit('completa', 'trunk');
    const it = itensLista(raiz);
    const existente = { entrega: { politica: 'continua' }, fluxo: { idPadrao: 'x' } };
    const copia = structuredClone(existente);
    const r = configDasRespostas(it, FIXAS, existente, HOJE, { fuso: FUSO });
    assert.deepEqual(existente, copia, 'não muta o existente');
    assert.deepEqual(Object.keys(r.patches).sort(), ['entrega', 'fluxo', 'onboarding', 'orquestracao', 'versionamento']);
    assert.equal(r.perfil, undefined);
    assert.deepEqual(r.naoDetectado, []);
    assert.deepEqual(r.patches.onboarding, { resolvidoEm: HOJE, naoDetectado: [], fatos: { ambientes: { producao: 'production', outros: ['staging'] } } });
  });
});

describe('gravar costura', () => {
  test('cli-gravar-atravessa-adaptador-real', () => {
    const bin = novoDir('gm-onb-bin-');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho \'claude.ai ClickUp: https://x.test/mcp?t=SEGREDO - ✔ Connected\'\n');
    chmodSync(join(bin, 'claude'), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const raiz = fixtureComGit('completa', 'trunk');
    const det = spawnSync(process.execPath, [CLI, 'detectar', '--root', raiz, '--hoje', HOJE, '--fuso', FUSO], { encoding: 'utf8', env });
    assert.equal(det.status, 0, det.stderr);
    const saida = JSON.parse(det.stdout);
    assert.equal(saida.ok, true);
    assert.deepEqual(idsDe(saida.perguntas), ['politica', 'autonomia', 'perfil']);
    assert.ok(typeof saida.previa === 'string' && saida.previa.startsWith('detectei:'));
    assert.ok(!det.stdout.includes('SEGREDO'));
    const resp = arquivoResp({ ...FIXAS, _previa: saida.itens }); // a skill copia `itens` da saída de `detectar`
    const seco = spawnSync(process.execPath, [CLI, 'gravar', '--root', raiz, '--respostas', resp, '--hoje', HOJE, '--fuso', FUSO, '--dry-run'], { encoding: 'utf8', env });
    assert.equal(seco.status, 0, seco.stderr);
    assert.equal(JSON.parse(seco.stdout).ok, true);
    assert.equal(temCfg(raiz), false);
    const g = spawnSync(process.execPath, [CLI, 'gravar', '--root', raiz, '--respostas', resp, '--hoje', HOJE, '--fuso', FUSO], { encoding: 'utf8', env });
    assert.equal(g.status, 0, g.stderr);
    const out = JSON.parse(g.stdout);
    assert.equal(out.ok, true);
    assert.deepEqual(out.naoDetectado, []);
    assert.ok(out.diff.join('\n').includes('"base":"trunk"'));
    assert.equal(cfgDe(raiz).entrega.base, 'trunk');
    assert.ok(!g.stdout.includes('SEGREDO') && !textoCfg(raiz).includes('SEGREDO'));
    assert.deepEqual(readdirSync(raiz).filter((f) => f.includes('.tmp')), []);
    // erros: exit 1, JSON no stdout, nada escrito
    const raiz2 = fixtureComGit('completa', 'trunk');
    for (const [args, erro] of [[['--respostas', join(novoDir(), 'x.json')], 'respostas_ausentes'], [[], 'respostas_ausentes'], [['--respostas', arquivoResp('[1]')], 'respostas_invalidas'], [['--respostas', arquivoResp({ ...FIXAS, perfil: 'turbo', _previa: saida.itens })], 'resposta_fora_das_opcoes'], [['--respostas', arquivoResp(FIXAS)], 'previa_ausente']]) {
      const e = spawnSync(process.execPath, [CLI, 'gravar', '--root', raiz2, ...args, '--hoje', HOJE], { encoding: 'utf8', env });
      assert.equal(e.status, 1, erro);
      assert.deepEqual([JSON.parse(e.stdout).ok, JSON.parse(e.stdout).erro], [false, erro]);
    }
    assert.equal(temCfg(raiz2), false);
    const ruim = spawnSync(process.execPath, [CLI, 'gravar', '--root', raiz2, '--respostas', resp, '--hoje', 'ontem'], { encoding: 'utf8', env });
    assert.equal(ruim.status, 1);
    assert.equal(JSON.parse(ruim.stdout).ok, false);
    assert.equal(temCfg(raiz2), false);
  });
});

// ────────────────────────────────────────────────────────────── S6: os 3 repos reais, só leitura

describe('s6', () => {
  const dirRepos = process.env.S6_REPOS_DIR ?? join(homedir(), 'projetos-true');
  const gabarito = JSON.parse(readFileSync(join(FIX, 's6-gabarito.json'), 'utf8'));
  for (const repo of [...new Set(gabarito.map((g) => g.repo))]) {
    const raiz = join(dirRepos, repo);
    test(`s6-gabarito-zero-errado: ${repo}`, { skip: !existsSync(join(raiz, '.git')) ? `sem ${raiz}/.git (defina S6_REPOS_DIR)` : false }, () => {
      const itens = Object.fromEntries(detectar(coletarFatos(raiz, { rodar: rodarCom(CLICKUP), hoje: new Date().toISOString().slice(0, 10) })).map((i) => [i.item, i]));
      for (const g of gabarito.filter((x) => x.repo === repo)) {
        const i = itens[g.item];
        assert.equal(i.estado, g.estado, `${repo}/${g.item}: estado (${i.motivo ?? ''})`);
        if (g.estado === 'ambiguo') {
          assert.deepEqual(i.candidatos, g.valor, `${repo}/${g.item}: candidatos`);
          assert.equal(i.valor, g.valor[0], `${repo}/${g.item}: default`);
        } else if (g.estado === 'detectado') {
          assert.deepEqual(i.valor, g.valor, `${repo}/${g.item}: valor`);
        } else {
          assert.equal(i.valor, null, `${repo}/${g.item}: valor`);
        }
      }
    });
  }
});

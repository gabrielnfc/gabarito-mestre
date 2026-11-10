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
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { ORDEM_ITENS, coletarFatos, detectar, rodarReal, lerWorkflow, TIMEOUT_MCP_MS } from '../scripts/onboarding.mjs';

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

  test('orquestracao-campo-invalido-default-por-campo', () => {
    const cfg = '{\n  "orquestracao": {\n    "paralelismo": {\n      "simultaneos": "3",\n      "teto": 8\n    }\n  }\n}';
    const o = itensDe(raizCom({ 'harness.config.json': cfg })).orquestracao;
    assert.equal(o.estado, 'detectado');
    assert.deepEqual(o.valor, { simultaneos: 2, teto: 8 });
    assert.equal(o.fonte, 'simultaneos DEFAULTS; teto config:5');
    for (const ruim of ['null', '-1', '0', '"abc"', 'true', '[]']) {
      const r = itensDe(raizCom({ 'harness.config.json': `{"orquestracao":{"paralelismo":{"simultaneos":${ruim},"teto":${ruim}}}}` })).orquestracao;
      assert.deepEqual(r.valor, { simultaneos: 2, teto: 4 }, ruim);
      assert.equal(r.fonte, 'simultaneos DEFAULTS; teto DEFAULTS', ruim);
    }
    const frac = itensDe(raizCom({ 'harness.config.json': '{"orquestracao":{"paralelismo":{"simultaneos":3.9,"teto":8}}}' })).orquestracao;
    assert.equal(frac.valor.simultaneos, 3, 'inteiro, como o calcularSlots');
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

#!/usr/bin/env node
/**
 * ONB-1 (GM-13, E5a) — onboarding: coleta e detecção (T6a). Script puro, sem LLM.
 *
 * Detecta o que o repositório já responde (tipo de repo, ambientes, ferramenta de planejamento, base de
 * versionamento, paralelismo) e devolve, por item, `{ item, estado, valor, fonte, candidatos, motivo? }`.
 * Fato detectado nunca vira pergunta; `ambiguo` leva `valor` = default (o 1º candidato) e `candidatos` = a lista;
 * `nao_detectado` leva `valor: null`. Perguntas, prévia e gravação (T6b) ficam abaixo da detecção: `perguntas`, `previa`,
 * `configDasRespostas` (puras) e `gravar` (única que escreve, 1 escrita de `harness.config.json`, sempre redetectando).
 *
 * Contrato de falha: dado ausente, corrompido ou ferramenta falhando nunca vira sucesso, e ausente ≠ corrompido.
 * `claude mcp list` roda em pasta vazia (o health check sobe os MCP stdio do `.mcp.json` do projeto) e só o NOME
 * do servidor entra no resultado (a URL pode carregar token). `.env.example`: só o nome da chave é lido.
 * A detecção nunca mede a máquina (`medir`/`calcularSlots`): a carga do momento não é um fato do repositório.
 *
 * USO
 *   node onboarding.mjs detectar [--root <d>] [--hoje AAAA-MM-DD]   → { ok, itens }
 *     config ilegível ⇒ { ok:false, erro:'config_invalida', motivo }, exit 1, sem coletar nada mais.
 *     T6b: o resultado ganha `perguntas` (≤ 5) e `previa` (texto).
 *   node onboarding.mjs gravar --respostas <arquivo.json> [--root <d>] [--hoje AAAA-MM-DD] [--fuso <IANA>] [--dry-run]
 *     → { ok, diff, naoDetectado, removidas, efetiva? } ou { ok:false, erro, motivo } com exit 1 e NADA escrito:
 *     respostas_ausentes | respostas_invalidas | config_invalida | deteccao_mudou | resposta_fora_das_opcoes | falha.
 */

import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { arg, ehEntrypoint } from '../lib/cli.mjs';
import { raizDoRepo } from '../lib/git.mjs';
import { hojeISO } from '../lib/datas.mjs';
import * as capacidade from './capacidade.mjs';
import { lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { PERFIS_MODELO, resolverModelo } from '../lib/config.mjs';
import { aplicarConfig, ArquivoInvalido } from './onboarding-config.mjs';

export const ORDEM_ITENS = ['tipo_repo', 'ambientes', 'planejamento', 'versionamento', 'orquestracao'];
export const JANELA_DIAS = 60;
export const MOTIVO_BRANCHPADRAO = 'branchPadrao é nome de branch (guarda), não regex (R20)';
export const TIMEOUT_MCP_MS = 30_000;
const BASES_DE_INTEGRACAO = /^(staging|develop|development|dev|homolog|homologacao|hml|next)$/;
const MARCADORES_MONOREPO = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'];
const FERRAMENTAS_MCP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reference', 'ferramentas-mcp.json');
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ────────────────────────────────────────────────────────────── processos

/** `rodar(cmd, args, { cwd, timeoutMs })` → `{ rc, stdout, stderr, motivo }`; `motivo` = 'ausente' | 'timeout' | null. Nunca lança. */
export function rodarReal(cmd, args, { cwd, timeoutMs } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  let motivo = null;
  if (r.error?.code === 'ENOENT') motivo = 'ausente';
  else if (r.error?.code === 'ETIMEDOUT') motivo = 'timeout';
  else if (r.error) motivo = `erro ${r.error.code ?? r.error.message}`;
  return { rc: motivo ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', motivo };
}

const deuCerto = (r) => r && !r.motivo && r.rc === 0;

// ────────────────────────────────────────────────────────────── leitura de arquivos

/** Texto do arquivo, `null` se não existe, `{ erro }` se existe e não lê. */
function lerTexto(caminho) {
  if (!existsSync(caminho)) return null;
  try {
    return readFileSync(caminho, 'utf8');
  } catch (e) {
    return { erro: String(e.message).split('\n')[0] };
  }
}

/** Objeto JSON do arquivo: `null` ausente, `{ erro }` ilegível (não é JSON, ou não é objeto). Arquivo vazio ⇒ `{}`. */
function lerObjeto(caminho) {
  const t = lerTexto(caminho);
  if (t === null) return { ausente: true };
  if (typeof t !== 'string') return { erro: t.erro };
  if (t.trim() === '') return { obj: {}, texto: t };
  try {
    const obj = JSON.parse(t);
    if (!ehObjeto(obj)) return { erro: 'não é um objeto JSON' };
    return { obj, texto: t };
  } catch (e) {
    return { erro: String(e.message).split('\n')[0] };
  }
}

/** Nº da linha (1-based) da 1ª ocorrência de `chaves[0]`, e das seguintes a partir dali; `null` se alguma falta. */
function linhaDeChave(texto, chaves) {
  if (typeof texto !== 'string') return null;
  const linhas = texto.split(/\r?\n/);
  let i = 0;
  for (const c of chaves) {
    const re = new RegExp(`"${c}"\\s*:`);
    while (i < linhas.length && !re.test(linhas[i])) i += 1;
    if (i >= linhas.length) return null;
  }
  return i + 1;
}

// ────────────────────────────────────────────────────────────── workflows (YAML mínimo, sem dependência)

const semComentario = (v) => v.replace(/\s+#.*$/, '');
const desaspas = (v) => {
  const t = v.trim();
  const m = /^(["'])(.*)\1$/.exec(t);
  return m ? m[2] : t;
};
const indentDe = (l) => /^\s*/.exec(l)[0].length;
const vazia = (l) => l.trim() === '' || /^\s*#/.test(l);

/** `{ arquivo, nome, ehDeploy, envs:[{nome,fonte}], ignorados:[fonte], branches:[nome], branchesLinha }` de 1 workflow. Puro. */
export function lerWorkflow(texto, arquivo) {
  const linhas = texto.split(/\r?\n/);
  let nome = null;
  const envs = [];
  const ignorados = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i];
    if (/^\s*#/.test(l)) continue;
    const mn = /^name:\s*(.*)$/.exec(l);
    if (mn && nome === null) nome = desaspas(semComentario(mn[1])) || null;
    const me = /^(\s*)environment:\s*(.*)$/.exec(l);
    if (!me) continue;
    let valor = semComentario(me[2]).trim();
    let linha = i + 1;
    if (valor === '') {
      for (let j = i + 1; j < linhas.length && (vazia(linhas[j]) || indentDe(linhas[j]) > me[1].length); j += 1) {
        const mm = /^\s+name:\s*(.*)$/.exec(linhas[j]);
        if (mm && !/^\s*#/.test(linhas[j])) {
          valor = semComentario(mm[1]).trim();
          linha = j + 1;
          break;
        }
      }
    } else if (valor.startsWith('{')) {
      const mm = /name:\s*([^,}]+)/.exec(valor);
      valor = mm ? mm[1].trim() : '';
    }
    if (valor === '') continue;
    if (valor.includes('${{')) ignorados.push(`${arquivo}:${linha}`);
    else envs.push({ nome: desaspas(valor), fonte: `${arquivo}:${linha}` });
  }
  const { branches, linha: branchesLinha } = branchesDePush(linhas);
  const base = basename(arquivo, extname(arquivo));
  return { arquivo, nome, ehDeploy: /deploy/i.test(nome ?? '') || /deploy/i.test(base), envs, ignorados, branches, branchesLinha };
}

function branchesDePush(linhas) {
  const ini = linhas.findIndex((l) => /^(?:on|"on"|'on'):\s*(?:#.*)?$/.test(l));
  if (ini < 0) return { branches: [], linha: null };
  let fim = ini + 1;
  while (fim < linhas.length && (vazia(linhas[fim]) || indentDe(linhas[fim]) > 0)) fim += 1;
  const bloco = linhas.slice(ini + 1, fim);
  const pi = bloco.findIndex((l) => !vazia(l) && /^\s+push:\s*(?:#.*)?$/.test(l));
  if (pi < 0) return { branches: [], linha: null };
  const indPush = indentDe(bloco[pi]);
  let pf = pi + 1;
  while (pf < bloco.length && (vazia(bloco[pf]) || indentDe(bloco[pf]) > indPush)) pf += 1;
  const push = bloco.slice(pi + 1, pf);
  const bi = push.findIndex((l) => !vazia(l) && /^\s+branches:/.test(l));
  if (bi < 0) return { branches: [], linha: null };
  const linha = ini + 1 + pi + 1 + bi + 1;
  const resto = semComentario(/^\s+branches:\s*(.*)$/.exec(push[bi])[1]).trim();
  if (resto.startsWith('[')) {
    const interno = resto.replace(/^\[/, '').replace(/\]\s*$/, '');
    return { branches: interno.split(',').map(desaspas).filter(Boolean), linha };
  }
  if (resto !== '') return { branches: [desaspas(resto)], linha };
  const indB = indentDe(push[bi]);
  const itens = [];
  for (let k = bi + 1; k < push.length; k += 1) {
    if (vazia(push[k])) continue;
    if (indentDe(push[k]) <= indB) break;
    const mi = /^\s*-\s*(.*)$/.exec(push[k]);
    if (mi) itens.push(desaspas(semComentario(mi[1])));
  }
  return { branches: itens.filter(Boolean), linha };
}

// ────────────────────────────────────────────────────────────── claude mcp list

/** Servidores CONECTADOS: `string[]`; `null` + motivo quando a saída não é confiável. Guarda só o nome, nunca a URL. */
function lerMcpList(r) {
  if (r.motivo) return { mcps: null, motivo: `claude mcp list falhou (${r.motivo})` };
  if (r.rc !== 0) return { mcps: null, motivo: `claude mcp list falhou (rc ${r.rc})` };
  const texto = String(r.stdout ?? '');
  if (/No MCP servers configured/i.test(texto)) return { mcps: [], motivo: null };
  const nomes = [];
  let reconhecidas = 0;
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim();
    const a = l.indexOf(': ');
    const b = l.lastIndexOf(' - ');
    if (a <= 0 || b <= a) continue;
    const nome = l.slice(0, a).trim();
    const status = l.slice(b + 3).trim();
    if (nome.includes('://') || !/✔|✓|✗|✘|⚠|Connected|Failed|Needs auth/i.test(status)) continue;
    reconhecidas += 1;
    const conectado = /✔|✓|\bConnected\b/.test(status) && !/Needs auth|Failed|✗|✘/i.test(status);
    if (conectado && !nomes.includes(nome)) nomes.push(nome);
  }
  if (reconhecidas === 0) return { mcps: null, motivo: 'saída ilegível' };
  return { mcps: nomes, motivo: null };
}

function mcpsDoRepo(raiz) {
  const r = lerObjeto(join(raiz, '.mcp.json'));
  if (r.ausente) return { mcpRepo: [], motivo: null };
  if (r.erro) return { mcpRepo: null, motivo: '.mcp.json ilegível' };
  return { mcpRepo: ehObjeto(r.obj.mcpServers) ? Object.keys(r.obj.mcpServers) : [], motivo: null };
}

// ────────────────────────────────────────────────────────────── git

const prefixoOrigin = 'refs/remotes/origin/';

function desdeDe(hoje) {
  if (typeof hoje !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(hoje) || Number.isNaN(Date.parse(`${hoje}T00:00:00Z`))) {
    throw new RangeError(`hoje inválido: ${JSON.stringify(hoje)} (use AAAA-MM-DD)`);
  }
  const d = new Date(Date.parse(`${hoje}T00:00:00Z`) - JANELA_DIAS * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}

/** Merges de PR (≥ 2 pais) ou squash (`(#N)` no fim do assunto) no first-parent da ref, na janela. `null` se o git falhar. */
function contarIntegracao(rodar, raiz, nome, desde) {
  const r = rodar('git', ['-C', raiz, 'log', '--first-parent', `--since=${desde}`, '--format=%P%x00%s', `${prefixoOrigin}${nome}`], {});
  if (!deuCerto(r)) return null;
  let n = 0;
  for (const linha of String(r.stdout).split('\n')) {
    if (linha === '') continue;
    const [pais = '', assunto = ''] = linha.split('\0');
    if (pais.trim().split(/\s+/).filter(Boolean).length >= 2 || /\(#\d+\)$/.test(assunto.trim())) n += 1;
  }
  return n;
}

function coletarGit(raiz, rodar, hoje) {
  const desde = desdeDe(hoje);
  const dentro = rodar('git', ['-C', raiz, 'rev-parse', '--is-inside-work-tree'], {});
  if (!deuCerto(dentro) || dentro.stdout.trim() !== 'true') return { originHead: null, integracao: null, motivoOrigin: 'sem git', motivoIntegracao: 'sem git' };
  const head = rodar('git', ['-C', raiz, 'symbolic-ref', '-q', `${prefixoOrigin}HEAD`], {});
  const ref = deuCerto(head) ? head.stdout.trim() : '';
  if (!ref.startsWith(prefixoOrigin)) return { originHead: null, integracao: null, motivoOrigin: 'sem origin/HEAD', motivoIntegracao: 'sem origin/HEAD' };
  const originHead = ref.slice(prefixoOrigin.length);
  const refs = rodar('git', ['-C', raiz, 'for-each-ref', '--format=%(refname)', prefixoOrigin.slice(0, -1)], {});
  if (!deuCerto(refs)) return { originHead, integracao: null, motivoOrigin: null, motivoIntegracao: 'git for-each-ref falhou' };
  const outros = String(refs.stdout).split('\n').filter((x) => x.startsWith(prefixoOrigin)).map((x) => x.slice(prefixoOrigin.length)).filter((n) => BASES_DE_INTEGRACAO.test(n)).sort();
  const candidatos = [originHead, ...outros.filter((n) => n !== originHead)];
  const integracao = {};
  for (const nome of candidatos) {
    const n = contarIntegracao(rodar, raiz, nome, desde);
    if (n === null) return { originHead, integracao: null, motivoOrigin: null, motivoIntegracao: 'git log falhou' };
    integracao[nome] = n;
  }
  return { originHead, integracao, motivoOrigin: null, motivoIntegracao: null };
}

// ────────────────────────────────────────────────────────────── coleta

function lerWorkflows(raiz) {
  const dir = join(raiz, '.github', 'workflows');
  let nomes = [];
  try {
    nomes = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort();
  } catch {
    return { workflows: [], ilegiveis: [], existe: false };
  }
  const workflows = [];
  const ilegiveis = [];
  for (const n of nomes) {
    const arquivo = `.github/workflows/${n}`;
    const t = lerTexto(join(dir, n));
    if (typeof t !== 'string') ilegiveis.push(arquivo);
    else workflows.push(lerWorkflow(t, arquivo));
  }
  return { workflows, ilegiveis, existe: true };
}

function lerEnvExample(raiz) {
  const t = lerTexto(join(raiz, '.env.example'));
  if (t === null) return { envExample: null, motivo: null };
  if (typeof t !== 'string') return { envExample: null, motivo: '.env.example ilegível' };
  const chaves = [];
  t.split(/\r?\n/).forEach((l, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    if (m) chaves.push({ chave: m[1], linha: i + 1 });
  });
  return { envExample: { chaves }, motivo: null };
}

function lerFerramentas() {
  const r = lerObjeto(FERRAMENTAS_MCP);
  if (r.erro || r.ausente || !Array.isArray(r.obj.ferramentas)) return null;
  return r.obj.ferramentas.filter((f) => typeof f?.padraoServidor === 'string' && typeof f?.ferramenta === 'string').map((f) => ({ padraoServidor: f.padraoServidor, ferramenta: f.ferramenta }));
}

/**
 * Coleta crua do repositório. `rodar` executa `git` e `claude` (injetável); `hoje` (AAAA-MM-DD) ancora a janela de 60 d.
 * Cada fato ausente ou corrompido tem um campo e um motivo próprios em `motivos`; nada aqui lança por dado ruim.
 */
export function coletarFatos(raiz, { rodar = rodarReal, hoje = hojeISO() } = {}) {
  const motivos = {};
  let arquivos = [];
  try {
    arquivos = readdirSync(raiz).sort();
  } catch {
    arquivos = [];
  }
  const pj = lerObjeto(join(raiz, 'package.json'));
  const packageJson = pj.obj ?? null;
  if (pj.ausente) motivos.packageJson = 'sem package.json';
  else if (pj.erro) motivos.packageJson = 'package.json ilegível';
  const cfg = lerObjeto(join(raiz, 'harness.config.json'));
  const configExistente = cfg.ausente ? null : cfg.erro ? { erro: `harness.config.json ilegível (${cfg.erro})` } : cfg.obj;
  const { workflows, ilegiveis, existe } = lerWorkflows(raiz);
  const env = lerEnvExample(raiz);
  if (env.motivo) motivos.envExample = env.motivo;
  const repo = mcpsDoRepo(raiz);
  if (repo.motivo) motivos.mcpRepo = repo.motivo;
  const pasta = mkdtempSync(join(tmpdir(), 'gm-onb-mcp-'));
  let mcp;
  try {
    mcp = lerMcpList(rodar('claude', ['mcp', 'list'], { cwd: pasta, timeoutMs: TIMEOUT_MCP_MS }));
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
  if (mcp.motivo) motivos.mcps = mcp.motivo;
  const g = coletarGit(raiz, rodar, hoje);
  if (g.motivoOrigin) motivos.originHead = g.motivoOrigin;
  if (g.motivoIntegracao) motivos.integracao = g.motivoIntegracao;
  return {
    hoje,
    arquivos,
    packageJson,
    workflows,
    workflowsIlegiveis: ilegiveis,
    temWorkflows: existe,
    envExample: env.envExample,
    mcps: mcp.mcps,
    mcpRepo: repo.mcpRepo,
    originHead: g.originHead,
    integracao: g.integracao,
    configExistente,
    ferramentas: lerFerramentas(),
    textos: { config: cfg.texto ?? null, packageJson: pj.texto ?? null },
    motivos,
  };
}

// ────────────────────────────────────────────────────────────── detecção (pura)

const det = (item, valor, fonte) => ({ item, estado: 'detectado', valor, fonte, candidatos: [] });
const amb = (item, candidatos, fonte, motivo) => ({ item, estado: 'ambiguo', valor: candidatos[0], fonte, candidatos, ...(motivo ? { motivo } : {}) });
const naoDet = (item, motivo, fonte, candidatos = []) => ({ item, estado: 'nao_detectado', valor: null, fonte, candidatos, motivo });

const configErro = (f) => (ehObjeto(f.configExistente) && typeof f.configExistente.erro === 'string' ? f.configExistente.erro : null);
const configObj = (f) => (ehObjeto(f.configExistente) && configErro(f) === null ? f.configExistente : {});

function detectarTipoRepo(f) {
  if (configObj(f).perfil === 'repo-sem-app') return det('tipo_repo', 'repo-sem-app', `harness.config.json:${linhaDeChave(f.textos?.config, ['perfil']) ?? '?'} (perfil)`);
  const marcas = MARCADORES_MONOREPO.filter((m) => f.arquivos.includes(m));
  const ws = f.packageJson?.workspaces;
  if (Array.isArray(ws) ? ws.length > 0 : Array.isArray(ws?.packages) && ws.packages.length > 0) {
    marcas.unshift(`package.json:${linhaDeChave(f.textos?.packageJson, ['workspaces']) ?? '?'} (workspaces)`);
  }
  if (marcas.length > 0) return amb('tipo_repo', ['app', 'repo-sem-app'], `monorepo: ${marcas.join('; ')}`, f.motivos.packageJson);
  if (f.packageJson) return det('tipo_repo', 'app', `package.json:${linhaDeChave(f.textos?.packageJson, ['name']) ?? 1} (sem marcador de monorepo)`);
  return amb('tipo_repo', ['app', 'repo-sem-app'], 'sem package.json legível', f.motivos.packageJson ?? 'sem package.json');
}

const PREFIXO_ENV = /^(PROD|PRODUCTION|STAGING|STG|HOMOLOG|HML)_/;
const CLASSE_DO_PREFIXO = { PROD: 'producao', PRODUCTION: 'producao', STAGING: 'staging', STG: 'staging', HOMOLOG: 'homolog', HML: 'homolog' };
const classeDe = (nome) => (/prod|produc|prd/i.test(nome) ? 'producao' : /stag|stg/i.test(nome) ? 'staging' : /homolog|hml/i.test(nome) ? 'homolog' : null);

function detectarAmbientes(f) {
  const ilegiveis = (f.workflowsIlegiveis ?? []).map((a) => `${a} ilegível`);
  const candidatos = [];
  const ignorados = [];
  const soma = (nome, fonte) => {
    if (!candidatos.some((c) => c.nome === nome)) candidatos.push({ nome, fonte });
  };
  for (const w of f.workflows ?? []) {
    ignorados.push(...w.ignorados.map((x) => `${x} (expressão \${{ }} ignorada)`));
    for (const e of w.envs) soma(e.nome, e.fonte);
    if (w.envs.length === 0 && w.ehDeploy && w.branches.length > 0) {
      const nome = w.branches.length === 1 ? w.branches[0] : (w.nome ?? basename(w.arquivo, extname(w.arquivo))).replace(/^deploy[-_ ]?/i, '') || w.nome;
      soma(nome, `${w.arquivo}:${w.branchesLinha} (on.push.branches)`);
    }
  }
  const notas = [...ilegiveis, ...ignorados];
  const comNotas = (txt) => [txt, ...notas].join('; ');
  if ((f.workflows ?? []).length === 0) return naoDet('ambientes', 'sem CI', comNotas('.github/workflows sem workflow legível'));
  if (candidatos.length === 0) return naoDet('ambientes', 'CI sem deploy', comNotas('workflows sem environment: nem deploy com on.push.branches'));
  const classes = new Set(candidatos.map((c) => classeDe(c.nome)));
  const porClasse = new Map();
  for (const k of f.envExample?.chaves ?? []) {
    const m = PREFIXO_ENV.exec(k.chave);
    if (m && !porClasse.has(CLASSE_DO_PREFIXO[m[1]])) porClasse.set(CLASSE_DO_PREFIXO[m[1]], k);
  }
  for (const [classe, k] of porClasse) {
    if (!classes.has(classe)) soma(classe, `.env.example:${k.linha} (${k.chave})`);
  }
  const prods = candidatos.filter((c) => classeDe(c.nome) === 'producao');
  const fonte = comNotas(candidatos.map((c) => `${c.nome} ${c.fonte}`).join('; '));
  if (prods.length === 1) return det('ambientes', { producao: prods[0].nome, outros: candidatos.filter((c) => c !== prods[0]).map((c) => c.nome) }, fonte);
  const lista = prods.length > 1 ? prods : candidatos;
  return amb('ambientes', lista.map((c) => c.nome), fonte, prods.length > 1 ? 'mais de uma produção' : 'nenhuma produção entre os candidatos');
}

function detectarPlanejamento(f) {
  if (configErro(f)) return naoDet('planejamento', 'harness.config.json ilegível', 'harness.config.json');
  const cfg = configObj(f);
  const notas = [];
  const fer = cfg.fluxo?.ferramenta;
  if (typeof fer === 'string' && fer.trim() !== '') {
    const mcp = typeof cfg.fluxo.mcp === 'string' && cfg.fluxo.mcp !== '' ? cfg.fluxo.mcp : (f.mcps ?? []).find((n) => casaFerramenta(f, n) === fer.trim()) ?? null;
    return det('planejamento', { ferramenta: fer.trim(), mcp }, `harness.config.json:${linhaDeChave(f.textos?.config, ['fluxo', 'ferramenta']) ?? '?'} (fluxo.ferramenta)`);
  }
  if (cfg.fluxo && 'ferramenta' in cfg.fluxo) notas.push('fluxo.ferramenta vazio ou inválido, ignorado');
  if (!f.ferramentas) return naoDet('planejamento', 'ferramentas-mcp.json ilegível', 'reference/ferramentas-mcp.json');
  const doRepo = (f.mcpRepo ?? []).map((n) => ({ nome: n, ferramenta: casaFerramenta(f, n), origem: '.mcp.json' })).filter((x) => x.ferramenta);
  const doConta = (f.mcps ?? []).map((n) => ({ nome: n, ferramenta: casaFerramenta(f, n), origem: 'conector' })).filter((x) => x.ferramenta);
  const ordem = f.ferramentas.map((x) => x.ferramenta);
  const distintas = [...new Set([...doRepo, ...doConta].map((x) => x.ferramenta))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  const fonteDe = (lista) => [...lista.map((x) => `${x.origem} ${x.nome}`), ...notas].join('; ');
  if (f.mcps === null) {
    const motivo = f.motivos.mcps ?? 'claude mcp list falhou';
    const repoFer = [...new Set(doRepo.map((x) => x.ferramenta))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    return naoDet('planejamento', motivo, fonteDe(doRepo) || 'claude mcp list', repoFer);
  }
  if (distintas.length === 0) return naoDet('planejamento', 'sem conector de planejamento', fonteDe([]) || 'claude mcp list e .mcp.json sem ferramenta conhecida');
  if (distintas.length === 1) {
    const achado = [...doRepo, ...doConta].find((x) => x.ferramenta === distintas[0]);
    return det('planejamento', { ferramenta: distintas[0], mcp: achado.nome }, fonteDe([...doRepo, ...doConta]));
  }
  const padrao = distintas.find((d) => doRepo.some((x) => x.ferramenta === d)) ?? distintas[0];
  return amb('planejamento', [padrao, ...distintas.filter((d) => d !== padrao)], fonteDe([...doRepo, ...doConta]), 'mais de uma ferramenta de planejamento');
}

function casaFerramenta(f, nomeServidor) {
  for (const x of f.ferramentas ?? []) {
    try {
      if (new RegExp(x.padraoServidor, 'i').test(nomeServidor)) return x.ferramenta;
    } catch {
      /* padrão inválido na tabela: não casa */
    }
  }
  return null;
}

function detectarVersionamento(f) {
  const erro = configErro(f);
  if (erro) return naoDet('versionamento', 'harness.config.json ilegível', 'harness.config.json');
  if (f.originHead === null) return naoDet('versionamento', f.motivos.originHead ?? 'sem origin/HEAD', 'git symbolic-ref refs/remotes/origin/HEAD');
  if (f.integracao === null) return naoDet('versionamento', f.motivos.integracao ?? 'git log falhou', `origin/${f.originHead}`);
  const head = f.originHead;
  const cont = f.integracao;
  const ordenados = Object.keys(cont).sort((a, b) => cont[b] - cont[a] || (a === head ? -1 : b === head ? 1 : a.localeCompare(b)));
  const lista = ordenados.filter((n) => n === head || cont[n] > 0);
  const contagens = ordenados.map((n) => `origin/${n} ${cont[n]}`).join(', ');
  const literal = configObj(f).versionamento?.branchPadrao;
  if (typeof literal === 'string' && /^[A-Za-z0-9._/-]+$/.test(literal)) {
    return naoDet('versionamento', MOTIVO_BRANCHPADRAO, `harness.config.json:${linhaDeChave(f.textos?.config, ['versionamento', 'branchPadrao']) ?? '?'}; contagens 60 d: ${contagens}`, lista);
  }
  const concorrentes = ordenados.filter((n) => n !== head && cont[n] > 0 && cont[n] >= cont[head]);
  if (concorrentes.length > 0) return amb('versionamento', lista, `origin/HEAD -> origin/${head}; contagens 60 d: ${contagens}`, 'base de integração com mais (ou tantos) merges que origin/HEAD');
  const fonte = cont[head] === 0 ? `origin/HEAD -> origin/${head}; sem merges em 60 d` : `origin/HEAD -> origin/${head}; contagens 60 d: ${contagens}`;
  return det('versionamento', head, fonte);
}

function detectarOrquestracao(f) {
  const erro = configErro(f);
  if (erro) return naoDet('orquestracao', 'harness.config.json ilegível', 'harness.config.json');
  const D = capacidade.DEFAULTS;
  const par = configObj(f).orquestracao?.paralelismo;
  if (!ehObjeto(par)) {
    const por = f.configExistente === null ? 'sem config' : 'sem orquestracao.paralelismo';
    return det('orquestracao', { simultaneos: D.simultaneos, teto: D.teto }, `DEFAULTS de capacidade.mjs (${por})`);
  }
  // Mesma régua do runtime (T6a MINOR-1): `calcularSlots` sem medidas e sem env, então "3" ⇒ 3, 0.5 ⇒ 1, -1 ⇒ 1 e simultaneos acima do teto ⇒ teto.
  // O teto efetivo sai da mesma função com simultaneos ilimitado; a carga da máquina nunca entra (medidas `{}`, env `{}`).
  const SEM_LIMITE = Number.MAX_SAFE_INTEGER;
  const simultaneos = capacidade.calcularSlots(par, {}, {}).slots;
  const teto = capacidade.calcularSlots({ teto: par.teto, simultaneos: SEM_LIMITE }, {}, {}).slots;
  const campo = (nome, efetivo) => {
    if (par[nome] === undefined) return `${nome} DEFAULTS`;
    const l = linhaDeChave(f.textos?.config, ['orquestracao', 'paralelismo', nome]) ?? '?';
    return par[nome] === efetivo ? `${nome} config:${l}` : `${nome} config:${l} (efetivo ${efetivo})`;
  };
  return det('orquestracao', { simultaneos, teto }, `${campo('simultaneos', simultaneos)}; ${campo('teto', teto)}`);
}

/** Os 5 itens, na `ORDEM_ITENS`. Pura: só lê `fatos`. */
export function detectar(fatos) {
  return [detectarTipoRepo(fatos), detectarAmbientes(fatos), detectarPlanejamento(fatos), detectarVersionamento(fatos), detectarOrquestracao(fatos)];
}

// ────────────────────────────────────────────────────────────── perguntas, prévia e config (T6b)

export const MAX_PERGUNTAS = 5;
export const IDS_FIXAS = ['politica', 'autonomia', 'perfil'];
const POLITICAS = ['continua', 'janela', 'sob_demanda'];
const PERFIS = Object.keys(PERFIS_MODELO);
const PRODUTO = { politica: 'sob_demanda', autonomia: false, perfil: 'padrao' };
const ROTULO_POLITICA = {
  continua: 'continua: a entrega sobe sozinha quando fica pronta',
  janela: 'janela: a entrega sobe sozinha só dentro de uma janela de horário',
  sob_demanda: 'sob demanda: PR de release; você faz o merge e o deploy',
};
const ROTULO_NAO_COM_POLITICA_FROUXA = 'a entrega vira sob demanda: PR de release, você faz merge e deploy';
const fusoLocal = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const janelaPadrao = (fuso) => ({ dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '17:00', fuso });
const configLegivel = (existente) => (ehObjeto(existente) && typeof existente.erro !== 'string' ? existente : {});
const ordemDe = (item) => ORDEM_ITENS.indexOf(item);
const rotuloNulo = (item) => `deixar não detectado (trocar ${item} depois)`;

function rotuloPerfil(nome) {
  const t = PERFIS_MODELO[nome];
  const impl = `${t.implementador.modelo}${t.implementador.esforco ? `/${t.implementador.esforco}` : ''}`;
  return `${nome}: implementador ${impl}, revisor ${t.revisor.modelo}, revisão final ${t.revisor_final.modelo}`;
}

/** As 3 decisões fixas, com o default tirado da config existente (valor inválido ⇒ default do produto + `aviso`). */
function perguntasFixas(existente) {
  const cfg = configLegivel(existente);
  const ent = ehObjeto(cfg.entrega) ? cfg.entrega : {};
  const orq = ehObjeto(cfg.orquestracao) ? cfg.orquestracao : {};
  const inval = (campo, bruto, padrao) => `${campo}: config tinha ${JSON.stringify(bruto)} inválido; default ${padrao}`;
  let politica = PRODUTO.politica;
  let avisoPol;
  if (ent.politica !== undefined) {
    if (POLITICAS.includes(ent.politica)) politica = ent.politica;
    else avisoPol = inval('entrega.politica', ent.politica, PRODUTO.politica);
  }
  let autonomia = PRODUTO.autonomia;
  let avisoAut;
  if (ent.autonomia !== undefined) {
    if (typeof ent.autonomia === 'boolean') autonomia = ent.autonomia;
    else avisoAut = inval('entrega.autonomia', ent.autonomia, 'não');
  } else if (politica === 'continua' || politica === 'janela') {
    autonomia = true; // config da E3/1.1 que já subia sozinha: preserva a escolha
  }
  let perfil = PRODUTO.perfil;
  let avisoPerfil;
  if (orq.perfil !== undefined) {
    if (typeof orq.perfil === 'string' && PERFIS.includes(orq.perfil)) perfil = orq.perfil;
    else avisoPerfil = inval('orquestracao.perfil', orq.perfil, PRODUTO.perfil);
  }
  const com = (p, aviso) => (aviso ? { ...p, aviso } : p);
  return [
    com({ id: 'politica', texto: 'Política de entrega: como o loop leva a entrega pronta até a produção?', opcoes: POLITICAS.map((v) => ({ valor: v, rotulo: ROTULO_POLITICA[v] })), default: politica }, avisoPol),
    com({
      id: 'autonomia',
      texto: 'Autonomia em produção: o loop pode subir sozinho dentro da política escolhida?',
      opcoes: [
        { valor: true, rotulo: 'sim: sobe sozinho dentro da política escolhida' },
        { valor: false, rotulo: politica !== 'sob_demanda' ? ROTULO_NAO_COM_POLITICA_FROUXA : 'não: a entrega segue sob demanda' },
      ],
      default: autonomia,
    }, avisoAut),
    com({ id: 'perfil', texto: 'Perfil de modelos: qual equilíbrio entre custo e qualidade?', opcoes: PERFIS.map((v) => ({ valor: v, rotulo: rotuloPerfil(v) })), default: perfil }, avisoPerfil),
  ];
}

function perguntaDeItem(i) {
  const asked = i.estado === 'ambiguo';
  let cands = [...i.candidatos];
  if (!asked && cands.length === 0 && i.item === 'planejamento') cands = ['arquivos']; // regra da 1.1 (ferramentas-mcp.json, _comment)
  const opcoes = cands.map((c) => ({ valor: c, rotulo: String(c) }));
  if (!asked) opcoes.push({ valor: null, rotulo: rotuloNulo(i.item) });
  const padrao = asked ? i.valor : (cands[0] ?? null);
  const ref = i.motivo ? `${i.estado}, ${i.motivo}` : i.estado;
  return { id: i.item, texto: `${i.item}: ${ref} (fonte: ${i.fonte}). Qual usar?`, opcoes, default: padrao };
}

/**
 * Perguntas do onboarding: as 3 fixas (política, autonomia, perfil) e 1 por fato `ambiguo` ou `nao_detectado`, na ordem de
 * `ORDEM_ITENS`. Teto `MAX_PERGUNTAS`: o que não cabe fica sem pergunta (e sem valor: `configDasRespostas` o põe em `naoDetectado`).
 * Fato detectado nunca é perguntado. `existente` = `configExistente` dos fatos (ausente/corrompido ⇒ defaults do produto).
 */
export function perguntas(itens, existente) {
  const fixas = perguntasFixas(existente);
  const abertos = [...itens].filter((i) => i.estado !== 'detectado').sort((a, b) => ordemDe(a.item) - ordemDe(b.item));
  return [...fixas, ...abertos.slice(0, MAX_PERGUNTAS - fixas.length).map(perguntaDeItem)];
}

const valorTexto = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/** Política efetiva de uma escolha, pela função do produto (nunca reimplementada). `null` se a função recusar. */
function efetivaDe(politica, autonomia, fuso) {
  const r = politicaEfetiva(lerConfigEntrega({ entrega: { politica, autonomia, janela: janelaPadrao(fuso) } }));
  return r.ok ? r.politica : null;
}

/**
 * Prévia em texto: `detectei:` com 1 fato por linha (estado e fonte), as 3 decisões com default, a política efetiva quando
 * difere da escolhida, a janela padrão e a linha `trocar <item>`. `fuso` entra na janela padrão (CLI: o do `Intl`).
 */
export function previa(itens, perguntasDoOnboarding, { fuso = fusoLocal() } = {}) {
  const ps = Object.fromEntries(perguntasDoOnboarding.map((p) => [p.id, p]));
  const linhas = ['detectei:'];
  for (const i of itens) {
    const v = valorTexto(i.valor);
    const extra = i.item === 'ambientes' ? '; ambientes: informativo; a guarda usa guarda.ambientes' : '';
    linhas.push(`- ${i.item}: ${i.estado}${v ? ` ${v}` : ''} (fonte: ${i.fonte})${i.motivo ? `; motivo: ${i.motivo}` : ''}${extra}`);
  }
  linhas.push('', 'decido com você (default entre colchetes):');
  const fixas = [['politica', 'política de entrega'], ['autonomia', 'autonomia em produção'], ['perfil', 'perfil de modelos']];
  for (const [id, nome] of fixas) {
    const p = ps[id];
    if (!p) continue;
    const d = id === 'autonomia' ? (p.default ? 'sim' : 'não') : p.default;
    linhas.push(`- ${nome}: ${d}${p.aviso ? ` (${p.aviso})` : ''}`);
  }
  const pol = ps.politica?.default;
  const aut = ps.autonomia?.default;
  if (pol !== undefined && aut !== undefined) {
    const ef = efetivaDe(pol, aut, fuso);
    if (ef !== null && ef !== pol) linhas.push(`- política efetiva: ${ef} (escolhida ${pol}, mas a autonomia está ${aut ? 'sim' : 'não'}: só a autonomia libera a política)`);
  }
  const j = janelaPadrao(fuso);
  linhas.push(`- janela padrão, se a política for "janela" e o config não tiver uma: dias ${j.dias.join(',')}, ${j.inicio}-${j.fim}, fuso ${j.fuso}`);
  const abertos = itens.filter((i) => i.estado !== 'detectado');
  if (abertos.length > 0) {
    linhas.push('', 'fatos que preciso de você:');
    for (const i of [...abertos].sort((a, b) => ordemDe(a.item) - ordemDe(b.item))) {
      const p = ps[i.item];
      if (p) linhas.push(`- ${i.item}: pergunto (default ${valorTexto(p.default) || 'deixar não detectado'})`);
      else linhas.push(`- ${i.item}: fica nao_detectado (acima do teto de ${MAX_PERGUNTAS} perguntas); nada é gravado para ele`);
    }
  }
  linhas.push('', `Para trocar um item depois: trocar <item> (${ORDEM_ITENS.join(', ')}).`);
  return linhas.join('\n');
}

/**
 * Respostas ⇒ o que gravar. Pura: não escreve, não muta `existente`. `respostas` = `{ [id da pergunta]: valor }`; pergunta sem
 * resposta usa o default dela. `fuso` entra só na janela padrão. → `{ patches: { [secao]: object }, perfil?: 'repo-sem-app', naoDetectado }`.
 * Resolvido = detectado ou perguntado e respondido (≠ null); o resto vai a `naoDetectado` na ordem de `ORDEM_ITENS` e nada dele é gravado.
 */
export function configDasRespostas(itens, respostas, existente, hoje, { fuso = 'UTC' } = {}) {
  const cfg = configLegivel(existente);
  const ps = Object.fromEntries(perguntas(itens, existente).map((p) => [p.id, p]));
  const dado = respostas ?? {};
  const resp = (id) => (Object.hasOwn(dado, id) ? dado[id] : ps[id].default);
  const politica = resp('politica');
  const autonomia = resp('autonomia');
  const perfil = resp('perfil');
  const entrega = { politica, autonomia };
  if (politica === 'janela' && lerConfigEntrega(cfg).janela === null) entrega.janela = janelaPadrao(fuso);

  const por = Object.fromEntries(itens.map((i) => [i.item, i]));
  const resolvido = {}; // item ⇒ valor resolvido
  for (const i of itens) {
    if (i.estado === 'detectado') resolvido[i.item] = i.valor;
    else if (ps[i.item]) {
      const r = resp(i.item);
      if (r !== null && r !== undefined) resolvido[i.item] = r;
    }
  }

  const patches = { entrega };
  let perfilRaiz;
  if (resolvido.tipo_repo === 'repo-sem-app') perfilRaiz = 'repo-sem-app';

  patches.fluxo = { resolvidoEm: hoje };
  const pl = resolvido.planejamento;
  if (pl !== undefined) {
    if (ehObjeto(pl)) {
      patches.fluxo.ferramenta = pl.ferramenta;
      if (typeof pl.mcp === 'string' && pl.mcp !== '') patches.fluxo.mcp = pl.mcp;
    } else patches.fluxo.ferramenta = pl;
  }

  const literal = por.versionamento?.estado === 'nao_detectado' && por.versionamento.motivo === MOTIVO_BRANCHPADRAO;
  if (resolvido.versionamento !== undefined) {
    entrega.base = resolvido.versionamento;
    if (literal) delete resolvido.versionamento; // D-1: grava só a base; o item segue não detectado e sem `resolvidoEm`
    else patches.versionamento = { resolvidoEm: hoje };
  }

  const orq = ehObjeto(cfg.orquestracao) ? cfg.orquestracao : {};
  const modeloAtual = ehObjeto(orq.modelo) ? orq.modelo : {};
  patches.orquestracao = {
    perfil,
    modelo: {
      alias: resolverModelo({ ...orq, perfil }, 'revisor_final').modelo,
      politica: modeloAtual.politica ?? 'mais-potente',
      validadeDias: modeloAtual.validadeDias ?? 90,
      resolvidoEm: hoje,
    },
  };

  const naoDetectado = ORDEM_ITENS.filter((item) => resolvido[item] === undefined);
  patches.onboarding = { resolvidoEm: hoje, naoDetectado };
  const amb = resolvido.ambientes;
  if (amb !== undefined) {
    const outros = ehObjeto(amb) ? amb.outros : (por.ambientes?.candidatos ?? []).filter((c) => c !== amb);
    patches.onboarding.fatos = { ambientes: ehObjeto(amb) ? { producao: amb.producao, outros } : { producao: amb, outros } };
  }
  return { patches, ...(perfilRaiz ? { perfil: perfilRaiz } : {}), naoDetectado };
}

// ────────────────────────────────────────────────────────────── gravar

const falha = (erro, motivo) => ({ ok: false, erro, motivo });

function lerRespostas(caminho) {
  if (typeof caminho !== 'string' || caminho === '' || !existsSync(caminho)) return falha('respostas_ausentes', 'arquivo de respostas não existe (use --respostas <arquivo.json>)');
  let obj;
  try {
    obj = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (e) {
    return falha('respostas_invalidas', `respostas não são JSON (${String(e.message).split('\n')[0]})`);
  }
  if (!ehObjeto(obj)) return falha('respostas_invalidas', 'respostas precisam ser um objeto JSON { id: valor }');
  return { respostas: obj };
}

/**
 * Grava a config do onboarding. SEMPRE redetecta (fonte única): se o que há para perguntar mudou desde a prévia, falha fechado
 * (`deteccao_mudou`) e pede rodar `detectar` de novo. Falha ⇒ `{ ok:false, erro, motivo }` e nada escrito. Sucesso ⇒
 * `{ ok:true, diff, naoDetectado, removidas, efetiva? }` com UMA escrita de `harness.config.json` (tmp + rename); `efetiva` só quando a
 * política efetiva (função do produto, sobre a config gravada) difere da escolhida. `dryRun` não escreve.
 */
export function gravar(raiz, caminhoRespostas, { rodar = rodarReal, hoje = hojeISO(), fuso = fusoLocal(), dryRun = false } = {}) {
  const cfg = lerObjeto(join(raiz, 'harness.config.json'));
  if (cfg.erro) return falha('config_invalida', `harness.config.json ilegível (${cfg.erro})`);
  const lidas = lerRespostas(caminhoRespostas);
  if (lidas.ok === false) return lidas;
  const { respostas } = lidas;
  let fatos;
  try {
    fatos = coletarFatos(raiz, { rodar, hoje });
  } catch (e) {
    return falha('falha', String(e.message).split('\n')[0]);
  }
  const itens = detectar(fatos);
  const ps = perguntas(itens, fatos.configExistente);
  const ids = new Set(ps.map((p) => p.id));
  const semPergunta = Object.keys(respostas).filter((k) => !ids.has(k));
  const semResposta = ps.map((p) => p.id).filter((id) => !Object.hasOwn(respostas, id));
  if (semPergunta.length > 0 || semResposta.length > 0) {
    const partes = [];
    if (semPergunta.length > 0) partes.push(`resposta sem pergunta: ${semPergunta.join(', ')}`);
    if (semResposta.length > 0) partes.push(`pergunta sem resposta: ${semResposta.join(', ')}`);
    return falha('deteccao_mudou', `${partes.join('; ')}; a detecção mudou desde a prévia, rode detectar de novo`);
  }
  for (const p of ps) {
    if (!p.opcoes.some((o) => o.valor === respostas[p.id])) {
      return falha('resposta_fora_das_opcoes', `${p.id}: ${JSON.stringify(respostas[p.id])} fora das opções (${p.opcoes.map((o) => JSON.stringify(o.valor)).join(', ')})`);
    }
  }
  const { patches, perfil, naoDetectado } = configDasRespostas(itens, respostas, fatos.configExistente, hoje, { fuso });
  let r;
  try {
    r = aplicarConfig(raiz, { secoes: patches, perfil }, { dryRun });
  } catch (e) {
    if (e instanceof ArquivoInvalido) return falha('config_invalida', e.message);
    return falha('falha', String(e.message ?? e).split('\n')[0]);
  }
  const ef = politicaEfetiva(lerConfigEntrega(r.depois));
  const efetiva = ef.ok && ef.politica !== respostas.politica ? ef.politica : undefined;
  return { ok: true, diff: r.diff, naoDetectado, removidas: r.removidas, ...(efetiva !== undefined ? { efetiva } : {}), ...(dryRun ? { dryRun: true } : {}) };
}

// ────────────────────────────────────────────────────────────── CLI

function main(argv) {
  const sub = argv[0];
  if (sub !== 'detectar' && sub !== 'gravar') {
    process.stderr.write('uso: onboarding.mjs detectar [--root <d>] [--hoje AAAA-MM-DD] [--fuso <IANA>] | gravar --respostas <arquivo.json> [--root <d>] [--hoje AAAA-MM-DD] [--fuso <IANA>] [--dry-run]\n');
    return 2;
  }
  const raiz = arg(argv, 'root', null) ?? raizDoRepo(process.cwd());
  const saida = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  const hoje = arg(argv, 'hoje', hojeISO());
  const fuso = arg(argv, 'fuso', fusoLocal());
  if (sub === 'gravar') {
    const r = gravar(raiz, arg(argv, 'respostas', null), { rodar: rodarReal, hoje, fuso, dryRun: argv.includes('--dry-run') });
    saida(r);
    return r.ok ? 0 : 1;
  }
  const cfg = lerObjeto(join(raiz, 'harness.config.json'));
  if (cfg.erro) {
    saida({ ok: false, erro: 'config_invalida', motivo: `harness.config.json ilegível (${cfg.erro})` });
    return 1;
  }
  try {
    const fatos = coletarFatos(raiz, { rodar: rodarReal, hoje });
    const itens = detectar(fatos);
    const ps = perguntas(itens, fatos.configExistente);
    saida({ ok: true, itens, perguntas: ps, previa: previa(itens, ps, { fuso }) });
    return 0;
  } catch (e) {
    saida({ ok: false, erro: 'falha', motivo: String(e.message).split('\n')[0] });
    return 1;
  }
}

if (ehEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));

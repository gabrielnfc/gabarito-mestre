#!/usr/bin/env node
/**
 * REQ-LOOP-4 — gate mecânico de task.
 *
 * Roda antes de todo review: árvore limpa, commits contra a base (0 commits reprova),
 * escopo de arquivos, segredo, hatch, suítes e mutações declaradas. Nada deste repo é
 * fixo: o card vem da branch (`[A-Z]+-[0-9]+`) ou de `--card`; as suítes vêm de `--suite`
 * ou de `gates.suites` no harness.config.json da worktree.
 *
 * PRINCÍPIO: VERDE exige prova positiva. Argumento inválido, config ilegível, suíte sem
 * teste contado, RED sem medição, lista vazia: tudo reprova com a causa. Nada rodou ≠ passou.
 *
 * USO
 *   node gate-task.mjs <worktree> <base> [--card ID] [--red <arq>] [--files <arq>]
 *        [--mut <json>] [--suite <cmd>]… [--suite-sem-contagem <cmd>]…
 *   --red    arquivo com nomes de teste em RED conhecido DESTA task (um por linha; `#` comenta).
 *            Cada nome é medido falhando na base (A4), em worktree detached temporária
 *   --files  arquivo com escopo: `dir/` (barra final) = diretório; sem barra = arquivo exato
 *   --mut    JSON [{nome, arquivo, de, para, teste, cwd?}]; `teste` roda na raiz da worktree
 *   --suite  comando de suíte; só é verde com rc 0 e ao menos 1 teste contado (`tests N`/`pass N`)
 *   --suite-sem-contagem  comando que não é node --test: verde só com rc 0, marcador relatado
 * Sai 0 verde, 1 reprovado (inclui argumento inválido), 2 uso (sem worktree/base).
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';

const SEGREDO = /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{12,}|\bASIA[A-Z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE|\bsk-[A-Za-z0-9]{16,}|xox[bp]-[A-Za-z0-9-]{10,}|:\/\/[^/\s:]+:[^@\s]+@|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[\w-]{20,}\.eyJ[\w-]{20,}/;
// Literais montados: o gate não pode acusar o próprio código-fonte (hatch e allow).
const HATCH = ['GABARITO', 'ALLOW'].join('_');
const ALLOW_ADD = new RegExp(`permissionDecision["': ]+["']${['al', 'low'].join('')}`);
const MS_ZERO = 100; // mutação "morta" em menos que isto não mediu nada (E19)

// Leitor estrito do diário (dist/diario.js). Ausente ⇒ `desviosDaTask` avisa; o resto do gate não depende dele.
let lerEstrito = null;
let erroDiario = 'dist/diario.js ausente; rode node gates/scripts/build.mjs';
try {
  const m = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'diario.js')).href);
  if (typeof m.lerEstrito === 'function') lerEstrito = m.lerEstrito;
  else erroDiario = 'dist/diario.js sem lerEstrito; rode node gates/scripts/build.mjs';
} catch { /* fica o motivo acima */ }

/** Texto vindo do diário entra no relato: sem controle, tamanho limitado. */
const limpoTxt = (v, n = 120) => String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);

/**
 * Desvios (evento `desvio`) que a task desta worktree gravou no diário da entrega (GM-11 T13). Entrega e task vêm da branch
 * `wt/<entrega>-<task>`; o diário fica na raiz do checkout PRINCIPAL (`git rev-parse --git-common-dir`), também de dentro da worktree.
 * Fora de worktree de task, ou sem pasta de diário da entrega: `{ desvios: [] }` (silêncio). Diário ilegível ou de cadeia
 * quebrada: `{ aviso }`, nunca lista vazia: ausente ≠ corrompido. Nunca lança.
 */
export function desviosDaTask(worktree) {
  const git = (...a) => execFileSync('git', ['-C', worktree, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let branch;
  try { branch = git('rev-parse', '--abbrev-ref', 'HEAD'); } catch { return { desvios: [] }; }
  const m = /^wt\/([A-Z]+-\d+)-(.+)$/.exec(branch);
  if (!m) return { desvios: [] };
  const [, entrega, task] = m;
  let dir;
  try {
    dir = join(dirname(resolve(worktree, git('rev-parse', '--git-common-dir'))), '.harness', 'entregas', entrega);
  } catch (e) {
    return { aviso: `desvios não lidos (raiz do checkout principal: ${limpoTxt(String(e.stderr ?? e.message).trim().split('\n')[0])})` };
  }
  try {
    statSync(dir);
  } catch (e) {
    return e?.code === 'ENOENT' ? { desvios: [] } : { aviso: `desvios não lidos (diário da entrega ${entrega}: ${e?.code ?? 'erro'})` };
  }
  if (lerEstrito === null) return { aviso: `desvios não lidos (${erroDiario})` };
  let lido;
  try { lido = lerEstrito(dir); } catch (e) { return { aviso: `desvios não lidos (${limpoTxt(e?.name ?? 'erro', 60)})` }; }
  if (!lido.ok) return { aviso: `desvios não lidos (${limpoTxt(lido.motivo)})` };
  return { desvios: lido.eventos.filter((e) => e?.tipo === 'desvio' && e.dados?.task === task).map((e) => e.dados) };
}

/** Roda `cmd` no bash com pipefail; nunca rejeita: falha ao iniciar ou morte por sinal vira rc -1. */
export function rodarShell(nome, cmd, cwd) {
  return new Promise((ok) => {
    const t0 = performance.now();
    let out = '';
    let feito = false;
    const fim = (rc, sinal) => { if (!feito) { feito = true; ok({ nome, rc, sinal, out, ms: performance.now() - t0 }); } };
    const p = spawn('bash', ['-o', 'pipefail', '-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => { out += `erro ao iniciar: ${e.message}`; fim(-1); });
    p.on('close', (rc, sinal) => fim(rc ?? -1, sinal));
  });
}

/**
 * Nomes de teste que falharam + total de falhas declarado (soma de todos os `fail N`; null se
 * não há resumo). Com a seção "failing tests" do node, só ela dá os nomes: a suíte pai também
 * sai com ✖ mas não conta em `fail`.
 */
export function falhas(out) {
  const linhas = out.split('\n');
  const sec = linhas.findIndex((l) => /^\s*✖ failing tests:/.test(l));
  const nomes = new Set();
  for (const l of sec >= 0 ? linhas.slice(sec + 1) : linhas) {
    const m = /^\s*(?:✖|not ok \d+ - )\s*(.+?)(?:\s+\(\d|$)/.exec(l) ?? /^\s*(?:FALHA|falhou)[: ]+(.+)$/.exec(l);
    if (m && !/^(failing tests|tests|suites)/i.test(m[1])) nomes.add(m[1].trim());
  }
  return { nomes: [...nomes], declaradas: somar(out, 'fail') };
}

/** Soma de `ℹ|# <chave> N` na saída (node --test, spec ou TAP); null se nenhuma linha. */
function somar(out, chave) {
  let t = null;
  for (const m of out.matchAll(new RegExp(`^\\s*(?:ℹ|#) ${chave} (\\d+)`, 'gm'))) t = (t ?? 0) + Number(m[1]);
  return t;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Só a ausência do arquivo vale como config vazia; ilegível ou de forma errada vira `erro`. */
function lerConfig(wt) {
  const f = join(wt, 'harness.config.json');
  if (!existsSync(f)) return { cfg: {} };
  try {
    const cfg = JSON.parse(readFileSync(f, 'utf8'));
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return { cfg: {}, erro: 'a raiz não é um objeto' };
    return { cfg };
  } catch (e) {
    return { cfg: {}, erro: e.message };
  }
}

/** Devolve { suites, erros }: entrada sem `cmd` string não vazio é erro, não suíte ignorada. */
// Com --red, o resumo e o rc de partes diferentes de um comando composto se misturam: só comando simples.
const COMPOSTO = /[;&|`\n\r]|\$\(/;

function normalizarSuites(lista, comRed = false) {
  if (!Array.isArray(lista)) return { suites: [], erros: ['suítes devem ser uma lista'] };
  const suites = [];
  const erros = [];
  lista.forEach((s, i) => {
    const o = typeof s === 'string' ? { cmd: s } : (s ?? {});
    const nome = o.nome ?? `suite-${i + 1}`;
    if (typeof o.cmd !== 'string' || !o.cmd.trim()) erros.push(`suíte ${nome}: comando vazio ou ausente`);
    else if (comRed && COMPOSTO.test(o.cmd)) erros.push(`suíte ${nome}: com --red, a suíte precisa ser comando simples (sem &&, ||, ;, |, &, quebra de linha, $( ou crase): ${JSON.stringify(o.cmd.slice(0, 80))}`);
    else suites.push({ nome, cmd: o.cmd, cwd: o.cwd, semContagem: o.semContagem === true });
  });
  return { suites, erros };
}

/**
 * opts: { wt, base, card?, red?: string[], files?: string[], mutacoes?: [],
 *         suites?: (string|{nome,cmd,cwd?,semContagem?})[], proibidos?: string[] (regex), rodar?: fn }
 * Devolve { reprova, alertas, relato, suites, testes, mutacoes, semContagem } (os quatro últimos
 * contam o que rodou e provou: VERDE sem nenhum é impossível).
 */
export async function avaliar(opts) {
  const { wt, base } = opts;
  const rodar = opts.rodar ?? rodarShell;
  const relato = [];
  let reprova = 0;
  let alertas = 0;
  let nSuites = 0;
  let nTestes = 0;
  let nSemContagem = 0;
  let nMortas = 0;
  const falhar = (m) => { reprova++; relato.push(`FALHA  ${m}`); };
  const ok = (m) => relato.push(`ok     ${m}`);
  const alerta = (m) => { alertas++; relato.push(`ALERTA ${m}`); };
  const aviso = (m) => relato.push(`AVISO  ${m}`);
  const resultado = () => ({ reprova, alertas, relato, suites: nSuites, testes: nTestes, mutacoes: nMortas, semContagem: nSemContagem });
  const git = (...a) => execFileSync('git', ['-C', wt, '-c', 'core.quotePath=off', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    falhar(`base inexistente: "${base}" não resolve para um commit em ${wt}`);
    return resultado();
  }

  const { cfg, erro: erroCfg } = lerConfig(wt);
  if (erroCfg) falhar(`harness.config.json ilegível: ${erroCfg}`);
  const red = new Set(opts.red ?? []);
  let proibidosRaw = opts.proibidos ?? cfg.gates?.proibidos ?? [];
  if (!Array.isArray(proibidosRaw)) { falhar('gates.proibidos deve ser uma lista de regex'); proibidosRaw = []; }
  const proibidos = [];
  for (const r of proibidosRaw) {
    try { proibidos.push(new RegExp(r)); } catch { falhar(`regex proibida inválida: ${JSON.stringify(r)}`); }
  }

  // Card: --card ou a branch. Sem card o padrão de commit não tem como ser conferido.
  let card = opts.card;
  if (!card) {
    let branch = '';
    try { branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim(); } catch { /* sem branch */ }
    card = /[A-Z]+-[0-9]+/.exec(branch)?.[0];
  }
  if (!card) {
    falhar('sem card: a branch não tem [A-Z]+-[0-9]+ e --card não foi dado; commits não podem ser conferidos');
    return resultado();
  }

  // 1. Árvore limpa, uma regra só nas três fases (início, depois das suítes, depois das mutações): rastreado alterado ou
  // não rastreado novo reprova; ignorado (`!!`) nunca reprova e é relatado. A forma é fixa e igual à de `loop.mjs`
  // (STATUS_SUJEIRA): a config local do git (status.showUntrackedFiles=no, status.branch=true) não esconde arquivo novo nem
  // inventa linha. Ignorado não reprova porque execução que falha gera artefato próprio (`test-results/` só existe quando o
  // teste falha) e porque node_modules da worktree é legítimo (`loop.mjs integrar` o relata e remove). Única exceção:
  // `.tmp-gabarito/`, o TMPDIR que o loop dá à worktree (ignora a si mesmo; o `fechar` o confere e remove).
  const status = () => git('status', '--porcelain', '--untracked-files=normal', '--ignored', '--ignore-submodules=none').split('\n').filter((l) => l !== '' && l !== '!! .tmp-gabarito/');
  const limpo = (linhas) => linhas.filter((l) => !l.startsWith('!! '));
  const lista = (linhas) => linhas.slice(0, 10).join(', ') + (linhas.length > 10 ? `, … (+${linhas.length - 10})` : '');
  const inicial = status();
  const sujo = limpo(inicial).join('\n').trim();
  const ignorados = inicial.filter((l) => l.startsWith('!! '));
  sujo ? falhar(`árvore suja: ${sujo.split('\n').length} arquivo(s)`) : ok('árvore limpa');
  if (ignorados.length) aviso(`${ignorados.length} ignorado(s) na worktree: ${ignorados.map((l) => l.slice(3)).join(', ')}`);

  // 2. Conventional Commits com o card
  const commits = git('log', '--format=%s', `${base}..HEAD`).trim().split('\n').filter(Boolean);
  const c = esc(card);
  const padrao = new RegExp(`^(feat|fix|enabler|debt|spike|task|perf|refactor)\\(${c}\\): |^(docs|test|chore|ci|build)(\\(${c}\\))?: `);
  const ruins = commits.filter((s) => !padrao.test(s));
  if (!commits.length) falhar('0 commits contra a base: base errada, checagens de diff seriam vazias');
  ruins.length ? falhar(`commit fora do padrão: ${ruins.join(' | ')}`) : commits.length && ok(`${commits.length} commit(s) no padrão`);

  // 3. Escopo: `dir/` é prefixo; sem barra final é arquivo exato. --no-renames: os dois lados contam.
  const arquivos = git('diff', '--name-only', '--no-renames', `${base}..HEAD`).trim().split('\n').filter(Boolean);
  if (opts.files === undefined) {
    aviso('escopo não verificado: sem --files');
  } else if (!Array.isArray(opts.files) || !opts.files.length || opts.files.some((p) => typeof p !== 'string' || !p.trim())) {
    falhar('escopo vazio ou malformado: lista de --files sem entradas válidas (escopo "nada" não é escopo "tudo")');
  } else {
    const dentro = (a) => opts.files.some((p) => (p.endsWith('/') ? a.startsWith(p) : a === p));
    const fora = arquivos.filter((a) => !dentro(a));
    fora.length ? falhar(`fora do escopo: ${fora.join(', ')}`) : ok(`${arquivos.length} arquivo(s) dentro do escopo`);
  }
  const proib = arquivos.filter((a) => proibidos.some((r) => r.test(a)));
  proib.length ? falhar(`arquivo proibido no diff: ${proib.join(', ')}`) : ok('sem arquivo proibido');

  // 4. Segredo (por arquivo: teste só lista, produto reprova), hatch e allow
  const doTeste = (f) => /(^|\/)test(s)?\//.test(f) || /\.test\.[mc]?[jt]s$/.test(f);
  const adicionadas = [];
  let atual = '';
  for (const l of git('diff', '-U0', `${base}..HEAD`).split('\n')) {
    if (l.startsWith('+++ ')) atual = l.slice(4).replace(/^b\//, '');
    else if (l.startsWith('+')) adicionadas.push({ f: atual, l: l.slice(1) });
  }
  const seg = adicionadas.filter((a) => SEGREDO.test(a.l));
  const segProduto = seg.filter((a) => !doTeste(a.f));
  if (segProduto.length) falhar(`possível segredo: ${segProduto.length} linha(s) em ${[...new Set(segProduto.map((a) => a.f))].join(', ')}`);
  else ok(seg.length ? `segredo: ${seg.length} linha(s) só em arquivo de teste, revisor confere` : 'sem segredo no diff');
  const contaHatch = (ref) => {
    try {
      return git('grep', '-c', HATCH, ref, '--', '.', ':(exclude)*/test/*', ':(exclude)*.test.*')
        .trim().split('\n').filter(Boolean).reduce((n, l) => n + Number(l.split(':').pop()), 0);
    } catch {
      return 0; // git grep sai 1 sem ocorrência
    }
  };
  const hatchAntes = contaHatch(base);
  const hatchDepois = contaHatch('HEAD');
  hatchDepois > hatchAntes ? falhar(`${HATCH} aumentou: ${hatchAntes} -> ${hatchDepois}`) : ok(`hatch não aumentou (${hatchAntes} -> ${hatchDepois})`);
  adicionadas.some((a) => ALLOW_ADD.test(a.l)) ? falhar('allow adicionado') : ok('sem allow adicionado');

  // 4b. Desvios que a task registrou (GM-11 T13): só relato, nunca reprova. Não ler ≠ não haver: vira aviso.
  const dv = desviosDaTask(wt);
  if (dv.aviso) relato.push(`aviso: ${dv.aviso}`);
  for (const d of dv.desvios ?? []) {
    const arqs = Array.isArray(d.arquivos) ? d.arquivos.map((a) => limpoTxt(a, 200)).join(', ') : '';
    relato.push(`desvio: ${[limpoTxt(d.req, 60), arqs].filter(Boolean).join(' ')} (${limpoTxt(d.causa, 20)})`);
  }

  // 5. Suítes, em paralelo. Verde = rc 0 + teste contado (ou marcador declarado); nada menos.
  const { suites, erros: errosSuites } = normalizarSuites(opts.suites ?? cfg.gates?.suites ?? [], red.size > 0);
  errosSuites.forEach((e) => falhar(e));
  if (!suites.length && !errosSuites.length) falhar('nenhuma suíte declarada (--suite, --suite-sem-contagem ou gates.suites): nada foi executado');
  const rs = await Promise.all(suites.map((s) => rodar(s.nome, s.cmd, s.cwd ? resolve(wt, s.cwd) : wt)));
  for (const [i, s] of rs.entries()) {
    const seg = (s.ms / 1000).toFixed(1);
    const { nomes, declaradas } = falhas(s.out);
    const novas = nomes.filter((n) => !red.has(n));
    const anormal = s.rc < 0 || s.rc > 128 || Boolean(s.sinal);
    if (s.rc === 0) {
      const n = somar(s.out, 'pass') ?? somar(s.out, 'tests');
      if (declaradas > 0) falhar(`${s.nome} rc=0 mas a saída declara fail ${declaradas} (${seg}s)`);
      else if (suites[i].semContagem) {
        ok(`${s.nome} verde sem contagem de testes, marcador declarado (${seg}s)`);
        nSuites++; nSemContagem++;
      } else if (!n) falhar(`${s.nome} rc=0 sem prova: nenhum teste contado na saída (precisa de "tests N"/"pass N" com N>=1, ou --suite-sem-contagem) (${seg}s)`);
      else { ok(`${s.nome} verde: ${n} teste(s) (${seg}s)`); nSuites++; nTestes += n; }
    } else if (!anormal && s.rc === 1 && !suites[i].semContagem && declaradas > 0 && nomes.length === declaradas && !novas.length) {
      ok(`${s.nome} só RED conhecido: ${nomes.length} (${seg}s)`);
      nSuites++; nTestes += somar(s.out, 'tests') ?? 0;
    } else {
      const motivo = anormal ? ' [rc anormal ou morte por sinal: nunca é RED]'
        : declaradas === null ? ' [saída sem resumo de falhas]'
          : declaradas !== nomes.length ? ` [${declaradas} falha(s) declarada(s), ${nomes.length} nome(s) reconhecido(s)]` : '';
      falhar(`${s.nome} rc=${s.rc} (${seg}s): ${novas.slice(0, 8).join(' | ') || s.out.split('\n').slice(-6).join(' / ')}${motivo}`);
    }
  }

  // 5a. A suíte não pode deixar rastreado alterado nem não rastreado novo (o `fechar` recusaria depois com worktree_suja).
  const posSuites = status();
  const mudouSuites = limpo(posSuites).filter((l) => !limpo(inicial).includes(l));
  if (mudouSuites.length) falhar(`suíte alterou a árvore: ${lista(mudouSuites)}`);

  // 5b. A4: nome em --red só vale se falha na base (medido em worktree detached temporária)
  if (red.size && suites.length) await medirBase({ red, suites, base, git, rodar, ok, falhar, alerta });

  // 6. Mutações declaradas, em série na mesma árvore; restauração em finally
  const mutacoes = opts.mutacoes ?? [];
  if (opts.mutacoes !== undefined && (!Array.isArray(opts.mutacoes) || !opts.mutacoes.length)) {
    falhar('mutações deve ser uma lista não vazia de objetos {nome, arquivo, de, para, teste}');
  } else if (mutacoes.length) {
    const minMs = opts.minMs ?? MS_ZERO;
    const basal = new Map();
    for (const m of mutacoes) {
      const bem = m && typeof m === 'object' && ['nome', 'arquivo', 'de', 'para', 'teste'].every((k) => typeof m[k] === 'string')
        && m.nome && m.arquivo && m.de && m.teste.trim();
      if (!bem) {
        const falta = m && typeof m === 'object' ? ['nome', 'arquivo', 'de', 'para', 'teste'].filter((k) => typeof m[k] !== 'string' || (k !== 'para' && !m[k])) : ['objeto'];
        falhar(`mutação ${m?.nome ?? '?'}: campo(s) ausente(s) ou não texto: ${falta.map((k) => `"${k}"`).join(', ')}`);
        continue;
      }
      const cwd = m.cwd ? resolve(wt, m.cwd) : wt;
      const chave = `${cwd}\0${m.teste}`;
      if (!basal.has(chave)) {
        const r0 = await rodar(`${m.nome} sem mutação`, m.teste, cwd);
        basal.set(chave, r0.rc);
        if (r0.rc !== 0) falhar(`teste da mutação ${m.nome} já falha sem mutação: morte seria falsa`);
      }
      if (basal.get(chave) !== 0) continue;
      const alvo = resolve(wt, m.arquivo);
      const rel = relative(resolve(wt), alvo);
      if (rel.startsWith('..') || isAbsolute(rel)) { falhar(`mutação ${m.nome}: arquivo fora da worktree (${m.arquivo})`); continue; }
      if (!existsSync(alvo)) { falhar(`mutação ${m.nome}: arquivo não existe (${m.arquivo})`); continue; }
      const orig = readFileSync(alvo, 'utf8');
      const n = m.de ? orig.split(m.de).length - 1 : 0;
      if (n === 0) { falhar(`mutação ${m.nome}: trecho não encontrado`); continue; }
      if (n > 1) { falhar(`mutação ${m.nome}: trecho "de" aparece ${n} vezes em ${m.arquivo}; use um trecho único`); continue; }
      if (m.de === m.para) { falhar(`mutação ${m.nome}: "para" não altera o código`); continue; }
      let r;
      try {
        writeFileSync(alvo, orig.replace(m.de, () => m.para));
        r = await rodar(m.nome, m.teste, cwd);
      } finally {
        writeFileSync(alvo, orig);
      }
      const seg = (r.ms / 1000).toFixed(2);
      if (r.rc === 0) falhar(`mutação ${m.nome} VIVA (${seg}s)`);
      else if (r.ms < minMs) alerta(`mutação ${m.nome} falhou em ${seg}s (tempo ~zero): o teste provavelmente não rodou; morte não provada`);
      else { ok(`mutação ${m.nome} morta (${seg}s)`); nMortas++; }
    }
    limpo(status()).join('\n') !== limpo(posSuites).join('\n') ? falhar('mutação deixou árvore alterada') : ok('árvore restaurada após mutações');
  }

  // Ignorado novo (gerado pela suíte ou pelas mutações) é relatado, nunca reprova.
  const novosIgnorados = status().filter((l) => l.startsWith('!! ') && !inicial.includes(l));
  if (novosIgnorados.length) aviso(`${novosIgnorados.length} ignorado(s) gerado(s) no gate: ${lista(novosIgnorados.map((l) => l.slice(3)))}`);

  // Relato limpo sem nenhuma suíte provada não existe (cinto sobre os suspensórios acima).
  if (!reprova && !nSuites) falhar('nada foi executado: nenhuma suíte provada');
  return resultado();
}

/**
 * A4: mede, numa worktree detached temporária da base e com as mesmas suítes, quais testes falham;
 * todo nome de `red` precisa estar entre eles. Remove a worktree sem --force; se não sair, relata.
 */
async function medirBase({ red, suites, base, git, rodar, ok, falhar, alerta }) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-base-'));
  let criada = false;
  try {
    try {
      git('worktree', 'add', '--detach', dir, base);
      criada = true;
    } catch (e) {
      falhar(`A4: não consegui criar a worktree da base ${base}: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`);
      alerta(`diretório temporário vazio restante: ${dir}`);
      return;
    }
    const rs = await Promise.all(suites.map((s) => rodar(`${s.nome} @base`, s.cmd, s.cwd ? resolve(dir, s.cwd) : dir)));
    const naBase = new Set(rs.flatMap((r) => falhas(r.out).nomes));
    for (const n of red) {
      naBase.has(n) ? ok(`RED "${n}" medido na base (A4)`) : falhar(`RED "${n}" não falha na base ${base} (A4): alegação de falha pré-existente sem medição`);
    }
  } finally {
    if (criada) {
      try {
        git('worktree', 'remove', dir);
      } catch (e) {
        alerta(`worktree temporária restante: ${dir} (git worktree remove, sem --force, recusou: ${String(e.stderr ?? e.message).trim().split('\n')[0]})`);
      }
    }
  }
}

const FLAGS = ['--card', '--red', '--files', '--mut', '--suite', '--suite-sem-contagem'];
const UNICAS = ['--card', '--red', '--files', '--mut'];

/** Lê uma lista de arquivo (`#` comenta). Devolve { lista } ou { erro }. */
function lerLista(flag, f) {
  let txt;
  try { txt = readFileSync(f, 'utf8'); } catch (e) { return { erro: `${flag}: não consegui ler ${f} (${e.code ?? e.message})` }; }
  const lista = txt.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  return lista.length ? { lista } : { erro: `${flag}: ${f} sem entradas (vazio ou só comentários)` };
}

/** Argumentos estritos: flag desconhecida, sem valor, repetida ou arquivo ruim vira erro com a causa. */
export function lerArgs(argv) {
  const erros = [];
  const v = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!FLAGS.includes(a)) { erros.push(`argumento desconhecido: ${a}`); continue; }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) { erros.push(`${a} sem valor`); continue; }
    (v[a] ??= []).push(val);
    i++;
  }
  for (const f of UNICAS) if (v[f]?.length > 1) erros.push(`${f} repetido`);
  const opts = { card: v['--card']?.[0] };
  for (const [flag, campo] of [['--red', 'red'], ['--files', 'files']]) {
    if (!v[flag]) continue;
    const r = lerLista(flag, v[flag][0]);
    r.erro ? erros.push(r.erro) : (opts[campo] = r.lista);
  }
  if (v['--mut']) {
    try {
      const m = JSON.parse(readFileSync(v['--mut'][0], 'utf8'));
      if (!Array.isArray(m) || !m.length) erros.push('--mut: o JSON deve ser uma lista não vazia de mutações');
      else opts.mutacoes = m;
    } catch (e) {
      erros.push(e instanceof SyntaxError ? `--mut: JSON inválido em ${v['--mut'][0]} (${e.message})` : `--mut: não consegui ler ${v['--mut'][0]} (${e.code ?? e.message})`);
    }
  }
  const suites = [
    ...(v['--suite'] ?? []).map((cmd) => ({ cmd })),
    ...(v['--suite-sem-contagem'] ?? []).map((cmd) => ({ cmd, semContagem: true })),
  ];
  if (suites.length) opts.suites = suites.map((s, i) => ({ nome: `suite-${i + 1}`, ...s }));
  return { opts, erros };
}

async function main(argv) {
  const [wt, base, ...resto] = argv;
  if (!wt || !base || wt.startsWith('--') || base.startsWith('--')) {
    process.stderr.write('uso: gate-task.mjs <worktree> <base> [--card ID] [--red arq] [--files arq] [--mut json] [--suite cmd]… [--suite-sem-contagem cmd]…\n');
    process.exit(2);
  }
  const t0 = Date.now();
  const { opts, erros } = lerArgs(resto);
  let r;
  if (erros.length) {
    r = { reprova: erros.length, alertas: 0, relato: erros.map((e) => `FALHA  argumento: ${e}`) };
  } else {
    r = await avaliar({ wt, base, ...opts });
  }
  const contagem = r.reprova ? '' : ` (${r.suites} suítes, ${r.testes} testes, ${r.mutacoes} mutações)${r.semContagem ? ` com ${r.semContagem} suíte(s) sem contagem` : ''}`;
  console.log(r.relato.join('\n'));
  console.log(`\nGATE ${r.reprova ? `REPROVADO (${r.reprova})` : `VERDE${contagem}`}${r.alertas ? ` com ${r.alertas} alerta(s)` : ''} em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(r.reprova ? 1 : 0);
}

if (ehEntrypoint(import.meta.url)) main(process.argv.slice(2));

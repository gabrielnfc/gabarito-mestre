#!/usr/bin/env node
/**
 * REQ-LOOP-4 — gate mecânico de task.
 *
 * Roda antes de todo review: árvore limpa, commits contra a base (0 commits reprova),
 * escopo de arquivos, segredo, hatch, suítes e mutações declaradas. Nada deste repo é
 * fixo: o card vem da branch (`[A-Z]+-[0-9]+`) ou de `--card`; as suítes vêm de `--suite`
 * ou de `gates.suites` no harness.config.json da worktree.
 *
 * USO
 *   node gate-task.mjs <worktree> <base> [--card ID] [--red <arq>] [--files <arq>]
 *        [--mut <json>] [--suite <cmd>]…
 *   --red    arquivo com nomes de teste em RED conhecido DESTA task (um por linha)
 *   --files  arquivo com escopo: `dir/` (barra final) = diretório; sem barra = arquivo exato
 *   --mut    JSON [{nome, arquivo, de, para, teste, cwd?}]; `teste` roda na raiz da worktree
 * Sai 0 verde, 1 reprovado, 2 uso.
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ehEntrypoint } from '../lib/cli.mjs';

const SEGREDO = /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{12,}|\bASIA[A-Z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE|\bsk-[A-Za-z0-9]{16,}|xox[bp]-[A-Za-z0-9-]{10,}|:\/\/[^/\s:]+:[^@\s]+@|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[\w-]{20,}\.eyJ[\w-]{20,}/;
const MS_ZERO = 100; // mutação "morta" em menos que isto não mediu nada (E19)

/** Roda `cmd` no bash; nunca rejeita: falha ao iniciar vira rc -1 com a mensagem em `out`. */
export function rodarShell(nome, cmd, cwd) {
  return new Promise((ok) => {
    const t0 = performance.now();
    let out = '';
    let feito = false;
    const fim = (rc) => { if (!feito) { feito = true; ok({ nome, rc, out, ms: performance.now() - t0 }); } };
    const p = spawn('bash', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => { out += `erro ao iniciar: ${e.message}`; fim(-1); });
    p.on('close', (rc) => fim(rc ?? -1));
  });
}

/** Nomes de teste que falharam na saída + quantas falhas a saída declara (null se não declara). */
export function falhas(out) {
  const nomes = new Set();
  for (const l of out.split('\n')) {
    const m = /^\s*(?:✖|not ok \d+ - )\s*(.+?)(?:\s+\(\d|$)/.exec(l) ?? /^\s*(?:FALHA|falhou)[: ]+(.+)$/.exec(l);
    if (m && !/^(failing tests|tests|suites)/i.test(m[1])) nomes.add(m[1].trim());
  }
  const d = /^\s*(?:ℹ|#) fail (\d+)/m.exec(out);
  return { nomes: [...nomes], declaradas: d ? Number(d[1]) : null };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lerConfig(wt) {
  try {
    return JSON.parse(readFileSync(join(wt, 'harness.config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function normalizarSuites(lista) {
  return (lista ?? []).map((s, i) => (typeof s === 'string' ? { nome: `suite-${i + 1}`, cmd: s } : { nome: s.nome ?? `suite-${i + 1}`, cmd: s.cmd, cwd: s.cwd }));
}

/**
 * opts: { wt, base, card?, red?: string[], files?: string[], mutacoes?: [], suites?: (string|{nome,cmd,cwd?})[],
 *         proibidos?: string[] (regex), rodar?: fn }
 * Devolve { reprova, alertas, relato }.
 */
export async function avaliar(opts) {
  const { wt, base } = opts;
  const rodar = opts.rodar ?? rodarShell;
  const cfg = lerConfig(wt);
  const red = new Set(opts.red ?? []);
  const prefixos = opts.files ?? [];
  const proibidos = (opts.proibidos ?? cfg.gates?.proibidos ?? []).map((r) => new RegExp(r));
  const relato = [];
  let reprova = 0;
  let alertas = 0;
  const falhar = (m) => { reprova++; relato.push(`FALHA  ${m}`); };
  const ok = (m) => relato.push(`ok     ${m}`);
  const alerta = (m) => { alertas++; relato.push(`ALERTA ${m}`); };
  const aviso = (m) => relato.push(`AVISO  ${m}`);
  const resultado = () => ({ reprova, alertas, relato });
  const git = (...a) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    falhar(`base inexistente: "${base}" não resolve para um commit em ${wt}`);
    return resultado();
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

  // 1. Árvore limpa
  const sujo = git('status', '--short').trim();
  sujo ? falhar(`árvore suja: ${sujo.split('\n').length} arquivo(s)`) : ok('árvore limpa');

  // 2. Conventional Commits com o card
  const commits = git('log', '--format=%s', `${base}..HEAD`).trim().split('\n').filter(Boolean);
  const c = esc(card);
  const padrao = new RegExp(`^(feat|fix|enabler|debt|spike|task|perf|refactor)\\(${c}\\): |^(docs|test|chore|ci|build)(\\(${c}\\))?: `);
  const ruins = commits.filter((s) => !padrao.test(s));
  if (!commits.length) falhar('0 commits contra a base: base errada, checagens de diff seriam vazias');
  ruins.length ? falhar(`commit fora do padrão: ${ruins.join(' | ')}`) : commits.length && ok(`${commits.length} commit(s) no padrão`);

  // 3. Escopo de arquivos: `dir/` é prefixo; sem barra final é arquivo exato
  const arquivos = git('diff', '--name-only', `${base}..HEAD`).trim().split('\n').filter(Boolean);
  if (prefixos.length) {
    const dentro = (a) => prefixos.some((p) => (p.endsWith('/') ? a.startsWith(p) : a === p));
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
      return git('grep', '-c', 'GABARITO_ALLOW', ref, '--', '.', ':(exclude)*/test/*', ':(exclude)*.test.*')
        .trim().split('\n').filter(Boolean).reduce((n, l) => n + Number(l.split(':').pop()), 0);
    } catch {
      return 0; // git grep sai 1 sem ocorrência
    }
  };
  const hatchAntes = contaHatch(base);
  const hatchDepois = contaHatch('HEAD');
  hatchDepois > hatchAntes ? falhar(`GABARITO_ALLOW aumentou: ${hatchAntes} -> ${hatchDepois}`) : ok(`hatch não aumentou (${hatchAntes} -> ${hatchDepois})`);
  adicionadas.some((a) => /permissionDecision["': ]+["']allow/.test(a.l)) ? falhar('allow adicionado') : ok('sem allow adicionado');

  // 5. Suítes, em paralelo
  const suites = normalizarSuites(opts.suites ?? cfg.gates?.suites);
  if (!suites.length) aviso('nenhuma suíte declarada (--suite ou gates.suites): nada foi executado');
  const rs = await Promise.all(suites.map((s) => rodar(s.nome, s.cmd, s.cwd ? resolve(wt, s.cwd) : wt)));
  for (const s of rs) {
    const seg = (s.ms / 1000).toFixed(1);
    const { nomes, declaradas } = falhas(s.out);
    const novas = nomes.filter((n) => !red.has(n));
    const semNome = declaradas !== null && declaradas > nomes.length;
    if (s.rc === 0) ok(`${s.nome} verde (${seg}s)`);
    else if (nomes.length && !novas.length && !semNome) ok(`${s.nome} só RED conhecido: ${nomes.length} (${seg}s)`);
    else falhar(`${s.nome} rc=${s.rc} (${seg}s): ${novas.slice(0, 8).join(' | ') || s.out.split('\n').slice(-6).join(' / ')}${semNome ? ` [${declaradas - nomes.length} falha(s) sem nome reconhecível]` : ''}`);
  }

  // 6. Mutações declaradas, em série na mesma árvore; restauração em finally
  const mutacoes = opts.mutacoes ?? [];
  if (mutacoes.length) {
    const minMs = opts.minMs ?? MS_ZERO;
    const basal = new Map();
    for (const m of mutacoes) {
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
      else ok(`mutação ${m.nome} morta (${seg}s)`);
    }
    git('status', '--short').trim() !== sujo ? falhar('mutação deixou árvore alterada') : ok('árvore restaurada após mutações');
  }

  return resultado();
}

const lerLista = (f) => (f ? readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);

async function main(argv) {
  const [wt, base, ...resto] = argv;
  if (!wt || !base || wt.startsWith('--') || base.startsWith('--')) {
    process.stderr.write('uso: gate-task.mjs <worktree> <base> [--card ID] [--red arq] [--files arq] [--mut json] [--suite cmd]…\n');
    process.exit(2);
  }
  const valores = (n) => resto.flatMap((a, i) => (a === n && resto[i + 1] !== undefined ? [resto[i + 1]] : []));
  const um = (n) => valores(n)[0];
  const t0 = Date.now();
  const suites = valores('--suite');
  const mutFile = um('--mut');
  const r = await avaliar({
    wt, base, card: um('--card'),
    red: lerLista(um('--red')),
    files: lerLista(um('--files')),
    mutacoes: mutFile ? JSON.parse(readFileSync(mutFile, 'utf8')) : [],
    suites: suites.length ? suites : undefined,
  });
  console.log(r.relato.join('\n'));
  console.log(`\nGATE ${r.reprova ? `REPROVADO (${r.reprova})` : 'VERDE'}${r.alertas ? ` com ${r.alertas} alerta(s)` : ''} em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(r.reprova ? 1 : 0);
}

if (ehEntrypoint(import.meta.url)) main(process.argv.slice(2));

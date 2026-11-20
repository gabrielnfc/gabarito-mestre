/**
 * GM-16 T6: gerador do repositório grande SINTÉTICO do aceite da visão de projeto. Nada daqui vem de outro projeto: nomes, IDs, títulos e status são inventados
 * (PBI-n, EPIC-n, "Status X1"); só a FORMA (contagens e formatos de cabeçalho) segue o que o S1 e o S2 mediram. Tudo é gerado em diretório temporário.
 *
 * Números (os do S1/S2, reproduzidos):
 *   cards: 91, todos com `epic` no frontmatter; 9 status (5 colunas do quadro + "Status X1..X4"); 47 opções (status fora do quadro), 43 PBIs abertos em coluna, 1 feito
 *   Epics: 7 (EPIC-1..7); com PBI aberto em coluna: 5 (EPIC-1..5); as opções espalham-se por EPIC-1..7
 *   planos: 38 legíveis (docs/plans/plano-k.md) nos 38 primeiros PBIs abertos em coluna; 37 com cabeçalho de task, 1 sem nenhum
 *   cabeçalhos contados: 265 = 182 `## Task N —` + 27 `## Task N:` + 4 `### Task N:` + 27 `## TN —` + 18 `### TN:` + 6 `## Task N (nota) —` + 1 `### Task N (nota):`
 *   ruído fora da conta: 22 cabeçalhos dentro de bloco cercado (``` e ~~~) e 1 `Task N` sem separador num plano contado
 *   doutor: 28 PBIs abertos com commit `feat(PBI-n): ...` no 1º pai da base `main`
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const CONFIG_BASE = JSON.parse(readFileSync(join(AQUI, 'config.json'), 'utf8'));
export const COLUNAS_ABERTAS = ['Preparado', 'Em execução', 'Revisão e teste', 'Pronto para liberar'];
export const STATUS_OPCAO = ['Status X1', 'Status X2', 'Status X3', 'Status X4'];
export const FORMATOS = [
  { id: 'task-h2-trav', n: 182, f: (i) => `## Task ${i} — passo sintético ${i}` },
  { id: 'task-h2-dois', n: 27, f: (i) => `## Task ${i}: passo sintético ${i}` },
  { id: 'task-h3-dois', n: 4, f: (i) => `### Task ${i}: passo sintético ${i}` },
  { id: 't-h2-trav', n: 27, f: (i) => `## T${i} — passo sintético ${i}` },
  { id: 't-h3-dois', n: 18, f: (i) => `### T${i}: passo sintético ${i}` },
  { id: 'task-h2-nota', n: 6, f: (i) => `## Task ${i} (nota sintética) — passo sintético ${i}` },
  { id: 'task-h3-nota', n: 1, f: (i) => `### Task ${i} (nota sintética): passo sintético ${i}` },
];
export const N_CARDS = 91, N_OPCOES = 47, N_ABERTOS = 43, N_FEITOS = 1, N_PLANOS = 38, N_PLANOS_COM_TASK = 37, N_CABECALHOS = 265, N_CERCADOS = 22, N_COMMITS_PBI = 28;

/** Embaralhamento determinístico (LCG): a mesma fixture em toda máquina. */
function embaralhar(xs, semente) {
  let s = semente >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Descrição pura (sem disco) do que a fixture tem; o teste confere o disco contra ela e o painel contra ela. */
export function descrever({ limpo = false } = {}) {
  const tipos = embaralhar([...Array(N_OPCOES).fill('opcao'), ...Array(N_ABERTOS).fill('aberto'), ...Array(N_FEITOS).fill('feito')], 16);
  let o = 0, a = 0;
  const cards = tipos.map((tipo, i) => {
    const id = `PBI-${i + 1}`;
    if (tipo === 'opcao') { const k = o++; return { id, tipo, status: limpo ? 'Preparado' : STATUS_OPCAO[k % 4], epic: `EPIC-${(k % 7) + 1}`, plano: null }; }
    if (tipo === 'aberto') { const k = a++; return { id, tipo, status: COLUNAS_ABERTAS[k % 4], epic: `EPIC-${(k % 5) + 1}`, plano: null }; }
    return { id, tipo, status: 'Concluído', epic: 'EPIC-1', plano: null };
  });
  // 38 planos nos 38 primeiros abertos em coluna; o plano de índice 10 é o que não tem cabeçalho de task
  const abertos = cards.filter((c) => c.tipo === 'aberto');
  const SEM_CABECALHO = 10;
  const lista = embaralhar(FORMATOS.flatMap((fm) => Array(fm.n).fill(fm)), 161);
  const tamanhos = Array.from({ length: N_PLANOS_COM_TASK }, (_, k) => (k < N_CABECALHOS - 7 * N_PLANOS_COM_TASK ? 8 : 7));
  let pos = 0;
  const planos = [];
  for (let k = 0; k < N_PLANOS; k++) {
    const card = abertos[k];
    const arquivo = `docs/plans/plano-${k + 1}.md`;
    card.plano = arquivo;
    if (k === SEM_CABECALHO) { planos.push({ arquivo, card: card.id, tasks: 0, formatos: [] }); continue; }
    const tam = tamanhos[k < SEM_CABECALHO ? k : k - 1];
    const fs = lista.slice(pos, pos + tam);
    pos += tam;
    planos.push({ arquivo, card: card.id, tasks: tam, formatos: fs.map((x) => x.id) });
  }
  const abertasTodas = cards.filter((c) => c.tipo !== 'feito');
  const comCommit = abertasTodas.filter((_, i) => i % 3 === 0).slice(0, N_COMMITS_PBI).map((c) => c.id);
  return { cards, planos, comCommit, epics: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `EPIC-${n}`, titulo: `Grupo sintético ${n}` })), semCabecalho: planos[SEM_CABECALHO].arquivo };
}

function textoDoPlano(p, formatos, k) {
  const fs = Object.fromEntries(FORMATOS.map((fm) => [fm.id, fm.f]));
  const linhas = [`# Plano sintético ${k}`, '', 'Contexto escrito só para o teste.', ''];
  const cerca = k % 2 === 0 ? '```' : '~~~';
  if (formatos.length === 0) {
    linhas.push('Este plano só tem prosa.', '', cerca, '## Task 91 — exemplo dentro de bloco', cerca, '');
    return linhas.join('\n');
  }
  formatos.forEach((id, i) => {
    linhas.push(fs[id](i + 1), '', `Passos do item ${i + 1}, em prosa.`, '');
    if (i === 1 && k <= 21) linhas.push(cerca, '## Task 92 — exemplo dentro de bloco', cerca, '');
    if (i === 2 && k === 30) linhas.push('## Task 95 sem separador', '');
  });
  return linhas.join('\n');
}

const GIT_AMB = (home) => ({ PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' });

/** `git` com user.name/user.email definidos, `user.useConfigOnly`, HOME vazio. */
export function gitDe(dir, home) {
  return (...a) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@exemplo.dev', '-c', 'user.useConfigOnly=true', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8', env: GIT_AMB(home), stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}

/** Config do modo: a base, a chave (só no modo ligado) e o que o chamador soma (`fluxo` é mesclado, o resto substitui). */
export function configDoModo(ligada, cfgExtra = {}) {
  const cfg = JSON.parse(JSON.stringify(CONFIG_BASE));
  if (ligada) cfg.painel = { projeto: { opcoesComoContagem: true } };
  const { fluxo, ...resto } = cfgExtra;
  return { ...cfg, ...resto, fluxo: { ...cfg.fluxo, ...(fluxo ?? {}) } };
}

/**
 * Escreve a fixture em `dir` (existente, vazio) e a commita na `main`; a config do HEAD é a do modo DESLIGADO. `extraArquivos`: { caminho: texto } a mais (o doctor
 * pede os arquivos de nível 2). `limpo`: nenhum status fora do quadro e nenhum commit de PBI (o gêmeo que mede se o doctor mexe no nível).
 */
export function gerar(dir, home, { limpo = false, extraArquivos = {}, cfgExtra = {} } = {}) {
  const d = descrever({ limpo });
  const esc = (rel, texto) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), texto); };
  for (const [rel, t] of Object.entries(extraArquivos)) esc(rel, t);
  for (const c of d.cards) {
    esc(`docs/fluxo/pbis/${c.id}.md`, `---\nid: ${c.id}\nstatus: ${c.status}\nepic: ${c.epic}\n---\n# Card sintético ${c.id}\n\n${c.plano === null ? 'Plano: a escrever\n' : `Plano: \`${c.plano}\`\n`}`);
  }
  for (const e of d.epics) esc(`docs/fluxo/epics/${e.id}.md`, `---\nid: ${e.id}\nstatus: Aberto\n---\n# ${e.titulo}\n`);
  d.planos.forEach((p, k) => esc(p.arquivo, textoDoPlano(p, p.formatos, k)));
  esc('harness.config.json', JSON.stringify(configDoModo(false, cfgExtra)));
  const git = gitDe(dir, home);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: fixture inicial');
  if (!limpo) for (const id of d.comCommit) git('commit', '-q', '--allow-empty', '-m', `feat(${id}): item sintético`);
  return d;
}

/** Faz a config do modo valer como `origin/HEAD` (de onde o painel a lê), sem mexer na árvore nem no HEAD. */
export function definirModo(dir, home, ligada, cfgExtra = {}) {
  const git = gitDe(dir, home);
  const antes = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify(configDoModo(ligada, cfgExtra)));
  git('commit', '-q', '--allow-empty', '-am', 'chore: config do modo');
  git('update-ref', 'refs/remotes/origin/HEAD', git('rev-parse', 'HEAD'));
  git('reset', '-q', '--hard', antes);
}

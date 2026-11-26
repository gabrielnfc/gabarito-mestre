/**
 * Fixture comum da GM-20 (projeto que adotou o gabarito tarde): criada na T1, só LIDA pelas outras tasks (spec:91). Caso novo ⇒ fixture local no teste.
 * São os PBIs da fixture A (M1 da spec) mais o PBI-10 `Cancelado`. Nada de projeto real: ids, títulos e datas são sintéticos.
 *
 *  PBI-1  Concluído, sem plano (nem ponteiro)
 *  PBI-2  Concluído, ponteiro para plano .md de 3 tasks (`### Task n:`), sem diário
 *  PBI-3  Concluído, plano antigo `docs/superpowers/plans/2026-11-02-PBI-3-legado.md` SEM ponteiro no card
 *  PBI-4  `Superado — dividido em PBI-5 e PBI-6`, sem plano
 *  PBI-5  Em execução, `plano.json` T1..T4, 2 integradas
 *  PBI-6  Preparado, sem plano
 *  PBI-7  card velho (`Em execução`) + `entrega.encerrada`; `plano.json` T1..T2 integradas
 *  PBI-8  card velho (`Em execução`) + `ci.resultado` verde, SEM encerrada; `plano.json` T1..T2 integradas
 *  PBI-9  Preparado, ponteiro para plano .md cujo cabeçalho é `## Task 1` sem separador (não conta task)
 *  PBI-10 `Cancelado`, sem plano (para o padrão de terminais)
 *
 * Medido ANTES da T1 (o que a fixture reproduz, M1): tasks 11, integradas 6, estimadas 3, pct 55, pctComEstimadas 82, foraDaConta 6 (5 do M1 + PBI-10).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** O `append` real do diário (build do núcleo); a fixture nunca monta linha de diário à mão em disco. */
const DIARIO = pathToFileURL(join(AQUI, '..', '..', 'dist', 'diario.js')).href;

export const FL1 = 'cards/';
export const PBIS = [
  { id: 'PBI-1', status: 'Concluído', titulo: 'Cadastro do atleta', dia: '2026-10-01', plano: null },
  { id: 'PBI-2', status: 'Concluído', titulo: 'Sincronização oficial', dia: '2026-10-05', plano: 'docs/superpowers/plans/2026-10-05-PBI-2-sync.md' },
  { id: 'PBI-3', status: 'Concluído', titulo: 'Relatório semanal', dia: '2026-11-02', plano: null },
  { id: 'PBI-4', status: 'Superado — dividido em PBI-5 e PBI-6', titulo: 'Rotina de treino', dia: '2026-11-03', plano: null },
  { id: 'PBI-5', status: 'Em execução', titulo: 'Rotina de treino, parte 1', dia: '2026-11-10', plano: null },
  { id: 'PBI-6', status: 'Preparado', titulo: 'Rotina de treino, parte 2', dia: '2026-11-10', plano: null },
  { id: 'PBI-7', status: 'Em execução', titulo: 'Exportação de dados', dia: '2026-11-04', plano: null },
  { id: 'PBI-8', status: 'Em execução', titulo: 'Notificações', dia: '2026-11-05', plano: null },
  { id: 'PBI-9', status: 'Preparado', titulo: 'Metas do mês', dia: '2026-11-11', plano: 'docs/superpowers/plans/2026-11-11-PBI-9-metas.md' },
  { id: 'PBI-10', status: 'Cancelado', titulo: 'Integração antiga', dia: '2026-10-20', plano: null },
];

/** Caminho do plano .md → texto. O de PBI-3 não é apontado por card nenhum (plano no formato anterior). */
export const PLANOS_MD = {
  'docs/superpowers/plans/2026-10-05-PBI-2-sync.md': '# Plano PBI-2\n\n### Task 1: leitura\n\ntexto\n\n### Task 2: gravação\n\ntexto\n\n### Task 3: conferência\n\ntexto\n',
  'docs/superpowers/plans/2026-11-02-PBI-3-legado.md': '# Plano PBI-3\n\n### Task 1: relatório\n\ntexto\n\n### Task 2: envio\n\ntexto\n',
  'docs/superpowers/plans/2026-11-11-PBI-9-metas.md': '# Plano PBI-9\n\n## Task 1\n\ntexto sem separador no cabeçalho\n\n## Task 2\n\ntexto\n',
};

const planoJson = (id, ids) => ({ entrega: id, tasks: ids.map((t) => ({ id: t, deps: [], arquivos: [] })) });
export const PLANOS_JSON = {
  'PBI-5': planoJson('PBI-5', ['T1', 'T2', 'T3', 'T4']),
  'PBI-7': planoJson('PBI-7', ['T1', 'T2']),
  'PBI-8': planoJson('PBI-8', ['T1', 'T2']),
};

const T0 = Date.parse('2026-11-08T12:00:00Z');
const iso = (min) => new Date(T0 + min * 60_000).toISOString();
const base = (min, tipo, dados) => ({ ts: iso(min), autor: 'fixture', agente: 'orquestrador', tipo, dados });
/** Ciclo integrado de uma task: iniciada, concluída, revisão aprovada, integrada. */
const ciclo = (task, a) => [
  base(a, 'task.iniciada', { task, papel: 'implementador' }), base(a + 1, 'task.concluida', { task }),
  base(a + 2, 'task.iniciada', { task, papel: 'revisor' }), base(a + 5, 'review.veredito', { task, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }),
  base(a + 6, 'task.integrada', { task }),
];
/** Eventos por entrega (sem `seq`, `sessao` e hash: quem grava os põe). */
export const EVENTOS = {
  'PBI-5': [...ciclo('T1', 0), ...ciclo('T2', 20), base(40, 'task.iniciada', { task: 'T3', papel: 'implementador' })],
  'PBI-7': [...ciclo('T1', 100), ...ciclo('T2', 120), base(140, 'entrega.encerrada', { entrega: 'PBI-7', pr: 7, via: 'head', mergeado_em: iso(140) })],
  'PBI-8': [...ciclo('T1', 200), ...ciclo('T2', 220), base(240, 'ci.resultado', { verde: true })],
};
const SESSAO = 'fixture-adotado';

const cardTexto = (p) =>
  `---\nid: "${p.id}"\ntipo: US\nstatus: ${p.status}\natualizadoEm: "${p.dia}"\n---\n# ${p.titulo}\nFL1 · User Story. Plano: ${p.plano === null ? 'a escrever' : `\`${p.plano}\``}.\n`;

/** A árvore em memória, no formato de `ArvoreLida` (`projeto.ts`): para teste de núcleo e de render, sem disco. `caminho` é rótulo. */
export function arvore(caminho = '/FIX/adotado') {
  const cards = PBIS.map((p) => ({ arquivo: `${p.id}.md`, texto: cardTexto(p), planoMd: p.plano === null ? null : (PLANOS_MD[p.plano] ?? null) }));
  const ids = [...new Set([...Object.keys(PLANOS_JSON), ...Object.keys(EVENTOS)])].sort();
  const entregas = ids.map((id) => ({
    id,
    plano: PLANOS_JSON[id] === undefined ? null : { ok: true, bruto: PLANOS_JSON[id] },
    eventos: (EVENTOS[id] ?? []).map((e, i) => ({ seq: i + 1, sessao: SESSAO, hash_anterior: null, ...e })),
  }));
  return { caminho, cards, entregas };
}

function git(dir, ...args) {
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'user.useConfigOnly=true', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
}

/**
 * Grava o projeto em `dir` (repositório git com 1 commit): cards em `cards/`, planos .md, `plano.json` e o diário pelo `append` real de `dist/diario.js`,
 * mais `harness.config.json`. `planosLegados` e `terminais` entram na config como vierem (`fluxo.planosLegados`, `fluxo.status.terminais`); sem eles, a config só aponta o FL1.
 * `dir` deve estar FORA do repositório do plugin (TMPDIR de `getconf DARWIN_USER_TEMP_DIR`); o remoto bare vai em `<dir>-origin.git`, ao lado. Assíncrona: o `append` é importado do build.
 */
export async function montarNoDisco(dir, { planosLegados, terminais } = {}) {
  const { append } = await import(DIARIO);
  const grava = (rel, txt) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), txt); };
  for (const p of PBIS) grava(`${FL1}${p.id}.md`, cardTexto(p));
  for (const [rel, txt] of Object.entries(PLANOS_MD)) grava(rel, txt);
  for (const [id, plano] of Object.entries(PLANOS_JSON)) grava(`.harness/entregas/${id}/plano.json`, `${JSON.stringify(plano, null, 2)}\n`);
  for (const [id, evs] of Object.entries(EVENTOS)) {
    for (const e of evs) {
      const r = append(join(dir, '.harness', 'entregas', id), SESSAO, { ...e, sessao: SESSAO });
      if (!r.ok) throw new Error(`fixture adotado: append recusou ${id} ${e.tipo}: ${r.erro}`);
    }
  }
  const fluxo = { mapeamento: { FL1 } };
  if (planosLegados !== undefined) fluxo.planosLegados = planosLegados;
  if (terminais !== undefined) fluxo.status = { terminais };
  grava('harness.config.json', `${JSON.stringify({ fluxo })}\n`);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'fixture adotado');
  // a config vale pelo `origin/HEAD` (lerConfigOrigin): remoto bare ao lado de `dir`, com o HEAD apontando para `main`
  const bare = join(dirname(dir), `${basename(dir)}-origin.git`);
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
}

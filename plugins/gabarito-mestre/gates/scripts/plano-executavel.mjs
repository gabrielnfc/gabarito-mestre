// GM-21 T3 (REQ-MIG-1, DT4): o plano.json é executável antes de despachar. Uma função só confere, por task ainda não integrada nem fora,
// o que o `integrar` e o gate vão ler (`mutacoes`, `teste_afetado`, escopo) e, uma vez, a config (`gates.suites`). Usada pelo `abrir` e pelo `proxima`
// (`loop.mjs`); `validarPlano` fica puro (sem disco). `de` no arquivo da mutação não é conferido: o código ainda não existe antes da task.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { escopoDaTask, projetarEmendas } from '../dist/emenda.js';
import { estadosPorTask, ordenar } from '../dist/loop.js';
import { normalizarCaminho } from '../dist/plano.js';
import { normalizarSuites } from './gate-task.mjs';

/** Diretório vira `dir/`; arquivo fica exato. O gate trata `dir` sem barra como arquivo, e `dir` como arquivo reprovaria o que está dentro. */
export function escopo(wt, arquivos) {
  return arquivos.map((a) => {
    try { return statSync(join(wt, a)).isDirectory() ? `${a}/` : a; } catch { return a; }
  });
}

const texto = (v) => typeof v === 'string' && v.trim() !== '';
const NAO_CONFERIDAS = new Set(['integrada', 'adiada', 'cortada']);

function problemasDeSuites(cfg) {
  const lista = cfg?.gates?.suites;
  const p = (codigo, motivo) => ({ task: null, campo: 'gates.suites', codigo, motivo });
  if (lista === undefined) return [p('gates_suites_ausente', 'ausente em harness.config.json: o gate não roda nada sem suíte; declare gates.suites, ex.: [{"nome":"unit","cmd":"npm test"}]')];
  const { suites, erros } = normalizarSuites(lista);
  if (erros.length > 0) return erros.map((e) => p('gates_suites_item', e));
  if (suites.length === 0) return [p('gates_suites_vazia', 'lista vazia: o gate recusa sem ao menos 1 suíte')];
  return [];
}

function problemasDeMutacoes(raiz, t, dentro) {
  const p = (codigo, motivo) => ({ task: t.id, campo: 'mutacoes', codigo, motivo });
  const m = t.mutacoes;
  if (!texto(m)) return [p('mutacoes_tipo', `deve ser o caminho de um arquivo JSON (relativo à raiz), veio ${JSON.stringify(m)}`)];
  const arq = resolve(raiz, m);
  const rel = relative(raiz, arq);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return [p('mutacoes_fora_da_raiz', `"${m}" aponta para fora da raiz do repositório`)];
  if (!existsSync(arq)) return [p(/\.json$/i.test(m) ? 'mutacoes_inexistente' : 'mutacoes_texto_livre', `"${m}" não é um arquivo: mutacoes é o caminho de um JSON com [{nome, arquivo, de, para, teste, cwd?}], não texto livre`)];
  let real;
  try { real = realpathSync(arq); } catch (e) { return [p('mutacoes_inexistente', `"${m}" ilegível (${e.code ?? e.message})`)]; }
  const relReal = relative(realpathSync(raiz), real);
  if (relReal.startsWith('..') || isAbsolute(relReal)) return [p('mutacoes_fora_da_raiz', `"${m}" resolve para fora da raiz do repositório`)];
  let lista;
  try {
    if (!statSync(arq).isFile()) return [p('mutacoes_nao_arquivo', `"${m}" não é arquivo`)];
    lista = JSON.parse(readFileSync(arq, 'utf8'));
  } catch (e) {
    return [p('mutacoes_json', `"${m}" não é JSON válido (${String(e.message).split('\n')[0]})`)];
  }
  if (!Array.isArray(lista) || lista.length === 0) return [p('mutacoes_vazia', `"${m}": esperado lista não vazia de {nome, arquivo, de, para, teste, cwd?}`)];
  const ps = [];
  lista.forEach((it, i) => {
    const nome = it !== null && typeof it === 'object' && texto(it.nome) ? it.nome : `#${i + 1}`;
    if (it === null || typeof it !== 'object' || Array.isArray(it)) { ps.push(p('mutacoes_item', `item ${nome}: esperado objeto {nome, arquivo, de, para, teste, cwd?}`)); return; }
    for (const c of ['nome', 'arquivo', 'de', 'teste']) if (!texto(it[c])) ps.push(p('mutacoes_item', `item ${nome}: ${c} deve ser texto não vazio`));
    if (typeof it.para !== 'string') ps.push(p('mutacoes_item', `item ${nome}: para deve ser texto`));
    if (it.cwd !== undefined && typeof it.cwd !== 'string') ps.push(p('mutacoes_item', `item ${nome}: cwd, se houver, deve ser texto`));
    if (texto(it.arquivo)) {
      const a = normalizarCaminho(it.arquivo);
      if (a === null || !dentro(a)) ps.push(p('mutacoes_escopo', `item ${nome}: arquivo ${it.arquivo} está fora do escopo da task (arquivos do plano.json e emendas aplicadas): o gate reprovaria`));
    }
  });
  return ps;
}

function problemasDeTesteAfetado(raiz, t) {
  const p = (codigo, motivo) => ({ task: t.id, campo: 'teste_afetado', codigo, motivo });
  const v = t.teste_afetado;
  if (!texto(v)) return [p('teste_afetado_tipo', `deve ser um comando de shell, veio ${JSON.stringify(v)}`)];
  try {
    const s = statSync(resolve(raiz, v));
    if (s.isFile() && (s.mode & 0o111) === 0) return [p('teste_afetado_caminho', `"${v}" é um caminho de arquivo sem permissão de execução, não um comando; use o comando, ex.: "npx vitest run ${v}"`)];
  } catch { /* não é caminho existente: é comando */ }
  return [];
}

/**
 * `{ ok, problemas, porTask }`. `problemas`: `{task|null, campo, codigo, motivo}`; `task: null` é da config. `porTask[id]` = problemas da task + os da config
 * `cfg` é a config que a worktree vai ter (a do commit base); `cfgLocal`, a do working tree, só serve para a dica de commitar. (só as tasks conferidas: não integradas nem fora; `tasks` restringe a conferência a esses ids). Escopo = o do gate (`escopoDaTask` + `escopo`, `loop.mjs integrar`).
 */
export function conferirExecutavel({ raiz, plano, eventos, cfg, cfgLocal, tasks }) {
  const ord = ordenar(eventos ?? []);
  const est = ord.ok ? estadosPorTask(plano.tasks.map((t) => t.id), ord.eventos, true) : { ok: false };
  const conferidas = plano.tasks.filter((t) => (tasks === undefined || tasks.includes(t.id))
    && !(est.ok && NAO_CONFERIDAS.has(est.estados.get(t.id)?.estado)));
  const emendas = projetarEmendas(eventos ?? []);
  const daConfig = problemasDeSuites(cfg);
  // A worktree nasce do commit: suítes válidas só no working tree não valem; a recusa diz para commitar.
  if (daConfig.length > 0 && cfgLocal !== undefined && problemasDeSuites(cfgLocal).length === 0) {
    for (const d of daConfig) d.motivo = `gates.suites está no working tree mas não no commit: a worktree da task nasce do commit; commite harness.config.json e repita (${d.motivo})`;
  }
  const problemas = [...daConfig];
  const porTask = {};
  for (const t of conferidas) {
    const esc = escopo(raiz, escopoDaTask(plano, emendas, t.id));
    // Entrada que não existe na raiz (pasta que a task ainda vai criar) casa exato OU por prefixo `entrada/`: o gate roda na worktree, onde ela já existe.
    const dentro = (a) => esc.some((e) => (e.endsWith('/') ? a.startsWith(e) : a === e || a.startsWith(`${e}/`)));
    const proprios = [
      ...(t.mutacoes !== undefined ? problemasDeMutacoes(raiz, t, dentro) : []),
      ...(t.teste_afetado !== undefined ? problemasDeTesteAfetado(raiz, t) : []),
    ];
    problemas.push(...proprios);
    porTask[t.id] = [...proprios, ...daConfig];
  }
  return { ok: problemas.length === 0, problemas, porTask };
}

/** Uma linha por problema, com a task e o campo: o que o `abrir` devolve em `mensagem` e o `proxima` em `aviso`. */
export const linhaDoProblema = (p) => `${p.task ?? 'config'} ${p.campo}: ${p.motivo}`;

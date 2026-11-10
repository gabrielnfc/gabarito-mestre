/**
 * Plano como dado (REQ-LOOP-1): `.harness/entregas/<id>/plano.json`. `validarPlano` é total: nenhuma entrada lança.
 * Recusa ciclo, dependência inexistente, id repetido e duas tasks sem dependência (direta ou transitiva) no mesmo
 * arquivo. Caminhos em `arquivos` são normalizados (`./a` = `a`) antes de comparar. Ids viram chave de `Map`
 * (nunca de objeto): `__proto__` é um id como outro qualquer e não polui nada.
 * GM-11 T1: `reqs` por task (lista não vazia de `REQ_RE`, sem repetição) e `politica_entrega` (`exige_prod`, `politica`, `janela`); afrouxar a política
 * contra o config de `origin/HEAD` não é daqui (o plano não vê o config; T4).
 */

import { REQ_RE } from './formas.js';
import { colunas } from './painel-largura.js';
                                                                          

                                                                                      

const recusa = (erro        )                 => ({ ok: false, erro });
const ehObjeto = (v         )                               => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehListaDeTexto = (v         )                => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Caminho relativo normalizado (`./a` = `a`, `a//b` = `a/b`) ou `null` se vazio, absoluto, com NUL ou que escapa da raiz, ou cuja forma normalizada começa com `X:` (idempotente: `n(n(x)) === n(x)`). Mesma regra de `validarPlano`.
 * Sem `node:path`: o núcleo é carregado pelo mod como módulo de hook, que não importa módulo embutido do Node (pilha de segmentos própria).
 * A barra invertida vira `/` ANTES do teste de absoluto: `\a` e `\\srv\x` são absolutos e são recusados.
 */
export function normalizarCaminho(c        )                {
  if (c === '' || c.includes('\0') || /^[A-Za-z]:/.test(c)) return null;
  const barras = c.replace(/\\/g, '/');
  if (barras.startsWith('/')) return null;
  const pilha           = [];
  for (const parte of barras.split('/')) {
    if (parte === '' || parte === '.') continue;
    if (parte === '..' && pilha.length > 0 && pilha[pilha.length - 1] !== '..') pilha.pop();
    else pilha.push(parte);
  }
  const n = pilha.join('/');
  if (n === '' || n === '.' || n === '..' || n.startsWith('../')) return null;
  // `X:` vale também para a SAÍDA (`./a:b` → `a:b`): sem isto a função não é idempotente e `escopoDaTask`, que re-normaliza, descartaria o escopo.
  if (/^[A-Za-z]:/.test(n)) return null;
  return n;
}

const TITULO_MAX_COLUNAS = 40;
/** Controle C0, DEL, C1 e separadores de linha/parágrafo: nunca em título. */
const CONTROLE_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const POLITICAS                     = ['continua', 'janela', 'sob_demanda'];

/** Fuso aceito por `Intl.DateTimeFormat` (IANA); `Intl` que lança vira recusa, nunca exceção. */
function fusoValido(fuso         )          {
  if (typeof fuso !== 'string' || fuso === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

function validarJanela(j         )                                                             {
  if (!ehObjeto(j)) return { ok: false, erro: '`janela` não é um objeto' };
  const { dias, inicio, fim, fuso } = j;
  if (!Array.isArray(dias) || dias.length === 0 || !dias.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)) {
    return { ok: false, erro: '`janela.dias` deve ser lista não vazia de inteiros 0-6' };
  }
  if (typeof inicio !== 'string' || !HHMM_RE.test(inicio)) return { ok: false, erro: '`janela.inicio` deve ser HH:MM (00:00 a 23:59)' };
  if (typeof fim !== 'string' || !HHMM_RE.test(fim)) return { ok: false, erro: '`janela.fim` deve ser HH:MM (00:00 a 23:59)' };
  if (!fusoValido(fuso)) return { ok: false, erro: `\`janela.fuso\` não é um fuso aceito: ${JSON.stringify(fuso)}` };
  return { ok: true, janela: { dias: [...dias], inicio, fim, fuso: fuso           } };
}

function validarPolitica(p         )                                                                      {
  if (!ehObjeto(p)) return { ok: false, erro: '`politica_entrega` não é um objeto' };
  if (typeof p.exige_prod !== 'boolean') return { ok: false, erro: '`politica_entrega.exige_prod` deve ser booleano' };
  const nova                = { exige_prod: p.exige_prod };
  if (p.politica !== undefined) {
    if (!POLITICAS.includes(p.politica)) return { ok: false, erro: '`politica_entrega.politica` deve ser continua, janela ou sob_demanda' };
    nova.politica = p.politica                             ;
  }
  if (p.janela !== undefined) {
    const j = validarJanela(p.janela);
    if (!j.ok) return { ok: false, erro: j.erro };
    nova.janela = j.janela;
  }
  return { ok: true, politica: nova };
}

function validar(bruto         )                 {
  if (!ehObjeto(bruto)) return recusa('plano não é um objeto');
  const entrega = bruto.entrega;
  const lista = bruto.tasks;
  if (typeof entrega !== 'string' || entrega === '') return recusa('plano sem `entrega` em texto');
  if (!Array.isArray(lista)) return recusa('`tasks` não é uma lista');
  const spec = bruto.spec;
  if (spec !== undefined && (typeof spec !== 'string' || spec.trim() === '')) return recusa('`spec` do plano não é texto');

  let politica_entrega                           ;
  if (bruto.politica_entrega !== undefined) {
    const p = validarPolitica(bruto.politica_entrega);
    if (!p.ok) return recusa(`politica_entrega inválida: ${p.erro}`);
    politica_entrega = p.politica;
  }

  const tasks = new Map                   ();
  for (const [i, t] of lista.entries()) {
    if (!ehObjeto(t)) return recusa(`task #${i} não é um objeto`);
    if (typeof t.id !== 'string' || t.id === '') return recusa(`task #${i} sem \`id\` em texto`);
    if (tasks.has(t.id)) return recusa(`id repetido: ${t.id}`);
    const deps = t.deps;
    if (!ehListaDeTexto(deps)) return recusa(`task ${t.id}: \`deps\` não é lista de ids`);
    const brutos = t.arquivos;
    if (!ehListaDeTexto(brutos)) return recusa(`task ${t.id}: \`arquivos\` não é lista de caminhos`);
    const arquivos           = [];
    for (const a of brutos) {
      const n = normalizarCaminho(a);
      if (n === null) return recusa(`task ${t.id}: caminho inválido em \`arquivos\`: ${a}`);
      if (!arquivos.includes(n)) arquivos.push(n);
    }
    let reqs                      ;
    if (t.reqs !== undefined) {
      const r = t.reqs;
      if (!Array.isArray(r) || r.length === 0 || !r.every((x) => typeof x === 'string' && REQ_RE.test(x))) {
        return recusa(`task ${t.id}: \`reqs\` deve ser lista não vazia de REQ-<ÁREA>-<n>`);
      }
      if (new Set(r).size !== r.length) return recusa(`task ${t.id}: \`reqs\` com REQ repetido`);
      reqs = [...r];
    }
    if (t.teste_afetado !== undefined && typeof t.teste_afetado !== 'string') return recusa(`task ${t.id}: \`teste_afetado\` não é texto`);
    if (t.mutacoes !== undefined && typeof t.mutacoes !== 'string') return recusa(`task ${t.id}: \`mutacoes\` não é texto`);
    if (t.titulo !== undefined) {
      if (typeof t.titulo !== 'string' || t.titulo.trim() === '') return recusa(`task ${t.id}: \`titulo\` deve ser texto não vazio`);
      if (CONTROLE_RE.test(t.titulo)) return recusa(`task ${t.id}: \`titulo\` com caractere de controle`);
      const cols = colunas(t.titulo); // a mesma medida do render (`painel-largura.ts`)
      if (cols > TITULO_MAX_COLUNAS) return recusa(`task ${t.id}: \`titulo\` com ${cols} colunas, máximo ${TITULO_MAX_COLUNAS}`);
    }
    if ('spec' in t) return recusa(`task ${t.id}: \`spec\` é campo do plano (topo), não da task`);
    const nova            = { id: t.id, deps: [...deps], arquivos };
    if (reqs !== undefined) nova.reqs = reqs;
    if (t.teste_afetado !== undefined) nova.teste_afetado = t.teste_afetado;
    if (t.mutacoes !== undefined) nova.mutacoes = t.mutacoes;
    if (t.titulo !== undefined) nova.titulo = t.titulo;
    tasks.set(t.id, nova);
  }

  for (const t of tasks.values()) {
    for (const d of t.deps) if (!tasks.has(d)) return recusa(`task ${t.id}: dependência inexistente: ${d}`);
  }

  // Ciclo: DFS com pilha explícita de ids (0 = novo, 1 = no caminho, 2 = fechado).
  const estado = new Map                ();
  const caminho           = [];
  const visitar = (id        )                  => {
    estado.set(id, 1);
    caminho.push(id);
    for (const d of tasks.get(id) .deps) {
      const e = estado.get(d) ?? 0;
      if (e === 1) return [...caminho.slice(caminho.indexOf(d)), d];
      if (e === 0) {
        const c = visitar(d);
        if (c) return c;
      }
    }
    caminho.pop();
    estado.set(id, 2);
    return null;
  };
  for (const id of tasks.keys()) {
    if ((estado.get(id) ?? 0) === 0) {
      const c = visitar(id);
      if (c) return recusa(`ciclo nas dependências: ${c.join(' -> ')}`);
    }
  }

  // Ancestrais transitivos (grafo já é acíclico).
  const anc = new Map                     ();
  const ancestrais = (id        )              => {
    const pronto = anc.get(id);
    if (pronto) return pronto;
    const s = new Set        ();
    for (const d of tasks.get(id) .deps) {
      s.add(d);
      for (const x of ancestrais(d)) s.add(x);
    }
    anc.set(id, s);
    return s;
  };
  const ids = [...tasks.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = tasks.get(ids[i]) ;
      const b = tasks.get(ids[j]) ;
      const comum = a.arquivos.find((f) => b.arquivos.includes(f));
      if (comum === undefined) continue;
      if (!ancestrais(a.id).has(b.id) && !ancestrais(b.id).has(a.id)) {
        return recusa(`tasks ${a.id} e ${b.id} tocam ${comum} sem dependência entre si (escopo de arquivos é fechado)`);
      }
    }
  }

  return {
    ok: true,
    plano: { entrega, ...(spec !== undefined ? { spec } : {}), ...(politica_entrega !== undefined ? { politica_entrega } : {}), tasks: [...tasks.values()] },
  };
}

/**
 * `a` é ancestral de `b` ou `b` de `a`, direta ou transitivamente (a própria task não conta; id inexistente ⇒ `false`). Ids viram chave de `Map`
 * (`__proto__` é id como outro) e há guarda contra ciclo: `validarPlano` barra ciclo, a função pura não presume.
 */
export function temDependencia(plano       , a        , b        )          {
  const porId = new Map                  ();
  for (const t of plano.tasks) porId.set(t.id, t.deps);
  const alcanca = (de        , alvo        )          => {
    const visto = new Set        ();
    const pilha = [...(porId.get(de) ?? [])];
    while (pilha.length > 0) {
      const id = pilha.pop()          ;
      if (id === alvo) return true;
      if (visto.has(id)) continue;
      visto.add(id);
      pilha.push(...(porId.get(id) ?? []));
    }
    return false;
  };
  return alcanca(b, a) || alcanca(a, b);
}

export function validarPlano(bruto         )                 {
  try {
    return validar(bruto);
  } catch (e) {
    return recusa(`plano ilegível: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
  }
}

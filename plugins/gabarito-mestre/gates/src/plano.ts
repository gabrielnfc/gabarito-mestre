/**
 * Plano como dado (REQ-LOOP-1): `.harness/entregas/<id>/plano.json`. `validarPlano` é total: nenhuma entrada lança.
 * Recusa ciclo, dependência inexistente, id repetido e duas tasks sem dependência (direta ou transitiva) no mesmo
 * arquivo. Caminhos em `arquivos` são normalizados (`./a` = `a`) antes de comparar. Ids viram chave de `Map`
 * (nunca de objeto): `__proto__` é um id como outro qualquer e não polui nada.
 */

import { posix } from 'node:path';
import type { Plano, TaskPlano } from './tipos.ts';

export type ResultadoPlano = { ok: true; plano: Plano } | { ok: false; erro: string };

const recusa = (erro: string): ResultadoPlano => ({ ok: false, erro });
const ehObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehListaDeTexto = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function normalizarCaminho(c: string): string | null {
  if (c === '' || c.includes('\0') || c.startsWith('/') || /^[A-Za-z]:[\\/]/.test(c)) return null;
  const n = posix.normalize(c.replace(/\\/g, '/')).replace(/\/+$/, '');
  if (n === '' || n === '.' || n === '..' || n.startsWith('../')) return null;
  return n;
}

function validar(bruto: unknown): ResultadoPlano {
  if (!ehObjeto(bruto)) return recusa('plano não é um objeto');
  const entrega = bruto.entrega;
  const lista = bruto.tasks;
  if (typeof entrega !== 'string' || entrega === '') return recusa('plano sem `entrega` em texto');
  if (!Array.isArray(lista)) return recusa('`tasks` não é uma lista');

  const tasks = new Map<string, TaskPlano>();
  for (const [i, t] of lista.entries()) {
    if (!ehObjeto(t)) return recusa(`task #${i} não é um objeto`);
    if (typeof t.id !== 'string' || t.id === '') return recusa(`task #${i} sem \`id\` em texto`);
    if (tasks.has(t.id)) return recusa(`id repetido: ${t.id}`);
    const deps = t.deps;
    if (!ehListaDeTexto(deps)) return recusa(`task ${t.id}: \`deps\` não é lista de ids`);
    const brutos = t.arquivos;
    if (!ehListaDeTexto(brutos)) return recusa(`task ${t.id}: \`arquivos\` não é lista de caminhos`);
    const arquivos: string[] = [];
    for (const a of brutos) {
      const n = normalizarCaminho(a);
      if (n === null) return recusa(`task ${t.id}: caminho inválido em \`arquivos\`: ${a}`);
      if (!arquivos.includes(n)) arquivos.push(n);
    }
    if (t.teste_afetado !== undefined && typeof t.teste_afetado !== 'string') return recusa(`task ${t.id}: \`teste_afetado\` não é texto`);
    if (t.mutacoes !== undefined && typeof t.mutacoes !== 'string') return recusa(`task ${t.id}: \`mutacoes\` não é texto`);
    const nova: TaskPlano = { id: t.id, deps: [...deps], arquivos };
    if (t.teste_afetado !== undefined) nova.teste_afetado = t.teste_afetado;
    if (t.mutacoes !== undefined) nova.mutacoes = t.mutacoes;
    tasks.set(t.id, nova);
  }

  for (const t of tasks.values()) {
    for (const d of t.deps) if (!tasks.has(d)) return recusa(`task ${t.id}: dependência inexistente: ${d}`);
  }

  // Ciclo: DFS com pilha explícita de ids (0 = novo, 1 = no caminho, 2 = fechado).
  const estado = new Map<string, number>();
  const caminho: string[] = [];
  const visitar = (id: string): string[] | null => {
    estado.set(id, 1);
    caminho.push(id);
    for (const d of tasks.get(id)!.deps) {
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
  const anc = new Map<string, Set<string>>();
  const ancestrais = (id: string): Set<string> => {
    const pronto = anc.get(id);
    if (pronto) return pronto;
    const s = new Set<string>();
    for (const d of tasks.get(id)!.deps) {
      s.add(d);
      for (const x of ancestrais(d)) s.add(x);
    }
    anc.set(id, s);
    return s;
  };
  const ids = [...tasks.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = tasks.get(ids[i])!;
      const b = tasks.get(ids[j])!;
      const comum = a.arquivos.find((f) => b.arquivos.includes(f));
      if (comum === undefined) continue;
      if (!ancestrais(a.id).has(b.id) && !ancestrais(b.id).has(a.id)) {
        return recusa(`tasks ${a.id} e ${b.id} tocam ${comum} sem dependência entre si (escopo de arquivos é fechado)`);
      }
    }
  }

  return { ok: true, plano: { entrega, tasks: [...tasks.values()] } };
}

export function validarPlano(bruto: unknown): ResultadoPlano {
  try {
    return validar(bruto);
  } catch (e) {
    return recusa(`plano ilegível: ${e instanceof Error ? e.message : 'erro desconhecido'}`);
  }
}

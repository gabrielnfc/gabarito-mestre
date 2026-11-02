#!/usr/bin/env node
// Resume docs/aprendizados/metricas-e1.jsonl sem carregar o arquivo no contexto de ninguém.
import { readFileSync } from 'node:fs';
const linhas = readFileSync(new URL('./metricas-e1.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const mediana = (v) => { const o = [...v].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : null; };
const min = (s) => (s === null ? '-' : `${(s / 60).toFixed(1)} min`);
for (const fluxo of new Set(linhas.map((l) => l.fluxo))) {
  const g = linhas.filter((l) => l.fluxo === fluxo);
  const fechadas = g.filter((l) => l.estado.startsWith('aprovada'));
  console.log(`${fluxo}: ${g.length} tasks, ${fechadas.length} fechadas · total mediano ${min(mediana(fechadas.map((l) => l.impl_s + l.review_s + l.correcao_s)))} · impl ${min(mediana(g.map((l) => l.impl_s)))} · review ${min(mediana(g.map((l) => l.review_s)))} · rodadas ${mediana(g.map((l) => l.rodadas))}`);
}

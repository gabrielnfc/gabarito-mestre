// Lê bruto.tsv (coleta.sh) e imprime distribuição + sensibilidade. Uso: node analisa.mjs
import { readFileSync } from 'node:fs';
const num = (s, re) => parseFloat(s.match(re)[1]);
const m = new Map();
for (const l of readFileSync(new URL('./bruto.tsv', import.meta.url), 'utf8').split('\n').filter(Boolean)) {
  const c = l.split('\t'); const [run, att, job] = c; const txt = c[c.length-1].replace(/^\S*Z /, '').replace(/^\uFEFF/, '');
  const ts = run + '|' + c[c.length-1].replace(/^\S*Z /, '');
  const os = /macos/.test(job) ? 'mac' : /ubuntu/.test(job) ? 'ubu' : 'outro';
  const k = `${run}/${att}/${os}`;
  const o = m.get(k) ?? { run, att, os };
  if (/^piso/.test(txt)) { o.ts = ts; o.piso = num(txt, /p95\s+([\d.]+)/); }
  else if (/^guarda/.test(txt)) o.guarda = num(txt, /p95\s+([\d.]+)/);
  else if (/limite/.test(txt)) o.ok = /ok$/.test(txt.trim());
  m.set(k, o);
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const med = a => q(a, 0.5);
for (const os of ['mac', 'ubu']) {
  const seen = new Set(); // retry reexibe o log do job não reexecutado: dedupe por timestamp
  const t = [...m.values()].filter(o => o.os === os && o.piso != null && o.guarda != null).filter(o => !seen.has(o.ts) && seen.add(o.ts));
  const ex = t.map(o => o.guarda - o.piso);
  const fail = t.filter(o => o.ok === false);
  const f = x => x.toFixed(1);
  console.log(`\n== ${os}: N=${t.length} tentativas (${new Set(t.map(o=>o.run)).size} runs); retries (att>1): ${t.filter(o=>+o.att>1).length}`);
  console.log(`piso p95: min ${f(Math.min(...t.map(o=>o.piso)))} med ${f(med(t.map(o=>o.piso)))} p95 ${f(q(t.map(o=>o.piso),.95))} max ${f(Math.max(...t.map(o=>o.piso)))}`);
  console.log(`excesso: min ${f(Math.min(...ex))} med ${f(med(ex))} p90 ${f(q(ex,.9))} p95 ${f(q(ex,.95))} p99 ${f(q(ex,.99))} max ${f(Math.max(...ex))}; p99/med ${(q(ex,.99)/med(ex)).toFixed(2)}`);
  console.log(`estouros do limite bruto 150: ${fail.length} -> ${fail.map(o=>`${o.run}/a${o.att}(ex ${f(o.guarda-o.piso)})`).join(' ')}`);
  if (os !== 'mac') continue;
  const mx = Math.max(...ex), p99 = q(ex, .99);
  const lims = [['p99x1,5', p99 * 1.5], ['maxx1,5 (plano)', mx * 1.5], ['p95x2', q(ex, .95) * 2]];
  console.log('limite (sobre excesso) | % de execuções que pegariam regressão +50/+100/+150 ms | falso positivo no histórico');
  for (const [n, L] of lims) {
    const r = [50, 100, 150].map(d => { const c = ex.filter(e => e + d > L).length; return `${c}/${ex.length} (${(100*c/ex.length).toFixed(1)}%)`; });
    const fp = ex.filter(e => e > L).length;
    console.log(`${n} = ${L.toFixed(1)} ms | ${r.join(' | ')} | FP ${fp}`);
  }
}

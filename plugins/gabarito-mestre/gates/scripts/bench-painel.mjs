#!/usr/bin/env node
/**
 * Bench do painel (E4, T9, S-E4 (iv)): p95 de `painel.mjs estado --agentes` com 2.000 eventos no diário e 4 transcripts de ~450 KB (o arquivo real nasce
 * com ~264 KB e passa de 256 KB: a cauda nunca pega o começo), 50 execuções por cenário, em processo filho (o custo que o mod paga a cada refresh).
 *
 *   node scripts/bench-painel.mjs [--execucoes N] [--eventos N]
 *
 * Cenários: (i) loop em voo; (ii) loop em `concluir` (chama `prepararLeitura`). O p95 do bench é o MAIOR dos dois. Também mede o maior stdout.
 * Saída: UMA linha JSON `{ok, p95_ms, intervalo_ms, ...}`. `intervalo_ms` = 60000 se o p95 >= 1000, senão 30000 (valor de `INTERVALO_MS` da T10).
 * Fora de `npm test`. O repositório do bench nasce em `BENCH_DIR` (padrão: o tmpdir do sistema) e nada dele é apagado por aqui.
 * Rode com a máquina sem outro agente testando (P5): o número é de latência.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';
import * as diario from '../dist/diario.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAINEL = join(AQUI, 'painel.mjs');

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];

function numeroDe(flag, padrao) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return padrao;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag}: esperado inteiro >= 1`);
  return n;
}

/** Transcript de ~`alvo` bytes: linhas de ~1 KB, uma com `usage` a cada 4, ids de mensagem repetidos como no real. */
function transcript(alvo) {
  const linhas = [];
  let bytes = 0;
  for (let i = 0; bytes < alvo; i++) {
    const l = i % 4 === 0
      ? JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${Math.floor(i / 8)}`, role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(700) }], usage: { input_tokens: 3, cache_creation_input_tokens: 1000 + i, cache_read_input_tokens: 40000 + i, output_tokens: 100 } } })
      : JSON.stringify({ type: 'user', message: { role: 'user', content: 'y'.repeat(900) } });
    linhas.push(l);
    bytes += l.length + 1;
  }
  return `${linhas.join('\n')}\n`;
}

function montar(base, nome, { eventos, concluido }) {
  const repo = join(base, nome);
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'feat/GM-12-bench');
  g(repo, 'config', 'user.email', 'b@b.test');
  g(repo, 'config', 'user.name', 'b');
  g(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'inicio');
  const dir = join(repo, '.harness', 'entregas', 'GM-12');
  mkdirSync(dir, { recursive: true });
  const tasks = Array.from({ length: 12 }, (_, i) => ({ id: `T${i + 1}`, titulo: `Task ${i + 1}`, deps: [], arquivos: [`src/t${i + 1}.txt`] }));
  writeFileSync(join(dir, 'plano.json'), JSON.stringify({ entrega: 'GM-12', tasks }));
  let n = 0;
  const ev = (tipo, dados, sessao = 'loop') => {
    n += 1;
    const r = diario.append(dir, sessao, { ts: new Date(Date.UTC(2026, 10, 9, 0, 0, 0) + n * 1000).toISOString(), autor: 'b@b.test', sessao, agente: 'orquestrador', tipo, dados });
    if (!r.ok || r.gravado !== 'evento') throw new Error(`bench: ${tipo} não gravado (${JSON.stringify(r)})`);
  };
  const feitas = concluido ? 12 : 6;
  for (let i = 1; i <= feitas; i++) {
    const t = `T${i}`;
    ev('task.iniciada', { task: t, papel: 'implementador', modelo: 'sonnet' });
    ev('task.concluida', { task: t, sha: 'a'.repeat(40) });
    ev('review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
    ev('task.integrada', { task: t, sha: 'b'.repeat(40), mutacoes: { total: 3, mortas: 3 } });
  }
  if (concluido) ev('ci.resultado', { verde: true, alvo: 'homolog' });
  else ev('task.iniciada', { task: 'T7', papel: 'implementador', modelo: 'sonnet' });
  while (n < eventos) ev('custo.medicao', { input: 10, output: 20, cache_creation: 100, cache_read: 5000, modelo: 'claude-opus-5-5' }, n % 2 === 0 ? 'loop' : 'sessao-mod');
  return { repo, eventos: n };
}

export function rodar() {
  const execucoes = numeroDe('--execucoes', 50);
  const eventos = numeroDe('--eventos', 2000);
  const base = realpathSync(mkdtempSync(join(process.env.BENCH_DIR ?? tmpdir(), 'bench-painel-')));
  const subagents = join(base, 'sessao', 'subagents');
  mkdirSync(subagents, { recursive: true });
  const agentes = [];
  for (let i = 1; i <= 4; i++) {
    const arq = join(subagents, `agent-a${i}.jsonl`);
    writeFileSync(arq, transcript(450_000));
    agentes.push({ id: `a${i}`, type: 'implementador', description: `T${6 + i} implementador`, status: 'running', transcript: arq });
  }
  const entrada = JSON.stringify({ sessao: { percent: 40, tokens: 80000, window: 200000, h5: 10, d7: 20, x: 50, pacote: 'terra-media' }, agentes });
  const cenarios = {};
  let maiorStdout = 0;
  for (const [nome, concluido] of [['em_voo', false], ['concluir', true]]) {
    const { repo } = montar(base, nome, { eventos, concluido });
    const medidas = [];
    for (let i = 0; i < execucoes; i++) {
      const t0 = performance.now();
      const r = spawnSync(process.execPath, [PAINEL, 'estado', '--agentes'], { cwd: repo, input: entrada, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      medidas.push(performance.now() - t0);
      if (r.status !== 0) throw new Error(`bench: painel.mjs rc ${r.status}: ${r.stdout.slice(0, 300)}${r.stderr.slice(0, 300)}`);
      maiorStdout = Math.max(maiorStdout, Buffer.byteLength(r.stdout));
    }
    cenarios[nome] = { p95_ms: Math.round(p95(medidas)), mediana_ms: Math.round([...medidas].sort((a, b) => a - b)[Math.floor(medidas.length / 2)]), max_ms: Math.round(Math.max(...medidas)) };
  }
  const p = Math.max(...Object.values(cenarios).map((c) => c.p95_ms));
  return { ok: true, p95_ms: p, intervalo_ms: p >= 1000 ? 60000 : 30000, execucoes, eventos, cenarios, maior_stdout_bytes: maiorStdout, dir: base };
}

if (ehEntrypoint(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(rodar())}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ ok: false, erro: 'bench', mensagem: e instanceof Error ? e.message : String(e) })}\n`);
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
/**
 * uso-subagent.mjs — hook `SubagentStop` (GM-10 T10, REQ-OBS-1, F7): tokens por subagent sem mod.
 *
 * Lê `agent_transcript_path`, soma `message.usage` com dedupe por `message.id`, relê a cada 40 ms até o arquivo parar de crescer
 * (2 leituras seguidas com o mesmo tamanho, depois da primeira espera) ou até 200 ms de espera no total (na hora do
 * SubagentStop a última mensagem ainda não está no arquivo: S8 P4, 7/7 subcontados, 51 ms bastaram) e grava
 * `custo.medicao { agente: 'subagent:<id>', … }` por `append` do diário. Só campos numéricos: o conteúdo das mensagens
 * nunca é guardado, gravado nem impresso.
 *
 * Contrato do hook: SAI 0 EM QUALQUER ENTRADA e não imprime nada. O caminho vem do stdin, então só vale arquivo regular
 * dentro de `~/.claude/projects` (realpath), lido por fd com O_NOFOLLOW e com teto de bytes; acima do teto lê o começo
 * e marca `parcial`.
 *
 * GM-11 T9: `dados` ganha `modelo` (último `message.model` real do transcript; `<synthetic>` e vazio não valem; nenhum ⇒ `null`,
 * a chave nunca falta) e, quando o `agent_type` é de um papel do gabarito, `papel`. `agente` segue `subagent:<id>`: o dedupe não muda.
 *
 * Ignora: `agent_type` vazio ou ausente (S7 P2: 25 de 28 disparos são forks do motor), `agent_id`/`session_id` fora
 * do padrão, repositório sem `.harness` ou sem a pasta da entrega (não cria diretório), agente que já tem
 * `custo.medicao` no diário (do mod ou de um disparo anterior deste hook: idempotente por `agent_id`).
 */
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ehEntrypoint } from '../lib/cli.mjs';
import { git, raizPorFs } from '../lib/git.mjs';

export const PASSO_MS = 40;
export const TETO_ESPERA_MS = 200;
export const TETO_BYTES = 8 * 1024 * 1024;
export const CAUDA_BYTES = 256 * 1024; // acima do teto, só para achar o último modelo real no fim do arquivo
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ID_ENTREGA_RE = /[A-Z]+-\d+/;
const CAMPOS = [
  ['input_tokens', 'input_tokens'],
  ['output_tokens', 'output_tokens'],
  ['cache_read_input_tokens', 'cache_read'],
  ['cache_creation_input_tokens', 'cache_creation'],
];

const PAPEIS = new Set(['sombra', 'revisor', 'implementador', 'spike']);
const PAPEL_RE = /^(?:[^:\s]+:)?gabarito-([a-z]+)$/;

/**
 * Papel do gabarito a partir do `agent_type` (`gabarito-sombra`, com ou sem prefixo `<plugin>:`). Tipo de outro agente, vazio ou
 * que não seja texto ⇒ `null`: nunca inventa papel.
 */
export function papelDoAgente(agentType) {
  if (typeof agentType !== 'string') return null;
  const m = PAPEL_RE.exec(agentType);
  return m !== null && PAPEIS.has(m[1]) ? m[1] : null;
}

/** Último `message.model` não vazio e que não começa com `<` (`<synthetic>`), na ordem das linhas; nenhum ⇒ `null`. Linha torta é ignorada. */
export function modeloDoTranscript(linhas) {
  let modelo = null;
  if (!Array.isArray(linhas)) return null;
  for (const l of linhas) {
    if (typeof l !== 'string' || !l.includes('"model"')) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const v = o?.message?.model;
    if (typeof v === 'string' && v !== '' && !v.startsWith('<')) modelo = v;
  }
  return modelo;
}

/** Espera por bloqueio (Atomics.wait), sem laço de CPU. */
function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Dentro de `~/.claude/projects`? Compara realpaths com separador, para `projects-outro` não passar. */
function caminhoValido(bruto) {
  if (typeof bruto !== 'string' || bruto === '' || bruto.includes('\0')) return null;
  try {
    const raiz = realpathSync(join(homedir(), '.claude', 'projects'));
    const real = realpathSync(bruto);
    if (!real.startsWith(raiz + sep)) return null;
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Lê até TETO_BYTES do começo; devolve as linhas inteiras e se havia mais arquivo. Nunca o arquivo todo acima do teto. */
function lerLinhas(real) {
  let fd = -1;
  try {
    fd = openSync(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return { linhas: [], parcial: false, tamanho: -1 };
    const parcial = st.size > TETO_BYTES;
    const n = Math.min(st.size, TETO_BYTES);
    const buf = Buffer.alloc(n);
    let lido = 0;
    while (lido < n) {
      const k = readSync(fd, buf, lido, n - lido, lido);
      if (k <= 0) break;
      lido += k;
    }
    let texto = buf.toString('utf8', 0, lido);
    if (parcial) texto = texto.slice(0, texto.lastIndexOf('\n') + 1); // descarta a linha cortada pelo teto
    let cauda = null;
    if (parcial) {
      // a cauda (últimos CAUDA_BYTES) serve só ao modelo: o último real é o do fim do arquivo, não o do começo lido
      const ini = st.size - CAUDA_BYTES;
      const cb = Buffer.alloc(CAUDA_BYTES);
      let lc = 0;
      while (lc < CAUDA_BYTES) {
        const k = readSync(fd, cb, lc, CAUDA_BYTES - lc, ini + lc);
        if (k <= 0) break;
        lc += k;
      }
      const t = cb.toString('utf8', 0, lc);
      cauda = t.slice(t.indexOf('\n') + 1).split('\n'); // descarta a primeira linha, cortada no meio
    }
    return { linhas: texto.split('\n'), cauda, parcial, tamanho: st.size };
  } catch {
    return { linhas: [], parcial: false, tamanho: -1 };
  } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* nada */ } }
  }
}

/** Soma `message.usage` por `message.id` (maior valor por campo); só números entram no mapa. Devolve `{parcial, tamanho, modelo}`. */
function acumular(real, porId) {
  const { linhas, cauda, parcial, tamanho } = lerLinhas(real);
  for (const l of linhas) {
    if (l === '' || !l.includes('"usage"')) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    const m = o?.message;
    const id = m?.id;
    const u = m?.usage;
    if (typeof id !== 'string' || id === '' || u === null || typeof u !== 'object') continue;
    const atual = porId.get(id) ?? {};
    for (const [de, para] of CAMPOS) {
      const v = u[de];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) atual[para] = Math.max(atual[para] ?? 0, v);
    }
    porId.set(id, atual);
  }
  return { parcial, tamanho, modelo: modeloDoTranscript(cauda ?? linhas) ?? (cauda === null ? null : modeloDoTranscript(linhas)) };
}

/**
 * Soma o uso do transcript: lê, e enquanto o arquivo cresce espera `PASSO_MS` e relê (a última mensagem chega depois do
 * disparo), juntando as leituras por `message.id`. Para quando duas leituras seguidas, ambas depois de uma espera, têm o
 * mesmo tamanho, ou quando as esperas somam `TETO_ESPERA_MS`. `leituras` conta as leituras feitas (só para teste: não é gravado).
 * `null` se o caminho não vale ou não há mensagem com uso.
 */
export function somarUso(caminho, { dormir: dorme = dormir } = {}) {
  const real = caminhoValido(caminho);
  if (real === null) return null;
  const porId = new Map();
  const primeira = acumular(real, porId);
  let { parcial } = primeira;
  let modelo = primeira.modelo;
  let leituras = 1;
  let esperado = 0;
  let anterior = null; // tamanho da leitura anterior, só de leituras feitas depois de uma espera
  while (esperado < TETO_ESPERA_MS) {
    dorme(PASSO_MS);
    esperado += PASSO_MS;
    const r = acumular(real, porId);
    leituras += 1;
    parcial = r.parcial || parcial;
    modelo = r.modelo ?? modelo; // a releitura mais nova vê o arquivo maior: o último real dela vale
    if (anterior !== null && r.tamanho === anterior) break;
    anterior = r.tamanho;
  }
  if (porId.size === 0) return null;
  const soma = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0, mensagens: porId.size, parcial, leituras, modelo };
  for (const u of porId.values()) for (const [, para] of CAMPOS) soma[para] += u[para] ?? 0;
  return soma;
}

function lerStdin() {
  try {
    const t = readFileSync(0, 'utf8');
    const o = JSON.parse(t);
    return o !== null && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Mesma regra da guarda para a pasta da entrega: id de PBI no nome da branch, senão `_sem-id`. */
function pastaEntrega(raiz, diario) {
  let branch = null;
  try { branch = git(['symbolic-ref', '--short', 'HEAD'], raiz) || null; } catch { /* HEAD solto ou sem git */ }
  const pbi = branch === null ? null : (ID_ENTREGA_RE.exec(branch)?.[0] ?? null);
  return diario.dirEntrega(raiz, pbi);
}

async function main() {
  const e = lerStdin();
  if (e === null) return;
  if (typeof e.agent_type !== 'string' || e.agent_type === '') return;
  if (typeof e.agent_id !== 'string' || !ID_RE.test(e.agent_id)) return;
  if (typeof e.session_id !== 'string' || !ID_RE.test(e.session_id)) return;

  const raizDe = (p) => (typeof p === 'string' && p !== '' ? raizPorFs(resolve(p)) : null);
  const raiz = raizDe(process.env.CLAUDE_PROJECT_DIR) ?? raizDe(e.cwd);
  if (raiz === null || !existsSync(join(raiz, '.harness'))) return;
  const diario = await import('../dist/diario.js');
  const dir = pastaEntrega(raiz, diario);
  if (!existsSync(dir)) return;

  const agente = `subagent:${e.agent_id}`;
  const jaMedido = () => diario.ler(dir).some((ev) => ev?.tipo === 'custo.medicao' && ev.agente === agente);
  if (jaMedido()) return;

  const soma = somarUso(e.agent_transcript_path);
  if (soma === null) return;
  const { parcial, leituras: _l, modelo, ...numeros } = soma;
  const papel = papelDoAgente(e.agent_type);
  const dadosBase = { ...numeros, modelo, ...(papel === null ? {} : { papel }) };
  if (jaMedido()) return;

  let autor = 'desconhecido';
  try { autor = git(['config', 'user.email'], raiz) || autor; } catch { /* sem user.email */ }
  diario.append(dir, e.session_id, {
    ts: new Date().toISOString(),
    autor,
    sessao: e.session_id,
    agente,
    tipo: 'custo.medicao',
    dados: parcial ? { ...dadosBase, parcial: true } : dadosBase,
  });
}

if (ehEntrypoint(import.meta.url)) {
  try {
    await main();
  } catch {
    /* o hook nunca derruba a sessão */
  }
  process.exitCode = 0;
}

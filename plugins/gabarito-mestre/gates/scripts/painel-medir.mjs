/**
 * `painel.mjs medir` (GM-14, REQ-DIA-1): o ÚNICO que grava `fato.medido`, e só quando o valor muda DENTRO DA SESSÃO (a 1ª medição de cada sessão
 * grava: é o que dá à sessão nova a âncora da pergunta (b)).
 *
 * Fatos e fontes: branch (git), spec (`docs/superpowers/specs/*.md` do checkout da sessão com `PBI: <ID>` no cabeçalho), plano (`plano.json` da
 * entrega), pr e release (`gh`, timeout de 5 s), agente (stdin do mod). Entrega = `idDaBranch` (a MESMA regra da trilha, T3); sem ela tudo vai a `_sem-id`.
 *
 * Contratos (DP-1, DP-2, DP-3 da Sombra):
 *  - `sessao` = `session_id` do stdin do mod (arquivo `events.<sessao>.jsonl`); sem ele nada é gravado (a âncora da pergunta (b) é por sessão).
 *  - `gh` ausente (ENOENT), sem login (rc 4), timeout, rc ≠ 0 ou saída que não é a lista esperada ⇒ NENHUM fato de `gh` gravado e
 *    `.harness/painel-medir.json` guarda `gh: 'falhou'` para a entrega; os motivos são distintos em `falhas`.
 *  - `.harness/painel-medir.json` = `{ "<ID>|_sem-id": { gh: 'ok'|'falhou', em } }`, tmp + rename (não é evento; `estado` só lê).
 *  - Diário existente mas ilegível ⇒ falha e nada gravado; diário ausente é só "primeira medição".
 * Relógio, `gh`/`git` (`rodar`) e stdin entram por parâmetro: o núcleo e os testes não dependem da máquina.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isatty } from 'node:tty';
import { join } from 'node:path';
import { append, dirEntrega, lerEstrito, padraoDeRecusa } from '../dist/diario.js';
import { idDaBranch } from '../dist/trilha.js';
import { temOnboarding } from '../dist/guarda.js';
import { lerConfigOrigin } from '../lib/config.mjs';
import { contexto } from './loop.mjs';

/** Falha com código: o despachante a devolve como `{ok:false, erro, ...}` e rc 1. */
export class Falha extends Error {
  constructor(erro, mensagem) {
    super(mensagem);
    this.erro = erro;
  }
}

const TIMEOUT_MS = 5000;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ID_PADRAO = '[A-Z]+-\\d+';
const DIR_SPECS = join('docs', 'superpowers', 'specs');
const SPEC_MAX = 1024 * 1024;
const STDIN_MAX = 4 * 1024 * 1024;
const AGENTES_MAX = 50;
const ESTADOS_GH = new Map([['OPEN', 'aberto'], ['MERGED', 'mergeado'], ['CLOSED', 'fechado']]);

/** Executor padrão de `git` e `gh`: sem shell, sem prompt, sem GIT_* herdado que desvie de repositório. */
function rodarPadrao(cmd, args, { cwd, timeoutMs }) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env });
}

/** Motivo da falha de um `gh` (distintos: ausente, timeout, sem login, rc, morto) ou `null` se rc 0. */
function falhaDoGh(r, nome) {
  if (r === null || typeof r !== 'object') return `gh_falhou: ${nome} sem resultado`;
  if (r.error) {
    const c = r.error.code;
    if (c === 'ENOENT') return 'gh_ausente';
    if (c === 'ETIMEDOUT') return 'gh_timeout';
    return `gh_erro: ${typeof c === 'string' ? c : 'desconhecido'}`;
  }
  if (r.signal) return r.signal === 'SIGTERM' ? 'gh_timeout' : 'gh_morto';
  if (r.status === 4) return 'gh_sem_login';
  return r.status === 0 ? null : `gh_falhou: ${nome} rc ${r.status}`;
}

/** Texto ⇒ JSON de lista, ou `null`. */
function listaJson(texto) {
  if (typeof texto !== 'string') return null;
  try {
    const v = JSON.parse(texto);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const textoLinha = (v) => typeof v === 'string' && v.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(v);

/** Serialização estável (chaves ordenadas): comparar valores sem depender da ordem dos campos. */
const canonico = (v) => JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** Identidade do fato dentro da chave: o mesmo `numero`/`caminho`/`id` é o mesmo fato (valor novo = evento novo). */
const IDENTIDADE = { spec: 'caminho', pr: 'numero', agente: 'id' };

/** Último `valor` medido da mesma chave (e identidade) NESTA sessão; `undefined` se nunca. */
function ultimoValor(eventos, sessao, chave, valor) {
  const campo = IDENTIDADE[chave];
  let achado;
  for (const e of eventos) {
    if (e?.tipo !== 'fato.medido' || e.sessao !== sessao || e.dados?.chave !== chave) continue;
    const v = e.dados.valor;
    if (v === null || typeof v !== 'object') continue;
    if (campo !== undefined && v[campo] !== valor[campo]) continue;
    achado = v;
  }
  return achado;
}

/** `idPadrao` da chave que a guarda lê (`fluxo.idPadrao`, origin/HEAD); ausente, não texto ou inválido ⇒ padrão. */
function idPadraoDe(raiz) {
  let v;
  try { v = lerConfigOrigin(raiz)?.cfg?.fluxo?.idPadrao; } catch { v = undefined; }
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return ID_PADRAO;
  try { new RegExp(v); } catch { return ID_PADRAO; }
  return v;
}

/** `PBI: <ID>` só das linhas antes do 1º `## `; o corpo nunca conta (DP-3 ajuste 1). */
function pbiDoCabecalho(linhas, reId) {
  for (const l of linhas) {
    if (/^##\s/.test(l)) return null;
    const m = /(?:^|[\s·])PBI:\s*([A-Za-z0-9-]+)(?![A-Za-z0-9-])/.exec(l);
    if (m !== null) return reId.test(m[1]) ? m[1] : null;
  }
  return null;
}

/** Specs do checkout `cwd` com o PBI da entrega. Pasta ausente ⇒ nenhuma; ilegível ⇒ falha. */
function specsDaEntrega(cwd, id, reId, falhas) {
  const dir = join(cwd, DIR_SPECS);
  let nomes;
  try {
    nomes = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch (e) {
    if (e?.code !== 'ENOENT') falhas.push('specs_ilegivel');
    return [];
  }
  const out = [];
  for (const nome of nomes) {
    const arq = join(dir, nome);
    let texto;
    try {
      if (statSync(arq).size > SPEC_MAX) { falhas.push(`spec_grande: ${nome}`); continue; }
      texto = readFileSync(arq, 'utf8');
    } catch {
      falhas.push(`spec_ilegivel: ${nome}`);
      continue;
    }
    const linhas = texto.split('\n');
    if (pbiDoCabecalho(linhas, reId) !== id) continue;
    out.push({ caminho: `${DIR_SPECS.split('\\').join('/')}/${nome}`, sha256: createHash('sha256').update(texto).digest('hex'), secoes: linhas.filter((l) => /^## /.test(l)).length });
  }
  return out;
}

/** Stdin do mod (`--agentes`) ⇒ objeto; vazio ou não JSON ⇒ `null` com o motivo. */
function lerStdin() {
  if (isatty(0)) return '';
  const partes = [];
  const buf = Buffer.alloc(65536);
  let total = 0;
  for (;;) {
    let n;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e?.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
      if (e?.code === 'EOF') break;
      throw new Falha('stdin_ausente', `stdin ilegível (${e?.code ?? e?.message})`);
    }
    if (n === 0) break;
    total += n;
    if (total > STDIN_MAX) throw new Falha('stdin_invalido', `stdin passa de ${STDIN_MAX} bytes`);
    partes.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(partes).toString('utf8');
}

function entradaDoMod(agentes, stdin) {
  if (agentes === undefined || agentes === false || agentes === null) return { ok: true, entrada: null };
  if (agentes !== true) return { ok: true, entrada: agentes };
  let texto;
  try { texto = (stdin ?? lerStdin)(); } catch (e) { return { ok: false, motivo: e?.erro ?? 'stdin_ausente' }; }
  if (typeof texto !== 'string' || texto.trim() === '') return { ok: false, motivo: 'stdin_ausente' };
  try {
    const v = JSON.parse(texto);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? { ok: true, entrada: v } : { ok: false, motivo: 'stdin_invalido' };
  } catch {
    return { ok: false, motivo: 'stdin_invalido' };
  }
}

/** `session_id` do mod: do stdin (`session_id`, ou `sessao.session_id`), nunca inventado. */
function sessaoDe(entrada, opcoes) {
  const bruta = opcoes.sessao ?? entrada?.session_id ?? entrada?.sessao?.session_id;
  return typeof bruta === 'string' && bruta !== '' ? bruta : null;
}

/** `.harness/painel-medir.json`: read-modify-write por tmp + rename. Ausente ou ilegível ⇒ recomeça (é cache, não fonte). */
function gravarEstadoGh(raiz, chave, gh, emMs) {
  const dir = join(raiz, '.harness');
  const arq = join(dir, 'painel-medir.json');
  let atual = {};
  try {
    const v = JSON.parse(readFileSync(arq, 'utf8'));
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) atual = v;
  } catch { /* ausente ou corrompido: recomeça */ }
  atual[chave] = { gh, em: new Date(emMs).toISOString() };
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${arq}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(atual)}\n`);
    renameSync(tmp, arq);
    return null;
  } catch (e) {
    return `painel_medir_nao_gravou: ${e?.code ?? 'erro'}`;
  }
}

/**
 * Mede e grava. `opcoes`: `rodar(cmd, args, {cwd, timeoutMs})` (padrão `spawnSync`), `agentes` (objeto do stdin do mod, ou `true` para ler o stdin;
 * ausente ⇒ nada de agente e nada de sessão), `sessao` (substitui o `session_id`), `timeoutMs` (padrão 5000), `agora` (ms), `stdin` (função).
 * → `{ ok, gravados: ChaveFato[], falhas: string[] }`; `ok` só sem falha. Nunca lança.
 */
export function medir(cwd, opcoes = {}) {
  const gravados = [];
  const falhas = [];
  const fim = () => ({ ok: falhas.length === 0, gravados, falhas });
  const rodar = opcoes.rodar ?? rodarPadrao;
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS;
  const agora = opcoes.agora ?? Date.now;

  try {
    const lida = entradaDoMod(opcoes.agentes, opcoes.stdin);
    if (!lida.ok) { falhas.push(lida.motivo); return fim(); }
    const sessao = sessaoDe(lida.entrada, opcoes);
    if (sessao === null) { falhas.push('sem_sessao'); return fim(); }
    if (!SESSAO_RE.test(sessao)) { falhas.push('sessao_invalida'); return fim(); }

    let raiz;
    try { raiz = contexto(cwd, { entrega: '_sem-id' }).raiz; } catch (e) { falhas.push(e?.erro ?? 'fora_de_repo'); return fim(); }
    // T60 (emenda 68): sem onboarding o painel só lê; nenhuma escrita em `.harness/` e nenhuma chamada a `gh`. Não é falha.
    if (!temOnboarding(raiz)) return fim();

    // branch (git). HEAD solto não é falha: não há branch a registrar.
    const rb = rodar('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd, timeoutMs });
    let branch = null;
    if (rb?.error || rb?.signal || (rb?.status !== 0 && rb?.status !== 1)) falhas.push('git_falhou');
    else if (rb.status === 0) branch = String(rb.stdout ?? '').trim() || null;

    const idPadrao = idPadraoDe(raiz);
    const id = idDaBranch(branch, idPadrao);
    const dir = dirEntrega(raiz, id);
    const chaveGh = id !== null && dir.endsWith(id) ? id : '_sem-id';

    let eventos = [];
    if (existsSync(dir)) {
      const lido = lerEstrito(dir);
      if (!lido.ok) { falhas.push(`diario_corrompido: ${lido.motivo}`); return fim(); }
      eventos = lido.eventos;
    }

    /** Candidatos `{chave, fonte, valor}` na ordem de gravação. */
    const fatos = [];
    if (branch !== null) fatos.push({ chave: 'branch', fonte: 'git', valor: { nome: branch } });

    if (id !== null) {
      let reId;
      try { reId = new RegExp(`^(?:${idPadrao})$`); } catch { reId = new RegExp(`^(?:${ID_PADRAO})$`); }
      for (const s of specsDaEntrega(cwd, id, reId, falhas)) fatos.push({ chave: 'spec', fonte: 'arquivo', valor: s });
      const arqPlano = join(dir, 'plano.json');
      if (existsSync(arqPlano)) {
        try {
          const p = JSON.parse(readFileSync(arqPlano, 'utf8'));
          if (p === null || typeof p !== 'object' || !Array.isArray(p.tasks)) throw new Error('forma');
          fatos.push({ chave: 'plano', fonte: 'arquivo', valor: { tasks: p.tasks.length } });
        } catch {
          falhas.push('plano_ilegivel');
        }
      }
    }

    // gh: tudo ou nada. Qualquer falha ⇒ nenhum fato de gh e `gh: 'falhou'`.
    const deGh = [];
    let falhaGh = null;
    if (id !== null) {
      const r = rodar('gh', ['pr', 'list', `--head=${branch}`, '--state', 'all', '--limit', '30', '--json', 'number,state'], { cwd, timeoutMs });
      falhaGh = falhaDoGh(r, 'pr list');
      if (falhaGh === null) {
        const lista = listaJson(r.stdout);
        const ok = lista !== null && lista.every((p) => p !== null && typeof p === 'object' && Number.isInteger(p.number) && p.number > 0
          && typeof p.state === 'string' && ESTADOS_GH.has(p.state.toUpperCase()));
        if (!ok) falhaGh = 'gh_json_invalido: pr list';
        else for (const p of lista) deGh.push({ chave: 'pr', fonte: 'gh', valor: { numero: p.number, estado: ESTADOS_GH.get(p.state.toUpperCase()), branch } });
      }
    }
    if (falhaGh === null) {
      const r = rodar('gh', ['release', 'list', '--limit', '1', '--json', 'tagName'], { cwd, timeoutMs });
      falhaGh = falhaDoGh(r, 'release list');
      if (falhaGh === null) {
        const lista = listaJson(r.stdout);
        if (lista === null || !lista.every((x) => x !== null && typeof x === 'object' && textoLinha(x.tagName))) falhaGh = 'gh_json_invalido: release list';
        else if (lista.length > 0) deGh.push({ chave: 'release', fonte: 'gh', valor: { tag: lista[0].tagName } });
      }
    }
    if (falhaGh === null) fatos.push(...deGh);
    else falhas.push(falhaGh);
    const erroEstado = gravarEstadoGh(raiz, chaveGh, falhaGh === null ? 'ok' : 'falhou', agora());
    if (erroEstado !== null) falhas.push(erroEstado);

    // agentes (stdin do mod): só {id, papel, estado}; o resto da entrada (descrição, transcript) nunca vai ao diário.
    const lista = lida.entrada?.agentes;
    if (Array.isArray(lista)) {
      for (const a of lista.slice(0, AGENTES_MAX)) {
        if (a === null || typeof a !== 'object' || !textoLinha(a.id) || !textoLinha(a.type) || !textoLinha(a.status)) { falhas.push('agente_invalido'); continue; }
        fatos.push({ chave: 'agente', fonte: 'mod', valor: { id: a.id, papel: a.type, estado: a.status } });
      }
    }

    for (const f of fatos) {
      const antes = ultimoValor(eventos, sessao, f.chave, f.valor);
      if (antes !== undefined && canonico(antes) === canonico(f.valor)) continue;
      const ev = { ts: new Date(agora()).toISOString(), autor: 'painel', sessao, agente: 'painel', tipo: 'fato.medido', dados: { chave: f.chave, fonte: f.fonte, valor: f.valor } };
      // recusa (canário/tamanho): `diario.recusa` só quando o motivo muda dentro da sessão (1 por sessão por motivo); não é progresso.
      const padrao = padraoDeRecusa(ev);
      if (padrao !== null && eventos.some((e) => e?.tipo === 'diario.recusa' && e.sessao === sessao && e.dados?.padrao === padrao)) { falhas.push(`recusado: ${f.chave}`); continue; }
      const r = append(dir, sessao, ev);
      if (!r.ok) { falhas.push(`nao_gravou: ${f.chave}: ${String(r.erro).slice(0, 160)}`); continue; }
      if (r.gravado !== 'evento') {
        eventos = [...eventos, { ts: ev.ts, autor: ev.autor, sessao, agente: ev.agente, tipo: 'diario.recusa', dados: { tipo: 'fato.medido', padrao: padrao ?? 'desconhecido' }, seq: 0, hash_anterior: null }];
        falhas.push(`recusado: ${f.chave}`);
        continue;
      }
      eventos = [...eventos, { ...ev, seq: 0, hash_anterior: null }];
      gravados.push(f.chave);
    }
  } catch (e) {
    falhas.push(`erro_interno: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
  }
  return fim();
}

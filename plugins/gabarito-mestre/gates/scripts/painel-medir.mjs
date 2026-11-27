/**
 * `painel.mjs medir` (GM-14, REQ-DIA-1): o ÚNICO que grava `fato.medido`, e só quando o valor muda DENTRO DA SESSÃO (a 1ª medição de cada sessão
 * grava: é o que dá à sessão nova a âncora da pergunta (b)).
 *
 * Fatos e fontes: branch (git), spec (`docs/superpowers/specs/*.md` do checkout da sessão com `PBI: <ID>` no cabeçalho), plano (`plano.json` da
 * entrega), pr e release (`gh`, timeout de 5 s), agente (stdin do mod). Entrega = `idDaBranch` (a MESMA regra da trilha, T3); sem ela tudo vai a `_sem-id`.
 *
 * GM-15 T4 (REQ-ENT-1 a, c): o `medir` grava também `entrega.encerrada` (a única coisa além de `fato.medido`; origem automática). O PR da entrega vem por
 * head (`--head`), por título (`--base main --state merged --search "<ID> in:title"`, `via: 'titulo'`) e por remedição por número (`gh pr view`) de todo PR
 * que o diário dá como `aberto`; `fato.medido pr` ganha `base` e `via`. Encerra quem `podeEncerrar` (trilha.ts), com `mergeado_em` = `mergedAt` do `gh`
 * (nunca o relógio local), em `dirEntrega(raiz, id)` (nunca `_sem-id`). Mede também a "última entrega conhecida" sem encerramento (a do painel).
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
import { encerramentoDe, idDaBranch, podeEncerrar } from '../dist/trilha.js';
import { validarPlano } from '../dist/plano.js';
import { ehViradaDePreVersao, preVersoesDe, temOnboarding, versaoAlvo } from '../dist/guarda.js';
import { idPadraoDe, lerBaseDaEntrega } from '../lib/config.mjs';
import { lerConfigEntrega, resolverBaseEntrega } from '../dist/entrega.js';
import { contexto } from './loop.mjs';

const ID_FORA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAMPOS_PR = 'number,state,baseRefName,headRefName,title,mergedAt,mergeCommit,isDraft';
const SHA_GIT_RE = /^[0-9a-f]{40,64}$/;

/** GM-21 DT1: as tasks do `plano.json` VÁLIDO de `dir` (`{tasks: [id…]}`); ausente, ilegível ou inválido ⇒ `null` (a regra de hoje). Nunca lança. */
function planoDaEntrega(dir) {
  try {
    const v = validarPlano(JSON.parse(readFileSync(join(dir, 'plano.json'), 'utf8')));
    return v.ok ? { tasks: v.plano.tasks.map((t) => t.id) } : null;
  } catch {
    return null;
  }
}

/** Item da lista do `gh` ⇒ PR normalizado ou `null` (forma inválida). `base`/`mergeado_em` só existem quando o `gh` os devolve. */
function prDoGh(p, baseEntrega) {
  if (p === null || typeof p !== 'object' || !Number.isInteger(p.number) || p.number <= 0 || typeof p.state !== 'string' || !ESTADOS_GH.has(p.state.toUpperCase())) return null;
  for (const k of ['baseRefName', 'headRefName', 'title', 'mergedAt']) if (p[k] !== undefined && p[k] !== null && typeof p[k] !== 'string') return null;
  const estado = ESTADOS_GH.get(p.state.toUpperCase());
  const mergeadoEm = typeof p.mergedAt === 'string' && !Number.isNaN(Date.parse(p.mergedAt)) ? p.mergedAt : null;
  if (p.state.toUpperCase() === 'MERGED' && p.baseRefName === baseEntrega && mergeadoEm === null) return null; // sem `mergedAt` não há `mergeado_em` a gravar
  return { numero: p.number, estado, base: textoLinha(p.baseRefName) ? p.baseRefName : null, head: textoLinha(p.headRefName) ? p.headRefName : null, titulo: typeof p.title === 'string' ? p.title : '', mergeado_em: mergeadoEm, sha: typeof p.mergeCommit?.oid === 'string' && SHA_GIT_RE.test(p.mergeCommit.oid) ? p.mergeCommit.oid : null, rascunho: p.isDraft === true }; // `sha`: o commit de merge (GM-20 D-G47); ilegível ⇒ null, não falha
}

/** `gh pr list|view` ⇒ `{falha}` ou `{lista}` (normalizada). */
function ghPrs(rodar, cwd, timeoutMs, args, nome, unico, baseEntrega) {
  const r = rodar('gh', args, { cwd, timeoutMs });
  const falha = falhaDoGh(r, nome);
  if (falha !== null) return { falha };
  let v;
  try { v = JSON.parse(r.stdout); } catch { return { falha: `gh_json_invalido: ${nome}` }; }
  const bruta = unico ? [v] : v;
  if (!Array.isArray(bruta)) return { falha: `gh_json_invalido: ${nome}` };
  const lista = bruta.map((x) => prDoGh(x, baseEntrega));
  return lista.every((x) => x !== null) ? { lista } : { falha: `gh_json_invalido: ${nome}` };
}

/** Último estado medido por número (qualquer sessão): os que o diário dá como `aberto`. */
function abertosDoDiario(eventos) {
  const por = new Map();
  for (const e of eventos) {
    const v = e?.tipo === 'fato.medido' && e.dados?.chave === 'pr' ? e.dados.valor : null;
    if (v !== null && typeof v === 'object' && Number.isInteger(v.numero)) por.set(v.numero, v.estado);
  }
  return [...por].filter(([, est]) => est === 'aberto').map(([n]) => n);
}

/** A "última entrega conhecida" (a do painel: `ts` mais recente) ⇒ `{id, dir, eventos}` se não está encerrada e não é `exceto`; senão `null`. Ilegível ⇒ não conta. */
function ultimaSemEncerramento(raiz, exceto, reId) {
  let nomes;
  try { nomes = readdirSync(join(raiz, '.harness', 'entregas')); } catch { return null; }
  let melhor = null;
  for (const id of nomes) {
    if (id.startsWith('_') || !ID_FORA_RE.test(id) || !reId.test(id)) continue;
    const dir = dirEntrega(raiz, id);
    if (!dir.endsWith(id)) continue;
    const lido = lerEstrito(dir);
    if (!lido.ok) continue;
    const maior = lido.eventos.reduce((m, e) => (typeof e?.ts === 'string' && e.ts > m ? e.ts : m), '');
    if (maior !== '' && (melhor === null || maior > melhor.maior)) melhor = { id, dir, eventos: lido.eventos, maior };
  }
  return melhor === null || melhor.id === exceto || encerramentoDe(melhor.eventos, melhor.id).encerrada ? null : melhor;
}

/** Falha com código: o despachante a devolve como `{ok:false, erro, ...}` e rc 1. */
export class Falha extends Error {
  constructor(erro, mensagem) {
    super(mensagem);
    this.erro = erro;
  }
}

const TIMEOUT_MS = 5000;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
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
  const avisosBase = [];
  const fim = () => ({ ok: falhas.length === 0, gravados, falhas, ...(avisosBase.length > 0 ? { avisos: avisosBase } : {}) });
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
      const reId = new RegExp(`^(?:${idPadrao})$`); // `idPadraoDe` (a fonte única) só devolve regex válida
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

    // gh: tudo ou nada. Qualquer falha ⇒ nenhum fato de gh (nem encerramento) e `gh: 'falhou'`.
    const deGh = [];
    const encerrar = []; // PRs candidatos a encerrar a entrega `id` (e a "última conhecida")
    let falhaGh = null;
    // GM-20 T6 (REQ-CRD-2): a base de encerramento é a configurada da entrega (a MESMA regra do comando de entrega), lida 1 vez por execução; nunca lança
    const lidaBase = lerBaseDaEntrega(raiz, { lerConfigEntrega, resolverBaseEntrega });
    const baseEntrega = lidaBase.resolvida.base;
    for (const a of lidaBase.avisos.filter((x) => !String(x).startsWith('nenhuma base declarada'))) avisosBase.push(String(a).slice(0, 160)); // o mesmo sinal do comando de entrega, fora de `falhas` (aviso não derruba `ok`)
    const reIdEntrega = new RegExp(`^(?:${idPadrao})$`);
    const alvoExtra = ultimaSemEncerramento(raiz, id, reIdEntrega);
    /** Mede os PRs de uma entrega: head (se há branch), título e remedição por número do que o diário dá como `aberto`. */
    const medirPrs = (alvo) => {
      const achados = new Map();
      /** O título é da entrega `alvo` só pelo ID do prefixo `tipo(ID):`; sem prefixo, só se for o ÚNICO ID do padrão (título que cita outra entrega é ambíguo: não encerra). */
      const casaTitulo = (titulo) => {
        const pre = /^[A-Za-z]+\(([^)]*)\)!?:/.exec(titulo);
        if (pre !== null) return pre[1].trim() === alvo.id;
        const ids = new Set(titulo.match(new RegExp(`(?<![A-Za-z0-9-])(?:${idPadrao.replace(/^\^/, '').replace(/\$$/, '')})(?![A-Za-z0-9-])`, 'g')) ?? []);
        return ids.size === 1 && ids.has(alvo.id);
      };
      const guarda = (p, via) => {
        if (achados.has(p.numero)) return;
        const comBase = p.base !== null;
        achados.set(p.numero, { numero: p.numero, estado: p.estado, branch: p.head ?? alvo.branch ?? 'desconhecida', base: p.base, via: comBase ? via : null, mergeado_em: p.mergeado_em, titulo: p.titulo, sha: p.sha, rascunho: p.rascunho });
      };
      if (alvo.branch !== null) {
        const r = ghPrs(rodar, cwd, timeoutMs, ['pr', 'list', `--head=${alvo.branch}`, '--state', 'all', '--limit', '30', '--json', CAMPOS_PR], 'pr list', false, baseEntrega);
        if (r.falha) return r;
        for (const p of r.lista) guarda(p, 'head');
      }
      const t = ghPrs(rodar, cwd, timeoutMs, ['pr', 'list', '--base', baseEntrega, '--state', 'merged', '--search', `${alvo.id} in:title`, '--limit', '30', '--json', CAMPOS_PR], 'pr list titulo', false, baseEntrega);
      if (t.falha) return t;
      for (const p of t.lista) if (p.base === baseEntrega && p.head !== null && casaTitulo(p.titulo)) guarda(p, 'titulo');
      for (const n of abertosDoDiario(alvo.eventos)) {
        if (achados.has(n)) continue;
        const v = ghPrs(rodar, cwd, timeoutMs, ['pr', 'view', String(n), '--json', CAMPOS_PR], 'pr view', true, baseEntrega);
        if (v.falha) return v;
        const p = v.lista[0];
        const porHead = idDaBranch(p.head, idPadrao) === alvo.id;
        // head de outra entrega e título sem o ID (`via` ausente): o fato sai da entrega na releitura (`prs()`)
        guarda(p, porHead ? 'head' : p.base === baseEntrega && p.mergeado_em !== null && casaTitulo(p.titulo) ? 'titulo' : null);
      }
      // GM-20 D-G47: base ≠ main e já encerrada com sha ⇒ o PR em `main` que contém esse sha (a virada) vira fato `pr` com `contem`; é o que tira o lembrete "levar <base> para main"
      const shaEnc = alvo.eventos.filter((e) => e?.tipo === 'entrega.encerrada' && e.dados?.entrega === alvo.id && typeof e.dados?.sha === 'string' && SHA_GIT_RE.test(e.dados.sha)).map((e) => e.dados.sha).pop();
      if (baseEntrega !== 'main' && shaEnc !== undefined) {
        const m = ghPrs(rodar, cwd, timeoutMs, ['pr', 'list', '--base', 'main', '--state', 'merged', '--search', shaEnc, '--limit', '5', '--json', CAMPOS_PR], 'pr list virada', false, baseEntrega);
        if (m.falha) return m;
        for (const p of m.lista) {
          if (p.base !== 'main' || p.estado !== 'mergeado' || p.mergeado_em === null) continue;
          const antes = achados.get(p.numero);
          if (antes !== undefined) antes.contem = shaEnc;
          else achados.set(p.numero, { numero: p.numero, estado: p.estado, branch: p.head ?? 'desconhecida', base: p.base, via: null, mergeado_em: p.mergeado_em, titulo: p.titulo, sha: p.sha, contem: shaEnc });
        }
      }
      return { prs: [...achados.values()] };
    };
    const alvos = [];
    if (id !== null) alvos.push({ id, branch, eventos, dir, sessao: true });
    if (alvoExtra !== null) alvos.push({ id: alvoExtra.id, branch: null, eventos: alvoExtra.eventos, dir: alvoExtra.dir, sessao: false });
    for (const alvo of alvos) {
      if (falhaGh !== null) break; // gh ausente/timeout: a próxima chamada falharia igual, e cada uma custa o timeout
      const r = medirPrs(alvo);
      if (r.falha) { falhaGh = r.falha; break; }
      for (const p of r.prs) {
        const valor = { numero: p.numero, estado: p.estado, branch: p.branch };
        if (p.base !== null) valor.base = p.base;
        if (p.via !== null) valor.via = p.via;
        if (p.contem !== undefined) valor.contem = p.contem;
        if (p.rascunho === true) valor.rascunho = true; // GM-21 T8: só o rascunho vira campo (sem ele = não rascunho); sair do rascunho muda o valor e grava o fato novo
        const pv = preVersoesDe(p.titulo, p.branch)[0];
        if (pv !== undefined && pv.length <= 64) valor.pre_versao = pv; // a guarda lê daqui (a MESMA ehViradaDePreVersao)
        deGh.push({ chave: 'pr', fonte: 'gh', valor, alvo });
        if (p.base === baseEntrega && p.mergeado_em !== null && !ehViradaDePreVersao(p, versaoAlvo(raiz, alvo.dir))) {
          encerrar.push({ alvo, pr: p });
        }
      }
    }
    if (falhaGh === null) {
      const r = rodar('gh', ['release', 'list', '--limit', '1', '--json', 'tagName'], { cwd, timeoutMs });
      falhaGh = falhaDoGh(r, 'release list');
      if (falhaGh === null) {
        const lista = listaJson(r.stdout);
        if (lista === null || !lista.every((x) => x !== null && typeof x === 'object' && textoLinha(x.tagName))) falhaGh = 'gh_json_invalido: release list';
        else if (lista.length > 0) deGh.push({ chave: 'release', fonte: 'gh', valor: { tag: lista[0].tagName }, alvo: null });
      }
    }
    if (falhaGh === null) fatos.push(...deGh.filter((f) => f.alvo === null || f.alvo.sessao));
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

    /** Grava `lista` no diário `dir` (só o que mudou NESTA sessão); devolve os eventos relidos. */
    const gravar = (dirAlvo, eventosAlvo, lista) => {
      let evs = eventosAlvo;
      for (const f of lista) {
        const antes = ultimoValor(evs, sessao, f.chave, f.valor);
        if (antes !== undefined && canonico(antes) === canonico(f.valor)) continue;
        const ev = { ts: new Date(agora()).toISOString(), autor: 'painel', sessao, agente: 'painel', tipo: f.tipo ?? 'fato.medido', dados: f.dados ?? { chave: f.chave, fonte: f.fonte, valor: f.valor } };
        // recusa (canário/tamanho): `diario.recusa` só quando o motivo muda dentro da sessão (1 por sessão por motivo); não é progresso.
        const padrao = padraoDeRecusa(ev);
        const rotulo = f.chave ?? f.tipo;
        if (padrao !== null && evs.some((e) => e?.tipo === 'diario.recusa' && e.sessao === sessao && e.dados?.padrao === padrao)) { falhas.push(`recusado: ${rotulo}`); continue; }
        const r = append(dirAlvo, sessao, ev);
        if (!r.ok) { falhas.push(`nao_gravou: ${rotulo}: ${String(r.erro).slice(0, 160)}`); continue; }
        if (r.gravado !== 'evento') {
          evs = [...evs, { ts: ev.ts, autor: ev.autor, sessao, agente: ev.agente, tipo: 'diario.recusa', dados: { tipo: ev.tipo, padrao: padrao ?? 'desconhecido' }, seq: 0, hash_anterior: null }];
          falhas.push(`recusado: ${rotulo}`);
          continue;
        }
        evs = [...evs, { ...ev, seq: 0, hash_anterior: null }];
        gravados.push(rotulo);
      }
      return evs;
    };
    eventos = gravar(dir, eventos, fatos);
    if (falhaGh === null) {
      // a "última conhecida" (outra entrega): só os `pr` dela e o encerramento
      for (const alvo of alvos.filter((x) => !x.sessao)) alvo.eventos = gravar(alvo.dir, alvo.eventos, deGh.filter((f) => f.alvo === alvo));
      if (id !== null) alvos[0].eventos = eventos;
      // encerramento: o 1º PR (por `mergeado_em`) que `podeEncerrar`, sobre o diário RELIDO do disco (os eventos em memória não têm `seq` real, e outra sessão
      // pode ter gravado agora); depois de gravado, os demais já não encerram.
      for (const { alvo, pr } of encerrar.sort((x, y) => Date.parse(x.pr.mergeado_em) - Date.parse(y.pr.mergeado_em))) {
        if (!alvo.dir.endsWith(alvo.id)) continue;
        const lido = lerEstrito(alvo.dir);
        if (!lido.ok) { falhas.push(`diario_corrompido: ${lido.motivo}`); break; }
        // GM-21 DT1: a regra única também olha o plano da entrega (`plano.json` válido de `alvo.dir`; ausente ou inválido ⇒ sem plano, a regra de hoje)
        const plano = planoDaEntrega(alvo.dir);
        // (o aviso de plano aberto não sai aqui: o mod descarta a saída do `medir`; ele sai no `painel.mjs estado`, `avisoDePlanoAberto`)
        if (!podeEncerrar(lido.eventos, alvo.id, pr, baseEntrega, plano)) continue; // a regra única, com a base da entrega (REQ-CRD-2)
        const dados = { entrega: alvo.id, pr: pr.numero, via: pr.via, mergeado_em: pr.mergeado_em, ...(pr.sha ? { sha: pr.sha } : {}) };
        gravar(alvo.dir, lido.eventos, [{ tipo: 'entrega.encerrada', dados, valor: dados }]);
      }
    }
  } catch (e) {
    falhas.push(`erro_interno: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
  }
  return fim();
}

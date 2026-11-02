/**
 * Anéis fixos da guarda (REQ-GRD-5, Q14, Q15) e o leitor de Bash que os alimenta. Puro: sem I/O, sem `process.env`.
 *
 * - Segredo bloqueia leitura e escrita. Integridade bloqueia só escrita (Q2).
 * - O leitor de Bash é deliberadamente pequeno (E1:56): segmenta por `&&`, `||`, `;`, `|`, `&`, quebra de
 *   linha, parênteses e crases, respeita aspas, junta `\`+quebra, corta comentário, lê `$(…)`/crases dentro de
 *   aspas duplas (um nível) e descarta prefixos transparentes (Q10, palavras de controle, `@versão` de npx).
 *   Heredoc: o corpo é dado quando todo comando da linha o lê como dado (`cat`, `git`, `tee`…); com delimitador sem
 *   aspas, `$(…)` e crases do corpo valem como comando; interpretador na linha (`sh`, `bash`, `python`, `| bash`) ou
 *   terminador ausente ⇒ o corpo é lido como comando. Sem tokenizador completo, sem backreference.
 * - Teto de 65 536 caracteres (UTF-16) por comando: `segmentar` só lê o início; `decidir` pede (orquestrador) ou nega
 *   (subagent) o que passa disso, porque a cauda não foi inspecionada (Q17, proposta pendente do dono).
 */

import { posix } from 'node:path';
import type { Contexto } from './tipos.ts';

export type Anel = 'segredo' | 'integridade';

export type Segmento = {
  /** Texto do segmento, sem comentário. Só serve para casar `permitidos`; nunca vai para evento nem mensagem. */
  cru: string;
  /** Primeiro token efetivo (basename), depois de atribuições e prefixos transparentes. */
  cmd: string;
  /** Tokens depois do comando, sem redirecionamentos. */
  args: string[];
  /** Os mesmos tokens, com `$` de aspas simples neutralizado (`\u0000`): é o que o shell NÃO expande. */
  exp: string[];
  /** Atribuições `K=V` que antecedem o comando. */
  atribs: string[];
  /** Alvos de `>` e `>>`. */
  saidas: string[];
  /** Alvos de `<`. */
  entradas: string[];
  /** A saída deste segmento entra no próximo por `|` ou `|&`. */
  pipe: boolean;
  /** Está dentro de `$(…)`, crase, `<(…)` ou `>(…)`: a saída vira argumento de outro comando. */
  subst: boolean;
};

type Tok = { t: string; e: string; op?: '>' | '<' };
type Bruto = { cru: string; toks: Tok[]; pipe: boolean; subst: boolean };

const NEUTRO = '\u0000';
const SUBST = '\u0001';
export const TETO_COMANDO = 65536;

type Heredoc = { delim: string; citado: boolean; tabs: boolean };

/** Lê o delimitador de um heredoc; `k` aponta para o que vem depois de `<<`. `null` se não houver palavra. */
function lerDelimitador(src: string, k: number): { h: Heredoc; fim: number } | null {
  const n = src.length;
  let tabs = false;
  if (src[k] === '-') {
    tabs = true;
    k++;
  }
  while (src[k] === ' ' || src[k] === '\t') k++;
  const ini = k;
  let delim = '';
  let citado = false;
  while (k < n) {
    const c = src[k];
    if (c === "'") {
      const j = src.indexOf("'", k + 1);
      if (j < 0) return null;
      citado = true;
      delim += src.slice(k + 1, j);
      k = j + 1;
    } else if (c === '"') {
      citado = true;
      k++;
      while (k < n && src[k] !== '"') {
        if (src[k] === '\\' && k + 1 < n) k++;
        delim += src[k++];
      }
      if (k >= n) return null;
      k++;
    } else if (c === '\\') {
      citado = true;
      if (k + 1 < n) delim += src[k + 1];
      k += 2;
    } else if (/[\s;&|<>()]/.test(c)) break;
    else delim += src[k++];
  }
  if (k === ini || delim === '') return null;
  return { h: { delim, citado, tabs }, fim: k };
}

/**
 * Corpo de um heredoc: `ini` é o primeiro caractere da primeira linha do corpo. Devolve o corpo e o índice do `\n`
 * (ou do fim) que fecha a linha do terminador; `null` se o terminador não existe (corpo lido como comando).
 */
function corpoDeHeredoc(src: string, ini: number, h: Heredoc): { corpo: string; fim: number } | null {
  const n = src.length;
  let pos = ini;
  for (;;) {
    let e = src.indexOf('\n', pos);
    const ultima = e < 0;
    if (ultima) e = n;
    let linha = src.slice(pos, e);
    if (h.tabs) linha = linha.replace(/^\t+/, '');
    if (linha === h.delim) return { corpo: src.slice(ini, pos), fim: e };
    if (ultima) return null;
    pos = e + 1;
  }
}

const MAX_HEREDOCS = 16;

function fimDeSubstituicao(src: string, ini: number, abre: string): number {
  // `ini` aponta para o primeiro caractere depois de `$(` ou da crase de abertura.
  if (abre === '`') {
    const j = src.indexOf('`', ini);
    return j < 0 ? src.length : j;
  }
  let prof = 1;
  const pend: Heredoc[] = [];
  const sem = new Set<string>();
  for (let j = ini; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === "'") {
      const k = src.indexOf("'", j + 1);
      if (k > 0) j = k;
    } else if (c === '"') {
      let k = j + 1;
      while (k < src.length && src[k] !== '"') k += src[k] === '\\' ? 2 : 1;
      if (k < src.length) j = k;
    } else if (c === '<' && src[j + 1] === '<' && src[j + 2] !== '<' && src[j - 1] !== '<') {
      const d = lerDelimitador(src, j + 2);
      if (d && pend.length < MAX_HEREDOCS) {
        pend.push(d.h);
        j = d.fim - 1;
      } else j++;
    } else if (c === '\n' && pend.length) {
      let fim = j;
      for (const h of pend) {
        if (sem.has(h.delim)) continue;
        const r = corpoDeHeredoc(src, fim + 1, h);
        if (r) fim = r.fim;
        else sem.add(h.delim);
      }
      pend.length = 0;
      j = fim;
    } else if (c === '(') prof++;
    else if (c === ')' && --prof === 0) return j;
  }
  return src.length;
}

/** `$(…)` e crases no corpo de um heredoc sem aspas: o shell executa. */
function expansoesDoCorpo(corpo: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (c === '\\') i++;
    else if (c === '$' && corpo[i + 1] === '(') {
      const fim = fimDeSubstituicao(corpo, i + 2, '(');
      out.push(corpo.slice(i + 2, fim));
      i = fim;
    } else if (c === '`') {
      const fim = fimDeSubstituicao(corpo, i + 1, '`');
      out.push(corpo.slice(i + 1, fim));
      i = fim;
    }
  }
  return out;
}

// Quem lê o heredoc só como dado. Qualquer outro comando na linha (sh, bash, python, ssh, …) faz do corpo um script.
const LE_COMO_DADO = new Set([
  'cat', 'tee', 'git', 'gh', 'wc', 'sort', 'uniq', 'head', 'tail', 'tr', 'cut', 'grep', 'egrep', 'fgrep', 'rg', 'jq', 'diff', 'cmp',
  'base64', 'shasum', 'sha256sum', 'md5sum', 'nl', 'fold', 'column', 'echo', 'printf',
]);

function lexar(src: string): { segs: Bruto[]; extras: string[] } {
  const segs: Bruto[] = [];
  const extras: string[] = [];
  let toks: Tok[] = [];
  let ini = 0;
  let cur = '';
  let curE = '';
  let palavra = false;
  let aspas = '';
  const n = src.length;
  const pendentes: Heredoc[] = [];
  const semTerminador = new Set<string>();
  let linhaIni = 0;
  // Parênteses abertos: substituição (`$(`, `<(`, `>(`) ou subshell. Crase alterna.
  const pilha: boolean[] = [];
  let crase = false;

  const fimPalavra = () => {
    if (palavra) toks.push({ t: cur, e: curE });
    cur = '';
    curE = '';
    palavra = false;
  };
  const fimSegmento = (fim: number, proximo: number) => {
    fimPalavra();
    const cru = src.slice(ini, fim).trim();
    if (toks.length) segs.push({ cru, toks, pipe: false, subst: crase || pilha.includes(true) });
    toks = [];
    ini = proximo;
  };
  const literal = (c: string) => {
    cur += c;
    curE += c === '$' ? NEUTRO : c;
  };

  for (let i = 0; i < n; i++) {
    const c = src[i];
    if (aspas === "'") {
      if (c === "'") aspas = '';
      else literal(c);
      continue;
    }
    if (aspas === '"') {
      if (c === '"') aspas = '';
      else if (c === '\\' && i + 1 < n && '"\\$`'.includes(src[i + 1])) {
        cur += src[i + 1];
        curE += src[i + 1] === '$' ? NEUTRO : src[i + 1];
        i++;
      } else if ((c === '$' && src[i + 1] === '(') || c === '`') {
        const abre = c === '`' ? '`' : '$(';
        const comeco = i + abre.length;
        const fim = fimDeSubstituicao(src, comeco, c === '`' ? '`' : '(');
        const dentro = src.slice(comeco, fim);
        if (dentro.trim() === 'pwd') {
          cur += '$PWD';
          curE += '$PWD';
        } else {
          extras.push(dentro);
          cur += SUBST;
          curE += SUBST;
        }
        i = fim;
      } else {
        cur += c;
        curE += c;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      aspas = c;
      palavra = true;
      continue;
    }
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i++;
        continue;
      }
      if (i + 1 < n) {
        literal(src[i + 1]);
        palavra = true;
        i++;
      }
      continue;
    }
    if (c === '#' && !palavra) {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      fimSegmento(i, j);
      i = j - 1;
      continue;
    }
    if (c === '\n' && pendentes.length) {
      fimSegmento(i, i + 1);
      // O corpo só é dado se todo comando da linha o lê como dado; senão segue lexado como comando.
      const dado = segs.slice(linhaIni).every((b) => montar(b, 3).every((m) => m.cmd === '' || LE_COMO_DADO.has(m.cmd)));
      let fim = i;
      for (const h of pendentes) {
        if (semTerminador.has(h.delim)) continue;
        const r = corpoDeHeredoc(src, fim + 1, h);
        if (!r) {
          semTerminador.add(h.delim);
          continue;
        }
        if (dado) {
          if (!h.citado) for (const e of expansoesDoCorpo(r.corpo)) extras.push(e);
          fim = r.fim;
        }
      }
      pendentes.length = 0;
      i = fim;
      linhaIni = segs.length;
      continue;
    }
    if (c === '\n' || c === ';' || c === '(' || c === ')' || c === '`') {
      if (c === '(') pilha.push(src[i - 1] === '$' || src[i - 1] === '<' || src[i - 1] === '>');
      fimSegmento(i, i + 1);
      if (c === ')') pilha.pop();
      if (c === '`') crase = !crase;
      if (c === '\n') linhaIni = segs.length;
      continue;
    }
    if (c === '&') {
      if (src[i + 1] === '&') {
        fimSegmento(i, i + 2);
        i++;
      } else fimSegmento(i, i + 1);
      continue;
    }
    if (c === '|') {
      if (src[i + 1] === '|') {
        fimSegmento(i, i + 2);
        i++;
      } else {
        // `|` e `|&`: a saída do segmento anterior (ou do grupo que acabou de fechar) entra no próximo.
        fimSegmento(i, i + (src[i + 1] === '&' ? 2 : 1));
        if (segs.length) segs[segs.length - 1].pipe = true;
        if (src[i + 1] === '&') i++;
      }
      continue;
    }
    if (c === '>' || c === '<') {
      if (palavra && /^\d+$/.test(cur)) {
        cur = '';
        curE = '';
        palavra = false;
      } else fimPalavra();
      let j = i;
      while (src[j + 1] === c) j++;
      if (c === '>' && src[j + 1] === '&') {
        // `2>&1`: duplicação de descritor, não é arquivo.
        j++;
        while (j + 1 < n && /[\d-]/.test(src[j + 1])) j++;
        i = j;
        continue;
      }
      if (c === '>' && src[j + 1] === '|') j++;
      toks.push({ t: '', e: '', op: c });
      if (c === '<' && j - i === 1) {
        const d = lerDelimitador(src, j + 1);
        if (d && pendentes.length < MAX_HEREDOCS) {
          pendentes.push(d.h);
          toks.push({ t: '', e: '' });
          j = d.fim - 1;
        }
      }
      i = j;
      continue;
    }
    if (c === ' ' || c === '\t') {
      fimPalavra();
      continue;
    }
    cur += c;
    curE += c;
    palavra = true;
  }
  fimSegmento(n, n);
  return { segs, extras };
}

const SUDO_VALOR = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U']);
const ENV_VALOR = new Set(['-u', '-C', '-S', '--unset', '--chdir']);
const RUNNER_VALOR = new Set(['-p', '--package']);
const SEM_VALOR = new Set<string>();
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
// Palavras de controle e `!`/`{`: o comando de verdade é o que vem depois.
const CONTROLE = new Set(['then', 'do', 'else', 'elif', 'while', 'until', 'if', '!', '{', '}', 'fi', 'done']);

function base(cmd: string): string {
  return cmd.slice(cmd.lastIndexOf('/') + 1);
}

function montar(b: Bruto, profundidade: number): Segmento[] {
  const w: string[] = [];
  const x: string[] = [];
  const saidas: string[] = [];
  const entradas: string[] = [];
  for (let i = 0; i < b.toks.length; i++) {
    const k = b.toks[i];
    if (k.op) {
      const alvo = b.toks[i + 1];
      if (alvo && alvo.op === undefined) {
        (k.op === '>' ? saidas : entradas).push(alvo.t);
        i++;
      }
      continue;
    }
    w.push(k.t);
    x.push(k.e);
  }

  // Índice em vez de `splice`: linear mesmo com milhares de tokens.
  let p = 0;
  const atribs: string[] = [];
  const atrib = (t: string) => /^[A-Za-z_]\w*=/.test(t);
  const pularFlags = (comValor: Set<string>) => {
    while (p < w.length && (w[p].startsWith('-') || atrib(w[p]))) {
      const f = w[p++];
      if (f === '--') break;
      if (comValor.has(f) && p < w.length) p++;
    }
  };
  let runner = false;
  for (let guarda = 0; guarda < 16 && p < w.length; guarda++) {
    if (atrib(w[p])) {
      atribs.push(w[p++]);
      continue;
    }
    const cabeca = base(w[p]);
    if (CONTROLE.has(cabeca)) p++;
    else if (cabeca === 'sudo') {
      p++;
      pularFlags(SUDO_VALOR);
    } else if (cabeca === 'env') {
      p++;
      pularFlags(ENV_VALOR);
    } else if (cabeca === 'command' || cabeca === 'time' || cabeca === 'nohup') {
      p++;
      pularFlags(SEM_VALOR);
    } else if (cabeca === 'npx' || cabeca === 'bunx') {
      p++;
      pularFlags(RUNNER_VALOR);
      runner = true;
    } else if ((cabeca === 'pnpm' || cabeca === 'yarn') && w[p + 1] === 'dlx') {
      p += 2;
      pularFlags(RUNNER_VALOR);
      runner = true;
    } else if ((cabeca === 'npm' || cabeca === 'pnpm') && w[p + 1] === 'exec') {
      p += 2;
      pularFlags(RUNNER_VALOR);
      runner = true;
    } else break;
  }
  if (p >= w.length) return atribs.length || saidas.length || entradas.length ? [{ cru: b.cru, cmd: '', args: [], exp: [], atribs, saidas, entradas, pipe: b.pipe, subst: b.subst }] : [];

  let primeiro = w[p];
  if (runner) {
    // `vercel@latest` ⇒ `vercel`; pacote com escopo (`@x/y`) mantém o `@` inicial.
    const at = primeiro.indexOf('@', 1);
    if (at > 0) primeiro = primeiro.slice(0, at);
  }
  const cmd = base(primeiro);
  const args = w.slice(p + 1);
  const exp = x.slice(p + 1);

  if (SHELLS.has(cmd) && profundidade < 3) {
    const k = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (k >= 0 && typeof args[k + 1] === 'string') return segmentar(args[k + 1], profundidade + 1);
  }
  return [{ cru: b.cru, cmd, args, exp, atribs, saidas, entradas, pipe: b.pipe, subst: b.subst }];
}

export function segmentar(comando: string, profundidade = 0): Segmento[] {
  const src = profundidade === 0 && comando.length > TETO_COMANDO ? comando.slice(0, TETO_COMANDO) : comando;
  const { segs, extras } = lexar(src);
  const out: Segmento[] = [];
  for (const b of segs) for (const s of montar(b, profundidade)) out.push(s);
  // `extras` vêm de `$(…)`/crase dentro de aspas duplas: são substituição.
  if (profundidade < 3) for (const e of extras) for (const s of segmentar(e, profundidade + 1)) out.push({ ...s, subst: true });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Caminhos

function resolver(caminho: string, contexto: Contexto, cwd?: string | null): { norm: string; rel: string | null } {
  let p = caminho.trim();
  p = p.replace(/\$\{?CLAUDE_PLUGIN_ROOT\}?/g, contexto.pluginRoot ?? '$CLAUDE_PLUGIN_ROOT');
  const base = cwd && cwd.startsWith('/') ? cwd : contexto.raiz && contexto.raiz.startsWith('/') ? contexto.raiz : null;
  if (base) p = p.replace(/\$\{?PWD\}?/g, base);
  p = p.replace(/^\$\{?HOME\}?/, '~');
  if (!p.startsWith('/') && !p.startsWith('~') && !p.startsWith('$') && base) p = posix.resolve(base, p);
  let norm = posix.normalize(p).replace(/^\.\//, '');
  if (norm.length > 1) norm = norm.replace(/\/+$/, '');
  const raiz = contexto.raiz ? contexto.raiz.replace(/\/+$/, '') : null;
  let rel: string | null = null;
  if (norm.startsWith('/')) {
    if (raiz && norm === raiz) rel = '';
    else if (raiz && norm.startsWith(`${raiz}/`)) rel = norm.slice(raiz.length + 1);
  } else if (!norm.startsWith('~') && !norm.startsWith('..') && !norm.startsWith('$')) rel = norm === '.' ? '' : norm;
  return { norm, rel };
}

const AREAS_DIR = ['.harness', 'tools/gabarito-gates', '.github/workflows', '.git/refs/remotes'];
const ANCESTRAIS = ['tools', '.github', '.claude', '.git', '.git/refs'];

export function anelDeCaminho(caminho: string, contexto: Contexto, cwd?: string | null): Anel | null {
  if (caminho.trim() === '') return null;
  const { norm, rel } = resolver(caminho, contexto, cwd);
  const segs = norm.split('/').filter((s) => s !== '' && s !== '.');
  const nome = segs.length ? segs[segs.length - 1] : '';
  const minusculo = nome.toLowerCase();

  // Segredo (leitura e escrita): `.env*` literal, só `.env.example` é exceção; sem distinção de caixa.
  if (minusculo.startsWith('.env') && minusculo !== '.env.example') return 'segredo';
  if (/^[^.][\s\S]*\.(pem|key)$/i.test(nome)) return 'segredo';
  if (segs.includes('.aws')) return 'segredo';
  for (let i = 0; i + 1 < segs.length; i++) if (segs[i] === '.config' && segs[i + 1] === 'gh') return 'segredo';

  // Integridade (só escrita; quem chama decide).
  if (contexto.pluginRoot) {
    const pr = contexto.pluginRoot.replace(/\/+$/, '');
    if (norm === pr || norm.startsWith(`${pr}/`)) return 'integridade';
  }
  if (rel === null) return null;
  // Sem distinção de caixa: o APFS padrão do macOS não distingue.
  const r = rel.toLowerCase();
  if (r === 'harness.config.json') return 'integridade';
  if (r === '.git' || r.startsWith('.git/')) return 'integridade';
  for (const d of AREAS_DIR) if (r === d || r.startsWith(`${d}/`)) return 'integridade';
  if (/^\.claude\/settings[^/]*\.json$/.test(r)) return 'integridade';
  return null;
}

/** Remoção de um diretório que contém uma área de integridade (`rm -rf .github`). */
export function ancestralDeIntegridade(caminho: string, contexto: Contexto, cwd?: string | null): boolean {
  if (caminho.trim() === '') return false;
  const { norm, rel } = resolver(caminho, contexto, cwd);
  if (contexto.pluginRoot) {
    const pr = contexto.pluginRoot.replace(/\/+$/, '');
    if (pr.startsWith(`${norm}/`)) return true;
  }
  if (rel === null) return false;
  return rel === '' || ANCESTRAIS.includes(rel);
}

// ---------------------------------------------------------------------------------------------------------------
// Git (Q14): lista permitida por capacidade

const GIT_GLOBAIS_COM_VALOR = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
const GIT_PERMITIDOS = new Set([
  '', 'add', 'commit', 'status', 'diff', 'log', 'show', 'checkout', 'switch', 'restore', 'branch', 'rev-parse',
  'merge-base', 'check-ignore', 'stash', 'rebase', 'cherry-pick', 'reset', 'blame', 'grep', 'ls-files', 'mv', 'rm',
]);
// Q16: o orquestrador só é interrompido por estes; todo outro `git` segue o prompt nativo.
const GIT_PEDE_ORQUESTRADOR = new Set(['remote', 'fetch', 'pull', 'update-ref', 'symbolic-ref', 'config']);
const PUSH_COM_VALOR = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

export type GitLido = { sub: string; resto: string[]; configs: string[] };

/** Separa as opções globais do git (`-C x`, `-c k=v`, `--git-dir=…`) do subcomando. */
export function lerGit(args: string[]): GitLido {
  const configs: string[] = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '--config-env') {
      if (args[i + 1] !== undefined) configs.push(args[i + 1]);
      i++;
    } else if (a.startsWith('--config-env=')) configs.push(a.slice(13));
    else if (GIT_GLOBAIS_COM_VALOR.has(a)) i++;
    else if (a.startsWith('-')) continue;
    else break;
  }
  return { sub: args[i] ?? '', resto: args.slice(i + 1), configs };
}

/** Posicionais de um `git push`: [remoto, ...refspecs]. */
export function posicionaisDePush(resto: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (PUSH_COM_VALOR.has(a)) i++;
    else if (!a.startsWith('-')) out.push(a);
  }
  return out;
}

export function destinoDeRefspec(r: string): string {
  const sem = r.startsWith('+') ? r.slice(1) : r;
  const i = sem.lastIndexOf(':');
  return i >= 0 ? sem.slice(i + 1) : sem;
}

function pushPermitido(resto: string[]): boolean {
  if (resto.some((a) => a === '--repo' || a.startsWith('--repo=') || a === '--receive-pack' || a.startsWith('--receive-pack=') || a === '--exec' || a.startsWith('--exec='))) return false;
  const pos = posicionaisDePush(resto);
  if (pos.length > 0 && pos[0] !== 'origin') return false;
  for (let i = 1; i < pos.length; i++) if (destinoDeRefspec(pos[i]).startsWith('refs/remotes/')) return false;
  return true;
}

/** Q16: destino `refs/remotes/*` forja a fonte local; vale para qualquer papel. */
function pushSemRefsRemotes(resto: string[]): boolean {
  const pos = posicionaisDePush(resto);
  for (let i = 1; i < pos.length; i++) if (destinoDeRefspec(pos[i]).startsWith('refs/remotes/')) return false;
  return true;
}

/** `.git` ou `.git/**` (inclui o arquivo `.git` de worktree), sem distinção de caixa. */
function dentroDeDotGit(caminho: string, contexto: Contexto, cwd?: string | null): boolean {
  if (caminho.trim() === '') return false;
  const rel = resolver(caminho, contexto, cwd).rel?.toLowerCase();
  return rel !== undefined && rel !== null && (rel === '.git' || rel.startsWith('.git/'));
}

// ---------------------------------------------------------------------------------------------------------------
// Bash

const LIMITE_CD = 4096;
const REMOVE = new Set(['rm', 'rmdir', 'unlink', 'shred']);
const ESCREVE_TUDO = new Set(['rm', 'rmdir', 'chmod', 'chown', 'chgrp', 'ln', 'truncate', 'touch', 'install', 'unlink', 'shred', 'mv', 'tee']);
const SO_REDIRECIONA = new Set(['echo', 'printf']);
// Q15: checar existência não é leitura.
const EXISTENCIA = new Set(['ls', 'test', '[', '[[', 'stat']);
// Valores de `find` que são padrão de nome, não caminho.
// `find` com ação sobre o resultado (`-exec`, `-delete`...) volta a tratar o padrão como possível caminho de segredo.
const FIND_ACAO = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete']);
const FIND_PADRAO = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-lname', '-ilname']);
const GREP = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'jq']);
const BANCOS = new Set(['psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'mysql', 'mysqldump', 'mariadb', 'mariadb-dump', 'mongosh', 'mongo', 'redis-cli']);

export type AchadoAnel = { anel: Anel; alvo: string; escrita: boolean };

/** Remove o valor de opções que carregam texto (mensagem, SQL), nunca caminho. */
function semTextoLivre(cmd: string, args: string[]): string[] {
  // `mysql`/`mariadb` carregam o SQL em `-e/--execute`; os demais clientes, em `-c/--command`.
  const execute = cmd === 'mysql' || cmd === 'mariadb';
  const curtas = cmd === 'git' ? ['-m'] : execute ? ['-e'] : BANCOS.has(cmd) ? ['-c'] : [];
  const longas = cmd === 'git' ? ['--message'] : execute ? ['--execute'] : BANCOS.has(cmd) ? ['--command'] : [];
  if (curtas.length === 0) return args;
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (curtas.includes(a) || longas.includes(a)) i++;
    else if (longas.some((l) => a.startsWith(`${l}=`)) || (cmd === 'git' && a.length > 2 && a.startsWith('-m') && !a.startsWith('--'))) continue;
    else out.push(a);
  }
  return out;
}

function semPadroesDeFind(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (FIND_PADRAO.has(args[i])) i++;
    else out.push(args[i]);
  }
  return out;
}

/** Candidatos a caminho nos argumentos: o próprio token, `--opt=valor`, `k=@arq`, `@arq`. */
function candidatos(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a === '') continue;
    if (a.startsWith('-')) {
      const i = a.indexOf('=');
      if (i > 0) out.push(a.slice(i + 1).replace(/^@/, ''));
      continue;
    }
    const m = /^[^=@]+=@(.+)$/.exec(a);
    out.push(m ? m[1] : a.startsWith('@') ? a.slice(1) : a);
  }
  return out;
}

function ehCaminhoPlausivel(t: string): boolean {
  return t !== '' && !/\s/.test(t) && !t.includes('://') && t.length <= 4096;
}

function valorT(args: string[]): { dir: string | null; resto: string[] } {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target-directory') return { dir: args[i + 1] ?? null, resto: args.slice(0, i).concat(args.slice(i + 2)) };
    if (a.startsWith('--target-directory=')) return { dir: a.slice(19), resto: args.slice(0, i).concat(args.slice(i + 1)) };
  }
  return { dir: null, resto: args };
}

function empilhar(dest: string[], origem: string[]): void {
  for (let i = 0; i < origem.length; i++) dest.push(origem[i]);
}

/** Segue a cadeia de `|` a partir de `idx`: `true` se algum consumidor não é filtro de texto. */
function saidaConsumida(segmentos: Segmento[], idx: number): boolean {
  for (let j = idx; j + 1 < segmentos.length && segmentos[j].pipe; j++) {
    const c = segmentos[j + 1];
    // `sort --files0-from=-`, `wc --files-from=-`: o filtro passa a abrir os caminhos listados.
    if (!LE_COMO_DADO.has(c.cmd) || c.args.some((a) => a.startsWith('--files0-from') || a.startsWith('--files-from'))) return true;
  }
  return false;
}

/**
 * Procura o anel em todos os segmentos. Segredo vence integridade; dentro do mesmo anel vale o primeiro achado.
 * Retorna `null` se nenhum segmento toca um caminho de anel. `cwd` é o diretório da chamada; `cd` muda o corrente.
 */
export function anelDeBash(segmentos: Segmento[], contexto: Contexto, cwd?: string | null, subagent = true, estado?: { cdPerdido: boolean }): AchadoAnel | null {
  let integridade: AchadoAnel | null = null;
  let atual: string | null = cwd ?? null;
  // `cd a;` em cadeia faz o caminho crescer e cada `resolve` custar o tamanho dele: acima do limite, para de seguir o `cd`.
  let cdPerdido = false;

  for (let idx = 0; idx < segmentos.length; idx++) {
    const s = segmentos[idx];
    const escritas: string[] = [...s.saidas];
    const leituras: string[] = [...s.entradas];
    const remocoes: string[] = [];

    if (s.cmd === 'cd') {
      const d = s.args.find((a) => !a.startsWith('-'));
      if (!cdPerdido && d !== undefined && !d.includes('$') && !d.startsWith('~')) {
        const base = atual ?? contexto.raiz;
        atual = base && base.startsWith('/') ? posix.resolve(base, d) : null;
        if (atual !== null && atual.length > LIMITE_CD) {
          atual = null;
          cdPerdido = true;
          if (estado) estado.cdPerdido = true;
        }
      }
      continue;
    }

    // `find` com padrão é listagem (Q15) só quando ninguém age sobre o resultado: sem `-exec`/`-delete`, fora de
    // substituição e com a cadeia de `|` terminando em filtro de texto (ou em nada). `xargs`, laço, `sh`… consomem.
    const listagem = s.cmd === 'find' && !s.args.some((a) => FIND_ACAO.has(a)) && !s.subst && !saidaConsumida(segmentos, idx);
    const uteis = listagem ? semPadroesDeFind(s.args) : semTextoLivre(s.cmd, s.args);
    const pos = candidatos(uteis).filter(ehCaminhoPlausivel);

    if (s.cmd === 'git') {
      const g = lerGit(s.args);
      const gitResto = candidatos(semTextoLivre('git', g.resto)).filter(ehCaminhoPlausivel);
      if (g.configs.some((c) => /^(remote\.|url\.|core\.hookspath)/i.test(c))) integridade ??= { anel: 'integridade', alvo: '.git/config', escrita: true };
      if (!subagent && gitResto.some((p) => dentroDeDotGit(p, contexto, atual))) integridade ??= { anel: 'integridade', alvo: '.git', escrita: true };
      if (g.sub === 'push') {
        if (!(subagent ? pushPermitido(g.resto) : pushSemRefsRemotes(g.resto))) integridade ??= { anel: 'integridade', alvo: 'refs/remotes', escrita: true };
      } else if (subagent ? !GIT_PERMITIDOS.has(g.sub) : GIT_PEDE_ORQUESTRADOR.has(g.sub)) {
        const alvo = g.sub === 'remote' || g.sub === 'config' ? '.git/config' : g.sub === 'fetch' || g.sub === 'pull' || g.sub === 'update-ref' || g.sub === 'symbolic-ref' ? 'refs/remotes' : '.git';
        integridade ??= { anel: 'integridade', alvo, escrita: true };
      }
      // Q15: `git log -- .env` só confere existência; com patch (`-p`, `-u`, `-c`, `--cc`, `-L`, `-U`) mostra o conteúdo.
      const mostraConteudo = g.sub === 'log' && g.resto.some((a) => /^(-p|-u|-c|--cc|--patch\S*|--unified\S*|-L\S*|-U\d*|--word-diff\S*|--color-words\S*)$/.test(a));
      if ((g.sub !== 'log' && g.sub !== 'check-ignore') || mostraConteudo) empilhar(leituras, gitResto);
    } else if (EXISTENCIA.has(s.cmd)) {
      // Q15: sem leitura.
    } else if (s.cmd === 'cp' || s.cmd === 'mv') {
      const t = valorT(uteis);
      const fontes = t.resto.filter((a) => !a.startsWith('-')).filter(ehCaminhoPlausivel);
      if (t.dir !== null) {
        escritas.push(t.dir);
        if (s.cmd === 'cp') empilhar(leituras, fontes);
        else empilhar(escritas, fontes);
        if (s.cmd === 'mv') empilhar(remocoes, fontes);
      } else if (fontes.length) {
        escritas.push(fontes[fontes.length - 1]);
        const srcs = fontes.slice(0, -1);
        if (s.cmd === 'cp') empilhar(leituras, srcs);
        else {
          empilhar(escritas, srcs);
          empilhar(remocoes, srcs);
        }
      }
    } else if (s.cmd === 'sed') {
      if (s.args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) empilhar(escritas, pos);
      else empilhar(leituras, pos);
    } else if (s.cmd === 'dd') {
      for (const a of s.args) {
        if (a.startsWith('of=')) escritas.push(a.slice(3));
        else if (a.startsWith('if=')) leituras.push(a.slice(3));
      }
    } else if (ESCREVE_TUDO.has(s.cmd)) {
      empilhar(escritas, pos);
      if (REMOVE.has(s.cmd)) empilhar(remocoes, pos);
    } else if (GREP.has(s.cmd)) {
      // O primeiro argumento que não é opção é o padrão, salvo `-e`/`--regexp`.
      const temE = s.args.some((a) => a === '-e' || a === '--regexp' || a.startsWith('--regexp='));
      empilhar(leituras, temE ? pos : pos.slice(1));
    } else if (!SO_REDIRECIONA.has(s.cmd)) {
      empilhar(leituras, pos);
    }

    for (const p of escritas) {
      const r = anelDeCaminho(p, contexto, atual);
      if (r === 'segredo') return { anel: 'segredo', alvo: p, escrita: true };
      if (r === 'integridade') integridade ??= { anel: 'integridade', alvo: p, escrita: true };
    }
    for (const p of remocoes) if (ancestralDeIntegridade(p, contexto, atual)) integridade ??= { anel: 'integridade', alvo: p, escrita: true };
    for (const p of leituras) if (anelDeCaminho(p, contexto, atual) === 'segredo') return { anel: 'segredo', alvo: p, escrita: false };
  }
  return integridade;
}

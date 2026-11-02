/**
 * Anéis fixos da guarda (REQ-GRD-5) e o leitor de Bash que os alimenta. Puro: sem I/O, sem `process.env`.
 *
 * - Segredo bloqueia leitura e escrita. Integridade bloqueia só escrita (Q2).
 * - O leitor de Bash é deliberadamente pequeno (E1:56): segmenta por `&&`, `||`, `;`, `|`, `&`, quebra de
 *   linha, parênteses e crases, respeita aspas, corta comentário e descarta os prefixos transparentes (Q10).
 *   Sem heredoc, sem backreference. Falsos negativos conhecidos: `X=rm; $X`, `base64 | sh`, `eval`.
 */

import { posix } from 'node:path';
                                           

                                             

                        
                                                                                                                 
              
                                                                                           
              
                                                         
                 
                                                                                                         
                
                                                   
                   
                             
                   
                      
                     
  

                                                    
                                          

const NEUTRO = '\u0000';

function lexar(src        )          {
  const segs          = [];
  let toks        = [];
  let ini = 0;
  let cur = '';
  let curE = '';
  let palavra = false;
  let aspas = '';
  const n = src.length;

  const fimPalavra = () => {
    if (palavra) toks.push({ t: cur, e: curE });
    cur = '';
    curE = '';
    palavra = false;
  };
  const fimSegmento = (fim        , proximo        ) => {
    fimPalavra();
    const cru = src.slice(ini, fim).trim();
    if (toks.length) segs.push({ cru, toks });
    toks = [];
    ini = proximo;
  };
  const literal = (c        ) => {
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
    if (c === '\n' || c === ';' || c === '(' || c === ')' || c === '`') {
      fimSegmento(i, i + 1);
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
      if (src[i + 1] === '|' || src[i + 1] === '&') {
        fimSegmento(i, i + 2);
        i++;
      } else fimSegmento(i, i + 1);
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
  return segs;
}

const SUDO_COM_VALOR = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

function base(cmd        )         {
  return cmd.slice(cmd.lastIndexOf('/') + 1);
}

function montar(b       , profundidade        )             {
  const w           = [];
  const x           = [];
  const saidas           = [];
  const entradas           = [];
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

  const atribs           = [];
  const pular = (n        ) => {
    w.splice(0, n);
    x.splice(0, n);
  };
  const pularFlags = (comValor         ) => {
    while (w.length && (w[0].startsWith('-') || /^[A-Za-z_]\w*=/.test(w[0]))) {
      const f = w[0];
      pular(1);
      if (comValor && SUDO_COM_VALOR.has(f) && w.length) pular(1);
    }
  };
  for (let guarda = 0; guarda < 8 && w.length; guarda++) {
    if (/^[A-Za-z_]\w*=/.test(w[0])) {
      atribs.push(w[0]);
      pular(1);
      continue;
    }
    const cabeca = base(w[0]);
    if (cabeca === 'sudo') {
      pular(1);
      pularFlags(true);
    } else if (cabeca === 'env' || cabeca === 'command' || cabeca === 'time' || cabeca === 'nohup') {
      pular(1);
      pularFlags(false);
    } else if (cabeca === 'npx' || cabeca === 'bunx') {
      pular(1);
      pularFlags(false);
    } else if ((cabeca === 'pnpm' || cabeca === 'yarn') && w[1] === 'dlx') {
      pular(2);
      pularFlags(false);
    } else if ((cabeca === 'npm' || cabeca === 'pnpm') && w[1] === 'exec') {
      pular(2);
      pularFlags(false);
      if (w[0] === '--') pular(1);
    } else break;
  }
  if (!w.length) return atribs.length || saidas.length || entradas.length ? [{ cru: b.cru, cmd: '', args: [], exp: [], atribs, saidas, entradas }] : [];

  const cmd = base(w[0]);
  const args = w.slice(1);
  const exp = x.slice(1);

  if (SHELLS.has(cmd) && profundidade < 3) {
    const k = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (k >= 0 && typeof args[k + 1] === 'string') return segmentar(args[k + 1], profundidade + 1);
  }
  return [{ cru: b.cru, cmd, args, exp, atribs, saidas, entradas }];
}

export function segmentar(comando        , profundidade = 0)             {
  return lexar(comando).flatMap((b) => montar(b, profundidade));
}

// ---------------------------------------------------------------------------------------------------------------
// Caminhos

/** `-h`/valores de `--chave=valor`: devolve o valor de um token que parece caminho. */
function valorDeFlag(a        )         {
  if (a.startsWith('--') && a.includes('=')) return a.slice(a.indexOf('=') + 1);
  return a;
}

export function anelDeCaminho(caminho        , contexto          )              {
  const bruto = caminho.trim();
  if (bruto === '') return null;
  const norm = posix.normalize(bruto).replace(/^\.\//, '');
  const segs = norm.split('/').filter((s) => s !== '' && s !== '.');
  const nome = segs.length ? segs[segs.length - 1] : '';

  // Segredo (leitura e escrita).
  if (/^\.env(\..+)?$/.test(nome) && !/\.(example|sample|template|dist)$/.test(nome)) return 'segredo';
  if (/\.(pem|key)$/.test(nome)) return 'segredo';
  if (segs.includes('.aws')) return 'segredo';
  for (let i = 0; i + 1 < segs.length; i++) if (segs[i] === '.config' && segs[i + 1] === 'gh') return 'segredo';

  // Integridade (só escrita; quem chama decide).
  if (contexto.pluginRoot) {
    const pr = contexto.pluginRoot.replace(/\/+$/, '');
    if (norm === pr || norm.startsWith(`${pr}/`)) return 'integridade';
  }
  let rel                = norm;
  if (norm.startsWith('/')) {
    const raiz = contexto.raiz ? contexto.raiz.replace(/\/+$/, '') : null;
    rel = raiz && norm.startsWith(`${raiz}/`) ? norm.slice(raiz.length + 1) : null;
  }
  if (rel === null || rel.startsWith('../') || rel.startsWith('~')) return null;
  if (rel === 'harness.config.json') return 'integridade';
  if (rel === '.harness' || rel.startsWith('.harness/')) return 'integridade';
  if (rel.startsWith('tools/gabarito-gates/')) return 'integridade';
  if (/^\.claude\/settings[^/]*\.json$/.test(rel)) return 'integridade';
  if (rel.startsWith('.github/workflows/')) return 'integridade';
  if (rel === '.git/config' || rel === '.git/packed-refs' || rel.startsWith('.git/refs/remotes/')) return 'integridade';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Git

const GIT_GLOBAIS_COM_VALOR = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
const GIT_ADMIN_REMOTO = new Set(['remote', 'fetch', 'pull', 'update-ref', 'symbolic-ref', 'config']);

                                                                          

/** Separa as opções globais do git (`-C x`, `-c k=v`, `--git-dir=…`) do subcomando. */
export function lerGit(args          )          {
  const configs           = [];
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '--config-env') {
      if (args[i + 1] !== undefined) configs.push(args[i + 1]);
      i++;
    } else if (GIT_GLOBAIS_COM_VALOR.has(a)) i++;
    else if (a.startsWith('-')) continue;
    else break;
  }
  return { sub: args[i] ?? '', resto: args.slice(i + 1), configs };
}

// ---------------------------------------------------------------------------------------------------------------
// Bash

const ESCREVE_TUDO = new Set(['rm', 'rmdir', 'chmod', 'chown', 'chgrp', 'ln', 'truncate', 'touch', 'install', 'unlink', 'shred', 'mv', 'tee']);
const SO_REDIRECIONA = new Set(['echo', 'printf']);

                                                                        

function positionais(args          )           {
  return args.filter((a) => a !== '' && !a.startsWith('-')).concat(args.filter((a) => a.startsWith('--') && a.includes('=')).map(valorDeFlag));
}

/**
 * Procura o anel em todos os segmentos. Segredo vence integridade; dentro do mesmo anel vale o primeiro achado.
 * Retorna `null` se nenhum segmento toca um caminho de anel.
 */
export function anelDeBash(segmentos            , contexto          )                    {
  let integridade                    = null;
  const marcar = (anel             , alvo        , escrita         )                    => {
    if (anel === 'segredo') return { anel, alvo, escrita };
    if (anel === 'integridade' && escrita && integridade === null) integridade = { anel, alvo, escrita };
    return null;
  };

  for (const s of segmentos) {
    const escritas           = [...s.saidas];
    const leituras           = [...s.entradas];
    const pos = positionais(s.args);

    if (s.cmd === 'git') {
      const g = lerGit(s.args);
      if (g.configs.some((c) => /^(remote\.|url\.|core\.hookspath)/i.test(c))) {
        integridade ??= { anel: 'integridade', alvo: '.git/config', escrita: true };
      }
      if (GIT_ADMIN_REMOTO.has(g.sub)) {
        const alvo = g.sub === 'remote' || g.sub === 'config' ? '.git/config' : 'refs/remotes';
        integridade ??= { anel: 'integridade', alvo, escrita: true };
      }
      leituras.push(...positionais(g.resto));
    } else if (s.cmd === 'cp') {
      if (pos.length) escritas.push(pos[pos.length - 1]);
      leituras.push(...pos.slice(0, -1));
    } else if (s.cmd === 'sed') {
      if (s.args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) escritas.push(...pos);
      else leituras.push(...pos);
    } else if (s.cmd === 'dd') {
      for (const a of s.args) if (a.startsWith('of=')) escritas.push(a.slice(3));
      for (const a of s.args) if (a.startsWith('if=')) leituras.push(a.slice(3));
    } else if (ESCREVE_TUDO.has(s.cmd)) {
      escritas.push(...pos);
    } else if (!SO_REDIRECIONA.has(s.cmd)) {
      leituras.push(...pos);
    }

    for (const p of escritas) {
      const hit = marcar(anelDeCaminho(p, contexto), p, true);
      if (hit) return hit;
    }
    for (const p of leituras) {
      const hit = marcar(anelDeCaminho(p, contexto), p, false);
      if (hit) return hit;
    }
  }
  return integridade;
}

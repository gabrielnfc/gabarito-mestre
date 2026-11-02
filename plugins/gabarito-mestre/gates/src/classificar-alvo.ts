/**
 * Classificador puro (REQ-GRD-2): entrada do hook + config + contexto ⇒ {ambiente, acao, alvo, …}.
 * Sem I/O, sem `process.env`, sem relógio. `alvo` é sempre host, ref, caminho ou nome de variável:
 * nunca comando cru nem URL com credencial.
 *
 * Limites declarados (sem tokenizador completo): `xargs`, `timeout`, `exec`, `rsync`, `find -delete`, `perl -i`,
 * `curl -o` (escrita por flag de saída), expansão de chaves (`{.env,x}`), heredoc (o corpo vira segmentos),
 * indireção (`X=rm; $X`, `base64 | sh`, `eval`), caminho com espaço em argumento de Bash, substituição fora de
 * aspas duplas além de um nível, `cd` dentro de subshell (vale para o resto do comando), `$(pwd)` fora de aspas.
 * `git`: duas listas por papel (Q16). Subagent: fora da lista permitida de Q14 ⇒ `deny`. Orquestrador: só `remote`, `fetch`,
 * `pull`, `update-ref`, `symbolic-ref`, `config`, `-c remote.*|url.*|core.hooksPath`, `push` a `refs/remotes/*` e alvo em `.git/**`.
 *
 * Convenção de `ambiente`: `desconhecido` com `alvo` vazio = nada a declarar; `desconhecido` com `alvo`
 * preenchido = referência de produção que não dá para verificar (D3, push/merge sem base conhecida) ⇒ `mostrar`.
 */

import type { Ambiente, Classificacao, ConfigGuarda, Contexto, EntradaHook } from './tipos.ts';
import { anelDeBash, anelDeCaminho, destinoDeRefspec, lerGit, posicionaisDePush, segmentar } from './aneis.ts';
import type { Segmento } from './aneis.ts';

type Declarado = 'prod' | 'homolog' | 'teste';
const ORDEM: Declarado[] = ['prod', 'homolog', 'teste'];

type Parcial = { ambiente: Ambiente; acao: Classificacao['acao']; alvo: string; destrutivo: boolean; prodEscrita: boolean; cru: string };

const NEUTRO: Classificacao = { ambiente: 'desconhecido', acao: 'leitura', alvo: '', destrutivo: false, anel: null, segmentosProdEscrita: [] };

const REDE = new Set(['curl', 'wget', 'http', 'https', 'xh', 'ssh', 'scp', 'rsync', 'nc', 'telnet']);
const BANCO = new Set(['psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'mysql', 'mysqldump', 'mongosh', 'mongo', 'redis-cli']);
const SUSPEITO = /(^|[.-])(prod|production|prd)([.-]|$)/i;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

// ---------------------------------------------------------------------------------------------------------------
// SQL

function semLiterais(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const SQL_ESCRITA = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|copy|vacuum|reindex|comment|call|do|refresh|cluster)\b/i;

function sqlEscreve(sql: string): boolean {
  const s = semLiterais(sql).trim();
  if (s === '') return false;
  if (s.startsWith('\\')) return /^\\(copy|i|ir|!|lo_import)\b/i.test(s);
  const primeiro = /^\(*\s*([a-z]+)/i.exec(s)?.[1]?.toLowerCase() ?? '';
  if (!['select', 'explain', 'show', 'table', 'values'].includes(primeiro)) return true;
  return SQL_ESCRITA.test(s);
}

function sqlDestrutivo(sql: string): boolean {
  const s = semLiterais(sql);
  if (/\b(drop|truncate)\b/i.test(s)) return true;
  return /\bdelete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Ambiente declarado

function declarado(cfg: ConfigGuarda, campo: 'hosts' | 'bancos' | 'projetos' | 'variaveis', valor: string): Declarado | null {
  const v = valor.toLowerCase();
  for (const e of ORDEM) {
    const lista = cfg.ambientes[e]?.[campo];
    if (lista?.some((x) => x.toLowerCase() === v)) return e;
  }
  return null;
}

function ambienteDeHost(cfg: ConfigGuarda, host: string): { ambiente: Ambiente; alvo: string } | null {
  const h = host.toLowerCase();
  const e = declarado(cfg, 'hosts', h) ?? declarado(cfg, 'bancos', h);
  if (e) return { ambiente: e, alvo: h };
  if (LOOPBACK.has(h)) return { ambiente: 'teste', alvo: h };
  if (SUSPEITO.test(h)) return { ambiente: 'desconhecido', alvo: h };
  return null;
}

function hostDeUrl(token: string): string | null {
  if (!token.includes('://')) return null;
  try {
    return new URL(token).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function valorDe(args: string[], longas: string[], curtas: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (longas.includes(a) || curtas.includes(a)) return args[i + 1] ?? null;
    for (const l of longas) if (a.startsWith(`${l}=`)) return a.slice(l.length + 1);
    for (const c of curtas) if (a.startsWith(c) && a.length > c.length && !a.startsWith('--')) return a.slice(c.length);
  }
  return null;
}

function todosValores(args: string[], longas: string[], curtas: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (longas.includes(a) || curtas.includes(a)) {
      if (args[i + 1] !== undefined) out.push(args[i + 1]);
      i++;
      continue;
    }
    for (const l of longas) if (a.startsWith(`${l}=`)) out.push(a.slice(l.length + 1));
    for (const c of curtas) if (a.startsWith(c) && a.length > c.length && !a.startsWith('--')) out.push(a.slice(c.length));
  }
  return out;
}

const URL_EM_TEXTO = /[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/i;
const CONNINFO_HOST = /(?:^|\s)host(?:addr)?=([^\s'"]+)/gi;

function hostsDoSegmento(s: Segmento): string[] {
  const hosts: string[] = [];
  const rede = REDE.has(s.cmd);
  const banco = BANCO.has(s.cmd);
  if (rede || banco || s.cmd === 'supabase') {
    for (const a of s.args) {
      if (a.length > 2048) continue;
      const m = URL_EM_TEXTO.exec(a);
      const h = m ? hostDeUrl(m[0]) : null;
      if (h) hosts.push(h);
      else if (rede && /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(a)) hosts.push(a.slice(a.indexOf('@') + 1).split(/[:/]/)[0].toLowerCase());
      else if ((s.cmd === 'curl' || s.cmd === 'wget') && /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i.test(a)) hosts.push(a.split(/[:/]/)[0].toLowerCase());
      if (banco) for (const c of a.matchAll(CONNINFO_HOST)) hosts.push(c[1].toLowerCase());
    }
  }
  if (banco) {
    const h = valorDe(s.args, ['--host'], ['-h']);
    if (h) hosts.push(h.toLowerCase());
    for (const at of s.atribs) if (at.startsWith('PGHOST=')) hosts.push(at.slice(7).toLowerCase());
  }
  return hosts;
}

function variaveisDoSegmento(s: Segmento): string[] {
  const nomes: string[] = [];
  const re = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const t of [...s.exp, ...s.atribs]) for (const m of t.matchAll(re)) nomes.push(m[1]);
  return nomes;
}

// ---------------------------------------------------------------------------------------------------------------
// Bash: um segmento

const SUPABASE_ESCRITA = /^(db (push|reset|remote)|migration (up|repair|squash)|functions (deploy|delete)|secrets (set|unset)|link|unlink|branches (create|delete|update)|projects (create|delete)|config push|storage (cp|mv|rm)|seed)\b/;
const SUPABASE_LINKADO_POR_PADRAO = /^(db push|functions (deploy|delete)|secrets (set|unset)|config push|migration repair)\b/;
const VERCEL_LEITURA = new Set(['ls', 'list', 'logs', 'inspect', 'pull', 'whoami']);
const SUPABASE_COM_VALOR = new Set(['--project-ref', '--workdir', '--db-url', '--password', '--schema', '--dns-resolver', '--network-id']);

function subSemFlags(args: string[], comValor: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (comValor.has(a)) i++;
    else if (!a.startsWith('-') && a !== '') out.push(a);
  }
  return out;
}

const DOCKER_GRUPOS = new Set(['volume', 'container', 'image', 'network']);

function positionaisDe(args: string[]): string[] {
  return args.filter((a) => a !== '' && !a.startsWith('-'));
}

function rank(p: Parcial): number {
  if (p.prodEscrita) return 4;
  if (p.ambiente === 'prod') return 3;
  if (p.ambiente === 'homolog' || (p.ambiente === 'desconhecido' && p.alvo !== '')) return 2;
  if (p.destrutivo) return 1;
  return 0;
}

function nada(cru: string): Parcial {
  return { ambiente: 'desconhecido', acao: 'execucao', alvo: '', destrutivo: false, prodEscrita: false, cru };
}

function gravidade(a: Ambiente): number {
  return a === 'prod' ? 4 : a === 'homolog' ? 3 : a === 'desconhecido' ? 2 : 1;
}

function classificarSegmento(s: Segmento, cfg: ConfigGuarda | null, ctx: Contexto): Parcial {
  const p = nada(s.cru);
  const pos = positionaisDe(s.args);
  let sqls: string[] | null = null;

  // Destrutivo (REQ-GRD-6): olha o comando efetivo, nunca texto de menção.
  if (s.cmd === 'rm') {
    if (s.args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive')) p.destrutivo = true;
  } else if (s.cmd === 'docker') {
    const [a, b] = [pos[0], pos[1]];
    if (a === 'rm' || a === 'rmi' || (a === 'system' && b === 'prune') || (DOCKER_GRUPOS.has(a) && (b === 'rm' || b === 'prune'))) p.destrutivo = true;
  } else if (s.cmd === 'git') {
    const g = lerGit(s.args);
    if (g.sub === 'reset' && g.resto.includes('--hard')) p.destrutivo = true;
    else if (g.sub === 'clean' && g.resto.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force')) p.destrutivo = true;
    else if (g.sub === 'branch' && g.resto.includes('-D')) p.destrutivo = true;
    else if (g.sub === 'push' && g.resto.some((a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease') || a === '--mirror')) p.destrutivo = true;
  } else if (BANCO.has(s.cmd)) {
    const todos = todosValores(s.args, ['--command'], ['-c']);
    sqls = todos.length ? todos : null;
    if (sqls !== null && sqls.some(sqlDestrutivo)) p.destrutivo = true;
  }

  // Sem seção de ambientes: só anéis (E1:56).
  if (cfg === null) return p;

  // Alvos candidatos; o mais grave vence.
  const candidatos: Array<{ ambiente: Ambiente; alvo: string }> = [];
  for (const h of hostsDoSegmento(s)) {
    const a = ambienteDeHost(cfg, h);
    if (a) candidatos.push(a);
  }
  for (const v of variaveisDoSegmento(s)) {
    const e = declarado(cfg, 'variaveis', v);
    if (e) candidatos.push({ ambiente: e, alvo: v });
  }

  let escritaD3 = false;
  const branchesProd = cfg.ambientes.prod?.branches ?? [];

  if (s.cmd === 'vercel' || s.cmd === 'vc') {
    const sub = pos[0] ?? '';
    const alvoProd =
      s.args.some((a) => a === '--prod' || a === '--production' || a === '--target=production' || a === '--prod=true') ||
      valorDe(s.args, ['--target', '--environment'], []) === 'production' ||
      sub === 'promote' ||
      sub === 'rollback';
    if (alvoProd) {
      candidatos.push({ ambiente: 'prod', alvo: 'vercel' });
      if (!VERCEL_LEITURA.has(sub)) escritaD3 = true;
    }
  } else if (s.cmd === 'supabase') {
    const sub = subSemFlags(s.args, SUPABASE_COM_VALOR).slice(0, 2).join(' ');
    let ref: string | null = valorDe(s.args, ['--project-ref'], []);
    if (ref === null && !s.args.includes('--local') && ctx.refLinkado && (s.args.includes('--linked') || SUPABASE_LINKADO_POR_PADRAO.test(sub))) ref = ctx.refLinkado;
    if (ref !== null) {
      const e = declarado(cfg, 'projetos', ref);
      if (e) {
        candidatos.push({ ambiente: e, alvo: ref });
        if (SUPABASE_ESCRITA.test(sub)) escritaD3 = true;
      }
    }
    // `--db-url` aponta o banco sem passar por `--project-ref`/`--linked`.
    if (SUPABASE_ESCRITA.test(sub) && candidatos.length > 0) escritaD3 = true;
    if (/^db reset\b/.test(sub)) p.destrutivo = true;
  } else if (s.cmd === 'git') {
    const g = lerGit(s.args);
    if (g.sub === 'push') {
      p.acao = 'escrita';
      const atual = ctx.branchAtual;
      const refspecs = posicionaisDePush(g.resto).slice(1);
      const todasAsBranches = g.resto.includes('--mirror') || g.resto.includes('--all');
      const implicito = (): void => {
        if (atual !== null && branchesProd.includes(atual)) {
          candidatos.push({ ambiente: 'prod', alvo: atual });
          escritaD3 = true;
        } else candidatos.push({ ambiente: 'desconhecido', alvo: atual ?? 'HEAD' });
      };
      if (todasAsBranches && branchesProd.length > 0) {
        candidatos.push({ ambiente: 'prod', alvo: branchesProd[0] });
        escritaD3 = true;
      } else if (refspecs.length === 0) implicito();
      else {
        for (const r of refspecs) {
          const destino = destinoDeRefspec(r);
          if (destino === '' || /[$\u0001\u0000]/.test(destino) || destino.includes('`')) {
            // Destino que o shell resolve em tempo de execução: não dá para verificar.
            candidatos.push({ ambiente: 'desconhecido', alvo: atual ?? 'HEAD' });
            continue;
          }
          const nome = destino === 'HEAD' || destino === '@' ? atual : destino.replace(/^refs\/heads\//, '');
          if (nome === null) candidatos.push({ ambiente: 'desconhecido', alvo: 'HEAD' });
          else if (branchesProd.includes(nome)) {
            candidatos.push({ ambiente: 'prod', alvo: nome });
            escritaD3 = true;
          }
        }
      }
    }
  } else if (s.cmd === 'gh' && pos[0] === 'pr' && pos[1] === 'merge') {
    p.acao = 'escrita';
    const n = /(\d+)\s*$/.exec(pos[2] ?? '')?.[1];
    const alvo = n ? `pr#${n}` : 'pr';
    if (ctx.branchAtual !== null && branchesProd.includes(ctx.branchAtual)) {
      candidatos.push({ ambiente: 'prod', alvo });
      escritaD3 = true;
    } else candidatos.push({ ambiente: 'desconhecido', alvo });
  }

  if (sqls !== null && candidatos.length > 0 && sqls.some(sqlEscreve)) escritaD3 = true;
  if (candidatos.length === 0) return p;

  candidatos.sort((a, b) => gravidade(b.ambiente) - gravidade(a.ambiente));
  const escolhido = candidatos[0];
  p.ambiente = escolhido.ambiente;
  p.alvo = escolhido.alvo;

  if (escritaD3) p.acao = 'escrita';
  else if (p.acao !== 'escrita') {
    if (BANCO.has(s.cmd)) p.acao = sqls !== null ? 'leitura' : 'execucao';
    else if (s.cmd === 'curl' || s.cmd === 'wget') {
      const metodo = (valorDe(s.args, ['--request'], ['-X']) ?? '').toUpperCase();
      const corpo = s.args.some((a) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/.test(a));
      p.acao = (metodo === '' || metodo === 'GET' || metodo === 'HEAD') && !corpo ? 'leitura' : 'execucao';
    } else p.acao = 'execucao';
  }
  p.prodEscrita = escolhido.ambiente === 'prod' && escritaD3;
  return p;
}

// `alvo` nunca é token cru: URL perde userinfo; texto livre (SQL, mensagem) vira `comando`.
function reduzirAlvo(alvo: string): string {
  if (alvo === '') return '';
  const m = URL_EM_TEXTO.exec(alvo);
  if (m) return hostDeUrl(m[0]) ?? 'comando';
  if (/\s/.test(alvo) || alvo.length > 256) return 'comando';
  return alvo;
}

function entradaSegura(entrada: EntradaHook): { nome: string; input: Record<string, unknown> } {
  const nome = typeof entrada?.tool_name === 'string' ? entrada.tool_name : '';
  const bruto: unknown = entrada?.tool_input;
  const input = typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  return { nome, input };
}

function classificarBash(entrada: EntradaHook, cfg: ConfigGuarda | null, ctx: Contexto): Classificacao {
  const { input } = entradaSegura(entrada);
  const comando = typeof input.command === 'string' ? input.command : '';
  const segmentos = segmentar(comando);

  // Pior segmento vence; em empate, o primeiro.
  const parciais = segmentos.map((s) => classificarSegmento(s, cfg, ctx));
  let topo: Parcial = nada('');
  let melhor = -1;
  for (const x of parciais) {
    const r = rank(x);
    if (r > melhor) {
      melhor = r;
      topo = x;
    }
  }
  const base: Classificacao = {
    ambiente: topo.ambiente,
    acao: topo.acao,
    alvo: reduzirAlvo(topo.alvo),
    destrutivo: topo.destrutivo,
    anel: null,
    segmentosProdEscrita: parciais.filter((x) => x.prodEscrita).map((x) => x.cru),
  };

  // O anel vem antes do ambiente.
  const cwd = typeof entrada.cwd === 'string' ? entrada.cwd : null;
  const subagent = entrada?.agent_id !== undefined && entrada?.agent_id !== '';
  const anel = anelDeBash(segmentos, ctx, cwd, subagent);
  if (anel) return { ...base, ambiente: 'desconhecido', acao: anel.escrita ? 'escrita' : 'leitura', alvo: reduzirAlvo(anel.alvo), anel: anel.anel };
  return base;
}

// ---------------------------------------------------------------------------------------------------------------
// MCP e ferramentas de caminho

function classificarMcp(entrada: EntradaHook, cfg: ConfigGuarda | null): Classificacao {
  if (cfg === null) return NEUTRO;
  const { nome, input } = entradaSegura(entrada);
  const ambiente = ORDEM.find((e) => cfg.ambientes[e]?.mcps?.some((p) => nome.startsWith(p)));
  if (!ambiente) return NEUTRO;
  const q = input.query ?? input.sql;
  const sql = typeof q === 'string' ? q : null;
  const sufixo = nome.split('__').slice(2).join('__');
  // Leitura se o nome diz leitura OU o SQL é de leitura (`search_docs {query:"auth"}` não é escrita).
  const leitura = /^(list|get|search|read|describe|fetch)_/.test(sufixo) || (sql !== null && !sqlEscreve(sql));
  return {
    ambiente,
    acao: leitura ? 'leitura' : 'escrita',
    alvo: nome.split('__')[1] ?? nome,
    destrutivo: sql !== null && sqlDestrutivo(sql),
    anel: null,
    segmentosProdEscrita: ambiente === 'prod' && !leitura ? [nome] : [],
  };
}

const ESCREVE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const LE = new Set(['Read', 'Grep', 'Glob']);

function classificarCaminho(entrada: EntradaHook, ctx: Contexto): Classificacao {
  const { nome, input: i } = entradaSegura(entrada);
  const cwd = typeof entrada.cwd === 'string' ? entrada.cwd : null;
  const escreve = ESCREVE.has(nome);
  // `Grep` filtra por `glob`; `Glob` busca por `pattern`: ambos apontam para arquivos.
  const candidatos = [i.file_path, i.path, i.notebook_path, i.glob, nome === 'Glob' ? i.pattern : undefined].filter((v): v is string => typeof v === 'string' && v !== '');
  for (const alvo of candidatos) {
    const anel = anelDeCaminho(alvo, ctx, cwd);
    if (anel === 'segredo' || (anel === 'integridade' && escreve)) return { ...NEUTRO, acao: escreve ? 'escrita' : 'leitura', alvo, anel };
  }
  return { ...NEUTRO, acao: escreve ? 'escrita' : 'leitura' };
}

export function classificar(entrada: EntradaHook, ambientes: ConfigGuarda | null, contexto: Contexto): Classificacao {
  const { nome } = entradaSegura(entrada);
  if (nome === 'Bash') return classificarBash(entrada, ambientes, contexto);
  if (nome.startsWith('mcp__')) return classificarMcp(entrada, ambientes);
  if (ESCREVE.has(nome) || LE.has(nome)) return classificarCaminho(entrada, contexto);
  return NEUTRO;
}

export function precisaContexto(entrada: EntradaHook): boolean {
  const { nome, input } = entradaSegura(entrada);
  if (nome !== 'Bash') return false;
  const comando = typeof input.command === 'string' ? input.command : '';
  return segmentar(comando).some((s) => s.cmd === 'git' || s.cmd === 'gh' || s.cmd === 'supabase');
}

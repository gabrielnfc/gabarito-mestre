/**
 * Classificador puro (REQ-GRD-2): entrada do hook + config + contexto ⇒ {ambiente, acao, alvo, …}.
 * Sem I/O, sem `process.env`, sem relógio. `alvo` é sempre host, ref, caminho ou nome de variável:
 * nunca comando cru nem URL com credencial.
 *
 * Convenção de `ambiente`: `desconhecido` com `alvo` vazio = nada a declarar; `desconhecido` com `alvo`
 * preenchido = referência de produção que não dá para verificar (D3, push/merge sem base conhecida) ⇒ `mostrar`.
 */

                                                                                               
import { anelDeBash, anelDeCaminho, lerGit, segmentar } from './aneis.js';
                                           

                                              
const ORDEM              = ['prod', 'homolog', 'teste'];

                                                                                                                                         

const NEUTRO                = { ambiente: 'desconhecido', acao: 'leitura', alvo: '', destrutivo: false, anel: null, segmentosProdEscrita: [] };

const REDE = new Set(['curl', 'wget', 'http', 'https', 'xh', 'ssh', 'scp', 'rsync', 'nc', 'telnet']);
const BANCO = new Set(['psql', 'pg_dump', 'pg_dumpall', 'pg_restore', 'mysql', 'mysqldump', 'mongosh', 'mongo', 'redis-cli']);
const SUSPEITO = /(^|[.-])(prod|production|prd)([.-]|$)/i;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

// ---------------------------------------------------------------------------------------------------------------
// SQL

function semLiterais(sql        )         {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const SQL_ESCRITA = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|copy|vacuum|reindex|comment|call|do|refresh|cluster)\b/i;

function sqlEscreve(sql        )          {
  const s = semLiterais(sql).trim();
  if (s === '' || s.startsWith('\\')) return false;
  const primeiro = /^\(*\s*([a-z]+)/i.exec(s)?.[1]?.toLowerCase() ?? '';
  if (!['select', 'explain', 'show', 'table', 'values'].includes(primeiro)) return true;
  return SQL_ESCRITA.test(s);
}

function sqlDestrutivo(sql        )          {
  const s = semLiterais(sql);
  if (/\b(drop|truncate)\b/i.test(s)) return true;
  return /\bdelete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Ambiente declarado

function declarado(cfg              , campo                                               , valor        )                   {
  const v = valor.toLowerCase();
  for (const e of ORDEM) {
    const lista = cfg.ambientes[e]?.[campo];
    if (lista?.some((x) => x.toLowerCase() === v)) return e;
  }
  return null;
}

function ambienteDeHost(cfg              , host        )                                              {
  const h = host.toLowerCase();
  const e = declarado(cfg, 'hosts', h) ?? declarado(cfg, 'bancos', h);
  if (e) return { ambiente: e, alvo: h };
  if (LOOPBACK.has(h)) return { ambiente: 'teste', alvo: h };
  if (SUSPEITO.test(h)) return { ambiente: 'desconhecido', alvo: h };
  return null;
}

function hostDeUrl(token        )                {
  if (!token.includes('://')) return null;
  try {
    return new URL(token).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function valorDe(args          , longas          , curtas          )                {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (longas.includes(a) || curtas.includes(a)) return args[i + 1] ?? null;
    for (const l of longas) if (a.startsWith(`${l}=`)) return a.slice(l.length + 1);
    for (const c of curtas) if (a.startsWith(c) && a.length > c.length && !a.startsWith('--')) return a.slice(c.length);
  }
  return null;
}

function hostsDoSegmento(s          )           {
  const hosts           = [];
  if (REDE.has(s.cmd) || BANCO.has(s.cmd)) {
    for (const a of s.args) {
      const h = hostDeUrl(a);
      if (h) hosts.push(h);
      else if (REDE.has(s.cmd) && /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(a)) hosts.push(a.slice(a.indexOf('@') + 1).split(/[:/]/)[0].toLowerCase());
      else if ((s.cmd === 'curl' || s.cmd === 'wget') && /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i.test(a)) hosts.push(a.split(/[:/]/)[0].toLowerCase());
    }
  }
  if (BANCO.has(s.cmd)) {
    const h = valorDe(s.args, ['--host'], ['-h']);
    if (h) hosts.push(h.toLowerCase());
    for (const at of s.atribs) if (at.startsWith('PGHOST=')) hosts.push(at.slice(7).toLowerCase());
  }
  return hosts;
}

function variaveisDoSegmento(s          )           {
  const nomes           = [];
  const re = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const t of [...s.exp, ...s.atribs]) for (const m of t.matchAll(re)) nomes.push(m[1]);
  return nomes;
}

// ---------------------------------------------------------------------------------------------------------------
// Bash: um segmento

const SUPABASE_ESCRITA = /^(db (push|reset|remote)|migration (up|repair|squash)|functions (deploy|delete)|secrets (set|unset)|link|unlink|branches (create|delete|update)|projects (create|delete)|config push|storage (cp|mv|rm)|seed)\b/;
const SUPABASE_LINKADO_POR_PADRAO = /^(db push|functions (deploy|delete)|secrets (set|unset)|config push|migration repair)\b/;
const VERCEL_LEITURA = new Set(['ls', 'list', 'logs', 'inspect', 'pull', 'whoami']);
const DOCKER_GRUPOS = new Set(['volume', 'container', 'image', 'network']);

function positionaisDe(args          )           {
  return args.filter((a) => a !== '' && !a.startsWith('-'));
}

function rank(p         )         {
  if (p.prodEscrita) return 4;
  if (p.ambiente === 'prod') return 3;
  if (p.ambiente === 'homolog' || (p.ambiente === 'desconhecido' && p.alvo !== '')) return 2;
  if (p.destrutivo) return 1;
  return 0;
}

function nada(cru        )          {
  return { ambiente: 'desconhecido', acao: 'execucao', alvo: '', destrutivo: false, prodEscrita: false, cru };
}

function gravidade(a          )         {
  return a === 'prod' ? 4 : a === 'homolog' ? 3 : a === 'desconhecido' ? 2 : 1;
}

function classificarSegmento(s          , cfg                     , ctx          )          {
  const p = nada(s.cru);
  const pos = positionaisDe(s.args);
  let sql                = null;

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
    sql = valorDe(s.args, ['--command'], ['-c']);
    if (sql !== null && sqlDestrutivo(sql)) p.destrutivo = true;
  }

  // Sem seção de ambientes: só anéis (E1:56).
  if (cfg === null) return p;

  // Alvos candidatos; o mais grave vence.
  const candidatos                                              = [];
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
    const sub = pos.slice(0, 2).join(' ');
    let ref                = valorDe(s.args, ['--project-ref'], []);
    if (ref === null && !s.args.includes('--local') && ctx.refLinkado && (s.args.includes('--linked') || SUPABASE_LINKADO_POR_PADRAO.test(sub))) ref = ctx.refLinkado;
    if (ref !== null) {
      const e = declarado(cfg, 'projetos', ref);
      if (e) {
        candidatos.push({ ambiente: e, alvo: ref });
        if (SUPABASE_ESCRITA.test(sub)) escritaD3 = true;
      }
    }
    if (/^db reset\b/.test(sub)) p.destrutivo = true;
  } else if (s.cmd === 'git') {
    const g = lerGit(s.args);
    if (g.sub === 'push') {
      p.acao = 'escrita';
      const posPush = g.resto.filter((a, i) => !a.startsWith('-') && !(i > 0 && ['-o', '--push-option', '--repo', '--receive-pack', '--exec'].includes(g.resto[i - 1])));
      const refspecs = posPush.slice(1);
      if (refspecs.length === 0) {
        const atual = ctx.branchAtual;
        if (atual !== null && branchesProd.includes(atual)) {
          candidatos.push({ ambiente: 'prod', alvo: atual });
          escritaD3 = true;
        } else candidatos.push({ ambiente: 'desconhecido', alvo: atual ?? 'HEAD' });
      } else {
        for (const r of refspecs) {
          const destino = (r.startsWith('+') ? r.slice(1) : r).split(':').pop() ?? '';
          const nome = (destino === 'HEAD' ? ctx.branchAtual : destino.replace(/^refs\/heads\//, '')) ?? 'HEAD';
          if (branchesProd.includes(nome)) {
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

  if (sql !== null && candidatos.length > 0 && sqlEscreve(sql)) escritaD3 = true;
  if (candidatos.length === 0) return p;

  candidatos.sort((a, b) => gravidade(b.ambiente) - gravidade(a.ambiente));
  const escolhido = candidatos[0];
  p.ambiente = escolhido.ambiente;
  p.alvo = escolhido.alvo;

  if (escritaD3) p.acao = 'escrita';
  else if (p.acao !== 'escrita') {
    if (BANCO.has(s.cmd)) p.acao = sql !== null ? 'leitura' : 'execucao';
    else if (s.cmd === 'curl' || s.cmd === 'wget') {
      const metodo = (valorDe(s.args, ['--request'], ['-X']) ?? '').toUpperCase();
      const corpo = s.args.some((a) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/.test(a));
      p.acao = (metodo === '' || metodo === 'GET' || metodo === 'HEAD') && !corpo ? 'leitura' : 'execucao';
    } else p.acao = 'execucao';
  }
  p.prodEscrita = escolhido.ambiente === 'prod' && escritaD3;
  return p;
}

function classificarBash(entrada             , cfg                     , ctx          )                {
  const comando = typeof entrada.tool_input.command === 'string' ? entrada.tool_input.command : '';
  const segmentos = segmentar(comando);

  // Pior segmento vence; em empate, o primeiro.
  const parciais = segmentos.map((s) => classificarSegmento(s, cfg, ctx));
  let topo          = nada('');
  let melhor = -1;
  for (const x of parciais) {
    const r = rank(x);
    if (r > melhor) {
      melhor = r;
      topo = x;
    }
  }
  const base                = {
    ambiente: topo.ambiente,
    acao: topo.acao,
    alvo: topo.alvo,
    destrutivo: topo.destrutivo,
    anel: null,
    segmentosProdEscrita: parciais.filter((x) => x.prodEscrita).map((x) => x.cru),
  };

  // O anel vem antes do ambiente.
  const anel = anelDeBash(segmentos, ctx);
  if (anel) return { ...base, ambiente: 'desconhecido', acao: anel.escrita ? 'escrita' : 'leitura', alvo: anel.alvo, anel: anel.anel };
  return base;
}

// ---------------------------------------------------------------------------------------------------------------
// MCP e ferramentas de caminho

function classificarMcp(entrada             , cfg                     )                {
  if (cfg === null) return NEUTRO;
  const nome = entrada.tool_name;
  const ambiente = ORDEM.find((e) => cfg.ambientes[e]?.mcps?.some((p) => nome.startsWith(p)));
  if (!ambiente) return NEUTRO;
  const q = entrada.tool_input.query ?? entrada.tool_input.sql;
  const sql = typeof q === 'string' ? q : null;
  const sufixo = nome.split('__').slice(2).join('__');
  const leitura = sql !== null ? !sqlEscreve(sql) : /^(list|get|search|read|describe|fetch)_/.test(sufixo);
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

function classificarCaminho(entrada             , ctx          )                {
  const i = entrada.tool_input;
  const alvo = [i.file_path, i.path, i.notebook_path].find((v) => typeof v === 'string' && v !== '')                      ;
  if (alvo === undefined) return NEUTRO;
  const escreve = ESCREVE.has(entrada.tool_name);
  const anel = anelDeCaminho(alvo, ctx);
  if (anel === 'segredo' || (anel === 'integridade' && escreve)) return { ...NEUTRO, acao: escreve ? 'escrita' : 'leitura', alvo, anel };
  return { ...NEUTRO, acao: escreve ? 'escrita' : 'leitura' };
}

export function classificar(entrada             , ambientes                     , contexto          )                {
  const nome = entrada.tool_name;
  if (nome === 'Bash') return classificarBash(entrada, ambientes, contexto);
  if (nome.startsWith('mcp__')) return classificarMcp(entrada, ambientes);
  if (ESCREVE.has(nome) || LE.has(nome)) return classificarCaminho(entrada, contexto);
  return NEUTRO;
}

export function precisaContexto(entrada             )          {
  if (entrada.tool_name !== 'Bash') return false;
  const comando = typeof entrada.tool_input.command === 'string' ? entrada.tool_input.command : '';
  return segmentar(comando).some((s) => s.cmd === 'git' || s.cmd === 'gh' || s.cmd === 'supabase');
}

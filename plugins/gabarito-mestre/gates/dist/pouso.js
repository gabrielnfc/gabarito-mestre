import { estadoDe, ordenar } from './loop.js';
                                         

/**
 * Núcleo do pouso (REQ-POU-1, GM-10 T9). Puro e sem `node:`: o mod o importa dentro do ambiente dele, que não tem Node.
 * A única E/S descrita aqui é o texto da ponte (`codigoPonte`), que o mod entrega a `node` por `$.process.run`.
 */

export const X_PADRAO = 50;
/** F3 ≈ 1,5k tokens (S12: ~2,16 caracteres por token). Acima disso o pouso não acontece: nunca se trunca calado. */
export const INSTANTANEO_MAX = 3200;
/** Nome real em `agents/gabarito-revisor.md` e o mesmo com o namespace do plugin; comparação por igualdade, nunca por prefixo. */
export const REVISORES                    = ['gabarito-revisor', 'gabarito-mestre:gabarito-revisor'];

                                                                                                                 
                                                 
                                                                                           
                            
                                                              
                        
                         
            
                                                                           
                    
                                                                
                    
                      
                                                                                           
                     
                
                                                                                                          
                         
  
                                                                                           

                                                                                                                   
const percentValido = (a              )                                          => typeof a.percent === 'number' && Number.isFinite(a.percent);

/**
 * Tabela de estados do pouso (Sombra T9), a primeira linha que casa decide. Dado ausente ou fora do tipo nunca vira pouso:
 * `percent` indefinido é OCIOSO; `vivos` ruim é TRAVADO; `novaFronteira` que não é `true` é ENCALHADO.
 * Só a última linha tem a ação `pousar`.
 */
const TABELA                   = [
  { estado: 'OCIOSO', casa: (a) => a.orquestrador !== true, despacho: 'permitir', acao: 'nada' },
  { estado: 'OCIOSO', casa: (a) => !percentValido(a), despacho: 'permitir', acao: 'nada' },
  { estado: 'OCIOSO', casa: (a) => (a.percent          ) < a.x, despacho: 'permitir', acao: 'nada' },
  { estado: 'POUSANDO', casa: (a) => a.pousando !== false, despacho: 'negar', acao: 'nada' },
  { estado: 'SEM_POUSO', casa: (a) => a.desistiu !== false, despacho: 'negar', acao: 'nada' },
  { estado: 'SEM_POUSO', casa: (a) => a.interativo !== true, despacho: 'negar', acao: 'parar_nao_interativo' },
  { estado: 'POUSADO', casa: (a) => a.consumida === true, despacho: 'permitir', acao: 'nada' },
  { estado: 'TRAVADO', casa: (a) => !(Number.isInteger(a.vivos) && a.vivos === 0), despacho: 'negar', acao: 'esperar' },
  { estado: 'ENCALHADO', casa: (a) => a.novaFronteira !== true, despacho: 'negar', acao: 'encalhe' },
  { estado: 'POUSAVEL', casa: () => true, despacho: 'negar', acao: 'pousar' },
];

export function decidirEstado(a              )             {
  const r = TABELA.find((t) => t.casa(a))         ;
  return { estado: r.estado, despacho: r.despacho, acao: r.acao };
}

const X_RE = /^\d+(\.\d+)?$/;

/** `GABARITO_POUSO_X`: número decimal em (0, 100]; ausente ⇒ 50; presente e inválido ⇒ 50 com aviso. */
export function lerX(bruto                    )                                      {
  if (bruto === undefined) return { x: X_PADRAO, aviso: null };
  const t = typeof bruto === 'string' ? bruto.trim() : '';
  const n = X_RE.test(t) ? Number(t) : Number.NaN;
  if (Number.isFinite(n) && n > 0 && n <= 100) return { x: n, aviso: null };
  return { x: X_PADRAO, aviso: `GABARITO_POUSO_X inválido (${JSON.stringify(String(bruto).slice(0, 20))}): usando ${X_PADRAO}` };
}

/** Só estes não contam. `pending|running|waiting` contam, e qualquer outro valor também (dado desconhecido não vira zero). */
const ENCERRADO                      = new Set(['idle', 'completed', 'failed', 'killed']);

/** `$.agent.list` sem `pending|running|waiting`. Lista ausente, corrompida ou com status desconhecido conta como vivo. */
export function vivosDe(lista         )         {
  if (!Array.isArray(lista)) return 1;
  let n = 0;
  for (const a of lista) {
    const s = a !== null && typeof a === 'object' ? (a                        ).status : undefined;
    if (typeof s === 'string' && ENCERRADO.has(s)) continue;
    n += 1;
  }
  return n;
}

const TIPOS_DE_TASK                    = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'];

                                                                                            

const sem = (motivo               )                   => ({ nova: false, consumida: false, motivo });

/**
 * Fronteira (visão §6.7) lida da ordem da T2 (`ordenar` + `estadoDe`):
 * - `nova`: a última transição de task é `review.veredito`, a sequência dessa task vale para a T2 e esse veredito
 *   é POSTERIOR ao último `sessao.pouso` (um pouso consome a fronteira);
 * - `consumida`: existe `sessao.pouso` posterior ao último `review.veredito`.
 * Diário ilegível, fora de ordem, ou com evento de task sem `dados.task` ⇒ nada é fronteira e `motivo` diz por quê.
 */
export function analisarFronteira(eventos         )                   {
  if (!Array.isArray(eventos)) return sem('diário ilegível');
  if (eventos.length === 0) return sem(null);
  let ord                            ;
  try {
    ord = ordenar(eventos            );
  } catch {
    return sem('diário ilegível');
  }
  if (!ord.ok) return sem('diário fora de ordem');
  const task = (e        )          => (e.dados !== null && typeof e.dados === 'object' ? e.dados.task : undefined);
  const deTask = ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo));
  if (deTask.some((e) => typeof task(e) !== 'string')) return sem('evento de task sem task');
  const ultimoDe = (tipo        )         => ord.eventos.reduce((m, e, i) => (e.tipo === tipo ? i : m), -1);
  const pouso = ultimoDe('sessao.pouso');
  const consumida = pouso >= 0 && pouso > ultimoDe('review.veredito');
  const ultimo = deTask[deTask.length - 1];
  if (ultimo === undefined || ultimo.tipo !== 'review.veredito') return { nova: false, consumida, motivo: null };
  const dela = deTask.filter((e) => task(e) === task(ultimo));
  const valida = !('invalido' in estadoDe(dela));
  return { nova: valida && ord.eventos.lastIndexOf(ultimo) > pouso, consumida, motivo: null };
}

/** Eventos que não são trabalho do loop: o próprio mod os grava a cada turno ou ao parar. */
const SEM_PROGRESSO                    = ['custo.medicao', 'loop.parar'];

/** Quantos eventos de progresso o diário tem; muda quando algo novo acontece. Não-lista ⇒ -1 (constante: conta como encalhe). */
export function marcaDeProgresso(eventos         )         {
  if (!Array.isArray(eventos)) return -1;
  return eventos.filter((e) => !SEM_PROGRESSO.includes((e                 )?.tipo          )).length;
}

/** Só a fronteira nova importa a quem decide pouso. */
export function fronteira(eventos         )          {
  return analisarFronteira(eventos).nova;
}

export function ehRevisor(subagentType         )          {
  return typeof subagentType === 'string' && REVISORES.includes(subagentType);
}

const CONTAGENS = [
  ['input_tokens', 'input_tokens'],
  ['output_tokens', 'output_tokens'],
  ['cache_read_input_tokens', 'cache_read'],
  ['cache_creation_input_tokens', 'cache_creation'],
]         ;

/** `turn.complete.usage` ⇒ `dados` de `custo.medicao`: só as quatro contagens, como T10. Qualquer uma ausente ou inválida ⇒ `null` (nada inventado). */
export function dadosMedicao(usage         )                                {
  if (usage === null || typeof usage !== 'object') return null;
  const u = usage                           ;
  const dados                         = {};
  for (const [de, para] of CONTAGENS) {
    const v = u[de];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    dados[para] = v;
  }
  return dados;
}

const CABECALHO = 'Pouso automático: o contexto foi limpo. Retome o loop do plano pelo diário; estado abaixo.';

/** Prompt de retomada = cabeçalho curto + instantâneo inteiro. Vazio ou acima do teto ⇒ `null`: o pouso não acontece. */
export function textoRetomada(instantaneo        )                {
  if (typeof instantaneo !== 'string' || instantaneo.trim() === '') return null;
  if (instantaneo.length > INSTANTANEO_MAX) return null;
  return `${CABECALHO}\n\n${instantaneo}`;
}

/**
 * Programa que o mod passa a `node --input-type=module -e` (o ambiente do mod não tem `node:`). Lê UM objeto JSON no stdin
 * (`{op, …}`), escreve UM JSON no stdout e sempre sai 0. Dados nunca entram no programa: só o caminho do `diario.js`.
 * Ops: `dir` (raiz, pasta da entrega, `plano.json`), `ler` (estrita: `lerEstrito`), `instantaneo`, `append` (`unicoPorAgente` não repete o par tipo+agente).
 */
export function codigoPonte(diarioUrl        )         {
  return [
    `import * as d from ${JSON.stringify(diarioUrl)};`,
    `import { readFileSync, existsSync } from 'node:fs';`,
    `import { execFileSync } from 'node:child_process';`,
    `import { join } from 'node:path';`,
    `const out = (o) => process.stdout.write(JSON.stringify(o));`,
    `const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();`,
    `try {`,
    `  const e = JSON.parse(readFileSync(0, 'utf8'));`,
    `  if (e.op === 'dir') {`,
    `    const raiz = git(['rev-parse', '--show-toplevel'], e.cwd);`,
    `    let pbi = null;`,
    `    try { pbi = /[A-Z]+-\\d+/.exec(git(['symbolic-ref', '--short', 'HEAD'], raiz))?.[0] ?? null; } catch {}`,
    `    const dir = d.dirEntrega(raiz, pbi);`,
    `    out({ ok: true, raiz, dir, plano: existsSync(join(dir, 'plano.json')) });`,
    `  } else if (e.op === 'ler') {`,
    `    const l = d.lerEstrito(e.dir);`,
    `    out(l.ok ? { ok: true, eventos: l.eventos } : { ok: false, erro: l.motivo });`,
    `  } else if (e.op === 'instantaneo') {`,
    `    out({ ok: true, texto: d.projetar(d.ler(e.dir)).instantaneo });`,
    `  } else if (e.op === 'append') {`,
    `    if (e.unicoPorAgente === true && d.ler(e.dir).some((x) => x?.tipo === e.ev.tipo && x.agente === e.ev.agente)) {`,
    `      out({ ok: true, gravado: 'ja_existia' });`,
    `    } else {`,
    `      let autor = 'desconhecido';`,
    `      try { autor = git(['config', 'user.email'], e.cwd) || autor; } catch {}`,
    `      const r = d.append(e.dir, e.sessao, { ts: new Date().toISOString(), autor, sessao: e.sessao, ...e.ev });`,
    `      out(r.ok && r.gravado !== 'evento' ? { ok: false, erro: 'diário recusou o evento' } : r);`,
    `    }`,
    `  } else {`,
    `    out({ ok: false, erro: 'op desconhecida' });`,
    `  }`,
    `} catch (x) {`,
    `  out({ ok: false, erro: String(x?.message ?? x).slice(0, 200) });`,
    `}`,
  ].join('\n');
}

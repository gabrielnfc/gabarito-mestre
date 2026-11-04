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

/** Pré-condições do mod (Sombra T9b, linhas A a E). A decisão de despachar, esperar, pousar ou parar é do núcleo (`proximaAcao`). */
                                                                         
                                                            
                                                                   
                            
                                                              
                        
                         
            
                                                                           
                    
                                                                
                    
                      
  
                                                                                           

                                                                                                                   
const percentValido = (a              )                                          => typeof a.percent === 'number' && Number.isFinite(a.percent);

/**
 * Pré-condições do mod, a primeira linha que casa decide. Dado ausente ou fora do tipo nunca vira pouso: `percent`
 * indefinido é OCIOSO. Só a última linha passa a palavra ao núcleo; nenhuma linha daqui pousa, espera ou despacha.
 */
const TABELA                   = [
  { estado: 'OCIOSO', casa: (a) => a.orquestrador !== true, despacho: 'permitir', acao: 'nada' },
  { estado: 'OCIOSO', casa: (a) => !percentValido(a), despacho: 'permitir', acao: 'nada' },
  { estado: 'OCIOSO', casa: (a) => (a.percent          ) < a.x, despacho: 'permitir', acao: 'nada' },
  { estado: 'POUSANDO', casa: (a) => a.pousando !== false, despacho: 'negar', acao: 'nada' },
  { estado: 'SEM_POUSO', casa: (a) => a.desistiu !== false, despacho: 'negar', acao: 'nada' },
  { estado: 'SEM_POUSO', casa: (a) => a.interativo !== true, despacho: 'negar', acao: 'parar_nao_interativo' },
  { estado: 'NUCLEO', casa: () => true, despacho: 'nucleo', acao: 'nucleo' },
];

export function portaDoPouso(a              )             {
  const r = TABELA.find((t) => t.casa(a))         ;
  return { estado: r.estado, despacho: r.despacho, acao: r.acao };
}

/**
 * `Agent` negado para quem não é revisor ⇔ a cláusula (5) de `proximaAcao` dispararia (E8). Com `percent` ≥ X toda resposta
 * do núcleo, menos `integrar` e `concluir`, vem da (5) ou de uma cláusula que vence a (5) (pausa, teto de tokens, CI, diário).
 * Fronteira consumida: o mod passou `percent: null` ao núcleo e a (5) não dispara. Exceção: `diario_invalido` sempre nega.
 */
export function negaDespacho(acao          , consumida         )          {
  if (acao.tipo === 'parar' && acao.motivo === 'diario_invalido') return true; // diário fora da tabela nunca libera, nem sem fronteira
  return consumida !== true && acao.tipo !== 'integrar' && acao.tipo !== 'concluir';
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

                                                                             

const sem = (motivo               )                   => ({ consumida: false, motivo });

/**
 * Fronteira consumida (E1/E7, visão §6.7): não há fronteira aberta. Duas formas: não existe nenhum `review.veredito` no diário
 * (REQ-POU-1 define fronteira como veredito; sem ele não há o que pousar, aceite 1), ou existe `sessao.pouso` posterior ao último
 * `review.veredito` na ordem da T2. Consumida ⇒ o mod passa `percent: null` ao núcleo. Quem decide o resto é o núcleo, nunca esta função.
 * Diário ilegível, fora de ordem, ou com evento de task sem `dados.task` ⇒ `motivo` diz por quê e nada é consumido.
 */
export function analisarFronteira(eventos         )                   {
  if (!Array.isArray(eventos)) return sem('diário ilegível');
  if (eventos.length === 0) return { consumida: true, motivo: null };
  let ord                            ;
  try {
    ord = ordenar(eventos            );
  } catch {
    return sem('diário ilegível');
  }
  if (!ord.ok) return sem('diário fora de ordem');
  const task = (e        )          => (e.dados !== null && typeof e.dados === 'object' ? e.dados.task : undefined);
  if (ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo)).some((e) => typeof task(e) !== 'string')) return sem('evento de task sem task');
  const ultimoDe = (tipo        )         => ord.eventos.reduce((m, e, i) => (e.tipo === tipo ? i : m), -1);
  const veredito = ultimoDe('review.veredito');
  if (veredito < 0) return { consumida: true, motivo: null };
  return { consumida: ultimoDe('sessao.pouso') > veredito, motivo: null };
}

const EM_VOO                        = ['implementando', 'corrigindo', 'em_revisao'];

/**
 * Tasks que `/gabarito retomar` reabre (origem `retomada`): as que o diário deixa em voo, `implementando`, `corrigindo` ou
 * `em_revisao`. Quem chama garante vivos 0; com agente vivo nada é reaberto. Plano ou diário ilegível, evento fora do plano ou
 * transição inválida ⇒ `ok: false` com o motivo: nunca uma lista vazia que pareça "nada a reabrir".
 */
export function tasksEmVoo(plano         , eventos         )                                                                {
  const tasks = plano !== null && typeof plano === 'object' ? (plano         ).tasks : undefined;
  if (!Array.isArray(tasks) || tasks.some((t) => t === null || typeof t !== 'object' || typeof t.id !== 'string')) return { ok: false, motivo: 'plano ilegível' };
  if (!Array.isArray(eventos)) return { ok: false, motivo: 'diário ilegível' };
  let ord                            ;
  try {
    ord = ordenar(eventos            );
  } catch {
    return { ok: false, motivo: 'diário ilegível' };
  }
  if (!ord.ok) return { ok: false, motivo: 'diário fora de ordem' };
  const porTask = new Map                  (tasks.map((t) => [t.id, []]));
  for (const e of ord.eventos) {
    if (!TIPOS_DE_TASK.includes(e.tipo)) continue;
    const t = e.dados !== null && typeof e.dados === 'object' ? e.dados.task : undefined;
    const fila = typeof t === 'string' ? porTask.get(t) : undefined;
    if (fila === undefined) return { ok: false, motivo: 'evento de task fora do plano' };
    fila.push(e);
  }
  const voo           = [];
  for (const [id, fila] of porTask) {
    const r = estadoDe(fila);
    if ('invalido' in r) return { ok: false, motivo: `diário fora da tabela de transições (task ${id})` };
    if (EM_VOO.includes(r.estado)) voo.push(id);
  }
  return { ok: true, tasks: voo };
}

const inteiroNaoNegativo = (n         )              => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Tasks que o mod reabre (origem `retomada`) ao fim do turno em que negou `Agent`: o `iniciar` do despacho negado ficou no
 * diário sem agente. São as `min(negados, em voo − vivos)` em voo cuja `task.iniciada` é a mais recente, da mais nova para a
 * mais antiga. Plano, diário ou contagens ilegíveis ⇒ `ok: false` com o motivo (nunca uma lista vazia que pareça "nada a reabrir").
 */
export function tasksDoNegado(plano         , eventos         , negados         , vivos         )                                                                {
  if (!inteiroNaoNegativo(negados)) return { ok: false, motivo: 'contagem de negados ilegível' };
  if (!inteiroNaoNegativo(vivos)) return { ok: false, motivo: 'contagem de vivos ilegível' };
  const voo = tasksEmVoo(plano, eventos);
  if (!voo.ok) return voo;
  const k = Math.min(negados, voo.tasks.length - vivos);
  if (k <= 0) return { ok: true, tasks: [] };
  const ord = ordenar(eventos            );
  if (!ord.ok) return { ok: false, motivo: 'diário fora de ordem' };
  const ultimo = (t        )         => ord.eventos.reduce((m, e, i) => (e.tipo === 'task.iniciada' && e.dados?.task === t ? i : m), -1);
  return { ok: true, tasks: [...voo.tasks].sort((a, b) => ultimo(b) - ultimo(a)).slice(0, k) };
}

/** Eventos que não são trabalho do loop: o próprio mod os grava a cada turno ou ao parar. */
const SEM_PROGRESSO                    = ['custo.medicao', 'loop.parar'];

/** Quantos eventos de progresso o diário tem; muda quando algo novo acontece. Não-lista ⇒ -1 (constante: conta como encalhe). */
export function marcaDeProgresso(eventos         )         {
  if (!Array.isArray(eventos)) return -1;
  return eventos.filter((e) => !SEM_PROGRESSO.includes((e                 )?.tipo          )).length;
}

/** O diário já termina em `loop.parar` sem evento de trabalho depois: gravar outro seria repetir. Ilegível ⇒ `false` (quem chama não grava). */
export function jaParou(eventos         )          {
  if (!Array.isArray(eventos)) return false;
  let ord                            ;
  try {
    ord = ordenar(eventos            );
  } catch {
    return false;
  }
  if (!ord.ok) return false;
  const i = ord.eventos.reduce((m, e, k) => (e.tipo === 'loop.parar' ? k : m), -1);
  return i >= 0 && ord.eventos.slice(i + 1).every((e) => SEM_PROGRESSO.includes(e.tipo));
}

/**
 * Tokens gastos = entrada + saída + criação de cache de todo `custo.medicao`; leitura de cache não conta (mesma conta de `loop.mjs`).
 * Contagem inválida ⇒ `ok: false`: um teto não pode ser conferido com dado ruim. Sem medição ⇒ `tokens: null`.
 */
export function tokensDe(eventos         )                                                      {
  if (!Array.isArray(eventos)) return { ok: false };
  let tokens                = null;
  for (const e of eventos                     ) {
    if (e?.tipo !== 'custo.medicao') continue;
    let soma = 0;
    for (const campo of ['input_tokens', 'output_tokens', 'cache_creation', 'cache_read']) {
      const n = (e.dados ?? {})[campo];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return { ok: false };
      if (campo !== 'cache_read') soma += n;
    }
    tokens = (tokens ?? 0) + soma;
  }
  return { ok: true, tokens };
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
 * Ops: `dir` (raiz, pasta da entrega, `plano.json`), `ler` (estrita: `lerEstrito`), `plano` (`plano.json` validado pela T1 e
 * `loop.slots`/`loop.tetoTokens` de `harness.config.json`; ilegível ou inválido ⇒ `ok: false`), `instantaneo`,
 * `append` (`unicoPorAgente` não repete o par tipo+agente).
 */
export function codigoPonte(diarioUrl        , planoUrl         = diarioUrl.replace(/diario\.js$/, 'plano.js'))         {
  return [
    `import * as d from ${JSON.stringify(diarioUrl)};`,
    `import * as pl from ${JSON.stringify(planoUrl)};`,
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
    `  } else if (e.op === 'plano') {`,
    `    const v = pl.validarPlano(JSON.parse(readFileSync(join(e.dir, 'plano.json'), 'utf8')));`,
    `    if (!v.ok) throw new Error('plano.json inválido: ' + v.erro);`,
    `    const arq = join(e.raiz, 'harness.config.json');`,
    `    const cfg = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : {};`,
    `    const lp = cfg !== null && typeof cfg.loop === 'object' && cfg.loop !== null && !Array.isArray(cfg.loop) ? cfg.loop : {};`,
    `    const inteiro = (n) => Number.isSafeInteger(n) && n >= 1;`,
    `    if (Object.hasOwn(lp, 'tetoTokens') && !inteiro(lp.tetoTokens)) throw new Error('loop.tetoTokens inválido');`,
    `    out({ ok: true, plano: v.plano, slots: inteiro(lp.slots) ? lp.slots : 1, tetoTokens: Object.hasOwn(lp, 'tetoTokens') ? lp.tetoTokens : null });`,
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

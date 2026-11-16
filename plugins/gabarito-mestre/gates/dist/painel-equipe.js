/**
 * Equipe do painel (E4, T3): pacotes de nomes, sorteio, nome por papel, uso do transcript e a projeção `equipe` do `EstadoPainel`.
 * Puro: sem `fs`, `process`, `Date.now()` nem `node:*` (o mod importa o `dist/`, que não tem Node; ver `loop.ts`). Por isso o sorteio usa FNV-1a
 * em TS e este módulo não importa `sombra.ts` (que traz `node:crypto`): as decisões vigentes da Sombra vêm de `projetarDecisoes` em
 * `diario-puro.ts` (a mesma de `sombra.ts`), e `tokensDe` vem de `pouso.ts` (puro, o mod já o carrega).
 */

import { contarConsultas, projetarDecisoes } from './diario-puro.js';
                                                      
import { formaInvalida } from './formas.js';
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.js';
                                            
import { dataCivil } from './painel-hora.js';
import { colunas, limpar } from './painel-largura.js';
import { tokensDe } from './pouso.js';
                                                                                                                                                                                             

const DESCRICAO_RE = /^(\S+) (implementador|revisor|correcao)$/;

/**
 * Liga o agente vivo à task pela `description` do `Agent` (D3), que é `"<task> <papel>"` do item de `loop.mjs proxima`.
 * Nunca por aproximação: depois de `trim`, só o padrão exato, com task do plano e papel conhecido; qualquer outra coisa é `null`
 * (o render escreve `sem task`). `description` que não é texto também é `null`, sem lançar.
 */
export function casarAgente(description        , plano       )                                        {
  if (typeof description !== 'string') return null;
  const m = DESCRICAO_RE.exec(description.trim());
  if (m === null) return null;
  const tasks = plano !== null && typeof plano === 'object' && Array.isArray(plano.tasks) ? plano.tasks : [];
  if (!tasks.some((t) => t.id === m[1])) return null;
  return { task: m[1], papel: m[2]          };
}

// ---------- casamento do vivo (GM-14 FIEL-3 a) ----------

                                                                     

/** Papel que o `type` do despacho diz (`subagent_type`, ex. `gabarito-mestre:gabarito-implementador`); sem pista ⇒ `null`. */
export function papelDoAgente(tipo         )                                                          {
  if (typeof tipo !== 'string') return null;
  if (/revisor/i.test(tipo)) return 'revisor';
  if (/implementador/i.test(tipo)) return 'implementador';
  if (/sombra/i.test(tipo)) return 'sombra';
  if (/spike/i.test(tipo)) return 'spike';
  return null;
}

/** `task` e `papel` `null` = sem task do plano (o papel do tipo só serve para exibição). `papel` é o do par (nome, cobertura); `papelExibido` é o mostrado. */
                                                                                                        

/**
 * Liga o vivo à task (FIEL-3 a). Task: o 1º token da `description` é um id do plano, ou esse id mais 1 letra minúscula (`T0a` ⇒ `T0`); vale o id
 * mais longo; `T10` nunca casa `T1`. Papel, nesta ordem: 1. o do padrão antigo `<task> <papel>`; 2. o do tipo (`papelDoAgente`); 3. tipo
 * `implementador` numa task em `corrigindo` vira `correcao`; 4. tipo sem papel do gabarito ⇒ o papel do estado da task; 5. sem task, ou sem papel
 * nenhum, o do tipo só para exibição (`spike`, `sombra`). Nunca lança; `description`/`type` que não são texto ⇒ sem task.
 */
export function casarVivo(agente         , plano       , estados                                 )            {
  const a = ehObjeto(agente) ? agente : {};
  const desc = typeof a.description === 'string' ? a.description.trim() : '';
  const tipo = papelDoAgente(a.type);
  const token = desc.split(/\s+/)[0] ?? '';
  const tasks = plano !== null && typeof plano === 'object' && Array.isArray(plano.tasks) ? plano.tasks : [];
  let task                = null;
  for (const t of tasks) {
    const id = t?.id;
    if (typeof id !== 'string' || id === '') continue;
    const casa = token === id || (token.length === id.length + 1 && token.startsWith(id) && /^[a-z]$/.test(token.slice(id.length)));
    if (casa && (task === null || id.length > task.length)) task = id;
  }
  if (task === null) return { task: null, papel: null, papelExibido: tipo };
  const antigo = DESCRICAO_RE.exec(desc);
  const estado = estados.get(task);
  const doEstado = estado === undefined ? undefined : PAPEL_DO_ESTADO[estado];
  let papel                   ;
  if (antigo !== null) papel = antigo[2]         ;
  else if (tipo === 'sombra') return { task: null, papel: null, papelExibido: 'sombra' }; // regra 2: o papel do tipo vem antes do estado; a Sombra nunca cobre a task
  else if (tipo === 'implementador') papel = estado === 'corrigindo' ? 'correcao' : 'implementador';
  else if (tipo === 'revisor') papel = 'revisor';
  else papel = doEstado;
  return { task, papel: papel ?? 'implementador', papelExibido: papel ?? tipo ?? 'implementador' };
}

/** Token técnico (a regra de REQ-LNG-1) vira "…" na `description` mostrada (FIEL-3 b). */
const TECNICO_RE = /[`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b/;

/** `description` do despacho para o render: controle vira espaço, token técnico vira "…". Vazio ou não texto ⇒ `null`. */
export function higienizarDescricao(texto         )                {
  if (typeof texto !== 'string') return null;
  const tokens = texto.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').split(/\s+/).filter((t) => t !== '');
  return tokens.length === 0 ? null : tokens.map((t) => (TECNICO_RE.test(t) ? '…' : t)).join(' ');
}

// ---------- pacote de nomes ----------

/** Caixa alta, largura 1 por construção e ≤ 10 colunas: não depende de `colunas` (T4). */
const NOME_RE = /^[A-Z0-9ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ'-]{1,10}$/u;
const NOME_MAX_COLUNAS = 20;

const ehObjeto = (v         )                               => v !== null && typeof v === 'object' && !Array.isArray(v);
const nomeOk = (v         )              => typeof v === 'string' && NOME_RE.test(v);

/**
 * Valida um pacote de nomes (REQ-PNL-6). `nomes`, `lider` e `sabio` seguem `NOME_RE`; `nomes` tem ≥ 8, sem repetidos e sem `lider`/`sabio`;
 * `lider ≠ sabio`; `nome` (rótulo exibido) é texto de 1 a 20 colunas. Devolve cópia, sem campos extras. Nunca lança.
 */
export function validarPacote(bruto         )                                                                  {
  const erro = (e        )                              => ({ ok: false, erro: e });
  if (!ehObjeto(bruto)) return erro('pacote não é objeto');
  const { nome, lider, sabio, nomes } = bruto;
  if (typeof nome !== 'string' || nome.trim() === '') return erro('`nome` ausente ou vazio');
  if (limpar(nome) !== nome) return erro('`nome` com caractere de controle');
  const cols = colunas(nome); // a mesma medida do render (`painel-largura.ts`)
  if (cols > NOME_MAX_COLUNAS) return erro(`\`nome\` com ${cols} colunas, máximo ${NOME_MAX_COLUNAS}`);
  if (!nomeOk(lider)) return erro('`lider` ausente ou fora do padrão (caixa alta, até 10 colunas)');
  if (!nomeOk(sabio)) return erro('`sabio` ausente ou fora do padrão (caixa alta, até 10 colunas)');
  if (lider === sabio) return erro('`lider` e `sabio` são o mesmo nome');
  if (!Array.isArray(nomes)) return erro('`nomes` não é lista');
  if (nomes.length < 8) return erro(`\`nomes\` com ${nomes.length} itens, mínimo 8`);
  const vistos = new Set        ();
  for (let i = 0; i < nomes.length; i++) {
    const n          = nomes[i];
    if (!nomeOk(n)) return erro(`\`nomes\`[${i}] fora do padrão (caixa alta, até 10 colunas)`);
    if (vistos.has(n)) return erro(`\`nomes\`[${i}] repetido: ${n}`);
    if (n === lider || n === sabio) return erro(`\`nomes\`[${i}] repete o líder ou o sábio: ${n}`);
    vistos.add(n);
  }
  return { ok: true, pacote: { nome, lider, sabio, nomes: [...(nomes            )] } };
}

// ---------- `nomes` do stdin de `--agentes` (GM-14 FIEL-3 d) ----------

/** Nome de vivo: `NOME_RE`, ou até 10 colunas + sufixo 2..9 (pacote esgotado), ou `agente` depois do 9 (MINOR-8). */
const NOME_VIVO_RE = /^(?:[A-Z0-9ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ'-]{1,10}[2-9]?|agente)$/u;
/** O mesmo `AGENTE_RE` de `mod/painel.mjs` (o id entra em caminho de transcript). */
const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** Teto do `painel:nomes` no `$.store` (o mod tira o mais antigo antes de passar). */
export const TETO_NOMES = 64;

/**
 * Valida `nomes` do stdin de `--agentes` (`{agent_id: {nome, vistoEm}}`, T1b; o uso no render é da T29). Ausente (`undefined`, stdin da 2.0.0
 * ou CLI) ⇒ `{}`; qualquer outra forma fora do contrato ⇒ `ok: false` com "`nomes` corrompido: …", nunca `{}` calado. Só chaves próprias;
 * entrada com campo a mais recusa; mais de `TETO_NOMES` recusa. Devolve cópia. Nunca lança.
 */
export function validarNomesAgentes(bruto         )                                                                  {
  const erro = (e        )                              => ({ ok: false, erro: `\`nomes\` corrompido: ${e}` });
  if (bruto === undefined) return { ok: true, nomes: {} };
  try {
    if (!ehObjeto(bruto)) return erro('não é objeto');
    const ids = Object.keys(bruto);
    if (ids.length > TETO_NOMES) return erro(`${ids.length} entradas, teto ${TETO_NOMES}`);
    const nomes               = {};
    for (const id of ids) {
      if (!AGENT_ID_RE.test(id)) return erro(`agent_id fora do padrão: ${JSON.stringify(id.slice(0, 40))}`);
      const v          = bruto[id];
      if (!ehObjeto(v)) return erro(`${id} não é objeto`);
      const extra = Object.keys(v).find((k) => k !== 'nome' && k !== 'vistoEm');
      if (extra !== undefined) return erro(`${id} com campo a mais: ${extra}`);
      const { nome, vistoEm } = v;
      if (typeof nome !== 'string' || !NOME_VIVO_RE.test(nome)) return erro(`${id}.nome fora do padrão`);
      if (typeof vistoEm !== 'number' || !Number.isSafeInteger(vistoEm) || vistoEm < 0) return erro(`${id}.vistoEm não é inteiro ≥ 0`);
      nomes[id] = { nome, vistoEm };
    }
    return { ok: true, nomes };
  } catch {
    return erro('leitura falhou');
  }
}

// ---------- stdin de `--agentes` além de `nomes` (GM-14 Emenda 2: `encerrados`, `acoes`, `segundoPlano`) ----------

const TETO_ENCERRADOS = 256;
const TETO_ACOES = 64;
const TETO_SEGUNDO_PLANO = 64;
const TEXTO_MAX = 400;

                                                                                                                                

/**
 * Valida o que o mod manda no stdin de `--agentes` além da lista: `nomes` (`validarNomesAgentes`), `encerrados` (ids com `SubagentStop`),
 * `acoes` (`{agent_id: {texto, fonte: 'tool'|'bash', em}}`) e `segundoPlano` (`[{id, dono, texto, desde}]`). Campo ausente (`undefined`, mod da
 * 2.0.0 ou CLI) ⇒ vazio; campo presente fora do contrato ⇒ `ok: false` ("`<campo>` corrompido: …"), nunca vazio calado. Devolve cópia. Nunca lança.
 */
export function validarStdinAgentes(bruto         )                                                                  {
  const falha = (campo        , e        )                              => ({ ok: false, erro: `\`${campo}\` corrompido: ${e}` });
  try {
    if (!ehObjeto(bruto)) return { ok: true, valor: { nomes: {}, encerrados: [], acoes: {}, segundoPlano: [] } };
    const n = validarNomesAgentes(bruto.nomes);
    if (!n.ok) return n;
    let encerrados           = [];
    if (bruto.encerrados !== undefined) {
      const e = bruto.encerrados;
      if (!Array.isArray(e)) return falha('encerrados', 'não é lista');
      if (e.length > TETO_ENCERRADOS) return falha('encerrados', `${e.length} entradas, teto ${TETO_ENCERRADOS}`);
      for (const id of e) if (typeof id !== 'string' || !AGENT_ID_RE.test(id)) return falha('encerrados', 'id fora do padrão');
      encerrados = [...(e            )];
    }
    const acoes               = {};
    if (bruto.acoes !== undefined) {
      const a = bruto.acoes;
      if (!ehObjeto(a)) return falha('acoes', 'não é objeto');
      const ids = Object.keys(a);
      if (ids.length > TETO_ACOES) return falha('acoes', `${ids.length} entradas, teto ${TETO_ACOES}`);
      for (const id of ids) {
        const v          = a[id];
        if (!AGENT_ID_RE.test(id)) return falha('acoes', 'agent_id fora do padrão');
        if (!ehObjeto(v)) return falha('acoes', `${id} não é objeto`);
        const extra = Object.keys(v).find((k) => k !== 'texto' && k !== 'fonte' && k !== 'em');
        if (extra !== undefined) return falha('acoes', `${id} com campo a mais: ${extra}`);
        const { texto, fonte, em } = v;
        if (typeof texto !== 'string' || texto.length > TEXTO_MAX) return falha('acoes', `${id}.texto não é texto curto`);
        if (fonte !== 'tool' && fonte !== 'bash') return falha('acoes', `${id}.fonte fora de tool|bash`);
        if (typeof em !== 'number' || !Number.isSafeInteger(em) || em < 0) return falha('acoes', `${id}.em não é inteiro ≥ 0`);
        acoes[id] = { texto, fonte, em };
      }
    }
    const segundoPlano                     = [];
    if (bruto.segundoPlano !== undefined) {
      const l = bruto.segundoPlano;
      if (!Array.isArray(l)) return falha('segundoPlano', 'não é lista');
      if (l.length > TETO_SEGUNDO_PLANO) return falha('segundoPlano', `${l.length} entradas, teto ${TETO_SEGUNDO_PLANO}`);
      for (const [i, v] of (l             ).entries()) {
        if (!ehObjeto(v)) return falha('segundoPlano', `[${i}] não é objeto`);
        const { id, dono, texto, desde } = v;
        if (typeof id !== 'string' || id === '' || id.length > 128) return falha('segundoPlano', `[${i}].id`);
        if (typeof dono !== 'string' || (dono !== 'orquestrador' && !AGENT_ID_RE.test(dono))) return falha('segundoPlano', `[${i}].dono`);
        if (typeof texto !== 'string' || texto.length > TEXTO_MAX) return falha('segundoPlano', `[${i}].texto`);
        if (typeof desde !== 'number' || !Number.isSafeInteger(desde) || desde < 0) return falha('segundoPlano', `[${i}].desde`);
        // GM-15 T33 (g.11): `comando` opcional (o mod o manda para o painel rotular o shell: integrando, teste, aguardando, comando)
        if (v.comando !== undefined && (typeof v.comando !== 'string' || v.comando.length > TEXTO_MAX)) return falha('segundoPlano', `[${i}].comando`);
        segundoPlano.push({ id, dono, texto, desde, ...(typeof v.comando === 'string' ? { comando: v.comando } : {}) });
      }
    }
    return { ok: true, valor: { nomes: n.nomes, encerrados, acoes, segundoPlano } };
  } catch {
    return falha('stdin', 'leitura falhou');
  }
}

/** FNV-1a de 32 bits sobre as unidades UTF-16: determinístico, sem `node:crypto`. */
function fnv1a32(texto        )         {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Sorteia o pacote de nomes da sessão: `fnv1a32(sessionId) % candidatos.length`, candidatos = únicos de `nomes` ordenados por código, sem
 * `anterior`. Só o anterior existe ⇒ ele mesmo (repetir é o único jeito). `nomes` vazio ⇒ `'terra-media'`. `sessionId` que não é texto ⇒ hash de `''`.
 */
export function sortearPacote(sessionId        , nomes          , anterior               )         {
  const unicos = [...new Set((Array.isArray(nomes) ? nomes : []).filter((n)              => typeof n === 'string'))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (unicos.length === 0) return 'terra-media';
  const candidatos = unicos.filter((n) => n !== anterior);
  const lista = candidatos.length > 0 ? candidatos : unicos;
  return lista[fnv1a32(typeof sessionId === 'string' ? sessionId : '') % lista.length];
}

// ---------- rótulo do shell de fundo (GM-15 T33, g.11) ----------

/**
 * A MESMA regra que o hook Stop (`gates/scripts/stop-loop.mjs`, `SHELL_INTEGRANDO`) usa para dizer que um shell de fundo está integrando: o núcleo puro não importa
 * o script, então o literal vive aqui e um teste compara os dois (`fonte-unica-shell-integrando`).
 */
export const SHELL_INTEGRANDO = /\b(integrar|gate-task)\b/;
const SUITE_DE_TESTE = /\b(node\s+(?:--[\w=-]+\s+)*--test|npm\s+(?:run\s+)?test|mod-test\.sh|claude\s+plugin\s+test|pytest|vitest|jest)\b|\.test\.[a-z]+/;
const LACO_DE_ESPERA = /\b(until|while)\b[\s\S]*\b(sleep|grep)\b/;
                                                                          

/**
 * Rótulo e task de um shell de fundo, pelo COMANDO e pela DESCRIÇÃO: `integrar`/`gate-task` ⇒ Integrando; suíte de teste ⇒ Teste; laço de espera ⇒ Aguardando; o resto ⇒ Comando.
 * Um laço (`until`/`while` no início do comando) que só ESPERA por uma integração é Aguardando, não Integrando. A task vem do cwd da worktree (`.harness/worktrees/<T>`),
 * de `integrar|gate-task <T>` ou da descrição; sem prova ⇒ `null` (nunca palpite). Nunca lança.
 */
export function rotuloDoShell(item                                                           )                                           {
  const cmd = typeof item?.comando === 'string' ? item.comando.slice(0, 2000) : '';
  const txt = typeof item?.texto === 'string' ? item.texto.slice(0, 2000) : '';
  const laco = /^\s*(until|while)\b/.test(cmd) && LACO_DE_ESPERA.test(cmd);
  let tipo            = 'Comando';
  if (!laco && (SHELL_INTEGRANDO.test(cmd) || SHELL_INTEGRANDO.test(txt))) tipo = 'Integrando';
  else if (SUITE_DE_TESTE.test(cmd) || SUITE_DE_TESTE.test(txt)) tipo = 'Teste';
  else if (laco || LACO_DE_ESPERA.test(cmd) || LACO_DE_ESPERA.test(txt)) tipo = 'Aguardando';
  const id = '(T\\d+[A-Za-z]?)(?![\\w-])';
  const task = new RegExp(`\\.harness/worktrees/${id}`).exec(cmd)?.[1]
    ?? new RegExp(`\\b(?:integrar|gate-task)\\s+${id}`).exec(cmd)?.[1]
    ?? new RegExp(`\\b(?:integrar|gate-task)\\s+${id}`).exec(txt)?.[1]
    ?? new RegExp(`\\b${id}`).exec(txt)?.[1]
    ?? null;
  return { tipo, task };
}

/** As tasks que um shell de fundo do orquestrador está integrando agora (`rotuloDoShell` ⇒ Integrando com task provada), sem repetir. */
export function integrandoDe(segundoPlano         )           {
  if (!Array.isArray(segundoPlano)) return [];
  const tasks           = [];
  for (const b of segundoPlano) {
    if (!ehObjeto(b)) continue;
    const r = rotuloDoShell(b);
    if (r.tipo === 'Integrando' && r.task !== null && !tasks.includes(r.task)) tasks.push(r.task);
  }
  return tasks;
}

// ---------- nome por papel ----------

const PAPEIS                    = ['implementador', 'revisor', 'correcao'];
/** Chave do par nomeado: implementador e correção dividem `<task>:trabalho`; o revisor é `<task>:revisor`. */
export const chaveDoPar = (task        , papel        )         => `${task}:${papel === 'revisor' ? 'revisor' : 'trabalho'}`;
const ordemSegura = (eventos         )                  => {
  if (!Array.isArray(eventos)) return null;
  const o = ordenar(eventos            );
  return o.ok ? o.eventos : null;
};

/**
 * Nome de cada par: `${task}:trabalho` (implementador e correção) e `${task}:revisor`. O par recebe `nomes[i % n]`, com `i` = ordem do 1º
 * `task.iniciada` do par no diário ordenado; evento novo no fim nunca troca nome antigo, e `task.reaberta` mantém o par. Diário que não ordena
 * ou pacote sem nomes ⇒ mapa vazio (todo nome fica `null`). Limite declarado: evento de outra sessão com `ts` anterior reordena (`ordenar`
 * intercala por `ts`) e pode trocar nomes.
 */
export function nomesPorPapel(eventos          , pacote             )                      {
  const mapa = new Map                ();
  const ord = ordemSegura(eventos);
  const nomes = pacote !== null && typeof pacote === 'object' && Array.isArray(pacote.nomes) ? pacote.nomes : [];
  if (ord === null || nomes.length === 0) return mapa;
  // GM-15 T33 (g.12): o nome do par é único entre os pares de tasks NÃO integradas; o 1º livre do pacote, na ordem do diário (a decisão só olha o passado,
  // então evento novo no fim nunca troca nome antigo). `task.integrada` devolve os nomes da task; sem nome livre (mais vivos que nomes) vale a volta de antes.
  const doPar = new Map                (); // par → nome
  const vivas = new Map                     (); // task → pares nomeados e ainda não integrados
  for (const e of ord) {
    if (!ehObjeto(e.dados) || typeof e.dados.task !== 'string' || e.dados.task === '') continue;
    const { task } = e.dados;
    if (e.tipo === 'task.integrada') { vivas.delete(task); continue; }
    if (e.tipo !== 'task.iniciada') continue;
    const { papel } = e.dados;
    if (typeof papel !== 'string' || !PAPEIS.includes(papel)) continue;
    const chave = chaveDoPar(task, papel);
    if (!mapa.has(chave)) {
      const ocupados = new Set        ();
      for (const pares of vivas.values()) for (const c of pares) ocupados.add(doPar.get(c)          );
      mapa.set(chave, nomes.find((n) => !ocupados.has(n)) ?? nomes[mapa.size % nomes.length]);
      doPar.set(chave, mapa.get(chave)          );
    }
    const pares = vivas.get(task) ?? new Set        ();
    pares.add(chave);
    vivas.set(task, pares);
  }
  return mapa;
}

// ---------- uso do transcript ----------

const CAMPO_VALIDO = (v         )              => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Uso de um agente a partir das linhas do transcript. Linha que não é texto, sem `"usage"`, JSON inválido (inclui a linha partida da cauda),
 * `message.model` começando com `<` (`<synthetic>`), `usage` que não é objeto ou com campo presente e que não é número finito ≥ 0: ignorada.
 * `input_tokens` é obrigatório; `output` e os dois de cache ausentes valem 0. `contexto` = `input + cache_read + cache_creation` da última linha
 * aceita; `tok` = Σ por `message.id` (maior valor por campo) de `input + output + cache_creation`, sem `cache_read` (mesma conta de `tokensDe`);
 * linha sem `message.id` entra em `contexto`, não em `tok`; `modelo` = último `message.model` aceito. Nenhuma linha aceita ⇒ `null`.
 */
export function usoDoTranscript(linhas          )                   {
  if (!Array.isArray(linhas)) return null;
  let contexto                = null;
  let modelo                = null;
  const porId = new Map                                                            ();
  for (const l of linhas) {
    if (typeof l !== 'string' || !l.includes('"usage"')) continue;
    let o         ;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    const m = ehObjeto(o) ? o.message : undefined;
    if (!ehObjeto(m)) continue;
    const modeloDaLinha = m.model;
    if (typeof modeloDaLinha === 'string' && modeloDaLinha.startsWith('<')) continue;
    const u = m.usage;
    if (!ehObjeto(u)) continue;
    const lido                         = {};
    let torto = false;
    for (const campo of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
      const v = u[campo];
      if (v === undefined) {
        if (campo === 'input_tokens') torto = true; // sem entrada não há contexto
        lido[campo] = 0;
      } else if (CAMPO_VALIDO(v)) {
        lido[campo] = v;
      } else {
        torto = true;
      }
    }
    if (torto) continue;
    contexto = lido.input_tokens + lido.cache_read_input_tokens + lido.cache_creation_input_tokens;
    if (typeof modeloDaLinha === 'string' && modeloDaLinha !== '') modelo = modeloDaLinha;
    const id = m.id;
    if (typeof id === 'string' && id !== '') {
      const a = porId.get(id) ?? { input: 0, output: 0, criacao: 0 };
      a.input = Math.max(a.input, lido.input_tokens);
      a.output = Math.max(a.output, lido.output_tokens);
      a.criacao = Math.max(a.criacao, lido.cache_creation_input_tokens);
      porId.set(id, a);
    }
  }
  if (contexto === null) return null;
  let tok = 0;
  for (const a of porId.values()) tok += a.input + a.output + a.criacao;
  return { contexto, tok, modelo };
}

// ---------- Sombra (decisões vigentes) ----------

const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

/** Mais recente por `(ts, sessao, seq)`, a ordem de `diario.ts` e do bloco da Sombra. */
function maisRecente(eventos                 )                       {
  let melhor                       = null;
  for (const e of eventos) {
    if (melhor === null) { melhor = e; continue; }
    const d = Date.parse(e.ts) - Date.parse(melhor.ts) || cmp(e.sessao, melhor.sessao) || e.seq - melhor.seq;
    if (d > 0) melhor = e;
  }
  return melhor;
}

// ---------- projeção ----------

const ENCERRADO                      = new Set(['idle', 'completed', 'failed', 'killed']);
const ORDEM_COR                     = ['claude', 'suggestion', 'autoAccept', 'ide', 'remember'];
const FAMILIA_RE = /haiku|sonnet|opus|fable/;
const PAPEIS_ORDEM                   = ['implementador', 'correcao', 'revisor'];
const PAPEL_DO_ESTADO                                     = { implementando: 'implementador', corrigindo: 'correcao', em_revisao: 'revisor' };

const familia = (modelo         )                => {
  if (typeof modelo !== 'string') return null;
  const m = FAMILIA_RE.exec(modelo);
  return m === null ? null : m[0];
};

/** Status que contam como trabalhando (FIEL-6 a). */
const STATUS_ATIVO                      = new Set(['pending', 'running', 'waiting']);
                                                                

/**
 * Ids que já pararam: `encerrados` do mod (`SubagentStop`) e `custo.medicao` de `subagent:<id>` no diário (plano B). Qualquer dos dois vence o `status`.
 */
export function idsEncerrados(eventos          , encerrados          )              {
  const ids = new Set        ();
  for (const e of Array.isArray(eventos) ? eventos : []) {
    if (ehObjeto(e) && e.tipo === 'custo.medicao' && typeof e.agente === 'string' && e.agente.startsWith('subagent:') && e.agente.length > 9) ids.add(e.agente.slice(9));
  }
  if (Array.isArray(encerrados)) for (const id of encerrados) if (typeof id === 'string' && id !== '') ids.add(id);
  return ids;
}

/**
 * Ativo (FIEL-6 a): `status` em `{pending, running, waiting}` e id fora de `fim`. `idle/completed/failed/killed` ou id em `fim` ⇒ `encerrado`;
 * qualquer outro status (ausente, não texto, desconhecido) ⇒ `desconhecido`: não é ativo (D-P13 1) e o ATENÇÃO o conta.
 */
export function estadoDoVivo(a         , fim                     )             {
  if (!ehObjeto(a)) return 'desconhecido';
  if (typeof a.id === 'string' && fim.has(a.id)) return 'encerrado';
  const s = a.status;
  if (typeof s !== 'string') return 'desconhecido';
  if (STATUS_ATIVO.has(s)) return 'ativo';
  return ENCERRADO.has(s) ? 'encerrado' : 'desconhecido';
}

const NOME_RECEBIDO_RE = /^(?:[A-Z0-9ÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ'-]{1,10}[2-9]?|agente)$/u;

/** 1º nome do pacote fora de `usados`; esgotado ⇒ nome + sufixo 2..9 (1º nome, 2º nome… com o sufixo 2; depois o 3); depois do 9 ⇒ "agente" (FIEL-3 d). */
function proximoNome(pacote             , usados                     )         {
  const base = Array.isArray(pacote?.nomes) ? pacote.nomes : [];
  for (const n of base) if (!usados.has(n)) return n;
  for (let suf = 2; suf <= 9; suf++) for (const n of base) if (!usados.has(`${n}${suf}`)) return `${n}${suf}`;
  return 'agente';
}

                                                                                           
                              
                                                       
                         
                                                                                
                        
                                                                                                                             
                      
                                             
                        
                                   
  

/**
 * A fonte única de quem está ativo, ligado a qual task e com que nome (FIEL-3 a, d; FIEL-6): o AGORA, o ATENÇÃO, o glifo do PLANO e o histórico
 * leem esta função, nunca cada um a sua. Nome: casado ⇒ o do par, se nenhum outro ativo o usa; senão (e para o sem task) o recebido do mod
 * (`nome`, estável) quando livre, senão o 1º livre do pacote, na ordem em que o mod viu o agente (`vistoEm`); o líder e o sábio nunca entram.
 */
export function resolverAtivos(plano       , eventos                 , entrada               )                 {
  const lista           = Array.isArray(eventos) ? eventos : [];
  const ord = ordemSegura(lista);
  const estados = estadosDasTasks(plano, ord);
  const vazio                 = { ativos: null, desconhecidos: 0, esperando: [], cobertos: new Set(), estados };
  if (entrada.agentes === null || entrada.agentes === undefined) return vazio;
  const fim = idsEncerrados(lista, entrada.encerrados);
  const pares = nomesPorPapel(lista, entrada.pacote);
  const brutos = Array.isArray(entrada.agentes) ? (entrada.agentes             ) : [];
  let desconhecidos = 0;
  const ativos                                                                                             = [];
  brutos.forEach((a, i) => {
    const e = estadoDoVivo(a, fim);
    if (e === 'desconhecido') { desconhecidos++; return; }
    if (e === 'encerrado') return;
    const agente = a              ;
    ativos.push({ agente, id: typeof agente.id === 'string' ? agente.id : '', casamento: casarVivo(agente, plano, estados), nome: null, i });
  });
  const usados = new Set        ([entrada.pacote?.lider, entrada.pacote?.sabio].filter((n)              => typeof n === 'string'));
  // 1º, os casados com o nome do par, se nenhum outro ativo o usa: nem já escolhido, nem recebido do mod por um não casado (FIEL-3 d: o nome recebido não muda)
  const recebidoDe = (x                        )                => (typeof x.agente.nome === 'string' && NOME_RECEBIDO_RE.test(x.agente.nome) ? x.agente.nome : null);
  for (const x of ativos) {
    const c = x.casamento;
    const par = c.task === null || c.papel === null ? undefined : pares.get(chaveDoPar(c.task, c.papel));
    if (par === undefined || usados.has(par)) continue;
    if (ativos.some((y) => y !== x && (y.casamento.task === null || y.casamento.papel === null) && recebidoDe(y) === par)) continue;
    x.nome = par; usados.add(par);
  }
  // 2º, o resto na ordem em que o mod os viu: o nome recebido, se livre; senão o 1º livre do pacote
  const resto = ativos.filter((x) => x.nome === null).sort((x, y) => {
    const vx = Number.isFinite(x.agente.vistoEm) ? (x.agente.vistoEm          ) : Infinity;
    const vy = Number.isFinite(y.agente.vistoEm) ? (y.agente.vistoEm          ) : Infinity;
    return vx === vy ? x.i - y.i : vx < vy ? -1 : 1;
  });
  for (const x of resto) {
    const rec = x.agente.nome;
    const nome = typeof rec === 'string' && NOME_RECEBIDO_RE.test(rec) && !usados.has(rec) ? rec : proximoNome(entrada.pacote, usados);
    x.nome = nome;
    if (nome !== 'agente') usados.add(nome);
  }
  const cobertos = new Set        ();
  for (const x of ativos) if (x.casamento.task !== null && x.casamento.papel !== null) cobertos.add(`${x.casamento.task}:${x.casamento.papel}`);
  const esperando           = [];
  for (const t of plano.tasks) {
    const estado = estados.get(t.id);
    const papel = estado === undefined ? undefined : PAPEL_DO_ESTADO[estado];
    if (papel !== undefined && !cobertos.has(`${t.id}:${papel}`)) esperando.push(t.id);
  }
  return { ativos: ativos.map((x) => ({ agente: x.agente, id: x.id, casamento: x.casamento, nome: x.nome           })), desconhecidos, esperando, cobertos, estados };
}

/** `tok` ausente ou corrompido é `null` (nunca 0: zero é medida, e ausente não é medida); o `contexto` válido segue valendo. */
                                                                               
const usoValido = (u         )                 =>
  ehObjeto(u) && CAMPO_VALIDO(u.contexto) ? { contexto: u.contexto, tok: CAMPO_VALIDO(u.tok) ? u.tok : null, modelo: typeof u.modelo === 'string' ? u.modelo : null } : null;

function estadosDasTasks(plano       , ord                 )                          {
  const estados = new Map                    ();
  if (ord === null) return estados;
  for (const t of plano.tasks) {
    const fila = ord.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && ehObjeto(e.dados) && e.dados.task === t.id);
    const r = estadoDe(fila);
    if (!('invalido' in r)) estados.set(t.id, r.estado);
  }
  return estados;
}

function mutacoesDeHoje(ord                 , entrada               )                                           {
  if (ord === null) return null;
  const hoje = dataCivil(entrada.agoraMs, entrada.fuso);
  let achou                                           = null;
  for (const e of ord) {
    if (e.tipo !== 'task.integrada' || formaInvalida(e.tipo, e.dados) !== null || !ehObjeto(e.dados) || !ehObjeto(e.dados.mutacoes)) continue;
    if (dataCivil(Date.parse(e.ts), entrada.fuso) !== hoje) continue;
    const { total, mortas } = e.dados.mutacoes                                     ;
    if (total === 0) continue; // o gate não mediu nada: ausente ≠ zero (Global Constraint)
    achou = { total: (achou?.total ?? 0) + total, mortas: (achou?.mortas ?? 0) + mortas };
  }
  return achou;
}

/**
 * Projeta `equipe`: líder, agentes (vivos casados, vivos sem task e `◌ sem agente`), revisores aguardando e Sombra (sempre presente).
 * `entrada.agentes === null` (CLI sem mod) ⇒ nenhuma linha de agente e nenhum `◌`; `[]` ⇒ `◌ sem agente` para toda task em voo.
 * Diário que não ordena ⇒ nomes `null`, sem estado de task e sem `◌`: quem sinaliza é o PAROU (T2).
 */
export function projetarEquipe(plano       , eventos                 , entrada               )                         {
  const todos           = Array.isArray(eventos) ? eventos : [];
  const ord = ordemSegura(todos);
  const nomes = nomesPorPapel(todos, entrada.pacote);
  const estados = estadosDasTasks(plano, ord);
  const base = ord ?? todos.filter(ehObjeto); // lixo na lista (null) não derruba a projeção

  const iniciada = (task        , papel       )                => {
    const chave = chaveDoPar(task, papel);
    let achado                = null;
    for (const e of ord ?? []) {
      if (e.tipo === 'task.iniciada' && ehObjeto(e.dados) && e.dados.task === task && typeof e.dados.papel === 'string' && PAPEIS.includes(e.dados.papel) && chaveDoPar(task, e.dados.papel) === chave) achado = e;
    }
    return achado;
  };
  const desdeS = (ini               )                => {
    if (ini === null) return null;
    const ms = Date.parse(ini.ts);
    return Number.isFinite(ms) ? Math.max(0, Math.floor((entrada.agoraMs - ms) / 1000)) : null;
  };
  const corDe = (nome               )          => {
    const i = nome === null ? -1 : entrada.pacote.nomes.indexOf(nome);
    return i < 0 ? 'inactive' : ORDEM_COR[i % ORDEM_COR.length];
  };
  // GM-15 T33 (g.16): a janela é sempre MEDIDA: a da sessão (`contexto.window`) para o modelo da sessão; para outro modelo, a que o mod mediu para ele (`janelas[modelo]`,
  // o mesmo campo `context_window` da plataforma). Sem janela medida ⇒ sem % (só os tokens). Nenhuma tabela fixa de janelas (D-P13).
  const janelaSessao = entrada.contexto?.window;
  const janelas = (entrada                                         ).janelas;
  const janelaDe = (modelo        )                => {
    const j = modelo === entrada.modeloSessao ? janelaSessao : ehObjeto(janelas) && Object.hasOwn(janelas, modelo) ? janelas[modelo] : undefined;
    return typeof j === 'number' && Number.isFinite(j) && j > 0 ? j : null;
  };
  const pctDe = (uso                )                => {
    const j = uso !== null && typeof uso.modelo === 'string' ? janelaDe(uso.modelo) : null;
    return uso !== null && j !== null ? Math.round((uso.contexto / j) * 100) : null;
  };

  // líder
  const medicoes = base.filter((e) => e.tipo === 'custo.medicao');
  const doOrquestrador = tokensDe(medicoes.filter((e) => e.agente === 'orquestrador'));
  const lider                                  = {
    nome: entrada.pacote.lider, modelo: familia(entrada.modeloSessao), ctx: entrada.contexto.percent, x: entrada.x,
    tok: doOrquestrador.ok ? doOrquestrador.tokens : null, h5: entrada.limites.h5, d7: entrada.limites.d7, narrativa: '',
  };

  // agentes: só ativos (FIEL-6); task em voo sem ativo vai a `esperando` (o ATENÇÃO), nunca a uma linha `◌`
  const agentes                 = [];
  const res = resolverAtivos(plano, eventos, entrada);
  for (const x of res.ativos ?? []) {
    const a = x.agente;
    const uso = usoValido(a.uso);
    const c = x.casamento;
    const descricao = higienizarDescricao(a.description);
    if (c.task === null || c.papel === null) {
      agentes.push({
        nome: x.nome, papel: null, task: undefined, estadoTask: null, modelo: familia(uso?.modelo), ctxPct: pctDe(uso), ctxTok: uso?.contexto ?? null,
        tok: uso?.tok ?? null, desdeS: null, cor: corDe(x.nome), vivo: true, descricao, papelExibido: c.papelExibido,
      });
      continue;
    }
    const ini = iniciada(c.task, c.papel);
    agentes.push({
      nome: x.nome, papel: c.papel, task: c.task, estadoTask: res.estados.get(c.task) ?? null,
      modelo: familia(uso?.modelo) ?? familia(ini !== null && ehObjeto(ini.dados) ? ini.dados.modelo : null),
      ctxPct: pctDe(uso), ctxTok: uso?.contexto ?? null, tok: uso?.tok ?? null, desdeS: desdeS(ini), cor: corDe(x.nome), vivo: true, descricao, papelExibido: c.papelExibido,
    });
  }

  // D-R2: ordem estável, independente da ordem em que o mod lista os agentes: (índice da task no plano, papel, vivo antes de ◌); `sem task` no fim, na ordem de entrada
  const indiceDaTask = new Map(plano.tasks.map((t, i) => [t.id, i]));
  const chaveDeOrdem = (a              )                           =>
    a.task === undefined || !indiceDaTask.has(a.task) ? [Infinity, 0, 0] : [indiceDaTask.get(a.task)          , a.papel === null ? 3 : PAPEIS_ORDEM.indexOf(a.papel), a.vivo ? 0 : 1];
  const ordenados = agentes
    .map((a, i) => ({ a, i, k: chaveDeOrdem(a) }))
    .sort((x, y) => (x.k[0] === y.k[0] ? 0 : x.k[0] < y.k[0] ? -1 : 1) || x.k[1] - y.k[1] || x.k[2] - y.k[2] || x.i - y.i)
    .map((x) => x.a);
  const vivos = res.ativos === null ? null : ordenados.length;

  // revisores aguardando (task em `concluida`); mutações de hoje somam a entrega, não a task
  const hoje = mutacoesDeHoje(ord, entrada);
  const revisoresAguardando = plano.tasks
    .filter((t) => estados.get(t.id) === 'concluida')
    .map((t) => ({ nome: nomes.get(chaveDoPar(t.id, 'revisor')) ?? null, task: t.id, mutacoesHoje: hoje?.total ?? null, mortasHoje: hoje?.mortas ?? null }));

  // Sombra
  const vigentes = [...projetarDecisoes(todos).values()];
  const ultimaDec = maisRecente(vigentes);
  const ultima = ultimaDec === null ? null : (() => {
    const d = ultimaDec;
    const fonte = Array.isArray(d.fontes) && d.fontes.length > 0 ? d.fontes[0] : d.medicao !== undefined ? 'medicao' : null;
    return { seq: d.seq, resposta: d.resposta, fonte };
  })();
  const dasSombra = medicoes.filter((e) => ehObjeto(e.dados) && e.dados.papel === 'sombra');
  const ultimaSombra = dasSombra.length > 0 ? dasSombra[dasSombra.length - 1] : null;
  const sombra = {
    nome: entrada.pacote.sabio, modelo: familia(ultimaSombra !== null && ehObjeto(ultimaSombra.dados) ? ultimaSombra.dados.modelo : null),
    decisoes: vigentes.length, ultima,
    consultasAbertas: Math.max(0, contarConsultas(todos) - vigentes.length),
  };

  return { lider, agentes: ordenados, vivos, revisoresAguardando, esperando: res.esperando, sombra };
}

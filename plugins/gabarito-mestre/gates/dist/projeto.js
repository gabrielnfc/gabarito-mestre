/**
 * Visão de projeto (GM-15 T31, REQ-ENT-2 emenda 4, decisão do dono D-G3): uma linha por PBI/entrega do projeto, acima da visão de entrega.
 * Núcleo PURO: sem `node:*` (o mod carrega o `dist/`). A borda (T32, `painel.mjs`) roda `git worktree list --porcelain`, lê de cada árvore os
 * cards de `fluxo.mapeamento.FL1`, o plano .md que o card aponta, `plano.json` e o diário de `.harness/entregas/<id>/`, e entrega `ArvoreLida[]`.
 *
 * Regras (emenda 4, itens 1 a 5):
 *  1. fontes = card (status do frontmatter), `plano.json` (ou o plano .md, `### Task N:`, quando não houver `plano.json`) e o diário, em TODAS as
 *     worktrees; falha do git ⇒ só a árvore atual + aviso (`worktreesDe`).
 *  2. PBI sem plano: "sem plano", nunca 0 %; o total diz quantos PBIs ficam fora da conta (PBI aberto só em formato anterior NÃO entra nesse total: GM-20 DT2, REQ-PCT-3/REQ-LEG-2).
 *  3. totais: % de tasks integradas, restantes e previsão pelo ritmo medido da T30 (`ritmoDasAnteriores`): `medida` (a) só com o que tem plano;
 *     `estimada` (b) soma os PBIs sem plano pela mediana de tasks dos PBIs com plano, sinalizada.
 *  4. entrega sem `plano.json`: "fase não medida" em vez de "FASE n de 7" (`rotuloFase`).
 *  5. agente sem `loop.mjs iniciar`: "agente fora do loop" em vez de "sem task" (`rotuloAgente`).
 */
import { estadoDe, TIPOS_DE_TASK } from './loop.js';
                                            
import { cmp, mediana } from './diario-puro.js';
import { ritmoDasAnteriores } from './painel.js';
import { horaLocal } from './painel-hora.js';
import { validarPlano } from './plano.js';
                                         

export const ROTULO_FASE_NAO_MEDIDA = 'fase não medida';
export const ROTULO_FORA_DO_LOOP = 'agente fora do loop';
/** GM-21 DT11 (REQ-PRV-1): amostra mínima de tasks integradas para a previsão do PROJETO; o número é do redator (P5, sem fonte do dono): trocar aqui + os testes. */
export const AMOSTRA_MINIMA_PROJETO = 5;
const ID_PADRAO = /^[A-Z]+-\d+$/;

/** O que a borda leu de UMA árvore (worktree). `planoMd` = texto do plano .md que o card aponta, lido na mesma árvore (`null` = sem arquivo). */
                          
                  
                                                                                                                                                                                                                                     
     
                                                                                                                                                  
                                                                                                                                 
     
                                                                                                                                                                       
  

                                                                                                                                                                                                                                         
/** `integradas` = medidas no diário; `estimadas` = de PBI concluído sem registro no diário (emenda 18 p.2): nunca somam às medidas e nunca somam na previsão; no % exibido somam (D-G42). */
/** `herdadas` (GM-21 DT10): tasks de antes do gabarito (`task.herdada`) FORA do plano; só existe com herdada (sem ela a forma é a de antes). Entram no `total` e no %, nunca nas medidas, na estimada nem no ritmo. */
                                                                                                                                      
                            
             
                        
                        
                                                                                                            
                 
                                                                                                                                                      
                                   
                                                                                         
                      
                              
                                                                                                                                   
                    
                           
                                                                            
                     
                                                                                      
                                 
                                                                 
                
                                                            
                        
                                                                                   
                      
                                                 
                 
  
                               
                                                                                     
                        
                                                          
                                                     
     
                                                                                                                                             
                                                                                                                     
     
                                                                                                                                
                        
  
/** Grupo de PBIs ABERTOS do mesmo Epic (REQ-PRJ-3 c). `epic: null` = "sem Epic"; `titulo` vem de `opcoes.titulosEpic`. */
                                                                                                       
                             
                         
                                                                                                                                     
                      
                                                                                                                                                                                                                                                                                                                                                                                                         
                   
  

// ---------- worktrees ----------

/** Caminhos a varrer (a atual primeiro). `git worktree list --porcelain`; `prunable` e `bare` ficam fora. Falha ou saída sem worktree ⇒ só a atual + aviso. */
export function worktreesDe(git                                                             , atual        )                                               {
  if (!git.ok) return { caminhos: [atual], aviso: `git worktree list falhou (${git.motivo}): só a árvore atual` };
  const achados           = [];
  let algum = false;
  for (const bloco of String(git.saida).split(/\n\s*\n/)) {
    const linhas = bloco.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const wt = linhas.find((l) => l.startsWith('worktree '));
    if (wt === undefined) continue;
    algum = true;
    if (linhas.some((l) => l === 'bare' || l === 'prunable' || l.startsWith('prunable '))) continue;
    achados.push(wt.slice('worktree '.length));
  }
  if (!algum) return { caminhos: [atual], aviso: 'git worktree list sem worktree na saída: só a árvore atual' };
  return { caminhos: [atual, ...achados.filter((c) => c !== atual)].filter((c, i, xs) => xs.indexOf(c) === i), aviso: null };
}

// ---------- card e plano .md ----------

/** Caminho do plano .md no card (`Plano: \`docs/plans/x.md\``); "a escrever" ou sem `.md` ⇒ `null`. */
export function planoMdDoCard(texto        )                {
  const m = /Plano:\s*`([^`]+\.md)`/.exec(String(texto));
  return m === null ? null : m[1];
}

/**
 * GM-20 REQ-LEG-1/3 (DT3): padrão de plano antigo = pasta literal relativa + nome com `{PBI}` e `*` (só no nome; `{PBI}` na pasta é inválido). `..`, absoluto, `**`, `*` na pasta, vazio ⇒ `null`.
 */
export function padraoLegadoValido(padrao         )                                       {
  if (typeof padrao !== 'string' || padrao === '' || padrao.length > 300 || padrao.includes('\0') || padrao.includes('**')) return null;
  const partes = padrao.split('/');
  const nome = partes[partes.length - 1];
  const pastas = partes.slice(0, -1);
  if (nome === '' || pastas.includes('..') || pastas.includes('') || pastas.some((p) => p.includes('*') || p.includes('{PBI}') || p === '.')) return null;
  return { dir: pastas.join('/'), nome };
}

/** Os `nomes` (arquivos da pasta do padrão) que casam `padrao` para o PBI `id`; `{PBI}` casa o id sem alfanumérico antes (XPBI-3 não casa PBI-3) e sem dígito depois (PBI-1 não casa PBI-10). Padrão inválido ⇒ `null`. */
export function planoLegadoDe(nomes          , padrao         , id        )                  {
  const v = padraoLegadoValido(padrao);
  if (v === null) return null;
  const esc = (t        )         => t.replace(/[.+?^$()|[\]\\{}]/g, '\\$&');
  const re = new RegExp(`^${v.nome.split('{PBI}').map((q) => q.split('*').map(esc).join('[^/]*')).join(`(?<![A-Za-z0-9])${esc(id)}(?!\\d)`)}$`);
  return nomes.filter((n) => re.test(n));
}

/** Card FL1: frontmatter `id` (casa `idPadrao`; senão `null`, ex. `PBI-EXEMPLO`), `status`, `atualizadoEm`; título = 1º `# `. */
export function cardDe(_arquivo        , texto        , idPadrao         = ID_PADRAO, chaveEpic                = 'epic')              {
  const linhas = String(texto).split('\n');
  if (linhas[0]?.trim() !== '---') return null;
  const fim = linhas.indexOf('---', 1);
  if (fim < 0) return null;
  const fm = new Map                ();
  for (const l of linhas.slice(1, fim)) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(l);
    if (m !== null) fm.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  const id = fm.get('id');
  if (id === undefined || !idPadrao.test(id)) return null;
  const tit = linhas.slice(fim + 1).find((l) => l.startsWith('# '));
  return { id, status: fm.get('status') || null, titulo: tit === undefined ? null : tit.slice(2).trim(), atualizadoEm: fm.get('atualizadoEm') || null, planoMd: planoMdDoCard(texto), epic: chaveEpic === null ? null : fm.get(chaveEpic) || null };
}

/**
 * Cabeçalho de task do plano .md (REQ-PRJ-1): `##`/`###` + (`Task` id [anotação] | `T`id) + separador.
 * Id `\d+[a-z]?`; anotação = 1 grupo entre parênteses (com `_`/`*` em volta), só na forma `Task`; separador = `:`/`—`/`–` com espaço opcional antes, ou ` - `.
 */
const CABECALHO_TASK = /^#{2,3} (?:Task (\d+[a-z]?)(?: [_*]?\([^()]*\)[_*]?)?|T(\d+[a-z]?))(?: ?[:—–]| - )/;

/** Tasks do plano .md como `T<id>`, fora de bloco cercado (a cerca abre e fecha com o mesmo caractere); repetição conta 1 vez (a 1ª). */
export function tasksDoPlanoMd(texto        )           {
  const ids           = [];
  let cerca                = null;
  for (const linha of String(texto).split('\n')) {
    const c = /^(```|~~~)/.exec(linha);
    if (c !== null) { if (cerca === null) cerca = c[1][0]; else if (cerca === c[1][0]) cerca = null; continue; }
    if (cerca !== null) continue;
    const m = CABECALHO_TASK.exec(linha);
    if (m === null) continue;
    const id = `T${m[1] ?? m[2]}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------- rótulos (itens 4 e 5) ----------

/** Item 4: sem `plano.json` a fase não é medida; com ele, "FASE n de 7" (`?` sem n). */
export function rotuloFase(temPlanoJson         , n               )         {
  if (!temPlanoJson) return ROTULO_FASE_NAO_MEDIDA;
  return `FASE ${n === null ? '?' : n} de 7`;
}

/**
 * Item 5: o agente só é da task se ela saiu de `pendente` (alguém rodou `loop.mjs iniciar`); sem task casada, ou task sem início ⇒ "agente fora
 * do loop". Sem exceção, a Sombra sem task também (emenda 18 p.6).
 */
export function rotuloAgente(c                                                      , estados                                 )         {
  if (c.task === null) return ROTULO_FORA_DO_LOOP;
  const e = estados.get(c.task);
  return e === undefined || e === 'pendente' ? ROTULO_FORA_DO_LOOP : c.task;
}

// ---------- projeção ----------

const semAcento = (s        )         => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const msDe = (ev        )         => Date.parse(String(ev.ts));
const chaveEv = (ev        )         => `${ev.sessao}\u0000${ev.seq}\u0000${ev.ts}\u0000${ev.tipo}`;
function ordemId(a        , b        )         {
  const ma = /^(.*?)(\d+)$/.exec(a), mb = /^(.*?)(\d+)$/.exec(b);
  if (ma !== null && mb !== null && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return cmp(a, b);
}

/** `entrega.encerrada` é o último entre encerrada e reaberta. */
function encerrada(eventos          )          {
  let ultimo                = null;
  for (const ev of eventos) if (ev.tipo === 'entrega.encerrada' || ev.tipo === 'entrega.reaberta') ultimo = ev.tipo;
  return ultimo === 'entrega.encerrada';
}

/** Colunas do quadro FL1 sem `fluxo.status.FL1` legível (F6): nomes e chaves. */
const COLUNAS_FL1_PADRAO = ['Preparado', 'Em execução', 'Revisão e teste', 'Pronto para liberar', 'Concluído', 'preparado', 'em_execucao', 'revisao', 'pronto', 'concluido'];

/**
 * Colunas do quadro FL1 (REQ-PRJ-2 a): as chaves e os valores de `fluxo.status.FL1` (`statusCfg`), normalizados (sem acento, caixa e espaço nas
 * pontas). Sem objeto legível (ausente, não objeto, vazio, sem valor texto) ⇒ os 5 nomes e as 5 chaves padrão.
 */
export function colunasFl1(statusCfg         )              {
  const cols = new Set        ();
  if (typeof statusCfg === 'object' && statusCfg !== null && !Array.isArray(statusCfg)) {
    for (const [k, v] of Object.entries(statusCfg                           )) {
      if (typeof v !== 'string' || semAcento(v) === '') continue;
      cols.add(semAcento(k));
      cols.add(semAcento(v));
    }
  }
  return cols.size > 0 ? cols : new Set(COLUNAS_FL1_PADRAO.map(semAcento));
}

/** Predicado único (REQ-PRJ-2 a; o doctor o importa do `dist/`): `status` é coluna do quadro FL1? */
export function ehColunaFl1(status        , statusCfg          )          {
  return colunasFl1(statusCfg).has(semAcento(status));
}

/**
 * Regra única de "feito" (REQ-PRJ-3 f; o doctor a importa do `dist/`): `status` = o `concluido` de `fluxo.status.FL1` (`statusCfg`) OU o
 * `concluido` fixo (F4), sem acento, caixa nem espaço nas pontas. `entrega.encerrada` é do diário e fica em `projetarProjeto`.
 */
export function ehFeito(status               , statusCfg          )          {
  if (status === null || semAcento(status) === '') return false;
  const s = semAcento(status);
  if (s === 'concluido') return true;
  if (typeof statusCfg !== 'object' || statusCfg === null || Array.isArray(statusCfg)) return false;
  const c = (statusCfg                           ).concluido;
  return typeof c === 'string' && semAcento(c) !== '' && semAcento(c) === s;
}

/**
 * REQ-CRD-1 (D-G43, D-G46), regra única (o `herdar` a importa do `dist/`): há card, a entrega está encerrada (a última entre `entrega.encerrada` e
 * `entrega.reaberta` é a encerrada) e o status do card ainda não é "feito". O plugin só AVISA; nenhum caminho dele escreve no card.
 * `eventos` em ordem cronológica.
 */
export function cardDesatualizado(card             , eventos          , statusFl1          )          {
  return card !== null && encerrada(eventos) && !ehFeito(card.status, statusFl1);
}

/** DT5 (GM-20): status terminal padrão (card encerrado sem entrega); `fluxo.status.terminais` na config substitui a lista. */
export const TERMINAIS_PADRAO                    = ['Superado', 'Cancelado', 'Descartado'];

/** `fluxo.status.terminais` válido ⇒ a lista (de textos não vazios; `[]` vale e não deixa nada terminal); ausente ⇒ o padrão; qualquer outra forma ⇒ `null` (o chamador avisa e usa o padrão). */
export function terminaisValidos(cfg         )                  {
  if (!Array.isArray(cfg)) return null;
  return cfg.every((x) => typeof x === 'string' && semAcento(x) !== '') ? (cfg            ) : null;
}

/**
 * Regra única de "terminal" (DT5): o 1º termo do status (até ` — `, ` – `, ` - `, `:` ou `(`), sem acento, caixa nem espaço nas pontas, é um dos terminais.
 * `terminais` ausente ou inválido ⇒ o padrão. Igualdade do 1º termo inteiro: `Superadoria` não casa `Superado`.
 */
/** O 1º termo do status (até ` — `, ` – `, ` - `, `:` ou `(`), sem espaço nas pontas: o que `ehTerminal` compara (e o que o `herdar --gravar --terminais` grava). */
export function primeiroTermo(status        )         {
  return (status.split(/ [—–-] |:|\(/)[0] ?? '').trim();
}

export function ehTerminal(status               , terminais          )          {
  if (status === null) return false;
  const primeiro = semAcento(primeiroTermo(status));
  if (primeiro === '') return false;
  const lista = terminais === undefined ? TERMINAIS_PADRAO : (terminaisValidos(terminais) ?? TERMINAIS_PADRAO);
  return lista.some((t) => semAcento(t) === primeiro);
}

const CHAVE_EPIC = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** `fluxo.vinculoPbiEpic`: só `tipo` = `frontmatter` agrupa; a chave é `nome` (válido) ou `epic`. Outro vínculo (MCP) ou ilegível ⇒ `null`. */
function chaveEpicDe(vinculo         )                {
  if (typeof vinculo !== 'object' || vinculo === null || Array.isArray(vinculo)) return null;
  const v = vinculo                           ;
  if (v.tipo !== 'frontmatter') return null;
  return typeof v.nome === 'string' && CHAVE_EPIC.test(v.nome) ? v.nome : 'epic';
}

                                              

export function projetarProjeto(arvores              , opcoes                                                                                                                                                                                                          )                {
  // D-G27: só o booleano `true` liga; a borda lê a config, o núcleo nunca
  const opcoesLigadas = opcoes.opcoesComoContagem === true;
  let nOpcoes = 0;
  let nTerminais = 0;
  const idPadrao = opcoes.idPadrao ?? ID_PADRAO;
  const chaveEpic = chaveEpicDe(opcoes.vinculo);
  const avisos = [...(opcoes.avisos ?? [])];
  const cards = new Map                                                                                                             ();
  const entregas = new Map                                                       ();
  arvores.forEach((a, idx) => {
    for (const c of a.cards ?? []) {
      const card = cardDe(c.arquivo, c.texto, idPadrao, chaveEpic);
      if (card !== null) cards.set(card.id, [...(cards.get(card.id) ?? []), { ...card, idx, caminho: a.caminho, textoMd: c.planoMd, legado: c.planoLegado ?? null }]);
    }
    for (const e of a.entregas ?? []) {
      if (idPadrao.test(e.id)) entregas.set(e.id, [...(entregas.get(e.id) ?? []), { ...e, idx, caminho: a.caminho }]);
    }
  });
  const ids = [...new Set([...cards.keys(), ...entregas.keys()])].sort(ordemId);
  const linhas                 = [];
  const diarios                                           = [];
  for (const id of ids) {
    // card: o mais novo (atualizadoEm); empate ⇒ o da árvore que vem antes (a atual)
    const card = [...(cards.get(id) ?? [])].sort((a, b) => cmp(b.atualizadoEm ?? '', a.atualizadoEm ?? '') || a.idx - b.idx)[0] ?? null;
    const ents = [...(entregas.get(id) ?? [])].sort((a, b) => a.idx - b.idx);
    // diário: união das árvores, evento repetido conta 1 vez
    const vistos = new Set        ();
    const eventos           = [];
    for (const e of ents) {
      if (e.eventos === null) { avisos.push(`${id}: diário ilegível em ${e.caminho}`); continue; }
      for (const ev of e.eventos) { const k = chaveEv(ev); if (!vistos.has(k)) { vistos.add(k); eventos.push(ev); } }
    }
    eventos.sort((a, b) => msDe(a) - msDe(b) || cmp(String(a.sessao), String(b.sessao)) || a.seq - b.seq);
    // REQ-PRJ-2 (b, c): com a chave ligada, card COM status fora do quadro FL1 é opção (não vira linha); a medição vence o card; diário ilegível conta como medição (nunca ausência)
    const medido = ents.some((e) => e.plano !== null) || ents.some((e) => e.eventos === null) || eventos.some((ev) => TIPOS_DE_TASK.includes(ev.tipo));
    // GM-20 DT5: terminal ANTES da opção (e vale com a chave ligada ou não); a medição vence, como na opção, e avisa
    if (card !== null && ehTerminal(card.status, opcoes.terminais)) {
      if (!medido) { nTerminais++; continue; }
      avisos.push(`${id}: status terminal com trabalho medido`);
    }
    if (opcoesLigadas && card !== null && card.status !== null && !ehColunaFl1(card.status, opcoes.statusFl1) && !medido) { nOpcoes++; continue; }
    if (eventos.length > 0) diarios.push({ id, eventos });
    const feito = (card !== null && ehFeito(card.status, opcoes.statusFl1)) || encerrada(eventos);
    const desatualizado = cardDesatualizado(card, eventos, opcoes.statusFl1) ? (card?.status ?? '(sem status)') : null;
    if (desatualizado !== null) avisos.push(`${id}: card "${desatualizado}" desatualizado (entrega encerrada)`);
    // plano: inválido ⇒ "?" (nunca o .md nem plano velho); sem plano.json, o .md do card
    const comJson = escolherPlanoJson(ents);
    let plano                        = null;
    let taskIds                  = null;
    let motivo                = null;
    let mdTexto                = null;
    let origem = card?.caminho ?? ents[0]?.caminho ?? '';
    if (comJson !== undefined && comJson.plano !== null) {
      origem = comJson.caminho;
      if (!comJson.plano.ok) motivo = comJson.plano.motivo;
      else {
        const v = validarPlano(comJson.plano.bruto);
        if (v.ok) { plano = 'json'; taskIds = v.plano.tasks.map((t) => t.id); } else motivo = v.erro;
      }
    } else if (card !== null && card.planoMd !== null) {
      if (card.textoMd === null) motivo = `plano ${card.planoMd} não encontrado`;
      else mdTexto = card.textoMd;
    } else if (card !== null && card.legado !== null) mdTexto = card.legado.texto; // GM-20: ponteiro vale mais que o padrão
    if (mdTexto !== null && card !== null) {
      const ts = tasksDoPlanoMd(mdTexto);
      plano = 'md'; // GM-20 REQ-LEG-2: .md sem task contável é "plano (formato anterior)", não "sem plano"
      if (ts.length > 0) { taskIds = ts; origem = card.caminho; }
    }
    let tasks                    = null;
    if (taskIds !== null) {
      const norm = (t         )                => (typeof t !== 'string' ? null : plano === 'md' && /^\d+[a-z]?$/.test(t) ? `T${t}` : t);
      let integradas = 0, fora = 0;
      for (const t of taskIds) {
        const doTask = eventos.filter((ev) => TIPOS_DE_TASK.includes(ev.tipo) && norm((ev.dados ?? {}).task) === t);
        const r = estadoDe(doTask);
        if ('invalido' in r) { avisos.push(`${id} ${t}: estado inválido no diário (${r.invalido})`); continue; }
        if (r.estado === 'integrada') integradas++;
        else if (r.estado === 'adiada' || r.estado === 'cortada') fora++;
      }
      // GM-21 DT10: `task.herdada` de task FORA do plano é feita (de antes do gabarito); a de task do plano é do loop (conta 1 vez, como medida); id repetido conta 1
      const doPlano = new Set(taskIds);
      const herdadasIds = new Set        ();
      for (const ev of eventos) {
        if (ev.tipo !== 'task.herdada') continue;
        const n = norm((ev.dados ?? {}).task);
        if (n !== null && !doPlano.has(n)) herdadasIds.add(n);
      }
      const herdadas = herdadasIds.size;
      const total = taskIds.length - fora + herdadas;
      // p.2: PBI concluído sem registro das tasks no diário ⇒ o que falta registrar é ESTIMADO como feito, sinalizado, nunca medido (herdada não é estimada)
      const estimadas = feito ? total - integradas - herdadas : 0;
      tasks = { total, integradas, ...(herdadas > 0 ? { herdadas } : {}), estimadas, restantes: total - integradas - herdadas - estimadas, fora };
    }
    const formatoAnterior = tasks === null && plano === 'md' && motivo === null;
    const semPlano = tasks === null && !formatoAnterior;
    const pctDe = (n        )                => (tasks === null || tasks.total <= 0 ? null : Math.round((n / tasks.total) * 100));
    const herdadasL = tasks?.herdadas ?? 0;
    const pct = tasks === null ? null : pctDe(tasks.integradas + herdadasL);
    const pctComEstimadas = tasks === null ? null : pctDe(tasks.integradas + herdadasL + tasks.estimadas);
    const texto = motivo !== null ? '? plano inválido'
      : tasks === null ? (formatoAnterior ? (feito ? 'feito, plano (formato anterior)' : 'plano (formato anterior)') : feito ? 'feito, sem plano' : 'sem plano')
        : feito ? (tasks.estimadas > 0 ? `feito (${tasks.estimadas} tasks estimadas)` : 'feito')
          : pct === null ? '? sem task no plano'
            : herdadasL > 0 ? `${pct} % (${tasks.integradas + herdadasL} feitas: ${herdadasL} ${herdadasL === 1 ? 'herdada' : 'herdadas'}, ${tasks.integradas} ${tasks.integradas === 1 ? 'medida' : 'medidas'})`
              : `${pct} % (${tasks.integradas} de ${tasks.total})`;
    linhas.push({
      id, titulo: card?.titulo ?? null, status: card?.status ?? null, feito, cardDesatualizado: desatualizado, epic: card?.epic ?? null, plano, semPlano, tasks, pct, pctComEstimadas, texto, motivo,
      fase: plano === 'json' ? null : ROTULO_FASE_NAO_MEDIDA, origem,
    });
  }
  // totais: medidas e estimadas separadas (p.2); o sem plano fica fora da conta; GM-20 D-G42/DT1: concluído sem `plano.json` (o .md inclusive) sai das duas pontas
  let tasks = 0, integradas = 0, estimadas = 0, herdadas = 0;
  for (const l of linhas) {
    if (l.tasks === null || (l.feito && l.plano !== 'json')) continue;
    tasks += l.tasks.total;
    integradas += l.tasks.integradas;
    herdadas += l.tasks.herdadas ?? 0;
    estimadas += l.tasks.estimadas;
  }
  const restantes = tasks - integradas - herdadas - estimadas;
  const foraDaConta = linhas.filter((l) => l.semPlano && !l.feito).length;
  return {
    linhas,
    grupos: gruposDe(linhas, opcoes.titulosEpic),
    totais: {
      pbis: linhas.length, opcoes: nOpcoes, terminais: nTerminais, feitos: linhas.filter((l) => l.feito).length, foraDaConta, tasks, integradas, ...(herdadas > 0 ? { herdadas } : {}), estimadas, restantes,
      pct: tasks > 0 ? Math.round(((integradas + herdadas) / tasks) * 100) : null,
      pctComEstimadas: tasks > 0 ? Math.round(((integradas + herdadas + estimadas) / tasks) * 100) : null,
      previsao: previsaoDoProjeto(linhas, diarios, restantes, opcoes.agoraMs, opcoes.fuso),
    },
    avisos,
  };
}

/** REQ-PRJ-3 (c): só os PBIs abertos; 2 grupos ou mais ("sem Epic" conta) ⇒ grupos, na ordem do menor ID aberto, "sem Epic" por último. */
function gruposDe(linhas                , titulos                                    )              {
  const porEpic = new Map                         ();
  for (const l of linhas) if (!l.feito) porEpic.set(l.epic, [...(porEpic.get(l.epic) ?? []), l.id]);
  if (porEpic.size < 2) return [];
  const grupos = [...porEpic].map(([epic, ids]) => ({ epic, titulo: epic === null ? null : (titulos?.[epic] ?? null), abertos: ids.length, ids }));
  return [...grupos.filter((g) => g.epic !== null), ...grupos.filter((g) => g.epic === null)];
}

/** Item 3: o mesmo ritmo medido da T30 (relógio por task integrada), sobre todas as entregas do projeto. Sem ritmo ⇒ `?` com motivo. */
function previsaoDoProjeto(linhas                , diarios                                          , restantes        , agoraMs        , fuso        )                  {
  const ritmo = ritmoDasAnteriores(diarios, null);
  if (ritmo === null || !Number.isFinite(ritmo) || ritmo <= 0) return { ritmoS: null, medida: null, estimada: null, motivo: 'sem ritmo medido: nenhuma task integrada no projeto' };
  // GM-21 DT11: amostra mínima (só aqui; o fallback da entrega segue como está); a herdada não tem duração e nunca entra na contagem
  const medidas = tasksMedidas(diarios);
  if (medidas < AMOSTRA_MINIMA_PROJETO) return { ritmoS: ritmo, medida: null, estimada: null, motivo: `sem ritmo: ${medidas} de ${AMOSTRA_MINIMA_PROJETO} tasks medidas` };
  const hora = (s        )         => horaLocal(agoraMs + s * 1000, agoraMs, fuso);
  const medidaS = ritmo * restantes;
  const medida = { restanteS: medidaS, hora: hora(medidaS) };
  const est = estimativaSemPlano(linhas);
  if (est === null) return { ritmoS: ritmo, medida, estimada: null, motivo: null };
  if ('motivo' in est) return { ritmoS: ritmo, medida, estimada: null, motivo: est.motivo };
  const tasks = est.tasksPorPbi * est.abertos;
  const estS = medidaS + ritmo * tasks;
  const h = hora(estS);
  const texto = `~${Math.round(tasks)} tasks estimadas em ${est.abertos} PBIs sem plano, até ~${h}`;
  return { ritmoS: ritmo, medida, estimada: { restanteS: estS, hora: h, pbisSemPlano: est.abertos, tasksPorPbi: est.tasksPorPbi, tasks, texto }, motivo: null };
}

/** Tasks integradas no projeto (cada uma 1 vez por entrega): a amostra do ritmo. */
function tasksMedidas(diarios                                          )         {
  let n = 0;
  for (const d of diarios) {
    const ints = new Set        ();
    for (const ev of d.eventos) if (ev.tipo === 'task.integrada' && typeof (ev.dados ?? {}).task === 'string') ints.add((ev.dados                    ).task);
    n += ints.size;
  }
  return n;
}

/**
 * Emenda 19 p.5 (D-G13): PBIs sem plano e não concluídos × mediana de tasks dos PBIs com plano; só para a previsão, nunca no %.
 * `null` = nenhum PBI sem plano aberto.
 */
function estimativaSemPlano(linhas                )                                                                       {
  const abertos = linhas.filter((l) => (l.semPlano || (l.plano === 'md' && l.tasks === null && l.motivo === null)) && !l.feito).length;
  if (abertos === 0) return null;
  const porPbi = linhas.filter((l) => l.tasks !== null && l.tasks.total > 0).map((l) => (l.tasks              ).total);
  if (porPbi.length === 0) return { motivo: `sem PBI com plano para estimar os ${abertos} sem plano` };
  return { abertos, tasksPorPbi: mediana(porPbi) };
}

/**
 * Emenda 19 p.3p (D-G13): entre worktrees vale o `plano.json` cujo último commit é o mais recente. Empate, ou alguma árvore sem data de commit
 * (sem git, não versionado) ⇒ o da árvore atual (`ents` vem com a atual primeiro, depois a ordem do git).
 */
function escolherPlanoJson                                                             (ents     )                {
  const com = ents.filter((e) => e.plano !== null);
  if (com.length === 0) return undefined;
  const data = (e   )                => (typeof e.planoCommitMs === 'number' && Number.isFinite(e.planoCommitMs) ? e.planoCommitMs : null);
  if (com.some((e) => data(e) === null)) return com[0];
  let melhor = com[0];
  for (const e of com.slice(1)) if ((data(e)          ) > (data(melhor)          )) melhor = e;
  return melhor;
}

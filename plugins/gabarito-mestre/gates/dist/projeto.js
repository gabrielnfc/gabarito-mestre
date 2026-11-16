/**
 * Visão de projeto (GM-15 T31, REQ-ENT-2 emenda 4, decisão do dono D-G3): uma linha por PBI/entrega do projeto, acima da visão de entrega.
 * Núcleo PURO: sem `node:*` (o mod carrega o `dist/`). A borda (T32, `painel.mjs`) roda `git worktree list --porcelain`, lê de cada árvore os
 * cards de `fluxo.mapeamento.FL1`, o plano .md que o card aponta, `plano.json` e o diário de `.harness/entregas/<id>/`, e entrega `ArvoreLida[]`.
 *
 * Regras (emenda 4, itens 1 a 5):
 *  1. fontes = card (status do frontmatter), `plano.json` (ou o plano .md, `### Task N:`, quando não houver `plano.json`) e o diário, em TODAS as
 *     worktrees; falha do git ⇒ só a árvore atual + aviso (`worktreesDe`).
 *  2. PBI sem plano: "sem plano", nunca 0 %; o total diz quantos PBIs ficam fora da conta.
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
const ID_PADRAO = /^[A-Z]+-\d+$/;

/** O que a borda leu de UMA árvore (worktree). `planoMd` = texto do plano .md que o card aponta, lido na mesma árvore (`null` = sem arquivo). */
                          
                  
                                                                           
                                                                                                                
                                                                                                                                        
  

                                                                                                                                     
/** `integradas` = medidas no diário; `estimadas` = de PBI concluído sem registro no diário (emenda 18 p.2): nunca somam às medidas. */
                                                                                                                   
                            
             
                        
                        
                                                                               
                 
                              
                                                                                
                    
                           
                                                                            
                     
                                                                                      
                                 
                                                                 
                
                                                            
                        
                                                                                   
                      
                                                 
                 
  
                               
                                                                                     
                        
                                                          
                                                     
                                                                                                                                
                                                                                                  
                        
  
                             
                         
                                                                                                                                                                                                                        
                   
  

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

/** Card FL1: frontmatter `id` (casa `idPadrao`; senão `null`, ex. `PBI-EXEMPLO`), `status`, `atualizadoEm`; título = 1º `# `. */
export function cardDe(_arquivo        , texto        , idPadrao         = ID_PADRAO)              {
  const linhas = String(texto).split('\n');
  if (linhas[0]?.trim() !== '---') return null;
  const fim = linhas.indexOf('---', 1);
  if (fim < 0) return null;
  const fm = new Map                ();
  for (const l of linhas.slice(1, fim)) {
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(l);
    if (m !== null) fm.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  const id = fm.get('id');
  if (id === undefined || !idPadrao.test(id)) return null;
  const tit = linhas.slice(fim + 1).find((l) => l.startsWith('# '));
  return { id, status: fm.get('status') || null, titulo: tit === undefined ? null : tit.slice(2).trim(), atualizadoEm: fm.get('atualizadoEm') || null, planoMd: planoMdDoCard(texto) };
}

/** Tasks do plano .md: só `### Task N:` no começo da linha, como `TN`. */
export function tasksDoPlanoMd(texto        )           {
  const ids           = [];
  for (const m of String(texto).matchAll(/^### Task (\d+):/gm)) if (!ids.includes(`T${m[1]}`)) ids.push(`T${m[1]}`);
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

                                              

export function projetarProjeto(arvores              , opcoes                                                                         )                {
  const idPadrao = opcoes.idPadrao ?? ID_PADRAO;
  const avisos = [...(opcoes.avisos ?? [])];
  const cards = new Map                                                          ();
  const entregas = new Map                                                       ();
  arvores.forEach((a, idx) => {
    for (const c of a.cards ?? []) {
      const card = cardDe(c.arquivo, c.texto, idPadrao);
      if (card !== null) cards.set(card.id, [...(cards.get(card.id) ?? []), { ...card, idx, caminho: a.caminho, textoMd: c.planoMd }]);
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
    if (eventos.length > 0) diarios.push({ id, eventos });
    const feito = (card !== null && semAcento(card.status ?? '') === 'concluido') || encerrada(eventos);
    // plano: inválido ⇒ "?" (nunca o .md nem plano velho); sem plano.json, o .md do card
    const comJson = escolherPlanoJson(ents);
    let plano                        = null;
    let taskIds                  = null;
    let motivo                = null;
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
      else {
        const ts = tasksDoPlanoMd(card.textoMd);
        if (ts.length > 0) { plano = 'md'; taskIds = ts; origem = card.caminho; }
      }
    }
    let tasks                    = null;
    if (taskIds !== null) {
      const norm = (t         )                => (typeof t !== 'string' ? null : plano === 'md' && /^\d+$/.test(t) ? `T${t}` : t);
      let integradas = 0, fora = 0;
      for (const t of taskIds) {
        const doTask = eventos.filter((ev) => TIPOS_DE_TASK.includes(ev.tipo) && norm((ev.dados ?? {}).task) === t);
        const r = estadoDe(doTask);
        if ('invalido' in r) { avisos.push(`${id} ${t}: estado inválido no diário (${r.invalido})`); continue; }
        if (r.estado === 'integrada') integradas++;
        else if (r.estado === 'adiada' || r.estado === 'cortada') fora++;
      }
      const total = taskIds.length - fora;
      // p.2: PBI concluído sem registro das tasks no diário ⇒ o que falta registrar é ESTIMADO como feito, sinalizado, nunca medido
      const estimadas = feito ? total - integradas : 0;
      tasks = { total, integradas, estimadas, restantes: total - integradas - estimadas, fora };
    }
    const semPlano = tasks === null;
    const pctDe = (n        )                => (tasks === null || tasks.total <= 0 ? null : Math.round((n / tasks.total) * 100));
    const pct = tasks === null ? null : pctDe(tasks.integradas);
    const pctComEstimadas = tasks === null ? null : pctDe(tasks.integradas + tasks.estimadas);
    const texto = motivo !== null ? '? plano inválido'
      : tasks === null ? (feito ? 'feito, sem plano' : 'sem plano')
        : feito ? (tasks.estimadas > 0 ? `feito (${tasks.estimadas} tasks estimadas)` : 'feito')
          : pct === null ? '? sem task no plano' : `${pct} % (${tasks.integradas} de ${tasks.total})`;
    linhas.push({
      id, titulo: card?.titulo ?? null, status: card?.status ?? null, feito, plano, semPlano, tasks, pct, pctComEstimadas, texto, motivo,
      fase: plano === 'json' ? null : ROTULO_FASE_NAO_MEDIDA, origem,
    });
  }
  // totais: medidas e estimadas separadas (p.2); o sem plano fica fora da conta
  let tasks = 0, integradas = 0, estimadas = 0;
  for (const l of linhas) {
    if (l.tasks === null) continue;
    tasks += l.tasks.total;
    integradas += l.tasks.integradas;
    estimadas += l.tasks.estimadas;
  }
  const restantes = tasks - integradas - estimadas;
  const foraDaConta = linhas.filter((l) => l.semPlano).length;
  return {
    linhas,
    totais: {
      pbis: linhas.length, feitos: linhas.filter((l) => l.feito).length, foraDaConta, tasks, integradas, estimadas, restantes,
      pct: tasks > 0 ? Math.round((integradas / tasks) * 100) : null,
      pctComEstimadas: tasks > 0 ? Math.round(((integradas + estimadas) / tasks) * 100) : null,
      previsao: previsaoDoProjeto(linhas, diarios, restantes, opcoes.agoraMs, opcoes.fuso),
    },
    avisos,
  };
}

/** Item 3: o mesmo ritmo medido da T30 (relógio por task integrada), sobre todas as entregas do projeto. Sem ritmo ⇒ `?` com motivo. */
function previsaoDoProjeto(linhas                , diarios                                          , restantes        , agoraMs        , fuso        )                  {
  const ritmo = ritmoDasAnteriores(diarios, null);
  if (ritmo === null || !Number.isFinite(ritmo) || ritmo <= 0) return { ritmoS: null, medida: null, estimada: null, motivo: 'sem ritmo medido: nenhuma task integrada no projeto' };
  const hora = (s        )         => horaLocal(agoraMs + s * 1000, agoraMs, fuso);
  const medidaS = ritmo * restantes;
  const medida = { restanteS: medidaS, hora: hora(medidaS) };
  const est = estimativaSemPlano(linhas);
  if (est === null) return { ritmoS: ritmo, medida, estimada: null, motivo: null };
  if ('motivo' in est) return { ritmoS: ritmo, medida, estimada: null, motivo: est.motivo };
  const estS = medidaS + ritmo * est.tasksPorPbi * est.abertos;
  return { ritmoS: ritmo, medida, estimada: { restanteS: estS, hora: hora(estS), pbisSemPlano: est.abertos, tasksPorPbi: est.tasksPorPbi }, motivo: null };
}

/**
 * PENDENTE DE DECISÃO DO DONO (emenda 18 deixa fora): fórmula da estimativa dos PBIs sem plano. Hoje: PBIs sem plano e não feitos × mediana de
 * tasks dos PBIs com plano. `null` = nenhum PBI sem plano aberto.
 */
function estimativaSemPlano(linhas                )                                                                       {
  const abertos = linhas.filter((l) => l.semPlano && !l.feito).length;
  if (abertos === 0) return null;
  const porPbi = linhas.filter((l) => l.tasks !== null && l.tasks.total > 0).map((l) => (l.tasks              ).total);
  if (porPbi.length === 0) return { motivo: `sem PBI com plano para estimar os ${abertos} sem plano` };
  return { abertos, tasksPorPbi: mediana(porPbi) };
}

/**
 * PENDENTE DE DECISÃO DO DONO (emenda 18 deixa fora): qual plano.json vale entre worktrees. Hoje: o da 1ª árvore que tem um (a atual primeiro,
 * depois a ordem do git); `ents` já vem nessa ordem.
 */
function escolherPlanoJson                              (ents     )                {
  return ents.find((e) => e.plano !== null);
}

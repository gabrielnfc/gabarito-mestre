/**
 * Pendências de aprendizado (GM-13, REQ-APR-2): projeção pura do diário. Sem E/S, sem relógio.
 * Identidade do gatilho = par `(sessao, seq)`, nunca `seq` sozinho. Falha fechada: diário que não ordena ⇒ `[]`
 * (a cláusula (1) de `proximaAcao` já parou antes), e o chamador não pode ler `[]` como "sem pendência" nesse caso.
 */
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.js';
import { formaInvalida } from './formas.js';
                                                                        

                                   
const ehObjeto = (v         )           => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Leitura só de propriedade própria sobre objeto: `dados` nulo, texto ou lista nunca lança. */
const prop = (dados         , k        )          => (ehObjeto(dados) && Object.hasOwn(dados, k) ? dados[k] : undefined);
const contagem = (v         )              => Number.isInteger(v) && (v          ) >= 0;
const chave = (sessao        , seq        )         => `${sessao}\u0000${seq}`;
const valido = (e        )          => formaInvalida(e.tipo, e.dados) === null;

/** `(sessao, seq)` do gatilho de um fechador de forma válida, ou `null`. */
function gatilhoDe(e        )                                         {
  if ((e.tipo !== 'aprendizado' && e.tipo !== 'aprendizado.nada') || !valido(e)) return null;
  const g = prop(e.dados, 'gatilho');
  if (!ehObjeto(g)) return null;
  return { sessao: g.sessao          , seq: g.seq           };
}

export function pendenciasAprendizado(plano       , eventos          )              {
  if (!Array.isArray(eventos)) return [];
  const ord = ordenar(eventos);
  if (!ord.ok) return [];
  const lista = ord.eventos;
  const posicao = new Map                ();
  lista.forEach((e, i) => posicao.set(chave(e.sessao, e.seq), i));

  const fechados = new Set        ();
  for (const e of lista) {
    const g = gatilhoDe(e);
    if (g) fechados.add(chave(g.sessao, g.seq));
  }

  const abertas                                = [];
  const abre = (i        , tipo             )       => {
    const e = lista[i];
    if (!fechados.has(chave(e.sessao, e.seq))) abertas.push({ i, p: { sessao: e.sessao, seq: e.seq, tipo } });
  };

  lista.forEach((e, i) => {
    if (e.tipo === 'review.veredito') {
      const major = prop(e.dados, 'major');
      const blocker = prop(e.dados, 'blocker');
      if (contagem(major) && contagem(blocker) && major + blocker >= 1) abre(i, 'review');
    } else if (e.tipo === 'loop.parar') {
      const doStop = prop(e.dados, 'motivo') === 'sem_progresso' && Number.isInteger(prop(e.dados, 'stops'));
      if (!doStop) abre(i, 'parar');
    }
  });

  // fechamento: todas as tasks do plano integradas (plano sem task não tem âncora)
  const tasks = Array.isArray(plano?.tasks) ? plano.tasks : [];
  if (tasks.length > 0) {
    const ids = new Set        ();
    let todas = true;
    for (const t of tasks) {
      const id = ehObjeto(t) ? t.id : undefined;
      if (typeof id !== 'string') { todas = false; break; }
      ids.add(id);
      const fila = lista.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && prop(e.dados, 'task') === id);
      const r = estadoDe(fila);
      if ('invalido' in r || r.estado !== 'integrada') { todas = false; break; }
    }
    if (todas) {
      let ancora = -1;
      lista.forEach((e, i) => {
        if (e.tipo === 'task.integrada' && ids.has(prop(e.dados, 'task')          )) ancora = i;
      });
      if (ancora >= 0) abre(ancora, 'fechamento');
    }
  }

  // dono: no máximo 1, na mensagem válida mais recente; fechar uma fecha ela e as anteriores na ordem
  const mensagens           = [];
  lista.forEach((e, i) => { if (e.tipo === 'dono.mensagem' && valido(e)) mensagens.push(i); });
  if (mensagens.length > 0) {
    let fechadaAte = -1;
    for (const e of lista) {
      const g = gatilhoDe(e);
      const alvo = g ? posicao.get(chave(g.sessao, g.seq)) : undefined;
      if (alvo !== undefined && lista[alvo].tipo === 'dono.mensagem' && valido(lista[alvo])) fechadaAte = Math.max(fechadaAte, alvo);
    }
    const ultima = mensagens[mensagens.length - 1];
    if (ultima > fechadaAte) {
      const e = lista[ultima];
      abertas.push({ i: ultima, p: { sessao: e.sessao, seq: e.seq, tipo: 'dono' } });
    }
  }

  return abertas.sort((a, b) => a.i - b.i).map((x) => x.p);
}

/**
 * "Depende de você" fora do loop (GM-14, REQ-DEP-1 e Emenda 2 consolidada). Núcleo puro: sem E/S, sem relógio, nunca lança.
 *
 * Ordem da saída: `base` (E4 REQ-PNL-2; começa pelo PAROU) ▸ (6) pouso pendente ▸ (5) task no limite de revisões ▸ (1) aprovação
 * ▸ (2) pedido de revisão aberto ▸ (3) pendências abertas ▸ (4) ideias ▸ (7) emenda aberta. A pergunta aberta do painel (T12) tem
 * lugar próprio no estado e não é item daqui.
 *
 * "nada" só com todas as fontes lidas sem falha e lista vazia; fonte que falhou (nome dado pelo chamador, ou o diário que não
 * ordena) ⇒ "depende de você: ? (não consegui ler <fonte>)", nunca "nada" (D-P13 1). Os textos são linguagem natural: o comando só
 * vive em `acoes[].comando`, e só quando provado seguro (id de task em formato fechado; branch da entrega, DP-3 ajuste 3).
 */
import { projetarEmendas } from './emenda.ts';
import { formaInvalida, ID_PERGUNTA_RE } from './formas.ts';
import { estadoDe, ordenar, TIPOS_DE_TASK } from './loop.ts';
import type { Acao, Evento, ItemDepende } from './tipos.ts';
import { idDaBranch } from './trilha.ts';
import type { Trilha } from './trilha.ts';

const CMD_APROVAR = '/gabarito-mestre:aprovar';
/** Id de task que pode ir num comando: letra e até 15 letras, dígitos ou hífen (ex.: `T12`, `T1b`). Fora disso o item sai sem botão. */
const TASK_SEGURA = /^[A-Za-z][A-Za-z0-9-]{0,15}$/;
const ENTREGA_SEGURA = /^[A-Za-z0-9-]{1,40}$/;
const NOME_FONTE_MAX = 60;

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const item = (motivo: string, acoes: Acao[] = []): ItemDepende => ({ nivel: 'dono', motivo, acoes });

/** `A`, `A e B`, `A, B e C`. */
const listaE = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/** Nome de fonte vindo do chamador: sem controle, 1 linha, no máximo 60 caracteres; vazio ⇒ "uma fonte". */
function nomeDeFonte(v: unknown): string {
  const limpo = [...(typeof v === 'string' ? v : '')].map((ch) => { const c = ch.codePointAt(0) as number; return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? ' ' : ch; }).join('');
  const t = limpo.replace(/\s+/g, ' ').trim();
  return t === '' ? 'uma fonte' : Array.from(t).slice(0, NOME_FONTE_MAX).join('');
}

const copia = (i: ItemDepende): ItemDepende => ({ nivel: i.nivel, motivo: i.motivo, acoes: (Array.isArray(i.acoes) ? i.acoes : []).map((a) => ({ ...a })) });

/** Estado do último fato `pr` por número; devolve o maior número aberto. */
function prAberto(evs: Evento[]): number | null {
  const por = new Map<number, string>();
  for (const e of evs) {
    if (e.tipo !== 'fato.medido' || formaInvalida('fato.medido', e.dados) !== null || e.dados.chave !== 'pr') continue;
    const v = obj(e.dados.valor);
    por.set(v.numero as number, v.estado as string);
  }
  let aberto: number | null = null;
  for (const [numero, estado] of por) if (estado === 'aberto' && (aberto === null || numero > aberto)) aberto = numero;
  return aberto;
}

/** Tasks (na ordem do 1º evento no diário) cujo ciclo termina em `no_teto`. Ciclo inválido não conta (o PAROU da base cobre). */
function tasksNoTeto(evs: Evento[]): string[] {
  const ordem: string[] = [];
  const por = new Map<string, Evento[]>();
  for (const e of evs) {
    const task = obj(e.dados).task;
    if (!TIPOS_DE_TASK.includes(e.tipo) || typeof task !== 'string') continue;
    if (!por.has(task)) {
      por.set(task, []);
      ordem.push(task);
    }
    (por.get(task) as Evento[]).push(e);
  }
  return ordem.filter((id) => {
    const r = estadoDe(por.get(id) as Evento[]);
    return !('invalido' in r) && r.estado === 'no_teto';
  });
}

/** Pendências abertas: `nota pendencia` válida sem `dono.resposta` (de opção, não digitada) posterior ao id `<sessao>:<seq>` dela. Só o dono fecha. */
function pendenciasAbertas(evs: Evento[]): { id: string; texto: string }[] {
  const abertas: { id: string; texto: string }[] = [];
  evs.forEach((e, i) => {
    if (e.tipo !== 'nota' || formaInvalida('nota', e.dados) !== null || e.dados.tipo !== 'pendencia') return;
    const id = `${e.sessao}:${e.seq}`;
    if (!ID_PERGUNTA_RE.test(id)) return;
    const fechada = evs.some((r, j) => j > i && r.tipo === 'dono.resposta' && formaInvalida('dono.resposta', r.dados) === null && r.dados.pergunta === id && 'rotulo' in r.dados);
    if (!fechada) abertas.push({ id, texto: e.dados.texto as string });
  });
  return abertas;
}

const nItens = (n: number, um: string, varios: string): string => (n === 1 ? um : varios);

export function dependeDe(
  trilha: Trilha, eventos: Evento[], base: ItemDepende[],
  fontes: { falhou: string[] }, pousoPendente: boolean, git: { branch: string | null; idPadrao: string },
): ItemDepende[] {
  const falhou: string[] = [];
  for (const f of Array.isArray(fontes?.falhou) ? fontes.falhou : []) {
    const n = nomeDeFonte(f);
    if (!falhou.includes(n)) falhou.push(n);
  }
  let ord: ReturnType<typeof ordenar> = { ok: false };
  try {
    if (Array.isArray(eventos)) ord = ordenar(eventos);
  } catch {
    ord = { ok: false };
  }
  const evs = ord.ok ? ord.eventos : [];
  if (!ord.ok && !falhou.includes('o diário')) falhou.push('o diário');

  const t = obj(trilha) as Partial<Trilha>;
  const identificada = t.identificada === true && typeof t.entrega === 'string' && t.entrega !== '';
  const marcas = Array.isArray(t.marcas) ? t.marcas : [];

  // (6) pouso pendente
  const limpar = pousoPendente === true ? [item('limpar a conversa', [{ rotulo: 'limpar', comando: '/clear' }])] : [];

  // (5) task no limite de revisões
  const limite = tasksNoTeto(evs).map((id) => (TASK_SEGURA.test(id)
    ? item(`decidir a ${id}: chegou ao limite de revisões`, [{ rotulo: 'liberar mais uma rodada', comando: `/gabarito-mestre:liberar ${id}` }])
    : item('decidir uma task: chegou ao limite de revisões')));

  // (1) aprovação: "mudou depois" ou aprovação `●`; os dois juntos são 1 item (a versão nova). Botão só na branch da entrega (DP-3 aj. 3).
  const aprovar: ItemDepende[] = [];
  if (identificada && (t.mudouDepois === true || marcas[2] === '●')) {
    const nova = t.mudouDepois === true;
    const entrega = t.entrega as string;
    const de = ENTREGA_SEGURA.test(entrega) ? `da ${entrega}` : 'desta entrega';
    const texto = `${nova ? 'aprovar a versão nova da spec' : 'aprovar a spec'} ${de}`;
    const naBranch = idDaBranch(typeof git?.branch === 'string' ? git.branch : null, git?.idPadrao) === entrega;
    aprovar.push(naBranch
      ? item(texto, [{ rotulo: nova ? 'aprovar a versão nova' : 'aprovar a spec', comando: CMD_APROVAR }])
      : item(`${texto}: abra a conversa na branch da entrega para aprovar`));
  }

  // (2) pedido de revisão aberto da entrega
  const aberto = identificada ? prAberto(evs) : null;
  const revisar = aberto !== null ? [item(`revisar e aceitar o pedido de revisão #${aberto}`)] : [];

  // (3) pendências abertas, com o botão "feito"
  const pendencias = pendenciasAbertas(evs).map((p) => item(p.texto, [{ rotulo: 'feito', comando: `/gabarito-mestre:responder ${p.id} 1` }]));

  // (4) ideias para a próxima entrega
  const ideias = evs.filter((e) => e.tipo === 'nota' && formaInvalida('nota', e.dados) === null && e.dados.tipo === 'ideia').length;
  const decidirIdeias = ideias > 0 ? [item(`decidir se ${nItens(ideias, 'a ideia vira', `as ${ideias} ideias viram`)} a próxima entrega`)] : [];

  // (7) emendas abertas (os botões são os da E4)
  const emendas = ord.ok ? projetarEmendas(evs).abertas : [];
  const decidirEmendas = emendas.map((p) => item(`decidir a emenda ${p.seq}`, [
    { rotulo: 'aprovar', comando: `/gabarito-mestre:emenda aprovar ${p.seq}` }, { rotulo: 'rejeitar', comando: `/gabarito-mestre:emenda rejeitar ${p.seq}` },
  ]));

  // A base não repete o que (1) e (7) já dizem (a E4 também lista "spec aguardando" e "emenda #n").
  const daBase = (Array.isArray(base) ? base : []).filter((b) => {
    if (aprovar.length > 0 && Array.isArray(b?.acoes) && b.acoes.some((a) => a?.comando === CMD_APROVAR)) return false;
    if (emendas.length > 0 && typeof b?.motivo === 'string' && /^(emenda #\d+ |e mais \d+ emenda)/.test(b.motivo)) return false;
    return true;
  }).map(copia);

  const saida = [...daBase, ...limpar, ...limite, ...aprovar, ...revisar, ...pendencias, ...decidirIdeias, ...decidirEmendas];
  if (falhou.length > 0) saida.push(item(`depende de você: ? (não consegui ler ${listaE(falhou)})`));
  else if (saida.length === 0) saida.push(item('depende de você: nada'));
  return saida;
}

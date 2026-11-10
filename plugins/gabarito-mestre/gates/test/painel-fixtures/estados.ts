/**
 * Dez `EstadoPainel` fixos e nomeados (E4, T1) para os testes de render (T4 a T6) e os goldens (T12). Dado, não projeção: cada um é montado à mão
 * no formato que `projetarPainel` (T2) produz, com o pacote Terra Média. `base()` devolve um objeto novo a cada chamada (nenhum estado compartilha referência).
 * Nomes de pessoa são os do pacote de fábrica Terra Média (T3 cria o JSON); o líder é GANDALF e o sábio, ELROND.
 */

import type { Acao, AgentePainel, EstadoPainel, EstadoTask, GlifoTask, MotivoParar, TaskPainel } from '../../src/tipos.ts';

export const NOMES_ESTADOS = [
  'vazio', 'em-voo-7-12', 'emenda-aberta', 'pausado', 'parou-teto', 'parou-diario', 'concluir-release', 'deploy-devolvido', 'spec-aguardando', 'sem-limites-sem-uso',
] as const;
export type NomeEstado = (typeof NOMES_ESTADOS)[number];

const GLIFO_FIXO: Partial<Record<EstadoTask, GlifoTask>> = { integrada: '✓', pendente: '○', no_teto: '✗' };

/** `●` com agente vivo, `◐` aguardando outro papel (B3); os estados fixos ignoram `vivo`. */
function task(id: string, estado: EstadoTask, extra: Partial<TaskPainel> & { vivo?: boolean } = {}): TaskPainel {
  const { vivo = true, ...resto } = extra;
  return { id, titulo: `Task ${id}`, estado, glifo: GLIFO_FIXO[estado] ?? (vivo ? '●' : '◐'), deps: [], ...resto };
}

function tasksDe(feitas: number, total: number, emVoo: TaskPainel[] = [], fila: TaskPainel[] = []): TaskPainel[] {
  const integradas = Array.from({ length: feitas }, (_, i) => task(`T${i + 1}`, 'integrada'));
  const resto = [...emVoo, ...fila];
  if (feitas + resto.length !== total) throw new Error(`fixture incoerente: ${feitas} + ${resto.length} ≠ ${total}`);
  return [...integradas, ...resto];
}

function planoDe(tasks: TaskPainel[], extra: Partial<EstadoPainel['plano']> = {}): EstadoPainel['plano'] {
  const feitas = tasks.filter((t) => t.estado === 'integrada').length;
  const total = tasks.length;
  return { tasks, feitas, total, pct: total === 0 ? 0 : Math.round((feitas / total) * 100), eta: null, rodadaMedia: null, medianaS: null, ...extra };
}

const ACOES_TETO = (t: string): Acao[] => [
  { rotulo: 'aprovar', comando: `/gabarito-mestre:liberar ${t}` },
  { rotulo: 'recusar: deixe a task parada e emende a spec', comando: null },
];

function base(): EstadoPainel {
  return {
    id: 'GM-12', titulo: 'E4 Painel', pacote: 'Terra Média',
    plano: planoDe([]),
    equipe: {
      lider: { nome: 'GANDALF', modelo: 'opus', ctx: 36, x: 50, tok: 412_000, h5: 42, d7: 18, narrativa: 'esperando o loop' },
      agentes: [], revisoresAguardando: [],
      sombra: { nome: 'ELROND', modelo: 'opus', decisoes: 0, ultima: null },
    },
    parado: false, parar: null, depende: [], atencao: [], historico: [], ocultos: 0,
    rodape: { ci: { verde: null, execucoesHoje: 0 }, prod: { leituras: 0, alteracoes: 0 }, politica: 'continua' },
    notificacao: null, qualidade: { rodadaMedia: null, mortas: null },
  };
}

function agente(nome: string, papel: AgentePainel['papel'], taskId: string, estadoTask: EstadoTask, extra: Partial<AgentePainel> = {}): AgentePainel {
  return { nome, papel, task: taskId, estadoTask, modelo: 'sonnet', ctxPct: 31, ctxTok: 62_000, tok: 118_000, desdeS: 540, cor: 'claude', vivo: true, ...extra };
}

function parou(motivo: MotivoParar, texto: string, acoes: Acao[], emVoo: string[], alteracoes: number): NonNullable<EstadoPainel['parar']> {
  return { motivo, texto, acoes, hora: '14:07', chave: 'parar:s1:7', emVoo, alteracoes };
}

function emVoo712(): EstadoPainel {
  const e = base();
  const tasks = tasksDe(7, 12, [
    task('T8', 'implementando', { nome: 'GIMLI', papel: 'implementador', modelo: 'sonnet', desdeS: 540 }),
    task('T9', 'em_revisao', { nome: 'LEGOLAS', papel: 'revisor', modelo: 'opus', desdeS: 210 }),
    task('T10', 'concluida', { vivo: false }),
  ], [
    task('T11', 'pendente', { deps: ['T8'] }),
    task('T12', 'pendente', { deps: ['T9', 'T10'] }),
  ]);
  e.plano = planoDe(tasks, { eta: { hora: '17:42', restanteS: 4_320, maisMenosS: 540, n: 7 }, rodadaMedia: 1.4, medianaS: 1_080 });
  e.equipe.agentes = [
    agente('GIMLI', 'implementador', 'T8', 'implementando', { desdeS: 540 }),
    agente('LEGOLAS', 'revisor', 'T9', 'em_revisao', { modelo: 'opus', ctxPct: 18, ctxTok: 36_000, tok: 54_000, desdeS: 210, cor: 'suggestion' }),
  ];
  e.equipe.revisoresAguardando = [{ nome: null, task: 'T10', mutacoesHoje: 14, mortasHoje: 14 }];
  e.equipe.sombra = { nome: 'ELROND', modelo: 'opus', decisoes: 3, ultima: { seq: 41, resposta: 'seguir com a forma opcional', fonte: 'spec:164' } };
  e.atencao = ['T9 na 2ª rodada de review', 'loop segue em T8 T9 T10'];
  e.historico = [
    { glifo: '✓', texto: 'LEGOLAS aprovou T7 · 18 min', hora: '14:02', cor: 'success' },
    { glifo: '▶', texto: 'despachou LEGOLAS em T9', hora: '13:58', cor: 'success' },
    { glifo: '◆', texto: 'ELROND decidiu #41 · seguir com a forma opcional', hora: '13:40', cor: 'success' },
  ];
  e.ocultos = 9;
  e.rodape = { ci: { verde: true, execucoesHoje: 4 }, prod: { leituras: 2, alteracoes: 0 }, politica: 'janela [1-5]' };
  e.qualidade = { rodadaMedia: 1.4, mortas: 61 };
  return e;
}

function emendaAberta(): EstadoPainel {
  const e = emVoo712();
  e.depende = [{
    nivel: 'dono', motivo: 'emenda #3 em REQ-PNL-5 aguarda você',
    acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 3' }, { rotulo: 'rejeitar', comando: '/gabarito-mestre:emenda rejeitar 3' }],
  }];
  return e;
}

function pausado(): EstadoPainel {
  const e = emVoo712();
  e.parado = true;
  e.depende = [{ nivel: 'dono', motivo: 'loop pausado', acoes: [{ rotulo: 'retomar', comando: '/gabarito retomar' }] }];
  e.equipe.lider.narrativa = 'pausado, nada novo é despachado';
  return e;
}

function parouTeto(): EstadoPainel {
  const e = emVoo712();
  const p = parou('teto_rodadas', 'teto de rodadas de review em T9', ACOES_TETO('T9'), ['T8'], 0);
  e.parado = true;
  e.parar = p;
  e.depende = [{ nivel: 'parar', motivo: p.texto, acoes: p.acoes }];
  e.notificacao = { hora: '14:07' };
  e.historico = [{ glifo: '■', texto: 'PAROU · teto de rodadas de review em T9', hora: '14:07', cor: 'error' }, ...e.historico];
  return e;
}

function parouDiario(): EstadoPainel {
  const e = base();
  const acoes: Acao[] = [{ rotulo: 'confira o diário; nada segue até ele ser válido', comando: null }];
  const p = parou('diario_invalido', 'diário fora da tabela de transições', acoes, [], 2);
  // 4 de 6 = 66,67 %: com 67 o arredondamento é por `round`, não por `floor`
  e.plano = planoDe(tasksDe(4, 6, [task('T5', 'implementando', { nome: 'GIMLI', papel: 'implementador', desdeS: 90 })], [task('T6', 'pendente', { deps: ['T5'] })]));
  e.parado = true;
  e.parar = p;
  e.depende = [{ nivel: 'parar', motivo: p.texto, acoes }];
  e.notificacao = null; // sem mod a linha é omitida (spec REQ-PNL-3)
  e.rodape.prod = { leituras: 1, alteracoes: 2 };
  return e;
}

function concluirRelease(): EstadoPainel {
  const e = base();
  e.plano = planoDe(tasksDe(12, 12), { eta: { hora: '18:20', restanteS: 0, maisMenosS: 0, n: 12 }, rodadaMedia: 1.3, medianaS: 1_020 });
  e.depende = [{ nivel: 'dono', motivo: 'merge da release para main', acoes: [{ rotulo: 'faça o merge da release', comando: null }] }];
  e.rodape = { ci: { verde: true, execucoesHoje: 6 }, prod: { leituras: 3, alteracoes: 0 }, politica: 'continua' };
  e.qualidade = { rodadaMedia: 1.3, mortas: 118 };
  e.historico = [{ glifo: '✓', texto: 'T12 integrada · 9 mutações mortas', hora: '18:19', cor: 'success' }];
  return e;
}

function deployDevolvido(): EstadoPainel {
  const e = concluirRelease();
  e.depende = [{
    nivel: 'dono', motivo: 'deploy devolvido ao dono: executar negado no modo auto',
    acoes: [{ rotulo: 'subir a entrega', comando: 'node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-12' }],
  }];
  e.historico = [{ glifo: '◆', texto: 'deploy devolvido ao dono · executar negado no modo auto', hora: '18:21', cor: 'warning' }, ...e.historico];
  return e;
}

function specAguardando(): EstadoPainel {
  const e = base();
  e.plano = planoDe(tasksDe(0, 3, [], [task('T1', 'pendente'), task('T2', 'pendente', { deps: ['T1'] }), task('T3', 'pendente', { deps: ['T2'] })]));
  e.depende = [{ nivel: 'dono', motivo: 'spec aguardando aprovação', acoes: [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }] }];
  return e;
}

function semLimitesSemUso(): EstadoPainel {
  const e = emVoo712();
  e.equipe.lider = { ...e.equipe.lider, modelo: null, ctx: null, tok: null, h5: null, d7: null };
  e.equipe.agentes = e.equipe.agentes.map((a) => ({ ...a, modelo: null, ctxPct: null, ctxTok: null, tok: null }));
  e.equipe.sombra = { ...e.equipe.sombra, modelo: null };
  e.rodape.ci = { verde: null, execucoesHoje: 0 };
  e.plano.eta = null;
  e.qualidade = { rodadaMedia: null, mortas: null };
  return e;
}

export const ESTADOS: Record<NomeEstado, EstadoPainel> = {
  'vazio': base(),
  'em-voo-7-12': emVoo712(),
  'emenda-aberta': emendaAberta(),
  'pausado': pausado(),
  'parou-teto': parouTeto(),
  'parou-diario': parouDiario(),
  'concluir-release': concluirRelease(),
  'deploy-devolvido': deployDevolvido(),
  'spec-aguardando': specAguardando(),
  'sem-limites-sem-uso': semLimitesSemUso(),
};

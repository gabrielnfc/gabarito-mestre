/**
 * Testes de `depende.ts` (GM-14 T13, REQ-DEP-1 e Emenda 2 consolidada). Núcleo puro: trilha + eventos + base ⇒ itens do "depende de você".
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-13-mut.json):
 *  M12     pendência fecha sem `dono.resposta` (qualquer nota do modelo fecha)  ⇒ nota-feito-do-modelo-nao-fecha
 *  M-P6    "nada" mesmo com fonte que falhou                                      ⇒ nada-so-com-todas-as-fontes
 *  M-T13a  botão (1) sem conferir a branch da entrega (DP-3 aj. 3)                ⇒ botao-so-na-branch-da-entrega
 *  M-T13b  aprovação ausente e "mudou depois" duplicam o item                      ⇒ mudou-depois-e-ausente-nao-duplicam
 *  M-T13c  resposta digitada (só hash) fecha a pendência                           ⇒ resposta-que-nao-e-opcao-nao-fecha
 *  M-T13d  `liberar` montado para task em qualquer estado                          ⇒ no-teto-no-depende
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependeDe } from '../src/depende.ts';
import { trilhaDe } from '../src/trilha.ts';
import type { FatosTrilha, Trilha } from '../src/trilha.ts';
import { formaInvalida } from '../src/formas.ts';
import type { Evento, ItemDepende, TipoEvento } from '../src/tipos.ts';

/** Literal das Global Constraints do plano (REQ-LNG-1). */
const REGEX_TECNICA = /[`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b/;
const ID_PADRAO = '[A-Z]+-\\d+';
const BRANCH = 'enabler/GM-14-clareza';
const OK = { falhou: [] as string[] };
const GIT = { branch: BRANCH, idPadrao: ID_PADRAO };

type C = { t: TipoEvento; d: Record<string, unknown>; s?: string };

function expandir(compactos: C[]): Evento[] {
  const seqs = new Map<string, number>();
  let min = 0;
  return compactos.map((c) => {
    const sessao = c.s ?? 'sessao-a';
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    const ts = new Date(Date.UTC(2026, 10, 11, 12, min++)).toISOString();
    return { seq, ts, autor: 'teste', sessao, agente: 'orquestrador', tipo: c.t, dados: c.d, hash_anterior: null } as Evento;
  });
}

const trilha = (extra: Partial<Trilha> = {}): Trilha => ({
  entrega: 'GM-14', identificada: true, candidato: 'GM-14', marcas: ['✓', '✓', '●', '○', '○', '○', '○'], motivos: Array(7).fill(null),
  fase: 3, progresso: 'spec com 6 seções · falta aprovar', mudouDepois: false, ultimaConhecida: null, ambigua: [], ...extra,
});
const SEM_APROVACAO = trilha();
const APROVADA = trilha({ marcas: ['✓', '✓', '✓', '●', '○', '○', '○'], fase: 4 });
const MUDOU = trilha({ marcas: ['✓', '✓', '✓', '●', '○', '○', '○'], fase: 4, mudouDepois: true });
const NAO_IDENTIFICADA = trilha({ entrega: null, identificada: false, candidato: null, marcas: ['●', '○', '○', '○', '○', '○', '○'], fase: 1 });

const chamar = (t: Trilha, evs: C[], base: ItemDepende[] = [], opc: { fontes?: { falhou: string[] }; pouso?: boolean; git?: { branch: string | null; idPadrao: string } } = {}) =>
  dependeDe(t, expandir(evs), base, opc.fontes ?? OK, opc.pouso ?? false, opc.git ?? GIT);
const motivos = (xs: ItemDepende[]) => xs.map((i) => i.motivo);

const nota = (tipo: string, texto: string, s = 'sessao-a', extra: Record<string, unknown> = {}): C => ({ t: 'nota', s, d: { tipo, texto, ...extra } });
const pr = (numero: number, estado: string): C => ({ t: 'fato.medido', d: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: BRANCH } } });
const feito = (pergunta: string): C => ({ t: 'dono.resposta', s: 'sessao-dono', d: { pergunta, opcao: 1, rotulo: 'feito' } });
const hash = 'c'.repeat(64);
/** Ciclo até `no_teto`: r1 reprovada com achado, correção, 2ª reprovação com achado. */
const noTeto = (task: string): C[] => [
  { t: 'task.iniciada', d: { task, papel: 'implementador' } }, { t: 'task.concluida', d: { task } },
  { t: 'task.iniciada', d: { task, papel: 'revisor' } }, { t: 'review.veredito', d: { task, veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 } },
  { t: 'task.iniciada', d: { task, papel: 'correcao' } }, { t: 'task.concluida', d: { task } },
  { t: 'task.iniciada', d: { task, papel: 'revisor' } }, { t: 'review.veredito', d: { task, veredito: 'REPROVADO', rodada: 2, major: 1, blocker: 0 } },
];
const emendaProposta = (): C => ({ t: 'emenda.proposta', s: 'emendas', d: { req: 'REQ-DEP-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', arquivos: ['docs/x.md'] } });
const nada = [{ nivel: 'dono', motivo: 'depende de você: nada', acoes: [] }];
const BASE_PARAR: ItemDepende = { nivel: 'parar', motivo: 'o loop parou: decida', acoes: [] };
const BASE_PAUSA: ItemDepende = { nivel: 'dono', motivo: 'loop pausado', acoes: [{ rotulo: 'retomar', comando: '/gabarito retomar' }] };

test('ordem-1-a-4: base primeiro, depois aprovar, pedido de revisão, pendência e ideias', () => {
  const r = chamar(SEM_APROVACAO, [
    nota('ideia', 'usar cores no painel'), nota('pendencia', 'renovar o certificado'), pr(7, 'aberto'), nota('ideia', 'mais uma ideia'),
  ], [BASE_PARAR, BASE_PAUSA]);
  assert.deepEqual(motivos(r), [
    'o loop parou: decida', 'loop pausado',
    'aprovar a spec da GM-14',
    'revisar e aceitar o pedido de revisão #7',
    'renovar o certificado',
    'decidir se as 2 ideias viram a próxima entrega',
  ]);
  assert.deepEqual(r[2].acoes, [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }]);
  assert.deepEqual(r[3].acoes, [], 'pedido de revisão: sem botão');
  assert.deepEqual(r[4].acoes, [{ rotulo: 'feito', comando: '/gabarito-mestre:responder sessao-a:2 1' }]);
  assert.deepEqual(r[5].acoes, [], 'ideias: sem botão');
  assert.ok(r.slice(2).every((i) => i.nivel === 'dono'));
});

test('uma ideia: singular; pedido de revisão mergeado ou fechado não entra; o maior número aberto vence', () => {
  assert.deepEqual(motivos(chamar(APROVADA, [nota('ideia', 'só uma')])), ['decidir se a ideia vira a próxima entrega']);
  assert.deepEqual(chamar(APROVADA, [pr(7, 'aberto'), pr(7, 'mergeado')]), nada, 'mesmo número, último estado manda');
  assert.deepEqual(chamar(APROVADA, [pr(7, 'fechado')]), nada);
  assert.deepEqual(motivos(chamar(APROVADA, [pr(7, 'aberto'), pr(9, 'aberto')])), ['revisar e aceitar o pedido de revisão #9']);
  assert.deepEqual(chamar(NAO_IDENTIFICADA, [pr(7, 'aberto')]), nada, 'sem entrega identificada não há pedido de revisão da entrega');
});

test('aprovado-no-sha-atual-some: marca ✓ ou "?" na aprovação não gera item', () => {
  assert.deepEqual(chamar(APROVADA, []), nada);
  const semRegistro = trilha({ marcas: ['✓', '✓', '?', '✓', '●', '○', '○'], motivos: [null, null, 'não achei o registro da aprovação', null, null, null, null] });
  assert.deepEqual(chamar(semRegistro, []), nada);
  assert.deepEqual(chamar(NAO_IDENTIFICADA, []), nada);
});

test('mudou-depois-aprovar-versao-nova: texto e botão próprios', () => {
  const r = chamar(MUDOU, []);
  assert.deepEqual(motivos(r), ['aprovar a versão nova da spec da GM-14']);
  assert.deepEqual(r[0].acoes, [{ rotulo: 'aprovar a versão nova', comando: '/gabarito-mestre:aprovar' }]);
  assert.equal(r[0].nivel, 'dono');
});

test('mudou-depois-e-ausente-nao-duplicam: "aprovar" ● e "mudou depois" juntos geram 1 item (a versão nova)', () => {
  const r = chamar(trilha({ mudouDepois: true }), []);
  assert.deepEqual(motivos(r), ['aprovar a versão nova da spec da GM-14']);
  assert.equal(r.filter((i) => /aprovar/.test(i.motivo)).length, 1);
});

test('base com o botão de aprovar da E4 não duplica o item (1)', () => {
  const baseE4: ItemDepende = { nivel: 'dono', motivo: 'spec aguardando aprovação', acoes: [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }] };
  const r = chamar(SEM_APROVACAO, [], [BASE_PARAR, baseE4]);
  assert.deepEqual(motivos(r), ['o loop parou: decida', 'aprovar a spec da GM-14']);
  assert.deepEqual(motivos(chamar(APROVADA, [], [baseE4])), ['spec aguardando aprovação'], 'sem (1), a base fica como veio');
});

test('botao-so-na-branch-da-entrega: branch sem o ID da entrega ⇒ item sem botão e com a instrução (DP-3 aj. 3)', () => {
  for (const branch of ['main', null, 'feat/GM-99-outra', 'wt/clareza']) {
    const r = chamar(SEM_APROVACAO, [], [], { git: { branch, idPadrao: ID_PADRAO } });
    assert.equal(r.length, 1, `branch ${branch}`);
    assert.deepEqual(r[0].acoes, [], `branch ${branch}: sem botão`);
    assert.equal(r[0].motivo, 'aprovar a spec da GM-14: abra a conversa na branch da entrega para aprovar', `branch ${branch}`);
  }
  // "GM-14" sozinho é a própria branch da entrega (último segmento): casa.
  assert.equal(chamar(SEM_APROVACAO, [], [], { git: { branch: 'GM-14', idPadrao: ID_PADRAO } })[0].acoes.length, 1);
  assert.equal(chamar(SEM_APROVACAO, [], [], { git: { branch: 'enabler/GM-14-clareza', idPadrao: ID_PADRAO } })[0].acoes.length, 1);
  // idPadrao inválido nunca lança e nunca dá botão
  assert.deepEqual(chamar(SEM_APROVACAO, [], [], { git: { branch: BRANCH, idPadrao: '(' } })[0].acoes, []);
  // versão nova: mesma regra
  assert.deepEqual(chamar(MUDOU, [], [], { git: { branch: 'main', idPadrao: ID_PADRAO } })[0].acoes, []);
  assert.equal(chamar(MUDOU, [], [], { git: { branch: 'main', idPadrao: ID_PADRAO } })[0].motivo, 'aprovar a versão nova da spec da GM-14: abra a conversa na branch da entrega para aprovar');
});

test('nota-feito-do-modelo-nao-fecha: só `dono.resposta` fecha a pendência', () => {
  const pend = nota('pendencia', 'renovar o certificado');
  const ruido: C[] = [
    nota('pendencia', 'feito'), // nota do modelo dizendo "feito" é outra pendência, não fecha a primeira
    nota('desvio', 'renovar o certificado: feito'),
    { t: 'aprendizado.nada', d: { motivo: 'nada a registrar' } },
    { t: 'decisao.sombra', d: { pergunta: 'x', resposta: 'feito' } },
  ];
  const ainda = chamar(APROVADA, [pend, ...ruido]);
  assert.ok(motivos(ainda).includes('renovar o certificado'), 'a pendência segue aberta');
  // só a resposta ao id exato fecha (id = sessão:seq da nota)
  const fechada = chamar(APROVADA, [pend, feito('sessao-a:1')]);
  assert.deepEqual(fechada, nada);
  // outra pergunta não fecha esta
  assert.ok(motivos(chamar(APROVADA, [pend, feito('sessao-a:2')])).includes('renovar o certificado'));
  // sessão diferente com o mesmo seq não fecha
  assert.ok(motivos(chamar(APROVADA, [pend, feito('sessao-x:1')])).includes('renovar o certificado'));
});

test('resposta-que-nao-e-opcao-nao-fecha: digitada (só hash) e resposta anterior à nota não fecham', () => {
  const pend = nota('pendencia', 'renovar o certificado');
  const digitada: C = { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', sha256: hash, chars: 5 } };
  assert.ok(motivos(chamar(APROVADA, [pend, digitada])).includes('renovar o certificado'));
  // resposta gravada ANTES da nota (diário forjado/embaralhado): não fecha a nota posterior
  const antes: C[] = [{ t: 'dono.resposta', s: 'sessao-a', d: { pergunta: 'sessao-a:2', opcao: 1, rotulo: 'feito' } }, { ...nota('desvio', 'x') }, pend];
  assert.ok(motivos(chamar(APROVADA, antes)).includes('renovar o certificado'), 'nota seq 3, resposta a sessao-a:2 não é dela');
  const antesMesmoId: C[] = [feito('sessao-a:1'), pend];
  // a resposta (sessao-dono:1) vem antes da nota sessao-a:1 na ordem global: não fecha
  assert.ok(motivos(chamar(APROVADA, antesMesmoId)).includes('renovar o certificado'));
});

test('pendência: cada uma é um item; só `nota` com forma válida conta', () => {
  const r = chamar(APROVADA, [nota('pendencia', 'primeira', 'sessao-a'), nota('pendencia', 'segunda', 'sessao-b'), nota('pendencia', 'x'.repeat(161), 'sessao-b'), nota('ideia', 'y'.repeat(161), 'sessao-b')]);
  assert.deepEqual(motivos(r), ['primeira', 'segunda'], 'texto de 161 caracteres viola a forma e não vira item (pendência nem ideia)');
  assert.equal(r[1].acoes[0].comando, '/gabarito-mestre:responder sessao-b:1 1');
});

test('vazio-nada: todas as fontes lidas, lista vazia ⇒ "nada"', () => {
  assert.deepEqual(chamar(APROVADA, []), nada);
  assert.deepEqual(chamar(APROVADA, [], [BASE_PAUSA]).map((i) => i.motivo), ['loop pausado'], 'base não vazia ⇒ sem "nada"');
});

test('nada-so-com-todas-as-fontes: fonte que falhou ⇒ "?" nunca "nada"; fixture GM-14 18:40 (T12 no_teto) ⇒ não é "nada"', () => {
  const falha = chamar(APROVADA, [], [], { fontes: { falhou: ['o GitHub'] } });
  assert.deepEqual(falha, [{ nivel: 'dono', motivo: 'depende de você: ? (não consegui ler o GitHub)', acoes: [] }]);
  const duas = chamar(APROVADA, [], [], { fontes: { falhou: ['o GitHub', 'o diário'] } });
  assert.equal(duas[0].motivo, 'depende de você: ? (não consegui ler o GitHub e o diário)');
  // com itens verdadeiros e fonte falha: os itens ficam e o "?" fecha a lista
  const comItem = chamar(APROVADA, [nota('pendencia', 'renovar o certificado')], [], { fontes: { falhou: ['o GitHub'] } });
  assert.deepEqual(motivos(comItem), ['renovar o certificado', 'depende de você: ? (não consegui ler o GitHub)']);
  // GM-14 18:40: T12 no limite de revisões e nenhum outro item
  const real = chamar(APROVADA, noTeto('T12'));
  assert.notDeepEqual(real, nada);
  assert.deepEqual(motivos(real), ['decidir a T12: chegou ao limite de revisões']);
});

test('eventos-ausente-x-corrompido: [] = diário vazio (nada); não lista ou fora de ordem = "?" do diário, nunca "nada"', () => {
  assert.deepEqual(dependeDe(APROVADA, [], [], OK, false, GIT), nada);
  for (const ruim of [null, undefined, 'x', 42] as unknown[]) {
    const r = dependeDe(APROVADA, ruim as Evento[], [], OK, false, GIT);
    assert.deepEqual(r, [{ nivel: 'dono', motivo: 'depende de você: ? (não consegui ler o diário)', acoes: [] }]);
  }
  const fora = expandir([nota('ideia', 'a'), nota('ideia', 'b')]);
  fora[1].seq = 1; // seq que não cresce na mesma sessão: o diário não ordena
  const r = dependeDe(APROVADA, fora, [], OK, false, GIT);
  assert.equal(r.length, 1);
  assert.equal(r[0].motivo, 'depende de você: ? (não consegui ler o diário)');
  // e a falha do diário não repete a fonte já informada pelo chamador
  assert.equal(dependeDe(APROVADA, fora, [], { falhou: ['o diário'] }, false, GIT)[0].motivo, 'depende de você: ? (não consegui ler o diário)');
});

test('no-teto-no-depende: botão "liberar mais uma rodada" só para task em no_teto, com id seguro', () => {
  const r = chamar(APROVADA, noTeto('T12'));
  assert.deepEqual(r, [{ nivel: 'dono', motivo: 'decidir a T12: chegou ao limite de revisões', acoes: [{ rotulo: 'liberar mais uma rodada', comando: '/gabarito-mestre:liberar T12' }] }]);
  // task em revisão (ainda não no teto) não aparece
  assert.deepEqual(chamar(APROVADA, noTeto('T12').slice(0, 6)), nada);
  // dono liberou ⇒ pendente ⇒ some
  assert.deepEqual(chamar(APROVADA, [...noTeto('T12'), { t: 'task.reaberta', d: { task: 'T12', origem: 'dono' } }]), nada);
  // duas tasks no teto: ordem de aparição no diário
  assert.deepEqual(motivos(chamar(APROVADA, [...noTeto('T9'), ...noTeto('T12')])), ['decidir a T9: chegou ao limite de revisões', 'decidir a T12: chegou ao limite de revisões']);
  // id fora do formato seguro: o item aparece, o comando não
  const sujo = chamar(APROVADA, noTeto('T12 && rm -rf'));
  assert.equal(sujo.length, 1);
  assert.deepEqual(sujo[0].acoes, []);
  assert.ok(!sujo[0].motivo.includes('rm'), 'o texto também não leva o id sujo');
});

test('limpar-no-depende: pouso pendente ⇒ "limpar a conversa" com botão de /clear', () => {
  const r = chamar(APROVADA, [], [], { pouso: true });
  assert.deepEqual(r, [{ nivel: 'dono', motivo: 'limpar a conversa', acoes: [{ rotulo: 'limpar', comando: '/clear' }] }]);
  assert.deepEqual(chamar(APROVADA, [], [], { pouso: false }), nada);
  assert.deepEqual(chamar(APROVADA, [], [], { pouso: 'sim' as unknown as boolean }), nada, 'só `true` exato acende');
});

test('ordem-com-novos-itens: PAROU ▸ (6) ▸ (5) ▸ (1) ▸ (2) ▸ (3) ▸ (4) ▸ (7), base antes de tudo', () => {
  const r = chamar(SEM_APROVACAO, [
    nota('ideia', 'ideia nova'), nota('pendencia', 'renovar o certificado'), pr(7, 'aberto'), ...noTeto('T12'), emendaProposta(),
  ], [BASE_PARAR, BASE_PAUSA], { pouso: true });
  assert.deepEqual(motivos(r), [
    'o loop parou: decida', 'loop pausado',
    'limpar a conversa',
    'decidir a T12: chegou ao limite de revisões',
    'aprovar a spec da GM-14',
    'revisar e aceitar o pedido de revisão #7',
    'renovar o certificado',
    'decidir se a ideia vira a próxima entrega',
    'decidir a emenda 1',
  ]);
  assert.deepEqual(r.map((i) => i.nivel), ['parar', 'dono', 'dono', 'dono', 'dono', 'dono', 'dono', 'dono', 'dono']);
});

test('emenda aberta (7): decidir a emenda; base com a mesma emenda não duplica; julgada some', () => {
  const baseEmenda: ItemDepende = { nivel: 'dono', motivo: 'emenda #1 em REQ-DEP-1', acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 1' }, { rotulo: 'rejeitar', comando: '/gabarito-mestre:emenda rejeitar 1' }] };
  const r = chamar(APROVADA, [emendaProposta()], [baseEmenda]);
  assert.deepEqual(motivos(r), ['decidir a emenda 1']);
  assert.deepEqual(r[0].acoes, baseEmenda.acoes, 'os botões da E4 ficam no item novo');
  const julgada: C = { t: 'emenda.rejeitada', s: 'emendas', d: { proposta_seq: 1, origem: 'dono' } };
  assert.deepEqual(chamar(APROVADA, [emendaProposta(), julgada]), nada);
});

test('linguagem: nenhum motivo ou rótulo casa a regex técnica nem cita tipo de evento (REQ-LNG-1)', () => {
  const r = chamar(SEM_APROVACAO, [
    nota('ideia', 'ideia nova'), nota('pendencia', 'renovar o certificado'), pr(7, 'aberto'), ...noTeto('T12'), emendaProposta(),
  ], [], { pouso: true, fontes: { falhou: ['o GitHub'] } });
  assert.ok(r.length >= 8);
  for (const i of r) {
    for (const texto of [i.motivo, ...i.acoes.map((a) => a.rotulo)]) {
      assert.equal(REGEX_TECNICA.test(texto), false, `texto técnico: ${texto}`);
      assert.ok(!/spec\.aprovada|dono\.resposta|fato\.medido|no_teto|teto_rodadas/.test(texto), `nome de evento: ${texto}`);
    }
  }
  // o comando só existe em `acoes[].comando`, nunca no motivo
  assert.ok(r.every((i) => !i.motivo.includes('/gabarito')));
});

test('nome de fonte do chamador é saneado: controle e tamanho', () => {
  const r = chamar(APROVADA, [], [], { fontes: { falhou: ['o GitHub\nfalso item', 'x'.repeat(200)] } });
  assert.equal(r.length, 1);
  assert.ok(!/\n/.test(r[0].motivo));
  assert.ok(r[0].motivo.length < 160);
});

test('base fica intacta (cópia) e a entrada não é alterada', () => {
  const base = [BASE_PARAR];
  const evs = expandir([nota('pendencia', 'a'), pr(7, 'aberto')]);
  const antes = JSON.stringify([base, evs, SEM_APROVACAO]);
  const r = dependeDe(SEM_APROVACAO, evs, base, OK, true, GIT);
  assert.equal(JSON.stringify([base, evs, SEM_APROVACAO]), antes);
  r[0].acoes.push({ rotulo: 'x', comando: null });
  assert.deepEqual(base[0].acoes, [], 'mexer na saída não mexe na base');
});

test('P9: trilhaDe real ⇒ dependeDe: spec sem aprovação na branch da entrega dá o botão; depois de aprovada, some', () => {
  const A = 'a'.repeat(64);
  const SPEC = 'docs/superpowers/specs/2026-11-11-gm14-clareza-design.md';
  const fatos: FatosTrilha = {
    branch: BRANCH, idPadrao: ID_PADRAO, plano: null, ledger: false, gh: 'ok', ultimas: [], sessao: 'sessao-a',
    specs: [{ caminho: SPEC, pbi: 'GM-14', sha256: A, secoes: 6, titulo: 'Clareza' }],
  };
  const sem = expandir([nota('ideia', 'x')]);
  const t1 = trilhaDe(fatos, sem);
  assert.equal(t1.entrega, 'GM-14');
  const r1 = dependeDe(t1, sem, [], OK, false, { branch: fatos.branch, idPadrao: fatos.idPadrao });
  assert.equal(r1[0].motivo.startsWith('aprovar a spec da GM-14'), true);
  assert.equal(r1[0].acoes[0].comando, '/gabarito-mestre:aprovar');
  // aprovada no mesmo sha ⇒ some
  const com = expandir([nota('ideia', 'x'), { t: 'spec.aprovada', d: { spec: SPEC, sha256: A } }]);
  assert.deepEqual(dependeDe(trilhaDe(fatos, com), com, [], OK, false, GIT).filter((i) => /aprovar/.test(i.motivo)), []);
  // spec editada depois ⇒ versão nova
  const editada: FatosTrilha = { ...fatos, specs: [{ ...fatos.specs[0], sha256: 'b'.repeat(64) }] };
  const r3 = dependeDe(trilhaDe(editada, com), com, [], OK, false, GIT);
  assert.equal(r3[0].motivo, 'aprovar a versão nova da spec da GM-14');
  // os eventos de fixture são do diário de verdade
  for (const e of com) assert.equal(formaInvalida(e.tipo, e.dados), null);
});

test('fixtures do teste são eventos válidos do diário (forma conferida pela T1)', () => {
  const evs = expandir([nota('ideia', 'a'), nota('pendencia', 'b'), pr(7, 'aberto'), ...noTeto('T12'), emendaProposta(), feito('sessao-a:2'), { t: 'task.reaberta', d: { task: 'T12', origem: 'dono' } }]);
  for (const e of evs) assert.equal(formaInvalida(e.tipo, e.dados), null, `${e.tipo} fora da forma`);
});

/**
 * Testes de `depende.ts` (GM-14 T13, REQ-DEP-1 e Emenda 2 consolidada). Núcleo puro: trilha + eventos + base ⇒ itens do "depende de você".
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-13-mut.json):
 *  M12     pendência fecha sem `dono.resposta` (qualquer nota do modelo fecha)  ⇒ nota-feito-do-modelo-nao-fecha
 *  M-P6    "nada" mesmo com fonte que falhou                                      ⇒ nada-so-com-todas-as-fontes
 *  M-T13a  botão (1) sem conferir a branch da entrega (DP-3 aj. 3)                ⇒ botao-so-na-branch-da-entrega
 *  M-T13b  aprovação ausente e "mudou depois" duplicam o item                      ⇒ mudou-depois-e-ausente-nao-duplicam
 *  M-T13c  resposta digitada (só hash) fecha a pendência                           ⇒ resposta-que-nao-e-opcao-nao-fecha
 *  M-T13d  `liberar` montado para task em qualquer estado                          ⇒ no-teto-no-depende
 * T13b (task-13b-mut.json):
 *  M-T13b-a  `visto` fecha sem `dono.resposta` (nota do modelo basta)             ⇒ visto-fecha-so-com-dono-resposta-rotulo-visto
 *  M-T13b-b  reabre contando todas as ideias                                       ⇒ ideia-posterior-reabre-contando-so-novas
 *  M-T13b-c  aceita rótulo diferente de "visto"                                    ⇒ visto-fecha-so-com-dono-resposta-rotulo-visto
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependeDe, ideiasAbertas, pendenciaAberta, proximaEntrega } from '../src/depende.ts';
import { dependeDeVoce } from '../src/painel.ts';
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

type C = { t: TipoEvento; d: Record<string, unknown>; s?: string; a?: string };

function expandir(compactos: C[]): Evento[] {
  const seqs = new Map<string, number>();
  let min = 0;
  return compactos.map((c) => {
    const sessao = c.s ?? 'sessao-a';
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    const ts = new Date(Date.UTC(2026, 10, 11, 12, min++)).toISOString();
    return { seq, ts, autor: 'teste', sessao, agente: c.a ?? 'orquestrador', tipo: c.t, dados: c.d, hash_anterior: null } as Evento;
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

/** GM-15 T35 (r.13): nota de pendência/ideia de autoria do orquestrador não entra no DEPENDE; os testes antigos usam autoria `dono`. */
const nota = (tipo: string, texto: string, s = 'sessao-a', extra: Record<string, unknown> = {}, a = 'dono'): C => ({ t: 'nota', s, a, d: { tipo, texto, ...extra } });
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
const nada = [{ nivel: 'dono', motivo: 'nada depende de você', acoes: [] }];
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
  assert.deepEqual(r[5].acoes, [{ rotulo: 'visto', comando: '/gabarito-mestre:responder sessao-a:4 1' }], 'ideias: botão "visto" com o id da última ideia');
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

// ── correção r1 (review r1 da T13) ───────────────────────────────────────────────────────────────────────────────────────────

test('item (5) não repete o PAROU de teto da base real (MAJOR-1): 1 item por task, com o mesmo botão', () => {
  const evs = expandir([...noTeto('T12'), { t: 'loop.parar', d: { motivo: 'teto_rodadas', task: 'T12' } }]);
  const entrada = { decisaoEntrega: null, pausado: false, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: null, pacote: 'x', notificacao: null, agoraMs: Date.UTC(2026, 10, 11, 13), fuso: 'UTC', titulo: null, politica: { politica: 'pr', dias: null }, entregaId: 'GM-14', specSha: null, tetoSombra: 10 };
  const base = dependeDeVoce({ tasks: [{ id: 'T12', deps: [] }] } as never, evs, entrada as never);
  assert.ok(base.some((b) => b.acoes.some((a) => a.comando === '/gabarito-mestre:liberar T12')), 'a base traz o botão de liberar');
  const r = dependeDe(APROVADA, evs, base, OK, false, GIT);
  assert.equal(r.filter((i) => i.acoes.some((a) => a.comando === '/gabarito-mestre:liberar T12')).length, 1, 'um só item com o botão de liberar T12');
  assert.equal(r.filter((i) => /T12/.test(i.motivo)).length, 1, 'uma só decisão sobre a T12');
  // sem base trazendo o teto, o item (5) segue; outra task no teto não é coberta pela base da T12
  assert.equal(motivos(dependeDe(APROVADA, expandir([...noTeto('T12'), ...noTeto('T13')]), base, OK, false, GIT)).filter((m) => /T13/.test(m)).length, 1);
  // task de id inseguro: a base sem botão (motivo de teto) também cobre
  const baseSem: ItemDepende[] = [{ nivel: 'parar', motivo: 'teto de rodadas de review em a b', acoes: [] }];
  assert.equal(chamar(APROVADA, noTeto('a b'), baseSem).filter((i) => /limite de revisões/.test(i.motivo)).length, 0);
  assert.equal(chamar(APROVADA, noTeto('a b')).filter((i) => /limite de revisões/.test(i.motivo)).length, 1);
  const baseGenerica: ItemDepende[] = [{ nivel: 'parar', motivo: 'teto de rodadas de review em task não identificada', acoes: [] }];
  assert.equal(chamar(APROVADA, noTeto('a b'), baseGenerica).filter((i) => /limite de revisões/.test(i.motivo)).length, 0, 'id inseguro: o PAROU genérico da base cobre');
  assert.equal(chamar(APROVADA, noTeto('T12'), baseGenerica).filter((i) => /limite de revisões/.test(i.motivo)).length, 1, 'id seguro: o genérico não cobre');
  const baseSemBotao: ItemDepende[] = [{ nivel: 'parar', motivo: 'teto de rodadas de review em T12', acoes: [] }];
  assert.equal(chamar(APROVADA, noTeto('T12'), baseSemBotao).filter((i) => /limite de revisões/.test(i.motivo)).length, 0, 'id seguro: motivo exato da base, sem botão');
});

test('pendenciaAberta: regra única e cada borda decidida 1x (MAJOR-2)', () => {
  const f = (cs: C[], k = 0) => { const evs = expandir(cs); return pendenciaAberta(evs, evs[k]); };
  const pend = nota('pendencia', 'renovar o certificado');
  assert.deepEqual(f([pend]), { id: 'sessao-a:1', texto: 'renovar o certificado' });
  assert.equal(f([pend, feito('sessao-a:1')]), null, 'fecha com resposta de opção posterior ao id exato');
  assert.equal(f([feito('sessao-a:1'), pend], 1) !== null, true, 'resposta anterior à nota não fecha');
  assert.notEqual(f([pend, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', sha256: hash, chars: 5 } }]), null, 'digitada {sha256, chars} não fecha');
  assert.notEqual(f([pend, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', opcao: 1, rotulo: 'x'.repeat(200) } }]), null, 'forma inválida não fecha');
  assert.notEqual(f([pend, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', opcao: 9, rotulo: 'feito' } }]), null, 'opção fora de 1 a 4 não fecha');
  assert.notEqual(f([pend, feito('sessao-a:2')]), null, 'outro id não fecha');
  assert.equal(f([nota('pendencia', 'x'.repeat(161))]), null, 'nota de 161 caracteres não é pendência');
  assert.notEqual(f([nota('pendencia', 'x'.repeat(160))]), null, 'nota de 160 caracteres é');
  assert.equal(f([nota('ideia', 'a')]), null, 'só tipo pendência');
  assert.equal(f([nota('pendencia', 'a', 'sessao com espaço')]), null, 'id fora do formato de pergunta não é pendência');
  assert.equal(f([nota('pendencia', 'a', 'a.b')]), null, 'sessão com ponto também não');
  const evs = expandir([pend]);
  assert.equal(pendenciaAberta(evs, { ...evs[0] }), null, 'nota fora do diário dado não é aberta');
  assert.equal(pendenciaAberta(null as never, evs[0]), null);
  // o item (3) é a mesma regra: tudo acima visto pela saída
  assert.deepEqual(motivos(chamar(APROVADA, [pend, feito('sessao-a:1')])), ['nada depende de você']);
  assert.deepEqual(motivos(chamar(APROVADA, [nota('pendencia', 'a', 'a.b'), nota('pendencia', 'b', 'x y')])), ['nada depende de você']);
  assert.equal(chamar(APROVADA, [pend, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', opcao: 1, rotulo: 'x'.repeat(200) } }])[0].motivo, 'renovar o certificado');
});

test('cláusulas negativas (MAJOR-3): entrega de id inseguro, pedido de revisão sem forma, resposta inválida', () => {
  // ENTREGA_SEGURA: entrega com crase/espaço vira "desta entrega", sem o id no texto
  const estranha = trilha({ entrega: 'GM 14`x', marcas: ['✓', '✓', '●', '○', '○', '○', '○'] });
  const r = chamar(estranha, [], [], { git: { branch: 'x', idPadrao: ID_PADRAO } });
  assert.equal(r[0].motivo, 'aprovar a spec desta entrega: abra a conversa na branch da entrega para aprovar');
  assert.equal(chamar(trilha({ entrega: 'GM-14' }), [], [], { git: { branch: 'x', idPadrao: ID_PADRAO } })[0].motivo.includes('da GM-14'), true);
  // pedido de revisão: mesmo critério da trilha (número inteiro, estado texto)
  for (const v of [{ numero: '7', estado: 'aberto' }, { numero: 7.5, estado: 'aberto' }, { numero: 7, estado: 1 }, { numero: 7 }, 'x', null]) {
    assert.deepEqual(motivos(chamar(APROVADA, [{ t: 'fato.medido', d: { chave: 'pr', fonte: 'gh', valor: v } }])), ['nada depende de você'], JSON.stringify(v));
  }
  assert.deepEqual(motivos(chamar(APROVADA, [pr(7, 'aberto'), pr(7, 'mergeado')])), ['nada depende de você']);
  assert.deepEqual(motivos(chamar(APROVADA, [pr(7, 'aberto'), { t: 'fato.medido', d: { chave: 'pr', fonte: 'gh', valor: { numero: 7, estado: 1 } } }])), ['revisar e aceitar o pedido de revisão #7'], 'leitura sem estado texto não derruba o último válido');
  assert.deepEqual(motivos(chamar(trilha({ ...APROVADA, entrega: null, identificada: false }), [pr(7, 'aberto')])), ['nada depende de você']);
});

test('texto da pendência é higienizado (MINOR-2, REQ-LNG-1): nada técnico no motivo; o id do botão segue exato', () => {
  const hostis = ['rodar `npm test` --fix', 'abrir docs/plano.md e ver x.json', 'chamar node scripts/a.mjs', 'ajustar loop_parar_teto', 'ver a.b.c', '`', '--', 'rodar /clear agora'];
  const evs = hostis.map((t, i) => nota('pendencia', t, `s${i}`));
  const r = chamar(APROVADA, evs);
  assert.equal(r.length, hostis.length);
  r.forEach((i, k) => {
    assert.equal(REGEX_TECNICA.test(i.motivo), false, `motivo técnico: ${i.motivo}`);
    assert.equal(i.acoes[0].comando, `/gabarito-mestre:responder s${k}:1 1`);
  });
  assert.equal(r[5].motivo, 'uma pendência');
  assert.equal(chamar(APROVADA, [nota('pendencia', 'renovar o certificado')])[0].motivo, 'renovar o certificado', 'texto limpo passa intacto');
});

// ── ideias com botão "visto" (T13b, REQ-DEP-1 item 4, Emenda 5) ─────────────────────────────────────────────────────────────
// `abre` (sessao-a:1) é o 1º trabalho da sessão, âncora da pergunta (b): as ideias vêm depois, com id respondível (sessao-a:2, :3, …).
const abre = nota('desvio', 'abre a sessão');
const visto = (pergunta: string, rotulo = 'visto'): C => ({ t: 'dono.resposta', s: 'sessao-dono', d: { pergunta, opcao: 1, rotulo } });
const ideiasDe = (r: ItemDepende[]) => r.filter((i) => /ideia/.test(i.motivo));
const botao = (id: string) => [{ rotulo: 'visto', comando: `/gabarito-mestre:responder ${id} 1` }];

test('ideias-botao-visto-opcao-unica: o item 4 tem 1 ação "visto" para o id da última ideia', () => {
  const r = ideiasDe(chamar(APROVADA, [abre, nota('ideia', 'a'), nota('desvio', 'x'), nota('ideia', 'b')]));
  assert.equal(r.length, 1);
  assert.equal(r[0].nivel, 'dono');
  assert.equal(r[0].motivo, 'decidir se as 2 ideias viram a próxima entrega');
  assert.deepEqual(r[0].acoes, botao('sessao-a:4'));
  assert.doesNotMatch(r[0].motivo, REGEX_TECNICA, 'o texto não tem marca técnica; o comando só em acoes');
  assert.deepEqual(chamar(APROVADA, [abre, nota('ideia', 'só uma')])[0].acoes, botao('sessao-a:2'));
  assert.deepEqual(ideiasAbertas(expandir([abre, nota('ideia', 'a'), nota('ideia', 'b')])), { id: 'sessao-a:3', n: 2 });
});

test('visto-fecha-so-com-dono-resposta-rotulo-visto: nota, outro rótulo, outro id, hash e resposta anterior não fecham', () => {
  const ideia = nota('ideia', 'usar cores');
  const aberta = (evs: C[]) => ideiasDe(chamar(APROVADA, [abre, ...evs])).length === 1;
  assert.equal(aberta([ideia]), true);
  assert.equal(aberta([ideia, visto('sessao-a:2')]), false, 'dono.resposta "visto" ao id fecha');
  assert.equal(aberta([ideia, nota('desvio', 'visto'), nota('pendencia', 'visto'), nota('duvida', 'visto', 'sessao-a', { opcoes: ['visto', 'não'] })]), true, 'nota do modelo não fecha');
  assert.equal(aberta([ideia, { t: 'decisao.sombra', d: { pergunta: 'sessao-a:2', resposta: 'visto' } }]), true, 'decisão da Sombra não fecha');
  assert.equal(aberta([ideia, visto('sessao-a:2', 'feito')]), true, 'rótulo diferente de "visto" não fecha');
  assert.equal(aberta([ideia, visto('sessao-a:2', 'vistos')]), true);
  assert.equal(aberta([ideia, visto('sessao-x:1')]), true, 'resposta a outro id não fecha');
  assert.equal(aberta([ideia, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:2', sha256: hash, chars: 5 } }]), true, 'a digitada não fecha');
  assert.equal(aberta([visto('sessao-a:2'), ideia]), true, 'resposta anterior à ideia não fecha');
  // resposta que cita uma ideia AINDA NÃO escrita (id futuro) não fecha nem as anteriores, nem a que vem depois
  const futuro = ideiasDe(chamar(APROVADA, [abre, nota('ideia', 'a'), visto('sessao-a:3'), nota('ideia', 'b')]));
  assert.equal(futuro[0].motivo, 'decidir se as 2 ideias viram a próxima entrega');
  assert.equal(aberta([nota('pendencia', 'p'), ideia, visto('sessao-a:2')]), true, '"visto" a uma pendência (id que não é de ideia) não fecha as ideias');
  // sem caixa e sem espaço nas pontas (a regra de comparação de opção da T1)
  assert.equal(aberta([ideia, visto('sessao-a:2', ' Visto ')]), false);
  assert.equal(aberta([ideia, visto('sessao-a:2', 'VISTO')]), false);
});

test('ideia-posterior-reabre-contando-so-novas: 2 ideias, visto, 1 ideia ⇒ "a ideia vira" com o id da nova', () => {
  const r = ideiasDe(chamar(APROVADA, [abre, nota('ideia', 'a'), nota('ideia', 'b'), visto('sessao-a:3'), nota('ideia', 'c')]));
  assert.equal(r.length, 1);
  assert.equal(r[0].motivo, 'decidir se a ideia vira a próxima entrega');
  assert.deepEqual(r[0].acoes, botao('sessao-a:4'));
  const duas = ideiasDe(chamar(APROVADA, [abre, nota('ideia', 'a'), visto('sessao-a:2'), nota('ideia', 'b'), nota('ideia', 'c')]));
  assert.equal(duas[0].motivo, 'decidir se as 2 ideias viram a próxima entrega');
  const terceira = ideiasDe(chamar(APROVADA, [abre, nota('ideia', 'a'), visto('sessao-a:2'), nota('ideia', 'b'), visto('sessao-a:3'), nota('ideia', 'c')]));
  assert.equal(terceira[0].motivo, 'decidir se a ideia vira a próxima entrega');
  assert.deepEqual(terceira[0].acoes, botao('sessao-a:4'));
});

test('ideia-anterior-a-resposta-nao-conta: sem ideia depois do visto o item some', () => {
  assert.deepEqual(chamar(APROVADA, [abre, nota('ideia', 'a'), nota('ideia', 'b'), visto('sessao-a:3')]), nada);
  // visto ao id de uma ideia mais antiga também fecha tudo que veio ANTES da resposta (conta o que vem depois dela)
  assert.deepEqual(chamar(APROVADA, [abre, nota('ideia', 'a'), nota('ideia', 'b'), visto('sessao-a:2')]), nada);
  assert.equal(ideiasAbertas(expandir([nota('desvio', 'x')])), null);
  assert.equal(ideiasAbertas([] as Evento[]), null);
  assert.equal(ideiasAbertas(null as unknown as Evento[]), null, 'nunca lança');
});

test('ideia-com-id-irrespondivel-falha-fechada: sessão com ponto ⇒ nada de botão que o hook recusa; a 1ª nota da sessão já é respondível', () => {
  assert.equal(ideiasAbertas(expandir([nota('ideia', 'a', 'sessao.a')])), null);
  assert.deepEqual(ideiasDe(chamar(APROVADA, [nota('ideia', 'a', 'sessao.a')])), []);
  // a ideia é a 1ª nota da sessão e ainda assim tem botão (a âncora de (b) a pula; ver trilha.ts)
  assert.deepEqual(ideiasDe(chamar(APROVADA, [nota('ideia', 'a')]))[0].acoes, botao('sessao-a:1'));
  assert.deepEqual(ideiasAbertas(expandir([nota('ideia', 'a')])), { id: 'sessao-a:1', n: 1 });
});

// ---- GM-15 T35 (D-G11, D-G12) ----
import { AGORA_NAO_TETO } from '../src/pouso.ts';

test('nota-do-orquestrador-fora-do-depende (r.13): as 17 pendências e as ideias do orquestrador abertas não entram; a do dono entra (controle)', () => {
  const orq = Array.from({ length: 17 }, (_, i) => nota('pendencia', `lembrete ${i + 1} do orquestrador`, 'loop', {}, 'orquestrador'));
  const ideiasOrq = [nota('ideia', 'ideia do orquestrador', 'loop', {}, 'orquestrador')];
  assert.deepEqual(motivos(chamar(APROVADA, [...orq, ...ideiasOrq])), ['nada depende de você']);
  const comDono = chamar(APROVADA, [...orq, nota('pendencia', 'renovar o domínio', 'sessao-a')]);
  assert.deepEqual(motivos(comDono), ['renovar o domínio']);
});

test('depende-vazio-uma-linha (r.13): sem item que trave, o DEPENDE é 1 item só, a linha de situação', () => {
  const r = chamar(APROVADA, [nota('pendencia', 'lembrete', 'loop', {}, 'orquestrador'), nota('desvio', 'x')]);
  assert.equal(r.length, 1);
  assert.equal(r[0].motivo, 'nada depende de você', 'D-G12: o texto literal da emenda 16 r.13');
  assert.deepEqual(r[0].acoes, []);
});

test('clear-com-agora-nao-no-teto (r.9): o pedido de /clear traz "limpar" e "agora não (loop parado)" para o id do pouso; pedido adiado some', () => {
  const r = dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'S1:2' }, GIT);
  assert.deepEqual(r, [{ nivel: 'dono', motivo: 'limpar a conversa', acoes: [{ rotulo: 'limpar', comando: '/clear' }, { rotulo: AGORA_NAO_TETO, comando: '/gabarito-mestre:responder S1:2 agora' }] }]);
  assert.deepEqual(motivos(dependeDe(APROVADA, [], [], OK, { pendente: false, id: 'S1:2' }, GIT)), ['nada depende de você']);
  // id fora da forma: só o "limpar" (o hook recusaria o botão)
  assert.deepEqual(dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'a.b:2' }, GIT)[0].acoes, [{ rotulo: 'limpar', comando: '/clear' }]);
});

test('pendencia-adiada-nao-fecha-e-some (r.14): "agora não" à pendência do dono a tira do DEPENDE sem fechá-la (pendenciaAberta segue aberta)', () => {
  const evs = [nota('pendencia', 'renovar o domínio'), { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', rotulo: 'agora não' } } as C];
  assert.deepEqual(motivos(chamar(APROVADA, evs)), ['nada depende de você']);
  const lista = expandir(evs);
  assert.deepEqual(pendenciaAberta(lista, lista[0]), { id: 'sessao-a:1', texto: 'renovar o domínio' });
});

import { adiadas } from '../src/depende.ts';
test('opcao-agora-nao-nao-e-adiamento (review r1 MINOR-2): resposta com `opcao` cujo rótulo começa por "agora não" fecha a pendência e não entra em `adiadas`; sem `opcao` adia', () => {
  const pend = nota('pendencia', 'renovar o domínio');
  const porOpcao = expandir([pend, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', opcao: 1, rotulo: 'agora não, em dezembro' } } as C]);
  assert.deepEqual([...adiadas(porOpcao)], []);
  assert.equal(pendenciaAberta(porOpcao, porOpcao[0]), null, 'a escolha por opção fecha');
  const adiada = expandir([pend, { t: 'dono.resposta', s: 'sessao-dono', d: { pergunta: 'sessao-a:1', rotulo: 'agora não' } } as C]);
  assert.deepEqual([...adiadas(adiada)], ['sessao-a:1']);
  assert.deepEqual(pendenciaAberta(adiada, adiada[0]), { id: 'sessao-a:1', texto: 'renovar o domínio' });
});

// ── GM-15 T8 (REQ-ENT-1 d i): a próxima entrega, regra pura ──────────────────────────────────────────────────────────────────────────────
test('proxima-entrega-pura: spec sem encerramento mais nova pelo nome; id inseguro e encerrada fora; entrada torta nunca lança', () => {
  const sp = (caminho: string, pbi: string | null, titulo = 'T') => ({ caminho, pbi, titulo, sha256: '', secoes: 1 });
  const specs = [sp('docs/a/2026-01-01-x.md', 'GM-1'), sp('docs/a/2026-03-01-y.md', 'GM-3', 'Painel `x` com_tema'), sp('docs/a/2026-02-01-z.md', 'GM-2'),
    sp('docs/a/2026-04-01-w.md', 'GM 4'), sp('docs/a/2026-05-01-v.md', null)];
  assert.deepEqual(proximaEntrega(specs, new Set(), []), { tipo: 'spec', texto: 'GM-3 Painel x com tema', acoes: [{ rotulo: 'seguir', comando: '/gabarito-mestre:gabarito-loop' }] });
  assert.equal(proximaEntrega(specs, new Set(['GM-3']), []).texto, 'GM-2 T', 'a encerrada nunca é oferecida (M8b)');
  assert.doesNotMatch(proximaEntrega(specs, new Set(), []).texto, REGEX_TECNICA);
  for (const torto of [null, 7, 'x', [null, 1, { pbi: 'GM-9' }]]) assert.equal(proximaEntrega(torto, new Set(), null).tipo, 'nenhuma');
  assert.deepEqual(proximaEntrega([], new Set(), 'diario torto'), { tipo: 'nenhuma', texto: 'nenhuma próxima anotada', acoes: [] });
});

// ── GM-15 T13 (REQ-AUT-1): o lote do dono, a mesma lista no `proxima` e no DEPENDE ─────────────────────────────────────────────────────────
// Mutações: M13a omitir `next ⇒ main` no fim ⇒ lote-do-dono-unico · M13b DEPENDE com lista diferente do lote ⇒ lote-igual-no-depende
import { itemSemFonte, loteDoDono } from '../src/depende.ts';
import type { Plano } from '../src/tipos.ts';

const PLANO_LOTE: Plano = { entrega: 'GM-14', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }, { id: 'T2', deps: [], arquivos: ['b'] }, { id: 'T3', deps: [], arquivos: ['c'] }] };
const CFG_DESLIGADA = { liberaTeto: false, julgaEmendas: false, autonomiaEntrega: false, base: 'next' };
const CFG_LIGADA = { liberaTeto: true, julgaEmendas: true, autonomiaEntrega: true, base: 'next' };
const evNovo = (): C => ({ t: 'evento.do.futuro' as TipoEvento, d: { x: 1 } });
const liberacaoDono = (task: string): C => ({ t: 'task.reaberta', d: { task, origem: 'dono' } });

test('lote-do-dono-unico: no_teto sem liberação, emenda sem julga_emendas, plugin atrás do diário e next ⇒ main no fim, nessa ordem e com os comandos', () => {
  const evs = expandir([...noTeto('T2'), emendaProposta(), evNovo()]);
  const lote = loteDoDono(PLANO_LOTE, evs, CFG_DESLIGADA);
  assert.deepEqual(motivos(lote), [
    'decidir a T2: chegou ao limite de revisões', 'decidir a emenda 1', 'atualizar o plugin: o diário tem evento de uma versão mais nova', 'no fim da entrega: levar next para main',
  ]);
  assert.deepEqual(lote[0].acoes, [{ rotulo: 'liberar mais uma rodada', comando: '/gabarito-mestre:liberar T2' }]);
  assert.deepEqual(lote[1].acoes.map((a) => a.comando), ['/gabarito-mestre:emenda aprovar 1', '/gabarito-mestre:emenda rejeitar 1']);
  assert.deepEqual(lote[2].acoes, [{ rotulo: 'atualizar', comando: '/plugin' }]);
  assert.deepEqual(lote[3].acoes, []);
  for (const i of lote) assert.equal(i.nivel, 'dono');
  for (const i of lote) assert.doesNotMatch(i.motivo, REGEX_TECNICA);
});

test('lote-vazio-sem-item: sem teto, sem emenda, diário conhecido e autonomia de entrega (ou base main, ou entregue) ⇒ lote vazio e DEPENDE "nada"', () => {
  assert.deepEqual(loteDoDono(PLANO_LOTE, expandir([]), CFG_LIGADA), []);
  assert.deepEqual(loteDoDono(PLANO_LOTE, expandir([]), { ...CFG_DESLIGADA, base: 'main' }), [], 'base main: o pedido de revisão da entrega já é o item do dono');
  const encerrada: C = { t: 'entrega.encerrada', d: { entrega: 'GM-14', pr: 7, via: 'merge', mergeado_em: '2026-11-11T12:00:00Z' } };
  assert.deepEqual(loteDoDono(PLANO_LOTE, expandir([encerrada]), CFG_DESLIGADA), [], 'entregue: nada a levar');
  assert.deepEqual(loteDoDono({ entrega: 'GM-14', tasks: [] }, expandir([]), CFG_DESLIGADA), [], 'plano sem task: sem fim previsível');
  assert.deepEqual(motivos(dependeDe(APROVADA, expandir([]), [], OK, false, GIT, [])), ['nada depende de você']);
});

test('lote-teto-so-nos-freios: com libera_teto a Sombra decide (liberada antes pelo dono ou por ela não gasta nada: sem limite numérico); só flag desligada ou freio ⇒ dono (GM-15 T36, emenda 22 l.4)', () => {
  const sem = { ...CFG_LIGADA };
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, expandir(noTeto('T1')), sem)), []);
  const gasta = expandir([...noTeto('T1'), liberacaoDono('T1'), ...noTeto('T1')]);
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, gasta, sem)), [], 'o dono já liberou: a Sombra segue decidindo');
  const daSombra = expandir([...noTeto('T1'), { t: 'task.reaberta', d: { task: 'T1', origem: 'sombra', hash } }, ...noTeto('T1')]);
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, daSombra, sem)), [], 'a Sombra já liberou: sem limite numérico');
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, expandir(noTeto('T1')), { ...sem, liberaTeto: false })), ['decidir a T1: chegou ao limite de revisões']);
  // ordem do plano, não do diário
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, expandir([...noTeto('T3'), ...noTeto('T1')]), { ...sem, liberaTeto: false })),
    ['decidir a T1: chegou ao limite de revisões', 'decidir a T3: chegou ao limite de revisões']);
});

test('depende-so-em-abordagens-esgotadas: 2 liberações da Sombra com abordagem_nova e novo teto ⇒ 1 item do dono com 1 linha, com o botão de liberar; sem a 2ª abordagem ou com a do dono no meio, a regra é a do freio', () => {
  const ab = (n: string): C => ({ t: 'task.reaberta', d: { task: 'T1', origem: 'sombra', hash, abordagem_nova: n } });
  const esgotada = expandir([...noTeto('T1'), ab('A'), ...noTeto('T1'), ab('B'), ...noTeto('T1')]);
  const lote = loteDoDono(PLANO_LOTE, esgotada, CFG_LIGADA);
  assert.equal(lote.length, 1);
  assert.match(lote[0].motivo, /^decidir a T1: chegou ao limite de revisões \(2 abordagens novas da Sombra/);
  assert.doesNotMatch(lote[0].motivo, REGEX_TECNICA);
  assert.deepEqual(lote[0].acoes, [{ rotulo: 'liberar mais uma rodada', comando: '/gabarito-mestre:liberar T1' }]);
  assert.ok(!/\n/.test(lote[0].motivo));
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, expandir([...noTeto('T1'), ab('A'), ...noTeto('T1')]), CFG_LIGADA)), [], '1 abordagem não esgota');
  const comDono = expandir([...noTeto('T1'), ab('A'), ...noTeto('T1'), liberacaoDono('T1'), ...noTeto('T1'), ab('B'), ...noTeto('T1')]);
  assert.equal(loteDoDono(PLANO_LOTE, comDono, CFG_LIGADA).length, 1, 'a do dono no meio não zera');
  // flag desligada: o item sai sem o resumo do freio
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, esgotada, { ...CFG_LIGADA, liberaTeto: false })), ['decidir a T1: chegou ao limite de revisões']);
});

test('lote-emenda-so-sem-julga: com julga_emendas a Sombra julga (não é do dono); desligada ⇒ uma por proposta aberta', () => {
  assert.deepEqual(loteDoDono(PLANO_LOTE, expandir([emendaProposta()]), CFG_LIGADA), []);
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, expandir([emendaProposta(), emendaProposta()]), { ...CFG_LIGADA, julgaEmendas: false })), ['decidir a emenda 1', 'decidir a emenda 2']);
});

test('versao-plugin-atras-do-diario: tipo de evento que este plugin não conhece ⇒ 1 item só; só tipos conhecidos ⇒ nenhum', () => {
  assert.deepEqual(motivos(loteDoDono(PLANO_LOTE, expandir([evNovo(), evNovo(), emendaProposta()]), CFG_LIGADA)), ['atualizar o plugin: o diário tem evento de uma versão mais nova']);
  assert.deepEqual(loteDoDono(PLANO_LOTE, expandir([emendaProposta(), nota('ideia', 'x')]), CFG_LIGADA), []);
});

test('lote-igual-no-depende: o DEPENDE traz o lote inteiro, contíguo e na mesma ordem, sem repetir o teto da base nem a emenda; sem lote segue o de antes', () => {
  const evs = [...noTeto('T2'), emendaProposta(), evNovo()];
  const lote = loteDoDono(PLANO_LOTE, expandir(evs), CFG_DESLIGADA);
  const baseTeto: ItemDepende = { nivel: 'parar', motivo: 'teto de rodadas de review em T2', acoes: [{ rotulo: 'liberar', comando: '/gabarito-mestre:liberar T2' }] };
  const dep = dependeDe(APROVADA, expandir([...evs, nota('pendencia', 'renovar o domínio')]), [baseTeto], OK, false, GIT, lote);
  // o PAROU de teto da base já é o item do dono da T2 (mesmo botão): o resto do lote vem inteiro, contíguo e na ordem
  assert.equal(dep[0], dep.find((x) => x.motivo === baseTeto.motivo), 'o PAROU fica');
  const resto = lote.slice(1);
  const i = dep.findIndex((x) => x.motivo === resto[0].motivo);
  assert.ok(i >= 0, JSON.stringify(motivos(dep)));
  assert.deepEqual(dep.slice(i, i + resto.length), resto);
  assert.equal(dep.filter((x) => x.acoes.some((a) => a.comando === '/gabarito-mestre:liberar T2')).length, 1, 'o liberar aparece 1 vez');
  // sem o PAROU na base, o lote inteiro
  const semBase = dependeDe(APROVADA, expandir(evs), [], OK, false, GIT, lote);
  const j = semBase.findIndex((x) => x.motivo === lote[0].motivo);
  assert.deepEqual(semBase.slice(j, j + lote.length), lote);
  assert.equal(dep.filter((x) => /emenda 1/.test(x.motivo)).length, 1);
  assert.ok(motivos(dep).includes('renovar o domínio'), 'o resto do DEPENDE segue');
  // com a Sombra ligada, o lote não traz teto nem emenda, e o DEPENDE também não
  const loteLig = loteDoDono(PLANO_LOTE, expandir(evs), CFG_LIGADA);
  const depLig = dependeDe(APROVADA, expandir(evs), [], OK, false, GIT, loteLig);
  assert.ok(!depLig.some((x) => /limite de revisões|emenda/.test(x.motivo)), JSON.stringify(motivos(depLig)));
  // sem lote (o painel de antes): (5) e (7) seguem
  assert.ok(motivos(dependeDe(APROVADA, expandir(evs), [], OK, false, GIT)).includes('decidir a emenda 1'));
});

test('item-sem-fonte: a Sombra sem fonte para adiar, cortar ou reabrir vira item do dono com o comando humano; id fora da forma sai sem botão', () => {
  assert.deepEqual(itemSemFonte('adiar', 'T5'), { nivel: 'dono', motivo: 'decidir se a T5 sai do alvo (adiar): a Sombra não tem fonte', acoes: [{ rotulo: 'adiar', comando: '/gabarito-mestre:adiar T5' }] });
  assert.deepEqual(itemSemFonte('cortar', 'T5').acoes, [{ rotulo: 'cortar', comando: '/gabarito-mestre:cortar T5' }]);
  assert.deepEqual(itemSemFonte('reabrir', 'T5'), { nivel: 'dono', motivo: 'decidir se a T5 volta ao alvo: a Sombra não tem fonte', acoes: [{ rotulo: 'reabrir', comando: '/gabarito-mestre:reabrir T5' }] });
  assert.deepEqual(itemSemFonte('adiar', 'T5; rm').acoes, []);
  for (const v of ['adiar', 'cortar', 'reabrir'] as const) assert.doesNotMatch(itemSemFonte(v, 'T5').motivo, REGEX_TECNICA);
});

test('parou-de-uma-task-nao-esconde-teto-de-outra: base com PAROU de teto da T2 e lote [T2, T3] ⇒ DEPENDE mostra o PAROU da T2 e o item da T3 (review r1 MAJOR-1)', () => {
  const lote = loteDoDono(PLANO_LOTE, expandir([...noTeto('T2'), ...noTeto('T3')]), { ...CFG_DESLIGADA, autonomiaEntrega: true });
  assert.deepEqual(motivos(lote), ['decidir a T2: chegou ao limite de revisões', 'decidir a T3: chegou ao limite de revisões']);
  const baseT2: ItemDepende = { nivel: 'parar', motivo: 'teto de rodadas de review em T2', acoes: [{ rotulo: 'liberar', comando: '/gabarito-mestre:liberar T2' }] };
  const dep = dependeDe(APROVADA, expandir([...noTeto('T2'), ...noTeto('T3')]), [baseT2], OK, false, GIT, lote);
  assert.deepEqual(motivos(dep).filter((m) => /T2|T3/.test(m)), ['teto de rodadas de review em T2', 'decidir a T3: chegou ao limite de revisões']);
});

test('plugin-atras-nomeia-a-versao: o item do lote traz a versão instalada e o comando /plugin (review r1 MINOR-2)', () => {
  const evs = expandir([evNovo()]);
  const [i] = loteDoDono(PLANO_LOTE, evs, { ...CFG_LIGADA, versaoPlugin: '2.1.0-alpha.2' });
  assert.match(i.motivo, /2\.1\.0-alpha\.2/);
  assert.deepEqual(i.acoes, [{ rotulo: 'atualizar', comando: '/plugin' }]);
});

// ─────────────────────────────────────────────── GM-15 T19 (REQ-POU-3, REQ-POU-4): o DEPENDE avisa o contexto alto e o loop desligado
// Mutações: M19-a o pedido de /clear sai com o loop desligado ⇒ clear-so-com-wakeup-depende · M19-b o aviso de contexto sem o mod como quem limpa ⇒
// contexto-alto-sem-pouso-avisa-depende · M19-c "ligar o loop" sem o sinal conferido ⇒ sem-loop-dinamico-avisa-depende
import { CMD_LIGAR_LOOP, MOTIVO_LIGAR_LOOP, MOTIVO_LIGAR_ANTES_DO_CLEAR, motivoContextoAlto } from '../src/depende.ts';

test('clear-so-com-wakeup-depende (REQ-POU-4, aprendizado 185): pouso pendente com o loop desligado ⇒ nada de /clear; "ligar o loop automático antes de limpar a conversa" com o botão do /loop', () => {
  const r = dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'S1:2', loop: 'ausente' }, GIT);
  assert.deepEqual(r, [{ nivel: 'dono', motivo: MOTIVO_LIGAR_ANTES_DO_CLEAR, acoes: [{ rotulo: 'ligar o loop', comando: CMD_LIGAR_LOOP }, { rotulo: AGORA_NAO_TETO, comando: '/gabarito-mestre:responder S1:2 agora' }] }]);
  assert.ok(!JSON.stringify(r).includes('/clear'), 'nenhum botão nem texto de /clear com o loop desligado');
  assert.equal(MOTIVO_LIGAR_ANTES_DO_CLEAR, 'ligar o loop automático antes de limpar a conversa');
  assert.equal(CMD_LIGAR_LOOP, '/loop /gabarito-mestre:gabarito-loop', 'o /loop sem intervalo (dinâmico) com a tarefa de seguir o loop');
  // armado ou não conferível (sinal ausente, velho, de outra sessão: `loop` ausente ou null) ⇒ o pedido de /clear de sempre
  // (r1 MAJOR-1: a régua é a do Stop; tudo que não é `armado` — nao_conferivel, velho, sem arquivo, de outra sessão: `null` — é desligado)
  for (const loop of ['armado', undefined] as const) {
    assert.deepEqual(dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'S1:2', loop }, GIT)[0].acoes[0], { rotulo: 'limpar', comando: '/clear' }, String(loop));
  }
  const nc = dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'S1:2', loop: null }, GIT);
  assert.deepEqual(motivos(nc), [MOTIVO_LIGAR_ANTES_DO_CLEAR], 'sinal não conferível = desligado');
  assert.ok(!JSON.stringify(nc).includes('/clear'), 'nunca /clear sem o sinal armado');
  // REQ-LNG-1: o texto não leva comando
  assert.doesNotMatch(r[0].motivo, REGEX_TECNICA);
});

test('contexto-alto-sem-pouso-avisa-depende (REQ-POU-3): contexto em X ou acima sem pouso desta sessão ⇒ "limpar a conversa", dito que quem limpa é o mod, sem botão de /clear', () => {
  const r = dependeDe(APROVADA, [], [], OK, { pendente: false, id: null, contexto: { percent: 62.4, x: 50 } }, GIT);
  assert.deepEqual(r, [{ nivel: 'dono', motivo: 'limpar a conversa: contexto em 62 % (teto 50 %); quem limpa é o mod, não o agente', acoes: [] }]);
  assert.equal(motivoContextoAlto(62.4, 50), r[0].motivo);
  assert.doesNotMatch(r[0].motivo, REGEX_TECNICA);
  // com o pedido de /clear (o pouso já feito) o aviso de contexto não repete
  assert.deepEqual(motivos(dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'S1:2', contexto: { percent: 62, x: 50 } }, GIT)), ['limpar a conversa']);
  // fora da forma ⇒ nada
  for (const contexto of [{ percent: Number.NaN, x: 50 }, { percent: 60, x: 0 }, null, 'alto']) {
    assert.deepEqual(dependeDe(APROVADA, [], [], OK, { pendente: false, id: null, contexto } as never, GIT), nada, JSON.stringify(contexto));
  }
});

test('sem-loop-dinamico-avisa-depende (REQ-POU-4): o painel decidiu que falta o loop ⇒ "ligar o loop automático" com o botão; sem a decisão, nada', () => {
  const r = dependeDe(APROVADA, [], [], OK, { pendente: false, id: null, ligarLoop: true }, GIT);
  assert.deepEqual(r, [{ nivel: 'dono', motivo: MOTIVO_LIGAR_LOOP, acoes: [{ rotulo: 'ligar o loop', comando: CMD_LIGAR_LOOP }] }]);
  assert.equal(MOTIVO_LIGAR_LOOP, 'ligar o loop automático: sem ele nada retoma o trabalho depois do pouso');
  assert.doesNotMatch(r[0].motivo, REGEX_TECNICA);
  assert.deepEqual(dependeDe(APROVADA, [], [], OK, { pendente: false, id: null, ligarLoop: 'sim' } as never, GIT), nada, 'só true exato');
  // não conferível (`loop: null`) também falta o loop
  assert.deepEqual(motivos(dependeDe(APROVADA, [], [], OK, { pendente: false, id: null, loop: null, ligarLoop: true }, GIT)), [MOTIVO_LIGAR_LOOP]);
  // com o pedido de /clear e o loop desligado o item é 1 só (o de antes do /clear)
  assert.deepEqual(motivos(dependeDe(APROVADA, [], [], OK, { pendente: true, id: 'S1:2', loop: 'ausente', ligarLoop: true }, GIT)), [MOTIVO_LIGAR_ANTES_DO_CLEAR]);
});

/**
 * Testes de `trilha.ts` (GM-14 T3, REQ-TRI-1 e FIEL-1 b). Núcleo puro: fatos + eventos ⇒ trilha.
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-3-mut.json):
 *  M1     sha não comparado (mudouDepois sempre falso)        ⇒ spec-editada-apos-aprovar-check-e-mudou-depois
 *  M11    aprovação regride com sha novo                       ⇒ spec-editada-apos-aprovar-check-e-mudou-depois
 *  M19    pasta da entrega (diário com evento) conta como 2º fato ⇒ anotar-entrega-x-sem-outro-fato-nao-identificada
 *  M-T3a  1º PR mergeado basta                                 ⇒ pr-14-mergeado-15-aberto-bolinha
 *  M-T3b  `gh` falho vira `○`                                  ⇒ gh-falho-pr-interrogacao
 *  M-F1b  PR mergeado identifica pela branch                   ⇒ entrega-publicada-nao-identifica-pela-branch
 *  M-T3c  depois de fase sem fonte, inferência continua        ⇒ s3b-celulas
 *  M-T3d  resposta de (c) vale mesmo antes de a spec nova entrar ⇒ resposta-c-consumida
 *  M-T3f  qualquer resposta com rótulo de ID liga (outra pergunta, outra sessão) ⇒ resposta-liga-sessao
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ancoraDaPerguntaB, ancoraDaPerguntaC, FASES, idDaBranch, planoAberto, tasksAbertas, trilhaDe } from '../src/trilha.ts';
import type { FatosTrilha, SpecFato, Trilha } from '../src/trilha.ts';
import { formaInvalida } from '../src/formas.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const FIX = new URL('./fixtures/trilha/', import.meta.url);
const ler = (nome: string) => JSON.parse(readFileSync(new URL(nome, FIX), 'utf8'));
/** Literal das Global Constraints do plano (REQ-LNG-1). */
const REGEX_TECNICA = /[`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b/;

type Compacto = { t: TipoEvento; d: Record<string, unknown>; s?: string } | { integradas: string[] };

/** Expande eventos compactos em `Evento` com `seq` por sessão e `ts` crescente; `integradas` vira o ciclo completo de cada task. */
function expandir(compactos: Compacto[]): Evento[] {
  const seqs = new Map<string, number>();
  const saida: Evento[] = [];
  let min = 0;
  const push = (tipo: TipoEvento, dados: Record<string, unknown>, sessao = 'sessao-a') => {
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    const ts = new Date(Date.UTC(2026, 10, 1, 0, min++)).toISOString();
    saida.push({ seq, ts, autor: 'teste', sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null });
  };
  for (const c of compactos) {
    if ('integradas' in c) {
      for (const task of c.integradas) {
        push('task.iniciada', { task, papel: 'implementador' });
        push('task.concluida', { task });
        push('task.iniciada', { task, papel: 'revisor' });
        push('review.veredito', { task, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 });
        push('task.integrada', { task });
      }
    } else push(c.t, c.d, c.s);
  }
  return saida;
}

const marcas = (t: Trilha) => t.marcas.join('');
const SPEC = 'docs/superpowers/specs/2026-11-20-gm20-design.md';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const specFato = (extra: Partial<SpecFato> = {}): SpecFato => ({ caminho: SPEC, pbi: 'GM-20', sha256: A, secoes: 6, titulo: 'Trilha da GM-20', ...extra });
const fatos = (extra: Partial<FatosTrilha> = {}): FatosTrilha => ({
  branch: 'feat/GM-20-trilha', idPadrao: '[A-Z]+-\\d+', specs: [specFato()], plano: null, ledger: false, gh: 'ok', ultimas: [], sessao: 'sessao-b', ...extra,
});
const aprovada = (sha256 = A, spec = SPEC): Compacto => ({ t: 'spec.aprovada', d: { spec, sha256 } });
const pr = (numero: number, estado: string): Compacto => ({ t: 'fato.medido', d: { chave: 'pr', fonte: 'gh', valor: { numero, estado, branch: 'feat/GM-20-trilha' } } });
const resposta = (rotulo: string, sessao = 'sessao-b', pergunta = `${sessao}:1`): Compacto => ({ t: 'dono.resposta', s: sessao, d: { pergunta, opcao: 1, rotulo } });
/** Resposta à pergunta (c) com as 2 specs de `base` (SPEC e a 2ª, ambas na `sessao-a`): a âncora é a 2ª entrada, `sessao-a:2`. */
const respostaC = (rotulo: string): Compacto => resposta(rotulo, 'sessao-b', 'sessao-a:2');
/** Âncora da pergunta (b) da sessão (DP-2 ajuste 1): o 1º evento de trabalho dela (aqui, `fato.medido branch`). */
const ancoraB = (sessao = 'sessao-b'): Compacto => ({ t: 'fato.medido', s: sessao, d: { chave: 'branch', fonte: 'git', valor: { nome: 'main' } } });
/** Âncora + resposta à pergunta (b) da sessão (`<sessao>:1` = a âncora). */
const respostaB = (rotulo: string, sessao = 'sessao-b'): Compacto[] => [ancoraB(sessao), resposta(rotulo, sessao)];
const specMedida = (caminho: string): Compacto => ({ t: 'fato.medido', d: { chave: 'spec', fonte: 'arquivo', valor: { caminho, sha256: A, secoes: 3 } } });

function confereFixture(nome: string, f: { fatos: FatosTrilha; eventos: Compacto[]; esperado: Record<string, unknown> }) {
  const evs = expandir(f.eventos);
  for (const e of evs) assert.equal(formaInvalida(e.tipo, e.dados), null, `${nome}: evento ${e.tipo} fora da forma do diário`);
  const t = trilhaDe(f.fatos, evs);
  const esp = f.esperado;
  assert.equal(marcas(t), esp.marcas, `${nome}: marcas`);
  assert.equal(t.marcas.length, 7, `${nome}: 7 marcas`);
  assert.equal(t.motivos.length, 7, `${nome}: 7 motivos`);
  assert.deepEqual(t.motivos, Array(7).fill(null), `${nome}: sem motivo`);
  assert.equal(t.identificada, esp.identificada, `${nome}: identificada`);
  assert.equal(t.entrega, esp.entrega, `${nome}: entrega`);
  assert.equal(t.candidato, esp.candidato, `${nome}: candidato`);
  assert.equal(t.fase, esp.fase, `${nome}: fase`);
  assert.equal(t.progresso, esp.progresso, `${nome}: progresso`);
  assert.equal(t.mudouDepois, esp.mudouDepois, `${nome}: mudouDepois`);
  assert.equal(t.ultimaConhecida, esp.ultimaConhecida, `${nome}: ultimaConhecida`);
  assert.deepEqual(t.ambigua, [], `${nome}: ambigua`);
}

for (let n = 1; n <= 7; n++) {
  test(`fase-${n}-fixture`, () => confereFixture(`fase-${n}`, ler(`fase-${n}.json`)));
}

test('fases-sao-as-7-da-spec', () => {
  assert.deepEqual([...FASES], ['ideia', 'spec', 'aprovacao', 'plano', 'execucao', 'pr', 'uso']);
});

test('gh-falho-pr-interrogacao', () => {
  const f = ler('fase-6.json');
  const ok = trilhaDe(f.fatos, expandir(f.eventos));
  assert.equal(marcas(ok), '✓✓✓✓✓●○', 'troca de valor: gh ok ⇒ ●');
  const t = trilhaDe({ ...f.fatos, gh: 'falhou' }, expandir(f.eventos));
  assert.equal(marcas(t), '✓✓✓✓✓??', 'PR `?` e nada depois inferido');
  assert.equal(t.motivos[5], 'não consegui conferir o pedido de revisão');
  assert.equal(t.motivos[6], 'não consegui conferir o uso');
  assert.deepEqual(t.motivos.slice(0, 5), [null, null, null, null, null]);
  assert.equal(t.fase, null, 'sem ● não há fase atual');
  assert.equal(t.identificada, true);
  // Fato antigo de PR mergeado não vence a fonte que falhou agora.
  const merg = trilhaDe({ ...f.fatos, gh: 'falhou' }, expandir([...f.eventos, pr(20, 'mergeado')]));
  assert.equal(merg.marcas[5], '?');
  assert.notEqual(merg.marcas[5], '○');
});

test('gh-falho-identifica-pela-branch-com-aviso', () => {
  const f = ler('fase-7.json');
  const semDono = f.eventos.filter((e: Compacto) => !('t' in e && e.t === 'dono.resposta'));
  const t = trilhaDe({ ...f.fatos, gh: 'falhou' }, expandir(semDono));
  assert.equal(t.identificada, true);
  assert.equal(t.entrega, 'GM-20');
  assert.equal(t.marcas[5], '?');
  assert.equal(t.motivos[5], 'não consegui conferir o pedido de revisão');
  // Troca de valor: com gh ok o PR aceito desidentifica (FIEL-1 b).
  const ok = trilhaDe(f.fatos, expandir(semDono));
  assert.equal(ok.identificada, false);
});

test('entrega-publicada-nao-identifica-pela-branch', () => {
  const cel = ler('s3b-celulas.json').celulas.filter((c: { celula: string; variante: string }) => c.celula === 'GM-13 10/11' && c.variante === 'branch')[0];
  const t = trilhaDe(cel.fatos, expandir(cel.eventos));
  assert.equal(t.identificada, false);
  assert.equal(t.entrega, null);
  assert.equal(t.candidato, 'GM-13', 'a pergunta (b) usa o candidato: "Esta conversa é da entrega GM-13?"');
  assert.equal(marcas(t), '●○○○○○○');
  assert.equal(t.fase, 1);
  // Troca de valor: com um PR aberto da entrega, a branch identifica.
  const aberto = trilhaDe(cel.fatos, expandir([...cel.eventos, { t: 'fato.medido', d: { chave: 'pr', fonte: 'gh', valor: { numero: 15, estado: 'aberto', branch: 'enabler/GM-13-virada' } } }]));
  assert.equal(aberto.identificada, true);
  assert.equal(aberto.entrega, 'GM-13');
  // Fechado (sem merge) como último PR também não é "publicada": identifica.
  const fechado = trilhaDe(cel.fatos, expandir([...cel.eventos, { t: 'fato.medido', d: { chave: 'pr', fonte: 'gh', valor: { numero: 15, estado: 'fechado', branch: 'enabler/GM-13-virada' } } }]));
  assert.equal(fechado.identificada, true);
  assert.equal(fechado.marcas[5], '●');
});

test('duas-specs-ambigua', () => {
  const s2 = specFato({ caminho: 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md', sha256: B, secoes: 9, titulo: 'Trilha da GM-20 v2' });
  const outra = specFato({ caminho: 'docs/superpowers/specs/x.md', pbi: 'GM-21', titulo: 'outra' });
  const t = trilhaDe(fatos({ specs: [specFato(), s2, outra] }), []);
  assert.equal(t.identificada, true, 'spec com PBI é 2º fato, mesmo ambígua');
  assert.deepEqual(t.ambigua.map((s) => s.caminho), [SPEC, s2.caminho], 'só as specs da entrega');
  assert.equal(t.marcas[1], '?');
  assert.equal(t.motivos[1], 'achei mais de uma spec desta entrega');
  assert.equal(marcas(t), '✓?○○○○○', 'a fase atual é a dúvida: sem ●, e ela não propaga `?`');
  assert.equal(t.fase, null);
  // Troca de valor: 1 spec da entrega ⇒ sem ambiguidade.
  const uma = trilhaDe(fatos({ specs: [specFato(), outra] }), []);
  assert.deepEqual(uma.ambigua, []);
  assert.equal(uma.marcas[1], '✓');
});

test('resposta-c-consumida', () => {
  const s2 = specFato({ caminho: 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md', sha256: B, secoes: 9, titulo: 'Trilha da GM-20 v2' });
  const f = fatos({ specs: [specFato(), s2] });
  const base: Compacto[] = [specMedida(SPEC), specMedida(s2.caminho)];
  // Título, em caixa mista e com espaço nas pontas, escolhe a v2.
  const t = trilhaDe(f, expandir([...base, respostaC('  trilha da gm-20 V2 ')]));
  assert.deepEqual(t.ambigua, []);
  assert.equal(t.marcas[1], '✓');
  assert.equal(t.motivos[1], null);
  assert.equal(t.progresso, 'spec com 9 seções · falta aprovar', 'a spec escolhida é "a spec"');
  // Caminho também escolhe; a aprovação da escolhida conta e a da outra não.
  const pc = trilhaDe(f, expandir([...base, respostaC(SPEC), aprovada(A, s2.caminho)]));
  assert.equal(pc.progresso, 'spec com 6 seções · falta aprovar');
  assert.equal(pc.marcas[2], '●');
  // Rótulo que não é de nenhuma das specs não fecha.
  const nada = trilhaDe(f, expandir([...base, respostaC('conversa avulsa')]));
  assert.equal(nada.ambigua.length, 2);
  assert.equal(nada.marcas[1], '?');
  // Conjunto mudou depois da resposta (3ª spec entrou): a resposta perde a validade.
  const s3 = specFato({ caminho: 'docs/superpowers/specs/2026-11-22-gm20-v3-design.md', titulo: 'Trilha v3' });
  const mudou = trilhaDe(fatos({ specs: [specFato(), s2, s3] }), expandir([...base, respostaC('Trilha da GM-20 v2'), specMedida(s3.caminho)]));
  assert.equal(mudou.ambigua.length, 3);
  assert.equal(mudou.marcas[1], '?');
  // Edição de uma spec já conhecida (mesmo caminho) não reabre.
  const editada = trilhaDe(f, expandir([...base, respostaC('Trilha da GM-20 v2'), specMedida(SPEC)]));
  assert.deepEqual(editada.ambigua, []);
});

test('resposta-c-so-vale-para-a-pergunta-c', () => {
  // Resposta à pergunta de outro id (ex.: (d) com nomes de spec) não escolhe a spec, mesmo com rótulo que casa com exatamente 1.
  const s2 = specFato({ caminho: 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md', sha256: B, secoes: 9, titulo: 'Trilha da GM-20 v2' });
  const f = fatos({ specs: [specFato(), s2] });
  const base: Compacto[] = [specMedida(SPEC), specMedida(s2.caminho)];
  for (const pergunta of ['sessao-a:3', 'sessao-a:1', 'sessao-b:1', 'sessao-a:2 ']) {
    const t = trilhaDe(f, expandir([...base, resposta('Trilha da GM-20 v2', 'sessao-b', pergunta)]));
    assert.equal(t.ambigua.length, 2, `pergunta ${pergunta}`);
    assert.equal(t.marcas[1], '?');
  }
  assert.deepEqual(trilhaDe(f, expandir([...base, respostaC('Trilha da GM-20 v2')])).ambigua, [], 'a âncora certa resolve');
});

test('ancora-c-regra-unica', () => {
  const s = [SPEC, 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md'];
  const evs = expandir([specMedida(s[0]), { t: 'nota', d: { tipo: 'ideia', texto: 'x' } }, specMedida(s[1]), specMedida(s[0])]);
  assert.equal(ancoraDaPerguntaC(evs, s), 'sessao-a:3', '1ª entrada do caminho que completou o conjunto');
  assert.equal(ancoraDaPerguntaC(evs, ['./' + s[0], s[1]]), 'sessao-a:3', 'ignora ./');
  assert.equal(ancoraDaPerguntaC(evs, [s[0], 'docs/x.md']), null, 'sem medição de todos ⇒ null');
  assert.equal(ancoraDaPerguntaC([], s), null);
});

test('spec-editada-apos-aprovar-check-e-mudou-depois', () => {
  const evs = expandir([aprovada(A)]);
  const t = trilhaDe(fatos({ specs: [specFato({ sha256: B })] }), evs);
  assert.equal(marcas(t), '✓✓✓●○○○', 'aprovação não regride');
  assert.equal(t.mudouDepois, true);
  assert.doesNotMatch(t.progresso, /mudou/);
  assert.equal(t.progresso, 'spec com 6 seções');
  // Troca de valor: sha igual ⇒ não mudou.
  assert.equal(trilhaDe(fatos(), evs).mudouDepois, false);
  // Reaprovada com o sha novo ⇒ não mudou; a mais recente vale.
  assert.equal(trilhaDe(fatos({ specs: [specFato({ sha256: B })] }), expandir([aprovada(A), aprovada(B)])).mudouDepois, false);
  assert.equal(trilhaDe(fatos(), expandir([aprovada(A), aprovada(B)])).mudouDepois, true, 'voltou ao conteúdo antigo depois da 2ª aprovação');
});

test('mudou-depois-segue-a-cadeia: aprovada A + emenda aplicada A⇒B: o sha B não mudou depois; o sha fora da cadeia mudou (T54, emenda 54)', () => {
  const prop: Compacto = { t: 'emenda.proposta', s: 'emendas', d: { req: 'REQ-DIA-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio' } } as never;
  const julg: Compacto = { t: 'spec.emendada', s: 'dono', d: { proposta_seq: 1, origem: 'dono' } } as never;
  const aplic: Compacto = { t: 'spec.aplicada', d: { seq: 1, spec: SPEC, sha256_antes: A, sha256_depois: B } } as never;
  const evs = expandir([aprovada(A), prop, julg, aplic]);
  assert.equal(trilhaDe(fatos({ specs: [specFato({ sha256: B })] }), evs).mudouDepois, false);
  assert.equal(trilhaDe(fatos({ specs: [specFato({ sha256: 'c'.repeat(64) })] }), evs).mudouDepois, true, 'edição fora da emenda aplicada');
  assert.equal(trilhaDe(fatos(), evs).mudouDepois, true, 'o sha A deixou de ser o aceito');
  assert.equal(trilhaDe(fatos({ specs: [specFato({ sha256: B })] }), expandir([aprovada(A), prop, aplic])).mudouDepois, true, 'aplicada sem julgamento não vale');
});

test('pr-14-mergeado-15-aberto-bolinha', () => {
  const f = ler('fase-6.json');
  const ate = f.eventos.slice(0, 2);
  const t = trilhaDe(f.fatos, expandir([...ate, pr(15, 'aberto'), pr(14, 'aberto'), pr(14, 'mergeado')]));
  assert.equal(t.marcas[5], '●', 'o último PR (maior número) está aberto');
  assert.equal(t.progresso, 'pedido de revisão #15 aberto');
  assert.equal(t.identificada, true);
  // Troca de valor: #15 mergeado também ⇒ PR ✓ (e a branch sozinha não identifica mais).
  const ambos = trilhaDe({ ...f.fatos, sessao: 'sessao-b' }, expandir([...ate, pr(15, 'aberto'), pr(14, 'aberto'), pr(14, 'mergeado'), pr(15, 'mergeado'), ...respostaB('GM-20')]));
  assert.equal(ambos.marcas[5], '✓');
  assert.equal(ambos.progresso, 'pedido de revisão #15 aceito · aguardando publicação');
  // Último mergeado mas outro aberto ⇒ não é ✓.
  const outroAberto = trilhaDe(f.fatos, expandir([...ate, pr(13, 'aberto'), pr(14, 'mergeado')]));
  assert.equal(outroAberto.marcas[5], '●');
  assert.equal(outroAberto.progresso, 'pedido de revisão #13 aberto');
});

test('afterclick-sem-segundo-fato-nao-identificada', () => {
  const idPadrao = '^[0-9a-z]{9,11}$';
  assert.equal(idDaBranch('feat/afterclick-x', idPadrao), 'afterclick');
  const t = trilhaDe(fatos({ branch: 'feat/afterclick-x', idPadrao, specs: [] }), []);
  assert.equal(t.candidato, 'afterclick');
  assert.equal(t.identificada, false);
  assert.equal(t.entrega, null);
  // Troca de valor: com plano.json (2º fato) identifica.
  const comPlano = trilhaDe(fatos({ branch: 'feat/afterclick-x', idPadrao, specs: [], plano: { tasks: ['T1'] } }), []);
  assert.equal(comPlano.identificada, true);
  assert.equal(comPlano.entrega, 'afterclick');
});

test('anotar-entrega-x-sem-outro-fato-nao-identificada', () => {
  // `anotar --entrega GM-20` criou a pasta e o diário com uma nota: nenhum dos dois é 2º fato.
  const evs = expandir([{ t: 'nota', d: { tipo: 'ideia', texto: 'algo' } }, { t: 'nota', d: { tipo: 'desvio', texto: 'outro' } }]);
  const t = trilhaDe(fatos({ specs: [] }), evs);
  assert.equal(t.identificada, false);
  assert.equal(t.candidato, 'GM-20');
  assert.equal(t.progresso, '1 ideia anotada');
  // Spec de outra entrega também não é 2º fato.
  assert.equal(trilhaDe(fatos({ specs: [specFato({ pbi: 'GM-21' })] }), evs).identificada, false);
  // Troca de valor: ledger da entrega é 2º fato.
  assert.equal(trilhaDe(fatos({ specs: [], ledger: true }), evs).identificada, true);
});

test('aprovacao-sem-evento-interrogacao', () => {
  const t = trilhaDe(fatos({ plano: { tasks: ['T1'] } }), []);
  assert.equal(marcas(t), '✓✓?✓●○○');
  assert.equal(t.motivos[2], 'não achei o registro da aprovação');
  assert.deepEqual(t.motivos.filter((m) => m !== null), ['não achei o registro da aprovação'], 'não propaga');
  // Aprovação de outro arquivo (plano.spec diferente da aprovada) não vale (DP-3 ajuste 5).
  assert.equal(trilhaDe(fatos({ plano: { tasks: ['T1'] } }), expandir([aprovada(A, 'docs/superpowers/specs/outra.md')])).marcas[2], '?');
  // Troca de valor: com o evento, ✓.
  assert.equal(trilhaDe(fatos({ plano: { tasks: ['T1'] } }), expandir([aprovada()])).marcas[2], '✓');
  assert.equal(trilhaDe(fatos({ plano: { tasks: ['T1'] } }), expandir([aprovada(A, `./${SPEC}`)])).marcas[2], '✓', 'caminho com ./ é o mesmo arquivo');
  // Sem fato depois, aprovação pendente é ●, não `?`.
  assert.equal(trilhaDe(fatos(), []).marcas[2], '●');
});

test('execucao-com-task-invalida (GM-15 T25, MAJOR-2): reabertura de origem inválida em T2 afeta só T2; T1 integrada é contada e a execução não vira "?"', () => {
  const t = trilhaDe(fatos({ plano: { tasks: ['T1', 'T2'] } }), expandir([{ integradas: ['T1'] }, { t: 'task.iniciada', d: { task: 'T2', papel: 'implementador' } }, { t: 'task.reaberta', d: { task: 'T2', origem: 'xpto' } }]));
  assert.equal(t.progresso, '1 de 2 tasks integradas');
  assert.notEqual(t.motivos[4], 'não consegui conferir a execução');
  // controle: outro defeito do ciclo segue sendo "?"
  const x = trilhaDe(fatos({ plano: { tasks: ['T1', 'T2'] } }), expandir([{ t: 'task.integrada', d: { task: 'T1' } }]));
  assert.equal(x.motivos[4], 'não consegui conferir a execução');
});

test('interrogacao-nao-vira-barra', () => {
  const t = trilhaDe(fatos({ plano: { tasks: ['T1', 'T2'] } }), expandir([{ integradas: ['T1'] }]));
  assert.equal(marcas(t), '✓✓?✓●○○');
  assert.equal(t.marcas.filter((m) => m === '✓').length, 3, '`?` não conta como feito');
  assert.equal(t.fase, 5, 'fase = posição do ●');
  assert.equal(t.progresso, '1 de 2 tasks integradas');
});

test('s3b-celulas', () => {
  const { celulas } = ler('s3b-celulas.json');
  assert.equal(new Set(celulas.map((c: { celula: string }) => c.celula)).size, 9, '8 células do S3b + a intradia das 13h');
  let erradas = 0;
  let interrog = 0;
  for (const c of celulas) {
    const evs = expandir(c.eventos);
    for (const e of evs) assert.equal(formaInvalida(e.tipo, e.dados), null, `${c.celula}: ${e.tipo}`);
    const t = trilhaDe(c.fatos, evs);
    const rotulo = `${c.celula} (${c.variante})`;
    if (c.esperado === null) {
      assert.equal(t.identificada, false, `${rotulo}: pergunta, não fase`);
      continue;
    }
    assert.equal(t.identificada, true, rotulo);
    assert.equal(marcas(t), c.esperado, rotulo);
    t.marcas.forEach((m, i) => {
      if (m === '?') return interrog++;
      const real = i < c.real ? '✓' : i === c.real ? '●' : '○';
      if (m !== real) erradas++;
    });
  }
  assert.equal(erradas, 0, '0 fase errada (plano B do S3b)');
  assert.equal(interrog, 12, '12 `?`, como medido (só nas células do Sherlock)');
});

test('sem-entrega-ultima-conhecida', () => {
  const ultimas = [{ id: 'GM-18', data: '2026-11-15T10:00:00Z' }, { id: 'GM-19', data: '2026-11-18T10:00:00Z' }, { id: 'GM-17', data: '2026-11-01T10:00:00Z' }];
  for (const branch of ['main', null, 'feat/sem-id']) {
    const t = trilhaDe(fatos({ branch, ultimas }), []);
    assert.equal(t.identificada, false, String(branch));
    assert.equal(t.entrega, null);
    assert.equal(t.candidato, null);
    assert.equal(t.ultimaConhecida, 'GM-19', 'a mais recente, não a 1ª da lista');
  }
  assert.equal(trilhaDe(fatos({ branch: 'main', ultimas: [] }), []).ultimaConhecida, null);
  // Identificada ⇒ sem "última conhecida".
  assert.equal(trilhaDe(fatos({ ultimas }), []).ultimaConhecida, null);
});

test('trilha-diario-ausente-x-corrompido', () => {
  const f = fatos({ plano: { tasks: ['T1'] } });
  const ausente = trilhaDe(f, []);
  assert.equal(marcas(ausente), '✓✓?✓●○○', 'ausente: sem evento, só os fatos do repo');
  assert.equal(ausente.motivos[2], 'não achei o registro da aprovação');
  const evs = expandir([aprovada()]);
  const corrompido = trilhaDe(f, [...evs, { ...evs[0] }]); // seq repetido na sessão: não ordena
  assert.equal(marcas(corrompido), '✓✓?✓???');
  assert.equal(corrompido.motivos[2], 'não consegui conferir a aprovação');
  assert.equal(corrompido.motivos[4], 'não consegui conferir a execução');
  assert.equal(corrompido.identificada, true, 'branch + plano ainda identificam');
  // Ciclo de task impossível (integrada sem aprovação) ⇒ execução `?`, não ●.
  const invalido = trilhaDe(f, expandir([aprovada(), { t: 'task.integrada', d: { task: 'T1' } }]));
  assert.equal(invalido.marcas[4], '?');
  assert.equal(invalido.motivos[4], 'não consegui conferir a execução');
  // Corrompido não liga sessão por resposta.
  const r = expandir(respostaB('GM-21'));
  assert.equal(trilhaDe(fatos({ branch: 'main' }), [...r, { ...r[0] }]).identificada, false);
});

test('id-da-branch', () => {
  const p = '[A-Z]+-\\d+';
  assert.equal(idDaBranch('enabler/GM-14-clareza', p), 'GM-14', 'idPadrao do config sem âncora (guarda.ts:28)');
  assert.equal(idDaBranch('enabler/GM-14-clareza', '^[A-Z]+-\\d+$'), 'GM-14', 'ancorado (versionamento-check.mjs:39)');
  assert.equal(idDaBranch('GM-14', p), 'GM-14');
  assert.equal(idDaBranch('a/b/GM-7-x-y', p), 'GM-7', 'último segmento');
  assert.equal(idDaBranch('GM-7/feat-x', p), null, 'só o último segmento');
  assert.equal(idDaBranch('feat/xGM-14-a', p), null, 'ancorado: não pega no meio do token');
  assert.equal(idDaBranch('feat/gm-14-a', p), null, 'minúscula não casa padrão maiúsculo');
  assert.equal(idDaBranch('feat/Gm-14-a', p), null, 'caixa mista');
  assert.equal(idDaBranch('feat/abc', '^[a-z]+$'), 'abc', '1 token');
  assert.equal(idDaBranch('feat/abc-def', '[a-z]+(-[a-z]+)?'), 'abc', 'o 1º candidato (1 token) vence');
  assert.equal(idDaBranch('feat/ab-12-x', '[a-z]+-\\d+|zz'), 'ab-12', 'alternância fica dentro da âncora');
  assert.equal(idDaBranch(null, p), null);
  assert.equal(idDaBranch('main', p), null);
  assert.equal(idDaBranch('main', '^[a-z]{4}$'), null, 'main nunca é entrega');
  assert.equal(idDaBranch('feat/', '.*'), null, 'token vazio');
  assert.equal(idDaBranch('', '.*'), null);
  assert.equal(idDaBranch('feat/GM-14-x', '('), null, 'regex inválida não lança');
  assert.equal(idDaBranch('feat/GM-14-x', 42 as unknown as string), null);
});

test('fato-duplicado-idempotente', () => {
  // Duas sessões medindo juntas gravam o mesmo fato: a trilha é a mesma.
  const f = ler('fase-6.json');
  const um = trilhaDe(f.fatos, expandir(f.eventos));
  const dois = trilhaDe(f.fatos, expandir([...f.eventos, { ...f.eventos[2], s: 'sessao-c' }, aprovada(), aprovada()]));
  assert.deepEqual(dois, um);
});

test('resposta-liga-sessao', () => {
  const t = trilhaDe(fatos({ branch: 'main', specs: [] }), expandir(respostaB('GM-21')));
  assert.equal(t.identificada, true);
  assert.equal(t.entrega, 'GM-21');
  // Branch sem o ID da entrega: plano e PR sem fonte ⇒ `?`, nada inferido depois.
  assert.equal(marcas(t), '✓●○????');
  assert.equal(t.motivos[3], 'não consegui conferir o plano');
  assert.equal(t.motivos[5], 'não consegui conferir o pedido de revisão');
  // Resposta vence a branch.
  assert.equal(trilhaDe(fatos({ ledger: true }), expandir(respostaB('GM-21'))).entrega, 'GM-21');
  // Rótulo que não é ID (caixa trocada, opção avulsa) não liga.
  for (const r of ['gm-21', 'Gm-21', 'conversa avulsa', 'GM-21 ']) {
    assert.equal(trilhaDe(fatos({ branch: 'main' }), expandir(respostaB(r))).identificada, false, r);
  }
  // T14 r1 (MAJOR 1, Sombra P1): a 1ª resposta à pergunta (b) da sessão vale (antes: a mais recente); ela decide (rótulo avulso 1º desfaz).
  const s = 'sessao-b';
  const resp = (rotulo: string, pergunta = `${s}:1`, sessao = s): Compacto => ({ t: 'dono.resposta', s: sessao, d: { pergunta, opcao: 1, rotulo } });
  assert.equal(trilhaDe(fatos({ branch: 'main' }), expandir([ancoraB(), resp('GM-21'), resp('GM-22')])).entrega, 'GM-21');
  assert.equal(trilhaDe(fatos({ branch: 'main' }), expandir([ancoraB(), resp('conversa avulsa'), resp('GM-21')])).identificada, false);
});

test('resposta-so-da-pergunta-b-da-sessao-atual', () => {
  // DP-2 ajuste 1 / plano T3: só a resposta à pergunta (b) da sessão atual liga.
  const s = 'sessao-b';
  const resp = (rotulo: string, pergunta: string, sessao = s): Compacto => ({ t: 'dono.resposta', s: sessao, d: { pergunta, opcao: 1, rotulo } });
  // Resposta "GM-13" de outra sessão não vence a branch feat/GM-20-x (que identifica com a spec GM-20).
  const velha = expandir(respostaB('GM-13', 'velha'));
  const p2 = trilhaDe(fatos({ branch: 'feat/GM-20-x' }), velha);
  assert.equal(p2.identificada, true);
  assert.equal(p2.entrega, 'GM-20');
  assert.equal(p2.candidato, 'GM-20');
  // Nem liga sozinha, sem branch.
  assert.equal(trilhaDe(fatos({ branch: 'main' }), velha).identificada, false);
  // Troca de valor: na própria sessão "velha" a mesma resposta liga.
  assert.equal(trilhaDe(fatos({ branch: 'feat/GM-20-x', sessao: 'velha' }), velha).entrega, 'GM-13');
  // Resposta "confirmar" a outra pergunta (dúvida) da mesma sessão não identifica, nem com `idPadrao` frouxo.
  const idPadrao = '[0-9a-z]{9,11}';
  const duvida: Compacto = { t: 'nota', s, d: { tipo: 'duvida', texto: 'seguir?', opcoes: ['confirmar', 'cancelar'] } };
  const outra = trilhaDe(fatos({ branch: null, idPadrao, specs: [] }), expandir([ancoraB(), duvida, resp('confirmar', `${s}:2`)]));
  assert.equal(outra.identificada, false);
  assert.equal(outra.entrega, null);
  assert.equal(outra.candidato, null);
  // Troca de valor: a mesma resposta à âncora (b) liga.
  assert.equal(trilhaDe(fatos({ branch: null, idPadrao, specs: [] }), expandir([ancoraB(), duvida, resp('confirmar', `${s}:1`)])).entrega, 'confirmar');
  // Pergunta inexistente na sessão não liga.
  assert.equal(trilhaDe(fatos({ branch: 'main' }), expandir([ancoraB(), resp('GM-21', `${s}:9`)])).identificada, false);
  // Âncora que não é o 1º evento de trabalho da sessão não é a (b).
  assert.equal(trilhaDe(fatos({ branch: 'main' }), expandir([ancoraB(), ancoraB(), resp('GM-21', `${s}:2`)])).identificada, false);
  // Resposta anterior à âncora (não respondia a ela) não liga.
  assert.equal(trilhaDe(fatos({ branch: 'main' }), expandir([resp('GM-21', `${s}:1`, 'outra'), ancoraB()])).identificada, false);
  // Sem sessão atual nos fatos ⇒ nunca liga por resposta (falha fechada).
  for (const sessao of [null, undefined, 42]) {
    const f = { ...fatos({ branch: 'main' }), sessao } as unknown as FatosTrilha;
    assert.equal(trilhaDe(f, expandir(respostaB('GM-21'))).identificada, false, String(sessao));
  }
  // Âncora exportada (o painel e o hook usam a mesma).
  assert.equal(ancoraDaPerguntaB(expandir([resp('x', 'z:1', 'outra'), ancoraB(), duvida]), s), `${s}:1`);
  assert.equal(ancoraDaPerguntaB(expandir([duvida, ancoraB()]), s), `${s}:2`, 'nota duvida não é âncora de (b) (Emenda 2)');
  assert.equal(ancoraDaPerguntaB(expandir([resp('x', 'z:1')]), s), null, 'resposta não é trabalho');
  assert.equal(ancoraDaPerguntaB(expandir(respostaB('GM-21')), null), null);
});

test('ancora-b-pula-duvida-pendencia-assunto', () => {
  // Emenda 2 consolidada: (b) nunca divide id com (a)/(d)/pendência; nota de outro tipo e fato medido seguem sendo trabalho.
  const s = 'sessao-b';
  const nota = (tipo: string, extra: Record<string, unknown> = {}): Compacto => ({ t: 'nota', s, d: { tipo, texto: 'x', ...extra } });
  const duvida = nota('duvida', { opcoes: ['sim', 'não'] });
  for (const [nome, n] of [['duvida', duvida], ['pendencia', nota('pendencia')], ['assunto', nota('assunto')], ['ideia', nota('ideia')]] as const) {
    assert.equal(ancoraDaPerguntaB(expandir([n, ancoraB()]), s), `${s}:2`, `pula ${nome}`);
    assert.equal(ancoraDaPerguntaB(expandir([n]), s), null, `só ${nome} ⇒ sem âncora`);
  }
  assert.equal(ancoraDaPerguntaB(expandir([duvida, nota('pendencia'), nota('assunto'), nota('ideia'), nota('desvio')]), s), `${s}:5`, 'ideia tem pergunta própria (T13b): não ancora (b)');
  assert.equal(ancoraDaPerguntaB(expandir([nota('desvio'), duvida]), s), `${s}:1`, 'desvio é trabalho');
  // `fato.medido spec` é âncora de (c), nunca de (b) (Sombra 7c74258a); sem outro trabalho ⇒ sem âncora.
  const spec: Compacto = { ...specMedida('docs/a.md'), s };
  assert.equal(ancoraDaPerguntaB(expandir([spec, ancoraB()]), s), `${s}:2`, 'pula spec');
  assert.equal(ancoraDaPerguntaB(expandir([spec]), s), null, 'só spec ⇒ sem âncora');
  // Responder (b) depois de uma dúvida liga a sessão (resposta à âncora real, não à nota).
  const ligada = trilhaDe(fatos({ branch: 'main' }), expandir([duvida, ancoraB(), { t: 'dono.resposta', s, d: { pergunta: `${s}:2`, opcao: 1, rotulo: 'GM-21' } }]));
  assert.equal(ligada.identificada, true);
  assert.equal(ligada.entrega, 'GM-21');
});

test('resposta-c-rotulo-de-duas-specs-segue-ambigua', () => {
  const base: Compacto[] = [specMedida(SPEC)];
  // Mesmo título nas duas: o rótulo não escolhe.
  const s2 = specFato({ caminho: 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md', sha256: B });
  base.push(specMedida(s2.caminho));
  const t = trilhaDe(fatos({ specs: [specFato(), s2] }), expandir([...base, respostaC('Trilha da GM-20')]));
  assert.equal(t.ambigua.length, 2);
  assert.equal(t.marcas[1], '?');
  // Título de uma = caminho da outra: o rótulo casa as 2.
  const s3 = specFato({ caminho: 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md', sha256: B, titulo: 'Outra' });
  const s1 = specFato({ titulo: s3.caminho });
  const u = trilhaDe(fatos({ specs: [s1, s3] }), expandir([...base, respostaC(s3.caminho)]));
  assert.equal(u.ambigua.length, 2);
  assert.equal(u.marcas[1], '?');
  // Troca de valor: rótulo de exatamente 1 escolhe.
  const v = trilhaDe(fatos({ specs: [s1, s3] }), expandir([...base, respostaC('Outra')]));
  assert.deepEqual(v.ambigua, []);
  assert.equal(v.marcas[1], '✓');
});

test('plano-medido-sem-plano-json-nao-interroga', () => {
  // Ligada por resposta, branch sem o ID; o plano já foi medido (`fato.medido plano`) e o plano.json saiu: fonte existe ⇒ sem `?`.
  const medido: Compacto = { t: 'fato.medido', d: { chave: 'plano', fonte: 'arquivo', valor: { tasks: 2 } } };
  const t = trilhaDe(fatos({ branch: 'main' }), expandir([aprovada(), medido, ...respostaB('GM-20')]));
  assert.equal(marcas(t), '✓✓✓●○??');
  assert.equal(t.motivos[3], null);
  assert.equal(t.motivos[4], null);
  // Troca de valor: sem o fato do plano, a fase plano é `?` e propaga.
  const sem = trilhaDe(fatos({ branch: 'main' }), expandir([aprovada(), ...respostaB('GM-20')]));
  assert.equal(marcas(sem), '✓✓✓????');
  assert.equal(sem.motivos[3], 'não consegui conferir o plano');
});

test('plano-sem-tasks-execucao-nao-check', () => {
  const t = trilhaDe(fatos({ plano: { tasks: [] } }), expandir([aprovada()]));
  assert.equal(marcas(t), '✓✓✓✓●○○');
  assert.equal(t.fase, 5);
  assert.equal(t.progresso, 'spec com 6 seções');
  // Troca de valor: 1 task integrada ⇒ execução ✓.
  assert.equal(marcas(trilhaDe(fatos({ plano: { tasks: ['T1'] } }), expandir([aprovada(), { integradas: ['T1'] }]))), '✓✓✓✓✓●○');
});

test('progresso-e-motivos-sem-linha-tecnica', () => {
  const casos: Trilha[] = [];
  for (let n = 1; n <= 7; n++) {
    const f = ler(`fase-${n}.json`);
    casos.push(trilhaDe(f.fatos, expandir(f.eventos)), trilhaDe({ ...f.fatos, gh: 'falhou' }, expandir(f.eventos)));
  }
  for (const c of ler('s3b-celulas.json').celulas) casos.push(trilhaDe(c.fatos, expandir(c.eventos)));
  casos.push(trilhaDe(fatos({ plano: { tasks: ['T1'] } }), []));
  for (const t of casos) {
    for (const linha of [t.progresso, ...t.motivos.filter((m): m is string => m !== null)]) {
      assert.doesNotMatch(linha, REGEX_TECNICA, linha);
    }
  }
  // Singular e plural.
  assert.equal(trilhaDe(fatos({ plano: { tasks: ['T1'] } }), expandir([aprovada()])).progresso, '1 task');
  assert.equal(trilhaDe(fatos({ plano: { tasks: ['T1', 'T2'] } }), expandir([aprovada()])).progresso, '2 tasks');
  assert.equal(trilhaDe(fatos({ specs: [specFato({ secoes: 1 })] }), []).progresso, 'spec com 1 seção · falta aprovar');
});

test('fatos-malformados-nao-lancam', () => {
  const t = trilhaDe({ branch: 'feat/GM-20-x', idPadrao: '(', specs: null, plano: null, ledger: false, gh: 'ok', ultimas: null } as unknown as FatosTrilha, null as unknown as Evento[]);
  assert.equal(t.identificada, false);
  assert.equal(t.candidato, null);
});

test('primeira-resposta-vence', () => {
  // (b): duas respostas à mesma pergunta — a 1ª no diário liga a entrega, a 2ª (outra sessão, corrida) não a troca.
  const f = fatos({ branch: 'main', idPadrao: '^GM-\\d+$', specs: [] });
  const b = trilhaDe(f, expandir([ancoraB('sessao-b'), resposta('GM-20', 'sessao-b'), resposta('GM-21', 'sessao-c', 'sessao-b:1')]));
  assert.equal(b.entrega, 'GM-20');
  // (c): idem — a 1ª resposta que casa com 1 spec escolhe; a 2ª, com outra spec, não troca.
  const s2 = specFato({ caminho: 'docs/superpowers/specs/2026-11-21-gm20-v2-design.md', sha256: B, secoes: 9, titulo: 'Trilha da GM-20 v2' });
  const base: Compacto[] = [specMedida(SPEC), specMedida(s2.caminho)];
  const c = trilhaDe(fatos({ specs: [specFato(), s2] }), expandir([...base, respostaC(SPEC), respostaC('Trilha da GM-20 v2')]));
  assert.equal(c.progresso, 'spec com 6 seções · falta aprovar', 'a 1ª resposta (v1, 6 seções) vence');
});

// ── GM-21 T1 (REQ-ENC-1, DT1 + emenda 1): a regra única "plano aberto" ──────────────────────────────────────────────────────────────────────
// MUTAÇÕES: ME1-b contar `fora` como aberta ⇒ plano-aberto-fora-nao-conta · ME1-d fase PR de trilhaDe ignora o plano ⇒ fase-pr-com-plano-aberto-nao-cumpre ·
// m2 diário que não projeta tratado como aberto ⇒ plano-aberto-diario-que-nao-projeta · m2 `invalidas` fora da conta ⇒ plano-aberto-task-invalida-conta-aberta
const T1_INTEGRADA: Compacto = { integradas: ['T1'] };
const fora = (task: string, como = 'cortada'): Compacto => ({ t: 'task.fora', d: { task, como } });

test('plano-aberto-regra: pendente é aberta; integrada, adiada e cortada não (ME1-b)', () => {
  assert.deepEqual(tasksAbertas(['T1', 'T2'], expandir([T1_INTEGRADA])), ['T2']);
  assert.equal(planoAberto(['T1', 'T2'], expandir([T1_INTEGRADA])), true);
  assert.equal(planoAberto(['T1', 'T2'], expandir([T1_INTEGRADA, fora('T2')])), false, 'cortada não conta');
  assert.equal(planoAberto(['T1', 'T2'], expandir([T1_INTEGRADA, fora('T2', 'adiada')])), false, 'adiada não conta');
  assert.equal(planoAberto(['T1', 'T2'], expandir([T1_INTEGRADA, { integradas: ['T2'] }])), false);
  assert.equal(planoAberto(['T1'], []), true, 'sem evento nenhum, a task está pendente');
  assert.equal(planoAberto([], []), false, 'plano sem task não está aberto');
});

test('plano-aberto-diario-que-nao-projeta: ciclo impossível ⇒ regra de hoje (não aberto); task em `invalidas` conta como aberta (backlog m2)', () => {
  // task.integrada sem aprovação é defeito de tabela: o diário não projeta ⇒ false (lado seguro: a regra de hoje)
  assert.equal(planoAberto(['T1', 'T2'], expandir([{ t: 'task.integrada', d: { task: 'T1' } }])), false);
  assert.deepEqual(tasksAbertas(['T1', 'T2'], expandir([{ t: 'task.integrada', d: { task: 'T1' } }])), []);
  // evento fora do plano: a trilha ignora (ignorarFora), a regra também
  assert.equal(planoAberto(['T1'], expandir([T1_INTEGRADA, { t: 'task.iniciada', d: { task: 'T9', papel: 'implementador' } }])), false);
  // reabertura de origem inválida em T2: T2 entra em `invalidas` e CONTA como aberta; T1 integrada não
  const ev = expandir([T1_INTEGRADA, { t: 'task.iniciada', d: { task: 'T2', papel: 'implementador' } }, { t: 'task.reaberta', d: { task: 'T2', origem: 'xpto' } }]);
  assert.deepEqual(tasksAbertas(['T1', 'T2'], ev), ['T2']);
  assert.equal(planoAberto(['T1', 'T2'], ev), true);
  assert.equal(planoAberto(['T1'], ev), false, 'só T1 no plano: integrada');
});

test('fase-pr-com-plano-aberto-nao-cumpre (ME1-d, emenda 1): PR mergeado e nenhum aberto, T2 aberta ⇒ a fase PR não é ✓ e a entrega segue identificada; T2 cortada ⇒ ✓', () => {
  const plano = { tasks: ['T1', 'T2'] };
  const f = fatos({ plano, specs: [] });
  const aberto = trilhaDe(f, expandir([T1_INTEGRADA, pr(10, 'mergeado')]));
  assert.equal(aberto.identificada, true, 'identificada: o plano não é descartado');
  assert.equal(aberto.entrega, 'GM-20');
  assert.notEqual(aberto.marcas[5], '✓', marcas(aberto));
  assert.equal(aberto.progresso, '1 de 2 tasks integradas');
  const fechado = trilhaDe(f, expandir([T1_INTEGRADA, fora('T2'), pr(10, 'mergeado')]));
  assert.equal(fechado.identificada, false, 'plano fechado + PR mergeado: publicada (a regra de hoje)');
  const comAberto = trilhaDe(f, expandir([T1_INTEGRADA, pr(10, 'mergeado'), pr(11, 'aberto')]));
  assert.equal(comAberto.identificada, true, 'regressão: com o #11 aberto é o mesmo');
  // gh falhou: a regra de hoje (a fase PR é `?`, nunca ✓ por causa do plano)
  assert.equal(trilhaDe(fatos({ plano, specs: [], gh: 'falhou' }), expandir([T1_INTEGRADA, pr(10, 'mergeado')])).marcas[5], '?');
});

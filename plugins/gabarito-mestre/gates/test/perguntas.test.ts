/**
 * Testes de `perguntas.ts` (GM-14 T12, REQ-PRG-1 núcleo; DP-2 ajustes 1–4 e DP-4 de `sombra-dp.md`).
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-12-mut.json):
 *  M-T12a  candidato sem 2º fato conta como ligado (não pergunta)     ⇒ gatilho-b-id-sem-segundo-fato
 *  M5      a mais nova primeiro                                       ⇒ duas-abertas-mais-antiga-primeiro
 *  M-T12b  âncora (b) do repositório, não da sessão                   ⇒ b-nova-sessao-em-main-volta-a-perguntar
 *  M-T12c  opções de (b) sem congelar pela âncora                      ⇒ b-opcoes-congeladas-pela-ancora
 *  M-T12d  âncora (c) = último `fato.medido spec` (reabre a cada edição) ⇒ c-nao-reabre-com-edicao-de-spec
 *  M-T12e  resposta `{sha256, chars}` fecha                            ⇒ resposta-hash-nao-fecha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perguntasAbertas, respostaValida } from '../src/perguntas.ts';
import type { Pergunta } from '../src/perguntas.ts';
import { ancoraDaPerguntaB, trilhaDe } from '../src/trilha.ts';
import { pendenciaAberta } from '../src/depende.ts';
import type { FatosTrilha, SpecFato, Trilha } from '../src/trilha.ts';
import { formaInvalida } from '../src/formas.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

type Compacto = { t: TipoEvento; d: Record<string, unknown>; s?: string };

/** `seq` por sessão, `ts` crescente de minuto em minuto a partir de 2026-11-01T00:00Z (índice i ⇒ minuto i). */
function expandir(compactos: Compacto[]): Evento[] {
  const seqs = new Map<string, number>();
  return compactos.map((c, i) => {
    const sessao = c.s ?? 'sessao-a';
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    const ts = new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString();
    return { seq, ts, autor: 'teste', sessao, agente: 'orquestrador', tipo: c.t, dados: c.d, hash_anterior: null };
  });
}
const minuto = (i: number) => new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString();

const trilha = (extra: Partial<Trilha> = {}): Trilha => ({
  entrega: null, identificada: false, candidato: null, marcas: ['●', '○', '○', '○', '○', '○', '○'], motivos: Array(7).fill(null),
  fase: 1, progresso: '0 ideias anotadas', mudouDepois: false, ultimaConhecida: null, ambigua: [], ...extra,
});
const identificada = (extra: Partial<Trilha> = {}) => trilha({ entrega: 'GM-20', identificada: true, candidato: 'GM-20', ...extra });

const inicio = (s: string): Compacto => ({ t: 'sessao.inicio', d: { origem: 'startup' }, s });
const branch = (s: string, nome = 'main'): Compacto => ({ t: 'fato.medido', d: { chave: 'branch', fonte: 'git', valor: { nome } }, s });
const notaDe = (tipo: string, texto: string, s = 'sessao-a', opcoes?: string[]): Compacto =>
  ({ t: 'nota', d: opcoes ? { tipo, texto, opcoes } : { tipo, texto }, s });
const resp = (pergunta: string, opcao: number, rotulo: string, s = 'sessao-dono'): Compacto =>
  ({ t: 'dono.resposta', d: { pergunta, opcao, rotulo }, s });
const respHash = (pergunta: string, s = 'sessao-dono'): Compacto =>
  ({ t: 'dono.resposta', d: { pergunta, sha256: 'c'.repeat(64), chars: 7 }, s });
const specMedida = (caminho: string, sha: string, s = 'sessao-a'): Compacto =>
  ({ t: 'fato.medido', d: { chave: 'spec', fonte: 'arquivo', valor: { caminho, sha256: sha, secoes: 5 } }, s });

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SPEC1 = 'docs/superpowers/specs/2026-11-20-gm20-design.md';
const SPEC2 = 'docs/superpowers/specs/2026-11-21-gm20-painel.md';
const SPEC3 = 'docs/superpowers/specs/2026-11-22-gm20-extra.md';
const spec = (caminho: string, titulo: string, sha = A): SpecFato => ({ caminho, pbi: 'GM-20', sha256: sha, secoes: 5, titulo });

/** Asserção por campo produzido (P15): id, gatilho, texto e opções, cada um lido. */
function confere(p: Pergunta, esperado: Pergunta) {
  assert.equal(p.id, esperado.id);
  assert.equal(p.gatilho, esperado.gatilho);
  assert.equal(p.texto, esperado.texto);
  assert.deepEqual(p.opcoes, esperado.opcoes);
  assert.deepEqual(Object.keys(p).sort(), ['gatilho', 'id', 'opcoes', 'texto']);
}

/** Toda resposta por opção que o hook gravaria com estas perguntas passa a forma do diário (rótulo ≤ 60, 1 linha). */
function rotulosGravaveis(ps: Pergunta[]) {
  for (const p of ps) {
    assert.ok(p.texto.length <= 160, `texto ≤ 160: ${p.texto}`);
    p.opcoes.forEach((rotulo, i) =>
      assert.equal(formaInvalida('dono.resposta', { pergunta: p.id, opcao: i + 1, rotulo }), null, `${p.id} opção ${i + 1}`));
  }
}

// ── (a) nota assunto sem entrega ─────────────────────────────────────────────────────────────────────────────────────────────

test('gatilho-a', () => {
  const evs = expandir([inicio('sessao-a'), notaDe('assunto', 'a conversa foi para o deploy do site')]);
  const ps = perguntasAbertas(evs, trilha({ ultimaConhecida: 'GM-13' }), { sessao: 'sessao-x', ultimas: [{ id: 'GM-13', data: '2026-10-30' }] });
  assert.equal(ps.length, 1);
  confere(ps[0], {
    id: 'sessao-a:2', gatilho: 'a',
    texto: 'A conversa mudou de assunto. Isto é parte da GM-13, ideia para a próxima ou conversa avulsa?',
    opcoes: ['GM-13', 'ideia para a próxima', 'conversa avulsa'],
  });
  rotulosGravaveis(ps);
  // Sem `ultimas` no contexto: cai na última conhecida da trilha (mesmo texto).
  confere(perguntasAbertas(evs, trilha({ ultimaConhecida: 'GM-13' }), { sessao: 'sessao-x' })[0], ps[0]);
  // Sem nenhuma entrega conhecida: não há "parte da".
  confere(perguntasAbertas(evs, trilha(), { sessao: 'sessao-x' })[0], {
    id: 'sessao-a:2', gatilho: 'a', texto: 'A conversa mudou de assunto. Isto é ideia para a próxima ou conversa avulsa?',
    opcoes: ['ideia para a próxima', 'conversa avulsa'],
  });
  // Com entrega identificada não é "sem entrega": (a) não abre.
  assert.deepEqual(perguntasAbertas(evs, identificada(), { sessao: 'sessao-x' }), []);
  // Outros tipos de nota não são (a).
  const ideia = expandir([inicio('sessao-a'), notaDe('ideia', 'painel com cores')]);
  assert.deepEqual(perguntasAbertas(ideia, trilha(), { sessao: 'sessao-x' }), []);
});

test('gatilho-a-ultima-entrega-congelada-na-nota', () => {
  const evs = expandir([inicio('sessao-a'), notaDe('assunto', 'mudou')]); // nota em minuto 1
  const ultimas = [{ id: 'GM-13', data: minuto(0) }, { id: 'GM-21', data: minuto(5) }];
  const [p] = perguntasAbertas(evs, trilha({ ultimaConhecida: 'GM-21' }), { sessao: 'sessao-x', ultimas });
  assert.deepEqual(p.opcoes, ['GM-13', 'ideia para a próxima', 'conversa avulsa']);
});

// ── (b) sessão com trabalho sem entrega identificada ───────────────────────────────────────────────────────────────────────

test('gatilho-b-duas-ultimas-uma-nova-avulsa', () => {
  const evs = expandir([inicio('s1'), branch('s1')]);
  const ultimas = [{ id: 'GM-11', data: '2026-10-20' }, { id: 'GM-13', data: '2026-10-30' }, { id: 'GM-12', data: '2026-10-25' }];
  const ps = perguntasAbertas(evs, trilha({ ultimaConhecida: 'GM-13' }), { sessao: 's1', ultimas });
  assert.equal(ps.length, 1);
  confere(ps[0], { id: 's1:2', gatilho: 'b', texto: 'De que entrega é esta conversa?', opcoes: ['GM-13', 'GM-12', 'uma nova', 'conversa avulsa'] });
  rotulosGravaveis(ps);
  // ID cru (DP-4): nunca "GM 13".
  assert.ok(!ps[0].opcoes.some((o) => /GM \d/.test(o)));
  // Uma só entrega conhecida ⇒ 3 opções; nenhuma ⇒ só "uma nova" e "conversa avulsa".
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1', ultimas: [{ id: 'GM-13', data: '2026-10-30' }] })[0].opcoes,
    ['GM-13', 'uma nova', 'conversa avulsa']);
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1', ultimas: [] })[0].opcoes, ['uma nova', 'conversa avulsa']);
  // Pastas internas (`_sem-id`, `_onboarding`) e id repetido não viram opção.
  assert.deepEqual(perguntasAbertas(evs, trilha(), {
    sessao: 's1', ultimas: [{ id: '_sem-id', data: '2026-10-31' }, { id: 'GM-13', data: '2026-10-30' }, { id: 'GM-13', data: '2026-10-29' }],
  })[0].opcoes, ['GM-13', 'uma nova', 'conversa avulsa']);
});

test('gatilho-b-id-sem-segundo-fato', () => {
  const evs = expandir([inicio('s1'), branch('s1', 'feat/GM-20-x')]);
  const ps = perguntasAbertas(evs, trilha({ candidato: 'GM-20' }), { sessao: 's1', ultimas: [{ id: 'GM-13', data: '2026-10-30' }] });
  assert.equal(ps.length, 1);
  confere(ps[0], { id: 's1:2', gatilho: 'b', texto: 'Esta conversa é da entrega GM-20?', opcoes: ['GM-20', 'uma nova', 'conversa avulsa'] });
  rotulosGravaveis(ps);
  // "sim" não liga (T3 só liga com rótulo = ID cru): nenhuma opção é "sim".
  assert.ok(!ps[0].opcoes.map((o) => o.toLowerCase()).includes('sim'));
  // Entrega identificada ⇒ (b) não abre (nem com candidato).
  assert.deepEqual(perguntasAbertas(evs, identificada(), { sessao: 's1' }), []);
});

test('b-sessao-sem-trabalho-nao-pergunta', () => {
  const evs = expandir([inicio('s1'), { t: 'guarda.heartbeat', d: { fonte: 'origin', divergente: false }, s: 's1' }]);
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1' }), []);
  // Trabalho só de OUTRA sessão não abre (b) para esta.
  const outra = expandir([inicio('s1'), inicio('s2'), branch('s2')]);
  assert.deepEqual(perguntasAbertas(outra, trilha(), { sessao: 's1' }), []);
  // Nota também é trabalho.
  const nota = expandir([inicio('s1'), notaDe('ideia', 'x', 's1')]);
  assert.equal(perguntasAbertas(nota, trilha(), { sessao: 's1' })[0].id, 's1:2');
});

test('b-nova-sessao-em-main-volta-a-perguntar', () => {
  // s1 em main: perguntou, dono respondeu "conversa avulsa". s2 (nova sessão, mesma branch, `medir` não regrava branch) volta a perguntar.
  const evs = expandir([inicio('s1'), branch('s1'), resp('s1:2', 2, 'conversa avulsa'), inicio('s2'), notaDe('ideia', 'outra coisa', 's2')]);
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1' }), []);
  const ps = perguntasAbertas(evs, trilha(), { sessao: 's2' });
  assert.equal(ps.length, 1);
  assert.equal(ps[0].id, 's2:2');
  assert.equal(ps[0].gatilho, 'b');
  // Seqs diferentes nas duas sessões (s1 retomada antes do 1º trabalho): a âncora é o 1º trabalho DA s2, não o seq do 1º da s1.
  const desalinhado = expandir([inicio('s1'), inicio('s1'), branch('s1'), resp('s1:3', 2, 'conversa avulsa'), inicio('s2'), notaDe('ideia', 'outra', 's2')]);
  assert.deepEqual(perguntasAbertas(desalinhado, trilha(), { sessao: 's2' }).map((p) => [p.gatilho, p.id]), [['b', 's2:2']]);
});

test('b-sessao-padrao-e-a-do-ultimo-inicio', () => {
  const evs = expandir([inicio('s1'), branch('s1'), inicio('s2'), branch('s2')]);
  assert.equal(perguntasAbertas(evs, trilha()).find((p) => p.gatilho === 'b')?.id, 's2:2');
  assert.equal(perguntasAbertas(evs, trilha(), {}).find((p) => p.gatilho === 'b')?.id, 's2:2');
  // Sem `sessao.inicio` e sem sessão no contexto, ninguém é "a sessão atual": (b) não abre.
  assert.deepEqual(perguntasAbertas(expandir([branch('s1')]), trilha()), []);
});

test('b-ancora-no-primeiro-trabalho-da-sessao-retomada-nao-reabre', () => {
  // A sessão retomada grava outro `sessao.inicio` com o mesmo id; a âncora segue no 1º trabalho, já respondido.
  const evs = expandir([inicio('s1'), branch('s1'), resp('s1:2', 1, 'uma nova'), inicio('s1'), notaDe('ideia', 'x', 's1')]);
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1' }), []);
});

test('b-opcoes-congeladas-pela-ancora', () => {
  // Âncora em minuto 1. GM-21 nasce no minuto 3 (entre o render e o hook): não muda a lista nem o mapeamento.
  const evs = expandir([inicio('s1'), branch('s1')]);
  const antes = [{ id: 'GM-13', data: minuto(0) }, { id: 'GM-12', data: '2026-10-25' }];
  const depois = [...antes, { id: 'GM-21', data: minuto(3) }];
  const render = perguntasAbertas(evs, trilha(), { sessao: 's1', ultimas: antes });
  const hook = perguntasAbertas(evs, trilha(), { sessao: 's1', ultimas: depois });
  assert.deepEqual(hook, render);
  assert.deepEqual(hook[0].opcoes, ['GM-13', 'GM-12', 'uma nova', 'conversa avulsa']);
  assert.deepEqual(respostaValida(hook, 's1:2', 1), { ok: true, rotulo: 'GM-13' });
  // Atividade posterior de entrega já existente: só os pontos ≤ âncora contam (lista de pontos, id pode repetir).
  const comAtividade = [...antes, { id: 'GM-12', data: minuto(4) }];
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1', ultimas: comAtividade })[0].opcoes, ['GM-13', 'GM-12', 'uma nova', 'conversa avulsa']);
});

test('b-resposta-com-id-liga-a-trilha-e-avulsa-nao', () => {
  // Atravessa T3: o rótulo que (b) grava é o que `trilhaDe` lê para ligar a sessão.
  const fatos: FatosTrilha = { sessao: 's1', branch: 'main', idPadrao: '[A-Z]+-\\d+', specs: [], plano: null, ledger: false, gh: 'ok', ultimas: [{ id: 'GM-13', data: '2026-10-30' }] };
  const base = expandir([inicio('s1'), branch('s1')]);
  const t0 = trilhaDe(fatos, base);
  assert.equal(t0.identificada, false);
  const [p] = perguntasAbertas(base, t0, { sessao: 's1', ultimas: fatos.ultimas });
  assert.equal(p.gatilho, 'b');
  const r = respostaValida([p], p.id, 1);
  assert.deepEqual(r, { ok: true, rotulo: 'GM-13' });
  const ligado = expandir([inicio('s1'), branch('s1'), resp(p.id, 1, 'GM-13')]);
  const t1 = trilhaDe(fatos, ligado);
  assert.equal(t1.identificada, true);
  assert.equal(t1.entrega, 'GM-13');
  assert.deepEqual(perguntasAbertas(ligado, t1, { sessao: 's1', ultimas: fatos.ultimas }), []);
  const avulsa = expandir([inicio('s1'), branch('s1'), resp(p.id, 3, 'conversa avulsa')]);
  const t2 = trilhaDe(fatos, avulsa);
  assert.equal(t2.identificada, false);
  assert.deepEqual(perguntasAbertas(avulsa, t2, { sessao: 's1', ultimas: fatos.ultimas }), []);
});

// ── (c) spec ambígua ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('gatilho-c', () => {
  const evs = expandir([inicio('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1')]);
  const t = identificada({ ambigua: [spec(SPEC1, 'Trilha da GM-20'), spec(SPEC2, 'Painel da GM-20', B)] });
  const ps = perguntasAbertas(evs, t, { sessao: 's1' });
  assert.equal(ps.length, 1);
  confere(ps[0], { id: 's1:3', gatilho: 'c', texto: 'Qual destas é a spec da GM-20?', opcoes: ['Trilha da GM-20', 'Painel da GM-20'] });
  rotulosGravaveis(ps);
  // Sem ambiguidade, (c) não abre.
  assert.deepEqual(perguntasAbertas(evs, identificada(), { sessao: 's1' }), []);
});

test('c-titulo-repetido-ou-longo-usa-o-caminho', () => {
  const evs = expandir([inicio('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1'), specMedida(SPEC3, C, 's1')]);
  const longo = 'T'.repeat(61);
  // Caixa diferente ainda é o mesmo título para a escolha (T3 compara sem caixa): os dois usam o caminho.
  const t = identificada({ ambigua: [spec(SPEC1, 'Trilha'), spec(SPEC2, 'TRILHA', B), spec(SPEC3, longo, C)] });
  const [p] = perguntasAbertas(evs, t, { sessao: 's1' });
  assert.deepEqual(p.opcoes, [SPEC1, SPEC2, SPEC3]);
  rotulosGravaveis([p]);
  // Caixa mista distinta não colide: "Trilha" × "Painel" seguem como títulos.
  const t2 = identificada({ ambigua: [spec(SPEC1, 'Trilha'), spec(SPEC2, 'pAINEL', B)] });
  assert.deepEqual(perguntasAbertas(evs, t2, { sessao: 's1' })[0].opcoes, ['Trilha', 'pAINEL']);
});

/** Atravessa T3: abre (c) com `trilhaDe` real, responde a opção `n` e confere que a trilha acata (1 spec escolhida, sem ambiguidade). */
function cResolve(titulos: string[], caminhos: string[], escolhida: number) {
  const specs = caminhos.map((c, i) => spec(c, titulos[i], String.fromCharCode(97 + i).repeat(64)));
  const fatos: FatosTrilha = { branch: 'feat/GM-20-x', idPadrao: '[A-Z]+-\\d+', specs, plano: null, ledger: false, gh: 'ok', ultimas: [] };
  const medidas = caminhos.map((c, i) => specMedida(c, String.fromCharCode(97 + i).repeat(64), 's1'));
  const base = expandir([inicio('s1'), ...medidas]);
  const t0 = trilhaDe(fatos, base);
  assert.equal(t0.ambigua.length, caminhos.length);
  const ps = perguntasAbertas(base, t0, { sessao: 's1' });
  assert.equal(ps.length, 1, 'a pergunta (c) abre');
  rotulosGravaveis(ps);
  assert.ok(ps[0].opcoes.length >= 2);
  const r = respostaValida(ps, ps[0].id, escolhida);
  assert.ok(r.ok);
  const depois = expandir([inicio('s1'), ...medidas, resp(ps[0].id, escolhida, r.ok ? r.rotulo : '')]);
  const t1 = trilhaDe(fatos, depois);
  assert.deepEqual(t1.ambigua, [], `o rótulo ${r.ok ? r.rotulo : ''} resolve a spec`);
  assert.equal(t1.marcas[1], '✓');
  return ps[0];
}

test('c-sempre-abre-titulo-repetido-e-caminho-longo', () => {
  // Medido pelo revisor: 'Design'/'design' (mesmo título sem caixa) com caminhos de 69 e 70 caracteres.
  const P1 = 'docs/superpowers/specs/2026-11-09-e3-sombra-emendas-entrega-design.md';
  const P2 = 'docs/superpowers/specs/2026-11-10-e5-fluxo-gabarito-design-parte-2.md';
  assert.ok([...P1].length > 60 && [...P2].length > 60);
  for (const n of [1, 2]) cResolve(['Design', 'design'], [P1, P2], n);
  // Caminho > 60 com nome de arquivo curto: o rótulo é o nome do arquivo (antes do `…`+final do caminho).
  const pn = cResolve(['Design', 'design'], [P1, P2], 1);
  assert.deepEqual(pn.opcoes, ['2026-11-09-e3-sombra-emendas-entrega-design.md', '2026-11-10-e5-fluxo-gabarito-design-parte-2.md']);
  // Título de 70 caracteres + 'Outra': a 1ª opção não é o título (não cabe) e ainda resolve.
  for (const n of [1, 2]) cResolve(['T'.repeat(70), 'Outra'], [P1, P2], n);
  // Até o nome do arquivo passa de 60 e só o fim difere: sobra o final do caminho com reticências.
  const longo = 'z'.repeat(70);
  const p = cResolve(['Design', 'design'], [`docs/a/${longo}-a.md`, `docs/b/${longo}-b.md`], 1);
  assert.ok(p.opcoes.every((o) => [...o].length <= 60));
});

test('c-com-uma-so-opcao-que-resolve-nao-abre', () => {
  // Limite conhecido: duas specs cujos caminhos acabam igual (59+ caracteres) e só uma tem título usável ⇒ 1 rótulo só; pergunta
  // de 1 opção não decide nada e `formas.ts` a recusaria (2 a 4 opções).
  const cauda = `${'y'.repeat(60)}.md`;
  const [a, b] = [`docs/a/${cauda}`, `docs/b/${cauda}`];
  const evs = expandir([inicio('s1'), specMedida(a, A, 's1'), specMedida(b, B, 's1')]);
  const t = identificada({ ambigua: [spec(a, 'Alpha'), spec(b, 'T'.repeat(70), B)] });
  assert.deepEqual(perguntasAbertas(evs, t, { sessao: 's1' }), []);
});

test('c-mais-de-4-specs-so-4-opcoes', () => {
  const caminhos = [1, 2, 3, 4, 5, 6].map((n) => `docs/superpowers/specs/2026-11-2${n}-gm20-parte-${n}.md`);
  const evs = expandir([inicio('s1'), ...caminhos.map((c, i) => specMedida(c, String.fromCharCode(97 + i).repeat(64), 's1'))]);
  const t = identificada({ ambigua: caminhos.map((c, i) => spec(c, `Parte ${i + 1}`, String.fromCharCode(97 + i).repeat(64))) });
  const [p] = perguntasAbertas(evs, t, { sessao: 's1' });
  assert.deepEqual(p.opcoes, ['Parte 1', 'Parte 2', 'Parte 3', 'Parte 4']);
  rotulosGravaveis([p]);
});

test('c-nao-reabre-com-edicao-de-spec', () => {
  // Âncora = entrada da última spec do conjunto (s1:3). Editar a spec (novo `fato.medido spec`) não reabre.
  const evs = expandir([
    inicio('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1'), resp('s1:3', 2, 'Painel da GM-20'),
    specMedida(SPEC2, C, 's1'), specMedida(SPEC1, B, 's1'),
  ]);
  const t = identificada({ ambigua: [spec(SPEC1, 'Trilha da GM-20', B), spec(SPEC2, 'Painel da GM-20', C)] });
  assert.deepEqual(perguntasAbertas(evs, t, { sessao: 's1' }), []);
  // O conjunto muda (3ª spec entra): âncora nova, pergunta reabre.
  const tres = [...evs, ...expandir([specMedida(SPEC3, C, 's9')])].map((e, i) => (e.sessao === 's9' ? { ...e, ts: minuto(20 + i) } : e));
  const t3 = identificada({ ambigua: [...t.ambigua, spec(SPEC3, 'Extra da GM-20', C)] });
  const ps = perguntasAbertas(tres, t3, { sessao: 's1' });
  assert.equal(ps.length, 1);
  assert.equal(ps[0].id, 's9:1');
  assert.deepEqual(ps[0].opcoes, ['Trilha da GM-20', 'Painel da GM-20', 'Extra da GM-20']);
});

test('c-resposta-resolve-a-trilha', () => {
  // Atravessa T3: o rótulo de (c) é o que `trilhaDe` aceita como "a spec".
  const specs = [spec(SPEC1, 'Trilha da GM-20'), spec(SPEC2, 'Painel da GM-20', B)];
  const fatos: FatosTrilha = { branch: 'feat/GM-20-x', idPadrao: '[A-Z]+-\\d+', specs, plano: null, ledger: false, gh: 'ok', ultimas: [] };
  const base = expandir([inicio('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1')]);
  const t0 = trilhaDe(fatos, base);
  assert.equal(t0.ambigua.length, 2);
  const [p] = perguntasAbertas(base, t0, { sessao: 's1' });
  const r = respostaValida([p], p.id, 2);
  assert.ok(r.ok);
  const depois = expandir([inicio('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1'), resp(p.id, 2, r.ok ? r.rotulo : '')]);
  const t1 = trilhaDe(fatos, depois);
  assert.deepEqual(t1.ambigua, []);
  assert.equal(t1.marcas[1], '✓');
  assert.deepEqual(perguntasAbertas(depois, t1, { sessao: 's1' }), []);
  // Com o caminho (título repetido) também resolve.
  const repetidos = [spec(SPEC1, 'Igual'), spec(SPEC2, 'igual', B)];
  const f2 = { ...fatos, specs: repetidos };
  const [p2] = perguntasAbertas(base, trilhaDe(f2, base), { sessao: 's1' });
  const r2 = respostaValida([p2], p2.id, 1);
  const d2 = expandir([inicio('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1'), resp(p2.id, 1, r2.ok ? r2.rotulo : '')]);
  assert.deepEqual(trilhaDe(f2, d2).ambigua, []);
});

test('c-sem-fato-medido-da-spec-nao-abre', () => {
  // Sem o evento que criou a ambiguidade não há âncora (id) possível.
  const t = identificada({ ambigua: [spec(SPEC1, 'Trilha'), spec(SPEC2, 'Painel', B)] });
  assert.deepEqual(perguntasAbertas(expandir([inicio('s1')]), t, { sessao: 's1' }).filter((p) => p.gatilho === 'c'), []);
});

test('b-nao-se-ancora-em-assunto-nem-pendencia', () => {
  // Cada nota com pergunta própria (a)/(d) é âncora só dela: (b) pula para o 1º trabalho seguinte e os ids nunca se repetem.
  const assunto = expandir([inicio('s1'), notaDe('assunto', 'x', 's1'), branch('s1')]);
  assert.deepEqual(perguntasAbertas(assunto, trilha(), { sessao: 's1' }).map((p) => [p.gatilho, p.id]), [['a', 's1:2'], ['b', 's1:3']]);
  const pendencia = expandir([inicio('s1'), notaDe('pendencia', 'y', 's1'), branch('s1')]);
  assert.deepEqual(perguntasAbertas(pendencia, trilha(), { sessao: 's1' }).map((p) => [p.gatilho, p.id]), [['pendencia', 's1:2'], ['b', 's1:3']]);
  for (const evs of [assunto, pendencia]) {
    const ids = perguntasAbertas(evs, trilha(), { sessao: 's1' }).map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('perguntas-usa-a-ancora-da-trilha', () => {
  // P9 (MAJOR r3): atravessa as duas camadas. Sessão cuja 1ª nota é pergunta própria: o id de (b) é o de `ancoraDaPerguntaB` real,
  // não o da nota, e responder (b) liga a trilha (a resposta não é aceita e descartada em silêncio).
  const fatos: FatosTrilha = { sessao: 's1', branch: 'main', idPadrao: '[A-Z]+-\\d+', specs: [], plano: null, ledger: false, gh: 'ok', ultimas: [{ id: 'GM-13', data: '2026-10-30' }] };
  const variantes: Compacto[] = [notaDe('duvida', 'qual?', 's1', ['x', 'y']), notaDe('assunto', 'outro', 's1'), notaDe('pendencia', 'token', 's1')];
  for (const nota of variantes) {
    const base: Compacto[] = [inicio('s1'), nota, branch('s1')];
    const evs = expandir(base);
    const t0 = trilhaDe(fatos, evs);
    assert.equal(t0.identificada, false);
    const b = perguntasAbertas(evs, t0, { sessao: 's1', ultimas: fatos.ultimas }).find((p) => p.gatilho === 'b');
    assert.ok(b !== undefined, String(nota.d.tipo));
    assert.equal(b.id, ancoraDaPerguntaB(evs, 's1'));
    assert.equal(b.id, 's1:3');
    assert.deepEqual(respostaValida([b], b.id, 1), { ok: true, rotulo: 'GM-13' });
    const ligado = expandir([...base, resp(b.id, 1, 'GM-13')]);
    const t1 = trilhaDe(fatos, ligado);
    assert.equal(t1.identificada, true, String(nota.d.tipo));
    assert.equal(t1.entrega, 'GM-13');
    assert.equal(perguntasAbertas(ligado, t1, { sessao: 's1', ultimas: fatos.ultimas }).some((p) => p.gatilho === 'b'), false);
  }
});

test('b-e-d-nunca-mesmo-id', () => {
  // Propriedade: toda sequência de até 4 eventos de trabalho numa sessão sem entrega ⇒ ids de `perguntasAbertas` distintos.
  const pecas: Compacto[] = [notaDe('duvida', 'qual?', 's1', ['x', 'y']), notaDe('pendencia', 'p', 's1'), notaDe('assunto', 'a', 's1'),
    notaDe('ideia', 'i', 's1'), branch('s1')];
  let casos = 0;
  let comB = 0;
  const gerar = (prefixo: Compacto[]): void => {
    if (prefixo.length > 0) {
      const ps = perguntasAbertas(expandir([inicio('s1'), ...prefixo]), trilha(), { sessao: 's1' });
      const ids = ps.map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length, JSON.stringify(ps.map((p) => [p.gatilho, p.id])));
      casos++;
      if (ps.some((p) => p.gatilho === 'b')) comB++;
    }
    if (prefixo.length < 4) for (const p of pecas) gerar([...prefixo, p]);
  };
  gerar([]);
  assert.equal(casos, 5 + 25 + 125 + 625);
  assert.ok(comB > 0 && comB < casos);
});

test('perguntas-usa-a-pendencia-do-depende', () => {
  // Regra única (Sombra 4ad3f283): a pendência do painel é a `pendenciaAberta` de depende.ts. Cada cláusula com caso:
  const casos: { nome: string; evs: Compacto[]; abre: boolean }[] = [
    { nome: 'aberta', evs: [inicio('s1'), notaDe('pendencia', 'criar o token', 's1')], abre: true },
    { nome: 'forma inválida (opções em pendência)', evs: [inicio('s1'), notaDe('pendencia', 'criar o token', 's1', ['a', 'b'])], abre: false },
    { nome: 'texto acima de 160', evs: [inicio('s1'), notaDe('pendencia', 'x'.repeat(161), 's1')], abre: false },
    { nome: 'fechada por rótulo', evs: [inicio('s1'), notaDe('pendencia', 'criar o token', 's1'), resp('s1:2', 1, 'feito')], abre: false },
    { nome: 'hash não fecha', evs: [inicio('s1'), notaDe('pendencia', 'criar o token', 's1'), respHash('s1:2')], abre: true },
  ];
  for (const c of casos) {
    const evs = expandir(c.evs);
    const ps = perguntasAbertas(evs, identificada(), { sessao: 's1' }).filter((p) => p.gatilho === 'pendencia');
    const nota = evs.find((e) => e.tipo === 'nota') as Evento;
    assert.equal(ps.length, c.abre ? 1 : 0, c.nome);
    assert.equal(pendenciaAberta(evs, nota) !== null, c.abre, `depende concorda: ${c.nome}`);
    if (c.abre) confere(ps[0], { id: 's1:2', gatilho: 'pendencia', texto: 'criar o token', opcoes: ['feito'] });
  }
  // Resposta com timestamp anterior à nota não fecha (o depende exige a resposta depois da nota).
  const evs = expandir([inicio('s1'), notaDe('pendencia', 'criar o token', 's1')]);
  const antes: Evento = { ...expandir([resp('s1:2', 1, 'feito')])[0], ts: '2026-10-31T00:00:00.000Z' };
  assert.equal(perguntasAbertas([antes, ...evs], identificada(), { sessao: 's1' }).filter((p) => p.gatilho === 'pendencia').length, 1);
});

// ── (d) nota duvida e pendência ─────────────────────────────────────────────────────────────────────────────────────────────

test('gatilho-d', () => {
  const evs = expandir([inicio('s1'), notaDe('duvida', 'O painel mostra a hora?', 's1', ['sim', 'não', 'só em tela cheia'])]);
  const ps = perguntasAbertas(evs, identificada(), { sessao: 's1' });
  assert.equal(ps.length, 1);
  confere(ps[0], { id: 's1:2', gatilho: 'd', texto: 'O painel mostra a hora?', opcoes: ['sim', 'não', 'só em tela cheia'] });
  rotulosGravaveis(ps);
  // Sem entrega também pergunta (d); (b) não se ancora na nota que já é pergunta (ids nunca colidem).
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 's1' }).map((p) => p.gatilho), ['d']);
  const comTrabalho = expandir([inicio('s1'), notaDe('duvida', 'O painel mostra a hora?', 's1', ['sim', 'não']), branch('s1')]);
  const ps2 = perguntasAbertas(comTrabalho, trilha(), { sessao: 's1' });
  assert.deepEqual(ps2.map((p) => [p.gatilho, p.id]), [['d', 's1:2'], ['b', 's1:3']]);
  // Responder (d) não fecha (b), e vice-versa.
  const respD = expandir([inicio('s1'), notaDe('duvida', 'O painel mostra a hora?', 's1', ['sim', 'não']), branch('s1'), resp('s1:2', 1, 'sim')]);
  assert.deepEqual(perguntasAbertas(respD, trilha(), { sessao: 's1' }).map((p) => p.id), ['s1:3']);
});

test('pendencia-opcao-unica-feito', () => {
  const evs = expandir([inicio('s1'), notaDe('pendencia', 'criar o token do serviço de e-mail', 's1')]);
  const ps = perguntasAbertas(evs, identificada(), { sessao: 's1' });
  confere(ps[0], { id: 's1:2', gatilho: 'pendencia', texto: 'criar o token do serviço de e-mail', opcoes: ['feito'] });
  rotulosGravaveis(ps);
  // Só `dono.resposta` fecha: nota do modelo dizendo "feito" e `aprendizado.nada` não fecham.
  const naoFecha = expandir([inicio('s1'), notaDe('pendencia', 'criar o token', 's1'), notaDe('ideia', 'feito', 's1'),
    { t: 'aprendizado.nada', d: { motivo: 'feito' }, s: 's1' }]);
  assert.deepEqual(perguntasAbertas(naoFecha, identificada(), { sessao: 's1' }).map((p) => p.id), ['s1:2']);
  const fecha = expandir([inicio('s1'), notaDe('pendencia', 'criar o token', 's1'), resp('s1:2', 1, 'feito')]);
  assert.deepEqual(perguntasAbertas(fecha, identificada(), { sessao: 's1' }), []);
});

// ── ordem, fechamento e validação ───────────────────────────────────────────────────────────────────────────────────────────

test('duas-abertas-mais-antiga-primeiro', () => {
  // Sessões diferentes, ordem por tempo (não por nome de sessão nem por posição no arquivo).
  const evs = expandir([
    inicio('z9'), notaDe('duvida', 'primeira?', 'z9', ['a', 'b']),
    inicio('a1'), notaDe('pendencia', 'segunda', 'a1'),
    notaDe('duvida', 'terceira?', 'z9', ['c', 'd']),
  ]);
  // Arquivo com a sessão a1 antes da z9 (ordem por sessão preservada): a ordem é a do tempo.
  const arquivo = [...evs.filter((e) => e.sessao === 'a1'), ...evs.filter((e) => e.sessao === 'z9')];
  const ps = perguntasAbertas(arquivo, identificada(), { sessao: 'z9' });
  assert.deepEqual(ps.map((p) => p.id), ['z9:2', 'a1:2', 'z9:3']);
  assert.deepEqual(ps.map((p) => p.texto), ['primeira?', 'segunda', 'terceira?']);
  // Respondida a mais antiga, a seguinte sobe.
  const r = expandir([...evs.map((e) => ({ t: e.tipo, d: e.dados, s: e.sessao })), resp('z9:2', 1, 'a')]);
  assert.deepEqual(perguntasAbertas(r, identificada(), { sessao: 'z9' }).map((p) => p.id), ['a1:2', 'z9:3']);
});

test('resposta-hash-nao-fecha', () => {
  const evs = expandir([inicio('s1'), notaDe('duvida', 'qual?', 's1', ['x', 'y']), respHash('s1:2')]);
  const ps = perguntasAbertas(evs, identificada(), { sessao: 's1' });
  assert.deepEqual(ps.map((p) => p.id), ['s1:2']);
  assert.deepEqual(respostaValida(ps, 's1:2', 2, evs), { ok: true, rotulo: 'y' });
  // Resposta a OUTRA pergunta não fecha esta.
  const outra = expandir([inicio('s1'), notaDe('duvida', 'qual?', 's1', ['x', 'y']), resp('s1:9', 1, 'x')]);
  assert.deepEqual(perguntasAbertas(outra, identificada(), { sessao: 's1' }).map((p) => p.id), ['s1:2']);
});

test('respondida-x-inexistente-x-opcao-fora', () => {
  const evs = expandir([inicio('s1'), notaDe('duvida', 'qual?', 's1', ['x', 'y', 'z']), notaDe('duvida', 'outra?', 's1', ['m', 'n']),
    resp('s1:2', 1, 'x')]);
  const ps = perguntasAbertas(evs, identificada(), { sessao: 's1' });
  assert.deepEqual(ps.map((p) => p.id), ['s1:3']);
  assert.deepEqual(respostaValida(ps, 's1:2', 1, evs), { ok: false, erro: 'respondida' });
  assert.deepEqual(respostaValida(ps, 's1:2', 1), { ok: false, erro: 'inexistente' }); // sem eventos não há como saber
  assert.deepEqual(respostaValida(ps, 's1:7', 1, evs), { ok: false, erro: 'inexistente' });
  assert.deepEqual(respostaValida(ps, 'lixo', 1, evs), { ok: false, erro: 'inexistente' });
  for (const n of [0, 3, -1, 1.5, Number.NaN]) assert.deepEqual(respostaValida(ps, 's1:3', n, evs), { ok: false, erro: 'opcao_fora' }, String(n));
  assert.deepEqual(respostaValida(ps, 's1:3', 1, evs), { ok: true, rotulo: 'm' });
  assert.deepEqual(respostaValida(ps, 's1:3', 2, evs), { ok: true, rotulo: 'n' });
  // Resposta digitada (hash) não conta como respondida.
  const hash = expandir([inicio('s1'), notaDe('duvida', 'qual?', 's1', ['x', 'y']), respHash('s1:2')]);
  assert.deepEqual(respostaValida([], 's1:2', 1, hash), { ok: false, erro: 'inexistente' });
});

test('perguntas-diario-ausente-x-corrompido', () => {
  // Ausente: nada aberto, sem lançar.
  assert.deepEqual(perguntasAbertas([], trilha(), { sessao: 's1' }), []);
  assert.deepEqual(perguntasAbertas(undefined as unknown as Evento[], trilha(), { sessao: 's1' }), []);
  assert.deepEqual(perguntasAbertas(null as unknown as Evento[], trilha()), []);
  // Corrompido (ts inválido, `seq` fora de ordem, lixo): não ordena; segue a ordem do arquivo, a resposta gravada continua fechando
  // e nenhuma pergunta respondida volta.
  const evs = expandir([inicio('s1'), notaDe('duvida', 'qual?', 's1', ['x', 'y']), resp('s1:2', 1, 'x'), notaDe('pendencia', 'p', 's1')]);
  const corrompido = [...evs, { ...evs[0], ts: 'ontem' }, null as unknown as Evento, 'lixo' as unknown as Evento];
  const ps = perguntasAbertas(corrompido, identificada(), { sessao: 's1' });
  assert.deepEqual(ps.map((p) => p.id), ['s1:3']);
  assert.notDeepEqual(ps, perguntasAbertas([], identificada(), { sessao: 's1' }));
  assert.deepEqual(respostaValida(ps, 's1:2', 1, corrompido), { ok: false, erro: 'respondida' });
  // Trilha ausente ou malformada não lança.
  assert.doesNotThrow(() => perguntasAbertas(evs, null as unknown as Trilha));
});

test('sessao-fora-do-id-de-pergunta-nao-vira-pergunta-irrespondivel', () => {
  // `SESSAO_RE` do diário aceita `.` e `_`; `ID_PERGUNTA_RE` não: a pergunta seria irrespondível pelo hook.
  const evs = expandir([inicio('a_b'), notaDe('duvida', 'qual?', 'a_b', ['x', 'y']), notaDe('pendencia', 'p', 'a.b')]);
  assert.deepEqual(perguntasAbertas(evs, identificada(), { sessao: 'a_b' }), []);
  assert.deepEqual(perguntasAbertas(evs, trilha(), { sessao: 'a_b' }), []);
});

test('tipos-de-nota-em-caixa-diferente-nao-abrem', () => {
  // Classificação de tipo é exata: o diário só aceita minúsculas; "Duvida"/"ASSUNTO" não são gatilho.
  const evs = expandir([inicio('s1'), notaDe('Duvida', 'x?', 's1', ['a', 'b']), notaDe('ASSUNTO', 'y', 's1'), notaDe('Pendencia', 'z', 's1')]);
  assert.deepEqual(perguntasAbertas(evs, identificada(), { sessao: 's1' }), []);
});

test('textos-fixos-sem-linha-tecnica-nem-palavra-tipo', async () => {
  // Pendência T12/T17: o render não pode casar a regex técnica (LNG-1) nem trazer palavra que é tipo de evento ou motivo de parada.
  const { REGEX_TECNICA } = await import('../src/origem.ts');
  const { TIPOS_EVENTO, MOTIVOS_PARAR } = await import('../src/formas.ts');
  const palavras = [...TIPOS_EVENTO, ...MOTIVOS_PARAR].filter((t) => /^[a-z]+$/.test(t));
  assert.ok(palavras.includes('nota') && palavras.includes('smoke'));
  const evs = expandir([inicio('s1'), notaDe('assunto', 'x', 's1'), branch('s1'), specMedida(SPEC1, A, 's1'), specMedida(SPEC2, B, 's1')]);
  const textos = [
    ...perguntasAbertas(evs, trilha({ ultimaConhecida: 'GM-13' }), { sessao: 's1' }),
    ...perguntasAbertas(evs, trilha(), { sessao: 's1' }),
    ...perguntasAbertas(evs, trilha({ candidato: 'GM-20' }), { sessao: 's1' }),
    ...perguntasAbertas(evs, identificada({ ambigua: [spec(SPEC1, 'Trilha'), spec(SPEC2, 'Painel', B)] }), { sessao: 's1' }),
    ...perguntasAbertas(expandir([inicio('s1'), notaDe('pendencia', 'x', 's1')]), identificada(), { sessao: 's1' }),
  ].flatMap((p) => [p.texto, ...p.opcoes]).filter((t) => t !== 'x');
  assert.ok(textos.length >= 15);
  for (const t of textos) {
    assert.ok(!REGEX_TECNICA.test(t), `técnica: ${t}`);
    for (const w of palavras) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(t), `palavra-tipo ${w}: ${t}`);
  }
});

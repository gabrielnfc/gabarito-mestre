/**
 * Testes de `painel-equipe` (GM-12 T3): pacotes de nomes, sorteio, nome por papel, uso do transcript e `projetarEquipe`.
 * Mutações prescritas (.superpowers/sdd/2026-11-09-e4-painel/task-3-mut.json):
 *  MUT-PNL-5   Sombra some / % com modelo diferente        ⇒ `sombra-sempre-presente`, `pct-modelo-diferente-null`
 *  MUT-PNL-6   sorteio repete o anterior / nome muda        ⇒ `sorteio-nao-repete-anterior`, `nome-estavel-na-sessao`
 *  MUT-PNL-15  contexto soma output / sem dedupe / ausente 0 ⇒ `uso-contexto-sem-output`, `uso-dedupe-message-id`, `uso-ausente-x-corrompido`
 *  (demais no JSON: cache_read no tok, `<synthetic>` aceito, ENCERRADO sem idle, texto pelo estado, agentes null como [], ordem de cor antiga, node:crypto)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { casarAgente, nomesPorPapel, projetarEquipe, sortearPacote, usoDoTranscript, validarPacote } from '../src/painel-equipe.ts';
import { projetarDecisoes } from '../src/sombra.ts';
import type { AgenteVivo, EntradaPainel, Evento, PacoteNomes, Plano, TipoEvento } from '../src/tipos.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const NOMES_DIR = join(AQUI, '..', '..', 'mod', 'temas', 'nomes');
const FABRICA = ['terra-media', 'herois', 'galaxia', 'hogwarts'];
const lerPacote = (id: string): unknown => JSON.parse(readFileSync(join(NOMES_DIR, `${id}.json`), 'utf8'));
const pacoteDe = (id: string): PacoteNomes => {
  const r = validarPacote(lerPacote(id));
  if (!r.ok) throw new Error(r.erro);
  return r.pacote;
};
const TM = pacoteDe('terra-media');

const PLANO: Plano = {
  entrega: 'GM-12',
  tasks: ['T07', 'T08', 'T09', 'T10'].map((id) => ({ id, deps: [], arquivos: [] })),
};
const AGORA = Date.parse('2026-11-09T15:00:00.000Z');

let SEQ = 0;
const ev = (tipo: TipoEvento, dados: Record<string, unknown>, ts = '2026-11-09T12:00:00.000Z', sessao = 's1', agente = 'orquestrador'): Evento => ({
  seq: ++SEQ, ts, autor: 'dev@x', sessao, agente, tipo, dados, hash_anterior: null,
});
/** Diário em `seq` crescente por sessão; `ts` sobe 1 min por evento a partir de 12:00Z para a ordem ser a de escrita. */
function diario(...itens: [TipoEvento, Record<string, unknown>][]): Evento[] {
  SEQ = 0;
  return itens.map(([t, d], i) => ev(t, d, new Date(Date.parse('2026-11-09T12:00:00.000Z') + i * 60_000).toISOString()));
}
const ini = (task: string, papel: string, extra: Record<string, unknown> = {}): [TipoEvento, Record<string, unknown>] => ['task.iniciada', { task, papel, ...extra }];
const concl = (task: string): [TipoEvento, Record<string, unknown>] => ['task.concluida', { task }];

function entrada(extra: Partial<EntradaPainel> = {}): EntradaPainel {
  return {
    decisaoEntrega: null, pausado: false, contexto: { percent: 36, tokens: 72_000, window: 200_000 }, limites: { h5: 42, d7: 18 }, x: 50,
    agentes: [], pacote: TM, notificacao: null, agoraMs: AGORA, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
    base: 'main', entregaId: 'GM-12', modeloSessao: 'claude-opus-4-8', specSha: null, tetoSombra: 26, ...extra,
  };
}
const ag = (description: string, extra: Partial<AgenteVivo> = {}): AgenteVivo => ({ id: `a-${description}`, type: 'general-purpose', description, status: 'running', uso: null, ...extra });
const uso = (contexto: number, modelo: string | null = 'claude-opus-4-8', tok = 1000): NonNullable<AgenteVivo['uso']> => ({ contexto, tok, modelo });

// ---------- pacotes ----------

test('pacotes-de-fabrica-validos', () => {
  const esperado: Record<string, [string, string]> = { 'terra-media': ['GANDALF', 'ELROND'], herois: ['CAPITÃO', 'STRANGE'], galaxia: ['LEIA', 'YODA'], hogwarts: ['MINERVA', 'DUMBLEDORE'] };
  for (const id of FABRICA) {
    const r = validarPacote(lerPacote(id));
    assert.ok(r.ok, `${id}: ${r.ok ? '' : r.erro}`);
    if (!r.ok) continue;
    assert.equal(r.pacote.lider, esperado[id][0], id);
    assert.equal(r.pacote.sabio, esperado[id][1], id);
    assert.ok(r.pacote.nomes.length >= 8, id);
    assert.ok(r.pacote.nome.length > 0, id);
  }
  assert.equal(pacoteDe('terra-media').nome, 'Terra Média');
  assert.equal(pacoteDe('galaxia').nome, 'Galáxia distante');
});

const valido = (): PacoteNomes => ({ nome: 'teste', lider: 'ALFA', sabio: 'BETA', nomes: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'] });
const recusa = (p: unknown, trecho?: RegExp) => {
  const r = validarPacote(p);
  assert.equal(r.ok, false, JSON.stringify(p));
  if (!r.ok && trecho) assert.match(r.erro, trecho);
};

test('pacote-7-nomes-recusa', () => {
  recusa({ ...valido(), nomes: valido().nomes.slice(0, 7) });
  assert.equal(validarPacote({ ...valido(), nomes: valido().nomes.slice(0, 8) }).ok, true);
});

test('pacote-nome-11-colunas-recusa', () => {
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'ABCDEFGHIJK'] }, /7/);
  assert.equal(validarPacote({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'ABCDEFGHIJ'] }).ok, true, '10 colunas passa');
});

test('pacote-lider-em-nomes-recusa', () => {
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'ALFA'] });
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'BETA'] });
  recusa({ ...valido(), sabio: 'ALFA' }); // lider === sabio
});

test('pacote-minuscula-recusa', () => {
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'légolas'] }, /7/);
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'GANDALF THE GREY'] }, /7/); // > 10 e espaço
  recusa({ ...valido(), lider: 'alfa' });
  recusa({ ...valido(), sabio: 'be ta' });
});

test('pacote-largo-recusa', () => {
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), '李'] }, /7/);
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'A\u001b[31m'] });
  recusa({ ...valido(), lider: '李' });
  recusa({ ...valido(), nome: '李'.repeat(11) }); // 22 colunas
});

test('pacote-nome-mede-com-a-colunas-do-painel (T4 desvio 4)', () => {
  const ok = (nome: string) => assert.equal(validarPacote({ ...valido(), nome }).ok, true, JSON.stringify(nome));
  ok('x'.repeat(20) + '\u0301'); // marca vale 0
  ok('x'.repeat(20) + '\u200b'); // ZWSP vale 0
  ok('👍🏽'.repeat(10)); // 10 × 2
  recusa({ ...valido(), nome: '👍🏽'.repeat(11) }); // 22
  recusa({ ...valido(), nome: `x${'\u202e'}y` }); // bidi: controle recusado
  recusa({ ...valido(), nome: 'a\u009bb' }); // C1
});

test('pacote-forma-recusa', () => {
  for (const ruim of [null, undefined, 'x', 42, [], [valido()]]) recusa(ruim, /objeto/);
  recusa({ ...valido(), nome: '' });
  recusa({ ...valido(), nome: 'x'.repeat(21) });
  recusa({ ...valido(), nome: 42 });
  recusa({ ...valido(), lider: undefined });
  recusa({ ...valido(), sabio: undefined });
  recusa({ ...valido(), nomes: 'A1' });
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 'A1'] }); // repetido
  recusa({ ...valido(), nomes: [...valido().nomes.slice(0, 7), 42] });
});

test('pacote-ok-copia-sem-campos-extras', () => {
  const entrada = { ...valido(), extra: 'x' };
  const r = validarPacote(entrada);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.pacote, valido());
  assert.notEqual(r.pacote.nomes, entrada.nomes);
});

// ---------- sorteio ----------

const IDS = ['terra-media', 'herois', 'galaxia', 'hogwarts'];

test('sorteio-nao-repete-anterior', () => {
  for (let i = 0; i < 200; i++) {
    for (const anterior of IDS) assert.notEqual(sortearPacote(`sessao-${i}`, IDS, anterior), anterior, `sessao-${i}`);
  }
});

test('sorteio-deterministico', () => {
  assert.equal(sortearPacote('abc', IDS, null), sortearPacote('abc', IDS, null));
  assert.equal(sortearPacote('abc', IDS, 'herois'), sortearPacote('abc', IDS, 'herois'));
  // ordem de `nomes` não muda o resultado (candidatos ordenados), e há variedade entre sessões
  assert.equal(sortearPacote('abc', [...IDS].reverse(), null), sortearPacote('abc', IDS, null));
  const vistos = new Set(Array.from({ length: 100 }, (_, i) => sortearPacote(`s${i}`, IDS, null)));
  assert.equal(vistos.size, 4);
  // valor fixo: FNV-1a 32 de 'abc' = 0x1A47E90B; candidatos ordenados por código
  const ordenados = [...IDS].sort();
  assert.equal(sortearPacote('abc', IDS, null), ordenados[0x1a47e90b % 4]);
});

test('sortear-so-anterior-repete', () => {
  assert.equal(sortearPacote('x', ['terra-media'], 'terra-media'), 'terra-media');
  assert.equal(sortearPacote('x', ['terra-media', 'terra-media'], 'terra-media'), 'terra-media');
});

test('sortear-lista-vazia-fabrica', () => {
  assert.equal(sortearPacote('x', [], null), 'terra-media');
  assert.equal(sortearPacote('x', [], 'herois'), 'terra-media');
});

test('sortear-anterior-desconhecido', () => {
  const r = sortearPacote('abc', IDS, 'nao-existe');
  assert.ok(IDS.includes(r));
  assert.equal(r, sortearPacote('abc', IDS, null)); // nada é excluído
  assert.ok(Number.isFinite(IDS.indexOf(sortearPacote(42 as unknown as string, IDS, null))));
  assert.equal(sortearPacote(42 as unknown as string, IDS, null), sortearPacote('', IDS, null)); // sessionId não texto = hash de ''
});

test('sortear-sem-node', () => {
  const fonte = readFileSync(join(AQUI, '..', 'src', 'painel-equipe.ts'), 'utf8');
  const dist = readFileSync(join(AQUI, '..', 'dist', 'painel-equipe.js'), 'utf8');
  for (const [nome, texto] of [['src', fonte], ['dist', dist]]) {
    assert.doesNotMatch(texto, /(?:from|import|require)\s*\(?\s*['"]node:/, `${nome}/painel-equipe importa node:*`);
    assert.doesNotMatch(texto, /\bcreateHash\b|\bsha256\b/i, `${nome}/painel-equipe usa hash do node`);
  }
  // transitivo: nenhum import do módulo (nem os deles) toca `node:`; é o que o mod carrega
  const vistos = new Set<string>();
  const visitar = (arq: string) => {
    if (vistos.has(arq)) return;
    vistos.add(arq);
    const t = readFileSync(join(AQUI, '..', 'dist', arq), 'utf8');
    assert.doesNotMatch(t, /^import\b[^\n]*['"]node:/m, `${arq} importa node:*`);
    for (const m of t.matchAll(/from\s+['"]\.\/([^'"]+\.js)['"]/g)) visitar(m[1]);
  };
  visitar('painel-equipe.js');
  assert.ok(vistos.has('loop.js') && vistos.has('painel-hora.js'));
});

// ---------- nomes por papel ----------

const par = (m: Map<string, string>, k: string): string => {
  const v = m.get(k);
  assert.ok(v !== undefined, `sem nome para ${k}`);
  return v;
};

test('nome-por-par-na-ordem-do-1o-iniciada', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'), concl('T07'), ini('T07', 'revisor'));
  const m = nomesPorPapel(eventos, TM);
  assert.equal(par(m, 'T07:trabalho'), TM.nomes[0]);
  assert.equal(par(m, 'T08:trabalho'), TM.nomes[1]);
  assert.equal(par(m, 'T07:revisor'), TM.nomes[2]);
  assert.equal(m.size, 3);
});

test('nome-estavel-na-sessao', () => {
  const base = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const antes = nomesPorPapel(base, TM);
  const depois = nomesPorPapel([...base, ev('task.iniciada', { task: 'T09', papel: 'implementador' }, '2026-11-09T13:00:00.000Z')], TM);
  for (const [k, v] of antes) assert.equal(depois.get(k), v, k);
  assert.equal(par(depois, 'T09:trabalho'), TM.nomes[2]);
});

test('nome-ciclo-apos-esgotar', () => {
  const n = TM.nomes.length;
  const itens = Array.from({ length: n + 2 }, (_, i): [TipoEvento, Record<string, unknown>] => ini(`T${String(i).padStart(2, '0')}`, 'implementador'));
  const m = nomesPorPapel(diario(...itens), TM);
  assert.equal(m.size, n + 2);
  assert.equal(par(m, `T${String(n).padStart(2, '0')}:trabalho`), TM.nomes[0], 'o (n+1)º par volta ao 1º nome');
  assert.equal(par(m, `T${String(n + 1).padStart(2, '0')}:trabalho`), TM.nomes[1]);
});

test('nome-reaberta-dono-mantem', () => {
  const eventos = diario(
    ini('T07', 'implementador'), ini('T08', 'implementador'), concl('T07'),
    ['task.reaberta', { task: 'T07', origem: 'dono' }], ini('T09', 'implementador'),
  );
  const m = nomesPorPapel(eventos, TM);
  assert.equal(par(m, 'T07:trabalho'), TM.nomes[0]);
  assert.equal(par(m, 'T09:trabalho'), TM.nomes[2]);
  // correção divide o par de trabalho com o implementador
  const c = nomesPorPapel(diario(ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'), ini('T07', 'correcao')), TM);
  assert.equal(par(c, 'T07:trabalho'), TM.nomes[0]);
  assert.equal(par(c, 'T07:revisor'), TM.nomes[1]);
  assert.equal(c.size, 2);
});

test('nomes-diario-invalido-null', () => {
  const a = ev('task.iniciada', { task: 'T07', papel: 'implementador' }, '2026-11-09T12:00:00.000Z');
  const b: Evento = { ...ev('task.iniciada', { task: 'T08', papel: 'implementador' }, '2026-11-09T12:01:00.000Z'), seq: a.seq }; // seq não cresce
  const m = nomesPorPapel([a, b], TM);
  assert.equal(m.size, 0);
  assert.equal(nomesPorPapel(null as unknown as Evento[], TM).size, 0);
  // e pela equipe: todo nome null, sem lançar
  const eq = projetarEquipe(PLANO, [a, b], entrada({ agentes: [ag('T07 implementador')] }));
  assert.equal(eq.agentes.length, 1);
  assert.equal(eq.agentes[0].nome, null);
  assert.equal(eq.agentes[0].cor, 'inactive');
});

test('nomes-papel-invalido-ignorado', () => {
  const m = nomesPorPapel(diario(ini('T07', 'sombra'), ini('T07', 'implementador'), ['task.iniciada', { papel: 'revisor' }]), TM);
  assert.equal(m.size, 1);
  assert.equal(par(m, 'T07:trabalho'), TM.nomes[0]);
});

test('nomes-limite-ordenar-intercala-por-ts', () => {
  // limite declarado (sombra-p1a T3): evento de outra sessão com ts anterior reordena os pares e pode trocar nomes
  const a = ev('task.iniciada', { task: 'T07', papel: 'implementador' }, '2026-11-09T12:00:00.000Z', 's1');
  const b = ev('task.iniciada', { task: 'T08', papel: 'implementador' }, '2026-11-09T12:10:00.000Z', 's1');
  const antes = nomesPorPapel([a, b], TM);
  const intruso = ev('task.iniciada', { task: 'T09', papel: 'implementador' }, '2026-11-09T11:00:00.000Z', 's2');
  const depois = nomesPorPapel([a, b, intruso], TM);
  assert.equal(par(antes, 'T07:trabalho'), TM.nomes[0]);
  assert.equal(par(depois, 'T09:trabalho'), TM.nomes[0]);
  assert.equal(par(depois, 'T07:trabalho'), TM.nomes[1], 'o nome de T07 mudou: limite documentado, não corrigido');
});

// ---------- casarAgente ----------

test('descricao-quase-igual-sem-task', () => {
  const eventos = diario(ini('T07', 'implementador'));
  for (const d of ['T07  implementador', 't07 implementador', 'T07 Implementador', 'T07 implementador extra', 'T99 implementador', 'T07 sombra', 'T07', '', 'implementador T07', 'T07\timplementador']) {
    assert.equal(casarAgente(d, PLANO), null, d);
    const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag(d)] }));
    const vivos = eq.agentes.filter((a) => a.vivo);
    assert.equal(vivos.length, 1, d);
    assert.deepEqual([vivos[0].nome, vivos[0].papel, vivos[0].task, vivos[0].estadoTask, vivos[0].cor], [null, null, undefined, null, 'inactive'], d);
  }
});

test('casar-agente-trim-e-nao-texto', () => {
  assert.deepEqual(casarAgente(' T07 implementador ', PLANO), { task: 'T07', papel: 'implementador' });
  assert.deepEqual(casarAgente('T08 revisor', PLANO), { task: 'T08', papel: 'revisor' });
  assert.deepEqual(casarAgente('T09 correcao', PLANO), { task: 'T09', papel: 'correcao' });
  for (const ruim of [42, null, undefined, {}, ['T07 implementador']]) assert.equal(casarAgente(ruim as unknown as string, PLANO), null);
  const eq = projetarEquipe(PLANO, [], entrada({ agentes: [ag(42 as unknown as string)] }));
  assert.equal(eq.agentes.length, 1);
  assert.equal(eq.agentes[0].task, undefined);
});

// ---------- agentes ----------

test('task-sem-agente-sem-agente', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(50_000) })] }));
  const sem = eq.agentes.filter((a) => !a.vivo);
  assert.equal(sem.length, 1);
  assert.deepEqual(
    [sem[0].task, sem[0].papel, sem[0].estadoTask, sem[0].nome, sem[0].ctxPct, sem[0].ctxTok, sem[0].tok],
    ['T08', 'implementador', 'implementando', TM.nomes[1], null, null, null],
  );
  const vivo = eq.agentes.find((a) => a.vivo);
  assert.equal(vivo?.task, 'T07');
  assert.equal(vivo?.nome, TM.nomes[0]);
});

test('agentes-null-sem-sem-agente', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const nulo = projetarEquipe(PLANO, eventos, entrada({ agentes: null }));
  assert.deepEqual(nulo.agentes, []);
  const vazio = projetarEquipe(PLANO, eventos, entrada({ agentes: [] }));
  assert.deepEqual(vazio.agentes.map((a) => [a.task, a.vivo]), [['T07', false], ['T08', false]]);
  // o revisor aguardando não depende de haver mod
  const conc = diario(ini('T07', 'implementador'), concl('T07'));
  assert.deepEqual(projetarEquipe(PLANO, conc, entrada({ agentes: null })).revisoresAguardando.map((r) => r.task), ['T07']);
});

test('encerrado-fora', () => {
  const eventos = diario(ini('T07', 'implementador'));
  for (const status of ['idle', 'completed', 'failed', 'killed']) {
    const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { status })] }));
    assert.equal(eq.agentes.filter((a) => a.vivo).length, 0, status);
    assert.equal(eq.agentes.filter((a) => !a.vivo).length, 1, `${status}: a task fica sem agente`);
  }
  for (const status of ['running', 'pending', 'waiting']) {
    assert.equal(projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { status })] })).agentes.filter((a) => a.vivo).length, 1, status);
  }
});

test('status-desconhecido-vivo', () => {
  const eventos = diario(ini('T07', 'implementador'));
  for (const status of [42, null, undefined, 'esquisito'] as unknown[]) {
    const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { status: status as string })] }));
    assert.equal(eq.agentes.filter((a) => a.vivo).length, 1, String(status));
  }
});

test('linha-pelo-papel-nao-pelo-estado', () => {
  // implementador vivo com a task já em em_revisao: a linha diz implementador; o revisor ausente vira ◌
  const eventos = diario(ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador')] }));
  const vivo = eq.agentes.find((a) => a.vivo);
  assert.deepEqual([vivo?.papel, vivo?.estadoTask, vivo?.nome], ['implementador', 'em_revisao', TM.nomes[0]]);
  const sem = eq.agentes.find((a) => !a.vivo);
  assert.deepEqual([sem?.papel, sem?.task, sem?.estadoTask, sem?.nome], ['revisor', 'T07', 'em_revisao', TM.nomes[1]]);
  // com o revisor vivo, o ◌ some
  const ok = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 revisor')] }));
  assert.deepEqual(ok.agentes.map((a) => [a.papel, a.vivo]), [['revisor', true], ]);
});

test('dois-vivos-mesmo-par', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador'), { ...ag('T07 implementador'), id: 'outro' }] }));
  assert.equal(eq.agentes.length, 2);
  assert.equal(eq.agentes[0].nome, TM.nomes[0]);
  assert.equal(eq.agentes[1].nome, TM.nomes[0]);
});

test('corrigindo-espera-agente-correcao', () => {
  const eventos = diario(
    ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'),
    ['review.veredito', { task: 'T07', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }], ini('T07', 'correcao'),
  );
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 correcao')] }));
  assert.deepEqual(eq.agentes.map((a) => [a.papel, a.estadoTask, a.vivo, a.nome]), [['correcao', 'corrigindo', true, TM.nomes[0]]]);
  const sem = projetarEquipe(PLANO, eventos, entrada({ agentes: [] }));
  assert.deepEqual(sem.agentes.map((a) => [a.papel, a.vivo]), [['correcao', false]]);
});

test('cor-ordem-global', () => {
  const eventos = diario(...TM.nomes.slice(0, 6).map((_, i) => ini(`T${String(i).padStart(2, '0')}`, 'implementador')));
  const plano: Plano = { entrega: 'x', tasks: TM.nomes.slice(0, 6).map((_, i) => ({ id: `T${String(i).padStart(2, '0')}`, deps: [], arquivos: [] })) };
  const eq = projetarEquipe(plano, eventos, entrada({ agentes: plano.tasks.map((t) => ag(`${t.id} implementador`)) }));
  assert.deepEqual(eq.agentes.map((a) => a.cor), ['claude', 'suggestion', 'autoAccept', 'ide', 'remember', 'claude']);
  assert.deepEqual(eq.agentes.map((a) => a.nome), TM.nomes.slice(0, 6));
});

test('agente-modelo-e-tempo', () => {
  const eventos = diario(ini('T07', 'implementador', { modelo: 'sonnet' }), ini('T08', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({
    agentes: [ag('T07 implementador', { uso: uso(10, 'claude-haiku-4-5') }), ag('T08 implementador', { uso: uso(10, '<x>') })],
  }));
  assert.equal(eq.agentes[0].modelo, 'haiku', 'família do uso vence a do despacho');
  const sem = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador'), ag('T08 implementador')] }));
  assert.equal(sem.agentes[0].modelo, 'sonnet', 'sem uso, o modelo do despacho');
  assert.equal(sem.agentes[1].modelo, null, 'nem uso nem despacho');
  // desdeS: do último task.iniciada do par, nunca negativo
  const ts = '2026-11-09T14:50:00.000Z';
  const e2 = [ev('task.iniciada', { task: 'T07', papel: 'implementador' }, ts)];
  assert.equal(projetarEquipe(PLANO, e2, entrada({ agentes: [ag('T07 implementador')] })).agentes[0].desdeS, 600);
  const futuro = [ev('task.iniciada', { task: 'T07', papel: 'implementador' }, '2099-01-01T00:00:00.000Z')];
  assert.equal(projetarEquipe(PLANO, futuro, entrada({ agentes: [ag('T07 implementador')] })).agentes[0].desdeS, 0);
  // sem task.iniciada do par (task fora de voo) ⇒ null
  assert.equal(projetarEquipe(PLANO, [], entrada({ agentes: [ag('T07 implementador')] })).agentes[0].desdeS, null);
});

test('agente-desde-do-ultimo-iniciada-do-par', () => {
  // o par de trabalho tem dois despachos (implementador e depois correção): o tempo vale desde o último
  SEQ = 0;
  const eventos = [
    ev('task.iniciada', { task: 'T07', papel: 'implementador', modelo: 'haiku' }, '2026-11-09T13:00:00.000Z'),
    ev('task.concluida', { task: 'T07' }, '2026-11-09T13:10:00.000Z'),
    ev('task.iniciada', { task: 'T07', papel: 'revisor' }, '2026-11-09T13:20:00.000Z'),
    ev('review.veredito', { task: 'T07', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }, '2026-11-09T13:40:00.000Z'),
    ev('task.iniciada', { task: 'T07', papel: 'correcao', modelo: 'opus' }, '2026-11-09T14:30:00.000Z'),
  ];
  const [a] = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 correcao')] })).agentes;
  assert.equal(a.desdeS, 1800);
  assert.equal(a.modelo, 'opus');
  assert.equal(a.estadoTask, 'corrigindo');
});

// ---------- % de contexto ----------

test('agente-sem-task-leva-o-uso', () => {
  // `sem task` (D3) continua com modelo, contexto e tokens do transcript: só nome, papel e task faltam
  const eq = projetarEquipe(PLANO, [], entrada({ agentes: [ag('spike qualquer', { uso: uso(88_000, 'claude-opus-4-8', 4321) })] }));
  const [a] = eq.agentes;
  assert.deepEqual([a.modelo, a.ctxPct, a.ctxTok, a.tok, a.desdeS, a.vivo], ['opus', 44, 88_000, 4321, null, true]);
});

test('pct-mesmo-modelo', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(88_000, 'claude-opus-4-8', 5000) })] }));
  assert.deepEqual([eq.agentes[0].ctxPct, eq.agentes[0].ctxTok, eq.agentes[0].tok], [44, 88_000, 5000]);
  // arredonda (round) e não corta em 100
  const r = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(61_300) })] }));
  assert.equal(r.agentes[0].ctxPct, 31); // 30,65
  const c = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(250_000) })] }));
  assert.equal(c.agentes[0].ctxPct, 125);
});

test('pct-modelo-diferente-null', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(88_000, 'claude-sonnet-4-6') })] }));
  assert.equal(eq.agentes[0].ctxPct, null);
  assert.equal(eq.agentes[0].ctxTok, 88_000, 'os tokens continuam');
  const semModelo = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(88_000, null) })] }));
  assert.equal(semModelo.agentes[0].ctxPct, null);
});

test('pct-janela-1m-limite-declarado (D11, T3): o id do modelo com sufixo de janela não casa ⇒ null; o resto é limite (b) para o spike', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const pct = (modeloSessao: string, modeloAgente: string) =>
    projetarEquipe(PLANO, eventos, entrada({ modeloSessao, agentes: [ag('T07 implementador', { uso: uso(88_000, modeloAgente) })] })).agentes[0].ctxPct;
  assert.equal(pct('claude-opus-4-8[1m]', 'claude-opus-4-8'), null, 'sessão em 1M × agente no id puro: a janela é outra, o % some em vez de mentir');
  assert.equal(pct('claude-opus-4-8', 'claude-opus-4-8[1m]'), null);
  assert.equal(pct('claude-opus-4-8', 'claude-opus-4-8'), 44, 'mesmo id exato: janela da sessão (200k) ⇒ 44 %');
  // LIMITE (b), não resolvido aqui: se o CLI entregar `modeloSessao` SEM o sufixo mesmo com a sessão em 1M e o agente em 200k, o % (sobre a janela da sessão) sai 5× menor que o real.
});

test('pct-modelo-sessao-null', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ modeloSessao: null, agentes: [ag('T07 implementador', { uso: uso(88_000, null) })] }));
  assert.equal(eq.agentes[0].ctxPct, null, 'null === null não vale');
});

test('pct-window-zero-null', () => {
  const eventos = diario(ini('T07', 'implementador'));
  for (const window of [0, null, -5, Number.NaN]) {
    const eq = projetarEquipe(PLANO, eventos, entrada({ contexto: { percent: 1, tokens: 1, window }, agentes: [ag('T07 implementador', { uso: uso(88_000) })] }));
    assert.equal(eq.agentes[0].ctxPct, null, String(window));
  }
});

test('uso-null-ctx-null', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: null })] }));
  assert.deepEqual([eq.agentes[0].ctxTok, eq.agentes[0].ctxPct, eq.agentes[0].tok], [null, null, null], 'ausente nunca é 0');
});

// ---------- uso do transcript ----------

const linha = (message: Record<string, unknown>): string => JSON.stringify({ type: 'assistant', message });
const U = (input: number, output: number, read?: number, creation?: number): Record<string, number> => {
  const u: Record<string, number> = { input_tokens: input, output_tokens: output };
  if (read !== undefined) u.cache_read_input_tokens = read;
  if (creation !== undefined) u.cache_creation_input_tokens = creation;
  return u;
};

test('uso-contexto-sem-output', () => {
  const u = usoDoTranscript([linha({ id: 'm1', model: 'claude-opus-4-8', usage: U(10, 700, 80_000, 12_000) })]);
  assert.deepEqual(u, { contexto: 92_010, tok: 10 + 700 + 12_000, modelo: 'claude-opus-4-8' });
  // contexto = da ÚLTIMA linha aceita
  const dois = usoDoTranscript([linha({ id: 'm1', model: 'a', usage: U(1, 1, 1, 1) }), linha({ id: 'm2', model: 'a', usage: U(5, 99, 20, 30) })]);
  assert.equal(dois?.contexto, 55);
});

test('uso-dedupe-message-id', () => {
  const u = usoDoTranscript([
    linha({ id: 'm1', model: 'a', usage: U(10, 5, 0, 100) }),
    linha({ id: 'm1', model: 'a', usage: U(10, 90, 0, 100) }), // mesmo id, output cresce
    linha({ id: 'm1', model: 'a', usage: U(10, 60, 0, 150) }), // maior valor por campo, não o último
    linha({ id: 'm2', model: 'a', usage: U(7, 3, 0, 0) }),
  ]);
  assert.equal(u?.tok, (10 + 90 + 150) + (7 + 3 + 0));
});

test('uso-tok-sem-cache-read', () => {
  const u = usoDoTranscript([linha({ id: 'm1', model: 'a', usage: U(10, 20, 9_000_000, 30) })]);
  assert.equal(u?.tok, 60);
  assert.equal(u?.contexto, 10 + 9_000_000 + 30);
});

test('uso-modelo-ignora-synthetic', () => {
  const u = usoDoTranscript([
    linha({ id: 'm1', model: 'claude-opus-4-8', usage: U(10, 5, 1000, 0) }),
    linha({ id: 'm2', model: '<synthetic>', usage: U(0, 0, 0, 0) }),
  ]);
  assert.equal(u?.modelo, 'claude-opus-4-8');
  assert.equal(u?.contexto, 1010, 'contexto da linha real anterior, não 0');
  assert.equal(u?.tok, 15);
});

test('uso-synthetic-ignorado', () => {
  assert.equal(usoDoTranscript([linha({ id: 's', model: '<synthetic>', usage: U(100, 100, 100, 100) })]), null);
  const u = usoDoTranscript([linha({ id: 'm1', model: 'a', usage: U(1, 1, 0, 0) }), linha({ id: 's', model: '<synthetic>', usage: U(500, 500, 500, 500) })]);
  assert.deepEqual(u, { contexto: 1, tok: 2, modelo: 'a' });
});

test('uso-ausente-x-corrompido', () => {
  assert.equal(usoDoTranscript([]), null);
  assert.equal(usoDoTranscript(['', 'lixo', '{"usage":', '[', 'null']), null);
  assert.equal(usoDoTranscript([JSON.stringify({ message: { id: 'x' } })]), null, 'sem usage');
  assert.equal(usoDoTranscript(null as unknown as string[]), null);
  // linhas tortas são ignoradas; a válida vale (nunca {0,0})
  const u = usoDoTranscript(['{"message":{"usage":', 'lixo "usage"', linha({ id: 'm1', model: 'a', usage: U(3, 4, 0, 0) }), '{"message":{"id":"m9","usage":{"input_tokens":5,']);
  assert.deepEqual(u, { contexto: 3, tok: 7, modelo: 'a' });
  // não texto
  assert.equal(usoDoTranscript([42, null, {}] as unknown as string[]), null);
});

test('agente-uso-tok-ausente-ou-corrompido-nunca-0 (T3 MINOR 1)', () => {
  const tok = (u: unknown) => projetarEquipe(PLANO, diario(ini('T07', 'implementador')), entrada({ agentes: [ag('T07 implementador', { uso: u as AgenteVivo['uso'] })] })).agentes[0];
  for (const ruim of ['lixo', undefined, null, -1, NaN, Infinity, '12', {}]) {
    const a = tok({ contexto: 5000, tok: ruim, modelo: 'claude-opus-4-8' });
    assert.equal(a.tok, null, `tok=${String(ruim)} ⇒ null, nunca 0`);
    assert.equal(a.ctxTok, 5000, 'o contexto válido segue');
  }
  assert.equal(tok({ contexto: 5000, modelo: 'claude-opus-4-8' }).tok, null, 'sem o campo');
  assert.equal(tok({ contexto: 5000, tok: 0, modelo: 'claude-opus-4-8' }).tok, 0, 'medido zero é 0');
  assert.equal(tok({ contexto: 5000, tok: 1234, modelo: 'claude-opus-4-8' }).tok, 1234);
  // agente sem task casada (sem task) segue a mesma regra
  const semTask = projetarEquipe(PLANO, [], entrada({ agentes: [ag('sombra x', { uso: { contexto: 10, tok: 'lixo', modelo: null } as unknown as AgenteVivo['uso'] })] })).agentes[0];
  assert.equal(semTask.tok, null);
});

test('uso-campo-invalido-descarta-linha', () => {
  const boa = linha({ id: 'm1', model: 'a', usage: U(1, 1, 0, 0) });
  for (const ruim of [
    { id: 'm2', model: 'a', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: '12' } },
    { id: 'm2', model: 'a', usage: { input_tokens: -5, output_tokens: 1 } },
    { id: 'm2', model: 'a', usage: { input_tokens: 5, output_tokens: Number.NaN } },
    { id: 'm2', model: 'a', usage: { input_tokens: 5, output_tokens: 'x' } },
    { id: 'm2', model: 'a', usage: { input_tokens: 5, cache_creation_input_tokens: null } },
    { id: 'm2', model: 'a', usage: 'x' },
    { id: 'm2', model: 'a', usage: [1, 2] },
    { id: 'm2', model: 'a', usage: null },
  ]) {
    assert.deepEqual(usoDoTranscript([boa, linha(ruim)]), { contexto: 1, tok: 2, modelo: 'a' }, JSON.stringify(ruim));
  }
  assert.equal(usoDoTranscript([linha({ id: 'm2', usage: { input_tokens: 5, cache_read_input_tokens: '12' } })]), null);
  // `input_tokens` é obrigatório: sem ele não há contexto
  assert.equal(usoDoTranscript([linha({ id: 'm2', usage: { output_tokens: 5 } })]), null);
});

test('uso-cache-ausente-zero', () => {
  const u = usoDoTranscript([linha({ id: 'm1', model: 'a', usage: { input_tokens: 10, output_tokens: 2 } })]);
  assert.deepEqual(u, { contexto: 10, tok: 12, modelo: 'a' });
});

test('uso-sem-message-id-so-contexto', () => {
  const u = usoDoTranscript([linha({ model: 'a', usage: U(10, 5, 100, 20) })]);
  assert.deepEqual(u, { contexto: 130, tok: 0, modelo: 'a' });
  const misto = usoDoTranscript([linha({ id: 'm1', model: 'a', usage: U(1, 1, 0, 0) }), linha({ model: 'a', usage: U(9, 9, 9, 9) })]);
  assert.deepEqual(misto, { contexto: 27, tok: 2, modelo: 'a' });
  assert.equal(usoDoTranscript([linha({ id: '', model: 'a', usage: U(9, 9, 0, 0) })])?.tok, 0, 'id vazio não é id');
});

test('uso-modelo-ausente-null', () => {
  assert.equal(usoDoTranscript([linha({ id: 'm1', usage: U(1, 1) })])?.modelo, null);
  assert.equal(usoDoTranscript([linha({ id: 'm1', model: 'antigo', usage: U(1, 1) }), linha({ id: 'm2', model: 'novo', usage: U(1, 1) })])?.modelo, 'novo', 'o último vale');
  assert.equal(usoDoTranscript([linha({ id: 'm1', model: 'a', usage: U(1, 1) }), linha({ id: 'm2', usage: U(1, 1) })])?.modelo, 'a');
});

// ---------- revisor aguardando, mutações de hoje ----------

test('revisor-aguardando-so-concluida', () => {
  const por = (...itens: [TipoEvento, Record<string, unknown>][]) => projetarEquipe(PLANO, diario(...itens), entrada()).revisoresAguardando;
  assert.deepEqual(por(ini('T07', 'implementador')), [], 'implementando');
  assert.deepEqual(por(ini('T07', 'implementador'), concl('T07')).map((r) => r.task), ['T07'], 'concluida');
  assert.deepEqual(por(ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor')), [], 'em_revisao');
  assert.deepEqual(
    por(ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'), ['review.veredito', { task: 'T07', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }]),
    [], 'aprovada',
  );
  assert.deepEqual(por(), [], 'pendente');
  // na ordem do plano
  assert.deepEqual(por(ini('T08', 'implementador'), ini('T07', 'implementador'), concl('T08'), concl('T07')).map((r) => r.task), ['T07', 'T08']);
});

test('revisor-sem-nome-antes-do-1o-despacho', () => {
  const sem = projetarEquipe(PLANO, diario(ini('T07', 'implementador'), concl('T07')), entrada()).revisoresAguardando;
  assert.equal(sem[0].nome, null);
  // reprovada e já corrigida de volta a concluida: o par (T07, revisor) já tem nome
  const eventos = diario(
    ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'),
    ['review.veredito', { task: 'T07', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }], ini('T07', 'correcao'), concl('T07'),
  );
  const com = projetarEquipe(PLANO, eventos, entrada()).revisoresAguardando;
  assert.deepEqual(com.map((r) => [r.task, r.nome]), [['T07', TM.nomes[1]]]);
});

const integrada = (task: string, ts: string, mutacoes?: unknown): Evento => ev('task.integrada', mutacoes === undefined ? { task } : { task, mutacoes }, ts);

test('mutacoes-hoje-fuso-virada-do-dia', () => {
  const SP = 'America/Sao_Paulo';
  const agoraMs = Date.parse('2026-11-09T15:00:00.000Z'); // 12:00 em SP
  SEQ = 0;
  const conc = [ev('task.iniciada', { task: 'T07', papel: 'implementador' }, '2026-11-09T10:00:00.000Z'), ev('task.concluida', { task: 'T07' }, '2026-11-09T10:01:00.000Z')];
  const por = (extra: Evento[], fuso = SP) => projetarEquipe(PLANO, [...conc, ...extra], entrada({ fuso, agoraMs })).revisoresAguardando[0];
  // 23:30 de ontem em SP (= 02:30Z de hoje) fica fora; 00:30 de hoje em SP (= 03:30Z) entra
  const ontem = integrada('T08', '2026-11-09T02:30:00.000Z', { total: 10, mortas: 9 }); // 02:30Z do dia 09 = 23:30 do dia 08 em SP
  const hoje = integrada('T09', '2026-11-09T03:30:00.000Z', { total: 4, mortas: 3 });
  assert.deepEqual([por([ontem, hoje]).mutacoesHoje, por([ontem, hoje]).mortasHoje], [4, 3]);
  // em UTC o mesmo "ontem" é hoje: soma os dois
  assert.deepEqual([por([ontem, hoje], 'UTC').mutacoesHoje, por([ontem, hoje], 'UTC').mortasHoje], [14, 12]);
  // soma de várias integrações do dia
  const outra = integrada('T10', '2026-11-09T13:00:00.000Z', { total: 6, mortas: 6 });
  assert.deepEqual([por([hoje, outra]).mutacoesHoje, por([hoje, outra]).mortasHoje], [10, 9]);
  // nenhuma de hoje com o campo ⇒ null (e nunca 0); sem o campo ⇒ null; só de ontem ⇒ null
  assert.equal(por([ontem]).mutacoesHoje, null);
  assert.equal(por([ontem]).mortasHoje, null);
  assert.equal(por([integrada('T09', '2026-11-09T13:00:00.000Z')]).mutacoesHoje, null, 'integração sem o campo');
  assert.equal(por([integrada('T09', '2026-11-09T13:00:00.000Z', { total: 'x', mortas: 1 })]).mutacoesHoje, null, 'campo torto não soma');
  assert.equal(por([]).mortasHoje, null);
});

test('mutacoes-hoje-em-toda-linha', () => {
  SEQ = 0;
  const eventos = [
    ev('task.iniciada', { task: 'T07', papel: 'implementador' }, '2026-11-09T10:00:00.000Z'), ev('task.concluida', { task: 'T07' }, '2026-11-09T10:01:00.000Z'),
    ev('task.iniciada', { task: 'T08', papel: 'implementador' }, '2026-11-09T10:02:00.000Z'), ev('task.concluida', { task: 'T08' }, '2026-11-09T10:03:00.000Z'),
    integrada('T09', '2026-11-09T11:00:00.000Z', { total: 5, mortas: 4 }),
  ];
  const r = projetarEquipe(PLANO, eventos, entrada()).revisoresAguardando;
  assert.deepEqual(r.map((x) => [x.task, x.mutacoesHoje, x.mortasHoje]), [['T07', 5, 4], ['T08', 5, 4]]);
});

// ---------- líder e Sombra ----------

function comMedicoes(...itens: { agente: string; dados: Record<string, unknown> }[]): Evento[] {
  SEQ = 0;
  return itens.map((m, i) => ev('custo.medicao', m.dados, new Date(Date.parse('2026-11-09T12:00:00.000Z') + i * 60_000).toISOString(), 's1', m.agente));
}

test('lider-campos', () => {
  const eq = projetarEquipe(PLANO, [], entrada({ contexto: { percent: 36, tokens: 1, window: 2 }, limites: { h5: 42, d7: 18 }, x: 55 }));
  assert.deepEqual(eq.lider, { nome: 'GANDALF', modelo: 'opus', ctx: 36, x: 55, tok: null, h5: 42, d7: 18, narrativa: '' });
  const semNada = projetarEquipe(PLANO, [], entrada({ modeloSessao: null, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null } }));
  assert.deepEqual([semNada.lider.modelo, semNada.lider.ctx, semNada.lider.h5, semNada.lider.d7], [null, null, null, null]);
  assert.equal(projetarEquipe(PLANO, [], entrada({ modeloSessao: 'claude-sonnet-4-6[1m]' })).lider.modelo, 'sonnet');
  assert.equal(projetarEquipe(PLANO, [], entrada({ modeloSessao: 'modelo-desconhecido' })).lider.modelo, null);
});

test('tok-lider-so-orquestrador', () => {
  const eventos = comMedicoes(
    { agente: 'orquestrador', dados: { papel: 'basico', input_tokens: 100, output_tokens: 50, cache_creation: 10, cache_read: 99_999 } },
    { agente: 'subagent:abc', dados: { papel: 'implementador', input_tokens: 5000, output_tokens: 5000, cache_creation: 5000 } },
    { agente: 'orquestrador', dados: { papel: 'basico', input_tokens: 1, output_tokens: 2 } },
  );
  assert.equal(projetarEquipe(PLANO, eventos, entrada()).lider.tok, 163);
});

test('lider-tok-ok-false-null', () => {
  const ruim = comMedicoes({ agente: 'orquestrador', dados: { input_tokens: 'x', output_tokens: 1 } });
  assert.equal(projetarEquipe(PLANO, ruim, entrada()).lider.tok, null, 'medição corrompida');
  const negativo = comMedicoes({ agente: 'orquestrador', dados: { input_tokens: -1, output_tokens: 1 } });
  assert.equal(projetarEquipe(PLANO, negativo, entrada()).lider.tok, null);
  const sub = comMedicoes({ agente: 'subagent:abc', dados: { input_tokens: 5, output_tokens: 1 } });
  assert.equal(projetarEquipe(PLANO, sub, entrada()).lider.tok, null, 'nenhuma medição do orquestrador: ausente, nunca 0');
  assert.equal(projetarEquipe(PLANO, [], entrada()).lider.tok, null);
  const zero = comMedicoes({ agente: 'orquestrador', dados: { input_tokens: 0, output_tokens: 0 } });
  assert.equal(projetarEquipe(PLANO, zero, entrada()).lider.tok, 0, 'medido zero é 0');
});

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const dec = (hash: string, resposta: string, extra: Record<string, unknown> = {}): [TipoEvento, Record<string, unknown>] => [
  'decisao.sombra', { pergunta_hash: hash, req: 'REQ-PNL-5', resposta, arquivo: 'sombra.md', pergunta_enviesada: false, fontes: ['spec:164'], ...extra },
];

test('sombra-sempre-presente', () => {
  assert.deepEqual(projetarEquipe(PLANO, [], entrada()).sombra, { nome: 'ELROND', modelo: null, decisoes: 0, ultima: null });
  const eventos = diario(dec(hashA, 'primeira'), dec(hashB, 'segunda', { fontes: undefined, medicao: 'medido.json' }), dec(hashA, 'terceira', { fontes: ['plano:1', 'spec:2'] }));
  const s = projetarEquipe(PLANO, eventos, entrada()).sombra;
  assert.equal(s.nome, 'ELROND');
  assert.equal(s.decisoes, 2, 'vigentes por hash: A e B');
  assert.deepEqual(s.ultima, { seq: 3, resposta: 'terceira', fonte: 'plano:1' });
  // a Sombra entra mesmo sem nenhum agente e com diário que não ordena
  const a = ev('task.iniciada', { task: 'T07', papel: 'implementador' });
  const b: Evento = { ...ev('task.iniciada', { task: 'T08', papel: 'implementador' }), seq: a.seq };
  assert.deepEqual(projetarEquipe(PLANO, [a, b], entrada()).sombra, { nome: 'ELROND', modelo: null, decisoes: 0, ultima: null });
});

test('sombra-ultima-desempate-por-sessao (T3 MINOR 2): mesmo ts em sessões diferentes ⇒ a de sessao maior; mesma sessão ⇒ seq maior', () => {
  const mesmoTs = '2026-11-09T12:00:00.000Z';
  const d = (sessao: string, seq: number, hash: string, resposta: string): Evento =>
    ({ ...ev('decisao.sombra', dec(hash, resposta)[1], mesmoTs, sessao), seq });
  const ultima = (...evs: Evento[]) => projetarEquipe(PLANO, evs, entrada()).sombra.ultima;
  // `seq` maior na sessão menor: se o desempate fosse por seq, ganharia 'sa'
  assert.deepEqual(ultima(d('sa', 9, hashA, 'da sa'), d('sb', 1, hashB, 'da sb')), { seq: 1, resposta: 'da sb', fonte: 'spec:164' });
  assert.deepEqual(ultima(d('sb', 1, hashB, 'da sb'), d('sa', 9, hashA, 'da sa')), { seq: 1, resposta: 'da sb', fonte: 'spec:164' }, 'a ordem de chegada não decide');
  // mesma sessão e mesmo ts: o seq maior
  assert.deepEqual(ultima(d('sa', 2, hashA, 'dois'), d('sa', 3, hashB, 'tres')), { seq: 3, resposta: 'tres', fonte: 'spec:164' });
  // o ts decide antes da sessão
  const antes = { ...d('sz', 5, hashA, 'cedo'), ts: '2026-11-09T11:00:00.000Z' };
  assert.equal(ultima(antes, d('sa', 1, hashB, 'tarde'))?.resposta, 'tarde');
});

test('sombra-ultima-fonte-medicao-e-null', () => {
  const soMedicao = diario(dec(hashA, 'x', { fontes: undefined, medicao: 'medido.json' }));
  assert.equal(projetarEquipe(PLANO, soMedicao, entrada()).sombra.ultima?.fonte, 'medicao');
  const foraDaRegra = diario(dec(hashA, 'x', { fontes: undefined, fora_da_regra: true, emenda_seq: 3 }));
  assert.equal(projetarEquipe(PLANO, foraDaRegra, entrada()).sombra.ultima?.fonte, null);
});

test('sombra-vigentes-igual-projetarDecisoes', () => {
  // o painel não importa sombra.ts (node:crypto); este teste prende a cópia local ao original
  const casos: Evento[][] = [
    diario(dec(hashA, 'a1'), dec(hashB, 'b1'), dec(hashA, 'a2')),
    diario(dec(hashA, 'a1'), dec(hashA, 'a2', { substitui: { sessao: 's1', seq: 1 } })),
    // a substituição vale em cadeia (A←B←C) mesmo com ts embaralhado
    (() => {
      SEQ = 0;
      return [
        ev(...dec(hashA, 'v1'), '2026-11-09T12:03:00.000Z'),
        ev(...dec(hashA, 'v2', { substitui: { sessao: 's1', seq: 1 } }), '2026-11-09T12:02:00.000Z'),
        ev(...dec(hashA, 'v3', { substitui: { sessao: 's1', seq: 2 } }), '2026-11-09T12:01:00.000Z'),
      ];
    })(),
    // substitui apontando para outro hash, para si mesma, para alvo inexistente
    diario(dec(hashA, 'a1'), dec(hashB, 'b1', { substitui: { sessao: 's1', seq: 1 } }), dec(hashB, 'b2', { substitui: { sessao: 's1', seq: 3 } }), dec(hashB, 'b3', { substitui: { sessao: 'zz', seq: 9 } })),
    // ciclo forjado: todas substituídas, vale a mais recente
    diario(dec(hashA, 'a1', { substitui: { sessao: 's1', seq: 2 } }), dec(hashA, 'a2', { substitui: { sessao: 's1', seq: 1 } })),
    // o substituído pode vir DEPOIS no diário (referência adiante): a substituição vale, não a posição
    diario(dec(hashA, 'novo', { substitui: { sessao: 's1', seq: 2 } }), dec(hashA, 'velho')),
    // forma inválida (sem fonte nem medição) não conta
    diario(dec(hashA, 'sem fonte', { fontes: undefined }), dec(hashB, 'ok')),
  ];
  for (const [i, eventos] of casos.entries()) {
    const real = projetarDecisoes(eventos);
    const s = projetarEquipe(PLANO, eventos, entrada()).sombra;
    assert.equal(s.decisoes, real.size, `caso ${i}: contagem`);
    const maisRecente = [...real.values()].sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts) || (y.sessao < x.sessao ? -1 : y.sessao > x.sessao ? 1 : 0) || y.seq - x.seq)[0];
    assert.equal(s.ultima?.seq ?? null, maisRecente?.seq ?? null, `caso ${i}: última`);
    assert.equal(s.ultima?.resposta ?? null, maisRecente?.resposta ?? null, `caso ${i}: resposta`);
  }
});

test('sombra-modelo-do-custo-papel-sombra', () => {
  const eventos = comMedicoes(
    { agente: 'subagent:s1', dados: { papel: 'sombra', modelo: 'claude-sonnet-4-6', input_tokens: 1, output_tokens: 1 } },
    { agente: 'subagent:s2', dados: { papel: 'sombra', modelo: 'claude-opus-4-8', input_tokens: 1, output_tokens: 1 } },
    { agente: 'subagent:i1', dados: { papel: 'implementador', modelo: 'claude-haiku-4-5', input_tokens: 1, output_tokens: 1 } },
  );
  assert.equal(projetarEquipe(PLANO, eventos, entrada()).sombra.modelo, 'opus', 'o último de papel sombra, ignora implementador');
  const sem = comMedicoes({ agente: 'subagent:i1', dados: { papel: 'implementador', modelo: 'claude-haiku-4-5' } });
  assert.equal(projetarEquipe(PLANO, sem, entrada()).sombra.modelo, null);
  const nulo = comMedicoes({ agente: 'subagent:s1', dados: { papel: 'sombra', modelo: null } });
  assert.equal(projetarEquipe(PLANO, nulo, entrada()).sombra.modelo, null);
});

// ---------- costura (P9): diário real + transcript real + CLI-like entrada ----------

test('costura-diario-transcript-equipe', () => {
  // do jeito que o CLI (T9) monta: linhas do transcript ⇒ usoDoTranscript ⇒ AgenteVivo.uso ⇒ projetarEquipe, nomes do pacote lido do JSON de fábrica
  const eventos = diario(ini('T07', 'implementador', { modelo: 'sonnet' }), ini('T08', 'implementador'), concl('T07'), ini('T07', 'revisor'));
  const transcript = [
    '{"type":"user","message":{"role":"user","content":"x"}}',
    linha({ id: 'm1', model: 'claude-opus-4-8', usage: U(6, 400, 80_000, 8_000) }),
    linha({ id: 'm2', model: 'claude-opus-4-8', usage: U(4, 600, 82_000, 5_996) }),
    linha({ id: 'm2', model: 'claude-opus-4-8', usage: U(4, 900, 82_000, 5_996) }),
  ];
  const u = usoDoTranscript(transcript);
  assert.deepEqual(u, { contexto: 88_000, tok: (6 + 400 + 8_000) + (4 + 900 + 5_996), modelo: 'claude-opus-4-8' });
  const eq = projetarEquipe(PLANO, eventos, entrada({ pacote: pacoteDe('galaxia'), agentes: [ag('T07 revisor', { uso: u }), ag('T08 implementador')] }));
  const rev = eq.agentes.find((a) => a.task === 'T07');
  assert.deepEqual([rev?.nome, rev?.papel, rev?.estadoTask, rev?.ctxPct, rev?.ctxTok, rev?.tok, rev?.cor], [pacoteDe('galaxia').nomes[2], 'revisor', 'em_revisao', 44, 88_000, 15_306, 'autoAccept']);
  assert.equal(eq.lider.nome, 'LEIA');
  assert.equal(eq.sombra.nome, 'YODA');
});

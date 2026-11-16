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
import { casarAgente, casarVivo, estadoDoVivo, higienizarDescricao, idsEncerrados, nomesPorPapel, papelDoAgente, projetarEquipe, resolverAtivos, sortearPacote, usoDoTranscript, validarNomesAgentes, validarPacote, validarStdinAgentes } from '../src/painel-equipe.ts';
import { projetarPainel } from '../src/painel.ts';
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
  // todo ativo tem nome (FIEL-3 d): sem o do par, o 1º livre do pacote
  assert.equal(eq.agentes[0].nome, TM.nomes[0]);
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
  // FIEL-3 a: o 1º token decide a task; o que não casa o id (outro id, caixa, espaço antes) fica sem task, mas continua vivo e com nome
  const eventos = diario(ini('T07', 'implementador'));
  for (const d of ['t07 implementador', 'T99 implementador', '', 'implementador T07', 'x T07 implementador', 'T07x1 implementador', 'T077 implementador']) {
    assert.equal(casarAgente(d, PLANO), null, d);
    const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag(d)] }));
    const vivos = eq.agentes.filter((a) => a.vivo);
    assert.equal(vivos.length, 1, d);
    assert.deepEqual([vivos[0].papel, vivos[0].task, vivos[0].estadoTask], [null, undefined, null], d);
    assert.ok(typeof vivos[0].nome === 'string' && vivos[0].nome !== '', d);
  }
  // o legado `casarAgente` segue estrito; o casamento novo aceita texto depois do id
  assert.equal(casarAgente('T07 implementador extra', PLANO), null);
  assert.equal(projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador extra')] })).agentes[0].task, 'T07');
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

test('task-sem-agente-vai-a-esperando-sem-linha', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { uso: uso(50_000) })] }));
  assert.deepEqual(eq.agentes.map((a) => [a.task, a.vivo, a.nome]), [['T07', true, TM.nomes[0]]], 'nenhuma linha ◌');
  assert.deepEqual(eq.esperando, ['T08']);
  assert.equal(eq.vivos, 1);
});

test('agentes-null-sem-linhas-nem-esperando', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const nulo = projetarEquipe(PLANO, eventos, entrada({ agentes: null }));
  assert.deepEqual([nulo.agentes, nulo.vivos, nulo.esperando], [[], null, []]);
  const vazio = projetarEquipe(PLANO, eventos, entrada({ agentes: [] }));
  assert.deepEqual([vazio.agentes, vazio.vivos, vazio.esperando], [[], 0, ['T07', 'T08']]);
  // o revisor aguardando não depende de haver mod
  const conc = diario(ini('T07', 'implementador'), concl('T07'));
  assert.deepEqual(projetarEquipe(PLANO, conc, entrada({ agentes: null })).revisoresAguardando.map((r) => r.task), ['T07']);
});

test('encerrado-fora', () => {
  const eventos = diario(ini('T07', 'implementador'));
  for (const status of ['idle', 'completed', 'failed', 'killed']) {
    const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { status })] }));
    assert.equal(eq.agentes.length, 0, status);
    assert.deepEqual(eq.esperando, ['T07'], `${status}: a task fica sem agente`);
  }
  for (const status of ['running', 'pending', 'waiting']) {
    assert.equal(projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { status })] })).agentes.length, 1, status);
  }
});

test('status-desconhecido-nao-e-ativo (FIEL-6 a)', () => {
  const eventos = diario(ini('T07', 'implementador'));
  for (const status of [42, null, undefined, 'esquisito'] as unknown[]) {
    const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador', { status: status as string })] }));
    assert.equal(eq.agentes.length, 0, String(status));
    assert.deepEqual(eq.esperando, ['T07'], String(status));
  }
});

test('linha-pelo-papel-nao-pelo-estado', () => {
  // implementador vivo com a task já em em_revisao: a linha diz implementador; o revisor ausente vai a `esperando`
  const eventos = diario(ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador')] }));
  assert.deepEqual(eq.agentes.map((a) => [a.papel, a.estadoTask, a.nome]), [['implementador', 'em_revisao', TM.nomes[0]]]);
  assert.deepEqual(eq.esperando, ['T07']);
  // com o revisor vivo, esperando some
  const ok = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 revisor')] }));
  assert.deepEqual(ok.agentes.map((a) => [a.papel, a.vivo]), [['revisor', true]]);
  assert.deepEqual(ok.esperando, []);
});

test('dois-vivos-mesmo-par', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 implementador'), { ...ag('T07 implementador'), id: 'outro' }] }));
  assert.equal(eq.agentes.length, 2);
  assert.equal(eq.agentes[0].nome, TM.nomes[0]);
  assert.notEqual(eq.agentes[1].nome, TM.nomes[0], 'nome único entre ativos (FIEL-3 d)');
});

test('corrigindo-espera-agente-correcao', () => {
  const eventos = diario(
    ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'),
    ['review.veredito', { task: 'T07', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }], ini('T07', 'correcao'),
  );
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes: [ag('T07 correcao')] }));
  assert.deepEqual(eq.agentes.map((a) => [a.papel, a.estadoTask, a.vivo, a.nome]), [['correcao', 'corrigindo', true, TM.nomes[0]]]);
  assert.deepEqual(projetarEquipe(PLANO, eventos, entrada({ agentes: [] })).esperando, ['T07']);
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

test('mutacoes-hoje-total-zero-e-ausente: total 0 = o gate não mediu ⇒ não soma (null, nunca 0); 0 medido (total > 0) é 0', () => {
  SEQ = 0;
  const conc = [ev('task.iniciada', { task: 'T07', papel: 'implementador' }, '2026-11-09T10:00:00.000Z'), ev('task.concluida', { task: 'T07' }, '2026-11-09T10:01:00.000Z')];
  const por = (extra: Evento[]) => projetarEquipe(PLANO, [...conc, ...extra], entrada()).revisoresAguardando[0];
  const vazia = por([integrada('T09', '2026-11-09T11:00:00.000Z', { total: 0, mortas: 0 })]);
  assert.deepEqual([vazia.mutacoesHoje, vazia.mortasHoje], [null, null]);
  const mista = por([integrada('T08', '2026-11-09T11:00:00.000Z', { total: 0, mortas: 0 }), integrada('T09', '2026-11-09T11:30:00.000Z', { total: 4, mortas: 3 })]);
  assert.deepEqual([mista.mutacoesHoje, mista.mortasHoje], [4, 3], 'a integração sem medição não entra na soma');
  const medido = por([integrada('T09', '2026-11-09T11:00:00.000Z', { total: 4, mortas: 0 })]);
  assert.deepEqual([medido.mutacoesHoje, medido.mortasHoje], [4, 0], '0 medido ≠ ausente');
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
  assert.deepEqual(projetarEquipe(PLANO, [], entrada()).sombra, { nome: 'ELROND', modelo: null, decisoes: 0, ultima: null, consultasAbertas: 0 });
  const eventos = diario(dec(hashA, 'primeira'), dec(hashB, 'segunda', { fontes: undefined, medicao: 'medido.json' }), dec(hashA, 'terceira', { fontes: ['plano:1', 'spec:2'] }));
  const s = projetarEquipe(PLANO, eventos, entrada()).sombra;
  assert.equal(s.nome, 'ELROND');
  assert.equal(s.decisoes, 2, 'vigentes por hash: A e B');
  assert.deepEqual(s.ultima, { seq: 3, resposta: 'terceira', fonte: 'plano:1' });
  // a Sombra entra mesmo sem nenhum agente e com diário que não ordena
  const a = ev('task.iniciada', { task: 'T07', papel: 'implementador' });
  const b: Evento = { ...ev('task.iniciada', { task: 'T08', papel: 'implementador' }), seq: a.seq };
  assert.deepEqual(projetarEquipe(PLANO, [a, b], entrada()).sombra, { nome: 'ELROND', modelo: null, decisoes: 0, ultima: null, consultasAbertas: 0 });
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

// ---------- GM-14 T29: casamento, nome e vivos da equipe (FIEL-3 a, b, d; FIEL-6; FIEL-7) ----------

const IMPL = 'gabarito-mestre:gabarito-implementador';
const REV = 'gabarito-mestre:gabarito-revisor';
const planoDe = (...ids: string[]): Plano => ({ entrega: 'GM-14', tasks: ids.map((id) => ({ id, deps: [], arquivos: [] })) });
const vivoT = (id: string, description: string, type = 'general-purpose', extra: Partial<AgenteVivo> = {}): AgenteVivo => ({ id, type, description, status: 'running', uso: null, ...extra });
const semEstado = new Map<string, never>();
const FATOS = (...tasks: string[]) => ({ branch: 'x', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks }, ledger: false, gh: 'ok', ultimas: [], sessao: 's1' });
const novo = (plano: Plano, eventos: Evento[], extra: Partial<EntradaPainel>) => projetarPainel(plano, eventos, { ...entrada(extra), fatos: FATOS(...plano.tasks.map((t) => t.id)) } as never);

test('casa-t1-contratos-com-tipo-implementador: o 1º token é o id; o tipo dá o papel', () => {
  const c = casarVivo(vivoT('a1', 'T1 Contratos de painel', IMPL), planoDe('T1', 'T2'), semEstado);
  assert.deepEqual([c.task, c.papel, c.papelExibido], ['T1', 'implementador', 'implementador']);
});

test('t0a-casa-t0: id + 1 letra minúscula casa o id; maiúscula, 2 letras e dígito não', () => {
  const p = planoDe('T0', 'T1');
  assert.equal(casarVivo(vivoT('a', 'T0a medir', IMPL), p, semEstado).task, 'T0');
  for (const d of ['T0A medir', 'T0ab medir', 'T00 medir', 'x T0 medir', 't0 medir']) assert.equal(casarVivo(vivoT('a', d, IMPL), p, semEstado).task, null, d);
});

test('t10-nao-casa-t1: T10 nunca casa T1; com os dois no plano vale o id mais longo', () => {
  assert.equal(casarVivo(vivoT('a', 'T10 x', IMPL), planoDe('T1'), semEstado).task, null);
  assert.equal(casarVivo(vivoT('a', 'T10 x', IMPL), planoDe('T1', 'T10'), semEstado).task, 'T10');
  assert.equal(casarVivo(vivoT('a', 'T1a x', IMPL), planoDe('T1', 'T1a'), semEstado).task, 'T1a', 'o mais longo');
});

test('papel-antigo-vence-tipo: "<task> revisor" com tipo implementador é revisor', () => {
  const c = casarVivo(vivoT('a', 'T1 revisor', IMPL), planoDe('T1'), new Map([['T1', 'corrigindo' as const]]));
  assert.deepEqual([c.papel, c.papelExibido], ['revisor', 'revisor']);
});

test('papel-pela-ordem: tipo > implementador em corrigindo vira correcao > estado > tipo só para exibição', () => {
  const p = planoDe('T1');
  const est = (e: 'implementando' | 'corrigindo' | 'em_revisao' | 'pendente') => new Map([['T1', e]]);
  assert.equal(casarVivo(vivoT('a', 'T1 x', REV), p, est('implementando')).papel, 'revisor', 'tipo');
  assert.equal(casarVivo(vivoT('a', 'T1 x', IMPL), p, est('corrigindo')).papel, 'correcao', 'regra 3');
  assert.equal(casarVivo(vivoT('a', 'T1 x', IMPL), p, est('em_revisao')).papel, 'implementador', 'tipo implementador fora de corrigindo');
  assert.equal(casarVivo(vivoT('a', 'T1 x', 'general-purpose'), p, est('em_revisao')).papel, 'revisor', 'regra 4: estado');
  const spike = casarVivo(vivoT('a', 'T1 x', 'gabarito-mestre:gabarito-spike'), p, est('pendente'));
  assert.deepEqual([spike.task, spike.papelExibido], ['T1', 'spike'], 'regra 5: tipo só para exibição');
  const sem = casarVivo(vivoT('a', 'rascunho da spec', 'gabarito-mestre:gabarito-sombra'), p, est('implementando'));
  assert.deepEqual([sem.task, sem.papel, sem.papelExibido], [null, null, 'sombra']);
  assert.equal(papelDoAgente('general-purpose'), null);
  assert.equal(papelDoAgente(42), null);
});

test('correcao-com-tipo-implementador-cobre: task em corrigindo com agente tipo implementador ⇒ linha no AGORA, 0 no ATENÇÃO', () => {
  const eventos = diario(ini('T07', 'implementador'), concl('T07'), ini('T07', 'revisor'),
    ['review.veredito', { task: 'T07', veredito: 'REPROVADO', rodada: 1, major: 1, blocker: 0 }], ini('T07', 'correcao'));
  const agentes = [vivoT('a1', 'T07 corrigir o achado', IMPL)];
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes }));
  assert.deepEqual(eq.agentes.map((a) => [a.papel, a.papelExibido, a.vivo]), [['correcao', 'correcao', true]]);
  assert.deepEqual(eq.esperando, []);
  const s = novo(PLANO, eventos, { agentes });
  assert.equal(s.atencao.filter((x) => /sem agente trabalhando/.test(x)).length, 0);
  assert.equal(s.agora?.agentes?.length, 1);
});

test('t0-pendente-com-spike-vivo-em-curso: task pendente com vivo casado aparece em curso (●), nunca fila (○); o diário não muda', () => {
  const plano = planoDe('T0', 'T07');
  const agentes = [vivoT('sp', 'T0 medir a paginação', 'gabarito-mestre:gabarito-spike')];
  const s = projetarPainel(plano, [], entrada({ agentes }));
  assert.equal(s.plano.tasks.find((t) => t.id === 'T0')?.glifo, '●');
  assert.equal(s.plano.tasks.find((t) => t.id === 'T0')?.estado, 'pendente');
  assert.equal(s.equipe.agentes[0].papelExibido, 'spike');
  const sem = projetarPainel(plano, [], entrada({ agentes: [] }));
  assert.equal(sem.plano.tasks.find((t) => t.id === 'T0')?.glifo, '○');
});

test('todo-ativo-tem-nome e nomes-unicos-entre-ativos: casado, sem task e spike recebem nome, e dois ativos nunca dividem o mesmo', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const agentes = [vivoT('a', 'T07 x', IMPL), vivoT('b', 'T07 y', IMPL), vivoT('c', 'rascunho', 'general-purpose'), vivoT('d', 'medir', 'gabarito-mestre:gabarito-spike')];
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes }));
  const nomes = eq.agentes.map((a) => a.nome);
  assert.ok(nomes.every((n) => typeof n === 'string' && n !== ''), JSON.stringify(nomes));
  assert.equal(new Set(nomes).size, nomes.length, 'únicos');
  assert.ok(!nomes.includes(TM.lider) && !nomes.includes(TM.sabio));
  assert.equal(eq.agentes.find((a) => a.task === 'T07')?.nome, TM.nomes[0], 'o 1º casado fica com o nome do par');
});

test('nome-do-par-so-se-livre: o nome do par é de quem já o tem; o recebido de um ativo não é trocado (FIEL-3 d)', () => {
  const eventos = diario(ini('T07', 'implementador'));
  // o sem task já exibe ARAGORN (o nome do par de T07): o casado não o toma; usa o seu recebido
  const agentes = [vivoT('x', 'rascunho', 'general-purpose', { nome: TM.nomes[0], vistoEm: 1 }), vivoT('a', 'T07 x', IMPL, { nome: TM.nomes[3], vistoEm: 2 })];
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes }));
  assert.equal(eq.agentes.find((a) => a.task === undefined)?.nome, TM.nomes[0], 'o nome já exibido não troca quando entra o casado');
  assert.equal(eq.agentes.find((a) => a.task === 'T07')?.nome, TM.nomes[3], 'o casado, sem o par livre, fica com o seu recebido');
  // sem ninguém usando o par, o casado o recebe
  const livre = projetarEquipe(PLANO, eventos, entrada({ agentes: [vivoT('a', 'T07 x', IMPL, { nome: TM.nomes[3], vistoEm: 2 })] }));
  assert.equal(livre.agentes[0].nome, TM.nomes[0], 'par livre ⇒ o casado o tem');
  // par ocupado por outro e sem recebido: o 1º livre do pacote, nunca o duplicado
  const sem = projetarEquipe(PLANO, eventos, entrada({ agentes: [vivoT('x', 'rascunho', 'general-purpose', { nome: TM.nomes[0], vistoEm: 1 }), vivoT('a', 'T07 x', IMPL, { vistoEm: 2 })] }));
  const nomes = sem.agentes.map((a) => a.nome);
  assert.equal(new Set(nomes).size, 2, 'únicos');
  assert.equal(sem.agentes.find((a) => a.task === undefined)?.nome, TM.nomes[0]);
});

test('nome-estavel-com-novo-agente: nome recebido não muda quando entra outro agente', () => {
  const um = [vivoT('x', 'a', 'general-purpose', { nome: TM.nomes[4], vistoEm: 1 })];
  const dois = [vivoT('y', 'b', 'general-purpose', { vistoEm: 0 }), ...um];
  const n1 = projetarEquipe(PLANO, [], entrada({ agentes: um })).agentes[0].nome;
  const n2 = projetarEquipe(PLANO, [], entrada({ agentes: dois })).agentes.find((a) => a.descricao === 'a')?.nome;
  assert.equal(n1, TM.nomes[4]);
  assert.equal(n2, TM.nomes[4]);
});

test('pacote-esgotado-sufixo-e-agente: acabou o pacote ⇒ nome com sufixo 2 a 9; depois do 9 ⇒ "agente"', () => {
  const quantos = TM.nomes.length * 9 + 1;
  const agentes = Array.from({ length: quantos }, (_, i) => vivoT(`x${i}`, `trabalho ${i}`, 'general-purpose', { vistoEm: i }));
  const nomes = projetarEquipe(PLANO, [], entrada({ agentes })).agentes.map((a) => a.nome);
  assert.deepEqual(nomes.slice(0, TM.nomes.length), TM.nomes);
  assert.equal(nomes[TM.nomes.length], `${TM.nomes[0]}2`);
  assert.equal(nomes[nomes.length - 1], 'agente');
  assert.equal(new Set(nomes.filter((n) => n !== 'agente')).size, nomes.length - 1);
});

test('subagentstop-sai-do-agora: `encerrados` do mod e `custo.medicao` de subagent:<id> vencem o status', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const agentes = [vivoT('a', 'T07 x', IMPL), vivoT('b', 'T08 y', IMPL)];
  assert.equal(projetarEquipe(PLANO, eventos, entrada({ agentes })).vivos, 2);
  const parou = projetarEquipe(PLANO, eventos, entrada({ agentes, encerrados: ['a'] }));
  assert.deepEqual(parou.agentes.map((a) => a.task), ['T08']);
  assert.equal(parou.vivos, 1);
  assert.deepEqual(parou.esperando, ['T07'], 'T07 em voo sem ativo');
  const medida = [...eventos, ev('custo.medicao', { papel: 'implementador', modelo: 'claude-opus-4-8', input_tokens: 1, output_tokens: 1 }, '2026-11-09T12:30:00.000Z', 's1', 'subagent:b')];
  assert.deepEqual(projetarEquipe(PLANO, medida, entrada({ agentes })).agentes.map((a) => a.task), ['T07']);
  assert.deepEqual([...idsEncerrados(medida, ['z'])].sort(), ['b', 'z']);
});

test('status-fora-da-lista-nao-e-ativo: desconhecido não entra no AGORA e conta "estado desconhecido" no ATENÇÃO', () => {
  const fim = new Set<string>();
  for (const [st, esperado] of [['pending', 'ativo'], ['running', 'ativo'], ['waiting', 'ativo'], ['idle', 'encerrado'], ['killed', 'encerrado'], ['esquisito', 'desconhecido'], [42, 'desconhecido'], [undefined, 'desconhecido']] as [unknown, string][]) {
    assert.equal(estadoDoVivo({ id: 'a', status: st }, fim), esperado, String(st));
  }
  const agentes = [vivoT('a', 'T07 x', IMPL), vivoT('b', 'T08 y', IMPL, { status: 'esquisito' })];
  const eventos = diario(ini('T07', 'implementador'));
  const r = resolverAtivos(PLANO, eventos, entrada({ agentes }));
  assert.equal(r.ativos?.length, 1);
  assert.equal(r.desconhecidos, 1);
  assert.ok(novo(PLANO, eventos, { agentes }).atencao.includes('1 agente com estado desconhecido'));
});

test('em-revisao-sem-vivo-na-atencao: T0 e T4 em revisão sem revisor ativo ⇒ 0 "◌" e uma linha por task no ATENÇÃO', () => {
  const plano = planoDe('T0', 'T4');
  const eventos = diario(ini('T0', 'implementador'), concl('T0'), ini('T0', 'revisor'), ini('T4', 'implementador'), concl('T4'), ini('T4', 'revisor'));
  const agentes = [vivoT('a', 'T0 x', IMPL)];
  const eq = projetarEquipe(plano, eventos, entrada({ agentes }));
  assert.deepEqual(eq.agentes.map((a) => a.vivo), [true], 'nenhuma linha ◌');
  assert.deepEqual(eq.esperando, ['T0', 'T4']);
  assert.deepEqual(novo(plano, eventos, { agentes }).atencao.filter((x) => /sem agente trabalhando/.test(x)), ['T0 sem agente trabalhando', 'T4 sem agente trabalhando']);
});

test('agora-e-atencao-concordam: o nº de linhas do AGORA é o de ativos e o ATENÇÃO usa o mesmo casamento', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'));
  const agentes = [vivoT('a', 'T07 x', IMPL), vivoT('b', 'sem task nenhuma', 'general-purpose')];
  const eq = projetarEquipe(PLANO, eventos, entrada({ agentes }));
  const s = novo(PLANO, eventos, { agentes });
  assert.equal(s.agora?.agentes?.length, eq.vivos);
  assert.deepEqual(s.atencao.filter((x) => /sem agente trabalhando/.test(x)), eq.esperando.map((t) => `${t} sem agente trabalhando`));
});

test('glifo-e-equipe-concordam: o ● do PLANO existe se e só se a equipe tem agente casado no papel do estado', () => {
  const eventos = diario(ini('T07', 'implementador'), ini('T08', 'implementador'), concl('T08'), ini('T08', 'revisor'));
  for (const agentes of [[vivoT('a', 'T07 x', IMPL)], [vivoT('a', 'T07 x', IMPL), vivoT('b', 'T08 y', IMPL)], [vivoT('a', 'T08 y', REV)], []]) {
    const s = projetarPainel(PLANO, eventos, entrada({ agentes }));
    for (const t of ['T07', 'T08']) {
      const coberto = !s.equipe.esperando.includes(t);
      assert.equal(s.plano.tasks.find((x) => x.id === t)?.glifo === '●', coberto, `${t} com ${agentes.map((a) => a.description).join(',')}`);
    }
  }
});

test('descricao-higienizada: token que casa a regra de REQ-LNG-1 vira "…"; controle vira espaço; vazio e não texto ⇒ null', () => {
  assert.equal(higienizarDescricao('Rascunho spec-brief.md'), 'Rascunho …');
  assert.equal(higienizarDescricao('rodar `npm test` e node x.mjs'), 'rodar … … e … …');
  assert.equal(higienizarDescricao('ler loop_cli --flag /tmp/x'), 'ler … … …');
  assert.equal(higienizarDescricao('T07\timplementar\npainel'), 'T07 implementar painel');
  assert.equal(higienizarDescricao('   '), null);
  assert.equal(higienizarDescricao(42), null);
  const eq = projetarEquipe(PLANO, [], entrada({ agentes: [vivoT('a', 'Rascunho spec-brief.md')] }));
  assert.equal(eq.agentes[0].descricao, 'Rascunho …');
});

test('consultas-abertas: contarConsultas além das decisões registradas; 0 quando não passa', () => {
  assert.equal(projetarEquipe(PLANO, [], entrada()).sombra.consultasAbertas, 0);
  const consulta = (h: string): [TipoEvento, Record<string, unknown>] => ['sombra.consulta', { pergunta_hash: h.repeat(64), task: 'T07' }];
  assert.equal(projetarEquipe(PLANO, diario(consulta('a'), consulta('b')), entrada()).sombra.consultasAbertas, 2, 'duas consultas sem decisão');
  const dec: [TipoEvento, Record<string, unknown>] = ['decisao.sombra', { pergunta_hash: 'a'.repeat(64), task: 'T07', resposta: 'sim', arquivo: 's.md', pergunta_enviesada: false, fontes: ['spec:1'] }];
  assert.equal(projetarEquipe(PLANO, diario(consulta('a'), consulta('b'), dec), entrada()).sombra.consultasAbertas, 1, 'uma decisão fecha uma');
});

test('nomes-stdin-ausente-x-corrompido: ausente ⇒ vazio e vale; presente fora do contrato ⇒ recusa com o campo', () => {
  assert.deepEqual(validarStdinAgentes({}), { ok: true, valor: { nomes: {}, encerrados: [], acoes: {}, segundoPlano: [] } });
  assert.deepEqual(validarNomesAgentes(undefined), { ok: true, nomes: {} });
  const bom = validarStdinAgentes({ nomes: { a1: { nome: 'FRODO', vistoEm: 5 } }, encerrados: ['a2'], acoes: { a1: { texto: 'lendo 3 arquivos', fonte: 'tool', em: 9 } },
    segundoPlano: [{ id: 'bg1', dono: 'orquestrador', texto: 'rodando testes', desde: 3 }] });
  assert.equal(bom.ok, true);
  for (const [campo, ruim] of [['nomes', { nomes: [] }], ['nomes', { nomes: { a: { nome: 'x', vistoEm: 1 } } }], ['encerrados', { encerrados: 'a' }], ['encerrados', { encerrados: ['../x'] }],
    ['acoes', { acoes: { a: { texto: 't', fonte: 'outra', em: 1 } } }], ['acoes', { acoes: { a: { texto: 't', fonte: 'tool', em: 1, x: 1 } } }], ['segundoPlano', { segundoPlano: {} }],
    ['segundoPlano', { segundoPlano: [{ id: 'b', dono: 'x y', texto: 't', desde: 1 }] }]] as [string, unknown][]) {
    const r = validarStdinAgentes(ruim);
    assert.equal(r.ok, false, JSON.stringify(ruim));
    if (!r.ok) assert.match(r.erro, new RegExp(`\`${campo}\` corrompido`), JSON.stringify(ruim));
  }
});

// ---------- GM-14 T29 r2: sombra com id de task, ação ao vivo, plano B, segundo plano, Sombra ativa ----------

const SOMBRA = 'gabarito-mestre:gabarito-sombra';
const tarefa = (id: string): Plano => ({ entrega: 'GM-14', tasks: [{ id, deps: [], arquivos: [] }] });

test('sombra-com-id-de-task-nao-cobre-o-implementador: o tipo vem antes do estado (FIEL-3 a, regra 2); o ATENÇÃO segue', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const sombra = vivoT('s1', 'T07 dúvida sobre o nome', SOMBRA);
  const c = casarVivo(sombra, PLANO, new Map([['T07', 'implementando' as const]]));
  assert.deepEqual(c, { task: null, papel: null, papelExibido: 'sombra' });
  const r = resolverAtivos(PLANO, eventos, entrada({ agentes: [sombra] }));
  assert.deepEqual(r.esperando, ['T07'], 'ninguém implementa a T07');
  assert.equal(r.cobertos.size, 0);
  const s = novo(PLANO, eventos, { agentes: [sombra] });
  assert.ok(s.atencao.includes('T07 sem agente trabalhando'), s.atencao.join('|'));
  assert.equal(s.agora?.agentes?.length, 1);
  assert.equal(s.agora?.agentes?.[0].quem.papel, 'sombra');
  assert.equal(s.agora?.agentes?.[0].task, null);
  // o padrão antigo `<task> <papel>` ainda vence o tipo
  assert.equal(casarVivo(vivoT('s2', 'T07 revisor', SOMBRA), PLANO, semEstado).papel, 'revisor');
});

test('acao-ao-vivo-vence-o-registrado: `acoes` do mod é a ação do agente; só a do próprio id (FIEL-11 b)', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const agentes = [vivoT('a1', 'T07 implementador', IMPL), vivoT('a2', 'rascunho do plano', 'general-purpose')];
  const acoes = { a1: { texto: 'lendo 3 arquivos', fonte: 'tool' as const, em: AGORA - 5000 }, a2: { texto: 'rodando 1 comando', fonte: 'tool' as const, em: AGORA - 1000 } };
  const s = novo(PLANO, eventos, { agentes, acoes });
  const por = (id: string) => s.agora?.agentes?.find((x) => (id === 'a1' ? x.task === 'T07' : x.task === null));
  assert.equal(por('a1')?.acao, 'lendo 3 arquivos', 'casado: ao vivo, sem a marca de registrado');
  assert.equal(por('a2')?.acao, 'rodando 1 comando', 'sem task: ao vivo, sem a marca de registrado');
  const so = novo(PLANO, eventos, { agentes, acoes: { a1: acoes.a1 } });
  assert.equal(so.agora?.agentes?.find((x) => x.task === null)?.acao, 'rascunho do plano (registrado)', 'a ação de outro id não vaza');
  // o texto ao vivo é higienizado como a descrição (token técnico vira "…")
  const tec = novo(PLANO, eventos, { agentes, acoes: { a1: { texto: 'editando spec-brief.md', fonte: 'tool', em: 1 } } });
  assert.equal(tec.agora?.agentes?.find((x) => x.task === 'T07')?.acao, 'editando …');
});

test('acao-plano-b-registrado: sem `acoes`, a description do despacho vai marcada "(registrado)", casada ou não (FIEL-11 b)', () => {
  const eventos = diario(ini('T07', 'implementador'));
  const s = novo(PLANO, eventos, { agentes: [vivoT('a1', 'T07 implementador', IMPL), vivoT('a2', 'Explorar o repositório', 'general-purpose')] });
  assert.equal(s.agora?.agentes?.find((x) => x.task === 'T07')?.acao, 'implementando (registrado)', 'só "<task> <papel>": o papel em palavras');
  assert.equal(s.agora?.agentes?.find((x) => x.task === null)?.acao, 'Explorar o repositório (registrado)', 'o vivo sem task também marca');
  const cas = novo(PLANO, eventos, { agentes: [vivoT('a1', 'T07 Contratos do painel', IMPL)] });
  assert.equal(cas.agora?.agentes?.[0].acao, 'T07 Contratos do painel (registrado)');
});

test('acao-sem-fonte-interrogacao: sem acoes e sem description, a ação é null (o render escreve "?"), nunca inventada', () => {
  const s = novo(PLANO, [], { agentes: [vivoT('a1', '   ', 'general-purpose')] });
  assert.equal(s.agora?.agentes?.[0].acao, null);
  assert.equal(s.agora?.agentes?.[0].task, null);
});

test('segundo-plano-no-agora: "Teste" com o dono, a description e o tempo; só com o mod (FIEL-11 c)', () => {
  const agentes = [vivoT('a1', 'T07 implementador', IMPL)];
  const eventos = diario(ini('T07', 'implementador'));
  const segundoPlano = [
    { id: 'b1', dono: 'a1', texto: 'npm test', desde: AGORA - 90_000 },
    { id: 'b2', dono: 'orquestrador', texto: 'build do plugin', desde: AGORA - 30_000 },
    { id: 'b3', dono: 'a1', texto: 'rodar x', desde: Number.NaN },
  ];
  const s = novo(PLANO, eventos, { agentes, segundoPlano });
  const sp = s.agora?.segundoPlano ?? [];
  assert.equal(sp.length, 3);
  // GM-15 T33 (g.11, D-G8): `quem` = quem disparou (a sessão principal ou o agente dono), `acao` = o tipo do shell pelo comando/descrição (rotuloDoShell)
  assert.deepEqual(sp.map((x) => x.quem.papel), ['implementador', 'orquestrador', 'implementador']);
  assert.deepEqual(sp.map((x) => x.task), ['T07', null, 'T07'], 'dono agente ⇒ a task dele; orquestrador sem prova ⇒ sem task');
  assert.deepEqual(sp.map((x) => x.desdeS), [90, 30, null]);
  assert.deepEqual(sp.map((x) => x.acao), ['Teste', 'Comando', 'Comando'], 'npm test ⇒ Teste; o resto ⇒ Comando');
  assert.deepEqual(novo(PLANO, eventos, { agentes }).agora?.segundoPlano, [], 'sem lista ⇒ vazio');
  assert.deepEqual(novo(PLANO, eventos, { agentes: null, segundoPlano }).agora?.segundoPlano, [], 'sem mod ⇒ vazio');
});

test('sombra-ativa-no-agora: Sombra viva é linha do AGORA e cala a consulta sem registro no ATENÇÃO (FIEL-7)', () => {
  const consulta: [TipoEvento, Record<string, unknown>] = ['sombra.consulta', { pergunta_hash: 'a'.repeat(64), task: 'T07' }];
  const eventos = diario(consulta);
  const com = novo(PLANO, eventos, { agentes: [vivoT('s1', 'dúvida do nome', SOMBRA)] });
  assert.equal(com.agora?.agentes?.length, 1);
  assert.equal(com.agora?.agentes?.[0].quem.papel, 'sombra');
  assert.ok(!com.atencao.some((x) => /Sombra/.test(x)), `Sombra ativa: ${com.atencao.join('|')}`);
  const sem = novo(PLANO, eventos, { agentes: [] });
  assert.ok(sem.atencao.some((x) => /^1 consulta à Sombra sem /.test(x)), `sem Sombra ativa: ${sem.atencao.join('|')}`);
});

/**
 * Testes de `formaInvalida` (GM-11 T1): forma de `dados` por tipo de evento novo do diário. Total: nunca lança; `null` = forma ok ou
 * tipo sem regra. Mutações prescritas (.superpowers/sdd/2026-11-09-e3-sombra/task-1-mut.json):
 *  M-SOM2   aceitar `medicao: ''` como fonte ⇒ `forma-decisao-sem-fontes-nem-medicao` falha
 *  M-F1     REQ_RE sem âncora final ⇒ `req-re-ancorada` falha
 *  M-F2     `consulta` aceitar os dois (req e task) ⇒ `forma-consulta-req-ou-task` falha
 *  M-F3     resposta ≤ 1001 ⇒ `forma-decisao-resposta-1001` falha
 *  M-F4     `dados` ausente tratado como corrompido ⇒ `forma-ausente-x-corrompida` falha
 *  M-F5     `entrega.fim` sem enum de motivo ⇒ `forma-entrega-fim-motivo-invalido` falha
 *  M-F6     tipo antigo com regra nova ⇒ `forma-tipo-antigo-sem-regra` falha
 *  M-F7     `formaInvalida` sem try/catch ⇒ `forma-total-nunca-lanca` falha
 *  M-F8     `formaInvalida` por tipo novo aceita `{}` ⇒ `forma-invalida-por-tipo-novo` falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formaInvalida, REQ_RE } from '../src/formas.ts';

const H = 'a'.repeat(64);
const ok = (tipo: string, dados: unknown) => assert.equal(formaInvalida(tipo, dados), null, `${tipo} ${JSON.stringify(dados)}`);
const ruim = (tipo: string, dados: unknown, campo?: RegExp) => {
  const r = formaInvalida(tipo, dados);
  assert.equal(typeof r, 'string', `${tipo} ${JSON.stringify(dados)} deveria ser recusado`);
  assert.match(r as string, /\S/);
  if (campo) assert.match(r as string, campo, `${tipo} ${JSON.stringify(dados)}: motivo ${r}`);
};

const decisao = (extra: Record<string, unknown> = {}) => ({
  pergunta_hash: H, req: 'REQ-SOM-1', resposta: 'sim', arquivo: 'sombra/x.resposta.md', pergunta_enviesada: false, fontes: ['spec:10'], ...extra,
});
const proposta = (extra: Record<string, unknown> = {}) => ({
  req: 'REQ-EME-1', diff: '--- a\n+++ b', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', ...extra,
});

test('req-re-ancorada: casa o padrão inteiro, sem minúscula nem sufixo', () => {
  for (const b of ['REQ-A-1', 'REQ-SOM-12', 'REQ-X9-0']) assert.equal(REQ_RE.test(b), true, b);
  for (const m of ['REQ-A-1x', 'req-a-1', 'REQ-a-1', 'xREQ-A-1', 'REQ-A-', 'REQ--1', 'REQ-A-1\n', ' REQ-A-1', 'REQ-A-1 ', 'REQ-A-1-2', '']) assert.equal(REQ_RE.test(m), false, JSON.stringify(m));
});

test('forma-consulta-req-ou-task: exatamente um dos dois', () => {
  ok('sombra.consulta', { pergunta_hash: H, req: 'REQ-SOM-1' });
  ok('sombra.consulta', { pergunta_hash: H, task: 'T7' });
  ruim('sombra.consulta', { pergunta_hash: H, req: 'REQ-SOM-1', task: 'T7' }, /req|task/);
  ruim('sombra.consulta', { pergunta_hash: H }, /req|task/);
  ruim('sombra.consulta', { pergunta_hash: 'abc', req: 'REQ-SOM-1' }, /pergunta_hash/);
  ruim('sombra.consulta', { pergunta_hash: 'A'.repeat(64), req: 'REQ-SOM-1' }, /pergunta_hash/);
  ruim('sombra.consulta', { pergunta_hash: H, req: 'req-som-1' }, /req/);
  ruim('sombra.consulta', { pergunta_hash: H, task: '' }, /task/);
  ruim('sombra.consulta', { pergunta_hash: H, task: 7 }, /task/);
});

test('forma-decisao-sem-fontes-nem-medicao: nem fontes nem medicao recusa; medicao vazia não conta como fonte', () => {
  ok('decisao.sombra', decisao());
  ok('decisao.sombra', decisao({ fontes: undefined, medicao: 'rodei: 12' }));
  const { fontes: _f, ...semFontes } = decisao();
  ruim('decisao.sombra', semFontes, /fontes|medicao/);
  ruim('decisao.sombra', decisao({ fontes: undefined, medicao: '' }), /medicao/);
  ruim('decisao.sombra', decisao({ fontes: undefined, medicao: '   ' }), /medicao/);
  ruim('decisao.sombra', decisao({ fontes: [] }), /fontes/);
  ruim('decisao.sombra', decisao({ fontes: [''] }), /fontes/);
  ruim('decisao.sombra', decisao({ fontes: 'spec:10' }), /fontes/);
  ruim('decisao.sombra', decisao({ medicao: 7 }), /medicao/);
});

test('forma-decisao-fora-da-regra-sem-emenda-seq: fora_da_regra exige emenda_seq; sem ele, fontes ou medicao', () => {
  ok('decisao.sombra', decisao({ fora_da_regra: true, emenda_seq: 3, fontes: undefined }));
  ruim('decisao.sombra', decisao({ fora_da_regra: true, fontes: undefined }), /emenda_seq/);
  ruim('decisao.sombra', decisao({ fora_da_regra: true }), /emenda_seq/);
  ruim('decisao.sombra', decisao({ fora_da_regra: true, emenda_seq: 0 }), /emenda_seq/);
  ruim('decisao.sombra', decisao({ fora_da_regra: true, emenda_seq: 1.5 }), /emenda_seq/);
  ruim('decisao.sombra', decisao({ fora_da_regra: false, emenda_seq: 3 }), /fora_da_regra/);
  ruim('decisao.sombra', decisao({ emenda_seq: -1 }), /emenda_seq/);
});

test('forma-decisao-resposta-1001: resposta de 1 a 1000 caracteres', () => {
  ok('decisao.sombra', decisao({ resposta: 'x' }));
  ok('decisao.sombra', decisao({ resposta: 'x'.repeat(1000) }));
  ruim('decisao.sombra', decisao({ resposta: 'x'.repeat(1001) }), /resposta/);
  ruim('decisao.sombra', decisao({ resposta: '' }), /resposta/);
  ruim('decisao.sombra', decisao({ resposta: 42 }), /resposta/);
  ruim('decisao.sombra', decisao({ arquivo: '' }), /arquivo/);
  ruim('decisao.sombra', decisao({ pergunta_enviesada: 'não' }), /pergunta_enviesada/);
  ruim('decisao.sombra', decisao({ substitui: { sessao: 's', seq: 0 } }), /substitui/);
  ruim('decisao.sombra', decisao({ substitui: 'x' }), /substitui/);
  ruim('decisao.sombra', decisao({ substitui: { seq: 2 } }), /substitui/);
  ruim('decisao.sombra', decisao({ substitui: { sessao: '', seq: 2 } }), /substitui/);
  ok('decisao.sombra', decisao({ substitui: { sessao: 's', seq: 2 } }));
});

test('forma-proposta-sem-causa: causa fora do enum, req fora do padrão, diff e evidência vazios', () => {
  ok('emenda.proposta', proposta());
  ok('emenda.proposta', proposta({ causa: 'regra_negocio', task: 'T3', arquivos: ['a.ts'] }));
  const { causa: _c, ...sem } = proposta();
  ruim('emenda.proposta', sem, /causa/);
  ruim('emenda.proposta', proposta({ causa: 'outra' }), /causa/);
  ruim('emenda.proposta', proposta({ causa: 3 }), /causa/);
  ruim('emenda.proposta', proposta({ req: 'REQ-A-1x' }), /req/);
  ruim('emenda.proposta', proposta({ diff: '' }), /diff/);
  ruim('emenda.proposta', proposta({ evidencia: '' }), /evidencia/);
  ruim('emenda.proposta', proposta({ fato: 9 }), /fato/);
  ruim('emenda.proposta', proposta({ alternativa: undefined }), /alternativa/);
  ruim('emenda.proposta', proposta({ arquivos: 'a.ts' }), /arquivos/);
  ruim('emenda.proposta', proposta({ task: '' }), /task/);
});

test('forma-desvio-evidencia-vazia: desvio e descoberta', () => {
  const d = { task: 'T1', req: 'REQ-LOOP-1', evidencia: 'arquivo:10', arquivos: ['a.ts'], causa: 'tecnica' };
  ok('desvio', d);
  ruim('desvio', { ...d, evidencia: '' }, /evidencia/);
  ruim('desvio', { ...d, evidencia: '  ' }, /evidencia/);
  ruim('desvio', { ...d, arquivos: 'a.ts' }, /arquivos/);
  const { arquivos: _a, ...semArquivos } = d;
  ruim('desvio', semArquivos, /arquivos/);
  ruim('desvio', { ...d, arquivos: [1] }, /arquivos/);
  ruim('desvio', { ...d, causa: 'x' }, /causa/);
  ruim('desvio', { ...d, req: 'LOOP-1' }, /req/);
  ruim('desvio', { ...d, task: '' }, /task/);
  ok('descoberta', { evidencia: 'achei', causa: 'regra_negocio' });
  ruim('descoberta', { evidencia: '', causa: 'tecnica' }, /evidencia/);
  ruim('descoberta', { evidencia: 'x', causa: 'tecnica ' }, /causa/);
  ruim('descoberta', { evidencia: 'x' }, /causa/);
});

test('forma-julgamento-seq-zero: proposta_seq inteiro ≥ 1 e origem no enum', () => {
  for (const tipo of ['spec.emendada', 'emenda.rejeitada']) {
    ok(tipo, { proposta_seq: 1, origem: 'dono' });
    ok(tipo, { proposta_seq: 12, origem: 'sombra' });
    ruim(tipo, { proposta_seq: 0, origem: 'dono' }, /proposta_seq/);
    ruim(tipo, { proposta_seq: -2, origem: 'dono' }, /proposta_seq/);
    ruim(tipo, { proposta_seq: 1.5, origem: 'dono' }, /proposta_seq/);
    ruim(tipo, { proposta_seq: '1', origem: 'dono' }, /proposta_seq/);
    ruim(tipo, { origem: 'dono' }, /proposta_seq/);
    ruim(tipo, { proposta_seq: 1, origem: 'orquestrador' }, /origem/);
    ruim(tipo, { proposta_seq: 1 }, /origem/);
  }
});

test('forma-entrega-fim-motivo-invalido: motivo só deploy, smoke ou rollback (Sombra D6)', () => {
  ok('entrega.fim', { ok: true });
  ok('entrega.fim', { ok: false, motivo: 'deploy' });
  ok('entrega.fim', { ok: false, motivo: 'smoke' });
  ok('entrega.fim', { ok: false, motivo: 'rollback' });
  ruim('entrega.fim', { ok: false, motivo: 'outro' }, /motivo/);
  ruim('entrega.fim', { ok: false, motivo: 'nao_conseguiu' }, /motivo/);
  ruim('entrega.fim', { ok: false, motivo: '' }, /motivo/);
  ruim('entrega.fim', { ok: false, motivo: 7 }, /motivo/);
  ruim('entrega.fim', { motivo: 'deploy' }, /ok/);
  ruim('entrega.fim', { ok: 'sim' }, /ok/);
});

test('forma-entrega: inicio, smoke, rollback e agendada', () => {
  for (const p of ['continua', 'janela', 'sob_demanda']) ok('entrega.inicio', { politica: p });
  ruim('entrega.inicio', { politica: 'sempre' }, /politica/);
  ruim('entrega.inicio', {}, /politica/);
  for (const t of ['entrega.smoke', 'entrega.rollback']) {
    ok(t, { ok: true });
    ok(t, { ok: false });
    ruim(t, { ok: 1 }, /ok/);
    ruim(t, {}, /ok/);
  }
  ok('entrega.agendada', { quando: '2026-11-10T09:00:00Z' });
  ok('entrega.agendada', { quando: '2026-11-10T09:00:00.123-03:00' });
  ruim('entrega.agendada', { quando: 'amanhã' }, /quando/);
  ruim('entrega.agendada', { quando: '2026-02-31T09:00:00Z' }, /quando/);
  ruim('entrega.agendada', { quando: '2026-11-10T25:00:00Z' }, /quando/);
  ruim('entrega.agendada', { quando: '2026-11-10' }, /quando/);
  ruim('entrega.agendada', { quando: '2026-11-10T09:00:00' }, /quando/); // sem fuso: Date.parse leria na hora local da máquina
  ruim('entrega.agendada', { quando: 1762765200000 }, /quando/);
  ruim('entrega.agendada', {}, /quando/);
});

test('forma-ci-alvo-invalido: ci.resultado aceita alvo homolog; custo.medicao papel e modelo opcionais', () => {
  ok('ci.resultado', { verde: true });
  ok('ci.resultado', { verde: true, alvo: 'homolog' });
  ruim('ci.resultado', { verde: true, alvo: 'prod' }, /alvo/);
  ruim('ci.resultado', { verde: true, alvo: 7 }, /alvo/);
  ruim('ci.resultado', { verde: true, alvo: '' }, /alvo/);
  ok('custo.medicao', { agente: 'orquestrador', input_tokens: 1 });
  ok('custo.medicao', { agente: 'subagent:x', papel: 'sombra', modelo: 'claude-opus-5-5' });
  ok('custo.medicao', { agente: 'subagent:x', papel: 'sombra', modelo: null });
  ruim('custo.medicao', { papel: 3 }, /papel/);
  ruim('custo.medicao', { modelo: 3 }, /modelo/);
});

test('forma-tipo-antigo-sem-regra: tipos da E1/E2 sem regra nova seguem aceitos com quaisquer dados de hoje', () => {
  const antigos = ['guarda.deny', 'guarda.ask', 'producao.acesso', 'operacao.destrutiva', 'sessao.inicio', 'guarda.heartbeat', 'diario.recusa',
    'task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta', 'loop.parar', 'loop.pausa', 'sessao.pouso', 'sessao.retomada'];
  for (const t of antigos) {
    for (const d of [{}, { qualquer: 1 }, { task: 'T1', origem: 'dono' }, null, undefined, 'x', [], 5]) assert.equal(formaInvalida(t, d), null, `${t} ${JSON.stringify(d)}`);
  }
  // ci.resultado e custo.medicao têm só campo opcional novo: o que existia hoje segue aceito, inclusive dados que não são objeto
  for (const t of ['ci.resultado', 'custo.medicao']) for (const d of [{}, { verde: false }, null, undefined, 'x', [], 5]) assert.equal(formaInvalida(t, d), null, `${t} ${JSON.stringify(d)}`);
  // tipo desconhecido ou que não é texto: sem regra
  for (const t of ['nao.existe', '', '__proto__', 'constructor', 'toString']) assert.equal(formaInvalida(t, { a: 1 }), null, t);
  assert.equal(formaInvalida(undefined as never, {}), null);
});

test('forma-ausente-x-corrompida: dados ausente e dados corrompido dão motivos distintos, nenhum lança', () => {
  for (const tipo of ['sombra.consulta', 'decisao.sombra', 'desvio', 'descoberta', 'emenda.proposta', 'spec.emendada', 'emenda.rejeitada', 'entrega.inicio',
    'entrega.smoke', 'entrega.rollback', 'entrega.fim', 'entrega.agendada']) {
    const ausente = formaInvalida(tipo, undefined);
    const corrompido = formaInvalida(tipo, 'x');
    assert.equal(typeof ausente, 'string', tipo);
    assert.equal(typeof corrompido, 'string', tipo);
    assert.notEqual(ausente, corrompido, tipo);
    assert.match(ausente as string, /ausente/, tipo);
    assert.match(corrompido as string, /corromp/, tipo);
    assert.doesNotMatch(corrompido as string, /ausente/, tipo);
  }
});

test('forma-total-nunca-lanca: null, array, string, número, __proto__, getter hostil, tipo e campo no lugar errado', () => {
  const tipos = ['sombra.consulta', 'decisao.sombra', 'desvio', 'descoberta', 'emenda.proposta', 'spec.emendada', 'emenda.rejeitada', 'entrega.inicio',
    'entrega.smoke', 'entrega.rollback', 'entrega.fim', 'entrega.agendada', 'ci.resultado', 'custo.medicao', 'guarda.deny'];
  const hostil = { get req(): never { throw new Error('boom'); }, get pergunta_hash(): never { throw new Error('boom'); } };
  const proxy = new Proxy({}, { get() { throw new Error('proxy'); }, has() { throw new Error('proxy'); }, ownKeys() { throw new Error('proxy'); }, getOwnPropertyDescriptor() { throw new Error('proxy'); } });
  const entradas: unknown[] = [null, undefined, [], [1, 2], 'texto', 42, true, Symbol('s'), 10n, () => 1, JSON.parse('{"__proto__":{"req":"REQ-A-1"}}'),
    JSON.parse('{"__proto__":"x","pergunta_hash":"x"}'), { __proto__: { req: 'REQ-A-1' } }, hostil, proxy, { req: 7, task: 8, resposta: 9, causa: {}, evidencia: [], arquivos: {} },
    Object.create(null), new Date(), /x/];
  for (const tipo of tipos) for (const d of entradas) {
    let r: string | null = 'x';
    assert.doesNotThrow(() => { r = formaInvalida(tipo, d); }, `${tipo} ${String(typeof d)}`);
    assert.ok(r === null || typeof r === 'string');
  }
  // sem prototype poluído
  assert.equal(({} as Record<string, unknown>).req, undefined);
});

test('forma-proto-herdado-nao-conta: campo vindo do prototype não satisfaz a regra', () => {
  const d = Object.create({ pergunta_hash: H, req: 'REQ-SOM-1' });
  ruim('sombra.consulta', d, /pergunta_hash/);
  ruim('sombra.consulta', JSON.parse(`{"__proto__":{"pergunta_hash":"${H}","req":"REQ-SOM-1"}}`), /pergunta_hash/);
});

test('forma-invalida-por-tipo-novo: {} é recusado em todo tipo novo com campo obrigatório', () => {
  for (const tipo of ['sombra.consulta', 'decisao.sombra', 'desvio', 'descoberta', 'emenda.proposta', 'spec.emendada', 'emenda.rejeitada', 'entrega.inicio',
    'entrega.smoke', 'entrega.rollback', 'entrega.fim', 'entrega.agendada']) ruim(tipo, {});
});

// ---- E4 (GM-12 T1): spec.aprovada, entrega.devolvida e os campos opcionais novos de task.iniciada e task.integrada.
// Mutações prescritas (.superpowers/sdd/2026-11-09-e4-painel/task-1-mut.json): MUT-T1-F1 a F7.

test('forma-spec-aprovada-sha-curto: spec texto não vazio e sha256 hex minúsculo de 64', () => {
  ok('spec.aprovada', { spec: 'docs/superpowers/specs/x.md', sha256: H });
  ok('spec.aprovada', { spec: 'x.md', sha256: '0123456789abcdef'.repeat(4) });
  ruim('spec.aprovada', { spec: 'x.md', sha256: 'a'.repeat(63) }, /sha256/);
  ruim('spec.aprovada', { spec: 'x.md', sha256: 'a'.repeat(65) }, /sha256/);
  ruim('spec.aprovada', { spec: 'x.md', sha256: 'A'.repeat(64) }, /sha256/);
  ruim('spec.aprovada', { spec: 'x.md', sha256: `${'a'.repeat(63)}g` }, /sha256/);
  ruim('spec.aprovada', { spec: 'x.md', sha256: 'abc' }, /sha256/);
  ruim('spec.aprovada', { spec: 'x.md', sha256: 7 }, /sha256/);
  ruim('spec.aprovada', { spec: '', sha256: H }, /spec/);
  ruim('spec.aprovada', { spec: '   ', sha256: H }, /spec/);
  ruim('spec.aprovada', { spec: 7, sha256: H }, /spec/);
});

test('forma-devolvida-motivo-vazio: motivo de 1 a 200 caracteres', () => {
  ok('entrega.devolvida', { motivo: 'x' });
  ok('entrega.devolvida', { motivo: 'm'.repeat(200) });
  ok('entrega.devolvida', { motivo: 'ç'.repeat(200) });
  ruim('entrega.devolvida', { motivo: '' }, /motivo/);
  ruim('entrega.devolvida', { motivo: '  \n ' }, /motivo/);
  ruim('entrega.devolvida', { motivo: 'm'.repeat(201) }, /motivo/);
  ruim('entrega.devolvida', { motivo: 'ç'.repeat(201) }, /motivo/);
  ruim('entrega.devolvida', { motivo: 12 }, /motivo/);
  ruim('entrega.devolvida', { motivo: null }, /motivo/);
  // o comando nunca vai ao diário (tipos.ts): campo extra não é recusado, mas o motivo continua obrigatório
  ruim('entrega.devolvida', { comando: 'node entrega.mjs executar' }, /motivo/);
});

test('forma-iniciada-modelo-fora: modelo opcional, só haiku|sonnet|opus|fable', () => {
  for (const m of ['haiku', 'sonnet', 'opus', 'fable']) ok('task.iniciada', { task: 'T1', papel: 'implementador', modelo: m });
  for (const m of ['gpt', 'Sonnet', 'opus ', '', null, 5, ['opus']]) ruim('task.iniciada', { task: 'T1', papel: 'implementador', modelo: m }, /modelo/);
});

test('forma-integrada-mortas-maior-que-total: mutacoes {total, mortas} inteiros ≥ 0 com mortas ≤ total', () => {
  ok('task.integrada', { task: 'T1', mutacoes: { total: 5, mortas: 5 } });
  ok('task.integrada', { task: 'T1', mutacoes: { total: 5, mortas: 0 } });
  ok('task.integrada', { task: 'T1', mutacoes: { total: 0, mortas: 0 } });
  ruim('task.integrada', { task: 'T1', mutacoes: { total: 5, mortas: 6 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: 0, mortas: 1 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: -1, mortas: 0 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: 5, mortas: -1 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: 5.5, mortas: 1 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: 5, mortas: 1.5 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: '5', mortas: 1 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { total: 5 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: { mortas: 1 } }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: {} }, /mutacoes/);
});

test('forma-campos-novos-ausentes-ok: eventos da E3 sem os campos novos seguem válidos, inclusive dados que não é objeto', () => {
  ok('task.iniciada', { task: 'T1', papel: 'revisor' });
  ok('task.integrada', { task: 'T1' });
  ok('task.iniciada', { task: 'T1', papel: 'revisor', modelo: undefined });
  ok('task.integrada', { task: 'T1', mutacoes: undefined });
  for (const tipo of ['task.iniciada', 'task.integrada']) for (const d of [undefined, null, 'texto', 7, [], [1]]) ok(tipo, d);
});

test('forma-ausente-x-corrompida (E4): spec.aprovada e entrega.devolvida distinguem dados ausente, dados corrompido, campo ausente e campo inválido', () => {
  for (const tipo of ['spec.aprovada', 'entrega.devolvida']) {
    ruim(tipo, undefined, /dados ausente/);
    for (const d of [null, 'x', 7, [], [{ motivo: 'x' }]]) ruim(tipo, d, /dados corrompido/);
    ruim(tipo, {}, /ausente/);
    assert.doesNotMatch(formaInvalida(tipo, {}) as string, /corrompido/);
  }
  ruim('spec.aprovada', { sha256: H }, /campo `spec` ausente/);
  ruim('spec.aprovada', { spec: 'x.md' }, /campo `sha256` ausente/);
  ruim('spec.aprovada', { spec: 'x.md', sha256: 'abc' }, /campo `sha256` inválido/);
  ruim('entrega.devolvida', {}, /campo `motivo` ausente/);
  ruim('entrega.devolvida', { motivo: '' }, /campo `motivo` inválido/);
  // campo opcional corrompido não é o mesmo que campo ausente (ausente é ok; corrompido é recusado)
  ok('task.integrada', { task: 'T1' });
  ruim('task.integrada', { task: 'T1', mutacoes: 'muitas' }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: null }, /mutacoes/);
  ruim('task.integrada', { task: 'T1', mutacoes: [] }, /mutacoes/);
  // proto herdado não conta
  ruim('spec.aprovada', Object.create({ spec: 'x.md', sha256: H }), /campo `spec` ausente/);
  ok('task.iniciada', Object.create({ task: 'T1', papel: 'revisor', modelo: 'gpt' }));
  for (const tipo of ['spec.aprovada', 'entrega.devolvida', 'task.iniciada', 'task.integrada']) {
    for (const d of [null, undefined, [], 'x', Object.create(null), { get spec(): never { throw new Error('boom'); }, get modelo(): never { throw new Error('boom'); } }]) {
      assert.doesNotThrow(() => formaInvalida(tipo, d), tipo);
    }
  }
});

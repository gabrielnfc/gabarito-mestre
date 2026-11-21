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
 * GM-18 T1 (REQ-ENC-1, M1a..M1g; as de origem/trilha estão em origem.test.ts e encerramento.test.ts):
 *  M1a  `dono` em VIAS_PR                                   ⇒ `fato-pr-via-dono-recusado`
 *  M1b  VIAS_ENCERRAMENTO como literal copiado              ⇒ `vias-encerramento-deriva-de-vias-pr`
 *  M1c  origem "(automático)" para `dono`                   ⇒ `origem-encerrada-dono-voce` (origem.test.ts)
 *  M1d  origem "(você)" para todo `entrega.encerrada`       ⇒ `origem-encerrada-dono-voce` (origem.test.ts)
 *  M1e  re-encerramento do dono exigindo PR novo            ⇒ `dono-reencerra-apos-reabrir` (encerramento.test.ts)
 *  M1f  exceção valendo para todo `via`                     ⇒ `automatico-segue-exigindo-pr-novo` (encerramento.test.ts)
 *  M1g  `podeEncerrar` aceitando `via: 'dono'`              ⇒ `medir-nao-encerra-sobre-dono` (encerramento.test.ts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formaInvalida, formaNaGravacao, ID_PERGUNTA_RE, MOTIVOS_PARAR, REQ_RE, TIPOS_EVENTO, VIAS_ENCERRAMENTO, VIAS_PR } from '../src/formas.ts';

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
    'task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'loop.parar', 'loop.pausa', 'sessao.pouso', 'sessao.retomada'];
  // `task.reaberta` saiu desta lista de propósito (GM-15 T1, F7 a): origem fechada; ver `reaberta-origem-invalida-recusada-no-append`.
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

// ---- GM-14 T32 (Emenda 3, FIEL-9 e): `ja_na_base` opcional, só o literal `true`, nunca junto de `mutacoes`. Mutação M-F9i.
test('forma-task-integrada-ja-na-base: ausente válido; true válido; false, "sim", 1 e afins recusados; true com mutacoes recusado', () => {
  ok('task.integrada', { task: 'T1', sha: 'a'.repeat(40) });
  ok('task.integrada', { task: 'T1', sha: 'a'.repeat(40), ja_na_base: true });
  ok('task.integrada', { task: 'T1', sha: 'a'.repeat(40), mutacoes: { total: 2, mortas: 2 } });
  for (const v of [false, 'sim', 'true', 1, 0, null, [], {}]) ruim('task.integrada', { task: 'T1', sha: 'a'.repeat(40), ja_na_base: v }, /ja_na_base/);
  ruim('task.integrada', { task: 'T1', sha: 'a'.repeat(40), ja_na_base: true, mutacoes: { total: 0, mortas: 0 } }, /ja_na_base/);
  ruim('task.integrada', { task: 'T1', sha: 'a'.repeat(40), ja_na_base: true, mutacoes: { total: 3, mortas: 3 } }, /ja_na_base/);
});

// ---- GM-14 T31 (Emenda 2, FIEL-8 b6): `motivo` opcional em `task.concluida`, só gate | sombra | dono. Mutação M-F8f.
test('forma-task-concluida-motivo: ausente válido (2.0.0); gate, sombra e dono válidos; x, null, vazio, número e caixa trocada recusados', () => {
  ok('task.concluida', { task: 'T1', sha: 'a'.repeat(40) });
  ok('task.concluida', { task: 'T1' });
  ok('task.concluida', { task: 'T1', sha: 'a'.repeat(40), motivo: undefined });
  for (const m of ['gate', 'sombra', 'dono']) ok('task.concluida', { task: 'T1', sha: 'a'.repeat(40), motivo: m });
  for (const v of ['x', null, '', ' gate', 'Gate', 'GATE', 1, 0, true, [], {}, ['gate']]) {
    const r = formaInvalida('task.concluida', { task: 'T1', sha: 'a'.repeat(40), motivo: v });
    assert.ok(typeof r === 'string' && /`motivo`/.test(r) && /gate \| sombra \| dono/.test(r), `${JSON.stringify(v)} => ${r}`);
  }
});

// ---- GM-14 T31 Emenda 12 (anexos C a5, FIEL-8 c): `sha` no `iniciar revisor` e no APROVADO. Ausente só na leitura (2.0.0). Mutações M-F8j e M-F8m.
const SHA = 'a'.repeat(40);
test('forma-review-veredito-sha: leitura aceita ausente; sha presente só hex de commit; gravação exige no APROVADO, não no REPROVADO', () => {
  const v = (veredito: string, extra: Record<string, unknown> = {}) => ({ task: 'T1', veredito, rodada: 1, blocker: 0, major: 0, ...extra });
  ok('review.veredito', v('APROVADO'));
  ok('review.veredito', v('APROVADO', { sha: SHA }));
  ok('review.veredito', v('APROVADO', { sha: 'b'.repeat(64) }));
  for (const x of ['x', '', 'A'.repeat(40), 'a'.repeat(39), 1, null, [], {}]) ruim('review.veredito', v('APROVADO', { sha: x }), /sha/);
  assert.match(formaNaGravacao('review.veredito', v('APROVADO')) as string, /`sha` ausente/);
  assert.equal(formaNaGravacao('review.veredito', v('APROVADO', { sha: SHA })), null);
  assert.equal(formaNaGravacao('review.veredito', v('REPROVADO', { major: 1 })), null, 'o REPROVADO não carrega sha');
  assert.match(formaNaGravacao('review.veredito', v('APROVADO', { sha: 'x' })) as string, /sha/, 'a gravação também confere a forma de leitura');
});
test('forma-iniciar-revisor-sha: leitura aceita ausente; gravação exige sha só no papel revisor', () => {
  ok('task.iniciada', { task: 'T1', papel: 'revisor' });
  ok('task.iniciada', { task: 'T1', papel: 'revisor', sha: SHA });
  for (const x of ['x', '', 7, null]) ruim('task.iniciada', { task: 'T1', papel: 'revisor', sha: x }, /sha/);
  assert.match(formaNaGravacao('task.iniciada', { task: 'T1', papel: 'revisor' }) as string, /`sha` ausente/);
  assert.equal(formaNaGravacao('task.iniciada', { task: 'T1', papel: 'revisor', sha: SHA }), null);
  for (const papel of ['implementador', 'correcao']) assert.equal(formaNaGravacao('task.iniciada', { task: 'T1', papel }), null, papel);
  assert.equal(formaNaGravacao('task.concluida', { task: 'T1', sha: SHA }), null, 'outros tipos: só a forma de leitura');
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

// ── E5a (GM-13 T1): aprendizado, aprendizado.nada, dono.mensagem ───────────────────────────────────────────────────────────────
const apr = (extra: Record<string, unknown> = {}) => ({
  tipo: 'E', status: 'M', gatilho: { sessao: 'loop', seq: 3 }, evidencia: {}, regra: 'feche o aprendizado antes de concluir', entra_em: ['instantaneo'], ...extra,
});
const aprD = (ev: Record<string, unknown> = { eventos: [{ sessao: 'loop', seq: 3 }] }, extra: Record<string, unknown> = {}) => apr({ status: 'D', evidencia: ev, ...extra });

test('forma-aprendizado-campos-validos-lidos: cada campo aceito tem seu valor lido pela regra', () => {
  ok('aprendizado', apr());
  ok('aprendizado', apr({ gatilho: null }));
  ok('aprendizado', apr({ tipo: 'A' }));
  ok('aprendizado', aprD());
  ok('aprendizado', apr({ entra_em: ['instantaneo', 'spec', 'brief:implementador', 'brief:revisor', 'brief:correcao'] }));
  ruim('aprendizado', apr({ tipo: 'X' }), /`tipo`/);
  ruim('aprendizado', apr({ tipo: 'e' }), /`tipo`/);
  ruim('aprendizado', apr({ status: 'X' }), /`status`/);
  ruim('aprendizado', apr({ gatilho: { sessao: 'loop', seq: 0 } }), /`gatilho`/);
  ruim('aprendizado', apr({ gatilho: { sessao: 'a/b', seq: 1 } }), /`gatilho`/);
  ruim('aprendizado', apr({ gatilho: { sessao: 'loop', seq: 1.5 } }), /`gatilho`/);
  ruim('aprendizado', apr({ gatilho: 'loop:3' }), /`gatilho`/);
  ruim('aprendizado', apr({ evidencia: 'x' }), /`evidencia`/);
  ruim('aprendizado', apr({ evidencia: [] }), /`evidencia`/);
  ruim('aprendizado', apr({ regra: '' }), /`regra`/);
  ruim('aprendizado', apr({ regra: 7 }), /`regra`/);
  ruim('aprendizado', apr({ entra_em: 'instantaneo' }), /`entra_em`/);
});

test('forma-aprendizado-brief-sombra-recusa: brief só com os papéis do loop', () => {
  ok('aprendizado', apr({ entra_em: ['brief:correcao'] }));
  ruim('aprendizado', apr({ entra_em: ['brief:sombra'] }), /`entra_em`/);
  ruim('aprendizado', apr({ entra_em: ['brief:'] }), /`entra_em`/);
  ruim('aprendizado', apr({ entra_em: ['cartao'] }), /`entra_em`/);
  ruim('aprendizado', apr({ entra_em: [] }), /`entra_em`/);
});

test('forma-aprendizado-entra-em-repetido: lista com repetição recusa', () => {
  ruim('aprendizado', apr({ entra_em: ['spec', 'spec'] }), /`entra_em`/);
  ruim('aprendizado', apr({ entra_em: ['brief:revisor', 'instantaneo', 'brief:revisor'] }), /`entra_em`/);
});

test('forma-aprendizado-numero-texto-e-nan-recusa', () => {
  ok('aprendizado', aprD({ medicao: { fonte: 'docs/x.md', numero: 12 } }));
  ok('aprendizado', aprD({ medicao: { fonte: 'docs/x.md', numero: 0 } }));
  ok('aprendizado', aprD({ medicao: { fonte: 'docs/x.md', numero: -3.5 } }));
  for (const numero of ['12', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined]) {
    ruim('aprendizado', aprD({ medicao: { fonte: 'docs/x.md', numero } }), /`evidencia`/);
  }
  ruim('aprendizado', aprD({ medicao: { numero: 1 } }), /`evidencia`/);
  ruim('aprendizado', aprD({ medicao: 'x' }), /`evidencia`/);
});

test('forma-aprendizado-fonte-absoluta-e-ponto-ponto: fonte é relativa e fica na árvore', () => {
  for (const fonte of ['docs/x.md', 'a.txt', 'a/b/c.json']) ok('aprendizado', aprD({ medicao: { fonte, numero: 1 } }));
  for (const fonte of ['/etc/passwd', '../x', 'a/../../x', 'a/..', '..', '', '  ', '\\x', 'a\\..\\x', 'a\nb', 'C:\\x', 'a//b', 'a/']) {
    ruim('aprendizado', aprD({ medicao: { fonte, numero: 1 } }), /`evidencia`/);
  }
});

test('forma-aprendizado-fonte-evento-ok: evento:<sessao>:<seq>', () => {
  ok('aprendizado', aprD({ medicao: { fonte: 'evento:loop:12', numero: 1 } }));
  for (const fonte of ['evento:loop', 'evento::3', 'evento:loop:0', 'evento:loop:x', 'evento:a/b:3', 'evento:loop:3:4']) {
    ruim('aprendizado', aprD({ medicao: { fonte, numero: 1 } }), /`evidencia`/);
  }
});

test('forma-aprendizado-eventos-evidencia: lista não vazia de RefEvento', () => {
  ok('aprendizado', aprD({ eventos: [{ sessao: 'loop', seq: 1 }, { sessao: 'emendas', seq: 2 }] }));
  ruim('aprendizado', aprD({ eventos: [] }), /`evidencia`/);
  ruim('aprendizado', aprD({ eventos: [{ sessao: 'loop', seq: 0 }] }), /`evidencia`/);
  ruim('aprendizado', aprD({ eventos: 'loop:1' }), /`evidencia`/);
  ruim('aprendizado', aprD({ eventos: [null] }), /`evidencia`/);
});

test('forma-aprendizado-d-sem-evidencia-grave-como-m: D só com a evidência da máquina', () => {
  ruim('aprendizado', aprD({}), /grave como M/);
  ruim('aprendizado', apr({ status: 'D' }), /grave como M/);
  ok('aprendizado', aprD({ medicao: { fonte: 'docs/x.md', numero: 1 } }));
  ok('aprendizado', aprD({ eventos: [{ sessao: 'loop', seq: 1 }] }));
});

test('forma-aprendizado-d-sem-campo-evidencia-ausente-nao-corrompido: D sem a chave `evidencia` diz "ausente" (nunca "dados corrompido")', () => {
  const { evidencia: _fora, ...semEvidencia } = apr({ status: 'D' });
  for (const dados of [semEvidencia, { ...semEvidencia, evidencia: undefined }]) {
    const motivo = formaInvalida('aprendizado', dados) as string;
    assert.match(motivo, /campo `evidencia` ausente/);
    assert.doesNotMatch(motivo, /corrompido|ilegível/);
  }
  ruim('aprendizado', apr({ status: 'D', evidencia: 'texto' }), /campo `evidencia` inválido/);
});

test('forma-aprendizado-m-sem-evidencia-ok', () => {
  ok('aprendizado', apr({ status: 'M', evidencia: {} }));
});

test('forma-aprendizado-regra-301: 300 passa, 301 recusa, contado em caracteres', () => {
  ok('aprendizado', apr({ regra: 'a'.repeat(300) }));
  ok('aprendizado', apr({ regra: 'ç'.repeat(300) }));
  ok('aprendizado', apr({ regra: '😀'.repeat(300) }));
  ruim('aprendizado', apr({ regra: 'a'.repeat(301) }), /`regra`/);
  ruim('aprendizado', apr({ regra: '😀'.repeat(301) }), /`regra`/);
});

test('forma-substitui-entrega-invalida: entrega só casa ENTREGA_RE, ausente = corrente', () => {
  ok('aprendizado', apr({ substitui: { sessao: 'loop', seq: 1 } }));
  ok('aprendizado', apr({ substitui: { sessao: 'loop', seq: 1, entrega: 'GM-12' } }));
  for (const entrega of ['../GM-1', 'gm-1', '', 'GM-1/x', 'GM-', 'GM-1\n', 'GM 1', 7]) {
    ruim('aprendizado', apr({ substitui: { sessao: 'loop', seq: 1, entrega } }), /`substitui`/);
  }
  ruim('aprendizado', apr({ substitui: { sessao: 'loop', seq: 0 } }), /`substitui`/);
  ruim('aprendizado', apr({ substitui: { sessao: 'a/b', seq: 1 } }), /`substitui`/);
  ruim('aprendizado', apr({ substitui: 'x' }), /`substitui`/);
});

test('forma-nada-sem-motivo: gatilho obrigatório (evento) e motivo 1..300', () => {
  ok('aprendizado.nada', { gatilho: { sessao: 'loop', seq: 4 }, motivo: 'nada a registrar' });
  ok('aprendizado.nada', { gatilho: { sessao: 'loop', seq: 4 }, motivo: 'a'.repeat(300) });
  ruim('aprendizado.nada', { gatilho: { sessao: 'loop', seq: 4 } }, /`motivo` ausente/);
  ruim('aprendizado.nada', { gatilho: { sessao: 'loop', seq: 4 }, motivo: '' }, /`motivo`/);
  ruim('aprendizado.nada', { gatilho: { sessao: 'loop', seq: 4 }, motivo: 'a'.repeat(301) }, /`motivo`/);
  ruim('aprendizado.nada', { motivo: 'x' }, /`gatilho` ausente/);
  ruim('aprendizado.nada', { gatilho: null, motivo: 'x' }, /`gatilho`/);
  ruim('aprendizado.nada', { gatilho: { sessao: 'loop', seq: 0 }, motivo: 'x' }, /`gatilho`/);
});

test('forma-dono-mensagem-chave-extra-recusa: só {sha256, chars}; nunca o texto', () => {
  ok('dono.mensagem', { sha256: H, chars: 0 });
  ok('dono.mensagem', { sha256: H, chars: 120 });
  ruim('dono.mensagem', { sha256: H, chars: 5, texto: 'oi' }, /texto/);
  ruim('dono.mensagem', { sha256: H, chars: 5, outra: 1 }, /outra/);
  ruim('dono.mensagem', { sha256: H, chars: 5, mensagem: 'x' }, /mensagem/);
  ruim('dono.mensagem', { sha256: 'abc', chars: 5 }, /`sha256`/);
  ruim('dono.mensagem', { sha256: 'A'.repeat(64), chars: 5 }, /`sha256`/);
  ruim('dono.mensagem', { sha256: H, chars: -1 }, /`chars`/);
  ruim('dono.mensagem', { sha256: H, chars: 1.5 }, /`chars`/);
  ruim('dono.mensagem', { sha256: H, chars: '5' }, /`chars`/);
  ruim('dono.mensagem', { chars: 5 }, /`sha256` ausente/);
  ruim('dono.mensagem', { sha256: H }, /`chars` ausente/);
});

test('forma-novos-ausente-x-corrompido: dados ausente e dados corrompido têm motivos distintos, por tipo novo', () => {
  for (const tipo of ['aprendizado', 'aprendizado.nada', 'dono.mensagem']) {
    assert.match(formaInvalida(tipo, undefined) as string, /dados ausente/, tipo);
    for (const d of [null, [], 'x', 7, true]) assert.match(formaInvalida(tipo, d) as string, /dados corrompido/, `${tipo} ${JSON.stringify(d)}`);
    assert.match(formaInvalida(tipo, {}) as string, /campo `\w+` ausente/, tipo);
    assert.notEqual(formaInvalida(tipo, undefined), formaInvalida(tipo, null));
    const hostil = { get tipo(): never { throw new Error('boom'); }, get gatilho(): never { throw new Error('boom'); }, get sha256(): never { throw new Error('boom'); } };
    assert.doesNotThrow(() => formaInvalida(tipo, hostil), tipo);
    assert.match(formaInvalida(tipo, hostil) as string, /corrompido/, tipo);
  }
  assert.equal(formaInvalida('aprendizado', Object.create({ tipo: 'E' })) !== null, true);
});

// ── GM-14 T1: fato.medido, nota, dono.resposta, confirmacao, listas runtime ────────────────────────────────────────────────────
// Mutações prescritas (.superpowers/sdd/2026-11-11-proxima/task-1-mut.json):
//  M-T1a  `fato.medido` aceita campo extra no `valor` ⇒ `forma-fato-campo-extra-recusa` falha
//  M-T1b  `dono.resposta` aceita `texto` ⇒ `forma-resposta-com-texto-recusa` falha
//  M-T1c  `IdPergunta` volta a aceitar `herdar:<n>` (índice, não id estável; DP-6) ⇒ `forma-resposta-herdar-ok` falha
//  M-T1d  `opcao` aceita 0 ⇒ `forma-resposta-duas-formas-recusa` falha

const VALORES: Record<string, { fonte: string; valor: Record<string, unknown> }> = {
  branch: { fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } },
  spec: { fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/x.md', sha256: H, secoes: 7 } },
  plano: { fonte: 'arquivo', valor: { tasks: 26 } },
  pr: { fonte: 'gh', valor: { numero: 14, estado: 'aberto', branch: 'enabler/GM-14-clareza' } },
  release: { fonte: 'gh', valor: { tag: 'gabarito-mestre--v2.0.0' } },
  agente: { fonte: 'mod', valor: { id: 'a1', papel: 'implementador', estado: 'running' } },
};
const fato = (chave: string, valor: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ chave, fonte: VALORES[chave].fonte, valor: { ...VALORES[chave].valor, ...valor }, ...extra });

test('forma-fato-campo-extra-recusa: cada uma das 6 chaves aceita a forma exata e recusa campo a mais, a menos ou de outra chave', () => {
  assert.deepEqual(Object.keys(VALORES).sort(), ['agente', 'branch', 'plano', 'pr', 'release', 'spec']);
  for (const chave of Object.keys(VALORES)) {
    ok('fato.medido', fato(chave));
    ruim('fato.medido', fato(chave, { extra: 1 }), /`extra`/);
    ruim('fato.medido', fato(chave, {}, { extra: 1 }), /`extra`/);
    // Cada campo do valor é lido: sem ele, recusa citando o campo.
    for (const k of Object.keys(VALORES[chave].valor)) {
      const { [k]: _fora, ...sem } = VALORES[chave].valor;
      ruim('fato.medido', { chave, fonte: VALORES[chave].fonte, valor: sem }, new RegExp(`\`${k}\``));
    }
    // Sombra P1 T1 (2): `chave` válida com o `valor` de outra chave.
    for (const outra of Object.keys(VALORES)) {
      if (outra === chave) continue;
      ruim('fato.medido', { chave, fonte: VALORES[chave].fonte, valor: VALORES[outra].valor });
    }
  }
  ruim('fato.medido', { fonte: 'git', valor: { nome: 'x' } }, /`chave` ausente/);
  ruim('fato.medido', { chave: 'branch', valor: { nome: 'x' } }, /`fonte` ausente/);
  ruim('fato.medido', { chave: 'branch', fonte: 'git' }, /`valor` ausente/);
  ruim('fato.medido', { chave: 'commit', fonte: 'git', valor: { nome: 'x' } }, /`chave`/);
  ruim('fato.medido', fato('branch', {}, { fonte: 'web' }), /`fonte`/);
  for (const f of ['git', 'gh', 'arquivo', 'mod']) ok('fato.medido', fato('branch', {}, { fonte: f }));
  for (const v of [null, [], 'x', 7]) ruim('fato.medido', { chave: 'branch', fonte: 'git', valor: v }, /`valor`/);
});

test('forma-fato-valores: inteiros, sha, caminho relativo e textos de cada chave', () => {
  for (const n of [0, -1, 1.5, '14', NaN]) ruim('fato.medido', fato('pr', { numero: n }), /`numero`/);
  ok('fato.medido', fato('pr', { numero: 1 }));
  for (const s of ['abc', 'A'.repeat(64), `${H}0`]) ruim('fato.medido', fato('spec', { sha256: s }), /`sha256`/);
  for (const n of [-1, 1.5, '3']) ruim('fato.medido', fato('spec', { secoes: n }), /`secoes`/);
  ok('fato.medido', fato('spec', { secoes: 0 }));
  for (const n of [-1, 1.5, '3']) ruim('fato.medido', fato('plano', { tasks: n }), /`tasks`/);
  ok('fato.medido', fato('plano', { tasks: 0 }));
  for (const c of ['/abs/x.md', '../x.md', 'a/../x.md', 'a//x.md', 'a\\x.md', '', 'a\nb.md']) ruim('fato.medido', fato('spec', { caminho: c }), /`caminho`/);
  ok('fato.medido', fato('spec', { caminho: 'docs/specs/decisões antigas.md' }));
  for (const [chave, k] of [['branch', 'nome'], ['pr', 'branch'], ['release', 'tag'], ['agente', 'id'], ['agente', 'papel'], ['agente', 'estado']]) {
    for (const v of ['', '   ', 7, null, 'a\nb']) ruim('fato.medido', fato(chave, { [k]: v }), new RegExp(`\`${k}\``));
  }
});

test('forma-fato-pr-estado-fora: estado só aberto, mergeado ou fechado', () => {
  for (const e of ['aberto', 'mergeado', 'fechado']) ok('fato.medido', fato('pr', { estado: e }));
  for (const e of ['merged', 'open', 'Aberto', '', null]) ruim('fato.medido', fato('pr', { estado: e }), /`estado`/);
});

test('forma-nota-texto-161: texto de 1 a 160 caracteres (por caractere, não byte), uma linha', () => {
  for (const t of ['x', 'a'.repeat(160), 'ç'.repeat(160), '😀'.repeat(160)]) ok('nota', { tipo: 'ideia', texto: t });
  for (const t of ['a'.repeat(161), '😀'.repeat(161), '', '   ', 'a\nb', 'a\tb', 7, null]) ruim('nota', { tipo: 'ideia', texto: t }, /`texto`/);
  ruim('nota', { tipo: 'ideia' }, /`texto` ausente/);
  ruim('nota', { texto: 'x' }, /`tipo` ausente/);
  for (const t of ['ideia', 'desvio', 'assunto', 'pendencia']) ok('nota', { tipo: t, texto: 'x' });
  ok('nota', { tipo: 'duvida', texto: 'x', opcoes: ['a', 'b'] });
  for (const t of ['nota', 'Ideia', '', 'decisao']) ruim('nota', { tipo: t, texto: 'x' }, /`tipo`/);
  ruim('nota', { tipo: 'ideia', texto: 'x', entrega: 'GM-14' }, /`entrega`/);
});

test('forma-nota-duvida-1-opcao-recusa: dúvida exige 2 a 4 opções de 1 a 60, sem repetição', () => {
  ruim('nota', { tipo: 'duvida', texto: 'x' }, /`opcoes` ausente/);
  for (const o of [[], ['a'], ['a', 'b', 'c', 'd', 'e'], 'a,b', null]) ruim('nota', { tipo: 'duvida', texto: 'x', opcoes: o }, /`opcoes`/);
  for (const o of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['a'.repeat(60), 'b']]) ok('nota', { tipo: 'duvida', texto: 'x', opcoes: o });
  // Repetição: igual, ou igual a menos de caixa e espaço nas pontas (dois botões "Sim" e "sim" não se distinguem).
  for (const o of [['a', 'a'], ['Sim', 'sim'], ['sim', ' sim ']]) ruim('nota', { tipo: 'duvida', texto: 'x', opcoes: o }, /`opcoes`/);
  for (const item of ['a'.repeat(61), '', '  ', 7, 'a\nb']) ruim('nota', { tipo: 'duvida', texto: 'x', opcoes: ['ok', item] }, /`opcoes`/);
});

test('forma-nota-opcoes-fora-de-duvida-recusa: só dúvida leva opções; pendência sem opções', () => {
  for (const t of ['ideia', 'desvio', 'assunto', 'pendencia']) ruim('nota', { tipo: t, texto: 'x', opcoes: ['a', 'b'] }, /`opcoes`/);
  ok('nota', { tipo: 'pendencia', texto: 'renovar o domínio' });
});

const resp = (extra: Record<string, unknown> = {}) => ({ pergunta: 'sess-1:4', opcao: 2, rotulo: 'GM-14', ...extra });
const respHash = (extra: Record<string, unknown> = {}) => ({ pergunta: 'sess-1:4', sha256: H, chars: 12, ...extra });

test('forma-resposta-duas-formas-recusa: exatamente uma das formas; opção 1..4; rótulo 1..60', () => {
  ok('dono.resposta', resp());
  ok('dono.resposta', respHash());
  // Sombra P1 T1 (1): formas misturadas.
  ruim('dono.resposta', resp({ sha256: H, chars: 3 }));
  ruim('dono.resposta', resp({ sha256: H }));
  ruim('dono.resposta', respHash({ rotulo: 'x' }));
  ruim('dono.resposta', respHash({ opcao: 1 }));
  ruim('dono.resposta', { pergunta: 'sess-1:4', opcao: 1, sha256: H });
  ruim('dono.resposta', { pergunta: 'sess-1:4', rotulo: 'x', chars: 1 });
  ruim('dono.resposta', { pergunta: 'sess-1:4' });
  ruim('dono.resposta', { opcao: 1, rotulo: 'x' }, /`pergunta` ausente/);
  ruim('dono.resposta', { pergunta: 'sess-1:4', opcao: 1 }, /`rotulo` ausente/);
  ruim('dono.resposta', { pergunta: 'sess-1:4', rotulo: 'x' }, /`opcao` ausente/);
  ruim('dono.resposta', { pergunta: 'sess-1:4', sha256: H }, /`chars` ausente/);
  ruim('dono.resposta', { pergunta: 'sess-1:4', chars: 1 }, /`sha256` ausente/);
  for (const n of [1, 2, 3, 4]) ok('dono.resposta', resp({ opcao: n }));
  for (const n of [0, 5, -1, 1.5, '1', null]) ruim('dono.resposta', resp({ opcao: n }), /`opcao`/);
  for (const r of ['a', 'a'.repeat(60), 'não, obrigado']) ok('dono.resposta', resp({ rotulo: r }));
  for (const r of ['', '  ', 'a'.repeat(61), 'a\nb', 7]) ruim('dono.resposta', resp({ rotulo: r }), /`rotulo`/);
  for (const s of ['abc', 'A'.repeat(64)]) ruim('dono.resposta', respHash({ sha256: s }), /`sha256`/);
  for (const c of [-1, 1.5, '3']) ruim('dono.resposta', respHash({ chars: c }), /`chars`/);
  ok('dono.resposta', respHash({ chars: 0 }));
});

test('forma-resposta-com-texto-recusa: chave `texto` (ou qualquer outra) nunca entra, nas duas formas', () => {
  ruim('dono.resposta', resp({ texto: 'o dono disse isto' }), /`texto`/);
  ruim('dono.resposta', respHash({ texto: 'o dono disse isto' }), /`texto`/);
  ruim('dono.resposta', resp({ args: '3:4 2' }), /`args`/);
});

test('forma-resposta-herdar-ok: IdPergunta é <sessao>:<seq> ou herdar:<id estável em hex> (DP-6)', () => {
  const herdar = 'herdar:' + '0123456789abcdef';
  for (const p of [herdar, `herdar:${H}`, 'herdar:0a1b2c3d', 'sess-1:1', 'a:999', `${'s'.repeat(128)}:3`, '1081797f-d12e-4ff9-af39-438ea50fa8f3:12']) {
    ok('dono.resposta', resp({ pergunta: p }));
    assert.equal(ID_PERGUNTA_RE.test(p), true, p);
  }
  // `herdar:<n>` (índice de lista) não é id estável; hex fora de 8..64, maiúscula, e as formas quebradas de sessão.
  for (const p of ['herdar:5', 'herdar:12', 'herdar:0a1b2c3', `herdar:${H}0`, 'herdar:0A1B2C3D', 'herdar:', 'herdar:xyz12345',
    ':7', 'abc:0', 'abc:07', 'abc', 'a b:1', 'abc:1\n', 'a.b:1', 'a_b:1', `${'s'.repeat(129)}:3`, 'abc:-1', 'abc:1:2', '', 7]) {
    ruim('dono.resposta', resp({ pergunta: p }), /`pergunta`/);
    if (typeof p === 'string') assert.equal(ID_PERGUNTA_RE.test(p), false, JSON.stringify(p));
  }
});

const aprConf = (evidencia: Record<string, unknown>, status = 'M') => ({ tipo: 'A', status, gatilho: null, evidencia, regra: 'r', entra_em: ['instantaneo'] });
const conf = (extra: Record<string, unknown> = {}) => ({ fonte: 'docs/ledgers/GM-7.md:12', resposta: { sessao: 'dono', seq: 3 }, ...extra });

test('forma-confirmacao-fonte-absoluta: fonte relativa <arquivo>:<linha ≥ 1>, resposta {sessao, seq}', () => {
  ok('aprendizado', aprConf({ confirmacao: conf() }));
  ok('aprendizado', aprConf({ confirmacao: conf({ fonte: 'docs/decisões antigas.md:4' }) }));
  ok('aprendizado', aprConf({ confirmacao: conf({ fonte: 'AGENTS.md:1' }) }));
  for (const f of ['/abs/x.md:3', '../x.md:3', 'a/../x.md:3', 'a//x.md:3', 'x.md', 'x.md:0', 'x.md:-1', 'x.md:abc', 'x.md:01', ':3', 'C:\\x.md:3', 'a\\b.md:3', '', 'a\nb.md:3', 7]) {
    ruim('aprendizado', aprConf({ confirmacao: conf({ fonte: f }) }), /confirmacao/);
  }
  for (const r of [undefined, null, { sessao: 'dono', seq: 0 }, { sessao: '', seq: 1 }, { sessao: 'a b', seq: 1 }, 'dono:3']) {
    ruim('aprendizado', aprConf({ confirmacao: conf({ resposta: r }) }), /confirmacao/);
  }
  ruim('aprendizado', aprConf({ confirmacao: conf({ extra: 1 }) }), /confirmacao/);
  for (const c of [null, [], 'x', {}]) ruim('aprendizado', aprConf({ confirmacao: c }), /confirmacao/);
});

test('forma-confirmacao-conta-como-evidencia-de-d: D herdado só com confirmacao passa na forma; D sem nada segue recusado', () => {
  ok('aprendizado', aprConf({ confirmacao: conf() }, 'D'));
  ruim('aprendizado', aprConf({}, 'D'), /grave como M/);
  ruim('aprendizado', aprConf({ confirmacao: conf({ fonte: '/x:1' }) }, 'D'), /confirmacao/);
});

test('forma-gm14-ausente-x-corrompido: dados ausente, corrompido e {} distintos nos 3 tipos novos; getter hostil não lança', () => {
  const primeiros: Record<string, string> = { 'fato.medido': 'chave', nota: 'tipo', 'dono.resposta': 'pergunta' };
  for (const [tipo, k] of Object.entries(primeiros)) {
    assert.match(formaInvalida(tipo, undefined) as string, /dados ausente/, tipo);
    for (const d of [null, [], 'x', 7, true]) assert.match(formaInvalida(tipo, d) as string, /dados corrompido/, `${tipo} ${JSON.stringify(d)}`);
    assert.match(formaInvalida(tipo, {}) as string, new RegExp(`\`${k}\` ausente`), tipo);
    const hostil = Object.defineProperty({}, k, { enumerable: true, get(): never { throw new Error('boom'); } });
    assert.doesNotThrow(() => formaInvalida(tipo, hostil), tipo);
    assert.match(formaInvalida(tipo, hostil) as string, /corrompido/, tipo);
    assert.notEqual(formaInvalida(tipo, Object.create({ [k]: 'x' })), null, `${tipo}: prototype não conta`);
  }
});

/** Literais da união `export type <nome> = | 'a' | 'b' ...;` lidos do fonte de `tipos.ts` (strip-types não confere `satisfies`). */
function uniaoDoFonte(nome: string): string[] {
  const fonte = readFileSync(new URL('../src/tipos.ts', import.meta.url), 'utf8');
  const m = new RegExp(`export type ${nome} =([^;]*);`).exec(fonte);
  assert.ok(m, `tipo ${nome} não achado em tipos.ts`);
  return [...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// GM-14 T53 (emenda 53): `sessao.pouso.tentativa` é tipo próprio, forma exata {n: 2|3}.
test('t53-pouso-tentativa-forma-fechada', () => {
  ok('sessao.pouso.tentativa', { n: 2 });
  ok('sessao.pouso.tentativa', { n: 3 });
  for (const n of [1, 4, 0, 2.5, '2', null]) ruim('sessao.pouso.tentativa', { n }, /n/);
  ruim('sessao.pouso.tentativa', {}, /n/);
  ruim('sessao.pouso.tentativa', { n: 2, extra: 1 }, /extra/);
  assert.ok(TIPOS_EVENTO.includes('sessao.pouso.tentativa' as never));
});

test('tipos-evento-cobre-a-uniao: TIPOS_EVENTO e MOTIVOS_PARAR são exatamente as uniões de tipos.ts, sem repetição', () => {
  const tipos = uniaoDoFonte('TipoEvento');
  assert.equal(new Set(TIPOS_EVENTO).size, TIPOS_EVENTO.length);
  assert.deepEqual([...TIPOS_EVENTO].sort(), [...tipos].sort());
  for (const novo of ['fato.medido', 'nota', 'dono.resposta']) assert.ok(TIPOS_EVENTO.includes(novo as never), novo);
  const motivos = uniaoDoFonte('MotivoParar');
  assert.equal(new Set(MOTIVOS_PARAR).size, MOTIVOS_PARAR.length);
  assert.deepEqual([...MOTIVOS_PARAR].sort(), [...motivos].sort());
  assert.equal(Object.isFrozen(TIPOS_EVENTO) && Object.isFrozen(MOTIVOS_PARAR), true);
});

// GM-14 T36 (FIEL-15, furo 3 e 10): `libera` opcional e booleano na decisão; `task.reaberta` da Sombra carrega o hash da decisão.
test('t36-decisao-libera-opcional-e-booleano', () => {
  ok('decisao.sombra', decisao({ libera: true }));
  ok('decisao.sombra', decisao({ libera: false }));
  ok('decisao.sombra', decisao()); // ausente: a forma de antes segue valendo
  for (const v of ['true', 1, null, {}, []]) ruim('decisao.sombra', decisao({ libera: v }), /libera/);
});
test('t36-reaberta-da-sombra-exige-hash-e-so-ela-o-tem', () => {
  ok('task.reaberta', { task: 'T1', origem: 'sombra', hash: H });
  ok('task.reaberta', { task: 'T1', origem: 'dono' });
  ok('task.reaberta', { task: 'T1', origem: 'retomada' });
  ruim('task.reaberta', { task: 'T1', origem: 'sombra' }, /hash/);
  for (const h of ['A'.repeat(64), 'a'.repeat(63), 7, '']) ruim('task.reaberta', { task: 'T1', origem: 'sombra', hash: h }, /hash/);
  ruim('task.reaberta', { task: 'T1', origem: 'dono', hash: H }, /hash/);
  ruim('task.reaberta', { task: 'T1', origem: 'retomada', hash: H }, /hash/);
  // a gravação recusa igual (o append confere a forma)
  assert.match(String(formaInvalida('task.reaberta', { task: 'T1', origem: 'sombra' })), /hash/);
});

test('t36-reaberta-abordagem-nova-forma (r1 MINOR-3): só na liberação da Sombra; texto de 1 linha, 1 a 500 caracteres', () => {
  ok('task.reaberta', { task: 'T1', origem: 'sombra', hash: H, abordagem_nova: 'dividir a T1 em duas' });
  ok('task.reaberta', { task: 'T1', origem: 'sombra', hash: H, abordagem_nova: 'x'.repeat(500) });
  for (const a of ['', '   ', 'x'.repeat(501), 'duas\nlinhas', 'cr\rlinha', 7, null, {}, ['a'], 'tab\taqui']) ruim('task.reaberta', { task: 'T1', origem: 'sombra', hash: H, abordagem_nova: a }, /abordagem_nova/);
  ruim('task.reaberta', { task: 'T1', origem: 'dono', abordagem_nova: 'a' }, /abordagem_nova/);
  ruim('task.reaberta', { task: 'T1', origem: 'retomada', abordagem_nova: 'a' }, /abordagem_nova/);
  assert.match(String(formaInvalida('task.reaberta', { task: 'T1', origem: 'sombra', hash: H, abordagem_nova: 'x'.repeat(501) })), /abordagem_nova/, 'o append confere a forma');
});

// ── GM-15 T1: contratos dos 4 eventos novos (R2, condição 6; HIG-1 D) ─────────────────────────────────────────────────────────
// Mutações prescritas: M1a tirar um dos 4 de TIPOS_EVENTO · M1b task.fora sombra sem `fonte` aceita · M1c task.reaberta origem `xyz` aceita
// · M1d entrega.reaberta com origem (automático) · M1e guarda.autonomia_usada aceitando `comando`.
const NOVOS = ['task.fora', 'entrega.encerrada', 'entrega.reaberta', 'guarda.autonomia_usada'];
const TS = '2026-11-15T10:00:00.000Z';
const FORA = { task: 'T5', como: 'adiada', motivo: 'depende do dono', origem: 'dono' };
const ENC = { entrega: 'GM-14', pr: 22, via: 'head', mergeado_em: TS };
const REAB = { entrega: 'GM-14', em: TS };
const AUT = { anel: 'integridade', alvo: 'packed-refs', acao: 'escrita', ambiente: 'teste' };

test('formas-quatro-eventos: cada forma válida passa; cada campo lido, trocado, ausente ou extra é recusado', () => {
  for (const t of NOVOS) assert.ok(TIPOS_EVENTO.includes(t as never), `${t} em TIPOS_EVENTO`);
  const casos: [string, Record<string, unknown>][] = [['task.fora', FORA], ['entrega.encerrada', ENC], ['entrega.reaberta', REAB], ['guarda.autonomia_usada', AUT]];
  for (const [tipo, base] of casos) {
    ok(tipo, base);
    ruim(tipo, { ...base, extra: 1 }, /`extra`/);
    for (const k of Object.keys(base)) {
      const { [k]: _fora, ...sem } = base;
      ruim(tipo, sem, new RegExp(`\`${k}\``));
    }
    ruim(tipo, undefined, /ausente/);
    ruim(tipo, 'x', /corrompido/);
    ruim(tipo, null, /corrompido/);
  }
  // task.fora: cada campo trocado
  for (const c of ['feita', '', null, 7]) ruim('task.fora', { ...FORA, como: c }, /`como`/);
  ok('task.fora', { ...FORA, como: 'cortada' });
  for (const o of ['retomada', 'xyz', '', null]) ruim('task.fora', { ...FORA, origem: o }, /`origem`/);
  for (const m of ['', 'a\nb', 'x'.repeat(161), null]) ruim('task.fora', { ...FORA, motivo: m }, /`motivo`/);
  ok('task.fora', { ...FORA, motivo: 'x'.repeat(160) });
  ok('task.fora', { ...FORA, fonte: 'decisao:abc' });
  ruim('task.fora', { ...FORA, fonte: '' }, /`fonte`/);
  // entrega.encerrada: cada campo trocado
  for (const e of ['gm-14', 'GM14', '../x', 7]) ruim('entrega.encerrada', { ...ENC, entrega: e }, /`entrega`/);
  for (const n of [0, -1, 1.5, '22', NaN]) ruim('entrega.encerrada', { ...ENC, pr: n }, /`pr`/);
  for (const v of ['main', '', null]) ruim('entrega.encerrada', { ...ENC, via: v }, /`via`/);
  ok('entrega.encerrada', { ...ENC, via: 'titulo' });
  for (const m of ['ontem', '2026-11-15', '2026-02-30T10:00:00Z', 7]) ruim('entrega.encerrada', { ...ENC, mergeado_em: m }, /`mergeado_em`/);
  ok('entrega.encerrada', { ...ENC, versao: '2.1.0' });
  ok('entrega.encerrada', { ...ENC, versao: '2.1.0-alpha.1' });
  for (const v of ['2.1', 'v2.1.0', '', 7]) ruim('entrega.encerrada', { ...ENC, versao: v }, /`versao`/);
  // entrega.reaberta: `em` e `entrega` lidos
  for (const e of ['gm-14', 7]) ruim('entrega.reaberta', { ...REAB, entrega: e }, /`entrega`/);
  for (const m of ['ontem', 7, '2026-13-01T00:00:00Z']) ruim('entrega.reaberta', { ...REAB, em: m }, /`em`/);
  // guarda.autonomia_usada: cada campo é texto de 1 linha
  for (const k of Object.keys(AUT)) for (const v of ['', 'a\nb', 7, null]) ruim('guarda.autonomia_usada', { ...AUT, [k]: v }, new RegExp(`\`${k}\``));
});

test('task-fora-sombra-sem-fonte-recusa: a origem sombra cita a decisão; a do dono não precisa', () => {
  ruim('task.fora', { ...FORA, origem: 'sombra' }, /`fonte`/);
  ok('task.fora', { ...FORA, origem: 'sombra', fonte: 'decisao:abc' });
  ok('task.fora', FORA);
  assert.match(String(formaInvalida('task.fora', { ...FORA, origem: 'sombra' })), /sombra/);
});

test('guarda-autonomia-usada-nunca-o-comando: `comando` (e variações) é recusado, nunca gravado', () => {
  for (const k of ['comando', 'cmd', 'command', 'linha']) ruim('guarda.autonomia_usada', { ...AUT, [k]: 'git push' }, new RegExp(`\`${k}\``));
  assert.match(String(formaInvalida('guarda.autonomia_usada', { ...AUT, comando: 'x' })), /nunca o comando/);
});

test('fato-pr-base-via-opcionais: sem base/via segue válido (legado); com eles, valores lidos', () => {
  ok('fato.medido', fato('pr'));
  ok('fato.medido', fato('pr', { base: 'main', via: 'head' }));
  ok('fato.medido', fato('pr', { base: 'next', via: 'titulo' }));
  ok('fato.medido', fato('pr', { base: 'main' }));
  ok('fato.medido', fato('pr', { via: 'head' }));
  for (const b of ['', 'a\nb', 7, null]) ruim('fato.medido', fato('pr', { base: b }), /`base`/);
  for (const v of ['main', '', 7, null]) ruim('fato.medido', fato('pr', { via: v }), /`via`/);
  ruim('fato.medido', fato('pr', { extra: 1 }), /`extra`/);
  // base/via só valem em `pr`: outra chave com eles continua recusada
  ruim('fato.medido', fato('branch', { base: 'main' }), /`base`/);
});

test('reaberta-origem-invalida-recusada-no-append: HIG-1 D, recusa antes de gravar, não só na projeção', async () => {
  for (const o of ['xyz', '', 'Dono', 'orquestrador', null, 7]) ruim('task.reaberta', { task: 'T1', origem: o }, /`origem`/);
  ruim('task.reaberta', { task: 'T1' }, /`origem`/);
  ruim('task.reaberta', undefined, /ausente/);
  ruim('task.reaberta', 'x', /corrompido/);
  // pelo `append` real: nada vai para o arquivo
  const { mkdtempSync, existsSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { append } = await import('../src/diario.ts');
  const raiz = mkdtempSync(join(tmpdir(), 'gm15-t1-'));
  const r = append(raiz, 'sessao-t1', { tipo: 'task.reaberta', dados: { task: 'T1', origem: 'xyz' }, autor: 'orquestrador', agente: 'principal' } as never);
  assert.equal(r.ok, false);
  assert.match(String((r as { erro: string }).erro), /forma_invalida.*origem/);
  assert.equal(existsSync(join(raiz, '.harness')) ? readdirSync(join(raiz, '.harness')).length : 0, 0, 'nada gravado');
});

test('reaberta-volta-de-fora-exige-fonte: {de: fora} leva fonte, origem dono ou sombra, nunca hash', () => {
  const v = { task: 'T5', origem: 'dono', fonte: 'dono:comando', de: 'fora' };
  ok('task.reaberta', v);
  ok('task.reaberta', { ...v, origem: 'sombra' });
  ruim('task.reaberta', { task: 'T5', origem: 'dono', de: 'fora' }, /`fonte`/);
  ruim('task.reaberta', { ...v, fonte: '' }, /`fonte`/);
  ruim('task.reaberta', { ...v, origem: 'retomada' }, /`origem`/);
  ruim('task.reaberta', { ...v, de: 'teto' }, /`de`/);
  ruim('task.reaberta', { ...v, hash: H }, /`hash`/);
  ruim('task.reaberta', { ...v, task: '' }, /`task`/);
});

test('t11-forma-proposta-origem-so-sombra', () => {
  ok('emenda.proposta', proposta({ origem: 'sombra' }));
  ruim('emenda.proposta', proposta({ origem: 'dono' }), /origem/);
  ruim('emenda.proposta', proposta({ origem: '' }), /origem/);
  ruim('emenda.proposta', proposta({ origem: 3 }), /origem/);
});

// ── GM-18 T1 (REQ-ENC-1 i, ii) ────────────────────────────────────────────────────────────────────────────────────────────────

test('encerrada-dono-forma', () => {
  const base = { entrega: 'GM-13', pr: 16, via: 'dono', mergeado_em: '2026-11-01T00:00:00.000Z' };
  ok('entrega.encerrada', base);
  ok('entrega.encerrada', { ...base, versao: '2.0.0' });
  const { pr: _pr, ...semPr } = base;
  ruim('entrega.encerrada', semPr, /`pr`/);
  ruim('entrega.encerrada', { ...base, pr: 0 }, /`pr`/);
  ruim('entrega.encerrada', { ...base, versao: 'v2.0.0' }, /`versao`/);
});

test('fato-pr-via-dono-recusado', () => {
  const pr = (via: string) => ({ chave: 'pr', fonte: 'gh', valor: { numero: 16, estado: 'mergeado', branch: 'feat/GM-13-x', via } });
  ok('fato.medido', pr('head'));
  ok('fato.medido', pr('titulo'));
  ruim('fato.medido', pr('dono'), /via/);
});

test('vias-encerramento-deriva-de-vias-pr', () => {
  assert.deepEqual([...VIAS_ENCERRAMENTO], [...VIAS_PR, 'dono']);
  assert.equal(VIAS_PR.includes('dono'), false);
  const fonte = readFileSync(new URL('../src/formas.ts', import.meta.url), 'utf8');
  assert.ok(fonte.includes("[...VIAS_PR, 'dono']"), 'VIAS_ENCERRAMENTO deriva de VIAS_PR');
  assert.equal(fonte.split("'head', 'titulo'").length - 1, 1, "o literal 'head', 'titulo' só aparece na definição de VIAS_PR");
});

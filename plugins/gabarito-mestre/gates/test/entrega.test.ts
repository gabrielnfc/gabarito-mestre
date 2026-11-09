/**
 * Testes da decisão de entrega pura (GM-11 T4, REQ-ENT-1/ENT-2). Fonte: sombra-p1a.md, seção da T4.
 * Nenhum teste lê o relógio: `agoraMs` é sempre literal. Mutações prescritas (task-4-mut.json):
 *  M4a linha `fim` antes de `inicio sem fim` ⇒ inicio-novo-sem-fim-vence-fim-antigo
 *  M4b `entregue` ignora `L` ⇒ entregue-com-integracao-nova-reabre
 *  M4c rollback falho com escopo de `L` ⇒ rollback-falho-fixo
 *  M4d homolog sem o filtro "depois de L" ⇒ homolog-verde-antigo-nao-sobe, homolog-vermelho-antes-da-integracao-nao-conta
 *  M4e `janela` sem exigir homolog ⇒ janela-dentro-sem-homolog-espera
 *  M4f vermelhos de qualquer alvo ⇒ homolog-sequencia-ignora-ci-sem-alvo
 *  M4g `fim` inclusivo ⇒ janela-fim-exclusivo
 *  M4h dia do cruzamento = dia atual ⇒ janela-cruza-meia-noite-dia-do-inicio
 *  M4i varrer de `agoraMs` sem alinhar ⇒ quando-alinhado-ao-minuto
 *  M4j fuso ignorado ⇒ janela-dst-new-york
 *  M4k rank `<=` em vez de `<` ⇒ politica-efetiva-matriz
 *  M4l config janela inválida ⇒ `janela_ausente` ⇒ config-janela-invalida-degrada-sob-demanda
 *  M4m `entrega.agendada` vencida vira `subir` ⇒ agendada-nao-entra-na-decisao
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lerConfigEntrega, politicaEfetiva, dentroDaJanela, proximaAbertura, decidirEntrega,
  type ConfigEntrega, type DecisaoEntrega,
} from '../src/entrega.ts';
import type { Evento, Janela, PoliticaEntrega } from '../src/tipos.ts';

const CMD = { argv: ['./x'], timeout_s: 600 };
const TODOS = { deploy: CMD, smoke: CMD, rollback: CMD };
const ISO = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse('2026-11-09T10:00:00Z');
const AGORA = Date.parse('2026-11-09T12:00:00Z');

/** Diário numa sessão só: seq e ts crescentes, para a ordem ser inequívoca. */
function diario(...itens: [string, Record<string, unknown>?][]): Evento[] {
  return itens.map(([tipo, dados], i) => ({
    seq: i + 1, ts: ISO(T0 + i * 1000), autor: 'x', sessao: 's', agente: 'a', tipo: tipo as Evento['tipo'],
    dados: dados ?? {}, hash_anterior: null,
  }));
}
const INT: [string, Record<string, unknown>?] = ['task.integrada', { task: 't' }];
const HV: [string, Record<string, unknown>?] = ['ci.resultado', { verde: true, alvo: 'homolog' }];
const HR: [string, Record<string, unknown>?] = ['ci.resultado', { verde: false, alvo: 'homolog' }];
const INI = (p: PoliticaEntrega = 'continua'): [string, Record<string, unknown>?] => ['entrega.inicio', { politica: p }];
const FIM = (ok: boolean, motivo?: string): [string, Record<string, unknown>?] => ['entrega.fim', motivo ? { ok, motivo } : { ok }];

const UTC_JANELA: Janela = { dias: [1], inicio: '22:00', fim: '23:00', fuso: 'UTC' };
type Ent = Parameters<typeof decidirEntrega>[0];
const dec = (eventos: Evento[], extra: Partial<Ent> = {}): DecisaoEntrega =>
  decidirEntrega({
    politica: 'continua', janela: null, exigeProd: false, base: 'main', comandos: TODOS, eventos, agoraMs: AGORA, ...extra,
  });

// ---------------------------------------------------------------- diário e ciclo

test('diario-fora-de-ordem-para', () => {
  const ev = diario(INT, HV);
  ev[1].seq = 1; // seq repetido na sessão: ordenar falha
  assert.deepEqual(dec(ev), { tipo: 'parar', motivo: 'diario_invalido' });
});

test('sem-integracao-para', () => {
  assert.deepEqual(dec(diario(['task.iniciada', { task: 't' }])), { tipo: 'parar', motivo: 'nao_conseguiu' });
  assert.deepEqual(dec([]), { tipo: 'parar', motivo: 'nao_conseguiu' });
});

test('inicio-novo-sem-fim-vence-fim-antigo', () => {
  const ev = diario(INT, HV, INI(), FIM(true), INT, HV, INI());
  assert.deepEqual(dec(ev), { tipo: 'parar', motivo: 'nao_conseguiu' });
});

test('inicio-sem-fim-para', () => {
  assert.deepEqual(dec(diario(INT, HV, INI())), { tipo: 'parar', motivo: 'nao_conseguiu' });
});

test('entregue-nao-repete: sem integração nova a entrega fechada fica entregue', () => {
  assert.deepEqual(dec(diario(INT, HV, INI(), FIM(true))), { tipo: 'entregue' });
});

test('entregue-com-integracao-nova-reabre', () => {
  const ev = diario(INT, HV, INI(), FIM(true), INT, HV);
  assert.deepEqual(dec(ev), { tipo: 'subir' });
});

test('smoke-antigo-com-integracao-nova-reabre', () => {
  assert.deepEqual(dec(diario(INT, HV, INI(), FIM(false, 'smoke'))), { tipo: 'parar', motivo: 'smoke' });
  assert.deepEqual(dec(diario(INT, HV, INI(), FIM(false, 'smoke'), INT, HV)), { tipo: 'subir' });
});

test('rollback-falho-fixo', () => {
  const ev = diario(INT, HV, INI(), FIM(false, 'rollback'), INT, HV);
  assert.deepEqual(dec(ev), { tipo: 'parar', motivo: 'rollback' });
});

test('inicio-sem-fim-com-rollback-falho-para-rollback', () => {
  const ev = diario(INT, HV, INI(), ['entrega.rollback', { ok: false }]);
  assert.deepEqual(dec(ev), { tipo: 'parar', motivo: 'rollback' });
  // rollback ok sem fim: prod ainda desconhecida, mas não é o rollback que falhou
  assert.deepEqual(dec(diario(INT, HV, INI(), ['entrega.rollback', { ok: true }])), { tipo: 'parar', motivo: 'nao_conseguiu' });
  // rollback falho de um ciclo anterior não conta para o inicio novo
  const antigo = diario(INT, INI(), ['entrega.rollback', { ok: false }], FIM(true), INT, HV, INI());
  assert.deepEqual(dec(antigo), { tipo: 'parar', motivo: 'nao_conseguiu' });
});

test('fim-forma-invalida-nao-fecha-inicio', () => {
  assert.deepEqual(dec(diario(INT, HV, INI(), ['entrega.fim', { ok: 'true' }])), { tipo: 'parar', motivo: 'nao_conseguiu' });
  assert.deepEqual(dec(diario(INT, HV, INI(), ['entrega.fim', {}])), { tipo: 'parar', motivo: 'nao_conseguiu' });
});

test('fim-deploy-para-nao-conseguiu', () => {
  assert.deepEqual(dec(diario(INT, HV, INI(), FIM(false, 'deploy'))), { tipo: 'parar', motivo: 'nao_conseguiu' });
  assert.deepEqual(dec(diario(INT, HV, INI(), FIM(false))), { tipo: 'parar', motivo: 'nao_conseguiu' });
});

test('exige-prod-sem-comandos-para', () => {
  assert.deepEqual(dec(diario(INT, HV), { exigeProd: true, comandos: {} }), { tipo: 'parar', motivo: 'janela_ausente' });
  assert.deepEqual(dec(diario(INT, HV), { exigeProd: true, politica: 'sob_demanda' }), { tipo: 'parar', motivo: 'janela_ausente' });
});

// ---------------------------------------------------------------- tabela: sob_demanda e comandos

test('sob-demanda-release-pr', () => {
  assert.deepEqual(dec(diario(INT), { politica: 'sob_demanda', base: 'dev', comandos: {} }), { tipo: 'release_pr', base: 'dev' });
});

test('continua-sem-comandos-release-pr-com-aviso', () => {
  const r = dec(diario(INT, HV), { comandos: {} });
  assert.equal(r.tipo, 'release_pr');
  if (r.tipo === 'release_pr') {
    assert.equal(r.base, 'main');
    assert.match(r.aviso ?? '', /deploy/);
  }
});

test('comandos-parciais-citam-ausentes', () => {
  const r = dec(diario(INT, HV), { comandos: { deploy: CMD } });
  assert.equal(r.tipo, 'release_pr');
  if (r.tipo === 'release_pr') {
    assert.match(r.aviso ?? '', /smoke/);
    assert.match(r.aviso ?? '', /rollback/);
    assert.doesNotMatch(r.aviso ?? '', /deploy/);
  }
});

// ---------------------------------------------------------------- homolog

test('homolog-verde-antigo-nao-sobe', () => {
  assert.deepEqual(dec(diario(HV, INT)), { tipo: 'esperar', motivo: 'homolog' });
});

test('homolog-ausente-espera-sem-aviso', () => {
  const r = dec(diario(INT));
  assert.deepEqual(r, { tipo: 'esperar', motivo: 'homolog' });
  assert.equal('aviso' in r, false);
});

test('homolog-verde-sobe-na-continua', () => {
  assert.deepEqual(dec(diario(INT, HV)), { tipo: 'subir' });
});

test('homolog-vermelho-espera-com-aviso', () => {
  const r = dec(diario(INT, HR));
  assert.equal(r.tipo, 'esperar');
  if (r.tipo === 'esperar') {
    assert.equal(r.motivo, 'homolog');
    assert.ok((r.aviso ?? '').length > 0);
  }
});

test('homolog-dois-vermelhos-para', () => {
  assert.deepEqual(dec(diario(INT, HR, HR)), { tipo: 'parar', motivo: 'ci_vermelho' });
});

test('homolog-vermelho-antes-da-integracao-nao-conta', () => {
  const r = dec(diario(HR, INT, HR));
  assert.equal(r.tipo, 'esperar');
  assert.notDeepEqual(r, { tipo: 'parar', motivo: 'ci_vermelho' });
});

test('homolog-vermelho-verde-vermelho-espera', () => {
  const r = dec(diario(INT, HR, HV, HR));
  assert.equal(r.tipo, 'esperar');
  if (r.tipo === 'esperar') assert.ok(r.aviso);
});

test('homolog-sequencia-ignora-ci-sem-alvo', () => {
  // um vermelho de PR (sem alvo) entre dois de homolog não quebra a sequência: 2 homologs vermelhos seguidos
  assert.deepEqual(dec(diario(INT, HR, ['ci.resultado', { verde: false }], HR)), { tipo: 'parar', motivo: 'ci_vermelho' });
  // 1 homolog vermelho + 1 de PR vermelho: só um homolog ⇒ esperar, nunca parar
  const r = dec(diario(INT, HR, ['ci.resultado', { verde: false }]));
  assert.equal(r.tipo, 'esperar');
});

test('ci-sem-alvo-nao-e-homolog', () => {
  assert.deepEqual(dec(diario(INT, ['ci.resultado', { verde: true }])), { tipo: 'esperar', motivo: 'homolog' });
});

test('ci-alvo-caixa-errada-nao-conta', () => {
  assert.deepEqual(dec(diario(INT, ['ci.resultado', { verde: true, alvo: 'Homolog' }])), { tipo: 'esperar', motivo: 'homolog' });
  assert.deepEqual(dec(diario(INT, ['ci.resultado', { verde: 'true', alvo: 'homolog' }])), { tipo: 'esperar', motivo: 'homolog' });
});

test('homolog-empate-ts-sessao-menor-nao-conta', () => {
  const ts = '2026-11-09T10:00:00.000Z';
  const base = { ts, autor: 'x', agente: 'a', hash_anterior: null };
  const ev: Evento[] = [
    { ...base, seq: 1, sessao: 'b-int', tipo: 'task.integrada', dados: { task: 't' } },
    { ...base, seq: 1, sessao: 'a-ci', tipo: 'ci.resultado', dados: { verde: true, alvo: 'homolog' } },
  ];
  // 'a-ci' < 'b-int': o verde vem ANTES da integração na ordem ⇒ lado seguro
  assert.deepEqual(dec(ev), { tipo: 'esperar', motivo: 'homolog' });
});

// ---------------------------------------------------------------- janela na decisão

const SEG_21_59_30 = Date.parse('2026-11-09T21:59:30Z');
const SEG_22_30 = Date.parse('2026-11-09T22:30:00Z');

test('janela-dentro-sem-homolog-espera', () => {
  assert.deepEqual(dec(diario(INT), { politica: 'janela', janela: UTC_JANELA, agoraMs: SEG_22_30 }), { tipo: 'esperar', motivo: 'homolog' });
});

test('janela-fora-sem-homolog-espera', () => {
  assert.deepEqual(dec(diario(INT), { politica: 'janela', janela: UTC_JANELA, agoraMs: AGORA }), { tipo: 'esperar', motivo: 'homolog' });
});

test('janela-dentro-com-homolog-sobe', () => {
  assert.deepEqual(dec(diario(INT, HV), { politica: 'janela', janela: UTC_JANELA, agoraMs: SEG_22_30 }), { tipo: 'subir' });
});

test('janela-fora-agenda', () => {
  assert.deepEqual(dec(diario(INT, HV), { politica: 'janela', janela: UTC_JANELA, agoraMs: SEG_21_59_30 }), {
    tipo: 'agendar', quando: '2026-11-09T22:00:00.000Z',
  });
});

test('janela-reavalia-apos-quando-fechada-reagenda', () => {
  // `entrega.agendada` com quando vencido, agora fora da janela (depois do fim): agenda a próxima abertura
  const ev = diario(INT, HV, ['entrega.agendada', { quando: '2026-11-09T22:00:00.000Z' }]);
  const agora = Date.parse('2026-11-09T23:30:00Z');
  assert.deepEqual(dec(ev, { politica: 'janela', janela: UTC_JANELA, agoraMs: agora }), { tipo: 'agendar', quando: '2026-11-16T22:00:00.000Z' });
});

test('agendada-nao-entra-na-decisao', () => {
  const sem = diario(INT, HV);
  const com = diario(INT, HV, ['entrega.agendada', { quando: '2026-11-09T09:00:00.000Z' }]);
  const agora = Date.parse('2026-11-10T12:00:00Z');
  const a = dec(sem, { politica: 'janela', janela: UTC_JANELA, agoraMs: agora });
  const b = dec(com, { politica: 'janela', janela: UTC_JANELA, agoraMs: agora });
  assert.deepEqual(b, a);
  assert.equal(b.tipo, 'agendar');
});

test('janela-null-com-politica-janela-para', () => {
  assert.deepEqual(dec(diario(INT, HV), { politica: 'janela', janela: null }), { tipo: 'parar', motivo: 'janela_ausente' });
});

test('proxima-abertura-sem-dias-null', () => {
  const vazia: Janela = { dias: [], inicio: '22:00', fim: '23:00', fuso: 'UTC' };
  assert.equal(proximaAbertura(vazia, AGORA), null);
  assert.deepEqual(dec(diario(INT, HV), { politica: 'janela', janela: vazia }), { tipo: 'parar', motivo: 'janela_ausente' });
});

// ---------------------------------------------------------------- janela pura

const SEXTA_NOITE: Janela = { dias: [5], inicio: '22:00', fim: '02:00', fuso: 'UTC' };

test('janela-cruza-meia-noite-dia-do-inicio', () => {
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-14T01:00:00Z')), true, 'sáb 01:00 pertence ao início de sex');
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-15T01:00:00Z')), false, 'dom 01:00: o início seria sáb');
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-13T01:00:00Z')), false, 'sex 01:00: o início seria qui');
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-13T22:00:00Z')), true, 'sex 22:00 abre');
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-13T12:00:00Z')), false, 'sex 12:00: entre fim e inicio, fora');
});

test('janela-cruza-meia-noite', () => {
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-14T00:00:00Z')), true);
});

test('janela-fim-exclusivo', () => {
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-14T02:00:00Z')), false);
  assert.equal(dentroDaJanela(SEXTA_NOITE, Date.parse('2026-11-14T01:59:59Z')), true);
  assert.equal(dentroDaJanela(UTC_JANELA, Date.parse('2026-11-09T23:00:00Z')), false);
});

test('janela-inicio-inclusivo', () => {
  assert.equal(dentroDaJanela(UTC_JANELA, Date.parse('2026-11-09T22:00:00Z')), true);
  assert.equal(dentroDaJanela(UTC_JANELA, Date.parse('2026-11-09T21:59:00Z')), false);
});

test('janela-segundos-descartados', () => {
  const fim22: Janela = { dias: [1], inicio: '20:00', fim: '22:00', fuso: 'UTC' };
  assert.equal(dentroDaJanela(fim22, SEG_21_59_30), true);
});

test('janela-inicio-igual-fim-24h', () => {
  const j: Janela = { dias: [1], inicio: '22:00', fim: '22:00', fuso: 'UTC' };
  assert.equal(dentroDaJanela(j, Date.parse('2026-11-10T21:59:00Z')), true, 'ter 21:59');
  assert.equal(dentroDaJanela(j, Date.parse('2026-11-10T22:00:00Z')), false, 'ter 22:00');
  assert.equal(dentroDaJanela(j, Date.parse('2026-11-09T22:00:00Z')), true, 'seg 22:00');
});

test('janela-dst-new-york', () => {
  const j1: Janela = { dias: [0], inicio: '02:00', fim: '02:30', fuso: 'America/New_York' };
  const agora = Date.parse('2026-03-08T06:00:00Z'); // 01:00 EST
  assert.equal(dentroDaJanela(j1, agora), false);
  assert.equal(proximaAbertura(j1, agora), '2026-03-15T06:00:00.000Z', '02:00 não existe em 08/03');
  const j2: Janela = { dias: [0], inicio: '02:30', fim: '03:30', fuso: 'America/New_York' };
  assert.equal(proximaAbertura(j2, agora), '2026-03-08T07:00:00.000Z', '03:00 EDT');
});

test('janela-dst-volta-segunda-ocorrencia', () => {
  const j: Janela = { dias: [0], inicio: '01:00', fim: '01:15', fuso: 'America/New_York' };
  assert.equal(proximaAbertura(j, Date.parse('2026-11-01T05:20:00Z')), '2026-11-01T06:00:00.000Z');
});

test('quando-alinhado-ao-minuto', () => {
  const q = proximaAbertura({ dias: [1], inicio: '22:00', fim: '23:00', fuso: 'UTC' }, SEG_21_59_30);
  assert.equal(q, '2026-11-09T22:00:00.000Z');
  const ms = Date.parse(q as string);
  assert.equal(ms % 60000, 0);
  assert.ok(ms >= SEG_21_59_30);
});

test('quando-nunca-antes-de-agora', () => {
  for (const agora of [Date.parse('2026-11-09T12:34:56.789Z'), Date.parse('2026-11-14T02:00:00Z'), Date.parse('2026-03-08T06:59:59Z')]) {
    const q = proximaAbertura({ dias: [0, 5], inicio: '22:00', fim: '02:00', fuso: 'America/New_York' }, agora);
    assert.ok(q !== null && Date.parse(q) >= agora, String(agora));
  }
});

test('janela-nao-lanca-com-fuso-ruim: total', () => {
  const ruim: Janela = { dias: [1], inicio: '22:00', fim: '23:00', fuso: 'Mars/Base' };
  assert.equal(dentroDaJanela(ruim, AGORA), false);
  assert.equal(proximaAbertura(ruim, AGORA), null);
});

// ---------------------------------------------------------------- política efetiva

const cfg = (politica: PoliticaEntrega, janela: Janela | null): ConfigEntrega => ({ politica, base: 'main', janela, comandos: {}, erros: [] });
const JC: Janela = { dias: [1], inicio: '01:00', fim: '02:00', fuso: 'UTC' };
const JP: Janela = { dias: [2], inicio: '03:00', fim: '04:00', fuso: 'UTC' };

test('politica-efetiva-matriz (12 células)', () => {
  const ok = (politica: PoliticaEntrega, janela: Janela | null) => ({ ok: true, politica, janela });
  // config continua
  assert.deepEqual(politicaEfetiva(cfg('continua', null), undefined), ok('continua', null));
  assert.deepEqual(politicaEfetiva(cfg('continua', null), { exige_prod: false }), ok('continua', null));
  assert.deepEqual(politicaEfetiva(cfg('continua', null), { exige_prod: false, politica: 'continua' }), ok('continua', null));
  assert.deepEqual(politicaEfetiva(cfg('continua', JC), { exige_prod: false, politica: 'janela', janela: JP }), ok('janela', JP));
  assert.deepEqual(politicaEfetiva(cfg('continua', JC), { exige_prod: false, politica: 'janela' }), ok('janela', JC));
  const sem = politicaEfetiva(cfg('continua', null), { exige_prod: false, politica: 'janela' });
  assert.equal(sem.ok, false);
  if (!sem.ok) assert.equal(sem.erro, 'janela_ausente');
  assert.deepEqual(politicaEfetiva(cfg('continua', null), { exige_prod: false, politica: 'sob_demanda' }), ok('sob_demanda', null));
  // config janela
  assert.deepEqual(politicaEfetiva(cfg('janela', JC), undefined), ok('janela', JC));
  assert.deepEqual(politicaEfetiva(cfg('janela', JC), { exige_prod: false, politica: 'janela', janela: JP }), ok('janela', JC), 'config vence');
  assert.deepEqual(politicaEfetiva(cfg('janela', JC), { exige_prod: false, politica: 'sob_demanda' }), ok('sob_demanda', null));
  const af1 = politicaEfetiva(cfg('janela', JC), { exige_prod: false, politica: 'continua' });
  assert.equal(af1.ok, false);
  if (!af1.ok) assert.equal(af1.erro, 'politica_afrouxada');
  // config sob_demanda
  assert.deepEqual(politicaEfetiva(cfg('sob_demanda', null), undefined), ok('sob_demanda', null));
  assert.deepEqual(politicaEfetiva(cfg('sob_demanda', null), { exige_prod: false, politica: 'sob_demanda' }), ok('sob_demanda', null));
  for (const p of ['continua', 'janela'] as const) {
    const r = politicaEfetiva(cfg('sob_demanda', null), { exige_prod: false, politica: p, janela: JP });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.erro, 'politica_afrouxada');
      assert.ok(r.mensagem.length > 0);
    }
  }
});

test('plano-afrouxa-recusa', () => {
  const r = politicaEfetiva(cfg('janela', JC), { exige_prod: false, politica: 'continua' });
  assert.equal(r.ok, false);
});

test('plano-aperta-ok', () => {
  assert.equal(politicaEfetiva(cfg('continua', null), { exige_prod: false, politica: 'sob_demanda' }).ok, true);
});

test('janela-sem-janela-ausente', () => {
  const r = politicaEfetiva(cfg('continua', null), { exige_prod: false, politica: 'janela' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.erro, 'janela_ausente');
});

test('p-janela-sem-politica-nao-aperta', () => {
  assert.deepEqual(politicaEfetiva(cfg('continua', null), { exige_prod: false, janela: JP }), { ok: true, politica: 'continua', janela: null });
});

// ---------------------------------------------------------------- lerConfigEntrega

const DEFAULT = { politica: 'sob_demanda', base: 'main', janela: null, comandos: {}, erros: [] };

test('config-ausente-x-corrompida', () => {
  assert.deepEqual(lerConfigEntrega(null), DEFAULT);
  assert.deepEqual(lerConfigEntrega(undefined), DEFAULT);
  assert.deepEqual(lerConfigEntrega({}), DEFAULT);
  const ruim = lerConfigEntrega({ entrega: 'x' });
  assert.equal(ruim.politica, 'sob_demanda');
  assert.ok(ruim.erros.length > 0);
  for (const e of ['x', [], 3, null]) assert.ok(lerConfigEntrega({ entrega: e }).erros.length > 0, JSON.stringify(e));
  assert.ok(lerConfigEntrega('x').erros.length > 0, 'config que nem objeto é: corrompido, não ausente');
});

test('config-politica-invalida-sob-demanda', () => {
  for (const p of ['CONTINUA', 1, null, 'x']) {
    const c = lerConfigEntrega({ entrega: { politica: p } });
    assert.equal(c.politica, 'sob_demanda', String(p));
    assert.ok(c.erros.length > 0, String(p));
  }
  assert.equal(lerConfigEntrega({ entrega: { politica: 'continua' } }).politica, 'continua');
  assert.deepEqual(lerConfigEntrega({ entrega: { politica: 'continua' } }).erros, []);
});

test('config-janela-invalida-degrada-sob-demanda', () => {
  const invalidas: unknown[] = [
    undefined,
    { dias: [7], inicio: '22:00', fim: '23:00', fuso: 'UTC' },
    { dias: [1], inicio: '22:00', fim: '24:00', fuso: 'UTC' },
    { dias: [1], inicio: '22:00', fim: '23:00', fuso: 'Mars/Base' },
    { dias: [], inicio: '22:00', fim: '23:00', fuso: 'UTC' },
    { dias: [1.5], inicio: '22:00', fim: '23:00', fuso: 'UTC' },
    'x',
  ];
  for (const janela of invalidas) {
    const c = lerConfigEntrega({ entrega: { politica: 'janela', janela } });
    assert.equal(c.politica, 'sob_demanda', JSON.stringify(janela));
    assert.equal(c.janela, null);
    assert.ok(c.erros.length > 0);
  }
  const ok = lerConfigEntrega({ entrega: { politica: 'janela', janela: { dias: [5], inicio: '22:00', fim: '02:00', fuso: 'America/New_York' } } });
  assert.equal(ok.politica, 'janela');
  assert.deepEqual(ok.erros, []);
  assert.deepEqual(ok.janela, { dias: [5], inicio: '22:00', fim: '02:00', fuso: 'America/New_York' });
});

test('config-janela-invalida-fora-da-politica-janela', () => {
  const c = lerConfigEntrega({ entrega: { politica: 'continua', janela: { dias: [9], inicio: '22:00', fim: '23:00', fuso: 'UTC' } } });
  assert.equal(c.politica, 'continua');
  assert.equal(c.janela, null);
  assert.ok(c.erros.length > 0);
});

test('config-base-invalida-main', () => {
  for (const base of ['', '--force', '-x', 'a..b', 'a b', 'a\u0000b', 3, null]) {
    const c = lerConfigEntrega({ entrega: { base } });
    assert.equal(c.base, 'main', JSON.stringify(base));
    assert.ok(c.erros.length > 0, JSON.stringify(base));
  }
  for (const base of ['develop', 'release/2026.11', '.x', '/x', 'a_b']) {
    const c = lerConfigEntrega({ entrega: { base } });
    assert.equal(c.base, base);
    assert.deepEqual(c.erros, []);
  }
  assert.equal(lerConfigEntrega({ entrega: {} }).base, 'main');
  assert.deepEqual(lerConfigEntrega({ entrega: {} }).erros, []);
});

test('config-argv-nul-ausente', () => {
  const c = lerConfigEntrega({ entrega: { comandos: { deploy: { argv: ['deploy\u0000x'] } } } });
  assert.equal(c.comandos.deploy, undefined);
  assert.ok(c.erros.length > 0);
});

test('config-argv-elemento-nao-texto-ausente', () => {
  for (const argv of [[1], ['ok', null], [], 'deploy', [''], ['', 'x'], undefined, {}]) {
    const c = lerConfigEntrega({ entrega: { comandos: { smoke: { argv } } } });
    assert.equal(c.comandos.smoke, undefined, JSON.stringify(argv));
    assert.ok(c.erros.length > 0, JSON.stringify(argv));
  }
});

test('config-timeout-fracionario-ausente', () => {
  for (const timeout_s of [1.5, 0, -3, '10', null, Number.NaN]) {
    const c = lerConfigEntrega({ entrega: { comandos: { rollback: { argv: ['x'], timeout_s } } } });
    assert.equal(c.comandos.rollback, undefined, String(timeout_s));
    assert.ok(c.erros.length > 0, String(timeout_s));
  }
});

test('config-comandos-validos: timeout default 600, chave desconhecida ignorada', () => {
  const c = lerConfigEntrega({
    entrega: { comandos: { deploy: { argv: ['./d', '--prod'] }, smoke: { argv: ['./s'], timeout_s: 30 }, extra: { argv: [1] } } },
  });
  assert.deepEqual(c.comandos.deploy, { argv: ['./d', '--prod'], timeout_s: 600 });
  assert.deepEqual(c.comandos.smoke, { argv: ['./s'], timeout_s: 30 });
  assert.equal(c.comandos.rollback, undefined);
  assert.deepEqual(c.erros, []);
  assert.ok(lerConfigEntrega({ entrega: { comandos: 'x' } }).erros.length > 0);
});

// ---------------------------------------------------------------- estático e costura

test('entrega-sem-relogio', () => {
  const fonte = readFileSync(fileURLToPath(new URL('../src/entrega.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(fonte, /Date\.now/);
  assert.doesNotMatch(fonte, /new Date\(\s*\)/);
});

test('costura: config bruto de origin atravessa lerConfigEntrega, politicaEfetiva e decidirEntrega', () => {
  const bruto = JSON.parse(JSON.stringify({
    entrega: {
      politica: 'janela', base: 'release',
      janela: { dias: [1], inicio: '22:00', fim: '23:00', fuso: 'UTC' },
      comandos: { deploy: { argv: ['./d'] }, smoke: { argv: ['./s'] }, rollback: { argv: ['./r'] } },
    },
  }));
  const c = lerConfigEntrega(bruto);
  const p = politicaEfetiva(c, { exige_prod: true, politica: 'janela' });
  assert.equal(p.ok, true);
  if (!p.ok) return;
  const entrada = { politica: p.politica, janela: p.janela, exigeProd: true, base: c.base, comandos: c.comandos };
  assert.deepEqual(decidirEntrega({ ...entrada, eventos: diario(INT, HV), agoraMs: SEG_21_59_30 }), { tipo: 'agendar', quando: '2026-11-09T22:00:00.000Z' });
  assert.deepEqual(decidirEntrega({ ...entrada, eventos: diario(INT, HV), agoraMs: SEG_22_30 }), { tipo: 'subir' });
});

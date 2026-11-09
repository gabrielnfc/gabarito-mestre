/**
 * Testes de `painel-hora` (GM-12 T1b): data civil e hora local do painel por fuso IANA, 24 h, sem `node:*`.
 * Mutações prescritas (.superpowers/sdd/2026-11-09-e4-painel/task-1b-mut.json):
 *  MUT-T1B-1  `dataCivil` em UTC em vez do fuso ⇒ `hora-virada-do-dia` e `data-civil-por-fuso` falham
 *  (demais mutações no JSON: fuso inválido sem queda, relógio 12 h, dd/mm trocado, `agora` ignorado)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataCivil, fusoValido, horaLocal } from '../src/painel-hora.ts';

const SP = 'America/Sao_Paulo';
const LX = 'Europe/Lisbon';
const t = (iso: string) => Date.parse(iso);

test('fuso-valido-devolve-o-proprio', () => {
  assert.equal(fusoValido(SP), SP);
  assert.equal(fusoValido(LX), LX);
  assert.equal(fusoValido('UTC'), 'UTC');
});

test('fuso-invalido-utc', () => {
  for (const ruim of ['Marte/Olympus', '', '   ', 'america/sao paulo x', 'Europe/', undefined, null, 42, {}]) {
    assert.equal(fusoValido(ruim as unknown as string), 'UTC', JSON.stringify(ruim));
  }
  // as funções que recebem fuso inválido caem em UTC sem lançar
  const ms = t('2026-11-09T23:30:00Z');
  assert.equal(dataCivil(ms, 'Marte/Olympus'), '2026-11-09');
  assert.equal(horaLocal(ms, ms, 'Marte/Olympus'), '23:30');
});

test('data-civil-por-fuso', () => {
  // 02:30Z de 10/11 ainda é 09/11 em São Paulo (-03)
  assert.equal(dataCivil(t('2026-11-10T02:30:00Z'), SP), '2026-11-09');
  assert.equal(dataCivil(t('2026-11-10T02:30:00Z'), 'UTC'), '2026-11-10');
  // 23:30Z de 01/07 já é 02/07 em Lisboa (verão, +01)
  assert.equal(dataCivil(t('2026-07-01T23:30:00Z'), LX), '2026-07-02');
  assert.equal(dataCivil(t('2026-07-01T23:30:00Z'), 'UTC'), '2026-07-01');
  // zero à esquerda em mês e dia
  assert.equal(dataCivil(t('2026-01-05T12:00:00Z'), 'UTC'), '2026-01-05');
});

test('hora-mesmo-dia-so-hh-mm', () => {
  const agora = t('2026-11-09T15:45:00Z'); // 12:45 em SP
  assert.equal(horaLocal(t('2026-11-09T12:07:00Z'), agora, SP), '09:07');
  assert.equal(horaLocal(agora, agora, SP), '12:45');
});

test('hora-virada-do-dia', () => {
  // agora = 09/11 10:00 em SP; evento = 08/11 23:30 em SP (= 09/11 02:30Z, que em UTC seria o mesmo dia de agora)
  const agora = t('2026-11-09T13:00:00Z');
  assert.equal(horaLocal(t('2026-11-09T02:30:00Z'), agora, SP), '08/11 23:30');
  // evento 09/11 00:05 em SP: mesmo dia, sem data
  assert.equal(horaLocal(t('2026-11-09T03:05:00Z'), agora, SP), '00:05');
  // ordem dd/mm, não mm/dd
  assert.equal(horaLocal(t('2026-03-04T12:00:00Z'), t('2026-03-20T12:00:00Z'), 'UTC'), '04/03 12:00');
});

test('hora-agora-decide-o-dia-no-fuso', () => {
  // mesmo instante do evento, mas `agora` em outro dia civil do fuso ⇒ mostra a data (agora é lido, não só o ts)
  const ev = t('2026-11-09T15:00:00Z');
  assert.equal(horaLocal(ev, t('2026-11-09T20:00:00Z'), SP), '12:00');
  assert.equal(horaLocal(ev, t('2026-11-10T20:00:00Z'), SP), '09/11 12:00');
  // futuro (reset de limite) em dia seguinte também mostra a data
  assert.equal(horaLocal(t('2026-11-10T09:00:00Z'), t('2026-11-09T20:00:00Z'), SP), '10/11 06:00');
});

test('hora-24h-meia-noite', () => {
  const agora = t('2026-11-09T12:00:00Z');
  assert.equal(horaLocal(t('2026-11-09T00:00:00Z'), agora, 'UTC'), '00:00'); // nunca "24:00"
  assert.equal(horaLocal(t('2026-11-09T00:30:00Z'), agora, 'UTC'), '00:30');
  assert.equal(horaLocal(t('2026-11-09T15:20:00Z'), agora, 'UTC'), '15:20'); // nunca "03:20 PM"
  assert.equal(horaLocal(t('2026-11-09T23:59:00Z'), agora, 'UTC'), '23:59');
});

test('hora-dst', () => {
  // Lisboa 2026: 29/03 01:00Z pula 01:00 WET para 02:00 WEST; 25/10 01:00Z volta 02:00 WEST para 01:00 WET
  const aLx = t('2026-03-29T12:00:00Z');
  assert.equal(horaLocal(t('2026-03-29T00:59:00Z'), aLx, LX), '00:59');
  assert.equal(horaLocal(t('2026-03-29T01:00:00Z'), aLx, LX), '02:00');
  const bLx = t('2026-10-25T12:00:00Z');
  assert.equal(horaLocal(t('2026-10-25T00:59:00Z'), bLx, LX), '01:59');
  assert.equal(horaLocal(t('2026-10-25T01:00:00Z'), bLx, LX), '01:00');
  assert.equal(horaLocal(t('2026-10-25T01:59:00Z'), bLx, LX), '01:59');
  // São Paulo teve horário de verão até 2019: 04/11/2018 00:00 -03 pulou para 01:00 -02
  const aSp = t('2018-11-04T20:00:00Z');
  assert.equal(horaLocal(t('2018-11-04T02:59:00Z'), aSp, SP), '03/11 23:59');
  assert.equal(horaLocal(t('2018-11-04T03:00:00Z'), aSp, SP), '01:00');
  // a data civil acompanha o deslocamento vigente: 28/03 23:30Z ainda é 28/03 (+00); 29/03 23:30Z já é 30/03 (+01)
  assert.equal(dataCivil(t('2026-03-28T23:30:00Z'), LX), '2026-03-28');
  assert.equal(dataCivil(t('2026-03-29T23:30:00Z'), LX), '2026-03-30');
});

test('ts-com-offset', () => {
  // o mesmo instante escrito com offsets diferentes dá a mesma hora local
  const agora = t('2026-11-09T18:00:00Z');
  const a = t('2026-11-09T09:15:00-03:00');
  const b = t('2026-11-09T12:15:00Z');
  const c = t('2026-11-09T13:15:00+01:00');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(horaLocal(a, agora, SP), '09:15');
  assert.equal(horaLocal(b, agora, SP), '09:15');
  assert.equal(horaLocal(c, agora, SP), '09:15');
  // offset que atravessa a meia-noite: 23:30-03:00 de 08/11 é 09/11 02:30Z
  assert.equal(dataCivil(t('2026-11-08T23:30:00-03:00'), SP), '2026-11-08');
  assert.equal(dataCivil(t('2026-11-08T23:30:00-03:00'), 'UTC'), '2026-11-09');
});

test('ms-nao-finito-nao-lanca-nem-vira-hora', () => {
  const agora = t('2026-11-09T12:00:00Z');
  for (const ruim of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
    assert.equal(horaLocal(ruim, agora, SP), '--:--', String(ruim));
    assert.equal(dataCivil(ruim, SP), '', String(ruim));
  }
  // texto não é instante, mesmo que o `Intl` o converta em número
  assert.equal(horaLocal('1762700000000' as unknown as number, agora, SP), '--:--');
  assert.equal(dataCivil('1762700000000' as unknown as number, SP), '');
  // `agora` inválido não esconde a data do evento
  assert.equal(horaLocal(agora, NaN, SP), '09/11 09:00');
});

test('nucleo-sem-node-nem-segmenter', () => {
  // D-B: o mod carrega o dist; módulo embutido do Node ou `Intl.Segmenter` no fecho o derrubaria
  for (const rel of ['../src/painel-hora.ts', '../dist/painel-hora.js']) {
    const fonte = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(fonte, /node:/, rel);
    assert.doesNotMatch(fonte, /\bimport\b/, rel);
    assert.doesNotMatch(fonte, /Segmenter/, rel);
  }
});

test('fuso-por-fuso-nao-reaproveita-formatador-alheio', () => {
  // o cache é por fuso: alternar fusos na mesma chamada não vaza um no outro
  const ms = t('2026-11-10T02:30:00Z');
  assert.equal(dataCivil(ms, SP), '2026-11-09');
  assert.equal(dataCivil(ms, 'UTC'), '2026-11-10');
  assert.equal(dataCivil(ms, SP), '2026-11-09');
});

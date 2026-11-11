/**
 * Contratos do painel fiel (GM-14 T1b, Emenda 1: FIEL-3, FIEL-6, FIEL-7).
 * `--experimental-strip-types` não confere tipos: os literais com `satisfies` documentam a forma e os campos são conferidos no fonte de `tipos.ts`.
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-1b-mut.json):
 *  M-T1b   `nomes` com nome fora de `NOME_RE` aceito                ⇒ `nomes-stdin-ausente-x-corrompido`
 *  M-T1b-x (próprias) teto 64 ignorado / campo extra aceito / `entregaIdentificada` reintroduzida
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarNomesAgentes } from '../src/painel-equipe.ts';
import type { AgentePainel, AgenteVivo, EstadoPainel, NomesAgentes } from '../src/tipos.ts';

const FONTE = readFileSync(new URL('../src/tipos.ts', import.meta.url), 'utf8');

/** Corpo `{ … }` de `export type <nome> = { … };`, com chaves aninhadas. */
function corpoDoTipo(nome: string): string {
  const i = FONTE.indexOf(`export type ${nome} = {`);
  assert.ok(i >= 0, `tipo ${nome} não achado em tipos.ts`);
  let n = 0;
  for (let j = FONTE.indexOf('{', i); j < FONTE.length; j++) {
    if (FONTE[j] === '{') n++;
    else if (FONTE[j] === '}' && --n === 0) return FONTE.slice(i, j + 1).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  }
  assert.fail(`tipo ${nome} sem fechamento`);
}
const campo = (corpo: string, decl: string): boolean => corpo.replace(/\s+/g, ' ').includes(decl);

test('contratos-fiel-satisfies: cada campo novo existe em tipos.ts com o tipo do plano, e `entregaIdentificada` não', () => {
  const agente = corpoDoTipo('AgentePainel');
  assert.ok(campo(agente, 'descricao: string | null;'), 'AgentePainel.descricao');
  assert.ok(campo(agente, "papelExibido: 'implementador' | 'revisor' | 'correcao' | 'spike' | 'sombra' | null;"), 'AgentePainel.papelExibido');
  const vivo = /export type AgenteVivo = \{[^}]*\}/.exec(FONTE)?.[0] ?? '';
  assert.ok(campo(vivo, 'nome?: string;'), 'AgenteVivo.nome?');
  assert.ok(campo(vivo, 'vistoEm?: number'), 'AgenteVivo.vistoEm?');
  assert.ok(campo(FONTE, 'export type NomesAgentes = { [agentId: string]: { nome: string; vistoEm: number } };'), 'NomesAgentes');
  const estado = corpoDoTipo('EstadoPainel');
  const equipe = estado.slice(estado.indexOf('equipe: {'));
  assert.ok(campo(equipe, 'esperando: string[];'), 'EstadoPainel.equipe.esperando');
  const sombra = /sombra: \{[^\n]*consultasAbertas: number \};/.exec(equipe.replace(/\s+/g, ' '));
  assert.ok(sombra, 'EstadoPainel.equipe.sombra.consultasAbertas');
  // Cláusula negativa (r3 MAJOR-A): a identificação vem da ponte (T30), nunca do estado do painel.
  assert.ok(!FONTE.includes('entregaIdentificada'), 'entregaIdentificada não entra em tipos.ts');

  // Formas de exemplo (documentação; o `tsc` de quem tiver confere).
  const ag = {
    nome: 'FRODO', papel: 'implementador', task: 'T1', estadoTask: 'implementando', modelo: 'opus', ctxPct: null, ctxTok: null, tok: null,
    desdeS: null, cor: 'claude', vivo: true, descricao: 'T1 contratos', papelExibido: 'correcao',
  } satisfies AgentePainel;
  const v = { id: 'a1', type: 'implementador', description: 'T1 x', status: 'running', uso: null, nome: 'SAM', vistoEm: 5 } satisfies AgenteVivo;
  const ns = { a1: { nome: 'SAM', vistoEm: 5 } } satisfies NomesAgentes;
  const esp: EstadoPainel['equipe']['esperando'] = ['T4'];
  const ca: EstadoPainel['equipe']['sombra']['consultasAbertas'] = 2;
  assert.deepEqual([ag.descricao, ag.papelExibido, v.nome, v.vistoEm, ns.a1.nome, esp, ca], ['T1 contratos', 'correcao', 'SAM', 5, 'SAM', ['T4'], 2]);
});

test('nomes-stdin-ausente-x-corrompido: ausente ⇒ {} ; corrompido ⇒ erro distinto; válido ⇒ cópia campo a campo', () => {
  // ausente: stdin da 2.0.0 (sem `nomes`) segue válido e vazio.
  assert.deepEqual(validarNomesAgentes(undefined), { ok: true, nomes: {} });

  // válido, com troca de valor por campo (P15)
  const bruto = { 'agent-1': { nome: 'HARRY', vistoEm: 10 }, 'b_2.x': { nome: 'HARRY2', vistoEm: 0 }, c3: { nome: 'agente', vistoEm: 7 } };
  const r = validarNomesAgentes(bruto);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.nomes, bruto);
  assert.notEqual(r.nomes, bruto, 'devolve cópia');
  assert.notEqual(r.nomes['agent-1'], bruto['agent-1'], 'entrada copiada');
  const trocado = validarNomesAgentes({ 'agent-1': { nome: 'RONY', vistoEm: 11 } });
  assert.deepEqual(trocado, { ok: true, nomes: { 'agent-1': { nome: 'RONY', vistoEm: 11 } } });
  // 10 colunas + sufixo de pacote esgotado (2..9) cabe; 'agente' é o fim da fila (MINOR-8).
  assert.equal(validarNomesAgentes({ a: { nome: 'ABCDEFGHIJ9', vistoEm: 1 } }).ok, true);
  // teto 64: 64 cabe
  const sessentaQuatro = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`a${i}`, { nome: 'SAM', vistoEm: i }]));
  assert.equal(validarNomesAgentes(sessentaQuatro).ok, true);

  // corrompido: nunca lança, sempre `ok: false` com motivo; nunca vira `{}` calado
  const corrompidos: [string, unknown][] = [
    ['null', null], ['lista', []], ['texto', 'x'], ['número', 7],
    ['valor não objeto', { a: 'HARRY' }], ['valor lista', { a: ['HARRY', 1] }],
    ['nome minúsculo', { a: { nome: 'harry', vistoEm: 1 } }],
    ['nome caixa mista', { a: { nome: 'Harry', vistoEm: 1 } }],
    ['nome vazio', { a: { nome: '', vistoEm: 1 } }],
    ['nome 11 sem sufixo', { a: { nome: 'ABCDEFGHIJK', vistoEm: 1 } }],
    ['nome sufixo 1', { a: { nome: 'ABCDEFGHIJ1', vistoEm: 1 } }],
    ['nome com espaço', { a: { nome: 'SAM GAMGI', vistoEm: 1 } }],
    ['nome com controle', { a: { nome: 'SAM\u001b', vistoEm: 1 } }],
    ['Agente maiúsculo inicial', { a: { nome: 'Agente', vistoEm: 1 } }],
    ['nome número', { a: { nome: 5, vistoEm: 1 } }],
    ['nome ausente', { a: { vistoEm: 1 } }],
    ['vistoEm ausente', { a: { nome: 'SAM' } }],
    ['vistoEm negativo', { a: { nome: 'SAM', vistoEm: -1 } }],
    ['vistoEm fracionário', { a: { nome: 'SAM', vistoEm: 1.5 } }],
    ['vistoEm infinito', { a: { nome: 'SAM', vistoEm: Infinity } }],
    ['vistoEm texto', { a: { nome: 'SAM', vistoEm: '1' } }],
    ['campo extra', { a: { nome: 'SAM', vistoEm: 1, papel: 'revisor' } }],
    ['agentId com barra', { '../x': { nome: 'SAM', vistoEm: 1 } }],
    ['agentId vazio', { '': { nome: 'SAM', vistoEm: 1 } }],
    ['agentId 129', { ['a'.repeat(129)]: { nome: 'SAM', vistoEm: 1 } }],
    ['acima do teto 64', { ...sessentaQuatro, a64: { nome: 'SAM', vistoEm: 64 } }],
  ];
  for (const [rotulo, d] of corrompidos) {
    let res: ReturnType<typeof validarNomesAgentes> | undefined;
    assert.doesNotThrow(() => { res = validarNomesAgentes(d); }, rotulo);
    assert.equal(res?.ok, false, rotulo);
    if (res && !res.ok) assert.match(res.erro, /^`nomes` corrompido/, rotulo);
  }
  // getter hostil não lança e não passa
  const hostil = { a: Object.defineProperty({ vistoEm: 1 }, 'nome', { enumerable: true, get(): never { throw new Error('boom'); } }) };
  assert.doesNotThrow(() => validarNomesAgentes(hostil));
  assert.equal(validarNomesAgentes(hostil).ok, false);
  // herdado do prototype não conta como entrada
  assert.deepEqual(validarNomesAgentes(Object.create({ a: { nome: 'SAM', vistoEm: 1 } })), { ok: true, nomes: {} });
});

/**
 * Testes de `linhaDoGrupo` (GM-14 T5, REQ-CHT-1): 1 linha em linguagem natural para o grupo de chamadas do `ToolGroup`.
 * `null` = o mod devolve `next(e)`. Mutações: .superpowers/sdd/2026-11-11-proxima/task-5-mut.json (M-T5a no teste do mod).
 * Limite declarado (S2b, t0a.md): a chamada solo chega como grupo de 1 e só `Read` solo foi medido; Bash, Edit e Agent solo são presumidos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhaDoGrupo, type Chamada } from '../src/ferramentas.ts';

const c = (nome: string, extra: Partial<Chamada> = {}): Chamada => ({ nome, erro: false, ...extra });

test('dois-bash-executou-2-comandos', () => {
  assert.equal(linhaDoGrupo([c('Bash'), c('Bash')]), 'executou 2 comandos');
});
test('tres-read-um-bash-por-virgula', () => {
  assert.equal(linhaDoGrupo([c('Read'), c('Bash'), c('Read'), c('Read')]), 'consultou 3 arquivos, executou 1 comando');
});
test('singular', () => {
  assert.equal(linhaDoGrupo([c('Read')]), 'consultou 1 arquivo');
  assert.equal(linhaDoGrupo([c('Edit')]), 'alterou 1 arquivo');
  assert.equal(linhaDoGrupo([c('Bash')]), 'executou 1 comando');
});
test('plural-de-edicao', () => {
  assert.equal(linhaDoGrupo([c('Edit'), c('Write'), c('NotebookEdit')]), 'alterou 3 arquivos');
});
test('leitura-agrupa-read-grep-glob', () => {
  assert.equal(linhaDoGrupo([c('Read'), c('Grep'), c('Glob')]), 'consultou 3 arquivos');
});
test('ordem-fixa-leitura-edicao-shell-agente', () => {
  const cs = [c('Agent', { papel: 'revisor' }), c('Bash'), c('Write'), c('Grep')];
  assert.equal(linhaDoGrupo(cs), 'consultou 1 arquivo, alterou 1 arquivo, executou 1 comando, chamou revisor');
  assert.equal(linhaDoGrupo([...cs].reverse()), 'consultou 1 arquivo, alterou 1 arquivo, executou 1 comando, chamou revisor');
});
test('agent-chamou-papel', () => {
  assert.equal(linhaDoGrupo([c('Agent', { papel: 'implementador' })]), 'chamou implementador');
});
test('agent-sem-papel-diz-um-agente', () => {
  assert.equal(linhaDoGrupo([c('Agent')]), 'chamou um agente');
  assert.equal(linhaDoGrupo([c('Agent', { papel: '' })]), 'chamou um agente');
  assert.equal(linhaDoGrupo([c('Agent', { papel: '   ' })]), 'chamou um agente');
});
test('dois-agentes-um-por-papel', () => {
  assert.equal(linhaDoGrupo([c('Agent', { papel: 'a' }), c('Agent', { papel: 'b' })]), 'chamou a, chamou b');
});
test('papel-com-controle-nao-chega-a-linha', () => {
  assert.equal(linhaDoGrupo([c('Agent', { papel: 'x\x1b[2Jy\n' })]), 'chamou x[2Jy');
  assert.equal(linhaDoGrupo([c('Agent', { papel: 'a'.repeat(200) })])?.length, 'chamou '.length + 60);
});
test('outra-ferramenta-null', () => {
  assert.equal(linhaDoGrupo([c('WebFetch')]), null);
  assert.equal(linhaDoGrupo([c('Read'), c('mcp__x__y')]), null); // 1 estranha no meio derruba o grupo todo
});
test('nome-e-exato-sem-caixa', () => {
  for (const n of ['read', 'READ', 'bash', 'BASH', 'edit', 'agent', 'Grep ', ' Read']) assert.equal(linhaDoGrupo([c(n)]), null, n);
});
test('erro-null', () => {
  assert.equal(linhaDoGrupo([c('Read', { erro: true })]), null);
  assert.equal(linhaDoGrupo([c('Read'), c('Bash', { erro: true })]), null); // 1 erro no meio do grupo mostra o grupo do motor
});
test('vazio-null', () => {
  assert.equal(linhaDoGrupo([]), null);
});
test('entrada-torta-null-sem-lancar', () => {
  for (const v of [undefined, null, 'x', 7, {}, [null], [undefined], [{}], [{ nome: 7, erro: false }], [{ nome: 'Read' }], [{ nome: 'Read', erro: 'nao' }]]) {
    assert.equal(linhaDoGrupo(v as any), null);
  }
});
test('sem-tipo-nem-caminho-na-linha', () => {
  // a linha natural não carrega nome de ferramenta, caminho nem comando
  for (const cs of [[c('Read'), c('Bash'), c('Edit')], [c('Agent', { papel: 'revisor' })]]) {
    const l = linhaDoGrupo(cs) ?? '';
    assert.doesNotMatch(l, /Read|Bash|Edit|Grep|Glob|Write|Agent|[/\\`]/);
  }
});

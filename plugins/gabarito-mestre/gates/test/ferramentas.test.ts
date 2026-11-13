/**
 * Testes de `linhaDoGrupo` (GM-14 T5, REQ-CHT-1): 1 linha em linguagem natural para o grupo de chamadas do `ToolGroup`.
 * `null` = o mod devolve `next(e)`. Mutações: .superpowers/sdd/2026-11-11-proxima/task-5-mut.json (M-T5a no teste do mod).
 * Limite declarado (S2b, t0a.md): a chamada solo chega como grupo de 1 e só `Read` solo foi medido; Bash, Edit e Agent solo são presumidos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acaoDe, descricaoLimpa, linhaDoGrupo, type Chamada } from '../src/ferramentas.ts';

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

// ---- acaoDe (GM-14 T35, FIEL-11 b): o que o agente faz AGORA, no presente ----
test('acao-de-outra-ferramenta-no-presente', () => {
  assert.equal(acaoDe(c('Read')), 'lendo 1 arquivo');
  assert.equal(acaoDe(c('Grep'), 3), 'lendo 3 arquivos');
  assert.equal(acaoDe(c('Glob'), 2), 'lendo 2 arquivos');
  assert.equal(acaoDe(c('Edit')), 'editando 1 arquivo');
  assert.equal(acaoDe(c('Write'), 2), 'editando 2 arquivos');
  assert.equal(acaoDe(c('NotebookEdit')), 'editando 1 arquivo');
  assert.equal(acaoDe(c('Bash')), 'rodando 1 comando');
  assert.equal(acaoDe(c('Bash'), 4), 'rodando 4 comandos');
  assert.equal(acaoDe(c('Agent', { papel: 'revisor' })), 'chamando revisor');
  assert.equal(acaoDe(c('Agent')), 'chamando um agente');
  assert.equal(acaoDe(c('Agent', { papel: 'gabarito-mestre:gabarito-revisor' })), 'chamando revisor');
  assert.equal(acaoDe(c('Agent', { papel: 'gabarito-implementador' })), 'chamando implementador');
  assert.equal(acaoDe(c('Agent', { papel: 'general-purpose' })), 'chamando general-purpose');
});
test('acao-bash-com-descricao-usa-a-descricao', () => {
  assert.equal(acaoDe({ nome: 'Bash', erro: false, descricao: '  listar arquivos  ' }), 'listar arquivos');
  assert.equal(acaoDe({ nome: 'Bash', erro: false, descricao: '   ' }), 'rodando 1 comando');
  assert.equal(acaoDe({ nome: 'Bash', erro: false, descricao: 42 as unknown as string }), 'rodando 1 comando');
  // descrição só vale no Bash
  assert.equal(acaoDe({ nome: 'Read', erro: false, descricao: 'x' }), 'lendo 1 arquivo');
});
test('acao-higieniza-e-corta-a-descricao', () => {
  assert.equal(descricaoLimpa('a\u0000b\u202Ec\nd'), 'abcd');
  assert.equal([...(descricaoLimpa('x'.repeat(500)) ?? '')].length, 120);
  assert.equal(descricaoLimpa(''), null);
  assert.equal(descricaoLimpa(undefined), null);
});
test('acao-fora-da-tabela-ou-n-invalido', () => {
  assert.equal(acaoDe(c('Monitor')), null);
  assert.equal(acaoDe(c('SubagentHandback')), null);
  assert.equal(acaoDe(c('read')), null); // nome exato, sem caixa
  assert.equal(acaoDe(null as unknown as Chamada), null);
  assert.equal(acaoDe(c('Read'), 0), 'lendo 1 arquivo');
  assert.equal(acaoDe(c('Read'), 1.5), 'lendo 1 arquivo');
  assert.equal(acaoDe(c('Read'), -2), 'lendo 1 arquivo');
});
test('acao-papel-do-agente-limpo', () => {
  assert.equal(acaoDe(c('Agent', { papel: ' revi\u0000sor ' })), 'chamando revisor');
  assert.equal(acaoDe(c('Agent', { papel: '   ' })), 'chamando um agente');
});

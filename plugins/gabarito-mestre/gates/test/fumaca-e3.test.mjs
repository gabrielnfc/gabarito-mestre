/**
 * Fumaça sem LLM da E3 (GM-11 T10, P9): Sombra, emenda, congelamento e julgamento do dono pelos CLIs reais e por `dist/`, em repositório
 * git descartável. A caminhada é `fumaca-e3/caminhada.mjs`; aqui só se afirma o que ela observou. Sem sessão real, sem LLM.
 *
 * MUTAÇÕES PRESCRITAS: task-10-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhar } from './fumaca-e3/caminhada.mjs';

test('fumaca-sombra-e-emenda: consulta, pendente, registrar, cache, congelamento, hook do dono e conclusão', () => {
  const o = caminhar();
  // Sombra: 1ª pergunta grava a consulta; a repetição (caixa e espaço diferentes) é a mesma consulta, ainda aberta; registrar fecha; depois só cache
  assert.equal(o.pergunta1.j.consultas, 1);
  assert.match(o.pergunta1.j.brief, /^\.harness\/entregas\/GM-99\/sombra\/[0-9a-f]{64}\.md$/);
  assert.equal(o.pergunta2.j.pendente, true);
  assert.equal(o.pergunta2.j.hash, o.pergunta1.j.hash);
  assert.equal(o.registro.j.evento.tipo, 'decisao.sombra');
  assert.equal(o.cache.j.cache, true);
  assert.equal(o.cache.j.decisao.resposta, 'Aceita, pela spec.');
  // pendência da T11: o instantâneo mostra a decisão gravada pelo CLI real
  assert.match(o.instantaneo.instantaneo, /Decisões da Sombra \(1\):/);
  assert.ok(o.instantaneo.instantaneo.includes(`task:T1 ${o.pergunta1.j.hash.slice(0, 8)} Aceita, pela spec.`), o.instantaneo.instantaneo);
  assert.equal(o.instantaneo.decisoes, 1);
  // o item do implementador leva a decisão, com o arquivo absoluto
  const t1 = o.proxima1.j.acao.itens.find((i) => i.task === 'T1');
  assert.deepEqual(t1.decisoes.map((d) => [d.hash, d.ancora, d.resposta]), [[o.pergunta1.j.hash, 'task:T1', 'Aceita, pela spec.']]);
  assert.ok(t1.decisoes[0].arquivo.startsWith(o.dir) && t1.decisoes[0].arquivo.endsWith('.resposta.md'));
  assert.deepEqual(t1.modelo, { modelo: 'sonnet', esforco: 'high' });
  // proposta no REQ de T1 congela T1 (e T3); T2 integra; proxima espera o dono
  assert.equal(o.proposta.j.proposta_seq, 1);
  assert.deepEqual([...o.proposta.j.congeladas].sort(), ['T1', 'T3']);
  assert.equal(o.integrarCongelada.j.erro, 'nao_integravel');
  assert.equal(o.integrarT2.j.merge, true);
  assert.deepEqual(o.esperando.j.acao, { tipo: 'esperar', motivo: 'emenda', propostas: [{ seq: 1, req: 'REQ-A-1' }] });
  // hook real do dono aprova; a emenda chega ao item do implementador de T3? não: T3 é REQ-C-1; T1 integra e o fim é `concluir`
  assert.equal(o.hook.status, 0, o.hook.stderr);
  assert.equal(JSON.parse(o.hook.stdout).systemMessage, 'Emenda #1 (REQ-A-1) aprovada pelo dono; entrega GM-99');
  assert.deepEqual(o.proxima3.j.acao, { tipo: 'integrar', tasks: ['T1'] });
  assert.equal(o.integrarT1.j.merge, true);
  assert.deepEqual(o.proxima4.j.acao.itens.map((i) => [i.task, i.papel]), [['T3', 'implementador']]);
  assert.deepEqual(o.final.j.acao, { tipo: 'concluir' });
  // medido: T1 foi aprovada contra a spec antiga e integrada sem revisão nova: o aviso persiste até `concluir`
  const pos = (tipo, filtro = () => true) => o.eventos.findIndex((e) => e.tipo === tipo && filtro(e));
  const ordenados = [...o.eventos].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const idx = (e) => ordenados.indexOf(e);
  const emendada = o.eventos[pos('spec.emendada')];
  const integradaT1 = o.eventos[pos('task.integrada', (e) => e.dados.task === 'T1')];
  assert.deepEqual(emendada.dados, { proposta_seq: 1, origem: 'dono' });
  assert.ok(idx(integradaT1) > idx(emendada), 'task.integrada de T1 posterior à spec.emendada');
  const aprovadoT1 = o.eventos[pos('review.veredito', (e) => e.dados.task === 'T1' && e.dados.veredito === 'APROVADO')];
  assert.ok(idx(aprovadoT1) < idx(emendada), 'o APROVADO de T1 é anterior à spec.emendada');
  const AVISO = ['Atenção: REQ-A-1 emendado (#1) depois de T1 integrada/aprovada: acrescente task de ajuste'];
  assert.deepEqual((o.proxima4.j.aviso ?? []).filter((a) => /emendado/.test(a)), AVISO);
  assert.deepEqual((o.final.j.aviso ?? []).filter((a) => /emendado/.test(a)), AVISO);
  assert.equal(o.temaPlano, 3);
});

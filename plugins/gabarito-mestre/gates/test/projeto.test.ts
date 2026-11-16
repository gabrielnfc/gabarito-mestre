/**
 * Testes de `projeto.ts` (GM-15 T31, REQ-ENT-2 emenda 4, decisão do dono D-G3): núcleo PURO da visão de projeto (uma linha por PBI/entrega,
 * em todas as worktrees). O render e o CLI são da T32. Fixture sintética em `test/fixtures/projeto/` (LEIAME.md); nada do diário real.
 *
 * Mutações nomeadas (cada uma mata ao menos o teste indicado):
 *  M1  PBI sem plano entra com 0 % (pct 0, não null)                          ⇒ pbi-sem-plano-fora-da-conta
 *  M2  total do projeto não conta os PBIs fora da conta                        ⇒ pbi-sem-plano-fora-da-conta
 *  M3  card "Concluído" não faz o PBI feito                                    ⇒ projeto-n-pbis-feitas-total
 *  M4  task cortada/adiada fica no denominador                                 ⇒ projeto-n-pbis-feitas-total
 *  M5  card que não casa o idPadrao (PBI-EXEMPLO) vira linha                   ⇒ projeto-n-pbis-feitas-total
 *  M6  `entrega.encerrada` não faz o PBI feito                                 ⇒ pbi-concluido-por-card-ou-encerrada
 *  M7  só a árvore atual é lida (porcelana ignorada)                           ⇒ worktrees-varridas
 *  M8  vale o card da 1ª árvore, não o mais novo (atualizadoEm)                ⇒ card-mais-novo-vence
 *  M9  evento repetido em 2 árvores entra 2 vezes                              ⇒ diario-uniao-sem-repetir
 *  M10 worktree `prunable` vira árvore a ler                                   ⇒ worktrees-varridas
 *  M11 falha do `git worktree list` sem aviso (ou sem a árvore atual)          ⇒ git-worktree-falha-avisa
 *  M12 sem plano.json escreve "FASE n de 7"                                    ⇒ entrega-sem-plano-fase-nao-medida
 *  M13 agente sem `loop.mjs iniciar` fica "sem task"                           ⇒ agente-fora-do-loop
 *  M14 plano.json inválido cai no plano .md / conta 0                          ⇒ plano-json-invalido-interroga
 *  M15 a parte estimada (sem plano) soma na previsão medida                    ⇒ previsao-medida-e-estimada
 *  M16 "### Task" de nível errado (####) conta como task do plano .md          ⇒ plano-md-conta-tasks
 *  M17 as estimadas somem dos totais                                           ⇒ pbi-concluido-por-card-ou-encerrada
 *  M18 id numérico do diário ("1") não casa a "### Task 1:" do plano .md       ⇒ plano-md-casa-id-numerico
 *  M19 PBI feito sem plano entra na previsão estimada                          ⇒ feito-sem-plano-e-diario-ilegivel
 *  M20 diário ilegível some sem aviso                                          ⇒ feito-sem-plano-e-diario-ilegivel
 * Emenda 18 (aprovada, .claude-tmp/gm15r/emenda-t31b.md):
 *  M21 tasks de PBI concluído sem diário contam como integradas medidas         ⇒ concluido-sem-diario-e-estimado
 *  M22 Sombra sem task devolve null (exceção)                                  ⇒ sombra-sem-task-fora-do-loop
 *  M23 empate de atualizadoEm vence a outra árvore, não a atual                ⇒ card-mais-novo-vence
 *  M24 diário só da 1ª árvore (sem união)                                      ⇒ diario-uniao-sem-repetir
 * Variantes a/b/c (M11, M12, M13, M14) e o roteiro: .claude-tmp/t31/mut.mjs (fora do repo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardDe, planoMdDoCard, projetarProjeto, ROTULO_FASE_NAO_MEDIDA, ROTULO_FORA_DO_LOOP, rotuloAgente, rotuloFase, tasksDoPlanoMd, worktreesDe,
} from '../src/projeto.ts';
import type { ArvoreLida, EstadoProjeto, LinhaProjeto } from '../src/projeto.ts';
import type { Evento } from '../src/tipos.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'projeto');
const AGORA = Date.parse('2026-11-10T15:00:00.000Z');
const OPC = { agoraMs: AGORA, fuso: 'America/Sao_Paulo' };

/** Borda de E/S só do teste (a da T32 vive no CLI): lê uma árvore da fixture no formato `ArvoreLida`. */
function lerArvore(nome: string): ArvoreLida {
  const raiz = join(FIX, nome);
  const cards = existsSync(join(raiz, 'cards'))
    ? readdirSync(join(raiz, 'cards')).sort().map((arquivo) => {
      const texto = readFileSync(join(raiz, 'cards', arquivo), 'utf8');
      const md = planoMdDoCard(texto);
      const planoMd = md !== null && existsSync(join(raiz, md)) ? readFileSync(join(raiz, md), 'utf8') : null;
      return { arquivo, texto, planoMd };
    })
    : [];
  const entregas = existsSync(join(raiz, 'entregas'))
    ? readdirSync(join(raiz, 'entregas')).sort().map((id) => {
      const dir = join(raiz, 'entregas', id);
      let plano: ArvoreLida['entregas'][number]['plano'] = null;
      if (existsSync(join(dir, 'plano.json'))) {
        try { plano = { ok: true, bruto: JSON.parse(readFileSync(join(dir, 'plano.json'), 'utf8')) }; } catch (e) { plano = { ok: false, motivo: `plano.json ilegível: ${(e as Error).message}` }; }
      }
      const eventos: Evento[] = [];
      for (const f of readdirSync(dir).filter((x) => x.startsWith('events.')).sort()) {
        for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) if (l.trim() !== '') eventos.push(JSON.parse(l));
      }
      return { id, plano, eventos };
    })
    : [];
  return { caminho: `/FIX/${nome}`, cards, entregas };
}

const PORCELANA = readFileSync(join(FIX, 'worktrees.txt'), 'utf8');
const ler = (caminhos: string[]): ArvoreLida[] => caminhos.map((c) => lerArvore(c.replace('/FIX/', '')));
const linha = (e: EstadoProjeto, id: string): LinhaProjeto => {
  const l = e.linhas.find((x) => x.id === id);
  assert.ok(l, `linha ${id} ausente`);
  return l;
};
function projetoCompleto(): EstadoProjeto {
  const wt = worktreesDe({ ok: true, saida: PORCELANA }, '/FIX/principal');
  return projetarProjeto(ler(wt.caminhos), { ...OPC, avisos: wt.aviso === null ? [] : [wt.aviso] });
}

test('projeto-n-pbis-feitas-total: uma linha por PBI, feitos pelo card, cortada fora do denominador, modelo de card fora', () => {
  const e = projetoCompleto();
  assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-4', 'PBI-5', 'PBI-6']);
  assert.equal(e.totais.pbis, 6);
  assert.equal(e.totais.feitos, 1);
  assert.equal(linha(e, 'PBI-1').feito, true);
  // PBI-4: plano .md de 4 tasks, T1 e T2 integradas, T3 cortada ⇒ 2 de 3
  assert.deepEqual(linha(e, 'PBI-4').tasks, { total: 3, integradas: 2, estimadas: 0, restantes: 1, fora: 1 });
  assert.equal(linha(e, 'PBI-4').pct, 67);
  assert.equal(linha(e, 'PBI-4').feito, false);
  // totais: PBI-1 (feito, 3 estimadas) + PBI-2 (1 de 3) + PBI-4 (2 de 3): 3 medidas + 3 estimadas de 9
  assert.equal(e.totais.tasks, 9);
  assert.equal(e.totais.integradas, 3);
  assert.equal(e.totais.estimadas, 3);
  assert.equal(e.totais.restantes, 3);
  assert.equal(e.totais.pct, 33);
  assert.equal(e.totais.pctComEstimadas, 67);
});

test('concluido-sem-diario-e-estimado: tasks de PBI concluído sem registro no diário são estimadas e sinalizadas, nunca integradas medidas', () => {
  const l = linha(projetoCompleto(), 'PBI-1');
  assert.deepEqual(l.tasks, { total: 3, integradas: 0, estimadas: 3, restantes: 0, fora: 0 });
  assert.equal(l.pct, 0);
  assert.equal(l.pctComEstimadas, 100);
  assert.equal(l.texto, 'feito (3 tasks estimadas)');
});

test('pbi-concluido-por-card-ou-encerrada: card "Concluído" OU `entrega.encerrada` sem reabertura depois; reaberta depois desfaz', () => {
  assert.equal(linha(projetoCompleto(), 'PBI-1').feito, true); // pelo card
  assert.equal(linha(projetoCompleto(), 'PBI-4').feito, false); // card "Em execução", sem encerrada
  const ev = (seq: number, hm: string, tipo: string, dados: Record<string, unknown>): Evento =>
    ({ seq, ts: `2026-11-10T${hm}:00.000Z`, autor: 'a', sessao: 's', agente: 'orquestrador', tipo, dados, hash_anterior: null }) as Evento;
  const plano = { ok: true as const, bruto: { entrega: 'GM-9', tasks: [{ id: 'T1', titulo: 'a', deps: [], arquivos: ['a.ts'] }, { id: 'T2', titulo: 'b', deps: [], arquivos: ['b.ts'] }] } };
  const base = [ev(1, '10', 'task.iniciada', { task: 'T1', papel: 'implementador' })];
  const encerrada = ev(2, '11', 'entrega.encerrada', { entrega: 'GM-9', pr: 1, via: 'gh', mergeado_em: '2026-11-10T11:00:00.000Z' });
  const arv = (eventos: Evento[]): ArvoreLida[] => [{ caminho: '/r', cards: [], entregas: [{ id: 'GM-9', plano, eventos }] }];
  const fechado = projetarProjeto(arv([...base, encerrada]), OPC);
  assert.equal(linha(fechado, 'GM-9').feito, true);
  assert.equal(fechado.totais.feitos, 1);
  assert.equal(fechado.totais.restantes, 0);
  assert.equal(fechado.totais.integradas, 0);
  assert.equal(fechado.totais.estimadas, 2);
  const reaberto = projetarProjeto(arv([...base, encerrada, ev(3, '12', 'entrega.reaberta', { entrega: 'GM-9', em: '2026-11-10T12:00:00.000Z' })]), OPC);
  assert.equal(linha(reaberto, 'GM-9').feito, false);
  assert.equal(reaberto.totais.restantes, 2);
});

test('pbi-sem-plano-fora-da-conta: "sem plano", nunca 0 %; o total diz quantos PBIs ficam fora', () => {
  const e = projetoCompleto();
  for (const id of ['PBI-3', 'PBI-5']) {
    const l = linha(e, id);
    assert.equal(l.semPlano, true);
    assert.equal(l.pct, null);
    assert.equal(l.tasks, null);
    assert.equal(l.texto, 'sem plano');
  }
  assert.equal(e.totais.foraDaConta, 3); // PBI-3, PBI-5 e PBI-6 (plano.json inválido)
  assert.equal(linha(e, 'PBI-2').semPlano, false);
});

test('plano-json-invalido-interroga: plano.json inválido mostra "?" com o motivo, nunca plano velho nem 0', () => {
  const l = linha(projetoCompleto(), 'PBI-6');
  assert.equal(l.pct, null);
  assert.equal(l.tasks, null);
  assert.equal(l.semPlano, true);
  assert.equal(l.texto, '? plano inválido'); // texto do render sem nome técnico (REQ-LNG-1); o motivo vai à parte
  assert.match(String(l.motivo), /plano\.json ilegível/);
  // inválido pelo contrato (JSON lido, plano recusado) também
  const r = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-7.md', texto: '---\nid: "PBI-7"\nstatus: Backlog\n---\n# X\nPlano: `p.md`\n', planoMd: '### Task 1: a\n' }],
    entregas: [{ id: 'PBI-7', plano: { ok: true, bruto: { entrega: 'PBI-7', tasks: 'x' } }, eventos: [] }] }], OPC);
  assert.equal(linha(r, 'PBI-7').tasks, null, 'plano.json recusado não cai no plano .md');
  assert.equal(linha(r, 'PBI-7').texto, '? plano inválido');
  assert.match(String(linha(r, 'PBI-7').motivo), /tasks/);
});

test('plano-md-conta-tasks: só "### Task N:" conta; card aponta o plano', () => {
  assert.deepEqual(tasksDoPlanoMd('# P\n### Task 1: a\n### Task 2: b\n#### Task 9: não\n ### Task 3: indentado não\n### Task 10: c\n'), ['T1', 'T2', 'T10']);
  assert.equal(planoMdDoCard('Plano: `docs/plans/x.md` (em main) · Ledger: `l.md`'), 'docs/plans/x.md');
  assert.equal(planoMdDoCard('Plano: a escrever · Ledger: `l.md`'), null);
  const c = cardDe('PBI-4.md', readFileSync(join(FIX, 'principal', 'cards', 'PBI-4.md'), 'utf8'));
  assert.deepEqual(c, { id: 'PBI-4', status: 'Em execução', titulo: 'Hoje', atualizadoEm: '2026-11-03', planoMd: 'planos/pbi-4.md' });
  assert.equal(cardDe('PBI-EXEMPLO.md', readFileSync(join(FIX, 'principal', 'cards', 'PBI-EXEMPLO.md'), 'utf8')), null);
});

test('worktrees-varridas: as 2 worktrees entram; card mais novo vence; evento repetido conta 1 vez; prunable fica fora', () => {
  const wt = worktreesDe({ ok: true, saida: PORCELANA }, '/FIX/principal');
  assert.deepEqual(wt.caminhos, ['/FIX/principal', '/FIX/wt-pbi-2']);
  assert.equal(wt.aviso, null);
  const e = projetoCompleto();
  // PBI-5 só existe na worktree; o plano.json do PBI-2 também
  assert.equal(linha(e, 'PBI-5').status, 'Backlog');
  assert.equal(linha(e, 'PBI-2').plano, 'json');
  assert.deepEqual(e.avisos, []);
  // a árvore atual vem primeiro mesmo fora da ordem do git
  assert.deepEqual(worktreesDe({ ok: true, saida: PORCELANA }, '/FIX/wt-pbi-2').caminhos, ['/FIX/wt-pbi-2', '/FIX/principal']);
});

test('card-mais-novo-vence: entre worktrees vale o atualizadoEm mais novo; empate ⇒ o da árvore atual', () => {
  assert.equal(linha(projetoCompleto(), 'PBI-2').status, 'Revisão e teste'); // 2026-11-05 na worktree > 2026-11-02 na atual
  const card = (status: string): { arquivo: string; texto: string; planoMd: null } =>
    ({ arquivo: 'PBI-7.md', texto: `---\nid: "PBI-7"\nstatus: ${status}\natualizadoEm: "2026-11-05"\n---\n# X\n`, planoMd: null });
  const r = projetarProjeto([{ caminho: '/atual', cards: [card('Em execução')], entregas: [] }, { caminho: '/outra', cards: [card('Backlog')], entregas: [] }], OPC);
  assert.equal(linha(r, 'PBI-7').status, 'Em execução');
});

test('diario-uniao-sem-repetir: diário = união das worktrees, evento repetido conta 1 vez', () => {
  // o diário do PBI-2 está nas 2 árvores: duplicado, a T1 integrada 2 vezes seria estado inválido
  const e = projetoCompleto();
  assert.deepEqual(linha(e, 'PBI-2').tasks, { total: 3, integradas: 1, estimadas: 0, restantes: 2, fora: 0 });
  assert.deepEqual(e.avisos, []);
  // eventos diferentes em árvores diferentes somam: T1 integrada numa, T2 noutra
  const ev = (sessao: string, seq: number, mm: string, tipo: string, dados: Record<string, unknown>): Evento =>
    ({ seq, ts: `2026-11-10T10:${mm}:00.000Z`, autor: 'a', sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null }) as Evento;
  const ciclo = (s: string, t: string, m: number): Evento[] => [ev(s, 1, String(m).padStart(2, '0'), 'task.iniciada', { task: t, papel: 'implementador' }),
    ev(s, 2, String(m + 1).padStart(2, '0'), 'task.concluida', { task: t }), ev(s, 3, String(m + 2).padStart(2, '0'), 'review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }),
    ev(s, 4, String(m + 3).padStart(2, '0'), 'task.integrada', { task: t })];
  const plano = { ok: true as const, bruto: { entrega: 'GM-9', tasks: [{ id: 'T1', titulo: 'a', deps: [], arquivos: ['a.ts'] }, { id: 'T2', titulo: 'b', deps: [], arquivos: ['b.ts'] }] } };
  const r = projetarProjeto([{ caminho: '/a', cards: [], entregas: [{ id: 'GM-9', plano, eventos: ciclo('sa', 'T1', 0) }] },
    { caminho: '/b', cards: [], entregas: [{ id: 'GM-9', plano: null, eventos: [...ciclo('sa', 'T1', 0), ...ciclo('sb', 'T2', 10)] }] }], OPC);
  assert.deepEqual(linha(r, 'GM-9').tasks, { total: 2, integradas: 2, estimadas: 0, restantes: 0, fora: 0 });
});

test('git-worktree-falha-avisa: falha do git ⇒ só a árvore atual e um aviso', () => {
  const wt = worktreesDe({ ok: false, motivo: 'git saiu 128' }, '/FIX/principal');
  assert.deepEqual(wt.caminhos, ['/FIX/principal']);
  assert.ok(wt.aviso !== null);
  assert.match(wt.aviso, /git worktree list/);
  assert.match(wt.aviso, /git saiu 128/);
  assert.match(wt.aviso, /só a árvore atual/);
  const e = projetarProjeto(ler(wt.caminhos), { ...OPC, avisos: [wt.aviso] });
  assert.deepEqual(e.avisos, [wt.aviso]);
  assert.equal(e.linhas.some((l) => l.id === 'PBI-5'), false);
  assert.equal(linha(e, 'PBI-2').status, 'Em execução');
  // saída que não é porcelana (sem nenhuma linha `worktree`) também avisa
  const vazio = worktreesDe({ ok: true, saida: 'lixo\n' }, '/FIX/principal');
  assert.deepEqual(vazio.caminhos, ['/FIX/principal']);
  assert.ok(vazio.aviso !== null);
});

test('entrega-sem-plano-fase-nao-medida: sem plano.json a fase diz "fase não medida", nunca "FASE n de 7"', () => {
  assert.equal(ROTULO_FASE_NAO_MEDIDA, 'fase não medida');
  assert.equal(rotuloFase(false, 5), 'fase não medida');
  assert.equal(rotuloFase(false, null), 'fase não medida');
  assert.equal(rotuloFase(true, 5), 'FASE 5 de 7');
  assert.equal(rotuloFase(true, null), 'FASE ? de 7');
  const e = projetoCompleto();
  assert.equal(linha(e, 'PBI-4').fase, 'fase não medida'); // plano .md, sem plano.json
  assert.equal(linha(e, 'PBI-3').fase, 'fase não medida');
  assert.equal(linha(e, 'PBI-2').fase, null); // com plano.json, a fase é a da trilha (render)
});

test('agente-fora-do-loop: agente sem `loop.mjs iniciar` ⇒ "agente fora do loop", nunca "sem task"', () => {
  assert.equal(ROTULO_FORA_DO_LOOP, 'agente fora do loop');
  const estados = new Map([['T1', 'implementando' as const], ['T2', 'pendente' as const]]);
  assert.equal(rotuloAgente({ task: null, papelExibido: 'implementador' }, estados), 'agente fora do loop');
  assert.equal(rotuloAgente({ task: null, papelExibido: null }, estados), 'agente fora do loop');
  assert.equal(rotuloAgente({ task: 'T2', papelExibido: 'implementador' }, estados), 'agente fora do loop'); // casou a task, mas ninguém iniciou
  assert.equal(rotuloAgente({ task: 'T9', papelExibido: 'implementador' }, estados), 'agente fora do loop'); // task sem estado
  assert.equal(rotuloAgente({ task: 'T1', papelExibido: 'implementador' }, estados), 'T1');
});

test('sombra-sem-task-fora-do-loop: a Sombra sem task também é "agente fora do loop" (emenda 4 item 5, sem exceção)', () => {
  assert.equal(rotuloAgente({ task: null, papelExibido: 'sombra' }, new Map()), 'agente fora do loop');
});

test('previsao-medida-e-estimada: ritmo medido × restantes (a); sem plano entra só na estimada (b), sinalizada', () => {
  const p = projetoCompleto().totais.previsao;
  // ritmo: PBI-4 10:00→11:50 (2 integradas) + PBI-2 13:00→13:50 (1) = 160 min ÷ 3 = 3200 s
  assert.equal(p.ritmoS, 3200);
  assert.ok(p.medida !== null);
  assert.equal(p.medida.restanteS, 3 * 3200);
  assert.equal(typeof p.medida.hora, 'string');
  assert.ok(p.estimada !== null);
  // 3 PBIs sem plano (não feitos) × mediana de 3 tasks por PBI com plano
  assert.equal(p.estimada.pbisSemPlano, 3);
  assert.equal(p.estimada.tasksPorPbi, 3);
  assert.equal(p.estimada.restanteS, 3 * 3200 + 3 * 3 * 3200);
  assert.equal(p.motivo, null);
});

test('previsao-sem-ritmo: sem task integrada no repo não há previsão (? com motivo), nunca palpite', () => {
  const r = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-1.md', texto: '---\nid: "PBI-1"\nstatus: Backlog\n---\n# X\nPlano: a escrever\n', planoMd: null }], entregas: [] }], OPC);
  assert.equal(r.totais.previsao.ritmoS, null);
  assert.equal(r.totais.previsao.medida, null);
  assert.equal(r.totais.previsao.estimada, null);
  assert.match(String(r.totais.previsao.motivo), /ritmo/);
  assert.equal(r.totais.pct, null); // nenhum PBI na conta: "?" e não 0 %
});

test('plano-md-casa-id-numerico: no plano .md, a task "1" do diário é a "### Task 1:" (T1)', () => {
  const ev = (seq: number, mm: string, tipo: string, dados: Record<string, unknown>): Evento =>
    ({ seq, ts: `2026-11-10T10:${mm}:00.000Z`, autor: 'a', sessao: 's', agente: 'orquestrador', tipo, dados, hash_anterior: null }) as Evento;
  const eventos = [ev(1, '00', 'task.iniciada', { task: '1', papel: 'implementador' }), ev(2, '10', 'task.concluida', { task: '1' }),
    ev(3, '20', 'review.veredito', { task: '1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }), ev(4, '30', 'task.integrada', { task: '1' })];
  const r = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-8.md', texto: '---\nid: "PBI-8"\nstatus: Em execução\n---\n# X\nPlano: `p.md`\n', planoMd: '### Task 1: a\n### Task 2: b\n' }],
    entregas: [{ id: 'PBI-8', plano: null, eventos }] }], OPC);
  assert.deepEqual(linha(r, 'PBI-8').tasks, { total: 2, integradas: 1, estimadas: 0, restantes: 1, fora: 0 });
});

test('feito-sem-plano-e-diario-ilegivel: PBI feito sem plano não entra na estimada; diário ilegível vira aviso', () => {
  const e = projetoCompleto();
  const arvores = ler(['/FIX/principal', '/FIX/wt-pbi-2']);
  arvores[0].cards.push({ arquivo: 'PBI-9.md', texto: '---\nid: "PBI-9"\nstatus: Concluído\n---\n# Antigo\nPlano: a escrever\n', planoMd: null });
  arvores[1].entregas.push({ id: 'PBI-3', plano: null, eventos: null });
  const r = projetarProjeto(arvores, OPC);
  assert.equal(linha(r, 'PBI-9').texto, 'feito, sem plano');
  assert.equal(r.totais.foraDaConta, e.totais.foraDaConta + 1);
  assert.equal(r.totais.previsao.estimada?.pbisSemPlano, 3, 'o feito sem plano não é trabalho a estimar');
  assert.deepEqual(r.avisos, ['PBI-3: diário ilegível em /FIX/wt-pbi-2']);
});

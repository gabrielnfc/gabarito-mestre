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
 * Emenda 19 (aprovada, D-G13, .claude-tmp/gm15r/emenda-t31c.md):
 *  M25 plano.json da 1ª árvore, sem olhar o commit                             ⇒ plano-vigente-e-o-de-commit-mais-recente
 *  M26 empate de commit vence a outra árvore                                   ⇒ plano-vigente-e-o-de-commit-mais-recente
 *  M27 árvore sem git perde para a de commit                                   ⇒ plano-vigente-e-o-de-commit-mais-recente
 *  M28 tasks estimadas dos PBIs sem plano entram no total do %                 ⇒ pbi-sem-plano-fora-do-pct
 *  M29 número estimado sem "~"                                                 ⇒ previsao-estima-pbi-sem-plano-com-til
 * Variantes a/b/c (M11, M12, M13, M14) e o roteiro: .claude-tmp/t31/mut.mjs (fora do repo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardDe, colunasFl1, ehColunaFl1, ehFeito, ehTerminal, planoMdDoCard, projetarProjeto, ROTULO_FASE_NAO_MEDIDA, ROTULO_FORA_DO_LOOP, rotuloAgente, rotuloFase, tasksDoPlanoMd, terminaisValidos, worktreesDe,
} from '../src/projeto.ts';
import type { ArvoreLida, EstadoProjeto, LinhaProjeto } from '../src/projeto.ts';
import type { Evento } from '../src/tipos.ts';
import { arvore as arvoreAdotado } from './painel-fixtures/adotado.mjs';

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
function projetoCompleto(extra: Record<string, unknown> = {}): EstadoProjeto {
  const wt = worktreesDe({ ok: true, saida: PORCELANA }, '/FIX/principal');
  return projetarProjeto(ler(wt.caminhos), { ...OPC, ...extra, avisos: wt.aviso === null ? [] : [wt.aviso] });
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
  // totais (GM-20 D-G42): PBI-1 (feito, plano .md, 3 estimadas) sai das duas pontas; sobram PBI-2 (1 de 3) + PBI-4 (2 de 3): 3 medidas de 6
  assert.equal(e.totais.tasks, 6);
  assert.equal(e.totais.integradas, 3);
  assert.equal(e.totais.estimadas, 0);
  assert.equal(e.totais.restantes, 3);
  assert.equal(e.totais.pct, 50);
  assert.equal(e.totais.pctComEstimadas, 50);
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
  assert.deepEqual(c, { id: 'PBI-4', status: 'Em execução', titulo: 'Hoje', atualizadoEm: '2026-11-03', planoMd: 'planos/pbi-4.md', epic: null });
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

test('plano-md-formatos-aceitos: 2 níveis x separadores, espaço antes, id com letra, T<id>, anotação', () => {
  for (const h of ['##', '###']) {
    for (const sep of [':', ' :', '—', ' —', '–', ' –', ' - ']) {
      assert.deepEqual(tasksDoPlanoMd(`${h} Task 1${sep} a\n${h} Task 0b${sep} b\n`), ['T1', 'T0b'], `${h} Task N${JSON.stringify(sep)}`);
    }
    for (const sep of [':', ' —', '–', ' - ']) assert.deepEqual(tasksDoPlanoMd(`${h} T3${sep} a\n${h} T0b${sep} b\n`), ['T3', 'T0b'], `${h} T<id>${JSON.stringify(sep)}`);
  }
  assert.deepEqual(tasksDoPlanoMd('## Task 4 (x) — a\n## Task 5 _(y)_ — b\n### Task 6 *(z)* : c\n### Task 7 (w): d\n'), ['T4', 'T5', 'T6', 'T7']);
});

test('plano-md-nao-casa: cada caso de (b)', () => {
  const nao = ['# Task 1: a', '#### Task 1: a', '  ### Task 1: a', '## Tasks', '### Task Breakdown', '### Task 1.1: a', '### T1.1: a', '### Task 1 a', '### Task 1',
    '### Task 1 (x)', '### T', '### T: a', '## Task 1 depende da Task 2 — x', '## T1 depende — x', '## 3. Visão', '## 3.', '### T3 (x) — a', '### T3 _(x)_: a',
    '### Task 4 (x) (y) — a', '### Task 4 texto (x) — a', '### Task 1.1 — a', '###Task 1: a', '###  Task 1: a', '### Task 1  : a', '### task 1: a', '### t1: a', '### Task 1-: a'];
  for (const l of nao) assert.deepEqual(tasksDoPlanoMd(`${l}\n`), [], JSON.stringify(l));
  assert.deepEqual(tasksDoPlanoMd('#### Task 9: não\n'), []);
});

test('plano-md-bloco-cercado: ``` e ~~~; ~~~ não fecha ```', () => {
  assert.deepEqual(tasksDoPlanoMd('### Task 1: a\n```\n### Task 2: x\n```\n### Task 3: b\n'), ['T1', 'T3']);
  assert.deepEqual(tasksDoPlanoMd('### Task 1: a\n~~~\n### Task 2: x\n~~~\n### Task 3: b\n'), ['T1', 'T3']);
  assert.deepEqual(tasksDoPlanoMd('### Task 1: a\n```\n### Task 2: x\n~~~\n### Task 4: y\n```\n### Task 3: b\n'), ['T1', 'T3']);
  assert.deepEqual(tasksDoPlanoMd('### Task 1: a\n~~~\n### Task 2: x\n```\n### Task 4: y\n~~~\n### Task 3: b\n'), ['T1', 'T3']);
  assert.deepEqual(tasksDoPlanoMd('```md\n### Task 2: x\n```\n### Task 3: b\n'), ['T3']);
});

test('plano-md-id-repetido-conta-1: vale a 1ª; T<id> e Task <id> são o mesmo id', () => {
  assert.deepEqual(tasksDoPlanoMd('### Task 1: a\n### Task 2: b\n### Task 1: c\n## T2 — d\n'), ['T1', 'T2']);
});

test('plano-md-diario-casa-id-com-letra: diário com task "T0b" integra a linha', () => {
  const ev = (seq: number, mm: string, tipo: string, dados: Record<string, unknown>): Evento =>
    ({ seq, ts: `2026-11-10T10:${mm}:00.000Z`, autor: 'a', sessao: 's', agente: 'orquestrador', tipo, dados, hash_anterior: null }) as Evento;
  const eventos = [ev(1, '00', 'task.iniciada', { task: 'T0b', papel: 'implementador' }), ev(2, '10', 'task.concluida', { task: 'T0b' }),
    ev(3, '20', 'review.veredito', { task: 'T0b', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }), ev(4, '30', 'task.integrada', { task: 'T0b' })];
  const r = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-8.md', texto: '---\nid: "PBI-8"\nstatus: Em execução\n---\n# X\nPlano: `p.md`\n', planoMd: '## Task 0b — a\n## Task 1 — b\n' }],
    entregas: [{ id: 'PBI-8', plano: null, eventos }] }], OPC);
  assert.deepEqual(linha(r, 'PBI-8').tasks, { total: 2, integradas: 1, estimadas: 0, restantes: 1, fora: 0 });
  // id do diário sem o T ("0b"), como o numérico "1", também casa (norm aceita a letra)
  const semT = eventos.map((e) => ({ ...e, dados: { ...(e.dados ?? {}), task: 'task' in (e.dados ?? {}) ? '0b' : undefined } }) as Evento);
  const r2 = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-8.md', texto: '---\nid: "PBI-8"\nstatus: Em execução\n---\n# X\nPlano: `p.md`\n', planoMd: '## Task 0b — a\n## Task 1 — b\n' }],
    entregas: [{ id: 'PBI-8', plano: null, eventos: semT }] }], OPC);
  assert.equal(linha(r2, 'PBI-8').tasks?.integradas, 1);
});

test('feito-sem-plano-e-diario-ilegivel: PBI feito sem plano não entra na estimada; diário ilegível vira aviso', () => {
  const e = projetoCompleto();
  const arvores = ler(['/FIX/principal', '/FIX/wt-pbi-2']);
  arvores[0].cards.push({ arquivo: 'PBI-9.md', texto: '---\nid: "PBI-9"\nstatus: Concluído\n---\n# Antigo\nPlano: a escrever\n', planoMd: null });
  arvores[1].entregas.push({ id: 'PBI-3', plano: null, eventos: null });
  const r = projetarProjeto(arvores, OPC);
  assert.equal(linha(r, 'PBI-9').texto, 'feito, sem plano');
  assert.equal(r.totais.foraDaConta, e.totais.foraDaConta, 'GM-20 REQ-PCT-3: o feito sem plano (PBI-9) não entra em foraDaConta, só os abertos');
  assert.equal(r.totais.previsao.estimada?.pbisSemPlano, 3, 'o feito sem plano não é trabalho a estimar');
  assert.deepEqual(r.avisos, ['PBI-3: diário ilegível em /FIX/wt-pbi-2']);
});

test('plano-vigente-e-o-de-commit-mais-recente: entre worktrees vale o plano.json de commit mais recente; empate ou sem git ⇒ árvore atual', () => {
  const pl = (ids: string[]): { ok: true; bruto: unknown } => ({ ok: true, bruto: { entrega: 'GM-9', tasks: ids.map((id) => ({ id, titulo: id, deps: [], arquivos: [`${id}.ts`] })) } });
  const arv = (cAtual: number | null, cOutra: number | null): ArvoreLida[] => [
    { caminho: '/atual', cards: [], entregas: [{ id: 'GM-9', plano: pl(['T1']), planoCommitMs: cAtual, eventos: [] }] },
    { caminho: '/outra', cards: [], entregas: [{ id: 'GM-9', plano: pl(['T1', 'T2', 'T3']), planoCommitMs: cOutra, eventos: [] }] }];
  const total = (a: ArvoreLida[]): number | undefined => linha(projetarProjeto(a, OPC), 'GM-9').tasks?.total;
  assert.equal(total(arv(1000, 2000)), 3, 'commit mais recente na outra árvore vence');
  assert.equal(linha(projetarProjeto(arv(1000, 2000), OPC), 'GM-9').origem, '/outra');
  assert.equal(total(arv(3000, 2000)), 1);
  assert.equal(total(arv(2000, 2000)), 1, 'empate ⇒ árvore atual');
  assert.equal(total(arv(null, 2000)), 1, 'sem git ⇒ árvore atual');
  assert.equal(total(arv(1000, null)), 1, 'sem git ⇒ árvore atual');
});

test('pbi-sem-plano-fora-do-pct: as tasks estimadas dos PBIs sem plano não entram no % nem no total de tasks', () => {
  const e = projetoCompleto();
  assert.ok(e.totais.previsao.estimada !== null); // há estimativa (3 PBIs sem plano)…
  assert.equal(e.totais.tasks, 6); // …mas o % é só dos PBIs com plano (GM-20: o .md concluído de PBI-1 também sai)
  assert.equal(e.totais.restantes, 3);
  assert.equal(e.totais.pct, 50);
  assert.equal(e.totais.pctComEstimadas, 50);
});

test('previsao-estima-pbi-sem-plano-com-til: tasks estimadas = mediana × PBIs sem plano não concluídos; número com "~" e rotulado estimado', () => {
  const est = projetoCompleto().totais.previsao.estimada;
  assert.ok(est !== null);
  assert.equal(est.tasks, 9); // mediana 3 × 3 PBIs sem plano abertos
  assert.match(est.texto, /^~9 tasks estimadas/);
  assert.match(est.texto, /estimad/);
  assert.match(est.texto, new RegExp(`~${est.hora}`));
  assert.doesNotMatch(est.texto, /[`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b/); // REQ-LNG-1
});

// ---------- REQ-PRJ-2: status fora do quadro FL1 é opção (só com a chave ligada, D-G27) ----------

const LIGA = { opcoesComoContagem: true };
const cartao = (id: string, status: string | null, plano = 'a escrever'): { arquivo: string; texto: string; planoMd: string | null } =>
  ({ arquivo: `${id}.md`, texto: `---\nid: "${id}"\n${status === null ? '' : `status: ${status}\n`}---\n# Sintético ${id}\nPlano: ${plano}\n`, planoMd: null });
const soCards = (...cards: Array<ReturnType<typeof cartao>>): ArvoreLida[] => [{ caminho: '/r', cards, entregas: [] }];
const evTask = (seq: number, tipo: string, dados: Record<string, unknown>): Evento =>
  ({ seq, ts: `2026-11-10T10:0${seq}:00.000Z`, autor: 'a', sessao: 's', agente: 'orquestrador', tipo, dados, hash_anterior: null }) as Evento;

test('opcao-nao-vira-linha: chave ligada, status "Backlog" ⇒ 0 linhas, opcoes 1, fora de pbis/feitos/foraDaConta', () => {
  const e = projetarProjeto(soCards(cartao('PBI-1', 'Backlog')), { ...OPC, ...LIGA });
  assert.deepEqual(e.linhas, []);
  assert.equal(e.totais.opcoes, 1);
  assert.equal(e.totais.pbis, 0);
  assert.equal(e.totais.feitos, 0);
  assert.equal(e.totais.foraDaConta, 0);
  const duas = projetarProjeto(soCards(cartao('PBI-1', 'Backlog'), cartao('PBI-2', 'Ideia'), cartao('PBI-3', 'Em execução')), { ...OPC, ...LIGA });
  assert.deepEqual(duas.linhas.map((l) => l.id), ['PBI-3']);
  assert.equal(duas.totais.opcoes, 2);
  assert.equal(duas.totais.pbis, 1);
});

test('diario-ilegivel-nao-esconde-opcao: chave ligada, {plano:null, eventos:null} ⇒ o card segue linha, com aviso de diário ilegível', () => {
  const arv: ArvoreLida[] = [{ caminho: '/r', cards: [cartao('PBI-1', 'Backlog')], entregas: [{ id: 'PBI-1', plano: null, eventos: null }] }];
  const e = projetarProjeto(arv, { ...OPC, ...LIGA });
  assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1']);
  assert.equal(e.totais.opcoes, 0);
  assert.equal(e.totais.pbis, 1);
  assert.ok(e.avisos.some((a) => /PBI-1.*diário ilegível/.test(a)), JSON.stringify(e.avisos));
});

test('chave-desligada-backlog-e-linha: mesmo card, chave ausente ou false ⇒ 1 linha, opcoes 0', () => {
  for (const opc of [OPC, { ...OPC, opcoesComoContagem: false }]) {
    const e = projetarProjeto(soCards(cartao('PBI-1', 'Backlog')), opc);
    assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1']);
    assert.equal(e.linhas[0].status, 'Backlog');
    assert.equal(e.totais.opcoes, 0);
    assert.equal(e.totais.pbis, 1);
    assert.equal(e.totais.foraDaConta, 1);
  }
});

test('chave-so-true-liga: "true", 1, null, undefined, "" ⇒ desligada', () => {
  for (const v of ['true', 1, null, undefined, '', 'sim', {}, [true]]) {
    const e = projetarProjeto(soCards(cartao('PBI-1', 'Backlog')), { ...OPC, opcoesComoContagem: v as unknown as boolean });
    assert.equal(e.linhas.length, 1, JSON.stringify(v));
    assert.equal(e.totais.opcoes, 0, JSON.stringify(v));
  }
  assert.equal(projetarProjeto(soCards(cartao('PBI-1', 'Backlog')), { ...OPC, opcoesComoContagem: true }).totais.opcoes, 1);
});

test('opcao-fora-do-pct: a opção não entra em pbis, feitos, tasks nem %; os totais são os de quando o card não existe', () => {
  const comPlano = { arquivo: 'PBI-1.md', texto: '---\nid: "PBI-1"\nstatus: Em execução\n---\n# X\nPlano: `p.md`\n', planoMd: '### Task 1: a\n### Task 2: b\n' };
  const sem = projetarProjeto([{ caminho: '/r', cards: [comPlano], entregas: [{ id: 'PBI-1', plano: null, eventos: [evTask(1, 'task.iniciada', { task: '1', papel: 'implementador' })] }] }], { ...OPC, ...LIGA });
  const com = projetarProjeto([{ caminho: '/r', cards: [comPlano, cartao('PBI-2', 'Backlog', '`q.md`'), cartao('PBI-3', 'Concluído')], entregas: [{ id: 'PBI-1', plano: null, eventos: [evTask(1, 'task.iniciada', { task: '1', papel: 'implementador' })] }] }], { ...OPC, ...LIGA });
  assert.equal(com.totais.opcoes, 1);
  assert.equal(com.totais.pbis, sem.totais.pbis + 1); // só o PBI-3 "Concluído" (coluna) a mais
  assert.equal(com.totais.feitos, 1);
  assert.equal(com.totais.tasks, sem.totais.tasks);
  assert.equal(com.totais.integradas, sem.totais.integradas);
  assert.equal(com.totais.restantes, sem.totais.restantes);
  assert.equal(com.totais.pct, sem.totais.pct);
  assert.deepEqual(com.linhas.map((l) => l.id), ['PBI-1', 'PBI-3']);
});

test('status-da-config-vale: chave ligada, config Jira: "To Do" e "Done" são colunas; o padrão "Preparado" vira opção', () => {
  const cfg = { preparado: 'To Do', em_execucao: 'In Progress', concluido: 'Done' };
  const e = projetarProjeto(soCards(cartao('PBI-1', 'To Do'), cartao('PBI-2', ' in progress '), cartao('PBI-3', 'Done'), cartao('PBI-4', 'Pronto para liberar'), cartao('PBI-5', 'preparado')),
    { ...OPC, ...LIGA, statusFl1: cfg });
  assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-5']); // a chave `preparado` também é coluna
  assert.equal(e.totais.opcoes, 1); // PBI-4 "Pronto para liberar": o nome padrão não vale com a config (nem a chave `pronto` está nela)
  assert.equal(linha(e, 'PBI-3').status, 'Done');
});

test('sem-config-usa-fluxo-md: sem fluxo.status.FL1 legível valem os 5 nomes e as 5 chaves; sem acento, caixa nem espaço nas pontas', () => {
  const ok = ['Preparado', 'Em execução', 'Revisão e teste', 'Pronto para liberar', 'Concluído', 'preparado', 'em_execucao', 'revisao', 'pronto', 'concluido', '  EM EXECUCAO ', 'concluído'];
  for (const cfg of [undefined, null, {}, 'x', [], { a: 1, b: null }, { a: '  ' }]) {
    const cards = ok.map((st, i) => cartao(`PBI-${i + 1}`, st));
    const e = projetarProjeto(soCards(...cards, cartao('PBI-90', 'Backlog')), { ...OPC, ...LIGA, statusFl1: cfg });
    assert.equal(e.linhas.length, ok.length, JSON.stringify(cfg));
    assert.equal(e.totais.opcoes, 1, JSON.stringify(cfg));
  }
  assert.equal(ehColunaFl1('Backlog'), false);
  assert.equal(ehColunaFl1('Concluído'), true);
  assert.equal(ehColunaFl1('Done', { concluido: 'Done' }), true);
  assert.equal(ehColunaFl1('Pronto para liberar', { concluido: 'Done' }), false);
  assert.equal(ehColunaFl1('Concluído', { concluido: 'Done' }), true); // a chave também é coluna
  assert.deepEqual([...colunasFl1({ concluido: 'Done', x: 3 })].sort(), ['concluido', 'done']);
});

test('opcao-com-diario-vira-linha: status de opção com plano.json OU evento de task vira linha (a medição vence o card); evento sem task não', () => {
  const plano = { ok: true as const, bruto: { entrega: 'PBI-1', tasks: [{ id: 'T1', titulo: 'a', deps: [], arquivos: ['a.ts'] }] } };
  const arv: ArvoreLida[] = [{ caminho: '/r', cards: [cartao('PBI-1', 'Backlog'), cartao('PBI-2', 'Backlog'), cartao('PBI-3', 'Backlog'), cartao('PBI-4', 'Backlog')], entregas: [
    { id: 'PBI-1', plano, eventos: [] },
    { id: 'PBI-2', plano: null, eventos: [evTask(1, 'task.iniciada', { task: 'T1', papel: 'implementador' })] },
    { id: 'PBI-3', plano: null, eventos: [evTask(1, 'entrega.iniciada', {})] },
  ] }];
  const e = projetarProjeto(arv, { ...OPC, ...LIGA });
  assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1', 'PBI-2']);
  assert.equal(e.totais.opcoes, 2); // PBI-3 (diário sem task) e PBI-4 (sem entrega)
  assert.equal(linha(e, 'PBI-1').plano, 'json');
  assert.equal(linha(e, 'PBI-1').status, 'Backlog');
});

test('card-sem-status-nunca-e-opcao: com a chave ligada e desligada o card sem status segue linha', () => {
  for (const opc of [OPC, { ...OPC, ...LIGA }]) {
    const e = projetarProjeto(soCards(cartao('PBI-1', null)), opc);
    assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1']);
    assert.equal(linha(e, 'PBI-1').status, null);
    assert.equal(e.totais.opcoes, 0);
    assert.equal(e.totais.pbis, 1);
  }
});

test('fixture-gm15-com-chave: chave ligada sobre a fixture da GM-15 ⇒ PBI-1, 2, 4 e 6 linhas; PBI-3 e PBI-5 opções; só o PBI-6 fora da conta e da estimada', () => {
  const e = projetoCompleto(LIGA);
  assert.deepEqual(e.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-4', 'PBI-6']);
  assert.equal(e.totais.opcoes, 2);
  assert.equal(e.totais.pbis, 4);
  assert.equal(e.totais.foraDaConta, 1);
  assert.deepEqual(e.linhas.filter((l) => l.semPlano).map((l) => l.id), ['PBI-6']);
  assert.equal(e.totais.previsao.estimada?.pbisSemPlano, 1);
  // desligada: a fixture segue igual (regressão)
  const off = projetoCompleto();
  assert.equal(off.totais.opcoes, 0);
  assert.equal(off.linhas.length, 6);
  assert.equal(off.totais.previsao.estimada?.pbisSemPlano, 3);
});

test('opcao-fora-da-previsao-estimada: com a chave ligada a opção sem plano não entra na estimada; desligada vale a D-G13 literal', () => {
  const wt = worktreesDe({ ok: true, saida: PORCELANA }, '/FIX/principal');
  const comExtra = (): ArvoreLida[] => { const a = ler(wt.caminhos); a[0].cards.push(cartao('PBI-7', 'Backlog')); return a; };
  const base = projetoCompleto(LIGA).totais.previsao.estimada;
  assert.ok(base !== null);
  const ligada = projetarProjeto(comExtra(), { ...OPC, ...LIGA }).totais.previsao.estimada;
  assert.ok(ligada !== null);
  assert.equal(ligada.pbisSemPlano, 1);
  assert.equal(ligada.tasks, base.tasks);
  assert.equal(ligada.restanteS, base.restanteS);
  assert.equal(ligada.texto, base.texto);
  const desligada = projetarProjeto(comExtra(), OPC).totais.previsao.estimada;
  assert.ok(desligada !== null);
  assert.equal(desligada.pbisSemPlano, 4); // PBI-3, PBI-5, PBI-6 e o PBI-7 "Backlog"
  assert.ok(desligada.restanteS > ligada.restanteS);
});

// ---------- REQ-PRJ-3 (a, b, c, f): núcleo dos feitos e do Epic (T3) ----------

const FM = { tipo: 'frontmatter', nome: 'epic' };
const cardEpic = (id: string, status: string, epic: string | null, chave = 'epic'): { arquivo: string; texto: string; planoMd: string | null } =>
  ({ arquivo: `${id}.md`, texto: `---\nid: "${id}"\nstatus: ${status}\n${epic === null ? '' : `${chave}: ${epic}\n`}---\n# Sintético ${id}\nPlano: a escrever\n`, planoMd: null });
const comEpics = (cards: Array<ReturnType<typeof cartao>>, extra: Record<string, unknown> = {}): EstadoProjeto =>
  projetarProjeto(soCards(...cards), { ...OPC, vinculo: FM, ...extra } as Parameters<typeof projetarProjeto>[1]);
const idsDe = (e: EstadoProjeto): string[][] => e.grupos.map((g) => g.ids);

test('carde-epic: Card.epic lê a chave do frontmatter; sem chave é null; chave com dígito, hífen e _', () => {
  const t = (extra: string): string => `---\nid: "PBI-1"\nstatus: Backlog\n${extra}---\n# X\n`;
  assert.equal(cardDe('a.md', t('epic: "EPIC-2"\n'))?.epic, 'EPIC-2');
  assert.equal(cardDe('a.md', t(''))?.epic, null);
  assert.equal(cardDe('a.md', t('epic:\n'))?.epic, null);
  assert.equal(cardDe('a.md', t('epico_2-x: EPIC-9\n'), undefined, 'epico_2-x')?.epic, 'EPIC-9');
  assert.equal(cardDe('a.md', t('epic: EPIC-2\n'), undefined, 'outra')?.epic, null);
  assert.equal(cardDe('a.md', t('epic: EPIC-2\n'), undefined, null)?.epic, null);
});

test('agrupa-com-2-epics: abertos em 2 Epics ⇒ 2 grupos, ordem pelo menor ID aberto; LinhaProjeto.epic lido', () => {
  const e = comEpics([cardEpic('PBI-1', 'Em execução', 'EPIC-B'), cardEpic('PBI-2', 'Em execução', 'EPIC-A'), cardEpic('PBI-3', 'Backlog', 'EPIC-B')]);
  assert.deepEqual(e.grupos.map((g) => g.epic), ['EPIC-B', 'EPIC-A']);
  assert.deepEqual(idsDe(e), [['PBI-1', 'PBI-3'], ['PBI-2']]);
  assert.deepEqual(e.grupos.map((g) => g.abertos), [2, 1]);
  assert.deepEqual(e.linhas.map((l) => l.epic), ['EPIC-B', 'EPIC-A', 'EPIC-B']);
});

test('um-epic-nao-agrupa: 1 Epic, ou 1 Epic + feitos de outro Epic, ou só "sem Epic" ⇒ grupos vazio', () => {
  assert.deepEqual(comEpics([cardEpic('PBI-1', 'Em execução', 'EPIC-A'), cardEpic('PBI-2', 'Backlog', 'EPIC-A')]).grupos, []);
  assert.deepEqual(comEpics([cardEpic('PBI-1', 'Em execução', 'EPIC-A'), cardEpic('PBI-2', 'Concluído', 'EPIC-B')]).grupos, []);
  assert.deepEqual(comEpics([cardEpic('PBI-1', 'Em execução', null), cardEpic('PBI-2', 'Backlog', null)]).grupos, []);
  assert.deepEqual(comEpics([]).grupos, []);
  assert.equal(comEpics([cardEpic('PBI-1', 'Em execução', 'EPIC-A')]).linhas[0].epic, 'EPIC-A');
});

test('vinculo-mcp-nao-agrupa: vínculo MCP, ausente ou inválido ⇒ sem grupos e epic null, mesmo com a chave no card', () => {
  const cards = [cardEpic('PBI-1', 'Em execução', 'EPIC-A'), cardEpic('PBI-2', 'Em execução', 'EPIC-B')];
  for (const vinculo of [{ tipo: 'mcp', nome: 'epic' }, undefined, null, 'frontmatter', { nome: 'epic' }]) {
    const e = projetarProjeto(soCards(...cards), { ...OPC, vinculo } as Parameters<typeof projetarProjeto>[1]);
    assert.deepEqual(e.grupos, [], JSON.stringify(vinculo));
    assert.deepEqual(e.linhas.map((l) => l.epic), [null, null], JSON.stringify(vinculo));
  }
  assert.equal(comEpics(cards).grupos.length, 2);
});

test('epic-chave-da-config: `nome` do vínculo escolhe a chave; nome ausente ou inválido ⇒ "epic"; a chave "epic" some quando nome é outro', () => {
  const cards = [cardEpic('PBI-1', 'Em execução', 'E-1', 'pai'), cardEpic('PBI-2', 'Em execução', 'E-2', 'pai')];
  const e = comEpics(cards, { vinculo: { tipo: 'frontmatter', nome: 'pai' } });
  assert.deepEqual(e.grupos.map((g) => g.epic), ['E-1', 'E-2']);
  assert.deepEqual(comEpics(cards).grupos, []); // nome padrão "epic": os cards usam "pai"
  const pad = [cardEpic('PBI-1', 'Em execução', 'E-1'), cardEpic('PBI-2', 'Em execução', 'E-2')];
  for (const nome of [undefined, '', 7, '9x', 'a b']) {
    assert.equal(comEpics(pad, { vinculo: { tipo: 'frontmatter', nome } }).grupos.length, 2, String(nome));
  }
});

test('sem-epic-por-ultimo: o grupo "sem Epic" fica no fim, mesmo com o menor ID; títulos vêm de titulosEpic', () => {
  const e = comEpics([cardEpic('PBI-1', 'Em execução', null), cardEpic('PBI-2', 'Em execução', 'EPIC-1'), cardEpic('PBI-3', 'Backlog', 'EPIC-2')],
    { titulosEpic: { 'EPIC-1': 'Primeiro' } });
  assert.deepEqual(e.grupos.map((g) => g.epic), ['EPIC-1', 'EPIC-2', null]);
  assert.deepEqual(e.grupos.map((g) => g.titulo), ['Primeiro', null, null]);
  assert.deepEqual(idsDe(e), [['PBI-2'], ['PBI-3'], ['PBI-1']]);
});

test('feitos-contados-para-recolher: o núcleo mantém a linha do feito (feito true) e conta; feito fica fora dos grupos', () => {
  const e = comEpics([cardEpic('PBI-1', 'Concluído', 'EPIC-A'), cardEpic('PBI-2', 'Em execução', 'EPIC-A'), cardEpic('PBI-3', 'Concluído', null), cardEpic('PBI-4', 'Backlog', 'EPIC-B')]);
  assert.equal(e.totais.feitos, 2);
  assert.deepEqual(e.linhas.map((l) => [l.id, l.feito]), [['PBI-1', true], ['PBI-2', false], ['PBI-3', true], ['PBI-4', false]]);
  assert.deepEqual(idsDe(e), [['PBI-2'], ['PBI-4']]);
  assert.deepEqual(e.grupos.map((g) => g.abertos), [1, 1]);
  assert.equal(projetoCompleto().totais.feitos, 1);
});

test('feito-pela-config: config Jira "Done" e card "Concluído": os dois feitos, chave ausente; status aberto segue aberto', () => {
  const statusFl1 = { preparado: 'To Do', em_execucao: 'In Progress', concluido: 'Done' };
  const e = projetarProjeto(soCards(cartao('PBI-1', 'Done'), cartao('PBI-2', 'Concluído'), cartao('PBI-3', 'In Progress'), cartao('PBI-4', 'done '), cartao('PBI-5', null)), { ...OPC, statusFl1 });
  assert.deepEqual(e.linhas.map((l) => [l.id, l.feito]), [['PBI-1', true], ['PBI-2', true], ['PBI-3', false], ['PBI-4', true], ['PBI-5', false]]);
  assert.equal(e.totais.feitos, 3);
  assert.equal(e.totais.opcoes, 0);
  const sem = projetarProjeto(soCards(cartao('PBI-1', 'Done'), cartao('PBI-2', 'Concluído')), OPC);
  assert.deepEqual(sem.linhas.map((l) => l.feito), [false, true]); // sem config, só o fixo
});

test('ehfeito: concluido da config OU o fixo, sem acento nem caixa; nulo, vazio e config ilegível não são feito', () => {
  assert.equal(ehFeito('Done', { concluido: 'Done' }), true);
  assert.equal(ehFeito('DONE ', { concluido: 'done' }), true);
  assert.equal(ehFeito('Concluído', { concluido: 'Done' }), true);
  assert.equal(ehFeito('concluido', undefined), true);
  assert.equal(ehFeito('Concluído', null), true);
  assert.equal(ehFeito('Done', undefined), false);
  assert.equal(ehFeito('Done', { concluido: 7 }), false);
  assert.equal(ehFeito('Done', { concluido: '' }), false);
  assert.equal(ehFeito('', { concluido: '' }), false);
  assert.equal(ehFeito(null, { concluido: 'Done' }), false);
  assert.equal(ehFeito('In Progress', { concluido: 'Done' }), false);
  assert.equal(ehFeito('Done', ['Done']), false);
});

test('feito-por-encerrada-com-config: entrega.encerrada segue fazendo o PBI feito com statusFl1 presente', () => {
  const ev = (seq: number, tipo: string): Evento => evTask(seq, tipo, { entrega: 'PBI-1' });
  const e = projetarProjeto([{ caminho: '/r', cards: [cartao('PBI-1', 'In Progress')], entregas: [{ id: 'PBI-1', plano: null, eventos: [ev(1, 'entrega.encerrada')] }] }],
    { ...OPC, statusFl1: { concluido: 'Done' } });
  assert.equal(e.linhas[0].feito, true);
});

test('epic-e-feito-entre-arvores: vale o card mais novo (Epic e status); diário ilegível na secundária não desfaz o feito da principal', () => {
  const c = (id: string, status: string, epic: string, em: string): { arquivo: string; texto: string; planoMd: string | null } =>
    ({ arquivo: `${id}.md`, texto: `---\nid: "${id}"\nstatus: ${status}\nepic: ${epic}\natualizadoEm: "${em}"\n---\n# S\n`, planoMd: null });
  const e = projetarProjeto([
    { caminho: '/a', cards: [c('PBI-1', 'Em execução', 'EPIC-A', '2026-11-01'), c('PBI-2', 'Em execução', 'EPIC-A', '2026-11-01')], entregas: [] },
    { caminho: '/b', cards: [c('PBI-1', 'Em execução', 'EPIC-B', '2026-11-05')], entregas: [] },
  ], { ...OPC, vinculo: FM });
  assert.deepEqual(e.linhas.map((l) => l.epic), ['EPIC-B', 'EPIC-A']);
  assert.deepEqual(idsDe(e), [['PBI-1'], ['PBI-2']]);
  const enc: Evento = evTask(1, 'entrega.encerrada', { entrega: 'PBI-3' });
  const f = projetarProjeto([
    { caminho: '/a', cards: [cartao('PBI-3', 'Em execução')], entregas: [{ id: 'PBI-3', plano: null, eventos: [enc] }] },
    { caminho: '/b', cards: [], entregas: [{ id: 'PBI-3', plano: null, eventos: null }] },
  ], OPC);
  assert.equal(f.linhas[0].feito, true);
  assert.equal(f.totais.feitos, 1);
  assert.ok(f.avisos.some((a) => /PBI-3.*ilegível.*\/b/.test(a)));
});

// ───────────────────────────── GM-20 T1 (D-G42, DT1, DT2): % do projeto sem misturar denominadores. Fixture comum: painel-fixtures/adotado.mjs
// Mutações: MP1-a voltar a somar o .md concluído nos totais ⇒ tasks 11 em vez de 8 (pct-concluido-sem-plano-json-fora-das-duas-pontas);
//           MP3-a tirar `&& !feito` de foraDaConta ⇒ sem-plano-conta-so-abertos.

/** A fixture adotada MAIS um PBI concluído com `plano.json` (2 tasks) e sem registro no diário: o caminho das estimadas (spec REQ-PCT-1, 2º Dado). */
function adotadoComEstimadas(): ArvoreLida {
  const a = arvoreAdotado() as ArvoreLida;
  a.cards.push({ arquivo: 'PBI-11.md', texto: '---\nid: "PBI-11"\ntipo: US\nstatus: Concluído\natualizadoEm: "2026-11-06"\n---\n# Concluído com plano.json\n', planoMd: null });
  a.entregas.push({ id: 'PBI-11', plano: { ok: true, bruto: { entrega: 'PBI-11', tasks: [{ id: 'T1', deps: [], arquivos: [] }, { id: 'T2', deps: [], arquivos: [] }] } }, eventos: [] });
  return a;
}

test('pct-concluido-sem-plano-json-fora-das-duas-pontas: concluído com plano .md fica fora de tasks, integradas e estimadas; a linha dele segue igual', () => {
  const e = projetarProjeto([arvoreAdotado() as ArvoreLida], OPC);
  const t = e.totais;
  assert.equal(t.tasks, 8, 'PBI-5 (4) + PBI-7 (2) + PBI-8 (2); os 3 do .md concluído de PBI-2 saem');
  assert.equal(t.integradas, 6);
  assert.equal(t.estimadas, 0);
  assert.equal(t.restantes, 2);
  assert.equal(t.pct, 75);
  assert.equal(t.pctComEstimadas, 75);
  const l2 = e.linhas.find((l) => l.id === 'PBI-2') as LinhaProjeto;
  assert.equal(l2.texto, 'feito (3 tasks estimadas)');
  assert.equal(l2.plano, 'md');
  assert.deepEqual(l2.tasks, { total: 3, integradas: 0, estimadas: 3, restantes: 0, fora: 0 });
  // concluído com plano.json sem registro no diário continua estimado (o caminho de hoje)
  const c = projetarProjeto([adotadoComEstimadas()], OPC).totais;
  assert.equal(c.tasks, 10);
  assert.equal(c.integradas, 6);
  assert.equal(c.estimadas, 2);
  assert.equal(c.pct, 60);
  assert.equal(c.pctComEstimadas, 80);
  // PBI-7 (concluído, plano.json, diário completo) segue medido
  assert.deepEqual((e.linhas.find((l) => l.id === 'PBI-7') as LinhaProjeto).tasks, { total: 2, integradas: 2, estimadas: 0, restantes: 0, fora: 0 });
  // a previsão não muda com o .md concluído: restantes 2 (só as tasks abertas)
  assert.equal(t.restantes, e.linhas.reduce((n, l) => n + (l.feito ? 0 : (l.tasks?.restantes ?? 0)), 0));
});

test('sem-plano-conta-so-abertos: foraDaConta são os abertos sem plano; os feitos sem plano saem dela; os terminais (PBI-4, PBI-10) nem são linha (T2)', () => {
  const e = projetarProjeto([arvoreAdotado() as ArvoreLida], OPC);
  const semPlano = e.linhas.filter((l) => l.semPlano);
  assert.deepEqual(semPlano.filter((l) => l.feito).map((l) => l.id), ['PBI-1', 'PBI-3'], 'a fixture tem 2 feitos sem plano');
  assert.deepEqual(semPlano.filter((l) => !l.feito).map((l) => l.id), ['PBI-6', 'PBI-9']);
  assert.equal(e.totais.foraDaConta, 2);
  assert.equal(e.totais.feitos, 4);
  assert.equal(e.totais.pbis, 8);
});

// ───────────────────────────── GM-20 T2 (DT5, REQ-TER-1/2, M8, M9): status terminal fora das contas. Fixture comum: painel-fixtures/adotado.mjs
// Mutações: MT1-a tirar o `continue` ⇒ status-terminal-fora · MT1-b testar a opção antes do terminal ⇒ status-terminal-fora · MT1-c terminal vence a medição ⇒ status-terminal-fora
//           MT2-a mesclar a config com o padrão ⇒ status-terminal-config · MT2-b igualdade exata em vez do 1º termo ⇒ status-terminal-config · MT2-c prefixo sem fronteira ⇒ status-terminal-config

const TOT_SEM_TERMINAIS = (a: ArvoreLida, opc: Record<string, unknown> = {}) => projetarProjeto([a], { ...OPC, ...opc });
const semCards = (a: ArvoreLida, ids: string[]): ArvoreLida => ({ ...a, cards: a.cards.filter((c) => !ids.some((i) => c.arquivo === `${i}.md`)) });
const evT = (seq: number, tipo: string, dados: Record<string, unknown>) => ({ seq, sessao: 's', hash_anterior: null, ts: `2026-11-09T10:0${seq}:00.000Z`, autor: 'x', agente: 'orquestrador', tipo, dados });

test('status-terminal-fora: Superado e Cancelado saem de linhas, pbis, %, restantes e previsão, com a chave de opções ligada ou não', () => {
  for (const opcoesComoContagem of [false, true]) {
    const e = TOT_SEM_TERMINAIS(arvoreAdotado() as ArvoreLida, { opcoesComoContagem });
    assert.equal(e.totais.pbis, 8, `opcoes=${opcoesComoContagem}`);
    assert.equal(e.totais.terminais, 2, `opcoes=${opcoesComoContagem}`);
    assert.equal(e.totais.opcoes, 0, 'terminal nunca é "opção" (M9)');
    assert.deepEqual(e.linhas.filter((l) => l.id === 'PBI-4' || l.id === 'PBI-10'), []);
    // igual a um projeto em que os 2 cards nem existem: % , restantes, previsão e foraDaConta não mudam
    const sem = TOT_SEM_TERMINAIS(semCards(arvoreAdotado() as ArvoreLida, ['PBI-4', 'PBI-10']), { opcoesComoContagem });
    assert.deepEqual({ ...e.totais, terminais: 0 }, sem.totais);
    assert.deepEqual(e.linhas, sem.linhas);
  }
  // o card que sai do terminal volta às contas pela regra comum (aberto sem plano), e o diário não o põe nem o tira
  const a = arvoreAdotado() as ArvoreLida;
  a.cards = a.cards.map((c) => (c.arquivo === 'PBI-4.md' ? { ...c, texto: c.texto.replace('Superado — dividido em PBI-5 e PBI-6', 'Em execução') } : c));
  const volta = projetarProjeto([a], OPC);
  assert.equal(volta.totais.pbis, 9);
  assert.equal(volta.totais.terminais, 1);
  assert.equal(volta.linhas.find((l) => l.id === 'PBI-4')?.texto, 'sem plano');
  const b = arvoreAdotado() as ArvoreLida;
  b.entregas.push({ id: 'PBI-10', plano: null, eventos: [evT(1, 'entrega.encerrada', { entrega: 'PBI-10', pr: 10, via: 'head' }), evT(2, 'entrega.reaberta', { entrega: 'PBI-10' })] });
  assert.equal(projetarProjeto([b], OPC).totais.terminais, 2, 'entrega.encerrada/reaberta não tiram do terminal');
});

test('status-terminal-fora: terminal com plano.json ou evento de task segue linha e avisa; só avisa quando medido', () => {
  for (const medicao of ['plano', 'task'] as const) {
    const a = arvoreAdotado() as ArvoreLida;
    const ent = medicao === 'plano'
      ? { id: 'PBI-4', plano: { ok: true as const, bruto: { entrega: 'PBI-4', tasks: [{ id: 'T1', deps: [], arquivos: [] }] } }, eventos: [] }
      : { id: 'PBI-4', plano: null, eventos: [evT(1, 'task.iniciada', { task: 'T1', papel: 'implementador' })] };
    a.entregas.push(ent as ArvoreLida['entregas'][number]);
    for (const opcoesComoContagem of [false, true]) {
      const e = projetarProjeto([a], { ...OPC, opcoesComoContagem });
      assert.ok(e.linhas.some((l) => l.id === 'PBI-4'), `${medicao}: segue linha`);
      assert.equal(e.totais.terminais, 1, `${medicao}: só o PBI-10 fica de fora`);
      assert.equal(e.totais.pbis, 9);
      assert.deepEqual(e.avisos.filter((x) => /terminal/.test(x)), ['PBI-4: status terminal com trabalho medido']);
    }
  }
  const sem = projetarProjeto([arvoreAdotado() as ArvoreLida], OPC).avisos;
  assert.deepEqual(sem.filter((x) => /terminal/.test(x)), [], 'sem medição não avisa');
});

test('status-terminal-config: a lista da config SUBSTITUI o padrão; inválida cai no padrão; casa o 1º termo, sem acento, caixa nem espaços', () => {
  const a = arvoreAdotado() as ArvoreLida;
  const so = projetarProjeto([a], { ...OPC, terminais: ['Arquivado'] });
  assert.equal(so.totais.terminais, 0, 'Superado e Cancelado voltam a ser abertos');
  assert.equal(so.totais.pbis, 10);
  const cancel = projetarProjeto([a], { ...OPC, terminais: ['cancelado'] });
  assert.equal(cancel.totais.terminais, 1);
  assert.ok(cancel.linhas.some((l) => l.id === 'PBI-4') && !cancel.linhas.some((l) => l.id === 'PBI-10'));
  assert.equal(projetarProjeto([a], { ...OPC, terminais: [] }).totais.terminais, 0, 'lista vazia vale e não deixa nada terminal');
  for (const ruim of ['Superado', 7, null, { a: 1 }, [1], ['ok', ''], ['  ']]) {
    assert.equal(projetarProjeto([a], { ...OPC, terminais: ruim }).totais.terminais, 2, `inválida ${JSON.stringify(ruim)} ⇒ padrão`);
    assert.equal(terminaisValidos(ruim), null);
  }
  assert.deepEqual(terminaisValidos(['A', 'b']), ['A', 'b']);
  for (const s of ['Superado', 'Superado (ver PBI-5)', 'superado: x', ' SUPERADO ', 'Superado — dividido', 'Superado – x', 'Superado - x', 'Cancelado', 'Descartado', 'Descartádo']) assert.equal(ehTerminal(s), true, s);
  for (const s of ['Superadoria', 'Pré-superado', 'Em execução', 'Não superado', '', '   ', null, 'Superado—x']) assert.equal(ehTerminal(s), false, String(s));
  assert.equal(ehTerminal('Arquivado: obsoleto', ['arquivado']), true);
  assert.equal(ehTerminal('Superado', ['Arquivado']), false);
  assert.equal(ehTerminal('Superado', 'inválido'), true, 'config inválida ⇒ padrão');
});

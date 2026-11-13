/**
 * Fumaça sem LLM da 2.1.0 (GM-14 T23, P9): a trilha das sete fases, a pergunta com resposta, a sentinela do texto do dono e o aprendizado que atravessa um
 * clone, tudo pelos CLIs reais, pela ponte real do mod e por `dist/`, em repositórios git descartáveis. A caminhada é `fumaca-gm14/caminhada.mjs`; aqui só
 * se afirma o que ela observou. Sem sessão real, sem LLM, sem rede (o `gh` é um executável de fixture). Entra em `npm test`.
 *
 * O ESPERADO VEM DA SPEC (`docs/superpowers/specs/2026-11-11-gm14-clareza-design.md`), nunca copiado da saída: REQ-TRI-1 (marcas, fase, progresso),
 * REQ-DEP-1 (itens e ordem), REQ-DIA-1 (fatos medidos, falha do `gh`, texto do dono), REQ-DIA-2 (anotação), REQ-PRG-1 (pergunta e resposta), REQ-LNG-1
 * (linguagem natural e origem), REQ-GLB-1 e FIEL-10 (blocos, 1 linha sem entrega), FIEL-1 (b) (branch sozinha não liga entrega com PR mergeado), REQ-APR-5 (extrato).
 * Cada `esperado` cita a cláusula ao lado. Defeito de produto (saída diferente da spec) NÃO é consertado aqui: o teste segue afirmando a spec e leva
 * `{ todo: '<motivo>' }` (P9/P10). Nesta versão só `fumaca-pr-mergeado-sem-resposta` leva `todo` (defeito de produto, T18, spec:53).
 *
 * Fora da caminhada (limite declarado): o mod desenhando o texto, o dono digitando no TUI, REQ-ONB-2 e REQ-CHT-1 (têm teste próprio), sessão real com LLM.
 * Saiu `fumaca-heranca` (D-E1: a herança da 1.x vai para a 2.2); entrou `fumaca-aprendizado-clone` (REQ-APR-5).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linhaTecnica } from '../dist/origem.js';
import { caminhar, limpar, limparSemLancar, PREFIXO, SENTINELA } from './fumaca-gm14/caminhada.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SPEC_FIXTURE = readFileSync(join(AQUI, 'fumaca-gm14', 'spec.md'));
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

const o = caminhar();
// a caminhada cria repositórios e bares sob `<tmp>/fumaca-gm14-*`: nada fica depois do `npm test`
after(() => { limparSemLancar(o); });

const f = o.setefases;
const P = f.passos;
const ev = (lista, tipo) => lista.filter((e) => e.tipo === tipo);
const fatos = (chave, sessao) => f.eventos.filter((e) => e.tipo === 'fato.medido' && e.dados.chave === chave && (sessao === undefined || e.sessao === sessao)).map((e) => e.dados);
const topo = (p) => p.texto.split('\n');
const ORIGENS = new Set(['(automático)', '(anotado pelo orquestrador)', '(você)']);
const origemValida = (x) => ORIGENS.has(x) || /^\(você respondeu: .+\)$/.test(x);

test('fumaca-sete-fases: da primeira ideia ao PR aceito, cada passo diz a fase, o progresso, o que depende do dono e a origem (REQ-TRI-1, REQ-DEP-1, FIEL-10)', () => {
  // (1) repo sem nada: 1 linha, e só ela (FIEL-10 e); o estado nunca é `sem_loop` (REQ-GLB-1)
  assert.equal(P.semEntrega.texto, 'GABARITO · sem entrega em curso\n');
  assert.equal(P.semEntrega.estado.modo, 'projeto');
  assert.deepEqual(P.semEntrega.estado.umaLinha, { ultima: null });
  assert.equal(P.semEntrega.estado.trilha.identificada, false);

  // (2) 2 ideias anotadas sem entrega: não é 1 linha (há o que decidir, REQ-DEP-1 (4)); fase 1 de 7. N=2 de propósito: a spec fixa o plural
  // ("N ideias anotadas" spec:52, "as N ideias viram" spec:55); o singular não tem regra na spec e fica fora da fumaça
  assert.equal(f.eventosSemId.filter((e) => e.tipo === 'nota' && e.dados.tipo === 'ideia').length, 2, 'REQ-DIA-2: as notas entraram sem plano, em _sem-id');
  const i = P.ideiaAnotada;
  assert.equal(i.estado.umaLinha, null);
  assert.equal(i.estado.trilha.identificada, false);
  assert.deepEqual([i.estado.trilha.fase, i.estado.trilha.marcas], [1, ['●', '○', '○', '○', '○', '○', '○']]);
  assert.equal(i.estado.trilha.progresso, '2 ideias anotadas');
  assert.match(topo(i)[1], /^depende de você: decidir se as 2 ideias viram a próxima entrega \[visto\]/);
  assert.match(i.texto, /^FASE 1 de 7 ▱{7} · 2 ideias anotadas/m);
  assert.deepEqual(i.estado.depende.map((d) => d.motivo), ['decidir se as 2 ideias viram a próxima entrega']);
  assert.deepEqual(i.estado.recente, [], 'sem origem a mostrar: nenhum fato aconteceu ainda');
  assert.ok(!/^RECENTE/m.test(i.texto));

  // (3) branch com ID sem 2º fato: a conversa pergunta de qual entrega é (REQ-PRG-1 (b)), no topo; a branch sozinha não liga (REQ-TRI-1)
  const b = P.soBranch;
  assert.equal(b.estado.trilha.identificada, false);
  assert.equal(b.estado.pergunta.gatilho, 'b');
  assert.equal(b.estado.pergunta.texto, 'Esta conversa é da entrega GM-50?');
  assert.deepEqual(b.estado.pergunta.opcoes, ['GM-50', 'uma nova', 'conversa avulsa']);
  assert.match(topo(b)[1], /^depende de você: Esta conversa é da entrega GM-50\? · 1 GM-50 · 2 uma nova/);
  assert.deepEqual([b.estado.trilha.fase, b.estado.trilha.marcas], [1, ['●', '○', '○', '○', '○', '○', '○']], 'a branch sozinha não adianta fase (REQ-TRI-1)');
  assert.match(b.texto, /^FASE 1 de 7 ▱{7} · /m);
  assert.ok(!/GM-50/.test(topo(b)[0]), 'a branch sozinha não liga a entrega: o cabeçalho não traz o ID nem o título (REQ-TRI-1)');
  assert.ok(!/GM-50 Spec/.test(b.texto));

  // (4) spec com `PBI:` no cabeçalho: entrega identificada, fase 3 (spec ✓, aprovação ●), falta aprovar, botão (REQ-TRI-1, REQ-DEP-1 (1))
  const s = P.spec;
  assert.equal(s.estado.trilha.identificada, true);
  assert.equal(s.estado.trilha.entrega, 'GM-50');
  assert.deepEqual([s.estado.trilha.fase, s.estado.trilha.marcas], [3, ['✓', '✓', '●', '○', '○', '○', '○']]);
  assert.equal(s.estado.trilha.progresso, 'spec com 3 seções · falta aprovar', 'as 3 linhas `## ` da spec');
  assert.equal(topo(s)[0], 'GABARITO · GM-50 Spec de fumaça da clareza', 'FIEL-10 (f): ID e título uma vez, sem o ID repetido');
  assert.match(topo(s)[1], /^depende de você: aprovar a spec da GM-50 \[aprovar a spec\]/);
  assert.deepEqual(s.estado.depende.map((d) => [d.motivo, d.acoes.map((a) => a.rotulo)]), [['aprovar a spec da GM-50', ['aprovar a spec']]]);
  assert.equal(s.estado.depende[0].acoes[0].comando, '/gabarito-mestre:aprovar', 'o comando só existe na ação do botão');
  assert.match(s.texto, /^FASE 3 de 7 ▰{2}▱{5} · spec com 3 seções · falta aprovar/m, '`?` não pinta; só as 2 marcas ✓');
  assert.deepEqual(s.estado.recente, [], 'a spec ainda não foi aprovada: nenhuma origem a mostrar');

  // (5) aprovada pelo hook, ainda sem plano (REQ-TRI-1: a aprovação vem antes do plano): fase 4; nada depende do dono
  assert.match(f.aprovar.j.systemMessage, /^Spec docs\/superpowers\/specs\/2026-11-12-fumaca-design\.md aprovada pelo dono \(sha256 /);
  assert.equal(ev(f.eventos, 'spec.aprovada')[0].dados.sha256, sha(SPEC_FIXTURE.toString('utf8')), 'aprovação com o sha dos bytes da spec');
  const a = P.aprovada;
  assert.deepEqual([a.estado.trilha.fase, a.estado.trilha.marcas], [4, ['✓', '✓', '✓', '●', '○', '○', '○']]);
  assert.equal(a.estado.trilha.progresso, 'spec com 3 seções');
  assert.deepEqual(a.estado.depende.map((d) => d.motivo), ['depende de você: nada'], 'REQ-DEP-1: todas as fontes leram ⇒ "nada"');
  assert.equal(topo(a)[1], 'depende de você: nada', 'REQ-DEP-1: no render também');
  assert.match(a.texto, /^FASE 4 de 7 ▰{3}▱{4} · spec com 3 seções/m);
  assert.equal(a.estado.recente[0].texto, 'spec aprovada');
  assert.equal(a.estado.recente[0].origem, '(você)', 'REQ-LNG-1: spec.aprovada é do dono');
  assert.match(a.texto, /^RECENTE · \d\d:\d\d ✓ spec aprovada \(você\)$/m);

  // (6) plano: PRONTO com 0 de 2 e a barra vazia (FIEL-10 b); fase 5 "N tasks" (REQ-TRI-1)
  const pl = P.plano;
  assert.deepEqual([pl.estado.trilha.fase, pl.estado.trilha.marcas], [5, ['✓', '✓', '✓', '✓', '●', '○', '○']]);
  assert.equal(pl.estado.trilha.progresso, '2 tasks');
  assert.deepEqual(pl.estado.pronto, { integradas: 0, total: 2, previsao: null });
  assert.match(pl.texto, /^PRONTO ▱{10} 0 de 2 integradas$/m);
  assert.equal(pl.estado.fase, null, 'FIEL-10 (b): com plano o PRONTO ocupa o lugar da FASE');
  assert.ok(!/^FASE/m.test(pl.texto), 'e o texto não mostra a FASE junto');
  assert.deepEqual(pl.estado.depende.map((d) => d.motivo), ['depende de você: nada'], 'REQ-DEP-1: com a spec aprovada, nada espera o dono');
  assert.equal(topo(pl)[1], 'depende de você: nada');
  assert.deepEqual(pl.estado.recente.map((r) => [r.texto, r.origem]), [['spec aprovada', '(você)']], 'REQ-LNG-1: a origem da aprovação');
  assert.match(pl.texto, /^RECENTE · \d\d:\d\d ✓ spec aprovada \(você\)$/m);

  // (7) execução: a barra pinta só integradas (1 de 2 ⇒ 5 de 10) e sem previsão antes de 3 integradas (FIEL-10 b)
  const u = P.umaIntegrada;
  assert.equal(u.estado.trilha.progresso, '1 de 2 tasks integradas');
  assert.deepEqual(u.estado.pronto, { integradas: 1, total: 2, previsao: null });
  assert.match(u.texto, /^PRONTO ▰{5}▱{5} 1 de 2 integradas$/m);
  assert.deepEqual([u.estado.trilha.fase, u.estado.trilha.marcas], [5, ['✓', '✓', '✓', '✓', '●', '○', '○']], 'ainda na execução (REQ-TRI-1)');
  assert.ok(!/^FASE/m.test(u.texto));
  assert.deepEqual(u.estado.depende.map((d) => d.motivo), ['depende de você: nada']);
  assert.equal(topo(u)[1], 'depende de você: nada');
  assert.match(u.texto, /^RECENTE · \d\d:\d\d ✓ integrou T1 \(automático\)$/m);
  assert.ok(!/previsão/.test(u.texto));
  assert.deepEqual(u.estado.recente.map((r) => [r.texto, r.origem]).slice(0, 2), [['integrou T1', '(automático)'], ['aprovou T1', '(automático)']]);
  assert.ok(!/despachou|iniciou|entregou/.test(u.estado.recente.map((r) => r.texto).join(' ')), 'FIEL-10 (d): só resultados');
  const t = P.todasIntegradas;
  assert.deepEqual([t.estado.trilha.fase, t.estado.trilha.marcas], [6, ['✓', '✓', '✓', '✓', '✓', '●', '○']]);
  assert.equal(t.estado.trilha.progresso, '2 de 2 tasks integradas');
  assert.match(t.texto, /^PRONTO ▰{10} 2 de 2 integradas$/m);
  assert.equal(topo(t)[1], 'depende de você: nada');
  assert.match(t.texto, /^RECENTE · \d\d:\d\d ✓ integrou T2 \(automático\)$/m);
  assert.deepEqual(t.estado.depende.map((d) => d.motivo), ['depende de você: nada']);

  // (8) pedido de revisão aberto: item (2) do REQ-DEP-1, sem botão; o progresso diz o número
  const pa = P.prAberto;
  assert.equal(pa.estado.trilha.progresso, 'pedido de revisão #7 aberto');
  assert.deepEqual(pa.estado.depende.map((d) => [d.motivo, d.acoes]), [['revisar e aceitar o pedido de revisão #7', []]]);
  assert.match(topo(pa)[1], /^depende de você: revisar e aceitar o pedido de revisão #7$/);
  assert.deepEqual([pa.estado.trilha.fase, pa.estado.trilha.marcas], [6, ['✓', '✓', '✓', '✓', '✓', '●', '○']], 'REQ-TRI-1: o pedido aberto é a fase atual (●), ainda não ✓');
  assert.match(pa.texto, /^PRONTO ▰{10} 2 de 2 integradas$/m);
  assert.match(pa.texto, /^RECENTE · \d\d:\d\d ✓ integrou T2 \(automático\)$/m);

  // (9) PR mergeado e a branch sozinha: não liga a entrega (FIEL-1 b), pergunta (b) de novo
  const pm = P.prMergeado;
  assert.equal(pm.estado.trilha.identificada, false);
  assert.equal(pm.estado.pergunta.texto, 'Esta conversa é da entrega GM-50?');
  assert.equal(f.idPerguntaB, pm.estado.pergunta.id, 'o botão responde a pergunta que o painel mostrou');
  assert.deepEqual([pm.estado.trilha.fase, pm.estado.trilha.marcas], [1, ['●', '○', '○', '○', '○', '○', '○']], 'REQ-TRI-1: sem entrega identificada a trilha volta à fase 1');
  assert.match(topo(pm)[1], /^depende de você: Esta conversa é da entrega GM-50\? · 1 GM-50 · 2 uma nova/, 'a pergunta (b) no topo, no render também');

  // (10) o dono responde pelo botão: a entrega volta, PR ✓, fase 7 (uso ●) com "aceito"
  assert.match(f.responderB.j.systemMessage, /^Resposta registrada: GM-50\.$/);
  const ac = P.aceito;
  assert.equal(ac.estado.trilha.identificada, true);
  assert.deepEqual([ac.estado.trilha.fase, ac.estado.trilha.marcas], [7, ['✓', '✓', '✓', '✓', '✓', '✓', '●']]);
  assert.match(ac.estado.trilha.progresso, /^pedido de revisão #7 aceito · aguardando publicação$/);
  assert.equal(ac.estado.recente[0].origem, '(você respondeu: GM-50)', 'REQ-LNG-1: o rótulo é o da opção');
  assert.deepEqual(ac.estado.depende.map((d) => d.motivo), ['depende de você: nada']);
  assert.equal(topo(ac)[0], 'GABARITO · GM-50 Spec de fumaça da clareza', 'a entrega voltou: ID e título (REQ-TRI-1)');
  assert.equal(topo(ac)[1], 'depende de você: nada');
  assert.match(ac.texto, /^PRONTO ▰{10} 2 de 2 integradas$/m);
  assert.match(ac.texto, /^RECENTE · \d\d:\d\d ● pergunta respondida \(você respondeu: GM-50\)$/m);

  // (11) release no GitHub: "versão X.Y.Z publicada", tag normalizada (REQ-TRI-1, REQ-LNG-1)
  assert.match(P.publicada.estado.trilha.progresso, /· versão 2\.1\.0 publicada$/);
  assert.ok(!/gabarito-mestre--v/.test(P.publicada.texto), 'a tag crua não chega à tela');
  const pu = P.publicada;
  assert.deepEqual([pu.estado.trilha.fase, pu.estado.trilha.marcas], [7, ['✓', '✓', '✓', '✓', '✓', '✓', '●']]);
  assert.deepEqual(pu.estado.depende.map((d) => d.motivo), ['depende de você: nada']);
  assert.equal(topo(pu)[1], 'depende de você: nada');
  assert.match(pu.texto, /^PRONTO ▰{10} 2 de 2 integradas$/m);
  assert.equal(pu.estado.recente[0].origem, '(você respondeu: GM-50)');

  // (12) o GitHub falha: nada novo gravado; o painel não diz "nada" nem "aceito" sem conferir (REQ-DIA-1, REQ-DEP-1, REQ-TRI-1, D-P13)
  assert.equal(f.medirComGhFalho.j.ok, false);
  assert.ok(f.medirComGhFalho.j.falhas.some((x) => /^gh_falhou/.test(x)), JSON.stringify(f.medirComGhFalho.j));
  assert.equal(f.gravadosNaFalha, 0);
  assert.equal(f.estadoMedirGh['GM-50'].gh, 'falhou');
  const g = P.ghFalhou;
  assert.deepEqual(g.estado.trilha.marcas.slice(5), ['?', '?']);
  assert.equal(g.estado.trilha.motivos[5], 'não consegui conferir o pedido de revisão');
  assert.deepEqual(g.estado.depende.map((d) => d.motivo), ['depende de você: ? (não consegui ler o GitHub)']);
  assert.equal(topo(g)[1], 'depende de você: ? (não consegui ler o GitHub)', 'no render também: nunca "nada" sem conferir');
  assert.match(g.texto, /^PRONTO ▰{10} 2 de 2 integradas$/m);
  assert.equal(g.estado.recente[0].origem, '(você respondeu: GM-50)');

  // (13) fora de um repositório git (FIEL-10 e)
  assert.deepEqual([f.foraDeRepo.rc, f.foraDeRepo.out, f.foraDeRepo.err], [0, 'GABARITO · fora de um projeto\n', '']);
});

// DEFEITO DE PRODUTO (dono: T37, spec:53): o painel escreve "sem entrega identificada" (painel-esquadrao.js:452); a spec manda "entrega não identificada". Texto exato, um só.
test('fumaca-marca-sem-entrega: a branch sozinha escreve exatamente "GABARITO · entrega não identificada" (spec:53)', { todo: 'defeito de produto, painel-esquadrao.js:452, dono T37 (spec:53)' }, () => {
  assert.match(topo(P.soBranch)[0], /^GABARITO · entrega não identificada$/);
});

// DEFEITO DE PRODUTO (dono: T18, já avisada): com o PR mergeado e a branch sozinha, o painel liga a entrega ("GM-50 … PRONTO 2 de 2") em vez do que a spec manda.
// Fica `todo`: a asserção é a da spec; sai do `todo` quando a T18 consertar.
test('fumaca-pr-mergeado-sem-resposta: PR mergeado e a branch sozinha ⇒ "entrega não identificada" com "última entrega conhecida: <ID>", nunca liga a entrega (REQ-TRI-1, spec:53)', { todo: 'defeito de produto, T18 (spec:53)' }, () => {
  const pm = P.prMergeado;
  assert.match(topo(pm)[0], /^GABARITO · entrega não identificada$/);
  assert.match(pm.texto, /última entrega conhecida: GM-50/);
  assert.ok(!/^PRONTO/m.test(pm.texto), 'não liga a entrega: o PRONTO dela não aparece');
});

test('fumaca-sete-fases-linguagem: em todo passo, 0 linha técnica, até 80 colunas, nenhum emoji, só glifos da lista e origem da tabela fechada (REQ-LNG-1, FIEL-10)', () => {
  const GLIFOS = /^[\p{L}\p{N}\p{P}\p{Zs}✓●○◐✗▰▱·›─?#%]*$/u;
  assert.equal(Object.keys(P).length, 13, 'os 13 passos da caminhada');
  for (const [nome, p] of Object.entries(P)) {
    for (const l of p.texto.split('\n')) {
      assert.ok(!linhaTecnica(l), `${nome}: linha técnica: ${l}`);
      assert.ok([...l].length <= 80, `${nome}: passa de 80 colunas: ${l}`);
      assert.ok(!/\p{Extended_Pictographic}|\uFE0F/u.test(l), `${nome}: emoji: ${l}`);
      assert.ok(GLIFOS.test(l), `${nome}: caractere fora da lista: ${l}`);
    }
    assert.ok(!/NaN|undefined|null|\[object/.test(p.texto), `${nome}: valor interno vazou`);
    for (const r of p.estado.recente ?? []) assert.ok(origemValida(r.origem), `${nome}: origem fora da tabela: ${r.origem}`);
    for (const h of p.estado.historico ?? []) assert.ok(h.origem === null || origemValida(h.origem), `${nome}: origem do histórico fora da tabela: ${h.origem}`);
    assert.equal(p.texto.endsWith('\n'), true, nome);
  }
  // "AGORA" só diz o que mediu: com a sessão do mod, o orquestrador e o contexto (FIEL-11 a)
  assert.match(P.spec.texto, /^AGORA · \S+ · contexto 30 %$/m);
});

test('fumaca-fatos-medidos: o diário da entrega leva só as formas fechadas, cada uma 1× por mudança, e o PR muda de aberto para mergeado (REQ-DIA-1)', () => {
  const S1 = 'S1';
  assert.deepEqual(fatos('branch', S1), [{ chave: 'branch', fonte: 'git', valor: { nome: 'feat/GM-50-fumaca' } }]);
  assert.deepEqual(fatos('spec', S1), [{ chave: 'spec', fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/2026-11-12-fumaca-design.md', sha256: sha(SPEC_FIXTURE.toString('utf8')), secoes: 3 } }]);
  assert.deepEqual(fatos('plano', S1), [{ chave: 'plano', fonte: 'arquivo', valor: { tasks: 2 } }], 'o plano medido 1×, apesar de 7 medições');
  assert.deepEqual(fatos('pr', S1).map((x) => [x.fonte, x.valor]), [
    ['gh', { numero: 7, estado: 'aberto', branch: 'feat/GM-50-fumaca' }],
    ['gh', { numero: 7, estado: 'mergeado', branch: 'feat/GM-50-fumaca' }],
  ]);
  assert.deepEqual(fatos('release', S1).map((x) => x.valor), [{ tag: 'gabarito-mestre--v2.1.0' }]);
  assert.deepEqual(fatos('agente', S1), [], 'sem agente no stdin do mod, nenhum fato de agente');
  // a sessão nova grava a âncora de novo (a 1ª medição de cada sessão), e o `gh` que falhou não gravou nada
  assert.deepEqual(['branch', 'spec', 'plano'].map((c) => fatos(c, 'S2').length), [1, 1, 1]);
  assert.deepEqual(['pr', 'release'].map((c) => fatos(c, 'S2').length), [0, 0]);
  // nada de texto do dono: a nota da ideia ficou em _sem-id com o texto do orquestrador, e a resposta traz o rótulo da opção
  const respostas = ev([...f.eventos, ...f.eventosSemId], 'dono.resposta');
  assert.deepEqual(respostas.map((r) => r.dados), [{ pergunta: 'S1:1', opcao: 1, rotulo: 'GM-50' }]);
});

test('fumaca-pergunta-e-resposta: assunto novo sem entrega ⇒ pergunta (a) no topo ⇒ responder.mjs grava o rótulo da opção ⇒ "(você respondeu: …)" (REQ-DIA-2, REQ-PRG-1, REQ-LNG-1)', () => {
  const q = o.pergunta;
  assert.equal(q.antes.texto, 'GABARITO · sem entrega em curso\n');
  assert.equal(q.antes.estado.pergunta, null);
  const c = q.comPergunta;
  assert.equal(c.estado.pergunta.gatilho, 'a');
  assert.match(c.estado.pergunta.texto, /^A conversa mudou de assunto\. Isto é .*ideia para a próxima ou conversa avulsa\?$/);
  assert.deepEqual(c.estado.pergunta.opcoes, ['ideia para a próxima', 'conversa avulsa']);
  assert.equal(q.id, 'S-pergunta:1', '<sessão>:<seq> da nota');
  assert.match(topo(c)[1], /^depende de você: A conversa mudou de assunto\./, 'a pergunta é o item do topo (REQ-PRG-1)');
  // o hook grava a resposta com o rótulo da opção (nunca do argumento)
  assert.equal(q.hook.rc, 0, q.hook.err);
  assert.deepEqual(q.hook.j, { systemMessage: 'Resposta registrada: ideia para a próxima.' });
  assert.deepEqual(ev(q.eventos, 'dono.resposta').map((r) => r.dados), [{ pergunta: 'S-pergunta:1', opcao: 1, rotulo: 'ideia para a próxima' }]);
  assert.deepEqual(ev(q.eventos, 'nota').map((n) => [n.dados.tipo, n.dados.texto]), [['assunto', 'agora falamos de outra coisa']]);
  // fechada: some do topo, e a resposta aparece com a origem da tabela
  assert.equal(q.depois.estado.pergunta, null);
  assert.equal(q.depois.estado.recente[0].origem, '(você respondeu: ideia para a próxima)');
  assert.equal(q.depois.estado.recente[0].texto, 'pergunta respondida');
  assert.equal(q.depois.texto, 'GABARITO · sem entrega em curso\n', 'FIEL-10 (e): sem nada pendente volta a 1 linha');
});

test('fumaca-sentinela: texto do dono (transcript, dono.mensagem, resposta digitada, argumento extra) ⇒ 0 ocorrências em todo o .harness/ (REQ-DIA-1)', () => {
  const s = o.sentinela;
  // o teste não é vazio: cada caminho foi percorrido e deixou o que a spec manda
  assert.deepEqual([s.medir.rc, s.medir.j.ok], [0, true], JSON.stringify(s.medir.j));
  assert.equal(s.estado.rc, 0, s.estado.err);
  const vivo = s.estado.j.estado.equipe.agentes.find((x) => x.vivo);
  assert.equal(vivo.ctxTok, 92762, 'o transcript com a sentinela FOI lido pelo painel (o uso vem dele)');
  assert.deepEqual(s.mensagem, { ok: true }, 'a ponte do mod gravou a mensagem');
  const msg = ev(s.eventos, 'dono.mensagem');
  assert.equal(msg.length, 1);
  assert.deepEqual(msg[0].dados, { sha256: sha(`${SENTINELA}-mensagem`), chars: `${SENTINELA}-mensagem`.length }, 'só o hash e o tamanho');
  assert.deepEqual(Object.keys(msg[0].dados).sort(), ['chars', 'sha256']);
  assert.equal(s.digitada.j.decision, 'block');
  assert.match(s.digitada.j.reason, /resposta não reconhecida/);
  assert.equal(s.extra.j.decision, 'block');
  const respostas = ev(s.eventos, 'dono.resposta').map((r) => r.dados);
  const digitada = `${s.id} sim ${SENTINELA}-digitada`;
  const extra = `${s.id} 2 ${SENTINELA}-extra`;
  assert.deepEqual(respostas, [
    { pergunta: s.id, sha256: sha(digitada), chars: [...digitada].length },
    { pergunta: s.id, sha256: sha(extra), chars: [...extra].length },
  ], 'resposta digitada e argumento extra: só {pergunta, sha256, chars}, sem rótulo nem texto');
  // 0 ocorrências: relê `.harness/` inteiro (todo arquivo regular, menos worktrees) e os nomes dos arquivos
  const nomes = Object.keys(s.bytes);
  assert.ok(nomes.includes('entregas/GM-70/events.S-sent.jsonl') && nomes.includes('entregas/GM-70/events.dono.jsonl') && nomes.includes('painel-medir.json'), `a leitura viu o diário inteiro: ${nomes}`);
  const achados = Object.entries(s.bytes).filter(([n, b]) => b.includes('SENTINELA') || n.includes('SENTINELA')).map(([n]) => n);
  assert.deepEqual(achados, [], 'nenhum byte de .harness/ tem a sentinela');
});

test('fumaca-aprendizado-clone: gravar aprendizado ⇒ extrato versionado ⇒ cópia por `git ls-files` (sem diário) ⇒ `proxima` traz o D no item do implementador (REQ-APR-5)', () => {
  const a = o.aprendizado;
  const REGRA = 'rode o build antes de rodar o teste';
  assert.deepEqual(a.aprendizado.extrato, { ok: true, linhas: 1, fora: 0, avisos: [] });
  // (a) extrato: 1 linha por evento, {entrega, evento}, o evento igual ao do diário
  const linhas = a.extratoBruto.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(linhas.length, 1);
  assert.deepEqual(Object.keys(linhas[0]).sort(), ['entrega', 'evento']);
  assert.equal(linhas[0].entrega, 'GM-60');
  assert.equal(linhas[0].evento.tipo, 'aprendizado');
  assert.deepEqual(linhas[0].evento.dados, { tipo: 'E', status: 'D', gatilho: null, evidencia: { eventos: [{ sessao: 'loop', seq: 1 }] }, regra: REGRA, entra_em: ['brief:implementador'] });
  assert.deepEqual([linhas[0].evento.sessao, linhas[0].evento.seq], ['loop', 2]);
  // o que o git versiona leva o extrato e nenhum diário
  assert.ok(a.versionados.includes('.harness/aprendizados.jsonl'), 'o extrato entrou por `git add` comum (sem -f) na regra da fumaça');
  // o instalador REAL, num repositório vazio: o .gitignore que ele deixa não esconde o extrato (REQ-APR-5 (a))
  assert.equal(a.instalador.instaladorRc, 0);
  assert.ok(a.instalador.gitignore.includes('.harness/painel-medir.json'), 'o .gitignore lido é o que o instalador escreveu');
  assert.equal(a.instalador.checkIgnoreRc, 1, 'git check-ignore: o extrato não é ignorado pelo .gitignore instalado');
  assert.ok(a.instalador.versionados.includes('.harness/aprendizados.jsonl'), '`git add` comum aceitou o extrato no repo instalado');
  assert.ok(!a.versionados.some((x) => /events\..*\.jsonl$/.test(x)), 'nenhum diário versionado');
  assert.deepEqual(a.cloneTemDiario, ['plano.json'], 'o clone só tem o plano da entrega');
  // (b) leitura no clone: o mesmo D, sem aviso
  assert.equal(a.cloneAprendizados.rc, 0, a.cloneAprendizados.err);
  assert.deepEqual(a.cloneAprendizados.j.avisos, []);
  assert.deepEqual(a.cloneAprendizados.j.aprendizados.map((x) => [x.entrega, x.regra, x.entra_em]), [['GM-60', REGRA, ['brief:implementador']]]);
  // (d) despacho: o item do `proxima` real, no clone, leva o D ao brief do implementador
  assert.equal(a.cloneProxima.rc, 0, a.cloneProxima.out + a.cloneProxima.err);
  const acao = a.cloneProxima.j.acao;
  assert.equal(acao.tipo, 'despachar');
  const item = acao.itens.find((x) => x.task === 'T1' && x.papel === 'implementador');
  assert.deepEqual(item.aprendizados, [REGRA], 'o D chega ao item, sem teto');
});

test('fumaca-limpa-o-temporario: o diretório da caminhada existe durante os testes; limpar() o apaga e recusa qualquer outro caminho', () => {
  assert.ok(existsSync(o.base), 'os repositórios descartáveis existem enquanto os testes rodam');
  for (const d of [o.setefases.dir, o.pergunta.dir, o.sentinela.dir, o.aprendizado.dir, o.aprendizado.clone]) assert.ok(d.startsWith(o.base), d);
  const falso = mkdtempSync(join(tmpdir(), `${PREFIXO}limpeza-`));
  writeFileSync(join(falso, 'x'), 'x');
  limpar({ base: falso });
  assert.equal(existsSync(falso), false, 'apagado');
  assert.throws(() => limpar({ base: AQUI }), /recuso apagar/, 'a pasta de testes nunca é apagada');
  assert.throws(() => limpar({ base: join(tmpdir(), 'qualquer-coisa') }), /recuso apagar/, `nome fora do padrão ${PREFIXO}*`);
  assert.ok(existsSync(AQUI));
});

test('fumaca-limpa-o-temporario-quando-a-caminhada-falha: erro no meio ⇒ a falha original sobe e nenhum <tmp>/fumaca-gm14-* novo fica', () => {
  const sobras = () => readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIXO));
  const antes = new Set(sobras());
  assert.throws(() => caminhar({ aposMontar: () => { throw new Error('falha injetada'); } }), /falha injetada/);
  assert.deepEqual(sobras().filter((n) => !antes.has(n)), [], 'o temporário da caminhada que falhou foi removido');
});

test('fumaca-limpar-sem-lancar: limpar recusa o que não é da fumaça; limparSemLancar engole a recusa (o after nunca lança)', () => {
  for (const ruim of [undefined, {}, { base: tmpdir() }, { base: join(tmpdir(), 'outra-coisa') }]) {
    assert.throws(() => limpar(ruim), /recuso apagar/);
    assert.doesNotThrow(() => limparSemLancar(ruim));
  }
});

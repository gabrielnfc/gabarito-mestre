/**
 * Fumaça sem LLM da E4 (GM-12 T12, P9): spec aprovada pelo hook, emenda aberta, teto de rodadas, agente vivo com transcript de fixture, devolução do deploy e
 * o painel em texto nos dois presets, pelos CLIs reais e por `dist/`, em repositório git descartável. A caminhada é `fumaca-e4/caminhada.mjs`; aqui só se
 * afirma o que ela observou. Sem sessão real, sem LLM. Entra em `npm test`.
 *
 * Os `.txt` da pasta `fumaca-e4/` são o texto `mono` de 80 colunas do estado PAROU (teto de rodadas em T2, emenda aberta, T3 com o agente vivo): o teste só os
 * LÊ. Com o relógio congelado por processo (ver a caminhada) o texto é o mesmo a cada execução.
 *
 * GM-14 T18 (desvio registrado, REQ-GLB-1): `painel.mjs` passa `fatos` sempre, então o `depende` é o de `dependeDe` (REQ-DEP-1, itens (5) e (7)) e o texto
 * é o render de blocos (REQ-GLB-1, FIEL-10, FIEL-11). Goldens regravados a esse contrato; cada linha conferida contra a spec (motivos em t18-relatorio.md).
 *
 * MUTAÇÕES PRESCRITAS: task-12-mut.json da entrega.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhar, limpar, limparSemLancar } from './fumaca-e4/caminhada.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const lido = (nome) => readFileSync(join(AQUI, 'fumaca-e4', nome), 'utf8');

const o = caminhar();
// a caminhada cria um repo git e um bare em `<tmp>/fumaca-e4-*`: nada fica depois do `npm test`
after(() => { limparSemLancar(o); });
const tipos = (t) => o.eventos.filter((e) => e.tipo === t);

test('fumaca-spec-aprovada-pelo-hook: aguardando ⇒ aprova (sha256 dos bytes) ⇒ painel sem pendência; a 2ª aprovação do mesmo sha é recusada sem gravar', () => {
  const sha = createHash('sha256').update(readFileSync(join(AQUI, 'fumaca-e4', 'spec.md'))).digest('hex');
  assert.deepEqual(o.estadoAntes.j.estado.depende, [{ nivel: 'dono', motivo: 'spec aguardando aprovação', acoes: [{ rotulo: 'aprovar a spec', comando: '/gabarito-mestre:aprovar' }] }]);
  assert.equal(o.estadoAntes.j.estado.titulo, 'Spec de fumaça da E4');
  assert.deepEqual(o.estadoAntes.j.estado.plano.tasks.map((t) => [t.id, t.titulo, t.estado]), [['T1', 'Núcleo do plano', 'pendente'], ['T2', 'Agentes vivos', 'pendente'], ['T3', 'Depende de você', 'pendente']]);
  assert.equal(o.aprovar.rc, 0, o.aprovar.err);
  assert.match(o.aprovar.j.systemMessage, new RegExp(`^Spec docs/spec\\.md aprovada pelo dono \\(sha256 ${sha.slice(0, 12)}…, entrega GM-99\\)\\.$`));
  assert.deepEqual(tipos('spec.aprovada').map((e) => e.dados), [{ spec: 'docs/spec.md', sha256: sha }], 'um único spec.aprovada, com o caminho e o sha256 dos bytes');
  assert.equal(o.aprovarDeNovo.j.decision, 'block');
  assert.match(o.aprovarDeNovo.j.reason, /ja_aprovada/);
  // REQ-DEP-1: todas as fontes leram e a lista é vazia ⇒ o único item é "depende de você: nada", sem botão
  assert.deepEqual(o.estadoAprovada.j.estado.depende, [{ nivel: 'dono', motivo: 'depende de você: nada', acoes: [] }], 'aprovada: nada depende do dono');
});

test('fumaca-emenda-aberta-e-agente-vivo: a proposta aparece em depende com os comandos reais; o transcript de fixture chega a ctxTok 92762 e tok 86900 pelo CLI', () => {
  assert.deepEqual(o.proposta.j.congeladas, ['T3']);
  const e = o.estadoEmenda.j.estado;
  // REQ-DEP-1, ordem (5) antes de (7): T2 já está no teto (o loop ainda não parou, então nenhum PAROU traz o liberar) e a emenda #1 está aberta
  assert.deepEqual(e.depende, [
    { nivel: 'dono', motivo: 'decidir a T2: chegou ao limite de revisões', acoes: [{ rotulo: 'liberar mais uma rodada', comando: '/gabarito-mestre:liberar T2' }] },
    { nivel: 'dono', motivo: 'decidir a emenda 1', acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 1' }, { rotulo: 'rejeitar', comando: '/gabarito-mestre:emenda rejeitar 1' }] },
  ]);
  assert.equal(e.parar, null, 'ainda não parou');
  // costura (P9): stdin do mod → painel.mjs → lerCauda/usoDoTranscript → projeção → estado
  const vivos = e.equipe.agentes.filter((a) => a.vivo);
  assert.equal(vivos.length, 1);
  assert.equal(e.equipe.vivos, 1);
  assert.deepEqual([vivos[0].task, vivos[0].papel, vivos[0].estadoTask, vivos[0].modelo], ['T3', 'implementador', 'implementando', 'haiku']);
  assert.equal(vivos[0].ctxTok, 92762);
  assert.equal(vivos[0].tok, 86900);
  assert.equal(vivos[0].ctxPct, null, 'sem janela do agente: só tokens');
  assert.match(vivos[0].nome, /^[A-Z]{2,10}$/, 'o agente leva nome do pacote');
  assert.equal(e.equipe.lider.ctx, 46);
  assert.deepEqual([e.equipe.lider.h5, e.equipe.lider.d7], [12, 5]);
});

test('fumaca-teto-de-rodadas-e-parou: T2 reprovada 2× ⇒ no_teto ⇒ proxima decide parar ⇒ loop.parar ⇒ o estado diz PAROU com a task e o comando', () => {
  assert.deepEqual(o.proximaTeto.j.acao, { tipo: 'parar', motivo: 'teto_rodadas', task: 'T2' });
  assert.deepEqual(tipos('loop.parar').map((x) => x.dados), [{ motivo: 'teto_rodadas' }]);
  assert.deepEqual(tipos('review.veredito').filter((x) => x.dados.task === 'T2').map((x) => [x.dados.veredito, x.dados.rodada]), [['REPROVADO', 1], ['REPROVADO', 2], ['APROVADO', 1]], 'reprovada 2× (teto); a APROVADO é de depois da liberação do dono');
  const e = o.estadoParou.j.estado;
  assert.equal(e.parado, true);
  assert.equal(e.parar.motivo, 'teto_rodadas');
  assert.equal(e.parar.texto, 'teto de rodadas de review em T2');
  assert.deepEqual(e.parar.acoes, [{ rotulo: 'aprovar', comando: '/gabarito-mestre:liberar T2' }, { rotulo: 'recusar: deixe a task parada e emende a spec', comando: null }]);
  assert.deepEqual(e.parar.emVoo, ['T3']);
  assert.equal(e.parar.alteracoes, 0);
  assert.equal(e.parar.hora, '12:25');
  assert.deepEqual(e.plano.tasks.map((t) => [t.id, t.estado, t.glifo]), [['T1', 'integrada', '✓'], ['T2', 'no_teto', '✗'], ['T3', 'implementando', '●']]);
  assert.deepEqual([e.plano.feitas, e.plano.total, e.plano.pct], [1, 3, 33]);
  // PAROU primeiro, depois a emenda (REQ-DEP-1 (7)); o item (5) da T2 não se repete, o PAROU já traz o liberar (FIEL-10 c)
  assert.deepEqual(e.depende.map((d) => d.nivel), ['parar', 'dono']);
  assert.deepEqual(e.depende[0].acoes, e.parar.acoes);
  assert.deepEqual(e.depende[1], { nivel: 'dono', motivo: 'decidir a emenda 1', acoes: [{ rotulo: 'aprovar', comando: '/gabarito-mestre:emenda aprovar 1' }, { rotulo: 'rejeitar', comando: '/gabarito-mestre:emenda rejeitar 1' }] });
  assert.ok(!e.depende.some((d) => /limite de revisões/.test(d.motivo)), 'o teto da T2 só aparece no PAROU');
  assert.deepEqual(e.notificacao, { hora: '12:26' }, 'notificação do mod, em UTC, logo depois do PAROU (12:25)');
  assert.equal(o.estadoNotificacaoAntiga.j.estado.notificacao, null, 'ts 12:12 é anterior ao PAROU das 12:25: de um Parar antigo, não aparece sob o atual');
});

test('fumaca-painel-e4: painel.mjs texto, nos dois presets, é byte a byte o texto de fumaca-e4/*.txt (stdout só o texto, stderr vazio)', () => {
  for (const [preset, r] of [['esquadrao', o.textoEsquadrao], ['executivo', o.textoExecutivo]]) {
    assert.equal(r.rc, 0, `${preset}: ${r.err}`);
    assert.equal(r.err, '', `${preset}: aviso inesperado no stderr`);
    assert.equal(r.out, lido(`${preset}.txt`), `${preset}: texto difere do golden da fumaça`);
  }
  // o que os goldens têm de CONTEÚDO (não só a igualdade): tudo veio dos CLIs reais, na forma da spec (GM-14 T18)
  const esq = o.textoEsquadrao.out;
  const exe = o.textoExecutivo.out;
  for (const t of [esq, exe]) {
    const l = t.split('\n');
    // GM-15 T29 (D-G1c): o desenho é o do E4 — o rótulo do preset à direita do cabeçalho, ◆ DEPENDE DE VOCÊ, PLANO, EQUIPE, histórico hh:mm
    assert.equal(l[0].replace(/ {2,}(esquadrão( · .*)?|executivo)$/, ''), 'GABARITO · GM-99 Spec de fumaça da E4', 'FIEL-10 (f): cabeçalho uma vez, igual nos presets');
    // REQ-GLB-1 / FIEL-10 (a): DEPENDE no topo; o PAROU é item dele e vem primeiro, depois a emenda (REQ-DEP-1 (7)); o teto da T2 não repete
    // REQ-GLB-1: o motivo do PAROU inteiro, quebrado em 2 linhas (recuo de 4), nenhuma cortada com "…"
    assert.equal(l[1], '■ PAROU 12:25 · teto de rodadas de review em T2 [aprovar] · recusar: deixe a');
    assert.equal(l[2], '    task parada e emende a spec');
    assert.equal(l[3], '◆ DEPENDE DE VOCÊ  1 item');
    assert.equal(l[4], '  decidir a emenda 1 [aprovar] [rejeitar]');
    const iSep = l.findIndex((x) => /^─+$/.test(x));
    assert.equal(iSep, 5, 'o topo acaba no 1º separador do E4');
    assert.ok(l.slice(0, iSep).every((x) => [...x].length <= 80 && !x.endsWith('…')), 'REQ-GLB-1: nenhuma linha do topo passa de 80 colunas nem termina em "…"');
    assert.ok(!/limite de revisões|depende de você: nada/.test(t), 'com PAROU e emenda o topo não diz "nada" nem repete o teto');
    // FIEL-10 (b): PLANO pinta só integradas (1 de 3 ⇒ 7 de 21 marcas), status do loop à direita
    assert.match(l[6], /^PLANO {3}▰{7}▱{14} {2}33% {2}1\/3 tasks +loop parado$/);
    // FIEL-11 (a)(b): o orquestrador com o contexto; o agente vivo da T3 pelo último fato registrado, com a medição do uso (93k)
    assert.match(t, /^│ {2}ctx █+░+ 46% · pouso em 50% {3}tok \?$/m);
    assert.match(t, /^│ {2}5h █░{9} 12% {3}7d █░{9} 5%$/m);
    assert.match(t, /^└─ ● \S+ · haiku {2}T3 {2}ctx 93k {2}\dm {2}implementando \(registrado\)$/m);
    // FIEL-10 (c): o teto da T2 já está no topo e a T3 tem agente ⇒ sem ATENÇÃO
    assert.ok(!/ATENÇÃO/.test(t));
    // FIEL-10 (d): só resultados, mais novo no topo, com origem; "despachou" e "emenda proposta" não entram
    const rec = l.filter((x) => /^\d\d:\d\d /.test(x));
    assert.equal(rec[0], '12:25 ✗ travou: teto de rodadas de review (automático)');
    assert.equal(rec.length, 5, 'até 5 linhas de RECENTE');
    assert.ok(!/despachou|proposta/.test(t));
    assert.ok(!/NaN|undefined|null|\[object/.test(t), 'valor interno vazou para a tela');
    assert.ok(l.every((x) => [...x].length <= 80), 'nada passa de 80 colunas');
  }
  assert.match(esq, /^[A-Z]{2,10} {2}orquestra$/m, 'o esquadrão leva o nome do pacote');
  assert.match(esq, /^└─ ● [A-Z]{2,10} · haiku {2}T3 /m);
  assert.match(exe, /^Orquestrador {2}orquestra$/m);
  assert.match(exe, /^└─ ● Implementador · haiku {2}T3 /m);
  assert.ok(!/ARAGORN|SAM|FRODO|GANDALF|ELROND|LEGOLAS|terra média/.test(exe), 'o Executivo não tem nome de pacote (D-P10)');
  // o topo (PAROU, DEPENDE) e o PLANO têm as MESMAS linhas nos dois presets; o cabeçalho só difere no rótulo do preset
  assert.deepEqual(exe.split('\n').slice(1, 7), esq.split('\n').slice(1, 7));
});

test('fumaca-devolver-sem-rodar-comando: hooks do dono + conclusão ⇒ decisão subir ⇒ devolver grava o pedido, nenhum deploy/smoke/rollback roda, o painel mostra o comando', () => {
  assert.equal(o.hookEmenda.rc, 0, o.hookEmenda.err);
  assert.equal(o.hookEmenda.j.systemMessage, 'Emenda #1 (REQ-C-1) aprovada pelo dono; entrega GM-99');
  assert.equal(o.hookLiberar.rc, 0, o.hookLiberar.err);
  assert.deepEqual(tipos('task.reaberta').map((x) => [x.dados.task, x.dados.origem]), [['T2', 'dono']]);
  assert.deepEqual(o.proximaFim.j.acao, { tipo: 'concluir' });
  assert.deepEqual(o.decidir.j.decisao, { tipo: 'subir' });
  assert.equal(o.devolver.rc, 0, o.devolver.out);
  assert.deepEqual(o.devolver.j, { ok: true, gravado: true, evento: { tipo: 'entrega.devolvida', motivo: 'quero revisar antes de subir' } });
  assert.deepEqual(tipos('entrega.devolvida').map((x) => x.dados), [{ motivo: 'quero revisar antes de subir' }]);
  assert.deepEqual(o.rodou, [], 'devolver NUNCA roda deploy, smoke nem rollback');
  assert.equal(tipos('entrega.inicio').length, 0, 'nada subiu');
  const e = o.estadoDevolvido.j.estado;
  assert.equal(e.parar, null, 'o PAROU antigo foi limpo pelo trabalho que veio depois');
  assert.equal(e.parado, false);
  assert.deepEqual(e.depende, [{ nivel: 'dono', motivo: 'deploy devolvido ao dono: quero revisar antes de subir', acoes: [{ rotulo: 'executar', comando: 'node <plugin>/gates/scripts/entrega.mjs executar --entrega GM-99' }] }]);
  assert.deepEqual([e.plano.feitas, e.plano.total, e.plano.pct], [3, 3, 100]);
  assert.deepEqual(e.plano.tasks.map((t) => t.estado), ['integrada', 'integrada', 'integrada']);
  assert.equal(e.equipe.vivos, 0, 'agentes: [] ⇒ 0 vivos');
  assert.equal(e.rodape.ci.verde, true);
  assert.equal(o.textoDevolvido.rc, 0, o.textoDevolvido.err);
  // REQ-GLB-1: o item do dono no topo, com o botão; o comando inteiro está no estado (acima) e é o que o botão leva.
  // A 80 colunas o item quebra em linhas (REQ-GLB-1: topo nunca cortado): o botão inteiro aparece, nenhuma linha termina em "…".
  const ld = o.textoDevolvido.out.split('\n');
  assert.equal(ld[0].replace(/ {2,}(esquadrão( · .*)?|executivo)$/, ''), 'GABARITO · GM-99 Spec de fumaça da E4');
  const iP = ld.findIndex((x) => x.startsWith('PLANO'));
  const topoD = ld.slice(1, ld.findIndex((x) => /^─+$/.test(x)));
  assert.ok(topoD.every((x) => [...x].length <= 80 && !x.endsWith('…')), `topo sem corte: ${JSON.stringify(topoD)}`);
  assert.match(topoD.join(' ').replace(/ +/g, ' '), /^◆ DEPENDE DE VOCÊ 1 item deploy devolvido ao dono: quero revisar antes de subir \[executar\]$/);
  assert.equal(ld.filter((x) => x.startsWith('  deploy devolvido')).length, 1, '1 item');
  assert.match(ld[iP], /^PLANO {3}▰{21} {2}100% {2}3\/3 tasks +todas integradas$/);
  assert.ok(!/PAROU|depende de você: nada/.test(o.textoDevolvido.out));
});

test('fumaca-limpa-o-temporario: o diretório da caminhada existe durante os testes; limpar() o apaga e recusa qualquer outro caminho', () => {
  assert.ok(existsSync(o.base), 'o repo descartável existe enquanto os testes rodam');
  const falso = mkdtempSync(join(tmpdir(), 'fumaca-e4-limpeza-'));
  writeFileSync(join(falso, 'x'), 'x');
  limpar({ base: falso });
  assert.equal(existsSync(falso), false, 'apagado');
  assert.throws(() => limpar({ base: AQUI }), /recuso apagar/, 'a pasta de testes nunca é apagada');
  assert.throws(() => limpar({ base: join(tmpdir(), 'qualquer-coisa') }), /recuso apagar/, 'nome fora do padrão fumaca-e4-*');
  assert.ok(existsSync(AQUI));
});

test('fumaca-limpa-o-temporario-quando-a-caminhada-falha: erro no meio ⇒ a falha original sobe e nenhum <tmp>/fumaca-e4-* novo fica', () => {
  const sobras = () => readdirSync(tmpdir()).filter((n) => n.startsWith('fumaca-e4-'));
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

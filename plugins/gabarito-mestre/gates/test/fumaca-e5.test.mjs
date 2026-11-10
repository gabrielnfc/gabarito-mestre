/**
 * Fumaça sem LLM da E5a (GM-13 T16, P9): o veredito que reprova vira aprendizado, o aprendizado chega ao instantâneo, ao cartão do `clear` e ao brief do
 * implementador; o fechamento pede o aprendizado (e o doctor o avisa); o registro sai igual a cada execução; o onboarding grava a config das respostas.
 * Tudo pelos CLIs reais e por `dist/`, em repositório git descartável. A caminhada é `fumaca-e5/caminhada.mjs`; aqui só se afirma o que ela observou, e cada
 * afirmação lê o ARQUIVO (diário, registro.md, harness.config.json), não a função do produto. Sem sessão real, sem LLM. Entra em `npm test`.
 *
 * MUTAÇÕES PRESCRITAS: task-16-mut.json da entrega.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhar, limpar, limparSemLancar, configEsperada, escolher, ENTREGA } from './fumaca-e5/caminhada.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REGRA = 'Sempre rode o teste do contrato antes de concluir a task';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const o = caminhar();
after(() => { limparSemLancar(o); });
const tipos = (t, lista = o.eventos) => lista.filter((e) => e.tipo === t);

test('fumaca-aprende-e-volta: review MAJOR ⇒ aprender ⇒ aprendizado D ⇒ pouso, cartão clear e item implementador trazem a regra ⇒ fechamento ⇒ nada ⇒ concluir', () => {
  // o veredito que reprova, lido do arquivo
  const [veredito] = tipos('review.veredito').filter((e) => e.dados.task === 'T1');
  assert.deepEqual([veredito.dados.veredito, veredito.dados.rodada, veredito.dados.blocker, veredito.dados.major], ['REPROVADO', 1, 0, 1]);
  // 1. `proxima` diz `aprender`, com o par (sessao, seq) desse veredito
  assert.deepEqual(o.proximaAprender.j.acao, { tipo: 'aprender', pendencias: [{ sessao: veredito.sessao, seq: veredito.seq, tipo: 'review' }] });
  assert.deepEqual(tipos('aprendizado', o.diarioAntesDoAprendizado), [], 'nenhum aprendizado foi gravado antes do comando');
  // 2. o aprendizado gravado: forma, gatilho e evidência no ARQUIVO
  const [apr] = tipos('aprendizado');
  assert.deepEqual(apr.dados, { tipo: 'E', status: 'D', gatilho: { sessao: veredito.sessao, seq: veredito.seq }, evidencia: { eventos: [{ sessao: veredito.sessao, seq: veredito.seq }] }, regra: REGRA, entra_em: ['instantaneo', 'brief:implementador'] });
  assert.equal(o.aprendizado.j.evento.tipo_evento, 'aprendizado');
  assert.equal(tipos('aprendizado').length, 1, 'um único aprendizado na entrega');
  // 3. a regra só vale onde `entra_em` mandou
  assert.deepEqual(o.aprendizadosInstantaneo.j.aprendizados.map((x) => [x.entrega, x.regra, x.tipo]), [[ENTREGA, REGRA, 'E']]);
  assert.deepEqual(o.aprendizadosImplementador.j.aprendizados.map((x) => x.regra), [REGRA]);
  assert.deepEqual(o.aprendizadosRevisor.j.aprendizados, [], 'o brief do revisor não recebe a regra do implementador');
  // 4. pouso: no diário (1 só, via dono, sem retomada nem parada) e o instantâneo com a regra
  const pouso = tipos('sessao.pouso');
  assert.equal(pouso.length, 1);
  assert.deepEqual(pouso[0].dados, { percent: null, x: 50, via: 'dono' });
  assert.deepEqual(o.pousar.j.evento, { tipo: 'sessao.pouso', percent: null, x: 50, via: 'dono' });
  assert.match(o.pousar.j.instantaneo, new RegExp(`^Aprendizados \\(1\\):\\nE ${REGRA}$`, 'm'));
  assert.deepEqual(tipos('sessao.retomada'), [], 'nem o pouso nem o cartão gravam retomada (o hook não grava)');
  assert.deepEqual(tipos('loop.parar'), [], 'pousar não é parar');
  // 5. cartão do `clear` (SessionStart real): retomada, regra e o MESMO instantâneo que o pouso devolveu
  assert.equal(o.cartao.rc, 0, o.cartao.err);
  const ctx = o.cartao.j.hookSpecificOutput.additionalContext;
  assert.ok(ctx.startsWith(`Loop da entrega ${ENTREGA} em pouso: rode loop.mjs proxima e siga.\n`), 'a linha de retomada vem primeiro');
  assert.ok(ctx.endsWith(o.pousar.j.instantaneo), 'o instantâneo do cartão é byte a byte o do `pousar` (mesma projeção, sem o hook ter gravado nada antes de ler)');
  assert.ok(ctx.length <= 4329, `contexto do cartão ${ctx.length} > 4329`);
  assert.deepEqual(o.eventosDoCartao.map((e) => [e.tipo, e.dados]), [['sessao.inicio', { origem: 'clear' }], ['guarda.heartbeat', { fonte: 'origin', divergente: false }]], 'o hook grava só o início e o heartbeat da sessão nova');
  // 6. `proxima` da sessão nova: o item implementador traz a regra; o de correção, não
  const itens = o.proximaDespacha.j.acao.itens;
  assert.equal(o.proximaDespacha.j.acao.tipo, 'despachar');
  const impl = itens.find((i) => i.papel === 'implementador');
  assert.deepEqual([impl.task, impl.aprendizados], ['T2', [REGRA]]);
  const corr = itens.find((i) => i.papel === 'correcao');
  assert.deepEqual([corr.task, corr.aprendizados], ['T1', []]);
  // 7. T3 integrada ⇒ o fechamento é pendência, ancorada na ÚLTIMA integração
  const integradas = tipos('task.integrada');
  assert.deepEqual(integradas.map((e) => e.dados.task), ['T1', 'T2', 'T3']);
  const ultima = integradas[integradas.length - 1];
  assert.deepEqual(o.proximaFechamento.j.acao, { tipo: 'aprender', pendencias: [{ sessao: ultima.sessao, seq: ultima.seq, tipo: 'fechamento' }] });
  // 8. `nada` fecha o fechamento (e só ele): o próximo passo é concluir
  const [nada] = tipos('aprendizado.nada');
  assert.deepEqual(nada.dados, { gatilho: { sessao: ultima.sessao, seq: ultima.seq }, motivo: 'nada novo no fechamento' });
  assert.deepEqual(o.proximaConcluir.j.acao, { tipo: 'concluir' });
  assert.equal(tipos('aprendizado').length, 1, 'o `nada` não cria aprendizado');
});

test('fumaca-doctor-pendencia-aberta: fechamento aberto ⇒ aviso com o comando que o fecha; depois do `nada` o aviso some; o nível não muda', () => {
  const ultima = tipos('task.integrada').at(-1);
  const aviso = o.doctorAberto.j.avisos.filter((a) => a.startsWith('aprendizado-sem-destino: '));
  assert.equal(aviso.length, 1, aviso.join('\n'));
  assert.equal(aviso[0], `aprendizado-sem-destino: aprendizados: entrega ${ENTREGA} com todas as tasks integradas e pendência de aprendizado aberta (fechamento ${ultima.sessao}:${ultima.seq}); feche com: loop.mjs aprendizado nada --gatilho ${ultima.sessao}:${ultima.seq} --motivo <texto> --entrega ${ENTREGA}`);
  const achado = (d) => d.j.resultados.find((r) => r.id === 'aprendizado-sem-destino');
  assert.equal(achado(o.doctorAberto).found, false);
  assert.equal(achado(o.doctorAberto).level, 'warn');
  assert.equal(o.comandoDoDoctor.includes(`--gatilho ${ultima.sessao}:${ultima.seq}`), true);
  // o comando que o aviso mandou rodar (o script o rodou) fechou a pendência: o aviso some, o check passa
  assert.deepEqual(o.doctorFechado.j.avisos.filter((a) => a.startsWith('aprendizado-sem-destino: ')), []);
  assert.equal(achado(o.doctorFechado).found, true);
  assert.match(achado(o.doctorFechado).evidence, /^1 entrega\(s\) lida\(s\), nada sem destino$/);
  // é aviso: o nível não muda
  assert.equal(o.doctorAberto.j.alcancado, o.doctorFechado.j.alcancado);
  assert.deepEqual(o.doctorAberto.j.novasFaltando, o.doctorFechado.j.novasFaltando);
});

test('fumaca-registro-deterministico: 2 execuções, mesmo sha256 e mesmos bytes; o sha é o do arquivo; seções e ordem por ts, não pela ordem dos arquivos', () => {
  assert.equal(o.registro1.j.arquivo, `.harness/entregas/${ENTREGA}/registro.md`);
  assert.equal(o.registro1.j.sha256, o.registro2.j.sha256, 'mesmo diário ⇒ mesmo sha256');
  assert.deepEqual(o.registroTexto1, o.registroTexto2, 'mesmos bytes');
  assert.equal(o.registro1.j.sha256, sha(o.registroTexto1), 'o sha256 devolvido é o dos bytes que estão no disco');
  const texto = o.registroTexto1.toString('utf8');
  const specSha = sha(readFileSync(join(AQUI, 'fumaca-e5', 'spec.md')));
  const [aprov] = tipos('spec.aprovada');
  assert.equal(aprov.dados.sha256, specSha);
  const [apr] = tipos('aprendizado');
  const [veredito] = tipos('review.veredito').filter((e) => e.dados.task === 'T1');
  const linhas = texto.split('\n');
  assert.equal(linhas[0], `# Registro de decisões — ${ENTREGA}`);
  assert.deepEqual(linhas.filter((l) => l.startsWith('## ')), ['## Aprovação da spec', '## Decisões da Sombra', '## Emendas', '## Liberações de teto', '## Desvios', '## Descobertas', '## Aprendizados D', '## Aprendizados M']);
  assert.ok(linhas.includes(`- ${aprov.sessao}:${aprov.seq} · spec docs/spec.md · sha256 ${specSha}`));
  assert.ok(linhas.includes(`- sha256 atual da spec: ${specSha} (confere com a última aprovação)`));
  assert.ok(linhas.includes(`- ${apr.sessao}:${apr.seq} · E · ${REGRA} · entra em: instantaneo, brief:implementador · sem medição · eventos: ${veredito.sessao}:${veredito.seq} · gatilho: ${veredito.sessao}:${veredito.seq}`));
  // as duas descobertas vêm de sessões `zeta` (antes) e `alfa` (depois): o arquivo de `alfa` vem primeiro em ordem alfabética, o registro segue o `ts`
  const zeta = linhas.indexOf('- zeta:1 · tecnica · primeira descoberta, da sessão zeta');
  const alfa = linhas.indexOf('- alfa:1 · regra_negocio · segunda descoberta, da sessão alfa');
  assert.ok(zeta > 0 && alfa > 0, texto);
  assert.ok(zeta < alfa, 'ordem do `ts`, não a do nome do arquivo');
  const dZeta = o.eventos.find((e) => e.sessao === 'zeta');
  const dAlfa = o.eventos.find((e) => e.sessao === 'alfa');
  assert.ok(Date.parse(dZeta.ts) < Date.parse(dAlfa.ts), 'a fixture é a que prova a ordem: zeta gravou antes de alfa');
  assert.ok(linhas.slice(linhas.indexOf('## Aprendizados M')).includes('- nenhum'), 'sem M: `- nenhum`');
  assert.ok(!texto.includes('nada novo no fechamento'), 'o `nada` não é decisão do registro');
});

const detectado = (c) => c.detectar.j;
const respondidas = (c) => Object.keys(c.respostas);

test('fumaca-onboarding-respostas: respostas montadas das perguntas REAIS de `detectar`; a config gravada é, byte a byte, a esperada; o dry-run não escreve', () => {
  const FIXAS = ['politica', 'autonomia', 'perfil'];
  for (const [nome, c] of Object.entries({ completa: o.onboarding.completa, monorepo: o.onboarding.monorepo, configAntiga: o.onboarding.configAntiga })) {
    const d = detectado(c);
    assert.equal(d.ok, true, nome);
    const ids = d.perguntas.map((p) => p.id);
    for (const f of FIXAS) assert.ok(ids.includes(f), `${nome}: falta a pergunta fixa ${f}`);
    // condicionais: 1 por fato aberto, no máximo até 5 perguntas no total
    const abertos = d.itens.filter((i) => i.estado !== 'detectado').map((i) => i.item);
    const condicionais = ids.filter((id) => !FIXAS.includes(id));
    assert.ok(ids.length <= 5, `${nome}: ${ids.length} perguntas`);
    assert.deepEqual(condicionais, abertos.slice(0, 5 - FIXAS.length), `${nome}: uma pergunta por fato aberto, na ordem dos itens`);
    assert.deepEqual(respondidas(c).sort(), [...ids].sort(), `${nome}: todas as perguntas respondidas, só elas`);
    for (const p of d.perguntas) assert.ok(p.opcoes.some((x) => x.valor === c.respostas[p.id]), `${nome}: ${p.id} fora das opções`);
    // o dry-run: ok, e NADA escrito
    assert.equal(c.seco.rc, 0, c.seco.out);
    assert.equal(c.seco.j.ok, true);
    assert.equal(c.seco.j.dryRun, true);
    assert.equal(c.aposSeco, c.antesTexto, `${nome}: o dry-run escreveu`);
    // a gravação: byte a byte a config das respostas
    assert.equal(c.gravar.rc, 0, c.gravar.out);
    assert.equal(c.gravar.j.ok, true);
    assert.equal(c.depois, configEsperada(c.config, d.itens, d.perguntas, c.respostas), `${nome}: config gravada difere da esperada`);
    assert.deepEqual(c.gravar.j.naoDetectado, JSON.parse(c.depois).onboarding.naoDetectado);
    assert.deepEqual(c.tmp, [], `${nome}: sobrou arquivo temporário`);
    assert.ok(!c.detectar.out.includes('SEGREDO-NAO-VAZAR') && !c.depois.includes('SEGREDO-NAO-VAZAR'), `${nome}: a URL do conector vazou`);
    assert.equal(JSON.parse(c.depois).versionamento?.branchPadrao, c.config.versionamento?.branchPadrao, `${nome}: o branchPadrao do dono não é reescrito`);
  }
  // completa: tudo detectado ⇒ só as 3 fixas; janela padrão porque a política escolhida é `janela` e a config não tinha uma
  const c = o.onboarding.completa;
  assert.deepEqual(c.detectar.j.perguntas.map((p) => p.id).sort(), [...FIXAS].sort());
  assert.deepEqual(c.detectar.j.itens.map((i) => i.estado), ['detectado', 'detectado', 'detectado', 'detectado', 'detectado']);
  const cfg = JSON.parse(c.depois);
  assert.deepEqual([cfg.entrega.politica, cfg.entrega.autonomia, cfg.entrega.base], ['janela', true, 'trunk']);
  assert.deepEqual(cfg.entrega.janela, { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '17:00', fuso: 'UTC' });
  assert.equal(cfg.orquestracao.perfil, c.respostas.perfil);
  assert.deepEqual(cfg.onboarding.naoDetectado, []);
  assert.equal(cfg.fluxo.mcp, 'claude.ai ClickUp');
  // monorepo: 3 fixas + os 2 primeiros fatos abertos; o 3º aberto não é perguntado, fica nao_detectado e nada é gravado para ele
  const m = o.onboarding.monorepo;
  assert.equal(m.detectar.j.perguntas.length, 5);
  assert.deepEqual(m.detectar.j.itens.map((i) => [i.item, i.estado]), [['tipo_repo', 'ambiguo'], ['ambientes', 'nao_detectado'], ['planejamento', 'nao_detectado'], ['versionamento', 'detectado'], ['orquestracao', 'detectado']]);
  const mc = JSON.parse(m.depois);
  assert.equal(mc.perfil, 'repo-sem-app', 'tipo_repo respondido com o candidato que não é o default');
  assert.deepEqual(mc.onboarding.naoDetectado, ['ambientes', 'planejamento']);
  assert.equal(mc.fluxo.ferramenta, undefined, 'planejamento não resolvido: nada gravado para ele');
});

test('fumaca-onboarding-config-1-1-x-como-default: config da 1.1.x ⇒ respostas default preservam a política, ligam a autonomia e não mexem no que é do dono', () => {
  const c = o.onboarding.configAntiga;
  const antes = o.onboarding.configAntigaAntes;
  // os defaults vêm da config existente, lidos da pergunta real
  const por = Object.fromEntries(c.detectar.j.perguntas.map((p) => [p.id, p]));
  assert.equal(por.politica.default, 'continua');
  assert.equal(por.autonomia.default, true, 'a 1.1 que já subia sozinha mantém a escolha');
  assert.equal(por.perfil.default, 'padrao');
  assert.deepEqual(c.respostas, { politica: 'continua', autonomia: true, perfil: 'padrao' });
  const cfg = JSON.parse(c.depois);
  assert.deepEqual(cfg.entrega, { politica: 'continua', autonomia: true, base: 'trunk' });
  // o que era do dono fica como estava
  assert.equal(cfg._comment, antes._comment);
  assert.deepEqual(cfg.gates, antes.gates);
  assert.deepEqual(cfg.versionamento, { ...antes.versionamento, resolvidoEm: '2026-11-09' }, 'branchPadrao e tiposComEscopoDePbi intactos');
  assert.deepEqual([cfg.fluxo.idPadrao, cfg.fluxo.ledgerDir, cfg.fluxo.envelhecimentoDias], ['^[A-Z]+-\\d+$', 'docs/ledgers', 3]);
  assert.deepEqual(cfg.orquestracao.paralelismo, { simultaneos: 3, teto: 4 });
  assert.equal(cfg.orquestracao.modelo.validadeDias, 60);
  assert.equal(cfg.orquestracao.modelo.resolvidoEm, '2026-11-09');
  assert.equal(cfg.orquestracao.perfil, 'padrao');
});

test('fumaca-escolher-e-nao-chuta: a resposta que não está nas opções reais é erro, não valor gravado', () => {
  const p = { id: 'politica', opcoes: [{ valor: 'a' }, { valor: 'b' }], default: 'a' };
  assert.equal(escolher(p, 'default'), 'a');
  assert.equal(escolher(p, 'ultima'), 'b');
  assert.equal(escolher(p, 'outra'), 'b');
  assert.equal(escolher(p, { valor: 'b' }), 'b');
  assert.throws(() => escolher(p, { valor: 'c' }), /não está nas opções/);
});

test('fumaca-limpa-o-temporario: o diretório da caminhada existe durante os testes; limpar() o apaga e recusa qualquer outro caminho', () => {
  assert.ok(existsSync(o.base), 'o repo descartável existe enquanto os testes rodam');
  const falso = mkdtempSync(join(tmpdir(), 'fumaca-e5-limpeza-'));
  writeFileSync(join(falso, 'x'), 'x');
  limpar({ base: falso });
  assert.equal(existsSync(falso), false, 'apagado');
  assert.throws(() => limpar({ base: AQUI }), /recuso apagar/, 'a pasta de testes nunca é apagada');
  assert.throws(() => limpar({ base: join(tmpdir(), 'qualquer-coisa') }), /recuso apagar/, 'nome fora do padrão fumaca-e5-*');
  assert.ok(existsSync(AQUI));
});

test('fumaca-limpa-o-temporario-quando-a-caminhada-falha: erro no meio ⇒ a falha original sobe e nenhum <tmp>/fumaca-e5-* novo fica', () => {
  const sobras = () => readdirSync(tmpdir()).filter((n) => n.startsWith('fumaca-e5-'));
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

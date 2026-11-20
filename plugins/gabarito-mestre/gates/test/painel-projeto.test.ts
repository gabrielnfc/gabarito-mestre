/**
 * Render e CLI da visão de projeto (GM-15 T32, REQ-ENT-2 emenda 4 itens 1 a 5, D-G3; emendas 18 e 19). O núcleo puro é `projeto.ts` (T31, `projeto.test.ts`);
 * aqui o que a T32 faz: DESENHAR (`renderBlocos` em `painel-esquadrao.ts`, layout E4) e LIGAR ao CLI (`painel.mjs`: `git worktree list`, cards FL1, planos, diário).
 * A correção de render é provada na saída DESENHADA (`renderPainel` + `paraTexto`), não só na função pura; a do CLI, pelo script real (rc, stdout).
 *
 * Mutações nomeadas (cada uma mata ao menos o teste indicado; roteiro em .claude-tmp/t32/mut.mjs, fora do repo):
 *  N1  o render ignora `estado.projeto` (nada desenhado)                          ⇒ projeto-n-pbis-feitas-total
 *  N2  PBI sem plano desenhado com "0 %"                                          ⇒ pbi-sem-plano-fora-da-conta
 *  N3  o total não diz quantos PBIs ficam fora da conta                           ⇒ pbi-sem-plano-fora-da-conta
 *  N4  FASE n de 7 mesmo sem plano.json (flag `temPlanoJson` ignorada)            ⇒ entrega-sem-plano-fase-nao-medida
 *  N5  "fase não medida" também com plano.json                                    ⇒ entrega-sem-plano-fase-nao-medida
 *  N6  agente sem `iniciar` continua "sem task"                                   ⇒ agente-fora-do-loop
 *  N7  agente com task iniciada vira "agente fora do loop"                        ⇒ agente-fora-do-loop
 *  N8  largura estreita desenha 1 linha por PBI (não resume)                      ⇒ projeto-estreito-resume-em-1-linha
 *  N9  largura estreita some com os totais                                        ⇒ projeto-estreito-resume-em-1-linha
 *  N10 previsão medida sem marcar "(medida)" / estimada sem "~"                   ⇒ projeto-previsao-medida-e-estimada
 *  N11 as linhas do projeto cortam DEPOIS do RECENTE (prioridade D-P8 invertida)  ⇒ projeto-corta-antes-da-entrega
 *  N12 CLI lê só a árvore atual (porcelana ignorada)                              ⇒ worktrees-varridas
 *  N13 falha do git sem aviso                                                     ⇒ git-worktree-falha-avisa
 *  N14 CLI não liga o projeto ao `texto` (só ao `estado`)                         ⇒ cli-script-real-texto-e-estado
 *  N15 projeto com 1 PBI desenhado (sem o mínimo de 2)                            ⇒ projeto-1-pbi-nao-aparece
 *  N23 renderEsquadrao (legado) escreve "sem task"                              ⇒ agente-fora-do-loop-legado
 *  N24 renderExecutivo escreve "sem task"                                   ⇒ agente-fora-do-loop-legado
 *  N25 o legado/executivo ignora o estado da task (pendente mostra o id)      ⇒ agente-fora-do-loop-legado
 *  N16 a CLI usa o plano.json da árvore atual em vez do commit mais recente       ⇒ cli-plano-de-commit-mais-recente
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projetarPainel, renderPainel } from '../src/painel.ts';
import { paraTexto } from '../src/painel-texto.ts';
import { renderEsquadrao } from '../src/painel-esquadrao.ts';
import { renderExecutivo } from '../src/painel-executivo.ts';
import { EXTRAS } from './painel-fixtures/estados.ts';
import { colunas } from '../src/painel-largura.ts';
import { planoMdDoCard, projetarProjeto, ROTULO_FASE_NAO_MEDIDA, ROTULO_FORA_DO_LOOP, worktreesDe } from '../src/projeto.ts';
import type { ArvoreLida, EstadoProjeto } from '../src/projeto.ts';
import type { AgenteVivo, EntradaPainel, EstadoPainel, Evento, OpcoesRender, Plano, TipoEvento } from '../src/tipos.ts';
import type { FatosTrilha } from '../src/trilha.ts';
// @ts-expect-error: script .mjs sem tipos
import { estadoDoPainel, main } from '../scripts/painel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIX = join(AQUI, 'fixtures', 'projeto');
const SCRIPT = join(AQUI, '..', 'scripts', 'painel.mjs');
const AGORA_P = Date.parse('2026-11-10T15:00:00.000Z');
const OPC = { agoraMs: AGORA_P, fuso: 'America/Sao_Paulo' };

// ───────────────────────────── a fixture do núcleo (T31) lida como a borda lê

function lerArvore(nome: string): ArvoreLida {
  const raiz = join(FIX, nome);
  const cards = existsSync(join(raiz, 'cards'))
    ? readdirSync(join(raiz, 'cards')).sort().map((arquivo) => {
      const texto = readFileSync(join(raiz, 'cards', arquivo), 'utf8');
      const md = planoMdDoCard(texto);
      return { arquivo, texto, planoMd: md !== null && existsSync(join(raiz, md)) ? readFileSync(join(raiz, md), 'utf8') : null };
    })
    : [];
  const entregas = existsSync(join(raiz, 'entregas'))
    ? readdirSync(join(raiz, 'entregas')).sort().map((id) => {
      const dir = join(raiz, 'entregas', id);
      let plano: ArvoreLida['entregas'][number]['plano'] = null;
      if (existsSync(join(dir, 'plano.json'))) {
        try { plano = { ok: true, bruto: JSON.parse(readFileSync(join(dir, 'plano.json'), 'utf8')) }; } catch (err) { plano = { ok: false, motivo: `plano.json ilegível: ${(err as Error).message}` }; }
      }
      const eventos: Evento[] = [];
      for (const f of readdirSync(dir).filter((x) => x.startsWith('events.')).sort()) for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) if (l.trim() !== '') eventos.push(JSON.parse(l));
      return { id, plano, eventos };
    })
    : [];
  return { caminho: `/FIX/${nome}`, cards, entregas };
}
const PORCELANA = readFileSync(join(FIX, 'worktrees.txt'), 'utf8');
function projetoDaFixture(): EstadoProjeto {
  const wt = worktreesDe({ ok: true, saida: PORCELANA }, '/FIX/principal');
  return projetarProjeto(wt.caminhos.map((c) => lerArvore(c.replace('/FIX/', ''))), OPC);
}

// ───────────────────────────── o estado do painel (projetarPainel real) com o projeto colado

const T0 = Date.parse('2026-11-11T12:00:00Z');
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const AGORA = T0 + 3 * 3_600_000;
type Item = { t: number; tipo: TipoEvento; dados?: unknown };
const ev = (t: number, tipo: TipoEvento, dados: unknown = {}): Item => ({ t, tipo, dados });
function D(itens: Item[]): Evento[] {
  return itens.map((x, i) => ({ seq: i + 1, ts: iso(x.t), autor: 't', sessao: 's1', agente: 'orquestrador', tipo: x.tipo, dados: x.dados, hash_anterior: null }) as unknown as Evento);
}
const ini = (t: number, task: string, papel = 'implementador'): Item => ev(t, 'task.iniciada', { task, papel });
const ciclo = (task: string, a: number): Item[] => [
  ini(a, task), ev(a + 1, 'task.concluida', { task }), ini(a + 2, task, 'revisor'),
  ev(a + 5, 'review.veredito', { task, veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }), ev(a + 6, 'task.integrada', { task }),
];
const IDS = ['T1', 'T2', 'T3', 'T4'];
const P = (...ids: string[]): Plano => ({ entrega: 'GM-14', tasks: ids.map((id) => ({ id, deps: [], arquivos: [] })) });
const PACOTE = { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['ARAGORN', 'LEGOLAS', 'GIMLI', 'FRODO'] };
const fatos = (extra: Partial<FatosTrilha> = {}): FatosTrilha => ({
  branch: 'enabler/GM-14-clareza', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: IDS }, ledger: false, gh: 'ok', ultimas: [], sessao: 's1', ...extra,
});
const entrada = (extra: Record<string, unknown> = {}): EntradaPainel & { fatos: FatosTrilha } => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: 40, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
  pacote: PACOTE, notificacao: null, agoraMs: AGORA, fuso: 'UTC', titulo: null, politica: { politica: 'continua', dias: null },
  entregaId: 'GM-14', modeloSessao: null, specSha: null, tetoSombra: 26, fatos: fatos(), ...extra,
}) as unknown as EntradaPainel & { fatos: FatosTrilha };
const vivo = (description: string): AgenteVivo => ({ id: `a-${description}`, type: 'general-purpose', description, status: 'running', uso: null });
const comProjeto = (s: EstadoPainel, projeto: EstadoProjeto | null, extra: Record<string, unknown> = {}): EstadoPainel => ({ ...s, projeto, ...extra }) as EstadoPainel;
const estadoComPlano = (itens: Item[], extra: Record<string, unknown> = {}): EstadoPainel => projetarPainel(P(...IDS), D(itens), entrada(extra));

const SEP = /^─+$/;
const cru = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string[] =>
  paraTexto(renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 120, ...o }), 'mono').split('\n').filter((l) => l !== '');
const linhas = (s: EstadoPainel, o: Partial<OpcoesRender> = {}): string[] => cru(s, o).filter((l) => !SEP.test(l));
const doProjeto = (ls: string[]): string[] => ls.filter((l) => /^PROJETO|^PBIs |^ {2}[✓●○?] PBI-|^ {2}[✓●○?] GM-|^ {2}previsão|^ {2}~\d+ tasks estimadas|^ {2}✓ \d+ feitos?$|· \d+ abertos?$/.test(l));
/** Linhas do projeto em ≥ 72 colunas: totais, previsão (a), previsão estimada (b) quando há PBI sem plano aberto, e 1 por PBI. */
const nLinhasProjeto = (pr: EstadoProjeto): number =>
  2 + (pr.totais.previsao.estimada !== null ? 1 : 0) + (pr.totais.feitos > 0 ? 1 : 0) + pr.linhas.filter((l) => !l.feito).length + pr.grupos.length;

// ───────────────────────────── render: a visão de projeto

test('projeto-n-pbis-feitas-total: totais (N de M PBIs feitos, % e restantes) e 1 linha por PBI/entrega, no desenho do E4', () => {
  const pr = projetoDaFixture();
  const s = comProjeto(estadoComPlano([...ciclo('T1', 0), ini(20, 'T2')]), pr);
  const ls = linhas(s);
  const tot = ls.find((l) => /^PROJETO/.test(l)) as string;
  assert.ok(tot, ls.join('\n'));
  const t = pr.totais;
  assert.match(tot, new RegExp(`^PROJETO {2}${t.feitos} de ${t.pbis} PBIs feitos · ${t.pct}% das tasks \\(${t.integradas} de ${t.tasks}, \\+${t.estimadas} estimadas\\) · ${t.restantes} restantes`));
  assert.equal(t.pbis, 6);
  assert.equal(t.feitos, 1);
  assert.equal(nLinhasProjeto(pr), 9, 'fixture GM-15: 2 totais + estimada + feitos + 5 abertos');
  assert.equal(doProjeto(ls).length, 9);
  // 1 linha por PBI ABERTO, na ordem do projeto (o feito sai do desenho, REQ-PRJ-3 a); id, título do card e o texto da linha (o que o núcleo diz)
  const porPbi = ls.filter((l) => /^ {2}[✓●○?] PBI-/.test(l));
  assert.deepEqual(porPbi.map((l) => /PBI-\d/.exec(l)?.[0]), ['PBI-2', 'PBI-3', 'PBI-4', 'PBI-5', 'PBI-6']);
  assert.ok(ls.every((l) => !l.includes('PBI-1 ')), ls.join('\n'));
  for (const l of pr.linhas.filter((x) => !x.feito)) {
    const d = porPbi.find((x) => x.includes(`${l.id} `)) as string;
    assert.ok(d.trimEnd().endsWith(l.texto), `${l.id}: "${d}" não termina em "${l.texto}"`);
    if (l.titulo !== null) assert.ok(d.includes(l.titulo.slice(0, 8)), `${l.id}: título ausente em "${d}"`);
  }
  // glifos: feito ✓, com plano ●, sem plano ○, plano inválido ?
  // o feito: exatamente 1 linha "✓ 1 feito", logo depois da última linha de totais
  assert.equal(ls.filter((l) => /^ {2}✓ 1 feito$/.test(l)).length, 1, ls.join('\n'));
  const iFeito = ls.findIndex((l) => /^ {2}✓ 1 feito$/.test(l));
  assert.match(ls[iFeito - 1], /^ {2}~\d+ tasks estimadas/);
  assert.match(ls[iFeito + 1], /^ {2}● PBI-2 /);
  assert.match(porPbi.find((l) => l.includes('PBI-2 ')) as string, /^ {2}● /);
  assert.match(porPbi.find((l) => l.includes('PBI-3 ')) as string, /^ {2}○ /);
  assert.match(porPbi.find((l) => l.includes('PBI-6 ')) as string, /^ {2}\? /);
  // o projeto fica ACIMA da visão de entrega (PLANO) e a visão de entrega segue igual
  const iProj = ls.findIndex((l) => /^PROJETO/.test(l));
  assert.ok(iProj >= 0 && iProj < ls.findIndex((l) => /^PLANO/.test(l)), 'projeto acima do PLANO');
  assert.match(ls.join('\n'), /^PLANO {3}▰+▱+ +25% +1\/4 tasks/m);
});

test('pbi-sem-plano-fora-da-conta: "sem plano" no desenho, nunca 0 %; o total diz quantos PBIs ficam fora da conta', () => {
  const pr = projetoDaFixture();
  const ls = linhas(comProjeto(estadoComPlano([ini(0, 'T1')]), pr));
  for (const id of ['PBI-3', 'PBI-5']) {
    const d = ls.find((l) => l.includes(`${id} `)) as string;
    assert.match(d, /sem plano$/);
    assert.doesNotMatch(d, /0 ?%/);
  }
  const tot = ls.find((l) => /^PROJETO/.test(l)) as string;
  assert.match(tot, new RegExp(`· ${pr.totais.foraDaConta} sem plano, fora da conta$`));
  assert.equal(pr.totais.foraDaConta, 3);
  // o plano inválido mostra "?" (o motivo técnico fica no estado, não na linha) e também fica fora da conta
  const inv = ls.find((l) => l.includes('PBI-6 ')) as string;
  assert.match(inv, /\? plano inválido/);
  // nenhuma linha do projeto escreve "0 %" ou "0%" para PBI sem plano
  assert.ok(doProjeto(ls).every((l) => !/PBI-(3|5|6) .*\b0 ?%/.test(l)), doProjeto(ls).join('\n'));
});

test('projeto-previsao-medida-e-estimada: a previsão marca "(medida)"; a parte dos PBIs sem plano vem com "~" e "estimadas"; sem ritmo, "?"', () => {
  const pr = projetoDaFixture();
  const p = pr.totais.previsao;
  assert.ok(p.medida !== null, 'a fixture tem task integrada (ritmo medido)');
  assert.ok(p.estimada !== null, 'a fixture tem PBI sem plano aberto');
  const ls = linhas(comProjeto(estadoComPlano([ini(0, 'T1')]), pr));
  assert.ok(ls.includes(`  previsão ${p.medida.hora} (medida)`), ls.join('\n'));
  assert.ok(ls.includes(`  ${p.estimada.texto}`), ls.join('\n'));
  assert.match(p.estimada.texto, /^~\d+ tasks estimadas em \d+ PBIs sem plano, até ~/);
  // sem task integrada em nenhuma entrega ⇒ "?" com o motivo (≥ 100 colunas), nunca um horário inventado
  const semRitmo = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-1.md', texto: '---\nid: "PBI-1"\nstatus: Em execução\n---\n# A\n', planoMd: null },
    { arquivo: 'PBI-2.md', texto: '---\nid: "PBI-2"\nstatus: Backlog\n---\n# B\n', planoMd: null }], entregas: [] }], OPC);
  assert.equal(semRitmo.totais.previsao.ritmoS, null);
  const t2 = doProjeto(linhas(comProjeto(estadoComPlano([ini(0, 'T1')]), semRitmo))).join('\n');
  assert.match(t2, /^ {2}previsão \? \(sem ritmo medido\)$/m);
  assert.doesNotMatch(t2, /\(medida\)|~/);
});

test('projeto-estreito-resume-em-1-linha: abaixo de 72 colunas o projeto é 1 linha de totais; a visão de entrega segue na prioridade D-P8; cada linha cabe', () => {
  const pr = projetoDaFixture();
  const s = comProjeto(estadoComPlano([ini(0, 'T1')]), pr);
  for (const w of [71, 60, 50, 44]) {
    const ls = linhas(s, { largura: w });
    assert.equal(doProjeto(ls).length, 1, `w=${w}: ${doProjeto(ls).join(' | ')}`);
    assert.match(doProjeto(ls)[0], new RegExp(`^PROJETO ${pr.totais.feitos}/${pr.totais.pbis} PBIs`));
    assert.ok(ls.every((l) => colunas(l) <= w), `w=${w}: ${ls.filter((l) => colunas(l) > w).join(' | ')}`);
    assert.ok(ls.some((l) => /^PLANO/.test(l)), `w=${w}: a visão de entrega continua`);
  }
  // abaixo de 44: só a contagem, sem moldura
  const min = linhas(s, { largura: 40 });
  assert.equal(doProjeto(min).length, 1);
  assert.match(doProjeto(min)[0], new RegExp(`^PBIs ${pr.totais.feitos}/${pr.totais.pbis}`));
  assert.ok(min.every((l) => colunas(l) <= 40));
  // largura de cada elemento, em 72+: totais e linhas de PBI cabem na coluna
  for (const w of [72, 80, 100, 120, 200]) {
    const ls = linhas(s, { largura: w });
    assert.equal(doProjeto(ls).length, nLinhasProjeto(pr), `w=${w}`);
    assert.ok(ls.every((l) => colunas(l) <= w), `w=${w}: ${ls.filter((l) => colunas(l) > w).join(' | ')}`);
  }
});

test('projeto-corta-antes-da-entrega: com pouca altura as linhas do projeto saem antes do RECENTE e dos agentes; o topo nunca', () => {
  const pr = projetoDaFixture();
  const s = comProjeto(estadoComPlano([...ciclo('T1', 0), ini(20, 'T2')], { agentes: [vivo('T2 implementador')] }), pr);
  const cheio = linhas(s);
  const recente = cheio.filter((l) => /^(\d\d:\d\d|\?) [✓✗●○?] /.test(l));
  assert.ok(recente.length > 0, cheio.join('\n'));
  assert.ok(cheio.some((l) => /^[├└]─ ● /.test(l)));
  // orçamento que tira SÓ as linhas por PBI: o PLANO, os agentes, o RECENTE e os totais do projeto ficam
  const sem = linhas(s, { orcamento: cheio.length - 5 });
  assert.equal(sem.filter((l) => /^ {2}[✓●○?] PBI-/.test(l)).length, 0, `as linhas por PBI saem primeiro: ${sem.join('\n')}`);
  assert.equal(sem.filter((l) => /^PROJETO/.test(l)).length, 1);
  assert.equal(sem.filter((l) => /^ {2}✓ 1 feito$/.test(l)).length, 1, 'o feito (6.95) fica quando só as linhas de PBI (6.96) saem');
  assert.ok(sem.some((l) => /^PLANO/.test(l)));
  assert.ok(sem.some((l) => /^[├└]─ ● /.test(l)));
  assert.equal(sem.filter((l) => /^(\d\d:\d\d|\?) [✓✗●○?] /.test(l)).length, recente.length, 'o RECENTE não perde linha por causa do projeto');
  assert.ok(sem.some((l) => /^CI ●/.test(l)) && sem.some((l) => /orquestra/.test(l)), 'o rodapé e o nome do orquestrador (6.x do E4) ficam: o projeto cai antes deles');
  // mais as linhas dos totais: caem os totais do projeto, nada da entrega (o RECENTE e os agentes seguem)
  const apertado = linhas(s, { orcamento: cheio.length - nLinhasProjeto(pr) });
  assert.equal(doProjeto(apertado).length, 0, apertado.join('\n'));
  assert.equal(apertado.filter((l) => /^(\d\d:\d\d|\?) [✓✗●○?] /.test(l)).length, recente.length);
  assert.ok(apertado.some((l) => /^CI ●/.test(l)) && apertado.some((l) => /^[├└]─ ● /.test(l)));
});

test('projeto-1-pbi-nao-aparece: com 0 ou 1 PBI a visão de entrega já é o projeto; nada de PROJETO; sem `projeto` no estado também', () => {
  const um = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-1.md', texto: '---\nid: "PBI-1"\nstatus: Em execução\n---\n# A\n', planoMd: null }], entregas: [] }], OPC);
  assert.equal(um.linhas.length, 1);
  for (const pr of [um, projetarProjeto([], OPC), null]) {
    const ls = linhas(comProjeto(estadoComPlano([ini(0, 'T1')]), pr));
    assert.equal(doProjeto(ls).length, 0, ls.join('\n'));
  }
  assert.equal(doProjeto(linhas(estadoComPlano([ini(0, 'T1')]))).length, 0);
});

test('projeto-sem-entrega-em-curso: o projeto vem ACIMA da linha única "sem entrega em curso", que segue 1 linha e é a última (emenda 4; o caso do repo com main e nada em curso)', () => {
  const pr = projetoDaFixture();
  const base = projetarPainel(null, null, entrada({ fatos: fatos({ plano: null, branch: 'main' }), entregaId: null, ultima: null, fora: false }));
  const s = comProjeto({ ...base, umaLinha: { ultima: null } } as unknown as EstadoPainel, pr);
  for (const w of [120, 72, 60, 40]) {
    const ls = linhas(s, { largura: w });
    assert.equal(ls[ls.length - 1], 'GABARITO · sem entrega em curso', `w=${w}`);
    assert.equal(ls.filter((l) => /^GABARITO/.test(l)).length, 1, `w=${w}: a linha única é 1 só`);
    assert.equal(doProjeto(ls).length, w >= 72 ? nLinhasProjeto(pr) : 1, `w=${w}: ${ls.join(' | ')}`);
    assert.ok(ls.every((l) => colunas(l) <= w), `w=${w}`);
  }
  // sem projeto (ou com 1 PBI): exatamente a linha única de antes
  assert.deepEqual(linhas(comProjeto({ ...base, umaLinha: { ultima: null } } as unknown as EstadoPainel, null)), ['GABARITO · sem entrega em curso']);
});

test('projeto-entregue: a linha "<ID> entregue" também leva o projeto acima; com o botão "seguir" (◆) ela fica 1ª e o projeto abaixo, para o mod achar o topo', () => {
  const pr = projetoDaFixture();
  // nada vivo, nada pendente além da entrega: a condição da linha única (`linhaEntregue`)
  const base = { ...estadoComPlano([ini(0, 'T1')]), agora: { agentes: [], segundoPlano: [], orquestrador: null }, atencao: [], pergunta: null, depende: [] } as unknown as EstadoPainel;
  const entregue = { id: 'GM-14', versao: '2.1.0' };
  const s = comProjeto({ ...base, entregue, proxima: { tipo: 'nenhuma', texto: 'nada pendente', acoes: [] } } as unknown as EstadoPainel, pr);
  const ls = linhas(s);
  assert.match(ls[ls.length - 1], /^GABARITO · GM-14 entregue \(versão 2\.1\.0\)/);
  assert.equal(doProjeto(ls).length, nLinhasProjeto(pr), ls.join('\n'));
  assert.equal(ls.filter((l) => /^GABARITO/.test(l)).length, 1);
  // estreito: --largura vale (nunca largura fixa); abaixo de 72 o projeto é 1 linha, abaixo de 44 só a contagem; cada linha cabe
  for (const w of [60, 40]) {
    const le = linhas(s, { largura: w });
    assert.equal(doProjeto(le).length, 1, `w=${w}: ${le.join(' | ')}`);
    assert.ok(le.every((l) => colunas(l) <= w), `w=${w}: ${le.filter((l) => colunas(l) > w).join(' | ')}`);
    assert.match(le[le.length - 1], /^GABARITO · GM-14 entregue/);
  }
  // com botão: item do dono (◆) é a 1ª linha
  const comBotao = comProjeto({ ...base, entregue, proxima: { tipo: 'entrega', texto: 'GM-15', acoes: [{ rotulo: 'seguir', comando: 'x' }] }, depende: [{ motivo: 'próxima entrega: GM-15', nivel: 'item', acoes: [{ rotulo: 'seguir', comando: 'x' }] }] } as unknown as EstadoPainel, pr);
  const lb = linhas(comBotao);
  assert.match(lb[0], /^◆ GABARITO · GM-14 entregue/);
  assert.equal(doProjeto(lb).length, nLinhasProjeto(pr));
  assert.equal(lb.filter((l) => /GABARITO/.test(l)).length, 1);
});

// ───────────────────────────── render: itens 4 e 5 (rótulos)

const FASE_SPEC = { caminho: 'docs/superpowers/specs/x.md', pbi: 'GM-14', sha256: 'a'.repeat(64), secoes: 6, titulo: 'Clareza' };
const estadoFase = (extra: Record<string, unknown> = {}): EstadoPainel =>
  projetarPainel(null, D([ev(1, 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } })]), entrada({ fatos: fatos({ plano: null, specs: [FASE_SPEC] }), ...extra }));

test('entrega-sem-plano-fase-nao-medida: sem plano.json o desenho diz "fase não medida" em vez de "FASE n de 7"; com plano.json (ou sem a marca) segue "FASE n de 7"', () => {
  const s = estadoFase();
  assert.equal(s.pronto, null);
  const sem = linhas({ ...s, temPlanoJson: false } as EstadoPainel).find((l) => /^fase não medida/.test(l)) as string;
  assert.ok(sem, linhas({ ...s, temPlanoJson: false } as EstadoPainel).join('\n'));
  assert.equal(sem.startsWith(ROTULO_FASE_NAO_MEDIDA), true);
  assert.match(sem, /spec com 6 seções · falta aprovar/);
  assert.ok(linhas({ ...s, temPlanoJson: false } as EstadoPainel).every((l) => !/FASE \d de 7|FASE \? de 7/.test(l)));
  // com plano.json a regra de antes: n de 7 (a trilha mede)
  for (const marca of [{ temPlanoJson: true }, {}]) {
    const com = linhas({ ...s, ...marca } as EstadoPainel, { largura: 200 }).find((l) => /^FASE/.test(l)) as string;
    assert.equal(com, 'FASE 3 de 7 ▰▰▱▱▱▱▱ · spec com 6 seções · falta aprovar · ✓ ideia › ✓ spec › ● aprovação › ○ plano › ○ execução › ○ PR › ○ uso');
  }
  // o rótulo cabe em qualquer largura (número nunca cortado; a linha cortada termina em "…")
  for (const w of [44, 60, 80, 120]) assert.ok(linhas({ ...s, temPlanoJson: false } as EstadoPainel, { largura: w }).every((l) => colunas(l) <= w));
  // a MESMA função do núcleo: o texto do desenho é o `rotuloFase`
  assert.equal(ROTULO_FASE_NAO_MEDIDA, 'fase não medida');
});

test('agente-fora-do-loop: agente vivo sem `loop.mjs iniciar` (task pendente ou sem task) escreve "agente fora do loop"; com a task iniciada, o id da task', () => {
  // T1 integrada, T2 iniciada (loop.mjs iniciar), T3 pendente; 3 agentes vivos: um por task + um sem task
  const s = estadoComPlano([...ciclo('T1', 0), ini(20, 'T2')], { agentes: [vivo('T2 implementador'), vivo('T3 implementador'), vivo('Explorar o repositório')] });
  const ag = linhas(comProjeto(s, null)).filter((l) => /^[├└]─ ● /.test(l));
  assert.equal(ag.length, 3, ag.join('\n'));
  assert.ok(ag.some((l) => / T2 /.test(l)), `a T2 iniciada mostra a task: ${ag.join('\n')}`);
  const fora = ag.filter((l) => l.includes(ROTULO_FORA_DO_LOOP));
  assert.equal(fora.length, 2, `T3 pendente e o sem task: ${ag.join('\n')}`);
  assert.ok(ag.every((l) => !/sem task/.test(l)), ag.join('\n'));
  assert.ok(!ag.some((l) => / T3 /.test(l)), 'a T3 não foi iniciada: não é "T3"');
  // estreito (44): o rótulo também, sem cortar o nome do agente
  const est = linhas(comProjeto(s, null), { largura: 60 }).filter((l) => /^[├└]─? ● /.test(l));
  assert.ok(est.some((l) => l.includes(ROTULO_FORA_DO_LOOP)), est.join('\n'));
  assert.ok(est.every((l) => colunas(l) <= 60));
});

// ───────────────────────────── a borda: painel.mjs com repositório git real

const g = (dir: string, ...a: string[]): string => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const FL1 = 'docs/fluxo/pbis';
const card = (id: string, status: string, atualizadoEm: string, titulo: string, plano = 'a escrever'): string =>
  `---\nid: "${id}"\ntipo: US\nstatus: ${status}\natualizadoEm: "${atualizadoEm}"\n---\n# ${titulo}\nFL1 · User Story. Plano: ${plano} · Ledger: \`l.md\`.\n`;
const planoJson = (id: string, n: number): string => JSON.stringify({ entrega: id, tasks: Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, titulo: `t${i + 1}`, deps: [], arquivos: [`a${i + 1}.ts`] })) });

/** Repo descartável com origin (config com `fluxo.mapeamento.FL1`), 3 cards na árvore principal e uma worktree com o card do PBI-4. Branch `feat/PBI-2-x`. */
function montarRepo(opts: { semFL1?: boolean; fl1?: string; painel?: unknown; fluxoExtra?: Record<string, unknown>; mapeamentoExtra?: Record<string, unknown>; arquivos?: Record<string, string> } = {}): { repo: string; wt: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'painel projeto ')));
  const repo = join(base, 'repo com espaço');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'feat/PBI-2-x');
  g(repo, 'config', 'user.email', 't@t.test');
  g(repo, 'config', 'user.name', 't');
  g(repo, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, FL1), { recursive: true });
  writeFileSync(join(repo, FL1, 'PBI-1.md'), card('PBI-1', 'Concluído', '2026-11-01', 'Login do atleta'));
  writeFileSync(join(repo, FL1, 'PBI-2.md'), card('PBI-2', 'Em execução', '2026-11-02', 'Perfil'));
  writeFileSync(join(repo, FL1, 'PBI-3.md'), card('PBI-3', 'Backlog', '2026-11-02', 'Treino semanal'));
  mkdirSync(join(repo, 'docs', 'superpowers', 'specs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'superpowers', 'specs', '2026-11-12-pbi2.md'), `# Perfil\n\nPBI: PBI-2\n\n${'## seção\n\ntexto\n\n'.repeat(2)}`);
  writeFileSync(join(repo, 'README.md'), 'x\n');
  for (const [rel, txt] of Object.entries(opts.arquivos ?? {})) { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), txt); }
  const cfg = { fluxo: opts.semFL1 === true ? {} : { mapeamento: { FL1: opts.fl1 ?? `${FL1}/`, ...(opts.mapeamentoExtra ?? {}) }, ...(opts.fluxoExtra ?? {}) }, ...(opts.painel === undefined ? {} : { painel: opts.painel }) };
  writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(cfg));
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'inicio');
  const bare = join(base, 'origin.git');
  mkdirSync(bare);
  g(bare, 'init', '-q', '--bare', '-b', 'feat/PBI-2-x');
  g(repo, 'remote', 'add', 'origin', bare);
  g(repo, 'push', '-q', 'origin', 'feat/PBI-2-x');
  g(repo, 'remote', 'set-head', 'origin', 'feat/PBI-2-x');
  const wt = join(base, 'wt-pbi-4');
  g(repo, 'worktree', 'add', '-q', '-b', 'wt/PBI-4-1', wt);
  writeFileSync(join(wt, FL1, 'PBI-4.md'), card('PBI-4', 'Em execução', '2026-11-03', 'Plano de corrida'));
  return { repo, wt };
}
const rodar = (repo: string, args: string[]): { rc: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', timeout: 60_000 });
  return { rc: r.status, stdout: r.stdout, stderr: r.stderr };
};
const estadoDe = (repo: string, extra: Record<string, unknown> = {}): { ok: boolean; estado: Record<string, any>; avisos: string[] } =>
  estadoDoPainel(repo, { agoraMs: AGORA_P, fuso: 'UTC', ...extra });

test('worktrees-varridas: o CLI varre as worktrees de `git worktree list`: o card que só existe na worktree entra no projeto', () => {
  const { repo } = montarRepo();
  const r = estadoDe(repo);
  assert.equal(r.ok, true, JSON.stringify(r));
  const pr = r.estado.projeto as EstadoProjeto;
  assert.deepEqual(pr.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-4']);
  assert.equal(pr.linhas.find((l) => l.id === 'PBI-4')?.titulo, 'Plano de corrida');
  assert.equal(pr.totais.pbis, 4);
  assert.equal(pr.totais.feitos, 1);
  assert.deepEqual(pr.avisos, []);
  assert.ok(pr.linhas.find((l) => l.id === 'PBI-4')?.origem.endsWith('wt-pbi-4'), 'a linha vem da worktree');
  // a árvore atual vem primeiro: o card do PBI-2 é o da atual
  assert.ok(pr.linhas.find((l) => l.id === 'PBI-2')?.origem.endsWith('repo com espaço'));
  // desenhado: o texto do CLI tem a linha do PBI da worktree
  const t = rodar(repo, ['texto', '--largura', '120']);
  assert.equal(t.rc, 0, t.stdout + t.stderr);
  assert.match(t.stdout, /^ {2}○ PBI-4 +Plano de corrida +sem plano$/m);
  assert.match(t.stdout, /^PROJETO {2}1 de 4 PBIs feitos/m);
});

test('git-worktree-falha-avisa: se `git worktree list` falha, só a árvore atual entra e o aviso diz isso (estado e stderr do texto)', () => {
  const { repo } = montarRepo();
  const falha = { worktreeList: () => ({ ok: false, motivo: 'git saiu 128' }) };
  const r = estadoDe(repo, { projetoDeps: falha });
  assert.equal(r.ok, true);
  const pr = r.estado.projeto as EstadoProjeto;
  assert.deepEqual(pr.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-3'], 'o PBI-4 só existe na worktree');
  assert.ok(pr.avisos.some((a) => /git worktree list falhou \(git saiu 128\): só a árvore atual/.test(a)), pr.avisos.join('|'));
  assert.ok(r.avisos.some((a) => /git worktree list falhou/.test(a)), 'o aviso chega aos avisos do estado');
  const avisos: string[] = [];
  const saida: string[] = [];
  const rc = main(['texto', '--largura', '120'], repo, { saida: (t: string) => saida.push(t), aviso: (t: string) => avisos.push(t), agoraMs: AGORA_P, projetoDeps: falha });
  assert.equal(rc, 0);
  assert.ok(avisos.some((a) => /git worktree list falhou/.test(a)), avisos.join('|'));
  assert.match(saida.join(''), /^PROJETO {2}1 de 3 PBIs feitos/m);
});

test('cli-script-real-texto-e-estado: o script rodado pela flag real sai com rc 0; `estado` leva `projeto` e `temPlanoJson`; `texto` desenha o projeto; flag errada rc 2', () => {
  const { repo } = montarRepo();
  const e = rodar(repo, ['estado']);
  assert.equal(e.rc, 0, e.stdout + e.stderr);
  const j = JSON.parse(e.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.estado.projeto.totais.pbis, 4);
  assert.equal(j.estado.temPlanoJson, false, 'sem plano.json na entrega');
  assert.deepEqual(j.estado.projeto.linhas.map((l: { id: string }) => l.id), ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-4']);
  const t = rodar(repo, ['texto', '--largura', '120']);
  assert.equal(t.rc, 0, t.stdout + t.stderr);
  assert.match(t.stdout, /^PROJETO {2}1 de 4 PBIs feitos · \? das tasks \(0 de 0\) · 0 restantes · 4 sem plano, fora da conta/m);
  assert.match(t.stdout, /^fase não medida/m, 'a entrega PBI-2 sem plano.json: "fase não medida"');
  assert.doesNotMatch(t.stdout, /FASE \d de 7/);
  assert.equal(rodar(repo, ['texto', '--nao-existe']).rc, 2);
  // estreito pela CLI: 1 linha de projeto
  const est = rodar(repo, ['texto', '--largura', '60']);
  assert.equal(est.rc, 0);
  assert.equal(est.stdout.split('\n').filter((l) => /^PROJETO|^ {2}[✓●○?] PBI-/.test(l)).length, 1, est.stdout);
});

test('cli-sem-FL1-so-as-entregas: sem `fluxo.mapeamento.FL1` no origin não há cards; as entregas do diário seguem sendo linhas; ≥ 2 para aparecer', () => {
  const { repo } = montarRepo({ semFL1: true });
  const r = estadoDe(repo);
  assert.deepEqual((r.estado.projeto as EstadoProjeto).linhas, [], 'sem FL1 e sem entregas, nenhuma linha');
  for (const id of ['PBI-2', 'PBI-9']) {
    const dir = join(repo, '.harness', 'entregas', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plano.json'), planoJson(id, 2));
  }
  const pr = estadoDe(repo).estado.projeto as EstadoProjeto;
  assert.deepEqual(pr.linhas.map((l) => l.id), ['PBI-2', 'PBI-9']);
  assert.deepEqual(pr.linhas.map((l) => l.plano), ['json', 'json']);
  const t = rodar(repo, ['texto', '--largura', '120']);
  assert.match(t.stdout, /^PROJETO {2}0 de 2 PBIs feitos · 0% das tasks \(0 de 4\) · 4 restantes/m);
  // com plano.json a entrega mostra "FASE n de 7" (a trilha mede) e o projeto não diz "fase não medida" para quem tem plano.json
  assert.equal(estadoDe(repo).estado.temPlanoJson, true);
});

test('cli-plano-de-commit-mais-recente: entre worktrees vale o plano.json cujo último commit é o mais recente (emenda 19, D-G13), lido por `git log -1` da borda', () => {
  const { repo, wt } = montarRepo();
  // PBI-2: plano de 2 tasks na árvore atual (commit antigo) e de 5 tasks na worktree (commit mais novo)
  const dirA = join(repo, '.harness', 'entregas', 'PBI-2');
  mkdirSync(dirA, { recursive: true });
  writeFileSync(join(dirA, 'plano.json'), planoJson('PBI-2', 2));
  g(repo, 'add', '-f', '.harness/entregas/PBI-2/plano.json');
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'plano antigo'], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-11-01T10:00:00Z', GIT_AUTHOR_DATE: '2026-11-01T10:00:00Z' } });
  const dirB = join(wt, '.harness', 'entregas', 'PBI-2');
  mkdirSync(dirB, { recursive: true });
  writeFileSync(join(dirB, 'plano.json'), planoJson('PBI-2', 5));
  g(wt, 'add', '-f', '.harness/entregas/PBI-2/plano.json');
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'plano novo'], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-11-05T10:00:00Z', GIT_AUTHOR_DATE: '2026-11-05T10:00:00Z' } });
  const pr = estadoDe(repo).estado.projeto as EstadoProjeto;
  const l = pr.linhas.find((x) => x.id === 'PBI-2');
  assert.equal(l?.tasks?.total, 5, JSON.stringify(l));
  assert.ok(l?.origem.endsWith('wt-pbi-4'));
});

test('cli-lido-so-leitura: estado e texto nunca gravam (nem .harness/ novo) e o projeto não derruba o estado quando um card está ilegível', () => {
  const { repo } = montarRepo();
  writeFileSync(join(repo, FL1, 'PBI-7.md'), '\u0000\u0001 sem frontmatter');
  const antes = existsSync(join(repo, '.harness'));
  const r = estadoDe(repo);
  assert.equal(r.ok, true);
  assert.equal(existsSync(join(repo, '.harness')), antes, 'nenhum .harness criado pela leitura');
  assert.ok((r.estado.projeto as EstadoProjeto).linhas.every((l) => l.id !== 'PBI-7'));
});

test('cli-plano-json-invalido-conta-como-plano: `plano.json` ilegível da entrega é plano existente (`temPlanoJson`), não "sem plano.json"; o texto diz "FASE ? de 7" e o "?" do plano', () => {
  const { repo } = montarRepo();
  const dir = join(repo, '.harness', 'entregas', 'PBI-2');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plano.json'), '{ não é json');
  const r = estadoDe(repo);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.estado.temPlanoJson, true);
  const t = rodar(repo, ['texto', '--largura', '200']);
  assert.equal(t.rc, 0, t.stdout + t.stderr);
  assert.match(t.stdout, /^FASE \? de 7 /m);
  assert.doesNotMatch(t.stdout, /fase não medida/);
  // e no projeto a entrega fica fora da conta com "?" (plano inválido), nunca 0 %
  assert.match(t.stdout, /^ {2}\? PBI-2 .*\? plano inválido$/m);
});

test('cli-FL1-fora-da-arvore-ignorado: `fluxo.mapeamento.FL1` absoluto ou com ".." não é lido (nada fora da árvore), sem derrubar o painel', () => {
  // `/docs/fluxo/pbis` ABSOLUTO existe DENTRO da árvore (join o leria): a regra manda ignorar, não "caiu fora por acaso"
  for (const fl1 of ['../cards-de-fora', '/tmp/cards-de-fora', 'docs/../../x', `/${FL1}`, `/${FL1}/`]) {
    const { repo } = montarRepo({ fl1 });
    mkdirSync(join(repo, '..', 'cards-de-fora'), { recursive: true });
    writeFileSync(join(repo, '..', 'cards-de-fora', 'PBI-8.md'), card('PBI-8', 'Concluído', '2026-11-01', 'Fora'));
    const r = estadoDe(repo);
    assert.equal(r.ok, true, fl1);
    assert.deepEqual((r.estado.projeto as EstadoProjeto).linhas, [], `${fl1}: nenhum card lido`);
  }
});

test('cli-plano-md-do-card-fora-da-arvore-ignorado: "Plano: `../../x.md`" (ou absoluto) no card não é lido; a linha fica sem plano, sem contar tasks de fora', () => {
  const { repo } = montarRepo();
  const fora = join(repo, '..', 'x.md');
  writeFileSync(fora, '### Task 1: a\n### Task 2: b\n### Task 3: c\n');
  for (const plano of ['`../x.md`', '`../../x.md`', '`/docs/dentro.md`']) {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'dentro.md'), '### Task 1: a\n### Task 2: b\n');
    writeFileSync(join(repo, FL1, 'PBI-3.md'), card('PBI-3', 'Backlog', '2026-11-02', 'Treino semanal', plano));
    const l = (estadoDe(repo).estado.projeto as EstadoProjeto).linhas.find((x) => x.id === 'PBI-3');
    assert.equal(l?.plano, null, `${plano}: plano .md de fora lido`);
    assert.equal(l?.tasks, null, plano);
    assert.equal(l?.texto, '? plano inválido', `${plano}: o card aponta um plano que não foi achado na árvore`);
  }
  // o mesmo card com o plano DENTRO da árvore (relativo) é lido: a cláusula não bloqueia o caso bom
  writeFileSync(join(repo, FL1, 'PBI-3.md'), card('PBI-3', 'Backlog', '2026-11-02', 'Treino semanal', '`docs/dentro.md`'));
  const bom = (estadoDe(repo).estado.projeto as EstadoProjeto).linhas.find((x) => x.id === 'PBI-3');
  assert.equal(bom?.plano, 'md');
  assert.equal(bom?.tasks?.total, 2);
});

test('agente-fora-do-loop-legado: renderEsquadrao (legado) e renderExecutivo escrevem o MESMO rótulo, sem task ou com task pendente; task iniciada mostra o id', () => {
  const txt = (ls: { texto: string }[][]): string[] => ls.map((l) => l.map((x) => x.texto).join(''));
  for (const w of [44, 80, 120]) {
    const esq = txt(renderEsquadrao(EXTRAS['sem-task'], { preset: 'esquadrao', tema: 'mono', narracao: true, largura: w }));
    // o texto é o da regra única; a escada de corte do legado o CORTA com `…` (nunca o troca) antes de tirar o modelo
    assert.ok(esq.some((l) => l.includes(ROTULO_FORA_DO_LOOP) || (w < 100 && /agente fora/.test(l) && l.includes('…'))), `esquadrão ${w}: ${esq.join('\n')}`);
    assert.ok(esq.every((l) => !/(^|[ ●])fora do loop/.test(l) || l.includes('agente fora do loop')), `esquadrão ${w}: forma curta`);
    assert.ok(esq.every((l) => !/sem task/.test(l) && colunas(l) <= w));
    const exe = txt(renderExecutivo(EXTRAS['sem-task'], { preset: 'executivo', tema: 'mono', narracao: true, largura: w }));
    assert.ok(exe.some((l) => l.includes(ROTULO_FORA_DO_LOOP)), `executivo ${w}: ${exe.join('\n')}`);
    assert.ok(exe.every((l) => !/sem task/.test(l) && colunas(l) <= w));
  }
  // task pendente (ninguém rodou `iniciar`) também; iniciada, o id
  const pend = structuredClone(EXTRAS['sem-task']);
  const ag = pend.equipe.agentes[pend.equipe.agentes.length - 1]; // o vivo sem task do fixture
  ag.nome = 'ARAGORN'; ag.papel = 'implementador'; ag.task = 'T9'; ag.estadoTask = 'implementando';
  pend.plano.tasks = pend.plano.tasks.filter((x) => x.id !== 'T9').concat([{ ...pend.plano.tasks[0], id: 'T9', deps: [] }]);
  const set = (est: string): void => { pend.plano.tasks = pend.plano.tasks.map((x) => (x.id === 'T9' ? { ...x, estado: est } : x)) as typeof pend.plano.tasks; };
  for (const [est, fora] of [['pendente', true], ['implementando', false]] as const) {
    set(est);
    const e1 = txt(renderEsquadrao(pend, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 120 })).filter((l) => /ARAGORN/.test(l) && /^├─ ● /.test(l));
    const e2 = txt(renderExecutivo(pend, { preset: 'executivo', tema: 'mono', narracao: true, largura: 120 })).filter((l) => /^● /.test(l) && /implementador 2|T9|agente fora/.test(l) && !/revisor/.test(l));
    for (const l of [...e1, ...e2]) assert.equal(l.includes(ROTULO_FORA_DO_LOOP), fora, `${est}: ${l}`);
    assert.ok(e1.length > 0 && e2.length > 0, `${est}: linhas do agente`);
  }
});

test('projeto-linha-unica-motivo-so-em-100: o "?" da previsão sem ritmo diz o motivo a partir de 100 colunas, nas linhas únicas também (regra única `motivoEm`)', () => {
  const semRitmo = projetarProjeto([{ caminho: '/r', cards: [{ arquivo: 'PBI-1.md', texto: '---\nid: "PBI-1"\nstatus: Em execução\n---\n# A\n', planoMd: null },
    { arquivo: 'PBI-2.md', texto: '---\nid: "PBI-2"\nstatus: Backlog\n---\n# B\n', planoMd: null }], entregas: [] }], OPC);
  const base = projetarPainel(null, null, entrada({ fatos: fatos({ plano: null, branch: 'main' }), entregaId: null, ultima: null, fora: false }));
  const s = comProjeto({ ...base, umaLinha: { ultima: null } } as unknown as EstadoPainel, semRitmo);
  assert.ok(linhas(s, { largura: 100 }).includes('  previsão ? (sem ritmo medido)'));
  assert.ok(linhas(s, { largura: 99 }).includes('  previsão ?'));
  assert.ok(linhas(s, { largura: 120 }).includes('  previsão ? (sem ritmo medido)'));
});

// ───────────────────────────── GM-16 T4: feitos recolhidos, Epic, opções (REQ-PRJ-2 b, REQ-PRJ-3 a, c, d, e, g, h)
// Cada teste lê a saída DESENHADA (`renderPainel` + `paraTexto`) ou o script real; casos com a chave ligada usam cards montados aqui, nunca a fixture da GM-15.
// Mutações M4a-M4h e as próprias: roteiro em .tmp-gabarito/mutacoes.json (fora do git).

const cardS = (id: string, status: string | null, epic: string | null = null) => ({
  arquivo: `${id}.md`,
  texto: `---\nid: "${id}"\n${status === null ? '' : `status: ${status}\n`}${epic === null ? '' : `epic: ${epic}\n`}---\n# Título ${id}\n`,
  planoMd: null,
});
const projetoS = (cards: ReturnType<typeof cardS>[], extra: Record<string, unknown> = {}): EstadoProjeto =>
  projetarProjeto([{ caminho: '/r', cards, entregas: [] }], { ...OPC, ...extra } as typeof OPC);
const estS = (pr: EstadoProjeto | null): EstadoPainel => comProjeto(estadoComPlano([ini(0, 'T1')]), pr);
const LINHA_PROJ = /^PROJETO|^PBIs |^ {2,4}[✓●○?] PBI-|^ {2}previsão|^ {2}~\d+ tasks estimadas|^ {2}✓ \d+ feitos?$|· \d+ abertos?$/;
const doProj = (ls: string[]): string[] => ls.filter((l) => LINHA_PROJ.test(l));
const LIGADA = { opcoesComoContagem: true };
const FEITO_RE = /^ {2}✓ \d+ feitos?$/;

test('feitos-recolhidos-1-linha: N PBIs feitos viram "✓ N feitos" logo depois dos totais; nenhuma linha de PBI feito; o núcleo mantém as linhas', () => {
  const pr = projetoS([cardS('PBI-1', 'Concluído'), cardS('PBI-2', 'Concluído'), cardS('PBI-3', 'Concluído'), cardS('PBI-4', 'Em execução'), cardS('PBI-5', 'Em execução')]);
  assert.equal(pr.linhas.length, 5, 'o núcleo segue com a linha do feito');
  assert.equal(pr.linhas.filter((l) => l.feito).length, 3);
  const ls = linhas(estS(pr));
  assert.equal(ls.filter((l) => FEITO_RE.test(l)).length, 1, ls.join('\n'));
  const i = ls.findIndex((l) => FEITO_RE.test(l));
  assert.equal(ls[i], '  ✓ 3 feitos');
  assert.match(ls[i - 1], /^ {2}previsão /);
  assert.match(ls[i + 1], /^ {2}[●○] PBI-4 /);
  assert.ok(ls.every((l) => !/PBI-[123] /.test(l)), ls.join('\n'));
  assert.equal(ls.filter((l) => /^ {2}[●○] PBI-[45] /.test(l)).length, 2);
  assert.equal(ls.filter((l) => /^ {2}✓ /.test(l)).length, 1, 'nenhum ✓ de PBI sobra');
});

test('sem-feito-sem-linha: com 0 feitos não há linha de feitos e as linhas de hoje seguem', () => {
  const pr = projetoS([cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Em execução'), cardS('PBI-3', 'Em execução')]);
  const ls = linhas(estS(pr));
  assert.equal(ls.filter((l) => /^ {2}✓ /.test(l)).length, 0, ls.join('\n'));
  assert.equal(ls.filter((l) => /^ {2}[●○] PBI-/.test(l)).length, 3);
  assert.equal(doProj(ls).length, nLinhasProjeto(pr));
});

test('opcoes-na-linha-de-totais: com a chave ligada "N opções" entra na linha de totais (44, 71, 72, 120); "sem plano" sai antes dele; o número nunca é cortado', () => {
  const cards = [cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Em execução'), cardS('PBI-3', 'Backlog'), cardS('PBI-4', 'Backlog'), cardS('PBI-5', 'Ideia')];
  const pr = projetoS(cards, LIGADA);
  assert.equal(pr.totais.opcoes, 3);
  assert.equal(pr.linhas.length, 2);
  for (const w of [72, 120]) {
    const tot = linhas(estS(pr), { largura: w }).find((l) => /^PROJETO/.test(l)) as string;
    assert.match(tot, /^PROJETO {2}0 de 2 PBIs feitos .* · 3 opções$/, `w=${w}: ${tot}`);
  }
  const t71 = linhas(estS(pr), { largura: 71 }).find((l) => /^PROJETO/.test(l)) as string;
  assert.match(t71, /^PROJETO 0\/2 PBIs · .* · 2 sem plano · 3 opções$/, t71);
  const t44 = linhas(estS(pr), { largura: 44 }).find((l) => /^PROJETO/.test(l)) as string;
  assert.match(t44, /^PROJETO 0\/2 PBIs · .* · 3 opções$/, t44);
  assert.doesNotMatch(t44, /sem plano/, 'em 44 sai "sem plano" antes de "opções"');
  assert.ok(colunas(t44) <= 44 && colunas(t71) <= 71);
  // singular
  const um = projetoS([cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Em execução'), cardS('PBI-3', 'Backlog')], LIGADA);
  assert.match(linhas(estS(um)).find((l) => /^PROJETO/.test(l)) as string, / · 1 opção$/);
  // sem opção, nada de "opç" no totais
  const sem = projetoS([cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Em execução')], LIGADA);
  assert.doesNotMatch(linhas(estS(sem)).join('\n'), /opç/);
});

test('opcoes-nao-aparecem-sem-chave: sem a chave (ausente, false, "true") os mesmos cards são linhas e o desenho não diz "opções"', () => {
  const cards = [cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Em execução'), cardS('PBI-3', 'Backlog'), cardS('PBI-4', 'Backlog'), cardS('PBI-5', 'Ideia')];
  for (const extra of [{}, { opcoesComoContagem: false }, { opcoesComoContagem: 'true' }, { opcoesComoContagem: 1 }]) {
    const pr = projetoS(cards, extra);
    assert.equal(pr.totais.opcoes, 0);
    for (const w of [40, 44, 71, 72, 120]) {
      const ls = linhas(estS(pr), { largura: w });
      assert.doesNotMatch(ls.join('\n'), /opç/, `w=${w} ${JSON.stringify(extra)}`);
    }
    assert.equal(linhas(estS(pr)).filter((l) => /^ {2}[●○] PBI-/.test(l)).length, 5);
  }
});

test('projeto-aparece-casos-g: aparece quando linhas + opções >= 2 (os 5 casos da spec)', () => {
  // 1 aberto + 1 feito
  let ls = linhas(estS(projetoS([cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Concluído')])));
  assert.equal(ls.filter((l) => /^PROJETO/.test(l)).length, 1, ls.join('\n'));
  assert.equal(ls.filter((l) => /^  ✓ 1 feito$/.test(l)).length, 1);
  assert.equal(ls.filter((l) => /^ {2}[●○] PBI-1 /.test(l)).length, 1);
  assert.ok(ls.every((l) => !l.includes('PBI-2 ')));
  // 0 abertos + 2 feitos
  ls = linhas(estS(projetoS([cardS('PBI-1', 'Concluído'), cardS('PBI-2', 'Concluído')])));
  assert.equal(ls.filter((l) => /^PROJETO {2}2 de 2 PBIs feitos/.test(l)).length, 1, ls.join('\n'));
  assert.equal(ls.filter((l) => /^  ✓ 2 feitos$/.test(l)).length, 1);
  assert.equal(ls.filter((l) => /^ {2}[●○?] PBI-/.test(l)).length, 0);
  // 1 aberto + 2 opções (chave ligada)
  ls = linhas(estS(projetoS([cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Backlog'), cardS('PBI-3', 'Backlog')], LIGADA)));
  assert.match(ls.find((l) => /^PROJETO/.test(l)) as string, / · 2 opções$/, ls.join('\n'));
  assert.equal(ls.filter((l) => /^ {2}[●○] PBI-1 /.test(l)).length, 1);
  assert.equal(ls.filter((l) => /PBI-[23] /.test(l)).length, 0);
  // 1 linha e 0 opções: nada (como hoje); 1 linha feita sozinha também
  assert.equal(doProj(linhas(estS(projetoS([cardS('PBI-1', 'Em execução')])))).length, 0);
  assert.equal(doProj(linhas(estS(projetoS([cardS('PBI-1', 'Concluído')])))).length, 0);
  assert.equal(doProj(linhas(estS(projetoS([cardS('PBI-1', 'Em execução'), cardS('PBI-2', 'Backlog')])))).length > 0, true, 'sem a chave o Backlog é linha: 2 linhas');
  // 0 linhas + 2 opções: totais com "0 de 0 PBIs" e "2 opções"; com 1 opção só: nada
  ls = linhas(estS(projetoS([cardS('PBI-1', 'Backlog'), cardS('PBI-2', 'Backlog')], LIGADA)));
  assert.match(ls.find((l) => /^PROJETO/.test(l)) as string, /^PROJETO {2}0 de 0 PBIs feitos .* · 2 opções$/, ls.join('\n'));
  assert.equal(doProj(linhas(estS(projetoS([cardS('PBI-1', 'Backlog')], LIGADA)))).length, 0);
});

test('projeto-menor-que-44: em 40 e 43 colunas a linha segue "PBIs f/t · pct"; feitos, Epic e opções não entram', () => {
  const pr = projetoS([cardS('PBI-1', 'Concluído'), cardS('PBI-2', 'Concluído'), cardS('PBI-3', 'Concluído'), cardS('PBI-4', 'Em execução', 'EPIC-1'), cardS('PBI-5', 'Em execução'), cardS('PBI-6', 'Backlog'), cardS('PBI-7', 'Backlog')], { ...LIGADA, vinculo: { tipo: 'frontmatter' } });
  assert.equal(pr.totais.opcoes, 2);
  assert.equal(pr.grupos.length, 2);
  for (const w of [40, 43]) {
    const ls = linhas(estS(pr), { largura: w });
    const pj = doProj(ls);
    assert.equal(pj.length, 1, `w=${w}: ${pj.join(' | ')}`);
    assert.match(pj[0], /^PBIs 3\/5 · /);
    assert.doesNotMatch(ls.join('\n'), /feito|opç|EPIC|✓ \d/);
    assert.ok(ls.every((l) => colunas(l) <= w));
  }
});

const FIM_VINCULO = { tipo: 'frontmatter' };
const cardsAltura = [cardS('PBI-1', 'Concluído'), cardS('PBI-2', 'Concluído'), cardS('PBI-3', 'Em execução', 'EPIC-1'), cardS('PBI-4', 'Em execução', 'EPIC-1'), cardS('PBI-5', 'Em execução')];

test('projeto-altura-7-linhas: com pouca altura saem as linhas de PBI, depois feitos e cabeçalhos, por último os totais; nada da entrega', () => {
  const pr = projetoS(cardsAltura, { vinculo: FIM_VINCULO, titulosEpic: { 'EPIC-1': 'Painel' } });
  assert.equal(pr.grupos.length, 2);
  const s = comProjeto(estadoComPlano([...ciclo('T1', 0), ini(20, 'T2')], { agentes: [vivo('T2 implementador')] }), pr);
  const cheio = linhas(s);
  const recente = cheio.filter((l) => /^(\d\d:\d\d|\?) [✓✗●○?] /.test(l));
  const entregaOk = (ls: string[]): void => {
    assert.ok(ls.some((l) => /^PLANO/.test(l)) && ls.some((l) => /^CI ●/.test(l)) && ls.some((l) => /^[├└]─ ● /.test(l)), ls.join('\n'));
    assert.equal(ls.filter((l) => /^(\d\d:\d\d|\?) [✓✗●○?] /.test(l)).length, recente.length);
  };
  const PBI = /^ {2,4}[●○?] PBI-/;
  const CAB = /· \d+ abertos?$/;
  assert.equal(cheio.filter((l) => PBI.test(l)).length, 3);
  assert.equal(cheio.filter((l) => CAB.test(l)).length, 2);
  // 1: saem só as 3 linhas de PBI (6.96); feitos e cabeçalhos ficam
  const a = linhas(s, { orcamento: cheio.length - 3 });
  assert.equal(a.filter((l) => PBI.test(l)).length, 0, a.join('\n'));
  assert.equal(a.filter((l) => FEITO_RE.test(l)).length, 1);
  assert.equal(a.filter((l) => CAB.test(l)).length, 2);
  assert.equal(a.filter((l) => /^PROJETO/.test(l)).length, 1);
  entregaOk(a);
  // 1b: com 1 linha a mais cortada, sai um cabeçalho (6.95, o último), nunca o feito antes dele: o feito tem a prioridade de cabeçalho, não a de PBI
  const a2 = linhas(s, { orcamento: cheio.length - 4 });
  assert.equal(a2.filter((l) => PBI.test(l)).length, 0, a2.join('\n'));
  assert.equal(a2.filter((l) => FEITO_RE.test(l)).length, 1, a2.join('\n'));
  assert.equal(a2.filter((l) => CAB.test(l)).length, 1, a2.join('\n'));
  // 2: saem também o feito e os 2 cabeçalhos (6.95); os totais ficam
  const b = linhas(s, { orcamento: cheio.length - 6 });
  assert.equal(b.filter((l) => FEITO_RE.test(l) || CAB.test(l) || PBI.test(l)).length, 0, b.join('\n'));
  assert.equal(b.filter((l) => /^PROJETO/.test(l)).length, 1);
  assert.equal(b.filter((l) => /^ {2}previsão/.test(l)).length, 1);
  entregaOk(b);
  // 3: por último os totais; a entrega intacta
  const c = linhas(s, { orcamento: cheio.length - nLinhasProjeto(pr) });
  assert.equal(doProj(c).length, 0, c.join('\n'));
  entregaOk(c);
  // orçamento 7 e 80 colunas (o aceite): nada de linha de PBI, e o corte nunca come a entrega por causa do projeto
  const sete = linhas(s, { orcamento: 7, largura: 80 });
  assert.equal(sete.filter((l) => PBI.test(l)).length, 0, sete.join('\n'));
  assert.ok(sete.length <= 7, sete.join('\n'));
});

test('cabecalho-de-epic-no-desenho: com 2+ grupos de abertos o cabeçalho "EPIC-n título · a abertos" e os PBIs recuados embaixo; "sem Epic" por último; com 1 grupo, nada', () => {
  const pr = projetoS(cardsAltura, { vinculo: FIM_VINCULO, titulosEpic: { 'EPIC-1': 'Painel novo' } });
  const ls = linhas(estS(pr));
  const i1 = ls.indexOf('  EPIC-1 Painel novo · 2 abertos');
  assert.ok(i1 > 0, ls.join('\n'));
  assert.match(ls[i1 + 1], /^ {4}[●○] PBI-3 /);
  assert.match(ls[i1 + 2], /^ {4}[●○] PBI-4 /);
  assert.equal(ls[i1 + 3], '  sem Epic · 1 aberto');
  assert.match(ls[i1 + 4], /^ {4}[●○] PBI-5 /);
  // título longo cede; o número nunca é cortado
  const longo = projetoS(cardsAltura, { vinculo: FIM_VINCULO, titulosEpic: { 'EPIC-1': 'Um título de epic bem comprido que não cabe na largura do painel lateral nenhuma' } });
  for (const w of [72, 80]) {
    const l = linhas(estS(longo), { largura: w });
    const cab = l.find((x) => /^ {2}EPIC-1 /.test(x)) as string;
    assert.match(cab, / · 2 abertos$/, cab);
    assert.ok(l.every((x) => colunas(x) <= w), l.filter((x) => colunas(x) > w).join(' | '));
  }
  // 1 grupo só (todos sem Epic, ou todos no mesmo): sem cabeçalho
  const um = projetoS([cardS('PBI-1', 'Em execução', 'EPIC-1'), cardS('PBI-2', 'Em execução', 'EPIC-1'), cardS('PBI-3', 'Concluído')], { vinculo: FIM_VINCULO });
  assert.equal(um.grupos.length, 0);
  assert.equal(linhas(estS(um)).filter((l) => /· \d+ abertos?$/.test(l)).length, 0);
});

test('teto-de-linhas-propriedade: 40 a 200 colunas × 0 a 100 PBIs, chave ligada e desligada: linhas ≤ totais + 1 + abertos + grupos; cada linha cabe; o número nunca é cortado', () => {
  const STATUS = ['Concluído', 'Em execução', 'Backlog', 'Em execução', 'Ideia', 'Concluído'];
  for (const chave of [true, false]) {
    for (const n of [0, 1, 2, 3, 5, 12, 40, 100]) {
      const cards = Array.from({ length: n }, (_, i) => cardS(`PBI-${i + 1}`, STATUS[i % STATUS.length], i % 3 === 0 ? 'EPIC-1' : i % 3 === 1 ? 'EPIC-2' : null));
      const pr = projetoS(cards, { ...(chave ? LIGADA : {}), vinculo: FIM_VINCULO });
      const abertos = pr.linhas.filter((l) => !l.feito).length;
      for (const w of [40, 43, 44, 50, 60, 71, 72, 73, 80, 100, 120, 160, 200]) {
        const ls = linhas(estS(pr), { largura: w });
        const rotulo = `chave=${chave} n=${n} w=${w}`;
        assert.ok(ls.every((l) => colunas(l) <= w), `${rotulo}: ${ls.filter((l) => colunas(l) > w).join(' | ')}`);
        const pj = doProj(ls);
        const visivel = pr.linhas.length + pr.totais.opcoes >= 2;
        if (!visivel) { assert.equal(pj.length, 0, rotulo); continue; }
        const tot = pj.find((l) => /^PROJETO|^PBIs /.test(l)) as string;
        assert.ok(tot, `${rotulo}: ${ls.join('\n')}`);
        if (w >= 72) {
          const teto = 2 + (pr.totais.previsao.estimada !== null ? 1 : 0) + (pr.totais.feitos > 0 ? 1 : 0) + abertos + pr.grupos.length;
          assert.ok(pj.length <= teto, `${rotulo}: ${pj.length} > ${teto}`);
          assert.ok(tot.startsWith(`PROJETO  ${pr.totais.feitos} de ${pr.totais.pbis} PBIs feitos`), `${rotulo}: ${tot}`);
          assert.equal(pj.filter((l) => FEITO_RE.test(l)).length, pr.totais.feitos > 0 ? 1 : 0, rotulo);
        } else if (w >= 44) {
          assert.equal(pj.length, 1, rotulo);
          assert.ok(tot.startsWith(`PROJETO ${pr.totais.feitos}/${pr.totais.pbis} PBIs`), `${rotulo}: ${tot}`);
        } else {
          assert.equal(pj.length, 1, rotulo);
          assert.ok(tot.startsWith(`PBIs ${pr.totais.feitos}/${pr.totais.pbis}`), `${rotulo}: ${tot}`);
          assert.doesNotMatch(tot, /opç|feito/);
        }
        const op = / · (\d+) opç/.exec(tot);
        if (op !== null) assert.equal(Number(op[1]), pr.totais.opcoes, `${rotulo}: número de opções cortado em "${tot}"`);
        if (!chave) assert.doesNotMatch(ls.join('\n'), /opç/, rotulo);
        if (chave && pr.totais.opcoes > 0 && w >= 44 && w < 72 && n <= 12) assert.ok(op !== null || /sem plano/.test(tot) === false, `${rotulo}: ${tot}`);
      }
    }
  }
});

test('regressao-fixture-gm15: com a chave desligada as mesmas linhas de hoje, exceto o PBI-1 que vira "✓ 1 feito"; o núcleo segue com as 6 linhas', () => {
  const pr = projetoDaFixture();
  assert.deepEqual(pr.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-4', 'PBI-5', 'PBI-6']);
  assert.equal(pr.linhas[0].feito, true);
  assert.equal(pr.totais.opcoes, 0);
  const ls = linhas(estS(pr));
  const dp = doProj(ls);
  assert.equal(dp.length, 9);
  assert.match(dp[0], /^PROJETO {2}1 de 6 PBIs feitos/);
  assert.match(dp[1], /^ {2}previsão /);
  assert.match(dp[2], /^ {2}~\d+ tasks estimadas/);
  assert.equal(dp[3], '  ✓ 1 feito');
  assert.deepEqual(dp.slice(4).map((l) => /PBI-\d/.exec(l)?.[0]), ['PBI-2', 'PBI-3', 'PBI-4', 'PBI-5', 'PBI-6']);
  assert.equal(pr.grupos.length, 0);
  assert.ok(!ls.some((l) => /EPIC|sem Epic|opç/.test(l)));
});

test('feitos-recolhidos-na-linha-unica: o projeto acima de "sem entrega em curso" também recolhe os feitos (comProjetoAcima)', () => {
  const pr = projetoS([cardS('PBI-1', 'Concluído'), cardS('PBI-2', 'Em execução'), cardS('PBI-3', 'Em execução')]);
  const base = projetarPainel(null, null, entrada({ fatos: fatos({ plano: null, branch: 'main' }), entregaId: null, ultima: null, fora: false }));
  const s = comProjeto({ ...base, umaLinha: { ultima: null } } as unknown as EstadoPainel, pr);
  const ls = linhas(s, { largura: 120 });
  assert.equal(ls.filter((l) => /^  ✓ 1 feito$/.test(l)).length, 1, ls.join('\n'));
  assert.ok(ls.every((l) => !l.includes('PBI-1 ')));
  assert.equal(ls[ls.length - 1], 'GABARITO · sem entrega em curso');
  assert.equal(ls.filter((l) => /^ {2}[●○] PBI-[23] /.test(l)).length, 2);
});

// ───────────────────────────── a borda real (painel.mjs): config → opções do núcleo

const OPCOES_ON = { projeto: { opcoesComoContagem: true } };
const prDe = (repo: string): EstadoProjeto => estadoDe(repo).estado.projeto as EstadoProjeto;
const rmF = (rel: string, txt: string): Record<string, string> => ({ [rel]: txt });

test('borda-chave-liga-opcoes: `painel.projeto.opcoesComoContagem: true` na config faz o Backlog virar "1 opção" no estado e no texto do script real', () => {
  const { repo } = montarRepo({ painel: OPCOES_ON });
  const pr = prDe(repo);
  assert.equal(pr.totais.opcoes, 1);
  assert.deepEqual(pr.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-4']);
  const t = rodar(repo, ['texto', '--largura', '120']);
  assert.equal(t.rc, 0, t.stdout + t.stderr);
  assert.match(t.stdout, /^PROJETO {2}1 de 3 PBIs feitos .* · 1 opção$/m);
  assert.match(t.stdout, /^ {2}✓ 1 feito$/m);
  assert.doesNotMatch(t.stdout, /PBI-1 |PBI-3 /);
});

test('borda-chave-so-true-liga: ausente, false, "true", 1, null e {} deixam a chave desligada (o Backlog é linha)', () => {
  for (const v of [undefined, false, 'true', 1, null, {}, [true]]) {
    const { repo } = montarRepo({ painel: v === undefined ? undefined : { projeto: { opcoesComoContagem: v } } });
    const pr = prDe(repo);
    assert.equal(pr.totais.opcoes, 0, JSON.stringify(v));
    assert.deepEqual(pr.linhas.map((l) => l.id), ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-4'], JSON.stringify(v));
  }
  const { repo } = montarRepo({ painel: { projeto: 'true' } });
  assert.equal(prDe(repo).totais.opcoes, 0);
});

test('borda-passa-status-fl1: `fluxo.status.FL1` da config vale na borda ("Backlog" vira coluna e deixa de ser opção)', () => {
  const { repo } = montarRepo({ painel: OPCOES_ON, fluxoExtra: { status: { FL1: { todo: 'Backlog', doing: 'Em execução', concluido: 'Concluído' } } } });
  const pr = prDe(repo);
  assert.equal(pr.totais.opcoes, 0);
  assert.ok(pr.linhas.some((l) => l.id === 'PBI-3'));
  // e o "feito" da config (REQ-PRJ-3 f) chega pela mesma borda
  const jira = montarRepo({ fluxoExtra: { status: { FL1: { concluido: 'Em execução' } } } });
  assert.equal(prDe(jira.repo).totais.feitos, 3, 'PBI-1 (Concluído fixo) + PBI-2 e PBI-4 (o concluído da config)');
});

test('borda-epics-e-titulos: vínculo frontmatter e os títulos da pasta FL2 chegam ao núcleo; o desenho traz o cabeçalho com o título', () => {
  const { repo } = montarRepo({
    painel: OPCOES_ON, fluxoExtra: { vinculoPbiEpic: { tipo: 'frontmatter', nome: 'epic' } }, mapeamentoExtra: { FL2: 'docs/fluxo/epics/' },
    arquivos: {
      'docs/fluxo/epics/EPIC-1.md': '---\nid: "EPIC-1"\nstatus: Em execução\n---\n# Painel novo\n',
      'docs/fluxo/pbis/PBI-2.md': card('PBI-2', 'Em execução', '2026-11-02', 'Perfil').replace('tipo: US', 'tipo: US\nepic: EPIC-1'),
    },
  });
  const pr = prDe(repo);
  assert.deepEqual(pr.avisos, []);
  assert.deepEqual(pr.grupos.map((x) => [x.epic, x.titulo, x.ids]), [['EPIC-1', 'Painel novo', ['PBI-2']], [null, null, ['PBI-4']]]);
  const t = rodar(repo, ['texto', '--largura', '120']);
  assert.match(t.stdout, /^ {2}EPIC-1 Painel novo · 1 aberto$/m);
  assert.match(t.stdout, /^ {2}sem Epic · 1 aberto$/m);
  // vínculo de outro tipo: sem agrupamento
  const mcp = montarRepo({ fluxoExtra: { vinculoPbiEpic: { tipo: 'mcp' } }, arquivos: rmF('docs/fluxo/pbis/PBI-2.md', card('PBI-2', 'Em execução', '2026-11-02', 'Perfil').replace('tipo: US', 'tipo: US\nepic: EPIC-1')) });
  assert.deepEqual(prDe(mcp.repo).grupos, []);
});

test('borda-fl2-ausente-x-ilegivel: pasta FL2 ausente cai no ID sem aviso; pasta com Epic ilegível ou caminho inválido avisa e nunca vira título', () => {
  const vinculo = { vinculoPbiEpic: { tipo: 'frontmatter' } };
  const epicNoCard = { 'docs/fluxo/pbis/PBI-2.md': card('PBI-2', 'Em execução', '2026-11-02', 'Perfil').replace('tipo: US', 'tipo: US\nepic: EPIC-1') };
  // ausente: a pasta não existe ⇒ só o ID, sem aviso
  const aus = montarRepo({ fluxoExtra: vinculo, mapeamentoExtra: { FL2: 'docs/fluxo/epics/' }, arquivos: epicNoCard });
  const a = prDe(aus.repo);
  assert.deepEqual(a.avisos, []);
  assert.equal(a.grupos[0]?.titulo, null);
  // chave FL2 ausente da config: idem
  const sem = montarRepo({ fluxoExtra: vinculo, arquivos: epicNoCard });
  assert.deepEqual(prDe(sem.repo).avisos, []);
  // ilegível: um "Epic" que é diretório
  const ile = montarRepo({ fluxoExtra: vinculo, mapeamentoExtra: { FL2: 'docs/fluxo/epics/' }, arquivos: { ...epicNoCard, 'docs/fluxo/epics/EPIC-1.md': '---\nid: "EPIC-1"\n---\n# Painel\n' } });
  mkdirSync(join(ile.repo, 'docs', 'fluxo', 'epics', 'EPIC-9.md'), { recursive: true });
  const i = prDe(ile.repo);
  assert.ok(i.avisos.some((x) => /EPIC-9\.md ilegível/.test(x)), i.avisos.join('|'));
  assert.equal(i.grupos[0]?.titulo, 'Painel', 'o Epic legível segue com título');
  // a pasta é um arquivo: ilegível, avisa
  const arq = montarRepo({ fluxoExtra: vinculo, mapeamentoExtra: { FL2: 'docs/fluxo/epics' }, arquivos: { ...epicNoCard, 'docs/fluxo/epics': 'x' } });
  const b = prDe(arq.repo);
  assert.ok(b.avisos.some((x) => /FL2.*ilegível/.test(x)), b.avisos.join('|'));
  // caminho inválido na config
  const inv = montarRepo({ fluxoExtra: vinculo, mapeamentoExtra: { FL2: '../fora' }, arquivos: epicNoCard });
  assert.ok(prDe(inv.repo).avisos.some((x) => /FL2.*inválido/.test(x)));
});

test('borda-status-fl1-ilegivel-avisa: `fluxo.status.FL1` que não é objeto avisa e cai no quadro padrão', () => {
  const { repo } = montarRepo({ painel: OPCOES_ON, fluxoExtra: { status: { FL1: 'texto' } } });
  const pr = prDe(repo);
  assert.ok(pr.avisos.some((x) => /fluxo\.status\.FL1 ilegível/.test(x)), pr.avisos.join('|'));
  assert.equal(pr.totais.opcoes, 1, 'o quadro padrão vale');
  const ok = montarRepo({ painel: OPCOES_ON });
  assert.deepEqual(prDe(ok.repo).avisos, [], 'ausente não avisa');
});

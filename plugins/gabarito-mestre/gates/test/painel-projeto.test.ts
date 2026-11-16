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
const doProjeto = (ls: string[]): string[] => ls.filter((l) => /^PROJETO|^PBIs |^ {2}[✓●○?] PBI-|^ {2}[✓●○?] GM-|^ {2}previsão|^ {2}~\d+ tasks estimadas/.test(l));
/** Linhas do projeto em ≥ 72 colunas: totais, previsão (a), previsão estimada (b) quando há PBI sem plano aberto, e 1 por PBI. */
const nLinhasProjeto = (pr: EstadoProjeto): number => 2 + (pr.totais.previsao.estimada !== null ? 1 : 0) + pr.linhas.length;

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
  // 1 linha por PBI, na ordem do projeto; id, título do card e o texto da linha (o que o núcleo diz)
  const porPbi = ls.filter((l) => /^ {2}[✓●○?] PBI-/.test(l));
  assert.deepEqual(porPbi.map((l) => /PBI-\d/.exec(l)?.[0]), pr.linhas.map((l) => l.id));
  for (const l of pr.linhas) {
    const d = porPbi.find((x) => x.includes(`${l.id} `)) as string;
    assert.ok(d.trimEnd().endsWith(l.texto), `${l.id}: "${d}" não termina em "${l.texto}"`);
    if (l.titulo !== null) assert.ok(d.includes(l.titulo.slice(0, 8)), `${l.id}: título ausente em "${d}"`);
  }
  // glifos: feito ✓, com plano ●, sem plano ○, plano inválido ?
  assert.match(porPbi.find((l) => l.includes('PBI-1 ')) as string, /^ {2}✓ /);
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
  const sem = linhas(s, { orcamento: cheio.length - pr.linhas.length });
  assert.equal(sem.filter((l) => /^ {2}[✓●○?] PBI-/.test(l)).length, 0, `as linhas por PBI saem primeiro: ${sem.join('\n')}`);
  assert.equal(sem.filter((l) => /^PROJETO/.test(l)).length, 1);
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

test('projeto-sem-entrega-em-curso: a visão de entrega "sem entrega em curso" continua 1 linha (REQ-ENT-1 d i), mesmo com projeto no estado', () => {
  const pr = projetoDaFixture();
  const base = projetarPainel(null, null, entrada({ fatos: fatos({ plano: null, branch: 'main' }), entregaId: null, ultima: null, fora: false }));
  const ls = linhas(comProjeto({ ...base, umaLinha: { ultima: null } } as unknown as EstadoPainel, pr));
  assert.deepEqual(ls, ['GABARITO · sem entrega em curso']);
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
function montarRepo(opts: { semFL1?: boolean; fl1?: string } = {}): { repo: string; wt: string } {
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
  const cfg = { fluxo: opts.semFL1 === true ? {} : { mapeamento: { FL1: opts.fl1 ?? `${FL1}/` } } };
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
  for (const fl1 of ['../cards-de-fora', '/tmp/cards-de-fora', 'docs/../../x']) {
    const { repo } = montarRepo({ fl1 });
    mkdirSync(join(repo, '..', 'cards-de-fora'), { recursive: true });
    writeFileSync(join(repo, '..', 'cards-de-fora', 'PBI-8.md'), card('PBI-8', 'Concluído', '2026-11-01', 'Fora'));
    const r = estadoDe(repo);
    assert.equal(r.ok, true, fl1);
    assert.deepEqual((r.estado.projeto as EstadoProjeto).linhas, [], `${fl1}: nenhum card lido`);
  }
});

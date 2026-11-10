/**
 * Testes do preset Executivo (GM-12 T6, REQ-PNL-4 e REQ-PNL-9).
 * Mutações prescritas: .superpowers/sdd/2026-11-09-e4-painel/task-6-mut.json (MUT-PNL-4 e as da sombra-p1c.md, seção Task 6).
 * Costura (P9): `costura-projecao-real-ate-texto` passa por `projetarPainel` (projeção real do diário), `renderPainel` (despacho) e `paraTexto`.
 * Fora do alcance desta task: `exe-mesmos-numeros-do-esquadrao` compara com `renderEsquadrao`, que é da T5 (stub nesta worktree); ver `exe-numeros-vem-do-estado`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderExecutivo } from '../src/painel-executivo.ts';
import { renderPainel } from '../src/painel.ts';
import { blocoTopo, paraTexto } from '../src/painel-texto.ts';
import { colunas } from '../src/painel-largura.ts';
import { ESTADOS, EXTRAS, NOMES_ESTADOS, NOMES_EXTRAS } from './painel-fixtures/estados.ts';
import type { AgentePainel, EstadoPainel, OpcoesRender } from '../src/tipos.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const O = (largura: number, extra: Partial<OpcoesRender> = {}): OpcoesRender => ({ preset: 'executivo', tema: 'mono', narracao: true, largura, ...extra });
type Nome = (typeof NOMES_ESTADOS)[number] | (typeof NOMES_EXTRAS)[number];
const clone = (n: Nome): EstadoPainel => structuredClone(n in ESTADOS ? ESTADOS[n as keyof typeof ESTADOS] : EXTRAS[n as keyof typeof EXTRAS]);
const linhas = (e: EstadoPainel, w = 80, extra: Partial<OpcoesRender> = {}): string[] => paraTexto(renderExecutivo(e, O(w, extra)), 'mono').split('\n');
const texto = (e: EstadoPainel, w = 80, extra: Partial<OpcoesRender> = {}): string => linhas(e, w, extra).join('\n');
const linhaCom = (e: EstadoPainel, w: number, re: RegExp): string => linhas(e, w).find((l) => re.test(l)) ?? '';
const TODOS: [string, EstadoPainel][] = [...NOMES_ESTADOS, ...NOMES_EXTRAS].map((n) => [n, clone(n)]);
const SEM_LIXO = /NaN|Infinity|undefined|null|\[object/;

// ───────────────────────────── desenho de referência (mockup, em voo) ─────────────────────────────

test('exe-desenho-em-voo-80: o desenho do mockup, linha a linha', () => {
  const t = linhas(clone('em-voo-7-12'), 80);
  assert.match(t[0], /^GABARITO · GM-12 E4 Painel\s+executivo$/);
  assert.equal(t.find((l) => l.startsWith('Entrega')), `Entrega      ${'▰'.repeat(12)}${'▱'.repeat(9)} 58%`);
  assert.equal(t.find((l) => l.startsWith('Previsão')), 'Previsão     hoje 17:42 (±9 min, 7 medições)');
  assert.equal(t.find((l) => l.startsWith('Tasks')), 'Tasks        7 integradas · 3 em curso · 2 na fila');
  assert.equal(t.find((l) => l.startsWith('Qualidade')), 'Qualidade    1.4 rodada/review · 61 mutações mortas');
  assert.equal(t.find((l) => l.startsWith('CI')), 'CI           verde · 4 execuções hoje');
  assert.equal(t.find((l) => l.startsWith('Produção')), 'Produção     2 leituras · 0 alterações · janela [seg ter qua qui sex]');
  assert.equal(t.find((l) => l.startsWith('Contexto')), `Contexto     ${'█'.repeat(10)}${'░'.repeat(19)} 36%`);
  assert.equal(t.find((l) => l.startsWith('Limites')), 'Limites      5h 42% · 7d 18%');
  assert.match(t.find((l) => l.startsWith('Agentes em voo')) ?? '', /^Agentes em voo\s+2 vivos$/);
  assert.match(t.find((l) => l.startsWith('● implementador 1')) ?? '', /^● implementador 1  T8 Task T8\s+31% 62k · 9m$/);
  assert.match(t.find((l) => l.startsWith('● revisor 1')) ?? '', /^● revisor 1 {8}T9 Task T9\s+18% 36k · 3m$/);
  assert.equal(t.find((l) => l.startsWith('◐')), `◐ ${'revisor'.padEnd(15)}  aguarda T10`);
  assert.equal(t.find((l) => l.startsWith('○')), `○ ${'Sombra'.padEnd(15)}  3 decisões · #41 seguir com a forma opcional`);
});

test('exe-sem-nome-de-pacote: nenhum nome, líder ou sábio dos 4 pacotes, palavra inteira, caixa exata', () => {
  const dir = join(AQUI, '..', '..', 'mod', 'temas', 'nomes');
  const nomes = readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { nome: string; lider: string; sabio: string; nomes: string[] };
    return [j.nome, j.lider, j.sabio, ...j.nomes];
  });
  assert.ok(nomes.length >= 40);
  const e = clone('em-voo-7-12');
  e.pacote = 'Heróis';
  e.equipe.lider.nome = 'CAPITÃO';
  e.equipe.sombra.nome = 'STRANGE';
  e.equipe.agentes[0].nome = 'THOR';
  e.equipe.agentes[1].nome = 'HULK';
  e.equipe.revisoresAguardando[0].nome = 'WANDA';
  for (const w of [44, 50, 60, 80, 120]) {
    const t = texto(e, w);
    for (const n of nomes) assert.ok(!new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'u').test(t), `${n} em ${w}`);
  }
});

// ───────────────────────────── P15: campo lido × campo não lido ─────────────────────────────

type Troca = [string, (e: EstadoPainel) => void];
const T_AGENTE = (f: (a: AgentePainel) => void): ((e: EstadoPainel) => void) => (e) => f(e.equipe.agentes[0]);
const LIDOS: Troca[] = [
  ['id', (e) => { e.id = 'GM-99'; }],
  ['titulo', (e) => { e.titulo = 'Outro título'; }],
  ['plano.pct', (e) => { e.plano.pct = 31; }],
  ['plano.feitas', (e) => { e.plano.feitas = 6; }],
  ['plano.total (todas integradas)', (e) => { e.plano.feitas = 12; e.plano.total = 12; }],
  ['plano.eta.hora', (e) => { e.plano.eta!.hora = '19:05'; }],
  ['plano.eta.maisMenosS', (e) => { e.plano.eta!.maisMenosS = 1_200; }],
  ['plano.eta.n', (e) => { e.plano.eta!.n = 11; }],
  ['plano.tasks[].estado', (e) => { e.plano.tasks.find((t) => t.id === 'T11')!.estado = 'implementando'; }],
  ['plano.tasks[].titulo', (e) => { e.plano.tasks.find((t) => t.id === 'T8')!.titulo = 'Projeção nova'; }],
  ['qualidade.rodadaMedia', (e) => { e.qualidade.rodadaMedia = 2.2; }],
  ['qualidade.mortas', (e) => { e.qualidade.mortas = 7; }],
  ['rodape.ci.verde', (e) => { e.rodape.ci.verde = false; }],
  ['rodape.ci.execucoesHoje', (e) => { e.rodape.ci.execucoesHoje = 9; }],
  ['rodape.prod.leituras', (e) => { e.rodape.prod.leituras = 5; }],
  ['rodape.prod.alteracoes', (e) => { e.rodape.prod.alteracoes = 3; }],
  ['rodape.politica', (e) => { e.rodape.politica = 'continua'; }],
  ['lider.ctx', (e) => { e.equipe.lider.ctx = 77; }],
  ['lider.h5', (e) => { e.equipe.lider.h5 = 66; }],
  ['lider.d7', (e) => { e.equipe.lider.d7 = 55; }],
  ['equipe.vivos', (e) => { e.equipe.vivos = 5; }],
  ['agentes[].papel', T_AGENTE((a) => { a.papel = 'correcao'; })],
  ['agentes[].task', T_AGENTE((a) => { a.task = 'T11'; })],
  ['agentes[].ctxPct', T_AGENTE((a) => { a.ctxPct = 88; })],
  ['agentes[].ctxTok', T_AGENTE((a) => { a.ctxTok = 123_000; })],
  ['agentes[].desdeS', T_AGENTE((a) => { a.desdeS = 7_200; })],
  ['agentes[].vivo', T_AGENTE((a) => { a.vivo = false; })],
  ['revisoresAguardando[].task', (e) => { e.equipe.revisoresAguardando[0].task = 'T12'; }],
  ['sombra.decisoes', (e) => { e.equipe.sombra.decisoes = 9; }],
  ['sombra.ultima.seq', (e) => { e.equipe.sombra.ultima!.seq = 77; }],
  ['sombra.ultima.resposta', (e) => { e.equipe.sombra.ultima!.resposta = 'outra resposta'; }],
  ['parar', (e) => { e.parar = ESTADOS['parou-teto'].parar; }],
  ['parado', (e) => { e.parado = true; }],
];
const NAO_LIDOS: Troca[] = [
  ['pacote', (e) => { e.pacote = 'Outro pacote'; }],
  ['agentes[].nome', T_AGENTE((a) => { a.nome = 'OUTRONOME'; })],
  ['agentes[].cor (texto)', T_AGENTE((a) => { a.cor = 'planMode'; })],
  ['agentes[].tok', T_AGENTE((a) => { a.tok = 900_000; })],
  ['agentes[].modelo', T_AGENTE((a) => { a.modelo = 'outro-modelo'; })],
  ['lider.nome', (e) => { e.equipe.lider.nome = 'OUTROLIDER'; }],
  ['lider.narrativa', (e) => { e.equipe.lider.narrativa = 'narrativa nova'; }],
  ['lider.x', (e) => { e.equipe.lider.x = 80; }],
  ['lider.tok', (e) => { e.equipe.lider.tok = 5_000_000; }],
  ['lider.modelo', (e) => { e.equipe.lider.modelo = 'outro'; }],
  ['sombra.nome', (e) => { e.equipe.sombra.nome = 'OUTROSABIO'; }],
  ['sombra.ultima.fonte', (e) => { e.equipe.sombra.ultima!.fonte = 'spec:999'; }],
  ['sombra.modelo', (e) => { e.equipe.sombra.modelo = 'outro'; }],
  ['historico', (e) => { e.historico = [{ glifo: '✓', texto: 'evento novo', hora: '10:00', cor: 'success' }]; }],
  ['ocultos', (e) => { e.ocultos = 99; }],
  ['atencao', (e) => { e.atencao = ['item novo de atenção']; }],
  ['revisoresAguardando[].nome', (e) => { e.equipe.revisoresAguardando[0].nome = 'OUTRO'; }],
  ['revisoresAguardando[].mutacoesHoje', (e) => { e.equipe.revisoresAguardando[0].mutacoesHoje = 99; }],
  ['revisoresAguardando[].mortasHoje', (e) => { e.equipe.revisoresAguardando[0].mortasHoje = 98; }],
  ['plano.rodadaMedia', (e) => { e.plano.rodadaMedia = 3.3; }],
  ['plano.medianaS', (e) => { e.plano.medianaS = 9_999; }],
  ['plano.eta.restanteS', (e) => { e.plano.eta!.restanteS = 99_999; }],
  ['plano.tasks[].nome', (e) => { e.plano.tasks.find((t) => t.id === 'T8')!.nome = 'OUTRO'; }],
  ['plano.tasks[].glifo', (e) => { e.plano.tasks.find((t) => t.id === 'T8')!.glifo = '✗'; }],
  ['plano.tasks[].desdeS', (e) => { e.plano.tasks.find((t) => t.id === 'T8')!.desdeS = 99_999; }],
  ['notificacao', (e) => { e.notificacao = { hora: '09:09' }; }],
];

test('exe-cada-campo-lido: trocar o valor muda o texto (P15)', () => {
  for (const [nome, troca] of LIDOS) {
    const antes = texto(clone('em-voo-7-12'));
    const e = clone('em-voo-7-12');
    troca(e);
    assert.notEqual(texto(e), antes, `${nome} não mudou o texto`);
  }
});

test('exe-cada-campo-nao-lido: trocar o valor NÃO muda o texto em 44, 60 e 80 colunas (P15, cláusula negativa)', () => {
  for (const [nome, troca] of NAO_LIDOS) {
    for (const w of [44, 60, 80]) {
      const antes = texto(clone('em-voo-7-12'), w);
      const e = clone('em-voo-7-12');
      troca(e);
      assert.equal(texto(e, w), antes, `${nome} mudou o texto em ${w}`);
    }
  }
});

test('exe-ignora-narracao-e-tema: o.narracao não muda nada; tema mono × color dão a mesma Linha[]', () => {
  for (const [n, e] of TODOS) {
    for (const w of [44, 60, 80]) {
      assert.deepEqual(renderExecutivo(e, O(w, { narracao: true })), renderExecutivo(e, O(w, { narracao: false })), `${n} narracao ${w}`);
      assert.deepEqual(renderExecutivo(e, O(w, { tema: 'mono' })), renderExecutivo(e, O(w, { tema: 'color' })), `${n} tema ${w}`);
    }
  }
});

test('exe-sem-atencao-nem-historico: nada de histórico, ▼, ◆ ATENÇÃO nem ▶, mesmo com narracao e dados cheios', () => {
  const e = clone('historico-cheio');
  e.atencao = ['T9 na 2ª rodada de review'];
  const t = texto(e, 80, { narracao: true });
  assert.doesNotMatch(t, /▼|ATENÇÃO|▶|evento \d+|\d\d:\d\d [✓▶◆■●]/);
});

// ───────────────────────────── previsão ─────────────────────────────

test('exe-previsao-precedencia: parar > pausa > todas > sem dados > eta', () => {
  const prev = (e: EstadoPainel) => linhaCom(e, 80, /^Previsão/);
  const p = clone('em-voo-7-12'); p.parar = ESTADOS['parou-teto'].parar; p.parado = true;
  assert.equal(prev(p), 'Previsão     loop parado');
  const q = clone('em-voo-7-12'); q.parado = true;
  assert.equal(prev(q), 'Previsão     loop pausado');
  assert.equal(prev(clone('concluir-release')), 'Previsão     todas integradas');
  assert.equal(prev(clone('vazio')), 'Previsão     sem dados');
  const s = clone('em-voo-7-12'); s.plano.eta = null;
  assert.equal(prev(s), 'Previsão     sem dados');
});

test('exe-outro-dia-sem-hoje: ETA de outro dia escreve dd/mm hh:mm e nunca "hoje"; PAROU com eta nunca escreve hoje', () => {
  assert.equal(linhaCom(clone('eta-outro-dia'), 80, /^Previsão/), 'Previsão     10/11 09:00 (±9 min, 7 medições)');
  const e = clone('eta-outro-dia'); e.parar = ESTADOS['parou-teto'].parar;
  assert.doesNotMatch(texto(e), /hoje \d/);
  assert.equal(linhaCom(e, 80, /^Previsão/), 'Previsão     loop parado');
});

test('exe-medicao-singular: 1 medição', () => {
  const e = clone('em-voo-7-12'); e.plano.eta!.n = 1;
  assert.match(texto(e), /\(±9 min, 1 medição\)/);
});

test('exe-todas-integradas e exe-plano-vazio', () => {
  const t = linhas(clone('concluir-release'));
  assert.ok(t.includes('Tasks        12 integradas · 0 em curso · 0 na fila'));
  assert.ok(t.includes('Previsão     todas integradas'));
  const v = linhas(clone('vazio'));
  assert.ok(v.includes('Tasks        0 integradas · 0 em curso · 0 na fila'));
  assert.ok(v.includes('Previsão     sem dados'));
});

test('exe-pausa e exe-parou: pausa e PAROU aparecem; o rótulo da previsão acompanha', () => {
  assert.ok(linhaCom(clone('pausado'), 80, /^Previsão/).endsWith('loop pausado'));
  assert.match(texto(clone('pausado')), /loop pausado/);
  assert.match(texto(clone('parou-teto')), /PAROU/);
  assert.equal(linhaCom(clone('parou-teto'), 80, /^Previsão/), 'Previsão     loop parado');
});

test('exe-parou-diario: soma menor que o total, sem texto extra e sem lançar', () => {
  assert.ok(linhas(clone('parou-diario')).includes('Tasks        4 integradas · 1 em curso · 1 na fila'));
});

test('exe-no-teto-conta-em-curso: no_teto é em curso, nunca fila', () => {
  assert.ok(linhas(clone('no-teto')).includes('Tasks        7 integradas · 3 em curso · 2 na fila'));
});

// ───────────────────────────── qualidade, CI, produção, limites ─────────────────────────────

test('exe-mutacoes-contagem-nao-pct: 61 mortas escrito como contagem; nenhum % na linha Qualidade', () => {
  const e = clone('em-voo-7-12'); e.qualidade.mortas = 61;
  const l = linhaCom(e, 80, /^Qualidade/);
  assert.match(l, /61 mutações mortas/);
  assert.doesNotMatch(l, /%/);
});

test('exe-qualidade-um-null: um null mostra só o outro; os dois null = sem dados; 0 aparece; singular', () => {
  const q = (rodadaMedia: number | null, mortas: number | null): string => {
    const e = clone('em-voo-7-12'); e.qualidade = { rodadaMedia, mortas };
    return linhaCom(e, 80, /^Qualidade/);
  };
  assert.equal(q(null, null), 'Qualidade    sem dados');
  assert.equal(q(null, 0), 'Qualidade    0 mutações mortas');
  assert.equal(q(1.1, null), 'Qualidade    1.1 rodada/review');
  assert.equal(q(1.1, 1), 'Qualidade    1.1 rodada/review · 1 mutação morta');
  assert.equal(q(NaN, -4), 'Qualidade    sem dados');
});

test('exe-ci: verde, vermelho, sem dados, singular, zero e não inteiro', () => {
  const c = (verde: boolean | null, n: number): string => {
    const e = clone('em-voo-7-12'); e.rodape.ci = { verde, execucoesHoje: n };
    return linhaCom(e, 80, /^CI/);
  };
  assert.equal(c(true, 2), 'CI           verde · 2 execuções hoje');
  assert.equal(c(false, 1), 'CI           vermelho · 1 execução hoje');
  assert.equal(c(null, 5), 'CI           sem dados');
  assert.equal(c(true, 0), 'CI           verde · 0 execuções hoje');
  assert.equal(c(true, 1.5), 'CI           verde · — execuções hoje');
});

test('exe-linha-de-prod: singulares, zero e política', () => {
  const e = clone('em-voo-7-12'); e.rodape.prod = { leituras: 1, alteracoes: 1 }; e.rodape.politica = 'continua';
  assert.equal(linhaCom(e, 80, /^Produção/), 'Produção     1 leitura · 1 alteração · continua');
});

test('exe-limites-um-null e exe-limites-zero: cada um omitido se null; zero aparece; os dois null some a linha', () => {
  const l = (h5: number | null, d7: number | null): string => {
    const e = clone('em-voo-7-12'); e.equipe.lider.h5 = h5; e.equipe.lider.d7 = d7;
    return linhaCom(e, 80, /^Limites/);
  };
  assert.equal(l(0, null), 'Limites      5h 0%');
  assert.equal(l(null, 0), 'Limites      7d 0%');
  assert.equal(l(42, 18), 'Limites      5h 42% · 7d 18%');
  assert.equal(l(null, null), '');
  assert.equal(l(NaN, -1), '');
});

test('exe-contexto-null-traco e exe-contexto-acima-de-100', () => {
  const e = clone('em-voo-7-12'); e.equipe.lider.ctx = null;
  assert.equal(linhaCom(e, 80, /^Contexto/), 'Contexto     —');
  e.equipe.lider.ctx = 120;
  assert.match(linhaCom(e, 80, /^Contexto/), /^Contexto {5}█{29} 120%$/);
});

test('exe-zero-aparece: zeros escritos como 0, nunca omitidos', () => {
  const t = texto(clone('zeros'));
  assert.match(t, /0 mutações mortas/);
  assert.match(t, /0 execuções hoje/);
  assert.match(t, /5h 0%/);
});

// ───────────────────────────── agentes ─────────────────────────────

const mk = (papel: AgentePainel['papel'], task: string, estadoTask: AgentePainel['estadoTask']): AgentePainel =>
  ({ nome: 'X', papel, task, estadoTask, modelo: null, ctxPct: 10, ctxTok: 5_000, tok: 1, desdeS: 60, cor: 'claude', vivo: true });

test('exe-numeracao-por-generico: 2 implementadores e 1 correcao, ordem de equipe.agentes, 1 revisor', () => {
  const e = clone('em-voo-7-12');
  e.equipe.agentes = [mk('implementador', 'T8', 'implementando'), mk('implementador', 'T9', 'implementando'), mk('correcao', 'T10', 'corrigindo'), mk('revisor', 'T11', 'em_revisao')];
  e.equipe.vivos = 4;
  const t = linhas(e);
  assert.match(t.find((l) => l.includes('implementador 1')) ?? '', /^● implementador 1 +T8 /);
  assert.match(t.find((l) => l.includes('implementador 2')) ?? '', /^● implementador 2 +T9 /);
  assert.match(t.find((l) => l.includes('implementador 3')) ?? '', /^● implementador 3 +T10 .*\(corrigindo\)/);
  assert.equal(t.filter((l) => l.includes('(corrigindo)')).length, 1, '(corrigindo) só para correcao');
  assert.match(t.find((l) => l.includes('revisor 1')) ?? '', /^● revisor 1 +T11 /);
  assert.doesNotMatch(texto(e), /correcao/);
});

test('exe-correcao-sem-titulo-ainda-escreve-sufixo e corte do título preserva o sufixo', () => {
  const e = clone('em-voo-7-12');
  e.equipe.agentes = [mk('correcao', 'T8', 'corrigindo')];
  e.equipe.vivos = 1;
  e.plano.tasks.find((t) => t.id === 'T8')!.titulo = 'x'.repeat(120);
  for (const w of [60, 72, 80]) {
    const l = linhaCom(e, w, /implementador 1/);
    assert.ok(colunas(l) <= w);
    assert.match(l, /\(corrigindo\) +10% 5k · 1m$/, `em ${w}`);
  }
});

test('exe-numero-sempre-escrito: um só implementador é "implementador 1"; sem task é "agente 1"', () => {
  assert.match(texto(clone('em-voo-7-12')), /● implementador 1 /);
  const t = linhas(clone('sem-task'));
  assert.match(t.find((l) => l.includes('agente 1')) ?? '', /^● agente 1 +sem task +12% 24k$/);
});

test('exe-sem-agente-fora: ◌ não vira linha de agente, mas conta em "em curso"', () => {
  const t = linhas(clone('sem-agente'));
  assert.ok(!t.some((l) => l.startsWith('●') || l.includes('◌')));
  assert.ok(t.includes('Tasks        0 integradas · 1 em curso · 1 na fila'));
  assert.match(t.find((l) => l.startsWith('Agentes em voo')) ?? '', /0 vivos$/);
});

test('exe-sem-mod-traco: vivos null = cabeçalho "—", nenhuma linha de agente, revisor aguardando e Sombra continuam', () => {
  const t = linhas(clone('sem-mod'));
  assert.match(t.find((l) => l.startsWith('Agentes em voo')) ?? '', /^Agentes em voo\s+—$/);
  assert.ok(!t.some((l) => l.startsWith('●')));
  assert.ok(t.some((l) => l.startsWith('◐ revisor')));
  assert.ok(t.some((l) => l.startsWith('○ Sombra')));
  assert.doesNotMatch(t.join('\n'), /0 vivos/);
});

test('exe-ctx-so-tokens-e-nunca-tok: ctxPct null mostra só ctxTok; os dois null = ctx —; tok (soma) nunca', () => {
  assert.match(linhaCom(clone('pct-so-tokens'), 80, /implementador 1/), /\s88k · 9m$/);
  const e = clone('em-voo-7-12'); e.equipe.agentes[0].tok = 900_000;
  assert.doesNotMatch(texto(e), /900k/);
  e.equipe.agentes[0].ctxPct = null; e.equipe.agentes[0].ctxTok = null;
  assert.match(linhaCom(e, 80, /implementador 1/), /ctx — · 9m$/);
});

test('exe-agente-sem-tempo: desdeS null, não finito e negativo (corrompido) não escrevem tempo', () => {
  const e = clone('em-voo-7-12');
  for (const v of [null, Infinity, NaN, -5]) {
    e.equipe.agentes[0].desdeS = v;
    assert.match(linhaCom(e, 80, /implementador 1/), /31% 62k$/, String(v));
  }
});

test('exe-cor-do-glifo: o glifo do agente usa a cor do estado da task (T-E), não a de identidade', () => {
  const e = clone('em-voo-7-12');
  const cor = (est: AgentePainel['estadoTask']): string | undefined => {
    e.equipe.agentes[0].estadoTask = est;
    return renderExecutivo(e, O(80)).find((l) => l[0].texto === '●' && l.some((s) => s.texto.includes('implementador 1')))?.[0].cor;
  };
  assert.equal(cor('implementando'), 'success');
  assert.equal(cor('corrigindo'), 'warning');
  assert.equal(cor(null), 'inactive');
});

test('exe-sombra: singular, zero, sem ultima, resposta cortada pela largura, <60 só a contagem', () => {
  const e = clone('em-voo-7-12');
  e.equipe.sombra = { nome: 'ELROND', modelo: 'opus', decisoes: 1, ultima: { seq: 14, resposta: 'largura mínima 44', fonte: null } };
  assert.equal(linhaCom(e, 80, /^○/), `○ ${'Sombra'.padEnd(15)}  1 decisão · #14 largura mínima 44`);
  e.equipe.sombra = { nome: 'ELROND', modelo: null, decisoes: 0, ultima: null };
  assert.equal(linhaCom(e, 80, /^○/), `○ ${'Sombra'.padEnd(15)}  0 decisões`);
  e.equipe.sombra = { nome: 'ELROND', modelo: null, decisoes: 3, ultima: { seq: 5, resposta: 'x'.repeat(200), fonte: null } };
  assert.ok(colunas(linhaCom(e, 60, /^○/)) <= 60);
  assert.equal(linhaCom(e, 59, /^○/), '○ Sombra  3 dec');
  assert.equal(linhaCom(e, 44, /^○/), '○ Sombra  3 dec');
});

test('exe-revisor-aguardando: nunca o nome, mesmo com nome no estado', () => {
  const e = clone('em-voo-7-12'); e.equipe.revisoresAguardando = [{ nome: 'LEGOLAS', task: 'T10', mutacoesHoje: 3, mortasHoje: 1 }];
  assert.equal(linhaCom(e, 80, /^◐/), `◐ ${'revisor'.padEnd(15)}  aguarda T10`);
  assert.doesNotMatch(texto(e), /LEGOLAS/);
});

// ───────────────────────────── faixas de largura ─────────────────────────────

test('exe-bordas: 49/50 troca o rótulo, 59/60 troca a linha de agente, exatamente na borda', () => {
  const e = clone('em-voo-7-12');
  assert.ok(linhas(e, 50).some((l) => l.startsWith('Entrega      ')));
  assert.ok(linhas(e, 49).some((l) => l.startsWith('Ent ')));
  assert.ok(!linhas(e, 49).some((l) => l.startsWith('Entrega')));
  assert.match(linhaCom(e, 60, /implementador 1/), /T8 Task T8 .*31% 62k · 9m$/);
  assert.match(linhaCom(e, 59, /implementador 1/), /^● implementador 1  T8 +31%$/);
  assert.doesNotMatch(linhaCom(e, 59, /implementador 1/), /Task T8|62k|9m/);
});

test('exe-49-rotulos-3-letras: Ent Prv Tsk Qld CI Prd Ctx Lim', () => {
  const t = linhas(clone('em-voo-7-12'), 49);
  for (const r of ['Ent ', 'Prv ', 'Tsk ', 'Qld ', 'CI  ', 'Prd ', 'Ctx ', 'Lim ']) assert.ok(t.some((l) => l.startsWith(r)), r);
  assert.ok(t.includes('Tsk 7 integradas · 3 em curso · 2 na fila'));
});

test('exe-agentes-59-colunas: só papel, task e ctx%', () => {
  const t = linhas(clone('em-voo-7-12'), 59);
  assert.ok(t.includes('● implementador 1  T8  31%'));
  assert.ok(t.includes('● revisor 1  T9  18%'));
  assert.ok(t.includes('◐ revisor  aguarda T10'));
});

test('exe-topo-identico-ao-blocoTopo: o topo vem de blocoTopo sem alteração, em todas as larguras e estados', () => {
  for (const [n, e] of TODOS) {
    for (const w of [20, 44, 49, 50, 59, 60, 72, 80, 120]) {
      const esperado = paraTexto(blocoTopo(e, w), 'mono').split('\n');
      assert.deepEqual(linhas(e, w).slice(1, 1 + esperado.length), esperado, `${n} em ${w}`);
    }
  }
});

test('exe-nunca-passa-largura: toda linha cabe, 20 a 200 colunas, todas as fixtures', () => {
  for (const [n, e] of TODOS) {
    for (let w = 20; w <= 200; w += 1) {
      for (const l of renderExecutivo(e, O(w))) {
        const c = l.reduce((a, s) => a + colunas(s.texto), 0);
        assert.ok(c <= w, `${n} em ${w}: ${c} colunas: ${l.map((s) => s.texto).join('')}`);
      }
    }
  }
});

test('exe-sem-lixo-no-texto e exe-sem-itens-cortados: sem NaN/undefined/null, sem vocabulário cortado, sem SGR no mono', () => {
  for (const [n, e] of TODOS) {
    for (const w of [20, 44, 60, 80, 200]) {
      const t = texto(e, w);
      assert.doesNotMatch(t, SEM_LIXO, `${n} ${w}`);
      assert.doesNotMatch(t, /slots|serviço pago|autorizar|afetados|\bRED\b|\bGREEN\b|pousad/, `${n} ${w}`);
      assert.doesNotMatch(t, /\x1b/, `${n} ${w}`);
    }
  }
});

test('estado-ausente-x-corrompido: ausente e corrompido dão saídas distintas e nunca lançam', () => {
  const c = clone('numeros-corrompidos');
  assert.doesNotThrow(() => renderExecutivo(c, O(80)));
  assert.match(linhaCom(c, 80, /^Entrega/), /^Entrega {6}▱{21} —$/, 'pct NaN = barra vazia e —');
  assert.doesNotMatch(texto(c), SEM_LIXO);
  const a = clone('em-voo-7-12');
  a.plano.tasks = a.plano.tasks.map((t) => { const { titulo: _t, ...r } = t; return r; });
  a.titulo = null;
  assert.doesNotThrow(() => renderExecutivo(a, O(80)));
  assert.match(linhas(a)[0], /^GABARITO · GM-12\s+executivo$/);
  assert.match(linhaCom(a, 80, /implementador 1/), /^● implementador 1  T8 +31% 62k · 9m$/);
  const v = clone('em-voo-7-12'); v.historico = [];
  assert.equal(texto(v), texto(clone('em-voo-7-12')));
});

test('exe-titulos-hostis: CJK, emoji ZWJ e escape contidos; id de 10 caracteres preservado', () => {
  const e = clone('titulos-hostis');
  for (const w of [30, 44, 60, 80]) {
    assert.doesNotMatch(texto(e, w), /\x1b/);
    assert.ok(linhas(e, w)[0].startsWith('GABARITO · GM-12-ABCD'), `id em ${w}`);
  }
});

test('exe-largura-invalida-lanca: NaN, 0, -3, Infinity, 0.5 lançam RangeError; 1.9 usa floor', () => {
  for (const w of [NaN, 0, -3, Infinity, 0.5]) assert.throws(() => renderExecutivo(clone('em-voo-7-12'), O(w)), RangeError, String(w));
  assert.deepEqual(renderExecutivo(clone('em-voo-7-12'), O(1.9)), renderExecutivo(clone('em-voo-7-12'), O(1)));
});

test('exe-numeros-vem-do-estado: pct, feitas, hora do ETA, ±N, ctx, 5h/7d, CI, leituras, decisões e ctx de cada agente batem com o estado', () => {
  const e = clone('em-voo-7-12');
  const t = texto(e);
  const alvo = [`${e.plano.pct}%`, `${e.plano.feitas} integradas`, e.plano.eta!.hora, `±${Math.round(e.plano.eta!.maisMenosS / 60)} min`, `${e.equipe.lider.ctx}%`,
    `5h ${e.equipe.lider.h5}%`, `7d ${e.equipe.lider.d7}%`, `${e.rodape.ci.execucoesHoje} execuções`, `${e.rodape.prod.leituras} leituras`, `${e.equipe.sombra.decisoes} decisões`,
    ...e.equipe.agentes.map((a) => `${a.ctxPct}% ${Math.round(a.ctxTok! / 1000)}k`)];
  for (const a of alvo) assert.ok(t.includes(a), a);
});

test('costura-projecao-real-ate-texto: renderPainel despacha o preset executivo sobre o estado e o texto sai por paraTexto', () => {
  const e = clone('em-voo-7-12');
  assert.deepEqual(renderPainel(e, O(80)), renderExecutivo(e, O(80)));
  assert.match(paraTexto(renderPainel(e, O(80, { tema: 'color' })), 'color'), /\x1b\[\d+m/);
  assert.match(paraTexto(renderPainel(e, O(80)), 'mono'), /Agentes em voo/);
});

test('exe-cabecalho-26-a-35: o título é cortado antes de "executivo" cair; o id nunca é cortado', () => {
  const e = clone('em-voo-7-12');
  for (let w = 26; w <= 35; w++) {
    const l = linhas(e, w)[0];
    assert.ok(l.startsWith('GABARITO · GM-12'), `id em ${w}`);
    assert.ok(l.endsWith('executivo'), `direita em ${w}: ${l}`);
    assert.ok(w >= 36 || l.includes('…') || !l.includes('E4'), `esquerda cortada antes da direita cair em ${w}`);
  }
  assert.equal(linhas(e, 30)[0], 'GABARITO · GM-12 E4… executivo');
});

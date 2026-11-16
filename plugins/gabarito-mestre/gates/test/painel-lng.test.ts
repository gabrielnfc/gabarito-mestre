/**
 * Propriedade de REQ-LNG-1 e invariantes globais do render (GM-14 T17; E49): 10 estados reais (`projetarPainel` com `fatos`, que passa por
 * `trilhaDe`, `perguntasAbertas` e `dependeDe` reais) × larguras 20..200 (passo 20) × 2 presets × 2 temas, com nomes que a regex técnica pega
 * (`true_force`, `gabarito-mestre--v2.0.0`, `meu_app.config`, `notas.md`), marcação, emoji e descrição técnica. Em TODA linha:
 *  - 0 `linhaTecnica` (regex literal, ponto entre letras, palavra que é tipo de evento ou motivo de parada);
 *  - 0 `\p{Extended_Pictographic}` e 0 U+FE0F; todo símbolo fora de letra/número/pontuação comum está na lista fechada de glifos;
 *  - número nunca cortado (`\d…` não aparece); ausente ≠ zero (contexto não medido é "?", nunca "0 %");
 *  - ID de entrega nunca naturalizado (`GM-14` nunca vira `GM 14`); nenhuma linha passa da largura.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projetarPainel, renderPainel } from '../src/painel.ts';
import { colunas, paraTexto } from '../src/painel-texto.ts';
import { linhaTecnica } from '../src/origem.ts';
import type { FatosTrilha } from '../src/trilha.ts';
import type { AgenteVivo, EntradaPainel, EstadoPainel, Evento, Plano, TipoEvento } from '../src/tipos.ts';

const T0 = Date.parse('2026-11-11T12:00:00Z');
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString();
const AGORA = T0 + 3 * 3_600_000;
type Item = { t: number; tipo: TipoEvento; dados?: unknown; sessao?: string; agente?: string };
const e = (t: number, tipo: TipoEvento, dados: unknown = {}, sessao = 's1', agente = 'orquestrador'): Item => ({ t, tipo, dados, sessao, agente });
function D(itens: Item[]): Evento[] {
  const seqs = new Map<string, number>();
  return [...itens].map((x, i) => ({ x, i })).sort((a, b) => a.x.t - b.x.t || a.i - b.i).map(({ x }) => {
    const sessao = x.sessao ?? 's1';
    const seq = (seqs.get(sessao) ?? 0) + 1;
    seqs.set(sessao, seq);
    return { seq, ts: iso(x.t), autor: 't', sessao, agente: x.agente ?? 'orquestrador', tipo: x.tipo, dados: x.dados, hash_anterior: null } as unknown as Evento;
  });
}
const ini = (t: number, task: string, papel = 'implementador') => e(t, 'task.iniciada', { task, papel });
const con = (t: number, task: string) => e(t, 'task.concluida', { task });
const ver = (t: number, task: string, ok: boolean, rodada = 1, major = 0) => e(t, 'review.veredito', { task, veredito: ok ? 'APROVADO' : 'REPROVADO', rodada, major, blocker: 0 });
const ciclo = (task: string, a: number): Item[] => [ini(a, task), con(a + 1, task), ini(a + 2, task, 'revisor'), ver(a + 5, task, true), e(a + 6, 'task.integrada', { task })];
const noTeto = (task: string, a: number): Item[] => [
  ini(a, task), con(a + 1, task), ini(a + 2, task, 'revisor'), ver(a + 3, task, false, 1, 1),
  ini(a + 4, task, 'correcao'), con(a + 5, task), ini(a + 6, task, 'revisor'), ver(a + 7, task, false, 2, 1),
];
const nota = (t: number, tipo: string, texto: string, extra: Record<string, unknown> = {}) => e(t, 'nota', { tipo, texto, ...extra });
const DEC = (t: number, resposta: string) => e(t, 'decisao.sombra', { pergunta_hash: 'a'.repeat(64), task: 'T3', resposta, arquivo: 'sombra.md', pergunta_enviesada: false, fontes: ['spec:1'] });

const IDS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const P: Plano = { entrega: 'GM-14', tasks: IDS.map((id) => ({ id, deps: [], arquivos: [] })) };
const PACOTE = { nome: 'Terra Média', lider: 'GANDALF', sabio: 'ELROND', nomes: ['ARAGORN', 'LEGOLAS', 'GIMLI', 'FRODO', 'SAM', 'MERRY', 'PIPPIN', 'BOROMIR'] };
const SPEC = { caminho: 'docs/superpowers/specs/2026-11-11-gm14-clareza-design.md', pbi: 'GM-14', sha256: 'a'.repeat(64), secoes: 6, titulo: 'true_force e `notas.md`' };
const SPEC2 = { ...SPEC, caminho: 'docs/superpowers/specs/2026-11-11-gm14-outra.md', titulo: 'meu_app.config' };
const fatos = (extra: Partial<FatosTrilha> = {}): FatosTrilha => ({
  branch: 'enabler/GM-14-clareza', idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: IDS }, ledger: false, gh: 'ok', ultimas: [], sessao: 's1', ...extra,
});
const vivo = (description: string, type = 'general-purpose'): AgenteVivo => ({ id: `a-${description}`, type, description, status: 'running', uso: null });
const TITULO = 'GM-14 — **true_force** em `gabarito-mestre--v2.0.0` ⚠️ com meu_app.config e notas.md';
const entrada = (extra: Record<string, unknown> = {}) => ({
  decisaoEntrega: null, pausado: false, contexto: { percent: null, tokens: null, window: null }, limites: { h5: null, d7: null }, x: 50, agentes: [],
  pacote: PACOTE, notificacao: null, agoraMs: AGORA, fuso: 'UTC', titulo: TITULO, politica: { politica: 'continua', dias: null },
  entregaId: 'GM-14', modeloSessao: null, specSha: null, tetoSombra: 26, fatos: fatos(), ...extra,
}) as unknown as EntradaPainel & { fatos: FatosTrilha };

/** Os 12 estados (nomeados); 2 com ID de entrega técnico (`true_force`) no cabeçalho e na linha única (E49). */
const ESTADOS: [string, () => EstadoPainel][] = [
  ['uma-linha', () => projetarPainel(null, D([]), entrada({ fatos: fatos({ branch: 'main', plano: null }), ultima: { id: 'GM-13', estado: 'publicada em gabarito-mestre--v2.0.0' } }))],
  ['uma-linha-id-tecnico', () => projetarPainel(null, D([]), entrada({ fatos: fatos({ branch: 'main', plano: null }), ultima: { id: 'true_force', estado: 'publicada' } }))],
  ['cabecalho-id-tecnico', () => projetarPainel({ ...P, entrega: 'true_force' }, D([ini(0, 'T1')]), entrada({ entregaId: 'true_force', titulo: 'true_force — painel' }))],
  ['fora', () => projetarPainel(null, D([]), entrada({ fatos: fatos({ branch: null, plano: null }), fora: true }))],
  ['projeto-pergunta-b', () => projetarPainel(null, D([nota(1, 'desvio', 'usar true_force no meu_app.config')]),
    entrada({ fatos: fatos({ branch: 'main', plano: null, ultimas: [{ id: 'GM-13', data: iso(-60) }, { id: 'true_force', data: iso(-90) }] }) }))],
  ['fase-spec-ambigua', () => projetarPainel(null, D([
    e(1, 'fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: SPEC.caminho, sha256: SPEC.sha256, secoes: 6 } }),
    e(2, 'fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: SPEC2.caminho, sha256: SPEC2.sha256, secoes: 6 } }),
  ]), entrada({ fatos: fatos({ plano: null, specs: [SPEC, SPEC2] }), agentes: [vivo('revisar a spec-brief.md com node', 'gabarito-mestre:gabarito-revisor')] }))],
  ['execucao-agentes', () => projetarPainel(P, D([...ciclo('T1', 0), ...ciclo('T2', 10), ...ciclo('T3', 20), ini(40, 'T4'), ini(41, 'T5'), con(42, 'T5'), ini(43, 'T5', 'revisor')]),
    entrada({ contexto: { percent: 61, tokens: null, window: null }, agentes: [vivo('T4 implementador'), vivo('T5 revisor'), vivo('Rascunho do `loop.mjs` --flag em /tmp/x ⚠')] }))],
  ['parou-teto-pergunta', () => projetarPainel(P, D([...noTeto('T1', 0), e(20, 'loop.parar', { motivo: 'teto_rodadas', task: 'T1' }),
    nota(21, 'duvida', 'usar true_force ou notas.md?', { opcoes: ['true_force', 'docs/superpowers/specs/x.md', 'smoke_tests'] })]), entrada())],
  ['pendencia-ideias-emenda', () => projetarPainel(P, D([nota(1, 'pendencia', 'renovar o meu_app.config em `node` --force'), nota(2, 'ideia', 'x'), nota(3, 'ideia', 'y'),
    e(4, 'emenda.proposta', { req: 'REQ-DEP-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', arquivos: ['docs/x.md'] }, 'emendas')]), entrada({ pousoPendente: true }))],
  ['recente-cheio', () => projetarPainel(P, D([...ciclo('T1', 0), ...ciclo('T2', 10), ini(30, 'T3'), con(31, 'T3'), ini(32, 'T3', 'revisor'), ver(33, 'T3', false, 1, 2),
    DEC(34, 'seguir com `loop.mjs` e true_force.config'), e(35, 'loop.pausa', { estado: 'pausado' }), e(36, 'loop.pausa', { estado: 'retomado' }),
    e(37, 'loop.parar', { motivo: 'smoke' }), e(38, 'loop.parar', { motivo: 'janela_ausente' })]), entrada({ agentes: null }))],
  ['fontes-falhas-desatualizado', () => projetarPainel(P, null, entrada({ fontesFalhas: ['o GitHub', 'painel-medir.json'], desatualizadoS: 900, decisaoEntrega: { tipo: 'parar', motivo: 'teto_tokens' } }))],
  ['producao-ci-em-voo', () => projetarPainel(P, D([ini(0, 'T1'), e(1, 'producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'api.prod.com' }),
    e(2, 'ci.resultado', { verde: false, alvo: 'main' }), e(3, 'entrega.devolvida', { motivo: 'executar negado: rode node entrega.mjs --force' }),
    e(4, 'loop.parar', { motivo: 'rollback' })]), entrada({ agentes: [], pausado: true }))],
];

/** GM-15 T29 (D-G1c): os glifos do desenho do E4 (`█ ░ │ ├ └ ◆ ■ ▸ ▼`) entram; nenhum é `Extended_Pictographic` (medido). `▶` e `⚠` seguem fora. */
const GLIFOS = new Set(['✓', '●', '○', '◐', '✗', '▰', '▱', '·', '›', '─', '?', '…', '█', '░', '│', '├', '└', '◆', '■', '▸', '▼']);
/** Fora de letra, número, espaço, pontuação e símbolo ASCII ou Latin-1, só a lista fechada de glifos (REQ-LNG-1, Emenda 2): `⚠` e `▶` não passam. */
const foraDaLista = (l: string): string[] => [...l].filter((c) => !/[\p{L}\p{N}\p{P}\s]/u.test(c) && !(c.codePointAt(0) as number <= 0xff) && !GLIFOS.has(c));
const SGR = /\x1b\[[0-9;]*m/g;

test('lng-propriedade: 12 estados × larguras 20..200 × 2 presets × 2 temas ⇒ 0 linha técnica, 0 emoji, glifos da lista, número inteiro, ID cru', () => {
  let linhas = 0;
  for (const [nome, fazer] of ESTADOS) {
    const s = fazer();
    assert.ok(s.modo !== undefined, `${nome}: estado novo`);
    for (let largura = 20; largura <= 200; largura += 20) {
      for (const preset of ['esquadrao', 'executivo'] as const) {
        for (const tema of ['mono', 'color'] as const) {
          const saida = paraTexto(renderPainel(s, { preset, tema, narracao: true, largura }), tema).replace(SGR, '');
          for (const l of saida.split('\n')) {
            linhas++;
            const onde = `${nome} ${preset} ${tema} ${largura}: "${l}"`;
            assert.ok(!linhaTecnica(l), `técnica: ${onde}`);
            assert.doesNotMatch(l, /\p{Extended_Pictographic}|️/u, `emoji: ${onde}`);
            assert.deepEqual(foraDaLista(l), [], `glifo fora da lista: ${onde}`);
            // número solto cortado; id de task (`T3`) não é número (a mesma definição de `NUMERO_NO_FIM`, painel-texto.ts) — no histórico do E4 o id cai no fim da linha
            assert.doesNotMatch(l, /(?<![A-Za-z0-9_-])\d[0-9/:.,]*…/, `número cortado: ${onde}`);
            assert.doesNotMatch(l, /\b0 %|contexto 0\b|ctx ░* ?0%|tok 0\b|[57][hd] ░+ 0%/, `ausente virou zero: ${onde}`);
            assert.doesNotMatch(l, /—/, `"—" no lugar de "?": ${onde}`);
            assert.doesNotMatch(l, /GM 1[34]\b/, `ID naturalizado: ${onde}`);
            assert.doesNotMatch(l, /\b(true force|minha entrega) \1\b/i, `ID repetido (título sem o prefixo, FIEL-5 a): ${onde}`);
            assert.ok(colunas(l) <= largura, `passou da largura: ${onde}`);
          }
        }
      }
    }
  }
  assert.ok(linhas > 2000, `cobriu ${linhas} linhas`);
});

test('rotulo-com-ponto-e-sublinhado-normalizado: nome e título que a regex pega viram palavras; tag vira X.Y.Z (Review Focus 5)', () => {
  const s = ESTADOS.find(([n]) => n === 'execucao-agentes')![1]();
  const l = paraTexto(renderPainel(s, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 200 }), 'mono').split('\n');
  assert.equal(l[0].replace(/ {2,}(esquadrão( · .*)?|executivo)$/, ''), 'GABARITO · GM-14 true force em 2.0.0 com meu app config e notas md'); // GM-15 T29: o rótulo do preset à direita é desenho do E4
  const u = paraTexto(renderPainel(ESTADOS.find(([n]) => n === 'uma-linha')![1](), { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 200 }), 'mono');
  assert.equal(u, 'GABARITO · sem entrega em curso · última: GM-13 (publicada em 2.0.0)');
});

test('ausente-nao-e-zero: contexto não medido é "?"; 0 medido é 0', () => {
  const r = (pct: number | null) => paraTexto(renderPainel(projetarPainel(P, D([]), entrada({ contexto: { percent: pct, tokens: null, window: null } })),
    { preset: 'esquadrao', tema: 'mono', narracao: true, largura: 120 }), 'mono');
  // GM-15 T29 (desenho do E4): sem medição, "?" no lugar da barra; 0 medido é barra vazia com 0%
  // GM-15 T33 (g.9): a 120 colunas o "?" diz por que falta o dado; o 5h ausente é omitido (g.10, D-G7), o 7d segue com o motivo
  assert.match(r(null), /^│ {2}ctx \? \(sem medição\) · pouso em 50% {3}tok \? \(sem medição\)$/m);
  assert.match(r(0), /^│ {2}ctx ░+ 0% · pouso em 50% {3}tok \? \(sem medição\)$/m);
  assert.match(r(Number.NaN as unknown as number), /^│ {2}ctx \? \(sem medição\) · /m);
  assert.match(r(null), /^│ {2}7d \? \(sem medição\)$/m);
  assert.doesNotMatch(r(null), /5h/);
  assert.doesNotMatch(r(null), /ctx [█░]|ctx 0%/);
});

test('palavra-tipo-em-qualquer-caixa: "Nota", "SMOKE", "Rollback" e "node-api" no título viram "…"; o resto fica (decisão a confirmar com a Sombra)', () => {
  const s = projetarPainel(P, D([]), entrada({ titulo: 'Nota fiscal com SMOKE, Rollback e node-api' }));
  const l = paraTexto(renderPainel(s, { preset: 'executivo', tema: 'mono', narracao: true, largura: 200 }), 'mono').split('\n')[0].replace(/ {2,}executivo$/, '');
  assert.equal(l, 'GABARITO · GM-14 … fiscal com … e … api'); // reticências seguidas viram uma
  assert.ok(!linhaTecnica(l));
});

test('glifos-que-viram-emoji-seguem-barrados (GM-15 T29): a lista aceita os do E4, mas `▶` e `⚠` (pictográficos) continuam fora', () => {
  assert.deepEqual(foraDaLista('│  ▸ narração ├─ └─ █░ ◆ ■ ▼ 3'), []);
  assert.deepEqual(foraDaLista('│  ▶ narração'), ['▶']);
  assert.deepEqual(foraDaLista('⚠ cuidado'), ['⚠']);
  for (const c of ['█', '░', '│', '├', '└', '◆', '■', '▸', '▼']) assert.doesNotMatch(c, /\p{Extended_Pictographic}/u, c);
  assert.match('▶', /\p{Extended_Pictographic}/u);
});

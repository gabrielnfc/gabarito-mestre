/**
 * Goldens, propriedade de largura e PAROU idêntico do painel (E4, GM-12, T12). Sem código de produto: defeito volta à task dona.
 *
 * GOLDENS. `painel-golden/<preset>-<largura>.txt` é o texto `mono` do estado `em-voo-7-12` (7 de 12 integradas, T8 implementando, T9 em revisão,
 * T10 concluída aguardando revisor) nas larguras 44, 60, 72 e 80, nos dois presets. Os arquivos foram GERADOS do próprio render e depois CONFERIDOS contra o
 * mockup, a spec (REQ-PNL-4, REQ-PNL-5, REQ-PNL-9; vocabulário do produto: `integradas`, nunca "pousadas"; sem os itens cortados de spec:189) e a tabela da P1c,
 * pela T12 e pelo review: NÃO são um oráculo independente (o review da T12 achou defeitos congelados aqui: singular, 0 sem medição, notificação antiga,
 * número cortado). O teste NUNCA grava o golden, só o lê. Golden ausente falha (RED); divergência de 1 byte falha. Mudou o desenho de propósito? Edite o `.txt`
 * e diga na revisão por quê, conferindo o texto novo contra a spec, não só contra o render.
 *
 * PROPRIEDADE. Larguras 20 a 200 × 2 presets × 2 temas × 10 estados de `estados.ts` (os 10 fixos de spec:224; os EXTRAS não entram).
 *
 * MUTAÇÕES PRESCRITAS: task-12-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPainel } from '../src/painel.ts';
import { blocoTopo, colunas, paraTexto } from '../src/painel-texto.ts';
import type { EstadoPainel, OpcoesRender } from '../src/tipos.ts';
import { ESTADOS, EXTRAS, NOMES_ESTADOS } from './painel-fixtures/estados.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PRESETS = ['esquadrao', 'executivo'] as const;
const TEMAS = ['color', 'mono'] as const;
const SGR_G = /\x1b\[[0-9;]*m/g;

const opcoes = (preset: (typeof PRESETS)[number], tema: (typeof TEMAS)[number], largura: number): OpcoesRender => ({ preset, tema, narracao: true, largura });
const texto = (e: EstadoPainel, preset: (typeof PRESETS)[number], tema: (typeof TEMAS)[number], largura: number): string => paraTexto(renderPainel(e, opcoes(preset, tema, largura)), tema);
const semSgr = (s: string): string => s.replace(SGR_G, '');

// ───────────────────────────── goldens ─────────────────────────────

for (const preset of PRESETS) {
  for (const largura of [44, 60, 72, 80]) {
    test(`golden-${preset}-${largura}`, () => {
      const esperado = readFileSync(join(AQUI, 'painel-golden', `${preset}-${largura}.txt`), 'utf8');
      assert.equal(`${texto(ESTADOS['em-voo-7-12'], preset, 'mono', largura)}\n`, esperado);
    });
  }
}

test('golden-vocabulario-do-produto: `integradas` (nunca "pousadas"), sem os itens cortados da spec:189, sem nome de pacote no Executivo', () => {
  const nomesDoPacote = ['GANDALF', 'GIMLI', 'LEGOLAS', 'ELROND'];
  for (const preset of PRESETS) {
    for (const largura of [44, 60, 72, 80]) {
      const t = readFileSync(join(AQUI, 'painel-golden', `${preset}-${largura}.txt`), 'utf8');
      assert.ok(!/pousad/i.test(t), `${preset}-${largura}: "pousadas"`);
      assert.ok(!/\b(RED|GREEN)\b|slots \d|serviço pago|autorizar|afetados|duração do CI/i.test(t), `${preset}-${largura}: item cortado da spec`);
      if (preset === 'executivo') for (const n of nomesDoPacote) assert.ok(!t.includes(n), `executivo-${largura}: nome de pacote ${n}`);
      if (preset === 'esquadrao' && largura >= 60) assert.ok(t.includes('integradas'), `esquadrao-${largura}: sem "integradas"`);
      if (preset === 'executivo') assert.ok(t.includes('integradas'), `executivo-${largura}: sem "integradas"`);
    }
  }
});

test('fixtures-rodadaMedia-igual-nos-dois-campos: a projeção real grava o mesmo valor em plano.rodadaMedia e qualidade.rodadaMedia (painel.ts:504/516)', () => {
  for (const [nome, e] of [...Object.entries(ESTADOS), ...Object.entries(EXTRAS)]) assert.equal(e.plano.rodadaMedia, e.qualidade.rodadaMedia, `fixture ${nome}`);
});

// ───────────────────────────── propriedade ─────────────────────────────

/** Índice onde `bloco` aparece, linha a linha e contíguo, em `linhas`; -1 se não aparece. */
function ondeComeca(linhas: string[], bloco: string[]): number {
  if (bloco.length === 0) return -1;
  for (let i = 0; i + bloco.length <= linhas.length; i++) if (bloco.every((l, k) => linhas[i + k] === l)) return i;
  return -1;
}

test('propriedade-largura: larguras 20-200 × 2 presets × 2 temas × 10 estados: nada passa da largura, color e mono dão o mesmo texto, topo inteiro', () => {
  assert.equal(NOMES_ESTADOS.length, 10, 'os 10 estados fixos de spec:224');
  let renders = 0;
  let comPararOuDepende = 0;
  for (const nome of NOMES_ESTADOS) {
    const e = ESTADOS[nome];
    for (let largura = 20; largura <= 200; largura++) {
      const topo = blocoTopo(e, largura).map((l) => l.map((s) => s.texto).join(''));
      for (const preset of PRESETS) {
        const onde = `${nome} ${preset} ${largura}`;
        const mono = texto(e, preset, 'mono', largura);
        const color = texto(e, preset, 'color', largura);
        renders += 2;
        // color e mono dão o MESMO texto (spec:143): tirar o SGR do color deixa exatamente o mono, e o mono não tem SGR
        assert.equal(semSgr(color), mono, `${onde}: color sem SGR difere do mono`);
        assert.ok(!mono.includes('\x1b'), `${onde}: mono com escape`);
        // nada passa da largura (REQ-PNL-9), em colunas, linha a linha
        const linhas = mono.split('\n');
        for (const l of linhas) assert.ok(colunas(l) <= largura, `${onde}: linha de ${colunas(l)} colunas passa de ${largura}: ${JSON.stringify(l)}`);
        // depende/PAROU: o topo é o `blocoTopo`, contíguo, sem nada do preset no meio
        const i = ondeComeca(linhas, topo);
        assert.ok(i >= 0, `${onde}: o bloco do topo (${topo.length} linhas) não está no texto, inteiro e contíguo`);
        // o PAROU do `mono` está lá (um `mono` sem o PAROU é o defeito que a propriedade existe para pegar)
        if (e.parar !== null) {
          assert.ok(linhas.some((l) => l.startsWith('■ PAROU ')), `${onde}: sem a linha ■ PAROU`);
        }
        // todo comando que cabe (recuo de até 4) vai inteiro numa linha do topo: nunca cortado antes do comando.
        // A partir da 2ª ação o topo tira do comando as palavras que ele repete do 1º (`…:emenda aprovar 3` + `rejeitar 3`): é o que tem de caber inteiro.
        for (const item of e.depende) {
          item.acoes.forEach((a, k) => {
            if (a.comando === null) return;
            const palavras = a.comando.split(' ');
            const primeiro = (item.acoes[0].comando ?? '').split(' ');
            let n = 0;
            while (k > 0 && n < palavras.length - 1 && primeiro[n] === palavras[n]) n++;
            const esperado = palavras.slice(n).join(' ');
            if (colunas(esperado) + 4 <= largura) assert.ok(topo.some((l) => l.includes(esperado)), `${onde}: comando ${JSON.stringify(esperado)} cortado ou ausente no topo`);
          });
        }
        if (e.parar !== null || e.depende.length > 0) comPararOuDepende++;
      }
    }
  }
  assert.equal(renders, 10 * 181 * 2 * 2, 'a propriedade rodou nas 7.240 combinações');
  assert.ok(comPararOuDepende > 0);
});

test('propriedade-largura-comando-do-parou: o comando do PAROU também vai inteiro quando cabe', () => {
  const e = ESTADOS['parou-teto'];
  const comando = e.parar!.acoes[0].comando as string;
  assert.equal(comando, '/gabarito-mestre:liberar T9');
  for (const preset of PRESETS) {
    for (let largura = 20; largura <= 200; largura++) {
      const linhas = texto(e, preset, 'mono', largura).split('\n');
      if (colunas(comando) + 4 <= largura) assert.ok(linhas.some((l) => l.includes(comando)), `${preset} ${largura}: comando do PAROU cortado`);
    }
  }
});

// ───────────────────────────── PAROU idêntico ─────────────────────────────

/** Da linha `■ PAROU` até a linha `… produção: N alterações …` inclusive: o bloco do REQ-PNL-3, tirado do TEXTO (não de `blocoTopo`). */
function blocoParou(linhas: string[]): string[] | null {
  const ini = linhas.findIndex((l) => l.startsWith('■ PAROU '));
  if (ini < 0) return null;
  const fim = linhas.findIndex((l, k) => k > ini && /^\s+.*(continua|continuam|nada continua)/.test(l));
  return fim < 0 ? linhas.slice(ini) : linhas.slice(ini, fim + 1);
}

test('parou-identico-entre-presets: o bloco PAROU (REQ-PNL-3) tem as MESMAS linhas no Esquadrão e no Executivo, em toda largura, nos dois estados que param', () => {
  let comparados = 0;
  for (const nome of ['parou-teto', 'parou-diario'] as const) {
    for (let largura = 20; largura <= 200; largura++) {
      const esq = blocoParou(texto(ESTADOS[nome], 'esquadrao', 'mono', largura).split('\n'));
      const exe = blocoParou(texto(ESTADOS[nome], 'executivo', 'mono', largura).split('\n'));
      assert.ok(esq !== null && exe !== null, `${nome} ${largura}: PAROU ausente`);
      assert.ok(esq.length >= 3, `${nome} ${largura}: bloco PAROU curto demais (${esq.length} linhas)`);
      assert.deepEqual(exe, esq, `${nome} ${largura}: o PAROU difere entre os presets`);
      comparados++;
    }
  }
  assert.equal(comparados, 2 * 181);
  // estado sem PAROU: nenhum dos dois escreve a linha ■ PAROU
  for (const preset of PRESETS) assert.equal(blocoParou(texto(ESTADOS['em-voo-7-12'], preset, 'mono', 80).split('\n')), null, `${preset}: PAROU sem parar`);
});

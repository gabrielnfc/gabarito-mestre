/**
 * Junção T5 × T6 (R18 do ledger): os dois presets mostram os MESMOS números, extraídos campo a campo (não `includes` no texto inteiro).
 * Cada campo sai do texto de cada preset por regex própria; `null` = o preset não mostra o campo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEsquadrao } from '../src/painel-esquadrao.ts';
import { renderExecutivo } from '../src/painel-executivo.ts';
import { fmtPct } from '../src/painel-formato.ts';
import type { EstadoPainel, Linha, OpcoesRender } from '../src/tipos.ts';
import { ESTADOS, EXTRAS } from './painel-fixtures/estados.ts';

const clone = <T>(x: T): T => structuredClone(x);
const TEXTO = (l: Linha): string => l.map((s) => s.texto).join('');
const op = (preset: 'esquadrao' | 'executivo'): OpcoesRender => ({ preset, tema: 'mono', narracao: false, largura: 100 });
const todos: [string, EstadoPainel][] = [...Object.entries(ESTADOS), ...Object.entries(EXTRAS)];
const m = (ls: string[], re: RegExp): RegExpMatchArray | null => {
  for (const l of ls) {
    const r = re.exec(l);
    if (r) return r;
  }
  return null;
};
const g = (r: RegExpMatchArray | null, i = 1): string | null => (r === null ? null : r[i] ?? null);

type Campos = { pct: string | null; feitas: string | null; eta: string | null; rodada: string | null; agentes: Map<string, { tok: string | null; tempo: string | null }> };

function agentes(ls: string[], reLinha: RegExp): Map<string, { tok: string | null; tempo: string | null }> {
  const mp = new Map<string, { tok: string | null; tempo: string | null }>();
  for (const l of ls) {
    if (!reLinha.test(l)) continue;
    const id = /\b(T\d+)\b/.exec(l);
    if (!id) continue;
    const toks = l.trim().split(/\s+/).filter((x) => x !== '·');
    const tempo = /^(\d+m|\d+h\d\d)$/.test(toks[toks.length - 1]) ? toks.pop()! : null;
    const ultimo = toks[toks.length - 1] ?? '';
    mp.set(id[1], { tok: /^\d+(?:\.\d)?[kM]?$/.test(ultimo) && ultimo !== id[1] ? ultimo : null, tempo });
  }
  return mp;
}

const doEsq = (ls: string[]): Campos => ({
  pct: g(m(ls, /^PLANO\s+\S+\s+(\S+)\s+\S+ tasks/)),
  feitas: g(m(ls, /^PLANO\s+\S+\s+\S+\s+([^/\s]+)\/\S+ tasks/)),
  eta: ((r) => (r ? `${r[1]} ±${r[2]}` : null))(m(ls, /ETA (.+?) ±(\d+)m$/)),
  rodada: g(m(ls, /(\d+\.\d) rodada média/)),
  agentes: agentes(ls, /^[├└]─ ● /),
});
const doExe = (ls: string[]): Campos => ({
  pct: g(m(ls, /^Entrega\s+\S+ (\S+)$/)),
  feitas: g(m(ls, /^Tasks\s+(\S+) integradas/)),
  eta: ((r) => (r ? `${r[1]} ±${r[2]}` : null))(m(ls, /^Previsão\s+(?:hoje )?(.+?) \(±(\d+) min/)),
  rodada: g(m(ls, /(\d+\.\d) rodada\/review/)),
  agentes: agentes(ls, /^● /),
});

test('exe-mesmos-numeros-do-esquadrao: pct, feitas, ETA (hora e ±), rodadaMedia e tokens/tempo por agente iguais token a token em cada fixture', () => {
  let comparados = { pct: 0, feitas: 0, eta: 0, rodada: 0, tok: 0, tempo: 0 };
  for (const [nome, e] of todos) {
    const a = doEsq(renderEsquadrao(e, op('esquadrao')).map(TEXTO));
    const b = doExe(renderExecutivo(e, op('executivo')).map(TEXTO));
    const ctx = (c: string): string => `${nome}: ${c}`;
    // pct: os dois escrevem fmtPct(plano.pct)
    assert.equal(a.pct, fmtPct(e.plano.pct), ctx('pct esquadrão'));
    assert.equal(b.pct, fmtPct(e.plano.pct), ctx('pct executivo'));
    comparados.pct++;
    assert.equal(a.feitas, b.feitas, ctx('feitas'));
    if (a.feitas !== null) comparados.feitas++;
    assert.equal(a.eta, b.eta, ctx('ETA'));
    if (a.eta !== null) comparados.eta++;
    // rodadaMedia: o Esquadrão lê plano.rodadaMedia, o Executivo lê qualidade.rodadaMedia (a projeção real grava o mesmo valor nos dois);
    // cada preset escreve toFixed(1) do SEU campo; a igualdade entre presets vale onde o estado os traz iguais (a fixture `zeros` os traz diferentes: 1.4 × 1)
    const rp = e.plano.rodadaMedia;
    const rq = e.qualidade.rodadaMedia;
    const temIntegrada = e.plano.tasks.some((x) => x.estado === 'integrada');
    assert.equal(a.rodada, rp !== null && temIntegrada ? rp.toFixed(1) : null, ctx('rodadaMedia esquadrão (lê plano.rodadaMedia, só com task integrada)'));
    assert.equal(b.rodada, rq !== null ? rq.toFixed(1) : null, ctx('rodadaMedia executivo (lê qualidade.rodadaMedia)'));
    if (rp === rq) {
      if (a.rodada !== null && b.rodada !== null) {
        assert.equal(a.rodada, b.rodada, ctx('rodadaMedia'));
        comparados.rodada++;
      }
    }
    for (const [id, va] of a.agentes) {
      const vb = b.agentes.get(id);
      assert.ok(vb, ctx(`agente de ${id} ausente no executivo`));
      assert.equal(va.tok, vb.tok, ctx(`tokens de ${id}`));
      assert.equal(va.tempo, vb.tempo, ctx(`tempo de ${id}`));
      if (va.tok !== null) comparados.tok++;
      if (va.tempo !== null) comparados.tempo++;
    }
    assert.deepEqual([...a.agentes.keys()].sort(), [...b.agentes.keys()].sort(), ctx('mesmos agentes com task'));
  }
  // o teste não passa de graça: cada campo foi comparado em pelo menos uma fixture
  for (const [c, n] of Object.entries(comparados)) assert.ok(n > 0, `campo ${c} nunca comparado`);
});

test('exe-mesmos-numeros-mortas: o Esquadrão escreve mortasHoje por revisor, o Executivo escreve qualidade.mortas; cada um mostra o número do seu campo', () => {
  // as fixtures trazem mutacoesHoje = mortasHoje; um par distinto prova que cada número vem do seu campo
  const distinta = clone(ESTADOS['em-voo-7-12']);
  distinta.equipe.revisoresAguardando = [{ nome: 'GIMLI', task: 'T10', mutacoesHoje: 7, mortasHoje: 5 }];
  for (const [nome, e] of [...todos, ['mut-7-mortas-5', distinta] as [string, EstadoPainel]]) {
    const esq = renderEsquadrao(e, op('esquadrao')).map(TEXTO);
    const exe = renderExecutivo(e, op('executivo')).map(TEXTO);
    const q = e.qualidade.mortas;
    const rm = g(m(exe, /(\d+) mutações? mortas?/));
    assert.equal(rm, q === null || !Number.isFinite(q) || q < 0 ? null : String(Math.round(q)), `${nome}: executivo`);
    for (const r of e.equipe.revisoresAguardando) {
      const linha = esq.find((l) => l.includes(`aguarda ${r.task}`)) ?? '';
      const k = g(/, (\d+) mortas?$/.exec(linha) ? /, (\d+) mortas?$/.exec(linha) : null);
      const mt = /· (\d+) mutações? do gate hoje/.exec(linha);
      if (r.mutacoesHoje !== null && r.mortasHoje !== null) {
        assert.equal(k, String(Math.round(r.mortasHoje)), `${nome}: mortasHoje de ${r.task}`);
        assert.equal(mt?.[1], String(Math.round(r.mutacoesHoje)), `${nome}: mutacoesHoje de ${r.task}`);
      } else assert.equal(k, null, `${nome}: sem número ⇒ sem sufixo`);
    }
  }
});

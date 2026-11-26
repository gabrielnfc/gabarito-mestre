/**
 * `onboarding.mjs herdar --root <d> [--gravar --planos-legados "<p>[,<p>]" --terminais "A,B" [--dry-run]]` (GM-20, DT16/DT17, REQ-ADO-1..2):
 * o passo de adoção do `gabarito-instalar --atualizar`. "Herdar" = herdar o que o projeto já tinha antes do gabarito.
 *
 * Sem `--gravar` só LÊ (nenhum arquivo muda): devolve `{ oferecer, entreguesSemPlano, planosLegados, statusFora, cardsDesatualizados }`.
 * Com `--gravar` grava SÓ `fluxo.planosLegados` e `fluxo.status.terminais`, pelo escritor do `gravar` (`aplicarConfig`: merge, tmp + rename,
 * diff), com `--dry-run` que só mostra o diff. Falha fechada: config ilegível/ausente, padrão inválido ou nenhuma das 2 flags ⇒ `Falha` e nada gravado.
 * NENHUM card é escrito (D-G46): `cardsDesatualizados` só lista. A importação de tasks com origem (`task.herdada`) é da GM-21, não daqui.
 *
 * A herança das regras da 1.x (GM-14 REQ-ONB-3 a) nunca foi implementada e fica no backlog; se voltar, entra como `herdar --regras`, sem dividir
 * o `--gravar` deste passo (o contrato antigo, `_onboarding/candidatos.json`, caiu). O id `herdar:<n>` e a forma `confirmacao` seguem dormentes.
 */

import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { cardDe, ehColunaFl1, ehFeito, ehTerminal, padraoLegadoValido, planoLegadoDe, planoMdDoCard, terminaisValidos, worktreesDe } from '../dist/projeto.js';
import { idPadraoDe } from '../lib/config.mjs';
import { aplicarConfig, ArquivoInvalido } from './onboarding-config.mjs';
import { projetoDoRepo } from './painel.mjs';

/** Falha com código: o despachante a devolve como `{ok:false, erro, ...}` e rc 1. */
export class Falha extends Error {
  constructor(erro, mensagem) {
    super(mensagem);
    this.erro = erro;
  }
}

/** Candidatos fixos de plano antigo (REQ-ADO-1): o 1º que casa ao menos 1 PBI vira o `padrao` oferecido. */
export const PADROES_CANDIDATOS = ['docs/superpowers/plans/*-{PBI}-*.md', 'docs/plans/*-{PBI}-*.md'];
const ID_PADRAO_DEFAULT = '^[A-Z]+-\\d+$';
const TEXTO_MAX = 1024 * 1024;
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function lerTextoSeguro(caminho) {
  try {
    const st = lstatSync(caminho);
    return st.isFile() && st.size <= TEXTO_MAX ? readFileSync(caminho, 'utf8') : null;
  } catch {
    return null;
  }
}
const ehArquivo = (c) => { try { return lstatSync(c).isFile(); } catch { return false; } };

/** Pasta relativa de config (`cards/`): sem barra inicial, sem `..`; devolve sem barra final ou `null`. */
function relativoSeguro(c) {
  if (typeof c !== 'string' || c === '' || c.length > 300 || isAbsolute(c) || c.includes('\0')) return null;
  const limpo = c.replace(/\/+$/, '');
  return limpo === '' || limpo.split('/').includes('..') ? null : limpo;
}

/** `harness.config.json` da raiz: ausente ⇒ `{}` (nada a herdar); ilegível ⇒ `Falha('config_invalida')`. */
function lerConfig(raiz) {
  const caminho = join(raiz, 'harness.config.json');
  let texto;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { cfg: {}, ausente: true };
    throw new Falha('config_invalida', `harness.config.json ilegível (${String(e.message).split('\n')[0]})`);
  }
  if (texto.trim() === '') return { cfg: {}, ausente: false };
  try {
    const cfg = JSON.parse(texto);
    if (!ehObjeto(cfg)) throw new Error('não é um objeto JSON');
    return { cfg, ausente: false };
  } catch (e) {
    throw new Falha('config_invalida', `harness.config.json ilegível (${String(e.message).split('\n')[0]})`);
  }
}

/** `git worktree list --porcelain` pelo `rodar` injetado; falha ⇒ `{ ok:false }` (o núcleo cai na raiz). */
function listaDeWorktrees(raiz, rodar) {
  try {
    const r = rodar('git', ['worktree', 'list', '--porcelain'], { cwd: raiz, timeoutMs: 10000 });
    return r && !r.motivo && r.rc === 0 ? { ok: true, saida: r.stdout } : { ok: false, motivo: r?.motivo ?? 'erro' };
  } catch {
    return { ok: false, motivo: 'erro' };
  }
}

/** Todas as worktrees (a da raiz primeiro); falha do git ⇒ só a raiz. */
function arvoresDe(raiz, rodar) {
  const real = (c) => { try { return realpathSync(c); } catch { return c; } };
  return [...new Set(worktreesDe(listaDeWorktrees(raiz, rodar), real(raiz)).caminhos.map(real))];
}

/** REQ-ADO-1: só lê. */
function detectar(raiz, cfg, rodar) {
  const fl1 = relativoSeguro(cfg?.fluxo?.mapeamento?.FL1);
  const statusFl1 = cfg?.fluxo?.status?.FL1;
  const terminais = cfg?.fluxo?.status?.terminais;
  let idRe;
  try { idRe = new RegExp(typeof cfg?.fluxo?.idPadrao === 'string' ? cfg.fluxo.idPadrao : ID_PADRAO_DEFAULT); } catch { idRe = new RegExp(ID_PADRAO_DEFAULT); }
  const arvores = fl1 === null ? [] : arvoresDe(raiz, rodar);
  // um card por id: o de `atualizadoEm` mais novo, empate ⇒ o da árvore que vem antes (a atual), como o painel
  const porId = new Map();
  for (const a of arvores) {
    let nomes = [];
    try { nomes = readdirSync(join(a, fl1)).filter((n) => n.endsWith('.md')).sort(); } catch { /* sem a pasta nesta árvore */ }
    for (const n of nomes) {
      const texto = lerTextoSeguro(join(a, fl1, n));
      const c = texto === null ? null : cardDe(n, texto, idRe);
      if (c === null) continue;
      const atual = porId.get(c.id);
      if (atual === undefined || (c.atualizadoEm ?? '') > (atual.atualizadoEm ?? '')) porId.set(c.id, { ...c, texto });
    }
  }
  const cards = [...porId.values()].sort((x, y) => x.id.localeCompare(y.id, 'en', { numeric: true }));
  const temPlanoJson = (id) => arvores.some((a) => ehArquivo(join(a, '.harness', 'entregas', id, 'plano.json')));

  const entreguesSemPlano = cards.filter((c) => ehFeito(c.status, statusFl1) && !temPlanoJson(c.id)).map((c) => c.id);

  // planos antigos: só PBI sem ponteiro no card e sem plano.json (o ponteiro e o plano.json valem mais que o padrão)
  const semPonteiro = cards.filter((c) => planoMdDoCard(c.texto) === null && !temPlanoJson(c.id));
  const jaConfigurado = cfg?.fluxo?.planosLegados !== undefined;
  const nomesDe = new Map();
  const nomesDaPasta = (dir) => {
    if (!nomesDe.has(dir)) {
      const lista = new Set();
      for (const a of arvores) { try { for (const n of readdirSync(join(a, dir))) lista.add(n); } catch { /* sem a pasta */ } }
      nomesDe.set(dir, [...lista].sort());
    }
    return nomesDe.get(dir);
  };
  let planosLegados = { padrao: null, casados: 0, sem: semPonteiro.length, ambiguos: 0 };
  if (!jaConfigurado) {
    for (const padrao of PADROES_CANDIDATOS) {
      const v = padraoLegadoValido(padrao);
      const achados = semPonteiro.map((c) => (planoLegadoDe(nomesDaPasta(v.dir), padrao, c.id) ?? []).length);
      if (achados.some((n) => n > 0)) {
        planosLegados = { padrao, casados: achados.filter((n) => n === 1).length, sem: achados.filter((n) => n === 0).length, ambiguos: achados.filter((n) => n > 1).length };
        break;
      }
    }
  }

  const contagem = new Map();
  for (const c of cards) {
    const s = (c.status ?? '').trim();
    if (s === '' || ehColunaFl1(s, statusFl1) || ehTerminal(s, terminaisValidos(terminais) === null ? undefined : terminais)) continue;
    contagem.set(s, (contagem.get(s) ?? 0) + 1);
  }
  const statusFora = [...contagem].map(([status, n]) => ({ status, n })).sort((x, y) => y.n - x.n || x.status.localeCompare(y.status));

  // REQ-CRD-1 (P9): a lista é a do painel (mesma projeção: ordem dos eventos, terminal, opção, status), nunca remontada aqui; sem FL1 não há card
  const cardsDesatualizados = fl1 === null
    ? []
    : projetoDoRepo({ atual: raiz, cfg, idPadrao: idPadraoDe(raiz), agoraMs: Date.now(), fuso: 'UTC', deps: { worktreeList: () => listaDeWorktrees(raiz, rodar) } })
      .linhas.filter((l) => l.cardDesatualizado !== null && l.cardDesatualizado !== undefined).map((l) => ({ id: l.id, status: l.cardDesatualizado }));

  const oferecer = entreguesSemPlano.length > 0 || planosLegados.padrao !== null || statusFora.length > 0 || cardsDesatualizados.length > 0;
  return { oferecer, entreguesSemPlano, planosLegados, statusFora, cardsDesatualizados };
}

const lista = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter((s) => s !== '') : []);

/**
 * REQ-ADO-2: grava só as 2 chaves. `planosLegados`/`terminais` vêm como o texto da flag (ou ausentes); nenhuma das duas ⇒ `argumento_invalido`.
 * Valida tudo ANTES de escrever. Não toca card nem outro arquivo.
 */
function gravarChaves(raiz, { planosLegados, terminais, dryRun }) {
  const padroes = planosLegados === undefined ? undefined : lista(planosLegados);
  const termos = terminais === undefined ? undefined : lista(terminais);
  if (padroes === undefined && termos === undefined) throw new Falha('argumento_invalido', 'herdar --gravar precisa de --planos-legados "<padrão>" e/ou --terminais "A,B"; nada foi gravado');
  if (padroes !== undefined) {
    if (padroes.length === 0) throw new Falha('argumento_invalido', '--planos-legados vazio; nada foi gravado');
    const ruim = padroes.find((p) => padraoLegadoValido(p) === null);
    if (ruim !== undefined) throw new Falha('argumento_invalido', `--planos-legados: padrão inválido ${JSON.stringify(ruim.slice(0, 80))} (pasta literal + nome com {PBI} e *); nada foi gravado`);
  }
  if (termos !== undefined && (termos.length === 0 || terminaisValidos(termos) === null)) throw new Falha('argumento_invalido', '--terminais vazio ou inválido; nada foi gravado');
  const { ausente } = lerConfig(raiz);
  if (ausente) throw new Falha('config_invalida', 'harness.config.json não existe; rode o onboarding antes (nada foi gravado)');
  const fluxo = {};
  if (padroes !== undefined) fluxo.planosLegados = padroes;
  if (termos !== undefined) fluxo.status = { terminais: termos };
  let r;
  try {
    r = aplicarConfig(raiz, { secoes: { fluxo } }, { dryRun });
  } catch (e) {
    if (e instanceof ArquivoInvalido) throw new Falha('config_invalida', e.message);
    throw new Falha('falha', String(e?.message ?? e).split('\n')[0]);
  }
  return { gravado: !dryRun && r.diff.length > 0, diff: r.diff, ...(dryRun ? { dryRun: true } : {}) };
}

/**
 * `herdar(raiz, { rodar, gravar, planosLegados, terminais, dryRun })`. Sem `gravar` só lê (detecção); com `gravar`, grava as 2 chaves (e devolve
 * também a detecção de depois, para a skill mostrar o que ainda sobra).
 */
export function herdar(raiz, { rodar, gravar = false, planosLegados, terminais, dryRun = false } = {}) {
  const gravacao = gravar ? gravarChaves(raiz, { planosLegados, terminais, dryRun }) : {};
  return { ...gravacao, ...detectar(raiz, lerConfig(raiz).cfg, rodar) };
}

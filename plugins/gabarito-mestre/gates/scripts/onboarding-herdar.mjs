/**
 * `onboarding.mjs herdar --root <d> [--gravar --planos-legados "<p>[,<p>]" --terminais "A,B" [--dry-run]]` (GM-20, DT16/DT17, REQ-ADO-1..2):
 * o passo de adoção do `gabarito-instalar --atualizar`. "Herdar" = herdar o que o projeto já tinha antes do gabarito.
 *
 * Sem `--gravar` só LÊ (nenhum arquivo muda): devolve `{ oferecer, entreguesSemPlano, planosLegados, statusFora, cardsDesatualizados }`.
 * Com `--gravar` grava SÓ `fluxo.planosLegados` e `fluxo.status.terminais`, pelo escritor do `gravar` (`aplicarConfig`: merge, tmp + rename,
 * diff), com `--dry-run` que só mostra o diff. Falha fechada: config ilegível/ausente, padrão inválido ou nenhuma das 2 flags ⇒ `Falha` e nada gravado.
 * NENHUM card é escrito (D-G46): `cardsDesatualizados` só lista.
 *
 * `onboarding.mjs herdar --tasks --entrega <ID> --arquivo <lista.json> [--gravar [--dry-run]]` (GM-21 T6, REQ-HER-2, DT8/DT9): importa tasks de uma entrega
 * anterior ao gabarito, cada uma com a ORIGEM conferida (`commit:<sha>` ancestral de HEAD, `pr:<n>` MERGED pelo gh, `ledger:<arquivo>:<linha>` versionado
 * e com a linha), como `task.herdada` em `events.herdar.jsonl` (sessão `herdar`). Sem `--gravar` só lê. Tudo ou nada: 1 recusada e nada é gravado.
 * Task do `plano.json` da entrega é recusada (o loop mede); task já herdada é pulada (`ja_herdada`). Não toca plano, config nem card.
 *
 * A herança das regras da 1.x (GM-14 REQ-ONB-3 a) nunca foi implementada e fica no backlog; se voltar, entra como `herdar --regras`, sem dividir
 * o `--gravar` deste passo (o contrato antigo, `_onboarding/candidatos.json`, caiu). O id `herdar:<n>` e a forma `confirmacao` seguem dormentes.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { cardDe, ehColunaFl1, ehFeito, ehTerminal, padraoLegadoValido, planoLegadoDe, planoMdDoCard, primeiroTermo, TERMINAIS_PADRAO, terminaisValidos, worktreesDe } from '../dist/projeto.js';
import { append as anexarAoDiario, dirEntrega, lerEstrito } from '../dist/diario.js';
import { formaInvalida } from '../dist/formas.js';
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
  const idPadrao = idPadraoDe(raiz); // UMA vez: a mesma normalização do painel vale na detecção toda
  const idRe = new RegExp(idPadrao);
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
    : projetoDoRepo({ atual: raiz, cfg, idPadrao, agoraMs: Date.now(), fuso: 'UTC', deps: { worktreeList: () => listaDeWorktrees(raiz, rodar) } })
      .linhas.filter((l) => l.cardDesatualizado !== null && l.cardDesatualizado !== undefined).map((l) => ({ id: l.id, status: l.cardDesatualizado }));

  const oferecer = entreguesSemPlano.length > 0 || planosLegados.padrao !== null || statusFora.length > 0 || cardsDesatualizados.length > 0;
  return { oferecer, entreguesSemPlano, planosLegados, statusFora, cardsDesatualizados };
}

const lista = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter((s) => s !== '') : []);

/**
 * GM-20 review final r1 MAJOR-2: aceitar a oferta ACRESCENTA ao conjunto vigente (a config válida, ou o padrão: DT5 faz a config substituir o padrão, então
 * gravar só o escolhido reabriria Superado/Cancelado). Cada escolhido vira o 1º termo (`primeiroTermo`, o que `ehTerminal` casa: o `statusFora` traz o
 * texto inteiro do card); o que já é terminal não repete.
 */
function somarTerminais(vigente, escolhidos) {
  const out = [...(terminaisValidos(vigente) ?? TERMINAIS_PADRAO)];
  for (const t of escolhidos) {
    const termo = primeiroTermo(t);
    if (termo !== '' && !ehTerminal(termo, out)) out.push(termo);
  }
  return out;
}

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
  if (termos !== undefined && (termos.length === 0 || terminaisValidos(termos) === null || termos.some((t) => primeiroTermo(t) === ''))) throw new Falha('argumento_invalido', '--terminais vazio ou inválido; nada foi gravado');
  const { ausente, cfg } = lerConfig(raiz);
  if (ausente) throw new Falha('config_invalida', 'harness.config.json não existe; rode o onboarding antes (nada foi gravado)');
  const fluxo = {};
  if (padroes !== undefined) fluxo.planosLegados = padroes;
  if (termos !== undefined) fluxo.status = { terminais: somarTerminais(cfg?.fluxo?.status?.terminais, termos) };
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

// ────────────────────────────────────────────────────────────── herdar --tasks (GM-21 T6)

const ENTREGA_RE = /^[A-Z]+-\d+$/;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const SHA_ENTRADA_RE = /^[0-9a-f]{7,40}$/;
const PR_RE = /^[1-9]\d{0,9}$/;
const LISTA_MAX = 500;

const saiu = (r) => !r || r.motivo || r.rc !== 0;

/** `commit:<sha>`: o commit existe e é ancestral de HEAD (`merge-base --is-ancestor`). Devolve `{ ref }` com o sha por extenso, ou `{ motivo }`. */
function conferirCommit(raiz, sha, rodar) {
  if (!SHA_ENTRADA_RE.test(sha)) return { motivo: 'commit: sha inválido (7 a 40 hex minúsculos)' };
  const cheio = rodar('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd: raiz, timeoutMs: 10000 });
  const ref = saiu(cheio) ? '' : cheio.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(ref)) return { motivo: 'commit: não existe neste repositório' };
  const anc = rodar('git', ['merge-base', '--is-ancestor', ref, 'HEAD'], { cwd: raiz, timeoutMs: 10000 });
  if (anc?.motivo) return { motivo: `commit: não consegui conferir o histórico (${anc.motivo})` };
  return anc?.rc === 0 ? { ref } : { motivo: 'commit: não é ancestral de HEAD (fora do histórico desta branch)' };
}

/** `pr:<n>`: `gh pr view <n>` diz MERGED. Sem gh, falha ou outro estado ⇒ recusa. */
function conferirPr(raiz, n, rodar) {
  if (!PR_RE.test(n)) return { motivo: 'pr: número inválido (inteiro ≥ 1)' };
  const r = rodar('gh', ['pr', 'view', n, '--json', 'state'], { cwd: raiz, timeoutMs: 20000 });
  if (r?.motivo === 'ausente') return { motivo: 'pr: gh ausente, não consigo conferir que o PR foi mergeado' };
  if (saiu(r)) return { motivo: `pr: gh não leu o PR #${n}` };
  let estado;
  try { estado = JSON.parse(r.stdout)?.state; } catch { return { motivo: `pr: resposta do gh ilegível para #${n}` }; }
  return estado === 'MERGED' ? { ref: n } : { motivo: `pr: #${n} não está MERGED (${typeof estado === 'string' ? estado : 'estado desconhecido'})` };
}

/** `ledger:<arquivo>:<linha>`: arquivo versionado dentro da raiz (arquivo comum, sem symlink) e a linha existe. */
function conferirLedger(raiz, resto, rodar) {
  const i = resto.lastIndexOf(':');
  const arquivo = i < 0 ? '' : resto.slice(0, i);
  const linhaTxt = i < 0 ? '' : resto.slice(i + 1);
  if (!/^[1-9]\d{0,9}$/.test(linhaTxt)) return { motivo: 'ledger: esperado ledger:<arquivo>:<linha ≥ 1>' };
  const rel = relativoSeguro(arquivo);
  if (rel === null || rel !== arquivo || arquivo.includes('\n')) return { motivo: 'ledger: arquivo fora da raiz do repositório (caminho relativo, sem ..)' };
  const v = rodar('git', ['ls-files', '--error-unmatch', '--', arquivo], { cwd: raiz, timeoutMs: 10000 });
  if (saiu(v)) return { motivo: 'ledger: arquivo não versionado (git ls-files não o conhece)' };
  const texto = lerTextoSeguro(join(raiz, arquivo));
  if (texto === null) return { motivo: 'ledger: arquivo ilegível ou grande demais (não é arquivo comum até 1 MB)' };
  const linhas = texto.split('\n');
  if (linhas[linhas.length - 1] === '') linhas.pop();
  return Number(linhaTxt) <= linhas.length ? { ref: `${arquivo}:${linhaTxt}` } : { motivo: `ledger: linha ${linhaTxt} além do fim (o arquivo tem ${linhas.length})` };
}

/** A origem como texto (`commit:`, `pr:`, `ledger:`) ⇒ `{ tipo, ref }` conferido, ou `{ motivo }`. */
function conferirOrigem(raiz, origem, rodar) {
  if (typeof origem !== 'string') return { motivo: 'origem: esperado texto commit:<sha>, pr:<n> ou ledger:<arquivo>:<linha>' };
  const i = origem.indexOf(':');
  const tipo = i < 0 ? '' : origem.slice(0, i);
  const resto = i < 0 ? '' : origem.slice(i + 1);
  const r = tipo === 'commit' ? conferirCommit(raiz, resto, rodar) : tipo === 'pr' ? conferirPr(raiz, resto, rodar) : tipo === 'ledger' ? conferirLedger(raiz, resto, rodar)
    : { motivo: 'origem: tipo desconhecido (esperado commit:, pr: ou ledger:)' };
  return r.motivo === undefined ? { tipo, ref: r.ref } : { motivo: r.motivo };
}

/** Ids das tasks do `plano.json` da entrega; ausente ⇒ vazio; ilegível ⇒ `Falha` (não se herda sobre plano que não se lê). */
function tasksDoPlano(dir) {
  const arq = join(dir, 'plano.json');
  if (!existsSync(arq)) return new Set();
  try {
    const p = JSON.parse(readFileSync(arq, 'utf8'));
    if (!Array.isArray(p?.tasks)) throw new Error('sem lista tasks');
    return new Set(p.tasks.map((t) => t?.id).filter((id) => typeof id === 'string'));
  } catch (e) {
    throw new Falha('plano_invalido', `plano.json da entrega ilegível (${String(e.message).split('\n')[0]}); nada foi gravado`);
  }
}

/** A lista do `--arquivo`: array de `{task, origem, titulo?}`, sem chave a mais. Tudo fora disso é `argumento_invalido`. */
function lerLista(arquivo) {
  if (typeof arquivo !== 'string' || arquivo === '') throw new Falha('argumento_invalido', 'herdar --tasks precisa de --arquivo <lista.json>');
  let itens;
  try { itens = JSON.parse(readFileSync(arquivo, 'utf8')); } catch (e) { throw new Falha('argumento_invalido', `--arquivo ilegível (${String(e.message).split('\n')[0]})`); }
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > LISTA_MAX) throw new Falha('argumento_invalido', `--arquivo: esperada lista de 1 a ${LISTA_MAX} itens {task, origem}`);
  for (const [n, it] of itens.entries()) {
    if (!ehObjeto(it) || Object.keys(it).some((k) => !['task', 'origem', 'titulo'].includes(k)) || typeof it.task !== 'string' || (it.titulo !== undefined && typeof it.titulo !== 'string')) {
      throw new Falha('argumento_invalido', `--arquivo: item ${n + 1} fora da forma {task, origem, titulo?}`);
    }
  }
  return itens;
}

/**
 * `herdarTasks(raiz, { rodar, entrega, arquivo, gravar, dryRun, agora })` ⇒ `{ ok, tasks:[{task, origem, estado, motivo?}], gravado, gravadas, recusadas, dryRun? }`.
 * `estado`: `ok` (origem conferida), `ja_herdada` (já há `task.herdada` dela no diário da entrega: pulada, sem reconferir), `recusada` (com `motivo`).
 * `ok:false` só quando há recusada E `gravar` (nada é gravado); sem `gravar` a leitura mostra tudo e `ok` segue true.
 */
export function herdarTasks(raiz, { rodar, entrega, arquivo, gravar = false, dryRun = false, agora = () => new Date() } = {}) {
  if (typeof entrega !== 'string' || !ENTREGA_RE.test(entrega)) throw new Falha('argumento_invalido', 'herdar --tasks precisa de --entrega <ID> (ex. PBI-7)');
  const itens = lerLista(arquivo);
  const dir = dirEntrega(raiz, entrega);
  const noPlano = tasksDoPlano(dir);
  let jaHerdadas = new Set();
  if (existsSync(dir)) {
    const l = lerEstrito(dir);
    if (!l.ok) throw new Falha('diario_invalido', `diário da entrega ilegível (${l.motivo}); nada foi gravado`);
    jaHerdadas = new Set(l.eventos.filter((e) => e.tipo === 'task.herdada' && typeof e.dados?.task === 'string').map((e) => e.dados.task));
  }
  const vistas = new Set();
  const tasks = itens.map((it) => {
    const base = { task: it.task, origem: it.origem };
    if (!TASK_ID_RE.test(it.task)) return { ...base, estado: 'recusada', motivo: 'task: id fora da forma (ex. T3)' };
    if (vistas.has(it.task)) return { ...base, estado: 'recusada', motivo: 'task: repetida na lista' };
    vistas.add(it.task);
    if (noPlano.has(it.task)) return { ...base, estado: 'recusada', motivo: 'task: está no plano.json da entrega (o loop mede, não se herda)' };
    if (jaHerdadas.has(it.task)) return { ...base, estado: 'ja_herdada' };
    const o = conferirOrigem(raiz, it.origem, rodar);
    if (o.motivo !== undefined) return { ...base, estado: 'recusada', motivo: o.motivo };
    const _dados = { task: it.task, origem: { tipo: o.tipo, ref: o.ref }, ...(it.titulo === undefined ? {} : { titulo: it.titulo }) };
    const forma = formaInvalida('task.herdada', _dados);
    return forma === null ? { ...base, estado: 'ok', _dados } : { ...base, estado: 'recusada', motivo: `titulo: fora da forma do diário (${forma})` };
  });
  const recusadas = tasks.filter((t) => t.estado === 'recusada').length;
  const novas = tasks.filter((t) => t.estado === 'ok');
  let gravadas = 0;
  if (gravar && !dryRun && recusadas === 0) {
    let autor = 'desconhecido';
    try { const r = rodar('git', ['config', 'user.email'], { cwd: raiz, timeoutMs: 10000 }); if (!saiu(r) && r.stdout.trim() !== '') autor = r.stdout.trim(); } catch { /* o diário aceita "desconhecido" */ }
    for (const t of novas) {
      const r = anexarAoDiario(dir, 'herdar', { ts: agora().toISOString(), autor, sessao: 'herdar', agente: 'orquestrador', tipo: 'task.herdada', dados: t._dados });
      if (!r.ok || r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `task ${t.task} não gravada (${r.ok ? 'recusada pelo diário' : r.erro}); ${gravadas} já gravada(s) antes dela`);
      gravadas += 1;
    }
  }
  return {
    ok: !(gravar && recusadas > 0), tasks: tasks.map(({ _dados, ...resto }) => resto), gravado: gravadas > 0, gravadas, recusadas, ...(dryRun ? { dryRun: true } : {}),
  };
}

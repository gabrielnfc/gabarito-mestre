#!/usr/bin/env node
/**
 * REQ-ENT-1 e REQ-ENT-2 pela borda: `entrega.mjs` decide e executa a entrega da PBI pela política declarada em `origin/HEAD`.
 *
 *   entrega.mjs decidir  [--entrega GM-10] [--sessao <id>]   a decisão (`subir|agendar|release_pr|esperar|entregue|parar`); só `agendar` grava
 *   entrega.mjs executar [--entrega GM-10] [--sessao <id>]   só roda com a decisão `subir`: deploy, smoke e, se falhar, rollback
 *   entrega.mjs devolver --motivo <texto> [--entrega GM-10] [--sessao <id>]   grava `entrega.devolvida {motivo}` (o dono pediu para devolver), só com a decisão `subir`; nunca roda comando
 *
 * CONTRATO DE FALHA. Saída é UMA linha de JSON em stdout, sempre com `ok`; falha traz `erro` (código) e `mensagem`. rc 0 só com o efeito feito
 * (`entrega.fim {ok:true}` gravado nesta execução, ou decisão `entregue` sem gravar nada); decisão que não é `subir` nem `entregue` ⇒ `nao_subiu`,
 * rc 1, nada gravado; falha de etapa ⇒ `etapa_falhou`, rc 1, com `etapas`; uso errado rc 2. `systemMessage` é campo da linha JSON (a skill repassa).
 * Dado ausente, corrompido ou ferramenta falhando nunca vira sucesso; ausente e corrompido são casos distintos.
 *
 * PRÉ-CONDIÇÕES de `executar`, na ordem, sem efeito até a decisão: uso · lock `<dirEntrega>/entrega.lock` (`wx`; órfão NÃO é quebrado: o estado de
 * produção é desconhecido) · `.harness/PAUSAR` · plano e diário legíveis · entrega completa (`proximaAcao` = `concluir` e nenhuma proposta de emenda
 * aberta, pelo núcleo) · política efetiva (o plano só aperta) · checkout principal sem mudança rastreada · decisão `subir`. `decidir` repete as de `PAUSAR` a política,
 * sem lock e sem conferir o checkout.
 *
 * EXECUÇÃO. `producao.acesso` ANTES de `entrega.inicio` (falha de append antes do deploy aborta sem rodar nada e sem `inicio` órfão); depois do
 * `inicio` nenhuma falha de append interrompe deploy, smoke nem rollback: entra em `avisos` e o rc é 1. Cada etapa é um processo com o grupo dele
 * (`detached`): o fim é o `exit` do líder, e no prazo ou ao sair o líder o GRUPO inteiro morre com SIGKILL (spawnSync com `timeout` não mata neto
 * nem quem ignora SIGTERM). `comando` e `saida` só no stdout (a `saida`, últimos 2.000 caracteres, redigida por linha pelo canário do diário);
 * o diário nunca os recebe.
 *
 * ÂNCORA (REQ-ENT-2, emenda da Sombra). Cadeia de hash sem âncora externa não detecta truncamento no FIM: apagar `producao.acesso, entrega.inicio`
 * (ou repor um prefixo do diário) faria a decisão voltar a `subir` e o deploy rodar de novo sobre produção em estado desconhecido. Por isso,
 * depois do `append` de `entrega.inicio` e ANTES do deploy, `executar` grava `<dirEntrega>/entrega.ancora` = `{sessao, seq, hash}` (hash = sha256 da
 * linha do `inicio`; tmp `entrega.ancora.tmp` + rename, sobrescreve a anterior; fora do diário, não versionada). Falhou ⇒ o deploy NÃO roda
 * (`ancora_nao_gravada`, rc 1; o `inicio` fica sem `fim` e a próxima decisão é `parar`). `executar` e `decidir` conferem a âncora logo depois de
 * ler o diário: ela existe e a linha não está lá (ou o hash difere), ou ela não é arquivo regular com essa forma ⇒ `diario_ilegivel`. Ausente é ok
 * (entrega que nunca subiu). LIMITE DECLARADO: apagar a âncora JUNTO com a cauda não é detectado; isso pede escrita deliberada em `.harness/`
 * (o anel de integridade cobre o agente; humano e `git clean` ficam como limite).
 *
 * Relógio: `agoraMs` só entra por `opts`; o CLI usa `Date.now()` uma vez, no início. Tudo que toca git vai por `execFileSync` com argv, sem shell.
 */
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync, constants } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ehEntrypoint } from '../lib/cli.mjs';
import { lerConfigOrigin } from '../lib/config.mjs';
import * as diario from '../dist/diario.js';
import { decidirEntrega, lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { ordenar, proximaAcao } from '../dist/loop.js';
import { validarPlano } from '../dist/plano.js';

const ENTREGA_RE = /^[A-Z]+-\d+$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ANEL_MAX = 2000;
const GRACA_MS = 500;
const GIT_REDIRECIONA = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'];
const SINAIS_NEUTROS = { slots: 1, percent: null, x: 50, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false };
const USO = 'uso: entrega.mjs decidir|executar [--entrega GM-10] [--sessao <id>] | devolver --motivo <texto> [--entrega GM-10] [--sessao <id>]';
const MOTIVO_MAX = 200; // code points, a mesma régua de `formas.ts` (`entrega.devolvida`)

/** Falha com código: vira `{ok:false, erro, mensagem, ...extra}` e rc 1 (ou 2 para uso). */
class Falha extends Error {
  constructor(erro, mensagem, extra = {}) {
    super(mensagem);
    this.erro = erro;
    this.extra = extra;
  }
}

/** rc do CLI para uma saída: 0 só com `ok`; uso errado 2; o resto 1. */
export function rcDe(saida) {
  if (saida?.ok === true) return 0;
  return saida?.erro === 'uso' ? 2 : 1;
}

const aSaida = (e) => (e instanceof Falha
  ? { ok: false, erro: e.erro, mensagem: e.message, ...e.extra }
  : { ok: false, erro: 'excecao', mensagem: e instanceof Error ? e.message : String(e) });

// ─────────────────────────────────────────────────────────────── git e contexto

function git(cwd, ...args) {
  const env = { ...process.env };
  for (const k of GIT_REDIRECIONA) delete env[k];
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    const texto = String(e.stderr ?? '').trim() || String(e.stdout ?? '').trim() || e.message;
    throw new Error(texto.split('\n').filter(Boolean).slice(-3).join(' / '));
  }
}

/** Raiz da worktree PRINCIPAL, de qualquer worktree do repositório (`--git-common-dir`). */
function raizPrincipal(cwd) {
  let comum;
  try {
    comum = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  } catch (e) {
    throw new Falha('fora_de_repo', `não é um repositório git (${e.message})`);
  }
  const real = realpathSync(comum);
  if (basename(real) !== '.git') throw new Falha('repo_nao_suportado', `git-common-dir inesperado (${real}): só repositório com worktree principal em <raiz>/.git`);
  return dirname(real);
}

function validarForma(flags) {
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('entrega_invalida', `--entrega "${flags.entrega}" fora da forma ${ENTREGA_RE}`);
  if (flags.sessao !== undefined && !SESSAO_RE.test(flags.sessao)) throw new Falha('argumento_invalido', `--sessao fora da forma ${SESSAO_RE}`);
}

function contexto(cwd, flags) {
  const raiz = raizPrincipal(cwd);
  let entrega = flags.entrega;
  if (entrega === undefined) {
    let branch = '';
    try { branch = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'); } catch { /* sem branch */ }
    entrega = /[A-Z]+-\d+/.exec(branch)?.[0];
    if (entrega === undefined || !ENTREGA_RE.test(entrega)) throw new Falha('entrega_nao_inferida', `não achei a entrega na branch "${branch}"; passe --entrega <ID>`);
  }
  return { cwd, raiz, entrega, dirEntrega: diario.dirEntrega(raiz, entrega), sessao: flags.sessao ?? 'loop' };
}

function carregarPlano(c) {
  const arq = join(c.dirEntrega, 'plano.json');
  const rel = relative(c.raiz, arq);
  let texto;
  try {
    texto = readFileSync(arq, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Falha('plano_ausente', `${rel} não existe: sem plano.json não há entrega a decidir`);
    throw new Falha('plano_invalido', `${rel} ilegível (${e.code ?? e.message})`);
  }
  let bruto;
  try { bruto = JSON.parse(texto); } catch (e) { throw new Falha('plano_invalido', `${rel} não é JSON (${String(e.message).split('\n')[0]})`); }
  const v = validarPlano(bruto);
  if (!v.ok) throw new Falha('plano_invalido', `${rel}: ${v.erro}`);
  if (v.plano.entrega !== c.entrega) throw new Falha('plano_invalido', `${rel}: entrega "${v.plano.entrega}" difere da pasta "${c.entrega}"`);
  return v.plano;
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

/**
 * Leitura estrita: `diario.ler` descarta linha corrompida em silêncio, o que aqui viraria deploy sobre dado perdido. Pasta ausente é `[]`;
 * linha que não é objeto JSON, cadeia de hash quebrada e arquivo que não é regular ⇒ `diario_ilegivel`.
 */
function lerDiarioEstrito(dir, linhasPorArquivo = new Map()) {
  let nomes;
  try {
    nomes = readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Falha('diario_ilegivel', `diário ilegível (${e.code ?? e.message})`);
  }
  const eventos = [];
  for (const nome of nomes.filter((n) => /^events\..+\.jsonl$/.test(n)).sort()) {
    const p = join(dir, nome);
    let texto;
    try {
      if (!lstatSync(p).isFile()) throw new Error('não é arquivo regular');
      texto = readFileSync(p, 'utf8');
    } catch (e) {
      throw new Falha('diario_ilegivel', `${nome}: ${e.message}`);
    }
    let anterior = null;
    const doArquivo = [];
    linhasPorArquivo.set(nome, doArquivo);
    for (const [i, linha] of texto.split('\n').entries()) {
      if (linha === '') continue;
      let o;
      try { o = JSON.parse(linha); } catch { throw new Falha('diario_ilegivel', `${nome}, linha ${i + 1}: não é JSON`); }
      if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new Falha('diario_ilegivel', `${nome}, linha ${i + 1}: não é um objeto`);
      if (o.hash_anterior !== (anterior === null ? null : sha(anterior))) throw new Falha('diario_ilegivel', `${nome}, linha ${i + 1}: cadeia de hash quebrada`);
      anterior = linha;
      doArquivo.push(linha);
      eventos.push(o);
    }
  }
  return eventos;
}

// ─────────────────────────────────────────────────────────────── âncora do `entrega.inicio`

const ANCORA = 'entrega.ancora';
const ANCORA_TMP = 'entrega.ancora.tmp';
const SEM_ANCORA = (detalhe) => new Falha('diario_ilegivel', detalhe);

/** A âncora, se existir, tem que apontar para uma linha que está no diário (`linhasPorArquivo` vem de `lerDiarioEstrito`). Ausente é ok. */
function conferirAncora(c, linhasPorArquivo) {
  const arq = join(c.dirEntrega, ANCORA);
  let texto;
  try {
    if (!lstatSync(arq).isFile()) throw SEM_ANCORA(`${ANCORA} não é arquivo regular`);
    texto = readFileSync(arq, 'utf8');
  } catch (e) {
    if (e instanceof Falha) throw e;
    if (e.code === 'ENOENT') return;
    throw SEM_ANCORA(`${ANCORA} ilegível (${e.code ?? e.message})`);
  }
  let a;
  try { a = JSON.parse(texto); } catch { throw SEM_ANCORA(`${ANCORA} não é JSON`); }
  const forma = a !== null && typeof a === 'object' && !Array.isArray(a)
    && typeof a.sessao === 'string' && SESSAO_RE.test(a.sessao)
    && Number.isSafeInteger(a.seq) && a.seq >= 1
    && typeof a.hash === 'string' && /^[0-9a-f]{64}$/.test(a.hash);
  if (!forma) throw SEM_ANCORA(`${ANCORA} fora da forma {sessao, seq, hash}`);
  const achou = (linhasPorArquivo.get(`events.${a.sessao}.jsonl`) ?? []).some((l) => JSON.parse(l).seq === a.seq && sha(l) === a.hash);
  if (!achou) {
    throw SEM_ANCORA(`a âncora aponta para o entrega.inicio ${a.sessao}/${a.seq}, que não está no diário: cauda apagada ou diário trocado; nada foi feito`);
  }
}

/** Grava a âncora do `inicio` que acabou de entrar no diário da sessão: a última linha do arquivo. Atômica (tmp + rename); falha ⇒ `ancora_nao_gravada`. */
function gravarAncora(c) {
  const tmp = join(c.dirEntrega, ANCORA_TMP);
  let fd = null;
  try {
    const ls = readFileSync(join(c.dirEntrega, `events.${c.sessao}.jsonl`), 'utf8').split('\n').filter((l) => l !== '');
    const linha = ls.at(-1);
    const o = JSON.parse(linha);
    if (o.tipo !== 'entrega.inicio' || !Number.isSafeInteger(o.seq)) throw new Error('a última linha do diário não é o entrega.inicio');
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
    writeSync(fd, `${JSON.stringify({ sessao: c.sessao, seq: o.seq, hash: sha(linha) })}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, join(c.dirEntrega, ANCORA));
  } catch (e) {
    if (fd !== null) try { closeSync(fd); } catch { /* já fechado */ }
    throw new Falha('ancora_nao_gravada', `${ANCORA} não gravada (${e.code ?? e.message}): o deploy NÃO rodou; o entrega.inicio ficou sem fim e a próxima decisão é parar`);
  }
}

// ─────────────────────────────────────────────────────────────── pré-condições comuns

function pausado(c) {
  if (existsSync(join(c.raiz, '.harness', 'PAUSAR'))) return true;
  try {
    return existsSync(join(git(c.cwd, 'rev-parse', '--show-toplevel'), '.harness', 'PAUSAR'));
  } catch {
    return false; // o principal já foi conferido
  }
}

/** P3 a P6: pausa, plano, diário, entrega completa e política efetiva. Nada gravado. */
function preparar(c, agoraMs, { conferirPausa = true } = {}) {
  if (conferirPausa && pausado(c)) throw new Falha('pausado', '.harness/PAUSAR presente: nada roda');
  const plano = carregarPlano(c);
  const linhasPorArquivo = new Map();
  const eventos = lerDiarioEstrito(c.dirEntrega, linhasPorArquivo);
  conferirAncora(c, linhasPorArquivo);
  if (!ordenar(eventos).ok) throw new Falha('diario_invalido', 'o diário da entrega não pôde ser ordenado; nada foi feito');
  const acao = proximaAcao(plano, eventos, SINAIS_NEUTROS);
  if (acao.tipo === 'parar' && acao.motivo === 'diario_invalido') throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições; nada foi feito');
  if (acao.tipo !== 'concluir') {
    throw new Falha('entrega_incompleta', `a entrega só sobe com todas as tasks integradas (próxima ação do loop: ${acao.tipo}${acao.motivo ? ` — ${acao.motivo}` : ''})`, { acao });
  }
  const origin = lerConfigOrigin(c.raiz);
  const config = lerConfigEntrega(origin.cfg);
  const avisos = [];
  if (origin.invalida) avisos.push(`config de origin inválida: ${origin.motivo}`);
  avisos.push(...config.erros);
  const efetiva = politicaEfetiva(config, plano.politica_entrega);
  if (!efetiva.ok) throw new Falha(efetiva.erro, efetiva.mensagem);
  return {
    plano, eventos, config, efetiva, agoraMs,
    ...(avisos.length > 0 ? { aviso: avisos.join(' | ') } : {}),
  };
}

export const decisaoDe = (p) => decidirEntrega({
  politica: p.efetiva.politica,
  janela: p.efetiva.janela,
  exigeProd: p.plano.politica_entrega?.exige_prod === true,
  base: p.config.base,
  comandos: p.config.comandos,
  eventos: p.eventos,
  agoraMs: p.agoraMs,
});

/** Grava um evento do contexto. `append` pode ser trocado por `opts.append` (falha injetada). Lança `Falha('evento_nao_gravado')`. */
function gravar(c, opts, tipo, dados, ts = new Date().toISOString()) {
  let autor = 'desconhecido';
  try { autor = git(c.raiz, 'config', 'user.email') || autor; } catch { /* sem user.email: o diário aceita "desconhecido" */ }
  let r;
  try {
    r = (opts.append ?? diario.append)(c.dirEntrega, c.sessao, { ts, autor, sessao: c.sessao, agente: 'orquestrador', tipo, dados });
  } catch (e) {
    throw new Falha('evento_nao_gravado', `${tipo} não gravado: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!r.ok) throw new Falha('evento_nao_gravado', `${tipo} não gravado: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `${tipo} recusado pelo canário do diário`);
}

// ─────────────────────────────────────────────────────────────── decidir

/** `decidir` em processo: a decisão e, só para `agendar` com `quando` inédito, `entrega.agendada`. */
export function decidirAgora(cwd, opts = {}) {
  try {
    const agoraMs = opts.agoraMs ?? Date.now();
    validarForma({ entrega: opts.entrega, sessao: opts.sessao });
    const c = contexto(cwd, { entrega: opts.entrega, sessao: opts.sessao });
    const p = preparar(c, agoraMs);
    const decisao = decisaoDe(p);
    if (decisao.tipo === 'agendar' && !p.eventos.some((e) => e.tipo === 'entrega.agendada' && e.dados?.quando === decisao.quando)) {
      gravar(c, opts, 'entrega.agendada', { quando: decisao.quando });
    }
    return { ok: true, decisao, politica: p.efetiva.politica, ...(p.aviso !== undefined ? { aviso: p.aviso } : {}) };
  } catch (e) {
    return aSaida(e);
  }
}

// ─────────────────────────────────────────────────────────────── leitura sem efeito (painel) e devolver

/**
 * O pid do `entrega.lock` está vivo? `process.kill(pid, 0)` sem erro, ou `EPERM` (existe, é de outro usuário). Lock sem pid legível, pasta no lugar do
 * arquivo ou ilegível ⇒ `false`: o painel segue para a decisão (lock órfão com `inicio` sem `fim` é produção em estado desconhecido: PAROU é a verdade).
 */
function lockVivo(dirEntrega) {
  let texto;
  try { texto = readFileSync(join(dirEntrega, 'entrega.lock'), 'utf8'); } catch { return false; }
  const m = /^(\d{1,10})(?:\s|$)/.exec(texto);
  const pid = m === null ? NaN : Number(m[1]);
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/**
 * `preparar` SEM efeito, para quem só lê (o painel). Nunca lança e nunca escreve (sem lock, sem append, sem âncora): `{ok:true, p}` (o mesmo `p` de
 * `preparar`) ou `{ok:false, erro, mensagem}`. Difere de `preparar` em três pontos: `.harness/PAUSAR` é ignorado (o painel mostra a pausa à parte; pular a
 * decisão esconderia um `parar` enquanto o loop está pausado); `entrega.lock` com pid vivo ⇒ `entrega_em_curso` (durante o deploy o `inicio` ainda não tem
 * `fim` e a decisão seria `parar nao_conseguiu`: o painel não pode acusar PAROU no meio de um deploy saudável); `acao ≠ concluir` ⇒ `entrega_incompleta`.
 */
export function prepararLeitura(cwd, opts = {}) {
  try {
    const agoraMs = opts.agoraMs ?? Date.now();
    validarForma({ entrega: opts.entrega, sessao: opts.sessao });
    const c = contexto(cwd, { entrega: opts.entrega, sessao: opts.sessao });
    if (lockVivo(c.dirEntrega)) {
      return { ok: false, erro: 'entrega_em_curso', mensagem: 'entrega.lock com processo vivo: a entrega está em curso; nada a decidir agora' };
    }
    return { ok: true, p: preparar(c, agoraMs, { conferirPausa: false }) };
  } catch (e) {
    return aSaida(e);
  }
}

/** Texto do `--motivo` (sem tocar disco): a 1ª recusa decide. Mesma régua de `formas.ts` e do canário do diário. */
function conferirMotivo(motivo) {
  if (typeof motivo !== 'string' || motivo.trim() === '') throw new Falha('motivo_vazio', '--motivo vazio: diga por que a entrega volta');
  const n = [...motivo].length;
  if (n > MOTIVO_MAX) throw new Falha('motivo_longo', `--motivo com ${n} caracteres: máximo ${MOTIVO_MAX}`);
  if (/\p{Cc}/u.test(motivo)) throw new Falha('motivo_invalido', '--motivo com caractere de controle (quebra de linha, tab…): uma linha de texto');
  // sem este pré-teste, `append` gravaria um `diario.recusa` (o canário recusa o evento mas grava a recusa): aqui são 0 bytes
  if (diario.recusaCanario(motivo) !== null) throw new Falha('motivo_recusado', '--motivo parece conter segredo: nada foi gravado (e o texto não é repetido aqui)');
}

/**
 * `devolver` em processo: o dono mandou a entrega de volta (botão do painel). Grava `entrega.devolvida {motivo}` e NADA mais: não roda `config.comandos`,
 * não confere o checkout, nunca escreve `comando` (o comando é remontado pelo id da entrega). Só com a decisão `subir`: só o deploy que `executar` rodaria
 * vira botão. Mesmo motivo vigente (depois do último `entrega.inicio`) ⇒ `ok:true, gravado:false`. Recusa com `ok:false` e 0 bytes, na ordem: forma de
 * `--entrega`/`--sessao` · motivo (vazio, longo, controle, canário) · lock · erros de `preparar` · `nao_subiu` · relógio. `opts`: `{motivo, entrega, sessao, agoraMs, append}`.
 */
export function devolverEntrega(cwd, opts = {}) {
  let lock = null;
  try {
    const agoraMs = opts.agoraMs ?? Date.now();
    validarForma({ entrega: opts.entrega, sessao: opts.sessao });
    conferirMotivo(opts.motivo);
    const { motivo } = opts;
    const c = contexto(cwd, { entrega: opts.entrega, sessao: opts.sessao });
    lock = pegarLock(c.dirEntrega);
    const p = preparar(c, agoraMs);
    const decisao = decisaoDe(p);
    const base = p.aviso !== undefined ? { aviso: p.aviso } : {};
    if (decisao.tipo !== 'subir') {
      return { ok: false, erro: 'nao_subiu', mensagem: `a decisão é "${decisao.tipo}", não "subir": só o deploy que \`executar\` rodaria pode ser devolvido; nada foi gravado`, decisao, ...base };
    }
    const ord = ordenar(p.eventos);
    if (!ord.ok) throw new Falha('diario_invalido', 'o diário da entrega não pôde ser ordenado; nada foi gravado');
    const iInicio = ord.eventos.reduce((a, e, i) => (e.tipo === 'entrega.inicio' ? i : a), -1);
    const ultima = ord.eventos.slice(iInicio + 1).filter((e) => e.tipo === 'entrega.devolvida').at(-1);
    if (ultima !== undefined && ultima.dados?.motivo === motivo) return { ok: true, gravado: false, ...base };
    // o candidato na ORDEM REAL do diário: relógio de outra sessão à frente o poria antes do `entrega.inicio`, e o pedido não valeria para a decisão de agora
    const ts = new Date().toISOString();
    const minhas = p.eventos.filter((e) => e.sessao === c.sessao).map((e) => e.seq);
    const candidato = { seq: (minhas.length > 0 ? Math.max(...minhas) : 0) + 1, ts, autor: 'x', sessao: c.sessao, agente: 'orquestrador', tipo: 'entrega.devolvida', dados: { motivo }, hash_anterior: null };
    const comCandidato = ordenar([...p.eventos, candidato]);
    if (!comCandidato.ok) throw new Falha('diario_invalido', 'o diário ficaria fora de ordem com o pedido; nada foi gravado');
    if (comCandidato.eventos.indexOf(candidato) < comCandidato.eventos.reduce((a, e, i) => (e.tipo === 'entrega.inicio' ? i : a), -1)) {
      throw new Falha('relogio_do_diario', 'um evento do diário tem relógio à frente do agora: na ordem do diário o pedido cairia antes do último entrega.inicio e não valeria; nada foi gravado');
    }
    gravar(c, opts, 'entrega.devolvida', { motivo }, ts);
    return { ok: true, gravado: true, evento: { tipo: 'entrega.devolvida', motivo }, ...base };
  } catch (e) {
    return aSaida(e);
  } finally {
    soltarLock(lock);
  }
}

// ─────────────────────────────────────────────────────────────── executar

function pegarLock(dir) {
  // sem a pasta da entrega não há plano nem o que travar: a recusa vem de `plano_ausente`, sem criar pasta
  if (!existsSync(dir)) return null;
  const arq = join(dir, 'entrega.lock');
  let fd;
  try {
    fd = openSync(arq, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') {
      throw new Falha('entrega_em_curso', `${arq} existe: outra execução da entrega está em curso, ou morreu no meio; o lock órfão não é quebrado (o estado de produção é desconhecido): confira e remova à mão`);
    }
    throw new Falha('lock_indisponivel', `não consegui criar ${arq} (${e.code ?? e.message}); nada foi feito`);
  }
  try { writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`); } finally { closeSync(fd); }
  return arq;
}

function soltarLock(arq) {
  if (arq === null) return;
  try { unlinkSync(arq); } catch { /* o próximo `executar` verá o lock: lado seguro */ }
}

/** `git status` rastreado do principal, sem os arquivos do diário (`events.*.jsonl`: versionados na branch, mudam a cada evento); `plano.json` e o resto contam. */
function conferirCheckout(c) {
  let saida;
  try {
    saida = git(c.raiz, 'status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude,glob).harness/entregas/*/events.*.jsonl');
  } catch (e) {
    throw new Falha('git_falhou', `não consegui conferir o checkout principal (${e.message}); nada foi feito`);
  }
  if (saida !== '') {
    const linhas = saida.split('\n');
    throw new Falha('checkout_sujo', `o checkout principal tem mudança rastreada sem commit (${linhas.slice(0, 5).join('; ')}${linhas.length > 5 ? '; …' : ''}): o comando declarado vem de origin/HEAD e o arquivo que roda é o local; commite ou descarte antes`);
  }
}

const matarGrupo = (pid) => {
  if (!Number.isInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* grupo já vazio */ }
};

/**
 * Uma etapa: processo líder `detached` (grupo próprio), sem shell. O fim é o `exit` do líder; no prazo, ou ao sair o líder, o grupo inteiro morre
 * com SIGKILL. Estouro, rc ≠ 0, sinal ou `error` (`ENOENT`, `EACCES`…) = falha. stdout e stderr num anel dos últimos 2.000 caracteres, sem `maxBuffer`.
 */
function rodarComando(argv, cwd, timeoutS) {
  return new Promise((resolve) => {
    let anel = '';
    let veredito = null;
    let estouro = false;
    let resolvido = false;
    let timer = null;
    let graca = null;
    let child = null;
    const concluir = () => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      clearTimeout(graca);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      let saida = anel;
      // anel cheio: a 1ª linha pode ter perdido o começo (e o prefixo do segredo com ele); descarta o pedaço
      // sem `\n` (linha única gigante): descarta até o 1º espaço em branco; sem nenhum, nada do anel é confiável
      if (saida.length >= ANEL_MAX) {
        if (saida.includes('\n')) saida = saida.slice(saida.indexOf('\n') + 1);
        else {
          const ws = saida.search(/\s/);
          saida = ws === -1 ? '[cortado]' : saida.slice(ws + 1);
        }
      }
      resolve({ ok: veredito.falha === undefined, ...(veredito.falha === undefined ? {} : { falha: veredito.falha }), saida });
    };
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      veredito = { falha: 'erro' };
      concluir();
      return;
    }
    const alimentar = (pedaco) => { anel = (anel + pedaco).slice(-ANEL_MAX); };
    for (const s of [child.stdout, child.stderr]) {
      s.setEncoding('utf8');
      s.on('data', alimentar);
      s.on('error', () => {});
    }
    child.on('error', () => {
      if (veredito === null) veredito = { falha: 'erro' };
      matarGrupo(child.pid);
      concluir();
    });
    child.on('exit', (codigo, sinal) => {
      if (veredito !== null) return;
      matarGrupo(child.pid);
      if (estouro) veredito = { falha: 'timeout' };
      else if (sinal !== null) veredito = { falha: 'sinal' };
      else if (codigo !== 0) veredito = { falha: 'rc' };
      else veredito = {};
      graca = setTimeout(concluir, GRACA_MS);
    });
    child.on('close', () => { if (veredito !== null) concluir(); });
    timer = setTimeout(() => {
      estouro = true;
      matarGrupo(child.pid);
    }, timeoutS * 1000);
  });
}

const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/;
const PEM_END = /-----END [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/;

/**
 * Redação por linha pelo canário do diário, mais o BLOCO de chave PEM inteiro: de `-----BEGIN ... PRIVATE KEY-----` até o `-----END`
 * (inclusive) as linhas são o corpo da chave e o canário não as reconhece. Sem `END` o bloco vai até o fim da saída; `END` sem `BEGIN`
 * (o anel cortou o começo) redige do início da saída até ele.
 */
const redigir = (texto) => {
  const linhas = texto.split('\n');
  const oculta = linhas.map(() => false);
  let dentro = false;
  linhas.forEach((l, i) => {
    if (!dentro && PEM_BEGIN.test(l)) {
      oculta[i] = true;
      dentro = !PEM_END.test(l);
    } else if (!dentro && PEM_END.test(l)) {
      for (let j = 0; j <= i; j++) oculta[j] = true;
    } else if (dentro) {
      oculta[i] = true;
      if (PEM_END.test(l)) dentro = false;
    }
  });
  return linhas.map((l, i) => ((l !== '' && oculta[i]) || diario.recusaCanario(l) !== null ? '[redigido]' : l)).join('\n');
};

/** `executar` em processo. `opts`: `{ entrega, sessao, agoraMs, append }`. Devolve a saída; nunca lança. */
export async function executarEntrega(cwd, opts = {}) {
  let lock = null;
  try {
    const agoraMs = opts.agoraMs ?? Date.now();
    validarForma({ entrega: opts.entrega, sessao: opts.sessao });
    const c = contexto(cwd, { entrega: opts.entrega, sessao: opts.sessao });
    lock = pegarLock(c.dirEntrega);
    const p = preparar(c, agoraMs);
    conferirCheckout(c);
    const decisao = decisaoDe(p);
    const base = p.aviso !== undefined ? { aviso: p.aviso } : {};
    if (decisao.tipo === 'entregue') return { ok: true, decisao, ...base };
    if (decisao.tipo !== 'subir') {
      return { ok: false, erro: 'nao_subiu', mensagem: `a decisão é "${decisao.tipo}", não "subir": nada foi rodado nem gravado`, decisao, ...base };
    }
    return { ...(await subir(c, p, opts, decisao)), ...base };
  } catch (e) {
    return aSaida(e);
  } finally {
    soltarLock(lock);
  }
}

async function subir(c, p, opts, decisao) {
  const { config } = p;
  // E0 e E1: antes do deploy. Falha de append aborta; nada rodou e não fica `inicio` órfão (a ordem é o contrato)
  gravar(c, opts, 'producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:deploy' });
  gravar(c, opts, 'entrega.inicio', { politica: p.efetiva.politica });
  gravarAncora(c); // falha ⇒ o deploy não roda; o `inicio` fica sem `fim` (próxima decisão: parar)
  // depois do `inicio` nenhuma falha de append interrompe a sequência de comandos
  const avisos = [];
  const reg = (tipo, dados) => {
    try { gravar(c, opts, tipo, dados); } catch (e) { avisos.push(e.message); }
  };
  const etapas = [];
  const etapa = async (nome) => {
    const cmd = config.comandos[nome];
    const r = await rodarComando(cmd.argv, c.raiz, cmd.timeout_s);
    const comando = cmd.argv.join(' ');
    etapas.push({
      etapa: nome, comando: diario.recusaCanario(comando) === null ? comando : '[redigido]', ok: r.ok, ...(r.ok ? {} : { falha: r.falha }), saida: redigir(r.saida),
    });
    return r.ok;
  };
  const resumo = () => etapas.map((e) => `${e.etapa}: ${e.comando} (${e.ok ? 'ok' : 'falhou'})`).join('; ');
  const avisosCampo = () => (avisos.length > 0 ? { avisos } : {});

  let origem;
  if (await etapa('deploy')) {
    const smokeOk = await etapa('smoke');
    reg('entrega.smoke', { ok: smokeOk });
    if (smokeOk) {
      reg('entrega.fim', { ok: true });
      if (avisos.length > 0) {
        return { ok: false, erro: 'evento_nao_gravado', mensagem: `a entrega rodou, mas ${avisos.length} evento(s) não foram gravados: a próxima decisão para (inicio sem fim)`, etapas, decisao, systemMessage: resumo(), avisos };
      }
      return { ok: true, etapas, decisao, systemMessage: resumo() };
    }
    origem = 'smoke';
  } else {
    origem = 'deploy';
  }
  // R0: deploy ou smoke falhou; prod em estado desconhecido, então o rollback roda
  reg('producao.acesso', { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:rollback' });
  const rollbackOk = await etapa('rollback');
  reg('entrega.rollback', { ok: rollbackOk });
  if (rollbackOk) {
    reg('entrega.fim', { ok: false, motivo: origem });
    reg('loop.parar', { motivo: origem === 'smoke' ? 'smoke' : 'nao_conseguiu' });
  } else {
    reg('entrega.fim', { ok: false, motivo: 'rollback' });
    reg('loop.parar', { motivo: 'rollback' });
  }
  return {
    ok: false,
    erro: 'etapa_falhou',
    mensagem: `${origem === 'smoke' ? 'o smoke' : 'o deploy'} falhou; rollback ${rollbackOk ? 'feito' : 'FALHOU'}; a entrega parou`,
    etapas,
    decisao,
    systemMessage: resumo(),
    ...avisosCampo(),
  };
}

// ─────────────────────────────────────────────────────────────── CLI

function lerArgs(argv) {
  const [cmd, ...resto] = argv;
  if (cmd !== 'decidir' && cmd !== 'executar' && cmd !== 'devolver') throw new Falha('uso', `comando desconhecido ou ausente. ${USO}`);
  const flags = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (!a.startsWith('--')) throw new Falha('uso', `${cmd} não aceita argumento posicional ("${a}"). ${USO}`);
    const nome = a.slice(2);
    if (nome !== 'entrega' && nome !== 'sessao' && !(cmd === 'devolver' && nome === 'motivo')) throw new Falha('uso', `argumento desconhecido para ${cmd}: ${a}. ${USO}`);
    const v = resto[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Falha('uso', `${a} sem valor. ${USO}`);
    if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${USO}`);
    flags[nome] = v;
    i++;
  }
  if (cmd === 'devolver' && !Object.hasOwn(flags, 'motivo')) throw new Falha('uso', `devolver exige --motivo. ${USO}`);
  return { cmd, flags };
}

export async function main(argv, cwd = process.cwd()) {
  let saida;
  try {
    const { cmd, flags } = lerArgs(argv);
    saida = cmd === 'decidir' ? decidirAgora(cwd, flags) : cmd === 'devolver' ? devolverEntrega(cwd, flags) : await executarEntrega(cwd, flags);
  } catch (e) {
    saida = aSaida(e);
  }
  process.stdout.write(`${JSON.stringify(saida)}\n`);
  return rcDe(saida);
}

if (ehEntrypoint(import.meta.url)) main(process.argv.slice(2)).then((rc) => { process.exitCode = rc; });

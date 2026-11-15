#!/usr/bin/env node
/**
 * REQ-SOM-1 a SOM-4 pela borda — `sombra.mjs`: a dúvida do loop vai à Sombra por caminho fixo e nunca é perguntada duas vezes.
 *
 *   sombra.mjs perguntar (--req <REQ> | --task <id>) --pergunta <texto> [--entrega <GM-10>] [--sessao <id>]
 *       → {ok, hash, cache:true, decisao} | {ok, hash, pendente:true, brief, prompt} | {ok, hash, brief, prompt, consultas, teto}
 *   sombra.mjs perguntar --task <id> --libera-teto [--entrega <GM-10>] [--sessao <id>]   (GM-14 T36, FIEL-15) a PERGUNTA FECHADA de liberação do
 *       teto (texto fixo, `perguntaDaLiberacao` de `loop.mjs`); só o hash dela serve a `loop.mjs liberar --origem sombra`. Sem `--pergunta`.
 *       GM-14 T39 (emenda 16, FIEL-15 e): o texto traz o critério; o brief traz SEMPRE as emendas aprovadas de REQ-DIA-2 (onde a FIEL-15 mora)
 *       além das dos REQ da task (e elas versionam o hash), e os achados do ciclo corrente (`achadosDoCiclo` de `loop.mjs`): cada
 *       `review-r<n>.md` até 40 KB com corte marcado e o sha256 do arquivo inteiro; ausente, ilegível ou cortado aparece marcado.
 *       T39 r1: só com a task em `no_teto` (`fora_do_teto`, nada gravado); o hash leva a identidade do insumo (rodadas do ciclo + sha256 de
 *       cada achado): veredito novo ou achado reescrito ⇒ hash novo, consulta nova e brief novo; a decisão do hash velho não libera.
 *   sombra.mjs registrar <hash> <resposta.json> [--entrega <GM-10>] [--sessao <id>]  → {ok, evento}
 *       resposta.json: { resposta, texto, pergunta_enviesada, fontes?, medicao?, fora_da_regra?, emenda_seq?, substitui?: {sessao, seq}, libera? }
 *       `libera` (booleano, GM-14 T36): só na pergunta de liberação da task (`libera_fora_da_liberacao`); ausente, a decisão grava os campos de antes.
 *
 * CONTRATO DE FALHA. Saída é UMA linha de JSON em stdout, sempre com `ok`; falha traz `erro` (código) e `mensagem`, rc 1; uso errado e
 * argumento fora da forma saem 2 (contrato de `loop.mjs`). Dado ausente, corrompido ou ferramenta falhando nunca vira sucesso, e ausente ≠
 * corrompido: pasta do diário ausente grava (cria), cadeia quebrada é `diario_ilegivel`; spec ausente ≠ ilegível; `resposta.json` ausente ≠
 * inválido. Nada é gravado antes de toda recusa possível ter sido avaliada (canário, forma, spec, diário).
 *
 * ORDEM DE GRAVAÇÃO. `perguntar`: `sombra.consulta` ANTES do brief (se a consulta não gravar, nenhum brief sobra); consulta gravada e brief
 * falho ⇒ `brief_nao_gravado`, e a chamada seguinte cai em "consulta aberta" e reescreve o brief. `registrar`: o texto inteiro vai para
 * `<hash>.<sha12(texto)>.resposta.md` (modo `wx`, nunca sobrescreve) e só então `decisao.sombra`; se o `append` falha o arquivo fica e a
 * decisão não. O `req|task` do evento vem da CONSULTA, nunca do `resposta.json`; campo extra do JSON nunca chega ao diário.
 *
 * LIMITES DECLARADOS. (1) `registrar` confia na transcrição do orquestrador: o agente é só leitura, quem escreve o `resposta.json` é o
 * orquestrador, e a hipótese dele não passa pela guarda nesse passo (mitigação fora do escopo: capturar a resposta no `SubagentStop`).
 * (2) Sem lock em volta do par ler+gravar, duas chamadas simultâneas do mesmo hash podem gravar duas consultas e dois briefs: conta a mais no
 * teto, nenhuma decisão se perde (mesmo limite de `loop.mjs`). (3) `perguntar` de uma worktree de task grava no diário da raiz PRINCIPAL.
 * (4) GM-14 T39 (emenda 16): os `review-r<n>.md` que o brief da liberação transcreve ficam na worktree, que o implementador edita; o sha256 no
 * brief prova o que a Sombra leu, não que é o que o revisor escreveu.
 *
 * Tudo que toca git vai por `execFileSync` com argv, sem shell. Nada é apagado.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ehEntrypoint } from '../lib/cli.mjs';
import { lerConfigOrigin } from '../lib/config.mjs';
import { ACHADO_MAX_BYTES, achadosDoCiclo, estadoNoDiario, hashDaLiberacao, perguntaDaLiberacao, reqsDaLiberacao, tetoDaSombra } from './loop.mjs';
import * as diario from '../dist/diario.js';
import { projetarEmendas } from '../dist/emenda.js';
import { formaInvalida, REQ_RE } from '../dist/formas.js';
import { validarPlano } from '../dist/plano.js';
import {
  contarConsultas, consultasAbertas, diarioEmOrdem, hashPergunta, montarBrief, normalizarPergunta, projetarDecisoes, promptSombra, textoAncora, trechoDoReq,
} from '../dist/sombra.js';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TETO_PADRAO = 26;
const RESPOSTA_MAX = 1000;
const GIT_REDIRECIONA = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'];

/** Falha com código: vira `{ok:false, erro, mensagem, ...extra}` e rc 1 (ou 2 para uso). */
class Falha extends Error {
  constructor(erro, mensagem, extra = {}, rc = 1) {
    super(mensagem);
    this.erro = erro;
    this.extra = extra;
    this.rc = rc;
  }
}

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

/** Raiz da worktree PRINCIPAL, de qualquer worktree do repositório (`--git-common-dir`), como `loop.mjs`. */
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
    if (e.code === 'ENOENT') throw new Falha('plano_ausente', `${rel} não existe: sem plano.json não há consulta para esta entrega`);
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
 * Leitura estrita com a semântica de `loop.mjs:lerDiarioEstrito`: pasta `ENOENT` ⇒ `[]` (ausente: grava e cria); qualquer outra falha, linha que
 * não é objeto JSON, cadeia de hash quebrada e arquivo não regular ⇒ `diario_ilegivel`. `diario.lerEstrito` sozinho não serve: trata pasta ausente
 * como ilegível (`diario.ts:224`).
 */
function lerDiarioEstrito(dir) {
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
    for (const [i, linha] of texto.split('\n').entries()) {
      if (linha === '') continue;
      let o;
      try { o = JSON.parse(linha); } catch { throw new Falha('diario_ilegivel', `${nome}, linha ${i + 1}: não é JSON`); }
      if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new Falha('diario_ilegivel', `${nome}, linha ${i + 1}: não é um objeto`);
      const esperado = anterior === null ? null : sha(anterior);
      if (o.hash_anterior !== esperado) throw new Falha('diario_ilegivel', `${nome}, linha ${i + 1}: cadeia de hash quebrada`);
      anterior = linha;
      eventos.push(o);
    }
  }
  return eventos;
}

/** Diário lido de forma estrita e conferido: sem ordem não há versão (`diario_invalido`). */
function diarioConferido(c) {
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (!diarioEmOrdem(eventos)) throw new Falha('diario_invalido', 'o diário da entrega está fora de ordem (seq não crescente ou ts ilegível): sem ordem não há versão; nada foi gravado');
  const est = projetarEmendas(eventos);
  if (est.invalido !== undefined) throw new Falha('diario_invalido', `o diário da entrega não pôde ser projetado (${est.invalido}); nada foi gravado`);
  return { eventos, est };
}

function gravarEvento(c, tipo, dados) {
  let autor = 'desconhecido';
  try { autor = git(c.raiz, 'config', 'user.email') || autor; } catch { /* sem user.email: o diário aceita "desconhecido" */ }
  const r = diario.append(c.dirEntrega, c.sessao, { ts: new Date().toISOString(), autor, sessao: c.sessao, agente: 'orquestrador', tipo, dados });
  if (!r.ok) throw new Falha('evento_nao_gravado', `${tipo} não gravado: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `${tipo} recusado pelo canário do diário`);
}

// ─────────────────────────────────────────────────────────────── entrada

const USO = 'uso: sombra.mjs perguntar (--req <REQ> | --task <id>) --pergunta <texto> [--entrega GM-10] [--sessao <id>] | perguntar --task <id> --libera-teto | registrar <hash> <resposta.json> [--entrega GM-10] [--sessao <id>]';

/** Argumentos estritos. Flag desconhecida, sem valor ou repetida, e posicional a mais ou a menos é uso (rc 2). */
function lerArgs(argv) {
  const [cmd, ...resto] = argv;
  const ESPEC = {
    perguntar: { pos: 0, flags: ['req', 'task', 'pergunta', 'entrega', 'sessao', 'libera-teto'], semValor: ['libera-teto'] },
    registrar: { pos: 2, flags: ['entrega', 'sessao'] },
  };
  if (typeof cmd !== 'string' || !Object.hasOwn(ESPEC, cmd)) throw new Falha('uso', `comando desconhecido ou ausente. ${USO}`, {}, 2);
  const esp = ESPEC[cmd];
  const pos = [];
  const flags = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a.startsWith('--')) {
      const nome = a.slice(2);
      if (!esp.flags.includes(nome)) throw new Falha('uso', `argumento desconhecido para ${cmd}: ${a}. ${USO}`, {}, 2);
      if (esp.semValor?.includes(nome)) { if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${USO}`, {}, 2); flags[nome] = true; continue; }
      const v = resto[i + 1];
      // a pergunta é texto livre e pode começar com `--`; qualquer outra flag com valor que parece flag é uso.
      if (v === undefined || (nome !== 'pergunta' && v.startsWith('--'))) throw new Falha('uso', `${a} sem valor. ${USO}`, {}, 2);
      if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${USO}`, {}, 2);
      flags[nome] = v;
      i++;
    } else {
      pos.push(a);
    }
  }
  if (pos.length !== esp.pos) throw new Falha('uso', `${cmd} espera ${esp.pos} argumento(s) posicional(is), veio ${pos.length}. ${USO}`, {}, 2);
  return { cmd, pos, flags };
}

function validarFlagsComuns(flags) {
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('argumento_invalido', `--entrega "${flags.entrega}" fora da forma ${ENTREGA_RE}`, {}, 2);
  if (flags.sessao !== undefined && !SESSAO_RE.test(flags.sessao)) throw new Falha('argumento_invalido', `--sessao fora da forma ${SESSAO_RE}`, {}, 2);
}

/** `sombra.teto` de `origin/HEAD`: ausente ⇒ 26 sem aviso; presente e inválido, ou config de origin corrompida ⇒ 26 com `aviso` (ausente ≠ corrompido). A regra do teto é `tetoDaSombra` de `loop.mjs` (E4, T9: sem terceira cópia). */
function tetoDe(raiz) {
  const o = lerConfigOrigin(raiz);
  if (o.fonte !== 'origin' && o.invalida === true) return { teto: TETO_PADRAO, aviso: `config de origin/HEAD inválida (${o.motivo}): teto ${TETO_PADRAO}` };
  return tetoDaSombra(o);
}

/** Caminho do brief, LITERAL: a mesma string que a guarda monta (T12); nunca `relative` de `realpath`. */
const caminhoLiteral = (c, hash) => `.harness/entregas/${c.entrega}/sombra/${hash}.md`;

// ─────────────────────────────────────────────────────────────── perguntar

function lerSpec(c, plano) {
  if (typeof plano.spec !== 'string' || plano.spec === '') throw new Falha('plano_sem_spec', 'plano.json sem `spec`: sem a spec não há trecho de REQ para o brief');
  const abs = resolve(c.raiz, plano.spec);
  const rel = relative(c.raiz, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Falha('spec_fora_da_raiz', `plano.spec "${plano.spec}" sai da raiz do repositório`);
  try {
    const real = realpathSync(abs);
    const relReal = relative(realpathSync(c.raiz), real);
    if (relReal.startsWith('..') || isAbsolute(relReal)) throw new Falha('spec_fora_da_raiz', `plano.spec "${plano.spec}" aponta para fora da raiz (symlink)`);
    return readFileSync(real, 'utf8');
  } catch (e) {
    if (e instanceof Falha) throw e;
    if (e.code === 'ENOENT') throw new Falha('spec_ausente', `${plano.spec} não existe`);
    throw new Falha('spec_ilegivel', `${plano.spec} ilegível (${e.code ?? e.message})`);
  }
}

/** Versão da âncora = `proposta_seq` da ÚLTIMA aprovada (ordem do julgamento) dentre os REQs; nunca o máximo, que repetiria valor. */
function versaoDe(est, reqs) {
  const v = est.aprovadas.filter((p) => reqs.includes(p.req));
  return v.length === 0 ? 0 : v[v.length - 1].seq;
}

function escreverBrief(c, hash, conteudo, { sobrescrever }) {
  try {
    mkdirSync(join(c.dirEntrega, 'sombra'), { recursive: true });
    writeFileSync(join(c.dirEntrega, 'sombra', `${hash}.md`), conteudo, { flag: sobrescrever ? 'w' : 'wx' });
  } catch (e) {
    if (!sobrescrever && e.code === 'EEXIST') return;
    throw new Falha('brief_nao_gravado', `brief ${hash}.md não gravado (${e.code ?? e.message}); a consulta está aberta: repita \`perguntar\` para reescrevê-lo`);
  }
}

/** Cerca de código mais longa que qualquer sequência de crases do conteúdo: o achado nunca fecha o bloco. */
const cerca = (texto) => '`'.repeat(Math.max(3, ...[...texto.matchAll(/`+/gu)].map((m) => m[0].length + 1)));

const ESTADO_DO_ACHADO = {
  integro: (a) => `íntegro (${a.bytes} bytes)`,
  cortado: (a) => `CORTADO: só os primeiros ${a.lidos} de ${a.bytes} bytes (limite ${ACHADO_MAX_BYTES}); o sha256 é do arquivo inteiro`,
  ausente: () => 'AUSENTE: o arquivo não existe',
  ilegivel: (a) => `ILEGÍVEL: ${a.motivo}`,
};

/** T39 (emenda 16 e.2): a seção dos achados do ciclo corrente, antes da `## Instrução` (que segue no fim do brief). */
function comAchados(brief, task, achados) {
  const partes = ['## Achados do ciclo corrente', '',
    `Rodadas com review.veredito da task ${task} depois da última task.reaberta dela (ou desde o começo, se não houve), na ordem do diário. `
    + `Cada arquivo até ${ACHADO_MAX_BYTES} bytes; o sha256 é do arquivo inteiro. Os arquivos ficam na worktree, que o implementador edita: o sha prova o que você leu, não quem escreveu.`];
  if (achados.length === 0) partes.push('', '(nenhuma rodada no ciclo corrente)');
  achados.forEach((a, i) => {
    const ultima = i === achados.length - 1 ? ' · ÚLTIMA RODADA' : '';
    partes.push('', `### Rodada ${a.rodada} (${a.veredito}, blocker ${a.blocker}, major ${a.major})${ultima}`, '',
      `- arquivo: ${a.arquivo}`, `- estado: ${ESTADO_DO_ACHADO[a.estado](a)}`, ...(a.sha256 !== undefined ? [`- sha256: ${a.sha256}`] : []));
    if (a.conteudo !== undefined) {
      const f = cerca(a.conteudo);
      partes.push('', `${f}markdown`, a.conteudo.replace(/\n$/u, ''), f);
      if (a.estado === 'cortado') partes.push('', `[CORTADO em ${a.lidos} de ${a.bytes} bytes]`);
    }
  });
  const i = brief.lastIndexOf('\n## Instrução\n');
  const secao = `${partes.join('\n')}\n`;
  return i < 0 ? `${brief}\n${secao}` : `${brief.slice(0, i + 1)}${secao}${brief.slice(i)}`;
}

function perguntar(cwd, flags) {
  const { req, task } = flags;
  // GM-14 T36: `--libera-teto` é a pergunta fechada de liberação, ancorada na task; o texto é o de `loop.mjs`, nunca digitado.
  if (flags['libera-teto'] === true && (task === undefined || req !== undefined || flags.pergunta !== undefined)) {
    throw new Falha('uso', `perguntar --libera-teto exige --task e não aceita --req nem --pergunta. ${USO}`, {}, 2);
  }
  const pergunta = flags['libera-teto'] === true ? perguntaDaLiberacao(task) : flags.pergunta;
  if ((req === undefined) === (task === undefined) || pergunta === undefined) throw new Falha('uso', `perguntar exige exatamente um de --req/--task e --pergunta. ${USO}`, {}, 2);
  validarFlagsComuns(flags);
  if (req !== undefined && !REQ_RE.test(req)) throw new Falha('argumento_invalido', `--req "${req}" fora da forma REQ-<ÁREA>-<n>`, {}, 2);
  if (task !== undefined && !ID_RE.test(task)) throw new Falha('argumento_invalido', `--task ${JSON.stringify(task)} fora da forma ${ID_RE}`, {}, 2);
  if (normalizarPergunta(pergunta) === '') throw new Falha('pergunta_vazia', 'a pergunta está vazia depois de normalizar');
  const padrao = diario.recusaCanario(pergunta);
  if (padrao !== null) throw new Falha('segredo_na_pergunta', `a pergunta casa o canário de segredo (${padrao}); nada foi gravado`);

  const c = contexto(cwd, flags);
  const plano = carregarPlano(c);
  const spec = lerSpec(c, plano);

  let reqs;
  let tarefa;
  if (req !== undefined) {
    reqs = [req];
  } else {
    tarefa = plano.tasks.find((t) => t.id === task);
    if (tarefa === undefined) throw new Falha('task_fora_do_plano', `task ${task} não está no plano da entrega ${plano.entrega}`);
    reqs = tarefa.reqs ?? [];
  }
  const trechos = [];
  for (const r of reqs) {
    const texto = trechoDoReq(spec, r);
    if (texto === null) throw new Falha('req_fora_da_spec', `${r} não está na spec ${plano.spec}`);
    trechos.push({ req: r, texto });
  }

  const { eventos, est } = diarioConferido(c);
  const ancora = req !== undefined ? { req } : { task };
  const liberacao = flags['libera-teto'] === true;
  // T39 r1 (MAJOR 1): só há liberação a perguntar com a task no teto; fora dele, recusa antes de gravar
  if (liberacao) {
    const r = estadoNoDiario(eventos, task);
    if ('invalido' in r) throw new Falha('diario_invalido', `diário da task ${task} fora da tabela de transições: ${r.invalido}; nada foi gravado`);
    if (r.estado !== 'no_teto') throw new Falha('fora_do_teto', `a task ${task} está em ${r.estado}: a pergunta de liberação só vale com a task no teto de rodadas (no_teto); nada foi gravado`);
  }
  // T39: na liberação, as emendas de REQ-DIA-2 entram na versão e no brief (a mesma regra de `hashDaLiberacao`)
  const reqsDasEmendas = liberacao ? reqsDaLiberacao(tarefa) : reqs;
  // T39 r1 (MAJOR 1): os achados lidos UMA vez alimentam o brief e o hash (`hashDaLiberacao`, a régua de `liberar`): insumo novo, hash novo
  const achados = liberacao ? achadosDoCiclo(c.raiz, eventos, task) : undefined;
  let hash;
  try {
    hash = liberacao ? hashDaLiberacao(plano, eventos, task, c.raiz, achados) : hashPergunta(textoAncora(ancora), versaoDe(est, reqsDasEmendas), pergunta);
  } catch (e) {
    throw new Falha('argumento_invalido', `não deu para calcular o hash da pergunta (${e.message})`, {}, 2);
  }
  if (hash === null) throw new Falha('diario_invalido', `não deu para calcular o hash da pergunta de liberação de ${task} (emendas do diário não projetam); nada foi gravado`);

  const decisao = projetarDecisoes(eventos).get(hash);
  if (decisao !== undefined) return { hash, cache: true, decisao };

  const emendas = est.aprovadas.filter((p) => reqsDasEmendas.includes(p.req)).map((p) => ({ proposta_seq: p.seq, req: p.req, diff: p.diff }));
  const base = montarBrief({ pergunta, ancora: textoAncora(ancora), spec: plano.spec, trechos, emendas, ...(tarefa !== undefined ? { task: tarefa } : {}) });
  const conteudo = liberacao ? comAchados(base, task, achados) : base;
  const { teto, aviso: avisoTeto } = tetoDe(c.raiz);

  if (consultasAbertas(eventos).includes(hash)) {
    escreverBrief(c, hash, conteudo, { sobrescrever: false });
    const brief = caminhoLiteral(c, hash);
    return { hash, pendente: true, brief, prompt: promptSombra(brief), ...(avisoTeto !== undefined ? { aviso: avisoTeto } : {}) };
  }

  gravarEvento(c, 'sombra.consulta', { pergunta_hash: hash, ...(req !== undefined ? { req } : { task }) });
  escreverBrief(c, hash, conteudo, { sobrescrever: true });
  const brief = caminhoLiteral(c, hash);
  const consultas = contarConsultas(eventos) + 1;
  const avisos = [avisoTeto, consultas > teto ? `consultas à Sombra (${consultas}) acima do teto (${teto})` : undefined].filter((a) => a !== undefined);
  return { hash, brief, prompt: promptSombra(brief), consultas, teto, ...(avisos.length > 0 ? { aviso: avisos.join('; ') } : {}) };
}

// ─────────────────────────────────────────────────────────────── registrar

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v) => typeof v === 'string' && v.trim() !== '';

function lerResposta(arq) {
  let bruto;
  try {
    bruto = readFileSync(arq, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Falha('resposta_ausente', `${arq} não existe`);
    throw new Falha('resposta_invalida', `${arq} ilegível (${e.code ?? e.message})`);
  }
  let o;
  try { o = JSON.parse(bruto); } catch (e) { throw new Falha('resposta_invalida', `${arq} não é JSON (${String(e.message).split('\n')[0]})`); }
  if (!ehObjeto(o)) throw new Falha('resposta_invalida', `${arq}: a raiz não é um objeto`);
  return o;
}

function registrar(cwd, pos, flags) {
  const [hash, arqResposta] = pos;
  validarFlagsComuns(flags);
  if (!HASH_RE.test(hash)) throw new Falha('argumento_invalido', 'hash fora da forma sha256 em hex minúsculo (64)', {}, 2);
  const r = lerResposta(resolve(cwd, arqResposta));

  if (typeof r.resposta !== 'string' || r.resposta.trim() === '') throw new Falha('resposta_invalida', 'campo `resposta` ausente, vazio ou que não é texto');
  if (typeof r.texto !== 'string' || r.texto.trim() === '') throw new Falha('resposta_invalida', 'campo `texto` ausente, vazio ou que não é texto');
  if (typeof r.pergunta_enviesada !== 'boolean') throw new Falha('resposta_invalida', 'campo `pergunta_enviesada` ausente ou que não é booleano');
  if (r.fora_da_regra !== undefined && typeof r.fora_da_regra !== 'boolean') throw new Falha('resposta_invalida', 'campo `fora_da_regra` que não é booleano');
  if (r.libera !== undefined && typeof r.libera !== 'boolean') throw new Falha('resposta_invalida', 'campo `libera` que não é booleano');
  // mesma medida de `formaInvalida` (pontos de código); o diário recusaria depois, mas o CLI recusa antes de tocar qualquer arquivo
  const tamanho = [...r.resposta].length;
  if (tamanho > RESPOSTA_MAX) throw new Falha('resposta_longa', `\`resposta\` tem ${tamanho} caracteres, máximo ${RESPOSTA_MAX}: o texto inteiro vai em \`texto\``);
  for (const campo of ['resposta', 'texto']) {
    const padrao = diario.recusaCanario(r[campo]);
    if (padrao !== null) throw new Falha('segredo_na_resposta', `\`${campo}\` casa o canário de segredo (${padrao}); nenhum arquivo e nenhum evento foram gravados`);
  }

  const c = contexto(cwd, flags);
  const { eventos, est } = diarioConferido(c);
  const consulta = eventos.find((e) => e.tipo === 'sombra.consulta' && formaInvalida(e.tipo, e.dados) === null && e.dados.pergunta_hash === hash);
  if (consulta === undefined) throw new Falha('sem_consulta', `nenhuma sombra.consulta do hash ${hash}: \`perguntar\` primeiro`);
  const ancora = consulta.dados.req !== undefined ? { req: consulta.dados.req } : { task: consulta.dados.task };
  // GM-14 T36 (furo 3): `libera` só na pergunta de liberação da task (o mesmo hash que `loop.mjs liberar` recalcula); em outra, recusa antes de gravar.
  if (r.libera !== undefined && (ancora.task === undefined || hashDaLiberacao(carregarPlano(c), eventos, ancora.task, c.raiz) !== hash)) {
    throw new Falha('libera_fora_da_liberacao', '`libera` só vale na decisão da pergunta de liberação do teto (`perguntar --task <t> --libera-teto`); nenhum arquivo e nenhum evento foram gravados');
  }

  // fontes e medição: ausente é ausente; presente e malformada é recusada (nunca gravada pela metade)
  let fontes;
  if (r.fontes !== undefined) {
    if (!Array.isArray(r.fontes) || r.fontes.length === 0 || !r.fontes.every(texto)) throw new Falha('sem_fonte', '`fontes` deve ser lista não vazia de textos não vazios');
    fontes = r.fontes;
  }
  let medicao;
  if (r.medicao !== undefined) {
    if (!texto(r.medicao)) throw new Falha('sem_fonte', '`medicao` deve ser texto não vazio');
    medicao = r.medicao;
  }
  const foraDaRegra = r.fora_da_regra === true;
  if (!foraDaRegra && fontes === undefined && medicao === undefined) throw new Falha('sem_fonte', 'decisão sem `fontes` nem `medicao`: sem fonte só vale `fora_da_regra: true` com a emenda que a cobre');

  if (foraDaRegra) {
    const reqsDaAncora = ancora.req !== undefined ? [ancora.req] : (carregarPlano(c).tasks.find((t) => t.id === ancora.task)?.reqs ?? []);
    const propostas = [...est.abertas, ...est.aprovadas, ...est.rejeitadas];
    const ok = typeof r.emenda_seq === 'number' && Number.isInteger(r.emenda_seq) && propostas.some((p) => p.seq === r.emenda_seq && reqsDaAncora.includes(p.req));
    if (!ok) throw new Falha('emenda_seq_inexistente', `\`emenda_seq\` ${JSON.stringify(r.emenda_seq)} não é de uma emenda.proposta (sessão emendas) de ${reqsDaAncora.join(', ') || '(nenhum REQ)'}`);
  }

  let substitui;
  if (r.substitui !== undefined) {
    const s = r.substitui;
    const alvo = ehObjeto(s)
      ? eventos.find((e) => e.sessao === s.sessao && e.seq === s.seq && e.tipo === 'decisao.sombra' && formaInvalida(e.tipo, e.dados) === null && e.dados.pergunta_hash === hash)
      : undefined;
    if (alvo === undefined) throw new Falha('substitui_inexistente', '`substitui` não aponta uma decisao.sombra do mesmo hash por {sessao, seq}');
    substitui = { sessao: s.sessao, seq: s.seq };
  }

  const nome = `${hash}.${sha(r.texto).slice(0, 12)}.resposta.md`;
  const arquivo = `.harness/entregas/${c.entrega}/sombra/${nome}`;
  try {
    mkdirSync(join(c.dirEntrega, 'sombra'), { recursive: true });
    try {
      writeFileSync(join(c.dirEntrega, 'sombra', nome), r.texto, { flag: 'wx' });
    } catch (e) {
      // mesmo conteúdo já gravado (retentativa) é aceito; outro conteúdo com o mesmo nome nunca é sobrescrito
      if (e.code !== 'EEXIST' || readFileSync(join(c.dirEntrega, 'sombra', nome), 'utf8') !== r.texto) throw e;
    }
  } catch (e) {
    throw new Falha('resposta_nao_gravada', `${nome} não gravado (${e.code ?? e.message}); nenhum evento foi gravado`);
  }

  const dados = {
    pergunta_hash: hash,
    ...(ancora.req !== undefined ? { req: ancora.req } : { task: ancora.task }),
    resposta: r.resposta,
    arquivo,
    pergunta_enviesada: r.pergunta_enviesada,
    ...(fontes !== undefined ? { fontes } : {}),
    ...(medicao !== undefined ? { medicao } : {}),
    ...(foraDaRegra ? { fora_da_regra: true, emenda_seq: r.emenda_seq } : {}),
    ...(substitui !== undefined ? { substitui } : {}),
    ...(r.libera !== undefined ? { libera: r.libera } : {}),
  };
  gravarEvento(c, 'decisao.sombra', dados);
  return { evento: { tipo: 'decisao.sombra', ...dados } };
}

// ─────────────────────────────────────────────────────────────── despacho

function executar(argv, cwd) {
  const { cmd, pos, flags } = lerArgs(argv);
  return cmd === 'perguntar' ? perguntar(cwd, flags) : registrar(cwd, pos, flags);
}

export function main(argv, cwd = process.cwd()) {
  let saida;
  let rc = 0;
  try {
    saida = { ok: true, ...executar(argv, cwd) };
  } catch (e) {
    if (e instanceof Falha) {
      saida = { ok: false, erro: e.erro, mensagem: e.message, ...e.extra };
      rc = e.rc;
    } else {
      saida = { ok: false, erro: 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
      rc = 1;
    }
  }
  process.stdout.write(`${JSON.stringify(saida)}\n`);
  return rc;
}

if (ehEntrypoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));

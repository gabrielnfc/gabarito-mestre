#!/usr/bin/env node
/**
 * REQ-LOOP-3 e REQ-LOOP-2 pela borda — `loop.mjs`: worktree por task, integração com gate e próxima ação.
 *
 *   loop.mjs proxima [--vivos <n>]    slots = `capacidade.mjs --medido`; `loop.slots` do config só reduz (sem calibração: 1 slot e aviso)
 *   loop.mjs abrir <task> | fechar <task> | integrar <task>
 *   loop.mjs iniciar <task> <implementador|revisor|correcao> | concluir <task> | reabrir <task>
 *   loop.mjs veredito <task> <APROVADO|REPROVADO> <rodada> <blocker> <major>
 *       REPROVADO exige achados não vazios em `<worktree>/.tmp-gabarito/review-r<rodada>.md` (senão `achados_ausentes`, nada gravado);
 *       `proxima` os aponta (`achados`) no item `correcao`: depois do /clear o arquivo é a única memória deles.
 *   loop.mjs parar <motivo>
 *   loop.mjs ci <verde|vermelho>
 *   todos aceitam --entrega <GM-10> (senão vem da branch); os que gravam aceitam --sessao <id> (padrão `loop`).
 *
 * CONTRATO DE FALHA. Saída é UMA linha de JSON em stdout, sempre com `ok`; falha traz `erro` (código) e `mensagem`.
 * Dado ausente, corrompido ou ferramenta falhando nunca vira sucesso; rc 0 só com o efeito feito. Uso errado sai 2.
 *
 * QUEM GRAVA NO DIÁRIO. Só `iniciar` (task.iniciada), `concluir` (task.concluida), `veredito` (review.veredito),
 * `reabrir` (task.reaberta, SÓ origem `retomada`: nenhum argumento produz `dono`), `integrar` (task.integrada),
 * `ci` (ci.resultado) e `parar` (loop.parar). `concluir` e `integrar` gravam o `sha`. `abrir` não grava no diário (grava a base em `branch.<branch>.gabaritoBase`)
 * e é idempotente: worktree registrada com HEAD na branch da task devolve o mesmo resultado com `ja_aberta: true`; qualquer outro estado recusa. Todo evento de task é conferido contra `TRANSICOES` ANTES de gravar:
 * o CLI nunca produz um diário que o núcleo recuse.
 *
 * Tudo que toca git vai por `execFileSync` com argv, sem shell. Nada é apagado por outro meio que `git worktree remove`
 * sem `--force`, `git branch -d` do que `abrir` acabou de criar e o `.tmp-gabarito` da própria worktree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint } from '../lib/cli.mjs';
import * as diario from '../dist/diario.js';
import { estadoDe, ordenar, podeIntegrar, proximaAcao } from '../dist/loop.js';
import { validarPlano } from '../dist/plano.js';
import { avaliar } from './gate-task.mjs';
import { clonar, nomeBanco, soltar, validarDb } from './db-template.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const NUM_RE = /^(0|[1-9]\d{0,14})$/;
const PAPEIS = ['implementador', 'revisor', 'correcao'];
const MOTIVOS = ['teto_rodadas', 'ci_vermelho', 'teto_tokens', 'sem_pouso', 'sem_progresso', 'diario_invalido', 'nao_conseguiu'];
const TIPOS_DE_TASK = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'];
const GLOB = /[*?[\]{}]/;
const TMP = '.tmp-gabarito';
const X_PADRAO = 50;
const SINAIS_NEUTROS = { slots: 1, percent: null, x: X_PADRAO, pausado: false, vivos: 0, tokens: null, tetoTokens: null, podePousar: false };
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

// ─────────────────────────────────────────────────────────────── git

function ambienteGit() {
  const env = { ...process.env };
  for (const k of GIT_REDIRECIONA) delete env[k];
  return env;
}

/** `git -C cwd <args>`; stdout com trim. Lança `Error` com `.saida` (primeira linha útil de stderr). */
function git(cwd, ...args) { return gitComEntrada(cwd, undefined, ...args); }

function gitComEntrada(cwd, input, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: ambienteGit(), maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    const texto = String(e.stderr ?? '').trim() || String(e.stdout ?? '').trim() || e.message;
    const erro = new Error(texto.split('\n').filter(Boolean).slice(-3).join(' / '));
    erro.saida = texto;
    throw erro;
  }
}

const gitOk = (cwd, ...args) => {
  try { git(cwd, ...args); return { ok: true }; } catch (e) { return { ok: false, motivo: e.message }; }
};

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

// ─────────────────────────────────────────────────────────────── entrada

/** Argumentos estritos. Flag desconhecida, sem valor ou repetida e posicional a mais ou a menos é uso (rc 2). */
function lerArgs(argv) {
  const [cmd, ...resto] = argv;
  const ESPEC = {
    proxima: { pos: 0, flags: ['entrega', 'vivos'] },
    abrir: { pos: 1, flags: ['entrega'] },
    fechar: { pos: 1, flags: ['entrega'] },
    integrar: { pos: 1, flags: ['entrega', 'sessao'] },
    iniciar: { pos: 2, flags: ['entrega', 'sessao'] },
    concluir: { pos: 1, flags: ['entrega', 'sessao'] },
    reabrir: { pos: 1, flags: ['entrega', 'sessao'] },
    veredito: { pos: 5, flags: ['entrega', 'sessao'] },
    parar: { pos: 1, flags: ['entrega', 'sessao'] },
    ci: { pos: 1, flags: ['entrega', 'sessao'] },
  };
  const uso = 'uso: loop.mjs proxima | abrir|fechar|integrar|concluir|reabrir <task> | iniciar <task> <papel> | veredito <task> <APROVADO|REPROVADO> <rodada> <blocker> <major> | parar <motivo> | ci <verde|vermelho>  [--entrega GM-10]';
  if (typeof cmd !== 'string' || !Object.hasOwn(ESPEC, cmd)) throw new Falha('uso', `comando desconhecido ou ausente. ${uso}`, {}, 2);
  const esp = ESPEC[cmd];
  const pos = [];
  const flags = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a.startsWith('--')) {
      const nome = a.slice(2);
      if (!esp.flags.includes(nome)) throw new Falha('uso', `argumento desconhecido para ${cmd}: ${a}. ${uso}`, {}, 2);
      const v = resto[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Falha('uso', `${a} sem valor. ${uso}`, {}, 2);
      if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${uso}`, {}, 2);
      flags[nome] = v;
      i++;
    } else {
      pos.push(a);
    }
  }
  if (pos.length !== esp.pos) throw new Falha('uso', `${cmd} espera ${esp.pos} argumento(s) posicional(is), veio ${pos.length}. ${uso}`, {}, 2);
  return { cmd, pos, flags };
}

/** Forma de tudo que vira caminho, branch ou argv: conferida ANTES de qualquer leitura ou efeito. */
function validarForma(cmd, pos, flags) {
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('entrega_invalida', `--entrega "${flags.entrega}" fora da forma ${ENTREGA_RE}`);
  if (flags.sessao !== undefined && !SESSAO_RE.test(flags.sessao)) throw new Falha('argumento_invalido', `--sessao fora da forma ${SESSAO_RE}`);
  if (cmd === 'proxima') {
    if (flags.vivos !== undefined && !NUM_RE.test(flags.vivos)) throw new Falha('argumento_invalido', `--vivos "${flags.vivos}": esperado inteiro >= 0`);
    return {};
  }
  if (cmd === 'parar') {
    if (!MOTIVOS.includes(pos[0])) throw new Falha('argumento_invalido', `motivo "${pos[0]}" fora da lista: ${MOTIVOS.join(', ')}`);
    return { motivo: pos[0] };
  }
  if (cmd === 'ci') {
    if (pos[0] !== 'verde' && pos[0] !== 'vermelho') throw new Falha('argumento_invalido', `ci "${pos[0]}": esperado verde ou vermelho`);
    return { verde: pos[0] === 'verde' };
  }
  const [task] = pos;
  if (typeof task !== 'string' || !ID_RE.test(task)) throw new Falha('id_invalido', `task ${JSON.stringify(task)} fora da forma ${ID_RE}`);
  if (cmd === 'iniciar' && !PAPEIS.includes(pos[1])) throw new Falha('papel_invalido', `papel "${pos[1]}" fora da lista: ${PAPEIS.join(', ')}`);
  if (cmd === 'veredito') {
    const [, v, rodada, blocker, major] = pos;
    if (v !== 'APROVADO' && v !== 'REPROVADO') throw new Falha('argumento_invalido', `veredito "${v}": esperado APROVADO ou REPROVADO`);
    if (!/^[1-9]\d{0,14}$/.test(rodada)) throw new Falha('argumento_invalido', `rodada "${rodada}": esperado inteiro >= 1`);
    for (const [nome, n] of [['blocker', blocker], ['major', major]]) {
      if (!NUM_RE.test(n)) throw new Falha('argumento_invalido', `${nome} "${n}": esperado inteiro >= 0`);
    }
    return { task, veredito: v, rodada: Number(rodada), blocker: Number(blocker), major: Number(major) };
  }
  return { task, papel: cmd === 'iniciar' ? pos[1] : undefined };
}

// ─────────────────────────────────────────────────────────────── contexto, plano, config, diário

function contexto(cwd, flags) {
  const raiz = raizPrincipal(cwd);
  let entrega = flags.entrega;
  if (entrega === undefined) {
    let branch = '';
    try { branch = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'); } catch { /* sem branch */ }
    entrega = /[A-Z]+-\d+/.exec(branch)?.[0];
    if (entrega === undefined || !ENTREGA_RE.test(entrega)) {
      throw new Falha('entrega_nao_inferida', `não achei a entrega na branch "${branch}"; passe --entrega <ID>`);
    }
  }
  const dirEntrega = diario.dirEntrega(raiz, entrega);
  return { cwd, raiz, entrega, dirEntrega, sessao: flags.sessao ?? 'loop' };
}

const normalizadoDb = (id) => id.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');

function carregarPlano(c) {
  const arq = join(c.dirEntrega, 'plano.json');
  const rel = relative(c.raiz, arq);
  let texto;
  try {
    texto = readFileSync(arq, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Falha('plano_ausente', `${rel} não existe: sem plano.json não há loop para esta entrega`);
    throw new Falha('plano_invalido', `${rel} ilegível (${e.code ?? e.message})`);
  }
  let bruto;
  try { bruto = JSON.parse(texto); } catch (e) { throw new Falha('plano_invalido', `${rel} não é JSON (${String(e.message).split('\n')[0]})`); }
  const v = validarPlano(bruto);
  if (!v.ok) throw new Falha('plano_invalido', `${rel}: ${v.erro}`);
  const plano = v.plano;
  if (plano.entrega !== c.entrega) throw new Falha('plano_invalido', `${rel}: entrega "${plano.entrega}" difere da pasta "${c.entrega}"`);
  const vistos = new Map();
  for (const t of plano.tasks) {
    if (!ID_RE.test(t.id)) throw new Falha('plano_invalido', `task ${JSON.stringify(t.id)} fora da forma ${ID_RE}: id vira branch, caminho e argv`);
    // APFS ignora caixa; o nome do banco ignora caixa e pontuação: dois ids que colidem em qualquer um dos dois são o mesmo recurso.
    for (const chave of [`caixa:${t.id.toLowerCase()}`, `banco:${normalizadoDb(t.id)}`]) {
      const outro = vistos.get(chave);
      if (outro !== undefined) throw new Falha('plano_invalido', `tasks ${outro} e ${t.id} colidem (${chave.split(':')[0] === 'caixa' ? 'mesmo nome em sistema de arquivos sem distinção de caixa' : 'mesmo nome de banco'})`);
      vistos.set(chave, t.id);
    }
    if (t.arquivos.length === 0) throw new Falha('plano_invalido', `task ${t.id} sem \`arquivos\`: escopo vazio não é escopo`);
    const glob = t.arquivos.find((a) => GLOB.test(a));
    if (glob !== undefined) throw new Falha('plano_invalido', `task ${t.id}: \`arquivos\` não aceita glob (${glob}); liste arquivos ou diretórios`);
  }
  return plano;
}

function tarefa(plano, id) {
  const t = plano.tasks.find((x) => x.id === id);
  if (!t) throw new Falha('task_fora_do_plano', `task ${id} não está no plano da entrega ${plano.entrega}`);
  return t;
}

/** `{cfg}`; ausente ⇒ `{cfg:null}`; ilegível ou de forma errada ⇒ falha (a config decide teto e banco: não adivinha). */
function lerConfig(raiz) {
  const f = join(raiz, 'harness.config.json');
  let texto;
  try {
    texto = readFileSync(f, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { cfg: null };
    throw new Falha('config_invalida', `harness.config.json ilegível (${e.code ?? e.message})`);
  }
  let cfg;
  try { cfg = JSON.parse(texto); } catch (e) { throw new Falha('config_invalida', `harness.config.json inválido (${String(e.message).split('\n')[0]})`); }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Falha('config_invalida', 'harness.config.json: a raiz não é um objeto');
  return { cfg };
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

/**
 * Leitura estrita: `diario.ler` descarta linha corrompida em silêncio, o que aqui viraria `concluir` sobre dado perdido.
 * Linha que não é objeto JSON, cadeia de hash quebrada e arquivo que não é regular ⇒ `diario_ilegivel`.
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

/** `parar{diario_invalido}` do núcleo = diário que a tabela recusa (a regra 1 vem antes de qualquer sinal). */
const diarioInvalido = (plano, eventos) => {
  const a = proximaAcao(plano, eventos, SINAIS_NEUTROS);
  return a.tipo === 'parar' && a.motivo === 'diario_invalido';
};

/**
 * Confere o evento contra a tabela e SÓ ENTÃO grava. O diário atual já inválido recusa (nada piora um diário quebrado);
 * a transição que a tabela não aceita recusa com a causa. Limite declarado: sem lock em volta do par ler+gravar, dois
 * CLIs simultâneos sobre a mesma task podem passar juntos pela conferência.
 */
function gravar(c, plano, tipo, dados, antes = () => {}) {
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega já não passa na tabela de transições; nada foi gravado');
  const ts = new Date().toISOString();
  const minhas = eventos.filter((e) => e.sessao === c.sessao).map((e) => e.seq);
  const candidato = {
    seq: (minhas.length ? Math.max(...minhas) : 0) + 1, ts, autor: 'desconhecido', sessao: c.sessao, agente: 'orquestrador', tipo, dados, hash_anterior: null,
  };
  if (TIPOS_DE_TASK.includes(tipo)) {
    const ord = ordenar(eventos);
    const fila = (ord.ok ? ord.eventos : []).filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === dados.task);
    const r = estadoDe([...fila, candidato]);
    if ('invalido' in r) {
      // Depois do /clear a rodada não está em lugar nenhum além do diário: a mensagem diz qual o diário espera.
      const esperada = r.invalido === 'rodada fora de sequência' ? estadoDe(fila) : null;
      const dica = esperada !== null && !('invalido' in esperada) ? ` (rodada esperada: ${esperada.rodada + 1})` : '';
      throw new Falha('transicao_invalida', `${tipo} não cabe na tabela para a task ${dados.task}: ${r.invalido}${dica}; nada foi gravado`);
    }
    if (diarioInvalido(plano, [...eventos, candidato])) throw new Falha('transicao_invalida', `${tipo} tornaria o diário inválido; nada foi gravado`);
  }
  antes(); // última conferência antes de gravar (depois da tabela: a causa mais fundamental vem primeiro)
  let autor = 'desconhecido';
  try { autor = git(c.raiz, 'config', 'user.email') || autor; } catch { /* sem user.email: o diário aceita "desconhecido" */ }
  const r = diario.append(c.dirEntrega, c.sessao, { ts, autor, sessao: c.sessao, agente: 'orquestrador', tipo, dados });
  if (!r.ok) throw new Falha('evento_nao_gravado', `${tipo} não gravado: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `${tipo} recusado pelo canário do diário`);
  return { tipo, ...dados };
}

// ─────────────────────────────────────────────────────────────── worktrees

const caminhoWt = (c, task) => join(c.raiz, '.harness', 'worktrees', task);
const ramo = (c, task) => `wt/${c.entrega}-${task}`;

function worktreesRegistradas(raiz) {
  const saida = git(raiz, 'worktree', 'list', '--porcelain');
  const caminhos = [];
  for (const l of saida.split('\n')) {
    if (!l.startsWith('worktree ')) continue;
    const p = l.slice(9);
    try { caminhos.push(realpathSync(p)); } catch { caminhos.push(p); }
  }
  return caminhos;
}

function worktreeViva(c, task) {
  const p = caminhoWt(c, task);
  if (!existsSync(p)) throw new Falha('worktree_ausente', `não há worktree em ${relative(c.raiz, p)}; rode abrir ${task}`);
  if (!worktreesRegistradas(c.raiz).includes(realpathSync(p))) throw new Falha('worktree_ausente', `${relative(c.raiz, p)} existe mas o git não a conhece como worktree`);
  return p;
}

function ramoDoPrincipal(raiz) {
  try {
    return git(raiz, 'symbolic-ref', '-q', '--short', 'HEAD');
  } catch {
    throw new Falha('principal_sem_branch', 'a worktree principal está em HEAD solto: não há branch do PBI para basear nem receber a task');
  }
}

/** Sem seguir symlink: `.tmp-gabarito` e o `.gitignore` dele têm de ser o que o `abrir` cria (diretório e arquivo comuns). */
function garantirTmp(wt) {
  let tmp = validarTmp(wt);
  if (tmp === null) {
    tmp = join(wt, TMP);
    mkdirSync(tmp);
  }
  // O `*` dentro do próprio diretório o ignora (e ao próprio arquivo) sem tocar `.gitignore` versionado nem `info/exclude` compartilhado.
  const ign = join(tmp, '.gitignore');
  const st = lstatOuNull(ign);
  if (st === null) writeFileSync(ign, '*\n');
  else if (!st.isFile()) throw new Falha('tmpdir_invalido', `${TMP}/.gitignore não é um arquivo comum (symlink ou diretório); recusado, nada foi escrito`);
  return tmp;
}

function lstatOuNull(p) {
  try {
    return lstatSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Falha('tmpdir_invalido', `${basename(p)} ilegível (${e.code ?? e.message}); nada foi escrito`);
  }
}

/**
 * `abrir` repetido (depois do /clear o modelo não sabe se já abriu). Só é "já aberta" a worktree que o git REGISTRA no caminho
 * da task E cujo HEAD está na branch da task. Pasta comum, worktree com HEAD solto ou em outra branch, e branch sem worktree
 * não são: seguem recusadas como `branch_existe`. Não toca no trabalho; só garante o `.tmp-gabarito`, que `veredito` e `proxima` usam.
 * Limite declarado: o banco da task não é conferido aqui (o nome vem de `nomeBanco`; `fechar` o solta).
 */
function jaAberta(c, task, branch, v) {
  const caminho = caminhoWt(c, task);
  let base;
  try {
    if (!existsSync(caminho)) return null;
    if (!worktreesRegistradas(c.raiz).includes(realpathSync(caminho))) return null;
    if (git(caminho, 'symbolic-ref', '-q', 'HEAD') !== `refs/heads/${branch}`) return null;
    base = git(c.raiz, 'config', '--get', `branch.${branch}.gabaritoBase`);
  } catch {
    return null; // não dá para provar que é a nossa: recusa como antes
  }
  const tmp = garantirTmp(caminho); // é a nossa: symlink em `.tmp-gabarito` recusa com motivo (tmpdir_invalido), nada escrito fora
  return { task, branch, base, worktree: caminho, tmpdir: tmp, env: { TMPDIR: tmp }, banco: v.na ? 'n/a' : nomeBanco(c.entrega, task), ja_aberta: true };
}

function abrir(c, plano, task) {
  tarefa(plano, task);
  const { cfg } = lerConfig(c.raiz);
  const v = validarDb(cfg ?? {});
  if (!v.ok) throw new Falha('db_invalido', v.erro);
  const base = ramoDoPrincipal(c.raiz);
  const branch = ramo(c, task);
  const existentes = git(c.raiz, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean);
  if (existentes.includes(branch)) {
    const ja = jaAberta(c, task, branch, v);
    if (ja !== null) return ja;
  }
  if (existentes.some((b) => b.toLowerCase() === branch.toLowerCase())) throw new Falha('branch_existe', `a branch ${branch} já existe (ou colide por caixa); abrir não toca no que existe`);
  const pasta = join(c.raiz, '.harness', 'worktrees');
  const caminho = caminhoWt(c, task);
  if (existsSync(pasta) && readdirSync(pasta).some((n) => n.toLowerCase() === task.toLowerCase())) {
    throw new Falha('worktree_existe', `já existe ${relative(c.raiz, join(pasta, task))} (ou colide por caixa); abrir não toca no que existe`);
  }
  mkdirSync(pasta, { recursive: true });
  try {
    git(c.raiz, 'worktree', 'add', '-b', branch, caminho, git(c.raiz, 'rev-parse', 'HEAD'));
  } catch (e) {
    throw new Falha('worktree_falhou', `git worktree add falhou: ${e.message}`);
  }
  let banco = 'n/a';
  let clonado = false;
  try {
    if (!v.na) {
      banco = clonar(v.db, c.entrega, task).banco;
      clonado = true;
    }
    garantirTmp(caminho);
    git(c.raiz, 'config', `branch.${branch}.gabaritoBase`, base);
  } catch (e) {
    const restos = [];
    if (clonado) {
      try { soltar(v.db, c.entrega, task); } catch (e2) { restos.push(`banco ${banco} (${e2.message})`); }
    }
    const rem = gitOk(c.raiz, 'worktree', 'remove', caminho);
    if (!rem.ok) restos.push(`worktree ${relative(c.raiz, caminho)} (${rem.motivo})`);
    else {
      const br = gitOk(c.raiz, 'branch', '-d', branch);
      if (!br.ok) restos.push(`branch ${branch} (${br.motivo})`);
    }
    const causa = e instanceof Error ? e.message : String(e);
    throw new Falha(
      clonado || !v.na ? 'banco_falhou' : 'tmpdir_falhou',
      restos.length === 0
        ? `abrir falhou (${causa}); a worktree e a branch ${branch} criadas agora foram desfeitas`
        : `abrir falhou (${causa}); NÃO consegui desfazer tudo, ficou: ${restos.join('; ')}. Branch criada: ${branch}`,
      { desfeito: restos.length === 0, branch, worktree: caminho, restos },
    );
  }
  const tmp = join(caminho, TMP);
  return { task, branch, base, worktree: caminho, tmpdir: tmp, env: { TMPDIR: tmp }, banco };
}

const caminhoAchados = (wt, rodada) => join(wt, TMP, `review-r${rodada}.md`);

/** Achados de uma rodada: arquivo regular (lstat: symlink e diretório não valem) com texto além de espaço. */
function achadosLegiveis(arq) {
  try {
    if (!lstatSync(dirname(arq)).isDirectory()) return false; // lstat: `.tmp-gabarito` symlink (para fora) não vale
    if (!lstatSync(arq).isFile()) return false;
    return readFileSync(arq, 'utf8').trim() !== '';
  } catch {
    return false;
  }
}

/** Confere, sem apagar nada, que `.tmp-gabarito` é um diretório comum (lstat: symlink e arquivo são recusados). `null` = não existe. */
function validarTmp(wt) {
  const p = join(wt, TMP);
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Falha('tmpdir_invalido', `${TMP} ilegível (${e.code ?? e.message}); nada foi apagado`);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Falha('tmpdir_invalido', `${TMP} não é um diretório comum (symlink ou arquivo); recusado, nada foi apagado`);
  return p;
}

/** Sujeira lida sempre igual, sem depender de `status.showUntrackedFiles` do usuário: modificado, `??` e ignorado (`!!`). */
const STATUS_SUJEIRA = ['status', '--porcelain', '--untracked-files=normal', '--ignored', '--ignore-submodules=none'];

function fechar(c, task) {
  const wt = worktreeViva(c, task);
  const tmpValido = validarTmp(wt);
  try {
    git(wt, 'symbolic-ref', '-q', 'HEAD');
  } catch {
    throw new Falha('head_solto', `a worktree ${task} está em HEAD solto: um commit nela não pertence a branch nenhuma e se perderia; foi MANTIDA, junto do banco`);
  }
  const linhasStatus = git(wt, ...STATUS_SUJEIRA).split('\n').filter(Boolean);
  const sujas = linhasStatus.filter((l) => !l.startsWith('!! '));
  if (sujas.length > 0) {
    throw new Falha('worktree_suja', `a worktree ${task} tem ${sujas.length} item(ns) não commitado(s) ou não rastreado(s) e foi MANTIDA, junto do banco: ${sujas.slice(0, 10).join(' | ')}`, { sujeira: sujas.slice(0, 20) });
  }
  // Ignorado é regenerável (o repo o declarou em .gitignore): sai com a worktree e é relatado, nunca em silêncio.
  const ignorados = linhasStatus.filter((l) => l.startsWith('!! ') && l.slice(3).replace(/\/$/, '') !== TMP).map((l) => l.slice(3));
  const { cfg } = lerConfig(c.raiz);
  const v = validarDb(cfg ?? {});
  if (!v.ok) throw new Falha('db_invalido', v.erro);
  let banco = 'n/a';
  if (!v.na) {
    try {
      banco = soltar(v.db, c.entrega, task).estado;
    } catch (e) {
      throw new Falha('banco_nao_solto', `o banco da task ${task} não foi solto (${e.message}); a worktree foi mantida`);
    }
  }
  if (tmpValido !== null) {
    try {
      rmSync(tmpValido, { recursive: true });
    } catch (e) {
      throw new Falha('tmpdir_falhou', `não consegui apagar ${TMP}: ${e.code ?? e.message}; a worktree foi mantida`, { banco });
    }
  }
  try {
    git(c.raiz, 'worktree', 'remove', wt);
  } catch (e) {
    throw new Falha('remove_falhou', `git worktree remove (sem --force) recusou: ${e.message}; a worktree foi mantida`, { banco });
  }
  if (existsSync(wt)) throw new Falha('remove_falhou', `git worktree remove saiu sem erro, mas ${relative(c.raiz, wt)} continua existindo`, { banco });
  return { task, worktree: wt, removida: true, banco, ignorados_removidos: ignorados };
}

function carregarMutacoes(c, t) {
  if (t.mutacoes === undefined) return undefined;
  const arq = resolve(c.raiz, t.mutacoes);
  const rel = relative(c.raiz, arq);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Falha('mutacoes_invalidas', `mutacoes "${t.mutacoes}" aponta para fora da raiz do repositório`);
  let lista;
  try {
    if (!statSync(arq).isFile()) throw new Error('não é arquivo');
    lista = JSON.parse(readFileSync(arq, 'utf8'));
  } catch (e) {
    throw new Falha('mutacoes_invalidas', `mutacoes ${t.mutacoes}: ${e.code ?? e.message}`);
  }
  if (!Array.isArray(lista) || lista.length === 0) throw new Falha('mutacoes_invalidas', `mutacoes ${t.mutacoes}: esperado lista não vazia`);
  return lista;
}

/** Diretório vira `dir/`; arquivo fica exato. O gate trata `dir` sem barra como arquivo, e `dir` como arquivo reprovaria o que está dentro. */
function escopo(wt, arquivos) {
  return arquivos.map((a) => {
    try { return statSync(join(wt, a)).isDirectory() ? `${a}/` : a; } catch { return a; }
  });
}

function suitesDaTask(wt, t) {
  if (t.teste_afetado === undefined) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(join(wt, 'harness.config.json'), 'utf8'));
    const base = cfg?.gates?.suites;
    return Array.isArray(base) ? [...base, { nome: 'teste_afetado', cmd: t.teste_afetado }] : undefined;
  } catch {
    return undefined; // o gate lê o mesmo arquivo e reprova com a causa
  }
}

/**
 * `integrar` é tudo ou nada na branch: a falha depois de mexer nela (rebase, gate, merge) devolve `refs/heads/<branch>`
 * ao commit revisado, para a próxima `integrar` não cair em `commit_nao_revisado`. Decide pelo ESTADO medido, não pelo erro:
 * (1) commit que o gate deixou na branch (topo diferente do alvo que ele avaliou) vai antes para `wt-preservado/*`, e se isso falha
 * nada é movido; (2) HEAD na branch da task: `reset --keep`; (3) HEAD em outra branch ou solto: o HEAD não é tocado, só a ref
 * volta, com troca condicional. Só `merge_nao_confirmado` (o merge pode ter entrado) fica sem volta. Commit em ref ou no HEAD ao fim da suíte
 * segue alcançável em toda saída; commit que a própria suíte abandonou antes de terminar está fora.
 */
function devolver(c, wt, branch, revisado, alvo, e) {
  if (!(e instanceof Falha) || e.erro === 'merge_nao_confirmado') return e;
  if (e.erro === 'rebase_conflito' && e.extra?.abortado === false) {
    e.message += `; a ${branch} não foi movida pelo rebase (segue em ${revisado.slice(0, 12)}), mas a worktree continua em rebase`;
    return e;
  }
  const motivos = [];
  const extra = { ...e.extra };
  const ref = `refs/heads/${branch}`;
  let topo = '';
  try { topo = git(wt, 'rev-parse', ref); } catch (e1) { motivos.push(`rev-parse ${ref}: ${String(e1.message ?? e1)}`); }
  let preservadoOk = topo !== '';
  const preservar = (sha) => {
    const nome = `wt-preservado/${c.entrega}-${c.taskDevolvida}-${sha.slice(0, 12)}`;
    const pr = gitOk(wt, 'branch', nome, sha);
    let existe = false;
    if (!pr.ok) { try { existe = git(wt, 'rev-parse', `refs/heads/${nome}`) === sha; } catch { /* sem a branch */ } }
    if (pr.ok || existe) return nome;
    preservadoOk = false;
    motivos.push(`não consegui preservar o commit ${sha.slice(0, 12)} em ${nome}: ${pr.motivo}`);
    return undefined;
  };
  if (topo !== '' && topo !== revisado && topo !== alvo) {
    extra.preservado = preservar(topo);
    if (extra.preservado !== undefined) extra.topo = topo;
  }
  let cabeca = '';
  try { cabeca = git(wt, 'symbolic-ref', '-q', 'HEAD'); } catch { /* solto */ }
  if (cabeca === '') {
    // HEAD solto: nenhuma branch segura o que ele aponta, e `git checkout` da saída o abandonaria.
    let solto = '';
    try { solto = git(wt, 'rev-parse', 'HEAD'); } catch (e2) { preservadoOk = false; motivos.push(`rev-parse HEAD: ${String(e2.message ?? e2)}`); }
    if (solto !== '' && solto !== topo) {
      extra.preservado_solto = preservar(solto);
      if (extra.preservado_solto !== undefined) extra.topo_solto = solto;
    }
  }
  let confere = false;
  if (preservadoOk) {
    if (cabeca === ref) {
      const rs = gitOk(wt, 'reset', '--keep', revisado);
      if (!rs.ok) motivos.push(`reset --keep: ${rs.motivo}`);
      try {
        confere = git(wt, 'rev-parse', ref) === revisado && git(wt, 'rev-parse', 'HEAD') === revisado && git(wt, 'symbolic-ref', '-q', 'HEAD') === ref;
      } catch (e3) {
        motivos.push(String(e3.message ?? e3));
      }
    } else {
      const ur = gitOk(wt, 'update-ref', ref, revisado, topo);
      if (!ur.ok) motivos.push(`update-ref: ${ur.motivo}`);
      let refVoltou = false;
      try { refVoltou = git(wt, 'rev-parse', ref) === revisado; } catch (e3) { motivos.push(String(e3.message ?? e3)); }
      extra.branch_voltou = refVoltou;
      extra.head_em = cabeca === '' ? 'solto' : cabeca;
    }
  }
  extra.voltou = confere;
  let cita = extra.preservado ? `; o commit ${topo.slice(0, 12)} que não foi revisado foi preservado em ${extra.preservado}` : '';
  if (extra.preservado_solto) cita += `; o commit ${extra.topo_solto.slice(0, 12)} do HEAD solto foi preservado em ${extra.preservado_solto}`;
  if (confere) {
    e.message += `; a ${branch} voltou ao commit revisado ${revisado.slice(0, 12)}${cita}`;
  } else if (extra.head_em !== undefined) {
    e.message += `; o HEAD da worktree está em ${extra.head_em}, não na ${branch}: NÃO foi tocado; a ${branch} ${extra.branch_voltou ? 'voltou' : 'NÃO voltou'} ao commit revisado ${revisado.slice(0, 12)}${cita}; faça \`git checkout ${branch}\` com a árvore limpa e repita integrar${motivos.length ? ` (${motivos.join(' / ')})` : ''}`;
  } else {
    e.message += `; E a volta da ${branch} ao commit revisado ${revisado.slice(0, 12)} FALHOU (${motivos.join(' / ') || 'a branch não está no commit revisado'})${cita}: confira à mão${extra.preservado || extra.preservado_solto ? '' : ', nada foi movido ou apagado por esta volta'}`;
  }
  e.extra = extra;
  return e;
}

async function integrar(c, plano, task) {
  const t = tarefa(plano, task);
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições; integrar recusado');
  if (!podeIntegrar(plano, eventos, task)) throw new Falha('nao_integravel', `a task ${task} não está aprovada com toda a cadeia de dependências integrada`, { merge: false, evento: false });
  const wt = worktreeViva(c, task);
  const sujo = git(wt, ...STATUS_SUJEIRA).split('\n').filter((l) => l !== '' && !l.startsWith('!! '));
  if (sujo.length > 0) throw new Falha('worktree_suja', `a worktree ${task} tem trabalho não commitado ou não rastreado; nada foi feito: ${sujo.slice(0, 10).join(' | ')}`, { merge: false, evento: false });
  const branch = ramo(c, task);
  const nada = { merge: false, evento: false };

  // O que o gate aprova é exatamente o que entra: a base vem do `abrir`, o HEAD é a branch da task e o commit é o que o revisor viu.
  let baseGravada = '';
  try { baseGravada = git(c.raiz, 'config', '--get', `branch.${branch}.gabaritoBase`); } catch { /* ausente */ }
  if (baseGravada === '') throw new Falha('base_divergente', `a base de ${branch} não está gravada (branch.${branch}.gabaritoBase): não sei onde integrar; nada foi feito`, nada);
  const base = ramoDoPrincipal(c.raiz);
  if (base !== baseGravada) throw new Falha('base_divergente', `a worktree principal está em ${base}, mas ${branch} foi aberta sobre ${baseGravada}; nada foi feito`, nada);
  let cabeca = '';
  try { cabeca = git(wt, 'symbolic-ref', '-q', 'HEAD'); } catch { /* solto */ }
  if (cabeca !== `refs/heads/${branch}`) throw new Falha('head_divergente', `o HEAD da worktree ${task} é ${cabeca === '' ? 'solto' : cabeca}, não refs/heads/${branch}: o que o gate avaliaria não é o que entraria; nada foi feito`, nada);
  const ord = ordenar(eventos);
  const concluidas = (ord.ok ? ord.eventos : []).filter((e) => e.tipo === 'task.concluida' && e.dados?.task === task);
  const revisado = concluidas.at(-1)?.dados?.sha;
  const atual = git(wt, 'rev-parse', `refs/heads/${branch}`);
  if (typeof revisado !== 'string' || revisado !== atual) {
    throw new Falha('commit_nao_revisado', `o HEAD de ${branch} (${atual.slice(0, 12)}) não é o commit de task.concluida (${typeof revisado === 'string' ? revisado.slice(0, 12) : 'sem sha'}): há commit que ninguém revisou; nada foi feito`, nada);
  }
  const mutacoes = carregarMutacoes(c, t);
  let alvo;
  try {
    try {
      git(wt, 'rebase', `refs/heads/${base}`);
    } catch (e) {
      const gitDir = (n) => resolve(wt, git(wt, 'rev-parse', '--git-path', n));
      const emCurso = ['rebase-merge', 'rebase-apply'].some((n) => existsSync(gitDir(n)));
      if (!emCurso) throw new Falha('rebase_falhou', `git rebase falhou sem deixar rebase em curso: ${e.message}`, nada);
      const ab = gitOk(wt, 'rebase', '--abort');
      throw new Falha(
        'rebase_conflito',
        ab.ok
          ? `rebase da ${branch} sobre ${base} deu conflito e foi abortado; a task NÃO foi integrada: ${e.message}`
          : `rebase da ${branch} sobre ${base} deu conflito e \`git rebase --abort\` FALHOU (${ab.motivo}); a worktree ${relative(c.raiz, wt)} segue em rebase, nada foi apagado: resolva ou aborte à mão`,
        { ...nada, abortado: ab.ok },
      );
    }
    alvo = git(wt, 'rev-parse', 'HEAD');

    const tmp = garantirTmp(wt);
    process.env.TMPDIR = tmp;
    let r;
    try {
      r = await avaliar({ wt, base: `refs/heads/${base}`, card: c.entrega, files: escopo(wt, t.arquivos), mutacoes, suites: suitesDaTask(wt, t) });
    } catch (e) {
      throw new Falha('gate_erro', `o gate falhou ao rodar: ${e.message}; sem merge nem evento`, nada);
    }
    if (r.reprova > 0) {
      throw new Falha('gate_reprovado', `gate reprovado (${r.reprova}); sem merge nem evento`, { ...nada, relato: r.relato });
    }
    if (git(wt, 'rev-parse', 'HEAD') !== alvo || git(wt, 'rev-parse', `refs/heads/${branch}`) !== alvo) {
      throw new Falha('head_mudou', `o HEAD da ${branch} mudou entre o gate (${alvo.slice(0, 12)}) e o merge: o gate não viu o que entraria; sem merge nem evento`, nada);
    }
    if (ramoDoPrincipal(c.raiz) !== base) throw new Falha('base_divergente', `a worktree principal deixou ${base} antes do merge; sem merge nem evento`, nada);

    const baseAntes = git(c.raiz, 'rev-parse', `refs/heads/${base}`);
    let saidaMerge;
    try {
      saidaMerge = git(c.raiz, 'merge', '--ff-only', alvo);
    } catch (e) {
      throw new Falha('merge_falhou', `git merge --ff-only da ${branch} em ${base} falhou: ${e.message}; sem evento`, nada);
    }
    let baseDepois;
    try {
      baseDepois = git(c.raiz, 'rev-parse', `refs/heads/${base}`);
    } catch (e) {
      throw new Falha('merge_nao_confirmado', `não consegui conferir ${base} depois do merge (${e.message}); sem evento`, { merge: null, evento: false });
    }
    if (baseDepois !== alvo || baseAntes === alvo || /already up to date/i.test(saidaMerge)) {
      throw new Falha('merge_sem_efeito', `o merge de ${alvo.slice(0, 12)} não mudou ${base} (antes ${baseAntes.slice(0, 12)}, depois ${baseDepois.slice(0, 12)}); sem evento`, nada);
    }
  } catch (e) {
    throw devolver({ ...c, taskDevolvida: task }, wt, branch, revisado, alvo, e);
  }

  try {
    gravar(c, plano, 'task.integrada', { task, sha: alvo });
  } catch (e) {
    const causa = e instanceof Falha ? `${e.erro}: ${e.message}` : String(e.message ?? e);
    throw new Falha('evento_nao_gravado', `o merge da ${branch} ENTROU em ${base}, mas o evento task.integrada NÃO foi gravado (${causa}); fechar não foi chamado`, { merge: true, evento: false });
  }
  let fechada;
  try {
    fechada = fechar(c, task);
  } catch (e) {
    const causa = e instanceof Falha ? `${e.erro}: ${e.message}` : String(e.message ?? e);
    throw new Falha('fechar_falhou', `o merge entrou e o evento task.integrada foi gravado, mas fechar falhou (${causa})`, { merge: true, evento: true, causa: e.erro });
  }
  return { task, branch, base, merge: true, evento: true, fechada: true, banco: fechada.banco, ignorados_removidos: fechada.ignorados_removidos };
}

// ─────────────────────────────────────────────────────────────── proxima

function inteiroPositivo(v) {
  return Number.isSafeInteger(v) && v >= 1;
}

const CAPACIDADE_CLI = join(dirname(fileURLToPath(import.meta.url)), 'capacidade.mjs');
const CAPACIDADE_TIMEOUT_MS = 30_000;

/**
 * Slots da máquina: a saída de `capacidade.mjs --medido --json` (REQ-SLOT-1). Medição falhando, comando que não roda, saída que
 * não é JSON ou `slots` que não é inteiro >= 1 ⇒ 1 slot e aviso; nunca um número alto por omissão. `rodar` é injetável nos testes.
 */
export function slotsDaCapacidade(raiz, rodar = (args, opts) => spawnSync(process.execPath, args, opts)) {
  const um = (aviso) => ({ slots: 1, aviso: `slots: 1 slot, ${aviso}` });
  let r;
  try {
    r = rodar([CAPACIDADE_CLI, '--medido', '--json', '--root', raiz], { cwd: raiz, encoding: 'utf8', timeout: CAPACIDADE_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  } catch (e) {
    return um(`capacidade.mjs não rodou (${e.message})`);
  }
  if (r.error) return um(`capacidade.mjs não rodou (${r.error.message})`);
  if (r.signal) return um(`capacidade.mjs morreu por sinal ${r.signal}`);
  if (r.status !== 0) return um(`capacidade.mjs saiu com rc ${r.status}${r.stderr ? ` (${String(r.stderr).trim().split('\n')[0]})` : ''}`);
  let j;
  try { j = JSON.parse(String(r.stdout)); } catch { return um('saída de capacidade.mjs não é JSON'); }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return um('saída de capacidade.mjs não é um objeto JSON');
  if (!inteiroPositivo(j.slots)) return um(`capacidade.mjs devolveu slots inválido (${JSON.stringify(j.slots)}): esperado inteiro >= 1`);
  // Redução (memória, disco, carga) traz o motivo: `motivo` que não começa por `slots_max` vira aviso, somado ao que já havia.
  // `motivo` ausente ou não texto não lança e não muda `slots`.
  const avisos = [];
  if (typeof j.aviso === 'string' && j.aviso !== '') avisos.push(`slots: ${j.aviso}`);
  if (typeof j.motivo === 'string' && j.motivo !== '' && !j.motivo.startsWith('slots_max')) avisos.push(`slots: ${j.slots}, ${j.motivo}`);
  return { slots: j.slots, aviso: avisos.length > 0 ? avisos.join('; ') : null };
}

function sinaisDe(c, cfg, eventos, flags) {
  const aviso = [];
  const loopBruto = cfg?.loop;
  const loop = loopBruto !== null && typeof loopBruto === 'object' && !Array.isArray(loopBruto) ? loopBruto : {};
  // A fonte dos slots é a medição. `loop.slots` do config só REDUZ: valor ausente não muda nada; presente e inválido
  // (inclusive `loop` que não é objeto) vale 1 slot e aviso, nunca a medição inteira.
  const medido = slotsDaCapacidade(c.raiz);
  if (medido.aviso) aviso.push(medido.aviso);
  let slots = medido.slots;
  const slotsCfg = Object.hasOwn(loop, 'slots') ? loop.slots : undefined;
  if (cfg !== null && cfg !== undefined && loopBruto !== undefined && loop !== loopBruto) {
    slots = 1;
    aviso.push('loop.slots ilegível: `loop` em harness.config.json não é um objeto; 1 slot, a medição não vence config ilegível');
  } else if (slotsCfg !== undefined) {
    if (inteiroPositivo(slotsCfg)) slots = Math.min(slots, slotsCfg);
    else { slots = 1; aviso.push('loop.slots inválido em harness.config.json (esperado inteiro >= 1): 1 slot'); }
  }

  let tetoTokens = null;
  if (Object.hasOwn(loop, 'tetoTokens')) {
    if (!inteiroPositivo(loop.tetoTokens)) throw new Falha('config_invalida', 'loop.tetoTokens inválido: esperado inteiro >= 1 (um teto ilegível não pode virar "sem teto")');
    tetoTokens = loop.tetoTokens;
  }

  // Tokens gastos = entrada + saída + criação de cache de todo `custo.medicao`; leitura de cache não conta (é o que o cache poupa).
  let tokens = null;
  for (const e of eventos) {
    if (e.tipo !== 'custo.medicao') continue;
    let soma = 0;
    for (const campo of ['input_tokens', 'output_tokens', 'cache_creation', 'cache_read']) {
      const n = e.dados?.[campo];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Falha('diario_invalido', `custo.medicao com ${campo} inválido (${JSON.stringify(n)}): o teto de tokens não pode ser conferido`);
      if (campo !== 'cache_read') soma += n;
    }
    tokens = (tokens ?? 0) + soma;
  }

  let vivos = 0;
  if (flags.vivos !== undefined) vivos = Number(flags.vivos);
  else aviso.push('--vivos ausente: assumido 0 (o orquestrador conhece os agentes vivos; o diário não)');

  const xEnv = process.env.GABARITO_POUSO_X;
  const x = xEnv !== undefined && /^\d{1,3}$/.test(xEnv) && Number(xEnv) >= 1 && Number(xEnv) <= 100 ? Number(xEnv) : X_PADRAO;

  let pausado = existsSync(join(c.raiz, '.harness', 'PAUSAR'));
  try {
    const topo = git(c.cwd, 'rev-parse', '--show-toplevel');
    if (existsSync(join(topo, '.harness', 'PAUSAR'))) pausado = true;
  } catch { /* o principal já foi conferido */ }

  return { sinais: { slots, percent: null, x, pausado, vivos, tokens, tetoTokens, podePousar: false }, aviso };
}

function proxima(c, plano, flags) {
  const { cfg } = lerConfig(c.raiz);
  const eventos = lerDiarioEstrito(c.dirEntrega);
  const { sinais, aviso } = sinaisDe(c, cfg, eventos, flags);
  if (cfg === null) aviso.push('harness.config.json ausente');
  const acao = proximaAcao(plano, eventos, sinais);
  if (acao.tipo === 'parar' && acao.motivo === 'diario_invalido') {
    throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições (evento fora de ordem ou de task desconhecida)', { acao, sinais });
  }
  return { acao: acao.tipo === 'despachar' ? { ...acao, itens: acao.itens.map((i) => enriquecer(c, plano, eventos, i, aviso)) } : acao, sinais, ...(aviso.length ? { aviso } : {}) };
}

/**
 * O item de despacho carrega o que o /clear apaga: `spec` (ponteiro do topo do plano) e, na `correcao`, `achados` (caminho do arquivo da
 * rodada reprovada). Arquivo ausente ou vazio não vira caminho: `achados: null` e aviso (o orquestrador não manda corrigir às cegas).
 */
function enriquecer(c, plano, eventos, item, aviso) {
  const saida = { ...item, ...(typeof plano.spec === 'string' ? { spec: plano.spec } : {}) };
  if (item.papel !== 'correcao') return saida;
  const ord = ordenar(eventos);
  const reprovado = (ord.ok ? ord.eventos : []).filter((e) => e.tipo === 'review.veredito' && e.dados?.task === item.task && e.dados?.veredito === 'REPROVADO').at(-1);
  const arq = Number.isInteger(reprovado?.dados?.rodada) ? caminhoAchados(caminhoWt(c, item.task), reprovado.dados.rodada) : null;
  if (arq !== null && achadosLegiveis(arq)) return { ...saida, achados: arq };
  aviso.push(`achados da task ${item.task} ausentes ou vazios${arq === null ? '' : ` em ${relative(c.raiz, arq)}`}: o revisor precisa regravá-los antes da correção`);
  return { ...saida, achados: null };
}

// ─────────────────────────────────────────────────────────────── despacho

async function executar(argv, cwd) {
  const { cmd, pos, flags } = lerArgs(argv);
  const forma = validarForma(cmd, pos, flags);
  const c = contexto(cwd, flags);
  if (cmd === 'parar') return { ...gravarSemPlano(c, 'loop.parar', { motivo: forma.motivo }) };
  const plano = carregarPlano(c);
  const { task } = forma;
  switch (cmd) {
    case 'proxima': return proxima(c, plano, flags);
    case 'abrir': return abrir(c, plano, task);
    case 'fechar': tarefa(plano, task); return fechar(c, task);
    case 'integrar': return integrar(c, plano, task);
    case 'iniciar':
      tarefa(plano, task);
      worktreeViva(c, task);
      return { evento: gravar(c, plano, 'task.iniciada', { task, papel: forma.papel }) };
    case 'concluir': {
      tarefa(plano, task);
      const wt = worktreeViva(c, task);
      const sha = git(wt, 'rev-parse', `refs/heads/${ramo(c, task)}`);
      return { evento: gravar(c, plano, 'task.concluida', { task, sha }) };
    }
    case 'ci': return { evento: gravar(c, plano, 'ci.resultado', { verde: forma.verde }) };
    case 'veredito': {
      tarefa(plano, task);
      // REPROVADO sem achados no disco manda uma correção às cegas, e o /clear apaga o que o revisor disse: exige o arquivo.
      const wt = forma.veredito === 'REPROVADO' ? worktreeViva(c, task) : null;
      const exigirAchados = () => {
        if (wt === null) return;
        const arq = caminhoAchados(wt, forma.rodada);
        if (!achadosLegiveis(arq)) {
          throw new Falha('achados_ausentes', `REPROVADO exige os achados em ${relative(c.raiz, arq)} (arquivo não vazio); grave-os e repita o veredito; nada foi gravado`, { achados: arq });
        }
      };
      return { evento: gravar(c, plano, 'review.veredito', { task, veredito: forma.veredito, rodada: forma.rodada, blocker: forma.blocker, major: forma.major }, exigirAchados) };
    }
    case 'reabrir': tarefa(plano, task); return { evento: gravar(c, plano, 'task.reaberta', { task, origem: 'retomada' }) };
    default: throw new Falha('uso', `comando desconhecido: ${cmd}`, {}, 2);
  }
}

/** `parar` é o registro de que o loop parou, inclusive por diário inválido: não confere o diário nem o plano, só grava. */
function gravarSemPlano(c, tipo, dados) {
  let autor = 'desconhecido';
  try { autor = git(c.raiz, 'config', 'user.email') || autor; } catch { /* nada */ }
  const r = diario.append(c.dirEntrega, c.sessao, { ts: new Date().toISOString(), autor, sessao: c.sessao, agente: 'orquestrador', tipo, dados });
  if (!r.ok) throw new Falha('evento_nao_gravado', `${tipo} não gravado: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `${tipo} recusado pelo canário do diário`);
  return { evento: { tipo, ...dados } };
}

export async function main(argv, cwd = process.cwd()) {
  let saida;
  let rc = 0;
  try {
    saida = { ok: true, ...(await executar(argv, cwd)) };
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

if (ehEntrypoint(import.meta.url)) main(process.argv.slice(2)).then((rc) => { process.exitCode = rc; });

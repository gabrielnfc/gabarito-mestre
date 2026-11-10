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
 *   loop.mjs ci <verde|vermelho> [--alvo homolog]
 *   loop.mjs desvio <task> --req <REQ> --evidencia <t> --arquivos <a,b> --causa <regra_negocio|tecnica>      (`--arquivos ''` = lista vazia, explícita)
 *   loop.mjs descoberta --evidencia <t> --causa <regra_negocio|tecnica>
 *   loop.mjs emenda propor --req <REQ> [--task <id>] --diff <arquivo> --fato <t> --alternativa <t> --evidencia <t> --causa <c> [--arquivos <a,b>]
 *       grava SEMPRE em `events.emendas.jsonl` (`--sessao` é ignorada: o seq da proposta é o dela) e devolve `{proposta_seq, req, task?, congeladas}`;
 *       `proposta_seq` vem da RELEITURA estrita do arquivo (a única `emenda.proposta` com o `ts` e os `dados` gravados), nunca do candidato de `gravar`.
 *   loop.mjs emenda julgar <seq> <aprovar|rejeitar>   origem `sombra`: recusa sem `sombra.julga_emendas: true` em `origin/HEAD` (o config local não conta)
 *   todos aceitam --entrega <GM-10> (senão vem da branch); os que gravam aceitam --sessao <id> (padrão `loop`).
 *
 * CONTRATO DE FALHA. Saída é UMA linha de JSON em stdout, sempre com `ok`; falha traz `erro` (código) e `mensagem`.
 * Dado ausente, corrompido ou ferramenta falhando nunca vira sucesso; rc 0 só com o efeito feito. Uso errado sai 2.
 *
 * QUEM GRAVA NO DIÁRIO. Só `iniciar` (task.iniciada), `concluir` (task.concluida), `veredito` (review.veredito),
 * `desvio`, `descoberta`, `emenda propor` (emenda.proposta) e `emenda julgar` (spec.emendada ou emenda.rejeitada, origem `sombra`; a origem `dono` sai só de
 * `julgarEmendaDono`, que o hook `emenda-dono.mjs` chama), `reabrir` (task.reaberta, SÓ origem `retomada`: nenhum argumento produz `dono`; `dono` sai só de `liberarTeto`, que o hook do comando humano `/gabarito-mestre:liberar` chama), `integrar` (task.integrada),
 * `ci` (ci.resultado) e `parar` (loop.parar). `concluir` e `integrar` gravam o `sha`. `abrir` não grava no diário (grava a base em `branch.<branch>.gabaritoBase`)
 * e é idempotente: worktree registrada com HEAD na branch da task devolve o mesmo resultado com `ja_aberta: true`; qualquer outro estado recusa. Todo evento de task é conferido contra `TRANSICOES` ANTES de gravar:
 * o CLI nunca produz um diário que o núcleo recuse.
 *
 * LIMITES DECLARADOS (E3). (1) Com `sombra.julga_emendas: true` o orquestrador pode julgar a própria proposta com origem `sombra` sem consultar a
 * Sombra: nada liga o julgamento a uma `decisao.sombra`; a opção é do dono, em origin. (2) A regra (4) de `proximaAcao` conta todo `ci.resultado`
 * (homolog e PR juntos): o lado é o seguro, para mais cedo. (3) Dois `emenda propor` simultâneos validam fora do lock; o `proposta_seq` devolvido é
 * sempre o da própria linha. (4) O aviso de emenda depende de "posterior" entre sessões: relógio atrasado no julgamento cala o aviso (falso negativo).
 *
 * Tudo que toca git vai por `execFileSync` com argv, sem shell. Nada é apagado por outro meio que `git worktree remove`
 * sem `--force`, `git branch -d` do que `abrir` acabou de criar e o `.tmp-gabarito` da própria worktree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ehEntrypoint } from '../lib/cli.mjs';
import { lerConfigOrigin, resolverModelo } from '../lib/config.mjs';
import * as diario from '../dist/diario.js';
import { escopoDaTask, projetarEmendas, SESSAO_EMENDAS, validarJulgamento, validarProposta } from '../dist/emenda.js';
import { lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { formaInvalida, REQ_RE } from '../dist/formas.js';
import { estadoDe, ordenar, podeIntegrar, proximaAcao, tasksCongeladas } from '../dist/loop.js';
import { normalizarCaminho, validarPlano } from '../dist/plano.js';
import { contarConsultas, projetarDecisoes, trechoDoReq } from '../dist/sombra.js';
import { avaliar } from './gate-task.mjs';
import * as loopAprendizado from './loop-aprendizado.mjs';
import { clonar, nomeBanco, soltar, validarDb } from './db-template.mjs';

/** Subcomandos do aprendizado, do pouso e do registro: implementados em `loop-aprendizado.mjs` com dependências injetadas. */
const CMDS_E5 = ['aprendizado', 'aprendizados', 'pousar', 'registro'];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const NUM_RE = /^(0|[1-9]\d{0,14})$/;
const PAPEIS = ['implementador', 'revisor', 'correcao'];
const MOTIVOS = ['teto_rodadas', 'ci_vermelho', 'teto_tokens', 'sem_pouso', 'sem_progresso', 'diario_invalido', 'nao_conseguiu', 'smoke', 'rollback', 'janela_ausente'];
const TIPOS_DE_TASK = ['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta'];
const GLOB = /[*?[\]{}]/;
const TMP = '.tmp-gabarito';
const X_PADRAO = 50;
const CAUSAS = ['regra_negocio', 'tecnica'];
const TEXTO_MAX = 2000;
const DIFF_MAX = 4000;
const ARQUIVOS_MAX = 50;
const DADOS_MAX = 12000;
const TETO_SOMBRA_PADRAO = 26;
const SEQ_RE = /^[1-9]\d{0,8}$/;
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
    ci: { pos: 1, flags: ['entrega', 'sessao', 'alvo'] },
    desvio: { pos: 1, flags: ['entrega', 'sessao', 'req', 'evidencia', 'arquivos', 'causa'], obrig: ['req', 'evidencia', 'arquivos', 'causa'] },
    descoberta: { pos: 0, flags: ['entrega', 'sessao', 'evidencia', 'causa'], obrig: ['evidencia', 'causa'] },
    // E5a (GM-13): fiação; os argumentos de cada um chegam com a task dona (T8, T11, T12). Aqui qualquer posicional e as flags comuns.
    aprendizado: { pos: null, flags: ['entrega', 'sessao'] },
    aprendizados: { pos: null, flags: ['entrega', 'sessao'] },
    pousar: { pos: null, flags: ['entrega', 'sessao'] },
    registro: { pos: null, flags: ['entrega', 'sessao'] },
    emenda: { pos: null, flags: ['entrega', 'sessao', 'req', 'task', 'diff', 'fato', 'alternativa', 'evidencia', 'causa', 'arquivos'] },
  };
  const uso = 'uso: loop.mjs proxima | abrir|fechar|integrar|concluir|reabrir <task> | iniciar <task> <papel> | veredito <task> <APROVADO|REPROVADO> <rodada> <blocker> <major> | parar <motivo> | ci <verde|vermelho> [--alvo homolog] | desvio <task> --req --evidencia --arquivos --causa | descoberta --evidencia --causa | emenda propor --req [--task] --diff --fato --alternativa --evidencia --causa [--arquivos] | emenda julgar <seq> <aprovar|rejeitar> | aprendizado | aprendizados | pousar | registro  [--entrega GM-10]';
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
  if (cmd === 'emenda') {
    const sub = pos[0];
    const propor = sub === 'propor' && pos.length === 1;
    const julgar = sub === 'julgar' && pos.length === 3;
    if (!propor && !julgar) throw new Falha('uso', `emenda espera \`propor\` ou \`julgar <seq> <aprovar|rejeitar>\`. ${uso}`, {}, 2);
    const obrig = propor ? ['req', 'diff', 'fato', 'alternativa', 'evidencia', 'causa'] : [];
    const permitidas = propor ? esp.flags : ['entrega', 'sessao'];
    const fora = Object.keys(flags).find((n) => !permitidas.includes(n));
    if (fora !== undefined) throw new Falha('uso', `--${fora} não vale para emenda ${sub}. ${uso}`, {}, 2);
    const falta = obrig.find((n) => !Object.hasOwn(flags, n));
    if (falta !== undefined) throw new Falha('uso', `emenda propor exige --${falta}. ${uso}`, {}, 2);
    return { cmd, pos, flags };
  }
  if (esp.pos !== null && pos.length !== esp.pos) throw new Falha('uso', `${cmd} espera ${esp.pos} argumento(s) posicional(is), veio ${pos.length}. ${uso}`, {}, 2);
  const falta = (esp.obrig ?? []).find((n) => !Object.hasOwn(flags, n));
  if (falta !== undefined) throw new Falha('uso', `${cmd} exige --${falta}. ${uso}`, {}, 2);
  return { cmd, pos, flags };
}

// ─────────────────────────────────────────────────────────────── formas de desvio, descoberta e emenda

function causaDe(v) {
  if (!CAUSAS.includes(v)) throw new Falha('argumento_invalido', `--causa ${JSON.stringify(v)}: esperado ${CAUSAS.join(' ou ')}`);
  return v;
}

/** Texto obrigatório não vazio (depois de `trim`): `{[nome]: texto}`. Tamanho e canário vêm depois, em `limitarTextos`. */
function textoDe(nome, v) {
  if (typeof v !== 'string' || v.trim() === '') throw new Falha('argumento_invalido', `--${nome} vazio: esperado texto`);
  return { [nome]: v };
}

/** `a,b` ⇒ lista normalizada; `''` ⇒ `[]` (explícito); item vazio ou caminho que escapa ⇒ `caminho_invalido` (o vazio não some em silêncio). */
function listaDeCaminhos(texto, { normalizar = true } = {}) {
  if (texto === '') return [];
  const itens = texto.split(',');
  if (itens.length > ARQUIVOS_MAX) throw new Falha('proposta_longa', `--arquivos tem ${itens.length} itens, máximo ${ARQUIVOS_MAX}`);
  return itens.map((a) => {
    const n = a === '' ? null : normalizarCaminho(a);
    if (n === null) throw new Falha('caminho_invalido', a === '' ? 'caminho inválido: item vazio em --arquivos' : `caminho inválido: ${a}`);
    return normalizar ? n : a;
  });
}

/** Limite de 2.000 por texto e canário em todos, ANTES de qualquer escrita. A mensagem nomeia o campo e o padrão, nunca o valor. */
function limitarTextos(textos) {
  for (const [nome, v] of Object.entries(textos)) {
    if (v.length > TEXTO_MAX && nome !== 'diff' && nome !== 'arquivos') throw new Falha('proposta_longa', `${nome} tem ${v.length} caracteres, máximo ${TEXTO_MAX}; nada foi gravado`);
  }
  for (const [nome, v] of Object.entries(textos)) {
    const padrao = diario.recusaCanario(v);
    if (padrao !== null) throw new Falha('segredo_na_proposta', `${nome} casa o canário de segredo (${padrao}); nada foi gravado`);
  }
}

function limitarDados(dados) {
  const n = JSON.stringify(dados).length;
  if (n > DADOS_MAX) throw new Falha('proposta_longa', `a proposta tem ${n} caracteres serializados, máximo ${DADOS_MAX}; nada foi gravado`);
}

/** Forma de `emenda propor|julgar`: tudo que vira `dados`, conferido antes de qualquer leitura ou efeito. */
function formaEmenda(pos, flags) {
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('entrega_invalida', `--entrega "${flags.entrega}" fora da forma ${ENTREGA_RE}`);
  if (flags.sessao !== undefined && !SESSAO_RE.test(flags.sessao)) throw new Falha('argumento_invalido', `--sessao fora da forma ${SESSAO_RE}`);
  if (pos[0] === 'julgar') {
    const [, seq, decisao] = pos;
    if (!SEQ_RE.test(seq)) throw new Falha('argumento_invalido', `seq ${JSON.stringify(seq)}: esperado inteiro >= 1 sem zeros à esquerda (até 9 dígitos)`);
    if (decisao !== 'aprovar' && decisao !== 'rejeitar') throw new Falha('argumento_invalido', `decisão ${JSON.stringify(decisao)}: esperado aprovar ou rejeitar`);
    return { sub: 'julgar', seq: Number(seq), decisao };
  }
  if (!REQ_RE.test(flags.req)) throw new Falha('argumento_invalido', `--req ${JSON.stringify(flags.req)} fora da forma REQ-<ÁREA>-<n>`);
  if (flags.task !== undefined && !ID_RE.test(flags.task)) throw new Falha('argumento_invalido', `--task ${JSON.stringify(flags.task)} fora da forma ${ID_RE}`);
  causaDe(flags.causa);
  for (const nome of ['fato', 'alternativa', 'evidencia']) textoDe(nome, flags[nome]);
  return { sub: 'propor' };
}

/** `--diff` lido do arquivo: ausente × ilegível distintos; vazio e acima de 4.000 caracteres recusam. */
function lerDiffDe(cwd, arquivo) {
  const abs = resolve(cwd, arquivo);
  let texto;
  try {
    const st = statSync(abs);
    if (!st.isFile()) throw Object.assign(new Error('não é arquivo regular'), { code: 'ENOTFILE' });
    if (st.size > DIFF_MAX * 4) throw new Falha('diff_longo', `o diff tem ${st.size} bytes: mais de ${DIFF_MAX} caracteres; nada foi gravado`);
    texto = readFileSync(abs, 'utf8');
  } catch (e) {
    if (e instanceof Falha) throw e;
    if (e.code === 'ENOENT') throw new Falha('diff_ausente', `${arquivo} não existe`);
    throw new Falha('diff_ilegivel', `${arquivo} ilegível (${e.code ?? e.message})`);
  }
  if (texto.trim() === '') throw new Falha('argumento_invalido', `${arquivo}: diff vazio`);
  if (texto.length > DIFF_MAX) throw new Falha('diff_longo', `o diff tem ${texto.length} caracteres, máximo ${DIFF_MAX}; nada foi gravado`);
  return texto;
}

/** `dados` de `emenda.proposta`, tudo conferido antes do diário (diff, limites, canário, caminhos). */
function prepararProposta(cwd, flags) {
  const diff = lerDiffDe(cwd, flags.diff);
  const arquivos = flags.arquivos === undefined ? undefined : listaDeCaminhos(flags.arquivos, { normalizar: false });
  limitarTextos({ diff, fato: flags.fato, alternativa: flags.alternativa, evidencia: flags.evidencia });
  const dados = {
    req: flags.req, ...(flags.task !== undefined ? { task: flags.task } : {}), diff, fato: flags.fato, alternativa: flags.alternativa, evidencia: flags.evidencia, causa: flags.causa,
    ...(arquivos !== undefined ? { arquivos } : {}),
  };
  limitarDados(dados);
  return dados;
}

// ─────────────────────────────────────────────────────────────── entrada (validação)

/** Forma de tudo que vira caminho, branch ou argv: conferida ANTES de qualquer leitura ou efeito. */
function validarForma(cmd, pos, flags) {
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('entrega_invalida', `--entrega "${flags.entrega}" fora da forma ${ENTREGA_RE}`);
  if (flags.sessao !== undefined && !SESSAO_RE.test(flags.sessao)) throw new Falha('argumento_invalido', `--sessao fora da forma ${SESSAO_RE}`);
  if (CMDS_E5.includes(cmd)) return {};
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
    if (flags.alvo !== undefined && flags.alvo !== 'homolog') throw new Falha('argumento_invalido', `--alvo ${JSON.stringify(flags.alvo)}: só \`homolog\` (ou sem a flag)`);
    return { verde: pos[0] === 'verde', ...(flags.alvo !== undefined ? { alvo: flags.alvo } : {}) };
  }
  if (cmd === 'descoberta') return { dados: { ...textoDe('evidencia', flags.evidencia), causa: causaDe(flags.causa) }, textos: { evidencia: flags.evidencia } };
  if (cmd === 'emenda') return formaEmenda(pos, flags);
  const [task] = pos;
  if (typeof task !== 'string' || !ID_RE.test(task)) throw new Falha('id_invalido', `task ${JSON.stringify(task)} fora da forma ${ID_RE}`);
  if (cmd === 'desvio') {
    if (!REQ_RE.test(flags.req)) throw new Falha('argumento_invalido', `--req ${JSON.stringify(flags.req)} fora da forma REQ-<ÁREA>-<n>`);
    const causa = causaDe(flags.causa);
    const evid = textoDe('evidencia', flags.evidencia);
    const arquivos = listaDeCaminhos(flags.arquivos);
    return { task, req: flags.req, dados: { task, req: flags.req, ...evid, arquivos, causa }, textos: { evidencia: flags.evidencia, arquivos: arquivos.join(',') } };
  }
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

/** Exportada para o painel (E4, T9): a MESMA regra de raiz principal, entrega por branch ou `--entrega`. */
export function contexto(cwd, flags) {
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

/** Exportada para o painel (E4, T9). Lança `Falha` (`.erro`, `.message`). */
export function carregarPlano(c) {
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
export function lerDiarioEstrito(dir) {
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
  antes(candidato, eventos); // última conferência antes de gravar (depois da tabela: a causa mais fundamental vem primeiro)
  let autor = 'desconhecido';
  try { autor = git(c.raiz, 'config', 'user.email') || autor; } catch { /* sem user.email: o diário aceita "desconhecido" */ }
  const r = diario.append(c.dirEntrega, c.sessao, { ts, autor, sessao: c.sessao, agente: 'orquestrador', tipo, dados });
  // O `append` recusa a forma com o prefixo `forma_invalida: `: só ele é forma; qualquer outro erro é gravação que falhou.
  if (!r.ok) throw new Falha(/^forma_invalida: /.test(r.erro) ? 'forma_invalida' : 'evento_nao_gravado', `${tipo} não gravado: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', `${tipo} recusado pelo diário (canário ou tamanho)`);
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

/**
 * TMPDIR da task: FORA da worktree (D2). Dentro dela, qualquer teste que suba a árvore acha o `.git` e os arquivos da task.
 * Nome estável por worktree (sha256 do caminho): `abrir` repetido devolve o mesmo, `fechar` o recalcula sem criar nada.
 * `.tmp-gabarito` fica só para os achados do revisor (REQ-LOOP-2).
 */
const tmpExterno = (wt) => join(realpathSync(tmpdir()), `gabarito-${createHash('sha256').update(wt).digest('hex').slice(0, 16)}`);

/** Confere sem criar nem apagar: `null` = não existe; symlink, não-diretório ou dono alheio recusam. */
function validarTmpExterno(wt) {
  const p = tmpExterno(wt);
  const st = lstatOuNull(p);
  if (st === null) return null;
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Falha('tmpdir_invalido', `${p} não é um diretório comum (symlink ou arquivo); recusado, nada foi tocado`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Falha('tmpdir_invalido', `${p} é de outro usuário; recusado, nada foi tocado`);
  return p;
}

/** Cria (0700) se não existe. `criado` diz se foi agora, para o `abrir` desfazer só o que fez. */
function garantirTmpExterno(wt) {
  const existente = validarTmpExterno(wt);
  if (existente !== null) return { dir: existente, criado: false };
  const p = tmpExterno(wt);
  mkdirSync(p, { mode: 0o700 });
  chmodSync(p, 0o700);
  return { dir: p, criado: true };
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
  garantirTmp(caminho); // é a nossa: symlink em `.tmp-gabarito` recusa com motivo (tmpdir_invalido), nada escrito fora
  const tmp = garantirTmpExterno(caminho).dir;
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
  let tmp = '';
  let tmpCriado = false;
  try {
    if (!v.na) {
      banco = clonar(v.db, c.entrega, task).banco;
      clonado = true;
    }
    garantirTmp(caminho);
    ({ dir: tmp, criado: tmpCriado } = garantirTmpExterno(caminho));
    git(c.raiz, 'config', `branch.${branch}.gabaritoBase`, base);
  } catch (e) {
    const restos = [];
    if (tmpCriado) {
      try { rmSync(tmp, { recursive: true }); } catch (e2) { restos.push(`tmpdir ${tmp} (${e2.code ?? e2.message})`); }
    }
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
  const tmpFora = validarTmpExterno(wt);
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
  if (tmpFora !== null) {
    try {
      rmSync(tmpFora, { recursive: true });
    } catch (e) {
      throw new Falha('tmpdir_falhou', `não consegui apagar ${tmpFora}: ${e.code ?? e.message}; a worktree foi mantida`, { banco });
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

async function integrar(c, plano, task, opcoes = {}) {
  const t = tarefa(plano, task);
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições; integrar recusado');
  if (!podeIntegrar(plano, eventos, task)) throw new Falha('nao_integravel', `a task ${task} não está aprovada com toda a cadeia de dependências integrada`, { merge: false, evento: false });
  const wt = worktreeViva(c, task);
  const sujo = git(wt, ...STATUS_SUJEIRA).split('\n').filter((l) => l !== '' && !l.startsWith('!! '));
  if (sujo.length > 0) throw new Falha('worktree_suja', `a worktree ${task} tem trabalho não commitado ou não rastreado; nada foi feito: ${sujo.slice(0, 10).join(' | ')}`, { merge: false, evento: false });
  const branch = ramo(c, task);
  const nada = { merge: false, evento: false };
  let mutacoesMedidas;
  let relatoVerde = []; // só `desvio:`/`aviso:` do gate (T16); o relato completo fica no ramo reprovado

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

    garantirTmp(wt);
    const tmp = garantirTmpExterno(wt).dir;
    const tmpAntes = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
    let r;
    try {
      r = await (opcoes.avaliar ?? avaliar)({ wt, base: `refs/heads/${base}`, card: c.entrega, files: escopo(wt, escopoDaTask(plano, projetarEmendas(eventos), task)), mutacoes, suites: suitesDaTask(wt, t) });
    } catch (e) {
      throw new Falha('gate_erro', `o gate falhou ao rodar: ${e.message}; sem merge nem evento`, nada);
    } finally {
      // `fechar` recalcula o nome a partir de `tmpdir()`: com o TMPDIR do gate ainda no ambiente, o nome sairia dentro do próprio.
      if (tmpAntes === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = tmpAntes;
    }
    relatoVerde = r.relato.filter((l) => /^(desvio|aviso): /.test(l));
    if (r.reprova > 0) {
      throw new Falha('gate_reprovado', `gate reprovado (${r.reprova}); sem merge nem evento`, { ...nada, relato: r.relato });
    }
    // `task.integrada.mutacoes` (E4): o que o gate mediu. `mortas < total` só com ALERTA de tempo ~zero (a mutação VIVA reprova antes). A forma é conferida
    // AQUI, antes do merge: depois dele, o dado torto viraria "merge ENTROU, evento NÃO gravado".
    mutacoesMedidas = { total: mutacoes === undefined ? 0 : mutacoes.length, mortas: r.mutacoes };
    const tortura = formaInvalida('task.integrada', { task, sha: alvo, mutacoes: mutacoesMedidas });
    if (tortura !== null) throw new Falha('gate_erro', `o gate devolveu mutações fora da forma (${tortura}); sem merge nem evento`, nada);
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
    gravar(c, plano, 'task.integrada', { task, sha: alvo, mutacoes: mutacoesMedidas });
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
  return { task, branch, base, merge: true, evento: true, fechada: true, banco: fechada.banco, ignorados_removidos: fechada.ignorados_removidos, mutacoes: mutacoesMedidas, relato: relatoVerde };
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

/** `sombra.teto` de `origin/HEAD`: ausente ⇒ 26; inteiro >= 1 vale; qualquer outra coisa ⇒ 26 e aviso (a origem corrompida já foi avisada à parte). */
export function tetoDaSombra(origin) {
  if (origin.fonte !== 'origin') return { teto: TETO_SOMBRA_PADRAO };
  const s = origin.cfg.sombra;
  if (s === undefined) return { teto: TETO_SOMBRA_PADRAO };
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return { teto: TETO_SOMBRA_PADRAO, aviso: `sombra.teto inválido em origin/HEAD (\`sombra\` não é objeto): teto ${TETO_SOMBRA_PADRAO}` };
  if (!Object.hasOwn(s, 'teto')) return { teto: TETO_SOMBRA_PADRAO };
  if (!Number.isInteger(s.teto) || s.teto < 1) return { teto: TETO_SOMBRA_PADRAO, aviso: `sombra.teto inválido em origin/HEAD (${JSON.stringify(s.teto)}): esperado inteiro >= 1; teto ${TETO_SOMBRA_PADRAO}` };
  return { teto: s.teto };
}

/**
 * Modelo do papel do item: `implementador` e `correcao` usam a chave `implementador`, `revisor` a `revisor`. Fonte: `orquestracao.modelos` do config LOCAL
 * (a mesma de `orquestracao.modelo`; não decide produção), texto ou `{modelo, esforco?}`. Família = 1ª de haiku|sonnet|opus|fable contida no nome em caixa
 * baixa (`claude-opus-5-5` ⇒ `opus`): os agentes têm `model: inherit`, então o que o `Agent` recebe é esta família. Resolução em `resolverModelo`
 * (`lib/config.mjs`): explícito > `orquestracao.perfil` > `MODELOS_PADRAO`; entrada que não se entende ⇒ o perfil e um aviso (ausente ≠ corrompido).
 */
function modeloDoItem(cfg, papel, aviso) {
  const chave = papel === 'revisor' ? 'revisor' : 'implementador';
  const { modelo, esforco, aviso: a } = resolverModelo(cfg?.orquestracao, chave);
  if (a !== undefined) { const t = `modelo do papel ${chave}: ${a}`; if (!aviso.includes(t)) aviso.push(t); }
  return { modelo, ...(esforco !== undefined ? { esforco } : {}) };
}

/**
 * `modelo` de `task.iniciada` (E4, REQ-PNL-14): a família que `proxima` daria ao item deste papel (`modeloDoItem`), lida do config LOCAL no momento do
 * `iniciar` (depois de `tarefa` e `worktreeViva`, para que a config não mude o motivo de nenhuma recusa). Config ausente ⇒ o padrão do papel e aviso;
 * config ilegível (`config_invalida`) ⇒ SEM `modelo` e aviso, rc 0: `proxima` não daria item com essa config, então nenhum modelo é inventado.
 * Ausente e corrompido são casos distintos. Qualquer outra falha segue como falha.
 */
function modeloDaInicio(c, papel) {
  const aviso = [];
  let cfg;
  try {
    ({ cfg } = lerConfig(c.raiz));
  } catch (e) {
    if (e instanceof Falha && e.erro === 'config_invalida') {
      aviso.push(`${e.erro}: ${e.message}; task.iniciada sem modelo`);
      return { modelo: undefined, aviso };
    }
    throw e;
  }
  if (cfg === null) aviso.push('harness.config.json ausente');
  return { modelo: modeloDoItem(cfg, papel, aviso).modelo, aviso };
}

/** Os julgamentos que aprovaram: o 1º julgamento válido de cada proposta (aprovar ou rejeitar) a fecha; só `spec.emendada` entra, com a posição em `ordenar`. */
function julgamentosAprovados(ord, est) {
  const aprovadas = new Map(est.aprovadas.map((p) => [p.seq, p]));
  const vistos = new Set();
  const saida = [];
  ord.forEach((e, idx) => {
    if ((e.tipo !== 'spec.emendada' && e.tipo !== 'emenda.rejeitada') || formaInvalida(e.tipo, e.dados) !== null) return;
    const seq = e.dados.proposta_seq;
    if (vistos.has(seq)) return;
    vistos.add(seq);
    if (e.tipo === 'spec.emendada' && aprovadas.has(seq)) saida.push({ seq, req: aprovadas.get(seq).req, idx });
  });
  return saida;
}

/**
 * Aviso de emenda em task já feita: `spec.emendada` POSTERIOR, em `ordenar`, ao último `review.veredito APROVADO` de task com o REQ (`aprovada` ou `integrada`;
 * a integração não passa por revisão, então não prova nada sobre a spec: Sombra C5). Cala enquanto OUTRA task do plano com o mesmo REQ está fora de
 * `integrada` (o ajuste está a caminho) ou teve o seu último APROVADO depois do julgamento (o ajuste foi revisado contra a spec emendada).
 */
function avisosDeEmenda(plano, ord, est) {
  const julg = julgamentosAprovados(ord, est);
  if (julg.length === 0) return [];
  const info = new Map();
  for (const t of plano.tasks) {
    const dela = ord.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === t.id);
    const r = estadoDe(dela);
    if ('invalido' in r) continue;
    const ultimo = (f) => ord.findLastIndex((e) => e.dados?.task === t.id && f(e));
    info.set(t.id, {
      estado: r.estado,
      aprovada: ultimo((e) => e.tipo === 'review.veredito' && e.dados.veredito === 'APROVADO'),
    });
  }
  const avisos = [];
  for (const j of julg) {
    const comReq = plano.tasks.filter((t) => Array.isArray(t.reqs) && t.reqs.includes(j.req) && info.has(t.id));
    for (const t of comReq) {
      const inf = info.get(t.id);
      if (inf.aprovada < 0 || j.idx <= inf.aprovada) continue;
      const cala = comReq.some((u) => u.id !== t.id && (info.get(u.id).estado !== 'integrada' || info.get(u.id).aprovada > j.idx));
      if (!cala) avisos.push(`Atenção: ${j.req} emendado (#${j.seq}) depois de ${t.id} integrada/aprovada: acrescente task de ajuste`);
    }
  }
  return avisos;
}

function proxima(c, plano, flags) {
  const { cfg } = lerConfig(c.raiz);
  const eventos = lerDiarioEstrito(c.dirEntrega);
  const origin = lerConfigOrigin(c.raiz);
  const avisoOrigin = [];
  if (origin.invalida) avisoOrigin.push(`config de origin inválida: ${origin.motivo}`);
  const ce = lerConfigEntrega(origin.cfg);
  for (const e of ce.erros) avisoOrigin.push(`entrega: ${e}`);
  const pol = politicaEfetiva(ce, plano.politica_entrega);
  if (!pol.ok) throw new Falha(pol.erro, pol.mensagem);
  const { sinais, aviso } = sinaisDe(c, cfg, eventos, flags);
  aviso.push(...avisoOrigin);
  if (cfg === null) aviso.push('harness.config.json ausente');
  const acao = proximaAcao(plano, eventos, { ...sinais, politica: pol.politica });
  if (acao.tipo === 'parar' && acao.motivo === 'diario_invalido') {
    throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições (evento fora de ordem ou de task desconhecida)', { acao, sinais });
  }
  const ord = ordenar(eventos);
  const ordenados = ord.ok ? ord.eventos : [];
  const est = projetarEmendas(eventos);
  const { teto, aviso: avisoTeto } = tetoDaSombra(origin);
  if (avisoTeto !== undefined) aviso.push(avisoTeto);
  const consultas = contarConsultas(eventos);
  if (consultas > teto) aviso.push(`Atenção: ${consultas} consultas à Sombra, teto ${teto}`);
  aviso.push(...avisosDeEmenda(plano, ordenados, est));
  const extra = { cfg, ordenados, est, decisoes: projetarDecisoes(eventos) };
  return { acao: acao.tipo === 'despachar' ? { ...acao, itens: acao.itens.map((i) => enriquecer(c, plano, eventos, i, aviso, extra)) } : acao, sinais, ...(aviso.length ? { aviso } : {}) };
}

/** Decisões vigentes do item: as dos REQs da task e as da âncora `task:<id>`, sem as de consulta anterior à última emenda de um REQ da âncora; mais recente primeiro. */
function decisoesDoItem(c, plano, item, reqs, extra) {
  const { ordenados, est, decisoes } = extra;
  const julg = julgamentosAprovados(ordenados, est);
  const posicao = (f) => ordenados.findLastIndex(f);
  const lista = [];
  for (const d of decisoes.values()) {
    const doReq = d.req !== undefined && reqs.includes(d.req);
    const daTask = d.task !== undefined && d.task === item.task;
    if (!doReq && !daTask) continue;
    const reqsDaAncora = d.req !== undefined ? [d.req] : reqs;
    const ultimaEmenda = Math.max(-1, ...julg.filter((j) => reqsDaAncora.includes(j.req)).map((j) => j.idx));
    const consulta = posicao((e) => e.tipo === 'sombra.consulta' && formaInvalida(e.tipo, e.dados) === null && e.dados.pergunta_hash === d.hash);
    if (consulta >= 0 && consulta < ultimaEmenda) continue;
    // `arquivo` relativo à raiz principal não abre de dentro da worktree da task (`.harness/` não existe lá): sai absoluto, e nunca de fora da raiz.
    const abs = resolve(c.raiz, d.arquivo);
    const rel = relative(c.raiz, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    lista.push({ pos: posicao((e) => e.tipo === 'decisao.sombra' && e.sessao === d.sessao && e.seq === d.seq), d, abs });
  }
  return lista.sort((a, b) => b.pos - a.pos).map(({ d, abs }) => ({ hash: d.hash, ancora: d.req !== undefined ? d.req : `task:${d.task}`, resposta: d.resposta, arquivo: abs }));
}

/**
 * O item de despacho carrega o que o /clear apaga: `spec` (ponteiro do topo do plano), `modelo`, `decisoes` e `emendas` (as aprovadas dos REQs da task: o
 * arquivo da spec nunca é editado pela emenda, então o implementador, a correção e o revisor leem o diff aqui) e, na `correcao`, `achados` (caminho do
 * arquivo da rodada reprovada). Arquivo de achados ausente ou vazio não vira caminho: `achados: null` e aviso (o orquestrador não manda corrigir às cegas).
 */
function enriquecer(c, plano, eventos, item, aviso, extra) {
  const t = plano.tasks.find((x) => x.id === item.task);
  const reqs = Array.isArray(t?.reqs) ? t.reqs : [];
  const saida = {
    ...item,
    ...(typeof plano.spec === 'string' ? { spec: plano.spec } : {}),
    // `description` do `Agent` (E4): `"<task> <papel>"` exato; é a ligação do agente vivo com a task em `casarAgente` (painel-equipe.ts).
    descricao: `${item.task} ${item.papel}`,
    modelo: modeloDoItem(extra.cfg, item.papel, aviso),
    decisoes: decisoesDoItem(c, plano, item, reqs, extra),
    emendas: extra.est.aprovadas.filter((p) => reqs.includes(p.req)).map((p) => ({ proposta_seq: p.seq, req: p.req, diff: p.diff })),
  };
  if (item.papel !== 'correcao') return saida;
  const ord = ordenar(eventos);
  const reprovado = (ord.ok ? ord.eventos : []).filter((e) => e.tipo === 'review.veredito' && e.dados?.task === item.task && e.dados?.veredito === 'REPROVADO').at(-1);
  const arq = Number.isInteger(reprovado?.dados?.rodada) ? caminhoAchados(caminhoWt(c, item.task), reprovado.dados.rodada) : null;
  if (arq !== null && achadosLegiveis(arq)) return { ...saida, achados: arq };
  aviso.push(`achados da task ${item.task} ausentes ou vazios${arq === null ? '' : ` em ${relative(c.raiz, arq)}`}: o revisor precisa regravá-los antes da correção`);
  return { ...saida, achados: null };
}

// ─────────────────────────────────────────────────────────────── emenda, desvio, descoberta

const CODIGO_JULGAMENTO = { 'diário fora de ordem': 'diario_invalido', 'proposta já julgada': 'ja_julgada', 'proposta inexistente': 'proposta_inexistente' };

/**
 * Caminho real da spec do plano, com contenção léxica E por `realpath` na raiz (symlink dentro da raiz que aponta para fora é recusado).
 * Base única de `reqNaSpec` e `shaDaSpec`: a spec que prova um REQ é a mesma que o dono aprova. Nunca lança.
 * `erro` ∈ `sem_spec`, `spec_fora_da_raiz`, `spec_ausente` (ENOENT), `spec_ilegivel` (outro erro, diretório, não regular).
 */
function caminhoDaSpec(raiz, plano) {
  const spec = plano?.spec;
  if (typeof spec !== 'string' || spec === '') return { ok: false, erro: 'sem_spec', mensagem: 'o plano não tem `spec` (texto não vazio): não há spec a aprovar' };
  const fora = { ok: false, erro: 'spec_fora_da_raiz', mensagem: `a spec ${JSON.stringify(spec)} está fora da raiz do repositório` };
  try {
    const abs = resolve(raiz, spec);
    const rel = relative(raiz, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return fora;
    const real = realpathSync(abs);
    const relReal = relative(realpathSync(raiz), real);
    if (relReal.startsWith('..') || isAbsolute(relReal)) return fora;
    if (!statSync(real).isFile()) return { ok: false, erro: 'spec_ilegivel', mensagem: `a spec ${JSON.stringify(spec)} não é um arquivo regular` };
    return { ok: true, spec, real };
  } catch (e) {
    if (e?.code === 'ENOENT') return { ok: false, erro: 'spec_ausente', mensagem: `a spec ${JSON.stringify(spec)} não existe` };
    return { ok: false, erro: 'spec_ilegivel', mensagem: `a spec ${JSON.stringify(spec)} está ilegível (${e?.code ?? e?.message})` };
  }
}

/**
 * O sha256 único da spec (D-P2): "aguardando" no painel (T9) e "já aprovada" no hook (T8) comparam este número.
 * São os BYTES do arquivo na raiz PRINCIPAL (`raizPrincipal`), sem decodificar. Nunca lança.
 * `{ok:true, spec, sha256}` ou `{ok:false, erro, mensagem}`, `erro` ∈ `sem_spec`, `spec_fora_da_raiz`, `spec_ausente`, `spec_ilegivel`, `spec_vazia`.
 */
export function shaDaSpec(raiz, plano) {
  const r = lerSpec(raiz, plano);
  return r.ok ? { ok: true, spec: r.spec, sha256: r.sha256 } : r;
}

/**
 * Os bytes da spec e o sha256 deles (E4, T9): o painel tira o título (H1) dos MESMOS bytes que deram o sha. Mesma resolução de `shaDaSpec`.
 * `{ok:true, spec, sha256, bytes}` ou `{ok:false, erro, mensagem}`. Nunca lança.
 */
export function lerSpec(raiz, plano) {
  const r = caminhoDaSpec(raiz, plano);
  if (!r.ok) return r;
  try {
    const bytes = readFileSync(r.real);
    if (bytes.length === 0) return { ok: false, erro: 'spec_vazia', mensagem: `a spec ${JSON.stringify(r.spec)} tem 0 bytes` };
    return { ok: true, spec: r.spec, sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
  } catch (e) {
    if (e?.code === 'ENOENT') return { ok: false, erro: 'spec_ausente', mensagem: `a spec ${JSON.stringify(r.spec)} não existe` };
    return { ok: false, erro: 'spec_ilegivel', mensagem: `a spec ${JSON.stringify(r.spec)} está ilegível (${e?.code ?? e?.message})` };
  }
}

/** REQ com trecho na spec do plano. Spec ausente, ilegível ou fora da raiz ⇒ `false` (sem a spec não há como provar o REQ). */
function reqNaSpec(c, plano, req) {
  const r = caminhoDaSpec(c.raiz, plano);
  if (!r.ok) return false;
  try {
    return trechoDoReq(readFileSync(r.real, 'utf8'), req) !== null;
  } catch {
    return false;
  }
}

function propor(c, plano, dados, antesDoAppend) {
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições; nada foi gravado');
  const motivo = validarProposta(plano, projetarEmendas(eventos), dados);
  if (motivo !== null) throw new Falha('proposta_recusada', motivo, { motivo });
  if (dados.task === undefined && !plano.tasks.some((t) => Array.isArray(t.reqs) && t.reqs.includes(dados.req)) && !reqNaSpec(c, plano, dados.req)) {
    throw new Falha('req_desconhecido', `${dados.req} não está em nenhuma task do plano nem na spec: erro de digitação prenderia o \`concluir\` até o dono rejeitar; nada foi gravado`);
  }
  let ts = null;
  gravar(c, plano, 'emenda.proposta', dados, (candidato) => { ts = candidato.ts; if (antesDoAppend) antesDoAppend(); });
  // O `seq` da linha só o arquivo sabe (o candidato de `gravar` sai de uma leitura anterior ao lock): relê e acha a linha pelo `ts` e pelos `dados`.
  const depois = lerDiarioEstrito(c.dirEntrega);
  const minhas = depois.filter((e) => e.sessao === SESSAO_EMENDAS && e.tipo === 'emenda.proposta' && e.ts === ts && isDeepStrictEqual(e.dados, dados));
  if (minhas.length !== 1) {
    throw new Falha('seq_nao_confirmado', `a emenda.proposta FOI gravada (events.${SESSAO_EMENDAS}.jsonl), mas achei ${minhas.length} linha(s) com o mesmo ts e os mesmos dados: não sei qual é o proposta_seq; confira o diário`);
  }
  const congeladas = tasksCongeladas(plano, depois);
  return { proposta_seq: minhas[0].seq, req: dados.req, ...(dados.task !== undefined ? { task: dados.task } : {}), congeladas: plano.tasks.map((t) => t.id).filter((id) => congeladas.has(id)) };
}

/** `emenda propor` fora do despacho de `executar`, para o teste injetar uma escrita concorrente (`antes`) entre a conferência e o append. Devolve o resultado ou lança. */
export function proporEmenda(cwd, flags, { antes } = {}) {
  formaEmenda(['propor'], flags);
  const c = contexto(cwd, { entrega: flags.entrega, sessao: SESSAO_EMENDAS });
  const dados = prepararProposta(cwd, flags);
  return propor(c, carregarPlano(c), dados, antes);
}

/** Posição do julgamento que FECHA a proposta: o 1º válido na ordem do diário (aprovar ou rejeitar), como `projetarEmendas`. */
function julgamentoQueFecha(eventos, seq) {
  const ord = ordenar(eventos);
  if (!ord.ok) return null;
  const e = ord.eventos.find((x) => (x.tipo === 'spec.emendada' || x.tipo === 'emenda.rejeitada') && formaInvalida(x.tipo, x.dados) === null && x.dados.proposta_seq === seq);
  return e === undefined ? null : { tipo: e.tipo, origem: e.dados.origem };
}

/** Julga a proposta `seq` e relê: `ok` só com o evento gravado E fechando a proposta com a mesma origem. Sem lock (limite do `gravar`). */
function julgar(c, plano, seq, decisao, origem, antes) {
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições; nada foi gravado');
  const est = projetarEmendas(eventos);
  const motivo = validarJulgamento(est, seq, origem, origem === 'sombra');
  if (motivo !== null) throw new Falha(CODIGO_JULGAMENTO[motivo] ?? 'julgamento_invalido', motivo);
  const proposta = est.abertas.find((p) => p.seq === seq);
  const tipo = decisao === 'aprovar' ? 'spec.emendada' : 'emenda.rejeitada';
  gravar(c, plano, tipo, { proposta_seq: seq, origem }, () => { if (antes) antes(); });
  const fecha = julgamentoQueFecha(lerDiarioEstrito(c.dirEntrega), seq);
  if (fecha === null || fecha.tipo !== tipo || fecha.origem !== origem) {
    throw new Falha('julgamento_sem_efeito', `o evento ${tipo} da proposta #${seq} foi gravado, mas ${fecha === null ? 'o diário relido não a fecha' : `outro julgamento (${fecha.tipo}, origem ${fecha.origem}) a fecha`}: confira o diário`);
  }
  return { seq, req: proposta.req, tipo, entrega: c.entrega };
}

function julgarComoSombra(c, plano, seq, decisao) {
  const o = lerConfigOrigin(c.raiz);
  const liga = o.fonte === 'origin' && o.cfg.sombra !== null && typeof o.cfg.sombra === 'object' && o.cfg.sombra.julga_emendas === true;
  if (!liga) {
    throw new Falha('julga_emendas_desligado', o.invalida
      ? `config de origin/HEAD inválida (${o.motivo}): sem sombra.julga_emendas verdadeiro lá, a Sombra não julga; nada foi gravado`
      : 'sombra.julga_emendas não é true em origin/HEAD (o config local não conta): a Sombra não julga; nada foi gravado');
  }
  return { ...julgar(c, plano, seq, decisao, 'sombra'), origem: 'sombra' };
}

/**
 * Julgamento do DONO: a ÚNICA gravação de `spec.emendada`/`emenda.rejeitada` com `origem:"dono"`. Fora de `ESPEC`: nenhum argumento do CLI chega aqui, só o
 * hook `UserPromptExpansion` (`emenda-dono.mjs`), disparado pelo comando que o dono digita. Nunca lança: `{ok:true, seq, req, tipo, entrega}` só com o evento
 * gravado E relido fechando a proposta com origem `dono`; qualquer outra coisa é `{ok:false, erro, mensagem}`. `opcoes.antes` é gancho de teste (corrida).
 */
export function julgarEmendaDono(cwd, seq, decisao, sessao, opcoes = {}) {
  try {
    if (!Number.isInteger(seq) || seq < 1) throw new Falha('argumento_invalido', `seq ${JSON.stringify(seq)}: esperado inteiro >= 1`);
    if (decisao !== 'aprovar' && decisao !== 'rejeitar') throw new Falha('argumento_invalido', `decisão ${JSON.stringify(decisao)}: esperado aprovar ou rejeitar`);
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) throw new Falha('argumento_invalido', `sessão fora da forma ${SESSAO_RE}`);
    const c = contexto(cwd, { sessao });
    return { ok: true, ...julgar(c, carregarPlano(c), seq, decisao, 'dono', opcoes.antes) };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro, mensagem: e.message };
    return { ok: false, erro: 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────── despacho

async function executar(argv, cwd) {
  const { cmd, pos, flags } = lerArgs(argv);
  const forma = validarForma(cmd, pos, flags);
  const c = contexto(cwd, cmd === 'emenda' && forma.sub === 'propor' ? { ...flags, sessao: SESSAO_EMENDAS } : flags);
  if (cmd === 'parar') return { ...gravarSemPlano(c, 'loop.parar', { motivo: forma.motivo }) };
  // Tudo que só depende dos argumentos (diff, tamanho, canário, caminhos) é conferido antes de abrir o plano e o diário.
  let propostaPronta;
  if (cmd === 'emenda' && forma.sub === 'propor') propostaPronta = prepararProposta(cwd, flags);
  if (cmd === 'desvio' || cmd === 'descoberta') {
    limitarTextos(forma.textos);
    limitarDados(forma.dados);
    const invalida = formaInvalida(cmd, forma.dados);
    if (invalida !== null) throw new Falha('argumento_invalido', invalida);
  }
  const plano = carregarPlano(c);
  const { task } = forma;
  switch (cmd) {
    case 'desvio': {
      const t = tarefa(plano, task);
      if (!Array.isArray(t.reqs) || !t.reqs.includes(forma.req)) throw new Falha('req_fora_da_task', `${forma.req} não está em \`reqs\` da task ${task}`);
      return { evento: gravar(c, plano, 'desvio', forma.dados) };
    }
    case 'descoberta': return { evento: gravar(c, plano, 'descoberta', forma.dados) };
    case 'emenda':
      if (forma.sub === 'propor') return propor(c, plano, propostaPronta);
      return julgarComoSombra(c, plano, forma.seq, forma.decisao);
    case 'proxima': return proxima(c, plano, flags);
    case 'aprendizado': case 'aprendizados': case 'pousar': case 'registro':
      return loopAprendizado[cmd]({ c, plano, gravar, lerDiarioEstrito, Falha, git }, pos, flags);
    case 'abrir': return abrir(c, plano, task);
    case 'fechar': tarefa(plano, task); return fechar(c, task);
    case 'integrar': return integrar(c, plano, task);
    case 'iniciar': {
      tarefa(plano, task);
      worktreeViva(c, task);
      const { modelo, aviso } = modeloDaInicio(c, forma.papel);
      return { evento: gravar(c, plano, 'task.iniciada', { task, papel: forma.papel, ...(modelo !== undefined ? { modelo } : {}) }), ...(aviso.length > 0 ? { aviso } : {}) };
    }
    case 'concluir': {
      tarefa(plano, task);
      const wt = worktreeViva(c, task);
      const sha = git(wt, 'rev-parse', `refs/heads/${ramo(c, task)}`);
      return { evento: gravar(c, plano, 'task.concluida', { task, sha }) };
    }
    case 'ci': return { evento: gravar(c, plano, 'ci.resultado', { verde: forma.verde, ...(forma.alvo !== undefined ? { alvo: forma.alvo } : {}) }) };
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

/** Estado da task segundo o núcleo, lendo o diário de forma estrita; diário que a tabela recusa ⇒ falha, nunca um estado inventado. */
function estadoDaTask(c, task) {
  const eventos = lerDiarioEstrito(c.dirEntrega);
  const ord = ordenar(eventos);
  if (!ord.ok) throw new Falha('diario_invalido', 'o diário da entrega não está em ordem');
  const r = estadoDe(ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task));
  if ('invalido' in r) throw new Falha('diario_invalido', `diário da task ${task} fora da tabela de transições: ${r.invalido}`);
  return { estado: r.estado, donos: eventos.filter((e) => e.tipo === 'task.reaberta' && e.dados?.task === task && e.dados?.origem === 'dono').length };
}

/**
 * Tira do caminho os achados do ciclo que terminou no teto: `<wt>/.tmp-gabarito/review-r*.md` da task vai por rename para
 * `.tmp-gabarito/ciclo-<n>/` (n = próximo livre), sem apagar. Sem isso o `veredito REPROVADO` do ciclo novo aceitaria achados velhos.
 * Worktree ou `.tmp-gabarito` ausente = nada a mover. `.tmp-gabarito` symlink/arquivo ⇒ `tmpdir_invalido`; rename que falha ⇒ `achados_nao_movidos`.
 */
function arquivarAchados(c, task) {
  const wt = caminhoWt(c, task);
  if (lstatOuNull(wt) === null) return;
  const tmp = validarTmp(wt);
  if (tmp === null) return;
  let nomes;
  try {
    nomes = readdirSync(tmp);
  } catch (e) {
    throw new Falha('achados_nao_movidos', `${TMP} ilegível (${e.code ?? e.message}); nada foi gravado`);
  }
  const achados = nomes.filter((n) => /^review-r\d+\.md$/.test(n));
  if (achados.length === 0) return;
  const usados = nomes.map((n) => /^ciclo-(\d+)$/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  const destino = join(tmp, `ciclo-${(usados.length ? Math.max(...usados) : 0) + 1}`);
  try {
    mkdirSync(destino);
    for (const n of achados) renameSync(join(tmp, n), join(destino, n));
  } catch (e) {
    throw new Falha('achados_nao_movidos', `não consegui mover os achados do ciclo anterior para ${relative(c.raiz, destino)} (${e.code ?? e.message}); a liberação não foi gravada`);
  }
}

/**
 * REQ-LOOP-2: a ÚNICA gravação de `task.reaberta {origem:"dono"}`. Fora de `ESPEC` de propósito: nenhum argumento do CLI chega aqui,
 * só o hook `UserPromptExpansion` (`liberar-teto.mjs`), disparado pelo comando que o dono digita. Exige `no_teto`, porque a tabela
 * aceita `reaberta.dono` como autotransição nos outros estados e gravar lá seria evento sem efeito que parece liberação.
 * Nunca lança: `{ok:true, task, estado}` só com o evento gravado E relido (um evento a mais para a task, estado `pendente`);
 * qualquer outra coisa é `{ok:false, erro, mensagem}` com 0 eventos novos pela via normal. Sem lock (limite do `gravar`).
 */
export function liberarTeto(cwd, task, sessao) {
  try {
    if (typeof task !== 'string' || !ID_RE.test(task)) throw new Falha('id_invalido', `task ${JSON.stringify(task)} fora da forma ${ID_RE}`);
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) throw new Falha('argumento_invalido', `sessão fora da forma ${SESSAO_RE}`);
    const c = contexto(cwd, { sessao });
    const plano = carregarPlano(c);
    tarefa(plano, task);
    const antes = estadoDaTask(c, task);
    if (antes.estado !== 'no_teto') throw new Falha('nao_esta_no_teto', `task ${task} está em ${antes.estado}; só task no teto de rodadas se libera. Nada foi gravado`);
    // Projeta o candidato NA ORDEM REAL (relógio de outra sessão pode pô-lo antes do teto): se a task não sairia de `no_teto`, recusa com 0 bytes.
    const projetar = (candidato, eventos) => {
      const ord = ordenar([...eventos, candidato]);
      if (!ord.ok) throw new Falha('diario_invalido', `a liberação de ${task} deixaria o diário fora de ordem; nada foi gravado`);
      const r = estadoDe(ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task));
      if ('invalido' in r || r.estado !== 'pendente') {
        throw new Falha('relogio_do_diario', `a liberação de ${task} não tiraria a task do teto: na ordem do diário o evento cairia antes do teto (um evento do diário tem relógio à frente do agora; estado projetado ${'invalido' in r ? r.invalido : r.estado}). Nada foi gravado`);
      }
      arquivarAchados(c, task); // última coisa antes do append: toda recusa acima deixa os achados onde estão
    };
    gravar(c, plano, 'task.reaberta', { task, origem: 'dono' }, projetar);
    // O que só o disco revela (o projetado não vê escrita parcial, outra sessão gravando no meio): reler e conferir.
    const depois = estadoDaTask(c, task);
    if (depois.donos !== antes.donos + 1 || depois.estado !== 'pendente') {
      throw new Falha('liberacao_sem_efeito', `o evento de ${task} foi gravado mas o diário relido não mostra a task fora do teto (estado ${depois.estado}, liberações ${antes.donos} → ${depois.donos}); confira o diário`);
    }
    return { ok: true, task, entrega: c.entrega, estado: depois.estado };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro, mensagem: e.message };
    return { ok: false, erro: 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * REQ-PNL-8: a ÚNICA gravação de `spec.aprovada {spec, sha256}`. Fora de `ESPEC` de propósito: nenhum argumento do CLI chega aqui, só o
 * hook `UserPromptExpansion` (`aprovar-spec.mjs`), disparado pelo comando que o dono digita. O sha é o de `shaDaSpec` (bytes, raiz principal).
 * "Já aprovada" = existe `spec.aprovada` de forma válida com o sha atual, sem ordem e sem olhar `spec` (a régua do painel): não entra em
 * transição nem depende de relógio. Nunca lança: `{ok:true, spec, sha256, entrega}` só com o evento gravado E relido (a contagem com esse sha
 * subiu, não "+1 exato": sem lock, duas sessões juntas gravam dois eventos iguais, limite do `gravar`); senão `{ok:false, erro, mensagem}`.
 * `opcoes.antes` e `opcoes.depois` são injeção de teste: `antes` roda logo antes de reler o sha e gravar, `depois` entre o append e a releitura.
 */
export function aprovarSpec(cwd, sessao, opcoes = {}) {
  try {
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) throw new Falha('argumento_invalido', `sessão fora da forma ${SESSAO_RE}`);
    const c = contexto(cwd, { sessao });
    const plano = carregarPlano(c);
    const atual = shaDaSpec(c.raiz, plano);
    if (!atual.ok) throw new Falha(atual.erro, `${atual.mensagem}; nada foi gravado`);
    const contar = (eventos) => eventos.filter((e) => e.tipo === 'spec.aprovada' && formaInvalida('spec.aprovada', e.dados) === null && e.dados.sha256 === atual.sha256).length;
    let antesN = 0;
    const conferir = (_candidato, eventos) => {
      antesN = contar(eventos);
      if (antesN > 0) throw new Falha('ja_aprovada', `a spec com o sha256 ${atual.sha256.slice(0, 12)}… já foi aprovada; só uma spec que mudou se aprova de novo. Nada foi gravado`);
      opcoes.antes?.();
      const de_novo = shaDaSpec(c.raiz, plano);
      if (!de_novo.ok || de_novo.sha256 !== atual.sha256) throw new Falha('spec_mudou', 'a spec mudou entre o cálculo do sha256 e a gravação; aprove de novo. Nada foi gravado');
    };
    gravar(c, plano, 'spec.aprovada', { spec: atual.spec, sha256: atual.sha256 }, conferir);
    opcoes.depois?.();
    // O que só o disco revela: reler e conferir que a aprovação com este sha subiu.
    if (contar(lerDiarioEstrito(c.dirEntrega)) <= antesN) {
      throw new Falha('aprovacao_sem_efeito', `o evento foi gravado mas o diário relido não mostra a aprovação do sha256 ${atual.sha256.slice(0, 12)}…; confira o diário`);
    }
    return { ok: true, spec: atual.spec, sha256: atual.sha256, entrega: c.entrega };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro, mensagem: e.message };
    return { ok: false, erro: 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
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

/**
 * `integrar` em processo, com o avaliador do gate injetável (`opcoes.avaliar`): só o teste usa, para dar ao gate uma resposta que o `gate-task` real
 * não dá (mortas > total). Mesma saída do CLI (`{ok, ...}`); nunca lança.
 */
export async function integrarComGate(cwd, task, opcoes = {}) {
  try {
    const forma = validarForma('integrar', [task], {});
    const c = contexto(cwd, { sessao: opcoes.sessao, entrega: opcoes.entrega });
    return { ok: true, ...(await integrar(c, carregarPlano(c), forma.task, opcoes)) };
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro, mensagem: e.message, ...e.extra };
    return { ok: false, erro: 'excecao', mensagem: e instanceof Error ? e.message : String(e) };
  }
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

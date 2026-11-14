#!/usr/bin/env node
/**
 * REQ-LOOP-3 e REQ-LOOP-2 pela borda — `loop.mjs`: worktree por task, integração com gate e próxima ação.
 *
 *   loop.mjs proxima [--vivos <n>] [--sessao <id>]    slots = `capacidade.mjs --medido`; `loop.slots` do config só reduz (sem calibração: 1 slot e aviso)
 *       `--sessao` (GM-14 FIEL-14): `percent` vem de `.harness/contexto/<sessao>.json` (mod; `em` <= 120 s), senão nulo; pouso pendente ⇒ nada novo despacha.
 *   loop.mjs abrir <task> | fechar <task> | integrar <task>
 *   loop.mjs iniciar <task> <implementador|revisor|correcao> [--modelo <haiku|sonnet|opus|fable>] | concluir <task> | reabrir <task>
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
 *   loop.mjs liberar <task> --origem sombra --hash <h>   (GM-14 T36, FIEL-15) a Sombra tira a task do teto, 1 vez por task e só a 1ª liberação; exige
 *       `sombra.libera_teto: true` em `origin/HEAD` (mesma leitura de `julga_emendas`), task `no_teto`, `<h>` = hash da PERGUNTA DE LIBERAÇÃO da task
 *       (`sombra.mjs perguntar --task <t> --libera-teto`) com `decisao.sombra` vigente `libera: true`, sem `fora_da_regra`, depois do veredito do teto na
 *       ordem do diário, com brief e resposta no disco. Recusa: `libera_teto_desligado`, `teto_sombra_esgotado`, `fora_do_teto`, `hash_invalido`,
 *       `sombra_nao_liberou` (decisão íntegra com `libera` ausente ou false; GM-14 T39) (e `relogio_do_diario`); nada gravado. `--origem` só aceita `sombra` (uso, rc 2): `dono` sai só de `liberarTeto`.
 *   loop.mjs aprendizado <E|A> <D|M> --regra --entra-em [--gatilho --eventos --fonte --numero --substitui] | aprendizado nada --gatilho --motivo | aprendizados [--para <destino>]
 *       (GM-13 T8; contrato e ordem de recusa em `loop-aprendizado.mjs`; `aprendizados` não exige entrega na branch).
 *   loop.mjs anotar --tipo <ideia|desvio|assunto|duvida|pendencia> --texto <t> [--entrega <ID>] [--sessao <id>] [--opcao <r>]…   (GM-14 REQ-DIA-2; sem plano)
 *       grava `nota` (forma da T1) e devolve `{ok, evento:{tipo:'nota', dados}, entrega, sessao}`; entrega = `--entrega`, senão a da branch, senão `_sem-id`.
 *   todos aceitam --entrega <GM-10> (senão vem da branch); os que gravam aceitam --sessao <id> (padrão `loop`).
 *
 * CONTRATO DE FALHA. Saída é UMA linha de JSON em stdout, sempre com `ok`; falha traz `erro` (código) e `mensagem`.
 * Dado ausente, corrompido ou ferramenta falhando nunca vira sucesso; rc 0 só com o efeito feito. Uso errado sai 2.
 *
 * QUEM GRAVA NO DIÁRIO. Só `iniciar` (task.iniciada), `concluir` (task.concluida), `veredito` (review.veredito),
 * `desvio`, `descoberta`, `emenda propor` (emenda.proposta) e `emenda julgar` (spec.emendada ou emenda.rejeitada, origem `sombra`; a origem `dono` sai só de
 * `julgarEmendaDono`, que o hook `emenda-dono.mjs` chama), `reabrir` (task.reaberta, SÓ origem `retomada`: nenhum argumento produz `dono`; `dono` sai só de `liberarTeto`, que o hook do comando humano `/gabarito-mestre:liberar` chama),
 * `liberar` (task.reaberta, SÓ origem `sombra` com o `hash` da decisão; GM-14 T36), `integrar` (task.integrada),
 * `ci` (ci.resultado), `parar` (loop.parar) e `anotar` (nota, GM-14: sem plano, sem tabela de transições; confere só a forma, o canário e a legibilidade do diário). `concluir` e `integrar` gravam o `sha`. `abrir` não grava no diário (grava o nome da base em `branch.<branch>.gabaritoBase` e o sha dela em `branch.<branch>.gabaritoBaseSha`)
 * e é idempotente: worktree registrada com HEAD na branch da task devolve o mesmo resultado com `ja_aberta: true`; qualquer outro estado recusa. Todo evento de task é conferido contra `TRANSICOES` ANTES de gravar:
 * o CLI nunca produz um diário que o núcleo recuse.
 *
 * LIMITES DECLARADOS (E3). (1) Com `sombra.julga_emendas: true` o orquestrador pode julgar a própria proposta com origem `sombra` sem consultar a
 * Sombra: nada liga o julgamento a uma `decisao.sombra`; a opção é do dono, em origin. (2) A regra (4) de `proximaAcao` conta todo `ci.resultado`
 * (homolog e PR juntos): o lado é o seguro, para mais cedo. (3) Dois `emenda propor` simultâneos validam fora do lock; o `proposta_seq` devolvido é
 * sempre o da própria linha. (4) O aviso de emenda depende de "posterior" entre sessões: relógio atrasado no julgamento cala o aviso (falso negativo).
 * (5) GM-14 T36 (furo 2): com `sombra.libera_teto: true` quem grava a prova é o orquestrador (`sombra.mjs registrar` transcreve a resposta da Sombra,
 * limite (1) de `sombra.mjs`): `liberar` exige a pergunta de liberação da task (hash recalculado aqui), a `sombra.consulta` dela, o brief e a resposta no
 * disco com o sha do texto e `libera: true` vigente; o que NÃO fecha é o orquestrador escrever ele mesmo a resposta "libera" sem ter despachado a Sombra.
 * A opção é do dono, em origin; o registro e o painel mostram cada liberação como "a Sombra liberou a <task>". (6) GM-14 T36 (furo 7): nada
 * distingue, no CLI, o orquestrador de um subagent que rode `loop.mjs liberar` (sem `agent_id` na borda, mesmo nível do Q14 de `liberar-teto.mjs`);
 * o teto de 1 liberação por task e a ordem (só a 1ª) limitam o dano a um ciclo a mais, visível.
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
import { PADROES } from '../lib/git.mjs';
import { aprendizadosVigentes, paraDestino } from '../dist/aprendizado.js';
import * as diario from '../dist/diario.js';
import { escopoDaTask, projetarEmendas, SESSAO_EMENDAS, validarJulgamento, validarProposta } from '../dist/emenda.js';
import { lerConfigEntrega, politicaEfetiva } from '../dist/entrega.js';
import { formaInvalida, formaNaGravacao, MOTIVOS_REENTREGA, REQ_RE } from '../dist/formas.js';
import { estadoDe, ordenar, podeIntegrar, proximaAcao, tasksCongeladas } from '../dist/loop.js';
import { pousoPendente } from '../dist/pouso-pendente.js';
import { temOnboarding } from './cartao-sessao.mjs';
import { normalizarCaminho, validarPlano } from '../dist/plano.js';
import { contarConsultas, hashPergunta, projetarDecisoes, textoAncora, trechoDoReq } from '../dist/sombra.js';
import { vigentes } from '../dist/diario-puro.js';
import { entregaPublicada } from '../dist/guarda.js';
import { idDaBranch } from '../dist/trilha.js';
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
const MODELOS_INICIAR = ['haiku', 'sonnet', 'opus', 'fable'];
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

/**
 * GM-14 T48 (emenda 43, FIEL-1 b/c, REQ-DIA-1): entrega PUBLICADA (a regra única `entregaPublicada` de `dist/guarda.js`, a mesma do painel, da guarda,
 * do cartão e do Stop) não recebe `task.*`, `sessao.*` nem `loop.parar`: o comando recusa ANTES de qualquer efeito (merge, achados movidos, evento).
 * `_sem-id` nunca é publicada. Os tipos vedados valem também dentro de `gravar` (os módulos que o recebem por injeção, como o `pousar`).
 */
function recusarSePublicada(c) {
  if (c.entrega === '_sem-id' || !entregaPublicada(c.raiz, c.entrega, c.sessao)) return;
  throw new Falha('entrega_publicada', `a entrega ${c.entrega} já está publicada (PR mergeado, sem outro aberto): task, sessão e parar não gravam nela; nada foi feito`);
}
const TIPO_VEDADO_EM_PUBLICADA = (tipo) => TIPOS_DE_TASK.includes(tipo) || tipo.startsWith('sessao.') || tipo.startsWith('guarda.') || tipo === 'operacao.destrutiva' || tipo === 'loop.parar';
const COMANDOS_VEDADOS_EM_PUBLICADA = new Set(['parar', 'iniciar', 'concluir', 'veredito', 'integrar', 'reabrir', 'liberar', 'pousar']);

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

/**
 * GM-14 T38 (DP-3 aj. 4): raiz do checkout DA SESSÃO (`git rev-parse --show-toplevel` do `cwd`, por `realpath`). A spec se lê daqui
 * (`lerSpecs`, `shaDaSpec`/`lerSpec`, `aprovarSpec`, REQ na spec), como `painel.mjs medir`; o diário segue na raiz principal (`raizPrincipal`).
 * Um leitor numa raiz e outro noutra daria "mudou depois" falso. Fora de repositório ⇒ `Falha('fora_de_repo')`.
 */
export function checkoutDaSessao(cwd) {
  try {
    return realpathSync(git(cwd, 'rev-parse', '--show-toplevel'));
  } catch (e) {
    throw new Falha('fora_de_repo', `não é um checkout git (${e.message})`);
  }
}

// ─────────────────────────────────────────────────────────────── entrada

/** Argumentos estritos. Flag desconhecida, sem valor ou repetida e posicional a mais ou a menos é uso (rc 2). */
function lerArgs(argv) {
  const [cmd, ...resto] = argv;
  const ESPEC = {
    proxima: { pos: 0, flags: ['entrega', 'vivos', 'sessao'] },
    abrir: { pos: 1, flags: ['entrega'] },
    fechar: { pos: 1, flags: ['entrega'] },
    integrar: { pos: 1, flags: ['entrega', 'sessao'] },
    iniciar: { pos: 2, flags: ['entrega', 'sessao', 'modelo'] },
    concluir: { pos: 1, flags: ['entrega', 'sessao', 'motivo'] },
    reabrir: { pos: 1, flags: ['entrega', 'sessao'] },
    liberar: { pos: 1, flags: ['entrega', 'sessao', 'origem', 'hash'], obrig: ['origem', 'hash'] },
    veredito: { pos: 5, flags: ['entrega', 'sessao'] },
    parar: { pos: 1, flags: ['entrega', 'sessao'] },
    ci: { pos: 1, flags: ['entrega', 'sessao', 'alvo'] },
    desvio: { pos: 1, flags: ['entrega', 'sessao', 'req', 'evidencia', 'arquivos', 'causa'], obrig: ['req', 'evidencia', 'arquivos', 'causa'] },
    descoberta: { pos: 0, flags: ['entrega', 'sessao', 'evidencia', 'causa'], obrig: ['evidencia', 'causa'] },
    // E5a (GM-13): `aprendizado` confere os posicionais e as flags por tipo em `loop-aprendizado.mjs` (uso, rc 2); `aprendizados` lê a árvore, sem entrega (T8).
    aprendizado: { pos: null, flags: ['entrega', 'sessao', 'regra', 'entra-em', 'gatilho', 'eventos', 'fonte', 'numero', 'substitui', 'motivo'] },
    aprendizados: { pos: 0, flags: ['para', 'exportar'], semValor: ['exportar'] },
    pousar: { pos: null, flags: ['entrega', 'sessao'] },
    registro: { pos: null, flags: ['entrega', 'sessao'] },
    emenda: { pos: null, flags: ['entrega', 'sessao', 'req', 'task', 'diff', 'fato', 'alternativa', 'evidencia', 'causa', 'arquivos'] },
  };
  const uso = 'uso: loop.mjs proxima | abrir|fechar|integrar|concluir|reabrir <task> | liberar <task> --origem sombra --hash <h> | concluir <task> --motivo <gate|sombra|dono> | iniciar <task> <papel> [--modelo <haiku|sonnet|opus|fable>] | veredito <task> <APROVADO|REPROVADO> <rodada> <blocker> <major> | parar <motivo> | ci <verde|vermelho> [--alvo homolog] | desvio <task> --req --evidencia --arquivos --causa | descoberta --evidencia --causa | emenda propor --req [--task] --diff --fato --alternativa --evidencia --causa [--arquivos] | emenda julgar <seq> <aprovar|rejeitar> | aprendizado <E|A> <D|M> --regra --entra-em [--gatilho --eventos --fonte --numero --substitui] | aprendizado nada --gatilho --motivo | aprendizados [--para <destino>] | aprendizados --exportar | pousar | registro | anotar --tipo <ideia|desvio|assunto|duvida|pendencia> --texto <t> [--opcao <r>]…  [--entrega GM-10]';
  if (typeof cmd !== 'string' || !Object.hasOwn(ESPEC, cmd)) throw new Falha('uso', `comando desconhecido ou ausente. ${uso}`, {}, 2);
  const esp = ESPEC[cmd];
  const pos = [];
  const flags = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a.startsWith('--')) {
      const nome = a.slice(2);
      if (!esp.flags.includes(nome)) throw new Falha('uso', `argumento desconhecido para ${cmd}: ${a}. ${uso}`, {}, 2);
      if (esp.semValor?.includes(nome)) { if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${uso}`, {}, 2); flags[nome] = true; continue; }
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
  if (cmd === 'liberar') {
    // GM-14 T36: a origem é só `sombra` (uso, rc 2): nenhum argumento produz `dono`. O hash fora da forma é motivo, não uso (FIEL-15 b).
    if (flags.origem !== 'sombra') throw new Falha('uso', `liberar só aceita --origem sombra (a liberação do dono é o comando /gabarito-mestre:liberar); veio ${JSON.stringify(flags.origem)}`, {}, 2);
    return { task, hash: flags.hash };
  }
  if (cmd === 'concluir') {
    // FIEL-8 b6: o motivo da reentrega é forma; fora dos 3 literais recusa antes de abrir plano ou diário.
    if (flags.motivo !== undefined && !MOTIVOS_REENTREGA.includes(flags.motivo)) {
      throw new Falha('argumento_invalido', `--motivo ${JSON.stringify(flags.motivo)}: esperado um de ${MOTIVOS_REENTREGA.join(' | ')}; nada foi gravado`);
    }
    return { task, motivo: flags.motivo };
  }
  if (cmd === 'iniciar') {
    // FIEL-3 (a): `spike` não é papel do diário; o spike entra como `implementador` (o papel visível vem do tipo da task).
    if (pos[1] === 'spike') throw new Falha('papel_invalido', 'o papel "spike" não existe no diário: inicie o spike como `implementador`; nada foi gravado');
    if (!PAPEIS.includes(pos[1])) throw new Falha('papel_invalido', `papel "${pos[1]}" fora da lista: ${PAPEIS.join(', ')}`);
    // FIEL-3 (c): o modelo real do despacho; a lista é a da forma `task.iniciada.modelo` (MODELOS_TASK em formas.ts).
    if (flags.modelo !== undefined && !MODELOS_INICIAR.includes(flags.modelo)) {
      throw new Falha('argumento_invalido', `--modelo ${JSON.stringify(flags.modelo)}: esperado um de ${MODELOS_INICIAR.join(' | ')}; nada foi gravado`);
    }
    return { task, papel: pos[1], modelo: flags.modelo };
  }
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

/**
 * `fluxo.idPadrao` de `origin/HEAD`, a chave que a guarda e o painel leem (GM-14 T15, REQ-TRI-1): ausente, não texto, longo ou regex
 * inválida ⇒ o padrão de `lib/git.mjs`. Nunca lança.
 */
function idPadraoDe(raiz) {
  const v = lerConfigOrigin(raiz)?.cfg?.fluxo?.idPadrao;
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) return PADROES.idPadrao;
  try { new RegExp(v); } catch { return PADROES.idPadrao; }
  return v;
}

/**
 * Exportada para o painel (E4, T9): a MESMA regra de raiz principal, entrega por branch ou `--entrega`.
 * Da branch, a entrega é `idDaBranch` (T3, a mesma de `trilhaDe`); `ENTREGA_RE` segue valendo porque o ID vira diretório.
 */
export function contexto(cwd, flags) {
  const raiz = raizPrincipal(cwd);
  let entrega = flags.entrega;
  if (entrega === undefined) {
    let branch = '';
    try { branch = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'); } catch { /* sem branch */ }
    entrega = idDaBranch(branch, idPadraoDe(raiz)) ?? undefined;
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

/** FIEL-8 b3/b4: o que a recusa da tabela diz ao orquestrador sobre `concluir` (entrega e reentrega). */
const DICA_REENTREGA = {
  em_revisao: 'revisor em voo: espere o veredito',
  reprovada: 'o caminho é a correção',
  no_teto: 'só o dono tira do teto',
};
function dicaDaTabela(tipo, dados, invalido) {
  if (tipo !== 'task.concluida') return '';
  const m = /^(task\.concluida|concluida\.reentrega) em (\w+)$/.exec(invalido);
  if (m === null) return '';
  if (m[1] === 'task.concluida' && (m[2] === 'concluida' || m[2] === 'aprovada')) {
    return ` (commit novo depois do concluir: \`concluir ${dados.task} --motivo <gate|sombra|dono>\`)`;
  }
  return m[1] === 'concluida.reentrega' && Object.hasOwn(DICA_REENTREGA, m[2]) ? ` (${DICA_REENTREGA[m[2]]})` : '';
}

/**
 * Confere o evento contra a tabela e SÓ ENTÃO grava. O diário atual já inválido recusa (nada piora um diário quebrado);
 * a transição que a tabela não aceita recusa com a causa. Limite declarado: sem lock em volta do par ler+gravar, dois
 * CLIs simultâneos sobre a mesma task podem passar juntos pela conferência.
 */
function gravar(c, plano, tipo, dados, antes = () => {}) {
  if (TIPO_VEDADO_EM_PUBLICADA(tipo)) recusarSePublicada(c);
  const eventos = lerDiarioEstrito(c.dirEntrega);
  // `plano === null` só da aprovação antes do plano (T15): sem plano não há tabela; vale a leitura estrita, a forma e o canário.
  // Desvio da letra da DP-3 aj. 2 ("não passa por gravar"), não do fim: `gravarSemPlano` não tem leitura estrita nem o `antes` onde vivem
  // `ja_aprovada` e `spec_mudou`; passar por aqui com `null` pula só `diarioInvalido`, que pressupõe plano. Nenhum tipo de task chega com `null`.
  if (plano !== null && diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega já não passa na tabela de transições; nada foi gravado');
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
      const dica = esperada !== null && !('invalido' in esperada) ? ` (rodada esperada: ${esperada.rodada + 1})` : dicaDaTabela(tipo, dados, r.invalido);
      throw new Falha('transicao_invalida', `${tipo} não cabe na tabela para a task ${dados.task}: ${r.invalido}${dica}; nada foi gravado`);
    }
    if (diarioInvalido(plano, [...eventos, candidato])) throw new Falha('transicao_invalida', `${tipo} tornaria o diário inválido; nada foi gravado`);
  }
  // Emenda 12: a borda nova sempre grava `sha` no `iniciar revisor` e no APROVADO (a leitura da 2.0.0 aceita a ausência; a gravação, não).
  const naGravacao = formaNaGravacao(tipo, dados);
  if (naGravacao !== null) throw new Falha('forma_invalida', `${naGravacao}; nada foi gravado`);
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
  let baseSha;
  try {
    baseSha = git(c.raiz, 'rev-parse', 'HEAD');
    git(c.raiz, 'worktree', 'add', '-b', branch, caminho, baseSha);
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
    // FIEL-9 (a6, Emenda 2): `gabaritoBase` guarda o NOME da base; o sha dela no abrir é o que separa "commit próprio" de "nada entregue".
    git(c.raiz, 'config', `branch.${branch}.gabaritoBaseSha`, baseSha);
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
  recusarSePublicada(c);
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
  // Emenda 12 (FIEL-8 c): o último APROVADO na ordem precisa ser do `revisado`; ordem torta (relógio entre sessões) recusa, nunca integra.
  // APROVADO sem `sha` (diário 2.0.0) segue só a guarda por ordem acima.
  const aprovado = (ord.ok ? ord.eventos : []).filter((e) => e.tipo === 'review.veredito' && e.dados?.task === task && e.dados?.veredito === 'APROVADO').at(-1);
  if (aprovado !== undefined && Object.hasOwn(aprovado.dados, 'sha') && aprovado.dados.sha !== revisado) {
    throw new Falha('commit_nao_revisado', `o último APROVADO de ${task} é do commit ${String(aprovado.dados.sha).slice(0, 12)}, não do ${revisado.slice(0, 12)} que entraria: há commit que ninguém revisou; nada foi feito`, nada);
  }
  // (a6) FIEL-9: o sha aprovado (`revisado`, lido 1 vez do último task.concluida e já comparado com o HEAD em (a5)) já está na base?
  // 0 ⇒ caminho "já na base"; 1 ⇒ caminho normal; qualquer outro código ⇒ não sei, nada é feito.
  let naBase = (opcoes.ancestral ?? ehAncestral)(c.raiz, revisado, `refs/heads/${base}`);
  // Emenda 2: o caminho (b) só vale com ao menos 1 commit próprio desde a base do `abrir` (o aprovado nem igual nem ancestral dela).
  // Sem commit próprio, ou sem o sha da base gravado para provar, segue o caminho normal, que recusa como antes no gate (A3: 0 commits contra a base).
  if (naBase === 0) {
    let baseAbrir = '';
    try { baseAbrir = git(c.raiz, 'config', '--get', `branch.${branch}.gabaritoBaseSha`); } catch { /* ausente: sem prova */ }
    const proprio = baseAbrir === '' ? 0 : (opcoes.ancestral ?? ehAncestral)(c.raiz, revisado, baseAbrir);
    if (proprio !== 0 && proprio !== 1) {
      throw new Falha('ancestral_indeterminado', `git merge-base --is-ancestor ${revisado.slice(0, 12)} ${baseAbrir.slice(0, 12)} saiu com ${proprio === null ? 'sinal ou erro' : `código ${proprio}`}: não sei se ${task} tem commit próprio desde a base do abrir; nada foi feito`, nada);
    }
    // Emenda 3: exceção DECLARADA, nunca implícita — um `desvio` da mesma task citando o sha aprovado (T0 commitada na base antes do `abrir`).
    if (proprio === 0 && !desvioCitaSha(c, ord.ok ? ord.eventos : [], task, revisado)) naBase = 1;
  }
  if (naBase === 0) return integrarJaNaBase(c, plano, ord.ok ? ord.eventos : [], task, branch, base, revisado);
  if (naBase !== 1) {
    throw new Falha('ancestral_indeterminado', `git merge-base --is-ancestor ${revisado.slice(0, 12)} ${base} saiu com ${naBase === null ? 'sinal ou erro' : `código ${naBase}`}: não sei se o commit aprovado já está na base; nada foi feito`, nada);
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

/**
 * Emenda 3 (FIEL-9 a6): algum `desvio` da MESMA task cita o sha aprovado em `evidencia` ou num item de `arquivos`? Cita = um token hexadecimal
 * minúsculo isolado (fronteira de palavra, 7 a 40 caracteres) que é o sha completo, ou prefixo dele com >= 7 que o git resolve SÓ para ele
 * (`rev-parse --verify` recusa prefixo ambíguo). Menos de 7, maiúsculas, colado a outra letra ou com caractere a mais: não cita.
 */
function desvioCitaSha(c, eventos, task, sha) {
  const cita = (tok) => {
    if (tok === sha) return true;
    if (tok.length >= 40 || !sha.startsWith(tok)) return false;
    try { return git(c.raiz, 'rev-parse', '--verify', '--quiet', '--end-of-options', tok) === sha; } catch { return false; }
  };
  return eventos.some((e) => {
    if (e.tipo !== 'desvio' || e.dados?.task !== task) return false;
    const textos = [e.dados.evidencia, ...(Array.isArray(e.dados.arquivos) ? e.dados.arquivos : [])].filter((t) => typeof t === 'string');
    return textos.some((t) => (t.match(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g) ?? []).some(cita));
  });
}

/** `git merge-base --is-ancestor`: o código de saída (0 é ancestral, 1 não é), `null` se o git nem rodou ou morreu por sinal. */
function ehAncestral(cwd, ancestral, descendente) {
  const r = spawnSync('git', ['-C', cwd, 'merge-base', '--is-ancestor', ancestral, descendente], { stdio: 'ignore', env: ambienteGit() });
  return r.error ? null : r.status;
}

/**
 * FIEL-9 (b4): o que já verificou o commit que entrou direto na base. (i) a 1ª integração com gate (sem `ja_na_base`) cujo sha descende dele;
 * senão (ii) o próximo integrar, só se resta task do plano fora de `integrada`; senão (iii) a CI do pedido de revisão. Nunca promete integração que não virá.
 */
function coberturaJaNaBase(c, plano, ord, task, alvo) {
  const cobriu = ord.find((e) => e.tipo === 'task.integrada' && e.dados?.ja_na_base !== true && typeof e.dados?.sha === 'string' && ehAncestral(c.raiz, alvo, e.dados.sha) === 0);
  if (cobriu !== undefined) return `o gate da integração de ${cobriu.dados.task} já rodou sobre ele`;
  const integrada = (id) => {
    const r = estadoDe(ord.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === id));
    return !('invalido' in r) && r.estado === 'integrada';
  };
  const resta = plano.tasks.some((t) => t.id !== task && !integrada(t.id));
  return resta
    ? 'nenhum gate rodou sobre ele ainda; o próximo integrar roda sobre ele'
    : 'nenhum gate rodou sobre ele e não há outro integrar: a CI do pedido de revisão é a 1ª verificação, e o merge espera ela verde';
}

/**
 * FIEL-9 (b): o commit aprovado já é ancestral da base. Sem rebase, sem gate, sem merge: a branch e a base não se movem. Grava `task.integrada`
 * com o MESMO `alvo` que (a5) comparou e (a6) testou (nada é relido) e fecha a worktree como o caminho normal.
 */
function integrarJaNaBase(c, plano, ord, task, branch, base, alvo) {
  const aviso = `aviso: ${task} já estava na base (${alvo.slice(0, 12)} é ancestral de ${base}): integrada sem merge, sem rebase e sem gate; ${coberturaJaNaBase(c, plano, ord, task, alvo)}`;
  try {
    gravar(c, plano, 'task.integrada', { task, sha: alvo, ja_na_base: true });
  } catch (e) {
    const causa = e instanceof Falha ? `${e.erro}: ${e.message}` : String(e.message ?? e);
    throw new Falha('evento_nao_gravado', `${task} já estava na base, mas o evento task.integrada NÃO foi gravado (${causa}); nada foi movido e fechar não foi chamado`, { merge: false, evento: false });
  }
  let fechada;
  try {
    fechada = fechar(c, task);
  } catch (e) {
    const causa = e instanceof Falha ? `${e.erro}: ${e.message}` : String(e.message ?? e);
    throw new Falha('fechar_falhou', `${task} já estava na base e o evento task.integrada foi gravado, mas fechar falhou (${causa})`, { merge: false, evento: true, causa: e.erro });
  }
  return { task, branch, base, merge: false, ja_na_base: true, evento: true, fechada: true, banco: fechada.banco, ignorados_removidos: fechada.ignorados_removidos, relato: [aviso] };
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

  const percent = percentDaSessao(c.raiz, flags.sessao);
  // `podePousar`: o pouso sem mod é `loop.mjs pousar` (REQ-POU-3); a skill o executa quando `proxima` devolve `pousar` (GM-14 FIEL-14 c).
  return { sinais: { slots, percent, x, pausado, vivos, tokens, tetoTokens, podePousar: true }, aviso };
}

const CONTEXTO_VALIDADE_MS = 120_000;
/**
 * GM-14 T34 (FIEL-14 b): `percent` da sessão do Claude, lido de `<raiz>/.harness/contexto/<sessao>.json` (`{percent, fonte, em}`, gravado pelo mod).
 * Só o arquivo DESSA sessão conta; sem `--sessao`, arquivo ausente, ilegível, fora da forma, `em` velho (> 120 s) ou do futuro (> 5 s) ⇒ `null`
 * (como na 2.0: `percent` nulo não pousa). Nunca lança.
 */
export function percentDaSessao(raiz, sessao, agoraMs = Date.now()) {
  if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) return null;
  let j;
  try { j = JSON.parse(readFileSync(join(raiz, '.harness', 'contexto', `${sessao}.json`), 'utf8')); } catch { return null; }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return null;
  if (typeof j.percent !== 'number' || !Number.isFinite(j.percent) || j.percent < 0 || j.percent > 100) return null;
  if (typeof j.em !== 'string') return null;
  const em = Date.parse(j.em);
  if (!Number.isFinite(em)) return null;
  const idade = agoraMs - em;
  return idade >= -5_000 && idade <= CONTEXTO_VALIDADE_MS ? j.percent : null;
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
  // FIEL-14 e: a regra única (`pouso-pendente.ts`), a mesma que o painel passa a `dependeDe`.
  const acao = proximaAcao(plano, eventos, { ...sinais, politica: pol.politica, pousoPendente: pousoPendente(eventos, temOnboarding(c.raiz)).pendente });
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
  // A árvore de aprendizados é lida UMA vez por chamada (nunca por item); só quando há o que despachar.
  const extra = { cfg, ordenados, est, decisoes: projetarDecisoes(eventos), vigentes: acao.tipo === 'despachar' ? aprendizadosDaArvore(c, aviso) : [] };
  return { acao: acao.tipo === 'despachar' ? { ...acao, itens: acao.itens.map((i) => enriquecer(c, plano, eventos, i, aviso, extra)) } : acao, sinais, ...(aviso.length ? { aviso } : {}) };
}

/** Aprendizados vigentes da árvore (todas as entregas). Entrega ilegível vira aviso; falha na leitura nunca derruba o despacho (lista vazia e aviso). */
function aprendizadosDaArvore(c, aviso) {
  try {
    const { porEntrega, avisos } = diario.lerAprendizados(join(c.raiz, '.harness', 'entregas'));
    aviso.push(...avisos);
    return aprendizadosVigentes(porEntrega);
  } catch (e) {
    aviso.push(`aprendizados: leitura da árvore falhou (${e instanceof Error ? e.message : String(e)}); itens despachados sem aprendizados`);
    return [];
  }
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
 * FIEL-8 b8: o revisor revê o diff INTEIRO, `<gabaritoBase>...<sha do último task.concluida>`, nunca `<sha anterior>..<sha novo>`;
 * se esse último foi reentrega, `reentrega: <motivo>`. Sem base gravada ou sem sha: `diff: null` e aviso (nunca inventa base nem diff parcial).
 */
function diffDoRevisor(c, eventos, task, aviso) {
  const ord = ordenar(eventos);
  const ultimo = (ord.ok ? ord.eventos : []).filter((e) => e.tipo === 'task.concluida' && e.dados?.task === task).at(-1);
  const branch = ramo(c, task);
  let base = '';
  try { base = git(c.raiz, 'config', '--get', `branch.${branch}.gabaritoBase`); } catch { /* ausente */ }
  const sha = ultimo?.dados?.sha;
  const reentrega = typeof ultimo?.dados?.motivo === 'string' ? { reentrega: ultimo.dados.motivo } : {};
  if (base === '' || typeof sha !== 'string' || sha === '') {
    aviso.push(`diff da task ${task} indeterminado (${base === '' ? `sem branch.${branch}.gabaritoBase` : 'último task.concluida sem sha'}): o revisor lê o diff inteiro desde a base da worktree`);
    return { diff: null, ...reentrega };
  }
  return { diff: `${base}...${sha}`, ...reentrega };
}

/**
 * O item de despacho carrega o que o /clear apaga: `spec` (ponteiro do topo do plano), `modelo`, `decisoes`, `aprendizados` (regras D do brief deste papel) e `emendas` (as aprovadas dos REQs da task: o
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
    // E5a (GM-13): as regras D vigentes que entram no brief DESTE papel (`brief:<papel>` exato; M nunca entra).
    aprendizados: paraDestino(extra.vigentes, `brief:${item.papel}`).map((a) => a.regra),
  };
  if (item.papel === 'revisor') return { ...saida, ...diffDoRevisor(c, eventos, item.task, aviso) };
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
 * Base única de `reqNaSpec` e `shaDaSpec`: a spec que prova um REQ é a mesma que o dono aprova. `raiz` = checkout da sessão
 * (`checkoutDaSessao`, T38), nunca a principal. Nunca lança.
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
 * São os BYTES do arquivo no CHECKOUT DA SESSÃO (`checkoutDaSessao`, T38: DP-3 aj. 4), sem decodificar. Nunca lança.
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

const SPEC_MAX = 4 * 1024 * 1024;
const ausenteFs = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';

/**
 * GM-14 T15 (REQ-TRI-1): as specs de `docs/superpowers/specs/*.md` da raiz dada, em ordem de nome, como `SpecFato` de `trilha.ts`:
 * `{caminho, pbi, sha256, secoes, titulo}`. `pbi` = o 1º token `PBI: <ID>` do CABEÇALHO (DP-3 aj. 1, a regra de `painel-medir.mjs`
 * `pbiDoCabecalho`): só linhas antes do 1º `## ` e entre as 15 primeiras; token precedido de início, espaço ou `·` e o ID inteiro (sem
 * `[A-Za-z0-9-]` depois) casando `idPadrao` ancorado; senão `null`. O corpo nunca conta. `sha256` dos bytes; `secoes` = linhas `## `;
 * `titulo` = o 1º `# `. Não arquivo regular ou maior que 4 MiB fica de fora. Diretório ausente ⇒ `[]`; ilegível ⇒ lança
 * `Falha('specs_ilegiveis')`: falha de leitura nunca vira "sem spec". `idPadrao` ausente ⇒ `fluxo.idPadrao` de origin (`idPadraoDe`).
 */
export function lerSpecs(raiz, idPadrao = idPadraoDe(raiz)) {
  let reId;
  try { reId = new RegExp(`^(?:${idPadrao})$`); } catch { reId = new RegExp(`^(?:${PADROES.idPadrao})$`); }
  const dir = join(raiz, 'docs', 'superpowers', 'specs');
  let nomes;
  try {
    nomes = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch (e) {
    if (ausenteFs(e)) return [];
    throw new Falha('specs_ilegiveis', `não consegui listar as specs (${e.code ?? 'erro'})`);
  }
  const specs = [];
  for (const nome of nomes) {
    const arq = join(dir, nome);
    let st;
    try { st = lstatSync(arq); } catch (e) { throw new Falha('specs_ilegiveis', `não consegui ler ${nome} (${e.code ?? 'erro'})`); }
    if (!st.isFile() || st.size > SPEC_MAX) continue;
    let bytes;
    try { bytes = readFileSync(arq); } catch (e) { throw new Falha('specs_ilegiveis', `não consegui ler ${nome} (${e.code ?? 'erro'})`); }
    const linhas = bytes.toString('utf8').split('\n');
    let pbi = null;
    for (const l of linhas.slice(0, 15)) {
      if (/^##\s/.test(l)) break;
      const m = /(?:^|[\s·])PBI:\s*([A-Za-z0-9-]+)(?![A-Za-z0-9-])/.exec(l.slice(0, 400));
      if (m !== null) { pbi = reId.test(m[1]) ? m[1] : null; break; }
    }
    const t = linhas.find((l) => l.startsWith('# '));
    specs.push({
      caminho: `docs/superpowers/specs/${nome}`, pbi, sha256: createHash('sha256').update(bytes).digest('hex'),
      secoes: linhas.filter((l) => l.startsWith('## ')).length, titulo: t === undefined ? '' : t.slice(2).trim(),
    });
  }
  return specs;
}

/** REQ com trecho na spec do plano. Spec ausente, ilegível ou fora da raiz ⇒ `false` (sem a spec não há como provar o REQ). */
function reqNaSpec(c, plano, req) {
  const r = caminhoDaSpec(checkoutDaSessao(c.cwd), plano);
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

/**
 * `sessao` de `anotar`: a mesma forma do `<sessao>` de `IdPergunta` (`[A-Za-z0-9-]{1,128}`, sem `.` nem `_`, que o `SESSAO_RE` do diário aceita) e
 * diferente de `herdar` (`herdar:<n>` é a forma do id herdado). Uma `duvida` gravada numa sessão fora disso viraria pergunta que ninguém responde.
 */
const SESSAO_PERGUNTA_RE = /^[A-Za-z0-9-]{1,128}$/;

/** Leitor de `anotar`: `--opcao` se repete (2–4 na `duvida`), as demais flags não; sem posicional. Uso errado sai 2. */
function lerArgsAnotar(argv) {
  const uso = 'uso: loop.mjs anotar --tipo <ideia|desvio|assunto|duvida|pendencia> --texto <t> [--entrega <ID>] [--sessao <id>] [--opcao <r>]…';
  const flags = {};
  const opcoes = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Falha('uso', `anotar não tem argumento posicional (${JSON.stringify(a)}). ${uso}`, {}, 2);
    const nome = a.slice(2);
    if (!['tipo', 'texto', 'entrega', 'sessao', 'opcao'].includes(nome)) throw new Falha('uso', `argumento desconhecido para anotar: ${a}. ${uso}`, {}, 2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Falha('uso', `${a} sem valor. ${uso}`, {}, 2);
    if (nome === 'opcao') opcoes.push(v);
    else if (Object.hasOwn(flags, nome)) throw new Falha('uso', `${a} repetido. ${uso}`, {}, 2);
    else flags[nome] = v;
    i++;
  }
  for (const nome of ['tipo', 'texto']) if (!Object.hasOwn(flags, nome)) throw new Falha('uso', `anotar exige --${nome}. ${uso}`, {}, 2);
  return { flags, opcoes };
}

/**
 * Destino: `--entrega`; senão a entrega da branch (a regra de `contexto`); senão `_sem-id`. `--entrega` diferente da branch grava nela e só nela:
 * a nota não identifica entrega (quem identifica é o painel, por um 2º fato). Fora de repositório falha: sem raiz não há diário.
 */
function destinoDeAnotar(cwd, flags) {
  try {
    return contexto(cwd, flags);
  } catch (e) {
    if (!(e instanceof Falha) || e.erro !== 'entrega_nao_inferida') throw e;
    const raiz = raizPrincipal(cwd);
    return { cwd, raiz, entrega: '_sem-id', dirEntrega: diario.dirEntrega(raiz, null), sessao: flags.sessao ?? 'loop' };
  }
}

/**
 * `anotar` (GM-14, REQ-DIA-2): grava `nota` sem plano. Ordem: uso (2) ⇒ forma da T1 (tipo, 1 linha, até 160 CARACTERES, opções 2–4 só na `duvida`)
 * ⇒ canário no texto e em cada opção ⇒ entrega e raiz ⇒ diário legível ⇒ `diario.append`. Recusa em qualquer passo: rc 1, `erro` com o motivo
 * (nunca o valor), nada gravado. Diário ausente cria a pasta; diário com linha ilegível ou cadeia quebrada recusa (`diario_ilegivel`): anotar não piora o que já quebrou.
 */
function anotar(argv, cwd) {
  const { flags, opcoes } = lerArgsAnotar(argv);
  if (flags.entrega !== undefined && !ENTREGA_RE.test(flags.entrega)) throw new Falha('entrega_invalida', `--entrega "${flags.entrega}" fora da forma ${ENTREGA_RE}`);
  if (flags.sessao !== undefined && (!SESSAO_PERGUNTA_RE.test(flags.sessao) || flags.sessao === 'herdar')) {
    throw new Falha('argumento_invalido', `--sessao fora da forma ${SESSAO_PERGUNTA_RE} (ou "herdar"): a pergunta da nota se chamaria <sessao>:<n> e ninguém a responderia`);
  }
  const dados = { tipo: flags.tipo, texto: flags.texto, ...(opcoes.length > 0 ? { opcoes } : {}) };
  const invalida = formaInvalida('nota', dados);
  if (invalida !== null) throw new Falha('forma_invalida', `${invalida}; nada foi gravado`);
  for (const [nome, v] of [['texto', flags.texto], ...opcoes.map((o, i) => [`opcao ${i + 1}`, o])]) {
    const padrao = diario.recusaCanario(v);
    if (padrao !== null) throw new Falha('segredo_na_nota', `${nome} casa o canário de segredo (${padrao}); nada foi gravado`);
  }
  const c = destinoDeAnotar(cwd, flags);
  lerDiarioEstrito(c.dirEntrega);
  let autor = 'desconhecido';
  try { autor = git(c.raiz, 'config', 'user.email') || autor; } catch { /* sem user.email: o diário aceita "desconhecido" */ }
  const r = diario.append(c.dirEntrega, c.sessao, { ts: new Date().toISOString(), autor, sessao: c.sessao, agente: 'orquestrador', tipo: 'nota', dados });
  if (!r.ok) throw new Falha(/^forma_invalida: /.test(r.erro) ? 'forma_invalida' : 'evento_nao_gravado', `nota não gravada: ${r.erro}`);
  if (r.gravado !== 'evento') throw new Falha('evento_nao_gravado', 'nota recusada pelo diário (canário ou tamanho)');
  return { evento: { tipo: 'nota', dados }, entrega: c.entrega, sessao: c.sessao };
}

async function executar(argv, cwd) {
  // Desvia antes de `lerArgs`: `--opcao` se repete (2–4), o que o leitor comum recusa como flag repetida.
  if (argv[0] === 'anotar') return anotar(argv.slice(1), cwd);
  const { cmd, pos, flags } = lerArgs(argv);
  const forma = validarForma(cmd, pos, flags);
  // `aprendizados` lê a árvore da raiz principal: não depende da entrega da branch nem de plano (D-P1c-5), então desvia ANTES de `contexto` e `carregarPlano`.
  if (cmd === 'aprendizados') return loopAprendizado.aprendizados({ cwd, raizPrincipal, Falha }, pos, flags);
  // Uso, conversão e canário do `aprendizado` só dependem dos argumentos: conferidos antes de abrir entrega, plano e diário.
  const aprendizadoPronto = cmd === 'aprendizado' ? loopAprendizado.preparar(Falha, pos, flags) : undefined;
  const c = contexto(cwd, cmd === 'emenda' && forma.sub === 'propor' ? { ...flags, sessao: SESSAO_EMENDAS } : flags);
  if (COMANDOS_VEDADOS_EM_PUBLICADA.has(cmd)) recusarSePublicada(c);
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
    case 'aprendizado': case 'pousar': case 'registro':
      // T38: a spec do registro é a do checkout da sessão, a mesma que `aprovarSpec` grava (o `raiz` que o módulo passa é ignorado).
      const shaDoCheckout = (_raiz, p) => shaDaSpec(checkoutDaSessao(c.cwd), p);
      return loopAprendizado[cmd]({ c, plano, gravar, lerDiarioEstrito, Falha, git, shaDaSpec: shaDoCheckout, pronto: aprendizadoPronto }, pos, flags);
    case 'abrir': return abrir(c, plano, task);
    case 'fechar': tarefa(plano, task); return fechar(c, task);
    case 'integrar': return integrar(c, plano, task);
    case 'iniciar': {
      tarefa(plano, task);
      worktreeViva(c, task);
      // `--modelo` (o do despacho) vence o config; sem o flag, o da 2.0.0 (família do config para o papel).
      const { modelo: doConfig, aviso } = modeloDaInicio(c, forma.papel);
      const modelo = forma.modelo ?? doConfig;
      // Emenda 12: o revisor revê o sha do último task.concluida (o `<sha>` do diff do item, b8); o APROVADO copia este valor.
      const sha = forma.papel === 'revisor' ? ultimoDaTask(c, task, (e) => e.tipo === 'task.concluida')?.dados?.sha : undefined;
      const dados = { task, papel: forma.papel, ...(modelo !== undefined ? { modelo } : {}), ...(sha !== undefined ? { sha } : {}) };
      return { evento: gravar(c, plano, 'task.iniciada', dados), ...(aviso.length > 0 ? { aviso } : {}) };
    }
    case 'concluir': {
      tarefa(plano, task);
      const wt = worktreeViva(c, task);
      const sha = git(wt, 'rev-parse', `refs/heads/${ramo(c, task)}`);
      // FIEL-8 b5 (e 4.i do P1, PROVISÓRIO): o sha do último task.concluida da task já foi entregue; sem commit novo não há o que revisar.
      const shaIgual = (_candidato, eventos) => {
        const ord = ordenar(eventos);
        const ultimo = (ord.ok ? ord.eventos : []).filter((e) => e.tipo === 'task.concluida' && e.dados?.task === task).at(-1);
        if (ultimo?.dados?.sha === sha) throw new Falha('sha_igual', `o sha ${sha.slice(0, 12)} é o do último task.concluida de ${task}: faça o commit novo antes de concluir; nada foi gravado`);
      };
      return { evento: gravar(c, plano, 'task.concluida', { task, sha, ...(forma.motivo !== undefined ? { motivo: forma.motivo } : {}) }, shaIgual) };
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
      // Emenda 12: o APROVADO COPIA o sha do último `iniciar revisor` (nunca recalcula do diário) e o HEAD da branch tem de ser ele.
      const aprovado = forma.veredito === 'APROVADO';
      const sha = aprovado ? ultimoDaTask(c, task, (e) => e.tipo === 'task.iniciada' && e.dados?.papel === 'revisor')?.dados?.sha : undefined;
      const conferir = () => {
        exigirAchados();
        if (!aprovado || typeof sha !== 'string') return;
        let head = '';
        try { head = git(c.raiz, 'rev-parse', `refs/heads/${ramo(c, task)}`); } catch { /* sem branch */ }
        if (head !== sha) {
          throw new Falha('sha_diferente', `o HEAD de ${ramo(c, task)} (${head === '' ? 'ausente' : head.slice(0, 12)}) não é o sha ${sha.slice(0, 12)} que o revisor recebeu no iniciar: o APROVADO não vale para commit que ele não viu; nada foi gravado`);
        }
      };
      const dados = { task, veredito: forma.veredito, rodada: forma.rodada, blocker: forma.blocker, major: forma.major, ...(sha !== undefined ? { sha } : {}) };
      return { evento: gravar(c, plano, 'review.veredito', dados, conferir) };
    }
    case 'reabrir': tarefa(plano, task); return { evento: gravar(c, plano, 'task.reaberta', { task, origem: 'retomada' }) };
    case 'liberar': return liberarComoSombra(c, plano, task, forma.hash);
    default: throw new Falha('uso', `comando desconhecido: ${cmd}`, {}, 2);
  }
}

/** Último evento da task (na ordem do diário) que casa `filtro`; diário fora de ordem ⇒ nenhum (a tabela do `gravar` recusa depois). */
function ultimoDaTask(c, task, filtro) {
  const ord = ordenar(lerDiarioEstrito(c.dirEntrega));
  return (ord.ok ? ord.eventos : []).filter((e) => e.dados?.task === task && filtro(e)).at(-1);
}

/** Estado da task segundo o núcleo, lendo o diário de forma estrita; diário que a tabela recusa ⇒ falha, nunca um estado inventado. */
function estadoDaTask(c, task) {
  const eventos = lerDiarioEstrito(c.dirEntrega);
  const ord = ordenar(eventos);
  if (!ord.ok) throw new Falha('diario_invalido', 'o diário da entrega não está em ordem');
  const r = estadoDe(ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task));
  if ('invalido' in r) throw new Falha('diario_invalido', `diário da task ${task} fora da tabela de transições: ${r.invalido}`);
  const liberacoes = (origem) => eventos.filter((e) => e.tipo === 'task.reaberta' && e.dados?.task === task && e.dados?.origem === origem).length;
  // GM-14 T36 (furo 10): as liberações da Sombra contam à parte; `donos` segue sendo só a do dono (a releitura do `liberarTeto` não muda).
  return { estado: r.estado, donos: liberacoes('dono'), sombras: liberacoes('sombra') };
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
    recusarSePublicada(c);
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

// ─────────────────────────────────────────────────────────────── a Sombra libera o teto (GM-14 T36, FIEL-15)

const HASH_RE = /^[0-9a-f]{64}$/;
const RESPOSTA_RE = (entrega, h) => new RegExp(`^\\.harness/entregas/${entrega}/sombra/${h}\\.([0-9a-f]{12})\\.resposta\\.md$`);

/**
 * A PERGUNTA FECHADA de liberação (furo 3): texto fixo por task; `sombra.mjs perguntar --task <t> --libera-teto` a usa, e só ela vale para `liberar`.
 * GM-14 T39 (emenda 16, FIEL-15 e): o CRITÉRIO está no texto fixo, então mudá-lo muda o hash (FIEL-15 a) e decisão velha não libera.
 */
export function perguntaDaLiberacao(task) {
  return `A task ${task} chegou ao teto de rodadas de review. A spec e os achados sustentam liberar mais um ciclo de implementação e review (a Sombra libera 1 vez por task)? `
    + 'Critério: libera: true quando cada BLOCKER/MAJOR em aberto na última rodada tem correção dentro da spec vigente (com emendas) e dos arquivos da task, '
    + 'ou por desvio/task de ajuste já registrados; libera: false quando algum pede mudança de spec ou de desenho (aí emenda ou dono), quando a abordagem da task '
    + 'está errada (diga qual), quando o arquivo da última rodada falta, está ilegível ou foi cortado, ou quando a última rodada não traz nenhum BLOCKER/MAJOR '
    + 'legível (contradiz o REPROVADO que levou ao teto).';
}

/** REQ onde a FIEL-15 mora: as emendas aprovadas dele entram SEMPRE no brief e na versão da pergunta de liberação (T39, emenda 16 e MINOR 665842d7). */
export const REQ_DA_LIBERACAO = 'REQ-DIA-2';

/** REQs que versionam e alimentam a pergunta de liberação da task: os da task mais `REQ_DA_LIBERACAO`, sem repetir. */
export const reqsDaLiberacao = (t) => [...new Set([...(t?.reqs ?? []), REQ_DA_LIBERACAO])];

/** Teto de leitura por arquivo de achados no brief da liberação (emenda 16 e.2); o resto é cortado e marcado. */
export const ACHADO_MAX_BYTES = 40 * 1024;

/**
 * Achados do CICLO CORRENTE da task (emenda 16 e.2): as rodadas com `review.veredito` da task depois da última `task.reaberta` dela (qualquer
 * origem), ou desde o começo se não houve, na ordem do diário; uma entrada por rodada (a última vence). Cada arquivo
 * `<raiz>/.harness/worktrees/<task>/.tmp-gabarito/review-r<n>.md` vem com estado `integro | cortado | ausente | ilegivel`, sha256 do arquivo
 * inteiro e no máximo `ACHADO_MAX_BYTES` de conteúdo (corte em fronteira de UTF-8). Só lê; symlink (do arquivo ou de `.tmp-gabarito`) é ilegível.
 */
export function achadosDoCiclo(raiz, eventos, task) {
  const ord = ordenar(eventos);
  const daTask = (ord.ok ? ord.eventos : eventos).filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task);
  let ini = 0;
  daTask.forEach((e, i) => { if (e.tipo === 'task.reaberta') ini = i + 1; });
  const porRodada = new Map();
  for (const e of daTask.slice(ini)) {
    if (e.tipo !== 'review.veredito' || !Number.isInteger(e.dados?.rodada)) continue;
    porRodada.delete(e.dados.rodada);
    porRodada.set(e.dados.rodada, e.dados);
  }
  const relTmp = `.harness/worktrees/${task}/${TMP}`;
  const tmp = join(raiz, '.harness', 'worktrees', task, TMP);
  let tmpRuim = null;
  try {
    const st = lstatSync(tmp);
    if (st.isSymbolicLink() || !st.isDirectory()) tmpRuim = `${TMP} não é um diretório comum (symlink ou arquivo)`;
  } catch (e) {
    if (e.code !== 'ENOENT') tmpRuim = `${TMP} ilegível (${e.code ?? e.message})`;
  }
  return [...porRodada.values()].map((d) => {
    const base = { rodada: d.rodada, veredito: d.veredito, blocker: d.blocker, major: d.major, arquivo: `${relTmp}/review-r${d.rodada}.md` };
    if (tmpRuim !== null) return { ...base, estado: 'ilegivel', motivo: tmpRuim };
    const arq = join(tmp, `review-r${d.rodada}.md`);
    let buf;
    try {
      if (!lstatSync(arq).isFile()) return { ...base, estado: 'ilegivel', motivo: 'não é arquivo regular (symlink ou diretório)' };
      buf = readFileSync(arq);
    } catch (e) {
      if (e.code === 'ENOENT') return { ...base, estado: 'ausente' };
      return { ...base, estado: 'ilegivel', motivo: e.code ?? e.message };
    }
    const sha256 = createHash('sha256').update(buf).digest('hex');
    if (buf.length <= ACHADO_MAX_BYTES) {
      const conteudo = buf.toString('utf8');
      if (conteudo.trim() === '') return { ...base, estado: 'ilegivel', motivo: 'arquivo vazio', sha256, bytes: buf.length };
      return { ...base, estado: 'integro', sha256, bytes: buf.length, conteudo };
    }
    let fim = ACHADO_MAX_BYTES;
    while (fim > 0 && (buf[fim] & 0xc0) === 0x80) fim--; // não parte um caractere UTF-8 ao meio
    return { ...base, estado: 'cortado', sha256, bytes: buf.length, conteudo: buf.subarray(0, fim).toString('utf8'), lidos: fim };
  });
}

/**
 * Identidade do insumo da liberação (T39 r1, MAJOR 1): rodada, veredito e contagens de cada rodada do ciclo corrente, na ordem, com o estado e o
 * sha256 do `review-r<n>.md`. Veredito novo ou achado reescrito ⇒ outra identidade ⇒ outro hash ⇒ outro brief: a Sombra nunca decide sobre insumo velho.
 */
export function insumoDaLiberacao(achados) {
  const linhas = achados.map((a) => [a.rodada, a.veredito, a.blocker, a.major, a.estado, a.sha256 ?? null]);
  return createHash('sha256').update(JSON.stringify(linhas)).digest('hex');
}

/**
 * Hash da pergunta de liberação da task com a versão da âncora de hoje (a mesma regra de `sombra.mjs perguntar`: `proposta_seq` da ÚLTIMA emenda
 * aprovada dentre os REQs da task e `REQ-DIA-2`, T39) e a identidade do insumo de hoje (`insumoDaLiberacao` dos achados do ciclo corrente,
 * lidos de `raiz`, T39 r1). Emenda aprovada, veredito novo ou achado reescrito depois da pergunta muda o hash: a decisão velha não libera.
 * `achados` já lidos (o brief de `perguntar`) evitam reler. `null` = task fora do plano ou diário que não projeta. Exportada para `sombra.mjs`
 * (perguntar e registrar) e para o teste.
 */
export function hashDaLiberacao(plano, eventos, task, raiz, achados) {
  const t = plano?.tasks?.find((x) => x.id === task);
  if (t === undefined) return null;
  const est = projetarEmendas(eventos);
  if (est.invalido !== undefined) return null;
  const reqs = reqsDaLiberacao(t); // T39 (MINOR 665842d7): emenda aprovada de REQ-DIA-2 também versiona a pergunta
  const aprovadas = est.aprovadas.filter((p) => reqs.includes(p.req));
  const versao = aprovadas.length === 0 ? 0 : aprovadas[aprovadas.length - 1].seq;
  try {
    const insumo = insumoDaLiberacao(achados ?? achadosDoCiclo(raiz, eventos, task));
    return hashPergunta(`${textoAncora({ task })} insumo:${insumo}`, versao, perguntaDaLiberacao(task));
  } catch { return null; }
}

/** Estado da task pelo diário inteiro, na ordem de `ordenar` (a régua de `conferirLiberacao`); `{invalido}` se a ordem ou a tabela quebram. */
export function estadoNoDiario(eventos, task) {
  const ord = ordenar(eventos);
  if (!ord.ok) return { invalido: 'diário fora de ordem' };
  return estadoDe(ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task));
}

const ehArquivoRegular = (p) => { try { return lstatSync(p).isFile(); } catch { return false; } };

/**
 * Tudo que o diário decide sobre a liberação da Sombra, na ordem dos motivos de FIEL-15 (b). Puro sobre `eventos` (mais a leitura do brief e da
 * resposta no disco): roda antes de `gravar` e de novo DENTRO dele, sobre o diário que ele leu. Lança `Falha`; nada grava.
 */
function conferirLiberacao(c, plano, task, hash, eventos) {
  const ord = ordenar(eventos);
  if (!ord.ok) throw new Falha('diario_invalido', 'o diário da entrega não está em ordem; nada foi gravado');
  const daTask = ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task);
  // furo 6: a Sombra só dá a 1ª liberação; qualquer liberação anterior (do dono ou dela) faz da próxima uma decisão do dono.
  const anteriores = daTask.filter((e) => e.tipo === 'task.reaberta' && (e.dados?.origem === 'dono' || e.dados?.origem === 'sombra'));
  if (anteriores.length > 0) {
    const quem = anteriores.map((e) => (e.dados.origem === 'dono' ? 'o dono' : 'a Sombra')).join(' e ');
    throw new Falha('teto_sombra_esgotado', `a task ${task} já foi liberada (${quem}): a Sombra só dá a 1ª liberação, a próxima é sempre do dono (/gabarito-mestre:liberar ${task}); nada foi gravado`);
  }
  const r = estadoDe(daTask);
  if ('invalido' in r) throw new Falha('diario_invalido', `diário da task ${task} fora da tabela de transições: ${r.invalido}; nada foi gravado`);
  if (r.estado !== 'no_teto') throw new Falha('fora_do_teto', `a task ${task} está em ${r.estado}: a Sombra só libera task no teto de rodadas; nada foi gravado`);
  const invalido = (porque) => new Falha('hash_invalido', `o hash ${String(hash).slice(0, 12)}… não autoriza a liberação de ${task}: ${porque}; nada foi gravado`);
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw invalido('fora da forma sha256 em hex minúsculo (64)');
  // furo 1 e 3: só a pergunta fechada de liberação desta task, na versão de hoje da âncora
  if (hash !== hashDaLiberacao(plano, eventos, task, c.raiz)) throw invalido(`não é o hash da pergunta de liberação da task com os achados de hoje (sombra.mjs perguntar --task ${task} --libera-teto de novo)`);
  const consulta = ord.eventos.some((e) => e.tipo === 'sombra.consulta' && formaInvalida(e.tipo, e.dados) === null && e.dados.pergunta_hash === hash && e.dados.task === task);
  if (!consulta) throw invalido('sem a sombra.consulta da pergunta de liberação no diário');
  // furo 5: vale a decisão VIGENTE (a substituída não conta), na posição da ordem do diário
  const v = vigentes(eventos).get(hash);
  if (v === undefined) throw invalido('sem decisão da Sombra para a pergunta de liberação');
  const d = ord.eventos[v.pos]?.dados ?? {};
  if (d.task !== task) throw invalido('a decisão não é desta task');
  if (d.fora_da_regra === true) throw invalido('a decisão está fora da regra (fora_da_regra)');
  // furo 4: "depois do veredito que levou ao teto" pela ORDEM do diário (`ordenar`), nunca pelo ts cru
  let posTeto = -1;
  for (let i = 0; i < daTask.length && posTeto < 0; i++) {
    const p = estadoDe(daTask.slice(0, i + 1));
    if (!('invalido' in p) && p.estado === 'no_teto') posTeto = ord.eventos.indexOf(daTask[i]);
  }
  if (v.pos <= posTeto) throw invalido('a decisão vem antes do teto na ordem do diário (só vale a dada depois do veredito que levou ao teto)');
  // furo 2 (o que dá para fechar): o brief que `perguntar` gerou e a resposta que `registrar` gravou estão no disco, com o sha do texto
  if (!ehArquivoRegular(join(c.dirEntrega, 'sombra', `${hash}.md`))) throw invalido('o brief da pergunta não está no disco');
  const m = typeof d.arquivo === 'string' ? RESPOSTA_RE(c.entrega, hash).exec(d.arquivo) : null;
  const arq = m === null ? null : join(c.dirEntrega, 'sombra', basename(d.arquivo));
  let texto = null;
  if (arq !== null && ehArquivoRegular(arq)) { try { texto = readFileSync(arq, 'utf8'); } catch { texto = null; } }
  if (texto === null || sha(texto).slice(0, 12) !== m[1]) throw invalido('o arquivo de resposta da decisão está ausente, fora do lugar ou adulterado');
  // T39 (emenda 16): decisão íntegra que não traz `libera: true` é a Sombra dizendo não, motivo próprio (por último: só a decisão válida chega aqui)
  if (d.libera !== true) {
    throw new Falha('sombra_nao_liberou', `a decisão vigente da Sombra para ${task} não libera (libera ${d.libera === false ? 'false' : 'ausente'}): mais um ciclo é decisão do dono (/gabarito-mestre:liberar ${task}) ou de uma emenda; nada foi gravado`);
  }
  return { ord };
}

/**
 * `loop.mjs liberar <task> --origem sombra --hash <h>`: a ÚNICA gravação de `task.reaberta {origem:"sombra", hash}` (FIEL-15). Repete o caminho de
 * `liberarTeto` (furo 10): `no_teto`, projeção na ordem real (`relogio_do_diario`), achados arquivados por último e releitura. O caminho do dono não muda.
 */
function liberarComoSombra(c, plano, task, hash) {
  recusarSePublicada(c);
  tarefa(plano, task);
  const o = lerConfigOrigin(c.raiz);
  const liga = o.fonte === 'origin' && o.cfg.sombra !== null && typeof o.cfg.sombra === 'object' && o.cfg.sombra.libera_teto === true;
  if (!liga) {
    throw new Falha('libera_teto_desligado', o.invalida
      ? `config de origin/HEAD inválida (${o.motivo}): sem sombra.libera_teto verdadeiro lá, a Sombra não libera o teto; nada foi gravado`
      : 'sombra.libera_teto não é true em origin/HEAD (o config local não conta): a Sombra não libera o teto; nada foi gravado');
  }
  const eventos = lerDiarioEstrito(c.dirEntrega);
  if (diarioInvalido(plano, eventos)) throw new Falha('diario_invalido', 'o diário da entrega não passa na tabela de transições; nada foi gravado');
  conferirLiberacao(c, plano, task, hash, eventos);
  // Projeta o candidato NA ORDEM REAL (relógio de outra sessão pode pô-lo antes do teto). Fora do teto `reaberta.sombra` é par ausente, então a tabela
  // de `gravar` recusaria antes do gancho: a projeção roda aqui primeiro (com o candidato que `gravar` montaria) e de novo dentro dele.
  const projetarNaOrdem = (candidato, lidos) => {
    const ord = ordenar([...lidos, candidato]);
    if (!ord.ok) throw new Falha('diario_invalido', `a liberação de ${task} deixaria o diário fora de ordem; nada foi gravado`);
    const r = estadoDe(ord.eventos.filter((e) => TIPOS_DE_TASK.includes(e.tipo) && e.dados?.task === task));
    if ('invalido' in r || r.estado !== 'pendente') {
      throw new Falha('relogio_do_diario', `a liberação de ${task} não tiraria a task do teto: na ordem do diário o evento cairia antes do teto (um evento do diário tem relógio à frente do agora; estado projetado ${'invalido' in r ? r.invalido : r.estado}). Nada foi gravado`);
    }
  };
  const minhas = eventos.filter((e) => e.sessao === c.sessao).map((e) => e.seq);
  const dados = { task, origem: 'sombra', hash };
  projetarNaOrdem({ seq: (minhas.length ? Math.max(...minhas) : 0) + 1, ts: new Date().toISOString(), sessao: c.sessao, tipo: 'task.reaberta', dados }, eventos);
  const antes = estadoDaTask(c, task);
  const projetar = (candidato, lidos) => {
    conferirLiberacao(c, plano, task, hash, lidos); // o diário que `gravar` leu (outra sessão pode ter gravado no meio)
    projetarNaOrdem(candidato, lidos);
    arquivarAchados(c, task); // última coisa antes do append: toda recusa acima deixa os achados onde estão
  };
  gravar(c, plano, 'task.reaberta', dados, projetar);
  const depois = estadoDaTask(c, task);
  if (depois.sombras !== antes.sombras + 1 || depois.estado !== 'pendente') {
    throw new Falha('liberacao_sem_efeito', `o evento de ${task} foi gravado mas o diário relido não mostra a task fora do teto (estado ${depois.estado}, liberações da Sombra ${antes.sombras} → ${depois.sombras}); confira o diário`);
  }
  return { task, entrega: c.entrega, estado: depois.estado, origem: 'sombra', hash };
}

/**
 * REQ-PNL-8: a ÚNICA gravação de `spec.aprovada {spec, sha256}`. Fora de `ESPEC` de propósito: nenhum argumento do CLI chega aqui, só o
 * hook `UserPromptExpansion` (`aprovar-spec.mjs`), disparado pelo comando que o dono digita. O sha é o de `shaDaSpec` (bytes, checkout da sessão: T38;
 * o diário segue na raiz principal).
 * A spec é `plano.spec`; sem `plano.json` (GM-14 T15, a aprovação vem antes do plano) é a ÚNICA de `lerSpecs` com `PBI` da entrega: 0 ⇒
 * `spec_ausente`, 2+ ⇒ `spec_ambigua`, specs ilegíveis ⇒ `specs_ilegiveis`; nada gravado em nenhum. Plano presente e inválido segue `plano_invalido`.
 * "Já aprovada" = existe `spec.aprovada` de forma válida com o sha atual, sem ordem e sem olhar `spec` (a régua do painel): não entra em
 * transição nem depende de relógio. Nunca lança: `{ok:true, spec, sha256, entrega}` só com o evento gravado E relido (a contagem com esse sha
 * subiu, não "+1 exato": sem lock, duas sessões juntas gravam dois eventos iguais, limite do `gravar`); senão `{ok:false, erro, mensagem}`.
 * `opcoes.antes` e `opcoes.depois` são injeção de teste: `antes` roda logo antes de reler o sha e gravar, `depois` entre o append e a releitura.
 */
export function aprovarSpec(cwd, sessao, opcoes = {}) {
  try {
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) throw new Falha('argumento_invalido', `sessão fora da forma ${SESSAO_RE}`);
    const c = contexto(cwd, { sessao });
    const checkout = checkoutDaSessao(cwd);
    // T15 (REQ-TRI-1): sem plano.json a aprovação vem antes do plano; a spec é a ÚNICA da entrega em lerSpecs.
    let plano = null;
    let alvo;
    try {
      plano = carregarPlano(c);
      alvo = plano;
    } catch (e) {
      if (!(e instanceof Falha) || e.erro !== 'plano_ausente') throw e;
      const daEntrega = lerSpecs(checkout, idPadraoDe(c.raiz)).filter((s) => s.pbi === c.entrega);
      if (daEntrega.length === 0) throw new Falha('spec_ausente', `sem plano.json e sem spec com \`PBI: ${c.entrega}\` em docs/superpowers/specs; nada foi gravado`);
      if (daEntrega.length > 1) throw new Falha('spec_ambigua', `sem plano.json e com ${daEntrega.length} specs com \`PBI: ${c.entrega}\` (${daEntrega.map((s) => s.caminho).join(', ')}); deixe uma só. Nada foi gravado`);
      alvo = { spec: daEntrega[0].caminho };
    }
    const atual = shaDaSpec(checkout, alvo);
    if (!atual.ok) throw new Falha(atual.erro, `${atual.mensagem}; nada foi gravado`);
    const contar = (eventos) => eventos.filter((e) => e.tipo === 'spec.aprovada' && formaInvalida('spec.aprovada', e.dados) === null && e.dados.sha256 === atual.sha256).length;
    let antesN = 0;
    const conferir = (_candidato, eventos) => {
      antesN = contar(eventos);
      if (antesN > 0) throw new Falha('ja_aprovada', `a spec com o sha256 ${atual.sha256.slice(0, 12)}… já foi aprovada; só uma spec que mudou se aprova de novo. Nada foi gravado`);
      opcoes.antes?.();
      const de_novo = shaDaSpec(checkout, alvo);
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
  if (TIPO_VEDADO_EM_PUBLICADA(tipo)) recusarSePublicada(c);
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
